import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  const [stHost, stPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').split(':');
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'gaycruisebingo',
    firestore: {
      host: fsHost,
      port: Number(fsPort),
      rules: readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8'),
    },
    storage: {
      host: stHost,
      port: Number(stPort),
      rules: readFileSync(fileURLToPath(new URL('../../storage.rules', import.meta.url)), 'utf8'),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'bugReports/report_123'), { description: 'private' });
    await uploadBytes(ref(context.storage(), 'bug-reports/0123456789abcdefabcd/report_123/screenshot.png'), new Uint8Array([1]), { contentType: 'image/png' });
  });
});

afterAll(async () => env?.cleanup());

describe('private bug-report intake', () => {
  it('denies signed-in players direct Firestore reads and writes', async () => {
    const player = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(player, 'bugReports/report_123')));
    await assertFails(setDoc(doc(player, 'bugReports/forged'), { description: 'forged' }));
  });

  it('denies signed-in players direct Storage reads and writes', async () => {
    const player = env.authenticatedContext('alice').storage();
    await assertFails(getBytes(ref(player, 'bug-reports/0123456789abcdefabcd/report_123/screenshot.png')));
    await assertFails(uploadBytes(ref(player, 'bug-reports/0123456789abcdefabcd/forged/screenshot.png'), new Uint8Array([1]), { contentType: 'image/png' }));
  });
});
