import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { arrayRemove, arrayUnion, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// specs/w2-banned-uids.md — the rules-owned Admin ban surface (#113). The ban is a
// presentational, event-scoped hide/mute roster (ADR 0004 Phase 0): `bannedUids`
// on the already-admin-writable EVENT doc, NOT hard access revocation (that is
// #43/#44) and NOT a write into owner-only users/{uid}. This suite pins the rules
// contract the #108 banUser/unbanUser follow-up depends on:
//   1. An Admin may set bannedUids (whole-doc set AND arrayUnion/arrayRemove
//      partial updates that never clobber other event config).
//   2. A non-admin is denied.
//   3. Payload validation: bannedUids must be a LIST, size-capped at 1000, and
//      DISJOINT from `admins` (a banned uid may not also be an admin).
//   4. users/{uid} stays owner-only — no admin write path was opened there (the
//      anti-schema-smuggling guarantee).
// The PERMISSION_DENIED lines the SDK logs are the expected assertFails denials.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ADMIN, ALICE, BOB, CAROL] = ['admin-uid', 'alice', 'bob', 'carol'];
const CAP = 1000; // must match the size cap in firestore.rules

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const eventDoc = (ctxDb: ReturnType<typeof db>) => doc(ctxDb, 'events', EVENT);

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-w2-banned-uids',
    firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore();
    await setDoc(doc(s, `events/${EVENT}`), {
      name: 'Cruise', sailStart: '2026-01-01', sailEnd: '2026-01-07', status: 'active',
      defaultTheme: 'neon-playground', claimMode: 'honor', admins: [ADMIN],
      bannedUids: ['pre-banned'], // an existing roster, so arrayRemove has a target
      settings: { reportHideThreshold: 4 },
    });
    await setDoc(doc(s, 'users', BOB), { displayName: 'Bob', photoURL: null, createdAt: Date.now() });
  });
});

describe('firestore.rules — Admin ban via bannedUids (specs/w2-banned-uids.md)', () => {
  it('an Admin sets bannedUids with a whole-doc update', async () => {
    await assertSucceeds(updateDoc(eventDoc(db(ADMIN)), { bannedUids: [ALICE, BOB] }));
  });

  it('an Admin bans with an arrayUnion-shaped partial update that leaves other config intact', async () => {
    // banUser (#108) appends via arrayUnion so the write never clobbers other
    // event config — the rules validate the RESULTING field state, not the diff.
    await assertSucceeds(updateDoc(eventDoc(db(ADMIN)), { bannedUids: arrayUnion(CAROL) }));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(eventDoc(ctx.firestore()));
      expect(snap.data()?.bannedUids).toEqual(['pre-banned', CAROL]); // appended, not replaced
      expect(snap.data()?.name).toBe('Cruise'); // untouched
      expect(snap.data()?.settings).toEqual({ reportHideThreshold: 4 }); // untouched
    });
  });

  it('an Admin unbans with an arrayRemove-shaped partial update', async () => {
    await assertSucceeds(updateDoc(eventDoc(db(ADMIN)), { bannedUids: arrayRemove('pre-banned') }));
  });

  it('a non-admin cannot write bannedUids — by whole-doc set or arrayUnion', async () => {
    await assertFails(updateDoc(eventDoc(db(BOB)), { bannedUids: [ALICE] }));
    await assertFails(updateDoc(eventDoc(db(BOB)), { bannedUids: arrayUnion(ALICE) }));
  });

  it('rejects a non-list bannedUids (a scalar or a map)', async () => {
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { bannedUids: ALICE }));
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { bannedUids: { [ALICE]: true } }));
  });

  it('caps the roster: <= 1000 is allowed, 1001 is denied', async () => {
    const atCap = Array.from({ length: CAP }, (_, i) => `u${i}`); // none equals an admin
    const overCap = Array.from({ length: CAP + 1 }, (_, i) => `u${i}`);
    await assertSucceeds(updateDoc(eventDoc(db(ADMIN)), { bannedUids: atCap }));
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { bannedUids: overCap }));
  });

  it('rejects a bannedUids that overlaps admins — a banned uid may not also be an admin', async () => {
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { bannedUids: [ADMIN] }));
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { bannedUids: [BOB, ADMIN] }));
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { bannedUids: arrayUnion(ADMIN) }));
  });

  it('keeps users/{uid} owner-only — an Admin still cannot ban via a foreign user profile', async () => {
    // The anti-schema-smuggling guarantee: opening bannedUids on the event doc did
    // NOT open any admin write path into users/{uid}. An Admin cannot create or
    // update another Player's profile to carry a ban flag.
    await assertFails(
      setDoc(doc(db(ADMIN), 'users', BOB), { displayName: 'Bob', photoURL: null, createdAt: Date.now(), banned: true }),
    );
    await assertFails(updateDoc(doc(db(ADMIN), 'users', BOB), { banned: true }));
    await assertFails(updateDoc(doc(db(ADMIN), 'users', BOB), { bannedUids: [BOB] }));
  });
});
