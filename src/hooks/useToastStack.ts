import { useEffect, useSyncExternalStore } from 'react';

/**
 * Toast-priority coordinator (#219, specs/d15-pwa-toasts.md): InstallPrompt
 * and UpdatePrompt mount as siblings outside AuthProvider and each decide on
 * their own whether they WANT to show; this ranks who gets a slot — urgent
 * (update) outranks invitational (install), newest wins ties, capped at
 * MAX_VISIBLE_TOASTS. Module-singleton + useSyncExternalStore, same shape as
 * useInstallPrompt's shared store. Also carries two smaller cross-tree
 * signals this ticket needs: the first-Mark install trigger and the
 * claim-sheet-open update defer.
 */

export type ToastPriority = 'urgent' | 'invitational';
export const MAX_VISIBLE_TOASTS = 2;

interface ToastRequest {
  id: string;
  priority: ToastPriority;
  requestedAt: number;
}

let requests: ToastRequest[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const getSnapshot = () => requests;
// Urgent before invitational; newest first within a priority.
const rank = (list: ToastRequest[]) =>
  [...list].sort((a, b) => (a.priority !== b.priority ? (a.priority === 'urgent' ? -1 : 1) : b.requestedAt - a.requestedAt));

/** Test-only: jsdom doesn't rerun module-init between `it`s in one file. */
export function __resetToastStackForTests(): void {
  requests = [];
  listeners.clear();
}

/** Registers this toast's desire to show, returns whether it won a slot plus
 *  its `stackIndex` (0 = topmost, -1 if it lost out and keeps retrying) and
 *  `visibleCount` — how many toasts are ACTUALLY showing right now (1 or 2),
 *  not the fixed capacity. CSS needs the real count, not MAX_VISIBLE_TOASTS,
 *  to park a lone toast in the bottom slot instead of one slot above it
 *  (Codex review, PR #238). */
export function useToastSlot(id: string, priority: ToastPriority, wantsToShow: boolean) {
  useEffect(() => {
    const existing = requests.find((r) => r.id === id);
    if (wantsToShow) {
      if (existing) existing.priority = priority;
      else requests = [...requests, { id, priority, requestedAt: Date.now() }];
      notify();
    } else if (existing) {
      requests = requests.filter((r) => r.id !== id);
      notify();
    }
    return () => {
      if (requests.some((r) => r.id === id)) {
        requests = requests.filter((r) => r.id !== id);
        notify();
      }
    };
  }, [id, priority, wantsToShow]);

  const ranked = rank(useSyncExternalStore(subscribe, getSnapshot, getSnapshot));
  const rankIndex = ranked.findIndex((r) => r.id === id);
  // Gate on the CURRENT render's `wantsToShow`, not just the (possibly stale)
  // registered request: the registration effect above only reconciles
  // `requests` after commit, so a caller whose `wantsToShow` just flipped
  // false would otherwise still read `visible: true` for one extra render off
  // its now-stale request (Codex review, PR #238).
  const visible = wantsToShow && rankIndex !== -1 && rankIndex < MAX_VISIBLE_TOASTS;
  const visibleCount = Math.min(ranked.length, MAX_VISIBLE_TOASTS);
  return { visible, stackIndex: visible ? rankIndex : -1, visibleCount };
}

// --- First-Mark signal (install nudge trigger) ------------------------------

const HAS_MARKED_KEY = 'gcb.install.hasMarked';
let hasMarkedSquare = false;
let hasMarkedInit = false;
const markListeners = new Set<() => void>();

function ensureHasMarkedInit(): void {
  if (hasMarkedInit) return;
  hasMarkedInit = true;
  try {
    hasMarkedSquare = localStorage.getItem(HAS_MARKED_KEY) !== null;
  } catch {
    hasMarkedSquare = false; // storage unavailable (private mode, etc.)
  }
}

/** Called from track() when `mark_square` fires (analytics.ts) — reuses that
 *  call site instead of a new one in Board.tsx. Persisted like InstallPrompt's
 *  own dismiss key, so the nudge stays eligible across a reload. */
export function markSquareOccurred(): void {
  ensureHasMarkedInit();
  if (hasMarkedSquare) return;
  hasMarkedSquare = true;
  try {
    localStorage.setItem(HAS_MARKED_KEY, String(Date.now()));
  } catch {
    /* still flips in-memory for this session */
  }
  markListeners.forEach((l) => l());
}

/** Test-only. */
export function __resetHasMarkedForTests(): void {
  hasMarkedSquare = false;
  hasMarkedInit = false;
  markListeners.clear();
}

/** Whether the Player has ever marked a Square on this device — gates the
 *  install nudge's trigger. */
export function useHasMarkedSquare(): boolean {
  return useSyncExternalStore(
    (l) => (ensureHasMarkedInit(), markListeners.add(l), () => markListeners.delete(l)),
    () => (ensureHasMarkedInit(), hasMarkedSquare),
    () => (ensureHasMarkedInit(), hasMarkedSquare),
  );
}

// --- Claim-sheet-open signal (update banner defer) --------------------------

let claimSheetOpen = false;
const claimSheetListeners = new Set<() => void>();

/** Reports ProofSheet's open state (Board.tsx's `proofTarget`) so UpdatePrompt
 *  — mounted outside the auth-gated tree, with no other view into Board's
 *  state — can defer its reload offer while a proof capture is in progress.
 *  In-memory only; not persisted across a reload. */
export function setClaimSheetOpen(open: boolean): void {
  if (claimSheetOpen === open) return;
  claimSheetOpen = open;
  claimSheetListeners.forEach((l) => l());
}

/** Test-only. */
export function __resetClaimSheetOpenForTests(): void {
  claimSheetOpen = false;
  claimSheetListeners.clear();
}

/** Whether a claim sheet is open — gates the update banner. */
export function useClaimSheetOpen(): boolean {
  return useSyncExternalStore(
    (l) => (claimSheetListeners.add(l), () => claimSheetListeners.delete(l)),
    () => claimSheetOpen,
    () => claimSheetOpen,
  );
}
