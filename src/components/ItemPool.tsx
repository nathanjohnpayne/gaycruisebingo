import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useItems } from '../hooks/useData';
import { addItem, checkItemRateLimit, reportItem, ITEM_RATE_LIMIT_MS } from '../data/api';
import { track } from '../analytics';

// Pre-sail framing (ADR 0003): a Board freezes the moment a Player joins, so
// a Prompt added afterward can never land on THAT Player's own card — it only
// ever joins the pool for a FUTURE deal. Mid-cruise adds are allowed (and
// still take effect for late joiners / future Events); they are just mostly
// inert on cards already dealt, which is expected, not a bug.
const PRESAIL_NOTE =
  "Get your prompts in before we sail — once your card is dealt it's frozen, so a prompt added after that joins the pool for a future card, not yours.";

// Phase 0 client-side throttle copy — see `checkItemRateLimit` in
// `../data/api` for why this is presentational only, not a security boundary.
const ADD_THROTTLE_MESSAGE = 'Slow down — you can add another prompt in a few seconds.';
const REPORT_THROTTLE_MESSAGE = 'Slow down — you can report again in a few seconds.';

export default function ItemPool() {
  const { user } = useAuth();
  const { items, loading } = useItems();
  const [text, setText] = useState('');
  const [addThrottled, setAddThrottled] = useState(false);
  const [reportThrottled, setReportThrottled] = useState(false);
  const addTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Un-throttle timers are real (not just presentational math) so the button
  // re-enables on its own once the window passes — clear them on unmount so a
  // throttled ItemPool that unmounts mid-window never calls setState after
  // unmount (tab switch away from Prompts while throttled).
  useEffect(
    () => () => {
      if (addTimer.current) clearTimeout(addTimer.current);
      if (reportTimer.current) clearTimeout(reportTimer.current);
    },
    [],
  );

  const add = async () => {
    if (!user || !text.trim()) return;
    if (!checkItemRateLimit(`add:${user.uid}`)) {
      setAddThrottled(true);
      if (addTimer.current) clearTimeout(addTimer.current);
      addTimer.current = setTimeout(() => setAddThrottled(false), ITEM_RATE_LIMIT_MS);
      return;
    }
    try {
      await addItem(user.uid, text);
      track('add_item');
      setText('');
    } catch (e) {
      console.error(e);
    }
  };

  const report = (id: string) => {
    if (!user) return;
    if (!checkItemRateLimit(`report:${user.uid}`)) {
      setReportThrottled(true);
      if (reportTimer.current) clearTimeout(reportTimer.current);
      reportTimer.current = setTimeout(() => setReportThrottled(false), ITEM_RATE_LIMIT_MS);
      return;
    }
    reportItem(id).catch(console.error);
    track('report_item');
  };

  return (
    <div>
      <div className="addbar">
        <input
          className="input"
          maxLength={80}
          placeholder="Add a prompt…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button className="btn primary" onClick={add} disabled={!text.trim() || addThrottled}>
          Add
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {PRESAIL_NOTE} {items.length} in the pool.
      </p>
      {addThrottled && (
        <p className="muted" role="alert" style={{ fontSize: 12 }}>
          {ADD_THROTTLE_MESSAGE}
        </p>
      )}
      {loading ? (
        <div className="center muted">Loading…</div>
      ) : (
        <div className="list">
          {items.map((it) => (
            <div key={it.id} className="row">
              <div className="grow">
                <div className="name" style={{ fontWeight: 500 }}>
                  {it.text}
                </div>
              </div>
              <button
                className="iconbtn"
                title="Report"
                disabled={reportThrottled}
                onClick={() => report(it.id)}
              >
                ⚑
              </button>
            </div>
          ))}
        </div>
      )}
      {reportThrottled && (
        <p className="muted" role="alert" style={{ fontSize: 12 }}>
          {REPORT_THROTTLE_MESSAGE}
        </p>
      )}
    </div>
  );
}
