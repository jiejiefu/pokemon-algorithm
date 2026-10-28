#!/usr/bin/env node
/**
 * index.html's hero, driven over the DevTools Protocol. Run:
 *   node scripts/check_home_hero_browser.mjs      (needs the repo served on :5500)
 *
 * WHAT THIS SEES THAT check_home_hero.mjs CANNOT
 * ==============================================
 * Two claims, both invisible to reading a file:
 *
 *   1. THE SCRUB MOVES THE CLIP.  The static half proves the formula divides
 *      -rect.top by (rect.height - innerHeight); it cannot prove that
 *      `currentTime` follows it, that scrolling back runs the clip backwards, or
 *      that a reduced-motion reader's clip stays put. A `currentTime` write
 *      against a duration that never arrived is a silent no-op, and source
 *      reading cannot tell a no-op from a scrub.
 *
 *   2. THE TEXT IS READABLE OVER THE CLIP.  §3.C requires contrast to be measured
 *      from decoded pixels, not `getComputedStyle()`, which misses alpha
 *      blending, backdrop filters and the fact that the ground is an arbitrary
 *      frame of a video. The panel is `rgba(6, 9, 20, 0.7)` over whatever the clip
 *      shows, so the only honest number comes from a screenshot.
 *
 * ## CONTRAST IS MEASURED AGAINST THE BRIGHTEST FRAME, NOT A RANDOM ONE
 * A video's frames are not interchangeable: the roster builds in dex order then
 * fades out, so "the average frame" is a pale mid-build frame — the easy case.
 * The measurement is therefore taken where make_hero_video.py's timeline puts
 * every sprite on screen, plus one mid-scroll; the worst of the two decides.
 *
 * ## §3.G5: A COMMAND RESOLVING IS NOT THE PAGE HAVING APPLIED IT
 * Every wait here is on a precondition and its result is asserted, never
 * discarded: `until()` returning false otherwise costs a failure far downstream
 * that describes a page which was not there.
 *
 * ## ONE CHROME, ONE PROFILE, KILLED ON EVERY EXIT PATH
 * `tmp-trees.mjs` sweeps the tree; this file kills the process. One module does
 * trees, one line does the process (§3.J). SIGKILL cannot be caught — the honest
 * limit, and why the profile is registered with the registry.
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
 *  Every individual wait below returns on a ceiling, yet the file once hung for
 *  18 minutes while holding the other browser entries, with nothing saying where.
 *  A checker that hangs keeps the runner open and reports nothing, which is worse
 *  than one that fails.
 *
 *  `at()` records the running section and the watchdog names it. Four minutes is
 *  roughly 4x the slowest measured section, so it fires when something is stuck
 *  rather than slow, and it exits 2 — neither a pass nor a checker failure code,
 *  so the row reads as an abort. */
const WATCHDOG_MS = 240000;
let section = 'boot';
/* Per-section timing: the question to ask about a slow check is what it is
 * actually computing (§4), and that was not visible anywhere in this file.
 * `at()` already runs at every section boundary, so this costs one Date.now()
 * per boundary and prints at the end whether the run passed or failed.
 *
 * THE WATCHDOG IS ONE-SHOT from the start of the file, NOT RESET PER SECTION: a
 * legitimately slow run is killed at the same 240s whether or not it is
 * progressing. The fix for "too slow" is to make it cheaper, not to raise the
 * ceiling (§3.Z). */
const SECTION_COSTS = [];
let sectionStart = Date.now();
/** Close the running section and start naming the next one.
 *
 *  The cost is charged to the section that RAN, not the one about to run. `at()`
 *  cannot close the final section — it has no second `at()` — so `closeSection()`
 *  is also called once at the end.
 */
const closeSection = () => { SECTION_COSTS.push([section, Date.now() - sectionStart]); sectionStart = Date.now(); };
const at = (name) => { closeSection(); section = name; };
const printSectionCosts = () => {
  const total = SECTION_COSTS.reduce((s, [, ms]) => s + ms, 0);
  console.log('\n--- where the time went ---');
  for (const [name, ms] of SECTION_COSTS) console.log(`  ${String((ms / 1000).toFixed(1)).padStart(6)}s  ${name}`);
  console.log(`  ${String((total / 1000).toFixed(1)).padStart(6)}s  TOTAL`);
};
const watchdog = setTimeout(() => {
  console.error(`\nWATCHDOG  no progress for ${WATCHDOG_MS / 1000}s; last section: "${section}"`);
  closeSection();
  printSectionCosts();
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
/* The promise that never settled. `await new Promise(r => ws.addEventListener(
 * 'open', r, {once:true}))` has no ceiling, and the 18-minute hang was here,
 * made worse by the watchdog being armed after this line. A bound declared below
 * the thing it is meant to bound is not a bound. */
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
  /* The timer is cleared on the answer, so nothing is left pending or keeping
   * the event loop alive after the file finishes. */
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
/** The third argument is the CONSEQUENCE OF FAILING, printed only when the check
 *  fails. Appending it unconditionally ends every green line with a complaint
 *  right after a measurement showing it comfortably passed, so a reader cannot
 *  tell the number from the complaint (§3.G9). */
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
 *  Counted off decoded pixels (§3.G3): a composited video layer that painted
 *  nothing is indistinguishable from one that painted the page's background, and
 *  "the dark rectangle appeared" is this page's failure at both ends of its
 *  scrub. The band is on the LEFT of the sticky viewport, clear of the content
 *  panel, which is opaque and would answer every measurement with its own fill. */
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
    // is a sprite; the scrim darkens rather than lightens, so one threshold
    // covers the whole clip.
      if (Math.abs(d[i] - 11) + Math.abs(d[i + 1] - 16) + Math.abs(d[i + 2] - 32) > 24) ink++;
      n++;
    }
    return { ink: ink / n, px: n };
  })()`);
}

/** A band of the hero the content panel can never cover.
 *
 *  The panel is anchored BOTTOM-LEFT (§3.Z), so the safe band is the right side
 *  of the sticky viewport at full height. The left band this replaced was sound
 *  only while the panel was centred: once the panel moved to the corner, its
 *  60px amber title sat inside the band's bottom rows and both blank ends read
 *  3.49% ink — the panel, not the clip. `the ink band clears the content panel`
 *  below asserts the clearance, so the next layout change fails loudly instead
 *  of quietly measuring the wrong thing. */
const MEDIA_BAND = { x: 900, y: 120, width: 240, height: 600 };
/** Page coordinates for a VIEWPORT rect.
 *
 *  `Page.captureScreenshot`'s `clip` is in PAGE coordinates, which differ from
 *  viewport coordinates once the page is scrolled. Without this correction the
 *  crop lands on the document's own header, which reads as the hero showing the
 *  wrong frames. A coordinate system that is right only at `scrollY === 0` has
 *  not been tested (§3.G5). */
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

/** Wait until the clip is AT the target and not seeking.
 *
 *  `video.seeking === false` is not a precondition on its own — it is already
 *  false before the scrub's requestAnimationFrame runs, so waiting on it returns
 *  instantly and the screenshot captures a frame the reader never saw. And
 *  `requestVideoFrameCallback` fires on 1 of 5 seeks here, because a PAUSED video
 *  that is seeked does not reliably present in headless Chrome.
 *
 *  So this polls for the precondition (at the target, not seeking) rather than for
 *  the assertion. The ceiling still returns and the result is reported: a scrub
 *  that never lands is a finding, not something to swallow.
 */
async function seekSettled(target, tolerance = 0.15) {
  const deadline = Date.now() + 8000;
  let stable = 0;
  while (Date.now() < deadline) {
    const st = await ev(`(() => {
      const v = document.getElementById('home-hero-video');
      return { t: v.currentTime, seeking: v.seeking };
    })()`);
    /* THE PRECONDITION IS "AT THE TARGET AND NOT SEEKING", NOT "IT MOVED".
     *
     * Polling for the value to change is impossible for a scroll that asks for
     * where you already are (the 0% stop on a fresh load, the scrollTo(1) after a
     * run that ended at 1), and it burns the full 8s ceiling each time. A poll
     * must be on a precondition of the thing asserted, or it is a fixed sleep
     * with extra steps (§3.G5, §3.B2).
     *
     * The two-consecutive-stable requirement stays as the margin against
     * `currentTime` reaching its target before the compositor has presented the
     * frame; without it the screenshot captures the wrong frame. */
    stable = (!st.seeking && Math.abs(st.t - target) <= tolerance) ? stable + 1 : 0;
    if (stable >= 2) return { landed: true, at: st.t };
    await new Promise((r) => setTimeout(r, 60));
  }
  return { landed: false, at: await ev(`document.getElementById('home-hero-video').currentTime`) };
}

/** Scroll, wait for the seek to complete. One argument, no options: an option
 *  that means "skip the flaky part" is how a flaky measurement stops being
 *  questioned. */
async function scrollTo(fraction) {
  const target = await ev(`document.getElementById('home-hero-video').duration * ${fraction}`);
  await ev(`(() => {
    const t = document.querySelector('.home-hero');
    const r = t.getBoundingClientRect();
    const range = r.height - window.innerHeight;
    window.scrollTo(0, window.scrollY + r.top + range * ${fraction});
  })()`);
  /* Under reduced motion the track is one viewport, so `range` is 0 and a
   * fractional scroll of it goes nowhere; `scrollY > 0` would then time out on a
   * page that has correctly stopped moving. This guard stops a future caller from
   * walking back into that. */
  if (await ev(`window.scrollY`) === 0 && fraction > 0) return seekSettled(target);
  await until(ev, `window.scrollY > 0`, 3000);
  return seekSettled(target);
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
/* ONE pass over the five stops, measuring the scrub AND the ink there. Each
 * scrollTo carries an 8s seek ceiling, so visiting each stop twice is pure cost.
 * The two measurements share nothing — one is the scrub's own output, the other
 * the composited result — and sharing a scroll position is not sharing an
 * assertion. */
const marks = [];
const ink = {};
const MIDDLE_STOPS = [0.25, 0.5, 0.75];
/* The band's premise, asserted rather than assumed: an opaque panel inside the
 * crop answers every ink measurement with its own fill, which is a green run
 * about the clip that measured the panel. */
const panelRect = await ev(`(() => {
  const r = document.querySelector('.home-hero-content').getBoundingClientRect();
  return { right: r.right, top: r.top };
})()`);
ok(panelRect.right < MEDIA_BAND.x || panelRect.top > MEDIA_BAND.y + MEDIA_BAND.height,
  `the ink band clears the content panel (panel right ${Math.round(panelRect.right)} vs band left ${MEDIA_BAND.x})`,
  'the ink band overlaps the opaque panel, so every figure below measures the panel rather than the clip');
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  const landed = await scrollTo(f);
  /* EVERY stop is asserted, including 0%. Exempting it and waiting for movement
   * instead of position burns the 8s ceiling while asserting nothing; since
   * `seekSettled()` polls for the position, all five land. */
  ok(landed.landed, `the seek for ${Math.round(f * 100)}% completed and the clip came to rest at ${landed.at.toFixed(2)}s`,
    'the scrub never settled at this scroll position — the clip did not reach its target within 8s, so the frame being measured is not one this checker can name');
  const st = await videoState();
  marks.push(st);
  ok(Math.abs(st.progress - f) < 0.06, `scrolled to ${Math.round(f * 100)}% of the track (measured ${Math.round(st.progress * 100)}%)`);
  const r = await inkFraction(MEDIA_BAND);
  ink[f] = r.ink;
  ok(r.px > 10000, `the ink band at ${Math.round(f * 100)}% sampled ${r.px} real pixels`,
    'the band crop was empty, so the ink figure below is measuring nothing');
}
const endsInk = { 0: ink[0], 1: ink[1] };
const middleInk = Object.fromEntries(MIDDLE_STOPS.map((f) => [f, ink[f]]));

for (let i = 1; i < marks.length; i++) {
  ok(marks[i].currentTime > marks[i - 1].currentTime,
    `clip advanced from ${marks[i - 1].currentTime.toFixed(2)}s to ${marks[i].currentTime.toFixed(2)}s between ${Math.round((i - 1) / 4 * 100)}% and ${Math.round(i / 4 * 100)}%`);
}
/* The identity the static half cannot check: currentTime is progress times
 * duration, no offset, no easing. A loose tolerance here would be satisfied by a
 * merely monotonic scrub — the bug this is written for. */
const worstErr = Math.max(...marks.map((m) => Math.abs(m.currentTime - m.progress * m.duration)));
ok(worstErr < 0.25,
  `currentTime equals progress x duration at every stop (worst error ${worstErr.toFixed(3)}s)`,
  'a small offset here is the `- innerHeight` term disappearing: the clip still moves, it just stops short of the end');
ok(marks[marks.length - 1].currentTime > marks[marks.length - 1].duration * 0.9,
  `the clip reaches the last 10% of itself (${marks[marks.length - 1].currentTime.toFixed(2)}s of ${marks[marks.length - 1].duration}s) — the tail of the clip is unreachable when the range omits innerHeight`);

console.log('\n--- scrolling back runs the clip in reverse ---');
at('the reverse scrub');
await scrollTo(1);

/* THE CLIP OPENS ON A BLANK FRAME, AND WHETHER IT IS SEEN DEPENDS ON HOW YOU GOT
 * THERE.
 *
 * make_hero_video.py builds the roster across the first 65% of the clip and fades
 * it out over the last 13%, so frames 0 and 299 both contain no sprites: measured
 * offline off the shipped bytes, frame 0 = 0.00% ink and frame 299 = 0.00% in
 * this band, against frame 195 = 23.01%. The author kept the full clip
 * (維持 0%→100%) rather than re-mapping the scrub onto the wave.
 *
 * The 0% stop therefore has two legitimate answers. LANDING on a fresh load:
 * `MIN_SEEK_DELTA` makes `seek()` refuse to write a currentTime within one frame
 * of where it already is, so no write happens, no frame is presented, and the
 * compositor still shows the POSTER (the completed roster at POSTER_FRACTION
 * 0.65, measured 22.75%). ARRIVING back from 30%: currentTime was 3.0s, far more
 * than a frame from 0, so the write happens, frame 0 is presented, and the band
 * reads 0.00%.
 *
 * So this asserts only the part that is NOT a race — the clip is parked on frame
 * 0 — and the arrival below, that a reader who scrolls can still reach the blank
 * frame. §3.F's rule for a named exception holds: if the scrub is ever re-mapped
 * onto the wave, the blank end goes red rather than the declaration quietly
 * becoming true of nothing. */
const atZero = marks[0];
ok(atZero.currentTime <= 1 / 30 && atZero.readyState >= 2,
  `the clip IS parked on frame 0 at the top of the track (currentTime ${atZero.currentTime.toFixed(3)}s, readyState ${atZero.readyState}) — the picture on screen is not that frame`,
  `currentTime is ${atZero.currentTime.toFixed(3)}s at 0% of the track, so the scrub has not moved the clip at all here. If this is red the band figure below is about something other than the 0% stop`);
ok(endsInk[1] < INK_EMPTY,
  `100% of the track is blank, as declared (${(endsInk[1] * 100).toFixed(2)}% ink against a background of 0.00%)`,
  `the 100% end now shows ${(endsInk[1] * 100).toFixed(2)}% ink — the scrub is no longer reaching 1, so the declaration no longer describes it. Either update the declaration or restore the full-clip scrub`);
console.log(`       (the 0% stop read ${(endsInk[0] * 100).toFixed(2)}% ink — poster or blank frame 0, whichever this run raced to. Neither is asserted; see the note above and the arrival check below.)`);
for (const f of MIDDLE_STOPS) {
  ok(middleInk[f] > INK_PRESENT,
    `${Math.round(f * 100)}% of the track has the roster on screen (${(middleInk[f] * 100).toFixed(1)}% ink)`,
    'the hero is blank in the middle of its own scrub range — every frame between the two declared empty ends is empty, which no reading of "keep the full clip" produces');
}

/* THE HERO REPAINTS, asserted from the ink figures rather than from a second
 * screenshot of its own pixels. A second screenshot of a quantity measured above
 * is the flakier sample and, per §3.W, a second count standing in for a claim is
 * how a guard stops being about the thing it names. The band reads ~24% in the
 * middle and 0.00% at the blank end, which is what "the hero repaints" means.
 *
 * The claim is NOT "every figure differs": the 0% and 100% ends are equal by
 * declaration — frames 0 and 299 are both blank — so what must differ is the
 * middle from itself, the only part of the range without an exception. */
const middleFigures = Object.values(middleInk);
ok(new Set(middleFigures.map((v) => v.toFixed(3))).size > 1,
  `the middle of the scrub range changes frame (${middleFigures.map((v) => (v * 100).toFixed(1) + '%').join(' ')}) against ${(endsInk[0] * 100).toFixed(2)}% at the landing end and ${(endsInk[1] * 100).toFixed(2)}% at the blank one`,
  'all three middle stops produced the same ink — the media layer is not following the reader: currentTime can move while the same frame stays on screen');

const before = (await videoState()).currentTime;
await scrollTo(0.3);
const after = (await videoState()).currentTime;
ok(after < before - 0.5, `scrolling up moved the clip backwards (${before.toFixed(2)}s -> ${after.toFixed(2)}s)`,
  'the scrub only runs forwards — this is the free consequence of writing currentTime rather than calling play(), and it is worth measuring rather than asserting');

/* THE COMPANION TO THE LANDING END. ARRIVING from above performs a real write —
 * currentTime was 3.0s, far more than one frame from 0 — so frame 0 is presented
 * and the band empties. LANDING leaves the poster because no write happens. The
 * reader opens on a finished roster and fades to a blank field at the top, which
 * is the scrub working.
 *
 * The arrival is the half that carries the risk: MIN_SEEK_DELTA growing, or
 * `seek()` gaining an early return, would park the reader on the poster with no
 * way to reach frame 0, while the identity, the monotonicity and the middle stops
 * all still pass. Assert the ARRIVAL, the state the page is in after the scrub is
 * actually used. */
await scrollTo(0);
const arrivedInk = (await inkFraction(MEDIA_BAND)).ink;
ok(arrivedInk < INK_EMPTY,
  `arriving back at the top from 30% DOES reach the blank frame 0 (${(arrivedInk * 100).toFixed(2)}% ink) — so the poster is a landing state, not a permanent one`,
  `scrolled back to 0% and the band still reads ${(arrivedInk * 100).toFixed(2)}% ink, so frame 0 is unreachable and the reader is parked on the poster however far they scroll. MIN_SEEK_DELTA in home-hero.js is one frame at 30fps; if it has grown past the clip's own seek deltas this is what it looks like`);

at('reduced motion');
console.log('\n--- reduced motion freezes the clip and collapses the track ---');
ok(await openIndex(true), 'the page booted with prefers-reduced-motion: reduce emulated');

/* NOTHING IN THIS SECTION CALLS `scrollTo()`. Under reduced motion the clip is
 * frozen on purpose, so a wait for a seek to land can only run out its 8s
 * ceiling; waiting for something impossible by construction, in the section whose
 * subject is that the clip does not move, is §3.G5 arriving as cost.
 *
 * Instead this scrolls the DOCUMENT and asserts the clip stayed put, waiting on
 * the precondition (the freeze landed at boot, the scroll was applied). */
const frozeAtBoot = await until(ev, `(() => {
  const v = document.getElementById('home-hero-video');
  return !!v && v.readyState >= 1 && Number.isFinite(v.duration)
      && Math.abs(v.currentTime - v.duration * 0.65) < 0.2;
})()`, 8000);
ok(frozeAtBoot, `the clip froze on the poster frame at boot, 65% in, before anything is scrolled`,
  'the freeze never landed: under reduced motion the clip is seeked once to POSTER_FRACTION and left there, so a clip that is not there after 8s is not frozen at all');

const rm0 = await videoState();
ok(rm0.trackH <= DESKTOP.height * 1.02,
  `the track is one viewport tall (${rm0.trackH}px vs ${DESKTOP.height}px) — 1.4 viewports of scroll past a still image is a dead zone`,
  'the track keeps its scrub height under reduced motion, so the reader scrolls through empty space');
const frozen0 = rm0.currentTime;

/* 600px rather than a fraction of the track: under reduced motion the track is
 * one viewport, so `progress()` divides by a zero range and a fractional scroll
 * goes nowhere. The document is what scrolls, which is what the reader scrolls;
 * the claim is that the hero does not come along. */
await ev(`window.scrollTo(0, 600); true`);
await until(ev, `window.scrollY > 0`, 3000);
await new Promise((r) => setTimeout(r, 250));
const rm1 = await videoState();
ok(Math.abs(rm1.currentTime - frozen0) < 0.05,
  `currentTime did not move across a 600px scroll (${frozen0.toFixed(3)}s -> ${rm1.currentTime.toFixed(3)}s)`,
  'the scrub ran under reduced motion, which is motion at any speed');
// It froze SOMEWHERE, and "somewhere" is the claim: the frame the poster was cut
// from. A freeze at frame 0 is an empty dark rectangle that looks like a working
// hero and is not one (§3.G3).
ok(Math.abs(rm1.currentTime - rm1.duration * 0.65) < 0.2,
  `it froze on the poster frame, ${(rm1.currentTime / rm1.duration * 100).toFixed(0)}% in (expected 65%)`,
  'the freeze landed on frame 0, which is an empty background rather than the roster — the reduced-motion hero would be a dark rectangle');
ok(await ev(`!document.querySelector('.home-hero-scroll-chevron') || getComputedStyle(document.querySelector('.home-hero-scroll-chevron')).animationName === 'none'`),
  'the scroll hint\'s chevron is not animating');

at('contrast: the analytic bound');
console.log('\n--- the text is readable over every frame the reader passes ---');
/* NOT "the end of the track". make_hero_video.py's timeline ends with `fade_end`
 * at 0.967 and a ten-frame empty hold, so progress 1.0 (frame 299) is an empty
 * dark field — measuring there reports a confidently wrong ratio. The clip's
 * brightest moment is the wave (0.65-0.86), where WAVE_GAIN lifts every sprite,
 * so the worst case is sampled across the wave. */
const wc = await worstCaseContrast();
ok(wc.alpha > 0 && wc.alpha <= 1, `the panel's fill was read off the live computed style (alpha ${wc.alpha})`);
ok(wc.ratio >= 4.5,
  `the h1 reads at ${wc.ratio.toFixed(2)}:1 against the WORST frame the clip can show — the panel composited over pure white (${wc.ink} on ${wc.ground})`,
  `below WCAG AA's 4.5:1 at alpha ${wc.alpha}. This is the bound no frame can exceed, so a red here is a red for every frame, not for one scroll position`);

/** The h1's contrast against the WORST frame the clip could show.
 *
 *  The panel is `rgba(6, 9, 20, 0.7)` over an arbitrary frame and a sprite can be
 *  any colour up to pure white, so the upper bound on the ground behind the title
 *  is the panel composited over (255,255,255) — a figure that depends on no
 *  frame, no scroll position and no pixel sampling.
 *
 *  The alpha and panel colour come from the LIVE computed style. §3.C forbids
 *  computed style for the FINAL composited result, which the second measurement
 *  below takes from real pixels; reading the alpha is reading a declaration,
 *  reading the ground is reading a screen.
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
 *  §3.C's rule. The crop is the strip of panel between its own top edge and the
 *  top of the h1 — padding, no glyph, immediately adjacent — so it is the
 *  composite the title sits on. Cropping the WHOLE panel and taking the brightest
 *  pixel measures the gold title against itself, because `#f5c542` is L=241: a
 *  brightest-pixel search inside a box containing the text can only find the
 *  text.
 *
 *  Reported alongside worstCaseContrast() rather than instead of it: one can be
 *  fooled, one cannot, and keeping only the unfoolable one stops measuring the
 *  page. */
async function panelContrast(label) {
  const box = await ev(`(() => {
    const panel = document.querySelector('.home-hero-content');
    const h1 = document.querySelector('.home-hero-title');
    const pr = panel.getBoundingClientRect();
    const hr = h1.getBoundingClientRect();
    const r = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
    return {
      /* Inset by the corner radius on BOTH sides. Without it the strip also
       * contains the two rounded corners, where there is no panel and the raw
       * clip shows through. A brightest-pixel search needs a region entirely
       * made of the thing it measures. */
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
    /* `clip` names its fields `width`/`height`, not `w`/`h`: CDP rejects the
     * short names with "mandatory field missing at position 58", which names no
     * field. */
    format: 'png', clip: { ...await pageRect(box), scale: 1 },
    captureBeyondViewport: false,
  });
  const png = Buffer.from(shot.data, 'base64');
  /* Decode in-page rather than adding a PNG decoder: the page's own canvas turns
   * the bytes into pixels, so only the NUMBERS come back. */
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
     * must be converted rather than handed to rel() directly — passing L=16 as a
     * relative luminance above 1 reports absurd ratios like 1908:1. */
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

clearTimeout(watchdog);
closeSection();
printSectionCosts();

/* THIS IS THE HANG, AND IT IS NOT A CDP HANG.
 *
 * The checks finish in well under a minute; the PROCESS does not. Nothing here
 * killed Chrome or called process.exit, so the CDP WebSocket and the spawned
 * child kept the event loop alive indefinitely. A checker that has printed its
 * verdict and then holds the pool open looks, from outside, identical to one
 * still working: a running row, nothing written to the cache, the pool never
 * draining.
 *
 * `chrome.kill()` before the exit is not belt and braces: killing the browser
 * releases the child handle, and `exit(0)` alone would leave an orphan Chrome
 * rendering nothing forever (§3.J, a different trigger). */
ws.close();
try { chrome.kill(); } catch { /* already gone */ }

if (fails.length) {
  console.log(`\n${fails.length} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`\nPASS  ${checks} browser checks`);
process.exit(0);