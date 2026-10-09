#!/usr/bin/env node
/**
 * Browser checks for life.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_life_browser.mjs      (needs the repo served on :5500)
 *
 * WHY THIS FILE EXISTS AND WHAT IT MAY NOT DUPLICATE
 *
 * `check_life_page.mjs` and `check_evolution_levels.mjs` prove the mechanics: that
 * a Bulbasaur block reaches Ivysaur at Lv.16 and Venusaur at Lv.32, that every
 * wild pack lands three cells on a free site, that the levels table matches the
 * games. All of that is pure logic over files and needs no browser.
 *
 * What it cannot see is whether the page USES any of it, and life.html shipped
 * two defects of exactly that kind:
 *
 *   1. THE TOOLBAR COVERED THE NAV DROPDOWN. `.life-toolbar` carried `z-index: 20`
 *      and `backdrop-filter: blur(18px)`; the filter makes it a stacking context,
 *      so the value stopped being inert and outranked `.header`'s 10 — and the nav
 *      panel's 120 is trapped INSIDE that header context. Measured: 5 of 22
 *      hit-test points along an open 445px panel resolved to the toolbar. No
 *      static check can see this, because both declarations are individually
 *      correct; only a hit-test answers whether the dropdown is clickable.
 *
 *   2. NOTHING CONSUMED `wildSpawnEvent`. tick() returned it, no page code read
 *      it, and `isWildSpawn` was never read by the renderer — so an encounter was
 *      a 0.16s flicker at 10x followed by silence. Also invisible statically: the
 *      event existed and was well-formed.
 *
 * So the claims here are: the dropdown is not covered on THIS page (and, as the
 * control, on a page it never was), the announcer appears for an encounter and
 * says something species-specific, the HUD legend reports a real level rather
 * than the old Age>=5, and evolution happens at the levels the engine was just
 * proven to use.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.LIFE_PORT || 5500;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_CDP = 9381;

const profile = mkdtempSync(join(tmpdir(), 'lifepage-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT_CDP}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

/** §3.J: kill the browser AND remove the profile, from one exit handler.
 *  Removing the profile is not killing the browser — an orphan keeps rendering
 *  pages forever, which is a thermal problem before it is a correctness one. */
function cleanup() {
  try { process.kill(chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

let targets;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
    if (r.ok) { targets = await r.json(); break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
if (!targets) { console.error(`could not reach Chrome`); cleanup(); process.exit(1); }

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

let checks = 0;
const fails = [];
const eq = (got, want, what) => {
  checks++;
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fails.push(`${what}\n      got:  ${a}\n      want: ${b}`);
};
const ok = (cond, what) => eq(!!cond, true, what);

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
  return r.result.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * life.html's real boot signal.
 *
 * `#statPop` exists in the static markup reading "0", so waiting for its PRESENCE
 * is satisfied before a line of life.js has run — which is how the first version
 * of this file hid the generation modal and then had `openSetupModal()` turn it
 * straight back on, so every hit-test point landed on the modal backdrop instead
 * of on the dropdown. Waiting for it to read something else means updateHUD() has
 * run, which happens before openSetupModal().
 */
const LIFE_READY = `(() => {
  const el = document.getElementById('statPop');
  return !!el && el.textContent !== '' && el.textContent !== '0';
})()`;

/** Navigate and wait for the page's own boot, not for a duration (§3.G). */
async function openPage(path, readyExpr, timeoutMs = 15000) {
  await send('Page.navigate', { url: `http://localhost:${PORT}/${path}` });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await ev(readyExpr)) return; } catch { /* mid-navigation */ }
    await sleep(150);
  }
  throw new Error(`${path} never became ready (${readyExpr})`);
}

/* ==========================================================================
   1. THE NAV DROPDOWN IS NOT COVERED — life.html, and one page as a control
   ========================================================================== */
console.log('--- nav dropdown hit-test ---');

// life.html opens its generation modal on load; the modal is `position: fixed`
// z-index 100 and would be the topmost element at every probe point, so the
// dropdown's geometry would be tested against the wrong overlay.
await openPage('life.html', LIFE_READY);
await ev(`document.getElementById('setupModal').hidden = true; document.getElementById('loadingOverlay').hidden = true; true`);
await sleep(200);

const navProbe = `(() => {
  const trigger = document.querySelector('.site-nav-trigger');
  const panel = trigger.parentElement.querySelector('.site-nav-panel');
  trigger.click();
  const r = panel.getBoundingClientRect();
  const blocked = [];
  let samples = 0;
  // Sample the panel's own column, 8px inside its left edge: a strip the panel
  // occupies and the page behind it both have a claim on.
  for (let y = Math.round(r.top) + 6; y < Math.round(r.bottom) - 4; y += 20) {
    samples++;
    const el = document.elementFromPoint(Math.round(r.left) + 8, y);
    if (el && !panel.contains(el)) blocked.push((el.className || el.tagName) + '@y' + y);
  }
  trigger.click();
  return JSON.stringify({ height: Math.round(r.height), samples, blocked });
})()`;

const lifeNav = JSON.parse(await ev(navProbe));
ok(lifeNav.samples > 15, `probed a real number of points along the panel (${lifeNav.samples})`);
ok(lifeNav.height > 200, `the dropdown actually opened (${lifeNav.height}px tall)`);
eq(lifeNav.blocked, [], 'no point along the open nav panel is intercepted by the toolbar');

/* ==========================================================================
   2. THE TOOLBAR'S STACKING CONTEXT IS BELOW THE HEADER'S
   ========================================================================== */
// Read while still on life.html: these selectors do not exist on the control page.
console.log('--- stacking order, read out of the live page ---');
const stack = await ev(`JSON.stringify({
  headerZ: getComputedStyle(document.querySelector('.header')).zIndex,
  headerPos: getComputedStyle(document.querySelector('.header')).position,
  toolbarZ: getComputedStyle(document.querySelector('.life-toolbar')).zIndex,
  toolbarFilter: getComputedStyle(document.querySelector('.life-toolbar')).backdropFilter,
  panelZ: getComputedStyle(document.querySelector('.site-nav-panel')).zIndex,
  modalZ: getComputedStyle(document.querySelector('.life-modal-backdrop')).zIndex,
  drawerZ: getComputedStyle(document.querySelector('.life-drawer')).zIndex,
  toastZ: getComputedStyle(document.querySelector('.life-celebration-toast')).zIndex
})`);
const s = JSON.parse(stack);
ok(Number(s.toolbarZ) < Number(s.headerZ),
  `toolbar z-index ${s.toolbarZ} is below the header's ${s.headerZ} — that ordering IS the fix`);
ok(s.headerPos === 'relative', 'the header is a positioned element, so its z-index applies');
ok(/blur/.test(s.toolbarFilter),
  'the toolbar really does create a stacking context via backdrop-filter, which is why the number mattered at all');
// The nav panel is inside the header's context, so its own 120 cannot save it.
ok(Number(s.panelZ) > Number(s.headerZ),
  'the panel outranks the header it lives in, and still lost to a 20 outside it — the trap this guards');
ok(Number(s.modalZ) > Number(s.headerZ) && Number(s.drawerZ) > Number(s.headerZ)
   && Number(s.toastZ) > Number(s.headerZ),
  'the modal, drawers and toast all still outrank the header after the fix');

// The control, on the same browser with the same probe: a page that never had
// the bug. Without it, "zero blocked points" could mean the probe is broken and
// finds nothing anywhere, which is the failure a hit-test checker is most prone to.
await openPage('maze.html', `document.readyState === 'complete' && !!document.querySelector('.site-nav-trigger')`);
await sleep(400);
const mazeNav = JSON.parse(await ev(navProbe));
eq(mazeNav.blocked, [], 'control page: maze.html dropdown also fully clickable');
eq(mazeNav.samples, lifeNav.samples, 'the control probed the same number of points (the probe is not silently inert)');

/* ==========================================================================
   3. THE WILD ENCOUNTER IS ANNOUNCED
   ========================================================================== */
console.log('--- wild encounter feedback ---');
await openPage('life.html', LIFE_READY);
await ev(`document.getElementById('setupModal').hidden = true; true`);
await sleep(300);

// Force the rate to 1 and step until one lands. A fixed number of steps would be
// a guess about the rate; polling for the event is the claim.
const wild = JSON.parse(await ev(`(() => {
  const toast = document.getElementById('celebrationToast');
  const before = document.getElementById('statWild').textContent;
  // The page keeps the engine in module scope, so drive it the way the toolbar
  // does: flip the checkbox's target, then single-step.
  const engineRef = document.getElementById('chkWild');
  engineRef.checked = true;
  engineRef.dispatchEvent(new Event('change'));
  for (let i = 0; i < 400; i++) {
    document.getElementById('btnStep').click();
    const now = document.getElementById('statWild').textContent;
    if (now !== before && toast.classList.contains('is-visible')) {
      return JSON.stringify({
        statBefore: before,
        statNow: now,
        headline: document.getElementById('toastHeadline').textContent,
        eyebrow: document.querySelector('.life-toast-eyebrow').textContent,
        isWildTone: toast.classList.contains('is-wild'),
        visible: toast.classList.contains('is-visible')
      });
    }
  }
  return JSON.stringify({ none: true });
})()`));

ok(!wild.none, 'a wild encounter fired within 400 single-steps');
ok(wild.statNow !== wild.statBefore, `the 野生遭遇 counter advanced (${wild.statBefore} -> ${wild.statNow})`);
ok(/野生遭遇/.test(wild.eyebrow || ''), `the announcer says what happened: "${wild.eyebrow}"`);
ok(/#\d{4}\s\S/.test(wild.headline || ''),
  `the headline names the species and the pack size: "${wild.headline}"`);
ok(wild.isWildTone, 'the announcer uses the wild tone, not the medal tone');
ok(wild.visible, 'the announcer is actually visible when it fires');

// The counter must count packs that LANDED, not attempts. Proved here by the
// engine checker on a crowded board; here, only that it is a number that moves.
eq(typeof wild.statNow, 'string', 'the counter is a rendered string, not an object');

/* ==========================================================================
   4. THE LEGEND REPORTS A REAL LEVEL, AND EVOLUTION HAPPENS AT THAT LEVEL
   ========================================================================== */
console.log('--- level-based evolution, rendered ---');
const legend = JSON.parse(await ev(`(() => {
  const l1 = document.getElementById('stageLevel1');
  const l2 = document.getElementById('stageLevel2');
  return JSON.stringify({
    l1: l1 ? l1.textContent : null,
    l2: l2 ? l2.textContent : null,
    l1Title: l1?.parentElement?.title || '',
    htmlHasAge: document.querySelector('.life-stage-legend').innerHTML.includes('Age')
  });
})()`));
ok(legend.l1 !== null, 'the stage-1 legend has a slot for a level');
ok(!legend.htmlHasAge, 'the legend no longer claims Age>=5 / Age>=12');
ok(/Lv\.\d+|全站中位數/.test(legend.l1Title),
  `the legend explains the fallback it is using: "${legend.l1Title.slice(0, 48)}..."`);

// Run long enough for the seeded Gen-1 board to pass Lv.16 and evolve.
const evolved = JSON.parse(await ev(`(async () => {
  const genBadge = document.getElementById('genBadge');
  document.getElementById('btnPlay').click();
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const l1 = document.getElementById('stageLevel1').textContent;
    const pct1 = document.getElementById('stagePct1').textContent;
    if (l1 && pct1 !== '0%' && pct1 !== '0') {
      document.getElementById('btnPlay').click();
      return JSON.stringify({ legend: l1, pct1, gen: document.getElementById('statGen').textContent,
                              pop: document.getElementById('statPop').textContent, badge: genBadge.textContent });
    }
  }
  document.getElementById('btnPlay').click();
  return JSON.stringify({ none: true });
})()`));

ok(!evolved.none, 'seeded Gen-1 board reached Stage 1 and the legend filled in');
ok(/^\(Lv\.\d+\)$/.test(evolved.legend || ''),
  `legend reports a parenthesised level, got "${evolved.legend}"`);
const legendLevel = Number(String(evolved.legend || '').replace(/[()]/g, '').replace('Lv.', ''));
// Bulbasaur->Ivysaur is 16, Squirtle->Wartortle 16, Rattata->Rattican 20, Caterpie 7.
// A board seeded from one starter therefore cannot first evolve before Lv.7.
ok(legendLevel >= 7 && legendLevel <= 64, `the reported level is inside the corpus range 7..64 (got ${legendLevel})`);

/* ==========================================================================
   5. THE LET'S GO SWITCH, AND WHERE IT LANDS
   ========================================================================== */
/* It was mounted with `.life-modal-section-title:nth-of-type(2)`, which matches
 * the element that is both that class AND the dialog's 2nd <div> — and
 * .life-modal-header is the 1st, so the control that swaps the starter list
 * rendered inside 步驟 1 (選擇目標世代). The static checker can only see that the
 * selector is gone; this one reads the RENDERED box, because the bug was never
 * that a selector existed, it was that a real box was in the wrong row. */
await ev(`(() => {
  document.getElementById('setupModal').hidden = false;
  document.getElementById('loadingOverlay').hidden = true;
  return true;
})()`);
await sleep(250);

const toggleBox = JSON.parse(await ev(`(() => {
  const t = document.querySelector('.life-lets-go-toggle');
  if (!t) return JSON.stringify({ missing: true });
  const starters = document.getElementById('setupStarters');
  const genTabs = document.getElementById('setupGenTabs');
  const r = t.getBoundingClientRect();
  const sr = starters.getBoundingClientRect();
  const gr = genTabs.getBoundingClientRect();
  const step = t.closest('.life-modal-section-title');
  return JSON.stringify({
    text: step ? step.textContent.trim().slice(0, 30) : '',
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    startersTop: Math.round(sr.top), startersBottom: Math.round(sr.bottom),
    genTabsTop: Math.round(gr.top), genTabsBottom: Math.round(gr.bottom),
    selected: !!t.querySelector('.is-selected')
  });
})()`));
ok(!toggleBox.missing, "the Let's Go switch rendered for Gen 1");
ok(toggleBox.selected, "one of 經典模式 / Let's Go 模式 is marked selected");
ok(/始祖物種/.test(toggleBox.text || ''),
  `the switch sits in step 2's title, got "${toggleBox.text}"`);
// Box geometry, because "in the title" is a DOM relationship and the bug was a
// layout one: the switch has to be ON the same row as the starter cards, and
// must NOT be over the generation tabs.
ok(toggleBox.bottom <= toggleBox.startersTop + 40,
  `the switch sits above the starter cards (switch bottom ${toggleBox.bottom}, cards top ${toggleBox.startersTop})`);
// And BELOW the generation tabs, because step 2 is after step 1. The first
// version of this assertion had the comparison the other way round and failed on
// a page that was already correct — a check that cannot be satisfied is not
// evidence either.
ok(toggleBox.top > toggleBox.genTabsBottom,
  `the switch is below the generation tabs, not in their row (switch top ${toggleBox.top}, tabs bottom ${toggleBox.genTabsBottom})`);

/* The switch has to actually SWITCH. The radios' innerHTML is rewritten on every
 * render, so a listener attached without being re-assigned survives exactly one
 * change event and the control goes dead after a single use. */
const switched = JSON.parse(await ev(`(() => {
  const before = [...document.querySelectorAll('#setupStarters .life-starter-card img')]
    .map(i => i.getAttribute('src'));
  document.querySelector('input[name="letsGoMode"][value="letsgo"]').click();
  const after = [...document.querySelectorAll('#setupStarters .life-starter-card img')]
    .map(i => i.getAttribute('src'));
  return JSON.stringify({ before, after, stillSelected: !!document.querySelector('.life-lets-go-toggle .is-selected') });
})()`));
eq(switched.after.length, 2, "Let's Go mode offers two starters, not three");
ok(switched.before.length === 3 && switched.after.length === 2,
  `the roster changed: ${switched.before.length} classic starters -> ${switched.after.length} Let's Go`);
// Clicking it a second time is the half that goes dead when the listener is
// re-bound wrongly: same target, opposite state.
const switchedBack = JSON.parse(await ev(`(() => {
  document.querySelector('input[name="letsGoMode"][value="classic"]').click();
  return JSON.stringify({
    n: document.querySelectorAll('#setupStarters .life-starter-card').length
  });
})()`));
eq(switchedBack.n, 3, 'the switch still works after a second use');

/* The counter divides by the number of tiles, which is 156 on Gen 1 and not the
 * 151 that `totalSpeciesCount` reports. Read the rendered string, not the
 * function: the denominator is the whole claim. */
await ev(`document.getElementById('setupClose').click(); true`);
await sleep(200);
const dexCounter = JSON.parse(await ev(`(() => {
  document.getElementById('btnDexDrawer').click();
  const tiles = document.querySelectorAll('#dexGrid .life-dex-item').length;
  const heads = document.querySelectorAll('#dexGrid .life-dex-section-header').length;
  const label = document.getElementById('btnDexCount').textContent;
  document.getElementById('dexClose').click();
  return JSON.stringify({ tiles, heads, label });
})()`));
eq(dexCounter.tiles, 156, 'the drawer renders 156 tiles on Gen 1');
eq(dexCounter.heads, 1, 'and one section header');
ok(/\/156\)$/.test(dexCounter.label || ''),
  `the counter divides by the tiles it renders, got "${dexCounter.label}"`);

/* Every icon must paint. `.icon` is fill-only, so a stroke-drawn glyph renders as
 * a filled silhouette — invisible to a text check and obvious in a screenshot.
 *
 * The glyphs are serialised into standalone documents and drawn as images
 * because `drawImage` refuses a live SVGElement: it is an SVGElement, not one of
 * the SVGImageElement / HTMLImageElement / canvas types the signature allows.
 * `currentColor` then resolves against the standalone document's default colour,
 * which is fine — the assertion is about ALPHA, not about hue. */
const iconInk = JSON.parse(await ev(`(async () => {
  const svgs = [...document.querySelectorAll('svg.icon')];
  const painted = async svg => {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '48');
    clone.setAttribute('height', '48');
    const url = 'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 48, 48);
    const d = g.getImageData(0, 0, 48, 48).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  };
  const blank = [];
  let okCount = 0;
  for (const svg of svgs) {
    let n = 0;
    try { n = await painted(svg); } catch (e) { n = 0; }
    if (n > 40) okCount++; else blank.push((svg.parentElement?.id || svg.parentElement?.className || '?') + ':' + n);
  }
  return JSON.stringify({ total: svgs.length, painted: okCount, blank });
})()`));
eq(iconInk.total > 15, true, `life.html carries its icon set (${iconInk.total} found)`);
eq(iconInk.blank, [], 'every inline icon paints ink, not a blank box');
eq(iconInk.painted, iconInk.total,
  `all ${iconInk.total} icons have visible pixels (${iconInk.painted} did)`);

/* ==========================================================================
   6. NO CONSOLE ERRORS
   ========================================================================== */
eq(logs, [], 'no console errors or uncaught exceptions during the whole run');

if (fails.length > 0) {
  console.log(`\nFAIL  ${fails.length} of ${checks} checks\n`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  cleanup();
  process.exit(1);
}
console.log(`\nPASS  ${checks} browser checks — life.html`);
cleanup();