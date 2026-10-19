/**
 * Species-name regression test
 *
 *   node scripts/check_pokemon_names.mjs
 *
 * Guards the English and Traditional Chinese names in pokemon_data.json, and
 * the three generated files that copy them. It exists because of what happened
 * on 2026-10-19: twelve species carried a misspelled English name in
 * `data-sources/International List of Pokémon Names.xlsx`, and the typo
 * propagated into the slug — which is the site's primary key for every
 * cross-page link. `detail.html?slug=amoongus` was a dead link and
 * `detail.html?slug=amoonguss` did not exist, for a species the user had to
 * tell us about.
 *
 * **WHY NOT A COMPARISON AGAINST POKEAPI.** A whole-corpus name comparison is
 * the obvious guard and it is the wrong one here, which is why this file pins
 * twelve names instead of 1025. Measured across all 1025 species and all nine
 * languages, 193 names disagree with PokeAPI — and a good share of the
 * disagreements are PokeAPI being wrong:
 *
 *   #956 超能豔鴕 / #983 仆斬將軍   PokeAPI ships 艷 and 刀; tw.portal-pokemon.com
 *                                  — the authority fix_pokemon_names.py scrapes —
 *                                  confirms ours, so a "sync to PokeAPI" pass
 *                                  would break two correct names.
 *   the German column               ours is shifted around #353 AND PokeAPI's is
 *                                  shifted the other way (#355 carries Zwirrlicht)
 *   the Korean column               PokeAPI gives Arceus the Korean name of Victini
 *   zh_HK                           ours uses HK orthography (火爆猴, 腭) where
 *                                  PokeAPI uses the mainland names (火暴猴, 颚)
 *   ja                              mixed legacy kana (ヂィ vs ディ) and real errors
 *
 * Pinning 1025 strings would be 1025 lines of duplication that goes stale, which
 * is the failure §3.J warns about. Twelve pins plus the cross-file agreement
 * below covers the class that actually broke.
 *
 * What it does NOT duplicate: check_evolution_chains.mjs already asserts
 * `base_name_en === names.en`, so this file does not assert it a second time
 * (§3.B1's rule — one check in the place that owns it, not two that can
 * disagree).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pokemonSlug } from '../assets/js/shared.js';

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
 * PokeAPI. This pair is the most valuable thing in the file: a future pass that
 * treats PokeAPI as authoritative over this project's own zh data would break
 * both, silently, because PokeAPI returns 200 and a plausible string.
 *
 * Verified against https://tw.portal-pokemon.com/play/pokedex/{id}/ on the day
 * the correction landed. PokeAPI ships 超能艷鴕 and 仆刀將軍.
 */
const PINNED_ZH_WHERE_POKEAPI_DISAGREES = {
  956: '超能豔鴕',
  983: '仆斬將軍'
};

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

if (failures === 0) {
  console.log(`PASS ${checks} checks`);
} else {
  console.error(`FAIL ${failures} of ${checks} checks`);
  process.exit(1);
}