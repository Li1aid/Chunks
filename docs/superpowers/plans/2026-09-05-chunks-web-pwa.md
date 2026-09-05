# Chunks Web PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the zero-build vanilla-JS PWA client of Chunks under `web/`, feature-parity with the iOS app, against the existing Cloudflare Worker.

**Architecture:** Static single page, four tab views as isolated ES modules over shared service modules (db/settings/sync/ai/fsrs/speech). Pure logic (FSRS, card helpers, LWW merge, AI response parsing) lives in browser-API-free modules so `node --test` covers it; browser glue stays thin.

**Tech Stack:** Vanilla JS (ES modules), IndexedDB, localStorage, Service Worker, SpeechSynthesis. No npm dependencies, no build step. Tests via `node --test` (node ≥ 18).

**Spec:** `docs/superpowers/specs/2026-09-05-chunks-web-pwa-design.md` — all behavioral details (field lists, endpoints, prompts, queue rules, UI copy) are normative there; tasks below cite sections as §N.

## Global Constraints

- Zero runtime dependencies; `web/` is the literal deploy artifact; `tests/` stays outside it.
- All timestamps are epoch milliseconds (JS `number`).
- UI copy is copied verbatim from the iOS views (Chinese strings in spec §5–§9).
- The two AI system prompts are copied byte-for-byte from `Chunks/Services/AIService.swift`.
- Card id format: `${Date.now()}-${6 chars of [a-z0-9]}`.
- Commit messages in English, Conventional Commits. Never push without an explicit user ask.
- Deviation from spec §3 file list (agreed refinement): pure helpers split into `js/card.js` and `js/merge.js` so they are node-testable; `views/settings.js` is the view, `js/settings.js` the storage module.

---

### Task 1: FSRS port (`web/js/fsrs.js` + `tests/fsrs.test.js`)

**Files:** Create both. Port `Chunks/Services/FSRSScheduler.swift` line-by-line.

**Produces (exact API):**
- `RATING = { forgot: 1, mid: 2, good: 3, easy: 4 }`
- `W` (19 params), `DESIRED_RETENTION = 0.9`, `DAY_MS = 86400000`
- `schedule(card, rating, nowMs)` → `{ stability, difficulty, state, lapses, dueMs, lastReviewMs, updatedAtMs, intervalDays }`; `card` needs `{ stability, difficulty, state, lapses, lastReviewMs }`
- `bootstrap(card)` → `{ stability, difficulty, state }`; `card` needs `{ reps, intervalMs, ease }`
- `currentRetrievability({ state, stability, lastReviewMs, createdAtMs, nowMs })` → number
- `displayInterval(days)` → `"1 天后" / "N 天后" / "N 个月后" / "N 年后"`

- [x] **Step 1: failing tests.** Hand-derived vectors (constants make `intervalDays === stability` when ≥ 1, and R at t=S is exactly 0.9):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, bootstrap, currentRetrievability, RATING, W, DAY_MS } from '../web/js/fsrs.js';

const NOW = 1_757_000_000_000;
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const newCard = { stability: 0, difficulty: 0, state: 0, lapses: 0, lastReviewMs: 0 };

test('first review: good', () => {
  const r = schedule(newCard, RATING.good, NOW);
  close(r.stability, 3.173); close(r.difficulty, 5.28245);
  assert.equal(r.state, 1); assert.equal(r.lapses, 0);
  close(r.intervalDays, 3.173); assert.equal(r.dueMs, NOW + r.intervalDays * DAY_MS);
});
test('first review: easy / forgot', () => {
  const e = schedule(newCard, RATING.easy, NOW);
  close(e.stability, 15.69105); close(e.difficulty, 3.2245); close(e.intervalDays, 15.69105);
  const f = schedule(newCard, RATING.forgot, NOW);
  close(f.stability, 0.40255); close(f.difficulty, 7.1949);
  assert.equal(f.lapses, 1); assert.equal(f.intervalDays, 1); // clamped low
});
test('subsequent good at R=0.9 multiplies stability by alpha≈3.508, difficulty stable', () => {
  const card = { stability: 3.173, difficulty: 5.28245, state: 1, lapses: 0, lastReviewMs: NOW - 3.173 * DAY_MS };
  const r = schedule(card, RATING.good, NOW);
  close(r.stability, 11.13, 0.05); close(r.difficulty, 5.28245); assert.equal(r.lapses, 0);
});
test('subsequent forgot shrinks stability, bumps lapses', () => {
  const card = { stability: 3.173, difficulty: 5.28245, state: 1, lapses: 0, lastReviewMs: NOW - 3.173 * DAY_MS };
  const r = schedule(card, RATING.forgot, NOW);
  close(r.stability, 1.067, 0.02); assert.equal(r.lapses, 1);
  assert.ok(r.stability < card.stability);
});
test('bootstrap from SM-2', () => {
  assert.deepEqual(bootstrap({ reps: 0, intervalMs: 0, ease: 2.5 }), { stability: 0, difficulty: 0, state: 0 });
  const b = bootstrap({ reps: 3, intervalMs: 10 * DAY_MS, ease: 2.5 });
  close(b.stability, 10); close(b.difficulty, 6.2); assert.equal(b.state, 1);
});
test('currentRetrievability: virtual stability for new cards', () => {
  close(currentRetrievability({ state: 0, stability: 0, lastReviewMs: 0, createdAtMs: NOW - W[2] * DAY_MS, nowMs: NOW }), 0.9);
  close(currentRetrievability({ state: 1, stability: 10, lastReviewMs: NOW - 10 * DAY_MS, createdAtMs: 0, nowMs: NOW }), 0.9);
});
```

- [x] **Step 2:** `node --test tests/fsrs.test.js` → FAIL (module missing).
- [x] **Step 3:** implement per spec §7 (W table, first/subsequent review, clamps [1, 36500] interval, stability [0.01, 36500], difficulty [1,10], mean-reversion via `d0(3)`).
- [x] **Step 4:** tests PASS.
- [x] **Step 5:** `git commit -m "feat(web): port FSRS-4.5 scheduler with node tests"`

### Task 2: Card helpers (`web/js/card.js` + `tests/card.test.js`)

**Produces:** `generateId()`, `makeCard({ en, zh, example?, usage?, sourceZh?, sourceEn?, nowMs? })` → full 18-field object with spec §4 defaults, `normalizeEn(s)`.

- [x] Tests first:

```js
test('id format', () => assert.match(generateId(), /^\d{13}-[a-z0-9]{6}$/));
test('makeCard defaults', () => {
  const c = makeCard({ en: 'curb', zh: '路缘', nowMs: NOW });
  assert.equal(c.ease, 2.5); assert.equal(c.due, NOW); assert.equal(c.createdAt, NOW);
  assert.equal(c.updatedAt, NOW); assert.equal(c.deleted, false); assert.equal(c.state, 0);
});
test('normalizeEn', () => {
  assert.equal(normalizeEn('  Figure   OUT!! '), 'figure out');
  assert.equal(normalizeEn("don't give up."), "don't give up"); // inner apostrophe kept
  assert.equal(normalizeEn('(curb)'), 'curb');
  assert.equal(normalizeEn('Make up one’s mind'), 'make up’s mind'.replace('up’s', "up one’s"));
});
```

  (normalize: lowercase → collapse whitespace → strip only leading/trailing chars from `.,;:!?"'\`()[]{}`.)
- [x] Fail → implement → pass → `git commit -m "feat(web): card factory and dedup normalization"`

### Task 3: LWW merge (`web/js/merge.js` + `tests/merge.test.js`)

**Produces:** `mergeRemote(localCards, remoteCards)` → `{ toWrite: card[], changed: number }`. Remote dict may miss FSRS keys (default 0) and uses `deleted` boolean; strict `remote.updatedAt > local.updatedAt` wins; unknown id → insert.

- [x] Tests: remote-newer overwrites (incl. `deleted:true`), local-newer kept, tie → local, new id inserted, missing FSRS keys default to 0.
- [x] Fail → implement → pass → `git commit -m "feat(web): LWW merge for sync pull"`

### Task 4: AI module (`web/js/ai.js` + `tests/ai.test.js`)

**Produces:** `detectDirection(text)` → `'zhToEn' | 'enToZh'` (CJK U+4E00–9FFF, U+3400–4DBF); `parseTranslationJSON(text)` → `{ translation, phrases }` or throw; `translate(text, cfg)` → `{ result, direction }` where `cfg = { workerURL, token, provider, model }` (fetch injected implicitly via global; no browser storage access inside the module). Prompts copied verbatim from AIService.swift; request bodies per spec §6.

- [x] Node tests for `detectDirection` (中文/English/mixed→zhToEn) and `parseTranslationJSON` (plain JSON, ```json fence, prose-wrapped `{...}`, garbage throws).
- [x] Fail → implement → pass → `git commit -m "feat(web): AI translate module with provider protocols"`

### Task 5: Shell + PWA chrome

**Files:** `web/index.html`, `web/css/app.css`, `web/js/app.js`, `web/manifest.webmanifest`, `web/sw.js`, `web/icons/*` (reuse `~/Desktop/Projects/yuyukai/icon.svg`, rasterize 512/192/180 via `qlmanage -t` or `sips`).

Four `<section>` panels + bottom tab bar (翻译/卡片/复习/设置, inline SVG icons); `app.js` owns tab switching and calls each view's `show()` on activation; dark/light via CSS custom props + `prefers-color-scheme`; `sw.js` per spec §11 (versioned precache `chunks-v1`, cache-first same-origin static, network passthrough elsewhere, old-cache cleanup on activate); registration + `navigator.storage.persist()` attempt in `app.js`.

- [x] Build shell; verify by serving `python3 -m http.server -d web` and curling `/`, manifest, sw.js (200s, correct MIME sanity).
- [x] `git commit -m "feat(web): app shell, tab bar, manifest and service worker"`

### Task 6: Browser glue — `web/js/db.js`, `web/js/settings.js`, `web/js/speech.js`

**Produces:**
- `db.js`: `openDB()`, `getAllCards()`, `putCard(c)`, `putCards(cs)`, `clearCards()` (IndexedDB `chunks/cards`, keyPath `id`).
- `settings.js`: get/set for the 9 keys of spec §4 with defaults (provider default from `navigator.language` rule; models per provider), `isConfigured()`.
- `speech.js`: `speak(text)` (cancel-then-speak, rate 0.9), `refreshVoice()`, `voiceLabel()`; voice pick per spec §10 heuristic, `voiceschanged`-aware.

- [x] Implement (thin, no unit tests — covered by E2E); `git commit -m "feat(web): storage, settings and speech modules"`

### Task 7: Sync engine (`web/js/sync.js`)

**Produces:** `syncNow()`, `scheduleSync(delayMs = 1500)`, `resetSync()`, `softDelete(id)`, `onStatus(cb)`; status objects `{ kind: 'idle'|'syncing'|'success'|'failed', at?, message? }` rendering the spec §5 strings. Implements dual-cursor pull→merge(Task 3)→push(batch 500) with error mapping (401→口令错误,请检查 …), re-entry guard, load/visibilitychange triggers wired in `app.js`.

- [x] Implement; manual check against live worker deferred to Task 12 (needs token).
- [x] `git commit -m "feat(web): dual-cursor LWW sync engine"`

### Task 8: Translate view (`web/views/translate.js`)

Textarea + 翻译 button + result card (speaker when zhToEn) + saved banner + phrase list + error card with 重试 — behavior and copy per spec §6; auto-save via `makeCard`/`normalizeEn` dedup against `getAllCards()` + batch-seen set; `scheduleSync()` after writes.

- [x] Implement; `git commit -m "feat(web): translate tab with auto-save dedup"`

### Task 9: Library view (`web/views/library.js`)

Search + createdAt-desc list + per-row delete (confirm → `softDelete`) + due text/color rules + empty states, per spec §8.

- [x] Implement; `git commit -m "feat(web): library tab"`

### Task 10: Review view (`web/views/review.js`)

Queue/stats/session per spec §7 (R<0.9 asc, cap 30, min 10 gate, stats trio); flashcard flip (CSS 3D), Pointer Events drag (horizontal-dominant, 120px threshold, fly-out, edge glow ±dx/120), rating writeback incl. bootstrap + legacy `interval`/`reps`; direction toggle.

- [x] Implement; `git commit -m "feat(web): review tab with FSRS gestures"`

### Task 11: Settings view (`web/views/settings.js`)

Six sections per spec §9; save flow (trim/strip slashes, masked token placeholder, trigger sync); provider/model pickers with per-provider memory; sync status via `onStatus`; 重置同步 confirm; voice row + refresh; card count.

- [x] Implement; `git commit -m "feat(web): settings tab"`

### Task 12: Integration pass

- [x] `node --test tests/` all green.
- [x] Static integrity script (`tests/precache-check.mjs`, plain node): every path in `sw.js` PRECACHE list and every `src/href` in index.html exists in `web/`; run it in the same test command.
- [x] Serve locally, walk the four tabs in a desktop browser via curl-level checks (page loads, modules 200). Real-device + live-worker E2E happens after deploy with Aiden's token (spec §12 checklist).
- [x] `git commit -m "test(web): integration checks"` (if files changed)

### Task 13: Deploy to Cloudflare Pages

- [x] `npx wrangler whoami` — if already authenticated (worker was deployed from this machine before), run `npx wrangler pages deploy web --project-name chunks-web` directly; otherwise hand Aiden the one-time `npx wrangler login` step, then deploy.
- [x] Post-deploy verification per ship-flow: curl the deployed URL for `/`, `manifest.webmanifest`, `sw.js`; then hand Aiden the URL + phone checklist (add to home screen, fill settings, translate → sync → review, cross-check a card on iOS).

## Self-Review

- Spec coverage: §1–§14 all mapped (§2 needs no code; §13 = Task 13; §14 is exclusions).
- No placeholders; interfaces named consistently (`makeCard`/`normalizeEn`/`mergeRemote`/`syncNow`/`scheduleSync`/`softDelete` used identically across Tasks 2/3/7/8/9/10).
- Types consistent: cards use the 18-field shape of spec §4 everywhere; FSRS card snapshot uses `lastReviewMs`/`intervalMs` only inside `fsrs.js` (mapping done at call sites in Task 10).
