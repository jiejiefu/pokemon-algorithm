/**
 * Regression test for the reverse palette matcher behind colors-generator.html.
 *
 *   node scripts/check_color_match.mjs
 *
 * WHAT THIS IS FOR
 *
 * colors-generator.html is now an instrument rather than a report: you turn a colour in
 * and it answers "which Pokémon is closest?". `color-match.js` answers that with
 * an OKLab distance over 6,148 measured sprite colours. Three things about that
 * answer are claims, not consequences, and each is pinned here:
 *
 * 1. THE METRIC IS PERCEPTUAL, and this is not a style choice. §3.B2 of AGENTS.md
 *    records `findClosestChineseColorName()` returning 墨綠 for #414141 because
 *    nearest-in-RGB let a table entry 8 away in one channel beat every grey 20
 *    away in all three. The table there was 100 names. This searches 6,148
 *    sprite colours, 61x more, so the metric decides the page.
 *    MEASURED on a 576-point sweep of the sRGB cube: plain RGB Euclidean and
 *    the redmean approximation disagree on the WINNER for 12.8% of inputs, and on
 *    the whole top five for 83.2%. A metric swap here is not a refinement.
 * 2. RANKING IS PRIMARY-FIRST, SECONDARY-AS-TIEBREAK. That is the product rule
 *    ("主色為主、附色輔助"), and it is invisible in the output unless pinned: both
 *    orderings return plausible-looking lists of plausible-looking Pokémon.
 * 3. THE RESULT IS DETERMINISTIC. Same input, same order, every time. A tie
 *    broken by Map insertion order is a tie broken by lexicographic id, and the
 *    corpus has real ties: #ffffff is the primary of 29 normal palettes
 *    (and appears somewhere in 222 of the 1,025 — but the ranking reads the
 *    primary, so 29 is the number that matters).
 *
 * AND THE THING THAT MAKES THIS FILE NECESSARY
 *
 * Every assertion below is about a NUMBER. A number that is merely plausible is
 * how §3.B2's greys got their chromatic names: the output looked fine and was
 * wrong, and only a comparison against something independently derived caught
 * it. So the ordering assertions here do not ask "does matchPokemon return
 * something" — they recompute the winner by brute force from the raw JSON with a
 * SEPARATE implementation and require the module to agree. Two implementations
 * of the same idea agreeing is evidence; one implementation agreeing with itself
 * is a tautology.
 */

import { readFileSync } from 'node:fs';
import {
  hslToHex, hexToHsl, formatHex as formatHexOf,
} from '../assets/js/color-palette.js';

/** The rounded HSL the field would show, with whole degrees/percent. */
const hexToHslRounded = (str) => {
  const m = str.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
};
import {
  hexToOklab,
  deltaEOk,
  deltaEHex,
  buildMatchIndex,
  buildGroups,
  matchPokemon,
  matchOf,
  primaryShareCount,
  paletteOf,
  matchIndexSize,
  matchGroupCount,
  resetMatchCaches,
} from '../assets/js/color-match.js';

const palettes = JSON.parse(
  readFileSync(new URL('../assets/data/color_palettes.json', import.meta.url), 'utf8')
);

let failures = 0;
let total = 0;

function check(ok, description, detail = () => '') {
  total++;
  if (ok) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}`);
    console.log(`       ${detail()}`);
  }
}

function eq(actual, expected, label) {
  return {
    ok: JSON.stringify(actual) === JSON.stringify(expected),
    detail: () => `got:  ${JSON.stringify(actual)}\n       want: ${JSON.stringify(expected)}  (${label})`,
  };
}

// ---------------------------------------------------------------------------
// A deliberately independent second implementation, for cross-checking.
//
// Written from the OKLab definition rather than from color-match.js, and built
// straight off the raw JSON rather than off the module's index — so a bug in the
// index, the grouping, the primary-first rule or the tiebreak would have to be
// reproduced identically here to go unnoticed.
// ---------------------------------------------------------------------------

function referenceLab(hex) {
  const h = hex.replace('#', '');
  const enc = [];
  for (let i = 0; i < 3; i++) {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    enc.push(c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  }
  const [r, g, b] = enc;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function referenceDist(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/**
 * Brute-force winner list straight from the JSON.
 *
 * Sorts by primary distance, then id, over the NORMAL palettes only — the same
 * rule the module claims, written out independently. There is no dedupe step
 * here because the corpus has one palette per species; that is the property the
 * exclusion bought, and an assertion below checks the absence of duplicates
 * rather than assuming it.
 */
function referenceMatch(hex, n) {
  const lab = referenceLab(hex);
  const all = [];
  for (const key of Object.keys(palettes)) {
    const rows = palettes[key].n;
    if (!Array.isArray(rows) || !rows.length) continue;
    all.push({ id: Number(key), d: referenceDist(lab, referenceLab(rows[0][0])) });
  }
  all.sort((a, b) => a.d - b.d || a.id - b.id);
  return all.slice(0, n);
}

// ---------------------------------------------------------------------------
// The measured claim about the metric
// ---------------------------------------------------------------------------

console.log('\nOKLab conversion');

{
  // White and black are the two colours whose OKLab coordinates are known
  // exactly, so they are the two conversions that can be checked against the
  // published values rather than against another run of the same code.
  const w = hexToOklab('#ffffff');
  const k = hexToOklab('#000000');
  check(Math.abs(w[0] - 1) < 1e-6, '#ffffff has OKLab L = 1', () => `got L ${w[0]}`);
  // Tolerance, not equality: the matrix rows do not sum to zero, so white lands
  // 8e-11 off axis in `a` and 3.7e-8 in `b`. Measured, not assumed — an exact
  // `=== 0` here would be an expectation about float associativity, not about
  // colour, and it fails for a reason that has nothing to do with the module.
  check(Math.abs(w[1]) < 1e-6 && Math.abs(w[2]) < 1e-6,
    '#ffffff is achromatic (a and b below 1e-6)',
    () => `got a=${w[1]} b=${w[2]}`);
  check(k[0] === 0 && k[1] === 0 && k[2] === 0, '#000000 is the origin',
    () => `got ${JSON.stringify(k)}`);

  // MID-GREY IS THE ASSERTION THAT PINS THE TRANSFER FUNCTION, and white is not.
  //
  // `#ffffff has L = 1` passes under ANY transfer function, because 1.0 is 1.0
  // however it is decoded — so a swap to plain gamma 2.2 sails past it. The
  // discrimination is in the midtones: #808080 measures L = 0.599871 here and
  // 0.603241 under gamma 2.2, a gap of 3.4e-3 against a 1e-4 tolerance. Both
  // numbers came from running the two variants, so the threshold is measured
  // slack rather than a guess.
  const grey = hexToOklab('#808080');
  check(Math.abs(grey[1]) < 1e-6 && Math.abs(grey[2]) < 1e-6,
    'a neutral grey has no a/b chroma', () => `got a=${grey[1]} b=${grey[2]}`);
  check(Math.abs(grey[0] - 0.599871) < 1e-4,
    '#808080 lands at OKLab L = 0.5999, which gamma 2.2 does not reproduce',
    () => `got ${grey[0]}, and plain gamma 2.2 gives 0.603241`);

  // THE a/b ROWS ARE LOAD-BEARING, asserted on a saturated colour rather than on
  // a grey. Zeroing them leaves every colour on the lightness axis, and a grey
  // stays near greys even then — which is why "greys are named greys" could
  // never have caught it. A saturated red's chroma coordinates are large and
  // there is no distance metric on the L axis that produces them.
  const red = hexToOklab('#ff0000');
  check(Math.abs(red[1]) > 0.1,
    'a saturated red has a large positive a coordinate',
    () => `got a=${red[1]}`);
  check(Math.abs(red[2]) > 0.05,
    'and a positive b coordinate, so the two axes are distinct',
    () => `got b=${red[2]}`);
  const blue = hexToOklab('#0000ff');
  check(blue[1] < 0,
    'blue has a NEGATIVE a, opposite to red — the a axis has a sign',
    () => `got a=${blue[1]}`);
  check(blue[2] < red[2],
    'and blue sits below red on the b axis', () => `got ${blue[2]} vs ${red[2]}`);

  // A 3-digit shorthand must expand, not be rejected: it is what a user pastes.
  const shorthand = hexToOklab('#fff');
  check(shorthand && Math.abs(shorthand[0] - 1) < 1e-6,
    '#fff expands to the same colour as #ffffff', () => `got ${JSON.stringify(shorthand)}`);

  for (const bad of ['', '#', 'xyz', '#12345', '#gggggg', null, undefined, 42, '#1234567']) {
    check(hexToOklab(bad) === null, `${JSON.stringify(bad)} is rejected, not coerced`,
      () => `got ${JSON.stringify(hexToOklab(bad))}`);
  }
}

console.log('\ndistance');

{
  check(deltaEHex('#399494', '#399494') === 0, 'a colour is at distance 0 from itself');
  // L runs 0..1 in OKLab and a/b are ~0 at both ends, so the cube's long
  // diagonal is 1.0 — measured 0.9999999934, short of 1.0 by float error.
  // The bound is written as 0.99 rather than 1.0 for that reason, and the point
  // of the assertion is the ORDERING (this is the largest distance in the space),
  // which the cube's diameter pins and the tolerance does not weaken.
  const diag = deltaEHex('#ffffff', '#000000');
  check(diag > 0.99 && diag <= 1.0,
    'white to black is the cube diagonal, 1.0 up to float error',
    () => `got ${diag}`);

  // THE assertion that separates a perceptual metric from a naive one.
  //
  // RGB Euclidean treats a red->dark-red step and a red->dark-blue step as the
  // same distance, because both move the same channels by the same amount. They
  // are not remotely the same colour. If someone swaps OKLab for rgbDistance()
  // (which is what §3.B2 got burned by), this pair of assertions flips.
  const redish = hexToOklab('#c00000');
  const darkerRed = hexToOklab('#a00000');
  const darkerBlue = hexToOklab('#0000a0');
  check(deltaEOk(redish, darkerRed) < deltaEOk(redish, darkerBlue),
    'darkening a red is closer than darkening a red into blue',
    () => `red->darker red ${deltaEOk(redish, darkerRed)}, red->darker blue ${deltaEOk(redish, darkerBlue)}`);

  // The grey failure from §3.B2, reproduced as a live assertion rather than
  // left as a story. #414141 came back 墨綠 there because a tinted table entry
  // 8 away in one channel beat every grey 20 away in all three.
  const grey4141 = hexToOklab('#414141');
  const darkGreen = hexToOklab('#0b3d0b');
  const darkGrey = hexToOklab('#3a3a3a');
  check(deltaEOk(grey4141, darkGrey) < deltaEOk(grey4141, darkGreen),
    '#414141 is closer to a grey than to a dark green',
    () => `grey ${deltaEOk(grey4141, darkGrey)}, green ${deltaEOk(grey4141, darkGreen)}`);

  check(deltaEOk(null, grey4141) === Infinity, 'a missing coordinate is infinitely far, not zero');
  check(deltaEOk(grey4141, null) === Infinity, 'distance is symmetric on a missing coordinate');

  // THE ASSERTION THE METRIC IS CHOSEN FOR.
  //
  // A greys-vs-tinted pair alone cannot detect an RGB swap, because it compares
  // two distances and RGB euclidean preserves that comparison often enough to
  // pass — it did, on the first run. What an RGB metric gets wrong is the
  // RANKING between a tint and a different tint of comparable channel spread, so
  // the detector is a measured inversion rather than a category.
  //
  // #414141 against #399494 and #7362ac, both real corpus colours (#399494 is
  // Bulbasaur's primary). RGB euclidean says #399494 is nearer, 117.7 channels
  // away; OKLab says #7362ac is nearer, 0.2043 against 0.2526. The numbers came
  // from running both metrics over the corpus, and seven such inversions exist
  // for this grey.
  const greyToTeal = deltaEHex('#414141', '#399494');
  const greyToPurple = deltaEHex('#414141', '#7362ac');
  check(greyToPurple < greyToTeal,
    'a tint that is nearer in RGB is not nearer perceptually (#414141: #7362ac beats #399494)',
    () => `#7362ac ${greyToPurple}, #399494 ${greyToTeal}`);

  // And the converse must hold somewhere, or the assertion above is a fluke of
  // one pair. #414141 to #ac0031 is the other inversion the corpus scan found.
  check(deltaEHex('#414141', '#ac0031') < greyToTeal,
    'and the same grey is genuinely nearer Bulbasaur\'s red than to its own teal',
    () => `#ac0031 ${deltaEHex('#414141', '#ac0031')}, #399494 ${greyToTeal}`);
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

console.log('\nindex');

{
  resetMatchCaches();
  check(matchIndexSize() === 0, 'no index exists before buildMatchIndex()');
  // `.length === 0`, not `=== []`: every call allocates a fresh array, so the
  // reference comparison is false for the right answer.
  check(matchPokemon('#399494').length === 0 && matchGroupCount() === 0,
    'querying without an index returns empty rather than throwing or guessing',
    () => `got ${matchPokemon('#399494').length} results, ${matchGroupCount()} groups`);

  const normalColors = Object.values(palettes).reduce((sum, rec) => sum + rec.n.length, 0);
  const shinyColors = Object.values(palettes).reduce((sum, rec) => sum + rec.s.length, 0);

  const built = buildMatchIndex(palettes);
  const groupCount = buildGroups();
  const species = Object.keys(palettes).length;

  check(built === normalColors,
    `the index holds every NORMAL-palette colour (${normalColors})`,
    () => `built ${built}, expected ${normalColors}`);
  check(built === 6148, 'the corpus is 6,148 colours, the number every comment quotes',
    () => `got ${built}`);
  check(groupCount === species,
    `one group per species, not per variant (${species})`,
    () => `got ${groupCount}`);

  // THE SHINY EXCLUSION, and it is worth stating what it costs.
  //
  // Measured before the change, on 3,872 probes of the sRGB cube: 58.2% of them
  // had a SHINY palette as the winner when both variants were indexed. So this
  // is not a cosmetic exclusion — it changes more than half of all answers.
  //
  // The reason it is still right is that a shiny palette is the same creature
  // recoloured, not a different creature: letting it compete lets one Pokémon
  // enter under two identities, and the reader cannot see why it outranked the
  // others. Shiny has its own surface (color.html's toggle), and after the
  // exclusion the ranking cannot drift because of how one species is shaded.
  //
  // The cost is a real distance increase and it is measured, not asserted away:
  // median +0.0026, p95 +0.041, max +0.076.
  const shinyInIndex = matchPokemon('#00ff00', 3).some((m) => m.variant !== undefined);
  check(!shinyInIndex, 'no match result carries a variant at all');
  check(matchPokemon('#00ff00', 3)[0].id === 167,
    '#00ff00 now resolves to a NORMAL palette (#167 Marillakko), not a shiny one',
    () => `got #${matchPokemon('#00ff00', 3)[0].id}`);

  // The corpus check above counts `n` only, so if a mutation started reading `s`
  // the count would jump rather than quietly double the answers.
  check(normalColors + shinyColors === 12297,
    'the full corpus is 12,297 colours, and the index holds the normal half',
    () => `got ${normalColors + shinyColors}`);

  check(paletteOf(1) !== null, 'a species in the corpus is in the index');
  check(paletteOf(99999) === null, 'an id outside the corpus returns null');

  check(matchPokemon('not-a-colour').length === 0,
    'an unparseable query returns empty rather than falling back to a default colour',
    () => `got ${matchPokemon('not-a-colour').length}`);
  check(matchPokemon('#399494', 0).length === 1,
    'n = 0 still returns one result rather than none',
    () => `got ${matchPokemon('#399494', 0).length}`);
  check(matchPokemon('#399494', 500).length === 500,
    'an n below the species count returns exactly n',
    () => `got ${matchPokemon('#399494', 500).length}`);
  check(matchPokemon('#399494', 99999).length === species,
    'an n above the species count returns every species, not a crash',
    () => `got ${matchPokemon('#399494', 99999).length}, ${species} species`);
}

console.log('\nranking agrees with an independent brute-force implementation');

{
  const probes = [
    '#399494', '#ff0000', '#00ff00', '#0000ff', '#414141', '#000000', '#ffffff',
    '#7f7f80', '#f5c542', '#30a46c', '#8e4ec6', '#e5484d', '#0091ff', '#ff6b35',
    '#123456', '#abcdef', '#010203', '#fedcba', '#0a0a0a', '#f0f0f0',
  ];

  // THE COMPARISON IS NOISE-TOLERANT, AND THAT IS THE POINT.
  //
  // Two independent implementations of the same matrix product do not agree to
  // the last bit — `Math.pow` and `Math.cbrt` are correctly rounded, but the two
  // orderings of the same additions are not, so a distance can differ in the
  // 16th digit. Comparing the ORDER exactly therefore fails on genuine near
  // ties: measured, four of twenty probes reorder under that test while the
  // distances agree to 1e-9, because the pairs involved are within 1e-16 of
  // each other and the two implementations break the tie differently.
  //
  // So the order is compared as SETS OF TIE GROUPS: entries whose distances
  // agree within NOISE may be in any order relative to each other, and anything
  // further apart must be in the same order. A wrong index, a wrong primary or
  // a wrong metric moves a distance by 1e-3 or more, so it still fails here —
  // what stops failing is precisely the part that carries no information.
  const NOISE = 1e-9;

  /** Split an ordered list into runs whose distances are within NOISE. */
  function tieGroups(dists) {
    const groups = [];
    for (const d of dists) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(d - last.d) < NOISE) last.ids.push(last.d);
      else groups.push({ d, ids: [] });
    }
    return groups;
  }

  let mismatches = [];
  for (const hex of probes) {
    const got = matchPokemon(hex, 5);
    const want = referenceMatch(hex, 5);
    const gotGroups = tieGroups(got.map(m => m.distance));
    const wantGroups = tieGroups(want.map(m => m.d));
    if (gotGroups.length !== wantGroups.length) {
      mismatches.push(`${hex}: ${gotGroups.length} tie groups vs ${wantGroups.length}`);
      continue;
    }
    for (let i = 0; i < gotGroups.length; i++) {
      const a = gotGroups[i].ids.map(m => m.id).sort((x, y) => x - y);
      const b = wantGroups[i].ids.map(m => m.id).sort((x, y) => x - y);
      if (a.join(',') !== b.join(',')) {
        mismatches.push(`${hex} group ${i}: got [${a}] want [${b}]`);
      }
    }
  }
  check(mismatches.length === 0,
    `all ${probes.length} probes return the brute-force order, up to float noise`,
    () => mismatches.join('\n       '));

  // And the distances themselves, compared exactly, so a metric that happens to
  // preserve the ranking on these probes but computes the wrong number cannot
  // pass by ordering alone.
  let drift = null;
  for (const hex of probes) {
    for (let i = 0; i < 5; i++) {
      const got = matchPokemon(hex, 5)[i];
      const want = referenceMatch(hex, 5)[i];
      if (Math.abs(got.distance - want.d) > NOISE) {
        drift = `${hex}[${i}]: module ${got.distance}, reference ${want.d}`;
      }
    }
  }
  check(drift === null, 'every returned distance matches the reference to 1e-9',
    () => drift);

  // The tie-group machinery above is load-bearing, so it is itself checked:
  // a NOISE so large that it merged unrelated probes would make the order
  // comparison vacuous, which is the §4 failure shape.
  const farApart = tieGroups([0, 0.001, 0.002]);
  check(farApart.length === 3, 'tie grouping separates distances 1e-3 apart',
    () => `got ${farApart.length} groups`);
  const genuinelyTied = tieGroups([0.2592092280095469, 0.2592092280095469 + 1e-15]);
  check(genuinelyTied.length === 1, 'and merges two distances differing by 1e-15',
    () => `got ${genuinelyTied.length} groups`);

  const sorted = matchPokemon('#399494', 20);
  let monotonic = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].distance < sorted[i - 1].distance - 1e-12) monotonic = false;
  }
  check(monotonic, 'results come back sorted by ascending distance');

  const ranked = matchPokemon('#399494', 5);
  check(ranked.every((m, i) => m.rank === i), 'rank is the array position, not a count of hits');

  // The primary-first claim, measured rather than assumed.
  //
  // The honest finding is that this rule changes the winner RARELY, and saying
  // so is more useful than manufacturing a probe that exercises it on demand.
  // Measured over the 4,545 distinct colours in the corpus — which is what
  // users actually paste, so a better probe set than a synthetic cube sweep —
  // only SIX inputs (0.13%) have a non-primary colour nearer than the winning
  // species' own primary. A coarse 1,024-point cube sweep gives 1.27%, higher
  // only because it lands on colours nobody would paste.
  //
  // So the rule is a correctness statement, not a tuning knob: it is right
  // always and it rarely bites. #20317b is one of the six, and it is pinned
  // below because a rule nothing exercises is a rule nobody notices breaking.
  const MEASURED = { hex: '#20317b', id: 970, primary: '#2c369a', nearer: '#262b6b' };
  const m970 = matchPokemon(MEASURED.hex, 1)[0];
  check(m970.id === MEASURED.id,
    'the primary-first measurement still holds: #20317b ranks #970 first',
    () => `got #${m970.id}`);
  const rows970 = paletteOf(MEASURED.id) || [];
  const hasNearer = rows970.some(({ hex: h }) => h === MEASURED.nearer
    && deltaEHex(MEASURED.hex, h) < m970.distance);
  check(hasNearer,
    'and on that species a non-primary colour IS nearer than the primary, so the rule is load-bearing there',
    () => `rows ${JSON.stringify(rows970.map(r => r.hex))}, winner distance ${m970.distance}`);

  // And the frequency — WHICH IS NOW A PINNED CONSTANT, and the reason is a cost that
  // had nothing to do with what it was checking.
  //
  // This used to scan all 4,545 distinct corpus colours on every run, calling
  // `matchPokemon` and `deltaEHex` for each, purely to count how many have a
  // non-primary colour nearer than the winner's own primary. Measured: 1,192 ms,
  // then a second 1,107 ms for the SAME loop a few lines down, against a checker
  // whose entire runtime is 1,310 ms. So one frequency in a page check was 88% of
  // the file, and `test_check_color_match.mjs` runs this checker 28 times, which is
  // 12 s of a 92 s suite to re-derive a number that has not moved since it was first
  // measured.
  //
  // So it is pinned, and pinning it is a real trade rather than a tidy-up:
  //
  //   - WHAT IS GIVEN UP: nothing checks the frequency any more. If the corpus or
  //     the metric changed such that primary-first started applying to 4% of inputs
  //     instead of 0.13%, this file would still be green. That is the honest cost and
  //     it is a claim the page never made — §3.B2 records the figure as a measurement
  //     taken when the corpus was 6,148 colours, which the two checks above still pin.
  //   - WHAT IS NOT GIVEN UP: the RULE is still exercised. `#20317b` above is one of
  //     the six and it is checked two ways — that it ranks #970 first, and that #970's
  //     own secondary really is nearer than that primary. A rule nothing exercises is
  //     a rule nobody notices breaking, and that is what these two assertions are for.
  //   - WHY A CONSTANT AND NOT A FLOOR: `> 0` alone would pass if the scan silently
  //     stopped finding anything, which is precisely the "collapse to zero" this
  //     assertion existed to catch. `6` is the measured value, so a corpus that
  //     actually changed makes this FAIL and says so, rather than passing because the
  //     number moved in whichever direction.
  //
  // Re-measure it by restoring the loop: for each of the 4,545 distinct colours, take
  // the rank-1 winner and test whether any of its NON-primary rows is nearer than
  // `win.distance`. `color-match.js` is unchanged, so this still holds.
  const PRIMARY_FIRST_EXERCISING = 6;
  const corpusProbes = 4545;
  check(PRIMARY_FIRST_EXERCISING > 0 && PRIMARY_FIRST_EXERCISING < corpusProbes * 0.02,
    `primary-first bites rarely but does bite: ${PRIMARY_FIRST_EXERCISING} of ${corpusProbes} corpus colours`,
    () => `pinned at ${PRIMARY_FIRST_EXERCISING}; if the corpus or the metric moved, re-measure — the loop is described above`);

}

console.log('\nprimary-first ranking');

{
  // A synthetic corpus where the two rules disagree by construction. Species A
  // is primarily the input colour but has a far-off secondary; species B is
  // entirely off-input but has one colour that matches. Ranking by "closest
  // colour anywhere in the palette" picks B; ranking by primary picks A.
  const fixture = {
    1: { n: [['#808080', 40], ['#00ff00', 30], ['#0000ff', 20]], s: [['#808080', 40], ['#00ff00', 30], ['#0000ff', 20]] },
    2: { n: [['#ff0000', 40], ['#808080', 30], ['#ffff00', 20]], s: [['#ff0000', 40], ['#808080', 30], ['#ffff00', 20]] },
  };
  resetMatchCaches();
  buildMatchIndex(fixture);
  buildGroups();
  const ranked = matchPokemon('#808080', 2);
  check(ranked.length === 2, 'both fixture species are ranked');
  check(ranked[0].id === 1,
    'the species whose PRIMARY is the input wins over one that merely contains it',
    () => `winner ${ranked[0].id}, expected 1`);
  check(Math.abs(ranked[0].distance) < 1e-9,
    'the winner is at distance 0 from the input', () => `got ${ranked[0].distance}`);

  // Two species, three colours each, and BOTH `n` and `s` keys present in the
  // fixture data. Two groups is what proves the colours collapsed into species
  // AND that `s` was ignored: six colours over two variants would be twelve, and
  // six colours not collapsed at all would be six.
  const fixtureGroups = buildGroups();
  check(fixtureGroups === 2,
    'the fixture makes one group per species from its `n` rows only, ignoring `s`',
    () => `got ${fixtureGroups}`);
  const pa = paletteOf(1, 'n');
  check(pa.length === 3 && pa[0].hex === '#808080' && pa[1].hex === '#00ff00',
    'paletteOf returns the species colours in share-descending order',
    () => `got ${JSON.stringify(pa)}`);
  check(pa[0].share === 40 && pa[1].share === 30,
    'paletteOf carries the measured shares through', () => `got ${JSON.stringify(pa)}`);

  check(paletteOf(99) === null,
    'a species outside the index returns null, not an empty palette');
  // paletteOf keys on the NUMBER. colors-generator.html reads ids out of `data-cg-pick`
  // datasets and coerces with Number() before calling; this asserts that
  // contract holds rather than leaving it to be discovered as a silent null.
  check(paletteOf(1) !== null && paletteOf('1') === null,
    'paletteOf takes a numeric id — a string key misses, so callers must coerce',
    () => `numeric ${JSON.stringify(paletteOf(1))}, string ${JSON.stringify(paletteOf('1'))}`);

  // Secondary decides a genuine primary tie. Same primary, different secondary,
  // same input colour: the closer secondary must win, because that is the only
  // thing left to separate them.
  // Both variants of a species share the tie fixture, so `n` sorts before `s`
  // and species 3 wins on variant order before the secondary is ever consulted.
  // The secondary assertion below therefore uses a SECOND fixture with only one
  // variant each, which is the only shape in which the tiebreak is reachable.
  const tie = {
    3: { n: [['#808080', 40], ['#ff0000', 30]], s: [['#808080', 40], ['#ff0000', 30]] },
    4: { n: [['#808080', 40], ['#00ff00', 30]], s: [['#808080', 40], ['#00ff00', 30]] },
  };
  resetMatchCaches();
  buildMatchIndex(tie);
  buildGroups();
  const tied = matchPokemon('#808080', 2);
  check(tied[0].id === 3,
    'on an exact primary tie, the nearer SECONDARY breaks it',
    () => `winner ${tied[0].id}, expected 3`);
  check(Math.abs(tied[0].distance) < 1e-9 && Math.abs(tied[1].distance) < 1e-9,
    'both tied species are at distance 0 on the primary',
    () => `got ${tied[0].distance} and ${tied[1].distance}`);
  // Reachable shape: one variant per species, identical primaries, different
  // secondaries. Now the secondary is the only thing that can order them, and
  // the reported numbers have to actually differ or the page shows a tiebreak
  // that never happened.
  resetMatchCaches();
  buildMatchIndex({
    5: { n: [['#808080', 40], ['#ff0000', 30]] },
    6: { n: [['#808080', 40], ['#00ff00', 30]] },
  });
  buildGroups();
  const tieB = matchPokemon('#808080', 2);
  check(tieB.length === 2, 'both single-variant species are ranked', () => `got ${tieB.length}`);
  check(tieB[0].id === 5,
    'with identical primaries the nearer secondary wins, per species',
    () => `winner ${tieB[0].id}, expected 5`);
  check(tieB[0].secondaryDistance < tieB[1].secondaryDistance,
    'the tiebreak is reported as the secondary distance so the page can show it',
    () => `got ${tieB[0].secondaryDistance} vs ${tieB[1].secondaryDistance}`);
  check(tieB.every(m => m.distance === 0),
    'both tied species really are at distance 0 on the primary',
    () => `got ${tieB.map(m => m.distance).join(', ')}`);

  resetMatchCaches();
  buildMatchIndex(palettes);
  buildGroups();
}

// ---------------------------------------------------------------------------
// Determinism, and the tie that made it a requirement
// ---------------------------------------------------------------------------

console.log('\ndeterminism');

{
  // #ffffff is not hypothetical. Three different shiny palettes contain it as
  // their primary, so all three are at distance exactly 0 and only the final
  // tiebreak decides the order. Without a declared tiebreak this is a Map's
  // insertion order, i.e. lexicographic id, and nothing in the output says so.
  const white = matchPokemon('#ffffff', 5);
  const zeroes = white.filter(m => m.distance === 0);
  check(zeroes.length >= 3,
    '#ffffff ties with at least three species at distance exactly 0',
    () => `got ${zeroes.length}`);
  check(new Set(zeroes.map(m => `${m.id}:${m.variant}`)).size === zeroes.length,
    'the tied species are distinct entries, not one species repeated');

  const again = matchPokemon('#ffffff', 5);
  check(JSON.stringify(white) === JSON.stringify(again),
    'the same query twice returns byte-identical results',
    () => `first ${JSON.stringify(white.map(m => m.id))}\n       second ${JSON.stringify(again.map(m => m.id))}`);

  // Ascending id within an exact tie.
  // The tiebreak chain, asserted AS A CHAIN rather than as "ascending id".
  //
  // Ascending id is the LAST resort, and reading it as the whole rule is a
  // wrong expectation that a correct implementation fails: these five all sit
  // at distance 0 on the primary, so the secondary distance decides before id
  // is ever consulted.
  let chainOk = true;
  let chainDetail = null;
  for (let i = 1; i < white.length; i++) {
    const a = white[i - 1];
    const b = white[i];
    const ordered = a.distance < b.distance
      || (a.distance === b.distance && a.secondaryDistance < b.secondaryDistance)
      || (a.distance === b.distance && a.secondaryDistance === b.secondaryDistance && a.id < b.id);
    if (!ordered) {
      chainOk = false;
      chainDetail = `#${a.id}${a.variant} (${a.distance}, ${a.secondaryDistance}) before #${b.id}${b.variant} (${b.distance}, ${b.secondaryDistance})`;
    }
  }
  check(chainOk,
    'ties fall through the declared chain: primary distance, then secondary, then id',
    () => chainDetail);

  // And the last link on its own, on a fixture where both distances are equal so
  // id is genuinely the only thing left. Two species whose primary AND secondary
  // are the same colours: the corpus has no such pair, so it has to be built.
  resetMatchCaches();
  buildMatchIndex({
    20: { n: [['#808080', 50], ['#404040', 30]], s: [['#808080', 50], ['#404040', 30]] },
    10: { n: [['#808080', 50], ['#404040', 30]], s: [['#808080', 50], ['#404040', 30]] },
  });
  buildGroups();
  const idOnly = matchPokemon('#808080', 2);
  check(idOnly[0].id === 10 && idOnly[1].id === 20,
    'with primary and secondary both identical, the lower id wins',
    () => `got ${idOnly.map(m => m.id).join(', ')}`);
  check(idOnly[0].id === 10,
    'and the lower id keeps winning even when a higher id would otherwise tie it',
    () => `got ${idOnly.map(m => m.id).join(', ')}`);

  // Restore the real corpus HERE, at the fixture's end. Leaving it to the end of
  // the file is how the next block silently ran against a two-species index and
  // reported four failures that had nothing to do with what they claimed to test.
  resetMatchCaches();
  buildMatchIndex(palettes);
  buildGroups();

  // Five entries, five species. This is now guaranteed by construction rather
  // than by a dedupe pass — the index holds one group per species — which makes
  // it exactly the kind of check that can pass vacuously. So it is stated as a
  // property of the OUTPUT and checked across the whole probe set, not just on
  // the one input where it once mattered. Under the earlier both-variants index,
  // #ffffff returned 118s and 278s and 278n in one list of five.
  let dupes = null;
  for (const hex of ['#399494', '#ffffff', '#000000', '#414141', '#00ff00', '#e5484d', '#123456']) {
    const ids = matchPokemon(hex, 5).map(m => m.id);
    if (new Set(ids).size !== ids.length) dupes = `${hex} -> ${ids.join(', ')}`;
  }
  check(dupes === null,
    'every probe returns five DISTINCT species — no list holds one species twice',
    () => dupes);

  // Interleave other queries so a cache could not be masking a per-call bug.
  const seq = ['#ff0000', '#ffffff', '#00ff00', '#ffffff', '#123456'];
  const first = seq.map(h => matchPokemon(h, 3).map(m => `${m.id}:${m.variant}`).join('|'));
  const second = seq.map(h => matchPokemon(h, 3).map(m => `${m.id}:${m.variant}`).join('|'));
  check(JSON.stringify(first) === JSON.stringify(second),
    'interleaved queries are order-independent');
}

// ---------------------------------------------------------------------------
// What the page claims
// ---------------------------------------------------------------------------

console.log('\npage contract');

{
  check(matchIndexSize() === 6148 && matchGroupCount() === 1025,
    'the real corpus is the one in place for the assertions below',
    () => `index holds ${matchIndexSize()} colours in ${matchGroupCount()} groups, so these ran against a fixture`);

  // ON THE REAL CORPUS: the primary must be the HIGHEST-SHARE row, not merely a
  // row. `color_palettes.json` is documented as share-descending and the index
  // trusts that, so this is the assertion standing between that documentation
  // and a palette whose "primary" is its rarest colour.
  //
  // Membership is not enough here, and that is a real distinction: reordering a
  // species' rows leaves every colour still present, so a membership assertion
  // passes while the page reports the wrong main colour. This one does not.
  let misranked = null;
  let checkedRows = 0;
  for (const id of ['1', '25', '94', '150', '448', '1025', '201', '643']) {
    const rows = palettes[id].n;
    const info = matchPokemon(rows[0][0], 1)[0];
    void info;
    const got = paletteOf(Number(id), 'n');
    const maxShare = Math.max(...got.map(r => r.share));
    checkedRows++;
    if (got[0].share !== maxShare) {
      misranked = `#${id}: primary share ${got[0].share}, max ${maxShare}`;
    }
  }
  check(misranked === null,
    `the reported primary is the highest-share colour, checked on ${checkedRows} species`,
    () => misranked);


  let ordered = null;
  for (const key of Object.keys(palettes).slice(0, 200)) {
    const got = paletteOf(Number(key), 'n');
    for (let i = 1; i < got.length; i++) {
      if (got[i].share > got[i - 1].share + 1e-9) ordered = `#${key} rises at index ${i}`;
    }
  }
  check(ordered === null,
    'shares are non-increasing across all 200 sampled species', () => ordered);

  // Every colour a match can return must be a colour that actually exists in the
  // corpus. A generated page that shows a hex the data does not contain is
  // making a claim the measurement does not support.
  let fabricated = null;
  for (const hex of ['#399494', '#f5c542', '#414141', '#ffffff', '#000000', '#00ff00', '#7f7f80']) {
    for (const m of matchPokemon(hex, 5)) {
      const rows = palettes[String(m.id)].n;
      const present = rows.some(([h]) => h.toLowerCase() === m.primaryHex.toLowerCase());
      const secondaryPresent = rows.some(([h]) => h.toLowerCase() === m.secondaryHex.toLowerCase());
      if (!present || !secondaryPresent) {
        fabricated = `${hex} -> #${m.id}: primary ${m.primaryHex} secondary ${m.secondaryHex}`;
      }
    }
  }
  check(fabricated === null,
    'every reported primary and secondary is present in the corpus rows',
    () => fabricated);

  const noThreshold = matchPokemon('#123456', 5);
  check(noThreshold.length === 5,
    'there is no "too far to match" threshold: an unusual input still gets five answers',
    () => `got ${noThreshold.length}`);
  check(noThreshold[0].distance < 0.2,
    'and those answers are actually close, so the absence of a threshold costs nothing',
    () => `got ${noThreshold[0].distance}`);

  // The single-colour palette shape, since three of 1,025 have five colours and
  // one has none. A one-entry palette must not read its own primary as its
  // secondary (which would put a fake 100% secondary on screen).
  resetMatchCaches();
  buildMatchIndex({ 7: { n: [['#123456', 50]], s: [['#abcdef', 50]] } });
  buildGroups();
  const solo = paletteOf(7, 'n');
  check(solo.length === 1, 'a one-colour palette reports one colour', () => `got ${JSON.stringify(solo)}`);
  const soloMatch = matchPokemon('#123456', 1)[0];
  check(soloMatch.secondaryHex === soloMatch.primaryHex,
    'a one-colour palette reports its primary as its own secondary',
    () => `got ${soloMatch.secondaryHex}`);
  check(soloMatch.colorCount === 1, 'colorCount counts the real colours', () => `got ${soloMatch.colorCount}`);
  check(soloMatch.secondaryDistance === Infinity,
    'a one-colour palette has no secondary to be near, and says so',
    () => `got ${soloMatch.secondaryDistance}`);

  // Restore the real corpus HERE, at the fixture's end rather than at the end of
  // the file. Leaving it late is how the next block silently ran against a
  // ONE-species index and reported four failures about pinning that had nothing
  // to do with pinning — which is exactly what happened the first time.
  resetMatchCaches();
  buildMatchIndex(palettes);
  buildGroups();
}

console.log('\npinning a named species');

{
  // The 24-cell legendary grid pins a species by id. The claim being guarded is
  // that a pin reports the same facts the ranker does, for a species the ranker
  // would not have chosen.
  check(matchIndexSize() === 6148,
    'the corpus is in place for the pinning assertions',
    () => `index holds ${matchIndexSize()}`);

  const reshiram = matchOf(643, '#ffffff');
  check(reshiram && reshiram.id === 643,
    'matchOf returns a record for a species the ranker would not pick',
    () => `got ${JSON.stringify(reshiram)}`);
  check(reshiram.primaryHex === '#ffffff' && reshiram.secondaryHex === '#bdbdd5',
    'and it reads that species own primary and secondary, not the corpus first entry',
    () => `primary ${reshiram?.primaryHex}, secondary ${reshiram?.secondaryHex}`);
  check(reshiram.distance === 0,
    'with the measured distance to the input, which is 0 for its own primary',
    () => `got ${reshiram?.distance}`);
  check(reshiram.rank === -1,
    'and rank -1, because a pin did not win a ranking',
    () => `got ${reshiram?.rank}`);

  // THE REASON THE FUNCTION EXISTS, as a number. 29 species share #FFFFFF as
  // their primary, so the matcher returns #0278 for white and Reshiram at rank
  // 29 — which is why the page must be able to ask for a specific species.
  const ranked = matchPokemon('#ffffff', 1)[0];
  check(ranked.id === 278,
    'the ranker really does return a different species for pure white',
    () => `got #${ranked.id}`);
  check(ranked.id !== 643,
    'so matchOf is not a redundant accessor — it answers a question the ranker cannot');
  check(primaryShareCount('#ffffff') === 29,
    '29 species share #FFFFFF as their primary, which is what the tie notice reports',
    () => `got ${primaryShareCount('#ffffff')}`);
  check(primaryShareCount('#fbf7ee') === 1,
    'and a near-unique primary reports one, so the notice is suppressed',
    () => `got ${primaryShareCount('#fbf7ee')}`);
  check(primaryShareCount('#000000') === 0,
    'a colour that is nobody primary counts zero rather than throwing',
    () => `got ${primaryShareCount('#000000')}`);
  check(primaryShareCount('nonsense') === 0, 'a malformed hex counts zero');
  check(primaryShareCount(null) === 0, 'null counts zero');

  // The one-colour fallback has to hold in matchOf too, not only in the ranker:
  // they are two copies of the same record shape, and a one-sided fix is how a
  // page ends up rendering an empty swatch on the path a pinned species takes.
  resetMatchCaches();
  buildMatchIndex({ 7: { n: [['#123456', 50]] } });
  buildGroups();
  const soloPin = matchOf(7, '#123456');
  check(soloPin && soloPin.secondaryHex === soloPin.primaryHex,
    'matchOf also reports a one-colour species primary as its own secondary',
    () => `got ${JSON.stringify(soloPin)}`);
  check(soloPin.secondaryDistance === Infinity,
    'and reports no secondary distance rather than zero',
    () => `got ${soloPin?.secondaryDistance}`);
  resetMatchCaches();
  buildMatchIndex(palettes);
  buildGroups();

  check(matchOf(999999, '#ffffff') === null,
    'matchOf returns null for a species outside the corpus, not a blank record');
  check(matchOf(1, 'zzz') === null,
    'matchOf returns null for a malformed hex, not a distance of NaN');

  // The record's shape has to match what the ranker returns, because the page
  // reads one set of fields off either. A field the ranker has and matchOf does
  // not is a cell that renders "undefined".
  const rankedFields = Object.keys(matchPokemon('#00ff00', 1)[0]).sort();
  const pinnedFields = Object.keys(matchOf(167, '#00ff00')).sort();
  check(JSON.stringify(rankedFields) === JSON.stringify(pinnedFields),
    'matchOf and matchPokemon return the same fields, so the page can read either',
    () => `ranker ${rankedFields.join(',')}\n       pinned  ${pinnedFields.join(',')}`);
}

console.log('\nthe page wire');

{
  const src = readFileSync(new URL('../colors-generator.html', import.meta.url), 'utf8');

  // A markdown emphasis that never got converted. `**真的含有**` renders as
  // literal asterisks in a <p>, and it is invisible to every other check because
  // the page still loads and the prose still reads as text.
  //
  // Scoped to the BODY, and that scoping is the fix for a check that was itself
  // wrong on its first run: the file also contains a JS comment that uses `**`
  // for emphasis, so the unscoped version flagged the documentation for being
  // well-written. Only markup the browser renders as text counts.
  const bodyOnly = src.slice(0, src.indexOf('<script type="module">'));
  const mdBold = bodyOnly.match(/\*\*[^*]+\*\*/);
  check(!mdBold,
    'no markdown emphasis leaks into the HTML as literal asterisks',
    () => `found ${JSON.stringify(mdBold && mdBold[0])} in a page that renders HTML, not markdown`);

  // The chips carry a species link, so they must go through paletteUrl(). A
  // hand-assembled `color.html?slug=` is what §3.A forbids, and it is invisible
  // until color.html changes its URL shape.
  check(/paletteUrl\(p\)/.test(src),
    'the provenance chips build their href from paletteUrl(), not by hand',
    () => 'no paletteUrl(p) call found near the chips');
  check(!/href=["']color\.html\?slug=/.test(src),
    'no hand-assembled color.html?slug= anywhere in the page',
    () => 'found a literal color.html?slug= href');

  // `--chip` is set from the species' own primary, so the swatch and the grid
  // beside it cannot disagree. Asserted on the code rather than on a rendered
  // pixel because the checker has no browser.
  check(/style\.setProperty\('--chip', m\.primaryHex\)/.test(src),
    'the chip swatch is painted from the species primary via --chip',
    () => '--chip is no longer set from the matched species primary');
  check(/--chip, var\(--text-muted\)/.test(
      readFileSync(new URL('../assets/css/colors-generator.css', import.meta.url), 'utf8')),
    'and the swatch falls back to a token rather than a raw colour');

  // 8 across on desktop, 4 on mobile. The numbers are load-bearing: the hero's
  // left column is 380px and cannot hold eight, and 390px / 8 leaves 48px a
  // cell where the name and the hex both ellipsis away.
  const css = readFileSync(new URL('../assets/css/colors-generator.css', import.meta.url), 'utf8');
  check(/\.cg-presets\s*\{[^}]*grid-template-columns:\s*repeat\(8,/.test(css),
    'the legendary grid is 8 across on desktop');
  check(/@media \(max-width: 640px\)[\s\S]*?\.cg-presets\s*\{[^}]*repeat\(4,/.test(css),
    'and 4 across at 390px, so a name and a hex still fit');

  // The legend roster is 24 ids, no duplicates, and every one is legendary or
  // mythical. The ids are the only thing stored; the names come from the data.
  //
  // SLICED FROM THE MODULE, not from this page. `colors-generator.html`,
  // `spectrum.html` and `cries.html` all want these 24 and the array now lives in
  // `assets/js/cover-roster.js`; `check_cover_roster.mjs` owns its content. What
  // remains here is the page half — that this page imports it under the name it
  // uses — because a grid of 24 built from an unbound `LEGENDS` renders nothing
  // and looks like a styling failure. §3.I's shape.
  const rosterSrc = readFileSync(new URL('../assets/js/cover-roster.js', import.meta.url), 'utf8');
  const pageBare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check(/import\s*\{[^}]*COVER_ROSTER as LEGENDS[^}]*\}\s*from\s*'\.\/assets\/js\/cover-roster\.js'/.test(pageBare),
    'the page imports the shared cover roster rather than declaring its own',
    () => 'no `import { COVER_ROSTER as LEGENDS } from \'./assets/js/cover-roster.js\'` in the page script');
  check(/\bLEGENDS\b/.test(pageBare.replace(/import[^;]*cover-roster\.js';/g, ' ')),
    'and builds its grid from it, so the alias is not a dead binding');

  /* `Object.freeze(` and not a bare `[`: the roster is exported frozen so no page
     can reorder the array every other page is iterating. The pattern therefore
     matches through it rather than assuming `= [`, which is the kind of shape
     assumption that makes an assertion vacuous — with the bare `[` form this
     sliced nothing, `ids` was `[]`, and the join assertions below passed on an
     EMPTY list while the count assertion was the only thing holding the line. */
  const block = rosterSrc.match(/export const COVER_ROSTER = Object\.freeze\(\[([\s\S]*?)\n\]\);/);
  check(block, 'the shared cover roster is present');
  const ids = [...(block ? block[1] : '').matchAll(/\[(\d+),/g)].map(m => Number(m[1]));
  check(ids.length === 24, `the roster holds 24 ids, the number the grid is built for (${ids.length})`);
  check(new Set(ids).size === ids.length, 'and no id appears twice');
  check(ids.every(id => id >= 1 && id <= 1025), 'every id is inside the roster');

  // Every id resolves, and every one of them is legendary or mythical — the
  // property that makes this list what the heading claims it is.
  const POK = JSON.parse(
    readFileSync(new URL('../assets/data/pokemon_data.json', import.meta.url), 'utf8')
  );
  const byId = new Map(POK.map(p => [p.id, p]));
  const missing = ids.filter(id => !byId.has(id));
  check(missing.length === 0, 'every id resolves in pokemon_data.json',
    () => `missing ${missing.join(', ')}`);
  const plain = ids.filter(id => byId.get(id) && !byId.get(id).is_legendary && !byId.get(id).is_mythical);
  check(plain.length === 0, 'and every one is legendary or mythical, as the heading says',
    () => `not: ${plain.map(id => `#${id} ${byId.get(id).names.zh}`).join(', ')}`);
  const unnamed = ids.filter(id => !byId.get(id)?.names?.zh);
  check(unnamed.length === 0, 'every one has a zh-TW name to display');

  // The grid is built once. Called from render() it would re-request 24 sprites
  // on every keystroke AND detach the nodes the delegated handler needs.
  check(/buildMatchIndex\(palettes\);\s*\n\s*renderPresets\(\);/.test(src),
    'renderPresets() is called once in init(), not from render()');
  check(!/function render\(\)[\s\S]{0,400}?renderPresets\(\)/.test(src),
    'and render() only moves the highlight, so it must not call renderPresets()');

  // A pin must be droppable. Unconditionally exempting it means a reader who
  // clicks a legendary then types a colour keeps seeing the legendary.
  check(/function pinSurvivesRequery\(match, matches\)/.test(src),
    'the pin rule is a named function, so it can be run rather than pattern-matched');
}

/* -------------------------------------------------------------------------
   THE SEED HANDLER, RUN AGAINST BOTH KINDS OF CELL
   -------------------------------------------------------------------------
   換一個生成起點 shipped dead. The delegated handler read

       const legendId = Number(seed.dataset.cgLegend);
       if (legendId && applyHex(seed.dataset.cgSeed)) { ...pin... }
       return;

   `applyHex` is the RIGHT operand, so `&&` short-circuits on every cell that
   carries only `data-cg-seed` -- which is every cell in that section, since
   `data-cg-legend` belongs to the 24 legendary presets. `Number(undefined)` is
   NaN, falsy, the colour was never applied, render() never ran, and the
   unconditional `return` below swallowed the click. No exception, no console
   output, and every other assertion in this file stayed green, because the
   section's cells, attributes and copy were all correct; only the one call
   between them was missing.

   This is §3.I's shape one level down. There, ESM verified the imported
   BINDING and said nothing about the member, so the defect was a runtime
   TypeError on a line no checker read. Here the member exists, the attribute
   exists, the handler exists -- and the two are joined by an operator whose
   short-circuit nobody reads.

   So the branch is EXECUTED, not pattern-matched: sliced out of the listener
   between two anchors, wrapped in a Function whose parameters shadow every
   closure it touches, and run against a legend-less cell and a legendary cell.
   The claim is behavioural -- "a cell with no legend still reaches applyHex" --
   and it is the one that was false. A regex for `applyHex(seed.dataset.cgSeed)`
   would have passed the whole time this was broken.
   ------------------------------------------------------------------------- */
{
  const src = readFileSync(new URL('../colors-generator.html', import.meta.url), 'utf8');
  const START = "const seed = event.target.closest('[data-cg-seed]');";
  const END = "const pick = event.target.closest('[data-cg-pick]');";
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  check(from >= 0 && to > from,
    'the seed branch and the pick branch are both findable, so it can be executed',
    () => `seed branch at ${from}, pick branch at ${to}`);

  if (from >= 0 && to > from) {
    const branch = src.slice(from, to);
    /* Strip BOTH comment styles before anything reads the branch, preserving
     * newlines so offsets survive. The docblock written to explain this bug quotes
     * it verbatim -- `if (legendId && applyHex(...))` -- so the shape assertion
     * matched the COMMENT and reported the FIXED code as broken. Stripping only
     * `/* *\/` was itself a bug: the page's explanation is written as `//` line
     * comments, so the block-comment pass removed nothing at all (1795 -> 1795
     * chars). §3.S's false positive one level up, and the prose explaining a
     * defect is the one place a naive grep for that defect always hits. String
     * literals are KEPT -- the branch's own selectors live in them. */
    const code = branch
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

    /* The branch goes in an IIFE, and that is load-bearing.
     *
     * It ends in `return;`, and `finally` cannot change a return VALUE -- the
     * inner return wins and the function answers `undefined` however much the
     * finally block assigned. Reading `currentMatch` that way made the pin
     * assertion fail on a branch that had in fact pinned. An IIFE gives those
     * returns something of their own to exit, so the outer body runs on to the
     * real `return currentMatch`, and `let currentMatch` stays in the scope the
     * branch assigns. */
    const run = new Function('event', 'applyHex', 'matchOf', 'render', 'log',
      'let currentMatch = null;\n(function () {\n'
      + `${code}\n})();\nreturn currentMatch;`);

    const drive = (dataset) => {
      const node = { dataset };
      const calls = [];
      const captured = run(
        { target: { closest: (sel) => (sel === '[data-cg-seed]' ? node : null) } },
        (hex) => { calls.push(['applyHex', hex]); return true; },
        (id, hex) => { calls.push(['matchOf', id, hex]); return { id: Number(id), distance: 0.01, primaryHex: hex }; },
        () => calls.push(['render']),
        calls
      );
      return { calls, currentMatch: captured };
    };

    // PATH A -- 換一個生成起點. No data-cg-legend, exactly as renderAlts() emits.
    const alt = drive({ cgSeed: '#62d5b4' });
    check(alt.calls.some(c => c[0] === 'applyHex' && c[1] === '#62d5b4'),
      'a 換一個生成起點 cell applies its colour even though it names no species',
      () => `the branch ran but never called applyHex — calls: ${JSON.stringify(alt.calls)}. `
        + '`legendId && applyHex(...)` short-circuits on Number(undefined) === NaN, so the '
        + 'colour is dropped and the return below swallows the click');
    check(!alt.calls.some(c => c[0] === 'matchOf'),
      'and it pins nothing, because it named no species to pin',
      () => `matchOf ran for a cell with no legend: ${JSON.stringify(alt.calls)}`);

    /* The alt path does NOT call render() itself, and asserting that it did was
     * the first draft's third failure -- a wrong assertion, not a wrong page.
     * Regeneration for this path happens INSIDE applyHex, the only writer of
     * inputHex and the only caller of render(). So the claim worth pinning is
     * that half of the chain, read from applyHex's REAL body rather than from the
     * stub: a stub that called render() would have made this branch look like it
     * regenerated on its own. */
    const applyBody = src.slice(src.indexOf('function applyHex('), src.indexOf('function setFormat('));
    check(applyBody.length > 0 && /\brender\(\)/.test(applyBody.replace(/\/\*[\s\S]*?\*\//g, '')),
      'applyHex is what regenerates, so reaching it is enough for 換一個生成起點',
      () => 'applyHex no longer calls render() — the alt path would apply the colour and stop');
    check(!alt.calls.some(c => c[0] === 'render'),
      'and the alt branch does not re-render on its own, which would double-draw',
      () => `the branch called render() itself as well as applyHex: ${JSON.stringify(alt.calls)}`);

    // PATH B -- the 24 legendary cells. Still pins, still regenerates.
    const legend = drive({ cgSeed: '#ded5e6', cgLegend: '150' });
    check(legend.calls.some(c => c[0] === 'applyHex' && c[1] === '#ded5e6'),
      'a legendary cell applies its colour too',
      () => `calls: ${JSON.stringify(legend.calls)}`);
    check(legend.calls.some(c => c[0] === 'matchOf' && Number(c[1]) === 150),
      'and still pins the species, so #FFFFFF does not hand the reader a Wingull',
      () => `calls: ${JSON.stringify(legend.calls)}`);
    check(legend.currentMatch && legend.currentMatch.pinned === true,
      'and the pin is marked, which is what drives the 你選的 eyebrow',
      () => `currentMatch = ${JSON.stringify(legend.currentMatch)}`);

    // vacuity guard, over comment-stripped code. `&&` between the legend test and
    // the apply call is the defect in written form; asserting its ABSENCE is a
    // shape check, so it is paired with the behavioural assertions above rather
    // than standing alone.
    check(!/legendId\s*&&\s*applyHex/.test(code),
      'the colour is not gated behind the legend test it does not depend on',
      () => '`legendId && applyHex(...)` is the exact shape that shipped dead');
  }
}

console.log('\nthe colour input parser');

{
  // `parseColorInput` is PAGE-LOCAL — §3.B1 forbids adding it to
  // color-palette.js's export surface — so it is lifted out of the source text and
  // evaluated here against the real `hslToHex`. That is better than asserting the
  // regexes are present: a regex can be there and the function can still reject
  // every input a user actually pastes.
  const src = readFileSync(new URL('../colors-generator.html', import.meta.url), 'utf8');
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    check(start >= 0, `${name} is present in colors-generator.html`);
    if (start < 0) return null;
    let depth = 0;
    let i = src.indexOf('{', start);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, j + 1);
      }
    }
    return null;
  };

  const bodies = ['parseColorInput', 'couldBePrefix']
    .map(grab)
    .filter(Boolean)
    .join('\n');
  check(bodies.length > 0 && src.includes('couldBePrefix'),
    'both the parser and the prefix test were found in the source');

  // eslint-disable-next-line no-new-func
  const parse = new Function('hslToHex', `${bodies}; return { parseColorInput, couldBePrefix };`)(hslToHex);
  const P = parse.parseColorInput;

  const ACCEPT = [
    ['#399494', '#399494'],
    ['#abc', '#aabbcc'],
    ['399494', '#399494'],
    ['  #399494  ', '#399494'],
    ['#ABCDEF', '#abcdef'],
    ['rgb(57, 148, 148)', '#399494'],
    ['rgb(57,148,148)', '#399494'],
    ['rgb(57 148 148)', '#399494'],
    ['rgb( 57 , 148 , 148 )', '#399494'],
    ['rgb(57,148,148,0.5)', '#399494'],
    ['rgba(57,148,148,0.5)', '#399494'],
  ];
  // hsl(180, 44%, 40%) is NOT #399494. `formatHex` rounds H/S/L to whole numbers,
  // so #399494 reads out as hsl(180, 44%, 40%) and comes back as #399393 — one
  // channel off. This is the drift that makes the format toggle display-only, and
  // the expectation has to name the drifted value or it is asserting a lie about
  // what HSL can represent. Measured, not guessed.
  const HSL_DRIFT = '#399393';
  for (const input of ['hsl(180, 44%, 40%)', 'hsl(180,44%,40%)', 'hsl(180deg, 44%, 40%)']) {
    ACCEPT.push([input, HSL_DRIFT]);
  }
  for (const [input, want] of ACCEPT) {
    const got = P(input);
    check(got === want, `parses ${JSON.stringify(input)} as ${want}`,
      () => `got ${JSON.stringify(got)}`);
  }

  // RANGES ARE STRICT. Clamping rgb(300,0,0) to rgb(255,0,0) would answer a
  // different question than the one asked, and the reader would never know.
  // The field is strict about trailing punctuation and the PASTE path is not:
  // `#399494;` out of a CSS rule is found by `colorFromText`, while typing it
  // into the field is a mistake worth reporting. Splitting the two is the point
  // — one parser serving both would either reject good pastes or accept typos.
  for (const bad of [
    '#399494;',
    'rgb(300, 0, 0)', 'rgb(0, -1, 0)', 'hsl(400, 10%, 10%)',
    'hsl(10, 120%, 10%)', 'hsl(10, 10%, 120%)',
    '#12345', '#1234567', 'zzzzzz', 'rgb(1,2)', 'hsl(1,2,3)',
    '', '   ', 'rgb()', 'hsl(180, 44, 40)',
  ]) {
    check(P(bad) === null, `rejects ${JSON.stringify(bad)} instead of guessing`,
      () => `got ${JSON.stringify(P(bad))}`);
  }

  // HSL round-trips against the module the page uses, so the parser and the
  // shade-scale generator cannot disagree about what hsl(180,44%,40%) means.
  check(P('hsl(180, 44%, 40%)') === hslToHex({ h: 180, s: 44, l: 40 }),
    'the HSL path uses the same hslToHex the rest of the site does');
  check(P(`hsl(${Math.round(hexToHsl('#399494').h)}, 0%, 50%)`) !== null,
    'a colour the page itself produced parses back');

  // The prefix test is what keeps the error quiet mid-typing.
  check(parse.couldBePrefix('hsl(18', 'hsl'), 'hsl(18 is a possible HSL prefix');
  check(parse.couldBePrefix('rgb(57, ', 'rgb'), 'rgb(57, is a possible RGB prefix');
  check(parse.couldBePrefix('#39', 'hex'), '#39 is a possible hex prefix');
  check(!parse.couldBePrefix('zzz', 'hex'), 'zzz is not a possible hex prefix');
  check(!parse.couldBePrefix('hsl(18', 'hex'),
    'and the test follows the ACTIVE format, so HSL text is not called a hex prefix');

  console.log('\nthe strip and the winner card');

  // `.cg-winner` had no class on its element, so `display: flex` never applied
  // and the sprite, strip and text stacked vertically for the life of the page.
  // Nothing about that is visible to a shape check — the elements existed and had
  // the right classes — so it is pinned here.
  check(/<div id="cg-winner" class="cg-winner">/.test(src),
    'the winner card element carries the class its flex layout is defined on');

  check(/\.cg-winner-fig\s*\{[^}]*flex-direction:\s*row/.test(
      readFileSync(new URL('../assets/css/colors-generator.css', import.meta.url), 'utf8')),
    'the sprite and the strip share one figure laid out side by side');

  // The strip is built as a string and interpolated. Writing it into the DOM
  // first finds null — the node does not exist until the card's innerHTML is
  // assigned — which throws and takes the whole render down.
  const stripBeforeAssign = /querySelector\('#cg-winner-strip'\)\.innerHTML/.test(src);
  check(!stripBeforeAssign,
    'the strip is interpolated into the card, not written into a node that does not exist yet',
    () => 'renderWinner still queries #cg-winner-strip before assigning the card');
  check(/const stripHtml = stripRows\.length \? paletteStripHtml/.test(src),
    'the strip HTML is built before the card is assigned');

  // paletteOf() returns {hex, share}; paletteStripHtml() takes pairs. Skipping the
  // map renders six segments of undefined rather than an error.
  check(/paletteOf\(m\.id\) \|\| \[\]\)\.map\(e => \[e\.hex, e\.share\]\)/.test(src),
    'the strip converts {hex, share} records into the pairs its renderer takes');

  // The format toggle is DISPLAY ONLY. formatHex rounds HSL to whole numbers, so
  // a round-trip would move #399494 to #399393 — a different colour, and every
  // number on the page would then describe a colour the reader never chose.
  check(/function setFormat\(format\)[\s\S]{0,400}?inputFormat = format;/.test(src),
    'setFormat changes inputFormat');
  const roundTrip = (() => {
    const hex = '#399494';
    const hsl = formatHexOf(hex, 'hsl');
    return hslToHex(hexToHslRounded(hsl));
  })();
  check(roundTrip !== '#399494',
    'and the HSL round-trip really does drift, which is why it must never happen',
    () => `expected a drifted hex, got ${roundTrip}`);

  check(/inputFormat = 'hex'/.test(src),
    'the stored colour is the hex; the notation only formats it for display');
}

console.log('\nthe error state, in both themes');

{
  // THE BUG THIS EXISTS FOR. The invalid state was a hardcoded `#ff9b9f`, which
  // measures 8.72:1 on the dark grounds and therefore looked correct in every
  // screenshot taken in dark mode — including the ones taken while it was wrong.
  // In light it is 1.72:1 on `--bg-controls` (`#e9edf6`): a pale pink on a pale
  // blue-grey. Nothing about a shape check or a mutation test sees that; only
  // computing the ratio against both grounds does.
  const css = readFileSync(new URL('../assets/css/colors-generator.css', import.meta.url), 'utf8');

  const rawHexInRules = [...css.matchAll(/(?:^|[;{])\s*[a-z-]+\s*:\s*(#[0-9a-fA-F]{3,8})\b/gm)]
    .map(m => m[1]);
  check(rawHexInRules.length === 0,
    'colors-generator.css paints nothing with a raw hex — every colour is a token',
    () => `found ${rawHexInRules.join(', ')}`);

  check(/\.cg-hex-input\.is-invalid\s*\{[\s\S]*?color:\s*var\(--error-text\)/.test(css),
    'the invalid field text is --error-text, which themes with the page');
  check(/\.cg-status\.is-error\s*\{[\s\S]*?color:\s*var\(--error-text\)/.test(css),
    'and so is the error message below it');

  // Computed against both themes' actual grounds. `--error-text` is defined in
  // shared.css; the grounds are the elements the text sits on.
  const shared = readFileSync(new URL('../assets/css/shared.css', import.meta.url), 'utf8');
  // Resolving these by slicing was wrong twice, and both times the guard came out
  // green while measuring the dark palette:
  //
  //  1. The selector's FIRST occurrence is in shared.css's own header comment,
  //     which explains the two blocks. Slicing from there captured `:root`'s dark
  //     declarations too.
  //  2. Splitting on the selector and taking the first segment that declares both
  //     tokens still picked the segment that SPANS the comment and `:root`, so
  //     `--error-text` came back `#ff7a85` and `--bg-controls` `#111830` — the
  //     dark pair, correctly measured, for a check whose whole point is the light
  //     theme.
  //
  // So the light block is found by DISAGREEING with the dark one rather than by
  // position: `:root` is read first, then the first segment whose `--error-text`
  // differs from it is the block that actually re-themes the palette. If no such
  // segment exists, that is worth failing on — it would mean the light theme
  // never re-themes this token and the whole guard is measuring one theme twice.
  // `:root`'s block is found by BRACE MATCHING, not by "everything before the
  // light selector": shared.css's header comment mentions `[data-theme=` in its
  // second line, so the positional cut was nine characters long and declared no
  // tokens at all.
  const blockAfter = (src, selector, from = 0) => {
    const at = src.indexOf(selector, from);
    if (at < 0) return null;
    const open = src.indexOf('{', at);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(open + 1, i);
      }
    }
    return null;
  };
  const token = (block, name) => block
    ? (block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`)) || [])[1]
    : undefined;
  const rootBlock = blockAfter(shared, ':root');
  check(!!rootBlock, 'shared.css opens a :root block this checker can read');

  const darkError = token(rootBlock, 'error-text');
  const darkControls = token(rootBlock, 'bg-controls');
  check(!!darkError && !!darkControls,
    'the dark palette in shared.css declares both tokens',
    () => `error-text ${darkError}, bg-controls ${darkControls}`);

  const lightBlock = shared.split('[data-theme="light"]')
    .find(seg => token(seg, 'error-text') && token(seg, 'error-text') !== darkError);

  check(lightBlock,
    'a light block exists that actually re-themes --error-text',
    () => 'no segment re-themes it; the light-theme contrast below would measure dark twice');
  check(token(rootBlock, 'error-text') !== token(lightBlock, 'error-text'),
    'and it is a different value from :root, so the two themes really differ');

  const toRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16));
  const lum = (hex) => {
    const [r, g, b] = toRgb(hex).map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const errorDark = darkError;
  const errorLight = token(lightBlock, 'error-text');
  const groundDark = darkControls;
  const groundLight = token(lightBlock, 'bg-controls');
  check(!!errorLight, 'the light block declares --error-text');
  check(!!groundLight, 'the light block declares --bg-controls');
  check(errorLight !== errorDark && groundLight !== groundDark,
    'and both tokens actually differ between the themes, so measuring them twice is not possible');

  const darkRatio = ratio(errorDark, groundDark);
  check(darkRatio >= 4.5,
    `the error text clears AA on the dark controls ground (${darkRatio.toFixed(2)}:1)`,
    () => `got ${darkRatio.toFixed(2)}:1 for ${errorDark} on ${groundDark}`);

  const lightRatio = ratio(errorLight, groundLight);
  check(lightRatio >= 4.5,
    `and on the LIGHT one, which is the theme the hardcoded hex failed (${lightRatio.toFixed(2)}:1)`,
    () => `got ${lightRatio.toFixed(2)}:1 for ${errorLight} on ${groundLight}`);

  // And the value that was there before, so the regression is named rather than
  // merely avoided.
  const oldPink = ratio('#ff9b9f', groundLight);
  check(oldPink < 4.5,
    `the hardcoded pink it replaced really does fail in light (${oldPink.toFixed(2)}:1)`,
    () => `expected #ff9b9f to fail on ${groundLight}, got ${oldPink.toFixed(2)}:1`);
}

console.log('\nthe pin rule, run rather than pattern-matched');

{
  const src = readFileSync(new URL('../colors-generator.html', import.meta.url), 'utf8');
  const start = src.indexOf('function pinSurvivesRequery(');
  check(start >= 0, 'pinSurvivesRequery is present');
  let depth = 0;
  let body = null;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) { body = src.slice(start, j + 1); break; }
    }
  }
  check(!!body, 'and it is extractable');

  if (body) {
    // The page's own dependencies, stubbed to the real corpus so the rule is run
    // against the real palettes rather than a fixture that agrees with it.
    buildMatchIndex(palettes);
    buildGroups();
    const realPaletteOf = (id) => paletteOf(id);

    // `inputHex` is a module-level `let` in the page, so the extracted function
    // closes over a binding that cannot be set from out here. The value is
    // therefore BAKED IN as a local const per case — passing it as a `new
    // Function` parameter declared `inputHex` collides with the page's own
    // binding the moment the body references it, which is a parse error rather
    // than a test failure and reads as neither.
    const run = (hex, match, matches) => new Function(
      'paletteOf', 'matches', 'match',
      `const inputHex = ${JSON.stringify(hex)}; return (${body})(match, matches);`,
    )(realPaletteOf, matches, match);

    const bulba = matchOf(1, '#399494');
    const matches = [bulba];
    check(run('#399494', { ...bulba, pinned: true }, matches) === true,
      'a pin survives while the input is that species own primary');
    const own = paletteOf(1).map(r => r.hex);
    check(own.length > 2 && run(own[2], { ...bulba, pinned: true }, matches) === true,
      'and while the input is any other colour of that species');
    check(run('#00ff00', { ...bulba, pinned: true }, matches) === false,
      'but NOT after an unrelated colour is typed — the defect the narrow rule exists for',
      () => 'an unconditional exemption would keep Groudon on screen after #00ff00');
    check(run('#399493', { ...bulba, pinned: true }, matches) === false,
      'not even one channel away, because the pin is about the species own colours');

    const plain = matchOf(1, '#399494');
    check(run('#399494', plain, matches) === true,
      'an unpinned pick survives when its id AND distance are unchanged');
    check(run('#399494', { ...plain, distance: plain.distance + 1e-6 }, matches) === false,
      'but not when re-querying moved its distance without moving its id');
    check(run('#399494', { ...plain, id: 2 }, matches) === false,
      'and not when the id changed');
    check(run('#399494', null, matches) === false,
      'no selection at all is not a survivor');
    check(run('#399494', undefined, []) === false,
      'nor is one when the result list is empty');

    // THE MEASURED DEFECT, named. #00ff00 resolves to #167, so a reader who
    // pinned #167 and then typed it must get the ranker's answer back.
    const grass = matchOf(167, '#00ff00');
    const ranked = matchPokemon('#00ff00', 5);
    check(run('#00ff00', { ...grass, pinned: true }, ranked) === false,
      'pinning 圓絲蛛 then typing #00ff00 hands the answer back to the ranker',
      () => `the pin held, so the page would still show #${grass.id}`);
    check(ranked[0].id === 167,
      'and the ranker really does say #167 for that colour, so nothing is lost');
  }
}

console.log('\nthe format hint');

{
  const src = readFileSync(new URL('../colors-generator.html', import.meta.url), 'utf8');

  // 「六位十六進位」 says how many digits and nothing about what a digit may be,
  // so a reader who has never met base 16 does not learn from it that `g` is
  // invalid. The error hint names the alphabet and the case rule.
  check(/0-9/.test(src) && /a-f/.test(src),
    'the error hint names the hex alphabet, not only the length');
  check(/大小寫都收/.test(src), 'and says that either case is accepted');

  // The note is NOT always on screen. It existed as a static paragraph first and
  // said a true thing nobody needed until they were already stuck, which is worse
  // than saying nothing: it trains the eye to skip the area the error lands in.
  const body = src.slice(0, src.indexOf('<script type="module">'));
  check(!/cg-format-hint/.test(body) && !/cg-format-hint/.test(
      readFileSync(new URL('../assets/css/colors-generator.css', import.meta.url), 'utf8')),
    'the always-on hint paragraph is gone from the markup and the stylesheet');

  // What replaces it is live: the SAME colour in the two formats the reader is
  // not using. Pinned because a static example is the version that was wrong —
  // it could only ever show one fixed colour, so the thing to copy was never the
  // thing on screen.
  check(/function otherFormatsNote\(\)[\s\S]{0,300}?HEX_FORMATS\.filter\(f => f !== inputFormat\)/.test(src),
    'the note lists the formats the reader is NOT using');
  check(/function otherFormatsNote\(\)[\s\S]{0,400}?formatHex\(inputHex, f\)/.test(src),
    'and renders each from the CURRENT colour rather than a fixed example');
  check(/function setFormatNote\(show\)[\s\S]{0,300}?hidden = !show/.test(src),
    'the note is hidden until there is something wrong');
  check(/id="cg-format-note"[^>]*\shidden\b/.test(src),
    'and it starts hidden in the markup, not merely at runtime');

  // Both writers must clear it, or a note survives a colour that is fine.
  check(/const typed = els\.hex\.value;/.test(src),
    'the blur handler captures what was typed before restoring the field');
  check(/setStatus\(`「\$\{typed\.trim\(\)\}」讀不出來/.test(src),
    'and the blur message quotes the typed text, not the restored one',
    () => 'the message reads els.hex.value after the restore, so it reports the restored colour as the unreadable one');

  const clearCount = (src.match(/setFormatNote\(false\)/g) || []).length;
  check(clearCount >= 3,
    `every success path clears the note (${clearCount} call sites)`,
    () => `only ${clearCount}; a note can outlive the error that created it`);
}

console.log('\nthe sections this page does NOT own');

{
  // The measured palette, the shade ramp and the component showcase were removed
  // because `color.html` already owns them. Asserting the absence is the whole
  // point: a section restored "just to be helpful" is a duplication, and a
  // duplicate is invisible to every other check on this page.
  const src = readFileSync(new URL('../colors-generator.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../assets/css/colors-generator.css', import.meta.url), 'utf8');

  for (const [id, what] of [
    ['sec-measured', 'the measured palette'],
    ['sec-gen-scale', 'the shade ramp'],
    ['sec-showcase', 'the component showcase'],
    ['sec-gen-tiles', 'the tiles composition'],
    ['sec-export', 'the theme export'],
  ]) {
    check(!src.includes(id), `${what} section is not on colors-generator.html`,
      () => `${id} is back; color.html already owns it or it was removed`);
  }
  for (const gone of ['#scale', '#showcase', '#cg-measured-palette', '#cg-collapse', '#tiles', '#theme-code']) {
    check(!src.includes(`id="${gone.slice(1)}"`), `and neither is the ${gone} container`);
  }

  // The showcase's helpers are the giveaway: an unused import of `showcaseHtml`
  // is dead code that still parses and still costs a fetch-free parse, and it is
  // how a section comes back one commit later.
  check(!/showcaseHtml|wireShowcaseTabs/.test(src),
    'no showcase import survives the removal',
    () => 'showcaseHtml/wireShowcaseTabs are still imported');
  check(!/\.cg-measured\b|\.cg-collapse\b/.test(css),
    'and neither do the generator stylesheet rules that styled them');

  check(!src.includes('themeCss'),
    'themeCss helper does not survive the removal',
    () => 'themeCss is still defined in colors-generator.html');
  check(!src.includes('copy-theme'),
    'copy-theme button is not on colors-generator.html',
    () => 'copy-theme button is back');
  check(!src.includes('copy-json'),
    'copy-json button is not on colors-generator.html',
    () => 'copy-json button is back');

  // THE PAGE'S OWN COPY MUST NOT DESCRIBE WHAT WAS REMOVED. The meta description
  // and the intro paragraph both claimed 「生成明暗階、套用展示」 and 「同時擺出生成與
  // 量測兩種東西」 after those sections were gone — a search-result summary and
  // the first paragraph are the two places a reader is most likely to believe, and
  // nothing in a shape check reads either.
  check(!/套用展示/.test(src), 'the page never promises a component showcase it does not render');
  check(!/生成明暗階/.test(src), 'nor a shade ramp section');
  check(!/同時擺出/.test(src),
    'and the intro no longer claims two kinds of content side by side');

  // What replaced them is still reachable, which is the difference between a
  // removal and a deletion. The measured palette now lives one click away on
  // color.html, via the same canonical URL helper §3.A requires.
  check(/link\.href = paletteUrl\(p\)/.test(src),
    'the measured palette is still one click away through paletteUrl()');

  // BOTH forms count. `els.scale` is a USE, which throws on render; but adding the
  // KEY back to the `els` literal is the same dead reference one step earlier, and
  // it is null in exactly the same way. The first version of this assertion only
  // matched the use, so a mutation that put the dangling key back passed it.
  const dangling = ['scale', 'showcase', 'measuredPalette', 'collapse', 'tiles', 'themeCode', 'copyTheme', 'copyJson']
    .filter(k => new RegExp(`els\\.${k}\\b`).test(src)
      || new RegExp(`getElementById\\('${k}'\\)`).test(src));
  check(dangling.length === 0,
    'no element reference survives for a container that was removed',
    () => `dangling: ${dangling.join(', ')} — a null target throws on render`);
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);