export default function Avatar({
  name,
  src,
  customPhoto,
  size,
}: {
  name: string;
  src: string | null;
  /** A custom-uploaded avatar URL — takes priority over `src` when set (see specs/w1-profile-avatar.md). */
  customPhoto?: string | null;
  size?: number;
}) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const style = size ? { width: size, height: size } : undefined;
  const resolvedSrc = customPhoto || src;
  if (resolvedSrc) {
    return (
      <img
        className="avatar"
        style={style}
        src={resolvedSrc}
        alt={name}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="avatar" style={style}>
      {initial}
    </div>
  );
}
