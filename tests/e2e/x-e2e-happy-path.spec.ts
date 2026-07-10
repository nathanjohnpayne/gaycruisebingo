// x-e2e-happy-path — join -> Mark -> BINGO -> Leaderboard, zero admin action,
// plus the ADR 0006 offline-mark-survives-reload assertion, against the
// Firebase Local Emulator Suite. See specs/x-e2e-happy-path.md for the AC
// mapping.
import { test, expect, type Page } from '@playwright/test';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { MIN_POOL } from '../../src/game/logic';
import {
  boardHasMarkedText,
  EVENT_SEED,
  seedEmulatorEvent,
  SEEDED_ACTIVE_PROMPT_COUNT,
  userAttested,
} from './support/seed';
import { joinViaSharedLink, signedInUid } from './support/join';
import {
  LINE_INDICES_EXCLUDING_CENTER,
  readDealtCellTexts,
  tapCellByText,
  waitForBoardServerConfirmed,
} from './support/board';
import { EVENT_ID } from './support/env';

test.describe('x-e2e-happy-path', () => {
  let testEnv: RulesTestEnvironment;

  test.beforeAll(async () => {
    // >= MIN_POOL (24) active, non-free Prompts so dealBoard never throws the
    // ADR 0004 guard (src/game/logic.ts) — asserted against the same seed
    // this suite writes into the emulator, not a hardcoded literal.
    expect(SEEDED_ACTIVE_PROMPT_COUNT).toBeGreaterThanOrEqual(MIN_POOL);
    testEnv = await seedEmulatorEvent();
  });

  test.afterAll(async () => {
    await testEnv?.cleanup();
  });

  test('join -> Mark -> BINGO -> Leaderboard completes with only the shared link (zero admin action)', async ({
    page,
  }) => {
    // The "shared link" is just the app's one URL (CONTEXT.md: no invite
    // code). Nothing in this test ever visits /admin or touches Admin.tsx.
    await joinViaSharedLink(page);

    // The dealt card is the seeded Event, not a stray/default one — proves
    // the seed this suite wrote is what the Player actually joined.
    await expect(page.locator('.card-meta')).toContainText(EVENT_SEED.name);

    const dealtTexts = await readDealtCellTexts(page);
    // Wait for the FIRST server-backed board snapshot before marking the line:
    // a BINGO completed while the board is still cache-only is swallowed as the
    // Celebration's initial baseline, not an animated edge, so the BINGO!
    // assertion below would flake without this (see waitForBoardServerConfirmed).
    await waitForBoardServerConfirmed(page);
    // Complete the middle row [10,11,12,13,14] — one of the four lines that
    // runs through the free centre (index 12), so the AC's "centre free space
    // counts" needs only 4 taps, not 5.
    for (const index of LINE_INDICES_EXCLUDING_CENTER) {
      await tapCellByText(page, dealtTexts[index]);
    }

    // The celebration headline (Celebration.tsx `.big`), targeted by class +
    // text: the w2-share-cards Share Card renders a second "BINGO!" node
    // (`.share-card-title`) inside the same celebration, so a bare
    // getByText('BINGO!') is ambiguous under strict mode.
    await expect(page.locator('.big', { hasText: 'BINGO!' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep playing' }).click();

    await page.getByRole('link', { name: 'Ranks' }).click();
    const rows = page.locator('.list .row');
    // The sole Player in this dedicated e2e Event, so rank #1 is trivial —
    // the fields comparePlayers actually orders by (bingoCount, squaresMarked,
    // firstBingoAt; src/game/logic.ts) are what this proves end-to-end. The
    // comparator's own multi-Player tie-break ordering is unit-tested at
    // src/game/logic.test.ts; a second real signed-in identity is out of
    // reach for a single-browser-context e2e run.
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.rank')).toHaveText('1');
    await expect(rows.first().locator('.sub')).toContainText('1 bingo');
    await expect(rows.first().locator('.sub')).toContainText(
      `${LINE_INDICES_EXCLUDING_CENTER.length} squares`,
    );
  });

  test('a Mark made offline survives a reload and syncs on reconnect (ADR 0006)', async ({
    page,
    context,
  }) => {
    await joinViaSharedLink(page);
    await readDealtCellTexts(page); // waits for the deal to render (25 cells)
    // THIS Player's uid — scopes the step-5 emulator observer to this case's
    // own board (boards/{uid}), so a prompt-text collision with the happy-path
    // Player's already-marked board in the same Event can never fake the pass.
    const uid = await signedInUid(page);

    // Any unmarked, non-free Square — never index CENTER (always-on Free
    // Space, unreachable via toggle()) and never one the happy-path case may
    // already have marked on a shared emulator instance.
    const target = page.locator('.grid .cell:not(.free):not(.marked)').first();
    const targetText = (await target.textContent())?.trim();
    if (!targetText) throw new Error('No unmarked, non-free Square available to Mark offline.');

    // The offline reload below re-fetches the app shell, which — offline — only
    // resolves from the PWA service worker's precache; that same precache also
    // serves the JS that re-initializes the Firestore SDK so it can recover the
    // durable queue. The suite serves a real `vite build` + `vite preview`
    // (playwright.config.ts) so that SW exists; wait until it is active
    // (precache complete) before cutting the network.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    // The join must have FULLY settled server-side before the dead zone starts:
    // signIn() persists the 18+ attestation via a Firestore TRANSACTION after
    // the popup, and the signed-in shell renders before that transaction
    // commits. Cutting the network too early kills it mid-flight (transactions
    // never queue offline), leaving this User un-attested — the step-6 reload
    // would then land on the #23 re-prompt gate instead of the Board. Realistic
    // ordering too: the ship-wifi dead zone comes after the online join.
    await expect(async () => {
      expect(await userAttested(testEnv, uid)).toBe(true);
    }).toPass({ timeout: 10_000 });

    // 1. Go offline — a ship-wifi dead zone.
    await context.setOffline(true);

    // 2. Mark it. setMark's commit() never resolves while offline (ADR 0006),
    // but the write lands in the persistent (IndexedDB) cache synchronously
    // via latency compensation, so the UI reflects it at once.
    await tapCellByText(page, targetText);
    await expect(markedCellLocator(page, targetText)).toHaveClass(/marked/);

    // 3. "Reload" while STILL offline: memory is wiped and the whole app
    // re-initializes from scratch, so anything that survives came from the
    // durable IndexedDB queue, not memory. The SW serves the shell + JS
    // offline, so the Firestore SDK re-initializes and RECOVERS the pending
    // Mark from that queue.
    await page.reload();

    // 4. The app COLD-BOOTS offline (#115): AuthContext publishes the cached
    // auth User and settles loading:false without awaiting the network-bound
    // bootstrap (ensureUserProfile is a transaction that never resolves
    // offline), and settles the 18+ gate from the cached attestation — so the
    // signed-in shell + the cached Board render offline instead of stalling on
    // "Loading…" or the #23 re-prompt. The recovered Mark reaches the UI, not
    // just storage: this is the end-to-end UI proof, done directly on the
    // offline-booted page (no fresh online reload needed).
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 15_000 });
    await expect(markedCellLocator(page, targetText)).toHaveClass(/marked/, { timeout: 15_000 });

    // 5. Reconnect — the recovered queue drains to the emulator.
    await context.setOffline(false);

    // 6. Ground truth via an INDEPENDENT observer (never this reloaded tab's
    // own cache), scoped to THIS Player's own board: the emulator now has the
    // Mark on boards/{uid}. It was made offline and never synced before the
    // reload, so the ONLY path it could reach the emulator is the durable
    // IndexedDB queue surviving the reload and draining on reconnect — proving
    // the Mark outlived memory (ADR 0006), not merely latency compensation.
    await expect(async () => {
      expect(await boardHasMarkedText(testEnv, uid, targetText)).toBe(true);
    }).toPass({ timeout: 20_000 });
  });

  test('the persistent bug-report control clears the tab bar and previews the app surface', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await joinViaSharedLink(page);
    const trigger = page.getByRole('button', { name: 'Report a bug' });
    const tabs = page.getByRole('navigation', { name: 'Primary' });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveCSS('position', 'fixed');
    const geometry = await page.evaluate(() => {
      const triggerRect = document.querySelector('.bug-report-trigger')?.getBoundingClientRect();
      const tabsRect = document.querySelector('.tabs')?.getBoundingClientRect();
      return triggerRect && tabsRect
        ? { triggerBottom: triggerRect.bottom, tabTop: tabsRect.top, width: triggerRect.width, height: triggerRect.height }
        : null;
    });
    expect(geometry).not.toBeNull();
    expect(geometry?.triggerBottom).toBeLessThanOrEqual(geometry?.tabTop ?? 0);
    expect(geometry?.width).toBeGreaterThanOrEqual(44);
    expect(geometry?.height).toBeGreaterThanOrEqual(44);
    await expect(trigger.locator('span')).toHaveCSS('position', 'absolute');

    const normalBottom = await trigger.evaluate((element) => Number.parseFloat(getComputedStyle(element).bottom));
    await page.evaluate(() => document.body.classList.add('install-prompt-visible'));
    const installBottom = await trigger.evaluate((element) => Number.parseFloat(getComputedStyle(element).bottom));
    expect(installBottom - normalBottom).toBeGreaterThanOrEqual(60);
    await page.evaluate(() => document.body.classList.remove('install-prompt-visible'));

    await page.evaluate(() => {
      const sheet = document.createElement('div');
      sheet.className = 'sheet-backdrop test-only-sheet';
      document.body.append(sheet);
    });
    await expect(trigger).toBeHidden();
    await page.evaluate(() => document.querySelector('.test-only-sheet')?.remove());
    await expect(trigger).toBeVisible();

    const uid = await signedInUid(page);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `events/${EVENT_ID}`), { admins: [uid] }, { merge: true });
    });
    await page.reload();
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveCount(5);

    const reloadedTrigger = page.getByRole('button', { name: 'Report a bug' });
    await reloadedTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Report a bug' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByAltText('Screenshot that will be submitted with this bug report')).toBeVisible({ timeout: 15_000 });
    await expect(reloadedTrigger).toBeHidden();
    await expect(tabs).toBeVisible();
  });
});

function markedCellLocator(page: Page, text: string) {
  return page.locator('.cell', { hasText: text });
}
