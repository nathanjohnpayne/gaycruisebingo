**Track:** backend · **Phase:** 2 (hardening)
**Labels:** epic, track:backend, phase-2, hardening

## Overview

Phase 2 is the post-launch **hardening** pass — the server-side defense-in-depth and durability work the honor-system party game deliberately deferred out of the Phase 0 embarkation MVP, landing as live auto-updating PWA releases during and after the sailing. It turns on **Cloud Vision** SafeSearch over user-generated media — flagging extreme/illegal content only, never raciness ([ADR 0004](../../../../docs/adr/0004-reactive-moderation.md)) — split into a proof-scanning producer and a moderation-enforcement consumer; enforces **App Check** (reCAPTCHA Enterprise) abuse protection for Firestore + Storage; and makes the winners durable with a **post-sailing archive** (freeze the Event, permanent Leaderboard + First-to-BINGO hall of fame) per the PRD's "remember the winners" goal. The honor system stays intact ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)): none of this authorizes a Player's Mark or adds anti-cheat — it is app attestation, content safety, and durability only.

## Children

Tracked as native sub-issues (see the linked tree):

- **App Check enforcement (reCAPTCHA Enterprise)** — moved here from the Phase 1 backend epic (#__NUM_epic-backend__).
- **Cloud Vision — proof-media SafeSearch scanning + `sharp` thumbnails** (producer).
- **Cloud Vision — wire SafeSearch flags into moderation** (auto-hide + admin console) (consumer).
- **Post-sailing archive** — freeze the Event + durable Leaderboard / First-to-BINGO hall of fame.

## Relationship to already-merged Phase 1 work

The Phase 1 backend infra this builds on has largely shipped: the **Blaze upgrade + budget alert** (#__NUM_w4-infra-blaze-budget__, merged), the **custom domain** (#__NUM_w4-infra-domain__, merged), and the **server-authoritative report-count auto-hide** (#__NUM_w4-phase1-functions__ → PR #127, `functions/src/autohide.ts`, merged). Cloud Vision was then deliberately **gated off** by a human decision (#126 → PR #128 — an off-by-default `ENABLE_VISION_MODERATION` flag) so the #101 email notifiers could deploy without `moderateProof`'s us-central1/us-east1 region mismatch blocking the whole `functions/` deploy. The two Cloud Vision tickets here are the tracked **re-enablement** of that deferral: #__NUM_p2-vision-proof__ turns the producer back on (region fix + flag + Vision API), and #__NUM_p2-vision-moderation__ adds the missing Vision-flag → auto-hide that the shipped report-count auto-hide intentionally leaves alone (its "active-only" invariant preserves the stronger `flagged` state). The dependency edges are cross-epic and explicit; nothing here reorganizes #__NUM_epic-backend__.

## Design sources

- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md` (Technical Approach → Phase 1; the "remember the winners" goal; risks table — Cloud Vision flagging, Blaze budget), glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
