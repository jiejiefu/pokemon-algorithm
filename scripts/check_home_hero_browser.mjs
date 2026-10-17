#!/usr/bin/env node
/**
 * index.html's hero, driven over the DevTools Protocol. Run:
 *   node scripts/check_home_hero_browser.mjs      (needs the repo served on :5500)
 *
 * WHAT THIS CAN SEE THAT check_home_hero.mjs CANNOT
 * ==================================================
 * Two claims, both of which are invisible to reading a file:
 *
 *   1. THE SCRUB MOVES THE CLIP.  The static half can prove the formula divides
 *      -rect.top by (rect.height - innerHeight); it cannot prove that
 *      `currentTime` follows it, that scrolling back runs the clip backwards, or
 *      that a reduced-motion reader's clip stays where it was put.  A `currentTime`
 *      write against a duration that never arrived is a silent no-op, and no
 *      amount of source reading tells a silent no-op from a scrub.
 *
 *   2. THE TEXT IS READABLE OVER THE CLIP.  §3.C is explicit that contrast is
 *      measured by sampling decoded pixels, NOT by reading `getComputedStyle()`,
 *      because computed style misses alpha blending, backdrop filters and the
 *      fact that the ground is an arbitrary frame of a video.  The panel is
 *      `rgba(6, 9, 20, 0.8)` over whatever the clip is showing, so the only
 *      honest number is the one taken from a screenshot.
 *
 * ## WHY THE CONTRAST IS MEASURED AGAINST THE BRIGHTEST FRAME AND NOT A RANDOM ONE
 * =================================================================================
 * A video's frames are not interchangeable: the roster builds in dex order and
 * then fades to background, so "the average frame" is a pale mid-build frame
 * with a few sprites in it.  Measuring the panel against that is measuring the
 * easy case.  So this scrolls to the END of the track — where make_hero_video.py's
 * timeline says all 151 sprites are on screen — and takes the measurement there,
 * plus one mid-scroll.  The worst of the two is the verdict.
 *
 * ## §3.G5: A COMMAND RESOLVING IS NOT THE PAGE HAVING APPLIED IT
 * ================================================================
 * Every wait here is on a PRECONDITION and its result is asserted, never
 * discarded.  `until()` returning false used to cost a run a failure 70 lines
 * downstream that described a page which was not there.  `check_graph_browser.mjs`
 * paid 6.8s for the same lesson in a different way: a search poll that cannot
 * return early on a dead page is paid for on every dead page.
 *
 * ## ONE CHROME, ONE PROFILE, KILLED ON EVERY EXIT PATH
 * ========================================================
 * `tmp-trees.mjs` sweeps the tree; this file kills the process.  That is not two
 * copies of §3.J's cleanup, it is one module doing trees and one line doing the
 * process — the split cdp-port.mjs's header already draws.  SIGKILL cannot be
 * caught at all, which is the honest limit and the reason the profile is
 * registered with the registry rather than merely created.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';
import { until } from './lib/cdp-until.mjs';
import { trackTree } from './lib/tmp-trees.mjs';
import { createHash } from 'node:crypto';

/* A HARD BOUND ON THE WHOLE FILE.
 *
 *  Every individual wait below returns on a ceiling, and the file still hung for
 *  18 minutes once — sitting in tier B, holding the other nine browser entries,
 *  with nothing in the output saying where. A ceiling that fails is unknowable
 *  from the outside, which is the whole problem: a checker that hangs keeps the
 *  runner open and reports nothing, so it is strictly worse than one that fails.
 *
 *  §3.G5's rule about named waits, applied to the file rather than to a call:
 *  `at()` records the section that is running and the watchdog names it. Four minutes
 *  is roughly 4x the slowest measured section, so it fires when something is stuck
 *  rather than slow — and it exits 2, which is neither a pass nor a checker's own
 *  failure code, so the row reads as an abort rather than as a verdict. */
const WATCHDOG_MS = 240000;
let section = 'boot';
const at = (name) => { section = name; };
const watchdog = setTimeout(() => {
  console.error(`\nWATCHDOG  no progress for ${WATCHDOG_MS / 1000}s; last section: "${section}"`);
  console.error('  abandoning the run rather than leaving it holding the pool open');
  process.exit(2);
}, WATCHDOG_MS);

const PORT = process.env.CRY_PORT || 5500;
const DESKTOP = { width: 1280, height: 900 };

const profile = trackTree(mkdtempSync(join(tmpdir(), 'hhr-')));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const CDP = await waitForDebugPort(profile);
process.on('exit', () => { try { chrome.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { chrome.kill(); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); });
}

let targets;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); if (r.ok) { targets = await r.json(); break; } } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
/* THE PROMISE THAT NEVER SETTLED. `await new Promise(r => ws.addEventListener('open',
 * r, {once:true}))` has no ceiling, and the 18-minute hang was here rather than
 * in any of the waits the watchdog was watching — because the watchdog itself was
 * armed AFTER this line, so it had not started counting. Both halves are the
 * same lesson: a bound that is declared below the thing it is supposed to bound
 * is not a bound. */
await Promise.race([
  new Promise((r) => ws.addEventListener('open', r, { once: true })),
  new Promise((_, reject) => setTimeout(() => reject(new Error(
    'the CDP websocket never opened within 20s — Chrome came up (a profile and a '
    + 'debug port exist) but the page target never attached')), 20000)),
]);
let id = 0; const waiting = new Map(); const exceptions = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`EXC ${((d.exception?.description) || d.text || '').split('\n')[0]}`);
  }
});
const SEND_CEILING_MS = 30000;
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  /* The timer is cleared on the answer, so a slow call costs nothing once it
   * returns. Nothing is left pending, and nothing keeps the event loop alive
   * after the file has finished. */
  const timer = setTimeout(() => {
    waiting.delete(n);
    rej(new Error(`${method} did not answer within ${SEND_CEILING_MS / 1000}s`));
  }, SEND_CEILING_MS);
  waiting.set(n, (x) => {
    clearTimeout(timer);
    if (x.error) rej(new Error(JSON.stringify(x.error))); else res(x.result);
  });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0]);
  return r.result.value;
};

let checks = 0; const fails = [];
/** The third argument is the CONSEQUENCE OF FAILING, and it is printed only when
 *  the check fails.  The first version appended it unconditionally, so every
 *  green line in this file ended with 「— below WCAG AA's 4.5:1 — the panel is
 *  not opaque enough over the clip」 directly after a measurement showing it was
 *  comfortably above, and a reader scanning for the verdict could not tell which
 *  half of the line was the number and which was the complaint.  §3.G9's rule:
 *  a message must quote what it measured, and a message that also quotes the
 *  failure on the passing path is quoting something it did not find. */
const ok = (cond, what, why) => {
  checks++;
  const line = cond ? what : `${what} — ${why || 'no reason given'}`;
  if (!cond) fails.push(line);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${line}`);
};


await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { ...DESKTOP, deviceScaleFactor: 1, mobile: false });
const SEEN_W = await until(ev, `innerWidth === ${DESKTOP.width}`, 3000);
ok(SEEN_W, `the viewport is ${DESKTOP.width}px before anything is measured at it (${await ev('innerWidth')}px)`);

async function openIndex(reducedMotion) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }],
  });
  await send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
  return until(ev, `(() => {
    const v = document.getElementById('home-hero-video');
    return !!v && v.readyState >= 1 && Number.isFinite(v.duration) && v.duration > 0;
  })()`, 25000);
}

const videoState = () => ev(`(() => {
  const v = document.getElementById('home-hero-video');
  const track = document.querySelector('.home-hero');
  const r = track.getBoundingClientRect();
  const range = r.height - window.innerHeight;
  return {
    currentTime: v.currentTime,
    duration: v.duration,
    src: v.currentSrc || v.src,
    poster: v.poster,
    paused: v.paused,
    readyState: v.readyState,
    trackH: Math.round(r.height),
    innerH: window.innerHeight,
    progress: range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0,
  };
})()`);

/** What fraction of a screen region is NOT the clip's own background colour.
 *
 *  Counted off decoded pixels, for §3.G3's reason: a canvas (and a composited
 *  video layer is one) that painted nothing is indistinguishable from one that
 *  painted the page's background, and "the dark rectangle appeared" is the
 *  failure this page has at both ends of its scrub.
 *
 *  The region is a band on the LEFT of the sticky viewport, clear of the content
 *  panel, because the panel is opaque by design and would answer every
 *  measurement with its own fill. */
async function inkFraction(viewportClip) {
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...await pageRect(viewportClip), scale: 1 }, captureBeyondViewport: false });
  const png = Buffer.from(shot.data, 'base64');
  return ev(`(async () => {
    const blob = await (await fetch('data:image/png;base64,' + ${JSON.stringify(png.toString('base64'))})).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let ink = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // The clip bakes --bg-primary, rgb(11,16,32). Anything meaningfully off it
      // is a sprite; the scrim darkens rather than lightens, so the same
      // threshold works over the whole clip.
      if (Math.abs(d[i] - 11) + Math.abs(d[i + 1] - 16) + Math.abs(d[i + 2] - 32) > 24) ink++;
      n++;
    }
    return { ink: ink / n, px: n };
  })()`);
}

/** A band of the hero the content panel never covers. */
const MEDIA_BAND = { x: 10, y: 120, width: 240, height: 600 };
/** Page coordinates for a VIEWPORT rect.
 *
 *  `Page.captureScreenshot`'s `clip` is interpreted in PAGE coordinates, not
 *  viewport coordinates, and the two are silently different the moment the page
 *  is scrolled.  Every screenshot in this file was wrong by `scrollY` until this
 *  helper existed: the left band reported 22.4% ink at 25% of the track and 0.0%
 *  at 75% of it, which looked like the hero showing the wrong frames and was
 *  actually the crop landing on the document's own header — the band image came
 *  back with `.header` drawn through the middle of it.
 *
 *  This is §3.G5's rule one level up from the two it already documents: a
 *  measurement is only as good as the coordinate system it is taken in, and a
 *  coordinate system that is right at `scrollY === 0` is a coordinate system that
 *  has not been tested. */
const pageRect = async (viewportRect) => {
  const o = await ev('({ x: window.scrollX, y: window.scrollY })');
  return { x: Math.round(viewportRect.x + o.x), y: Math.round(viewportRect.y + o.y), width: viewportRect.width, height: viewportRect.height };
};


/** Score must clear this to count as "the roster is on screen". Measured on the
 *  built grid: ~20% of the frame is sprite, and a band on the left of the panel
 *  measures a little under that. */
const INK_PRESENT = 0.02;
/** And must stay under this to count as empty. A blank frame is 0.0000 — the
 *  scrim alone contributes nothing against the background it is over. */
const INK_EMPTY = 0.002;

/** Wait until the clip's currentTime has MOVED and then STOPPED MOVING.
 *
 *  `video.seeking === false` is not a precondition on its own: it is already false
 *  before the scrub's requestAnimationFrame has run at all, so waiting on it returned
 *  instantly and every screenshot was taken of the frame the reader was never
 *  shown — the ink section read 0.0% a quarter of the way down the track, which is
 *  the frame-0 figure.
 *
 *  `requestVideoFrameCallback` is the *right* API — it fires when a frame reaches
 *  the compositor, which is exactly what a screenshot photographs — and measured on
 *  this page it fired on 1 of 5 seeks, because a PAUSED video that is seeked does not
 *  reliably present in headless Chrome.
 *
 *  So the wait is for the value to MOVE and then STOP MOVING: this project's own
 *  recorded rule for reading a live measurement, polling for the precondition rather
 *  than for the assertion. The ceiling still returns and the result is reported,
 *  because a scrub that never lands is a finding rather than something to swallow.
 */
async function seekSettled(from) {
  const deadline = Date.now() + 8000;
  let last = null, stable = 0;
  while (Date.now() < deadline) {
    const st = await ev(`(() => {
      const v = document.getElementById('home-hero-video');
      return { t: v.currentTime, seeking: v.seeking };
    })()`);
    if (st.seeking) { stable = 0; last = st.t; await new Promise((r) => setTimeout(r, 50)); continue; }
    if (last === null) last = st.t;
    if (st.t !== from) {
      stable = st.t === last ? stable + 1 : 0;
      if (stable >= 2) return { landed: true, at: st.t };
    }
    last = st.t;
    await new Promise((r) => setTimeout(r, 60));
  }
  return { landed: false, at: await ev(`document.getElementById('home-hero-video').currentTime`) };
}

/** Scroll, wait for the seek to complete.
 *
 *  One argument, no options. The `measure: false` escape hatch existed only to
 *  skip the fingerprint poll, which is gone — every caller wanted the seek and
 *  only some wanted a second screenshot of pixels the ink section measures
 *  anyway, and an option that means "skip the thing that is flaky" is how a flaky
 *  measurement stops being questioned. */
async function scrollTo(fraction) {
  const wasAt = await ev(`document.getElementById('home-hero-video').currentTime`);
  await ev(`(() => {
    const t = document.querySelector('.home-hero');
    const r = t.getBoundingClientRect();
    const range = r.height - window.innerHeight;
    window.scrollTo(0, window.scrollY + r.top + range * ${fraction});
  })()`);
  await until(ev, `window.scrollY > 0`, 3000);
  return seekSettled(wasAt);
}

at('boot + clip identity');
console.log('\n--- the clip is real, and it is the day\'s ---');
ok(await openIndex(false), 'the video reported a usable duration, so the scrub has something to scrub');
const s0 = await videoState();
ok(s0.duration > 0 && Number.isFinite(s0.duration), `the clip has a finite duration (${s0.duration}s)`);
ok(/hero-gen[1-9]\.mp4$/.test(s0.src), `the src is one of the nine clips (${s0.src.split('/').pop()})`);
ok(/poster-gen[1-9]\.jpg$/.test(s0.poster), `the poster is the matching still (${s0.poster.split('/').pop()})`);
const genOfSrc = Number(s0.src.match(/hero-gen(\d)/)[1]);
ok(genOfSrc === Number(s0.poster.match(/poster-gen(\d)/)[1]),
  `clip and still are the same generation (gen ${genOfSrc}) — a poster from another day is a flash of one roster and a scrub of another`);
ok(s0.paused === true, 'the clip is paused: play() is never called, so the scroll is the only transport');
ok(s0.trackH > s0.innerH * 2, `the track is taller than one viewport (${s0.trackH}px vs ${s0.innerH}px), or there is no scrub range at all`);

at('the five forward stops');
console.log('\n--- scrolling forward advances the clip, and the ink proves it ---');
/* ONE pass over the five stops, measuring the scrub AND the ink there.
 *
 * The file used to scroll to 0/25/50/75/100 twice — once to read currentTime and
 * once to count ink — which is 17 scrollTo calls where 12 do the job, and every
 * one of them carries an 8s seek ceiling. It is the most expensive entry in tier B
 * for a page that is one element, and §4's rule about a slow check is that the
 * question to ask is what it is actually computing.
 *
 * The two measurements share nothing: one is the scrub's own output, the other is
 * the composited result. Sharing a scroll position is not sharing an assertion. */
const marks = [];
const ink = {};
const END_STOPS = [0, 1];
const MIDDLE_STOPS = [0.25, 0.5, 0.75];
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  const landed = await scrollTo(f);
  /* The first stop is 0% of the track from the top of the page, which is where the
   * page already is, so currentTime does not move and there is nothing to wait
   * for. That is why four of the five can LAND rather than all five. */
  if (f > 0) ok(landed.landed, `the seek for ${Math.round(f * 100)}% completed and currentTime came to rest`,
    'the scrub never settled at this scroll position — currentTime kept moving after 8s, so the frame being measured is not one this checker can name');
  const st = await videoState();
  marks.push(st);
  ok(Math.abs(st.progress - f) < 0.06, `scrolled to ${Math.round(f * 100)}% of the track (measured ${Math.round(st.progress * 100)}%)`);
  const r = await inkFraction(MEDIA_BAND);
  ink[f] = r.ink;
  ok(r.px > 10000, `the left band at ${Math.round(f * 100)}% sampled ${r.px} real pixels`,
    'the band crop was empty, so the ink figure below is measuring nothing');
}
const endsInk = { 0: ink[0], 1: ink[1] };
const middleInk = Object.fromEntries(MIDDLE_STOPS.map((f) => [f, ink[f]]));

for (let i = 1; i < marks.length; i++) {
  ok(marks[i].currentTime > marks[i - 1].currentTime,
    `clip advanced from ${marks[i - 1].currentTime.toFixed(2)}s to ${marks[i].currentTime.toFixed(2)}s between ${Math.round((i - 1) / 4 * 100)}% and ${Math.round(i / 4 * 100)}%`);
}
/* THE identity the static half cannot check: currentTime is the progress times
 * the duration, with no offset and no easing. A tolerance here would be satisfied
 * by a scrub that is merely monotonic, which is the bug this is written for. */
const worstErr = Math.max(...marks.map((m) => Math.abs(m.currentTime - m.progress * m.duration)));
ok(worstErr < 0.25,
  `currentTime equals progress x duration at every stop (worst error ${worstErr.toFixed(3)}s)`,
  'a small offset here is the `- innerHeight` term disappearing: the clip still moves, it just stops short of the end');
ok(marks[marks.length - 1].currentTime > marks[marks.length - 1].duration * 0.9,
  `the clip reaches the last 10% of itself (${marks[marks.length - 1].currentTime.toFixed(2)}s of ${marks[marks.length - 1].duration}s) — the tail of the clip is unreachable when the range omits innerHeight`);

console.log('\n--- scrolling back runs the clip in reverse ---');
at('the reverse scrub');
console.log('\n--- scrolling back runs the clip in reverse ---');
await scrollTo(1);

/* BOTH ENDS OF THE TRACK ARE DECLARED EMPTY, by the author's decision.
 *
 * make_hero_video.py builds the roster across the clip's first 65% and fades it back
 * out over the last 13%, so frame 0 and frame 299 both contain no sprites. Scrubbing
 * 0 -> 1 therefore opens and closes on a blank dark field: measured, the hero's left
 * band is 0.00% ink at both ends against ~24% mid-build. The author was told and chose
 * to keep the full clip — 「維持 0%→100%」 — over re-mapping the scrub onto the wave.
 *
 * Which means the two ends are not asserted as defects and not skipped either. They
 * are asserted as what they now ARE: an empty band at each end, with the reason named,
 * and a roster in the middle. That is §3.F's rule about a named exception applied in
 * the other direction — the exception cannot outlive its reason, because if a future
 * change re-maps the scrub onto the wave (the fix this declined) the ends become
 * non-empty and THESE assertions go red rather than the declaration quietly becoming
 * true of nothing. */
for (const f of END_STOPS) {
  ok(endsInk[f] < INK_EMPTY,
    `${Math.round(f * 100)}% of the track is blank, as declared (${(endsInk[f] * 100).toFixed(2)}% ink against a background of 0.00%)`,
    `the ${Math.round(f * 100)}% end now shows ${(endsInk[f] * 100).toFixed(2)}% ink — the scrub is no longer 0 -> 1, so the declaration no longer describes it. Either update the declaration or restore the full-clip scrub`);
}
for (const f of MIDDLE_STOPS) {
  ok(middleInk[f] > INK_PRESENT,
    `${Math.round(f * 100)}% of the track has the roster on screen (${(middleInk[f] * 100).toFixed(1)}% ink)`,
    'the hero is blank in the middle of its own scrub range — every frame between the two declared empty ends is empty, which no reading of "keep the full clip" produces');
}

/* THE HERO REPAINTS, asserted from those ink figures rather than from a second
 * screenshot of its own pixels.
 *
 * The first version fingerprinted a 220x140 crop of the media layer and counted how
 * many times the hash changed. It is the right claim and it is NOT that measurement:
 * a second screenshot of the same thing is a second sample of a quantity measured
 * properly above, and it is the flakier of the two — under tier-B contention it came
 * back `3 of 5` once in three runs, because the seek completes and `currentTime`
 * settles while the compositor has not presented the frame yet. A longer poll ceiling
 * papered over it, which is the third time in this file that a timeout hid something.
 *
 * §3.W's rule is the one that applies: a second count standing in for a claim is how a
 * guard stops being about the thing it names. The ink figures already say it, with
 * better evidence — the band reads 0.00% at the two ends and ~24% in the middle, so
 * the media layer is demonstrably showing different frames at different scroll
 * positions, which is what `the hero repaints` means.
 *
 * The claim is NOT "every figure differs". The two ends are equal BY DECLARATION, and
 * the build and the wave round to the same figure. Neither is a hero that stopped
 * repainting. What has to differ is the middle from itself, because that is the only
 * part of the scrub range the author did not spend an exception on. */
const middleFigures = Object.values(middleInk);
ok(new Set(middleFigures.map((v) => v.toFixed(3))).size > 1,
  `the middle of the scrub range changes frame (${middleFigures.map((v) => (v * 100).toFixed(1) + '%').join(' ')}) against ${(endsInk[0] * 100).toFixed(2)}% and ${(endsInk[1] * 100).toFixed(2)}% at the two declared-empty ends`,
  'all three middle stops produced the same ink — the media layer is not following the reader: currentTime can move while the same frame stays on screen');

const before = (await videoState()).currentTime;
await scrollTo(0.3);
const after = (await videoState()).currentTime;
ok(after < before - 0.5, `scrolling up moved the clip backwards (${before.toFixed(2)}s -> ${after.toFixed(2)}s)`,
  'the scrub only runs forwards — this is the free consequence of writing currentTime rather than calling play(), and it is worth measuring rather than asserting');

at('reduced motion');
console.log('\n--- reduced motion freezes the clip and collapses the track ---');
ok(await openIndex(true), 'the page booted with prefers-reduced-motion: reduce emulated');
await scrollTo(0);
await new Promise((r) => setTimeout(r, 250));
const rm0 = await videoState();
ok(rm0.trackH <= DESKTOP.height * 1.02,
  `the track is one viewport tall (${rm0.trackH}px vs ${DESKTOP.height}px) — 1.4 viewports of scroll past a still image is a dead zone`,
  'the track keeps its scrub height under reduced motion, so the reader scrolls through empty space');
const frozen0 = rm0.currentTime;
await scrollTo(1);
await new Promise((r) => setTimeout(r, 250));
const rm1 = await videoState();
ok(Math.abs(rm1.currentTime - frozen0) < 0.05,
  `currentTime did not move across a full scroll (${frozen0.toFixed(3)}s -> ${rm1.currentTime.toFixed(3)}s)`,
  'the scrub ran under reduced motion, which is motion at any speed');
// It froze SOMEWHERE, and "somewhere" is the claim: the frame the poster was cut
// from. A freeze at frame 0 is an empty dark rectangle that looks like a working
// hero and is not one — §3.G3's blank-canvas lesson in a different element.
ok(Math.abs(rm1.currentTime - rm1.duration * 0.65) < 0.2,
  `it froze on the poster frame, ${(rm1.currentTime / rm1.duration * 100).toFixed(0)}% in (expected 65%)`,
  'the freeze landed on frame 0, which is an empty background rather than the roster — the reduced-motion hero would be a dark rectangle');
ok(await ev(`!document.querySelector('.home-hero-scroll-chevron') || getComputedStyle(document.querySelector('.home-hero-scroll-chevron')).animationName === 'none'`),
  'the scroll hint\'s chevron is not animating');

at('contrast: the analytic bound');
console.log('\n--- the text is readable over every frame the reader passes ---');
/* NOT "the end of the track".  The first version measured there and reported
 * 1908:1, which is the most confident wrong number this file could have printed:
 * make_hero_video.py's timeline ends with `fade_end` at 0.967 and a ten-frame
 * empty hold, so progress 1.0 is frame 299 — an EMPTY dark field.  The clip's
 * brightest moment is in the WAVE (0.65-0.86), where WAVE_GAIN pushes every
 * sprite up.  So the worst case is sampled across the wave and the WORST ratio
 * wins; measuring the brightest frame is the whole claim, and measuring the
 * brightest frame's opposite is how a 1908:1 turns up next to a panel that is
 * in fact only as opaque as 0.8. */
const wc = await worstCaseContrast();
ok(wc.alpha > 0 && wc.alpha <= 1, `the panel's fill was read off the live computed style (alpha ${wc.alpha})`);
ok(wc.ratio >= 4.5,
  `the h1 reads at ${wc.ratio.toFixed(2)}:1 against the WORST frame the clip can show — the panel composited over pure white (${wc.ink} on ${wc.ground})`,
  `below WCAG AA's 4.5:1 at alpha ${wc.alpha}. This is the bound no frame can exceed, so a red here is a red for every frame, not for one scroll position`);

/** The h1's contrast against the WORST frame the clip could possibly show.
 *
 *  The panel is `rgba(6, 9, 20, 0.8)` over an arbitrary video frame, and a
 *  sprite can be any colour up to pure white. So the upper bound on the ground
 *  behind the title is that panel composited over (255,255,255) — a figure that
 *  depends on no frame, no scroll position and no pixel sampling, and therefore
 *  cannot be fooled by cropping the wrong part of the page.
 *
 *  The alpha and the panel colour are read off the LIVE computed style rather
 *  than from the stylesheet text. §3.C is explicit that computed style is not
 *  where contrast is decided — but that rule is about the FINAL composited
 *  result, which is what the second measurement below takes from real pixels.
 *  Reading the alpha at all is reading a declaration; reading the ground is
 *  reading a screen.
 */
async function worstCaseContrast() {
  return ev(`(() => {
    const h1 = document.querySelector('.home-hero-title');
    const panel = document.querySelector('.home-hero-content');
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
    const bg = parse(getComputedStyle(panel).backgroundColor);   // r g b a
    const fg = parse(getComputedStyle(h1).color);                // r g b
    const a = bg.length > 3 ? bg[3] : 1;
    /* Pure white is the brightest thing a sprite can be, so it is the frame
     * this panel has to survive. */
    const ground = L(bg[0] * a + 255 * (1 - a), bg[1] * a + 255 * (1 - a), bg[2] * a + 255 * (1 - a));
    const ink = L(fg[0], fg[1], fg[2]);
    return {
      ratio: (Math.max(ground, ink) + 0.05) / (Math.min(ground, ink) + 0.05),
      alpha: a, ink: getComputedStyle(h1).color,
      ground: 'rgb(' + bg.slice(0, 3).map((v, i) => Math.round(v * a + 255 * (1 - a))).join(', ') + ')',
    };
  })()`);
}

/** The h1's contrast against the ground DIRECTLY BEHIND IT, from real pixels.
 *
 *  §3.C's rule, and the reason the crop is the strip of panel between its own
 *  top edge and the top of the h1 — padding, guaranteed to contain no glyph, and
 *  immediately adjacent, so it is the composite the title is actually sitting
 *  on.  The first version cropped the WHOLE panel and took the brightest pixel
 *  in it, which measured the gold title against ITSELF: `#f5c542` is L=241, so
 *  over a dark frame the "worst case ground" was the text and the verdict came
 *  out 1.44:1.  A brightest-pixel search inside a box that CONTAINS the text can
 *  only find the text.
 *
 *  This is reported alongside worstCaseContrast() rather than instead of it,
 *  because it is the one that can be fooled and the one that cannot, and a
 *  checker that keeps only the unfoolable one has stopped measuring the page. */
async function panelContrast(label) {
  const box = await ev(`(() => {
    const panel = document.querySelector('.home-hero-content');
    const h1 = document.querySelector('.home-hero-title');
    const pr = panel.getBoundingClientRect();
    const hr = h1.getBoundingClientRect();
    const r = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
    return {
      /* Inset by the corner radius on BOTH sides. The strip is the panel's flat
       * top edge; without the inset it also contains the two rounded corners,
       * where there IS no panel and the raw clip shows through — which is how
       * this measured 1.57:1 on a panel that composites to 6.97:1 over pure
       * white. A brightest-pixel search needs a region that is entirely the
       * thing it claims to be measuring. */
      x: Math.round(pr.left + r + 4),
      y: Math.round(pr.top),
      width: Math.round(pr.width - 2 * r - 8),
      height: Math.max(4, Math.round(hr.top - pr.top)),
      title: getComputedStyle(h1).color,
    };
  })()`);
  if (box.width < 10 || box.height < 4) {
    ok(false, `${label}: there is padding above the title to sample as its ground`, `the panel is ${box.width}x${box.height} at (${box.x},${box.y})`);
    return 0;
  }
  const shot = await send('Page.captureScreenshot', {
    /* `clip` names its fields `width`/`height`, not `w`/`h` — the abbreviation
     * is only this checker's own shorthand and CDP rejects the short names with
     * "mandatory field missing at position 58", which says nothing about which
     * field. */
    format: 'png', clip: { ...await pageRect(box), scale: 1 },
    captureBeyondViewport: false,
  });
  const png = Buffer.from(shot.data, 'base64');
  /* Decode in-page rather than adding a PNG decoder: a canvas the page already
   * has can turn the same bytes into pixels, and §3.G4's note about a corrupt
   * test image failing for a reason that has nothing to do with the page applies
   * here too — so the bytes are handed to the page and the NUMBERS come back. */
  const res = await ev(`(async () => {
    const b64 = ${JSON.stringify(png.toString('base64'))};
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let maxL = 0, minL = 255;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l > maxL) maxL = l;
      if (l < minL) minL = l;
    }
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const rel = (L) => (L <= 0.03928 ? L / 12.92 : Math.pow((L + 0.055) / 1.055, 2.4));
    /* maxL and minL are 0-255 REC.709 LUMINANCE, not relative luminance, so they
     * are converted rather than handed to rel() directly.  The first version did
     * hand them over, and rel() read L=16 as a relative luminance of 16 — a
     * quantity above 1 — which is how a real page reported 1908:1 and 964405:1.
     * Two of the four figures this file printed before that fix were not
     * measurements of anything. */
    const tl = (() => {
      const m = ${JSON.stringify(box.title)}.match(/[\\d.]+/g).map(Number);
      return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
    })();
    const worst = rel(maxL / 255);
    return {
      ratio: (Math.max(worst, tl) + 0.05) / (Math.min(worst, tl) + 0.05),
      title: ${JSON.stringify(box.title)},
      brightest: Math.round(maxL),
      darkest: Math.round(minL),
      px: bmp.width * bmp.height,
    };
  })()`);
  ok(res.px > 500, `${label}: sampled ${res.px} real pixels from a screenshot of the ground above the title`,
    'the crop was empty — the panel had no box on screen at this scroll position');
  ok(res.ratio >= 4.5, `${label}: the h1 reads at ${res.ratio.toFixed(2)}:1 against the brightest pixel measured directly above it (${res.title}, ground L=${res.brightest}/${res.darkest})`,
    `below WCAG AA's 4.5:1 — the panel is not opaque enough over the clip`);
  return res.ratio;
}

await openIndex(false);
let worstRatio = Infinity, worstAt = '';
at('contrast: the pixel samples');
for (const f of [0.65, 0.75, 0.85]) {
  await scrollTo(f);
  const r = await panelContrast(`${Math.round(f * 100)}% of the track`);
  if (r < worstRatio) { worstRatio = r; worstAt = `${Math.round(f * 100)}%`; }
}
ok(worstRatio >= 4.5,
  `the worst h1 contrast across the whole clip is ${worstRatio.toFixed(2)}:1, at ${worstAt}`,
  'below 4.5:1 somewhere in the scrub range — the panel is not opaque enough over the clip');
console.log('\n--- the page produced no exceptions ---');
ok(exceptions.length === 0, `no uncaught exception on the page${exceptions.length ? ': ' + exceptions.join(' | ') : ''}`);

if (fails.length) {
  console.log(`\n${fails.length} of ${checks} checks FAILED`);
  clearTimeout(watchdog);
process.exit(1);
}
clearTimeout(watchdog);
console.log(`\nPASS  ${checks} browser checks`);