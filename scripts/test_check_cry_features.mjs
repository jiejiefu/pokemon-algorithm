#!/usr/bin/env node
/**
 * Prove check_cry_features.mjs can actually fail.
 *
 * Run: node scripts/test_check_cry_features.mjs
 *
 * Each case copies the tree, breaks one thing, and requires the checker to exit
 * non-zero with a message naming that specific problem. Matching on the message
 * is the point: "it failed" is also what a crash produces, and a checker that
 * fails for the wrong reason guards nothing.
 *
 * The cases cluster around the two ways this file can go bad without looking
 * broken. A row can be wrong in a way no shape check notices -- the roster no
 * longer matches cry-index.js, or a value is impossible -- and the two checks
 * here that cost the most to write, "every value is physically possible" and
 * "every dimension varies across the corpus", exist because the file they guard
 * looked entirely healthy in both of those states during development.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy, failLines } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* EVERY SCRATCH DIRECTORY IS TRACKED AT CREATION AND REMOVED ON EXIT.
 *
 * The per-case `finally { rmSync(dir) }` blocks below already clean up on the happy path
 * and on a throw inside `run()`. They cannot cover the one window that leaks: `makeTree()`
 * calls `mkdtempSync` and then copies files and mutates the copy, so a stale anchor, a
 * missing source file or a `cpSync` failure throws AFTER the directory exists but BEFORE
 * the caller's `finally` is ever entered. The caller has no `dir` to clean up, because
 * `makeTree()` never returned one.
 *
 * Registering at creation closes that window without depending on where the throw happens,
 * and it is the same fix as test_check_color_palettes.mjs. Measured: this harness left one
 * partial tree per run — 4-5 files, never a complete one, which is what "threw halfway
 * through makeTree" looks like on disk.
 *
 * The existing finally blocks stay: they free the space promptly during a long run, and
 * `force: true` makes the exit-time removal a no-op for anything already gone.
 */
const SCRATCH = new Set();
const track = (dir) => (SCRATCH.add(dir), dir);
process.on('exit', () => {
  for (const dir of SCRATCH) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
});
const SRC = [
  'assets/data/cry_features.json',
  'assets/js/cry-index.js',
  'scripts/analyze_cries.py',
  'scripts/check_cry_features.mjs',
  'scripts/lib/assert.mjs',
];
const CHECKER = 'scripts/check_cry_features.mjs';
const FEATURES = 'assets/data/cry_features.json';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeTree(mutate) {
  const dir = track(mkdtempSync(join(tmpdir(), 'cryfeat-neg-')));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

/* Async, and on process.execPath rather than whatever 'node' is first on PATH — the
 * baseline and the mutations must run the SAME interpreter to be comparable. */
const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

const edit = (dir, fn) => {
  const p = join(dir, FEATURES);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  fn(data);
  writeFileSync(p, JSON.stringify(data));
};

const CASES = [
  {
    name: 'a species with no audio on disk keeps a feature row',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['2000'] = d.latest['1'].slice();
    }),
    expect: 'latest covers exactly the 1025 ids',
  },
  {
    name: 'a species loses its row, so a playable cry cannot be searched for',
    mutate: (dir) => edit(dir, (d) => {
      delete d.latest['25'];
    }),
    expect: 'latest covers exactly the 1025 ids',
  },
  {
    name: 'a legacy id that has no legacy audio is left in',
    mutate: (dir) => edit(dir, (d) => {
      d.legacy['700'] = d.legacy['1'].slice();
    }),
    expect: 'legacy covers exactly the 649 ids',
  },
  {
    name: 'a row is one number short, so the columns stop lining up',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['25'].pop();
    }),
    expect: 'every latest row is exactly 34 numbers wide',
  },
  {
    name: 'a division by a silent segment leaves a NaN in the matrix',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['25'][4] = null; // JSON has no NaN literal; null is what one becomes
    }),
    expect: 'no latest row holds a NaN',
  },
  {
    name: 'an infinite value rides in from a log of zero',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['808'][6] = 1e400;
    }),
    expect: 'no latest row holds a NaN',
  },
  {
    name: 'a duration comes out zero, which is not a sound',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['25'][0] = 0;
    }),
    expect: 'physically possible',
  },
  {
    name: 'RMS exceeds peak, which cannot happen',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['25'][2] = d.latest['25'][1] * 2;
    }),
    expect: 'rms',
  },
  {
    name: 'a centroid lands above the Nyquist frequency',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['25'][4] = 9000;
    }),
    expect: 'centroid above Nyquist',
  },
  {
    name: 'an MFCC standard deviation comes out negative',
    mutate: (dir) => edit(dir, (d) => {
      d.latest['25'][21] = -1;
    }),
    expect: 'physically possible',
  },
  {
    name: 'a whole dimension goes constant, so it stops measuring anything',
    mutate: (dir) => edit(dir, (d) => {
      for (const row of Object.values(d.latest)) row[4] = 1234.5;
    }),
    expect: 'varies across the corpus',
  },
  {
    name: 'the filterbank collapses, flattening an MFCC coefficient for every cry',
    mutate: (dir) => edit(dir, (d) => {
      for (const row of Object.values(d.legacy)) row[12] = -7.25;
    }),
    expect: 'varies across the corpus',
  },
  {
    name: 'a dimension is renamed in one place only',
    mutate: (dir) => edit(dir, (d) => {
      d.featureNames[13] = 'mfcc12';
    }),
    expect: 'feature names are the agreed 34',
  },
  {
    name: 'the declared width no longer matches the names',
    mutate: (dir) => edit(dir, (d) => {
      d.dimensions = 26;
    }),
    expect: 'declared width matches',
  },
  {
    name: 'a similarity matrix is precomputed into the payload',
    mutate: (dir) => edit(dir, (d) => {
      d.similarity = {};
    }),
    expect: 'no similarity matrix is stored',
  },
  {
    name: 'the sample rate is claimed but not the one analysed at',
    mutate: (dir) => edit(dir, (d) => {
      d.sampleRate = 44_100;
    }),
    expect: 'every row was resampled to 16 kHz',
  },
  {
    name: 'the features are attributed to a second source',
    mutate: (dir) => edit(dir, (d) => {
      d.source = 'https://example.invalid/cries';
    }),
    expect: 'point at the same source the cry roster does',
  },
  {
    name: 'the extractor is repointed at another source while the JSON keeps the old one',
    mutate: (dir) => {
      const p = join(dir, 'scripts/analyze_cries.py');
      writeFileSync(p, readFileSync(p, 'utf8').replace('SR = 16_000', 'SR = 8_000'));
    },
    expect: 'the extractor still analyses at 16 kHz',
  },
  {
    name: 'legacy rows are replaced by copies of the latest ones, erasing the two recordings',
    mutate: (dir) => edit(dir, (d) => {
      for (const [id, row] of Object.entries(d.legacy)) d.legacy[id] = d.latest[id].slice();
    }),
    expect: 'no legacy row is copied from its latest counterpart',
  },
];

const baseline = await run(makeTree(null));
ok('baseline: the checker passes on an unmutated copy of the tree', baseline.code === 0,
  baseline.code === 0 ? '' : baseline.out.split('\n').slice(-6).join('\n'));

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs. */const verdicts = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  let r;
  try {
    r = await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const named = r.code !== 0 && caughtBy(r.out, c.expect);
  return [c.name, named, named ? ''
    : `exit ${r.code}, expected the checker to report "${c.expect}" on a FAIL line; it said:\n${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`];
}));

for (const [name, pass, detail] of verdicts) ok(name, pass, detail);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');