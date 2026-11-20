// 设置 tab — 分节对齐 iOS SettingsView:服务器 / AI / 云同步 / 复习 / 语音 / 数据。

import { PROVIDERS } from '../ai.js';
import { getAllCards } from '../db.js';
import { syncNow, resetSync, onStatus, statusText, isSyncing, scheduleSync } from '../sync.js';
import {
  isDemo, isDemoHost, exitDemo,
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
    <div class="large-title">Settings</div>

    <div class="demo-sec">
      <div class="section-label">Demo</div>
      <div class="form-card">
        <div class="form-row"><span class="label">Mode</span><span class="value">Public demo</span></div>
        <button class="row-btn exit-demo-btn">Exit Demo</button>
      </div>
      <div class="form-footer">Translations use the real AI, limited per day. Sample cards stay on this device and never sync.</div>
    </div>

    <div class="sec-hide-demo">
    <div class="section-label">Server</div>
    <div class="form-card">
      <div class="form-row"><input class="url-input" type="url" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      <div class="form-row"><input class="token-input" type="password" autocapitalize="off"></div>
      <button class="row-btn save-btn">Save</button>
    </div>

    <div class="section-label" style="padding-top:16px">AI</div>
    <div class="form-card">
      <div class="form-row"><span class="label">Provider</span><select class="provider-select"></select></div>
      <div class="form-row"><span class="label">Model</span><select class="model-select"></select></div>
    </div>
    <div class="form-footer ai-footer"></div>

    <div class="section-label">Sync</div>
    <div class="form-card">
      <div class="form-row"><span class="label">Status</span><span class="value status-value"></span></div>
      <button class="row-btn sync-btn">Sync Now</button>
      <button class="row-btn destructive reset-btn">Reset Sync</button>
    </div>

    </div>

    <div class="section-label" style="padding-top:16px">Review</div>
    <div class="form-card">
      <div class="form-row"><span class="label">Direction</span><select class="direction-select">
        <option value="zhToEn">Chinese → English</option>
        <option value="enToZh">English → Chinese</option>
      </select></div>
    </div>

    <div class="section-label" style="padding-top:16px">Voice</div>
    <div class="form-card">
      <div class="form-row"><span class="label">Engine</span><select class="tts-select">
        <option value="remote">Online (HD)</option>
        <option value="local">On-device</option>
      </select></div>
      <div class="form-row"><span class="label">Voice</span><select class="tts-voice-select"></select></div>
      <div class="form-row"><span class="label">Speed</span><select class="tts-rate-select">
        <option value="0.8">Slow</option>
        <option value="1">Normal</option>
        <option value="1.2">Fast</option>
      </select></div>
    </div>
    <div class="form-footer">The online engine (Deepgram Aura) runs through your Worker. Each phrase needs about a second online the first time, then plays from the device cache, even offline. If it fails, the on-device voice takes over. Changing voice or speed plays a sample. Voices apply to the online engine only.</div>

    <div class="section-label">Data</div>
    <div class="form-card">
      <div class="form-row"><span class="label">Cards</span><span class="value count-value"></span></div>
    </div>

    <div class="section-label" style="padding-top:16px">About</div>
    <div class="form-card">
      <div class="form-row"><span class="label">Version</span><span class="value">2026.11.20-01</span></div>
      <button class="row-btn copy-url-btn">Copy App Link</button>
    </div>
    <div class="form-footer copy-url-status" role="status"></div>
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

  root.querySelector('.demo-sec').hidden = !isDemo();
  root.querySelector('.sec-hide-demo').hidden = isDemo();
  root.querySelector('.exit-demo-btn').addEventListener('click', exitDemo);
  root.querySelector('.exit-demo-btn').hidden = isDemoHost(); // 演示专用网址上不提供退出
  root.querySelector('.save-btn').addEventListener('click', save);
  root.querySelector('.copy-url-btn').addEventListener('click', async () => {
    const status = root.querySelector('.copy-url-status');
    const url = new URL('./', location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Link copied';
    } catch {
      status.textContent = `App link: ${url}`;
    }
  });
  providerSelect.addEventListener('change', () => {
    setProvider(providerSelect.value);
    refreshAI();
  });
  modelSelect.addEventListener('change', () => setModel(getProvider(), modelSelect.value));
  directionSelect.addEventListener('change', () => setReviewDirection(directionSelect.value));
  syncBtn.addEventListener('click', () => syncNow());
  resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset sync? Cards on this device will be cleared and downloaded again from the cloud.')) return;
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
  tokenInput.placeholder = token ? `Saved ····${token.slice(-4)}` : 'Token';

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
