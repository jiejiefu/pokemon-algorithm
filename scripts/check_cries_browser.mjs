#!/usr/bin/env node
/**
 * Browser checks for cries.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_cries_browser.mjs      (needs the repo served on :5500)
 *
 * What is verified here is only what a static checker cannot see: that the page
 * mounts, that the grid pages in, that selecting a card puts ink on the probe
 * waveform, and that pressing play reaches the shared player without throwing.
 * The claims cries.html makes ABOUT its data are checked in check_cries_page.mjs;
 * the cry audio itself is checked in check_cry_index.mjs and check_cry_features.mjs.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTE_TAP, TAP_PROBE } from './lib/mute-tap.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=mkdtempSync(join(tmpdir(),'cr-'));
/* `--mute-audio`: this checker presses play too. Muted at the browser rather than
   by zeroing the page's volume, so the AudioContext still runs and the playback
   path is still exercised. The flag is the first line rather than the guarantee;
   the second is installed in the page, before any page script runs. See
   scripts/lib/mute-tap.mjs. */
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--mute-audio','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9370',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let targets; for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:9370/json/list'); if(r.ok){targets=await r.json();break;}}catch{} await new Promise(r=>setTimeout(r,250));}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const w=new Map(); const logs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);return;}
 if(m.method==='Runtime.exceptionThrown') logs.push('EXC '+(m.params.exceptionDetails.exception?.description||'').split('\n')[0]);});
const send=(m,p={})=>new Promise((res,rej)=>{const n=++id;w.set(n,x=>x.error?rej(new Error(JSON.stringify(x.error))):res(x.result));ws.send(JSON.stringify({id:n,method:m,params:p}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description||'').split('\n')[0]); return r.result.value;};

/** Poll a page expression until it is truthy. Returns whether it ever became so.
 *
 *  WHY NOT `await new Promise(r=>setTimeout(r,4000))`
 *
 *  This file was 18.6 s, and 15.8 s of that was eleven hardcoded sleeps — 85% of
 *  the runtime spent waiting rather than checking. The sorting checker was cut the
 *  same way once already, and §3.G4 records what it cost to leave them in: "two
 *  fixed `sleep(9000)` waits, and a readiness poll that matched the previous
 *  document." A fixed N is a guess about how long a page takes to settle, and a
 *  guess fails in BOTH directions — too long and every run pays for the worst case
 *  on the machine, too short and the next assertion fails spuriously under load
 *  and gets filed as a flake nobody investigates.
 *
 *  Two properties make this a strict improvement rather than a trade:
 *
 *  - TOLERANCE ONLY GOES UP. Every ceiling below is larger than the sleep it
 *    replaced, so no assertion can now fail that did not have a chance to before.
 *  - A TIMEOUT STILL FAILS THE REAL CHECK. `until` returns false and the
 *    assertion runs anyway and reports the number it actually measured. There is
 *    no supported way to skip a check here, and a page that never settles costs
 *    the ceiling and then a red line, not a hang.
 *
 *  `eval` errors are treated as "not ready yet" rather than propagated, because
 *  the only ones that occur are a destroyed execution context mid-navigation. */
async function until(expr, ceilingMs, step = 60) {
  const deadline = Date.now() + ceilingMs;
  for (;;) {
    let v;
    try { v = await ev(expr); } catch { v = false; }
    if (v) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(r => setTimeout(r, step));
  }
}

/** Wait for the current document to finish loading AND to have mounted something,
 *  which is what "the page is up" actually means. `readyState` alone is not enough:
 *  this site's pages fetch their data and build their DOM after load fires, so
 *  `complete` on its own is true while the grid is still empty. */
const booted = (extra = 'true') =>
  until(`document.readyState === 'complete' && (${extra})`, 20000);

/** The ink predicate, as a reusable string, so the wait and the measurement
 *  cannot drift apart. A wait that polls a DIFFERENT condition from the one the
 *  next line asserts is the classic way to make a check pass for the wrong
 *  reason — and at 60 ms steps over 8 s this runs a few hundred times, so a
 *  duplicated literal would be a real hazard rather than a tidy one. */
const inkOver = (n) => `(() => {
  const c = document.getElementById('probe-wave');
  if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) ink++;
  return ink > ${n};
})()`;

let pass=0; const fails=[];
const ok=(c,w)=>{ if(c) pass++; else fails.push(w); console.log(`  ${c?'ok  ':'FAIL'} ${w}`); };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:MUTE_TAP});
await send('Page.navigate',{url:`http://localhost:${process.env.CRY_PORT || 5500}/cries.html`});
/* Was: a fixed 4000 ms. The grid is built after load fires, so this waits for the
 * cards themselves rather than for a duration — and the ceiling is 20 s, five times
 * the sleep it replaces, so this can only ever finish sooner or wait longer. */
await booted('document.querySelectorAll("[data-play]").length > 0');
/* The grid pages in on scroll, so only the first batch is in the DOM. Asserting the
 * full 1,025 here would be asserting something about infinite scroll, not about cries. */
const cards = await ev('document.querySelectorAll("[data-play]").length');
ok(cards > 0 && cards <= 120, `the first page of cry cards is rendered (${cards} of 1,025, the rest load on scroll)`);
ok(await ev('!!document.getElementById("probe-wave")'), 'probe waveform present');

/* Ink on the probe canvas, counted over the WHOLE canvas rather than a few top
 * rows.
 *
 * The previous version counted "dark" pixels in the first four rows and asserted
 * `typeof drew === 'number'`, which is true of any value including undefined — it
 * could not fail. And it read RGB while ignoring alpha, so every UNTOUCHED pixel
 * (0,0,0,0) counted as dark: a canvas that had never been drawn to at all scored
 * a perfect 2,400. That is how a `const ctx` reassigned to the offscreen cache —
 * a TypeError on the third line of drawWave — passed as "probe waveform redrawn".
 *
 * `alpha > 0` is what makes this an assertion rather than a tally: a cleared
 * canvas is transparent, and a drawn one is not. `ink` is therefore the count of
 * pixels the waveform actually put down. */
/* Autoplay, on the same contract as the Generation I lab's: ON by default, silent
 * on load, and a click on a card sounds it. The observable is the page's own
 * `playingId` reaching the DOM through aria-pressed on the in-card control. */
const auto = await ev(`(() => {
  const sw = document.querySelector('#autoplay-slot [role="switch"]');
  return sw ? { role: sw.getAttribute('role'), on: sw.getAttribute('aria-checked'), text: sw.textContent.trim() } : null;
})()`);
ok(!!auto, 'the autoplay switch is in the timbre panel');
ok(auto?.role === 'switch', 'and it is a switch with a checked state');
ok(auto?.on === 'true', 'which is ON by default');
ok(/自動播放/.test(auto?.text || ''), 'and says so in its own label');

/* Selecting a card must not touch the probe's playback state on load — the page is
 * silent until a card is chosen, however loud the switch says it is. */
await ev(`document.querySelector('.cy-card[data-id="6"]').click(); 1`);
await until(`document.querySelector('[data-play="6"]')?.getAttribute('aria-pressed') === 'true'`, 6000);
ok(await ev(`document.querySelector('[data-play="6"]').getAttribute('aria-pressed') === 'true'`),
  'clicking a card plays it while the switch is on');

await ev(`document.querySelector('#autoplay-slot [role="switch"]').click(); 1`);
await until(`document.querySelector('[data-play="6"]')?.getAttribute('aria-pressed') === 'false'`, 6000);
ok(await ev(`document.querySelector('[data-play="6"]').getAttribute('aria-pressed') === 'false'`),
  'turning it off stops whatever is sounding');

await ev(`document.querySelector('.cy-card[data-id="7"]').click(); 1`);
await until(`document.querySelector('[data-play="7"]')?.getAttribute('aria-pressed') === 'false'`, 6000);
const switched = await ev(`(() => ({ playing: document.querySelector('[data-play="7"]').getAttribute('aria-pressed'), probe: document.getElementById('probe-name').textContent }))()`);
ok(switched.playing === 'false', 'and with it off a card click switches without playing');
ok(switched.probe.length > 0, 'while the panel still describes the newly selected cry');
await ev(`document.querySelector('#autoplay-slot [role="switch"]').click(); 1`);

const canvasInk = `
  (() => {
    const c = document.getElementById('probe-wave');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) ink++;
    return { ink, w: c.width, h: c.height };
  })()`;

/* Selecting the card is what triggers renderProbe() -> drawWave(). Playing alone
 * only redraws a cursor on a species already selected, so the waveform must be
 * measured after a SELECTION, not after a play. */
await ev(`document.querySelector('.cy-card[data-id="6"]').click()`);
/* Was: a fixed 1200 ms, then `ink > 500`. The naive poll — wait until `ink > 500` —
 * would be a REGRESSION here, and worth spelling out: the probe already carries
 * card 7's waveform at this point (it was selected two steps up and never cleared),
 * so `ink > 500` is true the instant this loop starts. Polling the assertion's own
 * condition would return in ~60 ms and the check would then be measuring card 7's
 * leftover pixels while reporting that card 6 drew.
 *
 * So the wait is on the thing that actually distinguishes the two: the probe's NAME
 * must have moved off card 7's, which `renderProbe()` sets on every selection, and
 * the canvas must carry ink. That is what "re-rendered for a different species"
 * is, and it is observable from the page rather than inferred from a duration. */
await until(`document.getElementById('probe-name')?.textContent !== ${JSON.stringify(switched.probe)} && ${inkOver(500)}`, 8000);
const drawn = await ev(canvasInk);
ok(drawn.ink > 500,
  `probe waveform is drawn when a species is selected (${drawn.ink} inked pixels of ${drawn.w * drawn.h})`);

await ev(`document.querySelector('[data-play="6"]').click()`);
/* Was 900 ms, and the observable that play has landed is the one the page already
 * exposes for exactly this: `aria-pressed` on the card's own control, which is what
 * the play cursor section below is built on. */
await until(`document.querySelector('[data-play="6"]')?.getAttribute('aria-pressed') === 'true'`, 6000);

/* The mute is a claim like any other, so it is asserted rather than assumed — the
   failure mode of a mute that quietly stopped working is a cry at a fifth of full
   scale and a green run, which is the worst pair available. Placed HERE, after a
   play, because the AudioContext is built lazily and a probe before that would be
   reading a tap that has not been asked to do anything yet. `gain` is read back off
   the live AudioParam, so this asks whether the output is muted NOW rather than
   whether the script once set a number. See scripts/lib/mute-tap.mjs. */
const tap = await ev(TAP_PROBE);
ok(tap.taps>0 && tap.gain===0,
  `playback is muted at the destination, measured (${tap.taps} AudioContext(s), gain ${tap.gain}${tap.error?`, ${tap.error}`:''})`);

const played = await ev(canvasInk);
ok(played.ink > 500,
  `and survives playback (${played.ink} inked pixels after play)`);

/* The played region of the probe waveform, in the Pokémon's own colour.
 *
 * This replaces a flat `rgba(0,0,0,0.55)` wash — the Generation I lab's device,
 * which reads as "already played" on a gold trace and as a dirty smear on a neutral
 * one. The observable is the COLOUR OF THE PLAYED REGION, measured against the
 * species' own `rgb` from pokemon_data.json rather than against a literal: a
 * hard-coded colour would pass the day someone picked a different Pokémon, and a
 * return to the dark wash would pass it too.
 *
 * Measured by WHERE the accent is, not by comparing two thirds of the canvas: at
 * the moment the loop stops, the played region is a sliver at the left, so a
 * "first third versus last third" mean compares two mostly-neutral bands and finds
 * nothing — which is what the first version of this check did. */
/* The predicate is built FROM this species' rgb rather than written out as channel
 * tests. It was, and it was written for a reddish accent — so on Charizard, whose
 * sprite average is a tan with green 138, a `g < 105` test excluded the exact colour
 * being looked for and the check reported the accent as absent while the pixels were
 * plainly there. */
const scanInPage = (want) => `(async () => {
  const want = ${JSON.stringify(want)};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const near = (d, i) => Math.abs(d[i] - want[0]) <= 70
    && Math.abs(d[i + 1] - want[1]) <= 70
    && Math.abs(d[i + 2] - want[2]) <= 70;
  const scan = () => {
    const c = document.getElementById('probe-wave');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const mid = Math.floor(c.height / 2);
    let n = 0, minX = c.width, maxX = -1, above = 0, below = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] < 10) continue;
      if (near(d, i)) {
        n++; if (x < minX) minX = x; if (x > maxX) maxX = x;
        /* Counted either side of the trace's own zero line. This is a peak
         * ENVELOPE: every sample is a vertical segment from its top to its bottom,
         * so a re-stroke that kept only the top endpoint draws the upper half of
         * every bar and nothing below it — which is not the same waveform in
         * another colour, it is half a waveform. */
        if (y < mid) above++; else below++;
      }
    }
    return { n, minX, maxX, above, below, w: c.width };
  };
  /* Everything here RE-QUERIES the button, and that is the whole fix.
   *
   * renderProbe() writes #probe-play's innerHTML on every play and every stop
   * (cries.html:496), so the node this script used to capture at its top is DETACHED
   * by the time it clicked — autoplay is ON by default (§3.G), so the cry that was
   * already sounding ended in the middle of the pre-click wait and replaced the
   * button underneath us. A detached node does not bubble to the delegated listener
   * on #probe-play (cries.html:812), so button.click() was a no-op: the 60 samples
   * after it read aria-pressed=false and zero accent pixels for 1.28 s, every time.
   *
   * Nothing noticed, because the measurement did not require playback. The scan
   * loop's first sample landed inside the *autoplay's* final frames, so the reported
   * maxX was wherever that unrelated playback happened to be — 669 to 696 across
   * runs, which is a 5%-wide band straddling the 95% threshold. That is the flake:
   * not a tolerance problem, a control problem.
   *
   * So: wait for a settled stop, press play, CONFIRM it took, and only then sample.
   */
  const q = () => document.querySelector('#probe-play [data-play]');
  const isPlaying = () => q().getAttribute('aria-pressed') === 'true';
  for (let i = 0; i < 60 && isPlaying(); i++) await wait(50);
  let started = false;
  for (let i = 0; i < 20 && !started; i++) {
    q().click();
    await wait(40);
    started = isPlaying();
  }
  /* TWO frames, and which one each assertion reads is the point.
   *
   *   fullest  the most accent ink — the last frame painted before the cursor is
   *            cleared. Carries presence, anchoring and above/below, where more ink
   *            is strictly better evidence.
   *   earliest the FIRST frame carrying any accent. Carries the far-end claim: on
   *            the fullest frame the playhead is at the end of the cry, so whether
   *            the accent stops short of the last column is a coin flip, while on the
   *            earliest frame ~95% of the canvas is unplayed and the answer does not
   *            depend on when we looked. The early 'n > 400' break has to stay out:
   *            it would end the sampling a few columns in and leave both frames the
   *            same, which is the vacuous version of this assertion. */
  let fullest = null, earliest = null;
  for (let i = 0; i < 60; i++) {
    const m = scan();
    if (!fullest || m.n > fullest.n) fullest = m;
    if (m.n > 0 && !earliest) earliest = m;
    await wait(20);
  }
  if (isPlaying()) q().click();
  return {
    ...fullest,
    started,
    earliestMaxX: earliest ? earliest.maxX : -1,
    earliestN: earliest ? earliest.n : 0,
  };
})()`;

const probeId = await ev(`Number(document.getElementById('probe-meta').textContent.match(/#([0-9]{3,5})/)[1])`);
const want = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'))
  .find((p) => p.id === probeId).rgb;
const split = await ev(scanInPage(want));

ok(Array.isArray(want) && want.length === 3,
  `the selected species has a sprite average to paint with (#${probeId} → ${JSON.stringify(want)})`);
ok(split.n > 400,
  `the played region is painted in that colour, not left neutral (${split.n} pixels near rgb(${want}) of ${split.w} columns)`);
ok(split.minX <= 2,
  `and it is anchored at the left edge, which is where a played region starts (leftmost at x=${split.minX})`);
/* Read on the EARLIEST frame, which is where the unplayed region is most of the
 * canvas. On the fullest frame this same code reported x=669 on an idle machine and
 * x=696 under load — one green, one red, same commit — because there it was sampling
 * the tail of an autoplay it had not started. */
ok(split.started,
  `pressing play starts playback — the click reaches the delegated handler (aria-pressed true)`);
ok(split.earliestMaxX >= 0 && split.earliestMaxX < split.w * 0.95,
  `while the far end of the trace is still unplayed (accent stops at x=${split.earliestMaxX} of ${split.w} on the first painted frame, n=${split.earliestN}; it reaches x=${split.maxX} by the last)`);
ok(split.above > split.n * 0.35 && split.below > split.n * 0.35,
  `and it is the SAME waveform in another colour — ink above and below the zero line, not just the top (${split.above} / ${split.below} of ${split.n})`);

ok(logs.length===0, `no uncaught exceptions${logs.length?': '+logs[0]:''}`);

/* --- ONE PROFILE, TWO PAGES, IN ORDER ---------------------------------------
 *
 * This is the check for a failure that NOTHING in this file could see, and it is
 * here because it is the shape of the bug rather than the shape of a page.
 *
 * `sorting.html` starts with its cry switch off, which is right: it is the only
 * page that can fire a sound every few milliseconds. It used to express that with
 * `cryPlayer.muted = true`, and that setter persists — so loading sorting.html
 * wrote `{muted: true}` into the site-wide `cry-volume` key, and cries.html then
 * read it back and went permanently silent. Every checker here, and every other
 * in the suite, runs on a FRESH profile, so localStorage starts empty and the
 * key is never written by a page that has not been visited. The pollution needs
 * a VISIT ORDER, and a per-page checker has no way to express one.
 *
 * So this navigates to sorting.html first, in the same profile, and only then
 * asks whether this page can make a sound at all. The measurement is the player's
 * own output gain — `inGain` from the tap — rather than the destination's, because
 * the destination is zeroed BY this checker and the two must not be confused: a
 * page asking for 0 is silent, and a page asking for 3/15 is audible but muted at
 * the last centimetre. Expect this shape anywhere state is shared through storage
 * rather than through a module: the bug is invisible to every test that resets.
 */
await send('Page.navigate',{url:`http://localhost:${process.env.CRY_PORT || 5500}/sorting.html`});
/* Was a fixed 3000 ms, and this is the ONE wait in the file that cannot become a
 * poll, because the claim is an ABSENCE: `afterSorting !== true` is about a write
 * that must NOT have happened, and there is no condition to poll for a thing that
 * has to stay absent — polling until the key looks wrong would invert the check.
 *
 * What can be waited for is the moment the write WOULD have occurred. sorting.html
 * reads and potentially sets `cryPlayer.muted` at module scope, so the bound that
 * matters is "its modules have run and the page has painted". Nav mounted means
 * shared.js executed, and two animation frames mean the task queue has drained
 * past init. That is ~100 ms against 3000 ms, and it is a tighter bound on the same
 * event rather than a shorter one — the 20 s ceiling still backstops it. */
await booted(`!!document.querySelector('nav[data-nav] a, nav a')`);
await until('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', 4000);
const afterSorting = await ev(
  `JSON.parse(localStorage.getItem('pokemon-algorithm:cry-volume') || '{}').muted`);
ok(afterSorting !== true,
  `loading sorting.html does not write a site-wide mute into shared storage`
  + ` (muted: ${afterSorting}) — its switch starts off, and a page's own default is not a reader's choice`);

await send('Page.navigate',{url:`http://localhost:${process.env.CRY_PORT || 5500}/cries.html`});
/* Was a fixed 4000 ms — and almost entirely redundant, because the press-play retry
 * loop immediately below already polls for `#probe-play [data-play]` up to twelve
 * times. This only has to cover the navigation and first paint. */
await booted('document.querySelectorAll("[data-play]").length > 0');
/* The BUTTON, re-queried — not the container, and not a captured reference.
 * #probe-play is a div that renderProbe() rewrites on every play and stop, so the
 * button inside it is a different node by the time anything clicks it, and holding
 * one is how the earlier 19-green-checks bug happened (see the playback-cursor note
 * above). Null is retried rather than assumed: autoplay is ON by default (§3.G), so
 * the probe may still be re-rendering when the page settles. */
/* Select a card FIRST, then press play. The probe's play button does not exist
 * until a species is selected — `#probe-play` is filled by renderProbe(), and the
 * default landing state has none. This is not incidental: reaching for the button
 * directly is what produced a null dereference here, and a null that "fails" is
 * indistinguishable from a null that is the page being broken. */
let pressed = false;
for (let i = 0; i < 12 && !pressed; i++) {
  pressed = await ev(`(() => {
    document.querySelector('.cy-card[data-id="6"]')?.click();
    const b = document.querySelector('#probe-play [data-play]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!pressed) await new Promise(r=>setTimeout(r,400));
}
ok(pressed, 'the cross-page check could select a species and press play'
  + ' (a missing button is this checker being wrong, not the page)');
/* Wait for the player's output gain to STOP MOVING, then read it.
 *
 * The first version of this polled `(${TAP_PROBE}).taps > 0` — the AudioContext
 * existing — and it turned a REAL failure into a green one. The pre-existing bug is
 * that visiting sorting.html leaves `{muted: true}` in the site-wide `cry-volume`
 * key, so cries.html plays at gain 0; the check above reports `muted: true` and
 * this one reported `output gain [0]`. Polling on `taps` returned the instant the
 * context was constructed — before the page had read the key and applied it — so
 * the live AudioParam was read mid-sequence at 0.145 and the check passed. A false
 * green on the one check that was failing, from an edit meant only to save time.
 *
 * So the condition is not "the context exists" and it is deliberately NOT the
 * assertion either (`inGain.some(v => v > 0)`), because waiting for the thing being
 * asserted makes the assertion vacuous — it would pass by construction and only a
 * timeout could fail it. What is waited for is the precondition for READING a live
 * measurement: the value has stopped changing. Two consecutive identical samples,
 * one poll step apart.
 *
 * A page that asks for 0 settles at 0, so this returns true and the assertion then
 * fails with `[0]` — which is the point. The bug stays caught, and it stays caught
 * in about a second instead of after the 900 ms this replaced. */
const GAIN_SETTLED = `(() => {
  const s = window.__cdpMutedTap;
  if (!s || !s.tapIn || !s.tapIn.length) return false;
  const v = s.tapIn[s.tapIn.length - 1].gain.value;
  const prev = window.__cdpGainLast;
  window.__cdpGainLast = v;
  return prev !== undefined && prev === v;
})()`;
await until(GAIN_SETTLED, 6000);
const crossTap = await ev(TAP_PROBE);
ok(crossTap.taps>0 && Array.isArray(crossTap.inGain) && crossTap.inGain.some(v => typeof v === 'number' && v > 0),
  `and cries.html still asks for sound after a visit to sorting.html`
  + ` (output gain ${JSON.stringify(crossTap.inGain)} — the destination is 0 because THIS checker mutes it, and the player's own level is the claim)`);

console.log('');
console.log(fails.length?`FAIL  ${fails.length} of ${pass+fails.length}`:`PASS  ${pass} checks`);
chrome.kill(); process.exit(fails.length?1:0);
