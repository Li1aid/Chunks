// Cloudflare Worker — 「语块」后端
//
// 提供四类服务:
//   1. /v1/messages          - Anthropic API 代理
//   2. /v1/chat/completions  - DeepSeek API 代理(OpenAI 兼容格式)
//   3. /sync/*               - 卡片云同步(D1 数据库)
//   4. /tts                  - 文本转语音(Workers AI / Deepgram aura-1)
//
// 所有路由都用 ALLOWED_TOKEN 口令保护。
// 例外:公开演示口令 "demo"(给作品集/求职评审用)只能调 /v1/messages 和 /tts,
// 按 IP 每天限次 + 全站每日上限,模型固定,不能碰 /sync 和 DeepSeek。
//
// 环境变量:
//   ANTHROPIC_API_KEY  (Secret)  你的 Anthropic key
//   DEEPSEEK_API_KEY   (Secret)  你的 DeepSeek key(国区用户用)
//   ALLOWED_TOKEN      (Secret)  自定义口令
//
// 绑定:
//   D1 Database  绑定名 "DB"
//   Workers AI   绑定名 "AI"

const ANTHROPIC_BASE = 'https://api.anthropic.com';

// ===== 公开演示 =====
const DEMO_TOKEN = 'demo';
const DEMO_MODEL = 'claude-sonnet-4-6';
const DEMO_LIMITS = { translate: 20, tts: 60 };        // 每个 IP 每天
const DEMO_GLOBAL = { translate: 300, tts: 1000 };     // 全站每天
const DEMO_MAX_INPUT = 300;                            // 每句最多字符数
const DEEPSEEK_BASE = 'https://api.deepseek.com';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // 所有路由都校验口令(公开演示口令走单独的受限通道)
    const appToken = request.headers.get('x-app-token');
    if (appToken === DEMO_TOKEN) {
      try {
        return await handleDemo(request, env, url);
      } catch (err) {
        return json({ error: String(err && err.message || err) }, 500);
      }
    }
    if (!env.ALLOWED_TOKEN || appToken !== env.ALLOWED_TOKEN) {
      return json({ error: 'Unauthorized' }, 401);
    }

    try {
      if (url.pathname === '/v1/messages') {
        return await handleAnthropic(request, env, url);
      }
      if (url.pathname === '/v1/chat/completions') {
        return await handleDeepSeek(request, env, url);
      }
      if (url.pathname.startsWith('/sync/')) {
        return await handleSync(request, env, url);
      }
      if (url.pathname === '/tts') {
        return await handleTTS(request, env);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};

// ===== 公开演示:限次的翻译和朗读 =====
async function handleDemo(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  if (url.pathname === '/v1/messages') {
    const body = await request.json().catch(() => null);
    const msgs = body && Array.isArray(body.messages) ? body.messages : [];
    const text = msgs.length === 1 && typeof msgs[0].content === 'string' ? msgs[0].content : '';
    const system = body && typeof body.system === 'string' ? body.system : '';
    if (!text || text.length > DEMO_MAX_INPUT + 20 || system.length > 8000) {
      return json({ error: 'Demo accepts one short sentence at a time.' }, 400);
    }
    const quota = await takeDemoQuota(env, request, 'translate');
    if (quota) return quota;
    const upstream = await fetch(ANTHROPIC_BASE + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DEMO_MODEL,
        max_tokens: Math.min(Number(body.max_tokens) || 1500, 1500),
        system,
        messages: [{ role: 'user', content: text }],
      }),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', ...corsHeaders() },
    });
  }
  if (url.pathname === '/tts') {
    const quota = await takeDemoQuota(env, request, 'tts');
    if (quota) return quota;
    return handleTTS(request, env);
  }
  return json({ error: 'Not available in demo' }, 403);
}

// 计数 +1;超限返回 429 响应,否则返回 null。IP 只存哈希,不存原文。
async function takeDemoQuota(env, request, kind) {
  if (!env.DB) return json({ error: 'Demo unavailable' }, 503);
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS demo_usage (day TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key))'
  ).run();
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hash = await sha256(day + '|' + ip);
  const bump = (key) => env.DB.prepare(
    'INSERT INTO demo_usage (day, key, count) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET count = count + 1 RETURNING count'
  ).bind(day, key).first('count');
  const all = await bump(`all:${kind}`);
  if (all > DEMO_GLOBAL[kind]) return json({ error: 'Demo limit reached for today' }, 429);
  const mine = await bump(`ip:${kind}:${hash}`);
  if (mine > DEMO_LIMITS[kind]) return json({ error: 'Demo limit reached for today' }, 429);
  return null;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ===== Anthropic 代理 =====
async function handleAnthropic(request, env, url) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Worker 未配置 ANTHROPIC_API_KEY' }, 500);
  }
  const upstreamUrl = ANTHROPIC_BASE + url.pathname + url.search;
  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
    },
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
  });
  const respBody = await upstreamRes.text();
  return new Response(respBody, {
    status: upstreamRes.status,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') || 'application/json',
      ...corsHeaders(),
    },
  });
}

// ===== DeepSeek 代理(OpenAI 兼容协议)=====
async function handleDeepSeek(request, env, url) {
  if (!env.DEEPSEEK_API_KEY) {
    return json({ error: 'Worker 未配置 DEEPSEEK_API_KEY' }, 500);
  }
  const upstreamUrl = DEEPSEEK_BASE + url.pathname + url.search;
  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
  });
  const respBody = await upstreamRes.text();
  return new Response(respBody, {
    status: upstreamRes.status,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') || 'application/json',
      ...corsHeaders(),
    },
  });
}

// ===== 卡片云同步 =====
async function handleSync(request, env, url) {
  if (!env.DB) {
    return json({ error: 'Worker 未绑定 D1 数据库(绑定名应为 DB)' }, 500);
  }

  // GET /sync/cards?since=<ts>  拉取自 since 之后变更过的卡片
  if (request.method === 'GET' && url.pathname === '/sync/cards') {
    const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
    const { results } = await env.DB
      .prepare('SELECT * FROM cards WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 5000')
      .bind(since)
      .all();
    const cards = (results || []).map(rowToCard);
    const serverTime = Date.now();
    return json({ cards, serverTime });
  }

  // POST /sync/cards  body: { cards: [...] }  upsert 一批卡片
  if (request.method === 'POST' && url.pathname === '/sync/cards') {
    const body = await request.json();
    const cards = Array.isArray(body && body.cards) ? body.cards : [];
    if (cards.length === 0) {
      return json({ ok: true, written: 0, serverTime: Date.now() });
    }
    if (cards.length > 1000) {
      return json({ error: 'batch too large' }, 400);
    }

    // 单条 upsert(D1 的 batch 在 wrangler 上更顺手,这里逐条简单可靠)
    let written = 0;
    for (const c of cards) {
      if (!c || !c.id) continue;
      const row = cardToRow(c);
      await env.DB.prepare(`
        INSERT INTO cards
          (id, en, zh, example, usage, source_zh, source_en, scene,
           created_at, ease, interval, reps, due, last_review, deleted, updated_at,
           stability, difficulty, state, lapses)
        VALUES
          (?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          en=excluded.en, zh=excluded.zh, example=excluded.example, usage=excluded.usage,
          source_zh=excluded.source_zh, source_en=excluded.source_en, scene=excluded.scene,
          created_at=excluded.created_at, ease=excluded.ease, interval=excluded.interval,
          reps=excluded.reps, due=excluded.due, last_review=excluded.last_review,
          deleted=excluded.deleted, updated_at=excluded.updated_at,
          stability=excluded.stability, difficulty=excluded.difficulty,
          state=excluded.state, lapses=excluded.lapses
        WHERE excluded.updated_at > cards.updated_at
      `).bind(
        row.id, row.en, row.zh, row.example, row.usage, row.source_zh, row.source_en, row.scene,
        row.created_at, row.ease, row.interval, row.reps, row.due, row.last_review, row.deleted, row.updated_at,
        row.stability, row.difficulty, row.state, row.lapses
      ).run();
      written++;
    }
    return json({ ok: true, written, serverTime: Date.now() });
  }

  return json({ error: 'Not found' }, 404);
}

function rowToCard(r) {
  return {
    id: r.id,
    en: r.en || '',
    zh: r.zh || '',
    example: r.example || '',
    usage: r.usage || '',
    sourceZh: r.source_zh || '',
    sourceEn: r.source_en || '',
    scene: r.scene || '',
    createdAt: Number(r.created_at) || 0,
    ease: Number(r.ease) || 2.5,
    interval: Number(r.interval) || 0,
    reps: Number(r.reps) || 0,
    due: Number(r.due) || 0,
    lastReview: Number(r.last_review) || 0,
    deleted: !!r.deleted,
    updatedAt: Number(r.updated_at) || 0,
    stability: Number(r.stability) || 0,
    difficulty: Number(r.difficulty) || 0,
    state: Number(r.state) || 0,
    lapses: Number(r.lapses) || 0,
  };
}

function cardToRow(c) {
  return {
    id: String(c.id),
    en: c.en || '',
    zh: c.zh || '',
    example: c.example || '',
    usage: c.usage || '',
    source_zh: c.sourceZh || '',
    source_en: c.sourceEn || '',
    scene: c.scene || '',
    created_at: Number(c.createdAt) || 0,
    ease: Number(c.ease) || 2.5,
    interval: Number(c.interval) || 0,
    reps: Number(c.reps) || 0,
    due: Number(c.due) || 0,
    last_review: Number(c.lastReview) || 0,
    deleted: c.deleted ? 1 : 0,
    updated_at: Number(c.updatedAt) || Date.now(),
    stability: Number(c.stability) || 0,
    difficulty: Number(c.difficulty) || 0,
    state: Number(c.state) || 0,
    lapses: Number(c.lapses) || 0,
  };
}

// ===== TTS(Workers AI / Deepgram aura-1)=====
const AURA_SPEAKERS = [
  'asteria', 'luna', 'stella', 'athena', 'hera', 'orion',
  'arcas', 'perseus', 'angus', 'orpheus', 'helios', 'zeus',
];

async function handleTTS(request, env) {
  if (!env.AI) {
    return json({ error: 'Worker 未绑定 Workers AI(绑定名应为 AI)' }, 500);
  }
  if (request.method !== 'POST') {
    return json({ error: 'Not found' }, 404);
  }
  const body = await request.json();
  const text = String((body && body.text) || '').trim();
  if (!text) return json({ error: 'text required' }, 400);
  if (text.length > 500) return json({ error: 'text too long' }, 413);
  const speaker = AURA_SPEAKERS.includes(body && body.speaker) ? body.speaker : 'luna';

  const result = await env.AI.run('@cf/deepgram/aura-1', { text, speaker });
  // aura-1 正常返回音频字节流;兼容个别模型版本返回 { audio: base64 } 的形态
  let audioBody = result;
  if (result && typeof result === 'object' && !(result instanceof ReadableStream) && result.audio) {
    audioBody = Uint8Array.from(atob(result.audio), (ch) => ch.charCodeAt(0));
  }
  return new Response(audioBody, {
    headers: { 'content-type': 'audio/mpeg', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-app-token, anthropic-version',
    'access-control-max-age': '86400',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}
