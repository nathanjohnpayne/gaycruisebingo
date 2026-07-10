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
  onClose: () => void;
}

export default function ProofSheet(props: Props) {
  const { uid, displayName, photoURL, cells, cell, claimMode, currentFirstBingoAt, onAttached, onClose } = props;
  const [type, setType] = useState<ProofType>('photo');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    setPhotoUrl(URL.createObjectURL(f));
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

  const valid = type === 'photo' ? !!photo : type === 'audio' ? !!audio : text.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
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
        proof,
      });
      track('attach_proof', { type });
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
        <div className="seg">
          {tabs.map((t) => (
            <button key={t} className={'seg-btn' + (type === t ? ' on' : '')} onClick={() => setType(t)}>
              {label[t]}
            </button>
          ))}
        </div>

        {type === 'photo' && (
          <div className="proof-body">
            <input type="file" accept="image/*" capture="environment" onChange={onPhoto} />
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
