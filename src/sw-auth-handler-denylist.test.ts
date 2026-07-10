import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Covers specs/sw-auth-handler-denylist.md: the workbox navigation fallback must
// exclude Firebase Hosting's reserved /__/* namespace, or the service worker
// serves the SPA shell into the Google sign-in popup (/__/auth/handler) and
// sign-in dead-ends for every SW-controlled signed-out client (#182). The
// generated sw.js only exists post-build and jsdom cannot run a service worker,
// so this guards the config source directly — the same pattern
// src/data/w4-bug-report-client.test.ts uses for firebase.json's cache headers.

describe('service worker navigation fallback', () => {
  const viteConfig = readFileSync('vite.config.ts', 'utf8');

  it('declares a navigateFallbackDenylist alongside navigateFallback', () => {
    expect(viteConfig).toMatch(/navigateFallback:/);
    expect(viteConfig).toMatch(/navigateFallbackDenylist:/);
  });

  it("excludes Firebase's reserved /__/* namespace from the fallback", () => {
    // The exact canonical pattern: /^\/__\//
    expect(viteConfig).toContain('navigateFallbackDenylist: [/^\\/__\\//]');
  });
});
