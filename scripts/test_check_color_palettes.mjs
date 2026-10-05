/**
 * Negative tests for scripts/check_color_palettes.mjs.
 *
 *   node scripts/test_check_color_palettes.mjs
 *
 * A regression checker that has only ever been shown good data is not known to
 * check anything: "all 95313 checks passed" and "no assertion ever fired" print
 * identically. Each case below mutates a throwaway copy of the real file in a way
 * that corresponds to a specific decision documented in AGENTS.md, then requires
 * the checker to exit non-zero AND name the right reason. A case that fails to
 * fail is the finding.
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check_color_palettes.mjs');
const SOURCE = join(ROOT, 'assets/data/color_palettes.json');
const ORIGINAL = readFileSync(SOURCE, 'utf8');
const DIR = mkdtempSync(join(tmpdir(), 'cp-negtest-'));

function runChecker(path) {
  try {
    const out = execFileSync('node', [CHECKER, path], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function writeVariant(name, mutate) {
  const copy = JSON.parse(ORIGINAL);
  mutate(copy);
  const path = join(DIR, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(copy, null, 2)}\n`);
  return path;
}

const cases = [
  {
    name: 'unmodified file still passes',
    path: SOURCE,
    expectCode: 0,
    expectText: null,
  },
  {
    // The bug the extractor actually had: the top-up pass appended without
    // re-sorting, so a large colour landed after a small one. Pinned because it
    // is invisible by eye — the palette is correct, only the order is wrong.
    name: 'shares out of descending order',
    mutate: (d) => {
      const rows = d['1'].s;
      [rows[3], rows[4]] = [rows[4], rows[3]];
    },
    expectCode: 1,
    expectText: 'not in descending share order',
  },
  {
    name: 'a palette exceeds the 6-colour cap',
    mutate: (d) => d['1'].n.push(['#123456', 0.5]),
    expectCode: 1,
    expectText: 'over the 6 cap',
  },
  {
    // Region shares + top-up: pixels counted twice, so the sum climbs past 100.
    // This is the regression that a per-colour share prevents.
    name: 'share sum above 100 (region-share regression)',
    mutate: (d) => {
      d['1'].n = [
        ['#399494', 46.4],
        ['#62d5b4', 26.5],
        ['#83eec5', 21.46],
        ['#73ac31', 20.14],
        ['#bdff73', 10.34],
        ['#ac0031', 6.1],
      ];
    },
    expectCode: 1,
    expectText: 'shares sum to',
  },
  {
    // The same region shares, renormalised so they total 100. Passes the
    // per-palette ceiling, which is exactly why the roster median is pinned too.
    name: 'every palette renormalised to exactly 100',
    mutate: (d) => {
      for (const entry of Object.values(d)) {
        for (const variant of ['n', 's']) {
          const rows = entry[variant];
          const total = rows.reduce((a, r) => a + r[1], 0);
          const scaled = rows.map(([hex, share]) => [hex, (share / total) * 100]);
          scaled.sort((a, b) => b[1] - a[1]);
          entry[variant] = scaled;
        }
      }
    },
    expectCode: 1,
    expectText: 'share-sum min / median / max moved',
  },
  {
    // The snap is the whole point and Node cannot verify it, so one
    // hand-inspected palette is pinned byte-exact. A synthetic centroid here is
    // precisely the failure the pin exists to catch.
    name: "Bulbasaur normal's sixth colour replaced by a synthetic average",
    mutate: (d) => {
      d['1'].n[5] = ['#944f4f', 3.05];
    },
    expectCode: 1,
    expectText: 'Bulbasaur normal palette moved',
  },
  {
    name: 'a hand-inspected palette loses its rare real colour',
    mutate: (d) => {
      d['1'].n = d['1'].n.slice(0, 5);
    },
    expectCode: 1,
    expectText: 'below the 6-colour floor changed',
  },
  {
    name: 'total entry count drifts',
    mutate: (d) => {
      d['1'].n.pop();
    },
    expectCode: 1,
    expectText: 'total colour entries is',
  },
  {
    name: 'the excluded near-black reappears',
    mutate: (d) => {
      d['1'].n[0] = ['#101010', 29.4];
    },
    expectCode: 1,
    expectText: 'excluded near-black',
  },
  {
    name: 'a colour repeats inside one palette',
    mutate: (d) => {
      d['1'].n[1] = ['#399494', 13.25];
    },
    expectCode: 1,
    expectText: 'repeats',
  },
  {
    name: 'the palette file drifts from pokemon_data.json',
    mutate: (d) => {
      delete d['1025'];
    },
    expectCode: 1,
    expectText: 'keys must be exactly the ids',
  },
];

let failed = 0;
for (const c of cases) {
  const path = c.path ?? writeVariant(c.name.replace(/\W+/g, '-'), c.mutate);
  const { code, out } = runChecker(path);

  const wrongCode = code !== c.expectCode;
  const missingReason = c.expectText && !caughtBy(out, c.expectText);
  const pass = !wrongCode && !missingReason;

  if (!pass) failed += 1;
  console.log(
    `${pass ? '  ok  ' : '  FAIL'}  ${c.name}` +
      (wrongCode ? `  (exit ${code}, expected ${c.expectCode})` : '') +
      (missingReason ? `\n          no FAIL line reported: ${c.expectText}` : '')
  );
}

console.log(
  failed === 0
    ? `\nall ${cases.length} negative tests behaved as required`
    : `\n${failed} of ${cases.length} negative tests FAILED`
);
process.exit(failed === 0 ? 0 : 1);
