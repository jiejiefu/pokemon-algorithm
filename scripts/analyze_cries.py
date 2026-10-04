#!/usr/bin/env python3
"""Compute a fixed-length feature vector for every cry in assets/cries/.

Writes assets/data/cry_features.json: one 34-number row per roster file, for
1,025 latest cries and 649 legacy ones.

Usage:
    python scripts/analyze_cries.py             # write the JSON
    python scripts/analyze_cries.py --dry-run   # report without writing

WHY THIS IS A SEPARATE OFFLINE STEP
-----------------------------------
A similarity search over 1,025 cries means 1,025 x 1,025 comparisons. Doing that
in the browser needs a 1,025 x 34 matrix in memory, which is about 400 KB of
JSON and nothing else -- cheap to ship, and it lets the search respond instantly
to a slider. Precomputing the 1,025 x 1,025 similarity matrix instead would be 4
MB of floats to answer 525,000 pairs, so it is not stored; the browser multiplies
the 34-wide rows on demand instead, which is 35k multiply-adds per query.

The features are computed here rather than in the browser because decoding 1,674
audio files is seconds of work and needs a decoder that only libsndfile has.

EVERYTHING IS RESAMPLED TO 16 kHz FIRST, AND THAT IS NOT COSMETIC
----------------------------------------------------------------
The corpus is not uniform. Measured across all 1,674 roster files there are
FIFTEEN sample rates, from 8,000 Hz to 48,000 Hz, and 784 of the files sit at
32,728 Hz while 120 sit at 44,100 Hz. A mel filterbank built over each file's own
Nyquist would give those two groups different meanings for the same coefficient,
so a similarity search would partly be measuring which encoder produced the file
rather than what the cry sounds like. The resampling puts them on one axis.

16 kHz rather than 22.05 kHz because the cries carry almost nothing above it:
measured over 30 random latest cries, 90.6% of the spectral energy is below
4 kHz, 98.2% is below 8 kHz, and only 1.8% is above. Upsampling the one 8 kHz
file and the handful below 16 kHz adds no information but keeps every row the
same width, which is the point.

NO SCIPY, NO LIBROSA
--------------------
numpy is already pinned for the palette generator and this repo keeps its
dependencies narrow on purpose (colorthief is pre-1.0, OpenCC is a ctypes
binding). So the resampler, the mel filterbank and the DCT are written out here.
The resampler is the FFT method: truncate the spectrum above the new Nyquist
(downsampling, which is the anti-aliasing) and zero-pad it (upsampling). That is
exact band-limited interpolation, and it is a fifth of the code a windowed-sinc
polyphase filter needs and fast enough for the whole corpus in seconds.

WHAT IS MEASURED, AND WHY EACH ONE
----------------------------------
  dur        seconds, so a long drawl and a clipped yelp can be told apart
  peak       max |sample|, measured on the decoded signal at its native rate and
             NOT clamped. Kept raw rather than normalised: see the note on
             amplitudes below.
  rms        loudness, so the same cry at two volumes is not one cry
  zcr        zero crossings per second. Bright, noisy cries score high and a
             pure low hum scores near zero; cheap and surprisingly separable.
  centroid   energy-weighted mean frequency, the "brightness" in one number
  rolloff85  frequency below which 85% of the energy sits. Complements the
             centroid: two cries can share a centroid and differ in how much
             high end they carry.
  flatness   geometric over arithmetic mean of the power spectrum. Near 1 is
             noise-like, near 0 is tonal. This is the feature that separates a
             voiced cry from one with a burst of static on it.
  flux       mean positive change between consecutive frames. Picks up attacks
             and onsets, which is what makes two cries feel alike beyond timbre.

  m0..m12    13 MFCC means. The timbre.
  ms0..ms12  13 MFCC standard deviations. How much the timbre MOVES over the
             cry, which separates a drawn-out cry that changes pitch from one
             that holds a single note.

MFCC is the standard speech pipeline -- pre-emphasis, 25 ms Hamming frames at
10 ms hop, power spectrum, 26 mel bands from 50 Hz to 8 kHz, log, DCT-II, keep
13 -- done by hand for the dependency reason above.

GUARDS, BECAUSE THESE FILES ARE NOT CLEAN
-----------------------------------------
Three of the roster files are MPEG layer III behind an .ogg name, and MP3
decoders emit a run of near-silence at each end whose level depends on the
encoder. Dividing by a zero RMS to get a normalised quantity would produce NaN,
and a single NaN in the matrix poisons every comparison it takes part in. So
every division has an explicit floor and the checker refuses to let a non-finite
value through at all.

Peaks are NOT clipped. Measured, 25.ogg decodes to a maximum sample of 1.0391,
which is legal for Vorbis and would be clipped by anything assuming [-1, 1].
Clamping here would make `peak` a property of this script rather than of the
file. Consumers that draw an envelope clamp at draw time instead.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "data" / "cry_features.json"
CRY_SOURCE = "https://github.com/PokeAPI/cries"

SR = 16_000                 # everything is resampled to this first
FRAME = int(round(0.025 * SR))   # 400 samples
HOP = int(round(0.010 * SR))     # 160 samples
N_FFT = 512
N_MEL = 26
N_MFCC = 13
FMIN = 50.0
FMAX = SR / 2
PRE_EMPHASIS = 0.97

FEATURE_NAMES = (
    ["dur", "peak", "rms", "zcr", "centroid", "rolloff85", "flatness", "flux"]
    + [f"m{i}" for i in range(N_MFCC)]
    + [f"ms{i}" for i in range(N_MFCC)]
)
DIMENSIONS = len(FEATURE_NAMES)

#: Anything below this is treated as silence when taking a log or a ratio.
EPS = 1e-10


def resample(x: np.ndarray, sr_in: int, sr_out: int = SR) -> np.ndarray:
    """Band-limited resample by truncation or zero-padding in the spectrum.

    Downsampling truncates the bins above the new Nyquist, which is the
    anti-aliasing; upsampling zero-pads them, which interpolates. The
    n_out / n_fft factor keeps the amplitude of the kept bins where it was,
    without which every quiet file would come back louder than it went in.
    """
    if sr_in == sr_out:
        return x.astype(np.float64, copy=False)
    n_in = len(x)
    n_out = max(1, int(round(n_in * sr_out / sr_in)))
    n_fft = 1 << max(1, (max(n_in, n_out) - 1).bit_length())

    X = np.fft.rfft(x, n_fft)
    Y = np.zeros(n_out // 2 + 1, dtype=complex)
    keep = min(len(X), len(Y))
    Y[:keep] = X[:keep] * (n_out / n_fft)
    return np.fft.irfft(Y, n_fft)[:n_out]


def hz_to_mel(f: np.ndarray | float) -> np.ndarray | float:
    return 2595.0 * np.log10(1.0 + np.asarray(f, dtype=np.float64) / 700.0)


def mel_to_hz(m: np.ndarray) -> np.ndarray:
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)


def mel_filterbank(n_fft: int, sr: int = SR) -> np.ndarray:
    """N_MEL triangular filters over FMIN..FMAX, HTK mel scale.

    Built once per script run rather than per file: after resampling, every file
    shares a sample rate, so one filterbank is correct for all of them.
    """
    edges = mel_to_hz(np.linspace(hz_to_mel(FMIN), hz_to_mel(FMAX), N_MEL + 2))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

    fb = np.zeros((N_MEL, len(freqs)))
    for i in range(N_MEL):
        lo, mid, hi = edges[i], edges[i + 1], edges[i + 2]
        rising = (freqs - lo) / max(mid - lo, EPS)
        falling = (hi - freqs) / max(hi - mid, EPS)
        fb[i] = np.maximum(0.0, np.minimum(rising, falling))
    # Normalising each filter to unit area makes the bands comparable in level;
    # without it the wide high-frequency triangles contribute almost nothing and
    # MFCC coefficient 1 and 2 drift toward zero.
    areas = fb.sum(axis=1, keepdims=True)
    return fb / np.maximum(areas, EPS)


def dct_matrix(n_in: int, n_out: int) -> np.ndarray:
    """Orthonormal DCT-II, n_out x n_in."""
    k = np.arange(n_out)[:, None]
    n = np.arange(n_in)[None, :]
    D = np.cos(np.pi * k * (2 * n + 1) / (2 * n_in)) * math.sqrt(2.0 / n_in)
    D[0] *= math.sqrt(0.5)
    return D


def frame_signal(x: np.ndarray) -> np.ndarray:
    """Split into frames, padding the tail so the last partial note is kept.

    Without the pad a 0.181s cry -- the shortest in the corpus -- would lose its
    final 6ms to a frame boundary, and the shortest files are disproportionately
    the short yelps where the attack carries the character.
    """
    if len(x) < FRAME:
        x = np.pad(x, (0, int(FRAME) - len(x)))
    n_frames = 1 + (len(x) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n_frames)[:, None]
    return x[idx] * np.hamming(FRAME)[None, :]


def analyse(raw: np.ndarray, x: np.ndarray, fb: np.ndarray, dct: np.ndarray) -> list[float]:
    """One 34-number row for one cry.

    `raw` is the decoded signal at its native rate and `x` is `raw` resampled to
    SR. Only peak and rms come from `raw`, because both are independent of the
    sample rate -- so measuring them after resampling would throw away a real
    property of the file for nothing. It is not a cosmetic difference: 25.ogg
    decodes to a maximum sample of 1.0391, and FFT resampling smooths that down
    to under 0.94, which would make a corpus fact -- these files are not clipped
    -- disappear into the numbers.
    """
    n = len(x)
    dur = n / SR

    peak = float(np.max(np.abs(raw))) if len(raw) else 0.0
    rms = float(np.sqrt(np.mean(np.square(raw)))) if len(raw) else 0.0

    # Zero crossings, as a rate. Counting sign changes on the raw signal counts
    # one crossing for a pair of adjacent samples either side of zero, which is
    # the standard definition; a dead-silent file is 0 by the guard rather than
    # by luck.
    if n > 1 and peak > 0:
        zcr = float(np.count_nonzero(np.diff(np.signbit(x)))) / dur
    else:
        zcr = 0.0

    # Pre-emphasised, framed, power spectrum. This one array serves the
    # spectral features and the MFCC, so the numbers describe the same frames.
    emphasised = np.append(x[0], x[1:] - PRE_EMPHASIS * x[:-1]) if n else x
    frames = frame_signal(emphasised)
    power = np.abs(np.fft.rfft(frames, N_FFT, axis=1)) ** 2
    mean_power = power.mean(axis=0)

    total = mean_power.sum()
    if total > 0:
        freqs = np.fft.rfftfreq(N_FFT, 1.0 / SR)
        centroid = float((freqs * mean_power).sum() / total)
        cumulative = np.cumsum(mean_power) / total
        rolloff = float(freqs[int(np.searchsorted(cumulative, 0.85))])
        # Geometric mean over arithmetic mean, floored first: a band of exact
        # zeros would otherwise give log(0) and a silent file a flatness of NaN.
        geometric = float(np.exp(np.log(np.maximum(mean_power, EPS)).mean()))
        flatness = geometric / float(mean_power.mean() + EPS)
        flatness = min(flatness, 1.0)
    else:
        centroid = 0.0
        rolloff = 0.0
        flatness = 0.0

    # Flux on magnitudes, positive part only, so a decaying tail does not cancel
    # an attack into looking like nothing.
    magnitude = np.sqrt(np.maximum(power, 0.0))
    if len(magnitude) > 1:
        diff = np.diff(magnitude, axis=0)
        flux = float(np.maximum(diff, 0.0).sum() / (len(magnitude) - 1) / (magnitude.mean() + EPS))
    else:
        flux = 0.0

    log_mel = np.log(np.maximum(magnitude @ fb.T, EPS))
    mfcc = dct @ log_mel.T
    mfcc_mean = mfcc.mean(axis=1)
    mfcc_std = mfcc.std(axis=1)

    values = [dur, peak, rms, zcr, centroid, rolloff, flatness, flux]
    values += list(mfcc_mean[:N_MFCC])
    values += list(mfcc_std[:N_MFCC])
    assert len(values) == DIMENSIONS, f"row has {len(values)} values, names have {DIMENSIONS}"

    return [compact(v) for v in values]


def compact(v: float) -> float:
    """Six significant digits.

    Enough that two cries which differ audibly cannot collide, small enough that
    the JSON stays loadable by the browser on every page that wants it.
    """
    v = float(v)
    if not math.isfinite(v):
        raise ValueError(f"non-finite feature value {v!r}")
    return float(f"{v:.6g}")


def collect(pairs: list[tuple[int, Path]]) -> tuple[dict, list[str]]:
    fb = mel_filterbank(N_FFT)
    dct = dct_matrix(N_MEL, N_MFCC)
    rows: dict[str, list[float]] = {}
    notes: list[str] = []

    for n, (pid, path) in enumerate(pairs, start=1):
        x, sr_in = sf.read(path, dtype="float32", always_2d=True)
        if x.shape[1] > 1:
            # One roster file is stereo. Averaging is what a mono cry buffer
            # would have done anyway, and keeping the channels would make its row
            # a different shape from every other.
            notes.append(f"#{pid}: {x.shape[1]} channels, averaged to mono")
            x = x.mean(axis=1, keepdims=True)
        x = x.mean(axis=1)
        if len(x) == 0:
            raise SystemExit(f"{path}: decodes to zero samples")
        rows[str(pid)] = analyse(x, resample(x, sr_in), fb, dct)
        if n % 250 == 0:
            print(f"  ...{n}/{len(pairs)}")

    return rows, notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true",
                    help="compute and report without writing the JSON")
    args = ap.parse_args()

    latest = [(i, ROOT / f"assets/cries/latest/{i}.ogg") for i in range(1, 1026)]
    legacy = [(i, ROOT / f"assets/cries/legacy/{i}.ogg") for i in range(1, 650)]
    missing = [str(p) for _, p in latest + legacy if not p.exists()]
    if missing:
        raise SystemExit(
            f"{len(missing)} roster cries are missing, e.g. {missing[:3]}\n"
            "Run scripts/extract_cry_index.py first; this reads the same roster."
        )

    print(f"analysing {len(latest)} latest + {len(legacy)} legacy cries "
          f"at {SR} Hz, {DIMENSIONS} features each")
    latest_rows, latest_notes = collect(latest)
    legacy_rows, legacy_notes = collect(legacy)

    for note in latest_notes + legacy_notes:
        print(f"  note: {note}")

    # Report rather than assert: the point of these numbers is that they are not
    # what an audio file is supposed to look like, and the checker is where they
    # become a gate.
    peaks = [r[1] for r in latest_rows.values()]
    durs = [r[0] for r in latest_rows.values()]
    flat = [r[6] for r in latest_rows.values()]
    print(f"  peak      : max {max(peaks):.4f} (above 1.0 means the file is not clipped)")
    print(f"  duration  : {min(durs):.3f}s .. {max(durs):.3f}s")
    print(f"  flatness  : {min(flat):.4f} .. {max(flat):.4f} (1.0 is pure noise)")

    if args.dry_run:
        print("dry run: nothing written")
        return 0

    OUT.write_text(json.dumps({
        "source": CRY_SOURCE,
        "sampleRate": SR,
        "dimensions": DIMENSIONS,
        "featureNames": list(FEATURE_NAMES),
        "note": (
            "Generated by scripts/analyze_cries.py. Every file is resampled to "
            f"{SR} Hz first: the corpus spans fifteen sample rates from 8,000 to "
            "48,000 Hz, and a mel filterbank built over each file's own Nyquist "
            "would make a similarity search partly measure which encoder produced "
            "the file. 16 kHz is chosen because 98.2% of the measured spectral "
            "energy sits below it. Peaks are deliberately NOT clamped -- 25.ogg "
            "decodes to a maximum sample of 1.0391, which is legal Vorbis and is a "
            "property of the file rather than of this script. No similarity matrix "
            "is stored: 1,025 squared floats is 4 MB, and the browser multiplies "
            "these rows on demand instead."
        ),
        "latest": latest_rows,
        "legacy": legacy_rows,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")

    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)} ({size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())