**Track:** offline · **Phase:** 0 · **Wave:** 0 · **Size:** M · **ADR(s):** 0006
**Epic:** #__NUM_epic-foundation__
**Labels:** agent-action, track:offline, phase-0, wave-0, size:M

## Context & scope
Deliver the data half of ADR 0006: replace `getFirestore(app)` with `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` in `src/firebase.ts` so Marks queue durably in IndexedDB and sync on reconnect. The PWA shell precache (Workbox) is already done; this adds durable Firestore offline persistence. HOT-file owner of `src/firebase.ts`. This ticket delivers the persistence primitive that `w1-board-mark-win`'s offline-durable Marks rely on.

## Current state (scaffold)
- **Exists:** `src/firebase.ts:21` `export const db = getFirestore(app)` (no persistence); App Check scaffolded (`24-34`); `EVENT_ID = VITE_EVENT_ID || 'med-2026'` (`:37`); GA4 lazy via `isSupported()` (`40-47`); Workbox shell precache present via `vite-plugin-pwa`.
- **Missing:** `persistentLocalCache` + `persistentMultipleTabManager`; any offline integration test.
- **Contradicts:** `firebase.ts:21` `getFirestore` (no cache) contradicts ADR 0006 (a durable Mark queue needs `persistentLocalCache`). The false `Board.tsx:65` offline comment is real but is fixed by `w1-board-mark-win`, NOT here.

## Files to create / modify
- `src/firebase.ts` — replace `getFirestore(app)` (`:21`) with `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`; keep the same `export const db` symbol.
- `tests/offline/*.test.ts` (new) — integration: an offline write persists across a simulated reload and syncs on reconnect.

## Implementation notes
- ADR 0006: `persistentLocalCache` + `persistentMultipleTabManager` so Marks queue durably in IndexedDB and sync on reconnect.
- Import `initializeFirestore`, `persistentLocalCache`, `persistentMultipleTabManager` from `firebase/firestore`; keep `export const db` unchanged so no call site needs editing.
- Multi-tab: a Player may open the PWA in several tabs; `persistentMultipleTabManager` coordinates the shared cache.
- Scope boundary: Proof media still needs signal (the Mark queues offline, the media attaches on reconnect) — that flow is `w2-proof-capture`; the first-ever join needs connectivity (ADR 0006). This ticket ships only the cache primitive.
- HOT-file owner of `src/firebase.ts`.

## Tests to add
- `tests/offline/*.test.ts` — against the emulator: go offline, write a Mark, simulate a reload, assert the write is still present/queued, reconnect, assert it syncs to Firestore (layer: rules-emulator/integration; ADR 0006).

## Acceptance criteria
- **Given** `persistentLocalCache` + the multi-tab manager **When** a Player Marks a Square offline and reloads **Then** the Mark persists locally and syncs to Firestore on reconnect (ADR 0006; PRD offline-mark-survives-reload).
- **Given** the swap keeps `export const db` **When** the app builds **Then** no call site changes are required.
- [ ] `getFirestore(app)` replaced with `initializeFirestore(...persistentLocalCache / persistentMultipleTabManager...)`.
- [ ] `export const db` symbol unchanged; build green with no call-site edits.
- [ ] Offline-write-survives-reload-and-syncs test added.

## Definition of Done
- [ ] Spec `specs/w0-offline-persistence.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w0-test-harness__ — needs the integration-test layer.
- Blocks #__NUM_w1-board-mark-win__ — offline-durable Marks build on this cache primitive.
