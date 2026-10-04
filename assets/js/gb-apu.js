/**
 * A Game Boy APU, re-derived from the reference synthesiser at
 * https://rgmechex.com/tech/gen1cries.html so that a cry sounds like the cry
 * did before rather than like a reasonable guess at one.
 *
 * Pure: no DOM, no Web Audio, no fetch. gen1_cry_sfx.json plus one species'
 * pitch and length bytes go in, a Float32Array comes out. That is what lets
 * check_gen1_apu.mjs assert on samples rather than on prose.
 *
 * WHY THIS FILE EXISTS AT ALL, GIVEN THE .ogg FILES ALREADY DO
 * -------------------------------------------------------------
 * assets/cries/ holds modern recordings, and nothing in them says how the
 * Game Boy produced the originals. The commands in gen1_cry_sfx.json do, and
 * they explain things an audio file cannot: that 151 cries came from 38 base
 * sounds, why some pairs are bit-identical, why a pitch shift can make a cry
 * quieter instead of higher, and why some of them end in a crash. Re-synthesising
 * from the commands is the only way to show those.
 *
 * WHY THE OUTPUT DOES NOT LOOK LIKE THE HARDWARE, STILL
 * ------------------------------------------------------
 * The reference synthesises at 1,048,576 Hz, the Game Boy's CPU clock. Web
 * Audio cannot: the spec caps a buffer's sample rate at 96,000. This generates
 * at 65,536 Hz, which is 1,048,576 / 16 — an exact integer ratio, so nothing
 * drifts and every counter scales by the same factor.
 *
 * Everything above 32,768 Hz is gone, and for a pulse wave that matters: a
 * square wave has harmonics to infinity and they are what makes a note sound
 * bright rather than nasal. The reference author notes the same about their own
 * output. What survives is what the cries are actually made of — the note
 * sequence, the duty rotation, the envelope, the noise bursts.
 *
 * THE FIVE THINGS THAT WERE WRONG BEFORE, AND WHERE THE TRUTH COMES FROM
 * ---------------------------------------------------------------------
 * Each of these was measured by listening to the two implementations disagree,
 * and each is now transcribed from the reference's own source rather than
 * reasoned about. The comment on each cites the line it came from.
 *
 * 1. THE DUTY PATTERN TURNS ONCE PER FRAME, not once per quarter period.
 *    This was the loudest error by a wide margin. At 627 Hz a quarter-period
 *    step happens every 0.4 ms; the hardware rotates the register every 16.7 ms.
 *    Forty times too fast averages the four duty values into a single dull
 *    square, which is why every cry sounded like a buzzer instead of a voice.
 *        duty = ((duty & 0x3F) << 2) | ((duty & 0xC0) >> 6);
 *
 * 2. THE VOLUME ENVELOPE STEPS, AND ONLY EVERY |sweep| FRAMES.
 *    The previous version faded continuously by sweep/8 per frame, which made
 *    every note decay inside itself: Charizard's first three notes went 15 to
 *    11.5, 14 to 8 and 13 to 10, where the hardware holds 15, 14 and 13 and only
 *    ramps down in the long notes near the end. That single difference is most
 *    of the "melting" quality.
 *        if (volfade != 0 && (i+1) % (SAMPLES_PER_FRAME * |volfade|) == 0)
 *            volume += (volfade < 0 ? 1 : -1);
 *
 * 3. THE NOISE CHANNEL IS NOT TIME-STRETCHED.
 *        getNoise(cries[type].noise, pitch, 0, cutoff);  // length is 0
 *    The length byte applies to the pulse channels only, so stretching one cry
 *    leaves its noise tail at the original pace while the pulse notes stretch.
 *    Applying the stretch to all three ran the noise out of step with the music.
 *
 * 4. THE NOISE RATE USES TWO FIELDS OF THE PARAMETER, not one.
 *    The old version read the low three bits and threw the rest away, so every
 *    noise note in the corpus came out at the same 128 Hz — a slow wobble where
 *    the hardware produces something near static. The rate is the low three bits
 *    as a divisor and bits 4-7 as a shift:
 *        shift = (params >> 4) & 0xF;  divider = params & 0x7;
 *        if (sampleI % (2 * (divider == 0 ? 0.5 : divider) * (1 << (shift + 1))) == 0)
 *
 * 5. EVERY CHANNEL'S LAST NOTE RINGS OUT, not just the six with a missing
 *    sound_ret. The reference does not implement the $FF end command at all —
 *    its own note says "end unsupported" — so it keeps sounding each channel's
 *    final note until its envelope reaches zero. Treating sound_ret as a hard
 *    stop truncated every one of the 151 cries.
 *        i < sampleCount || (cmdI == notes.length - 1 && volume > 0)
 *
 * Two smaller ones, same provenance: the duty waveform is centred on the middle
 * of the period rather than starting high at phase zero, and the pitch offset is
 * cancelled one frame BEFORE the pulse channels end rather than at the instant
 * they do.
 *        case 0 : return (p >= 4/8 && p < 5/8);
 *        case 1 : return (p >= 4/8 && p < 6/8);
 *        case 2 : return (p >= 2/8 && p < 6/8);
 *        case 3 : return (p <  4/8 || p >= 6/8);
 *        cutoff = Math.max(p1Len, p2Len) - SAMPLES_PER_FRAME;
 */

export const GB_CLOCK = 1048576;
export const SYNTH_RATE = 65536;
/**
 * The reference hardcodes 17,556 samples per frame at 1,048,576 Hz, which is
 * 59.7275 Hz — the NTSC frame rate, not a round 60. Carrying the ratio over
 * rather than recomputing from 60 keeps this file's timing identical to the
 * thing it is imitating.
 */
export const FRAME_HZ = GB_CLOCK / 17556;
/* How many output samples one sample of the Game Boy's clock is worth here: 1/16 at
 * the Web Audio ceiling, 1 when running at the clock itself. Written as a ratio
 * rather than the literal 16 so the APU can be driven at 1,048,576 Hz to compare
 * against the reference's own output sample for sample. */
const CLOCK_RATIO = GB_CLOCK / SYNTH_RATE;
export const SAMPLES_PER_FRAME = SYNTH_RATE / FRAME_HZ;
export const FRAME_SECONDS = 1 / FRAME_HZ;

/** 131072 / (2048 - X), the Game Boy's pitch formula. */
export function frequencyHz(register) {
  return 131072 / (2048 - (register & 0x7ff));
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
  /* The parameter is the stored byte MINUS 0x80, not its two's-complement signed
   * reading. Those differ by 0x80 for every byte >= 0x80, and the difference is not
   * a rounding detail: it is a third of the note length. Charizard stores 0x80, so
   * the reference's parameter is 0 and its multiplier is 0x100 -- no stretch at all
   * -- while reading the byte as signed gives -128 and a multiplier of 0x180, which
   * makes every note half again as long. The reference's own output settles it: at
   * 0x100 Charizard is 57 frames, at 0x180 it is 82, and the downloaded .raw is 57
   * exactly.
   *
   * The range is therefore 0..255, not 0..511, and a stored 0x00 gives a multiplier
   * of 0x80 -- notes a quarter of their nominal length. */
  const param = lengthByte - 0x80;
  return { param, multiplier: param + 0x100, stretch: (param + 0x100) / 256 };
}

/** Four 2-bit duty values as the single byte the hardware register holds. */
export function packDuty(pattern) {
  return ((pattern[0] & 3) << 6) | ((pattern[1] & 3) << 4) | ((pattern[2] & 3) << 2) | (pattern[3] & 3);
}

/* ---------------------------------------------------------------------------
   The two primitives, transcribed from the reference.
   --------------------------------------------------------------------------- */

/** One output sample. The minus sign is a global polarity flip and is kept so the
 *  mix matches the reference's phase for phase. */
function sample(bin, volume) {
  return ((2 * bin) - 1) * (-volume / 0x10);
}

/** The four duty waveforms, all centred on the middle of the period. Note that
 *  these are not "high for the first d/8 of the phase" — duty 1 is high from 4/8
 *  to 6/8, which is centred, not left-aligned. */
function calcDuty(d, p) {
  switch (d & 3) {
    case 0: return p >= 4 / 8 && p < 5 / 8;
    case 1: return p >= 4 / 8 && p < 6 / 8;
    case 2: return p >= 2 / 8 && p < 6 / 8;
    case 3: return p < 4 / 8 || p >= 6 / 8;
    default: return false;
  }
}

/**
 * One pulse channel. Transcribed from getSquare().
 *
 * @param commands  the channel's command list, with sound_ret already removed
 * @param length    the species' length byte; 0 for the noise channel
 */
function renderPulse(commands, pitch, length) {
  /* Resolved once per channel rather than per note: the multiplier is a property
   * of the species, not of the note. */
  const multiplier = lengthMultiplier(length).multiplier;
  let posSixteenths = 0;
  const out = [];
  let duty = 0;
  let perc = 0;      // phase, and it is NOT reset between notes, as upstream
  let leftovers = 0;  // fractional frames carried into the next note
  let sampleI = 0;    // the position in the OUTPUT, and it is never reset
  let rotations = 0;  // exposed so a checker can assert it is per FRAME
  let steps = 0;      // envelope volume changes, across the whole channel

  /* The reference does not implement sound_ret, so its last note rings until the
   * envelope empties. A sweep of 0 means the envelope never steps, so on the
   * reference such a note rings forever -- and here it rang until the sample cap:
   * four million samples, sixty seconds, for one note. The tail is bounded
   * instead, to the hardware's maximum note length. Nothing in this corpus comes
   * near either bound, which is exactly why the runaway stayed hidden until a
   * synthetic note asked for it. */
  const ringCap = Math.round(SAMPLES_PER_FRAME * 16);
  let nominal = 0;    // summed note lengths, WITHOUT any ring-out

  const frameSamples = Math.round(SAMPLES_PER_FRAME);

  for (let cmdI = 0; cmdI < commands.length; cmdI++) {
    const cmd = commands[cmdI];
    /* The register holds the PACKED byte, not the pattern array. Upstream reads it
     * as `duty & 3`, so an array here would coerce to NaN and then to 0 -- which
     * silently picks the 12.5% window for every note on any channel whose low two
     * bits are not 00. Charizard's second pulse channel is duty $5A, whose low bits
     * are 2, so its waveform came out inverted for the whole cry. The two channels
     * whose low bits happened to be 0 matched by luck, which is what made this look
     * like a tuning difference rather than a bug. */
    if (cmd.op === 'duty') { duty = packDuty(cmd.pattern); continue; }
    if (cmd.op !== 'pulse' && cmd.op !== 'noise') continue;

    const isLast = cmdI === commands.length - 1;
    // (length + 0x100) * (frames + 1): the stored byte is the frame count MINUS
    // ONE, and the extra 0x100 is the "no stretch" multiplier. `>> 8` is a floor,
    // and the remainder is carried into the next note -- which is the whole
    // mechanism by which a fractional stretch accumulates instead of rounding
    // away at every note.
    const subframes = (multiplier * (cmd.frames + 1)) + leftovers;
    /* Positions are accumulated in CLOCK units and rounded once, rather than each
     * note's length being rounded on its own. The reference's per-note length of
     * 17,556 * frames is an integer at its own rate, so rounding the delta instead of
     * the cumulative position loses up to half a sample per note -- 4 samples across
     * Charizard's whole cry. */
    const endSixteenths = posSixteenths + (SAMPLES_PER_FRAME * CLOCK_RATIO) * (subframes >> 8);
    const startSample = Math.round(posSixteenths / CLOCK_RATIO);
    const sampleCount = Math.round(endSixteenths / CLOCK_RATIO) - startSample;
    posSixteenths = endSixteenths;
    leftovers = subframes & 0xFF;
    nominal += sampleCount;

    let vol = cmd.volume;
    const volfade = cmd.sweep;
    const period = (SYNTH_RATE * (2048 - shiftedRegister(cmd.freq, pitch))) / 131072;
    const envelopePeriod = frameSamples * Math.abs(volfade);

    // `i` is the per-note counter and `sampleI` the output position, and the two
    // are used for different things on purpose, exactly as upstream does: the
    // duty register rotates on the GLOBAL frame grid while the envelope runs on
    // the note's own. Resetting sampleI per note -- as the first version here did
    // -- makes every note after the first overwrite the beginning of the buffer,
    // which silently truncated Charizard to its fourth note.
    for (let i = 0; i < 4_000_000; i++) {
      // The ring-out: the last note keeps going after its nominal length until its
      // envelope reaches zero. Not a hack -- it is what makes a cry fade instead
      // of being cut off, and it is why dropping the sound_ret command changes the
      // sound of all 151 species.
      if (!(i < sampleCount || (isLast && vol > 0 && i < sampleCount + ringCap))) break;

      out[sampleI] = (out[sampleI] || 0) + sample(calcDuty(duty & 3, perc) ? 1 : 0, vol);
      perc += 1 / period;
      if (perc >= 1) perc -= Math.floor(perc);
      sampleI++;

      // Once per frame, rotate the duty register left by two bits. This is the
      // line the previous quarter-period implementation got wrong.
      if (i < sampleCount && sampleI % frameSamples === 0) {
        duty = ((duty & 0x3f) << 2) | ((duty & 0xc0) >> 6);
        rotations++;
      }
      if (volfade !== 0 && envelopePeriod > 0 && (i + 1) % envelopePeriod === 0) {
        vol += volfade < 0 ? 1 : -1;
        vol = vol < 0 ? 0 : (vol > 0x0f ? 0x0f : vol);
        steps++;
      }
      // A register of 2047 gives a period of half a sample, so guard the loop.
      if (!(period > 0)) break;
    }
  }

  return { out, rotations, steps, nominal, dutyFinal: duty };
}

/**
 * The pitch offset a noise note receives, decided ONCE at the note's start.
 *
 * The renderer and the timeline both call this. They used to each carry their own
 * copy of the comparison, which is the exact shape of bug that hides: the renderer
 * worked in samples and the timeline in seconds, so they disagreed on every note
 * while both looked correct.
 */
export function noiseOffset(startSample, cutoffSamples, pitch) {
  return startSample >= cutoffSamples ? 0 : pitch;
}

/** One noise channel. Transcribed from getNoise(). */
function renderNoise(commands, pitch, cutoffSamples) {
  const out = [];
  let leftovers = 0;
  let sampleI = 0;   // output position, never reset

  const frameSamples = Math.round(SAMPLES_PER_FRAME);
  // Same bounded ring-out as the pulse channels: see renderPulse. Unreachable from
  // this corpus, because a noise sweep is always +/-1 and so always decays.
  const ringCap = Math.round(SAMPLES_PER_FRAME * 16);
  const noiseClocks = [];

  for (let cmdI = 0; cmdI < commands.length; cmdI++) {
    const cmd = commands[cmdI];
    if (cmd.op !== 'noise' && cmd.op !== 'pulse') continue;

    const isLast = cmdI === commands.length - 1;
    // length is 0 here: the noise channel is not time-stretched. See the header.
    const subframes = 0x100 * (cmd.frames + 1) + leftovers;
    const sampleCount = Math.round(SAMPLES_PER_FRAME * (subframes >> 8));
    leftovers = subframes & 0xFF;

    let vol = cmd.volume;
    const volfade = cmd.sweep;
    // The parameter, and the pitch offset is decided ONCE, at the note's start,
    // against a cutoff one frame before the pulse channels end. A note that
    // begins in that last frame loses the offset, and that discontinuity is the
    // end-of-cry crash.
    const offset = noiseOffset(sampleI, cutoffSamples, pitch);
    const params = (cmd.freq + offset) & 0xff;

    let shift = (params >> 4) & 0xf;
    // E and F are not defined on real hardware; upstream clamps rather than
    // special-cases them, and the clamped values are close enough that it says
    // so itself.
    if (shift > 0x0d) shift &= 0x0d;
    const divider = params & 0x7;
    const width = (params & 0x8) === 0x8;   // bit 3: a 7-bit LFSR, not 15
    const clock = Math.max(1, Math.round(
      2 * (divider === 0 ? 0.5 : divider) * (1 << (shift + 1))));

    noiseClocks.push(Math.round(clock * (SYNTH_RATE / GB_CLOCK)));
    noiseClocks.push(Math.round(clock * (SYNTH_RATE / GB_CLOCK)));
    let buffer = 0x7fff;   // reset per note, as upstream does
    const envelopePeriod = frameSamples * Math.abs(volfade);

    for (let i = 0; i < 4_000_000; i++) {
      if (!(i < sampleCount || (isLast && vol > 0 && i < sampleCount + ringCap))) break;

      const bit0 = buffer & 1;
      out[sampleI] = (out[sampleI] || 0) + sample(1 ^ bit0, vol);
      sampleI++;

      if (sampleI % clock === 0) {
        const bit1 = (buffer >> 1) & 1;
        buffer = (buffer >> 1) | ((bit0 ^ bit1) << 14);
        if (width) buffer = (buffer >> 1) | ((bit0 ^ bit1) << 6);
      }
      if (volfade !== 0 && envelopePeriod > 0 && (i + 1) % envelopePeriod === 0) {
        vol += volfade < 0 ? 1 : -1;
        vol = vol < 0 ? 0 : (vol > 0x0f ? 0x0f : vol);
      }
    }
  }

  return { out, noiseClocks };
}

/* ---------------------------------------------------------------------------
   The synthesiser.
   --------------------------------------------------------------------------- */

export class GbApu {
  /**
   * @param {object} base  one entry from gen1_cry_sfx.json's `sfx`
   * @param {object} opts
   *   pitch      0..255, the species' pitch byte
   *   length     0..255, the species' length byte
   *   volume     0..15 master scale
   *   muted      {5:bool, 6:bool, 8:bool}
   *   pitchShift false disables the species pitch byte, for A/B comparison
   */
  constructor(base, {
    pitch = 0,
    length = 128,
    volume = 15,
    muted = {},
    pitchShift = true,
  } = {}) {
    this.base = base;
    this.pitchByte = pitchShift ? pitch : 0;
    this.lengthByte = length;
    this.masterVolume = volume;
    this.muted = muted;
    this.notes = [];
  }

  /** sound_ret is dropped, which is what enables the ring-out. */
  /* The command list to render, with `sound_ret` dropped and `sound_loop` APPLIED.
   *
   * An earlier version dropped the loop instead, on the strength of the reference
   * article's feature list, which marks loop "unsupported". That list describes what
   * the page's own UI will let you draw; the data it ships has the loop already
   * expanded, and its Ch5 for cry0d holds fourteen entries where the raw table holds
   * seven. So the loop is not unsupported, it is resolved before rendering.
   *
   * `count` is the number of TIMES the block plays, not the number of extra times:
   * cry0d's Ch5 is a duty plus six notes with `{"count": 2}`, and the reference's
   * expanded list is that seven-entry block twice. Getting that wrong by one
   * silently shortens the nine species on base cry0d. */
  #commandsFor(ch) {
    const cmds = ch.commands.filter((c) => c.op !== 'ret');
    const loopAt = cmds.findIndex((c) => c.op === 'loop');
    if (loopAt < 0) return cmds;
    const block = cmds.slice(0, loopAt);
    const times = Math.max(1, cmds[loopAt].count);
    const out = [];
    for (let i = 0; i < times; i++) out.push(...block);
    // Anything after the loop is appended once; nothing in this corpus has any.
    out.push(...cmds.slice(loopAt + 1));
    return out;
  }

  render() {
    const chans = new Map(this.base.channels.map((c) => [c.ch, c]));

    const r1 = chans.has(5)
      ? renderPulse(this.#commandsFor(chans.get(5)), this.pitchByte, this.lengthByte)
      : null;
    const r2 = chans.has(6)
      ? renderPulse(this.#commandsFor(chans.get(6)), this.pitchByte, this.lengthByte)
      : null;
    const pulse1 = r1 ? r1.out : [];
    const pulse2 = r2 ? r2.out : [];

    /* The noise channel's pitch offset is cancelled one frame before the pulses
     * are SCHEDULED to end -- and that is the sum of the notes, not the length they
     * are actually rendered to. The ring-out can run on past it, so taking the
     * cutoff off the rendered arrays instead pushed it later than upstream's and
     * silently kept notes shifted that upstream leaves unshifted. */

    const nominalLongest = Math.max(r1?.nominal ?? 0, r2?.nominal ?? 0);
    this.nominalSamples = { 5: r1?.nominal ?? 0, 6: r2?.nominal ?? 0 };
    const cutoff = Math.max(0, nominalLongest - Math.round(SAMPLES_PER_FRAME));

    const noiseResult = chans.has(8)
      ? renderNoise(this.#commandsFor(chans.get(8)), this.pitchByte, cutoff)
      : null;
    const noise = noiseResult ? noiseResult.out : [];
    /* The clock each noise note actually ran at, in output Hz. Recorded so the
     * checker can ask whether the RENDERED noise honours both the shift field and
     * the pitch offset -- testing the exported helper instead would only prove the
     * helper is right, which is a different claim. */
    this.noiseClocks = noiseResult ? noiseResult.noiseClocks : [];

    const total = Math.max(1, Math.max(pulse1.length, pulse2.length, noise.length));
    const samples = new Float32Array(total);
    let peak = 0;

    // Three channels, each at a third, summed. The division is upstream's and it
    // is what keeps a cry with all three channels sounding from clipping.
    const master = this.masterVolume / 15;
    for (const [buf, ch] of [[pulse1, 5], [pulse2, 6], [noise, 8]]) {
      if (this.muted[ch]) continue;
      for (let i = 0; i < buf.length && i < total; i++) samples[i] += buf[i] * master / 3;
    }
    /* No peak normalisation, and there must not be any. Each channel is bounded by
     * +/-1 and the mix divides by three, so three sounding channels sum to at most
     * 1.0: the signal cannot clip, and normalising it is not a safety measure but a
     * distortion. It also silently rescales every cry, which is why a muted channel
     * came out as loud as a full one and why comparing against the reference's own
     * output was impossible. The peak is still measured, because the page draws an
     * envelope from it. */
    for (let i = 0; i < total; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    this.peak = peak;

    this.duration = total / SYNTH_RATE;
    this.cancelAt = cutoff / SYNTH_RATE;
    this.channelSamples = { 5: pulse1.length, 6: pulse2.length, 8: noise.length };
    /* The noise channel's pitch offset is cancelled one frame before the pulses
     * are scheduled to end -- and "scheduled to end" is the SUM OF THE NOTES, not
     * the length they are actually rendered to. The ring-out can run on well past
     * that point, so measuring the cutoff off the rendered arrays instead pushed
     * it later than upstream's and silently kept notes shifted that upstream
     * leaves unshifted. */
    /* Counters, so the checker can assert the two behaviours that were wrong for
     * so long without having to listen: the duty register must turn once per
     * FRAME (not once per quarter period), and the envelope must change once per
     * |sweep| frames (not continuously). */
    this.dutyRotations = (r1?.rotations ?? 0) + (r2?.rotations ?? 0);
    this.envelopeSteps = (r1?.steps ?? 0) + (r2?.steps ?? 0);
    /* The register's value after the last rotation. It cycles with period 4, so a
     * channel that stopped rotating is caught here and nowhere else: a frozen duty
     * still produces a coherent tone at the right pitch, which is why the spectrum
     * check cannot see it and why the rotation counter cannot either. */
    this.dutyAfter = [r1?.dutyFinal, r2?.dutyFinal];
    this.notes = this.#timeline();
    return samples;
  }

  /**
   * A note list for the timeline, in seconds.
   *
   * Derived from the same arithmetic the renderer uses, so the bars on screen and
   * the audio cannot disagree. The ring-out tail is reported as part of the note
   * because that is what a reader sees happen to it.
   */
  #timeline() {
    const notes = [];
    /* Samples, not seconds. `cutoff` is a sample offset and `cursor` is too;
     * comparing one against the other in different units made every note look
     * shifted and silently zeroed the end-of-cry crash the page draws. */
    const cutoff = Math.max(0, Math.round(this.cancelAt * SYNTH_RATE));
    for (const ch of this.base.channels) {
      if (this.muted[ch.ch]) continue;
      let cursor = 0;   // in samples, and never reset — same as the renderer
      let posSixteenths = 0;
      let leftovers = 0;
      const isNoise = ch.ch === 8;
      const cmds = this.#commandsFor(ch);
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i];
        if (cmd.op !== 'pulse' && cmd.op !== 'noise') continue;
        const isLast = i === cmds.length - 1;
        /* The multiplier must be the renderer's, and the two differ by channel:
         * pulses stretch by lengthByte + 0x100, while a noise note's length is
         * 0x100 — NOT zero. Using zero here, as an earlier version did to express
         * "not time-stretched", gave every noise note a length of zero frames, so
         * the whole noise lane drew as a row of zero-width bars. */
        const multiplier = isNoise ? 0x100 : lengthMultiplier(this.lengthByte).multiplier;
        const subframes = (multiplier * (cmd.frames + 1)) + leftovers;
        const start = cursor;
        cursor = Math.round((posSixteenths + (SAMPLES_PER_FRAME * CLOCK_RATIO) * (subframes >> 8)) / CLOCK_RATIO);
        const noteSamples = cursor - start;
        posSixteenths += (SAMPLES_PER_FRAME * CLOCK_RATIO) * (subframes >> 8);
        leftovers = subframes & 0xff;

        /* Ring-out: the last note runs until its envelope empties -- but only for
         * the part the note's own length did not already cover. An envelope fires
         * every |sweep| frames FROM THE NOTE'S START, so a last note whose sweep
         * is fast enough to empty the volume inside its own length has no tail at
         * all. Adding `volume / |sweep|` frames unconditionally overstates it: for
         * Charizard's final note that was 184 ms of tail that never sounded, and
         * the bar on screen ran past the end of the audio. */
        let end = cursor;
        if (isLast && cmd.sweep !== 0) {
          const perStep = Math.round(SAMPLES_PER_FRAME) * Math.abs(cmd.sweep);
          const needed = Math.ceil(cmd.volume / Math.abs(cmd.sweep));
          const already = Math.floor(noteSamples / Math.max(1, perStep));
          end += Math.max(0, needed - already) * perStep;
        }
        notes.push({
          ch: ch.ch,
          op: cmd.op,
          start: start / SYNTH_RATE,
          end: end / SYNTH_RATE,
          frames: cmd.frames + 1,
          volume: cmd.volume,
          sweep: cmd.sweep,
          register: cmd.freq,
          // True while the pitch offset still applies. Decided per note, in
          // SAMPLES, against a cutoff one frame before the pulse channels end --
          // the same test the renderer makes, so the two cannot disagree.
          shifted: !isNoise || noiseOffset(start, cutoff, 1) === 1,
        });
      }
    }
    return notes;
  }

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
      peak: apu.peak,
      cancelAt: apu.cancelAt,
      noteCount: apu.notes.length,
      channelSamples: apu.channelSamples,
      implicitRet: base.implicitRet,
    },
  };
}

/** Which of a species' notes wrap past 11 bits once the pitch byte is added. */
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

/** The sample rate a noise parameter clocks its LFSR at. Exported because the
 *  old implementation read only three bits of the parameter and every note in
 *  the corpus came out at the same rate, which is the kind of thing only a
 *  measurement catches. */
export function noiseClockHz(param) {
  let shift = (param >> 4) & 0xf;
  if (shift > 0x0d) shift &= 0x0d;
  const divider = param & 0x7;
  return SYNTH_RATE / (2 * (divider === 0 ? 0.5 : divider) * (1 << (shift + 1)));
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