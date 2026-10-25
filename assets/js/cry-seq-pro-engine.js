/**
 * Audio engine for cry-studio.html — scheduling, tuning, effects, drums, export.
 *
 * What this file owns, and what it borrows
 * ----------------------------------------
 * It borrows the cries: `cryPlayer.decoded(id)` already fetches, decodes and
 * caches every cry on the site, so this file asks for the buffer instead of
 * running a second fetch + `decodeAudioData` of its own (cry-player.js documents
 * that method as the intended way for a page to get samples).
 *
 * It does NOT play through `cryPlayer.play()`. A sequencer needs sample-accurate
 * start times, per-note playbackRate and a shared effects chain, none of which a
 * fire-and-forget player has. So it owns its own AudioContext and uses the
 * decoded buffers as plain data — an AudioBuffer is not tied to the context that
 * decoded it, and a BufferSource resamples on playback if the two contexts run at
 * different rates. The site-wide cry mute is deliberately NOT applied: pressing
 * ▶ on a music editor is the explicit opt-in that mute exists to protect, and the
 * page has its own master volume. Nothing here makes a sound before a click (the
 * context is created inside `unlock()`, which the page calls from a gesture).
 *
 * Tuning
 * ------
 * A cry has a pitch only by accident. `estimateF0()` runs YIN over the decoded
 * samples and keeps the energy-weighted median of the voiced frames, so
 * `rate = targetHz / f0` lands a cry on the note it was placed on. Two things it
 * cannot fix, and the page says so rather than pretending: a cry that glides is
 * tuned by its median, so the MIDDLE is on pitch and the ends are not; and a cry
 * that is mostly noise has no f0 at all, in which case `confidence` is low and
 * `FALLBACK_F0` is used so it still plays at a consistent, if arbitrary, pitch.
 * `tune: 'raw'` skips all of it and treats a row as a plain semitone offset from
 * the file's own pitch, which is the honest mode for the noisy ones.
 *
 * Why the grid starts at C4 (pattern.js BASE_MIDI): measured on real cries the
 * median f0 sits at 250–1100 Hz, and rate is clamped to [0.25, 4] because beyond
 * that a cry stops sounding like itself. C4..C6 keeps the ratio near 1 for the
 * common case; the octave knob moves the whole grid when a species is an outlier.
 *
 * Live and offline are the same code
 * ----------------------------------
 * `scheduleStep(env, ...)` is called by the live look-ahead timer AND by
 * `renderWav()` against an OfflineAudioContext, with only `env` differing. That is
 * what makes the exported .wav a faithful copy of what the reader heard, and it
 * means a test can render a pattern headlessly and measure the result.
 */

import { cryPlayer } from './cry-player.js';
import {
  rowToMidi, midiToHz, DELAY_STEPS, FX_RANGES, CHORD_STEPS, chordTones,
} from './cry-seq-pro-pattern.js';

export const FALLBACK_F0 = 330;
const RATE_MIN = 0.25;
const RATE_MAX = 4;
const LOOKAHEAD = 0.18; // seconds scheduled ahead of the clock
const TICK_MS = 25;
const MAX_VOICES = 28;
const VEL_GAIN = [0, 0.5, 0.78, 1];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------ pitch (YIN) */

/**
 * Estimate a decoded cry's fundamental, and how loudly it should be played.
 *
 * Runs at ~12 kHz: a box-filter downsample by round(sr/12000), because YIN's cost
 * is window × lag-range and the cry fundamentals we care about (70–1500 Hz) are
 * well inside the 6 kHz Nyquist. Frames of 1024 samples every 256, difference
 * function + cumulative-mean normalisation + the usual 0.15 absolute threshold,
 * then parabolic interpolation of the lag.
 *
 * @returns {{hz: number|null, confidence: number, onset: number, gain: number}}
 *   onset: seconds of leading silence to skip so notes land on the grid;
 *   gain: multiplier that brings every cry to a similar loudness.
 */
export function analyseCry(buffer) {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i += 2) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak < 1e-4) return { hz: null, confidence: 0, onset: 0, gain: 1 };

  // Leading silence: first sample above 4% of peak, minus 2 ms of lead-in.
  let first = 0;
  while (first < ch.length && Math.abs(ch[first]) < peak * 0.04) first++;
  const onset = Math.max(0, first / sr - 0.002);

  // Loudness: RMS over the audible part only, so a cry that is 80% tail is not
  // boosted into the next note.
  let sum = 0;
  let count = 0;
  for (let i = first; i < ch.length; i += 3) {
    const v = ch[i];
    if (Math.abs(v) > peak * 0.02) { sum += v * v; count++; }
  }
  const rms = count ? Math.sqrt(sum / count) : peak;
  const gain = clamp(0.14 / Math.max(rms, 1e-4), 0.25, 3);

  const dec = Math.max(1, Math.round(sr / 12000));
  const rate = sr / dec;
  const n = Math.floor(ch.length / dec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < dec; j++) s += ch[i * dec + j];
    x[i] = s / dec;
  }

  const W = 1024;
  const HOP = 256;
  const tauMin = Math.max(2, Math.floor(rate / 1500));
  const tauMax = Math.min(Math.ceil(rate / 70), W - 1);
  const d = new Float32Array(tauMax + 1);
  const cmnd = new Float32Array(tauMax + 1);
  const frames = [];
  let maxRms = 0;

  for (let start = Math.floor(first / dec); start + W + tauMax < n; start += HOP) {
    let e = 0;
    for (let j = 0; j < W; j++) e += x[start + j] * x[start + j];
    const frameRms = Math.sqrt(e / W);
    frames.push({ start, rms: frameRms });
    if (frameRms > maxRms) maxRms = frameRms;
  }
  const voiced = [];
  let active = 0;
  for (const f of frames) {
    if (f.rms < maxRms * 0.12) continue;
    active++;
    for (let tau = 1; tau <= tauMax; tau++) {
      let acc = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[f.start + j] - x[f.start + j + tau];
        acc += diff * diff;
      }
      d[tau] = acc;
    }
    cmnd[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau];
      cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmnd[tau] < 0.15) {
        while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) continue;
    const a = cmnd[best - 1];
    const b = cmnd[best];
    const c = cmnd[best + 1];
    const denom = a - 2 * b + c;
    const shift = Math.abs(denom) > 1e-9 ? (a - c) / (2 * denom) : 0;
    voiced.push({ hz: rate / (best + clamp(shift, -1, 1)), w: f.rms });
  }

  const confidence = active ? voiced.length / active : 0;
  if (voiced.length < 2 || confidence < 0.2) return { hz: null, confidence, onset, gain };
  voiced.sort((p, q) => p.hz - q.hz);
  const total = voiced.reduce((s, v) => s + v.w, 0);
  let acc = 0;
  let hz = voiced[voiced.length - 1].hz;
  for (const v of voiced) { acc += v.w; if (acc >= total / 2) { hz = v.hz; break; } }
  return { hz, confidence, onset, gain };
}

/* ----------------------------------------------------------- effect graph */

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** Stereo exponentially-decaying noise, with a one-pole lowpass that closes as the
 *  tail decays — the cheap, convincing "room". */
function makeImpulse(ctx, seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.9 - 0.8 * t; // damping rises through the tail
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      data[i] = lp * (1 - t) ** 2.2 * 1.6;
    }
  }
  return ir;
}

function driveCurve(amount) {
  if (amount <= 0.001) return null;
  const k = 1 + amount * 40;
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
  return c;
}
function crushCurve(amount) {
  if (amount <= 0.001) return null;
  const bits = 16 - 13 * amount; // 16 → 3 bits
  const levels = 2 ** (bits - 1);
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.round(((i / (n - 1)) * 2 - 1) * levels) / levels;
  return c;
}

/**
 * Build the whole signal path on `ctx` and return handles to it.
 *
 *   cries → drive → crush → filter(+wah) → cryVol ─┬─ duck ──────────────┐
 *   drums ───────────────────────────────→ drumVol ─┼─ (dry) ─────────────┤→ master → limiter → out
 *                                  both ──send──→ delay ──────────────────┤
 *                                  both ──send──→ reverb ─────────────────┘
 *
 * The sidechain `duck` sits on the DRY cry path only, so a kick pumps the
 * melody without cutting off its own reverb tail — the usual dance-music trick.
 */
export function createGraph(ctx) {
  const g = { ctx };
  const node = (type) => ctx[type]();

  g.cryBus = node('createGain');
  g.drive = node('createWaveShaper');
  g.driveOut = node('createGain');
  g.crush = node('createWaveShaper');
  g.filter = node('createBiquadFilter');
  g.wah = node('createOscillator');
  g.wahDepth = node('createGain');
  g.cryVol = node('createGain');
  g.duck = node('createGain');
  g.drumBus = node('createGain');
  g.drumVol = node('createGain');
  g.dry = node('createGain');
  g.padBus = node('createGain');
  g.padFilter = node('createBiquadFilter');
  g.padVol = node('createGain');

  g.delay = ctx.createDelay(2);
  g.delayTone = node('createBiquadFilter');
  g.delayFb = node('createGain');
  g.delayIn = node('createGain');
  g.delayCry = node('createGain');
  g.delayDrum = node('createGain');
  g.reverb = node('createConvolver');
  g.reverbCry = node('createGain');
  g.reverbDrum = node('createGain');
  g.reverbOut = node('createGain');

  g.master = node('createGain');
  g.limiter = node('createDynamicsCompressor');
  g.analyser = node('createAnalyser');

  g.cryBus.connect(g.drive);
  g.drive.connect(g.driveOut);
  g.driveOut.connect(g.crush);
  g.crush.connect(g.filter);
  g.filter.connect(g.cryVol);
  g.cryVol.connect(g.duck);
  g.duck.connect(g.dry);
  g.drumBus.connect(g.drumVol);
  // The chord pad shares the cries' sidechain duck and reverb send, so a kick
  // pumps it and it sits in the same room — but it skips the filter/crush chain,
  // which exists to mangle cries and would turn a soft triad into noise.
  g.padFilter.type = 'lowpass';
  g.padFilter.frequency.value = 1500;
  g.padFilter.Q.value = 0.5;
  g.padBus.connect(g.padFilter);
  g.padFilter.connect(g.padVol);
  g.padVol.connect(g.duck);
  g.drumVol.connect(g.dry);
  g.dry.connect(g.master);

  g.wah.frequency.value = 0;
  g.wahDepth.gain.value = 0;
  g.wah.connect(g.wahDepth);
  g.wahDepth.connect(g.filter.frequency);
  g.wah.start();

  g.cryVol.connect(g.delayCry);
  g.drumVol.connect(g.delayDrum);
  g.delayCry.connect(g.delayIn);
  g.delayDrum.connect(g.delayIn);
  g.delayIn.connect(g.delay);
  g.delay.connect(g.delayTone);
  g.delayTone.connect(g.delayFb);
  g.delayFb.connect(g.delay);
  g.delayTone.connect(g.master);
  g.delayTone.frequency.value = 3800;

  g.cryVol.connect(g.reverbCry);
  g.padVol.connect(g.reverbCry);
  g.drumVol.connect(g.reverbDrum);
  g.reverbCry.connect(g.reverb);
  g.reverbDrum.connect(g.reverb);
  g.reverb.connect(g.reverbOut);
  g.reverbOut.connect(g.master);
  g.reverbOut.gain.value = 0.9;

  g.limiter.threshold.value = -8;
  g.limiter.knee.value = 8;
  g.limiter.ratio.value = 10;
  g.limiter.attack.value = 0.003;
  g.limiter.release.value = 0.18;
  g.master.connect(g.limiter);
  g.limiter.connect(g.analyser);
  g.analyser.connect(ctx.destination);
  g.analyser.fftSize = 256;
  g.analyser.smoothingTimeConstant = 0.75;

  let irSize = 0;

  /** Push the pattern's fx object onto the nodes. `immediate` is for offline
   *  rendering, where a 20 ms ramp from the default would be audible at t = 0. */
  g.apply = (fx, bpm, immediate = false) => {
    const t = ctx.currentTime;
    const set = (param, v) => {
      if (immediate) param.value = v;
      else param.setTargetAtTime(v, t, 0.02);
    };
    set(g.cryVol.gain, fx.cryVol);
    set(g.drumVol.gain, fx.drumVol);
    set(g.padVol.gain, fx.padVol * 0.5);
    set(g.master.gain, fx.master);
    const crv = driveCurve(fx.drive);
    if (g.drive.curve !== crv && (crv || g.drive.curve)) g.drive.curve = crv;
    // tanh saturation is a LOUDNESS control as much as a tone one: a cry peaks
    // near 0.4, so drive 0.8 pushed it into the shaper's flat part and measured
    // +11 dB RMS. The make-up gain keeps the slider about timbre, not volume.
    set(g.driveOut.gain, 1 / (1 + fx.drive * 2.5));
    g.crush.curve = crushCurve(fx.crush);

    g.filter.type = fx.filterType;
    set(g.filter.frequency, fx.cutoff);
    set(g.filter.Q, fx.reso);
    set(g.wah.frequency, fx.wahRate);
    // Depth is a fraction of the cutoff, capped so the sweep never reaches 0 Hz.
    set(g.wahDepth.gain, fx.wahRate > 0 ? fx.wahDepth * fx.cutoff * 0.8 : 0);

    const stepDur = 60 / bpm / 4;
    set(g.delay.delayTime, clamp(DELAY_STEPS[Math.round(fx.delayDiv)] * stepDur, 0.01, 1.9));
    set(g.delayFb.gain, fx.delayFb);
    set(g.delayCry.gain, fx.delayCry);
    set(g.delayDrum.gain, fx.delayDrum);
    set(g.reverbCry.gain, fx.reverbCry);
    set(g.reverbDrum.gain, fx.reverbDrum);
    if (Math.abs(fx.reverbSize - irSize) > 0.05) {
      irSize = fx.reverbSize;
      g.reverb.buffer = makeImpulse(ctx, fx.reverbSize);
    }
  };

  g.duckAt = (when, amount, seconds = 0.2) => {
    if (amount <= 0.001) return;
    g.duck.gain.setValueAtTime(1 - amount, when);
    g.duck.gain.linearRampToValueAtTime(1, when + seconds);
  };

  return g;
}

/* ------------------------------------------------------------------ drums */

/** Resolve a Strudel `samples()` source to a fetchable URL. `github:user/repo`
 *  and `github:user/repo/branch` are Strudel's shorthand for the repo's
 *  `strudel.json` on raw.githubusercontent.com (branch defaults to `main`). */
export function resolveManifestUrl(src) {
  const s = String(src).trim();
  const m = /^github:([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(s);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3] || 'main'}/strudel.json`;
  if (/^https?:\/\/[^?#]*\/$/.test(s)) return `${s}strudel.json`;
  return s;
}

/**
 * A Strudel sample map plus the buffers decoded from it.
 *
 * The format is `strudel.json`: `{ "_base": "<dir url>", "bd": ["bd/a.wav", ...],
 * "sd": "sd/b.wav", "RolandTR808_bd": [...] }` — a name maps to one file, a list
 * of files (picked with `bd:3`, wrapping), or an object keyed by note. Reading it
 * here, rather than inventing a manifest, is the point: the files the reader
 * already has for strudel.cc work unchanged.
 */
export class DrumKit {
  constructor() {
    this.map = new Map(); // key → string[] of absolute URLs
    this.buffers = new Map(); // url → AudioBuffer | null (null = failed)
    this.inflight = new Map(); // url → Promise, shared by concurrent callers
    this.custom = new Map(); // lane name → AudioBuffer (dropped files, this session)
    this.source = '';
    this.error = null;
  }

  async load(src) {
    this.source = src;
    this.error = null;
    this.map.clear();
    const url = new URL(resolveManifestUrl(src), document.baseURI);
    let json;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) {
      this.error = e;
      return 0;
    }
    // `_base` may be absolute, or relative to the PAGE (like every other asset
    // path on this site); with no `_base` the files sit beside the manifest.
    const base = typeof json._base === 'string' && json._base
      ? new URL(json._base.endsWith('/') ? json._base : `${json._base}/`, document.baseURI)
      : new URL('./', url);
    for (const [key, value] of Object.entries(json)) {
      if (key.startsWith('_')) continue;
      const files = typeof value === 'string' ? [value]
        : Array.isArray(value) ? value
          : value && typeof value === 'object' ? Object.values(value) : [];
      const urls = files.filter((f) => typeof f === 'string').map((f) => new URL(f, base).href);
      if (urls.length) this.map.set(key, urls);
    }
    return this.map.size;
  }

  /** Bank prefixes present in the map: `RolandTR808_bd` → `RolandTR808`. */
  banks() {
    const out = new Set();
    for (const key of this.map.keys()) {
      const m = /^(.+)_(?:bd|sd|hh|oh|cp|rim|lt|mt|ht|cr|rd)$/.exec(key);
      if (m) out.add(m[1]);
    }
    return [...out].sort();
  }

  keyFor(name, bank) {
    if (bank && this.map.has(`${bank}_${name}`)) return `${bank}_${name}`;
    return this.map.has(name) ? name : null;
  }

  urlFor(name, bank, n) {
    const key = this.keyFor(name, bank);
    if (!key) return null;
    const list = this.map.get(key);
    return list[((n % list.length) + list.length) % list.length];
  }

  /** Fetch + decode one sample. Never rejects; a failure is remembered as null
   *  so a missing file costs one request, not one per scheduled hit. */
  async ensure(name, bank, n) {
    const url = this.urlFor(name, bank, n);
    if (!url) return null;
    if (this.buffers.has(url)) return this.buffers.get(url);
    // The IN-FLIGHT promise is what is shared, not a placeholder: the pattern's
    // own prepare and a click-to-hear ask for the same file within a few ms of
    // each other, and a placeholder made the second caller proceed with `null`
    // and fall back to the synth drum while the real sample was still decoding.
    let pending = this.inflight.get(url);
    if (!pending) {
      // An OfflineAudioContext decodes without a user gesture and is not tied to
      // the playing context, so samples can be fetched before the first click.
      const decoder = new OfflineAudioContext(1, 1, 44100);
      pending = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((b) => decoder.decodeAudioData(b))
        .catch(() => null)
        .then((buffer) => { this.buffers.set(url, buffer); this.inflight.delete(url); return buffer; });
      this.inflight.set(url, pending);
    }
    return pending;
  }

  get(name, bank, n) {
    const custom = this.custom.get(name);
    if (custom) return custom;
    const url = this.urlFor(name, bank, n);
    return url ? this.buffers.get(url) || null : null;
  }

  async setCustom(name, arrayBuffer) {
    const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(arrayBuffer);
    this.custom.set(name, buffer);
    return buffer;
  }
}

/** The built-in drum voices. Every one is a few oscillators and a burst of noise,
 *  so the page makes a complete beat before any Strudel sample is installed. */
export function synthDrum(ctx, dest, name, when, vel, variant = 0) {
  const g = ctx.createGain();
  g.connect(dest);
  const v = VEL_GAIN[vel] || 0.78;
  const tune = 1 + (variant % 5) * 0.06; // `bd:1`, `bd:2`… still mean something
  const noise = (dur, type, freq, q = 0.7) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    s.connect(f);
    s.start(when, Math.random() * 0.5, dur + 0.02);
    return f;
  };
  const osc = (type, f0, f1, dur) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    o.start(when);
    o.stop(when + dur + 0.05);
    return o;
  };
  const env = (peak, dur, attack = 0.002) => {
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak * v, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  };

  switch (name) {
    case 'bd': {
      env(1.1, 0.42);
      osc('sine', 165 * tune, 46, 0.14).connect(g);
      const click = ctx.createGain();
      click.gain.setValueAtTime(0.35 * v, when);
      click.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
      click.connect(g);
      noise(0.02, 'lowpass', 2600).connect(click);
      break;
    }
    case 'sd': {
      env(0.8, 0.22);
      osc('triangle', 210 * tune, 150, 0.1).connect(g);
      noise(0.2, 'bandpass', 2400 * tune, 0.5).connect(g);
      break;
    }
    case 'cp': {
      g.gain.setValueAtTime(0.0001, when);
      for (const [off, peak] of [[0, 0.7], [0.012, 0.6], [0.026, 0.55], [0.042, 0.9]]) {
        g.gain.linearRampToValueAtTime(peak * v, when + off + 0.002);
        g.gain.exponentialRampToValueAtTime(0.05 * v, when + off + 0.011);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
      noise(0.22, 'bandpass', 1500 * tune, 1.2).connect(g);
      break;
    }
    case 'hh':
      env(0.55, 0.05 + (variant % 3) * 0.012, 0.001);
      noise(0.08, 'highpass', 7600).connect(g);
      break;
    case 'oh':
      env(0.5, 0.3 + (variant % 3) * 0.05, 0.001);
      noise(0.42, 'highpass', 6800).connect(g);
      break;
    case 'rim':
      env(0.7, 0.05, 0.001);
      osc('square', 900 * tune, 780, 0.04).connect(g);
      noise(0.03, 'highpass', 4000).connect(g);
      break;
    case 'lt':
    case 'mt':
    case 'ht': {
      const base = { lt: 100, mt: 150, ht: 220 }[name] * tune;
      env(0.9, 0.3);
      osc('sine', base * 1.5, base, 0.18).connect(g);
      break;
    }
    default:
      g.disconnect();
  }
}

/* ------------------------------------------------------------- scheduling */

/** Play one cry note. `env.cries` is a Map id → analysed entry (see `prepare`). */
export function scheduleCry(env, note, when, stepDur) {
  const entry = env.cries.get(note.id);
  if (!entry) return null;
  const { ctx, pattern } = env;
  const midi = rowToMidi(pattern, note.row, note.step);
  const target = midiToHz(midi);
  const rate = clamp(
    pattern.tune === 'raw' ? 2 ** ((midi - 60) / 12) : target / (entry.hz || FALLBACK_F0),
    RATE_MIN,
    RATE_MAX,
  );

  const src = ctx.createBufferSource();
  src.buffer = entry.buffer;
  src.playbackRate.value = rate;
  const amp = ctx.createGain();
  const level = VEL_GAIN[note.vel] * entry.gain * 1.1;
  const avail = (entry.buffer.duration - entry.onset) / rate;
  const held = note.len * stepDur;
  const play = pattern.gate === 'free' ? avail : Math.min(avail, held);
  const release = Math.min(0.04, play * 0.5);

  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(level, when + 0.003);
  if (play < avail) {
    amp.gain.setValueAtTime(level, when + play - release);
    amp.gain.linearRampToValueAtTime(0, when + play);
  }
  src.connect(amp);
  amp.connect(env.graph.cryBus);
  src.start(when, entry.onset);
  src.stop(when + play + 0.02);
  src.onended = () => { src.disconnect(); amp.disconnect(); };

  if (env.voices) {
    const now = ctx.currentTime;
    env.voices = env.voices.filter((v) => v.end > now);
    env.voices.push({ src, amp, end: when + play });
    while (env.voices.length > MAX_VOICES) {
      const old = env.voices.shift();
      old.amp.gain.cancelScheduledValues(now);
      old.amp.gain.setTargetAtTime(0, now, 0.01);
      try { old.src.stop(now + 0.06); } catch { /* already stopped */ }
    }
  }
  return { rate, play };
}

/** One chord of the pad: a soft detuned triangle triad that swells in and releases
 *  into the next chord. Three notes, two oscillators each, a few cents apart —
 *  enough width to read as a pad without a chorus node. */
export function schedulePad(env, chordIndex, when, seconds) {
  const { ctx, pattern, graph } = env;
  const amp = ctx.createGain();
  const attack = Math.min(0.12, seconds * 0.3);
  const release = Math.min(0.35, seconds * 0.5);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.9, when + attack);
  amp.gain.setValueAtTime(0.9, when + seconds - release);
  amp.gain.linearRampToValueAtTime(0, when + seconds + 0.02);
  amp.connect(graph.padBus);
  const stop = when + seconds + 0.08;
  let last = null;
  for (const midi of chordTones(pattern, chordIndex)) {
    for (const cents of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToHz(midi);
      o.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(amp);
      o.start(when);
      o.stop(stop);
      o.onended = () => { o.disconnect(); g.disconnect(); };
      last = o;
    }
  }
  // The pad's own gain node outlives its oscillators; let go of it with the last.
  last.addEventListener('ended', () => amp.disconnect());
}

export function scheduleDrum(env, lane, vel, when) {
  const { ctx, kit, pattern } = env;
  const sample = kit.get(lane.name, pattern.bank, lane.n);
  if (sample) {
    const src = ctx.createBufferSource();
    src.buffer = sample;
    const amp = ctx.createGain();
    amp.gain.value = VEL_GAIN[vel] * 0.9;
    src.connect(amp);
    amp.connect(env.graph.drumBus);
    src.start(when);
    src.onended = () => { src.disconnect(); amp.disconnect(); };
  } else {
    synthDrum(ctx, env.graph.drumBus, lane.name, when, vel, lane.n);
  }
}

/** Everything that starts on one step. Shared by the live timer and the offline
 *  renderer; `env.vis`, when present, collects what the canvas should flash. */
export function scheduleStep(env, step, when) {
  const { pattern, graph } = env;
  const stepDur = 60 / pattern.bpm / 4;
  if (step % CHORD_STEPS === 0 && pattern.fx.padVol > 0.001) {
    schedulePad(env, Math.floor(step / CHORD_STEPS), when, CHORD_STEPS * stepDur);
    env.vis?.push({ time: when, kind: 'chord', index: Math.floor(step / CHORD_STEPS) });
  }
  for (const note of pattern.notes) {
    if (note.step !== step) continue;
    scheduleCry(env, note, when, stepDur);
    env.vis?.push({ time: when, kind: 'cry', note });
  }
  for (let l = 0; l < pattern.drums.length; l++) {
    const lane = pattern.drums[l];
    const vel = Number(lane.steps[step] || 0);
    if (!vel || lane.mute) continue;
    scheduleDrum(env, lane, vel, when);
    if (lane.name === 'bd') graph.duckAt(when, pattern.fx.duck);
    env.vis?.push({ time: when, kind: 'drum', lane: l, step });
  }
}

/* -------------------------------------------------------------- the engine */

export class SeqEngine {
  constructor(pattern) {
    this.pattern = pattern;
    this.ctx = null;
    this.graph = null;
    this.kit = new DrumKit();
    this.cries = new Map(); // id → { buffer, hz, confidence, onset, gain }
    this.failed = new Set();
    this.playing = false;
    this.env = null;
    this._timer = null;
    this._step = 0;
    this._next = 0;
    this._log = [];
    this.vis = [];
  }

  /** Create + resume the context. MUST be called from inside a user gesture the
   *  first time; every later call finds it running and returns at once. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.graph = createGraph(this.ctx);
      this.env = { ctx: this.ctx, graph: this.graph, cries: this.cries, kit: this.kit, pattern: this.pattern, voices: [], vis: this.vis };
      this.applyFx(true);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  setPattern(p) {
    this.pattern = p;
    if (this.env) this.env.pattern = p;
    this.applyFx();
  }

  applyFx(immediate = false) {
    if (this.graph) this.graph.apply(this.pattern.fx, this.pattern.bpm, immediate);
  }

  /** Decode + analyse a cry. Resolves to its entry, or null if the file is
   *  missing — the failure is remembered so a bad id is asked about once. */
  async prepare(id) {
    if (this.cries.has(id)) return this.cries.get(id);
    if (this.failed.has(id)) return null;
    const { buffer } = await cryPlayer.decoded(id);
    if (!buffer) { this.failed.add(id); return null; }
    const entry = { buffer, ...analyseCry(buffer) };
    this.cries.set(id, entry);
    return entry;
  }

  prepareDrums() {
    const p = this.pattern;
    return Promise.all(p.drums.filter((l) => /[1-3]/.test(l.steps)).map((l) => this.kit.ensure(l.name, p.bank, l.n)));
  }

  /** Play a single note right now — the click-to-hear on every placement. */
  async audition(id, row, len = 2, step = 0) {
    await this.unlock();
    const entry = await this.prepare(id);
    if (!entry) return false;
    const stepDur = 60 / this.pattern.bpm / 4;
    scheduleCry(this.env, { id, row, len, vel: 2, step }, this.ctx.currentTime + 0.01, stepDur);
    return true;
  }

  /** Hear one chord of the progression, as its pad would play it. */
  async auditionChord(index) {
    await this.unlock();
    const stepDur = 60 / this.pattern.bpm / 4;
    schedulePad(this.env, index, this.ctx.currentTime + 0.01, Math.min(1.2, CHORD_STEPS * stepDur));
  }

  async auditionDrum(laneIndex) {
    await this.unlock();
    const lane = this.pattern.drums[laneIndex];
    await this.kit.ensure(lane.name, this.pattern.bank, lane.n);
    scheduleDrum(this.env, lane, 2, this.ctx.currentTime + 0.01);
  }

  async start() {
    await this.unlock();
    await Promise.all([
      this.prepareDrums(),
      ...[...new Set(this.pattern.notes.map((n) => n.id))].map((id) => this.prepare(id)),
    ]);
    if (this.playing) return;
    this.playing = true;
    this._step = 0;
    this._next = this.ctx.currentTime + 0.06;
    this._log = [];
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }

  stop() {
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
    this._log = [];
    // Let ringing voices finish: stopping a transport is not a panic button, and
    // a reverb tail cut dead sounds like a bug.
  }

  _tick() {
    const p = this.pattern;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    const stepDur = 60 / p.bpm / 4;
    while (this._next < horizon) {
      const step = this._step % p.steps;
      // Odd steps land late by `swing` of a step; the grid itself does not move.
      const when = this._next + (step % 2 === 1 ? p.swing * stepDur : 0);
      scheduleStep(this.env, step, when);
      this._log.push({ step, time: this._next, dur: stepDur });
      this._next += stepDur;
      this._step = step + 1;
    }
    const cutoff = this.ctx.currentTime - 1;
    while (this._log.length > 2 && this._log[0].time < cutoff) this._log.shift();
  }

  /** Playhead as a fractional step, or -1 when stopped. Read from the audio
   *  clock, so it stays correct if the main thread hiccups. */
  position() {
    if (!this.playing || !this.ctx) return -1;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    let hit = null;
    for (const e of this._log) { if (e.time <= now) hit = e; else break; }
    if (!hit) return -1;
    return hit.step + clamp((now - hit.time) / hit.dur, 0, 1);
  }

  /** Visual events whose audio time has arrived. */
  drain() {
    if (!this.ctx || !this.vis.length) return [];
    const now = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    const due = [];
    const rest = [];
    for (const v of this.vis) (v.time <= now ? due : rest).push(v);
    this.vis.length = 0;
    this.vis.push(...rest);
    return due;
  }

  /** Magnitude 0..1 across the spectrum, or null before the first unlock. */
  spectrum(out) {
    if (!this.graph) return false;
    this.graph.analyser.getByteFrequencyData(out);
    return true;
  }

  /** Render `loops` passes of the pattern to a 16-bit stereo WAV Blob. */
  async renderWav(loops = 1) {
    await this.unlock();
    const p = this.pattern;
    await Promise.all([
      this.prepareDrums(),
      ...[...new Set(p.notes.map((n) => n.id))].map((id) => this.prepare(id)),
    ]);
    const sr = 44100;
    const stepDur = 60 / p.bpm / 4;
    const loopSec = p.steps * stepDur;
    const tail = 2 + p.fx.reverbSize * Math.max(p.fx.reverbCry, p.fx.reverbDrum);
    const off = new OfflineAudioContext(2, Math.ceil((loopSec * loops + tail) * sr), sr);
    const graph = createGraph(off);
    graph.apply(p.fx, p.bpm, true);
    const env = { ctx: off, graph, cries: this.cries, kit: this.kit, pattern: p, voices: null, vis: null };
    for (let l = 0; l < loops; l++) {
      for (let s = 0; s < p.steps; s++) {
        const when = 0.05 + (l * p.steps + s) * stepDur + (s % 2 === 1 ? p.swing * stepDur : 0);
        scheduleStep(env, s, when);
      }
    }
    const rendered = await off.startRendering();
    return { blob: encodeWav(rendered), buffer: rendered };
  }
}

/** 16-bit PCM WAV, interleaved. */
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const bytes = new ArrayBuffer(44 + len * ch * 2);
  const v = new DataView(bytes);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      v.setInt16(o, Math.round(clamp(data[c][i], -1, 1) * 32767), true);
      o += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export { FX_RANGES };
