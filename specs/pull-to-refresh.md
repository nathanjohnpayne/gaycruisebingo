---
spec_id: pull-to-refresh
status: accepted
---

# Pull-to-refresh: the PWA refresh gesture (`pull-to-refresh`)

Pull down from the top of any tab and release past the threshold to reload the app. Guarded by `src/components/pull-to-refresh.test.tsx`.

## Why a reload, not a refetch

Every surface in this app is a live Firestore listener—there is no stale list to refetch. What the installed-PWA gesture is FOR here is the reload itself: it reconnects listeners wedged by ship WiFi and picks up a freshly deployed version (the same action as the update toast's Reload, without waiting for the toast). `PullToRefresh` (src/components/PullToRefresh.tsx) mounts ONCE at the app shell (App.tsx), so all four tabs share one gesture surface; the signed-out screen has no shell and no gesture.

## Gesture contract

Constants and the resistance curve live in `src/game/motion.ts`: `PTR_THRESHOLD_PX` (70—release at or past this refreshes), `PTR_MAX_PULL_PX` (110—indicator travel cap), `PTR_SLOP_PX` (8—dead zone), and `pullProgress(rawDy)` (linear 0.45 resistance, capped, zero-clamped—reaching the threshold takes ~156px of finger travel, a deliberate commit).

The gesture arms only when the page is at the very top (`scrollY <= 0`) at touchstart, and never from inside an overlay (`.sheet-backdrop`, `.celebrate`, `.bug-report-pick`)—sheets own their own scroll. After the slop dead zone, a direction gate commits only to a downward-dominant drag (`dy > slop`, `dy > |dx|`, still at top); horizontal swipes stay with the Day/theme carousels and upward swipes with normal scrolling. The non-passive `touchmove` listener exists ONLY between an arming touchstart and that touch's end/cancel/disarm (Codex P2 on #432—a permanent `{passive: false}` window listener would tax every scroll app-wide), and while attached it calls `preventDefault` only once engaged; `html { overscroll-behavior-y: contain }` keeps the browser's own native pull-to-refresh and rubber-band chaining from answering the same gesture. Release below the threshold snaps back and reloads nothing; `touchcancel` ABORTS—the system stealing the touch is not a release, however far the pull traveled (Codex P2 on #432); release at/past the threshold holds the ring, spins, and fires the refresh after ~450ms so the spin is seen.

**The refresh activates a waiting worker first** (Codex P2 on #432). Under `registerType: 'prompt'` a fresh deploy's service worker sits WAITING, and a bare reload serves the OLD precache—the opposite of the gesture's promise. `refreshApp` (exported, injectable `reload` for tests) posts `SKIP_WAITING` to a waiting worker (the generateSW bundle's stock handler—the same activation the update toast's `updateServiceWorker(true)` performs) and reloads on `controllerchange`, with a bounded ~1.5s fallback so a wedged worker can't strand the gesture; no waiting worker or no SW API is a plain reload. `onRefresh` remains injectable on the component; its default is `refreshApp()`.

## Indicator and motion

A theme-tokened life ring (`.ptr-ring`, Lucide `life-buoy` in `--primary` on a `--panel` disc) rides the drag via inline `--ptr-pull`/`--ptr-progress`, fading in with progress and winding up like a dial (rotation = progress × 270°). Crossing the threshold pops the icon (`ptr-pop`, `--ease-pop`) and colors the ring border; refreshing spins it (`ptr-spin`). Snap-back eases with `--ease-glide` only when not actively following the finger. All flourish animations sit ahead of the universal reduced-motion kill switch (specs/motion-polish.md) and collapse under it; the finger-following transform is an inline style, never an animation, so the gesture stays fully functional under reduced motion.

## Deliberate non-features

No per-surface refetch semantics, no spinner-while-network (the reload IS the refresh), no desktop affordance (no touch, no gesture), and no gesture on the signed-out screen.

## Test coverage

`src/components/pull-to-refresh.test.tsx`: the pure curve (monotonic, capped, zero-clamped, threshold reachable); the component contract with an injected `onRefresh` and synthetic touch events—fires after a past-threshold pull (fake timers), snaps back without firing below threshold, ignores gestures that start scrolled down / inside a sheet / horizontal-dominant, `touchcancel` aborts a past-threshold pull, the non-passive move listener appears only on arming and drops on disarm, announces "Refreshing" via the status span; `refreshApp`'s waiting-worker contract (no-SW and no-waiting plain reloads, SKIP_WAITING + controllerchange single-fire, bounded-timeout fallback); and the CSS pins (keyframes present ahead of the kill switch, `overscroll-behavior-y: contain` on html).
