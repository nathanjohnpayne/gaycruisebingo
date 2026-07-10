import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function safeReport(report) {
  if (!report || !REPORT_ID.test(report.id ?? '')) throw new Error('Invalid report id');
  if (report.schemaVersion !== 1) throw new Error(`Unsupported schema for ${report.id}`);
  if (typeof report.description !== 'string' || !report.description.trim()) throw new Error(`Missing description for ${report.id}`);
  if (report.screenshotPath != null && !/^bug-reports\/[a-f0-9]{20}\/[A-Za-z0-9_-]+\/screenshot\.png$/.test(report.screenshotPath)) {
    throw new Error(`Unsafe screenshot path for ${report.id}`);
  }
  if (typeof report.submittedAt !== 'string' || !Number.isFinite(Date.parse(report.submittedAt))) throw new Error(`Invalid submittedAt for ${report.id}`);
  if (typeof report.route !== 'string' || !report.route.startsWith('/') || report.route.length > 200) throw new Error(`Invalid route for ${report.id}`);
  if (typeof report.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(report.eventId)) throw new Error(`Invalid eventId for ${report.id}`);
  if (typeof report.appVersion !== 'string' || !report.appVersion || report.appVersion.length > 100) throw new Error(`Invalid appVersion for ${report.id}`);
  if (typeof report.browser !== 'string' || !report.browser || report.browser.length > 500) throw new Error(`Invalid browser for ${report.id}`);
  if (!report.viewport || !Number.isInteger(report.viewport.width) || !Number.isInteger(report.viewport.height)) throw new Error(`Invalid viewport for ${report.id}`);
  if (typeof report.online !== 'boolean') throw new Error(`Invalid online state for ${report.id}`);
  if (typeof report.reporterHash !== 'string' || !/^[a-f0-9]{20}$/.test(report.reporterHash)) throw new Error(`Invalid reporter hash for ${report.id}`);
  if (report.captureError != null && (typeof report.captureError !== 'string' || report.captureError.length > 200)) throw new Error(`Invalid capture error for ${report.id}`);
  if (report.status !== 'new') throw new Error(`Invalid status for ${report.id}`);
  const { description, ...metadata } = report;
  return { description: description.trim(), metadata };
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
        if (!Buffer.isBuffer(image) || image.length < 8 || !image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
          throw new Error('Downloaded screenshot is not a PNG');
        }
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
  if (!(await exists(source))) throw new Error(`Inbox report ${reportId} does not exist`);
  if (await exists(destination)) throw new Error(`Imported report ${reportId} already exists`);
  const receipt = {
    reportId,
    issue: Number(match[1]),
    url: issueUrl,
    importedAt: now.toISOString(),
  };
  const receiptPath = path.join(source, 'github-issue.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await rename(source, destination);
  } catch (error) {
    await rm(receiptPath, { force: true });
    throw error;
  }
  return receipt;
}

export async function recordDisposition({ reportId, status, reason, root, now = new Date() }) {
  if (!REPORT_ID.test(reportId)) throw new Error('Invalid report id');
  if (!['failed', 'ambiguous'].includes(status)) throw new Error('Disposition must be failed or ambiguous');
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length > 1000) throw new Error('Disposition reason must be 1-1000 characters');
  const source = path.join(root, 'inbox', reportId);
  if (!(await exists(source))) throw new Error(`Inbox report ${reportId} does not exist`);
  const disposition = { reportId, status, reason: trimmed, retryable: true, recordedAt: now.toISOString() };
  await writeFile(path.join(source, 'disposition.json'), `${JSON.stringify(disposition, null, 2)}\n`, { flag: 'wx' });
  return disposition;
}
