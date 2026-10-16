#!/usr/bin/env node
/**
 * Negative tests for check_tmp_prefixes.mjs.
 *
 *   node scripts/test_check_tmp_prefixes.mjs
 *
 * Proves the temp-dir prefix checker fails, and names the right assertion, for
 * every shape of the defect §3.J exists to prevent — including the one that
 * actually shipped.
 *
 * **Five of the eight cases break the TREE and three break the CHECKER, and the
 * split is the point.** A checker that is only ever attacked through its input
 * cannot distinguish "the rule is enforced" from "the checker is currently
 * green" — so three cases here break the checker's own logic and require it to
 * notice *itself*. Case 8 is the one that matters most: it narrows the scanner
 * to `check_*` so it sees 10 of the 34 `tmpdir()` references, and the
 * non-vacuity floor is the only assertion standing between that and a silent
 * zero. Without the floor, case 8 would report "no unclassified references" and
 * "no overlaps" about a tenth of the suite and exit 0.
 *
 * Case 1 is the historical defect, verbatim: a cry-game harness holding
 * `cgpage-neg-` inside the `cgpage-` namespace another session had chosen.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_tmp_prefixes.mjs';
const SCRIPTS = join(ROOT, 'scripts');

/**
 * The whole tree is `scripts/*.mjs` — 66 files, 2.3 MB, no data and no assets.
 * The checker reads nothing else, which is the reason this harness does not
 * copy the corpus, and the reason its cases cost a directory listing.
 */
function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'prefix-neg-')));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of readdirSync(SCRIPTS)) {
    if (f.endsWith('.mjs')) cpSync(join(SCRIPTS, f), join(dir, 'scripts', f));
  }
  if (mutation) mutation(dir);
  return dir;
}

/** Break one file, and THROW when the target string is absent. */
function edit(dir, rel, from, to) {
  const p = join(dir, rel);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`mutation target not found in ${rel}: ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
}

const run = (dir) => new Promise((resolve) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
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
  releaseTree(dir);
  code === 0
    ? pass('baseline: 35 prefixes derived, zero overlaps, nothing unclassified')
    : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: '把 cry-game 的 prefix 放回 cgpage- 的命名空間（歷史上真的發生過的那一次）',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_cry_game.mjs',
        "mkdtempSync(join(tmpdir(), 'crygame-neg-'))",
        "mkdtempSync(join(tmpdir(), 'cgpage-neg-'))");
    },
    expect: '沒有任何一個 prefix 是另一個的前綴',
  },
  {
    name: 'prefix 改成識別字而非字面值，掃描器認不出形狀',
    mutate: (dir) => {
      edit(dir, 'scripts/check_spectrum_browser.mjs',
        "mkdtempSync(join(tmpdir(), 'spx-'))",
        'mkdtempSync(join(tmpdir(), SPX_PREFIX))');
    },
    expect: '每一個 tmpdir() 參照都被分類',
  },
  {
    name: 'tmpdir() 不再是 join() 的第一個參數',
    mutate: (dir) => {
      edit(dir, 'scripts/check_gen1_page.mjs',
        "mkdtempSync(join(tmpdir(), 'cdp-'))",
        "mkdtempSync((tmpdir(), 'cdp-'))");
    },
    expect: '每一個 tmpdir() 參照都被分類',
  },
  {
    name: '新增一支用 cgpage（無尾端 hyphen）的 script —— 一個命名空間吃掉另一個',
    mutate: (dir) => {
      writeFileSync(join(dir, 'scripts', 'zz_probe.mjs'),
        "import { mkdtempSync } from 'node:fs';\n" +
        "import { tmpdir } from 'node:os';\n" +
        "import { join } from 'node:path';\n" +
        "mkdtempSync(join(tmpdir(), 'cgpage'));\n");
    },
    expect: '沒有任何一個 prefix 是另一個的前綴',
  },
  {
    name: '巢狀的 BASE 不再是 tmpdir() BASE，tree- 變成無來源的前綴',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_spectrogram_port.mjs',
        "const BASE = join(tmpdir(), 'spectrogram-neg');",
        "const BASE = '/tmp/spectrogram-neg';");
    },
    expect: '每一個 tmpdir() 參照都被分類',
  },
  {
    name: 'template 的 prefix 變成以 ${} 開頭，沒有可當命名空間的字面頭',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_color_daily.mjs',
        '`ccd-neg-${Math.random().toString(36).slice(2)}`',
        '`${PFX}neg-`');
    },
    expect: '每一個 tmpdir() 參照都被分類',
  },
  {
    name: '兩個檔案交出同一個 prefix（重複不是重疊，但也是要維護的兩個名字）',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_mmcq_anatomy.mjs',
        "mkdtempSync(join(tmpdir(), 'mmcq-neg-'))",
        "mkdtempSync(join(tmpdir(), 'spectrum-neg-'))");
    },
    expect: '沒有兩個檔案交出同一個 prefix',
  },
  {
    name: '掃描器被改窄到只看 check_* —— 只剩 10 個參照，非空洞門檻必須擋下來',
    mutate: (dir) => {
      edit(dir, CHECKER,
        "readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).sort()",
        "readdirSync(SCRIPTS).filter((f) => f.startsWith('check_')).sort()");
    },
    expect: '掃描確實有找到東西',
  },
];

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs. Each case
 * copies 66 small files and runs one node process that reads only those files, so
 * a case is a few tens of milliseconds of work and nothing else. */
const verdicts = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    releaseTree(dir);
  }
  if (code === 0) return { name: c.name, detail: `exited with 0 (expected failure naming "${c.expect}")` };
  if (caughtBy(out, c.expect)) return { name: c.name, detail: null };
  return { name: c.name, detail: `failed, but NOT caught by expected assertion "${c.expect}". Output was:\n${out}` };
}));

for (const v of verdicts) v.detail === null ? pass(v.name) : fail(`${v.name}: ${v.detail}`);

console.log(`\n${failures ? `FAIL  ${failures} of ${CASES.length + 1} checks failed` : `PASS  every negative case failed for the right reason`}`);
process.exit(failures ? 1 : 0);
