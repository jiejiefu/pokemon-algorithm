/**
 * Regression test for the shadcn token generator in `color-palette.js`.
 *
 *   node scripts/check_color_theme_tokens.mjs
 *
 * THE TEST IS A GOLDEN TEST, AND THAT IS THE ONLY HONEST WAY TO CHECK A
 * TRANSCRIPTION OF AN ALGORITHM WHOSE DATA WE DELIBERATELY DO NOT SHARE.
 *
 * `color_palettes.json` is the MMCQ 6-colour partition of the 96x96 sprites, and
 * `check_color_palettes.mjs` pins it byte-exact. The reference project measured
 * the same sprites with a Canvas `getImageData` scan and got a different
 * palette for all but the leading colours — Bulbasaur is
 *   reference  #399494, #62d5b4, #73ac31, #a4d541, #5cb7a1, #ee2039
 *   ours       #399494, #62d5b4, #83eec5, #73ac31, #bdff73, #ac0031
 * so "does the output match the reference page?" is unanswerable and the
 * question is itself the bug: it invites swapping our data for theirs.
 *
 * So the port is checked the other way round. Feed the generator the
 * *reference's own* palette and demand its own published light and dark values
 * come back byte-for-byte. That is a statement about the ALGORITHM alone, it is
 * insensitive to the data disagreement above, and it is falsifiable: any change
 * to the mapping, the HSL rounding, the ink threshold or the slice length
 * moves at least one of the 64 values.
 *
 * THREE FAILURE MODES THIS FILE EXISTS TO CATCH, each of which produces output
 * that looks correct and is not:
 *
 * 1. Reusing the unrounded `hexToHsl`. The reference rounds H to whole degrees
 *    and S/L to whole percent BEFORE feeding them back through `hslToHex`, so
 *    the rounding is on the data path. Our exported `hexToHsl` deliberately does
 *    not round, for the palette strip's benefit. Borrowing it moves every
 *    derived token by 1-2 per channel.
 * 2. The slice length. Only `chart4`/`chart5` can observe it, because they are
 *    the only tokens built from `pickColor(colors, 3)` / `pickColor(colors, 4)`;
 *    the other 30 read `colors[0..2]` and come out identical for a 3- or 6-long
 *    array. The reference's dark block has `--chart-4: #399494`, which is
 *    `colors[0]`, so its array had period 3. Feed all six and 60 of 64 values
 *    still match while the two chart slots silently name different colours.
 * 3. The `0.55` ink threshold. Asserted directly rather than through a token,
 *    because only 7.67% of palette colours sit in the band where 0.5 and 0.55
 *    disagree, so a fixture built from an unlucky palette would pass either way.
 */

import {
  paletteToThemeTokens,
  REFERENCE_BULBASAUR_PALETTE,
  THEME_TOKEN_KEYS,
  THEME_PREVIEW_ROWS,
  themeCssVar,
  themeVarBlock,
  themeToTailwindV4Css,
  themeToTailwindV3Config,
  themeToJson,
  themeInkFor,
} from '../assets/js/color-palette.js';

let failures = 0;
const fail = msg => { failures += 1; console.log(`FAIL  ${msg}`); };
const pass = msg => console.log(`ok    ${msg}`);

// ---------------------------------------------------------------------------
// The reference's own published output, read off its serialised page:
// the live-preview inline `style` for light, and the Tailwind-v4 code tab's
// `.dark` block for dark. Extracted from
//   pokemonpalette/Bulbasaur color palette (Grass_Poison type, Gen 1).html
// The 30 light values not shown in the preview (destructive-foreground, chart*,
// sidebar*) are the same expressions as dark's, applied to the light builder.
// ---------------------------------------------------------------------------
const REF_LIGHT = {
  background: '#fcfdfd', foreground: '#152828', card: '#ffffff', cardForeground: '#152828',
  popover: '#ffffff', popoverForeground: '#152828', primary: '#399494', primaryForeground: '#ffffff',
  secondary: '#62d5b4', secondaryForeground: '#0a0a0a', muted: '#f2f7f6', mutedForeground: '#62847b',
  accent: '#73ac31', accentForeground: '#0a0a0a', destructive: '#ef4444', destructiveForeground: '#ffffff',
  border: '#e0ebeb', input: '#e0ebeb', ring: '#40a5a5', chart1: '#399494', chart2: '#62d5b4',
  chart3: '#73ac31', chart4: '#399494', chart5: '#62d5b4', sidebar: '#ffffff', sidebarForeground: '#152828',
  sidebarPrimary: '#399494', sidebarPrimaryForeground: '#ffffff', sidebarAccent: '#f2f7f6',
  sidebarAccentForeground: '#152828', sidebarBorder: '#e0ebeb', sidebarRing: '#40a5a5',
};

const REF_DARK = {
  background: '#141a1a', foreground: '#f4f6f6', card: '#1b2727', cardForeground: '#f4f6f6',
  popover: '#1b2727', popoverForeground: '#f4f6f6', primary: '#5abfbf', primaryForeground: '#0a0a0a',
  secondary: '#62d5b5', secondaryForeground: '#0a0a0a', muted: '#253732', mutedForeground: '#98b3ac',
  accent: '#91cd4c', accentForeground: '#0a0a0a', destructive: '#dc2626', destructiveForeground: '#ffffff',
  border: '#2d4343', input: '#2d4343', ring: '#5abfbf', chart1: '#399494', chart2: '#62d5b4',
  chart3: '#73ac31', chart4: '#399494', chart5: '#62d5b4', sidebar: '#1b2727', sidebarForeground: '#f4f6f6',
  sidebarPrimary: '#5abfbf', sidebarPrimaryForeground: '#0a0a0a', sidebarAccent: '#253732',
  sidebarAccentForeground: '#f4f6f6', sidebarBorder: '#2d4343', sidebarRing: '#5abfbf',
};

// The exporter is fed the first 3 colours, not all 6. See failure mode 2.
const SLICE = REFERENCE_BULBASAUR_PALETTE.slice(0, 3);

// --- 1. the golden test ------------------------------------------------------

const bundle = paletteToThemeTokens(SLICE);
for (const theme of ['light', 'dark']) {
  const want = theme === 'light' ? REF_LIGHT : REF_DARK;
  let mismatches = 0;
  for (const key of THEME_TOKEN_KEYS) {
    if (bundle[theme][key] !== want[key]) {
      mismatches += 1;
      fail(`${theme}.${key} (${themeCssVar(key)}): got ${bundle[theme][key]}, reference publishes ${want[key]}`);
    }
  }
  if (mismatches === 0) {
    pass(`${theme}: all ${THEME_TOKEN_KEYS.length} tokens match the reference byte-exact`);
  }
}

// --- 2. the slice length is load-bearing -------------------------------------

// Asserted as a difference in BOTH directions. A one-way check would pass if
// `pickColor` stopped wrapping at all, and the whole point is that the two
// lengths are distinguishable through the chart slots.
const full = paletteToThemeTokens(REFERENCE_BULBASAUR_PALETTE);
if (full.dark.chart4 === bundle.dark.chart4 && full.dark.chart5 === bundle.dark.chart5) {
  fail('chart4/chart5 are identical for a 3- and a 6-colour palette, so the slice length is no longer observable and the fixture below is vacuous');
} else {
  pass(`slice is observable: n=3 -> chart4 ${bundle.dark.chart4} / chart5 ${bundle.dark.chart5}, n=6 -> chart4 ${full.dark.chart4} / chart5 ${full.dark.chart5}`);
}
if (full.light.primary !== bundle.light.primary) {
  fail('light primary changed with the slice length, but the mapping reads only colors[0..2] — something else is reading colors[3+]');
} else {
  pass('the other 30 tokens are slice-insensitive, so a fixture can only catch the slice through chart4/chart5');
}

// --- 3. the ink threshold ----------------------------------------------------

// The threshold decides the ink, and it decides it in the direction
// L > 0.55 -> near-black, L <= 0.55 -> white. So the band where 0.5 and 0.55
// disagree is `0.50 < L <= 0.55`, and inside it a 0.55 threshold gives WHITE
// where a 0.5 threshold would give near-black.
//
// The band is narrow and that is the whole reason this needs a direct
// assertion: 943 of 12,297 palette colours (7.67%, 682 distinct hexes) fall in
// it. Worse, the golden fixture cannot catch a regression here at all — all
// three of its colours sit OUTSIDE the band, so every one of the 64 golden
// values is identical under 0.5 and 0.55. An earlier version of this check
// re-derived the threshold arithmetic in the test instead of calling the
// implementation, agreed with the source no matter what the source said, and
// therefore guarded nothing. Hence `themeInkFor` being exported, and hence the
// fixture-selection assertion below.
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

// Six real palette colours, all verified in-band.
const BAND = ['#838383', '#808080', '#8b8b8b', '#ff4c4c', '#b37d47', '#8b8b94'];
const inBand = BAND.filter(h => lum(h) > 0.5 && lum(h) <= 0.55);
if (inBand.length !== BAND.length) {
  fail(`expected all ${BAND.length} sampled colours in the 0.50 < L <= 0.55 band, found ${inBand.length} (${BAND.map(h => `${h} L=${lum(h).toFixed(4)}`).join(', ')}) — the fixture no longer discriminates the threshold`);
} else {
  pass(`all ${BAND.length} sampled colours sit in the 0.50 < L <= 0.55 band (${BAND.map(h => `${h} L=${lum(h).toFixed(3)}`).join(', ')})`);
}

const wrongInk = BAND.filter(h => themeInkFor(h) !== '#ffffff');
if (wrongInk.length) {
  fail(`themeInkFor takes near-black ink inside the 0.50 < L <= 0.55 band, so the threshold is 0.5 rather than 0.55: ${wrongInk.map(h => `${h} L=${lum(h).toFixed(4)} -> ${themeInkFor(h)}`).join(', ')}`);
} else {
  pass(`themeInkFor takes white ink for all ${BAND.length} band colours, which 0.5 would not do`);
}

// Pinned from the other side too, so neither "any threshold under 0.55" nor
// "any threshold over 0.55" passes.
const outLow = ['#787878', '#6e6e6e', '#5a5a5a'].filter(h => lum(h) <= 0.5);
const outHigh = ['#8f8f8f', '#949494', '#a0a0a0'].filter(h => lum(h) > 0.55);
const outWrong = [
  ...outLow.filter(h => themeInkFor(h) !== '#ffffff'),
  ...outHigh.filter(h => themeInkFor(h) !== '#0a0a0a'),
];
if (outLow.length < 3 || outHigh.length < 3) {
  fail(`the out-of-band fixtures drifted: expected 3 at or below 0.50 and 3 above 0.55, got ${outLow.length} and ${outHigh.length}`);
} else if (outWrong.length) {
  fail(`themeInkFor takes the wrong ink outside the band, so the threshold is not 0.55: ${outWrong.map(h => `${h} L=${lum(h).toFixed(4)} -> ${themeInkFor(h)}`).join(', ')}`);
} else {
  pass(`themeInkFor flips to near-black above the band and stays white below it (${outHigh.map(h => `${h} L=${lum(h).toFixed(3)}`).join(', ')} | ${outLow.map(h => `${h} L=${lum(h).toFixed(3)}`).join(', ')}), so 0.55 is pinned from both sides`);
}

// The reason the two assertions above are load-bearing: record that the golden
// fixture cannot see the threshold. If a future palette edit moved a fixture
// colour into the band, this would start reporting that the golden test has
// become sensitive to something it currently is not.
const fixtureInBand = SLICE.filter(h => lum(h) > 0.5 && lum(h) <= 0.55);
if (fixtureInBand.length) {
  pass(`the golden fixture now has ${fixtureInBand.length} colour(s) inside the band (${fixtureInBand.join(', ')}), so the 64-value golden test has become sensitive to the threshold on its own`);
} else {
  pass(`the golden fixture's ${SLICE.length} colours all sit outside the band (${SLICE.map(h => `${h} L=${lum(h).toFixed(3)}`).join(', ')}), so the 64-value golden test cannot see the threshold — the direct assertions above are the only guard, and the closest fixture colour is #73ac31 at L 0.5527, i.e. 0.0027 above the line`);
}

// --- 4. the ink is actually applied -----------------------------------------

if (bundle.light.secondaryForeground !== '#0a0a0a') {
  fail(`light secondary #62d5b4 has L ${lum('#62d5b4').toFixed(3)}, so its ink must be #0a0a0a, got ${bundle.light.secondaryForeground}`);
} else {
  pass('a light-mode fill takes near-black ink (secondary #62d5b4)');
}
if (bundle.light.primaryForeground !== '#ffffff') {
  fail(`light primary #399494 has L ${lum('#399494').toFixed(3)}, so its ink must be #ffffff, got ${bundle.light.primaryForeground}`);
} else {
  pass('a dark-mode fill takes white ink (primary #399494)');
}

// --- 5. the token vocabulary -------------------------------------------------

// The exact list, in order, is a contract rather than an implementation detail:
// all three serialisers enumerate it, and the golden loop iterates it. So
// deleting a key shrinks every consumer in the same commit and nothing fails —
// which is exactly what the first version of this checker did when `chart5` was
// removed. Pinned as one string so both a deletion and a reorder are caught.
const EXPECTED_KEYS = [
  'background', 'foreground', 'card', 'cardForeground', 'popover', 'popoverForeground',
  'primary', 'primaryForeground', 'secondary', 'secondaryForeground',
  'muted', 'mutedForeground', 'accent', 'accentForeground',
  'destructive', 'destructiveForeground', 'border', 'input', 'ring',
  'chart1', 'chart2', 'chart3', 'chart4', 'chart5',
  'sidebar', 'sidebarForeground', 'sidebarPrimary', 'sidebarPrimaryForeground',
  'sidebarAccent', 'sidebarAccentForeground', 'sidebarBorder', 'sidebarRing',
].join(',');
const actualKeys = THEME_TOKEN_KEYS.join(',');
if (actualKeys !== EXPECTED_KEYS) {
  const missing = EXPECTED_KEYS.split(',').filter(k => !THEME_TOKEN_KEYS.includes(k));
  const extra = THEME_TOKEN_KEYS.filter(k => !EXPECTED_KEYS.split(',').includes(k));
  fail(`the token list changed (${THEME_TOKEN_KEYS.length} keys, expected 32)` +
    (missing.length ? `; missing: ${missing.join(', ')}` : '') +
    (extra.length ? `; unexpected: ${extra.join(', ')}` : '') +
    (missing.length || extra.length ? '' : '; same members, different order — the order is the CSS cascade order and is load-bearing'));
} else {
  pass(`the token list is the expected 32 keys in order, so no token can be dropped without a failure`);
}

const badVars = THEME_TOKEN_KEYS.filter(k => !themeCssVar(k).startsWith('--'));
if (badVars.length) fail(`themeCssVar returned a non-custom-property name for: ${badVars.join(', ')}`);
else pass(`all ${THEME_TOKEN_KEYS.length} token keys map to a --custom-property`);

// Pin the spelling, not just the prefix. shadcn's object keys are camelCase and
// its CSS names are kebab-case, and the mismatch is not mechanical: chart keys
// are `chart1` -> `--chart-1` (digit split) while `sidebarRing` is
// `sidebarRing` -> `--sidebar-ring` (word split). Asserting only `.startsWith('--')`
// let `--cardForeground` through, which is a valid custom-property name that
// Tailwind will never read, so the whole export silently lost a token.
const notKebab = THEME_TOKEN_KEYS.filter(k => !/^--[a-z0-9]+(-[a-z0-9]+)*$/.test(themeCssVar(k)));
if (notKebab.length) {
  fail(`themeCssVar emitted a name that is not lowercase kebab-case, so Tailwind will not resolve it: ${notKebab.map(k => `${k} -> ${themeCssVar(k)}`).join(', ')}`);
} else {
  pass(`all ${THEME_TOKEN_KEYS.length} CSS variable names are lowercase kebab-case, so Tailwind can resolve every one`);
}

// The two irregular groups, spelled out. A generic kebab-case rule would let
// `--chart1` and `--card-foreground` both pass, and both are wrong.
const SPELLINGS = {
  cardForeground: '--card-foreground',
  popoverForeground: '--popover-foreground',
  primaryForeground: '--primary-foreground',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  chart1: '--chart-1',
  chart5: '--chart-5',
  sidebarRing: '--sidebar-ring',
};
const misspelt = Object.entries(SPELLINGS).filter(([k, want]) => themeCssVar(k) !== want);
if (misspelt.length) {
  fail(`themeCssVar spells these wrong: ${misspelt.map(([k, want]) => `${k} -> ${themeCssVar(k)}, want ${want}`).join('; ')}`);
} else {
  pass(`the irregular groups are spelled right: chart1 -> --chart-1 (digit split) and cardForeground -> --card-foreground (word split), which a single mechanical rule cannot produce`);
}

if (new Set(THEME_TOKEN_KEYS.map(themeCssVar)).size !== THEME_TOKEN_KEYS.length) {
  fail('themeCssVar is not injective — two token keys emit the same CSS variable, so one silently overwrites the other');
} else {
  pass('themeCssVar is injective, so no emitted variable can shadow another');
}

const badRows = THEME_PREVIEW_ROWS.filter(r => !THEME_TOKEN_KEYS.includes(r.key));
if (badRows.length) fail(`preview rows name keys that are not tokens: ${badRows.map(r => r.key).join(', ')}`);
else pass(`all ${THEME_PREVIEW_ROWS.length} preview rows name real tokens`);

// --- 6. the serialisers ------------------------------------------------------

const vb = themeVarBlock(bundle.light);
if (/--color--/.test(vb)) {
  fail('themeVarBlock emits a double dash (--color--background); the alias prefix must replace the leading --, not append to it');
} else {
  pass('themeVarBlock emits no double-dashed alias');
}
const declCount = vb.split('; ').length;
if (declCount !== THEME_TOKEN_KEYS.length * 2) {
  fail(`themeVarBlock emitted ${declCount} declarations, expected ${THEME_TOKEN_KEYS.length * 2} (each token plus its --color- alias)`);
} else {
  pass(`themeVarBlock emits ${declCount} declarations (token + --color- alias for each of ${THEME_TOKEN_KEYS.length})`);
}

const css4 = themeToTailwindV4Css(bundle, { pokemonName: 'Bulbasaur' });
for (const part of [':root {', '.dark {', '@theme inline {']) {
  if (!css4.includes(part)) fail(`Tailwind v4 output is missing ${part}`);
}
if (css4.split('--primary:').length - 1 !== 2) {
  fail(`Tailwind v4 output should declare --primary exactly twice (:root and .dark), found ${css4.split('--primary:').length - 1}`);
} else {
  pass('Tailwind v4 output has :root, .dark and @theme inline, and declares --primary exactly twice');
}

const cfg3 = themeToTailwindV3Config(bundle, { pokemonName: 'Bulbasaur' });
if (!/--primary: \d+ \d+% \d+%;/.test(cfg3)) {
  fail('Tailwind v3 output is not in bare HSL triplets, which is what hsl(var(--x)) needs');
} else {
  pass(`Tailwind v3 output uses bare HSL triplets (${(cfg3.match(/--primary: [^;]+;/) || [''])[0]})`);
}

const json = JSON.parse(themeToJson(bundle, { pokemonName: 'Bulbasaur' }));
for (const key of ['name', 'generatedBy', 'palette', 'light', 'dark']) {
  if (!(key in json)) fail(`JSON output is missing "${key}"`);
}
if (json.generatedBy !== 'pokemon-algorithm') {
  fail(`JSON generatedBy should credit this project, got "${json.generatedBy}"`);
}
if (json.palette.length !== 3) {
  fail(`JSON should record the palette it was actually given (3), got ${json.palette.length}`);
} else {
  pass('JSON output carries all five keys and records the sliced palette, not the full one');
}

// --- 7. light and dark are genuinely different -------------------------------

// Asserted as an exact partition, in both directions. A "these should differ"
// list alone would pass a builder that had stopped deriving anything; the
// complementary list is what stops a token silently moving into it.
//
// MAY_BE_EQUAL, with the reason each is not a bug:
//   destructiveForeground  a literal `#ffffff` in both builders.
//   chart1..5              the raw palette, echoed, so by definition untinted.
//   secondaryForeground,
//   accentForeground       `themeInk(lifted)`. The dark builder lifts lightness
//                          to at least 55%, but a colour that was already light
//                          (secondary #62d5b4 is L 51, lifted to 55) is still
//                          below the 0.55 ink threshold after the lift, so both
//                          variants take near-black. Their FILLS do differ —
//                          that is the pair asserted below.
const MAY_BE_EQUAL = new Set([
  'destructiveForeground', 'chart1', 'chart2', 'chart3', 'chart4', 'chart5',
  'secondaryForeground', 'accentForeground',
]);
// Every derived surface plus every lifted accent must move. If the dark builder
// regressed to a copy of the light one, these would all collapse.
const MUST_DIFFER = THEME_TOKEN_KEYS.filter(k => !MAY_BE_EQUAL.has(k));

const same = THEME_TOKEN_KEYS.filter(k => bundle.light[k] === bundle.dark[k]);
const unexpectedSame = same.filter(k => !MAY_BE_EQUAL.has(k));
const unexpectedlyDifferent = MUST_DIFFER.filter(k => bundle.light[k] === bundle.dark[k]);

if (unexpectedSame.length) {
  fail(`these tokens are equal across themes but the mapping says they should not be, so the dark builder is not being exercised: ${unexpectedSame.join(', ')}`);
}
if (unexpectedlyDifferent.length) {
  fail(`these tokens must differ across themes but are equal: ${unexpectedlyDifferent.join(', ')}`);
}
if (!unexpectedSame.length && !unexpectedlyDifferent.length) {
  pass(`the light/dark partition is exact: ${MUST_DIFFER.length} derived tokens differ, ${same.length} documented echoes are equal (${same.join(', ')})`);
}

if (bundle.light.primary === bundle.dark.primary) {
  fail('light and dark primary are identical; the dark builder lifts lightness to at least 55% and should not be a no-op here');
} else {
  pass(`the dark lift is live: primary ${bundle.light.primary} (light) -> ${bundle.dark.primary} (dark)`);
}

// --- 8. the empty palette still renders -------------------------------------

const fallback = paletteToThemeTokens([]);
if (fallback.palette.length === 0) fail('an empty palette should fall back, not produce an empty token set');
else if (bundle.light.primary === fallback.light.primary) {
  fail('the empty-palette fallback resolved to the same primary as a real palette; the guard is probably unreachable');
} else {
  pass(`an empty palette falls back to ${fallback.palette.join(' ')} instead of throwing`);
}

console.log();
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All theme-token checks passed');
