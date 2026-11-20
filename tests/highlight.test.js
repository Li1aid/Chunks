import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactRanges, wordRanges, rangesFor, segments } from '../web/js/highlight.js';

const EN = "I'm not really in the mood to cook today. Let's just order takeout.";

test('exactRanges: case-insensitive substring', () => {
  assert.deepEqual(exactRanges(EN, 'Order Takeout'), [[53, 66]]);
  assert.deepEqual(exactRanges(EN, ''), []);
});

test('wordRanges: tolerates inserted words and inflection', () => {
  const r = wordRanges(EN, 'not in the mood to');
  assert.equal(r.length, 5);
  assert.equal(EN.slice(r[0][0], r[0][1]), 'not');
  assert.equal(EN.slice(r[1][0], r[1][1]), 'in');
  const f = wordRanges('I figured it out.', 'figure out');
  assert.deepEqual(f.map(([s, e]) => 'I figured it out.'.slice(s, e)), ['figured', 'out']);
  assert.deepEqual(wordRanges('make up your mind', "make up one's mind").length, 3);
});

test('rangesFor: AI span wins, then fallbacks', () => {
  const zh = '今天实在不想做饭，咱们点外卖吧。';
  assert.deepEqual(rangesFor(zh, { span: '不想', en: 'not in the mood to', zh: '没心情做某事' }, 'zh'), [[4, 6]]);
  assert.deepEqual(rangesFor(zh, { en: 'order takeout', zh: '点外卖' }, 'zh'), [[11, 14]]);
  assert.deepEqual(rangesFor(zh, { en: 'x', zh: '没心情做某事' }, 'zh'), []);
  assert.equal(rangesFor(EN, { en: 'order takeout', zh: '点外卖' }, 'en').length, 1);
});

test('segments: splits text by owning phrase ids', () => {
  const segs = segments('abcdef', [[[1, 3]], [[2, 4]]]);
  assert.deepEqual(segs, [
    { text: 'a', ids: [] }, { text: 'b', ids: [0] }, { text: 'c', ids: [0, 1] }, { text: 'd', ids: [1] }, { text: 'ef', ids: [] },
  ]);
});
