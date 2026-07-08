**Track:** foundation · **Phase:** 0
**Labels:** epic, track:foundation, phase-0

## Overview
Foundation wave: the test harness, the shared domain type contract, the app shell, the Firestore/Storage rules baseline, and Firestore offline persistence. This epic reconciles the pre-ADR scaffold to ADRs 0001, 0002, 0004, and 0006 and stands up the four test layers (unit, RTL-jsdom, rules-emulator, Playwright e2e) that every later ticket's Definition of Done depends on. Nothing here ships a Player-facing feature; it makes the honor-system, Tally-visibility, reactive-moderation, and offline invariants provable and gives Wave 1–4 stable, collision-free mount points (types, routes, rules) to build on.

## Children
Tracked as native sub-issues (see the linked tree). Members: Wire the test harness (w0-test-harness), Reconcile the domain type contract (w0-type-contract), App shell & bottom-tab navigation (w0-app-shell), Firestore rules baseline + emulator tests (w0-firestore-rules), Storage rules review + emulator tests (w0-storage-rules), Firestore offline persistence (w0-offline-persistence).

## Design sources
- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md`, glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
