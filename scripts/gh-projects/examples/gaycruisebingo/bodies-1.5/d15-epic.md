**Track:** day-ui · **Phase:** 1.5
**Labels:** epic, phase-1.5, track:day-ui

## Overview
Phase 1.5 turns the single, whole-cruise Board into ten themed Day Cards, one per day of the July 15–24, 2026 Trieste → Barcelona sailing. Each Day owns a date, port, Theme, and an 08:00 Europe/Rome unlock (the embark Day is the one exception — live from Event open). A scheduled Cloud Function stamps a Day Snapshot at unlock from that Day's Pool, and a Player's Day Card is lazily dealt from the snapshot on first open, drawing 10 spicy / 14 tame from the shared main Pool (the eight party days) with no repeats across the cruise until the Pool exhausts and resets. The two non-party days become Tutorial Days — Welcome Aboard (embark) and So Long, Farewell (disembark) — dealt from their own curated, admin-only Pools and framed as onboarding/farewell rather than competition. New main-Pool submissions now land Pending until an Admin approves them, so nothing untested reaches a live card. Scoring stays one cruise-long Leaderboard (summing bingos and squares across every Day Card) plus a per-day First to BINGO honor, with the cruise-wide First to BINGO anchored to the eight main-game days so the trivially-easy embark card can't decide it. The bottom tab bar simplifies to Card · Feed · Ranks · More, with Prompts and Admin relocating inside the More menu and the top bar handing profile-edit and sign-out there too. A two-beat finale — a 20:00 Day 9 last-call standings Moment, then an 08:00 Day 10 freeze + podium — closes the cruise.

Canonical spec: `plans/daily-cards-spec.md` (read it in full — every product decision below is RESOLVED there, § "Resolved decisions"). Wireframes: `plans/daily-cards-wireframes.html`.

## Children
Tracked as native sub-issues (see the linked tree).

**Wave 0 — schema, rules, scheduler, tab contract (must-have, no player-facing UI yet):**
#__NUM_d15-schema-contract__ Phase 1.5 schema & type contract · #__NUM_d15-firestore-rules__ Firestore rules for day-scoped boards & unlock gating · #__NUM_d15-scheduler-unlock__ Scheduler: unlockDay snapshot + finale beats · #__NUM_d15-tab-contract__ Tab-contract revision: Card · Feed · Ranks · More

**Wave 1 — dealing, day switcher, themes, tutorial seed, More menu, glossary (must-have):**
#__NUM_d15-dealing__ Per-day dealing from the Day Snapshot · #__NUM_d15-day-switcher__ Day switcher strip + locked-day preview · #__NUM_d15-two-themes__ Two new Themes + ThemeMeta description · #__NUM_d15-tutorial-seed__ Seed embark + farewell curated Pools · #__NUM_d15-more-menu__ More menu (⋯/avatar tab) · #__NUM_d15-docs-glossary__ CONTEXT.md glossary additions

**Wave 2 — approvals, claim sheet photo, scoring, tutorial banners (must-have):**
#__NUM_d15-approvals__ Item approval flow + Admin approvals queue · #__NUM_d15-claim-sheet-photo__ Claim sheet #190: photo source + badge + EXIF strip · #__NUM_d15-scoring-aggregates__ Cruise-wide scoring + per-day First to BINGO · #__NUM_d15-tutorial-banners__ Embark/farewell banners + warm-up tags

**Wave 3 — nice-to-have, post-sailaway (can ship mid-cruise):**
#__NUM_d15-coach-overlay__ First-open coach overlay · #__NUM_d15-text-size__ Text size control · #__NUM_d15-tally-cards__ Tally Cards in the Feed · #__NUM_d15-finale__ Two-beat finale content · #__NUM_d15-proof-chips-ranks__ Latest-proof media chips on Ranks · #__NUM_d15-pwa-toasts__ Install/update toast presentation · #__NUM_d15-icons-lucide__ Lucide iconography · #__NUM_d15-admin-schedule__ Admin Schedule editor · #__NUM_d15-admin-proof-claims__ Admin Proof & Claims panel

## Design sources
- Canonical spec: `plans/daily-cards-spec.md` — read in full before starting any child ticket.
- Wireframes: `plans/daily-cards-wireframes.html` (per-state reference; `data-lucide` attributes are the icon spec for #__NUM_d15-icons-lucide__).
- Glossary: `CONTEXT.md` (additions land via #__NUM_d15-docs-glossary__).
- Repo conventions: `docs/agents/{code-modification-rules,testing-requirements,documentation-rules,ticket-workflow}.md`.
