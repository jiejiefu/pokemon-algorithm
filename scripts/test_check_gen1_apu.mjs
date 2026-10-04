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
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = [
  'assets/data/gen1_cries.json',
  'assets/data/gen1_cry_sfx.json',
  'assets/data/cry_features.json',
  'assets/js/gb-apu.js',
  'assets/js/cry-index.js',
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

function run(dir) {
  try {
    const stdout = execFileSync('node', [join(dir, CHECKER)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1 << 26,
    });
    return { code: 0, out: `${stdout}` };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
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
  {
    name: 'the pitch formula loses the 131072 constant, so every note is an octave out',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return 131072 / (2048 - x);', 'return 65536 / (2048 - x);')),
    expect: 'Machop',
  },
  {
    name: 'the pitch shift is dropped, so every species sounds like its unshifted base',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return (register + pitch) & 0x7ff;', 'return register & 0x7ff;')),
    expect: 'the lower pitch byte',
  },
  {
    name: 'the 11-bit wrap is removed, so a high pitch stops wrapping back down',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('return (register + pitch) & 0x7ff;', 'return register + pitch;')),
    expect: 'wrap past 11 bits',
  },
  {
    name: 'the length byte is read as unsigned, so 0xFF becomes a huge stretch',
    mutate: (dir) => editApu(dir, (s) => s
      .replace('const signed = lengthByte > 127 ? lengthByte - 256 : lengthByte;',
        'const signed = lengthByte;')),
    expect: 'reads as the signed value',
  },
  {
    name: 'the frame rate is rounded to 60, which invalidates the published 0.071 s',
    mutate: (dir) => editApu(dir, (s) => s.replace('export const FRAME_HZ = 59.7275;', 'export const FRAME_HZ = 60;')),
    expect: 'NTSC rate',
  },
  {
    name: 'the duty byte packs in the wrong order, so 2-0-2-0 is no longer $88',
    mutate: (dir) => editApu(dir, (s) => s.replace(
      'return ((pattern[0] & 3) << 6) | ((pattern[1] & 3) << 4) | ((pattern[2] & 3) << 2) | (pattern[3] & 3);',
      'return ((pattern[3] & 3) << 6) | ((pattern[2] & 3) << 4) | ((pattern[1] & 3) << 2) | (pattern[0] & 3);')),
    expect: 'packs to $88',
  },
  {
    name: 'the duty pattern steps once per sample instead of per quarter period',
    mutate: (dir) => editApu(dir, (s) => s.replace(
      'const slot = Math.min(3, (channel.phase * 4) | 0);',
      'const slot = (i >> 1) & 3;')),
    // Not "Machop": the register arithmetic is untouched by this, which is the
    // point. It is the SPECTRUM assertion that has to notice.
    expect: 'third harmonic is the square wave',
  },
  {
    name: 'sound_loop is ignored, so cry0d plays its channel once instead of twice',
    mutate: (dir) => editApu(dir, (s) => s.replace('if (loops.get(target) < cmd.count) {', 'if (false) {')),
    expect: 'plays its channel twice',
  },
  {
    name: 'the pitch-shift cancellation is removed, so the noise tail never reverts',
    mutate: (dir) => editApu(dir, (s) => s.replace(
      'note.cancelTime = note.ch === 8 ? cancelAt : Infinity;',
      'note.cancelTime = Infinity;')),
    expect: 'every noise note carries the cancellation time',
  },
  {
    name: 'each channel is planned twice, so every pulse note is emitted twice',
    mutate: (dir) => editApu(dir, (s) => s.replace(
      'for (const channel of this.base.channels) {\n      ends.set(channel.ch, this.#planChannel(channel, 0, stretch));\n    }',
      'for (const channel of this.base.channels) {\n      ends.set(channel.ch, this.#planChannel(channel, 0, stretch));\n    }\n    for (const channel of this.base.channels) {\n      this.#planChannel(channel, 0, stretch);\n    }')),
    expect: 'byte-identical',
  },
  {
    // Clamping instead of normalising is not detectable from the samples -- a
    // clamped file is still within range by definition. It is detectable from the
    // mix that had to be clamped, so the /3 that keeps the three channels from
    // summing past unity is what this removes.
    name: 'the three channels are summed without dividing by three, so every cry clips',
    mutate: (dir) => editApu(dir, (s) => s.replace(
      'const value = mix * (this.masterVolume / 15) / 3;',
      'const value = mix * (this.masterVolume / 15);')),
    expect: 'none of them needed clipping',
  },
  {
    name: 'zero volume divides by a zero peak and fills the buffer with NaN',
    mutate: (dir) => editApu(dir, (s) => s.replace(
      'if (peak > 0) {\n      for (let i = 0; i < total; i++) out[i] /= peak;\n    }',
      'for (let i = 0; i < total; i++) out[i] /= peak;')),
    expect: 'renders silence rather than NaN',
  },
  {
    name: 'Poliwag and Ditto stop matching, because one of their pitch bytes changes',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.cries.find((c) => c.id === 132).pitch = 254;
    }),
    expect: 'Poliwag and Ditto render byte-identical',
  },
  {
    name: 'Rhyhon is moved onto Charizard\'s base, manufacturing a third identical pair',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      const r = d.cries.find((c) => c.id === 112);
      r.sfx = 'SFX_CRY_04';
    }),
    expect: 'no two of the 38 base cries render the same audio',
  },
  {
    name: 'a fourth species joins an existing identical pair',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      const src = d.cries.find((c) => c.id === 111);
      d.cries.find((c) => c.id === 113).sfx = src.sfx;
      d.cries.find((c) => c.id === 113).pitch = src.pitch;
      d.cries.find((c) => c.id === 113).length = src.length;
    }),
    expect: 'exactly two groups of species share',
  },
  {
    name: 'the loop is removed from cry0d, so the corpus has no sound_loop left',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      const ch = d.sfx.SFX_CRY_0D.channels.find((c) => c.ch === 5);
      ch.commands = ch.commands.filter((c) => c.op !== 'loop');
    }),
    expect: 'exactly one sound_loop',
  },
  {
    name: 'the six missing terminators are quietly filled in, hiding the upstream quirk',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_02.implicitRet = [];
    }),
    expect: 'still have no sound_ret',
  },
  {
    name: 'the page stops distinguishing Rhyhorn from Rhyhon',
    mutate: (dir) => editPage(dir, (s) => s.replace(/兩隻不同的寶可夢/, '同一隻')),
    expect: 'says outright that they are two different Pokémon',
  },
  {
    name: 'the page drops the published 0.071 s it is checked against',
    // replaceAll, not replace: the figure appears in the teaching card AND in the
    // sentence above it, and a single replacement leaves the other in place.
    mutate: (dir) => editPage(dir, (s) => s.replaceAll('0.071', '0.07')),
    expect: "quotes Bulbapedia's published",
  },
  {
    name: 'the page claims sample-exact reproduction',
    mutate: (dir) => editPage(dir, (s) => s.replace('這裡的音訊是瀏覽器即時合成的，不是錄音。', '這裡的音訊與原機位元相同。')),
    expect: 'sample-exact',
  },
  {
    name: 'the page stops disclosing that the envelope rate is a model',
    mutate: (dir) => editPage(dir, (s) => s.replace(/是模型而非實測/, '與原機相同')),
    expect: 'envelope rate is a model',
  },
  {
    name: 'the APU source loses the reason for the sample rate, so 48000 looks like a cleanup',
    mutate: (dir) => editApu(dir, (s) => s.replace('caps a buffer\'s sample rate at 96,000 Hz', 'has a sample rate')),
    expect: 'records the Web Audio sample-rate ceiling',
  },
  {
    name: 'the APU source loses the NTSC frame rate, so a round 60 looks equivalent',
    mutate: (dir) => editApu(dir, (s) => s.replace('export const FRAME_HZ = 59.7275;', 'export const FRAME_HZ = 59.72750001;')),
    expect: 'pins the NTSC frame rate',
  },
];

const baseline = run(makeTree(null));
ok('baseline: the checker passes on an unmutated copy of the tree', baseline.code === 0,
  baseline.code === 0 ? '' : baseline.out.split('\n').slice(-8).join('\n'));

for (const c of CASES) {
  const dir = makeTree(c.mutate);
  let r;
  try {
    r = run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  ok(c.name, r.code !== 0 && r.out.includes(c.expect),
    r.code !== 0 && r.out.includes(c.expect) ? ''
      : `exit ${r.code}, expected the checker to fail with "${c.expect}"`);
}

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');