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
    name: 'a cry-game prefix back inside the cgpage- namespace — the collision that actually shipped',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_cry_game.mjs',
        "mkdtempSync(join(tmpdir(), 'crygame-neg-'))",
        "mkdtempSync(join(tmpdir(), 'cgpage-neg-'))");
    },
    expect: 'no prefix is a prefix of another',
  },
  {
    name: 'the prefix becomes an identifier instead of a literal, so the scanner cannot read the shape',
    mutate: (dir) => {
      edit(dir, 'scripts/check_spectrum_browser.mjs',
        "mkdtempSync(join(tmpdir(), 'spx-'))",
        'mkdtempSync(join(tmpdir(), SPX_PREFIX))');
    },
    expect: 'every tmpdir() reference is classified',
  },
  {
    name: 'tmpdir() is no longer the first argument of a join()',
    mutate: (dir) => {
      edit(dir, 'scripts/check_gen1_page.mjs',
        "mkdtempSync(join(tmpdir(), 'cdp-'))",
        "mkdtempSync((tmpdir(), 'cdp-'))");
    },
    expect: 'every tmpdir() reference is classified',
  },
  {
    name: 'a new script using cgpage with no trailing hyphen — one namespace swallowing another',
    mutate: (dir) => {
      writeFileSync(join(dir, 'scripts', 'zz_probe.mjs'),
        "import { mkdtempSync } from 'node:fs';\n" +
        "import { tmpdir } from 'node:os';\n" +
        "import { join } from 'node:path';\n" +
        "mkdtempSync(join(tmpdir(), 'cgpage'));\n");
    },
    expect: 'no prefix is a prefix of another',
  },
  {
    name: 'the nested BASE is no longer a tmpdir() BASE, leaving tree- a prefix with no source',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_spectrogram_port.mjs',
        "const BASE = join(tmpdir(), 'spectrogram-neg');",
        "const BASE = '/tmp/spectrogram-neg';");
    },
    expect: 'every tmpdir() reference is classified',
  },
  {
    name: 'the template prefix starts with ${}, so it has no literal head to be a namespace',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_color_daily.mjs',
        '`ccd-neg-${Math.random().toString(36).slice(2)}`',
        '`${PFX}neg-`');
    },
    expect: 'every tmpdir() reference is classified',
  },
  {
    name: 'two files hand over the same prefix — a duplicate is not an overlap, and still two names to keep',
    mutate: (dir) => {
      edit(dir, 'scripts/test_check_mmcq_anatomy.mjs',
        "mkdtempSync(join(tmpdir(), 'mmcq-neg-'))",
        "mkdtempSync(join(tmpdir(), 'spectrum-neg-'))");
    },
    expect: 'no two files hand the same prefix',
  },
  {
    name: 'the scanner is narrowed to check_*, leaving 10 of 34 references — only the non-vacuity floor can catch it',
    mutate: (dir) => {
      edit(dir, CHECKER,
        "readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).sort()",
        "readdirSync(SCRIPTS).filter((f) => f.startsWith('check_')).sort()");
    },
    expect: 'the scan found something',
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
