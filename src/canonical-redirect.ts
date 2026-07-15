// Google sign-in must run same-origin with Firebase Auth's OAuth handler
// (authDomain is gaycruisebingo.com, #161). Firebase Hosting also serves the app
// at the alias origins gaycruisebingo.web.app and gaycruisebingo.firebaseapp.com;
// a visitor who signs in from one of those hits a cross-origin handler that fails
// with "missing initial state" in storage-partitioned in-app webviews and Safari
// ITP (#162). So when a Player signs in from an alias origin we send them to the
// canonical origin to authenticate there.
//
// This is consulted at sign-in time (AuthContext.signIn), NOT at boot: a boot
// redirect would navigate away from an alias origin whose service-worker shell and
// Firestore/Auth IndexedDB hold a signed-in Player's cached board and offline-
// queued Marks, and `navigator.onLine` is unreliable on ship/captive Wi-Fi, so it
// could strand a player who only wanted to read their cached board offline (Codex
// P2 on #165). Signing in always requires the network, so gating the redirect on
// the sign-in action sidesteps the connectivity question entirely.

const CANONICAL_HOST = 'gaycruisebingo.com';

// The Firebase-default alias hosts that serve the same site. localhost, preview
// channels (vite preview / e2e), and the canonical host itself are intentionally
// absent so this never fires in dev, tests, or on .com.
const ALIAS_HOSTS = ['gaycruisebingo.web.app', 'gaycruisebingo.firebaseapp.com'];

/**
 * The canonical URL to send this location to before signing in, or `null` when it
 * is already canonical (or a non-alias host like localhost/preview). Pure so it is
 * unit testable; the path, query, and hash are preserved verbatim.
 */
export function canonicalRedirectUrl(loc: {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}): string | null {
  if (!ALIAS_HOSTS.includes(loc.hostname)) return null;
  return `https://${CANONICAL_HOST}${loc.pathname}${loc.search}${loc.hash}`;
}

// The Firebase-default auth handler origin. Always served by Firebase directly
// (independent of the custom-domain serving path that took the canonical host
// down in #340) and present in the auto-created OAuth client's redirect URIs by
// default, so it works as the emergency handler when the canonical origin is out.
export const FALLBACK_AUTH_DOMAIN = 'gaycruisebingo.firebaseapp.com';

/**
 * Whether the canonical origin is actually answering (#340): a cheap no-cors
 * probe of a static asset. `true` means TCP+TLS+HTTP completed (an opaque
 * response is enough — we never read it); any network error, reset, or timeout
 * means the canonical host is NOT safe to send a Player to. The 2026-07-15 apex
 * outage (#340) made the unconditional sign-in redirect below a hard dead end:
 * gaycruisebingo.com reset every handshake while the aliases stayed healthy, so
 * `signIn` on an alias origin navigated Players to a domain that could not even
 * complete a TLS handshake. Probing at sign-in time keeps the #165 rule (never
 * gate on `navigator.onLine` at boot) while refusing to navigate INTO an outage.
 * The cache-busting query + `no-store` keep the service worker and HTTP caches
 * from answering for a dead origin; the SW has no cross-origin runtime caching
 * (vite.config.ts precaches same-origin only), so this reaches the network.
 */
function canonicalProbeTimeout(timeoutMs: number): { signal?: AbortSignal; cleanup: () => void } {
  // Feature-detected (Codex P2 on #341): older Safari/iOS WebViews lack
  // AbortSignal.timeout, and an unconditional call would throw BEFORE fetch.
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }
  if (typeof AbortController === 'undefined') return { cleanup: () => {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export async function canonicalOriginAlive(fetchImpl: typeof fetch = fetch, timeoutMs = 1200): Promise<boolean> {
  const { signal, cleanup } = canonicalProbeTimeout(timeoutMs);
  try {
    // 1200ms cap, not the previous 2500 (Codex P1 on #341): AuthProvider warms
    // this decision before the tap so signInWithPopup can still be called inside
    // the tap's transient user activation. A dead-by-RST origin (the #340 filter)
    // rejects near-instantly; the cap only bites on silent blackholing.
    await fetchImpl(`https://${CANONICAL_HOST}/favicon.svg?alive=${Date.now()}`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    cleanup();
  }
}
