#!/usr/bin/env node
/**
 * Regression checks for graph.html's category chips.
 * Run: node scripts/check_graph_chip_network.mjs
 *
 * graph.js keeps a link only when both endpoints survive the active filter
 * (assets/js/graph.js:399-403). Every `mega` and `gmax` link is base -> form, so
 * pressing 精選分類 → 超級進化 used to drop all 93 parents and leave 93 isolated
 * sprites: 93 nodes / 0 links / 93 components. This file asserts that every chip
 * draws a connected web rather than a pile.
 *
 * The filter is pure arithmetic over graph_data.json, so the whole question is
 * answerable off disk; a CDP run would cost a Chrome boot to compute a
 * connected-components count, and §3.G4's stub work established that the slow half of
 * a page check is not where these answers live. This runs in well under 0.2s.
 *
 * 超極巨化 is a DECLARED exception (0 links / 34 components): connecting it needs
 * Dynamax nodes and artwork that do not exist in this corpus. The exception is
 * itself asserted to remain isolated, so it cannot outlive its reason (§3.F's
 * opposite shape: a "known set" whose bound stayed), and every chip outside the list
 * must have links > 0.
 *
 * `linkColors` is read out of graph.js rather than restated (§3.S): a hardcoded
 * copy is a second source of truth for the answer the assertion exists to police.
 *
 * Before this file, nothing in the suite read a header's geometry or a chip's
 * `data-filter-cat` (§3.N).
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
 * `gmax` is the only one: the honest relation is gmax <-> dynamax, and the corpus
 * has no Dynamax nodes or artwork.
 */
const DECLARED_ISOLATED = {
  gmax: 'no intra-category edge exists; the honest relation is gmax <-> dynamax, '
      + 'and there are no Dynamax nodes or artwork in the corpus',
};

/** Largest-connected-component floor, as a share of the chip's node count.
 *
 * 0.5 is a floor, not a description of health. The tightest chip is 幻之寶可夢 at
 * 12/23 = 0.52, which is 0.02 above the line and therefore on the watch list.
 */
const LARGEST_FLOOR = 0.5;

/** The form families whose nodes cross-check against the fetch cache.
 *  Declared here rather than at its one use so the SKIP branch can still report
 *  how many nodes went unchecked. */
const FORM_FAMILIES = new Set(['mega', 'gmax', 'regional']);

/** Strip comments before scanning source or markup for structure.
 *
 * graph.html's prose names `data-filter-rel`, and graph.js's linkColors block
 * carries a 20-line explanation of its fallback; scanning raw text walks out of
 * either. Same reason check_page_module_api.mjs masks comments (§3.S).
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

/* The fetch cache is gitignored, so a fresh clone without it is a NORMAL state --
 * and one where build_graph_data.py has already given every form node its BASE's
 * types and stats.
 *
 * This is not an early exit. Everything above runs either way and only the form
 * cross-check is skipped: exiting early would throw away 100+ valid checks over a
 * missing optional input. `check_spectrogram_port.mjs` established the convention:
 * print SKIP, exit 0, and count the skipped section in the summary so
 * `PASS N checks, 1 section skipped` cannot be read as `all good`. */
let formCache = null;
let cacheReason = '';
try {
  formCache = JSON.parse(readFileSync(join(BASE, 'data-sources/pokeapi_form_stats.json'), 'utf8')).forms;
} catch (err) {
  cacheReason = err.code === 'ENOENT' ? 'file absent' : String(err.message);
}

console.log('chip connectivity (every 精選分類 "featured category" chip must draw a web, not a pile)');

/* ---- the chip lists, parsed out of graph.html ---------------------------- */

const catChips = [...html.matchAll(/data-filter-cat="([^"]*)"/g)].map((m) => m[1]);
const relChips = [...html.matchAll(/data-filter-rel="([^"]*)"/g)].map((m) => m[1]);

ok(catChips.length >= 8, `graph.html declares only ${catChips.length} category chips; expected the 9 special-category buttons`);
ok(catChips.includes('all'), 'the 全部 "All" chip (data-filter-cat="all") is gone');
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
 * The pattern allows an opening quote before the `#` because the values are string
 * literals (`mega: '#d946ef'`). A regex written as `(\w+):\s*#` matches nothing and
 * reports all thirteen types as unstyled -- a checker that fails everything, not
 * one that catches a defect. */
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

console.log('\nrelation chips (every 關係圖層 "relation layer" chip must be able to draw something)');

/* THE KEPT LIST IS A LIST, NOT A THRESHOLD.
 *
 * A floor on the largest connected component cannot reproduce the decision: `form`
 * has a 15-node mass and no chip, while 純進化鏈 has 9 and one, so any threshold
 * separating them has to be tuned until it happens to. A threshold tuned until it
 * passes the answer is §3.F's failure in a new costume. This pins the DECISION and
 * records why each chip earned it, which is what a later edit has to re-argue.
 *
 * The two reasons are genuinely different:
 *
 *   A. The chip draws a share of the whole scene: 屬性星系環 touches 1,025 of 1,346
 *      nodes, 雙屬性共生橋 637, 純進化鏈 824.
 *   B. The chip names a category also reachable through a 精選分類 chip that is
 *      itself one connected network: 超級形態屬型群 and 地區型態群 are mega -> mega
 *      and regional -> regional, and 悖謬特徵群 is one family behind the 悖謬寶可夢
 *      chip (20 nodes / 36 edges / 1 component).
 *
 * 御三家羈絆, 超級進化, 超極巨化 and the bare `regional` edge are reason C: 2-4 node
 * groups with neither property. Their links remain in graph_data.json and are still
 * drawn by 全域融合網絡 -- what was removed is the button, not the data. */
const KEPT_RELATION_CHIPS = {
  all: 'the default: every link type at once',
  type_resonance: 'A — 1,025 of 1,346 nodes touched, 17 rings of >= 10',
  dual_type: 'A — 637 nodes touched, 12 trees of >= 10',
  mega_type: 'B — mega -> mega; the 超級進化 category chip is 93n / 136e / 1 component',
  regional_clade: 'B — regional -> regional; the 地區形態 chip is 54n / 107e / 1 component',
  evolution: 'A — 824 nodes touched, 484 edges; kept on the reader\'s call despite a largest component of 9',
  pantheon: 'A — 136 edges over 72 nodes in 19 lore clusters, largest 11',
};
/* Link types with no chip, and what a reader gets instead. Asserted so that ADDING a
 * chip is a deliberate edit here rather than something that appears in graph.html
 * with no argument attached. */
const UNCHIPPED_RELATIONS = {
  mega: 'groups of 2 — reachable through the 超級進化 category chip',
  gmax: 'groups of 2 — no category chip reaches it; the one known gap, §3.V',
  regional: 'groups of 3 — reachable through the 地區形態 category chip',
  form: 'groups of <= 4, and the group is a catch-all (Oricorio, Minior, Greninja-Ash, Zygarde-Complete, Pikachu-Cap share one type)',
  starter_trio: 'nine triangles of 3',
  paradox_pair: 'ten pairs — reachable through the 悖謬寶可夢 category chip',
  paradox_clade: 'B, but it is already drawn by the 悖謬寶可夢 category chip, so a second button would be a second way to say it',
  pseudo_legendary: 'B, but it is already drawn by the 600 族 category chip',
};

eq([...relChips].sort(), Object.keys(KEPT_RELATION_CHIPS).sort(),
  'graph.html\'s relation chip list has drifted from KEPT_RELATION_CHIPS — adding or removing a button is a decision, so it belongs in this file');

for (const [ltype, reason] of Object.entries(UNCHIPPED_RELATIONS)) {
  ok(!relChips.includes(ltype),
    `"${ltype}" has a chip again (${reason}) — update KEPT_RELATION_CHIPS with the argument for it`);
  ok(data.links.some((l) => l.type === ltype),
    `link type "${ltype}" has no chip AND no links — it was dropped rather than deferred, which is not what UNCHIPPED_RELATIONS says`);
}
for (const [ltype, reason] of Object.entries(KEPT_RELATION_CHIPS)) {
  ok(typeof reason === 'string' && reason.length > 12,
    `KEPT_RELATION_CHIPS["${ltype}"] has no written reason — a chip kept without one is a chip nobody re-argues`);
}

/* And every chip, kept or not, must do something on the FIRST press. */
for (const ltype of relChips) {
  if (ltype === 'all') continue;
  const n = data.links.filter((l) => l.type === ltype).length;
  ok(n > 0, `relation chip "${ltype}" has 0 links of its type in the graph — the button highlights and changes nothing`);
}

console.log('\ntoggle (pressing a row\'s active chip again returns it to 全部 "All")');

/* Every filter row toggles, and the three rows that did not are the defect this
 * pins. 屬性共振 had it from the start; 世代劃分 / 關係圖層 / 精選分類 each carried
 * their own copy of "strip is-active, add is-active, assign, apply" and no way
 * back. */
const jsClean = maskJsComments(js);
const FILTER_ATTRS = ['data-filter-gen', 'data-filter-rel', 'data-filter-cat', 'data-filter-type'];
for (const attr of FILTER_ATTRS) {
  ok(jsClean.includes(`bindFilterRow('${attr}'`),
    `graph.js no longer binds ${attr} through bindFilterRow() -- the toggle is the shared helper's whole job, so a bespoke handler means the row stopped toggling`);
}
ok(jsClean.includes('const bindFilterRow = (attr, noFilter, get, set)'),
  'graph.js no longer declares the shared bindFilterRow helper');
ok(!/style="color:#/i.test(html),
  'graph.html has an inline type colour again -- those 18 hex values are a third copy of shared.js TYPE_COLORS');

/* The type buttons must appear in the effectiveness chart's order. Read OUT of
 * type-chart.js, which is the generated single source of truth (§3.D), so a
 * re-extraction that reorders the table reorders the panel with no edit here.
 *
 * Parsed as an array of quoted strings rather than JSON.parse'd: the export is
 * JavaScript with single quotes and a trailing comment, so JSON.parse answers
 * "Unexpected token '''" -- which is a parse error here and, had it been inside a
 * try, a silently skipped assertion. */
const chartSrc = readFileSync(join(BASE, 'assets/js/type-chart.js'), 'utf8');
const orderBlock = chartSrc.match(/export const TYPE_CHART_ORDER\s*=\s*\[([\s\S]*?)\]/);
ok(Boolean(orderBlock), 'assets/js/type-chart.js no longer exports TYPE_CHART_ORDER as an array literal');
const chartOrder = orderBlock
  ? [...orderBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];
const typeBtnOrder = [...html.matchAll(/data-filter-type="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]);
eq(typeBtnOrder.map(([t]) => t), chartOrder,
  'graph.html\'s 屬性共振 "type resonance" buttons are not in TYPE_CHART_ORDER (assets/js/type-chart.js) order');
eq(typeBtnOrder.length, 18, `graph.html should declare exactly 18 type buttons, found ${typeBtnOrder.length}`);
for (const [t, label] of typeBtnOrder) {
  ok(label.length > 0, `the 屬性共振 "type resonance" button for "${t}" has no visible label`);
}

console.log('\nintra-category families (the fix itself: these edges must stay internal)');

/* The three families that make the chips work. If one of them ever links across
 * categories, the chip it serves goes back to a pile -- and that is invisible in
 * review, because the link itself looks perfectly reasonable. */
for (const ltype of ['paradox_pair', 'paradox_clade', 'mega_type', 'regional_clade']) {
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

/* 地區形態: the same two questions, and the first one is about a FIELD.
 *
 * `region` is alola / galar / hisui / paldea, and it was not a field at all before
 * the fix: build_graph_data.py's walk over `variants` passed the literal 'regional'
 * where the key was in hand, so all 54 nodes reported the same thing and the four
 * regions were invisible even though evolution_chains.json names them. The stars
 * above are built from this column, so a node that lost it dropped out of a chip
 * with no error anywhere. */
const REGIONS = ['alola', 'galar', 'hisui', 'paldea'];
const regionalNodes = data.nodes.filter((n) => n.category === 'regional');
const regionless = regionalNodes.filter((n) => !REGIONS.includes(n.region));
ok(regionless.length === 0,
  `${regionless.length} regional form(s) carry no region field (${regionless.slice(0, 5).map((n) => n.name).join(', ')}), so they are in no 地區系群 edge`);

const byRegion = new Map();
for (const n of regionalNodes) {
  if (!byRegion.has(n.region)) byRegion.set(n.region, []);
  byRegion.get(n.region).push(n.id);
}
ok(byRegion.size === 4, `expected 4 regions among the ${regionalNodes.length} regional forms, found ${[...byRegion.keys()].join(', ')}`);

const regionalTouched = new Set(
  data.links.filter((l) => l.type === 'regional_clade').flatMap((l) => [l.source, l.target])
);
const strandedRegional = regionalNodes.filter((n) => !regionalTouched.has(n.id));
ok(strandedRegional.length === 0,
  `${strandedRegional.length} regional form(s) are in no regional_clade edge: ${strandedRegional.slice(0, 5).map((n) => n.name).join(', ')}`);

/* Every region of two or more must be a STAR whose hub is its LOWEST id -- the
 * choice is deterministic rather than prettiest, so the checker pins it rather than
 * re-deciding it. Paldea has one member and must emit no hub edge at all: a 1-node
 * group is not a group, and a self-loop is the shape `add_link` refuses. */
for (const [region, ids] of byRegion) {
  const sorted = [...ids].sort((a, b) => a - b);
  if (sorted.length < 2) {
    ok(!data.links.some((l) => l.type === 'regional_clade' && l.source === sorted[0]),
      `region "${region}" has a single member (#${sorted[0]}) but emits a hub edge`);
    continue;
  }
  const hub = sorted[0];
  for (const other of sorted.slice(1)) {
    const linked = data.links.some(
      (l) => l.type === 'regional_clade'
        && ((l.source === hub && l.target === other) || (l.source === other && l.target === hub)));
    ok(linked, `#${other} (${region}) is not linked to its region hub #${hub} — the hub must be the region's lowest id`);
  }
}

console.log('\nform nodes carry their own types and stats');

const formNodes = data.nodes.filter((n) => FORM_FAMILIES.has(n.category));

/* The data defect: build_graph_data.py used to copy the base species' types and
 * stats onto every form, so 超級噴火龍 X read Fire/Flying and the dossier drew
 * Venusaur's numbers on 超級妙蛙花. Wrong, visible, and green through the suite,
 * because a copied value is a plausible value.
 *
 * The comparison is against the fetch cache rather than a hand-written expectation,
 * so the fetch decides and this file only insists the graph agrees. */
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
  /* 180 of 181. The threshold is a floor, not the answer: it is here so that a
   * partially-failing fetch (PokeAPI under load, a region key renamed) reports
   * how few it got rather than passing on whatever arrived. `notFound` below
   * pins the exact one that is legitimately absent. */
  ok(checked > 175, `only ${checked} form nodes were compared against the fetch cache; expected 180`);

  /* The one form PokeAPI does not have. Pinned as a literal because the alternative
   * is a set that grows silently: fetch_form_stats.py already reports it, but a
   * report nobody reads is not a guard. */
  const notFound = Object.entries(formCache).filter(([, v]) => !v.found).map(([id]) => Number(id)).sort((a, b) => a - b);
  eq(notFound, [10314], 'the set of forms with no upstream PokeAPI entry changed -- read the fetch output and decide whether that is a new upstream gap or a bad id in this project');
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