# Spec: client-side PostHog product analytics (#96)

Adds PostHog product analytics to the React app **alongside GA4** (both fire; PostHog does not replace GA4). Set up initially via `@posthog/wizard` on branch `posthog-setup`; the wizard's server-side (`posthog-node`) output was reverted in favour of this client integration, because 2 of its 3 instrumented surfaces (the `share` Cloud Function and the Cloud Run OG renderer) are removed by ADR 0005 / #39, and the PRD's analytics goal is client events.

## Behaviour

- **Single dispatch path.** `track(name, params)` in `src/analytics.ts` is the only analytics call site in the app; it now fires each event to **both** GA4 (`logEvent`) and PostHog (`phCapture`). Each sink is independently guarded and never throws, so one failing or being unconfigured never blocks the other. The event catalog is unchanged (`GA4_EVENTS`, 12 events).
- **Init.** `initPostHog()` (in `src/posthog.ts`) runs once from `main.tsx`. It is a **no-op without `VITE_POSTHOG_KEY`**, mirroring the GA4 guard — dev/test/CI without env vars stay silent. Ingestion defaults to the first-party reverse proxy at `https://d.gaycruisebingo.com`; `VITE_POSTHOG_HOST=https://us.i.posthog.com` can bypass it for non-production diagnostics. This app is US-region-bound: `ui_host` remains `https://us.posthog.com`, so toolbar and “view in PostHog” links target the US app rather than the proxy. The proxy forwards ingestion plus PostHog's `/static/*` and `/array/*` asset/config routes. The `phc_` project key is client-safe/public.
- **Identify.** On sign-in the User is identified by **uid only** (no PII person properties); identity is reset on sign-out. Wired from `main.tsx`/`ThemedApp` (not `AuthContext`) to keep analytics out of the protected `src/auth/**` path.
- **Pageviews.** Captured manually on route change with the **path only** (no query/hash), so no PII leaks through the URL.

## Privacy (noindex, 18+, user-generated adult media + names)

PostHog is configured to send **only** the explicit named events above — every implicit capture vector is hard-disabled so it can never ingest Proof media, typed input, or display names, and therefore sees nothing GA4 doesn't:

- `autocapture: false`
- `disable_session_recording: true`
- `capture_pageview: false` and `capture_pageleave: false`
- `person_profiles: 'identified_only'`

These options are exported as `POSTHOG_INIT_OPTIONS` so the policy is unit-tested. The 18+ analytics disclosure is `ConsentNotice.tsx` — a notice, not a gate (GA4 and PostHog both fire without an opt-in), consistent with the existing analytics model.

## Tested by

- `src/posthog-analytics.test.ts` — the privacy-safe config options, the no-op-without-key guard, the first-party proxy default, the environment override, and the fixed US UI host.
- `src/analytics.dual-dispatch.test.ts` — `track()` fires the same event/params to both GA4 and PostHog, and still reaches PostHog if GA4 throws.
