import { useState } from 'react';

const KEY = 'gcb.consent.analytics.dismissedAt';

/** Whether the 18+ analytics disclosure was already dismissed on this device. */
function isDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false; // storage unavailable (private mode, etc.) — show the notice
  }
}

/**
 * A lightweight, dismissible disclosure that this 18+ app uses GA4 analytics.
 * This is deliberately NOT a consent-management platform and NOT a gate:
 * `firebase.ts` already loads GA4 unconditionally (when supported + a
 * measurement id is configured), so dismissing this notice does not opt
 * anyone out of analytics — it only stops re-showing the disclosure on this
 * device. Copy and region handling are an open decision (#15); this ships
 * that issue's recommended default (a lightweight in-app notice, no region
 * gating) rather than blocking on it.
 */
export default function ConsentNotice() {
  const [dismissed, setDismissed] = useState(isDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore storage errors — still hides for this session */
    }
    setDismissed(true);
  };

  return (
    <div className="consent-notice" role="note">
      <p>
        This is an 18+ app. We use Google Analytics (GA4) to see what&rsquo;s working — nothing
        here is sold, and it&rsquo;s kept separate from your marks and proof.
      </p>
      <button className="btn" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
