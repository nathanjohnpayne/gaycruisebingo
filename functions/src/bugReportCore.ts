const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 3;

export class BugReportInputError extends Error {
  constructor(
    readonly code: 'invalid-argument' | 'resource-exhausted',
    message: string,
  ) {
    super(message);
  }
}

export interface ValidBugReport {
  schemaVersion: 1;
  description: string;
  screenshot: Buffer | null;
  captureError: string | null;
  route: string;
  eventId: string;
  appVersion: string;
  browser: string;
  viewport: { width: number; height: number };
  online: boolean;
}

export interface RateState {
  windowStartMs: number;
  count: number;
}

function invalid(message: string): never {
  throw new BugReportInputError('invalid-argument', message);
}

function boundedString(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string') invalid(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) invalid(`${label} must be ${min}-${max} characters.`);
  return trimmed;
}

function optionalString(value: unknown, label: string, max: number): string | null {
  return value == null ? null : boundedString(value, label, max);
}

function screenshotFrom(value: unknown): Buffer | null {
  if (value == null) return null;
  if (typeof value !== 'string') invalid('Screenshot must be a PNG data URL.');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) invalid('Screenshot must be a PNG data URL.');
  const screenshot = Buffer.from(match[1], 'base64');
  if (!screenshot.length || screenshot.length > SCREENSHOT_MAX_BYTES) invalid('Screenshot exceeds the 5 MiB limit.');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!screenshot.subarray(0, 8).equals(signature)) invalid('Screenshot content is not a PNG.');
  return screenshot;
}

export function validateBugReportInput(value: unknown): ValidBugReport {
  if (!value || typeof value !== 'object') invalid('Report payload is required.');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) invalid('Unsupported report schema.');
  if (!input.viewport || typeof input.viewport !== 'object') invalid('Viewport is required.');
  const viewport = input.viewport as Record<string, unknown>;
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 200 || Number(width) > 10000 || Number(height) < 200 || Number(height) > 10000) {
    invalid('Viewport dimensions are invalid.');
  }
  if (typeof input.online !== 'boolean') invalid('Online state is required.');
  const route = boundedString(input.route, 'Route', 200, 1);
  if (!route.startsWith('/')) invalid('Route must be app-relative.');
  const eventId = boundedString(input.eventId, 'Event ID', 100, 1);
  if (!/^[A-Za-z0-9_-]+$/.test(eventId)) invalid('Event ID is invalid.');
  return {
    schemaVersion: 1,
    description: boundedString(input.description, 'Description', 4000, 1),
    screenshot: screenshotFrom(input.screenshotDataUrl),
    captureError: optionalString(input.captureError, 'Capture error', 200),
    route,
    eventId,
    appVersion: boundedString(input.appVersion, 'App version', 100, 1),
    browser: boundedString(input.browser, 'Browser', 500, 1),
    viewport: { width: Number(width), height: Number(height) },
    online: input.online,
  };
}

export function nextRateState(previous: RateState | undefined, nowMs: number): RateState {
  if (!previous || nowMs - previous.windowStartMs >= RATE_WINDOW_MS) return { windowStartMs: nowMs, count: 1 };
  if (previous.count >= RATE_MAX) throw new BugReportInputError('resource-exhausted', 'Too many bug reports. Try again later.');
  return { windowStartMs: previous.windowStartMs, count: previous.count + 1 };
}
