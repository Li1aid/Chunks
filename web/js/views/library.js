// 卡片库 tab — 对齐 iOS LibraryView:createdAt 倒序、搜索 en/zh/example、软删除。

import { getAllCards } from '../db.js';
import { softDelete } from '../sync.js';
import { speak, SPEAKER_SVG } from '../speech.js';

const DAY_MS = 24 * 3600 * 1000;
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>';

let root, searchInput, listBox;
let query = '';

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="large-title">Cards</div>
    <div class="search-wrap"><input class="search-input" type="search" placeholder="Search" autocomplete="off"></div>
    <div class="list-slot"></div>
  `;
  searchInput = root.querySelector('.search-input');
  listBox = root.querySelector('.list-slot');
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    render();
  });
}

export function show() {
  render();
}

async function render() {
  const all = await getAllCards();
  let cards = all.filter((c) => !c.deleted).sort((a, b) => b.createdAt - a.createdAt);
  if (query) {
    cards = cards.filter(
      (c) =>
        c.en.toLowerCase().includes(query) ||
        c.zh.toLowerCase().includes(query) ||
        c.example.toLowerCase().includes(query)
    );
  }

  listBox.innerHTML = '';
  openRow = null;

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="icon">${query ? '🔍' : '🗂'}</div>
      <div class="title"></div>
      <div class="desc"></div>
    `;
    empty.querySelector('.title').textContent = query ? 'No matching cards' : 'No cards yet';
    empty.querySelector('.desc').textContent = query ? 'Try another word' : 'Translate a sentence to make your first cards';
    listBox.append(empty);
    return;
  }

  // 按添加日期分组(同 iOS 备忘录):Today / Yesterday / Previous 7 Days / Previous 30 Days / 月份
  let current = null, list = null;
  for (const card of cards) {
    const label = dateBucket(card.createdAt);
    if (label !== current) {
      current = label;
      const header = document.createElement('div');
      header.className = 'lib-section';
      header.textContent = label;
      list = document.createElement('div');
      list.className = 'lib-list';
      listBox.append(header, list);
    }
    list.append(row(card));
  }
}

let openRow = null; // 当前左滑展开的行(同一时间只开一行)

function closeOpenRow() {
  if (openRow) { openRow.style.transform = ''; openRow = null; }
}

function row(card) {
  const el = document.createElement('div');
  el.className = 'lib-row';

  // 底层:左滑露出的删除键(替代原来的垃圾桶图标 + confirm)
  const del = document.createElement('button');
  del.className = 'lib-action';
  del.innerHTML = TRASH_SVG + '<span>Delete</span>';
  del.setAttribute('aria-label', `Delete “${card.en}”`);
  del.addEventListener('click', async () => {
    el.classList.add('removing');
    await softDelete(card.id);
    setTimeout(render, 280);
  });

  const content = document.createElement('div');
  content.className = 'lib-content';

  const body = document.createElement('div');
  body.className = 'body';
  const en = document.createElement('div');
  en.className = 'lib-en';
  en.textContent = card.en;
  const zh = document.createElement('div');
  zh.className = 'lib-zh';
  zh.textContent = card.zh;
  const meta = document.createElement('div');
  meta.className = 'lib-meta';
  const due = document.createElement('span');
  const d = dueInfo(card);
  due.textContent = d.text;
  due.className = 'due' + (d.cls ? ' ' + d.cls : '');
  const reps = document.createElement('span');
  reps.textContent = `${card.reps} ${card.reps === 1 ? 'review' : 'reviews'}`;
  meta.append(due, reps);
  body.append(en, zh, meta);

  const speaker = document.createElement('button');
  speaker.className = 'speaker-btn';
  speaker.innerHTML = SPEAKER_SVG;
  speaker.addEventListener('click', () => speak(card.en, speaker));

  content.append(body, speaker);
  attachSwipe(content);
  el.append(del, content);
  return el;
}

const ACTION_W = 88;

function attachSwipe(content) {
  let startX = 0, startY = 0, base = 0, dx = 0, dragging = false, decided = false;
  content.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.speaker-btn')) return;
    if (openRow && openRow !== content) closeOpenRow();
    startX = e.clientX; startY = e.clientY; dragging = false; decided = false;
    base = openRow === content ? -ACTION_W : 0; dx = base;
    content.setPointerCapture(e.pointerId);
  });
  content.addEventListener('pointermove', (e) => {
    if (!content.hasPointerCapture?.(e.pointerId)) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      dragging = Math.abs(mx) > Math.abs(my);
      if (!dragging) { content.releasePointerCapture(e.pointerId); return; }
      content.classList.add('dragging');
    }
    if (!dragging) return;
    dx = Math.min(0, Math.max(-ACTION_W * 1.4, base + mx));
    content.style.transform = `translateX(${dx}px)`;
    e.preventDefault();
  });
  const end = () => {
    content.classList.remove('dragging');
    if (!dragging) {
      if (openRow === content) closeOpenRow();
      return;
    }
    dragging = false;
    if (dx < -ACTION_W / 2) {
      content.style.transform = `translateX(${-ACTION_W}px)`;
      openRow = content;
    } else {
      content.style.transform = '';
      if (openRow === content) openRow = null;
    }
  };
  content.addEventListener('pointerup', end);
  content.addEventListener('pointercancel', end);
}

function dateBucket(ms) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  if (ms >= t0) return 'Today';
  if (ms >= t0 - DAY_MS) return 'Yesterday';
  if (ms >= t0 - 7 * DAY_MS) return 'Previous 7 Days';
  if (ms >= t0 - 30 * DAY_MS) return 'Previous 30 Days';
  const d = new Date(ms);
  return d.toLocaleDateString('en', d.getFullYear() === start.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

/** 到期文案与颜色 — 规则照搬 iOS CardRow。 */
function dueInfo(card) {
  const now = Date.now();
  const dueIn = card.due - now;

  if (card.reps >= 5 && card.interval > 30 * DAY_MS) return { text: 'Mastered', cls: 'due-green' };
  if (dueIn <= 0) return { text: 'Due today', cls: 'due-red' };

  const days = Math.round(dueIn / DAY_MS);
  const cls = dueIn < 2 * DAY_MS ? 'due-orange' : '';
  if (days < 30) return { text: `In ${days} ${days === 1 ? 'day' : 'days'}`, cls };
  return { text: `In ${Math.round(days / 30)} mo`, cls };
}
