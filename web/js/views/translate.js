// 翻译 tab — 行为对齐 iOS TranslateView:自动检测方向、自动保存、语块去重、保存横幅。

import { translate } from '../ai.js';
import { makeCard, normalizeEn } from '../card.js';
import { getAllCards, putCards } from '../db.js';
import { scheduleSync } from '../sync.js';
import { isConfigured, getWorkerURL, getToken, getProvider, getModel } from '../settings.js';
import { speak, SPEAKER_SVG } from '../speech.js';

let root;
let input, translateBtn, errorBox, resultBox;
let translating = false;

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="large-title">翻译</div>
    <textarea class="input" rows="3" placeholder="输入中文或英文" enterkeyhint="done"></textarea>
    <button class="btn-primary">翻译</button>
    <div class="error-slot"></div>
    <div class="result-slot"></div>
  `;
  input = root.querySelector('textarea');
  translateBtn = root.querySelector('.btn-primary');
  errorBox = root.querySelector('.error-slot');
  resultBox = root.querySelector('.result-slot');

  input.addEventListener('input', updateButton);
  translateBtn.addEventListener('click', run);
  updateButton();
}

export function show() {
  updateButton();
}

function updateButton() {
  translateBtn.disabled = !input.value.trim() || translating || !isConfigured();
  translateBtn.textContent = translating ? '翻译中…' : '翻译';
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
  retry.textContent = '重试';
  retry.addEventListener('click', run);
  banner.append(text, retry);
  errorBox.append(banner);
}

async function run() {
  const text = input.value.trim();
  if (!text || translating) return;
  if (!isConfigured()) {
    showError('请先在「设置」配置 Worker 地址和口令');
    return;
  }

  translating = true;
  updateButton();
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
    const saved = await autoSave(text, result, direction);
    render(result, direction, saved);
  } catch (e) {
    showError(e instanceof TypeError ? '网络连接失败' : e.message || '翻译失败');
  }

  translating = false;
  updateButton();
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

function render(result, direction, savedInfo) {
  resultBox.innerHTML = '';

  // 结果卡(EN→ZH 不显示喇叭:中文 TTS 不是核心场景)
  const card = document.createElement('div');
  card.className = 'card result-row';
  const text = document.createElement('div');
  text.className = 'result-text';
  text.textContent = result.translation;
  card.append(text);
  if (direction === 'zhToEn') {
    card.append(speakerButton(result.translation));
  }
  resultBox.append(card);

  // 保存横幅
  const { saved, skipped } = savedInfo;
  const banner = document.createElement('div');
  if (saved > 0) {
    banner.className = 'banner green';
    banner.textContent = skipped > 0 ? `已保存 ${saved} 张，语块已存在` : `已保存 ${saved} 张`;
  } else if (skipped > 0) {
    banner.className = 'banner gray';
    banner.textContent = '语块已存在';
  } else {
    banner.className = 'banner green';
    banner.textContent = '已保存';
  }
  resultBox.append(banner);

  // 语块/生词列表
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = direction === 'zhToEn' ? '语块' : '生词';
  resultBox.append(label);

  if (result.phrases.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'hint-empty';
    hint.textContent = direction === 'zhToEn'
      ? '这一句没有提取到值得记忆的语块，已保存整句卡'
      : '这一句没有提取到值得记忆的生词，已保存整句卡';
    resultBox.append(hint);
    return;
  }

  const list = document.createElement('div');
  list.className = 'card';
  list.style.padding = '0';
  for (const phrase of result.phrases) {
    const item = document.createElement('div');
    item.className = 'phrase-item';
    const en = document.createElement('div');
    en.className = 'phrase-en';
    en.textContent = phrase.en;
    item.append(en);
    const zh = document.createElement('div');
    zh.className = 'phrase-zh';
    zh.textContent = phrase.zh;
    item.append(zh);
    if (phrase.example) {
      const ex = document.createElement('div');
      ex.className = 'phrase-example';
      ex.textContent = phrase.example;
      item.append(ex);
    }
    list.append(item);
  }
  resultBox.append(list);
}

function speakerButton(text) {
  const btn = document.createElement('button');
  btn.className = 'speaker-btn';
  btn.innerHTML = SPEAKER_SVG;
  btn.addEventListener('click', () => speak(text));
  return btn;
}
