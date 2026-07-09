import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteField,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
// @ts-expect-error — scripts/seed.mjs is a plain-JS node script with no type
// declarations. The exported payload helpers are import-safe and side-effect-free.
import { adminRoster, eventWritePayload, seedItemMutations } from '../../scripts/seed.mjs';

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const EVENT = 'seed-composition';

let testEnv: RulesTestEnvironment;

async function applySeed(db: Firestore) {
  const eventRef = doc(db, 'events', EVENT);
  const itemsRef = collection(db, 'events', EVENT, 'items');
  const existing = await getDocs(itemsRef);
  const { deleteIds, writes } = seedItemMutations(
    existing.docs.map((snap) => ({
      id: snap.id,
      createdBy: snap.data().createdBy,
    })),
    1_776_000_000_000,
  );
  const batch = writeBatch(db);
  batch.set(eventRef, eventWritePayload(adminRoster(''), deleteField()), {
    merge: true,
  });
  for (const id of deleteIds) batch.delete(doc(itemsRef, id));
  for (const { id, data } of writes) batch.set(doc(itemsRef, id), data, { merge: true });
  await batch.commit();
}

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-gaycruisebingo-seed-composition',
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('scripts/seed.mjs — emulator-backed seed-owned replace semantics', () => {
  it('fresh seed writes exactly 87 active seed prompts with boolean spicy flags', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await applySeed(db);
      const seeded = (await getDocs(collection(db, 'events', EVENT, 'items'))).docs.map((snap) =>
        snap.data(),
      );

      expect(seeded).toHaveLength(87);
      expect(seeded.every((item) => item.createdBy === 'seed')).toBe(true);
      expect(seeded.every((item) => item.status === 'active')).toBe(true);
      expect(seeded.filter((item) => item.spicy === true)).toHaveLength(24);
      expect(seeded.filter((item) => item.spicy === false)).toHaveLength(63);
      expect(seeded.some((item) => item.isFreeSpace === true)).toBe(false);
    });
  });

  it('running twice replaces seed-owned prompts without duplicating or deleting player submissions', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await applySeed(db);
      await setDoc(doc(db, 'events', EVENT, 'items', 'stale-seed'), {
        text: 'stale seed prompt',
        createdBy: 'seed',
        createdAt: 1,
        isFreeSpace: false,
        status: 'active',
        reportCount: 0,
        spicy: false,
      });
      await setDoc(doc(db, 'events', EVENT, 'items', 'player-prompt'), {
        text: 'player prompt',
        createdBy: 'player-1',
        createdAt: 1,
        isFreeSpace: false,
        status: 'active',
        reportCount: 0,
        spicy: true,
      });

      await applySeed(db);
      const docs = (await getDocs(collection(db, 'events', EVENT, 'items'))).docs;
      const byId = new Map(docs.map((snap) => [snap.id, snap.data()]));
      const seedOwned = docs.filter((snap) => snap.data().createdBy === 'seed');

      expect(seedOwned).toHaveLength(87);
      expect(byId.has('stale-seed')).toBe(false);
      expect(byId.get('player-prompt')?.text).toBe('player prompt');
      expect(byId.get('player-prompt')?.createdBy).toBe('player-1');
    });
  });
});
