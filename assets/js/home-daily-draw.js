/**
 * home-daily-draw.js — the homepage's daily draw, in bare Node
 * ============================================================
 * `home_daily.json` carries the four pools as id arrays, so drawing a day from it
 * is two `mulberry32` calls and needs no 2.8 MB of records. That is the whole
 * reason this is a module of its own rather than a function inside home-lab.js:
 * home-lab.js imports `shared.js` and `cry-player.js` and therefore cannot be
 * imported in bare Node, and the one claim worth testing here is an IDENTITY —
 * that this draw and `pickDailyPokemon()` in daily-pick.js name the same species
 * on the same day. A checker that cannot run the code can only restate it (§3.P's
 * `starRun` precedent).
 *
 * The RNG, the seed prefix and the date key are IMPORTED, never copied. Only the
 * two calls are re-expressed, because `drawDaily()` indexes full records.
 */

import { DAILY_BUCKETS, DAILY_SEED, fnv1a, mulberry32, taipeiDateKey } from './daily-pick.js';

/**
 * The day's draw over `home_daily.json`, mirroring `drawDaily()`'s two calls:
 * one bucket, then one id inside it, from a generator seeded by the Taipei date.
 *
 * @param {{buckets: Object<string, number[]>}} table - home_daily.json
 * @param {{now?: Date}} [options]
 * @returns {{bucket: string, id: number}|null} null when the chosen pool is empty
 */
export function drawDailyFromTable(table, { now = new Date() } = {}) {
  const rand = mulberry32(fnv1a(DAILY_SEED + taipeiDateKey(now)));
  const bucket = DAILY_BUCKETS[Math.min(DAILY_BUCKETS.length - 1, Math.floor(rand() * DAILY_BUCKETS.length))];
  const ids = table?.buckets?.[bucket];
  if (!Array.isArray(ids) || !ids.length) return null;
  return { bucket, id: ids[Math.min(ids.length - 1, Math.floor(rand() * ids.length))] };
}
