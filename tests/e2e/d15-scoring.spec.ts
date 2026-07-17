// Scoring across Days (daily-cards-spec § "Scoring and social surfaces",
// "Resolved decisions" #2). Proves, end to end on the real UI:
//  - per-Day `dayStats` are correct and DO NOT inflate when switching Day tabs,
//  - the cruise-wide root aggregates are the sum of the per-Day buckets,
//  - a per-Day First to BINGO honor pins on EVERY Day (tutorial Days included),
//  - the cruise-wide First to BINGO EXCLUDES tutorial Days (the root
//    `firstBingoAt` tracks the MAIN-day bingo even though the tutorial-day bingo
//    happened earlier).
import { test, expect, type Page } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  seedDailyEvent,
  dismissCoach,
  readDealtDayGrid,
  readPlayer,
  EMBARK_INDEX,
  MAIN_A_INDEX,
  TODAY_INDEX,
} from './support/daily';
import { joinViaSharedLink, signedInUid } from './support/join';
import { userAttested } from './support/seed';
import {
  LINE_INDICES_EXCLUDING_CENTER,
  claimCellByText,
  waitForBoardServerConfirmed,
} from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

async function closeCelebration(page: Page): Promise<void> {
  const keep = page.getByRole('button', { name: 'Keep playing' });
  if (await keep.isVisible().catch(() => false)) await keep.click();
}

/** Open a Day tab, wait for its own dealt card, and return its cell texts. */
async function openDay(page: Page, index: number, differsFrom?: string): Promise<string[]> {
  await page.getByRole('tab').nth(index).click();
  return readDealtDayGrid(page, differsFrom);
}

/** Complete a BINGO on the currently-viewed Day via its middle row. */
async function bingoMiddleRow(page: Page, texts: string[]): Promise<void> {
  for (const index of LINE_INDICES_EXCLUDING_CENTER) {
    await claimCellByText(page, texts[index]);
  }
  await expect(page.locator('.big', { hasText: 'BINGO!' })).toBeVisible();
  await closeCelebration(page);
}

/** Mark N non-free, non-line squares WITHOUT completing a line. */
async function markSome(page: Page, texts: string[], n: number): Promise<number> {
  const line = new Set(LINE_INDICES_EXCLUDING_CENTER);
  const targets = texts
    .map((_, i) => i)
    .filter((i) => i !== 12 && !line.has(i))
    .slice(0, n);
  for (const i of targets) await claimCellByText(page, texts[i]);
  return targets.length;
}

test.describe('daily scoring', () => {
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    ({ testEnv } = await seedDailyEvent());
  });
  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('dayStats do not inflate on tab switch; honors pin per-Day; cruise-wide excludes tutorial', async ({
    page,
    context,
  }) => {
    // 11 sequential marks across 3 Days, each chained per-uid through
    // src/data/api.ts's markChains, then two generous poll windows below —
    // comfortably over the 30s default given the local emulator's write
    // latency under this suite's serial single-worker full run.
    test.setTimeout(90_000);
    await joinViaSharedLink(page);
    const uid = await signedInUid(page);
    await waitForBoardServerConfirmed(page);
    await dismissCoach(page);
    const todayTexts = await readDealtDayGrid(page);

    // Mark 3 non-winning squares on today (Day 2, MAIN).
    const markedToday = await markSome(page, todayTexts, 3);
    expect(markedToday).toBe(3);

    // BINGO on the EMBARK tutorial Day (index 0) FIRST — the earliest bingo.
    const embarkTexts = await openDay(page, EMBARK_INDEX, todayTexts.join('|'));
    await bingoMiddleRow(page, embarkTexts);

    // BINGO on a MAIN Day (index 1) SECOND — later than the tutorial bingo.
    const mainTexts = await openDay(page, MAIN_A_INDEX, embarkTexts.join('|'));
    await bingoMiddleRow(page, mainTexts);

    // Bounce across tabs — the classic inflation trap (the pre-#246 shared board
    // summed one card's marks into every Day). Re-open each Day; no new marks.
    await openDay(page, TODAY_INDEX, mainTexts.join('|'));
    await openDay(page, EMBARK_INDEX, todayTexts.join('|'));
    await openDay(page, MAIN_A_INDEX, embarkTexts.join('|'));

    const lineLen = LINE_INDICES_EXCLUDING_CENTER.length; // 4

    await expect(async () => {
      const p = await readPlayer(testEnv, uid);
      // Per-Day buckets are exactly what each Day earned — no cross-Day bleed.
      expect(p.dayStats?.['2']?.squaresMarked).toBe(3); // today: 3 marks, no bingo
      expect(p.dayStats?.['2']?.bingoCount ?? 0).toBe(0);
      expect(p.dayStats?.['0']?.squaresMarked).toBe(lineLen); // embark: 4-square line
      expect(p.dayStats?.['0']?.bingoCount).toBe(1);
      expect(p.dayStats?.['1']?.squaresMarked).toBe(lineLen); // main A: 4-square line
      expect(p.dayStats?.['1']?.bingoCount).toBe(1);

      // Cruise-wide roots are the SUM of the buckets, NOT inflated by tab bounces.
      expect(p.squaresMarked).toBe(3 + lineLen + lineLen); // 11
      expect(p.bingoCount).toBe(2);

      // Cruise-wide First to BINGO EXCLUDES the tutorial Day: the root
      // `firstBingoAt` equals the MAIN-day bingo time (later), NOT the earlier
      // embark-tutorial bingo.
      const embarkFirst = p.dayStats?.['0']?.firstBingoAt ?? null;
      const mainFirst = p.dayStats?.['1']?.firstBingoAt ?? null;
      expect(embarkFirst).not.toBeNull();
      expect(mainFirst).not.toBeNull();
      expect(embarkFirst! < mainFirst!).toBe(true); // tutorial bingo happened first
      expect(p.firstBingoAt).toBe(mainFirst); // …but the cruise honor is the MAIN one
      expect(p.firstBingoAt).not.toBe(embarkFirst);
      // 11 marks (3 + two 4-square lines) all landed above BEFORE this poll
      // started, chained sequentially per-uid (src/data/api.ts's markChains) —
      // a generous timeout gives that whole chain room to drain under a busy
      // shared emulator, without weakening what is asserted.
    }).toPass({ timeout: 40_000 });

    // The Leaderboard's "Daily First to BINGO" strip: since #264, a daily event
    // renders one chip for EVERY seeded Day, in Day order — "—" until someone
    // bingoes that Day — labeled "<emoji> D<n>" (Leaderboard.tsx dayChipLabel).
    // Tutorial Days included: their exclusion is ONLY cruise-wide.
    //
    // Read the Ranks view from a FRESH PAGE in the same context — the same
    // origin storage, so the SAME signed-in Player (no second join) — never by
    // re-navigating this test's own long-lived page: late in a full-suite run
    // that page's Firestore channel can stall serving a brand-new collection
    // listen, leaving the Leaderboard behind its loading gate indefinitely
    // (#317's "loading gate never clears" shape), and no in-page recovery
    // unsticks it. A new page gets a fresh renderer and Firestore client
    // while keeping the Player's auth; retried because the first load can
    // still race the emulator under end-of-run load.
    //
    // The cold load discards in-memory state, so the 18+ attestation must be
    // SERVER-confirmed first — `signIn()` persists it via a Firestore
    // transaction that starts only after the signed-in shell renders, and a
    // load that outruns it lands on the #23 re-prompt gate instead of the app
    // (the same documented wait d15-coach-overlay.spec.ts and
    // x-e2e-happy-path.spec.ts take before their own reloads).
    //
    // This cold load is ALSO the regression probe for the Avatar crash this
    // suite exposed (#317): the persistent cache can replay a transiently
    // identity-less Player row (dealDayCard's dayStats seed racing
    // joinAndDeal's identity merge) as the fresh page's first roster
    // snapshot, and `Avatar` used to throw on the missing displayName —
    // unmounting the whole app into a blank page on every reload.
    await expect.poll(async () => userAttested(testEnv, uid), { timeout: 15_000 }).toBe(true);
    const lbPage = await context.newPage();
    await expect(async () => {
      await lbPage.goto('/leaderboard', { timeout: 15_000 });
      await expect(lbPage.locator('.lb-filters')).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    const honors = lbPage.locator('.lb-honors .lb-honor');
    await expect(honors).toHaveCount(5, { timeout: 15_000 }); // one chip per seeded Day
    const honorDays = await lbPage.locator('.lb-honors .lb-honor-day').allTextContents();
    expect(honorDays[0]).toMatch(/D1$/); // embark (dayIndex 0)
    expect(honorDays[1]).toMatch(/D2$/); // main A (dayIndex 1)
    // Days 0 (embark, tutorial) and 1 (main A) both pin THIS Player's honor;
    // the un-bingoed Days (today, farewell, locked) stay unclaimed ("—").
    // Retried as one unit: the names resolve from the day-meta pins (or the
    // roster-derived fallback once `dayMetasLoaded`), which can land a beat
    // after the strip itself first renders.
    await expect(async () => {
      const honorNames = await lbPage.locator('.lb-honors .lb-honor-name').allTextContents();
      expect(honorNames).toHaveLength(5);
      expect(honorNames[0]).not.toBe('—');
      expect(honorNames[1]).not.toBe('—');
      expect(honorNames[0]).toBe(honorNames[1]); // the same sole Player
      expect(honorNames.slice(2)).toEqual(['—', '—', '—']);
    }).toPass({ timeout: 15_000 });
    await lbPage.screenshot({ path: `${SHOTS}/scoring-honors.png`, fullPage: true });
    await lbPage.close();
  });
});
