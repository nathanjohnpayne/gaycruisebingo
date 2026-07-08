import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

// ADR 0006 source guard: prove src/firebase.ts wires a PERSISTENT (durable
// IndexedDB) local cache, not the default in-memory cache that loses queued
// Marks on reload. The offline round-trip behavior this enables is proved
// against the emulator in tests/offline/w0-offline-persistence.test.ts.
//
// firebase.ts runs getAuth(app) at import; the node build of firebase/auth
// (which vitest resolves even under jsdom) rejects an empty apiKey, so stub a
// non-empty placeholder before importing. No network call is made.

// Firestore does not expose its settings publicly; reach through the internal
// field to read the *configured* cache kind ('persistent' | 'memory'; undefined
// for a default getFirestore instance).
function configuredCacheKind(fs: Firestore): string | undefined {
  return (fs as unknown as { _settings?: { localCache?: { kind?: string } } })._settings
    ?.localCache?.kind;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('src/firebase.ts (ADR 0006 offline persistence)', () => {
  it('exports a Firestore db backed by a persistent local cache', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'demo-api-key');
    const { db } = await import('./firebase');

    // The db symbol is a real Firestore instance (unchanged export, so no call
    // site needs editing) …
    expect(db.type).toBe('firestore');
    // … and it requests the durable persistent cache, not memory or the default.
    // getFirestore(app) would leave this undefined; 'memory' would be a
    // regression to a queue that cannot survive a reload.
    expect(configuredCacheKind(db)).toBe('persistent');
  });
});
