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
} from './posthog';

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

describe('PostHog client config (privacy-safe for a noindex, 18+ app)', () => {
  it('hard-disables every implicit capture vector — only explicit events ship', () => {
    expect(POSTHOG_INIT_OPTIONS.autocapture).toBe(false);
    expect(POSTHOG_INIT_OPTIONS.disable_session_recording).toBe(true);
    expect(POSTHOG_INIT_OPTIONS.capture_pageview).toBe(false);
    expect(POSTHOG_INIT_OPTIONS.capture_pageleave).toBe(false);
    expect(POSTHOG_INIT_OPTIONS.person_profiles).toBe('identified_only');
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

  it('initializes with the privacy-safe options + host when a key is present', async () => {
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
        autocapture: false,
        disable_session_recording: true,
        capture_pageview: false,
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
