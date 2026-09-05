import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDirection, parseTranslationJSON } from '../web/js/ai.js';

test('detectDirection: any CJK char means zhToEn', () => {
  assert.equal(detectDirection('把这个修好'), 'zhToEn');
  assert.equal(detectDirection('把 bug 修好'), 'zhToEn');
  assert.equal(detectDirection('㐀 test'), 'zhToEn'); // CJK 扩展 A U+3400
  assert.equal(detectDirection('fix this'), 'enToZh');
  assert.equal(detectDirection('123 !?'), 'enToZh');
});

const GOOD = '{"translation":"Fix it.","phrases":[{"en":"figure out","zh":"搞清楚","example":"I figured it out."}]}';

test('parseTranslationJSON: plain JSON', () => {
  const r = parseTranslationJSON(GOOD);
  assert.equal(r.translation, 'Fix it.');
  assert.equal(r.phrases.length, 1);
  assert.equal(r.phrases[0].en, 'figure out');
});

test('parseTranslationJSON: strips markdown fences', () => {
  assert.equal(parseTranslationJSON('```json\n' + GOOD + '\n```').translation, 'Fix it.');
  assert.equal(parseTranslationJSON('```\n' + GOOD + '\n```').translation, 'Fix it.');
});

test('parseTranslationJSON: extracts object from surrounding prose', () => {
  assert.equal(parseTranslationJSON('Here you go:\n' + GOOD + '\nEnjoy!').translation, 'Fix it.');
});

test('parseTranslationJSON: missing fields normalize (phrases default [])', () => {
  const r = parseTranslationJSON('{"translation":"Hi."}');
  assert.deepEqual(r.phrases, []);
});

test('parseTranslationJSON: garbage throws', () => {
  assert.throws(() => parseTranslationJSON('sorry, I cannot help'));
  assert.throws(() => parseTranslationJSON('{"phrases":[]}')); // 没有 translation 也算失败
});
