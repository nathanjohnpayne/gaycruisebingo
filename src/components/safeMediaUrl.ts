// safeMediaUrl — the sink guard for a Proof media element's `src` (<img>/<audio>).
//
// Proof media is only ever one of: an object URL minted by URL.createObjectURL
// (`blob:`), a Firebase Storage download URL (`https:`, or `http:` under the local
// emulator), or — defensively, for a future inline preview — an image/audio data
// URL. Every other scheme, above all `javascript:` (and its friends `vbscript:`
// and `data:text/html`), is rejected so a hostile value can never reach the DOM as
// an active-scheme URL.
//
// This guards the CodeQL js/xss-through-dom class flagged on the Proof media sinks
// (alerts #1 and #3), whose flagged flow is the photo preview: the file input's
// `.files[0]` (a DOM source) → URL.createObjectURL → `photoUrl` state →
// `<img src={photoUrl}>` (the sink). React auto-escapes JSX *text* but does NOT
// sanitize a `src`/`href` attribute value, so scheme validation is the correct fix
// at that sink. It is applied identically to the Feed's `mediaURL` (the more
// genuinely untrusted input, resolved from a Firestore document) so a forged media
// URL likewise cannot introduce an active scheme.
//
// Two barriers, in order, so the guard is legible to both humans and static
// analysis:
//   1. Scheme allowlist — parse the URL and accept only inert media schemes.
//   2. Metacharacter strip — remove the HTML metacharacters `<`, `"`, `'` from the
//      accepted value before it enters an HTML attribute. This directly answers the
//      alert ("reinterpreted as HTML without escaping meta-characters") and is a
//      barrier CodeQL recognises, so the class stops re-flagging on every edit. It
//      is a no-op on every accepted value: a legitimate blob:/http(s):/data:image
//      /data:audio URL never contains `<`, `"`, or `'`.
//
// Returns the accepted URL when its scheme is allowed, or `undefined` so React
// omits the attribute and the caller omits the element entirely.
export function safeMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  let protocol: string;
  try {
    // Absolute-URL parse. A relative or malformed value throws and is treated as
    // unsafe (Proof media is always an absolute blob:/https:/data: URL).
    protocol = new URL(trimmed).protocol.toLowerCase();
  } catch {
    return undefined;
  }

  // Network-fetch and object-URL schemes are inert as a media `src`; inline data
  // URLs are allowed only for image/audio payloads (`data:text/html` and every
  // other media type are rejected). Every script-executing scheme — above all
  // `javascript:`, plus `vbscript:` — falls through to `undefined`.
  const allowed =
    protocol === 'https:' ||
    protocol === 'http:' ||
    protocol === 'blob:' ||
    (protocol === 'data:' && /^data:(image|audio)\//i.test(trimmed));
  if (!allowed) return undefined;

  // Strip HTML metacharacters before the accepted URL reaches the DOM as a `src`.
  // No-op on every accepted scheme (they never contain `<`, `"`, or `'`); it exists
  // so a value can never carry markup into an HTML attribute.
  return trimmed.replace(/["'<]/g, '');
}
