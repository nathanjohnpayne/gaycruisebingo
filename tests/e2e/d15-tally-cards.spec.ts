// Phase 1.5 verification — Tally Cards (#216, daily-cards-spec § "Tally
// Cards"). Drives the real app + Firebase emulators to prove a bare Mark (no
// proof) surfaces as a live, lighter-weight Tally Card in the Feed — "Name got
// '<prompt>'" plus a day chip — distinct from a photo/audio/text Proof card.
// Also drives the card's tap-to-open-who-list affordance: `ProofFeed.tsx`'s
// Feed-level TallyCard now wires `onOpenWhoList` to a read-only
// `FeedWhoListSheet` built straight off the tally doc's own `markers[]` — no
// Board context needed — so this spec proves the sheet actually opens and
// lists the marker who made the bare Mark.
import { test, expect } from '@playwright/test';
import { seedDailyEvent, dismissCoach, readDealtDayGrid, TODAY_INDEX } from './support/daily';
import { joinViaSharedLink, signedInUid } from './support/join';
import { claimCellByText, waitForBoardServerConfirmed } from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

test.describe('tally cards', () => {
  test('a bare Mark surfaces a live Tally Card in the Feed with a day chip', async ({ page }) => {
    const { testEnv } = await seedDailyEvent();
    try {
      await joinViaSharedLink(page);
      await signedInUid(page);
      await waitForBoardServerConfirmed(page);
      await dismissCoach(page);
      const dealt = await readDealtDayGrid(page);
      const promptText = dealt.find((t, i) => i !== 12 && t.trim().length > 0)!;

      // A bare Mark (tap → 🎖️ Cross My Heart) — no proof media at all.
      await claimCellByText(page, promptText);

      // The Feed renders it as a Tally Card ("Name got '<prompt>'"), not a Proof
      // card: `.tally-card` chrome, the prompt text, and the Day chip
      // ("Day 3 · Get Sporty" — TODAY_INDEX is 0-based index 2).
      await page.getByRole('link', { name: 'Feed' }).click();
      const card = page.locator('.tally-card').filter({ hasText: promptText });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText(`Day ${TODAY_INDEX + 1}`, { exact: false })).toBeVisible();
      // No Proof-card-only chrome (media, report/delete) accompanies the Tally
      // Card — this bare Mark posted no evidence.
      await expect(card.locator('.proof-media')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/tally-card-feed.png`, fullPage: true });

      // Tap-to-open-who-list (#216 acceptance: "Tap opens the who-list sheet"):
      // `TallyCard`'s body button calls `onOpenWhoList?.(card)`, which
      // ProofFeed's default export now wires to `FeedWhoListSheet` — a
      // read-only sheet built straight off the tally doc's own `markers[]`.
      await card.locator('.tally-card-body').click();
      const sheetTitle = page.locator('.sheet-title', { hasText: /^Who marked/ });
      await expect(sheetTitle).toBeVisible({ timeout: 5_000 });
      // The sheet's title names the SAME Prompt the Tally Card is for.
      await expect(sheetTitle).toContainText(promptText);
      // Exactly one marker (this Player, the only one who marked it) lists in
      // the sheet's who-list rows, each with a non-empty attributed name — no
      // Doubt affordance (the Feed who-list is view-only, unlike Board's).
      const sheetRows = page.locator('.sheet .list .row');
      await expect(sheetRows).toHaveCount(1);
      await expect(sheetRows.first().locator('.name')).not.toBeEmpty();
      expect(await page.locator('.sheet .doubt-btn').count()).toBe(0);
      await page.screenshot({ path: `${SHOTS}/tally-card-who-list.png`, fullPage: true });

      // Close dismisses the sheet.
      await page.locator('.sheet-actions .btn', { hasText: 'Close' }).click();
      await expect(sheetTitle).not.toBeVisible();
    } finally {
      await testEnv.cleanup();
    }
  });
});
