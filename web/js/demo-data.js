// 演示模式的示例卡片:让评审一打开就能体验卡片库和按记忆曲线复习。
// 每张卡给一个「已复习过一段时间」的 FSRS 状态,到期时间分散在过去几天到几周后。

import { makeCard } from './card.js';

const SAMPLES = [
  ['get the hang of', '慢慢上手', "I'm still getting the hang of it.", '我还在慢慢上手。', -2],
  ['hit a wall', '卡住了', 'I hit a wall halfway through.', '我做到一半卡住了。', -1],
  ['on paper', '理论上', 'It looks fine on paper.', '理论上看着没问题。', 0],
  ['off the top of one\'s head', '不假思索地', "Off the top of my head, I'd say Tuesday.", '我随口一说的话,应该是周二。', 0],
  ['call it a day', '今天就到这儿', "Let's call it a day.", '今天就到这儿吧。', 1],
  ["for what it's worth", '不管有没有用', "For what it's worth, I liked it.", '不管有没有用,我挺喜欢的。', 1],
  ['run late', '迟到', "Sorry, I'm running late.", '不好意思,我要迟到了。', 1],
  ['catch up on', '补上', 'I need to catch up on sleep.', '我得补补觉。', 2],
  ['touch base', '联系一下', "Let's touch base on Monday.", '我们周一再联系一下。', 3],
  ['figure out', '搞清楚', "I'll figure it out.", '我会搞清楚的。', 4],
  ['no rush', '不急', 'No rush, take your time.', '不急,慢慢来。', 4],
  ['keep sb posted', '随时告诉某人', 'Keep me posted on how it goes.', '有进展随时告诉我。', 6],
  ['fair enough', '有道理', "Fair enough, let's do that.", '有道理,就这么办。', 9],
  ['sleep on it', '考虑一晚', 'Let me sleep on it.', '让我考虑一晚。', 20],
  ['make a point of', '特意去做', 'I make a point of walking every day.', '我每天都特意去走走路。', 35],
];
const AGE_DAYS = [1, 1, 2, 3, 4, 5, 6, 9, 12, 15, 20, 26, 34, 40, 48];

export function demoCards(nowMs = Date.now()) {
  const D = 86400000;
  return SAMPLES.map(([en, zh, example, sourceZh, dueInDays], i) => {
    const stability = dueInDays < 0 ? 3 : Math.max(2, dueInDays + 3 + (i % 3));
    const elapsed = stability - dueInDays;
    const c = makeCard({ en, zh, example, sourceZh, sourceEn: example, nowMs: nowMs - AGE_DAYS[i] * D - 3600000 * (i % 5) });
    c.state = 1;
    c.stability = stability;
    c.difficulty = 5;
    c.reps = 2 + (i % 5);
    c.lastReview = nowMs - elapsed * D;
    c.due = c.lastReview + stability * D;
    c.interval = stability * D;
    c.updatedAt = c.lastReview;
    return c;
  });
}
