import { describe, it, expect } from 'vitest';
import {
  isDueForSnapshot,
  daysDueForSnapshot,
  activeSnapshotIds,
  finaleTimes,
  finaleActions,
  isEventAdmin,
  LAST_CALL_LEAD_MS,
  stampDaySnapshot,
  runScheduledUnlock,
  manualUnlockNow,
  UnlockPermissionError,
  type AdminFirestore,
  type DayLike,
  type EventLike,
} from '../../functions/src/unlockDay';

// specs/d15-scheduler-unlock.md — the Phase 1.5 daily scheduler (#202,
// daily-cards-spec § "Unlock mechanics" / "Scoring and social surfaces"). Pure
// decision logic + an idempotent, DI'd write path (mirrors autohide.ts): the
// snapshot-at-unlock stamp, the finale two-beat finish (20:00 Day 9 last-call /
// 08:00 Day 10 freeze + podium), and the admin "unlock now" fallback. Every
// Firestore seam is a fake — no live runtime. Runs via `npm run test:functions`.

// --- In-memory Firestore fake ---------------------------------------------------

interface StoredItem {
  id: string;
  status: string;
  pool?: string;
}
interface StoredMoment {
  id: string;
  [k: string]: unknown;
}

/** A minimal in-memory stand-in for the admin-SDK surface unlockDay.ts injects. */
function makeDb(seed: {
  eventId: string;
  event: EventLike;
  items?: StoredItem[];
  moments?: StoredMoment[];
}): AdminFirestore & { readEvent(): EventLike; moments(): StoredMoment[] } {
  const docs: Record<string, Record<string, unknown> | undefined> = {
    [`events/${seed.eventId}`]: { ...seed.event } as Record<string, unknown>,
  };
  const items = [...(seed.items ?? [])];
  const moments = [...(seed.moments ?? [])];
  let momentSeq = moments.length;

  const snapshotOf = (path: string) => {
    const data = docs[path];
    return { exists: data !== undefined, id: path.split('/').pop() as string, data: () => data };
  };

  const docRef = (path: string) => ({
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>) => {
      docs[path] = { ...data };
      return undefined;
    },
  });

  const collectionRef = (path: string) => {
    const filters: Array<[string, unknown]> = [];
    const backing = (): StoredMoment[] | StoredItem[] =>
      path.endsWith('/items') ? items : path.endsWith('/moments') ? moments : [];
    const api: any = {
      where(field: string, _op: string, value: unknown) {
        filters.push([field, value]);
        return api;
      },
      async get() {
        const rows = (backing() as Array<Record<string, unknown>>).filter((row) =>
          filters.every(([f, v]) => row[f] === v),
        );
        return { docs: rows.map((row) => ({ exists: true, id: row.id as string, data: () => row })) };
      },
      doc(id?: string) {
        if (path.endsWith('/moments')) {
          const mid = id ?? `m${++momentSeq}`;
          return {
            get: async () => ({ exists: false, id: mid, data: () => undefined }),
            set: async (data: Record<string, unknown>) => {
              moments.push({ id: mid, ...data });
              return undefined;
            },
          };
        }
        return docRef(`${path}/${id}`);
      },
    };
    return api;
  };

  return {
    doc: (path: string) => docRef(path),
    collection: (path: string) => collectionRef(path),
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const tx = {
        get: async (ref: { get(): Promise<unknown> }) => ref.get(),
        update: (ref: { set(d: Record<string, unknown>): Promise<unknown> }, data: Record<string, unknown>) => {
          // merge onto the current doc (the surface only ever updates the event doc)
          const current = (docs[`events/${seed.eventId}`] ?? {}) as Record<string, unknown>;
          docs[`events/${seed.eventId}`] = { ...current, ...data };
          void ref;
        },
      };
      return fn(tx);
    },
    readEvent: () => docs[`events/${seed.eventId}`] as unknown as EventLike,
    moments: () => moments,
  };
}

// Clock anchors (ms epoch); the exact values don't matter, only their ordering.
const D9_UNLOCK = Date.UTC(2026, 6, 24, 6, 0); // Day 9 08:00 Europe/Rome (summer = UTC+2)
const D10_UNLOCK = Date.UTC(2026, 6, 25, 6, 0); // Day 10 08:00 Europe/Rome

function mainDays(): DayLike[] {
  return [
    { index: 8, pool: 'main', unlockAt: D9_UNLOCK }, // Day 9
    { index: 9, pool: 'farewell', unlockAt: D10_UNLOCK }, // Day 10 (farewell)
  ];
}

describe('isDueForSnapshot / daysDueForSnapshot — the due-and-unstamped gate', () => {
  it('is due when unlockAt has passed and no snapshot exists', () => {
    expect(isDueForSnapshot({ index: 0, pool: 'main', unlockAt: 100 }, 200)).toBe(true);
  });
  it('is NOT due when unlockAt is still in the future', () => {
    expect(isDueForSnapshot({ index: 0, pool: 'main', unlockAt: 300 }, 200)).toBe(false);
  });
  it('is NOT due once a snapshot exists — even an empty one (idempotency)', () => {
    expect(isDueForSnapshot({ index: 0, pool: 'main', unlockAt: 100, snapshotItemIds: [] }, 200)).toBe(false);
    expect(isDueForSnapshot({ index: 0, pool: 'main', unlockAt: 100, snapshotItemIds: ['a'] }, 200)).toBe(false);
  });
  it('selects only the due, unstamped Days', () => {
    const days: DayLike[] = [
      { index: 0, pool: 'main', unlockAt: 100 },
      { index: 1, pool: 'main', unlockAt: 100, snapshotItemIds: ['x'] },
      { index: 2, pool: 'main', unlockAt: 500 },
    ];
    expect(daysDueForSnapshot(days, 200).map((d) => d.index)).toEqual([0]);
  });
});

describe('activeSnapshotIds — active items in a pool (legacy pool defaults to main)', () => {
  it('keeps only the requested pool and defaults a missing pool to main', () => {
    const items = [
      { id: 'a', pool: 'main' },
      { id: 'b', pool: 'embark' },
      { id: 'c' }, // legacy, no pool → main
      { id: 'd', pool: 'farewell' },
    ];
    expect(activeSnapshotIds(items, 'main')).toEqual(['a', 'c']);
    expect(activeSnapshotIds(items, 'embark')).toEqual(['b']);
    expect(activeSnapshotIds(items, 'farewell')).toEqual(['d']);
  });
});

describe('stampDaySnapshot — the snapshot at unlock (AC 1)', () => {
  it('stamps a due, unstamped Day with exactly the active items in its pool', async () => {
    const db = makeDb({
      eventId: 'e1',
      event: { days: mainDays() },
      items: [
        { id: 'a', status: 'active', pool: 'main' },
        { id: 'b', status: 'active', pool: 'main' },
        { id: 'c', status: 'pending', pool: 'main' }, // not active → excluded
        { id: 'd', status: 'active', pool: 'embark' }, // wrong pool → excluded
        { id: 'legacy', status: 'active' }, // no pool → main → included
      ],
    });
    const result = await stampDaySnapshot(db, 'e1', 8, { now: () => D9_UNLOCK + 1 });
    expect(result).toBe('stamped');
    const day = db.readEvent().days!.find((d) => d.index === 8)!;
    expect(day.snapshotItemIds).toEqual(['a', 'b', 'legacy']);
  });

  it('leaves a Day whose unlockAt is still in the future untouched (AC: future Day)', async () => {
    const db = makeDb({
      eventId: 'e1',
      event: { days: mainDays() },
      items: [{ id: 'a', status: 'active', pool: 'farewell' }],
    });
    const result = await stampDaySnapshot(db, 'e1', 9, { now: () => D10_UNLOCK - 1 });
    expect(result).toBe('not-due');
    expect(db.readEvent().days!.find((d) => d.index === 9)!.snapshotItemIds).toBeUndefined();
  });

  it('is idempotent: a second run against an already-stamped Day is a no-op (AC 1 retry)', async () => {
    const db = makeDb({
      eventId: 'e1',
      event: { days: mainDays() },
      items: [{ id: 'a', status: 'active', pool: 'main' }],
    });
    const first = await stampDaySnapshot(db, 'e1', 8, { now: () => D9_UNLOCK + 1 });
    expect(first).toBe('stamped');
    const stampedIds = db.readEvent().days!.find((d) => d.index === 8)!.snapshotItemIds;

    // A new active item appears AFTER the first stamp — a re-run must NOT pick it up.
    const second = await stampDaySnapshot(db, 'e1', 8, { now: () => D9_UNLOCK + 5000 });
    expect(second).toBe('already-stamped');
    expect(db.readEvent().days!.find((d) => d.index === 8)!.snapshotItemIds).toEqual(stampedIds);
  });
});

describe('finaleTimes / finaleActions — the two-beat finish (AC 3)', () => {
  it('anchors last-call to Day 9 08:00 + 12h = 20:00 and freeze to the farewell unlock', () => {
    const t = finaleTimes(mainDays())!;
    expect(t.lastCallAt).toBe(D9_UNLOCK + LAST_CALL_LEAD_MS);
    expect(t.farewellUnlockAt).toBe(D10_UNLOCK);
    expect(t.lastCallDayIndex).toBe(8);
    expect(t.podiumDayIndex).toBe(9);
  });

  it('returns null when there is no farewell Day (a non-Phase-1.5 event)', () => {
    expect(finaleTimes([{ index: 0, pool: 'main', unlockAt: 1 }])).toBeNull();
  });

  it('posts last-call in [20:00 Day9, 08:00 Day10) and only when not already posted', () => {
    const t = finaleTimes(mainDays())!;
    expect(finaleActions(t, t.lastCallAt, { lastCallPosted: false }).postLastCall).toBe(true);
    expect(finaleActions(t, t.lastCallAt - 1, { lastCallPosted: false }).postLastCall).toBe(false); // before 20:00
    expect(finaleActions(t, t.farewellUnlockAt, { lastCallPosted: false }).postLastCall).toBe(false); // freeze supersedes
    expect(finaleActions(t, t.lastCallAt, { lastCallPosted: true }).postLastCall).toBe(false); // dedup
  });

  it('freezes + podiums at/after the farewell unlock only while not yet frozen', () => {
    const t = finaleTimes(mainDays())!;
    expect(finaleActions(t, t.farewellUnlockAt, { lastCallPosted: false }).freezeAndPodium).toBe(true);
    expect(finaleActions(t, t.farewellUnlockAt - 1, { lastCallPosted: false }).freezeAndPodium).toBe(false);
    expect(finaleActions(t, t.farewellUnlockAt, { frozenAt: 123, lastCallPosted: false }).freezeAndPodium).toBe(false);
  });
});

describe('runScheduledUnlock — the finale beats through the write path (AC 3)', () => {
  it('at 20:00 Day 9 posts exactly one last_call Moment and does not touch frozenAt', async () => {
    const db = makeDb({ eventId: 'e1', event: { days: mainDays() } });
    const at2000Day9 = D9_UNLOCK + LAST_CALL_LEAD_MS;
    await runScheduledUnlock(db, 'e1', { now: () => at2000Day9 });
    await runScheduledUnlock(db, 'e1', { now: () => at2000Day9 + 60_000 }); // retry same window

    const lastCalls = db.moments().filter((m) => m.kind === 'last_call');
    expect(lastCalls).toHaveLength(1);
    expect(lastCalls[0].dayIndex).toBe(8);
    expect(db.moments().filter((m) => m.kind === 'podium')).toHaveLength(0);
    expect(db.readEvent().frozenAt).toBeUndefined();
  });

  it('at 08:00 Day 10 sets frozenAt and posts exactly one podium Moment', async () => {
    const db = makeDb({ eventId: 'e1', event: { days: mainDays() } });
    await runScheduledUnlock(db, 'e1', { now: () => D10_UNLOCK });
    await runScheduledUnlock(db, 'e1', { now: () => D10_UNLOCK + 60_000 }); // retry

    expect(db.readEvent().frozenAt).toBe(D10_UNLOCK);
    const podiums = db.moments().filter((m) => m.kind === 'podium');
    expect(podiums).toHaveLength(1);
    expect(podiums[0].dayIndex).toBe(9);
    // The farewell Day's own snapshot is stamped by the same 08:00 run.
    expect(db.readEvent().days!.find((d) => d.index === 9)!.snapshotItemIds).toEqual([]);
  });
});

describe('manualUnlockNow — the admin fallback (AC 2)', () => {
  it('is admin-gated: isEventAdmin only accepts a uid on the roster', () => {
    const event: EventLike = { admins: ['admin-1'] };
    expect(isEventAdmin(event, 'admin-1')).toBe(true);
    expect(isEventAdmin(event, 'someone-else')).toBe(false);
    expect(isEventAdmin(event, undefined)).toBe(false);
    expect(isEventAdmin({}, 'admin-1')).toBe(false);
  });

  it('produces the identical snapshot the scheduled path would for the same Day', async () => {
    const seed = () => ({
      eventId: 'e1',
      event: { days: mainDays(), admins: ['admin-1'] },
      items: [
        { id: 'a', status: 'active', pool: 'main' },
        { id: 'b', status: 'active', pool: 'main' },
      ],
    });
    const now = () => D9_UNLOCK + 1;

    const scheduled = makeDb(seed());
    await stampDaySnapshot(scheduled, 'e1', 8, { now });

    const manual = makeDb(seed());
    const result = await manualUnlockNow(manual, 'admin-1', 'e1', 8, { now });

    expect(result).toBe('stamped');
    const manualIds = manual.readEvent().days!.find((d) => d.index === 8)!.snapshotItemIds;
    const scheduledIds = scheduled.readEvent().days!.find((d) => d.index === 8)!.snapshotItemIds;
    expect(manualIds).toEqual(scheduledIds);
    expect(manualIds).toEqual(['a', 'b']);
  });

  it('denies a non-admin caller with UnlockPermissionError and writes nothing', async () => {
    const db = makeDb({
      eventId: 'e1',
      event: { days: mainDays(), admins: ['admin-1'] },
      items: [{ id: 'a', status: 'active', pool: 'main' }],
    });
    await expect(manualUnlockNow(db, 'not-an-admin', 'e1', 8, { now: () => D9_UNLOCK + 1 })).rejects.toBeInstanceOf(
      UnlockPermissionError,
    );
    expect(db.readEvent().days!.find((d) => d.index === 8)!.snapshotItemIds).toBeUndefined();
  });
});
