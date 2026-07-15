// The zero-coordination join path this suite proves: land on the app's one
// URL (the "shared link" — no invite code, no admin-issued token, see
// CONTEXT.md), accept the 18+ acknowledgement, and sign in. Shared by both
// x-e2e-happy-path cases so the join flow is asserted in exactly one place.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Route } from '@playwright/test';

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
  // #317: "Add new account" is visible-but-inert until the widget's handlers
  // wire up — its inline <script> (node_modules/firebase-tools .../widget_ui.js)
  // sits immediately after a classic, non-async/non-deferred <script src> that
  // fetches material-components-web from a CDN, so the browser blocks on that
  // fetch+execute before running the inline script that actually attaches
  // `.js-new-account`'s click listener — a click before then is a silent
  // no-op. The CDN requests themselves are stubbed out per-context (see
  // stubAuthWidgetCdn below), so the popup's `load` event — which cannot fire
  // until that whole chain has run — is both DETERMINISTIC and fast: wait for
  // it first. (The previous 15s blind-retry budget fired clicks that were
  // no-ops pre-wiring and could still lose the race under load — the single
  // largest contributor to the union suite's mass sign-in failures.) A short
  // retry stays as a safety net for anything unforeseen once handlers are
  // confirmed wired.
  await popup.waitForLoadState('load', { timeout: 30_000 });
  const autogen = popup.locator('#autogen-button');
  await expect(async () => {
    if (!(await autogen.isVisible())) await popup.locator('.js-new-account').click();
    await expect(autogen).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 10_000 });
  await autogen.click(); // fill a random valid identity
  await popup.locator('#sign-in').click(); // submit → popup closes, sign-in resolves
}

// Contexts whose auth-widget CDN stub is already registered — context.route
// registrations stack, so joining twice from one context must not re-add it.
const cdnStubbedContexts = new WeakSet<object>();

// Disk cache for the gapi scripts the sign-in flow REQUIRES (see
// stubAuthWidgetCdn): keyed by URL hash under node_modules/.cache so it
// survives across tests, runs, and contexts, and never enters version control.
const GAPI_CACHE_DIR = path.join(process.cwd(), 'node_modules', '.cache', 'gcb-e2e-gapi');

async function cacheThroughGapi(route: Route): Promise<void> {
  const request = route.request();
  if (request.method() !== 'GET') return route.fallback();
  const url = request.url();
  const key = createHash('sha1').update(url).digest('hex');
  const file = path.join(GAPI_CACHE_DIR, key);
  if (existsSync(file)) {
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(file) });
  }
  const response = await route.fetch(); // real network — first run only
  const body = await response.body();
  if (response.ok()) {
    try {
      mkdirSync(GAPI_CACHE_DIR, { recursive: true });
      writeFileSync(file, body);
    } catch {
      // Cache write is best-effort — worst case the next run re-fetches.
    }
  }
  return route.fulfill({ response });
}

/**
 * Make the Auth Emulator sign-in flow hermetic-after-warm-up (#317). Two
 * distinct external dependencies stall it when the uplink flakes (observed:
 * repeated TLS handshake failures mid-suite left one popup blank-white and
 * another sign-in's popup never even OPENING, 60–120s test timeouts):
 *
 * 1. The account-chooser widget hard-codes BLOCKING <script>/<link> tags to
 *    unpkg.com / fonts.googleapis.com. Purely cosmetic — the widget's inline
 *    handler-wiring script guards every use with `window.mdc &&` — so those
 *    are fulfilled with empty 200s outright.
 * 2. The emulator's auth relay iframe (firebase-tools handlers.js) REQUIRES
 *    real gapi (`apis.google.com/js/api.js` + the modules gapi.load pulls in)
 *    to deliver the auth event back to the app — signInWithPopup cannot even
 *    open its popup until that iframe initializes, and an empty stub would
 *    break sign-in outright (the emulator itself alerts "check your Internet
 *    connection" on gapi timeout). Those are served through a disk cache:
 *    fetched from the network once ever, then replayed locally forever after.
 */
async function stubAuthWidgetCdn(page: Page): Promise<void> {
  const ctx = page.context();
  if (cdnStubbedContexts.has(ctx)) return;
  cdnStubbedContexts.add(ctx);
  await ctx.route(/^https:\/\/(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' }),
  );
  await ctx.route(/^https:\/\/(apis\.google\.com|www\.gstatic\.com)\//, cacheThroughGapi);
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
  await stubAuthWidgetCdn(page); // popups inherit the context's routes
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
