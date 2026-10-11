/**
 * Negative tests for check_nav_pages.mjs — the checker must FAIL, and name the
 * right reason, for every invariant it claims to police.
 *
 *   node scripts/test_check_nav_pages.mjs
 *
 * WHY THIS FILE EXISTS. The checker's central claim is a negative one: that a
 * page with no nav call is caught. That is the easiest kind of assertion to get
 * accidentally true. A `src.includes('initHeaderNav')` test looks identical on
 * all 12 pages and is green forever, because every page also IMPORTS the symbol
 * and two of them mention the call in a comment — maze.html:110 and
 * detail.html:45. A checker that cannot fail is worse than no checker, because
 * it is trusted, and this one would be trusted precisely because it is green.
 *
 * Each case below breaks ONE invariant in a scratch copy of the tree, runs the
 * real checker against it, and requires a non-zero exit AND a specific
 * substring. Asserting only the exit code would pass on a crash, which is how a
 * typo becomes a "passing" test. A mutation that returns its input unchanged is
 * treated as an error rather than a no-op, for the same reason: a stale anchor
 * makes the case pass without ever exercising the check.
 *
 * The tree is the checker, shared.css, the two footer mark SVGs and every root
 * .html — which is every file the checker opens, because a file left out of the
 * fixture does not degrade the check that reads it, it ENOENTs the whole run.
 *
 * The two `passes` cases at the end police the OPPOSITE direction — a genuinely
 * new page that does the right thing must not be reported as a defect, and
 * neither must an InfoPoke capture. Without them a checker that simply demanded
 * the 12 pages it was written against would look correct forever, and the whole
 * point of deriving the page set from the directory is that it has no fixed size.
 *
 * The harness runs from a temp tree, so a failed case cannot leave the working
 * tree modified. Only text files are copied — the checker reads root html and
 * nothing else — which also means the fixture cannot drift into agreeing with a
 * bug in the checker.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy, failLines } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_nav_pages.mjs';

/* shared.css is in the tree because the checker READS the row-layout modifier
 * list out of it. Without it every case dies with ENOENT before the first
 * assertion — which the harness would report as ten failures that ran nothing,
 * the §4 shape this file's own cases exist to catch. It is 1,741 lines and copies
 * in about a millisecond, which is a fair price for the third case below. */
const SHARED_CSS = 'assets/css/shared.css';

/* The two mark files are in the tree because the checker READS each one's own
 * `<path fill="…">` to decide which colour a theme actually paints the mark in.
 * They are 1.5 KB of text each, and their absence is not a degraded check — it is
 * an ENOENT that kills the checker before its first assertion, which this harness
 * then reports as five cases that ran nothing. That is exactly the failure shape
 * §4 warns about, and it arrived the moment the footer section started reading a
 * file outside the root: the comment at the top of this file said the checker
 * "reads root html and nothing else", which was true until it was not. */
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
  const dir = join(tmpdir(), `cnp-neg-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }

  if (mutate) {
    for (const f of [...SRC]) {
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

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Baseline first: if the unmutated copy does not pass, every case below would be
// measuring the harness rather than the checker.
{
  const dir = makeTree(null);
  const { code, out } = run(dir);
  code === 0 ? pass('baseline: the checker passes on an unmutated copy of the tree')
             : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
  rmSync(dir, { recursive: true, force: true });
}

const cases = [
  {
    /* The case the whole file exists for. maze.html's HTML comment quotes the
       call verbatim two lines above the real one, so a substring test still
       reports this page as mounting the nav after the call is gone. */
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
       would call this button named when it names nothing. */
    name: 'the toggle is labelled only by aria-labelledby, which names no control',
    mutate: (f, s) => f === 'model3d.html'
      ? s.replace('aria-expanded="false" aria-label="開啟選單"', 'aria-expanded="false" aria-labelledby="site-nav"')
      : undefined,
    expect: 'unusable toggle: model3d.html',
  },
  {
    name: 'the drawer loses `hidden`, so it paints over the page on desktop',
    mutate: (f, s) => f === 'colors.html'
      ? s.replace('data-nav data-nav-drawer hidden>', 'data-nav data-nav-drawer>')
      : undefined,
    expect: 'unusable drawer: colors.html',
  },
  {
    /* aria-hidden contains "hidden" after a hyphen, and /\bhidden\b/ matches it,
       so this is the one mutation a naive boolean-attribute test waves through. */
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
    /* The regression the NAV comment above initHeaderNav() describes: five
       hand-maintained copies of the same <nav>, drifting into three link sets. */
    name: 'a page hand-writes links inside the container the runtime owns',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('<nav class="site-nav" data-nav aria-label="主選單"></nav>',
        '<nav class="site-nav" data-nav aria-label="主選單"><a href="pokedex.html">圖鑑</a></nav>')
      : undefined,
    expect: 'pages with <a> inside <nav class="site-nav">: sorting.html',
  },
  {
    /* The regression that has no error message. `.header` on its own is a VALID
       class — it resolves to the COLUMN layout, so every other check in this file
       passes on it: the nav mounts, the toggle is a proper button, the drawer is
       hidden, nothing throws and nothing logs. What a reader gets is a header 43px
       too tall with the nav on a second row, overlapping the theme toggle. */
    name: 'a header drops its row-layout modifier, so the nav lands on a second row',
    mutate: (f, s) => f === 'spectrum.html'
      ? s.replace('<header class="header header-colors">', '<header class="header">')
      : undefined,
    expect: 'headers with a bare class="header": spectrum.html',
  },
  {
    /* Two modifiers is not "at least one working" — each sets --page-accent,
       background and position, so the winner is whichever came last in
       shared.css, and a page asking for the wrong identity gets it silently. */
    name: 'a header claims two identities and the later one silently wins',
    mutate: (f, s) => f === 'maze.html'
      ? s.replace('<header class="header header-maze">', '<header class="header header-maze header-sort">')
      : undefined,
    expect: 'headers with several modifiers: maze.html',
  },
  {
    /* The list the check guards is read OUT of shared.css, so if the stylesheet
       stops shipping a row rule the check has nothing to compare against and would
       pass on every page. The mutation turns the row back into a column — which is
       the same class of edit someone makes when they "fix" the header — rather than
       renaming one of the six classes, which would leave five working ones and be a
       question about identity rather than about the list existing at all. */
    name: 'shared.css turns the header row back into a column, leaving the guard with nothing to match',
    /* Keyed on the CONSTANT, not on 'shared.css'. The loop passes SRC entries, and
       this one is a path — so `f === 'shared.css'` was never true, mutate returned
       undefined for every file, and the case ran on an unmutated tree and passed
       for the wrong reason. `undefined` is how a case says "not my file", so a
       stale key is invisible here: there is no anchor to go stale. */
    mutate: (f, s) => f === SHARED_CSS
      ? s.replace('  flex-direction: row;\n  align-items: center;\n  gap: 20px;',
        '  flex-direction: column;\n  align-items: center;\n  gap: 20px;')
      : undefined,
    expect: 'the row-layout modifier list is still in shared.css',
  },
  {
    /* initThemeToggle() injects the sun/moon pair only when the button holds no
       `.icon-sun`, so a page that hardcodes its own differently-named pair is not
       skipped but doubled: four children in a 34px box, both hand-written ones
       visible in both themes, the third one painting below the button. */
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

  /* --- the footer's GitHub mark -------------------------------------------------
   * These SHIPPED inverted, so each one is a case that demonstrably went green
   * once. M1 is the defect itself; M2 and M4 are the two guards that were written
   * to catch it and did NOT, which is why they are here too — a harness that only
   * holds the cases the author expected to pass is the same vacuity one layer up.
   */
  {
    /* The bug as shipped: the classes named the THEME, so "dark hides the dark
     * one" was false and each theme displayed the mark that vanishes into it —
     * white on #f3f5fa and black on #0b1020, both under 1.2:1. */
    name: "the mark's two swap rules are wired to each other, so both themes show the invisible mark",
    mutate: (f, s) => f === 'index.html'
      ? s.replace(".home-footer-github .gh-black { display: none; }", ".home-footer-github .gh-white { display: none; }")
        .replace(".home-footer-github .gh-white { display: none; }\n", ".home-footer-github .gh-white { display: none; }\n    [data-theme='light'] .home-footer-github .gh-black { display: none; }\n")
      : undefined,
    expect: 'the mark shown on each theme is visible against that theme',
  },
  {
    /* Found by hand-running M2: this stayed GREEN at first, because the check
     * used the class only as a lookup key and never read the NAME. */
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
    /* Found by hand-running M4: the ground check read index.html, which no longer
     * defines `.home-footer` at all, so it matched nothing and passed. */
    name: 'the footer is given a background of its own, so --bg-primary is no longer what the mark sits on',
    mutate: (f, s) => f === SHARED_CSS ? s.replace('.home-footer { border-top:', '.home-footer { background: #ffffff; border-top:') : undefined,
    expect: 'the footer paints no background of its own',
  },
  {
    name: "one theme's swap rule is deleted, so both marks render side by side",
    mutate: (f, s) => f === 'index.html'
      ? s.replace("    [data-theme='light'] .home-footer-github .gh-white { display: none; }\n", '')
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
    /* M5b, which was green until it was added to the checker. A second copy of a
     * shared rule wins on stylesheet order alone until the day it does not. */
    name: 'index.html re-declares .home-footer-line, so two definitions exist and only the cascade decides',
    mutate: (f, s) => f === 'index.html'
      ? s.replace('    .home-footer-title {', '    .home-footer-line { text-align: left; }\n    .home-footer-title {')
      : undefined,
    expect: 'index.html does not re-declare .home-footer-line either',
  },
  {
    /* The path's fill, not the clipPath's `<rect fill="white">`: a naive first-
     * fill match reads the BLACK file as white, which is what let the inverted
     * state look correct. */
    name: 'the white mark is swapped for one whose path fill no longer names a colour',
    mutate: (f, s) => f === 'assets/images/github-invertocat-white.svg'
      ? s.replace('<path d=', '<path fill="none" d=').replace(/(<path fill="none" d="[^"]*")\sfill="white"/, '$1')
      : undefined,
    expect: 'each mark class is named for the colour its file actually paints',
  },
];

// Text mutations and filesystem mutations are independent hooks, and a case may
// use either or both; one loop over the merged list, because splitting them is
// how a `files` hook ends up shipping that nothing ever calls.
for (const c of cases) {
  const dir = makeTree(c.mutate);
  if (c.files) c.files(dir);
  const { code, out } = run(dir);
  if (code !== 0 && caughtBy(out, c.expect)) pass(c.name);
  else fail(`${c.name}\n      exit ${code}, expected the checker to fail with "${c.expect}"\n${failLines(out).map((l) => `      ${l.trim()}`).join('\n') || out.split('\n').slice(-8).join('\n')}`);
  rmSync(dir, { recursive: true, force: true });
}

/* Opposite direction. A page that mounts the nav correctly must not read as a
   defect, or the checker is hardcoding the twelve pages it was written against —
   which is the failure mode that would make the next page on this site get no
   nav, and no warning. */
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
  const { code, out } = run(dir);
  code === 0 ? pass('a new page that mounts the nav correctly is not reported as a defect')
             : fail(`a correctly-mounted new page was reported as a defect — the checker is hardcoding the current page set:\n${out}`);
  rmSync(dir, { recursive: true, force: true });
}

/* And the other direction of the derived set: an InfoPoke capture is third-party
   markup, not a page of this site, and must never be governed. */
{
  const dir = makeTree(null);
  writeFileSync(join(dir, 'infopoke_net_new.html'), '<!DOCTYPE html><html><body>upstream capture</body></html>');
  const { code, out } = run(dir);
  code === 0 ? pass('an InfoPoke capture with no nav is ignored, not failed')
             : fail(`an InfoPoke capture was treated as a page of this site:\n${out}`);
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\nFAIL  ${failures} negative case(s) did not behave` : '\nPASS  every negative case failed for the right reason');
process.exit(failures ? 1 : 0);