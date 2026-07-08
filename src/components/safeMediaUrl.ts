// safeMediaUrl — the sink guard for a Proof media element's `src` (<img>/<audio>).
//
// Proof media is only ever one of: an object URL minted by URL.createObjectURL
// (`blob:`), a Firebase Storage download URL (`https:`, or `http:` under the local
// emulator), or — defensively, for a future inline preview — an image/audio data
// URL. Every other scheme, above all `javascript:` (and its friends `vbscript:`
// and `data:text/html`), is rejected so a hostile value can never reach the DOM as
// an active-scheme URL.
//
// This closes CodeQL js/xss-through-dom alert #1, whose flagged flow is the photo
// preview: the file input's `.files[0]` (a DOM source) → URL.createObjectURL →
// `photoUrl` state → `<img src={photoUrl}>` (the sink). React auto-escapes JSX
// *text*, but it does NOT sanitize a `src`/`href` attribute value, so scheme
// validation is the correct fix at that sink. It is applied identically to the
// Feed's `mediaURL` (the more genuinely untrusted input, resolved from a Firestore
// document) so a forged media URL likewise cannot introduce an active scheme.
//
// Returns the original URL when its scheme is allowed, or `undefined` so React
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

  // Network-fetch and object-URL schemes are inert as a media `src` — the only
  // XSS risk is a script-executing scheme, which the allowlist below excludes.
  if (protocol === 'https:' || protocol === 'http:' || protocol === 'blob:') {
    return trimmed;
  }
  // Inline data URLs are allowed only for image/audio payloads; `data:text/html`
  // (and any other media type) is rejected.
  if (protocol === 'data:' && /^data:(image|audio)\//i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}
