// Offline-layer test environment: real IndexedDB semantics for Firestore's
// persistentLocalCache without a browser. fake-indexeddb supplies a
// process-global indexedDB whose data survives client terminate()/re-init
// within the test process — which is what lets the suite simulate a reload.
// USE_MOCK_PERSISTENCE is the Firestore SDK's own escape hatch (used by its
// first-party persistence tests) that tells SimpleDb the injected IndexedDB is
// trustworthy; without it the node build refuses persistence outright.
import 'fake-indexeddb/auto';

process.env.USE_MOCK_PERSISTENCE = 'YES';
