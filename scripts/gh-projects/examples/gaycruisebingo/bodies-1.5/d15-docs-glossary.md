**Track:** docs · **Phase:** 1.5 · **Wave:** 1 · **Size:** S · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "Glossary additions (CONTEXT.md language)": adds the seven new Phase 1.5 domain terms — Day, Day Card, Tutorial Day, Pool, Pending, Day Snapshot, Tally Card — to `CONTEXT.md`'s `## Language` section, in the same style as the existing entries (bolded term, definition, `_Avoid_` note where the spec gives one).

## Current state

`CONTEXT.md`'s `## Language` section is organized into four subsections — "Event & pool," "The card & play," "People," "Trust, proof & claims" (`CONTEXT.md:5-63`) — each entry formatted `**Term**: definition. _Avoid_: alternates.` (e.g. `**Board**: ... _Avoid_: Card (fine informally), grid`, `CONTEXT.md:17`). None of the seven Phase 1.5 terms exist yet. Two existing entries are affected by this generation's model, though this ticket does not redefine them: `**Board**` (`:17`) becomes "Day Card" in player-facing copy while "Board" stays the technical term (spec: "'Board' continues to mean this object; 'Day Card' is the player-facing name") — this ticket adds the Day Card entry that clarifies the relationship, but does not edit the existing Board entry's wording. `**Theme**` (`:13`) is unchanged by this ticket; the two new ThemeIds are `#__NUM_d15-two-themes__`'s concern.

## Files to create / modify

- `CONTEXT.md` (modify) — add the seven glossary entries to `## Language`, placed in a sensible existing or new subsection (e.g. a new "Days & pools" subsection alongside "Event & pool," since Day/Pool/Snapshot are schema-adjacent to Event).
- `specs/d15-docs-glossary.md` (new) — the docs-only spec for this change (see Definition of Done below).

## Implementation notes

- Add these seven entries, matching the spec's definitions and `_Avoid_` notes in spirit (not necessarily verbatim wording, but no drift on meaning):
  - **Day**: one calendar day of the sailing, owning a date, port, Theme, and unlock state. The Event owns an ordered list of ten Days. _Avoid_: round, stage.
  - **Day Card**: a Player's Board for one Day — same 5×5 contract as today, now one per Player per Day. "Board" continues to mean this object; "Day Card" is the player-facing name.
  - **Tutorial Day**: the embark and disembark Days. Dealt from their own curated pools, framed as onboarding/farewell rather than competition.
  - **Pool**: which item set a Prompt belongs to — `main`, `embark`, or `farewell`. Only `main` accepts player submissions.
  - **Pending**: a submitted Prompt awaiting admin approval. Invisible to players; never dealt.
  - **Day Snapshot**: the frozen list of approved Prompts captured at a Day's unlock moment. All of that Day's deals draw from the snapshot, so everyone's card reflects the same pool regardless of when they first open it.
  - **Tally Card**: the Feed's live, aggregated entry for one Prompt on one Day — bumped toward the top as new Players mark it. A rendering of the Tally, not a new record. _Avoid_: wave, streak.
- This is a documentation-only ticket: no `src/` code changes. It does not implement Days, Pools, Snapshots, or Tally Cards — those are `#__NUM_d15-schema-contract__`, `#__NUM_d15-day-switcher__`, `#__NUM_d15-scheduler-unlock__`, and `#__NUM_d15-tally-cards__` respectively. This ticket only names them so every later ticket's body and code comments can use the terms consistently from Wave 1 onward.
- Per `docs/agents/documentation-rules.md`, `CONTEXT.md` is a repo-root doc, directly editable; soft-wrap the new prose (one physical line per paragraph), matching the rest of the file.

## Tests to add

- No `src/` runtime test applies — this is a docs-only change. Per the spec-test alignment convention, `specs/d15-docs-glossary.md` uses frontmatter `tested: false` with a `reason:` explaining there is no runtime surface (see `specs/x-multi-event-schema.md` and `specs/sec-clear-text-logging-seed.md` for the established pattern).
- If any existing test asserts the glossary's term count or structure (none found in this codebase at authoring time), extend it; otherwise this ticket adds none.

## Acceptance criteria

- **Given** `CONTEXT.md` **When** it is read **Then** all seven terms (Day, Day Card, Tutorial Day, Pool, Pending, Day Snapshot, Tally Card) appear in `## Language`, each with a definition and, where specified, an `_Avoid_` note.
- **Given** the existing Board/Theme entries **When** this ticket merges **Then** their wording is unchanged (only new entries added, no redefinition).
- [ ] All seven terms added.
- [ ] `specs/d15-docs-glossary.md` created with `tested: false` + `reason:` frontmatter.
- [ ] `md-prose-wrap` clean on the diff.

## Definition of Done

- Spec file under `specs/d15-docs-glossary.md` using frontmatter `tested: false` + `reason:` (docs-only spec — spec↔test alignment CI accepts this pattern, see `specs/x-multi-event-schema.md`).
- `npm run typecheck` + `npm test` + `npm run build` green (no `src/` changes expected to affect any of these, but run them anyway); md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-schema-contract__ — the terms describe fields (`DayDef`, `pool`, `status: 'pending'`, `snapshotItemIds`) that ticket introduces; this ticket should land after (or alongside, late) that one so the glossary doesn't document a schema that doesn't exist yet.

## Recommended agent

claude-sonnet-5 @ medium — a small, low-risk, docs-only ticket; the only care needed is matching the existing glossary's exact tone and not disturbing unrelated entries.
