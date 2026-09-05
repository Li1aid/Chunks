// SpeechSynthesis 朗读 — 对齐 iOS SpeechService 的意图:
// 挑最好的英文 voice(名称含 Premium > Enhanced > 其余),同质量内 en-US > en-GB > 其他。
// 已知差异:web 无法绕过 iOS 静音键;质量只能靠名称启发式判断。

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
  // iOS Safari 的 voices 列表异步加载,就绪后重挑一次
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    voice = pickBestVoice();
    picked = voice !== null;
  });
}

/** 朗读英文,重复调用打断上一次。 */
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = ensureVoice();
  if (v) u.voice = v;
  u.lang = 'en-US';
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** 系统设置里下载了新语音后手动重挑。 */
export function refreshVoice() {
  voice = pickBestVoice();
  picked = voice !== null;
  return voiceLabel();
}

/** 给设置页显示:「名字 · 高级/增强/标准」。 */
export function voiceLabel() {
  const v = ensureVoice();
  if (!v) return '未找到英文语音';
  const q = ['高级', '增强', '标准'][qualityRank(v)];
  return `${v.name} · ${q}`;
}
