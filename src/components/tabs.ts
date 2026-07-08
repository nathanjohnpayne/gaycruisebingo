/**
 * Stable bottom-tab-bar contract — the ONE source of truth for the app's
 * primary navigation (Card / Feed / Ranks / Prompts / Admin-if-admin).
 *
 * `Nav.tsx` (via `TabBar.tsx`) renders these as the bottom tab bar and
 * `App.tsx` maps each `path` to its page component. This module is the
 * HOT-file owner's frozen mount-point table (see
 * plans/gaycruisebingo-parallelization.md § "Hot / shared files"): Wave-1+
 * tickets fill in their own tab's page component (e.g. `Board.tsx`,
 * `ItemPool.tsx`) but must NOT add, remove, reorder, or rename entries
 * here, and must not edit `App.tsx` / `Nav.tsx` to do so.
 */

/** Stable identifier — keys the route table and the page-component map. */
export type TabId = 'card' | 'feed' | 'ranks' | 'prompts' | 'admin';

export interface TabDef {
  id: TabId;
  /** Bottom-tab-bar label (matches the domain glossary in CONTEXT.md). */
  label: string;
  /** Route path this tab mounts. */
  path: string;
  /** Match this path exactly only (passed through to NavLink/Route `end`). */
  end?: boolean;
  /** Visible only to a signed-in Event Admin. */
  adminOnly?: boolean;
}

export const TABS: readonly TabDef[] = [
  { id: 'card', label: 'Card', path: '/', end: true },
  { id: 'feed', label: 'Feed', path: '/feed' },
  { id: 'ranks', label: 'Ranks', path: '/leaderboard' },
  { id: 'prompts', label: 'Prompts', path: '/items' },
  { id: 'admin', label: 'Admin', path: '/admin', adminOnly: true },
];

/** Fallback path for any unmatched route (`*`) — the Card tab's home. */
export const FALLBACK_PATH = '/';

/** Tabs visible to the current Player, gating admin-only tabs on `isAdmin`. */
export function visibleTabs(isAdmin: boolean): TabDef[] {
  return TABS.filter((tab) => !tab.adminOnly || isAdmin);
}
