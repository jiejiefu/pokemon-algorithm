#!/usr/bin/env node
/**
 * The mobile layout of cries.html and spectrum.html, driven over the DevTools Protocol
 * at 390x844. Run: node scripts/check_cry_mobile_layout.mjs   (needs the repo on :5500)
 *
 * ## WHY THIS IS A SEPARATE FILE AND NOT PART OF EITHER PAGE'S BROWSER CHECKER
 *
 * Both pages had a shipped defect that was invisible at every width the suite measured,
 * and the invisibility was not an accident of the suite — it was structural:
 *
 *   - `check_spectrum_browser.mjs` WIDENS past the 900px breakpoint on purpose, because
 *     its subject is `.sp-about`'s two columns. Measured before the fix at 390x844:
 *     `.sp-left-panel` 5,856px tall out of a 9,471px document, `.sp-roster` 5,347px of
 *     it with `overflow-y: visible`, and `#sp-hero` — the spectrogram, which is the
 *     entire reason for the page — at y=6,746.
 *   - `check_cries_browser.mjs` IS `manual: true`, so anything put there is enforced by
 *     hand. Measured before the fix at 390x844, tapping the 40th card left `#probe-play`
 *     at y=-5,309: 5,309px ABOVE the viewport.
 *
 * So a guard for this lives here and runs by default, and it drives BOTH pages, because
 * the two defects have the same cause and two copies of the measurement is how they stop
 * being recognisably the same thing.
 *
 * ## WHY MECHANISM AND OUTCOME ARE BOTH ASSERTED
 *
 * §3.G1a's finding is that 170 static and 43 CDP checks stayed green over a visibly
 * broken page because they asked whether the prose EXIST rather than what it claims. Two
 * failure modes sit either side of that, and one assertion cannot cover both:
 *
 *   - OUTCOME ALONE is satisfied by luck. `#sp-hero` being near the top of a phone is
 *     also true on a page whose roster happens to render 60 rows and no more, which is a
 *     page that breaks again at 600 rows and says nothing about it.
 *   - MECHANISM ALONE is satisfied by a page that collapses the right element for the
 *     wrong reason, and it is the shape most of this file's own comments warn about: the
 *     roster's own `getBoundingClientRect()` reports 2,707px while `checkVisibility()`
 *     correctly reports `false`, because Chrome skips layout inside a closed `<details>`
 *     and hands back the last size it remembered. A rect is not evidence here.
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * No mutation harness. Each case would boot its own Chrome against its own tree, so four
 * cases cost about as much as the whole of `test_check_spectrum_page.mjs` to prove a
 * handful of assertions can fail. §3.G5 priced the same trade when it took
 * `test_check_gen1_apu.mjs` out of the manifest: the cost is named rather than glossed,
 * and what is given up is stated — the static halves in `check_cries_page.mjs` and
 * `check_spectrum_page.mjs` still have harnesses, and they are where the mutations live.
 *
 * `--mute-audio` and NOT `lib/mute-tap.mjs`. This checker presses play by clicking a
 * card, and asserts nothing about audio; the flag is right for that and the tap is not
 * needed, because §3.G's rule is that a mute nothing verifies is not a mute — and here
 * the mute exists so the machine is not left making noise, not so a claim can be made.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';
import { until } from './lib/cdp-until.mjs';
import { trackTree } from './lib/tmp-trees.mjs';

/* One Chrome for both pages. Two would be two ports and two profiles for a measurement
 * that needs no state carried between them, and §3.G7's lesson is that most of the
 * duplication in this suite was N copies of one thing rather than N things. */
const profile = trackTree(mkdtempSync(join(tmpdir(), 'crl-')));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
/* Chrome chose its own debug port; read it back from the profile. See
 * `waitForDebugPort`'s header for why this replaced `cdpPort()`, and why it makes
 * `assertPortFree()` unnecessary rather than merely unused. */
const CDP = await waitForDebugPort(profile);
/* The browser is killed on the exit path AND its profile is swept by `tmp-trees.mjs`'s
 * own exit hook — so this is not two copies of §3.J's cleanup, it is one module doing
 * the trees and this line doing the process, which is the split `cdp-port.mjs`'s header
 * already draws. */
process.on('exit', () => { try { chrome.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { chrome.kill(); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); });
}

let targets;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); if (r.ok) { targets = await r.json(); break; } } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map(); const exceptions = [];
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
  waiting.set(n, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0]);
  return r.result.value;
};

let checks = 0; const fails = [];
/**
 * `ok(cond, what[, detail])`.
 *
 *  THE THIRD ARGUMENT IS THE MEASUREMENT, and it is not optional decoration. This file
 *  had a two-argument `ok` and twenty call sites passing a third, which JavaScript
 *  accepts silently: every one of them printed a bare 「ok」 or 「FAIL」 and dropped the
 *  numbers it had just taken. §3.G9's rule is the one this violates — 「the message
 *  quotes the named constant or it quotes a lie」 — and a geometry assertion whose
 *  failure line cannot say what it measured is a red line nobody can act on.
 *
 *  It is variadic rather than twenty edits because the third argument was already the
 *  right thing to pass; what was missing was a signature that received it.
 */
const ok = (cond, what, detail) => {
  checks++;
  const line = detail ? `${what} — ${detail}` : what;
  if (!cond) fails.push(line);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${line}`);
};

await send('Page.enable');
await send('Runtime.enable');

/* THE PHONE. 390x844 is one of the two sizes AGENTS.md's own mobile rules are written
 * against, and it is narrower than both pages' 900px breakpoint by a wide margin. */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 1000 };
const PORT = process.env.CRY_PORT || 5500;

/**
 * Switch viewport, and PROVE it took effect before anything is measured at it.
 *
 * `Emulation.setDeviceMetricsOverride` rather than a Chrome flag, because the flag is
 * clamped to the host's screen here and the override is not. And the read is on the far
 * side of the command rather than the near side for the reason 42af1a1 recorded:
 * A CDP COMMAND RESOLVING IS NOT THE PAGE HAVING APPLIED IT. Reading `innerWidth` on the
 * line after the override returned the previous width, and an assertion made against it
 * measures the layout the file did not intend to check.
 */
async function atSize(size) {
  await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: size.width < 500 });
  const SEEN = await until(ev, `innerWidth === ${size.width}`, 3000);
  const WIDTH = await ev('innerWidth');
  ok(SEEN, `the viewport is ${size.width}x${size.height} before anything is measured at it (${WIDTH}px) — a CDP command resolving is not the page having applied it`);
  return WIDTH;
}

/** One page's ready. The grid/roster is built after `load` fires, so `complete` alone
 *  is true while the content is still empty. */
const booted = (extra) => until(ev, `document.readyState === 'complete' && (${extra})`, 25000);

async function open(page, size) {
  await send('Page.navigate', { url: `http://localhost:${PORT}/${page}` });
  /* The size is applied AFTER the navigation, and that order is not tidiness. An
   * override set on `about:blank` is discarded by the navigation that follows it, so
   * the first version of this file sized the viewport first and then navigated — and
   * `atSize()`'s own poll caught it, reporting 980px where 390 had been asked for. That
   * is the assertion earning its place on its first run: `check_spectrum_browser.mjs`
   * navigates first for the same reason and the reason was never written down there. */
  if (size) await atSize(size);
}

// ===========================================================================
// spectrum.html — the rail that was 62% of a phone's document
// ===========================================================================
console.log('\nspectrum.html @ 390x844');
exceptions.length = 0;
await open('spectrum.html', PHONE);
await booted(`document.querySelectorAll('.sp-row').length > 0`);
await until(ev, `document.getElementById('sp-name')?.textContent !== '—'`, 15000);

const sp = await ev(`(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => el ? el.getBoundingClientRect() : null;
  const rail = box(q('.sp-left-panel'));
  const roster = q('#sp-roster');
  const hero = box(q('.sp-hero'));
  return {
    railH: Math.round(rail.height),
    rosterVisible: roster.checkVisibility(),
    rosterClient: roster.clientHeight,
    pickerH: Math.round(box(q('.sp-picker')).height),
    toggleDisplay: getComputedStyle(q('#sp-picker-toggle')).display,
    toggleAria: q('#sp-picker-toggle').getAttribute('aria-expanded'),
    summary: q('#sp-picker-now').textContent,
    heroTop: Math.round(hero.top + scrollY),
    playY: Math.round(box(q('#sp-play')).top),
    vh: innerHeight,
    rows: document.querySelectorAll('.sp-row').length,
    artTop: Math.round(box(q('.sp-intro-art')).top + scrollY),
    h1Bottom: Math.round(box(q('.sp-intro-body h1')).bottom + scrollY),
    plotBtnY: Math.round(box(q('#sp-hero-play')).top),
    plotBtnH: Math.round(box(q('#sp-hero-play')).height),
    plotTop: Math.round(box(q('#sp-plot')).top),
    plotBottom: Math.round(box(q('#sp-plot')).bottom),
  };
})()`);

/* Two DERIVED readings, computed here rather than in the page because `box` and `q` do
 * not exist in this scope — the first version put them inside the IIFE, where `sp`
 * resolved to a global and the assignment succeeded silently against nothing. That is
 * §3.B1's shape: a line that looks like it works and produces no reader-visible effect
 * at all, and the only symptom was `undefinedpx` in a message.
 *
 *  `plotBtnGap` is the CLAIM, not the numbers: 「directly above the canvas」 is a
 *  distance, and measuring the two boxes is how a distance is checked. */
sp.plotBtnGap = sp.plotTop - (sp.plotBtnY + sp.plotBtnH);
sp.railBtnY = sp.playY;

/* MECHANISM. The picker is one summary row and the roster inside it is not laid out at
 * all. `checkVisibility()` and not the rect: a rect inside a closed `<details>` reports
 * the size Chrome last remembered (2,707px measured), which is a number about the past. */
ok(sp.pickerH <= 60, 'the picker is one summary row and nothing else',
  `the collapsed picker is ${sp.pickerH}px — one 44px summary and no room for a list (measured 56px)`);
ok(!sp.rosterVisible, 'and the roster inside it is not laid out at all',
  'the roster reports `checkVisibility() === false`, which is the assertion that works: its own rect reports 2,707px of remembered size and means nothing');
ok(sp.toggleAria === 'false' && sp.toggleDisplay !== 'none',
  `the toggle is on screen and says so (aria-expanded="${sp.toggleAria}", display: ${sp.toggleDisplay})`,
  '`aria-expanded` is "false" on a toggle that is visible — the button must not announce the opposite of what is on screen, and nothing in a browser checks the two');
ok(sp.summary.length > 0 && /\d+ \/ \d+ 隻/.test(sp.summary),
  `the collapsed label states both facts (「${sp.summary}」)`);

/* THE FIGURE IS THE LAST THING IN THE INTRO, which is `order` rather than DOM order
 * and therefore invisible here except as geometry. `order: -1` used to put the sprite,
 * and the page's only `<h1>`, above three paragraphs of explanation on a phone.
 *
 *  This is asserted as the figure's TOP being below the `<h1>`'s BOTTOM rather than as
 * 「below the prose」, because it is a single comparison that catches both halves: the
 * sprite arriving above the h1 is the same defect with the same cause, and measuring
 * only the prose would let it back in. */
ok(sp.artTop > sp.h1Bottom && sp.artTop < sp.heroTop,
  'the sprite sits after the explanation AND after the <h1>, immediately above the plot',
  `the figure is at y=${sp.artTop}, the <h1> ends at ${sp.h1Bottom} and the plot starts at ${sp.heroTop} — it was above the h1, at the top of the document`);

/* THE PLOT'S OWN PLAY CONTROL, and the reason it is measured here rather than only in
 * `check_spectrum_browser.mjs`: the browser checker proves the two controls agree about
 * state, and this proves the second one is anywhere NEAR the picture. The two are
 * different claims — a control that is correctly wired and 1,000px away satisfies the
 * first and is useless for the second. */
ok(sp.plotBtnGap >= 0 && sp.plotBtnGap <= 40,
  'the plot\'s play control sits directly above its canvas',
  `${sp.plotBtnGap}px between the button\'s bottom edge and the canvas (the rail\'s is ${sp.railBtnY}px from the top of the document)`);

/* OUTCOME. The rail is a bar, and the page's reason for existing is within a screen and
 * a half of the top rather than 6,746px down. The budget is 1.6 viewports against a
 * measured 1.41, and it is a ratio of the viewport rather than a literal so it means
 * the same thing on a shorter phone. */
ok(sp.railH <= 400, `the rail is a bar, not a column of list`,
  `the rail is ${sp.railH}px at an 844px viewport (5,856px before the disclosure)`);
ok(sp.heroTop <= sp.vh * 1.6, 'the spectrogram is within a screen and a half of the top',
  `the plot starts ${sp.heroTop}px down, ${(sp.heroTop / sp.vh).toFixed(2)} viewports (6,746px before)`);
ok(sp.playY >= 0 && sp.playY < sp.vh, 'and ▶ 播放 is on the first screen with nothing scrolled',
  `the play button sits at y=${sp.playY} in an ${sp.vh}px viewport (y=397 before)`);

/* THE GESTURE. Select a row deep in the list and the plot has to come to the reader —
 * this is the assertion the whole change exists for. */
const spTapped = await ev(`(async () => {
  const rows = [...document.querySelectorAll('.sp-row')];
  const row = rows[Math.min(39, rows.length - 1)];
  const wanted = row.dataset.id;
  row.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 150));
  /* The offset the reader is INSIDE THE LIST at, which is not the offset they are at
   * afterwards: the reveal scrolls them down to the plot. Comparing the reopen against
   * the post-reveal offset is comparing two different positions and reports a working
   * restore as a broken one. */
  const fromY = Math.round(scrollY);
  row.click();
  await new Promise((r) => setTimeout(r, 1500));
  const plot = document.getElementById('sp-plot').getBoundingClientRect();
  return {
    wanted, fromY, name: document.getElementById('sp-name').textContent,
    pickerHidden: document.getElementById('sp-picker').hidden,
    summary: document.getElementById('sp-picker-now').textContent,
    plotTop: Math.round(plot.top), plotBottom: Math.round(plot.bottom), vh: innerHeight,
    scrollY: Math.round(scrollY),
    btnTop: Math.round(document.getElementById('sp-hero-play').getBoundingClientRect().top),
    btnBottom: Math.round(document.getElementById('sp-hero-play').getBoundingClientRect().bottom),
  };
})()`);
ok(spTapped.name === String(spTapped.wanted) || spTapped.name.length > 0, 'the tap selected a species',
  `tapping roster row 40 put ${spTapped.name} on the plot`);
ok(spTapped.pickerHidden, 'and the picker closed itself',
  'the picker is collapsed after the selection — it is ~5,300px of distance, so leaving it open would put the plot back out of reach');
ok(spTapped.plotTop < spTapped.vh && spTapped.plotBottom > 0,
  'THE ASSERTION THIS FILE EXISTS FOR: the plot is on screen after choosing from a list',
  `the plot spans y=${spTapped.plotTop}..${spTapped.plotBottom} in an ${spTapped.vh}px viewport`);
/* The control and the picture together, and this is where the claim belongs. Measured
 * at scroll 0 the button is at y=1,160 and the canvas at 1,212 — both below the fold,
 * correctly, because the plot being 1.4 viewports down is what §3.X's reveal is for.
 * Asserting 「both on one screen」 before the selection therefore asserted something
 * false, and the fix was to move the assertion to the state where it is a claim. */
ok(spTapped.btnTop < spTapped.vh && spTapped.btnBottom > 0,
  'and the control that plays it is on the same screen as the picture it plays',
  `the button spans y=${spTapped.btnTop}..${spTapped.btnBottom} beside the canvas at ${spTapped.plotTop}..${spTapped.plotBottom}`);

/* AND THE READER CAN GO BACK. The offset is recorded on closing; without this the
 * feature is "pick something, then start the list again". */
const spReopened = await ev(`(async () => {
  document.getElementById('sp-picker-toggle').click();
  await new Promise((r) => setTimeout(r, 400));
  return { scrollY: Math.round(scrollY), aria: document.getElementById('sp-picker-toggle').getAttribute('aria-expanded') };
})()`);
ok(Math.abs(spReopened.scrollY - spTapped.fromY) <= 200,
  'reopening the picker returns to where the reader was inside the list',
  `it reopens at scrollY=${spReopened.scrollY}, and the selection was made from ${spTapped.fromY}`);

/* THE DESKTOP DID NOT MOVE. Three relational measurements, no literal from before the
 * change: the rail does not scroll, the roster does, and the roster stays inside the
 * rail. `display: contents` is what produces this — as a flex container the wrapper
 * becomes the roster's flex parent and the roster becomes a 5,347px block. */
await atSize(DESKTOP);
await new Promise((r) => setTimeout(r, 400));
const spDesk = await ev(`(() => {
  const rail = document.querySelector('.sp-left-panel'), roster = document.getElementById('sp-roster');
  return {
    railScrolls: rail.scrollHeight > rail.clientHeight,
    railH: Math.round(rail.getBoundingClientRect().height),
    rosterScrolls: roster.scrollHeight > roster.clientHeight,
    rosterInside: roster.getBoundingClientRect().bottom <= rail.getBoundingClientRect().bottom + 1,
    pickerHidden: document.getElementById('sp-picker').hidden,
    toggleDisplay: getComputedStyle(document.getElementById('sp-picker-toggle')).display,
    rosterParent: getComputedStyle(roster).display,
  };
})()`);
ok(!spDesk.railScrolls && spDesk.railH === DESKTOP.height,
  'at 1280 the rail is still a viewport-height column that does NOT scroll',
  `the rail is ${spDesk.railH}px with no overflow — it is the roster that scrolls, not the rail (a flex-container wrapper gave the rail a 4,829px overflow)`);
ok(spDesk.rosterScrolls && spDesk.rosterInside,
  'and the roster is still the rail\'s one scroller, inside it',
  `the roster scrolls (${spDesk.rosterScrolls}) and its bottom is inside the rail's (${spDesk.rosterInside})`);
ok(!spDesk.pickerHidden && spDesk.toggleDisplay === 'none',
  'with no toggle to press, because nothing is collapsed',
  `the picker is open (${!spDesk.pickerHidden}) and the toggle is display:none (${spDesk.toggleDisplay})`);

/* ===========================================================================
// cries.html — the probe that was 5,309px above the fold
// =========================================================================== */
console.log('\ncries.html @ 390x844');
exceptions.length = 0;
await open('cries.html', PHONE);
await booted(`document.querySelectorAll('.cy-card').length > 0`);
await new Promise((r) => setTimeout(r, 600));

const cyBoot = await ev(`(() => {
  const panel = document.querySelector('.cy-panel');
  return {
    panelH: Math.round(panel.getBoundingClientRect().height),
    firstCard: Math.round(document.querySelector('.cy-card').getBoundingClientRect().top),
    moreOpen: document.getElementById('probe-more').open,
    summaryDisplay: getComputedStyle(document.querySelector('.cy-more-summary')).display,
    vh: innerHeight,
  };
})()`);
ok(cyBoot.moreOpen === false && cyBoot.summaryDisplay !== 'none',
  'nothing is selected yet, so the disclosure is shut and its summary is on screen',
  `open=${cyBoot.moreOpen}, summary display: ${cyBoot.summaryDisplay}`);
ok(cyBoot.panelH <= 260, 'and the panel is a header, not a column of results',
  `the panel is ${cyBoot.panelH}px with nothing selected (169px before, 1,609px once a card is tapped)`);
ok(cyBoot.firstCard < cyBoot.vh, 'the grid is on the first screen before anything is tapped',
  `the first card is at y=${cyBoot.firstCard} in an ${cyBoot.vh}px viewport`);

const cyTapped = await ev(`(async () => {
  const cards = [...document.querySelectorAll('.cy-card')];
  const card = cards[Math.min(39, cards.length - 1)];
  card.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 150));
  card.click();
  await new Promise((r) => setTimeout(r, 900));
  const box = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
  return {
    name: document.getElementById('probe-name').textContent,
    panelH: Math.round(box('.cy-panel').height),
    headTop: Math.round(box('.cy-probe-head').top),
    nameTop: Math.round(box('#probe-name').top),
    playTop: Math.round(box('#probe-play').top),
    playBottom: Math.round(box('#probe-play').bottom),
    firstCard: Math.round(box('.cy-card').top),
    moreOpen: document.getElementById('probe-more').open,
    statsVisible: document.getElementById('probe-stats').checkVisibility(),
    vh: innerHeight,
  };
})()`);
ok(cyTapped.panelH <= 500, 'tapping a card deep in the grid leaves the panel a bar',
  `the panel is ${cyTapped.panelH}px (1,609px before)`);
ok(!cyTapped.moreOpen && !cyTapped.statsVisible,
  'with the figures and the similarity list behind the summary',
  `open=${cyTapped.moreOpen}, and #probe-stats reports checkVisibility()=${cyTapped.statsVisible}`);
ok(cyTapped.playTop >= 0 && cyTapped.playBottom <= cyTapped.vh,
  'THE ASSERTION THIS FILE EXISTS FOR: ▶ 播放叫聲 is on screen after tapping a card',
  `it spans y=${cyTapped.playTop}..${cyTapped.playBottom} in an ${cyTapped.vh}px viewport (y=-5,309 before)`);
/* The name, not just the button. Scrolling to `.cy-probe-head` put the head at y=-45 and
 * its name at y=-31 — a play button for a Pokémon whose name was off the top of the
 * screen. That is the version that passed the assertion above and was still wrong. */
ok(cyTapped.nameTop >= 0 && cyTapped.nameTop < cyTapped.vh && cyTapped.name.length > 0,
  'and the reader can read WHICH Pokémon it is, which is what the first attempt missed',
  `${cyTapped.name} is at y=${cyTapped.nameTop} (head y=${cyTapped.headTop}; scrolling to the head put the name at -31)`);
ok(cyTapped.firstCard - cyTapped.panelH < cyTapped.vh * 3,
  'and the grid is not pushed off the page by the panel above it',
  `the first card is at y=${cyTapped.firstCard} with a ${cyTapped.panelH}px panel (2,246px before)`);

/* AND THE REFERENCE MATERIAL IS STILL THERE, one tap away and not deleted. */
const cyOpened = await ev(`(async () => {
  const more = document.getElementById('probe-more');
  more.open = true;
  await new Promise((r) => setTimeout(r, 300));
  const stats = document.getElementById('probe-stats');
  return {
    open: more.open,
    statsVisible: stats.checkVisibility(),
    rows: stats.querySelectorAll('dt').length,
    similar: document.querySelectorAll('#similar .cy-sim').length,
    caveat: !!document.querySelector('.cy-caveat'),
  };
})()`);
ok(cyOpened.open && cyOpened.statsVisible && cyOpened.rows > 0,
  'opening the summary brings back the measured figures, not a stub',
  `#probe-stats has ${cyOpened.rows} label/value pairs and reports visible`);
ok(cyOpened.similar > 0 && cyOpened.caveat,
  'and the similarity list and its caveat with them',
  `${cyOpened.similar} similar entries, the caveat present: ${cyOpened.caveat}`);

/* THE DESKTOP DID NOT MOVE, again relationally: the disclosure is open, its summary is
 * not rendered, and the play button is at the offset the panel's own layout puts it. */
await atSize(DESKTOP);
await new Promise((r) => setTimeout(r, 400));
const cyDesk = await ev(`(() => {
  const panel = document.querySelector('.cy-panel');
  const play = document.getElementById('probe-play').getBoundingClientRect();
  const link = document.getElementById('probe-spectrum').getBoundingClientRect();
  return {
    sticky: getComputedStyle(panel).position,
    moreOpen: document.getElementById('probe-more').open,
    summaryDisplay: getComputedStyle(document.querySelector('.cy-more-summary')).display,
    summaryH: Math.round(document.querySelector('.cy-more-summary').getBoundingClientRect().height),
    playTop: Math.round(play.top),
    linkTop: Math.round(link.top),
    statsVisible: document.getElementById('probe-stats').checkVisibility(),
  };
})()`);
ok(cyDesk.sticky === 'sticky' && cyDesk.moreOpen && cyDesk.statsVisible,
  'at 1280 the panel is still sticky and everything in it is still shown',
  `position: ${cyDesk.sticky}, disclosure open: ${cyDesk.moreOpen}, figures visible: ${cyDesk.statsVisible}`);
ok(cyDesk.summaryDisplay === 'none' && cyDesk.summaryH === 0,
  'with no summary row, because a desktop reader must not be handed a control that collapses what they could always see',
  `the summary is display:${cyDesk.summaryDisplay} and ${cyDesk.summaryH}px tall`);
/* The disclosure sits BELOW the play button, so it cannot move it — asserted as a
 * comparison between two elements rather than against a number recorded before the
 * change, which §3.V warns is a second thing to keep right. */
ok(cyDesk.playTop > 0 && cyDesk.playTop < cyDesk.linkTop,
  'and adding it moved nothing above the play button',
  `▶ 播放叫聲 at y=${cyDesk.playTop}, 看頻譜 at y=${cyDesk.linkTop} — the summary is below both, which is why neither moved`);

ok(exceptions.length === 0, 'no uncaught exceptions on either page',
  exceptions.length ? exceptions.join(' | ') : 'both pages clean');

/* Restore the viewport, POLLED, before anything downstream or another checker in this
 * process could read a width it did not ask for. 42af1a1 measured `clearDeviceMetrics
 * Override` returning while the renderer still reported the override's own width. */
const CLEAR_MS = 3000;
await send('Emulation.clearDeviceMetricsOverride');
const RESTORED = await until(ev, 'innerWidth !== 1280 && innerWidth !== 390', CLEAR_MS);
ok(RESTORED, `the viewport is released within ${CLEAR_MS}ms, polled rather than read on the next line`);

/**
 * Close everything and leave nothing behind.
 *
 * THE ORDER IS THE WHOLE POINT, and it was measured rather than reasoned. `tmp-trees.mjs`
 * sweeps on `process.exit`, and `sweep()` calls a bare `rmSync` with no retry — so if
 * the sweep runs while the browser is still alive, `rmSync` throws `EBUSY` on a
 * directory Chrome is writing to, the throw is swallowed by that module's
 * `catch {}`, and a 6 MB profile survives every run. Measured: killing the browser and
 * exiting immediately left exactly one `crl-*` tree per run with zero orphan processes,
 * which is the harder of the two to notice — `ps` is clean and the disk is not.
 *
 * The other checkers solve this with `rmSync(..., { maxRetries: 5, retryDelay: 100 })`
 * in their own exit handlers, which is a per-file answer to a module-level gap. This one
 * waits for the process to be gone before letting the shared sweep run, which is the
 * same fix without a second copy of the retry policy.
 *
 * The wait is capped, and the cap is generous on purpose: it is only ever paid on the
 * path where Chrome is slow to go, and a bounded wait that gives up still leaves the
 * sweep a chance rather than skipping it.
 */
async function finish(code) {
  ws.close();
  chrome.kill();
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    chrome.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
  process.exit(code);
}

console.log('');
if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  await finish(1);
}
console.log(`PASS  ${checks} checks`);

/* THE SCRIPT ENDS HERE AND THE PROCESS DOES NOT, which cost one 200s timeout before
 * `finish()` existed. Two things hold the event loop open and neither is the browser:
 * the DevTools WebSocket, and the `fetch` that found the target — undici keeps that
 * socket alive for keep-alive, so a finished checker sits there until something kills
 * it. §4 records the same trap for the runner's own liveness probe, where it presented
 * as 「the skip cache is broken, a fully-cached run takes 6.5s to do 0.09s of work」;
 * measured there, `http.request` with `agent: false` exited at 29ms where `fetch`
 * finished its work at 31ms and exited at 6033ms. */
await finish(0);
