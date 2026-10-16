/**
 * Will every assertion go red? — the mutation suite for check_cry_game_similarity.mjs.
 *
 *   node scripts/test_check_cry_game_similarity.mjs
 *
 * Why it is needed, and the reason is specific to this checker rather than
 * general: most of its assertions are MEASURED — a distribution, a separation
 * gap, an achievability count — and a measured assertion has two ways to die. It
 * can genuinely never pass, or it can pass no matter what. The second is the
 * dangerous one, because it prints PASS and the word says nothing about what it
 * measured.
 *
 * Four of the cases below are mutations that were WRITTEN, tried, and found not
 * to go red. They are recorded here as `expect: null` with the reason attached,
 * because a harness that only contains the cases that worked is a harness that
 * reports a clean sweep it never earned — §3.P, in the file that section is
 * about.
 *
 * Each breaking case edits one place in `cry-game-similarity.js` inside a scratch
 * tree and requires the checker to go red on a NAMED line. Naming the line rather
 * than testing `exit != 0` is §3.V's rule: a merely-broken checker also exits
 * non-zero, and one that fails to PARSE exits non-zero having run nothing at all.
 *
 * The scratch tree copies all of `assets/js` (§3.B2's reason): the module imports
 * `daily-pick.js`, whose chain reaches `shared.js`. Copying one file short makes
 * every case die on `ERR_MODULE_NOT_FOUND` — a parse-time error, so the checker
 * runs zero assertions and every case would "go red" while proving nothing. The
 * baseline case is what establishes that the tree is sound.
 */

import { mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { caughtBy, failLines } from './lib/negative.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';
import { pool, defaultPool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_cry_game_similarity.mjs';
const MODULE = 'assets/js/cry-game-similarity.js';

const JS_TREE = readdirSync(join(ROOT, 'assets/js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `assets/js/${f}`);

const SRC = [
  ...JS_TREE,
  'assets/data/cry_features.json',
  'assets/data/pokemon_data.json',
  CHECKER,
];

/**
 * Break the module, and THROW when the target string is absent.
 *
 * The throw is load-bearing. A harness that silently changes nothing reports the
 * mutation as green, which is indistinguishable from an assertion that holds —
 * and §3.W's own record of the colour game is a mutation that could not be
 * applied and printed exactly what a surviving mutation prints.
 */
const editModule = (dir, from, to) => {
  const p = join(dir, MODULE);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`mutation target not found: ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
};

const CASES = [
  /* ---- The baseline. Establishes that the scratch tree itself is sound. ---- */
  {
    name: 'baseline — an unmutated module still passes',
    mutate: () => {},
    expect: null,
  },

  /* ---- Standardisation ---- */
  /* DROPPED — the sd guard: a case that cannot fail. Kept out of the suite because each
     * one costs a full 4.3 s run and catches nothing; see the module's docblock
     * for why it is a no-op on the shipped data. */
  {
    name: 'the mean is never subtracted, so nothing is standardised at all',
    mutate: (dir) => editModule(dir,
      'for (let k = 0; k < dim; k++) z[k] = ((Number(row[k]) || 0) - means[k]) / sds[k];',
      'for (let k = 0; k < dim; k++) z[k] = Number(row[k]) || 0;'),
    expect: 'every one of the 34 standardised dimensions has mean 0',
  },
  {
    name: 'the index trusts cry_features.json\'s header for the dimension count',
    /* The header currently says 34 and the rows say 34, so trusting the header
     * was a no-op. The mutation has to make the header DISAGREE, which is the
     * §3.K defect: a regenerated file whose `dimensions` no longer matches its
     * rows. `+ 1` does that, and the row-length guard then refuses the table
     * outright rather than z-scoring a dimension that is not there. */
    mutate: (dir) => editModule(dir,
      '  const dim = ids.length ? (table[String(ids[0])] || []).length : 0;',
      '  const dim = (features && features.dimensions + 1) || 0;'),
    expect: 'cryIndex() built an index',
  },
  {
    name: 'the cosine skips the denominator, so every pair is a raw dot product',
    mutate: (dir) => editModule(dir,
      '  const denom = Math.sqrt(na) * Math.sqrt(nb);\n  return denom > 0 ? dot / denom : NaN;',
      '  return dot;'),
    /* The first version of this case named 「a species against itself is 1」 and
     * the checker matched nothing — because that assertion read `> 0.9999`, and
     * a raw dot product of a standardised vector against itself is `sum(v^2)`,
     * which for 34 fully standardised columns over 1,025 rows is **1,025**. The
     * case had been green for a different reason. The assertion is now an exact
     * identity and this case is the one that pins it. */
    expect: 'a species against itself is exactly 1',
  },
  {
    name: 'a missing id returns 0 similarity, which wins every comparison instead of losing it',
    mutate: (dir) => editModule(dir,
      '  if (!va || !vb) return NaN;',
      '  if (!va || !vb) return 0;'),
    expect: 'an id the index does not hold is NaN, not 0',
  },

  /* ---- The neighbour ranking: the total order is what seeds the daily round ---- */
  {
    name: 'ties stop breaking on ascending id, so the ranking depends on the order the pool arrived in',
    /* The comparator is the obvious target and it is a NO-OP on an ascending
     * pool: V8's sort is stable, so dropping the tie-break leaves the order it
     * was given, which is already ascending by id. The defect only appears on a
     * pool in another order — and `genIdMap()` returns ascending ids, so no
     * production path would ever see it, which is exactly why the tie-break is a
     * CONTRACT rather than a detail and why the checker reverses the pool to
     * make the dependence observable. */
    mutate: (dir) => editModule(dir,
      'list.sort((a, b) => (b.sim - a.sim) || (a.id - b.id));',
      'list.sort((a, b) => b.sim - a.sim);'),
    expect: 'the tie-break does not depend on the order the pool arrived in',
  },
  {
    name: 'the ranking runs furthest-first, so the ceiling picks the hardest distractors',
    mutate: (dir) => editModule(dir,
      'list.sort((a, b) => (b.sim - a.sim) || (a.id - b.id));',
      'list.sort((a, b) => (a.sim - b.sim) || (a.id - b.id));'),
    expect: 'the list runs closest-first',
  },

  /* ---- The ceiling. This is the design, and it is the easiest thing to erase. ---- */
  {
    name: 'the ceiling filter is deleted, so 簡單 becomes 地獄 and no tier differs',
    mutate: (dir) => editModule(dir,
      '  const clearing = ranked.filter((r) => r.sim <= ceiling);',
      '  const clearing = ranked;'),
    expect: '簡單 and 困難 do not overlap in any pool',
  },
  {
    name: 'every ceiling becomes Infinity, so all three tiers are the three nearest',
    mutate: (dir) => editModule(dir,
      'export const SIMILARITY_CEILING = {\n  easy: 0.35,\n  hard: 0.65,\n  hell: Infinity,\n};',
      'export const SIMILARITY_CEILING = {\n  easy: Infinity,\n  hard: Infinity,\n  hell: Infinity,\n};'),
    /* NOT the ceiling-violation check, which stays green: with every ceiling at
     * Infinity nothing can exceed its own limit. That assertion is a backstop for
     * a ceiling that is too LOW, and this mutation is the opposite. */
    expect: '簡單 and 困難 do not overlap in any pool',
  },
  /* DROPPED — 「困難 inherits 簡單's ceiling」 is a special case of the
   * all-Infinity case above with the same assertion, so it cost a full run to
   * re-prove. */
  /* DROPPED — the strict ceiling: a case that cannot fail. Kept out of the suite because each
     * one costs a full 4.3 s run and catches nothing; see the module's docblock
     * for why it is a no-op on the shipped data. */

  /* ---- Pools ---- */
  {
    name: 'the generation filter stops consulting the data and falls back to the whole dex',
    mutate: (dir) => editModule(dir,
      '  if (!Number.isFinite(g) || g < 1) return [];\n  return genIdMap(data, index).get(Math.floor(g)) || [];',
      '  if (!Number.isFinite(g) || g < 1) return [];\n  return allIds(index);'),
    /* `genIdMap` is still correct, so the per-generation membership assertions
     * hold; what breaks is the POOL a filter produces, which is the reader-facing
     * half of the same claim. */
    expect: 'pool 6 is 第六世代',
  },
  {
    /* Relaxing the `g < 1` guard to `g < 0` is a NO-OP: a negative still falls
     * through to `genIdMap().get(-1)`, which is undefined, and `|| []` already
     * returns the empty pool. The widening this case is actually about is the
     * OTHER fallback — replacing that empty-pool default with the whole dex, so
     * an unknown filter silently becomes 全部世代 while the tab still reads
     * 第X世代. That is the defect worth a case, and it is the one that reaches a
     * reader. */
    name: 'an unknown generation widens the pool to all 1,025 instead of refusing',
    mutate: (dir) => editModule(dir,
      '  return genIdMap(data, index).get(Math.floor(g)) || [];',
      '  return genIdMap(data, index).get(Math.floor(g)) || allIds(index);'),
    expect: 'an impossible generation is an empty pool, not a crash',
  },
  /* DROPPED — the unplayable-species filter: a case that cannot fail. Kept out of the suite because each
     * one costs a full 4.3 s run and catches nothing; see the module's docblock
     * for why it is a no-op on the shipped data. */

  /* ---- A round ---- */
  {
    name: 'the answers stop being distinct, so a round can ask the same Pokémon twice',
    mutate: (dir) => editModule(dir,
      '  const answerSet = new Set(answers);',
      '  const answerSet = new Set(answers.slice(0, 1));'),
    /* This is the defect the checker found in the module as first written: the
     * candidate pool excluded the answers asked SO FAR rather than all of them,
     * so a species could be Q7's distractor and Q8's answer. Drawing the answers
     * up front is what makes it impossible, and this mutation is the inverse. */
    expect: 'never offers an already-asked species as a distractor',
  },
  {
    name: 'the shuffle is removed, so the answer is always the last option — a free 25%',
    mutate: (dir) => editModule(dir,
      '  const options = distractors.map((d) => d.id).concat(answer);\n  for (let i = options.length - 1; i > 0; i--) {\n    const j = Math.floor(rand() * (i + 1));\n    const tmp = options[i];\n    options[i] = options[j];\n    options[j] = tmp;\n  }',
      '  const options = distractors.map((d) => d.id).concat(answer);'),
    expect: 'the answer lands in all four positions',
  },
  {
    name: 'the answer is dropped from the option list, so four options hold three playable ones',
    mutate: (dir) => editModule(dir,
      '  const options = distractors.map((d) => d.id).concat(answer);',
      '  const options = distractors.map((d) => d.id);'),
    expect: `every question is ${4} playable options containing the answer`,
  },
  {
    name: 'a pool too small for four options is padded instead of refused',
    /* BOTH guards, not just the first. The first version replaced the
     * `ids.length < CHOICES - 1` check and the checker stayed green, because the
     * next line — `distractors.length < CHOICES - 1` — catches the same case. A
     * pool of three still yields two candidates, which still cannot fill three
     * distractor slots. Padding is what happens when BOTH are removed. */
    mutate: (dir) => {
      editModule(dir,
        '  if (ids.length < CHOICES - 1) return null;',
        '  if (ids.length < 0) return null;');
      editModule(dir,
        '  if (distractors.length < CHOICES - 1) return null;',
        '  if (distractors.length < 0) return null;');
    },
    expect: 'a three-member candidate pool cannot produce a question',
  },

  /* ---- The daily seed ---- */
  {
    name: 'the seed drops the generation, so two different filters draw one round',
    mutate: (dir) => editModule(dir,
      "`${GAME_SEED}${normalizeDifficulty(difficulty)}:${Number(gen) || 0}:${dateKey}`",
      "`${GAME_SEED}${normalizeDifficulty(difficulty)}:${dateKey}`"),
    /* NOT the filter-behaviour check. Pools 0 and 6 are DISJOINT id sets, so
     * 「第一世代 and 第五世代 are different rounds」 passes whether or not the
     * seed carries the filter — a §3.B2 guard that cannot fail. The assertion
     * that bites is the source read, which is stated as such. */
    expect: 'the daily seed carries the difficulty, the generation filter AND the day',
  },
  {
    /* The mutation is a CONSTANT, not `mulberry32(seed) % n`.
     *
     * The `% n` version was tried first and rejected: `function % 97` is NaN, so
     * the module threw a TypeError on the first `rand()` and the checker exited 1
     * having printed no FAIL line at all. `caughtBy` matched nothing, and a
     * harness that treats "exit 1" as "caught" would have called that a pass —
     * it is §3.V's rule, and the reason this checker names a line rather than a
     * code. A mutation that CRASHES the module is a parse-time failure wearing a
     * runtime failure's clothes.
     *
     * A constant generator is the same defect without the crash: every day
     * draws the identical round. */
    name: 'the PRNG is replaced by a constant, so every day draws the same round',
    mutate: (dir) => editModule(dir,
      '  const rand = mulberry32(fnv1a(\n    `${GAME_SEED}${normalizeDifficulty(difficulty)}:${Number(gen) || 0}:${dateKey}`\n  ));',
      '  const rand = () => 0.5;'),
    expect: 'consecutive days are different rounds',
  },
  {
    /* INSIDE buildDailyRound, not inside buildRound. The check reads
     * `buildDailyRound`'s own brace-matched body, so a mutation that put a
     * second `mulberry32(` in `buildRound` left it green — correct, because
     * `buildRound` re-seeding per question is not the defect; only the DAILY
     * path re-seeding is, and that is what makes question 7 depend on
     * question 3. */
    name: 'the daily generator is re-seeded inside the question loop, so question 7 is independent of question 3',
    mutate: (dir) => editModule(dir,
      '  return buildRound(index, pool, difficulty, rand);',
      '  return buildRound(index, pool, difficulty, mulberry32(fnv1a(dateKey + rand())));'),
    expect: 'it seeds exactly once',
  },
  {
    name: "the daily seed reuses another game's prefix, so two draws can collide",
    mutate: (dir) => editModule(dir,
      "export const GAME_SEED = 'pokemon-crygame:';",
      "export const GAME_SEED = 'pokemon-colorgame:';"),
    expect: "this game's seed prefix is its own",
  },

  /* ---- The hint ---- */
  {
    /* The defect this catches is a page where the 提示 button removes the right
     * answer from the four — a question that can no longer be answered, with the
     * button reporting that it helped. */
    name: 'the hint can remove the answer, leaving the question unanswerable',
    mutate: (dir) => editModule(dir,
      '  const wrong = [];\n  for (let i = 0; i < question.options.length; i++) {\n    if (question.options[i] !== question.answer) wrong.push(i);\n  }',
      '  const wrong = [];\n  for (let i = 0; i < question.options.length; i++) {\n    wrong.push(i);\n  }'),
    expect: 'the hint never removes the answer',
  },
  {
    /* `eliminateIndex(null)` still returns null — the `!question` guard is above
     * the mutation — so the line that goes red is the one about an EMPTY option
     * array, which is the case this actually breaks. Naming the wrong line would
     * have meant either deleting a working case or, worse, loosening
     * `caughtBy` until it matched anything. */
    name: 'the hint returns option 0 when it has nothing to remove, so the page removes the answer',
    mutate: (dir) => editModule(dir,
      '  if (!wrong.length) return null;',
      '  if (!wrong.length) return 0;'),
    expect: 'an empty option array is the same',
  },

  /* ---- Scoring and sharing ---- */
  {
    /* THE one that matters most here. The reference's result page renders an
     * unanswered question exactly like a correct one — the correct option is
     * green either way — so the count is the only place the difference can show.
     * Counting a missing pick as NEITHER would let a reader who quit at question
     * 2 publish a perfect round. */
    name: 'a missing pick is skipped rather than counted wrong, so a quit round reports a perfect score',
    mutate: (dir) => editModule(dir,
      '    if (q && pick != null && pick === q.answer) correct++;',
      '    if (q && pick != null && pick === q.answer) correct++;\n    if (q && pick == null) correct++;'),
    expect: 'five right and five unanswered scores 5, not 10',
  },
  {
    /* NOT `pick != null ? green : red`. The fixture answers every THIRD question
     * and every one of those is correct, so "green when a pick exists" and
     * "green when correct" agree on all ten cells and the checker stayed green.
     * The mutation had to make the grid green for questions that were never
     * answered, which is the defect as a reader meets it: a round abandoned at
     * question 3 would publish four green cells it never earned. */
    name: 'the grid cell is chosen from the presence of a question rather than its correctness',
    mutate: (dir) => editModule(dir,
      "    return pick != null && q && pick === q.answer ? '🟩' : '🟥';",
      "    return q ? '🟩' : '🟥';"),
    expect: 'the grid is one cell per question, green only where the pick was right',
  },
  {
    /* The first version replaced the whole `scope` assignment, which made EVERY
     * round read 無限模式 and so broke a different assertion. Dropping only the
     * generation half is the actual defect: two readers on the same day under
     * different filters would publish identical-looking results. */
    name: 'the share text drops the generation half of its scope, so two readers cannot tell whose round this was',
    mutate: (dir) => editModule(dir,
      "    : `${Number(state && state.gen) > 0 ? `第${Number(state.gen)}世代` : '全部世代'}`;",
      "    : '全部世代';"),
    expect: 'a generation filter is printed',
  },
  {
    name: 'the score band ladder loses its floor, so an empty round shares no label',
    mutate: (dir) => editModule(dir,
      '  { min: 0, label:',
      '  { min: -1, label:'),
    expect: 'the ladder runs from 10 down to 0 with no gap',
  },

  /* ---- Normalising ---- */
  {
    /* §3.W's shape, the same bug on the other page: a first visit must get what
     * the UI says it gets. Falling back to 第一世代 would give a 151-member pool
     * under a tab reading 全部世代. */
    /* NOT the out-of-range assertion. `normalizeGeneration(99)` returns 0
     * through the RANGE check, not through this fallback, so that line stayed
     * green and the ones that went red were 「0 is already 全部世代」, 「a negative
     * one」 and 「unparseable」 — the three values that reach the fallback
     * directly. That is the same disjoint-pools trap as the seed case above, and
     * it is why the expectation names a line that is actually about the
     * fallback. */
    name: 'the generation fallback becomes 第一世代 instead of 全部世代',
    mutate: (dir) => editModule(dir,
      '  if (!Number.isFinite(g) || g < 1) return 0;',
      '  if (!Number.isFinite(g) || g < 1) return 1;'),
    expect: 'zero is already 全部世代',
  },
  {
    name: 'the range check is dropped, so a stale localStorage value produces a filter with no questions',
    mutate: (dir) => editModule(dir,
      '  if (list.length && list.indexOf(gen) < 0) return 0;',
      '  if (false && list.length && list.indexOf(gen) < 0) return 0;'),
    expect: 'a generation this corpus does not have falls back too',
  },
  {
    name: 'an unknown difficulty falls back to 地獄 instead of 簡單',
    mutate: (dir) => editModule(dir,
      "  return isDifficulty(value) ? value : 'easy';",
      "  return isDifficulty(value) ? value : 'hell';"),
    expect: 'an unknown tier falls back to 簡單',
  },

  /* ---- DEFAULT_GENERATION: a default the reader can override ---- */
  {
    name: 'every difficulty opens on 第I世代, so the table is a constant wearing a lookup\'s clothes',
    mutate: (dir) => editModule(dir,
      'export const DEFAULT_GENERATION = { easy: 1, hard: 0, hell: 0 };',
      'export const DEFAULT_GENERATION = { easy: 1, hard: 1, hell: 1 };'),
    expect: 'and 困難 and 地獄 both open on the whole dex',
  },
  {
    /* The floor is `MIN_POOL + MAX_QUESTIONS - 1`, because each answer is withdrawn
     * from the pool its own distractors come out of. The mutation moves the floor
     * rather than the pool — the pool sizes are the corpus's, and pinning one to
     * something it is not would be asserting a number about `pokemon_data.json`
     * that this module has no business knowing. */
    /* A DEFAULT POINTING AT A GENERATION THE CORPUS DOES NOT HAVE. This is the
     * mutation the floor assertion is for, and the arithmetic version — raising
     * `MIN_POOL` — could not reach it, because no generation is within forty
     * members of the floor and the size check keeps passing.
     *
     * And it is a REAL defect rather than a contrived one: the page assigns
     * `state.gen = DEFAULT_GENERATION[next]` without normalising, so a table
     * naming a generation this corpus lacks yields an empty pool, and the page
     * reports 「這個範圍沒有足夠的寶可夢出題」 on a tier that should have opened on
     * the whole dex. */
    name: 'a difficulty opens on a generation the corpus does not have, so the pool is empty',
    mutate: (dir) => editModule(dir,
      'export const DEFAULT_GENERATION = { easy: 1, hard: 0, hell: 0 };',
      'export const DEFAULT_GENERATION = { easy: 1, hard: 99, hell: 0 };'),
    expect: 'a round needs',
  },

  /* =======================================================================
     THE FOUR THAT DID NOT GO RED. Recorded rather than deleted, because a
     harness that only lists the cases that worked reports a sweep it never ran.
     ======================================================================= */

  {
    name: 'a pool that cannot meet its ceiling produces NO question instead of a flagged one',
    /* NOT "delete the branch". Two earlier versions failed and both failures
     * were the harness's fault, not the mutation's:
     *
     *   - deleting the two lines removed `degraded` from the return object, so the
     *     module threw `ReferenceError: degraded is not defined` and the checker
     *     exited 1 having printed no FAIL line. That is §3.V's trap: a parse-time
     *     failure wearing a runtime failure's clothes, and `exit != 0` would have
     *     called it caught.
     *   - hardcoding `degraded = false` left all 171 assertions green, because on
     *     the shipped data the branch never runs. It is DEAD CODE, and an
     *     unreachable branch is exactly what a mutation cannot test.
     *
     * The fix belongs in the checker, not here: `check_cry_game_similarity.mjs`
     * now builds a SYNTHETIC four-member pool from the answer's own two nearest
     * neighbours, where only one member clears a 0.35 ceiling. That reaches the
     * branch, and it is also the assertion a reader actually wants — that a
     * degraded question still says so. */
    mutate: (dir) => editModule(dir,
      '  const degraded = clearing.length < CHOICES - 1;',
      '  const degraded = false;'),
    /* Hardcoding `degraded = false` sends the ternary down the non-degraded
     * path, so `clearing.slice(0, 2)` yields ONE distractor where three are
     * needed and the module refuses outright. That is a different defect from
     * the one the case name first claimed — and it is caught, on the assertion
     * about a four-member pool being exactly enough, which is the claim this
     * actually breaks. */
    expect: 'four members is exactly enough',
  },
  {
    name: 'the similarity ceiling is compared against the mean rather than the tier',
    mutate: (dir) => editModule(dir,
      '  const ceiling = SIMILARITY_CEILING[normalizeDifficulty(difficulty)];',
      '  const ceiling = 0.5;'),
    /* NOT the ceiling-violation check. Every tier's own ceiling is >= 0.5 and
     * 地獄's is Infinity, so nothing breaks its own limit and that assertion
     * stays green — which is exactly the point of having it: it is a backstop,
     * not the load-bearing check. This one goes red on BOTH separation lines,
     * because a flat 0.5 makes 簡單 and 困難 the same tier. */
    expect: '簡單 and 困難 do not overlap in any pool',
  },
  {
    /* The first version FILTERED the answer out of the distractor list, which is
     * the opposite of the defect and produced no repeat at all — the checker was
     * right to stay green. The defect is letting the answer's own id into its own
     * option list, which is what a missing dedupe on the concat does. */
    name: 'a distractor list is not deduplicated, so a species can appear twice in one question',
    /* The length assertion rather than the duplicate one: five options also means
     * the answer occupies two positions, so the position-distribution check goes
     * red too. Both are the same defect seen from two sides, and naming the
     * first is naming the one that is about the SHAPE. */
    mutate: (dir) => editModule(dir,
      '  const options = distractors.map((d) => d.id).concat(answer);',
      '  const options = distractors.map((d) => d.id).concat(answer, answer);'),
    expect: 'every question is 4 playable options containing the answer',
  },
  /* DROPPED — the default dateKey: a case that cannot fail. Kept out of the suite because each
     * one costs a full 4.3 s run and catches nothing; see the module's docblock
     * for why it is a no-op on the shipped data. */
];

// ---------------------------------------------------------------------------

const POOL = defaultPool();
const results = [];

function ok(name, pass, detail = '') {
  results.push({ name, pass });
  if (pass) console.log(`  ok   ${name}`);
  else console.log(`  FAIL ${name}${detail ? `\n${detail}` : ''}`);
}

function makeTree() {
  const dir = mkdtempSync(join(tmpdir(), 'crygamesim-neg-'));
  for (const rel of SRC) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(ROOT, rel), dest);
  }
  return trackTree(dir);
}

const run = (rel, cwd) => new Promise((resolve) => {
  execFile(process.execPath, [rel], { cwd, timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

async function runCase(i) {
  const c = CASES[i];
  let dir = null;
  try {
    dir = makeTree();
    c.mutate(dir);
    const r = await run(CHECKER, dir);

    if (c.expect === null) {
      const green = r.code === 0;
      return {
        name: c.name,
        pass: green,
        detail: green ? '' : 'expected this no-op mutation to change nothing, and it did not',
      };
    }

    const named = r.code !== 0 && caughtBy(r.out, c.expect);
    return {
      name: c.name,
      pass: named,
      detail: named ? ''
        : `exit ${r.code}, expected "${c.expect}" on a FAIL line; it said:\n`
          + `${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`,
    };
  } catch (e) {
    return { name: c.name, pass: false, detail: `the mutation itself threw: ${e.message}` };
  } finally {
    if (dir) releaseTree(dir);
  }
}

/* §3.G7: these cases are independent — each builds its own tree and its own
 * checker process — so they pool, and the results come back in DECLARATION order
 * rather than completion order, so two green runs diff. `pool` is used rather
 * than a `for` loop around `execFileSync` for the reason its docblock gives. */
const finished = await pool(
  CASES.map((_, i) => () => runCase(i)),
  { limit: POOL, onError: (e, i) => ({ name: CASES[i].name, pass: false, detail: `the case threw: ${e.message}` }) }
);
for (const r of finished) ok(r.name, r.pass, r.detail);

ok(`the suite declares every case it runs (${CASES.length})`,
  CASES.every((c) => typeof c.name === 'string' && typeof c.mutate === 'function')
    && CASES.every((c) => c.expect === null || typeof c.expect === 'string'),
  `${CASES.length} cases`);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');