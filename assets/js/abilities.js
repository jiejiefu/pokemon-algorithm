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
 * Two generated tables back it:
 *   assets/data/abilities.json       — slug → {nameZh, effect, generation, …}
 *   assets/data/ability_species.json — slug → the Pokémon that hold it
 *
 * Both are produced by scripts/fetch_abilities_detail.py and policed by
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