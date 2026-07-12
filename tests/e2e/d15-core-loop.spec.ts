// Core daily loop (daily-cards-spec § "Day switcher" / "Unlock mechanics"),
// driven against the seeded five-Day event: today's themed Day Card deals from
// its frozen snapshot, switching to another unlocked Day shows a DIFFERENT set
// of squares (each Day is its own day-scoped board), and a locked future Day
// shows the "unlocks" preview and deals nothing.
import { test, expect } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  seedDailyEvent,
  dismissCoach,
  readDealtDayGrid,
  TODAY_INDEX,
  MAIN_A_INDEX,
  LOCKED_INDEX,
} from './support/daily';
import { joinViaSharedLink } from './support/join';
import { waitForBoardServerConfirmed } from './support/board';

const SHOTS = process.env.E2E_SHOT_DIR || 'test-results/shots';

test.describe('daily core loop', () => {
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    ({ testEnv } = await seedDailyEvent());
  });
  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('today deals a themed card; another unlocked Day differs; locked Day previews only', async ({
    page,
  }) => {
    await joinViaSharedLink(page);
    await waitForBoardServerConfirmed(page);
    await dismissCoach(page);

    // Default view = today = the latest unlocked Day (index 2, the get-sporty
    // MAIN Day). The board-area retint carries that Day's theme token.
    await expect(page.getByRole('tab').nth(TODAY_INDEX)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.board-area')).toHaveAttribute('data-theme', 'get-sporty');
    const todayTexts = await readDealtDayGrid(page);
    await page.screenshot({ path: `${SHOTS}/core-today.png`, fullPage: true });

    // Switch to another unlocked MAIN Day (index 1). It deals its OWN card, so
    // the squares differ from today's (both draw the full main pool disjointly).
    await page.getByRole('tab').nth(MAIN_A_INDEX).click();
    const dayATexts = await readDealtDayGrid(page, todayTexts.join('|'));
    expect(dayATexts.join('|')).not.toBe(todayTexts.join('|'));
    // Its theme retint follows the viewed Day.
    await expect(page.locator('.board-area')).toHaveAttribute('data-theme', 'welcome-aboard');

    // The locked future Day (index 4): themed preview, an "unlocks" badge, a
    // blank locked grid, and NO live/markable server-confirmed board.
    await page.getByRole('tab').nth(LOCKED_INDEX).click();
    await expect(page.getByText(/unlocks/i)).toBeVisible();
    await expect(page.locator('.locked-grid')).toBeVisible();
    await expect(page.locator('.grid[data-server-confirmed]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/core-locked.png`, fullPage: true });
  });
});
