// The zero-coordination join path this suite proves: land on the app's one
// URL (the "shared link" — no invite code, no admin-issued token, see
// CONTEXT.md), accept the 18+ acknowledgement, and sign in. Shared by both
// x-e2e-happy-path cases so the join flow is asserted in exactly one place.
import { expect, type Page } from '@playwright/test';

/**
 * Drive the Firebase Auth Emulator's account-chooser popup that
 * `signInWithPopup(auth, googleProvider)` opens once `src/firebase.ts` has
 * connected its `auth` singleton to the Local Emulator Suite (the env-gated
 * `connectAuthEmulator` branch, active for the `demo-` e2e project — see
 * specs/x-e2e-happy-path.md). No real Google OAuth is involved: the emulator
 * widget (node_modules/firebase-tools .../auth/widget_ui.js) lets us add a new
 * auto-generated account and submit it, which resolves the popup and signs the
 * Player in. Selectors are the widget's own stable ids/classes.
 */
async function completeEmulatorSignIn(popup: Page): Promise<void> {
  // "Add new account" can be visible-but-inert for a beat: the widget wires its
  // click handlers in an inline <script> that runs only after an external
  // material-components script loads, so a click that lands before that is a
  // no-op. Retry the toggle until the add-account form (its autogen button)
  // actually appears, then fill a random valid identity and submit.
  const autogen = popup.locator('#autogen-button');
  await expect(async () => {
    if (!(await autogen.isVisible())) await popup.locator('.js-new-account').click();
    await expect(autogen).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await autogen.click(); // fill a random valid identity
  await popup.locator('#sign-in').click(); // submit → popup closes, sign-in resolves
}

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

  // "Continue with Google" calls signInWithPopup against the Auth Emulator, so
  // wait for the popup the click opens, then drive the emulator's widget.
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await completeEmulatorSignIn(await popupPromise);

  // Signed in: App.tsx has moved past <SignIn /> to the signed-in shell (the
  // Primary tab bar). A failure here now means the emulator sign-in did not
  // resolve, not the retired src/firebase.ts wiring gap.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 15000 });
}

/**
 * The signed-in User's uid, read from the Firebase Auth SDK's own IndexedDB
 * persistence (`firebaseLocalStorageDb` / `firebaseLocalStorage`, the
 * `firebase:authUser:*` entry) in the page under test. Each popup sign-in
 * autogenerates a fresh account, so the uid is only knowable at runtime; the
 * offline case needs it to scope its emulator-observer assertion to THIS
 * Player's board (`events/{eventId}/boards/{uid}`) — a Codex P2 on PR #114:
 * an any-board scan could false-pass on a prompt-text collision with the
 * happy-path Player's already-marked board in the same shared Event.
 */
export async function signedInUid(page: Page): Promise<string> {
  const uid = await page.evaluate(async () => {
    const open = indexedDB.open('firebaseLocalStorageDb');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const store = db
        .transaction('firebaseLocalStorage', 'readonly')
        .objectStore('firebaseLocalStorage');
      const rows = await new Promise<Array<{ fbase_key?: string; value?: { uid?: string } }>>(
        (resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result as never);
          req.onerror = () => reject(req.error);
        },
      );
      return rows.find((r) => r.fbase_key?.startsWith('firebase:authUser:'))?.value?.uid ?? '';
    } finally {
      db.close();
    }
  });
  if (!uid) throw new Error('No signed-in Firebase user found in IndexedDB auth persistence.');
  return uid;
}
