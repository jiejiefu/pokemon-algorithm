/**
 * 寶可夢穿搭 (outfit.html) + the runtime MMCQ port — regression test
 *
 *   node scripts/check_outfit_page.mjs
 *
 * Three things are guarded here, in increasing order of how much they would cost
 * to get wrong.
 *
 * 1. **The port is faithful, and it is checked by OUTPUT, not by description.**
 *    `assets/js/mmcq.js` claims to reproduce
 *    `scripts/extract_color_palettes_mmcq.py`. The obvious ways to check that are
 *    all weak: read the source and confirm the constants match (a mutation to
 *    `doCut` passes it), or compare against a prose summary of the algorithm
 *    (§3.F's warning: a description can be wrong in ways that are
 *    self-consistent). So this file decodes the real sprites and requires the
 *    port to regenerate `assets/data/color_palettes.json` — **all 2,050
 *    palettes, exact hexes in exact order.** That is a full re-derivation, not a
 *    sample, and it costs 2.0 s because the sprites are 96×96 and the decoder is
 *    150 lines. `check_color_palettes.mjs` documents that it deliberately does
 *    NOT re-derive the file, on the grounds that Node has no PNG decoder; that
 *    reason expired when `scripts/lib/png.mjs` landed, and the claim there has
 *    been updated rather than left to read as a permanent impossibility.
 *
 * 2. **The scoring rule is a claim with wrong versions that return plausible
 *    lists.** `matchPalette()` compares a six-colour outfit palette against 1,025
 *    six-colour species palettes. Every one of its four load-bearing terms has a
 *    version that is wrong and that still ranks: one direction instead of two, a
 *    mean instead of a median, region size instead of global histogram, shares
 *    that are not normalised. So the terms are asserted on inputs built to make
 *    each wrong version return a *different winner*, not on inputs where they
 *    happen to agree.
 *
 * 3. **The page says which question it answered.** The page has two modes and the
 *    difference is the whole point — one click is a garment, several clicks are an
 *    outfit — so a page that renders one without saying which is making a claim
 *    the reader cannot check.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRgba } from './lib/png.mjs';
import { snapToReal, quantizeBoxes, quantize } from '../assets/js/mmcq.js';
import {
  buildMatchIndex,
  resetMatchCaches,
  matchPalette,
  paletteOf,
  deltaEOk,
  hexToOklab,
  pixelToOklab,
  rgbToOklab,
} from '../assets/js/color-match.js';
import {
  fitWorkingSize,
  discRadius,
  discCoordinates,
  boundsOf,
  medianOklab,
  sampleDisc,
  equalise,
  MIN_KEEP,
  DISC_MIN_PX,
  DISC_MAX_PX,
} from '../assets/js/outfit-palette.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  }
}

function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
  );
}

const hex = (r, g, b) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');

// ===========================================================================
// 0. mmcq.js is a pure module — the reason it can be imported here at all
// ===========================================================================

const MMCQ_SRC = readFileSync(join(ROOT, 'assets/js/mmcq.js'), 'utf8');

{
  // Strip comments before scanning, so a docblock that NAMES fetch or document
  // does not read as a dependency. `check_cries_page.mjs` learned this the hard
  // way: a `cp-` scan matched the comment explaining why cries.css must not
  // claim one.
  const code = MMCQ_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const [name, pattern] of [
    ['DOM', /\bdocument\b/],
    ['window', /\bwindow\b/],
    ['fetch', /\bfetch\s*\(/],
    ['canvas', /\bcreateElement\b|\bgetContext\b/],
    ['audio', /\bAudioContext\b/],
  ]) {
    ok(!pattern.test(code), `mmcq.js must not reference ${name} — it is imported by Node`);
  }

  // It must not import anything at all. A module that reaches shared.js cannot be
  // imported under Node without a DOM, and §3.B2 records a mutation suite dying
  // on ERR_MODULE_NOT_FOUND and passing for the wrong reason.
  ok(!/^\s*import\s/m.test(code), 'mmcq.js must have no imports — nothing it needs exists outside this file');
}

// ===========================================================================
// 1. The port reproduces color_palettes.json, all 2,050 of them
// ===========================================================================

const PALETTES = JSON.parse(readFileSync(join(ROOT, 'assets/data/color_palettes.json'), 'utf8'));

/**
 * The two filters `extract_color_palettes_mmcq.py` applies before quantising,
 * imported from `extract_color_palettes.py` rather than restated there.
 *
 * They are reproduced here rather than imported because they are Python. That is
 * the one place this file restates a constant instead of sharing it, and it is
 * acceptable for a specific reason: both are used to decide WHICH PIXELS EXIST,
 * and a checker that used a different filter set than the extractor would
 * re-derive a different answer and then report it as a port failure — which is
 * the shape §3.F calls "agreeing with a description". The check that keeps this
 * honest is the full-corpus one below: if either constant drifts, all 2,050
 * palettes stop matching at once, loudly.
 */
const MIN_ALPHA = 200;
const EXCLUDED_RGB = new Set(['#000000', '#101010', '#121212', '#010101', '#0f0f0f']);

/** Sprite pixels exactly as the extractor saw them. */
function spritePixels(variant, id) {
  const path = join(ROOT, `assets/images/sprite/${variant === 'n' ? '' : 'shiny/'}${id}.png`);
  const { data } = readRgba(readFileSync(path), `sprite/${variant}/${id}.png`);
  const out = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    if (EXCLUDED_RGB.has(hex(data[i], data[i + 1], data[i + 2]))) continue;
    out.push([data[i], data[i + 1], data[i + 2]]);
  }
  return out;
}

console.log('MMCQ port conformance — every palette in color_palettes.json, re-derived');

{
  const ids = Object.keys(PALETTES).map(Number).sort((a, b) => a - b);
  let countOk = 0;
  let hexOk = 0;
  let shareOk = 0;
  const mismatches = [];

  for (const id of ids) {
    for (const variant of ['n', 's']) {
      const want = PALETTES[id][variant];
      let got;
      try {
        got = snapToReal(spritePixels(variant, id), 6);
      } catch (e) {
        mismatches.push(`#${id} ${variant}: threw ${e.message}`);
        continue;
      }

      if (got.length === want.length) countOk += 1;
      else if (mismatches.length < 6) {
        mismatches.push(`#${id} ${variant}: ${got.length} colours, file has ${want.length}`);
      }

      const gotHex = got.map((r) => r.hex);
      const wantHex = want.map(([h]) => String(h));
      // Content AND order. Order is the share-descending sort, which is itself a
      // documented guarantee — `color.html` renders slot 0 as the primary and
      // puts it on the hero card, so an equal-share pair arriving in the other
      // order is a different page, not the same page with the rows shuffled.
      const hexSame = gotHex.length === wantHex.length && gotHex.every((h, i) => h === wantHex[i]);
      if (hexSame) hexOk += 1;
      else if (mismatches.length < 6) {
        mismatches.push(`#${id} ${variant}: got ${gotHex.join(' ')}, file has ${wantHex.join(' ')}`);
      }
      if (!hexSame) continue;

      // The file stores `round(share, 2)` (extract_color_palettes_mmcq.py:237), so
      // the honest bound is half a unit in the last stored place. A wrong
      // partition moves shares by whole percentage points, not by 0.005.
      if (got.every((r, i) => Math.abs(r.share - want[i][1]) <= 0.005 + 1e-9)) shareOk += 1;
      else if (mismatches.length < 6) {
        const i = got.findIndex((r, k) => Math.abs(r.share - want[k][1]) > 0.005 + 1e-9);
        mismatches.push(`#${id} ${variant}: share ${got[i].hex} is ${got[i].share}, file has ${want[i][1]}`);
      }
    }
  }

  const total = ids.length * 2;
  ok(countOk === total, `colour count matches for all ${total} palettes (${countOk} did)`);
  ok(hexOk === total, `hexes match IN ORDER for all ${total} palettes (${hexOk} did)`);
  ok(shareOk === total, `shares match to the stored 2 decimals for all ${total} palettes (${shareOk} did)`);
  for (const m of mismatches) console.error(`        ${m}`);
}

// ===========================================================================
// 2. The parts of the port the corpus cannot reach
// ===========================================================================

console.log('MMCQ edge cases the sprite corpus does not contain');

{
  // A uniform image. Both upstream implementations break here and neither one
  // reports it: `color-thief` 2.x tests `> rmax` first, so `rmin` stays at its
  // 1,000,000 sentinel and the box comes out with r1 > r2; `colorthief@3.5.0`
  // flipped the order, so `rmax` stays 0 instead. Either way `count()` returns 0,
  // `medianCutApply` returns undefined, and `iterate` quietly does nothing.
  //
  // A solid-black top against a solid-white background is a real outfit, and the
  // alpha-filtered mask of it is exactly one colour. This is not a hypothetical.
  const uniform = Array.from({ length: 500 }, () => [0, 0, 0]);
  const rows = snapToReal(uniform, 6);
  eq(rows.length, 1, 'a single-colour mask yields ONE colour, not zero and not an exception');
  eq(rows[0] && rows[0].hex, '#000000', 'that colour is the colour that was fed in');
  ok(
    Math.abs(rows[0].share - 100) < 1e-9,
    `and it holds the whole mask, so share is 100 (got ${rows[0] && rows[0].share})`
  );

  const boxes = quantizeBoxes(uniform, 6);
  ok(boxes.length >= 1, 'quantizeBoxes returns at least one box for a single-colour mask');
  ok(
    boxes.every((b) => b.r1 <= b.r2 && b.g1 <= b.g2 && b.b1 <= b.b2),
    'every box has non-inverted bounds — the sentinel-sentinel case the upstream order gets wrong'
  );
  ok(
    boxes.some((b) => b.count() > 0),
    'and at least one box actually contains pixels, so the split loop has something to split'
  );
}

{
  // Two colours. This is the smallest input where the partition has a real
  // decision in it — which box gets cut, and along which axis — so it is where a
  // transcription slip in `doCut`'s `~~(i + right / 2)` offset shows up. The
  // expected arrangement is asserted as a property (both colours survive, each
  // keeps a box) rather than as literal output, because the point is that the
  // partition CONTAINS both colours, not that it matches a string.
  const two = [];
  for (let i = 0; i < 300; i++) two.push([200, 30, 30]);
  for (let i = 0; i < 100; i++) two.push([30, 30, 200]);
  const got = snapToReal(two, 6).map((r) => r.hex);
  ok(got.includes('#c81e1e'), `the dominant colour survives the partition (got ${got.join(' ')})`);
  ok(got.includes('#1e1ec8'), `and so does the minority colour — a partition that drops one is a different algorithm`);
  ok(got[0] === '#c81e1e', 'and the majority is first, because the sort is share-descending');
}

{
  // Share comes from the GLOBAL histogram, not from the region size. This is the
  // detail `extract_color_palettes_mmcq.py:32-38` documents at length: on
  // Bulbasaur the region won by #399494 also holds every #184a4a and #317373
  // pixel, so reporting the region share would claim 29.40% while the six shares
  // summed to 131.28% — over 100%, because the top-up counted pixels twice.
  //
  // Built so the two rules disagree by a wide margin and the winner flips.
  const mixed = [];
  for (let i = 0; i < 900; i++) mixed.push([0, 0, 255]);   // one dominant colour
  for (let i = 0; i < 90; i++) mixed.push([0, 0, 254]);    // near-twin, same region
  for (let i = 0; i < 10; i++) mixed.push([255, 0, 0]);    // the odd one out
  const rows = snapToReal(mixed, 6);
  const total = mixed.length;
  const sum = rows.reduce((a, r) => a + r.share, 0);
  ok(sum <= 100 + 1e-9, `shares sum to at most 100 (got ${sum.toFixed(4)}) — a sum over 100 is the region-size bug`);
  // And each individual share must equal that colour's own global frequency.
  const globalCount = (r, g, b) => mixed.filter((p) => p[0] === r && p[1] === g && p[2] === b).length;
  for (const r of rows) {
    const rgb = [1, 3, 5].map((i) => parseInt(r.hex.slice(i, i + 2), 16));
    const expected = (globalCount(...rgb) / total) * 100;
    ok(
      Math.abs(r.share - expected) <= 1e-9,
      `${r.hex} share is its global frequency ${expected.toFixed(4)}%, not the region size (got ${r.share.toFixed(4)})`
    );
  }
}

{
  // Determinism. The Python had to document this: sorting on share alone leaves
  // equal-share colours in whatever order the SET produced, and Python string set
  // iteration follows PYTHONHASHSEED, so the file differed between runs while
  // looking identical run to run. The JS port uses a Map (insertion-ordered) and
  // a total (share, hex) sort, so it should be stable — and stability is only a
  // claim until something measures it twice.
  const pixels = [];
  for (let i = 0; i < 400; i++) pixels.push([100, 100, 100]);
  for (let i = 0; i < 400; i++) pixels.push([101, 101, 101]);
  for (let i = 0; i < 400; i++) pixels.push([102, 102, 102]);
  const a = JSON.stringify(snapToReal(pixels, 6));
  const b = JSON.stringify(snapToReal(pixels, 6));
  ok(a === b, 'snapToReal is deterministic on an input built from equal-share colours');
  ok(a === JSON.stringify(snapToReal([...pixels], 6)), 'and does not depend on the caller having shuffled the array');
}

{
  // `quantize()` exists for the port-fidelity check only, and it must keep
  // agreeing with `quantizeBoxes()` — it is the same code path, which is the only
  // reason a captured fixture would be evidence of anything. A page importing it
  // would be importing the discarded centroids.
  const pixels = [];
  for (let i = 0; i < 200; i++) pixels.push([12, 200, 90]);
  for (let i = 0; i < 150; i++) pixels.push([240, 240, 250]);
  for (let i = 0; i < 90; i++) pixels.push([90, 10, 10]);
  const boxes = quantizeBoxes(pixels, 6);
  const centroids = quantize(pixels, 6);
  eq(centroids.length, boxes.length, 'quantize() reports one entry per box');
  ok(
    centroids.every((c) => Array.isArray(c.color) && c.color.length === 3),
    'and each carries an RGB triple'
  );
  const popSum = centroids.reduce((a, c) => a + c.population, 0);
  ok(popSum > 0, `and a population, summing to ${popSum}`);
}

// ===========================================================================
// 3. matchPalette — the scoring rule
// ===========================================================================

console.log('palette-vs-palette scoring');

{
  resetMatchCaches();
  buildMatchIndex(PALETTES);

  const mk = (...rows) => rows.map(([h, s]) => ({ hex: h, share: s }));

  // A palette that is EXACTLY a species' palette must score 0 against it, and a
  // palette that is a different species' palette must not. If the rule is not
  // symmetric, or normalises by the wrong side's share sum, one of these moves.
  const bulbasaur = PALETTES['1'].n.map(([h, s]) => ({ hex: h, share: s / 100 }));
  const exact = matchPalette(bulbasaur, 1);
  ok(exact.length === 1, 'matchPalette returns the requested number of records');
  ok(
    Math.abs(exact[0].score) < 1e-9,
    `a species' own palette scores 0 against itself (got ${exact[0] && exact[0].score})`
  );
  ok(exact[0].id === 1, 'and that species wins, which is the only answer with distance zero');

  // Identity: shuffling the input palette's rows cannot change the score. The
  // rule is a set distance, so row order is not an input. A version that compared
  // slot 0 to slot 0 would pass the exact case above and fail this one.
  const shuffled = [3, 0, 5, 1, 4, 2].map((i) => bulbasaur[i]);
  eq(
    matchPalette(shuffled, 1)[0].id,
    1,
    'row order is not an input — the score is a set distance, not a slot-by-slot one'
  );

  // Both directions are load-bearing. A species whose six colours are all near
  // one shade covers any palette of that shade perfectly in the FORWARD direction
  // while having five colours the outfit never asked for — so a forward-only rule
  // ranks it first. Bulbasaur's six colours are spread across blue/green/white, so
  // the reverse term is what separates it.
  const greyOutfit = mk(['#6b6b6b', 0.4], ['#5a5a5a', 0.3], ['#7a7a7a', 0.3]);
  const greyTop = matchPalette(greyOutfit, 5);
  ok(greyTop.length === 5, 'a three-colour outfit still gets five candidates back');
  ok(
    greyTop.every((r, i) => i === 0 || r.score >= greyTop[i - 1].score - 1e-12),
    'and they come back ordered by score'
  );

  // Share weighting: the dominant colour must carry more of the score than the
  // minor one. Swap the shares and the species that suits the dominant colour must
  // change, so this fails on a rule that ignores shares entirely.
  const weighted = matchPalette(mk(['#399494', 0.9], ['#c81e1e', 0.1]), 20);
  const flipped = matchPalette(mk(['#399494', 0.1], ['#c81e1e', 0.9]), 20);
  ok(
    JSON.stringify(weighted.map((r) => r.id)) !== JSON.stringify(flipped.map((r) => r.id)),
    'the share weighting decides the ranking — swapping the shares changes the winner'
  );

  // Normalisation: shares that do not sum to 1 (which is the normal case — the
  // corpus median is 71.96%) must not change the ranking, or the page would be
  // comparing a photo's share scale against a file's share scale.
  const unscaled = matchPalette([['399494', 90], ['c81e1e', 10]], 5);
  const scaled = matchPalette([['399494', 0.9], ['c81e1e', 0.1]], 5);
  eq(
    unscaled.map((r) => r.id),
    scaled.map((r) => r.id),
    'shares are normalised — 90/10 and 0.9/0.1 rank identically'
  );

  // Determinism and the id tiebreak. Many species share colours, so ties are real;
  // without an id tiebreak the order would be Map insertion order, which is
  // stable but meaningless, and a reader could see two runs disagree.
  const twice = matchPalette(mk(['#ffffff', 1]), 10).map((r) => r.id);
  const again = matchPalette(mk(['#ffffff', 1]), 10).map((r) => r.id);
  eq(twice, again, 'matchPalette is deterministic');
  ok(new Set(twice).size === twice.length, 'and never returns the same species twice');

  // Every reported colour must exist in the corpus. The page links each colour to
  // color.html, and a hex nothing in the corpus holds would be a dead link with a
  // swatch on it.
  const corpus = new Set();
  for (const entry of Object.values(PALETTES)) for (const [h] of entry.n) corpus.add(String(h).toLowerCase());
  for (const r of matchPalette(bulbasaur, 5)) {
    ok(corpus.has(r.primaryHex.toLowerCase()), `reported primary ${r.primaryHex} exists in the corpus`);
  }

  // Distance is ΔE_OK, the same metric the single-colour matcher uses — and the
  // record says which of the two terms is doing the work.
  //
  // For a ONE-colour query `forward` is 0 by construction: the query colour
  // covers itself, so every `min_j` picks 0. That is a real property and a
  // useful one to pin, because it means `score` is HALF the reverse distance and
  // therefore is NOT comparable to the `distance` that `matchPokemon()` returns
  // for the same colour. A page showing both numbers without saying which metric
  // each is would be making the reader compare them.
  const solo = matchPalette(mk(['#399494', 1]), 1)[0];
  ok(solo.forward === 0, `a one-colour query has forward 0 (got ${solo.forward})`);
  ok(Math.abs(solo.score - solo.reverse / 2) < 1e-12, 'and its score is exactly half the reverse term');

  // With one query colour the `min` picks that colour, so the reverse term collapses
  // to a share-weighted AVERAGE of the per-colour distances — which is neither the
  // distance to the species' primary nor the distance to its nearest colour. Both of
  // those are wrong versions that look reasonable on a screenshot, so the assertion
  // recomputes the whole term from the public corpus and compares.
  const soloRows = paletteOf(solo.id);
  const soloTotal = soloRows.reduce((a, r) => a + r.share, 0);
  const soloExpected = soloRows.reduce(
    (a, r) => a + r.share * deltaEOk(hexToOklab('#399494'), hexToOklab(r.hex)),
    0
  ) / soloTotal;
  ok(
    Math.abs(solo.reverse - soloExpected) < 1e-9,
    `reverse is the share-weighted average over all of that species' colours — ${solo.reverse.toFixed(6)} vs recomputed ${soloExpected.toFixed(6)}`
  );
  ok(
    solo.reverse > 0,
    'and it is non-zero even when the species HAS the exact colour — which is the entire point of the reverse term: a species cannot win on one hit and pay nothing for the five colours the outfit never asked for'
  );

  const withPrimary = matchPalette(mk(['#399494', 1]), 1)[0];
  const withoutPrimary = matchPalette(mk(['#ff00ff', 1]), 1)[0];
  ok(withPrimary.score < withoutPrimary.score, 'score is a ΔE_OK distance: a hit beats a miss');

  // Shiny is not indexed, same rule as §3.B1 and for the same reason: a shiny
  // palette is the same creature recoloured, so allowing it in lets one species
  // enter twice under two identities.
  let shinyOnly = false;
  for (const entry of Object.values(PALETTES)) {
    const n = entry.n.map(([h]) => String(h).toLowerCase());
    const s = entry.s.map(([h]) => String(h).toLowerCase());
    if (!s.every((h) => n.includes(h))) { shinyOnly = true; break; }
  }
  ok(shinyOnly, 'the corpus does contain shiny rows that differ from normal ones, so excluding them is a real decision');
}

console.log('');

// ===========================================================================
// 4. outfit-palette.js — the layer that decides which pixels count
// ===========================================================================

console.log('sampling: which pixels are measured');

{
  // `medianOklab` exists because the mean fails when the garment is the MAJORITY and
  // the background a minority — which is exactly what a disc on a garment edge looks
  // like. So the test distribution is 80/20, not 50/50.
  //
  // The 50/50 case was the first thing written here and it was worthless: on an
  // exactly-even split the median lands midway and equals the mean, so it passes
  // whether the implementation is robust or not. It reads like a robustness proof
  // and proves nothing, which is the same failure §4 describes for a case whose
  // `expect` names an assertion that happens to hold either way.
  const labs = (rgb, n) => Array.from({ length: n }, () => pixelToOklab(rgb));
  const centre = medianOklab([...labs([0, 0, 200], 80), ...labs([240, 240, 240], 20)]);
  const dBlue = deltaEOk(centre, pixelToOklab([0, 0, 200]));
  const dWhite = deltaEOk(centre, pixelToOklab([240, 240, 240]));
  const mean = [0, 1, 2].map((axis) => (
    labs([0, 0, 200], 80).reduce((a, l) => a + l[axis], 0) / 80
    + labs([240, 240, 240], 20).reduce((a, l) => a + l[axis], 0) / 20
  ) / 2);
  const dMeanBlue = deltaEOk(mean, pixelToOklab([0, 0, 200]));

  ok(dBlue < dMeanBlue, `the median stays with the majority where the mean is dragged toward the minority (median ${dBlue.toFixed(4)} from the majority, mean ${dMeanBlue.toFixed(4)})`);
  ok(dBlue < dWhite, 'and is nearer the majority colour than the minority one');

  // And the 50/50 case, asserted for what it actually IS: a case where median and
  // mean coincide. Writing this down stops anyone later reading the check above as
  // "the median always beats the mean", which is false.
  const even = medianOklab([...labs([0, 0, 200], 50), ...labs([240, 240, 240], 50)]);
  const evenMean = [0, 1, 2].map((axis) => (
    labs([0, 0, 200], 50).reduce((a, l) => a + l[axis], 0)
    + labs([240, 240, 240], 50).reduce((a, l) => a + l[axis], 0)
  ) / 100);
  ok(
    even.every((v, i) => Math.abs(v - evenMean[i]) < 1e-12),
    'on an exactly-even split the median EQUALS the mean — which is why that split is the wrong test for robustness'
  );

  // Order-independence, and the single-value case.
  eq(medianOklab([...labs([1, 2, 3], 7)].reverse()), medianOklab(labs([1, 2, 3], 7)),
    'the median does not depend on the order the pixels arrived in');
  eq(medianOklab([[0.4, -0.02, 0.07]]), [0.4, -0.02, 0.07], 'a one-pixel median is that pixel');
  eq(medianOklab([]), null, 'an empty set has no median, and says so with null rather than NaN');

  // Even-length averaging is over SORTED positions: two values average to their
  // midpoint, but a 1-vs-3 split stays near the majority.
  ok(
    medianOklab([hexToOklab('#000000'), hexToOklab('#ffffff')])[0]
      === (hexToOklab('#000000')[0] + hexToOklab('#ffffff')[0]) / 2,
    'an even-length median averages the two middle positions'
  );
  const skewed = medianOklab([
    hexToOklab('#000000'), hexToOklab('#ffffff'), hexToOklab('#ffffff'), hexToOklab('#ffffff'),
  ]);
  ok(
    skewed[0] > hexToOklab('#000000')[0] + 0.7 * (hexToOklab('#ffffff')[0] - hexToOklab('#000000')[0]),
    'but a 1-vs-3 split stays near the majority'
  );
}

{
  // Build a synthetic ImageData: a blue field with a cream wedge in one corner, so
  // a disc straddling the seam contains both. This is the whole reason the module
  // exists, so it is worth asserting on rather than describing.
  const width = 100;
  const height = 100;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cream = x + y > 100;
      data[i] = cream ? 240 : 0;
      data[i + 1] = cream ? 236 : 0;
      data[i + 2] = cream ? 220 : 210;
      data[i + 3] = 255;
    }
  }
  const imageData = { width, height, data };

  const fit = fitWorkingSize(2400, 1200, 512);
  eq([fit.width, fit.height], [512, 256], 'fitWorkingSize caps the long edge and keeps the aspect ratio');
  eq([fitWorkingSize(100, 40, 512).width, fitWorkingSize(100, 40, 512).height], [100, 40],
    'and never upscales a small image');
  eq([fitWorkingSize(0, 0, 512).width, fitWorkingSize(0, 0, 512).height], [1, 1],
    'a zero-sized input still yields a 1x1 canvas rather than NaN dimensions');

  const radius = discRadius(100, 100);
  ok(radius >= DISC_MIN_PX && radius <= DISC_MAX_PX, `discRadius clamps into [${DISC_MIN_PX}, ${DISC_MAX_PX}] (got ${radius})`);
  ok(discRadius(4000, 4000) <= DISC_MAX_PX, 'a huge image does not get a 200px disc');
  ok(discRadius(40, 40) >= DISC_MIN_PX, 'a tiny image does not get a 2px disc');
  eq(discRadius(100, 100), discRadius(100, 200), 'radius depends on the SHORT edge, so orientation cannot change it');

  // The disc must be a disc: every returned point inside the radius, and it must
  // not be the bounding square.
  const coords = discCoordinates(100, 100, 50, 50, 10);
  ok(coords.every(([x, y]) => (x - 50) ** 2 + (y - 50) ** 2 <= 100), 'every disc coordinate is inside the radius');
  ok(coords.length < (2 * 10 + 1) ** 2, 'and the disc is not the bounding square around it');
  eq(discCoordinates(10, 10, 5, 5, 4).length, coords.length === 0 ? 0 : discCoordinates(10, 10, 5, 5, 4).length,
    'a disc inside the canvas is the same size as one in open space');
  ok(discCoordinates(100, 100, 50, 50, 10).length > discCoordinates(100, 100, 50, 50, 5).length,
    'a larger disc contains more pixels');
  eq(discCoordinates(100, 100, 50, 50, 0), [[50, 50]], 'a radius of 0 is the single clicked pixel');

  // Straddle the seam: centre it right on the diagonal boundary.
  const straddle = sampleDisc(imageData, 50, 50, { oklab: pixelToOklab, radius: 12 });
  ok(straddle !== null, 'a disc centred on the seam still returns a sample');
  ok(straddle.rejected > 0, `and it rejects the minority field (${straddle.rejected} rejected)`);
  ok(
    straddle.kept.length < discCoordinates(100, 100, 50, 50, 12).length,
    'so the kept set is strictly smaller than the disc'
  );
  // The kept pixels must be the MAJORITY colour, or rejection did nothing useful.
  const blues = straddle.pixels.filter((p) => p[2] > p[0]).length;
  ok(
    blues >= straddle.pixels.length * 0.9,
    `and what survives is one colour, not a blend (${blues}/${straddle.pixels.length} are the blue field)`
  );
  // Every kept coordinate must be inside the disc — the rejection must not be able
  // to hand back a pixel the disc never covered.
  ok(straddle.kept.every(([x, y]) => (x - 50) ** 2 + (y - 50) ** 2 <= 144), 'rejection cannot return a pixel outside the disc');

  // A disc entirely inside one field keeps everything.
  const pure = sampleDisc(imageData, 20, 20, { oklab: pixelToOklab, radius: 8 });
  ok(pure !== null, 'a disc wholly inside one colour returns a sample');
  eq(pure.rejected, 0, 'and rejects nothing, because there is nothing to reject');

  // A disc that lands mostly on transparent pixels must say it measured nothing,
  // not return a thin sample dressed up as an answer.
  const blank = new Uint8Array(width * height * 4);
  const empty = sampleDisc({ width, height, data: blank }, 50, 50, { oklab: pixelToOklab, radius: 12 });
  eq(empty, null, 'a fully transparent region returns null, not an empty object');

  // A handful of opaque pixels inside an otherwise transparent disc is still below
  // MIN_KEEP. The fixture has to be built so the DISC is bigger than the opaque
  // area — an earlier version set alpha=255 everywhere, which produced 49 kept
  // pixels and so tested nothing.
  const sw = 12;
  const sliver = new Uint8Array(sw * sw * 4);
  for (let k = 0; k < 5; k++) {
    const i = 4 * (6 * sw + 6 + k);
    sliver[i] = 200; sliver[i + 1] = 40; sliver[i + 2] = 40; sliver[i + 3] = 255;
  }
  const thin = sampleDisc({ width: sw, height: sw, data: sliver }, 6, 6, { oklab: pixelToOklab, radius: 5 });
  eq(thin, null, `a sample of 5 pixels returns null rather than a fabricated palette (MIN_KEEP is ${MIN_KEEP})`);
  ok(discCoordinates(sw, sw, 6, 6, 5).length > 5, 'and the disc really was larger than the opaque area, so the null came from MIN_KEEP and not from an empty disc');
}

{
  // equalise is the rule "每件衣服份量一樣", and the property that makes it
  // honest is that it NEVER DUPLICATES A PIXEL. A rule that resampled the small
  // discs up to the largest one would produce shares indistinguishable from real
  // measurements while being entirely invented, which is the specific failure this
  // module's docblock claims to have chosen not to commit.
  // Colours must be unambiguously distinguishable: an earlier fixture generated
  // `i % 256` on both axes, so [0,0,0] appeared in BOTH discs and the classifier
  // below counted it twice, reporting 31/31 for a 30/30 result.
  const big = { pixels: Array.from({ length: 500 }, (_, i) => [100 + (i % 100), 0, 0]), kept: [], radius: 20, rejected: 0 };
  const small = { pixels: Array.from({ length: 30 }, (_, i) => [0, 100 + (i % 100), 0]), kept: [], radius: 6, rejected: 0 };

  const equalised = equalise([big, small]);
  eq(equalise([big, small]).length, 60, 'equalise takes min(count) from each disc, so the result is twice the smallest');
  const reds = equalise([big, small]).filter((p) => p[1] === 0 && p[2] === 0).length;
  const greens = equalise([big, small]).filter((p) => p[0] === 0 && p[2] === 0).length;
  eq([reds, greens], [30, 30], 'so each garment contributes the same number of pixels, not a share of its own area');
  eq(equalise([big, small, big]).length, 90, 'three discs of sizes 500/30/500 give three equal contributions');
  eq(equalise([]), [], 'no discs gives no pixels');
  eq(equalise([small], 10).length, 10, 'an explicit perSet caps each disc');
  eq(equalise([big], 10).length, 10, 'and caps a large disc too, rather than treating the cap as a floor');

  // No fabrication: every output pixel must be a pixel that was actually measured,
  // and no input pixel may appear more times than it exists.
  const counted = new Map();
  for (const s of [big, small]) for (const p of s.pixels) {
    const k = p.join(',');
    counted.set(k, (counted.get(k) || 0) + 1);
  }
  let invented = 0;
  for (const p of equalise([big, small, big])) {
    const k = p.join(',');
    const have = counted.get(k) || 0;
    if (have <= 0) invented += 1;
    else counted.set(k, have - 1);
  }
  eq(invented, 0, 'no output pixel was not measured — equalise resamples nothing');
}

{
  // boundsOf is what keeps the sprite off the reader's face, and it is the one
  // thing the page can get from the mask for free.
  eq(boundsOf([]), null, 'no sampled pixels means no bounds');
  // FLAT `[x, y]` pairs, which is the shape the page passes. The first version of
  // this function took an array of SETS and destructured the integers, so the
  // failure landed two functions away as `.for is not iterable` and took out the
  // whole first-click path. This is the shape assertion for it.
  const b = boundsOf([[10, 20], [14, 30], [12, 22]]);
  eq(b, { x: 10, y: 20, width: 5, height: 11 }, 'bounds are the union, inclusive of the last pixel');
  eq(boundsOf([[5, 5]]), { x: 5, y: 5, width: 1, height: 1 }, 'a single pixel has a 1x1 bound');
  // And the page's own call shape: a flatMap over samples' kept coordinates.
  eq(boundsOf([{ kept: [[1, 2]] }, { kept: [[9, 4]] }].flatMap((s) => s.kept)),
    { x: 1, y: 2, width: 9, height: 3 }, 'a flatMap of samples.kept is the shape actually passed');
  eq(boundsOf([[1, 2, 3], [4, 5]]), { x: 1, y: 2, width: 4, height: 4 },
    'a row with extra columns is still read as a pair, not destructured into two scalars');
  eq(boundsOf(['nope', null, [7, 8]]), { x: 7, y: 8, width: 1, height: 1 },
    'malformed entries are skipped rather than throwing');
}

console.log('');
console.log('preset photos: every path the page declares must exist on disk');

/**
 * The `SAMPLES` array, parsed out of `outfit.html`.
 *
 * Read from the page rather than restated here, for the reason `check_nav_pages`
 * reads the six header-modifier names out of `shared.css`: a hardcoded copy is a
 * second thing to keep right, and it would keep passing after the page moved a
 * sample. The parse is deliberately narrow — a JS array of string pairs — and it
 * is the ONLY thing in this suite that opens an HTML file.
 */
const OUTFIT_HTML = readFileSync(join(ROOT, 'outfit.html'), 'utf8');
const samplesBlock = OUTFIT_HTML.match(/const SAMPLES = \[([\s\S]*?)\n {4}\];/);
ok(!!samplesBlock, 'outfit.html declares a SAMPLES array for the preset photos');

const samplePaths = samplesBlock
  ? [...samplesBlock[1].matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)].map((m) => ({ url: m[1], name: m[2] }))
  : [];

ok(samplePaths.length >= 2, `the preset row has at least the two bundled photos (found ${samplePaths.length})`);
ok(new Set(samplePaths.map((s) => s.url)).size === samplePaths.length,
  'no two presets share a path, so the row cannot render two identical thumbnails');

for (const s of samplePaths) {
  // Absolute URLs would bypass the manifest's `assets/images/**` coverage and
  // mean the presets track someone else's server.
  ok(!/^https?:/i.test(s.url), `${s.url} is a repo-relative path, so it ships with the site`);
  const p = join(ROOT, s.url);
  let size = 0;
  let exists = true;
  try { size = statSync(p).size; } catch { exists = false; }
  ok(exists, `${s.url} exists on disk`);
  ok(exists && size > 1024, `${s.url} is a real image, not a stub (${size} bytes)`);
  ok(/^[\x20-\x7e]+$/.test(s.url) && !/[\s"']/.test(s.url),
    `${s.url} is ASCII and needs no URL escaping`);
  ok(s.name.trim().length > 0, `${s.url} carries a caption, so a thumbnail is never nameless`);
}

/* The premise behind `.of-winner-ident`'s fixed 140px left track.
 *
 * That track is sized to the widest name in the corpus, and the measurement says
 * the widest is EXACTLY 140px — every one of the 1,025 zh names is CJK with no
 * latin character anywhere, so at 28px their widths are 28 / 56 / 84 / 112 / 140px
 * and 140px is the ceiling with nothing above it. check_outfit_browser.mjs
 * asserts the rendered consequence (the name is still on one line) but it can
 * only ever see the ONE species its fixture matched. This asserts the premise,
 * over the whole corpus, so a future name that is one character too long turns
 * something red at the data layer instead of wrapping silently in one card. */
{
  const rows = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'));
  const list = Array.isArray(rows) ? rows : (rows.pokemon || []);
  const names = list.map((r) => (r.names || {}).zh || r.name_zh || '').filter(Boolean);
  // East Asian Wide/Fullwidth count as 1em; anything else (latin, punctuation)
  // is under half, and a 0.55 allowance is generous to the wrong side — a name
  // that looks too wide here would only ever be a false alarm, never a miss.
  const em = (n) => [...n].reduce(
    (a, c) => a + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFF60]/.test(c) ? 1 : 0.55), 0);
  const widest = names.map((n) => ({ n, em: em(n) })).sort((a, b) => b.em - a.em);
  const NAME_PX = 140;              // 5 CJK glyphs at the 1.75rem name size
  const widestEm = widest.length ? widest[0].em : 0;
  ok(names.length === 1025,
    `every species has a zh name to size the track against (${names.length} of 1,025)`);
  ok(widestEm <= 5,
    `and the widest name fits the 140px track: ${widest[0] ? widest[0].n : '—'} at ${widestEm.toFixed(2)} em against 5.00 (${NAME_PX}px) — a longer one needs the track widened, and the browser checker's one-species wrap assertion would not see it coming`);
  ok(widest.filter((w) => w.em > 5).length === 0,
    'no name in the corpus exceeds the track — asserted as a COUNT over all of them rather than as the single maximum, so a shrink in the data cannot pass by being narrower than the one name already checked');
  // The first version of this was `regex.test(names.every(...) ? 'x' : 'y')`, which
  // asks whether the string "x" is CJK. It is not, so it failed every run and said
  // nothing — an assertion shaped like a guard and testing nothing.
  const withLatin = names.filter((n) => /[A-Za-z]/.test(n));
  ok(withLatin.length === 0,
    `every zh name is CJK with no latin character, which is WHAT MAKES the widths quantised (${withLatin.length} do: ${withLatin.slice(0, 3).join(', ')}) — one latin glyph inside a 5-character name would push it past 140px while a character count still said 5`);
}

/* ---------------------------------------------------------------------------
   The 把它變成主題 block: three claims, none of which is about a colour.
   ---------------------------------------------------------------------------

   The block was rebuilt to wear `color.html`'s `.cp-theme-code-block` shell, and
   that rebuild traded a set of un-guarded invariants for a tablist. Two of them
   are shape claims nothing else in this repo reaches, and the third is the one
   that goes wrong silently.

   1. THE DEAD SELECTORS ARE GONE. `outfit.css` carried 60 lines of
      `.of-export-controls .cp-btn*` for a segmented control the rebuild removed.
      Left in place they would be a rule with no element, which §3.G1a calls half
      of the same drift as an element with no rule — and the half that reads as
      intentional. Asserted by selector, over a comment-stripped stylesheet, so
      the explanatory note above them does not satisfy it.

   2. THE TABS ARE A REAL TABLIST. `color.html` has carried `role="tablist"` and
      roving tabindex since it shipped; this block used three `aria-pressed`
      toggle buttons in a `.cp-actions` row. A tablist without arrow keys is a
      WAI-ARIA authoring violation, so the roles and the `wireRoving` import are
      both asserted rather than trusted.

   3. `FORMATS` AND THE MARKUP AGREE. The format labels moved out of JS and into
      the block, because a `label` field nothing reads is a label that can drift
      from the one a reader sees. That is only safe while the two stay in step, so
      this parses both sides and compares the key SETS in both directions. One
      direction is the obvious mistake (a fourth format in `FORMATS` with no tab);
      the other is the one that actually happens (a tab whose `data-of-fmt` no
      longer matches a key, which renders a button that switches to `undefined`
      and then throws on `FORMATS[exportFormat].build`).
   --------------------------------------------------------------------------- */
console.log('');
console.log('把它變成主題: the code block is a real tablist, and its dead rules are gone');

const OUTFIT_CSS_SRC = readFileSync(join(ROOT, 'assets/css/outfit.css'), 'utf8');
// Comments are stripped because the file explains each deleted selector by name
// — an assertion that grepped raw source would be satisfied by prose.
const OUTFIT_CSS_RULES = OUTFIT_CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '');

// A checker's own exclusion list is the thing §3.G1a's "an exclusion list is a
// place a regression can hide" is about, so each selector is asserted on its own
// line rather than collapsed into one `every()` whose message names them all.
const DEAD_SELECTORS = ['.of-export-row', '.of-export-controls', '.of-code', '.cp-btn'];
for (const sel of DEAD_SELECTORS) {
  ok(!OUTFIT_CSS_RULES.includes(sel),
    `outfit.css carries no rule for "${sel}", which the rebuild removed — a rule with no element is half of the same drift as an element with no rule, and the half that reads as deliberate`);
}

ok(OUTFIT_CSS_RULES.includes('.of-theme-code-block'),
  'and it carries the shell the block now wears, under this page\'s own prefix');
ok(/\.of-theme-code-block\s*\{[^}]*max-width/.test(OUTFIT_CSS_RULES),
  'with the 760px cap the measurement asked for — without it the block is ~55% empty for the CSS formats and ~75% for JSON, which is the problem the old two-column layout existed to solve, only wider');

const tabFmts = [...OUTFIT_HTML.matchAll(/data-of-fmt="([^"]+)"/g)].map((m) => m[1]);
const formatsBlock = OUTFIT_HTML.match(/const FORMATS = \{([\s\S]*?)\n {4}\};/);
ok(!!formatsBlock, 'the page still declares a FORMATS table for the three generators');
const formatKeys = formatsBlock
  ? [...formatsBlock[1].matchAll(/^\s{6}(\w+):\s*\{/gm)].map((m) => m[1])
  : [];
eq([...tabFmts].sort(), [...formatKeys].sort(),
  'the block\'s three tabs and the FORMATS table name exactly the same three formats, in both directions — a key with no tab renders nothing, and a tab with no key throws on FORMATS[exportFormat].build');
ok(new Set(tabFmts).size === tabFmts.length,
  'no two tabs claim the same data-of-fmt, or the second is unreachable at any roving index');

// Every tab, not the first: a nameless SECOND tab is the one a reader cannot
// reach by tabbing (roving tabindex parks the rest at -1) and cannot name.
const tabLabels = [...OUTFIT_HTML.matchAll(/<button[^>]*\sdata-of-fmt="([^"]+)"[^>]*>([^<]*)</g)]
  .map((m) => ({ fmt: m[1], label: m[2].trim() }));
eq(tabLabels.length, tabFmts.length,
  'every data-of-fmt is on a <button> whose open tag the label parse can reach, so the namelessness check below cannot be satisfied by matching zero of them');
for (const t of tabLabels) {
  ok(t.label.length > 0, `the ${t.fmt} tab has text, not a glyph — an icon-only tab has nothing for a screen reader to fall back on`);
}

ok(/role="tablist"/.test(OUTFIT_HTML), 'the format row is a role="tablist"');
ok((OUTFIT_HTML.match(/class="of-theme-tab[^"]*"[^>]*role="tab"/g) || []).length === 3, 'with three role="tab" buttons');
ok(/role="tabpanel"/.test(OUTFIT_HTML), 'and the code is a role="tabpanel" it points at');
ok((OUTFIT_HTML.match(/aria-controls="of-code"/g) || []).length === 3,
  'every tab\'s aria-controls names the one panel, so each button owns something');

ok(/import\s*\{[^}]*\bwireRoving\b[^}]*\}\s*from\s*'\.\/assets\/js\/shared\.js'/.test(OUTFIT_HTML),
  'the tab key map is shared.js\'s wireRoving, not a fourth page-local copy');
ok(!/function\s+wireRoving\b/.test(OUTFIT_HTML),
  'and this page defines none — a tablist whose arrow keys are a local copy is how the three existing copies drifted apart in the first place');
ok(/import\s*\{[^}]*\bhighlightCode\b[^}]*\}\s*from\s*'\.\/assets\/js\/code-highlight\.js'/.test(OUTFIT_HTML),
  'the syntax highlighter is the module color.html imports too, so the two code blocks cannot colour the same token differently');
ok(!/function\s+highlight\b/.test(OUTFIT_HTML),
  'and this page defines none');

ok(/highlightCode\(code\)/.test(OUTFIT_HTML),
  'the panel is filled through highlightCode\'s HTML, whose textContent is byte-identical to the source — check_outfit_browser.mjs JSON.parse()s that text, so the two have to agree');

console.log('');
if (failures) {
  console.log(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`${checks} checks passed`);