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
ok(/cryPlayer\.play\(id,\s*\{\s*legacy:\s*state\.legacy\s*\}\)/.test(page),
  'playback passes the set through the player rather than picking a directory itself');
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

console.log('');
console.log(`  axes: ${axisKeys.join(', ')}`);
console.log(`  presets: ${presetCount}, features per row: ${features.dimensions}`);

if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);