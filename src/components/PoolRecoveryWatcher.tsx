import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useItems } from '../hooks/useData';
import { MIN_POOL } from '../game/logic';

/**
 * The pool-recovery auto-retry watcher (issue #70 — the deliberate follow-up split
 * out of PR #66 after three review rounds each exposed a new hole).
 *
 * The manual Retry on the Card-route DealError panel already ships (#26): when a
 * join/deal fails because the active non-free Prompt pool is below MIN_POOL (24), the
 * Player can add Prompts on /items and press Retry. This component adds the AUTOMATIC
 * retry: when the pool RECOVERS from below-floor to above-floor, it fires the deal
 * itself so the Player who added Prompts doesn't have to notice and press Retry.
 *
 * The three PR #66 findings, each honored here:
 *
 *   1. WATCHER LOCATION (finding 3542374455). The watcher must live somewhere mounted
 *      for the WHOLE recovery journey. The DealError panel unmounts the moment the
 *      Player navigates to /items to add Prompts — the exact recovery path — so a
 *      watcher there dies before it can observe recovery. This component is mounted at
 *      the app SHELL (in AuthProvider, above the tab Router, beside ConfirmWinMoments),
 *      so it survives every route change and the whole below→above journey.
 *
 *   2. REAL TRANSITION ONLY (finding 3542374448). It must require a REAL below-floor →
 *      above-floor crossing, never fire on the initial pool-snapshot load. Two guards
 *      compose: (a) it only ARMS a pool subscription when the last deal failure was a
 *      pool-shortfall (`dealErrorReason === 'pool-shortfall'`, the typed marker
 *      AuthContext sets) — a connection/permission failure never subscribes and so can
 *      never auto-retry when a healthy first snapshot arrives; and (b) it edge-triggers
 *      off a SERVER-COMMITTED baseline — the first fully server-committed snapshot under
 *      an arming is recorded as the baseline (never a trigger), and only a below→above
 *      crossing from there fires. `useItems()` starting empty (`activePool = 0`), the
 *      ADR 0006 cache-only replays, AND this client's own local optimistic prompt-add
 *      echoes are all ignored — see F1 below for why both metadata flags are required.
 *
 *   3. FIRE-ONCE-PER-RECOVERY + NO-LOOP. After firing, the baseline latches to
 *      above-floor, so a failed auto-retry (the error re-appears with the pool still
 *      healthy) produces no new crossing and cannot spin. Only a genuine dip back below
 *      the floor followed by another crossing re-arms and fires a second time — once per
 *      recovery, never per snapshot.
 *
 * It coordinates with the `useItems(!board)` listener gating (Board holds the pool
 * subscription pre-deal; a dealt Board holds none): this watcher opens the pool
 * subscription EXACTLY while someone is watching for recovery (a pool-shortfall error is
 * up) and closes it the instant the error clears — the subscription lives precisely for
 * the recovery window.
 *
 * It composes with #117's deal machinery rather than duplicating it: the retry calls the
 * SAME `retryDeal` the manual button does, so it inherits #117's write-safety gate
 * (deal only when `online && attestedAuthoritative && attested`; offline or on a merely
 * provisional attestation `retryDeal` re-runs the bootstrap instead of creating rows).
 * The watcher never re-derives that gate.
 */
export default function PoolRecoveryWatcher() {
  const { dealErrorReason } = useAuth();
  // Arm a pool subscription ONLY while a pool-shortfall deal error is up (guard 2a).
  // Rendering null when disarmed means NO pool/event subscription is opened for a
  // connection/permission failure — the subscription exists exactly when someone is
  // watching for recovery, and `ArmedPoolRecoveryWatcher`'s baseline re-seeds fresh on
  // every re-arming (it mounts anew), so each recovery journey starts from a clean
  // baseline with no stale latch carried across.
  if (dealErrorReason !== 'pool-shortfall') return null;
  return <ArmedPoolRecoveryWatcher />;
}

/**
 * The armed watcher: subscribes to the live pool and fires `retryDeal` on the first
 * genuine below-floor → above-floor crossing. Mounted only while a pool-shortfall
 * error is up (see `PoolRecoveryWatcher`), so its edge state is per-recovery-arming.
 */
function ArmedPoolRecoveryWatcher() {
  const { dealing, retryDeal } = useAuth();
  // Subscribe to the pool (enabled=true — we are armed). The F1 gate is per-snapshot and
  // needs BOTH metadata flags: a snapshot is fully SERVER-COMMITTED only when it is
  // server-backed (`!fromCache`) AND carries no local optimistic write (`!hasPendingWrites`).
  // This client's own not-yet-acked prompt-add arrives with `fromCache === false` but
  // `hasPendingWrites === true`, so a `fromCache`-only gate would fire before the commit.
  const { items, fromCache, hasPendingWrites } = useItems(true);
  const serverCommitted = !fromCache && !hasPendingWrites;
  const above = items.filter((i) => !i.isFreeSpace).length >= MIN_POOL;

  // The last SERVER-BACKED pool state under this arming:
  //   null  = no server-backed snapshot yet (needs a baseline)
  //   true  = last server-backed snapshot was BELOW the floor (recovery pending)
  //   false = last server-backed snapshot was AT/ABOVE the floor
  // The first server-backed snapshot seeds this (never fires); a true→(above) crossing
  // fires and latches back to false (fire-once, no loop); a later server-backed dip
  // re-arms `true` so a second genuine recovery can fire again.
  const wasBelowRef = useRef<boolean | null>(null);
  // Read `retryDeal` through a ref so the edge effect is driven only by the pool signal
  // and `dealing` — retryDeal's identity churn (it re-memoizes on every #117
  // auth/connectivity state change) must not re-run the edge logic and re-adjudicate an
  // already-consumed crossing. `dealing` IS a dependency (F2): the effect must re-run
  // when a deal settles so a crossing preserved during it can then fire.
  const retryDealRef = useRef(retryDeal);
  retryDealRef.current = retryDeal;

  useEffect(() => {
    // F1 (Codex P2, comments 3553033594 + 3553182524): only fully SERVER-COMMITTED
    // snapshots participate. Gating on the lifetime `hasServerData` latch would let a
    // later cache/local snapshot read as a server crossing and consume the edge before
    // the SERVER pool crossed; and gating on `fromCache` alone would let THIS client's
    // own optimistic prompt-add (`fromCache === false`, `hasPendingWrites === true`) fire
    // the retry BEFORE the write is server-acked — if that write is rejected, or
    // joinAndDeal's server read still sees < MIN_POOL, the later real server snapshot
    // produces no new crossing and the recovery is spent. So both the baseline and the
    // crossing require `serverCommitted` (`!fromCache && !hasPendingWrites`): a cache
    // snapshot (incl. the initial empty `items`, which is cache-origin) OR a local
    // optimistic echo is neither a baseline nor a trigger.
    if (!serverCommitted) return;
    if (wasBelowRef.current === null) {
      // First server-committed snapshot under this arming = BASELINE, never a trigger
      // ("the first snapshot is a baseline not a trigger").
      wasBelowRef.current = !above;
      return;
    }
    if (wasBelowRef.current && above) {
      // A real server-committed below-floor → above-floor crossing: the pool recovered.
      if (dealing) {
        // F2 (Codex P2, comment 3553033597): a deal is already in flight (a manual Retry,
        // or a prior auto-retry that read the still-below pool). Do NOT consume the edge —
        // leave the below baseline intact so this recovery survives the in-flight deal.
        // That deal may have read the below-floor pool and will fail, leaving the error
        // up; if this crossing consumed the edge, no later above-floor snapshot would
        // re-fire. `dealing` is a dependency, so when it clears this effect re-runs and,
        // if the current server-backed snapshot still shows above-floor, fires then —
        // never consumed without firing.
        return;
      }
      // Latch to above-floor FIRST (fire-once-per-recovery; a failed auto-retry that
      // leaves the pool healthy produces no new crossing → no loop), THEN fire the SAME
      // deal path the manual Retry does. Ordering matters: retryDeal → runDeal flips
      // `dealing` true synchronously, re-running this effect; the already-cleared
      // baseline makes that re-run a no-op, so the crossing fires exactly once.
      wasBelowRef.current = false;
      retryDealRef.current();
      return;
    }
    // Track the server-committed pool so a later dip below the floor re-arms `true` for
    // a 2nd recovery.
    wasBelowRef.current = !above;
  }, [above, serverCommitted, dealing]);

  return null;
}
