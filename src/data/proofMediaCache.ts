// proofMediaCache — the single source of truth for how proof media is cached
// client-side (#363). Zero-dependency on purpose: vite.config.ts imports these
// constants to build the service worker's runtime-caching route, so this module
// must never pull in firebase (or anything browser-only) at import time.
//
// Proof media is immutable by construction: each object lives at
// proofs/{eventId}/{uid}/{proofId}.{ext} — a path unique per Proof that is
// never rewritten (deleteProof removes it, nothing overwrites it) — so a
// long-lived immutable cache policy can never serve a stale proof. Avatars are
// deliberately NOT covered by any of this: avatars/{uid}.jpg is overwritten in
// place on every profile-photo change, so long-lived caching would pin the old
// photo (see uploadAvatar in ./storage.ts).

/**
 * Cache-Control stamped onto proof media at upload (uploadProofMedia), so
 * Firebase Storage stops serving it with the default `private, max-age=0`
 * that forced the browser to revalidate every Feed render. Download URLs are
 * token-versioned and the object is immutable, so a year + `immutable` is safe.
 */
export const PROOF_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Matches Firebase Storage download URLs for PROOF media only. getDownloadURL
 * always resolves to `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/
 * <url-encoded object path>?...`, and the encoding turns the path separators
 * into `%2F` — so `/o/proofs%2F` anchors this route to the immutable proofs/
 * tree. Avatar URLs (`/o/avatars%2F...`, mutable objects) never match, and the
 * `^https://` anchor satisfies Workbox's rule that a cross-origin RegExp route
 * must match from the start of the URL.
 */
export const PROOF_MEDIA_URL_PATTERN = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/proofs%2F/i;

/** Service-worker cache bucket for the CacheFirst proof-media route. */
export const PROOF_MEDIA_CACHE_NAME = 'proof-media';

/**
 * Expiration for the runtime cache: the Feed itself is capped at 60 merged
 * entries and a downscaled proof photo is ~100–300 KB, so 200 entries covers
 * several screens of history; 30 days outlives any single cruise. Proof <img>
 * loads are no-cors, so the cached responses are opaque — Workbox needs
 * `purgeOnQuotaError` alongside these caps because browsers pad opaque
 * responses heavily in quota accounting.
 */
export const PROOF_MEDIA_CACHE_MAX_ENTRIES = 200;
export const PROOF_MEDIA_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
