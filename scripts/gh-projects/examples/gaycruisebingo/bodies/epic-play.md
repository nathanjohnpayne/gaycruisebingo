**Track:** play · **Phase:** 0
**Labels:** epic, track:play, phase-0

## Overview

Core play is the frozen 5×5 Board (24 sampled Prompts plus the always-marked Free Space "Complain about Circuit Music"), the community-editable Prompt pool, the 8 Atlantis Themes, and the installable PWA. This epic deals and freezes a Board at join (ADR 0003), lets a Player Mark a Square through to BINGO/Blackout celebration with client-authoritative, offline-durable writes (ADR 0001, ADR 0006), keeps the pre-cruise Prompt pool dense, ships Theme switching, and finalizes the offline-capable PWA shell. A bare Mark posts nothing to the Feed (ADR 0002).

## Children

Tracked as native sub-issues (see the linked tree). Members: #__NUM_w1-board-deal-join__, #__NUM_w1-board-mark-win__, #__NUM_w1-prompt-pool__, #__NUM_w1-themes__, #__NUM_w1-pwa__.

## Design sources

- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md`, glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
