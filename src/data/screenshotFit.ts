/**
 * Screenshot capture scaling against the bug-report server contract.
 *
 * The `submitBugReport` callable rejects screenshots whose PNG header shows
 * width > 8192, height > 8192, or width×height > 40,000,000 pixels
 * (`functions/src/bugReportContract.cjs` § `validatePngBytes`). The web
 * bundle cannot import the Functions package, so the caps are mirrored here
 * the same way `BUG_REPORT_SCREENSHOT_MAX_BYTES` mirrors the byte cap.
 *
 * A full-page capture of a long route (e.g. a scrolled Feed) at device pixel
 * ratio 2 blows past the height cap after ~4096 CSS px of page height, which
 * made every screenshot submission from a long page fail server-side (#361).
 * `planCaptureScale` picks the largest pixel ratio, at most the preferred
 * one, whose rendered canvas fits every cap — so long pages downscale just
 * enough to stay submittable while short pages keep full resolution.
 */

export const BUG_REPORT_SCREENSHOT_MAX_DIMENSION = 8192;
export const BUG_REPORT_SCREENSHOT_MAX_AREA = 40_000_000;

export interface CaptureScalePlan {
  /** Ratio to hand to the renderer (html-to-image `pixelRatio`, html2canvas `scale`). */
  pixelRatio: number;
  /** Resulting canvas width in device pixels: `trunc(cssWidth × pixelRatio)`. */
  width: number;
  /** Resulting canvas height in device pixels: `trunc(cssHeight × pixelRatio)`. */
  height: number;
  /** True when the caps forced `pixelRatio` below the preferred ratio. */
  scaled: boolean;
}

/**
 * Plan the render scale for a capture surface of `cssWidth`×`cssHeight` CSS
 * pixels. Pure: no DOM access, total over arbitrary numeric input.
 *
 * The returned dimensions replicate the renderer's own arithmetic — a canvas
 * assignment truncates `cssSize × ratio` toward zero — so callers can rely on
 * them matching the produced PNG. Truncation only shrinks, so the returned
 * dimensions never exceed the caps the ratio was solved against. An aspect
 * ratio beyond `8192:1` cannot satisfy both a 1px floor and the caps; the
 * short side then truncates to 0 and the capture attempt fails loudly
 * (`canvas.toBlob` yields no image) rather than submitting an invalid PNG.
 *
 * A non-measurable surface (non-finite or non-positive size — e.g. a display:
 * none node) keeps the preferred ratio: there is nothing to bound, and the
 * renderer's own failure surfaces through the existing capture-error path.
 */
export function planCaptureScale(cssWidth: number, cssHeight: number, preferredRatio: number): CaptureScalePlan {
  const preferred = Number.isFinite(preferredRatio) && preferredRatio > 0 ? preferredRatio : 1;
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) {
    return { pixelRatio: preferred, width: 0, height: 0, scaled: false };
  }
  const pixelRatio = Math.min(
    preferred,
    BUG_REPORT_SCREENSHOT_MAX_DIMENSION / cssWidth,
    BUG_REPORT_SCREENSHOT_MAX_DIMENSION / cssHeight,
    Math.sqrt(BUG_REPORT_SCREENSHOT_MAX_AREA / (cssWidth * cssHeight)),
  );
  return {
    pixelRatio,
    width: Math.trunc(cssWidth * pixelRatio),
    height: Math.trunc(cssHeight * pixelRatio),
    scaled: pixelRatio < preferred,
  };
}
