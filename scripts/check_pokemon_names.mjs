/**
 * Species-name regression test
 *
 *   node scripts/check_pokemon_names.mjs
 *
 * Guards the English and Traditional Chinese names in pokemon_data.json and the
 * three generated files that copy them. A misspelled English name in the source
 * XLSX propagates into the slug — the site's primary key for every cross-page
 * link — so a typo makes a detail page unreachable.
 *
 * It pins twelve names rather than comparing all 1,025 against PokeAPI. Measured
 * across every species and all nine languages, 193 names disagree with PokeAPI,
 * and many of those are PokeAPI being wrong: tw.portal-pokemon.com confirms our
 * #956 and #983, PokeAPI's German column is shifted around #353, and its zh_HK
 * uses mainland orthography. Twelve pins plus the cross-file agreement below
 * cover the class of defect that ships a broken slug.
 *
 * check_evolution_chains.mjs already asserts `base_name_en === names.en`, so
 * this file does not restate it (§3.B1 — one check in the place that owns it).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pokemonSlug } from '../assets/js/shared.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readData = name => JSON.parse(readFileSync(join(ROOT, 'assets/data', name), 'utf8'));

const POKEMON = readData('pokemon_data.json');
const GRAPH = readData('graph_data.json');
const ABILITY_SPECIES = readData('ability_species.json');

/**
 * The twelve corrections, by id. Each was a letter transposition, a dropped
 * letter or a wrong pair of letters in the `en` column of the source XLSX.
 * Every one changes the slug, which is why they are pinned by ID and not by
 * position.
 */
const CORRECTED_EN = {
  228: 'Houndour',
  276: 'Taillow',
  312: 'Minun',
  545: 'Scolipede',
  591: 'Amoonguss',
  735: 'Gumshoos',
  770: 'Palossand',
  811: 'Thwackey',
  819: 'Skwovet',
  889: 'Zamazenta',
  908: 'Meowscarada',
  949: 'Toedscruel'
};

/**
 * The two Traditional Chinese names that must NOT be "corrected" toward
 * PokeAPI. PokeAPI returns 200 and a plausible string, so a future pass that
 * treats it as authoritative would break both silently. Verified against
 * tw.portal-pokemon.com; PokeAPI ships 超能艷鴕 and 仆刀將軍.
 */
const PINNED_ZH_WHERE_POKEAPI_DISAGREES = {
  956: '超能豔鴕',
  983: '仆斬將軍'
};

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, eq } = C;

const notes = [];

const byId = new Map(POKEMON.map(p => [p.id, p]));

/* ===== the roster's own shape ===== */

eq(POKEMON.length, 1025, 'pokemon_data.json should carry 1025 species');
eq(
  POKEMON.map(p => p.id).filter((id, i) => id !== i + 1),
  [],
  'species ids should be 1..1025 with no gaps'
);

const enNames = POKEMON.map(p => p.names.en);
const duplicates = enNames.filter((n, i) => enNames.indexOf(n) !== i);
eq([...new Set(duplicates)], [], 'every English name should be distinct');
ok(
  enNames.every(n => typeof n === 'string' && n.trim().length > 0),
  'every species needs a non-empty English name'
);

/** Slugs are the site's primary key for cross-page links, so two species
 *  answering to one slug makes one of them unreachable. */
const slugs = POKEMON.map(p => pokemonSlug(p));
eq([...new Set(POKEMON.filter((p, i) => slugs.indexOf(slugs[i]) !== i).map(p => p.id))], [],
  'every species should answer to a distinct slug');

/* ===== the twelve corrections ===== */

for (const [id, correct] of Object.entries(CORRECTED_EN)) {
  const p = byId.get(Number(id));
  ok(Boolean(p), `#${id} should exist in the roster`);
  if (!p) continue;
  eq(p.names.en, correct, `#${id} English name`);
  // The Spanish and Italian columns are verbatim copies for every one of these
  // (1005 of 1025 species have no real translation there), so they track `en`.
  eq(p.names.es, correct, `#${id} Spanish column should track the corrected English`);
  eq(p.names.it, correct, `#${id} Italian column should track the corrected English`);
}

/* ===== the two zh names PokeAPI gets wrong ===== */

for (const [id, correct] of Object.entries(PINNED_ZH_WHERE_POKEAPI_DISAGREES)) {
  const p = byId.get(Number(id));
  ok(Boolean(p), `#${id} should exist in the roster`);
  if (p) eq(p.names.zh, correct, `#${id} Traditional Chinese name — PokeAPI disagrees and is wrong`);
}

/* ===== the generated files that copy these names ===== */

const graphNodes = (Array.isArray(GRAPH) ? GRAPH : GRAPH.nodes || []).filter(n => n && n.baseId === undefined);
const graphBase = graphNodes.filter(n => !n.form);

for (const [id, correct] of Object.entries(CORRECTED_EN)) {
  const node = graphBase.find(n => n.id === Number(id));
  ok(Boolean(node), `#${id} should have a base node in graph_data.json`);
  if (!node) continue;
  eq(node.name_en, correct, `#${id} graph_data.json name_en`);
  eq(node.slug, pokemonSlug({ names: { en: correct } }), `#${id} graph_data.json slug`);
}

// Every roster species must be in the ability holder index under the roster's own
// spelling. holderUrl() runs that string through pokemonSlug(), so a stale nameEn
// is a dead link — and ability_species.json is written COMPACT, which is how a
// first pass of this fix missed two of them entirely.
const staleHolders = [];
for (const [slug, rows] of Object.entries(ABILITY_SPECIES)) {
  for (const row of rows) {
    if (!row.inRoster) continue;
    const source = byId.get(row.baseId);
    if (!source) continue;
    if (row.nameEn !== source.names.en) staleHolders.push(`${slug}/${row.baseId}`);
    if (row.nameZh !== source.names.zh) staleHolders.push(`${slug}/${row.baseId} (zh)`);
  }
}
eq(staleHolders, [], 'ability_species.json holder names should match pokemon_data.json');

notes.push(`12 corrected EN names pinned; ${POKEMON.length} species; ${Object.keys(ABILITY_SPECIES).length} abilities cross-checked`);

/* ===== report ===== */

for (const note of notes) console.log(`  note  ${note}`);

if (C.failures.length === 0) {
  console.log(`PASS ${C.checks} checks`);
} else {
  console.error(`FAIL ${C.failures.length} of ${C.checks} checks`);
  process.exit(1);
}