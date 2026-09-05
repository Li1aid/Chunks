// 卡片工厂与去重规范化 — 字段和规则对齐 iOS 版 Card.swift / TranslateView.normalizeEn。

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateId() {
  let rand = '';
  for (let i = 0; i < 6; i++) rand += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return `${Date.now()}-${rand}`;
}

/** 新卡:18 个同步字段 + id,默认值与 iOS Card.init 一致。 */
export function makeCard({ en, zh, example = '', usage = '', sourceZh = '', sourceEn = '', nowMs = Date.now() }) {
  return {
    id: generateId(),
    en,
    zh,
    example,
    usage,
    sourceZh,
    sourceEn,
    createdAt: nowMs,
    ease: 2.5,
    interval: 0,
    reps: 0,
    due: nowMs,
    lastReview: 0,
    deleted: false,
    updatedAt: nowMs,
    stability: 0,
    difficulty: 0,
    state: 0,
    lapses: 0,
  };
}

const EDGE_PUNCT = new Set([...`.,;:!?"'\`()[]{}`]);

/** 去重键:小写 → 折叠连续空白 → 去首尾标点(保留中间撇号/连字符)。 */
export function normalizeEn(s) {
  const collapsed = s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  let start = 0;
  let end = collapsed.length;
  while (start < end && EDGE_PUNCT.has(collapsed[start])) start++;
  while (end > start && EDGE_PUNCT.has(collapsed[end - 1])) end--;
  return collapsed.slice(start, end).trim();
}
