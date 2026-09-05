import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRemote } from '../web/js/merge.js';

const local = (over = {}) => ({
  id: 'a', en: 'curb', zh: '路缘', example: '', usage: '', sourceZh: '', sourceEn: '',
  createdAt: 100, ease: 2.5, interval: 0, reps: 0, due: 100, lastReview: 0,
  deleted: false, updatedAt: 500, stability: 2, difficulty: 5, state: 1, lapses: 0,
  ...over,
});

test('remote newer wins, including soft delete', () => {
  const remote = { id: 'a', en: 'curb', zh: '马路牙子', deleted: true, updatedAt: 900, createdAt: 100 };
  const { toWrite, changed } = mergeRemote([local()], [remote]);
  assert.equal(changed, 1);
  assert.equal(toWrite[0].zh, '马路牙子');
  assert.equal(toWrite[0].deleted, true);
  assert.equal(toWrite[0].updatedAt, 900);
});

test('local newer or tie: remote ignored', () => {
  const tie = { id: 'a', en: 'x', updatedAt: 500 };
  const older = { id: 'a', en: 'x', updatedAt: 499 };
  assert.equal(mergeRemote([local()], [tie]).changed, 0);
  assert.equal(mergeRemote([local()], [older]).changed, 0);
});

test('unknown id inserted with remote id preserved', () => {
  const remote = { id: 'b', en: 'gate', zh: '大门', updatedAt: 300, createdAt: 300 };
  const { toWrite, changed } = mergeRemote([local()], [remote]);
  assert.equal(changed, 1);
  assert.equal(toWrite[0].id, 'b');
  assert.equal(toWrite[0].en, 'gate');
});

test('missing keys default like iOS applyRemote: ease 2.5, FSRS fields 0, strings empty', () => {
  const remote = { id: 'b', en: 'gate', updatedAt: 300 };
  const { toWrite } = mergeRemote([], [remote]);
  const c = toWrite[0];
  assert.equal(c.ease, 2.5);
  assert.equal(c.stability, 0);
  assert.equal(c.difficulty, 0);
  assert.equal(c.state, 0);
  assert.equal(c.lapses, 0);
  assert.equal(c.zh, '');
  assert.equal(c.deleted, false);
});

test('remote without id is skipped', () => {
  assert.equal(mergeRemote([], [{ en: 'x', updatedAt: 1 }]).changed, 0);
});
