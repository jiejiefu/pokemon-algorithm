#!/usr/bin/env node
/**
 * Verify cries.html against the data it claims to show and the language it
 * claims to speak.
 *
 * Run: node scripts/check_cries_page.mjs
 * Test: node scripts/test_check_cries_page.mjs
 *
 * WHY THIS FILE EXISTS WHEN check_cry_features.mjs ALREADY CHECKS THE DATA
 *
 * The feature table is guarded. What is not guarded is the page's claims about
 * it, and on this page the claims are the product. A similarity search that is
 * quietly wrong looks exactly like one that is working: it returns twelve rows,
 * they are all real Pokémon, and the reader has no way to tell that the ranking
 * was decided by two dimensions out of thirty-four. So this file checks the
 * things that would make the page lie:
 *
 *   - that it reads the feature table rather than a private copy of it
 *   - that the axes it offers all exist in featureNames, so a renamed feature
 *     makes a bar read `undefined` rather than a wrong number
 *   - that the weights are standardised before they are compared, since raw
 *     cosine returns 1.000 for everything and the list looks plausible
 *   - that no preset leaves a single dimension active, which is the degenerate
 *     case where cosine is always ±1 and the ranking silently inverts
 *   - that the caveat is on the page, in the DOM, and says 音色 and not 血緣
 *   - that the legacy toggle carries its warning, because the two sets are not
 *     comparable and the page offers both
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

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
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want: ${b}`}`);
};

const page = read('cries.html');
const css = read('assets/css/cries.css');
const features = JSON.parse(read('assets/data/cry_features.json'));
const NAV = read('assets/js/shared.js');

/** Strip comments before scanning for selectors or keys.
 *
 *  Learned the hard way twice over in this repo. cries.css explains in a comment
 *  exactly why it must not claim a `cp-` selector, and a naive grep found that
 *  explanation and reported the file for breaking its own rule. check_color_
 *  page.mjs masks comments before balancing brackets for the same reason: NAV's
 *  comments are full of apostrophes and backticks.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/** The AXES block only. A bare /key: '(\w+)'/ also matches the weight presets,
 *  which use the same property name for a different thing. */
const axesBlock = page.slice(page.indexOf('const AXES'), page.indexOf('const PRESETS'));
const presetBlock = page.slice(page.indexOf('const PRESETS'), page.indexOf('const state'));

// ---------------------------------------------------------------------------
// It reads the generated table, and only that.
// ---------------------------------------------------------------------------

ok(page.includes('assets/data/cry_features.json'),
  'the page reads the generated feature table rather than embedding numbers');
/* A hardcoded feature row is a run of numeric literals in an array literal. The
   threshold is 5 rather than 3 because the probe legitimately prints
   `[0, 1, 2, 3]` when it reads MFCC means m0..m3 -- four numbers, and that is
   not a feature row. A 34-number row cannot be confused with either. */
const numericRuns = [...stripComments(page).matchAll(/\[\s*-?[\d.]+(?:\s*,\s*-?[\d.]+){4,}\s*\]/g)];
eq(numericRuns.map((m) => m[0]), [],
  'no feature row is hardcoded in the page script as a run of numbers');

// ---------------------------------------------------------------------------
// Every axis it offers is a real feature.
// ---------------------------------------------------------------------------

const axisKeys = [...axesBlock.matchAll(/key:\s*'(\w+)'/g)].map((m) => m[1]);
const AXIS_COUNT = 5;
eq(axisKeys.length, AXIS_COUNT, `the page offers ${AXIS_COUNT} axes`);
const unknown = axisKeys.filter((k) => !features.featureNames.includes(k));
eq(unknown, [], 'every axis the page offers exists in featureNames');
eq([...new Set(axisKeys)], axisKeys, 'no axis is listed twice');

// The five the reader is promised, by name. These are the labels the page
// advertises in its own intro, so a rename in AXES without a rename here would
// leave the prose describing axes that no longer exist.
for (const label of ['明亮度', '明亮–全頻', '沙啞度', '時長', 'MFCC 音色']) {
  ok(page.includes(`'${label}'`), `the axis 「${label}」 is labelled on the page`);
}

// ---------------------------------------------------------------------------
// Standardisation, or the ranking is decided by two dimensions.
// ---------------------------------------------------------------------------

ok(/std\[k\]\s*=\s*\(rows\[i\]\[k\]\s*-\s*mean\[k\]\)\s*\/\s*sd\[k\]/.test(page),
  'scores are computed on per-dimension standardised values');
ok(/sd\[k\]\s*=\s*Math\.sqrt\(sd\[k\]\s*\/\s*rows\.length\)\s*\|\|\s*1/.test(page),
  'a zero standard deviation falls back to 1 instead of dividing by zero');

// Standardisation is per SET, not computed once. The two recorded sets differ
// enough that a legacy vector standardised with latest's statistics is not the
// same measurement, and the page does swap sets.
ok((page.match(/indexSet\(/g) || []).length >= 3 &&
   /indexSet\(state\.legacy\s*\?\s*features\.legacy\s*:\s*features\.latest\)/.test(page) &&
   /indexSet\(features\.latest\)/.test(page),
  'switching the set re-indexes it, so each set gets its own means and deviations');

// ---------------------------------------------------------------------------
// Cosine, and the degenerate single-dimension case.
// ---------------------------------------------------------------------------

ok(/dot\s*\/\s*\(pn\s*\*\s*\(Math\.sqrt\(vn\)\s*\|\|\s*1\)\)/.test(page),
  'the ranking is a cosine over the weighted vectors');
ok(/active\s*<=\s*1/.test(page) && /1\s*\/\s*\(\s*1\s*\+\s*delta\s*\)/.test(page),
  'a preset that leaves one dimension active falls back to absolute distance');

// No shipped preset may activate a single dimension, because cosine over one
// dimension returns 1.000 for every neighbour and orders them by distance
// DESCENDING — the opposite of what a reader is told.
const presetCount = (presetBlock.match(/key:\s*'/g) || []).length;
ok(presetCount >= 3, `there are ${presetCount} weight presets`);
ok(!/\bonly:\s*\[/.test(presetBlock),
  'no preset isolates a single axis, which would make cosine degenerate');
ok(/zero:\s*\['peak',\s*'rms'\]/.test(presetBlock),
  'the default preset excludes absolute level, which is a recording property');

/* ---------------------------------------------------------------------------
   Both cry pages carry the same autoplay switch, from the same module.
   --------------------------------------------------------------------------- */

ok(/mountAutoplay/.test(page) && /cry-autoplay\.js/.test(page),
  'the page mounts the shared autoplay switch rather than building its own');
ok(/from '\.\/assets\/js\/cry-autoplay\.js'/.test(page),
  'by importing it, the same module the Generation I lab uses');
/* Bounded by the PANEL's own tags rather than by proximity: a switch beside the
 * panel reads as a control belonging to something else, and "is it near the panel"
 * is not the question — is it inside it. */
const aside = page.match(/<aside class="cy-panel"[^>]*>([\s\S]*?)<\/aside>/);
ok(!!aside && /id="autoplay-slot"/.test(aside[1]),
  'into a mount point INSIDE the timbre panel, not beside it');
ok(/<h2>音色分析<\/h2>\s*<div id="autoplay-slot">/.test(aside[1]),
  'and under the panel heading, so the panel does not open with a control before its title');
/* Autoplay must only ever be triggered by a CLICK. In cries-gen1.html the same
 * select() runs at boot and on every hashchange, so a switch read inside the
 * function would cry out on load; the pages therefore pass it as an option, and
 * only the click handler passes it true. The observable is that the read site and
 * the pass site are different places. */
/* The rule on this page is the OTHER shape from the Gen I lab's, and it is the
 * right one here: probe() reads the switch itself, because probe() is only ever
 * reached from two click handlers. What matters is the same on both pages — nothing
 * on the BOOT path may reach a play() — so the check is on the call sites, not on
 * where the read sits. */
const probeBody = page.match(/function probe\(id\) \{([\s\S]*?)\n {4}\}/);
ok(!!probeBody && /autoplay\.on/.test(probeBody[1]),
  'probe() reads the switch, because selecting IS the gesture');
/* Counted on the comment-stripped source: a fourth mention lives in a comment, and
 * matching prose would make this a count that changes when the code is explained. */
eq([...stripComments(page).matchAll(/probe\(/g)].length, 3,
  'and probe() has exactly three mentions: its definition plus the two click handlers');
ok(!/\n\s*probe\(/.test(stripComments(page).slice(0, stripComments(page).indexOf('function probe('))),
  'none of them on the boot path, so the page is silent until a card is chosen');

// ---------------------------------------------------------------------------
// The caveat. On the page, in the DOM, and saying the right thing.
// ---------------------------------------------------------------------------

const dom = page.slice(page.indexOf('<body'));
ok(/cy-caveat/.test(dom), 'the caveat is part of the served DOM, not built later by script');
ok(/音色相似/.test(dom) && /音色/.test(dom), 'the page says 音色 (timbre)');
ok(dom.includes('不是血緣'), 'the page states plainly that this is not lineage');
ok(/12\.6%/.test(dom) && /3\.2%/.test(dom),
  'the caveat carries the measured top-20 figure and the random baseline');
ok(/2\.1%/.test(dom), 'the caveat carries the measured top-1 figure');
/* The intro is where a promise would be made, so the ban is scoped there. The
   word 血緣 cannot be banned page-wide: the caveat has to say 不是血緣 in order
   to deny the reading, and a check that forbade the word would forbid the denial. */
const intro = page.slice(page.indexOf('<div class="cy-intro">'), page.indexOf('</div>', page.indexOf('<div class="cy-intro">')));
ok(!/(血緣|同類|同進化|親緣|最\s*相似\s*的?寶可夢)/.test(intro),
  'the intro never claims the similarity is semantic or family-based');
ok(!/(最\s*相似\s*的?寶可夢|血緣相近|同類親|同進化)/.test(dom),
  'no part of the page promises a semantic ranking');

// ---------------------------------------------------------------------------
// The legacy set carries its warning.
// ---------------------------------------------------------------------------

ok(/id="legacy-warning"/.test(dom), 'the legacy warning element is in the DOM');
const warn = page.slice(page.indexOf('id="legacy-warning"'), page.indexOf('id="grid"'));
ok(warn.includes('不能與新版直接比較'),
  'the legacy warning says the two sets cannot be compared directly');
ok(/legacy-warning/.test(page.slice(page.indexOf('el(\'filters\')'))),
  'the warning is toggled from the same control that switches the set');

// ---------------------------------------------------------------------------
// Playback goes through the shared player, never a hand-built path.
// ---------------------------------------------------------------------------

ok(/from '\.\/assets\/js\/cry-player\.js'/.test(page), 'the page imports the shared player');
/* Matched on the legacy flag alone, not on the whole call: the call now carries an
 * onStart hook for the probe waveform's playback cursor, and a checker that pinned
 * the exact argument list would fail on formatting rather than on behaviour. */
/* `(id,` is required so a mention of cryPlayer.play() inside a comment is not
 * mistaken for a call site -- which is exactly what happened the first time. */
const playCalls = [...page.matchAll(/cryPlayer\.play\(id,([^]*?)\)\s*;/g)].map((m) => m[0]);
ok(playCalls.length > 0 && playCalls.every((c) => /legacy:\s*state\.legacy/.test(c)),
  'playback passes the set through the player rather than picking a directory itself');
ok(!/cryUrl|legacyUrl|\.ogg['\"]/.test(page), 'and never builds a cry path itself');
ok(/onStart:/.test(page), 'the probe waveform is given the clock reading it needs to draw a cursor');
ok(!/assets\/cries\//.test(page), 'the page never spells out a cry path');
ok(!/raw\.githubusercontent\.com\/PokeAPI\/cries/.test(page),
  'the page does not reach for a remote cry host');
ok(/import\s*\{[^}]*hasCry[^}]*hasLegacyCry[^}]*\}\s*from '\.\/assets\/js\/cry-index\.js'/.test(page),
  'the page imports the rosters and so gates playback on them');
ok(page.includes('hasCry(id)') && page.includes('hasLegacyCry(id)'),
  'the roster gate is actually consulted before playing');

// ---------------------------------------------------------------------------
// Accessibility and motion, matching the rest of the site.
// ---------------------------------------------------------------------------

ok(/role="status"/.test(page) && /aria-live="polite"/.test(page),
  'the panel has a polite live region for its announcements');
ok(/sr-only/.test(page), 'the live region is visually hidden but present');
ok(/@media \(prefers-reduced-motion: reduce\)/.test(css),
  'the page honours reduced motion');
ok(/padding: 0;/.test(css) || /padding:0;/.test(css),
  'the card resets its own padding so the inner layout is not double-padded');

// The play control is a span with role=button because a real button cannot nest
// inside the card button. That makes keyboard support a separate obligation, so
// it is asserted rather than assumed.
ok(/data-play/.test(page) && /role="button"/.test(page),
  'the in-card play control carries role=button');
ok(/keydown/.test(page) && /e\.key !== 'Enter'/.test(page),
  'the in-card play control handles Enter and Space');

// ---------------------------------------------------------------------------
// The generation filter is a filter, and the scroll position is a scroll position.
//
// These were one field (`state.gen`) doing both jobs, which is invisible in a
// screenshot and lethal in use: render() sliced `state.gen * PAGE_SIZE`, so
// pressing 第 1 世代 asked for 60 cards out of all 1,025 — the same 60 as before,
// in the same order — while `aria-pressed` said the chip was on. And the
// sentinel's `state.gen++` re-picked a generation on every scroll, so scrolling
// silently changed the filter. A reader could not have told the difference from
// a page that ignored them.
//
// So the separation is asserted structurally: the slice must read the page
// counter, the filter must narrow the id list, and nothing may write to `state.gen`
// outside filteredIds()/the two filter branches.
// ---------------------------------------------------------------------------

ok(/pages:\s*1,/.test(page) && /state\.pages/.test(page),
  'the page keeps a scroll-position field separate from the generation filter');
/* The narrowing itself, and specifically that it reads the pokemon record's
 * generation rather than a range of ids — a gen filter built on id arithmetic is
 * wrong for every generation after the third, because the ranges are not
 * contiguous (Gen 4 starts at 387, not at 252+1). */
const genFilter = page.slice(page.indexOf('function filteredIds'), page.indexOf('function sortedIds'));
ok(/state\.ids\.filter\(\(id\) => state\.meta\.get\(id\)\?\.generation === state\.gen\)/.test(genFilter),
  "the filter narrows by the pokemon record's own generation, not by an id range");
ok(/ordered\.slice\(0, state\.pages \* PAGE_SIZE\)/.test(page),
  'and the grid is sliced by the scroll position, not by the generation');
ok(/filteredIds\(\)\.includes/.test(page),
  'a species filtered out of the grid is dropped from the probe panel too');
ok(/computeAxisRange/.test(page) && /for \(const id of pool\)/.test(page),
  'the meter ranges are computed from the filtered set, not from all 1,025');

/* Every `state.gen` write, so the count is checkable rather than asserted.
 *
 * Scanned on the COMMENT-STRIPPED source, because the two comments explaining
 * this bug both contain the pattern — `state.gen++` in the state block and
 * `state.gen = 0` in the handler — and matching either would make this check
 * report a violation for prose. Same reason as the `cp-` scan above: a naive
 * grep finds the explanation of a rule and reports the file for breaking it.
 *
 * The boundary is the IntersectionObserver, and it is the LAST write that is
 * forbidden rather than a count that must balance. The observer is defined after
 * the filter handler, so slicing "everything after the handler" would have
 * included it — the first version of this check passed a mutation that moved the
 * sentinel onto `state.gen`, for exactly that reason. Nothing after the observer
 * is allowed to touch the filter at all: the observer is the only thing there
 * that runs on its own, and scrolling is precisely what must not re-filter. */
const bare = stripComments(page);
const genWritesAfter = (bare.slice(bare.indexOf('new IntersectionObserver('))
  .match(/state\.gen\s*(?:=[^=]|\+\+|--)/g) ?? []);
eq(genWritesAfter, [],
  'nothing after the IntersectionObserver writes state.gen — scrolling cannot re-filter');

/* The sentinel must be capped by the filtered total, or a set that fits on one
 * page still re-renders forever and the count runs past the end. */
ok(/Math\.ceil\(total \/ PAGE_SIZE\)/.test(page),
  'the scroll handler stops at the end of the FILTERED list');

// ---------------------------------------------------------------------------
// The stylesheet follows the project's conventions rather than inventing one.
// ---------------------------------------------------------------------------

ok(/link rel="stylesheet" href="assets\/css\/shared\.css"/.test(page),
  'the page loads the shared tokens');
ok(/link rel="stylesheet" href="assets\/css\/cries\.css"/.test(page),
  'the page loads its own stylesheet');
// `cp-` is owned by colors.css. Reusing it here would make two files' selectors
// collide on .cp-card and .cp-chipset and break depending on stylesheet order.
const cpRules = (stripComments(css).match(/\.cp-[a-z-]+/g) || []);
eq(cpRules, [], 'cries.css claims no `cp-` selector, which colors.css owns');
ok(/\.cy-[a-z-]+/.test(stripComments(css)), 'cries.css uses its own `cy-` prefix');
ok(!/#[0-9a-f]{6}\b/i.test(stripComments(css)),
  'cries.css defines no raw colour, so it follows the theme tokens');

// ---------------------------------------------------------------------------
// The nav row exists and the page count agrees.
// ---------------------------------------------------------------------------

ok(/href: 'cries\.html'/.test(NAV), 'the nav links to cries.html');
ok(/id: 'cries'/.test(NAV) && /icon: 'waveform'/.test(NAV),
  'the nav row is the 叫聲 group with the waveform icon');
ok(/waveform:/.test(NAV), 'the waveform icon is defined');

// ---------------------------------------------------------------------------
// §3.X. The probe's tall half, behind one disclosure collapsed at 900px.
//
// MEASURED AT 390×844, before the disclosure existed, with a species selected:
//
//   .cy-panel        1,609px of a 6,914px document
//     similar list    666px · caveat 262px · measured figures 171px
//     plus three <h3>s, the weight chips and their note   ≈ 510px
//   #probe-play      y = −5,309 — 5,309px ABOVE the viewport, after tapping card 40
//   grid's 1st card  y = 2,246
//
// and after: .cy-panel 387px, #probe-play y=181, #cy-probe-head y=55, grid's 1st card
// y=707. At 1280×1000 the panel measures the same before and after — 1,000px, sticky,
// #probe-play at y=234, a 3,640px document — which is what the `display: none`
// assertion below exists to keep true.
//
// The GEOMETRY is in `check_cry_mobile_layout.mjs`; this half is what a source and a
// stylesheet can answer, and none of it could catch a layout on its own.
// ---------------------------------------------------------------------------

const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

/* `[\s\S]*?` and not `[\S]*?` — the latter cannot match a space, so it silently finds
 * nothing in a stylesheet with no error. Measured: this helper's first version reported
 * zero media queries in every file it was pointed at. */
const maxWidthBlocks = (src) => [...src.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
  .map((m) => ({ width: Number(m[1]), body: m[2] }));

const moreOpen = page.indexOf('<details class="cy-more" id="probe-more" open>');
const moreClose = page.indexOf('</details>', moreOpen);
ok(moreOpen > 0 && moreClose > moreOpen,
  'the probe\'s figures, its similarity list and its caveat are behind ONE `<details>`, which is `open` in the markup so a reader with no JavaScript gets the page this shipped as');
ok(page.indexOf('id="probe-wave"') < moreOpen && page.indexOf('id="probe-play"') < moreOpen
  && page.indexOf('id="probe-spectrum"') < moreOpen,
  'and the waveform, ▶ 播放叫聲 and the 看頻譜 link are OUTSIDE it — they answer 「what does this one sound like」, which is the question a reader who just tapped a card asked, and putting them behind a tap would be the fix making the original complaint');
/* BOUNDED ON BOTH SIDES, because half of this is not half of it. The first version
 * asked only that each id come after the opening tag, and a mutation that moved
 * `#probe-stats` to just PAST `</details>` — the one place that breaks the layout and
 * leaves the markup perfectly valid — satisfied it. This is §3.P's finding pointed at an
 * assertion of my own: 「inside the disclosure」 is a statement about an interval, and
 * an interval has two ends. */
const insideDetails = (needle) => {
  const at = page.indexOf(needle);
  return at > moreOpen && at < moreClose;
};
ok(['id="probe-stats"', 'id="weights"', 'id="similar"', 'cy-caveat'].every(insideDetails),
  'while 實測數值, the weight presets, the similarity list and the caveat are all INSIDE it — bounded by both tags, because a half-open interval is satisfied by content that has just been moved out of it, and the caveat last, because it qualifies 音色相似 and nothing else');
ok(/<summary class="cy-more-summary">實測數值與音色相似<\/summary>/.test(page),
  'and the summary names what it holds rather than saying 「更多」 — §3.G9\'s rule, on a panel whose visible half is already 「this one Pokémon」');

const summaryBase = (() => {
  const start = cssCode.indexOf('.cy-more-summary {');
  return start < 0 ? '' : cssCode.slice(start, cssCode.indexOf('}', start));
})();
ok(/display:\s*none/.test(summaryBase),
  'the summary is `display: none` above the breakpoint, so a desktop reader is not handed a control that collapses reference material they could always see — and `syncProbeDisclosure()` forces `open` on every crossing, which is what makes hiding the affordance safe');
const summaryBlocks = maxWidthBlocks(cssCode).filter((b) => /\.cy-more-summary/.test(b.body));
eq(summaryBlocks.length, 1,
  'and it appears in exactly ONE `max-width` block, because two of them would be two widths the control belongs to');

/* The breakpoint is read out of the STYLESHEET and required to be the block that drops
 * the panel out of the side. `cries.css` has four 900px blocks and two of them are
 * about other things — this file's own new block, and `.cg-picker`, which is the
 * Generation I lab's control on a page that is not in scope here. A bare number
 * comparison would have been satisfied by any of them; §3.S's shape, where a
 * stylesheet-shaped assertion is satisfied by a rule with nothing to do with the claim. */
const panelBlocks = maxWidthBlocks(cssCode).filter((b) => /\.cy-panel/.test(b.body));
eq(panelBlocks.length, 1,
  'and there is exactly ONE `max-width` block in `cries.css` that touches `.cy-panel` — the one that makes it static, which is the layout the disclosure exists to mitigate');
ok(/position:\s*static/.test(panelBlocks[0]?.body ?? ''),
  'and that block is the one giving the panel `position: static`, so the assertion for the number below names a block rather than a number');
const mq = page.match(/const PANEL_COLLAPSE_MQ = '\(max-width: (\d+)px\)'/);
ok(Boolean(mq) && panelBlocks.length === 1 && Number(mq[1]) === panelBlocks[0].width,
  'and the page\'s `PANEL_COLLAPSE_MQ` is that block\'s width, so the stylesheet and the script cannot disagree about where the panel collapses');
eq(summaryBlocks.filter((b) => b.width === panelBlocks[0]?.width).length, 1,
  'and the summary appears at the SAME width the panel collapses at — the control and the layout it exists for are one declaration site each, or a reader gets a button on the wrong side of the breakpoint');

/* NO GATE ON A GESTURE, and the reason is already asserted at the top of this file:
 * there are exactly three mentions of `probe()` — the definition and two click handlers
 * — and none of them precede the definition, so the boot path calls `renderProbe()`
 * directly. `revealProbe()` living inside `probe()` is therefore safe, and this
 * assertion is here to say that it depends on the one above rather than to restate it. */
ok(/revealProbe\(\);/.test(probeBody[1] ?? ''),
  '`revealProbe()` is called from `probe()`, which the count above proves is reachable only from the grid click and the similarity-list click');
const revealBody = page.match(/function revealProbe\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? '';
ok(/if \(!collapsed\(\)\) return;/.test(revealBody),
  'and it returns early above the breakpoint, so a desktop reader is never moved by a function that exists for a phone');
/* THE TARGET IS THE PANEL, and this is the measured half. Scrolling to `.cy-probe-head`
 * put the head at y=−45 and its NAME at y=−31 — above the fold, so the reader was shown
 * a play button for a Pokémon whose name they could not read. */
ok(/querySelector\('\.cy-panel'\)/.test(revealBody) && !/cy-probe-head/.test(revealBody),
  'and it scrolls the PANEL rather than the probe head: `nearest` aligns an element that is entirely above the viewport by its bottom, which clipped the sprite and its name off the top of the screen');
ok(/block:\s*'nearest'/.test(revealBody) && /prefers-reduced-motion/.test(revealBody),
  'with `block: \'nearest\'` so a reader who already has the panel on screen is not moved at all, and the smooth behaviour gated on `prefers-reduced-motion` (§3.C)');

console.log('');
console.log(`  axes: ${axisKeys.join(', ')}`);
console.log(`  presets: ${presetCount}, features per row: ${features.dimensions}`);

if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);