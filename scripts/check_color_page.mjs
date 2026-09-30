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
 *    group's `pages` — which is what makes the group light up — but had no
 *    sub-item pointing at it. The page therefore marked NOTHING current, and
 *    the rail offered no way back to it. `pages` and `groups` are separate
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
// looking in the wrong file (the gotcha 42 lesson). So the detail is never
// allowed to be empty — the reason is always named, even if the computed list
// of offenders came back empty, which is how a mis-written predicate is caught.
const check = (cond, ok, bad) => {
  if (cond) return pass(ok);
  const why = typeof bad === 'function' ? bad() : bad;
  fail(why ? why : `${ok} — the check failed but the detail was empty (predicate disagrees with its own message)`);
};

// --- read the sources -------------------------------------------------------

const shared = read('assets/js/shared.js');
const css = read('assets/css/colors.css');
const colorHtml = read('color.html');

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
  // discards every readable line printed above it (gotcha 38).
  fail(`could not lift NAV / PLANNED_PAGES out of shared.js — ${e.message}`);
  console.log('\n1 check(s) failed');
  process.exit(1);
}

console.log('NAV integrity');

// Every href a NAV row can send the user to must resolve, or be registered as
// planned. A typo'd href is a dead link that renders identically to a good one.
const plannedSlugs = new Set(PLANNED.map((p) => p.slug));
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
const everyPage = [...new Set(rowTargets.map((t) => t.href))];
const claims = new Map();
const triggerPages = new Map();
for (const page of everyPage) {
  const owners = [];
  for (const item of NAV) {
    const ownHref = item.href === page;
    const inPages = (item.pages || []).includes(page);
    const isGroup = !!(item.groups && item.groups.length);
    const groupRows = isGroup
      ? item.groups.flatMap((g) => g.items).filter((it) => !it.planned && it.href === page)
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
  () => [...claims].filter(([, o]) => o.some((x) => x.endsWith('no row'))).map(([p, o]) => `${p} [${o.join('; ')}]`).join(' | ')
);
check(
  [...triggerPages.keys()].length === 0,
  'no group trigger carries aria-current: the exact row claims the page',
  () => `trigger-level claims: ${[...triggerPages.keys()].join(', ')}`
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

console.log();
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All colour-page shell checks passed');
