export interface ValidClientReportFields {
  schemaVersion: 1;
  description: string;
  captureError: string | null;
  route: string;
  eventId: string;
  appVersion: string;
  browser: string;
  viewport: { width: number; height: number };
  online: boolean;
}

export const SCREENSHOT_MAX_BYTES: number;
export function validateClientReportFields(input: unknown): ValidClientReportFields;
export function validatePngBytes(input: Buffer): Buffer;
