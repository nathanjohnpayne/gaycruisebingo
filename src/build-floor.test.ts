import { describe, it, expect, vi } from 'vitest';
import { buildBelowFloor, fetchBuildFloor } from './buildFloor';

describe('buildBelowFloor (#342 — remote force-reload floor)', () => {
  it('is true only when the build stamp is strictly older than the floor', () => {
    expect(buildBelowFloor('2026-07-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z')).toBe(true);
    expect(buildBelowFloor('2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')).toBe(false);
    expect(buildBelowFloor('2026-08-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z')).toBe(false);
  });

  it('compares numerically, so offset ISO forms are handled correctly', () => {
    // Same instant expressed with an offset — lexicographic comparison would misread it.
    expect(buildBelowFloor('2026-07-15T02:00:00.000+02:00', '2026-07-15T00:00:00.000Z')).toBe(false);
    expect(buildBelowFloor('2026-07-14T21:00:00.000-02:00', '2026-07-15T00:00:00.000Z')).toBe(true);
  });

  it('fails open on any doubtful floor — never force-reloads on bad data', () => {
    for (const floor of [null, undefined, 42, '', '   ', 'not-a-date', {}]) {
      expect(buildBelowFloor('2020-01-01T00:00:00.000Z', floor)).toBe(false);
    }
    // Unparseable build stamp also refuses.
    expect(buildBelowFloor('unknown', '2999-01-01T00:00:00.000Z')).toBe(false);
  });
});

describe('fetchBuildFloor (#342)', () => {
  it('returns the served floor, fetched no-store with a cache-busting query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ floor: '2026-07-15T00:00:00.000Z' }),
    } as unknown as Response);
    await expect(fetchBuildFloor(fetchImpl as unknown as typeof fetch)).resolves.toBe(
      '2026-07-15T00:00:00.000Z',
    );
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/build-floor\.json\?ts=\d+$/);
    expect(init.cache).toBe('no-store');
  });

  it('returns null on HTTP error, bad JSON, missing/typed-wrong floor, or network failure', async () => {
    const cases: Array<() => Promise<Response>> = [
      () => Promise.resolve({ ok: false } as Response),
      () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) } as unknown as Response),
      () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response),
      () => Promise.resolve({ ok: true, json: () => Promise.resolve({ floor: 99 }) } as unknown as Response),
      () => Promise.reject(new TypeError('Load failed')),
    ];
    for (const impl of cases) {
      const fetchImpl = vi.fn(impl);
      await expect(fetchBuildFloor(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    }
  });
});
