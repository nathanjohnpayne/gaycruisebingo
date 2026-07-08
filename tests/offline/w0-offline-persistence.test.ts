import { afterAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  doc,
  setDoc,
  onSnapshot,
  getDocFromServer,
  disableNetwork,
  enableNetwork,
  waitForPendingWrites,
  terminate,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { BoardDoc, Cell } from '../../src/types';

// ---------------------------------------------------------------- ADR 0006 ---
// Offline persistence, the data half — the integration proof. Against the
// Firestore + Auth emulators: a Mark written while OFFLINE queues in the local
// cache and SYNCS to Firestore on reconnect, and a reloaded client still sees
// it. The source-config guard lives in `src/firebase.test.ts` (npm test); this
// suite proves that config's behavior end to end. Full scope and the honest
// browser-vs-node bounds are in specs/w0-offline-persistence.md.
//
// Node has no IndexedDB, so the SDK falls back to an in-memory cache here
// ("Falling back to memory cache"); the round trip below is cache-agnostic, and
// the pure-IndexedDB "reload while still offline" case is a browser-e2e concern.
//
// Run it (app tests are not CI-run):
//   firebase emulators:exec --only auth,firestore \
//     "vitest run --config vitest.offline.config.ts"

const EVENT_ID = 'med-2026';
const PROJECT_ID = 'demo-offline-persistence';
const EMAIL = 'player@offline.test';
const PASSWORD = 'passw0rd!';
const MARKED_CELL = 12;

function firestoreEmulator(): [string, number] {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  return [hostname, Number(port)];
}

function authEmulatorUrl(): string {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
  return host.startsWith('http') ? host : `http://${host}`;
}

const apps: FirebaseApp[] = [];

// Stable uid across "reloads": the first client creates the account, later
// clients sign back in to the SAME uid (the emulator keys accounts on email).
async function signIn(auth: Auth) {
  try {
    return await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  } catch {
    return await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
  }
}

// One emulator-backed client wired EXACTLY like src/firebase.ts (persistent
// local cache + multi-tab manager), signed in as the shared player. Each call
// models one app load / one browser tab. The apiKey is a non-empty placeholder
// the Auth emulator does not validate (the node SDK only rejects an empty key).
async function makeClient(name: string): Promise<{ db: Firestore; uid: string }> {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT_ID }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, authEmulatorUrl(), { disableWarnings: true });
  const cred = await signIn(auth);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  connectFirestoreEmulator(db, ...firestoreEmulator());
  return { db, uid: cred.user.uid };
}

// A board with exactly one Square marked — the offline Mark under test.
function boardWithMarkedSquare(uid: string, marked: number): BoardDoc {
  const cells: Cell[] = Array.from({ length: 25 }, (_, index) => ({
    index,
    itemId: index === 12 ? null : `item-${index}`,
    text: index === 12 ? 'FREE' : `prompt ${index}`,
    free: index === 12,
    marked: index === marked,
    markedAt: index === marked ? Date.now() : null,
  }));
  return { uid, seed: 42, createdAt: Date.now(), cells };
}

// Resolve on the first snapshot matching `predicate`, then unsubscribe. Used to
// observe the local offline write, whose setDoc() promise intentionally does not
// resolve until reconnect — the write lands in the cache and surfaces to
// listeners first (with hasPendingWrites), long before any server ack.
function waitForSnapshot(
  ref: DocumentReference,
  predicate: (snap: DocumentSnapshot) => boolean,
  timeoutMs = 15000,
): Promise<DocumentSnapshot> {
  return new Promise((resolve, reject) => {
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('snapshot predicate not met in time'));
    }, timeoutMs);
    unsub = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        if (predicate(snap)) {
          clearTimeout(timer);
          unsub();
          resolve(snap);
        }
      },
      (err) => {
        clearTimeout(timer);
        unsub();
        reject(err);
      },
    );
  });
}

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a).catch(() => {})));
});

describe('w0 offline persistence (ADR 0006)', () => {
  it('queues an offline Mark locally and syncs it to Firestore on reconnect, surviving a reload', async () => {
    const writer = await makeClient('offline-writer');
    const boardPath = `events/${EVENT_ID}/boards/${writer.uid}`;
    const ref = doc(writer.db, boardPath);

    // 1. Go offline — a ship-wifi dead zone.
    await disableNetwork(writer.db);

    // 2. Mark a Square while offline. Do NOT await: offline, setDoc's promise
    //    resolves only after a server ack. The write lands in the cache now.
    const writeAck = setDoc(ref, boardWithMarkedSquare(writer.uid, MARKED_CELL));

    // 3. The Mark is present locally and flagged as an unsynced pending write.
    const queued = await waitForSnapshot(
      ref,
      (snap) => snap.exists() && snap.metadata.hasPendingWrites,
    );
    expect((queued.data() as BoardDoc).cells[MARKED_CELL].marked).toBe(true);
    expect(queued.metadata.fromCache).toBe(true);

    // 4. Reconnect; the queued write now drains to Firestore.
    await enableNetwork(writer.db);
    await writeAck;
    await waitForPendingWrites(writer.db);

    // 5. It synced: the server has the Mark, served fresh (not from cache) with
    //    no writes still pending.
    const synced = await getDocFromServer(ref);
    expect(synced.exists()).toBe(true);
    expect(synced.metadata.fromCache).toBe(false);
    expect(synced.metadata.hasPendingWrites).toBe(false);
    expect((synced.data() as BoardDoc).cells[MARKED_CELL].marked).toBe(true);

    // 6. Simulate a reload: tear the client down, bring a fresh one up as the
    //    same player, and read the Mark back — it survived the restart. (In a
    //    browser the fresh client's IndexedDB cache already holds it offline.)
    await terminate(writer.db);
    const reloaded = await makeClient('offline-reader');
    const afterReload = await getDocFromServer(doc(reloaded.db, boardPath));
    expect(afterReload.exists()).toBe(true);
    expect((afterReload.data() as BoardDoc).cells[MARKED_CELL].marked).toBe(true);
  });
});
