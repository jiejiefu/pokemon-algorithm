/**
 * The silhouette draft's rules, as pure state.
 *
 * Six rounds, six unseen silhouettes each, one irreversible pick; the computer
 * immediately takes one of the five candidates the player passed on, so the two
 * teams are disjoint by construction. Six head-to-head pairings follow, scored
 * only by type. Nothing here touches the DOM, a timer or `Math.random` unless
 * the caller passes none: the page seeds nothing, but the checker runs a
 * deterministic generator and asserts every transition.
 *
 * `type-chart.js` is the only source of a multiplier and `team-moves.js` is the
 * only source of what counts as a damaging move. That is deliberate — a second
 * copy of either would let the page and the checker disagree about a number the
 * page prints.
 */

import { defensiveMultiplier } from './team-analysis.js';
import { isDamaging } from './team-moves.js';

export const ROUNDS = 6;
export const CANDIDATES = 6;
export const TEAM_SIZE = 6;
export const MOVES_PER_MEMBER = 4;
export const SWAPS = 2;

/** Canonical order for a summary that must not depend on insertion order. */
export const MULTIPLIER_BANDS = [4, 2, 1, 0.5, 0.25, 0];

/** A multiplier as the page prints it; `null` is a move the chart cannot score. */
export function multiplierText(multiplier) {
  if (multiplier === null || multiplier === undefined) return '—';
  return `${multiplier}×`;
}

/** The exact band a summary counts, so 4x is never folded into 2x. */
export function multiplierBand(multiplier) {
  return multiplier === null || multiplier === undefined ? 'none' : String(multiplier);
}

/**
 * The compact table's rows, with the pool resolved.
 *
 * `row` is `[id, zh, en, types, pool, anchor, other?]`. `pool` is the last eight
 * level-up moves, `anchor` the move that satisfies the scoring and STAB rules,
 * and `other` is only present when the level list is short. `moves` is the
 * deterministic baseline; `createDraftSession()` replaces it per run.
 */
export function prepareDraftRoster(data) {
  const defs = data.moves || {};
  const resolve = (moveId) => {
    const def = defs[String(moveId)];
    if (!def) throw new Error(`move ${moveId} has no definition`);
    const move = {
      id: moveId,
      zh: def[0],
      type: def[1],
      class: def[2],
    };
    return { ...move, damaging: isDamaging(move) };
  };
  return data.pokemon.map((row) => {
    const [id, zh, en, types, pool, anchorIds, other = []] = row;
    const poolMoves = pool.map(resolve);
    const fill = other.map(resolve);
    const anchors = (anchorIds || []).map(
      (moveId) => poolMoves.find((move) => move.id === moveId) || resolve(moveId),
    );
    const moves = [...poolMoves.slice(-MOVES_PER_MEMBER), ...fill]
      .slice(0, MOVES_PER_MEMBER);
    return {
      id,
      zh,
      en,
      types,
      pool: poolMoves,
      anchors,
      fill,
      moves,
      short: new Set([...pool, ...other]).size < MOVES_PER_MEMBER,
    };
  });
}

/** The slots a run may swap; index 3 is the highest-level move and is kept. */
const SWAP_SLOTS = [0, 1, 2];

/**
 * Four moves for one run: keep the highest-level move, keep or swap the next
 * three, and draw from the pool.
 *
 * Then two guarantees, in this order: one damaging move (a card that prints four
 * em dashes cannot score), and — where the species has one — one move matching
 * its own type. The duel applies no STAB multiplier, so the second is a
 * plausibility rule, not a scoring one: a Venusaur with no Grass or Poison move
 * reads as broken even though the maths would not notice. A species with fewer
 * than four level moves keeps its `other` fill and is never swapped.
 */
export function pickMoves(pokemon, rng) {
  const { pool, anchors, fill, types } = pokemon;
  const chosen = pool.slice(-MOVES_PER_MEMBER);
  for (const move of fill) {
    if (chosen.length >= MOVES_PER_MEMBER) break;
    chosen.push(move);
  }

  const held = new Set(chosen.map((move) => move.id));
  const alternatives = shuffle(
    pool.filter((move) => !held.has(move.id)), rng,
  );
  const slots = shuffle(
    SWAP_SLOTS.filter((index) => index < chosen.length), rng,
  ).slice(0, SWAPS);
  for (const index of slots) {
    if (alternatives.length === 0) break;
    chosen[index] = alternatives.shift();
  }

  /* Two guarantees, and the order matters: every own type the level list can
   * score with gets a move, then a damaging move is guaranteed. A slot already
   * holding a needed type is never a target, so the second anchor cannot evict
   * the first, and the highest-level move is never touched. */
  const protectedIndex = Math.min(chosen.length, pool.length) - 1;
  const free = chosen
    .map((_, index) => index)
    .filter((index) => index !== protectedIndex);
  const needed = types.filter(
    (type) => anchors.some((anchor) => anchor.type === type),
  );
  for (const anchor of anchors) {
    if (chosen.some((move) => move.damaging && move.type === anchor.type)) continue;
    const spare = free.find((index) => {
      const move = chosen[index];
      if (!(move.damaging && needed.includes(move.type))) return true;
      return chosen.some(
        (other, at) => at !== index && other.damaging && other.type === move.type,
      );
    });
    if (spare === undefined) continue;
    chosen[spare] = anchor;
  }

  if (!chosen.some((move) => move.damaging)) {
    const rescue = [...pool, ...fill].find((move) => move.damaging);
    const spare = free.find(
      (index) => !anchors.some((anchor) => anchor.id === chosen[index].id),
    );
    if (rescue && spare !== undefined) chosen[spare] = rescue;
  }
  return chosen;
}

/**
 * The winner of one exchange. `null` is a side with no scorable move, which is
 * worth zero for the comparison but still keeps its own `—` bucket in the tally.
 */
export function duelOutcome(playerBest, computerBest) {
  const player = playerBest === null || playerBest === undefined ? 0 : playerBest;
  const computer = computerBest === null || computerBest === undefined ? 0 : computerBest;
  if (player > computer) return 'win';
  if (player < computer) return 'loss';
  return 'draw';
}

/**
 * One side's four moves against one defender.
 *
 * `best` is the strongest type multiplier the side can actually apply; status,
 * fixed-damage and one-hit-KO moves carry `multiplier: null` and are printed as
 * `—`. STAB is deliberately absent: the page compares types, not damage.
 */
export function attackProfile(attacker, defender) {
  const moves = attacker.moves.map((move) => {
    const multiplier = move.damaging
      ? defensiveMultiplier(defender.types, move.type)
      : null;
    return { ...move, multiplier };
  });
  let best = null;
  for (const move of moves) {
    if (move.multiplier !== null && (best === null || move.multiplier > best)) {
      best = move.multiplier;
    }
  }
  return { attackerId: attacker.id, defenderId: defender.id, moves, best };
}

/** One random item; the caller owns the generator. */
function pickOne(list, rng) {
  if (list.length === 0) return null;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** A Fisher-Yates copy; the caller owns the generator. */
function shuffle(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * One run. Every mutating method returns the record it produced, or `null` when
 * the transition is illegal, so a page cannot advance by calling out of order.
 */
export class DraftSession {
  constructor(roster, rng = Math.random) {
    if (!Array.isArray(roster) || roster.length < ROUNDS * CANDIDATES) {
      throw new Error('the draft pool is too small for six rounds');
    }
    this.roster = roster;
    this.byId = new Map(roster.map((pokemon) => [pokemon.id, pokemon]));
    this.rng = rng;
    this.seen = new Set();
    this.team = [];
    this.round = 1;
    this.selectedId = null;
    this.phase = 'draft';
    this.opponent = [];
    this.pendingRound = null;
    this.matchIndex = 0;
    this.matchPlayerId = null;
    this.matchups = [];
    this.candidates = this.drawCandidates();
  }

  /** Six ids that have never been shown before. */
  drawCandidates() {
    const available = this.roster
      .map((pokemon) => pokemon.id)
      .filter((id) => !this.seen.has(id));
    const picked = shuffle(available, this.rng).slice(0, CANDIDATES);
    for (const id of picked) this.seen.add(id);
    return picked;
  }

  get canConfirmPick() {
    return this.phase === 'draft' && this.selectedId !== null
      && this.pendingRound === null;
  }

  get canAdvanceRound() {
    return this.phase === 'draft' && this.pendingRound !== null;
  }

  get canConfirmMatch() {
    return this.phase === 'match' && this.matchPlayerId !== null
      && this.matchIndex < TEAM_SIZE;
  }

  get currentOpponent() {
    if (this.phase !== 'match') return null;
    const id = this.opponent[this.matchIndex];
    return id === undefined ? null : this.byId.get(id);
  }

  get currentMatchNumber() {
    return Math.min(this.matchIndex + 1, TEAM_SIZE);
  }

  select(id) {
    if (this.phase !== 'draft' || this.pendingRound !== null) return false;
    if (!this.candidates.includes(id)) return false;
    this.selectedId = id;
    return true;
  }

  /**
   * The player commits, then the computer takes one of the five candidates the
   * player passed on. Both stay on screen until `nextRound()`, so the reveal is
   * a beat rather than a flash.
   */
  confirmPick() {
    if (!this.canConfirmPick) return null;
    const player = this.byId.get(this.selectedId);
    const remaining = this.candidates.filter((id) => id !== player.id);
    const opponent = this.byId.get(pickOne(remaining, this.rng));

    this.team.push(player.id);
    this.opponent.push(opponent.id);
    this.selectedId = null;
    this.pendingRound = { round: this.round, player, opponent };
    return this.pendingRound;
  }

  /** Close the reveal and either draw the next six or start the matches. */
  nextRound() {
    if (!this.canAdvanceRound) return null;
    const done = this.team.length >= TEAM_SIZE;
    this.pendingRound = null;

    if (done) {
      this.phase = 'match';
      this.candidates = [];
      return { phase: 'match', round: ROUNDS };
    }

    this.round += 1;
    this.candidates = this.drawCandidates();
    return { phase: 'draft', round: this.round };
  }

  /** A team member who has not already been sent out. */
  isUsed(id) {
    return this.matchups.some((matchup) => matchup.playerId === id);
  }

  selectMatchMember(id) {
    if (this.phase !== 'match' || !this.team.includes(id) || this.isUsed(id)) {
      return false;
    }
    this.matchPlayerId = id;
    return true;
  }

  confirmMatch() {
    if (!this.canConfirmMatch) return null;
    const opponent = this.currentOpponent;
    const player = this.byId.get(this.matchPlayerId);
    const playerOffense = attackProfile(player, opponent);
    const computerOffense = attackProfile(opponent, player);
    const matchup = {
      index: this.matchIndex + 1,
      playerId: player.id,
      opponentId: opponent.id,
      player,
      opponent,
      playerOffense,
      computerOffense,
      outcome: duelOutcome(playerOffense.best, computerOffense.best),
    };
    this.matchups.push(matchup);
    this.matchIndex += 1;
    this.matchPlayerId = null;
    return matchup;
  }

  /**
   * The sixth matchup's analysis is shown before the summary. Keeping the
   * session in `match` at index 6 is what gives that card somewhere to live;
   * advancing is an explicit click, not a side effect of confirming.
   */
  finish() {
    if (this.phase !== 'match' || this.matchIndex < TEAM_SIZE) return false;
    this.phase = 'summary';
    return true;
  }

  /**
   * The six rows, each side's multiplier tally, the win/loss record and verdict.
   *
   * `none` counts a matchup where that side had no move the chart can score;
   * keeping it separate from `0x` is the difference between "nothing landed"
   * and "it was immune".
   */
  summary() {
    const tally = (side) => {
      const counts = Object.fromEntries(MULTIPLIER_BANDS.map((band) => [band, 0]));
      let none = 0;
      for (const matchup of this.matchups) {
        const best = matchup[side].best;
        if (best === null) none += 1;
        else counts[best] += 1;
      }
      return MULTIPLIER_BANDS.map((multiplier) => ({
        multiplier,
        count: counts[multiplier],
      })).concat([{ multiplier: null, count: none }]);
    };
    const record = { wins: 0, draws: 0, losses: 0 };
    let playerTotal = 0;
    let computerTotal = 0;
    for (const matchup of this.matchups) {
      if (matchup.outcome === 'win') record.wins += 1;
      else if (matchup.outcome === 'loss') record.losses += 1;
      else record.draws += 1;
      playerTotal += matchup.playerOffense.best ?? 0;
      computerTotal += matchup.computerOffense.best ?? 0;
    }

    const verdict = record.wins > record.losses ? 'win'
      : record.wins < record.losses ? 'loss'
        : playerTotal > computerTotal ? 'win'
          : playerTotal < computerTotal ? 'loss'
            : 'draw';
    const grade = record.wins >= 6 ? 'S'
      : record.wins >= 5 ? 'A'
        : record.wins >= 4 ? 'B'
          : record.wins >= 3 ? 'C' : 'D';

    return {
      rows: this.matchups,
      player: tally('playerOffense'),
      computer: tally('computerOffense'),
      record,
      playerTotal,
      computerTotal,
      verdict,
      grade,
    };
  }
}

/** The one constructor the page and the checker both call. */
export function createDraftSession(data, rng = Math.random) {
  const roster = prepareDraftRoster(data);
  for (const pokemon of roster) pokemon.moves = pickMoves(pokemon, rng);
  return new DraftSession(roster, rng);
}
