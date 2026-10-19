/**
 * color-game.html — the shell contract, plus the invariants a browser would be
 * needed to see.
 *
 *   node scripts/check_color_game.mjs
 *
 * WHY A SEPARATE FILE. `check_color_match.mjs` and `check_game_hints.mjs` cover the
 * two pure modules. This covers the page and the state machine, which is where
 * every defect found so far in this feature has actually been: a short-circuit
 * that made a whole section dead, a badge nothing ever un-hid, a duplicated
 * declaration that blanked the page.
 *
 * THREE OF THE SHAPES BELOW ARE §3.P's, and they are the reason this file exists.
 * §3.P is the incident where maze.html shipped with three defects and zero check
 * coverage — nothing in the manifest mentioned the string `maze`. Four of that
 * checker's own 23 mutations stayed green and all four were VACUOUS:
 *
 *   - a lazy `[\s\S]*?` that ran to end-of-file and was satisfied by a call in a
 *     different function
 *   - a lazy `[\s\S]*?return false;` that is not a branch and ran past the brace
 *     into its sibling
 *   - an error-message string asserted as if it were a range check
 *
 * So every shape assertion here is BRACE- or BLOCK-matched to what it names, and
 * every one that could be satisfied by a string appearing anywhere says so in its
 * own description. A guard nobody has seen fail is a claim, not a check.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let total = 0;
let failures = 0;
function check(ok, description, detail = () => '') {
  total++;
  if (ok) console.log(`  ok   ${description}`);
  else { failures++; console.log(`  FAIL ${description}`); console.log(`       ${detail()}`); }
}

const html = read('color-game.html');

/* The markup with its comments removed, for any assertion about which ELEMENTS are
 * present. §3.P's finding again, this time in the file the fix itself was written in:
 * the comment explaining why the datalist is gone says 「A `<datalist>` popup」, so a
 * presence test for `<datalist` was satisfied by the prose that documents its
 * removal — and the absence test that should have caught it was the one reading the
 * comment. The same reason `jsCode` and `cssCode` exist beside their sources. */
const htmlCode = html.replace(/<!--[\s\S]*?-->/g, ' ');
const js = read('assets/js/color-game.js');
const css = read('assets/css/color-game.css');
const similarity = read('assets/js/game-similarity.js');
const hints = read('assets/js/game-hints.js');
const shared = read('assets/js/shared.js');
const navCss = read('assets/css/shared.css');

/* Mask comments and string literals before any SHAPE assertion. §3.S's false
 * positive, twice over on this page: the module's own docblock quotes
 * `legendId && applyHex(...)` and the CSS's documents `setRevealed()`, so a
 * text search for the shape it warns about finds the warning. */
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

import { TIPS, tipAt, typeDelay, randomTipIndex, TIP_TYPE_TOTAL_CAP_MS } from '../assets/js/game-tips.js';

const jsCode = stripJs(js);
const cssCode = stripCss(css);

/**
 * The body of one CSS rule, brace-matched to ITS OWN block.
 *
 * §3.P's first vacuous mutation: a lazy `[\s\S]*?` that runs to end-of-file is
 * satisfied by a declaration in a different rule, so the assertion describes one
 * selector and checks another. This walks the braces.
 */
function ruleBody(source, selector) {
  const re = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm');
  const m = re.exec(source);
  if (!m) return null;
  const open = source.indexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

/**
 * The body of one JS block, brace-matched from the `{` that follows `anchor`.
 *
 * `ruleBody()` above is the CSS half; this is the JS half, and it exists for the
 * same reason. The assertions about the Enter chain are about WHICH BLOCK each
 * step lives in — "while the list is open, Enter selects and does not submit" is a
 * claim about the `if (listIsOpen())` block, and a lazy `[\s\S]*?` would be
 * satisfied by a `pickFromSearch()` call in the block below it, which is exactly
 * the mutation this file was written to catch. §3.P's second vacuous shape.
 *
 * Returns null when `anchor` is absent or has no opening brace after it, so a
 * caller can assert on null rather than on an empty string that matches anything.
 */
function blockBody(source, anchor) {
  const at = source.indexOf(anchor);
  if (at < 0) return null;
  const open = source.indexOf('{', at + anchor.length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

/** Every index of `needle` in `hay`, ascending. Empty array when absent. */
function indicesOf(hay, needle) {
  const out = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}
// ---------------------------------------------------------------------------
{
  const headerTag = (html.match(/<header\b[^>]*>/) || [''])[0];
  check(/\bclass="[^"]*\bheader\b/.test(headerTag), 'the page carries a .header');

  /* The six row-layout modifiers are READ OUT of shared.css rather than restated.
   * A hardcoded copy is a second thing to keep right and would keep passing after
   * shared.css renamed one. */
  const block = navCss.match(/(\.header-[\w-]+(?:\s*,\s*\.\w*[\w-]+)*)\s*\{[^}]*flex-direction:\s*row[^}]*\}/)
    || navCss.match(/(\.header-[\w-]+(?:\s*,\s*\.header-[\w-]+)*)\s*\{[^}]*flex-direction:\s*row[^}]*\}/);
  const rowClasses = block ? block[1].split(',').map((s) => s.trim()) : [];
  check(rowClasses.length > 0,
    `the row-layout modifier list is still in shared.css (${rowClasses.length} classes)`,
    () => 'no rule in shared.css sets `flex-direction: row` on a .header-* class, so this check cannot see the layout it guards');

  const headerClasses = (headerTag.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/);
  const carried = headerClasses.filter((c) => rowClasses.includes(`.${c}`));
  check(carried.length === 1,
    `the header carries exactly one row-layout modifier (${carried.join(', ') || 'none'})`,
    () => `carries ${carried.length}. .header on its own is flex-direction: COLUMN, so the nav falls to a second row and collides with the theme toggle; two modifiers means the winner is source order rather than intent`);

  // The theme toggle's contents belong to initThemeToggle(). A hardcoded,
  // differently-classed pair is not skipped by its guard but DOUBLED.
  const toggle = html.match(/<button class="theme-toggle"[^>]*>([\s\S]*?)<\/button>/);
  check(!!toggle && !/<[a-z]/.test(toggle[1]),
    'no authored children inside the theme toggle',
    () => 'initThemeToggle() injects the pair itself and its guard only looks for .icon-sun, so a differently-named pair is doubled, not replaced');

  /* THE TOGGLE HAS TO BE MOUNTED, not merely present.
   *
   * `check_nav_pages.mjs` reads the MARKUP, so a `.theme-toggle` in the header passed
   * every header check on a page that never called `initThemeToggle()` — the button
   * was there, 34x34, hit-testable, and painting nothing, because its two icons are
   * injected at runtime. §3.G1a's shape exactly: the check asked whether the control
   * EXIST rather than whether it did anything.
   *
   * The mount has to be readable off the HTML for the same reason the nav mount is —
   * a grep over `assets/js` cannot answer which pages mount it — so the assertion
   * reads the page, not the module. */
  /* ANCHORED TO THE STATEMENT, not the bare name. The first version was
   * `/initThemeToggle\(\)/.test(html)`, which the explanatory comment six lines
   * above the call also satisfies — so deleting the call left it green. §3.P's
   * finding again, in a different file: a comment is a false positive, and here the
   * comment was written by the same change that introduced the bug the check guards.
   * `html` is comment-stripped for the CSS assertions but NOT for this one, so the
   * anchor has to do the work. */
  check(/^\s*initThemeToggle\(\);\s*$/m.test(html),
    "initThemeToggle() is CALLED from the page's inline module, so the button's icons are ever injected",
    () => 'the button ships empty by design (§3.G2) and nothing fills it — present, hit-testable, painting nothing');
  check(/import\s*\{[^}]*\binitThemeToggle\b[^}]*\}\s*from\s*'\.\/assets\/js\/shared\.js'/.test(html),
    'and it is imported from shared.js, so the call is not a free identifier');
  check(!/initThemeToggle/.test(jsCode),
    'and color-game.js does NOT mount it a second time',
    () => 'two mounts re-render the button onto a DOM that already has it');

  check(/initHeaderNav\('color-game\.html'\)/.test(html),
    "initHeaderNav('color-game.html') is called from the page's inline module",
    () => 'the mount must be in the HTML, not in color-game.js — check_nav_pages.mjs reads it off the HTML by design, because a grep over assets/js cannot answer which pages mount the nav');

  check(!/initHeaderNav/.test(jsCode),
    'and color-game.js does NOT mount it too',
    () => 'two calls re-render the trigger\'s current state onto a DOM that already has it');
}

// ---------------------------------------------------------------------------
console.log('\nevery getElementById resolves');
// ---------------------------------------------------------------------------
{
  const lookups = [...js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  /* `gm-hint-btn` is written by renderHints() and read back on the next line, so
   * it is legitimately absent from the markup. The first version flagged it as a
   * dangling reference, which would have pushed a correct dynamic id back into
   * the HTML and made it a stale node the moment the button re-rendered. An id
   * the module ITSELF writes is excluded — and only that exclusion. */
  const selfWritten = new Set([...js.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
  const dangling = [...new Set(lookups)].filter((id) => !ids.has(id) && !selfWritten.has(id));
  check(lookups.length > 0, 'the id check found something to check',
    () => 'no getElementById calls matched, so the check below is vacuously green — its regex probably drifted');
  check(dangling.length === 0,
    `all ${new Set(lookups).size - 1} markup-declared getElementById targets exist (plus 1 the module writes itself)`,
    () => `looks up ${dangling.map((i) => `#${i}`).join(', ')}, which the markup never declares. Each resolves to null and the first .addEventListener on one throws, killing the rest of the module including init() — this is exactly what happened to color.html's Export Theme rebuild`);

  // The reverse: a declared id nothing reads is dead markup.
  /* Delegated elements are read by `closest('#id')`, not by getElementById, so
   * the first version called all seven of them orphans and would have pushed the
   * page toward a capture-and-bind pattern that §3.G7's detached node makes
   * fragile. An id is "used" if EITHER lookup reaches it. */
  /* Three lookup styles reach a node: getElementById, closest('#id'), and
   * closest('[data-x]') for the tab rows, which carry their role as ATTRIBUTES
   * rather than ids — `data-mode` and `data-difficulty` are what the handler
   * reads, and the ids on those buttons are labels for a human reading the
   * source. The first version counted only the first two and reported six
   * deliberate ids as orphans. */
  const delegated = new Set([...js.matchAll(/closest\(\s*'#([\w-]+)'/g)].map((m) => m[1]));
  const attrHooks = new Set([...js.matchAll(/closest\(\s*'\[([\w-]+)\]'/g)].map((m) => m[1]));
  const attrCarriers = new Set([...html.matchAll(/data-([\w-]+)="/g)].map((m) => `data-${m[1]}`));
  const viaAttr = [...ids].filter((id) => [...attrCarriers].some((a) => {
    const tag = (html.match(new RegExp(`<[^>]*\\sid="${id}"[^>]*>`)) || [''])[0];
    return tag.includes(a);
  }));
  const used = new Set([...lookups, ...delegated, ...viaAttr]);
  check(attrHooks.size >= 2, `delegation reaches ${attrHooks.size} attribute hooks`,
    () => 'the [data-...] delegation regex stopped matching');
  const orphans = [...ids].filter((id) => !used.has(id)
    && !html.includes(`for="${id}"`) && !html.includes(`aria-labelledby="${id}"`)
    && !html.includes(`aria-controls="${id}"`) && !html.includes(`aria-describedby="${id}"`)
    && !html.includes(`list="${id}"`));
  check(orphans.length === 0, 'and no id is declared and reached by neither lookup',
    () => `${orphans.join(', ')} — either the markup or the query is out of date`);
  /* The invariant is "every control reaches its handler by a route a re-render
   * cannot break", and there are two such routes — `closest('#id')` on a delegated
   * ancestor, and a direct listener on a node that is never rebuilt. This used to
   * count only the first, with a floor of 4, because `closest()` was the only one
   * in use. The hint button then moved to the second route, which is STRONGER (a
   * delegated lookup cannot touch a detached node because it is matched against the
   * event path; a captured one can), so the count dropped from 4 to 3 on an
   * improvement.
   *
   * That is the §3.B2 shape: a number standing in for a claim, which then fails on
   * the good case. So the count is now of both routes — and the binding is resolved
   * from the `els` table rather than assumed, because "there is an `els.foo` line"
   * is not "something listened to `els.foo`". */
  const bound = new Set(delegated);
  for (const m of js.matchAll(/els\.(\w+) = document\.getElementById\('([^']+)'\)/g)) {
    if (new RegExp(`els\\.${m[1]}\\.addEventListener\\b`).test(js)) bound.add(m[2]);
  }
  check(bound.size >= 4,
    `and ${bound.size} more ids reach a handler by a route a re-render cannot break `
    + `(${delegated.size} delegated, ${bound.size - delegated.size} bound directly on a permanent node)`,
    () => `only ${bound.size} — some control probably lost its handler route`);
  check(/els\.hintBtn\.addEventListener/.test(js),
    'and the hint button is in the second group: a permanent node, bound once');
}

// ---------------------------------------------------------------------------
console.log('\nthe three tiers, and what makes 地獄 (hell) different');
// ---------------------------------------------------------------------------
{
  for (const d of ['easy', 'hard', 'hell']) {
    check(new RegExp(`data-difficulty="${d}"`).test(html), `the ${d} tier is in the markup`);
  }
  check(/id="gm-mode-daily"/.test(html) && /id="gm-mode-unlimited"/.test(html),
    'both modes are present (每日 / 無限)');

  // The whole point of 地獄 (hell) is the appearance, and the pools of hard and hell are
  // IDENTICAL. So the badge is the only place that difference can be visible.
  check(/id="gm-shiny-badge"/.test(html), 'the 異色 badge exists in the markup');
  const badge = html.match(/<span class="gm-shiny-badge"[^>]*>/);
  check(!!badge && /\bhidden\b/.test(badge[0]),
    'and ships hidden, so JS has to turn it on');
  check(/els\.shinyBadge\s*=/.test(jsCode), 'which the module actually reads');
  check(/renderShinyBadge\(\)/.test(jsCode), 'and turns on through a named function');
  /* The badge shipped in the HTML with `hidden` and NOTHING in the module ever
   * touched it, so 地獄 (hell) rendered identically to 困難 (hard) — the entire reason for the
   * tier's existence was invisible. Asserting the markup alone would have passed
   * throughout; the assertion is that the CALL SITE exists. */
  check(/renderShinyBadge\s*\(\s*\)\s*;/.test(jsCode.split('function renderAll')[1] || ''),
    'and renderAll() calls it — the defect was the element existing with nothing ever unhiding it');

  const simCode = stripJs(similarity);
  check(/function variantOf\(difficulty\)\s*\{\s*return difficulty === 'hell' \? 's' : 'n';/.test(simCode),
    "variantOf() is one line in game-similarity.js: only 地獄 (hell) is shiny",
    () => 'a second way for a tier to become shiny would be a second thing to keep right');
  check(!/function variantOf/.test(jsCode),
    'and color-game.js defines no second one',
    () => 'the page re-decides the variant, so the badge and the palette can disagree');
}

// ---------------------------------------------------------------------------
console.log('\n§3.M: every element JS hides also has the CSS that hides it');
// ---------------------------------------------------------------------------
{
  /* §3.M is not "every hidden element needs a [hidden] rule". It is: an element
   * whose AUTHOR display is a flex/grid box beats the UA sheet's
   * `[hidden] { display: none }`, so THAT element needs the extra rule. A
   * `<section>` with no author display is `display: block` and the UA rule wins
   * on its own — and `.gm-result` is exactly that, which the first version of
   * this check got wrong by demanding a display from it and then reading the
   * `[hidden]` rule's `display: none` as if it were the base one.
   *
   * So the condition is the flex/grid one, and the check below is derived from
   * the stylesheet rather than from a list. */
  const FLEXY = /\bflex\b|\bgrid\b|\binline-flex\b|\binline-grid\b/;

  /* The `els.` prefix is REQUIRED, and its absence is the whole bug this section
   * had on its first run. Two things went wrong at once:
   *
   *   1. `setRevealed(node, on)` is the helper's own PARAMETER, and matching it
   *      put a key called `node` in the list.
   *   2. `paletteEmpty` -> `.palette-empty`, because deriving the class by
   *      kebab-casing the key drops the `gm-` prefix the markup actually uses.
   *
   * Together they made every `ruleBody` lookup return null, `needsRule` came out
   * EMPTY, and the loop below ran zero times — so the section printed green while
   * checking nothing at all. That is §3.P's shape reproduced by the checker
   * written to prevent it: an assertion that can be satisfied vacuously, and a
   * vacuous one is indistinguishable from a passing one in the output.
   *
   * The class is now looked up in the MARKUP rather than derived, and
   * `needsRule` is asserted non-empty below. */
  const hiddenByJs = [...new Set([...jsCode.matchAll(/setRevealed\(\s*els\.(\w+)/g)].map((m) => m[1]))];
  /* The assignment lives in the JS, not the HTML — the first version grepped the
   * HTML for it, found nothing, resolved 0 of 5, and the vacuity guard fired
   * correctly on top of a lookup that was itself wrong. So: JS gives the key, JS
   * gives the id, and the id is then required to exist in the markup. */
  const selOf = (key) => {
    const id = (jsCode.match(new RegExp(`els\\.${key}\\s*=\\s*document\\.getElementById\\(\\s*'([\\w-]+)'`)) || [])[1];
    return id ? `#${id}` : null;
  };
  const needsRule = [];
  const resolved = [];
  for (const key of hiddenByJs) {
    const id = selOf(key);
    if (!id) continue;
    resolved.push(id);
    /* The stylesheet addresses these as CLASSES (`.gm-gen`), the lookup gives an
     * id (`gm-gen`), and `ruleBody` matches the string it is handed — so passing
     * the id form found nothing and needsRule came out empty. The id's class is
     * the same token with a different sigil. */
    const cls = `.${id.slice(1)}`;
    const body = ruleBody(cssCode, cls);
    if (body !== null && FLEXY.test(body)) needsRule.push(cls);
  }
  check(resolved.length >= 5,
    `setRevealed() is reached by ${resolved.length} elements, all resolvable to a real id`,
    () => `only ${resolved.length} of ${hiddenByJs.length} resolved (${hiddenByJs.join(', ')}) — an unresolved key means the loop below would skip it silently`);

  /* THE VACUITY GUARD, and it is here because the section was green while
   * checking nothing. If this list is empty there is no flex/grid box among the
   * hidden elements, so every per-selector assertion below is skipped and the
   * whole section reports ok. */
  /* Two, measured: `.gm-gen` and `.gm-palette-empty`. The other three resolve to
   * elements with no author display — `<section>`, `<ul>` and `<span>` are
   * block/block/inline, where the UA sheet's `[hidden]` wins on its own, which is
   * why §3.M only bites the flex ones. The floor is 2 rather than 1 because the
   * guard's whole job is "the loop below runs at least twice"; it is not a count
   * of what SHOULD exist, so a third flex element appearing is picked up by the
   * per-selector checks rather than failing here. */
  check(needsRule.length >= 2,
    `and ${needsRule.length} of them are flex/grid boxes that NEED an explicit [hidden] rule (${needsRule.join(', ')})`,
    () => `empty list: ${resolved.join(', ')} — every per-selector check below is skipped and this section reports green having measured nothing`);

  for (const cls of needsRule) {
    check(new RegExp(`${cls.replace('.', '\\.')}\\[hidden\\]`).test(cssCode),
      `${cls} is a flex/grid box and carries its own [hidden] rule`,
      () => `an author display beats the UA sheet's [hidden], so element.hidden reads true while the box is still painted`);
  }

  /* The pairing itself. §3.M's guard is that `hidden` and the author display are
   * ONE decision in ONE place. `setRevealed()` is that place. */
  check(/function setRevealed\(node, on\)\s*\{[\s\S]*?node\.hidden = !on;[\s\S]*?node\.style\.display = on \? '' : 'none';/.test(jsCode),
    'setRevealed() moves the attribute AND the display together',
    () => 'the two properties must move in one function — §3.M is the case where only one moved');

  // Nothing outside the helper may write either property of the pair.
  const outside = jsCode.replace(/function setRevealed[\s\S]*?\n {2}\}/, '');
  const directDisplay = (outside.match(/\.style\.display\s*=/g) || []).length;
  check(directDisplay === 0, 'and no other code writes .style.display',
    () => `${directDisplay} writes outside setRevealed() — a half-writer sets one property of the pair`);

  /* `.hidden` written DIRECTLY is fine, and in two places it is the only correct
   * thing: `els.again` and `els.giveup` are `.gm-btn`, which is
   * `display: inline-flex`, so they need the attribute AND the rule — and the
   * attribute alone is what setRevealed would give. So the assertion is not "no
   * direct writes" but "every element hidden directly is a flex box with its own
   * [hidden] rule". */
  const direct = [...new Set([...outside.matchAll(/(\w+)\.hidden\s*=/g)].map((m) => m[1]))];
  for (const key of direct) {
    const cls = new RegExp(`class="[^"]*\\bgm-${key}\\b`).test(jsCode) || new RegExp(`gm-${key}`).test(html);
    check(!cls || new RegExp(`\\.gm-btn\\[hidden\\]`).test(cssCode),
      `${key} is hidden by attribute and .gm-btn carries the [hidden] rule that inline-flex needs`,
      () => `${key} is written .hidden = directly; if its author display is a flex box it also needs [hidden] { display: none }`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n`--page-accent` is declared for the body, and differently per theme');
// ---------------------------------------------------------------------------
{
  /* It is a HEADER-scoped token — shared.css defines it on six `.header-*` modifiers
   * and nowhere else — and this file used it 13 times in the body, which is a
   * sibling of the header rather than a descendant. Every one resolved nothing.
   * The symptom was the hint button at `color: rgb(255,255,255)` on a white card. */
  const accent = /\.gm-page\s*\{\s*--page-accent:\s*(#[0-9a-f]{3,8})/.exec(css);
  const light = /\[data-theme="light"\]\s*\.gm-page\s*\{\s*--page-accent:\s*(#[0-9a-f]{3,8})/.exec(css);
  check(!!accent && !!light,
    'it is declared on `.gm-page` AND on `[data-theme="light"] .gm-page`',
    () => 'one of the two themes has no value, and an undefined custom property silently falls back to the inherited one');

  /* And they must DIFFER. This is the measurement, not a style preference: the
   * `--rule-*` tokens are declared once in `:root`, so they are identical in both
   * themes, and no single colour clears 4.5:1 against both a white card and a
   * #161e38 one — white needs relative luminance <= 0.183, the dark card needs
   * >= 0.127, and no cyan in the palette lands in that band. Measured 1.92:1 for
   * `--rule-cyan` on white, which is the attempt this replaced.
   *
   * So a single-value accent is the DEFECT. Asserting only that a value exists
   * would pass the one-colour version that measured 1.92:1 — §3.B2's shape again:
   * the guard would be satisfiable by exactly the thing it was written to stop. */
  /* The `<datalist>` this block was written for is gone — see the search section
   * below. The per-theme `--page-accent` split stays, because that one is about the
   * PAGE. */

  check(!!accent && !!light && accent[1].toLowerCase() !== light[1].toLowerCase(),
    'and the two are different colours, because no single one passes both themes',
    () => `both are ${accent && accent[1]} — that measured ${accent === light ? '1.92:1 on white' : 'a fail'} in light theme`);
}

// ---------------------------------------------------------------------------
console.log('\nthe hint button: free on the first press, cooldown after');
// ---------------------------------------------------------------------------
{
  /* The stated need: a reader who knows nothing yet must be able to press it.
   * `state.guesses.length === 0` WAS in the disabled condition and was added during
   * the port — the reference disables on `!targetPokemon || revealedHints.length >= 3
   * || hintCooldown > 0` only. So the assertion is an absence, because an absence is
   * what the port violated and a presence check would not say which one. */
  const render = /function renderHints[\s\S]*?\n}/.exec(jsCode);
  check(!!render, 'renderHints() is the hint row\'s only writer');
  const r = render ? render[0] : '';
  check(!/guesses\.length === 0/.test(r),
    'and it never mentions the guess count, so zero guesses cannot disable the button',
    () => 'the button is gated on having guessed, which inverts what a hint is for');
  check(/els\.hintBtn\.disabled = state\.status !== 'playing' \|\| cooling/.test(r),
    'the only reasons it can be disabled are "not playing" and "cooling"',
    () => 'a reason crept back in that is not about the round being over');

  /* FREE FIRST, THEN A COOLDOWN — the asymmetry, asserted as an if/else on the
   * condition rather than as the mere presence of `wasFirst`. A presence check
   * would pass a `if (wasFirst)` that cooled on the first hint, which is the
   * opposite of what the comment claims. */
  const reveal = /function revealHint[\s\S]*?\n}/.exec(jsCode);
  check(!!reveal, 'revealHint() exists');
  const rv = reveal ? reveal[0] : '';
  check(/const wasFirst = state\.hintsShown\.length === 0/.test(rv),
    'it records whether this is the first hint, BEFORE pushing');
  check(/if \(!wasFirst\)\s*\{[\s\S]*?HINT_COOLDOWN_S/.test(rv),
    'and starts the cooldown only when it was NOT the first — the free one is the exception',
    () => 'the first hint is being cooled too, which is the half that was requested');
  check(!/state\.cooldown = HINT_COOLDOWN_S[\s\S]{0,400}HINT_COOLDOWN_S[\s\S]{0,400}HINT_COOLDOWN_S/.test(rv),
    'and there is exactly one cooldown arm, not one per branch',
    () => 'more than one place assigns the cooldown, so they can disagree');

  /* §3.I: a render that rewrites its own markup detaches a node it still holds.
   * This one did — `els.hintBtn.innerHTML = ...` destroyed the cooldown bar living
   * inside the button, so every `hidden` and `scaleX` after the first render went to
   * a detached node and the bar never appeared. Nothing threw and nothing logged. */
  check(!/hintBtn\.innerHTML/.test(jsCode),
    'renderHints() writes the hint LABEL\'s textContent, never the button\'s innerHTML',
    () => 'rewriting the button markup detaches the cooldown bar it also holds a reference to');
  check(/els\.hintLabel\.textContent =/.test(r), 'and it holds the label as its own reference');
  check(/els\.hintBar = document\.getElementById\('gm-hint-bar'\)/.test(jsCode),
    'the bar is a permanent node, found once');

  /* The terminal state has to be honest on its own, not only because the row is
   * hidden. `hidden` is the row\'s business; `disabled` is the button\'s. Leaving the
   * button enabled and still reading 再看一則提示 (show another hint) after the third hint is a lie that
   * is invisible today and true the day anything unhides the row. */
  check(/els\.hintBtn\.disabled = true;[\s\S]{0,160}els\.hintBar\.hidden = true/.test(r),
    'after the third hint the button is disabled AND the bar is hidden, not merely un-shown',
    () => 'the button\'s own state is only correct while the row happens to be hidden');

  /* §3.M: an author `display` beats the UA `[hidden]` rule, so `.gm-hint-row` needs
   * its own. Measured: the row is `display: flex` from a class, so `[hidden]` alone
   * leaves a 0-height-but-not-none box and the card keeps its padding. */
  check(/\.gm-hint-row\[hidden\]\s*\{\s*display:\s*none/.test(css),
    'and `.gm-hint-row[hidden] { display: none }` exists — the row is `display:flex` from its class',
    () => 'the row survives the third hint as an invisible box that still holds the card padding');
  check(/\.gm-hint-bar\[hidden\]\s*\{\s*display:\s*none/.test(css), 'and the same for the bar');

  /* The button must not also carry `.gm-btn`. Both are one class, so the winner is
   * decided by source order, and `.gm-btn` sets a filled `background` at
   * `min-height: 40px` — a filled 40px pill where the reference has a small outlined
   * button. Two rules claiming the same properties is the bug, not the fix. */
  check(/class="gm-btn-hint"/.test(html) && !/gm-btn gm-btn-hint/.test(html),
    'the button carries only `gm-btn-hint`, so nothing competes for its background',
    () => '`.gm-btn` and `.gm-btn-hint` are both one class and both set a background');
  check(/\.gm-btn-hint:focus-visible/.test(css),
    'and it brought its own focus ring rather than inheriting `.gm-btn`\'s');
}

// ---------------------------------------------------------------------------
console.log('\nthe bar prints nothing until the round is over — and the numbers moved');
// ---------------------------------------------------------------------------
{
  /* TWO QUESTIONS, and the page had them as one flag.
   *
   *   `revealed` — how MANY swatches (3, then all 6 after hint 2)
   *   `showText`  — whether each swatch PRINTS its hex and share
   *
   * A shared condition renders plausibly: hint 2 arrives DURING play, so the
   * numbers would light up on the second hint and stay on for the rest of the round.
   * Same shape as `hintRevealsPalette` keeping its old index — a stale `2` and a
   * stale `1` both produce something that looks fine. */
  const rp = /function renderPalette[\s\S]*?\n}/.exec(jsCode);
  check(!!rp, 'renderPalette() exists');
  const body = rp ? rp[0] : '';
  check(/const revealed = paletteRevealed\(\) \|\| state\.status !== 'playing'/.test(body),
    '`revealed` still mixes "hint 2 shown" with "round over" — it is about COUNT');
  check(/const showText = state\.status !== 'playing'/.test(body),
    '`showText` is the round state ALONE, with no hint term in it',
    () => 'hint 2 would print the numbers mid-round');
  check(/\bconst showText = [^\n]*paletteRevealed/.test(body) === false,
    'and the two are separate consts, not one flag read twice');

  const detail = /const detail = showText[\s\S]*?: '';/.exec(body);
  check(!!detail && /gm-swatch-hex/.test(detail[0]) && /gm-swatch-share/.test(detail[0]),
    'the two labels are emitted only under `showText`');
  check(/is-detailed/.test(body) && /classList\.toggle\('is-detailed', showText\)/.test(body),
    'and the bar carries the same flag as a class, from the same expression');

  /* THE FLEX LAYOUT THAT POSITIONS THE LABELS IS SCOPED TO THAT CLASS TOO.
   * It was on `.gm-swatch` unconditionally, so every swatch kept 8px of bottom
   * padding and a bottom-aligned flex box for text it no longer had. Invisible on a
   * 132px bar — which is why the rule could be wrong without anything looking it. */
  check(/\.gm-palette\.is-detailed \.gm-swatch/.test(css),
    'and the swatch flex/padding rules hang off `.gm-palette.is-detailed .gm-swatch`',
    () => 'the label layout is still unconditional, describing a layout that does not exist during play');
  const swatchRule = /\.gm-swatch\s*\{([^}]*)\}/.exec(css);
  check(!!swatchRule && !/align-items|justify-content|padding-bottom/.test(swatchRule[1]),
    'and `.gm-swatch` itself keeps none of the label layout',
    () => 'align-items / justify-content / padding-bottom are still on the base rule');

  /* THE aria-label CARRIES THE SHARES, and this is the one that is not a style
   * preference. A swatch width is invisible to a screen reader, so removing the
   * printed numbers WITHOUT moving them into the label deletes the information for
   * every non-visual reader — trading a sighted reader's redundancy for a blind
   * reader's loss. §3.C: colour must never be the only channel. */
  check(/box\.setAttribute\('aria-label'[\s\S]{0,220}?rows\.map\(\(r\) => `\$\{formatHex\(r\.hex\)\} \$\{formatShare\(r\.share\)\}`\)/.test(body),
    'the aria-label lists every hex with its share',
    () => 'the shares exist only as printed text, which a screen reader cannot see');
  check(/title="\$\{formatHex\(row\.hex\)\} · \$\{formatShare\(row\.share\)\}"/.test(body),
    'and the hover tooltip survives both states — it appears on hover, so it is not "printed on the bar"');

  /* The labels have to FIT their own swatch, and a swatch's width is a function of
   * its share — a question about the swatch's own inline size and nothing else.
   * Measured: a 3.1% block is 52px and `#acc5ff` at 11px tabular is about 55px, so
   * the hex printed outside its own block and was clipped by the card. A media query
   * cannot ask this (all six widths are on one screen) and neither can the page
   * (they change with the target), so it is a container query. */
  check(/\.gm-palette\.is-detailed \.gm-swatch\s*\{[^}]*container-type:\s*inline-size/.test(css),
    'each swatch is its own size container, which is what can ask how wide it got');
  check(/@container \(max-width: 64px\)\s*\{\s*\.gm-swatch-hex\s*\{\s*display:\s*none/.test(css),
    'and the hex is dropped below 64px, while the percentage — which fits — stays');
  check(/@container \(max-width: 34px\)\s*\{\s*\.gm-swatch-share\s*\{\s*display:\s*none/.test(css),
    'and below 34px even the percentage goes');
  check(/is-detailed \.gm-swatch\s*\{[^}]*container-type/.test(css),
    'the container is declared under `is-detailed` too — containment on a play-state bar would be layout containment for nothing');
}

// ---------------------------------------------------------------------------
console.log('\nthe bar is the card\'s header, and the at-rest card is three things');
// ---------------------------------------------------------------------------
{
  /* Palette flush to the card's top edge, as the reference has it. `padding: 0` plus
   * `overflow: hidden` with the CARD's radius doing the clipping.
   *
   * `ruleBody()` is BRACE-SCOPED to the rule it names — it already existed in this
   * file for §3.P's vacuous mutations, and a SECOND copy was written before that
   * was noticed, which is the same mistake in a new place. The version this
   * replaced was
   * `/\.gm-target\s*\{[\s\S]*?padding:\s*0/`: lazy, so it finds the FIRST
   * `padding: 0` after the selector, which is `.gm-slots`'s, 360 lines further down.
   * Restoring `padding: 16px` on `.gm-target` would have left it green. A shape
   * assertion that can be satisfied by a different rule is not a shape assertion. */
  const target = ruleBody(cssCode, '.gm-target');
  check(target !== null && !/padding/.test(target),
    '`.gm-target` declares no padding at all, so the bar can reach the edge',
    () => 'the bar is inset inside the card, so it reads as a sample rather than as the card\'s header');
  check(/overflow:\s*hidden/.test(target || ''),
    'and clips, which is what stops a swatch painting outside the rounded top');
  check(/\.gm-card-body\s*\{/.test(css) && /class="gm-card-body"/.test(html),
    'the padding moved into a `.gm-card-body` wrapper that the markup actually has');
  const bodyRule = ruleBody(cssCode, '.gm-card-body');
  check(!!bodyRule && /padding/.test(bodyRule),
    'and that wrapper is what carries it');
  const pal = ruleBody(cssCode, '.gm-palette');
  check(!!pal && !/border-radius/.test(pal),
    'and the bar dropped its own radius — keeping it would leave an 8px sliver of card between bar and edge',
    () => 'the bar still has a radius, so the flush layout leaves a gap at the top');

  /* The reserved-but-empty hint row: 34px plus a 12px gap, for nothing, while the
   * hint BUTTON is mounted either way. */
  check(!/\.gm-hints\s*\{[^}]*min-height/.test(css),
    '`.gm-hints` keeps no `min-height`, so the at-rest card is bar + button + controls',
    () => 'a 34px row plus a gap is reserved for hints that have not been taken');
  check(/\.gm-hints\[hidden\]\s*\{\s*display:\s*none/.test(css),
    'and needs the explicit display reset — the rule is `display: flex` from an author sheet (§3.M)');
  check(/setRevealed\(els\.hints, spent > 0\)/.test(jsCode),
    'and the attribute is written through setRevealed, with the condition the right way round',
    () => '`setRevealed(node, !spent)` sets hidden = spent, so the row shows when EMPTY');

  /* The control row's own visibility, decided LAST. */
  check(/function renderFoot[\s\S]*?setRevealed\(els\.targetFoot/.test(jsCode),
    'renderFoot() hides the row when neither of its two children shows');
  const ra = /function renderAll[\s\S]*?\n}/.exec(jsCode);
  check(!!ra && /renderFoot\(\);[\s\S]*$/.test(ra[0]) && /renderFoot\(\);/.test(ra[0].slice(-40)),
    'and renderAll() calls it LAST, because both of its inputs are written above',
    () => 'renderFoot() reads giveup.hidden / shinyBadge.hidden before their writers have run on some path');
  check(!/\.gm-attempts/.test(css) && !/els\.attempts/.test(jsCode) && !/id="gm-attempts"/.test(html),
    'and 「剩下 N 次機會」 is gone from all three files it was in',
    () => 'a leftover element or reference: the element would be null and its first write would throw');
  /* 下一題 LIVES IN THE CARD'S CONTROL ROW, beside 放棄.
   *
   * It used to be in the result panel, labelled 「再玩一次」 (play again), and it was already the
   * unlimited-only next round — so functionally nothing was missing, only its name and
   * its seat. The reference puts Get New Pokémon beside Give Up in the card
   * (`pokemonpalette/src/app/game/page.tsx:2494`), and after answering the reader's eye
   * is still near the palette bar: the result panel runs sprite + answer + stats +
   * the share block + a copy button, so 「下一題」 (next question) at its foot is a scroll away. */
  const footBlock = /<div class="gm-target-foot">([\s\S]*?)<\/div>/.exec(htmlCode);
  check(!!footBlock && /id="gm-again"/.test(footBlock[1]),
    'the control row carries #gm-again',
    () => '下一題 is not in the card, so answering scrolls away from the button that continues');
  check(!!footBlock && /id="gm-giveup"/.test(footBlock[1])
    && footBlock[1].indexOf('id="gm-giveup"') < footBlock[1].indexOf('id="gm-again"'),
    'after 放棄, which puts the two controls on one row in the reference order');
  check(!/id="gm-again"[\s\S]{0,400}?id="gm-again"/.test(htmlCode)
    && (htmlCode.match(/id="gm-again"/g) || []).length === 1,
    'and it appears EXACTLY ONCE in the markup — a second copy would be two buttons doing the same thing',
    () => 'two 下一題 buttons exist, and only one of them is wired');
  check(/>下一題</.test(htmlCode), 'and it reads 下一題, not 再玩一次',
    () => 'in unlimited each round is a fresh draw, so 「再玩一次」 describes the wrong thing');
  check(!/再玩一次/.test(htmlCode), 'with no leftover 「再玩一次」 label anywhere on the page');

  /* UNLIMITED ONLY, AND NOT GATED ON THE ROUND. The reference's Get New Pokémon is
   * visible in unlimited mode while still playing — it is a way out, not a reward. */
  /* ANCHORED TO THE END OF THE STATEMENT. The first version was
   * `/els\.again\.hidden = state\.mode !== 'unlimited'/`, and
   * `state.mode !== 'unlimited' || state.status !== 'playing'` CONTAINS that string —
   * so adding exactly the term the check forbids left it green. A substring match on
   * an expression is satisfiable by a longer expression. */
  check(/els\.again\.hidden = state\.mode !== 'unlimited';/.test(jsCode),
    'its visibility is the MODE alone — the statement ends there, with no round-state term',
    () => 'it is gated on the round ending, so a reader cannot abandon a puzzle in unlimited the way the reference allows');
  check((jsCode.match(/els\.again\.hidden/g) || []).length === 1,
    'written by exactly ONE place, because it had two writers when it lived in renderResult()',
    () => 'two writers compute the same expression today; the day one grows a condition they will disagree about where the button is');

  /* The control row hides only when EVERY child is hidden, and it now has three. */
  check(/function renderFoot[\s\S]{0,400}?els\.targetFoot\.children/.test(jsCode),
    'renderFoot() counts the row\'s children rather than naming two of them',
    () => 'a row that asks about two of three children goes blank in the state where only the third shows — unlimited, shiny, round over');
  check(!/!els\.giveup\.hidden \|\| !els\.shinyBadge\.hidden/.test(jsCode),
    'and no longer names 放棄 and 異色 explicitly',
    () => 'the hardcoded two-term list is back, and 下一題 is not in it');
  check(/\.gm-target-foot > :last-child\s*\{\s*margin-left:\s*auto/.test(cssCode),
    'the row pins its LAST child right, not `space-between` — with three children that would strand 異色 in the middle',
    () => 'space-between with three children puts the badge in the centre');

  /* THE STRIP IS HORIZONTAL, FIVE EQUAL SEGMENTS, AND 140x56.
   *
   * It was a 56px vertical stack of THREE, which is what the reference's GuessCard does
   * (`guess-card.tsx:101`, `flex flex-col w-16` over `PALETTE_COLORS_COUNT`). That was a
   * faithful port; at this page's full-width row it reads as a chip rather than as the
   * species' palette, and it showed 3 of 6 colours.
   *
   * 140px is the project's EXISTING five-segment width, not invented here: `outfit.html`'s
   * `.of-winner-strip` is the same strip at the same width, and `outfit.css:661-671`
   * records 「At 140px the five segments are 28px each, so the strip is a legible colour
   * readout」. This page measures the same result independently — 28 / 28 / 28 / 28 / 27px,
   * the last being 27 because the first four carry a separator border.
   *
   * The citation that is EASY to reach for and is wrong is `.cp-strip`: a different
   * class on a different page, whose `.cp-idcard` instance is
   * `flex: 1 1 240px; min-width: 180px; height: 40px`. What `.cp-seg` does contribute is
   * the mechanism (`flex: 1 1 0` plus `border-width: 0 1px 0 0`, `colors.css:764-775`). */
  const strip = /\.gm-slot-strip\s*\{([^}]*)\}/.exec(cssCode);
  const seg = /\.gm-slot-strip span\s*\{([^}]*)\}/.exec(cssCode);
  check(!!strip && !/flex-direction:\s*column/.test(strip[1]),
    'the strip no longer stacks vertically',
    () => 'it is still a column; the row is full-width so 56px across reads as a chip');
  check(!!strip && /width:\s*140px/.test(strip[1]) && /height:\s*56px/.test(strip[1]),
    'and it is 140x56 — outfit.html\'s five-segment width, measured here again at 28px per segment',
    () => `width/height are not 140/56 (found ${strip ? strip[1].replace(/\s+/g,' ').trim() : 'no rule'})`);
  check(!!strip && /align-items:\s*stretch/.test(strip[1]),
    'with `align-items: stretch`, the way `.cp-strip` runs its segments');
  /* `flex: 1 1 0` is load-bearing and the failure is already measured in colors.css:764:
   * these spans have no intrinsic width, so `flex-basis: auto` resolves to 0 and with
   * the default `flex-grow: 0` every segment collapses to its 1px right border —
   * 「5 segments across a 180px strip came out 1px each」. */
  check(!!seg && /flex:\s*1 1 0\b/.test(seg[1]),
    'and each segment is `flex: 1 1 0` — basis 0 plus grow 1 is what shares the space evenly',
    () => 'the segments collapse; `min-width: 0` alone leaves them at their border');
  check(!!seg && /border-right:\s*1px/.test(seg[1]),
    'plus a 1px separator, as `.cp-seg` has it, so two similar colours do not read as one block',
    () => 'adjacent similar colours blur into one');
  /* The narrow-viewport rule used to lump the strip into the sprite\'s 44px square. */
  check(!/\.gm-slot-sprite, \.gm-slot-placeholder, \.gm-slot-strip/.test(cssCode),
    'and the \u2264640px rule no longer lumps it into the sprite\'s 44px square',
    () => 'five segments across 44px is 8.8px each, which is not a colour');
  check(/\.gm-slot-strip\s*\{[^}]*width:\s*100px[^}]*height:\s*40px/.test(
      (/@media \(max-width: 640px\)\s*\{[\s\S]*?\n\}/.exec(cssCode) || [''])[0]),
    'it gets its own 100x40 below 640px instead — five legible 20px bands');

  /* THE REVEAL USES THE 475x475 OFFICIAL ARTWORK, and NO `pixelated`.
   *
   * `image-rendering: pixelated` is correct for a 96px sprite UPSCALED — nearest
   * neighbour keeps the pixel grid. This is 475px artwork at 200px, a DOWNSCALE, where
   * nearest neighbour throws away the averaging that makes a reduction look clean. The
   * project has already written that conclusion down for the same swap at
   * `outfit.css:655`, where removing it fixed a visible artefact. */
  check(/artworkUrl\(t\.id, state\.target\.variant === 's'\)/.test(jsCode),
    'the result panel loads artworkUrl(), not spriteUrl()',
    () => 'the reveal is still the 96x96 sprite at 200px');
  check(!/els\.resultSprite\.src = spriteUrl/.test(jsCode),
    'and `artworkUrl()` is no longer an export nothing calls');
  const rs = /\.gm-result-sprite\s*\{([^}]*)\}/.exec(cssCode);
  check(!!rs && !/image-rendering/.test(rs[1]),
    'the result sprite carries NO `image-rendering` at all',
    () => 'pixelated on a downscale of 475px artwork aliases the edges');
  check(!!rs && /width:\s*200px/.test(rs[1]) && /height:\s*200px/.test(rs[1]),
    'and it is 200x200, matching the markup\'s width/height attributes',
    () => 'the CSS and the <img> attributes disagree, so the box is 200 and the reserved space is not');
  check(/id="gm-result-sprite" alt="" width="200" height="200"/.test(htmlCode),
    'which the markup agrees with — an <img> whose attributes disagree with its CSS reserves the wrong box before it loads');

  /* ORDER in the markup, not a CSS selector: the point is which child the row's
   * `space-between` puts on the left, and that is decided by source order alone. */
  check(/class="gm-btn gm-btn-ghost" id="gm-giveup"/.test(html)
    && html.indexOf('id="gm-giveup"') < html.indexOf('id="gm-shiny-badge"'),
    'and 放棄 comes BEFORE 異色 in the control row, so space-between puts it on the left',
    () => 'the two children swapped, which flips which side each one lands on');
}

// ---------------------------------------------------------------------------
console.log('\nthe rotating tip: six claims, and the sentence a screen reader hears');
// ---------------------------------------------------------------------------
{
  check(/from '.\/game-tips\.js'/.test(jsCode), 'the tips live in a module of their own');
  check(/TIPS,\s*tipAt, typeDelay, randomTipIndex,/.test(jsCode), 'and the page imports the tip API');

  /* THE ACCESSIBILITY SPLIT. The visible text is written one character at a time, so
   * a live region watching it would read every keystroke. The full sentence goes to a
   * `.sr-only` region updated once per tip. Both regions are in the MARKUP, so the
   * split is visible without running the page. */
  check(/class="gm-tip-visible" aria-hidden="true"/.test(html),
    'the typing region is `aria-hidden` in the markup');
  check(/class="sr-only" id="gm-tip-live" aria-live="polite"/.test(html),
    'and a `.sr-only` `aria-live` region carries the whole sentence');
  check(/els\.tipLive\.textContent = `提示：\$\{tipAt\(tipIndex\)\}`/.test(jsCode),
    'and the live region is written ONLY in advanceTip(), once per tip — never per character',
    () => 'a screen reader would announce every keystroke');
  check((jsCode.match(/tipLive\.textContent/g) || []).length === 2,
    'exactly twice: once to seed the first tip, once to advance',
    () => `found ${(jsCode.match(/tipLive\.textContent/g) || []).length} writes`);

  check(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(jsCode),
    'reduced motion is read in JS, because a CSS rule cannot reach a timer');
  check(/addEventListener\('change'/.test(jsCode) && /tipReduced = e\.matches/.test(jsCode),
    'and re-read on change, so toggling the OS setting takes effect without a reload');
  check(/if \(tipReduced\)[\s\S]{0,300}?els\.tipText\.textContent = tipAt\(tipIndex\)/.test(jsCode),
    'and that branch sets the WHOLE sentence, with no typing and no erasing');
  check(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?gm-tip-caret\s*\{\s*animation:\s*none;\s*opacity:\s*1/.test(css),
    'while the caret stops blinking AND stays visible — a caret that disappears reads as a rendering failure');
  check(/document\.addEventListener\('visibilitychange'/.test(jsCode) && /else stopTip\(\)/.test(jsCode),
    'and the loop stops while the tab is hidden, so a reader returns to a whole sentence');

  /* The MODULE is imported above and run, not grepped. Every assertion above about the
   * tip API was a string in color-game.js — true whether or not the function it names
   * works — so this file was never an input of this checker and `--prove-inputs`
   * passed without it. That is the §4 warning in its purest form: the run is green
   * having verified nothing about the module, and it looks like coverage. */
  check(TIPS.length >= 6, `TIPS has ${TIPS.length} entries`, () => 'fewer than six, so the rotation is over before it is worth having');
  check(TIPS.every((t) => typeof t === 'string' && t.trim().length > 0),
    'every tip is a non-empty string',
    () => 'an empty entry would render as a blank line with a blinking caret and nothing to read');
  check(new Set(TIPS).size === TIPS.length, 'and no two are identical',
    () => 'a duplicate means the rotation appears to stall while showing the same line twice');
  check(TIPS.every((t) => t.length <= 40),
    'each is short enough to type inside the capped budget',
    () => `longest is ${Math.max(...TIPS.map((t) => t.length))} characters`);

  /* The cap is the reason `typeDelay` exists, so it is asserted as an OUTCOME: the
   * worst-case product of delay and length, not the presence of the arithmetic. */
  for (const len of [8, 40, 120]) {
    const worst = typeDelay(len, () => 1) * len;
    check(worst <= TIP_TYPE_TOTAL_CAP_MS * 1.15,
      `a ${len}-character tip finishes typing within the ${TIP_TYPE_TOTAL_CAP_MS}ms budget`,
      () => `worst-case jitter gives ${Math.round(worst)}ms — a long CJK tip would hold the rotation for seconds`);
  }
  check(typeDelay(40, () => 0) < typeDelay(40, () => 1),
    'a SHORT tip still gets its organic jitter — more jitter means a longer wait',
    () => 'the jitter is not being applied at all');
  /* The jitter's budget is whatever the cap leaves after the base, so a tip long
   * enough that the base already fills the budget gets an EVEN pace rather than one
   * that overruns it. Asserted both ways because either half alone is satisfiable by
   * simply deleting the jitter. */
  check(typeDelay(200, () => 0) === typeDelay(200, () => 1),
    'and a LONG one types evenly instead, because its base has eaten the whole budget');

  check(tipAt(-1) === TIPS[TIPS.length - 1] && tipAt(TIPS.length) === TIPS[0],
    'tipAt() wraps in both directions, so the rotation cannot index out of range',
    () => 'a negative or over-long index returns undefined and the line goes blank');
  check(randomTipIndex(() => 0.999999) === TIPS.length - 1
    && randomTipIndex(() => 0) === 0,
    'randomTipIndex() stays inside the array at both ends of the random range',
    () => 'Math.floor(random() * length) with random() close to 1 must not reach length');

  /* Math.random must not be in the PAGE module: the seeded-daily-draw assertion
   * above is a shape and cannot tell a cosmetic random from a draw. */
  check(!/Math\.random/.test(jsCode),
    'and color-game.js still contains no Math.random — the random start index is randomTipIndex() in the module',
    () => 'the seeded-draw shape assertion now has to widen its exemption, which is worse than moving one call');
}

// ---------------------------------------------------------------------------
console.log('\nclicking a row fills the field; Enter spends the attempt');
// ---------------------------------------------------------------------------
{
  /* The dropdown is capped at 40 rows on a phone-sized target, and a daily round has
   * four attempts, so a click is the lowest-intent way to choose a species. The
   * reference submits on click (`handleSelect` -> `onPokemonSelect` -> `handleGuess`)
   * because it has accounts, a history and a shareable result to absorb a mis-click;
   * this page has none of those. */
  const choose = /function chooseFromSearch[\s\S]*?\n}/.exec(jsCode);
  const pick = /function pickFromSearch[\s\S]*?\n}/.exec(jsCode);
  const submitPending = /function submitPendingPick[\s\S]*?\n}/.exec(jsCode);
  check(!!choose && !!pick && !!submitPending,
    'the click path, the submit path and the arm/disarm path are three named functions');

  /* BOTH names are forbidden here, and the first version of this check forbade only
   * `submitGuess` — which was VACUOUS. `chooseFromSearch()` does not submit
   * directly; calling `pickFromSearch()`, which does, slips past a check for the
   * inner name entirely. A mutation that made the click path call `pickFromSearch`
   * — restoring exactly the behaviour this change removed — passed, because the
   * click path's real submit is one call away and the assertion never looked.
   *
   * Two functions submit; a click must reach neither. */
  check(choose && !/\b(submitGuess|pickFromSearch|submitPendingPick)\b/.test(choose[0]),
    'and the CLICK path reaches none of the three submit functions — it fills the field',
    () => 'a click still spends an attempt, one call removed');
  check(pick && /submitGuess/.test(pick[0]),
    'while pickFromSearch() is the one that submits');
  check(/\b(submitGuess|pickFromSearch|submitPendingPick)\b/.test(choose[0]) === false,
    'and that is an absence over the whole function body, not a single line of it');
  check(choose && !/\.dispatchEvent\(new (InputEvent|Event)\('input'/.test(choose[0]),
    'and it dispatches no `input` event, which would clear the pick it just set',
    () => 'dispatching input re-runs the search, closes the list, and disarms the pending pick in one go');

  /* Enter's precedence, restated as what it is NOW. The previous version asserted
   * an ascending index over four names, and the rule it described — armed pick,
   * then arrow-key row, then whole name, then FIRST ROW — ended with a submit the
   * reader never asked for. An index comparison cannot notice that: the names were
   * still there and still ascending, so the assertion kept passing while the
   * behaviour it claimed to police was the defect. §3.B2's shape, pointed at the
   * assertion written to prevent it.
   *
   * What replaces it is the rule itself: an armed pick outranks everything, and the
   * list-open path must not reach a submit unless the list held ONE row. */
  const kd = /els\.search\.addEventListener\('keydown'[\s\S]*?\n {2}\}/.exec(jsCode);
  check(!!kd, 'the keydown handler exists');
  const kdBody = kd ? kd[0] : '';
  const armedAt = kdBody.indexOf('submitPendingPick()');
  check(armedAt >= 0, 'and Enter submits an armed pick');
  check(armedAt >= 0 && armedAt < kdBody.indexOf('listIsOpen()'),
    'and the armed pick is tested BEFORE the list is consulted',
    () => 'a click is the only route that names a species the reader chose by hand; it outranks any row');

  /* Typing after a click is the reader changing their mind. Without this, click row
   * 2 -> type one more character -> Enter would submit row 2, which is no longer
   * what the field says. */
  const inp = /els\.search\.addEventListener\('input'[\s\S]*?\}\);/.exec(jsCode);
  check(!!inp && /pendingPick = null/.test(inp[0]),
    'the input listener disarms the pending pick');
  check(/function newGame[\s\S]*?pendingPick = null/.test(jsCode),
    'and a new round disarms it too — an armed pick names a round that no longer exists',
    () => 'Enter after a reset would submit a species from the previous round');
}

// ---------------------------------------------------------------------------
console.log('\neasy mode narrows the SUGGESTIONS, and only the suggestions');
// ---------------------------------------------------------------------------
{
  check(/function suggestionPool/.test(jsCode) && /state\.difficulty !== 'easy'/.test(jsCode),
    'suggestionPool() is null unless the difficulty is easy');
  check(/genIds\.get\(state\.gen\)/.test(jsCode), 'and it reads the selected generation from genIds');
  check(/function searchMatches[\s\S]{0,400}?pool && !pool\.has/.test(jsCode),
    'searchMatches() skips anything outside it');
  /* `suggestionPool()` now has exactly ONE consumer, so there is nothing left to
   * drift out of step with it — which the checker says out loud, because the two
   * used to be the thing that was easy to get wrong. */
  check((jsCode.match(/suggestionPool\(\)/g) || []).length === 3,
    'and suggestionPool() has one consumer: the substring scan that opens this list',
    () => `called ${(jsCode.match(/suggestionPool\(\)/g) || []).length} times — a second caller is a second filter to forget`);

  /* A PHONE HAS NO ENTER KEY, and the two-step flow was unreachable by touch
   * because of it: tap a suggestion row, the name lands in the field, the list closes,
   * and the status line says 「按 Enter 作答」 (press Enter to answer) to a reader with nothing to press. iOS
   * fires `Enter` from its search key and it happens to work; much of Android has no
   * key at all. */
  check(/id="gm-submit"/.test(htmlCode) && /class="gm-btn gm-submit"/.test(htmlCode),
    'the 作答 button exists, in the same `.gm-btn` family as every other control here');
  check(/function canSubmit/.test(jsCode) && /function renderSubmit/.test(jsCode),
    'with a named `canSubmit()` and one writer, `renderSubmit()`');

  /* DISABLED rather than hidden when the round is over, so it cannot go from
   * actionable to inert without the reader seeing why — a button that vanishes on the
   * guess that won the game is a worse ending than one that greys out. */
  check(/els\.submit\.hidden = !canSubmit\(\)/.test(jsCode)
    && /els\.submit\.disabled = !canSubmit\(\)/.test(jsCode),
    'and it is both hidden and disabled by the SAME answer, so the two cannot disagree',
    () => '`hidden` and `disabled` are written from different conditions and one of them will be wrong');

  /* THE BUTTON SYNTHESISES THE KEY rather than calling the submit chain itself. Two
   * entry points that each re-implement "armed row, then whole name, then first row"
   * is how they come to disagree, and the disagreement is invisible: one of them
   * quietly accepts something the other refuses. */
  check(/els\.submit\.addEventListener\('click'[\s\S]{0,300}?dispatchEvent\(new KeyboardEvent\('keydown', \{ key: 'Enter'/.test(jsCode),
    'and it dispatches an `Enter` keydown at the field, so one implementation of the rule serves both routes',
    () => 'the button has its own submit path; it will drift from the key\'s');
  check(!/els\.submit\.addEventListener[\s\S]{0,300}?pickFromSearch/.test(jsCode),
    'and it does NOT call pickFromSearch() directly, which would skip the whole-name and first-row fallbacks');

  /* Every writer of the field or of the round state must refresh it. `renderAll()` is
   * the one that covers a finished round; `chooseFromSearch`, `pickFromSearch` and the
   * input listener are the ones that cover the field. Miss one and the button is stale
   * on exactly the path where it matters. */
  for (const [fn, label] of [['function renderAll', 'renderAll'], ['function chooseFromSearch', 'chooseFromSearch'],
    ['function pickFromSearch', 'pickFromSearch']]) {
    const body = new RegExp(fn + '[\\s\\S]*?\\n}').exec(jsCode);
    check(!!body && /renderSubmit\(\)/.test(body[0]),
      `${label}() refreshes the button`,
      () => `${label}() changes state the button depends on and never re-renders it`);
  }
  check(/els\.search\.addEventListener\('input'[\s\S]{0,600}?renderSubmit\(\)/.test(jsCode),
    'and so does the input listener, which is the path where the field changes most');
  check(/\.gm-search-row\s*\{[^}]*grid-template-columns:\s*1fr max-content/.test(cssCode),
    'the field and the button share a `1fr max-content` grid, so the field gives up exactly the button\'s width',
    () => 'a flex push would re-flow the wrap by a different amount on hover and on submit');
  check(/\.gm-submit\[hidden\]\s*\{\s*display:\s*none/.test(cssCode),
    'and `.gm-submit[hidden]` resets the display — §3.M, the button is `display` from an author rule');

  /* THE SUGGESTION SPRITE IS GREYSCALE, and that is the game rather than a look. A
   * full-colour sprite beside the palette the reader is trying to match IS the answer
   * sitting next to the question. The reference renders its results in full colour
   * (`pokemon-search.tsx`, no filter), so this is deliberately better than the port. */
  check(/\.gm-search-item img\s*\{[^}]*filter:\s*grayscale\(1\)/.test(cssCode),
    'the sprite in the suggestion list is `filter: grayscale(1)`',
    () => 'the sprite is in colour, which puts the answer beside the palette the reader is matching');
  /* Scoped to that one selector: a GUESSED species shows real colours in the slots,
   * and that is feedback rather than a hint. */
  check(!/\.gm-slot-sprite[^{}]*\{[^}]*grayscale/.test(cssCode),
    'and the greyscale is scoped to the dropdown — a guessed species keeps its colours',
    () => 'the filter leaked onto the guess slots, where the colour IS the feedback');

  /* It must NOT narrow the guess. A Gen-1 round can still be answered with a
   * Paldea species — a bad guess, but a legal one — and blocking it would leave a
   * reader who knows the answer unable to submit it. */
  const resolve = /function resolveExact[\s\S]*?\n}/.exec(jsCode);
  check(!!resolve && !/suggestionPool|state\.gen|state\.difficulty/.test(resolve[0]),
    'resolveExact() is NOT filtered, so a species outside the pool can still be submitted',
    () => 'the generation filter leaked into the guess path and a reader who knows the answer cannot submit it');

  /* `poolFor()` was imported and never called. `suggestionPool()` reads `genIds`
   * instead, because `poolFor()` rebuilds the whole generation map on every call and
   * this path runs per keystroke. */
  check(!/\bpoolFor\b/.test(jsCode),
    'and the dead `poolFor` import is gone rather than left as a second way to ask',
    () => '`poolFor` is imported but unused; if it is used, the search path rebuilds a 1,025-record map per keystroke');

  /* The empty-state message must be conditional on the filter being the REASON.
   * Shown unconditionally it blames the round for a typo. */
  const rr = /function renderSearchResults[\s\S]*?\n}/.exec(jsCode);
  check(!!rr && /if \(!matches\.length && suggestionPool\(\) && searchMatches\(q, \{ ignorePool: true \}\)\.length\)/.test(rr[0]),
    'the 「只從第 N 世代出題」 line requires BOTH an empty list AND a match outside the pool',
    () => 'it is printed whenever the list is empty, so a typo is reported as a narrow round');
  check(!!rr && /els\.searchStatus\.textContent = ''/.test(rr[0].split('const matches')[0]),
    'and the status line is cleared on every keystroke before anything re-sets it',
    () => 'the message outlives the query that produced it');
}

// ---------------------------------------------------------------------------
console.log('\nthe empty slots are placeholders, not dex #1 to #4');
// ---------------------------------------------------------------------------
{
  /* It was `padId(i + 1)`, so the four empty slots carried dex #1-#4. Sprites are
   * named UNPADDED here, so that was four broken images — and "fixing" it to
   * `spriteUrl(i + 1)` would show the real Bulbasaur..Charmander, which reads as
   * four guesses already made. The reference renders a muted skeleton block. */
  const rs = /function renderSlots[\s\S]*?els\.slots\.innerHTML/.exec(jsCode);
  check(!!rs, 'renderSlots() exists');
  /* Slice the EMPTY branch only — from `is-empty` to its own `continue`. Taking
   * everything after the string 'is-empty' also takes the FILLED branch, which
   * legitimately has a `<img class="gm-slot-sprite">` and would fail this assertion
   * forever. The two branches are separated by that `continue`, so it is the fence. */
  const emptyBranch = rs ? (rs[0].split('is-empty')[1] || '').split('continue;')[0] : '';
  check(!!emptyBranch, 'and the empty branch can be isolated from the filled one');
  check(!/<img/.test(emptyBranch),
    'it carries no <img> at all',
    () => 'the empty slot is drawing a sprite again');
  check(/gm-slot-placeholder/.test(emptyBranch), 'it renders .gm-slot-placeholder instead');
  check(!/\bpadId\b/.test(jsCode.replace(/\*[^\n]*\n(?:[^\n]*\n)*?\*\//g, '')) || !/function padId/.test(jsCode),
    'and padId() is gone — it existed only to build that broken path',
    () => 'padId() has no callers; an unused helper is a second thing to keep right');
  check(/\.gm-slot-placeholder/.test(css), 'the placeholder is styled');
  /* It must occupy the sprite's box, or every answered row shifts sideways. */
  const ph = /\.gm-slot-placeholder\s*\{([^}]*)\}/.exec(css);
  const sp = /\.gm-slot-sprite\s*\{([^}]*)\}/.exec(css);
  check(!!ph && !!sp && ph[1].includes('56px') && sp[1].includes('56px'),
    'at exactly the sprite\'s 56x56, so empty and filled rows line up',
    () => 'the placeholder and the sprite disagree on width, so answering shifts the row');
  check(/\.gm-slot-sprite, \.gm-slot-placeholder/.test(css),
    'and the narrow-viewport rule resizes both together');
}

// ---------------------------------------------------------------------------
console.log('\nthe guess box: two autocomplete layers, and the keyboard');
// ---------------------------------------------------------------------------
{
  /* The stated need: a reader who knows it is 妙蛙種子 (Bulbasaur) and cannot type it exactly.
   *
   * There was a SECOND layer for this — a `<datalist>` — and it is gone. Its popup is
   * BROWSER UI: it opened on a bare click with an empty field and rendered as one long
   * dark strip over the light theme, carrying all 151 Gen-1 names. `color-scheme` was
   * already correct on the input (measured light in light theme, dark in dark) and so
   * were `option { background; color }` (measured 17.71:1 / 14.57:1) — and the popup
   * was drawn from neither. Nothing here can screenshot browser chrome, so no CSS fix
   * could be verified, and the reliable one was to delete it. It also brought a ▼
   * affordance Chrome draws on the field itself.
   *
   * So these are ABSENCE assertions, which is the only form that keeps it gone: a
   * presence check is satisfied by a datalist that comes back. */
  check(!/\blist=/.test(htmlCode),
    'the input carries no `list` attribute, so the browser draws no popup',
    () => 'a `list=` attribute is back, and its popup is browser UI this project can neither theme nor verify');
  check(!/<datalist/.test(htmlCode), 'and the markup declares no datalist');
  check(!/\brenderDatalist\b/.test(jsCode), 'no code builds one either');
  check(!/\bels\.names\b/.test(jsCode) && !/gm-names/.test(jsCode),
    'and nothing reaches for a `gm-names` node — a leftover would be `null` and its first write would throw',
    () => 'something still references the removed datalist');

  /* THE RESULT PANEL HAS THE SAME SPLIT, and the two links must NOT both be the colour
   * page. The user drew this deliberately: the name answers 「這隻是誰，圖鑑怎麼說」(who is this, what does the Pokédex say) and
   * the button answers 「它的色盤完整長怎樣」 (what does its full palette look like). */
  const resultBody = /function renderResult\(\)[\s\S]*?\n}/.exec(jsCode);
  check(!!resultBody && /els\.resultAnswer\.innerHTML = `<a href="\$\{pokemonDetailUrl\(t\)\}"/.test(resultBody[0]),
    'the result panel\'s name links to the Pokédex entry',
    () => 'the name and the button below it point at the same page');
  check(!!resultBody && /els\.explore\.href = paletteUrl\(t\)/.test(resultBody[0]),
    'while 「看牠的完整色盤」 keeps paletteUrl()');
  check(!!resultBody
    && /pokemonDetailUrl\(t\)/.test(resultBody[0]) && /paletteUrl\(t\)/.test(resultBody[0]),
    'so the two links in that panel are provably different destinations');

  /* THE GUESS ROW HAS TWO LINKS AND THEY ANSWER TWO DIFFERENT QUESTIONS.
   *
   * The name goes to the Pokédex entry and the STRIP — the colour band itself — goes to
   * the colour page. They used to be the same destination twice, and once the name
   * moved there was no route to the colour page from a guess at all: the result panel
   * shows the TARGET, not every guess.
   *
   * `pokemonDetailUrl()` rather than a built string, because it carries the Nidoran
   * ♀/♂ split and the NFKD fix for Flabébé. §3.A forbids assembling either URL by hand
   * and a bare `nidoran` slug is strictly disallowed. Verified over the 1,025 records
   * this page can reach: 1,025 distinct slugs, no collisions, all resolvable. */
  /* Anchored on the FILLED branch. `/<li class="gm-slot[\s\S]*?<\/li>/` matches the
   * EMPTY one first — that branch also opens `<li class="gm-slot is-empty">` — so the
   * assertions below were reading the placeholder and finding no links in it. */
  const slotRow = /<li class="gm-slot \$\{g\.correct[\s\S]*?<\/li>/.exec(jsCode);
  check(!!slotRow && /gm-slot-name"><a href="\$\{pokemonDetailUrl\(p\)\}"/.test(slotRow[0]),
    'the guess row\'s name links to pokemonDetailUrl() — the Pokédex entry',
    () => 'a hand-built `detail.html?slug=` would lose the Nidoran ♀/♂ split and the Flabébé NFKD fix');
  check(!!slotRow && /<a class="gm-slot-strip" href="\$\{paletteUrl\(p\)\}"/.test(slotRow[0]),
    'and the strip itself links to paletteUrl() — the colour page',
    () => 'the row has no route to the colour page any more');
  check(!!slotRow && /<\/a>\s*<\/li>/.test(slotRow[0]),
    'and the strip is a SIBLING of that link, never a child of it',
    () => 'the strip <a> nests inside the name <a>, which is invalid and breaks both');
  /* aria-label, because a colour band has no text of its own and the segments inside are
   * decorative. `role="img"` was on it before it became a link — that overrides the link
   * role and would leave a screen reader announcing an image where there is a link. */
  check(!!slotRow && /aria-label="查看 \$\{escapeHtml\(p\.names\.zh\)\} 的完整色盤"/.test(slotRow[0]),
    'and it names its target in an aria-label, because the band has no text',
    () => 'the link announces only as a nameless control');
  check(!/class="gm-slot-strip" role="img"/.test(jsCode),
    'while `role="img"` is gone — it would mask the link role');

  /* A listbox owes the reader navigation. */
  const keydown = /els\.search\.addEventListener\('keydown'[\s\S]*?\n {2}\}/.exec(jsCode);
  check(!!keydown, 'the search field has a keydown handler');
  check(/ArrowDown/.test(keydown ? keydown[0] : '') && /ArrowUp/.test(keydown ? keydown[0] : ''),
    'and the listbox is navigable with ArrowDown / ArrowUp',
    () => 'a <ul role="listbox"> with no arrow handling leaves exactly one row reachable');
  check(/is-used/.test(keydown ? keydown[0] : '') && /scrollIntoView/.test(keydown ? keydown[0] : ''),
    'where arrow keys skip the already-guessed rows and scroll the chosen one into view');

  /* And a miss says so. A silent no-op is indistinguishable from a broken field. */
  check(/找不到/.test(keydown ? keydown[0] : '') && /只打部分名稱/.test(keydown ? keydown[0] : ''),
    'an unresolvable guess reports why and costs no attempt',
    () => 'the failure path went quiet, so a typo reads as a dead field');

  /* resolveExact is whole-string only, on purpose. */
  check(/function resolveExact[\s\S]*?exact\.length === 1/.test(jsCode),
    'resolveExact() returns a match only when it is unambiguous',
    () => 'a fuzzy fallback would submit a typo and spend one of four attempts');
  /* Grouped, and that is the fix: `!/A|B/.test(src)` parses as
   * `/A|B/.test(src)` — the alternation is INSIDE the literal, so the pattern is
   * "A or B anywhere in the file" rather than "A or B near resolveExact". The
   * first version matched the word `distance` in `renderSlots` a thousand lines
   * away and reported the field fuzzy when it is not. */
  check(!/(?:resolveExact[\s\S]{0,200}levenshtein|resolveExact[\s\S]{0,200}distance)/.test(jsCode),
    'and it is not fuzzy — no edit distance anywhere near it',
    () => 'resolveExact gained a similarity notion; a typo would then be submitted and cost one of four attempts');
}

// ---------------------------------------------------------------------------
console.log('\nthe IME\'s 選字 (candidate-selection) key is Enter too, and it is not the game\'s');
// ---------------------------------------------------------------------------
{
  const kdBody = blockBody(jsCode, "els.search.addEventListener('keydown', (e) =>");
  check(!!kdBody, 'the keydown handler body is readable');

  /* All three signals, because missing one is not a degraded result — it is a
   * spent attempt. `isComposing` is the standard flag and covers Chrome and
   * Firefox; `keyCode === 229` is what some Windows IMEs send instead; and Safari
   * reports `isComposing === false` on the very keydown that commits, which is why
   * `composing` is tracked from the composition events. */
  check(!!kdBody && /isComposing/.test(kdBody) && /keyCode === 229/.test(kdBody) && /\bcomposing\b/.test(kdBody),
    'the guard tests isComposing, keyCode === 229 and the composition flag',
    () => 'any one of the three missing re-opens the defect on the engine it covers');
  check(/compositionstart/.test(jsCode) && /compositionend/.test(jsCode),
    'and both composition events are wired, because Safari\'s isComposing lies on the commit keydown',
    () => 'the Safari path depends on a flag nothing ever sets');

  /* The guard must come BEFORE the preventDefault. A preventDefault on the IME's
   * own keydown stops some IMEs committing at all, so the reader loses the
   * CHARACTER — which is a worse failure than losing the guess, because it is
   * silent and looks like the field is broken. */
  const guardAt = kdBody ? kdBody.indexOf('isComposing') : -1;
  const pdAt = kdBody ? kdBody.indexOf('e.preventDefault()') : -1;
  check(guardAt >= 0 && pdAt >= 0 && guardAt < pdAt,
    'the IME guard runs BEFORE the Enter branch calls preventDefault',
    () => `guard at ${guardAt}, preventDefault at ${pdAt} — the IME keydown must return untouched`);

  /* And the guard itself must not preventDefault. Measured, not reasoned: on
   * Windows/Chrome a preventDefault on the composing Enter suppresses the commit
   * and the character never lands in the field. */
  const guardLine = kdBody ? (kdBody.slice(guardAt).split('\n').find((l) => l.includes('isComposing')) || '') : '';
  check(guardLine.includes('return') && !guardLine.includes('preventDefault'),
    'and the guard returns without cancelling the key, so the composition still commits',
    () => 'the guard cancelled the IME keydown, so the character never reaches the field');

  /* A finished round cannot be answered, and `dispatchEvent` reaches a DISABLED
   * element's listeners anyway — which is how the 作答 button works. The measured
   * symptom without this: the fall-through printed 「先輸入名稱或全國編號。」 (enter a name or national dex number) on a round
   * that can never be answered, overwriting the outcome a line earlier. */
  check(/if \(state\.status !== 'playing'\) return;/.test(kdBody || ''),
    'and the handler answers nothing on a round that has ended',
    () => 'a dispatched Enter still runs the handler on a disabled input, and tells the reader to type a name');
  /* Asked of the BODY, not of the file: `canSubmit()` does not appear inside itself,
   * so the first version of this searched the body for its own name and passed a
   * `[]` against a pattern it could never match — a guard that was green for the
   * wrong reason rather than a guard that failed loudly. */
  check(/state\.status !== 'playing'/.test(blockBody(jsCode, 'function canSubmit()') || ''),
    'which the 作答 button cannot reach anyway, because canSubmit() requires the round to be playing');

  /* THE TRAP, and the reason this assertion exists rather than a comment: the 作答 (answer)
   * button submits by DISPATCHING a synthetic `new KeyboardEvent('keydown', {key:
   * 'Enter'})`. A constructed event has `isTrusted === false` and `keyCode === 0`.
   * So a guard written to be tidy about untrusted events — `if (!e.isTrusted)
   * return`, or `if (e.keyCode === 0) return` — silently kills the ONLY route to
   * answering on a phone, where there is no Enter key at all. Nothing throws, and
   * the button it just disabled is still on screen. */
  check(!/isTrusted/.test(guardLine) && !/keyCode === 0/.test(guardLine),
    'and the guard does not reject on isTrusted or keyCode === 0, which the 作答 button\'s synthetic event carries',
    () => 'the button dispatches an untrusted keydown with keyCode 0; rejecting either leaves a phone with no way to answer');
  check(/els\.submit\.addEventListener\('click'[\s\S]{0,300}?dispatchEvent\(new KeyboardEvent\('keydown'/.test(jsCode),
    'which matters because the 作答 button really does dispatch that synthetic keydown',
    () => 'the button has stopped sharing the Enter chain, so the IME guard is no longer the only thing standing between it and a broken button');
}

// ---------------------------------------------------------------------------
console.log('\nwhile the list is open, Enter SELECTS — it never guesses');
// ---------------------------------------------------------------------------
{
  const kdBody = blockBody(jsCode, "els.search.addEventListener('keydown', (e) =>") || '';
  const openBlock = blockBody(kdBody, 'if (listIsOpen())');
  check(!!openBlock, 'the list-open branch is readable');

  /* The whole defect in one sentence: with 26 rows showing, Enter must not reach a
   * submit. It used to, and it picked #86 小海獅 (Seel) because `pokemon` is dex order —
   * one of four daily attempts spent on a species the reader never named. */
  check(!!openBlock && /chooseFromSearch\(/.test(openBlock),
    'a multi-row list routes Enter to chooseFromSearch(), which fills the field and submits nothing',
    () => 'Enter on an open list is submitting again');
  check(!!openBlock && /soleCandidate\(\)/.test(openBlock),
    'and the one exception is named: a list holding exactly one candidate',
    () => '「海星星」 matches one species, so Enter there is the reader naming their answer');

  /* What the helper COMPUTES, not merely that it is called. Both of these came
   * out of a mutation run: dropping `:not(.is-used)` and hard-coding `return true`
   * both left every assertion in this block green, because the block only ever
   * tested for the helper's NAME. §3.P's shape — an assertion about the mechanism
   * when the claim is about the mechanism's result.
   *
   * Counting an already-guessed row makes Enter "submit" on a list that offers
   * nothing to submit, and ignoring `hidden` makes `canSubmit()`'s whole-name
   * clause permanently false — so the button can never light for a name that
   * matched nothing in the list. */
  const sole = blockBody(jsCode, 'function soleCandidate()');
  check(!!sole && /:not\(\.is-used\)/.test(sole),
    'soleCandidate() counts only rows that are still guessable',
    () => 'an already-guessed row is not a candidate, so offering it as the sole one submits nothing the reader could act on');
  const open = blockBody(jsCode, 'function listIsOpen()');
  check(!!open && /els\.searchList\.hidden/.test(open),
    'listIsOpen() reads the rendered state rather than assuming a list',
    () => 'renderSearchResults() leaves the previous rows in the DOM on its early exits, so "rows exist" is not "a list is showing"');

  /* Counted rather than pattern-matched, because the mutation that matters is a
   * SECOND `pickFromSearch()` in this block that no `soleCandidate()` test guards.
   * An index comparison over `only != null` would catch that too, and both are
   * here because either alone can be satisfied by the other call. */
  const picks = indicesOf(openBlock, 'pickFromSearch(');
  const guarded = openBlock.indexOf('only != null');
  check(picks.length === 1 && guarded >= 0 && picks[0] > guarded,
    'the only submit reachable from an open list is the sole-candidate one',
    () => `found ${picks.length} pickFromSearch() call(s), sole-candidate test at ${guarded} — an open list must not submit on an ambiguous query`);

  /* And the select route must not itself submit, one call removed. This is the
   * assertion that already existed for the CLICK path, and it was the click path's
   * vacuous first version all over again if it is only checked at the call site. */
  check(!/\b(submitGuess|submitPendingPick)\b/.test(openBlock),
    'the open-list branch calls neither submitGuess() nor submitPendingPick() directly');

  /* `canSubmit()` is the SAME question asked by the button, so it must be the same
   * three tests in the same order. It used to end in "the field is non-empty",
   * which lit the button while 26 rows were open and nothing was chosen — and a
   * tap there would have to guess one. */
  const can = blockBody(jsCode, 'function canSubmit()');
  check(!!can && /pendingPick != null/.test(can) && /soleCandidate\(\) != null/.test(can)
    && /listIsOpen\(\)/.test(can) && /resolveExact\(/.test(can),
    'canSubmit() asks the same three questions Enter asks — armed, sole candidate, whole name',
    () => 'the button and the key have started answering different questions about the same round');
  check(!!can && !/els\.search\.value\.trim\(\)\.length/.test(can),
    'and it no longer treats "the field is non-empty" as something to submit',
    () => 'a query matching 26 rows, or none at all, still lights the button');

  /* The list being open or shut is what moves the button, so every writer of that
   * state has to redraw it. `renderSearchResults()` has TWO exits and the early one
   * is the one that empties the field. */
  const rsr = blockBody(jsCode, 'function renderSearchResults()');
  check(!!rsr && indicesOf(rsr, 'renderSubmit()').length >= 2,
    'renderSearchResults() redraws the button on both exits, including the early one that empties the field',
    () => `found ${rsr ? indicesOf(rsr, 'renderSubmit()').length : 0} call(s) — one is not enough`);
  check(/if \(e\.key === 'Escape'\)[\s\S]{0,200}?renderSubmit\(\)/.test(jsCode),
    'Escape closes the list and redraws the button with it');
  check(/if \(!e\.target\.closest\('\.gm-search-wrap'\)\)[\s\S]{0,200}?renderSubmit\(\)/.test(jsCode),
    'and so does a click on empty space');
}

// ---------------------------------------------------------------------------
console.log('\nthe round ends below the fold: the reader is taken there, and told');
// ---------------------------------------------------------------------------
{
  /* Measured, not assumed: with the document at scrollY 0 and 放棄 (give up) pressed, the
   * search row sits at y 653 (1440×900) / y 791 (390×844) and `#gm-result`'s top at
   * y 1117 / y 1247. On 放棄 (give up) with no guesses NOTHING in view changes at all, so the
   * panel is the round's only feedback and it starts 217px and 403px off-screen. */
  const reveal = blockBody(jsCode, 'function revealResult()');
  check(!!reveal, 'revealResult() exists');

  /* §3.G4's "re-measure AFTER you write", one level down. This was the defect in
   * the first version: the call sat right after `setRevealed()`, so it measured a
   * half-built panel. Smooth scrolling hid it — the animation outlasted the writes —
   * and `behavior: 'auto'` did not, landing 37px past the title at 390×844.
   *
   * COUNTED, not "is the last one". An insertion above the real call satisfies
   * `lastIndexOf()` — the mutation moved the call up, left the original in place, and
   * this assertion passed, because the question was asked about the last call rather
   * than about how many there are. §3.P's shape: the check described a position and
   * the defect was an extra statement. */
  const rr = blockBody(jsCode, 'function renderResult()');
  const calls = rr ? indicesOf(rr, 'revealResult();') : [];
  const stats = rr ? rr.indexOf('els.resultStats.innerHTML') : -1;
  const share = rr ? rr.indexOf('els.shareText.textContent') : -1;
  check(calls.length === 1 && stats >= 0 && share >= 0 && calls[0] > stats && calls[0] > share,
    'and renderResult() calls it exactly once, LAST, after the panel\'s contents exist',
    () => `${calls.length} call(s) at [${calls}], stats at ${stats}, share at ${share} — measuring a half-written panel missed by 37px on the phone`);

  /* Once per round, not once per render. `newGame()`'s half is the load-bearing one
   * — switching to a daily that was already finished restores a non-playing status
   * while the viewport is still parked on the PREVIOUS round's panel. */
  check(/if \(resultRevealed\) return;/.test(reveal || ''),
    'the one-shot latch is checked before anything moves');
  check(/function newGame[\s\S]*?resultRevealed = false;/.test(jsCode),
    'and newGame() clears it, so the next round is revealed on its own');

  /* §3.C: reduced motion is honoured, and the query is read at the moment of the
   * scroll rather than cached at boot — a reader who changes the setting mid-session
   * is obeyed. `initTip()`'s copy exists for a `change` listener, which this has no
   * use for. */
  check(/prefers-reduced-motion/.test(reveal || '') && /reduced \? 'auto' : 'smooth'/.test(reveal || ''),
    'smooth becomes auto under prefers-reduced-motion, read at the moment of the scroll',
    () => 'an animated viewport move is exactly what a reduced-motion reader asked not to have');

  /* And it does not move a reader who is already looking at it, or who has scrolled
   * past it — the latter having found it themselves.
   *
   * The BRANCH is asserted, not the two expressions it is built from. Deleting the
   * `if` left both booleans computed and unused, and the first version of this check
   * looked for `box.top < window.innerHeight` — which a line that feeds a discarded
   * value still satisfies. §3.P's third shape: an assertion made of a substring where
   * the claim is about a control-flow edge. */
  check(/getBoundingClientRect/.test(reveal || '') && /box\.top < window\.innerHeight/.test(reveal || '') && /box\.bottom <= 0/.test(reveal || ''),
    'and it measures `#gm-result` itself rather than a cached position');
  check(/if \(aboveFold && !scrolledAway\) return;/.test(reveal || ''),
    'it declines to move a reader whose viewport already shows the panel, or who has scrolled past it',
    () => 'a scroll that lands nowhere reads as the page seizing up');

  /* THE ANNOUNCEMENT, which is the same event seen from the other side. The panel is
   * a plain `<section>`: nothing tells a screen-reader user it appeared, and by the
   * time they go looking for it the round is over and gone.
   *
   * Asserted against the REGION rather than against a new element, because the
   * region already exists and a second `.sr-only` live region would be the one
   * message they cannot afford to miss being the one they have to go find. */
  const announce = blockBody(jsCode, 'function announceResult()');
  check(!!announce && /els\.searchStatus\.textContent/.test(announce),
    'the outcome is announced into #gm-search-status, the page\'s existing live region',
    () => 'the panel is a plain section; a screen-reader user is never told the round ended');
  check(/<p class="gm-search-status" id="gm-search-status" role="status" aria-live="polite">/.test(htmlCode),
    'and that region really is role="status" aria-live="polite" in the markup',
    () => 'writing into a plain <p> announces nothing');
  check(indicesOf(htmlCode, 'aria-live').length === 2 && indicesOf(jsCode, 'els.searchStatus.textContent').length >= 5,
    'while the page still has exactly TWO live regions — this one and the tip\'s',
    () => 'a third region for the round would mean two polite regions talking over each other');

  /* One title for the outcome, read by BOTH channels. Two copies of one string is a
   * second thing to keep right rather than a comparison (§3.B1). */
  const titleTable = /const RESULT_TITLE = \{[^}]*\}/.exec(jsCode);
  check(!!titleTable && /won: '答對了'/.test(titleTable[0]) && /lost: '這次沒猜到'/.test(titleTable[0]),
    'the won/lost titles live in one table both channels read');
  const rr2 = blockBody(jsCode, 'function renderResult()');
  check(!!rr2 && /els\.resultTitle\.textContent = RESULT_TITLE\[state\.status\]/.test(rr2),
    'the panel heading reads it');
  check(!!announce && /RESULT_TITLE\[state\.status\]/.test(announce),
    'and so does the announcement');

  /* The 異色 (shiny) marker is one function, for the same reason — and it is the only place
   * `variantSuffix()` may be bypassed. */
  check(!!rr2 && /\$\{variantSuffix\(\)\}/.test(rr2) && !!announce && /\$\{variantSuffix\(\)\}/.test(announce),
    'and so is the 異色 marker, which both channels call');
  check(indicesOf(jsCode, '（異色）').length === 1,
    'with the （異色） marker written exactly once',
    () => 'a second copy of the shiny test is a second thing to keep right');
  /* Two mutations found this pair inadequate: changing the flag `variantSuffix()` reads
   * left both assertions green, because neither asks WHAT the single copy decides —
   * only that there is one of it. A helper asserted to be the only writer is a claim
   * about duplication, not about correctness. */
  check(/variant === 's' \? '（異色）' : ''/.test(blockBody(jsCode, 'function variantSuffix()') || ''),
    'and that one copy decides on the shiny flag',
    () => 'the marker is still written once, from the wrong test');

  /* EXACTLY two states, because a third is a claim nothing can reach. Same shape as
   * §3.H's three literal category lists: `state.status` only ever holds these two off
   * the playing path, so a key nobody sets is a string nothing reads. */
  check(!!titleTable && /\{ won: '答對了', lost: '這次沒猜到' \}/.test(titleTable[0]),
    'and the table has EXACTLY those two states — a third would be a key nothing can reach');

  /* The latch covers BOTH consequences, and it is called before either — so a reader
   * whose viewport already showed the panel is still told. */
  check(!!reveal && reveal.indexOf('announceResult()') < reveal.indexOf('getBoundingClientRect'),
    'the announcement happens before the scroll decision, so it is unconditional',
    () => 'tying a screen reader\'s feedback to a layout question means the reader who can already see it is told nothing');

  /* ONE-SHOT LATCH GUARDING A PATH THAT DOES NOT CURRENTLY EXIST, and the panel's
   * title table is not an excuse to re-announce on a re-render. */
  check(/resultRevealed = true;/.test(reveal || '') && (reveal || '').indexOf('resultRevealed = true;') < reveal.indexOf('announceResult()'),
    'and it is latched BEFORE announcing, not after',
    () => 'a re-render would re-announce the same round to a screen reader, which reads as the round ending twice');

  /* ONE scroll site for the round-end, and it is the ONLY one besides the arrow-key
   * row's `block: 'nearest'`. Counting `els.result.scrollIntoView(` alone was the
   * first version, and a mutation that added `gm-giveup.scrollIntoView(...)` left
   * that count at 1 — the assertion was about a receiver rather than about the
   * page's ability to move. */
  const allScrolls = indicesOf(jsCode, '.scrollIntoView(');
  const nearest = allScrolls.filter((i) => /scrollIntoView\(\{ block: 'nearest' \}\)/.test(jsCode.slice(i, i + 60)));
  check(allScrolls.length === 2 && nearest.length === 1,
    'and the result panel\'s scroll is the only one on the page besides the arrow-key row\'s `block: nearest`',
    () => `found ${allScrolls.length} scrollIntoView call(s), ${nearest.length} of them the row scroll — a third would be a second place the viewport moves from`);
}

// ---------------------------------------------------------------------------
console.log('\nnothing can answer, arm or clear a round that has ended');
// ---------------------------------------------------------------------------
{
  /* Three writers of the round-end outcome that can reach a FINISHED round. All three
   * are guarded, and all three were reachable rather than theoretical. */
  const pick = blockBody(jsCode, 'function pickFromSearch(id)');
  check(!!pick && /if \(state\.status === 'playing'\) \{[\s\S]{0,320}?els\.searchStatus\.textContent/.test(pick),
    'pickFromSearch() only clears the status line while the round is still going',
    () => 'it cleared the line on the exact frame the announcement was written — the round ending silently, which is what the announcement exists to prevent');
  check(!!pick && /if \(state\.status === 'playing'\)/.test(pick),
    'and the guard is a BRANCH around both of its writes, not one of them',
    () => 'guarding only the clear still lets 「這次已經結束了。」 overwrite the outcome');

  const choose = blockBody(jsCode, 'function chooseFromSearch(id)');
  check(!!choose && /if \(state\.status !== 'playing'\)/.test(choose),
    'chooseFromSearch() refuses to arm a pick on a finished round',
    () => 'giveUp() does not dismiss the list — its click handler returns before the click-outside branch — so live rows survive the ending');
  /* BRACE-MATCHED, and that is a correction rather than a style. The first version
   * used `if (state.status !== 'playing') \{[\s\S]{0,240}?pendingPick = null;`, and a
   * mutation that deleted the clear left it GREEN — the lazy match ran straight past
   * the branch's closing brace and found the `pendingPick = null` in the
   * already-guessed branch below it. §3.P's second vacuous shape, written from memory
   * by the person who had just recorded it. */
  const deadBranch = choose ? blockBody(choose, "if (state.status !== 'playing')") : null;
  check(!!deadBranch && /pendingPick = null;/.test(deadBranch),
    'and it clears anything already armed rather than leaving it',
    () => 'the reader is told the round is over while Enter still submits the old pick');

  const all = blockBody(jsCode, 'function renderAll()');
  check(!!all && /if \(!playing\) pendingPick = null;/.test(all),
    'renderAll() drops an armed pick when the round ends',
    () => 'arm a row, press 放棄 instead of Enter, then Enter — submitPendingPick() returns true and the round ends with nothing on screen and nothing said');
}

// ---------------------------------------------------------------------------
console.log('\n§3.G: the delegation target is never a rebuilt node');
// ---------------------------------------------------------------------------
{
  check(/document\.addEventListener\('click'/.test(jsCode),
    'clicks are delegated on document, not bound per item');
  check(/e\.target\.closest\('\.gm-search-item'\)/.test(jsCode),
    'and the lookup finds the CONTAINER of the click',
    () => 'closest() from a rebuilt child would still work; the trap is capturing the child');
  // No captured node: §3.G7's rule, that a captured node can leave the tree
  // between capture and press and a detached node does not bubble.
  /* §3.G7's defect is a node captured ONCE and clicked LATER, across a render.
   * Looking one up at the moment of use is the fix, not the fault — the first
   * version's regex rejected the correct pattern and would have pushed the page
   * towards a cache. What is forbidden is a module-scope or handler-scope capture
   * that a render can invalidate. */
  /* A lookup at the moment of use is CORRECT (§3.G7's fix). The defect is a node
   * captured into a binding and used again after something re-rendered. The first
   * version tried to express that as "the name appears exactly once", which a
   * mutation satisfies by adding a SECOND variable rather than removing the
   * click — so it stayed green. The condition that actually matters is simpler:
   * nothing may hold on to a DOM node across an `innerHTML =` assignment, and the
   * only way to hold one is a `const x = <querySelector…>` that is still in scope
   * somewhere else. Assert the DOM-rebuild sites instead: they are enumerable,
   * and each one must be followed by a re-query rather than a stored node. */
  const rebuilds = (jsCode.match(/\.innerHTML\s*=/g) || []).length;
  check(rebuilds > 0, `the module rebuilds markup in ${rebuilds} places, so there is something to check`,
    () => 'no .innerHTML assignment matched — the detached-node rules below would be vacuous');
  /* Precisely: a capture at MODULE scope. A lookup inside an event handler, used
   * before anything re-renders, is correct — that is §3.G7's fix. A lookup at
   * module scope is the defect, because it is evaluated once, before the first
   * render, and then every later press targets a node that no longer exists.
   *
   * The earlier version tried "the name is used more than twice" and flagged the
   * correct Enter handler, then a mutation that merely added a second variable
   * satisfied it. Module scope is a property of the line, not of a use count, so
   * it can be read off the source without a heuristic.
   *
   * `els.* = document.getElementById(...)` at module scope is FINE and is not
   * flagged: those ids are read after their own markup exists, and they are
   * resolved inside `init()` before anything renders. */
  /* The `getElementById` exemption was the hole: it was meant to spare the
   * `els.x = document.getElementById(...)` lines, but those live INSIDE init()
   * and are indented, so they never matched the column-0 filter anyway — while
   * `const early = document.getElementById(x).querySelector(y)` DID match
   * column 0 and was exempted for containing the word. Exemption removed. */
  const moduleScope = jsCode.split('\n')
    .filter((line) => /^(?:const|let)\s/.test(line))
    .filter((line) => /\.querySelector(All)?\(/.test(line))
    .map((line) => (line.match(/^(?:const|let)\s+(\w+)/) || [])[1])
    .filter(Boolean);
  check(moduleScope.length === 0,
    'no DOM node is captured at module scope',
    () => `${moduleScope.join(', ')} — a module-scope lookup runs once, before the first render, so every later press targets a detached node that does not bubble (§3.G7)`);
  check(!/\.querySelectorAll\([^)]*\)\.forEach\(/.test(jsCode),
    'and no element is re-bound in a loop after a render');
}

// ---------------------------------------------------------------------------
console.log('\nthe stylesheet owns nothing but gm-');
// ---------------------------------------------------------------------------
{
  /* The `[^@{]` in the pattern skips AT-RULE PRELUDES: `@media (max-width: 640px)`
   * is not a selector and matches nothing, so counting it as one produced two
   * permanent offenders that could never be fixed by any edit to the stylesheet. */
  /* `[^{}@]` is not enough: for `}\n\n@media (…) {` the `\s*` backtracks, `[^{}@]`
   * matches the newline, and `[^{}]*?` then happily swallows `@media …` up to its
   * brace. The prelude therefore has to be rejected on CONTENT, which is what
   * the `@` test does — the first version reported the same two at-rule preludes
   * as permanent offenders that no edit to the stylesheet could ever fix. */
  const selectors = [...cssCode.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)]
    .map((m) => m[2].trim())
    .filter((s) => s && !s.includes('@'));
  /* Keyframe STOPS are not selectors, exactly like the at-rule preludes excluded
   * above, and this file had no `@keyframes` until the rotating tip's caret blink
   * added one — so `50%, 100%` arrived as a "rule" that no edit to the stylesheet
   * could ever fix, which is the failure mode the at-rule exclusion was already
   * written for.
   *
   * ONLY THE SECOND STOP IS EVER SEEN, and the comment here used to say both were.
   * The matcher's prelude must be preceded by `}` or start-of-line, so the first
   * stop — the one straight after `@keyframes gm-tip-blink {` — is swallowed with
   * the at-rule and never appears in the list. It was never an offender, and
   * claiming it was would have been a second version of the same mistake: describing
   * what the code does instead of what the code does.
   *
   * Narrow on purpose: a percentage stop, a comma-separated list of them, or
   * `from`/`to`. Anything else still has to carry a `.gm-` class, and a bare
   * selector is still reported. */
  /* And `cssCode` is comment-stripped above, so a comment that happens to contain
   * braces or a class name is not in this list either — running the same matcher over
   * the RAW file reports three offenders where the checker reports one. */
  const KEYFRAME_STOP = /^(?:\d{1,3}(?:\.\d+)?%\s*,?\s*)+$|^from\b|^to\b/i;
  const realSelectors = selectors.filter((s) => !KEYFRAME_STOP.test(s));
  const offenders = realSelectors.filter((s) => !/\.gm-/.test(s) && !s.startsWith(':root') && !/^[a-z-]+\s*$/i.test(s));
  check(offenders.length === 0,
    `every rule targets a .gm- class (${realSelectors.length} rules scanned, `
    + `${selectors.length - realSelectors.length} keyframe stop(s) excluded)`,
    () => `${offenders.slice(0, 4).join(' | ')} — §3.B1: a page-scoped rule belongs in the page's own file, and anything that matches a shared .cp-* class here is a change to two other pages`);

  check(!/\.cp-|\.sc-/.test(cssCode),
    'and this page styles no shared colour-page class',
    () => 'a `.cp-` rule here changes color.html and colors-explore.html, whose checkers pin several of those declarations');

  const htmlLinks = [...html.matchAll(/assets\/css\/([^"]+)/g)].map((m) => m[1]);
  check(htmlLinks.includes('color-game.css'), 'and color-game.html links it');
}

// ---------------------------------------------------------------------------
console.log('\nthe page cannot re-derive what the modules own');
// ---------------------------------------------------------------------------
{
  check(!/deltaEOk\s*=|function\s+colorDistance|function\s+hexToRgb\s*\(/.test(jsCode),
    'color-game.js defines no distance or hex-parsing of its own',
    () => 'a second implementation of the metric is a second answer to 「which species is closest」');
  check(!/buildMatchIndex|groups\.set|new Map\(\)\s*;\s*\n\s*const\s+scored/.test(jsCode),
    'and builds no shadow index');
  check(/from '\.\/game-similarity\.js'/.test(js) && /from '\.\/game-hints\.js'/.test(js),
    'the two pure modules are imported rather than re-implemented');
  /* The §3.K trap, one layer out. The page computes sameEvolutionFamily itself
   * (it is the page that owns the badges), so the assertion is that it compares
   * `evolution_chain_id` and never reads `stage`. */
  const rel = /function relatedness[\s\S]*?\n {2}\}/.exec(jsCode);
  check(rel && /evolution_chain_id/.test(rel[0]) && !/\bstage\b/.test(rel[0]),
    'sameEvolutionFamily compares evolution_chain_id, never `stage`',
    () => '§3.K: `stage` is dex order, not depth — Vaporeon carries stage 2 of 10 and is a final evolution');
}

// ---------------------------------------------------------------------------
console.log('\nthe daily round cannot be farmed by reloading');
// ---------------------------------------------------------------------------
{
  check(/persistDaily/.test(jsCode) && /restore\(/.test(jsCode),
    'a finished daily round is written and read back');
  /* This asserted the OPPOSITE of what is now true, and its stated reason was false.
   *
   * It read: 「`giveUp()` with no mode guard ends the round, and since it calls
   * `newGame()` on the next render the reader gets a second attempt at the same
   * answer」. `giveUp()` does not call `newGame()` — it calls `renderAll()`, which
   * draws nothing. So the gate was never preventing a second attempt; the rule was
   * invented during the port (the reference's `handleGiveUp` has no mode guard) and
   * the prose defending it described a code path that does not exist.
   *
   * What the gate WAS silently load-bearing for is the opposite direction, and it is
   * asserted below: `persistDaily()` has no mode check of its own, so while giving up
   * was daily-only nothing else could reach it from unlimited mode. Removing the gate
   * without the guard underneath would write an unlimited round into today's store and
   * `newGame()`'s `restore()` would serve it back as the day's puzzle. */
  const giveUpBody = /function giveUp\(\)\s*\{[\s\S]*?\n\}/.exec(jsCode);
  check(!!giveUpBody && !/state\.mode !== 'daily'/.test(giveUpBody[0]),
    'and 「放棄」 works in BOTH modes — the reference gates on the round state only',
    () => "giveUp() still refuses outside daily mode, so a reader in unlimited cannot say 「我不猜了，看答案」 (I give up, show the answer)");
  check(!!giveUpBody && /if \(state\.mode === 'daily'\) persistDaily\(\);/.test(giveUpBody[0]),
    'while the DAILY WRITE inside it is mode-guarded, which is what the old gate was really protecting',
    () => 'persistDaily() has no mode check of its own, so an unlimited give-up would be written into the daily store and restored as a free answer');
  /* The SAME guard on `submitGuess()`, and it is asserted separately because the two
   * bodies are identical-looking: the mutation that removed it was applied with a
   * `replace(..., 1)` that hit `submitGuess()` first, because that function comes first
   * in the file — so a guard test scoped only to `giveUp()` passed while the guard it
   * was written about had been deleted from somewhere else. */
  const submitBody = /function submitGuess\(id\)\s*\{[\s\S]*?\n\}/.exec(jsCode);
  check(!!submitBody && /if \(state\.mode === 'daily'\) persistDaily\(\);/.test(submitBody[0]),
    'and submitGuess() carries its own copy of that guard — asserted per-function, not once for the file');
  check(/els\.giveup\.hidden = !playing;/.test(jsCode),
    'and the button is hidden only by the round state, never by the mode',
    () => 'the button still carries a mode term, so one of the two modes has no visible 放棄');
  /* The target is drawn in exactly ONE place. A render that re-drew it would hand
   * the reader a different puzzle for the same day every time the UI re-rendered,
   * and nothing in the pure modules could see it. */
  const draws = (jsCode.match(/currentTarget\(\)/g) || []).length;
  check(draws === 2,
    'the target is drawn in exactly one place — newGame() calling currentTarget() once',
    () => `${draws} occurrences: newGame() must be the only caller, or a re-render re-draws today's puzzle`);
  check(/function newGame[\s\S]*?currentTarget\(\)/.test(jsCode),
    'and that place is newGame()');
  check(/date: todayKey\(\)/.test(jsCode),
    'and the stored round is keyed by the Taipei day');
  check(/taipeiDateKey/.test(js),
    'using the same day boundary as daily-pick.js',
    () => 'a UTC day here would roll the puzzle over at 08:00 Taipei while 今日推薦 does not');
}

// ---------------------------------------------------------------------------
console.log('\nshape assertions, declared as shapes');
// ---------------------------------------------------------------------------
{
  // Both are shapes and both say so, because each names a thing that CAN be
  // satisfied by a string appearing elsewhere in the file.
  check(!/Math\.random\(\)/.test(jsCode),
    'the page draws no target with Math.random (shape — the daily draw is seeded elsewhere)',
    () => 'an unseeded target means two readers see different puzzles on the same day');
  check(!/stage/.test(jsCode),
    'color-game.js never mentions `stage` at all (shape)',
    () => 'any mention is a reason to re-read why §3.K exists');

  // And the two that are NOT shapes, i.e. genuinely behavioural elsewhere.
  check(/hints\.length >= 2/.test(jsCode) || /revealed/.test(jsCode),
    'the palette reveal is tied to the hint count');
  /* The old version asserted the page does not mention `PALETTE_COLORS_SHOWN`,
   * which is true of any page at any time — adding `const THREE = 3` anywhere
   * left it green. The claim worth making is that the page DELEGATES: it asks
   * visiblePalette() for the rows and never decides how many there are itself.
   * So the test is for a slice of palette rows in the page, which is the shape a
   * restated count would take. */
  check(/visiblePalette\(/.test(jsCode), 'the page asks visiblePalette() for the swatches');

  /* SCOPED TO `renderPalette()`, and that scoping is a correction rather than a
   * loosening. The claim is about the TARGET BAR: it must delegate its 3-vs-6 count to
   * `visiblePalette()` so that rule lives in one place. The file-wide version of this
   * test also caught the GUESS ROW's strip, which asks a different question — not "how
   * many of the target's colours", but "how many colours in this species' strip" —
   * and whose answer already exists as `VISIBLE_STRIP_COLORS` in `color-palette.js`.
   *
   * The alternative was a helper in `game-similarity.js`, and it was not taken because
   * that module imports only pure modules (`color-match.js`, `daily-pick.js`) and is run
   * in bare Node by `check_game_similarity.mjs`; reaching `VISIBLE_STRIP_COLORS` through
   * `color-palette.js` would pull `shared.js` — a browser module — into that graph. The
   * two counts have different owners, so testing them in one place was the error. */
  const rp = /function renderPalette\(\)[\s\S]*?\n}/.exec(jsCode);
  check(!!rp && !/\.slice\(/.test(rp[0]),
    'and renderPalette() never slices — the target bar delegates its count',
    () => 'a slice inside renderPalette() is a second copy of the 3-vs-6 rule, which game-similarity.js owns');
  /* Read from `game-similarity.js`, not the page: `visiblePalette()` lives there, and
   * testing the page for it was testing the wrong file — which is why the first version
   * of this assertion failed on correct code. */
  check(/const n = revealed \? rows\.length : PALETTE_COLORS_SHOWN/.test(similarity),
    'with the reveal rule still owned by visiblePalette()\'s own single computation, in game-similarity.js',
    () => 'the 3-vs-6 computation has moved or been restated');

  /* The strip's count is a DIFFERENT question with a named owner, and it must be that
   * name rather than a literal — a bare `5` here would be the same restated-count
   * defect one function over. */
  check(/paletteRows\(palettes, g\.id, state\.target\.variant\)\.slice\(0, VISIBLE_STRIP_COLORS\)/.test(jsCode),
    'the guess row\'s strip takes its count from `VISIBLE_STRIP_COLORS`, the same 5 `.cp-strip` uses',
    () => 'the strip carries its own number, so the two strips can disagree');
  check(/VISIBLE_STRIP_COLORS,/.test(jsCode) && /from '\.\/color-palette\.js'/.test(jsCode),
    'and that constant is imported, not re-declared');
  check(!/const\s+(?:STRIP|ROW)_COLORS\s*=/.test(jsCode),
    'with no second constant introduced alongside it');
  check(!/\b3\b\s*(?::|\?)?.*swatch|swatch.*\b3\b/.test(jsCode),
    'and no bare 3 anywhere near the swatch count',
    () => 'the number is restated');
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);