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
import { isDamaging } from '../assets/js/team-moves.js';
import { createChecker } from './lib/assert.mjs';
import { readRgba } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const DATA = readData('draft_roster.json');
const POKEMON = readData('pokemon_data.json');
const EVOLUTION = readData('evolution_levels.json');
const LEARNSETS = readData('learnsets.json');
const MOVES = readData('moves_zh.json');

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, is, eq } = C;

const TYPES = new Set(TYPE_CHART_ORDER);
const CLASSES = new Set(['physical', 'special', 'status']);
const ROSTER_MAX = 1025;
const ROUNDS = 6;
const CANDIDATES = 6;

/* The one definition of "this move can score", shared with the page. */
const isDamagingMove = moveId => isDamaging({ id: moveId, class: MOVES[String(moveId)]?.class });

/* Four species have no damaging level-up move at all — Ditto, Wobbuffet,
 * Smeargle and Pyukumuku — so an all-blank row is their species, not a bug.
 * The substitution below is what keeps this list from growing. */
const DAMAGE_LESS = new Set([132, 202, 235, 771]);

const byId = new Map(POKEMON.map(p => [p.id, p]));
const records = new Map(DATA.pokemon.map(row => [row[0], row]));
const rosterIds = new Set(POKEMON.filter(p => p.id <= ROSTER_MAX).map(p => p.id));

/* ===== shape ===== */

eq(DATA.fields, ['id', 'zh', 'en', 'types', 'pool', 'anchors', 'other'],
  'the compact column order is data, not a convention the page remembers');
eq(DATA.moveFields, ['zh', 'type', 'class'],
  'a move row carries exactly the three fields the round prints');
ok(Array.isArray(DATA.pokemon) && DATA.pokemon.length === 568,
  'the pool is 568 species', `found ${DATA.pokemon?.length}`);
ok(Object.keys(DATA.moves).length === 638,
  'the move table holds the 638 moves the pool references',
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
const noStab = [];
const twoAnchors = [];
const deepAnchors = [];
const pinned = [];
for (const [id, , zh, types, pool, rawAnchors, other] of DATA.pokemon) {
  const shortRow = Array.isArray(other);
  const all = levelOf(id);
  const anchors = rawAnchors || [];
  ok(pool.length <= 8, `#${id} never carries more than eight level moves`);
  ok(new Set(pool).size === pool.length, `#${id} has no duplicate pool move`);
  eq(pool.length, Math.min(8, all.length),
    `#${id} carries every level move it has, up to eight`);
  eq(pool, all.slice(-8), `#${id}'s pool is the learnset tail`);

  const typeOf = moveId => String(DATA.moves[String(moveId)]?.[1] || '');
  ok(anchors.length <= types.length, `#${id} anchors at most one move per type`);
  is(new Set(anchors).size, anchors.length, `#${id} has no duplicate anchor`);
  const anchoredTypes = new Set();
  for (const moveId of anchors) {
    ok(all.includes(moveId), `#${id}'s anchor ${moveId} is a level-up move`);
    ok(isDamagingMove(moveId), `#${id}'s anchor ${moveId} can score`);
    const type = typeOf(moveId);
    ok(types.includes(type), `#${id}'s anchor ${moveId} is one of its own types`);
    ok(!anchoredTypes.has(type), `#${id} anchors ${type} only once`);
    anchoredTypes.add(type);
    const higher = all.slice(all.indexOf(moveId) + 1).find(
      candidate => isDamagingMove(candidate) && typeOf(candidate) === type,
    );
    ok(higher === undefined, `#${id}'s ${type} anchor is the highest of its type`);
  }
  const neededTypes = types.filter(
    type => all.some(moveId => isDamagingMove(moveId) && typeOf(moveId) === type),
  );
  eq(anchors.map(typeOf).sort(), [...neededTypes].sort(),
    `#${id} anchors every type its level list can score with, and no other`);
  if (anchors.length === 0) noStab.push(id);
  if (anchors.length === 2) twoAnchors.push(id);
  if (anchors.some(moveId => !pool.includes(moveId))) deepAnchors.push(id);
  if (anchors.length === 2 && anchors.every(moveId => !pool.includes(moveId))) {
    pinned.push(id);
  }

  const total = new Set([...pool, ...(shortRow ? other : [])]).size;
  if (total < 4) short.push([id, zh, total]);
  if (shortRow) {
    ok(pool.length < 4, `#${id} only writes an other pool when the level list is short`);
    ok(other.length <= 4 - pool.length,
      `#${id}'s fallback is only what four moves need`);
    ok(new Set(other).size === other.length, `#${id} has no duplicate fallback move`);
    ok(other.every(moveId => !pool.includes(moveId)),
      `#${id}'s fallback does not repeat a level move`);
    ok(other.every(moveId => otherOf(id).includes(moveId)),
      `#${id}'s fallback is machine/tutor/egg`);
  } else {
    ok(pool.length >= 4, `#${id} needs no fallback because four level moves exist`);
  }

  const learnable = new Set([...all, ...otherOf(id)]);
  for (const moveId of pool) {
    ok(all.includes(moveId), `#${id}'s pool move ${moveId} is a level-up move`);
  }
  for (const moveId of [...pool, ...(shortRow ? other : []), ...anchors]) {
    ok(learnable.has(moveId), `#${id} can learn move ${moveId}`);
  }
}

eq(short.map(([id]) => id).sort((a, b) => a - b), [132, 201, 235],
  'exactly three species cannot reach four moves');
for (const [id, , count] of short) is(count, 1, `#${id} can only ever offer one move`);
eq(noStab.sort((a, b) => a - b), [132, 201, 202, 235, 771],
  'five species have no own-type damaging move');
is(twoAnchors.length, 327, '327 dual-type species guard both of their types');
is(deepAnchors.length, 61, '61 species need an anchor deeper than the pool');
eq(pinned.sort((a, b) => a - b), [303, 334, 426, 791],
  'four species pin both anchors outside the pool');

/* The exemption is a fact about the species, not a place to park a bad tail. */
for (const id of DAMAGE_LESS) {
  ok(!levelOf(id).some(isDamagingMove), `#${id} has no damaging level-up move at all`);
  is(records.get(id)[5].length, 0, `#${id} anchors no type`);
}
is(records.get(201)[5].length, 0,
  '#201 anchors no type because Hidden Power is Normal, though it still scores');

/* ===== defs ===== */

const referenced = new Set();
for (const row of DATA.pokemon) {
  for (const moveId of row[4]) referenced.add(moveId);
  for (const moveId of row[5] || []) referenced.add(moveId);
  for (const moveId of row[6] || []) referenced.add(moveId);
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
