/**
 * Ability data access for abilities.html and ability.html.
 *
 * Why a module rather than two copies of a fetch: §3.P's lesson is that logic
 * living inside a `<script type="module">` block on the page cannot be imported,
 * so the only thing a checker could assert about it was its SOURCE. Everything
 * here is pure — it takes the two parsed tables and returns data — so
 * check_abilities_page.mjs runs filterAbilities() over the real 314 rows and
 * compares, rather than reading a regex and hoping.
 *
 * Three generated tables back it:
 *   assets/data/abilities.json       — slug → {nameZh, effect, generation, …}
 *   assets/data/ability_species.json — slug → the Pokémon that hold it
 *   assets/data/species_abilities.json — dex id → that Pokémon's ability slugs
 *
 * The first two are keyed by ability and the third is their inverse, so the two
 * pages answer opposite directions from one pair of sources. All three are
 * produced by scripts/fetch_abilities_detail.py in ONE pass and policed by
 * scripts/check_abilities_data.mjs. This module reads them and decides nothing
 * about their shape beyond what that checker already enforces.
 */

import { pokemonDetailUrl } from './shared.js';
import { spriteUrl } from './color-palette.js';
import { hasSv, svUrl } from './sv-index.js';

const jsonCache = new Map();

async function loadJson(name) {
  if (jsonCache.has(name)) return jsonCache.get(name);
  const pending = fetch(`assets/data/${name}`).then(response => {
    if (!response.ok) {
      throw new Error(`${name} -> HTTP ${response.status}`);
    }
    return response.json();
  });
  jsonCache.set(name, pending);
  return pending;
}

/**
 * The name to print. `nameZh` is null for three abilities PokeAPI has not
 * localised (eelevate, fire-mane, aura-guard), and the alternative to falling
 * back to the English name is printing the slug — which is what a page in
 * Chinese looks like when it has no data, and §3.AB's rule is that a plausible
 * wrong value is worse than an honest one. `isFallback()` tells the page to
 * mark those three rather than let them read as if they were localised.
 */
export function abilityName(ability) {
  return ability.nameZh || ability.nameEn || ability.id;
}

export function abilityIsFallbackName(ability) {
  return !ability.nameZh;
}

/** The Traditional effect, or null. Never the English one — see abilityEffectEn. */
export function abilityEffect(ability) {
  return ability.effect || null;
}

/**
 * PokeAPI's English effect, kept separate and never merged into `effect`.
 *
 * 47 of the 314 abilities have no Chinese effect text at all, and their cards
 * would otherwise be blank rectangles on a page whose whole subject is the
 * description. §3.D's rule for the same situation on types.html is that English
 * upstream lives in its own field (`blurbEn`, `entriesEn`) and renders inside a
 * block labelled as upstream English — never inside the zh body, and never
 * passed off as our translation.
 */
export function abilityEffectEn(ability) {
  return ability.effectEn || null;
}

/** 「第 3 世代」 for the badge. Abilities began in Gen 3, so nothing is below it. */
export function abilityGenerationText(gen) {
  return `第 ${gen} 世代`;
}

/** `ability.html?ability=intimidate` — built here so both pages agree on it. */
export function abilityUrl(ability) {
  return `ability.html?ability=${encodeURIComponent(typeof ability === 'string' ? ability : ability.slug)}`;
}

/** Prepare a row for the table: flattens the slug-keyed table into an array. */
export function prepareAbilities(abilities) {
  return Object.keys(abilities)
    .sort((a, b) => abilities[a].id - abilities[b].id)
    .map(slug => ({ ...abilities[slug], slug }));
}

/**
 * The list filter. Search matches the Chinese name, the English name and the
 * id, and matches on SUBSTRING — a reader typing 「威嚇」 should find 威嚇, and
 * one typing 「intim」 should find Intimidate, which a prefix matcher on the
 * English name would not do.
 */
export function filterAbilities(rows, state) {
  const q = (state.q || '').trim().toLowerCase();
  return rows.filter(row => {
    if (state.gen != null && row.generation !== state.gen) return false;
    if (state.hidden && !row.hasHidden) return false;
    if (state.form && !row.formCount) return false;
    if (!q) return true;
    return (
      abilityName(row).toLowerCase().includes(q) ||
      String(row.nameEn || '').toLowerCase().includes(q) ||
      String(row.id) === q ||
      String(row.id).padStart(3, '0') === q
    );
  });
}

/**
 * Distinct base species that hold the ability, split by hidden flag.
 *
 * A base species appears under BOTH flags when a forme carries it as a hidden
 * ability while the base has it as a regular one — Rock Head is Kantonian
 * Marowak's regular ability and Alolan Marowak's hidden one. Returning the raw
 * rows would therefore show 臭泥 twice with no explanation, so the forme rows
 * are folded into a single entry per base species that carries the badge when
 * either of its formes has it hidden. `forms` keeps the names so the page can
 * say WHY rather than just showing a badge.
 */
export function splitAbilityHolders(rows) {
  const byBase = new Map();
  for (const row of rows || []) {
    if (!row.baseId) continue;
    const entry = byBase.get(row.baseId) || {
      baseId: row.baseId,
      name: row.name,
      nameEn: row.nameEn,
      nameZh: row.nameZh,
      isHidden: false,
      forms: []
    };
    if (row.isHidden) entry.isHidden = true;
    if (row.form) entry.forms.push({ form: row.form, name: row.name });
    else entry.name = row.name;
    byBase.set(row.baseId, entry);
  }
  const all = [...byBase.values()].sort((a, b) => a.baseId - b.baseId);
  return {
    regular: all.filter(e => !e.isHidden),
    hidden: all.filter(e => e.isHidden)
  };
}

let abilitiesPromise = null;
let speciesPromise = null;
let speciesAbilitiesPromise = null;

/** The ability table. Cached on the promise, not on the value, so two callers
 *  racing at boot share one request instead of fetching twice. */
export function loadAbilities() {
  if (!abilitiesPromise) abilitiesPromise = loadJson('abilities.json');
  return abilitiesPromise;
}

/** ability slug → holder rows. Only ability.html needs this. */
export function loadAbilitySpecies() {
  if (!speciesPromise) speciesPromise = loadJson('ability_species.json');
  return speciesPromise;
}

/**
 * dex id → that species' ability slugs. Only abilities.html needs this, and it
 * is what lets that page answer 「這隻有哪些特性」 without loading
 * pokemon_data.json — §3.AB's split holds because the reverse index is 88 KB,
 * not because the question went away.
 */
export function loadSpeciesAbilities() {
  if (!speciesAbilitiesPromise) speciesAbilitiesPromise = loadJson('species_abilities.json');
  return speciesAbilitiesPromise;
}

/**
 * The reverse lookup: how many species the panel shows at once.
 *
 * Exported rather than written at the call site so the page and
 * `check_abilities_page.mjs` share one number, the same reason
 * `color-palette.js`'s strip width is read instead of restated (§3.W).
 *
 * **The cap exists because the query space is not evenly sized.** Measured over
 * all 1,025 records, a ONE-character query matches 574 species on `a` and 504 on
 * `e`, against 1 for any two-character Chinese name. Rendering every hit is
 * therefore not an edge case, it is the common case for the first keystroke of
 * an English query — and a reader who sees 574 rows learns nothing from any of
 * them.
 *
 * `total` is returned alongside `hits` so the panel can say 「574 隻，只顯示前
 * 12 隻」 rather than quietly truncating. §3.B2's rule: an absence the reader
 * cannot distinguish from an answer is worse than a visible limit.
 */
export const SPECIES_RESULT_CAP = 12;

/**
 * Flatten the generated reverse index into a dex-ordered array.
 *
 * The file is an OBJECT keyed by dex id, and JSON key order is not something to
 * build a display order on — integer-like keys happen to enumerate ascending in
 * JS today and nothing in the spec guarantees it stays that way. Sorting here
 * makes dex order a property of this function rather than of a parser.
 */
export function buildSpeciesIndex(raw) {
  return Object.keys(raw || {})
    .map(key => {
      const row = raw[key] || {};
      return {
        id: Number(key),
        name: row.zh || '',
        nameEn: row.en || '',
        reg: row.reg || [],
        hid: row.hid || []
      };
    })
    .filter(row => Number.isFinite(row.id))
    .sort((a, b) => a.id - b.id);
}

/**
 * Split one species into its slots, and say which of the three labels it gets.
 *
 * 「單一特性」 is a property of the SPECIES, not a third kind of ability: a
 * species with one regular and no hidden slot cannot swap or be bred for a
 * second one. It is computed here rather than stored because it is a function of
 * the two lists the index already carries — a third field to keep in step with
 * them is a third thing that can be wrong (§3.B1).
 *
 * **`shared` is not an error case, it is a merge artefact, and it is 12 species
 * wide.** The index is keyed by baseId, so a regional forme folds onto the base
 * species — and a regional forme's REGULAR ability is very often the base forme's
 * HIDDEN one (Alolan Grimer's poison-touch is Kantonian Grimer's hidden 毒觸;
 * Rock Head is the Marowak case §3.AC records). Merging them puts one slug in
 * both lists, which has no single honest slot: printing it twice invents a
 * duplicate, and picking one silently mislabels the other forme.
 *
 * So the caller gets three disjoint lists and prints the third as its own row.
 * A plain `reg ∩ hid` in the caller would work, but returning it here is what
 * keeps the three lists provably disjoint — the page cannot accidentally print a
 * slug twice, and `check_abilities_page.mjs` asserts that.
 */
export function speciesSlots(species) {
  const reg = (species && species.reg) || [];
  const hid = (species && species.hid) || [];
  const hidSet = new Set(hid);
  const regSet = new Set(reg);
  const shared = reg.filter(slug => hidSet.has(slug));
  return {
    reg: reg.filter(slug => !hidSet.has(slug)),
    hid: hid.filter(slug => !regSet.has(slug)),
    shared,
    single: reg.length === 1 && hid.length === 0
  };
}

/**
 * The Pokémon half of the search box.
 *
 * Matches on SUBSTRING against the Chinese name and the English name, and on
 * the dex id bare or zero-padded to three digits — the same id rule
 * `filterAbilities` uses, so 「025」 finds 皮卡丘 here and a 3-digit id finds a
 * move there without the reader learning two conventions.
 *
 * Returns `{ hits, total }` and never more than `cap` hits, for the reason
 * `SPECIES_RESULT_CAP` records. An EMPTY query returns nothing rather than
 * everything: the panel answers 「this Pokémon can have these abilities」, and
 * with no Pokémon named the honest answer is no Pokémon.
 */
export function filterSpecies(index, q, cap = SPECIES_RESULT_CAP) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return { hits: [], total: 0 };
  const hits = [];
  let total = 0;
  for (const row of index || []) {
    const id = String(row.id);
    const matched =
      row.name.toLowerCase().includes(query) ||
      row.nameEn.toLowerCase().includes(query) ||
      id === query ||
      id.padStart(3, '0') === query;
    if (!matched) continue;
    total += 1;
    if (hits.length < cap) hits.push(row);
  }
  return { hits, total };
}

/** `dex id` as the site prints it everywhere else — zero-padded to three. */
export function speciesIdText(id) {
  return `#${String(id).padStart(3, '0')}`;
}

/**
 * The detail page's link out to a holder.
 *
 * Built through `pokemonDetailUrl()` rather than by hand, which is what keeps
 * `nidoran-f` and `nidoran-m` distinct — §3.A's rule, and the reason every
 * cross-page URL on this site goes through a canonical helper.
 *
 * The row carries the ROSTER's `nameEn` rather than PokeAPI's slug because the
 * helper slugs it: shared.js's pokemonSlug() turns "Farfetch'd" into
 * `farfetch-d`, while PokeAPI calls that species `farfetchd`, so handing this
 * PokeAPI's string would dead-link 14 species. 14 dead links is the number that
 * matters here — each one is a card that renders and goes nowhere.
 */
export function holderUrl(row) {
  return pokemonDetailUrl({ names: { en: row.nameEn || row.name } });
}

/**
 * The holder's artwork: the official Scarlet/Violet set, falling back to the
 * 96px sprite — the same choice `move.html` makes for its learner cards.
 *
 * `hasSv()` is asked BEFORE the request rather than after a 404, which would
 * leave a console error and nothing else to trace on a card that otherwise
 * renders fine (§3.E). The fallback is dormant today — all 1,025 species carry
 * SV art — and kept anyway, because it is what an upstream removal degrades
 * into rather than into a broken image.
 *
 * **This needs only `row.baseId`, which is why the page can have official
 * artwork without loading pokemon_data.json.** `hasSv()` and `svUrl()` are both
 * keyed on the id alone, so §3.AB's slim-index decision survives the change: the
 * holder grid still reads nothing but the two generated ability tables.
 */
export function holderSprite(row) {
  return hasSv(row.baseId) ? svUrl(row.baseId) : spriteUrl(row.baseId);
}

/** Whether this holder got the official art or the 96px stand-in. The page uses
 *  it for the sr-only note move.html also prints. */
export function holderHasSv(row) {
  return hasSv(row.baseId);
}