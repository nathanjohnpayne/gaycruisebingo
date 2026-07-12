import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'gcb.textSize';

/** Small / Medium / Large (daily-cards-spec § "More menu" item 3). */
export type TextSize = 'small' | 'medium' | 'large';
export const DEFAULT_TEXT_SIZE: TextSize = 'medium';
const VALID_SIZES: ReadonlySet<string> = new Set<TextSize>(['small', 'medium', 'large']);

/** Type guard: only a currently-known size is a valid TextSize. */
function isTextSize(value: string | null | undefined): value is TextSize {
  return value != null && VALID_SIZES.has(value);
}

/** The locally-saved pick (localStorage) if it's still a valid value, else null. */
function savedTextSize(): TextSize | null {
  try {
    const saved = localStorage.getItem(KEY);
    if (isTextSize(saved)) return saved;
  } catch {
    /* ignore storage errors — same defensive posture as ThemeContext.tsx */
  }
  return null;
}

/**
 * Module-level singleton store (mirrors `useInstallPrompt`'s shared-store
 * pattern, #208/Codex P2 on #232) backing `useTextSize`. The More menu's
 * S/M/L control and Board's per-Square auto-fit guard are two independent
 * mount points that both need the SAME live pick — a plain per-component
 * `useState` would leave Board reading a stale value until it happened to
 * remount, so this is a shared store subscribed to via
 * `useSyncExternalStore` instead, same as ThemeContext's `data-theme`
 * application but without the Context/Provider machinery ThemeContext needs
 * for its Firestore cross-device sync — Text size is device-local only (see
 * `specs/d15-text-size.md`), so a bare module singleton is enough.
 */
let textSize: TextSize = savedTextSize() ?? DEFAULT_TEXT_SIZE;
const subscribers = new Set<() => void>();

/** Reflects the current pick onto `<html data-text-size>` so `index.css`'s
 *  scale variables cascade everywhere on the page — mirrors ThemeContext's
 *  own `document.documentElement.dataset.theme` application. */
function applyToDocument(size: TextSize): void {
  try {
    document.documentElement.dataset.textSize = size;
  } catch {
    /* no DOM (e.g. a non-browser test import) — nothing to reflect yet */
  }
}

// Apply the saved pick at module init — unconditionally, not only once some
// component happens to mount `useTextSize` (PR #237 Codex finding: a reload
// straight into a route that renders neither Board nor More, e.g. /feed or
// /ranks, otherwise never reflects a saved Small/Large pick onto `<html>`,
// so body text silently falls back to the medium CSS default on those
// routes until the Player happens to visit a subscribing one).
applyToDocument(textSize);

function setState(next: TextSize): void {
  textSize = next;
  applyToDocument(textSize);
  for (const notify of subscribers) notify();
}

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange);
  return () => subscribers.delete(onStoreChange);
}

function getSnapshot(): TextSize {
  return textSize;
}

/** Test-only: resets the module singleton between tests (jsdom never
 *  reruns module-init between `it`s in the same file, so tests must reset
 *  this explicitly — same rationale as
 *  `useInstallPrompt.__resetInstallPromptStateForTests`). Not exported from
 *  the app's own code paths — only test files import it. */
export function __resetTextSizeStateForTests(): void {
  textSize = savedTextSize() ?? DEFAULT_TEXT_SIZE;
  subscribers.clear();
  // Mirrors the unconditional module-init application above — a reset
  // simulates a fresh page load/reload, which now applies immediately too.
  applyToDocument(textSize);
}

/**
 * The Player's text-size pick (More menu § "Text size", daily-cards-spec §
 * "More menu" item 3): Small / Medium / Large, persisted per device
 * (`localStorage['gcb.textSize']`) — same persistence mechanism as the
 * theme pick (`gcb.theme`, ThemeContext.tsx), deliberately never a
 * Firestore write (device-local, not cross-device — unlike a Player's
 * theme). Every mount point (More's row, Board's fit guard) reads from and
 * writes into the SAME shared store (see the module doc above), so a pick
 * made in More is reflected on Board immediately, no remount required.
 */
export function useTextSize(): [TextSize, (size: TextSize) => void] {
  const size = useSyncExternalStore(subscribe, getSnapshot);

  const setTextSize = useCallback((next: TextSize) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore storage errors */
    }
    setState(next);
  }, []);

  return [size, setTextSize];
}
