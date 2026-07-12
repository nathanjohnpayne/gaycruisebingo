import { useState } from 'react';
import { EVENT_ID } from '../firebase';

/**
 * First-open coach overlay (specs/d15-coach-overlay.md, #214): a once-per-
 * Event scrim decoding the Board's badge notation — Tally count, 👀 Doubt
 * badge, ＋ add-proof, free space. Narrower than the Welcome Aboard banner
 * (#213), which carries the game's rules; this only decodes notation.
 * `Board` mounts it unconditionally whenever it has cells — per-Event (not
 * per-Day) gating alone shows it over the Player's first dealt card.
 */

const dismissKey = (eventId: string): string => `gcb.coachOverlay.${eventId}.dismissedAt`;

// try/catch — private-mode/storage-unavailable falls open (isDismissed →
// false; markDismissed a no-op), same fallback as InstallPrompt.tsx's key.
function isDismissed(eventId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(eventId)) !== null;
  } catch {
    return false;
  }
}
function markDismissed(eventId: string): void {
  try {
    localStorage.setItem(dismissKey(eventId), String(Date.now()));
  } catch {
    /* nothing to persist */
  }
}

const LEGEND: readonly { label: string; copy: string }[] = [
  { label: 'Tally count', copy: 'The number on a marked square is how many players got it too—tap it to see who.' },
  { label: '👀 Doubt badge', copy: "Means someone wants proof. Attach a photo to clear it—a Doubt never unmarks your square, it's never a gate." },
  { label: '＋ Add proof', copy: 'Tap the plus on any marked square to attach a pic and back it up.' },
  { label: 'Free space', copy: 'The center square is free—already marked for everyone.' },
];

export type CoachOverlayProps = {
  /** Defaults to the real Event id; overridable so tests avoid the real key. */
  eventId?: string;
  /** Replay mode (More → How to play, #208): always renders regardless of
   *  the stored dismissal (replaying isn't "already seen it" bookkeeping);
   *  dismissing a replay still writes the stored timestamp. */
  forceOpen?: boolean;
  onDismiss?: () => void;
};

export default function CoachOverlay({ eventId = EVENT_ID, forceOpen = false, onDismiss }: CoachOverlayProps) {
  const [dismissedThisMount, setDismissedThisMount] = useState(false);

  if (dismissedThisMount) return null;
  if (!forceOpen && isDismissed(eventId)) return null;

  const handleDismiss = () => {
    markDismissed(eventId);
    setDismissedThisMount(true);
    onDismiss?.();
  };

  return (
    <div className="sheet-backdrop coach-overlay-backdrop">
      <div className="sheet coach-overlay" role="dialog" aria-modal="true" aria-label="How to read your card">
        <p className="sheet-title">How to read your card</p>
        <ul className="coach-overlay-legend">
          {LEGEND.map((row) => (
            <li key={row.label} className="coach-overlay-row">
              <span className="coach-overlay-label">{row.label}</span>
              <span className="coach-overlay-copy">{row.copy}</span>
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <button type="button" className="btn primary block coach-overlay-cta" onClick={handleDismiss}>
            Got it—deal me in.
          </button>
        </div>
      </div>
    </div>
  );
}
