export default function Avatar({
  name,
  src,
  size,
}: {
  name: string;
  src: string | null;
  size?: number;
}) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const style = size ? { width: size, height: size } : undefined;
  if (src) {
    return (
      <img
        className="avatar"
        style={style}
        src={src}
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
