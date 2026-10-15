/**
 * The cry game's question builder and its scoring. Pure functions: no DOM, no
 * fetch, no audio, no localStorage.
 *
 *   cry-game.html                  the only page caller
 *   check_cry_game_similarity.mjs  runs it in bare Node, which is the reason it has no side effects
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS NOT: A SEARCH ENGINE
 * ---------------------------------------------------------------------------
 *
 * `cries.html` already ranks 1,025 species against one probe by cosine over the
 * same 34 features, and `cry-spectrogram.js` is where those features came from.
 * So this module reuses the MEASUREMENT and does not reimplement it, in the same
 * way `game-similarity.js` reuses `color-match.js`'s OKLab arithmetic rather than
 * inventing a second distance — §3.B1's rule, one conversion one implementation.
 *
 * It re-derives the index rather than calling into `cries.html` because that is
 * page-local code inside a `<script type="module">` block, which cannot be
 * imported: §3.F's disease with the roles swapped. The EXPRESSION is the one
 * `cries.html` uses — z-score against the set's own mean and standard deviation,
 * then a weighted cosine — so the game's question and cries.html's
 * 「最相似」 list cannot disagree about what "similar cry" means.
 *
 * ---------------------------------------------------------------------------
 * DIFFICULTY IS A CEILING ON ONE NUMBER, NOT A BAND OF THREE SIBLINGS
 * ---------------------------------------------------------------------------
 *
 * This is the second design tried, and the first one was measured and rejected.
 * The obvious difficulty axis is how similar the three distractors are to the
 * answer, which is also the only axis the data actually supports — the
 * reference's axis was the generation, and generation is a pool filter rather
 * than a difficulty (Gen I has 151 members and Gen VI has 72, so 「第一世代」
 * and 「第六世代」 at the same distractor policy are not comparable rounds).
 *
 * The first design was three RANK BANDS over the pool's neighbour list:
 *
 *     簡單   three distractors drawn from ranks N/2 .. N   (the far half)
 *     困難   three distractors drawn from ranks 1 .. N/4  (the near quartile)
 *     地獄   ranks 1, 2, 3 exactly                        (the three nearest)
 *
 * **Measured across all ten pools (all 1,025 plus each of the nine
 * generations), 困難 and 地獄 do not separate.** The separation
 * `p90(困難) − p10(地獄)` was NEGATIVE in every single pool:
 *
 *     pool        簡單 p50   困難 p50   地獄 p50   p90(困難) p10(地獄)
 *     全部          -0.119     0.572     0.842        0.789      0.696   -0.093
 *     第1世代        0.084     0.775     0.880        0.907      0.652   -0.255
 *     第6世代       -0.058     0.611     0.738        0.780      0.576   -0.204
 *     第9世代        0.267     0.759     0.873        0.891      0.695   -0.195
 *
 * The reason is structural rather than statistical: with four options the
 * answer competes against exactly three others, so a question's difficulty is
 * set by its SINGLE hardest distractor. Drawing three at random from the near
 * quartile puts the hardest one at rank ~21 out of 256, which at that density is
 * almost as confusable as rank 3. **Two tiers of the same axis collapsed into
 * one, and the only symptom would have been a difficulty tab that changes
 * nothing a player can hear.**
 *
 * So difficulty became a CEILING: sort the pool's neighbours by similarity
 * descending, drop every one above the tier's ceiling, take the first three.
 * A question's difficulty is then the ceiling by construction, and the checker
 * asserts that per round as an identity rather than a tolerance.
 *
 * The ceilings, and what they measure (same 10 pools, 4,000 draws each):
 *
 *     簡單  ceiling 0.35   hardest distractor p50 0.349   max 0.350
 *     困難  ceiling 0.65   hardest distractor p50 0.647   max 0.650
 *     地獄  no ceiling     hardest distractor p50 0.738 – 0.879 by pool
 *
 * And the property that makes this shippable rather than merely plausible:
 * across all 10 pools x 3 tiers x every species, the number of times fewer
 * than three neighbours cleared the ceiling was **ZERO**, and the number of
 * ceiling violations was **ZERO**. So the fallback below never fires on the
 * shipped data, and `check_cry_game_similarity.mjs` asserts both facts rather
 * than trusting them.
 *
 * ---------------------------------------------------------------------------
 * WHY ALL 34 DIMENSIONS AND NOT cries.html's ROBUST FIVE
 * ---------------------------------------------------------------------------
 *
 * `cry-spectrogram.js` exports `ROBUST = ['dur','zcr','centroid','rolloff85','flux']`
 * — the five features whose browser-vs-stored difference `check_spectrogram_browser.mjs`
 * could hold to a sensible tolerance. Those five are the five that survive a
 * re-implementation. They are not the five that separate two cries.
 *
 * Measured: cosine over the standardised ROBUST five, against all 1,024 others
 * for every species, is **0.971 at p1, 0.996 at p50, 1.000 at p99** — every pair
 * is nearly identical and no band is distinguishable. Five near-positive
 * standardised dimensions have almost no angular spread, so the cosine is
 * ~1 everywhere. **Expect this shape on any cosine over very few correlated
 * positive dimensions: the metric saturates and every pair looks alike.**
 *
 * All 34 give 3rd-nearest similarity p1 0.552 / p50 0.793 / p99 0.949 — a real
 * spread across which the three tiers can actually differ.
 *
 * ---------------------------------------------------------------------------
 * `m0` IS DELIBERATELY KEPT, AND THAT IS A DEPARTURE FROM §3.G1
 * ---------------------------------------------------------------------------
 *
 * §3.G1's `UNCOMPARABLE = [peak, rms, m0]` and this module uses all 34. Two of
 * the three are a limit of the browser and do not apply — `peak` and `rms` are
 * loudness, and this page plays the reader's chosen volume rather than
 * comparing a decode against a stored analysis. `m0` is the third and it is a
 * real upstream defect: §3.G1 records it as moving by exactly
 * `log(n_out / n_fft) * sqrt(26)`, so about a quarter of its variance is a
 * function of how long the file is.
 *
 * **It is kept anyway, and the reason is that here it is doing a job it is
 * actually good at.** Standardised, `m0` is largely a duration proxy. Two cries
 * of the same length are more alike to a listener than two of different length,
 * so the dimension that is a defect when you are comparing two implementations
 * of the same analysis is signal when you are asking "do these two sound
 * alike". Dropping it would improve the metric's purity and make the game
 * worse. `check_cry_game_similarity.mjs` re-derives the index both ways and
 * reports the spread, so a future decision to drop it is measured rather than
 * argued.
 *
 * ---------------------------------------------------------------------------
 * STANDARDISATION IS OVER THE WHOLE SET, NEVER OVER THE POOL
 * ---------------------------------------------------------------------------
 *
 * Means and standard deviations are computed once across all 1,025 `latest`
 * rows, so a species' vector is the SAME OBJECT whichever generation filter is
 * active. Recomputing per pool would make 「第一世代 困難」 and 「全部 困難」 two
 * different measurements, and the generation filter would silently change the
 * difficulty of every question in the round — §3.P's shape, a control that
 * changes something the reader was not told about.
 *
 * `cries.html` recomputes per set and that is correct there: it holds TWO sets
 * (`latest` and `legacy`) and a legacy vector standardised against latest's
 * statistics is not a measurement of anything. This page uses one set.
 *
 * ---------------------------------------------------------------------------
 * SEEDED DAILY: `mulberry32` RETURNS A GENERATOR, NOT A NUMBER
 * ---------------------------------------------------------------------------
 *
 * `daily-pick.js`'s `mulberry32(seed)` returns a generator function. Writing
 * `mulberry32(fnv1a(seed)) % n` is `function % n`, which is `NaN`, and
 * `pool[NaN]` is `undefined` — the round would come back full of `undefined`
 * ids and throw nothing at all. It has to be called, and its output consumed in
 * order. `game-similarity.js` records the same trap; it is repeated here because
 * this is a second implementation of the same idea and a reader of one will not
 * read the other.
 */

import { taipeiDateKey, fnv1a, mulberry32 } from './daily-pick.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ten questions per round, as the reference has. */
export const MAX_QUESTIONS = 10;

/** Four options per question: the answer plus three distractors. */
export const CHOICES = 4;

/**
 * The cry set. `false` = `assets/cries/latest/`, `true` = `legacy/`.
 *
 * ONE named constant rather than `legacy: false` written at six call sites, and
 * the reason is a stated plan rather than a guess: `legacy/` covers exactly the
 * 649 species of Gens I–V while `latest/` covers all 1,025, so a legacy toggle
 * is not a switch but a second measurement with a 649-row table, its own index,
 * and 376 species that have no legacy cry to play. Every page that would need it
 * reads this value, so turning it on is one edit here and one on the page — and
 * the checker reads it too, so a page that disagrees with the module says so.
 */
export const LEGACY_SET = false;

/** The key inside `cry_features.json` that `LEGACY_SET` selects. */
export const FEATURE_SET = LEGACY_SET ? 'legacy' : 'latest';

export const DIFFICULTIES = ['easy', 'hard', 'hell'];

export const DIFFICULTY_LABELS = {
  easy: '簡單',
  hard: '困難',
  hell: '地獄',
};

/**
 * One line of prose per tier, printed under the difficulty tabs.
 *
 * The numbers are the CEILINGS and they are the claim: 「沒有任何干擾者接近到
 * 0.35」 is a sentence the reader can check against the answer's own page in
 * cries.html, which is what makes it worth printing rather than 「比較簡單」.
 */
export const DIFFICULTY_NOTES = {
  easy: '三個干擾者都不太像，最接近的一隻也低於 0.35',
  hard: '三個干擾者都在 0.65 以下，遠比這隻安靜得多',
  hell: '直接拿音色最接近的三隻來冒充，沒有相似度上限',
};

/**
 * The maximum cosine similarity a distractor may have to the answer.
 *
 * `Infinity` is not a special case anywhere: the filter is `sim <= ceiling` and
 * that is true of every similarity. 地獄 is therefore the three nearest
 * neighbours, which is what it reads as.
 *
 * See the ceiling-vs-band section in the docblock for why these three numbers
 * and not a rank window.
 */
export const SIMILARITY_CEILING = {
  easy: 0.35,
  hard: 0.65,
  hell: Infinity,
};

/**
 * Seed prefix for the daily round. It shares a namespace with `daily-pick.js`
 * and `game-similarity.js` but uses a third prefix, so no two of the three daily
 * draws can collide: 今日推薦 is 「今天介紹誰」, the colour game is 「今天一題
 * 顏色」, and this is 「今天十題叫聲」. All three are called 今日 on one site.
 */
export const GAME_SEED = 'pokemon-crygame:';

/** Below this a pool cannot produce four distinct options, so it is refused. */
export const MIN_POOL = CHOICES;

// ---------------------------------------------------------------------------
// Score bands
// ---------------------------------------------------------------------------

/**
 * Bands over the CORRECT COUNT, not over a distance.
 *
 * There is no distance to band here: the player is not told how close their
 * answer was, because they picked one of four sprites and a 34-dimensional
 * distance is not a fact about how they did. §3.W's rule is the reason nothing
 * prints a percentage — a band over `correct / 10` is the whole of what is
 * knowable about a four-choice round.
 *
 * The boundaries are where a ten-question round visibly changes character, and
 * the last two are their own cases rather than the top of a ladder, because 9/10
 * and 10/10 read differently to a reader in a way that 7/10 and 8/10 do not.
 */
export const SCORE_BANDS = [
  { min: 10, label: '全部答對，你的耳朵是這個網站的一部分了' },
  { min: 9, label: '只差一題。回去再聽一次就會記住了' },
  { min: 7, label: '這副耳朵很靈，幾乎都認得出來' },
  { min: 5, label: '抓到一半了，剩下的多半是沒聽過的' },
  { min: 3, label: '開始聽得出差別了，前面幾題是運氣成分居多' },
  { min: 0, label: '耳朵還在熱身。全部 1,025 隻都在叫聲總覽裡等你' },
];

/**
 * @param {number} correct
 * @param {number} total
 * @returns {string}
 */
export function scoreBand(correct, total = MAX_QUESTIONS) {
  const n = Number(correct) || 0;
  for (const band of SCORE_BANDS) {
    if (n >= band.min) return band.label;
  }
  // Unreachable while SCORE_BANDS[0].min is 0, which it is — and that is the
  // point: a missing floor here would make `correct` of `NaN` print a label
  // instead of saying so.
  return '';
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/**
 * Build the standardised vectors once.
 *
 * @param {object} features the parsed `cry_features.json`
 * @param {string} setName 'latest' or 'legacy'
 * @returns {{ids:number[], dim:number, means:Float64Array, sds:Float64Array,
 *            vectors:Map<number,Float64Array>, at:Map<number,number>,
 *            setName:string}|null}
 *
 * `means` and `sds` are the RAW statistics in the table's own units, NOT the
 * standardised ones — a reader checking "is this standardised" against them will
 * find 2053.5 for `zcr` and conclude the module is broken. They are kept because
 * a caller may want to describe a species in real units, and because
 * `check_cry_game_similarity.mjs` needs them to re-derive a vector and confirm it
 * matches. The standardised answer is `vectors`.
 */
export function cryIndex(features, setName = FEATURE_SET) {
  const table = features && features[setName];
  if (!table || typeof table !== 'object') return null;

  const ids = Object.keys(table)
    .map(Number)
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);
  if (!ids.length) return null;

  // DIMENSIONS IS READ OUT OF THE TABLE rather than taken from
  // `features.dimensions`, and the first row is checked against both. A generated
  // file whose header says 34 while its rows hold 33 is exactly the defect
  // §3.K records, and reading the header would silently z-score a dimension that
  // is not there.
  const dim = ids.length ? (table[String(ids[0])] || []).length : 0;
  if (!dim) return null;

  const means = new Float64Array(dim);
  const sds = new Float64Array(dim);
  for (const id of ids) {
    const row = table[String(id)];
    if (!Array.isArray(row) || row.length !== dim) return null;
    for (let k = 0; k < dim; k++) means[k] += Number(row[k]) || 0;
  }
  for (let k = 0; k < dim; k++) means[k] /= ids.length;
  for (const id of ids) {
    const row = table[String(id)];
    for (let k = 0; k < dim; k++) sds[k] += ((Number(row[k]) || 0) - means[k]) ** 2;
  }
  for (let k = 0; k < dim; k++) sds[k] = Math.sqrt(sds[k] / ids.length) || 1;

  const vectors = new Map();
  ids.forEach((id, i) => {
    const row = table[String(id)];
    const z = new Float64Array(dim);
    for (let k = 0; k < dim; k++) z[k] = ((Number(row[k]) || 0) - means[k]) / sds[k];
    vectors.set(id, z);
  });

  const at = new Map();
  ids.forEach((id, i) => at.set(id, i));
  return { ids, dim, means, sds, vectors, at, setName, _matrix: null };
}

/**
 * The full n x n similarity matrix, built once and cached on the index.
 *
 * **This exists because ranking is the hot path for everything on this page.**
 * `neighbours()` is a dot product per pool member, so one round of ten questions
 * over the full dex was 10 x 1,024 x 34 = 348k multiply-adds, and every question
 * recomputed them from scratch. Measured: 357 ms to rank all 1,025 species once,
 * and 9.3 s for a checker that ranks the corpus about twenty times over.
 *
 * Caching turns each of those into an array read. The cost is memory —
 * `n^2 * 8` bytes, **8.4 MB at 1,025** — which is why it is Float64 rather than
 * Float32: Float32 carries ~7 significant digits, so exact ties would be
 * manufactured by rounding and `neighbours()`'s tie-break would be deciding the
 * order of pairs that are not actually equal. The total order the daily round
 * depends on would become an artefact of the storage type.
 *
 * Built lazily, so a caller that only ever wants `similarity()` never pays for
 * it, and built on FIRST `neighbours()` rather than in `cryIndex()` so an index
 * that is built but never queried — the checker's malformed-table cases — costs
 * nothing.
 */
function similarityMatrix(index) {
  if (index._matrix) return index._matrix;
  const n = index.ids.length;
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    M[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = similarity(index, index.ids[i], index.ids[j]);
      M[i * n + j] = s;
      M[j * n + i] = s;
    }
  }
  index._matrix = M;
  return M;
}

/**
 * Cosine similarity between two standardised vectors, weights all 1.
 *
 * **Weights are all 1 on purpose.** `cries.html` offers three named weight
 * presets — 明亮偏重 / 沙啞偏重 and so on — and this module deliberately has no
 * preset picker: a question's difficulty is measured against one fixed metric,
 * and a metric that changes mid-round would make every ceiling in
 * `SIMILARITY_CEILING` mean something different from one question to the next.
 * Which means a reader who wants 明亮偏重 gets it in cries.html, not here.
 *
 * Cosine is symmetric by construction, so there is no `forward`/`reverse` pair
 * to compute — contrast `game-similarity.js`'s `paletteDistance()`, where the
 * asymmetry of two differently-sized palettes is real and `reverse` exists for
 * it.
 *
 * @returns {number} 0..1, or `NaN` if either id is not in the index
 */
export function similarity(index, a, b) {
  if (!index) return NaN;
  const va = index.vectors.get(a);
  const vb = index.vectors.get(b);
  if (!va || !vb) return NaN;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < index.dim; k++) {
    dot += va[k] * vb[k];
    na += va[k] * va[k];
    nb += vb[k] * vb[k];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : NaN;
}

/**
 * Pool size at which building the matrix is cheaper than recomputing pairs.
 *
 * Building costs `n^2 / 2` dot products. One ranking over a pool of `P` costs
 * `P * n * dim`. Break-even is `P = n / (2 * dim)`, which at n = 1,025 and
 * dim = 34 is **about 15**. So a caller ranking a four-member pool — a
 * fixture, a checker edge case — gets the direct path and never pays 8.4 MB,
 * while anything page-sized gets the cache.
 *
 * Exported because the checker asserts the two paths AGREE on both sides of this
 * number, which is the only way a caching decision like this can be anything but
 * a belief.
 */
export const MATRIX_BREAK_EVEN = 16;

/**
 * Every other pool member, ranked by similarity to `id`, closest first.
 *
 * Goes through the cached matrix when the pool is large enough to have paid for
 * it, and computes each pair when it is not — so this function is the only
 * ranking in the module and the two paths cannot disagree about what a
 * similarity is.
 *
 * **Ties break on ascending id, and that is the contract rather than a
 * convenience.** The strict `<` is what makes the list a total order; a `<=`
 * would make the order depend on the engine's sort, and a seeded daily round
 * would then be reproducible only on one of them.
 *
 * @param {object} index
 * @param {number} id
 * @param {number[]} pool
 * @returns {Array<{id:number, sim:number}>} `id` itself is excluded
 */
export function neighbours(index, id, pool) {
  if (!index) return [];
  const members = pool || [];
  const i = index.at.get(id);
  if (i == null) return [];

  let M = null;
  if (members.length >= MATRIX_BREAK_EVEN) M = similarityMatrix(index);
  // NOTE: no `else if (index._matrix)` here. An earlier version fell back to the
  // cache for small pools once it existed, which meant the DIRECT path was only
  // ever taken before the first large ranking — so the checker's "both paths
  // agree" assertion was comparing the cache with itself for most of its
  // samples. The threshold is now the only thing that decides, which is what
  // makes the two paths separately testable at all.

  const n = index.ids.length;
  const list = [];
  for (const other of members) {
    if (other === id) continue;
    const j = index.at.get(other);
    const sim = M && j != null ? M[i * n + j] : similarity(index, id, other);
    if (!Number.isFinite(sim)) continue;
    list.push({ id: other, sim });
  }
  list.sort((a, b) => (b.sim - a.sim) || (a.id - b.id));
  return list;
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/**
 * Generation -> ids, derived from `pokemon_data.json`'s `generation` field.
 *
 * Generation ranges are not written down: `game-similarity.js` records why (the
 * reference hardcoded `GEN_RANGES` because its own table has no generation
 * column) and §3.K records a version of the resulting staleness.
 *
 * Only ids the index actually holds are returned, so the pool is always a
 * subset of playable species — without that, a generation whose data drifted
 * would produce questions whose options have no cry and the page would 404 on
 * click.
 *
 * @returns {Map<number, number[]>}
 */
export function genIdMap(data, index) {
  const playable = index ? new Set(index.ids) : null;
  const map = new Map();
  for (const p of data || []) {
    const g = Number(p && p.generation);
    if (!Number.isFinite(g) || g < 1) continue;
    if (playable && !playable.has(p.id)) continue;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(p.id);
  }
  for (const ids of map.values()) ids.sort((a, b) => a - b);
  return map;
}

/** Every playable species, ascending. */
export function allIds(index) {
  return index ? index.ids.slice() : [];
}

/**
 * The pool a round draws from.
 *
 * `gen === 0` is 「全部」, the default, and it is the ONLY value that means
 * that. A negative generation returns an EMPTY pool rather than the whole dex:
 * `Number(-1) || 0` is `-1`, which is truthy, so a single `|| 0` guard sends
 * every negative value to 「全部」 — a typo in the generation chip's `data-gen`
 * would silently widen the pool to 1,025 while the tab still said 第X世代.
 * Empty is the answer that makes the mistake visible.
 *
 * **`data` is a required argument and not an optional third one.** The first
 * draft made it optional and filtered the pool from `index.ids` alone, which
 * cannot work: the index holds NO generation field, so every id fell through the
 * `Number.isFinite(g)` guard in `genIdMap` and every generation came back as an
 * empty list — 全部 worked and all nine filters produced no questions, with
 * nothing thrown.
 *
 * @returns {number[]} `[]` when the generation does not exist
 */
export function poolFor(index, data, gen = 0) {
  const g = Number(gen);
  if (g === 0) return allIds(index);
  if (!Number.isFinite(g) || g < 1) return [];
  return genIdMap(data, index).get(Math.floor(g)) || [];
}

/**
 * Every generation the index can actually answer for, ascending.
 *
 * Derived rather than `1..9` written down, so a generation whose rows are all
 * missing does not get a tab that produces an empty pool. This is the same list
 * the page's chips are built from, which is why it is here rather than written
 * into the HTML: a tab list and the pool filter that has to agree with it are
 * one value, not two.
 */
export function availableGenerations(index, data) {
  return [...genIdMap(data, index).keys()].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------

/**
 * Build one question about a GIVEN answer: three distractors, and the option
 * order.
 *
 * The answer is an argument rather than drawn here, and that is what lets
 * `buildRound` guarantee ten DISTINCT answers. The first draft passed the
 * answer in as part of the pool and let this function pick it at random — so
 * `buildRound`'s splice, the entire mechanism behind "ten different Pokémon",
 * was undone by the very next call.
 *
 * The distractors are the three nearest neighbours that clear the tier's
 * ceiling; if fewer than three clear it, the three nearest overall are used and
 * `degraded` is set. **The degraded branch is measured not to run** — zero
 * occurrences across all ten pools x three tiers x every species — and it is
 * kept because a caller may hand in a four-member pool. `degraded` is returned
 * rather than logged so a checker can assert the count is zero instead of
 * asserting a log line is absent.
 *
 * The four options are then SHUFFLED with `rand`, so the answer's position
 * carries no information. Appending the answer would make it always last, and
 * the reference's `l1(names)` shuffle exists for that reason.
 *
 * @param {object} index
 * @param {number} answer
 * @param {number[]} candidatePool  the distractors' pool; `answer` is excluded
 * @param {string} difficulty
 * @param {() => number} rand
 * @returns {{answer:number, options:number[], distractorSims:number[],
 *            hardestSim:number, ceiling:number, degraded:boolean}|null}
 */
export function buildQuestion(index, answer, candidatePool, difficulty, rand = Math.random) {
  const ceiling = SIMILARITY_CEILING[normalizeDifficulty(difficulty)];
  if (!index || !index.vectors.has(answer)) return null;
  const ids = (candidatePool || []).filter((id) => id !== answer && index.vectors.has(id));
  if (ids.length < CHOICES - 1) return null;

  const ranked = neighbours(index, answer, ids);
  const clearing = ranked.filter((r) => r.sim <= ceiling);
  const degraded = clearing.length < CHOICES - 1;
  const distractors = degraded ? ranked.slice(0, CHOICES - 1) : clearing.slice(0, CHOICES - 1);
  if (distractors.length < CHOICES - 1) return null;

  const options = distractors.map((d) => d.id).concat(answer);
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = options[i];
    options[i] = options[j];
    options[j] = tmp;
  }

  return {
    answer,
    options,
    distractorSims: distractors.map((d) => d.sim),
    hardestSim: Math.max(...distractors.map((d) => d.sim)),
    ceiling,
    degraded,
  };
}

// ---------------------------------------------------------------------------
// A round
// ---------------------------------------------------------------------------

/**
 * Ten questions with ten DISTINCT ANSWERS, and no species ever appears twice in
 * a round.
 *
 * Distinct answers are the reference's rule and it is a good one: with
 * replacement, a round could ask the same Pokémon twice and the second time the
 * player would answer from memory of the first rather than from the cry, so a
 * 10-question round would measure fewer than ten recognitions.
 *
 * **ALL TEN ANSWERS ARE DRAWN BEFORE ANY QUESTION IS BUILT, and that ordering is
 * the fix for a defect the checker found.** The first version shrank the pool as
 * it went — draw an answer, remove it, build the question from what was left —
 * which enforces "a distractor is never an answer asked SO FAR" but not "never
 * an answer LATER ON". Measured over 200 rounds: 17–35 options per tier were a
 * species the round would ask about two questions later, so a reader could meet
 * X as a wrong option in Q7 and then be asked to identify X by ear in Q8. The
 * second question is then partly a memory test of the first.
 *
 * Drawing the whole answer set up front makes the candidate pool for every
 * question `pool` minus all ten answers, and the leak is impossible by
 * construction rather than by ordering.
 *
 * The cost is that each question draws from a pool ten smaller, so the ceiling
 * has less room. **Measured after the change: still 0 degraded questions across
 * all ten pools x three tiers x every species**, and the tightest generation
 * (第六世代, 72 members) has 62 candidates per question.
 *
 * A question that cannot be built puts its answer BACK and the round is one
 * shorter, so a four-member pool yields one question rather than ten claimed and
 * nine empty.
 *
 * @returns {Array} up to `MAX_QUESTIONS` questions
 */
export function buildRound(index, pool, difficulty, rand = Math.random) {
  const members = (pool || []).filter((id) => index && index.vectors.has(id));
  if (members.length < MIN_POOL) return [];

  // Draw up to MAX_QUESTIONS distinct answers up front. A Fisher-Yates partial
  // shuffle rather than a splice loop: both give distinct members, but the
  // shuffle consumes one `rand()` per position regardless of pool size, so a
  // round drawn from 1,025 and a round drawn from 72 take the same number of
  // values off the generator. The splice version's consumption depends on the
  // pool, which would have made a seeded round's questions depend on pool size.
  const order = members.slice();
  for (let i = 0; i < order.length && i < Math.min(MAX_QUESTIONS, members.length - CHOICES + 1); i++) {
    const j = i + Math.floor(rand() * (order.length - i));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const answers = order.slice(0, Math.min(MAX_QUESTIONS, Math.max(0, members.length - CHOICES + 1)));
  const answerSet = new Set(answers);

  // Every question draws from the pool with the WHOLE answer set removed.
  const candidates = members.filter((id) => !answerSet.has(id));

  const out = [];
  for (const answer of answers) {
    const q = buildQuestion(index, answer, candidates, difficulty, rand);
    if (q) out.push(q);
  }
  return out;
}

/**
 * The daily round: same Taipei day + same difficulty + same generation filter ->
 * byte-identical questions, for every reader.
 *
 * The generator is CONSUMED IN ORDER, so the round depends on the whole draw
 * sequence rather than on any one value — which is what makes the four options of
 * question 7 move when question 3's answer changes.
 *
 * **The generation filter is IN THE SEED, and not only in the pool.** Pooling is
 * not enough: the two pools are disjoint id sets only while they differ in
 * SIZE, and a filter change that produced the same size would then draw the same
 * round. §3.B2's shape — a check that can only fail by accident. So the filter
 * appears in the seed string exactly as it appears in the store key.
 *
 * The day is Taipei's (`taipeiDateKey`), not UTC's, for the reason
 * `daily-pick.js` records: with a UTC day this page's round would roll over at
 * 08:00 while the homepage's 今日推薦 would not, and both are called 今日 on one
 * site.
 *
 * @param {object} index
 * @param {number[]} pool
 * @param {string} difficulty
 * @param {number} gen  0 for 全部
 * @param {string} [dateKey]  omit for today
 */
export function buildDailyRound(index, pool, difficulty, gen = 0, dateKey = taipeiDateKey(new Date())) {
  const rand = mulberry32(fnv1a(
    `${GAME_SEED}${normalizeDifficulty(difficulty)}:${Number(gen) || 0}:${dateKey}`
  ));
  return buildRound(index, pool, difficulty, rand);
}

// ---------------------------------------------------------------------------
// The one hint
// ---------------------------------------------------------------------------

/**
 * Which option the hint removes: one of the three WRONG ones, never the answer.
 *
 * A hint that could remove the answer is a hint that makes the question
 * unanswerable, and `null` here — rather than a fallback index — is what lets
 * the page say 「這一題沒有可排除的選項」 instead of disabling something for no
 * stated reason.
 *
 * @returns {number|null} an index into `question.options`, or null
 */
export function eliminateIndex(question, rand = Math.random) {
  if (!question || !Array.isArray(question.options)) return null;
  const wrong = [];
  for (let i = 0; i < question.options.length; i++) {
    if (question.options[i] !== question.answer) wrong.push(i);
  }
  if (!wrong.length) return null;
  return wrong[Math.floor(rand() * wrong.length)];
}

// ---------------------------------------------------------------------------
// Scoring a finished round
// ---------------------------------------------------------------------------

/**
 * How many of `picks` match their question's answer.
 *
 * `picks[i]` is `null`/`undefined` for a question that was never answered, and
 * that counts as WRONG rather than being skipped — the reference's result page
 * renders an unanswered question exactly like a correct one, because the correct
 * option is green either way, and the score is the only place the difference
 * shows. Counting a missing pick as neither would let a player who quit early
 * report a perfect score.
 *
 * @param {Array<{answer:number}>} questions
 * @param {Array<number|null>} picks
 * @returns {{correct:number, total:number, band:string}}
 */
export function scoreRound(questions, picks) {
  const total = (questions || []).length;
  let correct = 0;
  for (let i = 0; i < total; i++) {
    const q = questions[i];
    const pick = (picks || [])[i];
    if (q && pick != null && pick === q.answer) correct++;
  }
  return { correct, total, band: scoreBand(correct, total) };
}

/**
 * The shareable string.
 *
 * **A row of ten emoji, a count, and a legend.** Every other game on this site
 * prints a share block, and the temptation is to add the difficulty, the date, a
 * streak and a link. The emoji row is the part a reader compares against someone
 * else's; everything around it is text they can already see on screen.
 *
 * The date is in it because 「今天」 only means something with one.
 *
 * @param {{questions?:Array, picks?:Array, mode?:string, difficulty?:string,
 *          gen?:number, dateKey?:string}} [state]
 * @returns {string}
 */
export function shareText(state) {
  const questions = (state && state.questions) || [];
  const picks = (state && state.picks) || [];
  const cells = questions.map((q, i) => {
    const pick = picks[i];
    return pick != null && q && pick === q.answer ? '🟩' : '🟥';
  });
  const { correct, total } = scoreRound(questions, picks);
  const dateKey = (state && state.dateKey) || taipeiDateKey(new Date());
  const head = `叫聲猜謎 ${dateKey} · ${DIFFICULTY_LABELS[normalizeDifficulty(state && state.difficulty)]}`;
  const scope = state && state.mode === 'unlimited'
    ? '無限模式'
    : `${Number(state && state.gen) > 0 ? `第${Number(state.gen)}世代` : '全部世代'}`;
  return `${head}（${scope}）\n${cells.join('')}\n${correct} / ${total}\n\n🟩 答對　🟥 答錯`;
}

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

export function isDifficulty(value) {
  return DIFFICULTIES.indexOf(value) >= 0;
}

/** An unrecognised tier falls back to `easy`, which is the first-visit default. */
export function normalizeDifficulty(value) {
  return isDifficulty(value) ? value : 'easy';
}

/**
 * A generation filter: `0` is 「全部」, 1..9 are the generations, and anything
 * else — a hand-edited localStorage, an older version's value, a generation this
 * corpus does not have — falls back to `0`.
 *
 * The fallback is `0` and not `1` because the DEFAULT round is the whole dex.
 * Falling back to 第一世代 would mean a first visit gets a 151-member pool while
 * every button in the UI says 全部.
 *
 * **`available` is REQUIRED, and that is the whole reason it is listed first in
 * the docblock.** It was optional, so `normalizeGeneration(99)` returned 99 — a
 * filter the corpus cannot satisfy — and the range check silently did nothing
 * for any caller that left it off. A normaliser whose correctness depends on an
 * argument a caller may not pass is a trap, and the page has exactly one call
 * site so the compiler had no chance to complain. `availableGenerations()` is
 * the source; writing the nine generations down here instead would be a second
 * source of truth that goes stale (§3.K).
 *
 * @param {*} value
 * @param {number[]} available  ascending, from `availableGenerations()`
 */
export function normalizeGeneration(value, available) {
  const list = Array.isArray(available) ? available : [];
  const g = Number(value);
  if (!Number.isFinite(g) || g < 1) return 0;
  const gen = Math.floor(g);
  if (list.length && list.indexOf(gen) < 0) return 0;
  return gen;
}

export { taipeiDateKey, fnv1a, mulberry32 };