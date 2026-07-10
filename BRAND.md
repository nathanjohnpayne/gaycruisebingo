# Gay Cruise Bingo — brand & naming

**Gay Cruise Bingo** is a live, multiplayer bingo PWA played with friends on a gay cruise — one sailing at a time. The product name *is* the app; there are no sub-brand "surfaces." Live at <https://gaycruisebingo.web.app>.

## Vocabulary

The domain's ubiquitous language — Event, Board, Square, Mark, Tally, Feed, Moment, Claim Mode, and the rest — is defined once in [`CONTEXT.md`](CONTEXT.md). Use those terms and don't coin synonyms (each entry lists the words to avoid). Product overview: [`README.md`](README.md).

## Themes

The app reskins into one of eight Atlantis party looks (Neon Playground is the default) — the theme ids live in `src/theme/themes.ts`. Themes are cosmetic only.

## Relationship to mergepath

Gay Cruise Bingo is a downstream **consumer** of the [mergepath](https://github.com/nathanjohnpayne/mergepath) template — the canonical implementation of the AI Agent Tooling Standard ([`ai_agent_tooling_standard.md`](ai_agent_tooling_standard.md)) for this account. This repo is not the template hub, nor its reference implementation; it inherits mergepath's governance (review policy, deploy tooling, agent docs) and builds the bingo app on top.
