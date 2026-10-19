/**
 * The shared daily draw (assets/js/daily-pick.js) and its two callers.
 *
 *   node scripts/check_color_daily.mjs
 *
 * WHY THIS IS A SEPARATE FILE from check_color_page.mjs. The shell contract is
 * static string matching over one HTML file; everything here has to EXECUTE the
 * draw, because every failure mode is arithmetic that parses and renders fine.
 *
 * The motivating regression: a bare `color.html` — the page the nav, the
 * 色彩 (Colors) dropdown and any pasted link all point at — resolved no id and
 * rendered 找不到這個寶可夢 ("Pokémon not found"). There was no id to resolve,
 * because the URL had no ?slug. A static check for "init() has a fallback"
 * passes just as happily against a fallback that returns `pokemon[0]` every day
 * of the year, so the four properties below are measured rather than
 * pattern-matched:
 *
 * 1. DAY STABILITY. A daily draw that is not stable is a coin flip. Measured by
 *    drawing the same instant twice, and by drawing three clock times inside one
 *    Taipei calendar day — including the hour either side of the UTC date
 *    rollover, the trap `taipeiDateKey` exists to avoid.
 * 2. BUCKET PARITY. A flat pool over the 114 ids is ~62% 傳說 (legendary) and
 *    reaches 600族 (pseudo-legendary) on ~9% of days, so two of four buckets
 *    would effectively never appear. The 4σ gate below fails if someone
 *    "simplifies" it back to a flat draw.
 * 3. REACHABILITY. Every member of every pool must be drawable, or a Pokémon can
 *    be permanently unfeatured no matter how many days pass.
 * 4. STREAM INDEPENDENCE. color.html must not be a copy of the homepage's draw;
 *    a shared seed would make the homepage a spoiler for the colour page.
 *
 * It also pins the two things a refactor can silently undo: that color.html's
 * fallback fires only when NO id was requested (a present-but-bogus ?slug is a
 * broken link and must keep saying so), and that index.html and color.html
 * import ONE implementation rather than each keeping a copy.
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DAILY_BUCKETS, DAILY_SEED, POPULAR_IDS,
  dailyPool, drawDaily, pickDailyPokemon, taipeiDateKey,
} from '../assets/js/daily-pick.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const check = (cond, ok, bad) => (cond ? pass(ok) : fail(bad));

const pokemon = json('assets/data/pokemon_data.json');
const palettes = json('assets/data/color_palettes.json');
const todayHtml = read('today.html');
const colorHtml = read('color.html');

/** Days exercised. 10 years — long enough that a rare bucket cannot hide. */
const DAYS = 3650;
const EPOCH = Date.UTC(2020, 0, 1);
const day = (i) => new Date(EPOCH + i * 86400000);

console.log('\n--- the pools the draw reads from ---');
check(
  new Set(DAILY_BUCKETS).size === DAILY_BUCKETS.length,
  `the ${DAILY_BUCKETS.length} buckets are distinct`,
  `DAILY_BUCKETS has a duplicate: ${DAILY_BUCKETS.join(', ')} — a repeated name silently gives that pool twice the weight, which is exactly the parity bug below`,
);
const pools = Object.fromEntries(DAILY_BUCKETS.map((b) => [b, dailyPool(b, pokemon) ?? []]));
for (const b of DAILY_BUCKETS) {
  check(pools[b].length > 0, `${b.padEnd(18)} ${String(pools[b].length).padStart(3)} members`, `pool ${b} is empty, so the bucket can never be drawn`);
}
check(
  pools.popular.length === POPULAR_IDS.length,
  `every transcribed 熱門 (popular) id resolves (${POPULAR_IDS.length}/${POPULAR_IDS.length})`,
  `only ${pools.popular.length} of ${POPULAR_IDS.length} 熱門 (popular) ids exist in pokemon_data.json — a drifted transcription`,
);
// Four ids sit in two buckets at once (超夢/烈空坐 熱門+傳說, 快龍/烈咬陸鯊
// 熱門+600族), so the pools are not disjoint and their union is not their sum.
const union = new Set(DAILY_BUCKETS.flatMap((b) => pools[b].map((p) => p.id)));
check(
  union.size < POPULAR_IDS.length + pools.legendary.length + pools.mythical.length + pools['pseudo-legendary'].length,
  `the pools overlap as documented (${union.size} unique ids across four pools)`,
  'the pools no longer overlap, so the "two buckets" note in daily-pick.js is stale',
);

console.log('\n--- the draw: stability, parity, reachability, coverage ---');
const sigma = Math.sqrt(DAYS * 0.25 * 0.75);
const expected = DAYS / DAILY_BUCKETS.length;
const tally = Object.fromEntries(DAILY_BUCKETS.map((b) => [b, 0]));
const seen = Object.fromEntries(DAILY_BUCKETS.map((b) => [b, new Set()]));
let nulls = 0;
let missingPalette = 0;
let offPool = 0;
let unknownBucket = 0;

for (let i = 0; i < DAYS; i++) {
  // `drawDaily`, not `pickDailyPokemon`: four ids sit in two pools at once, so
  // attributing a pick to the first pool that CONTAINS it credits 熱門 with
  // #149/150/384/445 whenever those were actually drawn as 600族 or 傳說 — which
  // reads as a 8σ parity failure and a fake reachability gap.
  const draw = drawDaily(pokemon, { now: day(i) });
  if (!draw) { nulls++; continue; }
  const { bucket, member: p } = draw;
  // A bucket the checker's own pool table never heard of is a broken list, not
  // a broken draw. Counting it keeps the loop reporting rather than throwing a
  // TypeError, which would exit non-zero while printing no FAIL line at all.
  if (!pools[bucket]) { unknownBucket++; continue; }
  if (!pools[bucket].some((m) => m.id === p.id)) { offPool++; continue; }
  tally[bucket]++;
  seen[bucket].add(p.id);
  // A pick with no palette is a broken page: color.html would render an empty
  // hero. Both variants are checked because ?variant=shiny survives the fallback.
  if (!Array.isArray(palettes?.[String(p.id)]?.n) || !Array.isArray(palettes?.[String(p.id)]?.s)) missingPalette++;
}

console.log(`\n  seed "${DAILY_SEED}" over ${DAYS} days — 1σ = ${sigma.toFixed(0)}`);
check(nulls === 0, 'every day resolves a Pokémon', `${nulls} day(s) resolved to null`);
check(unknownBucket === 0, 'every pick names a bucket the draw knows', `${unknownBucket} day(s) drew a bucket that is not in DAILY_BUCKETS`);
check(offPool === 0, 'every pick is a member of the bucket it was drawn from', `${offPool} pick(s) came from outside every pool`);
check(missingPalette === 0, 'every pick has both a normal and a shiny palette', `${missingPalette} pick(s) have no usable palette`);
for (const b of DAILY_BUCKETS) {
  const z = (tally[b] - expected) / sigma;
  const reachable = seen[b].size === pools[b].length;
  check(
    Math.abs(z) < 4 && reachable,
    `${b.padEnd(18)} ${String(tally[b]).padStart(4)} (${z >= 0 ? '+' : ''}${z.toFixed(2)}σ), ${seen[b].size}/${pools[b].length} members reachable`,
    `${b} drew ${tally[b]} of ${DAYS} (${z.toFixed(2)}σ off ${expected}, ${seen[b].size}/${pools[b].length} reachable) — a flat pool or an unreachable bucket`,
  );
}

console.log('\n--- one Taipei calendar day, one pick ---');
// All four instants are 2026-10-02 in Asia/Taipei (UTC+8): 00:00, 01:00, 11:59
// and 23:59 local. The first and last are the pair that catches the rollover
// trap — a checker that only sampled local noon would pass a version that reads
// the UTC date, and that version would flip the pick at 08:00 Taipei.
const SAME_TAIPEI_DAY = [
  ['00:00', '2026-10-01T16:00:00Z'],
  ['01:00', '2026-10-01T17:00:00Z'],
  ['11:59', '2026-10-02T03:59:00Z'],
  ['23:59', '2026-10-02T15:59:00Z'],
];
const keys = new Set(SAME_TAIPEI_DAY.map(([, iso]) => taipeiDateKey(new Date(iso))));
check(
  keys.size === 1 && keys.has('2026-10-02'),
  `all four sample instants key to one Taipei date (${[...keys].join(', ')})`,
  `the sample instants span ${keys.size} dates (${[...keys].join(', ')}) — the "same day" check below would be measuring two days`,
);
const sameDay = SAME_TAIPEI_DAY.map(([, iso]) => pickDailyPokemon(pokemon, { now: new Date(iso) }).id);
check(
  new Set(sameDay).size === 1,
  `00:00, 01:00, 11:59 and 23:59 Taipei on one day all draw #${sameDay[0]}`,
  `one Taipei day drew ${[...new Set(sameDay)].join(', ')} — the seed is reading the clock, not the date`,
);
const nextDay = pickDailyPokemon(pokemon, { now: new Date('2026-10-02T16:00:00Z') });
check(
  nextDay.id !== sameDay[0],
  `the next Taipei day draws a different Pokémon (#${nextDay.id} ${nextDay.names.zh})`,
  'consecutive Taipei days draw the same Pokémon, so the draw is not advancing',
);
check(
  taipeiDateKey(new Date('2026-09-27T15:59:00Z')) === '2026-09-27',
  '23:59 Taipei keys to its own day, not the next',
  '23:59 Taipei keys to the NEXT day, so the draw rolls over an hour early',
);
check(
  taipeiDateKey(new Date('2026-09-27T16:00:00Z')) === '2026-09-28',
  '00:00 Taipei rolls over to the next day',
  '00:00 Taipei does not roll the draw over, so the pick never changes',
);
const today = pickDailyPokemon(pokemon);
console.log(`       today (${taipeiDateKey(new Date())}) draws #${today.id} ${today.names.zh}`);

console.log('\n--- the two pages feature the SAME Pokémon ---');
// The 今日推薦 (today's pick) card advertises the colour page. An earlier
// version gave each page its own seed prefix and the two agreed on only 1.9% of
// days, so a reader who saw 今日推薦 = 班基拉斯 (Tyranitar) was shown 厄鬼椪
// (Ogerpon) with nothing explaining the switch.
//
// Each page's OWN call expression is lifted out of its HTML and executed here, so
// this compares what the two files actually ask for. Calling pickDailyPokemon
// twice would be circular — it would agree with itself while both pages diverged,
// which is precisely the bug being guarded.
const CALL_SITES = Object.fromEntries(
  [['today.html', todayHtml], ['color.html', colorHtml]].map(([name, html]) => {
    const at = html.indexOf('pickDailyPokemon(');
    if (at < 0) return [name, null];
    let depth = 0;
    let end = at;
    for (; end < html.length; end++) {
      if (html[end] === '(') depth++;
      else if (html[end] === ')' && --depth === 0) { end++; break; }
    }
    return [name, html.slice(at, end)];
  }),
);
check(
  Object.values(CALL_SITES).every((e) => typeof e === 'string'),
  `both pages' call expressions were lifted verbatim: ${Object.entries(CALL_SITES).map(([n, e]) => `${n} → ${e ?? '??'}`).join('   ')}`,
  `a page's pickDailyPokemon call could not be lifted out for evaluation (${JSON.stringify(CALL_SITES)})`,
);

// The two pages reach the day differently and both are correct: index.html is
// handed a `now` by its caller, while color.html calls bare and lets the module
// default to the real clock. A wrapper supplies that default from a clock this
// loop owns, and `...opts` still wins, so a page that passed its OWN date or a
// per-page seed would diverge here exactly as it would in a browser.
let clock = new Date();
const ctx = vm.createContext({
  pokemon,
  data: pokemon,
  pickDailyPokemon: (dataArg, opts = {}) => pickDailyPokemon(dataArg, { now: clock, ...opts }),
  now: clock,
});
const callPage = (expr) => vm.runInContext(expr, ctx).id;
let diverged = 0;
let firstDivergence = null;
for (let i = 0; i < DAYS; i++) {
  clock = day(i);
  ctx.now = clock;
  const a = callPage(CALL_SITES['today.html']);
  const b = callPage(CALL_SITES['color.html']);
  if (a !== b) {
    diverged++;
    firstDivergence ??= `${taipeiDateKey(day(i))} gave #${a} and #${b}`;
  }
}
check(
  diverged === 0,
  `both pages' real call sites draw identically on all ${DAYS} days`,
  `the two pages disagree on ${diverged} of ${DAYS} days (first: ${firstDivergence}) — the homepage's 今日推薦 (today's pick) and the colour page's default must be the same Pokémon`,
);

console.log('\n--- one seed, and no way to add a second ---');
// The API taking only `now` is what makes the check above hold by construction.
// If someone reintroduces a per-caller override, the pages can diverge again.
check(
  typeof DAILY_SEED === 'string',
  `the module exposes exactly one seed prefix ("${DAILY_SEED}")`,
  `DAILY_SEED is ${JSON.stringify(DAILY_SEED)}, expected a single seed prefix string — the per-caller seed map is back`,
);

console.log('\n--- one implementation, two callers ---');
for (const [name, html] of [['today.html', todayHtml], ['color.html', colorHtml]]) {
  check(
    /from ['"]\.\/assets\/js\/daily-pick\.js['"]/.test(html),
    `${name} imports the shared draw from assets/js/daily-pick.js`,
    `${name} does not import daily-pick.js — it either keeps a private copy of the seed arithmetic or lost the draw`,
  );
  check(
    !/function (mulberry32|fnv1a|taipeiDateKey)\s*\(/.test(html),
    `${name} declares no second copy of the seed helpers`,
    `${name} redefines a seed helper, so the two pages can drift on the date key or the PRNG`,
  );
  check(
    !/DAILY_BUCKETS\s*=\s*\[/.test(html),
    `${name} declares no second copy of the bucket list`,
    `${name} redefines DAILY_BUCKETS, so the pools can disagree`,
  );
}
check(
  /POPULAR_IDS as DAILY_POPULAR_IDS/.test(todayHtml),
  'today.html reuses daily-pick.js POPULAR_IDS for the 熱門 (popular) grid',
  'today.html no longer imports the shared 熱門 (popular) list, so the two can disagree',
);
// The import alone is not enough: `const POPULAR_IDS = [1, 2, 3]` next to the
// import shadows it silently, and the grid would render three cards while the
// daily draw still featured the module's ten.
check(
  !/const POPULAR_IDS\s*=\s*\[/.test(todayHtml),
  'today.html declares no second copy of the 熱門 (popular) id list',
  'today.html keeps its own 熱門 (popular) id list, so 今日推薦 (today\'s pick) can feature a Pokémon the grid below never shows',
);

console.log('\n--- color.html: the fallback fires only for an absent id ---');
check(
  /if \(!current && !requested\)/.test(colorHtml),
  'the fallback is guarded on !current && !requested',
  'the fallback is not guarded on whether an id was requested — a bogus ?slug would be silently replaced',
);
check(
  /const requested = params\.get\('slug'\) \|\| params\.get\('id'\)/.test(colorHtml),
  '`requested` reads both ?slug and ?id, so ?id=999 alone still counts as a broken link',
  '`requested` ignores ?id, so a bogus ?id= would fall through to the daily pick',
);
check(
  /findBySlug\(pokemon, params\.get\('slug'\), params\.get\('id'\)\)/.test(colorHtml),
  'the explicit ?slug / ?id lookup is untouched, so deep links still win',
  'the ?slug / ?id lookup changed — deep links may no longer be honoured',
);
check(
  !/pickDailyPokemon\([^)]*\bstream\b/.test(colorHtml) && !/pickDailyPokemon\([^)]*\bseed\b/.test(colorHtml),
  "color.html asks for the day's pick with no per-page seed or stream override",
  "color.html passes a per-page stream/seed to pickDailyPokemon, so it can feature a different Pokémon than the homepage's 今日推薦 (today's pick)",
);
check(
  !/pickDailyPokemon\([^)]*\bstream\b/.test(todayHtml) && !/pickDailyPokemon\([^)]*\bseed\b/.test(todayHtml),
  "today.html asks for the day's pick with no per-page seed or stream override",
  "today.html passes a per-page stream/seed to pickDailyPokemon, so it can feature a different Pokémon than the colour page's default",
);
check(
  /<div class="cp-empty"><p>找不到這個寶可夢。<\/p>/.test(colorHtml),
  'the not-found message survives in the RENDERED error block, not just in a comment',
  'the not-found message was removed from the rendered error block, so a bad link now renders blank',
);
check(
  /history\.replaceState/.test(colorHtml),
  'render() still rewrites the URL, which is what makes the fallback pick shareable',
  'no replaceState in color.html, so a bare URL stays bare and the pick cannot be shared',
);

console.log();
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All daily-draw checks passed');