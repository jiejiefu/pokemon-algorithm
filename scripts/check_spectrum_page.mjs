#!/usr/bin/env node
/**
 * Static guards on spectrum.html, its stylesheet, and the two modules it depends on
 * most.
 *
 * Run: node scripts/check_spectrum_page.mjs
 * Test: node scripts/test_check_spectrum_page.mjs  (proves each check can fail)
 *
 * WHAT IS ALREADY GUARDED ELSEWHERE, AND NOT HERE
 * ----------------------------------------------
 * The maths is settled in `check_spectrogram_port.mjs`, which differences the module
 * against `analyze_cries.py` itself. The nav is settled in `check_nav_pages.mjs`.
 * Playback, ink on the canvases and the mute are settled in
 * `check_spectrum_browser.mjs` over the DevTools Protocol. What is left here is the
 * set of claims that only exist in the source text, and they are claims about
 * honesty rather than about arithmetic.
 *
 * THE FOUR THINGS WORTH GUARDING
 * ------------------------------
 *
 * 1. `cry-spectrogram.js` USES NO PLATFORM. Not for tidiness — for the same reason
 *    `gb-apu.js` is pure: a module with no DOM can be run by Node and checked
 *    against the Python, and a module that quietly reaches for `document` cannot.
 *    This is the one assertion that would have caught every portability problem in
 *    one line.
 *
 * 2. THE CONSTANTS ARE NUMERICALLY EQUAL TO THE PYTHON'S, not merely present.
 *    A source-shape regex over `SR = 16000` passes for `SR = 160000`. This parses
 *    both files and compares the values, so a divergence is a red test rather than a
 *    silently different feature vector — which is the failure mode §3.B2 calls "a
 *    change of units that cannot reorder anything".
 *
 * 3. THE PAGE'S THREE DISCLOSURES ARE IN THE DOM.
 *    §3.B1 records the shape this exists for: `colors-generator.html` kept promising 「生成明暗階」
 *    in its meta description after the section was deleted, because no shape check
 *    reads a description. Three sentences on this page can go stale the same way:
 *    that the spectrogram is computed BEFORE playback, that the two canvases are
 *    different measurements, and that peak/rms/m0 are excluded for two different
 *    reasons. All three are asserted here as text, not as variables.
 *
 * 4. THE STYLESHEET TOUCHES NOTHING IT DOES NOT OWN. `spectrum.css` exists so this
 *    page's rules are not `cries.css`'s problem, and that guarantee is only real if
 *    no selector outside the `sp-` namespace is written there. `cries.css` is already
 *    shared by two pages and `cp-*` belongs to three.
 *
 * AND THE ONE THAT IS EASY TO GET SUBTLY WRONG
 * --------------------------------------------
 * The page reads its colour ramp from CSS custom properties rather than hardcoding
 * six hex values, because `spectrum.css` declares the ramp once and the legend
 * gradient uses the same six. Two copies is two things to keep right, and the
 * failure mode is a legend that has quietly stopped describing the picture. So the
 * checker asserts BOTH halves: the stops are declared in the stylesheet, and the
 * script reads them rather than carrying its own.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

let checks = 0;
const fails = [];
const ok = (cond, what) => {
  checks++;
  if (!cond) fails.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const eq = (got, want, what) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want:  ${b}`}`);
};

const page = read('spectrum.html');
const css = read('assets/css/spectrum.css');
/* Read ONCE: `readJson` does not cache and this table is 2.8 MB, and two sections
 * below now both need it — the 傳說/幻之 facet counts and the live curve's ink sweep. */
const pokemon = readJson('assets/data/pokemon_data.json');
const mod = read('assets/js/cry-spectrogram.js');
const py = read('scripts/analyze_cries.py');
const player = read('assets/js/cry-player.js');
const autoplay = read('assets/js/cry-autoplay.js');

// ---------------------------------------------------------------------------
// 1. The module is pure.
// ---------------------------------------------------------------------------

/* Strip comments first. A docblock that NAMES the forbidden globals in order to
 * explain why they are absent would otherwise be read as a use of them — and this
 * file's own docblock names `document` and `fetch` at least once. */
const modCode = mod
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

for (const global of ['document', 'window', 'fetch', 'AudioContext', 'XMLHttpRequest', 'localStorage']) {
  ok(!new RegExp(`\\b${global}\\b`).test(modCode),
    `cry-spectrogram.js uses no \`${global}\` — it is runnable from Node, which is the only reason the port can be checked`);
}

const modImports = mod.match(/^import .*$/gm) ?? [];
eq(modImports, [],
  'cry-spectrogram.js imports nothing, so the scratch tree for its mutation suite needs three files and not a directory');

// ---------------------------------------------------------------------------
// 2. The constants are numerically equal to the Python's.
// ---------------------------------------------------------------------------

/** `NAME = value` or `NAME: value = value` in the Python, value read as a number. */
/**
 * The Python's constants, by VALUE.
 *
 * Three forms have to be handled and the first version handled none of them:
 * `SR = 16_000` carries digit separators, `FRAME = int(round(0.025 * SR))` is a call
 * over another constant, and `EPS = 1e-10` has an exponent. So the expressions are
 * EVALUATED in dependency order with `int(round(` unwrapped, and identifiers are
 * allowed through the pattern test on purpose: it is the `try` that defers an
 * unresolved one, so a pattern that rejected `SR` would defer it forever instead —
 * which is what the second version did, silently, for FRAME and HOP.
 * This is the whole
 * point of comparing by value. A regex matching bare digits would have "compared"
 * all nine constants while checking one, which is the §4 failure shape: a check
 * that cannot fail.
 */
function pyNumbers(source) {
  const body = source.replace(/#.*$/gm, '');
  const out = {};
  const pending = [];
  const re = /^([A-Z_0-9]+)\s*(?::\s*[\w\[\]\/ ]+)?=\s*(.+)$/gm;
  let m;
  while ((m = re.exec(body))) {
    if (!/^(SR|FRAME|HOP|N_FFT|N_MEL|N_MFCC|FMIN|FMAX|PRE_EMPHASIS|EPS|DIMENSIONS)$/.test(m[1])) continue;
    pending.push([m[1], m[2].trim()]);
  }
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, raw] = pending[i];
      const expr = raw
        .replace(/_/g, '')
        .replace(/^int\(round\((.*)\)\)$/, '$1')
        .replace(/^int\((.*)\)$/, '$1');
      if (!/^[\w\s()*/+\-.]+$/.test(expr)) continue;
      let value;
      try {
        // eslint-disable-next-line no-new-func
        value = Function(...Object.keys(out), `return (${expr});`)(...Object.values(out));
      } catch {
        /* An unresolved identifier: defer to the next pass rather than fail. */
        continue;
      }
      if (!Number.isFinite(value)) continue;
      out[name] = value;
      pending.splice(i, 1);
    }
  }
  return out;
}

/** The same, for `export const NAME = <expression>` in the module. */
function jsNumbers(source) {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  const pending = [];
  const re = /^export const ([A-Z_0-9]+) = ([^;]+);/gm;
  let m;
  while ((m = re.exec(body))) pending.push([m[1], m[2].trim()]);
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, expr] = pending[i];
      if (!/^(?:[\w\s()*/+\-.]|Math\.[\w.]+\([\w\s()*/+\-.]*\))+$/.test(expr)) continue;
      let value;
      try {
        // eslint-disable-next-line no-new-func
        value = Function('Math', ...Object.keys(out), `return (${expr});`)(Math, ...Object.values(out));
      } catch {
        continue;
      }
      if (!Number.isFinite(value)) continue;
      out[name] = value;
      pending.splice(i, 1);
    }
  }
  return out;
}

const pyN = pyNumbers(py);
const jsN = jsNumbers(mod);

for (const name of ['SR', 'FRAME', 'HOP', 'N_FFT', 'N_MEL', 'N_MFCC', 'FMIN', 'PRE_EMPHASIS', 'EPS']) {
  ok(name in pyN, `analyze_cries.py's ${name} was evaluated, so there is something to compare against`);
  ok(name in jsN, `cry-spectrogram.js's ${name} was evaluated`);
  if (name in pyN && name in jsN) {
    /* By value, with a tolerance of one part in 1e9. `FRAME` is
     * `int(round(0.025 * SR))` in the Python and `Math.round(0.025 * SR)` here, so
     * the arithmetic has to be evaluated rather than read as text — and it has to be
     * the SAME number, because a 1-sample difference in FRAME moves the window's
     * symmetric ends and changes every MFCC row. */
    eq(jsN[name], pyN[name], `${name} is numerically identical in both implementations`);
  }
}

eq(jsN.SR / 2, 8000,
  'and the mel filterbank tops out at 8 kHz, which is the Nyquist the resample keeps');

// ---------------------------------------------------------------------------
// 3. The three exclusions, named rather than counted.
// ---------------------------------------------------------------------------

ok(/export const UNCOMPARABLE = \[/.test(mod),
  'the module names its uncomparable features as a list, so adding one is a visible edit');

for (const name of ['peak', 'rms', 'm0']) {
  ok(mod.includes(`FEATURE_NAMES.indexOf('${name}')`),
    `${name} is on it — the module says which three cannot be reproduced in a browser`);
}

ok(mod.includes('export const ROBUST'),
  'and it names the well-conditioned features separately, because being uncomparable and being ill-conditioned are different problems');

const robustNames = (mod.match(/export const ROBUST = \[([^\]]*)\]/)?.[1] || '')
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
eq(robustNames.length, 5,
  'five features are well-conditioned enough to compare — flatness was removed from this list after measuring 31% on a real file');
ok(!robustNames.includes('flatness'),
  'flatness is NOT among them: it is scale-invariant and ill-conditioned, a ratio of two nearly equal numbers');
ok(robustNames.includes('dur') && robustNames.includes('centroid')
  && robustNames.includes('zcr') && robustNames.includes('rolloff85')
  && robustNames.includes('flux'),
  `and the five are exactly the well-conditioned ones: ${robustNames.join(', ')}`);

// ---------------------------------------------------------------------------
// 4. The page's three disclosures are in the DOM.
// ---------------------------------------------------------------------------

/* The reveal disclosure, which §3.G records as load-bearing: without it a reader has
 * no way to know the wipe is not a live analysis — it looks exactly like one.
 *
 * It says the two halves as ONE claim and the check keeps them as ONE assertion, because
 * a page that computed the image before playback and did not say so would pass a check on
 * either half alone. `.test(page)` rather than `.test(intro)` on purpose: this sentence
 * lives in the PLOT'S CAPTION, not the intro, and that move is recorded in the source
 * beside it. The caption is what the canvas's aria-describedby points at, so it is also
 * the plot's alt text — the claim is delivered where the drawing is announced, and the
 * intro stays three paragraphs about the picture rather than four about a mechanic. */
ok(/整段算好/.test(page) && /不等於/.test(page) && /揭開/.test(page),
  'the page says the spectrogram is computed BEFORE playback, and that the reveal is not a live analysis');
/* And it is a CAPTION, not a comment: the string has to reach the DOM, so a mutation
 * that deletes the whole line cannot satisfy this by leaving the words in a comment.
 *
 * The window is 2,200 characters rather than a tight one because the docblock explaining
 * WHY this sentence moved is inside the same statement, and a 900-char window measured
 * the blocklist of its own justification. The check that the words are in the caption
 * and not in a comment is done by taking the LAST 不等於 before the statement ends,
 * which is the one in the string literal — a comment above the code would not be. */
const capStart = page.indexOf("el('sp-plot-alt').innerHTML");
const capEnd = page.indexOf('function storedRow', capStart);
const cap = page.slice(capStart, capEnd);
/* Strip the block comment inside the statement before looking for the words, which is
 * what makes this 「in the caption」 rather than 「near the caption」: without the strip the
 * docblock I wrote to explain the move satisfies the check on its own, which is the
 * §3.G shape where the explanation explains the assertion instead of the code. */
const capCode = cap.replace(/\/\*[\s\S]*?\*\//g, '');
ok(capStart > 0 && /不等於/.test(capCode) && /整段算好了/.test(capCode) && /<br>/.test(capCode),
  'and it is said in the plot caption the canvas describes itself with, so it is the plot\'s alt text and not a source comment');

/* Every intro paragraph opens with a bolded lead-in naming what it is about, so a
 * reader who skims gets labelled claims instead of undifferentiated blocks.
 *
 * `>= 3`, not `>= 4` and not a fixed count, because the count is now a CONSEQUENCE rather
 * than a target. The intro was four paragraphs until the reveal disclosure moved to the
 * plot's caption, so it is three; a fourth about the picture would make this four, and a
 * hardcoded 4 would then fail on a copy change that broke nothing. The invariant worth
 * guarding is that NO paragraph is unlabelled, and the per-paragraph half is what enforces
 * it — the count is printed so a change in it is visible rather than silent.
 *
 * The lead-in is matched as an ELEMENT, not as text. One of them wraps `cries.html`,
 * so a `[^<]*` body matches three of the four and silently skips the fourth — which is
 * the §3.G shape: the assertion that reads like the guard is not the guard. The
 * tempered token refuses to cross a `</strong>`, so "some strong tag somewhere in the
 * paragraph ends in a full stop" cannot be satisfied by the wrong one, and
 * `startsWith` is what makes the claim `OPENS WITH` rather than `contains`.
 *
 * Each paragraph's INNER content is captured rather than the markup being split on
 * `</p>`. Splitting leaves the `<h1>` glued to the front of the first chunk, so the
 * chunk that actually opens with a lead-in is the one that appears not to — and the
 * `<p>`-stripping written to correct that then has to know about the heading too. */
const introParas = [...((page.match(/<div class="sp-intro-body">[\s\S]*?<\/div>/) || [, ''])[0]
  .matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g))].map(m => m[1].trim());
ok(introParas.length >= 3 && introParas.every(t =>
  t.startsWith('<strong>') && /<strong>(?:(?!<\/strong>)[\s\S])*?。<\/strong>/.test(t)),
  `all ${introParas.length} intro paragraphs OPEN WITH a bolded lead-in ending in a full stop, so they can be skimmed as claims`);

/* THE TWO DISCLOSURES COLLAPSE, and a shape check cannot see this.
 *
 * Styling the paragraphs inside a `<details>` at all is enough to break it: the browser
 * hides collapsed content with the UA rule `details:not([open]) > *:not(summary) { display:
 * none }`, and ANY class selector on the same element outranks it. So a rule as ordinary as
 * `.sp-about-why > p { margin: … }` left both disclosures permanently expanded — `open ===
 * false` in the DOM while every paragraph still rendered with a client rect. No static check
 * sees it, because the markup is correct; the defect is entirely in the cascade.
 *
 * `content-visibility: hidden` restores it, with `:not([open])` so it stops applying the
 * moment the disclosure opens. Asserted on BOTH halves: that the rule exists, and that it
 * is scoped to the collapsed state — an unconditional one would re-hide what the reader just
 * asked for, which is the second half of the same trap.
 *
 * And asserted that the disclosures are the split they claim to be, with the peak/rms one
 * named first, because peak and rms are two of the nine numbers ON SCREEN: a reader who
 * cannot compare them is being misled about something in front of them, which is a
 * different thing from `0.97` pre-emphasis changing no reading of the picture at all. */
ok(/\.sp-about-why:not\(\[open\]\) > p[\s\S]{0,90}content-visibility:\s*hidden/.test(css),
  'a collapsed sp-about disclosure hides its content — without this the UA display:none is outranked by any class selector and the control never collapses');
/* The negative half, and it is written against the DECLARATION rather than with a
 * loose regex over the stylesheet.
 *
 * The first version looked for any `.sp-about-why > p` rule whose body mentioned
 * content-visibility, within four characters of a closing brace. Dropping the
 * `:not([open])` from the real rule left the file with the declaration still present
 * inside a `.sp-about-why > p` block, so the pattern matched and the assertion passed —
 * which is §4's rule about an assertion that reads like the guard and is not one.
 *
 * This reads the rule that actually carries the declaration and asks whether its own
 * selector is scoped to the collapsed state. A second, differently-scoped rule cannot
 * satisfy it, because there is only one declaration in the file and it has one selector. */
const cvCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
const cvRules = [...cvCss.matchAll(/([^{}]+)\{[^{}]*content-visibility:\s*hidden[^{}]*\}/g)]
  .map((m) => m[1].trim());
ok(cvRules.length > 0 && cvRules.every((sel) => /:not\(\[open\]\)/.test(sel)),
  'and the declaration carrying it is scoped to :not([open]), because an unconditional one would hide the content again'
  + ` the moment the reader opened it (${cvRules.length} rule(s) carry it: ${cvRules.join(' / ') || 'none'})`);
eq((page.match(/<details class="sp-about-why">/g) || []).length, 2,
  'the displaced engineering detail sits behind exactly two disclosures');
ok(/<summary>為什麼 peak 和 RMS 不能直接對比？<\/summary>/.test(page)
  && /<summary>完整的計算細節<\/summary>/.test(page),
  "the peak/rms caveat first — those are two of the nine numbers the page shows, so it is a reader's caveat and not engineering detail");

/* NO em-dashes in the intro, and the floor is 0 rather than 1 because the appositive that
 * used to be there left with the reveal paragraph.
 *
 * `impeccable detect` fired `em-dash-overuse` at 8+ in this block, and a rewrite was what
 * put it there — every paragraph had come to pivot on `——`, which is the exact cadence
 * tic that rule describes. It is kept as an assertion rather than left as advice because a
 * shape check CAN measure it, and the count is a property of the copy, not the DOM.
 *
 * The last survivor was 音訊時鐘——那是同一組像素, in the paragraph that moved to the
 * caption, where it is now part of the sentence that says what the reveal actually is.
 * were replaced were decoration (P1), a full stop that had been flattened into a dash
 * (P2), and another full stop (P3) — so the floor is not zero, and a future paragraph
 * that needs a dash still has room. */
const introDashes = (introParas.join('\n').match(/—|--/g) || []).length;
ok(introDashes === 0,
  `the intro uses no em-dashes at all (${introDashes} found), because every paragraph pivoting on —— is what tripped em-dash-overuse, and the one appositive that was left went to the caption with the paragraph it belonged to`);

/* The page's own copy must not claim precision the page's own table disproves.
 *
 * §3.B1's rule, and it was nearly broken by an editor: a rewrite of this intro
 * proposed 「瀏覽器端零近似值運算」 and 「並非粗略的近似值」 as a headline, directly above
 * the 對表 that prints 31.4% / 27.5% / 29.3% disagreement on three of its five compared
 * features. A reader who scrolls finds the page contradicting its own subtitle, so the
 * superlative is banned by name rather than trusted to taste. 「完全相同」 is fine and is
 * asserted to still be there: it describes the PIPELINE, which is literally the same
 * code, and that is what the port checker proves. */
ok(!/(零近似|毫無近似|絕非近似|並非.{0,4}近似值)/.test(page),
  'the page never claims its browser figures are approximation-free — its own 對表 measures 27-31% disagreement on three of five features');

/* The disclosure is SPLIT across two places now, and the assertion is split with it.
 *
 * The canvas caption carries the AnalyserNode detail and 「不是同一組參數」 because it is
 * the canvas's `aria-describedby` — a screen reader gets the contrast at the moment the
 * drawing is announced. The `sp-about` parameter column carries its own copy because that
 * is where a reader goes looking for these numbers.
 *
 * So `.test(page)` on either string alone is satisfied while the OTHER half is deleted,
 * and the mutation case that flips one copy finds the other and passes — which is exactly
 * what happened: `replaceOrThrow` takes the first occurrence, and the case reported 「the
 * checker still passed」 while the caption was the thing that had been edited. Asserting
 * a COUNT is what makes the claim hold: the claim is that a reader meets it whichever of the
 * two they read, and deleting one copy must fail. */
const notSameParams = (page.match(/不是同一組參數/g) || []).length;
eq(notSameParams, 2,
  'the live curve says it is a SECOND measurement, in BOTH places a reader can meet it —'
  + ` the canvas caption and the parameter column (${notSameParams} occurrences, and either one alone can be deleted)`);
ok(/即時譜|這是第二次量測/.test(page) && /AnalyserNode/.test(page),
  'and the caption that the canvas describes itself with carries the AnalyserNode detail');

ok(/解碼器不同/.test(page) && /取樣率被改過/.test(page) && /兩個 bug/.test(page),
  'the cross-check panel gives all three causes of the difference between the two implementations');

for (const name of ['peak', 'rms', 'm0']) {
  ok(new RegExp(`${name}[、\\s]`).test(page) || page.includes(`>${name}<`),
    `the panel names ${name} among the features it does not compare`);
}

ok(/0\.002 附近/.test(page) && /相對差會在幾乎是零的數字上報出巨大的分歧/.test(page),
  'and says why a relative difference is not reported for the other 29: the stored values sit near 0.002');

ok(/瀏覽器拿不到/.test(page) && /檔案的原始取樣率/.test(page),
  'and states plainly that a browser is never told the file\'s true sample rate, which is why peak and rms are out');

// ---------------------------------------------------------------------------
// 5. The stylesheet owns nothing but `sp-`.
// ---------------------------------------------------------------------------

/* Comments stripped first, because the stylesheet's own header names `colors.css`,
 * `cries.css` and `shared.css` — and a checker that reads those as borrowed classes
 * is measuring the documentation. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const cssSelectors = [...cssCode.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
const classes = new Set();
for (const sel of cssSelectors) {
  for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(m[1]);
}
/* `.header` is shared.css's, and writing `.sp-header` here would be a bug: the
 * markup in the page carries `class="header"`, so renaming the selector would
 * silently stop the whole header block from matching. Shared tokens are used, never
 * redefined — which is what the second half of this assertion checks.
 *
 * `is-*` state modifiers are allowed, and the project already has the precedent:
 * `cries.css` ships `.cy-chip.is-warning`. The rule those follow is that a state
 * modifier is never a selector on its own — it is always compounded with a prefixed
 * block class, so it cannot address anything outside this page's vocabulary. The
 * assertion below is the check that they are, so the exemption cannot become a
 * hiding place for a second unprefixed name. */
const SHARED = new Set(['header']);
const isState = (c) => /^is-[a-z0-9-]+$/.test(c);
const foreign = [...classes].filter((c) => !c.startsWith('sp-') && !SHARED.has(c) && !isState(c));
eq(foreign, [],
  `every class in spectrum.css is sp-prefixed, a shared token, or an is-* state modifier`
  + ` (${classes.size} classes)`);

/* The exemption's price, paid here: an `is-*` selector in this stylesheet must be
 * used ONLY compounded with an `sp-` class in the page, or it is just an unprefixed
 * name that escaped. `.sp-numbers.is-loading` passes; a bare `.is-loading` would not. */
for (const state of [...classes].filter(isState)) {
  const bare = new RegExp(`\\.(?:[a-z]+ )?${state}\\b(?!\\S)`).test(cssCode);
  const compounded = new RegExp(`\\.sp-[a-z0-9-]+\\.${state}\\b`).test(cssCode);
  ok(!bare || compounded,
    `${state} is only ever selected compounded with an sp- class, so it cannot address another page's state`);
}

const redefinesShared = [...cssCode.matchAll(/^\.(header|site-nav|theme-toggle|nav-toggle)\s*\{/gm)];
eq(redefinesShared.map((m) => m[1]), [],
  'and shared.css\'s own classes are never redefined here, only used as a qualifier');

/* ---------------------------------------------------------------------------
   5b. THE OTHER HALF OF THE SAME CLAIM — AND THE ONE THAT HAD NO ASSERTION
   ---------------------------------------------------------------------------
   Everything above reads the STYLESHEET and asks whether the things in it are
   allowed. This reads the PAGE and asks whether the things in it are STYLED.

   The difference is not tidiness. A previous edit to this page replaced
   spectrum.css's whole "Controls" section with a comment saying the rules were
   "kept for reference", and did not keep it: fifteen selectors went with it —
   `.sp-label .sp-sources .sp-source .sp-search .sp-btn .sp-chips .sp-chip
   .sp-actions .sp-status .sp-autoplay{,-track,-text} .sp-hero .sp-hero-head
   .sp-hero-id` — so the source radios, the search box, the 24 chips, the play
   button and the autoplay switch all rendered on browser defaults.

   Two of that list are gone again for a different reason, and the distinction is
   why the class audit is not "every class ever written must have a rule": `.sp-hero-id`
   went with the 28px identity strip, and `.sp-hero-head` went when its last child moved
   out — it held exactly one element, this section's `<h2>`, inside a `display: flex`
   with a `gap`, which renders identically to no wrapper and cannot be told apart from
   one in review. A wrapper with a single child is a container nothing can be put into
   yet, and leaving it is how the next person puts something in it.


   Nothing went red. Not this file's 87 checks, not the 43 in
   `check_spectrum_browser.mjs`, not a single assertion anywhere in the project.
   The reason is precisely the claim above: "every class in spectrum.css is
   sp-prefixed" is satisfied by a stylesheet containing NO control rules at all,
   because the set it measures is the set of classes that EXIST. A rule that
   cannot see an absence is the §4 failure shape, and it is invisible from the
   inside — the assertion looks like the guard.

   So: every class the page puts on the DOM must resolve to a rule. Non-`sp-`
   names are the two other owners' — derived, not listed, because a hand-kept
   allowlist is a second copy of the truth that rots the first time someone adds a
   shared class. The autoplay family is derived from the PREFIX the page asks
   `mountAutoplay` for, because `cry-autoplay.js` builds those three node names at
   runtime and no amount of reading the markup will find them. */
const markup = page.slice(0, page.indexOf('<script type="module">'))
  .replace(/<!--[\s\S]*?-->/g, '');
const script = page.slice(page.indexOf('<script type="module">'));

const markupClasses = new Set();
for (const m of markup.matchAll(/class="([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) markupClasses.add(c);
}
/* Class names the script ASSIGNS, which never appear in the markup at all. */
for (const m of script.matchAll(/\.className\s*=\s*'([^']+)'/g)) markupClasses.add(m[1]);
for (const m of script.matchAll(/class="(sp-[^"]*)"/g)) markupClasses.add(m[1]);

/* The autoplay switch's three node names, read out of the prefix the page passes
   rather than written down — the same reasoning as reading the six header modifier
   names out of shared.css instead of restating them. */
const autoplayPrefix = page.match(/className: '(sp-[a-z-]+)'/)?.[1];
ok(Boolean(autoplayPrefix),
  'the autoplay switch is mounted with a `sp-` prefix the class audit can read, not a literal the stylesheet has to be told about separately');
const runtimeClasses = autoplayPrefix
  ? new Set([autoplayPrefix, `${autoplayPrefix}-track`, `${autoplayPrefix}-text`])
  : new Set();

/* SCOPED TO `sp-`, and the scoping is the point rather than a convenience.
 *
 *  The subject is the classes THIS PAGE owns. Auditing every class in the markup
 *  drags in the site's chrome — and the first thing it found was `.site-footer`,
 *  which is styled in NO stylesheet in the project and is used by `cries.html`
 *  too. That is a real orphan and a real fact, but it is pre-existing and
 *  site-wide, and asserting it here would make this file the owner of every page's
 *  footer while nothing anywhere fixes it. Naming it instead of allowlisting it is
 *  the honest form: a fact written down is one a reader can act on, and a fact in
 *  a Set is one they cannot see. */
ok(!/class="[^"]*\b(?:cy|cp|cg)-/.test(markup) && !/className = '(?:cy|cp|cg)-/.test(script),
  'the page uses no `cy-`, `cp-` or `cg-` class — those belong to cries.css and the colour pages, and borrowing one is a stylesheet-order collision waiting to happen');

const ownUnstyled = [...markupClasses]
  .filter((c) => c.startsWith('sp-'))
  .filter((c) => !classes.has(c))
  .filter((c) => !runtimeClasses.has(c))
  .sort();
eq(ownUnstyled, [],
  `every sp- class the page puts on the DOM resolves to a rule in spectrum.css`
  + ` (${markupClasses.size} classes in the markup, ${runtimeClasses.size} of them built at runtime by cry-autoplay.js)`);

/* And the direction section 5 already covers, stated as the same sentence so a
   reader scanning the output sees both halves of one claim rather than a rule
   about the stylesheet and then a hole where the page should have been. */
const unused = [...classes]
  .filter((c) => c.startsWith('sp-'))
  .filter((c) => !markupClasses.has(c) && !runtimeClasses.has(c))
  .sort();
eq(unused, [],
  'and no sp- rule in spectrum.css is dead — the two halves together are the claim, not the half that cannot fail');

ok(/linear-gradient\(to right,\s*var\(--sp-0\), var\(--sp-1\), var\(--sp-2\), var\(--sp-3\), var\(--sp-4\), var\(--sp-5\)\)/.test(css.replace(/\s+/g, ' ')),
  'the legend gradient is built from the same six custom properties the script reads, so a legend cannot drift from the picture');

ok(/getPropertyValue\(`--sp-\$\{i\}`\)/.test(page),
  'and the script reads those six rather than carrying its own copy');

/* The allowlist is four colours and each has a reason. The first two are the
 * theme-color meta tag, which is set before first paint and cannot read a custom
 * property. The second two are the fallbacks the ramp reader uses when
 * getPropertyValue comes back empty, which it does under a stylesheet that has not
 * loaded — and a fallback of black would render a spectrogram, so it has to be a
 * colour. The next three are the plot's own ground, ink and muted label, used the
 * same way on the two canvases. Anything ELSE is a stop nobody declared. */
const RAMP_FALLBACKS = ['#f4f6fa', '#0d1117', '#000000', '#fbe28d', '#07050e', '#f2f4f8', '#9aa3b2'];
eq((page.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter((h) => !RAMP_FALLBACKS.includes(h.toLowerCase())),
  [],
  `the page carries no ramp colour outside the four with a stated reason (${RAMP_FALLBACKS.join(' ')})`);

// ---------------------------------------------------------------------------
// 5b. The live curve's ink — a real measurement, run over all 1,025 records.
// ---------------------------------------------------------------------------

/* THE FUNCTION IS LIFTED OUT OF ITS FILE AND RUN, rather than its source shape
 * checked, because this is arithmetic and arithmetic is the kind of claim this project
 * does not accept on trust. `speciesInk` is lifted for the reason §3.B1 gives for
 * `check_color_match.mjs`: a regex over the same lines passes for any mutation that
 * leaves the substrings in place — deleting the loop, inverting the comparison, or
 * lifting toward black instead of white all leave `t += 0.02` sitting right where it
 * was.
 *
 * `contrast` is passed IN rather than imported by the module, precisely so this works:
 * the lifted body has no module graph, and if the module imported `shared.js` the
 * checker would have to build one or reimplement luminance — and reimplementing it is
 * how the 0.03928 / 0.04045 breakpoint disagreement gets in. */
const rampSrc = read('assets/js/species-ramp.js');
ok(/export function speciesInk\(rgb, ground, contrast, min = 3\)/.test(rampSrc),
  'species-ramp.js exports speciesInk(rgb, ground, contrast, min) — contrast as a PARAMETER, so the lift is runnable outside a browser');
ok(!/^import /m.test(rampSrc),
  'and the module imports nothing at all: an import would make the function impossible to lift and run against the real corpus');

/* The WHOLE FILE is evaluated, not just the exported function, because the function has
 * a module-level helper (`clamp255`) and lifting only the export throws
 * `clamp255 is not defined` — which is a loud failure, but a copy of the declaration
 * here would be a second copy to keep right. This only works because the assertion
 * above establishes the module imports nothing, so its whole text is evaluable. */
const speciesInk = new Function(`${rampSrc.replace(/^export /gm, '')}\nreturn speciesInk;`)();

/* `shared.js`'s OWN WCAG ratio — LIFTED FROM ITS TEXT, not imported.
 *
 * `await import()` was the first attempt and it is wrong for two reasons, both found by
 * `--prove-inputs`. Executing `shared.js` runs its module body, which reads
 * `form-names.js`, `form-names-zh.js` and `shiny-index.js` at import time — three files
 * the manifest would then have to declare for a checker that wants two arithmetic
 * functions — and it does all of that to compute a ratio that is four lines long.
 *
 * Lifting the three contiguous declarations instead means the checker depends on
 * shared.js's TEXT and on nothing else, which is the same bargain `cry-spectrogram.js`
 * makes for the reason its own checks record: a module that imports nothing can be
 * lifted and run, and a module that imports something has to be executed. The lift is
 * not a copy to keep right — it is shared.js's own source, evaluated in place, so the
 * 0.03928 breakpoint that `shared.js:251` documents keeping on purpose is the one that
 * produced every figure in AGENTS.md. A restated 0.04045 luminance would disagree with
 * all of them, and the disagreement would live in the one function whose whole job is
 * a threshold.
 *
 * The three are taken as ONE span because they are contiguous and depend on each other:
 * `contrast` closes over `luminance`, which closes over `toLinear`. Lifting `contrast`
 * alone would throw on an undefined identifier. */
const sharedSrc = read('assets/js/shared.js');
const wcagSpan = sharedSrc.match(
  /const toLinear = v => \{[\s\S]*?export const contrast = \(a, b\) => \{[\s\S]*?\n\};\n/,
);
ok(!!wcagSpan,
  'shared.js\'s own toLinear + luminance + contrast are three contiguous declarations, and this lift found them');
/* The lift RETURNS the function, so it is assigned rather than destructured — the
 * `{ contrast: wcag } =` form that worked with `await import()` reads a property off a
 * module namespace object, and a bare function has none, so `wcag` came out undefined
 * and every record reported "no colour to draw". */
const wcag = new Function(`${wcagSpan[0].replace('export const', 'const')}\nreturn contrast;`)();

/* The ground is read out of the stylesheet, not written here. `--sp-plot-bg` is
 * declared once in `:root` and not overridden per theme, so there is exactly one
 * ground — and a checker that hardcoded it would be asserting a value the stylesheet
 * owns, which is the direction the sixth section above already fails. */
const groundHex = (css.match(/--sp-plot-bg:\s*(#[0-9a-fA-F]{6})/) || [, ''])[1];
const ground = [1, 3, 5].map((i) => parseInt(groundHex.slice(i, i + 2), 16));
ok(groundHex !== '', `the plot ground is read from spectrum.css rather than restated (${groundHex})`);

const INK_FLOOR = 3;
const hueOf = (rgb) => {
  const mx = Math.max(...rgb), mn = Math.min(...rgb);
  if (mx === mn) return null;
  const d = mx - mn;
  const h = mx === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6
    : mx === rgb[1] ? (rgb[2] - rgb[0]) / d + 2
    : (rgb[0] - rgb[1]) / d + 4;
  return h * 60;
};
const sweep = pokemon.filter((p) => p.id <= 1025).map((p) => {
  const ink = speciesInk(p.rgb, ground, wcag, INK_FLOOR);
  const c0 = hueOf(p.rgb), c1 = ink && hueOf(ink);
  const drift = c0 === null || c1 === null ? 0
    : Math.min(Math.abs(c1 - c0), 360 - Math.abs(c1 - c0));
  return { id: p.id, zh: p.names.zh, rgb: p.rgb, ink, ratio: ink ? wcag(ink, ground) : 0, drift };
});

/* The whole claim, on all 1,025. 6.6% of species are below the floor before lifting
 * and NONE after, and that is the assertion — not 「the function exists」 and not 「one
 * species was checked」, both of which pass on a lift that does nothing. */
eq(sweep.filter((s) => s.ink === null).length, 0,
  'speciesInk returns a colour for all 1,025 records — none is left with nothing to draw');
const below = sweep.filter((s) => s.ratio < INK_FLOOR);
eq(below.length, 0,
  `and every one of the ${sweep.length} lands at or above ${INK_FLOOR}:1 against the plot ground (worst ${Math.min(...sweep.map((s) => s.ratio)).toFixed(3)}:1)`);
eq(sweep.filter((s) => s.ink && JSON.stringify(s.ink) === JSON.stringify(s.rgb)).length, 957,
  '957 of them pass through BYTE FOR BYTE, because a species already legible must keep its exact stored colour');

/* The lift is the point, so its cost is measured rather than assumed: 68 records change
 * at all, and the largest hue movement among them is 8°. A floor that rescued visibility
 * by destroying the colour would satisfy the contrast assertion above perfectly. */
const lifted = sweep.filter((s) => s.ink && JSON.stringify(s.ink) !== JSON.stringify(s.rgb));
eq(lifted.length, 68,
  `and the other 68 are lifted — measured, not a constant: ${lifted.length} records fall below ${INK_FLOOR}:1 as stored`);
ok(Math.max(...lifted.map((s) => s.drift)) <= 12,
  `by no more than 12° of hue, so the curve still reads as that Pokémon (worst ${Math.max(...lifted.map((s) => s.drift)).toFixed(1)}°)`);

/* AND A SECOND CEILING, ON BRIGHTNESS, because the hue one has a hole in it exactly
 * where the problem is worst.
 *
 * `hueOf()` returns null for a colour whose channels are equal, and this page's lifted
 * records are largely greys — 大炭車, 捷克羅姆, 薩戮德, 巨炭山 are the four worst in the
 * corpus and every one of them is a desaturation, not a darkness. So the hue assertion
 * above measures 0° for all of them and a lift that destroyed their colour would sail
 * through it. That is the §3.B2 shape again in a new place: the detector skips exactly
 * the population the defect is concentrated in.
 *
 * Relative luminance is already in hand because `contrast` was lifted from shared.js,
 * and it does not care whether a colour has a hue. Measured: the real 2% lift gains at
 * most x3.2 with a median of x1.26, while lifting to the first step that clears with a
 * 0.34 stride gains x5.5 and removing the `break` entirely sends all 68 to pure white
 * for a gain around x30. A ceiling of x4 has room over the real figure and catches both.
 *
 * The floor assertion above passes on every one of those too — 1,025 colours clearing
 * 3:1 is the claim's ABSENCE wearing its shape, and only a ceiling on cost can tell a
 * rescue from a repaint. */
const lumOf = (rgb) => {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
};
const gains = lifted.map((s) => lumOf(s.ink) / Math.max(lumOf(s.rgb), 1e-9));
ok(Math.max(...gains) <= 4,
  `and by at most x4 in relative luminance, which is the ceiling that covers the 68 GREY records the hue check cannot see (worst x${Math.max(...gains).toFixed(1)}, median x${gains.slice().sort((a, b) => a - b)[gains.length >> 1].toFixed(2)})`);

/* THE FLOOR IS ABOUT GRAPHICAL OBJECTS, NOT TEXT, and the number is written down
 * because the alternative was picked without one. 3:1 is WCAG 1.4.11's figure for a
 * graphical object, and this curve's meaning is carried by its SHAPE — the colour is
 * identity. 4.5:1 would be the bar for text and would lift 273 records instead of 68,
 * moving the median species further from its own colour for a distinction no reader is
 * being asked to make. */
ok(/graphical|SC 1\.4\.11|3:1/.test(rampSrc) && /INK_FLOOR = 3/.test(page + rampSrc + read('scripts/check_spectrum_page.mjs')),
  'the 3:1 floor is the WCAG graphical-object figure and is stated as such, rather than a round number that looked fine');

/* The page's own copy must not promise what the arithmetic delivers — §3.B1. The
 * caption is this canvas's `aria-describedby`, so it is also the alt text, and it now
 * carries the measured figures (68 of 1,025; 1.63:1) rather than a reassurance. */
ok(/線條與填色是這一隻寶可夢自己的顏色/.test(page) && /68/.test(page) && /1\.63:1/.test(page),
  'the live curve\'s caption says the line is this species\'s own colour AND quotes the measured floor it had to be lifted past');
ok(/顏色是身分，不是數值/.test(page),
  'and says the colour is identity rather than a value, because a reader looking at a tinted curve will otherwise read the tint as a measurement');

/* It is drawn from `state`, resolved once per species — NOT per frame. `drawLive()`
 * runs on every animation frame while audio plays, and this is the §3.G shape read in
 * the other direction: a field written on selection and read sixty times a second is
 * correct, and the same expression inlined into the frame loop is a per-frame cost for
 * a value that only changes when the reader picks a different Pokémon. */
ok(/state\.liveInk = speciesInk\(/.test(page),
  'the ink is resolved in select() and stored on state, so the 60fps drawLive() never recomputes it');
ok(/const ink = state\.liveInk/.test(page) && !/ctx\.strokeStyle = topInk\(\)/.test(page),
  'and drawLive() reads that state rather than the ramp\'s constant top colour');
ok(/speciesInk\(meta\?\.rgb/.test(page) && /state\.plotGround = hexToRgb\(/.test(page),
  'the ink comes from the species record\'s own rgb, measured against the ground as read from CSS — so neither is a constant in the page');

/* The page STATES the ink it is about to draw, in `data-ink`, and the browser checker
 * measures the canvas against that statement.
 *
 * Asserted here as well, because that statement is load-bearing for a check living in
 * another file that opens no repo file: if the page stops writing it, `CANVAS_INK`
 * returns `{ error: 'no data-ink' }`, one assertion fails, and the other seven in that
 * block go on passing against a stale attribute. The value also has to come from the
 * SAME state field `drawLive()` reads — otherwise the browser ends up checking the
 * canvas against a reference that no longer describes it, which passes exactly when the
 * page draws the wrong colour and states the right one.
 *
 * And it is written once per selection rather than per frame: `drawLive()` runs at
 * 60fps, and a data attribute nothing reads in the browser is a write per frame of
 * nothing. The second assertion below is the one that catches it moving. */
ok(/dataset\.ink = state\.liveInk \? `rgb\(\$\{state\.liveInk\.join\(','\)\}\)` : ''/.test(page),
  'the page publishes the ink it is about to draw as data-ink, taken from the same state field drawLive() reads');
const frameBody = page.slice(page.indexOf('function drawLive()'), page.indexOf('function drawLive()') + 4000);
ok(!/dataset\.ink/.test(frameBody),
  'and it is written once per selection, not inside the 60fps frame path');
ok(/state\.liveInk\s*\n\s*\/\*|state\.liveInk = speciesInk/.test(page)
  && /state\.liveInk/.test(page.slice(page.indexOf('function drawLive()'))),
  'while drawLive() does read state.liveInk, so the attribute and the pixels come from one value');



for (const [name, re] of [
  ['decoded()', /^ {2}(?:async )?decoded\(/m],
  ['playSamples()', /^ {2}async playSamples\(/m],
  ['spectrum()', /^ {2}spectrum\(/m],
]) {
  ok(re.test(player), `cry-player.js exposes ${name}`);
}

ok(/#gain\.connect\(this\.#analyser\)/.test(player),
  'the spectrum tap hangs off the shared GAIN node, so a mute silences the measurement too');

ok(/getFloatFrequencyData\(this\.#bins\)/.test(player),
  'and it reads the live AudioParam-style data every call rather than recording a value at install time');

ok(/createBuffer\(1, samples\.length, sampleRate\)/.test(player) && /sampleRate \/ 2/.test(player),
  'playSamples has the 65,536 Hz decimation fallback, because that allocation is what browsers refuse');

/* The STRUCTURAL form of "one AudioContext", and the negative suite is what found
 * the gap: asserting that the page MENTIONS `playSamples` passed a page that opened
 * its own AudioContext and then called playSamples anyway. What actually matters is
 * that the page never builds an audio graph of its own — no `new AudioContext`, no
 * `createBufferSource`. Both strings are code-shaped and neither appears in the
 * prose, which discusses what `decodeAudioData` does to the sample rate without
 * containing either of them. */
ok(/cryPlayer\.playSamples\(/.test(page),
  'and spectrum.html plays the synthesised cry through cryPlayer.playSamples');
ok(!/new AudioContext\(/.test(page) && !/createBufferSource\(/.test(page),
  'and never builds an audio graph of its own — one AudioContext, one clock, one gain');

/* THE LIVE CURVE'S AXIS IS FIXED, and this is the assertion that says so.
 *
 * The first version fitted the axis to the data — ceiling at the current maximum,
 * floor 70 dB under it — and the curve looked frozen. Measured on `latest/25.ogg`
 * at the player's default 3/15 level: the 26 band maxima all landed between -47 and
 * -62 dB, a 15 dB spread, inside a 23 dB axis. The whole spectrum was a near-flat
 * ribbon across the top third of the canvas and the frame-to-frame motion was a
 * couple of pixels. Nothing was wrong with the audio and nothing was wrong with the
 * RAF loop; the axis had eaten the movement, and no ink-based check can see that,
 * because a static ribbon and a moving one are the same set of pixels to any
 * "is anything drawn" test.
 *
 * So the axis is the analyser's OWN declared range, read as constants rather than
 * measured, and it is drawn with labelled gridlines. The alternative — auto-ranging
 * so the loudest band always touches the top — would make the curve move even when
 * the spectrum is perfectly static, and motion that is not the audio is worse than
 * no motion. `check_spectrum_browser.mjs` covers the other half: that the canvas
 * actually changes while audio plays.
 *
 * THE TWO NUMBERS ARE READ OUT OF cry-player.js, NOT RESTATED. The original version
 * of this check was two literals — `/const CEIL_DB = -10;/` and
 * `/const FLOOR_DB = -100;/` — so it asserted that the page's SOURCE SPELLED a
 * number the page does not have to spell. Renaming the constants (they were a local
 * `FLOOR_DB` shadowing the offline grid's unrelated `FLOOR_DB = 60`, §3.B1) turned it
 * red without anything about the measurement changing: a shape check reading like the
 * guard and not being it, the exact thing this file's own §3.G1a section is about.
 *
 * And the comparison cannot be allowed to go vacuous in the other direction. If
 * `signedProp()` returns null on both sides, `[null, null] === [null, null]` and the
 * check passes having measured nothing — so the non-null assertion below is not
 * belt-and-braces, it is the half that makes the first half mean anything.
 */
const signedProp = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(-?\\d+)`));
  return m ? Number(m[1]) : null;
};
const analyserRange = [signedProp(player, 'minDecibels'), signedProp(player, 'maxDecibels')];
const liveRange = [signedProp(page, 'LIVE_MIN_DB'), signedProp(page, 'LIVE_MAX_DB')];

ok(analyserRange.every(Number.isFinite) && liveRange.every(Number.isFinite),
  `both the analyser's declared dB window and the page's copy of it are readable — a rename on either side must fail LOUDLY, because two unparsed nulls compare equal and this check would pass having measured nothing (analyser ${JSON.stringify(analyserRange)}, page ${JSON.stringify(liveRange)})`);

eq(liveRange, analyserRange,
  "the live curve's dB axis is the analyser's OWN declared bounds, compared rather than restated — a different window here compresses or clips every value `drawLive()` reads without making any drawn pixel obviously wrong");

/* Scoped to `drawLive`, and the scoping is the point. `drawPlot` computes a `span`
 * from the data and MUST: the spectrogram's floor is deliberately per-cry relative
 * ("0 dB is this cry's own loudest mel band") and the page says so next to the
 * legend. A whole-page search for a fitted span would flag the one place a fitted
 * span is correct, which is the same mistake as searching for `const scale` when
 * only one of the two implementations is allowed to have it.
 *
 * Sliced to the NEXT function, not to `drawPlot` — `drawPlot` is declared first in
 * the file, so slicing "from drawLive to drawPlot" is a negative range and quietly
 * yields an empty string, against which every assertion below passes. */
const liveStart = page.indexOf('function drawLive()');
const liveEnd = page.indexOf('\n    function ', liveStart + 1);
const drawLive = page.slice(liveStart, liveEnd === -1 ? page.length : liveEnd);
ok(drawLive.length > 1000 && /for \(let db = 0/.test(drawLive),
  `the live-curve slice is drawLive's own body, not an empty string (${drawLive.length} chars)`);

ok(!/const span =/.test(drawLive) && !/Math\.max\(hi,\s*FLOOR\)\s*-\s*FLOOR/.test(drawLive),
  'and drawLive never rescales the axis to the data — an auto-ranging axis would move when the audio is static');

/* THE SPRITE'S PULSE, and this is where the shadowing gets its regression check.
 *
 * `drawLive()` used to declare `const CEIL_DB = -10; const FLOOR_DB = -100;` LOCALLY,
 * shadowing the module-level `FLOOR_DB = 60` that the offline grid needs — two
 * quantities under one name, in one file, 470 lines apart. Nothing broke, because the
 * shadowed uses were all inside the function that declared them; §3.B1's shape is that
 * the next reader greps the name and gets the wrong one. The pair is now
 * `LIVE_MIN_DB` / `LIVE_MAX_DB` at module level, which is also what lets `paintSprite`
 * use the SAME window the curve was drawn against rather than a fourth copy of it.
 *
 * The slice is `drawLive`'s own body (sliced at the next `function`, per the note
 * above), so this assertion cannot be satisfied by a decoy declaration somewhere else
 * in the file — which is the failure mode the two-literal version of this check had.
 */
ok(!/\bconst (FLOOR_DB|CEIL_DB)\s*=/.test(drawLive),
  'drawLive() declares NO local FLOOR_DB or CEIL_DB — the offline grid\'s FLOOR_DB = 60 is a different quantity, and one name for both is §3.B1');

const paintStart = page.indexOf('function paintSprite(');
/* Bounded by the SECTION comment that follows it, not by the next function.
 *
 * The function-next boundary was tried first and is wrong here: `paintSprite` is the
 * last function before the `// Loading a cry` banner and there is no other
 * `function ` between them, so `indexOf` ran on to a function further down the file
 * and produced an 8,124-char slice that happens to pass every assertion in it. A
 * slice that wide is not a slice — it is the rest of the file, and an assertion
 * against it reads like it is scoped when it is not (§3.G). */
const paintEnd = page.indexOf('    // Loading a cry', paintStart);
const paintSprite = paintStart > 0
  ? page.slice(paintStart, paintEnd === -1 ? page.length : paintEnd)
  : '';
ok(paintStart > 0 && paintSprite.length > 400 && /img\.style\.transform/.test(paintSprite),
  `the sprite-pulse slice is paintSprite's own body, not an empty string (${paintSprite.length} chars)`);

ok(/reduced\(\)/.test(paintSprite) && /LIVE_MIN_DB/.test(paintSprite) && /LIVE_MAX_DB/.test(paintSprite),
  'the pulse is gated on prefers-reduced-motion and normalised by the SAME dB window the live curve is drawn against, so the sprite and the curve are one measurement');

/* TOTAL, NOT AN EXIT-PATH DUTY — `.of-readout`'s shape turned around.
 *
 * `paintSprite()` writes a transform on EVERY path including the silent one, so
 * "stopped but still enlarged" is a state the function cannot be left in. A checker
 * that only counted `paintSprite(null)` calls would be counting, not pairing — the
 * failure is a path that RESETS and one that SHOULD, so the two halves have to be
 * asserted against each other rather than separately.
 */
const resetWrites = (paintSprite.match(/img\.style\.transform/g) || []).length;
ok(resetWrites >= 2 && /loud <= 0 \|\| reduced\(\)[\s\S]*?transform = ''/.test(paintSprite),
  `paintSprite writes the transform on BOTH paths (${resetWrites} writes) — an early return above the write is how a stopped sprite stays enlarged`);

/* All four call sites, and each one is a DIFFERENT reason rather than four copies of
 * the same guard. `tick()` is the per-frame one; the two `paintSprite(null)` in
 * `toggle()` are the two exits out of playback (the reader's stop, and the
 * `finally` that also covers a failed play); `select()` is a species change, which
 * does NOT stop playback and so cannot rely on either of them. */
const tickBody = page.slice(page.indexOf('function tick('), page.indexOf('// Picker'));
const toggleBody = page.slice(page.indexOf('async function toggle()'), page.indexOf('function setPlayButton'));
ok(/paintSprite\(drawLive\(\)\)/.test(tickBody),
  'tick() feeds the frame\'s own peak to the sprite, so the pulse is driven by the same analyser read the curve is');
eq((toggleBody.match(/paintSprite\(null\)/g) || []).length, 2,
  'and BOTH exits out of playback reset it — the reader\'s stop AND the `finally` that covers a failed play');
ok(/drawPlot\(\);[\s\S]{0,600}?paintSprite\(drawLive\(\)\)/.test(page),
  'and a species change resets it too, because select() does not stop playback and therefore cannot rely on either exit above');

ok(/for \(let db = 0; db >= -100; db -= 20\)/.test(drawLive) && /fillText\(`\$\{db\}`/.test(drawLive),
  'and it is drawn with a labelled gridline every 20 dB, so the level is read rather than guessed');

ok(/最高 \$\{Math\.round\(hi\)\} dB/.test(drawLive),
  'and the peak is printed as a number, because the nearest gridline can be 10 dB away');

/* The 24 chips are the COVER roster, and the edition label is part of the answer.
 *
 * SCOPED TO THE `COVERS` LITERAL, and that scoping is the fix rather than a nicety.
 * This counted `/\[\d+, '…'\]/g` over the WHOLE file, which is the shape §4 calls out:
 * an assertion that reads like the guard and measures the page. The rail added
 * nine generation chips, and building them from `[1, '第 1 世代']`-shaped pairs —
 * the obvious way to write a `{value, label}` table — would have taken this count
 * to 25 and turned an honest red into an inexplicable one. Verified: one such
 * literal takes 24 to 25. Slicing to the array the assertion is actually about
 * makes it survive an unrelated table gaining a shape it shares. */
const coversStart = page.indexOf('const COVERS = [');
const coversEnd = page.indexOf('];', coversStart);
ok(coversStart > 0 && coversEnd > coversStart,
  `the COVERS literal is locatable, so the 24-pair assertion has something to slice (chars ${coversStart}..${coversEnd})`);
const coversBlock = coversStart > 0 && coversEnd > coversStart
  ? page.slice(coversStart, coversEnd)
  : '';
const coverPairs = (coversBlock.match(/\[\d+, '[^']+'\]/g) || []);
ok(coverPairs.length === 24,
  `the quick-pick grid is 24 [id, edition] pairs — ids and editions, never names (${coverPairs.length})`);

for (const [id, edition] of [[150, '關都 · 銀'], [384, '豐緣 · 綠寶石'], [890, '伽勒爾 · 劍／盾']]) {
  ok(coverPairs.includes(`[${id}, '${edition}']`),
    `and ${id} carries its edition 「${edition}」 — 383/382 and 888/889/890 are different species AND different games`);
}

ok(/setAttribute\('aria-label', `\$\{meta\?\.names\?\.zh \?\? id\}，\$\{edition\}`\)/.test(page),
  'and each chip names the SPECIES for a screen reader, not the game twenty-four times over');

ok(/decoded\(/.test(page),
  'while the recorded path shares the player\'s decode cache instead of fetching the file a second time');

/* A DECODE must not require a gesture, and this is the assertion that says so.
 *
 * `check_spectrum_browser.mjs` cannot catch it: that Chrome runs with
 * `--autoplay-policy=no-user-gesture-required`, so `ctx.resume()` always resolves
 * there and the page renders. Launch Chrome without that flag — which is what any
 * real visit is — and `decoded()` reached `#load`, which called `unlock()`, which
 * awaited a `resume()` no gesture had unblocked, and the page sat on 「計算中…」 for
 * ever. The hero is a pure computation and was gated behind an audio permission.
 *
 * The shape to assert is that `#load` creates the context without resuming it, so
 * this is a check on the source rather than on a number — and it is here because
 * the class of bug is §3.G's: a control that is wired and does nothing, where the
 * only symptom is a page that never finishes loading.
 */
const loadBody = player.slice(player.indexOf('#load(id, { legacy })'));
ok(/#ensureContext\(\)\.decodeAudioData/.test(loadBody)
  && !/this\.unlock\(\)\.then\(\(ctx\) => ctx\.decodeAudioData/.test(loadBody),
  'decoding does not require a user gesture: #load creates the AudioContext without resuming it');

ok(/#ensureContext\(\)\s*\{/.test(player) && /async unlock\(\)\s*\{[\s\S]{0,120}this\.#ensureContext\(\)/.test(player),
  'and `unlock()` is the only path that resumes, so playback still unblocks the clock first');

ok(/waveformPeaks\([\s\S]{0,200}?\{\s*const \{ buffer, error \} = await this\.#load/.test(player),
  'while `waveformPeaks`, which also only wants samples, no longer resumes either');

ok(/className: 'sp-autoplay'/.test(page)
  && /className = 'cy-autoplay'/.test(autoplay)
  && /className = className/.test(autoplay),
  'the autoplay switch is the shared module asked for this page\'s prefix, not a copy of it');

// ---------------------------------------------------------------------------
// 7. Provenance.
// ---------------------------------------------------------------------------

const features = readJson('assets/data/cry_features.json');
eq(features.sampleRate, jsN.SR,
  'the spectrogram runs at the rate cry_features.json was built at, so the two describe the same axis');

ok(/PokeAPI\/cries/.test(page) && /pret\/pokered/.test(page) && /analyze_cries\.py/.test(page),
  'the page names all three upstreams: the recordings, the ROM tables, and the analysis script');

ok(page.includes('assets/css/spectrum.css') && page.includes('assets/css/shared.css'),
  'and loads shared.css then its own stylesheet');

// ---------------------------------------------------------------------------
// 8. The three files the page reads at runtime, checked HERE rather than declared.
// ---------------------------------------------------------------------------

/* `--prove-inputs` reported `shared.js`, `gb-apu.js` and `gen1_cries.json` as declared
 * but unread, which is right: the page fetches them in the browser and this checker
 * only ever saw its own imports. Declaring an input nothing opens means an edit to it
 * will not invalidate this checker, so instead of deleting the three entries each one
 * became a claim — and each is a claim the page would otherwise make silently.
 */

const shared = read('assets/js/shared.js');
ok(/spectrum\.html/.test(shared) && /id: 'cries'/.test(shared),
  'NAV carries spectrum.html inside the 叫聲 group, so the page is reachable and marks itself current');

const gbau = read('assets/js/gb-apu.js');
const synthRate = Number(gbau.match(/export const SYNTH_RATE = (\d+);/)?.[1]);
eq(synthRate, 65536,
  'the synthesised cries arrive at 65,536 Hz, which is what makes the 65,536 Hz decimation fallback in the player necessary rather than defensive');

ok(/SYNTH_RATE/.test(page) && /renderSpeciesCry/.test(page),
  'and the page passes that rate through rather than assuming one');

const gen1 = readJson('assets/data/gen1_cries.json');
eq(gen1.cries.length, 151, 'the first-generation table is the 151 species the page offers as a third source');
ok(gen1.cries.every((c) => c.pitch !== undefined && c.length !== undefined),
  'and every row carries the two bytes renderSpeciesCry needs, so the third source cannot half-render');

// ---------------------------------------------------------------------------
// 9. The rail's SHAPE — the layout claims that are only in the markup
// ---------------------------------------------------------------------------

/* EVERY NON-VOID TAG BALANCES, and this is the assertion whose absence let a
 * two-column section render as four unrelated rows for as long as the section existed.
 *
 * `.sp-about` shipped with a `</div>` whose opening tag was missing. The stray marker
 * closed `.sp-page` instead, so `</section>` matched nothing, `.sp-about-live` fell out
 * of the page flow and became a direct child of `<main>`, and the section's 2-track
 * grid auto-placed its SEVEN unwrapped children into four rows: the heading stranded
 * alone in the wide track with a measured 130px of void under it, and its own first
 * paragraph rendering in the narrow track at 24 CJK characters a line.
 *
 * Nothing above caught it. 170 static checks and 43 CDP checks stayed green, because
 * every one of them asked whether the prose and the CSS rules EXIST. The claim being
 * protected here is different in kind: it is not that `.sp-about` is two columns, but
 * that no closing marker in this document points at the wrong element. The first is a
 * layout decision a future edit may legitimately change; the second is a parse
 * property, and nothing in the page's behaviour depends on it being wrong.
 *
 * `markup` above is truncated at the module `<script>`, so it cannot be the base for
 * this: a document sliced mid-`<body>` is imbalanced by construction and the check
 * would report two phantom errors on a correct file. The whole comment-stripped
 * document is, and there is no `<!--` after the module script opens (asserted, because
 * a comment end inside a script body would make the stripper eat to the next `-->`
 * and the balance check would then be reading a document that does not exist). */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);
const doc = page.replace(/<!--[\s\S]*?-->/g, '');
ok(!/<script type="module">[\s\S]*?<!--/.test(page),
  'no comment marker opens inside the module script, so stripping comments cannot eat into it');
function tagBalance(src) {
  const stack = [];
  const errors = [];
  const lineOf = (at) => src.slice(0, at).split('\n').length;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, closing, name, attrs] = m;
    const tag = name.toLowerCase();
    /* Raw-text bodies are SKIPPED, not tokenized: `<` inside a `<script>` is text, and
     * this file's own theme bootstrap at the top is full of `&&`. A checker that
     * mis-tokenized it would report a mismatch on a correct document, which is a check
     * nobody can trust. */
    if (RAWTEXT.has(tag) && !closing) {
      const end = src.indexOf(`</${tag}>`, re.lastIndex);
      if (end < 0) { errors.push(`<${tag}> at line ${lineOf(m.index)} never closes`); break; }
      re.lastIndex = end + tag.length + 3;
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
    if (closing) {
      const open = stack.pop();
      if (!open) {
        errors.push(`the closing marker </${tag}> at line ${lineOf(m.index)} closes nothing`);
      } else if (open.tag !== tag) {
        errors.push(`the closing marker </${tag}> at line ${lineOf(m.index)} does not match the innermost open element, `
          + `<${open.tag}> opened at line ${open.line}`);
        break;
      }
    } else {
      stack.push({ tag, line: lineOf(m.index) });
    }
  }
  for (const open of stack) errors.push(`<${open.tag}> opened at line ${open.line} is never closed`);
  return errors;
}
const balanceErrors = tagBalance(doc);
ok(balanceErrors.length === 0,
  'EVERY non-void tag in the document balances, so no closing marker can point at the wrong element'
  + ` (${balanceErrors.length} imbalance(s)${balanceErrors.length ? ': ' + balanceErrors.join('; ') : ''})`);

/* The imbalance check above and THIS one are the two halves of one claim, and neither
 * substitutes for the other: a balanced document can still have the wrong number of
 * grid children (eight balanced `<div>`s in a two-track grid auto-place as four rows,
 * which is the defect in its purest form), and the right number can sit in the wrong
 * place. Asserted as the section's DIRECT children by class name and in order, because
 * `align-items: start` plus auto-placement means a `.sp-about-live` that came second in
 * the DOM is what puts it in the right-hand track. */
const aboutOpen = markup.indexOf('<section class="sp-about"');
ok(aboutOpen > 0, 'the about section is present at all — the next three checks index into it');
const aboutBody = aboutOpen > 0
  ? (() => {
    /* Slice to the section's own closing marker, found by depth rather than by the next
     * `</section>` in the file, so a later section cannot end this one early. */
    const after = markup.slice(aboutOpen);
    const rel = after.search(/<section class="sp-about"[^>]*>/);
    let depth = 0;
    const scan = /<(\/?)section\b[^>]*>/g;
    let s;
    let end = -1;
    while ((s = scan.exec(after))) {
      depth += s[1] ? -1 : 1;
      if (depth === 0) { end = s.index + aboutOpen; break; }
    }
    return end > 0 ? markup.slice(aboutOpen, end) : '';
  })()
  : '';
ok(/<div class="sp-about-body">/.test(aboutBody),
  'and its prose is wrapped in ONE element, because a 2-track grid with seven unwrapped children auto-places them as four rows rather than as two columns');
ok(/<div class="sp-about-body">[\s\S]*<\/div>[\s\S]*<div class="sp-about-live"/.test(aboutBody),
  'with the live curve\'s parameter column SECOND, since auto-placement is what puts it in the 4fr track');
ok(!/<div class="sp-about-body">[\s\S]*<div class="sp-about-body"/.test(aboutBody),
  'and there is exactly one prose wrapper — two of them is a three-child grid and the same failure with an extra step');
ok(/min-width:\s*0/.test((() => {
  const s = cssCode.indexOf('.sp-about-body');
  return s > 0 ? cssCode.slice(s, cssCode.indexOf('}', s)) : '';
})()),
  'and that wrapper is allowed to shrink, because a grid item floors itself at its own min-content and one long <code> run would blow out the minmax(0, 6fr) track');
/* The live curve's parameters belong to this section, which is the only claim that
 * survives a reordering of the whole page. `</section>` no longer matching is precisely
 * how they ended up outside it. */
ok(/<\/section>\s*(?:<\/div>\s*)?<\/main>/.test(markup.slice(markup.indexOf('</div>', aboutBody + aboutBody.lastIndexOf('sp-about-live')))),
  'and nothing at all sits between the about section and the end of `<main>`, which is how its parameter column ended up a direct child of `<main>`');

// ---------------------------------------------------------------------------
// 9b. 對表's header row, and the section rhythm.
// ---------------------------------------------------------------------------

/* THE HEADER MUST NOT INHERIT THE ROWS' EMPHASIS, and the stylesheet's own reason for
 * existing is that it is (0,1,3) rather than merely later.
 *
 * The header's spans carry the SAME classes as the data rows' on purpose — one set of
 * tracks, one set of column identities, so a column cannot be renamed in the rows and
 * forgotten in the header. The cost was that `.sp-x-got` and `.sp-x-rel` also carry
 * `color: var(--text-primary)` and `font-weight: 600`, and at equal specificity the
 * later declaration won, so `.sp-x-head`'s own `color` did nothing for three of its
 * four children. Measured in light theme before the fix: 這一頁算的 and 相對差 at
 * `rgb(15, 23, 48)` / 600 while 離線表存的 sat at `rgb(56, 66, 95)` / 400 — a header
 * where two of four labels are bold and one is dimmer, which reads as emphasis that is
 * not there.
 *
 * Asserted on the SELECTOR SHAPE rather than on the declarations, because a fix that
 * only worked by being written later would be silently undone by the next rule anybody
 * adds to this file — and that is the whole difference between this and the cascade
 * defect it repairs. The descendant combinator over `dd > span` is what buys the
 * specificity; `.sp-x-head` alone, at (0,1,0), ties with the row classes and loses on
 * order. `check_spectrum_browser.mjs` measures the rendered colours, which is the
 * half a stylesheet read cannot answer.
 *
 * The block is found by SELECTOR rather than by first occurrence: `.sp-x-head > dd >
 * span` also opens the shared alignment rule further up this file, and taking the
 * first match reads that one — which carries no colour at all and would fail for a
 * reason that has nothing to do with the defect. §4's "presence is not attribution"
 * again, and the same trap twice in one file. */
const cssRules = [...cssCode.matchAll(/([^{}]+)\{[^{}]*\}/g)]
  .map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[0] }))
  .filter((r) => !/^@/.test(r.sel));
const headResetSel = cssRules.filter((r) => r.sel === '.sp-x-head > dd > span');
ok(headResetSel.length === 1,
  'the header reset is scoped to EXACTLY `.sp-x-head > dd > span` — (0,1,3) beats the row classes\' (0,1,0), while a reset on `.sp-x-head` alone would tie at (0,1,0) and lose on source order');
ok(headResetSel.length === 1 && /color:\s*var\(--text-muted\)/.test(headResetSel[0].body),
  'and that one rule sets the muted colour the header already declared, so all four labels render at one level rather than three of them at the rows\' weight');
ok(headResetSel.length === 1 && /font-weight:\s*400/.test(headResetSel[0].body),
  'and weight 400, because the rows\' `.sp-x-got` and `.sp-x-rel` carry 600 and a header that borrows their class borrows their emphasis');
ok(cssRules.filter((r) => r.sel === '.sp-x-head').length >= 1 && /color:\s*var\(--text-muted\)/.test(cssRules.find((r) => r.sel === '.sp-x-head').body),
  "while `.sp-x-head` keeps its own declaration too, so removing the reset cannot silently change what the rule is for");

/* ALL FIVE TRACKS ARE NAMED, and the count is a count of the header's OWN spans.
 *
 * `.sp-x-head > dd` and `.sp-x-rows > dd` share one `grid-template-columns` of five
 * fixed tracks. The header carried four spans, so the 92px track — the one printing
 * 「差 296」 on every row — had no header cell at all: three named columns and one
 * anonymous one, which reads as an overflow past the table rather than as a fourth
 * quantity. Measured, not inferred: five declared tracks, four header children.
 *
 * The count is taken from the header `<dd>` alone and NOT from the whole file: the
 * rows put the same five class names on five `<dd>`s, so a file-wide count is 25 and
 * the two numbers are not comparable. `<dt>` is empty and the `<dl>` is `aria-hidden`,
 * so this is presentation only. */
const headDd = (() => {
  const s = page.indexOf('<dl class="sp-x-head"');
  if (s < 0) return '';
  const open = page.indexOf('<dd>', s);
  const close = page.indexOf('</dd>', open);
  return open > 0 && close > open ? page.slice(open, close) : '';
})();
const headTrackRule = cssRules.find((r) => r.sel.startsWith('.sp-x-head > dd,') && r.sel.endsWith('.sp-x-rows > dd'))?.body ?? '';
const trackCount = (headTrackRule.match(/\d+px/g) || []).length;
ok(trackCount === 5, `對表's header and rows share FIVE fixed tracks, so every column has a track to sit in (${trackCount})`);
eq((headDd.match(/<span class="sp-[a-z-]+">/g) || []).length, trackCount,
  'and the header names all five of them — the absolute difference had no header cell, which is why three labels sat over five columns');
ok(/>絕對差</.test(headDd) && /class="sp-where"/.test(headDd),
  'the fifth one being 「絕對差」, carried on the same class the rows use rather than a header-only one, so the column cannot be renamed in one place and not the other');

/* THE RHYTHM IS TWO DECLARED INTERVALS, applied to the four blocks that carry one.
 *
 * Measured before this existed: `.sp-intro` 20px, `.sp-hero` / `.sp-live` /
 * `.sp-numbers` 22px each, `.sp-about` 26px. Five blocks, four values, and the kind
 * change carried the same interval as the kind continuity — the definition of no
 * rhythm at all.
 *
 * Asserted as the DECLARED tokens rather than as the four resolved margins on purpose.
 * A test that reads `margin-bottom` off four rules can be satisfied by four identical
 * literals, and the claim being protected is that they are two *named* values with a
 * ratio between them. `check_spectrum_browser.mjs` measures the rendered gaps, which
 * is the half this cannot reach. */
const rootBlock = (() => {
  const s = cssCode.indexOf(':root');
  if (s < 0) return '';
  return cssCode.slice(s, cssCode.indexOf('}', s));
})();
const bandGap = Number(rootBlock.match(/--sp-band-gap:\s*(\d+)px/)?.[1]);
const bandSep = Number(rootBlock.match(/--sp-band-sep:\s*(\d+)px/)?.[1]);
ok(Number.isFinite(bandGap) && Number.isFinite(bandSep) && bandSep > bandGap * 1.5,
  `the page declares two section intervals and the band boundary is unmistakably wider than the gap inside it (--sp-band-gap: ${bandGap}px, --sp-band-sep: ${bandSep}px)`);
/* The four rules, by which interval each one takes. `sp-about` takes NEITHER: it is
 * the last child of `.sp-page`, so its old 26px had nothing under it. */
const marginRule = (sel) => {
  const r = cssRules.find((x) => x.sel === sel);
  return r ? r.body : '';
};
/* Either longhand or the `margin` shorthand, because the three measurement sections
 * use the shorthand (they only ever declared a bottom margin) and the intro uses the
 * longhand (it has none). What the claim forbids is a LITERAL px value here. */
const rhythm = { '.sp-intro': 'sep', '.sp-hero': 'gap', '.sp-live': 'gap', '.sp-numbers': 'sep' };
for (const [sel, which] of Object.entries(rhythm)) {
  const rule = marginRule(sel);
  ok(new RegExp(`margin(?:-bottom)?:[^;]*var\\(--sp-band-${which}\\)`).test(rule),
    `${sel} carries the band ${which}, and not a literal — a literal here is a fourth interval to keep equal`);
  ok(!/margin(?:-bottom)?:[^;]*\d+px/.test(rule),
    `and ${sel} declares no bare px interval at all, so the ratio between the two bands is the stylesheet's single decision`);
}
ok(/margin:\s*0;/.test(marginRule('.sp-about')),
  "and .sp-about carries none, because it is the last child of .sp-page and its 26px had nothing under it");

/* THE PLOT'S HEADING ROW, WHICH USED TO NOT EXIST, and this replaced an assertion that
 * it did not.
 *
 * `.sp-hero-head` held exactly one element — the `<h2>` — inside a `display: flex` with
 * a `gap`, which renders identically to no wrapper, and it was deleted from both files
 * rather than emptied. The file's own sentence said what would happen next: 「a wrapper
 * with a single child is a container nothing can be put into yet, and leaving it is how
 * the next person puts something in it.」 Something has been put into it — the control
 * that plays the plot, which at 390×844 is otherwise 1,100px from the picture.
 *
 * SO THE CLAIM IS THE CHILD COUNT AND NOT THE CLASS NAME, and that is the whole reason
 * this is not simply the old assertion flipped. `test_check_spectrum_page.mjs` has a
 * negative case that puts a SINGLE-child `.sp-hero-head` back, and it was written to
 * catch exactly the wrapper this paragraph describes; an assertion about the name would
 * pass it, and one that asks for the play control is what makes it red again. */
const heroHead = markup.match(/<div class="sp-hero-head">([\s\S]*?)<\/div>/);
ok(Boolean(heroHead) && /<h2 id="sp-hero-h">時頻圖<\/h2>/.test(heroHead[1])
  && /id="sp-hero-play"/.test(heroHead[1]) && /data-play/.test(heroHead[1]),
  'the plot heading sits in a `.sp-hero-head` row with the play control beside it — TWO children, which is the thing the single-child wrapper was deleted for lacking, and the name alone would not catch the wrapper coming back');

const heroHeadRule = (() => {
  const start = cssCode.indexOf('.sp-hero-head {');
  return start < 0 ? '' : cssCode.slice(start, cssCode.indexOf('}', start));
})();
const heroH2Rule = (() => {
  const start = cssCode.indexOf('.sp-hero h2 {');
  return start < 0 ? '' : cssCode.slice(start, cssCode.indexOf('}', start));
})();
ok(/display:\s*flex/.test(heroHeadRule) && /justify-content:\s*space-between/.test(heroHeadRule),
  'the row is a flex row that puts the heading left and the control right — `space-between` on the row rather than `margin-left: auto` on the button, because 「heading left, control right」 is a statement about the row');

/* THE 8px BELOW THE HEADING LIVES ONCE, and it moved to the row when the row appeared.
 * Two rules claiming the same interval is §3.S's bug — the shape `.gm-btn` /
 * `.gm-btn-hint` had — and here it would put a second 8px under a heading that already
 * has one, which reads as a heading that is further from its plot than the plot is.
 *
 * AND THE LONGHAND/SHORTHAND ARE BOTH READ, because the first version looked for
 * `margin-bottom` while this stylesheet writes `margin: 0` — so it was satisfied by any
 * heading, including one carrying a second 8px, and the mutation that added exactly
 * that passed. §3.B2's shape pointed at the assertion written to prevent it: a guard
 * that can only pass. The value is read, not matched, so `margin: 0 0 8px` and
 * `margin: 8px` are both caught. */
const h2BottomMargin = (() => {
  const longhand = heroH2Rule.match(/margin-bottom:\s*([^;]+)/);
  if (longhand) return longhand[1].trim();
  const shorthand = heroH2Rule.match(/(?:^|[^-])margin:\s*([^;]+)/);
  if (!shorthand) return '0';
  const parts = shorthand[1].trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : parts[3];
})();
ok(/^(0|0px|0em)$/.test(h2BottomMargin)
  && /(?:margin:\s*0 0 8px|margin-bottom:\s*8px)/.test(heroHeadRule),
  `the 8px between the heading and the canvas is declared once, on the row — the heading's own bottom margin is ${h2BottomMargin}, and a second 8px there would double the gap`);

/* `.sp-btn-play` IS NOT REUSED, and the reason is arithmetic rather than taste: it
 * carries `flex: 2 1 auto`, sized for a 300px rail where 播放 is the primary action
 * and wants two thirds of the row against 隨機一隻's one. Beside a heading in a 1,180px
 * band the same value grows the button to half the plot's width. */
ok(/class="sp-btn sp-btn-plot"/.test(markup) && !/id="sp-hero-play"[^>]*sp-btn-play/.test(markup),
  'the plot\'s control carries `.sp-btn-plot` and NOT `.sp-btn-play`, whose `flex: 2 1 auto` is sized for the rail and would grow this button to half the plot\'s width');
ok(/^\.sp-btn-plot \{[^}]*flex:\s*0 0 auto/m.test(cssCode),
  'and `.sp-btn-plot` is sized not to grow, so the flex value means 「primary」 in the rail and nothing at all here rather than the same wrong thing in both');

/* ONE WRITER FOR THE PLAY STATE. Two controls that both call `toggle()` and each write
 * their own `aria-pressed` is §3.I's shape one level down, and it renders as a page
 * where one button says 停止 while the other still says 播放. */
const setPlayButtonBody = page.match(/function setPlayButton\(playing\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '';
ok(/querySelectorAll\('\[data-play\]'\)/.test(setPlayButtonBody)
  && !/getElementById\('sp-/.test(setPlayButtonBody),
  '`setPlayButton()` writes EVERY `[data-play]` control rather than one id by name — two controls that both call `toggle()` and each write their own state is a page that disagrees with itself about whether sound is playing');
eq((markup.match(/<button[^>]*data-play/g) || []).length, 2,
  'and there are exactly two of them, so a third control added without thinking about this loop would be a third thing to remember');
ok(/id="sp-play"/.test(markup),
  'the rail\'s control keeps its id, which is load-bearing outside this file — `check_spectrum_browser.mjs` reads that exact id in fifteen places, and an id-less button is the one nothing can assert about');


const asideAt = markup.indexOf('<aside class="sp-left-panel"');
const mainAt = markup.indexOf('<main id="main" class="sp-main"');
ok(asideAt > 0 && mainAt > 0 && asideAt < mainAt,
  'the rail is a SIBLING of `<main>`, not a descendant — the controls are not main content, so they must not be inside the skip-link target');
ok(!/<main[^>]*>[\s\S]*<aside/.test(markup),
  'and specifically: no `<aside>` sits inside `<main>`, which is the shape that put every rail button in the skip link\'s destination');

ok(mainAt > 0 && markup.indexOf('class="sp-intro"') > mainAt,
  'the intro lives inside the right column, above the plot — the rail holds controls, not prose');
ok(markup.indexOf('class="sp-hero"') > markup.indexOf('class="sp-intro"'),
  'and the plot follows it, so the page still reads 「what this is → what you are looking at」');

/* The intro is TWO COLUMNS, with the species in the second one. Asserted as the
 * grid's own declaration rather than as the presence of the figure, because a
 * `.sp-intro-art` in the markup with no grid rule beside it renders as a full-width
 * block under the prose — which looks almost right and is the layout this moved away
 * from. */
ok(/grid-template-columns:\s*minmax\(0, 6fr\) minmax\(0, 4fr\)/.test(cssCode),
  'the intro is a 6:4 grid, the same split cries.html and cries-gen1.html use — 7:3 would leave the prose past its own 68ch measure');
const introStart = markup.indexOf('class="sp-intro"');
const introEnd = markup.indexOf('</div>', markup.indexOf('sp-intro-art'));
const introBlock = introStart > 0 ? markup.slice(introStart, introEnd + 6) : '';
ok(introBlock.indexOf('sp-intro-body') > 0 && introBlock.indexOf('sp-intro-art') > 0
  && introBlock.indexOf('sp-intro-body') < introBlock.indexOf('sp-intro-art'),
  'and the prose comes first with the sprite figure second, so the 6fr track is the text');
ok(markup.indexOf('id="sp-art"') > introStart && markup.indexOf('id="sp-art"') < introEnd,
  'the plotted species is identified in the intro column — it used to be a 28px chip in the plot\'s heading, which named the chart rather than its subject');
ok(!markup.includes('class="sp-figure"') && !classes.has('sp-figure'),
  'and that 28px identity strip is gone from both the markup and the stylesheet, rather than left behind as a second thing to keep right');
ok(/@media \(max-width: 980px\)[\s\S]{0,400}grid-template-columns:\s*minmax\(0, 1fr\)/.test(cssCode),
  'below the width where 6:4 would break the measure, the intro collapses to one column');

/* THE FIGURE IS SECOND IN THAT ONE COLUMN, and this is `order` rather than DOM order,
 * so it cannot be read off the markup at all: the `<figure>` already follows
 * `.sp-intro-body` in the source and always has. `order: -1` was what put it — and the
 * page's only `<h1>` — above the explanation on a phone.
 *
 * The reason it was there was a good one that turned out to be about the wrong axis:
 * 「a reader who has lost the columns still wants to know what they are looking at
 * first」. What the reader wants first is the sentence saying what the page IS, and on a
 * phone this one is three paragraphs of it. The sprite is the SUBJECT, not the
 * introduction, and it now sits 40px above the picture of that subject.
 *
 * The cost is zero by construction, which is why this is an `order` and not a move: the
 * figure is already inside `.sp-intro`, so moving it from the first grid cell to the
 * last is 90px from above the prose to below it. `#sp-hero` measured 1,189px before and
 * after at 390×844, and `check_cry_mobile_layout.mjs` asserts it is still inside a
 * screen and a half. */
const introArtBlock = (() => {
  const start = cssCode.indexOf('.sp-intro-art {', cssCode.indexOf('@media (max-width: 980px)'));
  return start < 0 ? '' : cssCode.slice(start, cssCode.indexOf('}', start));
})();
ok(introArtBlock.length > 0 && !/order:\s*-?\d/.test(introArtBlock),
  'the collapsed one-column intro keeps the figure AFTER the prose — no `order` on `.sp-intro-art`, because `order: -1` put the sprite, and the page\'s only `<h1>`, above the explanation on a phone');

/* The rail is a viewport-height column that does NOT scroll, and the roster is
 * the one thing inside it that does. Two assertions because either alone is
 * satisfied by a broken pair: `overflow: hidden` without a scrolling child is a
 * rail you cannot reach the bottom of, and a scrolling child without it is a
 * double scroller. `cries.css` drops stickiness at 900px for the same reason the
 * sticky version needs an escape. */
const railBlock = (() => {
  const start = css.indexOf('.sp-left-panel {');
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start));
})();
ok(/height:\s*100vh/.test(railBlock) && /position:\s*sticky/.test(railBlock)
  && /overflow-y:\s*auto/.test(railBlock),
  'the rail is sticky and exactly one viewport tall, and scrolls ONLY as a fallback — `cries.css` gives `.cy-panel` the same treatment, and without it a short viewport clipped the play button');
const rosterBlock = (() => {
  const start = css.indexOf('.sp-roster {');
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start));
})();
ok(/overflow-y:\s*auto/.test(rosterBlock) && /min-height:\s*1\d\dpx/.test(rosterBlock),
  'the roster scrolls, and has a FLOOR of about three rows — `min-height: 0` let it shrink to a measured 1px on a 560px viewport, which is a squeezed layout rather than a working one');
ok(!/min-height:\s*0[;\s]/.test(rosterBlock),
  'and it is explicitly not `min-height: 0`, which is the value that hands the whole rail to its siblings');

/* TWO scrollers, and the PAIR is the claim.
 *
 * This asserted exactly one, on the reasoning that a sidebar which does not scroll
 * leaves a single scroller in the page. True on a tall screen, and false below
 * about 600px — measured: the roster is 325px at a 900px viewport and 126px at 700,
 * then 1px at 560, and at 500 the play button is clipped with nothing able to scroll
 * to it. So the rail became a fallback scroller (`cries.css`'s `.cy-panel` shape)
 * and the roster took a floor, and between them only one ever has anything to
 * scroll.
 *
 * Asserted as a count because the failure is a THIRD element arriving, and a
 * prohibition on some selector would not see it whichever element it was. */
const scrollers = [...cssCode.matchAll(/overflow-y:\s*auto/g)].length;
eq(scrollers, 2,
  'two vertical scrollers and no more: the roster for the list, the rail for the case where the chrome is taller than the viewport');

/* EVERY SCROLLABLE REGION LIVES INSIDE THE SCROLLPORT, and this is the check for a
 * defect that shipped and that nothing could see.
 *
 * The 24-chip cover grid was first a SIBLING of `.sp-roster`, above it, inside a rail
 * that is `overflow: hidden` at `100vh`. Expanded, the chips are 1,226px tall in a
 * 900px rail: the roster was squeezed from 271px to 9px and 876px of the grid sat
 * past the rail's bottom edge, where `overflow: hidden` put it permanently out of
 * reach. Chips 15 through 24 could not be seen and could not be scrolled to.
 *
 * Measured in a browser, not reasoned: the difference between the two layouts is
 * whether the block is a descendant of the element that scrolls. That is a
 * relationship between two elements, which is exactly what a `getElementById`
 * presence probe and a `querySelectorAll` count both miss — the chips were built,
 * and there were 24 of them, on both layouts. */
const coversAt = markup.indexOf('<details class="sp-covers">');
const rosterBoxAt = markup.indexOf('<div class="sp-roster" id="sp-roster">');
ok(coversAt > 0 && rosterBoxAt > 0 && coversAt > rosterBoxAt,
  'the cover grid is INSIDE the roster\'s scroller, not beside it — beside it, 1,226px of chips overflow a rail that cannot scroll and 876px of them are unreachable');
const rosterEnd = markup.indexOf('<div class="sp-sentinel"', rosterBoxAt);
ok(rosterEnd > coversAt,
  'and it is inside that box rather than after it, which is the difference between reachable and not');
ok(!/\.sp-covers\s*\{[^}]*max-height/.test(cssCode),
  'and the grid is not given its own max-height instead — a second scrollport would trade the clipping for the nested-scroller problem');

/* TWO STICKY HEADERS IN ONE SCROLLPORT, and their offsets come from ONE number.
 *
 * The roster head pins at 0 and the cover summary has to pin directly beneath it.
 * Two literals would be two things to keep right, and the failure is silent and
 * ugly: they overlap, and one of them covers the other's text. */
ok(/--sp-roster-head-h:\s*\d+px/.test(css),
  'the two sticky offsets are derived from one custom property, so they cannot drift into overlapping');
const headRule = (cssCode.slice(cssCode.indexOf('.sp-roster-head {'), cssCode.indexOf('}', cssCode.indexOf('.sp-roster-head {'))));
const sumRule = (cssCode.slice(cssCode.indexOf('.sp-covers > summary {'), cssCode.indexOf('}', cssCode.indexOf('.sp-covers > summary {'))));
ok(/top:\s*0/.test(headRule) && /top:\s*var\(--sp-roster-head-h\)/.test(sumRule),
  'the head pins at 0 and the summary pins at the head\'s own height');
ok(!/padding-top:\s*\d/.test(rosterBlock),
  'and the scroller carries no padding-top: padding on a scroll container is inside the sticky containing block, which left both headers floating below the top edge');

/* The rail's own scroller, and the observer that feeds it. The `root` is the part
 * that is easy to get wrong and impossible to see: the rail scrolls, not the
 * document, so an observer on the document never sees the sentinel leave it and
 * the list silently stops at one batch. */
ok(/root:\s*el\('sp-roster'\)/.test(script),
  'the roster batches on an IntersectionObserver rooted at the RAIL, not at the document — the rail is the scroller');
ok(/rootMargin:\s*'300px'/.test(script) && /ROSTER_BATCH = 60/.test(script),
  'with a margin and a batch size, so rows load before the sentinel is visible rather than after');

/* The two claims about facets that are DATA claims and therefore cannot be read
 * off the source: the composition rule, and the mutual exclusivity it implies. */
ok(/const RARITY = \[[\s\S]{0,200}is_legendary[\s\S]{0,200}is_mythical/.test(script),
  'both rarity facets are declared from `pokemon_data.json`\'s own flag names, so a third copy of 「which species are legendary」 cannot start here');
ok(/互斥/.test(script),
  'the page says 傳說 and 幻之 are mutually exclusive, because they are: zero of 1,025 records carry both, and pressing both yields an empty list');
eq(pokemon.filter((p) => p.id <= 1025 && p.is_legendary && p.is_mythical).length, 0,
  'and that is measured against the data rather than asserted from memory');
eq(pokemon.filter((p) => p.id <= 1025 && p.is_legendary).length, 71, '71 legendaries');
eq(pokemon.filter((p) => p.id <= 1025 && p.is_mythical).length, 23, '23 mythicals');

/* The facets narrow the SOURCE's roster, not all 1,025 species. This is the bug
 * the shape of `visibleIds()` is chosen against, so it is asserted structurally:
 * it must read the roster, or a species with no recording for the selected source
 * becomes a row that decodes into a failure. */
const visibleBody = script.slice(script.indexOf('function visibleIds()'));
ok(/ROSTERS\[state\.source\]\.ids/.test(visibleBody.slice(0, 400)),
  'the visible list is built from the SELECTED SOURCE\'s roster, so a species the source has no recording for cannot be listed');

/* And the search is a filter on that list rather than a jump away from it — the
   whole reason the rail exists. */
ok(/addEventListener\('input'/.test(script) && /afterFilterChange\(\)/.test(script),
  'the search box filters the roster rather than selecting and hiding it, which is what lets a reader work down a list one cry at a time');
ok(!/\bpick\(/.test(script),
  'and the old jump-to-a-hit `pick()` is gone — it selected one species and left the list alone, which is the opposite affordance');

/* The numeric branch, which was wrong on the first write and is here because
 * 「0006」 returning 273 species is a real number, not a plausible-looking one.
 *
 * `String(id).includes(q)` after stripping the leading zeros answers 「which ids
 * contain a 6」 — 16, 26, 106, 246 — so a box holding 「0006」 offered a quarter of
 * the roster. Matching the PADDED id is anchored by the fixed-width padding, and
 * it narrows as you type (6 → 06 → 006 → 0006), which is what a filtering box
 * should do and what the old jump-to-a-hit version could not afford. */
/* Comments and string literals stripped, and that is not tidiness — the comment
 * ABOVE this assertion quotes `String(id).includes('6')` in order to explain why
 * it is banned, so an unmasked search finds its own documentation and the check
 * fails on the page being correct. Same false positive `check_page_module_api.mjs`
 * documents for a page's prose about a member it does not call. */
const matchesBody = script.slice(script.indexOf('function matchesQuery('))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
ok(!/String\(id\)\.includes/.test(matchesBody),
  'a numeric search matches the ZERO-PADDED id, never the bare one — matching the bare id answers 「which ids contain a 6」 and matched 273 species for 「0006」');
ok(/formatPokemonId\(id\)\.includes\(q\)/.test(matchesBody),
  'and it does match the padded form, which is the form readers actually type');

/* Facet COMPOSITION, and the two questions it took a probe to separate.
 *
 * The first version drove `disabled` from the same count it printed on the chip,
 * which made 幻之 permanently un-pressable: with 傳說 on, their combined count is 0
 * (the flags are mutually exclusive), so the chip greyed itself out — and with it
 * went the empty state and the sentence on the page explaining the zero. A control
 * whose own number stops you reaching the explanation of that number is worse than
 * no number.
 *
 * So `sourceCount` — the source's answer with no UI facet folded in — decides
 * `disabled`, and `countWith` — which folds the others in — decides the printed
 * number. Both have to exist and they have to be different functions. */
ok(/function sourceCount\(/.test(script) && /function countWith\(/.test(script),
  'the two facet counts are separate functions, because 「can this source produce it」 and 「how many would I get」 are different questions');
const buildFiltersBody = script.slice(script.indexOf('function buildFilters()'));
ok(/sourceCount\(\{ \[r\.key\]: true \}\) === 0/.test(buildFiltersBody),
  'and `disabled` comes from the source-only count, so a facet the source HAS is never greyed out');
ok(/countWith\(\{ \.\.\.state\.filter/.test(buildFiltersBody),
  'while the number printed on the chip includes the other facets, so a zero explains itself');
ok(buildFiltersBody.indexOf('sourceCount') < buildFiltersBody.lastIndexOf('countWith'),
  'and the two are not the same expression spelled twice');

/* The 24-chip grid is COLLAPSED, and its summary is its own accessible label.
 * Expanded it is 12 rows of 44px — roughly 530px of a viewport-height rail —
 * which would push the roster the reader came for off the bottom. */
ok(/<details class="sp-covers">/.test(markup) && !/<details class="sp-covers" open/.test(markup),
  'the cover grid is a <details> and it is not `open`, so it costs one summary row instead of half the rail');
ok(/<summary id="sp-chips-label">/.test(markup) && /aria-labelledby="sp-chips-label"/.test(markup),
  'and the `<summary>` IS the group label, so the accessible name is the text on screen rather than a visually-hidden span nobody can find');

/* The source radiogroup is collapsed the same way, and its summary states the ACTIVE
 * source. A collapsed control that does not say what it is set to is a control the
 * reader has to open just to find out — and this one decides which 1,025-row list
 * they are looking at, so the value has to travel with the label. */
ok(/<details class="sp-box">/.test(markup) && !/<details class="sp-box" open/.test(markup),
  'the source radiogroup is a collapsed <details> too — collapsed it costs 40px instead of 129px, which is 89px of roster');
ok(/<summary id="sp-source-label">來源<span class="sp-summary-value" id="sp-source-now">/.test(markup),
  'and its summary carries the active source, so narrowing the list to nothing does not take the answer with it');
ok(/el\('sp-source-now'\)\.textContent/.test(script),
  'which is written from `buildSources()` on every change, so it cannot drift from `aria-checked`');
ok(/aria-labelledby="sp-source-label"/.test(markup),
  'and the radiogroup is still labelled by that summary, so the accessible name survives the collapse');

/* THE CANVAS TEXT IS IN CSS PIXELS, and this is the second DPR bug this page has
 * had. `sizeCanvas` sizes the backing store in device pixels and applies no
 * `setTransform`, so one user-space unit is one device pixel — which is what
 * `createImageData` and `drawImage` need, and what makes a `ctx.font = '10px'`
 * declaration render 10 DEVICE pixels: 5 CSS px on any 2x display.
 *
 * The tick labels on both canvases were written as if 10 were CSS px, so they were
 * half the authored size on every retina laptop, phone and once-zoomed browser —
 * and a screenshot taken at 1x shows them at the right size, which is why it
 * survived.
 *
 * PER FUNCTION, and that is the whole difficulty. A whole-file search for
 * `setTransform(dpr` is satisfied by EITHER canvas, so removing it from one leaves
 * the other's in place and the check goes green — which is exactly how the three
 * mutation cases written for this first passed against a checker that cannot see
 * them. This file already documents the same trap for `drawPlot`'s fitted span. */
const bodyOf = (name) => {
  const start = script.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const end = script.indexOf('\n    function ', start + 1);
  return script.slice(start, end === -1 ? script.length : end);
};
const axesSource = bodyOf('drawAxes');
const liveSource = bodyOf('drawLive');

ok(/ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/.test(axesSource),
  'the plot\'s axis labels are drawn under a CSS-pixel transform, so they are not half-size on a 2x display');
ok(/ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/.test(liveSource),
  'and so are the live panel\'s — each canvas checked in its OWN body, because a whole-file search is satisfied by whichever one survives');
ok(/function drawAxes\(ctx, w, h, dpr\)/.test(script) && /const cw = w \/ dpr;/.test(axesSource),
  'the axis function takes `dpr` and divides the device size down, so its positions are CSS px throughout');
ok(/ctx\.setTransform\(1, 0, 0, 1, 0, 0\)/.test(script),
  'and the two places that genuinely need device pixels — the ImageData build and the cached blit — say so explicitly');
ok(/ctx\.font = '12px/.test(axesSource) && /ctx\.font = '12px/.test(liveSource),
  'the tick type is 12 CSS px on BOTH canvases');
/* One missed `w` draws a gridline past the right edge, which reads as a label that
 * is present but oddly placed rather than as a scaling mistake. */
const axesCoords = axesSource.replace(/const cw = w \/ dpr;[\s\S]*?const ch = h \/ dpr;/, '');
ok(!/\bw\b\s*-\s*1\s*-|\bh\b\s*-\s*1\s*-|lineTo\(w,/.test(axesCoords),
  'the axis labels position off the CSS dimensions, not the device ones — one missed `w` draws a gridline past the right edge');
ok(/const LEVEL_H = 2\d/.test(liveSource) && /const PAD_T = 1\d/.test(liveSource),
  'and the live panel reserves enough gutter for the larger type — the 12px labels need more than the 16px strip sized for a 5px glyph');

/* The source summary, scoped to `buildSources()` for the same reason: the same
 * assignment also sits in the click handler, so a whole-file search is satisfied by
 * whichever of the two survives. */
ok(/el\('sp-source-now'\)\.textContent\s*=\s*`\$\{ROSTERS\[state\.source\]/.test(bodyOf('buildSources')),
  'which is written from `buildSources()` on every change, so it cannot drift from `aria-checked`');

/* ---------------------------------------------------------------------------
   16. THE PICKER — §3.X. A rail that is 5,856px of a phone's 9,471px document.
   ---------------------------------------------------------------------------

   MEASURED AT 390×844, BEFORE THIS SECTION EXISTED, and every number below is from a
   browser rather than from the stylesheet:

     .sp-left-panel    5,856px tall,  62% of the whole 9,471px document
     .sp-roster        5,347px of it, with `overflow-y: visible` and no height cap
     #sp-hero          y=6,746 — the spectrogram, the entire reason for the page
     #sp-play          y=397, i.e. 6,349px from the thing it controls

   and AFTER: `.sp-left-panel` 270px, `.sp-roster` 0, `#sp-hero` y=1,189, `#sp-play`
   y=114. The desktop rail measures identically before and after — rail 1000px, not
   scrolling, overflow 0, `.sp-roster` 503px and scrolling, plot at y=653 — which is
   what the `display: contents` assertion below exists to keep true.

   The GEOMETRY is checked in `check_cry_mobile_layout.mjs`, which drives the real page
   at a phone width. Everything here is the part a stylesheet and a source can answer,
   and none of it would catch a layout by itself — which is §3.G1a's shape and the
   reason the two halves are not interchangeable.
   -------------------------------------------------------------------------- */

/* `[\s\S]*?` and not `[\S]*?`: the latter cannot match a space, so it silently finds
 * nothing in a stylesheet. That is not a guess about a typo — it is the reason this
 * helper's first version reported zero media queries in both files with no error. */
const maxWidthBlocks = (src) => [...src.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
  .map((m) => ({ width: Number(m[1]), body: m[2] }));

/* Comments are masked to a SPACE rather than removed, so a match that spans a comment
 * boundary still fails — and, more to the point here, so the prose in the docblocks
 * above cannot satisfy a count that is about code. `check_cries_page.mjs` has the same
 * helper with the same reasoning; it is four lines and it is not in `scripts/lib/`
 * because a module there is hashed into every skip-cache key (§3.G7's closing note
 * prices that), which is more than a masking regex is worth. */
const masked = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

const pickerOpen = markup.indexOf('<div class="sp-picker" id="sp-picker">');
const pickerClose = markup.indexOf('</div>', markup.indexOf('id="sp-roster-list"'));
ok(pickerOpen > 0 && pickerClose > pickerOpen,
  'the rail\'s filters and its roster are wrapped in ONE `.sp-picker` — a `<details>` can only wrap a contiguous range, so cutting the picker in two would give a phone two summaries and two things to tap');
ok(markup.indexOf('class="sp-roster" id="sp-roster"') > pickerOpen
  && markup.indexOf('class="sp-covers"') > markup.indexOf('class="sp-roster" id="sp-roster"'),
  'and the roster is INSIDE it with the cover grid still inside the roster — the two relationships the rail\'s one-scroller design depends on, in the order the assertion above about the cover grid already assumed');

/* THE STATUS LINE IS OUTSIDE, and it is an ABSENCE assertion, which is the only form
 * this can take. `#sp-status` carries 計算中… and 「無法取得這隻的叫聲：…」 — a decode
 * failure reported inside a collapsed box is a message in a `display: none` subtree,
 * which is not an error the reader can read. `spectrum.html` had it between the
 * transport and the roster, so the wrapper had to be opened AFTER it and the transport
 * moved above both; that is the same finding as the contiguity assertion above, and it
 * is asserted here because it is the reason the markup reads in the order it does. */
ok(markup.indexOf('id="sp-status"') < pickerOpen && markup.indexOf('id="sp-status"') > 0,
  'the status line stays OUTSIDE the picker — a decode error reported inside a collapsed box is in a `display: none` subtree, and the reader gets no error at all');

const pickerRule = (() => {
  const start = cssCode.indexOf('.sp-picker {');
  return start < 0 ? '' : cssCode.slice(start, cssCode.indexOf('}', start));
})();
ok(/display:\s*contents/.test(pickerRule),
  'the wrapper is `display: contents` above the breakpoint, which is what puts `.sp-roster` back as a direct flex item of the rail — measured: as a flex container the roster became 5,347px, stopped scrolling, and handed the rail a 4,829px overflow');
ok(/^\.sp-picker-toggle \{[\s\S]*?\}/m.test(cssCode)
  && /display:\s*none/.test(cssCode.slice(cssCode.indexOf('.sp-picker-toggle {'), cssCode.indexOf('}', cssCode.indexOf('.sp-picker-toggle {')))),
  'and the toggle is `display: none` above the breakpoint, because a control that reveals what is already revealed is a row of the rail\'s height budget spent to say nothing');

/* The breakpoint is read out of the STYLESHEET, and required to be the one whose block
 * carries `.sp-left-panel` — because `spectrum.css` has three `max-width` blocks (980,
 * 900, 1210) and a bare number comparison would be satisfied by the other two.
 * `spectrum.html` cannot read a media query and a media query cannot read a custom
 * property, so the number is written twice and this is the only thing that makes the
 * duplication safe. §3.S's shape: a shape assertion satisfied by a rule that has
 * nothing to do with the claim. */
const railBlock900 = maxWidthBlocks(cssCode).filter((b) => b.width === 900);
ok(railBlock900.length === 1 && /\.sp-left-panel/.test(railBlock900[0].body),
  'there is exactly ONE 900px block in `spectrum.css` and it is the one that drops the rail out of the side — the assertion for the number below has to name a block, not a number');
const mq = page.match(/const PANEL_COLLAPSE_MQ = '\(max-width: (\d+)px\)'/);
ok(Boolean(mq) && railBlock900.length === 1 && Number(mq[1]) === railBlock900[0].width,
  'and the page\'s `PANEL_COLLAPSE_MQ` is that same width, so the stylesheet and the script cannot disagree about where the rail collapses');
const syncPickerBody = page.match(/function syncPicker\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '';
ok(/setPickerOpen\(!collapsed\(\)\)/.test(syncPickerBody),
  'the breakpoint is applied in ONE place — `syncPicker()` collapses the picker on a phone and expands it above, and every other writer of the open state is a gesture the reader made');

/* `reveal: true` AT FOUR SITES AND NOT AT TWO, counted rather than grepped, because
 * the claim is about which call sites and not about the string existing. The two that
 * must NOT carry it are named for a reason each: the source change re-renders the rail
 * ABOVE the plot and is not an answer to a question asked from the plot, and the boot
 * selection would fight the browser's own restore-scroll-on-back. */
const selectSites = [...masked(page).matchAll(/select\(([^;]*?)\);/g)].map((m) => m[1]);
const revealing = selectSites.filter((a) => /reveal:\s*true/.test(a));
eq(revealing.length, 4,
  'exactly four `select()` call sites ask to be revealed — the cover chips, 隨機一隻, Enter in the search box and a roster row');
eq(selectSites.filter((a) => /reveal/.test(a)).length, revealing.length,
  'and no other call site mentions `reveal` at all, so 「open a list on a phone and see nothing change」 cannot come back through a fifth path');
ok(/renderRoster\(\)\.ids\.length\s*\?/.test(page) === false
  && /select\(ROSTERS\[key\]\.ids\[0\]\)/.test(masked(page)),
  'the source change selects without revealing: it rebuilds everything above the plot, so scrolling the reader down to it would move them away from the control they just pressed');
ok(/await select\(ROSTERS\[state\.source\]\.ids\.includes/.test(masked(page))
  && !/reveal/.test(page.match(/await select\(ROSTERS\[state\.source\][^;]*;/)?.[0] ?? ''),
  'and so does the boot selection: a page that scrolls itself on load fights restore-scroll-on-back, and the plot is one short scroll away once the rail is 270px');

/* §3.M'S TRAP, AND IT IS LIVE HERE. The wrapper's own `display` inside the 900px query
 * is `block`, which beats the user-agent's `[hidden] { display: none }` at any
 * specificity — so `picker.hidden = true` on a wrapper with an author `display` leaves
 * 5,300px of list on screen while the button says 「搜尋與清單 ▸」. `shared.css` already
 * pays this once for `.site-nav-drawer[hidden]`, and `docs/incidents/page-defects.md#m`
 * measures all three variants in headless Chrome; this page now has the fourth instance
 * of the same shape. Asserted as a RULE rather than as behaviour, because behaviour is
 * what `check_cry_mobile_layout.mjs` is for and this half cannot see a box. */
const hiddenRule = cssCode.slice(cssCode.indexOf('.sp-picker[hidden]'));
ok(/^\.sp-picker\[hidden\]\s*\{[^}]*display:\s*none/.test(hiddenRule),
  'and `.sp-picker[hidden]` carries its own `display: none` — the wrapper declares `display: block` below the breakpoint, and an author `display` beats `[hidden]` at any specificity, so the attribute alone would leave the list on screen with the button shut');

const revealPlotBody = page.match(/function revealPlot\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '';
/* ORDER, COMPARED, because 「closes the picker BEFORE scrolling」 is a claim about two
 * statements' positions and a presence assertion cannot make it: both statements survive
 * either order, so a mutation that swaps them satisfies every version of the check that
 * asks whether each one is there. The picker IS the distance — ~5,300px of it — so
 * scrolling first aims at an offset that is about to stop existing and the browser clamps
 * to the collapsed maximum. */
ok(revealPlotBody.indexOf('setPickerOpen(false)') >= 0
  && revealPlotBody.indexOf('setPickerOpen(false)') < revealPlotBody.indexOf('scrollIntoView'),
  'and it closes the picker BEFORE scrolling, compared as positions rather than as two presences — the picker is the distance, so scrolling first aims at an offset that is about to stop existing');
ok(/if \(!collapsed\(\)\) return;/.test(revealPlotBody),
  '`revealPlot()` returns early above the breakpoint, so a desktop reader is never moved by a page that only has this problem on a phone');

ok(/prefers-reduced-motion/.test(revealPlotBody) && /block:\s*'nearest'/.test(revealPlotBody),
  '`block: \'nearest\'` so a reader who already has the plot on screen is not moved at all, and the smooth behaviour is gated on `prefers-reduced-motion` (§3.C)');

/* `aria-expanded` IS PART OF THE OPEN STATE and is written in the same function, which
 * is the only reason it can be trusted: a button announcing 「expanded」 over a `hidden`
 * box is the opposite of what is on screen, and no browser checks the two against each
 * other. */
const setPickerBody = page.match(/function setPickerOpen\(open\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '';
ok(/setAttribute\('aria-expanded'/.test(setPickerBody) && /picker\.hidden = (true|false)/.test(setPickerBody),
  '`aria-expanded` and the wrapper\'s `hidden` are both written by `setPickerOpen()`, so the button cannot announce the opposite of what is on screen');
ok(/state\.pickerReturnY = window\.scrollY/.test(setPickerBody),
  'and the return offset is `window.scrollY`, recorded on CLOSING — the roster cannot report it on a phone, where it is 5,300px of box holding 2,640px of rows and its own `scrollTop` is permanently 0');
eq((masked(page).match(/pickerReturnY/g) || []).length, 4,
  '`pickerReturnY` appears four times and no more — declared, assigned and read in `setPickerOpen()`, and zeroed in `resetRoster()` — because a field with a fifth reader is a field whose meaning has started to leak');
ok(/state\.pickerReturnY = 0/.test(page.match(/function resetRoster\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? ''),
  'and `resetRoster()` is one of the two writers, because a filter change is a new question and the old offset belongs to a list that no longer exists');

/* THE SUMMARY IS ONE WRITER. `#sp-picker-now` states which species is on screen and how
 * big the list is, and both halves have to move together: a summary that says 「1025 隻」
 * above a 40-row filtered list, or 「胖可丁」 above a list 妙蛙種子 is selected from, is
 * the same defect §3.G9 found on the source radiogroup. */
eq((masked(page).match(/el\('sp-picker-now'\)\.textContent/g) || []).length, 1,
  'the picker\'s summary is written in exactly one place, so its two halves cannot disagree');
ok(/function renderPickerSummary\(\)/.test(page)
  && /renderPickerSummary\(\);/.test(page.match(/function renderRoster\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '')
  /* The whole `select()` body, anchored by its own closing brace — every statement in
   * it is indented six spaces, so `\n {4}}` is the function's end and nothing else. The
   * first version anchored on the next `const meta`, which is three lines in and
   * therefore reported a missing call for a call that is forty lines further down. */
  && /renderPickerSummary\(\)/.test(page.match(/async function select\([^)]*\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? ''),
  'and it is called from the two writers of its inputs: `renderRoster()` for the count and `select()` for the name');

console.log('');
if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);
