import { describe, it, expect } from 'vitest';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { migrateClaimMode, eventConverter } from './converters';
import type {
  ClaimMode,
  DoubtDoc,
  EventDoc,
  MomentDoc,
  ProofDoc,
  TallyDoc,
  TallyEntry,
  UserDoc,
} from '../types';

// The passthrough converters only ever call snap.data(); a one-method stand-in
// exercises the read path without a live Firestore snapshot.
const snapshotOf = (data: unknown) => ({ data: () => data }) as unknown as QueryDocumentSnapshot;

// A current-contract Event minus its Claim Mode. Its `settings` shape (no
// blackoutEnabled) also pins ADR 0004's dead-config drop at compile time.
const baseEvent: Omit<EventDoc, 'claimMode'> = {
  name: 'Test Sailing',
  sailStart: '2026-01-01',
  sailEnd: '2026-01-08',
  status: 'active',
  defaultTheme: 'neon-playground',
  admins: [],
  settings: { reportHideThreshold: 4 },
};

describe('migrateClaimMode (legacy Claim Mode read-migration)', () => {
  it('coerces a pre-rename persisted value to admin_confirmed', () => {
    expect(migrateClaimMode('verified')).toBe('admin_confirmed');
  });

  it('passes current Claim Modes through unchanged', () => {
    const modes: ClaimMode[] = ['honor', 'proof_required', 'admin_confirmed'];
    for (const mode of modes) expect(migrateClaimMode(mode)).toBe(mode);
  });

  it('never resolves to the legacy value and defaults unknown/missing to honor', () => {
    for (const raw of ['verified', 'honor', 'proof_required', 'admin_confirmed', 'bogus', undefined, null]) {
      expect(migrateClaimMode(raw)).not.toBe('verified');
    }
    expect(migrateClaimMode('bogus')).toBe('honor');
    expect(migrateClaimMode(undefined)).toBe('honor');
  });
});

describe('eventConverter (migration applied on read)', () => {
  it('reads a persisted Event with the legacy claimMode as admin_confirmed', () => {
    const event = eventConverter.fromFirestore(snapshotOf({ ...baseEvent, claimMode: 'verified' }));
    expect(event.claimMode).toBe('admin_confirmed');
  });

  it('preserves every other field while migrating claimMode', () => {
    const event = eventConverter.fromFirestore(snapshotOf({ ...baseEvent, claimMode: 'verified' }));
    expect(event.name).toBe('Test Sailing');
    expect(event.settings.reportHideThreshold).toBe(4);
  });

  it('re-serializing a migrated Event never re-introduces the legacy value', () => {
    const event = eventConverter.fromFirestore(snapshotOf({ ...baseEvent, claimMode: 'verified' }));
    const written = eventConverter.toFirestore(event) as { claimMode: ClaimMode };
    expect(written.claimMode).toBe('admin_confirmed');
  });
});

describe('ProofDoc status contract', () => {
  it("covers the 'pending' state attachProof writes under admin_confirmed Claim Mode", () => {
    // Compile-time pin: a Proof created under admin_confirmed starts 'pending'
    // (data/proofs attachProof, admin-only readable per firestore.rules), so the
    // ProofDoc.status union must include it — narrowing it back breaks this literal.
    const pendingProof: ProofDoc = {
      id: 'pr1',
      uid: 'u1',
      displayName: 'Ada',
      photoURL: null,
      type: 'photo',
      cellIndex: 3,
      itemText: 'Sang at the piano bar',
      createdAt: 1,
      reportCount: 0,
      status: 'pending',
    };
    expect(pendingProof.status).toBe('pending');
  });
});

describe('social type contract (imported unchanged by Wave-2 tickets)', () => {
  it('TallyEntry + TallyDoc model an attributed per-Prompt marker list plus count', () => {
    const entry: TallyEntry = { uid: 'u1', displayName: 'Ada', markedAt: 1 };
    const tally: TallyDoc = { itemId: 'p1', count: 1, markers: [entry] };
    expect(tally.markers).toHaveLength(tally.count);
    expect(tally.markers[0].displayName).toBe('Ada');
  });

  it('DoubtDoc models an ask-for-proof carrying open/answered state', () => {
    const doubt: DoubtDoc = {
      id: 'd1',
      itemId: 'p1',
      cellIndex: 3,
      fromUid: 'u2',
      fromDisplayName: 'Bo',
      targetUid: 'u1',
      targetDisplayName: 'Ada',
      createdAt: 2,
    };
    expect(doubt.satisfiedAt ?? null).toBeNull();
    expect(doubt.targetUid).toBe('u1');
  });

  it('MomentDoc carries a kind but no attached evidence', () => {
    const moment: MomentDoc = {
      id: 'm1',
      kind: 'bingo',
      uid: 'u1',
      displayName: 'Ada',
      photoURL: null,
      createdAt: 3,
    };
    expect(moment.kind).toBe('bingo');
    expect('mediaURL' in moment).toBe(false);
  });

  it('UserDoc carries the optional 18+ attestation timestamp', () => {
    const user: UserDoc = { displayName: 'Ada', photoURL: null, createdAt: 1, attestedAdultAt: 42 };
    expect(user.attestedAdultAt).toBe(42);
  });
});
