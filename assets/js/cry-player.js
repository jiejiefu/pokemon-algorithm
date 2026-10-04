/**
 * Cry playback — one Web Audio engine for every page that plays a Pokémon cry.
 *
 * Why Web Audio rather than an `<audio>` element
 * ---------------------------------------------
 * `detail.html` used `new Audio(url)`, which meant four separate problems in one
 * eight-line function: the `.catch()` could not tell a 404 from a blocked
 * autoplay, there was no duration to draw a waveform against, playback rate
 * needed a second `<audio>`, and stopping meant calling `pause()` on an element
 * whose state the page had to mirror by hand.
 *
 * Web Audio fixes all four because the buffer is decoded once and kept:
 * `decodeAudioData` rejects with a real reason, `buffer.duration` is the number a
 * spectrogram needs, `playbackRate` is a property, and `stop()` is exact.
 *
 * The cost is that autoplay policy applies to the *context*, not the element.
 * `unlock()` must be called from inside a user gesture, so `play()` calls it
 * itself — on the very first invocation that call is still inside the gesture
 * that triggered it, and every later one finds the context already running. That
 * is why `play()` is written to await `unlock()` before anything else rather
 * than having callers remember to prime it.
 *
 * Four things this file has to know about the audio on disk
 * --------------------------------------------------------
 * Measured against this site's own HTTP server in headless Chrome 154; all of it
 * is reproduced by `scripts/extract_cry_index.py`, which is where the file-level
 * facts come from.
 *
 * 1. The `.ogg` extension is wrong for 93 files. 92 are MPEG Layer III and one is
 *    PCM WAV, three of them roster species (25, 808, 809). Browsers sniff the
 *    container rather than trusting the served `Content-Type: audio/ogg`, and
 *    every one of them fetches, decodes and plays as-is — so nothing here cares
 *    what the extension says, and nothing was renamed.
 *
 * 2. `canPlayType` cannot answer "can this browser play the cries". Chrome
 *    answers `""` for `audio/ogg; codecs="mp3"` while `latest/25.ogg` plays
 *    without complaint, because it is an MP3. So the only honest probe is to
 *    decode a file, which is what `probeSupport()` does — it decodes species 1
 *    (a genuine Ogg Vorbis) once and reports what actually happened. The answer
 *    matters: Safari before 18.4 cannot decode Ogg Vorbis at all, and the
 *    difference between "this browser cannot" and "this file is broken" decides
 *    which of two very different messages the reader sees.
 *
 * 3. `decodeAudioData` resamples to the context rate. Sources here run from
 *    10.5 kHz to 48 kHz and every one of them comes back at `ctx.sampleRate` —
 *    48 kHz on a desktop. So no pitch or spectrum code may read
 *    `ctx.sampleRate`; it has to read `buffer.sampleRate`, which for a buffer
 *    obtained this way is the *device* rate and tells you nothing about the
 *    source either. Anything that needs the true source rate has to come from
 *    `cry_features.json`, built offline with libsndfile.
 *
 * 4. Decoded peaks exceed 1.0. `latest/25.ogg` measures 1.0391 after decode,
 *    because MP3 decoding overshoots. `AudioBufferSourceNode` clips that without
 *    complaint, so playback is unaffected — but any code that maps samples onto
 *    a ±1 canvas range will draw outside it. `waveformPeaks()` clamps.
 *
 * Paths
 * -----
 * `cryUrl()` returns a root-relative path, the same convention
 * `sv-index.js` uses for `<img src>`. It resolves identically here, because
 * `fetch()` and `<img src>` both resolve a relative URL against the document
 * base — so the cries inherit whatever base-path behaviour the Scarlet/Violet
 * artwork already has, rather than introducing a second convention.
 *
 * Usage
 * -----
 *     import { cryPlayer } from './assets/js/cry-player.js';
 *     cryPlayer.play(p.id).then(...).catch(...);   // resolves when it finishes
 *     await cryPlayer.probeSupport();             // once, to decide what to say
 */

import { cryUrl, hasCry, hasLegacyCry } from './cry-index.js';

const PREFS_KEY = 'pokemon-algorithm:cry-volume';

/** Species decoded by `probeSupport()`. Bulbasaur: real Ogg Vorbis, 939 ms, and
 *  short enough that probing it costs nothing. */
const PROBE_ID = 1;

/** Seconds of gain ramp on stop. A cry is a plucked square-ish tone; cutting it
 *  dead produces an audible click, and this costs four lines. */
const STOP_RAMP = 0.012;

/** Read a stored preference without letting a private-mode `localStorage` throw
 *  during module evaluation, which would take the whole page down. */
function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      volume: typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : 1,
      muted: raw.muted === true,
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

export class CriesPlayer {
  #ctx = null;
  #gain = null;
  #volume = 1;
  #muted = false;
  #unlockPromise = null;
  #current = null;
  #stopped = null;

  /**
   * Decoded buffers, keyed by `${legacy ? 'legacy' : 'latest'}:${id}`.
   *
   * Entries are `{ buffer }` or `{ error }` — never a bare promise, and never a
   * rejected one. Both halves matter: a bare promise re-decodes on every miss
   * because nothing survives the throw, and a *rejected* promise that nobody
   * awaits before the microtask queue drains reports an unhandled rejection for
   * a failure the caller is already handling. Resolving into a result object
   * caches the failure — one network attempt per missing file, ever — and cannot
   * produce a warning.
   */
  #cache = new Map();

  /** Last resolved support probe, so asking twice does not decode twice. */
  #support = null;

  constructor() {
    const prefs = readPrefs();
    this.#volume = prefs.volume;
    this.#muted = prefs.muted;
  }

  /** Whether a cry exists for this id in the requested set. */
  has(id, { legacy = false } = {}) {
    return legacy ? hasLegacyCry(id) : hasCry(id);
  }

  get volume() { return this.#volume; }
  set volume(v) {
    this.#volume = Math.min(1, Math.max(0, Number(v) || 0));
    this.#applyGain();
    this.#save();
  }

  get muted() { return this.#muted; }
  set muted(m) {
    this.#muted = !!m;
    this.#applyGain();
    this.#save();
  }

  /** Whether something is sounding right now. */
  get playing() { return this.#current !== null; }

  /**
   * Create or resume the AudioContext. Safe to call repeatedly; must be reachable
   * from inside a user gesture on the first call, which `play()` arranges by
   * calling it before any `await`.
   */
  async unlock() {
    if (!this.#ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio is unavailable in this browser');
      this.#ctx = new Ctor();
      this.#gain = this.#ctx.createGain();
      this.#gain.connect(this.#ctx.destination);
      this.#applyGain();
    }
    if (this.#ctx.state === 'suspended') await this.#ctx.resume();
    return this.#ctx;
  }

  /**
   * Can this browser actually decode a cry? Decodes one real file and says what
   * happened, because `canPlayType` lies about this site specifically (see the
   * file docblock) and "no Ogg support" and "this file is corrupt" are different
   * messages for the reader.
   *
   * Resolves to `{ supported, reason }` and never rejects — a browser that
   * cannot play cries is a supported state of this page, not an error in it.
   */
  async probeSupport() {
    if (this.#support) return this.#support;
    try {
      await this.unlock();
      const result = await this.#load(PROBE_ID, { legacy: false });
      this.#support = result.error
        ? { supported: false, reason: 'decode-failed' }
        : { supported: true, reason: null };
    } catch (e) {
      // No Web Audio at all, or the context could not be created.
      this.#support = { supported: false, reason: 'no-web-audio' };
    }
    return this.#support;
  }

  /**
   * Play a species' cry. Resolves when it finishes playing; rejects if it could
   * not start, with a `reason` property that says which of the ways it failed.
   *
   * `rate` is a playback rate, so `0.5` is half speed and an octave down — which
   * is how the sorting race makes a list audible, and how the cry browser lets a
   * reader hear a similarity match as a transposition.
   */
  async play(id, { legacy = false, rate = 1, volume } = {}) {
    if (!this.has(id, { legacy })) {
      throw Object.assign(new Error(`no ${legacy ? 'legacy' : 'latest'} cry for id ${id}`),
        { reason: 'missing' });
    }
    // Before the first await, so this still runs inside the click that started it.
    await this.unlock();
    await this.stop();

    const { buffer, error } = await this.#load(id, { legacy });
    if (error) {
      throw Object.assign(new Error(`cry ${id} could not be decoded: ${error.message || error}`),
        { reason: 'decode-failed' });
    }

    const ctx = this.#ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    const out = ctx.createGain();
    // Per-call volume sits on its own node rather than on the shared one, so
    // raising a single cry does not change the site-wide level underneath it.
    out.gain.value = volume !== undefined ? volume : 1;
    source.connect(out);
    out.connect(this.#gain);

    const settled = new Promise((resolve, reject) => {
      source.onended = () => resolve({ id, duration: buffer.duration, rate });
      source.onerror = () => reject(Object.assign(
        new Error(`cry ${id} failed during playback`), { reason: 'playback-failed' }));
    });
    source.start();

    this.#current = { source, out, id, legacy, rate };
    return settled;
  }

  /**
   * Stop whatever is sounding, ramping the gain first so it does not click.
   * Resolves once it is actually silent, so a caller that immediately plays
   * something else — a fast sort, a next-track button — does not overlap them.
   */
  stop() {
    const cur = this.#current;
    if (!cur) return Promise.resolve();
    this.#current = null;
    // Snapshot the promise so two rapid stops resolve the same wait rather than
    // the second finding `#current` already cleared.
    if (!this.#stopped) {
      const ctx = this.#ctx;
      const t = ctx.currentTime;
      try {
        cur.out.gain.cancelScheduledValues(t);
        cur.out.gain.setValueAtTime(cur.out.gain.value, t);
        cur.out.gain.linearRampToValueAtTime(0, t + STOP_RAMP);
        cur.source.stop(t + STOP_RAMP);
      } catch {
        // Already stopped, or the context closed underneath us; nothing to ramp.
        try { cur.source.stop(); } catch { /* already ended */ }
      }
      this.#stopped = new Promise((resolve) => {
        cur.source.onended = () => resolve();
        // A source that had already ended will not fire onended again, so settle
        // on the next macrotask too rather than leaving a caller awaiting forever.
        setTimeout(resolve, STOP_RAMP * 1000 + 40);
      }).then(() => { this.#stopped = null; });
    }
    return this.#stopped;
  }

  /**
   * Decoded waveform envelope, for drawing.
   *
   * Returns `count` peaks in -1..1, each the maximum absolute sample across its
   * slice. Clamps, because decoded peaks exceed 1.0 (see the file docblock) and
   * an unclamped canvas would draw past its own bounds.
   */
  async waveformPeaks(id, { legacy = false, count = 256 } = {}) {
    await this.unlock();
    const { buffer, error } = await this.#load(id, { legacy });
    if (error) throw Object.assign(new Error(`cry ${id} could not be decoded`), { reason: 'decode-failed' });
    const data = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / count));
    const peaks = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let peak = 0;
      const end = Math.min(data.length, (i + 1) * per);
      for (let j = i * per; j < end; j++) {
        const v = Math.abs(data[j]);
        if (v > peak) peak = v;
      }
      peaks[i] = Math.min(1, peak);
    }
    return peaks;
  }

  /** Decode a cry, or return the cached result. Never rejects. */
  #load(id, { legacy }) {
    const key = `${legacy ? 'legacy' : 'latest'}:${id}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      entry = fetch(cryUrl(id, { legacy }))
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((bytes) => this.unlock().then((ctx) => ctx.decodeAudioData(bytes)))
        .then((buffer) => ({ buffer, error: null }),
               (error) => ({ buffer: null, error }));
      this.#cache.set(key, entry);
    }
    return entry;
  }

  #applyGain() {
    if (!this.#gain) return;
    const level = this.#muted ? 0 : this.#volume;
    const t = this.#ctx.currentTime;
    // Ramp rather than assign: clicking the mute button mid-cry otherwise pops.
    this.#gain.gain.cancelScheduledValues(t);
    this.#gain.gain.setValueAtTime(this.#gain.gain.value, t);
    this.#gain.gain.linearRampToValueAtTime(level, t + STOP_RAMP);
  }

  #save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ volume: this.#volume, muted: this.#muted }));
    } catch {
      // Storage unavailable (private mode, quota). The level still applies for
      // this page view; it just will not be remembered.
    }
  }
}

/** Shared instance. Every cry surface on the site wants the same buffer cache,
 *  the same volume, and the ability to cut in on whatever else is sounding. */
export const cryPlayer = new CriesPlayer();
