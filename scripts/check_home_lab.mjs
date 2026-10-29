#!/usr/bin/env node
/**
 * index.html as a lab bench with a Pokédex on it. Run: node scripts/check_home_lab.mjs
 *
 * WHAT THIS GUARDS, AND WHY EACH ONE IS A FAILURE THAT STILL RENDERS
 * ----------------------------------------------------------------
 * The homepage is one idea — every experiment fills the dex — and almost every
 * way of breaking it leaves a page that looks fine:
 *
 *   - the daily draw drifts from today.html's, so the homepage shows one species
 *     and 今日推薦 shows another on the same day;
 *   - the wall reads a species from the panel's rendered text, so an ellipsis or
 *     a format change throws at species 0;
 *   - the page fetches pokemon_data.json after all, and the wall costs 2.8 MB;
 *   - the hero track is 175vh in CSS and 240 in the module, so the scrub stops
 *     at 0.7 and nobody notices;
 *   - a rate of 0 is treated as a missing rate (§3.AA's `power: 0` lesson).
 *
 * The static half reads the modules and the page. The two claims that need a
 * browser — the canvas actually painting 1,025 cells, and localStorage surviving
 * a reload — were measured by hand and are NOT in the suite, deliberately: a
 * homepage checker that boots Chrome would make `--only=home` cost 8 s.
 *
 * Numbers are read from the modules that own them: the track height from
 * `HOME_HERO_TRACK_VH`, the roster size from `DEX_SIZE`, the milestones from
 * `MILESTONES`, the pools from `DAILY_BUCKETS`. A checker that restates a number
 * cannot notice it changing (§3.S).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createChecker } from './lib/assert.mjs';
import { DEX_SIZE, MILESTONES, STORAGE_KEY, nextMilestone } from '../assets/js/dex-collection.js';
import { DAILY_BUCKETS, POPULAR_IDS, pickDailyPokemon } from '../assets/js/daily-pick.js';
import { drawDailyFromTable } from '../assets/js/home-daily-draw.js';
import { HOME_HERO_TRACK_VH } from '../assets/js/home-hero.js';
import { heroGenFor, heroGenForKey, dayOffset, GEN_ONE_DATE } from '../assets/js/hero-gen.js';
import { catchChance } from '../assets/js/home-dex-wall.js';
import { SITE_THEME } from './lib/theme-init.mjs';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(BASE, p), 'utf8');
const has = (p) => existsSync(join(BASE, p));
const json = (p) => JSON.parse(read(p));

const { ok, is, eq, near, report } = createChecker();

/** Comments are stripped before any markup or CSS shape is matched: the page and
 *  the stylesheet both name the selectors they are about while describing them.
 *
 *  `//` is stripped too, and separately, because BOTH files carry JS comments that
 *  name the very defects this checker looks for — index.html's mount script says
 *  why it does not call initThemeToggle(), and home-lab.js's comment quotes the
 *  `Number(info.no.textContent…)` read it replaced. A checker that greps the raw
 *  file fails on its own documentation. */
const stripBlockComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const stripLineComments = (s) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const stripComments = (s) => stripLineComments(stripBlockComments(s));

const html = read('index.html');
const htmlCode = stripComments(html);
const css = read('assets/css/home-lab.css');
const cssCode = stripComments(css);
const lab = read('assets/js/home-lab.js');
const labCode = stripComments(lab);
const wall = read('assets/js/home-dex-wall.js');
const wallCode = stripComments(wall);
const draw = read('assets/js/home-daily-draw.js');
const collection = read('assets/js/dex-collection.js');

const dexTable = json('assets/data/home_dex.json');
const dailyTable = json('assets/data/home_daily.json');
const full = json('assets/data/pokemon_data.json');

/** The declarations of one rule's block, or null. Selectors are passed
 *  UNescaped; the helper escapes them. */
const rule = (sel) => {
  const m = cssCode.match(new RegExp(`(?:^|[,}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};
const idPresent = (id) => new RegExp(`id="${id}"`).test(htmlCode);

console.log('\n--- the wall\'s table is the roster, not a second copy ---');
eq(dexTable.p.length, DEX_SIZE, 'home_dex.json carries one row per dex slot');
eq(dexTable.gens.reduce((a, b) => a + b, 0), DEX_SIZE,
  'the generation counts add up to the roster size',
  `gens sum to ${dexTable.gens.reduce((a, b) => a + b, 0)}`);
eq(dexTable.gens.length, 9, 'there are nine generation bands');
eq(dexTable.types.length, 18, 'the type table has all eighteen types');
ok(dexTable.p.every((r) => r.length === 6),
  'every row is [generation, colour, type0, type1, capture rate, name]',
  `row lengths: ${[...new Set(dexTable.p.map((r) => r.length))].join(', ')}`);
ok(dexTable.p.every((r) => r[0] >= 1 && r[0] <= 9),
  'every row states a generation in range');
ok(dexTable.p.every((r) => /^#[0-9a-f]{6}$/.test(r[1])),
  'every row carries the six-digit colour the cell is tinted with');
ok(dexTable.p.every((r) => Number.isInteger(r[2]) && r[2] >= 0 && r[2] < 18
  && (r[3] === -1 || (Number.isInteger(r[3]) && r[3] >= 0 && r[3] < 18))),
  'type indexes resolve into the type table, with -1 for a single-type species');
ok(dexTable.p.every((r) => Number.isInteger(r[4]) && r[4] >= 0 && r[4] <= 255),
  'every capture rate is a real 0..255 number',
  `min ${Math.min(...dexTable.p.map((r) => r[4]))}, max ${Math.max(...dexTable.p.map((r) => r[4]))}`);
ok(dexTable.p.every((r) => typeof r[5] === 'string' && r[5].length > 0),
  'every row has a Chinese name to announce');
ok(dexTable.p.every((r, i) => r[5] === full[i].names.zh),
  'row N names the same species pokemon_data.json names at index N',
  'the wall and the daily card would disagree about which species an id is');

console.log('\n--- the daily card\'s four pools ---');
eq(Object.keys(dailyTable.buckets).sort(), [...DAILY_BUCKETS].sort(),
  'home_daily.json carries exactly the four buckets daily-pick.js draws from');
ok(DAILY_BUCKETS.every((b) => Array.isArray(dailyTable.buckets[b]) && dailyTable.buckets[b].length > 0),
  'no bucket is empty',
  DAILY_BUCKETS.map((b) => `${b}:${dailyTable.buckets[b]?.length ?? 'missing'}`).join(' '));
ok(Object.values(dailyTable.buckets).flat().every((id) => dailyTable.p[id]),
  'every pooled id has a record to render');
ok(dailyTable.buckets.popular.join(',') === POPULAR_IDS.join(','),
  'the popular pool is POPULAR_IDS in its own order',
  'reordering the pool changes which species a day draws without changing the seed');
eq(Object.keys(dailyTable.p).length, new Set(Object.values(dailyTable.buckets).flat()).size,
  'the record table holds the union of the pools and nothing else');
ok(Object.values(dailyTable.p).every((r) => r.length === 5
  && typeof r[0] === 'string' && r[0] && typeof r[1] === 'string' && r[1]
  && typeof r[2] === 'string' && r[2] && typeof r[3] === 'string'
  && /^\d+\.png$/.test(r[4])),
  'every daily row is [zh, en, types, description, artwork filename]');

/* THE IDENTITY, NOT A TOLERANCE: 400 consecutive days, both draws, same id. */
{
  const start = new Date('2026-01-01T04:00:00Z');
  const mismatches = [];
  for (let i = 0; i < 400; i += 1) {
    const now = new Date(start.getTime() + i * 86_400_000);
    const tableId = drawDailyFromTable(dailyTable, { now })?.id;
    const liveId = pickDailyPokemon(full, { now })?.id;
    if (tableId !== liveId) mismatches.push(`${now.toISOString().slice(0, 10)}: ${tableId} vs ${liveId}`);
  }
  ok(mismatches.length === 0,
    'the homepage and today.html name the same species for 400 consecutive days',
    mismatches.length ? mismatches.slice(0, 3).join('; ') : '0 mismatches');
}
{
  const picks = new Set();
  const start = new Date('2026-01-01T04:00:00Z');
  for (let i = 0; i < 400; i += 1) picks.add(drawDailyFromTable(dailyTable, { now: new Date(start.getTime() + i * 86_400_000) }).bucket);
  eq([...picks].sort(), [...DAILY_BUCKETS].sort(),
    'over a year every bucket is reachable',
    'a bucket that never wins is a pool nobody will ever see');
}

console.log('\n--- the draw is imported, never re-derived ---');
ok(/import \{[^}]*\} from '\.\/daily-pick\.js'/.test(draw)
  && /DAILY_SEED/.test(draw) && /fnv1a/.test(draw) && /mulberry32/.test(draw) && /taipeiDateKey/.test(draw),
  'home-daily-draw.js imports the seed, hash, generator and date key');
ok(!/Math\.random/.test(stripComments(draw)),
  'the daily draw contains no Math.random, so it cannot drift from today.html',
  'a random draw would show a different species on every load');
ok(/from '\.\/home-daily-draw\.js'/.test(lab) && !/mulberry32/.test(labCode),
  'home-lab.js consumes the shared draw instead of keeping a second copy');

console.log('\n--- the page never asks for the 2.8 MB table ---');
ok(!/pokemon_data\.json/.test(htmlCode) && !/pokemon_data\.json/.test(labCode),
  'neither the page nor its module names pokemon_data.json',
  'the wall would cost 2.8 MB instead of 36 KB (§3.Z)');
ok(/fetch\('assets\/data\/home_dex\.json'\)/.test(labCode),
  'the wall fetches the compact dex table');
ok(/fetch\('assets\/data\/home_daily\.json'\)/.test(labCode),
  'the daily card fetches its own compact table');
ok(/rootMargin: '300px 0px'/.test(labCode) && /new IntersectionObserver/.test(labCode),
  'the daily card loads 300px before it is reached, not on load',
  'a load-time fetch spends 18 KB on a section most readers never scroll to');
ok(/if \(dailyLoaded\) return;/.test(labCode) && /obs\.disconnect\(\)/.test(labCode),
  'the daily load is guarded and the observer disconnects after the first hit',
  'a second call would render a second card and re-award the catch');

console.log('\n--- the selection is state, not rendered text ---');
ok(/let selectedId = 0;/.test(labCode),
  'the selected species is held in a variable');
ok(/selectedId = id \|\| 0;/.test(labCode) && /if \(selectedId\) wall\.attempt\(selectedId\)/.test(labCode),
  'both the panel and the throw read that variable');
ok(!/Number\(info\.no\.textContent/.test(labCode),
  'the throw does not read the species number back out of the DOM',
  'an ellipsis or an empty panel would throw at species 0 (§3.G)');

console.log('\n--- every id the module reads exists on the page ---');
{
  const ids = new Set();
  for (const m of labCode.matchAll(/\$\('([a-z0-9-]+)'\)/g)) ids.add(m[1]);
  for (const m of labCode.matchAll(/getElementById\('([a-z0-9-]+)'\)/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !idPresent(id));
  ok(missing.length === 0,
    `all ${ids.size} ids home-lab.js reads exist in index.html`,
    missing.length ? `missing: ${missing.join(', ')}` : 'none missing');
}
ok(/id="hx-wall"[^>]*tabindex="0"/.test(htmlCode) && /role="application"/.test(htmlCode),
  'the wall is a focusable application surface, so arrow keys can reach it');
ok(/aria-valuemin="0"[^>]*aria-valuemax="1025"/.test(htmlCode),
  'the counter announces the real maximum');
ok(/data-hx-count/.test(htmlCode) && /data-hx-fill/.test(htmlCode),
  'the counter has a number slot and a fill bar for renderHud() to write');
ok(/id="hx-live"[^>]*aria-live="polite"/.test(htmlCode),
  'catches are announced through a polite live region');

console.log('\n--- the wall itself ---');
ok(/const GAP = 2;/.test(wallCode),
  'the gutter is one named constant');
ok(/const MIN_CELL = 20;/.test(wallCode) && /const MAX_CELL = 44;/.test(wallCode),
  'cells are floored at a tappable 20px and capped at 44px',
  'below 20px the wall is a texture nobody can click');
eq((wallCode.match(/Math\.max\(MIN_CELL/g) || []).length, 2,
  'both the fit and the refit floor the cell at MIN_CELL',
  'a narrow window rounds the fit below the tappable floor and the wall shrinks instead of scrolling');
ok(/const TINT = 0\.42;/.test(wallCode) && /const TINT_TODAY = 0\.58;/.test(wallCode),
  'a caught cell is tinted harder than an empty one, and today\'s band harder still');
ok(/const SCAN_ROW_MS = 90;/.test(wallCode),
  'the scanner advances one row per named step');
ok(/if \(motion && visible\) scheduleIn\(scan\.paused \? .* : SCAN_ROW_MS\)/.test(wallCode),
  'the scan schedules its next row instead of driving a permanent rAF loop',
  'a 60Hz loop repainting a full-width canvas is the reason the machine ran hot (§3.J\'s neighbour)');
ok(/const ok = Math\.random\(\) < catchChance\(data\.p\[id - 1\]\[4\]\)/.test(wallCode),
  'a throw uses the species\' real capture rate');
near(catchChance(0), 0.3, 1e-9, 'a capture rate of 0 maps to the 0.3 floor, not the default');
near(catchChance(45), 0.3 + (45 / 255) * 0.7, 1e-9, 'an ordinary rate is linear in the rate');
is(catchChance(255), 1, 'the easiest species always lands');
is(catchChance(undefined), 0.3 + (45 / 255) * 0.7, 'a missing rate falls back to 45');
ok(/return null;/.test(wallCode) && /id < 1 \|\| id > N/.test(wallCode),
  'attempt() refuses an id outside the roster instead of drawing row -1');
ok(/dex\.onChange\(/.test(wallCode) && /dirty = true;/.test(wallCode),
  'the wall marks itself dirty on a catch rather than preloading every sprite');
eq((wallCode.match(/preloadCaught\(\);/g) || []).length, 1,
  'the caught sprites are preloaded once, at init',
  'a preload inside onChange decodes the whole caught set on every catch');
ok(/prefers-reduced-motion/.test(wallCode),
  'the wall honours reduced motion');

console.log('\n--- the maze win is a catch ---');
ok(/document\.addEventListener\('maze:result'/.test(labCode),
  'the page listens for the maze result');
ok(/if \(!won \|\| !Number\.isInteger\(id\)\) return;/.test(labCode),
  'a loss and a malformed id are both ignored',
  'a loss would award the terrain Pokémon anyway');
ok(/dex\.catch\(id, 'maze'\)/.test(labCode) && /dex\.catch\(id, 'daily'\)/.test(labCode),
  'a maze win and the daily card both record where the catch came from');
ok(/MILESTONES\.includes\(e\.size\)/.test(labCode) && /DEX_SIZE/.test(labCode),
  'milestones come from the collection module, not a second list');
ok(/window\.confirm\(/.test(labCode) && /if \(dex\.size === 0\) return;/.test(labCode),
  'clearing the dex asks first and does nothing when it is already empty');

console.log('\n--- the collection module ---');
eq(DEX_SIZE, 1025, 'the dex is the roster size');
ok(MILESTONES.every((m, i) => i === 0 || m > MILESTONES[i - 1]),
  'milestones are strictly ascending');
eq(MILESTONES[MILESTONES.length - 1], DEX_SIZE,
  'the last milestone is the whole dex');
is(nextMilestone(0), MILESTONES[0], 'a fresh dex points at the first milestone');
is(nextMilestone(DEX_SIZE), null, 'a finished dex has no next milestone');
ok(/STORAGE_KEY = 'pokemon-algorithm:dex:v1'/.test(collection),
  'the storage key is versioned, so a shape change cannot read an old map');
ok(/typeof localStorage === 'undefined'|try \{/.test(collection),
  'a browser without storage degrades instead of throwing');

console.log('\n--- the stylesheet owns the seam ---');
ok(/height: 175vh;/.test(rule('.hx-hero') || ''),
  'the hero track is 175vh in CSS',
  `home-hero.js says ${HOME_HERO_TRACK_VH}`);
eq(Number(/height:\s*(\d+)vh/.exec(rule('.hx-hero') || '')?.[1]), HOME_HERO_TRACK_VH,
  'the stylesheet and HOME_HERO_TRACK_VH state the same track height',
  'a mismatch stops the scrub before the end of the clip and looks correct');
ok(/\.hx-hero \{ height: 100dvh; \}/.test(cssCode),
  'reduced motion collapses the track to one screen, so there is nothing to scrub');
ok(/--hx-bg: #0b1020;/.test(cssCode),
  'the page ground is the clip\'s baked background');
eq(/--hx-bg: (#[0-9a-f]{6});/.exec(cssCode)?.[1], SITE_THEME.dark,
  'that ground is the shared dark background token, not a fourth colour',
  'a hand-picked near-black would seam against the clip and against shared.css');
ok(/\.hx-toast\[hidden\] \{ display: none; \}/.test(cssCode),
  'an author display cannot beat [hidden] on the toast (§3.M)');
ok(/@media \(max-width: 760px\) \{ \.hx-hero-scroll-hint \{ display: none; \} \}/.test(cssCode),
  'the scroll hint is dropped where the counter already reaches the edge');
ok(/@media \(hover: hover\)/.test(cssCode),
  'hover effects are gated on a device that has hover');

console.log('\n--- the hero\'s day wraps in both directions ---');
{
  /* The epoch is in the FUTURE relative to when this shipped, so every date
   * before it exercises the negative modulo. JS `%` keeps the dividend's sign,
   * so -2 % 9 is -2 and indexing a nine-clip array with it reads off the end
   * and renders as generation 1 with nothing logged. */
  const days = [];
  for (let y = 2020; y <= 2030; y += 1) {
    for (const key of [`${y}-01-01`, `${y}-06-15`, `${y}-12-31`]) {
      days.push([key, heroGenForKey(key), dayOffset(key)]);
    }
  }
  ok(days.every(([, g]) => Number.isInteger(g) && g >= 1 && g <= 9),
    'every day in an eleven-year window names a generation 1-9',
    `bad keys: ${days.filter(([, g]) => !(Number.isInteger(g) && g >= 1 && g <= 9)).map(([k]) => k).join(', ')}`);
  eq(heroGenForKey(GEN_ONE_DATE), 1, 'the epoch is generation 1');
  eq(heroGenForKey('2026-10-17'), 9, 'the day before the epoch is generation 9, not 0');
  eq(heroGenForKey('2026-10-16'), 8, 'two days before the epoch is generation 8');
  eq(dayOffset(GEN_ONE_DATE), 0, 'the epoch is offset zero');
  ok(dayOffset('2026-10-16') < 0, 'a pre-epoch key has a negative offset');
  ok(heroGenFor(new Date('2026-10-18T12:00:00+08:00')) === heroGenForKey('2026-10-18'),
    'heroGenFor is heroGenForKey over taipeiDateKey, not a second implementation');
}
{
  const open = (css.match(/\/\*/g) || []).length;
  const close = (css.match(/\*\//g) || []).length;
  eq(close, open, 'every comment opener in home-lab.css has its closer');
}

console.log('\n--- the page is pinned dark, and the demos survive ---');
ok(/<script>document\.documentElement\.dataset\.theme = 'dark';<\/script>/.test(htmlCode),
  'the page writes the dark palette before first paint');
ok(!/localStorage/.test(htmlCode),
  'the pinned block does not write the reader\'s stored choice',
  'writing storage here would repaint every other page');
ok(/class="theme-toggle"[^>]*hidden/.test(htmlCode) && !/initThemeToggle/.test(htmlCode),
  'the toggle is hidden and never initialised');
ok(/<link rel="stylesheet" href="assets\/css\/home-lab\.css">/.test(htmlCode)
  && !/home-hero\.css/.test(htmlCode),
  'the page mounts the collection stylesheet and no longer links the retired hero sheet');
ok(!has('assets/css/home-hero.css'),
  'home-hero.css is gone from the tree',
  'a stylesheet nothing links is a second copy waiting to drift');
ok(/id="showcase-sort-stage"/.test(htmlCode) && /id="showcase-maze-stage"/.test(htmlCode)
  && /id="game-stage"/.test(htmlCode),
  'the two demos still mount their stages');
ok(/id="hx-daily-link"/.test(htmlCode) && /pokemonDetailUrl\(\{ names: \{ en \} \}\)/.test(labCode),
  'the daily card\'s dossier link comes from pokemonDetailUrl(), not a hand-built URL (§3.A)');
ok(/assets\/images\/sprite\/\$\{id\}\.png/.test(labCode)
  && /assets\/images\/pokemon\/\$\{filename\}/.test(labCode),
  'the wall draws sprites and the daily card draws official artwork, each from its own set');

console.log('\n--- the footer and the version slot ---');
ok(/class="home-footer[\s"]/.test(htmlCode),
  'the footer keeps the shared component class first, so check_nav_pages still finds it');
ok(/<div class="home-footer-grid" data-footer-nav><\/div>/.test(htmlCode),
  'the footer grid exists with the class initFooterNav() fills',
  'initFooterNav() writes the columns, but the grid styles hang on the class');
eq((htmlCode.match(/data-version/g) || []).length, 1,
  'exactly one version slot, which check_version.mjs fills');
ok(/<section class="hx-section" id="dex"/.test(htmlCode)
  && /<section class="hx-section" id="today"/.test(htmlCode)
  && /<section class="hx-section" id="lab"/.test(htmlCode),
  'the three collection sections keep their ids and their shared shell class');

process.exit(report());
