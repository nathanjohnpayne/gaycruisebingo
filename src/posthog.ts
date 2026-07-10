// Client-side PostHog (product analytics) — runs ALONGSIDE GA4 (#96).
//
// Privacy stance for a noindex, 18+ app whose Players upload adult photos/audio
// and type "name names" text Proofs: PostHog sends ONLY the explicit named events
// that already flow through analytics.ts's `track()` (parity with GA4) and
// identifies by uid (no PII person properties). Every implicit capture vector is
// hard-disabled — no autocapture, no session recording, no pageview autocapture —
// so PostHog can never ingest user-generated media, inputs, or names, and sees
// nothing GA4 doesn't. The 18+ analytics disclosure is ConsentNotice.tsx (a
// notice, not a gate — GA4 and PostHog both fire without an opt-in).
import posthog, { type PostHogConfig } from 'posthog-js';

/** Privacy-safe init options — exported so the policy is unit-testable. */
export const POSTHOG_INIT_OPTIONS: Partial<PostHogConfig> = {
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true,
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

let ready = false;

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

/** Manual SPA pageview — path only (no query/hash), so no PII leaks via the URL. */
export function phPageview(pathname: string): void {
  if (!ready) return;
  try {
    posthog.capture('$pageview', { $current_url: pathname });
  } catch {
    /* no-op */
  }
}
