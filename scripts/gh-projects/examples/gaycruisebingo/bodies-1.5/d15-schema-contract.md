**Track:** schema · **Phase:** 1.5 · **Wave:** 0 · **Size:** L · **Cut line:** must-have

## Context & scope
Own the shared Phase 1.5 domain type contract in `src/types.ts` and its read-side defaults in `src/data/converters.ts`, so every downstream ticket imports the daily-cards types instead of colliding on the same two files. Implements `daily-cards-spec.md` § "Data model" in full (`DayDef`, the `EventDoc`/`ItemDoc`/`BoardDoc`/`PlayerDoc`/`TallyDoc`/`ProofDoc`/`DoubtDoc`/`MomentDoc` additions, the two new `ThemeId`s, and the new per-day meta doc), plus the `description` field on `ThemeMeta` from § "Theme reference" and the `pool`/`status` additions from § "Item pools and the approval flow." This is a types-and-converter-defaults ticket only — no rules, no UI, no scheduler logic; those are the sibling Wave-0 tickets.

## Current state
- `src/types.ts` — `ThemeId` is a closed union of the 8 existing party themes (`:14-22`, no `welcome-aboard`/`so-long-farewell`). `EventDoc` (`:24-50`) has no `timezone` or `days`; `settings` has `reportHideThreshold` + optional `spicyRatio` only, no `photoProofSource`/`stripPhotoExif`/`visionGate`. `ItemDoc` (`:52-63`) has `status: 'active' | 'hidden'` only (no `pending`/`rejected`), no `pool`, no `approvedBy`/`approvedAt`. `BoardDoc` (`:76-81`) has no `dayIndex` — one Board per Player per Event today, path `events/{eventId}/boards/{uid}`. `PlayerDoc` (`:83-93`) carries only Event-wide `bingoCount`/`squaresMarked`/`firstBingoAt`, no per-day breakdown. `TallyDoc` (`:156-160`), `ProofDoc` (`:110-129`), `DoubtDoc` (`:166-177`), `MomentDoc` (`:184-191`) all carry no `dayIndex`. `MomentKind` (`:179`) is `'bingo' | 'blackout' | 'first_bingo'` only — no finale beats. There is no day-meta doc type at all.
- `src/data/converters.ts` — `eventConverter` (`:43-57`) already defaults a missing `bannedUids` to `[]`; that is the precedent this ticket follows for `days`/`timezone` and for `itemConverter`'s `pool` default. `itemConverter` (`:63-69`) passes through with no defaulting.
- `src/theme/themes.ts` — `ThemeMeta` (`:3-7`) is `{ id, label, emoji }`, no `description`; `THEMES` (`:10-19`) lists the 8 existing entries with no description text.
- **FROZEN, not touched here:** the 5×5 `Cell` contract (`:65-74`), `ClaimMode`, `UserDoc`, `ClaimDoc` — unchanged by Phase 1.5.
- **Being revised:** every type named above, per the spec's data model. Path/route wiring for the new day-scoped Board location (`events/{eventId}/days/{dayIndex}/boards/{uid}`) and for the day-meta doc is explicitly OUT of scope here — this ticket defines the shapes; `src/data/paths.ts` helpers are added by the consuming tickets (#__NUM_d15-dealing__ for boards, #__NUM_d15-scoring-aggregates__ for day meta) so this HOT-file ticket stays narrow.

## Files to create / modify
- `src/types.ts` (modify, HOT owner) — add `DayDef`; extend `ThemeId` with `'welcome-aboard' | 'so-long-farewell'`; extend `EventDoc` with `timezone: string`, `days: DayDef[]`, `frozenAt?: number` (finale freeze stamp), and `settings.photoProofSource?`/`stripPhotoExif?`/`visionGate?`; extend `ItemDoc` with `pool: 'main' | 'embark' | 'farewell'` and `status` adding `'pending' | 'rejected'`, plus `approvedBy?: string`/`approvedAt?: number`; extend `BoardDoc` with `dayIndex: number`; extend `PlayerDoc` with `dayStats?: Record<number, { bingoCount: number; squaresMarked: number; firstBingoAt: number | null }>`; extend `TallyDoc` with `lastMarkedAt?: number` and `dayIndex?: number`; extend `ProofDoc` with `source?: 'camera' | 'library'` and `dayIndex?: number`; extend `DoubtDoc` with `dayIndex?: number`; extend `MomentDoc` with `dayIndex?: number` and extend `MomentKind` with `'last_call' | 'podium'` (the two finale beats); add a new `DayMetaDoc` interface — `{ firstBingo?: { uid: string; displayName: string; at: number } }` — for `events/{eventId}/days/{dayIndex}/meta`.
- `src/data/converters.ts` (modify, HOT owner) — `itemConverter` defaults a missing `pool` to `'main'` (mirrors the existing `bannedUids` default pattern at `:50-55`, and matches the spec's § "Migration": existing items get `pool: 'main'` via converter default, no data backfill); `eventConverter` defaults a missing `days` to `[]` and a missing `timezone` to `'Europe/Rome'` so a not-yet-migrated Event doc never throws downstream; add a `dayMetaConverter` (passthrough, no id needed — the doc id IS the dayIndex, encoded in the path) for the new `DayMetaDoc`.
- `src/theme/themes.ts` (modify) — add `description: string` to the `ThemeMeta` interface, and populate it verbatim for the 8 existing entries from `daily-cards-spec.md` § "Theme reference" so this ticket's own `npm run typecheck`/`npm test` stay green without waiting on #__NUM_d15-two-themes__. #__NUM_d15-two-themes__ adds the two new `ThemeId` entries (with their own descriptions) and the two new `themes.css` token blocks — it does not touch the 8 existing descriptions again.
- `src/data/d15-schema-contract.test.ts` (new) — converter-default assertions (see Tests to add).

## Implementation notes
- **Snapshot at unlock, lazy deal**: `DayDef.snapshotItemIds?: string[]` is the frozen list stamped by the scheduler (#__NUM_d15-scheduler-unlock__) at that Day's `unlockAt`; it is optional here on purpose — absent until the function runs.
- **No repeats across the cruise**: this ticket adds no logic for it (that's #__NUM_d15-dealing__), but the type contract must not block it — `BoardDoc.dayIndex` is what lets the dealer look up a Player's earlier Day Cards.
- **Cruise-wide First to BINGO excludes tutorial days** (resolved 2026-07-11): `DayMetaDoc.firstBingo` is per-Day (every Day, tutorial included, gets its own daily honor); the cruise-wide anchor to Days 2–9 is a query-time filter in #__NUM_d15-scoring-aggregates__, not a type-level distinction.
- **Photo source (#190)**: `ItemDoc`/`ProofDoc` are untouched by the photo-source decision except `ProofDoc.source?`; the event-level `settings.photoProofSource` default (`camera_or_library`) is a runtime default applied by #__NUM_d15-claim-sheet-photo__, not baked into the type as a default value.
- **Grandfathering**: every existing `active` `ItemDoc` stays `active`; the approval gate (`pending`/`rejected`) applies only to submissions written after #__NUM_d15-approvals__ ships. This ticket only adds the states to the type; it does not migrate any data.
- **Migration**: per spec § "Migration," pre-cruise ship needs no live-cruise migration if this deploys before July 15 — the converter defaults above exist for defensive correctness (a not-yet-migrated doc read in dev/tests), not because a migration script is expected.
- **ThemeMeta.description** is player-facing text (locked-day dress-code tease, theme-switcher richness) — copy it from the spec table exactly, do not paraphrase.
- HOT-file owner: downstream tickets import these types/converters rather than editing `src/types.ts` or `src/data/converters.ts` directly.

## Tests to add
- `src/data/d15-schema-contract.test.ts` — `itemConverter.fromFirestore` on a snapshot with no `pool` field defaults to `pool: 'main'` (layer: unit; mirrors the existing `bannedUids`-default assertion style).
- `src/data/d15-schema-contract.test.ts` — `eventConverter.fromFirestore` on a snapshot with no `days`/`timezone` defaults to `days: []` / `timezone: 'Europe/Rome'` (layer: unit).
- `src/theme/*.test.*` (existing `w1-themes`/`a11y-badge-contrast` suites) — assert every `THEMES` entry (including the 8 existing) has a non-empty `description`; this is the "description-presence" check the brief's Wave-1 tickets extend, added here since the 8 existing values land in this PR (layer: unit).
- `npm run typecheck` — every renamed/extended field compiles and no source references a removed field (layer: typecheck).

## Acceptance criteria
- **Given** an `ItemDoc` snapshot written before this ships (no `pool` key) **When** it is read through `itemConverter` **Then** it resolves to `pool: 'main'` and no write re-introduces a missing `pool`.
- **Given** an `EventDoc` snapshot written before this ships (no `days`/`timezone`) **When** it is read through `eventConverter` **Then** it resolves to `days: []` / `timezone: 'Europe/Rome'` rather than throwing downstream.
- **Given** the 10-theme `ThemeMeta` contract **When** `npm test` runs **Then** all 8 existing entries have a `description` and typecheck passes with the 2 new `ThemeId`s reserved (added by #__NUM_d15-two-themes__).
- [ ] `DayDef`, `DayMetaDoc`, and every `EventDoc`/`ItemDoc`/`BoardDoc`/`PlayerDoc`/`TallyDoc`/`ProofDoc`/`DoubtDoc`/`MomentDoc` addition above lands in `src/types.ts`.
- [ ] `itemConverter`/`eventConverter` defaults added and tested.
- [ ] `ThemeMeta.description` added to the interface and populated for the 8 existing themes.
- [ ] `npm run typecheck` green with no downstream call sites broken.

## Definition of Done
- [ ] Spec `specs/d15-schema-contract.md` created **with a matching test** (checker `scripts/ci/check_spec_test_alignment` matches basename → a test under `tests/**` or `src/**/*.test.*`; design-only specs use frontmatter `tested: false` + `reason:`)
- [ ] `npm run typecheck` · `npm test` · `npm run build` green; `md-prose-wrap` clean
- [ ] PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through `REVIEW_POLICY.md` to merge
- [ ] Board discipline per `docs/agents/ticket-workflow.md` (claim → In progress; PR → In review; merge → Done)

## Dependencies
- Depends on: none.
- Blocks #__NUM_d15-firestore-rules__ — rules read the new `days`/`ItemDoc.pool`/`status` shape.
- Blocks #__NUM_d15-scheduler-unlock__ — the scheduler writes `DayDef.snapshotItemIds` and the `DayMetaDoc`.
- Blocks #__NUM_d15-two-themes__ — extends the `ThemeMeta`/`ThemeId` contract this ticket establishes.
- Blocks #__NUM_d15-tutorial-seed__, #__NUM_d15-docs-glossary__, #__NUM_d15-claim-sheet-photo__ — all consume the new types directly.

## Recommended agent
claude-opus-4-8@high — a HOT-file type contract touched by every other Phase 1.5 ticket; get the shape right once, under close review.
