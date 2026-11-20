// 语块 ↔ 原句/译文 联动高亮 — 纯函数,便于 node 单测。
// 优先用 AI 返回的原文片段(src / dst);缺失时英文按词匹配(容忍词形和中间插词),中文按释义子串匹配。

const PLACEHOLDERS = new Set(['sb', 'sth', "one's", 'one', 'someone', 'something', 'somebody']);

const stem = (w) => w.toLowerCase().replace(/[’']s$/, '').replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');

/** text 中 needle 的所有不区分大小写出现位置 → [[start, end]]。 */
export function exactRanges(text, needle) {
  const out = [];
  if (!needle) return out;
  const t = text.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return out;
  let i = t.indexOf(n);
  while (i !== -1) { out.push([i, i + n.length]); i = t.indexOf(n, i + n.length); }
  return out;
}

/** 英文词序匹配:短语里的实词按顺序出现在原文中,相邻两词之间最多插 2 个词。 */
export function wordRanges(text, phrase) {
  const words = [...text.matchAll(/[A-Za-z’']+/g)].map((m) => ({ w: m[0], s: m.index, e: m.index + m[0].length }));
  const need = phrase.toLowerCase().split(/\s+/).filter((w) => w && !PLACEHOLDERS.has(w)).map(stem);
  if (!need.length) return [];
  for (let start = 0; start < words.length; start++) {
    if (stem(words[start].w) !== need[0]) continue;
    const hit = [words[start]];
    let j = start;
    for (let k = 1; k < need.length; k++) {
      let found = -1;
      for (let x = j + 1; x <= Math.min(words.length - 1, j + 3); x++) {
        if (stem(words[x].w) === need[k]) { found = x; break; }
      }
      if (found === -1) { hit.length = 0; break; }
      hit.push(words[found]); j = found;
    }
    if (hit.length) return hit.map((h) => [h.s, h.e]);
  }
  return [];
}

/** 某个语块在一段文字里的高亮区间。lang = 'en' | 'zh';span = AI 给出的原文片段(可缺)。 */
export function rangesFor(text, { span, en, zh }, lang) {
  const direct = exactRanges(text, span);
  if (direct.length) return direct.slice(0, 1);
  if (lang === 'en') {
    const exact = exactRanges(text, en);
    return exact.length ? exact.slice(0, 1) : wordRanges(text, en ?? '');
  }
  return exactRanges(text, zh).slice(0, 1);
}

/** 把文字切成片段,每段带覆盖它的语块下标 → [{ text, ids: [..] }]。 */
export function segments(text, rangesById) {
  const owners = Array.from({ length: text.length }, () => []);
  rangesById.forEach((ranges, id) => {
    for (const [s, e] of ranges) for (let i = s; i < e && i < text.length; i++) owners[i].push(id);
  });
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const key = owners[i].join(',');
    const last = out[out.length - 1];
    if (last && last.key === key) last.text += text[i];
    else out.push({ key, text: text[i], ids: owners[i] });
  }
  return out.map(({ text: t, ids }) => ({ text: t, ids }));
}
