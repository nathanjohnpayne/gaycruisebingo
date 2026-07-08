import { track } from '../analytics';

export default function Celebration({
  kind,
  onClose,
}: {
  kind: 'bingo' | 'blackout';
  onClose: () => void;
}) {
  const share = async () => {
    const data = {
      title: 'Gay Cruise Bingo',
      text: kind === 'blackout' ? 'BLACKOUT. I win the boat. 🚢' : 'I got BINGO on the high seas 🚢',
      url: window.location.origin,
    };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(data.url);
    } catch {
      /* user cancelled */
    }
    track('share_click', { surface: 'celebration' });
  };

  return (
    <div className="celebrate" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="big">{kind === 'blackout' ? 'BLACKOUT' : 'BINGO!'}</div>
        <p className="muted" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          You've seen some things.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
          <button className="btn primary" onClick={share}>
            Share
          </button>
          <button className="btn" onClick={onClose}>
            Keep playing
          </button>
        </div>
      </div>
    </div>
  );
}
