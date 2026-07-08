**Track:** identity · **Phase:** 0
**Labels:** epic, track:identity, phase-0

## Overview

Identity is one User per Google account (the only login), an 18+ attestation gate persisted on the profile, and each User's per-Event Player membership with a display name and custom avatar. This epic stands up Google sign-in, persists the adult attestation as a timestamped profile field, and delivers the profile edit surface — the identity substrate every Event, Board, Player, Tally, and Leaderboard row hangs off. Attribution is honor-system and public (ADR 0001, ADR 0002): we record a User's own attestation and show their name/avatar, we never verify identity.

## Children

Tracked as native sub-issues (see the linked tree). Members: #__NUM_w1-auth-google__, #__NUM_w1-adult-attestation__, #__NUM_w1-profile-avatar__, #__NUM_w1-event-seed__.

## Design sources

- PRD `~/GitHub/docs/projects/gaycruisebingo/prds/gaycruisebingo.md`, glossary `CONTEXT.md`, ADRs `docs/adr/0001-0006`.
- Backlog + coverage matrix: `plans/gaycruisebingo-backlog.md`; DAG/waves/hot-files: `plans/gaycruisebingo-parallelization.md`.
