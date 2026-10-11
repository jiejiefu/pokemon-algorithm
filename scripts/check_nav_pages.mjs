/**
 * Every page that should carry the shared nav is asserted to mount it — the one
 * direction the NAV checker cannot see.
 *
 *   node scripts/check_nav_pages.mjs
 *
 * WHY THIS FILE EXISTS. check_color_page.mjs owns NAV and guards it hard: 761
 * checks over the table, lifted out of shared.js and evaluated rather than
 * scraped, covering every link target, every page claimed by exactly one
 * element, no trigger wearing aria-current, and the [hidden] companion rules.
 * All of that is NAV's internal integrity. It reads exactly ONE page —
 * `read('color.html')` — because a claim about the table says nothing about the
 * documents that consume it, and the set of consumers is what actually renders.
 *
 * So the failure this guards against is a page whose nav container is empty at
 * runtime. `initHeaderNav()` writes the container's innerHTML, which means
 * deleting the call is not a syntax error, not a 404, and not a broken link: the
 * header still lays out, the theme toggle still works, the logo still links
 * home, and the only visible symptom is that 演算法 / 色彩 / 3D 模型 are missing
 * from a page that is one of them. Measured, not assumed: in a scratch copy of
 * the tree, deleting `initHeaderNav();` from sorting.html left
 * check_color_page.mjs exiting 0 with all 761 checks passing.
 *
 * WHY NOT THE GREP. assets/js/shared.js tells the reader to verify with
 * `rg -l initHeaderNav *.html`, and that grep cannot answer the question it is
 * cited for. It matches imports and comments as readily as calls. Deleting
 * sorting.html's call leaves the file listed, because the import still names the
 * symbol; and two pages contain the bare token inside a COMMENT — maze.html:110
 * ("so initHeaderNav()'s default filename match is enough") and detail.html:45
 * ("`initHeaderNav('pokedex.html')` below marks 圖鑑"). A `src.includes(
 * 'initHeaderNav(')` test would therefore report both of those pages as mounting
 * the nav with the call deleted — on the two pages where it was added last. So
 * every assertion here looks for a STATEMENT (a line that starts with the call)
 * and for the import that makes the symbol real, never for a substring.
 *
 * WHAT IS ASSERTED. The page set is derived from the directory, not written
 * down: `readdirSync` over the root, minus three documented kinds of non-page.
 * That is what makes this future-proof — a new page is covered the moment it
 * exists, with no list to update and no count to bump, which is the same
 * reasoning behind EXPECTED_NAV_PAGES being a number rather than a list. The
 * cost of a derived set is that the exclusions can rot into a place to hide a
 * regression, so each exclusion is itself asserted to still be doing its job:
 * 404.html must still be a redirect stub, and color.html must still mount the
 * rail that replaces the nav.
 *
 * NOT ASSERTED HERE, DELIBERATELY: that a mounting page is CLAIMED by NAV, i.e.
 * that it marks something current. That direction needs NAV evaluated, and the
 * comment-masking table-lifter that does it is private to check_color_page.mjs.
 * Copying it would create a second copy of tricky code to keep in sync, and
 * hoisting it would edit a 36KB checker that is currently green — for a gap that
 * degrades to a nav that renders with nothing marked rather than no nav at all.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
// A FAIL that prints an empty message is worse than no check: it reads as a
// blank line, and `1 check(s) failed` with nothing to act on sends the reader
// looking in the wrong file (gotcha 42). The reason is never allowed to be
// empty — which is also how a mis-written predicate gets caught, because the
// computed offender list comes back empty precisely when the message and the
// condition disagree.
/* `ok — why`, not `why`. The description is what names the assertion, and dropping
 * it on failure makes a red line impossible to identify afterwards: fifteen
 * details here all begin with the offending page's name, so a reader has to grep
 * the source to learn which of the sixteen checks just failed. It also breaks the
 * negative suites, which are required to name the ASSERTION — they match on the
 * failure report, and a report that never states the assertion can only be matched
 * on the detail, which is the string a page's own wording could plausibly contain.
 * This is the same defect check_color_page.mjs had; it is fixed there too.
 */
const check = (cond, ok, bad) => {
  if (cond) return pass(ok);
  const why = typeof bad === 'function' ? bad() : bad;
  fail(`${ok} — ${why ? why : 'the check failed but the detail was empty (predicate disagrees with its own message)'}`);
};

/* A hook attribute name, matched as a WHOLE attribute. `\b` is not enough:
   `data-nav` sits inside `data-nav-toggle` and `data-nav-drawer`, and between
   `nav` and the following `-` there is a word boundary, so /\bdata-nav\b/
   matches all three. color.html is full of `data-nav-id` for its evolution
   chain, which makes the same mistake twice. */
const hook = (name) => new RegExp(`\\b${name}(?![\\w-])`);
/** Every opening tag in `html` carrying `name`, e.g. the one `<button>` that
 *  owns data-nav-toggle. Order-independent on purpose: the assertions below
 *  care that the hook sits on an element of the right kind, not that an
 *  attribute kept its column. */
const tagsWith = (html, name) =>
  [...html.matchAll(new RegExp(`<([a-z]+)\\b[^>]*${hook(name).source}[^>]*>`, 'gi'))].map((m) => m[0]);

/* A real invocation is a STATEMENT, so it has to start its line. Comments in
   this repo quote the call verbatim — maze.html and detail.html both do — which
   is exactly why a substring test is not good enough. */
const CALL = /^[ \t]*initHeaderNav\(/m;
const callCount = (html) => (html.match(/^[ \t]*initHeaderNav\(/gm) || []).length;
/* The import is what makes the symbol real, in the shape check_sv_index.mjs
   already uses for hasSv/svUrl. `[^}]*` is a character class, so it crosses the
   newlines that eight of these pages wrap their imports across, while being
   unable to escape one import block into the next. */
const IMPORT = /import\s*\{[^}]*\binitHeaderNav\b[^}]*\}\s*from\s*['"][^'"]*assets\/js\/shared\.js['"]/;

// --- the page set, derived --------------------------------------------------

// Three kinds of root html that are not pages this check governs. Each entry
// carries its reason, because an unexplained exclusion is indistinguishable
// from a bug, and the reasons are asserted to still hold below.
const NON_PAGES = new Map([
  ['404.html', 'a location.replace stub for /detail/<slug> — it has no header at all'],
  ['color.html', "its rail REPLACES the nav rather than joining it (initColorRail)"],
]);
/* The InfoPoke page captures the generators parse — 17 files, 3.1MB of
   third-party markup, ignored at .gitignore for exactly that reason. They are
   matched as a PREFIX rather than listed so a newly fetched capture cannot
   become a failing page. */
const isCapture = (f) => f.startsWith('infopoke_net_') && f.endsWith('.html');

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const sitePages = htmlFiles.filter((f) => !NON_PAGES.has(f) && !isCapture(f));
const captures = htmlFiles.filter(isCapture);

console.log('page set');

check(sitePages.length > 0, `${sitePages.length} pages mount the shared nav`,
  () => `no page was classified as a site page — the classification is broken, not the site (root html: ${htmlFiles.join(', ')})`);

// An exclusion naming a file that is gone is a stale exemption: it would keep
// working while quietly covering a future page of the same name.
const deadExclusions = [...NON_PAGES.keys()].filter((f) => !htmlFiles.includes(f));
check(deadExclusions.length === 0, 'every named exclusion is still a file on disk',
  () => `exclusion names a file that no longer exists: ${deadExclusions.join(', ')} — it would silently exempt a future page of that name`);

// --- every page mounts it ---------------------------------------------------

console.log('\nmounting');

const sources = new Map(sitePages.map((f) => [f, read(f)]));
const noCall = sitePages.filter((f) => !CALL.test(sources.get(f)));
check(noCall.length === 0, `all ${sitePages.length} pages call initHeaderNav()`,
  () => `pages with no initHeaderNav() call: ${noCall.join(', ')} — the nav container stays empty, so the header renders with no nav at all (an import or a comment mentioning the call does not mount it). If a page is deliberately nav-less, give it a reason in NON_PAGES above rather than deleting the check.`);

const manyCalls = sitePages.filter((f) => callCount(sources.get(f)) !== 1);
check(manyCalls.length === 0, 'every page calls initHeaderNav() exactly once',
  () => `pages whose call count is not one: ${manyCalls.map((f) => `${f} (${callCount(sources.get(f))})`).join(', ')} — a second call re-renders the trigger's current state onto a DOM that already has it`);

const noImport = sitePages.filter((f) => !IMPORT.test(sources.get(f)));
check(noImport.length === 0, `all ${sitePages.length} pages import initHeaderNav from shared.js`,
  () => `pages that call it without importing it: ${noImport.join(', ')} — that is a ReferenceError at module scope, so the rest of the page's script never runs either`);

// --- the mount points -------------------------------------------------------

console.log('\nmount points');

const missingHook = [];
const badToggle = [];
const badDrawer = [];
const handWritten = [];
for (const [file, html] of sources) {
  const navTags = tagsWith(html, 'data-nav').filter((t) => /^<nav\b/.test(t));
  const toggles = tagsWith(html, 'data-nav-toggle');
  const drawers = tagsWith(html, 'data-nav-drawer');

  if (navTags.length !== 1) missingHook.push(`${file} (${navTags.length} <nav data-nav>)`);
  if (toggles.length !== 1) missingHook.push(`${file} (${toggles.length} [data-nav-toggle])`);
  if (drawers.length !== 1) missingHook.push(`${file} (${drawers.length} [data-nav-drawer])`);

  // The button is what a phone has to reach the nav, so it is asserted as a
  // button of the right class carrying both aria hooks: aria-expanded is what
  // tells a screen reader whether the drawer is open, and the label is the only
  // accessible name on an icon-only control. Matched as whole attributes —
  // `includes('aria-label')` is also satisfied by aria-labelledby, which names
  // no control of its own and would leave the button unnamed.
  const t = toggles[0] || '';
  if (toggles.length === 1 && !(/^<button\b/.test(t) && t.includes('site-nav-toggle')
    && hook('aria-expanded').test(t) && hook('aria-label').test(t))) {
    badToggle.push(`${file} [${t.trim()}]`);
  }

  // `hidden` is a UA rule at (0,1,0); a drawer that is not hidden paints over
  // the page on desktop until CSS outranks it. The runtime opens and closes the
  // drawer by assigning `drawer.hidden` (shared.js:1043), so `hidden` is the
  // attribute that has to be there — and it is matched as a bare boolean, since
  // `aria-hidden` contains it after a hyphen and would satisfy /\bhidden\b/.
  const d = drawers[0] || '';
  if (drawers.length === 1 && !(/^<div\b/.test(d) && d.includes('site-nav-drawer')
    && /\shidden(?=[\s>/])/.test(d))) {
    badDrawer.push(`${file} [${d.trim()}]`);
  }

  // The regression the NAV comment describes: five hand-maintained copies of the
  // same <nav> drifting into three link sets. initHeaderNav() fills this
  // container, so anything authored inside it is either overwritten or doubled.
  const block = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (block && /<a\b/.test(block[1])) handWritten.push(file);
}

check(missingHook.length === 0, 'every page carries exactly one of each mount hook',
  () => `missing or duplicated mount hooks: ${missingHook.join('; ')} — initHeaderNav() writes every element with these hooks, so a missing one is a part of the nav that never appears`);
check(badToggle.length === 0, 'every toggle is a classed <button> with aria-expanded and an accessible name',
  () => `unusable toggle: ${badToggle.join('; ')}`);
check(badDrawer.length === 0, `every drawer is a classed <div data-nav-drawer hidden>`,
  () => `unusable drawer: ${badDrawer.join('; ')}`);
check(handWritten.length === 0, 'no page hand-writes links inside its nav container',
  () => `pages with <a> inside <nav class="site-nav">: ${handWritten.join(', ')} — initHeaderNav() owns that container's contents`);

/* --- the header carries a modifier, and the BASE class is a COLUMN ----------
 *
 * `.header` in shared.css is `flex-direction: column` with `gap: 10px`. The row
 * layout every page actually renders comes from a SEPARATE rule listing six
 * modifier classes (shared.css:1237) — `.header-dex, .header-3d, .header-colors,
 * .header-detail, .header-sort, .header-maze` — which supply `flex-direction: row`,
 * `gap: 20px` and `padding-right: 62px` for the absolutely-positioned toggle.
 *
 * So `<header class="header">` on its own is not a missing-style page: it is a
 * VALID class that renders the column layout, and every hook, import and call in
 * this file passes on it. Measured on spectrum.html at 1400x900 before the fix:
 * the header grew 55px -> 98px, the nav dropped to y=59 on a row of its own, its
 * right edge landed at 1380 against a theme toggle starting at 1350, and the two
 * overlapped. Nothing in the console, nothing in the network, nothing here.
 *
 * The six names are READ OUT of shared.css rather than restated, because a
 * hardcoded copy is a second thing to keep right and would keep passing after
 * shared.css renamed one.
 */
const ROW_HEADER_CLASSES = (() => {
  const css = readFileSync(join(ROOT, 'assets/css/shared.css'), 'utf8');
  // The block is the one rule that sets `padding-right: 62px` in the header's own
  // section — the media query at the bottom repeats the value, so the search is
  // anchored to a rule that also sets `flex-direction: row`.
  const block = css.match(/(\.header-[\w-]+(?:\s*,\s*\.header-[\w-]+)*)\s*\{[^}]*flex-direction:\s*row[^}]*\}/);
  if (!block) return [];
  return block[1].split(',').map((s) => s.trim()).filter((s) => s.startsWith('.header-'));
})();

check(ROW_HEADER_CLASSES.length > 0, `the row-layout modifier list is still in shared.css (${ROW_HEADER_CLASSES.length} classes)`,
  () => 'no rule in shared.css sets `flex-direction: row` on a .header-* class — this check cannot see the layout it is guarding, so it would pass on any page');

const bareHeaders = [];
const unknownHeader = [];
for (const [file, html] of sources) {
  const tag = (html.match(/<header\b[^>]*>/) || [''])[0];
  if (!/\bclass="[^"]*\bheader\b/.test(tag)) continue;      // a page with no .header at all is caught above
  const classes = (tag.match(/\bclass="([^"]*)"/) || [, ''])[1].split(/\s+/);
  const modifiers = classes.filter((c) => ROW_HEADER_CLASSES.includes(`.${c}`));
  if (modifiers.length === 0) bareHeaders.push(file);
  else if (modifiers.length > 1) unknownHeader.push(`${file} (${modifiers.join(' ')})`);
}

check(bareHeaders.length === 0, `all ${sitePages.length} headers carry one of the ${ROW_HEADER_CLASSES.length} row-layout modifiers`,
  () => `headers with a bare class="header": ${bareHeaders.join(', ')} — .header on its own is flex-direction: COLUMN, so the nav falls onto a second row and collides with the theme toggle. Give it the modifier its family uses (${ROW_HEADER_CLASSES.join(', ')}).`);
check(unknownHeader.length === 0, 'no header carries two row-layout modifiers, so the last one cannot silently win',
  () => `headers with several modifiers: ${unknownHeader.join(', ')} — they each set --page-accent, background and position, so the winner depends on source order rather than on intent`);

/* The theme toggle's contents belong to initThemeToggle(), exactly as the nav's
 * belong to initHeaderNav() — and the runtime's own guard is the trap.
 *
 * initThemeToggle() injects its sun/moon pair only `if (!btn.querySelector('.icon-sun'))`.
 * So a page that hardcodes a DIFFERENTLY-CLASSED pair satisfies nothing: the guard
 * is still true, the canonical pair is injected as well, and the button ends up
 * with four children in a 34px grid box. Measured on spectrum.html with two
 * `<svg class="theme-icon theme-icon-*">`: no stylesheet has any `.theme-icon` rule,
 * so both stayed `display: block` in BOTH themes while the injected pair toggled —
 * three visible symbols, and the third 18px icon landed at y=49 inside a button
 * whose bottom edge is y=46, painting outside it.
 *
 * Nothing threw and nothing logged. The label, the role and the click handler were
 * all correct, so every other check in this file passed.
 */
const handDrawnIcons = [];
for (const [file, html] of sources) {
  const btn = html.match(/<button class="theme-toggle"[^>]*>([\s\S]*?)<\/button>/);
  if (!btn) continue;                                   // a page with no toggle is a different claim
  if (/<[a-z]/.test(btn[1])) handDrawnIcons.push(`${file} [${btn[1].trim().slice(0, 60)}]`);
}
check(handDrawnIcons.length === 0, 'no page hard-writes icons inside its theme toggle',
  () => `theme toggles with authored children: ${handDrawnIcons.join('; ')} — initThemeToggle() injects the sun/moon pair itself, and its guard only looks for .icon-sun, so a differently-named pair is not skipped but doubled`);

// --- the call's argument ----------------------------------------------------

console.log('\ncurrent-page argument');

/* Three pages pass a filename: colors and colors-explore pass their own, and
   detail passes 'pokedex.html' because it appears in no `href` and no `pages`.
   So the argument is not required to be the page's own name — but it IS a
   filename the runtime matches on, and a typo in it fails silently: the nav
   renders, nothing lights up, and nothing throws. Hence the existence check. */
const badArgs = [];
for (const [file, html] of sources) {
  const arg = (html.match(/^[ \t]*initHeaderNav\(([^)]*)\)/m) || ['', ''])[1].trim();
  if (!arg) continue;
  const quoted = /^'([^']+)'|^"([^"]+)"$/.exec(arg);
  const target = quoted ? (quoted[1] ?? quoted[2]) : null;
  if (!target || !target.endsWith('.html') || !existsSync(join(ROOT, target))) {
    badArgs.push(`${file} -> ${arg}`);
  }
}
check(badArgs.length === 0, 'every filename passed to initHeaderNav() names a real page',
  () => `arguments that are not an existing .html filename: ${badArgs.join(', ')} — a miss here is silent: the nav renders with nothing marked current`);

// --- the GitHub mark is visible on the theme it is shown on ----------------

/* IT SHIPPED INVERTED, AND EVERY CHECK IN THE SUITE WAS GREEN WHILE IT DID.
 *
 * The footer's two marks were classed by THEME (`.gh-dark`, `.gh-light`) while
 * the FILES are named by COLOUR (github-invertocat-black.svg). The two rules
 * then read "dark hides the dark one" — false — and were wired to their
 * opposites, so each theme displayed the mark that disappears into it: white on
 * `#f7f9fc` measured 1.05:1, black on `#0b1220` measured 1.12:1. The class names
 * are now the colour, so a rule cannot be read as saying the opposite of what
 * it does.
 *
 * WHY NOTHING CAUGHT IT. Every check that touched this at the time asked whether
 * the SWAP HAPPENED — `naturalWidth > 0`, a non-zero box, exactly one of the two
 * visible — and a white logo on a white background satisfies all three
 * perfectly. That is §3.G8's "the check that reads like the guard is not the
 * guard", and it is why what is asserted here is CONTRAST and not "the two
 * themes show different files": a differs-check passes on the bug this section
 * was written for.
 *
 * WHY STATIC AND NOT RENDERED. The arithmetic below is the same one the browser
 * would do, on the same two numbers — the SVG's own `fill` and the theme's own
 * `--bg` — so the only thing a screenshot adds is the browser's colour
 * management, for a 0-or-255 fill on an opaque ground. 0.1s and no server beats
 * ~6s and a running :5500 for that trade, and unlike a rendered check this one
 * cannot be satisfied by a mark that decoded and sat in a box.
 *
 * The threshold is 3:1 because this is a GRAPHICAL OBJECT, not text — SC
 * 1.4.11's figure, the same call §3.G8 made for the spectrum live curve, and for
 * the same reason: the mark's MEANING (this is a link to the repository) is
 * carried by its SHAPE. The measured values on the two themes are 19.9:1 and
 * 18.7:1, so the floor is 6x below what ships and is here to catch a wrong
 * pairing (1.05:1, 1.12:1) rather than to police a fine tune.
 */
console.log('\ngitHub mark');

const REL_LUM = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [REL_LUM(a), REL_LUM(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* The PATH's fill, never the clipPath's `<rect fill="white">`. Both files carry
 * a `fill="white"` — the white mark's is the artwork, the black file's is the
 * clipping rectangle — so a naive `svg.match(/fill="([^"]+)"/)` reads the black
 * file as white and every assertion below passes on the inverted state. Taking
 * the FIRST fill inside a `<path …>` is what makes the measurement real. */
const markFill = (svg) => (svg.match(/<path\b[^>]*\bfill="([^"]+)"/) || [null, null])[1];

const indexHtml = read('index.html');
const markTags = [...indexHtml.matchAll(/<img\b[^>]*class="(gh-[a-z]+)"[^>]*src="([^"]+)"[^>]*>/g)]
  .map((m) => ({ cls: m[1], src: m[2], tag: m[0] }));

check(markTags.length === 2, 'the footer carries exactly two marks, one per colour',
  () => `found ${markTags.length} <img class="gh-*"> tags — the swap rules below assume one black and one white`);

/* The class IS the colour — asserted on the NAME, because the first version of
 * this check used the class only as a lookup key and so never looked at it: it
 * passed a tree where the classes were `.gh-dark`/`.gh-light` again, which is
 * the naming that produced the inverted wiring in the first place. A guard that
 * cannot see the thing it names is worse than no guard, because its `ok` line
 * claims a property nobody verified (found by mutation M2, not by reading). */
const classByFileColour = new Map(markTags.map((t) => [t.src, t.cls]));
const FILES = ['assets/images/github-invertocat-black.svg', 'assets/images/github-invertocat-white.svg'];
const colourOf = {};
for (const file of FILES) {
  const fill = markFill(read(file));
  if (fill) colourOf[classByFileColour.get(file)] = fill === 'black' ? 'black' : fill;
}
check(Object.keys(colourOf).length === 2
  && Object.values(colourOf).includes('black') && Object.values(colourOf).includes('white')
  && Object.entries(colourOf).every(([cls, colour]) => cls === `gh-${colour}`),
  'each mark class is named for the colour its file actually paints',
  () => `class -> file colour resolved as ${JSON.stringify(colourOf)} — every class must be exactly "gh-" + the colour its own <path> fills with, which is the whole fix: named for the theme, the two swap rules read as their own inverse`);

/* The theme backgrounds come from shared.css's own tokens rather than from a
 * literal here, so a palette change cannot leave this check measuring a colour
 * the site no longer uses (§3.N: overriding the derived value's INPUT fixes
 * every consumer at once — and a copy is what rots).
 *
 * The token is `--bg-primary` and not `--bg`, because `body` is the only thing
 * painting it: shared.css:416 `background-color: var(--bg-primary)` and
 * index.html's own `body` block overrides display/min-height but not the
 * background. `.home-footer` declares none at all, which is what makes
 * `--bg-primary` the correct ground — asserted below rather than assumed, since
 * a `background:` added to the footer later would silently move the surface this
 * measures against while every check here still passed. */
const sharedCss = read('assets/css/shared.css');
const themeBg = {};
for (const theme of ['light', 'dark']) {
  const block = theme === 'light'
    ? (sharedCss.match(/\[data-theme=["']light["']\]\s*\{([\s\S]*?)\n\}/) || [null, ''])[1]
    : (sharedCss.match(/^\s*:root\s*\{([\s\S]*?)\n\}/m) || [null, ''])[1];
  themeBg[theme] = (block.match(/(?:^|[\s;])\s*--bg-primary:\s*(#[0-9a-f]{3,8})\s*;/i) || [null, null])[1];
}
check(themeBg.light && themeBg.dark, 'both theme backgrounds are readable from shared.css',
  () => `could not read --bg-primary for light/dark (got ${JSON.stringify(themeBg)}) — the contrast assertion below cannot run without a real ground to measure against`);

const footerRule = (sharedCss.match(/\.home-footer\s*\{([^}]*)\}/) || [null, ''])[1];
check(!/\bbackground\b/.test(footerRule), 'the footer paints no background of its own, so --bg-primary really is the ground the mark sits on',
  () => `.home-footer now declares a background, so this section measures contrast against a colour that is no longer behind the mark: ${footerRule.trim()}`);

/* Read from shared.css because that is where the rule is — the first version of
 * this check read index.html, which no longer defines `.home-footer` at all (the
 * duplicate was removed when the mark arrived), so the regex matched nothing,
 * `''` contains no `background`, and the check passed on a tree where the footer
 * had been given a background. Found by mutation M4, which is the only way a
 * check that inspects an absent thing gets noticed. */
check(!/\.home-footer\s*\{/.test(indexHtml), 'index.html does not re-declare .home-footer, so there is one definition of it',
  () => 'index.html carries its own .home-footer rule again — a second copy can drift from shared.css\'s, and the contrast this section measures would be reading whichever won the cascade');

/* Found by mutation M5b, which stayed green: `.home-footer-line` was copied into
 * index.html's <style> until the GitHub mark arrived and needed it to be a flex
 * row. Two rules of one name with different values is only safe while nobody
 * edits the loser, and index.html's block is linked AFTER shared.css so it wins
 * the cascade — which is invisible until the day the ordering stops being true.
 * `.home-footer-grid/-title/-list` are still legitimately page-only (initFooterNav
 * is the only consumer of them), so they are not asserted here. */
check(!/\.home-footer-line\s*\{/.test(indexHtml), 'index.html does not re-declare .home-footer-line either — one definition of it',
  () => 'index.html carries its own .home-footer-line rule, which currently wins on stylesheet order alone; shared.css owns that rule');

/* Which mark survives on a theme: the one the theme's rule does NOT hide. Both
 * rules must exist, or a theme renders both marks side by side — which is the
 * loud failure the page's own comment says is deliberate, so it is a fact worth
 * reading off the file rather than discovering in a browser. */
const hiddenBy = (theme) => {
  const re = new RegExp(`\\[data-theme=["']${theme}["']\\][^{]*\\.home-footer-github\\s+\\.(gh-[a-z]+)\\s*\\{\\s*display:\\s*none`, 'm');
  return (indexHtml.match(re) || [null, null])[1];
};

/* A LOCAL counter, never the file's `failures`. The summary below used to be
 * `check(!failures, …)`, which makes this section's verdict a property of every
 * SECTION BEFORE IT: a red above turns this check green, so a genuinely inverted
 * mark reads as passing on a run where some unrelated page forgot its nav. That
 * is §3.B2's vacuous guard — the assertion cannot fail on its own terms. */
let markFailures = 0;
const visibleMarks = [];
for (const theme of ['light', 'dark']) {
  const hidden = hiddenBy(theme);
  const shown = markTags.map((t) => t.cls).filter((c) => c !== hidden);
  if (shown.length !== 1) {
    markFailures++;
    visibleMarks.push(`${theme}: ${shown.length} marks visible${hidden ? ` (the rule hides .${hidden})` : ' — NO display:none rule for this theme, so BOTH marks render'}`);
    continue;
  }
  const ink = '#' + (colourOf[shown[0]] === 'white' ? 'ffffff' : '000000');
  const bg = themeBg[theme];
  if (!bg) { markFailures++; visibleMarks.push(`${theme}: no ground colour to measure against`); continue; }
  const ratio = contrast(ink, bg);
  /* ONE line per theme. The first version pushed the measurement AND then
   * pushed the same measurement again inside the failure branch, so every red
   * line read as two facts — one of them a pass. A reader scanning for the
   * offending number finds it twice and cannot tell which is the verdict. */
  if (ratio < 3) {
    markFailures++;
    visibleMarks.push(`${theme}: .${shown[0]} paints ${colourOf[shown[0]]} on ${bg} = ${ratio.toFixed(2)}:1, under 3:1 — this is the mark that vanishes into the theme it is shown on`);
  }
}
check(markFailures === 0, 'the mark shown on each theme is visible against that theme',
  () => visibleMarks.join(' | '));

// --- the exclusions still hold ---------------------------------------------

console.log('\nexclusions');

// These two are the whole reason a derived page set is safe. If 404.html grew a
// header or color.html dropped its rail, the nav would be the wrong answer for
// it — and the exclusion would keep the checker green through both.
const html404 = read('404.html');
check(/location\.replace/.test(html404), '404.html is still a redirect stub',
  () => '404.html no longer contains location.replace — if it grew a header it needs the nav, and the exclusion above is now hiding that');

const colorHtml = read('color.html');
check(/^[ \t]*initColorRail\(/m.test(colorHtml), 'color.html still mounts its rail in place of the nav',
  () => 'color.html no longer calls initColorRail() — either it now needs the nav, or the page it was excluded for has changed');

console.log(`\n  pages: ${sitePages.length} mounting, ${NON_PAGES.size} excluded, ${captures.length} captures ignored`);

if (failures) {
  console.log(`\nFAIL  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\nPASS  every governed page mounts the nav');