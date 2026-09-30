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
 * It deliberately does NOT re-derive the palettes. Node has no PNG decoder and
 * the file this guards is a *measurement*, so a re-implementation would only
 * assert that two transcriptions of the same idea agree -- which is a comment
 * about the transcription, not about the images. What is worth checking here is
 * the contract the pages rely on, plus the invariants a silent drift would
 * break.
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
checks += 1; // existsSync sweep counted once

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
  failures === 0
    ? `\nall ${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`
);
process.exit(failures === 0 ? 0 : 1);
