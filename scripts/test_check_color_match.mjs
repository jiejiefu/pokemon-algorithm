#!/usr/bin/env node
/**
 * Prove check_color_match.mjs can actually fail.
 *
 * Run: node scripts/test_check_color_match.mjs
 *
 * Each case copies the tree, breaks one thing, and requires the checker to exit
 * non-zero with a message naming THAT problem. `caughtBy` from lib/negative.mjs
 * does the matching, because a checker prints an assertion's description whether
 * it passes or fails — so asking "did this text appear" is the same as asking
 * nothing. See §4 of AGENTS.md.
 *
 * WHY THIS FILE IS NOT A LIST OF TRIVIAL MUTATIONS
 *
 * The obvious way to break the matcher is to change a constant, and every one
 * of those mutations is caught by whichever assertion happens to mention the
 * number. That makes the suite green and the checker unverified: the cases pass
 * for an incidental reason, exactly the shape §4 documents in the gen1_apu
 * table. So the cases below are weighted toward mutations that leave every
 * constant alone and change the ALGORITHM — the ones a reviewer would actually
 * make by accident:
 *
 *   - swapping OKLab for the RGB Euclidean distance the §3.B2 notes warn about,
 *   - ranking by "closest colour anywhere in the palette" instead of by primary,
 *   - dropping the per-species dedupe,
 *   - reordering the tiebreak chain,
 *   - indexing shiny palettes out of existence,
 *   - reading `rows[1]` as the secondary when a palette has one colour.
 *
 * Four of the cases below FAILED WHEN FIRST WRITTEN, and every one of them was a
 * weak assertion rather than a bad expectation. They are kept and explained,
 * because a suite with no failures in its first run is a suite that has not been
 * asked a hard question yet.
 */

import {
  cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy, failLines } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_color_match.mjs';
/**
 * The checker imports `color-match.js` AND `color-palette.js` (for the real
 * `hslToHex`, `hexToHsl` and `formatHex` the parser and the HSL-drift
 * assertions are measured against), so the whole `assets/js` tree is copied.
 *
 * Copying the two files by hand is how this suite broke the first time: the
 * scratch tree was missing `color-palette.js`, every case failed with
 * `ERR_MODULE_NOT_FOUND`, and a loader error at PARSE time means the checker
 * never runs a single assertion — so all twenty-three cases "failed" while
 * proving nothing. The same reason §3.B2 copies `assets/js` wholesale: the
 * imports chain (`color-palette.js` → `shared.js` → `form-names.js`,
 * `shiny-index.js`) and a case that dies on a missing module passes for the
 * wrong reason. The baseline case is what proves the tree is sound.
 */
const JS_TREE = readdirSync(join(ROOT, 'assets/js'))
  .filter(f => f.endsWith('.js'))
  .map(f => `assets/js/${f}`);

const SRC = [
  ...JS_TREE,
  'assets/data/color_palettes.json',
  'assets/data/pokemon_data.json',
  'assets/css/shared.css',
  'assets/css/colors-generator.css',
  'colors.html',
  CHECKER,
];

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeTree(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'colormatch-neg-'));
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
    });
    return { code: 0, out: `${stdout}` };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Rewrite the matcher module in the scratch tree. */
const editModule = (dir, fn) => {
  const p = join(dir, 'assets/js/color-match.js');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

/** Rewrite colors.html in the scratch tree. */
const editPage = (dir, fn) => {
  const p = join(dir, 'colors.html');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

/** Rewrite the generator stylesheet in the scratch tree. */
const editCss = (dir, fn) => {
  const p = join(dir, 'assets/css/colors-generator.css');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

/** A `replace` that refuses to be silent.
 *
 *  A case whose target string no longer exists reports PASS having changed
 *  nothing, and there were two of those in this file. Every page-level mutation
 *  below goes through here so that a drifted edit is a loud failure rather than
 *  a green line proving nothing. */
const replaceOrThrow = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutation target not found: ${JSON.stringify(from)}`);
  return src.replace(from, to);
};

/** Rewrite the corpus in the scratch tree. */
const editPalettes = (dir, fn) => {
  const p = join(dir, 'assets/data/color_palettes.json');
  const data = JSON.parse(readFileSync(p, 'utf8'));
  fn(data);
  writeFileSync(p, JSON.stringify(data));
};

const CASES = [
  // -----------------------------------------------------------------------
  // The metric
  // -----------------------------------------------------------------------

  {
    // THE case this whole file exists for. §3.B2 records nearest-in-RGB naming
    // #414141 墨綠 because a tinted entry 8 away in one channel beat every grey
    // 20 away in all three. The mutation is a REAL RGB swap — `hexToOklab`
    // replaced by plain 8-bit channel extraction and `deltaEOk` by channel
    // euclidean — not a rescaling of the OKLab coordinates.
    //
    // That distinction cost this case its first run. The original mutation
    // multiplied the OKLab coordinates by 255, which is a change of UNITS: every
    // distance scales by 255 and every RANKING is unchanged, so it could only
    // ever trip the absolute-value assertions. The grey assertion compares two
    // distances, so it is scale-invariant and passed. A mutation that cannot
    // change any output the check reads is not a mutation.
    //
    // Measured inversions for the detector below, found by scanning the corpus:
    // for #414141, RGB euclidean ranks #399494 nearer (117.7) while OKLab ranks
    // #7362ac nearer (0.2043 vs 0.2526). Seven such inversions exist among the
    // corpus colours for that grey.
    name: 'OKLab is replaced by RGB Euclidean distance — the §3.B2 metric',
    mutate: (dir) => editModule(dir, (s) => {
      const before = s;
      const out = s
        .replace(
          `export function hexToOklab(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));`,
          `export function hexToOklab(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];`,
        )
        .replace(
          `  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];`,
          `  return [r, g, b];`,
        );
      if (out === before) throw new Error('RGB swap did not apply');
      return out;
    }),
    expect: 'a tint that is nearer in RGB is not nearer perceptually',
  },
  {
    name: 'the chroma rows of the OKLab matrix are dropped',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      `  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];`,
      `  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 0, 0];`,
    )),
    // Also NOT the grey assertion, and this is the interesting one. With the a
    // and b rows zeroed, every colour collapses onto the lightness axis — and a
    // grey stays near greys even then, because #414141 (L 0.3753) really is
    // closer to #3a3a3a (L 0.3485) than to #0b3d0b (L 0.3159). So
    // "#414141 is closer to a grey than to a dark green" PASSES under this
    // mutation. §3.B2's lesson in its purest form: the check that reads like the
    // guard is not the guard. A saturated red's chroma coordinates are the ones
    // that cannot be produced by an axis-only metric.
    expect: 'a saturated red has a large positive a coordinate',
  },
  {
    name: 'the sRGB transfer function is replaced with a plain gamma 2.2',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      'return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);',
      'return Math.pow(v, 2.2);',
    )),
    // NOT the white assertion. `#ffffff has L = 1` passes under ANY transfer
    // function — 1.0 is 1.0 however it is decoded — so this mutation sailed past
    // it on the first run. The mid-grey assertion is the detector: #808080 reads
    // 0.599871 here and 0.603241 under gamma 2.2, against a 1e-4 tolerance.
    // Naming the wrong assertion here would have been the §4 mistake: the case
    // would have failed for the right reason while claiming credit for the wrong one.
    expect: '#808080 lands at OKLab L = 0.5999',
  },
  {
    name: 'a 3-digit hex is accepted as if it were 6-digit',
    mutate: (dir) => editModule(dir, (s) => {
      const before = s;
      const after = s.replace(
        "if (h.length === 3) h = h.split('').map((c) => c + c).join('');",
        "",
      );
      if (after === before) throw new Error('3-digit shorthand mutation did not apply');
      return after;
    }),
    expect: '#fff expands to the same colour as #ffffff',
  },

  // -----------------------------------------------------------------------
  // The ranking rule
  // -----------------------------------------------------------------------

  {
    // The product rule is "主色為主、附色輔助". Ranking by the closest colour
    // ANYWHERE in the six is the rule a reader would assume from the word
    // "closest", and it is wrong: it lets a species win on a colour the reader
    // will not see.
    name: 'ranking switches to the closest colour anywhere in the palette',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      `    const d = deltaEOk(lab, g.primary.lab);
    const dSec = g.secondary ? deltaEOk(lab, g.secondary.lab) : Infinity;`,
      `    const d = Math.min(
      deltaEOk(lab, g.primary.lab),
      ...[g.secondary, ...g.rest].filter(Boolean).map((e) => deltaEOk(lab, e.lab))
    );
    const dSec = g.secondary ? deltaEOk(lab, g.secondary.lab) : Infinity;`,
    )),
    expect: 'the species whose PRIMARY is the input wins over one that merely contains it',
  },
  {
    // There is no dedupe pass to remove any more — one group per species makes
    // duplicates unreachable, which is the point of excluding shiny. So this
    // case attacks the guarantee from the other side: two groups for one id,
    // which is the only way a species can now appear twice. It fails the GROUP
    // count and the distinct-species assertion, and it is here because "the
    // dedupe was removed" no longer exists as a mutation to write.
    name: 'one species gets two groups, so it can appear twice in a result list',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      '      g = { id: e.id, primary: e, secondary: null, rest: [] };\n      groups.set(e.id, g);',
      '      g = { id: e.id, primary: e, secondary: null, rest: [] };\n      groups.set(e.id, g);\n      groups.set(`${e.id}:dup`, { ...g, id: e.id });',
    )),
    expect: 'every probe returns five DISTINCT species',
  },
  {
    // The chain is primary, then secondary, then id. Promoting the secondary
    // above the primary looks like a harmless "prefer richer matches" tweak and
    // inverts the product rule entirely.
    name: 'the tiebreak chain is reversed: secondary decides before primary',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      `  scored.sort((a, b) => (
    a.d - b.d
    || a.dSec - b.dSec`,
      `  scored.sort((a, b) => (
    a.dSec - b.dSec
    || a.d - b.d`,
    )),
    // NOT the tiebreak-chain assertion, which also passed. On #ffffff all five
    // primaries are at distance 0, so reversing the chain compares dSec first
    // across five equal d values and lands in the same order. What catches the
    // reversal is the fixture whose two species have different primaries AND
    // different secondaries.
    expect: 'the species whose PRIMARY is the input wins over one that merely contains it',
  },
  {
    name: 'the final tiebreak goes from ascending id to descending',
    mutate: (dir) => editModule(dir, (s) => {
      const before = s;
      const out = s.replace('    || a.g.id - b.g.id', '    || b.g.id - a.g.id');
      if (out === before) throw new Error('id tiebreak mutation did not apply');
      return out;
    }),
    expect: 'with primary and secondary both identical, the lower id wins',
  },
  {
    // THE EXCLUSION, AS A MUTATION. Shiny palettes are deliberately out of the
    // index; putting them back is the most plausible regression, because it
    // makes answers BETTER (the median distance drops by 0.0026) and nothing
    // about the output looks wrong. The group count is what notices.
    name: 'shiny palettes are put back into the index',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      `    const rows = palettes[key]?.n;
    if (!Array.isArray(rows)) continue;`,
      `    const rows = palettes[key]?.n;
    if (!Array.isArray(rows)) continue;
    const shiny = palettes[key]?.s;
    if (Array.isArray(shiny)) for (const [h, sh] of shiny) {
      const lab = hexToOklab(h);
      if (lab) entries.push({ id, hex: h, lab, share: sh });
    }`,
    )),
    // NOT the group count: appending shiny rows into an EXISTING group leaves
    // the count at 1,025, so that assertion passes while the answers are wrong.
    // The colour count is what notices, because the index is supposed to hold
    // 6,148 and now holds 12,297.
    expect: 'the index holds every NORMAL-palette colour',
  },

  // -----------------------------------------------------------------------
  // The index
  // -----------------------------------------------------------------------

  {
    // Dropping `n` and keeping only `s` is the mirror of putting shiny back: the
    // counts change by the same amount in the other direction, so the two cases
    // together show the count is reading the data and not matching a constant.
    name: 'normal palettes are dropped from the index',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      'const rows = palettes[key]?.n;',
      'const rows = palettes[key]?.s;',
    )),
    expect: 'the index holds every NORMAL-palette colour',
  },
  {
    // The index trusts color_palettes.json's rows being share-descending. If a
    // future regeneration stops sorting them, `primary` stops meaning "the
    // colour you actually see", and only a corpus assertion notices — every
    // shape check passes with a merely-valid first row.
    name: 'a palette row is reordered so the rarest colour comes first',
    mutate: (dir) => editPalettes(dir, (d) => { d['25'].n.reverse(); }),
    // NOT the membership assertion, which passes: reversing a palette's rows
    // leaves every colour still present, so "present in the corpus rows" holds.
    // What fails is that the reported primary is no longer the highest-share
    // colour — which is the entire claim the index makes by trusting row order.
    expect: 'the reported primary is the highest-share colour',
  },
  {
    name: 'a species is dropped from the corpus',
    mutate: (dir) => editPalettes(dir, (d) => { delete d['7']; }),
    expect: 'the corpus is 6,148 colours',
  },

  // -----------------------------------------------------------------------
  // Data shapes
  // -----------------------------------------------------------------------

  {
    // A palette can be one colour. Reading rows[1] unconditionally then reports
    // `undefined` as a hex, which renders as an empty swatch and copies an empty
    // string — the failure `formatHex`'s docblock calls the one clipboard result
    // nobody can notice they got wrong.
    name: 'the secondary falls back to undefined instead of the primary',
    // `replaceAll`, not `replace`: that line exists in BOTH matchOf and
    // matchPokemon, and a single `replace` hits whichever came first — which
    // after matchOf was added is not the one this case claims to attack. The
    // case passed for a fourth reason, the same class as the dead `replace()`
    // target above.
    mutate: (dir) => editModule(dir, (s) => {
      const before = s;
      const out = s.replaceAll(
        '    secondaryHex: g.secondary ? g.secondary.hex : g.primary.hex,',
        '    secondaryHex: g.secondary ? g.secondary.hex : undefined,',
      );
      if (out === before) throw new Error('secondary fallback mutation did not apply');
      return out;
    }),
    expect: 'a one-colour palette reports its primary as its own secondary',
  },
  {
    name: 'a missing group returns an empty palette instead of null',
    mutate: (dir) => editModule(dir, (s) => {
      const before = s;
      const out = s.replace(
        '  const g = groups.get(id);\n  if (!g) return null;',
        '  const g = groups.get(id);\n  if (!g) return [];',
      );
      if (out === before) throw new Error('paletteOf null-fallback mutation did not apply');
      return out;
    }),
    // The other assertion that can catch it, and the one that states the
    // contract: "not in the index" and "has one colour" must be distinguishable
    // at the call site.
    expect: 'a species outside the index returns null',
  },
  {
    name: 'a query before the index is built returns the full corpus anyway',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      `  if (!groups) {
    if (!index) return [];
    buildGroups();
  }`,
      `  if (!groups) {
    if (!index) return [{ rank: 0, id: 1, variant: 'n', distance: 0 }];
    buildGroups();
  }`,
    )),
    expect: 'querying without an index returns empty rather than throwing or guessing',
  },
  {
    name: 'an unparseable hex falls back to a default colour',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      `export function matchPokemon(hex, n = 5) {
  const lab = hexToOklab(hex);
  if (!lab) return [];`,
      `export function matchPokemon(hex, n = 5) {
  const lab = hexToOklab(hex) || hexToOklab('#000000');
  if (!lab) return [];`,
    )),
    expect: 'an unparseable query returns empty rather than falling back to a default colour',
  },

  // -----------------------------------------------------------------------
  // The cross-check itself
  // -----------------------------------------------------------------------

  {
    // The most important case in the file. The order comparison is
    // noise-tolerant, so a NOISE wide enough to merge unrelated probes makes it
    // vacuously true — which is §4's failure shape wearing a green check. The
    // case that catches it is the one asserting the tie grouping still separates
    // distances 1e-3 apart.
    name: 'the cross-check noise floor is widened until the order test is vacuous',
    mutate: (dir) => {
      const p = join(dir, CHECKER);
      writeFileSync(p, readFileSync(p, 'utf8').replace('const NOISE = 1e-9;', 'const NOISE = 1.0;'));
    },
    expect: 'tie grouping separates distances 1e-3 apart',
  },
  {
    // Without this, the cross-check can agree with itself: if the module returned
    // one species for every probe, both sides would produce a well-formed
    // one-entry list and the comparison would pass.
    name: 'the match list is truncated to a single result',
    mutate: (dir) => editModule(dir, (s) => s.replace(
      'const limit = Math.max(1, n);',
      'const limit = 1;',
    )),
    expect: 'all 20 probes return the brute-force order, up to float noise',
  },
  {
    // The page-level guards. These read colors.html and the stylesheet, so three
    // of the four are things a mutation in the module cannot reach at all — they
    // are here to prove the PAGE assertions are not vacuous, not to attack the
    // matcher. Each asserts the mutation actually applied: an earlier draft of
    // this block was inserted against a comment that did not exist, so all four
    // cases silently never ran and the suite still reported PASS.
    name: 'the legendary grid drops to 7 columns on desktop',
    mutate: (dir) => editCss(dir, (s) => replaceOrThrow(
      s, 'grid-template-columns: repeat(8, minmax(0, 1fr));',
      'grid-template-columns: repeat(7, minmax(0, 1fr));')),
    expect: 'the legendary grid is 8 across on desktop',
  },
  {
    name: 'a legendary that is neither legendary nor mythical is on the roster',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s, "[150, '關都 · 銀']", "[175, '關都 · 銀']")),
    expect: 'and every one is legendary or mythical, as the heading says',
  },
  {
    name: 'markdown emphasis leaks back into the prose',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s, '真的含有</strong>', '**真的含有**')),
    expect: 'no markdown emphasis leaks into the HTML as literal asterisks',
  },
  {
    // The pin's escape hatch. An unconditional exemption keeps the pinned
    // species on screen after the reader types an unrelated colour, which is the
    // mirror of the defect the narrow condition exists to prevent.
    // The defect is in the pinned branch's CONDITION, not in which branch is
    // taken. `if (match.pinned || true)` sends UNPINNED matches down the pin path
    // and leaves pinned ones behaving correctly, so it trips a different
    // assertion and is not this case at all — the first draft of this mutation,
    // and it failed for that reason.
    name: 'a pin is exempt from re-ranking unconditionally',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s,
      'return own.some(({ hex: h }) => h.toLowerCase() === inputHex.toLowerCase());',
      'return true;',
    )),
    expect: 'but NOT after an unrelated colour is typed',
  },
  {
    // The removals. Each case puts ONE thing back, and the guard that catches it
    // has to be the one naming that thing — which is why the checks assert the
    // ABSENCE rather than a count, since a count would still pass at 7.
    name: 'the measured palette section comes back',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s,
      '    <section class="cp-section" aria-labelledby="sec-gen-tiles">',
      '    <section class="cp-section" aria-labelledby="sec-measured"><h2 id="sec-measured">x</h2></section>\n\n    <section class="cp-section" aria-labelledby="sec-gen-tiles">',
    )),
    expect: 'the measured palette section is not on colors.html',
  },
  {
    name: 'the showcase import is left behind after the removal',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s, '      formatShare, formatHex, HEX_FORMATS, hslToHex,',
      '      showcaseHtml, wireShowcaseTabs, formatShare, formatHex, HEX_FORMATS, hslToHex,')),
    expect: 'no showcase import survives the removal',
  },
  {
    name: 'the generated ramp stops tracking the input colour',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s, 'const { scale, anchor } = generateTailwindScale(inputHex);',
      'const { scale, anchor } = generateTailwindScale(m ? m.primaryHex : inputHex);')),
    expect: 'the ramp is still derived from the INPUT colour for the export',
  },
  {
    // The page's own copy. The meta description kept promising 「生成明暗階、套用展示」
    // after both sections were deleted, and the intro kept claiming two kinds of
    // content side by side. A search-result summary and the first paragraph are
    // the two places a reader is most likely to believe, and no other check reads
    // either.
    name: 'the meta description promises the removed showcase and ramp again',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s, '生成一組有量測基礎的主題色盤與 CSS 變數。',
      '生成明暗階、主題變數與套用展示。')),
    expect: 'the page never promises a component showcase it does not render',
  },
  {
    name: 'an element reference survives for a removed container',
    mutate: (dir) => editPage(dir, (s) => replaceOrThrow(
      s, "      tiles: document.getElementById('tiles'),",
      "      tiles: document.getElementById('tiles'),\n      scale: document.getElementById('scale'),")),
    expect: 'no element reference survives for a container that was removed',
  },
  {
    // Removing the guard that proves the primary-first rule is exercised by real
    // data is the difference between "the rule is tested" and "the rule could be
    // deleted and the cross-check would still pass".
    name: 'the assertion that primary-first is exercised by real data is removed',
    mutate: (dir) => {
      const p = join(dir, CHECKER);
      writeFileSync(p, readFileSync(p, 'utf8').replace(
        "  check(sawContender,",
        "  check(true,",
      ));
    },
    // This one is NOT a "did it fail" case. Disabling the guard must leave the
    // checker green — that is the whole claim being documented: the guard is
    // removable, so the primary-first rule is protected by assertions that
    // DEPEND on it (the fixture cases above), not by the guard alone. Removing
    // it is silent, which is why the dependent cases exist and why this one is
    // `expect: null` rather than a string to match.
    expect: null,
  },
];

const baseline = run(makeTree(null));
ok('baseline: the checker passes on an unmutated copy of the tree', baseline.code === 0,
  baseline.code === 0 ? '' : baseline.out.split('\n').slice(-8).join('\n'));

if (baseline.code !== 0) {
  console.log('\nbaseline output:\n' + baseline.out);
  process.exit(1);
}

for (const c of CASES) {
  const dir = makeTree(c.mutate);
  let r;
  try {
    r = run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The last case is a REMOVAL of a guard: it is expected to leave the checker
  // green, so what it asserts is that the guard's own description is what makes
  // the removal visible to a reader. Treated as a case, it would fail.
  if (c.expect === null) {
    const removed = r.code === 0;
    ok(c.name, removed, removed ? '' : 'expected the removal to be silent, and it was not');
    continue;
  }
  const named = r.code !== 0 && caughtBy(r.out, c.expect);
  ok(c.name, named, named ? ''
    : `exit ${r.code}, expected the checker to report "${c.expect}" on a FAIL line; it said:\n${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`);
}

// A case inserted against a comment that no longer exists is a case that never
// runs, and the suite still reports PASS — the same shape as a mutation whose
// `replace()` target drifted. Assert the roster is intact so the count is a
// claim about the file and not about the last successful insertion.
ok(`the suite declares every case it runs (${CASES.length})`,
  CASES.every(c => typeof c.name === 'string' && typeof c.mutate === 'function')
    && CASES.every(c => c.expect === null || typeof c.expect === 'string'),
  `${CASES.length} cases`);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');