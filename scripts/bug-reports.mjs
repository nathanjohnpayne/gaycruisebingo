#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { archiveReport, exportReports, recordDisposition } from './bug-reports-lib.mjs';

const root = path.resolve('.github/bug-reports');

async function firebaseConfig() {
  const projectFile = JSON.parse(await readFile('.firebaserc', 'utf8'));
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || projectFile.projects?.default;
  let storageBucket = process.env.BUG_REPORT_BUCKET;
  if (!storageBucket) {
    try {
      const env = await readFile('.env.local', 'utf8');
      storageBucket = /^VITE_FIREBASE_STORAGE_BUCKET=(.+)$/m.exec(env)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    } catch {
      // The explicit env below gives the operator a deterministic recovery path.
    }
  }
  if (!projectId || !storageBucket) {
    throw new Error('Set BUG_REPORT_BUCKET (or VITE_FIREBASE_STORAGE_BUCKET in .env.local) before pulling reports.');
  }
  return { projectId, storageBucket };
}

async function pull() {
  const config = await firebaseConfig();
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), ...config });
  const snapshot = await getFirestore(app).collection('bugReports').orderBy('submittedAt', 'asc').get();
  const reports = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      submittedAt: data.submittedAt?.toDate?.().toISOString?.() ?? null,
    };
  });
  const bucket = getStorage(app).bucket(config.storageBucket);
  const summary = await exportReports({
    reports,
    root,
    downloadScreenshot: async (storagePath) => (await bucket.file(storagePath).download())[0],
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failed.length) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'pull') {
  await pull();
} else if (command === 'archive') {
  if (args.length !== 2) throw new Error('Usage: npm run bugs:archive -- <report-id> <github-issue-url>');
  process.stdout.write(`${JSON.stringify(await archiveReport({ reportId: args[0], issueUrl: args[1], root }), null, 2)}\n`);
} else if (command === 'disposition') {
  if (args.length < 3) throw new Error('Usage: npm run bugs:disposition -- <report-id> <failed|ambiguous> <reason>');
  process.stdout.write(`${JSON.stringify(await recordDisposition({ reportId: args[0], status: args[1], reason: args.slice(2).join(' '), root }), null, 2)}\n`);
} else {
  throw new Error('Usage: bug-reports.mjs <pull|archive|disposition>');
}
