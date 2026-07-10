import { httpsCallable } from 'firebase/functions';
import { toBlob } from 'html-to-image';
import { EVENT_ID, functions } from '../firebase';

export const BUG_REPORT_SCHEMA_VERSION = 1 as const;
export const BUG_REPORT_DESCRIPTION_MAX = 4000;
export const BUG_REPORT_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export interface BugReportViewport {
  width: number;
  height: number;
}

export interface SubmitBugReportInput {
  schemaVersion: typeof BUG_REPORT_SCHEMA_VERSION;
  description: string;
  screenshotDataUrl: string | null;
  captureError: string | null;
  route: string;
  eventId: string;
  appVersion: string;
  browser: string;
  viewport: BugReportViewport;
  online: boolean;
}

export interface SubmitBugReportResult {
  reportId: string;
}

function excludedFromCapture(node: HTMLElement): boolean {
  return !!node.closest('[data-bug-report-ui]');
}

/** Capture only the app surface—never browser chrome, other tabs, or apps. */
export async function captureAppSurface(): Promise<Blob> {
  const root = document.querySelector<HTMLElement>('.app');
  if (!root) throw new Error('App surface unavailable');
  const blob = await toBlob(root, {
    cacheBust: true,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    filter: (node) => !(node instanceof HTMLElement) || !excludedFromCapture(node),
  });
  if (!blob) throw new Error('Screenshot capture returned no image');
  if (blob.size > BUG_REPORT_SCREENSHOT_MAX_BYTES) throw new Error('Screenshot is too large');
  return blob;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Screenshot encoding failed'));
    reader.onerror = () => reject(new Error('Screenshot encoding failed'));
    reader.readAsDataURL(blob);
  });
}

export function buildBugReportInput(args: {
  description: string;
  screenshotDataUrl: string | null;
  captureError: string | null;
}): SubmitBugReportInput {
  return {
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    description: args.description.trim(),
    screenshotDataUrl: args.screenshotDataUrl,
    captureError: args.captureError,
    route: `${window.location.pathname}${window.location.search}`.slice(0, 200),
    eventId: EVENT_ID,
    appVersion: __APP_VERSION__,
    browser: navigator.userAgent.slice(0, 500),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    online: navigator.onLine,
  };
}

export async function submitBugReport(input: SubmitBugReportInput): Promise<SubmitBugReportResult> {
  const submitCallable = httpsCallable<SubmitBugReportInput, SubmitBugReportResult>(functions, 'submitBugReport');
  const result = await submitCallable(input);
  return result.data;
}
