// Phase 1.5 verification — Tally Cards (#216, daily-cards-spec § "Tally
// Cards"). Drives the real app + Firebase emulators to prove a bare Mark (no
// proof) surfaces as a live, lighter-weight Tally Card in the Feed — "Name got
// '<prompt>'" plus a day chip — distinct from a photo/audio/text Proof card.
// Also drives the card's tap-to-open-who-list affordance and records exactly
// what happens: `ProofFeed.tsx`'s own doc comment on the Feed-level TallyCard
// render says wiring `onOpenWhoList` from the Feed tab is still "the spec's
// follow-up", so this spec pins that as a KNOWN, DOCUMENTED gap rather than
// silently asserting behavior the source itself says is not there yet.
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

      // Tap-to-open-who-list: `TallyCard`'s body button calls
      // `onOpenWhoList?.(card)` (src/components/ProofFeed.tsx). Record whether a
      // who-list sheet actually opens rather than asserting either way blindly —
      // ProofFeed's default export wires the Feed-level TallyCard with NO
      // `onOpenWhoList` prop (only `card`, `action={null}`, `days`), so this tap
      // is currently a structural no-op from the Feed tab. The verification
      // report reads this line.
      await card.locator('.tally-card-body').click();
      const whoListOpened = await page
        .locator('.sheet-title', { hasText: /^Who marked/ })
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      console.log(`[tally-card-feed-tap] who-list sheet opened from Feed tap = ${whoListOpened}`);
      expect(whoListOpened).toBe(false); // pins the documented gap — see file header
    } finally {
      await testEnv.cleanup();
    }
  });
});
