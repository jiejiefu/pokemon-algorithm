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
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.SORT_PORT || 5500);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

/* The four sample sizes must be the SAME four in the module, the <select>, and the
 * state default. `state.n` is validated against RACE_SIZES on load, so a size in the
 * select that is not in the array is an option that silently falls back. */
const sizes = [...htmlCode.match(/const RACE_SIZES = \[([^\]]*)\]/)?.[1].matchAll(/'(\d+)'/g)].map(m => m[1]);
check(JSON.stringify(sizes) === JSON.stringify(['100', '250', '500', '1025']),
  'RACE_SIZES is 100 / 250 / 500 / 1025',
  () => `RACE_SIZES is [${sizes.join(', ')}] — expected 100, 250, 500, 1025`);
const options = [...htmlCode.matchAll(/<option value="(\d+)"/g)].map(m => m[1]);
check(options.length === sizes.length && sizes.every(s => options.includes(s)),
  'the sample-size <select> offers exactly the sizes RACE_SIZES accepts',
  () => `the select offers [${options.join(', ')}] but RACE_SIZES is [${sizes.join(', ')}]. state.n is validated against RACE_SIZES on load, so an option outside it is one that silently falls back to the default.`);

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
  const dbg = 9400 + (process.pid % 200);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--disable-gpu', '--mute-audio',
    `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

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
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
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
    /* Live Server will serve algo.css straight from the HTTP cache, and the symptom
     * is a check that reports the OLD stylesheet as though it were the new one —
     * every case comes back with four columns and 225x140 canvases, which is the
     * pre-fix auto-fit rule, and nothing about the run makes that obvious. */
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    /* Poll for the lane COUNT, never for "a canvas exists". A bare existence check
     * resolves against the PREVIOUS document the instant navigate returns, so the
     * reads then race the new page's own boot. That is not hypothetical: it produced
     * a five-lane case reporting a lane of ZERO ink, which read as a rendering bug
     * and was the harness measuring the wrong document. */
    const READY = `new Promise(r => { const t = setInterval(() => {
        if (document.querySelectorAll('.al-lane').length === %LANES% && document.querySelector('.al-result')) { clearInterval(t); r(true); }
      }, 100); setTimeout(() => { clearInterval(t); r(false); }, 45000); })`;
    const SETTLE = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))))`;

    /* ink = non-transparent pixels, counted by ALPHA. */
    const INK = `(() => { const out = []; for (const cv of document.querySelectorAll('.al-lane canvas')) {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        out.push({ ink: n, css: Math.round(cv.getBoundingClientRect().width) + 'x' + Math.round(cv.getBoundingClientRect().height), backing: cv.width + 'x' + cv.height });
      } return JSON.stringify(out); })()`;

    const LOAD = async (lanes, n) => {
      await send('Page.navigate', { url: `${BASE}/sorting.html?mode=race&algos=${'bubble,selection,insertion,quick,merge,heap'.split(',').slice(0, lanes).join(',')}&n=${n}&speed=fast&seed=424242` });
      const ok = await evalJs(READY.replace('%LANES%', String(lanes)));
      if (!ok) throw new Error(`the race grid never reached ${lanes} lanes at n=${n}`);
      await evalJs(SETTLE);
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
          const got = await evalJs(READY.replace('%LANES%', String(lanes)));
          if (!got) throw new Error(`unchecking to ${lanes} lanes left the grid at ${lanes} !== ${lanes}`);
          await evalJs(SETTLE);
        }
        const m = JSON.parse(await evalJs(`JSON.stringify({
          lanes: document.querySelectorAll('.al-lane').length,
          dataLanes: document.getElementById('raceGrid').dataset.lanes,
          cols: getComputedStyle(document.getElementById('raceGrid')).gridTemplateColumns.split(' ').length,
          lastChildIsResult: document.getElementById('raceGrid').lastElementChild.className,
        })`));
        const inks = JSON.parse(await evalJs(INK));

        check(m.lanes === lanes && Number(m.dataLanes) === lanes,
          `${lanes} lanes render, and data-lanes says ${lanes}`,
          () => `expected ${lanes} lanes, found ${m.lanes} (data-lanes=${m.dataLanes}). buildRace() maps state.algos to cards, so a mismatch here means the picker, the state and the grid have drifted apart.`);
        check(m.cols === EXPECTED_COLS[lanes],
          `${lanes} lanes lay out in ${EXPECTED_COLS[lanes]} column tracks`,
          () => `expected ${EXPECTED_COLS[lanes]} computed columns, got ${m.cols}. 2 and 4 want two columns, 5 wants six, and the default of three covers 3 and 6.`);
        check(/\bal-result\b/.test(m.lastChildIsResult),
          `.al-result is the LAST child of the lane grid at ${lanes} lanes`,
          () => `the last child is "${m.lastChildIsResult}". The five-lane shape selects its bottom two lanes by :nth-child, which only holds while the result panel is last.`);

        const laneMin = Math.min(...inks.map(i => i.ink));
        minInk = Math.min(minInk, laneMin);
        check(laneMin > 2000,
          `all ${lanes} race canvases have ink (min ${laneMin.toLocaleString('en-US')} px)`,
          () => `the emptiest lane holds ${laneMin} non-transparent pixels at ${lanes} lanes. Alpha is the measure on purpose: a blank canvas is TRANSPARENT, so a check that ignores alpha scores a pristine canvas as a perfect result. This is the defect that shipped — paint() drawing into the hidden single-mode canvas.`);

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
      await evalJs(READY.replace('%LANES%', '6'));
      await evalJs(SETTLE);
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
        await evalJs(SETTLE);
        const inks = JSON.parse(await evalJs(INK));
        const laneMin = Math.min(...inks.map(i => i.ink));
        minInk = Math.min(minInk, laneMin);
        check(m.lanes === 6 && m.urlN === n && m.selectN === n,
          `changing the select to ${n} rebuilds the race and writes it to the URL`,
          () => `after the change: ${m.lanes} lanes, URL n=${m.urlN}, select=${m.selectN}. The control and the share link must agree, or one of them is a control that does nothing.`);
        check(laneMin > 2000,
          `six lanes at n=${n} all have ink (min ${laneMin.toLocaleString('en-US')} px)`,
          () => `the emptiest lane holds ${laneMin} non-transparent pixels at n=${n}`);
      }

      /* The finish path, at a size that completes inside a checker's budget. It is the
       * same code at every n — what 1,025 exercises that 250 does not is duration, not
       * a branch — and the panel's own claim is what a reader will believe. Reached by
       * dropping the size select back to 250 and clicking 極快, rather than by
       * navigating: both are the reader's controls, and a navigation here would cost a
       * fifth of the whole runtime. */
      await evalJs(`(() => {
        const sel = document.getElementById('raceSizeSelect');
        sel.value = '250'; sel.dispatchEvent(new Event('change'));
        [...document.querySelectorAll('#speedPicker button')].find(b => b.textContent === '極快').click();
        return new URLSearchParams(location.search).get('speed');
      })()`);
      await evalJs(READY.replace('%LANES%', '6'));
      await evalJs(SETTLE);
      await evalJs("document.getElementById('btnRacePlay').click()");
      let done = null;
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 700));
        done = JSON.parse(await evalJs(`JSON.stringify({ shown: !document.querySelector('.al-result').hidden, ranks: [...document.querySelectorAll('.al-lane-rank')].map(e => e.textContent).filter(Boolean) })`));
        if (done.shown) break;
      }
      check(done && done.shown, 'a six-lane race finishes and shows its ranking',
        () => `after ~28s at turbo the result panel was still hidden (${JSON.stringify(done)}).`);
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

      /* Single mode must be untouched by a race-mode fix: the three helpers were
       * changed for the lanes, and the single canvas is the one they used to write to
       * by accident. */
      await send('Page.navigate', { url: `${BASE}/sorting.html?mode=single&algo=quick&key=id&speed=turbo&seed=424242` });
      await evalJs(`new Promise(r => { const t = setInterval(() => { if (document.querySelector('#singleCanvas') && document.getElementById('singleCanvas').width > 0) { clearInterval(t); r(true); } }, 100); setTimeout(() => { clearInterval(t); r(false); }, 45000); })`);
      await evalJs(SETTLE);
      const single = JSON.parse(await evalJs(`(() => {
        const cv = document.getElementById('singleCanvas');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return JSON.stringify({ ink: n, raceHidden: document.getElementById('raceGrid').hidden, canvasHidden: cv.hidden });
      })()`));
      check(single.ink > 5000 && single.canvasHidden === false && single.raceHidden === true,
        'single mode still paints its own canvas, and only its own',
        () => `single canvas ink=${single.ink}, hidden=${single.canvasHidden}, race grid hidden=${single.raceHidden}. The race lanes drawing into this canvas was the bug; the reverse — single mode painting into a lane — would be the mirror image.`);

      check(noise.length === 0, 'the page produced no console errors or exceptions',
        () => noise.slice(0, 3).join(' | '));

      console.log(`\n  measured: min ink across every configuration was ${minInk.toLocaleString('en-US')} px (a FLOOR, not a bound — sprites are mid-lerp on every frame)`);
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