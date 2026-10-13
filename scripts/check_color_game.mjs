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

// ---------------------------------------------------------------------------
console.log('\nthe page shell');
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
  check(delegated.size >= 4,
    `and ${delegated.size} more ids by closest('#id') rather than by a captured node`,
    () => `only ${delegated.size} — below four, some control probably moved to a captured node`);
}

// ---------------------------------------------------------------------------
console.log('\nthe three tiers, and what makes 地獄 different');
// ---------------------------------------------------------------------------
{
  for (const d of ['easy', 'hard', 'hell']) {
    check(new RegExp(`data-difficulty="${d}"`).test(html), `the ${d} tier is in the markup`);
  }
  check(/id="gm-mode-daily"/.test(html) && /id="gm-mode-unlimited"/.test(html),
    'both modes are present (每日 / 無限)');

  // The whole point of 地獄 is the appearance, and the pools of hard and hell are
  // IDENTICAL. So the badge is the only place that difference can be visible.
  check(/id="gm-shiny-badge"/.test(html), 'the 異色 badge exists in the markup');
  const badge = html.match(/<span class="gm-shiny-badge"[^>]*>/);
  check(!!badge && /\bhidden\b/.test(badge[0]),
    'and ships hidden, so JS has to turn it on');
  check(/els\.shinyBadge\s*=/.test(jsCode), 'which the module actually reads');
  check(/renderShinyBadge\(\)/.test(jsCode), 'and turns on through a named function');
  /* The badge shipped in the HTML with `hidden` and NOTHING in the module ever
   * touched it, so 地獄 rendered identically to 困難 — the entire reason for the
   * tier's existence was invisible. Asserting the markup alone would have passed
   * throughout; the assertion is that the CALL SITE exists. */
  check(/renderShinyBadge\s*\(\s*\)\s*;/.test(jsCode.split('function renderAll')[1] || ''),
    'and renderAll() calls it — the defect was the element existing with nothing ever unhiding it');

  const simCode = stripJs(similarity);
  check(/function variantOf\(difficulty\)\s*\{\s*return difficulty === 'hell' \? 's' : 'n';/.test(simCode),
    "variantOf() is one line in game-similarity.js: only 地獄 is shiny",
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
console.log('\nthe guess box: two autocomplete layers, and the keyboard');
// ---------------------------------------------------------------------------
{
  /* The stated need: a reader who knows it is 妙蛙種子 and cannot type it exactly.
   * There are two layers because they cover different gaps — the custom list
   * matches on SUBSTRING and knows which species are already guessed, while a
   * datalist matches on PREFIX but is the only one a phone's software keyboard
   * will read. */
  check(/list="gm-names"/.test(html), 'the input points at a datalist');
  check(/<datalist id="gm-names">\s*<\/datalist>/.test(html), 'and the datalist is declared empty in the markup');
  check(/els\.names\.innerHTML\s*=/.test(jsCode), 'which JS fills');
  check(!/renderSearchResults[\s\S]{0,400}els\.names\.innerHTML/.test(jsCode),
    'and fills it ONCE — 1,025 options rebuilt per keystroke is ~40 KB of DOM churn on the page whose whole premise is that the reader types a lot',
    () => 'the datalist is being rebuilt inside the search path');

  /* Enter's precedence: an explicitly walked-to row, then a WHOLE name, then the
   * first substring hit. Exact-before-first is the fix — the substring scan
   * matches inside other names (水伊布, 雷伊布, 妖精伊布 all contain 伊布), so
   * "first row" is dex order rather than what the reader literally typed. */
  const keydown = /els\.search\.addEventListener\('keydown'[\s\S]*?\n {2}\}/.exec(jsCode);
  check(!!keydown, 'the search field has a keydown handler');
  const order = keydown ? ['aria-selected', 'resolveExact(', '.gm-search-item:not(.is-used)', '找不到'].map((n) => keydown[0].indexOf(n)) : [];
  check(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]),
    'Enter takes the arrow-key row, then a whole name, then the first suggestion',
    () => `positions ${order.join(', ')} — expected ascending, and the whole-name test must come BEFORE the first-substring-row`);

  /* A listbox owes the reader navigation. */
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
  const offenders = selectors.filter((s) => !/\.gm-/.test(s) && !s.startsWith(':root') && !/^[a-z-]+\s*$/i.test(s));
  check(offenders.length === 0,
    `every rule targets a .gm- class (${selectors.length} rules scanned)`,
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
  check(/function giveUp\(\)\s*\{[\s\S]*?state\.mode !== 'daily'\) return;/.test(jsCode),
    '「放棄」 is refused outside 每日 mode',
    () => 'giveUp() with no mode guard ends the round, and since it calls newGame() on the next render the reader gets a second attempt at the same answer');
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
  check(!/paletteRows\([^)]*\)\.slice|\.slice\(0,\s*(PALETTE|THREE|\d+)\s*\)/.test(jsCode),
    'and never slices a palette to decide how many swatches to show',
    () => 'a slice here is a second copy of PALETTE_COLORS_SHOWN, which game-similarity.js owns');
  check(!/\b3\b\s*(?::|\?)?.*swatch|swatch.*\b3\b/.test(jsCode),
    'and no bare 3 anywhere near the swatch count',
    () => 'the number is restated');
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);