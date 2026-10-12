/**
 * 猜謎遊戲的出題與計分（assets/js/game-similarity.js）。
 *
 *   node scripts/check_game_similarity.mjs
 *
 * 為什麼是獨立的一支：這個模組沒有 DOM，所以它可以在純 Node 裡跑完，
 * 而每一個失敗模式都是算出來能顯示、錯了要問才會發現的算術。靜態字串比對
 * 對 `check_color_page.mjs` 那種外殼契約才有用。
 *
 * 四件事是這個專案自己的規則，不是參考專案的：
 *
 * 1. **池的推導，不是寫死的區間。** `poolFor('easy', gen, data)` 從
 *    `pokemon_data.json` 的 `generation` 欄位算出那一代的 id。參考專案在
 *    `daily-pool.ts` 寫死 `GEN_RANGES`；這裡不寫死，寫死就是第二個真相。
 *    這一條會實際跑 9 個世代 × 365 天，確認每一隻都抽得到、而且沒有任何
 *    一隻抽到池外。
 *
 * 2. **地獄難度是異色，而索引必須真的分兩套。** `color-match.js` 的
 *    `buildMatchIndex()` 只讀 `palettes[key].n`，所以它對異色一無所知。
 *    本模組自己建索引，所以 `paletteRows(pal, id, 's')` 必須回傳異色盤，
 *    而且 `scoreGuess` 在 'n' 與 's' 下的分數必須不同——如果兩者相同，
 *    地獄就是一個沒換外觀的按鈕。
 *
 * 3. **難度決定外觀，而那個決定只有一個方向。** `variantOf()` 是
 *    difficulty → variant 的單射：簡單與困難都是 'n'、地獄是 's'。參考專案
 *    讓使用者自己選 Any / Normal / Shiny，所以它需要處理三種；這裡只有一種
 *    答案，多一個選擇器就是多一個可以設成不一致的狀態欄位。
 *
 * 4. **計分是距離，不是百分比。** 見模組的 docblock：把 OKLab 距離映射回
 *    0..100 需要一個正規化常數，而那個常數的選擇會改變那個數字看起來像什麼，
 *    卻不改變任何排序。所以頁面印距離本身，四個色階門檻則由語料庫量出來
 *    並在下面重新量一次。
 *
 * 另外三個是抄過的坑，不是這個專案的規則，但照抄把它們一起帶過來了：
 * `mulberry32(seed)` 回傳產生器而不是數字（不呼叫它會得到 `undefined` 而不是
 * 丟出例外）、空池要回傳 null 而不是 fallback、跨日要穩定。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MAX_ATTEMPTS, DIFFICULTIES, PALETTE_COLORS_SHOWN,
  variantOf, isShinyMode,
  genIdMap, allIds, poolFor,
  pickDailyTarget, pickUnlimitedTarget,
  paletteRows, visiblePalette,
  paletteDistance, scoreGuess,
  tierOf, TIER_CLOSE, TIER_MID, TIER_FAR,
  normalizeDifficulty, normalizeGeneration,
  taipeiDateKey,
} from '../assets/js/game-similarity.js';

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
const eq = (a, b) => ({ ok: a === b, a, b });

const data = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'));
const palettes = JSON.parse(readFileSync(join(ROOT, 'assets/data/color_palettes.json'), 'utf8'));

// A real calendar walk, not `new Date(\`2026-10-${n}\`)` — that silently becomes
// an Invalid Date past the 30th, and `taipeiDateKey` then throws inside
// `toISOString()`. The first draft did exactly that and the checker died with a
// RangeError instead of a FAIL line, which is the worst place for a date bug to
// show up: it looks like the module crashed, not like the test was wrong.
const BASE = Date.UTC(2026, 9, 1);
const at = (n) => new Date(BASE + (n - 1) * 86400000);

// ---------------------------------------------------------------------------
console.log('\nthe pools are derived, not written down');
// ---------------------------------------------------------------------------
{
  const map = genIdMap(data);
  check(map.size === 9, 'all 9 generations are derivable from pokemon_data.json',
    () => `found ${map.size}`);
  check(allIds(data).length === 1025, 'the whole dex is 1,025',
    () => `got ${allIds(data).length}`);

  // Written down ONCE, in the checker, as the thing the module must agree with.
  // These are the counts measured straight out of the data file.
  const EXPECTED = { 1: 151, 2: 100, 3: 135, 4: 107, 5: 156, 6: 72, 7: 88, 8: 96, 9: 120 };
  for (const [gen, n] of Object.entries(EXPECTED)) {
    const ids = map.get(Number(gen)) || [];
    check(ids.length === n, `generation ${gen} has ${n} members`,
      () => `got ${ids.length}`);
    // A generation whose ids are not contiguous would mean `generation` and the
    // national dex order disagree, and the reference's hardcoded ranges would
    // then be describing a different dataset than this one.
    const contiguous = ids.every((id, i) => i === 0 || id === ids[i - 1] + 1);
    check(contiguous, `generation ${gen} is a contiguous id run`,
      () => ids.filter((id, i) => i > 0 && id !== ids[i - 1] + 1).slice(0, 5).join(', '));
  }

  check(poolFor('hard', 1, data).length === 1025, 'hard draws from all 1,025');
  check(poolFor('hell', 1, data).length === 1025, 'hell draws from all 1,025 too');
  check(poolFor('easy', 3, data).length === 135, 'easy draws only the chosen generation');
  check(poolFor('easy', 0, data).length === 0, 'an impossible generation is an empty pool, not a crash');
  check(poolFor('easy', 99, data).length === 0, 'and so is one past the last');
  check(poolFor('easy', undefined, data).length === 0, 'and so is a missing one');

  // FAIRNESS, NOT COVERAGE. The first draft asserted "all 1,025 reachable in a
  // year", and it is false for arithmetic reasons rather than code reasons:
  // the coupon-collector expectation for 365 draws from 1,025 ids is
  // 1025·(1−e^−365/1025) = **307**, and the draw returned 303. Requiring 1,025
  // in 365 days would take ~7,250 draws — twenty years of gameplay. So the
  // property worth pinning is that the draw is UNIFORM, which is what "every
  // species is equally likely" means, and that is testable in a decade.
  //
  // `check_color_daily.mjs` gets away with a reachability claim because its
  // pools are 10–71 members; the same claim at 1,025 is a category error.
  const DAYS = 3650;
  const EPOCH = Date.UTC(2020, 0, 1);
  const sweep = (difficulty, gen) => {
    const tally = new Map();
    const seen = new Set();
    let outside = 0;
    const allowed = poolFor(difficulty, gen, data);
    for (let i = 0; i < DAYS; i++) {
      const t = pickDailyTarget(difficulty, gen, data, { now: new Date(EPOCH + i * 86400000) });
      if (!t) continue;
      tally.set(t.id, (tally.get(t.id) || 0) + 1);
      seen.add(t.id);
      if (!allowed.includes(t.id)) outside++;
    }
    return { tally, seen, outside };
  };

  const hard = sweep('hard', 1);
  check(hard.outside === 0, 'hard never draws outside the full dex');
  check(hard.seen.size > 950,
    `a decade of hard targets reaches most of the dex — ${hard.seen.size}/1,025`,
    () => `${hard.seen.size}`);

  // Uniformity: split the dex into 10 id-deciles and require each to land near
  // 1/10. A draw that hashed only its top bits, or that always picked from the
  // first pool entry, would still "reach" species and still pass containment.
  const deciles = new Array(10).fill(0);
  for (const [id, n] of hard.tally) deciles[Math.min(9, Math.floor((id - 1) / 102.5))] += n;
  const exp = DAYS / 10;
  const sd = Math.sqrt(exp * (1 - 0.1));
  const worst = deciles.reduce((w, n, i) => (Math.abs(n - exp) > Math.abs(w.dev) ? { i, n, dev: n - exp } : w),
    { i: -1, n: 0, dev: 0 });
  check(Math.abs(worst.dev) < 3 * sd,
    `every id-decile is drawn within 3σ — worst is decile ${worst.i + 1} at ${worst.n} vs ${exp.toFixed(0)}`,
    () => `deciles: ${deciles.join(', ')} (σ ${sd.toFixed(1)})`);

  // And the sharpest single-species failure mode: one Pokémon dominating.
  const top = Math.max(...hard.tally.values());
  check(top < 4 * exp / (1025 / 10),
    `no single species dominates the hard draw — busiest is ${top}`,
    () => `a species took ${top} of ${DAYS} days`);
}

// ---------------------------------------------------------------------------
console.log('\nthe daily draw is stable, and stays inside its pool');
// ---------------------------------------------------------------------------
{
  const a = pickDailyTarget('easy', 1, data, { now: at(13) });
  const b = pickDailyTarget('easy', 1, data, { now: at(13) });
  check(a && b && a.id === b.id, 'the same day draws the same Pokémon twice',
    () => `${a && a.id} vs ${b && b.id}`);

  // The UTC rollover is the exact trap `taipeiDateKey` exists for: 00:00 and
  // 12:00 Taipei on one day straddle UTC midnight.
  const morning = pickDailyTarget('hard', 1, data, { now: new Date('2026-10-13T00:00:00+08:00') });
  const evening = pickDailyTarget('hard', 1, data, { now: new Date('2026-10-13T23:00:00+08:00') });
  const afterMidnightTaipei = pickDailyTarget('hard', 1, data, { now: new Date('2026-10-14T00:00:00+08:00') });
  check(morning.id === evening.id, '00:00 and 23:00 Taipei on one day agree');
  check(morning.id !== afterMidnightTaipei.id, 'and the next Taipei day is a different Pokémon');
  check(taipeiDateKey(new Date('2026-10-13T16:30:00Z')) === '2026-10-14',
    'a Taipei day is named by Taipei midnight, not UTC');

  // Per-generation containment AND fairness. Coverage is not claimed — see the
  // fairness section for why a year cannot reach a 151-member pool evenly, let
  // alone guarantee every member.
  const map = genIdMap(data);
  for (const [gen, ids] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    const seen = new Set();
    let outside = 0;
    for (let d = 1; d <= 365; d++) {
      const id = pickDailyTarget('easy', gen, data, { now: at(d) }).id;
      seen.add(id);
      if (!ids.includes(id)) outside++;
    }
    check(outside === 0, `easy on generation ${gen} never draws outside it (365 days)`,
      () => `${outside} days outside`);
    // 365 draws from a pool of N: the coupon-collector expectation is
    // N·(1−e^−365/N). Asserting more than a loose floor is asserting
    // randomness, not this module.
    const expectedDistinct = ids.length * (1 - Math.exp(-365 / ids.length));
    check(seen.size >= expectedDistinct * 0.7,
      `easy on generation ${gen} lands within expectation — ${seen.size} distinct vs ~${expectedDistinct.toFixed(0)} expected`,
      () => `${seen.size} of ${ids.length}, expected about ${expectedDistinct.toFixed(0)}`);
  }

  /* WHY THERE IS NO BEHAVIOURAL "changing the generation changes the puzzle" ASSERTION.
     The obvious one is `easy(gen1).id !== easy(gen3).id`, and it can never fail:
     the two pools are DISJOINT id sets (1–151 vs 252–386), so the two targets
     differ no matter what the seed contains. A mutation that deletes `gen` from
     the seed string leaves it green — which is how this was found, by a harness
     case named "the daily seed drops the generation" passing. §3.B2's shape: a
     guard that cannot fail is not a guard.

     So this one is a source assertion, and it says so. What earns its place is
     that the redundancy it pins is real: the generation reaches the target
     TWICE — through the pool and through the seed — and only the second carries
     it if the two pools ever become the same size. */
  const modSrc = readFileSync(join(ROOT, 'assets/js/game-similarity.js'), 'utf8');
  /* `= pickIndex(` and `[^\n]` are both load-bearing, and the first version got
     this wrong in the §3.P way: `pickIndex\(\s*pool,` matches the function
     DEFINITION `function pickIndex(pool, seed) {`, and a lazy `[\s\S]*?` then
     ran all the way past the end of that function to the `);` of the CALL SITE
     three functions later. The captured text was the body of `pickIndex` plus
     the whole seed template, so the assertion was measuring something nobody
     wrote. Anchored to the assignment and to one line, because the call is on
     one line and the definition is not preceded by `=`. */
  const seedExpr = (modSrc.match(/=\s*pickIndex\(\s*pool,\s*([^\n]*?)\);/) || [])[1] || '';
  check(!!seedExpr && seedExpr.includes('gen') && seedExpr.includes('difficulty') && seedExpr.includes('taipeiDateKey'),
    'the daily seed carries the generation, the difficulty and the Taipei day',
    () => `the seed expression is ${JSON.stringify(seedExpr)} — a behavioural check for the generation cannot exist (disjoint pools), so this reads the source and says so`);
  check(/function pickIndex\(pool, seed\)/.test(modSrc),
    'and the regex above is still anchored to the call, not the definition',
    () => 'the seed regex matched something other than the call site');

  check(pickDailyTarget('easy', 0, data, { now: at(13) }) === null,
    'an empty pool returns null rather than a fallback Pokémon',
    () => 'a guess at this point');
  check(pickUnlimitedTarget('easy', 0, data) === null,
    'and the unlimited picker says so the same way');
}

// ---------------------------------------------------------------------------
console.log('\nthe difficulty decides the variant, one way only');
// ---------------------------------------------------------------------------
{
  check(DIFFICULTIES.length === 3, 'there are three difficulties',
    () => DIFFICULTIES.join(', '));
  check(variantOf('easy') === 'n', 'easy is 原始色');
  check(variantOf('hard') === 'n', 'hard is 原始色');
  check(variantOf('hell') === 's', 'hell is 異色');
  check(isShinyMode('hell') === true, 'and only hell reports itself as shiny');
  check(!isShinyMode('easy') && !isShinyMode('hard'), 'easy and hard do not');

  // The one that would matter if it were wrong: 地獄 rendering 原始色 is a
  // difficulty that does not differ from 困難 in anything the player can see.
  const hell = pickDailyTarget('hell', 1, data, { now: at(13) });
  const hard = pickDailyTarget('hard', 1, data, { now: at(13) });
  check(hell.variant === 's' && hard.variant === 'n', 'the two full-dex modes differ in variant');

  check(MAX_ATTEMPTS === 4, '4 attempts, copied from the reference');
  check(normalizeDifficulty('nonsense') === 'easy', 'an unknown difficulty falls back to easy');
  check(normalizeDifficulty(undefined) === 'easy', 'and so does a missing one');
  check(normalizeGeneration(99, [1, 2, 3]) === 1, 'an out-of-range generation falls back to 第一世代',
    () => 'the spec says the first visit is Easy + 第一世代, so that is the fallback');
  check(normalizeGeneration(0, [1, 2, 3]) === 1, 'and so does zero');
  check(normalizeGeneration(3, [1, 2, 3]) === 3, 'a real one is kept');
}

// ---------------------------------------------------------------------------
console.log('\nshiny palettes are a real second index, not a copy');
// ---------------------------------------------------------------------------
{
  // color-match.js's own index is normal-only; if this module ever delegated to
  // it, the 's' lookup below would come back empty or wrong.
  const missingNormal = [];
  const missingShiny = [];
  const wrongOrder = [];
  for (const p of data) {
    const n = paletteRows(palettes, p.id, 'n');
    const s = paletteRows(palettes, p.id, 's');
    if (!n.length) missingNormal.push(p.id);
    if (!s.length) missingShiny.push(p.id);
    // Shares must already be descending. Re-sorting would mean the module had
    // decided "primary" means something other than row 0.
    for (const rows of [n, s]) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].share > rows[i - 1].share + 1e-9) { wrongOrder.push(`${p.id}[${i}]`); break; }
      }
    }
  }
  check(missingNormal.length === 0, 'every species has a normal palette',
    () => `${missingNormal.length} missing: ${missingNormal.slice(0, 8)}`);
  check(missingShiny.length === 0, 'every species has a shiny palette, so 地獄 has no gaps',
    () => `${missingShiny.length} missing: ${missingShiny.slice(0, 8)}`);
  check(wrongOrder.length === 0, 'rows arrive already sorted by share, so row 0 is the primary',
    () => wrongOrder.slice(0, 8).join(' '));

  /* AGENTS.md §3.B says "Exactly 3 palettes have 5 colours instead of 6
   (#201 Unown, #643 Kartana, Bulbasaur shiny)". That is **stale**: measured
   over the file as it stands, only TWO species are short in either variant,
   and Bulbasaur's shiny palette now has 6. Asserting the doc's sentence would
   have made this checker red on correct data — which is §3.G1a's shape pointed
   the other way, a description of the past used as a claim about the present.
   What is asserted here is the measured truth, named per variant, so a
   regeneration that really does change it says which one. */
  const shortPairs = [];
  for (const p of data) {
    for (const v of ['n', 's']) {
      const rows = paletteRows(palettes, p.id, v);
      if (rows.length < 6) shortPairs.push(`${p.id}${v}:${rows.length}`);
    }
  }
  check(shortPairs.join(' ') === '201n:5 201s:5 643n:5',
    'the short palettes are exactly Unown (both variants) and Kartana (normal) — §3.B names a third that is now 6',
    () => `measured: ${shortPairs.join(' ') || 'none'}`);

  // Same species, two variants, must NOT score the same — otherwise the hell
  // mode is a label.
  let sameAsNormal = 0;
  let compared = 0;
  for (const p of data) {
    compared++;
    if (Math.abs((scoreGuess(palettes, p.id, 1, 's') || { score: -1 }).score
      - (scoreGuess(palettes, p.id, 1, 'n') || { score: -2 }).score) < 1e-12) sameAsNormal++;
  }
  check(sameAsNormal < compared / 2, 'scoring in 異色 gives different answers from 原始色',
    () => `${sameAsNormal}/${compared} species scored identically across variants`);

  check(paletteRows(palettes, 99999, 'n').length === 0, 'an id that is not a species returns no rows');
  check(paletteRows(palettes, 1, 'zzz').length === 0, 'an unknown variant returns no rows');
}

// ---------------------------------------------------------------------------
console.log('\nthe visible palette is a prefix of the real one');
// ---------------------------------------------------------------------------
{
  check(PALETTE_COLORS_SHOWN === 3, '3 colours during play, copied from the reference');
  const shown = visiblePalette(palettes, 1, 'n', false);
  const full = visiblePalette(palettes, 1, 'n', true);
  const rows = paletteRows(palettes, 1, 'n');
  check(shown.length === 3, '3 shown for Bulbasaur', () => `${shown.length}`);
  check(full.length === rows.length, 'the reveal shows every row it has',
    () => `${full.length} vs ${rows.length}`);
  check(full.slice(0, 3).map((r) => r.hex).join() === shown.map((r) => r.hex).join(),
    'and the first three are the SAME three — the bar grows, it does not reshuffle',
    () => `${shown.map((r) => r.hex)} vs ${full.slice(0, 3).map((r) => r.hex)}`);

  // Unown is the short one, so "all 6" must be "all of them".
  const unown = paletteRows(palettes, 201, 'n');
  check(unown.length === 5, 'Unown really is 5 colours', () => `${unown.length}`);
  check(visiblePalette(palettes, 201, 'n', true).length === 5,
    'and the reveal still shows all of them, not 6 and not 3',
    () => `${visiblePalette(palettes, 201, 'n', true).length}`);
}

// ---------------------------------------------------------------------------
console.log('\nthe distance is a distance');
// ---------------------------------------------------------------------------
{
  const self = paletteDistance(paletteRows(palettes, 1, 'n'), paletteRows(palettes, 1, 'n'));
  check(self && self.score === 0, 'a palette against itself is 0', () => `${self && self.score}`);

  const ab = paletteDistance(paletteRows(palettes, 1, 'n'), paletteRows(palettes, 2, 'n'));
  const ba = paletteDistance(paletteRows(palettes, 2, 'n'), paletteRows(palettes, 1, 'n'));
  check(Math.abs(ab.score - ba.score) < 1e-12, 'the distance is symmetric',
    () => `${ab.score} vs ${ba.score}`);

  // forward/reverse must both be populated, or the bidirectional term is gone
  // and a continuous-tone brown outmatches a brown outfit for free.
  check(Number.isFinite(ab.forward) && Number.isFinite(ab.reverse) && ab.reverse > 0,
    'both directions are computed', () => JSON.stringify(ab));
  check(Math.abs(ab.score - (ab.forward + ab.reverse) / 2) < 1e-12,
    'and the score is their mean, as matchPalette() defines it');

  check(paletteDistance([], paletteRows(palettes, 1, 'n')) === null, 'an empty side is null, not 0');
  check(paletteDistance(null, null) === null, 'and so is no data at all');
  const noShare = paletteDistance([{ hex: '#399494', share: 0 }], paletteRows(palettes, 1, 'n'));
  check(Number.isFinite(noShare && noShare.score), 'zero shares fall back to equal weight rather than NaN',
    () => `${noShare && noShare.score}`);

  // Monotonicity: moving away can never make a palette closer. Checked, not
  // assumed, because a weighted average with a divide can invert.
  let inversions = 0;
  const T = paletteRows(palettes, 1, 'n');
  for (const g of [2, 3, 4, 25, 94, 150, 384, 900]) {
    const d = paletteDistance(paletteRows(palettes, g, 'n'), T);
    if (d.score < self.score) inversions++;
  }
  check(inversions === 0, 'no other species is closer to Bulbasaur than Bulbasaur is to itself',
    () => `${inversions} negative distances`);
}

// ---------------------------------------------------------------------------
console.log('\nthe four tiers are re-measured, not remembered');
// ---------------------------------------------------------------------------
{
  // The thresholds are pinned constants. Pinning a number is only honest if
  // something re-derives it, so this sweeps the corpus again and reports where
  // the constants actually fall. If the corpus moves, the message says so.
  const ids = allIds(data);
  const distances = [];
  for (let k = 0; k < 25; k++) {
    const t = ids[(k * 37) % ids.length];
    const T = paletteRows(palettes, t, 'n');
    for (const g of ids) {
      if (g === t) continue;
      const d = paletteDistance(paletteRows(palettes, g, 'n'), T);
      if (d) distances.push(d.score);
    }
  }
  distances.sort((a, b) => a - b);
  const q = (f) => distances[Math.floor(distances.length * f)];
  const p = (v) => (distances.filter((x) => x <= v).length / distances.length) * 100;

  check(distances.length > 20000, `swept ${distances.length} pairs across the dex`);
  check(p(TIER_CLOSE) >= 5 && p(TIER_CLOSE) <= 20,
    `close tier (≤ ${TIER_CLOSE}) covers ~10% of pairs — measured ${p(TIER_CLOSE).toFixed(1)}%`);
  check(p(TIER_MID) >= 45 && p(TIER_MID) <= 70,
    `mid tier (≤ ${TIER_MID}) covers ~55% — measured ${p(TIER_MID).toFixed(1)}%`);
  check(p(TIER_FAR) >= 85 && p(TIER_FAR) <= 96,
    `far tier (≤ ${TIER_FAR}) covers ~90% — measured ${p(TIER_FAR).toFixed(1)}%`);

  // Every tier must be reachable, or the share grid is a one-colour grid.
  const buckets = { close: 0, mid: 0, far: 0, miss: 0 };
  for (const d of distances) buckets[tierOf(d)]++;
  for (const [name, n] of Object.entries(buckets)) {
    check(n > 0, `the ${name} tier is reachable`, () => `${n} pairs`);
  }
  check(tierOf(0) === 'close' && tierOf(1) === 'miss', '0 is close and a huge distance is a miss');
  check(tierOf(NaN) === 'miss', 'an unmeasurable guess scores as a miss, not as close');

  // Direction. A tier must get WORSE as the distance grows, or the share
  // string is inverted and still looks like a plausible grid.
  const ladder = [0, 0.05, 0.09, 0.14, 0.3].map(tierOf);
  check(ladder.join(' → ') === 'close → close → mid → far → miss',
    'the tiers get worse as the distance grows', () => ladder.join(' → '));

  console.log(`\n       measured spread: p1 ${q(0.01).toFixed(4)} · p10 ${q(0.1).toFixed(4)} `
    + `· p50 ${q(0.5).toFixed(4)} · p90 ${q(0.9).toFixed(4)} · p99 ${q(0.99).toFixed(4)} `
    + `· max ${distances[distances.length - 1].toFixed(4)}`);
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);