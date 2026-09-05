// Pull 合并(LWW)— 语义对齐 iOS CloudSyncService:严格 remote.updatedAt > local.updatedAt 才覆盖。

/** 远端 dict → 本地卡片形状,缺失字段的默认值与 iOS applyRemote 一致。 */
function remoteToCard(dict) {
  return {
    id: dict.id,
    en: dict.en ?? '',
    zh: dict.zh ?? '',
    example: dict.example ?? '',
    usage: dict.usage ?? '',
    sourceZh: dict.sourceZh ?? '',
    sourceEn: dict.sourceEn ?? '',
    createdAt: dict.createdAt ?? 0,
    ease: dict.ease ?? 2.5,
    interval: dict.interval ?? 0,
    reps: dict.reps ?? 0,
    due: dict.due ?? 0,
    lastReview: dict.lastReview ?? 0,
    deleted: dict.deleted === true,
    updatedAt: dict.updatedAt ?? 0,
    // 旧服务端数据可能没有 FSRS 字段
    stability: dict.stability ?? 0,
    difficulty: dict.difficulty ?? 0,
    state: dict.state ?? 0,
    lapses: dict.lapses ?? 0,
  };
}

/**
 * LWW 合并:返回需要写入本地库的卡片。
 * @param {object[]} localCards 本地全部卡(含已软删)
 * @param {object[]} remoteCards 服务端返回的 dict 数组
 * @returns {{ toWrite: object[], changed: number }}
 */
export function mergeRemote(localCards, remoteCards) {
  const localMap = new Map(localCards.map((c) => [c.id, c]));
  const toWrite = [];
  for (const remote of remoteCards) {
    if (!remote.id) continue;
    const existing = localMap.get(remote.id);
    if (!existing || (remote.updatedAt ?? 0) > existing.updatedAt) {
      toWrite.push(remoteToCard(remote));
    }
  }
  return { toWrite, changed: toWrite.length };
}
