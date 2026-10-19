/**
 * 叫聲猜謎 (cry quiz) — the page itself (cry-game.html / cry-game.css / cry-game.js).
 *
 *   node scripts/check_cry_game.mjs
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT IS NOT HERE
 * ---------------------------------------------------------------------------
 *
 * Every number this page shows comes from `cry-game-similarity.js`, which has its
 * own checker and mutation harness. Duplicating the arithmetic would give the
 * project two places to be right about the difficulty ceiling (§3.B1): a checker
 * that restates its subject's constants can only fail when the constant moves,
 * never when the reasoning about it was wrong.
 *
 * What is here is the half nothing else looks at: the shell contract, the
 * `[hidden]` pairing, the node-capture discipline, and the claims about which ids
 * are written and by which function.
 *
 * ---------------------------------------------------------------------------
 * FOUR THINGS ARE DERIVED RATHER THAN RESTATED
 * ---------------------------------------------------------------------------
 *
 * A restatement is a second source of truth that goes stale in the direction that
 * hides a defect.
 *
 * 1. **The `[hidden]` pairing list.** Walked out of cry-game.js: find every
 *    `setRevealed(els.X` and `els.X.hidden` site, resolve the id, read that
 *    element's class out of cry-game.css, and require a `[hidden]` rule ONLY when
 *    its body declares `display: flex|grid|inline-flex|inline-grid`. An element
 *    whose author display is `block` or none needs no pairing.
 * 2. **The id inventory.** Every `getElementById` resolves in the markup and
 *    every id in the markup is reached by something, with four ARIA exemptions
 *    (`for`, `aria-labelledby`, `aria-controls`, `aria-describedby`).
 * 3. **The handler routes.** Both a delegated `closest('#id')` and a direct
 *    listener on a permanent node count, each with a floor; a count of ONE in
 *    either direction signals a control bound to a node a re-render can detach
 *    (§3.W).
 * 4. **The `selectors are all cg-` rule.** Every selector in cry-game.css is
 *    parsed and checked, excluding at-rule preludes and keyframe stops.
 *
 * ---------------------------------------------------------------------------
 * COMMENTS AND STRING LITERALS ARE MASKED, AND EVERY RULE-SHAPED ASSERTION READS
 * THE STRIPPED COPY
 * ---------------------------------------------------------------------------
 *
 * `cry-game.css` documents this very rule, and a stylesheet assertion built on
 * raw text reads the sentence describing the rule as an instance of it (§3.S).
 * So `jsCode` and `cssCode` are comment-stripped before any rule-shaped
 * assertion, and `htmlCode` exists beside `html` for the same reason.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let total = 0;
let failures = 0;
function check(ok, description, detail = () => '') {
  total++;
  if (ok) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}`);
    console.log(`       ${detail()}`);
  }
}

/** Block and line comments, and nothing else. */
const stripJsComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtmlComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '');

const html = readFileSync(join(ROOT, 'cry-game.html'), 'utf8');
const css = readFileSync(join(ROOT, 'assets/css/cry-game.css'), 'utf8');
const js = readFileSync(join(ROOT, 'assets/js/cry-game.js'), 'utf8');
const moduleSrc = readFileSync(join(ROOT, 'assets/js/cry-game-similarity.js'), 'utf8');
const sharedSrc = readFileSync(join(ROOT, 'assets/js/shared.js'), 'utf8');
/* The CSS is read SEPARATELY on purpose: the row-layout modifier list lives in
 * `assets/css/shared.css`, next to the rules that give those classes their
 * layout. Reading it from `shared.js` returns an empty list, and the membership
 * assertion then reports against nothing. */
const sharedCss = readFileSync(join(ROOT, 'assets/css/shared.css'), 'utf8');

const htmlCode = stripHtmlComments(html);
const cssCode = stripCssComments(css);
const jsCode = stripJsComments(js);

/**
 * The body of a named top-level function, brace-matched.
 *
 * §3.P's second vacuous shape: `/function renderAll[\s\S]*?…/` matches a call
 * three functions later, so every function-scoped assertion goes through here.
 */
function fnBody(src, name) {
  const head = src.indexOf(`function ${name}(`);
  if (head < 0) return null;
  const open = src.indexOf('{', head);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

// ---------------------------------------------------------------------------
console.log('\nthe shell matches every other page, and the mounts are in the HTML');
// ---------------------------------------------------------------------------
{
  check(htmlCode.includes('assets/css/shared.css'), 'it loads shared.css');
  check(htmlCode.includes('assets/css/cry-game.css'), 'and cry-game.css');
  check(!htmlCode.includes('assets/css/colors.css'),
    'and NOT colors.css — cry-game.css is self-contained and has no rule for anything in it',
    () => 'colors.css is loaded but nothing here uses a .cp-* class');

  // §3.G2: a bare `.header` is the MOBILE layout and renders a valid, wrong page.
  // `check_nav_pages.mjs` reads the six modifier names out of shared.css; this
  // only asserts that exactly one is present and that shared.css defines it.
  /* Read the modifier list out of the COMBINED selector at the row layout, not
   * out of the per-modifier `--page-accent` rules at the top. Both name the same
   * six classes, but only the combined one means "these are the row layouts". */
  const rowLayout = (sharedCss.match(/\.header-dex,\s*\.header-3d,[\s\S]{0,200}?\{/) || [])[0] || '';
  const modifiers = [...rowLayout.matchAll(/\.header-([a-z0-9-]+)/g)].map((m) => m[1]);
  check(modifiers.length >= 6,
    `shared.css's combined row-layout selector names ${modifiers.length} modifiers — ${modifiers.join(', ')}`,
    () => `found no combined .header-* selector; the list read was ${rowLayout.length} chars`);
  const onHeader = (htmlCode.match(/<header class="header([^"]*)"/) || [])[1] || '';
  const used = [...onHeader.matchAll(/header-([a-z0-9-]+)/g)].map((m) => m[1]);
  check(used.length === 1, `the header carries exactly one row-layout modifier — found ${used.length}`,
    () => `header class is "header${onHeader}"; shared.css defines ${modifiers.length}: ${modifiers.join(', ')}`);
  /* MEMBERSHIP, not a name: asserting the modifier's string says nothing about
   * whether shared.css defines it, so the page could ship `header-cries` and
   * still render the mobile column layout under a bare `.header`. */
  check(modifiers.includes(used[0]),
    `and shared.css actually defines header-${used[0]}`,
    () => `header-${used[0]} is not one of the ${modifiers.length}: ${modifiers.join(', ')}`);
  /* AND it is the SAME modifier the rest of the 叫聲 (cry) group uses, read out
   * of those files rather than remembered. */
  const siblings = ['cries.html', 'spectrum.html', 'cries-gen1.html']
    .map((f) => (readFileSync(join(ROOT, f), 'utf8').match(/<header class="header header-([a-z0-9-]+)"/) || [])[1])
    .filter(Boolean);
  check(siblings.length === 3 && siblings.every((m) => m === used[0]),
    `and it is the one all three sibling 叫聲 pages use — ${siblings.join(', ')}`,
    () => `this page uses header-${used[0]}`);

  // §3.G2 again: the toggle SHIPS EMPTY. `initThemeToggle()` guards on
  // `.icon-sun`, so a hand-authored pair of any other class is added to, not replaced.
  /* NO CHILD ELEMENTS AT ALL, rather than "no `icon-sun`". `initThemeToggle()`'s
   * guard only tests for `.icon-sun`, so a pair of ANY other class is ADDED TO,
   * leaving four children in a 34px grid box with one painting outside it and no
   * error thrown. */
  const toggle = (htmlCode.match(/<button class="theme-toggle"[\s\S]*?<\/button>/) || [])[0] || '';
  check(!!toggle && !/<(svg|span|i)[\s>]/.test(toggle),
    'the theme toggle ships with no child elements, so the runtime injects exactly one icon pair',
    () => `the button is ${JSON.stringify(toggle.slice(0, 160))}`);
  check(!!toggle && /<\/button>\s*$/.test(toggle.trim()),
    'and it is closed immediately — not an empty element with siblings inside it');

  const inline = [...htmlCode.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  check(inline.length === 1, 'there is exactly one inline module block', () => `${inline.length}`);
  check(/^\s*initThemeToggle\(\);\s*$/m.test(inline[0] || ''),
    'it calls initThemeToggle(), ANCHORED to the statement — a bare-name match is satisfied by the explanatory comment above it',
    () => `the block is:\n${inline[0]}`);
  check(/initHeaderNav\('cry-game\.html'\)/.test(inline[0] || ''),
    "and initHeaderNav('cry-game.html') with its own filename");

  /* `check_nav_pages.mjs` reads the mount off the HTML BY DESIGN: a grep over
     `assets/js` cannot answer "which pages mount the nav", because the import
     names the symbol and a page can carry it inside a comment. So the page must
     NOT also mount it from its own module, which would make the HTML check pass
     while the page's real behaviour came from the other place. */
  check(!/initHeaderNav/.test(jsCode), 'cry-game.js does NOT also mount the nav', () => 'the mount is in two places');
  check(!/initThemeToggle/.test(jsCode), 'nor the theme toggle', () => 'the mount is in two places');
  check(/from '\.\/cry-game-similarity\.js'/.test(jsCode), 'and it imports the pure module it is drawn from');

  /* WHAT IS LOAD-BEARING IS THAT IT IS INLINE AND IN THE HEAD, not that it
   * precedes the stylesheet link: a `<link rel="stylesheet">` blocks the parser,
   * so an inline script anywhere in `<head>` runs before the first paint. What
   * would break the guarantee is an EXTERNAL script, which is deferred and runs
   * after paint — so that is what is asserted. */
  const headEnd = htmlCode.indexOf('</head>');
  const themeAt = htmlCode.indexOf('pokemon-theme');
  check(themeAt > 0 && themeAt < headEnd,
    'the theme script is INLINE and inside <head>, so it runs before the first paint',
    () => `the theme key is at ${themeAt}, </head> at ${headEnd}`);
  const themeScriptTag = (htmlCode.match(/<script>([\s\S]*?)<\/script>/) || [])[0] || '';
  check(!!themeScriptTag && !/\ssrc=/.test(themeScriptTag),
    'and it is an inline <script> with no src — an external one is deferred and would paint first');
  check(htmlCode.includes('<meta name="theme-color" content="#0b1020">'), 'and the meta it rewrites is present');
}

/** The `class` attribute of the element carrying `id`, read out of the markup. */
const classOf = (id) => {
  const m = htmlCode.match(new RegExp(`id="${id}"[^>]*class="([^"]*)"`))
    || htmlCode.match(new RegExp(`class="([^"]*)"[^>]*id="${id}"`));
  return m ? m[1] : '';
};

/** The author `display` each of a list of classes gets, from cry-game.css. */
const displaysOf = (classes) => classes.map((sel) => {
  const re = new RegExp(`(?:^|[,}\\s])\\.${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^{]*\\{([^}]*)\\}`, 'g');
  for (const m of cssCode.matchAll(re)) {
    const d = (m[1].match(/^\s*display:\s*([a-z-]+)/m) || [])[1];
    if (d) return d;
  }
  return null;
});

/** Whether the stylesheet pairs this element with a real `[hidden]` reset. */
const hasPairing = (classes) => classes.some((sel) =>
  new RegExp(`\\.${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[hidden\\]\\s*\\{[^}]*display:\\s*none`).test(cssCode));

// ---------------------------------------------------------------------------
console.log('\nevery element the JS hides has the CSS pairing §3.M requires');
// ---------------------------------------------------------------------------
{
  /* THE LIST IS DERIVED. Walk cry-game.js for the two hiding routes, resolve
   * each id to a class in cry-game.css, and require the `[hidden]` rule only
   * where the author display is a flex or grid box — because that is the only
   * case where the user agent's `[hidden] { display: none }` loses. */
  const sites = new Set();
  for (const m of jsCode.matchAll(/setRevealed\(\s*els\.([A-Za-z0-9_]+)/g)) sites.add(m[1]);
  for (const m of jsCode.matchAll(/els\.([A-Za-z0-9_]+)\.hidden\s*=/g)) sites.add(m[1]);

  const resolved = [];
  const needsPairing = [];
  for (const name of sites) {
    const guess = `cg-${name.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    const classes = classOf(guess).trim().split(/\s+/).filter(Boolean);
    if (!classes.length) continue;
    resolved.push({ id: guess, classes });
    /* An element needs a pairing when ANY of its classes is a flex or grid box,
     * and the pairing may be on ANY of them. Building the selector from the
     * element's WHOLE class string (`class="cg-btn cg-btn-ghost"`) asks for a
     * descendant selector that cannot exist and reports a missing pairing on an
     * element that has one. */
    if (displaysOf(classes).some((d) => d && /^(flex|grid|inline-flex|inline-grid)$/.test(d))) {
      needsPairing.push({ id: guess, classes });
    }
  }

  check(resolved.length >= 7,
    `${resolved.length} elements are hidden by id and all resolve in the markup`,
    () => `${sites.size} sites, ${resolved.length} resolved: ${resolved.map((x) => x.id).join(', ')}`);

  check(needsPairing.length >= 5,
    `${needsPairing.length} of them are flex or grid boxes, which is where the UA's [hidden] loses`,
    () => `resolved ${resolved.length}, needing pairing: ${needsPairing.map((x) => x.id).join(', ') || 'none'}`);

  const missing = needsPairing.filter(({ classes }) => !hasPairing(classes));
  check(missing.length === 0,
    'and every one of those has a `.class[hidden] { display: none }` rule on at least one of its classes',
    () => `missing for: ${missing.map((x) => `${x.id} (${x.classes.join('.')})`).join(', ')}`);

  /* The pairing has to be a REAL reset, not a declaration that happens to contain
   * the word. §3.S's finding: `[^{}]*\{[^}]*display:\s*none[^}]*\}` walks out of a
   * comment into the next rule and reports a rule that does not exist. So this
   * reads the STRIPPED stylesheet and brace-matches each body. */
  const pairingBodies = [...cssCode.matchAll(/\.([a-z0-9-]+)\[hidden\]\s*\{([^}]*)\}/g)];
  check(pairingBodies.every(([, , body]) => /display:\s*none/.test(body)),
    'every pairing rule really declares display: none, read out of the comment-stripped CSS',
    () => `${pairingBodies.filter(([, , b]) => !/display:\s*none/.test(b)).length} pairings do not`);

  /* ONE writer of `.style.display`. A second writer means a panel is visible or
   * hidden depending on which function ran last, and nothing reports it. */
  const displayWriters = (jsCode.match(/\.style\.display\s*=/g) || []).length;
  check(displayWriters === 1,
    'and exactly ONE function in the page writes .style.display — setRevealed()',
    () => `${displayWriters} write sites`);
  /* BOTH the attribute AND the display, because they are two ways of saying the
   * same thing and can disagree in opposite directions. §3.M's usual finding is
   * that `hidden = true` does not hide an element because an author `display`
   * wins; this page shipped the other direction — seven elements carry `hidden`
   * in the markup, `setRevealed(el, true)` cleared only `style.display`, and the
   * 下一題 (next question) button never appeared. Every pairing assertion in this
   * file asks only whether a RULE EXISTS, so no static check could see it. */
  const setBody = fnBody(jsCode, 'setRevealed') || '';
  check(setBody.includes('node.style.display') && setBody.includes('node.hidden ='),
    'setRevealed() writes BOTH the display and the hidden attribute, so they cannot disagree',
    () => `it writes ${/node\.hidden/.test(setBody) ? '' : 'the display only'}`);
  const hiddenAttrWrites = (jsCode.match(/\.hidden\s*=\s*[^=]/g) || []).length;
  check(hiddenAttrWrites === 2,
    'and the attribute is written in exactly two places: setRevealed() and els.again',
    () => `${hiddenAttrWrites} sites`);
  for (const name of ['renderAll', 'renderChoices', 'renderHint', 'renderNext', 'renderFoot', 'renderPlayer']) {
    const body = fnBody(jsCode, name) || '';
    check(!/\.style\.display\s*=/.test(body),
      `${name}() does not write .style.display directly`);
    void body;
  }
}

// ---------------------------------------------------------------------------
console.log('\nall ids resolve, none are orphans, and every route is bound');
// ---------------------------------------------------------------------------
{
  const read = new Set([...jsCode.matchAll(/getElementById\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
  const written = new Set([...jsCode.matchAll(/els\.([A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]));
  const deref = new Set([...jsCode.matchAll(/\bels\.([A-Za-z0-9_]+)\b/g)].map((m) => m[1]));

  const unresolved = [...written].filter((p) => {
    const guess = `cg-${p.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    return !read.has(guess) && !read.has(p);
  });
  check(unresolved.length === 0,
    `all ${written.size} els entries are read from the document`,
    () => `not a getElementById: ${unresolved.join(', ')}`);

  const unresolvedIds = [...read].filter((id) => !htmlCode.includes(`id="${id}"`));
  check(unresolvedIds.length === 0,
    `and all ${read.size} ids exist in cry-game.html`,
    () => `missing from the markup: ${unresolvedIds.join(', ')}`);

  /* THE OTHER DIRECTION, the one that finds dead markup: an id nothing reads is
   * a container nothing fills. In this project's history a nav container was
   * empty for a whole commit with no exception anywhere. */
  const markupIds = [...htmlCode.matchAll(/\sid="([a-z0-9-]+)"/g)].map((m) => m[1]);
  const ARIA = ['for', 'aria-labelledby', 'aria-controls', 'aria-describedby', 'list'];
  const orphans = markupIds.filter((id) => {
    if (read.has(id)) return false;
    if (ARIA.some((a) => new RegExp(`\\b${a}="[^"]*\\b${id}\\b`).test(htmlCode))) return false;
    // a data-attribute hook or a class the page targets
    return !new RegExp(`\\b${id}\\b`).test(jsCode);
  });
  check(orphans.length === 0,
    `and none of the page's ${markupIds.length} ids is an orphan`,
    () => `read by nothing: ${orphans.join(', ')}`);

  /* Both handler routes need a floor: a count of delegated routes alone failed
   * the suite once when an improvement took the count from 4 to 3. */
  const delegated = new Set([...jsCode.matchAll(/closest\('#([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  const attrHooked = new Set([...jsCode.matchAll(/closest\('\[([a-z-]+)\]'\)/g)].map((m) => m[1]));
  check(delegated.size >= 2,
    `at least two controls are bound by delegation on a permanent ancestor — ${delegated.size}`,
    () => `found ${[...delegated].join(', ')}`);
  check(attrHooked.size >= 3,
    `at least three tab/chip groups are bound by attribute — ${attrHooked.size}`,
    () => `found ${[...attrHooked].join(', ')}`);

  /* DIRECT listeners on permanent nodes, and the reason the play button's glyph
   * is `data-state` rather than innerHTML: re-rendering a node's contents
   * destroys the node the listener's own click target was. */
  const direct = [...jsCode.matchAll(/els\.([A-Za-z0-9_]+)\.addEventListener/g)].map((m) => m[1]);
  check(direct.length >= 2,
    `${direct.length} controls are bound directly, on nodes that are never re-rendered — ${direct.join(', ')}`,
    () => `${direct.length}`);
  for (const name of direct) {
    const prop = name;
    const cls = classOf(`cg-${prop.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
    check(!!cls, `the node behind els.${prop} exists in the markup`);
  }

  /* THE DELEGATED CONTAINER MUST SURVIVE. `#cg-choices` has its innerHTML
   * replaced on every question change, so the listener is on the container itself
   * and reads the option index off the card: the alternative binds a listener per
   * card, on a node about to be thrown away, and a detached node does not bubble
   * (§3.I). */
  const choicesBody = fnBody(jsCode, 'renderChoices') || '';
  check(/els\.choices\.innerHTML\s*=/.test(choicesBody),
    'renderChoices() is what re-renders the options');
  check(/els\.choices\.addEventListener/.test(jsCode),
    'and the options\' click handler is on #cg-choices, which is never replaced');
  /* A `.canvas` on something that IS the canvas. `paintWave()` read `.canvas` off
   * its argument while one call site passed the cache wrapper and the other the
   * element, so the waveform drew nothing — and every static assertion was green
   * because they all ask whether the canvas EXISTS and has a SIZE, which is not
   * the question. Found by driving the page. */
  const paint = fnBody(jsCode, 'paintWave') || '';
  check(/ctx\.drawImage\(source/.test(paint) && !/\.canvas\b/.test(paint),
    'paintWave() blits the element it is given and never reads a .canvas property off it',
    () => paint.trim().slice(0, 160));
  const load = fnBody(jsCode, 'loadWave') || '';
  const blits = [...(load.match(/paintWave\([^)]*\)/g) || [])];
  check(blits.length >= 2 && blits.every((b) => /paintWave\((cache|waveCache\.canvas|placeholder)\)/.test(b)),
    'and every one of its call sites passes a CANVAS ELEMENT — the cache is what is keyed, the element is what gets blitted',
    () => blits.join(' | '));
  check(!blits.some((b) => /paintWave\(waveCache\)/.test(b)),
    'and none passes the cache WRAPPER, which is what left the waveform blank',
    () => blits.join(' | '));

  /* EVERY identifier a render function reads is a PARAMETER or a module-level
   * binding. A free variable inside `renderChoices()` read the current question's
   * index `i`, which existed in `renderAll()` and not here, so answering a
   * question threw and the whole render after the choice grid — the names, the
   * dossier link, the 下一題 (next question) button — never happened. */
  check(/function renderChoices\(q, playing, i\)/.test(jsCode),
    'renderChoices() takes the question index as a parameter rather than closing over one',
    () => 'renderChoices() cannot see `i`');
  const freeIds = [...new Set([...choicesBody.matchAll(/\b(state|byId|els)\.[a-zA-Z]+/g)]
    .map((m) => m[0]))];
  check(freeIds.length > 0,
    `and reads only module bindings — ${freeIds.length} of them: ${freeIds.slice(0, 6).join(', ')}`);
  check(/const i = state\.indexOfCurrent/.test(jsCode),
    'with the index captured ONCE in renderAll() and passed down, so a pick cannot land on a different question than the one whose options were rendered');

  const perCard = [...jsCode.matchAll(/for\s*\([^)]*\)\s*\{[^}]*\.addEventListener/g)];
  check(perCard.length === 0,
    'and no listener is attached to an option card — a card is re-rendered on every question change',
    () => `${perCard.length} in-loop listeners`);

  /* THE PLAY GLYPH IS `data-state`, NEVER `innerHTML`. §3.W's hint-bar defect one
   * level up: writing `innerHTML` destroys the child node a progress element
   * lived in, so the bar never appears and nothing throws. */
  check(!/els\.play\.innerHTML/.test(jsCode) && !/els\.hintBtn\.innerHTML/.test(jsCode),
    'no control on this page rebuilds its own contents — the play glyph and the hint label are attributes and textContent');
  check(/els\.play\.dataset\.state\s*=/.test(jsCode), 'the play glyph is driven by data-state');
  check(/delete els\.play\.dataset\.state/.test(jsCode), 'and cleared by deleting the attribute, so one state is one value');
}

// ---------------------------------------------------------------------------
console.log('\nthe page has no randomness of its own, and one live region');
// ---------------------------------------------------------------------------
{
  /* Asserted against the comment-stripped source: the docblock NAMES
   * `Math.random`, so an unstripped assertion is satisfied by the paragraph
   * explaining the rule — §3.S's false positive in the file §3.S is written in. */
  check(!/Math\.random/.test(jsCode),
    'cry-game.js contains no Math.random — every draw takes the module\'s default',
    () => `${(jsCode.match(/Math\.random/g) || []).length} occurrences`);

  const randomModule = /rand = Math\.random/.test(moduleSrc);
  check(randomModule, 'and the module owns the randomness instead, as a default parameter',
    () => 'buildRound/eliminateIndex do not default their rand');

  /* THE LIVE REGION. One writer of its text, and the page has exactly one such
   * region. §3.W's rule: an announcement belongs in a live region, and a region
   * with two writers loses whichever ran last. */
  const liveRegions = [...htmlCode.matchAll(/aria-live="(polite|assertive)"/g)].map((m) => m[1]);
  check(liveRegions.length === 1,
    `the page has exactly ONE live region, not a third`,
    () => `found ${liveRegions.length}: ${liveRegions.join(', ')}`);
  check(/id="cg-player"[^>]*role="status"/.test(htmlCode)
    || /role="status"[^>]*id="cg-player"/.test(htmlCode),
    'and it is #cg-player with role="status"');

  /* FUNCTIONS, NOT SITES. Counting assignments makes a correct file look wrong
   * and a wrong one look right depending on how many branches the right writer
   * has: `renderPlayer()` has three (an announcement, a finished round, the
   * default prompt), which is one writer doing three jobs.
   *
   * ONE WRITER, PLUS ONE ASSERTED BOOT EXCEPTION. `init()` has no `renderAll()`
   * to call because nothing has rendered yet, so the rule is 「exactly two, and
   * the second is the boot failure」 rather than 「one」. Every other path sets
   * `lastAnnouncement` BEFORE the render that consumes it, so the sentence is not
   * displaced by an unrelated later render.
   *
   * NEAREST PRECEDING DECLARATION, not a brace-depth stack. `} catch (e) {` opens
   * and closes a brace on one line in the wrong order for a naive counter, so a
   * stack pops early and misattributes writes. Scanning backwards for the last
   * `function NAME(` is exact here because no two functions share a name. */
  const writers = new Set();
  {
    const lines = jsCode.split('\n');
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/els\.player\.textContent\s*=/.test(lines[i])) continue;
      const before = lines.slice(0, i).join('\n');
      const decls = [...before.matchAll(/function ([A-Za-z0-9_]+)\s*\(/g)];
      writers.add(decls.length ? decls[decls.length - 1][1] : '(module scope)');
      void cursor;
    }
  }
  check(writers.has('renderPlayer'),
    'renderPlayer() is a writer of the region — it is what consumes lastAnnouncement');
  check(writers.size === 2,
    `and the region has exactly two writers, not seven: ${[...writers].join(', ')}`,
    () => `${writers.size} writers: ${[...writers].join(', ')} — every other path must set lastAnnouncement instead`);
  const initBody = fnBody(jsCode, 'init') || '';
  check(writers.has('init') && /els\.player\.textContent\s*=/.test(initBody),
    'the second is init()\'s data-load failure, the only path with no renderAll() to call');
  check(!writers.has('(module scope)'),
    'and nothing writes it at module scope, which would run before any render');
  for (const name of ['newRound', 'restoreDaily', 'playCurrent', 'answer', 'advance', 'useHint']) {
    const b = fnBody(jsCode, name) || '';
    check(!/els\.player\.textContent\s*=/.test(b),
      `${name}() announces through lastAnnouncement rather than writing the region`);
    void b;
  }
  /* AND the ordering: a sentence assigned before the render that consumes it is
   * shown; assigned after, it waits for a render that has nothing to do with it. */
  check(/lastAnnouncement = `接續今天的題目/.test(jsCode),
    'and lastAnnouncement is assigned BEFORE the renderAll() that consumes it',
    () => 'the restore assigns after renderAll(), so the sentence surfaces on a later render');
  check((jsCode.match(/lastAnnouncement\s*=/g) || []).length >= 4,
    'and the three things that need to speak set lastAnnouncement as INPUT instead');

  /* The round outcome reaches the region whether or not the viewport moves. */
  check(/lastAnnouncement = `這一輪結束了/.test(jsCode),
    'a finished round announces itself into the region, not only into the panel');
}

// ---------------------------------------------------------------------------
console.log('\nstyles: every selector is ours, and the card really is flush');
// ---------------------------------------------------------------------------
{
  /* Rule-shaped assertions read the STRIPPED stylesheet — see the file header. */
  const selectors = [];
  let depth = 0;
  let buf = '';
  for (const m of cssCode.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const s of prelude.split(',')) {
      const t = s.trim();
      if (t && !/^(from|to|\d+%)$/.test(t)) selectors.push(t);
    }
    depth++;
  }
  void depth;
  /* The theme qualifier is not a foreign selector. `[data-theme="light"] .cg-page`
   * is still this page's rule and this page's class — the attribute is how the
   * theme is selected, not another page's namespace. */
  const foreign = selectors.filter((s) => !/(^|\])\s*\.cg-/.test(s) && !/^\.cg-/.test(s));
  check(foreign.length === 0,
    `every one of the ${selectors.length} selectors in cry-game.css is .cg- prefixed`,
    () => `not ours: ${foreign.slice(0, 6).join(' | ')}`);

  for (const prefix of ['.cy-', '.sp-', '.gm-', '.cp-']) {
    check(!cssCode.includes(prefix),
      `cry-game.css contains no ${prefix} rule — ${['cy', 'sp', 'gm', 'cp'].includes(prefix.slice(1)) ? "that page's" : 'any shared'} prefix is another page's problem`);
  }

  /* §3.W: one value cannot serve both themes, so the proof is that the two
   * DIFFER — a single declaration satisfies an existence check and leaves the
   * white-on-white bug in place. */
  const accents = [...cssCode.matchAll(/--cg-accent:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => m[1]);
  check(accents.length === 2,
    `--cg-accent is declared once per theme — ${accents.length} declaration(s): ${accents.join(' ')}`,
    () => `${accents.length}`);
  check(accents.length === 2 && accents[0] !== accents[1],
    'and the two values DIFFER, so neither theme can end up with the other\'s ink',
    () => `${accents[0]} vs ${accrets1 || accents[1]}`);
  check(/\.cg-page\s*\{[^}]*--cg-accent/.test(cssCode),
    'on .cg-page, not on :root — the page must not restate a token for the header');
  check(!/\.header[^\n{]*\{[^}]*--cg-accent/.test(cssCode),
    'and not on a .header rule either');

  /* The card is flush because padding: 0 + overflow: hidden with the radius on
   * the CARD. Asserted as properties on the right rules, because the shape that
   * looks identical in review and renders an 8px band is the alternative. */
  const cardRule = (cssCode.match(/\.cg-target\s*\{([^}]*)\}/) || [])[1] || '';
  check(/padding:\s*0/.test(cardRule), '.cg-target has padding: 0, so the wave is the card\'s header');
  check(/overflow:\s*hidden/.test(cardRule), 'and overflow: hidden, with the card\'s own radius doing the clipping');
  check(/border-radius/.test(cardRule), 'and the radius is on the card, not on the wave');
  const waveRule = (cssCode.match(/\.cg-wave\s*\{([^}]*)\}/) || [])[1] || '';
  check(!/border-radius/.test(waveRule), 'and .cg-wave carries no radius of its own');

  /* §3.G3: segments with no intrinsic width collapse to their border under
   * `flex-basis: auto`; `0` is what makes them share the row. The type band is
   * the same shape. */
  const bandRule = (cssCode.match(/\.cg-choice-types span\s*\{([^}]*)\}/) || [])[1] || '';
  check(/flex:\s*1 1 0/.test(bandRule),
    'the type band\'s segments are flex: 1 1 0, not auto — they have no intrinsic width',
    () => bandRule.trim().slice(0, 80));

  /* THE SHARE GRID NEVER REFLOWS. Ten fixed columns and no breakpoint against
   * them, because two readers\' grids are only comparable if they are the same
   * shape on different screens. */
  const gridRule = (cssCode.match(/\.cg-grid\s*\{([^}]*)\}/) || [])[1] || '';
  check(/grid-template-columns:\s*repeat\(10/.test(gridRule),
    'the result grid is ten fixed columns');
  const mediaBlocks = [...cssCode.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  check(!mediaBlocks.some((b) => /\.cg-grid\s*\{/.test(b)),
    'and no media query redefines it',
    () => 'a breakpoint rewrites .cg-grid, so two readers\' share rows have different shapes');
  check(/aspect-ratio:\s*1/.test(cssCode), 'the cells stay square through aspect-ratio, which a width cannot do');
}

// ---------------------------------------------------------------------------
console.log('\nthe choices really are nameless until the answer is given');
// ---------------------------------------------------------------------------
{
  const body = fnBody(jsCode, 'renderChoices') || '';
  check(/state\.revealed \? escapeHtml\(p\.names\.zh\) : ''/.test(body),
    'the name is written only when state.revealed, so a card is a picture and a number while playing');
  check(body.includes('cg-choice-name'),
    'and the name element always exists, holding its line — otherwise resolving a question resizes four cards');

  /* The name is printed on all four cards in the reference, which turns the game
   * into a memory test. Asserting the ABSENCE of the name in the playing state is
   * the only way that claim can be policed. */
  check(!/cg-choice-name[^}]*>[^<]*\$\{p\.names\.zh\}/.test(body),
    'the name is not written unconditionally');

  /* The sprite is the 96x96 one, not the 475px artwork: the palette this project
   * measures is a 96x96 partition, and pairing a cry with a different render is
   * the same category of error. */
  check(/spriteUrl\(id\)/.test(body), 'the option sprite is the 96x96 sprite the cry index is built beside');
  check(!/artworkUrl/.test(body), 'and never the 475px official artwork');

  /* The sprite is NOT greyscaled here, unlike colour-game's suggestion list —
   * and that is a deliberate difference: there the sprite was a LEAK beside the
   * clue; here it IS the answer. */
  /* SCOPED TO THE BARE SELECTOR. `.cg-choice[^{]*\{` also matches
   * `.cg-choice.is-eliminated .cg-choice-sprite`, so it reports the greyscale the
   * hint deliberately applies as the option sprite being greyscaled. The claim is
   * about the card in its PLAYING state, which is the bare `.cg-choice`. */
  const bareChoice = (cssCode.match(/(?:^|[,}\s])\.cg-choice\s*\{([^}]*)\}/g) || [])
    .map((r) => (r.match(/\{([^}]*)\}/) || [])[1]).join(' ');
  check(!/filter:\s*grayscale/.test(bareChoice),
    'the option sprite keeps its colours while playing — it is the answer here, not a leak beside the clue',
    () => `the bare .cg-choice rule declares ${bareChoice.trim().slice(0, 100)}`);
  check(/\.cg-choice\.is-eliminated[^{]*\{[^}]*opacity/.test(cssCode),
    'and only an ELIMINATED option is greyed, which is how the hint reads at a glance');
}

// ---------------------------------------------------------------------------
/* §3.P: a difficulty tab silently re-narrows the pool. The dangerous half is not
 * the table but a difficulty change that takes away a filter the reader chose,
 * with nothing in the interface saying the pool moved. §3.W's shape. */
console.log('\nthe opening generation is a DEFAULT, not an override');
{
  check(/DEFAULT_GENERATION/.test(jsCode) && /from '\.\/cry-game-similarity\.js'/.test(jsCode),
    'the page reads DEFAULT_GENERATION from the module rather than writing its own lookup');
  check(!/\{\s*easy:\s*1\s*,/.test(jsCode),
    'and holds no copy of it — a second table is a second thing to keep right');
  /* The table is assigned RAW, not run through `normalizeGeneration`. A table
   * naming a generation this corpus lacks would hand `poolFor()` an absent
   * generation and the page would report 「這個範圍沒有足夠的寶可夢出題」 (not enough
   * Pokémon to build a round) on a tier that should have opened on the whole dex.
   * The module checker guarantees the values exist; this is the other end. */
  const setDiffRaw = fnBody(jsCode, 'setDifficulty') || '';
  check(!/state\.gen = normalizeGeneration\(DEFAULT_GENERATION/.test(jsCode),
    'and note that the table is assigned RAW rather than through normalizeGeneration — stated here because the module side is what actually guarantees the value is valid',
    () => 'this page now normalises the default; if that is deliberate, the module check is redundant and one of the two should go');
  const setDiff = fnBody(jsCode, 'setDifficulty') || '';
  check(/if \(!state\.genTouched\) state\.gen = DEFAULT_GENERATION\[next\];/.test(setDiff),
    'setDifficulty() applies the default ONLY while the reader has not chosen a generation',
    () => setDiff.trim().slice(0, 200));
  check(!/state\.gen = DEFAULT_GENERATION/.test(setDiff.replace(/if \(!state\.genTouched\) state\.gen = DEFAULT_GENERATION\[next\];/, '')),
    'and never applies it unconditionally anywhere else in that function');

  /* `genTouched` MUST BE SET BEFORE THE EARLY RETURN. Re-clicking the chip that
   * is already selected returns before the flag is written, so a reader who
   * opened on 簡單 (easy) — where 第I世代 IS the default — and clicked it has made
   * no recorded choice, and their next real pick is treated as their first. */
  const setGen = fnBody(jsCode, 'setGeneration') || '';
  const touchAt = setGen.indexOf('state.genTouched = true;');
  const returnAt = setGen.indexOf('if (next === state.gen) return;');
  check(touchAt > 0 && returnAt > touchAt,
    'setGeneration() records the choice BEFORE its early return — re-clicking the already-selected chip is a no-op for the pool and is exactly the moment the reader has chosen',
    () => `flag at ${touchAt}, early return at ${returnAt}`);
  check(/store\.set\(`\$\{STORE_PREFIX\}genTouched`, true\)/.test(setGen),
    'and persists it — a flag that resets on reload hands a deliberate choice back to a default');
  check(/store\.get\(`\$\{STORE_PREFIX\}genTouched`, false\)/.test(jsCode),
    'and it is read back on boot, strictly === true, so a hand-edited localStorage cannot make it truthy');
  check(!/genTouched:\s*[^,\n]*store\.get/.test(jsCode),
    'and it is not inferred from the stored generation: landing on 簡單 and never touching the chips stores gen: 1 exactly as choosing it deliberately does');

  /* The chips are still the reader's to change — a default that cannot be
   * overridden is not a default. */
  check(/els\.genRow\.addEventListener|closest\('\[data-gen\]'\)/.test(jsCode),
    'and the chips remain bound, so the default is overridable in one click');
}

console.log('\nthe difficulty the page prints is the one the module measured');
// ---------------------------------------------------------------------------
{
  /* Read the constants OUT of the module rather than restating them, so this
   * cannot pass while the page prints a different number from the one every
   * question was built under. */
  const ceiling = (moduleSrc.match(/export const SIMILARITY_CEILING = \{([\s\S]*?)\}/) || [])[1] || '';
  const numbers = [...ceiling.matchAll(/:\s*(-?[\d.]+|Infinity)/g)].map((m) => m[1]);
  check(numbers.length === 3, 'the module exports three ceilings', () => `found ${numbers.length}: ${numbers.join(', ')}`);
  check(numbers[2] === 'Infinity',
    "and 地獄's is Infinity — which is the same code path as any other ceiling, since the filter is `sim <= ceiling`",
    () => `${numbers[2]}`);
  check(jsCode.includes('SIMILARITY_CEILING'),
    'and the page prints the ceiling it is reading, rather than a copy of it');

  check(jsCode.includes('FEATURE_SET') && /const CRY_SET = FEATURE_SET;/.test(jsCode),
    'the page reads the cry set from the module instead of naming one — a page playing latest while the index measures legacy is a game whose difficulty is a fiction');
  check(/CRY_SET === 'legacy'/.test(jsCode),
    'and passes it to the player consistently, rather than defaulting to latest');

  /* The generation chips are DERIVED, so a chip list and the pool filter that has
   * to agree with it are one value rather than two. */
  check(jsCode.includes('availableGenerations(index, data)'), 'the chip list comes from availableGenerations()');
  const markupChips = (htmlCode.match(/data-gen=/g) || []).length;
  check(markupChips === 0,
    'and no chip is written into the markup, which would be a second list to keep right',
    () => `${markupChips} chips in the HTML`);
  check(/gens\b/.test(jsCode) || /for \(const g of generations\)/.test(jsCode),
    'the chips are built from the derived generation list');
}

// ---------------------------------------------------------------------------
console.log('\nthe daily round survives a reload, and rebuilds rather than restores it');
// ---------------------------------------------------------------------------
{
  const fn = fnBody(jsCode, 'restoreDaily') || '';
  check(!!fn, 'restoreDaily() exists');
  check(/buildDailyRound\(/.test(fn),
    'and it REBUILDS the questions from the seed rather than storing them — a stored round would pin today\'s puzzle to one reader\'s first visit');
  check(/store\.get/.test(fn), 'reading what was saved');

  /* Only the picks are persisted. Storing the answers too would be the same
   * duplication with a worse failure mode. */
  const persist = fnBody(jsCode, 'persistDaily') || '';
  check(/picks:/.test(persist) && !/answers:/.test(persist) && !/questions:/.test(persist),
    'only the PICKS are persisted — the questions are re-derived, so they cannot drift from the module');
  /* `localStorage` appears only inside the `store` wrapper, which is the point of
   * the wrapper: private mode throws on `getItem`, and a page that touches storage
   * unguarded dies before it renders. The count is compared against the wrapper's
   * own, not against zero.
   *
   * The wrapper is an OBJECT LITERAL, so `fnBody()` cannot find it — it is sliced
   * out of the source, and the assertion is that nothing OUTSIDE it names
   * `localStorage`. */
  const storeLiteral = (jsCode.match(/const store = \{[\s\S]*?\n\};/) || [])[0] || '';
  check(storeLiteral.includes('localStorage'), 'the try/catch `store` wrapper exists');
  check((storeLiteral.match(/localStorage\./g) || []).length === 3,
    'and uses localStorage three times — get, set, remove',
    () => `${(storeLiteral.match(/localStorage\./g) || []).length}`);
  const outsideStore = jsCode.replace(storeLiteral, '');
  const outside = (outsideStore.match(/localStorage\./g) || []).length;
  check(outside === 0,
    'and NOTHING outside it names localStorage — private mode throws on getItem, and a page that touches storage unguarded dies before it renders',
    () => `${outside} occurrences outside the wrapper`);

  /* The key carries the mode's inputs, so two filters on one day are two rounds.
   * The TEMPLATE is where the filter reaches the key and the call site is only
   * how the value gets there: asserting the call site alone is satisfied by a
   * signature that takes two parameters and a template that uses one. */
  const keyFn = (jsCode.match(/const dailyKey = \(([^)]*)\) => `([^`]*)`/) || []);
  check(keyFn[2] ? /\$\{difficulty\}/.test(keyFn[2]) && /\$\{gen\}/.test(keyFn[2]) : false,
    'the daily key template carries BOTH the difficulty and the generation filter',
    () => `the template is \`${keyFn[2]}\``);
  check(/dailyKey\(\s*state\.difficulty\s*,\s*state\.gen\s*\)/.test(jsCode),
    'and the call site passes the filter in');
  /* No parens in the pattern: the capture group `\(([^)]*)\)` excludes them, so
   * `keyFn[1]` is `difficulty, gen` and a regex demanding a literal `\(` cannot
   * match it. */
  check(/\bgen\b/.test(keyFn[1] || ''),
    'so a drop from the template cannot be silent',
    () => `the signature is (${keyFn[1]})`);
  check(jsCode.includes('STORE_PREFIX') && /const STORE_PREFIX = 'pokemon-crygame:'/.test(jsCode),
    "and the prefix is this game's own");

  /* A reload mid-round resumes at the first UNANSWERED question, derived from
   * the picks rather than from a stored counter that can disagree with them. */
  /* A `get()` INSIDE `Object.defineProperty(state, 'indexOfCurrent', …)`, so it is
   * not a `function name(` and `fnBody()` cannot find it. Asserted on the actual
   * construct. */
  const derived = (jsCode.match(/Object\.defineProperty\(state,\s*'indexOfCurrent',[\s\S]{0,900}?get\(\)\s*\{[\s\S]{0,900}?\}/) || [])[0] || '';
  check(!!derived, 'the current question is a DERIVED getter on `state`, not a stored counter',
    () => 'indexOfCurrent is not defined with Object.defineProperty(state, …, { get() { … } })');
  check(/state\.picks\.findIndex\(/.test(derived),
    'which walks the picks for the first unanswered question — a stored step and a stored pick can disagree, and the two disagree silently');
  check(!/state\.step/.test(jsCode) && !/step:\s*0/.test(jsCode),
    'and there is no step counter anywhere that could disagree with it');
  check(/slice\(0, first\)/.test(fn), 'and a mid-round restore truncates to the first unanswered question');
}

// ---------------------------------------------------------------------------
/* `taipeiDateKey(now)` REQUIRES its argument: it reads `now.getTime()` with no
 * default, so a bare call is a TypeError rather than a date. A bare call in
 * `newRound()` threw inside `persistDaily()` — no round, no waveform, and a page
 * that looked loaded. One helper is the fix; the assertion is that no bare call
 * survives anywhere. */
console.log('\nthe Taipei day key is never called bare');
{
  check(!/taipeiDateKey\(\s*\)/.test(jsCode),
    'cry-game.js never calls taipeiDateKey() with no argument',
    () => `${(jsCode.match(/taipeiDateKey\(\s*\)/g) || []).length} bare calls`);
  const helper = fnBody(jsCode, 'todayKey') || '';
  check(/taipeiDateKey\(new Date\(\)\)/.test(helper), 'it goes through todayKey(), which passes a Date');
  const bare = (jsCode.match(/taipeiDateKey\(/g) || []).length;
  check(bare === 1, 'and todayKey() is the file\'s only route to it', () => `${bare} calls`);
  const dailyPick = readFileSync(join(ROOT, 'assets/js/daily-pick.js'), 'utf8');
  const dpSig = (dailyPick.match(/export function taipeiDateKey\(([^)]*)\)/) || [])[1];
  check(dpSig !== undefined && !/=/.test(dpSig) && /now\.getTime\(\)/.test(dailyPick),
    'because daily-pick.js declares taipeiDateKey(now) with NO default and immediately reads now.getTime()',
    () => `its signature is taipeiDateKey(${dpSig})`);
}

// ---------------------------------------------------------------------------
console.log('\nthe answer\'s dossier link is built by the canonical helper');
// ---------------------------------------------------------------------------
{
  /* §3.A: the link must come from `pokemonDetailUrl()` — a derived string breaks
   * the day either page gains a path segment, and `nidoran-f` / `nidoran-m` are
   * the pair that would silently merge. A STATIC href is also a trap: it renders
   * until the first render overwrites it, so a reader who opens the page early
   * sees a link to the wrong place. */
  check(/import \{[^}]*pokemonDetailUrl[^}]*\} from '\.\/shared\.js'/.test(jsCode),
    'the page imports pokemonDetailUrl from shared.js');
  check(/els\.listen\.href = pokemonDetailUrl\(/.test(jsCode),
    'and assigns #cg-listen\'s href from it');
  check(!/detail\.html\?slug=/.test(jsCode),
    'and never assembles a detail URL by hand — a derived string is what merges nidoran-f and nidoran-m',
    () => 'cry-game.js contains a literal detail.html?slug= template');

  const body = fnBody(jsCode, 'renderResult') || '';
  const early = body.indexOf('if (!done) return;');
  const linkAt = body.indexOf('els.listen.href');
  check(linkAt > 0 && (early < 0 || linkAt < early),
    'and the link is written BEFORE the finished-round early return — it belongs to a resolved question, not to a round\'s end',
    () => `the link is written at ${linkAt}, the early return at ${early}`);

  const markup = (htmlCode.match(/id="cg-listen"[^>]*/) || [])[0] || '';
  check(/href="/.test(markup),
    'and the markup carries a real href rather than an empty one — a static value is what renders the wrong destination before the first render',
    () => `the anchor is ${JSON.stringify(markup)}`);
}

// ---------------------------------------------------------------------------
/* §3.G: one preference, one default, one piece of markup. `cry-autoplay.js`
 * exists so the three sibling 叫聲 pages do not each grow their own; this page is
 * the fourth consumer and writes none of it. The class prefix is `cg-` because
 * `mountAutoplay` builds its markup from `className`, so every rule it needs
 * belongs to cry-game.css. */
console.log('\nthe autoplay switch is mounted, not reimplemented');
{
  check(/from '\.\/cry-autoplay\.js'/.test(jsCode), 'the page imports mountAutoplay from cry-autoplay.js');
  check(/mountAutoplay\(els\.autoplaySlot, \{/.test(jsCode), 'and mounts it into its own slot');
  check(/className:\s*'cg-autoplay'/.test(jsCode),
    'with a `cg-` className — the module builds its markup from this, so cries.css\'s `.cy-autoplay` rules cannot reach it');

  /* The slot is EMPTY in the markup and stays that way: `mountAutoplay` appends,
   * so anything written between the tags is a second control no code removes. */
  const slot = (htmlCode.match(/<div class="cg-autoplay-slot" id="cg-autoplay-slot">([\s\S]*?)<\/div>/) || [])[1];
  check(slot !== undefined && slot.trim() === '',
    'the slot div is empty in the markup — mountAutoplay appends to it',
    () => `it contains ${JSON.stringify(slot)}`);

  /* The five names the module queries are an INTERFACE, not this page's
   * selectors. It writes `className` onto the element and reads
   * `.${className}-track` and `.${className}-text` back out, so a missing rule
   * here is an unstyled switch rather than an error anywhere. */
  for (const part of ['-track', '-track::after', '-text', '-text span', '[aria-checked="true"]']) {
    check(cssCode.includes(`.cg-autoplay${part}`) || cssCode.includes(`.cg-autoplay${part.replace('"', "'")}`),
      `cry-game.css styles .cg-autoplay${part}, which the mounted markup needs`,
      () => `no rule for .cg-autoplay${part}`);
  }
  check(cssCode.includes('.cg-autoplay-text span'), 'and the hint line specifically, because the switch states its own position before the reader touches it');

  /* All three conditions are necessary, and `audioUnlocked` is the one that reads
   * as an optimisation. Measured: `cryPlayer.play()` before any user gesture
   * leaves the promise PENDING forever — no rejection, `onStart` never fires — so
   * the flag is what stops the page attempting a play that can only hang. */
  const maybe = fnBody(jsCode, 'maybeAutoPlay') || '';
  check(/if \(!autoplay \|\| !autoplay\.on \|\| !audioUnlocked\) return;/.test(maybe),
    'maybeAutoPlay() refuses unless the switch is on AND the document has been activated',
    () => maybe.trim().split('\n').slice(0, 3).join(' '));
  check(/if \(cryPlayer\.playing\) return;/.test(maybe), 'and unless something is already sounding');
  const install = fnBody(jsCode, 'installUnlock') || '';
  check(/document\.addEventListener\('click', once, true\)/.test(install),
    'the unlock is a CAPTURE-phase one-shot listener — a first click swallowed by whatever handled it would leave auto-play permanently off with nothing wrong on screen');
  check(/document\.removeEventListener\('click', once, true\)/.test(install),
    'and it removes itself, so the handler does not run for the rest of the session');
  check(/cryPlayer\.unlock\(\)/.test(install), 'calling cryPlayer.unlock() rather than reaching into the context');

  /* Called from the two transitions and nowhere else. `renderAll()` runs on a
   * theme flip, a resize and every state write, so an auto-play there would
   * replay the cry on a theme change. */
  const callers = [...jsCode.matchAll(/maybeAutoPlay\(\)/g)].map((m) => m.index);
  check(callers.length === 3,
    'maybeAutoPlay() is called three times: its definition and the two transitions',
    () => `${callers.length} references`);
  for (const name of ['newRound', 'advance']) {
    check(/maybeAutoPlay\(\);/.test(fnBody(jsCode, name) || ''), `and it is called from ${name}()`);
  }
  for (const name of ['renderAll', 'renderChoices', 'renderResult', 'answer', 'useHint']) {
    check(!/maybeAutoPlay\(\)/.test(fnBody(jsCode, name) || ''), `${name}() does not auto-play`);
  }

  /* Mounted BEFORE the first round is drawn. `maybeAutoPlay()` reads `autoplay`,
   * and a default-constructed `null` there means the first question silently
   * ignores a preference the reader set on a different page. */
  const init2 = fnBody(jsCode, 'init') || '';
  const mountAt = init2.indexOf('mountAutoplay(');
  const newRoundAt = init2.indexOf('if (!restoreDaily()) newRound();');
  check(mountAt > 0 && newRoundAt > 0 && mountAt < newRoundAt,
    'the switch is mounted BEFORE the first round is drawn',
    () => `mount at ${mountAt}, first round at ${newRoundAt}`);
  check(/if \(!on\) \{[\s\S]{0,200}?cryPlayer\.stop\(\)/.test(init2),
    'and turning it OFF stops whatever is sounding, copied from cries-gen1.html — a switch that turns autoplay off while the cry keeps playing does not mean its label');

  /* AN AUTO-PLAY FAILURE IS SILENT. The convenience raising an alarm about a
   * question the reader never chose to play is a second thing to react to. */
  check(/lastAnnouncement = fromAutoPlay\s*\? null/.test(jsCode),
    'a failed auto-play falls back to silence rather than announcing a decode error');
}

// ---------------------------------------------------------------------------
/* §3.I: the review block is rebuilt wholesale on every render, so its listener
 * must be delegated — a per-sprite listener would be bound to a node about to be
 * thrown away. */
console.log('\nthe result review is delegated, and renders forty playable sprites');
{
  check(htmlCode.includes('id="cg-review"'), 'the review list exists');
  check(!/<details[\s>]/.test(htmlCode),
    'and it is NOT a <details> — §3.X measured that ::details-content inserts a box into the box tree and broke a flex parent on spectrum.html');
  check(/aria-label="每題的四個選項"/.test(htmlCode), 'with a label a screen reader can reach');

  const review = fnBody(jsCode, 'renderReview') || '';
  check(/state\.questions\.map/.test(review), 'renderReview() reads the round, so nothing extra is persisted to draw it');
  check((review.match(/cg-review-sprite/g) || []).length >= 2,
    'and builds a button per option — forty for a ten-question round');
  check(/aria-label="播放 #/.test(review),
    'each button is a REAL <button> with a label naming the species, so the whole 64px tile is the target and it announces what it does');
  check(/<img[^>]*loading="lazy"/.test(review), 'and its sprite is lazy — forty images the reader may never scroll to');
  check(/spriteUrl\(id\)/.test(review) && !/artworkUrl/.test(review),
    'the 96px sprite and never the 475px artwork, as everywhere else on this page');
  check(/escapeHtml\(p\.names\.zh\)/.test(review), 'the name is escaped — it is DATA, and 圖鑑說明 has produced apostrophes');

  check(/els\.review\.addEventListener/.test(jsCode), 'the click is delegated from #cg-review');
  /* An ABSENCE WITHIN THE FUNCTION THAT BUILDS THEM, not a regex trying to spot a
   * loop: `[^}]*` between a `for (` and an `addEventListener` cannot cross a
   * closing brace, so a listener added inside a nested block passes. The claim is
   * about what `renderReview()` does, so it reads that function's body. */
  check(!/addEventListener/.test(review),
    'and renderReview() attaches no listener at all — the block is replaced on every render',
    () => [...review.matchAll(/.{0,60}addEventListener.{0,40}/g)].map((m) => m[0]).join(' | '));

  /* Every species plays ITSELF. The review exists so a reader can hear all four
   * and pick out the answer; a per-question button playing only the answer would
   * say nothing the green border two inches above has not already said. */
  check(/cryPlayer\.play\(id, \{/.test(jsCode),
    'and a review sprite plays ITS OWN id, not the question\'s answer');
  check(/onStart: \(\) => setReviewPlaying\(id\)/.test(jsCode),
    'lighting exactly that sprite from onStart, so the glyph and the audio agree');
  check(/let reviewPlayingId = null/.test(jsCode) && /delete prev\.dataset\.playing/.test(jsCode),
    'the PREVIOUS one is cleared rather than clearing all forty — two glyphs lit at once would leave the reader unable to tell which to wait for');
  check(/active\.dataset\.playing = ''/.test(jsCode),
    'and the state is re-applied after a rebuild, because the block is replaced on every render');

  /* A direct request fails LOUDLY, unlike the auto-play path: the reader pressed
   * one specific sprite, so the honest answer is that it could not be played. */
  check(/lastAnnouncement = `#\$\{id\}.*播不出來/s.test(jsCode) || /#\$\{id\} \$\{p\.names\.zh\} 的叫聲播不出來/.test(jsCode),
    'a failed review play announces itself, unlike a failed auto-play which falls back to silence');

  /* A NEW ROUND MUST NOT LEAVE THE PREVIOUS ANSWER KEY IN THE DOM. */
  const result = fnBody(jsCode, 'renderResult') || '';
  check(/els\.review\.innerHTML = ''/.test(result),
    'starting a new round clears the review rather than leaving forty sprites under a hidden panel');
  check(/reviewPlayingId = null/.test(jsCode),
    'and the playing pointer is reset with it');
}

console.log('\nthe four defects a static checker could not have found');
// ---------------------------------------------------------------------------
{
  /* Each of these shipped into a page whose shape assertions were all green, and
   * each was found by driving the real page in a browser. They are pinned here so
   * a SECOND run does not have to find them again, and so the next page in this
   * project inherits the list rather than rediscovering it. */

  // 1. The round ended one question early, so question 10 never happened.
  /* BRACE-MATCHED TO `advance()`, not a whole-file regex: `renderNext()` contains
   * the identical expression, so a whole-file search is satisfied by the other
   * function while the defect is live (§3.P's second vacuous shape). This is why
   * the file has a `fnBody()` helper. */
  const advance = fnBody(jsCode, 'advance') || '';
  check(/state\.answeredAt \+ 1 >= state\.questions\.length/.test(advance),
    'advance() closes the round from answeredAt, not from indexOfCurrent + 1 — the getter has ALREADY moved past the question being left',
    () => advance.split('\n').filter((l) => /questions\.length/.test(l)).join(' '));
  check(!/indexOfCurrent\s*\+\s*1/.test(advance),
    'and advance() never adds one to the derived index',
    () => advance.split('\n').filter((l) => l.includes('indexOfCurrent')).join(' '));
  check(/if \(state\.answeredAt != null\) return state\.answeredAt;/.test(jsCode),
    'and indexOfCurrent returns answeredAt while a question is revealed, because the reader STAYS on the question they just answered');

  // 2. Saved picks restored as nothing.
  const restore = fnBody(jsCode, 'restoreDaily') || '';
  check(/questions\.map\(\(q, i\) =>/.test(restore) && /saved\.picks \|\| \[\]\)\[i\]/.test(restore),
    'restoreDaily() maps the saved picks BY POSITION — indexing by the question object stringifies it to [object Object] and every pick restores as null',
    () => 'the picks are not restored by index i');
  /* NOT `saved.picks` as a bare string — that also matches the CORRECT line,
   * which is `(saved.picks || [])[i]`. The thing being banned is an index that is
   * not `i`. */
  const badIndex = [...restore.matchAll(/saved\.picks[\s\S]{0,40}?\[\s*([a-z]+)\]/g)]
    .map((m) => m[1]).filter((v) => v !== 'i');
  check(badIndex.length === 0,
    'and the index into the saved array is always `i` and never a question',
    () => `indexed by: ${[...new Set(badIndex)].join(', ')}`);

  // 3. `findIndex` has THREE answers, and -1 is one of them.
  check(/const first = state\.picks\.findIndex/.test(restore)
    && /if \(first === -1\)/.test(restore),
    'restoreDaily() tests `first === -1` FIRST — a finished round returns -1 from findIndex, and `-1 < MAX_QUESTIONS` takes the mid-round branch',
    () => 'the -1 case is not handled before the inequality');
  const firstIf = restore.indexOf('if (first === -1)');
  const midIf = restore.indexOf('if (first > 0)');
  check(firstIf > 0 && midIf > firstIf,
    'and the finished case is handled before the mid-round one');
  check(/if \(first === 0\)/.test(restore) === false
    && /first === 0/.test(restore) === false,
    'and `first === 0` is not tested at all — it falls through to the same draw-everything path as every un-answered restore');

  // 4. The waveform was blank until the decode resolved.
  const load2 = fnBody(jsCode, 'loadWave') || '';
  const placeholderAt = load2.indexOf('paintWave(placeholder)');
  const awaitAt = load2.indexOf('await cryPlayer.waveformPeaks');
  check(placeholderAt > 0 && awaitAt > 0 && placeholderAt < awaitAt,
    'loadWave() draws a flat placeholder BEFORE awaiting the decode — setting canvas.width clears it, and a reader was looking at an empty box for a network round trip on every question after the first',
    () => `placeholder at ${placeholderAt}, await at ${awaitAt}`);
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);