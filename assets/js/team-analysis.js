/**
 * Team defensive/offensive analysis over the 18-type chart.
 *
 * Pure: no DOM, no fetch, no data. `type-chart.js` is the only source of
 * matchups, so the page and the checker cannot disagree about a multiplier.
 *
 * Defence stays type-only, matching the reference planner: an ability
 * (Levitate) or an item is not consulted. Offence is move-based: a member
 * contributes the four moves it actually carries, each with its own type and
 * the 1.5x same-type attack bonus. A caller that prints either list has to say
 * what it left out, or the result reads as a battle prediction.
 */

import { TYPE_CHART, TYPE_CHART_ORDER } from './type-chart.js';

/** The multiplier one attacking type deals to a (possibly dual-typed) defender. */
export function defensiveMultiplier(types, attackType) {
  let multiplier = 1;
  for (const type of types) {
    const row = TYPE_CHART[attackType];
    multiplier *= row && row[type] !== undefined ? row[type] : 1;
  }
  return multiplier;
}

/**
 * All 18 attacking types against one Pokémon, in the chart's canonical order.
 * `kind` is the only classification the UI and the checker consume; the raw
 * `multiplier` is kept so a 4x weakness can be told from a 2x one.
 */
export function defensiveProfile(types) {
  return TYPE_CHART_ORDER.map((type) => {
    const multiplier = defensiveMultiplier(types, type);
    const kind = multiplier === 0
      ? 'immune'
      : multiplier > 1
        ? 'weak'
        : multiplier < 1
          ? 'resist'
          : 'neutral';
    return { type, multiplier, kind };
  });
}

/**
 * The strongest thing one member can do to one defending type.
 *
 * `moves` are that member's materialised four (see `team.js`): each carries
 * `type`, `stab` and `damaging`. Status moves and fixed-damage moves are
 * already flagged non-damaging, so they cannot promise a multiplier the chart
 * does not apply.
 *
 * `total` is the damage multiplier a reader cares about — type effectiveness
 * times the 1.5x STAB — while `effectiveness` keeps the chart value visible so
 * a tooltip can show `2x * 1.5 = 3x`. Ties keep the earlier slot: the member's
 * own order is the only tie-break that needs no rule.
 */
export function bestAgainst(moves, defenderType) {
  let best = null;
  for (const move of moves || []) {
    if (!move.damaging) continue;
    const effectiveness = defensiveMultiplier([defenderType], move.type);
    const total = effectiveness * (move.stab ? 1.5 : 1);
    if (!best || total > best.total) {
      best = {
        id: move.id,
        zh: move.zh,
        type: move.type,
        effectiveness,
        stab: Boolean(move.stab),
        total,
      };
    }
  }
  return best;
}

/**
 * Per-type team tallies.
 *
 * `defense[].weak` / `.resist` / `.immune` are member ids in team order, which
 * is what lets the page draw one mark per slot. `coverage[].marks` is aligned
 * with `members` (null when the member has no damaging move) and `ids` are the
 * members whose best move reaches 2x or more. The 18 rows are single defending
 * types; a dual-type defender multiplies both and is a battle calculation this
 * overview deliberately does not attempt.
 */
export function analyzeTeam(ids, byId, movesById = new Map()) {
  const members = ids.map((id) => byId.get(id)).filter(Boolean);

  const defense = TYPE_CHART_ORDER.map((type) => {
    const weak = [];
    const resist = [];
    const immune = [];
    for (const member of members) {
      const multiplier = defensiveMultiplier(member.types, type);
      if (multiplier > 1) weak.push(member.id);
      else if (multiplier === 0) immune.push(member.id);
      else if (multiplier < 1) resist.push(member.id);
    }
    return {
      type,
      weak,
      resist,
      immune,
      score: resist.length + immune.length - weak.length,
    };
  });

  const coverage = TYPE_CHART_ORDER.map((type) => {
    const marks = members.map((member) => bestAgainst(movesById.get(member.id), type));
    const ids = members
      .filter((member, index) => marks[index] && marks[index].total >= 2)
      .map((member) => member.id);
    return { type, marks, ids, count: ids.length };
  });

  return { members, defense, coverage };
}

/**
 * The three sentences worth surfacing above the grids. Ordered by severity,
 * then by the chart's order so two teams with equal counts read the same way.
 */
export function teamSummary(analysis) {
  const commonWeaknesses = analysis.defense
    .filter((row) => row.weak.length >= 2)
    .map((row) => ({ type: row.type, count: row.weak.length }))
    .sort((a, b) => b.count - a.count);

  const unresisted = analysis.defense
    .filter((row) => row.weak.length > 0 && row.resist.length + row.immune.length === 0)
    .map((row) => row.type);

  const uncovered = analysis.coverage
    .filter((row) => row.count === 0)
    .map((row) => row.type);

  return { commonWeaknesses, unresisted, uncovered };
}
