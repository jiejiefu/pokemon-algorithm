/**
 * Category registry regression test
 *
 *   node scripts/check_categories.mjs
 *
 * Guards assets/js/categories.js, which drives category.html. Nothing else
 * exercises this file: it is imported by exactly one page, the page's only error
 * surface is a generic try/catch that prints "載入失敗", and — the reason this
 * file exists — a selector whose argument shape is wrong does not throw. It
 * returns an empty array, and the page renders a confident, correctly-styled,
 * completely empty grid.
 *
 * That is not hypothetical. `regionalMembers()` was written `(data, chains)`
 * while `starterMembers()` was `(data, gens)`, and category.html calls every
 * selector with the same three positional arguments in `needs` order. So the
 * regional page handed its chains parameter the *generations* array, every
 * `chain.variants` was undefined, and the regional category produced 0 of its 58
 * members with no error in any console. A non-zero member count per category is
 * the single assertion that would have caught it, so it is asserted for all nine.
 *
 * The other invariants pinned here are the ones that break quietly:
 *   - artwork exists on disk for every member (a bad filename is a broken <img>,
 *     which is invisible to any assertion that only looks at JSON);
 *   - every card has a Traditional Chinese title and a detail-page target,
 *     because a form card links to its BASE species (form ids like 10033 have no
 *     record in pokemon_data.json and detail.html could not resolve them);
 *   - every declared filter selects at least one member, so a renamed or
 *     retuned predicate cannot leave a chip that filters to nothing;
 *   - the tiles() pair shapes are renderable, with no undefined/NaN.
 *
 * It imports the real ES module, so it also catches syntax errors in it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CATEGORIES,
  CATEGORY_SLUGS,
  COLLECTION_GROUPS,
  COLLECTION_TINTS,
  TAG_TONES,
  HUE_STEPS,
  TINT_ALPHA,
  TAG_ALPHA,
  rgbOf,
  getCategory,
  passesFilter,
} from '../assets/js/categories.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  }
}

const pokemon = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'));
const gens = JSON.parse(readFileSync(join(ROOT, 'assets/data/generations.json'), 'utf8'));
const chains = JSON.parse(readFileSync(join(ROOT, 'assets/data/evolution_chains.json'), 'utf8'));

// The page's contract, asserted once. `needs` declares which slots are non-null;
// every selector is called with all three regardless, positionally, in this order.
const SLOTS = { pokemon, gens, chains };

console.log(`category registry: ${CATEGORY_SLUGS.length} categories\n`);

for (const slug of CATEGORY_SLUGS) {
  const config = getCategory(slug);
  console.log(`${slug}`);

  ok(!!config, `getCategory("${slug}") returned nothing`);
  if (!config) continue;

  ok(CATEGORIES[slug] === config, `getCategory("${slug}") is not CATEGORIES["${slug}"]`);

  // Copy the page's own call: three positional args, in `needs` order.
  const members = config.members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains);
  const n = members.length;

  // THE assertion this file exists for. A wrong argument shape yields [].
  ok(n > 0, `${slug}: 0 members — check the selector's parameter order against needs`);
  if (n === 0) {
    console.log('        (needs: ' + JSON.stringify(config.needs) + ')\n');
    continue;
  }

  // No duplicate ids, and no duplicate card titles. Regional forms are the case
  // that needs this: Darmanitan-Galar-Standard/-Zen and the three Paldean Tauros
  // breeds all share a base species, so without the form qualifier in the title
  // the page renders five visibly identical cards in a row.
  const ids = members.map((m) => m.id);
  ok(new Set(ids).size === ids.length, `${slug}: duplicate member ids`);
  const titles = members.map((m) => `${m.names?.zh}\u0000${m.formName || ''}`);
  const dupTitles = [...new Set(titles.filter((t, i) => titles.indexOf(t) !== i))];
  ok(
    dupTitles.length === 0,
    `${slug}: duplicate card titles — ${dupTitles.map((t) => JSON.stringify(t)).join(', ')}`
  );

  const noArtwork = members.filter((m) => !existsSync(join(ROOT, 'assets/images/pokemon', m.filename)));
  ok(noArtwork.length === 0, `${slug}: ${noArtwork.length} members with no artwork on disk (e.g. #${noArtwork[0]?.id} → ${noArtwork[0]?.filename})`);

  const noName = members.filter((m) => !m.names?.zh);
  ok(noName.length === 0, `${slug}: ${noName.length} members with no names.zh (e.g. #${noName[0]?.id})`);

  // Every card needs a link. A form member carries `linkTo` (its base species);
  // a plain species is its own target.
  const noTarget = members.filter((m) => !(m.linkTo || m).names?.en);
  ok(noTarget.length === 0, `${slug}: ${noTarget.length} members with no detail-page target`);

  // Form cards must point at a species that actually exists, or the link 404s
  // into detail.html's "not found" branch.
  const badLink = members.filter((m) => {
    const target = m.linkTo || m;
    return !pokemon.some((p) => p.id === target.id);
  });
  ok(badLink.length === 0, `${slug}: ${badLink.length} members link to a species absent from pokemon_data.json`);

  for (const filter of config.filters || []) {
    const selected = members.filter((m) => passesFilter(m, filter.key, config.filters));
    if (filter.key === 'all') {
      ok(selected.length === n, `${slug}: the "all" filter selected ${selected.length}/${n}`);
    } else {
      ok(selected.length > 0, `${slug}: filter "${filter.key}" (${filter.label}) selects 0 members`);
    }
  }

  // Tiles render through textContent, so numbers are fine — but undefined and
  // NaN are not, and both would be produced by a predicate over an absent key.
  const tiles = config.tiles(members);
  ok(Array.isArray(tiles), `${slug}: tiles() did not return an array`);
  ok(tiles.length === 4, `${slug}: tiles() returned ${tiles.length} tiles, expected 4`);
  for (const [value, label] of tiles) {
    ok(
      value !== undefined && value !== null && !Number.isNaN(value) && `${value}` !== 'NaN' && `${value}` !== 'undefined',
      `${slug}: tile value is ${value} (label "${label}")`
    );
    ok(
      typeof label === 'string' && label.trim() !== '' && !label.includes('undefined'),
      `${slug}: tile label is ${JSON.stringify(label)}`
    );
  }

  console.log(`  ${n} members, ${(config.filters || []).length} filters, tiles: ${tiles.map((t) => t[0]).join(' / ')}\n`);
}

// A card is rendered with `href`, `badge` and `shiny`; a name that does not exist
// on a config would render no badge at all rather than fail, so the flags are
// pinned to the categories that are supposed to carry them.
ok(CATEGORIES.shiny.disclaimer === true, 'shiny must carry the placeholder-artwork disclaimer');
ok(CATEGORIES.mega.members !== CATEGORIES.gigantamax.members, 'mega and gigantamax share one selector');
for (const slug of ['mega', 'gigantamax', 'regional']) {
  const withBadge = CATEGORIES[slug].members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains).filter((m) => m.formBadge);
  ok(withBadge.length > 0, `${slug}: no member carries a form badge`);
}

// ---------------------------------------------------------------------------
// The collections hub duplicates every count and stat triple rather than fetching
// 900 KB to print "71". This is the assertion that pays for that duplication:
// the numbers below are recomputed from the real selectors, so the hub table and
// the category pages cannot disagree without a test failing.
// ---------------------------------------------------------------------------
console.log('collections hub table');

const hubSlugs = COLLECTION_GROUPS.flatMap((g) => g.items.filter((i) => !i.upcoming).map((i) => i.slug));
ok(
  JSON.stringify(hubSlugs) === JSON.stringify(CATEGORY_SLUGS),
  `hub cards do not match CATEGORY_SLUGS\n        hub   ${JSON.stringify(hubSlugs)}\n        slugs ${JSON.stringify(CATEGORY_SLUGS)}`
);

const totalCards = COLLECTION_GROUPS.reduce((n, g) => n + g.items.length, 0);
ok(totalCards === 11, `hub has ${totalCards} cards, expected 11`);

for (const group of COLLECTION_GROUPS) {
  for (const item of group.items) {
    const label = `${group.key}/${item.slug}`;
    if (item.upcoming) {
      // An upcoming card must not be a link, or it is a dead one.
      ok(item.count === null, `${label}: upcoming card carries a count`);
      ok(item.stats.length === 3, `${label}: upcoming card needs exactly 3 stats`);
      ok(!CATEGORY_SLUGS.includes(item.slug), `${label}: upcoming card uses a live category slug`);
      continue;
    }
    const config = getCategory(item.slug);
    if (!config) {
      ok(false, `${label}: no such category`);
      continue;
    }
    const members = config.members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains);
    ok(item.count === members.length, `${label}: hub says ${item.count}, selector yields ${members.length}`);
    // stats is tiles(members).slice(1) — the count is the card's big number, so
    // carrying tile 0 too would print it twice. The hub's triples carry a THIRD
    // element, the tag tone, which tiles() has no notion of, so the comparison is
    // over the first two and the tone is asserted separately below.
    const expected = config.tiles(members).slice(1);
    const pair = (t) => [t[0], t[1]];
    ok(
      JSON.stringify(item.stats.map(pair)) === JSON.stringify(expected.map(pair)),
      `${label}: hub stats differ from tiles().slice(1)\n        hub      ${JSON.stringify(item.stats.map(pair))}\n        expected ${JSON.stringify(expected.map(pair))}`
    );
    ok(item.stats.length === 3, `${label}: ${item.stats.length} stats, expected 3`);
    for (const t of item.stats) {
      ok(t.length === 3, `${label}: stat ${JSON.stringify(t)} has no tone key`);
    }
  }
}

// A rendered hero is white on the accent gradient, and the gradient's LIGHTEST
// stop is the bounding case for every text on it. The ramps are Tailwind 700
// shades, which is the 600→700 correction: six of InfoPoke's 600-level hues put
// white text below 4.5:1. Asserted rather than trusted, because "I picked dark
// enough colours" is exactly the claim that rots silently.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const chan = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = (hex) => { const [r, g, b] = chan(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, alpha) => '#' + chan(fg).map((v, i) => Math.round(v * alpha + chan(bg)[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');

console.log('\nhero contrast (white text on the lightest accent stop)');
for (const slug of CATEGORY_SLUGS) {
  const accent = getCategory(slug).accent;
  const lightest = accent.reduce((w, c) => (contrast('#ffffff', c) < contrast('#ffffff', w) ? c : w));
  // The hero note is 14px normal weight → 4.50:1. The stat tile is a 0.16 BLACK
  // scrim over the gradient — black, not white, because a white scrim lightens
  // the fill and pushes white text down; the 12px label is also 4.50:1.
  const note = contrast(over('#ffffff', lightest, 0.95), lightest);
  const tile = over('#000000', lightest, 0.16);
  const tileValue = contrast('#ffffff', tile);
  const tileLabel = contrast(over('#ffffff', tile, 0.95), tile);
  ok(note >= 4.5, `${slug}: hero note is ${note.toFixed(2)}:1 on ${lightest} (needs 4.50)`);
  ok(tileValue >= 4.5, `${slug}: stat-tile value is ${tileValue.toFixed(2)}:1 (needs 4.50)`);
  ok(tileLabel >= 4.5, `${slug}: stat-tile label is ${tileLabel.toFixed(2)}:1 (needs 4.50)`);
  console.log(`  ${slug.padEnd(13)} lightest ${lightest}  note ${note.toFixed(2)}  tile ${tileValue.toFixed(2)} / label ${tileLabel.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// Card tints and tag tones.
//
// InfoPoke's values, transcribed into COLLECTION_TINTS / TAG_TONES. InfoPoke is
// light-only, so the dark theme substitutes the same hues at -950 (card) and
// -900 (tag) with -300 text, and THOSE are the numbers that have to be checked:
// an alpha nobody composited is an alpha nobody re-checked. So every surface is
// built the way the browser builds it — rgba() over the real --bg-card, tag over
// card, both ends of the card's gradient — and the worst end is asserted.
//
// Print is not asserted separately and does not need to be: @media print reuses
// the LIGHT tint and tag forms (see collections.html) and darkens the text
// (#1f2328 → #000000), so light is the bounding case.
// ---------------------------------------------------------------------------
console.log('\ncard tints + tag tones (InfoPoke-derived, composited per theme)');

const THEMES = {
  dark: { card: '#21262d', primary: '#f0f6fc', secondary: '#c9d1d9' },
  light: { card: '#ffffff', primary: '#1f2328', secondary: '#424a53' },
};
// Accepts both "46, 16, 101" and "46 16 101" so this test keeps working if
// rgbOf's separator ever changes, instead of silently compositing with NaN.
const hexOfRgb = (s) => '#' + s.split(/[\s,]+/).filter(Boolean).map((v) => Number(v).toString(16).padStart(2, '0')).join('');

const tintKeys = Object.keys(COLLECTION_TINTS);
ok(
  JSON.stringify(tintKeys.filter((k) => k !== 'upcoming')) === JSON.stringify(CATEGORY_SLUGS),
  `COLLECTION_TINTS covers ${JSON.stringify(tintKeys)} — expected the 9 slugs plus "upcoming"`
);

// No two LIVE categories may share a gradient pair. Note this is asserted on the
// PAIR, not on one corner: InfoPoke gives both `starter` (red→orange) and
// `gigantamax` (red→yellow) the same red `from`, so sampling a single corner
// finds them "identical" (#fef2f1 / #341619) even though their far ends differ
// (#fff7ed vs #fefce9). The two `upcoming` cards are excluded on purpose — they
// both take the neutral slate→gray pair, which is the point of it.
const pairs = new Map();
for (const slug of CATEGORY_SLUGS) {
  const { from, to } = COLLECTION_TINTS[slug];
  const key = `${from}->${to}`;
  ok(
    !pairs.has(key),
    `${slug} and ${pairs.get(key)} share the tint pair ${key} — the two cards are indistinguishable`
  );
  pairs.set(key, slug);
}

for (const [theme, T] of Object.entries(THEMES)) {
  // The two ends of each card's gradient. In light these are the opaque -50
  // hexes; in dark they are the -950 hues at the alphas collections.html uses.
  const cardEnds = {};
  for (const key of tintKeys) {
    const tint = COLLECTION_TINTS[key];
    const a = HUE_STEPS[tint.from];
    const b = HUE_STEPS[tint.to];
    cardEnds[key] =
      theme === 'light'
        ? [a[50], b[50]]
        : [
            over(hexOfRgb(rgbOf(a[950])), T.card, TINT_ALPHA.from),
            over(hexOfRgb(rgbOf(b[950])), T.card, TINT_ALPHA.to),
          ];
  }

  // Body text sits directly on the card. The title and the big count are
  // --text-primary, the description is --text-secondary; both are 4.50:1 at
  // their sizes (1.2rem/1.75rem bold, 0.925rem).
  let worstBody = Infinity;
  let worstBodyKey = '';
  for (const [key, [c1, c2]] of Object.entries(cardEnds)) {
    for (const c of [c1, c2]) {
      for (const [what, fg] of [['primary', T.primary], ['secondary', T.secondary]]) {
        const r = contrast(fg, c);
        if (r < worstBody) {
          worstBody = r;
          worstBodyKey = `${key}/${what}`;
        }
        ok(r >= 4.5, `${theme}: card ${key} body ${what} text is ${r.toFixed(2)}:1 on ${c} (needs 4.50)`);
      }
    }
  }

  // Tag text sits on the tag, which sits on the card — two composites deep, and
  // the tag's own alpha is applied over each end of the card's gradient.
  const tones = [...new Set(COLLECTION_GROUPS.flatMap((g) => g.items.flatMap((i) => i.stats.map((t) => t[2]))))];
  let worstTag = Infinity;
  let worstTagKey = '';
  for (const toneKey of tones) {
    const tone = TAG_TONES[toneKey];
    ok(!!tone, `tone "${toneKey}" is not in TAG_TONES`);
    if (!tone) continue;
    ok(
      typeof tone.why === 'string' && tone.why.trim() !== '',
      `tone "${toneKey}" has no documented rationale in TAG_TONES.why`
    );
    const h = HUE_STEPS[tone.hue];
    const text = theme === 'light' ? h[700] : h[300];
    // A tag can only land on a card of its own category, so the candidate
    // surfaces are the ends of the tints that actually use this tone.
    const hosts = tintKeys.filter((k) =>
      COLLECTION_GROUPS.some((g) =>
        g.items.some((i) =>
          (i.upcoming ? 'upcoming' : i.slug) === k && i.stats.some((t) => t[2] === toneKey)
        )
      )
    );
    for (const host of hosts) {
      for (const cardBg of cardEnds[host]) {
        const bg = theme === 'light' ? h[100] : over(h[900], cardBg, TAG_ALPHA.bg);
        const r = contrast(text, bg);
        if (r < worstTag) {
          worstTag = r;
          worstTagKey = `${toneKey}@${host}`;
        }
        ok(r >= 4.5, `${theme}: tag "${toneKey}" on ${host} is ${r.toFixed(2)}:1 (${text} on ${bg}, needs 4.50)`);
      }
    }
  }
  console.log(
    `  ${theme.padEnd(6)} worst card body ${worstBody.toFixed(2)}:1 (${worstBodyKey})   worst tag ${worstTag.toFixed(2)}:1 (${worstTagKey})`
  );
}

console.log(
  failures === 0
    ? `\nall ${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`
);
process.exit(failures === 0 ? 0 : 1);