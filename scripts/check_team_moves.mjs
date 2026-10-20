/**
 * `team_moves.json`, the move pool, and the URL contract that carries picks.
 *
 *   node scripts/check_team_moves.mjs
 *
 * The table is checked against the files it was built from rather than against
 * itself: every method string is rebuilt out of `learnsets.json`, every column
 * out of `moves_zh.json`, and the id sets are compared in both directions. That
 * is the only way a hand-edited key could be caught, which is what happens to a
 * generated file nobody re-runs.
 *
 * The second half drives the pure modules for real — a seeded draw over all
 * 1,025 species, the 17 moves that must never claim coverage, and the URL
 * round trip — because a data PASS says nothing about the functions that read
 * it. No browser: ~0.3 s.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TYPE_CHART_ORDER } from '../assets/js/type-chart.js';
import {
  MOVES_PER_MEMBER, MOVE_METHODS, TYPELESS_MOVES, fieldIndex, parseSet,
  methodIds, allMoveIds, methodOf, moveRecord, drawMoves, isDamaging,
  powerText, accuracyText, classText,
} from '../assets/js/team-moves.js';
import {
  parseMovesParam, serializeMovesParam,
} from '../assets/js/team-state.js';
import { analyzeTeam, bestAgainst, teamSummary } from '../assets/js/team-analysis.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, is, eq } = C;

const table = readData('team_moves.json');
const roster = readData('team_roster.json');
const moves = readData('moves_zh.json');
const learnsets = readData('learnsets.json');

const FIELDS = ['zh', 'en', 'type', 'class', 'power', 'accuracy', 'pp', 'generation', 'effect'];
const index = fieldIndex(table.defs._fields);
const defIds = Object.keys(table.defs).filter((key) => key !== '_fields').map(Number);
const moveIds = Object.keys(moves).filter((key) => key !== '_meta').map(Number);
const rosterIds = roster.pokemon.map((pokemon) => pokemon.id);
const byId = new Map(roster.pokemon.map((pokemon) => [pokemon.id, pokemon]));
const setIds = Object.keys(table.sets).map(Number);

const allowedFor = (id) => allMoveIds(parseSet(table.sets, id));
const record = (id) => moveRecord(id, table, index);

/* ===== the table matches the files it was built from ===== */

eq(table.defs._fields, FIELDS, 'the column order is declared, not assumed');
eq(setIds, rosterIds, 'one set per roster id, in roster order');
eq(defIds, moveIds, 'one def per move, and no def for `_meta`');

const wrong = [];
for (const pokemon of roster.pokemon) {
  const entry = learnsets[String(pokemon.id)];
  const raw = table.sets[String(pokemon.id)];
  const expected = {
    l: (entry.level || []).map((row) => `${row[0]}:${row[1]}`).join(','),
    m: (entry.machine || []).map((row) => String(row[0])).join(','),
    e: (entry.egg || []).map((row) => String(Array.isArray(row) ? row[0] : row)).join(','),
    t: (entry.tutor || []).map((row) => String(Array.isArray(row) ? row[0] : row)).join(','),
  };
  for (const method of 'lmet') {
    if (raw[method] !== expected[method]) wrong.push(`#${pokemon.id}.${method}`);
  }
}
is(wrong.length, 0, `every method string is rebuilt byte-for-byte from learnsets.json (${wrong.slice(0, 4).join(', ')})`);

const columns = [];
for (const id of defIds) {
  const def = table.defs[String(id)];
  const move = moves[String(id)];
  const type = move.type ? move.type[0].toUpperCase() + move.type.slice(1) : move.type;
  const expected = [
    move.zh, move.en, type, move.class, move.power,
    move.accuracy, move.pp, move.generation, move.effect,
  ];
  if (JSON.stringify(def) !== JSON.stringify(expected)) columns.push(id);
}
is(columns.length, 0, `every def row is the 9 named columns of moves_zh.json (${columns.slice(0, 4).join(', ')})`);

const levelRange = [];
const duplicates = [];
for (const id of setIds) {
  const parsed = parseSet(table.sets, id);
  for (const [moveId, level] of parsed.level) {
    if (!Number.isInteger(level) || level < 1 || level > 100) levelRange.push(`${id}:${moveId}:${level}`);
  }
  for (const method of MOVE_METHODS) {
    const list = methodIds(parsed, method);
    if (new Set(list).size !== list.length) duplicates.push(`${id}.${method}`);
  }
}
is(levelRange.length, 0, 'every level-up row carries a level in 1..100');
is(duplicates.length, 0, 'no method teaches the same move twice');

ok(/^[0-9,]*$/.test(Object.values(table.sets).map((entry) => entry.m).join(',')),
  'machine rows carry the id only — no TM code, no generation, no hash');

const bytes = read('assets/data/team_moves.json').length;
ok(bytes < 660_000, `the table stays compact (${bytes} bytes < 660,000)`);

const short = rosterIds.filter((id) => allMoveIds(parseSet(table.sets, id)).size < MOVES_PER_MEMBER);
eq(short, [132, 201, 235, 789, 790],
  'exactly five species cannot fill four slots (#132 百變怪 · #201 未知圖騰 · #235 圖圖犬 · #789 科斯莫古 · #790 科斯莫姆)');
is(rosterIds.filter((id) => methodIds(parseSet(table.sets, id), 'level').length < MOVES_PER_MEMBER).length, 22,
  'twenty-two species have fewer than four level-up moves');

/* ===== damages vs coverage ===== */

const status = defIds.filter((id) => record(id).class === 'status');
is(rosterIds.every((id) => allMoveIds(parseSet(table.sets, id)).size > 0), true,
  'every species can learn at least one move');
is([...TYPELESS_MOVES].length, 17, 'seventeen moves are excluded from coverage');
is([...TYPELESS_MOVES].filter((id) => !defIds.includes(id)).length, 0,
  'every excluded id is a real move');
is([...TYPELESS_MOVES].filter((id) => record(id).class === 'status').length, 0,
  'no excluded move is already a status move');

const zeroPower = defIds.filter((id) => record(id).power === 0);
is(zeroPower.length, 17, 'seventeen moves store power 0');
eq(zeroPower.filter((id) => record(id).class !== 'status'), [912],
  'the one damaging move with power 0 is #912 硬壓 — it keeps its type, so it stays in coverage');
is(powerText(record(912)), '依情況', '#912 reads as 依情況 rather than a misleading 0');
is(powerText(record(33)), '40', 'a normal damaging move prints its power');
is(powerText(record(106)), '—', 'a status move prints no power');
is(classText(record(53)), '特殊', 'the damage class is printed in Chinese');
ok(defIds.some((id) => record(id).accuracy === 0), 'at least one move stores accuracy 0 (必中)');
is(accuracyText({ accuracy: 0 }), '必中', 'accuracy 0 prints as 必中');
is(accuracyText({ accuracy: null }), '—', 'a missing accuracy prints as —');

is(defIds.filter((id) => isDamaging(record(id))).length,
  defIds.length - status.length - [...TYPELESS_MOVES].length,
  'every non-status move is damaging unless it is on the excluded list');

const zeroed = record(12);
ok(zeroed && !isDamaging(zeroed), '#12 斷頭鉗 is a one-hit KO and offers no coverage');

/* ===== methods and draws ===== */

is(MOVES_PER_MEMBER, 4, 'four moves per member');
const definitions = ['assets/js/team-moves.js', 'assets/js/team-state.js', 'assets/js/team.js']
  .filter((file) => /MOVES_PER_MEMBER\s*=/.test(read(file)));
eq(definitions, ['assets/js/team-moves.js'], 'MOVES_PER_MEMBER is defined exactly once');

const bulbasaur = parseSet(table.sets, 1);
is(methodIds(bulbasaur, 'level')[0], 33, '#0001 learns Tackle first, at level 1');
is(methodOf(bulbasaur, 33), 'level', 'a level move is labelled by level');
const machineOnly = methodIds(bulbasaur, 'machine').find((id) => !methodIds(bulbasaur, 'level').includes(id));
is(methodOf(bulbasaur, machineOnly), 'machine', 'a move taught two ways keeps its preferred source');
is(parseSet(table.sets, 9999).level.length, 0, 'an unknown id parses to empty lists');

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const badDraws = [];
const levelShares = [];
for (const id of rosterIds) {
  const set = parseSet(table.sets, id);
  const level = methodIds(set, 'level');
  const allowed = allMoveIds(set);
  const draw = drawMoves(set, seeded(id * 7 + 1));
  const again = drawMoves(set, seeded(id * 7 + 1));
  if (draw.length < 1 || draw.length > MOVES_PER_MEMBER) badDraws.push(`${id}:length`);
  if (new Set(draw).size !== draw.length) badDraws.push(`${id}:duplicate`);
  if (!draw.every((moveId) => allowed.has(moveId))) badDraws.push(`${id}:foreign`);
  if (JSON.stringify(draw) !== JSON.stringify(again)) badDraws.push(`${id}:unstable`);
  if (level.length >= MOVES_PER_MEMBER && !draw.every((moveId) => level.includes(moveId))) {
    badDraws.push(`${id}:level`);
  }
  if (level.length >= MOVES_PER_MEMBER) {
    levelShares.push(draw.filter((moveId) => level.includes(moveId)).length);
  }
}
is(badDraws.length, 0, `all 1,025 draws are short-enough, distinct, learnable and deterministic (${badDraws.slice(0, 4).join(', ')})`);
is(levelShares.every((count) => count === MOVES_PER_MEMBER), true,
  'a species with four level moves draws nothing else');
const variants = new Set(Array.from({ length: 24 }, (_, n) => JSON.stringify(drawMoves(bulbasaur, seeded(n + 1)))));
ok(variants.size > 1, 'the draw is random across seeds, not the first four ids');

/* ===== the URL contract ===== */

function roundTrip(team, picks, value) {
  return parseMovesParam(value !== undefined ? value : serializeMovesParam(team, picks), team, allowedFor);
}

const picks = new Map([[1, [33, 45, 22, 74]], [6, [53, 0, 0, 0]]]);
const written = serializeMovesParam([1, 6], picks);
eq(written, '33,45,22,74,53,0,0,0', '?moves= is four ids per member, in team order');
const readBack = roundTrip([1, 6], picks);
eq(readBack.slots, [[33, 45, 22, 74], [53, 0, 0, 0]], 'an empty row survives the round trip as a 0');
is(readBack.ignored, 0, 'a valid parameter ignores nothing');

is(serializeMovesParam([1], new Map()), '0,0,0,0', 'a member with no picks serializes to four zeros');
eq(roundTrip([1], picks, '0,0,0,0').slots, [null], 'four zeros is a redraw, not an empty member');
eq(roundTrip([1], picks, '33,33,0,0').slots, [null], 'a repeated id discards the whole member');
is(roundTrip([1], picks, '33,33,0,0').ignored, 1, 'a discarded member is counted once');
eq(roundTrip([1], picks, '33,45,22,999999').slots, [null], 'an unknown id discards the whole member');
eq(roundTrip([1], picks, '33,45,22').slots, [null], 'a truncated chunk is ignored');
eq(roundTrip([1], picks, '33,45,22,74,53,0,0,0').slots, [[33, 45, 22, 74]],
  'ids past the end of the team are not a member');
const unlearnable = defIds.find((id) => !allowedFor(1).has(id) && record(id).class === 'status');
eq(roundTrip([1], picks, `33,45,22,${unlearnable}`).slots, [null],
  'a move the species cannot learn discards the whole member');

/* ===== coverage arithmetic on the real table ===== */

const charizard = movesFor([6], [53]);
function movesFor(team, moveIdsForMember) {
  const pokemon = byId.get(team[0]);
  return moveIdsForMember.map((id) => ({
    ...record(id),
    id,
    stab: pokemon.types.includes(record(id).type),
    damaging: isDamaging(record(id)),
  }));
}
is(bestAgainst(charizard, 'Grass').total, 3, 'Charizard STAB Fire reaches 3x on Grass');
is(bestAgainst(charizard, 'Water').total, 0.75, 'a STAB Fire move on Water is 0.5x times 1.5');
eq(bestAgainst(charizard, 'Water').zh, '噴射火焰', 'the best move is named in the mark');

const real = analyzeTeam([1, 6], byId, new Map([
  [1, movesFor([1], [33, 45, 22, 74])],
  [6, charizard],
]));
is(real.coverage.every((row) => row.marks.length === 2), true,
  'every coverage row has one mark per member');
is(real.coverage.find((row) => row.type === 'Normal').marks[2], undefined,
  'coverage rows carry no marks beyond the team');
eq(real.coverage.map((row) => row.type), TYPE_CHART_ORDER, 'coverage rows follow the chart order');
ok(teamSummary(real).uncovered.length < 18, 'a team with moves covers something');

const moveIdsByType = new Map();
for (const row of real.coverage) {
  for (const marked of row.ids) moveIdsByType.set(row.type, (moveIdsByType.get(row.type) || 0) + 1);
}
is([...moveIdsByType.values()].every((count) => count >= 1), true,
  'every covered row names at least one member');

process.exit(C.report());
