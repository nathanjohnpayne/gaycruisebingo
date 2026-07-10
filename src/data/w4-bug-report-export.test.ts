// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveReport, exportReports } from '../../scripts/bug-reports-lib.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
let root: string;

const report = (id = 'report_123') => ({
  id,
  schemaVersion: 1,
  description: 'The board froze.',
  screenshotPath: `bug-reports/0123456789abcdefabcd/${id}/screenshot.png`,
  route: '/',
  submittedAt: '2026-07-09T00:00:00.000Z',
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gcb-bugs-'));
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe('local bug-report export', () => {
  it('atomically exports a self-contained report and skips it on rerun', async () => {
    const first = await exportReports({ reports: [report()], downloadScreenshot: async () => PNG, root });
    expect(first.exported).toEqual(['report_123']);
    expect(await readFile(path.join(root, 'inbox/report_123/description.md'), 'utf8')).toBe('The board froze.\n');
    expect(await readFile(path.join(root, 'inbox/report_123/screenshot.png'))).toEqual(PNG);
    const second = await exportReports({ reports: [report()], downloadScreenshot: async () => PNG, root });
    expect(second.skipped).toEqual(['report_123']);
  });

  it('removes partial output when a screenshot is malformed', async () => {
    const summary = await exportReports({ reports: [report()], downloadScreenshot: async () => Buffer.from('bad'), root });
    expect(summary.failed[0].error).toContain('not a PNG');
    await expect(stat(path.join(root, 'inbox/report_123'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('archives with an immutable GitHub receipt and prevents duplicate import', async () => {
    await exportReports({ reports: [report()], downloadScreenshot: async () => PNG, root });
    const receipt = await archiveReport({
      reportId: 'report_123',
      issueUrl: 'https://github.com/nathanjohnpayne/gaycruisebingo/issues/200',
      root,
      now: new Date('2026-07-10T00:00:00Z'),
    });
    expect(receipt.issue).toBe(200);
    expect(JSON.parse(await readFile(path.join(root, 'imported/report_123/github-issue.json'), 'utf8'))).toEqual(receipt);
    await expect(archiveReport({ reportId: 'report_123', issueUrl: receipt.url, root })).rejects.toThrow('does not exist');
  });

  it('does not overwrite a pre-existing receipt', async () => {
    await exportReports({ reports: [report()], downloadScreenshot: async () => PNG, root });
    await writeFile(path.join(root, 'inbox/report_123/github-issue.json'), 'existing');
    await expect(archiveReport({
      reportId: 'report_123',
      issueUrl: 'https://github.com/nathanjohnpayne/gaycruisebingo/issues/200',
      root,
    })).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
