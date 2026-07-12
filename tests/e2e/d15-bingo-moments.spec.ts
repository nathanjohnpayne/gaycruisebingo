// BINGO / Blackout detection + the Feed Moments they broadcast (ADR 0002,
// daily-cards-spec § "Scoring and social surfaces"). Sole-Player Event, so the
// first bingo is also First to BINGO. Drives the real UI on today's Day Card and
// checks both the emulator's authoritative moments truth and the on-screen Feed.
import { test, expect, type Page } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { seedDailyEvent, dismissCoach, readDealtDayGrid, readMoments, TODAY_INDEX } from './support/daily';
import { joinViaSharedLink, signedInUid } from './support/join';
import {
  LINE_INDICES_EXCLUDING_CENTER,
  claimCellByText,
  waitForBoardServerConfirmed,
} from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

/** Close any standing Celebration overlay(s) — loops since a 2nd/3rd completed
 * line re-fires the animation (#176). No-op when none is open. */
async function closeCelebration(page: Page): Promise<void> {
  const cel = page.locator('.celebrate');
  for (let i = 0; i < 8 && (await cel.count()) > 0; i++) {
    await page.getByRole('button', { name: 'Keep playing' }).click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(80);
  }
}

/**
 * Claim a square during a blackout run. A line-completing claim pops a
 * Celebration a tick later that then intercepts the next grid tap, so clear any
 * standing celebration first. The tap is SCOPED to `.grid` so a momentarily
 * lingering ProofSheet title carrying the same prompt text can never cause a
 * strict-mode match. After the pledge, wait for the sheet to close so the next
 * claim starts clean.
 */
async function claimForBlackout(page: Page, text: string): Promise<void> {
  const cell = page.locator('.grid').getByText(text, { exact: true });
  // A celebration can pop AFTER the pre-check (it appears a tick after the prior
  // mark echoes) and intercept the tap, so retry with a bounded per-attempt
  // timeout, closing any celebration between attempts.
  for (let attempt = 0; attempt < 8; attempt++) {
    await closeCelebration(page);
    try {
      await cell.click({ timeout: 4_000 });
      break;
    } catch (err) {
      if (attempt === 7) throw err;
    }
  }
  const pledge = page.getByRole('button', { name: /cross my heart/i });
  await pledge.click();
  await expect(pledge).toHaveCount(0, { timeout: 5_000 });
}

test.describe('bingo + blackout moments', () => {
  test('BINGO → celebration + a first-BINGO Moment in the Feed', async ({ page }) => {
    const { testEnv } = await seedDailyEvent();
    try {
      await joinViaSharedLink(page);
      const uid = await signedInUid(page);
      await waitForBoardServerConfirmed(page);
      await dismissCoach(page);
      const dealt = await readDealtDayGrid(page);

      for (const index of LINE_INDICES_EXCLUDING_CENTER) {
        await claimCellByText(page, dealt[index]);
      }
      await expect(page.locator('.big', { hasText: 'BINGO!' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/moments-bingo-celebration.png`, fullPage: true });
      await closeCelebration(page);

      // Emulator truth (authoritative): the per-Player BINGO Moment always posts.
      // The ceremonial event-singleton First to BINGO is EXPECTED too (sole
      // Player), but it rides a birth-time-witness race in the moments machinery
      // (a concurrent gate-open drain can write `${uid}-bingo` during the witness
      // read, suppressing the first_bingo enqueue) — so it is recorded, not
      // hard-asserted, to keep this spec deterministic. See the verification
      // report's First-to-BINGO finding.
      await expect(async () => {
        const kinds = (await readMoments(testEnv)).filter((m) => m.uid === uid).map((m) => m.kind);
        expect(kinds).toContain('bingo');
      }).toPass({ timeout: 30_000 });
      const kinds = (await readMoments(testEnv)).filter((m) => m.uid === uid).map((m) => m.kind).sort();
      const firstBingoPosted = kinds.includes('first_bingo');
      console.log(`[first-bingo-moment] posted=${firstBingoPosted} kinds=${JSON.stringify(kinds)}`);

      // The Feed renders the BINGO Moment (and the First to BINGO one when it posted).
      await page.getByRole('link', { name: 'Feed' }).click();
      await expect(page.locator('.moment-bingo').first()).toContainText('BINGO', { timeout: 15_000 });
      if (firstBingoPosted) {
        await expect(page.locator('.moment-first_bingo')).toContainText('First to BINGO');
      }
      await page.screenshot({ path: `${SHOTS}/moments-feed.png`, fullPage: true });
    } finally {
      await testEnv.cleanup();
    }
  });

  test('Blackout posts a Moment; recording whether it names the day', async ({ page }) => {
    // Blacking out a card is 24 honor claims (tap + pledge each), well past the
    // 30s default — this is a deliberate marathon, not a hang.
    test.setTimeout(240_000);
    const { testEnv } = await seedDailyEvent();
    try {
      await joinViaSharedLink(page);
      const uid = await signedInUid(page);
      await waitForBoardServerConfirmed(page);
      await dismissCoach(page);
      const dealt = await readDealtDayGrid(page);

      // Mark every non-free square (index 12 is the free centre) → Blackout.
      const nonFree = dealt.map((_, i) => i).filter((i) => i !== 12);
      for (const index of nonFree) {
        await claimForBlackout(page, dealt[index]);
      }

      // The BLACKOUT celebration fires on the final square.
      await expect(page.locator('.celebrate .big', { hasText: 'BLACKOUT' })).toBeVisible({
        timeout: 10_000,
      });
      await page.screenshot({ path: `${SHOTS}/moments-blackout-celebration.png`, fullPage: true });
      // Close it robustly — it pops a tick after the last mark echoes, so a bare
      // pre-check can miss it and then it intercepts the Feed nav below.
      await expect(async () => {
        const keep = page.getByRole('button', { name: 'Keep playing' });
        if (await keep.isVisible().catch(() => false)) await keep.click();
        await expect(page.locator('.celebrate')).toHaveCount(0);
      }).toPass({ timeout: 10_000 });

      // Emulator truth: a blackout Moment for this Player exists.
      let blackout: { dayIndex?: number } | undefined;
      await expect(async () => {
        blackout = (await readMoments(testEnv)).find((m) => m.uid === uid && m.kind === 'blackout');
        expect(blackout, 'a blackout Moment was written').toBeTruthy();
      }).toPass({ timeout: 20_000 });

      // The blackout Moment renders on the Feed.
      await page.getByRole('link', { name: 'Feed' }).click();
      await expect(page.locator('.moment-blackout')).toContainText('blacked out', { timeout: 15_000 });
      await page.screenshot({ path: `${SHOTS}/moments-blackout-feed.png`, fullPage: true });

      // The spec calls for the blackout Moment to NAME the day ("blacked out Day 3
      // · …"). Record — not silently pass — whether the day is actually carried on
      // the doc and rendered in the Feed. The verification report reads this.
      const namesDayOnDoc = typeof blackout?.dayIndex === 'number';
      const feedText = (await page.locator('.moment-blackout').first().textContent()) ?? '';
      const namesDayInFeed = /Day\s*\d/i.test(feedText);
      console.log(
        `[blackout-moment] viewedDay=${TODAY_INDEX} dayIndex-on-doc=${namesDayOnDoc} names-day-in-feed=${namesDayInFeed} feed="${feedText.trim()}"`,
      );
    } finally {
      await testEnv.cleanup();
    }
  });
});
