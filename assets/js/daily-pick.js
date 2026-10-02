/**
 * The seeded daily draw, shared by index.html and color.html.
 *
 *   index.html  今日推薦寶可夢  — one card, the day's pick
 *   color.html  單一寶可夢色盤   — the default Pokémon for a bare URL, the SAME day's pick
 *
 * WHY THIS IS A MODULE AND NOT A SECOND COPY. The draw is ~40 lines of seed
 * arithmetic, and index.html grew it inline because it was the first caller.
 * color.html then needed the identical thing — a bare `color.html` is reachable
 * from the nav and the 色彩 dropdown, and it used to render 找不到這個寶可夢 —
 * and copying the block would have put the two on separate clocks the moment
 * either was edited. The four decisions below are all load-bearing, and none of
 * them is visible from a single call site:
 *
 * 1. BUCKET FIRST, THEN MEMBER. Not one flat pool over the 114 ids. The pools
 *    are 10 / 71 / 23 / 10, so a flat draw is ~62% 傳說 and a 600族 pick lands
 *    ~9% of days — the two smallest buckets would effectively never appear.
 *    Four equal buckets, then one member. Measured over 3650 days by
 *    `check_color_daily.mjs`: category tally within 1.5σ of the 912 expected, and
 *    every member of every bucket reachable (10/10, 71/71, 23/23, 10/10).
 * 2. FOUR IDS ARE IN TWO BUCKETS — 超夢 #150 and 烈空坐 #384 (熱門+傳說),
 *    烈咬陸鯊 #445 and 快龍 #149 (熱門+600族) — so 114 entries is 110 unique.
 *    Bucket-then-member makes that a non-issue: nothing downstream needs to know
 *    which bucket was drawn, and no de-dup list can rot.
 * 3. THE DAY IS TAIPEI'S, NOT THE VISITOR'S. `Math.random()` would change the
 *    pick on every reload, and a reader in another timezone would roll over at
 *    their own midnight. Shifting by a fixed +8h before reading the UTC date
 *    makes one pick per calendar day for every reader, which is what "每日" has
 *    to mean for a shared page. Verified: 00:00 / 12:00 Taipei on one day give
 *    the same pick, and 2026-09-27 23:59 Taipei keys to 2026-09-27 rather than
 *    rolling over early.
 * 4. THE THREE CATEGORY POOLS COST NO SECOND FETCH. `members(data)` is enough
 *    for all of them — 傳說/幻之 are `speciesFlags` and 600族 is the total-600
 *    filter, and none of the three reads `gens` or `chains`. So this block needs
 *    no generations.json and no evolution_chains.json.
 *
 * ONE DRAW, TWO CALLERS — there is no per-caller seed, and that is the point.
 * An earlier version gave each page its own prefix so the two would not always
 * feature the same Pokémon. It worked, and it was wrong: they then agreed on only
 * 1.9% of days, so someone who read 今日推薦 = 班基拉斯 on the homepage and then
 * opened 單一寶可夢色盤 was shown 厄鬼椪, with nothing on screen explaining why.
 * The homepage card is the advertisement for the colour page, so the two must
 * name the same Pokémon. There is no per-page override parameter to reintroduce
 * that, and `check_color_daily.mjs` fails if either caller grows one.
 *
 * The card deliberately shows the reader none of the draw's mechanics — not
 * which pool it came from, not that it changes at 0:00, not that it is a draw at
 * all. On something that changes once a day, the sampling rules read as trivia.
 */

import { getCategory } from './categories.js';

/**
 * The four equal-weight pools, in menu order.
 *
 * `popular` is not a category with a page — it is the transcribed 熱門 id list
 * below — so it is looked up by id while the other three go through the real
 * member selectors.
 */
export const DAILY_BUCKETS = ['popular', 'legendary', 'mythical', 'pseudo-legendary'];

/**
 * The ten from infopoke_net_home.html, in the source's order, by id.
 *
 * Transcribed ids, not a category: no 熱門 filter exists in the data, so these
 * ten are the only way to reach 熱門 at all. `check_color_daily.mjs` asserts this
 * list against index.html's copy, so the two cannot drift.
 */
export const POPULAR_IDS = [25, 6, 150, 133, 94, 448, 445, 658, 384, 149];

/**
 * The seed prefix. One per project, not per caller — see the note above.
 *
 * This is the prefix index.html used before color.html joined the draw, so
 * merging the two streams left the homepage's own daily picks unchanged.
 */
export const DAILY_SEED = 'pokemon-daily:';

/**
 * "YYYY-MM-DD" in Asia/Taipei. toISOString() is always UTC, so the +8h shift is
 * what makes the date Taipei-side; truncating to a date discards the clock.
 *
 * @param {Date} now
 * @returns {string}
 */
export function taipeiDateKey(now) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * FNV-1a. A string hash, so a date can seed a PRNG that takes a number.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit
 */
export function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32: a 32-bit PRNG. Chosen because its state is one number, so the
 * whole day's sequence is reproducible from `fnv1a(prefix + dateKey)`.
 *
 * @param {number} seed
 * @returns {() => number} successive values in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The pool a bucket name resolves to, or `null` for a bucket whose members are
 * empty or whose name is not one of DAILY_BUCKETS.
 *
 * Split out so the picker can be told apart from the pool builder: a category
 * whose selector returns nothing is a data problem worth logging once, and the
 * caller should decide whether to fall back or fail.
 *
 * @param {string} bucket
 * @param {Array<Object>} data - pokemon_data.json
 * @returns {Array<Object>|null}
 */
export function dailyPool(bucket, data) {
  if (!DAILY_BUCKETS.includes(bucket)) return null;
  const members = bucket === 'popular'
    ? POPULAR_IDS.map((id) => data.find((entry) => entry.id === id)).filter(Boolean)
    : getCategory(bucket).members(data);
  return members.length ? members : null;
}

/**
 * The draw itself, reporting which bucket it came from.
 *
 * Split from `pickDailyPokemon` because the bucket is genuinely part of the
 * result, not a diagnostic: four ids sit in two pools at once (see the note
 * above), so a caller who wants to know "which bucket was this" CANNOT recover it
 * from the member by searching the pools — the first pool containing #149 is
 * 熱門, but the draw may well have been 600族. `scripts/check_color_daily.mjs`
 * needs it to score bucket parity, and getting that wrong silently inflates
 * whichever pool is checked first.
 *
 * @param {Array<Object>} data - pokemon_data.json
 * @param {Object} [options]
 * @param {Date} [options.now=new Date()]
 * @returns {{bucket: string, member: Object}|null} null when the bucket is empty
 */
export function drawDaily(data, { now = new Date() } = {}) {
  const rand = mulberry32(fnv1a(DAILY_SEED + taipeiDateKey(now)));
  // Math.min guards both indices: a `Math.floor(r * n)` can only reach n-1, so
  // the clamp is unreachable, but an out-of-range bucket would throw on
  // `.map` / `.members` and take the whole section down rather than one card.
  const bucket = DAILY_BUCKETS[Math.min(DAILY_BUCKETS.length - 1, Math.floor(rand() * DAILY_BUCKETS.length))];
  const members = dailyPool(bucket, data);
  if (!members) {
    console.error(`[daily-pick] bucket ${bucket} resolved to 0 members`);
    return null;
  }
  const member = members[Math.min(members.length - 1, Math.floor(rand() * members.length))];
  return { bucket, member };
}

/**
 * One Pokémon for one Taipei calendar day.
 *
 * @param {Array<Object>} data - pokemon_data.json
 * @param {Object} [options] - as `drawDaily`
 * @returns {Object|null} a record from `data`, or null when the pool is empty.
 */
export function pickDailyPokemon(data, options = {}) {
  return drawDaily(data, options)?.member ?? null;
}