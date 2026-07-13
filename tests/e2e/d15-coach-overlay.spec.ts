// Phase 1.5 verification — chrome-finale sweep, area 2: the first-open coach
// overlay (#214, specs/d15-coach-overlay.md). Once-per-Event scrim decoding
// the Board's badge notation (Tally count, 👀 Doubt, ＋ add proof, free
// space), shown over the Player's first dealt card, dismissible, and
// replayable on demand from More → How to play → Show the badge legend —
// regardless of the stored per-Event dismissal.
import { test, expect } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { seedDailyEvent } from './support/daily';
import { joinViaSharedLink, signedInUid } from './support/join';
import { waitForBoardServerConfirmed } from './support/board';
import { userAttested } from './support/seed';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

test.describe('coach overlay', () => {
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    ({ testEnv } = await seedDailyEvent());
  });
  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('appears once over the first dealt card, decodes the four badges, and stays dismissed across a reload', async ({
    page,
  }) => {
    await joinViaSharedLink(page);
    const uid = await signedInUid(page);
    await waitForBoardServerConfirmed(page);

    // First open: the overlay is up over the dealt card (Board mounts it
    // unconditionally once `cells.length > 0`).
    const overlay = page.locator('.coach-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('How to read your card')).toBeVisible();
    const legendLabels = await overlay.locator('.coach-overlay-label').allTextContents();
    expect(legendLabels).toEqual(['Tally count', '👀 Doubt badge', '＋ Add proof', 'Free space']);
    await page.screenshot({ path: `${SHOTS}/coach-overlay-first-open.png`, fullPage: true });

    // Dismiss via the CTA — the SAME "Got it—deal me in" pledge #246's own
    // day-cards spec also uses to clear the scrim before Day-switcher taps.
    await page.getByRole('button', { name: /deal me in/i }).click();
    await expect(overlay).toHaveCount(0);

    // A reload does NOT re-show it — the dismissal is a per-Event localStorage
    // stamp (`gcb.coachOverlay.{eventId}.dismissedAt`), so it survives the
    // reload the same way an install/theme pick would. Wait for the 18+
    // attestation to be SERVER-CONFIRMED before reloading — `signIn()`
    // persists it via a Firestore transaction that starts only after the
    // signed-in shell already renders (see support/seed.ts's `userAttested`
    // doc comment, and x-e2e-happy-path.spec.ts's identical wait ahead of its
    // own offline reload): reloading before that transaction lands can race
    // it, so the reload here would otherwise land back on the pre-attestation
    // sign-in screen — not a "signed out" bug, just this test outrunning an
    // async write that has nothing to do with the coach overlay itself.
    await expect
      .poll(async () => userAttested(testEnv, uid), { timeout: 15_000 })
      .toBe(true);
    await page.reload();
    await waitForBoardServerConfirmed(page);
    await expect(page.locator('.coach-overlay')).toHaveCount(0);
  });

  test('is replayable on demand from More → How to play, even after the per-Event dismissal', async ({ page }) => {
    await joinViaSharedLink(page);
    await waitForBoardServerConfirmed(page);
    // Dismiss the real first-open overlay first — the replay path must work
    // AFTER dismissal, not just before it.
    await page.getByRole('button', { name: /deal me in/i }).click();
    await expect(page.locator('.coach-overlay')).toHaveCount(0);

    await page.getByRole('link', { name: 'More' }).click();
    await page.getByRole('button', { name: /How to play/ }).click();
    // #270: the row opens the Welcome Aboard walkthrough panel first; the
    // badge-legend replay is one tap further.
    await expect(page.getByText('How this works')).toBeVisible();
    await page.getByRole('button', { name: /Show the badge legend/ }).click();

    const replay = page.locator('.coach-overlay');
    await expect(replay).toBeVisible();
    await expect(replay.getByText('How to read your card')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/coach-overlay-replay.png`, fullPage: true });

    // Dismissing the replay closes it (back to the More menu — CoachOverlay's
    // forceOpen render REPLACES the MorePanel wrapper, so there is no
    // separate "Close" chrome around it here).
    await replay.getByRole('button', { name: /deal me in/i }).click();
    await expect(replay).toHaveCount(0);
  });
});
