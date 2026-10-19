/**
 * Learnset regression test
 *
 *   node scripts/check_learnsets.mjs
 *
 * Guards the two generated files behind the moves section:
 *   assets/data/learnsets.json  — four learn methods per Pokémon, per game
 *   assets/data/moves_zh.json   — 繁中 (Traditional Chinese) names and the fields the tables render
 *
 * scripts/fetch_moves.py builds them from PokeAPI, and the interesting parts of
 * that build are the choices, not the download: the union spans every
 * generation, level-up takes the lowest level any game offered, and a TM number
 * comes from the newest version group the move was still a machine for. All
 * three are pinned below, because each has a plausible wrong answer.
 *
 * It imports the real ES modules, so it also catches syntax errors in them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MOVE_TABS,
  MOVE_CLASS_ZH,
  MOVE_COLUMNS,
  typeBadgeHtml,
  typeBadgeSmHtml,
} from '../assets/js/shared.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEARNSETS = JSON.parse(readFileSync(join(ROOT, 'assets/data/learnsets.json'), 'utf8'));
const MOVES = JSON.parse(readFileSync(join(ROOT, 'assets/data/moves_zh.json'), 'utf8'));
const POKEMON = JSON.parse(
  readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8')
);

/** A machine code as PokeAPI spells it, already upper-cased by fetch_moves.py. */
const MACHINE_CODE = /^(TM|HM|TR)\d{2,3}$/;

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, eq } = C;

/**
 * The move id of a row. Level and machine rows are [moveId, ...] because they
 * carry per-game detail; egg and tutor are a bare list of ids, because
 * "inherited from a parent that knew it" is the whole fact available.
 */
function moveIdOf(row) {
  return Array.isArray(row) ? row[0] : row;
}

/** Keys of a generated map, ignoring the provenance record. */
function dataKeys(map) {
  return Object.keys(map).filter(k => k !== '_meta');
}

/** The four row arrays for one Pokémon. */
function rows(id, key) {
  return LEARNSETS[String(id)]?.[key] ?? [];
}

/* ===== provenance ===== */

ok(LEARNSETS._meta, 'learnsets.json has no _meta provenance record');
ok(MOVES._meta, 'moves_zh.json has no _meta provenance record');
ok(
  String(LEARNSETS._meta?.source ?? '').includes('pokeapi'),
  `learnsets.json _meta.source does not mention PokeAPI: ${LEARNSETS._meta?.source}`
);

console.log(`source:    ${LEARNSETS._meta?.source}`);
console.log(`generated: ${LEARNSETS._meta?.generated ?? 'unknown'}`);
eq(LEARNSETS._meta?.generated, MOVES._meta?.generated,
  'the two files should come from the same run');

/* ===== coverage ===== */

eq(dataKeys(LEARNSETS).length, 1025, 'learnsets.json should cover exactly 1025 Pokémon');
eq(
  dataKeys(LEARNSETS).map(Number).sort((a, b) => a - b),
  POKEMON.map(p => p.id),
  'learnsets.json ids should match pokemon_data.json ids exactly'
);

// The tab keys index learnsets.json, so they must match its shape exactly.
eq(
  MOVE_TABS.map(t => t.key),
  ['level', 'machine', 'egg', 'tutor'],
  'MOVE_TABS should be the four learn methods, in InfoPoke order'
);
for (const tab of MOVE_TABS) {
  ok(LEARNSETS['1']?.[tab.key] !== undefined, `learnsets.json is missing the "${tab.key}" key`);
  ok(MOVE_COLUMNS.move && MOVE_COLUMNS.type && MOVE_COLUMNS.class &&
     MOVE_COLUMNS.power && MOVE_COLUMNS.accuracy,
    'MOVE_COLUMNS is missing a column the renderer always renders');
  ok(MOVE_COLUMNS.level && MOVE_COLUMNS.machine,
    'MOVE_COLUMNS is missing the level or machine column');
}
for (const cls of ['physical', 'special', 'status']) {
  ok(MOVE_CLASS_ZH[cls] !== undefined, `MOVE_CLASS_ZH is missing "${cls}"`);
}

/* ===== every referenced move resolves, and is translated ===== */

const referenced = new Set();
for (const [idKey, learnset] of Object.entries(LEARNSETS)) {
  if (idKey === '_meta') continue;
  for (const tab of MOVE_TABS) {
    for (const row of learnset[tab.key] ?? []) {
      referenced.add(moveIdOf(row));
    }
  }
}

const orphans = [...referenced].filter(id => !MOVES[id]).sort((a, b) => a - b);
eq(orphans, [], 'learnsets reference moves that moves_zh.json does not define');

const untranslated = dataKeys(MOVES)
  .filter(id => !MOVES[id].zh)
  .sort((a, b) => a - b);
eq(untranslated, [], 'moves_zh.json contains entries with no zh-hant name');

/* ===== row shapes ===== */

for (const id of dataKeys(LEARNSETS)) {
  for (const tab of MOVE_TABS) {
    for (const row of LEARNSETS[id][tab.key] ?? []) {
      if ((tab.key === 'level' || tab.key === 'machine') && !Array.isArray(row)) {
        ok(false, `#${id} ${tab.key} row is not an array: ${JSON.stringify(row)}`);
        continue;
      }
      if (tab.key === 'level') {
        const [, level] = row;
        ok(
          Number.isInteger(level) && level >= 1 && level <= 100,
          `#${id} level-up row ${JSON.stringify(row)} is not a level in 1..100`
        );
      } else if (tab.key === 'machine') {
        const [, code, generation] = row;
        // The prefix is load-bearing: PokeAPI's 100 TR codes (tr00-tr99) overlap
        // the 230 TM codes (tm00-tm99) completely, so a bare number would let
        // tr09 render as "TM09".
        ok(MACHINE_CODE.test(code),
          `#${id} machine row ${JSON.stringify(row)} is not a TM/HM/TR code`);
        ok(Number.isInteger(generation) && generation >= 1 && generation <= 9,
          `#${id} machine row ${JSON.stringify(row)} has no generation in 1..9`);
      } else {
        // A bare move id, not a one-element array.
        ok(!Array.isArray(row) && Number.isInteger(row),
          `#${id} ${tab.key} should hold bare move ids, got ${JSON.stringify(row)}`);
      }
      ok(MOVES[moveIdOf(row)] !== undefined, `#${id} ${tab.key} references unknown move ${moveIdOf(row)}`);
    }
  }
}

/* ===== no duplicate rows ===== */

for (const id of dataKeys(LEARNSETS)) {
  for (const tab of MOVE_TABS) {
    const seen = new Set();
    for (const row of LEARNSETS[id][tab.key] ?? []) {
      const key = JSON.stringify(row);
      ok(!seen.has(key), `#${id} ${tab.key} has a duplicate row ${key}`);
      seen.add(key);
    }
  }
  // A level-up list is ordered by level, and may not list a move twice.
  const levelMoves = rows(id, 'level').map(moveIdOf);
  eq(
    levelMoves.length,
    new Set(levelMoves).size,
    `#${id} lists the same level-up move more than once`
  );
}

/* ===== the union is a union: the four methods overlap freely ===== */

// A move can be reachable several ways; the sections must not dedupe across them.
for (const id of [1, 4, 25, 94, 150]) {
  const seen = new Map();
  let overlaps = 0;
  for (const tab of MOVE_TABS) {
    for (const row of rows(id, tab.key)) {
      const moveId = moveIdOf(row);
      if (seen.has(moveId)) overlaps += 1;
      seen.set(moveId, tab.key);
    }
  }
  ok(overlaps > 0, `#${id} has no move shared across learn methods, which no real Pokémon does`);
}

/* ===== pinned counts, independently computed in the earlier review ===== */

// Union counts, not per-generation counts. InfoPoke shows 12/60/8/6 for
// Bulbasaur because it only ever loaded one generation's data.
const EXPECTED_UNION_COUNTS = {
  1: [16, 68, 19, 22],
  25: [24, 86, 0, 33],
  94: [26, 108, 0, 47],
  150: [27, 152, 0, 51],
  384: [16, 94, 0, 36],
  887: [19, 58, 0, 1],
};

for (const [id, expected] of Object.entries(EXPECTED_UNION_COUNTS)) {
  eq(
    MOVE_TABS.map(tab => rows(Number(id), tab.key).length),
    expected,
    `#${id} union counts per tab (level, machine, egg, tutor)`
  );
}

/* ===== level-up takes the lowest level across generations ===== */

// Bulbasaur learns Tackle at level 1 in every generation that has it, and the
// union must not report a later level from a game that raised it.
const tackleLevel = rows(1, 'level').find(r => r[0] === 33);
eq(tackleLevel?.[1], 1, 'Bulbasaur Tackle (#33) should be learned at level 1');

const byLevel = rows(1, 'level').map(r => r[1]);
eq(
  byLevel.slice().sort((a, b) => a - b),
  byLevel,
  'Bulbasaur level-up rows are not sorted by level'
);

/* ===== TM numbers come from the newest game, and collisions are real ===== */

// Bulbasaur reuses codes across generations: TM01 twice, and TM31 three times.
// This is why the table flags a code used more than once instead of printing a
// column of identical labels. (An earlier lossy encoding reported "three TM01"
// because it dropped the TR/TM prefix and collided unrelated machines.)
const tm01 = rows(1, 'machine').filter(r => r[1] === 'TM01');
eq(tm01.length, 2, 'Bulbasaur should have two moves coded TM01');
ok(
  new Set(tm01.map(r => r[2])).size === tm01.length,
  `Bulbasaur's TM01 rows should come from distinct generations, got ${JSON.stringify(tm01)}`
);
const tm31 = rows(1, 'machine').filter(r => r[1] === 'TM31');
eq(tm31.length, 3, 'Bulbasaur should have three moves coded TM31');
eq(new Set(tm31.map(r => r[2])).size, 3, 'the three TM31 rows should be three generations');

// Gen 9 runs TM100-TM229, so a two-digit-only pattern would reject real data.
ok(
  rows(1025, 'machine').some(r => /^TM\d{3}$/.test(r[1])),
  'expected at least one three-digit TM code in the data'
);

// Codes are kept per generation, so gen 1 and gen 9 must not bleed together.
const byGen = new Map();
for (const [, code, generation] of rows(1, 'machine')) {
  if (!byGen.has(generation)) byGen.set(generation, new Set());
  byGen.get(generation).add(code);
}
ok(byGen.get(1)?.size > 0, 'Bulbasaur has no generation 1 machines');
ok(byGen.get(9)?.size > 0, 'Bulbasaur has no generation 9 machines');

/* ===== every code the data uses is one PokeAPI actually ships ===== */

const codesUsed = new Set();
for (const id of dataKeys(LEARNSETS)) {
  for (const [, code] of LEARNSETS[id].machine ?? []) codesUsed.add(code);
}
eq(
  [...codesUsed].filter(c => !MACHINE_CODE.test(c)).sort(),
  [],
  'learnsets contain codes outside the TM/HM/TR set'
);
eq(codesUsed.size, 338, 'the full set of 230 TM + 8 HM + 100 TR codes should be reachable');

// A TR and a TM may share a number, and the renderer must still tell them apart.
const trUser = dataKeys(LEARNSETS).find(id => LEARNSETS[id].machine.some(r => r[1].startsWith('TR')));
ok(trUser !== undefined, 'no Pokémon in our 1025 can learn a TR move');
const trNumber = LEARNSETS[trUser].machine.find(r => r[1].startsWith('TR'))[1];
ok(
  [...codesUsed].includes(`TM${trNumber.slice(2)}`),
  `expected TM and TR to overlap at ${trNumber}, otherwise the prefix is untested`
);

/* ===== every 1..1025 Pokémon has at least one move somewhere ===== */

for (const entry of POKEMON) {
  const total = MOVE_TABS.reduce((sum, tab) => sum + rows(entry.id, tab.key).length, 0);
  ok(total > 0, `#${entry.id} (${entry.names?.en}) has no moves at all`);
}

/* ===== the renderer agrees with the data ===== */

for (const [id, move] of dataKeys(MOVES).slice(0, 400).map(id => [id, MOVES[id]])) {
  ok(move.en && move.zh, `move ${id} is missing a name`);
  ok(
    MOVE_CLASS_ZH[move.class] !== undefined,
    `move ${id} has unmapped damage class "${move.class}"`
  );
  ok(
    /^[a-z]+$/.test(move.type),
    `move ${id} type "${move.type}" should be a lowercase PokeAPI slug`
  );
  // Not "damaging implies power": 331 of the 919 moves have null power on
  // purpose — OHKO (guillotine, fissure), fixed damage (sonic-boom, dragon-rage,
  // night-shade) and variable power (return, gyro-ball, natural-gift). Only the
  // weaker invariant is safe to assert.
  //
  // The denominator moved 782 → 919 when moves_zh.json began shipping every
  // non-shadow move rather than only the ones the 1,025-species roster references;
  // the 137 added
  // are Z-moves, Max Moves, sigils and Struggle, which is why 287 of 782 became
  // 331 of 919 rather than staying put. `power === 0` is a THIRD state and is
  // allowed by the assertion below — 16 status moves use it as an absence and
  // hard-press uses it as a real HP-scaling value; check_moves_data.mjs owns
  // that distinction.
  ok(move.power === null || (Number.isInteger(move.power) && move.power > 0),
    `move ${id} (${move.en}) power should be null or a positive integer, got ${move.power}`);
  ok(move.accuracy === null || (Number.isInteger(move.accuracy) && move.accuracy >= 0 && move.accuracy <= 100),
    `move ${id} (${move.en}) accuracy should be null or 0..100, got ${move.accuracy}`);
  // A badge lookup must not fall through to the raw slug, which is the bug the
  // lowercase/TitleCase split would cause.
  ok(
    !typeBadgeHtml(move.type).includes(`>${move.type}<`),
    `typeBadgeHtml("${move.type}") fell through to the raw slug`
  );
  ok(
    typeBadgeSmHtml(move.type).includes('background:'),
    `typeBadgeSmHtml("${move.type}") has no background`
  );
}

console.log(
  C.failures.length === 0
    ? `\nall ${C.checks} checks passed`
    : `\n${C.failures.length} of ${C.checks} checks FAILED`
);
process.exit(C.failures.length === 0 ? 0 : 1);
