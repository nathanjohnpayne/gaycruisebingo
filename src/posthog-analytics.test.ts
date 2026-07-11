import { describe, it, expect, vi, afterEach } from 'vitest';

// posthog-js is mocked so no real SDK loads; VITE_POSTHOG_KEY is unset in the
// base test env, so the statically-imported module stays in its disabled state.
vi.mock('posthog-js', () => ({
  default: { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() },
}));

import posthog from 'posthog-js';
import {
  POSTHOG_INIT_OPTIONS,
  POSTHOG_PROXY_HOST,
  posthogReady,
  phCapture,
  phIdentify,
  phReset,
  isLocalDevHost,
  stripUrlSecrets,
  sanitizeUrls,
} from './posthog';

describe('URL hygiene — sanitizeUrls / stripUrlSecrets (#195)', () => {
  it('strips query and hash from absolute URLs, keeping origin + path', () => {
    expect(stripUrlSecrets('https://gaycruisebingo.com/__/auth/handler?code=SECRET&state=x')).toBe(
      'https://gaycruisebingo.com/__/auth/handler',
    );
    expect(stripUrlSecrets('https://gaycruisebingo.com/feed#token=abc')).toBe(
      'https://gaycruisebingo.com/feed',
    );
  });

  it('strips query/hash from relative paths and passes non-strings through', () => {
    expect(stripUrlSecrets('/items?t=secret#frag')).toBe('/items');
    expect(stripUrlSecrets(undefined)).toBeUndefined();
    expect(stripUrlSecrets(42)).toBe(42);
  });

  it('before_send scrubs URL properties but leaves other props intact', () => {
    const out = sanitizeUrls({
      uuid: 'u',
      event: '$pageview',
      properties: {
        $current_url: 'https://gcb.com/x?token=secret',
        $pathname: '/x?token=secret',
        $browser: 'Chrome',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(out?.properties.$current_url).toBe('https://gcb.com/x');
    expect(out?.properties.$pathname).toBe('/x');
    expect(out?.properties.$browser).toBe('Chrome');
  });

  it('also scrubs URL person-property bags ($set / $set_once)', () => {
    const out = sanitizeUrls({
      uuid: 'u',
      event: '$pageview',
      properties: { $current_url: 'https://gcb.com/a?x=1' },
      $set: { $initial_current_url: 'https://gcb.com/enter?code=SECRET' },
      $set_once: { $initial_referrer: 'https://ref.com/p?t=secret' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(out?.properties.$current_url).toBe('https://gcb.com/a');
    expect(out?.$set?.$initial_current_url).toBe('https://gcb.com/enter');
    expect(out?.$set_once?.$initial_referrer).toBe('https://ref.com/p');
  });

  it('is wired as the before_send hook in the init options', () => {
    expect(POSTHOG_INIT_OPTIONS.before_send).toBe(sanitizeUrls);
  });
});

describe('isLocalDevHost (#194 — no capture from local dev)', () => {
  it('is true for localhost, loopback, and .local hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', 'gcb.local', 'my-mac.local']) {
      expect(isLocalDevHost(h)).toBe(true);
    }
  });

  it('is false for production hosts', () => {
    for (const h of ['gaycruisebingo.com', 'www.gaycruisebingo.com', 'gaycruisebingo.web.app']) {
      expect(isLocalDevHost(h)).toBe(false);
    }
  });
});

describe('PostHog client config (full capture, unlocked)', () => {
  it('enables full capture — autocapture, SPA pageviews + pageleave, and session recording', () => {
    expect(POSTHOG_INIT_OPTIONS.autocapture).toBe(true);
    expect(POSTHOG_INIT_OPTIONS.disable_session_recording).toBe(false);
    expect(POSTHOG_INIT_OPTIONS.capture_pageview).toBe('history_change');
    expect(POSTHOG_INIT_OPTIONS.capture_pageleave).toBe(true);
    expect(POSTHOG_INIT_OPTIONS.person_profiles).toBe('identified_only');
  });

  it('records replays fully unmasked (maskAllInputs: false) by owner decision', () => {
    expect(POSTHOG_INIT_OPTIONS.session_recording).toEqual({ maskAllInputs: false });
  });

  it('routes the UI to the PostHog US app while events go through the proxy (#149)', () => {
    // ui_host must stay the real US app so the toolbar / "view in PostHog" links
    // resolve even though ingestion (api_host) points at the reverse proxy.
    expect(POSTHOG_INIT_OPTIONS.ui_host).toBe('https://us.posthog.com');
    expect(POSTHOG_PROXY_HOST).toBe('https://d.gaycruisebingo.com');
  });
});

describe('PostHog init guard', () => {
  it('no-ops without VITE_POSTHOG_KEY (dev/test/CI stay silent)', () => {
    expect(posthogReady()).toBe(false);
    phCapture('login', { method: 'google' });
    phIdentify('u1');
    phReset();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});

describe('PostHog init with a key', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('initializes with the full-capture options + host when a key is present', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://us.i.posthog.com');
    const ph = (await import('posthog-js')).default;
    const mod = await import('./posthog');
    mod.initPostHog();
    expect(ph.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://us.i.posthog.com', // US direct-host bypass still overrides
        ui_host: 'https://us.posthog.com',
        autocapture: true,
        disable_session_recording: false,
        capture_pageview: 'history_change',
        person_profiles: 'identified_only',
      }),
    );
    // Once ready, an explicit event is forwarded to the SDK.
    mod.phCapture('bingo', { lines: 1 });
    expect(ph.capture).toHaveBeenCalledWith('bingo', { lines: 1 });
  });

  it('defaults api_host to the reverse proxy when VITE_POSTHOG_HOST is unset (#149)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    // Empty out the override (the repo's .env.local sets one for the loader) so
    // this exercises the in-code default: prod ships through the first-party proxy.
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    const ph = (await import('posthog-js')).default;
    const mod = await import('./posthog');
    mod.initPostHog();
    expect(ph.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://d.gaycruisebingo.com',
        ui_host: 'https://us.posthog.com',
      }),
    );
  });
});
