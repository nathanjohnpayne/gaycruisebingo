import { describe, it, expect, vi } from 'vitest';
import { canonicalRedirectUrl, canonicalOriginAlive, FALLBACK_AUTH_DOMAIN } from './canonical-redirect';

describe('canonicalRedirectUrl (#162)', () => {
  it('redirects gaycruisebingo.web.app to the canonical origin, preserving path/query/hash', () => {
    expect(
      canonicalRedirectUrl({
        hostname: 'gaycruisebingo.web.app',
        pathname: '/card',
        search: '?e=med-2026',
        hash: '#top',
      }),
    ).toBe('https://gaycruisebingo.com/card?e=med-2026#top');
  });

  it('redirects the gaycruisebingo.firebaseapp.com alias too', () => {
    expect(
      canonicalRedirectUrl({ hostname: 'gaycruisebingo.firebaseapp.com', pathname: '/', search: '', hash: '' }),
    ).toBe('https://gaycruisebingo.com/');
  });

  it('returns null on the canonical host so there is no redirect loop', () => {
    expect(
      canonicalRedirectUrl({ hostname: 'gaycruisebingo.com', pathname: '/card', search: '?e=med-2026', hash: '' }),
    ).toBeNull();
  });

  it('returns null on localhost, preview channels, and other non-alias hosts (never fires in dev/e2e)', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      'gaycruisebingo--pr-42-ab12cd.web.app', // Firebase preview channel — must not be hijacked to prod
    ]) {
      expect(canonicalRedirectUrl({ hostname, pathname: '/', search: '', hash: '' })).toBeNull();
    }
  });
});

describe('canonicalOriginAlive (#340 — never navigate INTO an outage/blocked origin)', () => {
  it('resolves true when the canonical origin answers, probing it no-cors/no-store', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ type: 'opaque' } as Response);
    await expect(canonicalOriginAlive(fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/gaycruisebingo\.com\/favicon\.svg\?alive=\d+$/);
    expect(init.mode).toBe('no-cors');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves false when the probe rejects (reset / DNS failure / filtered SNI)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Load failed'));
    await expect(canonicalOriginAlive(fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('resolves false when the probe hangs past the timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason ?? new DOMException('TimeoutError', 'TimeoutError')),
          );
        }),
    );
    await expect(canonicalOriginAlive(fetchImpl as unknown as typeof fetch, 25)).resolves.toBe(false);
  });

  it('exports the Firebase-default fallback auth domain for the outage sign-in path', () => {
    expect(FALLBACK_AUTH_DOMAIN).toBe('gaycruisebingo.firebaseapp.com');
  });

  it('probes without a signal when AbortSignal.timeout is unsupported (older WebViews) instead of failing closed', async () => {
    const original = AbortSignal.timeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating a browser without the API
    (AbortSignal as any).timeout = undefined;
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ type: 'opaque' } as Response);
      await expect(canonicalOriginAlive(fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeUndefined();
    } finally {
      AbortSignal.timeout = original;
    }
  });
});
