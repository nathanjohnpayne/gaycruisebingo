import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
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

// Analytics only loads in supported (browser, https) contexts with a measurement id.
export let analytics: Analytics | null = null;
isSupported()
  .then((ok) => {
    if (ok && firebaseConfig.measurementId) analytics = getAnalytics(app);
  })
  .catch(() => {
    /* analytics unavailable; ignore */
  });
