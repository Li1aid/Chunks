// 配置读写(localStorage)— 键位与 iOS UserDefaults 对应。
// 口令明文存 localStorage:web 无 Keychain,个人自用 + HTTPS,是接受的取舍。

import { PROVIDERS } from './ai.js';

const get = (key) => localStorage.getItem(key);
const getNum = (key) => Number(localStorage.getItem(key)) || 0;
const set = (key, value) => localStorage.setItem(key, String(value));

export function getWorkerURL() {
  return (get('workerURL') ?? '').trim().replace(/\/+$/, '');
}
export function setWorkerURL(url) {
  set('workerURL', url.trim().replace(/\/+$/, ''));
}

export const getToken = () => get('appToken') ?? '';
export const setToken = (t) => set('appToken', t.trim());

export function isConfigured() {
  return !!getWorkerURL() && !!getToken();
}

// 默认 provider 对齐 iOS 的 region==CN 规则:zh-CN / zh-Hans 语言环境 → DeepSeek
export function getProvider() {
  const saved = get('aiProvider');
  if (saved && PROVIDERS[saved]) return saved;
  const lang = navigator.language || '';
  return lang.startsWith('zh-CN') || lang.startsWith('zh-Hans') ? 'deepseek' : 'anthropic';
}
export const setProvider = (p) => set('aiProvider', p);

export function getModel(provider) {
  return get(`aiModel_${provider}`) ?? PROVIDERS[provider].defaultModel;
}
export const setModel = (provider, model) => set(`aiModel_${provider}`, model);

// 朗读引擎:remote = Worker TTS(默认),local = 浏览器 SpeechSynthesis
export function getTTSEngine() {
  return get('ttsEngine') === 'local' ? 'local' : 'remote';
}
export const setTTSEngine = (v) => set('ttsEngine', v);

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
