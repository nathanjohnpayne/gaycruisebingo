---
spec_id: x-e2e-happy-path
status: accepted
---

# E2E happy-path (join → Mark → BINGO → Leaderboard) + offline-Mark test against the emulator

Proves the PRD's headline metric — a full round is playable end-to-end with zero coordination beyond the app's one shared link — with a Playwright e2e suite against the Firebase Local Emulator Suite, and adds the [ADR 0006](../docs/adr/0006-offline-resilience.md) assertion that an offline Mark survives a reload (queued durably in IndexedDB) and syncs on reconnect. Runs on the Playwright harness `w0-test-harness` stood up (`playwright.config.ts`, `test:e2e`) and consumes the `firebase.json` `emulators` block that same ticket added.

## The suite

- `playwright.config.ts` — extends the `w0-test-harness` smoke config with the dev-server `webServer` + `baseURL` wiring it always said this ticket would add, plus a second `webServer` entry that boots the Firestore/Auth/Storage emulators (`npm run emulator` — the same command the harness already exposes, not a fork of it). Both boot automatically under `npm run test:e2e` / `npx playwright test`, so the whole layer is one self-contained command.
- `tests/e2e/support/env.ts` — the shared demo project id (`demo-gaycruisebingo-e2e`), a dedicated Event id (`e2e-happy-path`, never the real `med-2026`), the emulator ports `firebase.json` pins, and the dev-server URL — imported by both the config and the test support so they cannot drift apart.
- `tests/e2e/support/seed.ts` — seeds the Event + the full `ITEMS` pool (32 Prompts, `scripts/seed.mjs` — reused, not re-declared, so this suite deals boards from the exact real pool shape) into the running Firestore emulator, with security rules disabled via `@firebase/rules-unit-testing` (already a devDependency the `tests/rules/` layer relies on) — the same rules-bypassing posture `scripts/seed.mjs` gets from the Admin SDK, without adding `firebase-admin` as a dependency (it is deliberately absent from the app install; see that script's header comment).
- `tests/e2e/support/join.ts` — the zero-coordination join: land on `/` (the shared link), accept the 18+ acknowledgement, click "Continue with Google". Shared by both cases below so the join is asserted in exactly one place.
- `tests/e2e/support/board.ts` — selects Squares by their dealt prompt TEXT (`src/components/Board.tsx` renders no `data-testid`/role on a cell), never CSS position, so the suite survives the Board gaining more per-cell chrome (the doubt affordance, tally badges) around the same 25-cell grid.
- `tests/e2e/x-e2e-happy-path.spec.ts` — the two cases.

## Acceptance criteria → test cases

- **Given** a seeded Event (dense pool) and the shared link, **when** a Player joins, Marks a winning line, and opens Ranks, **then** BINGO fires and the Player ranks correctly — with no coordination beyond the link. → `join -> Mark -> BINGO -> Leaderboard completes with only the shared link (zero admin action)`: joins, taps the 4 non-free Squares of the middle row (index 12, the free centre, already counts — the AC's "centre free space counts"), asserts the `BINGO!` celebration, opens Ranks, and asserts the sole Player's row shows rank 1 with `1 bingo` / `4 squares`. The test never navigates to `/admin` or calls anything in `src/components/Admin.tsx`.
- **Given** a Player offline, **when** they Mark a Square and reload, **then** the Mark persists and later syncs on reconnect (ADR 0006). → `a Mark made offline survives a reload and syncs on reconnect (ADR 0006)`: `context.setOffline(true)`, Marks an arbitrary unmarked non-free Square, asserts it renders `marked` immediately (latency compensation), reloads while STILL offline and re-asserts `marked` (proving the durable IndexedDB queue, not memory — matching `tests/offline/w0-offline-persistence.test.ts`'s ordering discipline), reconnects, then polls an independent rules-disabled Firestore read (never the reloaded tab's own cache) until the emulator shows the synced write.
- Dense pool ≥ 24 active Prompts (ADR 0004's `dealBoard` guard, `src/game/logic.ts` `MIN_POOL`). → asserted directly against the seeded `ITEMS` length in `beforeAll`.
- Zero-coordination (shared-link-only) path. → structural: neither case performs any admin action or reads `Admin.tsx`; `join.ts` is the only entry point either case uses.

## Known limitation

Both cases above currently fail at `joinViaSharedLink`'s final assertion, not later — and are expected to, in this checkout. The blocker is NOT the one the originating issue anticipated (`@playwright/test` / the e2e harness itself): `package.json` already carries `@playwright/test` and `test:e2e` (`w0-test-harness` landed it), so that part of the harness is real and unblocked.

The actual gap: `src/firebase.ts` exports its `auth`/`db` singletons wired to production Firebase only. No file under `src/**` calls `connectAuthEmulator` / `connectFirestoreEmulator` / `connectStorageEmulator` anywhere — confirmed by grep across the whole non-test `src/` tree — and `src/firebase.test.ts` pins this as deliberate ("ADR 0006 source guard ... firebase.ts runs getAuth(app) at import"; its own docstring calls the config "the production init"). Every existing emulator-connected test (`tests/offline/**`, `tests/rules/**`) works around this by constructing its OWN, separate Firebase app instance directly in Node — none of them make the real browser-served app talk to the emulator, because nothing in this repository does that today.

This ticket's file boundaries put `src/**` off-limits ("this ticket proves behavior, it does not change it"), so `x-e2e-happy-path.spec.ts` cannot add the missing emulator branch itself. The suite is written as the real join a Player takes — `playwright.config.ts` boots the emulators, `seed.ts` seeds a real dense pool into them, and `join.ts` drives the actual "Continue with Google" control — so it starts passing with no rewrite the moment a follow-up ticket adds an env-gated emulator connection to `src/firebase.ts` (e.g. `connectAuthEmulator`/`connectFirestoreEmulator`/`connectStorageEmulator` gated on `import.meta.env.DEV && import.meta.env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-')`, mirroring the `demo-`-prefixed project id convention `tests/offline` and `tests/rules` already use).

`npm run test:e2e` (Playwright, real Chromium) is a **local-only** layer — `.github/workflows/app-ci.yml` says so explicitly ("intentionally not run here") — so this gap does not block `app-ci`; `tests/e2e/smoke.spec.ts` (`w0-test-harness`) still passes, proving the runner itself launches Chromium and drives a page. It blocks only the two cases this ticket adds, and only until the `src/firebase.ts` emulator branch lands.
