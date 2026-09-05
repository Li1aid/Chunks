// FSRS-4.5 — 自 Chunks iOS 版 FSRSScheduler.swift 逐行移植。
// 评分三档隐式映射:翻牌前右滑=easy(4),翻牌后右滑=good(3),左滑=forgot(1)。

export const RATING = { forgot: 1, mid: 2, good: 3, easy: 4 };

// FSRS-4.5 默认 19 个学习参数(社区训练的全人群最优)
export const W = [
  0.40255, 1.18385, 3.173, 15.69105,
  7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395,
  0.11, 0.29605, 2.2698,
  0.2315, 2.9898,
  0.51655, 0.6621,
];

export const DESIRED_RETENTION = 0.9;
export const DAY_MS = 24 * 3600 * 1000;
const FACTOR = 19 / 81;
const DECAY = -0.5;

const clamp = (v, low, high) => Math.min(Math.max(v, low), high);
const clampStability = (s) => clamp(s, 0.01, 36500);
const clampDifficulty = (d) => clamp(d, 1, 10);

// I(R_d, S) = (S / F) × (R_d^(1/C) − 1),钳位 [1, 36500] 天
function intervalForStability(s) {
  const raw = (s / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(raw, 1, 36500);
}

// R(t, S) = (1 + F × t / S)^C
export function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 1;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/**
 * 一张卡当前的 retrievability(统一新旧卡)。
 * 旧卡(state=1, stability>0)用自身 stability + lastReview;
 * 新卡用虚拟 stability W[2] + createdAt(语义:假如 createdAt 那天评了 good)。
 */
export function currentRetrievability({ state, stability, lastReviewMs, createdAtMs, nowMs }) {
  let referenceMs, s;
  if (state === 1 && stability > 0) {
    referenceMs = lastReviewMs;
    s = stability;
  } else {
    referenceMs = createdAtMs;
    s = W[2];
  }
  const elapsedDays = Math.max(0, (nowMs - referenceMs) / DAY_MS);
  return retrievability(elapsedDays, s);
}

/**
 * 给一张卡评分。card 需要 { stability, difficulty, state, lapses, lastReviewMs }。
 * 返回 { stability, difficulty, state, lapses, dueMs, lastReviewMs, updatedAtMs, intervalDays }。
 */
export function schedule(card, rating, nowMs = Date.now()) {
  if (card.state === 0) return firstReview(rating, nowMs);
  return subsequentReview(card, rating, nowMs);
}

function firstReview(rating, nowMs) {
  // 初始 stability:W[grade-1];初始 difficulty:D₀(G) = W[4] − e^(W[5](G−1)) + 1
  const stability = clampStability(W[rating - 1]);
  const difficulty = clampDifficulty(W[4] - Math.exp(W[5] * (rating - 1)) + 1);

  const forgot = rating === RATING.forgot;
  const intervalDays = forgot
    ? Math.max(1, intervalForStability(stability))
    : intervalForStability(stability);

  return result({
    stability,
    difficulty,
    lapses: forgot ? 1 : 0,
    intervalDays,
    nowMs,
  });
}

function subsequentReview(card, rating, nowMs) {
  const elapsedDays = Math.max(0, (nowMs - card.lastReviewMs) / DAY_MS);
  const R = retrievability(elapsedDays, card.stability);

  // difficulty:D' = D + (−W[6](G−3)) × ((10−D)/9),再向 D₀(good) 均值回归
  const dPrime = card.difficulty + -W[6] * (rating - 3) * ((10 - card.difficulty) / 9);
  const d0Good = W[4] - Math.exp(W[5] * 2) + 1;
  const difficulty = clampDifficulty(W[7] * d0Good + (1 - W[7]) * dPrime);

  let stability;
  let lapses = card.lapses;

  if (rating === RATING.forgot) {
    // 失败:S' = min(S_f, S),S_f = D^(−W[12]) × ((S+1)^W[13] − 1) × e^(W[14](1−R)) × W[11]
    const sf =
      Math.pow(card.difficulty, -W[12]) *
      (Math.pow(card.stability + 1, W[13]) - 1) *
      Math.exp(W[14] * (1 - R)) *
      W[11];
    stability = clampStability(Math.min(sf, card.stability));
    lapses += 1;
  } else {
    // 成功:S' = S × α;hard 档减系数 W[15],easy 档加系数 W[16]
    const hardPenalty = rating === RATING.mid ? W[15] : 1;
    const easyBonus = rating === RATING.easy ? W[16] : 1;
    const alpha =
      1 +
      (11 - card.difficulty) *
        Math.pow(card.stability, -W[9]) *
        (Math.exp(W[10] * (1 - R)) - 1) *
        hardPenalty *
        easyBonus *
        Math.exp(W[8]);
    stability = clampStability(card.stability * alpha);
  }

  return result({ stability, difficulty, lapses, intervalDays: intervalForStability(stability), nowMs });
}

function result({ stability, difficulty, lapses, intervalDays, nowMs }) {
  return {
    stability,
    difficulty,
    state: 1,
    lapses,
    dueMs: nowMs + intervalDays * DAY_MS,
    lastReviewMs: nowMs,
    updatedAtMs: nowMs,
    intervalDays,
  };
}

/**
 * SM-2 → FSRS 智能初始化:老卡首次用 FSRS 评分前,用 reps/interval/ease 反推初值。
 * card 需要 { reps, intervalMs, ease }。
 */
export function bootstrap(card) {
  if (card.reps === 0) return { stability: 0, difficulty: 0, state: 0 };
  const stability = Math.max(1, card.intervalMs / DAY_MS);
  // ease 1.3–2.5 映射到 difficulty 8–3
  const difficulty = clampDifficulty(11 - 4 * (card.ease - 1.3));
  return { stability, difficulty, state: 1 };
}
