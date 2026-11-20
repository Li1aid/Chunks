import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationHistory } from '../web/js/translation-history.js';

function storage() {
  let value = null;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}

test('saved translations reopen with original direction and phrases; repeat inputs move to front', () => {
  const disk = storage();
  const history = createTranslationHistory(disk);
  const result = { translation: '搞清楚', phrases: [{ en: 'figure out', zh: '搞清楚', example: 'I figured it out.' }] };
  history.remember(' figure out ', result, 'enToZh');
  history.remember('你好', { translation: 'Hello.', phrases: [] }, 'zhToEn');
  history.remember('Figure out', result, 'enToZh');
  const reopened = createTranslationHistory(disk).list();
  assert.equal(reopened.length, 2);
  assert.equal(reopened[0].input, 'Figure out');
  assert.equal(reopened[0].direction, 'enToZh');
  assert.deepEqual(reopened[0].result, result);
  history.remove(reopened[0].id);
  assert.equal(createTranslationHistory(disk).list().length, 1);
});

test('existing cards recover grouped source sentences without claiming to recover full results', () => {
  const disk = storage();
  const history = createTranslationHistory(disk);
  history.recover([]);
  history.recover([
    { sourceZh: '我会搞定的', sourceEn: "I'll figure it out.", en: 'figure out', zh: '搞清楚', createdAt: 2 },
    { sourceZh: '我会搞定的', sourceEn: "I'll figure it out.", en: 'figure out', zh: '搞清楚', createdAt: 1 },
    { sourceZh: '你好', sourceEn: 'Hello.', en: 'Hello.', zh: '你好', createdAt: 3 },
    { sourceZh: '已删除', sourceEn: 'Deleted', deleted: true, createdAt: 4 },
    { en: 'No source', zh: '没有来源', createdAt: 5 },
  ]);
  const items = createTranslationHistory(disk).list();
  assert.equal(items.length, 2);
  assert.equal(items[0].input, '你好');
  assert.equal(items[0].recovered, true);
  assert.deepEqual(items[0].result.phrases, []);
  assert.equal(items[1].result.phrases.length, 1);
  history.clear();
  const cleared = createTranslationHistory(disk);
  cleared.recover([{ sourceZh: '你好', sourceEn: 'Hello.', createdAt: 3 }]);
  assert.deepEqual(cleared.list(), []);
});

test('history caps at 20 entries and still works when storage is unavailable', () => {
  const history = createTranslationHistory(undefined);
  for (let i = 0; i < 25; i++) history.remember(`句子 ${i}`, { translation: `Sentence ${i}`, phrases: [] }, 'zhToEn');
  assert.equal(history.list().length, 20);
  assert.equal(history.list()[0].input, '句子 24');
  assert.equal(history.list().at(-1).input, '句子 5');
});
