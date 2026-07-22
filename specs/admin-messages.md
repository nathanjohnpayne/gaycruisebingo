---
spec_id: admin-messages
status: accepted
---

# admin-messages — Notices: reusable admin-to-players messaging

Implements `plans/admin-messages-ticket.md` (issue #439), matching `plans/daily-cards-wireframes.html` frames `#frame-admin-messages` (compose + sent history, the sixth hub door), `#frame-feed-notice` (the pinned Notice as players see it), and the updated `#frame-admin-hub` (six doors). New feature — a data model, a rules block, one admin surface, and two player surfaces. No push notifications; delivery is the existing Firestore realtime + offline cache.

## Concept

A **Notice** is an admin-authored broadcast: a title and body the admin writes, optionally **pinned**. It is a first-class Feed citizen, not a chat — no recipients, no threading, no read receipts, no report counter. Glossary-distinct from a Moment (CONTEXT.md): a Moment announces a game beat and carries no authored copy; a Notice IS the admin's own words. Nothing in the model is specific to the first message — a future announcement, or the next cruise's, is simply a new document.

## Data model

`events/{eventId}/notices/{noticeId}` (`NoticeDoc`, `src/types.ts`):

- `title: string` — ≤ 60 chars (rules cap).
- `body: string` — ≤ 400 chars (rules cap).
- `uid, displayName` — the posting admin (attribution, Moment-style; `displayName` bounded to the ≤100 attribution contract via `markerDisplayName`).
- `createdAt: number` — ms epoch, client-set.
- `dayIndex?: number` — stamped at post time from the event's current Day (`defaultViewedIndex(event.days, now)`), so the Feed reads "📌 Nathan · Day 8". Optional so a schedule-less Event still posts.
- `pinned: boolean`.

The doc carries its own id on read (`noticeConverter` pins `id` to `snap.id`); the write path (`src/data/notices.ts`) uses raw refs and a Firestore auto-id. A Notice is MUTABLE (the pin toggle) and DELETABLE — unlike a Moment, which is create-once/immutable — so `postNotice` / `setNoticePinned` / `deleteNotice` are the three writers.

## Rules (`firestore.rules` § notices)

Inside `match /events/{eventId}`, a sibling of `moments`:

- `read`: any signed-in user (the delivery surface everyone watches).
- `create, update`: `isAdmin(eventId)` AND `title is string && title.size() <= 60` AND `body is string && body.size() <= 400` AND `pinned is bool`. Both create and update revalidate, because the pin toggle is an admin `update` and an `updateDoc({pinned})` merges the existing (already-valid) title/body into `request.resource.data`.
- `delete`: `isAdmin(eventId)`.

No owner-write path (a Notice belongs to the admin role, not one uid) and no report counter (admin-authored content is not player-reportable).

## Surfaces

### Admin → Messages (`/more/admin/messages`, `#frame-admin-messages`)

The sixth hub door (`Megaphone` icon, no badge) in `AdminHub.tsx`; `'messages'` joins the `ADMIN_SECTIONS` tuple (`route.ts`), `SECTION_TITLES.messages = 'Messages'` and the render guard join `Admin.tsx`, and the section inherits the whole `AdminSheet` navigation-and-dismissal contract (Done / back / Escape / backdrop) for free. `MessagesPanel.tsx`:

- **Compose** — a title field, a body textarea, a "Pin to Feed + show Card banner" toggle (default ON), and one "Post to everyone" button (disabled until both fields are non-empty). On a settled success the draft clears and the pin resets to on; a rejected post surfaces an inline `role="alert"` pill and KEEPS the draft (the `AdminAddItemForm` / #411 convention).
- **Sent history** — newest-first, each row showing the title and a "Day N · Name · 📌 pinned" line with quiet `Unpin`/`Pin` and `Delete` controls (`AsyncButton` — disables in flight, surfaces a failure pill).

### Feed (`#frame-feed-notice`)

`ProofFeed.tsx` `NoticeCard`: an accent-bordered, accent-tinted card. `mergeFeed` sorts PINNED Notices to the very top of the Feed (newest pinned first, above every Proof/Moment/Tally Card regardless of time); UNPINNED Notices interleave newest-first in the stream at their `createdAt`. Attribution follows the Moment convention — pinned wears "📌 Nathan · Day 8", unpinned drops the pin. This Feed copy is NOT dismissible: it is the durable record latecomers scroll to. (`#frame-feed-notice` draws a ✕ on the card; that ✕ is the Card-tab banner's affordance, not the Feed card's — the frame reuses one visual for both. The behavioral spec, and the acceptance criterion "the Feed copy remains", governs: the ✕ lives on the banner.)

### Card-tab banner (`NoticeBanner.tsx`)

While a Notice is pinned, the Card tab shows it once as a dismissible banner (✕) above the Board (mounted in `App.tsx`'s `card` page). Dismissal is PER-DEVICE — `localStorage`, keyed `gcb.notice.<id>.dismissedAt`, mirroring the CoachOverlay / InstallPrompt pattern (read/write fall open on a storage error) — and hides ONLY the banner; the Feed copy stays for latecomers. Of the pinned Notices (newest-first), the banner shows the newest one this device has not dismissed.

## Feed merge (`mergeFeed`, `src/hooks/useData.ts`)

`mergeFeed(proofs, moments, tallyCards, notices, max)`: pinned Notices form the masthead (filtered, sorted newest-first); everything else — proofs, moments, non-zero tally cards, and unpinned Notices — interleaves newest-first below; the concatenation is capped to `max`. With no Notices the output is byte-identical to the pre-Notice merge (the `notices` default is `[]`, contributing no entries) — the regression guard below pins this.

## Decisions (from the ticket, resolved)

- **Name** — "Notice" (glossary-distinct from Moment).
- **Dismissal persistence** — per-device `localStorage` (zero schema, matches theme/coach persistence; a cruise-length product favors local over per-user Firestore).
- **Multiple pins** — allowed; newest pinned first in both the Feed masthead and the banner selection.
- **First-Notice copy** — "Final stretch 🏁" / the final-days body, posted through the shipped UI (the feature's own acceptance test), not seeded by script.

## Analytics

None this wave. `track('notice_post')` / `track('notice_dismiss')` ship only if the analytics-catalog owner (#33) signs off; absent that, no analytics are wired.

## Tests (spec ↔ test alignment)

- **Rules** (`tests/rules/notices.test.ts`): any signed-in read allowed; non-admin create/update/delete denied; admin create/update/delete allowed; `title` > 60, `body` > 400, and non-boolean `pinned` each denied on create.
- **`mergeFeed` unit** (`src/data/w2-feed-moments.test.ts`): a pinned Notice sorts above newer Proofs/Moments; an unpinned Notice interleaves by `createdAt`; the `max` cap still holds; an empty-notices stream leaves the merge byte-identical to the pre-Notice output (regression guard).
- **Banner** (`src/components/NoticeBanner.test.tsx`): renders the newest pinned Notice while undismissed; ✕ writes the per-device key and hides it; a remount with the key present does not render (persist-across-reload), a different notice id still renders; dismissal never touches the Feed copy.
- **Admin IA** (`src/components/admin-console-ia.test.tsx`): the hub renders the Messages door and routes to `/more/admin/messages`, opening the "Messages" dialog under the existing dismissal contract.
- **MessagesPanel** (`src/components/MessagesPanel.test.tsx`): compose posts with title + body + pin and clears; `Unpin` flips `pinned` false; `Delete` removes the row from history.
