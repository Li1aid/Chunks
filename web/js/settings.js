// 配置读写(localStorage)— 键位与 iOS UserDefaults 对应。
// 口令明文存 localStorage:web 无 Keychain,个人自用 + HTTPS,是接受的取舍。

import { PROVIDERS } from './ai.js';

const get = (key) => localStorage.getItem(key);

// 演示模式(给评审的公开链接 ?demo):连到公开 Worker,口令固定为 demo,不同步,数据存在独立的本地库。
// 只覆盖读取结果,不改写你自己保存的服务器配置。
export const DEMO_WORKER_URL = 'https://flashcards.aidenyang5995.workers.dev';
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  try { localStorage.setItem('demo', '1'); } catch { /* 无痕模式等 */ }
}
export const isDemo = () => { try { return localStorage.getItem('demo') === '1'; } catch { return false; } };
export function exitDemo() {
  localStorage.removeItem('demo');
  location.replace(location.pathname);
}
const getNum = (key) => Number(localStorage.getItem(key)) || 0;
const set = (key, value) => localStorage.setItem(key, String(value));

export function getWorkerURL() {
  if (isDemo()) return DEMO_WORKER_URL;
  return (get('workerURL') ?? '').trim().replace(/\/+$/, '');
}
export function setWorkerURL(url) {
  set('workerURL', url.trim().replace(/\/+$/, ''));
}

export const getToken = () => (isDemo() ? 'demo' : get('appToken') ?? '');
export const setToken = (t) => set('appToken', t.trim());

export function isConfigured() {
  return !!getWorkerURL() && !!getToken();
}

// 默认 provider 对齐 iOS 的 region==CN 规则:zh-CN / zh-Hans 语言环境 → DeepSeek
export function getProvider() {
  if (isDemo()) return 'anthropic';
  const saved = get('aiProvider');
  if (saved && PROVIDERS[saved]) return saved;
  const lang = navigator.language || '';
  return lang.startsWith('zh-CN') || lang.startsWith('zh-Hans') ? 'deepseek' : 'anthropic';
}
export const setProvider = (p) => set('aiProvider', p);

export function getModel(provider) {
  if (isDemo()) return 'claude-sonnet-4-6';
  return get(`aiModel_${provider}`) ?? PROVIDERS[provider].defaultModel;
}
export const setModel = (provider, model) => set(`aiModel_${provider}`, model);

// 朗读引擎:remote = Worker TTS(默认),local = 浏览器 SpeechSynthesis
export function getTTSEngine() {
  return get('ttsEngine') === 'local' ? 'local' : 'remote';
}
export const setTTSEngine = (v) => set('ttsEngine', v);

// 在线音色(aura-1 speaker id)与语速(0.8 / 1 / 1.2,双引擎共用)
export const getTTSVoice = () => get('ttsVoice') ?? 'luna';
export const setTTSVoice = (v) => set('ttsVoice', v);
export function getTTSRate() {
  const r = Number(get('ttsRate'));
  return r === 0.8 || r === 1.2 ? r : 1;
}
export const setTTSRate = (r) => set('ttsRate', r);

export function getReviewDirection() {
  const v = get('reviewDirection');
  return v === 'enToZh' ? 'enToZh' : 'zhToEn';
}
export const setReviewDirection = (d) => set('reviewDirection', d);

// 同步游标:pull 用服务端时间,push 用本地时间,互相独立以避免时钟偏差
export const getLastPullServerTime = () => getNum('lastPullServerTime');
export const setLastPullServerTime = (t) => set('lastPullServerTime', t);
export const getLastPushAt = () => getNum('lastPushAt');
export const setLastPushAt = (t) => set('lastPushAt', t);
export const getLastSyncAt = () => getNum('lastSyncAt');
export const setLastSyncAt = (t) => set('lastSyncAt', t);

export function clearSyncCursors() {
  localStorage.removeItem('lastPullServerTime');
  localStorage.removeItem('lastPushAt');
  localStorage.removeItem('lastSyncAt');
}
