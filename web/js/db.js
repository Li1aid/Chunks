// IndexedDB 封装 — 库 chunks,store cards(keyPath: id)。薄壳,不藏业务逻辑。

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('chunks', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('cards', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction('cards', mode).objectStore('cards');
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 全部卡片(含已软删)。 */
export async function getAllCards() {
  const db = await openDB();
  return done(tx(db, 'readonly').getAll());
}

export async function putCard(card) {
  const db = await openDB();
  return done(tx(db, 'readwrite').put(card));
}

export async function putCards(cards) {
  if (!cards.length) return;
  const db = await openDB();
  const store = tx(db, 'readwrite');
  for (const card of cards) store.put(card);
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = resolve;
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getCard(id) {
  const db = await openDB();
  return done(tx(db, 'readonly').get(id));
}

export async function clearCards() {
  const db = await openDB();
  return done(tx(db, 'readwrite').clear());
}
