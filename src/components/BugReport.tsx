import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUG_REPORT_DESCRIPTION_MAX,
  blobToDataUrl,
  buildBugReportInput,
  captureAppSurface,
  submitBugReport,
} from '../data/bugReports';

function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20v-9M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4zM14.12 3.88 16 2M21 21a4 4 0 0 0-3.81-4M21 5a4 4 0 0 1-3.55 3.97M22 13h-4M3 21a4 4 0 0 1 3.81-4M3 5a4 4 0 0 0 3.55 3.97M6 13H2M8 2l1.88 1.88M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    </svg>
  );
}

function errorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code.includes('resource-exhausted')) return 'Too many reports right now. Please try again later.';
  if (code.includes('unauthenticated')) return 'Please sign in again before submitting.';
  return 'Could not submit the report. Check your connection and try again.';
}

/**
 * `variant`: `'floating'` (default) is the original fixed bottom-right chip
 * (w4-bug-report-inbox.md) — kept intact for that spec's own coverage.
 * `'row'` is a plain full-width menu row with the same trigger+sheet, used
 * ONLY by `More.tsx` (#208, daily-cards-spec § "More menu" § Support): the
 * live app mounts `variant="row"` exclusively now, so only one "Report a
 * bug" affordance is ever on screen at a time.
 */
export default function BugReport({ variant = 'floating' }: { variant?: 'floating' | 'row' }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const captureAttemptRef = useRef(0);
  const wasOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [captureState, setCaptureState] = useState<'idle' | 'capturing' | 'ready' | 'failed'>('idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const previewUrl = useMemo(() => (screenshot ? URL.createObjectURL(screenshot) : null), [screenshot]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        captureAttemptRef.current += 1;
        setOpen(false);
        setScreenshot(null);
        setCaptureState('idle');
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, open]);

  const capture = async () => {
    const attempt = ++captureAttemptRef.current;
    setCaptureState('capturing');
    setCaptureError(null);
    setScreenshot(null);
    try {
      const image = await captureAppSurface();
      if (captureAttemptRef.current !== attempt) return;
      setScreenshot(image);
      setCaptureState('ready');
    } catch (captureFailure) {
      if (captureAttemptRef.current !== attempt) return;
      const message = captureFailure instanceof Error ? captureFailure.message.slice(0, 200) : 'Capture unavailable';
      setCaptureError(message);
      setCaptureState('failed');
    }
  };

  const openReport = () => {
    setOpen(true);
    setDescription('');
    setError(null);
    setSubmittedId(null);
    void capture();
  };

  const close = () => {
    if (busy) return;
    captureAttemptRef.current += 1;
    setOpen(false);
    setScreenshot(null);
    setCaptureState('idle');
  };

  const submit = async () => {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const screenshotDataUrl = screenshot ? await blobToDataUrl(screenshot) : null;
      const result = await submitBugReport(buildBugReportInput({ description, screenshotDataUrl, captureError }));
      setSubmittedId(result.reportId);
      setScreenshot(null);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bug-report-ui" data-bug-report-ui>
      <button
        ref={triggerRef}
        className={variant === 'row' ? 'more-row' : 'bug-report-trigger'}
        type="button"
        aria-label="Report a bug"
        onClick={openReport}
      >
        <BugIcon />
        <span>Report a bug</span>
      </button>

      {open && (
        <div className="sheet-backdrop bug-report-backdrop" role="presentation" onClick={close}>
          <section
            ref={dialogRef}
            className="sheet bug-report-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            {submittedId ? (
              <>
                <h2 className="sheet-title" id="bug-report-title">Report received</h2>
                <p>Thanks. Your report ID is <code>{submittedId}</code>.</p>
                <div className="sheet-actions">
                  <button className="btn primary" type="button" onClick={close}>Done</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="sheet-title" id="bug-report-title">Report a bug</h2>
                <p className="bug-report-privacy">
                  We’ll send your description, this app view, route, app version, browser, and screen size. Review the image before sending; no email or auth token is included.
                </p>
                <label className="bug-report-label" htmlFor="bug-report-description">What happened?</label>
                <textarea
                  id="bug-report-description"
                  className="input bug-report-description"
                  rows={5}
                  maxLength={BUG_REPORT_DESCRIPTION_MAX}
                  autoFocus
                  placeholder="What were you trying to do, and what happened instead?"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <div className="bug-report-capture" aria-live="polite">
                  {captureState === 'capturing' && <p>Capturing this app view…</p>}
                  {captureState === 'ready' && previewUrl && (
                    <>
                      <img src={previewUrl} alt="Screenshot that will be submitted with this bug report" />
                      <button className="btn" type="button" onClick={capture}>Retake screenshot</button>
                    </>
                  )}
                  {captureState === 'failed' && (
                    <>
                      <p>Screenshot unavailable. You can still send a text-only report.</p>
                      <button className="btn" type="button" onClick={capture}>Try screenshot again</button>
                    </>
                  )}
                </div>
                {error && <p className="bug-report-error" role="alert">{error}</p>}
                <div className="sheet-actions">
                  <button className="btn" type="button" disabled={busy} onClick={close}>Cancel</button>
                  <button className="btn primary" type="button" disabled={!description.trim() || busy} onClick={submit}>
                    {busy ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
