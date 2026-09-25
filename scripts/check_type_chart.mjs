/**
 * Type chart regression test
 *
 *   node scripts/check_type_chart.mjs
 *
 * Guards the generated chart and the typeEffectiveness() wrapper that reads it.
 * The chart itself is verified against the wiki by extract_type_chart.py; this
 * file exists so the *runtime* behaviour is pinned too, including the dual-type
 * multiplication that a previous hand-written implementation got wrong (it
 * unioned the two types' weakness lists instead of multiplying them, so a
 * Fire/Flying Pokémon reported Water as a 2x weakness and Ground as neutral).
 *
 * It imports the real ES modules, so it also catches syntax errors in them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TYPE_CHART, TYPE_CHART_ORDER, TYPE_CHART_SOURCE } from '../assets/js/type-chart.js';
import { typeEffectiveness, EFFECT_BUCKETS } from '../assets/js/pokemon-lexicon.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  }
}

function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
  );
}

/** Collapse typeEffectiveness() output into a { multiplier: [english types] } map. */
function buckets(types) {
  const collected = {};
  for (const bucket of typeEffectiveness(types)) {
    collected[bucket.multiplier] = bucket.types.map(t => t.en).sort();
  }
  // Re-key in canonical strength order so comparisons are not order sensitive.
  const out = {};
  for (const bucket of EFFECT_BUCKETS) {
    if (collected[bucket.multiplier]) out[bucket.multiplier] = collected[bucket.multiplier];
  }
  return out;
}

/** Every attacking type that survives bucketing, i.e. that is not neutral. */
function listed(types) {
  return Object.values(buckets(types)).flat().sort();
}

console.log('type chart regression\n');

/* ---------------------------------------------------------------- provenance */
console.log('provenance');
ok(/wiki\.52poke\.com/.test(TYPE_CHART_SOURCE.url), 'chart records its 52poke source');
ok(Number.isInteger(TYPE_CHART_SOURCE.revid), 'chart records a revision id');
ok(Boolean(TYPE_CHART_SOURCE.timestamp), 'chart records a revision timestamp');

/* ------------------------------------------------------------------- shape */
console.log('shape');
eq(TYPE_CHART_ORDER.length, 18, 'chart covers 18 types');
eq(new Set(TYPE_CHART_ORDER).size, 18, 'type order has no duplicates');
eq(Object.keys(TYPE_CHART).sort(), [...TYPE_CHART_ORDER].sort(), 'every attacking type has a row');

for (const attacker of TYPE_CHART_ORDER) {
  for (const [defender, value] of Object.entries(TYPE_CHART[attacker])) {
    ok(
      TYPE_CHART_ORDER.includes(defender),
      `${attacker} row references unknown defender ${defender}`
    );
    ok(
      [0, 0.25, 0.5, 1, 2, 4].includes(value),
      `${attacker}->${defender} has impossible multiplier ${value}`
    );
  }
}

let nonNeutral = 0;
let immuneCells = 0;
for (const row of Object.values(TYPE_CHART)) {
  for (const value of Object.values(row)) {
    if (value !== 1) nonNeutral += 1;
    if (value === 0) immuneCells += 1;
  }
}
eq(nonNeutral, 120, 'grid has exactly 120 non-neutral cells');
eq(immuneCells, 8, 'grid has exactly 8 immunity cells');

/* --------------------------------------------------- the eight immunities */
console.log('immunities');
const EXPECTED_IMMUNITIES = [
  ['Ghost', 'Normal'], ['Normal', 'Ghost'], ['Fighting', 'Ghost'],
  ['Electric', 'Ground'], ['Ground', 'Flying'], ['Psychic', 'Dark'],
  ['Poison', 'Steel'], ['Dragon', 'Fairy']
];
for (const [attacker, defender] of EXPECTED_IMMUNITIES) {
  ok(
    TYPE_CHART[attacker][defender] === 0,
    `${attacker}->${defender} should be immune`
  );
}

/* ----------------------------------------------- typeEffectiveness buckets */
console.log('bucket order');
eq(
  EFFECT_BUCKETS.map(b => b.multiplier),
  [4, 2, 0.5, 0.25, 0],
  'buckets run strongest to weakest'
);
eq(
  EFFECT_BUCKETS.map(b => b.suffix),
  ['4×', '2×', '½×', '¼×', '0×'],
  'bucket labels use the expected glyphs'
);

console.log('single type');
eq(buckets(['Ice']), { 2: ['Fighting', 'Fire', 'Rock', 'Steel'], 0.5: ['Ice'] },
  'Ice type: weak to Fighting/Fire/Rock/Steel, resists Ice');
eq(buckets(['Ghost']), { 0: ['Fighting', 'Normal'], 0.5: ['Bug', 'Poison'], 2: ['Dark', 'Ghost'] },
  'Ghost type: immune to Fighting/Normal, weak to Dark/Ghost');
eq(buckets(['Fairy']), { 0: ['Dragon'], 0.5: ['Bug', 'Dark', 'Fighting'], 2: ['Poison', 'Steel'] },
  'Fairy type: immune to Dragon, weak to Poison/Steel');

console.log('dual type');
eq(
  buckets(['Grass', 'Poison']),
  {
    2: ['Fire', 'Flying', 'Ice', 'Psychic'],
    0.5: ['Electric', 'Fairy', 'Fighting', 'Water'],
    0.25: ['Grass']
  },
  'Bulbasaur 草/毒 has no 4x and no immunity'
);
eq(
  buckets(['Fire', 'Flying']),
  {
    4: ['Rock'],
    2: ['Electric', 'Water'],
    0.5: ['Fairy', 'Fighting', 'Fire', 'Steel'],
    0.25: ['Bug', 'Grass'],
    0: ['Ground']
  },
  'Charizard 火/飛行 is 4x to Rock and immune to Ground'
);

/* ------------------------------------------ neutral results must disappear */
console.log('cancellation');
{
  // Water/Grass: Ground is weak to Grass, so an attacker pairing 2x with 1/2x
  // lands on 1x and must not be rendered at all.
  ok(!listed(['Water', 'Grass']).includes('Fire'), 'Fire cancels to 1x against Water/Grass');
  eq(buckets(['Water', 'Grass'])[2], ['Bug', 'Flying', 'Poison'],
    'Water/Grass is weak to Bug/Flying/Poison');
  ok(buckets(['Water', 'Grass'])[0.5].includes('Ground'), 'Water/Grass resists Ground');

  // Grass/Rock: Fire hits Grass 2x but Rock 1/2x.
  ok(!listed(['Grass', 'Rock']).includes('Fire'), 'Fire cancels to 1x against Grass/Rock');

  // A pair of resistances multiplies down to 1/4x. Both Bug and Poison attack
  // Ghost/Poison at 1/2x, so both land in the 1/4x bucket.
  eq(buckets(['Ghost', 'Poison'])[0.25], ['Bug', 'Poison'], '1/4x into Ghost/Poison');

  // A 0x beats anything the other type would have done.
  ok(buckets(['Water', 'Ground'])[0].includes('Electric'), 'Electric is 0x into Water/Ground');
  ok(buckets(['Fire', 'Flying'])[0].includes('Ground'), 'Ground is 0x into Fire/Flying');
  eq(buckets(['Fire', 'Flying'])[4], ['Rock'], 'Charizard takes 4x from Rock');
  ok(listed(['Fire', 'Flying']).includes('Water'), 'Charizard takes 2x from Water');
}

/* ------------------------------------------------------------- exhaustive */
console.log('exhaustive');
{
  const allowed = new Set([0, 0.25, 0.5, 1, 2, 4]);
  let combos = 0;
  const single = TYPE_CHART_ORDER.map(t => [t]);
  const dual = [];
  for (let i = 0; i < TYPE_CHART_ORDER.length; i += 1) {
    for (let j = i + 1; j < TYPE_CHART_ORDER.length; j += 1) {
      dual.push([TYPE_CHART_ORDER[i], TYPE_CHART_ORDER[j]]);
    }
  }

  for (const types of [...single, ...dual]) {
    combos += 1;
    for (const attacker of TYPE_CHART_ORDER) {
      // A dual type is at most 2x2 and at least 1/2x1/2, so a product outside
      // the five real strengths means a wrong cell or a missing type.
      let product = 1;
      for (const defender of types) {
        product *= TYPE_CHART[attacker][defender] === undefined ? 1 : TYPE_CHART[attacker][defender];
      }
      ok(allowed.has(product), `${types.join('/')} vs ${attacker} yields ${product}`);
    }

    // Every rendered bucket must be one of the five known strengths, and a
    // neutral row must never surface.
    for (const bucket of typeEffectiveness(types)) {
      ok(
        [4, 2, 0.5, 0.25, 0].includes(bucket.multiplier),
        `${types.join('/')} produced unexpected bucket ${bucket.multiplier}`
      );
      ok(bucket.types.length > 0, `${types.join('/')} rendered an empty bucket`);
      ok(
        bucket.types.every(t => t.zh && t.zh !== t.en),
        `${types.join('/')} bucket ${bucket.suffix} has untranslated type names`
      );
    }
  }
  eq(combos, 18 + 153, 'checked all 18 single and 153 dual type combinations');
}

/* --------------------------------------- every data type is in the chart */
console.log('dataset coverage');
{
  const data = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'data', 'pokemon_data.json'), 'utf8')
  );
  const entries = Array.isArray(data) ? data : data.pokemon || data.data;
  ok(Array.isArray(entries), 'pokemon_data.json parsed to a list');
  const used = new Set(entries.flatMap(p => p.types || []));
  const unknown = [...used].filter(t => !TYPE_CHART_ORDER.includes(t));
  eq(unknown, [], 'every type used by the dataset exists in the chart');
  ok(used.size === 18, `dataset uses all 18 types (saw ${used.size})`);

  // Real entries must produce sane output, not just synthetic type lists.
  for (const entry of [entries[0], entries[24], entries[149], entries[1024]]) {
    const rendered = typeEffectiveness(entry.types);
    ok(rendered.length > 0, `#${entry.id} rendered no effectiveness buckets`);
    ok(
      rendered.every(b => b.types.length > 0),
      `#${entry.id} rendered an empty bucket`
    );
  }
}

console.log(
  failures === 0
    ? `\nall ${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`
);
process.exit(failures === 0 ? 0 : 1);
