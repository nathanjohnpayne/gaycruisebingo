import { describe, it, expect } from 'vitest';
import { canonicalRedirectUrl, redirectTargetForBoot } from './canonical-redirect';

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

describe('redirectTargetForBoot — offline guard (Codex P1)', () => {
  it('redirects an alias origin when online', () => {
    expect(
      redirectTargetForBoot({ hostname: 'gaycruisebingo.web.app', pathname: '/card', search: '', hash: '' }, true),
    ).toBe('https://gaycruisebingo.com/card');
  });

  it('stays put on an alias origin when OFFLINE (keeps the origin-scoped cached shell + queued Marks)', () => {
    expect(
      redirectTargetForBoot({ hostname: 'gaycruisebingo.web.app', pathname: '/card', search: '', hash: '' }, false),
    ).toBeNull();
    expect(
      redirectTargetForBoot({ hostname: 'gaycruisebingo.firebaseapp.com', pathname: '/', search: '', hash: '' }, false),
    ).toBeNull();
  });

  it('stays put on the canonical origin whether online or offline', () => {
    expect(
      redirectTargetForBoot({ hostname: 'gaycruisebingo.com', pathname: '/', search: '', hash: '' }, true),
    ).toBeNull();
    expect(
      redirectTargetForBoot({ hostname: 'gaycruisebingo.com', pathname: '/', search: '', hash: '' }, false),
    ).toBeNull();
  });
});
