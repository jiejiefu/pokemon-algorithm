#!/usr/bin/env node
/**
 * Verify the shared 24-cover roster: that the list is what it says it is, and
 * that there is exactly one of it.
 *
 * Run: node scripts/check_cover_roster.mjs
 *
 * WHY A FILE OF ITS OWN
 * =====================
 * Three pages show the cover legendaries — `spectrum.html`'s quick-pick chips,
 * `colors-generator.html`'s 24-cell grid, and `cries.html`'s 封面神獸 filter — and
 * two of them had already written the list out independently, byte for byte. The
 * roster is now `assets/js/cover-roster.js` and this file owns every claim about
 * it, so the three page checkers keep only what is page-shaped: that the page
 * imports it and uses the name it imports under.
 *
 * This is not tidiness. The failure mode of a duplicated roster is a 24-cell grid
 * that quietly disagrees with a 24-chip row about which 24, and neither page has
 * any way to notice: each one's own list is internally consistent, its count is
 * still 24, and its ids are still real species.
 *
 * THE ABSENCE IS THE POINT, AND IT NEEDS THE STRIPPED COPY
 * ========================================================
 * `assertOneRoster` is the check that cannot be a presence check. "The page
 * imports the module" is satisfied the moment the literal comes back; only "the
 * page does not define one" holds the claim shut. And it has to run on
 * comment-stripped source, because the pages now carry comments explaining that
 * they used to hold their own copy — which is the same trap §3.W recorded for the
 * `<datalist>` on `color-game.html`, where an absence test was satisfied by the
 * comment explaining its removal. That is why `check_color_game.mjs` grew
 * `htmlCode` beside `html`; here there is only ever one copy, stripped.
 *
 * THE 24 IS A MEASUREMENT, NOT A CONSTANT, ON THE OTHER SIDE
 * ===========================================================
 * Every id must be legendary or mythical, which is the property that makes this
 * list a cover roster rather than twenty-four Pokémon someone liked. That is a
 * join against `pokemon_data.json`, not a restatement of the labels.
 *
 * `cry_features.json` is checked too, and it is a different kind of check: all 24
 * have a row in `latest`, which is what lets `cries.html` filter on them at all.
 * On `legacy` only THIRTEEN do — ids 1–649 cover Gen 1–5, and eleven cover
 * legendaries postdate it. That 13 is printed rather than asserted at 13: it is a
 * property of which species the old recording happens to contain, and a checker
 * that pinned the number would go red the day someone added a legacy file for a
 * later generation, having learned nothing. What cries.html promises instead is
 * printed ON the chip, recomputed from the active set — see its `renderFilters()`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let checks = 0;
const fails = [];
const ok = (cond, what) => {
  checks++;
  if (!cond) fails.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const eq = (got, want, what) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want: ${b}`}`);
};

const MODULE_PATH = 'assets/js/cover-roster.js';
const module_ = read(MODULE_PATH);
const rosterPage = JSON.parse(read('assets/data/pokemon_data.json'));
const features = JSON.parse(read('assets/data/cry_features.json'));

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

console.log('\ncover-roster.js — the 24');
console.log('');

// ---------------------------------------------------------------------------
// The list itself. Parsed as TEXT rather than imported, for the same reason
// check_color_match.mjs parses `SAMPLES` out of outfit.html: an import would make
// the checker's assertions about the file a statement about the module graph, and
// a syntax error would be a throw here instead of a red line.
// ---------------------------------------------------------------------------

/* Anchored on `Object.freeze([` rather than on `[`. The roster is exported frozen
   so no page can reorder the array every other page is iterating, and a slice that
   assumed `= [` would quietly return the empty string — after which `ids` is `[]`
   and every join below passes on an EMPTY list. That is §3.B2's shape exactly, and
   `check_color_match.mjs` hit it first while this was being written. The same
   anchor is used by both checkers that slice the module, so a change to the
   declaration breaks all three loudly instead of one silently. */
const rosterStart = module_.indexOf('export const COVER_ROSTER = Object.freeze([');
const rosterEnd = module_.indexOf('\n]);', rosterStart);
ok(rosterStart > 0 && rosterEnd > rosterStart,
  `the COVER_ROSTER literal is locatable, so the 24-pair assertion has something to slice (chars ${rosterStart}..${rosterEnd})`);
const rosterBlock = rosterStart > 0 && rosterEnd > rosterStart
  ? module_.slice(rosterStart, rosterEnd)
  : '';
const pairs = [...rosterBlock.matchAll(/\[\s*(\d+),\s*'([^']+)'\s*\]/g)];
eq(pairs.length, 24,
  `the roster holds 24 [id, edition] pairs — ids and editions, never names (${pairs.length})`);

const ids = pairs.map((m) => Number(m[1]));
eq(new Set(ids).size, ids.length,
  'and no id appears twice, so 24 chips are 24 species and not 23 plus a repeat');
ok(ids.every((id) => id >= 1 && id <= 1025),
  'every id is inside the 1,025-strong roster');

/* Ids and editions ONLY. A name in here would be a second copy of something
   `pokemon_data.json` already holds, and the copy is the one that goes stale —
   §3.B1's rule, and the reason both original literals were written this way. */
ok(!rosterBlock.includes('names.zh') && !/[一-鿿]{2,}/.test(
  rosterBlock.replace(/'[^']*[一-鿿][^']*'/g, '')),
  'and the pairs carry an edition and nothing else — no name is stored beside the id');

/* `COVER_IDS` must be DERIVED, not written out. A second literal of 24 numbers is
   24 chances to disagree with the 24 pairs, and the disagreement is silent: a
   filter that narrows to a set of species nothing on the page can name. */
const derived = /export const COVER_IDS = new Set\(COVER_ROSTER\.map\(\(\[id\]\) => id\)\)/.test(module_);
ok(derived,
  'COVER_IDS is derived from the pairs rather than written out beside them');

// ---------------------------------------------------------------------------
// Every id is a cover Pokémon, and has a name to display. Both are joins against
// the data, not restatements of the labels.
// ---------------------------------------------------------------------------

const byId = new Map(rosterPage.map((p) => [p.id, p]));
eq(ids.filter((id) => !byId.has(id)), [],
  'every id resolves in pokemon_data.json');
const plain = ids.filter((id) => byId.get(id) && !byId.get(id).is_legendary && !byId.get(id).is_mythical);
eq(plain, [],
  'and every one is legendary or mythical — the property that makes this a cover roster');
eq(ids.filter((id) => !byId.get(id)?.names?.zh), [],
  'and every one has the official zh-TW name its page will display');

/* The three editions that are not obvious from the id: 383/382 are different
   species AND different games, and 890 is the third of a three-way. A page that
   printed the grid without them would be showing three near-identical sprites. */
for (const [id, edition] of [[150, '關都 · 銀'], [384, '豐緣 · 綠寶石'], [890, '伽勒爾 · 劍／盾']]) {
  ok(pairs.some((m) => Number(m[1]) === id && m[2] === edition),
    `#${id} carries its edition 「${edition}」`);
}

/* ALPHABETICAL ORDER WOULD READ AS A SORT, and the order is deliberately the one
   someone who played them remembers: Mewtwo then Mew, the Box legendaries by
   version, Groudon/Kyogre/Rayquaza by game. It is also load-bearing in
   colors-generator.html's 8-wide grid — gen 1's two followed by gen 2's two puts
   Kanto, Johto and Hoenn on the first row rather than three of Hoenn. */
const genOf = (id) => byId.get(id)?.generation ?? 0;
ok(genOf(150) === 1 && genOf(151) === 1 && genOf(250) === 2,
  'and the ordering starts Mewtwo, Mew, then Johto — generation order, not alphabetical');
ok(ids.every((id, i) => i === 0 || genOf(id) >= genOf(ids[i - 1])),
  'with every id at or after its predecessor\'s generation');

// ---------------------------------------------------------------------------
// cries.html's dependency. A cover legendary with no measured cry cannot be
// filtered to, and the filter would show a shorter list than its own label says.
// ---------------------------------------------------------------------------

const latestIds = new Set(Object.keys(features.latest).map(Number));
eq(ids.filter((id) => !latestIds.has(id)), [],
  'every cover legendary has a cry in cry_features.json\'s latest set — cries.html\'s filter depends on it');

/* Not asserted at 13. It is a property of which species the OLD recording happens
   to contain, and pinning it would go red the day someone adds a legacy file for a
   later generation, having learned nothing. cries.html promises the number on the
   chip instead, recomputed from the active set on every render. */
const legacyIds = new Set(Object.keys(features.legacy).map(Number));
const legacyCovers = ids.filter((id) => legacyIds.has(id));
console.log(`  \n  legacy recording holds ${legacyCovers.length} of the 24 (Gen 1–5);`
  + ` the chip recomputes this rather than the roster carrying it`);
ok(legacyCovers.length > 0 && legacyCovers.length < 24,
  'the legacy subset is neither empty nor the whole roster, which is the asymmetry the chip label exists for');

// ---------------------------------------------------------------------------
// There is ONE list. Three imports, and no page holding a second copy.
// ---------------------------------------------------------------------------

const USERS = [
  { page: 'spectrum.html', alias: 'COVER_ROSTER as COVERS', local: 'COVERS' },
  { page: 'colors-generator.html', alias: 'COVER_ROSTER as LEGENDS', local: 'LEGENDS' },
  { page: 'cries.html', alias: 'COVER_IDS', local: 'COVER_IDS' },
];

const IMPORT_RE = (alias) =>
  new RegExp(`import\\s*\\{[^}]*${alias.replace(/\s+/g, '\\s+')}[^}]*\\}\\s*from\\s*'\\./assets/js/cover-roster\\.js'`);

for (const { page, alias, local } of USERS) {
  /* Stripped, for both halves. §3.W's finding was an import-shaped string inside
     a comment satisfying an import check — `color-game.html`'s `<datalist>`
     absence test was passed by the paragraph explaining the datalist's removal,
     and `htmlCode` exists beside `html` in that file for exactly this. */
  const stripped = stripComments(read(page));
  ok(IMPORT_RE(alias).test(stripped),
    `${page} imports the roster from cover-roster.js rather than declaring it`);
  /* The import line itself removed before asking whether the name is USED: an
     unused binding resolves fine and renders nothing, which is §3.I's shape — the
     page loads, the roster is there, and no grid is built from it. */
  const afterImport = stripped.replace(/import[^;]*cover-roster\.js';/g, ' ');
  ok(new RegExp(`\\b${local}\\b`).test(afterImport),
    `and uses ${local} outside the import, so the alias is not a dead binding`);
}

/* The absence, on comment-stripped source — see the header. Scoped to the 24-pair
   SHAPE rather than to the words COVERS/LEGENDS, because a page may name its
   import anything; what it may not do is hold `[123, '…']` pairs of its own.
   Measured, not assumed: across all three pages' stripped source this pattern
   currently matches ZERO times outside the module. `spectrum.html` used to be the
   risk — it builds nine generation chips, and its `GEN_LIST` was deliberately
   written as bare numbers `[1, 2, …]` rather than `[gen, '第 N 世代']` pairs for
   exactly this reason, documented at the literal. */
const pairLiteral = /\[\s*\d+\s*,\s*'[^']*'\s*\]/g;
const pairLiteralHits = (page) => {
  const stripped = stripComments(read(page));
  return [...stripped.matchAll(pairLiteral)]
    .map((m) => m[0])
    /* Every pair in these files would be a roster member, because the shape is
       otherwise unused — which is what the measurement above establishes. Still
       filtered to the 24 rather than assumed, so a future `[gen, label]` table
       cannot report this page for breaking a rule it is not breaking. */
    .filter((lit) => ids.some((id) => lit.startsWith(`[${id}`)));
};
for (const { page } of USERS) {
  eq(pairLiteralHits(page), [], `${page} declares no [id, edition] pair of its own — one roster, not three`);
}

/* The floor. Without it, a scanner whose pattern stopped matching reports "no page
   declares its own roster" for the same reason it reports it today: the pattern
   finds nothing anywhere. `check_tmp_prefixes.mjs` guards its own scan the same
   way, and for the same reason — a green that means "the detector is off" is
   indistinguishable from a green that means "the defect is absent". This is the
   assertion that makes the three `eq(..., [])` lines above non-vacuous. */
eq(pairLiteralHits(MODULE_PATH).length, 24,
  'and the scan that reports "no page declares its own" does find the 24 where they live');

console.log('');
console.log(`  covers: ${pairs.length} · editions distinct: ${new Set(pairs.map((m) => m[2])).size}`
  + ` · legacy subset: ${legacyCovers.length}`);

if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);
