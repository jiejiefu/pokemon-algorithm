#!/usr/bin/env node
/**
 * Prove check_gen1_apu.mjs can actually fail.
 *
 * Run: node scripts/test_check_gen1_apu.mjs
 *
 * These cases mutate the APU rather than the page, because the claims worth
 * guarding here are claims about sound. A checker that has only ever seen the
 * correct synthesiser cannot tell the difference between "asserts the pitch
 * formula" and "asserts a comment about the pitch formula", so every case below
 * breaks the audio path and requires the failure to be named.
 *
 * The expensive cases mutate the two generated JSON files, which means the
 * fixture tree is a few hundred KB rather than a few bytes — that is why there
 * are 34 cases and not forty.
 *
 * Where the time goes, measured here: the checker's native-rate conformance loop
 * is 4.8 s of its 6.5 s, and 17 of the 34 cases below assert something that loop
 * never touches. Those 17 are the reason `stripConformance` exists — see the note
 * on CONFORMANCE_EXPECTS. The baseline always runs the whole checker.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy, failLines } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = [
  'assets/data/gen1_cries.json',
  'assets/data/gen1_cry_sfx.json',
  'assets/data/gen1_conformance.json',
  'assets/data/gen1_charizard_ref.raw',
  'assets/js/gb-apu.js',
  'cries-gen1.html',
  'scripts/check_gen1_apu.mjs',
];
const CHECKER = 'scripts/check_gen1_apu.mjs';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeTree(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'gen1apu-neg-'));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

const editApu = (dir, fn) => {
  const p = join(dir, 'assets/js/gb-apu.js');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
const editPage = (dir, fn) => {
  const p = join(dir, 'cries-gen1.html');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
const editJson = (dir, name, fn) => {
  const p = join(dir, name);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  fn(data);
  writeFileSync(p, JSON.stringify(data));
};

/* ---------------------------------------------------------------------------
   RUNNING A CASE WITHOUT THE 4.8-SECOND CONFORMANCE LOOP
   --------------------------------------------------------------------------- */

/* The checker's conformance section re-imports the APU at 1,048,576 Hz and renders
 * all 151 species there: 4.8 s of the 6.5 s checker, measured here. It is the most
 * valuable thing the checker does and the baseline below always runs it in full —
 * this is only ever applied to a MUTATED fixture, to a COPY of the checker inside a
 * throwaway temp tree. The real scripts/check_gen1_apu.mjs gains no switch, no
 * environment variable and no degraded mode, because a supported way to skip the
 * conformance comparison is exactly how it would stop happening.
 *
 * Only the cases whose `expect` cannot come from that loop are eligible, and the
 * eligibility test is the `expect` string itself rather than a per-case flag — so
 * there is nothing to forget. A case that does not name one of these two strings is
 * asserting something the loop produces, and it runs the whole checker. */
const CONFORMANCE_EXPECTS = new Set([
  'within one 8-bit step',   // eq(sampleOffBy, []) — the 151 x 48 waveform compare
  'LENGTH exactly',          // eq(lengthMismatch, []) — the 151 output lengths
]);

/* The block runs from the accumulator declarations to the next section header, so
 * slicing between the two anchors takes the declarations, the render loop and the
 * four assertions together. Nothing outside it reads any of them. */
const CONFORMANCE_START = 'const lengthMismatch = [];';
const CONFORMANCE_END =
  '// ---------------------------------------------------------------------------\n// The encoding';

/** Cut the native-rate conformance section out of the fixture's COPY of the checker. */
const stripConformance = (dir) => {
  const p = join(dir, CHECKER);
  const src = readFileSync(p, 'utf8');
  const a = src.indexOf(CONFORMANCE_START);
  const b = src.indexOf(CONFORMANCE_END);
  if (a < 0 || b < 0 || b <= a) {
    throw new Error('stripConformance: the anchors moved, so nothing was removed. '
      + 'Leaving the loop in place is safe (the case still runs the full checker '
      + 'and still has to fail), but the speed-up is silently gone.');
  }
  writeFileSync(p, src.slice(0, a) + src.slice(b));
};

const CASES = [
  /* ---- The encoding ---- */
  {
    name: 'the pitch formula loses the 131072 constant, so every note is an octave out',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return 131072 / (2048 - (register & 0x7ff));', 'return 65536 / (2048 - (register & 0x7ff));')),
    expect: 'Hz its register predicts',
  },
  {
    name: 'the pitch shift is dropped, so every species sounds like its unshifted base',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return (register + pitch) & 0x7ff;', 'return register & 0x7ff;')),
    expect: 'within one 8-bit step',
  },
  {
    name: 'the 11-bit wrap is removed, so a high pitch stops wrapping back down',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return (register + pitch) & 0x7ff;', 'return register + pitch;')),
    expect: 'wraps DOWN',
  },
  {
    /* This is the bug that made every cry sound wrong. The parameter is the stored
     * byte MINUS 0x80, not its two's-complement signed reading, and the difference is
     * a third of the note length. */
    name: 'the length parameter reverts to the signed byte, making every note 1.5x too long',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const param = lengthByte - 0x80;', 'const param = lengthByte > 127 ? lengthByte - 256 : lengthByte;')),
    expect: 'LENGTH exactly',
  },
  {
    name: 'the duty register is stored as the pattern array, so `duty & 3` reads as 0',
    mutate: (dir) => editApu(dir, (s) => s
      .replace("if (cmd.op === 'duty') { duty = packDuty(cmd.pattern); continue; }",
        "if (cmd.op === 'duty') { duty = cmd.pattern; continue; }")),
    expect: 'within one 8-bit step',
  },
  {
    name: 'the mix is peak-normalised, which cannot clip but does rescale every cry',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('    this.peak = peak;\n', '    this.peak = peak;\n    if (peak > 0) for (let i = 0; i < total; i++) samples[i] /= peak;\n')),
    expect: 'within one 8-bit step',
  },
  /* The one bug the conformance vectors structurally cannot see: they render at
   * 1,048,576 Hz, where the rate factor is exactly 1. This is here because the
   * symptom was inaudible in every assertion and very audible in the output.
   *
   * Note which assertion detects it. NOT `the noise clocks are the same at
   * 65,536 Hz`: that check still passes, because noiseClocks reports Hz and Hz is
   * a property of the register rather than of the output rate -- which is the whole
   * reason it is recorded in Hz. Only the RENDERED grain moves, 1,533 crossings per
   * second against 76. */
  {
    name: 'the noise LFSR clock is left unscaled, so the hiss becomes a 128 Hz buzz',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const clock = Math.max(1, Math.round(clockHz * SYNTH_RATE / GB_CLOCK));',
        'const clock = Math.max(1, Math.round(clockHz));')),
    expect: 'the same grain at both rates',
  },
  {
    name: 'the noise channel is stopped entirely, so the cry loses its grain',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('out[sampleI] = (out[sampleI] || 0) + sample(1 ^ bit0, vol);',
        'out[sampleI] = (out[sampleI] || 0) + vol / 16;')),
    expect: 'within one 8-bit step',
  },
  {
    name: 'sound_loop is dropped, so the nine species on base cry0d lose a whole block',
    mutate: (dir) => editApu(dir, (s) => s
      .replace("    const loopAt = cmds.findIndex((c) => c.op === 'loop');",
        "    const loopAt = -1;")),
    expect: 'plays its',
  },
  {
    name: 'the stored note length loses its +1, so every note is one frame short',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const subframes = (multiplier * (cmd.frames + 1)) + leftovers;',
        'const subframes = (multiplier * cmd.frames) + leftovers;')),
    expect: 'LENGTH exactly',
  },
  {
    name: 'the fractional carry is thrown away, so a slow sweep rounds away at every note',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('    leftovers = subframes & 0xFF;\n    nominal += sampleCount;', '    leftovers = 0;\n    nominal += sampleCount;')),
    expect: 'LENGTH exactly',
  },

  /* ---- The two behaviours that were wrong for so long, and that every register
     assertion in this file stayed silent about. ---- */
  {
    name: 'the duty register turns once per quarter period instead of once per frame',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('      if (i < sampleCount && sampleI % frameSamples === 0) {',
        '      if (i < sampleCount && i % 4 === 3) {')),
    expect: 'within one 8-bit step',
  },
  {
    name: 'the duty rotation is dropped altogether, so every note holds one waveform',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('        duty = ((duty & 0x3f) << 2) | ((duty & 0xc0) >> 6);\n        rotations++;', '        rotations++;')),
    expect: 'within one 8-bit step',
  },
  {
    name: 'the volume envelope decays continuously instead of stepping every |sweep| frames',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('      if (volfade !== 0 && envelopePeriod > 0 && (i + 1) % envelopePeriod === 0) {\n        vol += volfade < 0 ? 1 : -1;',
        '      if (volfade !== 0 && envelopePeriod > 0 && i % 8 === 0) {\n        vol += volfade < 0 ? 1 : -1;')),
    expect: 'LENGTH exactly',
  },

  /* ---- The noise channel ---- */
  {
    name: 'the noise clock reads only the divider, ignoring the shift field',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('let shift = (params >> 4) & 0xf;', 'let shift = 4;')),
    expect: 'within one 8-bit step',
  },
  {
    /* The renderer and the timeline must agree on the noise multiplier. Giving the
     * renderer a different one is what a stretched noise channel would look like,
     * and it is caught because the timeline's bars would stop lining up. */
    name: 'the noise channel is given a multiplier the timeline does not use',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const subframes = 0x100 * (cmd.frames + 1) + leftovers;',
        'const subframes = 0x180 * (cmd.frames + 1) + leftovers;')),
    expect: 'LENGTH exactly',
  },

  /* ---- Ring-out, which the reference gets by not implementing sound_ret ---- */
  {
    name: 'the ring-out is cut off at the note end, as sound_ret would have it',
    mutate: (dir) => editApu(dir, (s) => s.replaceAll(
      'const cap = isLast && volfade === 0 ? sampleCount + staticTail : Number.POSITIVE_INFINITY;',
      'const cap = sampleCount;')),
    expect: 'LENGTH exactly',
  },
  {
    name: 'the ring-out is left unbounded, so a zero-sweep note runs to the sample cap',
    mutate: (dir) => editApu(dir, (s) => s.replaceAll(
      'const staticTail = Math.round(SAMPLES_PER_FRAME * 16);',
      'const staticTail = Math.round(SAMPLES_PER_FRAME * 40000);')),
    expect: 'bounded rather than ringing to the sample cap',
  },

  /* ---- The pitch cancellation. ---- */
  {
    name: 'the cutoff is taken off the rendered pulse length instead of the nominal sum',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const cutoff = Math.max(0, nominalLongest - Math.round(SAMPLES_PER_FRAME));',
        'const cutoff = Math.max(0, Math.max(pulse1.length, pulse2.length) - Math.round(SAMPLES_PER_FRAME));')),
    expect: 'within one 8-bit step',
  },
  /* This one is free for the TIMELINE, which is why it expects the waveform.
   *
   * The renderer and the timeline both call noiseOffset(), so mutating the
   * renderer's call site leaves every `n.shifted` exactly as it was: the census of
   * notes still reports 620 keeping the offset and 69 without, and both still pass.
   * What changes is the audio, because a note upstream leaves unshifted now carries
   * the offset for the whole of its length and 151 species stop matching the
   * reference. So the detector is `within one 8-bit step`, and this belongs with the
   * conformance cases.
   *
   * It used to declare 'never get one' — text that occurs in the description of a
   * check that PASSES. Nothing caught the drift, because the old matcher only
   * asked whether the string appeared anywhere in the output. See runCase(). */
  {
    name: 'the pitch cancellation is removed, so every noise note keeps its offset',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const offset = noiseOffset(sampleI, cutoffSamples, pitch);', 'const offset = pitch;')),
    expect: 'within one 8-bit step',
  },

  /* ---- The timeline, which drew the noise lane with zero-length notes ---- */
  {
    name: 'the timeline gives noise a zero multiplier, so every noise note has no length',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const multiplier = isNoise ? 0x100 : lengthMultiplier(this.lengthByte).multiplier;',
        'const multiplier = isNoise ? 0x40 : lengthMultiplier(this.lengthByte).multiplier;')),
    expect: 'noise notes with a real length',
  },
  {
    name: 'the timeline over-states the ring-out, so a bar runs past the end of the audio',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('end += Math.max(0, needed - already) * perStep;', 'end += needed * perStep;')),
    expect: 'ends later than the audio',
  },

  /* ---- Mixing ---- */
  {
    name: 'the three channels are summed without dividing by three, so every cry clips',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('samples[i] += buf[i] * master / 3;', 'samples[i] += buf[i] * master;')),
    expect: 'within one 8-bit step',
  },
  {
    name: 'the master volume is not applied, so a zero volume is still audible',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const master = clampVolume(this.masterVolume) / 15;', 'const master = 1;')),
    expect: 'zero volume renders silence',
  },
  /* The page presents the 0..15 channel scale directly, so the master volume is
   * `/ 15` and nothing else — a linear scale. Squaring it is the realistic way to
   * break that: someone reaching for a "more natural" loudness curve. It leaves 0
   * silent, so the zero-volume check passes; it leaves every WAVEFORM identical,
   * because the conformance comparison renders at unity gain either way; and it
   * stays in range, because the curve is normalised at 15. Only measuring the
   * default's peak against full scale's sees it — 0.04 against a fifth.
   *
   * The obvious mutation, `/ 15` to `/ 10`, is NOT this one and is deliberately
   * not used: a full-scale render then asks for a gain of 1.5 and three channels at
   * a third clip, so the checker's `all 151 species render finite, in-range audio`
   * catches it first. That is a real detection, just not the one this case is
   * about — per §4, a case must name the assertion that catches its own defect.
   *
   * Eligible for stripConformance on its own account: neither detector is in that
   * section. */
  {
    name: 'the master volume is curved instead of linear, so the default plays far too quietly',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const master = clampVolume(this.masterVolume) / 15;',
        'const master = (clampVolume(this.masterVolume) / 15) ** 2;')),
    expect: 'renders at one fifth of full scale',
  },
  {
    name: 'a 0..10 to 0..15 conversion is reintroduced, putting the mapping back where it was wrong',
    mutate: (dir) => editApu(dir, (s) => s
      + '\nexport function sliderToMaster(sliderValue) { return clampVolume((sliderValue / 10) * 15); }\n'),
    expect: 'no conversion function survives',
  },

  /* ---- The loop, which the reference lists as unsupported ---- */
  {
    name: 'cry0d is put onto a second base, manufacturing a third identical pair',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      const rhydon = d.cries.find((c) => c.id === 112);
      rhydon.sfx = 'SFX_CRY_04';
      rhydon.pitch = d.cries.find((c) => c.id === 6).pitch;
      rhydon.length = d.cries.find((c) => c.id === 6).length;
    }),
    expect: 'Rhyhon do NOT',
  },
  {
    name: 'one of a pair has its pitch byte changed, so the pair stops matching',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.cries.find((c) => c.id === 111).pitch = 5;
    }),
    expect: 'byte-identical',
  },
  {
    name: 'the six missing terminators are quietly filled in, hiding the upstream quirk',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_02.implicitRet = [];
    }),
    expect: 'six channels upstream still have no sound_ret',
  },

  /* ---- The page's claims ---- */
  {
    name: 'the page stops distinguishing Rhyhorn from Rhyhon',
    mutate: (dir) => editPage(dir, (s) => s.replaceAll('Rhyhon', 'Rhyhorn')),
    expect: 'Rhyhon',
  },
  {
    name: 'the page drops the published 0.071 s it is checked against',
    mutate: (dir) => editPage(dir, (s) => s.replaceAll('0.071', '0.070')),
    expect: '0.071',
  },
  {
    name: 'the page claims sample-exact reproduction',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('與原機相同', '與原機相同').replace(/<body/, '<body><p>位元組相同，完全一致</p>')),
    expect: 'never claims sample-exact',
  },
  {
    /* The fade sign is a DATA bug rather than a code one, and it was invisible in the
     * audio for the same reason the noise clock was: a note whose volume is 0 with a
     * fade OUT stays clamped at 0, so it is silent either way and every length
     * assertion passes. Only the waveform comparison sees it. */
    name: 'a fade of -8 is read as +8, so the fade-in rests become silent',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_0B.channels
        .find((c) => c.ch === 6).commands
        .find((c) => c.op === 'pulse' && c.volume === 0).sweep = 8;
    }),
    expect: 'within one 8-bit step',
  },
  {
    /* The credit has to be a link a reader can follow. Naming the author in prose
     * while dropping the URL leaves nothing to check and nothing to open. */
    name: 'the page names the reference synthesiser but no longer links to it',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('<a href="https://rgmechex.com/tech/gen1cries.html" rel="noopener">rgmechex 的 Generation I Cry Synthesizer</a>', 'rgmechex 的 Generation I Cry Synthesizer')),
    expect: 'links the synthesiser it is transcribed from, by URL',
  },
  {
    name: 'the page keeps a link to the reference but stops saying what the credit is for',
    mutate: (dir) => editPage(dir, (s) => s
      .replace(/方波 duty 暫存器每幀旋轉一次、Volume envelope 只在每 <code>\|sweep\|<\/code> 幀步進一次而不是連續衰減、噪音通道不吃長度位元組的時間縮放、噪音率同時用到參數的兩個欄位、最後一個音符會響到包絡歸零而不是在 <code>sound_ret<\/code> 處硬切。/, '')),
    expect: 'names the behaviours it takes from them',
  },
  {
    name: 'the page puts its own debugging history in front of the reader',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('特別感謝這份網頁的作者。', '特別感謝這份網頁的作者。這幾個 bug 都是先被誤寫、跟它的輸出比對才找出來的。')),
    expect: "does not spend the reader's time on how this page's own synthesis was debugged",
  },
  {
    name: 'the page claims one extra repetition, which count does not mean',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('整段重播 ${cmd.count} 次（count 是總次數，不是額外次數）',
        '整段重播 ${cmd.count - 1} 次')),
    expect: 'count is the total',
  },
  {
    name: 'the APU source loses the 17,556 constant, so a round 60 looks equivalent',
    mutate: (dir) => editApu(dir, (s) => s.replace('export const FRAME_HZ = GB_CLOCK / 17556;', 'export const FRAME_HZ = 60;')),
    expect: 'the reference hardcodes',
  },
  {
    name: 'the APU source loses the reason for the sample rate, so 48000 looks like a cleanup',
    mutate: (dir) => editApu(dir, (s) => s.replace(/96,?000/g, '48000')),
    expect: 'sample-rate ceiling',
  },
];


/* The baseline runs first and on its own: if it fails, every case below would "fail for
 * the right reason" for the wrong reason, and the run is not worth reporting. */
const baseDir = makeTree(null);
const baseline = await new Promise((res) => {
  execFile(process.execPath, [join(baseDir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});
rmSync(baseDir, { recursive: true, force: true });
ok('baseline: the checker passes on an unmutated copy of the tree', baseline.code === 0,
  baseline.code === 0 ? '' : baseline.out.split('\n').slice(-8).join('\n'));
if (baseline.code !== 0) process.exit(1);

/* And it is run a SECOND time with the conformance section stripped, to prove the
 * strip is surgical rather than merely quiet.
 *
 * This is the guard that makes skipping it safe. A strip that took one check too
 * many would leave the 17 cheap cases asserting against a checker that has quietly
 * lost a claim, and nothing else would notice — the cases only require that their
 * own `expect` still appears, which a narrower checker satisfies more easily, not
 * less. So the requirement is exact: the stripped run must pass, and must report
 * precisely four fewer checks, because the section is four assertions and nothing
 * else. A round number is the point; anything else means the anchors drifted. */
const stripDir = makeTree(stripConformance);
const stripped = await new Promise((res) => {
  execFile(process.execPath, [join(stripDir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});
rmSync(stripDir, { recursive: true, force: true });
const countChecks = (out) => (out.match(/^ {2}ok {2}/gm) ?? []).length;
const fullCount = countChecks(baseline.out);
const stripCount = countChecks(stripped.out);
ok('baseline: the checker still passes with the conformance section removed',
  stripped.code === 0, stripped.code === 0 ? '' : stripped.out.split('\n').slice(-8).join('\n'));
ok(`baseline: removing it drops exactly 4 of the ${fullCount} checks and nothing else`,
  fullCount - stripCount === 4, `${fullCount} against ${stripCount}`);

/* The cases are independent -- each is its own `node` process against its own fixture
 * tree -- so they run concurrently. Sequentially this file was 34 checkers, three and
 * a half minutes of waiting to re-verify arithmetic. The pool is bounded by the core
 * count rather than left unbounded, because each worker is a full JIT-compiling
 * interpreter and oversubscribing them makes every case slower, not faster. */
/* Four workers, at the user's request because other work shares this machine.
 * Measured here: 6 workers 44.5 s, 8 workers 38.9 s, 10 workers 38.0 s, 12 workers
 * 38.5 s -- so four costs about 55 s against 38 s at eight, which is the right trade
 * when the cores are not yours alone. Raise POOL when the machine is idle. */
const POOL = Math.max(1, Math.min(4, (cpus().length - 1) >> 1));

/* Heaviest first. The cases that need the conformance loop cost 5.7 s and the other
 * 18 cost 1.4 s, and the pool is a plain queue: handed out in declaration order the
 * last wave is whatever happened to be left, which is most often one long case that
 * holds four workers idle while three of them sit finished. Issuing the 16 long ones
 * up front makes every trailing wave short, which is worth about one full wave.
 *
 * Results are still recorded against the ORIGINAL index, so this changes the order
 * cases are started in and nothing about the order they are reported in. */
const ORDER = CASES
  .map((c, i) => ({ i, heavy: CONFORMANCE_EXPECTS.has(c.expect) }))
  .sort((a, b) => (b.heavy - a.heavy) || (a.i - b.i))
  .map((e) => e.i);

let next = 0;
const finished = new Array(CASES.length);

async function runCase(i) {
  const c = CASES[i];
  /* Only the cases whose `expect` is not produced by the conformance loop skip it.
   * `mutate` runs first so a case can still edit the checker's own copy. */
  const heavy = CONFORMANCE_EXPECTS.has(c.expect);
  const dir = makeTree((d) => {
    if (c.mutate) c.mutate(d);
    if (!heavy) stripConformance(d);
  });
  let r;
  try {
    r = await new Promise((res) => {
      execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
        (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  /* `expect` must name the assertion that actually catches this mutation, which is
   * what caughtBy() asks. The pitch-cancellation case below used to declare
   * 'never get one', text that occurs in the description of a check that PASSES --
   * the timeline calls noiseOffset() itself, so it cannot see a mutation to the
   * renderer's call site. The case only ever failed because the waveform
   * comparison fired, and the old `out.includes(expect)` was satisfied by the
   * passing line. That is how it came to describe a timeline claim while being a
   * waveform case. See scripts/lib/negative.mjs. */
  const named = r.code !== 0 && caughtBy(r.out, c.expect);
  const reported = failLines(r.out);
  const firstFail = (reported[0] ?? '(no FAIL line)').slice(0, 90);
  finished[i] = { name: c.name, pass: named, detail: named
    ? ''
    : `exit ${r.code}, expected "${c.expect}" on a FAIL line; first report: ${firstFail}` };
}

await Promise.all(Array.from({ length: POOL }, async () => {
  while (next < ORDER.length) {
    const i = ORDER[next++];
    await runCase(i);
  }
}));
for (const f of finished) ok(f.name, f.pass, f.detail);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');