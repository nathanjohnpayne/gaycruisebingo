export interface ExportReport {
  id: string;
  schemaVersion: number;
  description: string;
  screenshotPath: string | null;
  [key: string]: unknown;
}

export interface ExportSummary {
  exported: string[];
  skipped: string[];
  failed: Array<{ id: string; error: string }>;
}

export function exportReports(args: {
  reports: ExportReport[];
  downloadScreenshot: (path: string) => Promise<Buffer>;
  root: string;
}): Promise<ExportSummary>;

export interface ImportReceipt {
  reportId: string;
  issue: number;
  url: string;
  importedAt: string;
}

export function archiveReport(args: {
  reportId: string;
  issueUrl: string;
  root: string;
  now?: Date;
}): Promise<ImportReceipt>;
