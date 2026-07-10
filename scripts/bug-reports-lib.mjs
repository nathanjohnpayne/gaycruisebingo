import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import contract from '../functions/src/bugReportContract.cjs';

const { validateClientReportFields, validatePngBytes } = contract;

const REPORT_ID = /^[A-Za-z0-9_-]{6,100}$/;
const ISSUE_URL = /^https:\/\/github\.com\/nathanjohnpayne\/gaycruisebingo\/issues\/(\d+)$/;

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(target) {
  try {
    return JSON.parse(await readFile(target, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function normalizeSubmittedAt(value) {
  try {
    const date = typeof value?.toDate === 'function' ? value.toDate() : value;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch {
    return null;
  }
}

function safeReport(report) {
  if (!report || !REPORT_ID.test(report.id ?? '')) throw new Error('Invalid report id');
  const fields = validateClientReportFields(report);
  if (typeof report.reporterHash !== 'string' || !/^[a-f0-9]{20}$/.test(report.reporterHash)) throw new Error(`Invalid reporter hash for ${report.id}`);
  const expectedScreenshotPath = `bug-reports/${report.reporterHash}/${report.id}/screenshot.png`;
  if (report.screenshotPath !== null && report.screenshotPath !== expectedScreenshotPath) throw new Error(`Unsafe screenshot path for ${report.id}`);
  if (typeof report.submittedAt !== 'string' || !Number.isFinite(Date.parse(report.submittedAt))) throw new Error(`Invalid submittedAt for ${report.id}`);
  if (report.captureError != null && (typeof report.captureError !== 'string' || report.captureError.length > 200)) throw new Error(`Invalid capture error for ${report.id}`);
  if (report.status !== 'new') throw new Error(`Invalid status for ${report.id}`);
  const metadata = {
    id: report.id,
    schemaVersion: fields.schemaVersion,
    screenshotPath: report.screenshotPath,
    captureError: fields.captureError,
    route: fields.route,
    eventId: fields.eventId,
    appVersion: fields.appVersion,
    browser: fields.browser,
    viewport: fields.viewport,
    online: fields.online,
    reporterHash: report.reporterHash,
    submittedAt: report.submittedAt,
    status: report.status,
  };
  return { description: fields.description, metadata };
}

export async function exportReports({ reports, downloadScreenshot, root }) {
  const inbox = path.join(root, 'inbox');
  const imported = path.join(root, 'imported');
  await mkdir(inbox, { recursive: true });
  await mkdir(imported, { recursive: true });
  const summary = { exported: [], skipped: [], failed: [] };
  for (const report of reports) {
    let validated;
    try {
      validated = safeReport(report);
    } catch (error) {
      summary.failed.push({ id: report?.id ?? 'unknown', error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const destination = path.join(inbox, report.id);
    if (await exists(destination) || await exists(path.join(imported, report.id))) {
      summary.skipped.push(report.id);
      continue;
    }
    const staging = path.join(root, `.tmp-${report.id}-${process.pid}`);
    try {
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      await writeFile(path.join(staging, 'report.json'), `${JSON.stringify(validated.metadata, null, 2)}\n`, { flag: 'wx' });
      await writeFile(path.join(staging, 'description.md'), `${validated.description}\n`, { flag: 'wx' });
      if (report.screenshotPath) {
        const image = await downloadScreenshot(report.screenshotPath);
        validatePngBytes(image);
        await writeFile(path.join(staging, 'screenshot.png'), image, { flag: 'wx' });
      }
      await rename(staging, destination);
      summary.exported.push(report.id);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      summary.failed.push({ id: report.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}

export async function archiveReport({ reportId, issueUrl, root, now = new Date() }) {
  if (!REPORT_ID.test(reportId)) throw new Error('Invalid report id');
  const match = ISSUE_URL.exec(issueUrl);
  if (!match) throw new Error('Issue URL must point to nathanjohnpayne/gaycruisebingo');
  const source = path.join(root, 'inbox', reportId);
  const destination = path.join(root, 'imported', reportId);
  const requested = {
    reportId,
    issue: Number(match[1]),
    url: issueUrl,
  };
  const importedReceipt = await readJson(path.join(destination, 'github-issue.json'));
  if (importedReceipt) {
    if (importedReceipt.reportId === requested.reportId && importedReceipt.issue === requested.issue && importedReceipt.url === requested.url) return importedReceipt;
    throw new Error(`Imported report ${reportId} has a conflicting receipt`);
  }
  if (!(await exists(source))) throw new Error(`Inbox report ${reportId} does not exist`);
  const receiptPath = path.join(source, 'github-issue.json');
  const existingReceipt = await readJson(receiptPath);
  if (existingReceipt && (existingReceipt.reportId !== requested.reportId || existingReceipt.issue !== requested.issue || existingReceipt.url !== requested.url)) {
    throw new Error(`Inbox report ${reportId} has a conflicting receipt`);
  }
  const receipt = existingReceipt ?? { ...requested, importedAt: now.toISOString() };
  if (!existingReceipt) await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  return receipt;
}

export async function recordDisposition({ reportId, status, reason, root, now = new Date() }) {
  if (!REPORT_ID.test(reportId)) throw new Error('Invalid report id');
  if (!['failed', 'ambiguous'].includes(status)) throw new Error('Disposition must be failed or ambiguous');
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length > 1000) throw new Error('Disposition reason must be 1-1000 characters');
  const source = path.join(root, 'inbox', reportId);
  if (!(await exists(source))) throw new Error(`Inbox report ${reportId} does not exist`);
  const dispositionPath = path.join(source, 'disposition.json');
  const existingDisposition = await readJson(dispositionPath);
  if (existingDisposition) {
    if (existingDisposition.reportId === reportId && existingDisposition.status === status && existingDisposition.reason === trimmed) return existingDisposition;
    throw new Error(`Inbox report ${reportId} has a conflicting disposition`);
  }
  const disposition = { reportId, status, reason: trimmed, retryable: true, recordedAt: now.toISOString() };
  await writeFile(dispositionPath, `${JSON.stringify(disposition, null, 2)}\n`, { flag: 'wx' });
  return disposition;
}
