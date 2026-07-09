// x-e2e-happy-path — join -> Mark -> BINGO -> Leaderboard, zero admin action,
// plus the ADR 0006 offline-mark-survives-reload assertion, against the
// Firebase Local Emulator Suite. See specs/x-e2e-happy-path.md for the AC
// mapping and the "Known limitation" this suite currently runs into.
import { test, expect, type Page } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { MIN_POOL } from '../../src/game/logic';
import {
  anyBoardHasMarkedText,
  EVENT_SEED,
  seedEmulatorEvent,
  SEEDED_ACTIVE_PROMPT_COUNT,
} from './support/seed';
import { joinViaSharedLink } from './support/join';
import { LINE_INDICES_EXCLUDING_CENTER, readDealtCellTexts, tapCellByText } from './support/board';

test.describe('x-e2e-happy-path', () => {
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    // >= MIN_POOL (24) active, non-free Prompts so dealBoard never throws the
    // ADR 0004 guard (src/game/logic.ts) — asserted against the same seed
    // this suite writes into the emulator, not a hardcoded literal.
    expect(SEEDED_ACTIVE_PROMPT_COUNT).toBeGreaterThanOrEqual(MIN_POOL);
    testEnv = await seedEmulatorEvent();
  });

  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('join -> Mark -> BINGO -> Leaderboard completes with only the shared link (zero admin action)', async ({
    page,
  }) => {
    // The "shared link" is just the app's one URL (CONTEXT.md: no invite
    // code). Nothing in this test ever visits /admin or touches Admin.tsx.
    await joinViaSharedLink(page);

    // The dealt card is the seeded Event, not a stray/default one — proves
    // the seed this suite wrote is what the Player actually joined.
    await expect(page.locator('.card-meta')).toContainText(EVENT_SEED.name);

    const dealtTexts = await readDealtCellTexts(page);
    // Complete the middle row [10,11,12,13,14] — one of the four lines that
    // runs through the free centre (index 12), so the AC's "centre free space
    // counts" needs only 4 taps, not 5.
    for (const index of LINE_INDICES_EXCLUDING_CENTER) {
      await tapCellByText(page, dealtTexts[index]);
    }

    await expect(page.getByText('BINGO!')).toBeVisible();
    await page.getByRole('button', { name: 'Keep playing' }).click();

    await page.getByRole('link', { name: 'Ranks' }).click();
    const rows = page.locator('.list .row');
    // The sole Player in this dedicated e2e Event, so rank #1 is trivial —
    // the fields comparePlayers actually orders by (bingoCount, squaresMarked,
    // firstBingoAt; src/game/logic.ts) are what this proves end-to-end. The
    // comparator's own multi-Player tie-break ordering is unit-tested at
    // src/game/logic.test.ts; a second real signed-in identity is out of
    // reach for a single-browser-context e2e run.
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.rank')).toHaveText('1');
    await expect(rows.first().locator('.sub')).toContainText('1 bingo');
    await expect(rows.first().locator('.sub')).toContainText(
      `${LINE_INDICES_EXCLUDING_CENTER.length} squares`,
    );
  });

  test('a Mark made offline survives a reload and syncs on reconnect (ADR 0006)', async ({
    page,
    context,
  }) => {
    await joinViaSharedLink(page);
    await readDealtCellTexts(page); // waits for the deal to render (25 cells)

    // Any unmarked, non-free Square — never index CENTER (always-on Free
    // Space, unreachable via toggle()) and never one the happy-path case may
    // already have marked on a shared emulator instance.
    const target = page.locator('.grid .cell:not(.free):not(.marked)').first();
    const targetText = (await target.textContent())?.trim();
    if (!targetText) throw new Error('No unmarked, non-free Square available to Mark offline.');

    // 1. Go offline — a ship-wifi dead zone.
    await context.setOffline(true);

    // 2. Mark it. setMark's commit() never resolves while offline (ADR 0006),
    // but the write lands in the persistent (IndexedDB) cache synchronously
    // via latency compensation, so the UI reflects it at once.
    await tapCellByText(page, targetText);
    await expect(markedCellLocator(page, targetText)).toHaveClass(/marked/);

    // 3. The "reload", still offline and before any sync is even possible:
    // the Mark must survive from the durable local queue, not memory.
    await page.reload();
    await expect(markedCellLocator(page, targetText)).toHaveClass(/marked/);

    // 4. Reconnect — the queued write drains to the emulator.
    await context.setOffline(false);

    // 5. Ground truth via an independent observer (never this tab's own
    // cache): the emulator now has the synced write.
    await expect(async () => {
      expect(await anyBoardHasMarkedText(testEnv, targetText)).toBe(true);
    }).toPass({ timeout: 20_000 });
  });
});

function markedCellLocator(page: Page, text: string) {
  return page.locator('.cell', { hasText: text });
}
