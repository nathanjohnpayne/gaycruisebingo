import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

// specs/d15-dealing.md, the dealing path against the day-scoped Board rules
// (#201): a Day Card write (the deal that CREATES the doc) is DENIED before that
// Day's `unlockAt`, and ALLOWED at/after unlock when the owner's board doc is
// absent. The full rules surface is exercised by tests/rules/d15-firestore-rules.
// test.ts; this suite pins the deal-time gate `dealDayCard` writes against.
//
// The PERMISSION_DENIED lines the SDK logs to stderr are the expected assertFails
// denials, not test failures.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ALICE] = ['alice'];
const NOW = () => Date.now();
const PAST = () => NOW() - 3_600_000;
const FUTURE = () => NOW() + 3_600_000;

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const at = (p: string) => `events/${EVENT}/${p}`;

// A well-formed Day Card payload; `cells` shape is not gated by the rules (the
// unlock time + ownership are), so an empty array suffices for the gate test.
const dayCard = (uid: string, dayIndex: number) => ({
  uid,
  dayIndex,
  seed: 1,
  createdAt: NOW(),
  cells: {},
});

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    // Unique per-file projectId so this suite's clearFirestore never races
    // another concurrently-running rules file's seed (same convention as the
    // other rules suites).
    projectId: 'demo-gaycruisebingo-d15-dealing',
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// Each test starts clean with an Event whose `days` array has an unlocked Day 0
// (unlockAt in the past) and a locked Day 1 (unlockAt in the future) — the shape
// the day-scoped Board write gate reads `unlockAt` from.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `events/${EVENT}`), {
      name: 'Cruise',
      status: 'active',
      admins: [],
      settings: {},
      timezone: 'Europe/Rome',
      days: [
        { index: 0, unlockAt: PAST() },
        { index: 1, unlockAt: FUTURE() },
      ],
    });
  });
});

describe('d15-dealing — the deal write is gated by the Day unlock', () => {
  it('DENIES dealing a Day Card before that Day unlockAt (locked Day 1)', async () => {
    await assertFails(setDoc(doc(db(ALICE), at(`days/1/boards/${ALICE}`)), dayCard(ALICE, 1)));
  });

  it('ALLOWS dealing a Day Card at/after unlockAt when the board doc is absent (unlocked Day 0)', async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), at(`days/0/boards/${ALICE}`)), dayCard(ALICE, 0)));
  });
});
