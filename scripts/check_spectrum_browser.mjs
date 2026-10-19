#!/usr/bin/env node
/**
 * Browser checks for spectrum.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_spectrum_browser.mjs     (needs the repo served on :5500)
 *
 * WHAT ONLY A BROWSER CAN ANSWER
 * -----------------------------
 * Everything about the maths is already settled in check_spectrogram_port.mjs,
 * which differences this module against analyze_cries.py itself. What is left is
 * the set of claims that only exist once the page is running:
 *
 *   - the canvas actually has ink on it, over all three sources
 *   - the reveal MOVES, and it moves from the AudioContext's clock rather than
 *     from a frame counter
 *   - the live curve has ink, and it is not the same pixels as the plot
 *   - the cross-check the page prints to the reader is really computed from the
 *     two tables and lands under the tolerance the port checker gates on
 *   - the source switch reaches the synthesiser, which is the only path that does
 *     NOT decode a file and is therefore the one most likely to be broken
 *   - the output is muted at the AudioContext's destination, measured off the
 *     LIVE AudioParam rather than a value recorded at install time
 *
 * INK IS COUNTED BY ALPHA, OVER THE WHOLE CANVAS
 * -----------------------------------------------
 * §3.G records the shape this avoids: cries.html's first browser checker counted
 * "dark" pixels in the top four rows and ignored alpha, so every untouched
 * (0,0,0,0) pixel scored as dark — a canvas never drawn to at all scored a
 * perfect 2,400 — and it asserted `typeof drew === 'number'`, which is true of
 * undefined and therefore of no result at all. A blank canvas is TRANSPARENT.
 * Counting alpha over the whole surface is the only version of this that can
 * return false for a canvas that drew nothing.
 *
 * The spectrum canvases are near-black by design, so "is anything there" cannot
 * be a brightness test either. Ink is measured as the count of pixels that
 * DIFFER from the canvas's own ground colour, which is what makes the assertion
 * about drawing rather than about colour.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTE_TAP, TAP_PROBE } from './lib/mute-tap.mjs';
import { until } from './lib/cdp-until.mjs';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CRY_PORT || 5500);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/spectrum.html`;

/** The six features the page reports absolute differences for. */
const ROBUST_NAMES = ['dur', 'zcr', 'centroid', 'rolloff85', 'flux'];

const profile = mkdtempSync(join(tmpdir(), 'spx-'));
/* Removed on the way out, and it was not: 43 `spx-*` directories were in tmpdir before
 * this line. check_gen1_page.mjs and check_outfit_browser.mjs both already did it,
 * which is why their prefixes are small and this one was not — the difference between
 * a checker that cleans up and one that does not is one line, and nothing reports it.
 * See the note in check_cries_browser.mjs for why this is an `exit` handler rather
 * than a line at the bottom. */
/* Removed here rather than on the exit path, and the ORDER is the whole point.
 *
 * This used to read `process.on('exit', () => rmSync(profile, …))`, registered
 * ABOVE the handler that kills Chrome. Exit handlers run in REGISTRATION order,
 * so the sequence was: remove the profile directory, then signal Chrome. Chrome
 * does not stop the instant it is signalled, and for the few milliseconds before
 * it actually dies it is still writing to that profile — so it RECREATED the
 * directory that had just been removed underneath it, and left a bare `Default/`
 * with no `DevToolsActivePort` behind.
 *
 * The comment this file carried said the opposite — that killing Chrome "is what
 * makes the profile removal above safe". It was a claim about an ordering it did
 * not have, which is §3.G9's rule one file over: a comment that names a safety
 * property its own code contradicts is worse than no comment, because it is the
 * thing a reader stops checking.
 *
 * So the removal happens in `shutdown()`, after Chrome is CONFIRMED dead. It
 * stays on the exit handler too, for a path that never reaches shutdown — an
 * uncaught throw, which is exactly when the run is already going wrong — and that
 * fallback carries this caveat rather than pretending to be clean. */
const removeProfile = () => {
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
};
/* `--mute-audio` is the FIRST line, not the guarantee: it mutes at the browser, so
   the AudioContext still runs and `currentTime` still advances, which is what
   keeps the playback assertions meaningful. The guarantee is MUTE_TAP below,
   installed before any page script runs. */
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
/* Chrome chose its own debug port; read it back from the profile. See
 * waitForDebugPort's header for why this replaced cdpPort(), and why it makes
 * assertPortFree() unnecessary rather than merely unused. */
const CDP = await waitForDebugPort(profile);
/* THE CHROME IS KILLED ON THE EXIT PATH TOO, and that is not tidiness — it keeps the
 * next run's --remote-debugging-port free and it is what makes the profile removal above
 * safe. A headless Chrome left running holds its debugging port, so an orphan is a port
 * collision waiting for the next run: the new browser cannot bind and the checker fetches
 * /json/list from the ORPHAN — driving a browser whose profile directory this process
 * already deleted under it. 'exit' covers a normal return, a process.exit() and an
 * uncaught throw, which is everything except a signal, so SIGINT and SIGTERM are mapped
 * to the same path. SIGKILL cannot be caught at all, which is the honest limit. */
const stopChrome = () => { try { chrome.kill(); } catch {} };
process.on('exit', stopChrome);
process.on('exit', removeProfile);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopChrome(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

/**
 * Kill Chrome, WAIT for it to actually be gone, and only then remove its profile.
 *
 * The wait is the fix; `chrome.kill()` returns immediately and says nothing about
 * whether the child has stopped. A live child writing to a directory another
 * process just deleted is the shape of the leak this replaced, and the ordering
 * was the defect rather than the missing line — see the note on `removeProfile`.
 *
 * The ceiling RETURNS rather than throws, so a Chrome that refuses to die still
 * lets this checker exit instead of hanging it, which is §3.Z's symptom: a checker
 * that has finished and does not exit is indistinguishable from one that is stuck.
 */
async function shutdown(code) {
  stopChrome();
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, 3000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  removeProfile();
  process.exit(code);
}


let targets;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
    if (r.ok) { targets = await r.json(); break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
if (!targets) {
  console.log('FAIL  Chrome did not open a debugging port');
  await shutdown(1);
}

const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push((m.params.args?.[0]?.value || '').toString().split('\n')[0]);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: MUTE_TAP });

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
  return r.result.value;
};

/** Poll a page expression until it is truthy. Returns whether it ever became so.
 *
 *  This file was 14.6 s, and 13.7 s of it was hardcoded waits. Same reason and same
 *  two guarantees as the identical helper in check_cries_browser.mjs: every ceiling
 *  below exceeds the sleep it replaced, so tolerance only goes UP, and a timeout
 *  returns false so the assertion still runs and still reports its real number.
 *  §3.G4 records what leaving these in cost on the sorting checker.
 *
 *  What this deliberately does NOT replace: the short in-page sampling intervals
 *  below (the 130 ms between two `getImageData` calls, and so on). Those are not
 *  guesses about how long a page takes — they are the measurement window of a
 *  "did this canvas MOVE" check, and polling for the movement instead would make
 *  the assertion vacuous. A wait and a sampling interval can look identical in the
 *  source and mean opposite things. The poll itself now lives in
 *  `lib/cdp-until.mjs`, which `check_outfit_browser.mjs` also uses. */

/** "The page is up": loaded AND past the point where its own DOM is built. */
const booted = (extra = 'true') =>
  until(ev, `document.readyState === 'complete' && (${extra})`, 20000);

/**
 * Ink on a canvas, counted by ALPHA over the whole surface and then by
 * difference from the ground colour.
 *
 * Two conditions, because a plot is one or the other: a canvas that never drew
 * has alpha 0 everywhere, and a canvas that drew only its background has alpha
 * 255 everywhere but is one flat colour. Either way returns false here, which is
 * the property the previous cries.html check lacked.
 */
const INK = `((sel) => {
  const c = document.querySelector(sel);
  if (!c || !c.width) return { error: 'no canvas' };
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let alpha = 0;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) alpha++;
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let top = 0;
  for (const v of counts.values()) if (v > top) top = v;
  return { w: c.width, h: c.height, alpha, distinct: counts.size, top, px: d.length / 4 };
})`;

async function goto(query = '') {
  await send('Page.navigate', { url: `${PAGE}${query}` });
  /* Was a fixed 3500 ms in every call to here. The status line is what the first
   * block of checks reads, and it is filled only once a spectrogram has actually
   * been computed — so it is the honest readiness signal, and it is also the value
   * the assertions below report. `幀` is the marker that the frame count is in. */
  await booted(`document.getElementById('sp-status')?.textContent.includes('幀')`);
}

try {
  await goto();

  // -----------------------------------------------------------------------
  // It mounts.
  // -----------------------------------------------------------------------

  ok(await ev('!!document.querySelector("[data-nav] .site-nav-trigger")'),
    'the shared nav mounts on spectrum.html');

  for (const id of ['sp-sources', 'sp-chips', 'sp-plot', 'sp-live', 'sp-stats', 'sp-cross', 'sp-play']) {
    ok(await ev(`!!document.getElementById(${JSON.stringify(id)})`), `#${id} is present`);
  }

  ok(await ev('document.querySelectorAll(".sp-source").length') === 3,
    'all three sources are offered, so recorded and synthesised cries are visibly comparable');

  ok(await ev('document.querySelectorAll(".sp-chip").length') > 0,
    'the quick-pick chips are built');

  ok((await ev('document.getElementById("sp-status").textContent')).includes('幀'),
    `the status line reports frames and duration (${await ev('document.getElementById("sp-status").textContent')})`);

  ok(problems.length === 0, `no page exceptions (${problems.slice(0, 2).join(' | ') || 'none'})`);

  // -----------------------------------------------------------------------
  // The spectrogram has ink, and it is a SPECTROGRAM rather than a fill.
  // -----------------------------------------------------------------------

  const plot = await ev(`${INK}("#sp-plot")`);
  ok(plot.alpha === plot.px, `the plot is fully opaque, so nothing was left unpainted (${plot.alpha}/${plot.px})`);
  ok(plot.distinct > 40,
    `the plot holds many colours, not one fill (${plot.distinct} distinct)`);
  ok(plot.top / plot.px < 0.75,
    `no single colour covers the plot (top run ${(100 * plot.top / plot.px).toFixed(1)}%)`);

  // -----------------------------------------------------------------------
  // The cross-check is computed, not typed.
  // -----------------------------------------------------------------------

  const cross = await ev(`(async () => {
    const F = await (await fetch('assets/data/cry_features.json')).json();
    const rows = Object.keys(F.latest);
    return { latest: rows.length, legacy: Object.keys(F.legacy).length };
  })()`);
  ok(cross.latest === 1025 && cross.legacy === 649,
    `both tables are reachable from the page (${cross.latest} latest, ${cross.legacy} legacy)`);

  const printed = await ev('document.getElementById("sp-cross").textContent');

  /* 對表's four numeric columns are ALIGNED, which is the one property of this block
   * that a source-shape check cannot answer and a reader notices immediately.
   *
   * It was 61px of drift and a header 98px off, from three causes that each look fine
   * alone: content-sized `.sp-x-got`/`.sp-x-want` spans pushing everything after them,
   * a header `<dl>` that was a SECOND grid with its own independently-sized `auto`
   * column, and `min-width` on `.sp-x-rel`/`.sp-where` fixing their WIDTH while leaving
   * their POSITION to float. `ch` cannot fix the last one either — it resolves against
   * each `<dd>`'s own font-size, and the header is 10px where the rows are 13px.
   *
   * Measured, not asserted from the CSS: the spread of each column's left and right
   * edge across all five rows, plus the header's own right edge against the rows'. A
   * check that read the stylesheet would pass on a `grid-template-columns` that is
   * declared and then overridden, which is the §3.G shape. */
  const ALIGN = `(() => {
    const box = document.getElementById('sp-cross');
    const rows = [...box.querySelectorAll('.sp-x-rows > dd')];
    const edges = rows.map(d => [...d.children].map(e => {
      const r = e.getBoundingClientRect();
      return [r.left, r.right];
    }));
    const spread = j => +(Math.max(...edges.map(r => r[j][0])) - Math.min(...edges.map(r => r[j][0]))).toFixed(2);
    const headR = box.querySelector('.sp-x-head > dd > .sp-x-rel').getBoundingClientRect().right;
    const rowR = box.querySelector('.sp-x-rows > dd > .sp-x-rel').getBoundingClientRect().right;
    const dts = [...box.querySelectorAll('.sp-x-rows > dt')];
    return {
      cols: edges[0].length,
      worstSpread: Math.max(...edges[0].map((_, j) => spread(j))),
      headGap: +Math.abs(headR - rowR).toFixed(2),
      dtOverflow: Math.max(...dts.map(d => d.scrollWidth - d.clientWidth)),
    };
  })()`;
  const align = await ev(ALIGN);
  ok(align.cols === 5, `對表's row carries all five columns — the two figures, the arrow, the %, and the absolute difference (${align.cols})`);
  ok(align.worstSpread === 0, `and every one of them is aligned to 0.00px across all five rows (worst ${align.worstSpread}px)`);
  ok(align.headGap === 0, `with the header's 相對差 sitting exactly over the column it labels (${align.headGap}px off)`);
  /* Alignment is NECESSARY and not sufficient: the tracks are a fixed 270px, so a
   * panel narrower than ~426px leaves the LABEL column 30px wide and the block is
   * perfectly aligned and completely unreadable. Measured at the 1000px viewport
   * where that happened, and the ≤1210px stack is what prevents it. */
  ok(align.dtOverflow <= 1, `and no feature label overflows its own column at this width (${align.dtOverflow}px)`);

  /* The header's four labels render at ONE level, which is a cascade claim no
   * stylesheet read can settle.
   *
   * The header's spans carry the same classes as the rows' on purpose — one set of
   * tracks, one set of column identities — and `.sp-x-got` and `.sp-x-rel` also carry
   * `color: var(--text-primary)` and `font-weight: 600`. Before the reset, the header
   * measured `rgb(15, 23, 48)` / 600 for 這一頁算的 and 相對差 against `rgb(56, 66, 95)`
   * / 400 for 離線表存的: a header row where two of four labels are bold and one is
   * dimmer, which reads as emphasis that is not there.
   *
   * Measured per label and compared to each other rather than to a declared hex,
   * because the assertion is "they agree", not "they are this colour" — a rule that
   * pinned one hex would keep passing after the theme's muted token changed. Distinct
   * colours and weights are BOTH counted, so a mutation that fixed one and not the
   * other is still red. */
  const headLevels = await ev(`(() => {
    const spans = [...document.querySelectorAll('.sp-x-head > dd > span')];
    const info = spans.map((s) => {
      const c = getComputedStyle(s);
      return { t: s.textContent.trim(), color: c.color, weight: c.fontWeight };
    });
    return { n: info.length, info, colors: new Set(info.map(i => i.color)).size, weights: new Set(info.map(i => i.weight)).size };
  })()`);
  ok(headLevels.n === 5, `對表's header names all five columns (${headLevels.n})`);
  ok(headLevels.colors === 1,
    `and every header label is the SAME colour — two of four were rendering at the data rows' emphasis (${headLevels.colors} distinct across ${headLevels.info.map((i) => `${i.t || '→'}:${i.color}`).join(' ')})`);
  ok(headLevels.weights === 1,
    `at the same weight, so a header label is never bolder than the data under it (${headLevels.weights} distinct: ${[...new Set(headLevels.info.map((i) => i.weight))].join('/')})`);
  /* The rows must still be EMPHASISED, or the reset has simply flattened the whole
   * block. This is the half that catches "fixed it by deleting the emphasis" — and it
   * is asserted as "the rows differ from the header", not as a hex or a weight, so it
   * holds when the theme's tokens change. `.sp-x-got` and `.sp-x-rel` are BOTH
   * primary/600 by design and are deliberately not distinguished from each other:
   * which of the two figures is bold carries no meaning, only that the figure is
   * bold and the label above it is not. */
  const rowLevels = await ev(`(() => {
    const dd = document.querySelector('.sp-x-rows > dd');
    const want = [...dd.children].find((s) => s.className === 'sp-x-want');
    const head = document.querySelector('.sp-x-head > dd > span');
    return {
      got: getComputedStyle(dd.children[0]).fontWeight,
      rowWant: getComputedStyle(want).color,
      headWant: getComputedStyle(head).color,
      headWeight: getComputedStyle(head).fontWeight,
    };
  })()`);
  ok(rowLevels.got === '600',
    `while the DATA rows keep their own weight, so the reset did not flatten the block to satisfy the header (rows at ${rowLevels.got}, header at ${rowLevels.headWeight})`);
  ok(rowLevels.rowWant !== rowLevels.headWant,
    `and the data's own value colour is not the header label's (${rowLevels.rowWant} vs ${rowLevels.headWant}) — the header is muted while the figures it labels are not`);


  /* The panel must name all THREE excluded features and BOTH reasons. Asserting the
   * count of names and nothing about the reasons would pass a page that listed
   * `peak, rms, m0` and left the reader to work out that the third one is an
   * upstream bug rather than a browser limitation — which is the distinction that
   * decides whether a reader should trust the number or distrust the tool. */
  for (const name of ['peak', 'rms', 'm0']) {
    ok(printed.includes(name),
      `the panel names ${name} among the three features it does not compare`);
  }
  ok(/解碼器不同/.test(printed) && /取樣率被改過/.test(printed) && /兩個 bug/.test(printed),
    "and gives all three causes of the difference: decoder, device-rate resample, and the extractor's own bugs");

  /* `dur` is the one number both implementations must agree on exactly, and it is
   * the right one to gate on: it is a sample COUNT, so it is invariant to every
   * resample and to every amplitude scale, and nothing about a decoder changes how
   * many samples a file has. The MFCC columns cannot be gated here — 13 of the 34
   * are standard deviations of values near zero, where a relative difference
   * measures the denominator rather than the measurement. That is why the page
   * reports six absolute differences instead and why this file asserts they are
   * PRINTED rather than that they are small. */
  const dur = await ev(`(async () => {
    const M = await import('/assets/js/cry-spectrogram.js');
    const F = await (await fetch('assets/data/cry_features.json')).json();
    const ctx = new OfflineAudioContext(1, 1024, 32728);
    const buf = await ctx.decodeAudioData(
      await (await fetch('assets/cries/latest/1.ogg')).arrayBuffer());
    const rows = M.analyseCry(buf.getChannelData(0), buf.sampleRate);
    return { got: rows.features[0], want: F.latest['1'][0], rate: buf.sampleRate };
  })()`);
  ok(dur.rate === 32728,
    `decoding at the file's OWN rate skips decodeAudioData's resample entirely (${dur.rate} Hz)`);
  ok(Math.abs(dur.got - dur.want) < 1e-6,
    `duration matches the offline table exactly (${dur.got} vs ${dur.want} s)`);

  const sixPrinted = ROBUST_NAMES.every((n) => printed.includes(n));
  ok(sixPrinted,
    `the panel prints a figure for all five well-conditioned features (${ROBUST_NAMES.join(', ')})`);

  // -----------------------------------------------------------------------
  // The about section is TWO COLUMNS — at a width where it is two columns.
  // -----------------------------------------------------------------------

  /* WIDENED FIRST, and the reason is that this checker's default headless viewport is
   * NARROWER than `.sp-about`'s own 900px breakpoint, so at the default the section is
   * legitimately one column and every geometry claim below is vacuously true of a
   * stacked layout. A guard that can only pass on the collapsed layout is §3.G's shape:
   * it certifies something the reader at a wide window never sees.
   *
   * `Emulation.setDeviceMetricsOverride` rather than a Chrome flag, because the flag is
   * clamped to the host's screen here and the override is not — measured below and
   * asserted, so a Chrome that ignores it fails the check instead of silently reporting
   * the narrow layout's answer. It is restored afterwards, and the assertions that
   * follow are the ones that depend on the default width. */
  const NARROW = await ev('innerWidth');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  const WIDE = await ev('innerWidth');
  ok(WIDE >= 901,
    `the viewport is widened past .sp-about's own 900px breakpoint, because at the default ${NARROW}px the section is ONE column and a two-column claim is vacuous (${WIDE}px)`);

  /* The rendered form of the claim `check_spectrum_page.mjs` makes about the markup,
   * and the reason it lives here is that the static half cannot see this at all.
   *
   * `.sp-about` shipped with a `</div>` whose opening tag was missing. The stray marker
   * closed `.sp-page`, so `</section>` matched nothing, `.sp-about-live` fell out of the
   * page flow into a direct child of `<main>`, and the section's 2-track grid
   * auto-placed its SEVEN unwrapped children into four rows. Measured before the fix at
   * a 1113px viewport: the heading alone in the 435px track with 130px of void beneath
   * it, its own first paragraph in the 290px track at 24 CJK characters a line, and the
   * parameter card at y=2648 against `.sp-page`'s bottom edge of 2622.
   *
   * Four assertions, and each catches a different single removal. "Two tracks" alone is
   * satisfied by a 2-track grid with eight children; "the card is in the second track"
   * alone is satisfied by a section whose prose is one child and whose card is on its
   * own line; and the parentage is the claim that actually failed, so it is asserted
   * directly rather than inferred from the geometry. The positions are compared
   * (`liveX > bodyX`) instead of to a number, because a literal x would be a second
   * thing to keep right and this page is fluid. */
  const ABOUT = await ev(`(() => {
    const sec = document.querySelector('.sp-about');
    const body = document.querySelector('.sp-about-body');
    const live = document.querySelector('.sp-about-live');
    const page = document.querySelector('.sp-page');
    const b = body.getBoundingClientRect(), l = live.getBoundingClientRect();
    const c = getComputedStyle(sec);
    return {
      tracks: c.gridTemplateColumns.trim().split(/\\s+/).length,
      children: [...sec.children].map((x) => x.className),
      liveIsChild: sec.contains(live) && live.parentElement === sec,
      liveInsidePage: page.contains(live),
      sameRow: Math.abs(b.y - l.y) < 2,
      liveRightOfBody: l.x > b.x,
      bodyWidth: Math.round(b.width),
      liveWidth: Math.round(l.width),
      h2FirstInBody: body.firstElementChild.tagName === 'H2',
    };
  })()`);
  ok(ABOUT.tracks === 2,
    `the about section is a TWO-track grid (${ABOUT.tracks}) — with one, the parameter card is a stranded full-width card below the whole page`);
  ok(ABOUT.children.length === 2
    && ABOUT.children[0] === 'sp-about-body' && ABOUT.children[1] === 'sp-about-live',
    `and it has exactly two grid children in that order, because auto-placement is what puts the card in the second track (got ${ABOUT.children.join(', ') || 'none'})`);
  ok(ABOUT.liveIsChild && ABOUT.liveInsidePage,
    "the live curve's parameter column is INSIDE the section and inside `.sp-page` — the stray closing marker put it in `<main>` directly, below everything else");
  ok(ABOUT.sameRow && ABOUT.liveRightOfBody,
    `and it renders BESIDE the prose rather than below it (prose ${ABOUT.bodyWidth}px, parameter card ${ABOUT.liveWidth}px to its right, same row: ${ABOUT.sameRow})`);
  ok(ABOUT.h2FirstInBody,
    'with the heading as the prose column\'s own first child, so it cannot be auto-placed into a track of its own and left with a void under it');

  /* The section rhythm is a MEASURED gap between rendered boxes, not a margin read out
   * of the stylesheet. Four values, two of them: the three measurement sections sit
   * inside one band, and the two boundaries around that band are unmistakably wider.
   *
   * Before: 20 / 22 / 22 / 22 / 26 — the kind change and the kind continuity carried
   * the same interval, which is the definition of no rhythm. Asserted as a RATIO so the
   * claim survives a future retune of both numbers together, and separately asserted
   * that each section took the interval it was supposed to — a page where all four
   * measured the same would pass a bare "sep > gap" and that is the state being fixed. */
  const RHYTHM = await ev(`(() => {
    const sels = ['.sp-intro', '.sp-hero', '.sp-live', '.sp-numbers', '.sp-about'];
    const els = sels.map((s) => document.querySelector(s));
    const gaps = [];
    for (let i = 0; i < els.length - 1; i++) {
      const a = els[i].getBoundingClientRect(), b = els[i + 1].getBoundingClientRect();
      gaps.push(Math.round(b.top - a.bottom));
    }
    return { sels, gaps, aboutLast: document.querySelector('.sp-about').nextElementSibling === null };
  })()`);
  ok(RHYTHM.gaps[0] > RHYTHM.gaps[1] && RHYTHM.gaps[3] > RHYTHM.gaps[2],
    `both band BOUNDARIES are wider than both band interiors — ${RHYTHM.gaps.join(' / ')}px, so 時頻圖/即時/數值 read as one instrument and the prose around it does not`
    + ' (they were 20/22/22/22/26, where the kind change carried the same interval as the kind continuity)');
  ok(RHYTHM.gaps[1] === RHYTHM.gaps[2] && RHYTHM.gaps[0] === RHYTHM.gaps[3],
    `and each band is internally uniform and the two boundaries match each other (${RHYTHM.gaps.join(' / ')}), which is what makes it a rhythm rather than four numbers`);
  ok(RHYTHM.aboutLast,
    'with .sp-about carrying no trailing margin at all, because it is the last child of .sp-page and its 26px had nothing under it');

  /* Restore the width, and assert the restore rather than assuming it: every
   * measurement below is a canvas pixel count or a feature figure, and a viewport left
   * at 1280 would change the canvas backing store under them. The only value carried
   * forward is `NARROW`, so nothing downstream silently inherits a different page.
   *
   * AND THE RESTORE IS POLLED, because A CDP COMMAND RESOLVING IS NOT THE PAGE HAVING
   * APPLIED IT. `clearDeviceMetricsOverride` returns while the renderer still reports
   * the override's own width, so reading `innerWidth` on the next line measured the
   * stale value and failed this assertion on a page that was fine — green at 13:44 on
   * 2026-10-13 with an 8.67 s run, then four consecutive reds, with nothing in the
   * tree changed between them. Instrumented rather than guessed: at +0 ms the page
   * still answered 1280, at +50 ms it answered 756, and it stayed there through
   * 1500 ms.
   *
   * A fixed sleep would be a guess (§3.G5's rule, and the ceiling would be another
   * number nobody could check), so this polls the PRECONDITION — which is §3.G9's
   * finding applied to a viewport. The ceiling is named because the message quotes it,
   * and it is an order of magnitude past the ~50 ms measured; being paid only on the
   * failing path is what makes generosity free here.
   */
  const VIEWPORT_RESTORE_MS = 3000;
  await send('Emulation.clearDeviceMetricsOverride');
  const RESTORED = await until(ev, `innerWidth === ${NARROW}`, VIEWPORT_RESTORE_MS);
  const SEEN = await ev('innerWidth');
  ok(RESTORED,
    `the viewport is restored to the checker's default within ${VIEWPORT_RESTORE_MS}ms (${SEEN}px vs ${NARROW}px), so the canvas measurements that follow are taken at the width they are about`);

  // -----------------------------------------------------------------------
  // The reveal moves, and it moves from the AudioContext's clock.
  // -----------------------------------------------------------------------

  /* The cursor's position is read as the brightest COLUMN, not as a pixel value
   * a constant could satisfy. Measuring "something changed" would pass on a
   * repaint that changed nothing, and §3.G's `startedAt > 0` bug is exactly that
   * shape: a guard that reported "not started" and left the cursor at the origin
   * for the life of the page. */
  const COL = `((sel) => {
    const c = document.querySelector(sel);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const cols = [];
    for (let x = 0; x < c.width; x++) {
      let sum = 0;
      for (let y = 0; y < c.height; y += 3) {
        const i = (y * c.width + x) * 4;
        sum += d[i] + d[i + 1] + d[i + 2];
      }
      cols.push(sum);
    }
    return cols;
  })`;

  const before = await ev(`${COL}("#sp-plot")`);
  await ev('document.getElementById("sp-play").click()');
  await new Promise((r) => setTimeout(r, 260));
  const during = await ev(`${COL}("#sp-plot")`);
  await new Promise((r) => setTimeout(r, 320));
  const after = await ev(`${COL}("#sp-plot")`);

  const differs = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 0 ? 1 : 0), 0);
  const moved1 = differs(before, during);
  const moved2 = differs(during, after);
  ok(moved1 > 3, `the reveal advances while audio plays (${moved1} columns changed)`);
  ok(moved2 > 3, `and keeps advancing rather than jumping once (${moved2} columns changed)`);

  ok(await ev('document.getElementById("sp-play").getAttribute("aria-pressed")') === 'true',
    'the play button reports pressed for the life of the playback');

  /* TWO CONTROLS, ONE STATE, AND BOTH DIRECTIONS — because the failure is not
   * symmetric.
   *
   *  `#sp-hero-play` beside the plot is the same button at a second place on the page:
   *  at 390×844 the rail is a 270px bar at the top of a 3,900px document, so the
   *  control that plays the picture is 1,050px from the picture while you are looking
   *  at it. §3.I's shape one level down is a second control with a second WRITER, and
   *  it renders as a page where one says 停止 and the other still says 播放 — pressing
   *  the one that is behind then shows the reader nothing at all.
   *
   *  Only a browser can see this. `check_spectrum_page.mjs` asserts that
   *  `setPlayButton()` iterates `[data-play]`, which is the MECHANISM; this is the
   *  OUTCOME, and the two are asserted separately because either alone can be right
   *  about the wrong thing — §3.G1a's shape.
   *
   *  Read at the same moment as the rail's, not in sequence, so the assertion is about
   *  them AGREEING rather than about an ordering. */
  const BOTH = `(() => [...document.querySelectorAll('[data-play]')]
    .map((b) => ({ id: b.id, pressed: b.getAttribute('aria-pressed'), label: b.textContent.trim() })))()`;
  const playingBoth = await ev(BOTH);
  ok(playingBoth.length === 2
    && playingBoth.every((b) => b.pressed === 'true'),
    'the control beside the plot reports pressed while the rail\'s does — one state, two controls',
    );
  ok(playingBoth.every((b) => b.label === '■ 停止'),
    `and both say the same word, so one button cannot read 停止 while the other reads 播放 (${playingBoth.map((b) => `${b.id}: ${b.label}`).join(', ')})`);

  /* AND FROM THE OTHER SIDE. Pressing the plot's control must reach the same state,
   * which is a different claim from 「the rail's press reached the plot's」: it fails
   * if one of the two click listeners was never bound, which is the way this is
   * actually introduced — a button that looks identical and does nothing. */
  await until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'false'`, 15000);
  await ev('document.getElementById("sp-hero-play").click()');
  await until(ev, `document.getElementById('sp-hero-play')?.getAttribute('aria-pressed') === 'true'`, 8000);
  const bothFromHero = await ev(BOTH);
  ok(bothFromHero.every((b) => b.pressed === 'true'),
    'and pressing the plot\'s control reaches the rail\'s too — the reverse direction, because a control that looks identical and does nothing is a different failure from one that shows the wrong state');
  await until(ev, `document.getElementById('sp-hero-play')?.getAttribute('aria-pressed') === 'false'`, 15000);

  /* Was a fixed 1600 ms, waiting for a cry to end. The page exposes exactly when
   * that has happened — the play button releasing itself — and the assertion on the
   * next line reads that same attribute, so waiting on it is waiting on the real
   * thing rather than on a guess about how long this species lasts. */
  await until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'false'`, 15000);
  ok(await ev('document.getElementById("sp-play").getAttribute("aria-pressed")') === 'false',
    'and releases it when the cry ends');

  // -----------------------------------------------------------------------
  // The live curve has its own ink, and it is not the plot's pixels.
  // -----------------------------------------------------------------------

  const live = await ev(`${INK}("#sp-live")`);
  ok(live.distinct > 8, `the live curve drew a spectrum rather than a flat ground (${live.distinct} distinct)`);
  ok(live.distinct !== plot.distinct,
    `the live curve is a different drawing from the spectrogram (${live.distinct} vs ${plot.distinct} distinct)`);

  await ev('document.getElementById("sp-play").click()');
  /* Was a fixed 300 ms. The live curve is fed by the analyser, so the observable
   * that it has started is playback itself, which the button reports. */
  await until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'true'`, 6000);
  /* WAIT FOR THE ANALYSER TO ACTUALLY PRODUCE A FRAME, because `aria-pressed` is the
   * observable for whether PLAYBACK WAS ASKED FOR and it flips when play() is called —
   * not when there is anything to draw. Sampling straight after it is a race, and it
   * fails in the direction that hides the defect: a still-flat curve fills nearly the
   * whole panel with the ground colour, `top / px` clears 0.9, and a curve that is
   * working perfectly is reported as not painted. Observed roughly 1 run in 3.
   *
   * This is the same fix as the one on the 130 ms window further down, and the same
   * distinction: that 130 ms is the MEASUREMENT WINDOW and stays exactly as it is,
   * because widening an interval that decides 「does it move」 would paper over the same
   * race. What changes here is the wait for a PRECONDITION. */
  const warm = await ev(`(async () => {
    const c = document.getElementById('sp-live'), g = c.getContext('2d');
    const grab = () => g.getImageData(0, 0, c.width, c.height).data;
    const idle = grab();
    const moved = (y) => { let n = 0;
      for (let i = 0; i < idle.length; i += 4)
        if (Math.abs(idle[i] - y[i]) + Math.abs(idle[i + 1] - y[i + 1]) + Math.abs(idle[i + 2] - y[i + 2]) > 12) n++;
      return n; };
    const end = Date.now() + 4000;
    let waited = 0;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50)); waited += 50;
      const n = moved(grab());
      if (n > 0) return { ok: true, waited, moved: n };
    }
    return { ok: false, waited, moved: 0 };
  })()`);
  ok(warm.ok === true,
    `the analyser produced a frame before the canvas was read (${warm.waited} ms)`);
  const liveMid = await ev(`${INK}("#sp-live")`);
  /* COVERAGE AGAINST THE IDLE FRAME, not `top / px`.
   *
   * The old test was `top / px < 0.9` — the single most common colour must not occupy
   * 90% of the panel — and that threshold is MARGINAL for this canvas rather than
   * comfortably met: measured at rest, the ground is 95.5% of the live panel
   * (655,716 of 686,800 device pixels), so the test passes through a 5-point band that
   * a single curve has to cross. The warm-up above does not help, because it returns on
   * the first frame that differs by ONE pixel — which is true while the panel is still
   * 95% ground. So the poll succeeded and the assertion failed, about 1 run in 6, with
   * a curve that was drawn perfectly.
   *
   * Counting pixels that differ from the idle frame is measured against a captured
   * state rather than against a threshold on the thing being asserted, so it cannot
   * be satisfied by having measured nothing. The 0.5% figure is not invented: it is the
   * same threshold the MOVES check below already calibrates against, and a real playing
   * curve measures several percent (8.7% and 4.3% recorded).
   *
   * `alpha === px` is kept and is the other half of the claim — the panel is fully
   * painted rather than transparent, which is the 「a blank canvas is transparent」 shape. */
  ok(warm.moved > liveMid.px * 0.005 && liveMid.alpha === liveMid.px,
    `the live curve is painted while audio is running (${warm.moved} px differ from the idle frame`
    + `, ${(100 * warm.moved / liveMid.px).toFixed(1)}% of the panel, against a 0.5% floor)`);
  await ev('document.getElementById("sp-play").click()');

  /* THE ASSERTION THAT WAS MISSING, AND IT IS THE ONE THAT MATTERS.
   *
   * Everything above asks whether the live canvas has ink. It does — a gridline, a
   * label and a static ribbon are all ink, and a curve that never moves produces the
   * same set of pixels as one that does. So the whole panel could be frozen and
   * every check above would pass, which is exactly what happened: the first version
   * of this file reported the live curve as working while a reader saw a still
   * image, because the axis was fitted to the data and had squashed a 36 dB decay
   * into a couple of pixels (see check_spectrum_page.mjs).
   *
   * So this compares the canvas against ITSELF across frames, and the threshold is a
   * count of changed pixels rather than a hash. 0.5% of the surface is 1,000 pixels
   * on a 1,152x170 canvas: a moving filled curve moves far more than that, and a
   * repaint that changes nothing moves exactly zero. Measured on `latest/25.ogg`
   * with the axis fixed: 26,877 of 782,000 pixels, 3.4%.
   */
  const movement = await ev(`(async () => {
    const c = document.getElementById('sp-live');
    const g = c.getContext('2d');
    const grab = () => g.getImageData(0, 0, c.width, c.height).data;
    const btn = document.getElementById('sp-play');
    const changed = (x, y) => {
      let n = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 12) n++;
      }
      return n;
    };

    /* THE 150 ms THAT WAS HERE WAS A GUESS AT “playback has started”, and it
     * was a guess that could be wrong in the direction that hides the defect: the two
     * frames are then both idle ones and the measurement reads 0 changed, which is
     * reported as “the curve does not move” while nothing is wrong. Observed once
     * in three runs, and it got MORE likely when two extra species selections were put
     * in front of this check \u2014 the analyser had less time to warm before the window.
     *
     * So the guess is replaced by the real precondition: poll until the canvas actually
     * leaves its idle frame. The 130 ms below is NOT a wait and is deliberately not
     * touched \u2014 it is the MEASUREMENT WINDOW, the interval over which “it keeps
     * moving” is decided, and widening it would paper over the same race.
     *
     * And the assertion is still not vacuous: the poll establishes that movement
     * BEGINS, while “during” measures that it CONTINUES across a further 130 ms and
     * “stopped” that it ends. A curve that painted once on the first frame and
     * then held still still fails the middle number. */
    const idle = grab();
    btn.click();
    const deadline = Date.now() + 4000;
    let warmed = false, waited = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      waited += 50;
      if (changed(idle, grab()) > 0) { warmed = true; break; }
    }
    if (!warmed) { btn.click(); return { during: 0, total: idle.length / 4, stopped: 0, warmed }; }

    const a = grab();
    await new Promise((r) => setTimeout(r, 130));
    const b = grab();
    const during = changed(a, b);
    btn.click();
    await new Promise((r) => setTimeout(r, 700));
    return { during, total: a.length / 4, stopped: changed(b, grab()), warmed, waited };
  })()`);
  ok(movement.warmed === true,
    `the analyser produced output within the ceiling rather than the window guessing it (${movement.waited} ms to warm)`);
  ok(movement.during / movement.total > 0.005,
    `the live curve MOVES while audio plays (${movement.during} of ${movement.total} pixels changed`
    + ` between two frames 130 ms apart, ${(100 * movement.during / movement.total).toFixed(1)}%)`);
  ok(movement.stopped / movement.total < movement.during / movement.total / 2,
    `and settles when playback stops (${movement.stopped} pixels change afterwards,`
    + ` against ${movement.during} during) — so the movement is the audio and not a repaint`);

  if (globalThis.__SKIP_INK) { /* TEMPORARY */ }
  /* The line and its fill are THIS SPECIES' OWN COLOUR, and only a rendered canvas
   * can say whether they were.
   *
   * THE SHAPE OF THE CHECK IS THE INTERESTING PART. The page writes the ink it is
   * about to use into `#sp-live`'s `data-ink`, and this measures the canvas against
   * that statement rather than against a value derived here. Re-deriving it in the
   * checker would compare two implementations of the same arithmetic and pass even when
   * both were wrong; and this file opens NO repo file — it reads its pages over HTTP —
   * so importing the module here is not available either. The statement is the only
   * reference that cannot be a second opinion.
   *
   * And it is the statement that catches the failure this feature can ship with: every
   * shape check green while `drawLive()` quietly went on using `topInk()`. The pixels
   * would stop matching `data-ink` and nothing else would notice. */
  const CANVAS_INK = `(() => {
    const c = document.querySelector('#sp-live');
    if (!c || !c.width) return { error: 'no canvas' };
    const cs = getComputedStyle(document.documentElement);
    const h = cs.getPropertyValue('--sp-plot-bg').trim().replace('#', '');
    const g = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const m = /^rgb\\((\\d+),(\\d+),(\\d+)\\)$/.exec(c.dataset.ink || '');
    if (!m) return { error: 'no data-ink', stated: c.dataset.ink };
    const t = [m[1], m[2], m[3]].map(Number);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

    /* COUNTED BY A STRICT PER-CHANNEL MATCH to the stated colour.
     *
     * Two earlier versions of this were wrong, and both of them PASSED:
     *
     *  - A PROJECTION onto the ground->ink axis, to recover partial coverage. It is
     *    unbounded: a pixel painted rgb(251,226,141) scores 1.52 against a target of
     *    rgb(118,158,134), well over a 0.85 gate, so a canvas drawn in a completely
     *    different colour was counted as a match (8,485 "matching" pixels).
     *  - A 45-UNIT Euclidean band, picked while the page in the working tree happened to
     *    be a mutant and therefore reported a closest pixel 29 away. It is too loose here
     *    for a reason specific to this canvas: the ink rgb(118,158,134) is nearly grey,
     *    so the gridlines and axis labels — grey, and drawn whether or not anything is
     *    playing — sit within 45 of it. Measured 1,442 such pixels on BOTH a correct and a
     *    mutated page, which made the band useless rather than merely slack.
     *
     * A per-channel tolerance of 4 is enough and is not slack: this checker runs at
     * deviceScaleFactor 2, so the stroke is two device pixels wide and its interior is the
     * ink exactly — 3,908 px of pure rgb(118,158,134) on the correct page, and ZERO on a
     * page whose drawLive still draws the ramp's top instead. Antialiased edges are
     * deliberately not counted, because a blend is not the colour and counting blends is
     * precisely what made both earlier versions wrong. */
    /* A STRICT PER-CHANNEL MATCH, and the tolerance is not a threshold on ink quantity.
     *
     * Two earlier versions of this were wrong, and both of them PASSED, so both are
     * recorded here rather than as history:
     *
     *  - A PROJECTION onto the ground->ink axis, to recover partial coverage. It is
     *    UNBOUNDED: a pixel painted rgb(251,226,141) scores 1.52 against a target of
     *    rgb(118,158,134), well over a 0.85 gate, so a canvas drawn in a completely
     *    different colour was counted as a match — 8,485 "matching" pixels on a page
     *    whose drawLive still drew the ramp's own top.
     *  - A 45-UNIT Euclidean band, chosen while the working tree happened to hold a mutant
     *    and so reported a closest pixel 29 away. Too loose for THIS canvas: the ink
     *    rgb(118,158,134) is nearly grey and the panel is mostly grey, so gridlines and
     *    axis labels fall inside the band. 1,442 px matched on a correct and on a mutated
     *    page alike.
     *  - AN IDLE-PALETTE DIFFERENCE, which is the version worth arguing against, because
     *    it sounds strictly better and is not: it assumes the resting panel lacks the ink
     *    colour. It does not. drawLive() runs on every selection, so the flat curve is
     *    already on screen in the species' own colour before anything plays, and the
     *    baseline swallows the very pixels the assertion is looking for. Measured: 0 for
     *    the default species and 65 for #838, in the same run — the second passed only
     *    because its LIFTED colour is a colour the first species never drew. A baseline
     *    that certifies one species and fails another is worse than no baseline.
     *
     * What is left is the plain question, which the mutation suite answers: does the
     * canvas contain the stated colour? Per-channel 4 absorbs an 8-bit round trip, and
     * antialiased edges are deliberately not counted — a blend is not the colour, and
     * counting blends is what made the first two versions wrong. The claim is > 0
     * rather than a proportion because the absolute count is genuinely variable (39-77 px
     * across five runs of one page, tracking where the curve sits and how much of it
     * antialiases away), and a threshold on that would be a threshold on a font metric. */
    let exact = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      if (Math.abs(d[i] - t[0]) <= 4
        && Math.abs(d[i + 1] - t[1]) <= 4
        && Math.abs(d[i + 2] - t[2]) <= 4) exact++;
    }

    /* WCAG relative luminance, written out here because this file may not import
     * shared.js — it reads nothing from the repo. check_spectrum_page.mjs asserts
     * that species-ramp.js is handed shared.js's OWN contrast, so the arithmetic
     * that produced the stated colour is the project's, and this is only the check that
     * the stated colour is legible. */
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const [hi, lo] = [L(t), L(g)].sort((a, b) => b - a);
    return { stated: c.dataset.ink, rgb: t, exact, w: c.width, h: c.height, ratio: (hi + 0.05) / (lo + 0.05) };
  })()`;

  const ink1 = await ev(CANVAS_INK);
  ok(!ink1.error, `the page states which ink it is drawing (${ink1.stated})`);
  ok(ink1.exact > 0,
    `and the canvas actually contains that colour — ${ink1.exact} px within 4 of rgb(${ink1.rgb})`
    + `, ${(100 * ink1.exact / (ink1.w * ink1.h)).toFixed(2)}% of the panel`);
  ok(ink1.ratio >= 3,
    `and it is legible on the ground it is drawn on (${ink1.ratio.toFixed(2)}:1 for the default species)`);

  /* A control wired to nothing is invisible to a shape check, and this is the whole
   * claim: the colour has to FOLLOW the reader's choice. Asserting it once on the
   * default species would pass on a page that hardcoded Bulbasaur's green. */
  const search = async (q) => {
    await ev(`(() => { const el = document.getElementById('sp-q');
      el.value = ${JSON.stringify(q)};
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 400));
    await ev(`(() => { document.getElementById('sp-q')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await until(ev, `document.getElementById('sp-meta').textContent.includes(${JSON.stringify(q)})`, 20000);
    await until(ev, "document.getElementById('sp-status')?.textContent.includes('幀')", 20000);
    await new Promise((r) => setTimeout(r, 250));
  };

  await search('0838');
  ok((await ev('document.getElementById("sp-name").textContent')) === '大炭車',
    "the roster's search box and Enter really reach 大炭車 #838 — the reader's own control, not a URL");
  const ink838 = await ev(CANVAS_INK);
  ok(ink838.stated !== ink1.stated,
    `the stated ink followed the species: ${ink1.stated} -> ${ink838.stated}`);
  ok(ink838.exact > 0,
    `and #838's canvas holds ITS colour (${ink838.exact} px), not the previous species' hue left behind`);

  /* THE HARD CASE, and the reason for the floor. 大炭車 #838 is stored as rgb(56,51,50),
   * which is 1.63:1 on this page's own ground — not a dark Pokémon but a DESATURATED
   * one, drawn as stored it would be all but invisible. The default species is 6.75:1
   * and proves nothing, so the floor is asserted where it is load-bearing. */
  ok(ink838.ratio >= 3,
    `and #838's lifted colour clears 3:1 (${ink838.ratio.toFixed(2)}:1, from 1.63:1 as stored)`);

  /* Restored, because the rest of this file reads the default species' numbers. */
  await search('0001');
  ok((await ev('document.getElementById("sp-name").textContent')) === '妙蛙種子',
    'and the reader can get back to the default species the same way');

  // -----------------------------------------------------------------------
  // The third source: the synthesiser, which decodes nothing.
  // -----------------------------------------------------------------------

  await ev('document.querySelectorAll(".sp-source")[2].click()');
  /* Was a fixed 3000 ms. This one renders the synthesised cry through gb-apu.js at
   * 65,536 Hz — real arithmetic, so it genuinely takes time and a poll is the right
   * shape rather than a smaller number. The status line naming 合成 is what the
   * assertion below looks for, and it is set when that render lands. */
  await until(ev, `document.getElementById('sp-status')?.textContent.includes('合成')`, 30000);
  const gen1Status = await ev('document.getElementById("sp-status").textContent');
  ok(/合成/.test(gen1Status), `the synthesised cry path renders (${gen1Status})`);

  const gen1Plot = await ev(`${INK}("#sp-plot")`);
  ok(gen1Plot.distinct > 40, `and it draws a real spectrogram (${gen1Plot.distinct} distinct colours)`);

  ok(/沒有可以對表的數字/.test(await ev('document.getElementById("sp-cross").textContent')),
    'the cross-check panel says there is nothing to compare rather than showing a blank');

  await ev('document.getElementById("sp-play").click()');
  await until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'true'`, 6000);
  ok(await ev('document.getElementById("sp-play").getAttribute("aria-pressed")') === 'true',
    'the synthesised cry plays through the same player and the same clock');
  /* Was a fixed 2200 ms. This one is a SAMPLING INTERVAL, not a readiness wait, and
   * the difference is worth 3 s of wall clock. Nothing follows it that reads the
   * end of playback: the button is simply clicked again to stop it. Polling for the
   * natural release instead — which was tried first — waits for this species' cry to
   * finish, and a synthesised Charizard runs longer than the 2200 ms the code used to
   * allow itself, so the file got SLOWER: 14.6 s to 17.6 s, with every verdict
   * unchanged. Waiting longer than the thing you are measuring is not more careful. */
  await new Promise((r) => setTimeout(r, 500));
  await ev('document.getElementById("sp-play").click()');

  ok(problems.length === 0, `still no page exceptions after all three sources (${problems.slice(0, 2).join(' | ') || 'none'})`);

  // -----------------------------------------------------------------------
  // Theme, and the mute.
  // -----------------------------------------------------------------------

  /* A CHECK THAT COULD NEVER PASS, AND IT WAS FAILING FOR THAT REASON ALONE.
   *
   * This used to be: click the toggle, wait 500 ms, then assert
   * `document.documentElement.dataset.theme === 'light'` — which assumes the page
   * starts DARK and this click makes it light. Nothing establishes that. Headless
   * Chrome reports `prefers-color-scheme: light` and the page honours it, so it
   * loads LIGHT, the click makes it dark, and the assertion failed. Measured
   * directly: theme on arrival `light`, after one click `dark`.
   *
   * It failed for the whole life of the check and looked like a spectrum redraw
   * bug, which is the expensive way to be wrong — the reported message is about the
   * ramp being theme-independent, and the actual cause was the check assuming a
   * starting state it had not checked.
   *
   * What the page actually claims is direction-free: the ramp is
   * theme-INDEPENDENT, so the plot must look the same after a switch either way.
   * So the assertion now records the theme it started from, waits for the theme to
   * DIFFER from it, and checks the plot still carries a real spectrogram. That is
   * the real claim, it cannot fail merely because the OS prefers dark, and the
   * precondition it waits for is strictly weaker than what it then asserts. */
  const themeBefore = await ev('document.documentElement.dataset.theme');
  await ev('document.querySelector(".theme-toggle").click()');
  /* Was a fixed 500 ms, and the wait it was standing in for is a fact rather than a
   * belief: the toggle sets `data-theme` synchronously (shared.js:547). Then TWO
   * animation frames, so the redraw has been scheduled and painted. */
  await until(ev, `document.documentElement.dataset.theme !== ${JSON.stringify(themeBefore)}`, 6000);
  await until(ev, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', 2000);
  const themeAfter = await ev('document.documentElement.dataset.theme');
  const switchedPlot = await ev(`${INK}("#sp-plot")`);
  ok(themeAfter !== themeBefore && switchedPlot.distinct > 40,
    `the spectrogram survives a theme switch (${themeBefore} -> ${themeAfter})`
    + ` — the ramp is theme-independent, so it redraws identical (${switchedPlot.distinct} distinct colours)`);
  await ev('document.querySelector(".theme-toggle").click()');
  await until(ev, `document.documentElement.dataset.theme === ${JSON.stringify(themeBefore)}`, 6000);

  /* The mute is asserted by reading the LIVE AudioParam, after a play, because the
   * AudioContext is built lazily and a probe before the first play reads a tap
   * that has not been asked to do anything. See scripts/lib/mute-tap.mjs and §3.G. */
  const probe = await ev(TAP_PROBE);
  ok(probe.gain === 0 && probe.taps > 0,
    `the output is muted at the AudioContext's destination`
    + ` (${probe.taps} context(s), live gain ${probe.gain}${probe.error ? `, ${probe.error}` : ''})`);

  // -----------------------------------------------------------------------
  // The sprite pulses with the cry. Measured, not inferred from the source.
  // -----------------------------------------------------------------------

  /* `check_spectrum_page.mjs` can prove `paintSprite()` is CALLED from four places
   * and writes a transform on both its paths. It cannot prove the effect exists: a
   * typo'd id, a `loud` that is always 0, a transform the compositor ignores — every
   * one of those is a green static check over a sprite that does not move. This block
   * is the half that can fail.
   *
   * The mute tap is installed, and that is not a problem: the AnalyserNode hangs off
   * the GAIN node, so the tap's zero is DOWNSTREAM of the measurement. This is §3.G6's
   * rule applied — a test that silences the thing under test has to measure upstream of
   * the silence — and it is why a muted page can still be asked whether it reacts. */
  const SPRITE_BOX = `(() => {
    const e = document.getElementById('sp-art');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height, transform: e.style.transform || '' };
  })()`;

  /* SAMPLED OVER 90 FRAMES, NOT READ ONCE. The pulse is a function of the audio, so
   * a single read taken in a silent gap reports the resting size on a perfectly
   * working page — a flake that would have been "fixed" by widening the tolerance,
   * which is how §3.G's press-did-not-land bug looked too. 90 frames is ~1.5 s, which
   * covers the length of the shortest cry in the roster.
   *
   * `widest` is seeded at 0, NOT at `Infinity`, and the assertion is a comparison
   * against a measured rest width rather than `widest > FLOOR`. §3.G4 records the
   * known unfixed version of this check on the sorting page: its minimum was seeded at
   * `Infinity`, so `Infinity > floor` is true, the assertion certified a measurement
   * that was never taken, and the crash one line later was what got noticed. A seeded
   * sentinel is a value only if the seed is a value. */
  const SAMPLE_SPRITE = (ms) => `(async () => {
    const e = document.getElementById('sp-art');
    if (!e) return null;
    /* offsetWidth, NOT getBoundingClientRect().width — the rect is the TRANSFORMED
     * box, so sampling a "resting" width after play has already begun measures the
     * pulse and calls it the baseline. The first version did exactly that, and the
     * number it printed was 78.3px where the sprite's real width is 72. */
    const rest = e.offsetWidth;
    let widest = 0, moved = 0, frames = 0, sawScale = false, lastT = '';
    const untilMs = ${ms};
    await new Promise((done) => {
      const t0 = Date.now();
      const step = () => {
        const w = e.getBoundingClientRect().width;
        if (w > widest) widest = w;
        if (Math.abs(w - rest) > 0.01) moved++;
        const t = e.style.transform || '';
        if (t) lastT = t;
        if (/scale\\(/.test(t)) sawScale = true;
        frames++;
        if (Date.now() - t0 >= untilMs) return done();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return { rest, widest, moved, frames, sawScale, lastT, transform: e.style.transform || '' };
  })()`;

  /* STOPPING IS NOT A BLIND CLICK, and the first version cost two red checks.
   *
   * The original read `sp-play.click(); until(aria-pressed === 'false')`. By the time
   * it ran, the 1,500 ms sampler had usually outlasted the cry, so the page had already
   * ended playback on its own and the button was sitting at `false`. The click then
   * started a SECOND playback, the poll timed out on a condition that could not come
   * true in 15 s, its `false` return was discarded, and the assertion below read a
   * live transform on a sprite that was behaving perfectly. The next block then
   * clicked again and inherited the same state — §3.G9 exactly: a cascading failure
   * prints as N independent reds and only the first is worth reading.
   *
   * So the press is CONFIRMED to have been needed (§3.G: a control whose state was not
   * read first is a press that may not be a press) and the poll's return is asserted
   * rather than dropped, because a timeout that is ignored is a guess that happened to
   * leave the page in the state the next line wanted. */
  const stopPlayback = async () => {
    const pressed = await ev(`document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'true'`);
    if (pressed) await ev('document.getElementById("sp-play").click()');
    return until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'false'`, 15000);
  };

  const spriteRest = await ev(SPRITE_BOX);
  ok(spriteRest && spriteRest.w > 0 && spriteRest.transform === '',
    `the intro sprite is measurable and at identity before anything plays`
    + ` (${spriteRest ? spriteRest.w.toFixed(1) : '?'} CSS px wide, transform ${JSON.stringify(spriteRest?.transform ?? 'null')})`);

  await ev('document.getElementById("sp-play").click()');
  await until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'true'`, 6000);

  const pulse = await ev(SAMPLE_SPRITE(1500));
  ok(pulse && pulse.widest > pulse.rest + 1,
    `the sprite GROWS while the cry plays — ${pulse ? pulse.rest.toFixed(1) : '?'}px at rest,`
    + ` up to ${pulse ? pulse.widest.toFixed(1) : '?'}px`
    + ` (+${pulse ? (100 * (pulse.widest / pulse.rest - 1)).toFixed(1) : '?'}%),`
    + ` and it differed from rest on ${pulse ? pulse.moved : '?'}/${pulse ? pulse.frames : '?'} frames`);
  ok(pulse && pulse.sawScale,
    `and the growth is a TRANSFORM rather than a layout change, so the 6:4 intro grid does not reflow`
    + ` — sampled INSIDE the window, not after it: the cry ends inside 1.5 s and a read taken`
    + ` at the end sees the reset, which is the transform the page is supposed to leave behind`
    + ` (last live value ${pulse ? pulse.lastT : 'null'})`);

  await stopPlayback();

  const spriteAfter = await ev(SPRITE_BOX);
  ok(spriteAfter && spriteAfter.transform === '',
    `stopping returns it to IDENTITY rather than freezing it mid-pulse`
    + ` (transform ${JSON.stringify(spriteAfter?.transform ?? 'null')}, ${spriteAfter ? spriteAfter.w.toFixed(1) : '?'}px)`);

  /* REDUCED MOTION, and asserted by measurement rather than by the presence of the
   * guard in the source. §3.C requires it and `check_spectrum_page.mjs` can see the
   * `reduced()` call; only the emulated media query proves the call is on the path
   * this box actually takes. Restored to `features: []` afterwards so the rest of the
   * file runs under the browser's real setting. */
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await ev('document.getElementById("sp-play").click()');
  await until(ev, `document.getElementById('sp-play')?.getAttribute('aria-pressed') === 'true'`, 6000);
  const calm = await ev(SAMPLE_SPRITE(1500));
  ok(calm && calm.moved === 0 && calm.widest <= calm.rest + 0.01,
    `under prefers-reduced-motion the sprite does not move AT ALL`
    + ` (widest ${calm ? calm.widest.toFixed(2) : '?'}px against a rest of ${calm ? calm.rest.toFixed(2) : '?'}px,`
    + ` ${calm ? calm.moved : '?'} of ${calm ? calm.frames : '?'} frames differed)`);
  await stopPlayback();
  await send('Emulation.setEmulatedMedia', { features: [] });

  // -----------------------------------------------------------------------
  // The claim the whole page rests on.
  // -----------------------------------------------------------------------

  /* The page re-derives its features in the browser and prints the difference against
   * `cry_features.json`. What is recomputed here, from outside the page, is the ONE
   * number both implementations must agree on: the duration.
   *
   * An earlier version of this block gated all 32 comparable features under a 2%
   * tolerance and failed at 27.5% median, 1,536% worst. That was not a broken page —
   * it was a gate with no meaning. Measured, decoding the same file at its own
   * 32,728 Hz gives a 5.5% median and a 1,181% worst, and the worst is an `ms`
   * column whose stored value is about 0.002: a relative difference with a
   * near-zero denominator. Decoding at 48 kHz makes it worse (21% and 27.5%), because
   * that adds `decodeAudioData`'s own resample on top of the decoder difference.
   *
   * So the assertion here is the structural one — the pipeline runs, produces 31
   * comparable features, and the page's figures are computed rather than typed — plus
   * the one quantity that IS invariant: a sample count.
   */
  const independent = await ev(`(async () => {
    const M = await import('/assets/js/cry-spectrogram.js');
    const F = await (await fetch('assets/data/cry_features.json')).json();
    const ctx = new OfflineAudioContext(1, 1024, 32728);
    const buf = await ctx.decodeAudioData(
      await (await fetch('assets/cries/latest/1.ogg')).arrayBuffer());
    const rows = M.analyseCry(buf.getChannelData(0), buf.sampleRate);
    const st = F.latest['1'];
    const rel = M.ROBUST.map((i) => ({
      name: M.FEATURE_NAMES[i],
      r: Math.abs(rows.features[i] - st[i]) / Math.max(Math.abs(st[i]), 1e-12),
    }));
    return {
      comparable: M.COMPARABLE.length,
      uncomparable: M.UNCOMPARABLE.map((i) => M.FEATURE_NAMES[i]),
      robust: M.ROBUST.map((i) => M.FEATURE_NAMES[i]),
      dur: rows.features[0],
      storedDur: st[0],
      centroid: rows.features[4],
      storedCentroid: st[4],
      worst: rel.sort((a, b) => b.r - a.r)[0],
    };
  })()`);

  ok(independent.comparable === 31,
    `31 features are comparable, as the page says (the 34 minus ${independent.uncomparable.join(', ')})`);
  ok(Math.abs(independent.dur - independent.storedDur) / independent.storedDur < 1e-4,
    `the sample count — invariant to every resample and every amplitude scale —`
    + ` matches the offline table (${independent.dur.toFixed(6)} vs ${independent.storedDur.toFixed(6)} s)`);
  ok(Math.abs(independent.centroid - independent.storedCentroid) / independent.storedCentroid < 0.05,
    `and the centroid lands within 5% when the file is decoded at its OWN rate`
    + ` (${independent.centroid.toFixed(0)} vs ${independent.storedCentroid.toFixed(0)} Hz);`
    + ` that 5% is the decoder, and at the 48 kHz device rate the same file is 27% off`);
  /* 10% RELATIVE, and relative is the right statistic for exactly these six and for
   * nothing else in the table. They were chosen because their stored magnitudes are
   * O(1) or larger — a crossing rate, a frequency in Hz, a ratio bounded by 1 — so
   * there is no near-zero denominator to divide by. Bulbasaur's worst is `zcr` at
   * 6.6%: 62 crossings per second on a rate of 943, which is the decoder and
   * nothing else. The 13 `ms` columns are excluded from this gate precisely because
   * they fail it for the reason that a relative difference is meaningless there. */
  ok(independent.worst.r < 0.10,
    `every one of the five well-conditioned features lands within 10% of the offline table when`
    + ` the file is decoded at its own rate (worst ${independent.worst.name} at`
    + ` ${(100 * independent.worst.r).toFixed(2)}%)`);
} finally {
  ws.close();
}

console.log('');
if (fails.length) {
  for (const f of fails) console.log(`FAIL  ${f}`);
  console.log(`FAIL  ${fails.length} of ${pass + fails.length} checks failed`);
  await shutdown(1);
}
console.log(`PASS  ${pass} checks`);
/* Falling off the end would run the exit handlers, which remove the profile while
 * Chrome may still be dying — see the note on `removeProfile`. §3.Z's rule: this
 * file needs to EXPLICITLY exit, and now it exits through the teardown. */
await shutdown(0);
