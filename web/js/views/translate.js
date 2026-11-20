// 翻译 tab — 行为对齐 iOS TranslateView:自动检测方向、自动保存、语块去重、保存横幅。

import { translate } from '../ai.js';
import { makeCard, normalizeEn } from '../card.js';
import { getAllCards, putCards } from '../db.js';
import { scheduleSync, onStatus } from '../sync.js';
import { isConfigured, isDemo, getWorkerURL, getToken, getProvider, getModel } from '../settings.js';
import { speak, SPEAKER_SVG } from '../speech.js';
import { createTranslationHistory } from '../translation-history.js';
import { rangesFor, segments } from '../highlight.js';

let root;
let input, translateBtn, errorBox, resultBox;
let translating = false;
let history, historyBox;

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="large-title">Translate</div>
    <div class="composer">
      <textarea class="input" rows="3" placeholder="Type in Chinese or English" enterkeyhint="done"></textarea>
      <button class="send-btn" aria-label="Translate">
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>
        <span class="spinner"></span>
      </button>
    </div>
    <div class="error-slot"></div>
    <div class="result-slot"></div>
    <section class="translation-history" aria-label="History" hidden></section>
  `;
  input = root.querySelector('textarea');
  translateBtn = root.querySelector('.send-btn');
  errorBox = root.querySelector('.error-slot');
  resultBox = root.querySelector('.result-slot');
  historyBox = root.querySelector('.translation-history');
  let storage;
  try { storage = window.localStorage; } catch { /* 本机会话仍可使用。 */ }
  history = createTranslationHistory(storage, isDemo() ? 'chunks.demo.translationHistory' : undefined);
  onStatus((status) => { if (status.kind === 'success') refreshHistory(); });

  input.addEventListener('input', updateButton);
  translateBtn.addEventListener('click', run);
  updateButton();
}

export function show() {
  updateButton();
  renderHistory();
  refreshHistory();
}

function refreshHistory() {
  getAllCards().then((cards) => { history.recover(cards); renderHistory(); }).catch(() => {});
}

function renderHistory() {
  historyBox.replaceChildren();
  const items = history.list();
  historyBox.hidden = !items.length;
  if (!items.length) return;
  const header = document.createElement('div');
  header.className = 'translation-history-header';
  const title = document.createElement('span');
  title.textContent = 'History';
  const clear = document.createElement('button');
  clear.textContent = 'Clear';
  clear.disabled = translating;
  clear.addEventListener('click', () => { history.clear(); renderHistory(); });
  header.append(title, clear);
  historyBox.append(header);
  const list = document.createElement('div');
  list.className = 'translation-history-list';
  for (const entry of items) {
    const row = document.createElement('div');
    row.className = 'translation-history-row';
    const open = document.createElement('button');
    open.className = 'translation-history-open';
    open.disabled = translating;
    const original = document.createElement('span');
    original.className = 'translation-history-input';
    original.textContent = entry.input;
    const translation = document.createElement('span');
    translation.className = 'translation-history-output';
    translation.textContent = entry.result.translation;
    open.append(original, translation);
    if (entry.recovered) {
      const note = document.createElement('span');
      note.className = 'translation-history-note';
      note.textContent = 'From saved cards';
      open.append(note);
    }
    open.addEventListener('click', () => {
      if (translating) return;
      input.value = entry.input;
      showError(null);
      render(entry.result, entry.direction, null, entry.recovered);
      updateButton();
      root.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const remove = document.createElement('button');
    remove.className = 'translation-history-remove';
    remove.textContent = '×';
    remove.disabled = translating;
    remove.setAttribute('aria-label', `Remove from history: ${entry.input}`);
    remove.addEventListener('click', () => { history.remove(entry.id); renderHistory(); });
    row.append(open, remove);
    list.append(row);
  }
  historyBox.append(list);
}

function updateButton() {
  translateBtn.disabled = !input.value.trim() || translating || !isConfigured();
  translateBtn.classList.toggle('loading', translating);
  translateBtn.setAttribute('aria-label', translating ? 'Translating…' : 'Translate');
}

function showError(message) {
  errorBox.innerHTML = '';
  if (!message) return;
  const banner = document.createElement('div');
  banner.className = 'banner red';
  const text = document.createElement('span');
  text.textContent = message;
  const retry = document.createElement('button');
  retry.className = 'retry';
  retry.textContent = 'Retry';
  retry.addEventListener('click', run);
  banner.append(text, retry);
  errorBox.append(banner);
}

async function run() {
  const text = input.value.trim();
  if (!text || translating) return;
  if (!isConfigured()) {
    showError('Add your Worker URL and token in Settings first');
    return;
  }

  translating = true;
  updateButton();
  renderHistory();
  showError(null);
  resultBox.innerHTML = '';
  input.blur();

  try {
    const { result, direction } = await translate(text, {
      workerURL: getWorkerURL(),
      token: getToken(),
      provider: getProvider(),
      model: getModel(getProvider()),
    });
    history.remember(text, result, direction);
    const saved = await autoSave(text, result, direction);
    render(result, direction, saved);
  } catch (e) {
    showError(e instanceof TypeError ? 'No connection' : e.message || 'Translation failed');
  }

  translating = false;
  updateButton();
  renderHistory();
}

/**
 * 自动保存(无保存按钮):有语块只存语块卡,没语块兜底存整句卡。
 * 去重:normalizeEn 后与现有库 + 本批次比对,重复跳过。
 */
async function autoSave(inputText, result, direction) {
  const sentenceEn = direction === 'zhToEn' ? result.translation : inputText;
  const sentenceZh = direction === 'zhToEn' ? inputText : result.translation;

  const all = await getAllCards();
  const existing = new Set(all.filter((c) => !c.deleted).map((c) => normalizeEn(c.en)));

  const toInsert = [];
  let saved = 0;
  let skipped = 0;

  if (result.phrases.length === 0) {
    const key = normalizeEn(sentenceEn);
    if (key && existing.has(key)) {
      skipped = 1;
    } else {
      toInsert.push(makeCard({ en: sentenceEn, zh: sentenceZh, sourceZh: sentenceZh, sourceEn: sentenceEn }));
      saved = 1;
    }
  } else {
    const batchSeen = new Set();
    for (const phrase of result.phrases) {
      const key = normalizeEn(phrase.en);
      if (!key || existing.has(key) || batchSeen.has(key)) {
        skipped += 1;
        continue;
      }
      batchSeen.add(key);
      toInsert.push(makeCard({
        en: phrase.en,
        zh: phrase.zh,
        example: phrase.example ?? '',
        sourceZh: sentenceZh,
        sourceEn: sentenceEn,
      }));
      saved += 1;
    }
  }

  if (toInsert.length) {
    await putCards(toInsert);
    scheduleSync();
  }
  return { saved, skipped };
}

function render(result, direction, savedInfo, recovered = false) {
  resultBox.innerHTML = '';

  // 结果卡:上面一行原句,下面译文;两边都按语块切片,点语块时对应部分亮起
  const source = input.value.trim();
  const srcLang = direction === 'zhToEn' ? 'zh' : 'en';
  const dstLang = direction === 'zhToEn' ? 'en' : 'zh';
  const srcRanges = result.phrases.map((p) => rangesFor(source, { span: p.src, en: p.en, zh: p.zh }, srcLang));
  const dstRanges = result.phrases.map((p) => rangesFor(result.translation, { span: p.dst, en: p.en, zh: p.zh }, dstLang));

  const card = document.createElement('div');
  card.className = 'card result-row';
  const textBox = document.createElement('div');
  textBox.className = 'result-body';
  const srcLine = document.createElement('div');
  srcLine.className = 'result-src';
  fillSegments(srcLine, source, srcRanges);
  const text = document.createElement('div');
  text.className = 'result-text';
  fillSegments(text, result.translation, dstRanges);
  textBox.append(srcLine, text);
  card.append(textBox);
  if (direction === 'zhToEn') {
    card.append(speakerButton(result.translation));
  }
  resultBox.append(card);

  // 保存横幅
  if (savedInfo) {
    const { saved, skipped } = savedInfo;
    const banner = document.createElement('div');
    if (saved > 0) {
      banner.className = 'banner green';
      banner.textContent = skipped > 0 ? `Saved ${saved} · ${skipped} already saved` : `Saved ${saved} ${saved === 1 ? 'card' : 'cards'}`;
    } else if (skipped > 0) {
      banner.className = 'banner gray';
      banner.textContent = 'Already saved';
    } else {
      banner.className = 'banner green';
      banner.textContent = 'Saved';
    }
    resultBox.append(banner);
  }

  // 旧卡片只能恢复已保存的语块，不能推断当时完整的 AI 结果。
  if (recovered && result.phrases.length === 0) return;

  // 语块/生词列表
  if (recovered) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = 'Saved phrases';
    resultBox.append(label);
  }

  if (result.phrases.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'hint-empty';
    hint.textContent = direction === 'zhToEn'
      ? 'No phrases worth keeping here, so the whole sentence was saved as a card'
      : 'No new words worth keeping here, so the whole sentence was saved as a card';
    resultBox.append(hint);
    return;
  }

  const list = document.createElement('div');
  list.className = 'phrase-list';
  let active = -1;
  const setActive = (i) => {
    active = active === i ? -1 : i;
    for (const el of resultBox.querySelectorAll('.seg')) {
      el.classList.toggle('lit', active >= 0 && el.dataset.ids.split(',').includes(String(active)));
    }
    list.querySelectorAll('.phrase-item').forEach((el, k) => el.classList.toggle('active', k === active));
  };
  result.phrases.forEach((phrase, i) => {
    const item = document.createElement('div');
    item.className = 'phrase-item';
    item.style.setProperty('--i', i);
    item.addEventListener('click', (e) => { if (!e.target.closest('.speaker-btn')) setActive(i); });
    const body = document.createElement('div');
    body.className = 'phrase-body';
    const en = document.createElement('div');
    en.className = 'phrase-en';
    en.textContent = phrase.en;
    body.append(en);
    const zh = document.createElement('div');
    zh.className = 'phrase-zh';
    zh.textContent = phrase.zh;
    body.append(zh);
    if (phrase.example) {
      const ex = document.createElement('div');
      ex.className = 'phrase-example';
      ex.textContent = phrase.example;
      body.append(ex);
    }
    item.append(body, speakerButton(phrase.en));
    list.append(item);
  });
  resultBox.append(list);
}

/** 把文字按语块区间切成 span;带语块的片段可被点亮。 */
function fillSegments(el, text, rangesById) {
  el.replaceChildren();
  for (const seg of segments(text, rangesById)) {
    if (!seg.ids.length) { el.append(seg.text); continue; }
    const span = document.createElement('span');
    span.className = 'seg';
    span.dataset.ids = seg.ids.join(',');
    span.textContent = seg.text;
    el.append(span);
  }
}

function speakerButton(text) {
  const btn = document.createElement('button');
  btn.className = 'speaker-btn';
  btn.innerHTML = SPEAKER_SVG;
  btn.addEventListener('click', () => speak(text, btn));
  return btn;
}
