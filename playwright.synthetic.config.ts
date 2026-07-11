import { defineConfig, devices } from '@playwright/test';

// Production synthetic uptime config (issue #142). Unlike playwright.config.ts
// — which is emulator-bound (`--mode e2e`, a demo project, a built+previewed
// local app) — this points a headless Chromium at the REAL deployed site and
// asserts the app actually MOUNTS, not merely that Firebase Hosting returns 200
// for the shell. The 2026-07-09 outage (#141) was invisible to any 200-only
// check: the HTML shell and <title> loaded fine (200 OK) and only the client JS
// crashed on init (`auth/invalid-api-key`), leaving a blank page.
//
// There is NO webServer and NO emulator wiring here: the run loads whatever is
// live at SYNTHETIC_URL (the spec reads that env, default the production origin)
// and is load-and-assert only — it never signs in or writes, so it creates no
// Auth / Firestore / Storage side effects on the real project.

export default defineConfig({
  testDir: './tests/synthetic',
  testMatch: '**/*.spec.ts',
  // Per-test budget above navigation (30s) + the mount wait (20s), so a slow but
  // genuinely-rendering cold load never trips Playwright's 30s default test
  // timeout before the mount assertion gets its full window (false outage alert).
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Tolerate a transient network blip against the real site (up to two retries)
  // without becoming a noisy gate — the assertions are stable and high-level.
  retries: 2,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // A real cold load over the public internet: give first paint room, but
    // keep it bounded so a hung load fails rather than hangs forever.
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Append a synthetic marker to the real Chrome UA so the app skips
        // analytics for this load (src/synthetic-probe.ts, #142) without
        // otherwise altering feature detection. Kept in sync with
        // SYNTHETIC_UA_MARKER in that module.
        userAgent: `${devices['Desktop Chrome'].userAgent} GCB-Synthetic`,
      },
    },
  ],
});
