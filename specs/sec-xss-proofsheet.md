---
spec_id: sec-xss-proofsheet
status: accepted
---

# Proof-surface XSS hardening (`sec-xss-proofsheet`)

Closes the DOM-XSS class flagged by CodeQL `js/xss-through-dom` (alert #1, severity high) on the Proof surfaces. The alert names `src/components/ProofSheet.tsx` line 112, and its dataflow runs from the file input's `.files` (line 31) through `URL.createObjectURL` into the photo-preview `<img src={photoUrl}>`. React auto-escapes JSX *text* but does NOT sanitize a `src`/`href` attribute, so the correct fix is at the sink: a URL-scheme allowlist (`src/components/safeMediaUrl.ts`) applied to every media `src` in `ProofSheet` and `ProofFeed`. Photo, audio, and text Proof capture keep working unchanged. Exercised by `src/components/sec-xss-proofsheet.test.tsx`, validated by `scripts/ci/check_spec_test_alignment`.

## The flagged flow, and why the specific instance is inert

The flagged sink (`<img src={photoUrl}>`) is fed only by `URL.createObjectURL(file)`, which by specification returns a `blob:` URL — it can never be coerced to `javascript:`. So the exact alert instance is not exploitable, and neither is any current text path: the text callout renders through auto-escaped JSX (`<blockquote>“{p.text}”</blockquote>` in the Feed; a controlled `<textarea>` in the sheet), so an HTML payload is shown as literal text, never parsed. The specific alert is therefore a false positive for a live exploit. The fix still hardens the whole *class* of sink defensively — most usefully the Feed's `mediaURL`, which is resolved from a Firestore document and is the genuinely untrusted input — so a forged non-media scheme cannot reach the DOM as an active-scheme URL. If a post-merge CodeQL re-scan does not recognize `safeMediaUrl` as a sanitizer on the flagged path, alert #1 warrants a CodeQL-UI dismissal (won't-fix / false-positive) with this rationale; that dismissal is left to a maintainer and is not attempted here.

## `safeMediaUrl` is the scheme allowlist at the media sink

`safeMediaUrl(url)` parses the URL and returns it only when its scheme is inert as a media `src` — `blob:` (object URLs), `https:`/`http:` (Storage download URLs, the latter under the local emulator), or an `image/`/`audio/` `data:` URL. Every other scheme — above all `javascript:`, plus `vbscript:` and `data:text/html` — and every malformed or empty value yields `undefined`, so React omits the attribute and the caller omits the element.

- **Given** a Proof media URL **When** it is a `blob:`, `http(s):`, or `data:image/`/`data:audio/` URL **Then** `safeMediaUrl` returns it unchanged. (Test: "allows blob:, http(s):, and image/audio data URLs through unchanged".)
- **Given** a hostile or malformed value **When** it is `javascript:`, `vbscript:`, `data:text/html`, or unparseable **Then** `safeMediaUrl` returns `undefined`. (Test: "rejects javascript:, vbscript:, data:text/html, and malformed URLs".)
- **Given** an absent value **When** it is `null`, empty, or whitespace-only **Then** `safeMediaUrl` returns `undefined`. (Test: "rejects null, empty, and whitespace-only values".)

## ProofSheet renders text callouts inert and passes only safe preview URLs

The capture sheet keeps all three capture types working: a text callout stays literal text in its `<textarea>`, and a captured photo's `blob:` object URL still drives the preview `<img>`.

- **Given** the capture sheet on the Callout tab **When** the Player types an HTML payload such as `<img src=x onerror=alert(1)>` **Then** it appears as literal text and no `<img>` (or other element) is injected into the DOM. (Test: "ProofSheet: a text callout of an HTML payload renders as literal, inert text".)
- **Given** the capture sheet on the Photo tab **When** a photo is captured **Then** its `blob:` object URL renders as the preview `<img src>` (capture still works, and the guard passes `blob:`). (Test: "ProofSheet: a captured photo preview renders its blob: object URL as the img src".)

## ProofFeed renders text Proofs inert and drops non-media schemes

The Feed keeps rendering each capture type, and its stored `mediaURL` is scheme-guarded so a forged value cannot introduce an active scheme.

- **Given** a text Proof whose text is an HTML payload **When** the Feed renders it **Then** it appears as a literal, inert quote and no `<img>` (or other element) is injected. (Test: "ProofFeed: a text Proof of an HTML payload renders as a literal, inert quote".)
- **Given** a photo Proof **When** its `mediaURL` is an `https:` URL it renders the `<img>`, and **When** its `mediaURL` is a `javascript:` URL the image is dropped (no element). (Test: "ProofFeed: a photo Proof renders an https media URL and drops a javascript: media URL".)
- **Given** an audio Proof with an `https:` media URL **When** the Feed renders it **Then** the `<audio>` element renders. (Test: "ProofFeed: an audio Proof renders an https media URL".)
