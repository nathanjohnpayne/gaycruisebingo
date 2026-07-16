import { describe, it, expect } from 'vitest';
import { firebaseAuthOriginRedirectUrl } from './canonical-redirect';

describe('firebaseAuthOriginRedirectUrl', () => {
  it('hands gaycruisebingo.web.app to firebaseapp.com, preserving path/query/hash', () => {
    expect(
      firebaseAuthOriginRedirectUrl({
        hostname: 'gaycruisebingo.web.app',
        pathname: '/card',
        search: '?e=med-2026',
        hash: '#top',
      }),
    ).toBe('https://gaycruisebingo.firebaseapp.com/card?e=med-2026#top');
  });

  it('does not redirect firebaseapp.com, which is the stable Firebase auth origin', () => {
    expect(
      firebaseAuthOriginRedirectUrl({
        hostname: 'gaycruisebingo.firebaseapp.com',
        pathname: '/',
        search: '',
        hash: '',
      }),
    ).toBeNull();
  });

  it('returns null on the canonical host so there is no redirect loop', () => {
    expect(
      firebaseAuthOriginRedirectUrl({
        hostname: 'gaycruisebingo.com',
        pathname: '/card',
        search: '?e=med-2026',
        hash: '',
      }),
    ).toBeNull();
  });

  it('returns null on localhost, preview channels, and other non-alias hosts (never fires in dev/e2e)', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      'gaycruisebingo--pr-42-ab12cd.web.app', // Firebase preview channel — must not be hijacked to prod
    ]) {
      expect(
        firebaseAuthOriginRedirectUrl({
          hostname,
          pathname: '/',
          search: '',
          hash: '',
        }),
      ).toBeNull();
    }
  });
});
