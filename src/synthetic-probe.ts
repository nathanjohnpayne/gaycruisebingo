// Detect the production uptime synthetic (issue #142). The synthetic loads the
// live site every 15 minutes purely to assert the app mounts; it sets a
// `GCB-Synthetic` User-Agent marker (playwright.synthetic.config.ts) so the app
// can skip analytics for it. Without this, each load would fire a PostHog
// pageview + GA4 page_view — ~96 synthetic pageviews/day inflating a small
// event app's real product metrics for a load that represents no real user.
//
// Marker matching is substring-based so the probe stays a normal Chrome UA
// (feature detection unaffected) with the marker appended.
export const SYNTHETIC_UA_MARKER = 'GCB-Synthetic';

export function isSyntheticProbe(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.userAgent === 'string' &&
    navigator.userAgent.includes(SYNTHETIC_UA_MARKER)
  );
}
