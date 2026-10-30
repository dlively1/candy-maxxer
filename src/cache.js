// A tiny IndexedDB key-value store for neighborhood data: no 5 MB localStorage cap, stores
// objects without JSON round-trips, and keeps only the most recently saved few.

const DB = 'candy-maxxer', STORE = 'areas', KEEP = 10;
const INDEX = 'cm:areas'; // key -> last saved time, so pruning never has to read the big values
let opened = null;

function db() {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function run(mode, fn) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Missing, or storage unavailable (private browsing, quota): undefined.
export async function cacheGet(key) {
  try { return await run('readonly', (s) => s.get(key)); } catch { return undefined; }
}

// Keys of everything saved (no big values read).
export function cacheKeys() {
  try { return Object.keys(JSON.parse(localStorage.getItem(INDEX) || '{}')); } catch { return []; }
}

export async function cacheSet(key, value) {
  try {
    await run('readwrite', (s) => s.put(value, key));
    const index = JSON.parse(localStorage.getItem(INDEX) || '{}');
    index[key] = Date.now();
    const old = Object.keys(index).sort((a, b) => index[a] - index[b]).slice(0, -KEEP);
    for (const k of old) { delete index[k]; await run('readwrite', (s) => s.delete(k)); }
    localStorage.setItem(INDEX, JSON.stringify(index));
  } catch { /* storage full or unavailable: just don't cache */ }
}
