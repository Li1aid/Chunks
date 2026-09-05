// 朗读 — 两个引擎:
// remote(默认):Worker /tts(Deepgram aura-1)生成 MP3,IndexedDB 按文本缓存,
//   同一语块只请求一次,之后瞬时播放且离线可用;任何失败回落本地。
// local:浏览器 SpeechSynthesis。iOS 网页只开放一小组标准语音(隐私限制),
//   挑选逻辑按 名称含 Premium > Enhanced > 其余、en-US > en-GB 排序,尽力而为。

import { getWorkerURL, getToken, isConfigured, getTTSEngine, getTTSVoice, getTTSRate } from './settings.js';

/** 喇叭图标 — 三个 tab 共用。 */
export const SPEAKER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 8.5H3.5v7h3L11 19V5z" fill="currentColor" stroke="none"/><path d="M14.5 9a4 4 0 0 1 0 6M17 6.5a7.5 7.5 0 0 1 0 11"/></svg>';

/** aura-1 的 12 个音色 — 设置页选择用,id 与 Worker 白名单一致。 */
export const TTS_VOICES = [
  { id: 'luna', label: '露娜(女·柔和)' },
  { id: 'asteria', label: '阿斯特里亚(女·清晰)' },
  { id: 'stella', label: '斯特拉(女)' },
  { id: 'hera', label: '赫拉(女)' },
  { id: 'athena', label: '雅典娜(女·英音)' },
  { id: 'orion', label: '俄里翁(男·沉稳)' },
  { id: 'arcas', label: '阿卡斯(男)' },
  { id: 'perseus', label: '珀尔修斯(男)' },
  { id: 'orpheus', label: '俄耳甫斯(男)' },
  { id: 'zeus', label: '宙斯(男·浑厚)' },
  { id: 'helios', label: '赫利俄斯(男·英音)' },
  { id: 'angus', label: '安格斯(男·爱尔兰)' },
];

/** 朗读入口:重复调用打断上一次。 */
export function speak(text) {
  if (getTTSEngine() === 'remote' && isConfigured()) {
    speakRemote(text).catch(() => speakLocal(text));
    return;
  }
  speakLocal(text);
}

// ===== 在线引擎 =====

// 共享同一个 <audio> 实例:在 iOS 上比每次新建更不容易触发手势播放限制
const player = typeof Audio !== 'undefined' ? new Audio() : null;

async function speakRemote(text) {
  if (!player) throw new Error('no audio');
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  // 缓存键带音色:换音色不会放出旧声音的缓存
  const voice = getTTSVoice();
  const key = `${voice}|${text}`;
  let buf = await cacheGet(key).catch(() => null);
  if (!buf) {
    const resp = await fetch(`${getWorkerURL()}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-token': getToken() },
      body: JSON.stringify({ text, speaker: voice }),
    });
    if (!resp.ok) throw new Error(`tts ${resp.status}`);
    buf = await resp.arrayBuffer();
    if (buf.byteLength < 200) throw new Error('tts empty');
    cachePut(key, buf).catch(() => {});
  }

  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
  player.pause();
  player.src = url;
  // 变速不变调,对缓存音频同样即时生效
  player.preservesPitch = true;
  player.defaultPlaybackRate = getTTSRate();
  player.playbackRate = getTTSRate();
  player.onended = () => URL.revokeObjectURL(url);
  player.onerror = () => URL.revokeObjectURL(url);
  await player.play();
}

// 音频缓存:独立小库,不和卡片数据掺和
let ttsDbPromise = null;

function openTTSDb() {
  if (!ttsDbPromise) {
    ttsDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('chunks-tts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('audio');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return ttsDbPromise;
}

async function cacheGet(text) {
  const db = await openTTSDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('audio', 'readonly').objectStore('audio').get(text);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cachePut(text, buf) {
  const db = await openTTSDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('audio', 'readwrite').objectStore('audio').put(buf, text);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ===== 本地引擎(SpeechSynthesis)=====

let voice = null;
let picked = false;

function qualityRank(v) {
  const name = v.name.toLowerCase();
  if (name.includes('premium')) return 0;
  if (name.includes('enhanced')) return 1;
  return 2;
}

function regionRank(v) {
  if (v.lang === 'en-US') return 0;
  if (v.lang === 'en-GB') return 1;
  return 2;
}

function pickBestVoice() {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  english.sort((a, b) => qualityRank(a) - qualityRank(b) || regionRank(a) - regionRank(b));
  return english[0] ?? null;
}

function ensureVoice() {
  if (!picked) {
    voice = pickBestVoice();
    picked = voice !== null;
  }
  return voice;
}

if ('speechSynthesis' in window) {
  const repick = () => {
    voice = pickBestVoice();
    picked = voice !== null;
  };
  speechSynthesis.addEventListener?.('voiceschanged', repick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') repick();
  });
}

function speakLocal(text) {
  if (!('speechSynthesis' in window)) return;
  player?.pause();
  const u = new SpeechSynthesisUtterance(text);
  const v = ensureVoice();
  if (v) u.voice = v;
  u.lang = 'en-US';
  u.rate = getTTSRate();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
