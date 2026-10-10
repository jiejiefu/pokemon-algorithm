#!/usr/bin/env node
/**
 * Prove that check_spectrogram_port.mjs can actually fail, one deliberate defect
 * at a time.
 *
 * Run: node scripts/test_check_spectrogram_port.mjs
 *
 * WHAT IS BEING ATTACKED
 * ----------------------
 * `cry-spectrogram.js` is a port of `analyze_cries.py`, and its only real claim
 * is that it is the same measurement. That claim is checked by differencing the
 * two, which is a strong check — and a strong check that cannot fail is worse
 * than no check, because it is indistinguishable from a correct one.
 *
 * So every case here is a way of writing the JavaScript differently while keeping
 * it syntactically valid, obviously reasonable, and wrong. The two that matter
 * most are cases 1 and 2, because both are mistakes this port really made.
 *
 * CASE 2 IS NOT HYPOTHETICAL. The frame buffer is reused across frames and
 * `fft` transforms IN PLACE, so the first version omitted the `fill(0)` before
 * the `set` — and left 112 bins of the previous frame's spectrum sitting in the
 * zero-pad tail, to be read as if they were samples. Frame 0 was correct either
 * way. `dur` and `zcr` were exact. `rolloff85` was exact. Only the features that
 * AVERAGE over frames moved, and the worst of them was `ms7` off by a factor of
 * six. Nothing about that looks broken; it looks like a feature distribution.
 *
 * THE SCRATCH TREE, AND WHY IT SITS BESIDE A SYMLINKED VENV
 * ----------------------------------------------------------
 * The checker imports the module by relative path, so the mutation has to happen
 * in a copy of the tree. It also shells out to `../.venv/bin/python`, resolved
 * from its own location — and a `mkdtemp` in /tmp has no `../.venv`. Without the
 * symlink the checker prints its SKIP line, exits 0, and every case below would
 * report FAIL having run zero assertions, which reads like a broken harness
 * rather than a missing interpreter. The baseline case below is what proves the
 * tree is sound.
 *
 * Only `cry-spectrogram.js`, the checker and `analyze_cries.py` are copied: the
 * module imports nothing at all, which is the whole reason it can be checked by
 * running it, and a wider tree would hide a new dependency rather than expose
 * one.
 *
 * EACH CASE NAMES THE ASSERTION THAT CATCHES IT, not the summary line. Every
 * feature failure also trips "every comparable feature agrees to 0.0001", so a
 * case naming that would pass whether or not the feature it broke was noticed.
 *
 * Two of these were mislabelled on their first run, and both were caught by
 * something rather than by what they claimed. `m1` was named for the periodic
 * window because the extractor's own comment says MFCC coefficients 1 and 2 drift
 * without the area normalisation — but that comment is about the FILTERBANK, and
 * a window's ends weigh the outer BANDS, which is m4's territory: the window case
 * leaves m1 inside 1e-4 and puts the worst at m4, 5.9e-3. And a case naming the
 * log-mel grid wrote `1e-3` where the checker prints the interpolated `0.001`, so
 * it was "caught by" a description that never appeared. A checker that formats a
 * number into its own description is a trap for its negative suite, which is why
 * the per-feature descriptions below deliberately carry no values.
 */

import { execFile } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = 'assets/js/cry-spectrogram.js';
const CHECKER = 'scripts/check_spectrogram_port.mjs';
const EXTRACTOR = 'scripts/analyze_cries.py';
const VENV = join(ROOT, '..', '.venv');

/** Parent of every scratch tree, so `ROOT/../.venv` can be made to resolve. */
const BASE = join(tmpdir(), 'spectrogram-neg');
mkdirSync(BASE, { recursive: true });
if (!existsSync(join(BASE, '.venv'))) symlinkSync(VENV, join(BASE, '.venv'), 'dir');

/* BASE IS REMOVED ON EXIT. Each case's `tree-*` inside it is removed on its own, but
 * BASE itself was created here at module load and owned by nothing, so one empty
 * directory survived every run of this harness — 0 bytes, which is why it went unnoticed
 * next to the 5.6 GB leak it was found alongside. Removing the parent also sweeps any
 * case tree whose own `rmSync` was skipped, and `force: true` makes this a no-op when
 * the directory is already gone. The `.venv` symlink inside is a link, not a copy, so
 * this cannot delete the real virtualenv — which is the whole reason BASE exists. */
process.on('exit', () => { try { rmSync(BASE, { recursive: true, force: true }); } catch { /* already gone */ } });

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A `replace` that refuses to be silent.
 *
 *  Two `color_match` cases passed for a fourth reason: their target string no
 *  longer existed after an earlier edit, so `replace` was a no-op and the case
 *  proved nothing while reporting honestly. Every mutation here goes through
 *  this, and each case additionally asserts the file it edited really changed. */
const replaceOrThrow = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutation target not found: ${JSON.stringify(from)}`);
  const out = src.replace(from, to);
  if (out === src) throw new Error(`mutation replaced nothing: ${JSON.stringify(from)}`);
  return out;
};

function makeTree(mutate) {
  const dir = mkdtempSync(join(BASE, 'tree-'));
  for (const f of [MODULE, CHECKER, EXTRACTOR]) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

/* Async, and on process.execPath rather than whatever 'node' is first on PATH — the
 * baseline and the mutations must run the SAME interpreter or they are not comparable. */
const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

const editModule = (dir, fn) => {
  const p = join(dir, MODULE);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error('the mutation changed nothing');
  writeFileSync(p, after);
};

const CASES = [
  {
    /* The harness itself. If this fails, every case below is running against a
       tree that cannot execute the checker, and their failures mean nothing. */
    name: 'baseline: the unmutated module passes every check',
    mutate: null,
    expect: null,
    baseline: true,
  },

  {
    // THE window mistake. numpy's np.hamming is symmetric; the periodic form
    // differs by 0.92% at the ends and is identical in the middle, so it still
    // yields 34 plausible numbers and a spectrum that looks right.
    //
    // THE GRID IDENTITY, and this case has now named three different detectors in a
    // row, which is the §4 lesson arriving from a third direction.
    //
    // First it named m1, on the reasoning that a window's ends weigh the outer bands
    // and m1/m2 read them. It does not fire — DCT row 1 integrates the whole spectrum
    // and a 0.92% change confined to the two ends cancels out of it.
    //
    // Then it named m4, which did fire, at 5.9e-3. It stopped firing when the
    // tolerances were re-grounded on measurements rather than on a single synthetic
    // signal: the band-limited probe's leakage masks the window change across the
    // aggregate features.
    //
    // What actually catches it now is the log-mel grid, at 9.94e-3 against a 1e-3
    // gate — which is the better outcome, not a worse one. The 34 numbers are means
    // and standard deviations over 68 frames, and any per-frame error small enough to
    // cancel in them is still visible in the cells; the grid is the picture the page
    // draws, so it is the assertion that SHOULD be the sensitive one.
    name: 'a PERIODIC Hamming window instead of numpy\'s symmetric one',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      "w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1));",
      "w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / FRAME);")),
    expect: 'every log-mel cell within 30 dB differs by log(n_out/n_fft) too',
  },

  {
    // The bug this port actually had. See the file docblock.
    name: 'the in-place FFT leaves the previous frame in the zero-pad tail',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      'frameRe.fill(0);\n    frameRe.set(windowed);',
      'frameRe.set(windowed);')),
    expect: 'centroid agrees with analyze_cries.py',
  },

  {
    // `magnitude` in the Python is a (n_frames x n_bins) array, so its `.mean()`
    // divides by both. Dividing by frames alone puts flux out by a factor of 257.
    name: 'flux normalises by frames but forgets the bins',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      '/ (magnitudeSum / (nFrames * nBins) + EPS)',
      '/ (magnitudeSum / nFrames + EPS)')),
    expect: 'flux agrees with analyze_cries.py',
  },

  {
    // Unit AREA vs unit PEAK. The Python's own comment says coefficients 1 and 2
    // drift without the area normalisation, which is the right instinct and the
    // wrong feature number: this case named m2 for a long time and m2 does not fire.
    // m1 does, at 3.27e-1, because a per-band gain hits the lowest-order row hardest
    // — the wider the band, the more of the triangle sits where the gain differs, and
    // m1 is the row that most integrates the whole set of them.
    name: 'the filterbank is normalised to unit PEAK, not unit area',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      '      area += v;\n    }\n    const norm = 1 / Math.max(area, EPS);',
      '      if (v > area) area = v;\n    }\n    const norm = 1 / Math.max(area, EPS);')),
    expect: 'm1 agrees with analyze_cries.py',
  },

  {
    // The temptation this file was written to refuse: compare the three excluded
    // features too and widen the tolerance. Adding m0 back makes the table include a
    // number that differs by a per-file constant, and the assertion naming the
    // exclusion list is the only thing standing between that and a table of
    // meaningless numbers.
    name: 'UNCOMPARABLE stops excluding m0',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      "  FEATURE_NAMES.indexOf('rms'),\n  FEATURE_NAMES.indexOf('m0'),",
      "  FEATURE_NAMES.indexOf('rms'),")),
    expect: 'peak, rms and m0 are the three features a browser run cannot reproduce',
  },

  {
    name: 'COMPARABLE drops a feature it could compare',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      '  .filter((i) => !UNCOMPARABLE.includes(i));',
      '  .filter((i) => i < 20);')),
    expect: 'exactly the other 31 features are declared comparable',
  },

  {
    /* The extractor's own amplitude bug, copied in. This is the case that makes the
     * m0 IDENTITY worth having: a tolerance on m0 would have been satisfied by this
     * mutation, because the difference it produces IS small — under 5% — and it is
     * only the exact relationship to log(n_out/n_fft) that rules it out. */
    name: "the extractor's resample amplitude bug is copied in",
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      '  for (let i = 0; i < keep; i++) {\n    yRe[i] = X.re[i];\n    yIm[i] = X.im[i];\n  }',
      '  const buggy = nOut / nFft;\n  for (let i = 0; i < keep; i++) {\n    yRe[i] = X.re[i] * buggy;\n    yIm[i] = X.im[i] * buggy;\n  }')),
    expect: 'm0 differs by log(n_out/n_fft)*sqrt(N_MEL)',
  },

  {
    /* The extractor's other bug, copied in. Probe A is band-limited below 4.1 kHz
     * and probe B asserts the cutoff BITES rather than where it sits, so neither
     * feature comparison notices. The one assertion that does is the 7 kHz tone:
     * inside the band a resample to 16 kHz must keep, and well outside what the
     * extractor keeps. Found by asking what would NOT be caught, which is the only
     * way to find gaps of this shape. */
    name: "the extractor's resample cutoff bug is copied in",
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      '  const keep = Math.min(X.bins, Math.floor((nyquist * nFft) / srIn) + 1);',
      '  const keep = Math.min(X.bins, nOut >> 1) + 1;')),
    expect: '7 kHz tone',
  },

  {
    // A rename in one file and not the other is the failure mode a hardcoded
    // index list invites, and it is why the comparison is positional.
    name: 'a feature is renamed in the module and not in the extractor',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      "'flatness', 'flux',", "'flat', 'flux',")),
    expect: 'the module and the extractor agree on what the 34 numbers are called',
  },

  {
    // A display-side scaling error. A uniform 1% gain in log-mel survives every
    // MEAN and every STANDARD DEVIATION except m0's — the higher rows integrate the
    // offset away — which is exactly why m0 and the grid are asserted as identities
    // against the extractor's known constant rather than left inside a tolerance.
    name: 'the log-mel grid is scaled by 1% — the summary statistics barely move',
    mutate: (dir) => editModule(dir, (s) => replaceOrThrow(s,
      'logMel[base + m] = Math.log(Math.max(acc, EPS));',
      'logMel[base + m] = Math.log(Math.max(acc, EPS)) * 1.01;')),
    expect: 'm0 differs by log(n_out/n_fft)*sqrt(N_MEL)',
  },
];

console.log(`check_spectrogram_port.mjs — ${CASES.length - 1} mutations + 1 baseline\n`);

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs. Each tree is
 * removed the moment its case finishes rather than at the end of the loop, so the
 * pool holds four trees instead of nine and a crash leaves four behind, not nine. */
const verdicts = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (c.baseline) {
    const passed = code === 0 && /PASS  \d+ checks/.test(out) && !/SKIP/.test(out);
    return [c.name, passed,
      passed ? out.match(/PASS  (\d+) checks/)[1] + ' checks'
        : out.split('\n').filter((l) => /SKIP|FAIL|Error/.test(l)).slice(0, 2).join(' | ')];
  }
  return [c.name, code !== 0 && caughtBy(out, c.expect),
    code === 0 ? 'the checker still passed' : caughtBy(out, c.expect) ? '' : `caught, but not by "${c.expect}"`];
}));

for (const [name, pass, detail] of verdicts) ok(name, pass, detail);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} of ${results.length} cases`);
  process.exit(1);
}
console.log(`PASS  ${results.length} cases`);
