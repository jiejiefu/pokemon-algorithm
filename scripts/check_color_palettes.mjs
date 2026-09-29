/**
 * Colour-palette regression test
 *
 *   node scripts/check_color_palettes.mjs
 *
 * Guards assets/data/color_palettes.json, the file behind the three colour
 * pages. scripts/extract_color_palettes.py builds it by transcribing a
 * Canvas `getImageData` scan (the reference project's color-extractor.ts), so
 * the interesting part is the handful of decisions that each have a plausible
 * wrong answer. All are pinned below.
 *
 * It deliberately does NOT re-derive the palettes. Node has no PNG decoder and
 * the file this guards is a *measurement*, so a re-implementation would only
 * assert that two transcriptions of the same idea agree -- which is a comment
 * about the transcription, not about the images. The algorithm's fidelity rests
 * on the cross-check recorded in the Python script's docstring: a literal
 * per-byte walk of the flat RGBA buffer and the vectorised column-slice agree
 * on all 2,050 sprites. What is worth checking here is the contract the pages
 * rely on, plus the invariants a silent drift would break.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PALETTES = JSON.parse(
  readFileSync(join(ROOT, 'assets/data/color_palettes.json'), 'utf8')
);
const POKEMON = JSON.parse(
  readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8')
);

/** Must match MIN_COLORS / MAX_COLORS / SHARE_THRESHOLD in the extractor. */
const MIN_COLORS = 6;
const MAX_COLORS = 12;
const SHARE_THRESHOLD = 5;

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
// The five palettes that cannot reach the 6-colour floor are a property of the
// sprites, not a defect: each of those sprites genuinely holds five distinct
// colours. If this list grows, a sprite was replaced or the floor changed.
const SHORT_EXPECTED = [
  { id: 201, variant: 'n' },
  { id: 201, variant: 's' },
  { id: 643, variant: 'n' },
  { id: 868, variant: 'n' },
  { id: 868, variant: 's' },
];
const short = [];
const capHits = [];
const entryCounts = [];
let overRounded = 0;

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
      ok(
        share <= prevShare,
        `${label} is not in descending share order at ${hex} (${share} after ${prevShare})`
      );
      // Shares may repeat across neighbouring colours, but a *rise* would mean
      // the ordering was re-sorted numerically instead of by first-seen count.
      prevShare = share;
      total += share;
    }

    // 2 dp rounding across at most 12 terms can lift a total to 100.01.
    // Anything further up means the shares were not derived from one
    // denominator, which is the bug this assertion exists for.
    ok(
      total <= 100.1,
      `${label} shares sum to ${total.toFixed(2)}, which is more than 2 dp rounding explains`
    );
    if (total > 100.005) overRounded += 1;

    // Every colour that clears the threshold must be present. A colour at
    // exactly 5.00% is *not* required: the rule is strictly greater than, so a
    // stored 5.0 could only arrive via the floor, and a stored 4.98 is expected
    // and normal. This is therefore a floor-vs-threshold sanity check, not a
    // re-derivation.
    const overThreshold = rows.filter(([, share]) => share > SHARE_THRESHOLD);
    ok(
      overThreshold.length >= 1,
      `${label} has no colour above ${SHARE_THRESHOLD}%, so the floor did all the work`
    );
  }
}

// --- the roster-wide tally --------------------------------------------------
// These are measured properties of the 2,050 sprites, asserted so that a change
// in the sampling stride, the alpha floor or the exclusion list shows up as a
// number that moved rather than as a page that looks slightly wrong.
eq(
  short.map((s) => `${s.id}${s.variant}`).sort(),
  SHORT_EXPECTED.map((s) => `${s.id}${s.variant}`).sort(),
  'the set of palettes below the 6-colour floor changed'
);
ok(
  capHits.length === 0,
  `${capHits.length} palettes hit the ${MAX_COLORS}-colour cap, which never fired before`
);

const distribution = {};
for (const n of entryCounts) distribution[n] = (distribution[n] || 0) + 1;
const totalEntries = entryCounts.reduce((a, b) => a + b, 0);

ok(
  totalEntries === 13767,
  `total colour entries is ${totalEntries}, measured 13767 across 2050 palettes`
);
ok(
  distribution[6] === 1187,
  `${distribution[6]} palettes hold exactly 6 colours, measured 1187 -- the 6-colour floor is what binds`
);
ok(
  Math.max(...entryCounts) === 11,
  `longest palette holds ${Math.max(...entryCounts)} colours, measured 11 (the 12 cap never binds)`
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
console.log(`sum > 100.005 ${overRounded} (2 dp rounding)`);

console.log(
  failures === 0
    ? `\nall ${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`
);
process.exit(failures === 0 ? 0 : 1);
