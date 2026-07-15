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
import { probeTimeoutSignal } from './canonical-redirect';

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
 * Direct PostHog Cloud US ingestion — the fallback when the first-party proxy
 * is unreachable (#342). The 2026-07-15 shipboard DPI filter blocked the entire
 * registered domain by SNI, `d.gaycruisebingo.com` included, so every event from
 * the network the whole player base was on silently died in posthog-js's retry
 * queue while `us.i.posthog.com` remained reachable. Falling back trades the
 * proxy's ad-blocker resistance for actually delivering events.
 */
export const POSTHOG_DIRECT_HOST = 'https://us.i.posthog.com';

/**
 * Whether the first-party ingest proxy answers (#342): the same cheap
 * no-cors/no-store transport probe as canonical-redirect's
 * `canonicalOriginAlive` — an opaque response proves TCP+TLS+HTTP completed;
 * rejection (reset / filtered SNI / no DNS) or timeout means events would die.
 */
export async function ingestHostAlive(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<boolean> {
  const { signal, cleanup } = probeTimeoutSignal(timeoutMs);
  try {
    await fetchImpl(`${POSTHOG_PROXY_HOST}/?alive=${Date.now()}`, {
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

/**
 * Which ingestion host to init with (#342). Pure so the policy is testable:
 * a non-blank `VITE_POSTHOG_HOST` override always wins (the existing direct-US
 * bypass contract, probe never consulted); otherwise the proxy when it answers,
 * else direct PostHog Cloud.
 */
export function resolveIngestHost(envHost: string | undefined, proxyAlive: boolean): string {
  const override = envHost?.trim();
  // An override that just restates the proxy is NOT a bypass (Codex P2 on
  // #342): .env.example ships VITE_POSTHOG_HOST=<proxy>, so treating it as an
  // unconditional winner would silently disable the outage fallback for every
  // deploy built from a copied example env. Only a genuinely different host
  // (the direct-US bypass contract) skips the probe.
  if (override && override.replace(/\/+$/, '') !== POSTHOG_PROXY_HOST) return override;
  return proxyAlive ? POSTHOG_PROXY_HOST : POSTHOG_DIRECT_HOST;
}

/** True when this env override should skip the transport probe entirely. */
export function envHostBypassesProbe(envHost: string | undefined): boolean {
  const override = envHost?.trim();
  return !!override && override.replace(/\/+$/, '') !== POSTHOG_PROXY_HOST;
}

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
 * Session-replay snapshots ($snapshot events) carry the page URL separately from
 * $current_url and drive the URL shown in the replay timeline, so scrubbing only
 * $current_url leaves the replay URL bar with the full query/hash. Walk the rrweb
 * events and reduce those hrefs to path-only too. Two carriers:
 *   - Meta events (type 4): `data.href` (initial page metadata).
 *   - Custom events (type 5): `data.payload.href` — PostHog's pageview / URL-change
 *     markers, emitted on initial load and SPA navigations under
 *     `capture_pageview: 'history_change'`.
 * No-op when the payload is compressed/opaque (not a plain array), the safe
 * fallback. (#197)
 */
function scrubSnapshotUrls(snapshotData: unknown): void {
  // posthog-js sends `$snapshot_data` as a plain array of rrweb events, or (in
  // some shapes) an object wrapping that array under `.data`.
  const events = Array.isArray(snapshotData)
    ? snapshotData
    : Array.isArray((snapshotData as { data?: unknown } | null)?.data)
      ? (snapshotData as { data: unknown[] }).data
      : null;
  if (!events) return;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const { type, data } = ev as { type?: unknown; data?: Record<string, unknown> };
    if (!data || typeof data !== 'object') continue;
    // Meta event (type 4): data.href
    if (type === 4 && typeof data.href === 'string') {
      data.href = stripUrlSecrets(data.href) as string;
    }
    // Custom event (type 5): data.payload.href
    if (type === 5) {
      const payload = (data as { payload?: Record<string, unknown> }).payload;
      if (payload && typeof payload.href === 'string') {
        payload.href = stripUrlSecrets(payload.href) as string;
      }
    }
  }
}

/**
 * `before_send` hook: reduce URL-bearing fields to path-only so query-string /
 * hash credentials (e.g. Firebase auth-handler OAuth params) are never stored,
 * even though replay content is otherwise unmasked. Covers the event `properties`
 * AND the person-property bags `$set` / `$set_once` — the latter carry
 * `$initial_current_url` / `$initial_referrer` on the first pageview and would
 * otherwise persist the full entry URL (Codex P1 on #195) — AND the rrweb Meta
 * (type 4) / Custom-event (type 5) hrefs inside `$snapshot` replay data (#197).
 */
export function sanitizeUrls(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  scrubUrlBag(event.properties);
  scrubUrlBag(event.$set);
  scrubUrlBag(event.$set_once);
  if (event.event === '$snapshot') scrubSnapshotUrls(event.properties?.$snapshot_data);
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
export async function initPostHog(): Promise<void> {
  if (ready) return;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  const envHost = import.meta.env.VITE_POSTHOG_HOST as string | undefined;
  // Probe the proxy unless an env override forces a genuinely different host
  // (#342): a blocked proxy (shipboard SNI filter) silently drops every event,
  // so ~1.5s of probe at boot buys working analytics for the whole session.
  // `track()` calls in that window no-op via the existing `ready` gate; the
  // initial pageview is captured by posthog.init itself afterwards, so nothing
  // user-visible waits.
  const api_host = resolveIngestHost(
    envHost,
    envHostBypassesProbe(envHost) ? true : await ingestHostAlive(),
  );
  try {
    posthog.init(key, { api_host, ...POSTHOG_INIT_OPTIONS });
    ready = true;
  } catch {
    ready = false;
    return;
  }
  // Replay an identity that arrived while init was still probing (Codex P2 on
  // #342): Firebase restores a cached signed-in user fast on reload, and a
  // phIdentify() landing in the probe window used to no-op via the `ready`
  // gate — leaving the whole session anonymous in analytics. Apply the last
  // one now that the SDK is live.
  if (pendingIdentifyUid !== null) {
    const uid = pendingIdentifyUid;
    pendingIdentifyUid = null;
    phIdentify(uid);
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

// The most recent identify that arrived before init settled (#342) — replayed
// by initPostHog once the SDK is live, cleared by phReset so a sign-out during
// the probe window never resurrects the identity afterwards.
let pendingIdentifyUid: string | null = null;

/** Tie subsequent events to the signed-in User by uid (no PII properties). */
export function phIdentify(uid: string): void {
  if (!ready) {
    pendingIdentifyUid = uid;
    return;
  }
  try {
    posthog.identify(uid);
  } catch {
    /* no-op */
  }
}

/** Clear the identity association on sign-out. */
export function phReset(): void {
  pendingIdentifyUid = null;
  if (!ready) return;
  try {
    posthog.reset();
  } catch {
    /* no-op */
  }
}
