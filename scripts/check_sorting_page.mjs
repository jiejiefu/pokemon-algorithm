#!/usr/bin/env node
/**
 * sorting.html's 競速 mode: the layout contract, and the six canvases that were blank.
 *
 *   node scripts/check_sorting_page.mjs          (needs the repo served on :5500)
 *   SORT_PORT=8080 node scripts/check_sorting_page.mjs
 *
 * WHY THIS FILE EXISTS. Race mode shipped with every lane rendering nothing, and
 * the whole 41-script suite stayed green. The cause was three helpers closing over
 * a module-level `ctx`:
 *
 *     paint(lane.nodes, events, race.playing)   -> drew into the SINGLE canvas
 *     ring(node, color)                         -> same
 *     sweep(lane.sweepAt)                       -> same, AND read a MODULE-level
 *                                                   `sweepAt` while taking a
 *                                                   `progress` parameter it never used
 *
 * frameRace() cleared `lane.ctx` and then called `paint()`, so each lane was
 * cleared 60x/second and nothing was ever drawn on it — into a canvas `setMode()`
 * had set `hidden`. No exception, no failed request, no console output, and no
 * checker read this page's DOM or its stylesheet at all (`rg -l "al-lanes"` returns
 * sorting.html and algo.css; `rg -l "sort-run" scripts/` returns nothing). Those
 * three greps are the reason this file exists and they are repeated here as the
 * cheapest possible tripwire.
 *
 * WHAT IS ASSERTED, AND WHY IT IS SPLIT IN TWO
 *
 *   STATIC  reads sorting.html / algo.css / sort-run.js off disk. The lane shapes
 *           are a stylesheet contract, and a stylesheet contract can be checked by
 *           reading it. Mutation-testable against a scratch copy, so every claim
 *           here is proven able to fail.
 *
 *   RENDERED  drives the real page over CDP and counts INK. A blank canvas is
 *           TRANSPARENT, so alpha is the only thing that distinguishes "drew
 *           nothing" from "drew black" — a check that ignores alpha scores a
 *           pristine canvas as a perfect result, which is exactly how the original
 *           defect survived (see §3.G of AGENTS.md).
 *
 * The split matters in the other direction too: the STATIC half is a source-shape
 * check, and a regex over the same lines passes for any mutation that leaves the
 * substrings in place. So the static half is written to assert the EXACT defect —
 * a call site with no context argument — and its negative cases mutate that line
 * and are required to be caught by the assertion that names it. The rendered half
 * is what says the fix works; the static half is what says it cannot be undone by
 * a later edit that only half-reverts.
 *
 * ONE PAGE LOAD, THEN THE CONTROLS. Navigating per case costs ~25s per load
 * because the page re-fetches 1,025 sprites, which is what made a first pass at
 * this take half an hour. So this loads once in race mode and then drives the
 * reader's own controls — the algorithm chips and the sample-size select — with
 * `click()` and a `change` event. That is both fast and a better test: it
 * exercises the wiring the reader uses, so a broken `buildRace()` call site fails
 * here too rather than only under a URL parameter.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.SORT_PORT || 5500);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
let checks = 0;
const pass = (msg) => { checks++; console.log(`  ok   ${msg}`); };
const fail = (msg) => { checks++; failures++; console.log(`  FAIL ${msg}`); };

/* `ok — why`, and never an empty `why`. check_nav_pages.mjs records why: a FAIL that
 * prints nothing reads as a blank line, and `N check(s) failed` with nothing to act
 * on sends the reader to the wrong file. An empty detail is also how a predicate
 * that disagrees with its own message shows up — the computed offender list comes
 * back empty precisely then. */
const check = (cond, ok, bad) => {
  if (cond) return pass(ok);
  const why = typeof bad === 'function' ? bad() : bad;
  fail(`${ok} — ${why ? why : 'the check failed but the detail was empty (predicate disagrees with its own message)'}`);
};

/** Strip comments so a claim can never be satisfied by prose explaining the code. */
function stripComments(src, kind) {
  if (kind === 'css') return src.replace(/\/\*[\s\S]*?\*\//g, '');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* THE BLOCK OF A HANDLER, BRACE-MATCHED TO ITS OWN CLOSING BRACE.
 *
 * This exists because the language-switch assertion below was a `[\s\S]*?` pair
 * with an indentation-shaped terminator, and that is the exact shape §3.P records
 * as vacuous: the tail ran 9,172 characters PAST the handler's end — all the way
 * into the boot sequence — because the handler closes at six spaces and the
 * pattern asked for eight. It was not *currently* vacuous (the one other
 * `highlightPseudo` call in the file differs by an `?.`, so the pattern could not
 * be satisfied by the wrong one), which is the worse half to discover: a
 * structurally wrong assertion that happens to be right today and stops being
 * right the next time anything below it in the file moves.
 *
 * It failed on the 資料範圍 work for exactly that reason. The fix is not a wider
 * tolerance; it is reading the block the assertion is about.
 *
 * `openAt` is the index of the `{` that opens the body. Counting has to start
 * AFTER it, and the string-literal skip is not optional: a `}` inside a string
 * (`'}'`) would otherwise close the block early. */
function blockFrom(src, openAt) {
  if (openAt < 0) return null;
  let depth = 0, i = openAt;
  let quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(openAt, i + 1); }
  }
  return null;
}

/* ------------------------------------------------------- STUBBED SPRITES
 *
 * The page boots by fetching 1,025 sprites, and they are 126.7 KB on average — about
 * 130 MB and 1,025 PNG decodes per navigation, at concurrency 24. That was 85% of this
 * checker's runtime and, through the mutation suite's full baseline, most of the
 * suite's too. None of it is what the rendered half is measuring: the claims are that
 * each lane canvas HOLDS INK, that five grid shapes are right, that a race finishes,
 * and that a full six-lane race does not retain its history. A 71-byte sprite answers
 * all four.
 *
 * What is given up, stated here because a reader will otherwise assume otherwise:
 * that the sprite PATHS resolve and that the PNGs DECODE. A wrong `filename` or a 404
 * still produces ink — PokemonNode.draw() skips an image whose naturalWidth is 0 —
 * so that class of defect goes dark in this checker. Everything §3.G3 is about still
 * works, because sprites painted into a hidden canvas give zero ink whichever sprite
 * they are.
 *
 * The PNG is BUILT here rather than pasted in as a base64 constant, because a corrupt
 * stub would leave every lane blank and the checker would then fail for a reason that
 * has nothing to do with the page. Built means provably well-formed: a PNG is a
 * signature plus length-prefixed, CRC32-suffixed chunks, and `zlib.crc32` gives the
 * CRC Node's own zlib already computes, so there is no table to hand-copy.
 */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([len, typed, crc]);
}
function stubSprite() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);   // width  4
  ihdr.writeUInt32BE(4, 4);   // height 4
  ihdr[8] = 8;                // bit depth
  ihdr[9] = 6;                // colour type 6 = RGBA
  // OPAQUE white, and opacity is the load-bearing part: a blank canvas is transparent,
  // so a transparent stub would make the ink check report zero for the right reason and
  // fail for the wrong one. Opaque also means the stub fills its destination box, where
  // a real sprite covers only ~60-70% of it after transparent padding — so the ink
  // figures this checker prints are HIGHER than the real-sprite ones and are not
  // comparable to them.
  const raw = Buffer.from([0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 0, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Re-parse what we just built, so a malformed stub is a startup throw and not 33 red checks. */
function assertWellFormedPng(png) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIG.length; i++) if (png[i] !== SIG[i]) throw new Error('stub PNG has a bad signature');
  const types = [];
  let o = 8;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.slice(o + 4, o + 8).toString('ascii');
    const crc = png.readUInt32BE(o + 8 + len);
    if (crc32(png.slice(o + 4, o + 8 + len)) >>> 0 !== crc) throw new Error(`stub PNG chunk ${type} has a bad CRC`);
    types.push(type);
    o += 12 + len;
  }
  if (types.join(',') !== 'IHDR,IDAT,IEND') throw new Error(`stub PNG chunks are ${types.join(',')}, expected IHDR,IDAT,IEND`);
  return png;
}
const STUB_PNG_B64 = assertWellFormedPng(stubSprite()).toString('base64');

/* The URL pattern the stub answers. It has to match the ONE directory the page loads
 * from and nothing else, or a stub would start masking a request the page is entitled
 * to make for real. It is READ OUT OF shared.js rather than written down here, because
 * a second copy of a path is a second thing to keep right: `ASSETS.images` changing is
 * exactly the edit that would silently stop the interception, and the stub-count
 * assertion below would then fire with no pointer to the cause. */
const ASSETS_IMAGES = read('assets/js/shared.js').match(/images:\s*'([^']+)'/)?.[1];
const SPRITE_GLOB = ASSETS_IMAGES ? `*${ASSETS_IMAGES}*` : '*assets/images/pokemon/*';

/* ================================================================ STATIC */

const html = read('sorting.html');
const htmlCode = stripComments(html, 'js');
const css = read('assets/css/algo.css');
const cssCode = stripComments(css, 'css');
const sortRun = read('assets/js/sort-run.js');

console.log('static: the stylesheet contract');

/* The lane shapes. The reader asked for 2 and 3 in one row, 4 as 2x2, 5 as 3+2 and
 * 6 as 3+3, and there is deliberately no formula: `cols = count <= 3 ? count : 3`
 * gives four lanes a 3+1 row with one empty cell, because 4 wants two COLUMNS and
 * two ROWS and no single expression says both. Asserted as five separate rules so
 * the failure names which shape broke. */
const LANE_SHAPES = [
  ['2', 'repeat(2, 1fr)'],
  ['4', 'repeat(2, 1fr)'],
  ['5', 'repeat(6, 1fr)'],
];
for (const [count, cols] of LANE_SHAPES) {
  const re = new RegExp(`\\[data-lanes="${count}"\\][^{]*\\{[^}]*grid-template-columns:\\s*${cols.replace(/[()]/g, '\\$&')}`);
  check(re.test(cssCode), `data-lanes="${count}" gets ${cols}`,
    () => `algo.css has no rule giving [data-lanes="${count}"] ${cols}. The lane count IS the layout input, so losing this rule silently changes every lane's shape.`);
}
check(/\.al-lanes\s*\{[^}]*grid-template-columns:\s*repeat\(3, 1fr\)/.test(cssCode),
  'the default column count is 3, which is the shape lanes 3 and 6 want',
  () => 'the base .al-lanes rule no longer declares repeat(3, 1fr), so 3-lane and 6-lane races have no declared shape');

const span2 = /\.al-lanes\[data-lanes="5"\] \.al-lane\s*\{[^}]*grid-column:\s*span 2/.test(cssCode);
const span3 = /\.al-lanes\[data-lanes="5"\] \.al-lane:nth-child\(4\),\s*\.al-lanes\[data-lanes="5"\] \.al-lane:nth-child\(5\)\s*\{[^}]*grid-column:\s*span 3/.test(cssCode);
check(span2 && span3,
  'the five-lane shape gives three lanes span 2 and the bottom two span 3',
  () => `the 上3下2 rule is incomplete — span 2 is ${span2 ? 'present' : 'MISSING'}, span 3 on the bottom two is ${span3 ? 'present' : 'MISSING'}. Without both, five lanes leave an empty cell.`);

/* `.al-result` must be APPENDED, because the five-lane bottom two are selected by
 * position. This is the one ordering claim that a stylesheet check cannot make, so
 * it is asserted here against buildRace() rather than left to the rendered half. */
check(/raceGrid\.appendChild\(raceResult\)/.test(htmlCode) && !/raceGrid\.prepend\(/.test(htmlCode),
  '.al-result is appended to the lane grid, so :nth-child(4)/(5) are the bottom two lanes',
  () => 'buildRace() does not append raceResult (or prepends it again). The five-lane shape picks its bottom two lanes by :nth-child, so a LEADING .al-result shifts every lane index by one and gives the wrong two lanes half a row.');

/* align-content: center makes the canvas flex-grow a no-op — a centered row track is
 * sized to its content, so the canvas has no free space to grow into. Measured:
 * 483x302 and 9.5px sprites inside a 723px stage, versus 483x655 with stretch. */
const align = /\.al-lanes\s*\{[^}]*align-content:\s*stretch/.test(cssCode);
const autoRows = /\.al-lanes\s*\{[^}]*grid-auto-rows:\s*minmax\(0, 1fr\)/.test(cssCode);
const laneFlex = /\.al-lane canvas\s*\{[^}]*flex:\s*1 1 auto/.test(cssCode);
check(align && autoRows && laneFlex,
  'the lane canvas actually grows: align-content stretch + grid-auto-rows + flex 1 1 auto',
  () => `the growth chain is broken — align-content:stretch is ${align ? 'present' : 'MISSING'}, grid-auto-rows:minmax(0,1fr) is ${autoRows ? 'present' : 'MISSING'}, .al-lane canvas flex:1 1 auto is ${laneFlex ? 'present' : 'MISSING'}. All three are needed: without the stretch the canvas grow is a silent no-op.`);

/* The narrow-screen override must UNDO the five-lane span, not merely be out-ranked
 * by it: `[data-lanes] .al-lane` is (0,2,0) and beats the media query's own
 * `[data-lanes]` (0,1,0) on specificity, so leaving it alone keeps two-column spans
 * inside a one-column phone grid. */
const narrow = cssCode.match(/@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\n\}/);
check(narrow && /\.al-lanes\[data-lanes\][^{]*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/.test(narrow[0])
          && /\.al-lanes\[data-lanes\]\s+\.al-lane\s*\{[^}]*grid-column:\s*auto/.test(narrow[0]),
  'the narrow-screen rules restore reflow AND reset the five-lane span',
  () => 'the max-width:900px block no longer carries both the auto-fit columns and `grid-column: auto`. The span reset is the one that is easy to omit, because specificity means the media query CANNOT out-rank the desktop rule.');

/* --- the exact defect, asserted as source shape ------------------------------
 * This is the check that names the bug. A call site with no context argument is the
 * whole failure: the helpers read the module-level `ctx`, and the module-level `ctx`
 * is the single-mode canvas. */
const helpers = {
  paint: /function paint\((\w+),/,
  ring: /function ring\((\w+),/,
  sweep: /function sweep\((\w+),/,
};
const helperParams = {};
for (const [name, re] of Object.entries(helpers)) {
  const m = htmlCode.match(re);
  check(!!m, `${name}() takes a context as its first parameter`,
    () => `${name}() no longer declares a context parameter — if it reads the module-level ctx instead it will draw into the single-mode canvas, which is what left every race lane blank.`);
  helperParams[name] = m ? m[1] : null;
}

/* Call sites. Named by ARGUMENT, not by a bare call: `paint(` also matches the
 * definition and appears in a comment, and a regex that only requires the substring
 * passes for any edit that leaves the call in place. Every call must pass either the
 * module ctx (single mode) or lane.ctx (race mode) explicitly. */
const callSites = {
  paint: [...htmlCode.matchAll(/\bpaint\(([^)]*)\)/g)].map(m => m[1]),
  ring: [...htmlCode.matchAll(/\bring\(([^)]*)\)/g)].map(m => m[1]),
  sweep: [...htmlCode.matchAll(/\bsweep\(([^)]*)\)/g)].map(m => m[1]),
};
const ctxNames = new Set(['ctx', 'lane.ctx', ...Object.values(helperParams).filter(Boolean)]);
const badCall = (name) => {
  const offenders = callSites[name].filter(a => {
    const first = a.split(',')[0].trim();
    return !ctxNames.has(first);
  });
  return offenders;
};
for (const name of ['paint', 'ring', 'sweep']) {
  const offenders = badCall(name);
  check(offenders.length === 0,
    `every ${name}() call site passes its context explicitly`,
    () => `these ${name}() calls pass no context as the first argument: ${offenders.map(o => `\`${name}(${o})\``).join(', ')}. Each one falls through to the module-level ctx, which is the single-mode canvas — the exact defect that rendered every race lane blank.`);
}

/* `sweep` had a second half to the same bug: it took `progress` and read the
 * MODULE-level `sweepAt`, so lane.sweepAt was dead. Assert the parameter is used and
 * the module-level name is not. */
check(/function sweep\(\w+, cfg, startedAt\)/.test(htmlCode)
      && !/if \(!sweepAt\) return/.test(htmlCode),
  'sweep() reads the timestamp it was passed, not a module-level sweepAt',
  () => 'sweep() is back to testing a module-level `sweepAt` while taking a parameter. A lane\'s own finish wipe then only ever paints on the single-mode canvas.');

/* …and the caller has to CLEAR its own timestamp, because sweep() cannot: it no
 * longer holds a reference to the variable it was handed. Asserted per caller, on
 * the whole statement, because "sweep() is called" and "sweepAt is reset" are two
 * different properties and the second one is the one that rots — a field that is
 * written every frame and never cleared is the probe-cursor shape §3.G records. */
check(/if \(!sweep\(ctx, CFG, sweepAt\)\) sweepAt = 0;/.test(htmlCode)
      && /if \(!sweep\(lane\.ctx, lane\.cfg, lane\.sweepAt\)\) lane\.sweepAt = 0;/.test(htmlCode),
  'both sweep() callers clear their own timestamp when it finishes',
  () => {
    const single = /if \(!sweep\(ctx, CFG, sweepAt\)\) sweepAt = 0;/.test(htmlCode);
    const lane = /if \(!sweep\(lane\.ctx, lane\.cfg, lane\.sweepAt\)\) lane\.sweepAt = 0;/.test(htmlCode);
    return `the single-mode caller resets is ${single ? 'present' : 'MISSING'} and the race-lane caller\'s is ${lane ? 'present' : 'MISSING'}. Both must be "if (!sweep(...)) <field> = 0;" — sweep() cannot zero a field it was only passed.`;
  });

/* The four sample sizes must be the SAME four in the module and the state default.
 * `state.n` is validated against RACE_SIZES on load, so a size that is not in the
 * array is one that silently falls back.
 *
 * The <select>'s options are BUILT, not written: 資料範圍 decides which subset is
 * loaded, and `sampleEvenly` returns `arr.slice()` the moment `n >= arr.length`, so
 * a static option list under a 72-generation scope would offer four sizes that all
 * render the same 72 sprites under a label saying 1,025. So this now asserts the
 * options come from the same derivation rather than that they match a literal. */
const sizes = [...htmlCode.match(/const RACE_SIZES = \[([^\]]*)\]/)?.[1].matchAll(/'(\d+)'/g)].map(m => m[1]);
check(JSON.stringify(sizes) === JSON.stringify(['100', '250', '500', '1025']),
  'RACE_SIZES is 100 / 250 / 500 / 1025',
  () => `RACE_SIZES is [${sizes.join(', ')}] — expected 100, 250, 500, 1025`);
const sizeOptions = [...htmlCode.matchAll(/<option value="(\d+)"/g)].map(m => m[1]);
check(sizeOptions.length === 0 && /function offeredRaceSizes\(/.test(htmlCode)
  && /const offered = offeredRaceSizes\(ALL\.length\)/.test(htmlCode)
  /* The FILTER is part of the assertion, not just the call. Without it the check
   * is satisfied by `offeredRaceSizes()` that ignores its argument and returns
   * `RACE_SIZES.slice()` — which is precisely the mutation, and which passes a
   * check that only asks where the options come from. Found by writing the
   * mutation first. */
  && /RACE_SIZES\.filter\((s|sz|n|v) => Number\(\1\) <= len\)/.test(htmlCode)
  && /if \(usable\.length\) return usable;\s*\n\s*return \[String\(len\)\];/.test(htmlCode)
  && /raceSizeSelect\.replaceChildren/.test(htmlCode),
  'the sample-size <select> is built from offeredRaceSizes(), which FILTERS by the loaded count',
  () => `the select has ${sizeOptions.length} static <option> element(s) ${sizeOptions.length ? `[${sizeOptions.join(', ')}] ` : ''}and is not repopulated from a filtering offeredRaceSizes(). Under a small 資料範圍 that means every offered size renders the same subset while the label claims otherwise — sampleEvenly() returns arr.slice() as soon as n >= arr.length. The "if (usable.length)" fallback matters too: without it a 72-generation offers NOTHING, which is worse than offering one.`);
check(/if \(!offered\.includes\(state\.n\)\) state\.n = offered\[0\]/.test(htmlCode),
  'syncRaceSizes() re-validates state.n against the offered set',
  () => 'a `?n=1025&scope=6` link would leave state.n at 1025 while the select shows only the scope size, and the result panel would print a number the reader cannot pick.');
check(/if \(!ALL\.length\) \{\s*race = null;/.test(htmlCode),
  'buildRace() refuses to build lanes over an empty scope',
  () => 'with the gate up (ALL empty) buildRace() would build two canvases sized from Number(state.n) sprites that do not exist and two SortRuns over an empty array. §3.G3: the control looks live and renders nothing.');

console.log('static: the 資料範圍 scope gate');

/* THE PHONE BREAKPOINT IS IN TWO PLACES AND CANNOT BE IN ONE, because a media
 * query cannot be read by JS and JS cannot write into a stylesheet. So the number
 * is asserted to agree — and read OUT OF algo.css rather than compared against a
 * second literal here, or this assertion would be satisfied by any 900px block in
 * the file. algo.css has exactly one, and it is pinned by requiring it to be the
 * one carrying `.al-main` (the layout the gate exists for) rather than by a bare
 * number comparison. §3.X's rule. */
const CSS_NARROW_BLOCK = cssCode.match(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/)?.[1];
check(CSS_NARROW_BLOCK != null
  && /\@media\s*\(max-width:\s*900px\)\s*\{\s*\.al-main\s*\{/.test(cssCode)
  && new RegExp(`const NARROW_MQ = '\\(max-width: ${CSS_NARROW_BLOCK}px\\)'`).test(htmlCode),
  `the JS breakpoint matches algo.css's phone breakpoint (${CSS_NARROW_BLOCK ?? 'none found'}px)`,
  () => `NARROW_MQ in sorting.html and the max-width in algo.css disagree. algo.css declares ${CSS_NARROW_BLOCK ?? 'no'}px; the JS constant is read from \`const NARROW_MQ = '(max-width: NNNpx)'\`. They are two copies of one number because a media query and JS cannot read each other, so this is the only thing keeping them equal — and a reader whose phone layout starts at 600px while the gate starts at 900px is a page that loads 168 MB on the exact device it was built to spare.`);

/* The device signal is the WIDTH, and the rejected alternatives are named because
 * "why not deviceMemory" is the first question a reader asks about a memory gate
 * and the answer is not obvious: Safari does not implement it, which includes iOS. */
check(/needsChoice = scopeFromUrl == null && matchMedia\(NARROW_MQ\)\.matches/.test(htmlCode),
  'the gate is a media query on the width, gated on the link saying nothing',
  () => 'needsChoice must be `scopeFromUrl == null && matchMedia(NARROW_MQ).matches`. Two halves: a shared ?scope= link must never be second-guessed by the reader\'s device, and the default has to come from somewhere checkable. navigator.deviceMemory cannot be that — Safari does not implement it.');
check(!/navigator\s*\.\s*deviceMemory|navigator\s*\.\s*userAgent|hardwareConcurrency|maxTouchPoints/.test(htmlCode),
  'no capability sniff decides what loads',
  () => 'the gate must read from one signal. `navigator.deviceMemory` is Chromium-only and ABSENT in Safari/iOS — the platform this exists for — and userAgent sniffing is wrong on iPad. If this fires because a future edit wanted a second signal, it is a decision that needs the incident write-up, not a line.');
check(/params\.get\('scope'\)/.test(htmlCode)
  && /scope:\s*pick\(scopeFromUrl, SCOPE_IDS, 'all'\)/.test(htmlCode),
  '?scope= is validated against SCOPE_IDS',
  () => 'state.scope is not validated against the SCOPES list, so a share link carrying `?scope=99` would filter DATA to an empty set and render a blank canvas with no error.');
check(/p\.set\('scope', state\.scope\);/.test(htmlCode),
  'the share link always carries the scope, including the default',
  () => 'writing it only when non-default makes a link\'s meaning depend on the width of whoever opens it: the same URL would load 168 MB on a desktop and open the gate on a phone. Writing it always is what makes `scopeFromUrl == null` narrower than it looks — a shared link never reaches the gate.');

/* The gate is NOT a scope value. `all` is both "no filter" and the default, so
 * making it a tenth id would give one string two meanings across every reader of
 * state.scope. Asserted as the absence of that shape, because an assertion that
 * a value is NOT in a list cannot be phrased as a presence check. */
const scopeIds = [...htmlCode.match(/const SCOPES = \[([\s\S]*?)\n    \];/)?.[1].matchAll(/id:\s*'(\w+)'/g)].map(m => m[1]);
check(scopeIds.length === 10 && scopeIds[0] === 'all' && new Set(scopeIds).size === 10,
  'SCOPES is 所有世代 plus the nine generations, ten distinct ids',
  () => `SCOPES is [${scopeIds.join(', ')}] — expected ten distinct ids starting with 'all'. A generation whose id repeats another one makes the select offer two rows the page cannot tell apart, and one that is missing makes the gate's first screen quieter than it claims to be.`);
check(!/state\.scope\s*===\s*null|scope:\s*null/.test(htmlCode),
  "'all' is never used to mean 「還沒決定」",
  () => 'a null scope would be the gate expressed inside state.scope, which is the shape this design rejected: `all` already means 「全部」, so the same string would carry both meanings and every reader of state.scope would have to know which one it holds.');

/* IMG.clear() is the line the whole feature turns on. */
const loadScopeBody = htmlCode.match(/async function loadScope\([\s\S]*?\n    \}/)?.[0] || '';
check(/IMG\.clear\(\);/.test(loadScopeBody) && /single = null;/.test(loadScopeBody) && /race = null;/.test(loadScopeBody),
  'a scope change releases the previous scope: IMG.clear() plus both node holders',
  () => `loadScope() must clear IMG and null both \`single\` and \`race\`. Found: IMG.clear() ${/IMG\.clear\(\);/.test(loadScopeBody)}, single ${/single = null;/.test(loadScopeBody)}, race ${/race = null;/.test(loadScopeBody)}. Without IMG.clear() the previous scope's Image objects stay reachable from the Map and the memory this feature exists to save is never released — a gate that only avoids the FIRST load, beside a control that invites the second.`);

/* No user-visible copy may still claim 1,025 while the page can draw 72. Each of
 * these was a literal; asserting the absence is the only form that can express
 * 「must not say a fixed count」. */
const copyClaims = [
  ['loading overlay', /載入 1,025 隻/],
  ['canvas aria-label', /aria-label="1,025 隻寶可夢/],
  ['race result pointer', /要看單一的一千隻網格/],
  ['audio hint', /1,025 次搬移就是上千聲/],
];
for (const [what, re] of copyClaims) {
  check(!re.test(html), `the ${what} no longer states 1,025 as a fixed count`,
    () => `the ${what} still says 1,025, which is now only true for one of ten scopes. §3.B1: the page's own copy must stop describing what the page stopped offering.`);
}
check(/canvas\.setAttribute\('aria-label'[\s\S]{0,120}?\.length\.toLocaleString\(\)/.test(htmlCode),
  "the canvas's accessible name is derived from the loaded count",
  () => 'a 72-sprite grid that announces itself as 1,025 to a screen reader is the same lie as a 1,025 label under 72 sprites, and it is the one place a non-visual reader meets the scope.');
check(/function ensureLoop\(\)[\s\S]*?loopStarted/.test(htmlCode)
  && /requestAnimationFrame\(frame\)/.test(htmlCode)
  && !/requestAnimationFrame\(frame\);[\s\S]{0,400}?needsChoice/.test(htmlCode),
  'the render loop starts on first load, not at the gate',
  () => 'if boot calls requestAnimationFrame(frame) unconditionally, the gate runs a permanent 60fps loop that clears a canvas and paints nothing — a battery cost on exactly the device the gate exists for.');

/* The button the gate points at has to EXIST by the time the gate shows. */
check(/renderScopeSelect\(\);\s*\n\s*loadPokemonData\(\)/.test(htmlCode),
  'the scope select is built before the gate can ask for it',
  () => 'the gate tells the reader to use the 資料範圍 dropdown. If renderScopeSelect() ran after loadPokemonData().then(...), a slow or failed JSON fetch leaves the gate pointing at a control that is not in the DOM yet — §3.W\'s els.submit bug, one level up.');

/* The lane ceiling is written in four places and any one of them alone is wrong. */
const ceiling = Number(htmlCode.match(/const RACE_N_MAX = (\d+);/)?.[1]);
check(ceiling === 6, 'the lane ceiling is RACE_N_MAX = 6',
  () => `RACE_N_MAX is ${ceiling}, expected 6`);
check(new RegExp(`slice\\(0, RACE_N_MAX\\)`).test(htmlCode),
  'the ?algos= parameter is capped by RACE_N_MAX, not by a literal',
  () => 'state.algos is capped by a hard-coded number instead of RACE_N_MAX, so a share link can ask for more lanes than the picker allows');
check(new RegExp(`checked\\.length > RACE_N_MAX`).test(htmlCode),
  'the chip picker refuses a seventh lane through RACE_N_MAX',
  () => 'the picker guard does not reference RACE_N_MAX');
check(/aria-label="參賽演算法（2 至 6 個）"/.test(htmlCode),
  'the picker’s aria-label says the real range (2 至 6 個)',
  () => 'the picker aria-label does not match the enforced ceiling — it is what a screen reader announces');
check(/2–6 條競速賽道/.test(htmlCode),
  'the meta description says 2–6 lanes',
  () => 'the meta description still claims the old lane range');

/* maxLoggedEvents: 0 on race lanes. Not a style rule — a ~200 MB claim. */
check(/new SortRun\(lane\.nodes[\s\S]{0,200}?maxLoggedEvents: 0/.test(htmlCode),
  'race lanes build their SortRun with maxLoggedEvents: 0',
  () => 'a race lane is the only SortRun on this site that never rewinds, so its event log (~33 MB per lane at n=1,025, ~200 MB across six) is pure waste. Without maxLoggedEvents: 0 nothing bounds it.');

/* The rendered half answers every sprite request with a 71-byte stub, which is what
 * makes it ~20s instead of ~93s. The glob it intercepts is READ OUT OF shared.js
 * rather than written down here, so the only thing that can desynchronise them is
 * ASSETS.images changing — and this is the assertion that says so, with the cause in
 * the message. Without it the only symptom is the stub-count check firing on a count,
 * which says the interception stopped but not that a directory moved. */
check(!!ASSETS_IMAGES && SPRITE_GLOB.includes(ASSETS_IMAGES),
  `the sprite stub intercepts the page's own sprite directory (${ASSETS_IMAGES || 'not found in shared.js'})`,
  () => `shared.js no longer declares an \`images:\` entry this checker can read, so SPRITE_GLOB fell back to a hard-coded "${SPRITE_GLOB}". That is the path §3.G's stub answers, and if the page moved its sprites the run would fetch 130 MB for real while every check still passed.`);

console.log('\nstatic: sort-run.js documents what it does');

/* The claim is not "the string never appears" — it is "it does not cite a checker
 * that does not exist". Those differ the moment the docblock EXPLAINS the removed
 * citation, which is exactly what this file's own first version did: it matched the
 * sentence saying the checker never existed, and reported a red line against a
 * docblock that had just been corrected. A negation-aware regex would be worse, for
 * the reason §4 records about prose matching: the wording would have to be kept
 * right for the check to stay green. So the claim is asked directly — every
 * scripts/*.mjs path this file names must exist on disk — which is immune to how the
 * sentence is phrased and is strictly stronger, since it also catches a checker that
 * is later deleted. */
const cited = [...sortRun.matchAll(/scripts\/([a-z_0-9]+\.mjs)/g)].map(m => m[1]);
const missing = cited.filter(f => !existsSync(join(ROOT, 'scripts', f)));
check(missing.length === 0,
  `every checker sort-run.js names exists (${cited.length} named, ${new Set(cited).size} distinct)`,
  () => `sort-run.js names ${missing.map(f => `scripts/${f}`).join(', ')}, which is not in scripts/. A verification claim nothing can enforce is worse than none: it reads as checked.`);
check(cited.includes('check_sorting_page.mjs'),
  'sort-run.js names the checker that actually measures its numbers',
  () => 'sort-run.js quotes step counts but names no checker for them, so the numbers are a claim with nothing behind it again — the exact defect this check exists to prevent.');
/* The three numbers, re-derived from the module's own generators rather than trusted.
 * 524,800 was attributed to 氣泡/選擇/插入 on reverse-sorted input; it is 選擇 on
 * already-sorted. All four exceed the 400,000 cap either way, so the UI's behaviour
 * never changed — but the claim did, and a wrong number that still produces the right
 * decision is the kind that survives review. */
const steps = await (async () => {
  const { ALGO_META } = await import(join(ROOT, 'assets/js/sorting-algorithms.js'));
  const cmp = (a, b) => a.id - b.id;
  const N = 1025;
  const count = (arr, algo) => { const a = arr.map(o => ({ ...o })); let t = 0; for (const _ of ALGO_META[algo].run(a, cmp)) t++; return t; };
  const byId = (reversed) => Array.from({ length: N }, (_, i) => ({ id: reversed ? N - i : i + 1 }));
  const sorted = byId(false), reversed = byId(true);
  return [
    // `claim` is what the ok-line reports; `anchor` is the literal wording the number
    // must sit next to in the docblock. They are separate fields on purpose: the claim
    // is the thing being verified and should read as a statement about the algorithms,
    // while the anchor is a stylistic detail of the prose. Collapsing them forces the
    // claim to be phrased exactly as the comment happens to phrase it, and then a
    // harmless rewrap breaks a check that was verifying something real. A reword that
    // moves the anchor SHOULD fail loudly — it means someone edited the sentence and
    // the number's attachment to the claim needs re-confirming — but the failure
    // should name the measurement, which is why `claim` is separate.
    { claim: '選擇排序 on already-sorted input', anchor: '選擇排序 on ALREADY-SORTED', n: count(sorted, 'selection') },
    { claim: '氣泡 and 插入 on reverse-sorted input', anchor: 'for 氣泡 and 插入', n: count(reversed, 'bubble') },
    { claim: '快速 on already-sorted input', anchor: '快速 on already-sorted', n: count(sorted, 'quick') },
  ];
})();

/* ATTRIBUTION, not presence — and the first version of this check got that wrong,
 * which the mutation suite caught. `docblock.includes('524,800')` passes whether the
 * number is the one being quoted or merely mentioned elsewhere in the same paragraph,
 * so editing the quote to 480,000 leaves the check green. That is §4's rule verbatim:
 * a source-shape test passes for any mutation that leaves the substrings in place.
 *
 * So the number has to appear NEAR the anchor it is claimed for. The docblock wraps, so
 * the comparison runs against a whitespace-collapsed copy and accepts the anchor within
 * a short window. A window is the price of tolerating rewrapping; it is still strictly
 * an attribution test, and the neighbouring mention that broke the first version
 * ("524,800 already-sorted", a different sentence) is far outside it. */
const flat = sortRun.replace(/\s+/g, ' ');
const quotedNear = (number, anchor) => {
  const WINDOW = 60;
  let at = flat.indexOf(number);
  while (at >= 0) {
    const lo = Math.max(0, at - WINDOW), hi = Math.min(flat.length, at + number.length + WINDOW);
    if (flat.slice(lo, hi).includes(anchor)) return true;
    at = flat.indexOf(number, at + 1);
  }
  return false;
};
for (const { claim, anchor, n } of steps) {
  const printed = n.toLocaleString('en-US');
  check(quotedNear(printed, anchor),
    `sort-run.js quotes ${claim} as ${printed}, and attaches it to that row`,
    () => `${printed} does not appear within 60 characters of "${anchor}" in sort-run.js, but driving the generators says it is ${printed} for ${claim}. Presence alone is not enough — the number has to be attached to the row that claims it, or the claim can be edited while the string survives elsewhere in the paragraph.`);
}
check(steps[0].n > 400000 && steps[2].n < 400000,
  'the asymmetry the docblock draws its design constraint from still holds',
  () => `選擇 on already-sorted is ${steps[0].n} and 快速 is ${steps[2].n}; the documented split (one algorithm loses the timeline at n=1,025, the others keep it) no longer holds at the DEFAULT_MAX_LOGGED_EVENTS of 400000.`);

/* ================================================== PSEUDOCODE, TWO LANGUAGES
 *
 * `pseudoPy` is the same statement list written in Python, and the property that
 * makes the switcher honest is that **index i means the same statement in both
 * arrays** — which is why one `lineFor` drives both and no second mapping
 * exists to drift. Three of the four checks below exist only because that
 * property is easy to state and easy to break.
 *
 * The index check is BEHAVIOURAL, not a regex over `lineFor`'s body: it drives
 * each real generator over a small array and collects the indices the events
 * actually produce. A source-shape version would list the indices by hand, which
 * is the same second copy of the truth the design is trying to avoid — and it
 * would keep passing after someone added a new event type whose index was out of
 * range for one of the two arrays, which is the exact defect under test. */

const { ALGO_META, ALGO_IDS } = await import(join(ROOT, 'assets/js/sorting-algorithms.js'));
const cmp = (a, b) => a.id - b.id;
/* Reverse-sorted, 9 elements. n=9 exercises every branch that swaps or yields a
 * mark — including quick's median-of-three, which is SKIPPED below 3 elements
 * and would leave two of its indices unvisited on a shorter input. */
const sample = Array.from({ length: 9 }, (_, i) => ({ id: 9 - i }));

/* Which statement each live index is CLAIMED to be, per algorithm. This is a
 * pinned table rather than a similarity heuristic because "is this the
 * corresponding line" is not decidable by string distance — `swap(arr[j-1],
 * arr[j])` and `swap(arr[j-1, j])` are 3 edits apart and mean different things.
 * What is asserted is that each of the two arrays says the operation the event
 * actually is, so deleting or reordering a Python line is caught. */
const PINNED = {
  bubble:     { 3: ['if arr[j] > arr[j+1]', 'if arr[j] > arr[j + 1]:'],
                4: ['swap(arr[j], arr[j+1])', 'swap(arr[j], arr[j + 1])'] },
  selection:  { 3: ['if arr[j] < arr[minIdx]', 'if arr[j] < arr[min_idx]:'],
                4: ['minIdx ← j', 'min_idx = j'],
                6: ['swap(arr[i], arr[minIdx])', 'swap(arr[i], arr[min_idx])'] },
  insertion:  { 2: ['while j > 0 and arr[j-1] > arr[j]', 'while j > 0 and arr[j - 1] > arr[j]:'],
                3: ['swap(arr[j-1], arr[j])', 'swap(arr[j - 1], arr[j])'] },
  quick:      { 0: ['quicksort(low, high):', 'def quicksort(low, high):'],
                2: ['medianOfThree', 'median_of_three'],
                3: ['把 pivot 換到 arr[high]', 'swap(arr[mid], arr[high])'],
                6: ['if arr[j] < pivot', 'if arr[j] < pivot:'],
                7: ['i++; swap(arr[i], arr[j])', 'i += 1; swap(arr[i], arr[j])'],
                8: ['pivot 歸位', 'pivot 歸位'] },
  merge:      { 0: ['mergesort(l, r):', 'def mergesort(l, r):'],
                4: ['比較 left[i], right[j]', 'if left[i] <= right[j]'] },
  heap:       { 2: ['swap(arr[0], arr[i])', 'swap(arr[0], arr[i])'],
                5: ['比較左右子節點', 'largest = max('],
                6: ['if largest ≠ i', 'if largest != i'] },
};

for (const id of ALGO_IDS) {
  const meta = ALGO_META[id];
  check(Array.isArray(meta.pseudoPy) && meta.pseudoPy.length > 0,
    `${id} has a pseudoPy array`,
    () => `${id} has no pseudoPy, so switching to Python would render an empty panel — the button is present and the default is the generic view, so nothing would fail until a reader clicked it.`);

  /* Run the generator rather than trusting a hand-written list of indices. */
  const live = [...new Set([...meta.run(sample.map(o => ({ ...o })), cmp)]
    .map(meta.lineFor).filter(n => n != null))].sort((a, b) => a - b);

  const outOfRange = live.filter(n => n >= meta.pseudo.length || n >= meta.pseudoPy.length);
  check(outOfRange.length === 0,
    `${id}: all ${live.length} live lineFor indices are in range for BOTH pseudo and pseudoPy`,
    () => `indices [${outOfRange.join(', ')}] are selected by a real step event but exceed one of the two arrays (pseudo ${meta.pseudo.length} lines, pseudoPy ${meta.pseudoPy.length}). The panel builds one array and highlights an index into it, so an out-of-range index either highlights the wrong statement or nothing — and switching language is the only way to see the second array at all.`);

  /* The pinned table is checked against the INDICES THE RUN ACTUALLY VISITED, so
   * a table entry that is never reached is itself reported rather than sitting
   * there satisfied. */
  const pinned = PINNED[id] || {};
  const unpinned = live.filter(n => !pinned[n]);
  const mismatched = Object.entries(pinned)
    .filter(([n]) => live.includes(Number(n)))
    .filter(([n, [g, p]]) => !meta.pseudo[n]?.includes(g) || !meta.pseudoPy[n]?.includes(p))
    .map(([n, [g, p]]) => `#${n}: generic has ${meta.pseudo[n]?.includes(g) ? '"' + g + '"' : 'no "' + g + '"'}; python has ${meta.pseudoPy[n]?.includes(p) ? '"' + p + '"' : 'no "' + p + '"'}`);

  check(unpinned.length === 0 && mismatched.length === 0,
    `${id}: every live index is pinned, and both arrays say the same operation there`,
    () => [
      unpinned.length ? `${unpinned.length} live index/indices have no pinned expectation (${unpinned.join(', ')}) — either the mapping changed or PINNED needs the new index, and an unpinned index is an unverified one.` : '',
      mismatched.length ? `line(s) no longer pair up: ${mismatched.join('; ')}` : '',
    ].filter(Boolean).join(' | '));

  const fake = meta.pseudoPy.filter(l => /[←≠]/.test(l));
  check(fake.length === 0,
    `${id}: pseudoPy carries no generic-pseudocode glyphs (← ≠)`,
    () => `${fake.length} line(s) in pseudoPy still use the generic view's arrows/inequality: ${fake.map(l => JSON.stringify(l)).join(', ')}. A line left unconverted is either the generic text that slipped through or an edit that reverted; either way the Python view is not the Python view.`);
}

/* -----------------------------------------------------------------------
 * PINNED CONSTRAINS ONLY THE LINES THE PANEL HIGHLIGHTS, and the mutation
 * suite proved that is not the same thing as constraining the array.
 *
 * PINNED is keyed on the indices `lineFor` actually returns — which is the right
 * key, since an unpinned LIVE index is the failure that misleads. But it left
 * every other line free, and swapping two of THOSE (selection's `min_idx = i`
 * with its `for j in ...`) kept the length legal, kept every pinned line intact,
 * and produced Python where line 1 is a loop and line 2 assigns min_idx. A
 * reader would see that immediately and no assertion in the file saw it at all.
 *
 * So the rest of the array is pinned STRUCTURALLY instead: index i must carry
 * the same KIND of statement in both arrays. That is the invariant the prose
 * header actually promises — `pseudoPy` is the same statement LIST — and it is
 * expressible without restating either array, which a content table for all 41
 * lines would be.
 *
 * `other` IS EXEMPT, and it is exempt for a real reason rather than to make a
 * rule pass: three of the generic lines are PROSE (「把 pivot 換到 arr[high]」,
 * 「比較 left[i], right[j]…」, 「比較左右子節點…」) and the Python at those same
 * indices is real code that replaced them. Demanding a role match there would
 * demand the Python stay as vague as the prose, which is the opposite of the
 * point. Both sides classify as `other`→anything, and nothing else is excused. */
const roleOf = (line) => {
  const s = line.trimStart();
  if (/^(for|while)\b/.test(s)) return 'loop';
  if (/^if\b/.test(s)) return 'if';
  if (/^(?:def\s+)?[a-zA-Z_][a-zA-Z_0-9]*\(.*\):/.test(s)) return 'def';
  if (/\bswap\(/.test(s)) return 'swap';
  /* `←` is the generic view's assignment and `=`/`+=`/`-=` are Python's, so all
   * three forms have to classify as the same role or the arrays look
   * structurally different at every line that merely assigns. The `[^=]` after
   * the bare `=` is what keeps `==` from counting as an assignment. */
  if (/^[a-zA-Z_][a-zA-Z_0-9]*(\[[^\]]*\])*\s*(=[^=]|<-|←|\+=|-=|\+\+)/.test(s)) return 'assign';
  return 'other';
};
for (const id of ALGO_IDS) {
  const meta = ALGO_META[id];
  const shared = Math.min(meta.pseudo.length, meta.pseudoPy.length);
  const mismatched = [];
  for (let i = 0; i < shared; i++) {
    const g = roleOf(meta.pseudo[i]), p = roleOf(meta.pseudoPy[i]);
    if (g !== p && g !== 'other') mismatched.push(`#${i} ${g} vs ${p}`);
  }
  check(mismatched.length === 0,
    `${id}: both arrays carry the same KIND of statement at every shared index`,
    () => `${mismatched.join('; ')}. Same-length arrays are not the same statement list: index i has to mean the same THING in both, because one lineFor highlights index i in whichever array is on screen. Every index whose generic line is real code is compared; only the three generic PROSE lines are exempt.`);
}

/* A language that is not in PSEUDO_LANGS would fall back to `pseudo` through
 * `find(...) || PSEUDO_LANGS[0]` — silently, so the button would do nothing. The
 * array is read OUT of the page rather than restated, which is the reason this
 * is checkable at all: a second copy of the list would keep passing after one
 * side moved. */
const langIds = [...htmlCode.matchAll(/\{ id: '(\w+)', label: '([^']+)', field: '(\w+)' \}/g)]
  .map(m => ({ id: m[1], label: m[2], field: m[3] }));
check(langIds.length === 2
      && langIds[0].id === 'pseudo' && langIds[0].field === 'pseudo'
      && langIds[1].id === 'py' && langIds[1].field === 'pseudoPy'
      && new Set(langIds.map(l => l.field)).size === 2,
  'the page offers exactly two pseudocode languages, generic first, each reading its own array',
  () => `found ${JSON.stringify(langIds)}. The DEFAULT has to be the generic view and the two fields have to be different arrays — a picker whose entries both name \`pseudo\` renders Python correctly by accident and would pass every other check here.`);

const everyLangFieldExists = langIds.filter(l => !ALGO_IDS.every(id => Array.isArray(ALGO_META[id][l.field])));
check(everyLangFieldExists.length === 0,
  'every algorithm defines every array the page\'s picker offers',
  () => `these picker entries name a field some algorithm lacks: ${everyLangFieldExists.map(l => `${l.label} → ${l.field}`).join(', ')}.`);

/* ONE VOCABULARY FOR THE URL. The first version of this check asked two
 * separate questions — "does it read `?lang`?" and "does it write `lang`?" —
 * and both were true while the feature was broken: `syncUrl` wrote the literal
 * `'py'` and `state.lang` validated against `['pseudo','python']`, so a share
 * link silently reopened in the other language and nothing anywhere reported it.
 * Two assertions about two lines are not an assertion about their AGREEMENT.
 *
 * So the check is the agreement itself: the value written must BE `state.lang`,
 * and the accepted set must BE the picker's own ids. A hardcoded literal on
 * either side now fails by construction instead of by coincidence. */
check(/lang:\s*pick\(params\.get\('lang'\),\s*PSEUDO_LANGS\.map\(l => l\.id\),\s*PSEUDO_LANGS\[0\]\.id\)/.test(htmlCode)
      && /if \(state\.lang !== PSEUDO_LANGS\[0\]\.id\) p\.set\('lang', state\.lang\); else p\.delete\('lang'\);/.test(htmlCode),
  'the language is read from and written back to the URL using ONE vocabulary',
  () => "sorting.html does not round-trip the language through the picker's own ids. Either `state.lang` is not picked from PSEUDO_LANGS (so a shared link silently reopens in the default) or `syncUrl` writes a literal rather than `state.lang` (so the reader's choice is lost the next time they touch any other control — the §3.G6 shape, state that only lives in one place). A literal on one side and the list on the other is the version that shipped broken and passed this check.");

/* The highlight must survive a mid-run switch, or the panel goes blank exactly
 * when a reader is following a run. Asserted as SHAPE because that is what it is:
 * one `renderPseudocode` plus one `highlightPseudo` reading the same expression
 * the seek/step handlers use.
 *
 * SCOPED BY BRACE, not by a `[\s\S]*?\n {8}\}\);` terminator. That pattern's tail
 * ran 9,172 characters past this handler — the handler closes at six spaces and
 * it asked for eight — so what it actually asserted on was the whole rest of the
 * file. It was right by luck: the only other `highlightPseudo` call differs by an
 * `?.`, so the wrong block could not satisfy it today, but nothing about the
 * PATTERN prevented that and it broke on an unrelated edit. §3.P. */
const langSwitchOpen = htmlCode.indexOf("state.lang = lang.id");
const langSwitchBlock = blockFrom(htmlCode, htmlCode.indexOf('{', langSwitchOpen));
check(!!langSwitchBlock
      && /renderPseudocode\(state\.algo\)/.test(langSwitchBlock)
      && /highlightPseudo\(state\.algo, single\.run\?\.events\[single\.run\.cursor - 1\]\)/.test(langSwitchBlock),
  'switching language re-renders AND re-applies the current highlight',
  () => 'the language handler repaints the list without re-running highlightPseudo, so the active line is dropped for the rest of the run — the panel still tracks steps numerically but stops showing WHICH line is executing. That is the one thing the panel is for.');

/* ================================================================ RENDERED */

console.log('\nrendered: driving the real controls over CDP');

// >>> RENDERED HALF  (test_check_sorting_page.mjs strips everything between these
// >>> sentinels from a COPY, for the cases whose detector is in the static half. The
// >>> checker itself takes no flag for this, for the reason §4 of AGENTS.md gives: a
// >>> supported way to skip a check is how it stops happening. The baseline always
// >>> runs the whole thing, and the harness proves the strip takes exactly the
// >>> rendered half's check count and nothing else — otherwise a strip one check too
// >>> wide would leave the cheap cases asserting against a silently narrower checker.)
if (!existsSync(CHROME)) {
  console.log(`\nSKIP  rendered half — ${CHROME} is not installed. The static half above ran in full.`);
} else {
  const profile = mkdtempSync(join(tmpdir(), 'sortpage-'));
  /* 36 `sortpage-*` directories were in tmpdir before this. Registered inside the
   * function because the profile is, and `exit` rather than the `finally` below
   * because a throw between here and there skips it. */
  process.on('exit', () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--disable-gpu', '--mute-audio',
    `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  /* Chrome chose its own debug port; read it back from the profile. See
   * waitForDebugPort's header for why this replaced cdpPort(), and why it makes
   * assertPortFree() unnecessary rather than merely unused. */
  const dbg = await waitForDebugPort(profile);

  /* THE CHROME IS KILLED ON THE EXIT PATH TOO, and that is not tidiness — it is what
   * makes the profile removal above safe, and what makes the next run's port free.
   *
   * Removing the profile is not killing the browser. A headless Chrome left running
   * holds its `--remote-debugging-port` — under the old scheme `dbg` was derived from
   * the PID, so an orphan was a port collision waiting for the next run:
   * the new Chrome cannot bind, `fetch(:dbg/json/list)` answers from the ORPHAN, and
   * the checker drives a browser whose profile directory this process deleted under
   * it. Measured: a `pkill` of this file during a run left the Chrome alive, and the
   * pile reached 28 processes across four debug ports before it was cleared.
   *
   * `exit` covers a normal return, a `process.exit()`, and an uncaught throw — which
   * is everything except a signal, so SIGINT and SIGTERM are mapped to the same exit
   * path rather than left to orphan a browser. SIGKILL cannot be caught at all, which
   * is the honest limit of this and the reason `check_all.mjs` prints the port a run
   * is using. */
  const stopChrome = () => { try { chrome.kill(); } catch {} };
  process.on('exit', stopChrome);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { stopChrome(); process.exit(sig === 'SIGINT' ? 130 : 143); });
  }

  const targets = await (async () => {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); if (r.ok) return await r.json(); } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  })();

  if (!targets) {
    chrome.kill();
    console.log(`\nSKIP  rendered half — headless Chrome did not come up on :${dbg}.`);
  } else {
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0; const waiting = new Map();
    const noise = [];
    /* `Fetch.requestPaused` is an EVENT, not a reply, and every one of them must be
     * answered with `fulfillRequest` or the renderer sits there waiting for a message
     * nobody sends. So the counter and the reply both live here, on the same
     * dispatcher that resolves `send()` promises — and this handler is installed
     * BEFORE `Fetch.enable` below, because enabling interception is what starts the
     * events. A stub that silently fails to install would leave the page hanging on
     * the first image rather than reporting anything useful. */
    let stubbed = 0;
    ws.addEventListener('message', async e => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
      if (m.method === 'Fetch.requestPaused') {
        stubbed++;
        await send('Fetch.fulfillRequest', {
          requestId: m.params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'image/png' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body: STUB_PNG_B64,
        });
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') noise.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') noise.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    });
    const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise(r => waiting.set(i, r)); };
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(expression.slice(0, 60) + ' -> ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails.text).slice(0, 200));
      return r.result?.result?.value;
    };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    /* `setCacheDisabled` is NOT what makes this run see the current stylesheet, and the
     * reason is worth writing down because the opposite was believed for a while. One
     * run reported the OLD `.al-lanes` rule — four columns, 225×140 canvases — and the
     * first explanation was a stale HTTP cache. It was not: a concurrent session had
     * reverted algo.css ON DISK, and the run went green the moment the edit was
     * re-applied. So the flag was never the safeguard; treating it as one would mean
     * believing the page is being tested fresh when nothing was checking it.
     *
     * It stays on, for a different reason: it means an edit made DURING a run is
     * picked up rather than served from memory. With the sprite stub below, the
     * refetch it forces costs 130 MB of image transfers that never happen anyway, so
     * freshness is now free. */
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Fetch.enable', { patterns: [{ urlPattern: SPRITE_GLOB, requestStage: 'Request' }] });

    /* Poll for the lane COUNT, never for "a canvas exists". A bare existence check
     * resolves against the PREVIOUS document the instant navigate returns, so the
     * reads then race the new page's own boot. That is not hypothetical: it produced
     * a five-lane case reporting a lane of ZERO ink, which read as a rendering bug
     * and was the harness measuring the wrong document. */
    /* READY REPORTS WHAT IT SAW, not just whether it succeeded.
     *
     * It used to resolve `true` / `false`, so the two call sites that inspect the
     * result could only say "it never got there" — and one of them then interpolated
     * the SAME variable into both halves of its message:
     *
     *     unchecking to 3 lanes left the grid at 3 !== 3
     *
     * which is a failure report that reads as a typo and tells a reader nothing. The
     * condition has two clauses, so both are reported: the lane count and whether the
     * result row appeared. `LOAD`'s message had the same defect, just phrased well
     * enough to hide it, and both are fixed by one change rather than by editing a
     * string in one place.
     *
     * The 45s ceiling stays: it is a guess at "the page is broken", not a wait for a
     * measurement, and every ceiling here exceeds what it replaced. */
    const READY = `new Promise(r => { const t0 = Date.now(); const tick = () => {
        const n = document.querySelectorAll('.al-lane').length;
        const result = !!document.querySelector('.al-result');
        if (n === %LANES% && result) { r({ n, result, ready: true }); return; }
        if (Date.now() - t0 > 45000) { r({ n, result, ready: false }); return; }
        setTimeout(tick, 100);
      }; tick(); })`;
    const SETTLE = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))))`;

    /* WAIT FOR THE GRID TO STOP BEING REBUILT, because a fixed wait is a guess.
     *
     * `SETTLE` is two frames plus 400 ms, and it was the ONLY thing between
     * `sel.dispatchEvent(new Event('change'))` and reading the canvases. At n=100 and
     * n=500 the rebuild finishes inside that. At n=1,025 it does not — 6,150 sprites
     * are laid out — and the failure was silent and then loud in the wrong place:
     *
     *     ok   six lanes at n=1025 all have ink (min ∞ px)
     *     Error: TypeError: Cannot read properties of undefined (reading 'click')
     *
     * `∞` because `Math.min()` of an empty array is `Infinity`, and `Infinity > 2000`
     * is true, so the ink check certified a measurement that was never taken. Then the
     * NEXT step threw, because the speed picker's button had not been built yet either.
     * Same cause, two symptoms, and the check that should have caught it was the one
     * that passed. §3.G5's rule applies: poll for the precondition for READING a live
     * measurement, not for the asserted condition.
     *
     * The signal is the BACKING STORE, not the ink. Sprites are mid-lerp on every frame
     * (§3.G3), so ink never stops moving and polling for it to settle would wait
     * forever; a canvas's `width`/`height` do stop moving, and `finishRace()`
     * re-measures every lane when the rebuild finishes, so two identical samples a step
     * apart means the rebuild is over.
     *
     * A timeout returns `false` rather than throwing, so the assertion below still runs
     * and still reports a real number — the diagnosis belongs in the message, not in a
     * stack trace.
     *
     * IT NOW COVERS THE WHOLE BROWSER HALF, and the savings are the same shape as the
     * bug: five lane counts and one tab switch each spent 543 ms and 452 ms, which is
     * the 400 ms sleeping while the page had already finished. `READY` already
     * answered "are the right NUMBER of lanes on screen"; `STABLE` answers the separate
     * question of whether the rebuild behind that number has stopped moving, which is
     * the one `SETTLE` was guessing at. Two polls, two different facts.
     *
     * The selector is a parameter because the 單一 tab leaves no `.al-lane` at all —
     * there `#singleCanvas` is the thing that has to stop re-measuring, and passing
     * the lane count there would wait for a count that can never be right.
     */
    const STABLE = (sel, want) => `new Promise(r => { const t0 = Date.now(); let last = null, same = 0;
        const tick = () => {
          const cvs = [...document.querySelectorAll('${sel}')];
          const sig = cvs.length === ${want}
            ? cvs.map(cv => cv.width + 'x' + cv.height).join('|') : 'count=' + cvs.length;
          if (sig !== '' && sig === last) same++; else { same = 0; last = sig; }
          if (same >= 2) return r(true);
          if (Date.now() - t0 > 20000) return r(false);
          setTimeout(tick, 120);
        };
        tick();
      })`;
    const STABLE_LANES = (lanes) => STABLE('.al-lane canvas', lanes);

    /* ink = non-transparent pixels, counted by ALPHA. */
    /* ONE named read of the result panel, used by the poll AND by the check that
     * proves the poll survives the panel being absent.
     *
     * `.al-result` is created at module scope and appended to the lane grid by
     * buildRace() as its LAST act (sorting.html:685), so "not in the DOM yet" is a
     * legitimate state and the read has to treat it as an answer rather than as an
     * error. The first version inlined `!document.querySelector('.al-result').hidden`
     * and threw a TypeError on exactly that state; `evalJs` rethrows, so the
     * assertion below never ran and the checker died with a stack trace 70 lines
     * from the cause.
     *
     * It is a NAMED constant rather than an inline expression because the guard is
     * otherwise untestable. A mutation that restores the hard dereference stays
     * green whenever the page happens to behave, because the bad branch is only
     * reached when the element is MISSING — which is the flake, so a harness cannot
     * produce it on demand. Sharing the expression lets a check rename the element
     * out of the way, run this exact code, and get the absence it needs. */
    const RESULT_PANEL_STATE = `(() => {
        const el = document.querySelector('.al-result');
        return JSON.stringify({ shown: !!el && !el.hidden, present: !!el });
      })()`;

    const INK = `(() => { const out = []; for (const cv of document.querySelectorAll('.al-lane canvas')) {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        out.push({ ink: n, css: Math.round(cv.getBoundingClientRect().width) + 'x' + Math.round(cv.getBoundingClientRect().height), backing: cv.width + 'x' + cv.height });
      } return JSON.stringify(out); })()`;

    const LOAD = async (lanes, n) => {
      await send('Page.navigate', { url: `${BASE}/sorting.html?mode=race&algos=${'bubble,selection,insertion,quick,merge,heap'.split(',').slice(0, lanes).join(',')}&n=${n}&speed=fast&seed=424242` });
      const st = await evalJs(READY.replace('%LANES%', String(lanes)));
      if (!st?.ready) throw new Error(`the race grid settled at ${st?.n ?? 0} lanes, not ${lanes}`
        + `, and the result row was ${st?.result ? 'there' : 'absent'}, at n=${n}`);
      await evalJs(STABLE_LANES(lanes));
    };

    /* ONE load for all five lane counts, via the reader's own chips.
     *
     * Navigating per count is what made a first pass at this take half an hour: the
     * page re-fetches 1,025 sprites on every boot, so each load is ~15-25s and five
     * of them is most of the runtime. The chips already rebuild the race on change
     * (that handler is what `buildRace()` is called from), so clicking down from six
     * to two tests the same wiring a reader uses and costs one load instead of five.
     * `algos` is ordered so unchecking from the END leaves the first `lanes` values
     * checked — the picker refuses to drop below two, which is exactly the floor this
     * loop stops at. */
    const SET_LANES = (lanes) => `(() => {
      const boxes = [...document.querySelectorAll('#raceAlgoPicker input')];
      const want = ${lanes};
      for (const box of boxes) {
        const order = ['bubble','selection','insertion','quick','merge','heap'].indexOf(box.value);
        const shouldBe = order < want;
        if (box.checked !== shouldBe) box.click();
      }
      return want;
    })()`;

    const EXPECTED_COLS = { 2: 2, 3: 3, 4: 2, 5: 6, 6: 3 };
    let minInk = Infinity;

    try {
      await LOAD(6, 250);
      for (const lanes of [6, 5, 4, 3, 2]) {
        if (lanes !== 6) {
          await evalJs(SET_LANES(lanes));
          const st = await evalJs(READY.replace('%LANES%', String(lanes)));
          if (!st?.ready) throw new Error(`unchecking to ${lanes} lanes left the grid at`
            + ` ${st?.n ?? 0} lanes, and the result row was ${st?.result ? 'there' : 'absent'}`);
          await evalJs(STABLE_LANES(lanes));
        }
        const m = JSON.parse(await evalJs(`JSON.stringify({
          lanes: document.querySelectorAll('.al-lane').length,
          dataLanes: document.getElementById('raceGrid').dataset.lanes,
          cols: getComputedStyle(document.getElementById('raceGrid')).gridTemplateColumns.split(' ').length,
          lastChildIsResult: document.getElementById('raceGrid').lastElementChild.className,
        })`));
        check(m.lanes === lanes && Number(m.dataLanes) === lanes,
          `${lanes} lanes render, and data-lanes says ${lanes}`,
          () => `expected ${lanes} lanes, found ${m.lanes} (data-lanes=${m.dataLanes}). buildRace() maps state.algos to cards, so a mismatch here means the picker, the state and the grid have drifted apart.`);
        check(m.cols === EXPECTED_COLS[lanes],
          `${lanes} lanes lay out in ${EXPECTED_COLS[lanes]} column tracks`,
          () => `expected ${EXPECTED_COLS[lanes]} computed columns, got ${m.cols}. 2 and 4 want two columns, 5 wants six, and the default of three covers 3 and 6.`);
        check(/\bal-result\b/.test(m.lastChildIsResult),
          `.al-result is the LAST child of the lane grid at ${lanes} lanes`,
          () => `the last child is "${m.lastChildIsResult}". The five-lane shape selects its bottom two lanes by :nth-child, which only holds while the result panel is last.`);
        const inks = JSON.parse(await evalJs(INK));

        /* The empty case is 0 ink, not 0 lanes. `Math.min()` of nothing is Infinity and
         * Infinity beats every floor there is, so a query that matched no canvas used to
         * report a PASS with a figure no reader could make sense of. Zero is the honest
         * number: there is nothing on the screen, and "the emptiest lane holds 0" is
         * what was seen. */
        const laneMin = inks.length ? Math.min(...inks.map(i => i.ink)) : 0;
        minInk = Math.min(minInk, laneMin);
        check(laneMin > 2000,
          `all ${lanes} race canvases have ink (min ${laneMin.toLocaleString('en-US')} px)`,
          () => `the emptiest lane holds ${laneMin} non-transparent pixels at ${lanes} lanes${inks.length ? '' : ` — and INK found ${inks.length} canvases, so nothing was measured at all`}. Alpha is the measure on purpose: a blank canvas is TRANSPARENT, so a check that ignores alpha scores a pristine canvas as a perfect result. This is the defect that shipped — paint() drawing into the hidden single-mode canvas.`);

        /* The five-lane bottom two span half a row each, so they are 1.5x wider than
         * the three above. Asserted as a WIDTH ordering rather than as exact pixels:
         * the claim is "the bottom two are the wide ones", and pinning the ratio to
         * the viewport would only make it fail on a different screen. */
        if (lanes === 5) {
          const widths = inks.map(i => Math.round(parseInt(i.css) || 0));
          const sorted = [...widths].sort((a, b) => a - b);
          check(sorted[0] < sorted[sorted.length - 1],
            'in a five-lane race the bottom two lanes are the wider ones',
            () => `canvas widths are [${widths.join(', ')}] — all equal, so the two bottom lanes are NOT taking half a row each and the 上3下2 shape is not being honoured.`);
        }
      }

      /* Every sample size, on the reader's own control rather than a URL parameter:
       * an option that renders but whose change handler never fires is invisible to a
       * URL-driven check and is exactly the kind of control that is inert. Back to six
       * lanes first, by chip — the loop above left the grid at two. */
      await evalJs(SET_LANES(6));
      /* READY's result was DISCARDED here, and at the finish path below. READY is
       * the one poll that waits for `.al-result` to EXIST — it exists precisely
       * because that element is appended at the very end of buildRace() — so
       * dropping its return value means the one precondition the next statements
       * depend on is the one nobody checked. It has a 45 s ceiling and resolves
       * `{ ready: false }` when it expires, which is a fact about the page worth
       * hearing.
       *
       * `LOAD` and the lane loop above already capture it and throw a NAMED error.
       * This is the same contract; the difference is that a failure here used to
       * surface 70 lines later as an unrelated TypeError. */
      const sixReady = await evalJs(READY.replace('%LANES%', '6'));
      check(sixReady?.ready === true,
        'going back to six lanes settles, with the result row present',
        () => `the grid stayed at ${sixReady?.n ?? 0} lanes after 45 s, and the result row was`
          + ` ${sixReady?.result ? 'present' : 'ABSENT'}. \`raceResult\` is appended by buildRace() as its`
          + ' last act (sorting.html:685), so an absent one means buildRace() did not run to the end —'
          + ' and the lane count here says whether it stopped before or after building the cards.');
      await evalJs(STABLE_LANES(6));
      for (const n of ['100', '500', '1025']) {
        const m = JSON.parse(await evalJs(`(() => {
          const sel = document.getElementById('raceSizeSelect');
          sel.value = '${n}';
          sel.dispatchEvent(new Event('change'));
          return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(JSON.stringify({
            lanes: document.querySelectorAll('.al-lane').length,
            urlN: new URLSearchParams(location.search).get('n'),
            selectN: sel.value,
          })))));
        })()`));
        /* STABLE, not SETTLE, and this is the line that was the bug. The change handler
         * rebuilds 6,150 sprites at n=1025, which does not fit inside two frames plus
         * 400 ms, so the reading below used to be taken against a grid mid-rebuild. */
        await evalJs(STABLE_LANES(6));
        const inks = JSON.parse(await evalJs(INK));
        const laneMin = inks.length ? Math.min(...inks.map(i => i.ink)) : 0;
        minInk = Math.min(minInk, laneMin);
        check(m.lanes === 6 && m.urlN === n && m.selectN === n,
          `changing the select to ${n} rebuilds the race and writes it to the URL`,
          () => `after the change: ${m.lanes} lanes, URL n=${m.urlN}, select=${m.selectN}. The control and the share link must agree, or one of them is a control that does nothing.`);
        check(laneMin > 2000,
          `six lanes at n=${n} all have ink (min ${laneMin.toLocaleString('en-US')} px)`,
          () => `the emptiest lane holds ${laneMin} non-transparent pixels at n=${n}${inks.length ? '' : ` — and INK found ${inks.length} canvases, so nothing was measured at all`}`);
      }

      /* The finish path, at a size that completes inside a checker's budget. It is the
       * same code at every n — what 1,025 exercises that 250 does not is duration, not
       * a branch — and the panel's own claim is what a reader will believe. Reached by
       * dropping the size select back to 250 and clicking 極快, rather than by
       * navigating: both are the reader's controls, and a navigation here would cost a
       * fifth of the whole runtime.
       *
       * The two are now SEPARATE statements, and the order is the fix. Changing the
       * select rebuilds the grid, which detaches the speed picker's children while the
       * new ones are built; `.find(...)` then returned undefined and `.click()` threw
       * `Cannot read properties of undefined`. Rebuild first, wait for the grid to hold
       * still, and only then reach for a button that is guaranteed to exist — with the
       * count returned so an empty picker is a readable failure and not a stack trace. */
      await evalJs(`(() => {
        const sel = document.getElementById('raceSizeSelect');
        sel.value = '250'; sel.dispatchEvent(new Event('change'));
        return true;
      })()`);
      await evalJs(STABLE_LANES(6));
      const speeds = JSON.parse(await evalJs(`JSON.stringify({
        present: [...document.querySelectorAll('#speedPicker button')].length,
        fastest: [...document.querySelectorAll('#speedPicker button')].some(b => b.textContent === '極快'),
      })`));
      check(speeds.present > 0 && speeds.fastest,
        'the speed picker is built before anything clicks it',
        () => `#speedPicker has ${speeds.present} button(s) and ${speeds.fastest ? 'no' : 'no button labelled 極快'}. Clicking it before the grid finished rebuilding is what threw here; the count is reported so an empty picker is distinguishable from a renamed label.`);
      if (speeds.present > 0 && speeds.fastest) {
        await evalJs(`[...document.querySelectorAll('#speedPicker button')].find(b => b.textContent === '極快').click()`);
      }
      /* The second discarded READY, and the one that mattered: the very next thing
       * the loop below does is read `.al-result`, so this is the precondition for
       * that read and it was being thrown away. */
      const finishReady = await evalJs(READY.replace('%LANES%', '6'));
      check(finishReady?.ready === true,
        'the grid is settled and the result row present before the finish path starts',
        () => `the grid was still settling when the finish path started: ${finishReady?.n ?? 0} lanes,`
          + ` result row ${finishReady?.result ? 'present' : 'ABSENT'} after READY's 45 s ceiling.`
          + ' \`raceResult\` is appended by buildRace() as its last act (sorting.html:685), so an absent'
          + ' one means buildRace() did not run to the end — and the lane count here says whether it'
          + ' stopped before or after building the cards.');
      await evalJs(STABLE_LANES(6));
      /* Produce the condition the poll below has to survive, and check it does.
       *
       * Placed HERE, after READY has confirmed the panel exists — which is the only
       * place it is guaranteed to. The class is renamed and restored inside ONE
       * evaluate, so there is no window in which the real poll could observe the
       * probe's state, and the race never restarts.
       *
       * This is the assertion the earlier version had no way to make: without it,
       * restoring the hard dereference stays green whenever the page happens to
       * behave, because the bad branch is only reached when the element is MISSING. */
      const probe = JSON.parse(await evalJs(`(() => {
        const el = document.querySelector('.al-result');
        if (!el) return JSON.stringify({ skipped: true });
        const was = el.className;
        el.className = 'al-result-probe-renamed';
        let out;
        try { out = ${RESULT_PANEL_STATE}; }
        catch (e) { out = JSON.stringify({ threw: String(e) }); }
        finally { el.className = was; }
        return out;
      })()`));
      check(probe.skipped !== true,
        '.al-result exists before the finish path reads it',
        () => 'READY reported the result row present a moment ago, so this is the probe failing rather than the page — and the poll it guards has nothing to read.');
      check(probe.skipped === true || (probe.threw === undefined && probe.present === false && probe.shown === false),
        'the result-panel read returns an ANSWER when the panel is absent, rather than throwing',
        () => probe.threw !== undefined
          ? `with .al-result renamed out of the way the read THREW ${probe.threw}. That is the original bug: the poll below would die on the same expression, ${probe.threw.length > 0 ? 'so the failure surfaces as a stack trace 70 lines from its cause' : ''} instead of its own assertion reporting it.`
          : `with .al-result renamed out of the way the read returned ${JSON.stringify(probe)}. It must report present:false and shown:false; anything else means the poll below cannot answer the question it is asking.`);
      await evalJs("document.getElementById('btnRacePlay').click()");
      let done = null;
      /* The step is 250 ms, not 700, and the ceiling is UNCHANGED at 28 s — which is the
       * point of naming both. A faster step does not shorten the race or raise the
       * chance of missing it; it only shortens the wait AFTER the race has already
       * finished, which is where the time was going: at turbo a six-lane 250-sample
       * race is over in about a second, and a 700 ms step then reports it up to 700 ms
       * late, every run. The ceiling stays where it was so a race that genuinely hangs
       * still fails after ~28 s rather than after 7.
       *
       * This is a wait for a THING TO HAPPEN, not a wait for a measurement to settle,
       * so the step size only trades latency against round-trips. The 40 samples are
       * unchanged. */
      for (let i = 0; i < 112; i++) {
        await new Promise(r => setTimeout(r, 250));
        /* `.al-result` only enters the DOM at the end of buildRace(), so "not there yet" is
         * a state this loop has to carry to its ceiling, and RESULT_PANEL_STATE —
         * the same expression the check above probes — is what reports it. A missing
         * panel and a hidden one are the same answer to the question being asked. */
        done = Object.assign(
          JSON.parse(await evalJs(RESULT_PANEL_STATE)),
          { ranks: JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('.al-lane-rank')].map(e => e.textContent).filter(Boolean))`)) },
        );
        if (done.shown) break;
      }
      check(done && done.shown, 'a six-lane race finishes and shows its ranking',
        () => `after ~28s at turbo the result panel was ${done && done.present ? 'present but still hidden' : 'never added to the lane grid at all'} (${JSON.stringify(done)}).`
          + (done && !done.present
            ? ' It is appended by buildRace() as that function\'s LAST act, after the lane cards — so an absent element means buildRace() did not run to the end, and the lane count in the panel above says whether it stopped before or after building them.'
            : ''));
      check(done && done.ranks.length === 6 && new Set(done.ranks).size === 6,
        'every lane gets a distinct rank',
        () => `ranks are [${done && done.ranks.join(', ')}] — six lanes need six distinct 第 N 名 labels, since finishRace() writes them by position.`);

      const prose = await evalJs(`(document.querySelector('.al-result .al-hint')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim()`);
      const stated = prose.match(/(\d+\.\d)px/);
      const actual = JSON.parse(await evalJs(`(() => {
        const cv = document.querySelector('.al-lane canvas');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return JSON.stringify({ ink: n });
      })()`));
      check(!!stated && Number(stated[1]) > 4 && Number(stated[1]) < 24,
        `the result panel states the lane's real sprite size (${stated ? stated[1] : 'none'}px)`,
        () => `the panel's prose is "${prose.slice(0, 140)}" — no px figure in it. The panel is where a reader learns whether they are looking at Pokémon or at a colour gradient, so the number has to be on the page and not only in a comment.`);
      check(actual.ink > 2000, 'the canvases still hold ink after the result panel appears',
        () => `ink fell to ${actual.ink} once the panel was shown. finishRace() adds a grid row and the lane rows are 1fr, so every canvas shrinks — the ones that were cleared without a repaint would be blank here.`);

      /* Single mode must be untouched by a race-mode fix: the three helpers were changed for
       * the lanes, and the single canvas is the one they used to write to by accident.
       *
       * Reached by CLICKING THE 單一 TAB, not by navigating — and this is not a
       * shortcut, it is the same state for free. The page's boot sequence runs
       * `setMode(state.mode)` and then `resetSingle()` UNCONDITIONALLY, so the
       * single-mode canvas and its 1,025 nodes exist from the first paint whatever
       * `mode=` says; a `mode=single` navigation was buying a second boot to obtain a
       * state the first one already had. That boot was ~45s of the checker's runtime,
       * and through the mutation suite's full baseline most of the suite's as well.
       *
       * If the nodes were somehow absent, the ink check below fails loudly rather than
       * passing on an empty canvas — which is the correct failure mode here, and the
       * reason this can be a click. */
      await evalJs("document.getElementById('tabSingle').click()");
      const switched = await evalJs(`new Promise(r => { const t = setInterval(() => {
          if (document.getElementById('raceGrid').hidden === true && document.getElementById('singleCanvas').hidden === false) { clearInterval(t); r(true); }
        }, 100); setTimeout(() => { clearInterval(t); r(false); }, 20000); })`);
      check(switched,
        'clicking the 單一 tab swaps the stage to single mode',
        () => 'after clicking 單一, the race grid was still visible or the single canvas still hidden. setMode() is the page\'s own handler for that tab, so this is the page failing to respond to a control.');
      await evalJs(STABLE('#singleCanvas', 1));
      const single = JSON.parse(await evalJs(`(() => {
        const cv = document.getElementById('singleCanvas');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return JSON.stringify({ ink: n, raceHidden: document.getElementById('raceGrid').hidden, canvasHidden: cv.hidden, w: cv.width, h: cv.height });
      })()`));
      check(single.ink > 5000 && single.canvasHidden === false && single.raceHidden === true && single.w > 0,
        'single mode still paints its own canvas, and only its own',
        () => `single canvas ink=${single.ink}, hidden=${single.canvasHidden}, backing=${single.w}x${single.h}, race grid hidden=${single.raceHidden}. The race lanes drawing into this canvas was the bug; the reverse — single mode painting into a lane — would be the mirror image.`);

      /* ------------------------------------------------------- 390x844
       *
       * THE WIDTH NOTHING MEASURED, and the reason this section exists rather than
       * a note. Everything above runs at 1440×900 with `mobile: false`; the whole
       * feature under test is a `max-width: 900px` branch, so before this section
       * the suite asserted the desktop path 37 times and the phone path not at
       * all. §3.O and §3.X both record that gap in this project's own history —
       * 「nothing in the suite reads a header's geometry」 — and this is the same
       * hole in a different element, opened by adding a second behaviour to a
       * page whose only tested width was the wide one.
       *
       * THE CLAIM IS "ZERO IMAGE REQUESTS", and it is measured by resetting the
       * stub counter and reading it, rather than by looking at the DOM for a gate
       * element. The DOM check is what a reader would write, and it is satisfied
       * by a page that shows the gate AND loads 168 MB behind it — which is the
       * exact defect the feature exists to prevent, invisible to a shape check.
       * The counter is the only thing that can see it.
       *
       * `mobile: true` is set as well as the width, because the gate reads a media
       * query and a width override alone answers it; the flag is what makes it a
       * phone rather than a 390px-wide window on a desktop. The gate does NOT read
       * it — `navigator` sniffing is rejected in the static half — so this is belt
       * and braces against the emulation being wrong, not against the page. */
      const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
      await send('Emulation.setDeviceMetricsOverride', PHONE);
      const stubbedBeforeGate = stubbed;
      await send('Page.navigate', { url: `${BASE}/sorting.html` });
      /* Poll for the GATE, on a precondition only the gate has: the overlay is not
       * hidden AND the canvas is still 300×150 (nothing has painted it). A wait on
       * the overlay alone would resolve against the loading state of the default
       * scope, which is the same value — §3.B2's vacuity shape, where an assertion
       * cannot distinguish the two states it is meant to separate. */
      const gateUp = await evalJs(`new Promise(r => { const t0 = Date.now(); const tick = () => {
          const ov = document.getElementById('loading');
          const cv = document.getElementById('singleCanvas');
          const gate = ov && !ov.hidden && ov.classList.contains('is-gate');
          if (gate) { r({ gate, canvasW: cv.width, text: (document.getElementById('loadingText')?.textContent || '').slice(0, 40) }); return; }
          if (Date.now() - t0 > 20000) { r({ gate: false, canvasW: cv.width, text: '' }); return; }
          setTimeout(tick, 100);
        }; tick(); })`);
      check(gateUp.gate === true,
        'at 390x844 the page opens on the scope gate instead of loading 1,025 sprites',
        () => `after 20s the overlay was not a gate (text started "${gateUp.text}"). Either needsChoice did not fire — the media query disagrees with algo.css — or the gate was replaced by a load that had already started.`);
      check(stubbed === stubbedBeforeGate,
        `a gated phone load asks for ZERO sprites (${stubbed - stubbedBeforeGate} requested)`,
        () => `${stubbed - stubbedBeforeGate} image request(s) were made while the gate was up. The gate exists for a memory budget (~168 MB at 1,025 sprites), so a page that shows the gate and fetches anyway satisfies every DOM check and none of the ones that matter.`);

      /* Picking a scope by DRIVING THE CONTROL, not by calling loadScope(). A direct
       * call would skip the select's own writer, its `state.scope` assignment and the
       * URL round trip — three of the four things the change is made of. §3.G: the
       * same state for free is reached by using the page's own affordance. */
      const scopePicked = await evalJs(`new Promise(r => { const t0 = Date.now(); const tick = () => {
          const sel = document.getElementById('scopeSelect');
          const opts = sel ? [...sel.options].map(o => o.value + ':' + o.textContent) : [];
          if (sel && sel.options.length === 10) { r({ opts }); return; }
          if (Date.now() - t0 > 15000) { r({ opts }); return; }
          setTimeout(tick, 100);
        }; tick(); })`);
      check(scopePicked.opts.length === 10
        && scopePicked.opts[0].startsWith('all:')
        && scopePicked.opts.some(o => o.startsWith('5:') && o.includes('156')),
        'the scope select offers 所有世代 plus nine generations, each labelled with its own count',
        () => `the select offered ${scopePicked.opts.length} option(s): ${scopePicked.opts.join(' | ')}. The count in the label is what the reader commits memory against, so it cannot be omitted and it cannot be wrong — 第 5 世代 is 156 records in pokemon_data.json.`);

      const beforePick = stubbed;
      await evalJs(`(() => { const s = document.getElementById('scopeSelect'); s.value = '5'; s.dispatchEvent(new Event('change')); return true; })()`);
      /* Wait for the LOAD, on `is-gate` being gone — a precondition only a finished
       * load has. Polling on the sprite count instead would race the stub. */
      const afterPick = await evalJs(`new Promise(r => { const t0 = Date.now(); const tick = () => {
          const ov = document.getElementById('loading');
          if (ov && ov.hidden) { r({ loaded: true, label: document.getElementById('singleCanvas').getAttribute('aria-label') }); return; }
          if (Date.now() - t0 > 30000) { r({ loaded: false, label: null }); return; }
          setTimeout(tick, 100);
        }; tick(); })`);
      check(afterPick.loaded === true,
        'choosing 第 5 世代 loads it and dismisses the gate',
        () => 'the overlay never went hidden within 30s of picking 第 5 世代. loadScope() awaits loadAllPokemonNodes and hides the overlay after it resolves, so this is either the fetch failing or loadScope() throwing before its last line.');
      check(stubbed - beforePick === 156,
        `第 5 世代 asks for exactly its own 156 sprites (asked for ${stubbed - beforePick})`,
        () => `the scope filter is off: picking 第 5 世代 made ${stubbed - beforePick} sprite request(s). assets/data/pokemon_data.json has 156 records with generation === 5. Either scopedData() compares the wrong field or scope.count is prose that does not match the data — and the option label tells the reader 156.`);

      /* The derived sample sizes, at the scope where they are wrong without it.
       * 第 6 世代 is the smallest at 72, which is below the smallest of the four
       * static sizes — so this is the case where `offeredRaceSizes()` has to fall
       * through to "offer the scope's own size" rather than filter. */
      await evalJs(`(() => { const s = document.getElementById('scopeSelect'); s.value = '6'; s.dispatchEvent(new Event('change')); return true; })()`);
      const after72 = await evalJs(`new Promise(r => { const t0 = Date.now(); const tick = () => {
          const ov = document.getElementById('loading');
          const rs = document.getElementById('raceSizeSelect');
          if (ov && ov.hidden && rs && rs.options.length) {
            r({ opts: [...rs.options].map(o => o.value), stateN: rs.value });
            return;
          }
          if (Date.now() - t0 > 30000) { r({ opts: [], stateN: null }); return; }
          setTimeout(tick, 100);
        }; tick(); })`);
      check(after72.opts.length === 1 && after72.opts[0] === '72',
        'a 72-generation offers exactly one sample size, and it is 72',
        () => `the 取樣 select offered [${after72.opts.join(', ')}] under 第 6 世代 (72 records). Without offeredRaceSizes() the four static sizes survive, and sampleEvenly() returns arr.slice() as soon as n >= arr.length — so all four would render the same 72 sprites under labels reading 100 through 1,025. A reader picks 500, watches 72, and has no way to tell the control did anything.`);

      /* The gate must NOT be reachable from a link, because a link is a claim about
       * what the sender was looking at. Same viewport, same media query, explicit
       * scope — this is the one navigation that gets to load. */
      await send('Page.navigate', { url: `${BASE}/sorting.html?scope=1` });
      const viaLink = await evalJs(`new Promise(r => { const t0 = Date.now(); const tick = () => {
          const ov = document.getElementById('loading');
          if (ov && ov.hidden) { r({ loaded: true, scope: new URL(location.href).searchParams.get('scope') }); return; }
          if (Date.now() - t0 > 30000) { r({ loaded: false }); return; }
          setTimeout(tick, 100);
        }; tick(); })`);
      check(viaLink.loaded === true && viaLink.scope === '1',
        '?scope=1 loads at a phone width — a shared link is never gated',
        () => `a 390px viewport opening ?scope=1 reported loaded=${viaLink.loaded}. needsChoice is \`scopeFromUrl == null && matchMedia(NARROW_MQ).matches\`, and this URL names a scope, so the gate must not fire. If it did, a sender who shared a link from a desktop would have their reader see a picker instead of their race.`);

      /* Restore the wide viewport and the default URL before the stub-liveness read
       * below, which asserts a floor of 1,025 over the WHOLE run and would
       * otherwise be measuring a phone session. */
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `${BASE}/sorting.html?scope=all&mode=race&algos=bubble,quick&n=1025&speed=fast&seed=424242` });
      await evalJs(READY.replace('%LANES%', '2'));

      check(noise.length === 0, 'the page produced no console errors or exceptions',
        () => noise.slice(0, 3).join(' | '));

      /* The stub has to be PROVEN live, or the speedup is a claim nothing checks. A typo
       * in the urlPattern falls through to the real sprite directory, all the rendered
       * checks still pass, and the run quietly takes four times as long — the same shape
       * as a silent skip-cache hit.
       *
       * THE FLOOR IS NOW HIGHER THAN ONE PAGE LOAD, because the run loads more than one:
       * the wide half's navigations, then the 390×844 section's four (a gate that asks
       * for ZERO, 156, 72 and 151). So the floor is the sum, not 1,025 — and the sum is
       * written out as arithmetic rather than as one magic number, because a magic total
       * is a second copy of every scope's count and would drift silently. §3.B1's rule,
       * applied to an assertion.
       *
       * The individual counts are the same numbers the 390×844 section just asserted
       * against `pokemon_data.json`, so if a scope's real size moves, both this floor
       * and those two checks move with it rather than disagreeing about which is right. */
      const WIDE_LOADS = 1025;
      const PHONE_LOADS = 0 + 156 + 72 + 151;
      const EXPECTED_STUB_FLOOR = WIDE_LOADS + PHONE_LOADS;
      check(stubbed >= EXPECTED_STUB_FLOOR,
        `the sprite stub answered all ${stubbed.toLocaleString('en-US')} image requests (${EXPECTED_STUB_FLOOR.toLocaleString('en-US')} expected across the wide and phone sections)`,
        () => `only ${stubbed} request(s) were intercepted against an expected floor of ${EXPECTED_STUB_FLOOR}, so the run fetched real sprites over HTTP — which is why it was slow. Either the glob "${SPRITE_GLOB}" no longer matches ${ASSETS_IMAGES} or Fetch.enable was not reached.`);

      /* `minInk` starts at Infinity, which is the right identity for a minimum and the
       * wrong thing to PRINT. Every contribution is now a real number (a configuration
       * that measured nothing contributes 0, not Infinity), so the only way to reach
       * `∞` here is for the loop above never to have run — which is a broken run, not
       * a result, and saying so is worth a check of its own. */
      check(Number.isFinite(minInk),
        'every configuration the browser half visited was actually measured',
        () => `minInk is still ${minInk}, so no configuration was read at all. The ink figures above were never taken, whatever they said.`);
      console.log(`\n  measured: min ink across every configuration was ${Number.isFinite(minInk) ? minInk.toLocaleString('en-US') + ' px' : 'NOT MEASURED'} (a FLOOR, not a bound — sprites are mid-lerp on every frame)`);
      console.log(`  note: that figure is with STUBBED 4×4 opaque sprites, so it is HIGHER than the real-sprite one and not comparable to it`);
      console.log(`  stub answered ${stubbed.toLocaleString('en-US')} image requests; at 126.7 KB mean that is ~${(stubbed * 126.7 / 1024).toFixed(0)} MB not transferred`);
    } finally {
      chrome.kill();
    }
  }
}

// <<< RENDERED HALF

if (failures) {
  console.log(`\nFAIL  ${failures} of ${checks} checks failed\n`);
  process.exit(1);
}
console.log(`\nPASS  all ${checks} checks`);