import { describe, it, expect } from 'vitest';
import {
  PROOF_MEDIA_CACHE_CONTROL,
  PROOF_MEDIA_URL_PATTERN,
  PROOF_MEDIA_CACHE_MAX_AGE_SECONDS,
  PROOF_MEDIA_CACHE_MAX_ENTRIES,
} from './proofMediaCache';

// #363 (specs/w2-proof-capture.md § Feed, specs/w1-pwa.md): the constants the
// service worker's proof-media route and uploadProofMedia's Cache-Control share.
// The RegExp is the load-bearing piece — it decides which cross-origin fetches
// the CacheFirst route captures — so it gets a positive/negative URL matrix.

// The shape getDownloadURL actually returns for a proof upload: the object path
// URL-encoded under /o/, then the token query.
const proofUrl =
  'https://firebasestorage.googleapis.com/v0/b/gaycruisebingo.firebasestorage.app/o/proofs%2Fsummer-2026%2Fu123%2Fp456.jpg?alt=media&token=abc-def';

describe('PROOF_MEDIA_URL_PATTERN — the SW route matches proof media only (#363)', () => {
  it('matches a real proof download URL (photo and audio, any bucket name)', () => {
    expect(PROOF_MEDIA_URL_PATTERN.test(proofUrl)).toBe(true);
    expect(
      PROOF_MEDIA_URL_PATTERN.test(
        'https://firebasestorage.googleapis.com/v0/b/some-bucket.appspot.com/o/proofs%2Fevt%2Fu%2Fclip.m4a?alt=media&token=t',
      ),
    ).toBe(true);
  });

  it('does NOT match avatar URLs — mutable objects must never be pinned by the CacheFirst route', () => {
    expect(
      PROOF_MEDIA_URL_PATTERN.test(
        'https://firebasestorage.googleapis.com/v0/b/gaycruisebingo.firebasestorage.app/o/avatars%2Fu123.jpg?alt=media&token=t',
      ),
    ).toBe(false);
  });

  it('does NOT match lookalike hosts or a proofs path on another origin', () => {
    // Host-suffix forgery: the RegExp must anchor the whole origin.
    expect(
      PROOF_MEDIA_URL_PATTERN.test('https://firebasestorage.googleapis.com.evil.example/v0/b/x/o/proofs%2Fa'),
    ).toBe(false);
    // Path forgery on another origin.
    expect(
      PROOF_MEDIA_URL_PATTERN.test('https://evil.example/firebasestorage.googleapis.com/v0/b/x/o/proofs%2Fa'),
    ).toBe(false);
    // Same host, non-proofs tree.
    expect(PROOF_MEDIA_URL_PATTERN.test('https://firebasestorage.googleapis.com/v0/b/x/o/other%2Fa')).toBe(false);
  });

  it('is a cross-origin-safe Workbox route: anchored to the start of the URL', () => {
    expect(PROOF_MEDIA_URL_PATTERN.source.startsWith('^https:')).toBe(true);
  });
});

describe('proof-media cache policy constants (#363)', () => {
  it('the upload Cache-Control is long-lived and immutable (proof objects are never rewritten)', () => {
    expect(PROOF_MEDIA_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });

  it('the runtime cache is bounded (entries and age), so opaque responses cannot grow unchecked', () => {
    expect(PROOF_MEDIA_CACHE_MAX_ENTRIES).toBeGreaterThan(0);
    expect(PROOF_MEDIA_CACHE_MAX_AGE_SECONDS).toBeGreaterThan(0);
    expect(PROOF_MEDIA_CACHE_MAX_AGE_SECONDS).toBeLessThanOrEqual(365 * 24 * 60 * 60);
  });
});
