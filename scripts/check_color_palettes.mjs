/**
 * Colour-palette regression test
 *
 *   node scripts/check_color_palettes.mjs
 *
 * Guards assets/data/color_palettes.json, the file behind the three colour
 * pages. It is written by scripts/extract_color_palettes_mmcq.py, which runs
 * MMCQ's VBox partition over all 2,050 sprites and then replaces each region's
 * centroid with the most frequent *real* pixel inside it. The sibling script
 * scripts/extract_color_palettes.py still exists and still transcribes the
 * reference project's Canvas `getImageData` scan; it is not what produced this
 * file, and its >5%-share rule is not the rule being guarded here.
 *
 * It deliberately does NOT re-derive the palettes. That is not because it
 * cannot -- `scripts/lib/png.mjs` now decodes the sprites and
 * `scripts/check_outfit_page.mjs` regenerates all 2,050 of them exactly -- but
 * because the two files answer different questions. This one guards the
 * CONTRACT the three colour pages rely on: the roster, the share-sum invariant,
 * the five-colour exceptions, the shiny rules. The other guards whether
 * `assets/js/mmcq.js` still agrees with `extract_color_palettes_mmcq.py`, which
 * is a statement about a transcription and has no meaning here. Keeping them
 * apart means neither one has to carry the other's argument.
 *
 * What is worth checking here is the contract the pages rely on, plus the
 * invariants a silent drift would break.
 *
 * The one invariant that catches an algorithm swap rather than a data edit is
 * the share-sum. Because a share belongs to a *colour* (counted from the global
 * histogram) and not to the region that colour won, the six reported shares sum
 * to well under 100: measured median 71.95%, min 34.69%, max 100.00%. The other
 * plausible implementations of the same idea both break it, in opposite
 * directions:
 *
 *   - region shares + a top-up pass          -> sums ABOVE 100 (Bulbasaur: 131.28)
 *   - region shares, renormalised to 100     -> every palette sums to exactly 100
 *
 * so both the per-palette ceiling and the roster median are pinned below.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  chroma,
  isNeutral,
  neutralName,
  describeHex,
  chineseColorName,
  chineseColorNameWithEn,
  colorTemperature,
  hexToHsl,
  NEUTRAL_CHROMA,
} from '../assets/js/color-palette.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Defaults to the tracked file. An override exists so the guards below can be
// negative-tested against a deliberately broken copy -- a checker that has only
// ever seen good data is not known to check anything, since "all 95313 checks
// passed" and "the assertions never fire" are the same output.
const PALETTE_PATH = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(ROOT, 'assets/data/color_palettes.json');
const PALETTES = JSON.parse(readFileSync(PALETTE_PATH, 'utf8'));
const POKEMON = JSON.parse(
  readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8')
);

/** Must match COLOR_COUNT / MIN_COLORS / MAX_COLORS in the extractor. */
const MIN_COLORS = 6;
const MAX_COLORS = 6;

const HEX = /^#[0-9a-f]{6}$/;
const EXCLUDED = new Set(['#000000', '#101010', '#121212', '#010101', '#0f0f0f']);

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, eq } = C;

const IDS = POKEMON.map((p) => p.id).sort((a, b) => a - b);

// --- roster agreement -------------------------------------------------------
// The extractor refuses to write against an unexpected roster, but a palette
// file that drifted from pokemon_data.json afterwards would still be served.
eq(
  Object.keys(PALETTES).map(Number).sort((a, b) => a - b),
  IDS,
  'color_palettes.json keys must be exactly the ids in pokemon_data.json'
);

// --- per-palette shape ------------------------------------------------------
// Three palettes cannot reach 6 colours, and that is a property of the sprites:
// #201 is Unown (a flat letterform) and #643 is Kartana (a flat blade), so
// neither has six distinct colours surviving the alpha and background filters.
// MMCQ also hands back a box that captures nothing on Bulbasaur shiny, which
// costs a representative and is why the extractor's top-up pass exists.
// If this list changes, a sprite was replaced or the filter moved -- it is not
// a number to "fix" by relaxing either.
const SHORT_EXPECTED = [
  { id: 201, variant: 'n' },
  { id: 201, variant: 's' },
  { id: 643, variant: 'n' },
];
const short = [];
const capHits = [];
const entryCounts = [];
const shareSums = [];

for (const id of IDS) {
  const entry = PALETTES[String(id)];
  ok(!!entry, `palette ${id} is missing`);

  for (const variant of ['n', 's']) {
    const rows = entry?.[variant];
    ok(Array.isArray(rows), `#${id} ${variant} should be an array`);
    if (!Array.isArray(rows)) continue;

    const label = `#${id} ${variant}`;

    ok(rows.length >= 1, `${label} has no colours`);
    ok(rows.length <= MAX_COLORS, `${label} has ${rows.length} colours, over the ${MAX_COLORS} cap`);
    entryCounts.push(rows.length);
    if (rows.length < MIN_COLORS) short.push({ id, variant });
    if (rows.length === MAX_COLORS) capHits.push({ id, variant });

    let prevShare = Infinity;
    let total = 0;
    let prevHex = null;
    for (const row of rows) {
      ok(
        Array.isArray(row) && row.length === 2,
        `${label} row ${JSON.stringify(row)} should be [hex, share]`
      );
      const [hex, share] = row;

      ok(HEX.test(hex), `${label} "${hex}" is not a lowercase #rrggbb`);
      // Lowercase matters: the page feeds these straight into CSS custom
      // properties and into getReadableTextColor(), which lower-cases too, so
      // a mixed-case file would still work — but a file that stopped being
      // byte-stable would break the "same input, same cache key" assumption.
      ok(hex === hex.toLowerCase(), `${label} "${hex}" is not lower-case`);
      ok(!EXCLUDED.has(hex), `${label} carries excluded near-black ${hex}`);
      ok(hex !== prevHex, `${label} repeats ${hex}; the ranking must be distinct colours`);
      prevHex = hex;

      ok(
        typeof share === 'number' && Number.isFinite(share) && share > 0 && share <= 100,
        `${label} share for ${hex} should be a positive number <= 100, got ${share}`
      );
      // Strictly non-increasing. The extractor sorts by `(-share, hex)` after
      // its top-up pass precisely so this holds: an empty MMCQ region lets a
      // much larger colour in at the end of the list.
      ok(
        share <= prevShare,
        `${label} is not in descending share order at ${hex} (${share} after ${prevShare})`
      );
      prevShare = share;
      total += share;
    }

    // See the module docstring. Above 100 means the shares came from regions and
    // the top-up counted pixels twice; Bulbasaur normal reaches 131.28 that way.
    ok(
      total <= 100.1,
      `${label} shares sum to ${total.toFixed(2)}, above the ${100.1} a 2 dp rounding explains -- shares are being counted per region, not per colour`
    );
    shareSums.push(total);
  }
}

// --- the roster-wide tally --------------------------------------------------
// Measured properties of the 2,050 sprites, asserted so that a change in the
// colour count, the alpha floor or the exclusion list shows up as a number that
// moved rather than as a page that looks slightly wrong.
eq(
  short.map((s) => `${s.id}${s.variant}`).sort(),
  SHORT_EXPECTED.map((s) => `${s.id}${s.variant}`).sort(),
  'the set of palettes below the 6-colour floor changed'
);
eq(capHits.length, 2047, `${capHits.length} palettes hit the 6-colour cap, measured 2047 -- the cap binds for every palette except the three short ones`);

const distribution = {};
for (const n of entryCounts) distribution[n] = (distribution[n] || 0) + 1;
const totalEntries = entryCounts.reduce((a, b) => a + b, 0);

ok(
  totalEntries === 12297,
  `total colour entries is ${totalEntries}, measured 12297 across 2050 palettes`
);
ok(
  distribution[5] === 3 && distribution[6] === 2047 && Object.keys(distribution).length === 2,
  `distribution is ${JSON.stringify(distribution)}, measured {5: 3, 6: 2047}`
);

// The share-sum median is the second half of the region-vs-colour guard. A
// renormalised-to-100 file passes the per-palette ceiling and fails here.
const sortedSums = [...shareSums].sort((a, b) => a - b);
const medianSum = sortedSums[Math.floor(sortedSums.length / 2)];
eq(
  [Math.min(...shareSums).toFixed(2), medianSum.toFixed(2), Math.max(...shareSums).toFixed(2)],
  ['34.69', '71.95', '100.00'],
  'share-sum min / median / max moved'
);

// --- spot check: the palettes a human looked at -----------------------------
// Node cannot tell a real pixel from an MMCQ centroid without the sprite, so
// the snap itself is unpinnable here. These two are the next best thing: exact
// values, read off sprites whose colours were inspected by hand, and the reason
// the algorithm exists -- the normal palette's sixth colour is the red
// `#ac0031` (3.05%) that the old >5% rule could never surface. `#ee2039` (0.93%)
// is a real red in the same sprite but 7 pixels, and loses the sixth slot.
eq(
  PALETTES['1'].n,
  [
    ['#399494', 29.4],
    ['#62d5b4', 13.25],
    ['#83eec5', 10.73],
    ['#73ac31', 10.07],
    ['#bdff73', 5.17],
    ['#ac0031', 3.05],
  ],
  'Bulbasaur normal palette moved'
);
eq(
  PALETTES['1'].s,
  [
    ['#73a431', 29.4],
    ['#9cd54a', 13.25],
    ['#c5f652', 10.73],
    ['#316220', 10.2],
    ['#008320', 10.07],
    ['#005a00', 2.91],
  ],
  'Bulbasaur shiny palette moved'
);

// --- how the palette swatches get NAMED -------------------------------------
// The data above is a measurement; these checks are about the two namers the
// three colour pages print from, and they exist because the pages print TWO of
// them side by side. color.html:589 writes `describeHex(primary)` into the
// prose and color.html:577 writes `chineseColorName(hex)` into the swatch list
// — for the same hex, on the same page. Before the chroma gate those disagreed
// on 97.6% of primary colours, and the disagreement was not two words for one
// colour: each of them was separately wrong about greys.
//
// Arceus #493 was the visible one. Its primary is #e6e6ee at 35.73%, channels
// 230/230/238, so max−min = 8 of 255. That is a grey. describeHex() read hue
// 240 and lightness 91.8, and never looked at saturation, so it said 淺藍
// (light blue); chineseColorName() ran a 100-entry nearest-neighbour over RGB
// and landed on 薰衣草紫 (lavender, #E6E6FA, 12 away in the blue channel). The
// page said both.
//
// Three properties are asserted, each because one of the three functions
// broke independently of the other two:
//
//   1. A swatch below NEUTRAL_CHROMA is named a grey. describeHex() failed this
//      on the pure grey #6a6a6a by calling it 紅 (red) — `max === min` leaves h
//      at 0, which falls into the first hue bucket. chineseColorName() failed it
//      on #414141, which nearest-neighbour returned 墨綠 (dark green) for: an
//      entry 8 away in one channel beats every 淺灰 (light grey) that is 20 away
//      in all three.
//   2. The two namers agree on every sub-threshold swatch, because the page
//      shows them to the reader as one answer.
//   3. colorTemperature() agrees with the name, because the page prints 色溫
//      (color temperature) on the same block as the colour name.
const GREY_NAMES = new Set(['黑', '白', '深灰', '灰色', '淺灰', '灰白']);
const CHROMATIC_NAMES = /[紅橙黃綠青藍紫粉]/;
const allSwatches = [];
for (const id of IDS) {
  for (const variant of ['n', 's']) {
    for (const [hex] of PALETTES[String(id)]?.[variant] || []) allSwatches.push(hex);
  }
}

const neutralSwatches = allSwatches.filter(isNeutral);
ok(
  neutralSwatches.length > 0,
  'no sub-threshold swatches at all — the gate is either unreachable or the threshold is nonsense'
);
ok(
  allSwatches.length - neutralSwatches.length > 0,
  'every swatch is below the chroma threshold, so nothing is being named as a colour'
);

const misnamedByDescribe = [];
const misnamedByTable = [];
const nameDisagreements = [];
const miscastTemperature = [];
for (const hex of neutralSwatches) {
  const byDescribe = describeHex(hex);
  const byTable = chineseColorName(hex);
  if (CHROMATIC_NAMES.test(byDescribe)) misnamedByDescribe.push(`${hex} -> ${byDescribe}`);
  if (CHROMATIC_NAMES.test(byTable)) misnamedByTable.push(`${hex} -> ${byTable}`);
  if (byDescribe !== byTable) nameDisagreements.push(`${hex}: ${byDescribe} / ${byTable}`);
  if (colorTemperature(hex) !== 'neutral') {
    miscastTemperature.push(`${hex} -> ${colorTemperature(hex)}`);
  }
}
ok(
  misnamedByDescribe.length === 0,
  `describeHex() gave ${misnamedByDescribe.length} sub-${NEUTRAL_CHROMA}-chroma swatches a chromatic name: ${misnamedByDescribe.slice(0, 5).join(', ')}`
);
ok(
  misnamedByTable.length === 0,
  `chineseColorName() gave ${misnamedByTable.length} sub-${NEUTRAL_CHROMA}-chroma swatches a chromatic name: ${misnamedByTable.slice(0, 5).join(', ')}`
);
ok(
  nameDisagreements.length === 0,
  `the prose namer and the list namer disagree on ${nameDisagreements.length} grey swatches the page shows side by side: ${nameDisagreements.slice(0, 5).join(', ')}`
);
ok(
  miscastTemperature.length === 0,
  `${miscastTemperature.length} grey swatches are also given a warm/cool verdict: ${miscastTemperature.slice(0, 5).join(', ')}`
);

/* The gate must not eat a colour. Without this the four checks above pass
   trivially if NEUTRAL_CHROMA is raised to 255 — every swatch becomes 灰白,
   nothing is ever misnamed, and the page loses every colour name it has.

   白 is excluded from the "lost" set, and has to be: describeHex() answers 白
   for anything lighter than l=0.93 regardless of chroma, so #ffffde (chroma 33,
   clearly above the gate) is 白 on the lightness branch, not demoted by it. The
   four names below are the ones ONLY the gate can produce, which is exactly what
   makes them the right detector.

   This is not sufficient on its own, and that is measured rather than assumed:
   at NEUTRAL_CHROMA = 255 there are no chromatic swatches left, so this check
   counts zero demotions and passes while the page has lost every colour name it
   had. The four pinned chromatic hexes below are what actually catch that. */
const chromaticSwatches = allSwatches.filter((hex) => !isNeutral(hex));
const lostColour = chromaticSwatches.filter((hex) => /^(深灰|灰色|淺灰|灰白)$/.test(describeHex(hex)));
eq(
  lostColour.length,
  0,
  `${lostColour.length} chromatic swatches were demoted to a grey name: ${lostColour.slice(0, 5).join(', ')}`
);

// Every grey name is actually reachable, so the branch is not five labels with
// one of them carrying all 2,387 swatches.
const greyHistogram = {};
for (const hex of neutralSwatches) {
  const name = neutralName(hex);
  greyHistogram[name] = (greyHistogram[name] || 0) + 1;
}
eq(
  Object.keys(greyHistogram).sort(),
  ['灰白', '白', '深灰', '灰色', '淺灰', '黑'].filter((n) => greyHistogram[n] > 0).sort(),
  'the grey branch produced names outside its own five'
);
for (const name of ['深灰', '灰色', '淺灰', '灰白']) {
  ok(
    greyHistogram[name] > 0,
    `no sub-threshold swatch was named ${name}, so that lightness band is unreachable`
  );
}

/* chroma() is the ABSOLUTE measure and must not be HSL saturation under another
   name. #fffff6 is the case that proves it: three channels apart, so chroma 9
   and a grey, while its HSL saturation is 100% — s is a ratio against lightness,
   so a near-white whose channels differ by nine reads as fully saturated. Swap
   the gate onto `s` and every near-white flips from grey to a loud colour name,
   and near-whites are the largest single grey bucket in the corpus (白: 698 of
   the 2,387). #e6e6ee is the mirror image: s=19%, and the reader calls it grey. */
eq(chroma('#fffff6'), 9, 'chroma() on #fffff6');
eq(chroma('#e6e6ee'), 8, 'chroma() on #e6e6ee');
eq(chroma('#000000'), 0, 'chroma() on #000000');
// Rounded: hexToHsl returns the raw float, so 19.04761904761906 would be the
// literal here and the comparison would be about float printing, not colour.
eq(
  [hexToHsl('#fffff6').s, hexToHsl('#e6e6ee').s].map((v) => v.toFixed(1)),
  ['100.0', '19.0'],
  'the two hexes chroma() separates are exactly the two HSL saturation gets backwards'
);
ok(
  isNeutral('#fffff6'),
  '#fffff6 reads s=100% but is 9 channels from grey; an HSL-based gate would call it a colour'
);
// 白 rather than 灰白, because at l=98% it is white by any reading. The point of
// the assertion is that it is a GREY name: the old hue path would have called it
// 淺黃, from the h=60 it computes for a channel spread of nine.
ok(
  describeHex('#fffff6') === '白',
  `#fffff6 should be named a grey, not 淺黃 — describeHex() said ${describeHex('#fffff6')}`
);

// The three grey-boundary hexes the threshold was chosen against, with the
// names a reader would expect. Arceus is the regression this section exists for.
eq(
  [
    [describeHex('#e6e6ee'), chineseColorName('#e6e6ee'), colorTemperature('#e6e6ee')],
    [describeHex('#6a6a6a'), chineseColorName('#6a6a6a'), colorTemperature('#6a6a6a')],
    [describeHex('#414141'), chineseColorName('#414141'), colorTemperature('#414141')],
    [describeHex('#eeeeee'), chineseColorName('#eeeeee'), colorTemperature('#eeeeee')],
  ],
  [
    ['灰白', '灰白', 'neutral'],
    ['灰色', '灰色', 'neutral'],
    ['灰色', '灰色', 'neutral'],
    ['白', '白', 'neutral'],
  ],
  'the grey names for the four hexes that were mis-named'
);
// And the neighbouring chromatic values must keep their colour names, which is
// what says the threshold sits in the gap and not inside a colour.
eq(
  [
    describeHex('#394152'),
    describeHex('#6a8b5a'),
    describeHex('#ffd700'),
    describeHex('#399494'),
  ],
  ['深藍', '綠', '黃', '青'],
  'chromatic swatches near the threshold lost their colour names'
);
// chineseColorNameWithEn is the third namer and shares the gate, so a grey must
// not come back as "灰白 Lavender" — the exact claim being corrected.
eq(
  [chineseColorNameWithEn('#e6e6ee'), chineseColorNameWithEn('#414141')],
  ['灰白', '灰色'],
  'chineseColorNameWithEn() still pairs a grey with a chromatic English name'
);

// --- the two source images exist -------------------------------------------
// The pages render a normal/shiny toggle unconditionally, so a palette whose
// sprite is absent would still produce a colour strip -- just one measured
// against a file that is not there. Checking it here is cheaper than a broken
// image in a browser.
for (const id of IDS) {
  for (const sub of ['', 'shiny']) {
    const path = join(ROOT, 'assets/images/sprite', sub, `${id}.png`);
    if (!existsSync(path)) {
      ok(false, `missing sprite ${path.replace(ROOT + '/', '')} for #${id}`);
    }
  }
}
ok(true, 'every normal and shiny sprite exists on disk'); // existsSync sweep counted once

console.log(`palettes      ${IDS.length} ids x 2 variants = ${IDS.length * 2}`);
console.log(`entries       ${totalEntries} (avg ${(totalEntries / entryCounts.length).toFixed(2)})`);
console.log(`distribution  ${Object.keys(distribution)
  .map(Number)
  .sort((a, b) => a - b)
  .map((n) => `${n}:${distribution[n]}`)
  .join('  ')}`);
console.log(`below floor   ${short.length} (sprites with fewer than ${MIN_COLORS} colours)`);
console.log(`at cap        ${capHits.length}`);
console.log(`share sum     min ${Math.min(...shareSums).toFixed(2)}  median ${medianSum.toFixed(2)}  max ${Math.max(...shareSums).toFixed(2)}`);

console.log(
  C.failures.length === 0
    ? `\nall ${C.checks} checks passed`
    : `\n${C.failures.length} of ${C.checks} checks FAILED`
);
process.exit(C.failures.length === 0 ? 0 : 1);
