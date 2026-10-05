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

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
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

/* ---------------------------------------------------------------------------
 * The naming checks need a different lever.
 *
 * Every case above mutates the DATA. The colour-naming guards assert things
 * about assets/js/color-palette.js, and there is no way to reach that from a
 * palette JSON: the bug they exist for was in the module. So these cases copy a
 * scratch tree, break ONE function in it, and run the checker there.
 *
 * The whole of assets/js is copied rather than just the two modules that look
 * relevant, because color-palette.js imports shared.js and that chain reaches
 * five more files -- and a case that fails on "cannot find module
 * form-names.js" is a case that passes for the wrong reason. The baseline case
 * below is the proof that the tree is sound: it runs the checker in an
 * unmutated copy and requires the same all-pass it gets in the real repo. */
function makeTree(mutate) {
  const dir = join(tmpdir(), `cpp-neg-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'assets/js'), { recursive: true });
  mkdirSync(join(dir, 'assets/data'), { recursive: true });
  mkdirSync(join(dir, 'assets/images'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of readdirSync(join(ROOT, 'assets/js'))) {
    cpSync(join(ROOT, 'assets/js', f), join(dir, 'assets/js', f));
  }
  for (const f of ['color_palettes.json', 'pokemon_data.json']) {
    cpSync(join(ROOT, 'assets/data', f), join(dir, 'assets/data', f));
  }
  // 2,050 sprite files. Symlink the directory rather than copying it, so the
  // baseline proves the harness and the mutation cases differ only in the
  // module under test.
  symlinkSync(join(ROOT, 'assets/images/sprite'), join(dir, 'assets/images/sprite'));
  cpSync(CHECKER, join(dir, 'scripts/check_color_palettes.mjs'));
  const file = mutate(join(dir, 'assets/js/color-palette.js'));
  if (file === undefined) throw new Error('this case did not target color-palette.js');
  return dir;
}

function runCheckerIn(dir) {
  try {
    return { code: 0, out: execFileSync('node', ['scripts/check_color_palettes.mjs'], {
      encoding: 'utf8',
      cwd: dir,
    }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Rewrite one anchor in the copied module, refusing a stale anchor. */
function patch(file, from, to) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    throw new Error(`anchor not found in color-palette.js: ${JSON.stringify(from)}`);
  }
  const after = before.replace(from, to);
  if (after === before) throw new Error('replace was a no-op');
  writeFileSync(file, after);
  return file;
}

const namingCases = [
  {
    // Without the baseline the other 9 cases prove nothing: a tree that fails
    // for an unrelated reason would make every one of them "pass".
    name: 'baseline: an unmutated module copy still passes',
    // Reads the file rather than rewriting it, so the tree differs from the
    // repo in nothing at all.
    setup: () => makeTree((f) => {
      readFileSync(f, 'utf8');
      return f;
    }),
    expectText: null,
  },
  {
    // The original bug. describeHex() read hue and lightness and never
    // saturation, so every sub-threshold swatch got a hue name -- and the pure
    // grey #6a6a6a got 紅, because `max === min` leaves h at 0 and h=0 is the
    // first bucket. This is the exact state the gate was added to end.
    name: 'describeHex loses the chroma gate (pure grey reads 紅 again)',
    setup: () => makeTree((f) => patch(f, '  if (isNeutral(hex)) return neutralName(hex);\n', '')),
    expectText: 'describeHex() gave',
  },
  {
    // The other half of the same page. nearest-neighbour will match a grey to a
    // tinted table entry because one channel being 8 away beats all three being
    // 20 away -- #414141 came back 墨綠.
    name: 'chineseColorName loses the chroma gate (#414141 reads 墨綠 again)',
    setup: () => makeTree((f) =>
      patch(f, '  if (isNeutral(hex)) return neutralName(hex);\n  const best = nearestTableEntry(rgb);', '  const best = nearestTableEntry(rgb);')
    ),
    expectText: 'chineseColorName() gave',
  },
  {
    // The page prints 色溫 in the same block as the colour name, so a swatch
    // called 灰白 must not also be called 冷色.
    name: 'colorTemperature loses the chroma gate',
    setup: () => makeTree((f) => patch(f, "  if (isNeutral(hex)) return 'neutral';\n  const hsl = hexToHsl(hex);", '  const hsl = hexToHsl(hex);')),
    expectText: 'warm/cool verdict',
  },
  {
    /* A guard that can only pass. Raising the threshold to 255 makes every
       swatch a grey, which satisfies all three "must not be chromatic" checks
       at once -- so something has to assert the gate does not eat colour.

       Detected by the pinned chromatic names rather than by the demotion check,
       and the distinction is the point: with the threshold at 255 there are no
       chromatic swatches left, so "chromatic swatches were demoted to a grey
       name" is satisfied vacuously -- it counts what it demoted, and there were
       none. The detector has to be an assertion about colours that ARE still
       chromatic.

       The threshold is genuinely in a gap and not merely low: 16 through 31 all
       pass unchanged, because the corpus's chroma histogram is empty between the
       grey cluster and the coloured one. 32 is where it starts eating. */
    name: 'NEUTRAL_CHROMA raised to 255 (every swatch becomes 灰白)',
    setup: () => makeTree((f) => patch(f, 'export const NEUTRAL_CHROMA = 16;', 'export const NEUTRAL_CHROMA = 255;')),
    expectText: 'lost their colour names',
  },
  {
    // The tempting wrong refactor. HSL saturation is a ratio against
    // lightness, so #fffff6 measures s=100% while being nine channels from
    // grey; near-whites are the largest grey bucket in the corpus.
    name: 'chroma() refactored onto HSL saturation',
    setup: () => makeTree((f) =>
      patch(
        f,
        '  const rgb = hexToRgbArray(hex);\n  if (!rgb) return 0;\n  return Math.max(...rgb) - Math.min(...rgb);',
        '  const hsl = hexToHsl(hex);\n  if (!hsl) return 0;\n  return hsl.s;'
      )
    ),
    expectText: 'chroma() on #fffff6',
  },
  {
    // A gate that returns one label. Every sub-threshold swatch becomes 灰白,
    // which still satisfies "named a grey" on all three namers -- so the branch
    // has to be shown to actually discriminate on lightness.
    name: 'neutralName collapses to a single label',
    setup: () => makeTree((f) => patch(f, "  if (l < 0.08) return '黑';\n  if (l > 0.93) return '白';\n  if (l < 0.22) return '深灰';\n  if (l < 0.45) return '灰色';\n  if (l < 0.72) return '淺灰';\n  return '灰白';", "  return '灰白';")),
    expectText: 'lightness band is unreachable',
  },
  {
    // The exact reported bug, pinned as an exact value rather than a shape:
    // #e6e6ee answered 灰白 in the prose, 薰衣草紫 in the list.
    name: "Arceus's primary #e6e6ee falls back to a hue name",
    setup: () => makeTree((f) => patch(f, '  if (l < 0.72) return \'淺灰\';\n  return \'灰白\';', '  if (l < 0.72) return \'淺灰\';\n  return \'淺藍\';')),
    expectText: 'the grey names for the four hexes',
  },
  {
    // The third namer. It shares the gate with the other two and is not on
    // either colour page today, which is exactly why it needs a case: an
    // unpaired gate here is invisible until someone imports it.
    name: 'chineseColorNameWithEn loses its gate (灰白 comes back paired to Lavender)',
    setup: () => makeTree((f) =>
      patch(f, "  if (isNeutral(hex)) {\n    const result = neutralName(hex);\n    colorNameCache.set(cacheKey, result);\n    return result;\n  }\n  const best = nearestTableEntry(rgb);", '  const best = nearestTableEntry(rgb);')
    ),
    expectText: 'chineseColorNameWithEn() still pairs a grey',
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

for (const c of namingCases) {
  let code;
  let out;
  let threw = null;
  try {
    ({ code, out } = runCheckerIn(c.setup()));
  } catch (err) {
    threw = err;
    code = 1;
    out = err.message;
  }
  // The baseline is the only case that expects success; the rest must fail.
  const expectCode = c.expectText ? 1 : 0;
  const wrongCode = code !== expectCode;
  // A harness that throws (stale anchor, missing module) is NOT a passing
  // mutation case -- it is a case that never ran the checker.
  const missingReason = threw || (c.expectText && !caughtBy(out, c.expectText));
  const pass = !wrongCode && !missingReason;

  if (!pass) failed += 1;
  console.log(
    `${pass ? '  ok  ' : '  FAIL'}  ${c.name}` +
      (threw ? `\n          harness threw: ${threw.message}` : '') +
      (wrongCode && !threw ? `  (exit ${code}, expected ${expectCode})` : '') +
      (missingReason && !threw ? `\n          no FAIL line reported: ${c.expectText}\n          ${out.trim().split('\n').slice(0, 4).join('\n          ')}` : '')
  );
}

const total = cases.length + namingCases.length;
console.log(
  failed === 0
    ? `\nall ${total} negative tests behaved as required`
    : `\n${failed} of ${total} negative tests FAILED`
);
process.exit(failed === 0 ? 0 : 1);
