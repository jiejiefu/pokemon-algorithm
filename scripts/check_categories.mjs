/**
 * Category registry regression test
 *
 *   node scripts/check_categories.mjs
 *
 * Guards assets/js/categories.js, which drives category.html. A selector whose
 * argument shape is wrong does not throw: it returns an empty array, and the
 * page renders a correctly-styled empty grid. A non-zero member count per
 * category is therefore asserted for every category.
 *
 * The other invariants pinned here are the ones that break quietly:
 *   - artwork exists on disk for every member;
 *   - every card has a Traditional Chinese title and a detail-page target,
 *     because a form card links to its BASE species (form ids like 10033 have no
 *     record in pokemon_data.json and detail.html could not resolve them);
 *   - the shiny page's cards are real artwork on disk and not a CSS filter, and
 *     shared.js still points them at assets/images/shiny/;
 *   - every declared filter selects at least one member;
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
  HUB_SLUGS,
  NON_HUB_SLUGS,
  COLLECTION_GROUPS,
  COLLECTION_TINTS,
  TAG_TONES,
  HUE_STEPS,
  TINT_ALPHA,
  TAG_ALPHA,
  rgbOf,
  getCategory,
  passesFilter,
  appendRichText,
  typeTextStyleSheet,
  typeSlugForZh,
  TYPE_TEXT_COLORS,
} from '../assets/js/categories.js';
import { TYPE_COLORS, TYPE_EN_ZH, hexToRgb } from '../assets/js/shared.js';
import { SHINY_IDS, hasShiny } from '../assets/js/shiny-index.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok } = C;

/**
 * Source with its comments removed, for the guards below that assert on what the
 * code does rather than what it says.
 *
 * Both files document the filter they no longer apply, by name and by value, so
 * a guard matching raw text would fail on those comments. Line comments, block
 * comments and CSS /* *\/ blocks are all stripped.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
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
ok(CATEGORIES.mega.members !== CATEGORIES.gigantamax.members, 'mega and gigantamax share one selector');
for (const slug of ['mega', 'gigantamax', 'regional']) {
  const withBadge = CATEGORIES[slug].members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains).filter((m) => m.formBadge);
  ok(withBadge.length > 0, `${slug}: no member carries a form badge`);
}

// ---------------------------------------------------------------------------
// The shiny page shows REAL artwork, and that is now a claim with a check behind
// it. It used to be the opposite: the cards were recoloured by a CSS filter and
// the page said so in a banner, which is why the assertion here used to be
// `disclaimer === true` — the disclaimer WAS the contract.
//
// The new contract is that all 1025 cards point at assets/images/shiny/. Three
// ways that can rot, one assertion each:
//   1. a file goes missing -> a broken <img>, invisible to any JSON-only check,
//      so the same existsSync test the normal artwork gets is run per member;
//   2. a future `needs` or selector change quietly shrinks the roster -> the
//      index is the source of truth, not the count on the page;
//   3. someone reinstates the filter as a "cheap" alternative to 1025 real files
//      -> source-text guards, same shape as check_sv_index.mjs greps in
//      types.html. A recoloured sprite is not a shiny, and the mistake is
//      invisible in a screenshot because it still looks like a Pokémon.
// ---------------------------------------------------------------------------
console.log('shiny page: real artwork, not a filter');

const shinyMembers = CATEGORIES.shiny.members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains);
const noShinyArt = shinyMembers.filter((m) => !existsSync(join(ROOT, 'assets/images/shiny', m.filename)));
ok(
  noShinyArt.length === 0,
  `shiny: ${noShinyArt.length} members with no real shiny artwork on disk (e.g. #${noShinyArt[0]?.id} → ${noShinyArt[0]?.filename})`
);
// The index and the disk are generated from each other, so this is really a check
// that nobody hand-edited shiny-index.js — but it is the number the page's 3rd
// tile prints, so it is worth asserting that every one of the page's own members
// is in it, not merely that the index is non-empty.
const notInIndex = shinyMembers.filter((m) => !hasShiny(m.id));
ok(notInIndex.length === 0, `shiny: ${notInIndex.length} members missing from shiny-index.js (e.g. #${notInIndex[0]?.id})`);
ok(SHINY_IDS.size >= shinyMembers.length, `shiny-index.js holds ${SHINY_IDS.size} ids, fewer than the page's ${shinyMembers.length} members`);

const sharedJs = stripComments(readFileSync(join(ROOT, 'assets/js/shared.js'), 'utf8'));
ok(
  /useShiny\s*=\s*.*hasShiny\(pokemon\.id\)/.test(sharedJs),
  'shared.js: createPokemonCard no longer gates its shiny src on hasShiny() — a member without a shiny file would paint a broken image'
);
ok(
  /useShiny\s*\?\s*ASSETS\.shiny\s*:\s*ASSETS\.images/.test(sharedJs),
  'shared.js: createPokemonCard does not point shiny cards at ASSETS.shiny'
);

const sharedCss = stripComments(readFileSync(join(ROOT, 'assets/css/shared.css'), 'utf8'));
ok(!/is-shiny/.test(sharedCss), 'shared.css: a `.card.is-shiny` rule is back — the shiny page no longer emits that class');
ok(!/hue-rotate/.test(sharedCss), 'shared.css: hue-rotate is back — the placeholder recolour has returned');

// The disclaimer mechanism is gone rather than merely unused: `disclaimer: true`
// on a config is what used to render the yellow banner, and a config carrying it
// again would render nothing at all now that renderDisclaimer() is deleted.
ok(
  !CATEGORY_SLUGS.some((slug) => CATEGORIES[slug].disclaimer !== undefined),
  'a config still sets `disclaimer`, but the banner that rendered it has been deleted'
);
console.log(`  ${shinyMembers.length} members, all with real artwork (index holds ${SHINY_IDS.size} ids)\n`);

// ---------------------------------------------------------------------------
// The 600族 roster, pinned. The page's 4th tile claims all ten need two
// evolutions, and no selector computes that claim, so this is the only assertion
// standing behind the words on the page.
// ---------------------------------------------------------------------------
console.log('600族寶可夢 roster + evolution depth');

const PSEUDO = 'pseudo-legendary';
const PSEUDO_ROSTER = [149, 248, 373, 376, 445, 635, 706, 784, 887, 998];
const pseudoMembers = CATEGORIES[PSEUDO].members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains);
const pseudoIds = pseudoMembers.map((p) => p.id);
ok(
  JSON.stringify(pseudoIds) === JSON.stringify(PSEUDO_ROSTER),
  `600族 roster drifted\n        got      ${JSON.stringify(pseudoIds)}\n        expected ${JSON.stringify(PSEUDO_ROSTER)}`
);
for (const p of pseudoMembers) {
  ok(p.stats?.total === 600, `#${p.id} ${p.names.zh} is not 600 BST (${p.stats?.total})`);
  ok(!p.is_legendary && !p.is_mythical, `#${p.id} ${p.names.zh} is legendary or mythical`);
}

// The one record the two flags admit and the definition rejects. Asserted by
// name so that removing the exclusion from PSEUDO_EXCLUDED cannot pass quietly
// as "the roster assertion was just updated to match".
const archaludon = pokemon.find((p) => p.id === 1018);
ok(archaludon?.stats?.total === 600, '#1018 is no longer 600 BST — revisit PSEUDO_EXCLUDED');
ok(!archaludon?.is_legendary && !archaludon?.is_mythical, '#1018 is now flagged legendary/mythical');
ok(!pseudoIds.includes(1018), '#1018 鋁鋼橋龍 must not be a 600族 member (one evolution, not two)');

// Stage count -> evolution count, over both chain shapes this data uses.
const baseStages = (p) => {
  const chain = chains[p.evolution_chain_id];
  if (!chain) return 0;
  // A form row is `-Mega` / `-Gmax` / a numeric variant id. Counting them as
  // stages is what makes 妙蛙草's chain read 3 evolutions instead of 2.
  //
  // Base-vs-form is an id-authoritative rule, NOT a name test.
  // This used to be `!/-/.test(row.name)`, the same name-based classifier the
  // evolution generator used until it was repaired: it silently classified
  // Nidoran-F, Mr-Mime and Ho-Oh as forms. It passed only because none of the
  // 600族 names contain a hyphen.
  const isBase = (row) => typeof row.id === 'number' && row.id <= 1025;
  // No fallback to special_forms.other. It was here solely because chain 408
  // used to have an empty main_line, and it would now hide the next regression
  // of exactly that kind rather than reporting it.
  return (chain.main_line || []).filter(isBase).length;
};

for (const p of pseudoMembers) {
  const stages = baseStages(p);
  // 3 stages = 2 evolutions. A species that is not the final stage of its own
  // line would make this pass by coincidence, so require both.
  ok(stages === 3, `#${p.id} ${p.names.zh} has ${stages} base stages in chain ${p.evolution_chain_id}, expected 3 (two evolutions)`);
  const chain = chains[p.evolution_chain_id];
  const last = (chain.main_line || [])
    .filter((row) => typeof row.id === 'number' && row.id <= 1025)
    .at(-1);
  ok(last?.id === p.id, `#${p.id} is not the final stage of chain ${p.evolution_chain_id} (last is #${last?.id})`);
}

// And the negative case, which is the one that proves the depth logic works: if
// the count were simply "any chain with 3 rows", Archaludon's chain 465 has
// Duraludon(884) → Archaludon(1018) → Duraludon-Gmax(10225) and would read 2
// stages. Asserting it reads 2 documents why it is excluded.
ok(baseStages(archaludon) === 2, '#1018 should read 2 base stages (Duraludon → Archaludon)');
ok(baseStages(archaludon) - 1 === 1, '#1018 is a one-evolution species — the reason it is not 600族');

// Generation coverage: the page says 9, and 黏美龍 is the only mono-type. Both
// are claims in `prose`/`notes`, so they are checked here rather than trusted.
const pseudoGens = new Set(pseudoMembers.map((p) => p.generation));
ok(pseudoGens.size === 9, `600族 spans ${pseudoGens.size} generations, prose claims 9`);
ok([...pseudoGens].sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8,9', `600族 generations are ${[...pseudoGens].sort()}`);
const monoType = pseudoMembers.filter((p) => p.types.length === 1);
ok(
  monoType.length === 1 && monoType[0].id === 706,
  `notes claim 黏美龍 is the only mono-type member — found ${monoType.map((p) => `#${p.id} ${p.names.zh}`).join(', ') || 'none'}`
);
const dragonish = pseudoMembers.filter((p) => p.types.includes('Dragon')).length;
ok(dragonish === 8, `600族 has ${dragonish} Dragon-type members, expected 8 (the accent ramp assumes a warm page)`);

// ---------------------------------------------------------------------------
// The Dragon page's roster and every number its `prose` states.
//
// The tiles are functions, so they cannot rot on their own — but `prose` is a
// hand-written paragraph of hard numbers, and a paragraph is exactly the kind of
// content that outlives the data it describes. Each `ok` below is one sentence
// from that paragraph, so regenerating `pokemon_data.json` fails here with the
// claim named, instead of the page quietly contradicting itself.
// ---------------------------------------------------------------------------
console.log('\n龍屬性寶可夢 roster + prose claims');

const DRAGON = 'dragon';
const dragonMembers = CATEGORIES[DRAGON].members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains);
const dragonIds = dragonMembers.map((p) => p.id);

ok(dragonMembers.length === 70, `龍屬性寶可夢 roster is ${dragonMembers.length}, prose claims 70`);
ok(
  new Set(dragonIds).size === 70,
  `龍屬性寶可夢 has duplicate ids: ${dragonIds.length - new Set(dragonIds).size} repeats`
);

// The membership rule itself. `dragonMembers` is `types.includes('Dragon')`, and
// the two ways that can be wrong are silent: a lowercase 'dragon' yields an EMPTY
// roster, and testing `types[0]` yields a roster missing every dual type that
// lists the other type first (三首惡龍 is Dark/Dragon and would drop). Asserting
// both known shapes pins the rule without pinning all 70 ids, which would make
// this file a second copy of the roster.
const darkDragon = dragonMembers.filter((p) => p.id === 635);
ok(
  darkDragon.length === 1 && darkDragon[0].types[0] === 'Dark',
  '三首惡龍 (#635) must be a member even though its FIRST type is Dark — `types.includes`, not `types[0]`'
);
const monoDragons = dragonMembers.filter((p) => p.types.length === 1);
ok(
  monoDragons.length === 13 && monoDragons.every((p) => p.types[0] === 'Dragon'),
  `prose claims 13 pure-Dragon members — found ${monoDragons.length}`
);

// Non-members that a name-based rule would have swept in. The second note on the
// page exists precisely because these are not Dragon-type, so the roster has to
// disagree with their names.
for (const [id, why] of [
  [6, '噴火龍 is Fire/Flying'],
  [130, '暴鯨龍 is Water/Flying'],
  [142, '化石翼龍 is Rock/Flying'],
  [181, '電龍 is Electric'],
]) {
  ok(!dragonIds.includes(id), `#${id} ${why} — it must NOT be a 龍屬性 member`);
}

const dragonGens = new Set(dragonMembers.map((p) => p.generation));
ok(dragonGens.size === 9, `龍屬性 spans ${dragonGens.size} generations, prose claims 9`);
ok(
  [...dragonGens].sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8,9',
  `龍屬性 generations are ${[...dragonGens].sort((a, b) => a - b)}`
);

// 「第九世代一次新增 14 隻，是九個世代裡最多的」 — the superlative is the claim
// that rots first when a new generation lands, so it is derived, not restated.
const perGen = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => dragonMembers.filter((p) => p.generation === g).length);
const busiestGen = perGen.indexOf(Math.max(...perGen)) + 1;
ok(
  busiestGen === 9 && perGen[8] === 14,
  `prose claims gen 9 is the busiest at 14 — per-generation counts are ${JSON.stringify(perGen)}`
);

// 「第一世代只有迷你龍、哈克龍與快龍三隻」, and 快龍 is the only final evolution
// among them. The second half is the interesting one: Dratini and Dragonair are
// middle stages, so a roster that quietly gained a gen-1 species would not fail
// a bare count of 3.
const gen1 = dragonMembers.filter((p) => p.generation === 1).sort((a, b) => a.id - b.id);
ok(
  JSON.stringify(gen1.map((p) => p.id)) === JSON.stringify([147, 148, 149]),
  `gen 1 Dragon members are ${JSON.stringify(gen1.map((p) => `#${p.id} ${p.names.zh}`))}, prose claims 迷你龍/哈克龍/快龍`
);
const dragonite = pokemon.find((p) => p.id === 149);
ok(dragonite?.stats?.total === 600, '#149 快龍 is no longer 600 BST');

// Tile 4 is 12, and the prose walks the 12 → 9 → 8 chain to explain why that is
// not the 600族 count. All three numbers are asserted: 12 total, 3 of them
// legendary, and 8 of the 9 non-legendary in the 600族 roster above.
const bst600 = dragonMembers.filter((p) => p.stats?.total === 600);
ok(bst600.length === 12, `${bst600.length} Dragon members are 600 BST, tile claims 12`);
const bst600Legendary = bst600.filter((p) => p.is_legendary);
ok(
  bst600Legendary.length === 3 && bst600Legendary.every((p) => p.is_legendary),
  `prose claims 3 of the 12 are legendary — found ${JSON.stringify(bst600Legendary.map((p) => `#${p.id} ${p.names.zh}`))}`
);
const bst600NonLegendary = bst600.filter((p) => !p.is_legendary);
ok(bst600NonLegendary.length === 9, `prose claims 9 non-legendary 600-BST dragons, found ${bst600NonLegendary.length}`);
ok(
  bst600NonLegendary.filter((p) => pseudoIds.includes(p.id)).length === dragonish,
  'the 8 non-legendary dragons in the 600族 roster and the `dragonish` count above must be the same set'
);

const dragonLegendary = dragonMembers.filter((p) => p.is_legendary);
ok(dragonLegendary.length === 14, `${dragonLegendary.length} Dragon members are legendary, tile claims 14`);
ok(
  dragonMembers.filter((p) => p.is_mythical).length === 0,
  'a Dragon-type mythical appeared — prose claims none, and the count is not on the page'
);

// ---------------------------------------------------------------------------
// today.html's 精選系列 grid.
//
// These nine `.today-link-card[data-cat]` cards are the ONLY place a category's
// member count is shown as static markup — the COLLECTION_TINTS loop tints a card
// by slug but never writes its number, so a count here is a hand-typed copy of
// whatever `members()` returned the day the card was written. Four of them had
// drifted (mega 46 vs 48, regional "60+" vs 58, ultra-beast 11 vs 12, paradox 16
// vs 22) behind a 敬請期待 badge that no longer had anything to do with the number
// being wrong. Comparing each against the live selector is the whole guard.
// ---------------------------------------------------------------------------
console.log('\n今日推薦 · 精選系列 cards: links + counts');

// Read from today.html: index.html gave its content sections to that page and
// kept only the hero and the feature grid, so the 精選系列 grid and the 熱門搜尋
// tags the NON_HUB_SLUGS check below looks for are both there now.
const indexHtmlRaw = readFileSync(join(ROOT, 'today.html'), 'utf8');
// Strip what a reader never sees before matching on markup. This is not
// tidiness: the CSS comment above `.home-link-badge` and the markup comment above
// the first card both *quote* `<span class="home-link-card is-planned">`, and a
// non-greedy card regex that starts inside a comment swallows every real card up
// to the next `</span>` — five of the nine matched as zero.
const indexHtml = indexHtmlRaw
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<script\b[\s\S]*?<\/script>/gi, '');
// Card blocks, whole: tag name, extra classes, remaining attributes, body.
const homeCards = [...indexHtml.matchAll(/<(a|span) class="today-link-card([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g)];
ok(homeCards.length > 0, 'no .today-link-card blocks matched in today.html — the markup shape changed');

const homeCatCards = homeCards
  .map((m) => {
    const slug = m[3].match(/data-cat="([^"]+)"/)?.[1] ?? null;
    const num = m[4].match(/class="today-link-num">([^<]+)</)?.[1] ?? null;
    return { tag: m[1], planned: /\bis-planned\b/.test(m[2]), slug, num, body: m[4], href: m[3].match(/href="([^"]+)"/)?.[1] ?? null };
  })
  .filter((c) => c.slug);

ok(
  homeCatCards.length === 9,
  `the 精選系列 grid has ${homeCatCards.length} category cards, expected 9 (one per HUB_SLUGS entry)`
);

// Every hub category has a card, and no non-hub category does. This is the
// invariant behind §3.F in AGENTS.md: 600族 and 龍屬性 are reached from 熱門搜尋
// instead, so adding either here would break `totalCards === 11` and put a page in
// two navigation surfaces.
const homeCardSlugs = homeCatCards.map((c) => c.slug).sort();
ok(
  homeCardSlugs.join(',') === [...HUB_SLUGS].sort().join(','),
  `homepage card slugs are ${homeCardSlugs} — expected exactly HUB_SLUGS ${[...HUB_SLUGS].sort()}`
);
for (const slug of NON_HUB_SLUGS) {
  ok(!homeCardSlugs.includes(slug), `${slug} is NON_HUB_SLUGS and must not have a 精選系列 card`);
  ok(
    indexHtml.includes(`category.html?cat=${slug}`),
    `${slug} is NON_HUB_SLUGS, so it must be linked from the homepage somewhere (熱門搜尋)`
  );
}

for (const card of homeCatCards) {
  const cfg = CATEGORIES[card.slug];
  ok(cfg !== undefined, `homepage card data-cat="${card.slug}" has no CATEGORIES entry`);
  ok(card.tag === 'a', `<${card.tag} data-cat="${card.slug}"> should be an <a> — its category page exists`);
  ok(!card.planned, `data-cat="${card.slug}" is still is-planned`);
  ok(
    !card.body.includes('敬請期待'),
    `data-cat="${card.slug}" still shows a 敬請期待 badge next to a working link`
  );
  ok(
    card.href === `category.html?cat=${card.slug}`,
    `data-cat="${card.slug}" points at ${card.href}, expected category.html?cat=${card.slug}`
  );
  // "1,025" and "60+" both have to survive parsing, so strip the decoration
  // rather than comparing strings — "60+" is what this assertion exists to reject.
  const shown = card.num === null ? null : Number(card.num.replace(/[^\d]/g, ''));
  const actual = cfg.members(SLOTS.pokemon, SLOTS.gens, SLOTS.chains).length;
  ok(
    shown === actual,
    `homepage card ${card.slug} shows ${JSON.stringify(card.num)} but its category has ${actual} members`
  );
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
  JSON.stringify(hubSlugs) === JSON.stringify(HUB_SLUGS),
  `hub cards do not match HUB_SLUGS\n        hub   ${JSON.stringify(hubSlugs)}\n        slugs ${JSON.stringify(HUB_SLUGS)}`
);
// Every hub card must be a real category page. Asserting BOTH differences, with
// exact values, is what stops "the hub and the registry are the same list" from
// creeping back in as an unexamined invariant the next time someone adds a page:
// a one-directional `every()` only proves the hub is a subset, so a category
// missing from the hub and a typo in the hub both slip through it.
const hubOnly = HUB_SLUGS.filter((s) => !CATEGORY_SLUGS.includes(s));
const nonHub = CATEGORY_SLUGS.filter((s) => !HUB_SLUGS.includes(s));
ok(hubOnly.length === 0, `HUB_SLUGS contains a slug the registry does not: ${JSON.stringify(hubOnly)}`);
ok(
  JSON.stringify(nonHub) === JSON.stringify(NON_HUB_SLUGS),
  `categories without a hub card are ${JSON.stringify(nonHub)}, expected ${JSON.stringify(NON_HUB_SLUGS)} — decide the hub explicitly for each new category`
);
// Order is the other half: COLLECTION_GROUPS is emitted top-to-bottom, so the
// same 9 slugs in a different order is a different page, not a passing check.
ok(
  JSON.stringify(HUB_SLUGS) === JSON.stringify(CATEGORY_SLUGS.filter((s) => !NON_HUB_SLUGS.includes(s))),
  `HUB_SLUGS order differs from registry order: ${JSON.stringify(HUB_SLUGS)}`
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
// white text below 4.5:1. Asserted rather than trusted, because "the colours
// look dark enough" is exactly the claim that rots silently.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const chan = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = (hex) => { const [r, g, b] = chan(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, alpha) => '#' + chan(fg).map((v, i) => Math.round(v * alpha + chan(bg)[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');

console.log('\nhero contrast (white text on the lightest accent stop)');
for (const slug of CATEGORY_SLUGS) {
  // Guarded, because `getCategory()` returns null for a slug with no config and a
  // bare `.accent` turns a typo into a TypeError. That aborts the whole run
  // *after* earlier FAILs have been recorded but *before* the summary prints
  // them, so the operator gets a stack trace and no report — the same
  // "assertion told you about the wrong file" trap. Skipping keeps the failure
  // visible and named.
  const cfg = getCategory(slug);
  if (!cfg || !Array.isArray(cfg.accent) || cfg.accent.length === 0) {
    ok(false, `CATEGORY_SLUGS has ${JSON.stringify(slug)} but getCategory() has no accent ramp for it`);
    continue;
  }
  const accent = cfg.accent;
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
  JSON.stringify(tintKeys.filter((k) => k !== 'upcoming')) === JSON.stringify(HUB_SLUGS),
  `COLLECTION_TINTS covers ${JSON.stringify(tintKeys)} — expected the 9 hub slugs plus "upcoming"`
);

// No two LIVE categories may share a gradient pair. Note this is asserted on the
// PAIR, not on one corner: InfoPoke gives both `starter` (red→orange) and
// `gigantamax` (red→yellow) the same red `from`, so sampling a single corner
// finds them "identical" (#fef2f1 / #341619) even though their far ends differ
// (#fff7ed vs #fefce9). The two `upcoming` cards are excluded on purpose — they
// both take the neutral slate→gray pair, which is the point of it.
const pairs = new Map();
for (const slug of HUB_SLUGS) {
  const tint = COLLECTION_TINTS[slug];
  if (!tint) {
    ok(false, `HUB_SLUGS has ${JSON.stringify(slug)} but COLLECTION_TINTS has no gradient for it`);
    continue;
  }
  const { from, to } = tint;
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

// ---------------------------------------------------------------------------
// Rich text in `prose` / `notes`.
//
// `**name**` and `{{type}}` are a closed vocabulary rendered into real nodes.
// Two things make them worth guarding:
//
//   1. A bold name is asserted to be a REAL Pokémon name from
//      pokemon_data.json. This is not ceremony: 「暴鯨龍」 was written into the
//      Dragon notes from memory and does not exist — the official zh-TW name of
//      #130 Gyarados is 暴鯉龍, and no species has ever been named 暴鯨. Nothing
//      in the page would have looked wrong. Trainer names are deliberately NOT
//      bolded precisely so this assertion can be total: 阿渡 or 竹蘭 in `**…**`
//      would mean the token had started meaning "any proper noun" and stopped
//      being checkable.
//   2. A {{…}} must be one of the eighteen type names, and must have a colour.
//      A typo there renders as uncoloured text, which reads as an oversight
//      rather than an error.
// ---------------------------------------------------------------------------
console.log('\nprose / notes rich text: markers, real names, real types');

const ZH_NAMES = new Set(pokemon.map((p) => p.names.zh));
const TYPE_ZH = new Set(Object.values(TYPE_EN_ZH));
const RICH = /\*\*([^*]+)\*\*|\{\{([^{}]+)\}\}/g;

let boldTokens = 0;
let typeTokens = 0;

for (const slug of CATEGORY_SLUGS) {
  const cfg = getCategory(slug);
  const fields = [['prose', cfg.prose], ...(cfg.notes || []).map((n, i) => [`notes[${i}]`, n])];
  for (const [field, text] of fields) {
    const where = `${slug} ${field}`;
    const stars = (text.match(/\*\*/g) || []).length;
    ok(stars % 2 === 0, `${where}: ** markers pair up (${stars})`);
    const opens = (text.match(/\{\{/g) || []).length;
    const closes = (text.match(/\}\}/g) || []).length;
    ok(opens === closes, `${where}: {{ }} markers pair up (${opens}/${closes})`);

    for (const m of text.matchAll(RICH)) {
      if (m[1] !== undefined) {
        boldTokens += 1;
        ok(ZH_NAMES.has(m[1]), `${where}: 「${m[1]}」 is a real Pokémon name in pokemon_data.json`);
      } else {
        typeTokens += 1;
        const slugFor = typeSlugForZh(m[2]);
        ok(slugFor !== null, `${where}: {{${m[2]}}} is one of the eighteen type names`);
        ok(
          !slugFor || Object.hasOwn(TYPE_TEXT_COLORS, slugFor),
          `${where}: {{${m[2]}}} has a generated text colour`
        );
      }
    }

    // What the parser does not consume would be shown to the reader verbatim.
    const leftover = text.replace(RICH, '');
    ok(!/\*\*|\{\{|\}\}/.test(leftover), `${where}: no marker characters survive rendering`);

    // Implementation notes leaking into reader-facing copy. The Dragon notes used
    // to end by explaining that the selector reads `types` from
    // `pokemon_data.json`; useful to a maintainer, not to someone looking up
    // which Pokémon are Dragon-type.
    ok(!/pokemon_data|dragonMembers|evolution_chains/.test(text), `${where}: no file or function names in reader-facing copy`);
  }
}
ok(boldTokens > 0, `rich text is actually used (${boldTokens} bold names, ${typeTokens} type words)`);

// The parser's one real hazard is a `{{…}}` nested inside a `**…**`: 電龍 begins
// with the Electric type's Chinese name, so re-scanning strong content would
// colour the 電 from inside the name.
const stubDoc = () => ({
  createTextNode: (t) => ({ nodeName: '#text', textContent: t }),
  createElement: () => ({
    nodeName: 'ELEMENT',
    className: '',
    textContent: '',
    dataset: {},
    children: [],
    appendChild(n) {
      this.children.push(n);
      return n;
    },
  }),
});
const stubParent = () => ({ children: [], appendChild(n) { this.children.push(n); return n; } });
const typeSpans = (p) => p.children.filter((c) => c.className === 'cat-type' && c.dataset.type).length;

const nested = stubParent();
ok(appendRichText(nested, '**{{電}}龍**', stubDoc()) === 0, 'a {{type}} inside **bold** is not re-read as a type');
ok(typeSpans(nested) === 0, 'a {{type}} nested in a bold name emits no type span');

const positive = stubParent();
ok(appendRichText(positive, '**電龍**是{{龍}}屬性', stubDoc()) === 1, 'a plain {{type}} still renders one type token');
ok(typeSpans(positive) === 1, 'the parser is not simply inert');

const unknown = stubParent();
ok(appendRichText(unknown, '{{火属}}', stubDoc()) === 0, 'an unknown type name renders no type token');
ok(
  unknown.children.some((c) => c.dataset.unknownType === '火属'),
  'an unknown type name is marked with data-unknown-type, not silently coloured'
);

// category.html must keep building nodes. Clearing a container with
// `innerHTML = ''` is fine and already idiomatic here; assigning a config
// string to it is the hole the token vocabulary closes, so the right-hand side
// is checked rather than the mere presence of the property.
const catHtml = readFileSync(join(ROOT, 'category.html'), 'utf8');
const catCss = readFileSync(join(ROOT, 'assets/css/category.css'), 'utf8');
const htmlAssignments = [...catHtml.matchAll(/\.(?:inner|outer)HTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
ok(htmlAssignments.length > 0, 'category.html does clear containers via innerHTML (sanity: the scan found something)');
for (const rhs of htmlAssignments) {
  ok(rhs === "''" || rhs === '""', `HTML is only ever cleared, never assigned content (${rhs})`);
}
ok(!/insertAdjacentHTML|\.html\(|dangerouslySetInnerHTML/.test(catHtml), 'category.html has no other HTML-injection path');
ok(/appendRichText/.test(catHtml), 'category.html renders prose and notes through appendRichText');
ok(/typeTextStyleSheet/.test(catHtml), 'category.html injects the generated type stylesheet');
ok(catCss.includes('.cat-type'), 'category.css styles the .cat-type token');

console.log('\ntype text colours: 18 types × 2 themes, all clearing 4.5:1');

// The generator mirrors --bg-card rather than reading it, so a theme change has
// to be caught here or every colour silently drifts against its own background.
// Declared more than twice (a media query re-states the light value), so the
// invariant is on the SET, not the count — what must not happen is a third
// background appearing that the generator knows nothing about.
const KNOWN_CARD_BG = ['#ffffff', '#161e38'];
const catBgTokens = [...readFileSync(join(ROOT, 'assets/css/shared.css'), 'utf8').matchAll(/--bg-card:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
ok(
  catBgTokens.every((v) => KNOWN_CARD_BG.includes(v)),
  `every declared --bg-card is one the generator knows (${[...new Set(catBgTokens)].join(', ')})`
);
ok(catBgTokens.includes('#ffffff'), 'shared.css still has a white --bg-card for the light theme');
ok(catBgTokens.includes('#161e38'), 'shared.css still has the #161e38 --bg-card for the dark theme');

const CAT_BG_MIRROR = { light: '#ffffff', dark: '#161e38' };
ok(
  Object.keys(TYPE_TEXT_COLORS).length === 18,
  `all eighteen types have a text colour (${Object.keys(TYPE_TEXT_COLORS).length})`
);

let worstType = Infinity;
let worstTypeKey = '';
for (const [slug, pair] of Object.entries(TYPE_TEXT_COLORS)) {
  for (const theme of ['light', 'dark']) {
    ok(/^#[0-9a-f]{6}$/i.test(pair[theme]), `${theme}: ${slug} ${pair[theme]} is a parseable hex`);
    const r = contrast(pair[theme], CAT_BG_MIRROR[theme]);
    if (r < worstType) {
      worstType = r;
      worstTypeKey = `${slug}/${theme} ${pair[theme]}`;
    }
    ok(r >= 4.5, `${theme}: type "${slug}" text ${pair[theme]} on ${CAT_BG_MIRROR[theme]} is ${r.toFixed(2)}:1 (needs 4.50)`);
  }
}
console.log(`  worst type text ${worstType.toFixed(2)}:1 (${worstTypeKey})`);

// The generated stylesheet must actually carry both themes, or one of them
// silently falls back to the paragraph colour.
const sheet = typeTextStyleSheet();
ok(sheet.includes('.cat-intro .cat-type[data-type="dragon"]'), 'the stylesheet is scoped to .cat-intro and covers every type');
ok(sheet.includes('[data-theme="dark"] .cat-intro .cat-type[data-type="dragon"]'), 'the stylesheet carries a dark-theme rule per type');
ok(
  (sheet.match(/\[data-type=/g) || []).length === 36,
  `the stylesheet has one rule per type per theme (${(sheet.match(/\[data-type=/g) || []).length} of 36)`
);
ok(
  Object.values(TYPE_TEXT_COLORS).some((p) => p.light !== p.dark),
  'at least one type actually needs a different colour per theme'
);

console.log(
  C.failures.length === 0
    ? `\nall ${C.checks} checks passed`
    : `\n${C.failures.length} of ${C.checks} checks FAILED`
);
process.exit(C.failures.length === 0 ? 0 : 1);