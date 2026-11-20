// 复习 tab — 对齐 iOS ReviewView:
// 队列 R<0.9 升序截 30 张,不足 10 张卡不开放;轻点翻牌;
// 翻牌前右滑=easy,翻牌后右滑=good,左滑=forgot;滑动时屏幕边缘红/绿光晕。

import { getAllCards, putCard } from '../db.js';
import { scheduleSync } from '../sync.js';
import { schedule, bootstrap, currentRetrievability, RATING, DESIRED_RETENTION, DAY_MS } from '../fsrs.js';
import { getReviewDirection, setReviewDirection } from '../settings.js';
import { speak, SPEAKER_SVG } from '../speech.js';

const DAILY_QUEUE_CAP = 30;
const MIN_CARDS_TO_START = 10;
const EXIT_THRESHOLD = 120;

let root, bodyBox, glowLeft, glowRight;
let session = null; // { cards, index, isFlipped }

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="large-title">Review
      <div class="segmented" role="group" aria-label="Review direction">
        <button data-dir="zhToEn">ZH → EN</button><button data-dir="enToZh">EN → ZH</button>
      </div>
    </div>
    <div class="body-slot"></div>
  `;
  bodyBox = root.querySelector('.body-slot');

  glowLeft = document.createElement('div');
  glowLeft.className = 'glow left';
  glowRight = document.createElement('div');
  glowRight.className = 'glow right';
  root.append(glowLeft, glowRight);

  for (const btn of root.querySelectorAll('.segmented button')) {
    btn.addEventListener('click', () => {
      if (getReviewDirection() === btn.dataset.dir) return;
      setReviewDirection(btn.dataset.dir);
      updateToggle();
      render();
    });
  }
  updateToggle();
}

function updateToggle() {
  const dir = getReviewDirection();
  const seg = root.querySelector('.segmented');
  seg.style.setProperty('--seg', dir === 'zhToEn' ? 0 : 1);
  for (const btn of seg.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.dir === dir));
}

export function show() {
  render();
}

const currentR = (card, nowMs) =>
  currentRetrievability({
    state: card.state,
    stability: card.stability,
    lastReviewMs: card.lastReview,
    createdAtMs: card.createdAt,
    nowMs,
  });

async function render() {
  setGlow(0);
  const all = (await getAllCards()).filter((c) => !c.deleted);

  if (all.length < MIN_CARDS_TO_START) {
    session = null;
    bodyBox.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="icon">🃏</div><div class="title">Translate a few more</div><div class="desc"></div>';
    empty.querySelector('.desc').textContent = `Reviews start at ${MIN_CARDS_TO_START} cards.\n${all.length} / ${MIN_CARDS_TO_START} so far`;
    bodyBox.append(empty);
    return;
  }

  if (session && session.index < session.cards.length) {
    renderReviewing();
    return;
  }
  session = null;
  renderHome(all);
}

// ===== 复习首页:统计 + 开始按钮 =====

function renderHome(all) {
  const nowMs = Date.now();
  const dueCount = all.filter((c) => currentR(c, nowMs) < DESIRED_RETENTION).length;
  const mastered = all.filter((c) => c.state === 1 && c.stability >= 30).length;

  bodyBox.innerHTML = '';

  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.append(
    statCell('Due', dueCount, dueCount > 0 ? 'var(--red)' : 'var(--secondary)'),
    divider(),
    statCell('Mastered', mastered, mastered > 0 ? 'var(--green)' : 'var(--secondary)'),
    divider(),
    statCell('Total', all.length, 'var(--accent)')
  );
  bodyBox.append(stats);
  bodyBox.append(forecast(all, nowMs));

  const queue = todayQueue(all, nowMs);
  if (queue.length === 0) {
    const done = document.createElement('div');
    done.className = 'finished-card';
    done.innerHTML = '<div class="check">✓</div><div class="title">All done for today</div><div class="sub">See you tomorrow ✌</div>';
    bodyBox.append(done);
    return;
  }

  const start = document.createElement('button');
  start.className = 'btn-primary';
  start.textContent = `Start Review · ${queue.length}`;
  start.addEventListener('click', () => {
    session = { cards: queue, index: 0, isFlipped: false };
    renderReviewing();
  });
  bodyBox.append(start);
}

/** 未来 7 天每天到期的卡数(已过期的算进今天)— 让间隔重复的排布看得见。 */
function forecast(all, nowMs) {
  const start = new Date(nowMs); start.setHours(0, 0, 0, 0);
  const counts = new Array(7).fill(0);
  let dueNow = 0; // 今天这根柱子里「现在就能复习」的部分,与 Due 同口径
  for (const c of all) {
    if (currentR(c, nowMs) < DESIRED_RETENTION) { counts[0] += 1; dueNow += 1; continue; }
    const day = Math.floor((c.due - start.getTime()) / DAY_MS);
    if (day < 7) counts[Math.max(0, day)] += 1;
  }
  const max = Math.max(1, ...counts);
  const box = document.createElement('div');
  box.className = 'forecast';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `Cards due over the next 7 days: ${counts.join(', ')}. ${dueNow} ready now.`);
  counts.forEach((n, i) => {
    const d = new Date(start.getTime() + i * DAY_MS);
    const col = document.createElement('div');
    col.className = 'fc-col' + (i === 0 ? ' today' : '');
    col.style.setProperty('--i', i);
    const num = document.createElement('span');
    num.className = 'fc-num';
    num.textContent = n || '';
    const bar = document.createElement('span');
    bar.className = 'fc-bar';
    bar.style.height = `${n ? 8 + (n / max) * 92 : 4}%`;
    if (i === 0 && n) {
      const now = document.createElement('i');
      now.style.height = `${(dueNow / n) * 100}%`;
      bar.append(now);
    }
    const day = document.createElement('span');
    day.className = 'fc-day';
    day.textContent = d.toLocaleDateString('en', { weekday: 'narrow' });
    col.append(num, bar, day);
    box.append(col);
  });
  return box;
}

function todayQueue(all, nowMs) {
  return all
    .map((c) => [c, currentR(c, nowMs)])
    .filter(([, r]) => r < DESIRED_RETENTION)
    .sort((a, b) => a[1] - b[1])
    .slice(0, DAILY_QUEUE_CAP)
    .map(([c]) => c);
}

function statCell(label, value, color) {
  const cell = document.createElement('div');
  cell.className = 'stat-cell';
  cell.innerHTML = '<div class="value"></div><div class="label"></div>';
  cell.querySelector('.value').textContent = value;
  cell.querySelector('.value').style.color = color;
  cell.querySelector('.label').textContent = label;
  return cell;
}

function divider() {
  const d = document.createElement('div');
  d.className = 'stat-divider';
  return d;
}

// ===== 复习中:进度 + 可滑动闪卡 =====

function renderReviewing() {
  const card = session.cards[Math.min(session.index, session.cards.length - 1)];
  const direction = getReviewDirection();

  bodyBox.innerHTML = '';

  // 进度用一条进度条表达,不写「3 / 30」
  const progress = document.createElement('div');
  progress.className = 'review-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', String(session.cards.length));
  progress.setAttribute('aria-valuenow', String(session.index));
  const fill = document.createElement('i');
  fill.style.width = `${(session.index / session.cards.length) * 100}%`;
  progress.append(fill);
  bodyBox.append(progress);
  requestAnimationFrame(() => { fill.style.width = `${((session.index + 1) / session.cards.length) * 100}%`; });

  // 身后露出的卡边 = 还有牌
  const stage = document.createElement('div');
  stage.className = 'flashcard-stage' + (session.index < session.cards.length - 1 ? ' has-more' : '');
  const drag = document.createElement('div'); // 拖拽层(位移 + 倾斜)
  const flip = document.createElement('div'); // 翻转层(3D)
  flip.className = 'flashcard' + (session.isFlipped ? ' flipped' : '');
  flip.append(face(card, direction, 'front'), face(card, direction, 'back'));
  drag.append(flip);
  stage.append(drag);
  bodyBox.append(stage);

  attachGestures(stage, drag, flip);

  // 每次开始复习,两侧先各闪一下:左红右绿,不用文字说明方向
  if (session.index === 0 && !session.hinted) {
    session.hinted = true;
    for (const g of [glowLeft, glowRight]) {
      g.classList.remove('hint');
      void g.offsetWidth;
      g.classList.add('hint');
      g.addEventListener('animationend', () => g.classList.remove('hint'), { once: true });
    }
  }
}

function face(card, direction, side) {
  const el = document.createElement('div');
  el.className = `face ${side}`;

  if (side === 'front') {
    const main = document.createElement('div');
    main.className = 'main' + (direction === 'zhToEn' ? ' zh' : '');
    main.textContent = direction === 'zhToEn' ? card.zh : card.en;
    el.append(main);
    return el;
  }

  const main = document.createElement('div');
  main.className = 'main';
  const sub = document.createElement('div');
  sub.className = 'sub';
  if (direction === 'zhToEn') {
    main.textContent = card.en;
    sub.textContent = card.zh;
  } else {
    main.textContent = card.zh;
    main.classList.add('zh');
    sub.textContent = card.en;
  }
  el.append(main, sub);

  if (card.example) {
    const ex = document.createElement('div');
    ex.className = 'example';
    ex.textContent = `“${card.example}”`;
    el.append(ex);
  }
  if (card.sourceZh && card.sourceZh !== card.zh) {
    const src = document.createElement('div');
    src.className = 'source';
    src.textContent = `From: ${card.sourceZh}`;
    el.append(src);
  }

  const speaker = document.createElement('button');
  speaker.className = 'speaker-btn';
  speaker.innerHTML = SPEAKER_SVG;
  speaker.addEventListener('click', (e) => {
    e.stopPropagation();
    speak(card.en, speaker);
  });
  el.append(speaker);
  return el;
}

// ===== 手势:横向拖拽评分 + 轻点翻牌 =====

function attachGestures(stage, drag, flip) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let exiting = false;

  const setDrag = (x) => {
    drag.style.transform = `translateX(${x}px) rotate(${x / 30}deg)`;
    drag.style.transformOrigin = 'bottom center';
  };

  stage.addEventListener('pointerdown', (e) => {
    if (exiting) return;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = false;
    stage.setPointerCapture(e.pointerId);
    drag.style.transition = 'none';
  });

  stage.addEventListener('pointermove', (e) => {
    if (exiting || !stage.hasPointerCapture?.(e.pointerId)) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!dragging && Math.abs(mx) < 8) return;
    if (Math.abs(mx) <= Math.abs(my)) {
      // 纵向为主:交还滚动,复位
      dx = 0;
      setDrag(0);
      setGlow(0);
      return;
    }
    dragging = true;
    dx = mx;
    setDrag(dx);
    setGlow(Math.max(-1, Math.min(1, dx / EXIT_THRESHOLD)));
    e.preventDefault();
  });

  const finish = (e) => {
    if (exiting) return;
    const wasDragging = dragging;
    dragging = false;

    if (wasDragging && Math.abs(dx) >= EXIT_THRESHOLD) {
      exiting = true;
      const dir = dx > 0 ? 1 : -1;
      drag.style.transition = 'transform 0.18s ease-in';
      setDrag(dir * 800);
      setTimeout(() => {
        setGlow(0);
        rate(dir < 0 ? RATING.forgot : session.isFlipped ? RATING.good : RATING.easy);
      }, 180);
      return;
    }

    drag.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.4, 1.1)';
    setDrag(0);
    setGlow(0);

    // 位移很小 → 视为轻点翻牌(只在未翻牌时)
    if (!wasDragging && Math.abs(e.clientX - startX) < 8 && Math.abs(e.clientY - startY) < 8) {
      if (!session.isFlipped) {
        session.isFlipped = true;
        flip.classList.add('flipped');
      }
    }
    dx = 0;
  };

  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', () => {
    dragging = false;
    drag.style.transition = 'transform 0.3s ease';
    setDrag(0);
    setGlow(0);
    dx = 0;
  });
}

/** 评分后浮起下次复习时间(来自 FSRS 的真实间隔)。 */
function showNext(intervalDays, forgot) {
  const days = Math.max(1, Math.round(intervalDays));
  let text;
  if (days === 1) text = forgot ? 'Again tomorrow' : 'Next tomorrow';
  else if (days < 60) text = `Next in ${days} days`;
  else text = `Next in ${Math.round(days / 30)} months`;
  root.querySelector('.next-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'next-toast ' + (forgot ? 'red' : 'green');
  toast.textContent = text;
  root.append(toast);
  setTimeout(() => toast.remove(), 1500);
}

function setGlow(progress) {
  const l = progress < 0 ? Math.min(1, -progress) : 0;
  const r = progress > 0 ? Math.min(1, progress) : 0;
  glowLeft.style.opacity = l;
  glowRight.style.opacity = r;
  glowLeft.style.setProperty('--p', l);
  glowRight.style.setProperty('--p', r);
}

// ===== 评分:bootstrap + FSRS + 回写(含 SM-2 旧字段)=====

async function rate(rating) {
  const card = session.cards[Math.min(session.index, session.cards.length - 1)];

  // 第一次用 FSRS 复习老 SM-2 卡:先智能初始化
  if (card.state === 0 && card.stability === 0 && card.reps > 0) {
    const boot = bootstrap({ reps: card.reps, intervalMs: card.interval, ease: card.ease });
    card.stability = boot.stability;
    card.difficulty = boot.difficulty;
    card.state = boot.state;
  }

  const result = schedule(
    { stability: card.stability, difficulty: card.difficulty, state: card.state, lapses: card.lapses, lastReviewMs: card.lastReview },
    rating,
    Date.now()
  );

  card.stability = result.stability;
  card.difficulty = result.difficulty;
  card.state = result.state;
  card.lapses = result.lapses;
  card.due = result.dueMs;
  card.lastReview = result.lastReviewMs;
  card.updatedAt = result.updatedAtMs;
  // 同步旧 SM-2 字段,老 PWA 拉下来仍能正常显示
  card.interval = result.intervalDays * DAY_MS;
  card.reps = rating === RATING.forgot ? 0 : card.reps + 1;

  await putCard(card);
  scheduleSync();
  showNext(result.intervalDays, rating === RATING.forgot);

  session.isFlipped = false;
  session.index += 1;
  if (session.index >= session.cards.length) {
    session = null;
    render();
  } else {
    renderReviewing();
  }
}
