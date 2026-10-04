/**
 * A Game Boy APU, close enough to play the Generation I cries in gen1_cry_sfx.json.
 *
 * This module is deliberately pure: no DOM, no Web Audio, no fetch. It turns a
 * base cry's command lists plus one species' pitch and length bytes into a
 * Float32Array of samples. Everything audible happens here, so the page stays a
 * control panel and the parts that can be checked against ground truth
 * (identical cries, the Caterpie/Goldeen duration gap) can be checked in Node.
 *
 * WHY IT SYNTHESISES AT 65,536 Hz AND NOT THE REAL 1,048,576 Hz
 * -----------------------------------------------------------
 * The Game Boy's CPU runs at 1,048,576 Hz and the reference synthesiser by
 * rgmechex.com generates every sample at that rate. Web Audio cannot: the spec
 * caps a buffer's sample rate at 96,000 Hz. So this generates at 65,536 Hz,
 * which is 1,048,576 / 16 — an exact integer ratio, so nothing drifts, and one
 * 60 Hz note frame is exactly 32 samples with no rounding anywhere.
 *
 * The cost is everything above 32,768 Hz, and that is not nothing: a Game Boy
 * pulse wave is a square, and a square has harmonics to infinity. The reference
 * author notes the same thing about their own output ("very high frequency
 * noise may sound a bit different than on a Gameboy"). What survives is the part
 * that carries the timbre — the duty pattern, the note sequence, the envelope,
 * the noise bursts — which is what the cries are made of.
 *
 * THE FIVE COMMANDS, AND WHAT THEY DO
 * -----------------------------------
 *   duty_cycle_pattern a,b,c,d   One byte, four 2-bit duty values. The engine
 *                                swaps between them every quarter of a note,
 *                                which is what makes a GB pulse note sound
 *                                "fuller" than a single duty would. Packed as
 *                                `a<<6 | b<<4 | c<<2 | d`, verified against the
 *                                reference article's worked example: a pattern
 *                                of 2-0-2-0 is $88.
 *   square_note len,vol,sweep,f  A pulse note. `len` is 1..16 frames of 1/60 s.
 *                                `vol` is 0..15. `sweep` is a SIGNED 4-bit
 *                                volume-sweep rate: positive fades out,
 *                                negative fades in. `f` is the 11-bit
 *                                frequency register.
 *   noise_note len,vol,sweep,p   Same, but the fourth operand is an 8-bit noise
 *                                parameter rather than a frequency: bit 3
 *                                picks a 7-bit LFSR over a 15-bit one and the
 *                                remaining seven bits are the sampling rate.
 *   sound_loop n,target         Play this channel's commands again, n times
 *                                total. The only one in the corpus is cry0d's
 *                                Ch5, looping to its own start.
 *   sound_ret                   Stop the channel.
 *
 * HOW FREQUENCY BECOMES A PITCH
 * ------------------------------
 * The 11-bit register X sounds at 131072 / (2048 - X) Hz. The species' pitch
 * byte is ADDED to X, and the sum wraps at 11 bits — so a large pitch shift can
 * wrap a note from near-Nyquist round to almost inaudible. This is not a bug in
 * the reproduction; it is the documented behaviour, and it is why Poliwag and
 * Ditto (pitch 0xFF) start their cry at 131,072 Hz, which is not a sound, and
 * land the rest of it around 66 Hz, which is a rumble.
 *
 * HOW TIME STRETCHING WORKS
 * -------------------------
 * The species' length byte is read as a SIGNED value and the multiplier is
 * 256 + signed, so 0x00 means no stretch (256) and the documented range
 * $80..$17F is 128..383. A note is held for `len * multiplier / 256` frames.
 * Caterpie's cry uses 0x20 and Goldeen's 0x40, which puts their first pulse
 * channel at 0.6412 s and 0.7123 s — a gap of 0.07116 s against the 0.071 s
 * Bulbapedia reports. That agreement is why the note frame is 1/59.7275 s and
 * not the 2048 Hz the Game Boy's frame sequencer nominally runs at.
 *
 * Note that the gap belongs to Ch5 specifically. Base 22's three channels run 34,
 * 35 and 32 frames, so the cry's total length is set by Ch6 and the gap between
 * the two species' TOTAL lengths is 0.0733 s, not 0.0712 s. Bulbapedia's figure
 * is the first pulse channel's, which is the one carrying the body of the cry.
 *
 * WHAT IS APPROXIMATE, AND WHY IT SAYS SO
 * ---------------------------------------
 * The volume envelope's exact rate is not in either upstream description, so
 * `sweep` here is applied once per 60 Hz frame scaled by its magnitude. The
 * direction, the clamping and the release behaviour all come from the reference
 * article and are exact; only the per-frame step is a model. It is a parameter,
 * not a hidden constant — pass `envelopeStep` to change it.
 *
 * The release period IS modelled, and it is not cosmetic. After a pulse
 * channel's last note it keeps sounding at that note's frequency until its
 * volume reaches zero, which is why Exeggutor's noise channel does not produce
 * the end-of-cry crash that Doduo's does: Exeggutor's pulse notes are longer,
 * so the pulse channel is still sounding when the noise finishes, and the pitch
 * shift has not been cancelled yet.
 */

export const GB_CLOCK = 1048576;
/**
 * Notes start and end on frame boundaries, "about once every 16.7 ms" per the
 * reference article. That is the NTSC frame rate rather than a round 60, and the
 * difference is small enough to look like a rounding choice and large enough to
 * matter when a published figure is being reproduced: Caterpie's and Goldeen's
 * first pulse channel span 34 and 34 frames at two different stretch factors, so
 * the gap between them is 34 * 0.125 / FRAME_HZ. At 60 Hz that is 0.07083 s; at
 * 59.7275 Hz it is 0.07116 s, and Bulbapedia prints 0.071 s.
 */
export const FRAME_HZ = 59.7275;
export const FRAME_SECONDS = 1 / FRAME_HZ;
export const SYNTH_RATE = 65536;
export const SAMPLES_PER_FRAME = SYNTH_RATE / FRAME_HZ; // 1090.666…

/** 131072 / (2048 - X), the Game Boy's pitch formula. */
export function frequencyHz(register) {
  const x = register & 0x7ff;
  return 131072 / (2048 - x);
}

/** The 11-bit register a species' pitch byte produces for a given note.
 *
 *  The wrap is the point. `register + pitch` overflowing 11 bits lands the note
 *  near the bottom of the range instead of the top, which is why a high pitch
 *  byte can make a cry quieter-sounding rather than higher. */
export function shiftedRegister(register, pitch) {
  return (register + pitch) & 0x7ff;
}

/** The length byte as a signed offset, and the multiplier it implies. */
export function lengthMultiplier(lengthByte) {
  const signed = lengthByte > 127 ? lengthByte - 256 : lengthByte;
  return { signed, multiplier: 256 + signed, stretch: (256 + signed) / 256 };
}

/** Four 2-bit duty values as the single byte the hardware register holds. */
export function packDuty(pattern) {
  return ((pattern[0] & 3) << 6) | ((pattern[1] & 3) << 4) | ((pattern[2] & 3) << 2) | (pattern[3] & 3);
}

/** How long a note of `frames` lasts once the length byte is applied. */
export function noteSeconds(frames, lengthByte) {
  return (frames * lengthMultiplier(lengthByte).stretch) / FRAME_HZ;
}

/* ---------------------------------------------------------------------------
   Duty patterns. A duty value is the fraction of the period the output is high:
   0 = 12.5%, 1 = 25%, 2 = 50%, 3 = 75%. The four-step pattern is what the
   command names, and the engine walks it one step per quarter period — fast
   enough that it reads as a single timbre rather than as four notes.
   --------------------------------------------------------------------------- */

const DUTY_THRESHOLD = [0.125, 0.25, 0.5, 0.75];

/* ---------------------------------------------------------------------------
   Noise. A 15-bit linear feedback shift register, sampled at a rate set by the
   low seven bits of the parameter; bit 3 shortens it to 7 bits for a brighter,
   more metallic hiss. Bit 0 of the register is the output.
   --------------------------------------------------------------------------- */

class Noise {
  constructor() { this.reset(); }

  reset() {
    this.lfsr = 0x7fff;
    this.short = false;
    this.phase = 0;
    this.last = 1;
  }

  /** @param param 0..255 — bit 3 selects a 7-bit register, the rest is rate. */
  step(param) {
    this.short = (param & 0x08) !== 0;
    return this;
  }

  /** The rate the register is clocked at.
   *
   *  The reference article gives the formula as an image and does not spell it
   *  out, so this reuses the pulse channels' shape: the low three bits are read
   *  as an 11-bit register and 131072 / (2048 - X) gives 64 Hz at 0 and 512 Hz at
   *  7. That range brackets the few-hundred-Hz to low-kHz rates a noise channel is
   *  clocked at, and the low-pass character of a noise burst barely depends on
   *  where inside it you sit. It is the one rate here that is a model, and it is
   *  a model of the register rather than of the envelope. */
  static rate(param) {
    return frequencyHz((param & 0x07) << 8);
  }

  /** Advance by one output sample's worth of time. */
  clock(sampleRate, param) {
    this.step(param);
    this.phase += Noise.rate(param) / sampleRate;
    // A while, not an if: at 65,536 Hz and the slowest noise rate the phase can
    // only just exceed 1, but a fast rate at a low output rate could skip more
    // than one step, and skipping would silently change the noise's spectrum.
    while (this.phase >= 1) {
      this.phase -= 1;
      if (this.short) this.lfsr = (this.lfsr >> 1) & 0x7f;
      else this.lfsr = (this.lfsr >> 1) & 0x7fff;
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr = (this.lfsr | (bit << 14)) & (this.short ? 0x7f : 0x7fff);
    }
    this.last = (this.lfsr & 1) ? 1 : -1;
    return this.last;
  }
}

/* ---------------------------------------------------------------------------
   One channel's worth of state.
   --------------------------------------------------------------------------- */

class Channel {
  constructor(kind) {
    this.kind = kind;            // 'pulse' | 'noise'
    this.reset();
  }

  reset() {
    this.on = false;
    this.volume = 0;
    this.dutyPattern = [0, 0, 0, 0];
    this.dutyIndex = 0;
    this.phase = 0;
    this.phaseInc = 0;
    this.register = 0;
    this.noise = new Noise();
    this.envStep = 0;
    this.sweepDirection = 0;
    this.releasing = false;
  }

  get period() {
    return frequencyHz(this.register);
  }
}

/* ---------------------------------------------------------------------------
   The synthesiser.
   --------------------------------------------------------------------------- */

export class GbApu {
  /**
   * @param {object} base   one entry from gen1_cry_sfx.json's `sfx`
   * @param {object} opts
   *   pitch        0..255, the species' pitch byte
   *   length       0..255, the species' length byte
   *   volume       0..15 master scale
   *   muted        {5:bool, 6:bool, 8:bool}
   *   pitchShift   false disables the species pitch byte, for A/B comparison
   *   envelopeStep per-frame volume step per unit of sweep magnitude
   */
  constructor(base, {
    pitch = 0,
    length = 128,
    volume = 15,
    muted = {},
    pitchShift = true,
    envelopeStep = 1 / 8,
  } = {}) {
    this.base = base;
    this.pitchByte = pitch;
    this.lengthByte = length;
    this.masterVolume = volume;
    this.muted = muted;
    this.pitchShift = pitchShift;
    this.envelopeStep = envelopeStep;
    this.notes = [];
    this.noteEnd = 0;
  }

  /** Where the last note ENDS, excluding any release tail. */
  get noteSpanSeconds() {
    return this.noteEnd;
  }

  /** Every channel's command list, expanded into absolute-time note events. */
  plan() {
    const stretch = lengthMultiplier(this.lengthByte).stretch;
    this.notes = [];

    // Each channel is planned exactly once. An earlier version planned the two
    // pulse channels twice — once to learn when they end, then again with the
    // others — and the duplicate notes were only harmless because the render's
    // note cursor walks forward monotonically and skipped them. That is a
    // coincidence, not a property: any list whose order did not happen to be
    // sorted by start time would have played every pulse note twice.
    const ends = new Map();
    for (const channel of this.base.channels) {
      ends.set(channel.ch, this.#planChannel(channel, 0, stretch));
    }

    // The Game Boy erases the pitch offset once BOTH pulse channels have
    // finished, and the noise channel is not consulted — which is the whole
    // reason a cry can end in a crash.
    //
    // The cancellation is checked per SAMPLE, not per note. Testing a note's
    // START and calling the note either shifted or unshifted finds nothing at
    // all: in this corpus every noise note begins while a pulse channel is still
    // sounding, so a start-time test reports zero affected notes across all 151
    // species. What actually happens is that a note which is still sounding when
    // the offset is erased changes pitch partway through, and that discontinuity
    // is the crash.
    const pulseEnds = [ends.get(5), ends.get(6)].filter((v) => v !== undefined);
    const cancelAt = pulseEnds.length ? Math.max(...pulseEnds) : 0;
    for (const note of this.notes) {
      note.cancelTime = note.ch === 8 ? cancelAt : Infinity;
      // Kept for display: whether the note is audibly affected at all.
      note.shifted = note.ch !== 8 || cancelAt <= 0;
    }

    this.cancelAt = cancelAt;
    return {
      cancelAt,
      duration: Math.max(0, ...ends.values()),
      channelEnds: ends,
    };
  }

  /**
   * Walk one channel's commands, resolving time stretch and loops.
   *
   * `at` is the channel's start time; it is threaded through the loop rather
   * than returned, because a loop target can only ever point at the channel's
   * own start in the shipped data (cry0d's Ch5 loops to itself) but the command
   * names a channel and this keeps that honest rather than assuming.
   */
  #planChannel(channel, at, stretch) {
    const notes = [];
    const commands = channel.commands;
    let cursor = at;
    let duty = [0, 0, 0, 0];
    let pendingLoop = null;

    // Iterative rather than recursive: the corpus has a single loop, but a
    // bounded walk that refuses to run away is worth more than a `while (true)`
    // a malformed file could hang.
    const MAX_PASSES = 64;
    let pass = 0;
    let index = 0;
    let loops = new Map();
    let released = false;

    while (index < commands.length && pass < MAX_PASSES) {
      pass++;
      const cmd = commands[index++];
      switch (cmd.op) {
        case 'duty':
          duty = cmd.pattern;
          break;
        case 'ret':
          index = commands.length;
          break;
        case 'loop': {
          const target = `Ch${Number(String(cmd.target).replace('Ch', ''))}`;
          const previous = loops.get(target) ?? 0;
          loops.set(target, previous + 1);
          // `count` includes the first playthrough, so count 2 loops once.
          if (loops.get(target) < cmd.count) {
            const targetCh = Number(target.replace('Ch', ''));
            if (targetCh === channel.ch) index = 0;
          }
          break;
        }
        case 'pulse':
        case 'noise': {
          const frames = cmd.frames * stretch;
          const start = cursor;
          cursor += frames / FRAME_HZ;
          notes.push({
            ch: channel.ch,
            op: cmd.op,
            start,
            end: cursor,
            frames,
            volume: cmd.volume,
            sweep: cmd.sweep,
            register: cmd.op === 'pulse' ? cmd.freq : cmd.freq,
            duty: cmd.op === 'pulse' ? duty : null,
            // Filled in by plan(), once the pulse channels' end is known.
            shifted: channel.ch !== 8,
          });
          // The last note rings out until its envelope reaches zero.
          released = index >= commands.length;
          break;
        }
        default:
          break;
      }
    }

    if (released && notes.length) {
      // The release period: the final note keeps sounding at its own frequency
      // with its duty frozen, and stops when the volume sweep reaches zero.
      const last = notes[notes.length - 1];
      const drop = last.sweep > 0 ? last.volume / (last.sweep * this.envelopeStep) : Infinity;
      if (Number.isFinite(drop) && drop > 0) {
        last.release = (drop / FRAME_HZ);
        last.end = last.end + last.release;
        cursor += last.release;
      }
    }

    this.notes.push(...notes);
    // Two ends, because they are two different questions. `noteEnd` is where the
    // command list ran out; `cursor` includes the release tail. Bulbapedia's
    // 0.071 s Caterpie/Goldeen gap matches the first, and the release length
    // depends on an envelope rate that is a model -- so the check that compares
    // against a published figure has to use the part that is not modelled.
    this.noteEnd = Math.max(this.noteEnd, notes.length ? notes[notes.length - 1].end : cursor);
    return cursor;
  }

  /** Render to a Float32Array at SYNTH_RATE. */
  render() {
    const { duration, cancelAt } = this.plan();
    this.channelEnds = this.channelEnds ?? null;
    const total = Math.max(1, Math.ceil(duration * SYNTH_RATE) + 1);
    const out = new Float32Array(total);

    const channels = {
      5: new Channel('pulse'),
      6: new Channel('pulse'),
      8: new Channel('noise'),
    };

    const events = new Map();
    for (const note of this.notes) {
      if (!events.has(note.ch)) events.set(note.ch, []);
      events.get(note.ch).push(note);
    }

    const cursor = new Map([[5, 0], [6, 0], [8, 0]]);
    let peak = 0;

    for (let i = 0; i < total; i++) {
      const t = i / SYNTH_RATE;
      let mix = 0;

      for (const chId of [5, 6, 8]) {
        const channel = channels[chId];
        if (this.muted[chId]) continue;
        const list = events.get(chId) || [];
        let k = cursor.get(chId);
        while (k < list.length && list[k].end <= t) k++;
        cursor.set(chId, k);
        const note = list[k];
        if (!note || t < note.start) continue;
        if (note.op !== channel.kind) continue;

        // The envelope. Direction comes from the sign of a signed 4-bit field:
        // positive fades out, negative fades in.
        const elapsedFrames = (t - note.start) * FRAME_HZ;
        let volume = note.volume;
        if (note.sweep !== 0) {
          const step = Math.abs(note.sweep) * this.envelopeStep * elapsedFrames;
          volume = note.sweep > 0 ? note.volume - step : note.volume + step;
          volume = Math.max(0, Math.min(15, volume));
        }
        if (volume <= 0) continue;

        let sample;
        if (note.op === 'noise') {
          // Per sample, not per note: see plan().
          const shifted = t < note.cancelTime ? this.pitchByte : 0;
          const param = (note.register + shifted) & 0xff;
          if (!note.started) { channel.noise.reset(); note.started = true; }
          sample = channel.noise.clock(SYNTH_RATE, param);
        } else {
          const shifted = this.pitchShift ? this.pitchByte : 0;
          channel.register = shiftedRegister(note.register, shifted);
          const freq = frequencyHz(channel.register);
          channel.phaseInc = freq / SYNTH_RATE;
          channel.phase += channel.phaseInc;
          if (channel.phase >= 1) channel.phase -= Math.floor(channel.phase);
          /* The duty pattern swaps once per QUARTER PERIOD, which is what makes
             the note sound fuller than a single duty would. Stepping it once per
             output sample instead -- the obvious reading -- randomises the duty
             every sample and turns a square wave into broadband noise with the
             low-frequency sidebands that implies: measured, it put Machop's
             strongest partial at 64 Hz instead of the 627 Hz its register says. */
          const slot = Math.min(3, (channel.phase * 4) | 0);
          const duty = DUTY_THRESHOLD[note.duty[slot] & 3];
          sample = channel.phase < duty ? 1 : -1;
        }

        mix += sample * (volume / 15);
      }

      const value = mix * (this.masterVolume / 15) / 3;
      out[i] = value;
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
    }

    // Normalise by the measured peak rather than by 1.0. A cry built from a
    // muted channel or a zero volume would otherwise divide by zero, and one
    // built at full volume is not guaranteed to peak at exactly 1.
    this.peak = peak;
    if (peak > 0) {
      for (let i = 0; i < total; i++) out[i] /= peak;
    }

    this.duration = duration;
    this.cancelAt = cancelAt;
    return out;
  }

  /** The rendered audio's duration in seconds. */
  get durationSeconds() {
    return this.duration ?? 0;
  }
}

/**
 * Render one species' cry from the two generated tables.
 *
 * @param {object} cries  gen1_cries.json
 * @param {object} sfx    gen1_cry_sfx.json
 * @param {number} id     species id 1..151
 * @param {object} opts   passed to GbApu
 * @returns {{samples: Float32Array, meta: object}}
 */
export function renderSpeciesCry(cries, sfx, id, opts = {}) {
  const row = cries.cries.find((c) => c.id === id);
  if (!row) throw new Error(`no Gen-1 cry row for id ${id}`);
  const base = sfx.sfx[row.sfx];
  if (!base) throw new Error(`gen1_cry_sfx.json has no entry for ${row.sfx}`);

  const apu = new GbApu(base, { pitch: row.pitch, length: row.length, ...opts });
  const samples = apu.render();
  const { signed, multiplier, stretch } = lengthMultiplier(row.length);

  return {
    samples,
    /* The note list itself, not only its length: the timeline draws one bar per
     * note, and a channel timeline that silently renders nothing because the
     * page was handed a number instead of a list is not a visible failure. */
    notes: apu.notes,
    meta: {
      id,
      sfx: row.sfx,
      base: row.base,
      pitch: row.pitch,
      lengthByte: row.length,
      lengthSigned: signed,
      multiplier,
      stretch,
      duration: apu.durationSeconds,
      noteSpan: apu.noteSpanSeconds,
      release: apu.durationSeconds - apu.noteSpanSeconds,
      peak: apu.peak,
      cancelAt: apu.cancelAt,
      noteCount: apu.notes.length,
      implicitRet: base.implicitRet,
    },
  };
}

/** Which of a species' notes wrap past 11 bits once the pitch byte is added.
 *
 *  Returned rather than merely counted because it is the explanation for a
 *  surprise: Poliwag's first note is 131,072 Hz, which is not a sound, and the
 *  rest of its cry sits near 66 Hz because the rest of its notes wrapped. */
export function wrappedNotes(base, pitchByte) {
  const out = [];
  for (const channel of base.channels) {
    channel.commands.forEach((cmd, i) => {
      if (cmd.op !== 'pulse' && cmd.op !== 'noise') return;
      const limit = cmd.op === 'pulse' ? 0x7ff : 0xff;
      if (cmd.freq + pitchByte > limit) {
        out.push({ ch: channel.ch, index: i, register: cmd.freq, pitch: pitchByte, limit });
      }
    });
  }
  return out;
}

/** Group the 151 species by base cry, largest group first then by base index. */
export function groupByBaseCry(cries, meta) {
  const groups = new Map();
  for (const row of cries.cries) {
    if (!groups.has(row.sfx)) {
      groups.set(row.sfx, { sfx: row.sfx, base: row.base, members: [] });
    }
    groups.get(row.sfx).members.push({
      id: row.id,
      pitch: row.pitch,
      lengthByte: row.length,
      name: meta.get(row.id),
    });
  }
  return [...groups.values()].sort((a, b) => b.members.length - a.members.length || a.base - b.base);
}