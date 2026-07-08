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
  connectFirestoreEmulator,
  doc,
  setDoc,
  onSnapshot,
  getDocFromServer,
  disableNetwork,
  waitForPendingWrites,
  terminate,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { BoardDoc, Cell } from '../../src/types';

// ---------------------------------------------------------------- ADR 0006 ---
// Offline persistence, the data half — the integration proof. Against the
// Firestore + Auth emulators, with real IndexedDB semantics via fake-indexeddb
// (see setup.ts): a Mark written while OFFLINE queues durably, SURVIVES a
// simulated reload that happens BEFORE any sync (client terminated while the
// write is still pending), and drains to Firestore once a reloaded client comes
// back up. The ordering is the point: the server is proven to NOT have the
// write at teardown time, so the only way it can arrive later is out of the
// persisted local queue. Reverting src/firebase.ts to a non-persistent cache
// makes this suite fail at the final assertion — verified during development.
//
// The reload simulation leans on Firestore keying its IndexedDB store by app
// name (the persistence key) + project: the "reloaded" client reuses the SAME
// app name and signed-in uid, so it opens the same store, recovers the queue,
// and sends it. fake-indexeddb's store is process-global, surviving
// terminate()/deleteApp() exactly like a browser profile survives a tab reload.
// The source-config guard for the production init lives in src/firebase.test.ts
// (npm test); full scope notes are in specs/w0-offline-persistence.md.
//
// Run it (app tests are not CI-run):
//   firebase emulators:exec --only auth,firestore \
//     "vitest run --config vitest.offline.config.ts"

const EVENT_ID = 'med-2026';
const PROJECT_ID = 'demo-offline-persistence';
const EMAIL = 'player@offline.test';
const PASSWORD = 'passw0rd!';
const MARKED_CELL = 12;
// Reusing this exact name for the post-"reload" client is what re-opens the
// same IndexedDB persistence store.
const TAB_APP_NAME = 'gcb-offline-tab';

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
// A stable uid is load-bearing twice over — firestore.rules isOwner() gates the
// board path, and the SDK's persisted mutation queue is recovered per-user.
async function signIn(auth: Auth) {
  try {
    return await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  } catch {
    return await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
  }
}

type Client = { app: FirebaseApp; db: Firestore; uid: string };

// One emulator-backed client on the same persistentLocalCache as
// src/firebase.ts, signed in as the shared player. Each call models one app
// load of the same installed PWA. One deliberate divergence from production:
// the DEFAULT single-tab manager instead of persistentMultipleTabManager —
// multi-tab needs the browser's cross-tab WebStorage machinery, which the
// SDK's node build hard-disables (getWindow() is null); the durable-queue
// property under test lives in the persistence layer and is tab-manager
// orthogonal, and src/firebase.test.ts pins the production multi-tab config.
// The apiKey is a non-empty placeholder the Auth emulator does not validate.
async function makeClient(name: string): Promise<Client> {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT_ID }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, authEmulatorUrl(), { disableWarnings: true });
  const cred = await signIn(auth);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache(),
  });
  connectFirestoreEmulator(db, ...firestoreEmulator());
  return { app, db, uid: cred.user.uid };
}

// An independent observer with the DEFAULT (memory) cache and its own app name:
// it shares no local state with the tab clients, so what it reads from the
// server is ground truth about what actually synced.
async function makeObserver(): Promise<Client> {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT_ID }, 'gcb-observer');
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, authEmulatorUrl(), { disableWarnings: true });
  const cred = await signIn(auth);
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, ...firestoreEmulator());
  return { app, db, uid: cred.user.uid };
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
// resolve until a server ack — the write lands in the persistent cache and
// surfaces to listeners first (with hasPendingWrites).
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
  it('persists an offline Mark across a reload that happens before any sync, then syncs it', async () => {
    const tab = await makeClient(TAB_APP_NAME);
    const boardPath = `events/${EVENT_ID}/boards/${tab.uid}`;
    const ref = doc(tab.db, boardPath);

    // 1. Go offline — a ship-wifi dead zone.
    await disableNetwork(tab.db);

    // 2. Mark a Square while offline. Do NOT await: offline, setDoc's promise
    //    resolves only after a server ack that never comes in this tab's
    //    lifetime. The write lands in the persistent (IndexedDB) cache now.
    setDoc(ref, boardWithMarkedSquare(tab.uid, MARKED_CELL)).catch(() => {
      // Expected: the tab is terminated below with the write still pending.
    });

    // 3. The Mark is present locally and flagged as an unsynced pending write.
    const queued = await waitForSnapshot(
      ref,
      (snap) => snap.exists() && snap.metadata.hasPendingWrites,
    );
    expect((queued.data() as BoardDoc).cells[MARKED_CELL].marked).toBe(true);
    expect(queued.metadata.fromCache).toBe(true);

    // 4. The "reload": kill the tab WHILE STILL OFFLINE, before any sync. The
    //    queued Mark now exists nowhere except the persisted local queue.
    await terminate(tab.db);
    await deleteApp(tab.app);

    // 5. Ground truth via an independent observer: the server does NOT have the
    //    board — nothing synced before the reload. (This is the assertion that
    //    fails-fast if the persistent cache is ever swapped back to memory: the
    //    write would have died with the tab, and step 7 would time out.)
    const observer = await makeObserver();
    const beforeRecovery = await getDocFromServer(doc(observer.db, boardPath));
    expect(beforeRecovery.exists()).toBe(false);

    // 6. Bring the "reloaded" tab up: same app name -> same IndexedDB store,
    //    same signed-in uid -> same recovered mutation queue. Network is on, so
    //    the recovered queue drains to Firestore.
    const reloaded = await makeClient(TAB_APP_NAME);
    await waitForPendingWrites(reloaded.db);

    // 7. The Mark survived the reload and synced: the server has it, served
    //    fresh (not from cache) with no writes still pending.
    const synced = await getDocFromServer(doc(reloaded.db, boardPath));
    expect(synced.exists()).toBe(true);
    expect(synced.metadata.fromCache).toBe(false);
    expect(synced.metadata.hasPendingWrites).toBe(false);
    expect((synced.data() as BoardDoc).cells[MARKED_CELL].marked).toBe(true);

    // 8. And the independent observer sees it too — server-side, not an
    //    artifact of the reloaded tab's own cache.
    const observed = await getDocFromServer(doc(observer.db, boardPath));
    expect(observed.exists()).toBe(true);
    expect((observed.data() as BoardDoc).cells[MARKED_CELL].marked).toBe(true);
  });
});
