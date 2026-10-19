/**
 * Negative tests for check_color_daily.mjs — the checker must FAIL, and name
 * the right reason, for every invariant it claims to police.
 *
 *   node scripts/test_check_color_daily.mjs
 *
 * WHY THIS FILE EXISTS. Half of check_color_daily.mjs is arithmetic, and
 * arithmetic is the easiest kind of check to write so that it is green for the
 * wrong reason. A 4σ parity gate that measures the wrong bucket passes forever;
 * a reachability gate that searches the pools for the drawn id credits 熱門
 * (popular) with four Pokémon that were actually drawn as 600族
 * (pseudo-legendary), and reports a fake 8σ skew. Both bugs existed in the
 * checker's first draft and both printed plausible FAIL lines — see the
 * "first pool" note below.
 *
 * Each case breaks ONE invariant in a scratch copy of the tree, runs the real
 * checker against it, and requires a non-zero exit AND a specific substring.
 * Asserting only the exit code would pass on a crash, which is how a typo
 * becomes a "passing" test.
 *
 * The checker also has to be shown to police the OPPOSITE direction: a case
 * that keeps the buckets but guts the reachability scoring, and a case that
 * makes every pick come from one bucket, both have to fail. Without them, a
 * checker that hardcodes `bucket = 'legendary'` would look fine.
 *
 * The harness runs from a temp tree, so a failed case cannot leave the working
 * tree modified.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy, failLines } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// `categories.js` imports `shiny-index.js`, which imports nothing, but the point
// stands: this checker imports the REAL module graph, so the scratch tree needs
// the whole graph rather than the three files that happen to be mutated. Listing
// dependencies by hand is how a test harness starts failing with ERR_MODULE_NOT_FOUND
// the next time someone adds an import.
const SRC = ['assets/data/pokemon_data.json', 'assets/data/color_palettes.json', 'today.html', 'color.html'];
const JS_DIR = 'assets/js';
const CHECKER = 'scripts/check_color_daily.mjs';

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

function makeTree(mutate) {
  const dir = trackTree(join(tmpdir(), `ccd-neg-${Math.random().toString(36).slice(2)}`));
  mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, JS_DIR), join(dir, JS_DIR), { recursive: true });
  mkdirSync(join(dir, 'assets/data'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of SRC) cpSync(join(ROOT, f), join(dir, f));
  cpSync(join(ROOT, CHECKER), join(dir, CHECKER));
  if (mutate) {
    for (const f of [...SRC, ...readdirSync(join(ROOT, JS_DIR)).map((n) => `${JS_DIR}/${n}`)]) {
      const p = join(dir, f);
      const before = readFileSync(p, 'utf8');
      // `undefined` means "this case does not target this file". A returned
      // string IDENTICAL to the input means a stale anchor, and the case would
      // then pass for the wrong reason — an error, not a no-op.
      const after = mutate(f, before);
      if (after === undefined) continue;
      if (after === before) {
        throw new Error(`mutation for ${f} did not change the file — the anchor string is stale, so this case would pass for the wrong reason`);
      }
      writeFileSync(p, after);
    }
  }
  return dir;
}

/* Async, and on process.execPath rather than whatever 'node' is first on PATH. */
const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

// Baseline first: if the unmutated copy does not pass, every case below would be
// measuring the harness rather than the checker.
{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  code === 0 ? pass('baseline: the checker passes on an unmutated copy of the tree')
             : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
  releaseTree(dir);
}

const cases = [
  {
    name: 'the fallback guards on !current alone, so a bogus ?slug is silently replaced',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('if (!current && !requested)', 'if (!current)')
      : undefined,
    expect: 'not guarded on whether an id was requested',
  },
  {
    name: '`requested` stops reading ?id, so a bogus ?id= falls through to the daily pick',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace("const requested = params.get('slug') || params.get('id');", "const requested = params.get('slug');")
      : undefined,
    expect: '`requested` ignores ?id',
  },
  {
    // Anchored on the RENDERED block, not the bare string: color.html's comment
    // above the fallback also says 找不到這個寶可夢, so a naive string replacement
    // edits the comment, leaves the markup intact, and the case passes while
    // policing nothing — which is the reason the check is anchored too.
    name: 'the not-found message is deleted from the rendered error block, so a bad link renders blank',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('<div class="cp-empty"><p>找不到這個寶可夢。</p>', '<div class="cp-empty"><p>出了問題</p>')
      : undefined,
    expect: 'not-found message was removed from the rendered error block',
  },
  {
    name: 'render() stops rewriting the URL, so the fallback pick is not shareable',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace(/history\.replaceState\(null, '', paletteUrl\(current\) \+ \(shiny \? '&variant=shiny' : ''\)\);/, '')
      : undefined,
    expect: 'no replaceState in color.html',
  },
  {
    name: 'the bucket draw is pinned to one category, so three buckets are unreachable',
    mutate: (f, s) => f.endsWith('daily-pick.js')
      ? s.replace("const bucket = DAILY_BUCKETS[Math.min(DAILY_BUCKETS.length - 1, Math.floor(rand() * DAILY_BUCKETS.length))];", "const bucket = 'legendary';")
      : undefined,
    expect: 'a flat pool or an unreachable bucket',
  },
  {
    name: 'a bucket is listed twice, silently doubling that pool\'s weight',
    mutate: (f, s) => f.endsWith('daily-pick.js')
      ? s.replace("export const DAILY_BUCKETS = ['popular', 'legendary', 'mythical', 'pseudo-legendary'];", "export const DAILY_BUCKETS = ['legendary', 'legendary', 'popular', 'mythical'];")
      : undefined,
    expect: 'DAILY_BUCKETS has a duplicate',
  },
  {
    name: 'the day key reads the UTC date, so the draw rolls over at 08:00 Taipei',
    mutate: (f, s) => f.endsWith('daily-pick.js')
      ? s.replace('return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);', 'return now.toISOString().slice(0, 10);')
      : undefined,
    expect: 'the seed is reading the clock, not the date',
  },
  {
    name: 'the day key ignores the clock entirely and keys to the month, so a whole month shares one pick',
    mutate: (f, s) => f.endsWith('daily-pick.js')
      ? s.replace("return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);", "return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);")
      : undefined,
    expect: 'the sample instants span',
  },
  {
    name: 'the PRNG is replaced by Math.random, so the pick changes on every reload',
    mutate: (f, s) => f.endsWith('daily-pick.js')
      ? s.replace('const rand = mulberry32(fnv1a(DAILY_SEED + taipeiDateKey(now)));', 'const rand = Math.random;')
      : undefined,
    expect: 'the seed is reading the clock, not the date',
  },
  {
    // The regression that shipped once already: a per-page seed prefix put
    // 今日推薦 (today's pick) = 班基拉斯 (Tyranitar) on the homepage and
    // 厄鬼椪 (Ogerpon) on the colour page, on 98.1% of days, with nothing on
    // screen explaining the switch. Reinstated here the way it was written, so
    // this stays a behavioural failure rather than a static one.
    name: 'color.html regains its own seed prefix, so the two pages feature different Pokémon',
    mutate: (f, s) => f.endsWith('daily-pick.js')
      ? s
        .replace('export const DAILY_SEED =', "export const DAILY_SEEDS = { index: 'pokemon-daily:', color: 'pokemon-color-daily:' };\nexport const DAILY_SEED =")
        .replace('export function drawDaily(data, { now = new Date() } = {}) {', "export function drawDaily(data, { stream = 'index', now = new Date() } = {}) {")
        .replace('mulberry32(fnv1a(DAILY_SEED + taipeiDateKey(now)))', 'mulberry32(fnv1a(DAILY_SEEDS[stream] + taipeiDateKey(now)))')
      : f.endsWith('color.html')
        ? s.replace('current = pickDailyPokemon(pokemon);', "current = pickDailyPokemon(pokemon, { stream: 'color' });")
        : undefined,
    expect: 'the two pages disagree',
  },
  {
    // A per-page date is the same bug without a seed: pinned to a constant, the
    // colour page stops being "today" while the homepage's card keeps advancing.
    name: 'color.html pins its own date, so the colour page stops being today',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('current = pickDailyPokemon(pokemon);', "current = pickDailyPokemon(pokemon, { now: new Date('2026-01-01') });")
      : undefined,
    expect: 'the two pages disagree',
  },
  {
    name: 'color.html keeps a private copy of the draw instead of importing the module',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace("import { pickDailyPokemon } from './assets/js/daily-pick.js';", 'const pickDailyPokemon = (d) => d[0];')
      : undefined,
    expect: 'does not import daily-pick.js',
  },
  {
    name: 'color.html redefines the PRNG, so its date key and the module\'s can drift apart',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('function syncFormatInputs(newFormat) {', 'function mulberry32(seed) { return Math.random; }\n\n    function syncFormatInputs(newFormat) {')
      : undefined,
    expect: 'redefines a seed helper',
  },
  {
    name: 'color.html redefines the bucket list, so its pools can disagree with the module',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('function syncFormatInputs(newFormat) {', "const DAILY_BUCKETS = ['legendary'];\n\n    function syncFormatInputs(newFormat) {")
      : undefined,
    expect: 'redefines DAILY_BUCKETS',
  },
  {
    name: 'today.html transcribes its own 熱門 (popular) list, so 今日推薦 (today\'s pick) can feature an unlisted Pokémon',
    mutate: (f, s) => f.endsWith('today.html')
      ? s.replace('const POPULAR_IDS = DAILY_POPULAR_IDS;', 'const POPULAR_IDS = [1, 2, 3];')
      : undefined,
    expect: 'keeps its own 熱門 (popular) id list',
  },
  {
    name: 'the 傳說 (legendary) pool comes back empty, so the draw would render a broken page',
    mutate: (f, s) => f.endsWith('categories.js')
      ? s.replace('const speciesFlags = (key) => (data) => data.filter((p) => p[key]);', 'const speciesFlags = (key) => (data) => (key === \'is_legendary\' ? [] : data.filter((p) => p[key]));')
      : undefined,
    expect: 'is empty',
  },
];

console.log(`\n${cases.length} negative cases, each must exit non-zero AND name its reason\n`);

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs for why the
 * order is part of the contract rather than an accident of scheduling. Each case is
 * its own `node` process against its own temp tree, so nothing here is shared. */
const verdicts = await pool(cases.map((c) => async () => {
  let dir;
  try {
    dir = makeTree(c.mutate);
  } catch (e) {
    return { name: c.name, detail: `harness: ${e.message}` };
  }
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    releaseTree(dir);
  }
  if (code === 0) return { name: c.name, detail: 'checker exited 0 — the invariant is not actually policed' };
  if (!caughtBy(out, c.expect)) {
    return { name: c.name, detail: `exited ${code} but no FAIL line reported "${c.expect}"; it said:\n${failLines(out).map((l) => `      ${l.trim()}`).join('\n') || '      (no FAIL line at all)'}` };
  }
  return { name: c.name, detail: '' };
}));

for (const v of verdicts) v.detail ? fail(`${v.name}\n    ${v.detail}`) : pass(v.name);

console.log();
if (failures) {
  console.log(`${failures} of ${cases.length} negative case(s) did not hold`);
  process.exit(1);
}
console.log(`all ${cases.length} negative cases held: each broke the checker with the right reason`);