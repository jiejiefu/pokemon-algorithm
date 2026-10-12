/**
 * The colour game's three hints.
 *
 *   color-game.html          the only page caller
 *   check_game_hints.mjs     runs it in bare Node
 *
 * ---------------------------------------------------------------------------
 * The port, and the three things in it that must NOT be copied
 * ---------------------------------------------------------------------------
 *
 * Source is pokemonpalette's `src/lib/game/hints.ts`. Its skeleton is copied:
 * seven categories, vague -> medium -> a fixed closer, and every step avoiding
 * facts the reader already has. The third slot's fixed string is copied too
 * ("Full palette shown" there, translated here), because "the last one is always
 * this sentence" is itself the rule — it makes the two informative hints
 * predictable instead of a fresh surprise each round.
 *
 * Three things must differ:
 *
 * 1. **Evolution stage cannot come from `stage`.** The reference reads `evolution`
 *    out of its own data; this project's `evolution_chains.json` carries the §3.K
 *    trap, where `stage` is DEX ORDER and not DEPTH, so a branching family reads
 *    as eight successive stages. Using it to answer "is this a final evolution?"
 *    treats siblings as ancestors.
 *
 *    The correct source is the EDGE LIST in `evolution_levels.json`: `levels` plus
 *    `unlevelled` is all 789 edges (457 species evolve, 568 are final). A species
 *    evolves IFF its id is a key of one of those two tables. That is §3.K's
 *    conclusion, directly usable.
 *
 * 2. **Classification goes through `genusZh()`.** `pokemon-lexicon.js` already
 *    holds the full zh table (`GENUS_ZH_BY_ID`); a second one here is a second
 *    source of truth.
 *
 * 3. **The Pokédex line must not leak the answer.** This project's
 *    `descriptions.zh` are short (median 32 characters) and **93 of them contain
 *    the species' own name** — which prints the answer directly on the hint. So
 *    any description naming the species is refused outright.
 *
 * ---------------------------------------------------------------------------
 * WHY DEDUPLICATION AGAINST KNOWN FACTS IS THE POINT OF THE MODULE
 * ---------------------------------------------------------------------------
 *
 * After a wrong guess the card already carries 同屬性 / 同一進化家族 badges. A hint
 * that then says 「這是一隻火屬性」 gives the reader nothing they did not have,
 * and they spent a 5-second cooldown on it. `knownFacts` collects everything the
 * previous guesses already revealed, and a spent category falls through to the
 * next one.
 */

import { genusZh } from './pokemon-lexicon.js';
import { fnv1a, mulberry32 } from './daily-pick.js';

/** The seven categories. Cheap ones first, for no stronger reason than that. */
export const HINT_CATEGORIES = [
  'type',
  'evolution',
  'generation',
  'species',
  'description',
  'first_letter',
  'weight_class',
];

export const HINT_CATEGORY_LABELS = {
  type: '屬性',
  evolution: '進化',
  generation: '世代',
  species: '分類',
  description: '圖鑑說明',
  first_letter: '首字母',
  weight_class: '體重',
};

/** Which slot each category competes for. */
export const HINT_CATEGORY_BUCKETS = {
  type: 'medium',
  evolution: 'vague',
  generation: 'medium',
  species: 'medium',
  description: 'specific',
  first_letter: 'vague',
  weight_class: 'vague',
};

/** At most 3 hints. The reference says 3. */
export const MAX_HINTS = 3;

/**
 * The third hint, always this sentence.
 *
 * It is not "a" hint, it is the CLOSER: the first two are clues, the third is
 * the reveal. Fixing the wording (rather than drawing another category) means the
 * reader knows what pressing to the end gives them, and because 「顯示完整色盤」
 * costs no reasoning, putting it last never reads as a dead end.
 */
export const FINAL_HINT = '顯示完整色盤 — 目標的所有顏色都在下面了';

/** What the reader already knows. The guess cards' badges fill this in. */
export function emptyKnownFacts() {
  return { types: [], sameFamily: false, generations: [] };
}

/** Merge one guess's relatedness into the known set. */
export function learnFromGuess(known, related) {
  const next = known || emptyKnownFacts();
  const types = new Set((next.types || []).map((t) => String(t).toLowerCase()));
  for (const t of (related && related.sharedTypes) || []) types.add(String(t).toLowerCase());
  const generations = new Set(next.generations || []);
  for (const g of (related && related.generationIds) || []) generations.add(g);
  return {
    types: [...types],
    sameFamily: Boolean(next.sameFamily || (related && related.sameEvolutionFamily)),
    generations: [...generations],
  };
}

// ---------------------------------------------------------------------------
// Per-category text
// ---------------------------------------------------------------------------

/** A species' types, in zh. Single and dual get different sentences. */
export function typeHint(p) {
  const t = Array.isArray(p.types_zh) && p.types_zh.length ? p.types_zh : p.types;
  if (!Array.isArray(t) || !t.length) return null;
  if (t.length === 1) return `這一隻是${t[0]}屬性。`;
  return `這一隻是${t.join('、')}的雙屬性。`;
}

/**
 * Whether it evolves at all. From the edge list, NOT `stage` — see the filehead.
 *
 * Both sentences are a single binary fact with nothing in between, so this can
 * only be spent once.
 */
export function evolutionHint(p, evolves) {
  return evolves ? '這一隻還會再進化。' : '這一隻已經是進化的最終型。';
}

export function generationHint(p) {
  const numeral = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' };
  const n = Number(p.generation);
  if (!n || !numeral[n]) return null;
  return `這一隻出現在第${numeral[n]}世代。`;
}

/** Classification. Via `genusZh()`, because that table is already in the project. */
export function speciesHint(p) {
  const genus = genusZh(p);
  if (!genus || genus === '—') return null;
  return `這一隻屬於${genus}。`;
}

/**
 * The Pokédex line — but never one that contains the species' own name.
 *
 * 93 zh descriptions have that problem, so this is a hard condition rather than
 * a filter with a threshold. The 200-character cap is inherited from the
 * reference; this project's lines are all under 50 characters, so it never fires
 * here, and keeping it means a future data source cannot turn a hint into an
 * encyclopedia entry.
 */
export function descriptionHint(p) {
  const zh = p.descriptions && (p.descriptions.zh || p.descriptions.zh_text2);
  const text = typeof zh === 'string' ? zh.trim() : '';
  if (!text || text.length >= 200) return null;
  const name = p.names && p.names.zh;
  if (name && text.includes(name)) return null;
  return `官方說明：「${text}」`;
}

export function firstLetterHint(p) {
  const name = p.names && p.names.zh;
  if (!name || !name.length) return null;
  return `名字的第一個字是「${name[0]}」。`;
}

/**
 * Weight bands. The reference's boundaries are kept because they read as "order
 * of magnitude" rather than as false precision.
 *
 * **`Number(null)` is `0`** — so `if (!Number.isFinite(kg))` does not stop a
 * species with no weight; it sails through `Number(null) < 10` and answers
 * 「體重不到 10 公斤」. That is the same trap as `check_all.mjs`'s cache reading
 * `== null` and reporting `last 0.0s`: converting "no value" into a number and
 * then comparing it produces a perfectly plausible answer. So the type is
 * checked before the conversion.
 */
export function weightHint(p) {
  if (!p || typeof p.weight_kg !== 'number' || !Number.isFinite(p.weight_kg)) return null;
  const kg = p.weight_kg;
  if (kg < 10) return '體重不到 10 公斤。';
  if (kg < 50) return '體重在 10 到 50 公斤之間。';
  if (kg < 100) return '體重在 50 到 100 公斤之間。';
  if (kg < 250) return '體重在 100 到 250 公斤之間。';
  return '體重超過 250 公斤。';
}

// ---------------------------------------------------------------------------
// Candidates and selection
// ---------------------------------------------------------------------------

/**
 * Every hint this species can produce, by category.
 *
 * Returns objects rather than strings so that "already spent" can be filtered
 * AFTER generation, without threading `knownFacts` through seven signatures —
 * six of which do not need it.
 */
export function buildCandidates(p, evolves) {
  const out = [];
  const push = (category, text) => {
    if (text) out.push({ category, bucket: HINT_CATEGORY_BUCKETS[category], text });
  };
  push('type', typeHint(p));
  push('evolution', evolutionHint(p, evolves));
  push('generation', generationHint(p));
  push('species', speciesHint(p));
  push('description', descriptionHint(p));
  push('first_letter', firstLetterHint(p));
  push('weight_class', weightHint(p));
  return out;
}

/**
 * Which categories have been spent, counting ONLY what the reader actually saw.
 *
 * Note that sameGeneration is deliberately absent: the reference computes it and
 * never renders it, so treating it as known would wrongly suppress the
 * generation hint — which is the buggy side of that choice, not the cautious one.
 */
function spentCategories(p, known) {
  const spent = new Set();
  const k = known || {};
  const targetTypes = new Set((p.types_zh || p.types || []).map((t) => String(t).toLowerCase()));
  if ((k.types || []).some((t) => targetTypes.has(String(t).toLowerCase()))) spent.add('type');
  if (k.sameFamily) spent.add('evolution');
  if ((k.generations || []).includes(Number(p.generation))) spent.add('generation');
  return spent;
}

/**
 * Which categories remain, after removing the spent ones.
 *
 * This exists because the dedup is only observable as a CATEGORY SET, never as
 * output text: once a category is removed the shuffle may not have picked it
 * anyway, so "the output does not mention 火屬性" cannot tell "suppressed" from
 * "not drawn this time". The page also needs to know how many are left in order
 * to decide the hint button's state — a lit button that pays out a different
 * sentence each press after three badges already covered the ground is worse
 * than a dark one.
 *
 * @returns {string[]} category names, in `HINT_CATEGORIES` order
 */
export function remainingCategories(p, evolves, knownFacts = null) {
  const spent = spentCategories(p, knownFacts);
  return buildCandidates(p, evolves)
    .filter((c) => !spent.has(c.category))
    .map((c) => c.category);
}

/**
 * A seeded shuffle, seeded on the target's id.
 *
 * **Without a shuffle, five of the seven categories never appear.** That was this
 * version's bug: it took `vague[0]` and `medium[0]` unconditionally, and
 * `evolution` sorts before `type`, so every single game opened with 「這一隻還會
 * 再進化」 and closed its second slot with the types. Generation, classification,
 * Pokédex line, first letter and weight were all dead code — they had functions,
 * they had docblocks, and not one word of them would ever be read.
 *
 * The measurement is "does this category's text appear in any species'
 * `generateHints()` result", not "did it produce a candidate": the latter passes
 * for all seven, the latter is what exposed two of them.
 *
 * **The seed must be the id, not `Math.random()`.** The page re-runs this on
 * every render (§3.B1's detached-node incident), so a random seed would swap the
 * sentence under a hint that is already on screen — and a revealed hint cannot be
 * taken back. Seeding on the id means "these three hints, for this species",
 * identically, however many times it is called.
 */
function shuffle(list, seed) {
  const rand = mulberry32(fnv1a(`game-hints:${seed}`));
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Produce the three hints.
 *
 * Guaranteed: the length is ALWAYS 3. A shorter result would drop the third
 * hint's 「顯示完整色盤」, which is the entire endpoint of the hint system, so
 * any shortfall is topped up from the remaining categories and finally from a
 * sentence carrying no information — rather than returning a short array, since
 * a hint list whose length varies turns the page's "3 則" into a claim that is
 * sometimes false.
 *
 * Order: the first is drawn from vague, the second from medium, each shuffled
 * within its own pool. The third is fixed.
 *
 * @param {object} p one record of pokemon_data.json
 * @param {boolean} evolves from the edge list, NOT `stage`
 * @param {object} knownFacts the result of `learnFromGuess()`
 * @returns {string[]}
 */
export function generateHints(p, evolves, knownFacts = null) {
  const spent = spentCategories(p, knownFacts);
  const candidates = buildCandidates(p, evolves).filter((c) => !spent.has(c.category));

  const vague = shuffle(candidates.filter((c) => c.bucket === 'vague'), p.id);
  const medium = shuffle(candidates.filter((c) => c.bucket === 'medium'), p.id);
  const specific = shuffle(candidates.filter((c) => c.bucket === 'specific'), p.id);

  const hints = [];
  /* The first is drawn from vague, the second from medium, each shuffled in its
     own pool. The reference's "at least one hint is always about types" guarantee
     is deliberately NOT reproduced: the reader can already see the types on the
     guess card, so forcing one repeats information they already have and costs
     them a 5-second cooldown to do it. */
  const first = vague[0] || medium[0];
  if (first) hints.push(first.text);

  /* The second: `medium` and `specific` shuffled together, competing.
   *
   * `specific` used to be a last resort consulted only after `medium` ran out,
   * and that meant it never came up: four of the seven categories are vague and
   * three are medium, so `specific` sat on the bench until medium was empty. The
   * measurement is "does this category's text appear in any species' result" —
   * all seven pass at the candidate stage, only six reach the player.
   * `description` was not removed; it was parked in a position that never came
   * up.
   *
   * So medium and specific compete together, and "vague first, then medium"
   * still holds (the first slot is always the least informative category
   * available). The reference's specific bucket has two members and sits last
   * too; it simply never had this many candidates on the other side, so the
   * ordering looked harmless there. */
  const second = shuffle([...medium, ...specific], p.id).find((c) => !hints.includes(c.text))
    || vague.find((c) => !hints.includes(c.text));
  if (second) hints.push(second.text);

  // Top up to two — the third is the fixed closer, so the first two must be filled.
  for (const pool of [shuffle([...medium, ...specific], p.id), vague, shuffle(candidates, p.id)]) {
    for (const c of pool) {
      if (hints.length >= 2) break;
      if (!hints.includes(c.text)) hints.push(c.text);
    }
    if (hints.length >= 2) break;
  }
  while (hints.length < 2) hints.push('這一次沒有更多線索了。');

  return [hints[0], hints[1], FINAL_HINT];
}

/** Whether revealing hint `index` also expands the palette bar. */
export function hintRevealsPalette(index) {
  return index >= 2;
}