import { test, expect } from '@playwright/test';

// e2e harness smoke test. Proves `npm run test:e2e` launches the Playwright
// runner in a real Chromium browser and can drive + assert on a page. It uses
// setContent instead of a served app URL so the harness layer is self-contained
// (no dev server needed); x-e2e-happy-path adds the real join -> BINGO flow.
test('Playwright runner launches Chromium and asserts on a page', async ({ page }) => {
  await page.setContent('<main><h1 data-testid="banner">Gay Cruise Bingo</h1></main>');
  await expect(page.getByTestId('banner')).toHaveText('Gay Cruise Bingo');
});
