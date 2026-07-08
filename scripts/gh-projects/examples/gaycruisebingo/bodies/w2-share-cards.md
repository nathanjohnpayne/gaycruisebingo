**Track:** share · **Phase:** 0 · **Wave:** 2 · **Size:** M · **ADR(s):** 0005
**Epic:** #__NUM_epic-social__
**Labels:** agent-action, track:share, phase-0, wave-2, size:M

## Context & scope
A Share Card is a retina image a Player generates on their own device — for a BINGO or the Leaderboard — to drop into the group chat (ADR 0005). Today the win only shares text + a URL, no image. This ticket replaces that with an on-device image (canvas / `html-to-image` → blob) handed to `navigator.share({ files })` so the native share sheet carries the picture into the chat. The BINGO celebration is the primary share surface, the Leaderboard second; we ship BINGO + Leaderboard Share Cards only — no per-square proof cards (a Proof already carries its own media). Sharing is Phase 0, and everything stays behind the auth wall — no public unauthenticated pages (ADR 0005).

## Current state (scaffold)
- **Exists:** `Celebration.tsx` shares via `navigator.share({ title, text, url })` with a clipboard fallback (`src/components/Celebration.tsx:10-23`) and fires `track('share_click', { surface: 'celebration' })` (`:22`) — text + URL only, no image or canvas. `Leaderboard.tsx` has no share affordance. `share_click` is one of the 10 present GA4 events (`src/analytics.ts`).
- **Missing:** No image generation, no `html-to-image` dependency (`package.json` devDeps are `vite-plugin-pwa` + `vitest`), no `navigator.share({ files })` path, and no Leaderboard Share Card.
- **Contradicts:** The scaffolded `cloud-run/og-renderer/` + `share` function + public share pages are the server-rendered path ADR 0005 rejects; their net-removal is owned by #__NUM_recon-share-og__ (this ticket lands the on-device replacement first).

## Files to create / modify
- `package.json` — add the `html-to-image` dependency.
- `src/components/ShareCard.tsx` (new) — an on-device renderer that produces a retina image blob for a BINGO or the Leaderboard.
- `src/components/Celebration.tsx` — replace the text-only `navigator.share` with the image path: generate the blob, hand it to `navigator.share({ files })`, keep a graceful fallback; keep `track('share_click')`.
- `src/components/Leaderboard.tsx` — add a secondary "share the Leaderboard" affordance using the same renderer.

## Implementation notes
- Generate the image on-device (ADR 0005): canvas / `html-to-image` → blob → `navigator.share({ files })`. Do not route through a server renderer or a public page.
- Ship BINGO + Leaderboard Share Cards only (ADR 0005) — no per-square proof cards. The BINGO celebration is the primary surface; the Leaderboard is the second.
- No public unauthenticated pages (ADR 0005): the Share Card is produced client-side behind the auth wall and handed to the OS share sheet; nothing is exposed at a crawler-facing URL.
- Keep a fallback where `navigator.share({ files })` is unsupported (share text/URL or offer a download) so the primary path degrades rather than breaks; keep firing `share_click`.

## Tests to add
- `src/components/ShareCard.test.tsx` — the renderer produces a non-empty image blob for a BINGO and for the Leaderboard (layer: RTL-jsdom).
- `src/components/Celebration.test.tsx` — Share invokes `navigator.share` with a `files` payload when supported and fires `share_click`; falls back cleanly when it is not (layer: RTL-jsdom).

## Acceptance criteria
- **Given** a Player hits BINGO **When** they tap Share **Then** an on-device retina image is handed to the native share sheet (`navigator.share({ files })`) and `share_click` fires (target ≥ 25 share events — PRD metric).
- **Given** the Leaderboard **When** a Player shares it **Then** a Leaderboard Share Card image is generated on-device and shared.
- [ ] Only BINGO + Leaderboard Share Cards exist — no per-square proof cards.
- [ ] No public unauthenticated page is added; generation is on-device.
- [ ] The text/URL-only share is replaced by the image path with a graceful fallback.

## Definition of Done
- [ ] Spec `specs/w2-share-cards.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on #__NUM_w1-board-mark-win__ — the BINGO celebration is the primary Share Card surface.
- Depends on #__NUM_w2-leaderboard__ — the Leaderboard Share Card renders the ranking that ticket finalizes.
- Blocks #__NUM_recon-share-og__
