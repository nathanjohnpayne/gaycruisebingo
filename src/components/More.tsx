import { useAuth } from '../auth/AuthContext';
import ProfileEditor from './ProfileEditor';

/**
 * The More tab — INTERIM placeholder (#203, specs/d15-tab-contract.md).
 *
 * Phase 1.5 relocates the avatar (profile-edit affordance) and the sign-out
 * button off the top identity bar into the More menu. The full menu (profile
 * card, Theme, Text size, Play/Support sections, Admin link, version footer)
 * is #208, which replaces this file's content wholesale. This ticket keeps it
 * deliberately minimal: it carries exactly the two affordances that left
 * `Nav.tsx`, so neither regresses while the full menu is still Wave 1.
 */
export default function More() {
  const { signOutUser } = useAuth();

  return (
    <div className="more">
      <ProfileEditor />
      <button
        className="iconbtn sign-out-trigger"
        type="button"
        title="Sign out"
        onClick={() => signOutUser()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" x2="9" y1="12" y2="12" />
        </svg>
      </button>
    </div>
  );
}
