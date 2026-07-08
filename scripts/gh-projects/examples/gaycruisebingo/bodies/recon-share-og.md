**Track:** reconciliation · **Phase:** 0 · **Wave:** 2 · **Size:** M · **ADR(s):** 0005
**Epic:** #__NUM_epic-moderation__
**Labels:** agent-action, track:reconciliation, phase-0, wave-2, size:M, reconciliation

## Context & scope
This is a NET-REMOVAL ticket. ADR 0005 supersedes the scaffolded server-side Open Graph pipeline: Share Cards are generated ON-DEVICE (canvas / html-to-image, landed by #__NUM_w2-share-cards__) and there are no public unauthenticated pages. This ticket DELETES the Cloud Run OG renderer, the `share` Function, the `/s/**` hosting rewrite, and the inert `/og/**` Storage block — the scaffold code ADR 0005 explicitly marks as NOT used at launch. It KEEPS `public/og-default.png` + the static `index.html` OG block, which cover bare-URL unfurl with no server. Sequence AFTER the on-device replacement lands so the app is never left without a share surface.

## Current state (scaffold)
- **Exists (to remove):** `cloud-run/og-renderer/` — a full Playwright/Chromium Express OG service (`src/server.ts`, `src/template.ts` 8-theme palette, `Dockerfile` on the Playwright base, `package.json`, `README.md`, `tsconfig.json`). The `share` Function (`functions/src/index.ts:101-125`, `onRequest` crawler OG HTML + redirect, reads `OG_RENDERER_URL`) and its only caller of the `escapeHtml` helper (`functions/src/index.ts:88-94`). The `firebase.json` rewrite `{ "source": "/s/**", "function": "share" }` (`firebase.json:6`). The inert `/og/{allPaths=**}` block in `storage.rules` (`:39-43`, public read, `write:false`).
- **Exists (to KEEP):** `public/og-default.png` (94 KB, still served with its no-cache header at `firebase.json:19`) and the static OG block in `index.html:15-24`.
- **Missing:** n/a — this is a removal.
- **Contradicts:** the OG renderer + `share` page + `/s/**` rewrite CONTRADICT ADR 0005 (on-device Share Cards; no public unauthenticated pages). ADR 0005 supersedes them.

## Files to create / modify
- delete `cloud-run/og-renderer/**` (`server.ts`, `template.ts`, `Dockerfile`, `package.json`, `README.md`, `tsconfig.json`).
- `functions/src/index.ts` — remove the `share` export (`:96-125`) and the now-orphaned `escapeHtml` helper (`:88-94`); keep `moderateProof`. (`recomputeStats` is owned by #__NUM_recon-recompute-stats__.)
- `firebase.json` — remove the `/s/**` → `share` rewrite (`:6`); keep the SPA fallback (`:7`).
- `storage.rules` — remove the inert `/og/**` block (`:39-43`).
- docs — update `docs/app/README.md` (OG-renderer refs at `:7`, `:9`, `:123-124`, `:136`, `:140`) and `docs/app/phase-1-deploy.md` (section 3 "Cloud Run OG renderer", the `OG_RENDERER_URL` step at `:19`, and the `share` mentions at `:23`, `:43`) so nothing points at removed code.

## Implementation notes
- Order: land AFTER #__NUM_w2-share-cards__ so removal never leaves the app without a share path — on-device Share Cards are the launch share surface (ADR 0005: BINGO celebration primary, Leaderboard second).
- `firebase.json` is a HOT file; #__NUM_w0-test-harness__ adds the `emulators` block to it. Sequence this removal after that block lands to avoid colliding on `firebase.json`.
- Keep bare-URL unfurl working via the static `index.html` OG + `public/og-default.png` — do NOT remove those. This is the static Open Graph meta, distinct from the on-device Share Card.
- After removal, grep for `og-renderer`, `OG_RENDERER_URL`, `/s/`, and the `share` Function to prove no dangling refs; app `npm run build` and the functions build stay green.
- Do not touch `moderateProof` (ADR 0004 Phase 1 keep) or the `recomputeStats` removal (owned by #__NUM_recon-recompute-stats__).

## Tests to add
- `tests/reconciliation/recon-share-og.test.ts` — asserts `firebase.json` has no `/s/**` rewrite, `functions/src/index.ts` exports no `share`, `cloud-run/og-renderer` is absent, and `public/og-default.png` + the static `index.html` OG remain (layer: unit).

## Acceptance criteria
- **Given** the merged removal **When** the app builds **Then** `npm run build` is green and grep finds no `og-renderer` / `OG_RENDERER_URL` / `/s/` / `share`-Function references (no dangling refs).
- **Given** a bare URL pasted into chat **When** a crawler fetches it **Then** the static `index.html` OG + `og-default.png` still unfurl (no server needed).
- [ ] `cloud-run/og-renderer/**` deleted.
- [ ] `share` Function (+ orphaned `escapeHtml`) removed from `functions/src/index.ts`; `moderateProof` untouched.
- [ ] `/s/**` rewrite removed from `firebase.json`; SPA fallback kept.
- [ ] Inert `/og/**` block removed from `storage.rules`.
- [ ] `public/og-default.png` + static OG kept; `docs/app/README.md` + `phase-1-deploy.md` updated (no refs to removed code).

## Definition of Done
- [ ] Spec `specs/recon-share-og.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w2-share-cards__ — the on-device Share Card replacement must land first so removal leaves a working share path (ADR 0005).
- Coordinates with #__NUM_w0-test-harness__ — sequence after its `emulators` block on the hot `firebase.json` to avoid a merge collision.
