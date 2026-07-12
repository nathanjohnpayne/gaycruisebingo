/**
 * Stable bottom-tab-bar contract — the ONE source of truth for the app's
 * primary navigation (Card / Feed / Ranks / More).
 *
 * `Nav.tsx` (via `TabBar.tsx`) renders these as the bottom tab bar and
 * `App.tsx` maps each `path` to its page component. This module is the
 * HOT-file owner's frozen mount-point table (see
 * plans/gaycruisebingo-parallelization.md § "Hot / shared files"): Wave-1+
 * tickets fill in their own tab's page component (e.g. `Board.tsx`,
 * `More.tsx`) but must NOT add, remove, reorder, or rename entries here,
 * and must not edit `App.tsx` / `Nav.tsx` to do so.
 *
 * Phase 1.5 (#203, specs/d15-tab-contract.md) is this table's ONE deliberate
 * revision point: Prompts and Admin leave the bar and mount inside the new
 * More tab (its contents are #208), so the set is Card · Feed · Ranks · More.
 */

/** Stable identifier — keys the route table and the page-component map. */
export type TabId = 'card' | 'feed' | 'ranks' | 'more';

export interface TabDef {
  id: TabId;
  /** Bottom-tab-bar label (matches the domain glossary in CONTEXT.md). */
  label: string;
  /** Route path this tab mounts. */
  path: string;
  /** Match this path exactly only (passed through to NavLink/Route `end`). */
  end?: boolean;
}

export const TABS: readonly TabDef[] = [
  { id: 'card', label: 'Card', path: '/', end: true },
  { id: 'feed', label: 'Feed', path: '/feed' },
  { id: 'ranks', label: 'Ranks', path: '/leaderboard' },
  { id: 'more', label: 'More', path: '/more' },
];

/** Fallback path for any unmatched route (`*`) — the Card tab's home. */
export const FALLBACK_PATH = '/';

/**
 * Tabs visible to the current Player. Every Phase-1.5 tab is universal — admin
 * visibility is now an in-menu concern inside More (#208), not a tab-level
 * gate — so this returns the full set. Kept as a function so callers (and the
 * frozen-contract tests) have a stable seam if per-Player gating returns.
 */
export function visibleTabs(): TabDef[] {
  return [...TABS];
}
