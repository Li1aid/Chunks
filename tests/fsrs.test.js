import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, bootstrap, currentRetrievability, RATING, W, DAY_MS } from '../web/js/fsrs.js';

const NOW = 1_757_000_000_000;
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (±${eps})`);
const newCard = { stability: 0, difficulty: 0, state: 0, lapses: 0, lastReviewMs: 0 };

// 常数性质:desiredRetention=0.9、F=19/81、C=-0.5 时 interval == stability(≥1 时),
// 且 t == S 时 R 恰好等于 0.9。以下期望值均由公式手算。

test('first review: good uses W[2]/D0 formula, interval == stability', () => {
  const r = schedule(newCard, RATING.good, NOW);
  close(r.stability, 3.173);
  close(r.difficulty, 5.28245);
  assert.equal(r.state, 1);
  assert.equal(r.lapses, 0);
  close(r.intervalDays, 3.173);
  assert.equal(r.dueMs, NOW + r.intervalDays * DAY_MS);
  assert.equal(r.lastReviewMs, NOW);
  assert.equal(r.updatedAtMs, NOW);
});

test('first review: easy', () => {
  const r = schedule(newCard, RATING.easy, NOW);
  close(r.stability, 15.69105);
  close(r.difficulty, 3.2245);
  close(r.intervalDays, 15.69105);
  assert.equal(r.lapses, 0);
});

test('first review: forgot clamps interval to 1 day and counts a lapse', () => {
  const r = schedule(newCard, RATING.forgot, NOW);
  close(r.stability, 0.40255);
  close(r.difficulty, 7.1949);
  assert.equal(r.lapses, 1);
  assert.equal(r.state, 1);
  assert.equal(r.intervalDays, 1);
});

test('subsequent good at R=0.9 multiplies stability by alpha≈3.508, difficulty stays at D0(good)', () => {
  const card = { stability: 3.173, difficulty: 5.28245, state: 1, lapses: 0, lastReviewMs: NOW - 3.173 * DAY_MS };
  const r = schedule(card, RATING.good, NOW);
  close(r.stability, 11.131, 0.05);
  close(r.difficulty, 5.28245);
  assert.equal(r.lapses, 0);
  assert.equal(r.state, 1);
});

test('subsequent forgot shrinks stability (S_f formula) and bumps lapses', () => {
  const card = { stability: 3.173, difficulty: 5.28245, state: 1, lapses: 0, lastReviewMs: NOW - 3.173 * DAY_MS };
  const r = schedule(card, RATING.forgot, NOW);
  close(r.stability, 1.067, 0.02);
  assert.equal(r.lapses, 1);
  assert.ok(r.stability < card.stability);
});

test('easy bonus makes stability grow faster than good', () => {
  const card = { stability: 3.173, difficulty: 5.28245, state: 1, lapses: 0, lastReviewMs: NOW - 3.173 * DAY_MS };
  assert.ok(schedule(card, RATING.easy, NOW).stability > schedule(card, RATING.good, NOW).stability);
});

test('bootstrap: untouched card stays new', () => {
  assert.deepEqual(bootstrap({ reps: 0, intervalMs: 0, ease: 2.5 }), { stability: 0, difficulty: 0, state: 0 });
});

test('bootstrap: SM-2 card maps interval→stability, ease→difficulty', () => {
  const b = bootstrap({ reps: 3, intervalMs: 10 * DAY_MS, ease: 2.5 });
  close(b.stability, 10);
  close(b.difficulty, 6.2);
  assert.equal(b.state, 1);
  // interval < 1 天时 stability 保底 1
  close(bootstrap({ reps: 1, intervalMs: 0.2 * DAY_MS, ease: 1.3 }).stability, 1);
});

test('currentRetrievability: new card uses virtual stability W[2] from createdAt', () => {
  const r = currentRetrievability({ state: 0, stability: 0, lastReviewMs: 0, createdAtMs: NOW - W[2] * DAY_MS, nowMs: NOW });
  close(r, 0.9);
  // 刚创建的新卡 R≈1,不会进队列
  const fresh = currentRetrievability({ state: 0, stability: 0, lastReviewMs: 0, createdAtMs: NOW, nowMs: NOW });
  close(fresh, 1);
});

test('currentRetrievability: reviewed card uses its own stability from lastReview', () => {
  const r = currentRetrievability({ state: 1, stability: 10, lastReviewMs: NOW - 10 * DAY_MS, createdAtMs: 0, nowMs: NOW });
  close(r, 0.9);
});

test('interval clamps at 36500 days', () => {
  const card = { stability: 36500, difficulty: 1, state: 1, lapses: 0, lastReviewMs: NOW - 400 * DAY_MS };
  const r = schedule(card, RATING.easy, NOW);
  assert.ok(r.intervalDays <= 36500);
  assert.ok(r.stability <= 36500);
});
