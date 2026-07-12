import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// specs/d15-admin-schedule.md — the Admin Schedule editor's write-time lock
// (#221, daily-cards-spec § "Admin console" / § "Itinerary and schedule"):
// "changing a locked-future Day's theme is safe, changing an already-unlocked
// Day is disallowed." The UI's disabled dropdown (src/components/Admin.tsx)
// is a courtesy — THIS is the guarantee: `firestore.rules`' `daysThemeLockOk`
// denies a direct-SDK write that changes a past/unlocked Day's `days[i].theme`,
// time-gated against a FIXED `request.time` (PAST/FUTURE relative to `NOW()`
// captured once at module load, mirroring d15-firestore-rules.test.ts).
//
// The PERMISSION_DENIED lines the SDK logs to stderr are the expected
// assertFails denials, not test failures.

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'cruise';
const [ADMIN, ALICE] = ['admin-uid', 'alice'];
const NOW = () => Date.now();
const PAST = () => NOW() - 3600_000; // an hour ago — this Day has already unlocked
const FUTURE = () => NOW() + 3600_000; // an hour from now — still locked-future

let testEnv: RulesTestEnvironment;
const db = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const eventDoc = (ctxDb: ReturnType<typeof db>) => doc(ctxDb, 'events', EVENT);

// Day 0 unlocked an hour ago; Day 1 unlocks an hour from now — the same
// PAST/FUTURE two-Day fixture shape as d15-firestore-rules.test.ts.
const seededDays = () => [
  {
    index: 0,
    date: '2026-07-15',
    port: 'Trieste',
    portEmoji: '🇮🇹',
    theme: 'welcome-aboard',
    pool: 'embark',
    tutorial: true,
    unlockAt: PAST(),
  },
  {
    index: 1,
    date: '2026-07-16',
    port: 'Split',
    portEmoji: '🇭🇷',
    theme: 'get-sporty',
    pool: 'main',
    tutorial: false,
    unlockAt: FUTURE(),
  },
];

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    // Unique per-file projectId (like every other w/d15-suite) so this
    // suite's `clearFirestore()` never wipes another concurrently-running
    // file's seed.
    projectId: 'demo-gaycruisebingo-d15-admin-schedule',
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
    await setDoc(doc(s, 'events', EVENT), {
      name: 'Cruise',
      sailStart: '2026-07-15',
      sailEnd: '2026-07-24',
      status: 'active',
      defaultTheme: 'neon-playground',
      claimMode: 'honor',
      admins: [ADMIN],
      timezone: 'Europe/Rome',
      settings: { reportHideThreshold: 4 },
      days: seededDays(),
    });
  });
});

describe('firestore.rules — Admin Schedule editor day-theme lock (specs/d15-admin-schedule.md)', () => {
  it('an Admin CAN change days[i].theme for a Day with a future unlockAt', async () => {
    const days = seededDays();
    days[1] = { ...days[1], theme: 'duty-free' };
    await assertSucceeds(updateDoc(eventDoc(db(ADMIN)), { days }));
  });

  it('an Admin CANNOT change days[i].theme for a Day whose unlockAt has already passed', async () => {
    const days = seededDays();
    days[0] = { ...days[0], theme: 'so-long-farewell' };
    await assertFails(updateDoc(eventDoc(db(ADMIN)), { days }));
  });

  it('a non-admin can never write days[] at all — locked or unlocked Day, any field', async () => {
    const lockedChange = seededDays();
    lockedChange[1] = { ...lockedChange[1], theme: 'duty-free' };
    await assertFails(updateDoc(eventDoc(db(ALICE)), { days: lockedChange }));

    const pastChange = seededDays();
    pastChange[0] = { ...pastChange[0], theme: 'so-long-farewell' };
    await assertFails(updateDoc(eventDoc(db(ALICE)), { days: pastChange }));
  });

  it('an Admin write that leaves days untouched (e.g. claimMode) is unaffected by the lock', async () => {
    await assertSucceeds(updateDoc(eventDoc(db(ADMIN)), { claimMode: 'proof_required' }));
  });
});
