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
const pokemonSlug = (name) => name
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

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

// ------------------------------------------- the 76 misfiled species (C0)
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
  const s = pokemonSlug(p.names.en);
  if (!slugToId.has(s)) slugToId.set(s, p.id);
}
// A missing base_name_en must read as a FAIL, not an abort: pokemonSlug(undefined)
// throws, and a stack trace sends the reader to the wrong file (gotcha 38).
const noBaseNameEn = nodes.filter(n => typeof n.base_name_en !== 'string');
eq(noBaseNameEn.map(n => n.id), [], 'nodes with no base_name_en field');
const linkable = nodes.filter(n => typeof n.base_name_en === 'string');
const unresolvable = linkable.filter(n => !slugToId.has(pokemonSlug(n.base_name_en)));
eq(unresolvable.map(n => n.id), [], 'nodes whose base_name_en has no detail page');
// The old field must still be broken, or this check has stopped testing anything.
const deadByNameEn = nodes.filter(n => !slugToId.has(pokemonSlug(n.name_en)));
eq(deadByNameEn.length, 379, 'nodes still unresolvable via name_en (the bug being fixed)');
// Form nodes must point at their base, not at themselves.
eq(linkable.filter(n => n.form !== null
      && slugToId.get(pokemonSlug(n.base_name_en)) !== n.base_id).map(n => n.id),
   [], 'form nodes not pointing at their base species');
// Base nodes must point at themselves. Nidoran♂ (32) is the one exception and is
// a known pre-existing collision, not a regression: pokemonSlug() strips the ♂
// symbol so both Nidoran records slug to `nidoran`, and find() returns 29 first,
// so 32's link lands on Nidoran♀. See gotcha 30 -- Nidoran♂ is reachable only
// via detail.html?id=32.
const SLUG_COLLISIONS = new Set([32]);
eq(linkable.filter(n => n.form === null
      && !SLUG_COLLISIONS.has(n.id)
      && slugToId.get(pokemonSlug(n.base_name_en)) !== n.id).map(n => n.id),
   [], 'base nodes not pointing at their own species');

console.log('sprites');
for (const n of nodes.filter(n => n.form === null)) {
  eq(n.filename, byId.get(n.id)?.filename ?? `${n.id}.png`, `base node #${n.id} filename`);
}

console.log('');
if (problems.length) {
  console.log(`FAIL  ${problems.length} of ${checks} checks failed\n`);
  for (const p of problems) console.log('  FAIL  ' + p);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);
