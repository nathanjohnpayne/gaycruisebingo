import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  useEventDoc,
  usePendingClaims,
  usePendingItems,
  useReportedProofs,
  useAllItems,
  isReportHidden,
  isBanned,
  isSystemAuthor,
} from '../hooks/useData';
import {
  confirmClaim,
  rejectClaim,
  adminAddItem,
  adminUpdateItemText,
  hideProof,
  restoreProof,
  clearProofReports,
  hideItem,
  restoreItem,
  deleteItem,
  clearItemReports,
  approveItem,
  rejectItem,
  bulkApproveItems,
  setItemSpicy,
  setClaimMode,
  setEventTheme,
  setDayTheme,
  setPhotoProofSource,
  setStripPhotoExif,
  setVisionGate,
  setReportHideThreshold,
  banUser,
  unbanUser,
  unlockDayNow,
} from '../data/admin';
import { deleteProof } from '../data/proofs';
import { tutorialDayIndexSet, ceremonialDayIndexSet, standingsFrozen, dayDueForManualUnlock } from '../game/logic';
import { THEMES } from '../theme/themes';
import type { ClaimMode, DayDef, EventDoc, ItemDoc, ProofDoc, ThemeId } from '../types';

// One report-queue row, tagged so the render can branch to the per-kind
// affordances (Proof vs Prompt writes) while a single list sorts across both
// kinds. `sortCount`/`sortAt` are hoisted so the most-reported-first sort (with a
// createdAt tiebreak) reads one flat stream (Codex P3, PR #107 finding 4).
type QueueRow =
  | { kind: 'proof'; sortCount: number; sortAt: number; proof: ProofDoc }
  | { kind: 'item'; sortCount: number; sortAt: number; item: ItemDoc };

/**
 * Ban / Unban the AUTHOR of a queued row (#108). Banning is an admin action on the
 * CURRENT event: it adds/removes the content owner's uid on the event doc's
 * `bannedUids` roster (`data/admin` banUser/unbanUser → arrayUnion/arrayRemove), the
 * ADR 0004 Phase 0 presentational hide/mute the #113 rules landed. It is a
 * MODERATION / DISPUTE tool, NOT anti-cheat (ADR 0001) and NOT hard access
 * revocation (server-authoritative enforcement is #43/#44) — a banned Player's
 * content is filtered from every PUBLIC/player surface (the read hooks + the deal
 * path), yet stays reachable HERE so an Admin can review it and unban. The label
 * reflects the current banned state.
 */
function BanControl({
  uid,
  bannedUids,
  admins,
}: {
  uid: string;
  bannedUids: string[];
  admins: string[];
}) {
  // Two kinds of author are NOT bannable, so no Ban control renders for them:
  //  - System/sentinel authors ('seed', the createdBy on every seeded default
  //    Prompt) — Codex P1, PR #122: a single Ban click would add 'seed' to
  //    bannedUids and hide the ENTIRE default pool from useItems AND the deal path.
  //  - Fellow ADMINS — Codex P2, PR #122 round 2: #113's rules REJECT any resulting
  //    bannedUids that overlaps `admins` (firestore.rules `!bannedUids.hasAny(admins)`,
  //    pinned in tests/rules/w2-banned-uids.test.ts), so offering Ban on an
  //    admin-authored row is a doomed action that can only fail with a permission
  //    error. Suppress it so the admin never sees an action that cannot succeed.
  // A banned sentinel stays recoverable via the Banned players section's Unban
  // (not gated); an admin uid can never be in bannedUids in the first place.
  if (isSystemAuthor(uid) || admins.includes(uid)) return null;
  return isBanned(uid, bannedUids) ? (
    <button className="btn" title="Un-mute this player's content" onClick={() => unbanUser(uid)}>
      Unban author
    </button>
  ) : (
    <button
      className="btn"
      title="Mute this player's content on this event (moderation, not anti-cheat)"
      onClick={() => banUser(uid)}
    >
      Ban author
    </button>
  );
}

/**
 * One reported-Proof row in the moderation queue. `Clear reports` lifts the ADR
 * 0004 Phase 0 community auto-hide by zeroing reportCount — rendered ONLY when the
 * row is actually auto-hidden (the only state with a hide to lift; Codex P2, PR
 * #107 finding 3). It is distinct from Restore, which lifts the `status` hard-hide,
 * so a doubly-hidden row (status hidden AND over threshold) shows both. `Ban author`
 * mutes the Proof's owner across the event (#108); the row stays reachable after.
 */
function ProofQueueRow({
  proof: p,
  threshold,
  bannedUids,
  admins,
  days,
  frozenAt,
}: {
  proof: ProofDoc;
  threshold: number | undefined;
  bannedUids: string[];
  admins: string[];
  // The Event's Day schedule (#246): present ⇒ daily-cards mode, so a proof
  // deletion unmarks the DAY-SCOPED board for the Proof's own `dayIndex`.
  days: DayDef[] | undefined;
  // The scheduler's freeze stamp (#265) — folded with the schedule through
  // standingsFrozen at delete time.
  frozenAt?: number;
}) {
  const autoHidden = isReportHidden(p.reportCount, threshold);
  return (
    <div className="row">
      <div className="grow">
        <div className="name">
          {p.displayName}
          <span className="pill">{p.reportCount} ⚑</span>
          {p.visionFlag && <span className="pill">{p.visionFlag}</span>}
          {autoHidden && <span className="pill pill-hidden">auto-hidden</span>}
        </div>
        <div className="sub">
          proof · {p.type} · {p.itemText}
        </div>
      </div>
      {autoHidden && (
        <button className="btn" onClick={() => clearProofReports(p.id)}>
          Clear reports
        </button>
      )}
      {p.status === 'hidden' ? (
        <button className="btn" onClick={() => restoreProof(p.id)}>
          Restore
        </button>
      ) : (
        <button className="btn" onClick={() => hideProof(p.id)}>
          Hide
        </button>
      )}
      <BanControl uid={p.uid} bannedUids={bannedUids} admins={admins} />
      <button
        className="iconbtn"
        title="Delete"
        onClick={() =>
          deleteProof(p.id, p.storagePath, {
            daily: !!days?.length,
            tutorialDayIndexes: days ? [...tutorialDayIndexSet(days)] : undefined,
            // #265 (Codex P2 on #278 round 3): the admin moderation delete
            // observes the same freeze/ceremonial gates as the player's own —
            // evaluated inside the transaction via the getter.
            ceremonialDayIndexes: days ? [...ceremonialDayIndexSet(days)] : undefined,
            statsFrozen: () => standingsFrozen({ frozenAt, days: days ?? [] }),
          })
        }
      >
        🗑
      </button>
    </div>
  );
}

/** One reported-Prompt row in the moderation queue — the Prompt-side twin of
 * `ProofQueueRow`, with the same `Clear reports` auto-hide lift (finding 3) and the
 * same `Ban author` control (#108), keyed on the Prompt's `createdBy` owner. */
function ItemQueueRow({
  item: it,
  threshold,
  bannedUids,
  admins,
}: {
  item: ItemDoc;
  threshold: number | undefined;
  bannedUids: string[];
  admins: string[];
}) {
  const autoHidden = isReportHidden(it.reportCount, threshold);
  return (
    <div className="row">
      <div className="grow">
        <div className="name">
          {it.text}
          <span className="pill">{it.reportCount} ⚑</span>
          {autoHidden && <span className="pill pill-hidden">auto-hidden</span>}
        </div>
        <div className="sub">prompt · {it.status}</div>
      </div>
      {autoHidden && (
        <button className="btn" onClick={() => clearItemReports(it.id)}>
          Clear reports
        </button>
      )}
      {it.status === 'hidden' ? (
        <button className="btn" onClick={() => restoreItem(it.id)}>
          Restore
        </button>
      ) : (
        <button className="btn" onClick={() => hideItem(it.id)}>
          Hide
        </button>
      )}
      <BanControl uid={it.createdBy} bannedUids={bannedUids} admins={admins} />
      <button className="iconbtn" title="Delete" onClick={() => deleteItem(it.id)}>
        🗑
      </button>
    </div>
  );
}

/**
 * One row in the Approvals queue (#210, daily-cards-spec § "Item pools and the
 * approval flow"): a pending main-pool Prompt with submitter attribution, a
 * spicy toggle, and Approve/Reject. `spicy` is client-editable here (via a
 * plain `updateDoc` through `data/admin`'s isAdmin-unconstrained write arm) so
 * an admin can correct a submitter's 🔞 tagging BEFORE approving it into the
 * live pool — after approval the spicy ratio sampling (`dealBoard`) already
 * treats it as authoritative, so getting it right pre-approve matters.
 */
function ApprovalQueueRow({
  item: it,
  adminUid,
  onToggleSpicy,
}: {
  item: ItemDoc;
  adminUid: string;
  onToggleSpicy: (id: string, spicy: boolean) => void;
}) {
  return (
    <div className="row">
      <div className="grow">
        <div className="name" style={{ fontWeight: 500 }}>
          {it.text}
        </div>
        <div className="sub">submitted by {it.createdBy}</div>
      </div>
      <label style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={it.spicy}
          onChange={(e) => onToggleSpicy(it.id, e.target.checked)}
        />{' '}
        🔞 Spicy
      </label>
      <button className="btn primary" onClick={() => approveItem(it.id, adminUid)}>
        Approve
      </button>
      <button className="iconbtn" title="Reject" onClick={() => rejectItem(it.id, adminUid)}>
        ✕
      </button>
    </div>
  );
}

/**
 * The Approvals tab (#210): the pending main-pool queue, oldest-first
 * (`usePendingItems`), with a bulk-approve control for taste. A separate
 * subscription from the Moderation tab's `useAllItems` — see `usePendingItems`'s
 * doc comment for why.
 */
function ApprovalsTab({ adminUid }: { adminUid: string }) {
  const { items } = usePendingItems();

  return (
    <div className="admin-section">
      <h3>Approvals{items.length ? ` (${items.length})` : ''}</h3>
      {!items.length && (
        <p className="muted" style={{ fontSize: 12 }}>
          Nothing pending review.
        </p>
      )}
      {!!items.length && (
        <button className="btn" onClick={() => bulkApproveItems(items, adminUid)}>
          Approve all
        </button>
      )}
      <div className="list">
        {items.map((it) => (
          <ApprovalQueueRow key={it.id} item={it} adminUid={adminUid} onToggleSpicy={setItemSpicy} />
        ))}
      </div>
    </div>
  );
}

/**
 * The Admin console's manual "unlock now" fallback (#249, daily-cards-spec §
 * "Unlock mechanics": "a manual admin 'unlock now' button covers function
 * failure"). Renders ONLY inside a `ScheduleRow` whose Day is
 * `dayDueForManualUnlock` — a Day that's still locked, or already
 * snapshot-stamped, has nothing for this button to fix. Calls
 * `unlockDayNow`, the SAME admin-gated callable the 08:00/20:00 scheduler
 * beats invoke internally, so a forced unlock can never diverge from the
 * scheduled path's semantics; the Admin-gate itself is enforced server-side
 * (the callable throws `permission-denied` for a non-admin uid) — this
 * button only ever renders inside the Schedule tab, which the enclosing
 * `Admin` component already gates on `isAdmin` before mounting ANY tab, so
 * there's no separate client-side admin check to duplicate here.
 *
 * `visible` (the parent's live `dayDueForManualUnlock`) controls only the
 * BUTTON itself, not the whole component: once a click lands, the
 * already-subscribed `useEventDoc` listener refreshes `day.snapshotItemIds`
 * and `visible` flips false almost immediately (an emulator/production round
 * trip is fast) — if that unmounted this component entirely, an admin would
 * see the "Unlocked." confirmation for at most a flicker, or not at all, on
 * the SAME success it needed the confirmation for. So this stays mounted
 * (`ScheduleRow` always renders it) and keeps showing its last result
 * message even after `visible` goes false; only a truly untouched (`idle`)
 * row that has scrolled out of "due" renders nothing.
 */
function UnlockNowButton({ dayIndex, visible }: { dayIndex: number; visible: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (!visible && state === 'idle') return null;

  const onClick = async () => {
    setState('busy');
    setMessage(null);
    try {
      const result = await unlockDayNow(dayIndex);
      setState('done');
      setMessage(result === 'stamped' ? 'Unlocked.' : `Already handled (${result}).`);
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Unlock failed—try again.');
    }
  };

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {visible && (
        <button className="btn" onClick={onClick} disabled={state === 'busy'}>
          {state === 'busy' ? 'Unlocking…' : 'Unlock now'}
        </button>
      )}
      {message && <span className="pill">{message}</span>}
    </span>
  );
}

/**
 * One row in the Schedule editor (#221, daily-cards-spec § "Admin console" / §
 * "Itinerary and schedule"): a single Day's date + port (read-only display)
 * and a theme `<select>`. Date/port are shown for context only — this ticket
 * scopes the write surface to `theme`, matching the spec ("the schedule stays
 * admin-editable... changing a locked-future Day's theme is safe, changing an
 * already-unlocked Day is disallowed"); `days[]` length is fixed at seed, so
 * there is no row add/remove here. The lock is CLIENT-SIDE convenience only —
 * `firestore.rules` (`daysThemeLockOk`) is what actually denies a locked
 * Day's write; a direct-SDK caller bypassing this disabled control still gets
 * rejected server-side. An `UnlockNowButton` (#249) additionally renders when
 * the Day is `dayDueForManualUnlock` — unlocked but not yet snapshot-stamped,
 * the state a lagging/failed 08:00 scheduler run leaves behind.
 */
function ScheduleRow({
  day,
  now,
  onChangeTheme,
}: {
  day: DayDef;
  now: number;
  onChangeTheme: (dayIndex: number, theme: ThemeId) => void;
}) {
  const locked = day.unlockAt <= now;
  const dueForManualUnlock = dayDueForManualUnlock(day, now);
  return (
    <div className="row">
      <div className="grow">
        <div className="name">
          Day {day.index + 1} · {day.date} · {day.portEmoji} {day.port}
        </div>
        <div className="sub">{locked ? 'locked — already unlocked or past' : 'editable until unlock'}</div>
      </div>
      <UnlockNowButton dayIndex={day.index} visible={dueForManualUnlock} />
      <select
        aria-label={`Day ${day.index + 1} theme`}
        value={day.theme}
        disabled={locked}
        onChange={(e) => onChangeTheme(day.index, e.target.value as ThemeId)}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.emoji} {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The Schedule tab (#221): the ten seeded Days as rows, in order, each with a
 * theme dropdown disabled once its Day has unlocked. `days` comes straight
 * from the already-subscribed `useEventDoc()` Event doc — no separate
 * listener — and `setDayTheme` is handed the FULL current array so it can
 * write back a targeted single-element replacement (see `data/admin`'s doc
 * comment for why `days` can't be updated by dot-path).
 */
function ScheduleTab({ days }: { days: DayDef[] }) {
  // Advance `now` exactly when the EARLIEST still-locked Day unlocks, mirroring
  // the Board's unlock timer (Codex P2, PR #230): without it an admin who leaves
  // the Schedule tab open across an `unlockAt` rollover would keep a just-unlocked
  // row's dropdown enabled until an unrelated re-render, letting them start a write
  // the server rule now (correctly) rejects. The timer re-renders the row disabled
  // at the moment its Day locks. Depends on `days` so it re-arms as the schedule
  // changes, not on every render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const nextUnlock = days
      .map((d) => d.unlockAt)
      .filter((t) => t > Date.now())
      .sort((a, b) => a - b)[0];
    if (nextUnlock == null) return;
    const timer = setTimeout(() => setNow(Date.now()), nextUnlock - Date.now());
    return () => clearTimeout(timer);
  }, [days, now]);
  return (
    <div className="admin-section">
      <h3>Schedule{days.length ? ` (${days.length})` : ''}</h3>
      {!days.length && (
        <p className="muted" style={{ fontSize: 12 }}>
          No Days seeded yet.
        </p>
      )}
      <div className="list">
        {days.map((d) => (
          <ScheduleRow
            key={d.index}
            day={d}
            now={now}
            onChangeTheme={(dayIndex, theme) => setDayTheme(days, dayIndex, theme)}
          />
        ))}
      </div>
    </div>
  );
}

// A −/+ stepper for `settings.reportHideThreshold` (#222), floored at 1 on
// EVERY step (not just decrement) — `isReportHidden` treats a non-positive
// threshold as "no filtering" (Codex P2, PR #107 finding 2), so a legacy
// Event doc with an already-negative threshold must not be able to click +
// its way to another non-positive value (Codex P2, PR #245 finding).
function ReportThresholdStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        className="iconbtn"
        aria-label="Decrease auto-hide threshold"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        −
      </button>
      <span style={{ minWidth: 20, textAlign: 'center' }}>{value}</span>
      <button className="iconbtn" aria-label="Increase auto-hide threshold" onClick={() => onChange(Math.max(1, value + 1))}>
        +
      </button>
    </div>
  );
}

/**
 * Admin curated add (#269): text + spicy + pool, landing ACTIVE (an admin
 * adding IS the approval). Pool defaults to main; embark/farewell are the
 * curated pools the spec says admins edit through the console.
 */
function AdminAddItemForm({ adminUid }: { adminUid: string | undefined }) {
  const [text, setText] = useState('');
  const [spicy, setSpicy] = useState(false);
  const [pool, setPool] = useState<'main' | 'embark' | 'farewell'>('main');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!adminUid || !text.trim() || busy) return;
    setBusy(true);
    try {
      await adminAddItem(adminUid, text, spicy, pool);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row admin-add-item">
      <input
        className="grow"
        value={text}
        maxLength={80}
        placeholder="Add a prompt (lands active, no review)"
        aria-label="New prompt text"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <label style={{ fontSize: 12 }}>
        <input type="checkbox" checked={spicy} onChange={(e) => setSpicy(e.target.checked)} /> 🔞
      </label>
      <select aria-label="Pool" value={pool} onChange={(e) => setPool(e.target.value as 'main' | 'embark' | 'farewell')}>
        <option value="main">main</option>
        <option value="embark">embark</option>
        <option value="farewell">farewell</option>
      </select>
      <button className="btn" disabled={busy || !text.trim()} onClick={() => void submit()}>
        Add
      </button>
    </div>
  );
}

/**
 * One prompt row (#269): pool pill + inline text edit (✏️ → input + save/
 * cancel) alongside the existing hide/restore/delete moderation.
 */
function AdminItemRow({
  item: it,
  threshold,
  textLocked,
}: {
  item: ItemDoc;
  threshold: number | undefined;
  // #282 (Codex P2): true when this prompt sits in an UNLOCKED Day's stamped
  // snapshot — later deals hydrate text from the item doc at deal time, so an
  // edit would split the same Day's squares by when each player opened their
  // card. Text edits lock; hide/restore/delete stay available.
  textLocked?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(it.text);
  const save = async () => {
    // Save-time re-check (Codex P2): the Day can unlock mid-edit — the row's
    // prop refreshes on the event re-render, so bail rather than committing a
    // now-frozen prompt's text.
    if (textLocked) {
      setEditing(false);
      return;
    }
    if (draft.trim() && draft.trim() !== it.text) await adminUpdateItemText(it.id, draft);
    setEditing(false);
  };
  return (
    <div className="row">
      <div className="grow">
        {editing ? (
          <input
            className="admin-item-edit"
            value={draft}
            maxLength={80}
            aria-label="Edit prompt text"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <div className="name" style={{ fontWeight: 500 }}>
            {it.text}
            {isReportHidden(it.reportCount, threshold) && (
              <span className="pill pill-hidden">auto-hidden</span>
            )}
          </div>
        )}
        <div className="sub">
          {it.status} · {it.pool}
          {it.reportCount ? ` · ${it.reportCount} ⚑` : ''}
        </div>
      </div>
      {editing ? (
        <>
          <button className="btn" onClick={() => void save()}>
            Save
          </button>
          <button className="iconbtn" title="Cancel" onClick={() => setEditing(false)}>
            ✕
          </button>
        </>
      ) : textLocked ? (
        <span className="iconbtn" title="On an unlocked day's dealt snapshot — text is frozen" aria-label="Text frozen">
          🔒
        </span>
      ) : (
        <button
          className="iconbtn"
          title="Edit text"
          onClick={() => {
            setDraft(it.text);
            setEditing(true);
          }}
        >
          ✏️
        </button>
      )}
      {it.status === 'hidden' ? (
        <button className="btn" onClick={() => restoreItem(it.id)}>
          Restore
        </button>
      ) : (
        <button className="btn" onClick={() => hideItem(it.id)}>
          Hide
        </button>
      )}
      <button className="iconbtn" title="Delete" onClick={() => deleteItem(it.id)}>
        🗑
      </button>
    </div>
  );
}

// The "Proof & Claims" panel (#222, daily-cards-spec § "Admin console"): six
// rows over knobs that mostly already exist with no UI — no new backend
// behavior. Claim mode is RELOCATED here (recaptioned, ADR 0001 verbatim).
// Pending claims is NOT rebuilt — its confirm/reject queue stays in its own
// section below; this panel only links to it. AI image screen is captioned
// presentational-only: `functions/src/visionGate.ts` still gates
// `moderateProof` on its own deploy-time env flag, not this EventDoc field.
function ProofClaimsPanel({
  event,
  pendingClaimCount,
}: {
  event: EventDoc | null | undefined;
  pendingClaimCount: number;
}) {
  const modes: ClaimMode[] = ['honor', 'proof_required', 'admin_confirmed'];
  const modeLabel: Record<ClaimMode, string> = { honor: 'Honor', proof_required: 'Proof-to-mark', admin_confirmed: 'Admin-confirmed' };
  const photoSource = event?.settings?.photoProofSource ?? 'camera_or_library';
  const stripExif = event?.settings?.stripPhotoExif ?? true;
  const visionGate = event?.settings?.visionGate ?? true;
  const threshold = event?.settings?.reportHideThreshold ?? 4;

  return (
    <div className="admin-section">
      <h3>Proof & Claims</h3>
      <div className="row">
        <div className="grow">
          <div className="name">Claim mode</div>
          <div className="sub">A friction knob, not a trust level.</div>
        </div>
        <div className="seg">
          {modes.map((m) => (
            <button key={m} className={'seg-btn' + (event?.claimMode === m ? ' on' : '')} onClick={() => setClaimMode(m)}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="grow">
          <div className="name">Photo proof source</div>
          <div className="sub">Camera only is today's live-proof-ceremony override; Camera or library is the recommended default.</div>
        </div>
        <div className="seg">
          <button className={'seg-btn' + (photoSource === 'camera_or_library' ? ' on' : '')} onClick={() => setPhotoProofSource('camera_or_library')}>
            Camera or library
          </button>
          <button className={'seg-btn' + (photoSource === 'camera_only' ? ' on' : '')} onClick={() => setPhotoProofSource('camera_only')}>
            Camera only
          </button>
        </div>
      </div>
      <div className="row">
        <div className="grow">
          <div className="name">Strip location data</div>
          <div className="sub">Worth having regardless of the photo-source choice — library photos are far more likely to carry geotags than live captures.</div>
        </div>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={stripExif} onChange={(e) => setStripPhotoExif(e.target.checked)} /> On
        </label>
      </div>
      <div className="row">
        <div className="grow">
          <div className="name">AI image screen</div>
          <div className="sub">Flags proofs for review via the existing moderation function. Live setting (#268): a deployed scanner consults it per upload — no redeploy needed. The deploy-time env flag remains the master kill-switch for whether the scanner exists at all.</div>
        </div>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={visionGate} onChange={(e) => setVisionGate(e.target.checked)} /> On
        </label>
      </div>
      <div className="row">
        <div className="grow">
          <div className="name">Auto-hide after reports</div>
          <div className="sub">Reports needed before a Prompt or Proof self-hides from players.</div>
        </div>
        <ReportThresholdStepper value={threshold} onChange={setReportHideThreshold} />
      </div>
      {/* Admin-confirmed mode only (#269, the wireframes' caption) — in other
          modes there is no claims queue to jump to. */}
      {event?.claimMode === 'admin_confirmed' && (
        <div className="row">
          <div className="grow">
            <div className="name">Pending claims</div>
            <div className="sub">Admin-confirmed claims awaiting a decision.</div>
          </div>
          <span className="pill">{pendingClaimCount}</span>
          <a className="btn" href="#admin-pending-claims">Jump to queue</a>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const { data: event } = useEventDoc();
  const { claims } = usePendingClaims();
  const { flagged } = useReportedProofs();
  const { items } = useAllItems();
  const [tab, setTab] = useState<'moderation' | 'approvals' | 'schedule'>('moderation');

  const isAdmin = !!(user && event?.admins?.includes(user.uid));
  if (!isAdmin) return <div className="center muted">Admins only.</div>;

  // The community auto-hide threshold (ADR 0004 Phase 0). Content whose
  // reportCount has REACHED it is already gone from every Player's Feed/pool
  // (useProofFeed / useItems), yet stays reachable in the queue below so an Admin
  // can restore or delete it — the whole reason the Admin views skip the filter.
  const threshold = event?.settings?.reportHideThreshold;
  // The Admin ban roster (#108): the event's `bannedUids`, `[]` when absent (the
  // converter default). Drives each queue row's Ban/Unban control and the Banned
  // players section below. Admin views are UNfiltered — a banned Player's content
  // stays reachable here for review/unban (only PUBLIC/player reads filter).
  const bannedUids = event?.bannedUids ?? [];
  // The event admins roster (#113 contract), read from the SAME event doc. A ban
  // that overlaps admins is rejected by the rules, so BanControl suppresses the Ban
  // action for an admin-authored row (Codex P2, PR #122 round 2).
  const admins = event?.admins ?? [];
  // Prompts awaiting approval (#200 schema, #210 write path) — the SAME count
  // the More menu's Admin row badges (`usePendingItemCount`), derived here from
  // the console's own already-subscribed `items` (no extra listener) so the
  // console and the badge can never disagree. 0 until #210 starts writing
  // `status: 'pending'` items — expected, not broken.
  const pendingCount = items.filter((it) => it.status === 'pending').length;
  // #282 (Codex P2): prompt ids frozen into an UNLOCKED Day's stamped
  // snapshot — their text is deal-hydrated, so edits would split that Day's
  // squares by open time. Locked Days only; a future (locked) Day's snapshot
  // doesn't exist yet, and text stays editable until its Day opens.
  const nowMs = Date.now();
  const lockedSnapshotItemIds = new Set(
    (event?.days ?? [])
      .filter((d) => d.unlockAt <= nowMs)
      .flatMap((d) => d.snapshotItemIds ?? []),
  );
  // Prompts needing moderation attention: reported at least once, or already
  // hard-hidden. Derived from useAllItems (already subscribed) so the queue opens
  // NO extra listener, and UNfiltered by the threshold so an auto-hidden Prompt
  // still surfaces here.
  const reportedItems = items.filter((it) => it.reportCount > 0 || it.status === 'hidden');
  const queueCount = flagged.length + reportedItems.length;
  // Merge reported Proofs and Prompts into ONE queue sorted most-reported-first
  // ACROSS both kinds, so a heavily-reported Prompt never buries below a
  // lightly-reported Proof (Codex P3, PR #107 finding 4). Ties break by createdAt
  // ascending (oldest first) for a deterministic order; each row keeps its
  // per-kind controls in the render below.
  const queueRows: QueueRow[] = [
    ...flagged.map(
      (p): QueueRow => ({ kind: 'proof', sortCount: p.reportCount, sortAt: p.createdAt, proof: p }),
    ),
    ...reportedItems.map(
      (it): QueueRow => ({ kind: 'item', sortCount: it.reportCount, sortAt: it.createdAt, item: it }),
    ),
  ].sort((a, b) => b.sortCount - a.sortCount || a.sortAt - b.sortAt);

  return (
    <div>
      {/* Approvals tab (#210): a local sub-navigation inside the Admin console —
          Moderation (the existing report queue + console below) vs Approvals
          (the new pending-item queue). This does NOT touch the app-level bottom
          tab bar (src/components/tabs.ts is the frozen Wave-1+ mount-point
          contract) — Admin already mounts inside the More tab (#208); this is
          purely a within-page toggle. */}
      <div className="seg" style={{ marginBottom: 12 }}>
        <button
          className={'seg-btn' + (tab === 'moderation' ? ' on' : '')}
          onClick={() => setTab('moderation')}
        >
          Moderation
        </button>
        <button
          className={'seg-btn' + (tab === 'approvals' ? ' on' : '')}
          onClick={() => setTab('approvals')}
        >
          Approvals
        </button>
        <button
          className={'seg-btn' + (tab === 'schedule' ? ' on' : '')}
          onClick={() => setTab('schedule')}
        >
          Schedule
        </button>
      </div>
      {tab === 'approvals' && user && <ApprovalsTab adminUid={user.uid} />}
      {tab === 'schedule' && <ScheduleTab days={event?.days ?? []} />}
      {tab !== 'moderation' ? null : <>
      {/* Report queue — the moderation triage surface, surfaced FIRST and
          most-reported-first. ADR 0004 Phase 0: any row tagged "auto-hidden" has
          crossed reportHideThreshold and already self-hid on every Player's
          Feed/pool with no Admin action; it stays reachable here so an Admin can
          hide (hard), restore, or delete it. The community hide is presentational
          and bypassable by design — server-authoritative removal is #43. */}
      <div className="admin-section queue">
        <h3>Report queue{queueCount ? ` (${queueCount})` : ''}</h3>
        {!queueCount && <p className="muted" style={{ fontSize: 12 }}>Nothing reported. All clear.</p>}
        <div className="list">
          {queueRows.map((entry) =>
            entry.kind === 'proof' ? (
              <ProofQueueRow
                key={`proof-${entry.proof.id}`}
                proof={entry.proof}
                threshold={threshold}
                bannedUids={bannedUids}
                admins={admins}
                days={event?.days}
                frozenAt={event?.frozenAt}
              />
            ) : (
              <ItemQueueRow
                key={`item-${entry.item.id}`}
                item={entry.item}
                threshold={threshold}
                bannedUids={bannedUids}
                admins={admins}
              />
            ),
          )}
        </div>
      </div>

      {/* Banned players (#108): the current `bannedUids` roster, so an Admin can see
          who is muted and unban them — including a Player who has no queued content
          (their prompts/proofs may all be deleted, yet they can still be unbanned
          here). A ban is a presentational moderation/dispute tool (ADR 0004 Phase 0),
          NOT anti-cheat (ADR 0001) or hard access revocation (#43/#44). */}
      <div className="admin-section">
        <h3>Banned players{bannedUids.length ? ` (${bannedUids.length})` : ''}</h3>
        {!bannedUids.length ? (
          <p className="muted" style={{ fontSize: 12 }}>No one is banned.</p>
        ) : (
          <div className="list">
            {bannedUids.map((uid) => (
              <div key={uid} className="row">
                <div className="grow">
                  <div className="name">{uid}</div>
                  <div className="sub">content hidden from players (moderation, not anti-cheat)</div>
                </div>
                <button className="btn" onClick={() => unbanUser(uid)}>
                  Unban
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ProofClaimsPanel event={event} pendingClaimCount={claims.length} />

      <div className="admin-section">
        <h3>Default theme</h3>
        <div className="themes">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={'chip' + (event?.defaultTheme === t.id ? ' active' : '')}
              onClick={() => setEventTheme(t.id)}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-section" id="admin-pending-claims">
        <h3>Pending claims{claims.length ? ` (${claims.length})` : ''}</h3>
        {!claims.length && <p className="muted" style={{ fontSize: 12 }}>Nothing to confirm.</p>}
        <div className="list">
          {claims.map((c) => (
            <div key={c.id} className="row">
              <div className="grow">
                <div className="name">{c.displayName}</div>
                <div className="sub">{c.itemText}</div>
              </div>
              <button className="btn" onClick={() => user && confirmClaim(c, user.uid)}>
                Confirm
              </button>
              <button className="iconbtn" title="Reject" onClick={() => user && rejectClaim(c, user.uid)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h3>
          Prompts ({items.length})
          {pendingCount > 0 && <span className="pill">{pendingCount} pending</span>}
        </h3>
        {/* Curated add (#269, spec § "Item pools and the approval flow"):
            admins add straight-to-active prompts into ANY pool — this is how
            the embark/farewell curated pools are edited without a reseed. The
            player-facing form (More → Suggest a square) still writes pending
            main-pool submissions only. */}
        <AdminAddItemForm adminUid={user?.uid} />
        <div className="list">
          {items.map((it) => (
            <AdminItemRow
              key={it.id}
              item={it}
              threshold={threshold}
              textLocked={lockedSnapshotItemIds.has(it.id)}
            />
          ))}
        </div>
      </div>
      </>}
    </div>
  );
}
