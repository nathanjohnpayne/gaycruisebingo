import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const indexCss = readFileSync(
  fileURLToPath(new URL('../../src/index.css', import.meta.url)),
  'utf8',
);

test('the med-2026 Card title owns one line at the 320px supported minimum', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent(`
    <style>${indexCss}</style>
    <main class="app">
      <div class="card-meta">
        <span>ATLANTIS MED — TRIESTE TO BARCELONA</span>
      </div>
    </main>
  `);

  const metrics = await page.locator('.card-meta').evaluate((row) => {
    const title = row.firstElementChild as HTMLElement | null;
    if (!title) throw new Error('Card title missing');
    return {
      childCount: row.children.length,
      rowScrollWidth: row.scrollWidth,
      rowClientWidth: row.clientWidth,
      titleLineCount: (() => {
        const range = document.createRange();
        range.selectNodeContents(title);
        return range.getClientRects().length;
      })(),
    };
  });

  expect(metrics.childCount).toBe(1);
  expect(metrics.rowScrollWidth).toBeLessThanOrEqual(metrics.rowClientWidth);
  expect(metrics.titleLineCount).toBe(1);
});
