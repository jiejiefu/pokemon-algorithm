#!/usr/bin/env node
/**
 * Regression checks for graph.html's category chips. Run: node scripts/check_graph_chip_network.mjs
 *
 * WHAT THIS EXISTS FOR
 * ===================
 * Nothing in the suite read `data-filter-cat` before this file. The manifest's only
 * graph.html entries are check_graph_browser.mjs (a CDP smoke test, `manual: true`
 * and `serial: true`, the most expensive entry in the suite) and its harness. So
 * 精選分類 had no coverage at all while §3.N of AGENTS.md records, in the graph
 * section, that "nothing in the suite reads a header's geometry".
 *
 * The defect it would have caught is a structural one and it shipped silently.
 * graph.js keeps only links whose BOTH endpoints survive the active filter:
 *
 *     assets/js/graph.js:399-403
 *       return nodeIds.has(srcId) && nodeIds.has(tgtId);
 *
 * Every `mega` and `gmax` link is base -> form, i.e. cross-category by
 * construction, so pressing 精選分類 → 超級進化 dropped all 93 parents and left 93
 * sprites with 0 links and nothing but `d3Force('charge').strength(-140)` pushing
 * them apart. Measured before the fix: 93 nodes / 0 links / 93 components, and
 * 悖謬 at 20 / 8 / 12. 600 族 read 30 / 48 / 1 -- one component -- because its ring
 * is intra-category, which is the entire difference between a chip that filters a
 * web and a chip that filters a pile.
 *
 * WHY STATIC RATHER THAN OVER CDP
 * ===============================
 * The filter is three lines of pure arithmetic over graph_data.json, so the whole
 * question "what does pressing this chip draw" is answerable off disk. Putting it
 * in the browser would cost ~6s and a Chrome boot to compute a connected-components
 * count, and §3.G4's stub work already established that the slow half of a page
 * check is not where these answers live. This runs in well under 0.2s.
 *
 * THE EXCEPTION LIST IS THE INTERESTING PART
 * ==========================================
 * 超極巨化 is still 0 links / 34 components, because making it connect needs 32
 * Dynamax sprites and two more generator scripts (there are no Dynamax nodes in the
 * corpus and no Dynamax artwork anywhere under assets/ -- measured, `find assets
 * -iname '*dynamax*'` returns zero). That is a real gap, recorded in AGENTS.md §7 of
 * this change, and it is written down here as a DECLARED exception with its reason.
 *
 * Two things make that a decision rather than a silence:
 *
 *   1. `DECLARED_ISOLATED` is asserted to STILL be isolated. If 超極巨化 ever gets
 *      links, this checker FAILS and someone deletes the entry -- so the exception
 *      cannot outlive its reason. §3.F's seven silently-truncated species were
 *      recorded as a "known set" and the bound stayed; this is the opposite shape.
 *   2. Every chip that is NOT in the list must have links > 0. Adding a new chip
 *      that renders a pile therefore fails here rather than in front of a reader.
 *
 * Reading `linkColors` out of graph.js rather than restating it follows §3.S's
 * rule (check_color_page.mjs reads OPEN_BUTTON_MOUNT out of shared.js): a hardcoded
 * copy in the assertion is a second source of truth for the exact answer the
 * assertion exists to police, and it goes stale in the dangerous direction.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
let skipped = 0;
const problems = [];
const ok = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
const eq = (got, want, msg) => ok(
  Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
  `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`
);

/**
 * Chips that are KNOWN to draw a pile rather than a web, with the reason.
 *
 * `gmax` is the only one. See the docblock: the fix needs Dynamax nodes that do
 * not exist in this corpus.
 */
const DECLARED_ISOLATED = {
  gmax: 'no intra-category edge exists; the honest relation is gmax <-> dynamax, '
      + 'and there are no Dynamax nodes or artwork in the corpus',
};

/** Largest-connected-component floor, as a share of the chip's node count.
 *
 * 0.5 is a FLOOR and not a description of health. The tightest chip against it is
 * 幻之寶可夢 at 12/23 = 0.52, which is 0.02 above the line and is therefore on the
 * watch list rather than comfortable -- the assertion is doing its job there.
 */
const LARGEST_FLOOR = 0.5;

/** The two form families whose nodes cross-check against the fetch cache.
 *  Declared here rather than next to its one use so the SKIP branch above, which
 *  runs BEFORE the cross-check, can still report how many nodes went unchecked. */
const FORM_FAMILIES = new Set(['mega', 'gmax']);

/** Strip comments before scanning source or markup for structure.
 *
 * graph.html's own prose explains what these chips do and names `data-filter-rel`
 * while doing it, and graph.js's linkColors block carries a 20-line explanation of
 * why the fallback existed. Scanning raw text walks straight out of either. Same
 * reason check_page_module_api.mjs masks comments -- and §3.S's note that this
 * mistake landed first in the checker written to catch the real thing.
 */
const maskJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const maskHtmlComments = (src) => src.replace(/<!--[\s\S]*?-->/g, ' ');

/** Brace-match a block that starts at `open`, so an assertion cannot walk past its
 * own closing brace into the next function. §3.P: four of check_maze_page.mjs's 23
 * mutations stayed green for exactly this reason. */
function blockAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`no closing brace for the object literal at offset ${open}`);
}

const html = maskHtmlComments(readFileSync(join(BASE, 'graph.html'), 'utf8'));
const js = maskJsComments(readFileSync(join(BASE, 'assets/js/graph.js'), 'utf8'));
const data = JSON.parse(readFileSync(join(BASE, 'assets/data/graph_data.json'), 'utf8'));

/* The fetch cache is gitignored (see .gitignore: raw PokeAPI payloads are out, the
 * generated table is in), so a fresh clone without it is a NORMAL state -- and one
 * where build_graph_data.py has already quietly given every form node its BASE's
 * types and stats.
 *
 * It is NOT an early exit. Everything above this point runs either way, and the
 * form cross-check below is skipped on its own. Two reasons that is the right shape
 * rather than a fast one: exiting early would throw away 100+ valid checks over a
 * missing optional input, and `check_spectrogram_port.mjs` already established the
 * convention -- print SKIP, exit 0, and make the line impossible to skim past,
 * because the alternative is an entry that reports green having verified nothing.
 *
 * The reason is printed with the command that fixes it, and the SKIP is counted in
 * the summary so `PASS 127 checks, 1 section skipped` cannot be read as `PASS 127
 * checks, all good`. */
let formCache = null;
let cacheReason = '';
try {
  formCache = JSON.parse(readFileSync(join(BASE, 'data-sources/pokeapi_form_stats.json'), 'utf8')).forms;
} catch (err) {
  cacheReason = err.code === 'ENOENT' ? 'file absent' : String(err.message);
}

console.log('chip connectivity (every 精選分類 chip must draw a web, not a pile)');

/* ---- the chip lists, parsed out of graph.html ---------------------------- */

const catChips = [...html.matchAll(/data-filter-cat="([^"]*)"/g)].map((m) => m[1]);
const relChips = [...html.matchAll(/data-filter-rel="([^"]*)"/g)].map((m) => m[1]);

ok(catChips.length >= 8, `graph.html declares only ${catChips.length} category chips; expected the 9 special-category buttons`);
ok(catChips.includes('all'), 'the 全部 chip (data-filter-cat="all") is gone');
ok(new Set(catChips).size === catChips.length,
  `graph.html repeats a category chip: ${JSON.stringify(catChips)}`);

/* Every chip must name a category the data actually contains, or the press is a
 * no-op that looks like a working filter -- the button highlights, the badge
 * reports the same numbers, nothing is wrong. */
const categoriesInData = new Set(data.nodes.map((n) => n.category));
for (const chip of catChips) {
  if (chip === 'all') continue;
  ok(categoriesInData.has(chip),
    `category chip "${chip}" matches no node in graph_data.json, so pressing it filters to an empty graph`);
}

/* ---- the induced subgraph a chip actually draws -------------------------- */

const nodesById = new Map(data.nodes.map((n) => [n.id, n]));

/** Same predicate graph.js:399-403 uses: a link survives only if both endpoints do. */
function induced(cat) {
  const ids = new Set(data.nodes.filter((n) => n.category === cat).map((n) => n.id));
  const links = data.links.filter((l) => ids.has(l.source) && ids.has(l.target));
  return { ids, links };
}

/** Connected components over an undirected view of the induced subgraph.
 *  `ids` is a Set, hence the spread: a Set has no .map, and passing one is the
 *  kind of mistake that reads as a data problem when it is a call-site one. */
function components(ids, links) {
  const parent = new Map();
  for (const i of ids) parent.set(i, i);
  const find = (a) => {
    while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); }
    return a;
  };
  for (const l of links) {
    const ra = find(l.source), rb = find(l.target);
    if (ra !== rb) parent.set(ra, rb);
  }
  const sizes = new Map();
  for (const i of ids) {
    const root = find(i);
    sizes.set(root, (sizes.get(root) || 0) + 1);
  }
  return { count: sizes.size, largest: Math.max(...sizes.values(), 0) };
}

const measured = {};
for (const chip of catChips) {
  if (chip === 'all') continue;
  const { ids, links } = induced(chip);
  const comp = components(ids, links);
  measured[chip] = { nodes: ids.size, links: links.length, comps: comp.count, largest: comp.largest };

  const declared = chip in DECLARED_ISOLATED;
  const ratio = ids.size ? comp.largest / ids.size : 0;

  if (declared) {
    /* The point of declaring an exception: it must still BE one. */
    ok(links.length === 0,
      `"${chip}" is in DECLARED_ISOLATED but now has ${links.length} links -- delete the entry and its reason`);
    continue;
  }

  ok(links.length > 0,
    `"${chip}" draws ${ids.size} nodes with 0 links: a pile, not a network (${DECLARED_ISOLATED[chip] || 'no declared reason'})`);
  ok(ratio >= LARGEST_FLOOR,
    `"${chip}" largest component is ${comp.largest}/${ids.size} (${(ratio * 100).toFixed(0)}%), below the ${LARGEST_FLOOR * 100}% floor`);
}

/* `all` is the one chip allowed to be a pile, and it is allowed because the graph
 * is the graph -- but it must still have links at all. */
const allLinks = induced('standard');
ok(data.links.length > 1000, `graph_data.json has only ${data.links.length} links`);

console.log(`  measured ${Object.entries(measured).map(([k, v]) => `${k} ${v.nodes}n/${v.links}e/${v.comps}c`).join('  ')}`);

console.log('\nlink type styling (every drawn type has a colour, none are orphaned)');

/* Read linkColors out of graph.js rather than restating it.
 *
 * The pattern allows an opening quote before the `#`: the values are string
 * literals (`mega: '#d946ef'`), and a regex written as `(\w+):\s*#` matches nothing
 * at all and reports every one of the thirteen types as unstyled -- which is a
 * checker that fails everything, not one that catches a defect. */
const colorsAt = js.indexOf('const linkColors = {');
ok(colorsAt !== -1, 'graph.js no longer declares `const linkColors = {`');
const colorKeys = colorsAt === -1
  ? []
  : [...blockAt(js, js.indexOf('{', colorsAt)).matchAll(/(\w+)\s*:\s*(['"`])#/g)].map((m) => m[1]);
ok(colorKeys.length > 0, 'the linkColors literal parsed to zero keys -- the pattern above is wrong, not the page');

const drawnTypes = [...new Set(data.links.map((l) => l.type))].sort();
const metaTypes = Object.keys(data.metadata.link_types).sort();

for (const t of drawnTypes) {
  ok(colorKeys.includes(t),
    `link type "${t}" (${data.links.filter((l) => l.type === t).length} links) has no linkColors entry, so it renders in the '#38bdf8' fallback -- which is starter_trio's colour`);
}
for (const k of colorKeys) {
  ok(drawnTypes.includes(k), `linkColors has "${k}" but no link of that type exists in the data`);
}

/* metadata.link_types used to enumerate eight of ten types, and the eight summed to
 * 978 while total_links was 2,523. That is where graph.html's stale "978 條" came
 * from, so the field is checked against both the data and its own total. */
for (const t of drawnTypes) {
  const counted = data.metadata.link_types[t];
  ok(counted !== undefined, `metadata.link_types omits "${t}"`);
  if (counted !== undefined) {
    eq(counted, data.links.filter((l) => l.type === t).length, `metadata.link_types.${t}`);
  }
}
const metaSum = Object.values(data.metadata.link_types).reduce((a, b) => a + b, 0);
eq(metaSum, data.metadata.total_links,
  'metadata.link_types does not sum to metadata.total_links -- the object claims to describe the links and does not');

console.log('\nintra-category families (the fix itself: these edges must stay internal)');

/* The three families that make the chips work. If one of them ever links across
 * categories, the chip it serves goes back to a pile -- and that is invisible in
 * review, because the link itself looks perfectly reasonable. */
for (const ltype of ['paradox_pair', 'paradox_clade', 'mega_type']) {
  const ofType = data.links.filter((l) => l.type === ltype);
  ok(ofType.length > 0, `no "${ltype}" links in the graph at all`);
  const crossing = ofType.filter((l) => nodesById.get(l.source).category !== nodesById.get(l.target).category);
  ok(crossing.length === 0,
    `${crossing.length} "${ltype}" link(s) cross categories (first: ${crossing[0]?.source}->${crossing[0]?.target}), so the category filter drops them`);
}

/* 悖謬: the ten Ancient/Future counterpart pairs must cover every paradox node
 * exactly once on each side. Read from `paradox_side`, which build_graph_data.py
 * copies out of pokemon_data.json, so the table and the data can disagree -- and
 * the disagreement is the thing worth failing on. */
const paradoxNodes = data.nodes.filter((n) => n.category === 'paradox');
ok(paradoxNodes.every((n) => n.paradox_side === 'ancient' || n.paradox_side === 'future'),
  `${paradoxNodes.filter((n) => !['ancient', 'future'].includes(n.paradox_side)).length} paradox node(s) carry no paradox_side, so no clade can be built for them`);

const ancient = paradoxNodes.filter((n) => n.paradox_side === 'ancient').map((n) => n.id).sort((a, b) => a - b);
const future = paradoxNodes.filter((n) => n.paradox_side === 'future').map((n) => n.id).sort((a, b) => a - b);
eq(ancient.length, future.length, 'the paradox roster is not an even Ancient/Future split');

const paired = data.links.filter((l) => l.type === 'paradox_pair');
eq(paired.length, ancient.length, 'paradox_pair does not have one edge per Ancient member');
const pairedIds = new Set(paired.flatMap((l) => [l.source, l.target]));
for (const n of paradoxNodes) {
  ok(pairedIds.has(n.id), `paradox #${n.id} (${n.name}) is in no 同源對 edge, so it is unreachable from the rest of the chip`);
}
for (const l of paired) {
  const [a, b] = [nodesById.get(l.source), nodesById.get(l.target)];
  ok(a.paradox_side !== b.paradox_side,
    `paradox_pair ${l.source}->${l.target} joins two ${a.paradox_side} members; a 同源對 is always one Ancient against one Future`);
}

/* 超級進化: the mega_type stars must reach every mega node. A mega form whose only
 * relations are cross-category is invisible the moment its chip is pressed, which
 * is the defect this whole change exists to remove. */
const megaNodes = data.nodes.filter((n) => n.category === 'mega');
const megaTyped = new Set(data.links.filter((l) => l.type === 'mega_type').flatMap((l) => [l.source, l.target]));
const orphanedMegas = megaNodes.filter((n) => !megaTyped.has(n.id));
ok(orphanedMegas.length === 0,
  `${orphanedMegas.length} mega form(s) are in no mega_type edge and stay isolated when the chip is pressed: ${orphanedMegas.slice(0, 5).map((n) => n.name).join(', ')}`);

console.log('\nform nodes carry their own types and stats');

const formNodes = data.nodes.filter((n) => FORM_FAMILIES.has(n.category));

/* The data defect: build_graph_data.py used to copy the base species' types and
 * stats onto every form, so 超級噴火龍 X read Fire/Flying and the dossier drew
 * Venusaur's numbers on 超級妙蛙花. Wrong, visible, and green through the suite,
 * because a copied value is a plausible value.
 *
 * Compared against the fetch cache rather than against a hand-written expectation,
 * so it is the fetch that decides and this file only insists the graph agrees. */
if (!formCache) {
  console.log(`  SKIP  data-sources/pokeapi_form_stats.json (${cacheReason}) -- the ${formNodes.length} `
    + 'mega/gmax nodes were NOT cross-checked against their own types or stats.');
  console.log('        Run `python scripts/fetch_form_stats.py` to close this section.');
  skipped = 1;
} else {
  let checked = 0, mismatched = 0, fellBack = 0;
  for (const n of formNodes) {
    const cached = formCache[String(n.id)];
    if (!cached || !cached.found) { fellBack++; continue; }
    checked++;
    if (JSON.stringify(n.types) !== JSON.stringify(cached.types)) {
      mismatched++;
      if (mismatched <= 3) {
        problems.push(`form #${n.id} ${n.name_en} types ${JSON.stringify(n.types)} != fetched ${JSON.stringify(cached.types)}`);
      }
    }
  }
  ok(mismatched === 0, `${mismatched} form node(s) do not carry the types fetch_form_stats.py fetched for them`);

  /* A form whose stats equal its base's is not automatically wrong -- 76 of the 93
   * mega forms genuinely keep their base's total -- so the check is that the cache's
   * stats are the ones in the graph, not that they differ. */
  let statsMismatch = 0;
  for (const n of formNodes) {
    const cached = formCache[String(n.id)];
    if (!cached || !cached.found) continue;
    if ((n.stats || {}).total !== undefined && cached.stats) {
      const apiTotal = cached.stats.hp + cached.stats.attack + cached.stats.defense
                     + cached.stats['special-attack'] + cached.stats['special-defense'] + cached.stats.speed;
      if (n.stats.total !== apiTotal) statsMismatch++;
    }
  }
  ok(statsMismatch === 0, `${statsMismatch} form node(s) do not carry the base stat total fetch_form_stats.py fetched`);
  ok(checked > 120, `only ${checked} form nodes were compared against the fetch cache; expected 126`);

  /* The one form PokeAPI does not have. Pinned as a literal because the alternative
   * is a set that grows silently: fetch_form_stats.py already reports it, but a
   * report nobody reads is not a guard. */
  const notFound = Object.entries(formCache).filter(([, v]) => !v.found).map(([id]) => Number(id)).sort((a, b) => a - b);
  eq(notFound, [10314], 'the set of forms with no upstream PokeAPI entry changed -- read the fetch output and decide whether that is a new upstream gap or our own bad id');
  ok(fellBack === notFound.length,
    `${fellBack} form node(s) fell back to base values but the cache reports ${notFound.length} unfetched form(s)`);
}

/* ---- report -------------------------------------------------------------- */

console.log('');
if (problems.length) {
  for (const p of problems) console.log(`  FAIL  ${p}`);
  console.log(`\nFAIL ${problems.length} of ${checks} checks`);
  process.exit(1);
}
const tail = skipped ? `, ${skipped} section skipped` : '';
console.log(`PASS ${checks} checks${tail}`);