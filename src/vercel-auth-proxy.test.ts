import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface VercelConfig {
  rewrites?: Array<{ source?: string; destination?: string }>;
}

describe('Vercel Firebase Auth proxy', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;

  it('transparently proxies the complete Firebase Auth helper namespace', () => {
    expect(config.rewrites).toContainEqual({
      source: '/__/auth/:path*',
      destination: 'https://gaycruisebingo.firebaseapp.com/__/auth/:path*',
    });
  });
});
