import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useItems } from '../hooks/useData';
import { addItem, reportItem } from '../data/api';
import { track } from '../analytics';

export default function ItemPool() {
  const { user } = useAuth();
  const { items, loading } = useItems();
  const [text, setText] = useState('');

  const add = async () => {
    if (!user || !text.trim()) return;
    await addItem(user.uid, text);
    track('add_item');
    setText('');
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
        <button className="btn primary" onClick={add} disabled={!text.trim()}>
          Add
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        New prompts join the pool for future cards. {items.length} in play.
      </p>
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
                onClick={() => {
                  reportItem(it.id);
                  track('report_item');
                }}
              >
                ⚑
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
