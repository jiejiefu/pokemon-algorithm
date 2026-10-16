/**
 * hero-gen.js — which generation's clip the homepage shows today
 * ============================================================
 * Nine clips exist, one per generation, and the homepage plays exactly one of
 * them for a whole day.  This module is the only place that decides which.
 *
 * THE ONE RULE IT EXISTS TO KEEP
 * ------------------------------
 * A day is a Taipei day, because that is already what today's pick is drawn
 * against — `taipeiDateKey()` is imported from daily-pick.js rather than
 * restated.  Two date keys computed two ways is §3.S's shape in miniature: the
 * reader is told 今日推薦 is one Pokémon and the hero silently shows another
 * generation's roster for four hours, because one of them used local time and
 * the other used UTC+8.  So this file has no clock arithmetic of its own; it
 * takes a key string and does calendar subtraction on it.
 *
 * WHAT "ONE DAY FIXED" COSTS, AND WHY IT IS NOT `Date.now() % 9`
 * -------------------------------------------------------------
 * A modulo of the epoch would redraw the hero twice a day, on the hour, with no
 * relationship to the date a reader is on.  The clock is read through
 * `taipeiDateKey`, so the hero changes at Taipei midnight and not before.
 *
 * THE EPOCH IS IN THE FUTURE ON PURPOSE
 * -------------------------------------
 * GEN_ONE_DATE is 2026-10-18.  The day this shipped, 2026-10-16, is two days
 * EARLIER, and an author asking for a series to start "on the 18th" was not
 * asking for the hero to be broken until then.  `dayOffset` is written to wrap
 * in both directions, so dates before the epoch count backwards — 10-16 is the
 * seventh generation, 10-17 the ninth, 10-18 the first.  Every date in the
 * calendar maps to exactly one generation and nothing special-cases the gap.
 *
 * A RING, NOT A SEQUENCE
 * ----------------------
 * Nine days and then back to one.  There is no "tenth" and no end state, which
 * is why the modulo is the arithmetic rather than a clamped counter: a counter
 * would need a reset path, and a reset path is where a hero that shows
 * generation 1 for two consecutive days comes from.
 *
 * THE PATHS ARE HERE TOO
 * ----------------------
 * Because the video and its still are one generation's worth of assets, the
 * name of that generation is the only thing either path needs.  Two template
 * strings in index.html would be four places to keep right once the numbering
 * changed.
 *
 * Pure module: no DOM, no fetch, no storage.  That is what lets
 * `check_home_hero.mjs` import it and run it over ten years of dates in bare
 * Node, which is the only way the wrap in BOTH directions is anything but a
 * claim.
 */

import { taipeiDateKey } from './daily-pick.js';

/**
 * The first day of the series, and the generation it shows.  Nine days later
 * the ring is complete and this date comes round again.
 */
export const GEN_ONE_DATE = '2026-10-18';

/** One clip per generation, 1-9.  Written down because `plan_grid()` in
 * make_hero_video.py solves a different grid for each of these counts, so the
 * clips genuinely do not generalise past nine. */
export const GENERATION_COUNT = 9;

/** UTC midnight of a `YYYY-MM-DD` key, as days-since-epoch.  Built by parsing
 * rather than by `new Date(key)`: that constructor reads a bare date string as
 * UTC midnight already, which makes it correct by accident on some engines and
 * local midnight on others, and the two disagree by a day for anyone east of
 * Greenwich — which is every reader this site has. */
function keyToDayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Signed whole days from GEN_ONE_DATE to `key`.  Negative before the epoch. */
export function dayOffset(key) {
  return keyToDayNumber(key) - keyToDayNumber(GEN_ONE_DATE);
}

/**
 * The generation a Taipei date key shows.  1-9 for every input, including
 * every date before GEN_ONE_DATE.
 *
 * @param {string} key `YYYY-MM-DD` from `taipeiDateKey()`
 * @returns {number} 1-9
 */
export function heroGenForKey(key) {
  const offset = dayOffset(key);
  // The inner `+ N` is what makes a pre-epoch date work: JS `%` keeps the
  // dividend's sign, so -2 % 9 is -2 and indexing with it reads off the end of
  // the array.  Rounding first means a fractional offset cannot slip through.
  return Math.round(((offset % GENERATION_COUNT) + GENERATION_COUNT) % GENERATION_COUNT) + 1;
}

/**
 * The same answer from a Date.  `now` defaults to the real clock so a page that
 * just wants today's generation can call it bare.
 *
 * @param {Date} [now]
 * @returns {number} 1-9
 */
export function heroGenFor(now = new Date()) {
  return heroGenForKey(taipeiDateKey(now));
}

/** `assets/video/hero-gen3.mp4` — a clip, muted and scrubbed, never played. */
export function heroVideoUrl(gen) {
  return `assets/video/hero-gen${gen}.mp4`;
}

/**
 * `assets/video/poster-gen3.jpg` — the frame the roster is complete and the
 * wave has not reached, cut by make_hero_video.py from the encoded clip.
 *
 * It is not a placeholder frame.  index.html never calls play(), so a poster
 * that is never seeked away from IS what the reader sees: before metadata
 * arrives, for a reduced-motion reader, and for a load that never arrives.
 */
export function heroPosterUrl(gen) {
  return `assets/video/poster-gen${gen}.jpg`;
}