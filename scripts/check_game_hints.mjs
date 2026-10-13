/**
 * The colour game's hints (assets/js/game-hints.js).
 *
 *   node scripts/check_game_hints.mjs
 *
 * Three fixed slots, so this file is much smaller than the category machine it
 * replaced — and the interesting part is not the assertions, it is the two things
 * that had to be measured before the module could be written at all.
 *
 * ---------------------------------------------------------------------------
 * WHY 屬性 AND NOT CLASSIFICATION OR FIRST LETTER
 * ---------------------------------------------------------------------------
 *
 * A hint's value is how far it cuts the candidate pool. Measured over all 1,025
 * targets, with the pool a single hint leaves behind:
 *
 *   classification (genus)   2      ← strongest, and therefore NOT a hint
 *   first letter              5      ← same
 *   generation              120
 *   type                    140      ← this project's slot 1
 *   weight band             277
 *   evolves / final form    519      ← weakest, and removed on that basis
 *
 * 「這一隻已經是進化的最終型」 cuts the pool by barely 2x and varies by only
 * 457..568 across all targets, so it says almost nothing that varies. The reading
 * 「if it has no evolution, tell me it has no evolution」 is the correct description
 * of it.
 *
 * Classification and first letter are the opposite problem: leaving two or five
 * candidates is not a clue, it is the answer.
 *
 * `speciesHint()` used to be exported from this module on the stated ground that
 * the classification number had to stay reproducible. It could not be: it returns
 * 「這一隻屬於鼠寶可夢。」, which has nothing to do with a final-form claim, and the
 * figure quoted for it (568) contradicts this table's 519 — so it was never the
 * measurement's source and was only keeping a dead export alive. Both are gone.
 * A check that cannot reproduce its own number is a comment, not a guard.
 *
 * ---------------------------------------------------------------------------
 * SLOT 3 MASKS THE NAME RATHER THAN REFUSING THE LINE
 * ---------------------------------------------------------------------------
 *
 * 93 of the 1,025 `descriptions.zh` contain their own species name — #4 小火龍
 * opens 「尾巴上燃燒的火焰是小火龍生命力的象徵」. The port REFUSED those lines and
 * substituted a different category. That was wrong twice over: it meant those 93
 * species received a DIFFERENT third hint from the other 932, and it threw away
 * a description that was perfectly usable once the name was taken out.
 *
 * Masking keeps every species on the same slot and removes only the answer:
 *
 *   「當噴火龍憤怒至極時…」 -> 「當ＯＯＯ憤怒至極時…」
 *
 * So the strong invariant is the negative one — slot 3 never contains the
 * species' own name — and the mask width is a second claim: one mask per
 * character, so the length of the hidden run stays visible.
 *
 * The second level is 38 species with a TWO-CHARACTER run of their name and no
 * full name — #1 妙蛙種子's line has 種子, #85 嘟嘟利's has 嘟嘟, #109 瓦斯彈's
 * has 瓦斯. Those are masked too.
 *
 * The rule is LONGEST RUN FIRST, not "mask every two-character window". Measured
 * over all 1,025 species the naive rule rewrites **892** lines — including every
 * ordinary word that happens to be a substring of the name — while longest-first
 * rewrites **131** (93 + 38) and leaves the other 894 byte-identical. Both numbers
 * are asserted, because the difference between them is the entire justification
 * for the ordering.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MAX_HINTS, PALETTE_HINT, DESCRIPTION_PREFIX, NAME_MASK,
  typeHint, descriptionHint, generateHints, hintRevealsPalette,
} from '../assets/js/game-hints.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let total = 0;
let failures = 0;
function check(ok, description, detail = () => '') {
  total++;
  if (ok) console.log(`  ok   ${description}`);
  else { failures++; console.log(`  FAIL ${description}`); console.log(`       ${detail()}`); }
}

const data = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'));

/* The module's source, comments masked. Hoisted to module scope because the shape
 * block below and the speciesHint-removal checks both need it, and a second read
 * inside each block is two copies of the same decision. */
const src = readFileSync(join(ROOT, 'assets/js/game-hints.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const byId = new Map(data.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
console.log('\nthree slots, in order, always');
// ---------------------------------------------------------------------------
{
  check(MAX_HINTS === 3, '3 hints');

  const lens = new Set();
  let slot1Wrong = 0, slot2Wrong = 0, slot3Wrong = 0;
  for (const p of data) {
    const h = generateHints(p);
    lens.add(h.length);
    if (h[0] !== typeHint(p)) slot1Wrong++;
    if (h[1] !== PALETTE_HINT) slot2Wrong++;
    if (h[2] !== descriptionHint(p)) slot3Wrong++;
  }
  check(lens.size === 1 && lens.has(3),
    'every one of the 1,025 produces exactly 3 — the length never varies',
    () => `lengths seen: ${[...lens].join(', ')}. A variable-length hint list makes the page's 「3 則」 a claim that is sometimes false`);
  check(slot1Wrong === 0, 'slot 1 is always the type', () => `${slot1Wrong} differ`);
  check(slot2Wrong === 0, 'slot 2 is always the palette reveal', () => `${slot2Wrong} differ`);
  check(slot3Wrong === 0, 'slot 3 is always the Pokédex line', () => `${slot3Wrong} differ`);

  // Slot 2 is the reveal, and that index MOVED from 2 to 1. A stale 2 still
  // renders something plausible — the bar simply expands one press later than the
  // sentence says — so this is asserted rather than trusted.
  check(hintRevealsPalette(0) === false && hintRevealsPalette(1) === true,
    'slot 2 expands the palette, not slot 3',
    () => `reveal at 0: ${hintRevealsPalette(0)}, at 1: ${hintRevealsPalette(1)}, at 2: ${hintRevealsPalette(2)} — the constant moved from 2 to 1 when the reveal did, and a stale 2 looks fine`);
}

// ---------------------------------------------------------------------------
console.log('\nslot 1: the type');
// ---------------------------------------------------------------------------
{
  const pika = byId.get(25);
  const bulba = byId.get(1);
  const eevee = byId.get(133);
  check(typeHint(pika) === '屬性：電', 'single type reads as a label', () => typeHint(pika));
  check(typeHint(bulba) === '屬性：草、毒', 'a dual type is both, comma-separated', () => typeHint(bulba));
  check(typeHint(eevee) === '屬性：一般', 'Normal is 一般, the official zh-TW term', () => typeHint(eevee));
  check(typeHint({ types_zh: [], types: [] }) === null, 'a species with no types has no type hint');
  check(typeHint({ types: ['Fire'] }) === '屬性：Fire',
    'and it falls back to the English list rather than saying nothing',
    () => typeHint({ types: ['Fire'] }));

  // The claim in the filehead: type leaves ~140 candidates.
  const mean = data.reduce((sum, t) => sum
    + data.filter((p) => p.types.some((x) => t.types.includes(x))).length, 0) / data.length;
  check(mean > 60 && mean < 260,
    `type leaves about ${Math.round(mean)} of 1,025 candidates — measured`,
    () => `mean ${Math.round(mean)}; outside 60..260 the slot-1 justification in the filehead is wrong`);
}

// ---------------------------------------------------------------------------
console.log('\nslot 3: the Pokédex line, verbatim');
// ---------------------------------------------------------------------------
{
  const bulba = byId.get(1);
  /* The spec quoted Bulbasaur's line as the raw data. It is no longer printed
   * whole: 種子 is a two-character run of 妙蛙種子, so the second-level mask hides
   * it. Asserting the raw line would be asserting the very leak that mask exists
   * to close — and this assertion is the one that had to change when the second
   * level landed, which is the point of writing it out. */
  const expected = '圖鑑說明：「在出生後的一段時間內，牠會吸收背上ＯＯ裡儲存著的營養成長。」';
  check(generateHints(bulba)[2] === expected,
    'and Bulbasaur\'s slot 3 is that line with 種子 masked',
    () => generateHints(bulba)[2]);
  check(generateHints(bulba)[2].includes(NAME_MASK.repeat(2)),
    'which is the second level working on a species whose name never appears whole');

  const missing = data.filter((p) => !p.descriptions || !p.descriptions.zh);
  check(missing.length === 0,
    'every species has a zh line, so slot 3 never falls back',
    () => `${missing.length} missing, so the fallback sentence is what those players see`);

  const lens = data.map((p) => p.descriptions.zh.length).sort((a, b) => a - b);
  check(lens[lens.length - 1] < 200,
    `and they are short (median ${lens[Math.floor(lens.length / 2)]}, max ${lens[lens.length - 1]})`,
    () => 'over 200 characters would be an encyclopedia entry on a hint chip');

  /* THE STRONG INVARIANT, over every species rather than over the 93. A checker
   * that only examined the leaking lines would pass while a new species started
   * leaking. */
  const leaking = data.filter((p) => generateHints(p)[2].includes(p.names.zh));
  check(leaking.length === 0,
    'no species\'s slot 3 contains its own name',
    () => `${leaking.length} still leak: ${leaking.slice(0, 6).map((p) => `#${p.id} ${p.names.zh}`).join(', ')} — masking is done with split/join, so a species whose name appears with different spacing would slip past a substring test`);

  /* The user's example, asserted verbatim. */
  const char = byId.get(6);
  check(generateHints(char)[2] === '圖鑑說明：「當ＯＯＯ憤怒至極時，尾巴前端就會燃起藍白色的火焰。」',
    'and the spec\'s example is exactly what it produces',
    () => generateHints(char)[2]);

  /* One mask per character, so the hidden run stays countable. */
  const charmander = byId.get(4);
  check(generateHints(charmander)[2].includes(NAME_MASK.repeat(3)),
    `the mask is ${NAME_MASK} repeated once per hidden character`,
    () => generateHints(charmander)[2]);
  check(!generateHints(char)[2].includes('█') && NAME_MASK === 'Ｏ',
    'and it is the fullwidth Ｏ the spec asks for, not a block glyph');

  /* Every occurrence, not just the first. */
  const multi = data.find((p) => (p.descriptions.zh.split(p.names.zh).length - 1) >= 2);
  check(!multi || generateHints(multi)[2].includes(p.names.zh) === false,
    'a line naming the species twice is masked at BOTH occurrences',
    () => multi ? `#${multi.id} ${multi.names.zh}: ${generateHints(multi)[2]}` : 'no species names itself twice, so this case cannot run here');

  /* The second level: a two-character run with no full name. Now masked too, and
   * the NEGATIVE form is asserted — for all 1,025, no run of two or more
   * characters of the name survives anywhere in slot 3. Checking only the 38 would
   * pass while a new species started leaking. */
  const partial = data.filter((p) => !p.descriptions.zh.includes(p.names.zh) && p.names.zh.length > 2
    && [...Array(p.names.zh.length - 1).keys()]
      .some((i) => p.names.zh.length - i >= 2 && p.descriptions.zh.includes(p.names.zh.slice(i, i + 2))));
  check(partial.length === 38,
    `38 species carry a 2-character run with no full name (#1 妙蛙種子 -> 種子) — the second level, now masked (${partial.length})`,
    () => `${partial.length}, not 38`);
  const stillLeaking = data.filter((p) => {
    const shown = generateHints(p)[2];
    return p.names.zh.length > 1 && [...Array(p.names.zh.length - 1).keys()]
      .some((i) => p.names.zh.length - i >= 2 && shown.includes(p.names.zh.slice(i, i + 2)));
  });
  check(stillLeaking.length === 0,
    'and no 2-character run of any species name survives in any of the 1,025',
    () => `${stillLeaking.length} still leak: ${stillLeaking.slice(0, 5).map((p) => `#${p.id} ${p.names.zh}`).join(', ')}`);

  /* Longest-first versus every-2-char-window. This is the whole justification for
   * the ordering, so it is measured rather than asserted in prose. */
  const touched = data.filter((p) => generateHints(p)[2].includes(p.names.zh)
    || [...Array(Math.max(0, p.names.zh.length - 1)).keys()]
      .some((i) => p.names.zh.length - i >= 2 && p.descriptions.zh.includes(p.names.zh.slice(i, i + 2)))).length;
  check(touched === 131, `131 species are masked at all — 93 full + 38 partial (${touched})`,
    () => `${touched}, not 131`);
  const untouched = data.filter((p) => generateHints(p)[2].includes(p.descriptions.zh)).length;
  check(untouched === 894,
    `and 894 lines stay byte-identical, which is what longest-first buys over masking every 2-char window (that would rewrite 892)`,
    () => `${untouched}, not 894`);

  /* And the naive version's cost, stated as a number: it rewrites lines that
   * contain no run of the name at all. */
  /* WHAT LONGEST-FIRST ACTUALLY BUYS, measured rather than asserted.
   *
   * The first version of this file claimed longest-first rewrote 131 lines where
   * the every-2-char-window rule rewrote 892, and that was false — both rules
   * only rewrite a window that OCCURS, so both touch the same 131 species. The
   * real difference is that shortest-first consumes a two-character window that
   * overlaps the rest of the name, which leaves the remainder visible: 噴火龍's
   * line becomes 「當ＯＯ龍憤怒至極時」 and the 龍 is the reader's for free.
   *
   * So the assertion is on the LEAK, not on the rewrite count. */
  const maskOf = (order) => (text, name) => {
    let out = text;
    for (let len = order === 'long' ? name.length : 2; order === 'long' ? len >= 2 : len <= name.length; order === 'long' ? len-- : len++) {
      for (let i = 0; i + len <= name.length; i++) {
        const run = name.slice(i, i + len);
        if (run && out.includes(run)) out = out.split(run).join(NAME_MASK.repeat(run.length));
      }
    }
    return out;
  };
  const shortest = maskOf('short');
  /* Compare the masked TEXT against the masked TEXT. The first version compared
   * `shortest(...)` — which is the bare sentence — against `generateHints(p)[2]`,
   * which is `圖鑑說明：「…」`. Those can never be equal, so the assertion reported
   * 1,025 differing instead of the 66 that are real. */
  const bodyOf = (p) => descriptionHint(p).replace(`${DESCRIPTION_PREFIX}：「`, '').replace(/」$/, '');
  const differing = data.filter((p) => shortest(p.descriptions.zh, p.names.zh) !== bodyOf(p));
  check(differing.length === 66,
    `shortest-first and longest-first differ on ${differing.length} species — and that difference is a leak, not cosmetics`,
    () => `${differing.length}, not 66; the docblock's 「噴火龍 -> 當ＯＯ龍」 example depends on it`);
  const shortLeaksChar = data.filter((p) => {
    const b = shortest(p.descriptions.zh, p.names.zh);
    const good = bodyOf(p);
    return [...p.names.zh].some((ch) => b.includes(ch) && !good.includes(ch));
  }).length;
  check(shortLeaksChar > 0,
    `shortest-first leaves a name character visible in ${shortLeaksChar} lines that longest-first closes`,
    () => 'no species leaked a character under the shorter order — re-read the example before trusting the ordering');
}

// ---------------------------------------------------------------------------
console.log('\nthe categories that are NOT hints, and why they are not');
// ---------------------------------------------------------------------------
{
  const mean = (fn) => data.reduce((s, t) => s + fn(t), 0) / data.length;

  const byClass = mean((t) => data.filter((p) => p.genus === t.genus).length);
  check(byClass < 10,
    `classification would leave ~${byClass.toFixed(0)} candidates — it is the answer, not a hint`,
    () => `mean ${byClass.toFixed(1)}`);

  const byLetter = mean((t) => data.filter((p) => p.names.zh[0] === t.names.zh[0]).length);
  check(byLetter < 12,
    `first letter would leave ~${byLetter.toFixed(0)} candidates — same problem`,
    () => `mean ${byLetter.toFixed(1)}`);

  const byWeight = mean((t) => {
    const band = (kg) => (kg < 10 ? 0 : kg < 50 ? 1 : kg < 100 ? 2 : kg < 250 ? 3 : 4);
    return data.filter((p) => band(p.weight_kg) === band(t.weight_kg)).length;
  });
  check(byWeight > 200,
    `and weight (~${Math.round(byWeight)}) is weaker than type, so it has no slot either`);

  // The classification hint is gone outright, so the guard is its absence — and
  // absence is the checkable claim here. The number it used to be justified by was
  // not reproducible from this module anyway.
  check(!/export function speciesHint/.test(src),
    'speciesHint() is gone rather than exported for a measurement that never used it',
    () => 'a hint nobody renders, kept alive only by the checker that measures it');
  check(!/pokemon-lexicon/.test(src),
    'and the module no longer imports pokemon-lexicon.js at all',
    () => 'genusZh() had exactly one caller — speciesHint() — so the import went with it');

}

// ---------------------------------------------------------------------------
console.log('\nshape (declared as a shape)');
// ---------------------------------------------------------------------------
{
  /* The port imported a PRNG and shuffled seven categories. With three fixed
   * slots there is nothing to shuffle, so a leftover `mulberry32` would be a
   * dependency on daily-pick.js for nothing — and §3.B1's rule is not to hold
   * imports the page does not need. */
  check(!/mulberry32|fnv1a/.test(src), 'the module no longer imports or calls a PRNG',
    () => 'three fixed slots have nothing to shuffle, so the dependency is dead weight');
  check(!/evolutionHint|weightHint|generationHint|firstLetterHint/.test(src),
    'and the five unused hint functions are gone rather than left exported',
    () => 'an exported function nobody calls is a second thing to keep right');
  check(!/descriptions\.zh\s*\.length\s*>=\s*200/.test(src),
    'and it drops the 200-character cap from the port — these lines are all under 50 characters');
  check(/\.split\(run\)\.join\(/.test(src),
    'and masks with split/join rather than a RegExp, because a species name is data',
    () => 'regex metacharacters in a name would throw or match something unintended');
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);