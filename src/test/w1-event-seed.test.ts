import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — scripts/seed.mjs is a plain-JS node script with no type
// declarations (tsconfig sets no allowJs); Vitest resolves and executes it natively,
// and importing it is side-effect-free because seeding only runs when the script is
// the entry module. Asserts specs/w1-event-seed.md.
import { EVENT_SEED, ITEMS, adminRoster, eventWritePayload, seedItemDocId, verifySeedPool } from '../../scripts/seed.mjs';

type SeedItem = { text: string; spicy: boolean };
type LiveDoc = { id: string; text: string; createdBy: string; spicy: boolean };

// Build the live `events/{id}/items` shape a correct, in-sync seed run leaves
// behind: every canonical prompt as a seed-owned doc with the content-hash id.
function liveFromCanonical(pool: SeedItem[] = ITEMS as SeedItem[]): LiveDoc[] {
  return pool.map(({ text, spicy }) => ({
    id: seedItemDocId(text),
    text,
    createdBy: 'seed',
    spicy,
  }));
}

// Vitest runs with cwd at the repo root; jsdom's import.meta.url is not a file: URL.
const seedSource = readFileSync(resolve(process.cwd(), 'scripts/seed.mjs'), 'utf8');

describe('w1-event-seed: seeded settings (ADR 0004)', () => {
  it('seeds settings.reportHideThreshold at the load-bearing value 4', () => {
    expect(EVENT_SEED.settings.reportHideThreshold).toBe(4);
  });

  it('seeds no blackoutEnabled — ADR 0004 removed it as dead config', () => {
    expect(EVENT_SEED.settings).not.toHaveProperty('blackoutEnabled');
    // Exact shape: reportHideThreshold and spicyRatio (w1-seed-and-composition)
    // are the only settings keys the static seed payload carries.
    expect(Object.keys(EVENT_SEED.settings)).toEqual(['reportHideThreshold', 'spicyRatio']);
  });

  it('marks settings.blackoutEnabled for deletion in the merge write, so re-seeding an Event doc from the previous seed actually removes the stale field', () => {
    // A `{ merge: true }` write only touches leaf paths present in the payload, so a
    // pre-existing `settings.blackoutEnabled` from the old seed would otherwise survive a
    // reseed untouched. `eventWritePayload` takes the delete sentinel as a parameter
    // (rather than importing firebase-admin) so it stays import-safe without the dev-only
    // install — stand in a fake sentinel here and assert it passes through untouched.
    const deleteSentinel = Symbol('FieldValue.delete()');
    const payload = eventWritePayload([], deleteSentinel);
    expect(payload.settings).toEqual({
      reportHideThreshold: 4,
      spicyRatio: 0.4,
      blackoutEnabled: deleteSentinel,
    });
  });

  it('never seeds a literal value for blackoutEnabled — the seed source references it only as the delete target', () => {
    expect(seedSource).not.toMatch(/blackoutEnabled:\s*(true|false)/);
  });

  it('does NOT write bannedUids — a reseed must never clobber a live ban list (#113)', () => {
    // The event write is { merge: true } and the seed is safe to re-run, so writing
    // bannedUids here would reset a populated ban roster (#108) back to [] on every
    // reseed — silent data loss. It is deliberately absent from both the static seed
    // payload and the merge write; a fresh event reads [] via eventConverter's
    // missing-field default instead (asserted in src/data/w0-type-contract.test.ts).
    expect(EVENT_SEED).not.toHaveProperty('bannedUids');
    expect(eventWritePayload([])).not.toHaveProperty('bannedUids');
    expect(eventWritePayload(['nathan-seed-uid'])).not.toHaveProperty('bannedUids');
  });
});

describe('w1-event-seed: claim mode (ADR 0001)', () => {
  it("seeds claimMode 'honor' (the default)", () => {
    expect(EVENT_SEED.claimMode).toBe('honor');
  });

  it('documents the mode set as honor | proof_required | admin_confirmed, never the pre-rename name', () => {
    expect(seedSource).toContain("'honor' | 'proof_required' | 'admin_confirmed'");
    expect(seedSource).not.toMatch(/verified/);
  });
});

describe('w1-event-seed: ADMIN_UID roster flow (#15)', () => {
  it('parses ADMIN_UID as a comma-separated roster, trimming entries and dropping empties', () => {
    expect(adminRoster()).toEqual([]);
    expect(adminRoster('')).toEqual([]);
    expect(adminRoster('nathan-seed-uid')).toEqual(['nathan-seed-uid']);
    expect(adminRoster(' nathan-seed-uid , coadmin-1,coadmin-2 ,')).toEqual([
      'nathan-seed-uid',
      'coadmin-1',
      'coadmin-2',
    ]);
  });

  it('writes the roster to events/{id}.admins when set (2–4 Admins incl. the seed uid)', () => {
    const roster = ['nathan-seed-uid', 'coadmin-1', 'coadmin-2'];
    expect(eventWritePayload(roster).admins).toEqual(roster);
  });

  it('omits admins entirely when the roster is empty, so a merge re-run never wipes it', () => {
    expect(eventWritePayload([])).not.toHaveProperty('admins');
  });
});

describe('w1-event-seed: prompt pool density (ADR 0003)', () => {
  it('seeds at least 24 prompts so dealBoard always has a full sample', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(24);
  });

  // w1-seed-and-composition (#129) supersedes ADR 0003's original ~30-50
  // "dense" band with a canonical 87-entry pool (24 spicy / 63 tame) — a
  // deliberate, ticket-accepted decision, not a regression of the density
  // intent (still comfortably above the 24-prompt deal floor).
  it('seeds the canonical 87-entry pool (w1-seed-and-composition)', () => {
    expect(ITEMS.length).toBe(87);
  });

  it('seeds unique, non-empty prompt { text, spicy } entries — content-hash doc ids (hashed on text) collapse duplicates', () => {
    expect(new Set(ITEMS.map((it: { text: string; spicy: boolean }) => it.text)).size).toBe(
      ITEMS.length,
    );
    for (const it of ITEMS as { text: string; spicy: boolean }[]) {
      expect(typeof it.text).toBe('string');
      expect(it.text.trim().length).toBeGreaterThan(0);
      expect(typeof it.spicy).toBe('boolean');
    }
  });
});

// #129 reopened: the app renders the pool from Firestore, not the JS bundle, so a
// merged-and-deployed pool change still leaves players on the OLD pool until the
// seed is re-run against the live project — exactly what happened after #135
// (87-prompt pool shipped, but events/{id}/items still held the pre-#135 32).
// `verifySeedPool` is the drift check that turns that silent gap into a loud
// failure (`node scripts/seed.mjs --verify`, post-deploy). These pin its verdicts.
describe('w1-event-seed: verifySeedPool drift check (#129 reopened)', () => {
  it('reports ok for a live pool that matches the canonical ITEMS exactly', () => {
    const report = verifySeedPool(liveFromCanonical());
    expect(report.ok).toBe(true);
    expect(report.expected).toBe(87);
    expect(report.seedOwned).toBe(87);
    expect(report.missing).toEqual([]);
    expect(report.stale).toEqual([]);
    expect(report.mismatched).toEqual([]);
  });

  it('ignores player-submitted prompts — they are not canonical and never count as drift', () => {
    const live: LiveDoc[] = [
      ...liveFromCanonical(),
      { id: 'player-abc', text: 'A player prompt', createdBy: 'player-1', spicy: true },
    ];
    const report = verifySeedPool(live);
    expect(report.ok).toBe(true);
    expect(report.playerOwned).toBe(1);
    expect(report.stale).toEqual([]);
  });

  it('flags a canonical prompt that was never seeded as missing', () => {
    const live = liveFromCanonical().filter((d) => d.text !== 'Scabies');
    const report = verifySeedPool(live);
    expect(report.ok).toBe(false);
    expect(report.missing.map((m: { text: string }) => m.text)).toEqual(['Scabies']);
    expect(report.stale).toEqual([]);
  });

  it('flags a seed-owned prompt the canonical pool no longer contains as stale', () => {
    const live: LiveDoc[] = [
      ...liveFromCanonical(),
      { id: seedItemDocId('A retired prompt'), text: 'A retired prompt', createdBy: 'seed', spicy: false },
    ];
    const report = verifySeedPool(live);
    expect(report.ok).toBe(false);
    expect(report.stale.map((s: { text: string }) => s.text)).toEqual(['A retired prompt']);
    expect(report.missing).toEqual([]);
  });

  it('flags a spicy-flag drift (same prompt text, flag flipped without a reseed) as mismatched', () => {
    const live = liveFromCanonical().map((d) =>
      d.text === 'Threesome' ? { ...d, spicy: false } : d,
    );
    const report = verifySeedPool(live);
    expect(report.ok).toBe(false);
    expect(report.mismatched).toHaveLength(1);
    expect(report.mismatched[0]).toMatchObject({
      text: 'Threesome',
      expectedSpicy: true,
      actualSpicy: false,
    });
  });

  it('flags a stored-text drift (canonical id but a tampered text field) as mismatched (Codex P2, PR #139)', () => {
    // A malformed doc carrying the canonical content-hash id but a different
    // stored `text` must not slip through just because the id matches.
    const live = liveFromCanonical().map((d) =>
      d.text === 'Threesome' ? { ...d, text: 'Tampered text' } : d,
    );
    const report = verifySeedPool(live);
    expect(report.ok).toBe(false);
    expect(report.mismatched).toHaveLength(1);
    expect(report.mismatched[0]).toMatchObject({ text: 'Threesome', actualText: 'Tampered text' });
  });

  it('compares spicy strictly — a non-boolean or missing flag is drift, not silently coerced (Codex P2, PR #139)', () => {
    // firestore.rules require `spicy is bool`; a value that only *coerces* to the
    // canonical answer (a truthy string on a spicy prompt, or a missing/undefined
    // flag on a tame prompt) is itself drift the check must surface.
    const truthyString = liveFromCanonical().map((d) =>
      d.text === 'Threesome' ? { ...d, spicy: 'true' as unknown as boolean } : d,
    );
    expect(verifySeedPool(truthyString).ok).toBe(false);
    expect(verifySeedPool(truthyString).mismatched.map((m: { text: string }) => m.text)).toEqual([
      'Threesome',
    ]);

    const missingFlag = liveFromCanonical().map((d) =>
      d.text === 'Scabies' ? { ...d, spicy: undefined as unknown as boolean } : d,
    );
    expect(verifySeedPool(missingFlag).ok).toBe(false);
    expect(verifySeedPool(missingFlag).mismatched.map((m: { text: string }) => m.text)).toEqual([
      'Scabies',
    ]);
  });

  // The exact production condition: the live pool is still the OLD (pre-#135)
  // seed set — a couple of prompts that survived into the new pool, plus retired
  // ones — and none of the ~86 new entries. verifySeedPool must catch it as both
  // missing (new entries absent) AND stale (retired entries lingering).
  it('reproduces the #129 incident: an un-reseeded OLD pool drifts on both axes', () => {
    const oldLive: LiveDoc[] = [
      // Survived unchanged into the new pool.
      { id: seedItemDocId('Threesome'), text: 'Threesome', createdBy: 'seed', spicy: true },
      // Retired / renamed by #135 — should have been deleted on reseed.
      { id: seedItemDocId('Make out with Patti LuPone'), text: 'Make out with Patti LuPone', createdBy: 'seed', spicy: true },
      { id: seedItemDocId('Dance-floor blowjob'), text: 'Dance-floor blowjob', createdBy: 'seed', spicy: true },
      { id: seedItemDocId('3 loads in one day'), text: '3 loads in one day', createdBy: 'seed', spicy: true },
    ];
    const report = verifySeedPool(oldLive);
    expect(report.ok).toBe(false);
    expect(report.missing.length).toBe(86); // every new-pool entry except 'Threesome'
    expect(report.stale.map((s: { text: string }) => s.text).sort()).toEqual(
      ['3 loads in one day', 'Dance-floor blowjob', 'Make out with Patti LuPone'].sort(),
    );
  });
});
