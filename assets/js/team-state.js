/**
 * Team roster state: membership, limits, filtering, and the URL contract.
 *
 * Pure: no DOM, no history, no data. Every transition the page performs is a
 * function here, so a Node checker can exercise the cap, the duplicate rule,
 * the filter grammar and the `?team=` round-trip without a browser.
 *
 * The URL carries ids, not slugs: ids are stable, compact, and already the key
 * `spriteUrl()` and the roster use. `?team=1,6,25` is the whole contract.
 */

export const TEAM_LIMIT = 6;

/** Lowercase, strip diacritics, collapse punctuation to single spaces. */
function fold(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A name folded for matching; `Mr. Mime` and `Flabébé` both survive. */
export function foldName(text) {
  return fold(text);
}

/**
 * Whether one roster record answers `query`. Matches the Chinese name,
 * `#004` / `004` / `4` against the zero-padded id, and the English name with
 * punctuation and diacritics ignored (`mrmime` finds Mr. Mime).
 */
export function matchesQuery(pokemon, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;

  if (/^#?\d+$/.test(raw)) {
    const digits = raw.replace(/[^0-9]/g, '');
    if (String(pokemon.id).padStart(4, '0') === digits.padStart(4, '0')) return true;
  }

  if (pokemon.names.zh.includes(raw)) return true;

  const needle = fold(raw);
  if (!needle) return false;
  const haystack = fold(pokemon.names.en);
  return haystack.includes(needle) || haystack.replace(/ /g, '').includes(needle.replace(/ /g, ''));
}

/**
 * Filter the roster by the four controls. An empty string or null means "any",
 * so the same predicate serves the initial unfiltered render.
 */
export function filterRoster(roster, filters = {}) {
  const { query = '', region = '', generation = '', type = '' } = filters;
  return roster.filter((pokemon) => (
    matchesQuery(pokemon, query)
    && (!region || pokemon.regions.includes(region))
    && (!generation || pokemon.generation === Number(generation))
    && (!type || pokemon.types.includes(type))
  ));
}

/**
 * Reads `?team=` into ids. Invalid ids, duplicates, and anything past the cap
 * are dropped and counted; the count is what the page announces, never a silent
 * truncation.
 */
export function parseTeamParam(value, validIds) {
  const ids = [];
  let ignored = 0;
  const tokens = String(value == null ? '' : value).split(',');
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const id = Number(trimmed);
    if (
      !Number.isInteger(id)
      || !validIds.has(id)
      || ids.includes(id)
      || ids.length >= TEAM_LIMIT
    ) {
      ignored += 1;
      continue;
    }
    ids.push(id);
  }
  return { ids, ignored };
}

/** The `?team=` value for a team; empty string when there is no team. */
export function serializeTeamParam(ids) {
  return ids.join(',');
}

/** Add one member, reporting why a rejected add was rejected. */
export function addMember(ids, id, validIds) {
  if (!validIds.has(id)) return { ids, ok: false, reason: 'invalid' };
  if (ids.includes(id)) return { ids, ok: false, reason: 'duplicate' };
  if (ids.length >= TEAM_LIMIT) return { ids, ok: false, reason: 'full' };
  return { ids: [...ids, id], ok: true, reason: null };
}

/** Remove one member; removing an absent id is a no-op. */
export function removeMember(ids, id) {
  return ids.filter((value) => value !== id);
}

/**
 * `count` distinct ids drawn from `ids`, in a settled order. `rng` is injected
 * so the checker can run a seeded generator instead of a flaky one.
 */
export function randomTeam(ids, count = TEAM_LIMIT, rng = Math.random) {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}
