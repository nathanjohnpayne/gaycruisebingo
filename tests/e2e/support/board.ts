// Board-reading helpers shared by the x-e2e-happy-path cases. Selects Squares
// by their dealt prompt TEXT (never CSS position / nth-child) so the suite
// survives Board.tsx growing more per-cell chrome (the doubt affordance, tally
// badges) around the same 25-cell grid — see src/components/Board.tsx.
import { expect, type Page } from '@playwright/test';
import { CENTER, LINES } from '../../../src/game/logic';

/** The middle row [10,11,12,13,14] — one of the four lines that runs through
 * the free centre (CENTER = 12), so completing it needs only 4 taps. */
const MIDDLE_ROW = LINES.find((line) => line.includes(CENTER) && line[0] === 10);
if (!MIDDLE_ROW) throw new Error('src/game/logic.ts LINES no longer contains the expected middle row');

/**
 * The 25 dealt prompt texts in cell-index order (0..24), read right after a
 * fresh deal — before any Square is marked — so the `.cell` div's own text is
 * the ONLY content Playwright sees (the proof-button "＋" and the per-Prompt
 * Tally badge both render only once a Square is marked; see Board.tsx).
 */
export async function readDealtCellTexts(page: Page): Promise<string[]> {
  const cells = page.locator('.grid .cell');
  await expect(cells).toHaveCount(25);
  return cells.allTextContents();
}

/** Tap a Square by its dealt prompt text — the exact text a Player reads, and
 * the same text `readDealtCellTexts` returned for this index. */
export async function tapCellByText(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: true }).click();
}

/** The 4 non-free indices of a line through the centre (the free space
 * already counts, per the AC), in cell-index order. */
export const LINE_INDICES_EXCLUDING_CENTER = MIDDLE_ROW.filter((i) => i !== CENTER);
