/**
 * Negative tests for check_nav_pages.mjs. Each case must make the checker FAIL
 * with a specific reason, for every invariant the checker claims to police.
 *
 *   node scripts/test_check_nav_pages.mjs
 *
 * A negative claim is easy to satisfy accidentally. A `src.includes(...)` test
 * stays green when every page imports the symbol and two mention the call in a
 * comment. Each case breaks one invariant in a scratch tree, runs the real
 * checker, and requires both a non-zero exit and a specific substring. The exit
 * code alone would also pass on a crash. A mutation that returns its input
 * unchanged is an error: a stale anchor makes the case pass without exercising
 * the check.
 *
 * The fixture holds every file the checker opens — the checker, shared.css, the
 * two footer mark SVGs and every root .html. A missing file does not degrade the
 * check that reads it; it ENOENTs the whole run.
 *
 * The two `passes` cases at the end police the opposite direction: a new page
 * that mounts the nav correctly must not be reported, and neither must an
 * InfoPoke capture. The page set is derived from the directory and has no fixed
 * size.
 *
 * The harness runs from a temp tree, so a failed case cannot modify the working
 * tree. Only text files are copied.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy, failLines } from './lib/negative.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_nav_pages.mjs';

/* The checker reads the row-layout modifier list out of shared.css. Without it
 * every case dies with ENOENT before the first assertion, and the harness would
 * report failures that ran nothing. */
const SHARED_CSS = 'assets/css/shared.css';

/* The checker reads each mark file's own `<path fill="…">` to decide which
 * colour a theme paints the mark in. Their absence is an ENOENT, not a degraded
 * check. */
const MARK_FILES = [
  'assets/images/github-invertocat-black.svg',
  'assets/images/github-invertocat-white.svg',
];

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const SRC = [CHECKER, SHARED_CSS, ...MARK_FILES, ...htmlFiles];

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

function makeTree(mutate) {
  const dir = trackTree(join(tmpdir(), `cnp-neg-${Math.random().toString(36).slice(2)}`));
  mkdirSync(dir, { recursive: true });
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }

  if (mutate) {
    for (const f of [...SRC]) {
      const p = join(dir, f);
      const before = readFileSync(p, 'utf8');
      // `undefined` means this case does not target this file. A returned
      // string identical to the input means a stale anchor: an error, not a
      // no-op.
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

const runAsync = promisify(execFile);

async function run(dir) {
  try {
    const { stdout } = await runAsync(process.execPath, [join(dir, CHECKER)], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Baseline first: if the unmutated copy does not pass, every case below measures
// the harness rather than the checker.
{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  code === 0 ? pass('baseline: the checker passes on an unmutated copy of the tree')
             : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
  releaseTree(dir);
}

const cases = [
  {
    /* maze.html's HTML comment quotes the call two lines above the real one, so
       a substring test still reports this page as mounting the nav after the
       call is gone. */
    name: 'the call is deleted from a page whose comment still quotes it',
    mutate: (f, s) => f === 'maze.html' ? s.replace('\n    initHeaderNav();\n', '\n') : undefined,
    expect: 'pages with no initHeaderNav() call: maze.html',
  },
  {
    name: 'the call and the import are both deleted, so the page cannot mount the nav at all',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace(/\n\s*initHeaderNav\(\);/, '')
          .replace('shuffleArray, initThemeToggle, initHeaderNav }', 'shuffleArray, initThemeToggle }')
      : undefined,
    expect: 'pages with no initHeaderNav() call: sorting.html',
  },
  {
    name: 'a page keeps its import but never calls the function',
    mutate: (f, s) => f === 'generations.html'
      ? s.replace('initThemeToggle, initHeaderNav }', 'initThemeToggle }').replace(/\n\s*initHeaderNav\(\);/, '')
      : undefined,
    expect: 'pages with no initHeaderNav() call: generations.html',
  },
  {
    name: 'the import is dropped but the call left, which throws before the rest of the module runs',
    mutate: (f, s) => f === 'collections.html'
      ? s.replace('{ initThemeToggle, initHeaderNav }', '{ initThemeToggle }')
      : undefined,
    expect: 'pages that call it without importing it: collections.html',
  },
  {
    name: 'the toggle button is deleted, so the nav is unreachable on a phone',
    mutate: (f, s) => f === 'types.html'
      ? s.replace(/\n\s*<button class="site-nav-toggle"[^>]*><\/button>/, '')
      : undefined,
    expect: 'types.html (0 [data-nav-toggle])',
  },
  {
    name: 'the toggle loses aria-expanded, so the drawer state is unannounced',
    mutate: (f, s) => f === 'index.html'
      ? s.replace('data-nav-toggle type="button" aria-expanded="false"', 'data-nav-toggle type="button"')
      : undefined,
    expect: 'unusable toggle: index.html',
  },
  {
    /* aria-labelledby contains "aria-label" as a substring, so a presence test
       calls this button named when it names nothing. */
    name: 'the toggle is labelled only by aria-labelledby, which names no control',
    mutate: (f, s) => f === 'model3d.html'
      ? s.replace('aria-expanded="false" aria-label="開啟選單"', 'aria-expanded="false" aria-labelledby="site-nav"')
      : undefined,
    expect: 'unusable toggle: model3d.html',
  },
  {
    name: 'the drawer loses `hidden`, so it paints over the page on desktop',
    mutate: (f, s) => f === 'colors-generator.html'
      ? s.replace('data-nav data-nav-drawer hidden>', 'data-nav data-nav-drawer>')
      : undefined,
    expect: 'unusable drawer: colors-generator.html',
  },
  {
    /* aria-hidden contains "hidden" after a hyphen and /\bhidden\b/ matches it,
       so a naive boolean-attribute test waves it through. */
    name: 'the drawer is given aria-hidden instead of hidden, which does not hide it',
    mutate: (f, s) => f === 'pokedex.html'
      ? s.replace('data-nav data-nav-drawer hidden>', 'data-nav data-nav-drawer aria-hidden="false">')
      : undefined,
    expect: 'unusable drawer: pokedex.html',
  },
  {
    name: 'the drawer element is deleted outright',
    mutate: (f, s) => f === 'colors-explore.html'
      ? s.replace(/\n\s*<div class="site-nav-drawer"[^>]*><\/div>/, '')
      : undefined,
    expect: 'colors-explore.html (0 [data-nav-drawer])',
  },
  {
    /* Five hand-maintained copies of the same <nav> drifted into three link
       sets. The container belongs to the runtime. */
    name: 'a page hand-writes links inside the container the runtime owns',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('<nav class="site-nav" data-nav aria-label="主選單"></nav>',
        '<nav class="site-nav" data-nav aria-label="主選單"><a href="pokedex.html">圖鑑</a></nav>')
      : undefined,
    expect: 'pages with <a> inside <nav class="site-nav">: sorting.html',
  },
  {
    /* A bare `.header` is a valid class that resolves to the COLUMN layout, so
       every other check here passes: the nav mounts, the toggle is a proper
       button, the drawer is hidden, nothing throws. The page is 43px too tall
       with the nav on a second row, overlapping the theme toggle. */
    name: 'a header drops its row-layout modifier, so the nav lands on a second row',
    mutate: (f, s) => f === 'spectrum.html'
      ? s.replace('<header class="header header-colors">', '<header class="header">')
      : undefined,
    expect: 'headers with a bare class="header": spectrum.html',
  },
  {
    /* Each modifier sets --page-accent, background and position, so the winner is
       whichever came last in shared.css and a page asking for the wrong identity
       gets it silently. */
    name: 'a header claims two identities and the later one silently wins',
    mutate: (f, s) => f === 'maze.html'
      ? s.replace('<header class="header header-maze">', '<header class="header header-maze header-sort">')
      : undefined,
    expect: 'headers with several modifiers: maze.html',
  },
  {
    /* The check reads the modifier list out of shared.css. If the stylesheet
       stops shipping a row rule, the check has nothing to compare against and
       passes on every page. The mutation turns the row back into a column rather
       than renaming one class, which would leave five working ones. */
    name: 'shared.css turns the header row back into a column, leaving the guard with nothing to match',
    /* Keyed on the constant, not on 'shared.css'. The loop passes SRC entries and
       this one is a path, so `f === 'shared.css'` is never true. `undefined` is
       how a case says "not my file", so a stale key is invisible here: there is
       no anchor to go stale. */
    mutate: (f, s) => f === SHARED_CSS
      ? s.replace('  flex-direction: row;\n  align-items: center;\n  gap: 20px;',
        '  flex-direction: column;\n  align-items: center;\n  gap: 20px;')
      : undefined,
    expect: 'the row-layout modifier list is still in shared.css',
  },
  {
    /* initThemeToggle() injects the sun/moon pair only when the button holds no
       `.icon-sun`, so a hardcoded pair is doubled: four children in a 34px box,
       both hand-written ones visible in both themes. */
    name: 'a page hard-writes its own sun/moon, which the runtime then doubles',
    mutate: (f, s) => f === 'spectrum.html'
      ? s.replace('<button class="theme-toggle" type="button" aria-label="切換深色／淺色主題"></button>',
        '<button class="theme-toggle" type="button" aria-label="切換深色／淺色主題">'
        + '<svg class="theme-icon theme-icon-dark" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3z"/></svg>'
        + '<svg class="theme-icon theme-icon-light" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>'
        + '</button>')
      : undefined,
    expect: 'theme toggles with authored children: spectrum.html',
  },
  {
    /* Silent failure: the nav renders, nothing is marked current, nothing throws. */
    name: "the argument is a typo, so no trigger lights up and nothing throws",
    mutate: (f, s) => f === 'maze.html'
      ? s.replace('    initHeaderNav();', "    initHeaderNav('pokedex');")
      : undefined,
    expect: "arguments that are not an existing .html filename: maze.html -> 'pokedex'",
  },
  {
    name: 'the argument names a page that does not exist',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace("initHeaderNav('pokedex.html');", "initHeaderNav('pokedex.htm');")
      : undefined,
    expect: "detail.html -> 'pokedex.htm'",
  },
  {
    name: 'color.html stops mounting the rail, so the exclusion is hiding a page with no nav',
    mutate: (f, s) => f === 'color.html' ? s.replace("    initColorRail('color.html');", '') : undefined,
    expect: 'color.html no longer calls initColorRail()',
  },
  {
    name: '404.html stops being a stub, so the exclusion is hiding a page with no nav',
    mutate: (f, s) => f === '404.html' ? s.replace(/location\.replace/g, 'window.next =') : undefined,
    expect: '404.html no longer contains location.replace',
  },

  /* --- the footer's GitHub mark -----------------------------------------------
   * Each of these shipped inverted once. M1 is the defect itself; M2 and M4 are
   * the guards written to catch it that did not.
   */
  {
    /* The classes named the THEME, so "dark hides the dark one" was false and
     * each theme displayed the mark that vanishes into it: white on #f3f5fa and
     * black on #0b1020, both under 1.2:1. */
    name: "the mark's two swap rules are wired to each other, so both themes show the invisible mark",
    mutate: (f, s) => f === SHARED_CSS
      ? s.replace(".home-footer-github .gh-black { display: none; }", ".home-footer-github .gh-white { display: none; }")
        .replace(".home-footer-github .gh-white { display: none; }\n", ".home-footer-github .gh-white { display: none; }\n[data-theme='light'] .home-footer-github .gh-black { display: none; }\n")
      : undefined,
    expect: 'the mark shown on each theme is visible against that theme',
  },
  {
    /* The check used the class only as a lookup key and never read the NAME, so
     * this stayed green at first. */
    name: "the mark's classes go back to naming the theme, which is what made the rules readable as their own inverse",
    mutate: (f, s) => f === 'index.html'
      ? s.replace('class="gh-black"', 'class="gh-dark"')
        .replace('class="gh-white"', 'class="gh-light"')
        .replace('.gh-black {', '.gh-dark {')
        .replace('.gh-white {', '.gh-light {')
      : undefined,
    expect: 'each mark class is named for the colour its file actually paints',
  },
  {
    /* The ground check read index.html, which no longer defines `.home-footer`,
     * so it matched nothing and passed. */
    name: 'the footer is given a background of its own, so --bg-primary is no longer what the mark sits on',
    mutate: (f, s) => f === SHARED_CSS ? s.replace('.home-footer { border-top:', '.home-footer { background: #ffffff; border-top:') : undefined,
    expect: 'the footer paints no background of its own',
  },
  {
    name: "one theme's swap rule is deleted, so both marks render side by side",
    mutate: (f, s) => f === SHARED_CSS
      ? s.replace("[data-theme='light'] .home-footer-github .gh-white { display: none; }\n", '')
      : undefined,
    expect: 'BOTH marks render',
  },
  {
    name: 'both marks point at the same file, so one theme shows a mark that is not there',
    mutate: (f, s) => f === 'index.html'
      ? s.replace('src="assets/images/github-invertocat-black.svg"', 'src="assets/images/github-invertocat-white.svg"')
      : undefined,
    expect: 'each mark class is named for the colour its file actually paints',
  },
  {
    /* M5b. A second copy of a shared rule wins on stylesheet order alone until
     * the day it does not. */
    name: 'today.html re-declares .home-footer-line, so two definitions exist and only the cascade decides',
    mutate: (f, s) => f === 'today.html'
      ? s.replace('</head>', '  <style>\n    .home-footer-line { text-align: left; }\n  </style>\n</head>')
      : undefined,
    expect: 'today.html does not re-declare .home-footer or .home-footer-line',
  },
  {
    /* The one-mark defect, distinct from the zero-mark case four other footers
     * are in: the swap rules hide exactly one per theme, so a page carrying a
     * single mark renders the logo that disappears into its own background. */
    name: 'today.html loses one of its two GitHub marks, so one theme shows a logo that vanishes into itself',
    mutate: (f, s) => f === 'today.html'
      ? s.replace('<img class="gh-black" src="assets/images/github-invertocat-black.svg" alt="" width="24" height="24">', '')
      : undefined,
    expect: 'today.html does not carry exactly one GitHub mark',
  },
  {
    /* The path's fill, not the clipPath's `<rect fill="white">`: a naive
     * first-fill match reads the BLACK file as white, which let the inverted
     * state look correct. */
    name: 'the white mark is swapped for one whose path fill no longer names a colour',
    mutate: (f, s) => f === 'assets/images/github-invertocat-white.svg'
      ? s.replace('<path d=', '<path fill="none" d=').replace(/(<path fill="none" d="[^"]*")\sfill="white"/, '$1')
      : undefined,
    expect: 'each mark class is named for the colour its file actually paints',
  },
];

// Text and filesystem mutations are independent hooks; one loop over the merged
// list, so a `files` hook cannot ship without being called. Cases are pooled and
// printed after the drain in declaration order (§3.G7).
const results = await pool(cases.map((c) => async () => {
  let dir;
  try {
    dir = makeTree(c.mutate);
    if (c.files) c.files(dir);
    const { code, out } = await run(dir);
    const passed = code !== 0 && caughtBy(out, c.expect);
    return {
      name: c.name,
      pass: passed,
      detail: passed ? '' : `exit ${code}, expected the checker to fail with "${c.expect}"\n${failLines(out).map((l) => `      ${l.trim()}`).join('\n') || out.split('\n').slice(-8).join('\n')}`,
    };
  } finally {
    if (dir) releaseTree(dir);
  }
}));

for (const r of results) {
  if (r.pass) pass(r.name);
  else fail(`${r.name}\n      ${r.detail}`);
}

/* Opposite direction. A page that mounts the nav correctly must not read as a
   defect, or the checker is hardcoding the twelve pages it was written against
   and the next page gets no nav and no warning. */
{
  const dir = makeTree(null);
  const nav = [
    '    <nav class="site-nav" data-nav aria-label="主選單"></nav>',
    '    <button class="site-nav-toggle" data-nav-toggle type="button" aria-expanded="false" aria-label="開啟選單"></button>',
    '    <div class="site-nav-drawer" data-nav data-nav-drawer hidden></div>',
  ].join('\n');
  writeFileSync(join(dir, 'newpage.html'), `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><title>新頁面</title></head>
<body>
  <header class="header header-dex">${nav}</header>
  <script type="module">
    import { initHeaderNav } from './assets/js/shared.js';
    initHeaderNav('newpage.html');
  </script>
</body>
</html>`);
  const { code, out } = await run(dir);
  code === 0 ? pass('a new page that mounts the nav correctly is not reported as a defect')
             : fail(`a correctly-mounted new page was reported as a defect — the checker is hardcoding the current page set:\n${out}`);
  releaseTree(dir);
}

/* The other direction of the derived set: an InfoPoke capture is third-party
   markup and must never be governed. */
{
  const dir = makeTree(null);
  writeFileSync(join(dir, 'infopoke_net_new.html'), '<!DOCTYPE html><html><body>upstream capture</body></html>');
  const { code, out } = await run(dir);
  code === 0 ? pass('an InfoPoke capture with no nav is ignored, not failed')
             : fail(`an InfoPoke capture was treated as a page of this site:\n${out}`);
  releaseTree(dir);
}

console.log(failures ? `\nFAIL  ${failures} negative case(s) did not behave` : '\nPASS  every negative case failed for the right reason');
process.exit(failures ? 1 : 0);