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
   * button enabled and still reading 再看一則提示 after the third hint is a lie that
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
   * file for §3.P's vacuous mutations, and I wrote a SECOND copy before noticing,
   * which is the same mistake in a new place. The version this replaced was
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

  /* Enter must try the armed pick before the row it last walked to, which is the
   * only route into the field that names a species the reader chose by hand. */
  const kd = /els\.search\.addEventListener\('keydown'[\s\S]*?\n {2}\}/.exec(jsCode);
  check(!!kd, 'the keydown handler exists');
  const at = kd ? ['submitPendingPick()', 'aria-selected', 'resolveExact(', '.gm-search-item:not(.is-used)'].map((n) => kd[0].indexOf(n)) : [];
  check(at.every((i) => i >= 0) && at.every((v, i) => i === 0 || v > at[i - 1]),
    "Enter tries the armed pick, then the arrow-key row, then a whole name, then the first row",
    () => `positions ${at.join(', ')} — expected ascending, and submitPendingPick() must come first`);

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
  check(/function renderDatalist[\s\S]{0,400}?pool \|\| pool\.has/.test(jsCode),
    'and so does the native datalist, which is the layer a phone keyboard reads');

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