import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Reconciliation guard for the ADR-0001 honor system (issue #40), not an app
// unit test: it asserts on the *contents* of two repo files — the Cloud
// Functions source and the Phase-1 deploy guide — to prove the scaffolded
// `recomputeStats`-as-anti-cheat stays removed and the deploy doc never tells an
// operator to lock player-stat writes. It lives under src/ so the mandated
// `npm test` run (vitest, `include: ['src/**/*.test.{ts,tsx}']`) actually
// executes it; that config deliberately scopes the run to src/** so it never
// needs the Firestore emulator or a browser (the tests/** layers do).
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');

const functionsIndex = read('../functions/src/index.ts');
const deployGuide = read('../docs/app/phase-1-deploy.md');

describe('recon: recomputeStats removed as anti-cheat (ADR 0001)', () => {
  it('functions/src/index.ts no longer defines recomputeStats', () => {
    expect(functionsIndex).not.toMatch(/recomputeStats/);
  });

  it('drops the imports that only served recomputeStats', () => {
    // ./logic supplied completedLines / countMarked / isBlackout / Cell and
    // existed only for the removed export (the file itself is deleted).
    // Deliberately NOT banning onDocumentWritten wholesale: #43
    // (w4-phase1-functions) legitimately adds document triggers for the
    // server-authoritative hide — the guard is that no trigger recomputes
    // player stats, which the recomputeStats assertions above pin.
    expect(functionsIndex).not.toMatch(/from '\.\/logic'/);
  });

  it('keeps moderateProof intact', () => {
    // ADR-0004 Phase-1 moderation surface must survive the removal.
    expect(functionsIndex).toMatch(/export const moderateProof\b/);
  });
});

describe('recon: phase-1-deploy.md drops the stat-locking guidance', () => {
  it('phase-1-deploy.md drops the players/{uid} stat-locking hardening block', () => {
    // The guide may NAME recomputeStats once — the operator note explaining
    // that the next deploy implicitly deletes an already-deployed copy (Codex
    // finding on PR #65) — but it must never present it as guidance to keep,
    // recreate, or harden around.
    expect(deployGuide).not.toMatch(/Optional hardening/);
    expect(deployGuide).not.toMatch(/lock(ing|ed)? player-stat writes to admins/i);
    expect(deployGuide).toMatch(/do not recreate the function/);
    // the removed rule snippet locked players/{uid} writes to profile-only fields
    expect(deployGuide).not.toMatch(/match \/players\/\{uid\}/);
  });

  it('phase-1-deploy.md documents players as self-writable by design (ADR 0001)', () => {
    expect(deployGuide).toMatch(/self-writable/i);
    expect(deployGuide).toMatch(/client-authoritative/i);
    expect(deployGuide).toMatch(/ADR 0001/);
  });
});
