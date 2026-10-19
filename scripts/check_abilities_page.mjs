/**
 * Static half of the abilities page checks.
 *
 *   node scripts/check_abilities_page.mjs
 *
 *   node scripts/test_check_sorting_page.mjs --static
 *
 * This half reads the two pages and RUNS the module over the real data rather
 * than reading the module's source. §3.P's lesson is that logic living inside a
 * page's `<script type="module">` block cannot be imported, so the only thing a
 * checker could assert about it was its text — and four vacuous assertions in
 * check_maze_page.mjs came from exactly that. Moving the queries into
 * assets/js/abilities.js is what makes them comparable instead.
 *
 * What is NOT here, and why: nothing in this file boots a browser, so nothing
 * here can see whether a card actually renders. §3.G4 splits the sorting page's
 * checker for that reason and this pair follows it — the stylesheet contract is
 * readable off disk, and the rendered half is a separate concern.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  prepareAbilities, filterAbilities, splitAbilityHolders,
  abilityName, abilityIsFallbackName, abilityEffect, abilityEffectEn,
  abilityUrl, holderUrl
} from '../assets/js/abilities.js';
import { PLANNED_PAGES, NAV } from '../assets/js/shared.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(ROOT, name), 'utf8');
const readData = name => JSON.parse(readFileSync(join(ROOT, 'assets/data', name), 'utf8'));

const ABILITIES = readData('abilities.json');
const SPECIES = readData('ability_species.json');

const LIST = read('abilities.html');
const DETAIL = read('ability.html');
const LIST_CODE = LIST.replace(/<!--[\s\S]*?-->/g, '');
const DETAIL_CODE = DETAIL.replace(/<!--[\s\S]*?-->/g, '');
const CSS = read('assets/css/abilities.css');
const MOVES_CSS = read('assets/css/moves.css');

let checks = 0;
let failures = 0;
const notes = [];

function ok(condition, message, detail) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}${detail ? `\n        ${detail}` : ''}`);
  }
}

function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    message,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

/** Strip CSS comments before a rule-shaped read. §3.S's fix, needed again here:
 *  a [^{}]* selector walk starts inside a comment and ends on the next rule. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const rows = prepareAbilities(ABILITIES);

/* ===== both pages exist, and neither is a redirect stub ===== */

ok(LIST.length > 0 && LIST_CODE.includes('<!DOCTYPE html>'), 'abilities.html should be a real document');
ok(DETAIL.length > 0 && DETAIL_CODE.includes('<!DOCTYPE html>'), 'ability.html should be a real document');

/* ===== the planned-page bookkeeping that shipped with them ===== */

eq(
  PLANNED_PAGES.some(p => p.slug === 'abilities.html'),
  false,
  'abilities.html is a live page now, so it must be out of PLANNED_PAGES'
);

const navRow = NAV.flatMap(g => g.groups || []).flatMap(g => g.items || []).find(i => i.href === 'abilities.html');
ok(Boolean(navRow), 'NAV should carry a row for abilities.html');
ok(
  Boolean(navRow) && /314/.test(navRow.desc),
  'the NAV row should state the real count, not the 284 the planned row claimed',
  navRow && navRow.desc
);

const dexGroup = NAV.find(g => (g.pages || []).includes('abilities.html'));
ok(
  Boolean(dexGroup) && dexGroup.pages.includes('abilities.html'),
  'the group listing abilities.html in `pages` must actually contain it'
);

/**
 * `ability.html` carries NO row and NO `pages` entry, exactly as move.html and
 * detail.html do. Asserted as an ABSENCE, because an assertion that a name is
 * present cannot express "must not be" — §3.W's own lesson about role="img".
 */
const anyNavEntry = JSON.stringify(NAV).includes('ability.html');
ok(!anyNavEntry, 'ability.html must not appear anywhere in NAV — it is reached by drilling in');
ok(
  !/initHeaderNav\(['"]ability\.html/.test(DETAIL_CODE),
  'ability.html must not claim aria-current for itself'
);

/* ===== the payload split, asserted in BOTH directions ===== */

/**
 * The loaders live in assets/js/abilities.js, not in the page — which is the
 * point of the module (§3.P: a query that lives in a `<script type="module">`
 * block can only be checked by reading its source). So the page is asserted on
 * its IMPORT and the module on the paths it actually fetches. The first draft
 * asserted the filename appeared in the HTML, which is false for a correct page
 * and would have been satisfied only by a page that inlined the loader.
 */
ok(
  /import\s*\{[^}]*loadAbilities[^}]*\}\s*from\s*['"]\.\/assets\/js\/abilities\.js['"]/.test(LIST_CODE),
  'abilities.html should import loadAbilities from assets/js/abilities.js'
);
ok(
  /loadAbilitySpecies/.test(DETAIL_CODE),
  'ability.html should import loadAbilitySpecies — it is the only page that prints holders'
);

const MODULE = read('assets/js/abilities.js');
ok(/loadJson\('abilities\.json'\)/.test(MODULE), 'the module should fetch abilities.json');
ok(
  /loadJson\('ability_species\.json'\)/.test(MODULE),
  'the module should fetch ability_species.json'
);
/**
 * The claim is that neither page FETCHES the 2.8 MB roster, so the assertion
 * looks for the load rather than for the string. The first version tested
 * `!/pokemon_data\.json/.test(MODULE)` and went red the moment a comment named
 * the file to explain why it is avoided — §3.S's shape, in JavaScript: a
 * checker reading prose as code. `loadPokemonData` is shared.js's loader and a
 * literal `fetch()` is the only other route, so covering both is the whole
 * claim rather than a proxy for it.
 */
for (const [label, src] of [['abilities.js', MODULE], ['ability.html', DETAIL_CODE], ['abilities.html', LIST_CODE]]) {
  ok(
    !/loadPokemonData/.test(src) && !/fetch\([^)]*pokemon_data/.test(src),
    `${label} must not load pokemon_data.json (2.8 MB) — the holder index carries the name and the id it needs`
  );
}

ok(
  !LIST_CODE.includes('ability_species.json'),
  'abilities.html must NOT load ability_species.json — every count it prints is already baked into abilities.json, and the index is 379 KB'
);

/* ===== every filter is a URL parameter, and it is read from one ===== */

/**
 * Read side: `params.get('<key>')`. Write side: every chip goes through ONE
 * `setParam(key, value)` helper, so the literal `params.set('gen'` appears for
 * no filter at all — asserting on it fails a correct page, which is what the
 * first two drafts of this check did.
 *
 * What is actually verifiable, and what matters, is that the chip's filter key
 * and the URL key are THE SAME STRING. A filter can be fully wired into the UI
 * and still never reach the URL if the chip is registered under `'gens'` while
 * `state.gen` is seeded from `params.get('gen')` — and nothing else on the page
 * would notice. So each key is required to appear as a quoted literal at least
 * twice: once where it is read from the URL, once where a chip or the search
 * box registers it.
 */
for (const key of ['q', 'gen', 'hidden', 'form']) {
  ok(
    LIST_CODE.includes(`params.get('${key}')`),
    `the ?${key}= filter should be read out of the URL, not kept in memory only`
  );
  const occurrences = LIST_CODE.split(`'${key}'`).length - 1;
  ok(
    occurrences >= 2,
    `the ?${key}= key must be the SAME string the filter UI registers, not a near-miss like 'gen' vs 'gens'`,
    `found ${occurrences} occurrence(s) of '${key}'`
  );
}

ok(
  LIST_CODE.includes('history.replaceState'),
  'filter changes should replace the history entry rather than push one — typing in a search box must not fill the back stack'
);

/* ===== the English fallback is labelled, never spliced into the Chinese body ===== */

ok(
  /英文原文/.test(LIST_CODE) && /英文原文/.test(DETAIL_CODE),
  'the upstream-English block must be labelled in both pages'
);
ok(
  LIST_CODE.includes('abilityEffectEn') && DETAIL_CODE.includes('abilityEffectEn'),
  'both pages should reach the English text through abilityEffectEn(), not by reading .effectEn directly'
);
ok(
  !/\.effectEn/.test(LIST_CODE.replace(/abilityEffectEn/g, '')),
  'neither page should touch the effectEn field directly — that is the module’s job'
);

/** Run it: no ability may reach a card with nothing to say. */
const silent = rows.filter(a => !abilityEffect(a) && !abilityEffectEn(a)).map(a => a.slug);
eq(silent, [], 'no ability may render a card with neither a Chinese nor an English effect');

/* ===== the module, run over the real data ===== */

const noZh = rows.filter(abilityIsFallbackName).map(a => a.slug);
ok(
  noZh.length === 3,
  'exactly three abilities have no Chinese name and must fall back to nameEn',
  noZh.join(', ')
);
for (const slug of noZh) {
  ok(
    /is-en/.test(LIST_CODE) && /is-en/.test(DETAIL_CODE),
    'the English-name fallback needs a visible marker in both pages, or it reads as "the page failed to translate this"'
  );
}

eq(filterAbilities(rows, { gen: 3 }).length, rows.filter(a => a.generation === 3).length,
  'the generation filter should return exactly the Gen 3 rows');
eq(filterAbilities(rows, { hidden: true }).length, rows.filter(a => a.hasHidden).length,
  'the "has a hidden ability" filter should return exactly the rows that have one');
eq(filterAbilities(rows, { form: true }).length, rows.filter(a => a.formCount > 0).length,
  'the "forme-exclusive" filter should return exactly the rows with a forme holder');

/** Search matches on SUBSTRING and across all three of name / en / id. */
eq(filterAbilities(rows, { q: '威嚇' }).map(a => a.slug), ['intimidate'],
  'a Chinese name should find its ability');
ok(filterAbilities(rows, { q: 'intim' }).length >= 1,
  'the English name should match on a substring, not only a prefix');
ok(filterAbilities(rows, { q: '022' }).length === 1,
  'the zero-padded id should find its ability');
eq(filterAbilities(rows, { q: '威嚇', gen: 9 }).length, 0,
  'the filters should compose — a Gen 3 ability cannot match a Gen 9 filter');
eq(filterAbilities(rows, {}).length, rows.length, 'an empty state should return everything');

/** Deep links carry values nothing validates unless the page checks them. */
const genValues = [...new Set(rows.map(a => a.generation))];
ok(
  genValues.every(g => g >= 3),
  'abilities begin in Gen 3 — a filter chip below 3 would be offering a reader nothing'
);

/* ===== holders: the forme / hidden fold ===== */

/**
 * Rock Head is Kantonian Marowak's REGULAR ability and Alolan Marowak's HIDDEN
 * one, so ability_species.json carries three rows all with baseId 105. Folded
 * by base species, Marowak appears once and is marked hidden — which is why
 * this asserts the count AND the flag rather than the raw row count.
 */
const rockHead = splitAbilityHolders(SPECIES['rock-head']);
const marowak = rockHead.hidden.find(e => e.baseId === 105);
ok(Boolean(marowak), 'Marowak should be reachable on rock-head through its Alolan forme');
ok(marowak && marowak.isHidden === true, 'Marowak should be marked hidden once its Alolan forme carries it hidden');
eq(
  rockHead.regular.filter(e => e.baseId === 105).length,
  0,
  'Marowak must not appear in BOTH lists — one species, two rows, one entry'
);
ok(
  marowak && marowak.forms.length >= 1,
  'the entry should keep the forme names so the page can say WHY it is marked hidden'
);

const intimidate = splitAbilityHolders(SPECIES['intimidate']);
eq(
  intimidate.regular.length + intimidate.hidden.length,
  ABILITIES.intimidate.speciesCount,
  'the two lists together should account for exactly speciesCount distinct species'
);

/** Holder links go through the canonical helper (§3.A). */
ok(
  /holderUrl/.test(DETAIL_CODE) && /pokemonDetailUrl/.test(read('assets/js/abilities.js')),
  'holder links should be built by pokemonDetailUrl(), not assembled by hand'
);
for (const page of [LIST, DETAIL]) {
  ok(
    !/detail\.html\?slug=/.test(page),
    'neither page may hand-assemble a detail.html URL — that is what keeps nidoran-f and nidoran-m apart'
  );
}

/* ===== the guide the page promises ===== */

for (const term of ['特性膠囊', '特性膏藥', '隱藏特性']) {
  ok(DETAIL_CODE.includes(term), `ability.html should carry the 「${term}」 explainer`);
}

/* ===== stylesheet: nothing here may reach for a header-scoped token ===== */

ok(
  !/--page-accent/.test(CSS_CODE),
  'abilities.css must NOT use --page-accent — shared.css declares it on .header-* only, so in a body it resolves to the inherited value and reads as a colour that happens to be wrong (§3.W). Asserted against the comment-stripped copy, because the file\'s own header comment NAMES the token to explain why it is banned.'
);
ok(
  CSS_CODE.includes('.ab-'),
  'every rule should be ab- prefixed so nothing here leaks onto a sibling page'
);

/* ===== contrast: the fill and its text are ONE token decision ===== */

/**
 * `--accent-gold-surface` is a SOLID fill that inverts with the theme — amber
 * #f5c542 in dark, Poké Ball red #b3122a in light — and shared.css documents
 * that it carries `--on-accent` text. `--text-primary` is the worst possible
 * partner in both themes, because it is near-black in light and near-white in
 * dark while the fill does the opposite:
 *
 *     light  --text-primary on the red   -> 2.56:1   ✗
 *     dark   --text-primary on the gold  -> 1.44:1   ✗
 *     light  --on-accent    on the red   -> 6.92:1   ✓
 *     dark   --on-accent    on the gold  -> 11.62:1  ✓
 *
 * The rule shipped with `--text-primary` and a reader reported the badge as
 * unreadable. The assertion is a PAIRING, not a single token: a rule may use
 * either colour, as long as a gold fill does not sit under a primary-text
 * colour. Read against the comment-stripped copy, because both files' own
 * comments now name these tokens to explain the rule (§3.S's fix).
 */
const accentFillWithPrimary = /\{[^}]*background:\s*var\(--accent-gold-surface\)[^}]*\}/g;
for (const sheet of [CSS, MOVES_CSS]) {
  const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = code.match(accentFillWithPrimary) || [];
  ok(
    rules.length > 0,
    `the scan found at least one --accent-gold-surface fill to check in ${sheet === CSS ? 'abilities.css' : 'moves.css'}`
  );
  for (const rule of rules) {
    ok(
      /color:\s*var\(--on-accent\)/.test(rule),
      'a rule filling with --accent-gold-surface must set color: var(--on-accent)',
      rule.replace(/\s+/g, ' ').slice(0, 120)
    );
    ok(
      !/color:\s*var\(--text-primary\)/.test(rule),
      'a rule filling with --accent-gold-surface must NOT set color: var(--text-primary) — that is 2.56:1 light and 1.44:1 dark'
    );
  }
}

/* ===== the holder artwork is the official Scarlet/Violet set ===== */

/**
 * Both `hasSv()` and `svUrl()` take an id, so the holder grid gets official
 * artwork without loading pokemon_data.json — which is what keeps §3.AB's
 * payload split intact. Asserted as a FALLBACK SHAPE rather than as the literal
 * call, so a page that hardcodes `svUrl()` with no way down to the sprite would
 * fail.
 */
ok(
  /hasSv\(row\.baseId\)\s*\?\s*svUrl\(row\.baseId\)\s*:\s*spriteUrl\(row\.baseId\)/.test(MODULE),
  'holderSprite() should prefer the SV artwork and fall back to the 96px sprite'
);
ok(
  DETAIL_CODE.includes('holderSprite') && DETAIL_CODE.includes('holderHasSv'),
  'ability.html should render through both, so the fallback gets the sr-only note'
);
ok(
  DETAIL_CODE.includes('sr-only') && /Scarlet\/Violet 圖尚未釋出/.test(DETAIL_CODE),
  'the sprite fallback should be announced to a screen reader, as move.html does'
);

/**
 * `object-fit` and `object-position` are asserted TOGETHER, never apart. §3.E
 * records why: the SV set is bottom-anchored with the space above it, so
 * `contain` alone passes a "does it fit" assertion while leaving the subject
 * ~3.7px above the card's own baseline — measured 25–26% of the box low.
 */
const holderImgRule = (CSS_CODE.match(/\.ab-holder img\s*\{[^}]*\}/) || [''])[0];
ok(/\.ab-holder img\s*\{/.test(CSS_CODE), '.ab-holder img should declare its own box');
ok(
  /object-fit:\s*contain/.test(holderImgRule),
  '.ab-holder img should use object-fit: contain — width/height alone stretches the 120×112 SV art by 6%'
);
ok(
  /object-position:\s*bottom/.test(holderImgRule),
  '.ab-holder img should pair object-fit with object-position: bottom, or the bottom-anchored subject floats off the card baseline (§3.E)'
);
ok(
  !/image-rendering/.test(holderImgRule),
  '.ab-holder img must NOT set image-rendering — the house convention is for upscales, and this is a 56px downscale'
);
ok(
  !/translateY/.test(holderImgRule),
  '.ab-holder img must NOT carry a vertical offset — types.html needs one because its chips put the image and name on one line; these cards do not'
);

/* ===== report ===== */

for (const note of notes) console.log(`  note  ${note}`);

if (failures === 0) {
  console.log(`PASS ${checks} checks`);
} else {
  console.error(`FAIL ${failures} of ${checks} checks`);
  process.exit(1);
}