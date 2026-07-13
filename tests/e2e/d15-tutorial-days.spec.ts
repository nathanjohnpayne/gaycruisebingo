// Tutorial Days (daily-cards-spec §§ "Embark (tutorial) view" / "Farewell
// view", specs/d15-tutorial-banners.md). The embark Day shows a "Warm-up" tag
// and a dismissible "How this works" banner over an easy on-ship card; the
// farewell Day shows the ceremonial, non-dismissible goodbye banner. Both deal
// real cards from their curated pools.
import { test, expect } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  seedDailyEvent,
  dismissCoach,
  readDealtDayGrid,
  EMBARK_INDEX,
  FAREWELL_INDEX,
} from './support/daily';
import { joinViaSharedLink } from './support/join';
import { waitForBoardServerConfirmed } from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

test.describe('tutorial days', () => {
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    ({ testEnv } = await seedDailyEvent());
  });
  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('embark: Warm-up tag + "How this works" banner over a dealt card', async ({ page }) => {
    await joinViaSharedLink(page);
    await waitForBoardServerConfirmed(page);
    await dismissCoach(page);

    // The embark chip advertises Warm-up on its own accessible name.
    await expect(page.getByRole('tab').nth(EMBARK_INDEX)).toHaveAttribute(
      'aria-label',
      /Warm-up/i,
    );

    await page.getByRole('tab').nth(EMBARK_INDEX).click();
    // The embark tutorial card deals from the on-ship embark pool.
    const dealt = await readDealtDayGrid(page);
    expect(dealt.filter((t, i) => i !== 12 && t.trim().length > 0).length).toBeGreaterThanOrEqual(20);

    // The "How this works" banner + the board-header Warm-up tag.
    const banner = page.locator('.tutorial-banner-embark');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.tutorial-banner-title')).toHaveText('How this works');
    await expect(page.locator('.board-header .warm-up-tag')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/tutorial-embark.png`, fullPage: true });

    // The banner is dismissible for the session (replayable from More → How to play).
    await banner.getByRole('button', { name: /dismiss/i }).click();
    await expect(banner).toHaveCount(0);
    // The Warm-up tag is NOT part of the banner, so it persists after dismissal.
    await expect(page.locator('.board-header .warm-up-tag')).toBeVisible();
  });

  test('farewell: ceremonial goodbye banner', async ({ page }) => {
    await joinViaSharedLink(page);
    await waitForBoardServerConfirmed(page);
    await dismissCoach(page);

    await page.getByRole('tab').nth(FAREWELL_INDEX).click();
    // The farewell card deals from the curated farewell pool.
    const dealt = await readDealtDayGrid(page);
    expect(dealt.filter((t, i) => i !== 12 && t.trim().length > 0).length).toBeGreaterThanOrEqual(20);

    const farewell = page.locator('.tutorial-banner-farewell');
    await expect(farewell).toBeVisible();
    await expect(farewell).toContainText('Last one');
    // Ceremonial, not a tutorial to dismiss: no dismiss affordance.
    await expect(farewell.getByRole('button')).toHaveCount(0);
    // #260: the farewell chip wears the "Goodbye" tag, not "Warm-up".
    await expect(page.getByRole('tab').nth(FAREWELL_INDEX)).toHaveAttribute('aria-label', /Goodbye/i);
    await page.screenshot({ path: `${SHOTS}/tutorial-farewell.png`, fullPage: true });
  });
});
