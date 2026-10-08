#!/usr/bin/env node
/**
 * Negative tests for check_mmcq_anatomy.mjs.
 *
 *   node scripts/test_check_mmcq_anatomy.mjs
 *
 * Proves the MMCQ anatomy checker actually fails and names the exact
 * failing assertion for each deliberate algorithmic violation:
 *
 * 1. Comparator swap (Phase 1 product, Phase 2 count)
 * 2. Partialsum median boundary (> changed to >=)
 * 3. Empty region top-up removal
 * 4. Deterministic tiebreak removal / inversion
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_mmcq_anatomy.mjs';

function makeTree(mutation) {
  const dir = mkdtempSync(join(tmpdir(), 'mmcq-neg-'));
  mkdirSync(join(dir, 'assets/js'), { recursive: true });
  mkdirSync(join(dir, 'assets/data'), { recursive: true });
  mkdirSync(join(dir, 'assets/images'), { recursive: true });
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true });

  cpSync(join(ROOT, 'assets/data/color_palettes.json'), join(dir, 'assets/data/color_palettes.json'));
  cpSync(join(ROOT, 'scripts/lib/png.mjs'), join(dir, 'scripts/lib/png.mjs'));
  cpSync(join(ROOT, CHECKER), join(dir, CHECKER));

  // Symlink sprite directory to avoid copying 1,025 PNGs
  symlinkSync(join(ROOT, 'assets/images/sprite'), join(dir, 'assets/images/sprite'), 'dir');

  let code = readFileSync(join(ROOT, 'assets/js/mmcq-anatomy.js'), 'utf8');
  if (mutation) {
    code = mutation(code);
  }
  writeFileSync(join(dir, 'assets/js/mmcq-anatomy.js'), code);

  return dir;
}

const run = (dir) => new Promise((resolve) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({
      code: err ? (err.code ?? 1) : 0,
      out: `${stdout}${stderr}`,
    });
  });
});

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  rmSync(dir, { recursive: true, force: true });
  code === 0
    ? pass('baseline: the checker passes on an unmutated copy of the tree')
    : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

// ---------------------------------------------------------------------------
// Negative Cases
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: '兩段排序鍵對調（phase1 用 count×volume、phase2 用 count）',
    mutate: (s) => {
      const before = s;
      const after = s
        .replace('const pq = new PQueue(COMPARATOR_COUNT);', 'const pq = new PQueue(COMPARATOR_PRODUCT);')
        .replace('const pq2 = new PQueue(COMPARATOR_PRODUCT);', 'const pq2 = new PQueue(COMPARATOR_COUNT);');
      if (after === before) throw new Error('mutation did not apply');
      return after;
    },
    expect: 'trace 的 phase 順序',
  },
  {
    name: 'partialsum[i] > total/2 改成 >=',
    mutate: (s) => {
      const before = s;
      const after = s.replace('if (partialsum[i] > total / 2)', 'if (partialsum[i] >= total / 2)');
      if (after === before) throw new Error('mutation did not apply');
      return after;
    },
    expect: 'hex 與占比逐隻相符',
  },
  {
    name: '拿掉空區域的 top-up',
    mutate: (s) => {
      const before = s;
      const after = s.replace(
        /for \(const hex of \[\.\.\.shares\.keys\(\)\][\s\S]*?seen\.add\(hex\);\s*chosen\.push\(hex\);\s*\}/,
        ''
      );
      if (after === before) throw new Error('mutation did not apply');
      return after;
    },
    expect: '5 色物種的第六格由 top-up 補上',
  },
  {
    name: '移除 min((-count, rgb)) 的 hex tiebreak',
    mutate: (s) => {
      const before = s;
      const after = s
        .replaceAll('return a < b ? -1 : a > b ? 1 : 0;', 'return a > b ? -1 : a < b ? 1 : 0;')
        .replaceAll('return a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;', 'return a.hex > b.hex ? -1 : a.hex < b.hex ? 1 : 0;');
      if (after === before) throw new Error('mutation did not apply');
      return after;
    },
    expect: '同占比色票的排序是確定性的',
  },
];

/* Four at a time, in DECLARATION order out -- see scripts/lib/pool.mjs. Each case is
 * its own `node` process against its own temp tree and the checker re-derives all 2,050
 * palettes from the sprites on every run, so a case costs ~1.4 s of real work rather
 * than any shared setup. Sequentially that is 5.6 s with four cores idling. */
const verdicts = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (code === 0) return { name: c.name, detail: `exited with 0 (expected failure naming "${c.expect}")` };
  if (caughtBy(out, c.expect)) return { name: c.name, detail: null };
  return { name: c.name, detail: `failed, but NOT caught by expected assertion "${c.expect}". Output was:\n${out}` };
}));

for (const v of verdicts) v.detail === null ? pass(v.name) : fail(`${v.name}: ${v.detail}`);

console.log(`\n${failures ? `FAIL  ${failures} of ${CASES.length + 1} checks failed` : `PASS  every negative case failed for the right reason`}`);
process.exit(failures ? 1 : 0);
