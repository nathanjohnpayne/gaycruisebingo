import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ProofDoc } from '../types';

// w2-proof-capture, Feed layer (RTL-jsdom). Drives the REAL ProofFeed + the
// REAL useProofFeed hook (Firestore's onSnapshot stubbed so we can hand-deliver
// a proofs snapshot), proving the ADR 0002 promise end to end: a posted Proof
// IS the Feed entry — it shows newest-first with the Player's name + the Prompt
// text, and it renders per capture type (photo <img>, audio <audio>, text
// quote). It also proves the PR #75 cross-writer guarantee: the Feed resolves
// each entry from the proofs DOC (displayName / itemText / media / cellIndex all
// live there), never from boards/{uid}.cells — so a queued bare-Mark drain that
// drops cells[i].proofId can never orphan a live Proof out of the Feed.

const H = vi.hoisted(() => ({ onSnapshot: vi.fn(), reportProof: vi.fn(), deleteProof: vi.fn() }));

vi.mock('../firebase', () => ({
  db: {},
  EVENT_ID: 'test-event',
  storage: {},
  auth: {},
  googleProvider: {},
  analytics: null,
}));

vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref; // paths.ts chains .withConverter on refs
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    onSnapshot: H.onSnapshot,
  };
});

vi.mock('../data/proofs', () => ({ reportProof: H.reportProof, deleteProof: H.deleteProof }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'viewer' } }) }));

import ProofFeed from './ProofFeed';

type SnapCb = (snap: unknown) => void;
function captureOnNext(): { fire: (snap: unknown) => void } {
  const captured: { cb: SnapCb | null } = { cb: null };
  H.onSnapshot.mockImplementation((_target: unknown, _options: unknown, onNext: SnapCb) => {
    captured.cb = onNext;
    return () => {};
  });
  return {
    fire: (snap: unknown) => {
      if (!captured.cb) throw new Error('onSnapshot not subscribed');
      act(() => captured.cb!(snap));
    },
  };
}

function proof(over: Partial<ProofDoc> & Pick<ProofDoc, 'id' | 'createdAt'>): ProofDoc {
  return {
    uid: `u-${over.id}`,
    displayName: 'Someone',
    photoURL: null,
    type: 'text',
    cellIndex: 0,
    itemText: 'a prompt',
    storagePath: null,
    mediaURL: null,
    thumbURL: null,
    text: null,
    reportCount: 0,
    status: 'active',
    visionFlag: null,
    ...over,
  } as ProofDoc;
}

const colSnap = (docs: ProofDoc[]) => ({
  docs: docs.map((d) => ({ data: () => d })),
  metadata: { fromCache: false },
});

beforeEach(() => {
  H.onSnapshot.mockReset();
  H.onSnapshot.mockReturnValue(() => {});
  H.reportProof.mockReset();
  H.reportProof.mockResolvedValue(undefined);
  H.deleteProof.mockReset();
});

describe('ProofFeed — the Proof IS the Feed entry (ADR 0002)', () => {
  it('renders proofs newest-first with the Player name and the Prompt text', () => {
    const sub = captureOnNext();
    render(<ProofFeed />);

    // Delivered OUT of creation order; useProofFeed sorts by createdAt desc.
    sub.fire(
      colSnap([
        proof({ id: 'old', createdAt: 1000, displayName: 'Barnacle Betty', itemText: 'Wore Crocs to dinner' }),
        proof({ id: 'new', createdAt: 3000, displayName: 'Deck Daddy', itemText: 'Saw a sailor in Speedos' }),
        proof({ id: 'mid', createdAt: 2000, displayName: 'Midge', itemText: 'Ordered a seventh cocktail' }),
      ]),
    );

    const cards = document.querySelectorAll('.proof');
    expect(cards).toHaveLength(3);
    // Newest first.
    expect(cards[0]).toHaveTextContent('Deck Daddy');
    expect(cards[0]).toHaveTextContent('Saw a sailor in Speedos');
    expect(cards[1]).toHaveTextContent('Midge');
    expect(cards[2]).toHaveTextContent('Barnacle Betty');
  });

  it('renders each capture type: a photo <img>, an audio <audio>, and a text callout', () => {
    const sub = captureOnNext();
    render(<ProofFeed />);

    sub.fire(
      colSnap([
        proof({ id: 'p', createdAt: 3000, type: 'photo', mediaURL: 'https://x/p.jpg', itemText: 'photo prompt' }),
        proof({ id: 'a', createdAt: 2000, type: 'audio', mediaURL: 'https://x/a.webm', itemText: 'audio prompt' }),
        proof({ id: 't', createdAt: 1000, type: 'text', text: 'he DID say that', itemText: 'text prompt' }),
      ]),
    );

    expect(document.querySelector('img.proof-media')).toBeInTheDocument();
    expect(document.querySelector('audio.proof-media')).toBeInTheDocument();
    expect(screen.getByText(/he DID say that/)).toBeInTheDocument();
  });

  it('resolves each entry from the proof DOC, not the board — a clobbered cells[i].proofId never removes a Proof from the Feed (PR #75)', () => {
    // ProofFeed reads ONLY the proofs collection; displayName, itemText, media,
    // and cellIndex all live in the proof doc. It never touches
    // boards/{uid}.cells, so a queued bare-Mark drain that wholesale-replaces
    // cells and drops cells[i].proofId cannot orphan a live Proof out of the Feed.
    const sub = captureOnNext();
    render(<ProofFeed />);

    sub.fire(
      colSnap([
        proof({ id: 'orphan', createdAt: 5000, displayName: 'Still Here', itemText: 'Backing cell was clobbered' }),
      ]),
    );

    expect(screen.getByText('Still Here')).toBeInTheDocument();
    expect(screen.getByText(/Backing cell was clobbered/)).toBeInTheDocument();
  });

  it('shows the empty state once a server snapshot arrives with no proofs', () => {
    const sub = captureOnNext();
    render(<ProofFeed />);
    sub.fire(colSnap([]));
    expect(screen.getByText(/no proof yet/i)).toBeInTheDocument();
  });
});
