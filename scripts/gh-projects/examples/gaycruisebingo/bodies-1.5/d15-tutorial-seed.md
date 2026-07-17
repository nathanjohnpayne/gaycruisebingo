**Track:** tutorial-content · **Phase:** 1.5 · **Wave:** 1 · **Size:** M · **Cut line:** must-have

## Context & scope

Implements `daily-cards-spec.md` § "Tutorial item lists", the `days[]` row of § "Itinerary and schedule", and the per-day override half of § "Free space per day". Seeds the two curated pools that back the tutorial Days — Welcome Aboard (embark, 28 Prompts) and So Long, Farewell (farewell, 28 Prompts) — and seeds `EventDoc.timezone` + `EventDoc.days[]`, the ten-Day mapping that drives the whole feature's unlock/theme/pool machinery.

## Current state

- `src/data/seed.ts` exports `FREE_TEXT` (`:3`) and `SEED_ITEMS: { text: string; spicy: boolean }[]`, the canonical 80-entry main pool (`:5-87`, per `specs/seed-and-composition.md`). No embark/farewell lists exist.
- `scripts/seed.mjs` mirrors `SEED_ITEMS` as its own literal `ITEMS` constant (`:85` onward) — deliberately NOT imported, so the two stay in sync only because `src/data/seed-and-composition.test.ts` asserts their content matches. `EVENT_SEED` (`:27-42`) has no `timezone` or `days` key.
- `ItemDoc` (`src/types.ts:52-63`, pre-#__NUM_d15-schema-contract__) has no `pool` field yet — every seeded item today is implicitly `main`. That field, plus the `pending`/`rejected` status values, are added by #__NUM_d15-schema-contract__; this ticket seeds against the widened contract.
- **FROZEN for this ticket:** the 80-entry main pool (`SEED_ITEMS`) and its `verifySeedPool` drift-check machinery — this ticket adds two new curated pools alongside it, it does not touch the main pool's content or the drift-check contract.

## Files to create / modify

- `src/data/seed.ts` (modify) — add `EMBARK_ITEMS` and `FAREWELL_ITEMS` (28 entries each, `{ text: string; spicy: false; pool: 'embark' | 'farewell' }`, all tame per spec — tutorial pools are unstratified), plus `DAYS: DayDef[]` (or equivalent), the ten-row mapping below, and the two `freeText` overrides.
- `scripts/seed.mjs` (modify) — mirror `EMBARK_ITEMS`/`FAREWELL_ITEMS` as separate literals (same no-cross-module-import convention `ITEMS` already follows for the main pool), extend the write path to seed all three pools with `status: 'active'` (curated pools have no submission/approval flow — spec § "Item pools and the approval flow"), and add `timezone: 'Europe/Rome'` + the ten-row `days` array to `EVENT_SEED`.

## Implementation notes

- Seed both lists **verbatim**, in the spec's given order, each item as its own Prompt doc with `pool` set accordingly, `spicy: false`, `status: 'active'` (curated pools are admin-editable but never go through the pending-approval gate #__NUM_d15-approvals__ adds to `main`):

  **Welcome Aboard (embark pool, 28):** Get your favorite dessert · Find your muster station · Get lost finding your cabin · Ride an elevator the wrong way · Locate the late-night pizza · First soft-serve of the cruise · Toast at the sailaway party · Wave goodbye to land · Hear the ship's horn · Meet someone from another country · Learn a crew member's name · Befriend a bartender · Compliment a stranger's outfit · Ask "where are you from?" three times · Exchange Instagrams with a new friend · Spot matching Speedos · Unpack a truly unhinged outfit · Plan tomorrow's party look · Test the bed (nap counts) · Stateroom mirror selfie · Balcony or porthole photo · Order a frozen drink with zero shame · Sunscreen a stranger's back (or volunteer yours) · Scope out the gym you'll never use · Find the theater · Locate the Dick Deck (reconnaissance only) · Sign up for something you'll never attend · Overhear someone already complaining

  **So Long, Farewell (farewell pool, 28):** One last sunrise or sunset photo · Say goodbye to your cruise boyfriend · Exchange numbers with your new best friend · Promise to visit someone in their city · Say "see you next year"—and mean it · Book next year's cruise (or swear you will) · Final soft-serve · Thank your cabin steward by name · Thank the bartender who carried you · One last lap around the ship · Last dance to one more song · Group photo with your chosen family · Cry (or valiantly almost cry) · Find glitter somewhere impossible · Suitcase no longer closes · Wear your softest airport look · Breakfast in sunglasses, one last time · Swap favorite memories of the week · "I'm never drinking again" (sincere) · Post the photo dump · Screenshot the group chat's new name · Set a reunion date · Give away your leftover sunscreen · Realize you never used the gym · Hum the song of the week · Take home a (legal) souvenir · Five-star shoutout for your favorite crew member · Stand at the back of the ship and feel things

- Seed `EventDoc.timezone = 'Europe/Rome'` — the single event-timezone the spec establishes (every port is CEST, so no ship-clock drift handling is needed).
- Seed `EventDoc.days[]`, verbatim from spec § "Itinerary and schedule" (index 0-based; `unlockAt` = 08:00 Europe/Rome on `date`, except index 0 which unlocks at event-open per the spec's one exception):

  | index | date | port | portEmoji | theme | pool | tutorial |
  |---|---|---|---|---|---|---|
  | 0 | 2026-07-15 | Trieste | 🇮🇹 | `welcome-aboard` | `embark` | true |
  | 1 | 2026-07-16 | Split | 🇭🇷 | `get-sporty` | `main` | false |
  | 2 | 2026-07-17 | Valletta | 🇲🇹 | `duty-free` | `main` | false |
  | 3 | 2026-07-18 | Palermo | 🇮🇹 | `glamiators` | `main` | false |
  | 4 | 2026-07-19 | Sorrento | 🇮🇹 | `neon-playground` | `main` | false |
  | 5 | 2026-07-20 | Rome (Civitavecchia) | 🇮🇹 | `summer-white` | `main` | false |
  | 6 | 2026-07-21 | Nice | 🇫🇷 | `dog-tag` | `main` | false |
  | 7 | 2026-07-22 | Marseille | 🇫🇷 | `revival-disco` | `main` | false |
  | 8 | 2026-07-23 | Sea Day | 🌊 | `seriously-pink` | `main` | false |
  | 9 | 2026-07-24 | Barcelona | 🇪🇸 | `so-long-farewell` | `farewell` | true |

- Free-space overrides (`DayDef.freeText`), verbatim: index 0 (Welcome Aboard) = **"You made it aboard"**; index 9 (So Long, Farewell) = **"We had the best damn time"**. Every other Day has no `freeText` override and falls back to the existing global `FREE_TEXT` ("Complain about circuit music").
- All eight main-day themed Days share `pool: 'main'` — theme is visual only, per the spec's already-made decision that all eight themed days deal from the shared main pool.
- This ticket seeds curated content and schedule data only. `snapshotItemIds` stamping is the scheduler's job (#__NUM_d15-scheduler-unlock__), not seeded here.
- Deploy ≠ reseed: the pool is Firestore data, not the JS bundle (`specs/seed-and-composition.md` § "Deploying a pool change"). After this lands and is deployed, `scripts/seed.mjs` must actually be RUN against the live project for the two curated pools and the `days[]`/`timezone` fields to reach players — run `npm run verify:seed` post-deploy as the drift smoke test.

## Tests to add

- `src/data/seed-and-composition.test.ts` (extend, or a new sibling file if cleaner) — `EMBARK_ITEMS`/`FAREWELL_ITEMS` each have exactly 28 entries, no duplicate `text` within or across pools, every entry `spicy: false`, and the `pool` tag matches the constant's name.
- `src/data/seed-and-composition.test.ts` (extend) — `scripts/seed.mjs`'s mirrored embark/farewell literals match `src/data/seed.ts`'s content exactly (same sync-check pattern the main-pool `SEED_ITEMS`/`ITEMS` comparison already uses).
- `src/data/seed-and-composition.test.ts` (extend) — `EVENT_SEED`/the seeded `EventDoc` payload carries `timezone: 'Europe/Rome'` and a 10-entry `days` array matching the table above field-for-field, including the two `freeText` overrides and no `freeText` on the other eight.
- Rules-emulator layer (`vitest.rules.config.ts`) — a fresh seed writes exactly 28 active `embark`-pool and 28 active `farewell`-pool items alongside the 80 `main`-pool items, none carrying `status: 'pending'`.

## Acceptance criteria

- **Given** the seed script runs on a fresh Event **When** it completes **Then** `events/{id}/items` holds 28 active `embark` Prompts and 28 active `farewell` Prompts, verbatim from the spec, in addition to the existing 80 `main` Prompts.
- **Given** the seeded `EventDoc` **When** read **Then** `timezone === 'Europe/Rome'` and `days.length === 10`, each row matching the itinerary table (date, port, portEmoji, theme, pool, tutorial, freeText where specified).
- **Given** a pool change to the curated lists lands and is deployed **When** `npm run verify:seed` is run **Then** it reports drift until the seed script is actually re-run against the live project (deploy ≠ reseed, per `specs/seed-and-composition.md`).
- [ ] Both curated lists are seeded verbatim, in order, with the correct `pool` tag.
- [ ] `EventDoc.days[]` and `timezone` match the spec table exactly.
- [ ] The two `freeText` overrides are seeded on exactly Day 0 and Day 9.
- [ ] `scripts/seed.mjs`'s mirrored literals stay in sync with `src/data/seed.ts` (asserted by test, not just convention).

## Definition of Done

- Spec file `specs/d15-tutorial-seed.md` created WITH a matching test (spec↔test alignment CI).
- `npm run typecheck` + `npm test` + `npm run build` green; md-prose-wrap clean.
- PR body `Closes #<this issue>`; authored `nathanjohnpayne`, driven through REVIEW_POLICY.md to merge.
- Board discipline per `docs/agents/ticket-workflow.md`.

## Dependencies

Depends on #__NUM_d15-schema-contract__ (the `ItemDoc.pool` field, `DayDef` shape, and `EventDoc.timezone`/`days[]` this ticket populates). Blocks #__NUM_d15-day-switcher__ and #__NUM_d15-tutorial-banners__ (both read the seeded `days[]` and `freeText` values). Blocks #__NUM_d15-dealing__ (the tutorial pools it deals unstratified from).

## Recommended agent

claude-sonnet-5@medium — high-volume verbatim content transcription plus a mechanical schema-shaped seed extension; low design risk, worth double-checking the transcribed lists against the spec byte-for-byte.
