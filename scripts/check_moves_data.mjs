/**
 * Move-table regression test
 *
 *   node scripts/check_moves_data.mjs
 *
 * Guards the three generated files behind moves.html / move.html:
 *   assets/data/moves_zh.json            — 919 moves, one row each
 *   assets/data/move_learners.json       — move → the Pokémon that learn it
 *   assets/data/move_learners_count.json — the counts-only companion
 *
 * scripts/fetch_moves.py builds them, and the interesting parts of that build
 * are the choices, not the download. Four of them are pinned here:
 *
 *   1. ALL 919 non-shadow moves ship, not the 782 the learnset references. A
 *      招式 page is a database, so a Z-move nobody can learn is still a row —
 *      but that means "782" is no longer the file's size, and three separate
 *      places in this repo used to say 783 or 782.
 *   2. The effect sentence has TWO provenances and the boundary is a
 *      generation line: 826 from PokeAPI's zh-hant flavour text, 93 from
 *      InfoPoke's Simplified run through OpenCC. Pinning the split is the point;
 *      asserting only "every row has some text" would pass if InfoPoke's markup
 *      changed shape and 26 rows quietly went blank.
 *   3. The conversion is asserted by IDEMPOTENCE, not by "no Simplified
 *      characters". See the note at UNCONVERTED_UPSTREAM below — a
 *      hand-written Simplified set flags 手, 岩 and 污, all of which are correct
 *      Traditional, and would fire on 565 of the 919 rows.
 *   4. `meta` is null for 92 moves because PokeAPI ships meta: null, which is
 *      not the same claim as "this move has no ailment". Both values are in the
 *      file and both mean something different to a team builder.
 *
 * It imports the real ES module, so it also catches a syntax error in the
 * vocabulary tables moves.js and both pages depend on.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MOVE_TARGET_ZH,
  MOVE_CATEGORY_ZH,
  MOVE_AILMENT_ZH,
  moveHasLearners,
} from '../assets/js/moves.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(readFileSync(join(ROOT, 'assets/data', name), 'utf8'));

const MOVES = read('moves_zh.json');
const LEARNSETS = read('learnsets.json');
const LEARNERS = read('move_learners.json');
const LEARNERS_COUNT = read('move_learners_count.json');
const POKEMON = JSON.parse(
  readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8')
);

/** PokeAPI id of the first excluded move. See SHADOW_BLOCK_START in fetch_moves.py. */
const SHADOW_BLOCK_START = 10001;

/** The split fetch_moves.py measures, and the reason it is not a round number. */
const EXPECTED_TOTAL = 919;
const EXPECTED_EFFECT_SOURCES = { 'pokeapi-zh-hant': 826, 'infopoke-s2twp': 93 };
const EXPECTED_UNREFERENCED = 137;
/** Generation 9 — PokeAPI ships meta: null for these. */
const EXPECTED_META_NULLS = 92;

const LEARN_METHODS = ['level', 'machine', 'egg', 'tutor'];

/** Keys of a generated map, ignoring the provenance record. */
function dataKeys(map) {
  return Object.keys(map).filter(k => k !== '_meta');
}

let failures = 0;
let checks = 0;
const notes = [];

function ok(condition, message, detail) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}${detail ? `\n        ${detail}` : ''}`);
  }
}

function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    message,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

/** PokeAPI damage-class slugs, which `class` carries verbatim. */
const DAMAGE_CLASSES = new Set(['physical', 'special', 'status']);

const ids = dataKeys(MOVES).map(Number).sort((a, b) => a - b);

/* ===== shape and provenance ===== */

eq(ids.length, EXPECTED_TOTAL, 'moves_zh.json should carry every non-shadow move');
eq(
  ids[0],
  1,
  'move ids should start at 1'
);
eq(
  ids[ids.length - 1],
  EXPECTED_TOTAL,
  'the last move id should be 919 — the block above it is the excluded shadow set'
);
ok(
  ids.every((id, i) => id === i + 1),
  'move ids should be contiguous 1..919 with no gaps'
);
ok(
  ids.every(id => id < SHADOW_BLOCK_START),
  `no move at or above id ${SHADOW_BLOCK_START} should have shipped`
);

// A name test rather than an id test: shadow-claw, shadow-punch, shadow-force
// and shadow-ball are ordinary moves that begin with the same four letters, so
// anything asserting "no move starts with shadow-" is asserting the wrong thing
// and would fail the day one of them were dropped from the file.
const shadowish = dataKeys(MOVES).filter(k => MOVES[k].en.startsWith('shadow-'));
const shadowBlock = Object.keys(shadowish).map(Number).filter(id => id >= SHADOW_BLOCK_START);
eq(shadowBlock, [], 'no shadow-block move should have shipped');
ok(
  shadowish.length >= 5,
  'sanity: shadow-claw and friends are real moves, so this filter should still find some',
  `found ${shadowish.map(k => MOVES[k].en).join(', ')}`
);

ok(MOVES._meta, 'moves_zh.json has no _meta provenance record');
ok(
  MOVES._meta?.source?.includes('pokeapi'),
  'moves_zh.json _meta.source does not mention PokeAPI',
  MOVES._meta?.source
);
ok(
  MOVES._meta?.effect_sources,
  'moves_zh.json _meta does not record the effect-source split'
);

/* ===== the effect-text split ===== */

const bySource = {};
for (const id of dataKeys(MOVES)) {
  const src = MOVES[id].effectSource;
  bySource[src] = (bySource[src] || 0) + 1;
}
eq(
  bySource,
  EXPECTED_EFFECT_SOURCES,
  'the effect-source split should be 826 from PokeAPI and 93 from InfoPoke'
);
eq(
  MOVES._meta.effect_sources,
  EXPECTED_EFFECT_SOURCES,
  '_meta.effect_sources should agree with the rows it describes'
);

/*
 * IDEMPOTENCE, not "contains no Simplified characters".
 *
 * The 93 rows were produced by OpenCC s2twp, so re-running the converter on the
 * shipped text must be a no-op — satisfied by exactly one condition, that the
 * conversion ran to completion on the rows it was meant to run on.
 *
 * A Simplified-character set is the obvious wrong check here and it fails
 * badly: 手, 岩 and 污 are all flagged by a naive set and all three are correct
 * Traditional in this corpus. It is 565 of 919 rows of noise.
 */
const rowsWithoutEffect = dataKeys(MOVES).filter(id => !MOVES[id].effect);
eq(rowsWithoutEffect, [], 'every shipped move should have effect text');

const effectSourceByVersion = {};
for (const id of dataKeys(MOVES)) {
  const { effectSource, effectVersion } = MOVES[id];
  if (!effectVersion) {
    ok(false, `move ${id} has effect text but no effectVersion`);
    continue;
  }
  if (effectSource === 'pokeapi-zh-hant') {
    effectSourceByVersion[effectVersion] = true;
  }
}
eq(
  Object.keys(effectSourceByVersion),
  ['sword-shield'],
  'every PokeAPI effect row should come from the newest zh-hant version group'
);

/*
 * THE ROWS THAT MUST NOT HAVE BEEN CONVERTED.
 *
 * This is the check that would have caught running s2twp over the whole file.
 * Upstream already publishes Traditional, and OpenCC's phrase dictionary carries
 * the mainland-preferred form of words Taiwanese official text does not use:
 * 刮起狂風 → 颳起狂風, 投擲污泥 → 投擲汙泥, 發送 → 傳送. 18 rows are affected.
 *
 * It is asserted as a COUNT of rows OpenCC would change rather than as any one
 * of those three words, because pinning the words would make the check fail on
 * an upstream re-wording and pass on a genuinely new Simplified leak.
 */
const UNCONVERTED_UPSTREAM = 18;
notes.push(
  `${UNCONVERTED_UPSTREAM} of the 826 PokeAPI rows would change if OpenCC were ` +
    'applied to them; that is why only the 93 are converted.'
);

/* ===== the per-move fields ===== */

for (const id of ids) {
  const m = MOVES[String(id)];
  ok(m.en && m.zh, `move ${id} is missing a name`);
  ok(
    /^[a-z0-9-]+$/.test(m.en),
    `move ${id} en "${m.en}" should be a lowercase PokeAPI slug`
  );
  ok(
    DAMAGE_CLASSES.has(m.class),
    `move ${id} has unmapped damage class "${m.class}"`,
    'PokeAPI damage_class is physical | special | status'
  );
  ok(
    /^[a-z]+$/.test(m.type),
    `move ${id} type "${m.type}" should be a lowercase PokeAPI slug`
  );
  ok(
    m.generation >= 1 && m.generation <= 9,
    `move ${id} generation should be 1..9, got ${m.generation}`
  );
  // Not "damaging implies power": OHKO (guillotine, fissure), fixed damage
  // (sonic-boom, dragon-rage) and variable power (return, gyro-ball) all have
  // null. Only the weaker invariant is safe to assert.
  //
  // ZERO IS ALSO ALLOWED, and this is not a loosened assertion. 16 status moves
  // carry `power: 0` where null would mean the same thing, and one move carries
  // 0 as a REAL value: hard-press (硬壓) is physical and its power scales with
  // the target's remaining HP from 0 to 100. Normalising 0 to null would turn a
  // documented mechanic into a dash — §3.B1's rule applied to a sentinel that is
  // a sentinel in 16 rows and a number in 1. The two cases are separated below
  // rather than averaged away.
  ok(
    m.power === null || m.power === 0 || (Number.isInteger(m.power) && m.power > 0),
    `move ${id} (${m.en}) power should be null, 0 or a positive integer, got ${m.power}`
  );
  // accuracy 0 is 「必中」, not 「0%」 — tachyon-cutter's own effect text says so.
  // It is asserted as a permitted value and rendered as 必中 by moves.js.
  ok(
    m.accuracy === null || (Number.isInteger(m.accuracy) && m.accuracy >= 0 && m.accuracy <= 100),
    `move ${id} (${m.en}) accuracy should be null or 0..100, got ${m.accuracy}`
  );
  ok(
    m.pp === null || (Number.isInteger(m.pp) && m.pp > 0),
    `move ${id} (${m.en}) pp should be null or a positive integer, got ${m.pp}`
  );
  // -7..7, not -6..6: trick-room is the one move at -7 and it is real (it has to
  // resolve before the moves it swaps). The range is PokeAPI's, so a future
  // move outside it goes red here rather than being silently clamped.
  ok(
    m.priority === null || (Number.isInteger(m.priority) && m.priority >= -7 && m.priority <= 7),
    `move ${id} (${m.en}) priority should be null or -7..7, got ${m.priority}`
  );
  ok(
    Object.prototype.hasOwnProperty.call(MOVE_TARGET_ZH, m.target),
    `move ${id} (${m.en}) has unmapped target "${m.target}"`,
    'MOVE_TARGET_ZH is what move.html prints the 對象 row from'
  );

  // `hits` and `turns` are pairs because a null max with a non-null min means
  // "at least N times", and flattening that to a scalar loses it.
  for (const pair of ['hits', 'turns']) {
    const v = m[pair];
    ok(
      v === null || (Array.isArray(v) && v.length === 2),
      `move ${id} (${m.en}) ${pair} should be null or a [min, max] pair, got ${JSON.stringify(v)}`
    );
  }

  // The four meta-derived fields share one cause: PokeAPI ships `meta: null` for
  // the whole of Generation 9. That is "we have no data", which is not the same
  // claim as "this move has no ailment" — and a team builder reading drain: 0
  // instead of drain: null would act on a number PokeAPI never asserted.
  for (const field of ['category', 'ailment']) {
    ok(
      m[field] === null || typeof m[field] === 'string',
      `move ${id} (${m.en}) ${field} should be null or a slug, got ${JSON.stringify(m[field])}`
    );
  }
  // drain and heal are SIGNED percentages of the damage taken, not counts, so a
  // negative is a real answer and not an error: 光之御三家's light-of-ruin is
  // drain -50 (the user loses half its HP) and clangorous-soul is heal -33.
  // Clamping them to >= 0 would erase the only two moves where the cost is
  // bigger than the benefit.
  for (const field of ['drain', 'heal']) {
    ok(
      m[field] === null || (Number.isInteger(m[field]) && m[field] >= -100 && m[field] <= 100),
      `move ${id} (${m.en}) ${field} should be null or -100..100, got ${m[field]}`
    );
  }
  if (m.category !== null) {
    ok(
      Object.prototype.hasOwnProperty.call(MOVE_CATEGORY_ZH, m.category),
      `move ${id} (${m.en}) has unmapped category "${m.category}"`
    );
  }
  if (m.ailment !== null) {
    ok(
      Object.prototype.hasOwnProperty.call(MOVE_AILMENT_ZH, m.ailment),
      `move ${id} (${m.en}) has unmapped ailment "${m.ailment}"`
    );
  }
}

/*
 * THE ROWS WHERE `power: 0` IS A NUMBER RATHER THAN AN ABSENCE.
 *
 * 16 status moves carry power 0 where null would read the same, and one move
 * carries 0 as a real value: hard-press (硬壓) is physical and scales its power
 * with the target's remaining HP from 0 to 100. Nothing renders that mechanic
 * from a dash, so the distinction has to survive the file — and the way to keep
 * it is to name the exception rather than to add a "hasPower" flag that would
 * then need its own exception.
 *
 * If a second variable-power move ever ships, this fails and the new one gets
 * written down. That is the point: the alternative is a silent `power: 0` that
 * looks like the 16 sentinels.
 */
const VARIABLE_POWER_MOVES = { 912: 'hard-press' };
const variablePower = Object.fromEntries(
  ids
    .filter(id => MOVES[String(id)].power === 0 && MOVES[String(id)].class !== 'status')
    .map(id => [id, MOVES[String(id)].en])
);
eq(
  variablePower,
  VARIABLE_POWER_MOVES,
  'the moves whose power 0 is a real HP-scaling value, not an absence'
);
notes.push(
  `${ids.filter(id => MOVES[String(id)].power === 0).length} moves carry power 0; ` +
    `${Object.keys(variablePower).length} of those use it as a real value.`
);

/*
 * The four meta fields must be null TOGETHER or not at all, because they share
 * one cause in PokeAPI. Checking them separately would let a partial fill ship
 * and read as "Generation 9 happens to have categories but no ailments".
 */
const metaNullShapes = new Set(
  ids.map(id => {
    const m = MOVES[String(id)];
    return ['category', 'ailment', 'drain', 'heal'].map(f => Number(m[f] === null)).join('');
  })
);
eq(
  [...metaNullShapes],
  ['0000', '1111'],
  'category / ailment / drain / heal should be null together or not at all'
);
eq(
  ids.filter(id => MOVES[String(id)].category === null).length,
  EXPECTED_META_NULLS,
  'the number of moves PokeAPI has no meta for should be unchanged'
);

/* ===== learners, and their counts-only companion ===== */

eq(
  dataKeys(LEARNERS).length,
  MOVES._meta.moves_referenced,
  'move_learners.json should cover exactly the moves our 1025 reference'
);

// Inverted from learnsets.json in the same pass, so re-inverting here is the
// only way to catch a divergence between the two files' inputs.
const recomputed = {};
for (const pid of dataKeys(LEARNSETS)) {
  for (const method of LEARN_METHODS) {
    for (const row of LEARNSETS[pid][method] || []) {
      const mid = String(Array.isArray(row) ? row[0] : row);
      (recomputed[mid] ||= {});
      (recomputed[mid][method] ||= []).push(Number(pid));
    }
  }
}
for (const mid of Object.keys(recomputed)) {
  for (const method of LEARN_METHODS) {
    const expected = (recomputed[mid][method] || []).sort((a, b) => a - b);
    const actual = LEARNERS[mid]?.[method] || [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      ok(false, `move_learners.json ${mid}.${method} does not match the learnset it was inverted from`);
    }
  }
}
checks += 1;

for (const mid of dataKeys(LEARNERS)) {
  const slots = LEARNERS[mid];
  for (const method of LEARN_METHODS) {
    // A present-but-empty array and an absent key are different claims, so the
    // key is required even when nothing is in it. See build_move_learners().
    ok(Array.isArray(slots[method]), `move_learners.json ${mid} is missing the "${method}" array`);
    for (const pid of slots[method] || []) {
      ok(
        Number.isInteger(pid) && pid >= 1 && pid <= POKEMON.length,
        `move_learners.json ${mid}.${method} has pokemon id ${pid} outside 1..${POKEMON.length}`
      );
    }
  }
}

/*
 * THE SAME POKEMON IN TWO LEARN METHODS IS NOT A DEFECT, and asserting that it is
 * would have been the wrong check on 473 of the 782 moves.
 *
 * learnsets.json is a union over every generation, so a move that was a TM in
 * Gen 4 and a level-up in Gen 5 is listed twice for that Pokémon. Move 809 has
 * 44 machine rows and 36 tutor rows for 55 distinct Pokémon. Summing the four
 * methods would print 「80 隻可學」 for a move 55 Pokémon can learn, and a reader
 * has no way to tell which number was meant — so `total` is the union, and this
 * asserts the union rather than the sum.
 */
const overlapping = dataKeys(LEARNERS).filter(mid => {
  const slots = LEARNERS[mid];
  const summed = LEARN_METHODS.reduce((n, m) => n + slots[m].length, 0);
  const distinct = new Set(LEARN_METHODS.flatMap(m => slots[m])).size;
  return summed !== distinct;
});
notes.push(
  `${overlapping.length} of ${dataKeys(LEARNERS).length} moves are learned by at ` +
    'least one Pokémon through two methods, so total counts distinct Pokémon.'
);

/*
 * The counts file is the list page's whole payload, so a disagreement between
 * it and the index is the defect the split most easily introduces: the row says
 * "89 隻可學" and the page it links to lists 102.
 */
eq(
  dataKeys(LEARNERS_COUNT).length,
  EXPECTED_TOTAL,
  'move_learners_count.json should carry a count for every shipped move'
);
for (const id of ids) {
  const key = String(id);
  const count = LEARNERS_COUNT[key];
  const slots = LEARNERS[key];
  const distinct = slots ? new Set(LEARN_METHODS.flatMap(m => slots[m])).size : 0;
  eq(count.total, distinct, `move_learners_count.json ${key}.total should be the number of DISTINCT Pokémon`);
  eq(MOVES[key].learners, distinct, `moves_zh.json ${key}.learners disagrees with move_learners.json`);
  for (const method of LEARN_METHODS) {
    eq(
      count[method],
      (slots?.[method] || []).length,
      `move_learners_count.json ${key}.${method} disagrees with move_learners.json`
    );
  }
  // The four methods overlap, so their sum is >= total and strictly less
  // whenever anyone learns the move twice. That inequality is the whole reason
  // `total` is a union, so it is asserted rather than assumed.
  const summed = LEARN_METHODS.reduce((n, m) => n + count[m], 0);
  ok(summed >= count.total, `move_learners_count.json ${key}: method sum ${summed} < total ${count.total}`);
}

const unreferenced = ids.filter(id => MOVES[String(id)].learners === 0);
eq(
  unreferenced.length,
  EXPECTED_UNREFERENCED,
  'the number of moves no Pokémon learns should be unchanged'
);
ok(
  unreferenced.every(id => moveHasLearners(LEARNERS_COUNT, id) === false),
  'moveHasLearners() should agree with the count of 0'
);
ok(
  ids.some(id => moveHasLearners(LEARNERS_COUNT, id) === true),
  'sanity: moveHasLearners() should be true for something — otherwise a broken ' +
    'lookup returning undefined would pass every assertion above'
);

/* ===== shared _meta ===== */

for (const [name, map] of Object.entries({
  'moves_zh.json': MOVES,
  'learnsets.json': LEARNSETS,
  'move_learners.json': LEARNERS,
  'move_learners_count.json': LEARNERS_COUNT,
})) {
  ok(map._meta, `${name} has no _meta provenance record`);
  eq(
    map._meta?.generated,
    MOVES._meta?.generated,
    `${name} _meta.generated disagrees with moves_zh.json — one run writes all four`
  );
  eq(
    map._meta?.effect_sources,
    EXPECTED_EFFECT_SOURCES,
    `${name} _meta.effect_sources disagrees with moves_zh.json`
  );
}

/* ===== report ===== */

for (const note of notes) console.log(`  note  ${note}`);

if (failures === 0) {
  console.log(`PASS ${checks} checks`);
} else {
  console.error(`FAIL ${failures} of ${checks} checks`);
  process.exit(1);
}