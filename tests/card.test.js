import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateId, makeCard, normalizeEn } from '../web/js/card.js';

const NOW = 1_757_000_000_000;

test('generateId: 13-digit ms timestamp + 6 chars of [a-z0-9]', () => {
  assert.match(generateId(), /^\d{13}-[a-z0-9]{6}$/);
  assert.notEqual(generateId(), generateId());
});

test('makeCard: defaults match the sync schema', () => {
  const c = makeCard({ en: 'curb', zh: '路缘', nowMs: NOW });
  assert.match(c.id, /^\d{13}-[a-z0-9]{6}$/);
  assert.equal(c.en, 'curb');
  assert.equal(c.zh, '路缘');
  assert.equal(c.example, '');
  assert.equal(c.usage, '');
  assert.equal(c.sourceZh, '');
  assert.equal(c.sourceEn, '');
  assert.equal(c.createdAt, NOW);
  assert.equal(c.ease, 2.5);
  assert.equal(c.interval, 0);
  assert.equal(c.reps, 0);
  assert.equal(c.due, NOW);
  assert.equal(c.lastReview, 0);
  assert.equal(c.deleted, false);
  assert.equal(c.updatedAt, NOW);
  assert.equal(c.stability, 0);
  assert.equal(c.difficulty, 0);
  assert.equal(c.state, 0);
  assert.equal(c.lapses, 0);
  assert.equal(Object.keys(c).length, 19); // 18 业务字段 + id
});

test('makeCard: optional fields pass through', () => {
  const c = makeCard({ en: 'figure out', zh: '搞清楚', example: 'I figured it out.', sourceZh: '我搞清楚了', sourceEn: 'I figured it out.', nowMs: NOW });
  assert.equal(c.example, 'I figured it out.');
  assert.equal(c.sourceZh, '我搞清楚了');
  assert.equal(c.sourceEn, 'I figured it out.');
});

test('normalizeEn: lowercase, collapse whitespace, strip edge punctuation', () => {
  assert.equal(normalizeEn('  Figure   OUT!! '), 'figure out');
  assert.equal(normalizeEn('(curb)'), 'curb');
  assert.equal(normalizeEn('Make up one’s mind'), 'make up one’s mind');
  assert.equal(normalizeEn('"gate"'), 'gate');
  assert.equal(normalizeEn(''), '');
});

test('normalizeEn: keeps inner apostrophes and hyphens', () => {
  assert.equal(normalizeEn("don't give up."), "don't give up");
  assert.equal(normalizeEn('state-of-the-art,'), 'state-of-the-art');
});
