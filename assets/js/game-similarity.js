/**
 * The colour game's target draw and its scoring. Pure functions: no DOM, no
 * fetch, no localStorage.
 *
 *   color-game.html          the only page caller
 *   check_game_similarity.mjs  runs it in bare Node, which is the reason it has no side effects
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCORE IS NOT THE REFERENCE's sRGB EUCLIDEAN DISTANCE
 * ---------------------------------------------------------------------------
 *
 * Ported from pokemonpalette's `src/lib/game/similarity.ts`, which uses plain
 * sRGB distance with `effectiveMaxDistance = 250`. This project does not, and
 * §3.B2 is the reason: `findClosestChineseColorName()` read `#414141` as **墨綠**
 * because an entry 8 away in one channel beat every grey 20 away in all three.
 *
 * That table held 100 Chinese colour names. This corpus is 6,148 sprite swatches
 * — 61x — so the choice of metric decides the page.
 *
 * How far apart the two metrics are is MEASURED, not argued, because "quite
 * different" means nothing across two pages:
 *
 *   - same single closest species:            47 / 80 targets
 *   - **identical top-10 list:                 0 / 80**
 *   - mean overlap of the two top-10 lists:    0.65 / 10
 *
 * So copying the RGB version is not "swapping an algorithm". It is making two
 * pages give different answers about the same colours: colors-generator.html
 * would say species A is closest and color-game.html would say B.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE BUILDS ITS OWN INDEX RATHER THAN CALLING `matchPalette()`
 * ---------------------------------------------------------------------------
 *
 * Because `buildMatchIndex()` reads only `palettes[key].n` — its index holds
 * NORMAL appearances exclusively, and the 地獄 tier is entirely shiny. So this
 * module needs two indexes, and `color-match.js`'s `groups` is a module-level
 * singleton that cannot hold both appearances at once.
 *
 * §3.B1 forbids widening `color-match.js`'s export surface: color.html and
 * colors-explore.html share that file, so adding to it spreads the risk to both.
 * This module therefore imports its `hexToOklab` / `deltaEOk` and builds its own.
 *
 * **The scoring expression is line-for-line `matchPalette()`'s** — bidirectional
 * forward/reverse, weighted by share. That is not a better algorithm invented
 * here; it is what makes the game's number and colors-generator.html's number the
 * SAME quantity. Change the weighting here and that page starts telling a
 * different story with nothing in the suite noticing.
 */

import { hexToOklab, deltaEOk } from './color-match.js';
import { taipeiDateKey, fnv1a, mulberry32 } from './daily-pick.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Four attempts, copied from the reference. */
export const MAX_ATTEMPTS = 4;

/**
 * Three tiers. `easy` is one generation, `hard` the full dex, `hell` the full
 * dex entirely shiny. The reference has two (easy / hard); 地獄 is this
 * project's third.
 */
export const DIFFICULTIES = ['easy', 'hard', 'hell'];

export const DIFFICULTY_LABELS = {
  easy: '簡單',
  hard: '困難',
  hell: '地獄',
};

/** One line of prose per tier, for the generation picker and the note under it. */
export const DIFFICULTY_NOTES = {
  easy: '單一世代，全部原始色',
  hard: '全 1,025 隻，全部原始色',
  hell: '全 1,025 隻，全部異色',
};

/**
 * How many colours are shown during play.
 *
 * The reference's `PALETTE_COLORS_COUNT = 3`, the top 3 of 6 extracted. The
 * number is copied; the source is not. The reference slices an extraction it ran
 * at play time, while this slices `color_palettes.json`, which is ALREADY sorted
 * by share — so "the top 3" means the same thing on both sides (the three
 * highest-share colours) with no re-sorting here.
 */
export const PALETTE_COLORS_SHOWN = 3;

/**
 * The third hint reveals every colour. It is "all of them", not "6", because
 * Unown has 5 in both appearances.
 */
export const PALETTE_COLORS_REVEALED = 6;

/** Unlimited mode has no cap. */
export const MAX_ATTEMPTS_UNLIMITED = Infinity;

/**
 * The four tiers used by the share string.
 *
 * The reference cuts at 0.75 / 0.5 / 0.25 of a SIMILARITY, and that similarity is
 * `(1 - d/250)^1.5`. The 250 there is the ceiling of the **sRGB space**, not of
 * OKLab — applied to OKLab distances it makes almost every cell 0%, because OKLab
 * distances top out at 0.33 (measured below).
 *
 * So the thresholds are measured from the corpus rather than converted from the
 * reference. Distribution over 25 targets x all 1,025 = 25,600 palette distances:
 *
 *   p0.1 0.0380 · p1 0.0525 · p5 0.0662 · p10 0.0749 · p25 0.0925
 *   p50 0.1158 · p75 0.1413 · p90 0.1642 · p99 0.2044 · p99.9 0.2366
 *   max 0.3326
 *
 * The four cuts land near p10 / p55 / p90, so all four cells get used instead of
 * everything crowding into the first. `check_game_similarity.mjs` re-measures
 * them, so a corpus change goes red rather than quietly becoming a threshold that
 * still passes.
 */
export const TIER_CLOSE = 0.075;
export const TIER_MID = 0.120;
export const TIER_FAR = 0.165;

/**
 * Distance -> tier. **Smaller is closer**, the opposite direction to the
 * reference, whose input is a similarity. Confusing the two inverts the entire
 * share string while still producing a grid that looks plausible.
 *
 * @returns {'close'|'mid'|'far'|'miss'}
 */
export function tierOf(distance) {
  if (!Number.isFinite(distance)) return 'miss';
  if (distance <= TIER_CLOSE) return 'close';
  if (distance <= TIER_MID) return 'mid';
  if (distance <= TIER_FAR) return 'far';
  return 'miss';
}

/**
 * Seed prefix for the daily draw. It shares a namespace with `daily-pick.js`'s
 * `DAILY_BUCKETS` but uses a different prefix, so the two draws can never
 * collide — and they should not: 今日推薦 is "see who is featured today" while
 * the game's target is "one fixed puzzle per day".
 */
export const GAME_SEED = 'pokemon-colorgame:';

// ---------------------------------------------------------------------------
// Tier -> appearance
// ---------------------------------------------------------------------------

/**
 * The tier decides the appearance, and that is a convergence against the
 * reference.
 *
 * The reference gives the player an `Any / Normal / Shiny` variant picker. This
 * project does not need one, because the spec ties appearance to tier: 簡單 and
 * 困難 are 原始色, 地獄 is fixed to 異色. Offering a control over a question
 * that has one answer is one more state field that can be set inconsistently.
 *
 * The reference's `Variant` filter therefore disappears entirely rather than
 * being relocated.
 *
 * @param {string} difficulty
 * @returns {'n'|'s'}
 */
export function variantOf(difficulty) {
  return difficulty === 'hell' ? 's' : 'n';
}

export function isShinyMode(difficulty) {
  return variantOf(difficulty) === 's';
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/**
 * Generation -> ids, derived from `pokemon_data.json`'s `generation` field.
 *
 * **Generation ranges are not written down.** The reference hardcodes
 * `GEN_RANGES` in `daily-pool.ts` because its own data table has no generation
 * column; this project's does, so the ranges are derived. Writing them down
 * would be a second source of truth that goes stale when the data is
 * regenerated — §3.K records a version of exactly that.
 *
 * Returns `Map<number, number[]>` (ids ascending). An empty list means the
 * generation does not exist; callers must handle it rather than treating it as
 * impossible.
 *
 * @param {Array<{id:number, generation:number}>} data
 * @returns {Map<number, number[]>}
 */
export function genIdMap(data) {
  const map = new Map();
  for (const p of data || []) {
    const g = Number(p && p.generation);
    if (!Number.isFinite(g) || g < 1) continue;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(p.id);
  }
  for (const ids of map.values()) ids.sort((a, b) => a - b);
  return map;
}

export function allIds(data) {
  return (data || []).map((p) => p.id).sort((a, b) => a - b);
}

/**
 * The pool a difficulty draws from.
 *
 * - `easy`: a single generation, the one the reader picked, so the pool is 72 to 156.
 * - `hard`: all 1,025.
 * - `hell`: all 1,025. Same pool as hard; `variantOf()` returns `'s'`.
 *
 * @param {string} difficulty
 * @param {number} gen  only consulted for easy
 * @param {Array} data
 * @returns {number[]}
 */
export function poolFor(difficulty, gen, data) {
  if (difficulty === 'easy') {
    const g = Number(gen);
    if (!Number.isFinite(g)) return [];
    return genIdMap(data).get(g) || [];
  }
  return allIds(data);
}

// ---------------------------------------------------------------------------
// Target draw
// ---------------------------------------------------------------------------

/**
 * Pick one from the pool and return its POSITION in it.
 *
 * Returning a position rather than an id is what makes "the pool is empty"
 * observable to the caller (`< 0`) instead of returning a fallback that everyone
 * downstream then forgets was a fallback.
 *
 * `mulberry32(seed)` returns a GENERATOR FUNCTION, not a number — that is
 * `daily-pick.js`'s signature, and the whole point of that design is "a PRNG's
 * state is one number". The first draft wrote
 * `mulberry32(fnv1a(seed)) % pool.length`, where `function % 151` is `NaN`,
 * `NaN < 0` is false, and `pool[NaN]` is `undefined` — so the function returned
 * a target of `{id: undefined}` and **threw nothing at all**. It has to be
 * called.
 */
function pickIndex(pool, seed) {
  if (!pool.length) return -1;
  return Math.floor(mulberry32(fnv1a(seed))() * pool.length);
}

/**
 * The daily puzzle. Same day + same tier + same generation -> same Pokémon.
 *
 * **The seed contains the generation**, so under easy two readers who picked
 * different generations see different puzzles. The spec asks for that (easy lets
 * the reader choose a generation), and it does not conflict with the reference's
 * "everyone worldwide sees the same one today": that only holds when tier AND
 * generation match, which is precisely what "the same puzzle" means.
 *
 * The day is Taipei's (`taipeiDateKey`), not UTC's. `daily-pick.js`'s fourth
 * decision records why: with a UTC day, a Taipei reader's puzzle would roll over
 * at 08:00 while the homepage's 今日推薦 would not, and both are called 「今日」
 * on the same site.
 *
 * @returns {{id:number, variant:'n'|'s', index:number}|null}
 */
export function pickDailyTarget(difficulty, gen, data, { now = new Date() } = {}) {
  const pool = poolFor(difficulty, gen, data);
  const index = pickIndex(pool, `${GAME_SEED}${difficulty}:${difficulty === 'easy' ? gen : 'all'}:${taipeiDateKey(now)}`);
  if (index < 0) return null;
  return { id: pool[index], variant: variantOf(difficulty), index };
}

/**
 * The unlimited-mode target. No date, so no seed.
 *
 * `rand` is injectable so the checker can reproduce one round against fixed
 * data; `Math.random()` is only the default. Same convention as the rest of the
 * project (the pokedex debounce, the dex filters).
 */
export function pickUnlimitedTarget(difficulty, gen, data, rand = Math.random) {
  const pool = poolFor(difficulty, gen, data);
  if (!pool.length) return null;
  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return { id: pool[index], variant: variantOf(difficulty), index };
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/**
 * One species' colours in one appearance (Unown has 5).
 *
 * **Shares are neither recomputed nor re-sorted.** `color_palettes.json`'s rows
 * are already sorted descending by `extract_color_palettes_mmcq.py`, so row 0 is
 * the primary. Sorting again is one more thing that can be got wrong, and it
 * would give the word "primary" a second definition.
 *
 * @param {object} palettes shape of `color_palettes.json`: `{ [id]: { n, s } }`
 * @param {number} id
 * @param {'n'|'s'} variant
 * @returns {Array<{hex:string, share:number}>} `[]` when the species is absent
 */
export function paletteRows(palettes, id, variant = 'n') {
  const entry = palettes && palettes[String(id)];
  const rows = entry && entry[variant];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
    .map((r) => ({ hex: r[0], share: Number(r[1]) || 0 }));
}

/** How many colours play shows: 3 by default, every one of them once revealed. */
export function visiblePalette(palettes, id, variant, revealed = false) {
  const rows = paletteRows(palettes, id, variant);
  const n = revealed ? rows.length : PALETTE_COLORS_SHOWN;
  return rows.slice(0, Math.min(n, revealed ? PALETTE_COLORS_REVEALED : PALETTE_COLORS_SHOWN));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The symmetric distance between two palettes. Line-for-line the same expression
 * as `color-match.js`'s `matchPalette()`.
 *
 * Two palettes of different sizes cannot be read as a percentage — this is a
 * distance, smaller is closer, and distance has no upper bound. So the page does
 * not print a percentage; it prints the distance itself, which is what §3.B2
 * concludes:
 *
 *   The honest thing is to show the ΔE number itself. A large distance is large,
 *   and that is a fact rather than a failure.
 *
 * The symmetry is load-bearing, not a detail: with `forward` alone a set of
 * continuous-tone browns can match any brown outfit for free. `reverse` exists in
 * `matchPalette()` for exactly that, so this function must not fall back to a
 * one-way average "for fidelity to the reference" — the reference's expression
 * is the weaker half of its design, not a feature worth preserving.
 */
export function paletteDistance(rowsA, rowsB) {
  const a = (rowsA || []).filter((r) => r && r.hex).map((r) => ({
    lab: hexToOklab(r.hex), share: Number(r.share) || 0,
  })).filter((r) => r.lab);
  const b = (rowsB || []).filter((r) => r && r.hex).map((r) => ({
    lab: hexToOklab(r.hex), share: Number(r.share) || 0,
  })).filter((r) => r.lab);
  if (!a.length || !b.length) return null;

  // The query side falls back to equal weight when every share is 0 or absent,
  // rather than returning NaN.
  let aSum = a.reduce((s, r) => s + r.share, 0);
  if (!(aSum > 0)) for (const r of a) r.share = 1;
  aSum = a.reduce((s, r) => s + r.share, 0);

  const bSumRaw = b.reduce((s, r) => s + (r.share > 0 ? r.share : 0), 0);
  if (!(bSumRaw > 0)) return null;

  let forward = 0;
  for (const o of a) {
    let best = Infinity;
    for (const e of b) { const d = deltaEOk(o.lab, e.lab); if (d < best) best = d; }
    forward += o.share * best;
  }
  forward /= aSum;

  let reverse = 0;
  for (const e of b) {
    let best = Infinity;
    for (const o of a) { const d = deltaEOk(o.lab, e.lab); if (d < best) best = d; }
    reverse += (e.share > 0 ? e.share : 0) * best;
  }
  reverse /= bSumRaw;

  return { forward, reverse, score: (forward + reverse) / 2 };
}

/**
 * A guess's score: a DISTANCE, not a similarity in 0..1.
 *
 * The page prints this number directly (4 dp, the same format as
 * colors-generator.html) rather than a percentage. The reference prints
 * `NN% match`, which needs a normalisation constant mapping distance back to
 * 0..1, and every such constant is a choice:
 *
 *   - the corpus-measured 0.8925 as the ceiling: `% = (1 - d/0.8925) * 100`
 *   - the reference's 250, which is the sRGB ceiling, NOT OKLab's
 *
 * Neither changes WHICH palette is closer. The second would make almost every
 * cell read 0%, because OKLab distances max out at 0.8925 against a 250 gate.
 *
 * So this returns a distance and calls it one.
 *
 * @returns {{score:number, forward:number, reverse:number}|null}
 */
export function scoreGuess(palettes, targetId, guessId, variant) {
  const target = paletteRows(palettes, targetId, variant);
  const guess = paletteRows(palettes, guessId, variant);
  return paletteDistance(guess, target);
}

// ---------------------------------------------------------------------------
// Normalising tier and generation
// ---------------------------------------------------------------------------

export function isDifficulty(value) {
  return DIFFICULTIES.indexOf(value) >= 0;
}

/** An unrecognised tier falls back to `easy`, which is the first-visit default. */
export function normalizeDifficulty(value) {
  return isDifficulty(value) ? value : 'easy';
}

/**
 * An unrecognised generation falls back to 1.
 *
 * The spec says a first visit is always Easy + 第一世代, and localStorage can be
 * hand-edited, can hold an older version's value, and can carry over from a site
 * with a different generation count. So normalisation is necessary, and its
 * fallback must be the value the spec names — not "the smallest one".
 */
export function normalizeGeneration(value, availableGenerations) {
  const g = Number(value);
  const max = Math.max(...(availableGenerations || [1]));
  if (!Number.isFinite(g) || g < 1 || g > max) return 1;
  return Math.floor(g);
}

export { taipeiDateKey, fnv1a, mulberry32 };