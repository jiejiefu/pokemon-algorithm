/**
 * The colour game's three hints.
 *
 *   color-game.html          the only page caller
 *   check_game_hints.mjs     runs it in bare Node
 *
 * ---------------------------------------------------------------------------
 * THREE FIXED SLOTS, NOT A CATEGORY MACHINE
 * ---------------------------------------------------------------------------
 *
 * The first version ported pokemonpalette's `src/lib/game/hints.ts` faithfully:
 * seven candidate categories, a seeded shuffle, and a dedup pass that removed
 * anything the guess card's badges had already said. Every part of that was real
 * work — and all of it is gone, because the design replaced it.
 *
 * The spec is three slots in a fixed order:
 *
 *   1. 屬性          the species' type
 *   2. 完整色盤      all six measured colours, not the three shown during play
 *   3. 圖鑑說明      `pokemon_data.json`'s `descriptions.zh`, verbatim
 *
 * Nothing is shuffled, so nothing needs deduplicating: 屬性 is always slot 1 and
 * 說明 is always slot 3, and neither can collide with a badge. `remainingCategories()`
 * and `learnFromGuess()` existed to answer "what is left to say?", and with three
 * fixed answers that question no longer exists. They are removed rather than left
 * behind unused, because an exported function nobody calls is a second thing to
 * keep right.
 *
 * 說明 goes through `genusZh()`'s neighbour rule for classification only in the
 * sense that it does NOT re-derive it — slot 3 is raw data, deliberately. The
 * user's example is Bulbasaur's line quoted whole:
 *
 *   「在出生後的一段時間內，牠會吸收背上種子裡儲存著的營養成長。」
 *
 * ---------------------------------------------------------------------------
 * THE 93 SPECIES WHOSE POKéDEX LINE NAMES THEM
 * ---------------------------------------------------------------------------
 *
 * 93 of the 1,025 `descriptions.zh` contain their own species name — #4 小火龍
 * opens 「尾巴上燃燒的火焰是小火龍生命力的象徵」. The port filtered those out and
 * substituted another category; this version does not.
 *
 * The reason is what slot 3 IS. Slots 1 and 2 are moves inside the game: a clue,
 * and a reveal of colours the reader could have deduced. Slot 3 is the Pokédex
 * entry, and for those 93 species the entry simply states the answer.
 *
 * Two things make that acceptable rather than a bug: the third hint is the LAST
 * one, so pressing all three is a surrender, and the share string records how
 * many hints were spent. A reader who presses three hints has forfeited the
 * round on the record. Refusing the line for 93 species would instead hand those
 * 93 a DIFFERENT third hint from the other 932, which is a difference the reader
 * can feel and cannot see the reason for.
 *
 * What the old filter did catch is still true and still measured: Bulbasaur's
 * line contains 種子 and 子, two of its four name characters. That is a soft
 * leak, and it is what a hint is FOR.
 */

import { genusZh } from './pokemon-lexicon.js';

/** At most 3 hints, and always exactly 3. */
export const MAX_HINTS = 3;

/** Slot 2's sentence. Fixed, like the reference's closer was. */
export const PALETTE_HINT = '完整色盤 — 目標的所有顏色都在下面了';

/** Slot 3's prefix. */
export const DESCRIPTION_PREFIX = '圖鑑說明';

/**
 * The mask, one per character of the masked run. Fullwidth so it keeps the CJK
 * width of what it replaces — a halfwidth `O` would let the sentence re-flow and
 * draw the eye to the edit instead of past it.
 */
export const NAME_MASK = 'Ｏ';

/**
 * Slot 1 — the type.
 *
 * The strongest thing this game can tell you that is not the answer: measured
 * over all 1,025 targets it cuts the candidate pool from 1,025 to about 140.
 * (Classification cuts it to ~2 and first letter to ~5, which is why neither is
 * in the set — a hint that leaves two possibilities is not a hint, it is the
 * answer wearing a hat.)
 */
export function typeHint(p) {
  const t = Array.isArray(p.types_zh) && p.types_zh.length ? p.types_zh : p.types;
  if (!Array.isArray(t) || !t.length) return null;
  if (t.length === 1) return `這一隻是${t[0]}屬性。`;
  return `這一隻是${t.join('、')}的雙屬性。`;
}

/**
 * Replace every occurrence of `needle` in `text` with one mask per character.
 *
 * `split().join()` rather than a RegExp, because a species name is data and
 * regex metacharacters in it would either throw or match something unintended.
 * Bulbasaur's name is not a metacharacter today; nothing guarantees the next
 * one will not be.
 *
 * The mask is one character per character of the name, not a single block, so
 * the length of the hidden run is visible: 「當ＯＯＯ憤怒至極時」 says three
 * characters are hidden, which is information the reader gets for free and which
 * a single █ would have thrown away.
 */
function maskAll(text, needle) {
  if (!needle) return text;
  return text.split(needle).join(NAME_MASK.repeat(needle.length));
}

/**
 * Slot 3 — the Pokédex line, with the species' own name masked out.
 *
 * 93 of the 1,025 `descriptions.zh` contain their own name, and the port
 * refused those lines outright and substituted a different category. That was
 * the wrong fix and it was visible: refusing meant those 93 species got a
 * DIFFERENT third hint from the other 932, for a reason the reader could not see
 * and the checker could only explain in a failure message.
 *
 * Masking keeps every species on the same slot and takes away only the answer:
 *
 *   噴火龍  「當噴火龍憤怒至極時，尾巴前端就會燃起藍白色的火焰。」
 *        -> 「當ＯＯＯ憤怒至極時，尾巴前端就會燃起藍白色的火焰。」
 *
 * The line still describes the species, which is what a hint is for.
 *
 * **WHAT MASKING DOES NOT CATCH, MEASURED.** 38 species have a two-character run
 * of their name in the line without the full name — #1 妙蛙種子's line contains
 * 種子, #85 嘟嘟利's contains 嘟嘟. Masking the full name leaves those in place.
 * Most are ordinary descriptive words rather than leaks (瓦斯 in 瓦斯彈, 舌頭 in
 * 大舌頭, 寶石 in 寶石海星), but 種子 and 嘟嘟 do identify their species. Masking
 * every 2-character run would mangle the ordinary words to fix the two, so it is
 * NOT done here; `check_game_hints.mjs` pins the count so the decision is a
 * number rather than a memory.
 */
export function descriptionHint(p) {
  const zh = p.descriptions && (p.descriptions.zh || p.descriptions.zh_text2);
  const text = typeof zh === 'string' ? zh.trim() : '';
  if (!text) return null;
  const name = p.names && p.names.zh;
  return `${DESCRIPTION_PREFIX}：「${maskAll(text, name)}」`;
}

/** Kept exported for callers that want the classification; not one of the slots. */
export function speciesHint(p) {
  const genus = genusZh(p);
  if (!genus || genus === '—') return null;
  return `這一隻屬於${genus}。`;
}

/**
 * The three hints, in order.
 *
 * Guarantees the length is ALWAYS 3. Slot 3 is the only one that could come back
 * empty, and `descriptions.zh` is present for all 1,025, so the fallback exists
 * only for a data file that lost a field — and it says so rather than silently
 * returning a two-element array, because a hint list whose length varies turns
 * the page's 「3 則」 into a claim that is sometimes false.
 *
 * @param {object} p one record of pokemon_data.json
 * @returns {string[]}
 */
export function generateHints(p) {
  return [
    typeHint(p) || '這一隻的屬性查不到。',
    PALETTE_HINT,
    descriptionHint(p) || '這一隻沒有圖鑑說明。',
  ];
}

/**
 * Whether revealing hint `index` also expands the palette bar.
 *
 * **Slot 2, not slot 3** — this moved when the palette reveal moved, and it is
 * the kind of constant that silently keeps its old value because a stale `2` and
 * a stale `1` both render something plausible: the bar simply expands one press
 * later than the sentence says it does.
 */
export function hintRevealsPalette(index) {
  return index >= 1;
}