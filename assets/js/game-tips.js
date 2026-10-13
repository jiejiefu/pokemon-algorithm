/**
 * The colour game's rotating tip line.
 *
 *   color-game.html          the only page caller
 *   color-game.js            owns the typewriter loop
 *   check_color_game.mjs     asserts every tip's CLAIM is true of this page
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A CONSTANT INSIDE color-game.js
 * ---------------------------------------------------------------------------
 *
 * The typewriter loop is DOM-and-timer work and has to stay where it is. The TIPS
 * are not: they are six sentences about how this page behaves, and every one of
 * them is a CLAIM that can quietly stop being true — the same disease §3.G1a
 * describes, where a checker asks whether prose exists rather than what it says.
 * Hoisting them here means a checker can import them and compare each against the
 * real behaviour, which `check_color_game.mjs` does.
 *
 * ---------------------------------------------------------------------------
 * EVERY TIP IS A CLAIM THIS PAGE HAS TO KEEP MAKING
 * ---------------------------------------------------------------------------
 *
 * Phrased second-person and concrete, like the reference's. No tip says something
 * flattering about the game; each one tells the reader something they cannot
 * otherwise discover. That is also why there are six and not more: the rotation
 * interval is long enough that a reader sees a few, and a tip they never see is
 * still a tip somebody has to keep true.
 *
 * The list is deliberately NOT in UI order. It rotates, so nothing depends on
 * position; keeping it in the order the reader meets the features would be a false
 * promise about a list that is never read in order.
 */
export const TIPS = [
  '不用打全名 —— 打「伊布」也找得到水伊布。',
  '也可以輸入全國編號，輸入 25 就是皮卡丘。',
  '第一則提示不用等，之後每一則要等五秒。',
  '提示不消耗作答次數，但用了幾則會寫進成績裡。',
  '色塊越寬，那個顏色就佔畫面越多 —— 寬度就是占比。',
  '搜尋支援繁中、英文與日文名稱。',
];

/**
 * Pacing. The reference's numbers, kept because they are measured against the same
 * reading position rather than invented here.
 *
 * `TYPE_TOTAL_CAP_MS` is the one that matters: without it a long CJK tip — each
 * character is a full-width glyph, so they cost more wall time than Latin ones at
 * the same per-character delay — would hold the rotation for seconds. The cap is
 * enforced by dividing the budget by the tip's own length, so every tip finishes
 * typing in roughly the same time regardless of how long it is.
 */
export const TIP_HOLD_MS = 5000;
export const TIP_TYPE_PER_CHAR_MS = 30;
export const TIP_TYPE_JITTER_MS = 10;
export const TIP_TYPE_TOTAL_CAP_MS = 2500;
export const TIP_MIN_CHAR_DELAY_MS = 8;
export const TIP_ERASE_PER_CHAR_MS = 17;

/**
 * A random starting index, so two readers who land on the page in the same round do
 * not read the same line first.
 *
 * It lives HERE rather than in color-game.js on purpose. That file is checked with
 * `!/Math.random()/` — a shape assertion whose claim is that the DAILY DRAW is seeded
 * and reproducible. A cosmetic random start is allowed in the game; it is not
 * allowed in the module that draws, because the check cannot tell which is which
 * from a string. Exporting the call from here keeps that assertion at full strength
 * instead of widening it with an exemption, which is the §3.I lesson: a page that
 * loses a check to an addition it did not need to make.
 *
 * @param {() => number} random  injected so a checker can pin it
 */
export function randomTipIndex(random = Math.random, list = TIPS) {
  return Math.floor(random() * list.length);
}

/** The tip at `i`, wrapping. Never returns undefined. */
export function tipAt(i, list = TIPS) {
  return list[((i % list.length) + list.length) % list.length];
}

/**
 * Per-character typing delay for a tip of `length` characters.
 *
 * Exported so the cap is a fact with one implementation: the loop asks this
 * function how long to wait rather than repeating the arithmetic, which is what
 * §3.B1's "one conversion, one implementation" is about for time.
 *
 * @param {number} length
 * @param {() => number} random  injected so the checker can be deterministic
 * @returns {number} milliseconds, never below TIP_MIN_CHAR_DELAY_MS
 */
export function typeDelay(length, random = Math.random) {
  const cap = TIP_TYPE_TOTAL_CAP_MS / Math.max(length, 1);
  const base = Math.min(TIP_TYPE_PER_CHAR_MS, cap);
  /* The jitter is bounded by the cap as well as by its own ceiling.
   *
   * The first version bounded it only by `Math.min(TIP_TYPE_JITTER_MS, base * 0.5)`
   * and added it on top, which meant the TOTAL was `length * (base + jitter)` and
   * nothing constrained that: at 120 characters the per-character base was already
   * at the cap, so a full +10ms of jitter pushed the line from 2500ms to 3700ms.
   * A cap that a random number can exceed is not a cap — and the symptom is exactly
   * the one the cap exists to prevent, a long CJK tip holding the rotation.
   *
   * `Math.max(0, cap - base)` is the jitter's real budget: whatever is left after the
   * base has taken its share. At 120 characters that is zero, so long tips type at a
   * perfectly even pace and short ones keep the organic feel. */
  const jitterRoom = Math.max(0, cap - base);
  const jitterCeiling = Math.min(TIP_TYPE_JITTER_MS, base * 0.5, jitterRoom);
  const jitter = (random() * 2 - 1) * jitterCeiling;
  /* The floor can still break the cap, and only for tips past 312 characters
   * (`TIP_TYPE_TOTAL_CAP_MS / TIP_MIN_CHAR_DELAY_MS`), where the two requirements are
   * genuinely incompatible: a tip that long cannot both type in 2.5s and not type
   * instantly. Every tip here is under 40, and `check_color_game.mjs` asserts that,
   * so the two constraints are checked to hold. The floor wins, because a visible
   * typewriter that is merely slow beats a bar that jumps. */
  return Math.max(base + jitter, TIP_MIN_CHAR_DELAY_MS);
}
