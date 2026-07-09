// Emulator seeding for the x-e2e-happy-path suite. Adapts (does not edit —
// scripts/seed.mjs is off-limits, "invoke it, do not edit") the Admin-SDK
// seed script's own payload builders so the Event + prompt pool this suite
// deals boards from is byte-identical in shape to what a real operator seed
// would write. `firebase-admin` is deliberately NOT an app/e2e dependency
// (see scripts/seed.mjs's own header comment), so this uses the
// `@firebase/rules-unit-testing` devDependency the tests/rules/ layer already
// relies on — its `withSecurityRulesDisabled` context is the same
// rules-bypassing write path an Admin SDK gets, without adding a dependency.
import { createHash } from 'node:crypto';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, deleteField, getDocs, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — scripts/seed.mjs is a plain-JS node script with no type
// declarations (tsconfig sets no allowJs, and only includes src/ besides).
// It is side-effect-free to import: seeding only runs when the script is the
// entry module (see its own `import.meta.url === ...` guard). Mirrors the
// same import src/test/w1-event-seed.test.ts already uses against Vitest.
import { EVENT_SEED, ITEMS, adminRoster, eventWritePayload } from '../../../scripts/seed.mjs';
import { EVENT_ID, FIRESTORE_HOST, FIRESTORE_PORT, PROJECT_ID } from './env';

const RULES_PATH = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));

/**
 * A dense pool needs >= MIN_POOL (24, src/game/logic.ts) active, non-free
 * Prompts so `dealBoard` never throws (ADR 0004 guard). scripts/seed.mjs's
 * own ITEMS list is 32 strong — reused verbatim rather than re-declaring a
 * parallel fixture, so this suite seeds the exact real pool shape.
 */
export const SEEDED_ACTIVE_PROMPT_COUNT = ITEMS.length;

/** Same content-hash id scheme as scripts/seed.mjs, so a re-run upserts the same docs. */
function itemDocId(text: string): string {
  return `seed-${createHash('sha1').update(text).digest('hex').slice(0, 20)}`;
}

/**
 * Boots a rules-test environment against the already-running Firestore
 * emulator (started by playwright.config.ts's `webServer`, mirroring
 * `npm run emulator`'s `--only auth,firestore,storage`) and writes the
 * Event doc + full ITEMS pool with security rules disabled — the same
 * rules-bypassing posture `scripts/seed.mjs` gets from the Admin SDK.
 * Caller owns `testEnv.cleanup()`.
 */
export async function seedEmulatorEvent(): Promise<RulesTestEnvironment> {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const eventRef = doc(db, 'events', EVENT_ID);
    const batch = writeBatch(db);
    // No ADMIN_UID roster: this ticket asserts the zero-admin-action path, so
    // the seed intentionally leaves `admins` empty (eventWritePayload omits
    // the key entirely — see scripts/seed.mjs).
    batch.set(eventRef, eventWritePayload(adminRoster(''), deleteField()), { merge: true });
    const now = Date.now();
    for (const text of ITEMS) {
      const itemRef = doc(db, 'events', EVENT_ID, 'items', itemDocId(text));
      batch.set(
        itemRef,
        {
          text,
          createdBy: 'seed',
          createdAt: now,
          isFreeSpace: false,
          status: 'active',
          reportCount: 0,
        },
        { merge: true },
      );
    }
    await batch.commit();
  });

  return testEnv;
}

/**
 * Ground truth for the ADR 0006 sync assertion: reads `events/{EVENT_ID}/boards`
 * straight from the emulator (rules disabled, so this never depends on which
 * uid the browser's own popup sign-in resolved to) and reports whether ANY
 * Board has `text` marked. An INDEPENDENT read path from the page under
 * test — never the reloaded tab's own cache — mirrors the observer pattern in
 * tests/offline/w0-offline-persistence.test.ts.
 */
export async function anyBoardHasMarkedText(
  testEnv: RulesTestEnvironment,
  text: string,
): Promise<boolean> {
  // `withSecurityRulesDisabled` is typed `(cb) => Promise<void>` and DISCARDS the
  // callback's return value, so the result must be captured in this outer scope
  // — `return testEnv.withSecurityRulesDisabled(async () => …)` would always
  // resolve to `undefined`. (tsconfig typechecks only src/, so tsc never flags
  // it, and Playwright strips types without checking.)
  let found = false;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const snap = await getDocs(collection(db, 'events', EVENT_ID, 'boards'));
    found = snap.docs.some((d) => {
      const cells = (d.data() as { cells?: Array<{ text: string; marked: boolean }> }).cells ?? [];
      return cells.some((c) => c.text === text && c.marked === true);
    });
  });
  return found;
}

// Re-exported so the spec can assert the payload it just wrote matches the
// real operator seed (name, claimMode, etc.) without re-importing seed.mjs.
export { EVENT_SEED };
