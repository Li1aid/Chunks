// 设置 tab — 分节对齐 iOS SettingsView:服务器 / AI / 云同步 / 复习 / 语音 / 数据。

import { PROVIDERS } from '../ai.js';
import { getAllCards } from '../db.js';
import { syncNow, resetSync, onStatus, statusText, isSyncing, scheduleSync } from '../sync.js';
import {
  getWorkerURL, setWorkerURL, getToken, setToken, isConfigured,
  getProvider, setProvider, getModel, setModel,
  getReviewDirection, setReviewDirection,
  getTTSEngine, setTTSEngine, getTTSVoice, setTTSVoice, getTTSRate, setTTSRate,
} from '../settings.js';
import { speak, TTS_VOICES } from '../speech.js';

let root;
let urlInput, tokenInput, providerSelect, modelSelect, aiFooter;
let statusValue, syncBtn, resetBtn, directionSelect, countValue;
let ttsSelect, ttsVoiceSelect, ttsRateSelect;

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="large-title">设置</div>

    <div class="section-label">服务器</div>
    <div class="form-card">
      <div class="form-row"><input class="url-input" type="url" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      <div class="form-row"><input class="token-input" type="password" autocapitalize="off"></div>
      <button class="row-btn save-btn">保存</button>
    </div>

    <div class="section-label" style="padding-top:16px">AI</div>
    <div class="form-card">
      <div class="form-row"><span class="label">引擎</span><select class="provider-select"></select></div>
      <div class="form-row"><span class="label">模型</span><select class="model-select"></select></div>
    </div>
    <div class="form-footer ai-footer"></div>

    <div class="section-label">云同步</div>
    <div class="form-card">
      <div class="form-row"><span class="label">状态</span><span class="value status-value"></span></div>
      <button class="row-btn sync-btn">立即同步</button>
      <button class="row-btn destructive reset-btn">重置同步</button>
    </div>

    <div class="section-label" style="padding-top:16px">复习</div>
    <div class="form-card">
      <div class="form-row"><span class="label">方向</span><select class="direction-select">
        <option value="zhToEn">中 → 英</option>
        <option value="enToZh">英 → 中</option>
      </select></div>
    </div>

    <div class="section-label" style="padding-top:16px">语音</div>
    <div class="form-card">
      <div class="form-row"><span class="label">朗读引擎</span><select class="tts-select">
        <option value="remote">在线高音质</option>
        <option value="local">本地系统</option>
      </select></div>
      <div class="form-row"><span class="label">音色</span><select class="tts-voice-select"></select></div>
      <div class="form-row"><span class="label">语速</span><select class="tts-rate-select">
        <option value="0.8">慢</option>
        <option value="1">正常</option>
        <option value="1.2">快</option>
      </select></div>
    </div>
    <div class="form-footer">在线引擎(Deepgram aura)经由你的 Worker 生成:每个语块首次朗读需联网约 1 秒,之后本机缓存、离线可放;失败时自动回落本地系统语音。切换音色或语速会立刻试听一句。音色仅在线引擎有效。</div>

    <div class="section-label">数据</div>
    <div class="form-card">
      <div class="form-row"><span class="label">总卡片数</span><span class="value count-value"></span></div>
    </div>
  `;

  urlInput = root.querySelector('.url-input');
  tokenInput = root.querySelector('.token-input');
  providerSelect = root.querySelector('.provider-select');
  modelSelect = root.querySelector('.model-select');
  aiFooter = root.querySelector('.ai-footer');
  statusValue = root.querySelector('.status-value');
  syncBtn = root.querySelector('.sync-btn');
  resetBtn = root.querySelector('.reset-btn');
  directionSelect = root.querySelector('.direction-select');
  ttsSelect = root.querySelector('.tts-select');
  ttsVoiceSelect = root.querySelector('.tts-voice-select');
  ttsRateSelect = root.querySelector('.tts-rate-select');
  countValue = root.querySelector('.count-value');

  for (const [id, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.displayName;
    providerSelect.append(opt);
  }

  for (const v of TTS_VOICES) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label;
    ttsVoiceSelect.append(opt);
  }

  root.querySelector('.save-btn').addEventListener('click', save);
  providerSelect.addEventListener('change', () => {
    setProvider(providerSelect.value);
    refreshAI();
  });
  modelSelect.addEventListener('change', () => setModel(getProvider(), modelSelect.value));
  directionSelect.addEventListener('change', () => setReviewDirection(directionSelect.value));
  syncBtn.addEventListener('click', () => syncNow());
  resetBtn.addEventListener('click', async () => {
    if (!confirm('重置同步?本地卡片将清空并从云端全量重拉。')) return;
    await resetSync();
    refreshCount();
  });
  const SAMPLE = "Hello! I'm your new voice.";
  ttsSelect.addEventListener('change', () => {
    setTTSEngine(ttsSelect.value);
    ttsVoiceSelect.disabled = ttsSelect.value === 'local';
    speak(SAMPLE);
  });
  ttsVoiceSelect.addEventListener('change', () => {
    setTTSVoice(ttsVoiceSelect.value);
    speak(SAMPLE);
  });
  ttsRateSelect.addEventListener('change', () => {
    setTTSRate(ttsRateSelect.value);
    speak(SAMPLE);
  });

  onStatus((s) => {
    statusValue.textContent = statusText(s);
    const disabled = !isConfigured() || s.kind === 'syncing';
    syncBtn.disabled = disabled;
    resetBtn.disabled = disabled;
  });

  refreshAll();
}

export function show() {
  refreshAll();
}

function refreshAll() {
  const savedURL = getWorkerURL();
  urlInput.placeholder = savedURL || 'https://...workers.dev';
  const token = getToken();
  tokenInput.placeholder = token ? `已保存 ····${token.slice(-4)}` : '输入口令';

  refreshAI();
  directionSelect.value = getReviewDirection();
  ttsSelect.value = getTTSEngine();
  ttsVoiceSelect.value = getTTSVoice();
  ttsVoiceSelect.disabled = getTTSEngine() === 'local';
  ttsRateSelect.value = String(getTTSRate());
  syncBtn.disabled = !isConfigured() || isSyncing();
  resetBtn.disabled = !isConfigured() || isSyncing();
  refreshCount();
}

function refreshAI() {
  const provider = getProvider();
  providerSelect.value = provider;
  modelSelect.innerHTML = '';
  for (const m of PROVIDERS[provider].models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.append(opt);
  }
  modelSelect.value = getModel(provider);
  aiFooter.textContent = PROVIDERS[provider].footer;
}

async function refreshCount() {
  const all = await getAllCards();
  countValue.textContent = all.filter((c) => !c.deleted).length;
}

function save() {
  const url = urlInput.value.trim().replace(/\/+$/, '');
  if (url) setWorkerURL(url);
  const token = tokenInput.value.trim();
  if (token) setToken(token);
  urlInput.value = '';
  tokenInput.value = '';
  refreshAll();
  if (isConfigured()) scheduleSync(300);
}
