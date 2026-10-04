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
 * are 22 cases and not forty.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const CASES = [
  /* ---- The encoding ---- */
  {
    name: 'the pitch formula loses the 131072 constant, so every note is an octave out',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return 131072 / (2048 - (register & 0x7ff));', 'return 65536 / (2048 - (register & 0x7ff));')),
    expect: 'Machop',
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
    name: 'sound_ret is honoured, so the last note is cut instead of ringing out',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('if (!(i < sampleCount || (isLast && vol > 0 && i < sampleCount + ringCap))) break;',
        'if (!(i < sampleCount)) break;')),
    expect: 'ring past their nominal note list',
  },
  {
    name: 'the ring-out is left unbounded, so a zero-sweep note runs to the sample cap',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('i < sampleCount + ringCap', 'i < sampleCount + 4_000_000')),
    expect: 'bounded rather than ringing to the sample cap',
  },

  /* ---- The pitch cancellation. Wrong here is FREE, which is why it is worth a
     case of its own: nothing about the audio changes. ---- */
  {
    name: 'the cutoff is taken off the rendered pulse length instead of the nominal sum',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const cutoff = Math.max(0, nominalLongest - Math.round(SAMPLES_PER_FRAME));',
        'const cutoff = Math.max(0, Math.max(pulse1.length, pulse2.length) - Math.round(SAMPLES_PER_FRAME));')),
    expect: 'within one 8-bit step',
  },
  {
    name: 'the pitch cancellation is removed, so every noise note keeps its offset',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const offset = noiseOffset(sampleI, cutoffSamples, pitch);', 'const offset = pitch;')),
    expect: 'never get one',
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
      .replace('const master = this.masterVolume / 15;', 'const master = 1;')),
    expect: 'zero volume renders silence',
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
    expect: 'byte-identical',
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

/* The cases are independent -- each is its own `node` process against its own fixture
 * tree -- so they run concurrently. Sequentially this file was 33 x a 6 s checker,
 * which is three and a half minutes of waiting to re-verify arithmetic. The pool is
 * bounded by the core count rather than left unbounded, because each worker is a
 * full JIT-compiling interpreter and oversubscribing them makes every case slower,
 * not faster. */
/* Measured on this machine (8 performance cores): 6 workers 44.5 s, 8 workers 38.9 s,
 * 10 workers 38.0 s, 12 workers 38.5 s. Eight is where it stops improving, because
 * each worker is a JIT-compiling interpreter competing for the same core. */
const POOL = Math.max(1, Math.min(8, cpus().length - 1));
let next = 0;
const finished = new Array(CASES.length);

async function runCase(i) {
  const c = CASES[i];
  const dir = makeTree(c.mutate);
  let r;
  try {
    r = await new Promise((res) => {
      execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
        (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  /* A `silent` case inverts the expectation. It marks a divergence that changes no
   * audio and no timeline entry, so the checker cannot see it -- and pretending
   * otherwise would be the exact mistake this file exists to catch. */
  const pass = c.silent
    ? r.code === 0
    : r.code !== 0 && r.out.includes(c.expect);
  const firstFail = (r.out.match(/FAIL[^\n]*/) || ['(no FAIL line)'])[0].slice(0, 90);
  finished[i] = { name: c.name, pass, detail: pass ? '' : c.silent
    ? `exit ${r.code}, expected BLIND; first report: ${firstFail}`
    : `exit ${r.code}, expected "${c.expect}"; first report: ${firstFail}` };
}

await Promise.all(Array.from({ length: POOL }, async () => {
  while (next < CASES.length) {
    const i = next++;
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