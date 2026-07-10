# Repository Overview

This repository is **Gay Cruise Bingo** — a live, multiplayer bingo web app (PWA) for playing with friends on a gay cruise. Players sign in, get a randomized 5×5 card of things that might happen on the sailing, and mark them off as they go, with a shared leaderboard, eight party themes, PWA install, and printed cards as the offline fallback. Live at <https://gaycruisebingo.web.app>. The product overview is in [`README.md`](../../README.md) and the domain vocabulary in [`CONTEXT.md`](../../CONTEXT.md).

## Stack

Vite + React 18 + TypeScript (strict) · Firebase (Auth · Firestore · Storage · Hosting · Analytics) · `vite-plugin-pwa` · Cloud Functions (Vision moderation + thumbnails, Phase 1). Phase 0 is Cloud Functions-free — stats are client-authoritative and the leaderboard is a client-side sort ([ADR 0001](../adr/0001-honor-system-trust-model.md)).

## Agent role

Build and maintain the Gay Cruise Bingo app — game logic, Firebase data/rules, auth, themes, and the Phase-1 proof/moderation system — keeping `specs/`, `docs/`, and tests in step with behavior. Ship changes via branch + PR under the review policy (see [`AGENTS.md`](../../AGENTS.md) § Code Review Policy).

## Relationship to mergepath

This repo was scaffolded from — and tracks — the **mergepath** template, the canonical implementation of the AI Agent Tooling Standard for this account. It therefore carries mergepath's governance and tooling: the review policy ([`REVIEW_POLICY.md`](../../REVIEW_POLICY.md)), the 1Password-backed deploy tooling ([`DEPLOYMENT.md`](../../DEPLOYMENT.md)), and this `docs/agents/` set. Gay Cruise Bingo is a **consumer** of that template, not the template hub — the hub-only propagation/bootstrap docs alongside this one (e.g. [`propagation-ordering.md`](propagation-ordering.md), [`templated-propagation.md`](templated-propagation.md), [`bootstrap-runbook.md`](bootstrap-runbook.md)) describe machinery that runs in mergepath, not here.
