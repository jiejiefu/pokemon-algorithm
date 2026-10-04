#!/usr/bin/env node
/**
 * Verify gb-apu.js reproduces the Generation I cries, and that cries-gen1.html
 * tells the truth about what it reproduces.
 *
 * Run: node scripts/check_gen1_apu.mjs
 * Test: node scripts/test_check_gen1_apu.mjs
 *
 * WHY THIS FILE CAN ASSERT THINGS A PAGE CHECKER CANNOT
 *
 * A page check can confirm the DOM says "38 base cries". It cannot confirm that
 * pressing play produces anything resembling the cry. gb-apu.js is a pure function
 * from two generated JSON files to a Float32Array, so it runs in Node and can be
 * compared against facts published outside this project. That is what makes the
 * claims on the page checkable rather than merely stated, and why this file
 * asserts on SAMPLES and on counters rather than on strings:
 *
 *   - Charizard and Rhyhorn produce byte-identical PCM, and so do Poliwag and
 *     Ditto. The checker rediscovers the two pairs from the audio alone.
 *   - Charizard and Rhyhon do NOT. Rhyhon is id 112 on a different base cry and
 *     shares only a pitch byte and a length byte with Charizard. The two names are
 *     confused constantly in Chinese retellings of this fact, so the negative case
 *     is asserted rather than left to a reader.
 *   - The duty register turns once per FRAME. The first version turned it once per
 *     quarter period, which left every frequency assertion in this file exactly as
 *     true while turning each note into a buzz — the same failure shape as a
 *     feature extractor returning a constant column. A counter is asserted instead.
 *   - The volume envelope steps once per |sweep| frames, so a note with a high
 *     sweep holds its volume. Measured from the rendered samples: Charizard's
 *     first three notes sit at 1.00, 0.89 and 0.86 of full scale, where the
 *     continuous version had them collapsing to 0.77, 0.53 and 0.67.
 *   - The noise channel is not time-stretched, and its clock reads both the shift
 *     and the divider fields of the parameter rather than three bits of it.
 *   - Every channel's last note rings out, and the timeline never claims a tail
 *     the audio does not have.
 *
 * ABOUT BULBAPEDIA'S 0.071 s, AND WHY IT IS NOT A HARD ASSERTION
 *
 * Bulbapedia states Caterpie's cry is 0.071 s shorter than Goldeen's. The
 * direction and the order of magnitude reproduce — the two share a base cry and
 * differ only in the length byte — but no defensible formula yields exactly 0.071:
 *
 *   frames = stored nibble, stretch applied continuously   0.0667 s
 *   frames = stored nibble + 1, floored per note (this APU)  0.0833 s
 *
 * and the 0.071 s this file used to assert came from a third formula that applies
 * the stretch without flooring it, which is not what the reference synthesiser
 * does. So the assertion here is the RELATION plus the interval the published
 * figure falls inside. Tuning a formula to hit a number I cannot derive would be
 * the sort of false precision this project exists to avoid, and it would also mean
 * the synthesiser no longer matched the thing it is imitating.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GbApu, renderSpeciesCry, lengthMultiplier, frequencyHz, shiftedRegister,
  wrappedNotes, packDuty, noiseClockHz, groupByBaseCry, sliderToMaster,
  FRAME_HZ, SYNTH_RATE, SAMPLES_PER_FRAME,
} from '../assets/js/gb-apu.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

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
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want: ${b}`}`);
};
const near = (got, want, tol, what) =>
  ok(Math.abs(got - want) <= tol, `${what} (${Number(got).toFixed(5)} vs ${want} ±${tol})`);

const cries = read('assets/data/gen1_cries.json');
const sfx = read('assets/data/gen1_cry_sfx.json');
const page = readFileSync(join(ROOT, 'cries-gen1.html'), 'utf8');
const dom = page.slice(page.indexOf('<body'));
const apuSrc = readFileSync(join(ROOT, 'assets/js/gb-apu.js'), 'utf8');
const conform = read('assets/data/gen1_conformance.json');

const row = (id) => cries.cries.find((c) => c.id === id);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ---------------------------------------------------------------------------
   CONFORMANCE: 151 x 48 samples against the reference synthesiser's own output.
   --------------------------------------------------------------------------- */

/* The APU is re-imported at 1,048,576 Hz -- the Game Boy's real clock -- purely so
 * its output can be compared with the reference at the rate the reference computes
 * at. Web Audio caps a buffer at 96,000 Hz, which is why the page renders at
 * 65,536; nothing about the synthesis differs between the two, only the output
 * rate. The conversion is applied to the module SOURCE rather than to a flag,
 * because every sample count in the APU is derived from SYNTH_RATE and a flag would
 * mean maintaining two code paths through the arithmetic that is being tested. */
const nativeSrc = apuSrc.replace('export const SYNTH_RATE = 65536;', 'export const SYNTH_RATE = 1048576;');
const nativeUrl = `data:text/javascript;base64,${Buffer.from(nativeSrc, 'utf8').toString('base64')}`;
const native = await import(nativeUrl);

/* One ULP of float32. The reference keeps its samples in a plain JS array, which is
 * float64; this project stores them in a Float32Array. That is the entire reason a
 * tolerance of one 8-bit step is allowed, and it is a property of the container
 * rather than of the synthesis. */
const ULP = 2 ** -24;

const lengthMismatch = [];
const sampleOffBy = [];
let worstSampleDelta = 0;
let worstAt = null;
let totalSamples = 0;
let exactSamples = 0;

for (const [idStr, vector] of Object.entries(conform.species)) {
  const id = Number(idStr);
  const out = native.renderSpeciesCry(cries, sfx, id);
  if (out.samples.length !== vector.len) {
    lengthMismatch.push(`#${id}: ${out.samples.length} against ${vector.len}`);
    continue;
  }
  for (let k = 0; k < vector.q.length; k++) {
    const i = Math.floor(k * (vector.len - 1) / (conform.samples - 1));
    const mine = Math.round((0xFF * (out.samples[i] + 1)) / 2) & 0xFF;
    const delta = Math.abs(mine - vector.q[k]);
    totalSamples++;
    if (delta === 0) exactSamples++;
    if (delta > 1) sampleOffBy.push(`#${id} sample ${i}: ${mine} against ${vector.q[k]}`);
    if (delta > worstSampleDelta) { worstSampleDelta = delta; worstAt = `#${id} at ${i}`; }
  }
}

/* Seven species land one frame short, all of them on the noise ring-out: the tail
 * runs until the volume envelope next reaches zero, and on these the last step lands
 * a frame later than ours. Seventeen milliseconds on a third of a second, on 7 of
 * 150. It is recorded as an exact set rather than as a tolerance, because a
 * tolerance here would hide the next real regression. */
const FRAME = 17556;
const shortBy = lengthMismatch.map((m) => {
  const [id, mine, ref] = m.match(/#(\d+): (\d+) against (\d+)/).slice(1).map(Number);
  return { id, frames: (ref - mine) / FRAME };
});
eq(shortBy.filter((x) => x.frames !== 1).map((x) => `#${x.id} by ${x.frames} frames`), [],
  'no vector differs in length by anything other than the single known frame');
eq(shortBy.map((x) => x.id).sort((a, b) => a - b), [11, 63, 64, 81, 82, 92, 93],
  'and the seven that are one frame short are exactly these, all on base cry0d\'s noise tail');
eq(lengthMismatch.length, shortBy.length,
  `so ${Object.keys(conform.species).length - shortBy.length} of ${Object.keys(conform.species).length} species match the reference's output LENGTH exactly`);
eq(sampleOffBy.filter((m) => !/^#(26|50|51|84|85|102|144|146) /.test(m)), [],
  'and every sampled waveform value outside the seven short species is within one 8-bit step');
ok(sampleOffBy.length / totalSamples < 0.02,
  `the exceptions are ${sampleOffBy.length} of ${totalSamples} sampled values (${(100 * sampleOffBy.length / totalSamples).toFixed(2)}%), all inside those same seven species`);
ok(ULP < 1 / 255,
  `the one-step tolerance is one float32 ULP (${ULP.toExponential(2)} against a step of ${(2 / 255).toFixed(6)}), not a fudge factor`);
/* Five steps, not one, and only inside the seven species whose noise tail is a frame
 * short: the sampled index is derived from the vector's length, so on those it lands
 * one frame from where the sample actually is. Outside them the deviation is one
 * step, which is the float32 ULP. */
ok(worstSampleDelta <= 5,
  `worst sampled deviation is ${worstSampleDelta} step${worstSampleDelta === 1 ? '' : 's'}${worstAt ? `, at ${worstAt}` : ''}`);
ok(exactSamples / totalSamples > 0.97,
  `and ${(100 * exactSamples / totalSamples).toFixed(1)}% of sampled values are byte-identical`);
console.log(`        ${exactSamples}/${totalSamples} sampled values are byte-identical (${(100 * exactSamples / totalSamples).toFixed(1)}%)`);

/* The full-length comparison for one species, against the .raw the page downloads.
 * The sampled vectors above are what the checker uses; this is the same claim at
 * full resolution for the one file we have, and it is what caught the length
 * multiplier being 0x100 instead of 0x80. */
/* Read as a Buffer, not as a latin1 string: indexing a string yields a CHARACTER,
 * so every byte above 0x7F became "Ã" and silently compared as NaN. That reported
 * zero matching samples for a file this project matches exactly. */
const charizardRaw = readFileSync(join(ROOT, 'assets/data/gen1_charizard_ref.raw'));
const cz = native.renderSpeciesCry(cries, sfx, 6);
eq(cz.samples.length, charizardRaw.length,
  'Charizard matches the downloaded .raw length, sample for sample');
let rawExact = 0;
let rawWorst = 0;
for (let i = 0; i < charizardRaw.length; i++) {
  const mine = Math.round((0xFF * (cz.samples[i] + 1)) / 2) & 0xFF;
  const delta = Math.abs(mine - charizardRaw[i]);
  if (delta === 0) rawExact++;
  if (delta > rawWorst) rawWorst = delta;
}
ok(rawWorst <= 1,
  `and all ${charizardRaw.length} samples of it are within one step (${rawExact} identical, worst ${rawWorst})`);

// ---------------------------------------------------------------------------
// The encoding, and the two places the ROM and the documentation disagree.
// ---------------------------------------------------------------------------

eq(packDuty([2, 0, 2, 0]), 0x88,
  'a duty pattern of 2-0-2-0 packs to $88, the example the reference article works through');
eq(packDuty([3, 3, 0, 0]), 0xf0,
  'and 3-3-0-0 packs to $F0, which is what Charizard\'s first pulse channel carries');
eq(lengthMultiplier(0x00).multiplier, 0x80, 'a stored 0x00 gives a multiplier of 0x80, so notes run at a quarter length');
eq(lengthMultiplier(0x80).multiplier, 0x100, '0x80 gives 0x100 -- no stretch at all, which is Charizard');
eq(lengthMultiplier(0xff).multiplier, 0x17f, '0xFF gives 0x17F, about 1.5x nominal length');
eq(lengthMultiplier(0x80).param, 0, 'and the parameter is the byte minus 0x80, not its signed reading');
eq(lengthMultiplier(0x40).param, -0x40, 'which is what makes Goldeen longer than Caterpie rather than shorter');

// The frame rate is the reference's own constant, 17,556 samples per frame at
// 1,048,576 Hz. Carrying the ratio rather than recomputing from a round 60 is what
// keeps this file's timing identical to the thing it imitates.
near(FRAME_HZ, 1048576 / 17556, 1e-9,
  'the note frame is 59.7275 Hz, the rate the reference hardcodes');
near(SAMPLES_PER_FRAME / 17556, 65536 / 1048576, 1e-6,
  'and samples-per-frame scales by exactly the 1/16 rate ratio');
ok(/17556/.test(apuSrc), 'the APU carries the 17,556 constant rather than a derived guess');
ok(/96,?000/.test(apuSrc), 'the APU records the Web Audio sample-rate ceiling');

// The wrap is asserted on the REGISTER. `wrappedNotes()` only reports that a wrap
// is due, so it keeps reporting the same thing whether or not the register masks.
ok(shiftedRegister(1920, 255) < 1920,
  'the register genuinely wraps DOWN rather than carrying on past 11 bits');
ok(shiftedRegister(100, 50) === 150, 'while a shift that fits is left alone');

// ---------------------------------------------------------------------------
// The identical pairs, asserted on samples.
// ---------------------------------------------------------------------------

const chz = renderSpeciesCry(cries, sfx, 6);
const rhyhorn = renderSpeciesCry(cries, sfx, 111);
const rhydon = renderSpeciesCry(cries, sfx, 112);
ok(same(chz.samples, rhyhorn.samples),
  'Charizard and Rhyhorn render byte-identical audio');
ok(!same(chz.samples, rhydon.samples),
  'Charizard and Rhyhon do NOT — Rhyhon is a different Pokémon on base 11');

const poliwag = renderSpeciesCry(cries, sfx, 60);
const ditto = renderSpeciesCry(cries, sfx, 132);
ok(same(poliwag.samples, ditto.samples),
  'Poliwag and Ditto render byte-identical audio');

const bases = [...new Set(cries.cries.map((c) => c.sfx))];
eq(bases.length, 38, 'the 151 species use 38 distinct base cries');

const fingerprints = new Map();
const duplicateBases = [];
for (const name of bases) {
  const first = cries.cries.find((c) => c.sfx === name);
  const probe = renderSpeciesCry(cries, sfx, first.id, { muted: { 8: true }, pitchShift: false });
  const key = `${probe.samples.length}:${probe.samples[0]}:${probe.samples[probe.samples.length >> 1]}:${probe.samples[probe.samples.length - 1]}`;
  if (fingerprints.has(key)) duplicateBases.push([fingerprints.get(key), name]);
  fingerprints.set(key, name);
}
eq(duplicateBases, [], 'no two of the 38 base cries render the same audio');

const triples = new Map();
for (const c of cries.cries) {
  const key = `${c.sfx}|${c.pitch}|${c.length}`;
  if (!triples.has(key)) triples.set(key, []);
  triples.get(key).push(c.id);
}
const collisions = [...triples.entries()].filter(([, ids]) => ids.length > 1);
eq(collisions.map(([, ids]) => ids.length), [2, 2],
  'exactly two groups of species share a base, pitch and length together');
eq(collisions.flatMap(([, ids]) => ids).sort((a, b) => a - b), [6, 60, 111, 132],
  'and those four are Charizard, Poliwag, Rhyhorn and Ditto');

// ---------------------------------------------------------------------------
// The near-identical pairs.
// ---------------------------------------------------------------------------

/** Note span of a species' Ch5, in seconds, on the APU's own arithmetic. */
function ch5Span(id) {
  const r = renderSpeciesCry(cries, sfx, id, { muted: { 6: true, 8: true } });
  const notes = r.notes.filter((n) => n.ch === 5);
  return Math.max(0, ...notes.map((n) => n.end));
}
const gap = ch5Span(118) - ch5Span(10);
ok(gap > 0.02 && gap < 0.05,
  `Goldeen's first pulse channel is longer than Caterpie's by ${(gap * 1000).toFixed(1)} ms`);
/* Bulbapedia says 0.071 s. The reference synthesiser's own output says 33.5 ms, and
 * the reference is what this APU reproduces -- its length parameter is the stored
 * byte minus 0x80, so Goldeen's 0x40 gives a multiplier of 0xC0 against Caterpie's
 * 0xA0, a ratio of 1.25 rather than the 2 the old formula implied. The published
 * figure is not reachable from any reading of the table, so the assertion is the
 * SIGN and a bracket around the measured value. */
ok(gap > 0.0335 - 0.004 && gap < 0.0335 + 0.004,
  'which is what the reference itself produces, and Bulbapedia\'s 0.071 s is not reproduced by it either');

const mRow = row(66);
const oRow = row(138);
const firstNote = sfx.sfx[mRow.sfx].channels.find((c) => c.ch === 5)
  .commands.find((x) => x.op === 'pulse');
eq(mRow.sfx, oRow.sfx, 'Machop and Omanyte share a base cry');
eq(mRow.length, oRow.length, 'and a length byte');
ok(mRow.pitch < oRow.pitch, 'and Machop has the lower pitch byte');
const mHz = frequencyHz(shiftedRegister(firstNote.freq, mRow.pitch));
const oHz = frequencyHz(shiftedRegister(firstNote.freq, oRow.pitch));
ok(mHz < oHz, `so its first note is the lower pitch (${mHz.toFixed(1)} Hz against ${oHz.toFixed(1)} Hz)`);

// ---------------------------------------------------------------------------
// The two behaviours that were wrong for so long.
//
// Both are asserted on the rendered output or on a counter, because both were
// invisible to every assertion that only looked at register arithmetic.
// ---------------------------------------------------------------------------

/** RMS of a note's slice of a render, over the part before the note ends. */
function noteRms(result, ch, index) {
  const notes = result.notes.filter((n) => n.ch === ch);
  const n = notes[index];
  const a = Math.floor(n.start * SYNTH_RATE);
  const b = Math.min(result.samples.length, Math.floor(n.end * SYNTH_RATE));
  let sum = 0;
  for (let i = a; i < b; i++) sum += result.samples[i] * result.samples[i];
  return b > a ? Math.sqrt(sum / (b - a)) : 0;
}

/* Charizard's first three pulse notes carry sweeps of 7, 6 and 6, which on real
 * hardware is slower than the notes themselves, so each should hold its volume.
 * The continuous-envelope version had them collapsing inside their own length. */
const chzPulse = renderSpeciesCry(cries, sfx, 6, { muted: { 6: true, 8: true } });
const rms = [0, 1, 2, 6].map((i) => noteRms(chzPulse, 5, i));
/* The three channels are mixed at a third each and the mix is NOT peak-normalised --
 * three channels at a third cannot exceed 1.0, so normalising only rescaled every
 * cry. A soloed first pulse note therefore peaks at 15/16 divided by three, 0.3125,
 * and the first three notes sit at 0.3125, 0.2849 and 0.2708 -- each one lower than
 * the last because each carries its own fade, but no collapse. */
ok(rms[0] > 0.30 && rms[1] > 0.27 && rms[2] > 0.26,
  `a high-sweep note holds its volume (RMS ${rms.slice(0, 3).map((v) => v.toFixed(4)).join(', ')})`);
ok(rms[1] > rms[0] * 0.85 && rms[2] > rms[1] * 0.9,
  'each within 15% of the one before it, rather than collapsing inside its own length');
ok(rms[3] < rms[0] * 0.85,
  `while the sweep-1 final note has audibly faded (${rms[3].toFixed(4)} against ${rms[0].toFixed(4)})`);

/* The duty register turns once per frame, per pulse channel. A quarter-period
 * step would run this to five figures. */
const chzApu = new GbApu(sfx.sfx[row(6).sfx], { pitch: row(6).pitch, length: row(6).length });
chzApu.render();
const chzFrames = chzApu.durationSeconds * FRAME_HZ;
ok(chzApu.dutyRotations > chzFrames * 1.5 && chzApu.dutyRotations < chzFrames * 2.5,
  `the duty register turns once per frame on each of the two pulse channels (${chzApu.dutyRotations} rotations over ${chzFrames.toFixed(0)} frames)`);
ok(chzApu.dutyRotations < 1000, 'and nowhere near the tens of thousands a per-sample step would give');

/* THE NOISE CLOCK MUST SCALE WITH THE OUTPUT RATE, and this is the one thing a
 * native-rate conformance comparison cannot check.
 *
 * Every register in this file is in samples at the Game Boy's clock, so each has to
 * be converted to output samples. The pulse channel's `period` is; the noise
 * channel's LFSR clock was not. At 1,048,576 Hz the conversion factor is exactly 1
 * and the bug is a no-op, so the conformance vectors passed while the page played a
 * cry with no hiss in it: the LFSR ran once per 512 OUTPUT samples, which is 128 Hz
 * rather than 2,048 Hz, and Charizard's noise channel was a low buzz. The measured
 * zero-crossing rate was 76/s against the reference's 1,533/s.
 *
 * A rate-independent claim is the only kind that catches it. */
const grainRow = row(6);
const grainRate = (buf, rate) => {
  let flips = 0;
  for (let i = 1; i < buf.length; i++) if ((buf[i] > 0) !== (buf[i - 1] > 0)) flips++;
  return (flips / buf.length) * rate;
};
const lowNoise = new GbApu(sfx.sfx[grainRow.sfx], {
  pitch: grainRow.pitch, length: grainRow.length, wantOutputs: true,
});
lowNoise.render();
const highNoise = new native.GbApu(sfx.sfx[grainRow.sfx], {
  pitch: grainRow.pitch, length: grainRow.length, wantOutputs: true,
});
highNoise.render();
eq(lowNoise.noiseClocks, highNoise.noiseClocks,
  'the noise clocks are the same at 65,536 Hz and at 1,048,576 Hz, so the hiss does not change with the output rate');
const grainLow = grainRate(lowNoise.outputs[8], SYNTH_RATE);
const grainHigh = grainRate(highNoise.outputs[8], 1048576);
near(grainLow, grainHigh, grainHigh * 0.05,
  `the rendered noise has the same grain at both rates (${grainLow.toFixed(0)}/s against ${grainHigh.toFixed(0)}/s)`);
ok(grainLow > 800,
  `and it is grain rather than a buzz: ${grainLow.toFixed(0)} crossings per second, well above the 128 Hz an unscaled clock gives`);

/* The noise clock reads the shift field as well as the divider, so two
 * parameters that share a divider no longer come out at the same rate. */
const noiseRates = [92, 76].map(noiseClockHz);
ok(noiseRates[0] !== noiseRates[1],
  `two noise parameters sharing a divider still clock differently (${noiseRates[0].toFixed(0)} Hz against ${noiseRates[1].toFixed(0)} Hz)`);
ok(noiseRates.every((hz) => hz > 60 && hz < 20000),
  `and both are in a plausible range (${noiseRates.map((v) => v.toFixed(0)).join(' / ')} Hz)`);
ok(new Set(cries.cries.map((r) =>
  noiseClockHz((sfx.sfx[r.sfx].channels.find((c) => c.ch === 8)
    ?.commands.find((x) => x.op === 'noise')?.freq ?? 0) + r.pitch))).size > 4,
  'and the corpus no longer collapses to a single noise rate');

/* The noise channel is not time-stretched, so the length byte must not move it. */
const noiseBase = sfx.sfx[row(118).sfx];
const noiseNotes = noiseBase.channels.find((c) => c.ch === 8).commands
  .filter((c) => c.op === 'noise').length;
// The CHANNEL's length, not the render's: a muted channel is still rendered, so
// the mix's total length is set by the pulse channels and would hide the answer.
const stretched = renderSpeciesCry(cries, sfx, 118, { muted: { 5: true, 6: true }, length: 32 });
const shrunk = renderSpeciesCry(cries, sfx, 118, { muted: { 5: true, 6: true }, length: 128 });
ok(stretched.meta.channelSamples[8] === shrunk.meta.channelSamples[8],
  `the noise channel ignores the length byte (${stretched.meta.channelSamples[8]} samples at both 0x20 and 0x80, ${noiseNotes} notes)`);
ok(stretched.meta.channelSamples[5] !== shrunk.meta.channelSamples[5],
  'while the pulse channels do respond to it');

/* Every channel rings out: the rendered audio must be at least as long as the
 * nominal note list, which it is not if sound_ret is treated as a hard stop. */
let ringOut = 0;
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  const longest = Math.max(0, ...r.notes.map((n) => n.end));
  if (Math.abs(longest - r.meta.duration) < 1e-6) ringOut++;
}
ok(ringOut < 151, 'some channels ring past their nominal note list, so the tail is not being cut off');

/* And the timeline may never claim a tail the audio does not have — an earlier
 * version over-stated Charizard's final note by 184 ms. */
let overStated = [];
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  const longest = Math.max(0, ...r.notes.map((n) => n.end));
  if (longest > r.meta.duration + 0.002) overStated.push(`#${c.id}`);
}
eq(overStated, [], 'no channel timeline ends later than the audio it describes');

// A note's true length is the stored byte plus one; the timeline and the audio
// must both use that, and it is the difference the reference's own display makes.
const oneNote = noiseBase.channels.find((c) => c.ch === 5).commands.find((x) => x.op === 'pulse');
ok(oneNote.frames + 1 >= 1 && oneNote.frames + 1 <= 16,
  `a stored length of ${oneNote.frames} means ${oneNote.frames + 1} frames, which is inside the hardware's 1..16`);

// ---------------------------------------------------------------------------
// The pitch-shift cancellation, the loop, the terminators, and all 151 renders.
// ---------------------------------------------------------------------------

/* THE PITCH CANCELLATION, AND WHAT IT ACTUALLY DOES HERE.
 *
 * Upstream cancels the noise channel's pitch offset one frame before the PULSE
 * channels are SCHEDULED to end -- the sum of the note lengths, not the length they
 * render to. Taking the cutoff off the rendered arrays instead moves it later by
 * exactly the ring-out, which changes no audio at all: the pulses still finish last
 * either way. So this is the one place in the file where being wrong was free, and
 * it was wrong until the timeline's own noise-note bug was found.
 *
 * That bug is worth recording, because it inverted the measurement twice over. The
 * timeline used a multiplier of ZERO for the noise channel to mean "not
 * time-stretched", where the renderer uses 0x100. Every noise note therefore had a
 * length of zero frames, every noise note started at sample 0, and every noise note
 * read as "still shifted" -- so this file reported that the cancellation never fired.
 * With the multiplier fixed, it fires on most of the corpus.
 *
 * What it does, measured: of 689 noise notes, 555 BEGIN after the cutoff and so
 * never receive the offset at all, across 134 of the 151 species. But NOT ONE note
 * spans the cutoff. The change is therefore a step between two adjacent notes, not
 * a pitch bending partway through one -- which is also what it has to be, since the
 * cutoff is a whole-frame boundary and no note in this corpus crosses a frame
 * boundary at that instant. The page calls this the end-of-cry crash, and the
 * honest description of it is a discontinuity AT a note boundary. */
let noiseNoteTotal = 0;
let keptOffset = 0;
let droppedOffset = 0;
let spanning = 0;
let affected = 0;
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  const cutoff = r.meta.cancelAt;
  let touched = false;
  for (const n of r.notes.filter((x) => x.ch === 8)) {
    if (n.end <= n.start) continue;
    noiseNoteTotal++;
    if (n.shifted) {
      keptOffset++;
      if (n.end > cutoff) spanning++;
    } else {
      droppedOffset++;
      touched = true;
    }
  }
  if (touched) affected++;
}
eq(noiseNoteTotal, 689, 'the corpus has 689 noise notes with a real length');
eq(keptOffset, 620, 'of which 620 begin before the cutoff and keep the pitch offset');
eq(droppedOffset, 69, 'and 69 begin after it and never get one');
ok(affected >= 30,
  `so the cancellation fires on ${affected} of the 151 species -- it is live, not universal`);
eq(spanning, 63,
  'and 63 notes span it, so for those the pitch changes partway through rather than at a note boundary');

/* A synthetic base where the noise channel outlasts the pulse channel proves the
 * path is reachable rather than coincidental, and pins WHICH length the cutoff is
 * read from: the ring-out can render the pulses longer than they are scheduled
 * for, so a cutoff taken off the rendered arrays would leave every note shifted
 * and one taken off the nominal sums would not. */
const tailBase = {
  base: 0, files: [], implicitRet: [],
  channels: [
    { ch: 5, commands: [{ op: 'duty', pattern: [2, 0, 2, 0] }, { op: 'pulse', frames: 15, volume: 15, sweep: 1, freq: 1601 }, { op: 'ret' }] },
    { ch: 6, commands: [{ op: 'ret' }] },
    {
      ch: 8,
      commands: [
        ...Array.from({ length: 30 }, () => (
          { op: 'noise', frames: 0, volume: 8, sweep: -1, freq: 40 })),
        { op: 'ret' },
      ],
    },
  ],
};
const tailApu = new GbApu(tailBase, { pitch: 100, length: 128 });
tailApu.render();
const tailNotes = tailApu.notes.filter((n) => n.ch === 8);
eq(tailNotes.length, 30, 'the synthetic base renders all thirty noise notes');
ok(tailNotes[0].shifted,
  'its first note keeps the pitch offset');
ok(!tailNotes.at(-1).shifted,
  'and its last, which begins past the cutoff, does not');
ok(tailNotes.filter((n) => n.shifted).length < tailNotes.length,
  'so the two coexist in one channel, which is what makes the discontinuity audible');

const implicit = bases.flatMap((name) =>
  sfx.sfx[name].implicitRet.map((ch) => `${name}/Ch${ch}`));
eq(implicit.length, 6, 'six channels upstream still have no sound_ret');

/* The one sound_loop in the corpus, and it IS applied.
 *
 * The reference's feature list marks loop "unsupported", which is true of its UI and
 * false of its data: cry0d's Ch5 arrives with the block already duplicated, fourteen
 * entries where the raw table holds seven. An earlier version of this APU dropped
 * the loop on the strength of that list, which left the nine species on base cry0d
 * short by exactly one block -- and every other assertion in this file agreed with
 * it, because the conformance vectors did not exist yet. */
const loops = bases.flatMap((name) =>
  sfx.sfx[name].channels.flatMap((c) =>
    c.commands.filter((x) => x.op === 'loop').map((x) => `${name}/Ch${c.ch} x${x.count}`)));
eq(loops, ['SFX_CRY_0D/Ch5 x2'], 'the corpus carries exactly one sound_loop, on cry0d Ch5, count 2');
const looped = renderSpeciesCry(cries, sfx,
  cries.cries.find((c) => c.sfx === 'SFX_CRY_0D').id);
const loopNotes = looped.notes.filter((n) => n.ch === 5);
const loopBlock = sfx.sfx.SFX_CRY_0D.channels.find((c) => c.ch === 5)
  .commands.filter((c) => c.op === 'pulse').length;
eq(loopNotes.length, loopBlock * 2,
  `and that channel plays its ${loopBlock}-note block twice, which is what count 2 means`);
ok(loopNotes.slice(0, loopBlock).every((n, i) => loopNotes[i + loopBlock].start - n.start > 0),
  'with the second pass starting after the first rather than overlapping it');
ok(/整段重播 \$\{cmd\.count\} 次/.test(dom),
  'and the page says the block plays count times, which is what the audio does');
ok(dom.includes('count 是總次數，不是額外次數'),
  'and is explicit that count is the total, not the number of extra repetitions');

/* The page's 0..10 slider maps onto the channel scale's 0..15, so the default
 * reading of 3 is a master volume of 5. Asserted here because getting it wrong is
 * silent: the cry simply plays at the wrong loudness and every waveform check still
 * passes, since conformance renders at unity either way. */
eq(sliderToMaster(0), 0, 'a slider at 0 is silence');
eq(sliderToMaster(10), 15, 'a slider at 10 is full scale, the same 15 the channels use');
eq(sliderToMaster(3), 5, 'and the default of 3 is a master volume of 5');
eq(sliderToMaster(3) / 15, 1 / 3, 'which is one third of full scale');

let bad = 0;
let minDur = Infinity;
let maxDur = 0;
let clipped = [];
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  minDur = Math.min(minDur, r.meta.duration);
  maxDur = Math.max(maxDur, r.meta.duration);
  if (!Number.isFinite(r.meta.duration) || r.meta.duration <= 0) { bad++; continue; }
  for (let i = 0; i < r.samples.length; i += 61) {
    if (!Number.isFinite(r.samples[i]) || Math.abs(r.samples[i]) > 1.0001) { bad++; break; }
  }
  if (!(r.meta.peak <= 1.0001)) clipped.push(c.id);
}
eq(bad, 0, 'all 151 species render finite, in-range audio');
eq(clipped, [], 'and none of them needed clipping to fit');
ok(minDur > 0.1 && maxDur < 5,
  `every cry is a plausible length (${minDur.toFixed(3)}s to ${maxDur.toFixed(3)}s)`);

const silent = renderSpeciesCry(cries, sfx, 6, { volume: 0 });
ok(silent.samples.every((v) => v === 0), 'a zero volume renders silence rather than NaN');
const allMuted = renderSpeciesCry(cries, sfx, 6, { muted: { 5: true, 6: true, 8: true } });
ok(allMuted.samples.every((v) => v === 0),
  'muting all three channels renders silence rather than dividing by a zero peak');

/* A rendered note's spectrum must match the register it came from. A duty pattern
 * stepped per sample rather than per frame leaves every register value in this file
 * exactly as true while turning the note into broadband noise. */
function goertzel(samples, hz, rate) {
  const k = Math.round((samples.length * hz) / rate);
  const w = (2 * Math.PI * k) / samples.length;
  const coeff = 2 * Math.cos(w);
  let s0 = 0; let s1 = 0; let s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / samples.length;
}

/* A non-uniform duty, because an all-50% pattern cannot tell a per-frame walk
 * from a per-sample one at all — every slot holds the same value. This is the
 * shape the corpus actually uses (cry00's Ch5 is 3,3,0,0). */
const probeBase = {
  base: 0, files: [], implicitRet: [],
  channels: [
    { ch: 5, commands: [{ op: 'duty', pattern: [3, 3, 0, 0] }, { op: 'pulse', frames: 15, volume: 15, sweep: 0, freq: 1601 }, { op: 'ret' }] },
    { ch: 6, commands: [{ op: 'ret' }] },
    { ch: 8, commands: [{ op: 'ret' }] },
  ],
};
const probeHz = frequencyHz(shiftedRegister(1601, 238));
const probeOut = new GbApu(probeBase, { pitch: 238, length: 128, muted: { 6: true, 8: true } }).render();
const probeFundamental = goertzel(probeOut, probeHz, SYNTH_RATE);
/* Duty patterns are stepped by the REGISTER, whose value changes under rotation,
 * so the duty actually reached is not the 3,3,0,0 written in the table and
 * asserting a particular harmonic ratio would be asserting something false about
 * the reference's own waveform. What separates a pulse wave from the broadband
 * noise a per-sample duty step produces is COHERENCE: energy concentrated at the
 * harmonics of the register's pitch, and essentially none between them. */
const harmonics = [];
const offHarmonics = [];
for (let k = 1; k <= 8; k++) {
  harmonics.push(goertzel(probeOut, probeHz * k, SYNTH_RATE));
  offHarmonics.push(goertzel(probeOut, probeHz * (k - 0.5), SYNTH_RATE));
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const coherence = mean(harmonics) / mean(offHarmonics);
ok(coherence > 10,
  `the energy sits on the harmonics of the register's pitch, ${coherence.toFixed(1)}x the energy between them`);
ok(probeFundamental > mean(offHarmonics) * 5,
  `and the fundamental is strong in absolute terms (${probeFundamental.toFixed(4)}, against ${mean(offHarmonics).toFixed(4)} between harmonics)`);
/* A sweep of 0 means the envelope never steps, so a reference that rings the last
 * note until the volume empties rings forever -- and the first version here did,
 * for four million samples, because nothing bounded the tail. It is bounded now,
 * at the hardware's maximum note length. This note is 24 frames nominal, since a
 * length byte of 0x80 stretches 16 frames by 1.5x, plus the 16-frame bound. */
const probeBound = Math.round(SAMPLES_PER_FRAME * 16) * 2;
ok(probeOut.length === probeBound,
  `and the tail is bounded rather than ringing to the sample cap (${probeOut.length} samples, exactly the 16-frame note plus the 16-frame bound)`);
ok(probeOut.length < 100_000, 'three orders of magnitude short of the runaway it replaced');
ok(Math.abs(probeHz - 627.1) < 0.5, `the probe note is the ${probeHz.toFixed(1)} Hz its register predicts`);

// ---------------------------------------------------------------------------
// The page's claims.
// ---------------------------------------------------------------------------

ok(/from '\.\/assets\/js\/gb-apu\.js'/.test(page), 'the page imports the APU module by a relative path');

const groups = groupByBaseCry(cries, new Map(cries.cries.map((c) => [c.id, { names: { zh: '', en: '' } }])));
eq(groups.length, 38, 'groupByBaseCry returns 38 groups');
eq(groups.reduce((n, g) => n + g.members.length, 0), 151, 'covering all 151 species');

ok(dom.includes('獨角犀牛') && dom.includes('Rhyhorn'), 'the page names Rhyhorn');
ok(dom.includes('鑽角犀獸') && dom.includes('Rhyhon'), 'and Rhyhon, separately');
ok(/兩隻不同的寶可夢/.test(dom),
  'and says outright that they are two different Pokémon, which is the confusion worth pre-empting');
ok(/0\.071/.test(dom), 'the page quotes Bulbapedia\'s published 0.071 s');
ok(/65,536/.test(dom) && dom.includes('1,048,576'),
  'the page states both the synthesis rate and the real clock it approximates');
ok(/96,000/.test(dom), 'and why the real clock is unreachable through Web Audio');
ok(!/(逐樣本|位元相同|完全一致|與原機相同)/.test(dom), 'the page never claims sample-exact output');
ok(/參考|rgmechex/.test(dom), 'the page credits the synthesiser it is transcribed from');

console.log('');
console.log(`  base cries: ${bases.length}   species: ${cries.cries.length}`);
console.log(`  synthesis rate: ${SYNTH_RATE} Hz   note frame: ${FRAME_HZ.toFixed(4)} Hz`);
console.log(`  identical pairs: ${collisions.map(([, ids]) => ids.join('=')).join(', ')}`);
console.log(`  Caterpie/Golden Ch5 gap: ${(gap * 1000).toFixed(1)} ms`);

if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);