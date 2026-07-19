---
spec_id: motion-polish
status: accepted
---

# Motion polish: the slot-machine animation pass (`motion-polish`)

A single motion vocabulary across the app—deal, stamp, payline, jackpot—so playing feels like pulling a very friendly slot machine. The system lives in `src/index.css` § "motion" (keyframes + wiring) with the per-element numbers in `src/game/motion.ts` (pure, unit-testable). Guarded by `src/components/motion-polish.test.tsx`.

## Principles

**Theme-tokened, never literal.** Every animated color reads the active Theme's tokens (`--primary`/`--secondary`/`--accent`/`--ink`/`--shadow`), so all eight Themes retint the whole motion system for free—including the confetti.

**Two easings, one machine.** `--ease-pop` (springy overshoot: marks, letters, toasts, tab hops) and `--ease-glide` (fast-out settle: sheets, pages, list rows), both defined on `:root`. New animations pick one of these rather than minting bespoke curves.

**Entrances only.** Sheets, toasts, pages, and list rows animate IN; nothing delays an unmount (exit choreography would hold stale content on screen and fight the render-time sheet-close guards Board relies on).

**Bounded.** Entrances run 200–550ms; staggered cascades cap under ~700ms of total delay (the deal's slowest Square starts at 340ms; list rows cap at the 8th child's 315ms slot).

## The inventory

- **Deal cascade** (`deal-drop`): Squares tumble in column-by-column, top-to-bottom—reels settling. Delay per Square is `dealDelayMs(index)` (60ms/column + 25ms/row), passed as `--deal-delay`. The cascade plays once per board identity (`uid` + viewed Day + `seed`) per session: the grid remounts on the keyed identity, and a module-scope played-set survives the router unmounting Board on tab switches, so a Day switch, a reshuffle, an account switch, or a fresh page load re-deals visually while a mere tab round-trip mounts the card landed (`.grid-dealt` zeroes the entrance). The B-I-N-G-O header letters ride the same cascade via `nth-child` and follow the same once-per-board contract (Board keys and gates the header exactly like the grid). The locked preview's `.locked-grid` is excluded—a locked Day feels parked, not live.
- **Mark stamp** (`cell-stamp` + `check-pop`): a freshly-marked Square punches in with overshoot and its ✓ pops behind it. Board edge-detects rising marks between attributable snapshots (`.just-marked`, cleared on `animationend`); the first attributable snapshot per board identity is a baseline, so standing marks never re-stamp on reload, Day switch, or account switch.
- **Payline sweep** (`win-glow`): winning-line Squares shimmer in sequence—`winOrder` maps each cell to its position along its own completed line (earliest position when lines share a cell), consumed as `--win-order`. Per-line positions cap every delay at 4 steps (440ms), so a multi-line win—blackout included—sweeps its lines independently instead of queuing one board-wide ramp. Replaces the old uniform `.cell.win` pulse.
- **Jackpot celebration** (`celebrate-in`, `letter-slam`, `rise-in`, `confetti-fall`): the backdrop washes in, the hero word slams down letter-by-letter (letters `aria-hidden`; the intact word stays in a `.visually-hidden` span so screen readers hear one word and the e2e `.big` text locators keep matching), the copy and actions rise after, and theme-colored confetti rains—`CONFETTI_COUNT_BINGO` pieces for a BINGO, `CONFETTI_COUNT_BLACKOUT` for a blackout. Board keys the mount by win kind, so a BINGO celebration upgraded to a blackout remounts and restarts the burst at jackpot size (the burst is a mount-time lazy initializer).
- **Sheets and toasts** (`sheet-up`/`backdrop-in`, `toast-in`): every `.sheet` glides up over a fading scrim; the install/update toasts bounce up from the tab bar. No fill mode, so a finished entrance can never override later inline styles.
- **Lists** (`row-in`): Ranks rows, Feed cards, who-lists, and admin rows cascade in via CSS `nth-child` staggers—no per-surface JS. Children past the 8th share the last delay slot.
- **Page transitions** (`page-in`): the incoming tab's page fades in; App keys `.route-view` on the top-level route segment so sub-navigation (More → admin) never replays it. Opacity only, deliberately no transform: an animating transform would make the wrapper the containing block for `position: fixed` descendants, and overlays that mount with the page (the coach overlay on a first Card entry, the admin sheet on a direct `/more/admin` load) would anchor to the route content instead of the viewport for the entrance's duration.
- **Tactility**: `.btn`, `.tab`, `.day-chip`, `.reshuf`, and `.more-row` compress under the thumb (`:active` scale) with smooth state transitions; the active tab's glyph hops (`tab-hop`); the scoreboard counts pop when their value changes (`.stat-pop`, keyed spans).
- **Flourishes**: the locked Day's padlock bobs (`lock-bob`); the farewell podium's medals take a one-time bow (`medal-pop`).

## Reduced motion

One universal kill switch (index.css, end of the motion section) instead of per-animation opt-outs, so a future animation can never ship uncovered—the pre-pass block only caught the loading spinner and free-space pulse, and `.cell.win`'s throb slipped it entirely. Under `prefers-reduced-motion: reduce`, animation/transition durations clamp to a frame and delays zero (not `animation: none`, so fill-mode entrances still resolve to their landed state and delayed Squares never stay invisible). Stillness gets substitutes where it needs them: the winning line keeps a static accent ring, and the confetti layer is dropped (`display: none`); Celebration additionally skips rendering the layer at all when the preference is set.

## Deliberate non-animations

The off-screen `.share-card-*` DOM never animates—html-to-image would rasterize a mid-animation frame into the shared image. The locked preview grid never deals. Unmarking a Square is a quiet correction, not a celebration—no reverse stamp.

## Test coverage

`src/components/motion-polish.test.tsx`: the pure timing helpers (delay bounds and ordering, win order, deterministic confetti with an injected random and token-only colors), Celebration's hero/letter/confetti DOM contract (including the reduced-motion gate via a stubbed `matchMedia`), and the index.css structural contract (keyframes present, the kill switch present and covering the win-line substitute and confetti drop, the share-card and locked-grid exclusions). Visual behavior itself is verified by eye and by the existing e2e flows, which exercise the animated surfaces with Playwright's actionability waits.
