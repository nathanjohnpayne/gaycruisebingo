// Keep every visitor on the canonical origin so Firebase Auth's OAuth handler is
// same-origin with the app (#161, #162). authDomain is gaycruisebingo.com, but
// Firebase Hosting also serves the app at gaycruisebingo.web.app and
// gaycruisebingo.firebaseapp.com. A visitor who lands on one of those has a
// cross-origin auth handler, so Google sign-in fails with "missing initial state"
// in storage-partitioned in-app webviews (iMessage/Instagram/WhatsApp) and Safari
// ITP — the exact failure #161 fixed for .com only. authDomain can be one origin,
// so we funnel the alias origins to it instead.

const CANONICAL_HOST = 'gaycruisebingo.com';

// The Firebase-default alias hosts that serve the same site. localhost, preview
// (vite preview / e2e), and the canonical host itself are intentionally absent so
// this never fires in dev, tests, or on .com.
const ALIAS_HOSTS = ['gaycruisebingo.web.app', 'gaycruisebingo.firebaseapp.com'];

/**
 * The canonical URL to send this location to, or `null` when it is already
 * canonical (or a non-alias host like localhost/preview). Pure so it is unit
 * testable; the path, query, and hash are preserved verbatim.
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

/**
 * Whether a boot on this location should redirect, and where — `null` means stay
 * put. Redirects only when online: an offline PWA boot on an alias origin must
 * stay local, because the service-worker shell and the Firestore/Auth IndexedDB
 * the ADR 0006 offline cold-boot relies on are origin-scoped. Navigating
 * cross-origin while offline would strand the player on an uncached
 * gaycruisebingo.com and abandon any offline-queued Marks (Codex P1 on #162).
 */
export function redirectTargetForBoot(
  loc: { hostname: string; pathname: string; search: string; hash: string },
  online: boolean,
): string | null {
  if (!online) return null;
  return canonicalRedirectUrl(loc);
}

// Side effect on import: run the redirect at the earliest point in the boot path
// (this module is imported first in main.tsx, before React/Firebase/PostHog
// evaluate). Guarded on `window` so it is inert under SSR/tests; `replace` (not
// assign) so the alias URL never lands in history and the back button can't loop.
if (typeof window !== 'undefined') {
  // Mirror AuthContext.isOnline: a definite navigator.onLine === false means "no
  // network"; a missing navigator or `true` is treated as online.
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const target = redirectTargetForBoot(window.location, online);
  if (target) window.location.replace(target);
}
