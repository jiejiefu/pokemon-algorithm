/**
 * dex-collection.js — the reader's own Pokédex
 * =============================================
 * One small store that answers "which of the 1,025 has this reader caught?".
 * It is the spine of the homepage game, and it is deliberately NOT tied to the
 * homepage: any page can `import { dex } from './dex-collection.js'` and call
 * `dex.catch(id, 'detail')` when something earns a catch, and the wall on the
 * homepage lights up the next time it is opened (or at once, in another tab).
 *
 * WHAT IS STORED
 * --------------
 * `localStorage['pokemon-algorithm:dex:v1']` = `{ "v": 1, "c": { "25": [1761600000000, "wall"] } }`
 * — species id → [timestamp, source]. The source is only a label for the future
 * ("caught by winning the maze", "caught from the daily pick"); nothing reads it
 * yet except the homepage's recent-catch line.
 *
 * WHY IT NEVER THROWS
 * -------------------
 * Storage can be missing (private mode), full, or hold junk written by another
 * version. Every read is parsed defensively and every write is try/catch: the
 * worst outcome is that progress lasts for the tab instead of for good, which
 * the homepage says out loud (`dex.persistent`) rather than hiding.
 *
 * Pure of DOM: no document access, so it runs under bare Node for tests (pass a
 * fake `storage`).
 */

export const DEX_SIZE = 1025;
export const STORAGE_KEY = 'pokemon-algorithm:dex:v1';

/** Counts that earn a line on the homepage. 151 is the original Pokédex. */
export const MILESTONES = [10, 50, 151, 500, 1025];

/** The next milestone above `n`, or null once the dex is full. */
export function nextMilestone(n) {
  return MILESTONES.find((m) => m > n) ?? null;
}

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__dex_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Parse whatever is in storage into a Map; anything unrecognised is dropped. */
export function parseDex(raw) {
  const map = new Map();
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || typeof o.c !== 'object' || o.c === null) return map;
    for (const [k, v] of Object.entries(o.c)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 1 || id > DEX_SIZE) continue;
      const at = Array.isArray(v) && Number.isFinite(v[0]) ? v[0] : 0;
      const src = Array.isArray(v) && typeof v[1] === 'string' ? v[1].slice(0, 24) : '';
      map.set(id, { at, src });
    }
  } catch { /* junk in storage: start empty rather than crash the page */ }
  return map;
}

export function serializeDex(map) {
  const c = {};
  for (const [id, { at, src }] of map) c[id] = [at, src];
  return JSON.stringify({ v: 1, c });
}

export function createDex(storage = safeStorage()) {
  let caught = new Map();
  const listeners = new Set();
  let last = null; // most recent catch made in THIS tab, for the "just caught" line

  const read = () => {
    if (!storage) return;
    try {
      caught = parseDex(storage.getItem(STORAGE_KEY));
    } catch { /* keep whatever is in memory */ }
  };
  const write = () => {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, serializeDex(caught));
    } catch { /* quota or blocked: progress now lives in memory only */ }
  };
  const emit = (detail) => { for (const fn of listeners) fn(detail); };

  read();

  // Another tab caught something: re-read and tell the page. `storage` events
  // only fire in OTHER documents, so this never loops with our own writes.
  if (storage && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      read();
      emit({ type: 'sync' });
    });
  }

  return {
    /** False when storage is unavailable: progress will not survive a reload. */
    get persistent() { return storage !== null; },
    get size() { return caught.size; },
    get last() { return last; },
    has: (id) => caught.has(id),
    /** Ids in the order they were caught, oldest first. */
    ids: () => [...caught.entries()].sort((a, b) => a[1].at - b[1].at).map(([id]) => id),
    /** How many of ids lo..hi (inclusive) are caught. */
    countRange(lo, hi) {
      let n = 0;
      for (let id = lo; id <= hi; id++) if (caught.has(id)) n++;
      return n;
    },
    /** Returns true if this was a NEW catch. Re-catching changes nothing. */
    catch(id, source = '') {
      if (!Number.isInteger(id) || id < 1 || id > DEX_SIZE || caught.has(id)) return false;
      caught.set(id, { at: Date.now(), src: String(source).slice(0, 24) });
      last = { id, src: String(source).slice(0, 24) };
      write();
      emit({ type: 'catch', id, size: caught.size });
      return true;
    },
    reset() {
      caught = new Map();
      last = null;
      write();
      emit({ type: 'reset' });
    },
    /** Subscribe; returns an unsubscribe function. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** The shared instance every page uses. */
export const dex = createDex();
