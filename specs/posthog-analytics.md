# Spec: client-side PostHog product analytics (#96)

Adds PostHog product analytics to the React app **alongside GA4** (both fire; PostHog does not replace GA4). Set up initially via `@posthog/wizard` on branch `posthog-setup`; the wizard's server-side (`posthog-node`) output was reverted in favour of this client integration, because 2 of its 3 instrumented surfaces (the `share` Cloud Function and the Cloud Run OG renderer) are removed by ADR 0005 / #39, and the PRD's analytics goal is client events.

## Behaviour

- **Single dispatch path.** `track(name, params)` in `src/analytics.ts` is the only analytics call site in the app; it now fires each event to **both** GA4 (`logEvent`) and PostHog (`phCapture`). Each sink is independently guarded and never throws, so one failing or being unconfigured never blocks the other. The event catalog is `GA4_EVENTS` — the 12 PRD events plus the operational `login_failed` added later by #163; every catalogued event dispatches to both sinks. `login_failed`'s `{ method, code, message }` params carry only the Firebase error code/message, PII-free like the rest, so PostHog's privacy posture below is unchanged.
- **Init.** `initPostHog()` (in `src/posthog.ts`) runs once from `main.tsx`. It is a **no-op without `VITE_POSTHOG_KEY`**, mirroring the GA4 guard — dev/test/CI without env vars stay silent. Ingestion defaults to the first-party reverse proxy at `https://d.gaycruisebingo.com`; `VITE_POSTHOG_HOST=https://us.i.posthog.com` can bypass it for non-production diagnostics. This app is US-region-bound: `ui_host` remains `https://us.posthog.com`, so toolbar and “view in PostHog” links target the US app rather than the proxy. The proxy forwards ingestion plus PostHog's `/static/*` and `/array/*` asset/config routes. The `phc_` project key is client-safe/public.
- **Identify.** On sign-in the User is identified by **uid only** (no PII person properties); identity is reset on sign-out. Wired from `main.tsx`/`ThemedApp` (not `AuthContext`) to keep analytics out of the protected `src/auth/**` path. The reset waits for auth to resolve (`!loading`) so the initial autocaptured pageview is stitched to the signed-in user rather than orphaned under a discarded anonymous id.
- **Pageviews.** Autocaptured by posthog-js via `capture_pageview: 'history_change'` (initial load + SPA route changes) plus `capture_pageleave: true`. URLs are reduced to **path-only** by the `before_send` hook `sanitizeUrls` (query string and hash stripped), so URL-embedded credentials never reach analytics — preserving the app's original path-only pageview stance even though content is otherwise unmasked.
- **Local dev.** `initPostHog()` is skipped on localhost / loopback / `*.local` hosts (`isLocalDevHost`, #194) and for the uptime synthetic (#142), so dev sessions and Vite HMR errors never pollute production analytics or replays.

## Capture posture (noindex, 18+, single-viewer, UX debugging)

Full capture is **enabled** by owner decision (#193 reverses the original #96 lockdown). The owner is the sole PostHog viewer and uses session replay to find UX issues, so user content is recorded **unmasked**:

- `autocapture: true`
- `disable_session_recording: false`, with `session_recording.maskAllInputs: false` (PostHog masks inputs by default, so this opts out explicitly)
- `capture_pageview: 'history_change'` and `capture_pageleave: true`
- `person_profiles: 'identified_only'`

The one exception is **URL hygiene**: `before_send: sanitizeUrls` strips query/hash from URL properties so query-string secrets (e.g. Firebase auth-handler OAuth params) are never stored. These options are exported as `POSTHOG_INIT_OPTIONS` so the policy is unit-tested. `ConsentNotice.tsx` discloses to users that analytics — including session replay — is used; its dismissal key is versioned so the updated disclosure re-shows once to prior visitors. It is a notice, not a gate (GA4 and PostHog both fire without an opt-in), consistent with the existing analytics model.

## Tested by

- `src/posthog-analytics.test.ts` — the full-capture config options, the unmasked-replay opt-out, the `sanitizeUrls` path-only URL scrub, the local-dev host gate, the no-op-without-key guard, the first-party proxy default, the environment override, and the fixed US UI host.
- `src/analytics.dual-dispatch.test.ts` — `track()` fires the same event/params to both GA4 and PostHog, and still reaches PostHog if GA4 throws.
