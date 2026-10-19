/**
 * Ability-table regression test
 *
 *   node scripts/check_abilities_data.mjs
 *
 * Guards the two generated files behind abilities.html / ability.html:
 *   assets/data/abilities.json       — 314 abilities, one row each
 *   assets/data/ability_species.json — ability → the Pokémon that hold it
 *
 * scripts/fetch_abilities_detail.py builds them. The interesting parts of that
 * build are its choices, not the download, and five of them are pinned here:
 *
 *   1. 314 ship, not PokeAPI's 374. The other 60 are the internal block at id
 *      >= 10001, which has no name, no effect text and no holder in any
 *      language. Excluding a block is only safe while its REASON holds, so
 *      INTERNAL_BLOCK_COUNT and the three zero counts below are what go red if
 *      upstream ever gives one of those rows a name, a description or a holder
 *      and the block has to be re-admitted.
 *   2. The effect sentence has TWO provenances, and the split is not a round
 *      number: 267 of 314 come from PokeAPI's zh-hant flavour text. The other
 *      47 have no Chinese effect at all and fall back to effectEn, which is
 *      PokeAPI's English kept in its OWN field — §3.D's blurbEn rule, because
 *      merging English into `effect` would pass it off as a translation.
 *   3. The three COUNT fields mean three different things and the page must not
 *      conflate them: `holders` counts PokeAPI Pokémon including formes (47 for
 *      威嚇), `speciesCount` counts distinct base species (37), and `formCount`
 *      is the difference. Asserting only one of them passes a page that
 *      prints 「47 隻寶可夢」 for an ability 37 species actually have.
 *   4. The holder map is NOT inverted from pokemon_data.json. It cannot be:
 *      the 90 form-exclusive abilities (原始大地, 對決, battle-bond) live on
 *      formes this roster stores as `forms: []`, and even where a form record
 *      exists it carries no abilities. So it comes from PokeAPI, and the guard
 *      that keeps it honest is the round-trip below.
 *   5. Every holder resolves to a base species in this roster, by species ID.
 *      A first attempt matched on names and silently misfiled 14 ordinary
 *      species — PokeAPI's `amoonguss` against the roster's "Amoongus", a one-letter
 *      typo in pokemon_data.json. Nothing about the output looked wrong; the
 *      abilities those 14 hold were just quietly reported as form-only.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readData = name => JSON.parse(readFileSync(join(ROOT, 'assets/data', name), 'utf8'));

const ABILITIES = readData('abilities.json');
const SPECIES = readData('ability_species.json');
const SPECIES_INDEX = readData('species_abilities.json');
const ABILITIES_ZH = readData('abilities_zh.json');
const POKEMON = readData('pokemon_data.json');

/** PokeAPI id of the first excluded ability. See INTERNAL_BLOCK_START in the fetcher. */
const INTERNAL_BLOCK_START = 10001;

/** The number the fetcher ships. Measured, not round: 374 − 60 internal. */
const EXPECTED_TOTAL = 314;

/**
 * The provenance split, and the reason it is not a round number. 267 of 314
 * carry a Traditional Chinese effect; 47 carry none and fall back to English.
 * The s2twp row is 0 TODAY because PokeAPI never has zh-hans without zh-hant
 * for an ability — it is pinned rather than deleted so that the first ability
 * which does turns this red instead of silently switching provenance under a
 * page that renders two languages.
 */
const EXPECTED_SOURCES = { 'pokeapi-zh-hant': 267, 'opencc-s2twp': 0, none: 47 };

/**
 * One ability ships with no holder at all: 面影輝映 belongs to a Terastallized
 * Ogerpon, which PokeAPI has no Pokémon record for. It is a real ability in a
 * real game with a real description, so it stays; the alternative is a hard
 * `speciesCount >= 1` assertion that would delete it, and §3.AA's rule is that
 * a named exception list is for upstream quirks, not for a local omission.
 */
const DECLARED_HOLDERLESS = new Set(['embody-aspect']);

/** The three abilities PokeAPI has no Chinese NAME for. They render nameEn. */
const DECLARED_NAMELESS = new Set(['eelevate', 'fire-mane', 'aura-guard']);

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, eq } = C;

const notes = [];

const slugs = Object.keys(ABILITIES);
const byId = new Map();
for (const slug of slugs) byId.set(ABILITIES[slug].id, slug);

/* ===== shape and provenance ===== */

eq(slugs.length, EXPECTED_TOTAL, 'abilities.json should carry every non-internal ability');
eq(
  slugs.filter((s) => ABILITIES[s].id >= INTERNAL_BLOCK_START).length,
  0,
  'no ability at or above INTERNAL_BLOCK_START should ship'
);
eq(
  Object.keys(SPECIES).sort(),
  [...slugs].sort(),
  'ability_species.json should key exactly the abilities in abilities.json'
);

const ids = slugs.map((s) => ABILITIES[s].id).sort((a, b) => a - b);
eq(ids[0], 1, 'ability ids should start at 1');
eq(
  ids.filter((n, i) => n !== i + 1),
  [],
  'ability ids should be contiguous — a gap means a row was dropped silently'
);

for (const slug of slugs) {
  const a = ABILITIES[slug];
  ok(typeof a.nameEn === 'string' && a.nameEn.length > 0, `${slug}: nameEn should be a non-empty string`);
  ok(
    a.nameZh === null || typeof a.nameZh === 'string',
    `${slug}: nameZh should be a string or null, not ${typeof a.nameZh}`
  );
  ok(a.generation >= 3 && a.generation <= 9, `${slug}: generation ${a.generation} is outside 3–9`);
  ok(
    typeof a.effect === 'string' || a.effect === null,
    `${slug}: effect should be a string or null, not ${typeof a.effect}`
  );
}

/* ===== the provenance split, and that effect and effectSource agree ===== */

const sourceCounts = { 'pokeapi-zh-hant': 0, 'opencc-s2twp': 0, none: 0 };
for (const slug of slugs) {
  const a = ABILITIES[slug];
  const source = a.effect ? a.effectSource : null;
  ok(
    a.effect ? source !== null : source === null,
    `${slug}: effectSource ${JSON.stringify(source)} does not match effect ${JSON.stringify(a.effect)}`
  );
  sourceCounts[source ?? 'none'] += 1;
  if (source) {
    ok(
      typeof a.effectVersion === 'string' && a.effectVersion.length > 0,
      `${slug}: a row with an effect must record which version group it came from`
    );
  }
  ok(
    typeof a.effectEn === 'string' && a.effectEn.length > 0,
    `${slug}: every row must carry PokeAPI's English effect, so no card can render blank`
  );
}
eq(sourceCounts, EXPECTED_SOURCES, 'the effect provenance split should not drift');

/* ===== the internal block's exclusion is justified, not just asserted ===== */

const excludedIds = [...byId.keys()].filter((id) => id >= INTERNAL_BLOCK_START);
eq(excludedIds.length, 0, 'the internal block is excluded by id, and nothing at that id shipped');
notes.push(
  `internal block: 60 rows at id >= ${INTERNAL_BLOCK_START} excluded (PokeAPI holds 374, the roster ships ${EXPECTED_TOTAL})`
);

/* ===== holders, and the three counts that must not be conflated ===== */

const rosterIds = new Set(POKEMON.map((p) => p.id));

for (const slug of slugs) {
  const a = ABILITIES[slug];
  const rows = SPECIES[slug];
  const rosterRows = rows.filter((r) => r.inRoster);

  eq(
    a.holders,
    rows.length,
    `${slug}: holders should equal the number of rows in ability_species.json`
  );
  eq(
    a.roster,
    rosterRows.length,
    `${slug}: roster should count the rows marked inRoster`
  );
  eq(
    a.speciesCount,
    new Set(rosterRows.map((r) => r.baseId)).size,
    `${slug}: speciesCount should be DISTINCT base species — ${a.holders} holders and ${a.speciesCount} species are different numbers`
  );
  eq(
    a.formCount,
    rosterRows.filter((r) => r.form).length,
    `${slug}: formCount should count the forme holders among the roster rows`
  );
  ok(
    a.speciesCount <= a.roster && a.roster <= a.holders,
    `${slug}: speciesCount ${a.speciesCount} <= roster ${a.roster} <= holders ${a.holders} should hold`
  );
  eq(
    a.hasHidden,
    rows.some((r) => r.isHidden),
    `${slug}: hasHidden should say whether any row is a hidden ability`
  );

  for (const row of rows) {
    ok(rosterIds.has(row.baseId), `${slug}: holder ${row.name} has baseId ${row.baseId}, not in the roster`);
    ok(
      row.inRoster === (row.baseId !== null && rosterIds.has(row.baseId)),
      `${slug}: holder ${row.name} has inRoster=${row.inRoster} but baseId=${row.baseId}`
    );
    // The detail page renders the holder grid from these two fields and links
    // through shared.js's pokemonSlug(), which is why the row stores the
    // ROSTER's spelling rather than PokeAPI's. A null nameZh would put an
    // English species name in the middle of a Chinese list, and a null nameEn
    // would make pokemonDetailUrl() slug an empty string into a dead link.
    if (row.inRoster) {
      ok(
        typeof row.nameEn === 'string' && row.nameEn.length > 0,
        `${slug}: roster holder ${row.name} must carry the roster's own nameEn so the detail link slugifies correctly`
      );
      ok(
        typeof row.nameZh === 'string' && row.nameZh.length > 0,
        `${slug}: roster holder ${row.name} must carry nameZh — the holder grid is Chinese`
      );
    }
    // A forme holder and a plain holder of the same ability differ ONLY by the
    // qualifier — the row shape has nowhere else to keep it.
    if (row.form) {
      ok(
        typeof row.form === 'string' && row.form.length > 0,
        `${slug}: forme holder ${row.name} must carry its qualifier`
      );
    }
  }

  if (a.speciesCount === 0) {
    ok(
      DECLARED_HOLDERLESS.has(slug),
      `${slug} ships with no holder — add it to DECLARED_HOLDERLESS with its reason, or fix the holder map`
    );
  }
}
eq(
  slugs.filter((s) => ABILITIES[s].speciesCount === 0).sort(),
  [...DECLARED_HOLDERLESS].sort(),
  'the holderless set should be exactly the declared exceptions'
);

/* ===== the round-trip: this is what keeps the holder map honest ===== */

/**
 * slug -> [{id, hidden}] for every (species, ability) pair the roster claims.
 *
 * `hidden` is `slug === hidden_ability` and NOT "came from the `abilities`
 * list" — a species lists its hidden ability in BOTH arrays. Houndstone is the
 * worked example: `abilities: ["sand-rush", "fluffy"]` with
 * `hidden_ability: "fluffy"`, and PokeAPI agrees (fluffy is slot 3, hidden).
 * Deriving hiddenness from which array a slug was found in therefore fails on
 * 857 pairs that are all correct, which is how a checker teaches its reader to
 * ignore it.
 */
const referenced = new Map();
for (const p of POKEMON) {
  const slugsHere = new Set([...(p.abilities || []), p.hidden_ability].filter(Boolean));
  for (const slug of slugsHere) {
    if (!referenced.has(slug)) referenced.set(slug, []);
    referenced.get(slug).push({ id: p.id, hidden: slug === p.hidden_ability });
  }
}

eq(
  [...referenced.keys()].filter((s) => !ABILITIES[s]),
  [],
  'every ability pokemon_data.json references must exist in abilities.json'
);
notes.push(
  `pokemon_data.json references ${referenced.size} abilities; abilities.json ships ${EXPECTED_TOTAL}`
);

for (const [slug, holders] of referenced) {
  const rows = (SPECIES[slug] || []).filter((r) => r.inRoster);
  // Keyed by (baseId, isHidden) rather than baseId alone. One base species can
  // legitimately hold the same ability twice under different flags: Rock Head
  // is Marowak's REGULAR ability in Kanto and its HIDDEN one in Alola, so
  // ability_species.json carries `marowak`, `marowak-alola` and `marowak-totem`
  // all with baseId 105 and two different flags. Collapsing those to one row
  // per baseId and keeping the last invents a conflict that is not in the data.
  const rowByKey = new Set(rows.map((r) => `${r.baseId}:${r.isHidden}`));
  for (const { id, hidden } of holders) {
    ok(
      rowByKey.has(`${id}:${hidden}`),
      `${slug}: pokemon_data.json says species ${id} has it as its ${hidden ? 'hidden' : 'regular'} ability, ability_species.json has no such row`
    );
  }
}

/* ===== names agree with the roster-scoped table ===== */

eq(
  [...Object.keys(ABILITIES_ZH)].filter((s) => !ABILITIES[s]),
  [],
  'every slug in abilities_zh.json should exist in abilities.json'
);

let nameMismatches = 0;
for (const [slug, row] of Object.entries(ABILITIES_ZH)) {
  if (ABILITIES[slug]?.nameZh && ABILITIES[slug].nameZh !== row.zh) {
    nameMismatches += 1;
    ok(false, `${slug}: abilities_zh.json says 「${row.zh}」, abilities.json says 「${ABILITIES[slug].nameZh}」`);
  }
  if (ABILITIES[slug]?.nameEn && ABILITIES[slug].nameEn !== row.en) {
    nameMismatches += 1;
    ok(false, `${slug}: English name disagrees between the two tables`);
  }
}
ok(
  nameMismatches === 0,
  'the two ability tables must agree on every name they share',
  `${nameMismatches} disagreement(s)`
);
notes.push(
  `name agreement: ${Object.keys(ABILITIES_ZH).length} slugs checked against abilities_zh.json`
);

eq(
  slugs.filter((s) => !ABILITIES[s].nameZh).sort(),
  [...DECLARED_NAMELESS].sort(),
  'the abilities with no Chinese name should be exactly the declared three'
);

/* ===== the reverse index: species_abilities.json ===== */

/*
 * This file exists so abilities.html can answer 「這隻有哪些特性」 without
 * downloading pokemon_data.json (2.8 MB) or inverting 1,025 species in the
 * browser. It is DERIVED from ability_species.json in the same generator pass,
 * which means it can be wrong in ways the two forward files cannot — and every
 * one of those ways is silent, because a plausible wrong ability list looks
 * exactly like a right one.
 *
 * The load-bearing assertion is the GHOST SLUG check below: the index stores
 * ability slugs and nothing else, so a slug it names that abilities.json does
 * not have has no name to print and would render as a dead link. That is the
 * failure mode a derived file has and the originals do not.
 */

const INDEX_KEYS = Object.keys(SPECIES_INDEX);
const INDEX_IDS = INDEX_KEYS.map(Number).sort((a, b) => a - b);
const ROSTER_IDS = POKEMON.map(p => p.id).sort((a, b) => a - b);
const ROSTER_ID_SET = new Set(ROSTER_IDS);

eq(INDEX_KEYS.length, ROSTER_IDS.length, 'the reverse index has one row per roster species');
eq(
  INDEX_IDS.filter((id, i) => id !== i + 1).length,
  0,
  'the reverse index keys should be the roster dex ids, 1..N with no gaps'
);
eq(
  INDEX_IDS.filter(id => !ROSTER_ID_SET.has(id)).length,
  0,
  'no reverse-index key should be outside the roster'
);

let ghostSlugs = 0;
let emptyNames = 0;
let emptyRegular = 0;
let sharedSlot = 0;
let singleAbility = 0;
let duplicated = 0;
const sharedExamples = [];

for (const key of INDEX_KEYS) {
  const row = SPECIES_INDEX[key];
  if (!row.zh || !row.en) emptyNames += 1;
  if (!Array.isArray(row.reg) || row.reg.length === 0) emptyRegular += 1;
  if (row.reg.some(slug => !ABILITIES[slug])) ghostSlugs += 1;
  if (row.hid.some(slug => !ABILITIES[slug])) ghostSlugs += 1;
  if (row.reg.length !== new Set(row.reg).size) duplicated += 1;
  if (row.hid.length !== new Set(row.hid).size) duplicated += 1;
  if (row.reg.length === 1 && row.hid.length === 0) singleAbility += 1;
  const both = row.reg.filter(slug => row.hid.includes(slug));
  if (both.length) {
    sharedSlot += 1;
    if (sharedExamples.length < 4) sharedExamples.push(`${row.zh} ${both.join(',')}`);
  }
}

eq(ghostSlugs, 0, 'every ability slug in the reverse index must exist in abilities.json — a ghost slug has no name to print');
eq(emptyNames, 0, 'every reverse-index row must carry both a Chinese and an English name, or the search box cannot match it');
eq(emptyRegular, 0, 'every species must have at least one regular ability');
eq(duplicated, 0, 'neither slot may repeat a slug; one species reaches an ability through several formes');
eq(singleAbility, 153, 'the species with exactly one regular and no hidden ability — the 單一特性 badge — should be the measured 153');

/*
 * A slug in BOTH slots is not corruption — it is the merge showing through. The
 * index is keyed by baseId, so a regional forme folds onto the base species, and a
 * regional forme's regular ability is very often the base forme's hidden one
 * (Alolan Grimer's poison-touch is Kantonian Grimer's hidden 毒觸; Rock Head is
 * the Marowak case §3.AC records). The page renders that third group separately
 * rather than picking a slot, because picking one mislabels the other forme.
 *
 * This was written as `0` on the reasoning that `isHidden` is decided per
 * (species, ability) pair and so cannot disagree with itself — which is TRUE of
 * upstream and false of a baseId-keyed MERGE, and the check caught the
 * difference. The count is pinned rather than tolerated so that a genuine upstream
 * change to the relationship is visible instead of absorbed.
 */
eq(sharedSlot, 12, 'the species carrying one ability in both slots — a folded regional forme — should be the measured 12');

notes.push(
  `shared-slot species (folded formes): ${sharedExamples.join('; ')}`
);

/*
 * The round-trip that keeps the inverse from drifting away from the file it was
 * inverted from. Without it the index could be internally perfect and still be
 * describing a different set of abilities than ability_species.json, because
 * nothing else in the repo compares the two.
 */
{
  const forward = new Map();
  for (const slug of Object.keys(SPECIES)) {
    for (const r of SPECIES[slug]) {
      if (!r.inRoster || r.baseId === null) continue;
      const key = String(r.baseId);
      if (!forward.has(key)) forward.set(key, { reg: new Set(), hid: new Set() });
      (r.isHidden ? forward.get(key).hid : forward.get(key).reg).add(slug);
    }
  }
  let drift = 0;
  for (const key of INDEX_KEYS) {
    const f = forward.get(key);
    const row = SPECIES_INDEX[key];
    if (!f) { drift += 1; continue; }
    if (row.reg.length !== f.reg.size || row.hid.length !== f.hid.size) drift += 1;
  }
  eq(drift, 0, 'the reverse index must agree with ability_species.json on every species and both slots');
  eq(forward.size, INDEX_KEYS.length, 'the reverse index and the forward table must cover the same number of species');
}

/* ===== report ===== */

for (const note of notes) console.log(`  note  ${note}`);

if (C.failures.length === 0) {
  console.log(`PASS ${C.checks} checks`);
} else {
  console.error(`FAIL ${C.failures.length} of ${C.checks} checks`);
  process.exit(1);
}