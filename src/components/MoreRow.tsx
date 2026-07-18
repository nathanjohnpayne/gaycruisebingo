import { ChevronRight, type LucideIcon } from 'lucide-react';

/**
 * One tappable menu row: a leading Lucide icon (daily-cards-spec § "Iconography
 * — Lucide" › More menu), title, optional subtitle, optional count badge, and a
 * trailing `chevron-right` — every row opens a sub-surface, so the chevron is
 * unconditional (quiet rows like Sign out are plain `<button>`s outside this
 * helper). Shared by the More menu and the admin hub's section cards
 * (specs/admin-console-ia.md) — its own module so the hub does not import the
 * whole More screen (an Admin → AdminHub → More cycle would drag More's
 * unrelated hook imports into every Admin test's module graph; Phase 4b P1,
 * PR #410).
 */
export function MoreRow({
  icon: Icon,
  title,
  sub,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="more-row" onClick={onClick}>
      <Icon className="more-row-icon" aria-hidden="true" />
      <span className="more-row-text">
        <span className="more-row-title">{title}</span>
        {sub && <span className="more-row-sub">{sub}</span>}
      </span>
      {typeof badge === 'number' && <span className="pill more-badge">{badge}</span>}
      <ChevronRight className="more-row-chevron" aria-hidden="true" />
    </button>
  );
}
