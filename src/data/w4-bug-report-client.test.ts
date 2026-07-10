import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../firebase', () => ({ EVENT_ID: 'med-2026', functions: {} }));

const { toBlobSpy } = vi.hoisted(() => ({
  toBlobSpy: vi.fn(),
}));

vi.mock('html-to-image', () => ({ toBlob: toBlobSpy }));

import { buildBugReportInput, captureAppSurface } from './bugReports';

beforeEach(() => {
  toBlobSpy.mockReset();
  document.body.innerHTML = '';
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
});

describe('bug-report client diagnostics', () => {
  it('keeps the unhashed service-worker registration script out of immutable hosting cache', () => {
    const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
      hosting: { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    };
    const noCacheSources = firebaseConfig.hosting.headers
      .filter((entry) => entry.headers.some((header) => header.key === 'Cache-Control' && header.value === 'no-cache'))
      .map((entry) => entry.source);
    expect(noCacheSources.some((source) => source.includes('registerSW.js'))).toBe(true);
  });

  it('records the screen path without potentially sensitive query parameters', () => {
    window.history.replaceState({}, '', '/leaderboard?invite=secret-token');
    const input = buildBugReportInput({
      description: 'The board froze.',
      screenshotDataUrl: null,
      captureError: 'Capture unavailable',
    });
    expect(input.route).toBe('/leaderboard');
  });

  it('retries screenshot capture with Safari-safe media filtering after a full capture failure', async () => {
    const root = document.createElement('main');
    root.className = 'app';
    root.innerHTML = `
      <section>
        <p data-kind="content">Feed content</p>
        <video data-kind="video" src="/clip.mp4"></video>
        <audio data-kind="audio" src="/clip.webm"></audio>
        <iframe data-kind="frame" src="/frame.html"></iframe>
        <canvas data-kind="canvas"></canvas>
        <img data-kind="remote-image" src="https://firebasestorage.googleapis.com/proof.png" />
        <img data-kind="same-origin-image" src="${window.location.origin}/proof.png" />
        <button data-kind="report-ui" data-bug-report-ui>Report a bug</button>
      </section>
    `;
    document.body.append(root);
    const compatBlob = new Blob(['png'], { type: 'image/png' });
    toBlobSpy.mockRejectedValueOnce(new Error('Safari cannot render this surface'));
    toBlobSpy.mockResolvedValueOnce(compatBlob);

    await expect(captureAppSurface()).resolves.toBe(compatBlob);

    expect(toBlobSpy).toHaveBeenCalledTimes(2);
    expect(toBlobSpy).toHaveBeenNthCalledWith(1, root, expect.objectContaining({
      cacheBust: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      skipFonts: false,
    }));
    expect(toBlobSpy).toHaveBeenNthCalledWith(2, root, expect.objectContaining({
      cacheBust: true,
      pixelRatio: 1,
      skipFonts: true,
    }));
    const compatFilter = toBlobSpy.mock.calls[1][1].filter as (node: HTMLElement) => boolean;
    expect(compatFilter(root.querySelector('[data-kind="content"]') as HTMLElement)).toBe(true);
    expect(compatFilter(root.querySelector('[data-kind="same-origin-image"]') as HTMLElement)).toBe(true);
    expect(compatFilter(root.querySelector('[data-kind="remote-image"]') as HTMLElement)).toBe(false);
    expect(compatFilter(root.querySelector('[data-kind="video"]') as HTMLElement)).toBe(false);
    expect(compatFilter(root.querySelector('[data-kind="audio"]') as HTMLElement)).toBe(false);
    expect(compatFilter(root.querySelector('[data-kind="frame"]') as HTMLElement)).toBe(false);
    expect(compatFilter(root.querySelector('[data-kind="canvas"]') as HTMLElement)).toBe(false);
    expect(compatFilter(root.querySelector('[data-kind="report-ui"]') as HTMLElement)).toBe(false);
  });
});
