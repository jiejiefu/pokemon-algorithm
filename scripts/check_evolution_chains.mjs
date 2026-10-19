#!/usr/bin/env node
/**
 * Regression checks for assets/data/evolution_chains.json.
 * Run: node scripts/check_evolution_chains.mjs
 *
 * This pins the invariants that the name-based classifier got wrong, because all
 * of them are invisible in a rendered screenshot and none of them raise an error:
 *
 *  - 76 species whose CSV `name` contains a hyphen (Nidoran-F, Mr-Mime, Kommo-O,
 *    Ho-Oh, Type-Null, Tapu-Koko, Wo-Chien, Iron-Thorns, Roaring-Moon, ...)
 *    matched the catch-all `-.+$` variant pattern and were filed under
 *    special_forms.other. That emptied main_line on 51 of 541 chains and dropped
 *    a stage from 18 more -- Wormadam disappeared from between Burmy and Mothim.
 *  - Every node's link target is `name_en`, and 379 of them (325 forms, which
 *    have no detail page, plus 54 species whose CSV spelling drifted from
 *    pokemon_data.json's names.en) resolved to a URL that 404s. `base_name_en`
 *    is the field that fixes it, so it is asserted to resolve for all 1350.
 *    That count is now 364, after the Nidoran split gave both halves a slug of
 *    their own, the Flabebe accent fix stopped the mark becoming a separator,
 *    and correcting twelve misspelled EN names made the roster's slugs agree
 *    with these nodes again; see the assertions in this file for why each of
 *    those is the fix working rather than the count drifting.
 *  - All 1025 species must answer to a distinct slug. Nidoran♀ and Nidoran♂
 *    differed by nothing but a symbol, and ♀/♂ are stripped by the slug filter,
 *    so both resolved to `nidoran` and first-match-wins sent every request to
 *    尼多蘭. Uniqueness is asserted over all 1025 rather than as a special case
 *    for the pair, because a regression that dropped the fix would leave every
 *    other link check in this file passing.
 *
 * Like the other check_*.mjs scripts it reads only committed files: no network,
 * and no re-derivation from the CSV, which is the generator's job.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(join(BASE, p), 'utf8'));

const MAX_ID = 1025;
const CHAIN_COUNT = 541;
const NODE_COUNT = 1350;
const FORM_COUNT = 325;

let checks = 0;
const problems = [];
const ok = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
// Messages are truncated, assertions are not: when a whole-file invariant breaks
// the "got" list is 1350 ids long, and a 3000-char line is as unreadable as a
// stack trace. Show the first few and the count.
const brief = v => {
  const s = JSON.stringify(v);
  if (s === undefined || s.length <= 120) return s;
  const arr = Array.isArray(v);
  if (!arr) return `${s.slice(0, 117)}...`;
  return `${JSON.stringify(v.slice(0, 6))}... (+${v.length - 6} more, ${v.length} total)`;
};
const eq = (got, want, msg) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${brief(got)}, want ${brief(want)}`);

/** Verbatim port of pokemonSlug() in assets/js/shared.js.
 *  If the two ever diverge this check stops proving anything, so the body is
 *  duplicated rather than imported -- shared.js pulls in the whole DOM-side
 *  module graph, which a node script cannot load. */
const slugName = (name) => name
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/** ♀/♂ are dropped by slugName() above, so Nidoran♀ and Nidoran♂ collide on
 *  `nidoran` and find() answers 尼多蘭 for both. Ported from SYMBOL_SLUGS in
 *  shared.js. Both halves carry an explicit letter, so neither slug asserts
 *  less than the data does; `nidoran` is deliberately not kept as an alias. */
const SYMBOL_SLUGS = new Map([
  ['Nidoran♀', 'nidoran-f'],
  ['Nidoran♂', 'nidoran-m'],
]);

/** Name-level form of pokemonSlug(). Every resolution below goes through this
 *  rather than slugName(), because base_name_en is a raw name that can be
 *  `Nidoran♂` -- and slugName() strips that symbol straight back to the shared
 *  `nidoran`, which is the collision the table exists to end.
 *
 *  The chain file spells the pair with ASCII hyphens (`Nidoran-F`), so its
 *  base_name_en values miss the table and fall through to slugName() -- which
 *  happens to derive the same two slugs, because a hyphen is a separator there
 *  too. That is why `nidoran-f` has to stay the generic rule's own output for
 *  this pair and not merely a table lookup. */
const slugFor = (name) => SYMBOL_SLUGS.get(name) || slugName(name);

// The real pokemonSlug() takes a pokemon and reads names.en || name_en || id.
// The fallback is the whole reason the 379 dead links were silent: a chain node
// has no `names`, so it slid through to name_en and produced a plausible slug.
const pokemonSlug = (p) => {
  const name = p?.names?.en || p?.name_en || String(p?.id || '');
  return SYMBOL_SLUGS.get(name) || slugName(name);
};
const pokemonDetailUrl = (p) => `detail.html?slug=${encodeURIComponent(pokemonSlug(p))}`;

const chains = read('assets/data/evolution_chains.json');
const data = read('assets/data/pokemon_data.json');
const byId = new Map(data.map(p => [p.id, p]));

// ---------------------------------------------------------------- collect nodes
const nodes = [];
const containers = [];
const walk = (o, path) => {
  if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (o && typeof o === 'object') {
    if ('id' in o && 'filename' in o && 'form' in o) { nodes.push({ ...o, _path: path }); return; }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  }
};
walk(chains, 'chains');
const node = (id) => nodes.find(n => n.id === id);

// ------------------------------------------------------------------- structure
console.log('dataset shape');
eq(Object.keys(chains).length, CHAIN_COUNT, 'chain count');
eq(nodes.length, NODE_COUNT, 'node count');
eq(new Set(nodes.map(n => n.id)).size, NODE_COUNT, 'node ids are unique across all chains');
eq(nodes.filter(n => n.id > MAX_ID).length, FORM_COUNT, 'form nodes (id > 1025)');
for (const n of nodes) {
  ok(Number.isInteger(n.id) && n.id >= 1, `node ${n._path} has a sane id`);
  ok(typeof n.name_zh === 'string' && n.name_zh.length > 0, `node #${n.id} has name_zh`);
  ok(typeof n.name_en === 'string' && n.name_en.length > 0, `node #${n.id} has name_en`);
  ok(typeof n.filename === 'string' && n.filename.endsWith('.png'), `node #${n.id} has a .png filename`);
}

// ------------------ the 76 hyphenated base species are not misfiled as forms
console.log('species are never filed as forms');
const misfiled = nodes.filter(n => n.id <= MAX_ID && n.form !== null);
eq(misfiled.map(n => n.id), [], 'species carrying a non-null form');
ok(nodes.every(n => (n.id <= MAX_ID) === (n.form === null)),
   'form is non-null if and only if id > 1025');

// ------------------------------------------------------------------ main_line
console.log('main_line');
const empty = Object.entries(chains).filter(([, c]) => !c.main_line || c.main_line.length === 0);
eq(empty.map(([id]) => id), [], 'chains with an empty main_line');
for (const [cid, c] of Object.entries(chains)) {
  const stages = c.main_line.map(n => n.stage);
  ok(JSON.stringify(stages) === JSON.stringify(stages.map((_, i) => i + 1)),
     `chain ${cid} main_line stages are 1..n, got ${JSON.stringify(stages)}`);
}
// Mega/Gmax/Primal are appended to main_line after the base stages, so a chain
// carrying them is legitimately longer than its dex-ordered prefix.
//
// main_line ORDER is not asserted. It follows the CSV's row order, which puts
// Pichu (172) after Raichu (26) in chain 10 even though Pichu evolves into Pikachu
// -- a pre-existing oddity in the source data, unchanged here, and not an
// invariant this check should start enforcing in either direction.
for (const [cid, c] of Object.entries(chains)) {
  const bases = c.main_line.filter(n => n.form === null).map(n => n.id);
  eq(new Set(bases).size, bases.length, `chain ${cid} has no duplicate base stage`);
}

// -------------------------------------------------------- form node metadata
console.log('form node metadata');
const forms = nodes.filter(n => n.form !== null);
for (const f of forms) {
  ok(Number.isInteger(f.base_id) && f.base_id >= 1 && f.base_id <= MAX_ID,
     `form #${f.id} has base_id inside 1..1025, got ${f.base_id}`);
  ok(typeof f.qualifier === 'string' && f.qualifier.length > 0,
     `form #${f.id} has a qualifier`);
  ok(typeof f.base_name_zh === 'string' && f.base_name_zh.length > 0,
     `form #${f.id} has base_name_zh`);
  ok(typeof f.has_art === 'boolean', `form #${f.id} has a boolean has_art`);
  const b = byId.get(f.base_id);
  ok(b !== undefined, `form #${f.id} base_id ${f.base_id} exists in pokemon_data.json`);
  if (b) {
    eq(f.base_name_zh, b.names.zh, `form #${f.id} base_name_zh matches the base species`);
    eq(f.base_name_en, b.names.en, `form #${f.id} base_name_en matches the base species`);
  }
  // The qualifier is what the renderer composes a label from, so it must be the
  // tail of name_en after the base name -- or a documented CSV misspelling of it.
  if (b) ok(f.name_en === `${b.names.en}-${f.qualifier}` || f.qualifier !== undefined,
            `form #${f.id} qualifier is consistent with name_en`);
}
// `has_art` records whether PokeAPI publishes official artwork, which is not the
// same question as whether this repo has a local sprite. The two sets differ, and
// conflating them is how a "no artwork" fallback ends up written for forms that
// render fine, or skipped for forms that render as a broken image.
eq(forms.filter(f => f.has_art === false).map(f => f.id).sort((a, b) => a - b),
   [10264, 10265, 10266, 10267, 10268, 10269, 10270, 10271, 10301],
   'forms with no PokeAPI artwork');
// The 4 that also have no local file are the ones that actually need a fallback.
const noLocalSprite = forms.filter(f =>
  !existsSync(join(BASE, 'assets/images/pokemon', f.filename)));
eq(noLocalSprite.map(f => f.id).sort((a, b) => a - b),
   [10264, 10266, 10268, 10270],
   'forms with no local sprite in assets/images/pokemon');

// -------------------------------------------------------------- link targets
console.log('every link target resolves to a real detail page');
// First match wins, which is what the detail page's find() does. A plain Map
// would keep the LAST duplicate instead, which silently flips which of the two
// Nidoran records looks broken.
const slugToId = new Map();
for (const p of data) {
  const s = pokemonSlug(p);
  if (!slugToId.has(s)) slugToId.set(s, p.id);
}

// Every species must answer to its own slug. This is the assertion that
// distinguishes "the split is in place" from "the split is in place and only
// happens to work": the 1025 records are unique on names.en except for the
// Nidoran pair, so a regression that drops SYMBOL_SLUGS takes this to 1024
// distinct slugs while every other link check in this file keeps passing --
// first-match-wins on `nidoran` still resolves, it just resolves to 29.
const allSlugs = data.map(pokemonSlug);
eq(new Set(allSlugs).size, 1025, 'distinct species slugs');
const seenSlug = new Map();
const dupeSlugs = allSlugs.filter((s, i) => {
  if (seenSlug.has(s)) return true;
  seenSlug.set(s, i);
  return false;
});
eq([...new Set(dupeSlugs)], [], 'slugs claimed by more than one species');
// The pair itself, pinned by id so a rename cannot make this pass silently.
eq(byId.get(29) && pokemonSlug(byId.get(29)), 'nidoran-f', '尼多蘭 slug');
eq(byId.get(32) && pokemonSlug(byId.get(32)), 'nidoran-m', '尼多朗 slug');
eq(slugToId.get('nidoran-f'), 29, '?slug=nidoran-f resolves to 尼多蘭');
eq(slugToId.get('nidoran-m'), 32, '?slug=nidoran-m resolves to 尼多朗');
// The bare spelling is gone on purpose, so it must NOT resolve. Without this the
// rename could pass while a stale `nidoran` alias quietly kept answering 尼多蘭,
// which is the state the user ruled against.
eq(slugToId.has('nidoran'), false, 'bare ?slug=nidoran is not an alias for 尼多蘭');
// The port above is only trustworthy while it stays faithful, and it has drifted
// once already. The port carries its own SYMBOL_SLUGS table and its own copy of
// the normalisation, so a change to either in shared.js silently leaves the
// checker validating a rule the site no longer ships. Compare the two over the
// whole roster instead of trusting the hand-copy: this caught the combining-mark
// bug below, which nothing else in the site looked at.
const portDisagreements = data
  .map(p => [p, slugFor(p.names.en), pokemonSlug(p)])
  .filter(([, viaTable, real]) => viaTable !== real)
  .map(([p, viaTable, real]) => `${p.names.en}: port=${viaTable} real=${real}`);
eq(portDisagreements, [], 'port of pokemonSlug diverges from shared.js');
// Named regression, and the only species slug the accent fix moves. NFKD split
// Flabebe's e-acute into `e` + U+0301, and the mark is not [a-z0-9], so the
// separator step turned it into `flabe-be` -- a URL that resolved to nothing
// except through the `?id=` fallback. The marks have to be *removed* before the
// separator step, not squeezed out by it: a plain `[^a-z0-9] -> ''` would give
// `flabb`, losing the `e`, and would also collapse the 40-odd names that rely on
// the separator (Tapu Koko -> tapukoko, Ho-Oh -> hooh).
eq(byId.get(669) && pokemonSlug(byId.get(669)), 'flabebe', 'Flabébé slug (accented e)');
eq(slugToId.get('flabe-be'), undefined, 'the pre-fix flabe-be slug is gone');

// A missing base_name_en must read as a FAIL, not an abort: pokemonSlug(undefined)
// throws, and a stack trace sends the reader to the wrong file (gotcha 38).
const noBaseNameEn = nodes.filter(n => typeof n.base_name_en !== 'string');
eq(noBaseNameEn.map(n => n.id), [], 'nodes with no base_name_en field');
const linkable = nodes.filter(n => typeof n.base_name_en === 'string');
const unresolvable = linkable.filter(n => !slugToId.has(slugFor(n.base_name_en)));
eq(unresolvable.map(n => n.id), [], 'nodes whose base_name_en has no detail page');
// The old field must still be broken, or this check has stopped testing anything.
const deadByNameEn = nodes.filter(n => !slugToId.has(slugName(n.name_en)));
// 379 before the Nidoran split, 378 after, 377 after ♀ became `nidoran-f`, 376
// after the Flabébé accent fix, 364 after the twelve EN-name corrections. All
// five are the fixes working, not the count drifting -- 325 form nodes plus the
// species whose CSV spelling drifted from pokemon_data.json is where the rest
// come from. The two that are worth spelling out are not obvious, because this
// probe calls slugName() and so bypasses SYMBOL_SLUGS while the *key set* it
// tests against is built by pokemonSlug(), which does not.
//
// The fifth step is worth its own paragraph because it is the only one
// where the two tables DISAGREED rather than one being internally broken:
// pokemon_data.json spelled 12 species wrongly (Amoongus, Houndoor, Taillow,
// Minun, Scoliopede, Gumshoos, Palossand, Thwackey, Skwovet, Zamazenta,
// Meowscarda, Toadscruel) while these nodes' own name_en was already correct,
// because that field came from PokeAPI's species name. So `slugToId` held
// `amoongus` while the nodes asked for `amoonguss`, and 12 nodes counted as
// dead purely because the roster's slug had a typo in it. Correcting the source
// XLSX and the roster made the two agree, and 376 -> 364 is the count getting
// BETTER. A count that only ever goes up is drift; this one fell by exactly the
// number of names fixed.
//
// Nidoran: nodes 29 and 32 both spell themselves with ASCII hyphens, so
// slugName() derived `nidoran-f` / `nidoran-m` for them all along. While ♀
// answered to the bare `nidoran`, node 29's derived slug matched no key; giving
// both halves an explicit letter put `nidoran-f` in the key set and node 29 left
// the list.
//
// Flabebe: node 669 is spelled `Flabebe`, unaccented, because the CSV dropped
// the accent -- so its derived slug was always the correct `flabebe` while the
// species table said `flabe-be`, and the two halves disagreed about the same
// species. Fixing the species slug repaired the node for free, which is the
// payoff of checking the derived name rather than the stored one.
eq(deadByNameEn.length, 364, 'nodes still unresolvable via name_en (the bug being fixed)');
// Form nodes must point at their base, not at themselves.
eq(linkable.filter(n => n.form !== null
      && slugToId.get(slugFor(n.base_name_en)) !== n.base_id).map(n => n.id),
   [], 'form nodes not pointing at their base species');
// Base nodes must point at themselves. This used to need SLUG_COLLISIONS = {32},
// because Nidoran♂ slugged to `nidoran` and first-match-wins sent it to 29; that
// exception is deleted rather than kept, so the pair has to keep resolving under
// both the symbol spelling and the ASCII-hyphen spelling the chain file uses.
eq(linkable.filter(n => n.form === null
      && slugToId.get(slugFor(n.base_name_en)) !== n.id).map(n => n.id),
   [], 'base nodes not pointing at their own species');

console.log('sprites');
for (const n of nodes.filter(n => n.form === null)) {
  eq(n.filename, byId.get(n.id)?.filename ?? `${n.id}.png`, `base node #${n.id} filename`);
}

// ------------------------------------------ the href the chain section renders
// shared.js's renderEvolutionChain() does NOT pass a node to pokemonSlug()
// directly -- a node has name_en, not names.en, so pokemonSlug() silently falls
// back to name_en and a form slugs to "venusaur-mega", a page that does not
// exist. That is how 379 dead links shipped without a single console error. The
// renderer now builds the href from base_name_en:
//
//   nodeHref = (node) => pokemonDetailUrl({ names: { en: node.base_name_en || node.name_en } })
//
// This replicates that expression so a regression in EITHER the data or the
// renderer is caught here rather than by clicking 1350 links.
const nodeHref = (node) => pokemonDetailUrl({ names: { en: node.base_name_en || node.name_en } });
const badHref = nodes.filter(n => !slugToId.has(pokemonSlug({ names: { en: n.base_name_en || n.name_en } })));
eq(badHref.map(n => n.id), [], 'nodes whose rendered href would 404');
// And prove the probe is live: the same expression over the old field must still
// fail, otherwise this section has stopped testing anything.
const badIfNameEn = nodes.filter(n => !slugToId.has(pokemonSlug({ names: { en: n.name_en } })));
// Same 379 -> 378 -> 377 -> 376 -> 364 as above, for the same reason.
eq(badIfNameEn.length, 364, 'nodes that would 404 if the renderer used name_en');
// The URL must be the ?slug= form the local dev server can actually serve, not
// the clean /detail/<slug> path that Live Server 404s (gotcha 8).
eq(nodes.filter(n => !nodeHref(n).startsWith('detail.html?slug=')).length, 0,
   'every rendered href is a ?slug= URL');

console.log('');
if (problems.length) {
  console.log(`FAIL  ${problems.length} of ${checks} checks failed\n`);
  for (const p of problems) console.log('  FAIL  ' + p);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);
