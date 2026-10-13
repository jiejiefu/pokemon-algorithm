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
 *   3. 圖鑑說明      `pokemon_data.json`'s `descriptions.zh`, name masked out
 *
 * Nothing is shuffled, so nothing needs deduplicating: 屬性 is always slot 1 and
 * 說明 is always slot 3, and neither can collide with a badge. `remainingCategories()`
 * and `learnFromGuess()` existed to answer "what is left to say?", and with three
 * fixed answers that question no longer exists. They are removed rather than left
 * behind unused, because an exported function nobody calls is a second thing to
 * keep right.
 *
 * ---------------------------------------------------------------------------
 * SLOT 3 IS THE PokéDEX LINE WITH THE NAME MASKED OUT
 * ---------------------------------------------------------------------------
 *
 * 93 of the 1,025 `descriptions.zh` contain their own species name — #4 小火龍
 * opens 「尾巴上燃燒的火焰是小火龍生命力的象徵」. Printing that line as a third
 * hint states the answer, so every run of the species' name is masked to
 * `Ｏ`, one full-width character per masked character:
 *
 *   「尾巴上燃燒的火焰是ＯＯＯ生命力的象徵」
 *
 * A second pass caught what the whole-name pass missed. Bulbasaur's line is
 * 「在出生後的一段時間內，牠會吸收背上種子裡儲存著的營養成長。」 and its name is
 * 妙蛙種子 — no full run, but 種子 is two of its four characters. Measured over
 * the corpus, 38 more species leak this way, for 131 of 1,025 in total; the
 * other 894 lines are untouched, because nothing in them matches.
 *
 * LONGEST RUN FIRST, and that ordering is a correctness requirement rather than
 * an optimisation. Replacing occurrences one name character at a time, shortest
 * first, turns 噴火龍 into `ＯＯ龍`: the 噴 is replaced, and the 火 that 龍 needs to
 * remain is then gone. The two orders differ on 66 species. Sorting the runs by
 * length descending costs one array and cannot have that failure.
 *
 * Only ASCII word characters are considered run boundaries — one CJK character is
 * one "word", because `\b` is defined in terms of `[A-Za-z0-9_]` and treats the
 * boundary between 精 and 靈 as a word break, which is neither useful nor
 * correct here. This is the same reason the module does not lean on
 * `Intl.Segmenter` for it: a boundary that splits a name mid-way is worse than
 * the leak it prevents.
 *
 * Substrings of a name ARE masked, so 種子 is masked wherever it appears in
 * Bulbasaur's line and not only inside 妙蛙種子. That over-masks on purpose.
 * Under-masking is a leak; over-masking is a word the reader can still read, and
 * a hint is allowed to be lossy.
 */

/** At most 3 hints, and always exactly 3. */
export const MAX_HINTS = 3;

/** Slot 2's label. A bare noun: the palette is on screen, so a clause about it is noise. */
export const PALETTE_HINT = '完整色盤';

/** Slot 1's prefix. */
export const TYPE_PREFIX = '屬性';

/** Slot 3's prefix. Same rule as slot 2: label, then the thing. */
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
  if (t.length === 1) return `${TYPE_PREFIX}：${t[0]}`;
  return `${TYPE_PREFIX}：${t.join('、')}`;
}

/**
 * Mask every run of `name` that occurs in `text`, LONGEST RUN FIRST.
 *
 * **The ordering is load-bearing and it is a leak, not cosmetics.** Masking
 * shortest-first consumes the two-character windows before the longer ones, and a
 * window that overlaps the rest of the name eats only part of it:
 *
 *   噴火龍  shortest-first  「當ＯＯ龍憤怒至極時…」   <- 龍 survives
 *           longest-first   「當ＯＯＯ憤怒至極時…」   <- nothing survives
 *
 * Over all 1,025 species the two orders differ on 66 of them, and leaving a
 * character visible on 「ＯＯ龍」 hands the reader the family's ending for free.
 * Longest-first consumes 「噴火龍」 whole, so every shorter run then finds nothing
 * left to match and nothing is left showing.
 *
 * What longest-first does NOT buy is fewer rewrites. An earlier draft of this
 * docblock claimed it left 894 lines untouched against 892 for the naive rule, and
 * that was simply false: a window is only rewritten when it occurs, so both rules
 * touch the same 131 species. The number that distinguishes them is the 66, not
 * the rewrites.
 *
 * `split().join()` rather than a RegExp, because a species name is DATA:
 * metacharacters in it would throw or match something unintended. Bulbasaur's
 * name contains none today; nothing guarantees the next one will.
 *
 * The mask is one character per hidden character, so the length of the gap stays
 * countable: 「當ＯＯＯ憤怒至極時」 says three characters are hidden, which a single
 * █ would have thrown away.
 */
function maskAll(text, name) {
  if (!name) return text;
  let out = text;
  for (let len = name.length; len >= 2; len--) {
    for (let i = 0; i + len <= name.length; i++) {
      const run = name.slice(i, i + len);
      if (run && out.includes(run)) out = out.split(run).join(NAME_MASK.repeat(run.length));
    }
  }
  return out;
}

/**
 * Slot 3 — the Pokédex line, with every run of the species' own name masked out.
 *
 * 93 of the 1,025 `descriptions.zh` contain their own name in full, and 38 more
 * contain a two-character run of it — #1 妙蛙種子's line has 種子, #85 嘟嘟利's
 * has 嘟嘟. The port refused the 93 outright and substituted a different
 * category. That was wrong twice over: it gave those 93 a DIFFERENT third hint
 * from the other 932, and it discarded a description that was perfectly usable
 * once the name was taken out.
 *
 * Masking keeps every species on the same slot and takes away only the answer.
 * Runs are masked LONGEST FIRST, because shortest-first leaves a trailing character
 * visible — see `maskAll()`.
 *
 *   噴火龍  「當噴火龍憤怒至極時，尾巴前端就會燃起藍白色的火焰。」
 *        -> 「當ＯＯＯ憤怒至極時，尾巴前端就會燃起藍白色的火焰。」
 *
 *   妙蛙種子「在出生後的一段時間內，牠會吸收背上種子裡儲存著的營養成長。」
 *        -> 「在出生後的一段時間內，牠會吸收背上ＯＯ裡儲存著的營養成長。」
 *
 * The line still describes the species, which is what a hint is for.
 */
export function descriptionHint(p) {
  const zh = p.descriptions && (p.descriptions.zh || p.descriptions.zh_text2);
  const text = typeof zh === 'string' ? zh.trim() : '';
  if (!text) return null;
  const name = p.names && p.names.zh;
  return `${DESCRIPTION_PREFIX}：「${maskAll(text, name)}」`;
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
    typeHint(p) || `${TYPE_PREFIX}：查不到`,
    PALETTE_HINT,
    descriptionHint(p) || `${DESCRIPTION_PREFIX}：查不到`,
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