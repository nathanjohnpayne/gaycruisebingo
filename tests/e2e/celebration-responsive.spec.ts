import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const indexCss = readFileSync(
  fileURLToPath(new URL('../../src/index.css', import.meta.url)),
  'utf8',
);

test('the celebration reserves all four device safe-area insets', async ({ page }) => {
  expect(indexCss).toMatch(/env\(safe-area-inset-top/);
  expect(indexCss).toMatch(/env\(safe-area-inset-right/);
  expect(indexCss).toMatch(/env\(safe-area-inset-bottom/);
  expect(indexCss).toMatch(/env\(safe-area-inset-left/);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent(`
    <style>${indexCss}</style>
    <!-- Desktop Chromium resolves env(safe-area-inset-*) to zero. This override
         simulates the resolved asymmetric device insets while exercising the
         same grid/card width constraints in a real layout engine. -->
    <style>.celebrate { padding: 32px 44px 36px 40px; }</style>
    <div class="celebrate">
      <div class="celebrate-card"><div class="big">BLACKOUT</div></div>
    </div>
  `);

  const bounds = await page.locator('.celebrate-card').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(40);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320 - 44);
});

for (const viewport of [
  { width: 420, height: 1203 },
  { width: 320, height: 568 },
]) {
  for (const hero of ['BLACKOUT', 'BINGO!']) {
    test(`${hero} stays centered without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.setContent(`
        <style>${indexCss}</style>
        <div class="celebrate">
          <div class="celebrate-card">
            <div class="big">${hero}</div>
            <p class="muted">You've seen some things.</p>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <button class="btn primary">Share</button>
              <button class="btn">Keep playing</button>
            </div>
          </div>
        </div>
      `);

      const metrics = await page.locator('.celebrate').evaluate((overlay) => {
        const heading = overlay.querySelector<HTMLElement>('.big');
        if (!heading) throw new Error('celebration heading missing');
        const overlayRect = overlay.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        return {
          clientWidth: overlay.clientWidth,
          scrollWidth: overlay.scrollWidth,
          headingLeft: headingRect.left,
          headingRight: headingRect.right,
          centerDelta: Math.abs(
            headingRect.left + headingRect.width / 2 -
              (overlayRect.left + overlayRect.width / 2),
          ),
        };
      });

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.headingLeft).toBeGreaterThanOrEqual(0);
      expect(metrics.headingRight).toBeLessThanOrEqual(viewport.width);
      expect(metrics.centerDelta).toBeLessThanOrEqual(1);
    });
  }
}
