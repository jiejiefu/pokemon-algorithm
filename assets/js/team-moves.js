/**
 * Moves for one team member: the four-slot draw, the method pools, and the
 * rules that decide whether a move takes part in the damage coverage.
 *
 * Pure: no DOM, no fetch. The page owns the table and the dialog; everything
 * that can be wrong about a draw or a URL is decided here so a Node checker can
 * exercise it without a browser.
 *
 * The table (`assets/data/team_moves.json`) stores each method as a compact
 * string because that is what makes it 151 KB gzip instead of a second copy of
 * the 4.5 MB `learnsets.json`. `parseSet()` is the one place those strings
 * become numbers.
 */

import { MOVE_CLASS_ZH } from './shared.js';

/** Four slots per member. Defined once; the URL and the checker import it. */
export const MOVES_PER_MEMBER = 4;

/** The order the four tabs, the fill rule, and `methodOf()` agree on. */
export const MOVE_METHODS = ['level', 'machine', 'egg', 'tutor'];

/**
 * Moves that deal damage without type effectiveness or STAB taking part, so
 * counting them as coverage would promise damage the chart cannot deliver:
 *   fixed damage  49 音爆 · 69 地球上投 · 82 龍之怒 · 101 黑夜魔影
 *                 149 精神波 · 162 憤怒門牙 · 283 蠻幹 · 717 自然之怒
 *   one-hit KO    12 斷頭鉗 · 32 角鑽 · 90 地裂 · 329 絕對零度
 *   counter       68 雙倍奉還 · 243 鏡面反射 · 368 金屬爆炸 · 515 搏命
 *   no attack     117 忍耐
 * Everything else with a null power (踢倒, 重磅衝撞, 噴出 …) still takes its
 * type multiplier, so it stays in the coverage with its power shown as 依情況.
 */
export const TYPELESS_MOVES = new Set([
  12, 32, 49, 68, 69, 82, 90, 101, 117, 149, 162, 243, 283, 329, 368, 515, 717,
]);

/** The `defs` column order, read from the table rather than assumed. */
export function fieldIndex(fields) {
  const index = {};
  fields.forEach((name, position) => { index[name] = position; });
  return index;
}

/** One species' four method lists, as numbers. */
export function parseSet(sets, id) {
  const raw = sets[String(id)];
  if (!raw) return { level: [], machine: [], egg: [], tutor: [] };
  const list = (value) => (value ? value.split(',').filter(Boolean) : []);
  return {
    level: list(raw.l).map((token) => token.split(':').map(Number)),
    machine: list(raw.m).map(Number),
    egg: list(raw.e).map(Number),
    tutor: list(raw.t).map(Number),
  };
}

/** The ids of one method, in learnset order. Level rows drop their level. */
export function methodIds(set, method) {
  if (method === 'level') return set.level.map((row) => row[0]);
  return set[method] || [];
}

/** Every move the species can learn by any method. */
export function allMoveIds(set) {
  const ids = new Set();
  for (const method of MOVE_METHODS) {
    for (const id of methodIds(set, method)) ids.add(id);
  }
  return ids;
}

/**
 * The first method that teaches a move, in MOVE_METHODS order. Used for the
 * picker's method chip while searching across tabs; a move taught two ways is
 * labelled by its preferred source rather than by the last one checked.
 */
export function methodOf(set, moveId) {
  for (const method of MOVE_METHODS) {
    if (methodIds(set, method).includes(moveId)) return method;
  }
  return null;
}

/** A move row for the dialog and the slot, built once per id. */
export function moveRecord(id, table, index) {
  const def = table.defs[String(id)];
  if (!def) return null;
  return {
    id,
    zh: def[index.zh],
    en: def[index.en],
    type: def[index.type],
    class: def[index.class],
    power: def[index.power],
    accuracy: def[index.accuracy],
    pp: def[index.pp],
    generation: def[index.generation],
    effect: def[index.effect],
  };
}

/** A damaging move the coverage may count. */
export function isDamaging(move) {
  return Boolean(move) && move.class !== 'status' && !TYPELESS_MOVES.has(move.id);
}

/** 必中 is stored as accuracy 0; a damaging move with no power is 依情況. */
export function accuracyText(move) {
  if (move.accuracy === null || move.accuracy === undefined) return '—';
  return move.accuracy === 0 ? '必中' : String(move.accuracy);
}

export function powerText(move) {
  if (move.class === 'status') return '—';
  if (!move.power) return '依情況';
  return String(move.power);
}

export function classText(move) {
  return MOVE_CLASS_ZH[move.class] || move.class;
}

function shuffle(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Four distinct level-up moves, filled from machine → tutor → egg only when the
 * level pool is short. 22 species have fewer than four level moves and 5 have
 * fewer than four in total (#132, #201, #235, #789, #790), so a short array is
 * a fact about the species, never a draw failure.
 *
 * `rng` is injected so the checker runs a seeded generator and the page can
 * re-roll on every load without this function owning the entropy.
 */
export function drawMoves(set, rng = Math.random) {
  const level = [...new Set(methodIds(set, 'level'))];
  const picked = shuffle(level, rng).slice(0, MOVES_PER_MEMBER);
  if (picked.length === MOVES_PER_MEMBER) return picked;

  const chosen = new Set(picked);
  const rest = [];
  for (const method of ['machine', 'tutor', 'egg']) {
    for (const id of methodIds(set, method)) {
      if (!chosen.has(id) && !rest.includes(id)) rest.push(id);
    }
  }
  for (const id of shuffle(rest, rng)) {
    if (picked.length === MOVES_PER_MEMBER) break;
    picked.push(id);
  }
  return picked;
}
