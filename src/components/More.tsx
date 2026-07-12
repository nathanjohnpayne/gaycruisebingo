import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useEventDoc, usePendingItemCount } from '../hooks/useData';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { THEMES } from '../theme/themes';
import { eventTitle } from '../format';
import ProfileEditor from './ProfileEditor';
import ThemeSwitcher from './ThemeSwitcher';
import ItemPool from './ItemPool';
import Admin from './Admin';
import BugReport from './BugReport';
import AcceptableUse from './AcceptableUse';

/**
 * The More tab (#208, daily-cards-spec § "More menu"): profile, theme, Play
 * (schedule / suggest / how-to-play / install), Support (bug / 18+), an
 * admin-only Admin row, sign out, and a version footer — in that fixed order.
 * Replaces `d15-tab-contract`'s interim placeholder (#203, specs/d15-tab-
 * contract.md) wholesale. `ItemPool` and `Admin` mount here as sub-panels
 * instead of top-level routes (their own internals are untouched); `BugReport`
 * and `AcceptableUse` relocate here too (`variant="row"`), replacing their
 * former fixed-position floating mounts in `App.tsx` / `Board.tsx` / `main.tsx`
 * — see specs/d15-more-menu.md § Contract for the full mount-point rationale.
 *
 * Text size (its own row, #215) deliberately does NOT live here yet — the
 * issue reserves its slot in the Theme/Play section rather than stubbing it.
 */
export default function More() {
  const { user, signOutUser } = useAuth();
  const { data: event } = useEventDoc();
  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  const { count: pendingCount } = usePendingItemCount(isAdmin);
  const { standalone, deferred, showIOSHint, install } = useInstallPrompt();

  const [panel, setPanel] = useState<null | 'schedule' | 'suggest' | 'howToPlay' | 'admin'>(null);
  const closePanel = () => setPanel(null);

  const showInstallRow = !standalone && (!!deferred || showIOSHint);

  return (
    <div className="more">
      {/* 1. Profile card — avatar, name, @handle; tap opens ProfileEditor's sheet. */}
      <ProfileEditor />

      {/* 2. Theme — Auto (match the day) + every party/tutorial theme. */}
      <div className="more-section">
        <h3>Theme</h3>
        <ThemeSwitcher />
      </div>

      {/* 3. Play — schedule, suggest a square, how to play, install. */}
      <div className="more-section">
        <h3>Play</h3>
        <div className="more-rows">
          <MoreRow title="Cruise schedule" sub="Ports, parties, unlock times" onClick={() => setPanel('schedule')} />
          <MoreRow title="Suggest a square" sub="Add a prompt to the pool" onClick={() => setPanel('suggest')} />
          <MoreRow title="How to play" sub="The three-beat replay" onClick={() => setPanel('howToPlay')} />
          {showInstallRow && (
            <button type="button" className="more-row" onClick={deferred ? install : undefined}>
              <span className="more-row-text">
                <span className="more-row-title">Install the app</span>
                <span className="more-row-sub">
                  {deferred
                    ? 'Full screen, works offline at sea.'
                    : 'Add to Home Screen: tap Share, then "Add to Home Screen."'}
                </span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 5. Support — report a bug, 18+ advisory & acceptable use. */}
      <div className="more-section">
        <h3>Support</h3>
        <div className="more-rows">
          <BugReport variant="row" />
          <AcceptableUse variant="row" />
        </div>
      </div>

      {/* 6. Admin (admins only) — badged with the pending-approvals count. */}
      {isAdmin && (
        <div className="more-section">
          <div className="more-rows">
            <MoreRow title="Admin" badge={pendingCount > 0 ? pendingCount : undefined} onClick={() => setPanel('admin')} />
          </div>
        </div>
      )}

      {/* 7. Sign out — last, visually quiet. */}
      <div className="more-section">
        <button type="button" className="more-row more-row-quiet" onClick={() => signOutUser()}>
          <span className="more-row-text">
            <span className="more-row-title">Sign out</span>
          </span>
        </button>
      </div>

      {/* 8. Version footer: build, sailing, dates. */}
      <p className="more-version muted">
        v{__APP_VERSION__}
        {event ? ` · ${eventTitle(event.name, event.sailStart, event.sailEnd)}` : ''}
      </p>

      {panel === 'schedule' && (
        <MorePanel title="Cruise schedule" onClose={closePanel}>
          <ScheduleList event={event} />
        </MorePanel>
      )}
      {panel === 'suggest' && (
        <MorePanel title="Suggest a square" onClose={closePanel}>
          <ItemPool />
        </MorePanel>
      )}
      {panel === 'howToPlay' && (
        <MorePanel title="How to play" onClose={closePanel}>
          <HowToPlay />
        </MorePanel>
      )}
      {panel === 'admin' && isAdmin && (
        <MorePanel title="Admin" onClose={closePanel}>
          <Admin />
        </MorePanel>
      )}
    </div>
  );
}

/** One tappable row in the menu: title, optional subtitle, optional count badge. */
function MoreRow({
  title,
  sub,
  badge,
  onClick,
}: {
  title: string;
  sub?: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="more-row" onClick={onClick}>
      <span className="more-row-text">
        <span className="more-row-title">{title}</span>
        {sub && <span className="more-row-sub">{sub}</span>}
      </span>
      {typeof badge === 'number' && <span className="pill more-badge">{badge}</span>}
    </button>
  );
}

/** Elements the Tab-trap below will cycle between while a panel is open —
 *  mirrors AcceptableUse.tsx's `FOCUSABLE_SELECTOR`. */
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A More sub-panel (Cruise schedule / Suggest a square / How to play / Admin):
 * reuses the app's existing sheet chrome (`.sheet-backdrop`/`.sheet`) so it
 * reads as the same kind of surface as every other modal in the app. Moves
 * focus to the title on open and restores it to nothing in particular on
 * close (More itself regains focus naturally — these panels are reached from
 * a menu row, not a small icon trigger that benefits from a focus-restore
 * pin), closes on Escape or a backdrop click. Traps Tab/Shift+Tab inside the
 * panel while open (same pattern as BugReport.tsx / AcceptableUse.tsx) so
 * keyboard and screen-reader users can't tab past Close into the obscured
 * More menu or bottom nav behind the backdrop.
 */
function MorePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // The title also holds focus (tabIndex=-1, the initial landing spot) but
      // is deliberately excluded from FOCUSABLE_SELECTOR — treat it as
      // preceding `first` so Shift+Tab from it still wraps to the end.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="sheet more-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-title" ref={titleRef} tabIndex={-1}>
          {title}
        </div>
        {children}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The read-only Cruise schedule (issue #208 § Play): the ten Days — port,
 * party, unlock time. Editing the schedule is #221's Admin console job, not
 * this row's. Formats each Day's unlock time in the Event's own IANA
 * `timezone` (falls back to the browser's local zone while the Event doc is
 * still loading) so the times read correctly regardless of the viewer's own
 * clock.
 */
function ScheduleList({ event }: { event: { days: import('../types').DayDef[]; timezone: string } | null | undefined }) {
  if (!event || event.days.length === 0) {
    return <p className="muted">The schedule isn't set yet.</p>;
  }
  const themeLabel = (id: string) => THEMES.find((t) => t.id === id);
  return (
    <div className="list">
      {event.days.map((day) => {
        const theme = themeLabel(day.theme);
        const time = new Intl.DateTimeFormat(undefined, {
          timeZone: event.timezone || undefined,
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(day.unlockAt));
        return (
          <div key={day.index} className="row">
            <div className="grow">
              <div className="name">
                {day.portEmoji} {day.port}
              </div>
              <div className="sub">
                {theme ? `${theme.emoji} ${theme.label}` : day.theme} · unlocks {time}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * How to play (issue #208 § Play): a static rendering of the Embark view's
 * "How this works" three beats (daily-cards-spec § "Embark (tutorial) view").
 * Copy is verbatim from the spec — do not paraphrase. The real first-open
 * coach-overlay replay wiring is #214, which depends on this ticket for the
 * mount point; this row is deliberately just the static copy until then.
 */
function HowToPlay() {
  return (
    <ol className="more-howtoplay">
      <li>
        <b>Mark what happens.</b> Tap a square when you see it, do it, or survive it.
      </li>
      <li>
        <b>Five in a row is BINGO.</b> The center is free. Blackout the card if you're ambitious.
      </li>
      <li>
        <b>The feed is the proof.</b> Attach a pic, doubt a friend, watch the Moments roll in.
      </li>
    </ol>
  );
}
