**Track:** identity · **Phase:** 0 · **Wave:** 1 · **Size:** M · **ADR(s):** 0002
**Epic:** #__NUM_epic-identity__
**Labels:** agent-action, track:identity, phase-0, wave-1, size:M

## Context & scope

A User can currently only show their Google `photoURL`. This ticket adds a custom avatar upload and a profile edit surface (display name + avatar) so a User's identity is theirs across the Feed, Tally, and Leaderboard. Per ADR 0002 identity is attributed and public — every Mark publishes an attributed Tally entry and there is no anonymity — so the display name and avatar travel with the User wherever they appear.

## Current state (scaffold)

- **Exists:** `uploadAvatar(uid, blob)` downscales and writes `avatars/{uid}.jpg`, returning the URL (`src/data/storage.ts:42-47`, calling `downscaleImage` at `:43`); `downscaleImage` re-encodes client-side (`:5-24`); `UserDoc.customPhoto?` is already typed (`src/types.ts:74`); `Avatar.tsx` renders an `<img>` or an initial fallback (`src/components/Avatar.tsx:12-27`); storage rules already allow `/avatars/{file}` when `file == uid+'.jpg' && okImage()`.
- **Missing:** a profile edit surface (display name + avatar); wiring `uploadAvatar` to set `UserDoc.customPhoto = true` plus the new `photoURL`.
- **Contradicts:** none.

## Files to create / modify

- a new profile component — display-name + avatar edit surface.
- `src/data/storage.ts` — reuse `uploadAvatar` (`:42`) and `downscaleImage` (`:5`); no re-implementation.
- `src/data/api.ts` — persist `displayName` + `photoURL` + `customPhoto` on `users/{uid}`.
- `src/components/Avatar.tsx` — already renders `src`/initial (`:12-27`); consume the custom photo.

## Implementation notes

- Reuse the existing `uploadAvatar` + `downscaleImage` (`storage.ts:42`, `:5`) — do not add a new upload path or a new dependency.
- Set `UserDoc.customPhoto = true` (`types.ts:74`) when a custom avatar is uploaded so downstream surfaces prefer it over the Google `photoURL`.
- Attributed identity per ADR 0002: the display name + avatar are public wherever the User appears (Tally, Feed, Leaderboard) — there is no anonymous mode.
- Self-write only: `users/{uid}` is owner-writable (`firestore.rules:14-17`).

## Tests to add

- `src/data/storage.test.ts` — `uploadAvatar` downscales and writes `avatars/{uid}.jpg` (layer: unit).
- profile component test — editing the display name persists to `users/{uid}` and re-renders the Avatar (layer: RTL-jsdom).
- `tests/rules/storage.test.ts` — a non-owner cannot write `avatars/{otherUid}.jpg` (layer: rules-emulator).

## Acceptance criteria

- **Given** a signed-in User **When** they upload a custom avatar **Then** it downscales, writes `avatars/{uid}.jpg`, and `customPhoto` becomes true.
- **Given** a User edits their display name **When** they save **Then** `users/{uid}.displayName` updates and the new name shows on the Leaderboard/Feed.
- [ ] The custom avatar is preferred over the Google `photoURL` when `customPhoto` is set.
- [ ] Avatar upload reuses `uploadAvatar`/`downscaleImage` (no new dependency).

## Definition of Done

- [ ] Spec `specs/w1-profile-avatar.md` created/updated **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green locally (no `lint` script; app tests are not CI-run — record in the commit `Verified:` trailer)
- [ ] Repo gates pass: `repo_lint` (incl. spec↔test alignment), `md-prose-wrap`, review-policy label gate
- [ ] Conventional commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR body `Closes #<this issue>`; authored `nathanjohnpayne`, reviewed under `nathanpayne-{agent}`; driven to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies

- Depends on #__NUM_w1-auth-google__ — needs an authenticated User.
- Depends on #__NUM_w0-storage-rules__ — the `/avatars/{uid}.jpg` write rule + emulator test.
