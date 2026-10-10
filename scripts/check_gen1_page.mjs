#!/usr/bin/env node
/**
 * Browser checks for cries-gen1.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_gen1_page.mjs        (needs the repo served on :5500)
 *
 * These are the claims no static checker can make. The APU is verified against the
 * reference synthesiser's own output in check_gen1_apu.mjs; what is verified here is
 * that the PAGE says true things about it and that the playback affordances move.
 * Two of these assertions exist because the corresponding bugs shipped once: the
 * lane label read 播放中 for every unmuted channel, which was never true, and the
 * playhead's guard was `startedAt > 0` when the audio clock legitimately reads 0 on
 * the first play, so the cursor never appeared at all.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MUTE_TAP, TAP_PROBE } from './lib/mute-tap.mjs';
import { CHROME, cdpPort, assertPortFree } from './lib/cdp-port.mjs';


const CDP = cdpPort('gen1');
await assertPortFree('check_gen1_page.mjs', CDP);
const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required',
  /* Silent at the BROWSER, not on the page. This checker presses play, and the
   * page's default is a fifth of full scale — comfortable at a desk, genuinely
   * startling in a room. Muted here rather than by setting the volume slider to
   * zero, because a zeroed slider would mean the playback test exercises silence,
   * and the claim being tested is that pressing play reaches the synthesiser and
   * moves a cursor. The AudioContext still runs; only the output is discarded, so
   * nothing can hide behind it.
   *
   * `--mute-audio` alone is the FIRST line rather than the guarantee, so the
   * second is installed in the page: see scripts/lib/mute-tap.mjs for why a flag
   * that nobody verifies is not one. */
  '--mute-audio',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });
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
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopChrome(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}


async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('chrome never came up');
}

const targets = await cdpTargets();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  waiting.set(n, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});

/* The mute, installed before any page script runs — so it cannot be raced by the
 * page's own module scope, and so a page that constructs an AudioContext during
 * boot is already covered. */
await send('Page.addScriptToEvaluateOnNewDocument', { source: MUTE_TAP });
await send('Page.navigate', { url: `http://localhost:${process.env.CRY_PORT || 5500}/cries-gen1.html` });
/* Was a fixed 3500 ms. The picker builds its 151 chips after load fires, so this
 * waits for the chips rather than for a duration; the ceiling is 20 s. */
await until(`document.readyState === 'complete' && document.querySelectorAll('#groups .cg-chip').length > 0`, 20000);

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

/** Poll a page expression until it is truthy. Returns whether it ever became so.
 *
 *  Same helper, same two guarantees, as the one in check_cries_browser.mjs and
 *  check_spectrum_browser.mjs: every ceiling used below exceeds the sleep it
 *  replaces, so tolerance only goes UP; and a timeout returns false, so the
 *  assertion after it still runs and still reports its real measurement. There is
 *  no flag that skips a check here.
 *
 *  Declared as a `function` rather than a `const` arrow on purpose: `evalJs` and
 *  the 3500 ms navigation wait below are ordered the other way round in this file,
 *  and a `const` helper above its first use is the temporal-dead-zone error that
 *  cost a run here. Function declarations hoist, so the order stops mattering. */
async function until(expression, ceilingMs, step = 60) {
  const deadline = Date.now() + ceilingMs;
  for (;;) {
    let v;
    try { v = await evalJs(expression); } catch { v = false; }
    if (v) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}

/** The play button's own state, which is what "playback started/stopped" means on
 *  this page — the same attribute `cry-autoplay.js` sets for its switch. */
const playingIs = (want) =>
  until(`document.getElementById('play')?.getAttribute('aria-pressed') === '${want}'`, 8000);

let pass = 0; const fails = [];
const ok = (c, w) => { if (c) pass++; else fails.push(w); console.log(`  ${c ? 'ok  ' : 'FAIL'} ${w}`); };
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want),
  `${what}${JSON.stringify(got) === JSON.stringify(want) ? '' : ` (got ${JSON.stringify(got)})`}`);

const init = await evalJs(`(() => ({ groups: document.querySelectorAll('.cg-group').length, notes: document.querySelectorAll('.cg-note').length, cur: document.getElementById('cur-name')?.textContent, canvasW: document.getElementById('wave')?.width, lanes: document.querySelectorAll('.cg-lane[data-ch]').length, states: [...document.querySelectorAll('.cg-lane-state')].map(e=>e.textContent), staff: !!document.querySelector('.cg-staff'), head: !!document.querySelector('.cg-playhead'), loopTxt: document.body.textContent.includes('sound_loop') && document.body.textContent.includes('總次數') }))()`);
ok(init.groups === 38, `38 base groups rendered (got ${init.groups})`);
ok(!!init.cur, `current species shown (${init.cur})`);
ok(init.canvasW > 0, `waveform canvas sized (${init.canvasW}px)`);
ok(init.lanes === 3, `3 channel lanes (got ${init.lanes})`);
ok(init.staff && init.head, 'the staff and its playhead both exist');
/* Only the three CHANNELS have a mute state. The mix row's gutter cell is a label
 * reading 三條聲道相加 and must never claim to be a live state, the same rule that
 * stopped the lanes from reading 播放中 while idle. */
ok(init.states.filter((t) => t !== '三條聲道相加').every((t) => t === '啟用' || t === '靜音'),
  `channel lane states are 啟用/靜音, never 播放中 (${init.states.join('/')})`);
ok(init.states.filter((t) => t === '三條聲道相加').length === 1,
  'and the mix row is labelled as the sum, not as a state');
/* Every chip in the base-cry picker carries the species' own front sprite, so a
 * group reads as a row of Pokémon rather than a row of names.
 *
 * The check is on the BINDING, not on how many images have finished arriving. All
 * 151 are loading="lazy" and the panel is long, so after a few seconds only some
 * 50 of them have decoded — an earlier version of this asserted "every sprite in
 * the viewport has decoded" and failed, which measured Live Server's throughput and
 * not the page. The one image that IS required to be decoded is the selected
 * species': it is the one the reader is looking at, and a wrong path or a 0x0
 * decode is the only failure mode this can catch. */
const chips = await evalJs(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    const cur = document.querySelector('#groups .cg-chip.is-current .cg-chip-sprite');
    if (cur && cur.complete) break;
    await wait(150);
  }
  const list = [...document.querySelectorAll('#groups .cg-chip')];
  const imgs = list.map((b) => b.querySelector('.cg-chip-sprite')).filter(Boolean);
  return {
    chips: list.length,
    withSprite: imgs.length,
    /* The binding itself: the file asked for is THIS species' own sprite. */
    boundToSpecies: imgs.filter((i) =>
      i.getAttribute('src') === 'assets/images/sprite/' + i.closest('.cg-chip').dataset.species + '.png').length,
    lazy: imgs.filter((i) => i.getAttribute('loading') === 'lazy').length,
    currentLoaded: (() => {
      const i = document.querySelector('#groups .cg-chip.is-current .cg-chip-sprite');
      return !!i && i.complete && i.naturalWidth === 96;
    })(),
  };
})()`);
ok(chips.chips === 151, `every one of the 151 species is a chip (${chips.chips})`);
eq(chips.withSprite, chips.chips, 'and every chip has a sprite');
eq(chips.boundToSpecies, chips.chips,
  'and each one asks for its OWN species, not a shared placeholder');
eq(chips.lazy, chips.chips, 'and all lazy-loaded, because 151 of them render at once');
ok(chips.currentLoaded, 'the selected species\' sprite decodes at 96px, so the binding is not just well-formed');

ok(init.loopTxt, 'the page discloses what sound_loop does');
const bodyHtml = await evalJs('document.body.innerHTML');
ok(!/cmd\.count - 1/.test(bodyHtml), 'and does not claim one extra repetition');

// The selected species' group must be open.
const grp = await evalJs(`(() => { const d=[...document.querySelectorAll('.cg-group')]; const cur=document.getElementById('cur-name').textContent; const zh = cur.split(' · ')[0]; const hit=d.find(g=>g.open && g.textContent.includes(zh)); return { openCount: d.filter(x=>x.open).length, found: !!hit }; })()`);
ok(grp.found, 'the current species\' group is open after load');
/* EXACTLY one, and it is the current species'. Small groups used to be open too, so
 * the picker loaded with 24 of its 38 disclosures expanded and read as a wall of
 * chips rather than as 38 choices. A disclosure the reader did not open is noise;
 * the one exception is the group the reader is currently looking at. */
eq(grp.openCount, 1, `and it is the ONLY group open (${grp.openCount} open)`);
/* Compared against whatever the page says is current, not against a literal name:
 * the default species is a page decision and hard-coding it here would make this
 * fail for the wrong reason the day it changes. */
const openIsCurrent = await evalJs(`(() => {
  const o = [...document.querySelectorAll('.cg-group[open]')];
  if (!o.length) return null;
  const chip = o[0].querySelector('.cg-chip.is-current');
  const cur = document.getElementById('cur-name').textContent.split(' · ')[0];
  return !!chip && chip.textContent.trim() === cur;
})()`);
ok(openIsCurrent, 'the open group is the one containing the current species');

// Noise notes must have real length (the zero-length timeline bug).
const noise = await evalJs(`(() => { const lane=document.querySelector('.cg-lane[data-ch="8"]'); const bars=[...(lane?lane.querySelectorAll(".cg-note-bar"):[])]; return { n: bars.length, zero: bars.filter(b=>parseFloat(b.style.width)===0).length }; })()`);
ok(noise.n > 0, `noise notes are drawn (${noise.n} bars)`);
ok(noise.zero === 0, `and none of them is zero-width (${noise.zero} were)`);

// Play, then confirm the cursor actually moves.
await evalJs(`document.getElementById('play').click()`);
await new Promise((r) => setTimeout(r, 120));
const a = await evalJs(`document.querySelector('.cg-playhead').style.transform`);
await new Promise((r) => setTimeout(r, 400));
const b = await evalJs(`document.querySelector('.cg-playhead').style.transform`);
ok(a !== b, `playhead moves during playback (${a} -> ${b})`);
ok(a !== 'translateX(0px)', 'and it leaves the origin immediately');

const playing = await evalJs(`document.getElementById('play').getAttribute('aria-pressed')`);
ok(playing === 'true', 'play button reflects playing state');

/* The mute is a claim like any other, so it is asserted rather than assumed — the
 * failure mode of a mute that quietly stopped working is a cry at a fifth of full
 * scale and a green run, which is the worst pair available. Placed HERE, after the
 * first press, because the AudioContext is built lazily on play and a probe before
 * that would be reading a tap that has not been asked to do anything yet.
 *
 * `gain` is read back off the live AudioParam, so this asks whether the output is
 * muted NOW rather than whether the script once set a number. See
 * scripts/lib/mute-tap.mjs. */
const tap = await evalJs(TAP_PROBE);
ok(tap.taps > 0 && tap.gain === 0,
  `playback is muted at the destination, measured (${tap.taps} AudioContext(s), gain ${tap.gain}${tap.error ? `, ${tap.error}` : ''})`);

// Selecting another species in the SAME group must not collapse that group.
const sel = await evalJs(`(() => {
  const cur = document.getElementById('cur-name').textContent;
  const g = [...document.querySelectorAll('.cg-group')].find(x => x.open && x.textContent.includes(cur.split(' · ')[0]));
  const other = [...g.querySelectorAll('[data-species]')].find(b => !b.classList.contains('is-current'));
  const id = other.dataset.species;
  other.click();
  return { id, name: other.textContent };
})()`);
/* Was a fixed 400 ms, then compared `cur-name` against what was just clicked.
 * Polled on the page's own selection state — the `is-current` class moving to the
 * clicked chip — rather than on `cur-name` matching, because the latter IS the next
 * line's assertion and waiting for it would make the check pass by construction. The
 * rendered text is still compared independently, which is the actual claim. */
await until(`[...document.querySelectorAll('#groups .cg-chip')].some((b) => b.dataset.species === ${JSON.stringify(String(sel.id))} && b.classList.contains('is-current'))`, 8000);
const after = await evalJs(`(() => {
  const d = document.getElementById('cur-name').textContent;
  const g = [...document.querySelectorAll('.cg-group')].find(x => x.textContent.includes(d.split(' · ')[0]));
  return { cur: d, anyOpen: [...document.querySelectorAll('.cg-group')].some(x => x.open) };
})()`);
ok(after.cur.split(' \u00b7 ')[0] === sel.name, `selecting a species switches to it (${after.cur})`);
ok(after.anyOpen, 'and some group stays open afterwards');

/* The lane stack: one row per channel, each carrying a waveform AND that
 * channel's note bars. Counted by ALPHA over the whole canvas, because a blank
 * canvas is transparent and a drawn one is not — see §4. */
const lanes = await evalJs(`(() => {
  const INK = (c) => { const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=0;i<d.length;i+=4) if (d[i+3]>0) n++; return n; };
  const mix = document.getElementById('wave').getBoundingClientRect();
  return [...document.querySelectorAll('.cg-lane[data-ch]')].map((f) => {
    const c = f.querySelector('canvas');
    const plot = f.querySelector('.cg-lane-plot').getBoundingClientRect();
    return {
      ch: f.dataset.ch,
      cap: f.querySelector('.cg-lane-name').textContent,
      state: f.querySelector('.cg-lane-state').textContent,
      ink: INK(c),
      border: getComputedStyle(c).borderTopWidth,
      bars: f.querySelectorAll('.cg-note-bar').length,
      // The waveform must be exactly as wide as the mix above it, or the two are
      // not describing the same interval.
      widthMatch: Math.abs(plot.width - mix.width) < 1.5,
      laneLeft: Math.round(plot.left - f.getBoundingClientRect().left),
    };
  });
})()`);
eq(lanes.length, 3, `three channel lanes, on top of the mix lane (${lanes.length})`);
eq(lanes.map((c) => c.ch), ['5', '6', '8'], 'and they are Ch5, Ch6 and Ch8');
/* The mix is row 0 of the SAME grid, not a separate canvas above it. That is what
   makes all four waveforms share a left edge: if the mix ever sat outside the
   staff, the two would be the same interval drawn at two different widths. */
eq(await evalJs(`[...document.querySelectorAll('.cg-lane')].length`), 4,
  'and the mix is the fourth row of the same staff, not a separate canvas');
ok(await evalJs(`document.querySelectorAll('.cg-lane-mix .cg-lane-plot canvas#wave').length === 1`),
  'the mix canvas is that row\'s plot, sharing the grid column');
ok(lanes.every((c) => c.ink > 500), `each waveform is drawn, not blank (${lanes.map((c) => c.ink).join(' / ')})`);
ok(lanes.every((c) => c.border === '0px'),
  `and they are borderless, like the reference (${lanes.map((c) => c.border).join(' / ')})`);
ok(lanes.every((c) => c.widthMatch),
  'each waveform is exactly as wide as the mix above it, so both describe the same interval');
ok(lanes.every((c) => c.bars > 0),
  `and each carries its own note bars on the same axis (${lanes.map((c) => c.bars).join(' / ')})`);
/* All four waveforms are the same instrument, so the mix must not be framed while
 * the three lanes under it are not — a border around only the first reads as four
 * unrelated widgets. */
const mixBorder = await evalJs(`getComputedStyle(document.getElementById('wave')).borderTopWidth`);
eq(mixBorder, '0px', 'and the mix waveform is borderless with them');

/* The note bars must be positioned in SECONDS while the waveform is drawn from
 * SAMPLES. The first version divided a note's start by the SAMPLE count, so a
 * 62,541-sample cry put every bar under 0.02% of the lane — seven bars stacked on
 * the left edge, and a check that only counted them saw nothing wrong. This one
 * reads the last bar's right edge, which is the only number that moves when the two
 * axes are conflated. */
const barSpan = await evalJs(`(() => {
  /* A MUTED channel is left out of the note list entirely — muting removes its
   * notes from what the timeline draws — so Ch5 has no bars at this point and is
   * skipped rather than read. */
  const rows = [...document.querySelectorAll('.cg-lane[data-ch]:not(.is-muted)')].map((f) => {
    const bars = [...f.querySelectorAll('.cg-note-bar')];
    const last = bars[bars.length - 1];
    if (!last) return { ch: f.dataset.ch, n: 0, right: 0 };
    return { ch: f.dataset.ch, n: bars.length, right: parseFloat(last.style.left) + parseFloat(last.style.width) };
  });
  const voice = [...document.querySelectorAll('.cg-lane[data-ch]:not(.is-muted)')].map((f) => {
    const c = f.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let last = -1;
    for (let x = c.width - 1; x >= 0 && last < 0; x--) for (let y = 0; y < c.height; y++) {
      if (d[(y * c.width + x) * 4 + 3] > 0) { last = x; break; }
    }
    return Math.round((last / c.width) * 100);
  });
  return { rows, voice };
})()`);
ok(barSpan.rows.every((r) => r.right > 55),
  `the last note in each lane ends well past the middle, so the bars share the waveform's axis (${barSpan.rows.map((r) => r.right.toFixed(0) + '%').join(' / ')})`);
ok(barSpan.rows.every((r, i) => Math.abs(r.right - barSpan.voice[i]) < 25),
  `and ends about where that channel's own waveform ends (${barSpan.voice.join('% / ')} of the lane)`);

/* The mix is drawn with the master volume undone. At the default of 3 the APU's
 * array is a fifth of full scale, so a mix drawn from it directly was a fifth of
 * the height it should be — and it changed shape as the reader dragged the volume
 * slider, which is not what a volume control is supposed to do to a picture of the
 * sound. Measured as ink coverage: a fifth-scale trace covers about a fifth of the
 * height. */
const mixInk = await evalJs(`(() => {
  const c = document.getElementById('wave');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
  return Math.round((n / (c.width * c.height)) * 100);
})()`);
ok(mixInk > 4,
  `the mix waveform is drawn at full scale, not at one fifth of it (${mixInk}% of the canvas inked)`);

/* Each slider must move the STATE FIELD it claims to move, and the Length slider
 * must move the AUDIO with it.
 *
 * The loop that wired them up was `state[id] = value` over `['pitch','length',
 * 'volume']`, which worked for two of the three and silently created a fourth
 * property for the third: the Length slider's key is `lengthSigned`. So the slider
 * did nothing at all — same bytes rendered, same duration, bit-identical audio —
 * while looking exactly like a working control.
 *
 * So this moves each slider and reads back the field it names. And for length the
 * observable is the SAMPLE COUNT, not the label: a label can follow a readout that
 * is not wired to anything, but the sample count is the audio's own length. */
const sliderState = await evalJs(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* scheduleRender() debounces by 90 ms, so every read has to wait for it — a
   * synchronous read after dispatching 'input' sees the PREVIOUS render, which is
   * indistinguishable from a slider that does nothing. */
  const set = async (id, v) => {
    const n = document.getElementById(id);
    n.value = String(v);
    n.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(220);
  };
  /* The count is printed with a thousands separator, so it is stripped BEFORE the
   * digits are matched. Matching digits off "62,541 個樣本" captured "541" — which
   * is not a smaller version of the right answer, it is a different number, and it
   * still scaled correctly with the slider, so nothing downstream could tell. */
  const samples = () => parseInt(
    document.getElementById('cur-meta').textContent.replace(/,/g, '').match(/(\\d+) 個樣本/)[1], 10);
  const val = (id) => document.getElementById(id).textContent;
  const out = {};
  await set('length', 0); out.lengthStart = samples();
  await set('length', -128); out.lengthFast = { samples: samples(), label: val('length-val'), hint: document.getElementById('length-hint').textContent };
  await set('length', 127); out.lengthSlow = { samples: samples(), label: val('length-val') };
  await set('length', 0);
  await set('pitch', 255); out.pitch = { label: val('pitch-val'), wraps: document.getElementById('wrap-count').textContent };
  await set('pitch', 0);
  await set('volume', 15); out.volume = { label: val('volume-val') };
  await set('volume', 3);
  return out;
})()`);

ok(sliderState.lengthFast.label.trim() === '-128',
  `the Length readout follows its slider (${sliderState.lengthFast.label})`);
ok(/0\.5/.test(sliderState.lengthFast.hint),
  `and the multiplier it reports changes with it (${sliderState.lengthFast.hint.slice(0, 24)}…)`);
ok(sliderState.lengthFast.samples < sliderState.lengthStart
   && sliderState.lengthSlow.samples > sliderState.lengthStart,
  `and the rendered AUDIO changes length with it (${sliderState.lengthStart} samples at 0, ${sliderState.lengthFast.samples} at -128, ${sliderState.lengthSlow.samples} at +127)`);
ok(sliderState.lengthFast.samples * 1.6 < sliderState.lengthSlow.samples,
  'by the ratio the length byte implies, not by a rounding wobble');
ok(sliderState.pitch.label.trim() === '255',
  `the Pitch readout follows its slider (${sliderState.pitch.label})`);
ok(sliderState.pitch.wraps !== '0',
  `and the wrap count it reports is recomputed (${sliderState.pitch.wraps} wrapped notes at pitch 255)`);
ok(sliderState.volume.label.trim() === '15 / 15',
  `the Volume readout follows its slider (${sliderState.volume.label})`);

/* A muted lane has to LOOK muted. Dimming gold by 0.28 alpha over a dark panel
 * still reads as gold, so the first version of this dimmed nothing a reader could
 * see — the lane was identical to an active one and the state was carried only by
 * the caption. Measured as a colour distance, because "it looks dimmer" is not
 * something a checker can be asked about. */
const laneColour = await evalJs(`(() => {
  /* A hard alpha cut-off would exclude the muted lane entirely — that is the whole
   * point of it — so the sample is over every non-transparent pixel and the mean
   * colour is taken of those. */
  const px = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r=0,g=0,b=0,n=0; for (let i=0;i<d.length;i+=4) if (d[i+3]>10) { r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; } return n ? [Math.round(r/n),Math.round(g/n),Math.round(b/n),n] : null; };
  const lane5 = document.querySelector('.cg-lane[data-ch="5"]');
  const wave = () => document.querySelector('.cg-lane[data-ch="5"] canvas');
  /* The lane-state toggle below may have left Ch5 muted, and this block toggles —
   * so start from unmuted or it would measure nothing. */
  if (lane5.classList.contains('is-muted')) document.querySelector('.cg-lane-toggle[data-mute="5"]').click();
  return new Promise((res) => setTimeout(() => res({
    before: px(wave()),
    after: null,
    other: px(document.querySelector('.cg-lane[data-ch="6"] canvas')),
  }), 300));
})()`).then(async (v) => {
  await evalJs(`document.querySelector('.cg-lane-toggle[data-mute="5"]').click()`);
  /* Was a fixed 400 ms, then sampled the lane's pixels. The page marks the lane
   * itself, so the wait is on that class rather than on the repaint having
   * finished guessing; the pixel sample below is still what is asserted. */
  await until(`document.querySelector('.cg-lane[data-ch="5"]')?.classList.contains('is-muted')`, 8000);
  v.after = await evalJs(`(() => {
    const c = document.querySelector('.cg-lane[data-ch="5"] canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r=0,g=0,b=0,n=0; for (let i=0;i<d.length;i+=4) if (d[i+3]>10) { r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; } return n ? [Math.round(r/n),Math.round(g/n),Math.round(b/n),n] : null;
  })()`);
  return v;
});
const dist = (a, b) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));
ok(laneColour.before && laneColour.after,
  `the muted lane's ink changes colour (${laneColour.before} -> ${laneColour.after})`);
ok(dist(laneColour.before, laneColour.after) > 30,
  `by enough to read as muted (Δ${dist(laneColour.before, laneColour.after)})`);
ok(dist(laneColour.after, laneColour.other) > 30,
  'and the muted lane is visibly different from an unmuted one');
/* Muting one channel must say so AND leave the waveform standing: a muted channel
 * is still rendered, which is exactly why it can be shown. The `laneColour` block
 * above leaves Ch5 muted, so this reads the state it left rather than clicking
 * again — a second click would un-mute it and there would be nothing to check. */
const mutedLane = await evalJs(`(() => {
  const f = document.querySelector('.cg-lane[data-ch="5"]');
  const c = f.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=0;i<d.length;i+=4) if (d[i+3]>0) n++;
  return {
    muted: f.classList.contains('is-muted'),
    state: f.querySelector('.cg-lane-state').textContent,
    pressed: f.querySelector('.cg-lane-toggle').getAttribute('aria-pressed'),
    ink: n,
  };
})()`);
ok(mutedLane.muted && mutedLane.state === '靜音' && mutedLane.pressed === 'true',
  `muting a channel marks its lane (${mutedLane.state})`);
ok(mutedLane.ink > 500, 'and leaves the waveform visible rather than blanking it');

/* The synthesised-not-recorded note belongs next to the thing it explains.
 *
 * It used to sit in the page footer, which is one screen below the transport and the
 * autoplay switch — so the reader hears a cry, presses play again, and only learns
 * a screen later that nothing here is a recording. It also means the page has no
 * footer of its own, so this is a real structural change and not a move.
 *
 * Read from `bodyHtml`, the served DOM, because this checker's `page` is the CDP
 * state object from the first eval — not the source. */
ok(!/class="site-footer"/.test(bodyHtml), 'the page no longer carries a footer of its own');
const picker = bodyHtml.match(/<aside class="cy-panel cg-picker"[^>]*>([\s\S]*?)<\/aside>/);
ok(!!picker && /即時合成/.test(picker[1]),
  'and the note saying the audio is synthesised lives in the picker');
ok(!!picker && picker[1].indexOf('id="groups"') < picker[1].lastIndexOf('即時合成'),
  'below the base-cry groups, where it reads as a footnote to them');
ok(!!picker && /叫聲總覽/.test(picker[1]),
  'and still points at the page that does hold recordings');
/* Air under the staff, so the first paragraph reads as a caption and not as part of
 * the plot. A margin, not padding: padding would push the text into the plot's own
 * box without separating them from it. Read from the loaded stylesheet rather than
 * from the file, so it is the value the cascade actually produced. */
const noteAfter = await evalJs(`(() => {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (r.selectorText === '.cg-note-after') return r.style.cssText;
  }
  return null;
})()`);
ok(!!noteAfter && /margin-top:\s*1[0-9]px/.test(noteAfter),
  `and there is real air between the waveforms and the prose under them (${noteAfter})`);

/* The waveforms must not inherit shared.css's canvas glow.
 *
 * That rule is a bare `canvas` element selector carrying `box-shadow: 0 0 25px
 * rgba(0,0,0,0.9)`, written for the maze canvas — a lit surface. It reaches every
 * canvas on the site, and on a 44px hairline trace a 25px black halo does not read
 * as a shadow, it reads as a heavy dark box around the lane. Measured on the
 * COMPUTED value rather than by reading the stylesheet, so a cascade change cannot
 * quietly bring it back. */
const shadow = await evalJs(`(() => {
  const g = (sel) => getComputedStyle(document.querySelector(sel));
  return { mix: g('#wave').boxShadow, lane: g('.cg-lane-wave').boxShadow, radius: g('.cg-lane-wave').borderRadius };
})()`);
eq(shadow.mix, 'none', 'the mix waveform carries no box-shadow');
eq(shadow.lane, 'none', 'and neither does a per-channel lane');
eq(shadow.radius, '0px', 'and no rounded panel either — this page draws lines');

/* Autoplay: ON by default, OFF means off, and it NEVER plays on load.
 *
 * The load case is the one that matters. select() is called at boot, on every
 * hashchange and by the reset button as well as from a chip click, so a switch read
 * inside select() would cry out on page load. The observable is the play button's
 * aria-pressed, which is the page's own record of whether it is sounding. */
const auto = await evalJs(`(() => {
  const sw = document.querySelector('#autoplay-slot [role="switch"]');
  return sw ? { present: true, role: sw.getAttribute('role'), on: sw.getAttribute('aria-checked'),
                text: sw.textContent.trim(), playing: document.getElementById('play').getAttribute('aria-pressed') } : { present: false };
})()`);
ok(auto.present, 'the autoplay switch is in the picker');
eq(auto.role, 'switch', 'and it is a switch with a checked state, not a bare button');
eq(auto.on, 'true', 'which is ON by default');
ok(/自動播放/.test(auto.text), 'and says so in its own label, so a page that sounds on click is not a surprise');
eq(auto.playing, 'false', 'nothing is sounding on load — the switch is ON but the page is silent');

await evalJs(`document.querySelector('[data-species]').click()`);
await playingIs('true');
eq(await evalJs(`document.getElementById('play').getAttribute('aria-pressed')`), 'true',
  'clicking a species plays it while the switch is on');

await evalJs(`document.querySelector('#autoplay-slot [role="switch"]').click()`);
await playingIs('false');
eq(await evalJs(`document.getElementById('play').getAttribute('aria-pressed')`), 'false',
  'turning the switch off stops whatever is sounding');
eq(await evalJs(`document.querySelector('#autoplay-slot [role="switch"]').getAttribute('aria-checked')`), 'false',
  'and the switch reports itself off');
const silentTarget = await evalJs(`(() => {
  const b = [...document.querySelectorAll('[data-species]')].find((x) => !x.classList.contains('is-current'));
  const id = b.dataset.species;
  b.click();
  return id;
})()`);
/* Was a fixed 300 ms. This one asserts the ABSENCE of playback, so it cannot wait
 * for the thing it is checking would not happen — there is no condition that would
 * ever make it true. It waits for the SELECTION to land instead (`is-current` moved
 * to the clicked chip), which is the page having done the thing whose consequence is
 * being checked. `playingIs('false')` is deliberately NOT used: it is already true
 * before the click, so it would return instantly and measure the pre-click state. */
await until(`[...document.querySelectorAll('#groups .cg-chip')].some((b) => b.dataset.species === ${JSON.stringify(String(silentTarget))} && b.classList.contains('is-current'))`, 8000);
eq(await evalJs(`document.getElementById('play').getAttribute('aria-pressed')`), 'false',
  'and a click with it off changes the species without making a sound');
ok(await evalJs(`document.getElementById('cur-name').textContent.length > 0`),
  'while still switching species');
await evalJs(`document.querySelector('#autoplay-slot [role="switch"]').click()`);

/* The intro's 6:4 split must leave the prose column AT LEAST its own measure.
 *
 * The paragraph is set to a 68ch measure, so a split that narrows the column below
 * that does not change the line breaks — it just makes the grid the binding
 * constraint, and the measure becomes a lie written in the stylesheet. 7:3 and 6:4
 * both pass at 1440px; this is here because the one that would fail is a narrower
 * viewport, where nothing else in the file would notice. */
const intro = await evalJs(`(() => {
  const body = document.querySelector('.cy-intro-body').getBoundingClientRect();
  const p = document.querySelector('.cy-intro p');
  const measure = parseFloat(getComputedStyle(p).maxWidth);
  /* The TRACK widths, not the sprite figure's box: justify-self:center shrinks
   * that box to its 112px of content, so measuring it reports a 9:1 split for a
   * grid that is set to 6:4. gridTemplateColumns resolves to the used track sizes
   * in px. */
  const tracks = getComputedStyle(document.querySelector('.cy-intro')).gridTemplateColumns
    .split(' ').map(parseFloat).filter((n) => !Number.isNaN(n));
  return {
    body: Math.round(body.width),
    measure: Math.round(measure),
    tracks: tracks.map(Math.round),
    ratio: tracks.length === 2 ? +(tracks[0] / tracks[1]).toFixed(2) : null,
    stacked: tracks.length === 1,
  };
})()`);
ok(intro.measure > 0 && intro.body >= intro.measure,
  `the prose column is at least its own 68ch measure (${intro.body}px column, ${intro.measure}px measure)`);
ok(intro.stacked || (intro.ratio > 1.3 && intro.ratio < 1.8),
  intro.stacked
    ? 'and the split is single-column at this width, as the narrow breakpoint intends'
    : `and the split is 6:4 rather than lopsided (${intro.ratio} : 1, ${intro.tracks.join(' / ')}px)`);

/* The intro sprite is the currently selected species, and it is the 96px sprite —
   the guaranteed floor — rather than the Scarlet/Violet artwork. */
const art = await evalJs(`(() => {
  const i = document.getElementById('intro-sprite');
  return { src: i.getAttribute('src'), ok: i.complete && i.naturalWidth === 96, cap: document.getElementById('intro-caption').textContent, alt: i.alt };
})()`);
ok(art.ok, `the intro sprite loads at 96px (${art.src})`);
ok(/assets\/images\/sprite\//.test(art.src), 'from the sprite directory, the floor for every species');
ok(/^#[0-9]{4} \S/.test(art.cap), `and is captioned with the selected species (${art.cap})`);
ok(art.alt.includes('Charizard') || art.alt.length > 1, 'with alt text naming it');

ok(logs.filter((l) => l.startsWith('EXCEPTION')).length === 0,
  `no uncaught exceptions${logs.filter((l) => l.startsWith('EXCEPTION')).length ? ': ' + logs.filter((l) => l.startsWith('EXCEPTION')).join(' | ') : ''}`);

console.log('');
console.log(fails.length ? `FAIL  ${fails.length} case(s) of ${pass + fails.length}` : `PASS  ${pass} checks`);
chrome.kill();
try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(fails.length ? 1 : 0);
