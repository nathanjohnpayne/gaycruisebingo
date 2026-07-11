import { test, expect } from '@playwright/test';

// Production synthetic (issue #142): assert the DEPLOYED app actually mounts and
// renders its root — the signal a Hosting-200 check misses. It would have FAILED
// during the 2026-07-09 outage (#141), where the shell returned 200 but the
// client JS threw `auth/invalid-api-key` on init and painted a blank page.
//
// Two assertions, both high-level and flake-resistant:
//   1. The signed-out root renders — the `GAY CRUISE BINGO` heading is the
//      SignIn gate App shows on `!user` (src/components/SignIn.tsx). Its presence
//      proves React mounted AND Firebase init did not throw before first paint.
//   2. No Firebase init error (`auth/invalid-api-key` et al.) and no uncaught
//      exception reached the console during load.
//
// Load-and-assert only: it never signs in or writes, so it creates no Auth /
// Firestore / Storage side effects on the real project.

// Firebase config/init failures that manifest as a blank page. `auth/invalid-api-key`
// is the exact #141 signature; the alternates are the same class (bad/rotated
// key, wrong project, init failure) that also crash the client before first paint.
const FIREBASE_INIT_ERROR = /auth\/invalid-api-key|invalid-api-key|Firebase:[^]*\(auth\/|Failed to initialize Firebase/i;

// The target origin. Navigate to the FULL url rather than `page.goto('/')`,
// which always resolves to the origin root and would silently drop any path in
// a `SYNTHETIC_URL` like https://host/app/. Mirrors the config default.
const SYNTHETIC_URL = process.env.SYNTHETIC_URL ?? 'https://gaycruisebingo.com/';

test('the deployed app mounts and renders its root', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.goto(SYNTHETIC_URL, { waitUntil: 'domcontentloaded' });

  // Mount signal: the SignIn gate heading. A generous window so a slow-but-
  // working cold load still passes; a crashed/blank app never renders it. Errors
  // keep accumulating in the listeners above during this wait, so a crash-on-init
  // is reported by the precise assertions below rather than a bare timeout.
  const rendered = await page
    .getByRole('heading', { name: 'GAY CRUISE BINGO' })
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  // 1. No Firebase init crash (`auth/invalid-api-key` et al.) — asserted first so
  //    the #141 class produces its precise signature, not a generic mount timeout.
  const firebaseInitErrors = [...consoleErrors, ...pageErrors].filter((m) => FIREBASE_INIT_ERROR.test(m));
  expect(
    firebaseInitErrors,
    `Firebase init error(s) detected during load: ${firebaseInitErrors.join(' | ')}`,
  ).toEqual([]);

  // 2. No uncaught exception at all during load. The app is designed to surface
  //    failures through UI state, never an unhandled throw, so any pageerror is a
  //    real regression.
  expect(pageErrors, `uncaught exception(s) during load: ${pageErrors.join(' | ')}`).toEqual([]);

  // 3. The root actually rendered — the generic "did not mount" signal that
  //    catches a blank page even when nothing threw.
  expect(
    rendered,
    'the GAY CRUISE BINGO root heading never rendered — the app did not mount (blank page)',
  ).toBe(true);
});
