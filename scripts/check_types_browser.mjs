#!/usr/bin/env node
/**
 * The rendered layout of types.html's Pokémon roster, driven over the DevTools Protocol.
 *
 *   node scripts/check_types_browser.mjs      (needs the repo on :5500)
 *
 * ## WHY THIS EXISTS
 *
 * `types.html` had NO browser checker of any kind — the six that exist are all
 * `manual: true` or cover other pages, and nothing in the suite opened this one.
 * That is §3.P's shape exactly: a page can ship defects through a whole suite
 * because no checker reads it. The roster was then given a layout whose numbers
 * were quoted to the user before they were rendered (12 columns / 7 rows /
 * 586px), and the first measurement of it found a defect that every number had
 * missed.
 *
 * ## WHAT THE FIRST MEASUREMENT MISSED, AND WHY IT IS THE FIRST ASSERTION HERE
 *
 * The grid placed twelve 96.7px tracks. Every card inside them was **60px wide**.
 * The COLUMN COUNT was right, the ROW COUNT was right, the total HEIGHT was right
 * — and the cards were not equal width, which is the entire claim.
 *
 * The cause is structural rather than a typo: the grid item is the `<li>`, and
 * the anchor inside it is `inline-flex`, which sizes to its CONTENT. `auto-fill`
 * divided the row into equal tracks and nothing told the cards to occupy them, so
 * the two were free to disagree. No assertion about column count, row count or
 * height can see that, and a screenshot sees it immediately.
 *
 * So the first assertion is not "12 columns" — a number that goes stale the day
 * the font changes — it is that **every card fills the track it was placed in**,
 * and that **every card in a row is the same width**. Those two hold whatever
 * the column count turns out to be, and the first one is exactly what the defect
 * violated.
 *
 * ## MECHANISM AND OUTCOME, BOTH
 *
 * §3.G1a's finding is that 170 static and 43 CDP checks stayed green over a
 * visibly broken page. Two of the claims here are about the DECLARATION
 * (`object-fit: contain`, a `translateY` percentage) and one is about the
 * GEOMETRY (the subject's centre in its box, the card's width in its track). The
 * first two can be read from the stylesheet and are asserted statically in
 * `check_moves_page.mjs`; what is here is the geometry, because that is the half
 * the stylesheet cannot state.
 *
 * ## SCOPE IS ASSERTED, NOT ASSUMED
 *
 * `.chip-grid` and `.chip-item` are shared by THREE blocks on this page — the
 * roster (links + a thumbnail), 招式 (a span + a power number) and 特性 (a span +
 * a count). Two of them are lists of short pills that want content-sized widths,
 * and a rule that equalised all three would have moved two lists nobody asked to
 * move. The roster carries a `--roster` modifier for exactly that reason, and the
 * last section asserts the other two are still flex and still content-sized —
 * by checking that their card widths still DIFFER from each other, which is the
 * observable consequence rather than the declaration.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';
import { until } from './lib/cdp-until.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const PORT = process.env.TYPES_PORT || process.env.CRY_PORT || 5500;
const DESKTOP = { width: 1280, height: 1500 };
const TABLET = { width: 768, height: 1200 };
const PHONE = { width: 390, height: 844 };

const profile = trackTree(mkdtempSync(join(tmpdir(), 'types-')));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', d => { chromeStderr += d; });

/*
 * Order is load-bearing and the first version got it wrong.
 *
 * `trackTree()` installs an `exit` handler that removes the tree, and this file
 * installs another that kills Chrome. Exit handlers run in REGISTRATION order, so
 * the sequence was: sweep the tree away, then `chrome.kill()`. Chrome is a
 * separate process and does not stop the instant it is signalled — for the few
 * milliseconds between the `SIGTERM` and its actual death it is still writing to
 * its profile, and it **recreates the directory that was just removed underneath
 * it.** What survives is a bare `Default/` with no `DevToolsActivePort`, which is
 * the signature §3.W records for a tree left behind rather than swept.
 *
 * Three runs left three such trees, all of them clean exits including the passing
 * one. So the net is only a net: on the paths this file actually ends on, the
 * tree has to be released deliberately and Chrome has to be CONFIRMED dead first.
 */
async function shutdown(code) {
  try { chrome.kill(); } catch {}
  // Wait for the process to actually be gone, on a named ceiling. A timeout here
  // returns rather than throws, so a Chrome that refuses to die still exits the
  // checker instead of hanging it — which §3.Z records as indistinguishable from
  // a checker that is stuck.
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, 3000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  releaseTree(profile);
  process.exit(code);
}

/* The fallback for a path that never reaches `shutdown` — an uncaught throw, which
 * is exactly when the run is already going wrong. Killing Chrome here is what stops
 * it rendering pages forever (§3.J); the tree is best-effort, and the ordering
 * caveat above is why that is stated rather than assumed. */
process.on('exit', () => { try { chrome.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { chrome.kill(); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); });
}

const CDP = await waitForDebugPort(profile);
let targets;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
    if (r.ok) { targets = await r.json(); break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const waiting = new Map();
const exceptions = [];
/* `lastMethod` is module scope and is NEVER reset on success: the most recently
 * ISSUED method is by construction the outstanding one, and the first version of
 * this file's sibling reset it and printed "(idle)" for exactly the failure it
 * existed to describe (§3.G9). */
let lastMethod = '(none)';
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`EXC ${((d.exception?.description) || d.text || '').split('\n')[0]} @ ${d.url || '?'}`);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  lastMethod = method;
  waiting.set(n, (x) => (x.error ? rej(new Error(`${method}: ${JSON.stringify(x.error)}`)) : res(x.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(`while calling ${lastMethod}: ${(r.exceptionDetails.exception?.description || '').split('\n')[0]}`);
  }
  return r.result.value;
};

let checks = 0;
const fails = [];
const notes = [];
/** `ok(cond, what[, detail])` — variadic, for §3.G9's reason: a shape this file's
 *  siblings had with a third argument at most call sites and a two-argument
 *  signature that accepts it silently, printing a bare ok and dropping the number
 *  it had just taken. */
const ok = (cond, what, detail) => {
  checks++;
  const line = detail ? `${what} — ${detail}` : what;
  if (!cond) fails.push(line);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${line}`);
};
const at = label => console.log(`\n— ${label}`);

await send('Page.enable');
await send('Runtime.enable');

/*
 * Captured at MODULE LOAD, before any override exists. §4 records what happens
 * when a checker asserts against its own hardcoded default instead: `clear`
 * restores whatever the page HAD, which is not the same number, and the
 * assertion then measures a layout the file did not intend to check. The first
 * version of check_moves_page_browser.mjs captured it lazily and so read it
 * while a 390px override was still in force.
 */
const defaultWidth = await ev('innerWidth');

async function atSize(size) {
  await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: size.width < 500 });
  const SEEN = await until(ev, `innerWidth === ${size.width}`, 3000);
  const WIDTH = await ev('innerWidth');
  ok(SEEN, `the viewport is ${size.width}px before anything is measured at it`, `asked ${size.width}, innerWidth ${WIDTH}`);
  return WIDTH;
}
async function atDefaultSize() {
  await send('Emulation.clearDeviceMetricsOverride');
  const SEEN = await until(ev, `innerWidth === ${defaultWidth}`, 3000);
  const WIDTH = await ev('innerWidth');
  ok(SEEN, `the viewport is restored to ${defaultWidth}px`, `innerWidth ${WIDTH}`);
  return WIDTH;
}

/* One page load; the roster is CSS-laid-out, so resizing re-renders it without
 * re-running the module. Loading per width would be four times the cost for the
 * same numbers. */
await send('Emulation.setDeviceMetricsOverride', { ...DESKTOP, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${PORT}/types.html?type=fire` });

// Wait on a PRECONDITION, never on the assertion: a poll for "81 chips" returns
// true on a correct page and times out on a wrong one, which asserts nothing.
const READY = `document.querySelector('.chip-grid--roster') !== null && document.querySelector('.chip-grid--roster .chip-item') !== null`;
const ready = await until(ev, READY, 25000);
ok(ready, 'the 火 roster rendered', exceptions.length ? exceptions.join(' | ') : 'no exceptions');
ok(exceptions.length === 0, 'types.html raised no uncaught exception', exceptions.join(' | '));

/** Everything the assertions below read, in one round trip per viewport. */
const probe = `(() => {
  const grid = document.querySelector('.chip-grid--roster');
  const listItems = [...grid.children];
  const chips = [...grid.querySelectorAll('.chip-item')];
  const rects = chips.map(c => c.getBoundingClientRect());
  const trackRects = listItems.map(li => li.getBoundingClientRect());
  const rows = [...new Set(rects.map(r => Math.round(r.top)))];
  const widths = rects.map(r => r.width);

  const img = grid.querySelector('.chip-item img');
  const imgCs = getComputedStyle(img);
  const imgRect = img.getBoundingClientRect();

  // The longest name ON THE PAGE, not in the corpus: this is what decides
  // whether the track width is a promise or a hope.
  let longest = null;
  for (const n of grid.querySelectorAll('.chip-name')) {
    if (!longest || n.textContent.length > longest.len) {
      longest = { len: n.textContent.length, text: n.textContent.trim(), clipped: n.scrollWidth > n.clientWidth + 1, h: Math.round(n.getBoundingClientRect().height) };
    }
  }

  // The OTHER two blocks, which must not have been equalised.
  const others = [...document.querySelectorAll('.chip-grid:not(.chip-grid--roster)')];
  const otherWidths = others.flatMap(g => [...g.querySelectorAll('.chip-item')].map(c => Math.round(c.getBoundingClientRect().width)));

  return JSON.stringify({
    chips: chips.length,
    tracks: trackRects.length,
    rows: rows.length,
    gridDisplay: getComputedStyle(grid).display,
    cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    trackW: Math.round(trackRects[0].width * 10) / 10,
    chipW: { min: Math.round(Math.min(...widths)), max: Math.round(Math.max(...widths)) },
    chipH: Math.round(rects[0].height),
    gridH: Math.round(grid.getBoundingClientRect().height),
    // How much of its track each card occupies, worst case.
    fill: Math.round(Math.min(...rects.map((r, i) => r.width / trackRects[i].width)) * 1000) / 1000,
    thumb: Math.round(grid.querySelector('.chip-thumb').getBoundingClientRect().width),
    imgNatural: [img.naturalWidth, img.naturalHeight],
    imgBox: [Math.round(imgRect.width), Math.round(imgRect.height)],
    fit: imgCs.objectFit,
    transform: getComputedStyle(grid.querySelector('.chip-thumb.is-sv img')).transform,
    radius: getComputedStyle(chips[0]).borderRadius,
    direction: getComputedStyle(chips[0]).flexDirection,
    longest,
    otherDisplays: others.map(g => getComputedStyle(g).display),
    otherWidthSpread: otherWidths.length ? Math.max(...otherWidths) - Math.min(...otherWidths) : null
  });
})()`;

const SIZES = [
  ['desktop', DESKTOP],
  ['tablet', TABLET],
  ['phone', PHONE]
];
const seen = {};

for (const [label, size] of SIZES) {
  await atSize(size);
  const m = JSON.parse(await ev(probe));
  seen[label] = m;

  console.log(`\n  ${label} ${size.width}px: ${m.cols} columns x ${m.rows} rows, ` +
    `${m.chips} cards, grid ${m.gridH}px, card ${m.chipW.min}x${m.chipH}`);

  /* ---- THE FIRST ASSERTION, and the one the first measurement failed ---- */
  ok(
    m.fill > 0.98,
    `every card fills the track it was placed in`,
    `worst is ${Math.round(m.fill * 100)}% of a ${m.trackW}px track`
  );

  /* Equal width is the claim itself, asserted over every card rather than the
   * first one — a grid whose tracks are equal and whose cards are not is the
   * exact shape of the defect that started this file. */
  ok(
    m.chipW.max - m.chipW.min <= 1,
    'every card in the grid is the same width',
    `${m.chipW.min}..${m.chipW.max}px across ${m.chips} cards`
  );

  ok(m.gridDisplay === 'grid', 'the roster is a grid', m.gridDisplay);
  ok(m.cols > 1, 'and it has more than one column', `${m.cols} columns`);
  ok(m.chips === m.tracks, 'every grid track carries exactly one card', `${m.tracks} tracks, ${m.chips} cards`);
  ok(m.direction === 'column', 'the card stacks image above name', m.direction);

  /* The artwork must not be stretched. 120×112 into a square box is a 7% error
   * on the horizontal, and `object-fit: fill` is what produced it. */
  ok(
    m.imgNatural[0] === 120 && m.imgNatural[1] === 112,
    'the card is showing the 120x112 Scarlet/Violet icon',
    `${m.imgNatural[0]}x${m.imgNatural[1]}`
  );
  ok(m.fit === 'contain', 'scaled without distortion', `object-fit: ${m.fit}`);
  ok(
    m.imgBox[0] === m.imgBox[1],
    'and the box it is drawn into is square, so contain is doing the work',
    `${m.imgBox[0]}x${m.imgBox[1]}`
  );

  /* The icon grew from 28px. Asserted against the size at THIS width rather
   * than a literal, so the phone's smaller figure is not a failure. */
  const expectedThumb = size.width < 560 ? 32 : 40;
  ok(m.thumb === expectedThumb, `the thumbnail is ${expectedThumb}px at this width`, `${m.thumb}px`);

  /* The longest name on the page must fit its track. The corpus maximum is 5
   * characters, so this is a real assertion rather than a formality — and it is
   * what makes `text-overflow: ellipsis` a backstop rather than a lid. */
  ok(m.longest && m.longest.len >= 4, 'the page has a name long enough to test the track width', `${m.longest.len} characters (${m.longest.text})`);
  ok(
    m.longest && !m.longest.clipped,
    'and it is not clipped by its column',
    m.longest ? `${m.longest.text} — scrollWidth > clientWidth: ${m.longest.clipped}` : ''
  );
  ok(
    m.longest && m.longest.h <= 24,
    'and it stays on one line',
    m.longest ? `${m.longest.h}px tall` : ''
  );
}

/* ---- the offset is a measured geometry, not a percentage in a file ---- */
{
  /*
   * TWO MEASUREMENTS, because no single one of them can see the whole claim.
   *
   * The first version tried to measure the subject's final position and compared
   * it against the box centre; it reported 78% and was wrong about the page,
   * because it scaled the canvas by the element height while `object-fit:
   * contain` paints a shorter image inside that element. The second version
   * measured the SHIFT by toggling the transform and re-drawing — and read
   * 0.0px, which is the more interesting failure: **`ctx.drawImage(img)` reads
   * the image's own pixels, and a CSS transform is applied by the rendering
   * pipeline, which drawImage does not go through.** A canvas measurement can
   * never see a transform on the element it is drawing.
   *
   * So: the SHIFT comes from `getBoundingClientRect()`, which does reflect
   * transforms, and the ARTWORK's own bottom-anchoring comes from the canvas.
   * Their composition is the visual claim, and neither half has to model
   * `object-fit` to be correct.
   */
  const measure = `(() => {
    const img = document.querySelector('.chip-grid--roster .chip-thumb.is-sv img');
    const r = img.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) {
      let hit = false;
      for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3] > 16) { hit = true; break; }
      if (hit) { if (top === -1) top = y; bottom = y; }
    }
    return JSON.stringify({
      top: Math.round(r.top * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      painted: top !== -1,
      gapTopRows: top,
      gapBottomRows: top === -1 ? null : (c.height - 1 - bottom)
    });
  })()`;

  const withOffset = JSON.parse(await ev(measure));
  ok(withOffset.painted, 'the roster artwork has visible pixels');

  const declared = await ev(`(() => {
    const img = document.querySelector('.chip-grid--roster .chip-thumb.is-sv img');
    img.style.transform = 'none';
    return getComputedStyle(img).transform;
  })()`);
  const without = JSON.parse(await ev(measure));
  await ev(`(() => {
    document.querySelector('.chip-grid--roster .chip-thumb.is-sv img').style.transform = '';
    return true;
  })()`);

  const lift = withOffset.top - without.top;
  const asPercent = (lift / withOffset.height) * 100;
  ok(
    Math.abs(asPercent + 25) < 3,
    'the offset lifts the subject by 25% of the box — the measured figure, at this box size',
    `${asPercent.toFixed(1)}% (${lift.toFixed(2)}px of a ${withOffset.height}px box); with the offset removed the computed transform was ${declared}`
  );
  /*
   * And the reason a lift is needed at all, asserted about the ARTWORK rather
   * than the page: PokeAPI's Scarlet/Violet icons are bottom-anchored, so the
   * subject's gap to the bottom of its own image is 0px while the 96px sprite
   * set leaves 11.5px. A transform is the right instrument here and
   * `object-position` is not, because this chip pairs its thumbnail with a name
   * on one line and the goal is to centre the subject against that text —
   * which move.html deliberately does not do (§3.E).
   */
  ok(
    withOffset.gapBottomRows <= 1,
    'the artwork itself is bottom-anchored — the gap to its own bottom edge is 0px',
    `${withOffset.gapBottomRows} rows of ${withOffset.gapTopRows} above`
  );
}

/* ---- the other two blocks were not equalised ---- */
{
  const desktop = seen.desktop;
  ok(
    desktop.otherDisplays.every(d => d === 'flex'),
    '招式 and 特性 are still flex-wrap rows',
    desktop.otherDisplays.join(', ')
  );
  /*
   * The observable consequence rather than the declaration: if those lists had
   * been given equal-width columns their cards would all measure the same. They
   * do not, which is the property they are supposed to have.
   */
  ok(
    desktop.otherWidthSpread > 8,
    'and still content-sized — their cards differ in width, which equal columns would have removed',
    `${desktop.otherWidthSpread}px between the narrowest and widest`
  );
  ok(seen.phone.rows < seen.desktop.rows || seen.phone.cols < seen.desktop.cols,
    'the roster narrows rather than wrapping at a phone width',
    `desktop ${seen.desktop.cols} cols, phone ${seen.phone.cols} cols`);
}

await atDefaultSize();

/* ===== report ===== */

notes.push(`measured: desktop ${seen.desktop.cols}×${seen.desktop.rows}, ` +
  `tablet ${seen.tablet.cols}×${seen.tablet.rows}, phone ${seen.phone.cols}×${seen.phone.rows}; ` +
  `grid heights ${seen.desktop.gridH}/${seen.tablet.gridH}/${seen.phone.gridH}px`);
for (const note of notes) console.log(`\n  note  ${note}`);

if (fails.length === 0) {
  console.log(`\nPASS ${checks} checks`);
  await shutdown(0);
} else {
  console.error(`\nFAIL ${fails.length} of ${checks} checks`);
  for (const f of fails) console.error(`  · ${f}`);
  await shutdown(1);
}