**Track:** backend · **Phase:** 1
**Labels:** epic, track:backend, phase-1

## Overview

Phase 1 turns on the backend and infra that the honor-system party game deliberately deferred out of Phase 0. It makes reactive moderation server-authoritative per [ADR 0004](../../../../docs/adr/0004-reactive-moderation.md) — a Function flips a Proof or Prompt to `status: 'hidden'` once its report count crosses the Event's `reportHideThreshold`, while Cloud Vision keeps flagging extreme/illegal content only (never raciness). It adds App Check abuse protection for Firestore + Storage, and stands up the infra Phase 1 needs: the Blaze upgrade that gates Functions + Cloud Vision (with a budget alert first) and the `gaycruisebingo.com` custom domain on Firebase Hosting. The honor system stays intact ([ADR 0001](../../../../docs/adr/0001-honor-system-trust-model.md)): no server-side stat recompute is added or justified as anti-cheat.

## Children

Tracked as native sub-issues (see the linked tree). Members: Phase 1 functions — server-authoritative hide + keep Vision extreme-only + sharp thumbs, App Check enforcement (reCAPTCHA Enterprise), Infra — Cloudflare → Firebase Hosting custom domain + SSL, Infra — Blaze upgrade + budget alert.

## Design sources

- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md`, glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
