#!/usr/bin/env node
/**
 * Prove that check_home_lab.mjs can actually fail, one deliberate defect at a
 * time.
 *
 * Run: node scripts/test_check_home_lab.mjs
 *
 * WHAT IS BEING ATTACKED
 * ----------------------
 * Every claim on the homepage is one that still renders when it breaks. The
 * daily draw can drift from today.html's and show a different species; the wall
 * can read the selected id out of the panel's rendered text; the page can fall
 * back to the 2.8 MB table; the CSS track can stop agreeing with the module; a
 * capture rate of 0 can quietly become 45. None of those throw, and none of them
 * look wrong in a screenshot — which is why each case below targets an assertion
 * that names the mechanism rather than the markup.
 *
 * EVERY CASE NAMES THE ASSERTION THAT CATCHES IT, and `replaceOrThrow` refuses
 * to be silent: a mutation that cannot be applied prints exactly what a mutation
 * the assertion survives prints, so only noticing the difference makes it a
 * measurement (§3.W).
 *
 * There are 23 cases plus one baseline. The baseline is not a mutation — it
 * carries `expect: null` — and the count in this header is the mutations only,
 * which is what check_all.mjs's retired-harness audit reads.
 */

import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy } from './lib/negative.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_home_lab.mjs';

/** Everything the checker reads.
 *
 *  `assets/js` and `scripts/lib` are copied whole because the checker IMPORTS
 *  from both: a hand-written file list breaks with ERR_MODULE_NOT_FOUND the
 *  moment a module gains an import, and the directory is cheaper than a list
 *  that has to be re-derived.
 *
 *  `pokemon_data.json` cannot be a placeholder: the identity case runs
 *  `pickDailyPokemon()` over it and the name case reads every row, so a stub
 *  would fail in every tree on the parse rather than on the assertion. It is
 *  2.8 MB per tree, which is the price of testing the real draw. */
const SRC = [
  CHECKER,
  'scripts/lib',
  'assets/js',
  'assets/css/home-lab.css',
  'index.html',
  'assets/data/home_dex.json',
  'assets/data/home_daily.json',
  'assets/data/pokemon_data.json',
];

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

/** A `replace` that throws rather than silently doing nothing. */
const replaceOrThrow = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutation target not found: ${JSON.stringify(from.slice(0, 70))}`);
  const out = src.replace(from, to);
  if (out === src) throw new Error(`mutation replaced nothing: ${JSON.stringify(from.slice(0, 70))}`);
  return out;
};

/** Edit one file in a tree and insist it changed. */
const edit = (dir, file, fn) => {
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`the mutation on ${file} changed nothing`);
  writeFileSync(p, after);
};

function makeTree(mutate) {
  /* Registered with the shared registry: a `finally` does not run when the
   * process is terminated from outside, and an interrupted run would otherwise
   * leave one 3 MB tree per in-flight case (§3.J). */
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'hl-neg-')));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  }
  if (mutate) mutate(dir);
  return dir;
}

/* process.execPath, not `node` from PATH: a baseline and its mutations have to
 * run the same interpreter to be comparable (§3.G7). stderr is PIPED so a
 * failing child's report does not reach the parent. */
const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8', cwd: dir },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

const CASES = [
  {
    name: 'baseline: the unmutated tree passes every check',
    mutate: null,
    expect: null,
    baseline: true,
  },

  {
    /* The one identity on the page: the homepage and 今日推薦 must name the same
     * species. A random draw answers every single-load question correctly. */
    name: 'the daily draw uses Math.random instead of the shared generator',
    mutate: (dir) => edit(dir, 'assets/js/home-daily-draw.js', (s) => replaceOrThrow(s,
      'const rand = mulberry32(fnv1a(DAILY_SEED + taipeiDateKey(now)));',
      'const rand = Math.random;')),
    expect: 'no Math.random',
  },

  {
    /* A second seed string that happens to be identical today, so the drift is
     * invisible until one side changes. */
    name: 'the draw re-derives the seed string instead of importing it',
    mutate: (dir) => edit(dir, 'assets/js/home-daily-draw.js', (s) => replaceOrThrow(
      replaceOrThrow(s,
        "import { DAILY_BUCKETS, DAILY_SEED, fnv1a, mulberry32, taipeiDateKey } from './daily-pick.js';",
        "import { DAILY_BUCKETS, fnv1a, mulberry32, taipeiDateKey } from './daily-pick.js';"),
      'DAILY_SEED + taipeiDateKey(now)',
      "'pokemon-daily:' + taipeiDateKey(now)")),
    expect: 'imports the seed, hash, generator and date key',
  },

  {
    /* Order is part of the pool: the same seed over a reordered array is a
     * different species on every day that lands in it. */
    name: 'the popular pool is reordered, so the seed draws a different species',
    mutate: (dir) => edit(dir, 'assets/data/home_daily.json', (s) => {
      const t = JSON.parse(s);
      t.buckets.popular.reverse();
      return JSON.stringify(t);
    }),
    expect: 'the popular pool is POPULAR_IDS in its own order',
  },

  {
    /* An id in a pool with no record: the card renders an empty shell rather
     * than throwing, so nothing else notices. */
    name: 'a pooled id has no record to render',
    mutate: (dir) => edit(dir, 'assets/data/home_daily.json', (s) => {
      const t = JSON.parse(s);
      delete t.p[t.buckets.popular[0]];
      return JSON.stringify(t);
    }),
    expect: 'every pooled id has a record to render',
  },

  {
    /* §3.G's shape: the id is recovered from rendered text, so an ellipsis or a
     * format change throws at species 0 — and the first click is on a panel that
     * says "—". */
    name: 'the throw reads the species number back out of the DOM',
    mutate: (dir) => edit(dir, 'assets/js/home-lab.js', (s) => replaceOrThrow(s,
      'if (selectedId) wall.attempt(selectedId);',
      'if (selectedId) wall.attempt(Number(info.no.textContent.replace(\'#\', \'\')) || selectedId);')),
    expect: 'does not read the species number back out of the DOM',
  },

  {
    /* §3.AA's `power: 0` lesson, pointed at a capture rate: `|| 45` treats a real
     * 0 as an absent value. The roster has no 0 today, which is why the bug would
     * survive a data change. */
    name: 'a capture rate of 0 is treated as a missing rate',
    mutate: (dir) => edit(dir, 'assets/js/home-dex-wall.js', (s) => replaceOrThrow(s,
      'const r = Math.max(0, Math.min(255, Number.isFinite(n) ? n : 45));',
      'const r = Math.max(0, Math.min(255, Number(rate) || 45));')),
    expect: 'a capture rate of 0 maps to the 0.3 floor',
  },

  {
    /* The number left in the module after the stylesheet moved: the scrub stops
     * at 0.7 of the clip and every other check passes. */
    name: 'the module divides against 240 while the track is 175vh',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'const TRACK_VH = 175;', 'const TRACK_VH = 240;')),
    expect: 'state the same track height',
  },

  {
    /* A near-black one hex digit off the clip ground: the seam the redesign
     * removed comes back at 1px of colour difference, which no contrast check
     * sees. */
    name: 'the page ground is a hand-picked near-black, not the shared token',
    mutate: (dir) => edit(dir, 'assets/css/home-lab.css', (s) => replaceOrThrow(s,
      '--hx-bg: #0b1020;', '--hx-bg: #0b1021;')),
    expect: 'the shared dark background token',
  },

  {
    /* The retired stylesheet comes back in the link tag: the hero renders, and
     * the two sheets fight over the same selectors. */
    name: 'the page links the retired hero stylesheet again',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'href="assets/css/home-lab.css"', 'href="assets/css/home-hero.css"')),
    expect: 'mounts the collection stylesheet',
  },

  {
    /* A stylesheet nothing links is a second copy of every rule, waiting to be
     * edited by mistake. */
    name: 'home-hero.css is left on disk after nothing links it',
    mutate: (dir) => writeFileSync(join(dir, 'assets/css/home-hero.css'), '/* retired */\n'),
    expect: 'home-hero.css is gone from the tree',
  },

  {
    /* Writing storage here repaints every OTHER page to dark, which is exactly
     * what the reader's stored choice exists to prevent (§3.G6, one layer out). */
    name: 'the pinned block writes the reader\'s stored theme choice',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      "<script>document.documentElement.dataset.theme = 'dark';</script>",
      "<script>localStorage.setItem('pokemon-theme', 'dark');document.documentElement.dataset.theme = 'dark';</script>")),
    expect: 'does not write the reader',
  },

  {
    /* §3.W: the button is in the markup and hidden, so nothing paints — but the
     * moment it is initialised it grows icons in a box the stylesheet hides. */
    name: 'the hidden toggle is initialised anyway',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'initHeaderNav();', 'initHeaderNav();\n    initThemeToggle();')),
    expect: 'the toggle is hidden and never initialised',
  },

  {
    /* A loss awards the terrain Pokémon. The reward line renders, the counter
     * moves, and the player learns the game is not a game. */
    name: 'losing the maze still awards the catch',
    mutate: (dir) => edit(dir, 'assets/js/home-lab.js', (s) => replaceOrThrow(s,
      'if (!won || !Number.isInteger(id)) return;',
      'if (!Number.isInteger(id)) return;')),
    expect: 'a loss and a malformed id are both ignored',
  },

  {
    /* Loading the daily card on load spends 18 KB on a section most readers
     * never reach, and the observer no longer disconnects. */
    name: 'the daily card is fetched on load instead of near the viewport',
    mutate: (dir) => edit(dir, 'assets/js/home-lab.js', (s) => replaceOrThrow(s,
      "{ rootMargin: '300px 0px' }", "{ rootMargin: '0px' }")),
    expect: 'loads 300px before it is reached',
  },

  {
    /* The 2.8 MB table comes back through the wall's own fetch: every other
     * assertion passes, because the shape it reads is a subset. */
    name: 'the wall falls back to the full pokemon_data.json',
    mutate: (dir) => edit(dir, 'assets/js/home-lab.js', (s) => replaceOrThrow(s,
      "fetch('assets/data/home_dex.json')", "fetch('assets/data/pokemon_data.json')")),
    expect: 'names pokemon_data.json',
  },

  {
    /* §3.G2's shape: the class is there, in the wrong order, and the shared
     * component's rules stop applying while check_nav_pages still finds the
     * page. */
    name: 'the footer\'s shared class is no longer first',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'class="home-footer hx-foot"', 'class="hx-foot home-footer"')),
    expect: 'keeps the shared component class first',
  },

  {
    /* Two version slots: check_version fills both and one of them goes stale on
     * the next release. */
    name: 'the footer carries two version slots',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      '<span data-version></span>', '<span data-version></span><span data-version></span>')),
    expect: 'exactly one version slot',
  },

  {
    /* Below 20px the wall is a texture: every cell renders, the layout is
     * correct, and nothing is tappable. */
    name: 'the tappable floor drops to 12px',
    mutate: (dir) => edit(dir, 'assets/js/home-dex-wall.js', (s) => replaceOrThrow(s,
      'const MIN_CELL = 20;', 'const MIN_CELL = 12;')),
    expect: 'floored at a tappable 20px',
  },

  {
    /* The refit no longer floors, so a narrow window shrinks the wall instead of
     * scrolling it — and the first fit still passes. */
    name: 'the refit drops its own floor',
    mutate: (dir) => edit(dir, 'assets/js/home-dex-wall.js', (s) => replaceOrThrow(s,
      'cell = Math.max(MIN_CELL, Math.min(MAX_CELL, cell));',
      'cell = Math.min(MAX_CELL, cell);')),
    expect: 'both the fit and the refit floor the cell',
  },

  {
    /* Today's band becomes lighter than an ordinary caught cell: the mission is
     * no longer visible, and the wall still paints. */
    name: 'today\'s band is tinted lighter than a caught cell',
    mutate: (dir) => edit(dir, 'assets/js/home-dex-wall.js', (s) => replaceOrThrow(s,
      'const TINT = 0.42;', 'const TINT = 0.58;')),
    expect: 'a caught cell is tinted harder than an empty one',
  },

  {
    /* §3.X's shape where the suite lacked it: the module reads an id the page
     * does not have, and `$()` returns null at the first catch rather than at
     * load. */
    name: 'an id the module reads is renamed on the page',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'id="hx-daily-name"', 'id="hx-daily-title"')),
    expect: 'ids home-lab.js reads exist',
  },

  {
    /* A milestone list that no longer ends at the roster: the final toast never
     * fires and `nextMilestone()` returns a number nobody can reach. */
    name: 'the last milestone is not the whole dex',
    mutate: (dir) => edit(dir, 'assets/js/dex-collection.js', (s) => replaceOrThrow(s,
      'export const MILESTONES = [10, 50, 151, 500, 1025];',
      'export const MILESTONES = [10, 50, 151, 500, 1000];')),
    expect: 'the last milestone is the whole dex',
  },

  {
    /* An unversioned key: the next shape change reads an old map and renders
     * 1,025 cells from ids that mean something else. */
    name: 'the storage key loses its version',
    mutate: (dir) => edit(dir, 'assets/js/dex-collection.js', (s) => replaceOrThrow(s,
      "export const STORAGE_KEY = 'pokemon-algorithm:dex:v1';",
      "export const STORAGE_KEY = 'pokemon-algorithm:dex';")),
    expect: 'the storage key is versioned',
  },
];

/* Pooled, three at a time: every case is an independent child process over its
 * own tree and shares nothing, which is §3.G7's precondition. Results print in
 * declaration order, NOT completion order. */
console.log(`\n--- ${CASES.length} negative cases against check_home_lab.mjs ---`);
const results = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  try {
    const { code, out } = await run(dir);
    /* `out` and `code` are carried on the BASELINE result too, so the failure
     * branch below can print the explanation instead of crashing on `out.split`. */
    return { c, pass: c.baseline ? code === 0 : code !== 0 && caughtBy(out, c.expect), code, out };
  } finally {
    releaseTree(dir);
  }
}));

for (const { c, pass: good, code, out } of results) {
  if (good) { pass(c.name); continue; }
  if (c.baseline) {
    fail(`${c.name}\n      the unmutated tree did not pass — every case below would be measuring nothing\n${out.split('\n').slice(-8).join('\n')}`);
    continue;
  }
  const reported = out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 4).join('\n');
  fail(`${c.name}\n      exit ${code}, expected a failure reporting "${c.expect}"\n${reported}`);
}

const held = results.filter((r) => r.pass).length;
if (failures) {
  console.log(`\n${failures} of ${CASES.length} negative case(s) did not hold`);
  process.exit(1);
}
console.log(`\nall ${held} negative cases held: each broke the checker with the right reason`);
