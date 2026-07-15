// Remote force-reload floor (#342): public/build-floor.json carries an ISO
// timestamp; any client whose baked-in __BUILD_STAMP__ is OLDER than that floor
// force-activates its waiting service worker and reloads, without offering the
// usual UpdatePrompt choice. The floor ships inert (epoch) and is bumped by hand
// only when stale cached shells must be evicted fleet-wide (the 2026-07-15
// incident: a pre-custom-domain shell was still being served on the web.app
// origin months after migration). The file is deliberately NOT precached (the
// workbox glob excludes .json) and is fetched no-store, so a stale shell still
// reads the CURRENT floor.
import { probeTimeoutSignal } from './canonical-redirect';

/**
 * True when `buildStamp` is strictly older than the served floor. Fail-open on
 * every doubtful input — a malformed floor must never force-reload anyone:
 * both values must parse as real dates, and the comparison is numeric (never
 * lexicographic) so timezone-offset ISO forms compare correctly too.
 */
export function buildBelowFloor(buildStamp: string, floor: unknown): boolean {
  if (typeof floor !== 'string' || floor.trim() === '') return false;
  const buildMs = Date.parse(buildStamp);
  const floorMs = Date.parse(floor);
  if (!Number.isFinite(buildMs) || !Number.isFinite(floorMs)) return false;
  return buildMs < floorMs;
}

/**
 * The served floor, or null on any failure (offline, HTTP error, bad JSON) —
 * null means "no forced reload", the safe default. Cache-busted + no-store so
 * neither the HTTP cache nor a service worker can answer for the CDN.
 */
export async function fetchBuildFloor(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<string | null> {
  const { signal, cleanup } = probeTimeoutSignal(timeoutMs);
  try {
    const res = await fetchImpl(`/build-floor.json?ts=${Date.now()}`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const floor = (body as { floor?: unknown } | null)?.floor;
    return typeof floor === 'string' ? floor : null;
  } catch {
    return null;
  } finally {
    cleanup();
  }
}
