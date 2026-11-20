const KEY = 'chunks.translationHistory';
const LIMIT = 20;

export function createTranslationHistory(storage, key = KEY) {
  let items = [];
  let initialized = false;
  try {
    const raw = storage.getItem(key);
    const saved = JSON.parse(raw ?? 'null');
    if (Array.isArray(saved)) {
      items = saved.filter((item) => item && typeof item.id === 'string'
        && typeof item.input === 'string' && item.input.trim()
        && ['zhToEn', 'enToZh'].includes(item.direction)
        && typeof item.result?.translation === 'string'
        && Array.isArray(item.result.phrases)
        && item.result.phrases.every((p) => p && typeof p.en === 'string' && typeof p.zh === 'string'))
        .slice(0, LIMIT);
      initialized = true;
    }
  } catch { /* 存储不可用时保留当前会话的历史。 */ }

  function save() {
    initialized = true;
    try { storage.setItem(key, JSON.stringify(items)); } catch { /* 不影响翻译。 */ }
  }

  return {
    list: () => structuredClone(items),
    remember(input, result, direction) {
      const text = input.trim();
      if (!text) return;
      items = [{ id: crypto.randomUUID(), input: text, result: structuredClone(result), direction },
        ...items.filter((item) => item.direction !== direction || item.input.toLowerCase() !== text.toLowerCase())]
        .slice(0, LIMIT);
      save();
    },
    recover(cards) {
      if (initialized) return;
      const groups = new Map();
      for (const card of [...cards].filter((c) => !c.deleted && c.sourceZh?.trim() && c.sourceEn?.trim())
        .sort((a, b) => b.createdAt - a.createdAt)) {
        const key = JSON.stringify([card.sourceZh, card.sourceEn]);
        let entry = groups.get(key);
        if (!entry) {
          if (groups.size >= LIMIT) continue;
          entry = { id: crypto.randomUUID(), input: card.sourceZh, direction: 'zhToEn',
            recovered: true, result: { translation: card.sourceEn, phrases: [] } };
          groups.set(key, entry);
        }
        if (card.en === card.sourceEn && card.zh === card.sourceZh) continue;
        if (!entry.result.phrases.some((p) => p.en === card.en)) {
          entry.result.phrases.push({ en: card.en, zh: card.zh, example: card.example ?? '' });
        }
      }
      if (groups.size) { items = [...groups.values()]; save(); }
    },
    remove(id) { items = items.filter((item) => item.id !== id); save(); },
    clear() { items = []; save(); },
  };
}
