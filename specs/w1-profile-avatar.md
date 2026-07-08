---
spec_id: w1-profile-avatar
status: accepted
---

# Profile: display name + custom avatar upload (`src/data/profile.ts`, `src/components/ProfileEditor.tsx`, `src/components/Avatar.tsx`)

A User's global profile (`users/{uid}`) is attributed and public everywhere the User appears — Tally, Feed, Leaderboard (ADR 0002) — so this ticket adds a display-name + custom-avatar edit surface on top of the already-scaffolded `uploadAvatar`/`downscaleImage` (`src/data/storage.ts`) and `UserDoc.customPhoto` (`src/types.ts`). It is exercised by `src/components/w1-profile-avatar.test.tsx` (unit + RTL-jsdom).

## `data/profile.ts` persists edits to `users/{uid}`, reusing `storage.ts`

- **Given** a signed-in User types a new display name **when** `updateDisplayName(uid, name)` is called **then** it trims the name and writes `users/{uid}.displayName`; a blank/whitespace-only name is a no-op so a cleared input can't wipe out the existing name. (Test: "trims and persists the display name, no-ops on blank".)
- **Given** a signed-in User picks a photo **when** `updateAvatar(uid, blob)` is called **then** it calls the existing `uploadAvatar` (`storage.ts:42`, unmodified) — no new upload path — which still downscales and writes exactly `avatars/{uid}.jpg` with `image/jpeg`, and then writes both `users/{uid}.photoURL` (the returned URL) and `users/{uid}.customPhoto = true`. (Test: "reuses uploadAvatar (avatars/{uid}.jpg, image/jpeg) then flips customPhoto + photoURL".)
- **Given** `users/{uid}` does not exist yet — `ensureUserProfile`'s create-on-sign-in write (`data/api.ts`) can fail, and that failure is swallowed in `auth/AuthContext.tsx` — **when** `updateDisplayName` or `updateAvatar` is called **then** the write still succeeds and creates the document, because both use a merge `setDoc` rather than `updateDoc` (which requires the document to already exist). (Test: "creates users/{uid} via a merge write when the profile doc is missing (ensureUserProfile create failed)".)

## `Avatar` prefers a custom photo over the passed `src`

- **Given** a `customPhoto` URL is passed **when** `Avatar` renders **then** it shows that URL instead of `src`; **given** no `customPhoto` **then** it falls back to `src`; **given** neither is set **then** it falls back to the name's initial. (Test: "prefers customPhoto, falls back to src, then to an initial".)

## `ProfileEditor` — the edit surface

Mounted globally at `src/main.tsx` (a stable, non-frozen mount point — `App.tsx`/`Nav.tsx` stay untouched) so it is reachable from every tab rather than tied to one page.

- **Given** the signed-in User's live profile (`useMyUser`) **when** the editor opens **then** the name field is pre-filled with the current display name, and saving an edit calls `updateDisplayName` with the trimmed value and closes the sheet. (Test: "opens pre-filled with the live display name and saves an edit to users/{uid}".)
- **Given** the User picks a file from the hidden file input **when** the change fires **then** `updateAvatar` is called and persists it; once the live `users/{uid}` subscription reports `customPhoto: true`, the previewed Avatar switches from the signed-in User's Google photo to the custom one. (Test: "uploading a photo persists it, and the live update flips the previewed Avatar to it".)
- **Given** no signed-in User, auth still resolving, or the live `users/{uid}` profile subscription (`useMyUser`) still loading **when** `ProfileEditor` renders **then** it renders nothing — the trigger only appears once a User is signed in and the profile snapshot has resolved. (Test: "renders nothing while signed out".)
- **Given** the profile subscription resolves after auth does, with a saved `displayName` that differs from the signed-in User's Google name **when** the trigger becomes available and the User opens and saves without further edits **then** the name field seeds from — and Save persists — the saved profile name, never the Google-name fallback; the editor cannot open early enough (while `useMyUser` is still loading) to clobber a saved name with the stale Google one. (Test: "waits for the live profile snapshot before rendering, so a delayed load never clobbers a saved name".)
- **Given** account A has the sheet open (possibly with a half-typed name) **when** A signs out and a different account B signs in **then** no sheet state survives the transition — the editor proper is keyed by uid and unmounts wholesale, so B gets a closed sheet whose reopen seeds from B's saved profile, and A's leftover text can never render under, or be saved to, B's `users/{uid}`. (Test: "closes and resets the editor across an auth transition — account B never sees or saves account A state".)
- **Given** the component has already rendered signed out (settling a `useMyUser(undefined)` subscription to `loading: false`) **when** a User signs in **then** the editor still waits for the new uid's own snapshot: keying the editor by uid mounts a fresh `useMyUser` instance whose loading flag starts `true`, so no render for the new uid can observe a previous subscription's settled `false` — the one-frame window that let the trigger show and the Google name seed/save before the snapshot arrived. (Test: "after a signed-out render, waits for the NEW uid's snapshot — a stale settled loading flag can't leak the Google name".)

## Out of scope

- A rules-emulator assertion that a non-owner cannot write `avatars/{otherUid}.jpg` is not added here: the `/avatars/{file}` rule itself predates this ticket (`storage.rules:20-26`, scaffolded already) and its emulator coverage is `w0-storage-rules` (#19)'s own deliverable; `test:rules` also needs a local JRE + the Firebase emulator, unavailable in this sandboxed unit-test environment. `npm run typecheck && npm test && npm run build` are this ticket's verified gates, matching the DoD's "no lint script; app tests are not CI-run" note.
- Propagating a display-name/avatar edit into already-denormalized snapshots (`PlayerDoc`, `ProofDoc`, `MomentDoc`, `TallyEntry`) is intentionally not built here — those are written once at their own create time by tickets that own `src/data/api.ts` this wave, and re-syncing every historical snapshot on a profile edit is a larger, separate change.
