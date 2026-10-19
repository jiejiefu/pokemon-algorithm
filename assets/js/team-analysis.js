/**
 * Team defensive/offensive analysis over the 18-type chart.
 *
 * Pure: no DOM, no fetch, no data. `type-chart.js` is the only source of
 * matchups, so the page and the checker cannot disagree about a multiplier.
 *
 * The scope is deliberately type-only, matching the reference planner: an
 * ability (Levitate), an item, or a movepool is not consulted. A caller that
 * prints a weakness list has to say so, or the result reads as a battle
 * prediction rather than a type summary.
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
 * Defending types this Pokémon's own types hit for super-effective damage.
 * This is STAB-only coverage, not movepool coverage: a Water-type contributes
 * Water even if it cannot learn a damaging Water move.
 */
export function stabCoverage(types) {
  const covered = new Set();
  for (const type of types) {
    const row = TYPE_CHART[type] || {};
    for (const [defender, multiplier] of Object.entries(row)) {
      if (multiplier > 1) covered.add(defender);
    }
  }
  return covered;
}

/**
 * Per-type team tallies.
 *
 * `defense[].weak` / `.resist` / `.immune` are member ids in team order, which
 * is what lets the page draw one mark per slot. `coverage[].ids` are the
 * members whose STAB hits that defending type for 2x or more.
 */
export function analyzeTeam(ids, byId) {
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
    const hit = [];
    for (const member of members) {
      for (const attackType of member.types) {
        const row = TYPE_CHART[attackType];
        if (row && row[type] > 1) {
          hit.push(member.id);
          break;
        }
      }
    }
    return { type, ids: hit, count: hit.length };
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
