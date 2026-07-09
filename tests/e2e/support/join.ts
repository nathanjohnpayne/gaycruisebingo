// The zero-coordination join path this suite proves: land on the app's one
// URL (the "shared link" — no invite code, no admin-issued token, see
// CONTEXT.md), accept the 18+ acknowledgement, and sign in. Shared by both
// x-e2e-happy-path cases so the join flow is asserted in exactly one place.
import { expect, type Page } from '@playwright/test';

/**
 * KNOWN LIMITATION (see specs/x-e2e-happy-path.md "Known limitation"): this
 * drives the REAL "Continue with Google" control, which calls
 * `signInWithPopup(auth, googleProvider)` against the `auth` singleton
 * `src/firebase.ts` exports. That module has no emulator branch — no
 * `connectAuthEmulator` / `connectFirestoreEmulator` call exists anywhere in
 * `src/**`, and `src/firebase.test.ts` pins the config as production-only
 * ("ADR 0006 source guard ... firebase.ts runs getAuth(app) at import").
 * `src/**` is off-limits to this ticket (it proves behavior, it does not
 * change it), so there is no code path in this checkout that points the
 * browser's Firebase client at the Local Emulator Suite this suite seeds.
 * The assertion below is expected to fail here for that reason, with this
 * message — not a Playwright timeout — as the diagnostic. It is written as
 * the real join a Player takes so it starts passing the moment a future
 * ticket adds the emulator branch to `src/firebase.ts`, with no rewrite.
 */
const EMULATOR_WIRING_GAP =
  'App did not leave the sign-in screen after "Continue with Google". ' +
  'This exercises a REAL Firebase Auth Emulator sign-in, which needs ' +
  'src/firebase.ts to connect its `auth`/`db` singletons to the Local ' +
  'Emulator Suite (connectAuthEmulator/connectFirestoreEmulator) when ' +
  'VITE_FIREBASE_PROJECT_ID is the demo- e2e project. That wiring does not ' +
  'exist yet (src/firebase.ts is production-only by source-level design, ' +
  'guarded by src/firebase.test.ts) and src/** is out of this ticket\'s file ' +
  'boundaries. See specs/x-e2e-happy-path.md "Known limitation".';

/** Best-effort dismiss of the analytics disclosure banner — it never blocks
 * the sign-in control, but clearing it keeps the viewport tidy for later
 * taps on small/short viewports. */
async function dismissConsentNotice(page: Page): Promise<void> {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) {
    await gotIt.click();
  }
}

/**
 * Land on the shared link, accept the 18+ acknowledgement, and sign in —
 * the ONLY path into the app (no admin action anywhere, PRD's headline
 * zero-coordination metric). Resolves once the signed-in shell (the
 * Primary tab bar) renders, i.e. `App.tsx` has moved past `<SignIn />`.
 */
export async function joinViaSharedLink(page: Page): Promise<void> {
  await page.goto('/');
  await dismissConsentNotice(page);

  await expect(page.getByRole('heading', { name: 'GAY CRUISE BINGO' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  await expect(
    page.getByRole('navigation', { name: 'Primary' }),
    EMULATOR_WIRING_GAP,
  ).toBeVisible({ timeout: 15000 });
}
