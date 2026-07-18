import { unbanUser } from '../../data/admin';

/**
 * The Players surface (specs/admin-console-ia.md § "Players"): the current
 * `bannedUids` roster (#108), so an Admin can see who is muted and unban them —
 * including a Player who has no queued content (their prompts/proofs may all be
 * deleted, yet they can still be unbanned here). A ban is a presentational
 * moderation/dispute tool (ADR 0004 Phase 0), NOT anti-cheat (ADR 0001) or hard
 * access revocation (#43/#44). Banning happens from the Review queue's rows
 * (`Ban author`); this roster is the unban side. Content unchanged from the old
 * Moderation-tab Banned-players section.
 */
export default function PlayersPanel({ bannedUids }: { bannedUids: string[] }) {
  return (
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
  );
}
