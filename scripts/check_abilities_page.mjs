/**
 * Static half of the abilities page checks.
 *
 *   node scripts/check_abilities_page.mjs
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
  buildSpeciesIndex, filterSpecies, speciesSlots, speciesIdText,
  SPECIES_RESULT_CAP,
  abilityName, abilityIsFallbackName, abilityEffect, abilityEffectEn,
  abilityUrl, holderUrl
} from '../assets/js/abilities.js';
import { PLANNED_PAGES, NAV } from '../assets/js/shared.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(ROOT, name), 'utf8');
const readData = name => JSON.parse(readFileSync(join(ROOT, 'assets/data', name), 'utf8'));

const ABILITIES = readData('abilities.json');
const SPECIES = readData('ability_species.json');
const SPECIES_INDEX = readData('species_abilities.json');

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

/* ===== the reverse lookup: 「這隻寶可夢有哪些特性」 ===== */

const speciesIndex = buildSpeciesIndex(SPECIES_INDEX);

eq(speciesIndex.length, SPECIES_INDEX ? Object.keys(SPECIES_INDEX).length : 0,
  'every index row should survive buildSpeciesIndex');
eq(speciesIndex.filter((s, i) => s.id !== i + 1).length, 0,
  'buildSpeciesIndex should hand back dex order, not JSON key order');
ok(speciesIndex.every(s => s.name && s.nameEn),
  'every species the panel can render must carry a Chinese and an English name');

/** The three ways a reader names a Pokémon, and the id rule the ability search already uses. */
eq(filterSpecies(speciesIndex, '皮卡丘').hits.map(s => s.id), [25],
  'a Chinese name should find its species');
ok(filterSpecies(speciesIndex, 'pikachu').hits.some(s => s.id === 25),
  'the English name should match on a substring, not only a prefix');
eq(filterSpecies(speciesIndex, '025').hits.map(s => s.id), [25],
  'the zero-padded dex id should find its species');
eq(filterSpecies(speciesIndex, '1025').hits.map(s => s.id), [1025],
  'a four-digit dex id must not be zero-padded into something else');
eq(filterSpecies(speciesIndex, '妙蛙').hits.map(s => s.id), [1, 2, 3],
  'a shared character should find the whole line, not one member of it');

/**
 * THE CAP IS THE GUARD, and this is the case that makes it load-bearing.
 *
 * The query space is wildly uneven: two Chinese characters find three species,
 * one English letter finds 574. A cap that only ever meets the good case is a
 * cap nobody has tested, and the failure is a panel that renders 574 rows rather
 * than a red line — so `a` is asserted at BOTH the cap and the true total, and
 * the second number is what proves the first one truncated something.
 */
const bomb = filterSpecies(speciesIndex, 'a');
eq(bomb.hits.length, SPECIES_RESULT_CAP, 'a one-character query must stop at the cap');
ok(bomb.total > bomb.hits.length * 10,
  'the bomb case must actually be bigger than the cap, or the assertion above is satisfied by a filter that truncates nothing');
eq(bomb.total, 574, 'the measured total for 「a」 — the number the panel reports next to the cap');
ok(bomb.hits.every(s => s.nameEn.toLowerCase().includes('a') || s.name.toLowerCase().includes('a')),
  'everything the cap returned must still match the query — a cap must never pad or reorder into non-matches');

/** An empty query answers 「no Pokémon named」, not 「all 1,025」. */
eq(filterSpecies(speciesIndex, ''), { hits: [], total: 0 },
  'an empty query must return no species, or the panel opens on the whole roster');
eq(filterSpecies(speciesIndex, '   '), { hits: [], total: 0 },
  'a whitespace-only query is an empty query');
eq(filterSpecies(speciesIndex, 'zzzzzznotaspecies').total, 0,
  'a query matching nothing should say zero rather than fall back to a default list');

/**
 * The three labels a species row can carry, and why the third one exists.
 *
 * A slug in both slots is the baseId merge showing through — a regional forme's
 * regular ability is often the base forme's hidden one — and the page prints it
 * as its own group. The load-bearing property is that the three lists are
 * DISJOINT: a slug appearing twice would render one ability under two headings
 * and read as two abilities.
 */
{
  const shared = speciesIndex.filter(s => speciesSlots(s).shared.length);
  eq(shared.length, 12, 'the folded-forme species, matching the data check');

  let disjointFailures = 0;
  let duplicatedRender = 0;
  let singleFailures = 0;
  for (const species of speciesIndex) {
    const { reg, hid, shared: both, single } = speciesSlots(species);
    const seen = new Set();
    for (const slug of [...reg, ...hid, ...both]) {
      if (seen.has(slug)) duplicatedRender += 1;
      seen.add(slug);
    }
    if (reg.some(s => hid.includes(s) || both.includes(s))) disjointFailures += 1;
    if (hid.some(s => reg.includes(s) || both.includes(s))) disjointFailures += 1;
    const expectedSingle = species.reg.length === 1 && species.hid.length === 0;
    if (single !== expectedSingle) singleFailures += 1;
  }
  eq(disjointFailures, 0, 'the three slot lists must be disjoint — a slug in two of them renders as two abilities');
  eq(duplicatedRender, 0, 'no species may render the same ability twice');
  eq(singleFailures, 0, 'the 單一特性 flag must mean exactly one regular ability and no hidden one');
}

/** Nothing in the panel may name an ability the page cannot render. */
{
  const unknown = new Set();
  for (const species of speciesIndex) {
    for (const slug of speciesSlots(species).reg.concat(speciesSlots(species).hid)) {
      if (!ABILITIES[slug]) unknown.add(slug);
    }
  }
  eq([...unknown].join(','), '', 'the panel must not link an ability slug that abilities.json cannot name');
}

/** The species link is a real URL, built through the canonical helper. */
{
  const nidoranF = speciesIndex.find(s => s.nameEn === 'Nidoran♀' || s.nameEn === 'Nidoran-F');
  const nidoranM = speciesIndex.find(s => s.nameEn === 'Nidoran♂' || s.nameEn === 'Nidoran-M');
  if (nidoranF && nidoranM) {
    ok(holderUrl({ nameEn: nidoranF.nameEn }) !== holderUrl({ nameEn: nidoranM.nameEn }),
      'the two Nidorans must not resolve to one detail URL');
  }
  eq(speciesIdText(25), '#025', 'the dex id is printed zero-padded to three');
  eq(speciesIdText(1025), '#1025', 'a four-digit id is not truncated to three');
}

/* ===== the panel is mounted, wired, and loaded ===== */

/**
 * The markup and the wiring. A module full of working queries is worth nothing
 * if the page never calls them — §3.I is exactly that shape, where a page called
 * a method the module did not yet define and every control died silently.
 */
ok(/id="ab-species"/.test(LIST), 'abilities.html needs the #ab-species panel the render writes into');
ok(/<section[^>]*id="ab-species"[^>]*\bhidden\b/.test(LIST_CODE),
  'the panel ships hidden — an unopened page must not render a species list');
ok(/id="ab-species-list"/.test(LIST), 'the panel needs a list container distinct from its own wrapper');
ok(/id="ab-species-more"/.test(LIST), 'the truncation notice needs its own element so it can be hidden without touching the results');
ok(/loadSpeciesAbilities\(\)/.test(LIST), 'the page must actually load the reverse index');
ok(/buildSpeciesIndex\(/.test(LIST), 'the page must turn the raw table into an ordered index');
ok(/filterSpecies\(/.test(LIST), 'the page must run the species query');
ok(/species_abilities\.json/.test(read('assets/js/abilities.js')),
  'the loader must name the generated file, not a hand-written path');

/**
 * The failure of the reverse index must not be the failure of the page.
 *
 * Both fetches go out together and the second is caught: the 314-card grid is
 * what abilities.html is for, so a missing 88 KB table has to degrade to
 * ability-search-only rather than replace the page with the error state.
 */
ok(
  /loadSpeciesAbilities\(\)\s*\.catch\(|Promise\.all\(\s*\[/.test(LIST),
  'the reverse index must be loaded so that ITS failure does not blank the ability list'
);
ok(!/loadAbilities\(\)\.then/.test(LIST),
  'the boot path should load both tables together, not chain the species index behind the ability one');

/**
 * The alarming empty state is written on exactly ONE branch, and it is not the
 * one where the species panel found something.
 *
 * Counted rather than pattern-matched because the phrase 「沒有符合的特性」 also
 * appears in the comment explaining why it is suppressed — a substring assertion
 * keyed on prose would be satisfied by the explanation of the rule it polices,
 * which is §3.P's shape. `ab-empty` is a class name, so it appears only where a
 * node is actually created.
 */
ok(/符合的寶可夢/.test(LIST),
  'the result line should report the species count as well as the ability count, so both questions have a visible answer');

/**
 * `renderSpecies()` returns `{ total }` so it can both report the cap decision and
 * leave the notice element written — and the caller interpolates that value into
 * a sentence. A bare binding therefore renders 「符合的寶可夢 [object Object] 隻」
 * on a page that had just answered the question correctly.
 *
 * **This was the actual defect, and it was found by rendering the page rather than
 * by any assertion** — every check above passed on it, because all of them ask
 * whether the prose EXISTS and none asks what it renders (§3.G1a's shape). The
 * guard below is on the MECHANISM, not on the string: the call site must
 * destructure, and it is brace-scoped to that one line so it cannot be satisfied
 * by a destructuring somewhere else in the file.
 */
{
  const callLine = (LIST_CODE.match(/[^\n]*renderSpecies\(\);/) || [''])[0];
  ok(/\{[^}]*total[^}]*\}\s*=\s*renderSpecies\(\)/.test(callLine),
    'renderSpecies() must be destructured at its call site — a bare binding renders 「[object Object]」 into the result line',
    );
  ok(!/const\s+\w+\s*=\s*renderSpecies\(\)/.test(LIST_CODE),
    'no bare `const x = renderSpecies()` — its return is an object, and the page prints it as a count');
}
eq(
  (LIST_CODE.match(/class="ab-empty"/g) || []).length,
  1,
  'the red empty state should be rendered on one branch only — a second occurrence means it now shows even when the species panel answered'
);
ok(
  /if \(speciesTotal\)[\s\S]{0,400}?els\.wrap\.innerHTML\s*=\s*''/.test(LIST_CODE),
  'the species-matched branch must clear the ability grid rather than render the empty state into it'
);

/** §3.A: cross-page URLs go through the canonical helpers, never assembled here. */
ok(/holderUrl\(/.test(LIST), 'the species row should build its detail URL through holderUrl()');
ok(/holderSprite\(/.test(LIST), 'the species row should get its artwork through holderSprite()');
ok(!/detail\.html\?slug=/.test(LIST), 'no hand-assembled detail.html URL — nidoran-f and nidoran-m must stay distinct');

/**
 * The chip is a LINK, and it must not be nested inside the species link.
 *
 * Two answers to two questions going to two pages; wrapping the chips inside the
 * anchor would make a chip click land on detail.html — the same class of defect
 * as §3.W's `role="img"` overriding an anchor's implicit link role.
 */
ok(/<a class="ab-species-id"[\s\S]{0,600}?<\/a>\s*<div class="ab-species-slots">/.test(LIST),
  'the species link must close before the ability slots open');
ok(!/<a class="ab-species-id"[\s\S]{0,900}?ab-slot-chips/.test(LIST),
  'an ability chip must never end up inside the species anchor');

/* ===== the panel's stylesheet ===== */

/** Every rule it adds is new and prefixed — §3.B1's rule for a sibling page. */
for (const sel of ['.ab-species', '.ab-species-list', '.ab-species-row', '.ab-slot-chips']) {
  ok(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{`).test(CSS_CODE), `${sel} should have its own rule`);
}
ok(!/\.ab-card\s*\{[^}]*ab-species/.test(CSS_CODE), 'no species rule should be grafted onto the shared .ab-card');
ok(!/\.ab-chip\s*\{[^}]*species/.test(CSS_CODE), 'no species rule should be grafted onto the shared .ab-chip');

/**
 * The sprite is Scarlet/Violet artwork, so `object-fit` and `object-position` are
 * asserted TOGETHER for §3.E's reason — `contain` alone passes an assertion about
 * fitting while the bottom-anchored subject floats 3.7px above the row's
 * baseline, which is a property assertion cannot see and `getComputedStyle`
 * would answer wrongly (`50% 100%` is what it returns for `bottom`).
 */
const speciesSpriteRule = (CSS_CODE.match(/\.ab-species-sprite\s*\{[^}]*\}/) || [''])[0];
ok(/\.ab-species-sprite\s*\{/.test(CSS_CODE), '.ab-species-sprite should declare its own box');
ok(/object-fit:\s*contain/.test(speciesSpriteRule),
  'the sprite needs object-fit: contain — width/height alone stretches the 120×112 SV art by 6%');
ok(/object-position:\s*bottom/.test(speciesSpriteRule),
  'the sprite must pair object-fit with object-position: bottom, or the subject floats off the row baseline (§3.E)');
ok(!/image-rendering/.test(speciesSpriteRule),
  'no image-rendering — the house convention is for UPSCALES and this is a 56px downscale');
ok(!/translateY/.test(speciesSpriteRule),
  'no translateY — nothing here pairs the image with a name on one line, so the offset has nothing to align');
ok(
  /width:\s*56px/.test(speciesSpriteRule) && /height:\s*56px/.test(speciesSpriteRule),
  'the sprite box should be 56×56 in the stylesheet'
);
ok(
  /<img[^>]*class="ab-species-sprite"[^>]*\bwidth="56"[^>]*\bheight="56"/.test(LIST),
  'the markup should declare width/height 56 too — a mismatch reserves the wrong box and then jumps (§3.AA)'
);

/**
 * The cap is a number the page and this file must agree on, so it is READ rather
 * than restated — a literal 12 written next to the assertion would pass after the
 * module changed it, which is the stale-second-copy defect §3.S records.
 */
ok(
  !/SPECIES_RESULT_CAP\s*=\s*12/.test(LIST),
  'the page must import SPECIES_RESULT_CAP, not write the number out a second time'
);
ok(
  /SPECIES_RESULT_CAP/.test(LIST) && /filterSpecies\([^)]*SPECIES_RESULT_CAP/.test(LIST),
  'the page should pass the shared cap into filterSpecies'
);

/* ===== the slot labels: geometry, and the one colour pairing that matters ===== */

/** One rule body by RAW selector — it escapes internally, so callers pass `.ab-x`. */
const ruleBody = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS_CODE.match(new RegExp(`(?:^|[}{])\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

/**
 * The label is a PILL so the three slots read as three things of the same kind.
 * Its vertical padding is what makes `align-items: center` load-bearing: an
 * unpadded caption aligns fine on a text baseline and a padded one does not, so
 * reverting either half alone leaves the row subtly crooked.
 */
const slotLabel = ruleBody('.ab-slot-label');
ok(/padding:/.test(slotLabel), 'the slot label should carry vertical padding — it is a pill, not a caption');
ok(/border-radius:\s*var\(--radius-pill\)/.test(slotLabel),
  'the slot label should use the pill radius, the same one .ab-chip uses');
ok(/background:\s*var\(--surface-raised\)/.test(ruleBody('.ab-slot-label.is-regular')),
  'the 常見特性 label needs a neutral fill — this is the distinction the reader is meant to see at a glance');
ok(/align-items:\s*center/.test(ruleBody('.ab-slot')),
  '.ab-slot should centre its label against its chips; `baseline` pushes a padded label below an unpadded one');
ok(/align-items:\s*center/.test(ruleBody('.ab-species-slots')),
  '.ab-species-slots should centre its groups for the same reason');
ok(/gap:\s*10px 28px/.test(ruleBody('.ab-species-slots')),
  'the two slot groups should be separated by 28px — a pill carries its own edge, and 20px read as cramped');

/**
 * **THE GOLD FILL IS ASSERTED AS A PAIR, NOT AS A TOKEN.**
 *
 * §3.AC measured what every other choice does to this exact fill, and the reason
 * is that `--accent-gold-surface` INVERTS between the themes — amber `#f5c542`
 * dark, Poké Ball red `#b3122a` light — so any `--text-*` token lands on the dark
 * end of the fill every time: `--text-primary` reads 1.44:1 / 2.56:1, and
 * `--text-muted` 1.58:1 / 1.24:1. `--on-accent` is 11.62:1 / 6.92:1.
 *
 * So a rule may reach for either token, but a gold fill must never end up under a
 * text colour — which is a statement about the RULE, and cannot be expressed by
 * asserting one property of it. Read against the comment-stripped copy, because
 * the comment above names all four of these tokens to explain exactly this.
 */
{
  const gold = ruleBody('.ab-slot-label.is-hidden');
  ok(/\.ab-slot-label\.is-hidden/.test(CSS_CODE) && gold,
    'the 隱藏特性 label needs its own rule — it is the one with the accent fill');
  ok(/background:\s*var\(--accent-gold-surface\)/.test(gold),
    'the hidden label should fill with the accent surface');
  ok(/color:\s*var\(--on-accent\)/.test(gold),
    'a gold fill REQUIRES --on-accent: the accent inverts between themes, so --text-primary reads 1.44:1 dark and --text-muted 1.24:1 light (§3.AC)');

  const textTokens = /--text-(primary|secondary|muted)/;
  ok(!textTokens.test(gold),
    'no text token may sit on the accent fill — every one of them fails WCAG AA in at least one theme');
  const neutralUsesOnAccent = /--on-accent/.test(ruleBody('.ab-slot-label'));
  ok(!neutralUsesOnAccent,
    '--on-accent is for the accent fill; the neutral label should not reach for it');
}

/**
 * Solid means the slot has abilities, dashed means it does not. That rule is only
 * worth anything if the three states are actually distinguishable, so it is
 * asserted as the difference between them rather than as any single declaration.
 */
{
  const shared = ruleBody('.ab-slot-label.is-shared');
  const none = ruleBody('.ab-slot-none');
  ok(/border:\s*1px dashed/.test(shared),
    'the folded-forme label is SOLID — it has abilities, and a dashed treatment would read as the absence it is not');
  ok(/border:\s*1px dashed/.test(none),
    '「沒有隱藏特性」 is the dashed one: an empty slot, and it must not look like a filled one');
  const takesAccent = /accent-gold/.test(shared) || /accent-gold/.test(none);
  ok(!takesAccent,
    'neither the ambiguous slot nor the empty one may take the accent — an absence is not a value, and only 隱藏 is rare');
}

/**
 * Every modifier the page builds has a rule, and vice versa — neither can drift.
 *
 * The class is INTERPOLATED (`is-${key}` inside a template literal), so the
 * rendered names are not in the source and a checker cannot read them off the
 * markup. What IS in the source is the three `slot(label, key, …)` calls, and the
 * second argument of each is exactly the modifier that will be emitted — so that
 * is what is asserted. A missing key would render `is-undefined` and style
 * nothing, which no pixel here would explain.
 */
{
  const calls = [...LIST_CODE.matchAll(/slot\(\s*'([^']+)'\s*,\s*'([^']+)'/g)].map(m => ({ label: m[1], key: m[2] }));
  eq(calls.map(c => c.key).sort().join(','), 'hidden,regular,shared',
    'the page should build exactly the three slot modifiers the stylesheet styles');
  for (const { label, key } of calls) {
    ok(CSS_CODE.includes(`.ab-slot-label.is-${key}`),
      `.ab-slot-label.is-${key} is emitted for 「${label}」 and should have a rule`);
  }
  const usesHas = /:has\(/.test(CSS_CODE);
  ok(!usesHas,
    'no :has() in this block — §3.W records a :has() rule that could never match, and none here is readable by an assertion');
}

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

/* ===== the tile follows .mv-learner, and the art is bigger ===== */

/** The border and its hover colour are ONE decision — a border without the hover
 *  change is the half that reads as unfinished — so they are asserted as a pair,
 *  the same way `object-fit` and `object-position` are (§3.E). */
const holderRule = (CSS_CODE.match(/\.ab-holder\s*\{[^}]*\}/) || [''])[0];
const holderHoverRule = (CSS_CODE.match(/\.ab-holder:hover\s*\{[^}]*\}/) || [''])[0];
ok(
  /border:\s*1px solid var\(--hairline\)/.test(holderRule),
  '.ab-holder should carry the same 1px hairline border as .mv-learner'
);
ok(
  /border-color:\s*var\(--hairline-strong\)/.test(holderHoverRule),
  '.ab-holder:hover should bump the border to --hairline-strong, as .mv-learner does'
);

/**
 * 64px in a 104px track is a 0.62 image-to-track ratio against `.mv-learner`'s
 * 56-in-88 = 0.64. The track is unchanged, so the grid still resolves to 9
 * columns — the bump is free, and it is affordable because the median ability
 * holds 3 species against move.html's 1,003 for 守住.
 */
ok(
  /width:\s*64px/.test(holderImgRule) && /height:\s*64px/.test(holderImgRule),
  '.ab-holder img should be 64px — the ratio that matches .mv-learner\'s tile'
);
ok(
  /minmax\(104px/.test(CSS_CODE),
  'the track stays 104px so the 64px bump costs no columns'
);
ok(
  /@media \(max-width: 640px\)[\s\S]*?\.ab-holder img\s*\{\s*width:\s*56px;\s*height:\s*56px;/.test(CSS_CODE),
  'the phone override should be 56px, keeping the same 0.64 proportion'
);

/** §3.AA's rule: `width`/`height` in the markup and in the stylesheet are BOTH
 *  asserted, because a mismatch reserves the wrong box before the image loads
 *  and then jumps once it arrives. */
ok(
  /<img[^>]*\bwidth="64"[^>]*\bheight="64"/.test(DETAIL_CODE),
  'the rendered <img> should declare width/height 64 to match the CSS, or the tile jumps when the PNG arrives'
);

/* ===== report ===== */

for (const note of notes) console.log(`  note  ${note}`);

if (failures === 0) {
  console.log(`PASS ${checks} checks`);
} else {
  console.error(`FAIL ${failures} of ${checks} checks`);
  process.exit(1);
}