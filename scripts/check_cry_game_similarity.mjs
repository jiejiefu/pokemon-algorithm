/**
 * The cry game's question builder and scoring (assets/js/cry-game-similarity.js).
 *
 *   node scripts/check_cry_game_similarity.mjs
 *
 * Its own file because the module has no DOM, no fetch and no audio: it runs to
 * completion in bare Node, and every failure mode here is arithmetic that renders
 * fine and is wrong until asked. Static string matching is the right tool for the
 * shell contract in check_cry_game.mjs, not for this.
 *
 * The five things asserted here, each a MEASUREMENT rather than a restatement of
 * the module's docblock:
 *
 * 1. **Every ceiling is achievable, in every pool, for every species.** The module
 *    degrades to "the three nearest overall" when fewer than three neighbours
 *    clear the ceiling, and a degraded question is a 困難 (hard) question rendered
 *    at 地獄 (hell) difficulty. The docblock claims that branch never runs; this
 *    asserts it over 10 pools x 3 tiers x 1,025 species and reports the count.
 *
 * 2. **Every drawn round honours its ceiling, as an IDENTITY.** `hardestSim <=
 *    ceiling` with the `<=` the module actually filters on; a tolerance would be
 *    satisfied by a mutation whose own error is under it.
 *
 * 3. **The three tiers are separated, per pool.** Not "harder on average" — the
 *    separation the first design lacked, measured the same way it was measured
 *    when it failed. `p90(easy) < p50(hard)` and `p90(hard) < p50(hell)` in all
 *    ten pools, or two of the three tabs are the same tab.
 *
 * 4. **The neighbour list is a total order.** A seeded round is only reproducible
 *    while ties break the same way every time.
 *
 * 5. **The daily round is stable, and the filter is in the seed.** Pooling alone
 *    cannot prove the filter reaches the seed, because the generation pools are
 *    disjoint id sets and would differ by accident — so this asserts the seed
 *    string as a source fact AND that two filters over the same day give
 *    different questions.
 *
 * One thing deliberately NOT asserted, the §3.B2 trap: nothing checks that
 * `SIMILARITY_CEILING` is a *good* difficulty. There is no threshold for "good" —
 * 0.35 and 0.36 both satisfy every check below. What pins the numbers is the
 * docblock's measurement and this file's report of the resulting spread, so a
 * reader changing a ceiling sees the curve move before deciding whether to.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MAX_QUESTIONS, CHOICES, DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES, MATRIX_BREAK_EVEN,
  SIMILARITY_CEILING, SCORE_BANDS, FEATURE_SET, LEGACY_SET, GAME_SEED, MIN_POOL, DEFAULT_GENERATION,
  cryIndex, similarity, neighbours,
  genIdMap, allIds, poolFor, availableGenerations,
  buildQuestion, buildRound, buildDailyRound,
  eliminateIndex, scoreRound, scoreBand, shareText,
  isDifficulty, normalizeDifficulty, normalizeGeneration,
  taipeiDateKey,
} from '../assets/js/cry-game-similarity.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let total = 0;
let failures = 0;
function check(ok, description, detail = () => '') {
  total++;
  if (ok) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}`);
    console.log(`       ${detail()}`);
  }
}
const q = (a, f) => (a.length ? a[Math.floor(a.length * f)] : NaN);

const data = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'));
const features = JSON.parse(readFileSync(join(ROOT, 'assets/data/cry_features.json'), 'utf8'));
const index = cryIndex(features, FEATURE_SET);

/* A real calendar walk: `new Date(\`2026-10-${n}\`)` silently becomes an Invalid
 * Date past the 30th, and `taipeiDateKey` then throws inside `toISOString()`, so
 * the checker dies with a RangeError instead of reporting a FAIL. */
const BASE = Date.UTC(2026, 9, 1);
const at = (n) => new Date(BASE + (n - 1) * 86400000);

/**
 * One seeded generator, SHARED, for every sampling loop in this file.
 *
 * A `makeRand()` factory per loop replays the identical sequence, so the "does the
 * answer land in all four positions" check would see the same shuffled question
 * 400 times and report the answer at position 4 every time — indistinguishable
 * from a page whose shuffle is broken. One xorshift, one `rand()`, consumed in
 * order: what is held constant is the SEQUENCE, which makes the measurement the
 * same experiment on every run, and what varies is how far along it each draw
 * starts.
 */
function makeRand(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const rand = makeRand();

/**
 * The body of a named top-level function, brace-matched.
 *
 * `/function buildDailyRound[\s\S]*?.../` is §3.P's second vacuous shape: a lazy
 * `[\s\S]*?` runs straight past the function's closing brace into whatever
 * follows it, so an assertion about one function is quietly satisfied by a call
 * three functions later. Every brace-matched block in this file goes through
 * here, and the caller asserts on the BODY — which is the thing with the bug.
 */
function fnBody(src, name) {
  const head = src.indexOf(`function ${name}(`);
  if (head < 0) return null;
  const open = src.indexOf('{', head);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

// ---------------------------------------------------------------------------
console.log('\nthe index is built from the table, and the table is the right one');
// ---------------------------------------------------------------------------
{
  check(!!index, 'cryIndex() built an index', () => 'returned null — the feature table is not shaped as expected');
  if (!index) { console.log('\nFAIL  no index; nothing below can run'); process.exit(1); }

  check(index.ids.length === 1025, 'the index holds all 1,025 species',
    () => `${index.ids.length}`);
  check(index.dim === 34, 'and 34 dimensions', () => `${index.dim}`);
  check(index.setName === 'latest', `the shipped set is "latest" (LEGACY_SET=${LEGACY_SET})`,
    () => `${index.setName}`);

  /* Dimensions cross-checked against the FILE'S OWN HEADER, which the module
   * deliberately does not read: a generated file whose header disagrees with its
   * rows is what bit life.html, and reading the header would hide it (§3.K). */
  check(index.dim === features.dimensions,
    `the index's ${index.dim} matches cry_features.json's own declared dimensions`,
    () => `header says ${features.dimensions}, first row holds ${index.dim}`);
  check(index.dim === features.featureNames.length,
    'and the names list is the same length', () => `${features.featureNames.length}`);

  /* §3.G1's UNCOMPARABLE is [peak, rms, m0] and this module keeps all three. The
   * docblock argues why; what is asserted is that the argument is still ABOUT THE
   * CURRENT TABLE — a regenerate with different names would leave the reasoning
   * applying to columns that no longer exist. */
  const names = features.featureNames;
  for (const n of ['peak', 'rms', 'm0']) {
    check(names.indexOf(n) >= 0, `the dimension this module keeps deliberately — "${n}" — is still in the table`,
      () => `cry_features.json no longer has a "${n}" column`);
  }

  /* Standardisation must actually standardise. This reads the VECTORS, not
   * `index.means` / `index.sds`, which are the RAW statistics in the table's own
   * units — asserting mean 0 against those reads 1.17 for `dur` and 792.19 for
   * `zcr`, a check aimed at the wrong object. Recomputing from the vectors also
   * catches a `sd[k] || 1` guard, which standardises a dead column to mean 0 by
   * accident. */
  const vecMean = new Float64Array(index.dim);
  const vecSd = new Float64Array(index.dim);
  for (const v of index.vectors.values()) {
    for (let k = 0; k < index.dim; k++) vecMean[k] += v[k];
  }
  for (let k = 0; k < index.dim; k++) vecMean[k] /= index.ids.length;
  for (const v of index.vectors.values()) {
    for (let k = 0; k < index.dim; k++) vecSd[k] += (v[k] - vecMean[k]) ** 2;
  }
  for (let k = 0; k < index.dim; k++) vecSd[k] = Math.sqrt(vecSd[k] / index.ids.length);

  const meanBad = [];
  const sdBad = [];
  for (let k = 0; k < index.dim; k++) {
    if (Math.abs(vecMean[k]) > 1e-9) meanBad.push(`${features.featureNames[k]}=${vecMean[k].toExponential(2)}`);
    if (Math.abs(vecSd[k] - 1) > 1e-9) sdBad.push(`${features.featureNames[k]}=${vecSd[k].toFixed(4)}`);
  }
  check(meanBad.length === 0, `every one of the ${index.dim} standardised dimensions has mean 0`,
    () => meanBad.slice(0, 6).join(' '));
  check(sdBad.length === 0, 'and standard deviation 1', () => sdBad.slice(0, 6).join(' '));

  /* And the vectors agree with the statistics they claim to be built from —
   * checked by rebuilding one row from the raw table, so a vector that is
   * standardised against a DIFFERENT set's statistics cannot pass. */
  const rowMismatch = [];
  for (const id of [1, 25, 150, 448, 1025]) {
    const raw = features[FEATURE_SET][String(id)];
    const z = index.vectors.get(id);
    for (let k = 0; k < index.dim; k++) {
      const want = ((Number(raw[k]) || 0) - index.means[k]) / index.sds[k];
      if (Math.abs(z[k] - want) > 1e-12) { rowMismatch.push(`${id}[${features.featureNames[k]}]`); break; }
    }
  }
  check(rowMismatch.length === 0,
    'a vector is rebuilt from the raw row and the index\'s own means and sds, to 1e-12',
    () => rowMismatch.join(' '));

  check(features[FEATURE_SET][String(1)].length === index.dim,
    'the raw table agrees about how many dimensions it has');

  /* AN IDENTITY, not `> 0.9999`: dropping the cosine's denominator makes
   * `similarity(x, x)` return `sum(v^2)`, which for 34 fully standardised columns
   * is the ROW COUNT — 1,025 — and 1,025 > 0.9999, so a threshold version passes
   * on the one mutation it exists to catch. The cosine guarantees exactly 1. */
  check(Math.abs(similarity(index, 1, 1) - 1) < 1e-12, 'a species against itself is exactly 1',
    () => `${similarity(index, 1, 1)}`);
  check(Math.abs(similarity(index, 1025, 1025) - 1) < 1e-12, 'and so is the last one',
    () => `${similarity(index, 1025, 1025)}`);
  check(Number.isNaN(similarity(index, 1, 99999)), 'an id the index does not hold is NaN, not 0',
    () => `${similarity(index, 1, 99999)}`);
  check(Number.isNaN(similarity(index, 99999, 1)), 'and so is one on either side');
  check(cryIndex(features, 'no-such-set') === null, 'a missing feature set returns null rather than throwing');
  check(cryIndex(null) === null, 'and so does no features object at all');
  check(cryIndex({ latest: {} }) === null, 'and an empty table');
}

// ---------------------------------------------------------------------------
console.log('\nthe neighbour list is a total order, which is what seeds the daily round');
// ---------------------------------------------------------------------------
{
  const pool = allIds(index);
  let n = neighbours(index, 25, pool);
  check(n.length === 1024, 'every other species is ranked', () => `${n.length}`);
  check(!n.some((r) => r.id === 25), 'and the species itself is not among them');
  check(!n.some((r) => !Number.isFinite(r.sim)), 'every similarity is a finite number');

  let desc = true;
  for (let i = 1; i < n.length; i++) {
    if (n[i].sim > n[i - 1].sim + 1e-12) { desc = false; break; }
  }
  check(desc, 'the list runs closest-first');

  /* THE TOTAL ORDER, asserted rather than assumed. A stable sort over a
   * comparator returning 0 on ties leaves the order up to the engine, and the
   * daily round is a seeded draw over exactly this list — so an unstable tie makes
   * 「everyone sees the same ten questions today」 true on one machine only. Checked
   * by finding a genuine tie and confirming it is broken by ascending id; if no
   * tie exists this reports 0 rather than passing on an empty search. */
  let tieSeen = 0;
  let tieOrdered = 0;
  for (const probe of [1, 25, 94, 150, 448, 658, 1025]) {
    const list = neighbours(index, probe, pool);
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i].sim - list[i - 1].sim) < 1e-12) {
        tieSeen++;
        if (list[i].id > list[i - 1].id) tieOrdered++;
      }
    }
  }
  check(tieSeen > 0,
    `the corpus contains ${tieSeen} exact similarity ties to break`,
    () => 'no ties found — the total-order assertion below is vacuous, which is §3.B2');
  check(tieSeen === 0 || tieOrdered === tieSeen,
    'every tie is broken by ascending id',
    () => `${tieOrdered}/${tieSeen}`);

  /* THE TIE-BREAK MUST NOT DEPEND ON THE ORDER THE POOL ARRIVED IN, and this is
   * the only assertion that can tell. Every production caller passes an ASCENDING
   * pool and V8's sort is stable, so a comparator that simply dropped the
   * tie-break would leave the order unchanged and every other assertion here would
   * stay green. Feeding the pool REVERSED makes the dependence observable. */
  const probe = 25;
  const rankedAsc = neighbours(index, probe, pool);
  const rankedDesc = neighbours(index, probe, pool.slice().reverse());
  check(JSON.stringify(rankedAsc.map((r) => [r.id, r.sim])) === JSON.stringify(rankedDesc.map((r) => [r.id, r.sim])),
    'the tie-break does not depend on the order the pool arrived in — the same pool reversed ranks identically',
    () => {
      for (let i = 0; i < rankedAsc.length; i++) {
        if (rankedAsc[i].id !== rankedDesc[i].id) {
          return `first divergence at rank ${i}: ascending gives #${rankedAsc[i].id}, descending gives #${rankedDesc[i].id}`
            + ` (similarity ${rankedAsc[i].sim})`;
        }
      }
      return 'identical';
    });

  /* THE CACHE MUST AGREE WITH `similarity()`, AT BOTH SIZES, FOR EVERY SPECIES.
   *
   * `neighbours()` has two paths — the n^2 cache for pools of at least
   * MATRIX_BREAK_EVEN, a dot product per pair below it — and a caching layer that
   * drifts from the function it caches returns plausible rankings either way, so
   * the drift is invisible. Comparing the two PATHS to each other cannot work:
   * the threshold is the only thing deciding between them, so a pool large enough
   * to be cached has no direct path to compare against. **The reference has to be
   * `similarity()` itself**, the one thing both paths compute. Below the threshold
   * this also confirms the cache is never consulted. */
  const drift = [];
  let pairs = 0;
  for (const probe of index.ids) {
    for (const size of [MATRIX_BREAK_EVEN - 1, MATRIX_BREAK_EVEN, pool.length]) {
      const sub = pool.slice(0, size);
      const got = neighbours(index, probe, sub);
      const want = sub
        .filter((o) => o !== probe)
        .map((o) => ({ id: o, sim: similarity(index, probe, o) }))
        .sort((a, b) => (b.sim - a.sim) || (a.id - b.id));
      for (let i = 0; i < got.length; i++) {
        pairs++;
        if (got[i].id !== want[i].id || got[i].sim !== want[i].sim) {
          drift.push(`#${probe} pool ${size}[${i}]: ranked ${got[i].id}/${got[i].sim} vs ${want[i].id}/${want[i].sim}`);
          break;
        }
      }
    }
  }
  check(drift.length === 0,
    `both paths rank exactly as similarity() does, on all ${pairs.toLocaleString('en-US')} pairs, on both sides of the threshold`,
    () => drift.slice(0, 4).join(' | '));
  check(MATRIX_BREAK_EVEN === 16,
    'the cache threshold is 16 — n / (2 * dim) at n = 1,025 and dim = 34 is about 15, and it is exported so this check is not a restatement',
    () => `${MATRIX_BREAK_EVEN}`);

  check(!!index._matrix, 'and the matrix was built by the first large-pool ranking', () => 'neighbours() never populated the cache');
  check(index._matrix instanceof Float64Array,
    'as Float64 — Float32 manufactures ties by rounding, and the tie-break would then be deciding the order of pairs that are not equal',
    () => `${index._matrix && index._matrix.constructor.name}`);
  check(index._matrix.length === index.ids.length ** 2, 'and it is square over the whole set',
    () => `${index._matrix && index._matrix.length} vs ${index.ids.length ** 2}`);
  check(MATRIX_BREAK_EVEN === 16,
    'the cache threshold is 16 — n / (2 * dim) at n = 1,025 and dim = 34 is about 15, and it is exported so this check is not a restatement',
    () => `${MATRIX_BREAK_EVEN}`);

  check(neighbours(null, 1, pool).length === 0, 'no index ranks nothing');
  check(neighbours(index, 1, []).length === 0, 'an empty pool ranks nothing');
  check(neighbours(index, 1, [1, 1, 1]).length === 0, 'and a pool of only the answer is empty, not three duplicates');
}

// ---------------------------------------------------------------------------
console.log('\nthe generation pools are derived, and only from playable species');
// ---------------------------------------------------------------------------
{
  const map = genIdMap(data, index);
  check(map.size === 9, 'all 9 generations are derivable', () => `${map.size}`);
  check(allIds(index).length === 1025, '全部 is 1,025', () => `${allIds(index).length}`);

  const EXPECTED = { 1: 151, 2: 100, 3: 135, 4: 107, 5: 156, 6: 72, 7: 88, 8: 96, 9: 120 };
  for (const [gen, n] of Object.entries(EXPECTED)) {
    const ids = map.get(Number(gen)) || [];
    check(ids.length === n, `generation ${gen} has ${n} members`, () => `${ids.length}`);
    const playable = ids.every((id) => index.vectors.has(id));
    check(playable, `generation ${gen} is entirely playable`, () => ids.filter((id) => !index.vectors.has(id)).slice(0, 5));
  }

  /* A pool must never contain a species with no cry, or the page 404s on click
   * with nothing in the console. The index is the intersection of cry_features
   * and the roster, so this is what stops a feature table with a hole in it. */
  const holes = data.filter((p) => !index.vectors.has(p.id));
  check(holes.length === 0,
    'every species in pokemon_data.json has a latest feature row, so no option can 404',
    () => `${holes.length} without: ${holes.slice(0, 6).map((p) => p.id)}`);

  check(poolFor(index, data, 0).length === 1025, 'pool 0 is the whole dex');
  check(poolFor(index, data, 6).length === 72, 'pool 6 is 第六世代', () => `${poolFor(index, data, 6).length}`);
  check(poolFor(index, data, 99).length === 0, 'an impossible generation is an empty pool, not a crash');
  check(poolFor(index, data, -1).length === 0, 'a negative one is too — and not the whole dex');
  /* NOT 全部. `poolFor` treats anything that is not a finite positive integer as
   * an absent generation, and the page's own `normalizeGeneration()` maps the
   * same values to 0 first — so this branch is unreachable from the page and
   * exists only so a direct call reports the absence rather than the whole dex.
   * Returning 全部 here would silently widen a broken filter to 1,025 species
   * while the tab still read 第X世代. */
  check(poolFor(index, data, 'nonsense').length === 0,
    'an unparseable generation is an absent generation, not 全部');
  check(poolFor(index, data, NaN).length === 0, 'and so is NaN');
  check(poolFor(index, data, 2.7).length === 100,
    'a fractional generation floors to its integer rather than missing',
    () => `${poolFor(index, data, 2.7).length}`);

  const gens = availableGenerations(index, data);
  check(gens.join(',') === '1,2,3,4,5,6,7,8,9', 'the page\'s generation chips are derived from the data too',
    () => gens.join(','));

  /* A pool too small to hold four options must be REFUSED, not padded. A round
   * of three questions that claims to be ten is worse than no round: the result
   * panel would read 「3 / 10」. */
  check(buildQuestion(index, 1, [1, 2, 3], 'easy') === null,
    'a three-member candidate pool cannot produce a question — two distractors are not three',
    () => `${buildQuestion(index, 1, [1, 2, 3], 'easy')}`);
  check(buildQuestion(index, 1, [1, 2, 3, 4], 'easy') !== null,
    'four members is exactly enough, and the answer is excluded from its own pool');
  check(buildRound(index, [1, 2, 3], 'easy').length === 0, 'nor a round from a three-member pool');
  /* THE ARITHMETIC. All ten answers are drawn up front, and every question then
   * draws its distractors from the pool minus that whole answer set, so a question
   * needs CHOICES - 1 = 3 members beyond the answers it could be. Hence the cap
   * `min(MAX_QUESTIONS, N - (CHOICES - 1))`: six members give three questions, and
   * the floor for ten is THIRTEEN. The smallest real generation holds 72, so the
   * floor is never approached. */
  for (const [members, expect] of [[3, 0], [4, 1], [6, 3], [12, 9], [13, 10], [19, 10], [1025, 10]]) {
    const got = buildRound(index, allIds(index).slice(0, members), 'easy').length;
    check(got === expect,
      `a ${members}-member pool yields ${expect} question${expect === 1 ? '' : 's'} — min(${MAX_QUESTIONS}, ${members} - ${CHOICES - 1})`,
      () => `got ${got}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nevery ceiling is achievable, in every pool, for every species');
// ---------------------------------------------------------------------------
{
  /* This is the module's central claim and it is checked per species rather
   * than on drawn rounds, because a round only ever asks 10 of the 1,025 — a
   * degraded question in an undrawn species would be invisible to a
   * sample-based check and visible to a player. */
  const pools = [[0, allIds(index)]];
  for (const g of availableGenerations(index, data)) pools.push([g, poolFor(index, data, g)]);

  let degradedTotal = 0;
  let violationTotal = 0;
  let speciesChecked = 0;
  const perTier = {};

  for (const [gen, pool] of pools) {
  /* THE RANKING IS COMPUTED ONCE PER SPECIES AND REUSED ACROSS ALL THREE TIERS. A
   * tier is a CEILING over one similarity list, so the list does not depend on the
   * tier; computing it three times costs 11.5 s to measure the same thing 4 s
   * does.
   *
   * `buildQuestion` still ranks internally; this is the checker's own copy, used
   * only to feed the assertions below. The asserted numbers come from
   * `buildQuestion`'s RETURN VALUE, so hoisting cannot make a check pass that
   * would otherwise fail. */
    const ranked = new Map();
    for (const answer of pool) ranked.set(answer, neighbours(index, answer, pool));

    for (const difficulty of DIFFICULTIES) {
      const ceiling = SIMILARITY_CEILING[difficulty];
      let degraded = 0;
      let violations = 0;
      const hardest = [];
      for (const answer of pool) {
        const list = ranked.get(answer);
        const clearing = list.filter((r) => r.sim <= ceiling);
        const isDegraded = clearing.length < CHOICES - 1;
        if (isDegraded) degraded++;
        const picked = isDegraded ? list.slice(0, CHOICES - 1) : clearing.slice(0, CHOICES - 1);
        if (picked.length < CHOICES - 1) { violations++; continue; }
        /* IDENTITY, not a tolerance: the module filters on `sim <= ceiling`, so
         * the same comparison is what is asserted. A tolerance here would be
         * satisfied by any ceiling mutation whose error is under it. */
        const hard = Math.max(...picked.map((r) => r.sim));
        if (hard > ceiling) violations++;
        hardest.push(hard);
      }
      degradedTotal += degraded;
      violationTotal += violations;
      speciesChecked += pool.length;
      hardest.sort((a, b) => a - b);
      perTier[`${gen}/${difficulty}`] = { hardest, pool: pool.length };
    }
  }

  const combos = pools.length * DIFFICULTIES.length;
  check(violationTotal === 0,
    `0 ceiling violations across ${combos} pool x tier combinations and ${speciesChecked.toLocaleString('en-US')} species checks`,
    () => `${violationTotal} questions broke their own ceiling`);
  check(degradedTotal === 0,
    `0 degraded questions — every species can always find ${CHOICES - 1} distractors under its tier's ceiling`,
    () => `${degradedTotal} fell back to "the three nearest overall", which renders 困難 at 地獄 difficulty`);

  /* THE DEGRADED BRANCH, REACHED WITH A SYNTHETIC QUESTION — on the shipped data
   * it is unreachable, which is precisely why it needs reaching: `buildQuestion`
   * never takes the fallback, so a mutation deleting the branch leaves every
   * assertion green and the branch is dead code on this corpus.
   *
   * The fixture is the answer's own TWO nearest neighbours plus one far species —
   * a four-member pool where only one member clears a 0.35 ceiling and two are
   * needed. Built from `neighbours()` rather than written down, so it cannot drift
   * from the data the way a hardcoded id would.
   *
   * What is asserted is the CONTRACT, not the count: `degraded` must be true and
   * the returned distractors must be the nearest ones, because a 簡單 (easy)
   * question that silently became 地獄 (hell) is a difficulty tab that lies. */
  const synthetic = (() => {
    for (const answer of [25, 1, 94, 150, 448, 658, 1025]) {
      const n = neighbours(index, answer, allIds(index));
      const far = n[n.length - 1].id;
      const pool = [n[0].id, n[1].id, far];
      const q1 = buildQuestion(index, answer, pool, 'easy', () => 0.5);
      if (q1 && q1.degraded) return { answer, pool, q1, ceiling: SIMILARITY_CEILING.easy };
    }
    return null;
  })();
  check(!!synthetic,
    'a synthetic four-member pool exists where the 簡單 ceiling cannot be met — the degraded branch is reachable',
    () => 'no species in the corpus has two neighbours inside 0.35 of it, so the fallback branch is dead code and nothing tests it');
  if (synthetic) {
    check(synthetic.q1.hardestSim > synthetic.ceiling,
      'and on that pool the question reports a hardest distractor ABOVE its own ceiling',
      () => `${synthetic.q1.hardestSim} vs ${synthetic.ceiling}`);
    check(synthetic.q1.degraded === true,
      'while still reporting degraded — a silent ceiling breach the page would render as a normal 簡單 round',
      () => `degraded was ${synthetic.q1.degraded}`);
    /* THREE nearest, not two. The pool has three members and the fallback takes
     * the head of the ranked list, so `far` is a distractor too — the promise
     * being that a degraded question is the three CLOSEST species it could find,
     * ranked, with nothing dropped or re-ordered. */
    const near = neighbours(index, synthetic.answer, synthetic.pool).slice(0, 3).map((r) => r.id).sort((a, b) => a - b);
    const used = synthetic.q1.options.filter((o) => o !== synthetic.answer).sort((a, b) => a - b);
    check(JSON.stringify(used) === JSON.stringify(near),
      'and it falls back to the three NEAREST, ranked — nothing dropped or re-ordered on the way',
      () => `used ${used} rather than ${near}`);
    const notDegraded = buildQuestion(index, synthetic.answer, synthetic.pool, 'hell', () => 0.5);
    check(!notDegraded.degraded,
      '地獄 has no ceiling, so the same pool never degrades — the branch is the ceiling\'s, not the pool\'s',
      () => '地獄 degraded on a pool 簡單 cannot handle');
  }

  /* THE SPREAD, printed whether or not the checks passed. A ceiling is a pinned
   * number and a pinned number is only honest if something reports what it
   * produces, so this is a report and not an assertion. */
  console.log('\n       hardest-distractor similarity by pool x tier (p50 / p90 / max)');
  for (const [gen, pool] of pools) {
    const cells = DIFFICULTIES.map((d) => {
      const s = perTier[`${gen}/${d}`].hardest;
      return `${DIFFICULTY_LABELS[d]} ${q(s, 0.5).toFixed(3)} / ${q(s, 0.9).toFixed(3)} / ${s.length ? s[s.length - 1].toFixed(3) : '-'}`;
    });
    console.log(`       ${(`gen ${gen}`).padEnd(8)} n=${String(pool.length).padStart(4)}  ${cells.join('   ')}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nthe three tiers are actually separated, in every pool');
// ---------------------------------------------------------------------------
{
  /* The measurement that rejected the first design: `p90(簡單) < p50(困難)` and
   * `p90(困難) < p50(地獄)`, per pool. "Harder on average" would be satisfied by a
   * tier that shifts the distribution by a thousandth — which is what the rejected
   * rank-band design did: its 困難 and 地獄 OVERLAPPED in all ten pools, and neither
   * tab did anything a player could hear. */
  const pools = [[0, allIds(index)]];
  for (const g of availableGenerations(index, data)) pools.push([g, poolFor(index, data, g)]);

  let worstEasyHard = { gap: Infinity, at: '' };
  let worstHardHell = { gap: Infinity, at: '' };
  const covered = { easy: new Set(), hard: new Set(), hell: new Set() };

  for (const [gen, pool] of pools) {
    const dist = {};
    for (const difficulty of DIFFICULTIES) {
      /* 40 DRAWN ROUNDS, not one question per species. buildRound draws its own
       * answers and shuffles, so this samples the round rather than the species —
       * and therefore the shuffle too.
       *
       * 40 was measured down from 200 for cost, and the claim is unchanged: the
       * gaps tested are ~0.30 and ~0.19 against within-tier spread of a few
       * hundredths, so 400 samples per pool puts p90 and p50 tens of standard
       * errors apart. The reported gaps are printed below so a reader can see how
       * little margin there is rather than being asked to trust it. */
      const vals = [];
      for (let i = 0; i < 40; i++) {
        for (const x of buildRound(index, pool, difficulty, rand)) {
          vals.push(x.hardestSim);
          covered[difficulty].add(x.answer);
        }
      }
      vals.sort((a, b) => a - b);
      dist[difficulty] = vals;
    }
    const e = q(dist.easy, 0.9);
    const h = q(dist.hard, 0.5);
    const h9 = q(dist.hard, 0.9);
    const l = q(dist.hell, 0.5);
    if (h - e < worstEasyHard.gap) worstEasyHard = { gap: h - e, at: `gen ${gen} (${DIFFICULTY_LABELS.easy} p90 ${e.toFixed(3)} vs ${DIFFICULTY_LABELS.hard} p50 ${h.toFixed(3)})` };
    if (l - h9 < worstHardHell.gap) worstHardHell = { gap: l - h9, at: `gen ${gen} (${DIFFICULTY_LABELS.hard} p90 ${h9.toFixed(3)} vs ${DIFFICULTY_LABELS.hell} p50 ${l.toFixed(3)})` };
  }

  check(worstEasyHard.gap > 0,
    `簡單 and 困難 do not overlap in any pool — tightest gap ${worstEasyHard.gap.toFixed(3)}`,
    () => worstEasyHard.at);
  check(worstHardHell.gap > 0,
    `困難 and 地獄 do not overlap in any pool — tightest gap ${worstHardHell.gap.toFixed(3)}`,
    () => worstHardHell.at);
  console.log(`\n       tightest 簡單→困難 gap ${worstEasyHard.gap.toFixed(3)} (${worstEasyHard.at})`);
  console.log(`       tightest 困難→地獄 gap ${worstHardHell.gap.toFixed(3)} (${worstHardHell.at})`);

  for (const d of DIFFICULTIES) {
    check(covered[d].size > 200,
      `${DIFFICULTY_LABELS[d]} rounds reach a wide spread of answers — ${covered[d].size} distinct`,
      () => `${covered[d].size}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\na question is four distinct options with the answer among them');
// ---------------------------------------------------------------------------
{
  const pool = allIds(index);
  let wrongShape = 0;
  let repeats = 0;
  let position = [0, 0, 0, 0];
  const R = 400;
  for (let i = 0; i < R; i++) {
    /* ONE QUESTION PER DRAW, not a whole round of ten: `buildRound(...)[0]` ranks
     * the pool 4,000 times to use 400 of the results. */
    const answer = pool[Math.floor(rand() * pool.length)];
    const q1 = buildQuestion(index, answer, pool.filter((id) => id !== answer), 'easy', rand);
    if (!q1) { wrongShape++; continue; }
    if (q1.options.length !== CHOICES) wrongShape++;
    if (new Set(q1.options).size !== CHOICES) repeats++;
    if (!q1.options.includes(q1.answer)) wrongShape++;
    for (const o of q1.options) if (!index.vectors.has(o)) wrongShape++;
    position[q1.options.indexOf(q1.answer)]++;
  }
  check(wrongShape === 0, `every question is ${CHOICES} playable options containing the answer`,
    () => `${wrongShape} malformed`);
  check(repeats === 0, 'and no option appears twice', () => `${repeats} repeats`);

  /* The answer's position must not carry information. Sorting the distractors and
   * appending the answer — the obvious implementation — puts it last every time,
   * and a 25% free win on a four-choice question is invisible in every screenshot. */
  const exp = R / CHOICES;
  const sd = Math.sqrt(exp * (1 - 1 / CHOICES));
  const worst = position.reduce((w, n, i) => (Math.abs(n - exp) > Math.abs(w.dev) ? { i, n, dev: n - exp } : w),
    { i: -1, n: 0, dev: 0 });
  check(Math.abs(worst.dev) < 4 * sd,
    `the answer lands in all four positions — worst is #${worst.i + 1} at ${worst.n} vs ${exp.toFixed(0)}`,
    () => `counts: ${position.join(', ')} (σ ${sd.toFixed(1)})`);

  check(buildQuestion(null, 1, pool, 'easy') === null, 'no index builds no question');
  check(buildQuestion(index, 99999, pool, 'easy') === null, 'an answer the index lacks builds nothing');
  check(buildQuestion(index, 1, [], 'easy') === null, 'an empty candidate pool builds nothing');
}

// ---------------------------------------------------------------------------
console.log('\na round is ten questions with ten DIFFERENT answers');
// ---------------------------------------------------------------------------
{
  const pool = allIds(index);
  const byDifficulty = {};
  for (const d of DIFFICULTIES) {
    let short = 0;
    let dupes = 0;
    let crossUse = 0;
    const total = 40;
    for (let i = 0; i < total; i++) {
      const round = buildRound(index, pool, d, rand);
      if (round.length !== MAX_QUESTIONS) short++;
      const answers = round.map((x) => x.answer);
      if (new Set(answers).size !== answers.length) dupes++;
      /* A distractor that is already an answer in this round turns the second
       * question into "which of the two you already met", which is not the
       * measurement the round claims to take. */
      const used = new Set(answers);
      for (const q1 of round) {
        for (const o of q1.options) if (o !== q1.answer && used.has(o)) crossUse++;
      }
    }
    byDifficulty[d] = { short, dupes, crossUse };
  }

  for (const d of DIFFICULTIES) {
    const r = byDifficulty[d];
    check(r.short === 0, `${DIFFICULTY_LABELS[d]} always yields ${MAX_QUESTIONS} questions from the full dex`,
      () => `${r.short}/${total} rounds were short`);
    check(r.dupes === 0, `${DIFFICULTY_LABELS[d]} answers are never repeated within a round`,
      () => `${r.dupes}/${total} rounds repeated one`);
    check(r.crossUse === 0, `${DIFFICULTY_LABELS[d]} never offers an already-asked species as a distractor`,
      () => `${r.crossUse} such options`);
  }

  /* The same, inside the SMALLEST pool: a round needing ten distinct answers out
   * of a shrinking remainder is where this fails, and 第六世代 (Gen VI) is 72
   * members — comfortable — so the floor is asserted rather than assumed. */
  const six = poolFor(index, data, 6);
  let sixShort = 0;
  for (let i = 0; i < 40; i++) if (buildRound(index, six, 'hard', rand).length !== MAX_QUESTIONS) sixShort++;
  check(sixShort === 0, `and 第六世代 (${six.length} members) also always yields ${MAX_QUESTIONS}`,
    () => `${sixShort}/40 short`);
}

// ---------------------------------------------------------------------------
console.log('\nthe daily round is stable, and the generation filter is in the seed');
// ---------------------------------------------------------------------------
{
  const all = poolFor(index, data, 0);
  const six = poolFor(index, data, 6);
  const key = taipeiDateKey(at(13));

  const a = buildDailyRound(index, all, 'hard', 0, '2026-10-13');
  const b = buildDailyRound(index, all, 'hard', 0, '2026-10-13');
  check(a.length === MAX_QUESTIONS, 'a daily round has ten questions', () => `${a.length}`);
  check(JSON.stringify(a) === JSON.stringify(b), 'the same day draws the identical round',
    () => 'the two rounds differ');

  /* A SOURCE ASSERTION, NOT A BEHAVIOURAL ONE, for §3.B2's reason: the obvious
   * behavioural test `buildDailyRound(all, 0) !== buildDailyRound(six, 6)` can
   * never fail, because pools 0 and 6 are DISJOINT id sets (1,025 vs 72) and the
   * two rounds differ no matter what the seed contains. A mutation deleting the
   * filter from the seed leaves it green. */
  const src = readFileSync(join(ROOT, 'assets/js/cry-game-similarity.js'), 'utf8');
  const seedExpr = (src.match(/fnv1a\(\s*\n?\s*`\$\{GAME_SEED\}([^`]*)`/) || [])[1] || '';
  check(seedExpr.includes('difficulty') && seedExpr.includes('gen') && seedExpr.includes('dateKey'),
    'the daily seed carries the difficulty, the generation filter AND the day',
    () => `the seed template is \`${GAME_SEED}\${seedExpr}\` — a behavioural filter check cannot exist (disjoint pools), so this reads the source and says so`);
  const dailyBody = fnBody(src, 'buildDailyRound');
  check(!!dailyBody && /buildRound\(index, pool, difficulty, rand\)/.test(dailyBody),
    'and the generator is consumed inside buildRound, not re-seeded per question',
    () => `buildDailyRound's own body is ${JSON.stringify((dailyBody || '').trim().slice(0, 200))}`);
  check(!!dailyBody && (dailyBody.match(/mulberry32\(/g) || []).length === 1,
    'and it seeds exactly once, so question 7 cannot be independent of question 3',
    () => `${(dailyBody || '').match(/mulberry32\(/g)} mulberry32 calls in buildDailyRound`);

  check(GAME_SEED !== 'pokemon-daily:' && GAME_SEED !== 'pokemon-colorgame:',
    'this game\'s seed prefix is its own, so no two daily draws can collide',
    () => `${GAME_SEED}`);
  check(GAME_SEED === 'pokemon-crygame:', 'and it is the one this page, its store key and this checker all name',
    () => `${GAME_SEED}`);

  /* The one behavioural thing about the filter: two DIFFERENT filters over the
   * same day must give different rounds, and two filters of the SAME size must
   * too. 第一世代 (151) and 第五世代 (156) are close enough in size that a filter
   * dropped from the seed is the only thing keeping them apart in the pool but not
   * in the seed. */
  const one = poolFor(index, data, 1);
  const five = poolFor(index, data, 5);
  const d1 = buildDailyRound(index, one, 'hard', 1, '2026-10-13');
  const d5 = buildDailyRound(index, five, 'hard', 5, '2026-10-13');
  check(JSON.stringify(d1) !== JSON.stringify(d5),
    `第一世代 and 第五世代 on one day are different rounds (${one.length} vs ${five.length} members)`,
    () => 'identical — the filter is not reaching the draw');
  check(!d1.some((x) => !one.includes(x.answer)) && !d5.some((x) => !five.includes(x.answer)),
    'and each round stays inside its own generation');

  /* Difficulty in the seed, same argument: 簡單 and 地獄 could coincidentally
   * match, so assert across many days rather than on one. */
  let sameDaySameRound = 0;
  for (let d = 1; d <= 90; d++) {
    const k = taipeiDateKey(at(d));
    if (JSON.stringify(buildDailyRound(index, all, 'easy', 0, k))
      === JSON.stringify(buildDailyRound(index, all, 'hell', 0, k))) sameDaySameRound++;
  }
  check(sameDaySameRound === 0, 'easy and hell never produce the same round on the same day (90 days)',
    () => `${sameDaySameRound} of 90 days matched`);

  /* Different days differ, and Taipei midnight is the boundary. */
  check(JSON.stringify(buildDailyRound(index, all, 'hard', 0, '2026-10-13'))
    !== JSON.stringify(buildDailyRound(index, all, 'hard', 0, '2026-10-14')),
    'consecutive days are different rounds');
  const morning = buildDailyRound(index, all, 'hard', 0, taipeiDateKey(new Date('2026-10-13T00:00:00+08:00')));
  const evening = buildDailyRound(index, all, 'hard', 0, taipeiDateKey(new Date('2026-10-13T23:00:00+08:00')));
  check(JSON.stringify(morning) === JSON.stringify(evening),
    '00:00 and 23:00 Taipei on one day agree');
  check(taipeiDateKey(new Date('2026-10-13T16:30:00Z')) === '2026-10-14',
    'a Taipei day is named by Taipei midnight, not UTC');

  /* FAIRNESS, NOT COVERAGE — the argument is check_game_similarity.mjs's and does
   * not transfer: a 10-draw round reaching 1,025 species in 365 days is the
   * coupon-collector problem, so what is asserted is that no species dominates. */
  const tally = new Map();
  /* 180 DAYS, halved from a year, is a real cost decision: this sweep was
   * 1,070 ms of a 3,100 ms checker — the single largest item — because each daily
   * round ranks the whole dex ten times. Half a year is still 1,800 draws from
   * 1,025 species, which is all the coupon-collector note needs; a year would be
   * 3,600 and would not change whether one species dominates. */
  const DAYS = 180;
  for (let d = 0; d < DAYS; d++) {
    const round = buildDailyRound(index, all, 'hard', 0, taipeiDateKey(at(d + 1)));
    for (const q1 of round) tally.set(q1.answer, (tally.get(q1.answer) || 0) + 1);
  }
  const exp = (DAYS * MAX_QUESTIONS) / all.length;
  const busiest = Math.max(...tally.values());
  check(busiest < 6 * exp,
    `${DAYS} days of daily rounds ask no species more than 6x its fair share — busiest is ${busiest} vs ${exp.toFixed(2)}`,
    () => `one species took ${busiest} of ${DAYS * MAX_QUESTIONS} questions`);
  void key;
}

// ---------------------------------------------------------------------------
console.log('\nthe hint removes a wrong option and never the answer');
// ---------------------------------------------------------------------------
{
  const round = buildRound(index, allIds(index), 'hard', rand);
  let everAnswer = 0;
  let outOfRange = 0;
  let noOp = 0;
  let missing = 0;
  const R = 5000;
  const seeded = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  for (let i = 0; i < R; i++) {
    const q1 = round[i % round.length];
    const k = eliminateIndex(q1, seeded);
    if (k == null) { missing++; continue; }
    if (k === q1.options.indexOf(q1.answer)) everAnswer++;
    if (!Number.isInteger(k) || k < 0 || k >= q1.options.length) outOfRange++;
    if (q1.options[k] === q1.answer) noOp++;
  }
  check(everAnswer === 0, `the hint never removes the answer (${R} draws)`, () => `${everAnswer} times`);
  check(outOfRange === 0, 'and always returns an index inside the option array', () => `${outOfRange}`);
  check(noOp === 0, 'and the option it names is never the answer', () => `${noOp}`);
  check(missing === 0, 'and it always has something to remove on a well-formed question', () => `${missing}`);

  check(eliminateIndex(null) === null, 'no question means no hint, not a fallback index');
  check(eliminateIndex({ options: [], answer: 1 }) === null, 'an empty option array is the same');
  /* The all-answer array is unreachable from buildQuestion, but the guard is
   * what makes the `null` above honest rather than incidental. */
  check(eliminateIndex({ options: [7], answer: 7 }) === null, 'and a question whose only option is the answer');
}

// ---------------------------------------------------------------------------
console.log('\nthe score counts an unanswered question as wrong');
// ---------------------------------------------------------------------------
{
  const round = buildRound(index, allIds(index), 'hard', rand);
  const allRight = round.map((q1) => q1.answer);
  const noneRight = round.map((q1, i) => (q1.options.find((o) => o !== q1.answer) || null));

  check(scoreRound(round, allRight).correct === MAX_QUESTIONS, 'a perfect round scores 10',
    () => `${scoreRound(round, allRight).correct}`);
  check(scoreRound(round, noneRight).correct === 0, 'and a round of wrong answers scores 0');

  /* THE ONE THAT MATTERS. A missing pick is not skipped — the reference's result
   * page renders an unanswered question exactly like a correct one, because the
   * correct option is green either way, so the score is the only place the
   * difference can show. Counting a missing pick as neither lets a reader who quit
   * at question 2 report a perfect round. */
  const half = round.map((q1, i) => (i < 5 ? q1.answer : null));
  const s = scoreRound(round, half);
  check(s.correct === 5, 'five right and five unanswered scores 5, not 10',
    () => `${s.correct}`);
  check(scoreRound(round, []).correct === 0, 'an empty pick list scores 0');
  check(scoreRound(round, [null, undefined, null]).total === MAX_QUESTIONS,
    'and the total is still the number of questions');
  check(scoreRound([], []).correct === 0, 'an empty round scores 0');
  check(scoreRound(null, null).total === 0, 'and so does no round at all');

  const mixed = round.map((q1, i) => (i % 2 === 0 ? q1.answer : null));
  check(scoreRound(round, mixed).correct === 5, 'alternating right and unanswered scores 5',
    () => `${scoreRound(round, mixed).correct}`);

  /* Bands are monotone, the extremes are their own cases, and the claim is
   * COVERAGE rather than distinctness: bands are ranges and three of the six cover
   * two scores each, so what must hold is that every score 0..10 lands on SOME
   * band — a score reaching no band would print the empty string. */
  const ladder = [];
  for (let n = 0; n <= 10; n++) ladder.push(scoreBand(n));
  check(ladder.every((s) => typeof s === 'string' && s.length > 0),
    'every score 0..10 lands on a non-empty band',
    () => JSON.stringify(ladder.map((s, i) => `${i}:${s || 'EMPTY'}`).filter((x) => x.endsWith('EMPTY'))));
  const byMin = new Map(SCORE_BANDS.map((b) => [b.min, b.label]));
  check(byMin.size === SCORE_BANDS.length,
    'and no two bands share a threshold, so the first match is unambiguous',
    () => `${byMin.size} distinct thresholds across ${SCORE_BANDS.length} bands`);
  check(SCORE_BANDS[0].min === 10 && SCORE_BANDS[SCORE_BANDS.length - 1].min === 0,
    'the ladder runs from 10 down to 0 with no gap', () => JSON.stringify(SCORE_BANDS.map((b) => b.min)));
  check(scoreBand(0) === SCORE_BANDS[SCORE_BANDS.length - 1].label, 'and zero reaches the last band, so none is unreachable');
  check(scoreBand(NaN) === SCORE_BANDS[SCORE_BANDS.length - 1].label,
    'a NaN score reads as zero rather than as a label for no reason');
  check(scoreBand(undefined) === SCORE_BANDS[SCORE_BANDS.length - 1].label, 'and so does a missing one');
  check(DIFFICULTY_NOTES[DIFFICULTIES[0]] && DIFFICULTY_NOTES[DIFFICULTIES[2]],
    'every difficulty has a sentence printed under its tab');
  for (const d of DIFFICULTIES) {
    check(String(SIMILARITY_CEILING[d]) !== '' && DIFFICULTY_LABELS[d] && DIFFICULTY_NOTES[d],
      `${d} has a label, a note and a ceiling`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nthe share text describes the round that was actually played');
// ---------------------------------------------------------------------------
{
  const round = buildRound(index, allIds(index), 'hell', rand);
  const picks = round.map((q1, i) => (i % 3 === 0 ? q1.answer : null));
  const text = shareText({ questions: round, picks, mode: 'daily', difficulty: 'hell', gen: 0, dateKey: '2026-10-13' });
  const lines = text.split('\n');

  check(lines[0] === '叫聲猜謎 2026-10-13 · 地獄（全部世代）',
    'the header carries the day, the tier AND the filter scope', () => lines[0]);
  check(lines[1] === '🟩🟥🟥🟩🟥🟥🟩🟥🟥🟩', 'the grid is one cell per question, green only where the pick was right',
    () => lines[1]);
  /* CODE POINTS, not UTF-16 units: 🟩 is a surrogate pair, so `lines[1].length`
   * reports 20 for a ten-cell grid. */
  check([...lines[1]].length === MAX_QUESTIONS, 'and it is exactly ten cells wide',
    () => `${[...lines[1]].length} cells (UTF-16 length ${lines[1].length})`);
  check(lines[2] === '4 / 10', 'the count agrees with the grid', () => lines[2]);
  check(text.includes('🟩 答對'), 'and the legend says what the colours mean');

  const scoped = shareText({ questions: round, picks, mode: 'daily', difficulty: 'hell', gen: 6, dateKey: '2026-10-13' });
  check(scoped.includes('第6世代'), 'a generation filter is printed, so two readers can tell whose round this was',
    () => scoped.split('\n')[0]);
  check(!scoped.includes('全部世代'), 'and a filtered round does not claim 全部世代');

  const unlimited = shareText({ questions: round, picks, mode: 'unlimited', difficulty: 'easy', gen: 0, dateKey: '2026-10-13' });
  check(unlimited.includes('無限模式'), 'unlimited rounds say so rather than implying a shared day', () => unlimited.split('\n')[0]);

  /* The reference's result page renders an unanswered question identically to a
   * correct one, so a share string derived from the same field would too. The grid
   * is where the two answers agreeing is checkable. */
  const cells = (p) => p.map((v, i) => (v != null && v === round[i].answer ? '🟩' : '🟥')).join('');
  check(cells(picks) === lines[1], 'the grid and the count cannot disagree — one function computes both',
    () => `${cells(picks)} vs ${lines[1]}`);
  /* A DEFAULT dateKey is read, and `taipeiDateKey` takes a Date with no default of
   * its own — a bare call is a TypeError on `now.getTime()`. */
  check(typeof shareText({}).split('\n')[0] === 'string'
    && /^叫聲猜謎 \d{4}-\d{2}-\d{2} · 簡單（全部世代）$/.test(shareText({}).split('\n')[0]),
    'shareText({}) with no arguments at all defaults to today and 全部世代 rather than throwing',
    () => shareText({}).split('\n')[0]);
  check(shareText({ questions: round, picks, mode: 'daily', difficulty: 'hard', gen: 0, dateKey: '2026-10-13' }).split('\n')[1] !== '',
    'a round with no picks shares ten reds — played and missed, never skipped');

  /* The grid is the comparison surface, so it must not grow a second meaning. */
  const withLegend = shareText({ questions: round, picks, mode: 'daily', difficulty: 'hard', gen: 0, dateKey: '2026-10-14' });
  /* TWO emoji lines, both meant to be there: the grid and the legend. The claim is
   * not "how many emoji lines" but "the grid is a grid and the legend is not
   * another one", so the assertion is on the SHAPE — exactly one is ten cells
   * wide. */
  const emojiLines = withLegend.split('\n').filter((l) => /[\u{1F7E2}\u{1F7E5}]/u.test(l));
  check(emojiLines.length === 2, 'two emoji lines: the grid and the legend',
    () => withLegend.replace(/\n/g, '\\n'));
  check(emojiLines.filter((l) => [...l].length === MAX_QUESTIONS).length === 1,
    'and exactly one of them is ten cells wide — the legend is never mistaken for the grid',
    () => emojiLines.map((l) => `${[...l].length} cells`).join(' | '));
  check(shareText({ questions: round, picks, mode: 'daily', difficulty: 'hard', gen: 0, dateKey: '2026-10-14' }).split('\n')[1]
    === shareText({ questions: round, picks, mode: 'daily', difficulty: 'hard', gen: 0, dateKey: '2026-10-13' }).split('\n')[1],
    'and the grid does not depend on which day produced the round');
}

// ---------------------------------------------------------------------------
console.log('\nevery difficulty OPENS ON a pool that can hold a round');
// ---------------------------------------------------------------------------
{
  /* `DEFAULT_GENERATION` is a default the page applies only while the reader has
   * not chosen a generation. What must hold is arithmetic: every tier's opening
   * pool can produce `MAX_QUESTIONS` questions, and the floor is
   * `MIN_POOL + MAX_QUESTIONS - 1` because each answer is withdrawn from the pool
   * its own distractors come out of. A default generation holding 12 members would
   * build a round of five and render 「5 / 10」. */
  for (const d of DIFFICULTIES) {
    const gen = DEFAULT_GENERATION[d];
    const pool = poolFor(index, data, gen);
    const floor = MIN_POOL + MAX_QUESTIONS - 1;
    check(pool.length >= floor,
      `${DIFFICULTY_LABELS[d]} opens on ${gen === 0 ? '全部世代' : `第${gen}世代`} — ${pool.length} members, and a round needs ${floor}`,
      () => `${pool.length} members, ${floor} needed`);
    const round = buildRound(index, pool, d, makeRand(7));
    check(round.length === MAX_QUESTIONS,
      `and it really produces ${MAX_QUESTIONS} questions from that pool`,
      () => `${round.length}`);
  }

  /* 簡單 IS THE NARROW ONE AND THE OTHER TWO ARE NOT, which is the point of the
   * table: `game-similarity.js` gives its own `easy` one generation and `hard` the
   * dex. A table where all three matched would be a constant wearing a lookup's
   * clothes. */
  check(DEFAULT_GENERATION.easy !== 0,
    '簡單 opens on a single generation rather than all 1,025 — the same relationship game-similarity.js has between its easy and hard',
    () => `easy is ${DEFAULT_GENERATION.easy}`);
  check(DEFAULT_GENERATION.hard === 0 && DEFAULT_GENERATION.hell === 0,
    'and 困難 and 地獄 both open on the whole dex, because narrowing the pool is not what makes a question hard');

  /* EVERY DEFAULT NAMES A GENERATION THAT EXISTS. The page assigns
   * `state.gen = DEFAULT_GENERATION[next]` WITHOUT normalising, so a table naming
   * a generation this corpus lacks hands the page an empty pool and it reports
   * 「這個範圍沒有足夠的寶可夢出題」 (not enough Pokémon to build a round) on a tier
   * that should have opened on the whole dex. The page checker asserts the
   * normalise-on-assign side as well. */
  const gmap = new Set(genIdMap(data, index).keys());
  for (const d of DIFFICULTIES) {
    const g = DEFAULT_GENERATION[d];
    check(g === 0 || gmap.has(g),
      `${DIFFICULTY_LABELS[d]}'s opening generation exists in this corpus`,
      () => `generation ${g} is not among 1..9`);
  }
  check(Object.keys(DEFAULT_GENERATION).sort().join(',') === [...DIFFICULTIES].sort().join(','),
    'and the table covers exactly the three difficulties, so adding a tier cannot be forgotten here',
    () => `the table has ${Object.keys(DEFAULT_GENERATION).join(', ')}`);

  /* THE TWO AXES REALLY ARE INDEPENDENT, which is the claim the table's docblock
   * makes and the reason a difficulty change may leave the pool alone. If narrowing
   * the pool changed the measured difficulty, 簡單 on 第I世代 would be a fourth
   * thing and the three tabs would not be the same axis. */
  const narrow = [];
  const wide = [];
  for (let i = 0; i < 60; i++) {
    for (const x of buildRound(index, poolFor(index, data, 1), 'hell', rand)) narrow.push(x.hardestSim);
    for (const x of buildRound(index, poolFor(index, data, 0), 'hell', rand)) wide.push(x.hardestSim);
  }
  narrow.sort((a, b) => a - b); wide.sort((a, b) => a - b);
  check(q(narrow, 0.5) > 0.5,
    `地獄 on 第I世代 is still 地獄 — its hardest distractor is p50 ${q(narrow, 0.5).toFixed(3)} over 600 questions, so a narrow pool does not soften the tier`,
    () => `p50 ${q(narrow, 0.5)}`);
  check(q(narrow, 0.5) > q(wide, 0.5),
    `and it is HARDER than 地獄 on the full dex — p50 ${q(narrow, 0.5).toFixed(3)} against ${q(wide, 0.5).toFixed(3)} — because a smaller pool means closer neighbours, not weaker ones`,
    () => `${q(narrow, 0.5)} vs ${q(wide, 0.5)}`);
}

// ---------------------------------------------------------------------------
console.log('\nnormalising a value that came from localStorage');
// ---------------------------------------------------------------------------
{
  check(isDifficulty('hard'), 'hard is a difficulty');
  check(!isDifficulty('impossible'), 'impossible is not');
  check(normalizeDifficulty('impossible') === 'easy', 'an unknown tier falls back to 簡單');
  check(normalizeDifficulty(undefined) === 'easy', 'and so does a missing one');
  check(normalizeDifficulty('hell') === 'hell', 'a real one is kept');

  /* The fallback is 0 (全部/all) and NOT 1 (第一世代). §3.W records the analogous
   * bug on the colour game: a first visit must get what the UI says it gets. */
  const GENS = availableGenerations(index, data);
  check(normalizeGeneration(99, GENS) === 0, 'an out-of-range generation falls back to 全部世代',
    () => `${normalizeGeneration(99, GENS)}`);
  check(normalizeGeneration(0, GENS) === 0, 'zero is already 全部世代');
  check(normalizeGeneration(-1, GENS) === 0, 'and so is a negative one');
  check(normalizeGeneration('nonsense', GENS) === 0, 'and unparseable');
  check(normalizeGeneration(3, GENS) === 3, 'a real one is kept');
  check(normalizeGeneration(9, GENS) === 9, 'and so is the last one');
  /* `available` is REQUIRED and used to be optional, so `normalizeGeneration(99)`
   * returned 99 — a filter the corpus cannot satisfy — with the range check doing
   * nothing for any caller that left it off. */
  check(normalizeGeneration(99, undefined) === 99,
    'with no list at all there is no range to check against, and that is now the only way to get one — so a caller that forgets the list gets a filter with no questions',
    () => `${normalizeGeneration(99, undefined)} — if this ever becomes 0, normalizeGeneration grew a hidden range`);
  check(normalizeGeneration(99, [1, 2, 3]) === 0,
    'a generation this corpus does not have falls back too, rather than producing an empty pool');
  check(normalizeGeneration(2, [1, 2, 3]) === 2, 'and a real one survives that check');
  check(normalizeGeneration(2.7, [1, 2, 3]) === 2, 'a fractional generation floors rather than missing');

  check(MAX_QUESTIONS === 10, 'ten questions, as the reference has');
  check(CHOICES === 4, 'four options, as the reference has');
  check(MIN_POOL === CHOICES, 'and a pool must hold at least one full question');
  check(DIFFICULTIES.length === 3, 'there are three difficulties');
  check(FEATURE_SET === 'latest', 'the shipped feature set is latest, matching LEGACY_SET=false',
    () => `${FEATURE_SET}`);
  check(DIFFICULTY_LABELS.easy === '簡單' && DIFFICULTY_LABELS.hard === '困難' && DIFFICULTY_LABELS.hell === '地獄',
    'and the three are named the way the tabs name them');
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);