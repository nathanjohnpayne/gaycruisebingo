**Track:** pwa · **Phase:** 0 · **Wave:** 1 · **Size:** M · **ADR(s):** 0006
**Epic:** #__NUM_epic-play__
**Labels:** agent-action, track:pwa, phase-0, wave-1, size:M

## Context & scope

Gay Cruise Bingo ships as an installable PWA (PRD non-goal: no native App Store / Play Store). `vite-plugin-pwa` is already wired (manifest + Workbox shell precache — ADR 0006 layer 1). This ticket finalizes the install prompt, adds the missing `install_pwa` GA4 event, adds iOS safe-area CSS, and hits Lighthouse PWA + performance ≥ 90 on a mid-tier phone (PRD metric).

## Current state (scaffold)

- **Exists:** `VitePWA({ registerType: 'autoUpdate', manifest, workbox })` (`vite.config.ts:9-30`; manifest `:12-25`, Workbox `globPatterns` `:27` + `navigateFallback` `:28`); `index.html` has `viewport-fit=cover` (`:5`) and Apple PWA meta (`:7-8`, `:10`); `public/` holds `pwa-192`/`pwa-512`/`apple-touch-icon`/`og-default.png`.
- **Missing:** an install-prompt UI; the `install_pwa` GA4 event (`src/analytics.ts` `track()` has 10 of the 12 PRD events; `install_pwa` is absent); `env(safe-area-inset-*)` CSS; a verified Lighthouse ≥ 90 run.
- **Contradicts:** none.

## Files to create / modify

- an install-prompt component — capture `beforeinstallprompt` and offer install.
- `src/analytics.ts` — fire `install_pwa` via the existing `track()` (`:5`).
- `index.html` — PWA meta already present (`:5`, `:7-10`); adjust only if Lighthouse flags it.
- `src/index.css` — `env(safe-area-inset-*)` padding for iOS.
- `vite.config.ts` — manifest/Workbox tuning only if Lighthouse flags it (`:9-30`).

## Implementation notes

- The Workbox shell precache is ADR 0006 layer 1 (already present, `vite.config.ts:26-29`); Firestore `persistentLocalCache` (layer 2) is #__NUM_w0-offline-persistence__ and out of scope here.
- Add `install_pwa` to the GA4 set via the existing `track()` (`analytics.ts:5`), fired on install-prompt acceptance — this completes 11 of the 12 PRD events (`demand_proof` is #__NUM_w2-doubts__ / #__NUM_w2-ga4-events__).
- iOS safe-area: use `env(safe-area-inset-*)` with the existing `viewport-fit=cover` (`index.html:5`).
- PWA-only distribution (PRD non-goal: no native store) — the install prompt is the install path.

## Tests to add

- `src/analytics.test.ts` — `track('install_pwa')` is dispatched on install acceptance (layer: unit).
- install-prompt component test — `beforeinstallprompt` is captured and the install affordance renders (layer: RTL-jsdom).
- a Lighthouse assertion (CI or documented run) — PWA + performance ≥ 90 on a mid-tier phone (layer: e2e/manual per PRD).

## Acceptance criteria

- **Given** a mid-tier phone **When** the app is audited **Then** Lighthouse PWA + performance ≥ 90 (PRD metric).
- **Given** an install-eligible browser **When** the User installs **Then** `install_pwa` fires and the app opens standalone.
- **Given** an iOS device **When** the app runs **Then** `env(safe-area-inset-*)` keeps content clear of the notch / home indicator.
- [ ] Install prompt implemented.
- [ ] `install_pwa` GA4 event wired.
- [ ] iOS safe-area CSS applied.
- [ ] Lighthouse ≥ 90 verified.

## Definition of Done

- [ ] Spec `specs/w1-pwa.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w0-app-shell__ — the shell hosts the install prompt and the safe-area layout.
