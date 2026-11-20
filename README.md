# Chunks

An English-learning app that starts from the sentence you just couldn't say.

<img src="https://aidenyang.me/Assets/chunks-poster.svg" width="720">

**Status:** native iOS app + web PWA, both in this repo
**Try it:** [chunks-demo.aidenyang.me](https://chunks-demo.aidenyang.me) (or [chunks-web.pages.dev/?demo](https://chunks-web.pages.dev/?demo)) — public demo with sample cards. Translations use the real AI, limited per day; demo data stays on your device and never syncs.
**Case study:** [aidenyang.me/projects/chunks.html](https://aidenyang.me/projects/chunks.html) — includes a working demo

## What it does

1. You type a Chinese sentence — the thing you wanted to say but couldn't.
2. Chunks returns natural English and pulls out the reusable phrases ("chunks").
3. Each phrase becomes a flashcard automatically. No save button.
4. Tap a phrase to see where it came from — the matching words light up in both your sentence and the translation.
5. Cards come back for review on a spaced-repetition schedule (FSRS). Each day the app picks the cards you're about to forget; tap to see the meaning, swipe right if you knew it, left if you didn't. After each swipe it shows when the card will come back.
6. The card library is grouped by day, and the review screen shows how many cards are due over the next 7 days.

## Why I built it

Vocabulary apps teach words you never use. Translators give you the sentence and you forget it. Flashcard apps work, but nobody makes the cards. The moment you fail to say something is the best moment to learn it — Chunks is built to catch that moment.

## How it works

- **App** — SwiftUI + SwiftData. Four tabs: Translate, Cards, Review, Settings.
- **Web** — the same four tabs as a zero-build vanilla-JS PWA (`web/`): IndexedDB storage, same FSRS and sync protocol, deployable to any static host. iOS 26-style UI (floating glass tab bar, swipe actions), light and dark mode.
- **Demo mode** — the `chunks-demo.` host (or `?demo`) switches the web app to a separate local database seeded with sample cards, uses a public demo token on the Worker (translation and speech only, per-IP daily limits), and turns sync off.
- **AI** — one Claude call per sentence returns the translation and 1–4 phrases as JSON, each with the exact span it came from in the input (`src`) and in the translation (`dst`) for the linked highlight.
- **Backend** — a single Cloudflare Worker proxies the AI provider (keys stay server-side) and syncs cards to D1.
- **Sync** — offline-first, last-write-wins by timestamp, soft deletes so every device learns about removals.
- **Scheduling** — FSRS on iOS and the web PWA; an older, separate PWA used a simplified three-grade SM-2.

## Deploy

Pushing to `main` deploys automatically (`.github/workflows/deploy.yml`): tests run, then the Worker (`worker/`) and the web app (`web/` → Cloudflare Pages `chunks-web`) are published. The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Worker secrets (`ALLOWED_TOKEN`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`) live in Cloudflare and are not touched by deploys.

## Run it locally

1. Open `Chunks.xcodeproj` in Xcode.
2. Set your own Development Team under *Signing & Capabilities*.
3. Build for iPhone, iPad, Mac, or a simulator.
4. Enter your Worker URL and app token in *Settings* (stored in the Keychain).

No API keys, tokens, or personal learning data are committed to this repository.

## Layout

```
Chunks/
  ChunksApp.swift        entry point
  Models/                SwiftData models (Card)
  Services/              AI service, cloud sync, keychain, FSRS scheduler
  Views/                 Tabs: Translate, Library, Review, Settings
worker/                  Cloudflare Worker: AI proxy, card sync (D1), TTS, public demo
web/
  index.html             PWA shell (four tabs)
  js/                    fsrs, sync, ai, card, merge + one module per tab
  sw.js                  offline cache for static assets
tests/                   node --test suite for the pure logic (fsrs, merge, …)
```

The web version has no build step: serve `web/` with any static file server
(`python3 -m http.server -d web`), open it, and enter your Worker URL and
token in Settings. `node --test 'tests/*.test.js' tests/static-check.mjs`
runs the test suite.

## Decisions worth knowing

- **Auto scene-tagging was shipped, then removed.** In real use the AI labels drifted with the sentence's mood, and I only ever searched — so the tab, the field and half the prompt went.
- **Last-write-wins instead of CRDT.** One user, several devices: the merge is three lines per client and one `WHERE` on the server.
- **Chinese on the front of every card.** The goal is producing English, not recognising it.
