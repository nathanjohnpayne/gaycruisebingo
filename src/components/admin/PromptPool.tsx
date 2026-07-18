import { useState } from 'react';
import { isReportHidden } from '../../hooks/useData';
import { adminAddItem, adminUpdateItemText, hideItem, restoreItem, deleteItem } from '../../data/admin';
import AsyncButton from './AsyncButton';
import type { ItemDoc } from '../../types';

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
  // #411 (specs/admin-async-feedback.md): a rejected add surfaces inline
  // instead of vanishing — the draft text is kept so a retry is one tap.
  const [failed, setFailed] = useState(false);
  const spicyAllowed = pool === 'main';
  const effectiveSpicy = spicyAllowed && spicy;
  const submit = async () => {
    if (!adminUid || !text.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await adminAddItem(adminUid, text, effectiveSpicy, pool);
      setText('');
    } catch {
      setFailed(true);
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
        <input
          type="checkbox"
          checked={effectiveSpicy}
          disabled={!spicyAllowed}
          onChange={(e) => setSpicy(e.target.checked)}
        />{' '}
        🔞
      </label>
      <select
        aria-label="Pool"
        value={pool}
        onChange={(e) => {
          const next = e.target.value as 'main' | 'embark' | 'farewell';
          setPool(next);
          if (next !== 'main') setSpicy(false);
        }}
      >
        <option value="main">main</option>
        <option value="embark">embark</option>
        <option value="farewell">farewell</option>
      </select>
      <button className="btn" disabled={busy || !text.trim()} onClick={() => void submit()}>
        Add
      </button>
      {failed && (
        <span className="pill pill-error" role="alert">
          Didn’t add — try again.
        </span>
      )}
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
  // #411: a rejected text save keeps the editor OPEN with the draft intact and
  // an inline alert, instead of silently closing as if it had committed. One
  // state serves both commit paths (the Save button and Enter in the input).
  const [saveFailed, setSaveFailed] = useState(false);
  const save = async () => {
    // Save-time re-check (Codex P2): the Day can unlock mid-edit — the row's
    // prop refreshes on the event re-render, so bail rather than committing a
    // now-frozen prompt's text.
    if (textLocked) {
      setEditing(false);
      return;
    }
    setSaveFailed(false);
    try {
      if (draft.trim() && draft.trim() !== it.text) await adminUpdateItemText(it.id, draft);
      setEditing(false);
    } catch {
      setSaveFailed(true);
    }
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
          {saveFailed && (
            <span className="pill pill-error" role="alert">
              Didn’t save — try again.
            </span>
          )}
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
        <AsyncButton onAction={() => restoreItem(it.id)}>
          Restore
        </AsyncButton>
      ) : (
        <AsyncButton onAction={() => hideItem(it.id)}>
          Hide
        </AsyncButton>
      )}
      <AsyncButton className="iconbtn" title="Delete" onAction={() => deleteItem(it.id)}>
        🗑
      </AsyncButton>
    </div>
  );
}

/**
 * The Prompt pool surface (specs/admin-console-ia.md § "Prompt pool"): the full
 * prompt list with inline edit/hide/restore/delete moderation plus the curated
 * add form — the old Moderation-tab Prompts section, unchanged in content.
 * Curated add (#269, spec § "Item pools and the approval flow"): admins add
 * straight-to-active prompts into ANY pool — this is how the embark/farewell
 * curated pools are edited without a reseed. The player-facing form (More →
 * Suggest a square) still writes pending main-pool submissions only.
 */
export default function PromptPool({
  items,
  threshold,
  pendingCount,
  lockedSnapshotItemIds,
  adminUid,
}: {
  items: ItemDoc[];
  threshold: number | undefined;
  pendingCount: number;
  lockedSnapshotItemIds: Set<string>;
  adminUid: string | undefined;
}) {
  return (
    <div className="admin-section">
      <h3>
        Prompts ({items.length})
        {pendingCount > 0 && <span className="pill">{pendingCount} pending</span>}
      </h3>
      <AdminAddItemForm adminUid={adminUid} />
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
  );
}
