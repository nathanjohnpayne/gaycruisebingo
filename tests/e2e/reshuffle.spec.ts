// Phase 1.5 verification — Reshuffle (#378, specs/reshuffle.md). Drives the real
// app + Firebase emulators for the two behaviours the mockup-parity walk cannot
// cover, because that walk deliberately never marks a square and never reloads:
//
//   1. the chip DISAPPEARS the moment a square is marked;
//   2. the launch announcement shows EXACTLY once, surviving a reload.
//
// The chip's live rendering, the confirm sheet's verbatim copy, and the intro's
// three beats are asserted in tests/e2e/d15-mockup-parity.spec.ts alongside the
// other wireframe screens.
//
// The UNMARK half of the escape hatch (unmark everything → the chip returns) is
// proven in src/components/reshuffle-chip.test.tsx, which is where the ticket
// places it. It is deliberately not driven here: e2e has no unmark helper (no
// spec has ever needed one — `claimCellByText` only marks), and building one
// would mean new test infrastructure for a behaviour RTL already covers.
import { test, expect } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { seedDailyEvent, dismissCoach, dismissLaunchIntro, readDealtDayGrid } from './support/daily';
import { joinViaSharedLink, signedInUid } from './support/join';
import { claimCellByText, waitForBoardServerConfirmed } from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

test.describe('reshuffle', () => {
  // ONE fixture for the file, seeded once — the house pattern for a multi-test
  // daily spec (d15-coach-overlay, d15-tutorial-days). Re-seeding per test
  // re-uses the same EVENT_ID against the shared emulator, so the second test's
  // seed races the first's cleanup and the board never confirms (#317's
  // green-standalone / red-as-a-union shape).
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    ({ testEnv } = await seedDailyEvent());
  });

  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('the chip is live on a pristine card and vanishes the moment a square is marked', async ({
    page,
  }) => {
    await joinViaSharedLink(page);
    await signedInUid(page);
    await waitForBoardServerConfirmed(page);
    await dismissCoach(page);

    // Pristine, unlocked, online, nothing spent → the chip offers all three.
    const chip = page.locator('.reshuf');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('×3');
    await page.screenshot({ path: `${SHOTS}/reshuffle-chip-pristine.png`, fullPage: true });

    // One Mark locks the card in. The chip must go — and the rules would deny a
    // forced write anyway (tests/rules/reshuffle.test.ts).
    const dealt = await readDealtDayGrid(page);
    const promptText = dealt.find((t, i) => i !== 12 && t.trim().length > 0)!;
    await claimCellByText(page, promptText);
    await expect(chip).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/reshuffle-chip-absent-after-mark.png`, fullPage: true });
  });

  test('the launch announcement shows exactly once, and never again after a reload', async ({
    page,
  }) => {
    await joinViaSharedLink(page);
    await signedInUid(page);
    await waitForBoardServerConfirmed(page);

    // It is queued BEHIND the coach overlay, so it appears only once that is
    // cleared — never stacked on top of it.
    const intro = page.locator('.launch-intro');
    await expect(intro).toHaveCount(0);
    await page.getByRole('button', { name: /deal me in/i }).click();
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('New today: reshuffles');
    await page.screenshot({ path: `${SHOTS}/reshuffle-launch-intro.png`, fullPage: true });

    await dismissLaunchIntro(page);
    await expect(intro).toHaveCount(0);

    // A reload does NOT re-show it: the dismissal is a localStorage stamp
    // (`gcb.seen.reshuffleIntro`), so it survives exactly as the coach
    // overlay's per-Event flag does.
    await page.reload();
    await waitForBoardServerConfirmed(page);
    await expect(page.locator('.launch-intro')).toHaveCount(0);
    // ...and it is not replayable from anywhere — unlike the coach overlay,
    // which More → How to play can reopen. A launch beat is stale by Day 4.
    await expect(page.getByRole('button', { name: /let's play/i })).toHaveCount(0);
  });
});
