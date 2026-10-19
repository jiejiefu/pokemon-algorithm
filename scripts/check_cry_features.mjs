#!/usr/bin/env node
/**
 * Verify assets/data/cry_features.json against the rosters in cry-index.js and
 * against what the audio can physically be.
 *
 * Run: node scripts/check_cry_features.mjs
 * Test: node scripts/test_check_cry_features.mjs  (proves each check can fail)
 *
 * WHAT IS AND IS NOT GUARDED HERE
 *
 * The rows must be exactly the roster. This is checked against cry-index.js by
 * importing it rather than by parsing it, because the rosters are the set the
 * player will actually try to play: a feature row for a species with no audio is
 * a search that offers a result which 404s when clicked.
 *
 * Every number must be finite. This is the assertion that earns its keep. The
 * corpus contains three files that are MPEG layer III behind an .ogg name, and
 * an MP3 decoder emits a run of near-silence whose level depends on the encoder;
 * the three standard ratios in the extractor (centroid over total power,
 * flatness as geometric over arithmetic mean, flux against a mean magnitude) each
 * divide by something that is zero for a silent segment. One NaN in the matrix
 * does not stay in its own row -- it poisons every comparison it takes part in,
 * and a comparison involving NaN is silently never the nearest neighbour, so the
 * search quietly returns nothing rather than returning wrong.
 *
 * The values must be physically possible. Duration, peak, RMS, zero-crossing
 * rate, centroid, rolloff, flatness and flux cannot be negative. The MFCC
 * standard deviations cannot be negative either, which is a cheap way to catch a
 * variance computed with the wrong axis.
 *
 * EVERY DIMENSION MUST VARY ACROSS THE CORPUS. A constant column means the
 * extractor is emitting a number that is always the same -- a filterbank that
 * collapsed, a DCT that returned its first row, a frame loop that never ran. Such
 * a file looks completely healthy to a shape check and to a NaN check, and the
 * similarity search degrades to chance without any error anywhere. This is the
 * assertion that would have caught a silently broken MFCC, and it is why it is
 * here rather than a note in the extractor.
 *
 * LEGACY AND LATEST ARE NOT COMPARABLE, and this file does not pretend they are.
 * Measured: legacy centroid reaches 6,154 Hz against latest's 3,167 Hz, and
 * legacy flatness runs two orders of magnitude higher. Every legacy file sits at
 * 10,512 Hz while the latest files are mostly at 32,728 Hz. That is a difference
 * in how the two sets were recorded, not a difference between the Pokémon, so a
 * similarity search across the two would partly rank by recording generation.
 * The two sets are therefore stored under separate keys and each is range-checked
 * on its own terms; mixing them is the consumer's decision to make knowingly.
 *
 * NO SIMILARITY MATRIX IS STORED. 1,025 squared floats is 4 MB, and the browser
 * can multiply the rows it already has. Asserting the file has no such key keeps
 * a well-meaning "optimisation" from turning a 500 KB payload into 4 MB.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRY_IDS, LEGACY_CRY_IDS, CRY_SOURCE } from '../assets/js/cry-index.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const C = createChecker({ stream: true });
const { ok } = C;
const eq = (got, want, what) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want: ${b}`}`);
};

const f = read('assets/data/cry_features.json');
const analyzer = readFileSync(join(ROOT, 'scripts/analyze_cries.py'), 'utf8');

// The first eight are measurements; the rest are 13 MFCC means and 13 MFCC
// standard deviations. Named here rather than duplicated in the extractor so a
// rename in one place without the other is a named failure.
const SCALARS = ['dur', 'peak', 'rms', 'zcr', 'centroid', 'rolloff85', 'flatness', 'flux'];
const EXPECTED_NAMES = [
  ...SCALARS,
  ...Array.from({ length: 13 }, (_, i) => `m${i}`),
  ...Array.from({ length: 13 }, (_, i) => `ms${i}`),
];
/** Where the standard-deviation block starts, derived from the names. */
const STD_FROM = EXPECTED_NAMES.indexOf('ms0');

// ---------------------------------------------------------------------------
// Shape and provenance.
// ---------------------------------------------------------------------------

eq(Object.keys(f).sort(), ['dimensions', 'featureNames', 'latest', 'legacy', 'note', 'sampleRate', 'source'],
  'the file carries exactly the expected keys');
eq(f.source, CRY_SOURCE, 'the features point at the same source the cry roster does');
eq(f.sampleRate, 16_000, 'every row was resampled to 16 kHz');
eq(f.featureNames, EXPECTED_NAMES, 'the feature names are the agreed 34 in order');
eq(f.dimensions, EXPECTED_NAMES.length, 'the declared width matches the feature names');

ok(analyzer.includes('SR = 16_000'), 'the extractor still analyses at 16 kHz');
ok(/^REPO|^CRY_SOURCE\s*=\s*"https:\/\/github\.com\/PokeAPI\/cries"/m.test(analyzer),
  'the extractor still credits PokeAPI/cries');

// A precomputed similarity matrix is the one thing that must never appear here.
const matrixish = Object.keys(f).filter((k) => /similar|matrix|dist|distances|embed/i.test(k));
eq(matrixish, [], 'no similarity matrix is stored in the payload');

for (const set of ['latest', 'legacy']) {
  ok(f[set] && typeof f[set] === 'object', `${set} is present`);

  const roster = set === 'latest' ? CRY_IDS : LEGACY_CRY_IDS;
  const ids = Object.keys(f[set]).map(Number).sort((a, b) => a - b);
  eq(ids, [...roster].sort((a, b) => a - b),
    `${set} covers exactly the ${roster.size} ids in cry-index.js`);

  const rows = Object.values(f[set]);
  const ragged = Object.entries(f[set]).filter(([, v]) => v.length !== EXPECTED_NAMES.length)
    .map(([id, v]) => `#${id}: ${v.length} values`);
  eq(ragged, [], `every ${set} row is exactly ${EXPECTED_NAMES.length} numbers wide`);

  // ---- finite, and typed as numbers -------------------------------------
  const bad = [];
  for (const [id, row] of Object.entries(f[set])) {
    for (let k = 0; k < row.length; k++) {
      const v = row[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        bad.push(`#${id} ${EXPECTED_NAMES[k]}=${v}`);
      }
    }
  }
  eq(bad, [], `no ${set} row holds a NaN, an Infinity or a non-number`);

  // ---- physically possible ----------------------------------------------
  const impossible = [];
  const durIdx = EXPECTED_NAMES.indexOf('dur');
  const peakIdx = EXPECTED_NAMES.indexOf('peak');
  const rmsIdx = EXPECTED_NAMES.indexOf('rms');
  const centroidIdx = EXPECTED_NAMES.indexOf('centroid');
  const rolloffIdx = EXPECTED_NAMES.indexOf('rolloff85');
  const zcrIdx = EXPECTED_NAMES.indexOf('zcr');
  for (const [id, row] of Object.entries(f[set])) {
    for (const name of SCALARS) {
      if (row[EXPECTED_NAMES.indexOf(name)] < 0) {
        impossible.push(`#${id} ${name}=${row[EXPECTED_NAMES.indexOf(name)]}`);
      }
    }
    if (!(row[durIdx] > 0)) impossible.push(`#${id} dur=${row[durIdx]}`);
    if (!(row[peakIdx] > 0)) impossible.push(`#${id} peak=${row[peakIdx]}`);
    if (!(row[rmsIdx] > 0)) impossible.push(`#${id} rms=${row[rmsIdx]}`);
    if (row[rmsIdx] > row[peakIdx]) impossible.push(`#${id} rms ${row[rmsIdx]} > peak ${row[peakIdx]}`);
    if (row[centroidIdx] > f.sampleRate / 2) impossible.push(`#${id} centroid above Nyquist`);
    if (row[rolloffIdx] > f.sampleRate / 2) impossible.push(`#${id} rolloff85 above Nyquist`);
    // One sign change per adjacent sample pair is the physical maximum, so the
    // ceiling is the sample rate itself and not half of it. Legacy reaches past
    // 8,000/s because those files carry real content near Nyquist, which is the
    // same recording difference the centroid medians show.
    if (row[zcrIdx] > f.sampleRate) impossible.push(`#${id} zcr exceeds the sample rate`);
    // Only the standard deviations are non-negative. The MFCC *means* are DCT
    // coefficients of log filterbank energies and are routinely negative --
    // checking the wrong half of the block would fail on correct data.
    for (let k = STD_FROM; k < row.length; k++) {
      if (row[k] < 0) impossible.push(`#${id} ${EXPECTED_NAMES[k]}=${row[k]}`);
    }
  }
  eq(impossible, [], `every ${set} value is physically possible`);

  // ---- every dimension carries information -------------------------------
  // A column that never changes is a column that is not measuring anything.
  const flat = [];
  for (let k = 0; k < EXPECTED_NAMES.length; k++) {
    const values = Object.values(f[set]).map((r) => r[k]);
    const spread = Math.max(...values) - Math.min(...values);
    if (!(spread > 0)) flat.push(`${EXPECTED_NAMES[k]} is constant at ${values[0]}`);
  }
  eq(flat, [], `every one of the ${EXPECTED_NAMES.length} ${set} dimensions varies across the corpus`);

  const matrix = Object.values(f[set]).map((r) => r.slice());
  const stat = (k) => {
    const v = matrix.map((r) => r[k]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    return { min: Math.min(...v), max: Math.max(...v), mean, sd };
  };

  console.log('');
  console.log(`  ${set}: ${Object.keys(f[set]).length} rows x ${EXPECTED_NAMES.length}`);
  for (const name of ['dur', 'peak', 'centroid', 'flatness']) {
    const s = stat(EXPECTED_NAMES.indexOf(name));
    console.log(`    ${name.padEnd(9)} ${s.min.toFixed(3).padStart(9)} .. ${s.max.toFixed(3).padStart(9)}  sd ${s.sd.toFixed(3)}`);
  }
}

// ---------------------------------------------------------------------------
// The two sets are stored apart, and each is range-checked on its own terms.
// ---------------------------------------------------------------------------

const centroidOf = (set) => Object.values(f[set]).map((r) => r[EXPECTED_NAMES.indexOf('centroid')]);
const latestMedian = median(centroidOf('latest'));
const legacyMedian = median(centroidOf('legacy'));
console.log('');
console.log(`  centroid median: latest ${latestMedian.toFixed(0)} Hz, legacy ${legacyMedian.toFixed(0)} Hz`);
console.log('  (the two sets are not comparable: legacy is recorded brighter, so a');
console.log('   similarity search across both would rank by recording generation)');

ok(Math.abs(latestMedian - legacyMedian) > 100,
  'the known offset between the two recorded sets is still present, so a change that quietly merged them would be noticed');

/** Every legacy row differs from its latest counterpart, and they are distinct rows. */
const shared = [...LEGACY_CRY_IDS].filter((id) => f.latest[String(id)] !== undefined);
eq(shared.length, LEGACY_CRY_IDS.size, 'every legacy species also has a latest row');

const identical = shared.filter((id) =>
  JSON.stringify(f.latest[String(id)]) === JSON.stringify(f.legacy[String(id)]));
eq(identical, [],
  'no legacy row is copied from its latest counterpart, so the two sets stay distinct recordings');

/** A similarity matrix would be the natural optimisation and the wrong one. */
ok(f.latest !== f.legacy && Object.keys(f.latest).length !== Object.keys(f.legacy).length,
  'latest and legacy are stored as separate tables');

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

console.log('');
console.log(`  payload: ${(readFileSync(join(ROOT, 'assets/data/cry_features.json')).length / 1024).toFixed(0)} KB`);
if (C.failures.length) {
  console.log(`FAIL  ${C.failures.length} of ${C.checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${C.checks} checks`);