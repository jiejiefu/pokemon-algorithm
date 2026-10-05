/**
 * The cry feature pipeline, re-derived in JavaScript from
 * `scripts/analyze_cries.py` so the browser can draw a spectrogram.
 *
 * Pure: no DOM, no fetch, no Web Audio. Float32Array in, plain arrays out. That
 * is what lets `check_spectrum_page.mjs` assert that the constants here are
 * *numerically equal* to the Python's rather than merely shaped like them, and
 * what lets Node run the whole thing with no browser at all.
 *
 * WHY THIS IS A PORT AND NOT A NEW ANALYSIS
 * -----------------------------------------
 * `analyze_cries.py` computes 34 numbers per cry, 26 of which are MFCC and the
 * other 8 spectral scalars, and it computes them through a filterbank of 26 mel
 * bands — so the spectrum it describes is already inside the repo, one function
 * away. Storing it instead would mean a 1,025 x 64 x 26 byte bank, about 2.3 MB
 * once base64'd, that goes stale the moment a cry is re-encoded. Recomputing one
 * cry on demand is ~80 frames of 512-point FFT, which is sub-millisecond, and it
 * costs no bytes at all.
 *
 * The second reason is that a port can be CHECKED against the thing it ports.
 * `featureRow()` returns the same 34 numbers, and `spectrum.html` differences
 * them against `cry_features.json` on every load and prints the result. A stored
 * spectrogram image would be a claim; this is a measurement that carries its own
 * error bar onto the page.
 *
 * WHAT MATCHES THE PYTHON, EXACTLY, AND WHY IT HAS TO
 * ---------------------------------------------------
 * Every constant below is duplicated from `analyze_cries.py` on purpose. The
 * checker compares the two files' constants by value, so changing one side
 * without the other is a red test rather than a silently different feature
 * vector. The places where "obviously equivalent" rewrites are NOT equivalent:
 *
 *   - `frame_signal` uses numpy's SYMMETRIC Hamming, `0.54 - 0.46·cos(2πn/(M-1))`,
 *     not the periodic `2πn/M`. The two differ by 0.92% at the window's ends and
 *     are identical in the middle, so a periodic window still yields a
 *     plausible-looking MFCC that is quietly wrong in exactly the bands the outer
 *     triangles weight most.
 *   - `std` is numpy's default: population, ddof=0. The sample standard deviation
 *     of the same 80 frames differs by ~0.6%, spread across all 13 `ms` columns
 *     and therefore across the whole standardisation `cries.html` performs.
 *   - The 400-sample frames are zero-padded to 512 for the FFT. Without the pad
 *     the transform is shorter and the band edges move.
 *   - The filterbank is normalised per row to unit area over the rfft bins, not
 *     to unit peak. Peak-normalised, the wide high-frequency triangles carry
 *     several times the energy of the narrow low-frequency ones and MFCC
 *     coefficients 1 and 2 drift toward zero.
 *   - `flux` divides the summed positive change by `nFrames - 1` and by the mean
 *     magnitude over every FRAME AND BIN. Dividing by `nFrames` alone is off by a
 *     factor of the bin count and puts `flux` three orders of magnitude out.
 *
 * THREE OF THE 34 NUMBERS CANNOT BE COMPARED ACROSS THE TWO IMPLEMENTATIONS,
 * FOR TWO DIFFERENT REASONS
 * ---------------------------------------------------------------------------
 * The first two are `peak` and `rms` (indices 1 and 2). Both are measured by the
 * Python on the signal at its TRUE source rate, and that rate is not recoverable
 * in a browser: `decodeAudioData` resamples to the AudioContext's rate before
 * handing the buffer over, which `cry-player.js`'s own docblock documents at
 * length. FFT resampling smooths peaks, and the corpus's own worked example is
 * that `latest/25.ogg` measures 1.0391 in libsndfile and comes back under 0.94
 * after resampling. Measuring `peak` here would measure the browser's resampler
 * and report it as a property of the file. The page shows both from
 * `cry_features.json` instead — the accurate measurement. `dur` IS comparable:
 * resampling changes the sample count, not the seconds.
 *
 * The third is `m0`, and it is a BUG IN THE EXTRACTOR rather than a limit of the
 * browser. `analyze_cries.py`'s `resample()` gets the amplitude AND the cutoff
 * wrong, in two independent ways.
 *
 * AMPLITUDE. It multiplies the kept bins by `n_out / n_fft` before the inverse
 * transform. Zero-padding a signal to `n_fft` does not change `X` — the transform
 * is just sampled on a finer grid — so `irfft(X, n_fft)` returns `x` exactly and
 * the amplitude-preserving scale is 1.0. The proof needs no argument about
 * spectral content: a 100 Hz tone resampled from 32,728 Hz to 16 kHz comes back at
 * 0.1465 of its amplitude, and no Nyquist cut can be responsible for a 100 Hz tone.
 * Measured over fifteen source rates and durations, `scale = 1.0` holds a tone to
 * within 0.4% while `n_out / n_fft` loses between 15% and 95%.
 *
 * CUTOFF. It keeps `n_out / 2` bins of an `n_fft`-point transform, and those bins
 * are spaced `sr_in / n_fft` apart — so the highest one it keeps sits at
 * `(n_out/2) * sr_in / n_fft` Hz, which is 4,102 Hz for the checker's one-second
 * signal and 5,859 Hz for a one-second file at 48 kHz, against the 8,000 Hz a
 * resample to 16 kHz is required to keep. Worse, `n_fft` follows the file's
 * DURATION, so the cutoff does too: measured across the 1,025 latest cries it
 * lands between about 4.4 kHz and 8 kHz. Every stored row therefore describes a
 * signal band-limited at a frequency that depends on how long the file is.
 *
 * WHAT THAT ACTUALLY COSTS, MEASURED
 * ----------------------------------
 * Across 23 species spanning every source rate and both ends of the duration
 * range, comparing a correct resample against the stored table feature by
 * feature:
 *
 *   - **31 of the 34 agree at a median relative difference of `0.00e+00`.** The
 *     wrong cutoff turns out to cost almost nothing, because the cries barely use
 *     the top of the band — which is the same fact `analyze_cries.py` cites when
 *     it chooses 16 kHz ("98.2% of the measured energy is below 8 kHz"). Where it
 *     does cost something it is visible: `m2` and `m12`, the two rows that read the
 *     upper-middle bands, reach 1.5e-1 on the species that do carry energy near
 *     8 kHz, while their medians stay exact.
 *   - **`m0` alone differs systematically**, at a median of 0.41. On a signal
 *     band-limited below the extractor's cutoff, the difference is exactly
 *     `log(n_out / n_fft) * sqrt(N_MEL)`, because DCT row 0 is `sqrt(1/N_MEL)` in
 *     all 26 entries while every row above zero sums its basis to nothing and
 *     cannot see a constant at all.
 *
 * This module does NOT copy either bug. It uses scale 1.0 and the correct Nyquist,
 * because a spectrogram whose dB axis is 15-95% low and whose top octave is
 * rolled off at a duration-dependent frequency is not a picture of the file.
 * `check_spectrogram_port.mjs` proves the result two ways: on a band-limited probe
 * where the cutoff cannot bite, the 31 features must agree and `m0` and the whole
 * log-mel grid must differ by the predicted constant to 1e-5; on a broadband probe
 * where it does bite, the same 31 must still agree and `m0` must be reported as
 * differing rather than being folded into a tolerance.
 *
 * Fixing `analyze_cries.py` would restore the 34th feature and move the stored
 * table. That is a separate decision with its own cost — it changes `m0` across
 * 1,674 rows by up to 8.9, which changes what `cries.html`'s similarity search
 * returns — and it is not this module's to make.
 */

export const SR = 16000;
export const FRAME = Math.round(0.025 * SR);
export const HOP = Math.round(0.010 * SR);
export const N_FFT = 512;
export const N_MEL = 26;
export const N_MFCC = 13;
export const FMIN = 50;
export const PRE_EMPHASIS = 0.97;

/** Floor for every logarithm and every ratio. Mirrors the Python's `EPS`. */
export const EPS = 1e-10;

export const FEATURE_NAMES = [
  'dur', 'peak', 'rms', 'zcr', 'centroid', 'rolloff85', 'flatness', 'flux',
  ...Array.from({ length: N_MFCC }, (_, i) => `m${i}`),
  ...Array.from({ length: N_MFCC }, (_, i) => `ms${i}`),
];

export const DIMENSIONS = FEATURE_NAMES.length;

/**
 * `sqrt(N_MEL)`: how far `m0` moves per unit of `log(c)` in the spectrum.
 *
 * DCT-II row 0 is `sqrt(2/N_MEL) * sqrt(0.5) = sqrt(1/N_MEL)` in all 26 entries,
 * so a uniform `log(c)` offset in `log_mel` sums to `26 * sqrt(1/26)` of it.
 * Exported because it is the constant that makes `m0` PREDICTABLE rather than
 * merely different: `check_spectrogram_port.mjs` asserts the observed difference
 * against `log(n_out / n_fft) * M0_SCALE_OFFSET`, which is an identity rather
 * than a tolerance and so cannot be satisfied by two implementations that merely
 * happen to be close.
 */
export const M0_SCALE_OFFSET = Math.sqrt(N_MEL);

/**
 * The three features a browser run cannot reproduce, as indices into
 * `FEATURE_NAMES`. Read the file docblock before touching this list: the tempting
 * fix is to compare them anyway and widen the tolerance, which converts a stated
 * limitation into a number that means nothing.
 *
 * Two causes, not one, and the page says so in two sentences. `peak` and `rms`
 * are a LIMIT of what a browser is told; `m0` is a DEFECT in the extractor, and
 * copying it would mean drawing a spectrogram of a signal that is 15–95% quieter
 * than the file.
 */
export const UNCOMPARABLE = [
  FEATURE_NAMES.indexOf('peak'),
  FEATURE_NAMES.indexOf('rms'),
  FEATURE_NAMES.indexOf('m0'),
];

/** Indices a browser-side row may be differenced against `cry_features.json` on. */
export const COMPARABLE = FEATURE_NAMES
  .map((_, i) => i)
  .filter((i) => !UNCOMPARABLE.includes(i));

/**
 * The five features a browser run and the stored table can be COMPARED ON, and the
 * reason relative difference is not offered for the other 29.
 *
 * Measured in a real browser on `latest/1.ogg`, decoded at its own 32,728 Hz so that
 * no resampling happens at all, the two implementations differ by a median of 5.5%
 * across the 31 comparable features — and by 1,181% on the worst one. That worst one
 * is an `ms` column, which is a standard deviation of MFCC values whose stored
 * magnitude is around 0.002. A relative difference is a ratio with that in the
 * denominator, so it reports a large disagreement about a number that is nearly
 * zero, and it does so for 13 of the 34 features at once.
 *
 * These five have stored magnitudes of O(1) or larger AND are well conditioned:
 * `dur` is a sample count and comes out exact, `zcr` a crossing rate, `centroid` and
 * `rolloff85` frequencies, `flux` a normalised rate. Measured on `latest/1.ogg`
 * decoded at its own 32,728 Hz, so no resampling happens at all, their relative
 * differences are 0, 0.0005%, 3.6%, 2.7% and 0.22% — which is the decoder and
 * nothing else.
 *
 * `flatness` was in this list on the reasoning that it is a ratio bounded by 1 and
 * therefore scale-invariant. It is scale-invariant and it is not well conditioned:
 * it is the geometric over the arithmetic mean, a ratio of two nearly equal
 * quantities, and it measures 31% different between the two implementations on the
 * same file. Being inside [0,1] says nothing about how sensitive it is, which is the
 * second time in this project that a property which sounds like a guarantee turned
 * out to be an unrelated one.
 */
export const ROBUST = ['dur', 'zcr', 'centroid', 'rolloff85', 'flux']
  .map((n) => FEATURE_NAMES.indexOf(n));

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/**
 * Twiddles and the bit-reversal permutation, cached per length.
 *
 * `resample` runs one 65,536-point transform per cry and the STFT runs ~80
 * 512-point ones, so recomputing cos/sin per call would dominate the frame loop.
 */
const FFT_PLANS = new Map();

function fftPlan(n) {
  const cached = FFT_PLANS.get(n);
  if (cached) return cached;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT length ${n} is not a power of two`);
  const levels = 32 - Math.clz32(n - 1);
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < levels; b++) {
      r = (r << 1) | (x & 1);
      x >>>= 1;
    }
    rev[i] = r >>> 0;
  }
  const plan = { n, cos, sin, rev };
  FFT_PLANS.set(n, plan);
  return plan;
}

/** In-place decimation-in-time complex FFT, forward sign, `re`/`im` length n. */
function fft(re, im) {
  const plan = fftPlan(re.length);
  const { cos, sin, rev } = plan;
  const n = plan.n;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const l = j + half;
        const tre = re[l] * cos[k] + im[l] * sin[k];
        const tim = -re[l] * sin[k] + im[l] * cos[k];
        re[l] = re[j] - tre;
        im[l] = im[j] - tim;
        re[j] += tre;
        im[j] += tim;
      }
    }
  }
}

/**
 * Real FFT of the first `n` samples of `x`, zero-padded, returning `n / 2 + 1`
 * bins. Mirrors `numpy.fft.rfft`.
 */
export function rfft(x, n) {
  const bins = (n >> 1) + 1;
  const fullRe = new Float64Array(n);
  const fullIm = new Float64Array(n);
  const count = Math.min(x.length, n);
  for (let i = 0; i < count; i++) fullRe[i] = x[i];
  fft(fullRe, fullIm);
  return { re: fullRe.slice(0, bins), im: fullIm.slice(0, bins), bins };
}

/**
 * Inverse of `rfft`, for a half-spectrum of any length up to `n / 2 + 1`.
 *
 * Written as conjugate -> forward transform -> take the real part -> divide by
 * n, which is `conj(fft(conj(X)))[t] == n · x[t]` for a Hermitian spectrum and is
 * the shortest form that can be checked by reading it. Built by explicit
 * extension rather than a real-FFT shortcut so the index arithmetic stays
 * auditable against `numpy.fft.irfft`.
 *
 * @param {number} nOut take only this many samples; a 65,536-point inverse is
 *   65,536 samples and the caller usually wants far fewer
 */
export function irfft(xRe, xIm, n, nOut = n) {
  const zRe = new Float64Array(n);
  const zIm = new Float64Array(n);
  const m = Math.min(xRe.length, (n >> 1) + 1);
  for (let i = 0; i < m; i++) {
    zRe[i] = xRe[i];
    zIm[i] = -xIm[i];
  }
  // X[n-i] = conj(X[i]) for a real signal, so conj(X)[n-i] = X[i]. The Nyquist bin
  // is its own mirror and must not be written twice: the two writes agree only
  // because that bin is real, so skipping `j === i` states the reason instead of
  // relying on it. `i < m` rather than `i < m - 1`, because when the caller
  // passes a half-spectrum shorter than n/2+1 the last bin is NOT the Nyquist bin
  // and still has a mirror to fill.
  for (let i = 1; i < m; i++) {
    const j = n - i;
    if (j > i) {
      zRe[j] = xRe[i];
      zIm[j] = xIm[i];
    }
  }
  fft(zRe, zIm);
  const out = new Float64Array(nOut);
  for (let i = 0; i < nOut; i++) out[i] = zRe[i] / n;
  return out;
}

/**
 * Band-limited resample by truncation or zero-padding in the spectrum.
 *
 * Downsampling truncates the bins above the new Nyquist, which IS the
 * anti-aliasing; upsampling zero-pads them, which interpolates.
 *
 * NO amplitude factor, and that is the one deliberate divergence from
 * `analyze_cries.py`, which multiplies the kept bins by `nOut / nFft`. Zero-padding
 * a signal to `nFft` does not change `X` — the transform is just sampled on a
 * finer grid — so `irfft(X, nFft)` returns `x` exactly and 1.0 is the
 * amplitude-preserving scale. A 100 Hz tone from a 32,728 Hz source comes back at
 * 0.1465 of its amplitude under the extractor's factor, and no Nyquist cut can be
 * responsible for a 100 Hz tone. The file docblock works through what that factor
 * does and does not touch.
 */
export function resample(x, srIn, srOut = SR) {
  if (srIn === srOut) return Float64Array.from(x);
  const nIn = x.length;
  const nOut = Math.max(1, Math.round((nIn * srOut) / srIn));
  const largest = Math.max(nIn, nOut);
  const nFft = 1 << Math.max(1, largest <= 1 ? 0 : 32 - Math.clz32(largest - 1));

  const X = rfft(x, nFft);

  /* Keep every bin below the NEW Nyquist, and nothing above it.
   *
   * `nOut / 2` bins is the extractor's choice and it is wrong twice over: the
   * transform's bins are spaced `srIn / nFft` apart, so the highest bin it keeps
   * sits at `(nOut/2) * srIn / nFft` Hz — 5,859 Hz for a one-second file at 48 kHz,
   * against the 8,000 Hz a resample to 16 kHz is supposed to keep. And because
   * `nFft` follows the file's DURATION, so does that cutoff: measured across the
   * 1,025 latest cries it lands between 1.5 kHz and 16 kHz, which means the top
   * mel bands are computed from a signal band-limited at a frequency that depends
   * on how long the file is.
   *
   * `min(srIn, srOut) / 2` is the right Nyquist for both directions, and `+ 1`
   * because the Nyquist bin itself is inside the band. For UPSampling this is
   * `srIn / 2`, which is every bin `rfft` produced — and `irfft` zero-pads the
   * rest, which is exactly the interpolation. */
  const nyquist = Math.min(srIn, srOut) / 2;
  const keep = Math.min(X.bins, Math.floor((nyquist * nFft) / srIn) + 1);
  const yRe = new Float64Array(keep);
  const yIm = new Float64Array(keep);
  for (let i = 0; i < keep; i++) {
    yRe[i] = X.re[i];
    yIm[i] = X.im[i];
  }
  return irfft(yRe, yIm, nFft, nOut);
}

// ---------------------------------------------------------------------------
// Mel filterbank and DCT
// ---------------------------------------------------------------------------

export function hzToMel(f) {
  return 2595 * Math.log10(1 + f / 700);
}

export function melToHz(m) {
  return 700 * (10 ** (m / 2595) - 1);
}

/**
 * `N_MEL` triangular filters over `FMIN..sr/2` on the HTK mel scale, stored
 * row-major as `N_MEL x nBins`.
 *
 * Memoised on `(nFft, sr)`. After resampling every input shares one rate, so a
 * single bank is correct for all of them — which is the entire reason the Python
 * resamples before filtering rather than building a bank per file.
 */
const FILTERBANKS = new Map();

export function melFilterbank(nFft = N_FFT, sr = SR) {
  const key = `${nFft}:${sr}`;
  const cached = FILTERBANKS.get(key);
  if (cached) return cached;

  const nBins = (nFft >> 1) + 1;
  const melLo = hzToMel(FMIN);
  const melHi = hzToMel(sr / 2);
  const edges = new Float64Array(N_MEL + 2);
  for (let i = 0; i < N_MEL + 2; i++) {
    edges[i] = melToHz(melLo + ((melHi - melLo) * i) / (N_MEL + 1));
  }

  const freqs = new Float64Array(nBins);
  for (let k = 0; k < nBins; k++) freqs[k] = (k * sr) / nFft;

  const weights = new Float64Array(N_MEL * nBins);
  for (let i = 0; i < N_MEL; i++) {
    const lo = edges[i];
    const mid = edges[i + 1];
    const hi = edges[i + 2];
    const rise = Math.max(mid - lo, EPS);
    const fall = Math.max(hi - mid, EPS);
    const base = i * nBins;
    let area = 0;
    for (let k = 0; k < nBins; k++) {
      const up = (freqs[k] - lo) / rise;
      const down = (hi - freqs[k]) / fall;
      const v = Math.max(0, Math.min(up, down));
      weights[base + k] = v;
      area += v;
    }
    const norm = 1 / Math.max(area, EPS);
    for (let k = 0; k < nBins; k++) weights[base + k] *= norm;
  }

  const bank = { weights, nBins, edges, sr, nFft, nMel: N_MEL };
  FILTERBANKS.set(key, bank);
  return bank;
}

/**
 * Centre frequency of each mel band, in Hz.
 *
 * The geometric midpoint of the band edges, not the arithmetic one, because the
 * axis it labels is logarithmic: an arithmetic midpoint drawn on a log axis is
 * not the middle of what the reader sees, and across 26 bands from 50 Hz to
 * 8 kHz that drift is about half a band at the top.
 */
export function melBandCentres(bank = melFilterbank()) {
  const out = new Float64Array(bank.nMel);
  for (let i = 0; i < bank.nMel; i++) {
    out[i] = melToHz((hzToMel(bank.edges[i]) + hzToMel(bank.edges[i + 1])) / 2);
  }
  return out;
}

/** Orthonormal DCT-II, `nOut x nIn`, row-major. Mirrors `dct_matrix()`. */
export function dctMatrix(nIn = N_MEL, nOut = N_MFCC) {
  const matrix = new Float64Array(nOut * nIn);
  const scale = Math.sqrt(2 / nIn);
  for (let k = 0; k < nOut; k++) {
    for (let n = 0; n < nIn; n++) {
      matrix[k * nIn + n] = Math.cos((Math.PI * k * (2 * n + 1)) / (2 * nIn)) * scale;
    }
  }
  for (let n = 0; n < nIn; n++) matrix[n] *= Math.sqrt(0.5);
  return { matrix, nIn, nOut };
}

/**
 * numpy's `np.hamming`, which is SYMMETRIC: `0.54 - 0.46·cos(2πn/(M-1))`.
 *
 * The window is 400 samples and the FFT is 512, so this is also where a reader
 * looking for the periodic form will land. The name says Hamming because it is,
 * and the symmetric form is the load-bearing detail.
 */
const HAMMING = (() => {
  const w = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  return w;
})();

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Number of frames, and the padding decision that goes with it.
 *
 * The tail is padded so the last partial note is kept: without it a 0.181 s cry
 * — the shortest in the corpus — loses its final 6 ms to a frame boundary, and
 * the shortest files are disproportionately the short yelps where the attack
 * carries the character. Mirrors `frame_signal`, including the rule that a
 * signal shorter than one frame is padded to exactly one frame rather than
 * being reported as zero frames.
 */
export function frameLayout(n) {
  const total = n < FRAME ? FRAME : n;
  return { total, nFrames: 1 + Math.floor((total - FRAME) / HOP) };
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/**
 * One pass over a cry: the log-mel spectrogram to draw, and the 34 features to
 * check against.
 *
 * ONE pass, not two, because the Python computes its spectral scalars and its
 * MFCC from the same `power` array. Two passes would let the halves describe
 * different frames the moment either changed, and both would still look
 * reasonable.
 *
 * @param {ArrayLike<number>} samples mono, at whatever rate `srIn` says
 * @param {number} srIn the rate `samples` is actually at
 * @param {{sr?: number, fb?: object, dct?: object}} [opts] overrides, for tests
 */
export function analyseCry(samples, srIn, opts = {}) {
  const sr = opts.sr ?? SR;
  const fb = opts.fb ?? melFilterbank(N_FFT, sr);
  const dct = opts.dct ?? dctMatrix(fb.nMel, N_MFCC);
  const nBins = fb.nBins;

  const x = resample(samples, srIn, sr);
  const n = x.length;
  const duration = n / sr;
  const peak = maxAbs(x);
  const rms = Math.sqrt(meanSquare(x));

  // Zero crossings as a rate. Counting sign changes counts one crossing for a
  // pair of adjacent samples either side of zero, which is the standard
  // definition; a dead-silent file is 0 by the guard rather than by luck.
  let zcr = 0;
  if (n > 1 && peak > 0) {
    let crossings = 0;
    let prev = x[0] < 0;
    for (let i = 1; i < n; i++) {
      const cur = x[i] < 0;
      if (cur !== prev) crossings++;
      prev = cur;
    }
    zcr = crossings / duration;
  }

  // Pre-emphasis, then framing, then the power spectrum. This one spectrum
  // serves the scalar features AND the MFCC, so both describe the same frames.
  const emphasised = new Float64Array(n);
  emphasised[0] = x[0];
  for (let i = 1; i < n; i++) emphasised[i] = x[i] - PRE_EMPHASIS * x[i - 1];

  const { total, nFrames } = frameLayout(n);
  let padded = emphasised;
  if (total !== n) {
    padded = new Float64Array(total);
    padded.set(emphasised);
  }

  const meanPower = new Float64Array(nBins);
  const logMel = new Float32Array(nFrames * N_MEL);
  const magnitude = new Float64Array(nBins);
  const prevMagnitude = new Float64Array(nBins);
  const frameRe = new Float64Array(N_FFT);
  const frameIm = new Float64Array(N_FFT);
  const windowed = new Float64Array(FRAME);

  let magnitudeSum = 0;
  let positiveFlux = 0;

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) windowed[i] = padded[off + i] * HAMMING[i];
    // `fill(0)` before `set` is load-bearing, not tidiness. `fft` transforms IN
    // PLACE, so after frame 0 the buffer holds that frame's spectrum; `set` then
    // overwrites only the first FRAME of it and leaves 112 bins of the previous
    // transform sitting in the zero-pad tail to be read as if they were samples.
    // Frame 0 is correct either way, which is what makes it invisible until a
    // feature that averages over frames comes out wrong by a factor of six.
    frameRe.fill(0);
    frameRe.set(windowed);
    frameIm.fill(0);
    fft(frameRe, frameIm);

    for (let k = 0; k < nBins; k++) {
      const p = frameRe[k] * frameRe[k] + frameIm[k] * frameIm[k];
      meanPower[k] += p;
      const mag = Math.sqrt(Math.max(p, 0));
      magnitude[k] = mag;
      magnitudeSum += mag;
      if (f > 0) {
        const d = mag - prevMagnitude[k];
        if (d > 0) positiveFlux += d;
      }
    }
    prevMagnitude.set(magnitude);

    const base = f * N_MEL;
    for (let m = 0; m < N_MEL; m++) {
      const row = m * nBins;
      let acc = 0;
      for (let k = 0; k < nBins; k++) acc += magnitude[k] * fb.weights[row + k];
      logMel[base + m] = Math.log(Math.max(acc, EPS));
    }
  }

  if (nFrames > 0) {
    for (let k = 0; k < nBins; k++) meanPower[k] /= nFrames;
  }

  let totalPower = 0;
  for (let k = 0; k < nBins; k++) totalPower += meanPower[k];

  let centroid = 0;
  let rolloff85 = 0;
  let flatness = 0;
  if (totalPower > 0) {
    let weighted = 0;
    let cumulative = 0;
    let rolloffBin = -1;
    for (let k = 0; k < nBins; k++) {
      weighted += ((k * sr) / N_FFT) * meanPower[k];
      cumulative += meanPower[k];
      if (rolloffBin < 0 && cumulative / totalPower >= 0.85) rolloffBin = k;
    }
    // Unreachable while `totalPower` is the sum of the same bins, but a rolloff of
    // 0 Hz would be a claim rather than a measurement, so it is floored honestly.
    const bin = rolloffBin < 0 ? nBins - 1 : rolloffBin;
    centroid = weighted / totalPower;
    rolloff85 = (bin * sr) / N_FFT;

    let logSum = 0;
    let arithSum = 0;
    for (let k = 0; k < nBins; k++) {
      logSum += Math.log(Math.max(meanPower[k], EPS));
      arithSum += meanPower[k];
    }
    // Geometric over arithmetic mean, floored first: a band of exact zeros would
    // otherwise give log(0) and a silent file a flatness of NaN.
    flatness = Math.min(Math.exp(logSum / nBins) / (arithSum / nBins + EPS), 1);
  }

  // Flux on magnitudes, positive part only, so a decaying tail does not cancel an
  // attack into looking like nothing. Divided by frames AND by bins: `magnitude`
  // in the Python is a (n_frames x n_bins) array and its `.mean()` is over both.
  const flux = nFrames > 1
    ? positiveFlux / (nFrames - 1) / (magnitudeSum / (nFrames * nBins) + EPS)
    : 0;

  const mfcc = new Float64Array(N_MFCC * nFrames);
  for (let k = 0; k < N_MFCC; k++) {
    for (let m = 0; m < N_MEL; m++) {
      const w = dct.matrix[k * N_MEL + m];
      if (w === 0) continue;
      const row = k * nFrames;
      for (let f = 0; f < nFrames; f++) mfcc[row + f] += w * logMel[f * N_MEL + m];
    }
  }

  const features = new Float64Array(DIMENSIONS);
  features[0] = duration;
  features[1] = peak;
  features[2] = rms;
  features[3] = zcr;
  features[4] = centroid;
  features[5] = rolloff85;
  features[6] = flatness;
  features[7] = flux;

  const rows = [8, 8 + N_MFCC];
  for (let k = 0; k < N_MFCC; k++) {
    const row = k * nFrames;
    let sum = 0;
    for (let f = 0; f < nFrames; f++) sum += mfcc[row + f];
    const mean = nFrames ? sum / nFrames : 0;
    let varSum = 0;
    for (let f = 0; f < nFrames; f++) {
      const d = mfcc[row + f] - mean;
      varSum += d * d;
    }
    features[rows[0] + k] = mean;
    // Population standard deviation, numpy's default. ddof=1 on the same frames
    // moves all 13 `ms` columns by ~0.6%, which is a difference in the table
    // `cries.html` standardises, so it is not a rounding detail.
    features[rows[1] + k] = nFrames ? Math.sqrt(varSum / nFrames) : 0;
  }

  return {
    sr,
    duration,
    nFrames,
    hop: HOP,
    nMel: N_MEL,
    /**
     * Natural log of the mel energies, `nFrames x N_MEL`, row-major.
     *
     * In natural log rather than dB because this is the Python's `log_mel`
     * verbatim — the comparison in `spectrum.html` is meaningless if one side
     * took a logarithm and the other did not. The page converts to dB for
     * drawing, against a floor it chooses and states.
     */
    logMel,
    features,
    comparable: COMPARABLE,
    uncomparable: UNCOMPARABLE,
  };
}

/**
 * `analyseCry`'s spectrogram alone, for a caller that only draws.
 *
 * @returns {{sr: number, duration: number, nFrames: number, hop: number,
 *            nMel: number, logMel: Float32Array}}
 */
export function melSpectrogram(samples, srIn, opts = {}) {
  const { logMel, sr, duration, nFrames, hop, nMel } = analyseCry(samples, srIn, opts);
  return { logMel, sr, duration, nFrames, hop, nMel };
}

/**
 * `analyseCry`'s 34 features alone.
 *
 * @returns {Float64Array} positional: `FEATURE_NAMES[i]` is entry `i`
 */
export function featureRow(samples, srIn, opts = {}) {
  return analyseCry(samples, srIn, opts).features;
}

/**
 * The loudest mel band's centre frequency, read off a computed spectrogram.
 *
 * A reading of the thing being drawn rather than an independent measurement,
 * which is why it is the one browser-side number the page may present as a bare
 * Hz figure: it cannot disagree with the picture, because it is the picture's own
 * maximum.
 *
 * @param {Float32Array} logMel `nFrames x nMel`, from `melSpectrogram`
 * @param {object} [bank] a filterbank compatible with the spectrogram's rate
 */
export function loudestBand(logMel, bank = melFilterbank()) {
  const centres = melBandCentres(bank);
  const nFrames = Math.floor(logMel.length / N_MEL);
  let best = 0;
  let bestValue = -Infinity;
  let bestFrame = 0;
  for (let f = 0; f < nFrames; f++) {
    for (let m = 0; m < N_MEL; m++) {
      const v = logMel[f * N_MEL + m];
      if (v > bestValue) {
        bestValue = v;
        best = m;
        bestFrame = f;
      }
    }
  }
  return { index: best, hz: centres[best], frame: bestFrame, value: bestValue };
}

function maxAbs(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] < 0 ? -x[i] : x[i];
    if (v > m) m = v;
  }
  return m;
}

function meanSquare(x) {
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return sum / x.length;
}
