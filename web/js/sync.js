// 双游标 LWW 同步 — 协议对齐 iOS CloudSyncService:
// pull 用服务端时间游标,push 用本地时间游标,两者独立,避免时钟偏差。

import { getAllCards, putCards, putCard, getCard, clearCards } from './db.js';
import { mergeRemote } from './merge.js';
import {
  isConfigured, getWorkerURL, getToken,
  getLastPullServerTime, setLastPullServerTime,
  getLastPushAt, setLastPushAt,
  getLastSyncAt, setLastSyncAt, clearSyncCursors,
} from './settings.js';

class SyncError extends Error {}

let status = isConfigured() && getLastSyncAt() > 0
  ? { kind: 'success', at: getLastSyncAt() }
  : { kind: 'idle' };

const listeners = new Set();

/** 订阅状态变化,立即回调一次当前状态;返回退订函数。 */
export function onStatus(cb) {
  listeners.add(cb);
  cb(status);
  return () => listeners.delete(cb);
}

function setStatus(s) {
  status = s;
  for (const cb of listeners) cb(s);
}

/** 状态 → 设置页文案。 */
export function statusText(s) {
  switch (s.kind) {
    case 'idle': return '未配置';
    case 'syncing': return '同步中…';
    case 'success': return `上次同步：${relativeTime(s.at)}`;
    case 'failed': return s.message;
  }
}

function relativeTime(atMs) {
  const seconds = (Date.now() - atMs) / 1000;
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export const isSyncing = () => status.kind === 'syncing';

let pendingTimer = null;

/** 写操作后的防抖同步(默认 1.5s,与 iOS 一致)。 */
export function scheduleSync(delayMs = 1500) {
  if (!isConfigured()) return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => syncNow(), delayMs);
}

let syncing = false;

export async function syncNow() {
  if (!isConfigured()) {
    setStatus({ kind: 'idle' });
    return;
  }
  if (syncing) return;
  syncing = true;
  setStatus({ kind: 'syncing' });

  try {
    const workerURL = getWorkerURL();
    const token = getToken();
    const pushSince = getLastPushAt();
    const pushStartedAt = Date.now();

    // --- Pull ---
    const resp = await fetch(`${workerURL}/sync/cards?since=${Math.trunc(getLastPullServerTime())}`, {
      headers: { 'x-app-token': token },
    });
    checkHTTP(resp);
    const json = await resp.json();
    const remoteCards = json.cards ?? [];
    const serverTime = json.serverTime ?? Date.now();

    // --- Merge(LWW)---
    const local = await getAllCards();
    const { toWrite } = mergeRemote(local, remoteCards);
    if (toWrite.length) await putCards(toWrite);
    setLastPullServerTime(serverTime);

    // --- Push ---
    const all = await getAllCards();
    const toPush = all.filter((c) => c.updatedAt > pushSince);
    for (let i = 0; i < toPush.length; i += 500) {
      const r = await fetch(`${workerURL}/sync/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ cards: toPush.slice(i, i + 500) }),
      });
      checkHTTP(r);
    }
    setLastPushAt(pushStartedAt);

    const now = Date.now();
    setLastSyncAt(now);
    setStatus({ kind: 'success', at: now });
  } catch (e) {
    setStatus({ kind: 'failed', message: e instanceof SyncError ? e.message : '网络连接失败' });
  } finally {
    syncing = false;
  }
}

function checkHTTP(resp) {
  if (resp.status === 200) return;
  if (resp.status === 401) throw new SyncError('口令错误，请检查');
  throw new SyncError('服务端错误');
}

/** 软删除:标记 + 更新时间戳,交给下次 push 传播。 */
export async function softDelete(id) {
  const card = await getCard(id);
  if (!card) return;
  card.deleted = true;
  card.updatedAt = Date.now();
  await putCard(card);
  scheduleSync();
}

/** 重置同步:清空本地(含游标)后全量重拉。 */
export async function resetSync() {
  await clearCards();
  clearSyncCursors();
  await syncNow();
}
