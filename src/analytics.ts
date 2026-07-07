import { logEvent } from 'firebase/analytics';
import { analytics } from './firebase';

/** Fire a GA4 event if analytics is available. Never throws. */
export function track(name: string, params?: Record<string, unknown>): void {
  try {
    if (analytics) logEvent(analytics, name, params as Record<string, unknown>);
  } catch {
    /* no-op */
  }
}
