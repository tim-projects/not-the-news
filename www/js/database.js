import { openDB } from "../../libs/idb.js";window.openDB = openDB;
export const bufferedChanges = [];
export const pendingOperations = [];

export function isOnline() { return navigator.onLine; }

export const dbPromise = openDB('not-the-news-db', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) { const store = db.createObjectStore('items', { keyPath: 'guid' });store.createIndex('by-lastSync', 'lastSync'); }
    if (oldVersion < 2) { db.createObjectStore('userState', { keyPath: 'key' }); }
  }
});
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 500) {
  if (!isOnline()) { throw new Error('Currently offline'); }
  try { return await fetch(url, options); } catch (err) {
    if (retries === 0) throw err;
    await new Promise(r => setTimeout(r, backoff));
    return fetchWithRetry(url, options, retries - 1, backoff * 2);
  }
}

export async function performSync() {
  if (!isOnline()) { console.log('Skipping sync while offline'); return Date.now(); }
  const db = await dbPromise;

  const { time: serverTimeStr } = await fetchWithRetry('/time').then(r => r.json());
  const serverTime = Date.parse(serverTimeStr);
  const staleCutoff = serverTime - 30 * 86400 * 1000;

  const serverGuids = await fetchWithRetry('/guids').then(r => r.json());

  const txRead = db.transaction('items', 'readonly');
  const localItems = await txRead.objectStore('items').getAll();
  const localGuids = new Set(localItems.map(it => it.guid));

  const toDelete = localItems.filter(it => !serverGuids.includes(it.guid) && it.lastSync < staleCutoff).map(it => it.guid);
  if (toDelete.length) {
    const txDel = db.transaction('items', 'readwrite');
    await Promise.all(toDelete.map(g => txDel.objectStore('items').delete(g)));
    await txDel.done;
  }

  const missing = serverGuids.filter(g => !localGuids.has(g));
  const BATCH = 50;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const res = await fetchWithRetry(`/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guids: batch }) });
    const data = await res.json();
    const txUp = db.transaction('items', 'readwrite');
    batch.forEach(guid => { const item = data[guid]; item.lastSync = serverTime; txUp.objectStore('items').put(item); });
    await txUp.done;
  }
  const survivors = serverGuids.filter(g => localGuids.has(g));
  for (let i = 0; i < survivors.length; i += BATCH) {
    const batch = survivors.slice(i, i + BATCH);
    const txUp2 = db.transaction('items', 'readwrite');
    const store = txUp2.objectStore('items');
    for (let guid of batch) {
      const it = await store.get(guid);
      if (it) { it.lastSync = serverTime; store.put(it); }
    }
    await txUp2.done;
  }
  return serverTime;
}

export async function pullUserState(db) {
  if (!isOnline()) { console.log('Skipping pullUserState while offline'); return null; }
  const meta = await db.get('userState', 'lastStateSync') || { value: null };
  const since = meta.value;
  const headers = {};
  if (since) headers['If-None-Match'] = since;
  const res = await fetch('/user-state?since=' + encodeURIComponent(since || ''), { headers });
  if (res.status === 304) return meta.value;
  const { changes, serverTime } = await res.json();
  const tx = db.transaction('userState', 'readwrite');
  for (let [key, val] of Object.entries(changes)) { tx.objectStore('userState').put({ key, value: JSON.stringify(val) }); }
  tx.objectStore('userState').put({ key: 'lastStateSync', value: serverTime });
  await tx.done;
  return serverTime;
}

export async function pushUserState(db, buffered = bufferedChanges) {
  if (buffered.length === 0) return;
  if (!isOnline()) {
    console.log('Offline: queueing user state changes for later sync');
    pendingOperations.push({ type: 'pushUserState', data: JSON.parse(JSON.stringify(buffered)) });
    return;
  }
  const changes = {};
  for (const { key, value } of buffered) { changes[key] = value; }
  const payload = JSON.stringify({ changes });
  const res = await fetch('/user-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`pushUserState failed ${res.status}:`, text);
    return;
  }
  const { serverTime } = await res.json();
  const tx = db.transaction('userState', 'readwrite');
  tx.objectStore('userState').put({ key: 'lastStateSync', value: serverTime });
  await tx.done;
  bufferedChanges.length = 0;
}

export async function performFullSync() {
  const db = await dbPromise;
  const feedTime = await performSync();
  const stateTime = await pullUserState(db);
  await pushUserState(db);
  return { feedTime, stateTime };
}

export function isStarred(state, link) { return state.starred.some(entry => entry.id === link); }

export async function toggleStar(state, link) {
  const idx = state.starred.findIndex(entry => entry.id === link);
  const action = idx === -1 ? "add" : "remove";
  const starredAt = idx === -1 ? new Date().toISOString() : undefined;
  if (idx === -1) { state.starred.push({ id: link, starredAt }); } else { state.starred.splice(idx, 1); }
  dbPromise.then(db => {
    const tx = db.transaction("userState", "readwrite");
    tx.objectStore("userState").put({ key: "starred", value: JSON.stringify(state.starred) });
  });
  if (typeof state.updateCounts === 'function') { state.updateCounts(); }
  const delta = { id: link, action, starredAt };
  if (!isOnline()) {
    pendingOperations.push({ type: 'starDelta', data: delta });
    console.log(`Offline: queued star change (${action})`);
  } else {
    try {
      fetch("/user-state/starred/delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(delta)
      });
    } catch (err) {
      console.error("Failed to sync star change:", err);
      pendingOperations.push({ type: 'starDelta', data: delta });
    }
  }
}

export function isHidden(app, link) { return app.hidden.some(entry => entry.id === link); }

export async function toggleHidden(state, link) {
  const idx = state.hidden.findIndex(entry => entry.id === link);
  const action = idx === -1 ? "add" : "remove";
  const hiddenAt = idx === -1 ? new Date().toISOString() : undefined;
  if (idx === -1) { state.hidden.push({ id: link, hiddenAt }) } else { state.hidden.splice(idx, 1); }
  dbPromise.then(db => {
    const tx = db.transaction("userState", "readwrite");
    tx.objectStore("userState").put({ key: "hidden", value: JSON.stringify(state.hidden) });
  });
  if (typeof state.updateCounts === 'function') { state.updateCounts(); }
  const delta = { id: link, action, hiddenAt };
  if (!isOnline()) {
    pendingOperations.push({ type: 'hiddenDelta', data: delta });
    console.log(`Offline: queued hidden change (${action})`);
  } else {
    try {
      fetch("/user-state/hidden/delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(delta)
      });
    } catch (err) {
      console.error("Failed to sync hidden change:", err);
      pendingOperations.push({ type: 'hiddenDelta', data: delta });
    }
  }
}

export async function loadHidden() {
  const db = await dbPromise;
  const entry = await db.transaction('userState', 'readonly').objectStore('userState').get('hidden');
  let raw = [];
  if (entry && entry.value != null) {
    try { raw = JSON.parse(entry.value); } catch { console.warn('loadHidden: invalid JSON in entry.value', entry.value); }
  }
  if (!Array.isArray(raw)) { console.warn('loadHidden: expected array but got', raw); raw = []; }
  return raw.map(item => typeof item === "string" ? { id: item, hiddenAt: new Date().toISOString() } : item);
}

export async function loadStarred() {
  const db = await dbPromise;
  const entry = await db.transaction("userState", "readonly").objectStore("userState").get("starred");
  let raw = [];
  if (entry && entry.value) {
    try { raw = JSON.parse(entry.value); } catch (e) { console.warn('loadStarred: invalid JSON in entry.value', entry.value); }
  }
  if (!Array.isArray(raw)) { console.warn('loadStarred: expected array but got', raw); raw = []; }
  return raw.map(item => typeof item === "string" ? { id: item, starredAt: new Date().toISOString() } : item);
}

export async function pruneStaleHidden(entries, serverTime) {
  const db = await dbPromise;
  const entry = await db.transaction('userState', 'readonly').objectStore('userState').get('hidden');
  let storedHidden = [];
  if (entry && entry.value != null) {
    if (typeof entry.value === 'string') {
      try { storedHidden = JSON.parse(entry.value); } catch { storedHidden = []; }
    } else if (Array.isArray(entry.value)) { storedHidden = entry.value; }
  }
  if (!Array.isArray(storedHidden)) storedHidden = [];
  if (!Array.isArray(entries) || entries.length === 0 || !entries.every(e => e && typeof e.id === 'string')) { return storedHidden; }

  const validIds = new Set(entries.map(e => e.id.trim().toLowerCase()));
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const now = serverTime;

  const pruned = storedHidden.filter(item => {
    const idNorm = String(item.id).trim().toLowerCase();
    const keepBecauseInFeed = validIds.has(idNorm);
    if (keepBecauseInFeed) return true;
    const hiddenAt = new Date(item.hiddenAt).getTime();
    const age = now - hiddenAt;
    return age < THIRTY_DAYS;
  });
  if (pruned.length < storedHidden.length) {
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'hidden', value: JSON.stringify(pruned) });
    await tx.done;
  }
  return pruned;
}

export async function processPendingOperations() {
  if (!isOnline() || pendingOperations.length === 0) return;
  const ops = pendingOperations.splice(0);
  for (const op of ops) {
    try {
      switch (op.type) {
        case 'pushUserState': await pushUserState(await dbPromise, op.data); break;
        case 'starDelta':
          await fetch("/user-state/starred/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
          break;
        case 'hiddenDelta':
          await fetch("/user-state/hidden/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
          break;
        default: console.warn(`Unknown op: ${op.type}`);
      }
    } catch (e) {
      console.error(`Failed to process ${op.type}`, e);
      pendingOperations.push(op);
    }
  }
}

export async function saveCurrentDeck(guids) {
  const db = await dbPromise;
  const tx = db.transaction('userState', 'readwrite');
  tx.objectStore('userState').put({ key: 'currentDeck', value: JSON.stringify(guids) });
  await tx.done;
}

export async function loadCurrentDeck() {
  const db = await dbPromise;
  const entry = await db.transaction('userState', 'readonly').objectStore('userState').get('currentDeck');
  let guids = [];
  if (entry && entry.value != null) {
    try { guids = JSON.parse(entry.value); } catch (e) { console.warn('loadCurrentDeck: invalid JSON in entry.value', entry.value); }
  }
  return Array.isArray(guids) ? guids : [];
}