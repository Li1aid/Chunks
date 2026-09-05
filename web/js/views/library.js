// 卡片库 tab — 对齐 iOS LibraryView:createdAt 倒序、搜索 en/zh/example、软删除。

import { getAllCards } from '../db.js';
import { softDelete } from '../sync.js';

const DAY_MS = 24 * 3600 * 1000;
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>';

let root, searchInput, listBox;
let query = '';

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="large-title">卡片</div>
    <input class="search-input" type="search" placeholder="搜索卡片" autocomplete="off">
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

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="icon">${query ? '🔍' : '🗂'}</div>
      <div class="title"></div>
      <div class="desc"></div>
    `;
    empty.querySelector('.title').textContent = query ? '没有匹配的卡片' : '还没有卡片';
    empty.querySelector('.desc').textContent = query ? '试试其他关键词' : '先去翻译一句中文';
    listBox.append(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lib-list';
  for (const card of cards) list.append(row(card));
  listBox.append(list);
}

function row(card) {
  const el = document.createElement('div');
  el.className = 'lib-row';

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
  const reps = document.createElement('span');
  reps.textContent = `复习 ${card.reps} 次`;
  const due = document.createElement('span');
  const d = dueInfo(card);
  due.textContent = d.text;
  if (d.cls) due.className = d.cls;
  meta.append(reps, due);
  body.append(en, zh, meta);

  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.innerHTML = TRASH_SVG;
  del.addEventListener('click', async () => {
    if (!confirm(`删除「${card.en}」？`)) return;
    await softDelete(card.id);
    render();
  });

  el.append(body, del);
  return el;
}

/** 到期文案与颜色 — 规则照搬 iOS CardRow。 */
function dueInfo(card) {
  const now = Date.now();
  const dueIn = card.due - now;

  if (card.reps >= 5 && card.interval > 30 * DAY_MS) return { text: '已熟练', cls: 'due-green' };
  if (dueIn <= 0) return { text: '今日待复习', cls: 'due-red' };

  const days = Math.round(dueIn / DAY_MS);
  const cls = dueIn < 2 * DAY_MS ? 'due-orange' : '';
  if (days < 30) return { text: `${days} 天后`, cls };
  return { text: `${Math.round(days / 30)} 个月后`, cls };
}
