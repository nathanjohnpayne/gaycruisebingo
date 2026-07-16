import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import { isSyntheticProbe } from './synthetic-probe';
import { resolveAuthDomain } from './auth-domain';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, window.location.hostname),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// ADR 0006: a persistent (IndexedDB) local cache so the last-seen Board/Feed/
// Tally render offline and Marks made in a dead zone queue durably and sync on
// reconnect — not the default in-memory cache, which loses queued writes on
// reload. The multi-tab manager coordinates the shared cache when a Player has
// the PWA open in several tabs. Same `db` symbol, so no call site changes.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

// Local Emulator Suite wiring for the Playwright e2e layer
// (specs/x-e2e-happy-path.md). The suite serves a `vite build --mode e2e` +
// `vite preview` of the app rather than `vite dev`, because the ADR 0006
// offline case reloads the page while offline and can only be served by the
// precaching service worker vite-plugin-pwa emits for a build (never for
// `vite dev`). So this gate keys off `import.meta.env.MODE === 'e2e'`, NOT
// `import.meta.env.DEV` (which is `false` in ANY build). `MODE` is a built-in
// Vite env var statically substituted at build time, so the real production
// build (`npm run build`, `MODE === 'production'`) folds this to
// `'production' === 'e2e'` → `false` and dead-code-eliminates the whole branch —
// the shipped bundle carries no emulator import or host string (verified by the
// dist/ grep in specs/x-e2e-happy-path.md's Testing section). The `demo-`
// project-id check is belt-and-suspenders (the same emulator-only convention
// tests/offline and tests/rules use). Ports mirror firebase.json's `emulators`
// block (auth 9099, firestore 8080, storage 9199) and tests/e2e/support/env.ts.
if (import.meta.env.MODE === 'e2e' && import.meta.env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// App Check (abuse protection). No-op unless a reCAPTCHA Enterprise site key is set.
if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    /* App Check optional in dev */
  }
}

/** Which event this build points at (schema supports many; v1 uses one). */
export const EVENT_ID = import.meta.env.VITE_EVENT_ID || 'med-2026';

// Analytics only loads in supported (browser, https) contexts with a measurement
// id — and never for the uptime synthetic (#142), whose load-only probe must not
// emit a GA4 page_view into real product metrics.
export let analytics: Analytics | null = null;
isSupported()
  .then((ok) => {
    if (ok && firebaseConfig.measurementId && !isSyntheticProbe()) analytics = getAnalytics(app);
  })
  .catch(() => {
    /* analytics unavailable; ignore */
  });
