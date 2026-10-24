/**
 * `assets/data/draft_roster.json` referential-integrity check.
 *
 *   node scripts/check_draft_data.mjs
 *
 * The draft page never loads `pokemon_data.json`, so every fact it shows comes
 * from this one table. The checker therefore re-derives the pool from
 * `evolution_levels.json`'s EDGE LIST rather than trusting the file's own
 * ordering, and re-walks each species' learnset rather than trusting that its
 * four moves are learnable. It also asserts the two counts the page's prose
 * states — 568 final/single-stage, 89 legendary/mythical — and that the five
 * legendary lines with an evolution are absent.
 *
 * No browser, ~0.1 s.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TYPE_CHART_ORDER } from '../assets/js/type-chart.js';
import { createChecker } from './lib/assert.mjs';
import { readRgba } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const DATA = readData('draft_roster.json');
const POKEMON = readData('pokemon_data.json');
const EVOLUTION = readData('evolution_levels.json');
const LEARNSETS = readData('learnsets.json');

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, is, eq } = C;

const TYPES = new Set(TYPE_CHART_ORDER);
const CLASSES = new Set(['physical', 'special', 'status']);
const ROSTER_MAX = 1025;
const ROUNDS = 6;
const CANDIDATES = 6;

const byId = new Map(POKEMON.map(p => [p.id, p]));
const records = new Map(DATA.pokemon.map(row => [row[0], row]));
const rosterIds = new Set(POKEMON.filter(p => p.id <= ROSTER_MAX).map(p => p.id));

/* ===== shape ===== */

eq(DATA.fields, ['id', 'zh', 'en', 'types', 'level', 'other'],
  'the compact column order is data, not a convention the page remembers');
eq(DATA.moveFields, ['zh', 'type', 'class'],
  'a move row carries exactly the three fields the round prints');
ok(Array.isArray(DATA.pokemon) && DATA.pokemon.length === 568,
  'the pool is 568 species', `found ${DATA.pokemon?.length}`);
ok(Object.keys(DATA.moves).length === 330,
  'the move table holds the 330 moves the pool references',
  `found ${Object.keys(DATA.moves).length}`);
ok(records.size === DATA.pokemon.length, 'no species id appears twice');
ok(SPRITES_EXIST(), 'every pool species has a front sprite');
const badBackSprites = BAD_BACK_SPRITES();
ok(badBackSprites.length === 0, 'every pool species has a non-empty 96x96 back sprite',
  badBackSprites.slice(0, 12).map(id => `#${id}`).join(', '));

function SPRITES_EXIST() {
  return DATA.pokemon.every(row => existsSync(join(ROOT, 'assets/images/sprite', `${row[0]}.png`)));
}

function BAD_BACK_SPRITES() {
  const bad = [];
  for (const [id] of DATA.pokemon) {
    const path = join(ROOT, 'assets/images/sprite/back', `${id}.png`);
    if (!existsSync(path)) { bad.push(id); continue; }
    try {
      const png = readRgba(readFileSync(path), `back/${id}.png`);
      const visible = png.data.some((value, index) => index % 4 === 3 && value > 0);
      if (png.width !== 96 || png.height !== 96 || !visible) bad.push(id);
    } catch {
      bad.push(id);
    }
  }
  return bad;
}

/* ===== the pool is the edge list, in both directions ===== */

const edges = new Set();
for (const [from, children] of Object.entries(EVOLUTION.levels || {})) {
  if (!rosterIds.has(Number(from))) continue;
  for (const to of Object.keys(children)) {
    if (rosterIds.has(Number(to))) edges.add(`${from}->${to}`);
  }
}
for (const [from, steps] of Object.entries(EVOLUTION.unlevelled || {})) {
  if (!rosterIds.has(Number(from))) continue;
  for (const step of steps) {
    if (rosterIds.has(Number(step.to))) edges.add(`${from}->${step.to}`);
  }
}
const derived = [...rosterIds].filter(id => ![...edges].some(edge => edge.startsWith(`${id}->`)));
const derivedSet = new Set(derived);
const dataIds = new Set(DATA.pokemon.map(row => row[0]));

ok(derived.length === 568, 'the edge list derives 568 final/single-stage species', `${derived.length}`);
for (const id of derived) ok(dataIds.has(id), `#${id} belongs in the pool`);
for (const id of dataIds) ok(derivedSet.has(id), `#${id} has no outgoing evolution edge`);
ok(![...edges].some(edge => dataIds.has(Number(edge.split('->')[0]))),
  'no pool species is the source of an evolution edge');

/* ===== the 89 count and the five excluded lines ===== */

const legendary = DATA.pokemon.filter(([id]) => {
  const p = byId.get(id);
  return p?.is_legendary || p?.is_mythical;
});
is(legendary.length, 89, 'the pool contains 89 legendary/mythical species');
for (const id of [772, 789, 790, 808, 891]) {
  ok(!dataIds.has(id), `#${id} is excluded because it still evolves`);
}

/* ===== names and types ===== */

for (const [id, zh, en, types] of DATA.pokemon) {
  const p = byId.get(id);
  ok(Boolean(p), `#${id} exists in pokemon_data.json`);
  if (!p) continue;
  is(zh, p.names.zh, `#${id} carries the roster's Chinese name`);
  is(en, p.names.en, `#${id} carries the roster's English name`);
  eq(types, p.types, `#${id} carries the roster's types`);
  ok(Array.isArray(types) && types.length >= 1 && types.length <= 2,
    `#${id} has one or two types`);
  for (const type of types) ok(TYPES.has(type), `#${id}'s type ${type} is a type-chart key`);
}

/* ===== moves: learnable, ordered, and always defined ===== */

const levelOf = id => (LEARNSETS[String(id)]?.level || []).map(row => Number(row[0]));
const otherOf = id => {
  const entry = LEARNSETS[String(id)] || {};
  const seen = new Set();
  const out = [];
  for (const method of ['machine', 'tutor', 'egg']) {
    for (const row of entry[method] || []) {
      const moveId = Number(Array.isArray(row) ? row[0] : row);
      if (moveId !== undefined && !seen.has(moveId)) {
        seen.add(moveId);
        out.push(moveId);
      }
    }
  }
  return out;
};

const short = [];
for (const [id, , zh, , level, other] of DATA.pokemon) {
  const shortRow = Array.isArray(other);
  ok(level.length <= 4, `#${id} never carries more than four level moves`);
  ok(new Set(level).size === level.length, `#${id} has no duplicate level move`);
  eq(level, level.slice(0, 4), `#${id}'s level list is its first four, in learnset order`);
  const total = level.length + (shortRow ? other.length : 0);
  if (total < 4) short.push([id, zh, total]);
  if (shortRow) {
    ok(level.length < 4, `#${id} only writes an other pool when the level list is short`);
    ok(new Set(other).size === other.length, `#${id} has no duplicate fallback move`);
    ok(other.every(moveId => !level.includes(moveId)), `#${id}'s fallback does not repeat a level move`);
  } else {
    ok(level.length === 4, `#${id} needs no fallback because four level moves exist`);
  }

  const learnable = new Set([...levelOf(id), ...otherOf(id)]);
  for (const moveId of level) {
    ok(levelOf(id).includes(moveId), `#${id}'s move ${moveId} is a level-up move`);
  }
  for (const moveId of shortRow ? other : []) {
    ok(otherOf(id).includes(moveId), `#${id}'s fallback ${moveId} is machine/tutor/egg`);
  }
  for (const moveId of [...level, ...(shortRow ? other : [])]) {
    ok(learnable.has(moveId), `#${id} can learn move ${moveId}`);
  }
}

eq(short.map(([id]) => id).sort((a, b) => a - b), [132, 201, 235],
  'exactly three species cannot reach four moves');
for (const [id, , count] of short) is(count, 1, `#${id} can only ever offer one move`);
const firstFour = id => levelOf(id).slice(0, 4);
for (const [id, , , , level] of DATA.pokemon) {
  eq(level, firstFour(id), `#${id}'s four moves are the first four level-up moves`);
}

/* ===== defs ===== */

const referenced = new Set();
for (const row of DATA.pokemon) {
  for (const moveId of row[4]) referenced.add(moveId);
  for (const moveId of row[5] || []) referenced.add(moveId);
}
for (const moveId of referenced) {
  ok(Object.prototype.hasOwnProperty.call(DATA.moves, String(moveId)), `move ${moveId} has a def`);
}
for (const [key, [zh, type, cls]] of Object.entries(DATA.moves)) {
  ok(!key.startsWith('_'), 'no provenance key is smuggled into the move table');
  ok(typeof zh === 'string' && zh.length > 0, `move ${key} has a Chinese name`);
  ok(TYPES.has(type), `move ${key}'s type ${type} is a type-chart key`);
  ok(CLASSES.has(cls), `move ${key}'s class ${cls} is physical/special/status`);
}
for (const key of Object.keys(DATA.moves)) {
  ok(referenced.has(Number(key)), `move ${key} is not an orphan def`);
}

/* ===== the page's two constants, stated here so prose drift is caught ===== */

is(ROUNDS, 6, 'a run is six rounds');
is(CANDIDATES, 6, 'a round offers six silhouettes');
ok(DATA.pokemon.length >= ROUNDS * CANDIDATES * 2,
  'the pool can fill both teams without overlap');

C.report();
