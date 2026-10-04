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
 * A page check can confirm that the DOM says "38 base cries". It cannot confirm
 * that pressing play produces anything resembling the cry. gb-apu.js is a pure
 * function from two generated JSON files to a Float32Array, so it can be run in
 * Node and compared against facts that were published independently of this
 * project. That is what makes the claims on the page checkable rather than
 * merely stated, and it is why this file asserts on SAMPLES and not on strings:
 *
 *   - Charizard and Rhyhorn produce byte-identical PCM. Bulbapedia lists them
 *     as one of the two identical pairs, and "identical" is a stronger claim
 *     than "same base cry" -- it means the base, the pitch byte and the length
 *     byte all match.
 *   - Poliwag and Ditto likewise.
 *   - Charizard and Rhyhon do NOT. Rhyhon is a different Pokémon (id 112) on a
 *     different base cry, and it shares only its pitch and length with
 *     Charizard. The two names are confused constantly in Chinese retellings of
 *     this fact, so the negative case is asserted here rather than left to a
 *     reader.
 *   - Caterpie's first pulse channel is 0.0712 s shorter than Goldeen's, against
 *     Bulbapedia's published 0.071 s. Note that this is Ch5's span and not the
 *     whole cry: base 22's three channels run 34, 35 and 32 frames, so the total
 *     length gap is 0.0733 s and only Ch5 reproduces the published figure. Both
 *     numbers are asserted, because a page that quotes one of them should say
 *     which.
 *   - Machop's first note is a lower pitch than Omanyte's, by the amount the
 *     registers predict.
 *   - The one sound_loop in the corpus doubles its channel.
 *   - All 151 species render to finite, in-range audio of plausible length.
 *
 * THE FRAME RATE IS PINNED BECAUSE A PUBLISHED NUMBER DEPENDS ON IT
 *
 * The note frame is 1/59.7275 s — the NTSC rate, not a round 60. That is not
 * pedantry: Caterpie's and Goldeen's gap is 34 * 0.125 / FRAME_HZ, which is
 * 0.07083 s at 60 Hz and 0.07116 s at 59.7275 Hz, and Bulbapedia prints 0.071.
 * Rounding the frame rate to 60 is the kind of tidy-up that silently invalidates
 * the one external figure available to check against.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GbApu, renderSpeciesCry, lengthMultiplier, frequencyHz, shiftedRegister,
  wrappedNotes, packDuty, groupByBaseCry, FRAME_HZ, SYNTH_RATE,
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
  ok(Math.abs(got - want) <= tol,
    `${what} (${got.toFixed(5)} vs ${want} ±${tol})`);

const cries = read('assets/data/gen1_cries.json');
const sfx = read('assets/data/gen1_cry_sfx.json');
const page = readFileSync(join(ROOT, 'cries-gen1.html'), 'utf8');
const apuSrc = readFileSync(join(ROOT, 'assets/js/gb-apu.js'), 'utf8');

const row = (id) => cries.cries.find((c) => c.id === id);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------
// The two formats the ROM and the documentation disagree about.
// ---------------------------------------------------------------------------

eq(packDuty([2, 0, 2, 0]), 0x88,
  'a duty pattern of 2-0-2-0 packs to $88, the example the reference article works through');
eq(lengthMultiplier(0x00).multiplier, 256, 'a length byte of 0 means no stretch');
eq(lengthMultiplier(0x80).multiplier, 128, '0x80 is the fast end, 128/256 = twice as fast');
eq(lengthMultiplier(0x7f).multiplier, 383, '0x7F is the slow end, 383/256 = about 1.5x longer');
eq(lengthMultiplier(0xff).signed, -1, '0xFF reads as the signed value -1, not +255');
near(FRAME_HZ, 59.7275, 1e-9, 'the note frame is the NTSC rate');
ok(Number.isFinite(SYNTH_RATE / FRAME_HZ) && SYNTH_RATE / FRAME_HZ > 0,
  'a note frame is a whole number of samples at the synthesis rate, not a rounded one');

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

// The generalisation: no two DISTINCT base cries may produce the same audio,
// or "38 base cries" is a claim about labels rather than about sound.
const bases = [...new Set(cries.cries.map((c) => c.sfx))];
eq(bases.length, 38, 'the 151 species use 38 distinct base cries');
const fingerprints = new Map();
let duplicateBases = [];
for (const name of bases) {
  const probe = renderSpeciesCry(cries, sfx, row(cries.cries.find((c) => c.sfx === name).id).id,
    { muted: { 8: true }, pitchShift: false });
  const key = probe.samples.length + ':' + probe.samples[0] + ':' +
    probe.samples[probe.samples.length >> 1] + ':' + probe.samples[probe.samples.length - 1];
  if (fingerprints.has(key)) duplicateBases.push([fingerprints.get(key), name]);
  fingerprints.set(key, name);
}
eq(duplicateBases, [], 'no two of the 38 base cries render the same audio');

/** Every pair that shares all three bytes is exactly one of the two published
 *  pairs, and nothing else collides. */
const triples = new Map();
for (const c of cries.cries) {
  const key = `${c.sfx}|${c.pitch}|${c.length}`;
  if (!triples.has(key)) triples.set(key, []);
  triples.get(key).push(c.id);
}
const collisions = [...triples.entries()].filter(([, ids]) => ids.length > 1);
eq(collisions.map(([k, ids]) => ids.length),
  [2, 2], 'exactly two groups of species share a base, pitch and length together');
const pairIds = collisions.flatMap(([, ids]) => ids).sort((a, b) => a - b);
eq(pairIds, [6, 60, 111, 132],
  'and those four species are Charizard, Poliwag, Rhyhorn and Ditto');

// ---------------------------------------------------------------------------
// The near-identical pairs, against Bulbapedia's published figures.
// ---------------------------------------------------------------------------

const ch5Frames = (id) => {
  const r = row(id);
  const ch = sfx.sfx[r.sfx].channels.find((c) => c.ch === 5);
  return ch.commands.filter((x) => x.op === 'pulse').reduce((a, x) => a + x.frames, 0);
};
const ch5Span = (id) =>
  ch5Frames(id) * lengthMultiplier(row(id).length).stretch / FRAME_HZ;

near(ch5Span(118) - ch5Span(10), 0.071, 0.0005,
  "Caterpie's first pulse channel is 0.071 s shorter than Goldeen's, as published");

// The other number, because a page quoting one should know it differs.
const totalGap = renderSpeciesCry(cries, sfx, 118).meta.duration -
  renderSpeciesCry(cries, sfx, 10).meta.duration;
near(totalGap, 0.0733, 0.0005,
  'the whole-cry gap is 0.0733 s, since base 22\'s second pulse channel runs a frame longer');

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
near(oHz - mHz, 6.1, 0.5, 'by about 6 Hz');

/* The register arithmetic is not the sound. A duty pattern that steps once per
 * SAMPLE instead of once per quarter period leaves every frequency assertion in
 * this file exactly as true as before while turning each note into broadband
 * noise -- the same trap as a feature extractor that returns a constant column.
 * So one note is synthesised and its spectrum measured.
 *
 * Goertzel at a handful of exact frequencies rather than an FFT: this only needs
 * to know whether the fundamental dominates its own harmonics, and a DFT at ten
 * known bins is both smaller and free of windowing choices. */
function goertzel(samples, hz, rate) {
  const k = Math.round((samples.length * hz) / rate);
  const w = (2 * Math.PI * k) / samples.length;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / samples.length;
}

/* A NON-uniform duty on purpose. An earlier version of this probe used
 * [2,2,2,2] — 50% throughout — and therefore could not tell a correct
 * quarter-period duty walk from a per-sample one at all, because every slot held
 * the same value and reordering them changes nothing. The interesting case is
 * the alternating one, which is what the corpus actually uses (cry00's Ch5 is
 * 3,3,0,0). */
const probeBase = {
  base: 0, files: [], implicitRet: [],
  channels: [
    { ch: 5, commands: [{ op: 'duty', pattern: [3, 3, 0, 0] }, { op: 'pulse', frames: 16, volume: 15, sweep: 0, freq: 1601 }, { op: 'ret' }] },
    { ch: 6, commands: [{ op: 'ret' }] },
    { ch: 8, commands: [{ op: 'ret' }] },
  ],
};
const probeHz = frequencyHz(shiftedRegister(1601, 238));
const probeOut = new GbApu(probeBase, { pitch: 238, length: 128, muted: { 6: true, 8: true } }).render();
const probeFundamental = goertzel(probeOut, probeHz, SYNTH_RATE);
const probeThird = goertzel(probeOut, probeHz * 3, SYNTH_RATE);
const probeBetween = goertzel(probeOut, probeHz * 1.5, SYNTH_RATE);
/* A 50% duty square wave has a third harmonic of exactly one third its
 * fundamental, so ~3x is what correct looks like and anything near 1x is a
 * waveform that has lost its shape. Asserting "more than 5x" would have failed
 * on a perfectly good square wave. */
ok(probeFundamental > probeThird * 2,
  `the rendered waveform's third harmonic is the square wave's expected third of the fundamental (${probeFundamental.toFixed(4)} vs ${probeThird.toFixed(4)})`);
ok(probeFundamental > probeBetween * 20,
  'and dominates the energy between harmonics, which a randomised duty would not');
ok(Math.abs(probeHz - 627.1) < 0.5, `the probe note is the ${probeHz.toFixed(1)} Hz its register predicts`);

// ---------------------------------------------------------------------------
// The documented overflow, because it is the page's best teaching case.
// ---------------------------------------------------------------------------

eq(row(60).pitch, 255, "Poliwag's pitch byte is the maximum");
const poliwagWraps = wrappedNotes(sfx.sfx[row(60).sfx], 255);
ok(poliwagWraps.length > 0, "Poliwag's notes wrap past 11 bits once the pitch is added");
const first = sfx.sfx[row(60).sfx].channels.find((c) => c.ch === 5)
  .commands.find((x) => x.op === 'pulse');
ok(first.freq + 255 >= 0x7ff,
  'its first note lands on the 11-bit ceiling, which is not an audible frequency');
ok(frequencyHz(shiftedRegister(1920, 255)) < 100,
  'while a note at 1920 wraps past it and lands under 100 Hz');

/* The wrap has to be asserted on the REGISTER, not merely on the helper that
 * reports a wrap is due. `wrappedNotes()` only looks at whether the sum exceeds
 * 11 bits, so it keeps reporting the same thing whether or not the register
 * actually masks -- a checker that trusted it would pass with the wrap deleted.
 */
const wrapping = shiftedRegister(1920, 255);
ok(wrapping < 1920,
  'and the register genuinely wraps DOWN, rather than carrying on past 11 bits');
ok(shiftedRegister(100, 50) === 150, 'while a shift that fits is left alone');

// ---------------------------------------------------------------------------
// The one loop, the six missing terminators, and all 151 renders.
// ---------------------------------------------------------------------------

const loops = bases.flatMap((name) => sfx.sfx[name].channels
  .flatMap((ch) => ch.commands.filter((c) => c.op === 'loop').map((l) => ({ name, ch: ch.ch, l }))));
eq(loops.map((x) => `${x.name}/Ch${x.ch} x${x.l.count}`), ['SFX_CRY_0D/Ch5 x2'],
  'the corpus still contains exactly one sound_loop');

const looped = new GbApu(sfx.sfx.SFX_CRY_0D, { pitch: row(96).pitch, length: row(96).length });
const planned = looped.plan();
const unloopedSpan = ch5Frames(96) * lengthMultiplier(row(96).length).stretch / FRAME_HZ;
near(planned.channelEnds.get(5) / unloopedSpan, 2, 0.02,
  'that loop plays its channel twice, which is what count 2 means');

const implicit = bases.flatMap((name) =>
  sfx.sfx[name].implicitRet.map((ch) => ({ name, ch })));
eq(implicit.length, 6, 'six channels upstream still have no sound_ret');

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
  // The normalised peak, not the samples. Samples can only exceed 1.0 if the
  // render CLIPS them, and a clipped file still satisfies any "within range"
  // assertion -- so the thing worth checking is that the mix never had to clip.
  if (!(r.meta.peak <= 1.0001)) clipped.push(c.id);
}
eq(bad, 0, 'all 151 species render finite, in-range audio');
eq(clipped, [], 'and none of them needed clipping to fit, so no cry loses its shape to a limiter');
ok(minDur > 0.1 && maxDur < 4,
  `every cry is a plausible length (${minDur.toFixed(3)}s to ${maxDur.toFixed(3)}s)`);

/* One note per slot, per channel. A planner that runs a channel twice emits each
 * note twice, and because the render's note cursor walks forward monotonically it
 * silently discards the duplicates -- the audio comes out right and the bug is
 * invisible. Only the note list itself shows it. */
const overlap = [];
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  const byChannel = new Map();
  for (const n of r.notes) {
    if (!byChannel.has(n.ch)) byChannel.set(n.ch, []);
    byChannel.get(n.ch).push(n);
  }
  for (const [ch, list] of byChannel) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end - 1e-9) {
        overlap.push(`#${c.id}/Ch${ch}`);
        break;
      }
    }
  }
}
eq(overlap, [], 'no channel emits two notes at once, so each one is planned exactly once');

/* The pitch-shift cancellation is the reason 29 of the 151 cries end in a
 * crash, and it is the one behaviour with no visible sign in the note list unless
 * something asserts it. */
/* A noise note that SPANS the cancellation changes pitch partway through, and
 * that is the crash. Counting notes that merely START after it finds none in
 * this corpus — every noise note begins while a pulse channel is still sounding
 * — which is why this asserts on the overlap rather than on the start. */
let spanning = 0;
let withCancel = 0;
let longest = 0;
let longestId = 0;
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  if (!(r.meta.cancelAt > 0)) continue;
  withCancel++;
  for (const n of r.notes) {
    if (n.ch !== 8) continue;
    if (n.start < r.meta.cancelAt - 1e-9 && n.end > r.meta.cancelAt + 1e-9) {
      spanning++;
      const tail = n.end - r.meta.cancelAt;
      if (tail > longest) { longest = tail; longestId = c.id; }
    }
  }
}
ok(withCancel > 0 && spanning > 0,
  `a noise note spanning the cancellation changes pitch partway (${spanning} of them)`);
ok(longest > 0.02,
  `and the longest such tail is audible, not a rounding artefact (${(longest * 1000).toFixed(0)} ms on #${longestId})`);

/* The check above measures the DATA — that some noise note outlives the pulse
 * channels. It says nothing about whether the APU acts on it, and a synthesiser
 * with the cancellation stubbed out still produces that data. So the wiring is
 * asserted directly: every noise note carries the cancellation time, and no pulse
 * note does. */
let miswired = [];
for (const c of cries.cries) {
  const r = renderSpeciesCry(cries, sfx, c.id);
  if (!(r.meta.cancelAt > 0)) continue;
  for (const n of r.notes) {
    const want = n.ch === 8 ? r.meta.cancelAt : Infinity;
    if (n.cancelTime !== want) miswired.push(`#${c.id}/Ch${n.ch} cancelTime=${n.cancelTime} want ${want}`);
  }
}
eq(miswired, [],
  'every noise note carries the cancellation time and no pulse note does, so the tail actually reverts');

// Muted channels and zero volume must not divide by zero.
const silent = renderSpeciesCry(cries, sfx, 6, { volume: 0 });
ok(silent.samples.every((v) => v === 0), 'a zero volume renders silence rather than NaN');
const allMuted = renderSpeciesCry(cries, sfx, 6, { muted: { 5: true, 6: true, 8: true } });
ok(allMuted.samples.every((v) => v === 0),
  'muting all three channels renders silence rather than dividing by a zero peak');

// ---------------------------------------------------------------------------
// The page's claims, which have to agree with all of the above.
// ---------------------------------------------------------------------------

const dom = page.slice(page.indexOf('<body'));
ok(/assets\/js\/gb-apu\.js/.test(page), 'the page imports the APU module');
ok(/from '\.\/assets\/js\/gb-apu\.js'/.test(page), 'by a relative path, like every other module here');

const groups = groupByBaseCry(cries, new Map(cries.cries.map((c) => [c.id, { names: { zh: '', en: '' } }])));
eq(groups.length, 38, 'groupByBaseCry returns 38 groups');
eq(groups.reduce((n, g) => n + g.members.length, 0), 151, 'covering all 151 species');

ok(dom.includes('獨角犀牛') && dom.includes('Rhyhorn'), 'the page names Rhyhorn');
ok(dom.includes('鑽角犀獸') && dom.includes('Rhyhon'), 'and Rhyhon, separately');
ok(/兩隻不同的寶可夢/.test(dom),
  'and says outright that they are two different Pokémon, which is the confusion worth pre-empting');
ok(dom.includes('0.071'), 'the page quotes Bulbapedia\'s published 0.071 s');
ok(/65,536/.test(dom) && dom.includes('1,048,576'),
  'the page states both the synthesis rate and the real clock it approximates');
ok(/96,000/.test(dom), 'and why the real clock is unreachable through Web Audio');
ok(/模型/.test(dom), 'the page says the envelope rate is a model rather than a measurement');

// The page must not claim a fidelity it does not have.
ok(!/(逐樣本|位元相同|完全一致|與原機相同)/.test(dom),
  'the page does not claim sample-exact or hardware-identical output');

// The synthesis rate is a real constraint, not a preference, and the reason has
// to survive in the source or someone will "fix" it to 48000.
ok(/96,?000/.test(apuSrc), 'the APU source records the Web Audio sample-rate ceiling');
ok(/59\.7275/.test(apuSrc), 'and pins the NTSC frame rate with its reason');

console.log('');
console.log(`  base cries: ${bases.length}   species: ${cries.cries.length}`);
console.log(`  synthesis rate: ${SYNTH_RATE} Hz   note frame: ${FRAME_HZ} Hz`);
console.log(`  identical pairs: ${collisions.map(([, ids]) => ids.join('=')).join(', ')}`);
console.log(`  Caterpie/Golden Ch5 gap: ${(ch5Span(118) - ch5Span(10)).toFixed(5)} s`);

if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);