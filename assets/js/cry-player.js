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

/**
 * The default playback level, and it is a fifth of full scale rather than unity.
 *
 * A recorded cry is a plucked square-ish tone with a wide dynamic range, and at
 * unity these two pages are genuinely startling — pressing play twenty times in a
 * row to compare Pokémon is not a thing anyone wants to do at full scale. It is
 * `3 / 15` because that is the master volume the Generation I lab presents as its
 * default, so the synthesised cry and the recorded one are played at the same
 * loudness and the two pages can be compared without one of them being louder for
 * reasons that have nothing to do with the Pokémon.
 *
 * It lives here rather than in either page because the player owns the output gain:
 * a page-level trim would have to be repeated, and one of the two pages would
 * eventually be missed. The per-call `volume` argument in play() is a separate
 * per-play trim and still defaults to 1, so this multiplies into it rather than
 * replacing it.
 */
export const DEFAULT_VOLUME = 3 / 15;

/** Seconds of gain ramp on stop. A cry is a plucked square-ish tone; cutting it
 *  dead produces an audible click, and this costs four lines. */
const STOP_RAMP = 0.012;

/** Read a stored preference without letting a private-mode `localStorage` throw
 *  during module evaluation, which would take the whole page down. */
function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      volume: typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULT_VOLUME,
      muted: raw.muted === true,
    };
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false };
  }
}

export class CriesPlayer {
  #ctx = null;
  #gain = null;
  #volume = DEFAULT_VOLUME;
  /** A mute the READER chose, and the only kind that is written to storage. */
  #storedMuted = false;
  /** A mute a PAGE decided for itself. Memory only — see `muteForView()`. */
  #viewMuted = false;
  #unlockPromise = null;
  #current = null;
  #stopped = null;
  /**
   * Spectrum tap, hung off the shared gain node. Created lazily in `unlock()`.
   *
   * It sits AFTER the gain rather than before it, and that placement is the
   * point: a reader who mutes the player sees the live curve go flat, which is a
   * measurement of something true rather than a bug to work around. It also means
   * the curve shows the default 3/15 level, a constant -14 dB on every band,
   * which is a uniform offset the page's own axis absorbs.
   *
   * Nothing downstream of it is audible even when it is running — see the
   * `spectrum()` docblock.
   */
  #analyser = null;
  /** Reused output array for `spectrum()`. Allocated once, never reallocated. */
  #bins = null;
  /** Sources started with `overlap: true` and not yet ended. See `play()`. */
  #overlapping = new Set();

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
    this.#storedMuted = prefs.muted;
  }

  /** The AudioContext's own clock reading, or 0 before playback has unlocked it.
   *
   *  A caller drawing a progress cursor needs the clock at EVERY FRAME, and
   *  `onStart` hands over one reading plus the duration — enough to know when
   *  playback began, not where it is now. The context is private to this class, so
   *  without this the page has to fake the clock with `performance.now()`, which is
   *  a different timebase from the `startedAt` it was given and drifts against it.
   *
   *  It did exactly that, in the shape of a field that was read every frame and
   *  never written: `progress.now` stayed 0, so the ratio was negative, clamped to
   *  zero, and the cursor never left the origin. */
  now() {
    return this.#ctx ? this.#ctx.currentTime : 0;
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

  /* The EFFECTIVE mute, and both fields feed it.
   *
   * This must be the OR of the two rather than either one alone, and each wrong
   * answer fails silently in a direction the reader cannot undo:
   *
   *   #storedMuted only — sorting.html's own default is ignored, so the page that
   *     documented "this is the only page that can fire a sound every few
   *     milliseconds" would be LOUD BY DEFAULT. It is one checkbox away from a
   *     drone and the default is the whole point.
   *   #viewMuted only — an explicit un-mute from an earlier session is ignored, so
   *     cries.html stays silent forever for a reader who turned sound on and
   *     expects it to stay on.
   */
  get muted() { return this.#storedMuted || this.#viewMuted; }
  set muted(m) {
    this.#storedMuted = !!m;
    this.#applyGain();
    this.#save();
  }

  /**
   * Mute for THIS PAGE VIEW, without writing the shared preference.
   *
   * WHY THIS EXISTS, AND IT IS NOT A NICETTY
   *
   * `sorting.html` starts with its cry switch off, on purpose: it is the only
   * page that can fire a sound every few milliseconds, and 1,025 swaps is a lot
   * of noise to arrive at uninvited. It used to express that default as
   * `cryPlayer.muted = true`, and the setter persists — so merely LOADING
   * sorting.html wrote `{muted: true}` into the site-wide `cry-volume` key, and
   * every other page that plays a cry (cries.html, detail.html, spectrum.html)
   * then read it back and went permanently silent. The reader had no way out
   * except to return to sorting.html and tick a checkbox about swap sounds.
   * `cries-gen1.html` was unaffected throughout, because it builds its own
   * AudioContext and keeps its mute in per-lane memory that is never written
   * anywhere.
   *
   * So the distinction is between a PAGE'S DEFAULT and A READER'S CHOICE. Only
   * the second is a preference worth storing: "loudness is a site-wide setting"
   * stays true, and the `muted` setter still persists for the explicit toggle,
   * but a page deciding to be quiet on its own no longer speaks for pages it has
   * not visited yet.
   *
   * Note the gain IS applied — this is not a request to the next page. It is
   * silent for as long as this document is open, and gone on the next load.
   */
  muteForView(m) {
    this.#viewMuted = !!m;
    this.#applyGain();
  }

  /** Whether something is sounding right now. */
  get playing() { return this.#current !== null; }

  /**
   * Create the AudioContext WITHOUT resuming it.
   *
   * Split out from `unlock()` because resuming needs a user gesture and creating
   * does not, and `decodeAudioData` is perfectly happy on a suspended context.
   * Conflating them meant every DECODE required a gesture, which is how
   * `spectrum.html` came to sit on 「計算中…」 forever: `decoded()` reached
   * `#load`, which called `unlock()`, which awaited a `resume()` that no gesture had
   * unblocked — so the page's hero, a pure computation, was gated behind an audio
   * permission the reader may never grant.
   *
   * Nothing else changes. `play()` still awaits `unlock()`, so playback still resumes
   * first and still fails loudly rather than starting suspended.
   */
  #ensureContext() {
    if (!this.#ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio is unavailable in this browser');
      this.#ctx = new Ctor();
      this.#gain = this.#ctx.createGain();
      this.#gain.connect(this.#ctx.destination);
      this.#analyser = this.#ctx.createAnalyser();
      // 2048 rather than 512, and the difference is resolution, not cost. The
      // spectrogram on `spectrum.html` uses a 512-point transform, but this one
      // sees the signal at the DEVICE rate — 48 kHz — where 512 bins is 93.75 Hz
      // apart and the lowest mel band, 50 to about 150 Hz, would be one bin wide.
      // At 2048 the spacing is 23.4 Hz and the 26 mel triangles each get several
      // bins to average over.
      this.#analyser.fftSize = 2048;
      // 0.3, low enough that a note attack is visible as a spike rather than
      // smeared across three frames. The offline spectrogram on the same page
      // smooths over 25 ms; this one over 42.7 ms at 48 kHz, and the page says so
      // rather than implying the two are the same measurement.
      this.#analyser.smoothingTimeConstant = 0.3;
      this.#analyser.minDecibels = -100;
      this.#analyser.maxDecibels = -10;
      this.#gain.connect(this.#analyser);
      this.#bins = new Float32Array(this.#analyser.frequencyBinCount);
      this.#applyGain();
    }
    return this.#ctx;
  }

  /**
   * Create or resume the AudioContext. Safe to call repeatedly; must be reachable
   * from inside a user gesture on the first call, which `play()` arranges by
   * calling it before any `await`.
   */
  async unlock() {
    this.#ensureContext();
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
      /* `#ensureContext`, not `unlock`: asking whether this browser can decode is not
       * a request to make a sound, and a page that probes on load would otherwise sit
       * unresolved on every visit until the reader clicked something. */
      this.#ensureContext();
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
   *
   * `overlap` lets a second cry start WITHOUT cutting the first one off, and is
   * what makes a per-swap sound possible at all. The default is `false`, which
   * keeps the one-at-a-time behaviour every existing caller was written against
   * — on cries.html pressing play while something is sounding should switch to
   * it, not layer on top of it.
   *
   * The reason it is an option here and not a second player module: sorting.html
   * triggers a cry every few milliseconds at speed, and re-pointing one
   * `<audio>` element's `src` that often audibly clicks, while stopping and
   * restarting a BufferSource turns the run into a stutter of 12ms fragments.
   * Two copies of a player would also mean two mute paths and two volume
   * preferences, and they would drift apart invisibly — the failure mode
   * `cry-autoplay.js` is one module precisely to avoid.
   */
  /**
   * `onStart` is called the instant the source starts, with the decoded duration
   * and the context clock reading at that moment.
   *
   * `play()` itself resolves only when the cry ENDS, so a caller has no way to
   * know when playback began or how long it will run until it is already over.
   * That is enough to toggle a button and not enough to draw a progress cursor,
   * which needs both numbers at the moment playback starts rather than at the end.
   * The player owns the AudioContext, so it is also the only place that can read
   * that clock. Callers that pass no callback are unaffected.
   */
  async play(id, { legacy = false, rate = 1, volume, overlap = false, onStart } = {}) {
    if (!this.has(id, { legacy })) {
      throw Object.assign(new Error(`no ${legacy ? 'legacy' : 'latest'} cry for id ${id}`),
        { reason: 'missing' });
    }
    // Before the first await, so this still runs inside the click that started it.
    await this.unlock();
    if (!overlap) await this.stop();

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
    const startedAt = ctx.currentTime;
    source.start();

    /* Named, because the first version of this read `cur` — a name that exists
     * in `stop()` and in NO other scope. It threw a ReferenceError on every
     * `overlap: true` play, which was invisible: sorting.html's caller ends in
     * `.catch(() => {})`, so the cry played, the promise rejected instead of
     * resolving on `ended`, `onStart` never ran, and `#overlapping` stayed
     * empty so `stop()` could not silence what was layered. A swallowed rejection
     * is not the same as no error. */
    const voice = { source, out, id, legacy, rate, startedAt };
    this.#current = voice;
    if (overlap) {
      // Tracked separately so `stop()` can still silence everything. `#current`
      // alone only ever names the most recent, so a page that layered three cries
      // would leave the first two ringing after a stop.
      this.#overlapping.add(voice);
      const forget = () => this.#overlapping.delete(voice);
      source.addEventListener('ended', forget, { once: true });
    }
    if (onStart) onStart({ duration: buffer.duration, startedAt, rate, id });
    return settled;
  }

  /**
   * The decoded `AudioBuffer` for a species, sharing this player's cache.
   *
   * Added for `spectrum.html`, which needs the samples themselves rather than an
   * envelope of them: it runs the mel filterbank over the buffer to draw a
   * spectrogram, and `waveformPeaks()` throws away exactly the information that
   * needs. Going through here rather than fetching and decoding a second time is
   * the whole reason this exists — the alternative is a page holding its own copy
   * of the cache, its own `decodeAudioData` call, and its own copy of the error
   * handling, and the two would drift.
   *
   * Never rejects, matching `#load`: a missing file is `{ buffer: null, error }`,
   * and the failure is cached with it.
   */
  decoded(id, { legacy = false } = {}) {
    return this.#load(id, { legacy });
  }

  /**
   * Play raw mono samples — the Generation I synthesiser's output, from
   * `renderSpeciesCry()`.
   *
   * The reason this exists rather than a second AudioContext on the page: the
   * player owns the clock, and a second context would mean a second clock reading
   * for a playback cursor to be driven from, plus a second gain node for a mute to
   * reach, plus a second place for the spectrum tap to hang off. `spectrum.html`
   * draws recorded and synthesised cries through ONE of these so a reader can put
   * them in the same spectrogram and compare them, which is the entire reason the
   * page exists.
   *
   * It takes SAMPLES rather than an AudioBuffer because 65,536 Hz is the case
   * that matters and it is the allocation that gets refused, not the playback —
   * `cries-gen1.html` has always handled it by allocating at the full rate and
   * falling back to half on a throw, and a method that took a finished buffer
   * would have nowhere to put that fallback. The decimation is reported to the
   * caller because it folds everything above 32.768 kHz back into the band, and
   * the page has to be able to say it happened rather than quietly present a
   * different signal.
   *
   * @param {Float32Array} samples mono, at `sampleRate`
   * @returns {Promise<{duration: number, rate: number, id: any, decimated: boolean}>}
   */
  async playSamples(samples, { sampleRate, id = null, volume, onStart } = {}) {
    // Before the first await, so this still runs inside the click that started it.
    await this.unlock();
    await this.stop();

    const ctx = this.#ctx;
    const source = ctx.createBufferSource();

    let buffer;
    let decimated = false;
    try {
      buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
    } catch {
      decimated = true;
      buffer = ctx.createBuffer(1, samples.length >> 1, sampleRate / 2);
      const dst = new Float32Array(buffer.length);
      for (let i = 0; i < dst.length; i++) dst[i] = samples[i * 2];
      buffer.copyToChannel(dst, 0);
    }
    source.buffer = buffer;

    const out = ctx.createGain();
    out.gain.value = volume !== undefined ? volume : 1;
    source.connect(out);
    out.connect(this.#gain);

    const settled = new Promise((resolve, reject) => {
      source.onended = () => resolve({
        id, duration: buffer.duration, rate: buffer.sampleRate, decimated,
      });
      source.onerror = () => reject(Object.assign(
        new Error(`samples for ${id} failed during playback`), { reason: 'playback-failed' }));
    });
    const startedAt = ctx.currentTime;
    source.start();

    this.#current = { source, out, id, legacy: false, rate: 1, startedAt };
    if (onStart) {
      onStart({
        duration: buffer.duration,
        startedAt,
        rate: buffer.sampleRate,
        id,
        decimated,
      });
    }
    return settled;
  }

  /**
   * The live spectrum, as `frequencyBinCount` dB values from `minDecibels` up.
   *
   * Returns the SAME array on every call, so a caller redrawing at 60 fps
   * allocates nothing; read it before the next frame.
   *
   * It is LINEAR frequency, not mel, and it is measured at the DEVICE rate rather
   * than resampled to 16 kHz. A caller wanting to put it on the same axis as a
   * mel spectrogram has to fold it into mel bands itself, which is an
   * approximation and is not the same measurement as the offline grid. What it is
   * good for is answering "where is the energy right now" frame by frame, which
   * an offline grid cannot do at all.
   *
   * Silent when nothing is playing, and silent when the player is muted — the tap
   * is after the gain. Both CDP checkers replace `AudioContext.destination` with a
   * zero gain, which is DOWNSTREAM of this node, so the mute tap does not silence
   * what is read here and a checker can still assert the analyser is live.
   *
   * @returns {{values: Float32Array, bins: number, binHz: number, rate: number}|null}
   *   null before the context exists
   */
  spectrum() {
    if (!this.#analyser || !this.#bins) return null;
    this.#analyser.getFloatFrequencyData(this.#bins);
    return {
      values: this.#bins,
      bins: this.#bins.length,
      binHz: this.#ctx.sampleRate / this.#analyser.fftSize,
      rate: this.#ctx.sampleRate,
    };
  }

  /**
   * Stop whatever is sounding, ramping the gain first so it does not click.
   * Resolves once it is actually silent, so a caller that immediately plays
   * something else — a fast sort, a next-track button — does not overlap them.
   */
  stop() {
    const cur = this.#current;
    // Everything layered by `overlap: true`, plus the current one. A page using
    // overlap has no single "current" to stop.
    const live = [...this.#overlapping];
    if (cur && !live.includes(cur)) live.unshift(cur);
    if (!live.length) return Promise.resolve();
    this.#current = null;
    this.#overlapping.clear();
    // Snapshot the promise so two rapid stops resolve the same wait rather than
    // the second finding `#current` already cleared.
    if (!this.#stopped) {
      const ctx = this.#ctx;
      const t = ctx.currentTime;
      const waits = [];
      for (const c of live) {
        try {
          c.out.gain.cancelScheduledValues(t);
          c.out.gain.setValueAtTime(c.out.gain.value, t);
          c.out.gain.linearRampToValueAtTime(0, t + STOP_RAMP);
          c.source.stop(t + STOP_RAMP);
        } catch {
          // Already stopped, or the context closed underneath us; nothing to ramp.
          try { c.source.stop(); } catch { /* already ended */ }
        }
        waits.push(new Promise((resolve) => {
          c.source.onended = () => resolve();
          // A source that had already ended will not fire onended again, so settle
          // on the next macrotask too rather than leaving a caller awaiting forever.
          setTimeout(resolve, STOP_RAMP * 1000 + 40);
        }));
      }
      this.#stopped = Promise.all(waits).then(() => { this.#stopped = null; });
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
        /* `#ensureContext`, NOT `unlock`. See its docblock: resuming needs a
         * gesture, and a decode does not. `play()` has already awaited `unlock()`
         * by the time it reaches here, so playback is unaffected and a caller that
         * only wants the samples no longer needs permission to make a sound. */
        .then((bytes) => this.#ensureContext().decodeAudioData(bytes))
        .then((buffer) => ({ buffer, error: null }),
               (error) => ({ buffer: null, error }));
      this.#cache.set(key, entry);
    }
    return entry;
  }

  #applyGain() {
    if (!this.#gain) return;
    // The OR, for the same reason `get muted()` uses it: both fields are a mute
    // the reader experiences, and picking one here would make a page's own
    // default audible or a stored un-mute inaudible, with nothing to report it.
    const level = this.muted ? 0 : this.#volume;
    const t = this.#ctx.currentTime;
    // Ramp rather than assign: clicking the mute button mid-cry otherwise pops.
    this.#gain.gain.cancelScheduledValues(t);
    this.#gain.gain.setValueAtTime(this.#gain.gain.value, t);
    this.#gain.gain.linearRampToValueAtTime(level, t + STOP_RAMP);
  }

  /* Writes the READER's preferences, and only those.
   *
   * `#storedMuted`, never the effective `muted`. `#save()` is reached from the
   * volume setter as well as the mute setter, and that second caller is what
   * closed the leak this method used to have: `#save()` serialised `#muted`,
   * which by then could be a page's own `muteForView` default, so dragging
   * sorting.html's volume slider persisted `muted: true` into the site-wide key
   * and every cry page went permanently silent for a reader who had only ever
   * adjusted the loudness. Measured, in that order:
   *
   *   load sorting.html            → key null
   *   drag the volume slider      → {"volume":0.55,"muted":true}
   *   open cries.html             → muted true, silent, with no control of its own
   *
   * So the split is the fix and not a tidiness: one field cannot carry both a
   * page's decision and a reader's, because `#save()` cannot tell them apart.
   */
  #save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ volume: this.#volume, muted: this.#storedMuted }));
    } catch {
      // Storage unavailable (private mode, quota). Both levels still apply for this
      // page view; they just will not be remembered. This was true of the page's
      // own default mute only once the two were separate fields — before, a volume
      // write dragged the default along with it.
    }
  }
}

/** Shared instance. Every cry surface on the site wants the same buffer cache,
 *  the same volume, and the ability to cut in on whatever else is sounding. */
export const cryPlayer = new CriesPlayer();
