import { useRef, useState } from 'react';
import { attachProof } from '../data/proofs';
import { track } from '../analytics';
import type { Cell, ClaimMode, ProofType } from '../types';

interface Props {
  uid: string;
  displayName: string;
  photoURL: string | null;
  cells: Cell[];
  cell: Cell;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
  onClose: () => void;
}

export default function ProofSheet(props: Props) {
  const { uid, displayName, photoURL, cells, cell, claimMode, currentFirstBingoAt, onClose } = props;
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
      alert('Mic unavailable — try a photo or a callout instead.');
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
      await attachProof({
        uid,
        displayName,
        photoURL,
        cells,
        cellIndex: cell.index,
        itemText: cell.text,
        claimMode,
        currentFirstBingoAt,
        proof,
      });
      track('attach_proof', { type });
      onClose();
    } catch {
      setBusy(false);
      alert('Upload failed — try again.');
    }
  };

  const tabs: ProofType[] = ['photo', 'audio', 'text'];
  const label: Record<ProofType, string> = { photo: '📷 Photo', audio: '🎙 Sound', text: '✍️ Callout' };

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
            {photoUrl && <img className="preview" src={photoUrl} alt="preview" />}
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
            {audioUrl && <audio className="preview" controls src={audioUrl} />}
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
