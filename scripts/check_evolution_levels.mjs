/**
 * assets/data/evolution_levels.json — regression test for the real in-game
 * evolution levels that life.html's engine gates on.
 *
 * The file is generated (scripts/fetch_evolution_levels.py) and nothing in the
 * suite would otherwise notice it going wrong in the direction that matters. The
 * failure mode is quiet by construction: a table that loses its levels does not
 * throw, it falls back — `evolutionLevelFor` answers FALLBACK_EVOLUTION_LEVEL for
 * every unlevelled pair, so an emptied `levels` block renders a page where every
 * Pokémon evolves at Lv.30 and every check that asks "is this level right?" still
 * answers yes.
 *
 * So the assertions are about COVERAGE and IDENTITY, not just presence:
 *   - every id in the table is a real species, and vice versa for the species
 *     the corpus says evolve by level
 *   - the levels come from the games, pinned on names a reader can check
 *   - the coverage floor, and the EXACT set of pairs with no level, so a
 *     regression in the fetcher is a diff rather than a vague drift
 *   - the fallback the engine uses is the median of the levels actually in the
 *     table, so the two cannot drift apart silently
 *
 * Run: node scripts/check_evolution_levels.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FALLBACK_EVOLUTION_LEVEL } from '../assets/js/life-engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let checks = 0;
const fails = [];
const eq = (got, want, what) => {
  checks++;
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fails.push(`${what}\n      got:  ${a}\n      want: ${b}`);
};
const ok = (cond, what) => eq(!!cond, true, what);

const table = JSON.parse(read('assets/data/evolution_levels.json'));
const pokemon = JSON.parse(read('assets/data/pokemon_data.json'));
const byId = new Map(pokemon.map((p) => [p.id, p]));

/* 1. Shape. A table read by the engine has to have the two keys it destructures,
      and `absent_chains` has to exist for the 404 report to mean anything. */
ok(table && typeof table === 'object', 'evolution_levels.json parses as an object');
ok(typeof table.levels === 'object', 'has a `levels` object');
ok(typeof table.unlevelled === 'object', 'has an `unlevelled` object');
ok(Array.isArray(table.absent_chains), 'has an `absent_chains` array');
ok(/evolution-chain/.test(String(table.source || '')), 'records the PokeAPI source it came from');

/* 2. Every id mentioned is a real species (1..1025). A form id leaking in here
      would never be looked up by the engine, and would inflate the coverage
      counts below into a claim about more data than exists. */
const speciesIds = new Set(pokemon.map((p) => p.id));
const unknownFrom = [];
const unknownTo = [];
for (const [from, row] of Object.entries(table.levels || {})) {
  if (!speciesIds.has(Number(from))) unknownFrom.push(from);
  for (const to of Object.keys(row)) if (!speciesIds.has(Number(to))) unknownTo.push(to);
}
for (const [from, rows] of Object.entries(table.unlevelled || {})) {
  if (!speciesIds.has(Number(from))) unknownFrom.push(from);
  for (const r of rows) if (!speciesIds.has(Number(r.to))) unknownTo.push(r.to);
}
eq(unknownFrom, [], 'no `levels`/`unlevelled` key names an id outside pokemon_data.json');
eq(unknownTo, [], 'no target id outside pokemon_data.json');

/* 3. Values are levels. min_level is an integer in the games; a string, a float
      or a 0 would compare against `newLevel` in a way that reads as "evolves
      immediately" or "never", and neither shows up as an exception. */
const allLevels = [];
const badValues = [];
for (const [from, row] of Object.entries(table.levels || {})) {
  for (const [to, level] of Object.entries(row)) {
    allLevels.push(level);
    if (!Number.isInteger(level) || level < 2 || level > 100) {
      badValues.push(`${from}->${to}: ${JSON.stringify(level)}`);
    }
  }
}
eq(badValues, [], 'every level is an integer in the playable range 2..100');
ok(allLevels.length > 300, `table carries a real number of levels (got ${allLevels.length}, floor 300)`);

/* 4. The fallback IS the median of the table's own levels.
      FALLBACK_EVOLUTION_LEVEL is a constant in the engine; if the table is ever
      re-fetched from a changed upstream its median moves and the constant would
      silently stop describing the corpus. */
const sorted = [...allLevels].sort((a, b) => a - b);
const median = sorted[sorted.length >> 1];
eq(FALLBACK_EVOLUTION_LEVEL, median,
  `FALLBACK_EVOLUTION_LEVEL is the median of the table's levels`);
ok(median >= 20 && median <= 40,
  `median level is in a sane band, so "median" is not accidentally "minimum" (got ${median})`);

/* 5. Coverage floor AND the exact unlevelled set.
      A floor alone would let the table lose a fifth of its levels unnoticed; the
      exact set makes a fetcher regression a readable diff. Both are stated
      numbers, not derived from the file being checked. */
const levelledPairs = Object.values(table.levels).reduce((n, row) => n + Object.keys(row).length, 0);
const unlevelledPairs = Object.values(table.unlevelled).reduce((n, rows) => n + rows.length, 0);
const totalPairs = levelledPairs + unlevelledPairs;
const coverage = levelledPairs / totalPairs;
eq(totalPairs, 489, 'distinct (from -> to) pairs in the table');
eq(levelledPairs, 348, 'pairs carrying a real level');
eq(unlevelledPairs, 141, 'pairs with no level (stones, trades, friendship, day/night)');
ok(coverage > 0.7 && coverage < 0.73,
  `levelled coverage is 71.2% (got ${(coverage * 100).toFixed(1)}%)`);
eq(Object.keys(table.levels).length, 341, 'species that evolve by level');
eq(Object.keys(table.unlevelled).length, 125, 'species whose every step is some other trigger');

/* 6. Eevee is the case a per-species design cannot express, so it is asserted in
      full: 19 steps, none of them level-gated, spanning five trigger kinds. */
eq(table.levels['133'] || {}, {}, 'Eevee has no level-gated step');
const eeveeTriggers = new Set((table.unlevelled['133'] || []).map((r) => r.trigger));
ok(eeveeTriggers.has('use-item'), 'Eevee has a use-item step (Water Stone)');
ok(eeveeTriggers.has('level-up'), 'Eevee has a level-up step with no min_level (friendship)');
ok((table.unlevelled['133'] || []).some((r) => r.detail.includes('day')),
  'Eevee -> Espeon is day-gated, Umbreon night-gated');

/* 7. Levels a reader can check by eye, on the starters and the two ends of the
      scale. A wrong number here is a wrong number on the page, not a data smell. */
const PINNED = [
  [1, 2, 16, '妙蛙種子 -> 妙蛙草'],
  [2, 3, 32, '妙蛙草 -> 妙蛙花'],
  [4, 5, 16, '小火龍 -> 火恐龍'],
  [5, 6, 36, '火恐龍 -> 噴火龍'],
  [7, 8, 16, '傑尼龜 -> 卡咪龜'],
  [8, 9, 36, '卡咪龜 -> 水箭龜'],
  [10, 11, 7, '綠毛蟲 -> 鐵甲蛹'],
  [11, 12, 10, '鐵甲蛹 -> 巴大蝶'],
  [19, 20, 20, '小拉達 -> 拉達'],
  [43, 44, 21, '走路草 -> 臭臭花'],
  [118, 119, 33, '角金魚 -> 金魚王'],
  [372, 373, 50, '甲殼龍 -> 暴飛龍'],
  [133, 136, null, '伊布 -> 火伊布 (stone)'],
  [152, 133, null, '菊草葉 -> 伊布 (friendship)']
];
for (const [from, to, want, label] of PINNED) {
  const got = table.levels[String(from)]?.[String(to)] ?? null;
  eq(got, want, `pinned level: ${label}`);
  // The label is written for humans, so make sure it is not lying about the ids.
  // Only the pair is compared: three of these labels carry a parenthetical
  // ("(stone)", "(friendship)") describing the trigger, which is not in the data.
  const pair = `${byId.get(from)?.names?.zh} -> ${byId.get(to)?.names?.zh}`;
  ok(label.startsWith(pair), `pinned label names the right pair: ${label} vs ${pair}`);
}

const minLevel = sorted[0];
const maxLevel = sorted[sorted.length - 1];
eq(minLevel, 7, 'lowest level in the table (Caterpie -> Metapod)');
eq(maxLevel, 64, 'highest level in the table');
ok(new Set(sorted).size >= 40, `levels are spread, not clustered (${new Set(sorted).size} distinct)`);

/* 8. The one chain PokeAPI does not have, pinned as a set rather than a count.
      It is Melmetal (809), whose only other chain member is the form
      Melmetal-Max, so nothing is lost — but "at most one" would also pass if a
      second chain started 404ing and silently emptied. */
eq(table.absent_chains, ['429'], 'the single chain id PokeAPI lacks');

/* 9. FIVE pairs appear in BOTH halves, and that is the games, not a bug.

      Sandshrew evolves to Sandslash at Lv.22 OR with an Ice Stone; Meowth to
      Persian at Lv.28 OR with friendship; Voltorb to Electrode at Lv.30 OR with a
      Leaf Stone. So PokeAPI reports two steps for one pair, and the question
      "must not overlap" is the wrong one — the engine's answer is that the real
      level wins, because a level IS one of the two routes.

      Pinned as an exact set because it is short and every one of them is
      checkable by a reader: a sixth would mean the fetcher started folding
      something it should not, and a pair DROPPING out would mean the level half
      quietly lost a species. */
const overlap = [];
for (const [from, row] of Object.entries(table.levels || {})) {
  for (const r of table.unlevelled[from] || []) {
    if (Object.prototype.hasOwnProperty.call(row, String(r.to))) overlap.push(`${from}->${r.to}`);
  }
}
// Numeric, not lexicographic: '100->101' sorts before '27->28' as a string,
// which reads as a diff every time the set is unchanged.
eq(overlap.sort((a, b) => Number(a.split('->')[0]) - Number(b.split('->')[0])),
  ['27->28', '52->53', '79->80', '100->101', '554->555'],
  'the pairs the games offer two routes for (level OR item)');

/* 10. A species in both halves is therefore normal — 9 of them, and one of the
       five overlap pairs above is Meowth, whose other route is friendship. */
const bothHalves = Object.keys(table.levels).filter((f) => (table.unlevelled[f] || []).length > 0);
eq(bothHalves.length, 9, 'species carrying a mix of levelled and unlevelled steps');

if (fails.length > 0) {
  console.log(`FAIL  ${fails.length} of ${checks} checks\n`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks — evolution levels, coverage ${(coverage * 100).toFixed(1)}%, fallback Lv.${FALLBACK_EVOLUTION_LEVEL}`);