**Track:** moderation · **Phase:** 0
**Labels:** epic, track:moderation, phase-0

## Overview
This epic groups the reactive-moderation surface, the GA4 analytics catalog, the security/rules hardening pass, and the two scaffold reconciliations the ADRs supersede. Moderation is reactive (ADR 0004): a report increments a counter, and at `reportHideThreshold` every client presentationally hides the Prompt or Proof, while an Admin can still hard-hide/restore. Hardening documents that self-writable Boards and Players are intentional (ADR 0001) and that every Mark publishes to a public per-Prompt Tally (ADR 0002), so a later reviewer doesn't "fix" them, and it closes the protected-path review gap. The two reconciliation children are net-removals: the Cloud Run OG renderer + `share` pages (superseded by on-device Share Cards, ADR 0005) and `recomputeStats`-as-anti-cheat (self-writable Players are intentional, ADR 0001).

## Children
Tracked as native sub-issues (see the linked tree). Members:
- Admin & moderation console: reactive auto-hide at `reportHideThreshold` (client Phase 0) + report queue + ban — #__NUM_w2-admin-console__
- GA4 events + DebugView + consent notice (complete the 12-event set) — #__NUM_w2-ga4-events__
- Security & rules hardening: noindex, acceptable-use page, self-writable-by-design docs, protected-path policy — #__NUM_w3-security-hardening__
- Reconciliation: remove `cloud-run/og-renderer` + `share` function + `/s` rewrite; keep static `og-default.png` — #__NUM_recon-share-og__
- Reconciliation: remove `recomputeStats` as anti-cheat + fix `phase-1-deploy.md` stat-locking guidance — #__NUM_recon-recompute-stats__

## Design sources
- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md`, glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
