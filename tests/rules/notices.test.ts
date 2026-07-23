import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// specs/admin-messages.md (#439) — the Notices rules contract. A Notice is an
// admin-authored broadcast at events/{eventId}/notices/{noticeId}: any signed-in
// Player READS it (the Feed everyone watches); only an admin creates, updates
// (pin/unpin), or deletes it, and both create and update validate the title/body
// caps + boolean `pinned`. The PERMISSION_DENIED lines the SDK logs are the
// expected assertFails denials.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ADMIN, ALICE, BOB] = ['admin-uid', 'alice', 'bob'];
const NOW = () => Date.now();

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const at = (p: string) => `events/${EVENT}/${p}`;
const noticePath = (id: string) => at(`notices/${id}`);
// The Notice shape notices.ts writes: { title, body, uid, displayName, createdAt, pinned }.
const notice = (uid: string, over: Record<string, unknown> = {}) => ({
  title: 'Final stretch 🏁',
  body: 'Last days at sea.',
  uid,
  displayName: uid,
  createdAt: NOW(),
  pinned: true,
  ...over,
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-notices',
    firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// Each test starts clean with a canonical Event (ADMIN is the sole admin) and one
// admin-authored Notice, so the public-read + admin-write invariants have a doc to
// read/mutate against.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore();
    await setDoc(doc(s, `events/${EVENT}`), {
      name: 'Cruise', sailStart: '2026-01-01', sailEnd: '2026-01-07', status: 'active',
      defaultTheme: 'neon-playground', claimMode: 'honor', admins: [ADMIN],
      settings: { reportHideThreshold: 3 },
      days: Array.from({ length: 10 }, (_, index) => ({ index })),
    });
    await setDoc(doc(s, noticePath('seed')), notice(ADMIN));
  });
});

describe('firestore.rules — Notices (specs/admin-messages.md)', () => {
  it('any signed-in Player reads a Notice', async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), noticePath('seed'))));
    await assertSucceeds(getDoc(doc(db(BOB), noticePath('seed'))));
  });

  it('an admin creates a Notice', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), noticePath('n1')), notice(ADMIN)));
  });

  it('a non-admin cannot create, update, or delete a Notice', async () => {
    await assertFails(setDoc(doc(db(ALICE), noticePath('n1')), notice(ALICE)));
    await assertFails(updateDoc(doc(db(ALICE), noticePath('seed')), { pinned: false }));
    await assertFails(deleteDoc(doc(db(ALICE), noticePath('seed'))));
  });

  it('an admin pins/unpins (update) and deletes a Notice', async () => {
    await assertSucceeds(updateDoc(doc(db(ADMIN), noticePath('seed')), { pinned: false }));
    await assertSucceeds(deleteDoc(doc(db(ADMIN), noticePath('seed'))));
  });

  it('the ONLY mutable field is `pinned` — content/attribution edits are denied (Codex #440)', async () => {
    // The pin toggle is the sole update; a stale/hand-built admin client cannot
    // rewrite an already-delivered Notice's content, attribution, or ordering.
    await assertFails(updateDoc(doc(db(ADMIN), noticePath('seed')), { title: 'Rewritten' }));
    await assertFails(updateDoc(doc(db(ADMIN), noticePath('seed')), { body: 'Rewritten' }));
    await assertFails(updateDoc(doc(db(ADMIN), noticePath('seed')), { displayName: 'Someone else' }));
    await assertFails(updateDoc(doc(db(ADMIN), noticePath('seed')), { createdAt: 1 }));
    // A pin toggle alongside a content change is still denied (the diff isn't pin-only).
    await assertFails(updateDoc(doc(db(ADMIN), noticePath('seed')), { pinned: false, title: 'x' }));
    // A non-boolean pinned is denied even alone.
    await assertFails(updateDoc(doc(db(ADMIN), noticePath('seed')), { pinned: 'no' }));
  });

  it('enforces the title ≤60, body ≤400, and boolean-pinned caps on create', async () => {
    const p = (id: string) => doc(db(ADMIN), noticePath(id));
    await assertFails(setDoc(p('long-title'), notice(ADMIN, { title: 'x'.repeat(61) })));
    await assertFails(setDoc(p('long-body'), notice(ADMIN, { body: 'x'.repeat(401) })));
    await assertFails(setDoc(p('bad-pinned'), notice(ADMIN, { pinned: 'yes' })));
    await assertFails(setDoc(p('num-title'), notice(ADMIN, { title: 42 })));
    // A Notice exactly at the caps is accepted.
    await assertSucceeds(
      setDoc(p('at-caps'), notice(ADMIN, { title: 'x'.repeat(60), body: 'y'.repeat(400) })),
    );
  });

  it('binds attribution to the authenticated admin — a forged uid is denied (Codex #440)', async () => {
    // An admin cannot mint a Notice attributed to a different uid (isOwner-of-uid).
    await assertFails(setDoc(doc(db(ADMIN), noticePath('forged')), notice(ALICE)));
    await assertSucceeds(setDoc(doc(db(ADMIN), noticePath('own')), notice(ADMIN)));
  });

  it('bounds createdAt near request.time so a forged stamp cannot pin forever (Codex #440)', async () => {
    const p = (id: string) => doc(db(ADMIN), noticePath(id));
    await assertFails(setDoc(p('future'), notice(ADMIN, { createdAt: NOW() + 3_600_000 })));
    await assertFails(setDoc(p('ancient'), notice(ADMIN, { createdAt: NOW() - 2 * 86_400_000 })));
    await assertFails(setDoc(p('nonnum'), notice(ADMIN, { createdAt: 'now' })));
    await assertSucceeds(setDoc(p('nowish'), notice(ADMIN, { createdAt: NOW() })));
  });
});
