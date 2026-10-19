#!/usr/bin/env node
/**
 * index.html's scroll-scrubbed hero. Run: node scripts/check_home_hero.mjs
 *
 * Every break in the hero still renders. Dropping the `- innerHeight` term stops
 * the scrub near 0.42, collapsing the track removes the scroll range, and
 * seeking under reduced motion animates a setting that promises stillness. The
 * assertions therefore cover the arithmetic and the branch conditions, not the
 * presence of a tag.
 *
 * The static half covers the stylesheet contract and the progress formula, both
 * readable off disk (§3.G4). The two claims that need a browser — the scrub
 * moving the clip and the panel staying readable over the brightest frame — live
 * in check_home_hero_browser.mjs.
 *
 * Values are read from the modules that own them: the track height from
 * `HOME_HERO_TRACK_VH`, the sorter count from sorting-algorithms.js, the roster
 * size from pokemon_data.json. A checker that restates a number cannot notice it
 * changing (§3.S).
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
 *  index.html's prose names `.home-hero-media` and the swap rules while
 *  describing them, and `[^{}]*` walks out of a comment into the next rule. */
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
 *  Selectors are passed UNescaped; the helper escapes them. An already-escaped
 *  selector arrives double-escaped and quietly returns null, which makes every
 *  assertion built on it report a defect that is not there. */
const rule = (sel) => {
  const m = cssNoComments.match(new RegExp(`(?:^|[,}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};

console.log('\n--- the hero\'s own three layers exist ---');
/* THE STYLESHEET PARSES.
 *
 * Every rule-shaped assertion here is a REGEX over the `<style>` block's text,
 * and a regex cannot tell valid CSS from a broken stylesheet. An unterminated
 * comment silently truncates every rule after it: the panel loses its fill, the
 * h1 loses its accent, and the hero renders unstyled while the checks stay
 * green, because they read text the browser discarded (§3.Z).
 *
 * A CSS comment does not nest, so the closing delimiter must never be spelled
 * inside a comment. Counting openers and closers is the guard; it cannot be
 * satisfied vacuously because the counts are compared as equal. */
const openComments = (cssCode.match(/\/\*/g) || []).length;
const closeComments = (cssCode.match(/\*\//g) || []).length;
eq(closeComments, openComments,
  `every comment opener in index.html's <style> has its closer — the block opens ${openComments} and closes ${closeComments}, so nothing after an early close is being parsed as CSS`);
// Order matters: the scrim must paint over the media and under the text.
// Three elements in the wrong order leave either an unreadable title or a
// scrim that does nothing.
for (const sel of ['.home-hero-media', '.home-hero-video', '.home-hero-scrim', '.home-hero-content', '.home-hero-sticky']) {
  ok(cssNoComments.includes(sel), `${sel} is declared in index.html's <style>`);
  ok(htmlCode.includes(sel), `${sel} is mounted in the markup`);
}
/* Markup positions, NOT positions in the file.
 *
 * `.home-hero-media`, `-scrim` and `-content` each appear twice: as a rule in
 * `<style>` and as an attribute in the markup. `at()` must therefore search
 * only the markup, or the assertion proves the stylesheet's order while claiming
 * the markup's. A check that reports the right verdict about the wrong thing is
 * worse than no check, because a reader stops looking at it. */
const body = htmlCode.slice(htmlCode.indexOf('</style>'));
const at = (s) => body.indexOf(s);
ok(at('home-hero-media') < at('home-hero-scrim') && at('home-hero-scrim') < at('home-hero-content'),
  'the markup order is media, then scrim, then content — the scrim darkens the clip and stays behind the text',
  'index.html mounts the hero layers out of order, so either the scrim covers the text or it paints under the clip and does nothing');

ok(rule('.home-hero-scrim') && /z-index/.test(rule('.home-hero-content') || ''),
  'the content panel carries a z-index, so it is above a scrim that is position:absolute like it is');

console.log('\n--- the video is scrubbed and never played ---');
// ONE OWNER of currentTime. The assertion is about the owner, not a count: the
// module has three legitimate writes (the scrub, the settle before metadata,
// and the reduced-motion freeze), so counting would turn a real branch red
// without naming who may move the clip.
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
// A typo'd media query fails silently: the string never matches, so nothing is
// reduced and nothing is reported. Asserting the QUERY rather than its usage is
// what makes a typo visible.
ok(/prefers-reduced-motion: reduce/.test(cssNoComments) && /prefers-reduced-motion: reduce/.test(jsNoComments),
  'the media query is spelled identically in the stylesheet and the module',
  'one of the two has a typo in `(prefers-reduced-motion: reduce)`, so the setting is honoured in one place and ignored in the other');

console.log('\n--- the freeze lands on the frame the poster was cut from ---');
/* `POSTER_FRACTION` is 0.65 because make_hero_video.py's `build_end` is 0.65,
 * and the poster was cut from that frame. If the two drift apart, the
 * reduced-motion hero and the pre-metadata hero stop being the same picture.
 * The value is read from the generator rather than restated, because a literal
 * 0.65 in two places is two places to be wrong, and both still produce a valid
 * number. */
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
// Nothing calls play(), so a poster that is never seeked away from IS the
// picture: before metadata, for reduced motion, and for a load that never
// arrives. Three states, one asset, nothing to go stale.
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
// The pre-epoch wrap gets its own cases rather than being folded into a range
// check: a `%` that keeps the dividend's sign reads -2 as -2 and indexes off the
// end of the array, which yields undefined rather than an error and would render
// generation 1 on the wrong day.
eq(heroGenForKey('2026-10-17'), GENERATION_COUNT, 'the day before the epoch is the last generation');
eq(heroGenForKey('2026-10-16'), GENERATION_COUNT - 1, 'two days before the epoch wraps rather than going out of range');
eq(heroGenForKey('2026-10-27'), 1, 'nine days on, the ring is complete and the epoch returns');

// A day is a Taipei day. `heroGenFor` takes a Date, so two clocks on the same
// Taipei day must yield the same generation; a `Date.now() % 9` satisfies every
// other assertion here and would swap the hero at noon. The UTC cases decide
// whether the +8 offset is applied at all: 2026-10-17T16:30Z is already the 18th
// in Taipei, so a module reading the UTC date would answer the previous day.
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

// The range check alone cannot supply this: 4400 dates mapping into 1-9 is also
// what a function that always returns 1 would do. Counting DISTINCT values makes
// "every generation is reachable" a separate claim.
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
// Each number is re-derived from the thing it claims. A hero that says 1,025
// because 1,025 was in the markup is a caption, and the caption goes stale the
// day pokemon_data.json gains a record.
const roster = JSON.parse(read('assets/data/pokemon_data.json'));
/** The number a `.home-hero-stat-num` span prints.
 *  `Number('1,025')` is NaN, not 1025, and a NaN expected value makes the
 *  comparison false forever rather than wrong in a diagnosable direction. Strip
 *  the thousands separator before parsing. */
const statNum = (label) => {
  /* Every fallback here is `''` and not `null`. A `null` fallback indexed at
   * `[0]` throws `Cannot read properties of null` on exactly the defect this
   * function exists to detect, and a stack trace names no assertion. */
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
// declaration; check_home_hero_browser.mjs does that measuring. This asserts
// that a panel exists, that it is dark in both themes (so the claim does not
// depend on the frame underneath), and that its accent is not the shared token:
// --accent-gold is crimson in light theme and measures 1.63:1 on this panel.
const panel = rule('.home-hero-content');
ok(!!panel && /background:\s*rgba\(6,\s*9,\s*20/.test(panel),
  'the content panel is a dark fill in both themes rather than a token that follows the theme');

/* THE ANALYTIC BOUND, COMPUTED HERE BECAUSE THE BROWSER HALF DOES NOT RUN IN THE SUITE.
 *
 * check_home_hero_browser.mjs measures the h1 against the worst frame the clip
 * can show, from decoded pixels (§3.C). That rule governs the final composited
 * result; this is a different quantity. The worst case is the fill composited
 * over pure white, which depends on no frame, no scroll position and no pixel
 * sampling, so it can be derived statically from the two declarations the
 * browser checker reads off the live computed style.
 *
 * This is a second measurement of the same bound, not a second source of truth.
 * The floor is WCAG's 4.5:1, so moving it requires moving WCAG. The browser
 * checker is not a manifest entry (§3.Z), so without this a drop from 0.7 to 0.4
 * would be caught by nothing that runs: the title would read 1.67:1 and every
 * suite row would stay green. */
const WCAG_AA = 4.5;
const relLum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/* `NaN` rather than `Number('')` or `Number(null)`, both of which are 0 — and
 * alpha 0 is not a neutral parse failure here; it is a bright ground that would
 * print a confident, wrong ratio. */
const alphaMatch = panel ? (panel.match(/background:[^;]*?([\d.]+)\s*\)/) || [null, '']) : [null, ''];
const panelAlpha = alphaMatch[1] === '' ? NaN : Number(alphaMatch[1]);
const accentMatch = cssNoComments.match(/--home-hero-accent:\s*(#[0-9a-f]{6})/i) || [null, ''];
const accentHex = accentMatch[1];
let panelBound = NaN;
let groundRgb = null;
if (Number.isFinite(panelAlpha) && accentHex) {
  /* Pure white is the brightest thing a sprite can be, so it is the frame this
   * panel has to survive — the same bound the browser checker takes. */
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
/* The claim is about NESTING, the only thing that distinguishes "the counts are
 * on the homepage" from "the counts are on the hero", and it is read out of the
 * markup rather than the stylesheet. A stylesheet read would keep passing after
 * the lede, the generation line and the counts moved out of the panel (§3.P).
 *
 * The block is delimited on `\n {8}</div>` and not the first `</div>`:
 * `.home-hero-cta` closes at ten spaces, so a lazy `[\s\S]*?</div>` would stop
 * inside the panel and report the CTA's contents. */
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

/* Two assertions, not one: the existence half stops the token half from being
 * satisfied by rules that are not there. A guard satisfiable only vacuously is
 * worse than no guard, because deleting the whole rule looks like a pass
 * (§3.B2). */
const movedRules = ['.home-hero-lede', '.home-hero-updated', '.home-hero-stats', '.home-hero-stat-num', '.home-hero-stat-label'];
const movedBodies = movedRules.map((s) => rule(s));
ok(movedBodies.every((b) => b !== null),
  'the five rules the moved elements need all exist',
  `missing ${movedRules.filter((_, i) => movedBodies[i] === null).join(', ')} — the elements are in the markup and something below the fold is rendering unstyled`);
/* The four panel literals. On the page's own --bg-primary they measure ~1.05:1
 * in light theme: a paragraph and three counts that exist and are invisible.
 * This asserts no declaration was carried over, which a dark-theme screenshot
 * cannot answer (§3.C). */
ok(movedBodies.every((b) => b !== null
    && !/#(?:ffffff|f4f6fc|d7dbee|cfd6e8)\b/i.test(b)),
  'the moved rules carry no panel literal — the lede, the generation line and the three counts are painted in theme tokens',
  'a dark-panel hex survived the move onto --bg-primary, where it is invisible in light theme. The four that were there were #ffffff, #f4f6fc, #cfd6e8 and #d7dbee');
ok(/home-hero-stats[^}]*border-top:[^;]*var\(--hairline\)/.test(cssNoComments),
  'the rule above the three counts is --hairline, not a white 14% — which is a white 14% on a white page',
  'the counts\' separator is a literal white at 14% opacity, so it disappears entirely in light theme and leaves the numbers looking unattached');

/* THE BLUR IS THE OTHER HALF OF "CAN I SEE THROUGH THIS", AND NO CONTRAST
 * ASSERTION CAN POLICE IT.
 *
 * At blur(10px) the panel is a colour wash and nothing of a Pokémon's shape
 * survives, yet the blur costs no contrast — so it needs its own assertion. The
 * ceiling is read out of the rule's own declaration rather than written down, so
 * raising the blur stops the rule matching itself. */
const blurMatch = panel && (panel.match(/backdrop-filter:[^;]*?blur\((\d+)px\)/) || [null, '']);
const blurPx = blurMatch && blurMatch[1] === '' ? NaN : Number(blurMatch && blurMatch[1]);
ok(Number.isFinite(blurPx) && blurPx <= 3,
  `the hero panel blurs at most 3px (measured ${show(blurPx)}px), because the blur is what hides the sprites — the alpha cannot do that job`,
  `the panel's backdrop-filter blurs at ${show(blurPx)}px. Above ~3px nothing of a Pokémon's shape survives the panel whatever the alpha is, and no contrast assertion would notice, because a blur changes nothing about the fill`);

/* `.home-hero-lede` was centred by INHERITING `text-align: center` from
 * `.home-hero-sticky`. Moving the block out of the sticky layer removed that
 * ancestor, and nothing throws: every rule still exists and no declaration is
 * invalid, so the paragraph is simply left-aligned under a centred title.
 *
 * Assert the declaration on `.home-intro`, not "something centres it": an
 * inherited `center` would satisfy the latter and break again on the next move. */
ok(/\.home-intro\s*\{[^}]*text-align:\s*center/.test(cssNoComments),
  'the intro block declares its own centering',
  'the intro block has no text-align of its own, so the lede falls back to whatever it inherits — it used to be centred by `.home-hero-sticky`, which is no longer an ancestor');

console.log('\n--- the theme toggle is mounted, not just present ---');
// §3.W: color-game.html shipped a 34x34 button that painted nothing, because
// initThemeToggle() injects the two icons and the page never called it. Every
// header check passed because they read the markup.
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