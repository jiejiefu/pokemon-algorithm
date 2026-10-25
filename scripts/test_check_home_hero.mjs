#!/usr/bin/env node
/**
 * Prove that check_home_hero.mjs can actually fail, one deliberate defect at a
 * time.
 *
 * Run: node scripts/test_check_home_hero.mjs
 *
 * WHAT IS BEING ATTACKED
 * ----------------------
 * The hero's claims are arithmetic, not markup: progress is
 * `-rect.top / (rect.height - innerHeight)`, the day's generation is a signed
 * day offset wrapped into 1-9, and the poster frame is a fraction of a 10s clip.
 * Each can be wrong in a way that still renders. Dropping `- innerHeight` stops
 * the clip at 58% while the hero looks identical; wrapping one way only makes
 * every date before the epoch read off the end of an array and return
 * `undefined`, which is generation 1 with no error anywhere.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No case for `check_home_hero_browser.mjs`, which boots Chrome. The mutations
 * live here, against the half readable off disk.
 *
 * EVERY CASE NAMES THE ASSERTION THAT CATCHES IT, and `replaceOrThrow` refuses
 * to be silent: a mutation that cannot be applied otherwise prints exactly what
 * a mutation the assertion survives prints, so only noticing the difference
 * makes it a measurement (§3.W).
 *
 * There are 25 cases plus one baseline. The baseline is not a mutation — it
 * carries `expect: null` — and the count the header claims is the mutations only,
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
const CHECKER = 'scripts/check_home_hero.mjs';

/** Everything the checker reads. The two modules are copied whole because the
 *  checker IMPORTS them, which is why it can run the date maths instead of
 *  regexing it. */
const SRC = [
  CHECKER, 'scripts/make_hero_video.py',
  'index.html', 'today.html',
  'assets/css/home-hero.css',
  'assets/data/pokemon_data.json',
  // The whole module DIRECTORY, not three files: hero-gen.js imports
  // daily-pick.js, which imports categories.js, and so on. Listing a subset
  // produces ERR_MODULE_NOT_FOUND on the baseline. The directory is 2.4MB,
  // cheaper than a list that must be re-derived whenever a module gains an
  // import.
  'assets/js',
];

/** Zero-byte stand-ins for the clips and stills.
 *
 *  The checker reads them only to answer "does this path exist", and 19 cases x
 *  13MB of real video is 247MB of transient IO spent on a filename. The baseline
 *  case proves a tree of placeholders is otherwise sound: if existence were ever
 *  checked by CONTENT rather than by name, the baseline would go red rather than
 *  every case passing for the wrong reason. */
const ASSET_PLACEHOLDERS = [
  ...Array.from({ length: 9 }, (_, i) => `assets/video/hero-gen${i + 1}.mp4`),
  ...Array.from({ length: 9 }, (_, i) => `assets/video/poster-gen${i + 1}.jpg`),
];

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

/** A `replace` that throws rather than silently doing nothing. See the header. */
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
  /* Registered with the shared registry rather than created bare. A `finally`
   * does not run when the process is terminated from outside, so an interrupted
   * run would leave one tree per in-flight case; trackTree() installs the exit
   * and SIGINT/SIGTERM hooks that cover it (§3.J). */
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'hh-neg-')));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  }
  for (const f of ASSET_PLACEHOLDERS) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), '');
  }
  if (mutate) mutate(dir);
  return dir;
}

/* process.execPath, not `node` from PATH: a baseline and its mutations have to
 * run the same interpreter to be comparable (§3.G7). stderr is PIPED, not
 * inherited, so a failing child's report does not reach the parent and
 * caughtBy() can rely on it. */
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
    /* The load-bearing term. Without it the denominator is the whole 240vh
     * track, so progress tops out at 1 - 1/2.4 = 0.583 and the clip stops two
     * thirds of the way through while the hero looks correct. */
    name: 'the scrub range drops - innerHeight, so the clip stops at 58%',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'const range = rect.height - window.innerHeight;',
      'const range = rect.height;')),
    expect: 'the range subtracts innerHeight',
  },

  {
    /* The mirror: a hero that does nothing at all rather than one that stops
     * early. */
    name: 'progress is measured from the top of the track instead of how far through it the reader is',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'return Math.min(1, Math.max(0, -rect.top / range));',
      'return Math.min(1, Math.max(0, rect.top / range));')),
    expect: 'progress divides -rect.top by range',
  },

  {
    /* Autoplay satisfies every other assertion here — the poster is set, the
     * module imports nothing, the track is still 240vh — and a clip that plays
     * itself cannot be scrubbed at all: scroll up and it keeps going forward. */
    name: 'the hero autoplays the clip instead of scrubbing it',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'if (Math.abs(video.currentTime - t) > MIN_SEEK_DELTA) video.currentTime = t;',
      'if (video.paused) video.play();')),
    expect: 'nothing calls play()',
  },

  {
    /* Reduced motion promises stillness, and honouring it only in CSS still
     * animates the clip. */
    name: 'a typo in the reduced-motion media query, so nothing is ever reduced',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      "const REDUCE_MOTION_MQ = '(prefers-reduced-motion: reduce)';",
      "const REDUCE_MOTION_MQ = '(prefers-reduced-motion)';")),
    expect: 'the media query is spelled identically in the stylesheet and the module',
  },

  {
    /* The freeze at frame 0 instead of the poster frame is a still frame of an
     * empty background that looks like a working hero. The browser checker
     * catches the visible half; only this runs over ten years of dates in
     * 0.2s. */
    name: 'the reduced-motion freeze lands on frame 0 instead of the poster frame',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'const POSTER_FRACTION = 0.65;',
      'const POSTER_FRACTION = 0;')),
    expect: 'POSTER_FRACTION is',
  },

  {
    /* JS `%` keeps the dividend's sign, so -2 % 9 is -2 and indexing with it
     * reads off the array as `undefined` — generation 1 with nothing logged, for
     * every date before the epoch. */
    name: 'the day offset wraps forwards only, so every date before the epoch is generation 1',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      'return Math.round(((offset % GENERATION_COUNT) + GENERATION_COUNT) % GENERATION_COUNT) + 1;',
      'return Math.round(offset % GENERATION_COUNT) + 1;')),
    expect: 'the day before the epoch is the last generation',
  },

  {
    /* A tenth generation. Every range check still passes; only the ring count
     * and the asset sweep notice. */
    name: 'the ring has ten slots, so a generation has no clip to play',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      'export const GENERATION_COUNT = 9;',
      'export const GENERATION_COUNT = 10;')),
    expect: 'nine days on, the ring is complete and the epoch returns',
  },

  {
    /* `Date.now() % 9` redraws the hero twice a day, unrelated to the date a
     * reader is on, yet answers every single-call question correctly — which is
     * why the check takes two clocks. */
    name: 'the generation is a modulo of the clock rather than of the date',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      'export function heroGenFor(now = new Date()) {\n  return heroGenForKey(taipeiDateKey(now));\n}',
      'export function heroGenFor(now = new Date()) {\n  return Math.floor(now.getTime() / 86400000) % GENERATION_COUNT + 1;\n}')),
    expect: '01:00 Taipei on the 18th is generation 1',
  },

  {
    /* A second date key, computed differently, so the hero and 今日推薦 can
     * disagree about what day it is (§3.S). */
    name: 'hero-gen computes its own UTC date key instead of importing Taipei\'s',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      '  return heroGenForKey(taipeiDateKey(now));',
      '  return heroGenForKey(now.toISOString().slice(0, 10));')),
    expect: '16:30 UTC on the 17th is already the 18th in Taipei',
  },

  {
    /* A poster from another day is a flash of one roster and a scrub of
     * another, and nothing above it notices: the src still names a real clip. */
    name: 'the poster is pinned to generation 1 whatever the day is',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'video.poster = heroPosterUrl(gen);',
      'video.poster = heroPosterUrl(1);')),
    expect: "index.html sets the video's poster from the day's generation",
  },

  {
    /* The number 240 left in the stylesheet after the module's constant moved.
     * The scrub stops at a fraction of the clip and only this assertion
     * notices. */
    name: 'the track is 200vh while the module divides against 240',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'height: 240vh;',
      'height: 200vh;')),
    expect: 'the CSS track is',
  },

  {
    /* dvh to vh: on a phone browser 100vh sits under the address-bar chrome, so
     * the bottom of the hero is clipped. Invisible at every desktop width. */
    name: 'the sticky layer uses vh instead of dvh',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'height: 100dvh;\n  overflow: hidden;',
      'height: 100vh;\n  overflow: hidden;')),
    expect: 'the sticky layer is 100dvh, not 100vh',
  },

  {
    /* §3.W: the button is in the markup, every header check passes, and nothing
     * paints because initThemeToggle() injects the two icons. */
    name: 'the theme toggle is in the markup but nothing mounts it',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'initThemeToggle();\n', '')),
    expect: 'initThemeToggle() is called on its own statement',
  },

  {
    /* The caption goes stale and nothing else in the suite sees it: 1,025 is a
     * claim about pokemon_data.json and 6 about sorting-algorithms.js, both read
     * by this checker for no other reason. */
    name: 'the hero claims 1,025 species while the roster holds 1,026',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      '>1,025</span>', '>1,026</span>')),
    expect: "the 1,025 in the counts is pokemon_data.json's own length",
  },

  {
    /* The mutation for §3.P's finding. The panel used to carry the lede, the
     * generation line and the three counts, and the check that policed that read
     * `home-hero-stats` out of the STYLESHEET — so putting an element back in the
     * panel changed nothing it could see. This targets the assertion that now
     * reads nesting instead of a stylesheet string.
     *
     * The block ends on `\n {8}</div>` rather than the first `</div>`: the CTA
     * closes at ten spaces, so a lazier delimiter reports the CTA's children and
     * the assertion passes on a panel with a lede in it. */
    name: 'the generation line moves back onto the clip, inside the title card',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      '<h1 id="hero-title" class="home-hero-title">寶可夢演算法</h1>\n',
      '<h1 id="hero-title" class="home-hero-title">寶可夢演算法</h1>\n          <p class="home-hero-updated">已更新至第 9 世代 帕底亞</p>\n')),
    expect: 'the panel carries the title, the two ways out and the scroll hint — and nothing else',
  },

  {
    /* The other half of the same split, and the direction easier to reintroduce
     * by accident: someone tidying the moved block reaches for the panel's own
     * white. On --bg-primary in light theme #ffffff measures ~1.05:1 — three
     * counts that exist and are invisible, which no dark-theme screenshot can
     * answer. */
    name: 'the three counts go back to the panel\'s own white instead of a theme token',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'display: block; font-size: 26px; font-weight: bold; color: var(--text-primary);',
      'display: block; font-size: 26px; font-weight: bold; color: #ffffff;')),
    expect: 'the moved rules carry no panel literal',
  },

  {
    /* The separator above the three counts. A literal white at 14% over a white
     * page is no border, and nothing else notices its absence. */
    name: 'the rule above the counts is a literal white 14% again',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'border-top: 1px solid var(--hairline);\n  list-style: none;',
      'border-top: 1px solid rgba(255, 255, 255, 0.14);\n  list-style: none;')),
    expect: 'the rule above the three counts is --hairline',
  },

  {
    /* The moved block inherits `text-align: center` from `.home-hero-sticky`
     * today. Delete it and every rule still exists, nothing throws, and the
     * paragraph sits left-aligned — invisible to every other assertion and
     * obvious on the page. */
    name: 'the intro block loses the centering it used to inherit from the sticky layer',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'padding: 48px 20px 0;\n  text-align: center;',
      'padding: 48px 20px 0;')),
    expect: 'the intro block declares its own centering',
  },

  {
    /* The panel's alpha is the one number here whose failure mode is invisible in
     * the dark theme, and the rendered half is not a manifest entry, so nothing
     * that runs would catch a drop (§3.P, pointed at a colour).
     *
     * 0.65 is the first alpha under WCAG AA's 4.5:1 for the gold title; 0.4 puts
     * it at 1.67:1. Over a dark frame the title still reads as gold on a dark
     * wash, so a dark-theme screenshot answers nothing. The assertion derives the
     * bound from the two declarations rather than restating a magic number. */
    name: 'the hero panel is made transparent enough to lose the title',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'background: rgba(6, 9, 20, 0.7);',
      'background: rgba(6, 9, 20, 0.4);')),
    expect: 'against the WORST frame the clip can show',
  },

  {
    /* The blur radius is the other half of "can I see the Pokémon behind the
     * panel", and unlike the alpha it costs no contrast — so no contrast
     * assertion can police it. */
    name: 'the hero panel\'s blur is restored to 10px, hiding every sprite behind it',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'backdrop-filter: blur(3px);\n  -webkit-backdrop-filter: blur(3px);',
      'backdrop-filter: blur(10px);\n  -webkit-backdrop-filter: blur(10px);')),
    expect: 'the hero panel blurs at most 3px',
  },

  {
    /* An extra closing delimiter in home-hero.css ends the comment early,
     * the prose after it becomes live CSS, and the browser discards every rule to
     * the end of the block — so the hero renders unstyled while every other check
     * reads the text the browser already threw away.
     *
     * The assertion name deliberately avoids spelling the delimiters: a CSS
     * comment does not nest, so writing them here would end this comment too. */
    name: 'a comment in the hero stylesheet is closed one delimiter early',
    mutate: (dir) => edit(dir, 'assets/css/home-hero.css', (s) => replaceOrThrow(s,
      'levers and why both were pulled together.',
      'levers and why both were pulled together. */')),
    expect: 'has its closer',
  },

  {
    /* The moved sections come back. Two pages that link to each other each
     * carrying the same cards is duplication, and the footer check would pass. */
    name: 'index.html mounts the feature grid a second time, on today.html',
    mutate: (dir) => edit(dir, 'today.html', (s) => replaceOrThrow(s,
      '<main>', '<main>\n    <section class="feature-grid" aria-label="功能區塊"></section>')),
    expect: 'the feature grid is not on today.html as well',
  },

  {
    /* §3.X's shape where the suite lacked it: the mounted container stays EMPTY
     * and every header check reads the markup. */
    name: 'the site nav container is left empty, so the header renders with no nav at all',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'initHeaderNav();\n', '')),
    expect: 'initHeaderNav() is called',
  },

  {
    /* No src in the markup at all: the clip never loads and the hero is a dark
     * band, which is a rendering that looks deliberate. */
    name: 'the inline module never sets the clip\'s src',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'video.src = heroVideoUrl(gen);\n', '')),
    expect: 'poster is assigned before src',
  },

  {
    /* §3.B2's shape: a checker that cannot answer "did the clip play" is worse
     * than one that can. */
    name: 'the video has no id, so the module is asking for an element that is not there',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'id="home-hero-video"', 'id="hero-clip"')),
    expect: 'the video carries id="home-hero-video"',
  },
];

/* Pooled, three at a time: every case is an independent child process over its
 * own tree and shares nothing, which is §3.G7's precondition. Results print in
 * declaration order, NOT completion order — an output that follows the scheduler
 * cannot be diffed between two green runs. */
console.log(`\n--- ${CASES.length} negative cases against check_home_hero.mjs ---`);
const results = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  try {
    const { code, out } = await run(dir);
    /* `out` and `code` are carried on the BASELINE result too, so the failure
     * branch below can print the explanation instead of crashing on `out.split`.
     * A diagnostic that cannot run is the one diagnostic needed. */
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