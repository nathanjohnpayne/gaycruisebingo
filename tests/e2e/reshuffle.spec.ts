// Phase 1.5 verification — Reshuffle (#378, specs/reshuffle.md). Drives the real
// app + Firebase emulators for the two behaviours the mockup-parity walk cannot
// cover, because that walk deliberately never marks a square and never reloads:
//
//   1. the chip DISAPPEARS the moment a square is marked, and comes back when the
//      Player unmarks it (the escape hatch, performed through the existing Mark
//      path — there is no removal code of our own);
//   2. the launch announcement shows EXACTLY once, surviving a reload.
//
// The chip's live rendering, the confirm sheet's verbatim copy, and the intro's
// three beats are asserted in tests/e2e/d15-mockup-parity.spec.ts alongside the
// other wireframe screens.
import { test, expect } from '@playwright/test';
import { seedDailyEvent, dismissCoach, dismissLaunchIntro, readDealtDayGrid } from './support/daily';
import { joinViaSharedLink, signedInUid } from './support/join';
import { claimCellByText, waitForBoardServerConfirmed } from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

test.describe('reshuffle', () => {
  test('the chip is live on a pristine card, vanishes on a Mark, and returns on the unmark', async ({
    page,
  }) => {
    const { testEnv } = await seedDailyEvent();
    try {
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

      // The escape hatch: unmarking everything returns the card to pristine
      // through the existing, tested Mark path, and the chip comes back.
      await claimCellByText(page, promptText);
      await expect(chip).toBeVisible();
      await expect(chip).toContainText('×3');
    } finally {
      await testEnv?.cleanup();
    }
  });

  test('the launch announcement shows exactly once, and never again after a reload', async ({
    page,
  }) => {
    const { testEnv } = await seedDailyEvent();
    try {
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
    } finally {
      await testEnv?.cleanup();
    }
  });
});
