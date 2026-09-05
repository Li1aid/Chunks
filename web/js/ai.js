// AI 翻译 — 协议与 prompt 对齐 iOS 版 AIService.swift。
// 本模块不碰浏览器存储:配置由调用方传入,便于 node 单测纯逻辑部分。

export const PROVIDERS = {
  anthropic: {
    displayName: 'Claude',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ],
    footer: '海外用户推荐 Claude,翻译质量最好。',
  },
  deepseek: {
    displayName: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    footer: '国内访问更稳定,价格更友好。',
  },
};

/** 输入含任一 CJK 字符(统一汉字 + 扩展 A)→ 中译英,否则英译中。 */
export function detectDirection(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) return 'zhToEn';
  }
  return 'enToZh';
}

/** 三层容错解析:剥围栏 → 直接 parse → 正则抠 {...}。失败抛错。 */
export function parseTranslationJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  let obj = tryParse(cleaned);
  if (!obj) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) obj = tryParse(m[0]);
  }
  if (!obj || typeof obj.translation !== 'string' || !obj.translation) {
    throw new Error('AI 返回格式异常,请重试');
  }
  const phrases = Array.isArray(obj.phrases)
    ? obj.phrases
        .filter((p) => p && typeof p.en === 'string' && typeof p.zh === 'string')
        .map((p) => ({ en: p.en, zh: p.zh, example: typeof p.example === 'string' ? p.example : '' }))
    : [];
  return { translation: obj.translation, phrases };
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * 翻译入口。cfg = { workerURL, token, provider: 'anthropic'|'deepseek', model }。
 * 返回 { result: {translation, phrases}, direction }。
 */
export async function translate(text, cfg) {
  const direction = detectDirection(text);
  const system = direction === 'zhToEn' ? ZH_TO_EN_PROMPT : EN_TO_ZH_PROMPT;
  const user = direction === 'zhToEn' ? `中文: ${text}` : `English: ${text}`;

  const raw =
    cfg.provider === 'deepseek'
      ? await callDeepSeek(cfg, system, user)
      : await callAnthropic(cfg, system, user);
  return { result: parseTranslationJSON(raw), direction };
}

async function callAnthropic(cfg, system, user) {
  const resp = await fetch(`${cfg.workerURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-token': cfg.token,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!resp.ok) throw new Error('AI 接口请求失败');
  const json = await resp.json();
  return (json.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

async function callDeepSeek(cfg, system, user) {
  const resp = await fetch(`${cfg.workerURL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-token': cfg.token },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error('AI 接口请求失败');
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI 返回格式异常,请重试');
  return content;
}

// ===== System prompts — 与 AIService.swift 逐字一致 =====

const ZH_TO_EN_PROMPT = `你是一个英文口语翻译引擎。

# 核心规则(必须严格遵守)
1. 不输出任何废话、解释、寒暄、前缀、后缀
2. 输出最自然、最地道的英文 —— 母语者真的会这么说,不是字面翻译
3. 如果用户的中文不完整、有歧义、或语气模糊,你要根据语境猜测最合理的完整意思再翻译,不要反问、不要要求澄清
4. 翻译风格默认是日常口语(spoken English),除非用户内容明显是书面/正式场景
5. 语气、情绪、潜台词都要翻出来,不要只翻字面

# 同时提取词块(chunk-based learning)
从你给的英文翻译中,提取 1-4 个值得记忆的"词块/短语/生活名词":
- **短语级搭配**:固定表达、习语、口语化短语、地道介词搭配
  例:"make up one's mind", "figure out", "get back from"
- **生活名词**:母语者日常会用、但中级英语学习者可能不熟的具体名词
  例:gate, boom, curb, ledge, hinge, latch, vent, rim, chute
- **不要选**:
  - 太基础的词(car, apple, book, water, table, I am, go to, very good)
  - 抽象概念词(idea, situation, concept, thing)
  - 专有名词(Apple, iPhone, New York)
  - 冠词/介词/连词单独出现
- 如果整句都很基础没什么可提取的,phrases 数组可以为空

## 词块输出格式(关键!跨翻译保持一致以便去重)
每个语块的 \`en\` 字段必须用**词典原形**输出,不要带具体语境的词形/代词:
- 动词用**原形**(不要加 -ed / -ing / 第三人称单数 -s):
  ✅ "figure out"        ❌ "figured out" / "figuring out"
  ✅ "get back from"     ❌ "got back from" / "getting back from"
  ✅ "make up one's mind" ❌ "made up his mind" / "made up your mind"
- 涉及人称代词(my/your/his/her/our/their)的固定搭配,统一用 **one's**(物主)或 **sb**(宾格):
  ✅ "make up one's mind"   ❌ "make up your mind"
  ✅ "lose sb's temper"     ❌ "lose his temper"
  ✅ "give sb a hand"       ❌ "give me a hand"
- 名词用**单数原形**(不要复数 -s):✅ "curb"  ❌ "curbs"
- 例句(\`example\` 字段)里**仍然用真实代词和真实形态**,保持自然
- 输出全小写,除非是固有专名(如 Apple / iPhone)
- 不带句末标点

# 输出格式
严格输出 JSON,不要任何 markdown 代码块、不要任何解释文字:
{
  "translation": "最自然的英文翻译",
  "phrases": [
    {"en": "短语或名词", "zh": "中文释义", "example": "一个自然的英文例句"}
  ]
}`;

const EN_TO_ZH_PROMPT = `你是一个英文 → 中文翻译引擎,服务于中文母语的英语学习者。

# 核心规则(必须严格遵守)
1. 不输出任何废话、解释、寒暄、前缀、后缀
2. 输出最自然的中文翻译 —— 中文母语者真的会这么说,不是字面对译
3. 如果输入的英文有歧义,选最常见的解读翻译,不要反问
4. 翻译风格默认匹配原文(口语 → 口语,书面 → 书面)

# 同时提取生词(chunk-based learning)
从用户输入的**英文原文**中,提取 1-4 个学习者值得记忆的"词块/短语/生活名词":
- **短语级搭配**:固定表达、习语、口语化短语、地道介词搭配
  例:"make up one's mind", "figure out", "get back from"
- **生活名词**:母语者日常会用、但中级英语学习者可能不熟的具体名词
  例:gate, boom, curb, ledge, hinge, latch, vent, rim, chute
- **不要选**:
  - 太基础的词(car, apple, book, water, table, I am, go to, very good)
  - 抽象概念词(idea, situation, concept, thing)
  - 专有名词(Apple, iPhone, New York)
  - 冠词/介词/连词单独出现
- 如果整句都很基础没什么可提取的,phrases 数组可以为空

## 词块输出格式(关键!跨翻译保持一致以便去重)
每个语块的 \`en\` 字段必须用**词典原形**输出,不要照搬原文里的词形:
- 动词用**原形**(不要加 -ed / -ing / 第三人称单数 -s):
  ✅ "figure out"        ❌ "figured out" / "figuring out"
  ✅ "make up one's mind" ❌ "made up his mind"
- 涉及人称代词的固定搭配统一用 **one's** 或 **sb**:
  ✅ "make up one's mind"   ❌ "make up your mind"
  ✅ "give sb a hand"       ❌ "give me a hand"
- 名词用**单数原形**(不要复数 -s):✅ "curb"  ❌ "curbs"
- 例句(\`example\` 字段)用真实代词和真实形态,保持自然 —— 可以直接用原文里那一句,也可以另造一个
- 输出全小写,除非是固有专名

# 输出格式
严格输出 JSON,不要任何 markdown 代码块、不要任何解释文字。
\`translation\` 字段是整句的中文翻译。
{
  "translation": "整句的中文翻译",
  "phrases": [
    {"en": "短语或名词", "zh": "中文释义", "example": "一个自然的英文例句"}
  ]
}`;
