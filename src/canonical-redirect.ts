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
