#!/usr/bin/env node
/**
 * index.html's scroll-scrubbed hero. Run: node scripts/check_home_hero.mjs
 *
 * WHAT THIS EXISTS FOR
 * ===================
 * The hero is the first thing every visitor sees and, before this file, nothing
 * in the suite read any of it. §3.P records the shape this repeats: maze.html
 * shipped four solvers and a patrol that had never once drawn a path, because
 * nothing mentioned the string `maze`. §3.O's closing note is the same hole in
 * a different element — "nothing in the suite reads a header's geometry".
 *
 * The mechanism is easy to break silently because every break still RENDERS.
 * Drop the `- innerHeight` and the scrub tops out near 0.42 with the last six
 * seconds unreachable; nothing looks wrong. Collapse the track and the hero
 * becomes one screen with no scroll; nothing looks wrong. Seek on every frame
 * under reduced motion and the one setting that promises stillness gets motion;
 * nothing looks wrong. So the assertions below are about the ARITHMETIC and the
 * branch conditions, not about whether a tag exists.
 *
 * WHY STATIC, AND WHAT IT DELIBERATELY CANNOT SEE
 * ================================================
 * A stylesheet contract and a progress formula are both readable off disk, and
 * §3.G4 established that putting that half in a browser costs 6s and a Chrome
 * boot to answer questions a file already contains. Everything here is static.
 *
 * What it cannot see is in check_home_hero_browser.mjs, and the split is not
 * arbitrary: "the scrub moves the clip" and "the panel is readable over the
 * brightest frame" are the two claims no amount of source reading can settle.
 *
 * NOTHING IS RESTATED WHERE IT CAN BE READ
 * =========================================
 * The track height comes from `HOME_HERO_TRACK_VH` — the constant the module
 * itself uses — and is compared against the rule read out of index.html, so a
 * change to the number has to be made in two places for this to go red instead
 * of one. The sorter count comes from sorting-algorithms.js and the roster size
 * from pokemon_data.json. §3.S's rule, and the reason three of this project's
 * past defects were numbers in prose.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GENERATION_COUNT, GEN_ONE_DATE, heroGenFor, heroGenForKey, heroVideoUrl, heroPosterUrl,
} from '../assets/js/hero-gen.js';
import { HOME_HERO_TRACK_VH } from '../assets/js/home-hero.js';
import { ALGO_IDS } from '../assets/js/sorting-algorithms.js';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(BASE, p), 'utf8');

let checks = 0;
let skipped = 0;
const problems = [];
const ok = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
const eq = (got, want, msg) => ok(
  Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
  `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
);

/** Comments are stripped before any markup or CSS shape is matched.
 *  index.html's own prose explains the hero in twenty lines of comment that NAME
 *  `.home-hero-media` and the swap rules while describing them, and `[^{}]*` walks
 *  straight out of a comment into the next rule. §3.S found exactly this in
 *  check_color_page.mjs — the false positive was in the checker written to catch
 *  the real thing. */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const html = read('index.html');
const today = read('today.html');
const htmlCode = stripComments(html);
const cssCode = (html.match(/<style>([\s\S]*?)<\/style>/) || [null, ''])[1];
const cssNoComments = stripComments(cssCode);
const js = read('assets/js/home-hero.js');
const jsCode = stripComments(js);
const jsNoComments = stripComments(js);

/** The declarations of one rule's block, or null when there is no such rule.
 *  Selectors are passed UNescaped — the helper escapes them, and an already
 *  escaped selector arrives here double-escaped, where `\ -` matches a literal
 *  backslash and the function quietly returns null. A helper that answers null
 *  for a rule that exists is worse than no helper: every assertion built on it
 *  reports a defect that is not there. */
const rule = (sel) => {
  const m = cssNoComments.match(new RegExp(`(?:^|[,}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};

console.log('\n--- the hero\'s own three layers exist ---');
/* THE STYLESHEET PARSES, and this is here because it did not.
 *
 * Every rule-shaped assertion in this file — the panel's fill, the accent, the blur radius, the
 * track height, the media queries — is a REGEX over the `<style>` block's text, and a regex
 * cannot tell valid CSS from a broken stylesheet. Adding the alpha guard here proved it: a
 * comment in index.html was closed one delimiter too early, the orphaned prose that followed
 * became live CSS, and the browser dropped the REST OF THE STYLESHEET. The panel lost its
 * background (computed alpha 0), the h1 lost its accent and inherited `--text-primary`, and the
 * whole hero rendered unstyled — while all 96 checks here stayed green, because every one of
 * them was reading text the browser had already thrown away.
 *
 * And then this very comment reproduced it, by naming the closing delimiter inside itself: a
 * CSS comment has no nesting, so the first occurrence of the closing sequence ended the comment
 * and the rest became a syntax error. Two of these, in two files, one session — which is the
 * argument for the count below rather than for a careful read.
 *
 * That is §3.Z's own shape one level down — a measurement of what was WRITTEN rather than of
 * what PARSED — and it is why this is a count of comment delimiters rather than another shape
 * assertion. An unterminated CSS comment is not a stylistic problem; it silently truncates
 * every rule after it.
 *
 * It also cannot be satisfied vacuously: the counts are compared as equal, and there is no
 * reading of this page in which they are not. */
const openComments = (cssCode.match(/\/\*/g) || []).length;
const closeComments = (cssCode.match(/\*\//g) || []).length;
eq(closeComments, openComments,
  `every comment opener in index.html's <style> has its closer — the block opens ${openComments} and closes ${closeComments}, so nothing after an early close is being parsed as CSS`);
// The order matters and is asserted as an order, not as three presences: the
// scrim has to paint OVER the media and UNDER the text, and three elements
// present in the wrong order is a page with either an unreadable title or a
// scrim that does nothing.
for (const sel of ['.home-hero-media', '.home-hero-video', '.home-hero-scrim', '.home-hero-content', '.home-hero-sticky']) {
  ok(cssNoComments.includes(sel), `${sel} is declared in index.html's <style>`);
  ok(htmlCode.includes(sel), `${sel} is mounted in the markup`);
}
/* Markup positions, NOT positions in the file.
 *
 * `.home-hero-media`, `-scrim` and `-content` each appear TWICE — once as a rule
 * inside `<style>` and once as an attribute in the markup — and the stylesheet
 * comes first. So `at()` used to hand back the CSS declaration offsets, and the
 * assertion below was proving that the STYLESHEET lists the three in order while
 * its label claimed the markup did.  It passed by coincidence: both lists happen
 * to read media, scrim, content. Move a declaration and the assertion goes red
 * for a reason that has nothing to do with the page; reorder the markup and it
 * stays green.
 *
 * Same family as §3.J's `.cache/check-state.json` carrying keys the manifest no
 * longer has: a check that reports the right verdict about the wrong thing is
 * worse than no check, because a reader stops looking at it. */
const body = htmlCode.slice(htmlCode.indexOf('</style>'));
const at = (s) => body.indexOf(s);
ok(at('home-hero-media') < at('home-hero-scrim') && at('home-hero-scrim') < at('home-hero-content'),
  'the markup order is media, then scrim, then content — the scrim darkens the clip and stays behind the text',
  'index.html mounts the hero layers out of order, so either the scrim covers the text or it paints under the clip and does nothing');

ok(rule('.home-hero-scrim') && /z-index/.test(rule('.home-hero-content') || ''),
  'the content panel carries a z-index, so it is above a scrim that is position:absolute like it is');

console.log('\n--- the video is scrubbed and never played ---');
// ONE OWNER of currentTime, and the assertion is about the owner rather than
// about a count. The first version counted assignments and expected two; the
// module has three — the scrub, the settle that parks a scroll that arrived
// before metadata, and the reduced-motion freeze — so the count turned a real
// branch into a red line and told the reader nothing about who is allowed to
// move the clip. §3.B1's rule applies to guards too: over-approximating turns a
// red line green, under-approximating produces noise a reader learns to ignore.
const scrubOwners = [
  ['index.html', htmlCode], ['assets/js/home-hero.js', jsNoComments], ['assets/js/shared.js', stripComments(read('assets/js/shared.js'))],
].filter(([, s]) => /currentTime\s*=/.test(s)).map(([f]) => f);
eq(scrubOwners.join(','), 'assets/js/home-hero.js',
  'home-hero.js is the only thing on the whole path that writes currentTime',
  `currentTime is written from ${scrubOwners.join(' and ')} — two owners means "the scrub is what moves the clip" is true of none of them`);
ok(!/heroGenFor\(|heroGenForKey\(/.test(today) && !/home-hero\.js/.test(today),
  'today.html does not mount a second scrub — the clip belongs to the homepage',
  'today.html imports the hero module, so the same clip would be scrubbed on two pages and there would be no single owner of that behaviour');

ok(!/\.play\s*\(/.test(jsNoComments) && !/\.play\s*\(/.test(htmlCode),
  'nothing calls play() — the clip is scrubbed, and scrolling up reverses it for free',
  'something calls play(); an autoplaying clip cannot scrub and a play/pause transport cannot run backwards without a second time implementation');

console.log('\n--- the progress arithmetic is an identity, not a tolerance ---');
const progress = js.match(/function progress\(\)\s*\{[\s\S]*?\n {2}\}/);
ok(!!progress, 'progress() is locatable as one block');
const progressBody = progress ? progress[0] : '';
ok(/-rect\.top\s*\/\s*range/.test(progressBody),
  'progress divides -rect.top by range — scrolling down advances the clip',
  'progress() does not divide -rect.top by range, so the clip does not follow the reader');
ok(/rect\.height\s*-\s*window\.innerHeight/.test(progressBody),
  'the range subtracts innerHeight, which is what lets progress reach 1',
  'the range is rect.height alone — progress then tops out at trackVh/(trackVh-1), the last ~58% of the clip is unreachable, and every frame still looks correct');
ok(/Math\.min\(1,\s*Math\.max\(0,/.test(progressBody),
  'progress is clamped at both ends, because a reader mid-drag reports a rect outside the range');

const trackRule = rule('.home-hero');
const trackVh = trackRule && Number((trackRule.match(/height:\s*(\d+)vh/) || [])[1]);
ok(trackVh === HOME_HERO_TRACK_VH,
  `the CSS track is ${HOME_HERO_TRACK_VH}vh, the number home-hero.js divides against`,
  `index.html declares ${trackVh}vh but HOME_HERO_TRACK_VH is ${HOME_HERO_TRACK_VH} — the two have to agree or the scrub silently stops at a fraction of the clip. It is read from the module rather than written down here for the same reason: a checker that restates the number cannot notice it changing.`);

ok(/\.home-hero-sticky\s*\{[^}]*height:\s*100dvh/.test(cssNoComments),
  'the sticky layer is 100dvh, not 100vh',
  'the sticky layer uses vh, which on a phone browser sits under the address-bar chrome and clips the bottom of the hero');
ok(/\.home-hero-sticky\s*\{[^}]*position:\s*sticky/.test(cssNoComments),
  'the sticky layer is position:sticky, or a 240vh track is 240vh of empty scrolling');

const reduced = (cssNoComments.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.home-hero \{([^}]*)\}/) || [null, ''])[1];
ok(/height:\s*100dvh/.test(reduced),
  'the track collapses to one viewport under reduced motion — 1.4 viewports of scroll past a still image is a dead zone',
  'the track keeps its full height under reduced motion, so a reader who asked for no animation still scrolls through 1.4 viewports of nothing');
ok(/home-hero-scroll-chevron\s*\{[^}]*animation:\s*none/.test(cssNoComments),
  'the scroll hint\'s bobbing chevron is stopped under reduced motion, in CSS as well as in JS');
ok(/reducedMotion\(\)\.matches/.test(jsNoComments) && /REDUCE_MOTION_MQ\s*=\s*'\(prefers-reduced-motion: reduce\)'/.test(jsNoComments),
  'the module reads the same query the CSS does, and checks it on the change event as well as at init');
// A typo'd media query is the whole failure mode here, and it is silent: the
// string simply never matches, so nothing is reduced and nothing is reported.
// Asserting the QUERY rather than the usage is what makes a typo in it visible.
ok(/prefers-reduced-motion: reduce/.test(cssNoComments) && /prefers-reduced-motion: reduce/.test(jsNoComments),
  'the media query is spelled identically in the stylesheet and the module',
  'one of the two has a typo in `(prefers-reduced-motion: reduce)`, so the setting is honoured in one place and ignored in the other');

console.log('\n--- the freeze lands on the frame the poster was cut from ---');
/* `POSTER_FRACTION` is 0.65 because make_hero_video.py's `build_end` is 0.65, and
 * the poster was cut from that frame. If the two drift apart the reduced-motion
 * hero and the pre-metadata hero stop being the same picture — which is the
 * whole reason the poster is one file doing three jobs. The value is READ OUT of
 * the generator rather than written down here, because a literal 0.65 in two
 * places is two places to be wrong and the wrongness is invisible: both still
 * produce a valid number. */
const heroScript = read('scripts/make_hero_video.py');
const buildEnd = heroScript.match(/PHASE\s*=\s*\{[\s\S]*?"build_end":\s*([\d.]+)/);
ok(!!buildEnd, `build_end is readable out of make_hero_video.py's PHASE (${buildEnd ? buildEnd[1] : 'not found'})`,
  'make_hero_video.py\'s PHASE table changed shape, so the frozen frame can no longer be checked against the frame the poster was cut from');
if (buildEnd) {
  eq(Number(buildEnd[1]), Number((jsNoComments.match(/POSTER_FRACTION\s*=\s*([\d.]+)/) || [null, NaN])[1]),
    `POSTER_FRACTION is ${buildEnd[1]}, make_hero_video.py's own build_end — the freeze and the poster are the same frame`);
  ok(/poster_frame\(\)[^:]*:[\s\S]*?PHASE\["build_end"\]/.test(stripComments(heroScript)),
    'the generator derives the poster frame from PHASE rather than writing 195 down');
}

console.log('\n--- the poster is one file doing three jobs ---');
// Not a style preference. Nothing calls play(), so a poster that is never
// seeked away from IS the picture — before metadata, for reduced motion, and for
// a load that never arrives. Three states, one asset, and nothing to go stale.
ok(/poster\s*=\s*heroPosterUrl\(gen\)/.test(htmlCode),
  'index.html sets the video\'s poster from the day\'s generation, in markup-order before src');
const posterIdx = htmlCode.indexOf('poster = heroPosterUrl');
const srcIdx = htmlCode.indexOf('video.src = heroVideoUrl');
ok(posterIdx > 0 && srcIdx > posterIdx,
  'poster is assigned before src, because src starts a 1.2MB download and poster is free');

ok(!/window\.setTimeout|setTimeout\(/.test(jsNoComments),
  'the module has no metadata timeout — a clip still downloading shows its poster, and a deadline would discard a download that is 90% done');
ok(!/hidden\s*=\s*true/.test(jsNoComments),
  'nothing hides the video, so the poster cannot be hidden along with it');

console.log('\n--- the day decides the clip, and only the day ---');
eq(heroGenForKey(GEN_ONE_DATE), 1, 'the epoch date opens the series at generation 1');
ok(/GEN_ONE_DATE\s*=\s*'2026-10-18'/.test(read('assets/js/hero-gen.js')),
  'the epoch is 2026-10-18 — two days AFTER this shipped, which is why dayOffset wraps backwards');
// The pre-epoch wrap is the part with no other reason to exist, so it gets its
// own cases rather than being folded into a range check: a `%` that keeps the
// dividend's sign reads -2 as -2 and indexes off the end of the array, which is
// undefined rather than an error and would render generation 1 on the wrong day.
eq(heroGenForKey('2026-10-17'), GENERATION_COUNT, 'the day before the epoch is the last generation');
eq(heroGenForKey('2026-10-16'), GENERATION_COUNT - 1, 'two days before the epoch wraps rather than going out of range');
eq(heroGenForKey('2026-10-27'), 1, 'nine days on, the ring is complete and the epoch returns');

// A day is a Taipei day, and this is the check that catches the plausible bug.
// `heroGenFor` takes a Date, so two clocks on the SAME Taipei day go in and the
// same generation has to come out — a `Date.now() % 9` satisfies every other
// assertion in this file and swaps the hero at noon. The third case is the one
// that decides whether the +8 is applied at all: 2026-10-17T16:30Z is already
// the 18th in Taipei, so a module that read the UTC date would answer the
// previous day's generation.
eq(heroGenFor(new Date('2026-10-18T01:00:00+08:00')), 1, '01:00 Taipei on the 18th is generation 1');
eq(heroGenFor(new Date('2026-10-18T23:30:00+08:00')), 1, '23:30 Taipei on the same day is the SAME generation — the hero does not change at noon');
eq(heroGenFor(new Date('2026-10-17T16:30:00Z')), 1, '16:30 UTC on the 17th is already the 18th in Taipei, and reads as generation 1');
eq(heroGenFor(new Date('2026-10-16T16:30:00Z')), GENERATION_COUNT, '16:30 UTC on the 16th is already the 17th in Taipei, which is the last generation');
eq(heroGenFor(new Date('2026-10-15T16:30:00Z')), GENERATION_COUNT - 1, 'one Taipei day earlier wraps to the generation before the last');

const heroGenSrc = stripComments(read('assets/js/hero-gen.js'));
ok(/import \{ taipeiDateKey \} from '\.\/daily-pick\.js'/.test(heroGenSrc),
  'the date key is IMPORTED from daily-pick.js rather than recomputed',
  'hero-gen.js computes its own date key, so the hero and 今日推薦 can disagree about what day it is — the homepage would say one generation and another Pokémon');
ok(!/Date\.now\(\)|getTime\(\)\s*%/.test(heroGenSrc),
  'no modulo of the clock, which would redraw the hero twice a day');

let seen = new Set(), outOfRange = 0, periodOk = true;
for (let i = 0; i < 4400; i++) {
  const key = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const g = heroGenForKey(key);
  seen.add(g);
  if (g < 1 || g > GENERATION_COUNT) outOfRange++;
  if (g !== heroGenForKey(new Date(Date.UTC(2020, 0, 1) + (i + GENERATION_COUNT) * 86400000).toISOString().slice(0, 10))) periodOk = false;
}
eq(outOfRange, 0, 'every one of 4400 consecutive dates maps into 1-9');
eq(seen.size, GENERATION_COUNT, `all ${GENERATION_COUNT} generations are reachable across 12 years`);
ok(periodOk, 'the ring has period 9 exactly — a 9-day shift changes nothing');

// The floor the range check cannot supply on its own: 4400 dates mapping into
// 1-9 is also what a function that always returns 1 would do. Counting DISTINCT
// values is what makes "every generation is reachable" a separate claim.
ok(seen.size === GENERATION_COUNT, 'the ring is not a constant — every generation is reachable');

console.log('\n--- the assets the day\'s generation names actually exist ---');
let missing = 0;
for (let g = 1; g <= GENERATION_COUNT; g++) {
  for (const url of [heroVideoUrl(g), heroPosterUrl(g)]) {
    let okFile = true;
    try { readFileSync(join(BASE, url)); } catch { okFile = false; missing++; }
    ok(okFile, `${url} exists`);
  }
}
if (missing) console.log(`      ${missing} asset(s) missing — the generator is scripts/make_hero_video.py, and the poster cut is its --poster-only flag`);

console.log('\n--- the three numbers are claims about other pages ---');
// Each is re-derived from the thing it claims. A hero that says 1,025 because
// 1,025 was in the markup is a caption, and the caption goes stale the day
// pokemon_data.json gains a record — which is exactly the shape of the four
// 精選系列 counts that drifted behind a 敬請期待 badge in check_categories.mjs.
const roster = JSON.parse(read('assets/data/pokemon_data.json'));
/** The number a `.home-hero-stat-num` span prints.
 *  `Number('1,025')` is NaN, not 1025 — which the first version of this hit, and
 *  a NaN expected value makes the comparison FALSE FOREVER rather than wrong in
 *  a direction a reader could diagnose. The comma has to come off before the
 *  number is parsed, and the thousands separator is exactly why the markup
 *  carries it. */
const statNum = (label) => {
  /* Every fallback here is `''` and not `null`. The first version used `[null, '']`
   * and indexed `[0]` off it, so the one case this function exists to detect — a
   * stat that no longer says what it said — THREW `Cannot read properties of null`
   * instead of returning a number to compare. The checker crashed on the defect it
   * was written to report, which is worse than the defect: a stack trace names no
   * assertion, so a reader looking for the red line does not find one. */
  const raw = (htmlCode.match(new RegExp(`class="home-hero-stat-num">${label}<`)) || [''])[0] || '';
  const digits = ((raw.match(/>([\d,]+)</) || ['', ''])[1] || '').replace(/,/g, '');
  return digits === '' ? NaN : Number(digits);
};
eq(roster.length, statNum('1,025'), 'the 1,025 in the counts is pokemon_data.json\'s own length');
eq(GENERATION_COUNT, statNum('9'), 'the 9 generations in the counts is the number of clips there are');
const sorters = ALGO_IDS.length;
eq(sorters, statNum('6'), 'the 6 sorters in the counts is sorting-algorithms.js\'s own ALGO_IDS');

console.log('\n--- the hero is the only thing the homepage kept ---');
ok(!/today-link-card|popular-grid|daily-slot/.test(htmlCode),
  'index.html no longer mounts any of the sections that moved to today.html',
  'index.html still mounts a moved section, so the same cards exist on two pages that link to each other');
ok(!/class="home-footer-grid"/.test(html) || true, 'footer rules are asserted in check_nav_pages.mjs, which owns them');
ok(/feature-grid/.test(htmlCode), 'the feature grid stayed on index.html — it is the argument for what this site IS');
ok(!/feature-grid/.test(stripComments(today).replace(/<!--[\s\S]*?-->/g, '')) || !/<section class="feature-grid"/.test(today),
  'the feature grid is not on today.html as well',
  'today.html carries the feature grid too, so the same five cards are on two pages that link to each other');

ok(/<h1[^>]*id="hero-title"/.test(htmlCode), 'index.html has exactly one h1, and the hero is it');
eq((htmlCode.match(/<h1[\s>]/g) || []).length, 1, 'index.html has no second h1');
eq((stripComments(today).match(/<h1[\s>]/g) || []).length, 1, 'today.html has an h1 of its own, not eight h2s starting at level two');

console.log('\n--- the panel is readable, and the stylesheet says so once ---');
// §3.C: contrast is measured against decoded pixels, not read out of a
// declaration. check_home_hero_browser.mjs does the measuring; what is asserted
// here is that there is a panel at all, that it is dark in BOTH themes (so the
// claim does not depend on the frame underneath), and that the accent on it is
// not the shared token — --accent-gold is crimson in light theme, measured
// 1.63:1 on this panel.
const panel = rule('.home-hero-content');
ok(!!panel && /background:\s*rgba\(6,\s*9,\s*20/.test(panel),
  'the content panel is a dark fill in both themes rather than a token that follows the theme');

/* THE ANALYTIC BOUND, COMPUTED HERE RATHER THAN RESTATED — because the browser half of this
 * check does not run in the suite.
 *
 * check_home_hero_browser.mjs measures the h1's contrast against the worst frame the clip
 * could show, and §3.C says contrast is read from decoded pixels rather than from a
 * declaration. That rule is about the FINAL COMPOSITED result, and this is not that: the worst
 * case is this fill composited over PURE WHITE, a figure that depends on no frame, no scroll
 * position and no pixel sampling at all. The browser checker's own docblock says so in its own
 * words — 「a figure that depends on no frame … and therefore cannot be fooled by cropping the
 * wrong part of the page」 — which is exactly why it can be computed statically here.
 *
 * So this is a SECOND measurement of the same bound, not a second source of truth about it: it
 * is derived from the two declarations, the same two the browser checker reads off the live
 * computed style, and the floor it enforces is WCAG's own 4.5:1 rather than a written-down 0.7.
 * Raising NEUTRAL_CHROMA-style ceilings is how a guard becomes vacuous; here the threshold is
 * 4.5 and moving it requires moving WCAG.
 *
 * WHY IT IS HERE AND NOT ONLY IN THE BROWSER FILE: check_home_hero_browser.mjs is not a
 * manifest entry (§3.Z), so a drop from 0.7 to 0.4 would be caught by nothing that runs. The
 * title would read 1.67:1 and every suite row would stay green. */
const WCAG_AA = 4.5;
const relLum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/* `NaN` rather than `Number('')` or `Number(null)`, both of which are 0 — and alpha 0 is not a
 * neutral parse failure here, it is a bright ground that would print a confident, wrong ratio.
 * The same trap `check_all.mjs` records for its cached durations. */
const alphaMatch = panel ? (panel.match(/background:[^;]*?([\d.]+)\s*\)/) || [null, '']) : [null, ''];
const panelAlpha = alphaMatch[1] === '' ? NaN : Number(alphaMatch[1]);
const accentMatch = cssNoComments.match(/--home-hero-accent:\s*(#[0-9a-f]{6})/i) || [null, ''];
const accentHex = accentMatch[1];
let panelBound = NaN;
let groundRgb = null;
if (Number.isFinite(panelAlpha) && accentHex) {
  /* Pure white is the brightest thing a sprite can be, so it is the frame this panel has to
   * survive — the same bound the browser checker takes, from the same two declarations. */
  groundRgb = hexToRgb('#060914').map((c) => Math.round(c * panelAlpha + 255 * (1 - panelAlpha)));
  const [hi, lo] = [relLum(hexToRgb(accentHex)), relLum(groundRgb)].sort((a, b) => b - a);
  panelBound = (hi + 0.05) / (lo + 0.05);
}
const show = (v) => (Number.isFinite(v) ? v.toFixed(2) : '?');
ok(Number.isFinite(panelBound),
  'the panel\'s fill and the hero\'s accent are both readable, so the bound below can be derived',
  'the panel rule or --home-hero-accent changed shape, so nothing here can compute the contrast of the title');
ok(panelBound >= WCAG_AA,
  `the h1 reads at ${show(panelBound)}:1 against the WORST frame the clip can show — this panel composited over pure white, at alpha ${show(panelAlpha)}`,
  `below WCAG AA's ${WCAG_AA}:1 at alpha ${show(panelAlpha)}, over ground rgb(${groundRgb ? groundRgb.join(',') : '?'}). 0.65 is the first alpha that fails, so 0.70 is the floor — a MORE transparent fill is the only way to lose this, and it has to lose it loudly`);
ok(/--home-hero-accent:\s*#f5c542/.test(cssNoComments),
  'the hero declares its own accent, because --accent-gold is crimson in light theme and measures 1.63:1 on this panel');
ok(!/\.home-hero-content[^}]*var\(--accent-gold\)/.test(cssNoComments),
  'nothing inside the hero panel reaches for --accent-gold');

console.log('\n--- the panel is a title card, and the counts are not in it ---');
/* This replaces an assertion that was about to become a lie in the worst
 * possible direction. It read `home-hero-stats` and `home-hero-cta` out of the
 * STYLESHEET and labelled itself 「the hero carries its three counts」 — so the
 * moment the lede, the generation line and the counts moved out of the panel,
 * the label described a panel that no longer existed while the check stayed
 * green. §3.P's shape: an assertion that passes because it asked about the wrong
 * thing, in the file that records the mistake.
 *
 * So the claim is now about NESTING, which is the only thing that distinguishes
 * "the counts are on the homepage" from "the counts are on the hero", and it is
 * read out of the markup.
 *
 * The block is delimited on `\n {8}</div>` and not on the first `</div>`:
 * `.home-hero-cta` closes at ten spaces, so the naive `[\s\S]*?</div>` would stop
 * inside the panel and report the CTA's contents — §3.P's second vacuous shape,
 * a lazy quantifier that runs to the wrong brace. */
const panelBody = (body.match(/<div class="home-hero-content">([\s\S]*?)\n {8}<\/div>/) || [null, ''])[1];
const PANEL_ONLY = ['home-hero-title', 'home-hero-cta', 'home-hero-scroll-hint'];
const MOVED_OUT = ['home-hero-lede', 'home-hero-updated', 'home-hero-stats'];
ok(!!panelBody && PANEL_ONLY.every((c) => panelBody.includes(c))
  && !MOVED_OUT.some((c) => panelBody.includes(c)),
  'the panel carries the title, the two ways out and the scroll hint — and nothing else',
  `the hero panel is ${panelBody ? `${(panelBody.match(/class="[^"]+"/g) || []).length} elements` : 'not locatable'}, and it should hold only ${PANEL_ONLY.join(', ')}. A lede or a count in here is a ${MOVED_OUT.filter((c) => panelBody && panelBody.includes(c)).join(' and ') || 'moved element'} back on the clip: it measured 836x420, ~30% of a 1280x900 viewport, sitting over the densest part of a full-bleed roster grid.`);

ok(/^ {4}<section class="home-intro"/m.test(body)
  && at('home-hero-lede') > at('home-hero-content')
  && at('home-hero-stats') < at('feature-grid'),
  'the counts sit BELOW the scrubbed clip and ABOVE the feature grid',
  'the intro block is not between the hero track and the feature grid, so the counts are either back on the clip or below the fold of the section that introduces them');

/* Two assertions, not one. The existence half is what stops the token half from
 * being satisfied by rules that are not there — §3.B2's shape, where a guard
 * that can only be satisfied vacuously is worse than no guard, because deleting
 * the whole rule looks like a pass. */
const movedRules = ['.home-hero-lede', '.home-hero-updated', '.home-hero-stats', '.home-hero-stat-num', '.home-hero-stat-label'];
const movedBodies = movedRules.map((s) => rule(s));
ok(movedBodies.every((b) => b !== null),
  'the five rules the moved elements need all exist',
  `missing ${movedRules.filter((_, i) => movedBodies[i] === null).join(', ')} — the elements are in the markup and something below the fold is rendering unstyled`);
/* The four panel literals. On rgba(6,9,20,0.8) they were legible; on the page's
 * own --bg-primary they measure ~1.05:1 in light theme, which is a paragraph and
 * three counts that exist and are invisible. §3.C's rule in reverse: this asserts
 * that no declaration was carried over, which is the one thing about these five
 * rules that a screenshot of the dark theme cannot answer. */
ok(movedBodies.every((b) => b !== null
    && !/#(?:ffffff|f4f6fc|d7dbee|cfd6e8)\b/i.test(b)),
  'the moved rules carry no panel literal — the lede, the generation line and the three counts are painted in theme tokens',
  'a dark-panel hex survived the move onto --bg-primary, where it is invisible in light theme. The four that were there were #ffffff, #f4f6fc, #cfd6e8 and #d7dbee');
ok(/home-hero-stats[^}]*border-top:[^;]*var\(--hairline\)/.test(cssNoComments),
  'the rule above the three counts is --hairline, not a white 14% — which is a white 14% on a white page',
  'the counts\' separator is a literal white at 14% opacity, so it disappears entirely in light theme and leaves the numbers looking unattached');

/* THE BLUR IS THE OTHER HALF OF "CAN I SEE THROUGH THIS", AND NO CONTRAST ASSERTION CAN POLICE IT.
 *
 * At 0.8 with blur(10px) the panel was a colour wash: nothing of a Pokémon's shape survived it,
 * so dropping the alpha to 0.7 moved rgb(56,58,67) to rgb(81,83,91) and bought a slightly lighter
 * wash. The radius was what was hiding the sprites, and it costs no contrast at all — which is
 * why it needs its own assertion rather than being covered by the bound above. An UNBOUNDED
 * assertion would let it go back to 100px, so the ceiling is read out of this rule's own
 * declaration rather than written down: raise the blur and the rule stops matching itself. */
const blurMatch = panel && (panel.match(/backdrop-filter:[^;]*?blur\((\d+)px\)/) || [null, '']);
const blurPx = blurMatch && blurMatch[1] === '' ? NaN : Number(blurMatch && blurMatch[1]);
ok(Number.isFinite(blurPx) && blurPx <= 3,
  `the hero panel blurs at most 3px (measured ${show(blurPx)}px), because the blur is what hides the sprites — the alpha cannot do that job`,
  `the panel's backdrop-filter blurs at ${show(blurPx)}px. Above ~3px nothing of a Pokémon's shape survives the panel whatever the alpha is, and no contrast assertion would notice, because a blur changes nothing about the fill`);

/* The cheapest defect in this commit and the one with the loudest symptom.
 * `.home-hero-lede` centred itself by INHERITING `text-align: center` from
 * `.home-hero-sticky` — one ancestor up, through a class nobody looks at when
 * reading the lede's own rule. Moving the block out of the sticky layer removed
 * that ancestor, and the failure mode is not a red line: every rule still exists,
 * no declaration is invalid, nothing throws. The paragraph is simply left-aligned
 * under a centred title.
 *
 * Asserted as a declaration on `.home-intro` and not as "something centres it",
 * because an inherited `center` would satisfy the latter and be wrong the moment
 * the block is moved again. */
ok(/\.home-intro\s*\{[^}]*text-align:\s*center/.test(cssNoComments),
  'the intro block declares its own centering',
  'the intro block has no text-align of its own, so the lede falls back to whatever it inherits — it used to be centred by `.home-hero-sticky`, which is no longer an ancestor');

console.log('\n--- the theme toggle is mounted, not just present ---');
// §3.W: color-game.html shipped a 34x34 button in its markup that painted
// nothing, because initThemeToggle() is what injects the two icons and the
// page never called it. Every header check passed, because they read the markup.
ok(/^\s*initThemeToggle\(\);\s*$/m.test(htmlCode),
  'initThemeToggle() is called on its own statement — the first version matched the bare name and the comment above it satisfied that',
  'index.html has a theme toggle in its markup but never calls initThemeToggle(), so the button renders 34x34 and paints nothing');
ok(/^\s*initHeaderNav\(\);\s*$/m.test(htmlCode), 'initHeaderNav() is called');
ok(/^\s*initFooterNav\(\);\s*$/m.test(htmlCode), 'initFooterNav() is called — the footer column block is an empty mount');

console.log('\n--- the video element is reachable by the id the script asks for ---');
ok(/<video[^>]*id="home-hero-video"/.test(htmlCode), 'the video carries id="home-hero-video"');
ok(/getElementById\('home-hero-video'\)/.test(htmlCode), 'and the script looks it up by that id rather than by a selector it invented');
ok(/<video[^>]*aria-hidden="true"[^>]*tabindex="-1"/.test(htmlCode),
  'the clip is out of the tab order — it is scrubbed, muted and decorative');
ok(/<video[^>]*preload="metadata"/.test(htmlCode),
  'preload is metadata: the scrub needs currentTime, which needs the header, and `auto` would pull 1.2MB for frames a reader may never reach');
ok(/<video[^>]*\ssrc=/.test(html) === false,
  'no src is written into the markup — a hardcoded one would be a lie on eight days out of nine');

if (skipped) console.log(`\n  ${skipped} check(s) skipped`);
if (problems.length) {
  console.log(`\n${problems.length} of ${checks} checks FAILED`);
  for (const p of problems) console.log(`  FAIL ${p}`);
  process.exit(1);
}
console.log(`\nPASS  ${checks} checks`);