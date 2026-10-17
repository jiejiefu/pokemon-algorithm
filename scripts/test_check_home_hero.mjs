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
 * Every one of those can be wrong in a way that still RENDERS — drop the
 * `- innerHeight` and the clip stops at 58% while the hero looks identical; wrap
 * one way only and every date before the epoch reads off the end of an array and
 * returns `undefined`, which is generation 1 with no error anywhere.
 *
 * That is why this harness exists. A checker whose failures are all "the tag is
 * missing" cannot tell a hero that scrubbed from 0 to 0.42 from one that scrubbed
 * from 0 to 1.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No case for `check_home_hero_browser.mjs`. It boots Chrome, and §3.X priced
 * that trade for the spectrum browser checker — four cases would cost about as
 * much as the whole of `test_check_spectrum_page.mjs` to prove a handful of
 * assertions can fail. The mutations for the hero live HERE, against the half
 * that is readable off disk; what is given up is named rather than glossed over.
 *
 * EVERY CASE NAMES THE ASSERTION THAT CATCHES IT, and `replaceOrThrow` refuses
 * to be silent. §3.W's finding: a mutation that cannot be applied prints exactly
 * what a mutation the assertion survives prints, and only the harness noticing
 * the difference makes it a measurement. Three harnesses refused to run during
 * this file's own bring-up because their anchors named files that had moved.
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
 *  checker IMPORTS them — which is the only reason it can run the date maths
 *  instead of regexing it, and a tree missing one of them would report an import
 *  error rather than a defect. */
const SRC = [
  CHECKER, 'scripts/make_hero_video.py',
  'index.html', 'today.html',
  'assets/data/pokemon_data.json',
  // The whole module DIRECTORY, not three files. hero-gen.js imports
  // daily-pick.js, which imports categories.js, which imports more; listing the
  // first three produced ERR_MODULE_NOT_FOUND on the baseline and every case
  // reported a failure for a reason that had nothing to do with the mutation.
  // The directory is 2.4MB, which is cheaper than maintaining a list that has
  // to be re-derived every time a module gains an import.
  'assets/js',
];

/** Zero-byte stand-ins for the clips and stills.
 *
 *  The checker reads them only to answer "does this path exist", and 19 cases x
 *  13MB of real video is 247MB of transient IO spent on a question about a
 *  filename. The baseline case is what proves a tree of placeholders is
 *  otherwise sound — if existence were ever checked by CONTENT rather than by
 *  name, the baseline would go red here and say so rather than every case
 *  passing for the wrong reason. */
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
  /* Registered with the shared registry rather than created bare. The first
   * version used a plain mkdtempSync and removed each tree in a `finally`, which
   * is the shape §3.J calls out by name — a `finally` does not run when the
   * process is terminated from outside, so an interrupted run leaves one tree per
   * in-flight case. trackTree() gives the registry the exit and SIGINT/SIGTERM
   * hooks that cover it. */
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
 * inherited, because execSync's default sends a failing child's report to the
 * PARENT's stderr and then no case can rely on caughtBy(). */
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
    /* THE load-bearing term. Without it the denominator is the whole 240vh
     * track, so progress tops out at 1 - 1/2.4 = 0.583: the clip scrubs
     * smoothly for two thirds and then stops, and the hero looks correct. */
    name: 'the scrub range drops - innerHeight, so the clip stops at 58%',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'const range = rect.height - window.innerHeight;',
      'const range = rect.height;')),
    expect: 'the range subtracts innerHeight',
  },

  {
    /* The mirror of it, and the one that shows up as a hero that does nothing
     * at all rather than as a hero that stops early. */
    name: 'progress is measured from the top of the track instead of how far through it the reader is',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'return Math.min(1, Math.max(0, -rect.top / range));',
      'return Math.min(1, Math.max(0, rect.top / range));')),
    expect: 'progress divides -rect.top by range',
  },

  {
    /* THE ONE THAT WAS WORTH WRITING THE CHECKER FOR. Autoplay satisfies every
     * other assertion in this file: the poster is still set, the module still
     * imports nothing, the track is still 240vh. And a clip that plays itself
     * cannot be scrubbed at all — scroll up and it keeps going forward. */
    name: 'the hero autoplays the clip instead of scrubbing it',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'if (Math.abs(video.currentTime - t) > MIN_SEEK_DELTA) video.currentTime = t;',
      'if (video.paused) video.play();')),
    expect: 'nothing calls play()',
  },

  {
    /* Reduced motion is the setting that promises stillness, and honouring it
     * only in CSS still animates the clip. */
    name: 'a typo in the reduced-motion media query, so nothing is ever reduced',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      "const REDUCE_MOTION_MQ = '(prefers-reduced-motion: reduce)';",
      "const REDUCE_MOTION_MQ = '(prefers-reduced-motion)';")),
    expect: 'the media query is spelled identically in the stylesheet and the module',
  },

  {
    /* The freeze at frame 0 instead of at the poster frame: a still frame of an
     * empty background, which looks like a working hero and is a dark rectangle.
     * The browser checker is what catches the visible half of this; what it
     * cannot do is run in 0.2s over ten years of dates. */
    name: 'the reduced-motion freeze lands on frame 0 instead of the poster frame',
    mutate: (dir) => edit(dir, 'assets/js/home-hero.js', (s) => replaceOrThrow(s,
      'const POSTER_FRACTION = 0.65;',
      'const POSTER_FRACTION = 0;')),
    expect: 'POSTER_FRACTION is 0.65',
  },

  {
    /* JS `%` keeps the dividend's sign, so -2 % 9 is -2 and indexing with it
     * reads off the end of the array — `undefined`, which renders as generation
     * 1 with nothing logged. Every date before the epoch, silently wrong. */
    name: 'the day offset wraps forwards only, so every date before the epoch is generation 1',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      'return Math.round(((offset % GENERATION_COUNT) + GENERATION_COUNT) % GENERATION_COUNT) + 1;',
      'return Math.round(offset % GENERATION_COUNT) + 1;')),
    expect: 'the day before the epoch is the last generation',
  },

  {
    /* A tenth generation. Every range check still passes; only the ring count
     * and the roster asset sweep notice. */
    name: 'the ring has ten slots, so a generation has no clip to play',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      'export const GENERATION_COUNT = 9;',
      'export const GENERATION_COUNT = 10;')),
    expect: 'nine days on, the ring is complete and the epoch returns',
  },

  {
    /* `Date.now() % 9` redraws the hero twice a day, on the hour, unrelated to
     * the date a reader is on. It answers every single-call question
     * correctly, which is why the check takes two clocks. */
    name: 'the generation is a modulo of the clock rather than of the date',
    mutate: (dir) => edit(dir, 'assets/js/hero-gen.js', (s) => replaceOrThrow(s,
      'export function heroGenFor(now = new Date()) {\n  return heroGenForKey(taipeiDateKey(now));\n}',
      'export function heroGenFor(now = new Date()) {\n  return Math.floor(now.getTime() / 86400000) % GENERATION_COUNT + 1;\n}')),
    expect: '01:00 Taipei on the 18th is generation 1',
  },

  {
    /* §3.S's shape at one remove: a second date key, computed differently, and
     * the hero and 今日推薦 can disagree about what day it is. */
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
    /* The number 240 written into the stylesheet and left alone after the
     * module's constant moved. The scrub silently stops at a fraction of the
     * clip and the assertion is the only thing that notices. */
    name: 'the track is 200vh while the module divides against 240',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'height: 240vh;',
      'height: 200vh;')),
    expect: 'the CSS track is 240vh',
  },

  {
    /* dvh to vh: on a phone browser 100vh sits under the address-bar chrome, so
     * the bottom of the hero — the scroll hint, which is the only route onward —
     * is clipped off the screen. Invisible at every desktop width. */
    name: 'the sticky layer uses vh instead of dvh',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'height: 100dvh;\n      overflow: hidden;',
      'height: 100vh;\n      overflow: hidden;')),
    expect: 'the sticky layer is 100dvh, not 100vh',
  },

  {
    /* §3.W: the button is in the markup, every header check passes, and nothing
     * paints because initThemeToggle() is what injects the two icons. */
    name: 'the theme toggle is in the markup but nothing mounts it',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'initThemeToggle();\n', '')),
    expect: 'initThemeToggle() is called on its own statement',
  },

  {
    /* The caption goes stale and nothing else in the suite can see it: 1,025 is
     * a claim about pokemon_data.json and 6 is a claim about
     * sorting-algorithms.js, and both files are read by this checker for no
     * other reason. */
    name: 'the hero claims 1,025 species while the roster holds 1,026',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      '>1,025</span>', '>1,026</span>')),
    expect: "the 1,025 in the counts is pokemon_data.json's own length",
  },

  {
    /* THE MUTATION FOR §3.P'S OWN FINDING. The panel used to carry the lede, the
     * generation line and the three counts, and the check that was supposed to
     * police that read `home-hero-stats` out of the STYLESHEET — so putting an
     * element back in the panel changed nothing it could see. This is that
     * mutation, and it is aimed at the one assertion that now reads nesting
     * instead of a stylesheet string.
     *
     * The block ends on `\n {8}</div>` rather than the first `</div>`: the CTA's
     * closes at ten spaces, so a lazier delimiter reports the CTA's children and
     * the assertion passes on a panel with a lede in it — §3.P's second vacuous
     * shape, written by the person who had just recorded it. */
    name: 'the generation line moves back onto the clip, inside the title card',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      '<h1 id="hero-title" class="home-hero-title">寶可夢演算法</h1>\n',
      '<h1 id="hero-title" class="home-hero-title">寶可夢演算法</h1>\n          <p class="home-hero-updated">已更新至第 9 世代 帕底亞</p>\n')),
    expect: 'the panel carries the title, the two ways out and the scroll hint — and nothing else',
  },

  {
    /* The other half of the same split, and the direction that is easier to
     * reintroduce by accident: someone tidying the moved block reaches for the
     * same white the panel uses, because it was the same colour two rules away
     * and every other theme-coloured block on the site uses tokens. On
     * --bg-primary in light theme #ffffff measures ~1.05:1 — three counts that
     * exist and are invisible, which no dark-theme screenshot can answer. */
    name: 'the three counts go back to the panel\'s own white instead of a theme token',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'display: block; font-size: 26px; font-weight: bold; color: var(--text-primary);',
      'display: block; font-size: 26px; font-weight: bold; color: #ffffff;')),
    expect: 'the moved rules carry no panel literal',
  },

  {
    /* The separator above the three counts. A literal white at 14% over a white
     * page is not a subtle border, it is no border — and the rule that removed it
     * was one line in a five-rule block, so nothing else notices its absence. */
    name: 'the rule above the counts is a literal white 14% again',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'border-top: 1px solid var(--hairline);\n      list-style: none;',
      'border-top: 1px solid rgba(255, 255, 255, 0.14);\n      list-style: none;')),
    expect: 'the rule above the three counts is --hairline',
  },

  {
    /* The moved block inherits `text-align: center` from `.home-hero-sticky`
     * today. Delete it and every rule still exists, nothing throws, and the
     * paragraph simply sits left-aligned under a centred title — invisible to
     * every assertion in the suite and obvious on the page. */
    name: 'the intro block loses the centering it used to inherit from the sticky layer',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'padding: 48px 20px 0;\n      text-align: center;',
      'padding: 48px 20px 0;')),
    expect: 'the intro block declares its own centering',
  },

  {
    /* The panel's alpha is the one number on this page whose failure mode is INVISIBLE in the
     * dark theme, and the rendered half of this checker is not a manifest entry — so nothing
     * that runs would catch a drop. §3.P's gap, pointed at a colour.
     *
     * 0.65 is the first alpha under WCAG AA's 4.5:1 for the gold title on this panel; 0.4 puts
     * it at 1.67:1. Over a dark frame the title still reads as gold on a dark wash, which is
     * why a screenshot of dark theme answers nothing. The assertion derives the bound from the
     * two declarations rather than restating 0.7, so this case cannot pass by a magic number
     * agreeing with itself. */
    name: 'the hero panel is made transparent enough to lose the title',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'background: rgba(6, 9, 20, 0.7);',
      'background: rgba(6, 9, 20, 0.4);')),
    expect: 'the h1 reads at 1.67:1 against the WORST frame the clip can show',
  },

  {
    /* The blur radius is the OTHER half of "can I see the Pokémon behind the panel", and unlike
     * the alpha it costs no contrast at all — so nothing about a contrast assertion can police
     * it. A checker that only guards what it can measure would let this be removed silently. */
    name: 'the hero panel\'s blur is restored to 10px, hiding every sprite behind it',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'backdrop-filter: blur(3px);\n      -webkit-backdrop-filter: blur(3px);',
      'backdrop-filter: blur(10px);\n      -webkit-backdrop-filter: blur(10px);')),
    expect: 'the hero panel blurs at most 3px',
  },

  {
    /* The one that made this assertion necessary, reproduced. An extra closing delimiter in
     * index.html's <style> ends the comment early, the prose after it becomes live CSS, and the
     * browser discards every rule from there to the end of the block — so the panel loses its
     * fill, the h1 loses its accent, and the hero renders unstyled while every other check in
     * this file keeps reading the text the browser already threw away.
     *
     * The name of the assertion deliberately avoids spelling the delimiters: a CSS comment does
     * not nest, so writing them inside this file's own docblock ended that comment early too and
     * the checker did not parse. The reason is recorded there. */
    name: 'a comment in the hero stylesheet is closed one delimiter early',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
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
    /* §3.X's shape, in the one place the suite did not have it: the mounted
     * container stays EMPTY and every header check reads the markup. */
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
    /* §3.B2's shape. Every generated sprite answers "did the clip play", and a
     * checker that cannot answer it is worse than one that can. */
    name: 'the video has no id, so the module is asking for an element that is not there',
    mutate: (dir) => edit(dir, 'index.html', (s) => replaceOrThrow(s,
      'id="home-hero-video"', 'id="hero-clip"')),
    expect: 'the video carries id="home-hero-video"',
  },
];

/* Pooled, three at a time: every case is an independent child process over its
 * own tree and shares nothing, which is §3.G7's exact precondition. The order
 * cases print in is declaration order, NOT completion order — an output that
 * follows the scheduler cannot be diffed between two green runs. */
console.log(`\n--- ${CASES.length} negative cases against check_home_hero.mjs ---`);
const results = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  try {
    const { code, out } = await run(dir);
    /* `out` and `code` are carried on the BASELINE result too. The first version
     * returned only `{ c, pass }` for it, so the failure branch below — the one
     * that exists to explain a broken tree — crashed on `out.split` instead of
     * printing the explanation. A diagnostic that cannot run is the one diagnostic
     * that is needed. */
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