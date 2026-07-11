// Client-side PostHog (product analytics) — runs ALONGSIDE GA4 (#96).
//
// Full capture is ENABLED (this reverses the prior privacy lockdown, at the
// owner's request). PostHog now autocaptures clicks, SPA pageviews + pageleaves,
// heatmaps, and records sessions — on top of the explicit named events that flow
// through analytics.ts's `track()`. Identity is still by uid only (no PII person
// properties).
//
// This is a noindex, 18+ app whose play surface is public to any logged-in
// Player. Session replay + autocapture record everything (including Proof media,
// typed inputs, and display names) UNMASKED, by owner decision: the owner is the
// sole PostHog viewer and uses replays to find UX issues, so content masking is
// deliberately not applied. The one exception is URL hygiene — captured URLs are
// reduced to path-only (see `sanitizeUrls`) so query-string credentials (e.g.
// Firebase auth-handler OAuth params) never land in analytics, matching the app's
// long-standing path-only pageview stance. This reverses the #96 privacy lockdown
// at the owner's request; ConsentNotice.tsx discloses that session replay is used.
import posthog, { type PostHogConfig, type CaptureResult } from 'posthog-js';

/** Init options — exported so the capture policy is unit-testable. */
export const POSTHOG_INIT_OPTIONS: Partial<PostHogConfig> = {
  autocapture: true,
  // 'history_change' captures the initial load AND SPA route changes (react-router
  // drives navigation through the History API), so no manual pageview call is needed.
  capture_pageview: 'history_change',
  capture_pageleave: true,
  disable_session_recording: false,
  // PostHog masks all inputs in replays by default; the owner wants fully
  // unmasked replays (see the header note), so opt out explicitly — otherwise
  // typed text like the callout-Proof <textarea> stays hidden, defeating the
  // UX-debugging purpose. (Codex P3 on #195.)
  session_recording: { maskAllInputs: false },
  // Content is unmasked, but URLs are not: strip query/hash from URL properties
  // so query-string secrets (auth tokens, emails) are never stored. (Codex P1 on #195.)
  before_send: sanitizeUrls,
  person_profiles: 'identified_only',
  // Events POST first-party through our reverse proxy (see `api_host` below,
  // #149); `ui_host` keeps the PostHog toolbar and "view in PostHog" links
  // pointed at the real US app rather than the proxy domain. Region-fixed, so
  // it lives here in the static (testable) options rather than being env-driven.
  ui_host: 'https://us.posthog.com',
};

/**
 * Default ingestion host. Our first-party reverse proxy (#149) forwards both the
 * ingestion API and PostHog's static assets to the US region, so shipping through
 * it keeps analytics on our own domain (fewer ad-blocker drops, no third-party
 * host). `VITE_POSTHOG_HOST` still supports a direct-US non-production bypass;
 * this US deployment deliberately keeps `ui_host` region-fixed above.
 */
export const POSTHOG_PROXY_HOST = 'https://d.gaycruisebingo.com';

/**
 * Strip the query string and hash from a URL string, keeping origin + path.
 * Non-string / non-URL values pass through unchanged.
 */
export function stripUrlSecrets(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch {
    // Relative or malformed URL — drop everything from the first ? or #.
    return value.split(/[?#]/)[0];
  }
}

const URL_PROP_KEYS = [
  '$current_url',
  '$pathname',
  '$referrer',
  '$initial_current_url',
  '$initial_referrer',
];

/** Reduce any URL-bearing keys in a property bag to path-only, in place. */
function scrubUrlBag(bag: Record<string, unknown> | undefined): void {
  if (!bag) return;
  for (const key of URL_PROP_KEYS) {
    if (bag[key] != null) bag[key] = stripUrlSecrets(bag[key]);
  }
}

/**
 * `before_send` hook: reduce URL-bearing fields to path-only so query-string /
 * hash credentials (e.g. Firebase auth-handler OAuth params) are never stored,
 * even though replay content is otherwise unmasked. Covers the event `properties`
 * AND the person-property bags `$set` / `$set_once` — the latter carry
 * `$initial_current_url` / `$initial_referrer` on the first pageview and would
 * otherwise persist the full entry URL. (Codex P1 on #195.)
 */
export function sanitizeUrls(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  scrubUrlBag(event.properties);
  scrubUrlBag(event.$set);
  scrubUrlBag(event.$set_once);
  return event;
}

let ready = false;

/**
 * True for local-development / loopback hosts. PostHog init is skipped on these
 * (see the gate in main.tsx) so dev sessions and Vite HMR errors — e.g. the #194
 * `ReferenceError: ProfileEditor is not defined` fast-refresh artifact captured
 * from `localhost:5173` — never reach production analytics or session replays.
 * Pure (host in, bool out) so the policy is unit-testable without stubbing
 * `window.location`.
 */
export function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  );
}

/**
 * Initialize once from the app entry (main.tsx). No-op without a key — mirrors
 * the GA4 guard in firebase.ts, so dev/test/CI without env vars stay silent. The
 * `phc_` project key is client-safe (public) by design.
 */
export function initPostHog(): void {
  if (ready) return;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  const api_host =
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || POSTHOG_PROXY_HOST;
  try {
    posthog.init(key, { api_host, ...POSTHOG_INIT_OPTIONS });
    ready = true;
  } catch {
    ready = false;
  }
}

export const posthogReady = (): boolean => ready;

/** Capture an explicit event. Called by analytics.ts `track()` alongside GA4. */
export function phCapture(name: string, params?: Record<string, unknown>): void {
  if (!ready) return;
  try {
    posthog.capture(name, params);
  } catch {
    /* analytics must never throw into product code */
  }
}

/** Tie subsequent events to the signed-in User by uid (no PII properties). */
export function phIdentify(uid: string): void {
  if (!ready) return;
  try {
    posthog.identify(uid);
  } catch {
    /* no-op */
  }
}

/** Clear the identity association on sign-out. */
export function phReset(): void {
  if (!ready) return;
  try {
    posthog.reset();
  } catch {
    /* no-op */
  }
}
