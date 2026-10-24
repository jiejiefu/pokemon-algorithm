/**
 * Static contract for the colour page's app shell (Unit 2: the full-site rail).
 *
 *   node scripts/check_color_page.mjs
 *
 * WHY THIS IS A STATIC CHECK AND NOT A BROWSER CHECK. Everything asserted here
 * is decided at RENDER time by pure functions over a constant table — `NAV`,
 * the planned-page registry, and one CSS block. A browser can only observe the
 * consequence, and the three failures below each produce a page that still
 * renders, still links, and still looks deliberate, so a screenshot cannot
 * separate "correct" from "plausible":
 *
 * 1. A NAV page with no row of its own. `color.html` was listed in the 色彩
 *    (Colors) group's `pages` — which is what makes the group light up — but
 *    had no sub-item pointing at it. The page therefore marked NOTHING current,
 *    and the rail offered no way back to it. `pages` and `groups` are separate
 *    arrays and nothing forced them to agree; the comment above the 色彩 group
 *    already described the intended three-row drill-down, so the table was
 *    wrong rather than the design. CAUGHT HERE, statically, as "this page is
 *    claimed by no link".
 * 2. `aria-current` on the group trigger. A trigger stands for a whole group,
 *    so marking IT current says "you are somewhere in here", and with the
 *    group collapsed the claim is invisible. `aria-current` belongs on the
 *    exact row. This file pins that every page is claimed by exactly ONE link
 *    and that no trigger carries the attribute at all.
 * 3. An author `display` defeating the `hidden` attribute. `.cp-nav-drawer` and
 *    `.cp-rail-sub` set `display: flex` unconditionally, and `[hidden]` is a UA
 *    rule at specificity (0,1,0) that any class rule outranks — so every
 *    collapsed panel and the whole mobile drawer painted on desktop, which is
 *    the reported bug ("a second sidebar appeared on the right"). A
 *    `[hidden]` companion at (0,2,0) is the only thing that survives an author
 *    `display`, and it is asserted here because deleting it is a one-line
 *    change that silently restores the bug.
 *
 * WHY THE `hidden` COMPANION IS NOT ENOUGH ON ITS OWN, and the disclosure
 * default is asserted too: a closed panel is a panel the user cannot see the
 * current page inside, and since (2) puts `aria-current` on that row, a group
 * that renders closed hides the one element answering "where am I". The active
 * group must therefore start OPEN and the others CLOSED. `node --check`, import
 * resolution and brace counting all pass with the opposite default, which is
 * why the earlier failures of this kind were invisible until a browser was
 * driven.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
// A FAIL that prints an empty message is worse than no check: it reads as a
// blank line, and `1 check(s) failed` with nothing to act on sends the reader
// looking in the wrong file (§3.G5). So the detail is never
// allowed to be empty — the reason is always named, even if the computed list
// of offenders came back empty, which is how a mis-written predicate is caught.
const check = (cond, ok, bad) => {
  if (cond) return pass(ok);
  const why = typeof bad === 'function' ? bad() : bad;
  /* The description goes on the failure line too, not just the reason. Every other
   * checker in this project prints the assertion's name when it fails, which is what
   * makes a failure identifiable after the fact — and it is what lets a negative
   * test name the assertion it is exercising. Dropping `ok` here meant a failure
   * could only be recognised by the wording of its detail. */
  fail(`${ok}${why ? ` — ${why}` : ' — the check failed but the detail was empty (predicate disagrees with its own message)'}`);
};

// --- read the sources -------------------------------------------------------

const shared = read('assets/js/shared.js');
const css = read('assets/css/colors.css');
const colorHtml = read('color.html');
const paletteSrc = read('assets/js/color-palette.js');
// Declared in check_all.mjs's inputs because the page imports it, and §3.G1's
// rule is that a declared input nothing opens is an input whose edit will not
// invalidate this checker. So it is opened here, and what is asserted about it
// is the claim the extraction exists to protect: ONE highlighter for the two
// pages that show the same three generators' output. A second copy would not
// break a single assertion anywhere in the suite — it would just mean the two
// code blocks colour the same token differently, forever.
const highlighterSrc = read('assets/js/code-highlight.js');

/* Comments are stripped before any RULE-shaped assertion below.
   `colors.css` documents its own decisions in prose that names selectors and
   properties — the `.cp-rail-open` comment literally begins with "mounted on
   `.cp-panel`" — and a `[^{}]*` between a selector and its `{` walks straight
   out of a comment and into the next rule. The first version of the
   `display: none` assertion below did exactly that and reported a 60-word
   paragraph plus `.cp-rail-open` as a `.cp-panel` rule that does not exist.
   Same reason `check_page_module_api.mjs` masks comments before it reads member
   names out of sentences about members; the difference is only that here the
   false positive was in the checker written to catch the real thing. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

// NAV and PLANNED_PAGES are evaluated rather than regex-scraped, so this file
// tests the table the page actually renders from. Importing shared.js in Node
// would drag in `document`; the two tables are pure data, so they are lifted
// out of the source and evaluated in isolation.
function tableFrom(src, name) {
  const start = src.indexOf(`export const ${name} = [`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = src.indexOf('[', start);

  // Mask out comments BEFORE balancing brackets. NAV's comments are full of
  // apostrophes and backticks ("the trigger has no href of its own", "`pages`
  // is what makes a dropdown mark itself current"), and a scanner that treats a
  // `'` in a comment as a string open runs off the end of the table and slices
  // an `export` into the middle of the value.
  const code = new Array(src.length).fill(true);
  let q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') code[i++] = false; continue; }
    if (c === '/' && src[i + 1] === '*') { code[i++] = false; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) code[i++] = false; code[i] = false; continue; }
  }

  let depth = 0, end = -1;
  q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (!code[i]) continue;
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced brackets in ${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(open, end)};`)();
}

let NAV, PLANNED;
try {
  NAV = tableFrom(shared, 'NAV');
  PLANNED = tableFrom(shared, 'PLANNED_PAGES');
} catch (e) {
  // A renamed export must be a readable FAIL, not a stack trace: a crash
  // discards every readable line printed above it (§3.G5).
  fail(`could not lift NAV / PLANNED_PAGES out of shared.js — ${e.message}`);
  console.log('\n1 check(s) failed');
  process.exit(1);
}

console.log('NAV integrity');

// Every href a NAV row can send the user to must resolve, or be registered as
// planned. A typo'd href is a dead link that renders identically to a good one.
const plannedSlugs = new Set(PLANNED.map((p) => p.slug));
// The site pages that reach the nav. A NUMBER, not a list on purpose — a list here
// would be a fourth copy of NAV that could be edited to agree with a broken NAV,
// whereas a count can only be changed by someone deciding the site's page set
// changed, and a stale one is a red line rather than a silently smaller table.
//
// Derived once, measured, rather than described in prose that goes stale: TWO
// top-level hrefs (index.html, model3d.html) plus 18 pages under the five groups,
// whose union is 20 — the groups' `pages[]` and their rows name 18 each, and the
// two sets overlap in everything except model3d.html, which is top-level only.
// Three planned rows (abilities.html, moves.html, natures.html) are NOT counted,
// because a `planned` entry is a badge promising a page nothing links to yet.
//
// It went 15 -> 16 when spectrum.html joined the 叫聲 (cries) group, 16 -> 17
// when life.html joined 演算法 (algorithms), 17 -> 18 when graph.html joined
// 演算法, 18 -> 19 when color-game.html replaced its `planned: 'color-game.html'`
// placeholder in the 色彩 group with a real row — which is what the `planned`
// branch of `navRowHtml` exists for — and 19 -> 20 when cry-game.html joined
// 叫聲 as a real row. **That last bump was missed**, so this assertion has been
// red since: the row landed in commit 16fe543 and the count did not move. It is
// recorded here rather than left to the commit log because the message below now
// names WHICH pages are in the table, so the diagnosis is one line of output
// instead of a re-derivation.
// 20 -> 21 when today.html became the first row of 圖鑑 (Pokédex), the day
// index.html gave its content sections away. The bump being VISIBLE is the
// point: this pin is what turns "a page quietly stopped being mentioned by NAV"
// into a red line instead of a table of claims that quietly stopped covering it.
// 21 -> 22 when moves.html shipped. `move.html` did NOT move it: that page is
// reached by drilling in from a row, exactly as detail.html is, and neither
// carries an aria-current claim for a reason — adding one would have been the
// only page in the site marked 「current」 while it had no nav row to mark.
// 22 -> 23 when abilities.html shipped, and `ability.html` did NOT move it for
// the same reason `move.html` did not. The pair is deliberate rather than
// convenient: two drill-in pages with no row means the rule is about HOW a page
// is reached, not about there being two of them.
// 23 -> 24 when team.html shipped. It has its own row and its own pages entry,
// like abilities.html, because the planner is a destination rather than a
// drill-in from a card.
// 25 -> 26 when cry-studio.html shipped.
const EXPECTED_NAV_PAGES = 26;
const rowTargets = [];
for (const item of NAV) {
  const label = item.label;
  if (item.href) rowTargets.push({ from: label, href: item.href, kind: 'href' });
  for (const page of item.pages || []) rowTargets.push({ from: label, href: page, kind: 'pages[]' });
  for (const g of item.groups || []) {
    for (const it of g.items) {
      if (it.planned) {
        check(
          plannedSlugs.has(it.planned),
          `planned row "${it.label}" registers ${it.planned} in PLANNED_PAGES`,
          () => `planned row "${it.label}" names ${it.planned}, which PLANNED_PAGES does not list — the badge promises a page nothing tracks`
        );
      } else {
        rowTargets.push({ from: `${label} > ${it.label}`, href: it.href, kind: 'group row' });
        // A row's `pages` are real destinations too, and they have to resolve
        // for the same reason the row's own href does: 特殊分類 (special
        // categories) lists category.html so that page can mark itself current
        // from one row instead of needing a row of its own.
        for (const page of it.pages || []) {
          rowTargets.push({ from: `${label} > ${it.label}`, href: page, kind: 'group row pages[]' });
        }
      }
    }
  }
}
check(
  rowTargets.every((t) => existsSync(join(ROOT, t.href))),
  `all ${rowTargets.length} NAV link targets exist on disk`,
  () => `NAV points at missing files: ${rowTargets.filter((t) => !existsSync(join(ROOT, t.href))).map((t) => `${t.from} -> ${t.href}`).join(', ')}`
);

check(
  rowTargets.every((t) => t.href.endsWith('.html')),
  'no NAV target is a directory or an extensionless path',
  () => `unexpected target shape: ${rowTargets.filter((t) => !t.href.endsWith('.html')).map((t) => t.href).join(', ')}`
);

// --- the one that matters: every page is claimed by exactly ONE link --------
//
// Two elements carrying aria-current is ambiguous, and zero is a page that
// cannot say where it is. This is the check that catches failure (1) and (2)
// together, and it is deliberately computed over EVERY page rather than
// special-cased for the colour trio, because a per-page assertion passes for
// exactly the page it was written for.
const everyPage = [...new Set(rowTargets.map((t) => t.href))].sort();
// The table must not SHRINK. Every check below is computed over `everyPage`,
// which is built from what NAV mentions — so a page that quietly stops being
// mentioned leaves the table and turns every claim check green while marking
// nothing current. That is not hypothetical: the row-level `pages` of 特殊分類
// (special categories) is the only thing that mentions category.html, and
// deleting that one array is a one-token edit that no other assertion here would
// notice. Pinning the size is the blunt instrument that turns that silence into a
// failure, and the count only moves when a page is genuinely added to or removed
// from the site.
/* The message NAMES THE PAGES, sorted, because a bare count difference is a
 * re-derivation rather than a diagnosis. This assertion went red on a real
 * omission — cry-game.html had been a 叫聲 (cries) row for a commit — and the
 * report was "everyPage has 20 entries, expected 19", which says that something
 * changed and nothing about what. The next person to bump this has to answer one
 * question ("which page?") and the answer should be in the output they already
 * have. */
check(
  everyPage.length === EXPECTED_NAV_PAGES,
  `the claim table holds all ${EXPECTED_NAV_PAGES} site pages`,
  () => `everyPage has ${everyPage.length} entries, expected ${EXPECTED_NAV_PAGES}`
    + ` — a page has stopped being mentioned by NAV, so the checks below no longer cover it.\n`
    + `      the table now holds: ${everyPage.join(' ')}`
);
const claims = new Map();
const triggerPages = new Map();
for (const page of everyPage) {
  const owners = [];
  for (const item of NAV) {
    const ownHref = item.href === page;
    const inPages = (item.pages || []).includes(page);
    const isGroup = !!(item.groups && item.groups.length);
    const groupRows = isGroup
      ? item.groups.flatMap((g) => g.items).filter((it) => !it.planned && (it.href === page || (it.pages || []).includes(page)))
      : [];
    if (!isGroup) {
      // Mirrors railNavHtml: a single link may be claimed through `pages`, which
      // is the only thing that keeps category.html (a child of collections.html
      // with an identical header) from claiming nothing.
      if (ownHref || inPages) owners.push(`${item.label} (link)`);
    } else if (groupRows.length) {
      // The exact row claims it; the trigger never does, unless the group root
      // is the page, in which case there is no row to put it on.
      owners.push(`${item.label} > ${groupRows[0].label} (row)`);
      if (ownHref) triggerPages.set(page, (triggerPages.get(page) || 0) + 1);
    } else if (inPages) {
      owners.push(`${item.label} (group, no row)`);
    }
  }
  claims.set(page, owners);
}
check(
  [...claims.values()].every((o) => o.length === 1),
  `all ${everyPage.length} NAV pages are claimed by exactly one element`,
  () => [...claims].filter(([, o]) => o.length !== 1).map(([p, o]) => `${p} claimed ${o.length}x [${o.join('; ')}]`).join(' | ')
);
check(
  [...claims.values()].flat().every((o) => o.endsWith('(row)') || o.endsWith('(link)')),
  'no page is claimed by a group with no row of its own',
  /* `includes`, not `endsWith`: the owner string is built as `${label} (group, no
   * row)`, so it ends in a closing parenthesis. Testing for a bare `no row` suffix
   * could never match anything, which made this check's detail permanently empty and
   * left it reporting only the generic fallback — the exact outcome the `check()`
   * guard above exists to make visible, and it was visible only as an absence. */
  () => [...claims].filter(([, o]) => o.some((x) => x.includes('no row'))).map(([p, o]) => `${p} [${o.join('; ')}]`).join(' | ')
);
check(
  [...triggerPages.keys()].length === 0,
  'no group trigger carries aria-current: the exact row claims the page',
  () => `trigger-level claims: ${[...triggerPages.keys()].join(', ')}`
);

// A row that claims a page ALSO needs the group to open on that page, or the
// aria-current it just gained is inside a `[hidden]` panel. The group opens on
// `pages`, so a page claimed by a row but missing from its group's `pages` is
// claimed and invisible at the same time. The two lists look redundant —
// category.html is in both of 圖鑑's (Pokédex's) — and they are, but for
// different jobs: `group.pages` opens the disclosure, the row's `pages` carries
// the claim.
const unopenedGroups = [];
for (const item of NAV) {
  if (!item.groups) continue;
  for (const g of item.groups) {
    for (const it of g.items) {
      for (const page of (it.pages || []).concat(it.href ? [it.href] : [])) {
        if (!(item.pages || []).includes(page)) unopenedGroups.push(`${item.label} > ${it.label} claims ${page}, which the group does not list`);
      }
    }
  }
}
check(
  unopenedGroups.length === 0,
  'every group row is reachable: the group opens on the pages its rows claim',
  () => unopenedGroups.join(' | ')
);

// The two ownership checks above are properties of the TABLE, computed from NAV
// alone — so they cannot see `railNavHtml` itself changing, and a case that
// mutates the renderer's rule would pass for the wrong reason. That is why the
// RENDERER'S rule is asserted here as source shape instead, and why the runtime
// truth is left to the browser probe.
//
// One expression, and its two failure modes are opposite: narrowing it to
// `item.href === currentPage` drops category.html's claim (a child of
// collections.html whose identical header makes `pages` the only thing that can
// tell the two apart), while widening it to a bare `isActive` puts
// `aria-current` on a group trigger as well as on the row, and the trigger's
// claim is invisible whenever the group is collapsed. A single ceiling would
// pass for one of them, so the whole expression is pinned.
check(
  /const claimsCurrent = isGroup \? item\.href === currentPage : isActive;/.test(shared),
  'the aria-current rule is the two-branch form: pages[] may claim a single link, only the exact row may claim a group',
  () => "railNavHtml's aria-current rule is not the two-branch form — narrowed to `href === page` it silently drops category.html, widened to a bare `isActive` it puts aria-current on a group trigger as well as on the row"
);

// --- the active group opens, the others do not ------------------------------
//
// Asserted over the SOURCE, because the default is a literal in the template.
// A closed-everything default and an open-everything default both render.
check(
  /aria-expanded="\$\{open\}"/.test(shared) && /id="\$\{panelId\}"\$\{open \? '' : ' hidden'\}/.test(shared),
  'the disclosure default derives from the active group, not a hardcoded false',
  () => "railNavHtml still hardcodes aria-expanded=\"false\" or an unconditional hidden — the page you are on renders with its own group closed"
);
check(
  /const open = isActive;/.test(shared),
  'the open group is the one holding the current page',
  () => 'railNavHtml computes `open` from something other than isActive'
);

// --- the [hidden] companion rules ------------------------------------------
//
// (0,2,0) beats the (0,1,0) author `display: flex` that broke this. Deleting
// either line restores the reported second-sidebar bug with no other symptom.
const hiddenCompanion = /\.cp-rail-sub\[hidden\]\s*,\s*\.cp-nav-drawer\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(css);
check(
  hiddenCompanion,
  'colors.css has the [hidden] companion rule for .cp-rail-sub and .cp-nav-drawer',
  () => 'the [hidden] companion rule is gone — .cp-rail-sub/.cp-nav-drawer set display:flex, which outranks the UA [hidden] rule, so every collapsed panel and the mobile drawer paint on desktop (this was the reported bug)'
);
check(
  /\.cp-rail-drawer|\.cp-nav-drawer\s*\{[^}]*display:\s*flex/.test(css),
  'the drawer still declares display:flex, so the companion rule is load-bearing rather than decorative',
  () => 'the drawer no longer sets display:flex — if the companion rule has become redundant, delete it instead of keeping dead CSS'
);
check(
  /\.cp-rail-sub-row\.is-active/.test(css),
  'the active sub-row has its own visible treatment',
  () => '.cp-rail-sub-row.is-active has no rule, so aria-current is announced but not shown'
);

// --- color.html wiring ------------------------------------------------------

console.log('\ncolor.html wiring');

check(
  /export function initColorRail/.test(shared),
  'shared.js exports initColorRail',
  () => 'initColorRail is not exported — every import of it is a SyntaxError that kills the whole module at parse time'
);
check(
  /import\s*\{[^}]*\binitColorRail\b[^}]*\}\s*from\s*['"]\.\/assets\/js\/shared\.js['"]/.test(colorHtml),
  'color.html imports initColorRail from assets/js/shared.js',
  () => 'color.html does not import initColorRail'
);
check(
  /initColorRail\(\s*['"]color\.html['"]\s*\)/.test(colorHtml),
  "color.html calls initColorRail('color.html')",
  () => 'color.html does not call initColorRail, or passes the wrong page name — the rail would mark nothing current'
);

// The skip link must be the FIRST focusable thing in the document. Comparing
// its offset against `.cp-scroll` is not enough on its own — text inserted
// between the two still leaves it ahead of the scroll container while breaking
// "first child" — so what sits between the `.cp-app` open tag and the link must
// be WHITESPACE and nothing else. Exact adjacency would be wrong: the markup
// indents the link, and rejecting indentation would fail on correct HTML.
const appOpen = colorHtml.match(/<div class="cp-app"[^>]*>/);
const skipAnchor = colorHtml.match(/<a class="cp-skip"[\s\S]*?<\/a>/);
const between = appOpen && skipAnchor && skipAnchor.index >= appOpen.index + appOpen[0].length
  ? colorHtml.slice(appOpen.index + appOpen[0].length, skipAnchor.index)
  : null;
check(
  between !== null && /^\s*$/.test(between),
  'the skip link is the first child of .cp-app (only whitespace precedes it), so it is the first thing Tab reaches',
  () => 'the skip link is not the first child of .cp-app, so it is not the first thing Tab reaches'
);
check(
  /<nav class="cp-rail" data-rail aria-label="主選單">/.test(colorHtml),
  'the rail is a <nav> with an accessible name',
  () => 'the rail mount is missing or unnamed — an unnamed <nav> is announced only as "navigation"'
);
check(
  /<div class="cp-nav-drawer" data-rail-drawer hidden><\/div>/.test(colorHtml),
  'the mobile drawer mount ships hidden',
  () => 'the drawer mount is missing or does not ship hidden'
);
check(
  !/class="site-nav"|initHeaderNav|class="theme-toggle"|initThemeToggle/.test(colorHtml),
  'the old header nav and theme toggle are gone from color.html',
  () => 'color.html still mounts the old header nav/theme toggle — the rail was added alongside the old chrome instead of replacing it'
);

// ---------------------------------------------------------------------------
// NO HEADER AT ALL — the frame is the viewport, so the three columns start at y=0
// ---------------------------------------------------------------------------
// The header was 55px (padding `6px 62px 6px 20px` plus a 3px `.header`
// border-top) sitting above `.cp-shell`, so `.cp-rail`, `.cp-panel` and
// `.cp-main` all measured y=55 and `.cp-scroll` was 900-55-... = 758 rather
// than the full 900. It carried nothing but the brand link — no nav, no theme
// toggle — and the brand now lives in the rail's top row, which is where the
// reference keeps it too (`collapsible-sidebar.tsx:205-218`).
//
// Why the ABSENCE needs asserting rather than the layout. There is no browser
// checker for this page, and a static check that only said "the three columns
// are at y=0" could not be written — there is no layout in a file. Asserting the
// header is gone is the version of the same claim that CAN be checked, and it is
// the direction that matters: a header re-added above the shell is the only way
// the 55px comes back, because nothing else here measures a height.
console.log('\nno header — the frame starts at y=0');

check(
  !/<header\b/.test(colorHtml),
  'color.html mounts no <header> at all',
  () => {
    const tag = (colorHtml.match(/<header\b[^>]*>/) || ['<header>'])[0];
    return `found ${tag} — it puts a band above all three columns again, so none of them can start at y=0 (measured 55px at 1440x900)`;
  }
);

check(
  !/\.cp-app\s*>\s*\.header/.test(cssCode),
  'and colors.css keeps no rule that would style one if it came back',
  () => 'colors.css still has a `.cp-app > .header` rule — a rule for an element the page does not mount is a rule nobody maintains (the `.header-graph` shape, §3.N)'
);

// ---------------------------------------------------------------------------
// THE MOBILE MENU BUTTON — the one thing that silently died with the header
// ---------------------------------------------------------------------------
// `initColorRail` appends `.cp-rail-open` to a mount point in the page's own
// markup. Below 768px `.cp-rail` is `display: none`, so that one button is the
// ONLY route to the site nav on a phone — and it was mounted through
// `document.querySelector('.header')?.append(...)`. Deleting the header turns an
// optional chain with nothing behind it into a silent no-op: every phone loses
// navigation, nothing throws, nothing logs, and every other check in this file
// stays green. That is §3.I exactly, and it is why these four exist.
//
// The mount id is READ from shared.js rather than written here. Restating it
// would be a second copy of the answer this section exists to police, and it
// would go stale in the dangerous direction — the page's id changing without
// this file noticing, which is the exact failure `check_outfit_page.mjs` parses
// `SAMPLES` out of the HTML to avoid.
console.log('\nthe mobile menu button, which only exists below 768px');

const OPEN_MOUNT = shared.match(/const OPEN_BUTTON_MOUNT = '([\w-]+)';/);

check(
  OPEN_MOUNT !== null,
  'shared.js names the open button\'s mount point as a constant this file can read',
  () => 'shared.js has no `const OPEN_BUTTON_MOUNT = \'...\'` — the mount point cannot be checked against the page without restating it here'
);

check(
  OPEN_MOUNT !== null && colorHtml.includes(`id="${OPEN_MOUNT[1]}"`),
  OPEN_MOUNT ? `and the page really carries id="${OPEN_MOUNT[1]}"` : 'and the page carries the mount id',
  () => {
    if (!OPEN_MOUNT) return 'the mount point could not be read, so its presence on the page is unknown';
    return `shared.js mounts the button on #${OPEN_MOUNT[1]} but color.html has no element with that id — initColorRail throws and the page's module script dies with it, taking every listener registered after that line`;
  }
);

check(
  /getElementById\(OPEN_BUTTON_MOUNT\)/.test(shared) && /if \(!panel\)/.test(shared),
  'and it is mounted with getElementById behind an explicit guard, not an optional chain',
  () => 'the mount went back to a `?.` or lost its guard — a missing mount is then a silent no-op, and below 768px that is the whole site nav'
);

// The button and the rail are the SAME decision in two places, so they belong in
// the same query. Split them and there is a width where the 64px rail is on
// screen beside the button that exists only to replace it, or a width with
// neither: the rail is unreachable and nothing is drawn in its place.
const railHiddenAt = cssCode.match(/@media \(max-width: 767\.98px\) \{([\s\S]*?)\n\}/);
check(
  railHiddenAt !== null
    && /\.cp-rail\s*\{\s*display:\s*none/.test(railHiddenAt[1])
    && /\.cp-rail-open\s*\{\s*display:\s*flex/.test(railHiddenAt[1]),
  'the button appears in the SAME query that hides the rail, so no width has both or neither',
  () => {
    if (railHiddenAt === null) return 'colors.css has no `@media (max-width: 767.98px)` block, so nothing decides between the rail and the button';
    return `block contents: ${railHiddenAt[1].trim().replace(/\s+/g, ' ')} — .cp-rail and .cp-rail-open must both appear in it`;
  }
);

// The button is absolutely positioned into its mount, so the mount has to be a
// positioned element or `top`/`right` resolve against the viewport instead.
const panelBlock = cssCode.match(/@media \(max-width: 1023px\) \{[\s\S]*?\n\}/);
const panelRule = panelBlock && panelBlock[0].match(/\.cp-panel\s*\{([^}]*)\}/);
check(
  panelRule !== null && /position:\s*relative/.test(panelRule[1]),
  'and .cp-panel is a positioned element below 1024px, so the button anchors to the panel rather than the viewport',
  () => `below 1024px .cp-panel reads ${panelRule ? panelRule[1].trim().replace(/\s+/g, ' ') : '(no .cp-panel rule in that block)'} — an absolutely positioned child of an unpositioned parent resolves its top/right against the viewport`
);

// The mount itself must never be display:none, or the button is mounted into a
// box that does not paint at the one width it exists for.
const panelHidden = cssCode.match(/\.cp-panel[^{}]*\{[^}]*display:\s*none[^}]*\}/);
check(
  panelHidden === null,
  'no rule ever sets display:none on the button\'s mount',
  () => `found ${panelHidden[0].replace(/\s+/g, ' ')} — the button would be mounted into a box that does not paint`
);

// `.cp-rail-top` is a COLUMN (brand over collapse toggle), so centring it in the
// 64px rail is `align-items`. It shipped in the same rule as three row
// containers, where `justify-content` was correct and there did nothing — a dead
// declaration that only started mattering when the brand made it a flex box.
check(
  /\.cp-rail\.is-collapsed \.cp-rail-top\s*\{\s*align-items:\s*center/.test(cssCode)
    && !/\.cp-rail\.is-collapsed \.cp-rail-top\s*,\s*\n\s*\.cp-rail\.is-collapsed \.cp-rail-link/.test(cssCode),
  'the collapsed rail centres its top row on align-items, the CROSS axis of a column box',
  () => '`.cp-rail-top` is in the justify-content rule again — that centres the MAIN axis of a column box, which is vertical, so the 40px logo sits off-centre in the 64px rail while every other item centres'
);

console.log('\nthe exporter\'s shared halves');
// These four exist because the highlighter and the roving-tabindex key map were
// lifted OUT of this page into modules `outfit.html` imports too. The failure
// they catch is a re-fork: a second definition, in a page or in a module, that
// renders identically and drifts invisibly.
check(
  /export function highlightCode/.test(highlighterSrc),
  'assets/js/code-highlight.js exports highlightCode',
  () => 'color.html imports highlightCode from code-highlight.js, so that is where it has to be defined'
);
check(
  /import\s*\{[^}]*\bhighlightCode\b[^}]*\}\s*from\s*['"]\.\/assets\/js\/code-highlight\.js['"]/.test(colorHtml),
  'color.html imports highlightCode from assets/js/code-highlight.js',
  () => 'color.html does not import the shared highlighter — it either still carries a local copy, or the code block is unhighlighted'
);
// `function highlight(` would also match `highlightCode`, so the word boundary is
// the point: this asserts the LOCAL copy is gone without tripping on the import.
check(
  !/function\s+highlight\b/.test(colorHtml),
  'and this page defines no local highlighter, so the two code blocks cannot diverge',
  () => 'color.html defines its own highlighter AND imports the shared one — one of the two is dead, and which one is not obvious from reading it'
);
check(
  /export function wireRoving/.test(shared) && /import\s*\{[^}]*\bwireRoving\b[^}]*\}\s*from\s*['"]\.\/assets\/js\/shared\.js['"]/.test(colorHtml),
  'the roving tabindex key map is shared.js\'s wireRoving, imported here',
  () => 'the tablist\'s arrow keys are not the shared implementation — a tablist without arrow keys is a WAI-ARIA authoring violation, so a local copy here would drift from the other three callers'
);
check(
  !/function\s+wireRoving\b/.test(colorHtml),
  'and this page defines none of its own',
  () => 'color.html defines its own wireRoving as well as importing the shared one'
);

console.log('');
console.log('panel controls');

// The format notation reaches BOTH the swatch label and `data-cp-copy`. Neither
// implies the other: a grid that renders `rgb(...)` and copies `#4CAF50` looks
// entirely correct and silently pastes the wrong value, which is the one thing
// the copy-follows-display rule exists to prevent. The label is checked
// separately below, in the browser probe, because a regex cannot tell what a
// page actually rendered.
const gridSource = paletteSrc.match(/export function paletteGridHtml[\s\S]*?\n}\n/)?.[0] || '';
const stripSource = paletteSrc.match(/export function paletteStripHtml[\s\S]*?\n}\n/)?.[0] || '';
for (const [label, src, fn] of [
  ['the grid', gridSource, 'paletteGridHtml'],
  ['the strip', stripSource, 'paletteStripHtml'],
]) {
  check(
    /const format = options\.format \|\| 'hex'/.test(src),
    `${label} accepts a format, defaulting to hex so colors-generator.html and colors-explore.html render byte-identically`,
    () => `${fn} has no 'format' option defaulting to hex — the default is not pinned, so a caller that omits it gets undefined`
  );
  check(
    /formatHex\(hex, format\)/.test(src),
    `${label} converts its labels through formatHex rather than printing the raw hex`,
    () => `${fn} ignores the format option and prints raw hex regardless`
  );
}
check(
  /data-cp-copy="\$\{text\}"/.test(gridSource),
  "the grid's data-cp-copy carries the FORMATTED value, so the delegated click handler copies what is on screen",
  () => "the grid writes the raw hex into data-cp-copy while displaying another notation — copy would silently disagree with the screen"
);

// The copy affordance is a glyph in a SPAN inside the cell button, matching
// pokemon-palette-display.tsx:186 in spirit but not in markup: it nests a real
// <button>, which is invalid inside a <button> and unreachable by keyboard
// anyway. Both properties are load-bearing, so both are pinned.
check(
  /class="cp-cell-copy"/.test(gridSource) && /<svg[^>]*>/.test(gridSource),
  'the grid emits the copy glyph, so the right-hand affordance is not left to a background-image or a ::after',
  () => 'paletteGridHtml renders no copy glyph — the reader is told to click a swatch with nothing on it showing that'
);
check(
  /aria-hidden="true"/.test(gridSource),
  'the copy glyph is aria-hidden, because the cell button already carries the name 複製 (copy) <value>',
  () => 'the glyph is exposed to assistive tech as a second, redundant control'
);
check(
  /<span class="cp-cell-copy"[^>]*>\s*<svg/.test(gridSource) && !/<button[^>]*class="cp-cell-copy"/.test(gridSource),
  'the glyph is a span, not a nested button — one focus stop, one accessible name, valid HTML',
  () => 'the glyph is a <button> nested inside the cell <button>, which is invalid HTML and adds a keyboard-reachable duplicate of the same action'
);

// The hover feedback. Scaling a swatch misreports the very thing the page exists
// to show, and it moves the target out from under the cursor.
const cellRule = css.match(/(?:^|\n)\.cp-cell\s*\{[^}]*\}/)?.[0] || '';
const cellHover = css.match(/(?:^|\n)\.cp-cell:hover\s*\{[^}]*\}/)?.[0] || '';
check(
  !/transform\s*:\s*scale/.test(cellRule) && !/transform\s*:\s*scale/.test(cellHover),
  'the cell never scales on hover — the fill is the content, and a transform moves the target',
  () => '`.cp-cell` scales under the cursor, which misreports the colour and shifts the swatch while you aim at it'
);
check(
  /transition:\s*border-color/.test(cellRule) && !/transition:[^;]*transform/.test(cellRule),
  'the cell transitions border-color rather than transform, so any later scale cannot be reintroduced smoothly by accident',
  () => 'the cell still transitions `transform` — a leftover from the scaling hover'
);
// An icon at reduced opacity blends toward the fill it sits on. 0.55 measures
// 2.37:1 against the greys where black and white are nearest tied; this project
// asks 3:1 of UI components.
const copyRule = css.match(/(?:^|\n)\.cp-cell-copy\s*\{[^}]*\}/)?.[0] || '';
const copyOpacity = copyRule.match(/opacity:\s*([\d.]+)/)?.[1];
check(
  copyOpacity === undefined || Number(copyOpacity) >= 1,
  'the copy glyph is fully opaque, the only way it clears 3:1 on every fill',
  () => `.cp-cell-copy is at opacity ${copyOpacity}; the glyph blends toward its own fill and drops under the 3:1 floor for UI components`
);
check(
  /color:\s*inherit/.test(copyRule),
  "the copy glyph inherits the cell's ink, which swatchStyle() already made AA-correct for that exact fill",
  () => '.cp-cell-copy sets its own colour — a hardcoded #fff is white-on-pale over roughly a third of any palette'
);
check(
  /\.cp-cell-copy:hover\s*\{[^}]*color-mix\(in srgb, currentColor/.test(css),
  'the glyph hover tints with its own ink, so the feedback is legible on any fill',
  () => '.cp-cell-copy:hover has no currentColor wash, so the hover feedback is invisible on light fills'
);
// The tip string is what both title and aria-label interpolate. If it is built
// from the raw hex, a screen reader is told a different colour than the eye sees
// — and the visible label says a third thing.
check(
  /const tip = `\$\{text\} · /.test(gridSource) && /aria-label="複製 \$\{tip\}"/.test(gridSource),
  "the grid's title AND aria-label are built from the formatted value, not the hex",
  () => 'the grid title/aria-label still describe the hex while the cell shows another notation — sighted and screen-reader users get different colours'
);
check(
  /class="cp-shade-hex">\$\{hex\}</.test(colorHtml),
  'the shade scale stays on hex whatever the grid is showing, because hex is the stable identity of a derived ramp',
  () => 'the shade scale follows the format switch, so a ramp step can no longer be found by the hex it is documented with'
);

// --- The shade scale is THREE ramps, each seeded from its own colour --------
//
// One ramp from the primary left the other five measured colours as bare
// swatches with nothing derived from them. It is now the top three by share,
// and each row generates from its OWN hex rather than from `primary`.
//
// That second half is the one worth a checker. `generateTailwindScale` keeps
// its seed verbatim at the anchor step and the page marks that step, so three
// ramps all seeded from `primary` would render three credible-looking rows
// with three ★s — every one of them a lie about which colour the row is. The
// block is sliced out rather than matched against the whole file so that a
// `generateTailwindScale(primary)` elsewhere in the page cannot satisfy, or
// mask, this.
const scaleBlock = colorHtml.slice(
  colorHtml.indexOf('// 4. Shade scale'),
  colorHtml.indexOf('// 5. Showcase')
);
check(
  /const scaleRows = rows\.slice\(0,\s*3\)/.test(scaleBlock),
  'the shade scale renders exactly the top THREE palette colours, so the section is not one ramp with five bare swatches beside it',
  () => 'the shade scale does not take rows.slice(0, 3) — it is either still one ramp, or a row count nobody chose'
);
check(
  /scaleRows\.map\(\(\[seedHex\], rank\)/.test(scaleBlock) && /generateTailwindScale\(seedHex\)/.test(scaleBlock),
  "each row's ramp is seeded from that row's own hex, which is the only thing that makes the ★ mean that colour",
  () => 'the ramp is not generated from the row it is drawn in, so the ★ is marking a colour the row is not showing'
);
check(
  !/generateTailwindScale\(\s*primary\s*\)/.test(scaleBlock),
  "no ramp is seeded from `primary`, which would put three identical ★s on three rows claiming three different colours",
  () => 'a ramp is still seeded from `primary`'
);
// The seed bar is a colour with no text in it, so its accessible name cannot
// come from its content the way `.cp-shade-hex` does.
check(
  /class="cp-scale-seed"[\s\S]{0,200}?aria-label="複製色盤第 \$\{rank \+ 1\} 色/.test(scaleBlock),
  'the seed bar carries its own accessible name, because a colour chip with no text has nothing else to be named by',
  () => 'the seed bar is a button with no text and no aria-label — it is announced only as "button"'
);
check(
  /\.cp-scale-seed\s*\{[^}]*\}/.test(css) && /\.cp-scale-row\s*\{[^}]*grid-template-columns/.test(css),
  'the seed bar and its row gutter are styled, so a bare chip cannot collapse to a 0×0 element beside the ramp',
  () => 'colors.css has no `.cp-scale-seed` / grid-template-columns rule for `.cp-scale-row`, so the markup has no layout to render into'
);
check(
  /<div id="scale" class="cp-scale-stack">/.test(colorHtml) && /\.cp-scale-stack\s*\{[^}]*flex-direction:\s*column/.test(css),
  'the rows are stacked with a gap of their own, so three ramps do not read as one 33-cell grid',
  () => 'the scale container carries no `.cp-scale-stack` column, so the three ramps touch and the row boundary is invisible'
);
// And the prose, which is the claim a reader actually checks against the ★.
// The old sentence said 「★ 標示的是主要色本身」 ("the ★ marks the primary
// itself"), which was true of one ramp and false the moment there are three.
const scaleProse = (colorHtml.match(/id="sec-scale"[\s\S]*?<div id="scale"/) || [''])[0];
check(
  /該列色票本身/.test(scaleProse) && !/主要色本身/.test(scaleProse),
  "the section's prose says the ★ marks THAT ROW's swatch, which is what the page now draws",
  () => "the prose still claims the ★ marks the primary — on three rows only one of them is the primary, so the sentence is false for two of them"
);

// --- The showcase gets its OWN ramp, named -----------------------------------
//
// This one failed for real, and the shape of it is worth pinning. Moving the
// ramps inside the row callback took `const { scale, anchor }` out of
// render()'s scope, and the showcase call's shorthand `scale,` did not throw —
// it resolved to `window.scale`, because every element id is a named property of
// the document and this page has `<div id="scale">`. A DOM node answers
// `scale['50']` as `undefined`, so showcaseHtml's `scale[step] || primary`
// returned the primary for EVERY step, which set --cp-sf, --cp-ink and --cp-bd
// all to one colour and drew 「色彩美學」 ("color aesthetics") in the primary on
// a primary background.
//
// The three words that matter: silent, invisible, and in the one section whose
// entire job is to prove the palette is readable.
const showcaseBlock = colorHtml.slice(
  colorHtml.indexOf('// 5. Showcase'),
  colorHtml.indexOf('// 6. Export Theme')
);
check(
  /const \{ scale: primaryScale \} = generateTailwindScale\(primary\)/.test(showcaseBlock)
    && !/^\s*scale,\s*$/m.test(showcaseBlock),
  'the showcase generates its own ramp from `primary` and names it, rather than relying on a bare `scale` being in scope',
  () => "the showcase passes a bare `scale,`. With no local `const scale` in scope that is `window.scale` — the `<div id=\"scale\">` — and `scale[step] || primary` then answers the primary for every step, which paints ink and surface the same colour and shows nothing"
);

const radioValues = [...colorHtml.matchAll(/class="cp-tab-input"[^>]*value="([a-z]+)"/g)].map(m => m[1]);
check(
  /import\s*\{[^}]*\bHEX_FORMATS\b[^}]*\}\s*from\s*'\.\/assets\/js\/color-palette\.js'/.test(colorHtml),
  'color.html imports HEX_FORMATS rather than re-typing the three notations',
  () => 'color.html does not import HEX_FORMATS, so the panel and the formatter each carry their own list of notations'
);
check(
  radioValues.length === 3 && ['hex', 'rgb', 'hsl'].every(v => radioValues.includes(v)),
  'the panel offers exactly the three notations HEX_FORMATS declares',
  () => `the panel's radios are [${radioValues.join(', ')}], expected hex, rgb, hsl — a fourth or a missing one means the control and the list disagree`
);
// Both directions, because the two lists are edited by hand in different files:
// a notation added to HEX_FORMATS alone leaves a tab that does nothing, and one
// removed from it leaves a tab that cannot format anything. Either way the page
// must say so, because nothing else will.
// Compare the two lists rather than only asserting the guard's source text is
// present. The lists live in different files and are edited by hand, so drift is
// a matter of time; and each direction of drift is silent — a tab that does
// nothing, or one that cannot format anything. The runtime `console.warn` makes
// it visible to a developer with the console open; this makes it a build
// failure for everyone, including whoever never opens devtools.
const declaredFormats = [...(paletteSrc.match(/HEX_FORMATS\s*=\s*\[([^\]]*)\]/) || [, ''])[0]
  .matchAll(/['"]([a-z]+)['"]/g)].map(m => m[1]);
const orphans = declaredFormats.filter(f => !radioValues.includes(f));
const unbacked = radioValues.filter(v => !declaredFormats.includes(v));
check(
  declaredFormats.length > 0 && orphans.length === 0 && unbacked.length === 0,
  `the panel's radios and HEX_FORMATS are the same set (${radioValues.join(', ')}), so no tab can be inert or unbacked`,
  () => {
    const bits = [];
    if (orphans.length) bits.push(`HEX_FORMATS declares ${orphans.join(', ')} with no radio to reach it`);
    if (unbacked.length) bits.push(`radios offer ${unbacked.join(', ')} that HEX_FORMATS does not declare`);
    if (!declaredFormats.length) bits.push('HEX_FORMATS could not be parsed out of color-palette.js');
    return bits.join('; ');
  }
);
// ...and the page must be the thing that notices at runtime, since the checker
// only runs in this repo and the page runs everywhere else.
check(
  /HEX_FORMATS\.includes\(r\.value\)/.test(colorHtml) && /no radio offers it/.test(colorHtml),
  'color.html warns at startup for a one-sided edit, so the failure is visible in the console of a deployed page too',
  () => 'color.html never compares its radios against HEX_FORMATS, so a deployed page fails silently when the lists drift'
);
check(
  /name="cp-format"/.test(colorHtml) && [...radioValues].every(v => colorHtml.includes(`value="${v}"`)),
  'the three radios share one name, so the browser enforces mutual exclusion',
  () => "the format radios do not share a name, so more than one can be checked and 'which notation is this' stops having one answer"
);

// A display:none input leaves the tab order: three tabs become zero controls for
// a keyboard user while the markup still looks complete. That is the failure a
// "the markup contains a radio" check cannot see.
check(
  /\.cp-tab-input\s*\{[^}]*clip-path:\s*inset\(50%\)/.test(css)
    && !/display:\s*none/.test((css.match(/\.cp-tab-input\s*\{[^}]*\}/) || [''])[0]),
  'the format radios are clipped, not display:none, so they stay in the tab order',
  () => 'the format radios are display:none or unclipped, which takes them out of the tab order'
);
// ...and the ring must be painted on the LABEL, because the input is 1px across
// and a 1px outline is a ring nobody can see.
check(
  /\.cp-format-tabs \.sc-tab:has\(\.cp-tab-input:focus-visible\)\s*\{[^}]*outline:/.test(css),
  'the focus ring is painted on the LABEL, since the input it belongs to is clipped to 1px',
  () => 'no focus-visible outline targets the label, so keyboard focus on a clipped radio shows no ring'
);

check(
  /<form class="cp-panel-group" id="dex-form"/.test(colorHtml),
  'the dex control is a real <form>, so Enter submits without a hand-rolled keydown',
  () => 'the dex control is not a <form>, so Enter-to-submit is not guaranteed'
);
// type=number inside an overflow-y:auto panel eats the scroll wheel to change
// its own value, so hovering the field to scroll the panel silently edits it.
check(
  /id="dex-input"[\s\S]{0,140}?inputmode="numeric"/.test(colorHtml),
  'the dex field is a text input with inputmode=numeric',
  () => 'the dex field has no inputmode=numeric, so phones raise the full keyboard instead of the numeric pad'
);
check(
  !/type="number"[^>]*id="dex-input"|id="dex-input"[^>]*type="number"/.test(colorHtml),
  'the dex field is NOT type=number, whose wheel handler would edit the value while the reader scrolls this scrollport',
  () => 'the dex field is type=number inside a scrollable panel'
);
// All-digits and in-range are two failures with two messages. A `{1,4}` regex
// answered "全國編號只能是數字" ("the national dex number must be numeric") for
// 99999, which is a perfectly good number.
check(
  /!\/\^\\d\+\$\/\.test\(raw\)/.test(colorHtml),
  'the digits test is /^\\d+$/, so a 5-digit value reports RANGE rather than "not a number"',
  () => 'the digits test bounds the length, misreporting an out-of-range dex as a non-numeric one'
);
check(
  /全國編號範圍是 1–\$\{pokemon\.length\}/.test(colorHtml),
  'the range error names the real upper bound from the loaded data',
  () => 'the out-of-range message hardcodes or omits the range'
);
check(
  /class="sr-only"[^>]*id="cp-announce"[^>]*role="status"[^>]*aria-live="polite"/.test(colorHtml),
  'a polite sr-only live region announces a successful jump',
  () => 'no polite sr-only live region announces the jump, so the content change is silent for a screen reader — or visible, which is a label the reader must go hunting for'
);

// ── every getElementById in color.html resolves ──────────────────────────────
// This is the check that was missing when the Export Theme section was rebuilt.
// Three `els` keys survived the rewrite pointing at ids the new markup no longer
// had (#theme-code, #copy-theme, #copy-json), all three resolved to null, and
// `els.copyTheme.addEventListener` threw at module top level — which aborted the
// module before init(), so the page never loaded a Pokémon at all. Every other
// check here was green throughout, because a null *reference* is legal JS and
// only the browser could see it. Static checks are all that is available without
// one, so this asserts the invariant that would have held: an id that is looked
// up by name must exist in the same document.
const lookups = [...colorHtml.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(m => m[1]);
const declaredIds = new Set([...colorHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
// `theme-preview` and friends are written by the exporter too, but a duplicate
// querySelectorAll is not a lookup failure, so only the ids matter here.
const dangling = [...new Set(lookups)].filter(id => !declaredIds.has(id));
check(
  dangling.length === 0,
  `all ${new Set(lookups).size} getElementById targets exist in color.html`,
  () => `getElementById looks up ${dangling.map(id => `\`#${id}\``).join(', ')}, which color.html never declares — each resolves to null and the first .addEventListener on one throws, killing the rest of the module (including init())`
);
check(
  lookups.length > 0,
  'the id-completeness check found something to check',
  () => 'no getElementById calls were found, so the check above is vacuously green — its regex probably no longer matches'
);

// Every class the exporter's generated markup emits must be styled, or the
// preview silently falls back to unstyled text. Cheaper than opening a browser
// and cheaper than noticing a week later.
const EXPORTER_CLASSES = [
  'cp-theme-token-swatch', 'cp-theme-token-label', 'cp-theme-token-var',
  'cp-theme-token-btn', 'cp-badge-primary', 'cp-badge-secondary', 'cp-badge-accent',
  'cp-theme-progress-track', 'cp-theme-progress-bar', 'cp-theme-progress-text',
  'cp-theme-card-demo', 'cp-theme-card-title', 'cp-theme-card-sub',
  'cp-comment', 'cp-key', 'cp-string', 'cp-num', 'cp-hex', 'cp-hex-dot', 'cp-toast',
];
// A boundary is required on the class name, not a substring: `.cp-theme-token-var`
// is contained in `.cp-theme-token-var-RENAMED`, so a plain includes() reports a
// renamed-away rule as still styled. Same trap as the data-cp-copy case below.
const unstyled = EXPORTER_CLASSES.filter(c => !new RegExp(`\\.${c}(?![a-zA-Z0-9_-])`).test(css));
check(
  unstyled.length === 0,
  `all ${EXPORTER_CLASSES.length} exporter classes are styled`,
  () => `the exporter emits ${unstyled.map(c => `.\`${c}\``).join(', ')} but colors.css never styles them`
);

// A var() naming a custom property that no stylesheet defines is not an error
// the browser reports — the declaration is simply dropped at computed-value
// time, so the property falls back to inherited/initial with no error anywhere.
// The first Theme Exporter draft was written against the reference project's
// shadcn vocabulary (--surface-1, --surface-2, --border, --text-tertiary,
// --shadow-sm), none of which exist in shared.css, so half the section was
// rendering unstyled and invisible.
//
// Scoped to the exporter block on purpose. The rest of this 3,500-line file has
// its own pre-existing gaps, and a check that reports those would be red on a
// clean tree and get ignored, which is the same fate as the check that should
// have caught this.
const exporterCss = (css.match(/\/\* ── Theme Exporter[\s\S]*$/) || [''])[0];
check(
  exporterCss.length > 0,
  'the Theme Exporter CSS block is locatable',
  () => 'the `/* ── Theme Exporter` marker is gone from colors.css, so the two checks scoped to it are vacuously green'
);
const definedVars = new Set([
  ...[...read('assets/css/shared.css').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]),
  ...[...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]),
]);
// Written from JS: themeVarBlock() stamps every shadcn token onto #theme-preview.
const jsSupplied = new Set(['--background', '--foreground', '--card', '--card-foreground', '--popover',
  '--popover-foreground', '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground', '--accent', '--accent-foreground', '--destructive', '--border',
  '--input', '--ring']);
// --font-mono is read across the whole site and declared nowhere, so every
// var(--font-mono) in this repo is already a no-op. It predates this block and
// defining it belongs in shared.css; until then it is exempted here rather than
// allowed to mask a genuinely new bad var.
const KNOWN_UNDEFINED = new Set(['--font-mono']);
const exporterVars = [...exporterCss.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(?:,|\))/g)].map(m => m[1]);
const undefinedVars = [...new Set(exporterVars)].filter(v => !definedVars.has(v) && !jsSupplied.has(v) && !KNOWN_UNDEFINED.has(v));
check(
  undefinedVars.length === 0,
  `all ${new Set(exporterVars).size} custom properties read by the Theme Exporter are defined (or supplied by themeVarBlock)`,
  () => `the Theme Exporter reads ${undefinedVars.map(v => `\`var(${v})\``).join(', ')}, which no stylesheet defines — each of those declarations is dropped at computed-value time and the element falls back to inherited/initial with no error logged`
);

console.log();
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All colour-page shell checks passed');
