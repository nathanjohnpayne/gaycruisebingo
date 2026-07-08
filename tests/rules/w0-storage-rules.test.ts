import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getMetadata, ref, uploadBytes } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';

// Storage security-rules coverage for storage.rules (ADR 0004): the okImage()
// (image/* < 8 MB) and okAudio() (audio/* < 12 MB) upload caps, the
// filename-pinned avatars path, the owner/admin proofs path, the inert /og/**
// block, and — critically — the cross-check that a Proof object which passes
// storage.rules also passes the Firestore `proofs` create rule, so the two stay
// in lockstep. Runs on the rules-emulator layer via `npm run test:rules`, which
// boots both the Firestore and Storage emulators.

const storageRules = readFileSync(
  fileURLToPath(new URL('../../storage.rules', import.meta.url)),
  'utf8',
);
const firestoreRules = readFileSync(
  fileURLToPath(new URL('../../firestore.rules', import.meta.url)),
  'utf8',
);

const EVENT = 'evt1';
const OWNER = 'alice';
const OTHER = 'bob';
const ADMIN = 'carol';
const PROOF = 'proof1';

// Object paths built from one (event, uid, proof) triple, mirroring
// src/data/storage.ts. The cross-check reuses these so it proves the SAME path
// satisfies both Storage and Firestore, not two independently-chosen strings.
const photoPath = `proofs/${EVENT}/${OWNER}/${PROOF}.jpg`;
const audioPath = `proofs/${EVENT}/${OWNER}/${PROOF}.webm`;
const avatarPath = (uid: string) => `avatars/${uid}.jpg`;

// A byte payload of an exact size, so request.resource.size hits the rule caps.
const sized = (mb: number) => new Uint8Array(Math.round(mb * 1024 * 1024));
const TINY = new Uint8Array(64);
const IMAGE = { contentType: 'image/jpeg' };
const AUDIO = { contentType: 'audio/webm' };

let testEnv: RulesTestEnvironment;

const put = (
  ctx: RulesTestContext,
  path: string,
  data: Uint8Array,
  meta: { contentType: string },
) => uploadBytes(ref(ctx.storage(), path), data, meta);

beforeAll(async () => {
  // Under `firebase emulators:exec` the emulator hosts + the active project are
  // exported here. The Storage isEventAdmin() rule does a cross-service
  // firestore.get(), which the Storage emulator resolves against the project the
  // emulator was booted with (GCLOUD_PROJECT, from .firebaserc), NOT the
  // client-supplied projectId — so bind this env to that same project, letting
  // the seeded events/{id} admins doc be visible to the admin-delete rule. Fall
  // back to the firebase.json ports and .firebaserc default for a direct run.
  const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  const [stHost, stPort] = (
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'
  ).split(':');
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'gaycruisebingo',
    firestore: { host: fsHost, port: Number(fsPort), rules: firestoreRules },
    storage: { host: stHost, port: Number(stPort), rules: storageRules },
  });
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('storage.rules — okImage / okAudio upload caps (ADR 0004)', () => {
  it('allows a 7 MB image but denies a 9 MB image (okImage < 8 MB)', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(put(owner, photoPath, sized(7), IMAGE));
    await assertFails(put(owner, photoPath, sized(9), IMAGE));
  });

  it('allows an 11 MB audio but denies a 13 MB audio (okAudio < 12 MB)', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(put(owner, audioPath, sized(11), AUDIO));
    await assertFails(put(owner, audioPath, sized(13), AUDIO));
  });

  it('denies a non-image, non-audio content type on a proof path', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertFails(put(owner, photoPath, TINY, { contentType: 'application/pdf' }));
  });
});

describe('storage.rules — avatars/{uid}.jpg (owner + filename pinned)', () => {
  it('allows the owner to write their own avatars/{uid}.jpg', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(put(owner, avatarPath(OWNER), TINY, IMAGE));
  });

  it("denies writing another user's avatar filename", async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertFails(put(owner, avatarPath(OTHER), TINY, IMAGE));
  });

  it('denies a wrong avatar filename for the owner', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertFails(put(owner, `avatars/${OWNER}.png`, TINY, IMAGE));
  });
});

describe('storage.rules — proofs/{eventId}/{uid}/{file} (owner create, owner/admin delete)', () => {
  it('allows the owning uploader to create their proof object', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(put(owner, photoPath, TINY, IMAGE));
  });

  it("denies a non-owner writing under another user's proof folder", async () => {
    const other = testEnv.authenticatedContext(OTHER);
    await assertFails(put(other, photoPath, TINY, IMAGE));
  });

  it('allows the owner to delete their own proof object', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await put(ctx, photoPath, TINY, IMAGE);
    });
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(deleteObject(ref(owner.storage(), photoPath)));
  });

  it('allows an Event admin to delete the proof object', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await put(ctx, photoPath, TINY, IMAGE);
      await setDoc(doc(ctx.firestore(), `events/${EVENT}`), { admins: [ADMIN] });
    });
    const admin = testEnv.authenticatedContext(ADMIN);
    await assertSucceeds(deleteObject(ref(admin.storage(), photoPath)));
  });
});

describe('storage.rules — /og/** inert block', () => {
  it('is public-read but denies all writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await put(ctx, 'og/card.png', TINY, { contentType: 'image/png' });
    });
    const anon = testEnv.unauthenticatedContext();
    await assertSucceeds(getMetadata(ref(anon.storage(), 'og/card.png')));
    const owner = testEnv.authenticatedContext(OWNER);
    await assertFails(put(owner, 'og/card.png', TINY, { contentType: 'image/png' }));
  });
});

describe('Storage ↔ Firestore Proof pinning (lockstep)', () => {
  // A Proof object that satisfies storage.rules must also satisfy the Firestore
  // `proofs` create rule: identical proofs/{eventId}/{uid}/{proofId}.{ext} path.
  const mediaURL = (ext: string) =>
    `https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/proofs%2F${EVENT}%2F${OWNER}%2F${PROOF}.${ext}?alt=media&token=t`;

  const proofDoc = (type: 'photo' | 'audio', storagePath: string, url: string) => ({
    uid: OWNER,
    displayName: 'Alice',
    photoURL: null,
    type,
    cellIndex: 5,
    itemText: 'Saw a sailor',
    storagePath,
    mediaURL: url,
    thumbURL: null,
    text: null,
    createdAt: Date.now(),
    reportCount: 0,
    status: 'active',
    visionFlag: null,
  });

  it('accepts the same photo object in Storage and Firestore', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(put(owner, photoPath, TINY, IMAGE));
    await assertSucceeds(
      setDoc(
        doc(owner.firestore(), `events/${EVENT}/proofs/${PROOF}`),
        proofDoc('photo', photoPath, mediaURL('jpg')),
      ),
    );
  });

  it('accepts the same audio object in Storage and Firestore', async () => {
    const owner = testEnv.authenticatedContext(OWNER);
    await assertSucceeds(put(owner, audioPath, TINY, AUDIO));
    await assertSucceeds(
      setDoc(
        doc(owner.firestore(), `events/${EVENT}/proofs/${PROOF}`),
        proofDoc('audio', audioPath, mediaURL('webm')),
      ),
    );
  });
});
