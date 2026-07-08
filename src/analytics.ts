import { logEvent } from 'firebase/analytics';
import { analytics } from './firebase';

/**
 * GA4 event catalog — the single source of truth for every analytics event
 * this app fires (the PRD's "GA4 events" list plus the Doubt-flow
 * `demand_proof` event). `track()` below is the only call into Firebase's
 * `logEvent`; nothing else should import `firebase/analytics` directly.
 * Call sites: `login` (auth/AuthContext.tsx), `join_event` (App.tsx),
 * `add_item` + `report_item` (components/ItemPool.tsx, ProofFeed.tsx),
 * `mark_square` + `bingo` + `blackout` (components/Board.tsx),
 * `attach_proof` (components/ProofSheet.tsx), `theme_change`
 * (components/ThemeSwitcher.tsx), `share_click` (components/Celebration.tsx).
 * `demand_proof` (Doubt flow, #33) and `install_pwa` (install-prompt flow,
 * #30) are catalogued and type-checked here so each ticket can add its one
 * call site as a one-line `track(...)` addition; this ticket (#38) does not
 * build either flow.
 */
export const GA4_EVENTS = [
  'login',
  'join_event',
  'add_item',
  'report_item',
  'mark_square',
  'attach_proof',
  'demand_proof',
  'bingo',
  'blackout',
  'theme_change',
  'share_click',
  'install_pwa',
] as const;

export type GA4EventName = (typeof GA4_EVENTS)[number];

/** Fire a GA4 event if analytics is available. Never throws. */
export function track(name: GA4EventName, params?: Record<string, unknown>): void {
  try {
    // Firebase's `logEvent` overloads key off literal reserved event names
    // (e.g. `login`), so a union type like `GA4EventName` matches no single
    // overload — widen to `string` (the SDK's generic-event overload).
    if (analytics) logEvent(analytics, name as string, params as Record<string, unknown>);
  } catch {
    /* no-op */
  }
}
