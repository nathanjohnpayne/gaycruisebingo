**Track:** launch · **Phase:** hardening
**Labels:** epic, track:launch, hardening

## Overview

The launch epic proves the round works end-to-end and gates embarkation. A Playwright e2e drives the full happy path — a Player joins, Marks a winning line to BINGO, and lands on the Leaderboard with zero coordination beyond a shared link (the PRD's headline metric) — plus the offline-Mark-survives-reload assertion from [ADR 0006](../../../../docs/adr/0006-offline-resilience.md), all against the Firebase emulator. A cross-device matrix, a launch runbook, a one-handed reachability check, and the printed 12-card PDF fallback (for total connectivity failure only) close out the pre-sail checklist. Finally, a design-only spec records that the data model is already Event-scoped, so a future second cruise is just a new Event doc — with no multi-tenant rooms ([ADR 0003](../../../../docs/adr/0003-pool-is-pre-cruise.md)).

## Children

Tracked as native sub-issues (see the linked tree). Members: E2E happy-path (join → Mark → BINGO → Leaderboard) + offline-mark test against the emulator, Cross-device matrix + launch checklist + printed-PDF fallback, Multi-event schema readiness (design-only).

## Design sources

- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md`, glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
