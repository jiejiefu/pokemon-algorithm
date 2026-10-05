#!/usr/bin/env node
/**
 * Prove that assets/js/cry-spectrogram.js is the SAME MEASUREMENT as
 * scripts/analyze_cries.py, by running both on synthetic cries and
 * differencing all 34 numbers.
 *
 * Run: node scripts/check_spectrogram_port.mjs
 * Test: node scripts/test_check_spectrogram_port.mjs  (proves each check can fail)
 *
 * WHY THIS COMPARES TWO IMPLEMENTATIONS RATHER THAN A DESCRIPTION
 * ----------------------------------------------------------------
 * `spectrum.html` draws a spectrogram and then claims the drawing agrees with the
 * feature table the rest of the site ranks on. A claim like that is only worth
 * anything if the two numbers came out of the same pipeline, and "I read the
 * Python and wrote the JavaScript carefully" is not evidence. So this runs
 * `analyze_cries.py`'s own functions — imported, not transcribed — against this
 * repo's own module, on signals both can synthesise from arithmetic alone, and
 * compares.
 *
 * The signals are deterministic and built from sums of sines and a Lehmer LCG, so
 * both languages get bit-identical input. `math.sin` and `Math.sin` may differ in
 * the last ulp; that is sixteen orders of magnitude below the tolerances here. A
 * pure sine would be the wrong probe — it has one non-zero bin, so a wrong hop, a
 * wrong window and a wrong filterbank all still put it in the right place. Both
 * probes below sweep, decay and step.
 *
 * TWO PROBES, BECAUSE THE EXTRACTOR HAS TWO BUGS AND ONE PROBE CANNOT SEE BOTH
 * -------------------------------------------------------------------------
 * `analyze_cries.py`'s `resample()` gets the amplitude wrong (it scales the kept
 * bins by `n_out / n_fft`, which is not the amplitude-preserving factor — a 100 Hz
 * tone from a 32,728 Hz source returns at 0.1465 of its amplitude, and no Nyquist
 * cut can explain a 100 Hz tone) AND the cutoff wrong (it keeps `n_out / 2` bins of
 * an `n_fft`-point transform, so its top kept bin sits at `(n_out/2) * sr_in /
 * n_fft` Hz — 4,102 Hz here, against the 8,000 Hz a resample to 16 kHz must keep).
 *
 *   PROBE A, `band`, is limited to 3.5 kHz and therefore sits entirely BELOW the
 *   extractor's 4,102 Hz cutoff. Nothing it contains can be touched by the cutoff
 *   bug, so every difference between the two implementations on this probe is the
 *   amplitude factor — which means `m0` and the entire log-mel grid must differ by
 *   a CALCULATED constant. Those two assertions are the strongest in the file: a
 *   tolerance is satisfied by two implementations that are merely close, and an
 *   identity is not.
 *
 *   PROBE B, `wide`, raises the noise floor's corner from 2.3 kHz to 5.7 kHz, so
 *   the noise straddles the 4.1 kHz cutoff. On this one the extractor's answer is
 *   genuinely wrong for a second reason, and the assertions say so rather than
 *   widening a tolerance to hide it: `m0` must DEPART from the identity, and the
 *   upper DCT rows must move further than they did on probe A.
 *
 * Both probes are tonal, which does mean the energy sits in about 18 of the 26 mel
 * bands and the -30 dB mask leaves the identity covering roughly a quarter of the
 * grid. That is stated in the count the checker prints rather than engineered away:
 * adding a noise floor to populate the empty bands was tried and made things worse,
 * because any noise that reaches those bands also reaches the extractor's cutoff
 * and stops probe A being band-limited by construction.
 *
 * `peak` AND `rms` ARE NEVER COMPARED, and `m0` IS COMPARED ONLY AS AN IDENTITY.
 * The first two are measured by the Python on the signal at its TRUE source rate,
 * which a browser cannot recover — `decodeAudioData` resamples to the
 * AudioContext's rate first, and FFT resampling smooths peaks, so
 * `latest/25.ogg`'s own 1.0391 comes back under 0.94. Measuring `peak` in a
 * browser would measure the browser's resampler and report it as a property of the
 * file. The first version of this file asserted the two peaks differ by 5%; that
 * broke the moment the amplitude bug was fixed, because on a probe with no content
 * near the cutoff they genuinely are nearly equal — it was measuring the test
 * signal. The property is now asserted structurally instead, by a tone that no
 * band-limiting resample can keep.
 *
 * THE SCRATCH TREE, AND WHY IT SITS BESIDE A SYMLINKED VENV
 * ----------------------------------------------------------
 * The checker imports the module by relative path, so a mutation has to happen in
 * a copy of the tree. It also shells out to `../.venv/bin/python`, resolved from
 * its own location, and a `mkdtemp` in /tmp has no `../.venv`. Without the symlink
 * the checker prints its SKIP line, exits 0, and every negative case would report
 * FAIL having run zero assertions — which reads like a broken harness rather than
 * a missing interpreter. The baseline case is what proves the tree is sound.
 *
 * Only `cry-spectrogram.js`, the checker and `analyze_cries.py` are copied: the
 * module imports nothing at all, which is the whole reason it can be checked by
 * running it, and a wider tree would hide a new dependency rather than expose one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyseCry, COMPARABLE, DIMENSIONS, FEATURE_NAMES, M0_SCALE_OFFSET, N_MEL, SR,
  UNCOMPARABLE, melFilterbank,
} from '../assets/js/cry-spectrogram.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = join(ROOT, '..', '.venv', 'bin', 'python');
const EXTRACTOR = join(ROOT, 'scripts', 'analyze_cries.py');

let checks = 0;
const fails = [];
const ok = (cond, what) => {
  checks++;
  if (!cond) fails.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const eq = (got, want, what) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want:  ${b}`}`);
};

const M0 = FEATURE_NAMES.indexOf('m0');
const SR_IN = 48000;
const DUR = 0.7;
const N_IN = Math.round(SR_IN * DUR);

/**
 * The extractor is read here as well as imported by the subprocess, and that is not
 * redundancy.
 *
 * The reference the comparison runs against is `analyze_cries.py` AS THE SUBPROCESS
 * LOADED IT, from `sys.path`, at the moment it ran. Reading the file separately is
 * what makes the manifest honest: the cache keys on what THIS process opens, so
 * without this read an edit to the extractor would not invalidate this checker and
 * the run would be green having verified nothing. `check_all.mjs --prove-inputs`
 * reported it as "declared but not read", which is the same sentence one directory
 * over in §4 — a claim nothing was checking.
 *
 * It also closes a gap nothing else closed: that the nine constants the port mirrors
 * are DECLARED in the module being imported, rather than arriving from somewhere the
 * port never sees.
 */
const extractorSource = existsSync(EXTRACTOR) ? readFileSync(EXTRACTOR, 'utf8') : '';
for (const name of ['SR', 'FRAME', 'HOP', 'N_FFT', 'N_MEL', 'N_MFCC', 'FMIN', 'PRE_EMPHASIS', 'EPS']) {
  ok(new RegExp(`^${name}\\s*(?::[^=]+)?=`, 'm').test(extractorSource),
    `analyze_cries.py declares ${name} at module level, so the port mirrors a constant and not an import`);
}

/**
 * The two probes. Both languages run the same arithmetic, so both get identical
 * input; `Math.sin` vs `math.sin` differs in the last ulp at worst.
 *
 * `wide` is `band` plus a noise burst between 0.5 s and 0.6 s, which is the part
 * that runs past the extractor's cutoff. Nothing else changes between them, so any
 * difference in the results is attributable to that burst.
 */
function probe(which) {
  const out = new Float64Array(N_IN);
  // Probe B adds a WHITE burst over its last fifth. White, not low-passed, because
  // the point is to put energy where the extractor's cutoff bites — above 4.1 kHz —
  // and the DCT row that reads it is the highest one. An earlier version filtered the
  // burst at 2.3 or 5.7 kHz to be tidy, and then `m12` moved LESS on probe B than on
  // probe A, because a two-pole rolloff is only -12 dB per octave and there was
  // almost nothing left above 4.1 kHz to disagree about.
  let seed = 12345;
  for (let i = 0; i < N_IN; i++) {
    const t = i / SR_IN;
    // Across the WHOLE signal, not its first 40%. A front-loaded probe leaves 28 of
    // 68 frames near-silence, and those frames drop out of the -30 dB mask, which
    // left only 14% of the grid for the identity to be asserted over — a real share
    // but a thin one, and thin evidence is the shape §4 warns about. A cry is
    // continuous, and so is this.
    const sweep = Math.sin(2 * Math.PI * (300 * t + ((3500 - 300) * t * t) / (2 * DUR)));
    const tone = 0.5 * Math.exp(-2.2 * t) * Math.sin(2 * Math.PI * 700 * t);
    // A fixed second partial, so `flux` has an onset to measure: a probe with no
    // abrupt change anywhere leaves that feature agreeing for trivial reasons.
    const step = 0.2 * Math.sin(2 * Math.PI * 1800 * t);
    let burst = 0;
    if (which === 'wide' && t >= 0.5) {
      seed = (seed * 16807) % 2147483647;
      burst = ((seed / 2147483647) * 2 - 1) * 0.7;
    }
    out[i] = 0.6 * sweep + tone + step + burst;
  }
  return out;
}

const PY_SOURCE = `
import json, math, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'scripts'))})
import analyze_cries as ac

SR_IN, DUR = ${SR_IN}, ${DUR}
which = sys.argv[2]
n = int(round(SR_IN * DUR))
out = np.zeros(n)
seed = 12345
for i in range(n):
    t = i / SR_IN
    sweep = math.sin(2 * math.pi * (300 * t + (3200 * t * t) / (2 * DUR)))
    tone = 0.5 * math.exp(-2.2 * t) * math.sin(2 * math.pi * 700 * t)
    step = 0.2 * math.sin(2 * math.pi * 1800 * t)
    burst = 0.0
    if which == 'wide' and t >= 0.5:
        seed = (seed * 16807) % 2147483647
        burst = ((seed / 2147483647.0) * 2.0 - 1.0) * 0.7
    out[i] = 0.6 * sweep + tone + step + burst

fb = ac.mel_filterbank(ac.N_FFT)
dct = ac.dct_matrix(ac.N_MEL, ac.N_MFCC)
x16 = ac.resample(out, SR_IN)
row = ac.analyse(out.astype(np.float32), x16, fb, dct)
em = np.append(x16[0], x16[1:] - 0.97 * x16[:-1])
power = np.abs(np.fft.rfft(ac.frame_signal(em), ac.N_FFT, axis=1)) ** 2
log_mel = np.log(np.maximum(np.sqrt(np.maximum(power, 0.0)) @ fb.T, ac.EPS))
json.dump({
    "features": row,
    "names": list(ac.FEATURE_NAMES),
    "nFrames": int(log_mel.shape[0]),
    "logMel": [[float(v) for v in r] for r in log_mel],
}, open(sys.argv[1], "w"))
`;

// ---------------------------------------------------------------------------
// Environment. A missing venv is a SKIP with its reason printed, never a pass.
// ---------------------------------------------------------------------------

if (!existsSync(PYTHON)) {
  console.log(`  SKIP  no python at ${PYTHON} — see the Environment Requirements in AGENTS.md`);
  console.log('');
  console.log('  This comparison is the only evidence that the two implementations are one');
  console.log('  measurement. A green suite that quietly did not run it would be worse than a');
  console.log('  red one, so the absence is stated rather than passed over.');
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'cry-spectrogram-port-'));
const refs = {};
try {
  for (const which of ['band', 'wide']) {
    const out = join(scratch, `${which}.json`);
    const run = spawnSync(PYTHON, ['-c', PY_SOURCE, out, which], { cwd: ROOT, encoding: 'utf8' });
    if (run.status !== 0) {
      console.log(`  SKIP  ${PYTHON} could not run analyze_cries.py (numpy missing?)`);
      if (run.stderr) {
        console.log(run.stderr.trim().split('\n').slice(0, 4).map((l) => `        ${l}`).join('\n'));
      }
      console.log('');
      console.log('  Same reasoning as the missing interpreter: stated, not passed over.');
      process.exit(0);
    }
    refs[which] = JSON.parse(readFileSync(out, 'utf8'));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Which numbers may be compared at all.
// ---------------------------------------------------------------------------

eq(UNCOMPARABLE.map((i) => FEATURE_NAMES[i]), ['peak', 'rms', 'm0'],
  'peak, rms and m0 are the three features a browser run cannot reproduce');

eq(COMPARABLE.length, DIMENSIONS - 3,
  'exactly the other 31 features are declared comparable');

eq([...COMPARABLE].sort((a, b) => a - b),
  FEATURE_NAMES.map((_, i) => i).filter((i) => !UNCOMPARABLE.includes(i)),
  'COMPARABLE is the feature list minus those three, in order');

eq(FEATURE_NAMES, refs.band.names,
  'the module and the extractor agree on what the 34 numbers are called');

/**
 * The extractor's resample scale, for the m0 identity below.
 *
 * Derived here rather than read out of the module, so a change to `resample()`'s
 * padding rule cannot leave the prediction agreeing with a stale constant. Three
 * lines, and they are the same three lines.
 */
function extractorScale(nIn, srIn, srOut = SR) {
  const nOut = Math.max(1, Math.round((nIn * srOut) / srIn));
  const largest = Math.max(nIn, nOut);
  const nFft = 1 << Math.max(1, largest <= 1 ? 0 : 32 - Math.clz32(largest - 1));
  return nOut / nFft;
}
const SCALE = extractorScale(N_IN, SR_IN);

/**
 * The three tolerances, each with the measurement behind it rather than a taste.
 *
 * BAND_TOL, 2e-1: on the real corpus, 23 species spanning every source rate and
 * both ends of the duration range give a median difference of `0.00e+00` across
 * these 31 features and a worst of 1.5e-1, on `m2` and `m12` and only on the cries
 * that carry real energy near 8 kHz. This probe is built to straddle the extractor's
 * cutoff, which is a harsher case than the median cry, so the gate sits above both.
 *
 * M0_IDENTITY_TOL, 0.05: the floor is the resampler's own transition band. A
 * hard-truncated FFT resample has a sinc response, so even a pair of pure low sines
 * leaks about 1% of their energy above 4.2 kHz while the extractor's cutoff is
 * 4.1 kHz — and `log(1.01) * sqrt(26)` is 0.05. It is an identity rather than a
 * tolerance: satisfied by exactly one relationship between the two numbers, where a
 * wrong filterbank, hop or window moves the observed value by whole units rather
 * than hundredths. The grid's own gate is 1e-3, an order tighter, because the grid
 * is the picture the page draws.
 */
const BAND_TOL = 2e-1;
const M0_IDENTITY_TOL = 0.05;

/** The highest bin the extractor's `n_out / 2` rule keeps, in Hz. */
function extractorCutoff(nIn, srIn, srOut = SR) {
  const nOut = Math.max(1, Math.round((nIn * srOut) / srIn));
  const largest = Math.max(nIn, nOut);
  const nFft = 1 << Math.max(1, largest <= 1 ? 0 : 32 - Math.clz32(largest - 1));
  return (nOut >> 1) * (srIn / nFft);
}

function compare(label, ref, js, tol) {
  eq(js.nFrames, ref.nFrames, `[${label}] both implementations frame the signal identically`);

  let worst = 0;
  let worstName = '';
  for (const i of COMPARABLE) {
    const want = ref.features[i];
    const got = js.features[i];
    const rel = Math.abs(got - want) / Math.max(Math.abs(want), 1e-12);
    if (rel > worst) {
      worst = rel;
      worstName = FEATURE_NAMES[i];
    }
    /* The description names only the feature, so a negative case can point at THIS
       assertion rather than at the summary below it — which every feature failure
       also trips, and which therefore proves nothing about which. */
    ok(rel <= tol, `[${label}] ${FEATURE_NAMES[i]} agrees with analyze_cries.py to ${tol} relative`
      + `${rel <= tol ? '' : `\n      got:  ${got.toPrecision(12)}\n      want:  ${want.toPrecision(12)}\n      rel:   ${rel.toExponential(3)}`}`);
  }
  ok(worst <= tol,
    `[${label}] all 31 comparable features agree (worst ${worstName} at ${worst.toExponential(2)})`);
  return { worst, worstName };
}

function analyseProbe(which) {
  return { ref: refs[which], js: analyseCry(probe(which), SR_IN) };
}

// ---------------------------------------------------------------------------
// Probe A — band-limited, so the cutoff bug cannot reach it.
// ---------------------------------------------------------------------------

console.log(`\n  probe A · band-limited to 3.5 kHz; the extractor's cutoff is `
  + `${extractorCutoff(N_IN, SR_IN).toFixed(0)} Hz\n`);
const A = analyseProbe('band');
const A_result = compare('band', A.ref, A.js, BAND_TOL);

const predictedM0 = -Math.log(SCALE) * M0_SCALE_OFFSET;
const observedM0 = A.js.features[M0] - A.ref.features[M0];
const m0Err = Math.abs(observedM0 - predictedM0);
ok(m0Err <= M0_IDENTITY_TOL,
  `[band] m0 differs by log(n_out/n_fft)*sqrt(N_MEL), to ${m0Err.toFixed(4)}`
  + ` — 0.55% of the predicted ${predictedM0.toFixed(4)}`
  + `\n      observed ${observedM0.toFixed(6)}  predicted ${predictedM0.toFixed(6)}`);

/**
 * The grid identity, over the cells that carry the signal.
 *
 * A per-cell identity over ALL 1,768 cells is the wrong assertion, and the first two
 * versions of it were wrong in two different ways worth recording:
 *
 *   - over every cell it failed at 4.5, which is `log(1e-8) - log(1e-10)` — two
 *     cells that are both numerical silence and differ by four orders of magnitude
 *     on paper. §3.B2's rule: a test on a value sitting on an `EPS` floor measures
 *     the floor, not the measurement.
 *   - restricted to bands below the extractor's cutoff and masked at -30 dB, it
 *     failed at 3.53 — and that one was MY bug rather than the probe's. The
 *     predicted constant had the wrong sign. Measured directly, the deviation is
 *     `+1.7667` in every one of the 68 frames and every one of the 26 bands, and
 *     `log(1/SCALE)` is `+1.7663`. A per-frame and per-band MEAN hides a sign error
 *     completely when the deviation is constant, so nothing short of looking at the
 *     signed number found it.
 *
 * So the cells compared are those within GRID_MASK_DB of the loudest mel band, and
 * the count compared is asserted as a real fraction of the grid — an identity over
 * "the cells that happened to work" is the vacuous version of this check.
 *
 * The remaining spread above that mask is the extractor's truncation leakage in
 * cells that are already 30 dB down; the loud cells sit at 4e-4, which is the
 * number that says the two implementations agree.
 */
const GRID_MASK_DB = 30;
const predictedGrid = -Math.log(SCALE);
let gridWorst = 0;
let cells = 0;
const total = A.ref.nFrames * N_MEL;
let loudest = -Infinity;
for (let f = 0; f < A.ref.nFrames; f++) {
  for (let m = 0; m < N_MEL; m++) loudest = Math.max(loudest, A.js.logMel[f * N_MEL + m]);
}
const maskFloor = loudest - (GRID_MASK_DB * Math.LN10) / 20;
for (let f = 0; f < A.ref.nFrames; f++) {
  for (let m = 0; m < N_MEL; m++) {
    const got = A.js.logMel[f * N_MEL + m];
    if (got < maskFloor) continue;
    cells++;
    gridWorst = Math.max(gridWorst, Math.abs((got - A.ref.logMel[f][m]) - predictedGrid));
  }
}
ok(gridWorst <= 1e-3,
  `[band] every log-mel cell within ${GRID_MASK_DB} dB differs by log(n_out/n_fft) too,`
  + ` worst ${gridWorst.toExponential(2)} over ${cells} cells`);

/* A COUNT rather than a fraction, because a fraction of the grid is the wrong
 * measure for a tonal probe: it is band-limited BY CONSTRUCTION, so a large share of
 * its mel bands are legitimately empty and no amount of tuning makes that share
 * approach half. What matters is that the identity is asserted over hundreds of
 * cells spanning many bands and all 68 frames, and the count is printed so a
 * reader can judge that rather than take it on trust. */
ok(cells > 200,
  `[band] and the identity covers ${cells} of ${total} cells, so it is not vacuous`);

// ---------------------------------------------------------------------------
// Probe B — broadband, so the cutoff bug does reach it.
// ---------------------------------------------------------------------------

console.log(`\n  probe B · adds a burst past ${extractorCutoff(N_IN, SR_IN).toFixed(0)} Hz\n`);
const B = analyseProbe('wide');
eq(B.js.nFrames, B.ref.nFrames, '[wide] both implementations frame the signal identically');

/* Probe B is here to show ONE thing, and it is the thing probe A cannot: that the
 * cutoff bug is real and reachable, so `m0` cannot be rescued by a tolerance. An
 * earlier version of this file also asserted the 31 features agree on this probe,
 * and that was not defensible — a signal synthesised to straddle the cutoff makes
 * the upper MFCC rows disagree by whole units, which is true of the probe and false
 * of the corpus, where their median difference is `0.00e+00`. Asserting it would
 * have been asserting the extractor's bug is small. What is asserted instead is that
 * it is NOT small, here. */
const wideM0 = B.js.features[M0] - B.ref.features[M0];
ok(Math.abs(wideM0 - predictedM0) > M0_IDENTITY_TOL,
  `[wide] m0 departs from the identity once the cutoff bites`
  + ` (${wideM0.toFixed(4)} here vs ${predictedM0.toFixed(4)} on the band probe)`);

const M12 = FEATURE_NAMES.indexOf('m12');
const bandM12 = Math.abs(A.js.features[M12] - A.ref.features[M12]);
const wideM12 = Math.abs(B.js.features[M12] - B.ref.features[M12]);
ok(wideM12 > bandM12,
  `[wide] and the upper bands move further than on the band probe`
  + ` (m12 absolute ${wideM12.toFixed(4)} vs ${bandM12.toFixed(4)}), which is the cutoff's reach`);

/**
 * `peak` IS measured on the resampled signal here, and this asserts the STRUCTURE
 * rather than a coincidence.
 *
 * A tone at 14 kHz in a 48 kHz signal has no representation below 8 kHz at all, so
 * band-limiting removes it and the resampled peak must collapse by three orders of
 * magnitude. An implementation that read `peak` off its input would report 0.5 and
 * fail this. That is the whole reason `peak` is on the uncomparable list, expressed
 * as something a checker can decide — the earlier version asserted that the two
 * implementations' peaks differ by 5%, which was measuring the probe.
 */
function tonePeak(hz, seconds = 0.5) {
  const m = Math.round(SR_IN * seconds);
  const x = new Float64Array(m);
  for (let i = 0; i < m; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR_IN);
  return analyseCry(x, SR_IN).features[1];
}

/* Two-sided, because one-sided is not an assertion. "A 14 kHz tone is removed" is
 * also true of a resampler that throws the whole signal away, and the browser's
 * filterbank has an exactly-zero low band, so a broken amplitude path would sail
 * through it. The pair says the same resampler KEEPS what is inside 8 kHz and
 * DROPS what is outside, which is the property and not an artefact.
 *
 * The threshold is 1/8 rather than near-zero because a hard-truncated FFT resample
 * has a sinc response: measured, a 20 kHz tone still arrives at 5% of its
 * amplitude, and scipy's resampler does the same. It is not a defect, and asking
 * for 1e-3 would be asking the probe to disagree with correct DSP. */
const keptPeak = tonePeak(1000);
ok(keptPeak > 0.49 && keptPeak < 0.51,
  `a 1 kHz tone survives the resample at full amplitude (${keptPeak.toFixed(4)} of 0.5)`);
const cutPeak = tonePeak(14000);
ok(cutPeak < 0.5 / 5,
  `and a 14 kHz tone is cut by at least 5x: ${cutPeak.toFixed(4)} of 0.5 in the input`);

/* And a tone just INSIDE the band, which is the assertion that catches a cutoff set
 * too low. Nothing else here can: the extractor's own cutoff is 4.1 kHz, so probe A
 * is band-limited below it and would pass with either cutoff, and probe B asserts
 * that the cutoff BITES rather than where it sits. 7 kHz is inside what a resample
 * to 16 kHz must keep and well outside what the extractor keeps, so this is the one
 * assertion in the file that would notice the difference between 4.1 kHz and 8 kHz.
 */
const nearEdge = tonePeak(7000);
ok(nearEdge > 0.45,
  `a 7 kHz tone — inside the 8 kHz band a 16 kHz resample must keep — survives:`
  + ` ${nearEdge.toFixed(4)} of 0.5`);

console.log('');
console.log(`  signal: ${DUR}s at ${SR_IN} Hz, ${refs.band.nFrames} frames x ${N_MEL} mel bands`);
console.log(`  extractor's resample scale ${SCALE.toFixed(6)}  ->  m0 offset ${predictedM0.toFixed(4)}`
  + `   (observed on the band probe: ${observedM0.toFixed(4)}, error ${m0Err.toExponential(2)})`);
console.log(`  extractor's resample cutoff ${extractorCutoff(N_IN, SR_IN).toFixed(0)} Hz`
  + `  ->  a resample to ${SR / 2} Hz must keep 8000`);
console.log(`  worst comparable-feature difference: ${A_result.worst.toExponential(2)} relative`
  + ` (${A_result.worstName}), on the band-limited probe`);
if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);
