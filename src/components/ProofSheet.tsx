import { useRef, useState } from 'react';
import { attachProof, type AttachProofResult } from '../data/proofs';
import { track } from '../analytics';
import { safeMediaUrl } from './safeMediaUrl';
import type { Cell, ClaimMode, ProofType } from '../types';

interface Props {
  uid: string;
  displayName: string;
  photoURL: string | null;
  cells: Cell[];
  cell: Cell;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
  // Reports a successful attach's win verdict back to Board (PR #110 round 2
  // finding 1), so a proofed Mark completing a BINGO/Blackout broadcasts its Feed
  // Moment exactly like an honor Mark — the sheet itself never touches the
  // moments queue. Optional: standalone renders (tests) omit it.
  onAttached?: (res: AttachProofResult) => void;
  // The 🎖️ Cross My Heart pledge (issue #181): present only on CLAIM opens (an
  // unmarked Square's tap), where Board wires it to the bare honor Mark. Absent
  // on proof-add opens (the ＋ on an already-marked Square) — the Square is
  // already claimed, so the row does not render at all. Enabled only in honor
  // mode; stricter modes show it disabled so Players learn the option exists.
  onPledge?: () => void;
  // The event-level photo-source override (#190): `camera_only` hides the 🖼️
  // Library affordance, leaving only 📷 Take photo. Default `camera_or_library` —
  // both affordances in EVERY Claim Mode. A presentational restriction (ADR
  // 0001), never a security boundary, and NEVER gated on claimMode.
  photoProofSource?: 'camera_or_library' | 'camera_only';
  // The viewed Day, threaded onto the Proof so the Feed reads "Day 2 · Get Sporty".
  dayIndex?: number;
  // Strip EXIF/GPS from a photo before upload (event `stripPhotoExif`, default
  // true); passed straight through to attachProof → uploadProofMedia.
  stripExif?: boolean;
  // The Prompt's already-subscribed Tally count (ADR 0002 — no new read) for the
  // "🔥 Marked by N others so far" heat line.
  tallyCount?: number;
  onClose: () => void;
}

export default function ProofSheet(props: Props) {
  const { uid, displayName, photoURL, cells, cell, claimMode, currentFirstBingoAt, onAttached, onPledge, photoProofSource, dayIndex, stripExif, tallyCount, onClose } = props;
  // No proof type is pre-selected (issue #181): the sheet opens on EVERY claim
  // now, so it opens compact — the capture body below renders only once a type
  // is chosen, keeping the pledge/segments in immediate thumb reach.
  const [type, setType] = useState<ProofType | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Which affordance produced the current photo — stamped onto the Proof as
  // `source` (#190) so the Feed badges a 🖼️ library pick. Set by onPhoto from the
  // input that fired, NOT inferred from the file: a determined client could lie,
  // and that is accepted (ADR 0001 — flavour, never enforcement).
  const [photoSource, setPhotoSource] = useState<'camera' | 'library' | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onPhoto = (source: 'camera' | 'library') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    setPhotoUrl(URL.createObjectURL(f));
    setPhotoSource(source);
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudio(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert('Mic unavailable—try a photo or a callout instead.');
    }
  };
  const stopRec = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const valid =
    type === null
      ? false
      : type === 'photo'
        ? !!photo
        : type === 'audio'
          ? !!audio
          : text.trim().length > 0;

  const submit = async () => {
    if (!valid || type === null) return;
    setBusy(true);
    try {
      const proof =
        type === 'photo'
          ? { type, blob: photo ?? undefined }
          : type === 'audio'
            ? { type, blob: audio ?? undefined }
            : { type, text: text.trim() };
      const res = await attachProof({
        uid,
        displayName,
        photoURL,
        cells,
        cellIndex: cell.index,
        itemId: cell.itemId, // the Prompt this Mark tallies (ADR 0002); null for the free centre
        itemText: cell.text,
        claimMode,
        currentFirstBingoAt,
        // Stamp the affordance only on a photo Proof (#190); audio/text carry none.
        source: type === 'photo' ? (photoSource ?? undefined) : undefined,
        dayIndex,
        stripExif,
        proof,
      });
      track('attach_proof', { type, ...(type === 'photo' && photoSource ? { source: photoSource } : {}) });
      // Report the win verdict AFTER the transaction committed and BEFORE closing,
      // so Board enqueues the Moment for a proofed win (PR #110 round 2 finding 1).
      // Truthiness-guarded: suites stub attachProof to resolve undefined.
      if (res) onAttached?.(res);
      onClose();
    } catch {
      setBusy(false);
      alert('Upload failed—try again.');
    }
  };

  const tabs: ProofType[] = ['photo', 'audio', 'text'];
  const label: Record<ProofType, string> = { photo: '📷 Photo', audio: '🎙 Sound', text: '✍️ Callout' };
  // Scheme-guard the object-URL previews before they reach an <img>/<audio> src
  // (CodeQL js/xss-through-dom #1). createObjectURL only ever yields blob:, so this
  // is a belt-and-braces guard on the flagged sink; the Feed reuses the same guard.
  const safePhotoSrc = safeMediaUrl(photoUrl);
  const safeAudioSrc = safeMediaUrl(audioUrl);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Proof for “{cell.text}”</div>
        {typeof tallyCount === 'number' && tallyCount > 0 && (
          // The social heat line (ADR 0002): reuses the Prompt's already-subscribed
          // Tally count — no new read, no new doc — so a Player sees the pack has
          // this Square before they claim it. "so far" keeps it a running count.
          <div className="heat-line">🔥 Marked by {tallyCount} {tallyCount === 1 ? 'other' : 'others'} so far</div>
        )}
        {onPledge && (
          // The one-tap honor pledge (issue #181): its own full-width row —
          // never a fourth segment — so the label always fits on one line at
          // 320px. Pressing it IS the claim: Board marks the Square (the same
          // bare setMark an honor tap used to make) and closes the sheet. In
          // stricter modes it renders disabled: those modes require a real
          // proof, and the greyed row teaches that honor mode has a fast path.
          <button
            className="btn pledge-btn"
            // `busy` too (Codex P2, PR #184): in honor mode a player can pick a
            // REAL proof and submit — while that attachProof transaction is in
            // flight, a pledge tap would fire the bare setMark path in parallel
            // and race the transaction's full-cell write. One in-flight claim
            // per sheet: the pledge locks while a submit is saving.
            disabled={claimMode !== 'honor' || busy}
            title={claimMode !== 'honor' ? 'Available when the event runs honor mode' : undefined}
            onClick={onPledge}
          >
            🎖️ Cross My Heart
          </button>
        )}
        <div className="seg">
          {tabs.map((t) => (
            <button key={t} className={'seg-btn' + (type === t ? ' on' : '')} onClick={() => setType(t)}>
              {label[t]}
            </button>
          ))}
        </div>

        {type === 'photo' && (
          <div className="proof-body">
            {/* Two affordances (#190): 📷 Take photo force-launches the rear
                camera (`capture="environment"`); 🖼️ Library is the no-`capture`
                picker (the ProfileEditor pattern) — the gap #190 reported. Both
                render in EVERY Claim Mode; only `camera_only` hides Library. */}
            <div className="photo-affordances">
              <label className="btn photo-affordance">
                📷 Take photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={onPhoto('camera')} />
              </label>
              {photoProofSource !== 'camera_only' && (
                <label className="btn photo-affordance">
                  🖼️ Library
                  <input type="file" accept="image/*" hidden onChange={onPhoto('library')} />
                </label>
              )}
            </div>
            {safePhotoSrc && <img className="preview" src={safePhotoSrc} alt="preview" />}
          </div>
        )}
        {type === 'audio' && (
          <div className="proof-body">
            {!recording ? (
              <button className="btn" onClick={startRec}>
                {audio ? '● Re-record' : '● Record'}
              </button>
            ) : (
              <button className="btn primary" onClick={stopRec}>
                ■ Stop
              </button>
            )}
            {safeAudioSrc && <audio className="preview" controls src={safeAudioSrc} />}
          </div>
        )}
        {type === 'text' && (
          <div className="proof-body">
            <textarea
              className="input"
              rows={3}
              maxLength={140}
              placeholder="Name names. Who, what, how bad?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}

        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Saving…' : claimMode === 'admin_confirmed' ? 'Submit claim' : 'Mark it'}
          </button>
        </div>
        {claimMode === 'admin_confirmed' && (
          <p className="muted" style={{ fontSize: 11, textAlign: 'center', margin: '8px 0 0' }}>
            Goes pending until an admin confirms.
          </p>
        )}
      </div>
    </div>
  );
}
