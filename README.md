# Chunks

An English-learning app that starts from the sentence you just couldn't say.

<img src="https://aidenyang.me/Assets/chunks-poster.svg" width="720">

**Status:** native iOS app + web PWA, both in this repo
**Case study:** [aidenyang.me/projects/chunks.html](https://aidenyang.me/projects/chunks.html) — includes a working demo

## What it does

1. You type a Chinese sentence — the thing you wanted to say but couldn't.
2. Chunks returns natural English and pulls out the reusable phrases ("chunks").
3. Each phrase becomes a flashcard automatically. No save button.
4. Cards come back for review on a spaced-repetition schedule (FSRS).

## Why I built it

Vocabulary apps teach words you never use. Translators give you the sentence and you forget it. Flashcard apps work, but nobody makes the cards. The moment you fail to say something is the best moment to learn it — Chunks is built to catch that moment.

## How it works

- **App** — SwiftUI + SwiftData. Four tabs: Translate, Cards, Review, Settings.
- **Web** — the same four tabs as a zero-build vanilla-JS PWA (`web/`): IndexedDB storage, same FSRS and sync protocol, deployable to any static host.
- **AI** — one Claude call per sentence returns the translation and 1–4 phrases as JSON.
- **Backend** — a single Cloudflare Worker proxies the AI provider (keys stay server-side) and syncs cards to D1.
- **Sync** — offline-first, last-write-wins by timestamp, soft deletes so every device learns about removals.
- **Scheduling** — FSRS on iOS and the web PWA; an older, separate PWA used a simplified three-grade SM-2.

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
