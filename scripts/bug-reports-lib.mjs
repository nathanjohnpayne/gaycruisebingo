import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import contract from '../functions/src/bugReportContract.cjs';

const { validateClientReportFields, validatePngBytes } = contract;

const REPORT_ID = /^[A-Za-z0-9_-]{6,100}$/;
const ISSUE_URL = /^https:\/\/github\.com\/nathanjohnpayne\/gaycruisebingo\/issues\/(\d+)$/;

// The durable dedupe ledger (issue #146's "export ledger" decision, made durable).
// One JSON object per line — {reportId, issue, url, importedAt} — recording every
// report already turned into a GitHub issue. Report IDs are opaque Firestore doc
// IDs (no PII), so unlike the gitignored inbox/imported trees this file IS
// committed: that is what makes dedupe survive a fresh clone or a deleted worktree.
const LEDGER_FILE = 'imported-ledger.jsonl';

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

/**
 * Parse the committed dedupe ledger into its entries. A missing ledger is an empty
 * list; a single malformed line is skipped rather than aborting the whole pull or
 * archive (a corrupt line must never re-open the door to duplicate imports for
 * every OTHER report).
 */
async function readLedger(root) {
  let raw;
  try {
    raw = await readFile(path.join(root, LEDGER_FILE), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && REPORT_ID.test(entry.reportId ?? '')) entries.push(entry);
    } catch {
      // Skip the corrupt line; keep deduping against every well-formed one.
    }
  }
  return entries;
}

async function ledgerReportIds(root) {
  return new Set((await readLedger(root)).map((entry) => entry.reportId));
}

/**
 * Append a receipt to the ledger, idempotently — a report already recorded is a
 * no-op. Called on every archive, INCLUDING the idempotent re-archive path, so a
 * report imported before the ledger existed is back-filled the next time archive
 * runs: the ledger self-heals rather than needing a separate migration.
 */
async function appendToLedger(root, receipt) {
  if ((await ledgerReportIds(root)).has(receipt.reportId)) return;
  const entry = { reportId: receipt.reportId, issue: receipt.issue, url: receipt.url, importedAt: receipt.importedAt };
  await appendFile(path.join(root, LEDGER_FILE), `${JSON.stringify(entry)}\n`);
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
  // Durable dedupe (#146): skip any report already recorded in the committed
  // ledger, even when this checkout has no local inbox/imported tree — a fresh
  // clone, a different machine, or after the import worktree was deleted.
  const alreadyImported = await ledgerReportIds(root);
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
    if (await exists(destination) || await exists(path.join(imported, report.id)) || alreadyImported.has(report.id)) {
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
    if (importedReceipt.reportId === requested.reportId && importedReceipt.issue === requested.issue && importedReceipt.url === requested.url) {
      await appendToLedger(root, importedReceipt); // self-heal: back-fill a pre-ledger import on re-archive
      return importedReceipt;
    }
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
  await appendToLedger(root, receipt);
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
