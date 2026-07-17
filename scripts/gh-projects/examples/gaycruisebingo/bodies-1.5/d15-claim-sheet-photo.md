**Track:** proof · **Phase:** 1.5 · **Wave:** 2 · **Size:** L · **Cut line:** must-have

## Context & scope

Closes #190 — implements `daily-cards-spec.md` § "Square tap—the Claim sheet" (photo body) plus the `ProofDoc.source` / `EventDoc.settings.photoProofSource` / `stripPhotoExif` contract from § Data model. Today the Claim sheet's photo body is a single `<input capture="environment">` that force-launches the rear camera on mobile, so there is no way to attach an existing photo — the exact gap issue #190 reports. This ticket resolves #190 with the spec's RESOLVED posture (2026-07-11, transparency over restriction, per ADR 0001 — proof is flavor, never enforcement): two affordances, 📷 Take photo and 🖼️ Library, both available in every Claim Mode; the only way to restrict to live capture is a new event-level admin override (`camera_only`), decoupled entirely from Claim Mode. It also lands the EXIF/GPS strip re-encode, the social heat line, and threads `dayIndex` onto every Proof so the Feed reads as a cruise diary.

## Current state

`src/components/ProofSheet.tsx:162-167` renders one photo input — `<input type="file" accept="image/*" capture="environment" onChange={onPhoto} />` — hard-coded, no library affordance (the exact line #190 names). The 🎖️ Cross My Heart pledge row (`:133-153`, issue #181) and the segmented type picker are unaffected by this ticket; the photo body is the only surface changing. `src/data/proofs.ts` `attachProof` (`:98-224`) writes a Proof doc with no `source`/`dayIndex` field and uploads the raw blob via `uploadProofMedia` (`src/data/storage.ts:26-40`), which only downscales/re-encodes to JPEG — it does not verify or guarantee an EXIF/GPS strip today, and audio proofs carry none at all. `ProofDoc` (`src/types.ts`) and `EventDoc.settings` gain `source`, `dayIndex`, `photoProofSource`, and `stripPhotoExif` in `d15-schema-contract` (this ticket's one dependency); this ticket is the first consumer of those fields, not their owner. `src/components/ProfileEditor.tsx:148` is the reference pattern for a no-capture library picker: `<input type="file" accept="image/*" ... onChange={onAvatarFile} />` with no `capture` attribute. The Tally count this ticket's heat line reads already exists as a subscribed `TallyDoc.count` elsewhere in the app; the Claim sheet itself does not currently read or render it. FROZEN / unaffected: the #181 Cross My Heart honor path, the audio/text proof types, the `attachProof` transaction's board/player/marker write set, and the Feed's non-photo rendering.

## Files to create / modify

- `src/components/ProofSheet.tsx` (modify) — replace the single photo input with two affordances: 📷 Take photo (`capture="environment"` input) and 🖼️ Library (`accept="image/*"`, no `capture`, the ProfileEditor pattern); hide Library when the event's `photoProofSource` is `camera_only`; stamp which affordance produced the file as `source`; render the "🔥 Marked by N others" heat line under the title from the cell's Tally count.
- `src/data/proofs.ts` (modify) — `attachProof` accepts `source` and `dayIndex`, writes them on the Proof doc, and strips EXIF/GPS before upload when `stripPhotoExif` is on.
- `src/data/storage.ts` (modify) — the EXIF/GPS strip: either make `downscaleImage`'s canvas re-encode the explicit, tested strip path for photo proofs, or add a small strip helper `uploadProofMedia` calls before upload; do not change `uploadAvatar`'s existing behavior.
- `src/components/ProofFeed.tsx` (modify) — badge a `source: 'library'` proof 🖼️ next to its type icon; render the day chip ("Day 2 · Get Sporty") from `dayIndex` (the theme/port lookup lands with `d15-schema-contract`'s `EventDoc.days[]`).
- `src/components/Board.tsx` (modify) — pass the viewed `dayIndex` and the event's `photoProofSource` down into `ProofSheet`'s props (Board already owns the day context once `d15-day-switcher`/`d15-dealing` land; this ticket only wires the prop through, it does not build day switching).

## Implementation notes

#190 resolved posture (2026-07-11): transparency over restriction, per ADR 0001. Library is allowed in EVERY Claim Mode — Honor, Proof-to-mark, and Admin-confirmed alike; never gate it on `claimMode`. `camera_only` is an EVENT-LEVEL admin override (`EventDoc.settings.photoProofSource`, default `camera_or_library`), never tied to Claim Mode — when set, only 📷 Take photo renders. This is a Phase-0-style client-presentational restriction (mirrors the honor-system precedent elsewhere in the app), not a security boundary; a determined client can still bypass it, and that is accepted. Stamp `ProofDoc.source: 'camera' | 'library'` from which affordance produced the file, not from any EXIF/capture inspection. `stripPhotoExif` defaults true: a client-side canvas re-encode on upload so EXIF/GPS never leaves the phone — worth having regardless of #190, since library photos are far more likely to carry geotags than live captures. The social heat line ("🔥 Marked by N others so far") reuses the Prompt's already-subscribed Tally count — no new read, no new doc. Thread `dayIndex` through the proof create so the resulting Feed entry reads "Day 2 · Get Sporty"; the sheet reads it from the viewed Day, the Feed resolves the theme/port label from `EventDoc.days[dayIndex]`. The #181 Cross My Heart pledge stays exactly as is — present only on Claim opens, disabled outside Honor mode — unaffected by this ticket's photo-body changes.

## Tests to add

- `src/components/ProofSheet.test.tsx` (extend) — both affordances render by default; Library is absent when `photoProofSource` is `camera_only`; the Take-photo input keeps `capture="environment"`, the Library input has no `capture` attribute; a submitted photo stamps `source` matching the affordance used; the heat line renders "🔥 Marked by N others" from a supplied Tally count (layer: RTL-jsdom).
- `src/data/proofs.test.ts` (extend) — `attachProof` writes `source` and `dayIndex` on the created Proof doc; a photo upload is EXIF-stripped when `stripPhotoExif` is true and left to the existing re-encode when false (layer: unit).
- `src/data/storage.test.ts` (new or extend) — the strip path removes EXIF/GPS markers from a photo blob before `uploadBytes` (layer: unit, assert on the re-encoded blob).
- `src/components/ProofFeed.test.tsx` (extend) — a `source: 'library'` proof renders the 🖼️ badge; a proof with `dayIndex` renders the "Day N · Theme" chip (layer: RTL-jsdom).

## Acceptance criteria

- **Given** `event.settings.photoProofSource` is `camera_or_library` (default) **When** a Player opens the photo body of the Claim sheet **Then** both 📷 Take photo and 🖼️ Library render, in every Claim Mode.
- **Given** a Player attaches a photo via 🖼️ Library **When** the Proof commits **Then** `ProofDoc.source` is `'library'` and the Feed badges it 🖼️.
- **Given** an admin sets `photoProofSource` to `camera_only` **When** a Player opens the photo body **Then** only 📷 Take photo renders, regardless of Claim Mode.
- **Given** `stripPhotoExif` is true (default) **When** a photo proof uploads **Then** the stored image carries no EXIF/GPS metadata.
- [ ] 📷 Take photo and 🖼️ Library both work end to end in Honor, Proof-to-mark, and Admin-confirmed.
- [ ] Library is never gated by Claim Mode — only by the `camera_only` admin override.
- [ ] EXIF/GPS is stripped from every uploaded photo proof when `stripPhotoExif` is on.
- [ ] Issue #190 closes: the library-picker gap it reported no longer exists.

## Definition of Done

- Spec `specs/d15-claim-sheet-photo.md` created with a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>` and `Closes #190`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

- Depends on #__NUM_d15-schema-contract__ — the `ProofDoc.source`/`dayIndex` and `EventDoc.settings.photoProofSource`/`stripPhotoExif` fields this ticket is the first consumer of.
- Blocks #__NUM_d15-admin-proof-claims__ — the admin panel exposes the `photoProofSource`/`stripPhotoExif` knobs this ticket makes load-bearing.
- Blocks #__NUM_d15-proof-chips-ranks__ — the Leaderboard media chips include the 🖼️ library-source badge this ticket introduces.

## Recommended agent

claude-opus-4-8 @ high — touches the hot `attachProof` transaction and the real, already-filed issue #190; needs careful reasoning about the EXIF-strip re-encode, the source stamp, and keeping the #181 pledge flow and the transactional write set intact.
