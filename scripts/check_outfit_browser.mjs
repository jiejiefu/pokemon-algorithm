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
import { mkdtempSync, rmSync } from 'node:fs';
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

// --- click the left field --------------------------------------------------

const clicked = await ev(`(async () => {
  const canvas = document.getElementById('of-canvas');
  const r = canvas.getBoundingClientRect();
  // Left field, comfortably away from the seam at the horizontal midpoint.
  const x = r.left + r.width * 0.2;
  const y = r.top + r.height * 0.5;
  canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  for (let i = 0; i < 40; i++) {
    await new Promise(r2 => setTimeout(r2, 100));
    if (document.getElementById('of-result').hidden === false) break;
  }
  const chips = [...document.querySelectorAll('#of-modes [data-of-chip]')];
  return {
    resultShown: document.getElementById('of-result').hidden === false,
    chips: chips.map(b => ({ text: b.textContent.replace(/\\s+/g, ' ').trim(), on: b.classList.contains('is-on') })),
    winner: (document.querySelector('.of-winner-name') || {}).textContent,
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