import { useEffect, useState } from 'react';

/**
 * True while the browser believes it has a network connection.
 *
 * `navigator.onLine` is famously weak — it reports the link, not reachability, so
 * a ship's captive Wi‑Fi portal reads as ONLINE while nothing routes (the same
 * caveat AuthContext flags about its own probe). That asymmetry is exactly why
 * this is only ever used to HIDE an action, never to authorize one: a `false` is
 * trustworthy (there is definitely no connection, so don't offer the Reshuffle
 * chip), while a `true` is merely a hint and the write itself must still fail
 * safely on its own. Treat this as "don't bother trying", not "this will work".
 *
 * SSR/jsdom-safe: an environment with no `navigator` reads as online, matching
 * `AuthContext.isOnline`'s posture — absent evidence of being offline, assume the
 * action is worth offering and let the write report the truth.
 *
 * Reshuffle (#378) is the first consumer: it is the one write in the app that
 * must NOT queue offline (see `reshuffleBoard`), so it is the one control that
 * has to know. Pinned by src/hooks/useOnline.test.ts.
 */
export function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Re-read on mount: the listeners can only report TRANSITIONS, so a tab that
    // went offline between this hook's initial `useState` and its first effect
    // would otherwise hold a stale `true` until the next flap.
    setOnline(readOnline());
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
