import { defineConfig, devices } from '@playwright/test';

// Playwright e2e layer (smoke only for this ticket). The full
// join -> mark -> BINGO -> leaderboard round is x-e2e-happy-path; here we just
// prove `npm run test:e2e` launches the runner in a real browser. No webServer
// is configured yet, so the smoke test drives page content directly; the
// happy-path ticket wires the dev server + baseURL when it needs the app.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
