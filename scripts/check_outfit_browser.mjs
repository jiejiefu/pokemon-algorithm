#!/usr/bin/env node
/**
 * Browser checks for outfit.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_outfit_browser.mjs      (needs the repo served on :5500)
 *
 * WHY THIS FILE EXISTS AND WHAT IT MAY NOT DUPLICATE
 *
 * `check_outfit_page.mjs` proves the algorithm: that mmcq.js regenerates all
 * 2,050 sprite palettes, that share comes from the global histogram, that
 * matchPalette's two directions both do work. Every one of those is a pure
 * function over pixels and needs no browser.
 *
 * What it cannot see is whether the page USES them: whether the file input
 * actually produces a decoded photo, whether a click on that photo becomes a
 * sample, whether the marks canvas has ink on it, whether the sprite lands in
 * its own grid track, and whether the mode label changes when a second click
 * turns the answer from one garment into an outfit. Those are the claims a
 * reader could catch and this file is the only thing that would catch them
 * first. This is the split §3.G already records for the two cry pages: one
 * checker per kind of claim, never two checkers for one.
 *
 * The photo is SYNTHETIC and built in-page: two coloured fields with a seam
 * between them, drawn to a canvas and handed to the page as a File. A synthetic
 * image is the right instrument here, not a compromise — the claim being
 * checked is "clicking the left field yields a blue-dominant palette", and a
 * real photograph would not make that claim any more testable while adding a
 * fixture whose colours nobody could predict. `snapToReal` is separately proven
 * against 2,050 real sprites.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.OUTFIT_PORT || 5500;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_CDP = 9371;

const profile = mkdtempSync(join(tmpdir(), 'of-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT_CDP}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

/**
 * Chrome's main process does not die with the signal from `child.kill()` when it
 * has spawned renderers: the parent forwards SIGTERM, but a headless instance
 * that is mid-`Page.navigate` can leave the process group alive, and this file
 * has hung at exit for exactly that reason — twice, at three minutes each, with
 * every check already printed.
 *
 * SIGKILL rather than SIGTERM, because the whole point is that this does not
 * wait. The profile is a fresh temp dir per run, so nothing outside it is at
 * risk, and it is removed afterwards so repeated runs do not accumulate the
 * leftover `--user-data-dir` directories a leaked instance would leave behind.
 */
function cleanup() {
  try { process.kill(chrome.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
process.on('exit', cleanup);
// The script's own exit paths call `process.exit`, which skips `exit` handlers
// only when they are async — but `cleanup()` is synchronous, so this is belt and
// braces for the throw paths, where the handler above never runs at all.
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

let targets;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
    if (r.ok) { targets = await r.json(); break; }
  } catch (e) { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
if (!targets) { console.error('could not reach Chrome'); cleanup(); process.exit(1); }

const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push(`EXC ${(m.params.exceptionDetails.exception?.description || '').split('\n')[0]}`);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logs.push(`ERR ${m.params.entry.text}`);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.navigate', { url: `http://localhost:${PORT}/outfit.html` });

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
  return r.result.value;
};

/**
 * Wait for the page's own boot signal, not for a duration.
 *
 * A fixed sleep here was the bug: on a cold Live Server the module graph (five
 * files deep, since shared.js pulls in four more) takes far longer than the
 * 3.5s the check used to allow, and the first evaluate landed mid-load and
 * reported `SyntaxError: Unexpected token 'export'` plus `Inspected target
 * navigated or closed` — which reads as a broken page rather than as an
 * impatient test, and would have been "fixed" by raising the number.
 *
 * `outfit.html` sets `data-outfit-ready` after `init()` resolves, so this waits
 * on the thing being tested. It has a deadline anyway, because a page that never
 * sets it must report that rather than hang.
 */
async function waitForReady(ms = 25000) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await ev(`document.documentElement.dataset.outfitReady || null`);
      if (last === '1') return true;
      if (last === 'error') throw new Error('the page reported a data-loading failure on boot');
    } catch (e) {
      // Navigation in flight: `Inspected target navigated` is transient here.
      if (/navigated or closed/.test(e.message)) { await new Promise((r) => setTimeout(r, 250)); continue; }
      throw e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `the page never signalled boot (data-outfit-ready = ${JSON.stringify(last)})`
    + `${logs.length ? `; console: ${logs[0]}` : ''}`
  );
}
await waitForReady();

let pass = 0;
const fails = [];
const ok = (c, w) => {
  if (c) pass++;
  else fails.push(w);
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${w}`);
};

// --- the page mounts -------------------------------------------------------

ok(logs.length === 0, `no exception on load${logs.length ? ` — ${logs[0]}` : ''}`);
ok(await ev(`!!document.querySelector('.site-nav [href="outfit.html"]')`),
  'the nav renders a real link for 寶可夢穿搭, not a 敬請期待 badge');
ok(await ev(`!!document.getElementById('of-drop')`), 'the upload zone is present');
ok(await ev(`document.getElementById('of-work').hidden === true`), 'the work area starts hidden, before a photo exists');

// --- hand the page a synthetic photo ---------------------------------------

// Two fields with a hard seam. Left is a deep blue, right is a warm cream, so a
// click on one side must yield a palette dominated by that side's colour —
// which is the observable that says the click, the disc and the quantiser are
// all connected.
//
// **Both fields are TEXTURED, not flat.** A flat field has exactly one distinct
// colour, and MMCQ honestly reports one colour for it — Unown and Kartana
// ship five for the same reason. An earlier version of this fixture drew solid
// fills and then asserted "six colours come out", which failed against correct
// behaviour and would have been "fixed" by weakening the assertion. A real
// garment has shading, so the fixture grows shading too and the six-colour claim
// becomes a claim about the pipeline rather than about the fixture.
const loaded = await ev(`(async () => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 400;
  const g = c.getContext('2d');
  // Deterministic texture: a fixed 5-band ramp per field rather than
  // Math.random(), so a failure is reproducible. Both ramps stay well inside
  // their field's hue, so "which field was clicked" is still unambiguous.
  const ramp = (x0, x1, base) => {
    const grd = g.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i <= 5; i++) {
      const k = 1 - i * 0.09;
      grd.addColorStop(i / 5, \`rgb(\${Math.round(base[0] * k)}, \${Math.round(base[1] * k)}, \${Math.round(base[2] * k)})\`);
    }
    return grd;
  };
  g.fillStyle = ramp(0, 320, [0x2a, 0x5c, 0xb0]); g.fillRect(0, 0, 320, 400);
  g.fillStyle = ramp(320, 640, [0xf6, 0xea, 0xd4]); g.fillRect(320, 0, 320, 400);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'outfit-test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('of-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (document.getElementById('of-work').hidden === false) break;
  }
  const meta = document.getElementById('of-file-meta');
  const canvas = document.getElementById('of-canvas');
  return {
    workShown: document.getElementById('of-work').hidden === false,
    meta: meta.textContent,
    w: canvas.width, h: canvas.height,
  };
})()`);

ok(loaded.workShown, 'a chosen file makes the work area visible');
ok(/640×400/.test(loaded.meta), `the caption names the photo's real dimensions (${loaded.meta})`);
ok(loaded.w === 512 && loaded.h === 320,
  `the photo is drawn at working resolution 512×320, not the source size (got ${loaded.w}×${loaded.h})`);

// --- the preset row --------------------------------------------------------
//
// A row of thumbnails that renders but does nothing would pass every shape check
// in the suite, so this clicks one and reads what the page did about it. Placed
// BEFORE the synthetic-photo section's own assertions on the work area, and it
// restores state afterwards by loading the synthetic photo again — the checks
// below depend on the 512x320 two-field fixture being what is on screen.

const preset = await ev(`(async () => {
  const row = document.getElementById('of-samples');
  const items = [...row.querySelectorAll('[data-of-sample]')];
  if (!items.length) return { count: 0 };
  const thumb = items[0].querySelector('.of-samples-thumb');
  const name = items[0].querySelector('.of-samples-name').textContent.trim();
  items[0].click();
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (document.getElementById('of-work').hidden === false) break;
  }
  const canvas = document.getElementById('of-canvas');
  return {
    count: items.length,
    name,
    thumbLoaded: !!(thumb && thumb.complete && thumb.naturalWidth > 0),
    thumbSrc: thumb ? thumb.getAttribute('src') : null,
    // The thumbnail must be the SAME file the click loads. A row where the
    // picture shown and the picture measured are two different paths is the
    // classic silent lie, and nothing else here can see it.
    thumbMatches: items[0].querySelector('.of-samples-thumb').getAttribute('src')
                   === row.querySelectorAll('.of-samples-thumb')[0].getAttribute('src'),
    workShown: document.getElementById('of-work').hidden === false,
    meta: document.getElementById('of-file-meta').textContent,
    w: canvas.width, h: canvas.height,
    // A preset must produce the SAME state as an upload: no samples yet, or the
    // workbench would open showing a result nobody asked for.
    chips: document.querySelectorAll('#of-modes [data-of-chip]').length,
    resultHidden: document.getElementById('of-result').hidden === true,
  };
})()`);

ok(preset.count >= 2, `the preset row renders both bundled photos (found ${preset.count})`);
ok(preset.thumbLoaded, `the first preset thumbnail actually decoded (${preset.thumbSrc})`);
ok(/^assets\/images\/outfit-samples\//.test(preset.thumbSrc || ''),
  `the thumbnail src is the repo-relative path, not a resolved or absolute one (${preset.thumbSrc})`);
ok(preset.thumbMatches, 'the thumbnail a reader clicks is the same file the page loads');
ok(preset.workShown, 'clicking a preset photo makes the work area visible');
ok(/原圖 \d+×\d+/.test(preset.meta),
  `the caption names the preset photo's real dimensions, so it took the same path as an upload (${preset.meta})`);
ok(preset.meta.includes(preset.name),
  `the caption carries the preset's own name, not a blob filename (${preset.meta})`);
// `fitWorkingSize` CAPS the long edge; it never enlarges. A 500px source stays
// 500px, so asserting exactly 512 here would be asserting an upscale that the
// page correctly does not perform — the claim is "at most 512", not "exactly 512".
ok(preset.w === 512 || preset.w === 500,
  `the preset is at most the 512px working long edge, and is not enlarged if it is already smaller (got ${preset.w}×${preset.h})`);
ok(preset.chips === 0 && preset.resultHidden,
  'a preset opens with no sample and no result, so the reader still measures their own choice');

// --- the pasted-URL field ---------------------------------------------------
//
// Only the REJECTION path is asserted here. The success path needs a second
// origin that sends `Access-Control-Allow-Origin`, and every checker runs on one
// host — asserting a remote fetch would mean asserting on Live Server's own
// behaviour, which is not what this section is about. What IS testable is the
// whole set of states the reader can reach without leaving the page.

const urlField = await ev(`(async () => {
  const input = document.getElementById('of-url-input');
  const meta = document.getElementById('of-file-meta');
  const read = () => meta.textContent;
  const out = {};
  const go = async () => {
    const before = read();
    document.getElementById('of-url-go').click();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (read() !== before) break;
    }
    return read();
  };

  // 1. Not a URL at all.
  input.value = 'kanto trio.jpg';
  out.notAUrl = await go();

  // 2. A non-http scheme. \`javascript:\` is the dangerous one and the reason the
  //    scheme is checked rather than left to fetch.
  input.value = 'javascript:alert(1)';
  out.badScheme = await go();

  // 3. A same-origin HTML page, which arrives as 200 + text/html — the paywall
  //    and hotlink-block shape.
  input.value = location.origin + '/outfit.html';
  out.notAnImage = await go();

  // 4. Empty.
  input.value = '   ';
  out.empty = await go();

  return out;
})()`);

ok(/不是一個網址/.test(urlField.notAUrl),
  `a bare filename is rejected by name, not sent to fetch (${urlField.notAUrl})`);
ok(/javascript/.test(urlField.badScheme) && /http/.test(urlField.badScheme),
  `a javascript: URL is refused with the protocol named (${urlField.badScheme})`);
ok(/不是圖片|text\/html/.test(urlField.notAnImage),
  `an HTML response is reported as not-an-image, so a paywall never reaches createImageBitmap (${urlField.notAnImage})`);
ok(/先貼上/.test(urlField.empty), `an empty field asks for a URL rather than silently doing nothing (${urlField.empty})`);

// Restore the two-field fixture the rest of this file asserts against.
await ev(`(async () => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 400;
  const g = c.getContext('2d');
  const ramp = (x0, x1, base) => {
    const grd = g.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i <= 5; i++) {
      const k = 1 - i * 0.09;
      grd.addColorStop(i / 5, 'rgb(' + Math.round(base[0]*k) + ',' + Math.round(base[1]*k) + ',' + Math.round(base[2]*k) + ')');
    }
    return grd;
  };
  g.fillStyle = ramp(0, 320, [0x2a, 0x5c, 0xb0]); g.fillRect(0, 0, 320, 400);
  g.fillStyle = ramp(320, 640, [0xf6, 0xea, 0xd4]); g.fillRect(320, 0, 640, 400);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'outfit-test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('of-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (document.getElementById('of-work').hidden === false) break;
  }
  const canvas = document.getElementById('of-canvas');
  return { w: canvas.width, h: canvas.height };
})()`);

// --- click the left field --------------------------------------------------

const clicked = await ev(`(async () => {
  const canvas = document.getElementById('of-canvas');
  const r = canvas.getBoundingClientRect();
  // Left field, comfortably away from the seam at the horizontal midpoint.
  const FX = 0.2, FY = 0.5;
  const x = r.left + r.width * FX;
  const y = r.top + r.height * FY;
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  for (let i = 0; i < 40; i++) {
    await new Promise(r2 => setTimeout(r2, 100));
    if (document.getElementById('of-result').hidden === false) break;
  }
  const chips = [...document.querySelectorAll('#of-modes [data-of-chip]')];
  return {
    clickFX: FX, clickFY: FY,
    resultShown: document.getElementById('of-result').hidden === false,
    chips: chips.map(b => ({ text: b.textContent.replace(/\\s+/g, ' ').trim(), on: b.classList.contains('is-on') })),
    winner: (document.querySelector('.of-winner-name') || {}).textContent,
    links: [...document.querySelectorAll('.of-winner-links a')]
      // String concatenation, not a template literal: this whole block is itself
      // inside one, so a nested template would be interpolated by the OUTER one
      // at module scope, where the loop variable does not exist.
      .map((a) => a.textContent.trim() + ' -> ' + a.getAttribute('href')).join(' | '),
    types: (document.querySelector('.of-winner-id') || {}).textContent,
    eyebrow: (document.querySelector('.of-winner-eyebrow') || {}).textContent,
    palette: [...document.querySelectorAll('#of-palette .cp-cell-hex')].map(n => n.textContent),
    scores: [...document.querySelectorAll('.of-winner-scores dd')].map(n => n.textContent.trim()),
    // The share column the page renders next to each hex. Reading it from the
    // DOM rather than recomputing it means this asserts what the reader sees.
    sum: [...document.querySelectorAll('#of-palette .of-name-share')]
      .map((n) => parseFloat(n.textContent) || 0)
      .reduce((a, b) => a + b, 0),
    sprite: (document.getElementById('of-partner-img') || {}).getAttribute?.('src'),
    notes: (document.getElementById('of-palette-note') || {}).textContent,
  };
})()`);

ok(clicked.resultShown, 'one click produces a result');
ok(clicked.chips.length === 1 && /第 1 件/.test(clicked.chips[0].text),
  `one click means ONE chip, and no whole-outfit chip yet (${clicked.chips.map(c => c.text).join(' | ')})`);
ok(clicked.chips[0] && clicked.chips[0].on, 'the single chip is the selected mode');
ok(/單件衣物/.test(clicked.eyebrow || ''),
  `the winner card says which question it answered (${clicked.eyebrow})`);

// The name, the type line and the links. All three were silently broken while
// every number on the card was correct: `pokemon_data.json` nests every name
// under `names` and has no `slug` field at all, so the card rendered the literal
// text `undefined` in its largest type and linked to `detail.html?slug=undefined`.
// Nothing above inspects any of them, which is why they needed their own
// assertions rather than a wider look at the same card.
ok(
  clicked.winner && clicked.winner.trim() && clicked.winner.trim() !== 'undefined',
  `the winner card names the species (${JSON.stringify((clicked.winner || '').replace(/\s+/g, ' ').trim())})`
);
/* THE CHROME IS KILLED ON THE EXIT PATH TOO, and that is not tidiness — it is what keeps
 * the next run's `--remote-debugging-port` free and what makes the profile removal above safe.
 * A headless Chrome left running holds its debugging port, so an orphan is a port
 * collision waiting for the next run: the new browser cannot bind, and the checker
 * fetches `/json/list` from the ORPHAN — driving a browser whose profile directory this
 * process already deleted under it. `exit` covers a normal return, a `process.exit()` and
 * an uncaught throw, which is everything except a signal, so SIGINT and SIGTERM are
 * mapped to the same path. SIGKILL cannot be caught at all, which is the honest limit. */
const stopChrome = () => { try { chrome.kill(); } catch {} };
process.on('exit', stopChrome);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopChrome(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

ok(!/undefined/.test(clicked.links),
  `and neither link carries an undefined value (${clicked.links})`);
ok(
  /^detail\.html\?slug=[a-z0-9-]+$/.test((clicked.links.match(/detail\.html\?slug=[^\s|]+/) || [''])[0]),
  `the detail link is a real slug, built by pokemonDetailUrl rather than by hand (${clicked.links})`
);
ok(
  /^color\.html\?slug=[a-z0-9-]+$/.test((clicked.links.match(/color\.html\?slug=[^\s|]+/) || [''])[0]),
  'and the palette link is the canonical paletteUrl shape'
);
// `types_zh` is the Traditional Chinese list; `types` is the upstream English.
ok(
  !/\b(Grass|Poison|Water|Fire|Electric|Ice|Flying|Ground|Rock)\b/.test(clicked.types || ''),
  `the type line is zh-TW, not the upstream English (${(clicked.types || '').replace(/\s+/g, ' ').trim()})`
);
ok(clicked.palette.length === 6, `six colours come out of one click (${clicked.palette.length})`);
ok(/^#[0-9a-f]{6}$/.test(clicked.palette[0] || ''), `and they are hexes (${clicked.palette[0]})`);
ok(clicked.scores.length === 4, `four numbers are shown: score, both directions, and the primary (${clicked.scores.length})`);
ok(/^\d+\.\d{4}$/.test(clicked.scores[0] || ''), `the distance is to four decimals (${clicked.scores[0]})`);

// The palette must be blue-dominant, because the click was on the blue field.
// This is the end-to-end claim: click → disc → outlier rejection → MMCQ → six
// colours, and it can only be true if every one of those stages is wired to the
// one before it.
const blue = clicked.palette.filter((h) => {
  const r = parseInt(h.slice(1, 3), 16), b = parseInt(h.slice(5, 7), 16);
  return b > r;
});
ok(clicked.palette.length === 6 && blue.length >= 5,
  `the palette is dominated by the field that was clicked (${blue.length}/6 blue-ish: ${clicked.palette.join(' ')})`);
// And the shares are shares, not a partition: they sum under 100.
const shareSum = clicked.sum;
ok(shareSum < 100.0001,
  `the reported shares sum to ${shareSum.toFixed(2)}%, under 100 — a palette is a sample, and over 100 would mean region sizes were reported instead of global frequencies`);

// The sprite must be a real 475px artwork and must be in its own grid track.
const spriteSrc = await ev(`document.getElementById('of-partner-img').getAttribute('src')`);
ok(/^assets\/images\/pokemon\/\d+\.png$/.test(spriteSrc || ''),
  `the sprite is the 475px artwork, not the 96px floor (${spriteSrc})`);
const track = await ev(`(() => {
  const stage = document.querySelector('.of-stage');
  const photo = document.querySelector('.of-photo').getBoundingClientRect();
  const part = document.getElementById('of-partner').getBoundingClientRect();
  return { cols: getComputedStyle(stage).gridTemplateColumns, overlap: part.left < photo.right - 1,
           photoW: Math.round(photo.width), partW: Math.round(part.width) };
})()`);
ok(!track.overlap,
  `the sprite's track does not overlap the photo, so it cannot cover the reader (${track.cols}, ${track.partW}px beside ${track.photoW}px)`);

// The photo must be a REASONABLE size and the sprite must be NEAR it. Both were
// wrong at once: an uncapped `minmax(0, 1fr)` track gave a 384x512 working canvas
// a 1141x1521 display box, and the sprite — bottom-aligned against a 1521px row
// — ended up more than a thousand pixels from the person, which is the opposite
// of "standing beside you".
//
// The gap is the claim, not the absolute positions: it is what makes "beside"
// measurable. It is allowed to grow on narrow viewports, where the two stack
// instead, so it is asserted against the two columns being side by side at all.
const geometry = await ev(`(() => {
  const photo = document.querySelector('.of-photo').getBoundingClientRect();
  const part = document.getElementById('of-partner').getBoundingClientRect();
  const stacked = getComputedStyle(document.querySelector('.of-stage')).gridTemplateColumns.split(' ').length === 1;
  return {
    photoW: Math.round(photo.width), photoH: Math.round(photo.height),
    partW: Math.round(part.width),
    gap: Math.round(part.left - photo.right),
    stacked,
    footAligned: Math.abs(part.bottom - photo.bottom),
  };
})()`);
ok(geometry.stacked || geometry.photoW <= 560,
  `the photo is displayed at a sane width rather than filling the viewport (${geometry.photoW}px wide, ${geometry.photoH}px tall)`);
ok(geometry.stacked || geometry.gap < 600,
  `and the sprite stands beside it, not in the far corner (${geometry.gap}px away)`);
ok(geometry.stacked || geometry.footAligned <= 4,
  `with its feet level with the photo's bottom edge, which is what makes it read as standing (${geometry.footAligned}px off)`);

// --- the photo is actually VISIBLE -----------------------------------------
//
// The blank-photo bug: `shared.css` styles every `canvas` with an opaque
// `background-color: var(--bg-primary)`, and the marks overlay is an absolutely
// positioned canvas sitting directly on top of the photo. It therefore painted the
// page background over the picture.
//
// Every other assertion in this file passed while the page was blank, because the
// photo canvas really did hold the right pixels — `getImageData` returned them,
// the palette came out correct, and clicks landed where they should. A correct
// backing store with nothing on screen is the signature of an element painted over
// a working one, so the check has to be about COMPUTED STYLE, not about pixels.
const overlay = await ev(`(() => {
  const marks = document.getElementById('of-marks');
  const cs = getComputedStyle(marks);
  const photo = document.getElementById('of-canvas');
  const pr = photo.getBoundingClientRect();
  const mr = marks.getBoundingClientRect();
  return {
    background: cs.backgroundColor,
    shadow: cs.boxShadow,
    covers:
      mr.width >= pr.width - 1 && mr.height >= pr.height - 1
      && mr.left <= pr.left + 1 && mr.top <= pr.top + 1,
    transparent: cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent',
  };
})()`);
ok(overlay.transparent,
  `the marks overlay paints no background over the photo (${overlay.background}) — shared.css gives every canvas a background, and the overlay is a canvas`);
ok(overlay.shadow === 'none',
  `and no drop shadow either, which would draw a rectangle edge over the picture (${overlay.shadow})`);
ok(overlay.covers, 'the overlay does sit exactly over the photo, so the two assertions above are about the right element');

// And the photo canvas itself must hold the picture, by ALPHA rather than by
// "is it black" — a blank canvas is transparent.
const painted = await ev(`(() => {
  const c = document.getElementById('of-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0, colours = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    opaque++;
    if (i % 4000 === 0) colours.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
  }
  return { opaque, colours: colours.size, total: c.width * c.height };
})()`);
ok(painted.opaque === painted.total,
  `the photo canvas is fully painted, not transparent (${painted.opaque}/${painted.total} opaque)`);
ok(painted.colours > 1,
  `and carries more than one colour, so the decode really drew the image (${painted.colours} distinct)`);

// --- the marks canvas has ink ---------------------------------------------

const marks = await ev(`(() => {
  const c = document.getElementById('of-marks');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
  return { ink, w: c.width, h: c.height };
})()`);
// Counted by ALPHA, and the assertion can return false: a cleared canvas is
// transparent, so alpha is the only thing that separates "drew nothing" from
// "drew black". §3.G.
ok(marks.ink > 200,
  `the sampled pixels are drawn on the photo, so the reader can see what was measured (${marks.ink} inked of ${marks.w * marks.h})`);

// --- the ring is centred on the click, not on the disc's first pixel --------
//
// The ring is the ONLY fully-opaque mark on this canvas: the dots are
// rgba(255,226,150,0.85) and the footprint box is rgba(255,214,102,0.55),
// while the ring is solid #ffd666. So it can be isolated by colour and measured
// on its own — which is the whole difficulty, because the DASHED BOX is already
// centred on the disc, so a bounding box over all ink looks correct whichever
// way the ring is drawn and passes on the broken version.
//
// The bug guarded: kept[0], which discCoordinates hands back row-major, is the
// disc's top-left-most surviving pixel. The ring was drawn a full radius up and
// to the left of the click — 18 marks pixels off at a disc radius of 18.
const ring = await ev(`(async () => {
  // The ring is supposed to be the DISC's radius, so the module's own function is
  // the thing to compare against rather than a number written down here.
  const { discRadius } = await import('./assets/js/outfit-palette.js');
  const c = document.getElementById('of-marks');
  const photo = document.getElementById('of-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      // Solid #ffd666 = rgb(255,214,102). Anti-aliased rim pixels fall outside
      // this window and are ignored, which trims the box symmetrically.
      if (d[i] > 244 && d[i + 1] > 196 && d[i + 1] < 230 && d[i + 2] > 82 && d[i + 2] < 120 && d[i + 3] > 240) {
        n++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const pr = photo.getBoundingClientRect();
  return {
    n,
    centre: n ? [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)] : null,
    w: n ? maxX - minX : 0, h: n ? maxY - minY : 0,
    // Fractions, not client coordinates: loadFile() scrolls the workbench into
    // view after the click, so a client y captured then is stale by the time the
    // marks are read — measured 350px off before this.
    want: [Math.round(${clicked.clickFX} * c.width), Math.round(${clicked.clickFY} * c.height)],
    wantDiameter: 2 * discRadius(photo.width, photo.height),
  };
})()`);
ok(ring.n > 60,
  `the ring is drawn, and can be told from the dots and the footprint box by being the one opaque mark (${ring.n}px of solid #ffd666)`);
ok(ring.centre !== null
     && Math.abs(ring.centre[0] - ring.want[0]) <= 3
     && Math.abs(ring.centre[1] - ring.want[1]) <= 3,
  `and its centre is the click (ring at ${ring.centre}, click at ${ring.want}) — it was drawn on kept[0], the disc's top-left pixel, a full radius up and to the left`);
ok(ring.w > 0 && Math.abs(ring.w - ring.h) <= 3,
  `and it is round rather than an ellipse (${ring.w}x${ring.h}px) — which is what mixing sx and sy for the radius would produce`);
// Its radius is the DISC's, not a number of its own. Roundness does not catch a
// uniformly wrong radius — a 1.6x ring is still a circle, and it passed that check.
//
// The tolerance is 8px against a measured shortfall of 5, and the shortfall is
// structural rather than jitter: only fully-opaque core pixels are counted, so
// the stroke's anti-aliased rim (~1px a side) and the outermost blend are
// trimmed off both edges. Read as "within a stroke's width or two", not as a
// bound the ring has to sit inside.
ok(ring.w > 0 && Math.abs(ring.w - ring.wantDiameter) <= 8,
  `and its diameter is the disc's (${ring.w}px measured, ${ring.wantDiameter}px from discRadius; the 5px is the anti-aliased rim, which only opaque core pixels count), so the ring is the measurement footprint and not decoration`);

// --- a second click changes the question ----------------------------------

const second = await ev(`(async () => {
  const canvas = document.getElementById('of-canvas');
  const r = canvas.getBoundingClientRect();
  const x = r.left + r.width * 0.8;
  const y = r.top + r.height * 0.5;
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  for (let i = 0; i < 40; i++) {
    await new Promise(r2 => setTimeout(r2, 100));
    if (document.querySelectorAll('#of-modes [data-of-chip]').length > 1) break;
  }
  const chips = [...document.querySelectorAll('#of-modes [data-of-chip]')];
  return {
    chips: chips.map(b => ({ text: b.textContent.replace(/\\s+/g, ' ').trim(), on: b.classList.contains('is-on') })),
    eyebrow: (document.querySelector('.of-winner-eyebrow') || {}).textContent,
    palette: [...document.querySelectorAll('#of-palette .cp-cell-hex')].map(n => n.textContent),
  };
})()`);

ok(second.chips.length === 3,
  `two clicks give two garments plus a whole-outfit chip (${second.chips.map(c => c.text).join(' | ')})`);
ok(/整身穿搭/.test(second.chips[2] && second.chips[2].text), 'and the third chip is the whole outfit');
ok(second.chips[2] && second.chips[2].on, 'which is selected by default, because the page is named after the outfit');
ok(/整身穿搭/.test(second.eyebrow || ''),
  `and the card now says the answer is about the outfit (${second.eyebrow})`);
ok(JSON.stringify(second.palette) !== JSON.stringify(clicked.palette),
  `and the palette actually changed — adding the cream field is not a no-op (${second.palette.join(' ')} vs ${clicked.palette.join(' ')})`);

// The outfit palette must carry BOTH fields, since both were measured. That is
// what "equal pixels per disc" buys: without it all six colours come from the
// larger click and the second garment is invisible in the answer.
//
// The test is b > r versus r > b rather than a list of expected hexes. A list was
// the first attempt and it encoded the fixture's exact ramp output, so darkening
// the gradient one step made the correct answer look wrong — a test that pins the
// fixture instead of the property. The blue field always has more blue than red
// and the cream field always the reverse, across the whole ramp.
const blueish = second.palette.filter((h) => parseInt(h.slice(5, 7), 16) > parseInt(h.slice(1, 3), 16)).length;
const creamily = second.palette.filter((h) => parseInt(h.slice(1, 3), 16) > parseInt(h.slice(5, 7), 16)).length;
ok(blueish >= 1 && creamily >= 1,
  `the outfit palette carries both garments, not just the larger click (${blueish} blue, ${creamily} cream: ${second.palette.join(' ')})`);

// --- switching back to one garment ----------------------------------------

const switched = await ev(`(async () => {
  document.querySelector('#of-modes [data-of-chip="garment:0"]').click();
  await new Promise(r => setTimeout(r, 300));
  return {
    on: [...document.querySelectorAll('#of-modes [data-of-chip]')].filter(b => b.classList.contains('is-on')).length,
    eyebrow: (document.querySelector('.of-winner-eyebrow') || {}).textContent,
    palette: [...document.querySelectorAll('#of-palette .cp-cell-hex')].map(n => n.textContent),
  };
})()`);
ok(switched.on === 1 && /單件衣物/.test(switched.eyebrow || ''),
  `a chip can send the page back to a single garment (${switched.eyebrow})`);
ok(JSON.stringify(switched.palette) === JSON.stringify(clicked.palette),
  'and the single-garment answer is the same one the first click gave, not a new number');

// --- the export reuses the shared generators -------------------------------

const exp = await ev(`(() => {
  const code = document.getElementById('of-code').textContent;
  return {
    has: code.includes('--color-background') && code.includes('@theme inline'),
    len: code.length,
    buttons: document.querySelectorAll('#of-actions [data-of-fmt]').length,
  };
})()`);
ok(exp.has && exp.len > 400,
  `the Tailwind v4 export is real and complete (${exp.len} chars)`);
ok(exp.buttons === 3, `all three formats are offered (${exp.buttons})`);

const json = await ev(`(async () => {
  document.querySelector('#of-actions [data-of-fmt="json"]').click();
  await new Promise(r => setTimeout(r, 200));
  const text = document.getElementById('of-code').textContent;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  return { parsed: !!parsed, keys: parsed ? Object.keys(parsed).length : 0 };
})()`);
// Five top-level keys is the correct shape — name, generatedBy, palette, light,
// dark — so the count is pinned rather than loosened to `> 0`, which would pass
// on an empty object.
ok(json.parsed && json.keys === 5, `the JSON format parses into the five expected top-level keys (${json.keys})`);

// --- the studio dock's disclosure -------------------------------------------
//
// **THE PHOTO STUDIO WAS ENTIRELY UNCHECKED until this block existed.**
// `rg -n "studio|of-tab|companion" scripts/` returned nothing at all: no
// assertion in this file or any other touched `switchMode()`, the dock, the
// sticker or the mode tabs, so the second half of this page shipped unverified
// through a suite of 45 checks. It is now on disk as a disclosure, which is the
// change most likely to make a control unreachable, so it is checked for
// reachability in BOTH states rather than for the CSS that hides it.
//
// The measurement that motivated it, at 390x844: the dock was 310px tall — 36.7%
// of the viewport — and covered 19.6% of the photo, permanently. The reader
// could not see the garment they were clicking or the companion's feet. The bar
// is now a ~57px summary strip, so the ceiling below is 90px: high enough for the
// header row at any locale, low enough that it cannot be the old 310.
const dock = await ev(`(async () => {
  document.getElementById('of-tab-photo').click();
  await new Promise(r => setTimeout(r, 250));
  const bar = document.getElementById('of-studio-bar');
  const toggle = document.getElementById('of-studio-toggle');
  const sheet = document.getElementById('of-studio-sheet');
  const dl = document.getElementById('of-download-photo-btn');
  const r = bar.getBoundingClientRect();
  return {
    shown: !bar.hidden,
    barH: Math.round(r.height),
    hasToggle: !!toggle,
    // The SHEET's own display, not the select's: a child of a display:none
    // parent still computes its own display as block, so reading the control
    // reports it visible in both states and the assertion can never fail.
    sheetDisplay: getComputedStyle(sheet).display,
    toggleDisplay: getComputedStyle(toggle).display,
    expanded: toggle.getAttribute('aria-expanded'),
    downloadVisible: getComputedStyle(dl).display !== 'none',
    summary: document.getElementById('of-studio-toggle-text').textContent.trim(),
    sheetExists: !!sheet,
  };
})()`);
ok(dock.shown, 'entering photo mode shows the studio dock');
ok(dock.hasToggle && dock.sheetExists,
  'the dock is a disclosure with a real target, not a label over nothing');
ok(dock.downloadVisible,
  'the primary action is reachable without expanding the disclosure — it is in the header row, not the sheet');
ok(dock.sheetDisplay === 'none',
  `and the controls are collapsed by default here, so the dock is a summary strip rather than a wall (${dock.barH}px)`);
ok(dock.barH <= 90,
  `the collapsed dock is short enough to leave the photo alone (${dock.barH}px, was 310px and 36.7% of a 844px viewport)`);
ok(/·/.test(dock.summary) && dock.summary.length > 3,
  `the collapsed strip states the two numbers its hidden controls would have shown (${dock.summary})`);

const opened = await ev(`(async () => {
  document.getElementById('of-studio-toggle').click();
  await new Promise(r => setTimeout(r, 150));
  const before = document.getElementById('of-companion-scale').value;
  document.getElementById('of-companion-scale').value = '140';
  document.getElementById('of-companion-scale').dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  return {
    expanded: document.getElementById('of-studio-toggle').getAttribute('aria-expanded'),
    sheetDisplay: getComputedStyle(document.getElementById('of-studio-sheet')).display,
    before, after: document.getElementById('of-companion-scale').value,
    stickerW: parseFloat(document.getElementById('of-companion-sticker').style.width),
    readout: document.getElementById('of-scale-val').textContent,
  };
})()`);
ok(opened.expanded === 'true' && opened.sheetDisplay !== 'none',
  'expanding the disclosure reveals the controls it stands for');
ok(opened.after !== opened.before && opened.readout === '140%',
  `and the scale slider still drives the sticker from inside the sheet (${opened.before}% -> ${opened.after}%, readout ${opened.readout}, sticker ${opened.stickerW}px)`);

// And the wide layout is the other half of the contract: the toggle must not
// merely be invisible there, it must be out of the tab order, or a keyboard user
// lands on a control whose effect is already applied. The viewport is resized
// rather than the CSS re-read, because "display:none at 900px" and "no
// `display:none` in the stylesheet" are the same claim and only one of them is
// what a reader meets.
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
const wide = await ev(`(async () => {
  await new Promise(r => setTimeout(r, 300));
  const toggle = document.getElementById('of-studio-toggle');
  const sel = document.getElementById('of-companion-select');
  return {
    toggleDisplay: getComputedStyle(toggle).display,
    sheetDisplay: getComputedStyle(document.getElementById('of-studio-sheet')).display,
    // An element inside a display:none subtree is not focusable, so this is the
    // property the claim is actually about rather than the declaration.
    focusable: sel.getBoundingClientRect().width > 0,
    aria: toggle.getAttribute('aria-expanded'),
  };
})()`);
ok(wide.toggleDisplay === 'none',
  'the disclosure control is out of the layout on a wide screen, not merely hidden');
ok(wide.sheetDisplay !== 'none' && wide.focusable,
  'and the dock is simply open there — the same markup, no second state to keep in sync');
await send('Emulation.clearDeviceMetricsOverride');

// --- the COPY itself ---------------------------------------------------------
//
// Nothing above reads a single string on this page: the suite checks
// `.of-winner-{name,id,eyebrow,scores,links}` and the DOM, and a rewrite of the
// lead paragraph or the privacy note would leave all 71 checks green having
// verified nothing about it. These two are aimed at the likeliest way this copy
// breaks: a paste from an external suggestion, which arrived here carrying
// hallucinated [cite] markers and a bare ampersand.
//
// **OFF THE DISK, not off the page — and that is the whole point.** The first
// version of the ampersand guard read `el.outerHTML`, which cannot fail: the
// HTML serialiser escapes a text-node `&` back to `&amp;`, so a file that had
// said `& 取樣測色` and a file that said `&amp; 取樣測色` serialise identically.
// The mutation to the bare form passed. `textContent` is no better — it decodes
// both to the same character. Only the source can tell them apart, so this
// reads the file, which also makes it the first thing in this checker to open a
// repo file at all. That is why `check_all.mjs` keeps its `manual: true` rather
// than dropping it: the inputs list still describes a page arriving over HTTP,
// and one read does not make that recording verifiable.
const copySrc = readFileSync(new URL('../outfit.html', import.meta.url), 'utf8');
// Up to the inline module, NOT to `</body>`: the module script lives inside
// `<body>`, so slicing to the end counted every `&&` in the JavaScript as a
// markup error — 47 of them, none of them real.
const BODY = copySrc.slice(copySrc.indexOf('<body>'), copySrc.indexOf('<script type="module">'));
const bare = (BODY.match(/&(?!amp;|lt;|gt;|quot;|#\d|#x[a-f0-9])/g) || []);
ok(bare.length === 0,
  `no unescaped ampersand in the markup — "&amp; " is required, and a bare one parses only because browsers forgive it (${bare.length} found: ${bare.slice(0, 3).join(' ') || 'none'})`);
ok(!BODY.includes('[cite') && !BODY.includes('shared[cite'),
  'no citation artefact left in the file — those come from pasting an external suggestion verbatim');

// --- the winner's OWN palette, as the five-colour strip -----------------------
//
// Section 四 shows what was measured off the READER's outfit; this strip shows
// the six colours measured off the matched SPRITE. Both are six colours in the
// same component, which is exactly why the strip is easy to wire to the wrong one
// silently — so the assertion is identity, not shape: the first segment must
// equal the hex already printed in the 「寶可夢的主色」 tile on the same card.
const strip = await ev(`(() => {
  const segs = [...document.querySelectorAll('.of-winner-strip .cp-seg')];
  const bar = document.querySelector('.of-winner-strip .cp-strip');
  const img = document.querySelector('.of-winner-img');
  const dts = [...document.querySelectorAll('.of-winner-scores dt')];
  const primaryTile = [...document.querySelectorAll('.of-winner-scores > div')]
    .find(d => d.querySelector('dt').textContent.trim() === '寶可夢的主色');
  // Hexes off each segment's own title attribute, which paletteStripHtml()
  // writes as "HEX · share" — so this compares what the component CLAIMS it drew
  // against the tile the matcher computed, with no colour parsing between them.
  // Reached for after parsing the inline background instead, which came back
  // null: this lives in a template literal, so a backslash-d in the class
  // arrives as a literal "d". (No backticks in these comments either — one ends
  // the literal. Both halves of the same trap, hit several times today.)
  const segHexes = segs.map(s => {
    const m = (s.getAttribute('title') || '').match(/#[0-9A-Fa-f]{6}/);
    return m ? m[0].toUpperCase() : null;
  });
  const ident = document.querySelector('.of-winner-ident');
  const fig = document.querySelector('.of-winner-fig');
  const main = document.querySelector('.of-winner-main');
  const card = document.querySelector('.of-winner-card');
  const fb = fig ? fig.getBoundingClientRect() : null;
  const ib = ident ? ident.getBoundingClientRect() : null;
  return {
    segs: segs.length,
    segHexes,
    aria: bar ? bar.getAttribute('aria-label') : null,
    moreDisplay: (() => { const m = document.querySelector('.of-winner-strip .cp-seg-more');
      return m ? getComputedStyle(m).display : 'absent'; })(),
    hexLabels: (() => { const h = document.querySelector('.of-winner-strip .cp-seg-hex');
      return h ? getComputedStyle(h).display : 'absent'; })(),
    primary: primaryTile ? (primaryTile.querySelector('dd').textContent.trim().match(/#[0-9a-f]{6}/i) || [null])[0].toUpperCase() : null,
    labels: dts.map(d => d.textContent.trim()),
    imgSrc: img ? img.getAttribute('src') : null,
    imgDecoded: img ? img.naturalWidth > 0 : false,
    imgW: img ? Math.round(img.getBoundingClientRect().width) : 0,
    figRightOfName: !!(fig && ident) && fig.getBoundingClientRect().left > ident.getBoundingClientRect().left,
    // Not a distance between the two: that is definitionally the flex gap and
    // can never exceed it, so asserting on it passes at 456px and 1040px alike.
    // What differs is the MECHANISM — and it is a grid now, since
    // .of-winner-main carries the two columns itself, and flex-grow on a grid
    // item reads as a real number while meaning nothing.
    mainCols: main ? getComputedStyle(main).gridTemplateColumns : null,
    figColStart: fig ? getComputedStyle(fig).gridColumnStart : null,
    cardInnerW: card ? Math.round(card.getBoundingClientRect().width) : null,
  };
})()`);
ok(strip.segs === 5 && /主要 5 色/.test(strip.aria || ''),
  `the winner card wears a five-colour strip that says so out loud (${strip.segs} segments, aria "${strip.aria}") — the sixth is not silently implied`);
ok(strip.segs === 5 && strip.primary !== null && strip.segHexes[0] === strip.primary,
  `and its first segment is the MATCHED species' primary, cross-checked against the hex printed in the same card (${strip.segHexes[0]} vs ${strip.primary}) — not the reader's own palette, which is also six colours`);
ok(strip.moreDisplay === 'none' && strip.hexLabels === 'none',
  `the "+1" chip and per-segment hexes are dropped rather than shrunk to illegible digits (${strip.moreDisplay} / ${strip.hexLabels}), with the count carried by the aria-label instead`);
// `of-winner-img`, not `-sprite`: artworkUrl is the 475px official artwork and
// spriteUrl is the 96px front sprite the workbench uses. The class used to say
// sprite while loading artwork, and the old name is what invited the pixelated
// rendering this no longer carries.
ok(/^assets\/images\/pokemon\/\d+\.png$/.test(strip.imgSrc || '') && strip.imgDecoded,
  `the portrait beside it is the 475px artwork and it decoded (${strip.imgSrc})`);
ok(strip.imgW >= 160,
  `and it is displayed at a size worth calling a portrait rather than a marker (${strip.imgW}px; was 84px, capped by sharing a row with the name)`);
ok(strip.mainCols !== null && strip.mainCols.split(' ').length === 2,
  `the card body is two columns, reading left and portrait right (${strip.mainCols})`);
ok(strip.figColStart === '2' && strip.figRightOfName,
  'and the figure is in the RIGHT one — column 2, spanning the rows, to the right of the name');
ok(strip.cardInnerW !== null && strip.imgW / strip.cardInnerW <= 0.35,
  `and the portrait takes no more than a third of the card (${strip.imgW} of ${strip.cardInnerW}px, ${Math.round(strip.imgW / strip.cardInnerW * 100)}%)`);
ok(strip.labels.length === 4 && strip.labels[1] === '穿搭 → 寶可夢' && strip.labels[2] === '寶可夢 → 穿搭',
  `the score tiles keep 寶可夢 rather than 牠 in both directions (${strip.labels.slice(1, 3).join(' | ')})`);

// --- the swap list: a region that MOVED, so nothing was watching it ----------
//
// `rg -n "candidate" scripts/check_outfit_browser.mjs` returned nothing before
// this block. The list used to be gated by `#of-result`'s `hidden`, and now it
// is a separate container inside the workbench with its own gate — so a missed
// write on either early-return path in `render()` would leave the PREVIOUS
// click's four cards on screen, and every other check in this file would still
// pass. It is asserted by identity, not by shape: the winner's name must be
// ABSENT from the list, and the selected card must be the species the sticker is
// actually showing.
const swap = await ev(`(() => {
  const block = document.getElementById('of-swap');
  const cards = [...document.querySelectorAll('#of-candidates .of-candidate')];
  const winnerName = (document.querySelector('.of-winner-name') || {}).textContent || '';
  const stickerAlt = (document.getElementById('of-companion-sticker-img') || {}).alt || '';
  return {
    exists: !!block,
    // Membership, not a class: a second COPY of the container with no cards in
    // it is exactly the shape a "no .of-candidate in the readout" check misses,
    // because the thing being forbidden is the container, not its children.
    inWorkbench: !!document.getElementById('of-candidates')
      && !!document.getElementById('of-work').querySelector('#of-candidates'),
    inReadout: !!document.querySelector('.of-readout #of-candidates'),
    count: cards.length,
    heading: (document.querySelector('.of-swap-title') || {}).textContent || '',
    winnerAbsent: !cards.some((c) => (c.textContent || '').includes(winnerName.trim())),
    currentCount: cards.filter((c) => c.getAttribute('aria-current') === 'true').length,
    currentName: (cards.find((c) => c.getAttribute('aria-current') === 'true') || {}).textContent || '',
    stickerAlt,
    poseButtons: cards.filter((c) => c.querySelector('[data-pose-id]')).length,
  };
})()`);
ok(swap.exists && swap.count === 4,
  `the swap list holds exactly the four runners-up (${swap.count} cards under 「${swap.heading}」)`);
ok(swap.winnerAbsent,
  `and the winner is not among them — it has its own card above, not a duplicate here`);
ok(swap.poseButtons === 4,
  `every card can still be swapped into the photo (${swap.poseButtons}/4 carry 合照)`);
ok(swap.inWorkbench && !swap.inReadout,
  'and the list lives in the workbench, with no second copy left behind in the readout');
// The one that catches a stale list: a card marked current must be the species the
// sticker is showing, so a leftover from the previous click cannot pass as one.
ok(swap.currentCount <= 1 && (!swap.stickerAlt || swap.stickerAlt.split(' ')[0] === swap.currentName.trim().split('\n')[0] || swap.currentCount === 0),
  `at most one card claims to be in the photo, and it is the one there (${swap.currentCount} marked, sticker "${swap.stickerAlt}")`);

// And the swap itself, including the scroll target — which was `els.work` while
// the list sat BELOW the workbench and became wrong the moment it moved inside.
const swapped = await ev(`(async () => {
  const cards = [...document.querySelectorAll('#of-candidates .of-candidate')];
  const target = cards[cards.length - 1].querySelector('[data-pose-id]');
  const wanted = Number(target.dataset.poseId);
  const before = document.getElementById('of-canvas').getBoundingClientRect().top;
  target.click();
  await new Promise(r => setTimeout(r, 700));
  const after = document.getElementById('of-canvas').getBoundingClientRect().top;
  return {
    wanted,
    stickerSrc: document.getElementById('of-companion-sticker-img').getAttribute('src'),
    // Split rather than a regex, for two reasons. A backslash-d written here is
    // a template-literal escape, so the browser sees a literal "d" and the regex
    // silently stops matching digits — a working button reports as broken. And a
    // backtick in this comment would end the template literal outright, which is
    // AGENTS.md's nested-backtick trap and presents as 25 mislabelled verdicts
    // rather than one broken file.
    stickerId: (document.getElementById('of-companion-sticker-img').getAttribute('src') || '')
      .split('/').pop().split('.')[0],
    tagName: (document.getElementById('of-companion-tag-name') || {}).textContent || '',
    marked: [...document.querySelectorAll('#of-candidates .of-candidate')]
      .filter(c => c.getAttribute('aria-current') === 'true')
      .map(c => (c.querySelector('[data-pose-id]') || {}).dataset?.poseId),
    scrollBefore: Math.round(before), scrollAfter: Math.round(after),
    photoTop: Math.round(document.getElementById('of-photo').getBoundingClientRect().top),
    viewportH: innerHeight,
    photoVisible: document.getElementById('of-photo').getBoundingClientRect().top < innerHeight,
  };
})()`);
// `src` is a path, so the comparison is on the id inside it — comparing the two
// strings whole is a mismatch that reports a working button as broken.
ok(String(swapped.wanted) === swapped.stickerId,
  `pressing 合照 puts that species in the photo (${swapped.tagName}, ${swapped.stickerSrc})`);
ok(swapped.marked.length === 1 && String(swapped.wanted) === swapped.marked[0],
  `and the highlight moves to it, so the state is a companion and not just a winner (marked: ${swapped.marked.join(',')})`);
// The claim is that the photo ends up where the reader can act on it — near the
// top, and BELOW the sticky header rather than under it. "It scrolled" alone
// would be satisfied by scrolling in exactly the wrong direction, which is what
// the old `els.work` target did: it moved the reader to the top of the workbench,
// away from the photo, and any assertion phrased as "the scroll position
// changed" would have passed it.
ok(swapped.photoTop >= 40 && swapped.photoTop < 140,
  `and the view lands on the photo, clear of the sticky header rather than under it (photo top ${swapped.photoTop}px in a ${swapped.viewportH}px viewport; canvas top went ${swapped.scrollBefore} -> ${swapped.scrollAfter})`);

// The initial `is-on` is invisible to the check above, and deliberately so: at
// boot the companion IS the winner, and the winner is not in this list, so the
// correct state is that NOTHING here is marked. A mutation that swapped the
// expression for the old `currentWinner` comparison would therefore also render
// nothing marked — and pass.
//
// It becomes observable on the NEXT re-render, because `companionState.pokemonId`
// survives one: choose a runner-up, then sample again, and the card for the
// chosen species must still be marked. That is also the stale-state case — a
// render that ignored the choice would leave the highlight on the old card.
// **Re-select the SAME garment chip, not a third sample on the canvas.** Both
// call render(), and only the first leaves the palette alone — so the top five
// is byte-identical and the chosen companion is guaranteed to still be in it.
// A new sample re-ranks, the chosen species drops out of the top five, and the
// correct answer becomes "nothing marked" — which is what let two mutations
// through: they also mark nothing, and mark nothing was legal.
//
// The first version of this clicked the canvas while still in PHOTO mode, where
// the companion layer covers it with inset:0 and swallows the click as the
// placement target. The chip count never moved and the assertion read state the
// previous step had already left behind.
const rerendered = await ev(`(async () => {
  document.getElementById('of-tab-sample').click();
  await new Promise(r => setTimeout(r, 200));
  const chosen = (document.getElementById('of-companion-sticker-img').getAttribute('src') || '')
    .split('/').pop().split('.')[0];
  const listed = () => [...document.querySelectorAll('#of-candidates .of-candidate')]
    .map(c => (c.querySelector('[data-pose-id]') || {}).dataset?.poseId);
  const marked = () => [...document.querySelectorAll('#of-candidates .of-candidate')]
    .filter(c => c.getAttribute('aria-current') === 'true')
    .map(c => (c.querySelector('[data-pose-id]') || {}).dataset?.poseId);
  const before = { listed: listed(), marked: marked() };

  document.querySelector('#of-modes [data-of-chip="garment:0"]').click();
  await new Promise(r => setTimeout(r, 600));
  return { chosen, before, after: { listed: listed(), marked: marked() } };
})()`);
ok(rerendered.chosen !== '' && rerendered.after.listed.length === 4
     && JSON.stringify(rerendered.after.listed) === JSON.stringify(rerendered.before.listed),
  `re-selecting a chip re-rendered the list without re-ranking it (companion ${rerendered.chosen}, list unchanged: ${rerendered.after.listed.join(',')})`);
// Now unconditional, and it can be: the precondition above guarantees the list
// did not change, so the chosen species IS in it and exactly one card must say
// so. This is the assertion that catches a render() that ignores the pick — the
// old `currentWinner` comparison marks nothing at all here, and a nothing-marked
// list is only legal when the companion is genuinely absent from it.
ok(rerendered.after.marked.length === 1
     && rerendered.after.marked[0] === rerendered.chosen,
  `and after the re-render exactly the chosen companion is still marked — a render that ignores the pick leaves the highlight on the old card, or on none (companion ${rerendered.chosen}, marked ${rerendered.after.marked.join(',') || 'none'})`);

// `render()` writes the readout's `hidden` on every path that stops it showing,
// and the swap block moved out of the readout's gate — so every one of those
// writes has to be accompanied by one for the swap block, or a stale list from
// the previous click stays on screen.
//
// Two of the paths are exercised above. The third — a selection that measured
// nothing — cannot be reached through this fixture: every pixel of it is opaque
// and chromatic by construction, so `pixelsFor()` is never empty and the branch
// never runs. That makes a behavioural check impossible rather than merely
// absent, and it is the one place a source check is the honest detector.
//
// **Positional, not a count.** A count is blind here in both directions:
// dropping one swap write leaves two against two, which satisfies any `>=` a
// third of them does not. So this asks the narrower question — does every write
// that hides the readout have a partner within a few lines — and it FAILS LOOSE
// if the slice came out empty. The first version of this check passed with
// `0 writes, 0 exits` on a marker that had not moved, because
// `renderMarks` is DEFINED ABOVE `render()`, so the slice ran backwards and
// compared an empty string against itself. Asserting a floor on the number of
// occurrences is what turns that back into a red line.
const gate = await ev(`(() => {
  const src = document.querySelector('script[type=module]').textContent;
  const from = src.indexOf('function render() {');
  // To the NEXT top-level function after it. Anchoring on a function named in
  // prose is how the first version ended up slicing backwards.
  const rest = from >= 0 ? src.slice(from) : '';
  const to = rest.search(/\\n {4}function /);
  const body = to > 0 ? rest.slice(0, to) : '';
  const hits = (needle) => {
    const out = []; let i = 0;
    while ((i = body.indexOf(needle, i)) !== -1) { out.push(i); i += needle.length; }
    return out;
  };
  const resultAt = hits('els.result.hidden');
  const swapAt = hits('els.swap.hidden');
  return {
    bodyLen: body.length,
    resultAt, swapAt,
    partnered: resultAt.map((i) => swapAt.some((j) => Math.abs(j - i) < 260)),
  };
})()`);
ok(gate.bodyLen > 400 && gate.resultAt.length >= 2 && gate.swapAt.length >= 2,
  `the render() gate check found the function it is about (${gate.bodyLen} chars, ${gate.resultAt.length} readout writes, ${gate.swapAt.length} swap writes) — an empty slice must not compare equal to itself`);
ok(gate.partnered.length > 0 && gate.partnered.every(Boolean),
  `every write that hides the readout also hides the swap block (${gate.resultAt.length} readout writes, ${gate.swapAt.length} swap writes, unpartnered: ${gate.resultAt.length - gate.partnered.filter(Boolean).length}) — the other two paths are covered above; this one cannot be reached through a fixture whose every pixel is opaque`);

// --- the ink on the accent, in BOTH themes ----------------------------------
//
// `.of-roadmap-num`, `.of-btn-pose:hover` and the export button all put
// `var(--on-accent)` on `var(--accent-gold)`. They used to put a hardcoded
// `#111` there, which measured 2.7:1 in the light theme — where `--accent-gold`
// is Poké Ball red — on the digit that tells the reader which of the three
// steps they are on.
//
// **The ratios are measured, not read from the declaration**, because the two
// tokens are defined in different `:root` blocks: a static read pairs dark's
// ink with light's gold and produces a number that describes neither theme.
const ratioOf = `
  const lum = (c) => { const m = c.slice(c.indexOf('(') + 1, c.indexOf(')')).split(',').map(Number);
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };`;
// The fill is READ OFF THE ELEMENT, not from `--accent-gold`: the download
// button paints with `color-mix(...)`, whose computed backgroundColor is the
// mixed colour, so asking the element is both simpler and the thing a reader
// actually sees. Only the ink is taken from a token, because that is the value
// under test.
const inkOf = `(sel) => { const cs = getComputedStyle(document.querySelector(sel));
  return { fg: cs.color, fill: cs.backgroundColor, r: +ratio(cs.color, cs.backgroundColor).toFixed(2) }; }`;

const darkInk = await ev(`(() => { ${ratioOf}
  const digits = (${inkOf})('.of-roadmap-num');
  const dl = (${inkOf})('.of-btn-export-photo');
  return { digits, dl };
})()`);
ok(darkInk.digits.r >= 4.5 && darkInk.dl.r >= 4.5,
  `the accent ink passes AA on the accent fill in dark (digits ${darkInk.digits.r}:1, primary action ${darkInk.dl.r}:1)`);

await ev(`document.querySelector('.theme-toggle').click()`);
await new Promise((r) => setTimeout(r, 400));
const lightInk = await ev(`(() => { ${ratioOf}
  return { digits: (${inkOf})('.of-roadmap-num'), dl: (${inkOf})('.of-btn-export-photo') };
})()`);
ok(lightInk.digits.r >= 4.5 && lightInk.dl.r >= 4.5,
  `and in light, where the accent is a deep red rather than gold — this is the case a hardcoded #111 failed at 2.7:1 (digits ${lightInk.digits.r}:1, primary action ${lightInk.dl.r}:1)`);
await ev(`document.querySelector('.theme-toggle').click()`);
await new Promise((r) => setTimeout(r, 400));

// --- final state -----------------------------------------------------------

ok(logs.length === 0, `still no exception after the whole flow${logs.length ? ` — ${logs[0]}` : ''}`);
console.log('');
if (fails.length) {
  console.log(`${fails.length} of ${pass + fails.length} browser checks failed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  if (logs.length) console.log(`\nconsole:\n  ${logs.join('\n  ')}`);
  cleanup();
  process.exit(1);
}
console.log(`all ${pass} browser checks passed`);
cleanup();
process.exit(0);