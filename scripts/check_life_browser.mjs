#!/usr/bin/env node
/**
 * Browser checks for life.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_life_browser.mjs      (needs the repo served on :5500)
 *
 * `check_life_page.mjs` and `check_evolution_levels.mjs` prove the mechanics over
 * files. This file proves the page uses them:
 *
 *   1. The nav dropdown is not covered by the toolbar. `.life-toolbar` carries
 *      `z-index: 20` and `backdrop-filter: blur(18px)`; the filter makes it a
 *      stacking context, so it outranks `.header`'s 10 while the nav panel's 120 is
 *      trapped inside that header context. Only a hit-test answers whether the
 *      dropdown is clickable.
 *   2. A wild encounter is announced. `tick()` returns `wildSpawnEvent` and the
 *      renderer reads `isWildSpawn`; otherwise an encounter is a 0.16s flicker
 *      followed by silence.
 *
 * The HUD legend reports a real level rather than Age>=5, and evolution happens at
 * the levels the engine was proven to use.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.LIFE_PORT || 5500;

const profile = mkdtempSync(join(tmpdir(), 'lifepage-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--window-size=1440,900',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });
/* Chrome chose its own debug port; read it back from the profile. */
const PORT_CDP = await waitForDebugPort(profile);

/** §3.J: kill the browser and remove the profile from one exit handler. Removing the
 *  profile is not killing the browser: an orphan keeps rendering pages forever. */
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
 * life.html's real boot signal: boot has FINISHED, not merely started.
 *
 * `#statPop` exists in the static markup reading "0", so waiting for its presence is
 * satisfied before a line of life.js has run. `updateHUD()` runs before
 * `openSetupModal()`, so waiting for `statPop` to change still loses the race: it
 * waits for a signal the page emits before the line it needs to be past. A gate on
 * `#statPop` let a late second `openSetupModal()` rebuild the modal mid-run, sent
 * brush presses into the backdrop (§3.G's confirm-the-press rule), and produced a
 * `-32000 Inspected target navigated or closed` (§3.G9).
 *
 * The destination's own last boot act is the modal being open: `openSetupModal()` is
 * the final statement of life.js's init, so `setupModal.hidden === false` cannot
 * become true until init is done (§3.G5: gate a wait on something only the destination
 * has).
 */
const LIFE_READY = `(() => {
  const el = document.getElementById('statPop');
  const modal = document.getElementById('setupModal');
  return !!el && el.textContent !== '' && el.textContent !== '0'
    && !!modal && modal.hidden === false;
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

// life.html opens its generation modal on load; it is `position: fixed` with
// z-index 100 and would be the topmost element at every probe point.
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

// The control, on the same browser with the same probe: without it, "zero blocked
// points" could mean the probe is broken and finds nothing anywhere.
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

// Force the rate to 1 and step until one lands. A fixed number of steps would be a
// guess about the rate; polling for the event is the claim.
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

// The counter counts packs that landed, not attempts; the engine checker proves that
// on a crowded board. Here, only that it is a number that moves.
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
// Bulbasaur->Ivysaur is 16, Squirtle->Wartortle 16, Rattata->Raticate 20, Caterpie 7.
// A board seeded from one starter therefore cannot first evolve before Lv.7.
ok(legendLevel >= 7 && legendLevel <= 64, `the reported level is inside the corpus range 7..64 (got ${legendLevel})`);

/* ==========================================================================
   5. THE LET'S GO SWITCH, AND WHERE IT LANDS
   ========================================================================== */
/* The switch was mounted with `.life-modal-section-title:nth-of-type(2)`, which
 * matches the dialog's 2nd <div> rather than the 2nd section title, so it rendered
 * inside 步驟 1 (選擇目標世代). The static checker can only see that the selector is
 * gone; this one reads the rendered box. */
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
// Box geometry: the switch must sit above the starter cards and not over the
// generation tabs.
ok(toggleBox.bottom <= toggleBox.startersTop + 40,
  `the switch sits above the starter cards (switch bottom ${toggleBox.bottom}, cards top ${toggleBox.startersTop})`);
// And below the generation tabs, because step 2 is after step 1. A check that
// cannot be satisfied is not evidence either.
ok(toggleBox.top > toggleBox.genTabsBottom,
  `the switch is below the generation tabs, not in their row (switch top ${toggleBox.top}, tabs bottom ${toggleBox.genTabsBottom})`);

/* The switch has to actually switch. The radios' innerHTML is rewritten on every
 * render, so a listener attached without being re-assigned survives one change
 * event and the control goes dead. */
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

/* The counter divides by the number of tiles, and the number of tiles depends on the
 * starter: the 伊布家族 section is the reader's choice, not the generation's. This
 * drives the real modal and picks 伊布 rather than reading whatever the default setup
 * left behind. */
await ev(`(() => { document.getElementById('btnOpenSetup').click(); return true; })()`);
await sleep(300);
const dexForEevee = JSON.parse(await ev(`(() => {
  // 伊布 is reachable only through the Let's Go switch, so this drives that too. A
  // check that just looked for a #133 card would assert about a list that does not
  // exist in classic mode.
  const letsGo = document.querySelector('input[name="letsGoMode"][value="letsgo"]');
  if (!letsGo) return JSON.stringify({ noToggle: true });
  letsGo.click();
  const cards = [...document.querySelectorAll('#setupStarters .life-starter-card img')];
  const eevee = cards.find(i => /\\/133\\.png$/.test(i.getAttribute('src')));
  if (!eevee) return JSON.stringify({ noEevee: true, ids: cards.map(i => i.getAttribute('src')) });
  eevee.closest('.life-starter-card').click();
  document.getElementById('setupSubmit').click();
  return JSON.stringify({ ok: true, ids: cards.map(i => i.getAttribute('src')) });
})()`));
ok(!dexForEevee.noToggle, "the Let's Go switch is reachable from the modal");
ok(!dexForEevee.noEevee, `Let's Go offers 伊布 alongside 皮卡丘: ${JSON.stringify(dexForEevee.ids || [])}`);
await sleep(700);

const dexCounter = JSON.parse(await ev(`(() => {
  document.getElementById('btnDexDrawer').click();
  const tiles = document.querySelectorAll('#dexGrid .life-dex-item').length;
  const heads = document.querySelectorAll('#dexGrid .life-dex-section-header').length;
  const label = document.getElementById('btnDexCount').textContent;
  document.getElementById('dexClose').click();
  return JSON.stringify({ tiles, heads, label });
})()`));
eq(dexCounter.tiles, 156, 'choosing 伊布 renders 156 tiles on Gen 1');
eq(dexCounter.heads, 1, 'and one section header');
ok(/\/156\)$/.test(dexCounter.label || ''),
  `the counter divides by the tiles it renders, got "${dexCounter.label}"`);

/* The other half of the condition: in classic mode the section is gone and the
 * counter agrees. Asserting only the 156 would pass a page that shows the section to
 * everybody. */
await ev(`(() => { document.getElementById('btnOpenSetup').click(); return true; })()`);
await sleep(300);
await ev(`(() => {
  document.querySelector('input[name="letsGoMode"][value="classic"]').click();
  const cards = [...document.querySelectorAll('#setupStarters .life-starter-card img')];
  const bulba = cards.find(i => /\\/1\\.png$/.test(i.getAttribute('src')));
  bulba.closest('.life-starter-card').click();
  document.getElementById('setupSubmit').click();
  return true;
})()`);
await sleep(700);
const dexForBulba = JSON.parse(await ev(`(() => {
  document.getElementById('btnDexDrawer').click();
  const tiles = document.querySelectorAll('#dexGrid .life-dex-item').length;
  const heads = document.querySelectorAll('#dexGrid .life-dex-section-header').length;
  const label = document.getElementById('btnDexCount').textContent;
  document.getElementById('dexClose').click();
  return JSON.stringify({ tiles, heads, label });
})()`));
eq(dexForBulba.tiles, 151, 'choosing 妙蛙種子 renders the generation\'s own 151');
eq(dexForBulba.heads, 0, 'and no branch section');
ok(/\/151\)$/.test(dexForBulba.label || ''),
  `and the counter agrees again, got "${dexForBulba.label}"`);

/* Every icon must paint. `.icon` is fill-only, so a stroke-drawn glyph renders as a
 * filled silhouette, invisible to a text check.
 *
 * The glyphs are serialised into standalone documents and drawn as images because
 * `drawImage` refuses a live SVGElement. `currentColor` then resolves against the
 * standalone document's default colour; the assertion is about alpha, not hue. */
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
   6. THE TOAST CARD, IN BOTH THEMES
   ========================================================================== */
/* The card's background was `linear-gradient(135deg, #1f2a4d, #111830)` — the dark
 * theme's `--surface-raised` and `--bg-controls` written as literals — and
 * `.life-toast-icon` declared no colour, so `fill: currentColor` inherited
 * light-theme `--text-primary` and painted near-black ink on a navy card at 1.03:1.
 * Both declarations are individually correct, so no static check can find it. */
const toastPerTheme = {};
for (const theme of ['dark', 'light']) {
  await ev(`(() => {
    document.documentElement.setAttribute('data-theme', '${theme}');
    document.dispatchEvent(new Event('themechange'));
    const t = document.getElementById('celebrationToast');
    t.classList.add('is-wild', 'is-visible');
    return true;
  })()`);
  await sleep(220);
  toastPerTheme[theme] = JSON.parse(await ev(`(() => {
    const t = document.getElementById('celebrationToast');
    const ico = t.querySelector('.life-toast-icon');
    const cs = getComputedStyle(t), is = getComputedStyle(ico);
    return JSON.stringify({
      bg: cs.backgroundImage,
      color: cs.color,
      iconColor: is.color,
      border: cs.borderTopColor,
      headline: getComputedStyle(t.querySelector('.life-toast-headline')).color,
      eyebrow: getComputedStyle(t.querySelector('.life-toast-eyebrow')).color
    });
  })()`));
}

const grounds = {};
for (const theme of ['dark', 'light']) {
  const t = toastPerTheme[theme];
  const px = /rgb\((\d+), (\d+), (\d+)\)/g;
  const rgbOf = s => (s.match(/rgb\((\d+), (\d+), (\d+)\)/) || [0, 0, 0, 0]).slice(1).map(Number);
  const stops = [...t.bg.matchAll(px)].map(m => m.slice(1).map(Number));
  // The card is a gradient, so every foreground is measured against the worse of the
  // two stops.
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = a => {
    const fg = lum(a);
    return Math.min(...stops.map(g => { const [x, y] = [fg, lum(g)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }));
  };
  grounds[theme] = {
    icon: +ratio(rgbOf(t.iconColor)).toFixed(2),
    headline: +ratio(rgbOf(t.headline)).toFixed(2),
    eyebrow: +ratio(rgbOf(t.eyebrow)).toFixed(2),
    border: +ratio(rgbOf(t.border)).toFixed(2)
  };
}

ok(toastPerTheme.dark.bg !== toastPerTheme.light.bg,
  `the toast background follows the theme (dark: ${toastPerTheme.dark.bg.slice(0, 40)}…)`);
/* Not asserted here: "the computed background contains no navy hex" (§3.G's shape).
 * In dark theme `--surface-raised` resolves to rgb(31, 42, 77), so a check for the
 * literal cannot tell a token from a typed-in value. "The two themes differ" is
 * falsifiable from the rendered page; "the stylesheet names no literal" is the static
 * check's claim. */
for (const theme of ['dark', 'light']) {
  const g = grounds[theme];
  ok(g.icon >= 4.5, `${theme}: the toast icon reads at ${g.icon}:1 on its card (need 4.5)`);
  ok(g.headline >= 4.5, `${theme}: the headline reads at ${g.headline}:1 on its card (need 4.5)`);
  ok(g.eyebrow >= 4.5, `${theme}: the eyebrow reads at ${g.eyebrow}:1 on its card (need 4.5)`);
  // The wild border is a non-text boundary: WCAG 1.4.11 asks 3:1, not 4.5.
  ok(g.border >= 3, `${theme}: the wild border reads at ${g.border}:1 (1.4.11 needs 3)`);
}

/* The encounter's own sprite, different per encounter. Counting the element reads
 * like the guard; drawing it and measuring alpha is the guard, because an `<img>`
 * with a broken src is still a 44x44 box and `naturalWidth === 0` is what says so. */
const spriteProbe = JSON.parse(await ev(`(async () => {
  const seen = [];
  for (const id of [1, 25, 133, 700, 838]) {
    const img = new Image();
    img.src = 'assets/images/sprite/' + id + '.png';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('404')); });
    const S = 44, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
    seen.push({ id, w: img.naturalWidth, ink });
  }
  const live = document.querySelector('#celebrationToast .life-toast-sprite');
  return JSON.stringify({
    seen,
    liveIsImg: !!live && live.tagName === 'IMG',
    liveSrc: live ? live.getAttribute('src') : null,
    liveAlt: live ? live.getAttribute('alt') : null
  });
})()`));
eq(spriteProbe.seen.filter(s => s.w === 0).map(s => s.id), [],
  'every sprite the toast can show decoded, so no encounter renders an empty box');
ok(spriteProbe.seen.every(s => s.ink > 100),
  `each drawn sprite carries ink (${spriteProbe.seen.map(s => s.ink).join('/')} px)`);
ok(new Set(spriteProbe.seen.map(s => s.ink)).size === spriteProbe.seen.length,
  'five species draw five different amounts of ink, so the icon is per-encounter');

/* The cry control's default is the claim, and it is invisible in a screenshot. The
 * control exists, starts off, and ticking it clears both mute fields, because
 * `get muted()` is their OR and clearing only the stored one leaves the page
 * silent. */
const cryCtl = JSON.parse(await ev(`(() => {
  const box = document.getElementById('chkEncounterCry');
  if (!box) return JSON.stringify({ missing: true });
  const before = box.checked;
  box.click();
  return JSON.stringify({
    before,
    after: box.checked,
    stored: JSON.parse(localStorage.getItem('pokemon-algorithm:cry-volume') || '{}')
  });
})()`));
ok(!cryCtl.missing, 'the encounter-cry checkbox is mounted');
eq(cryCtl.before, false, 'it is OFF on load, because 10x fires an encounter every 2 seconds');
eq(cryCtl.after, true, 'clicking it turns sound on');
eq(cryCtl.stored.muted, false, 'and that choice is what gets written to the shared preference');

// And back off again, so the run leaves the profile as it found it.
await ev(`document.getElementById('chkEncounterCry').click(); true`);
const cryOff = JSON.parse(await ev(`JSON.stringify({
  checked: document.getElementById('chkEncounterCry').checked,
  muted: JSON.parse(localStorage.getItem('pokemon-algorithm:cry-volume') || '{}').muted
})`));
eq(cryOff.checked, false, 'clicking it again turns sound off');
eq(cryOff.muted, true, 'and persists that');

/* ==========================================================================
   7. THE TYPE WASH — COUNTED BY ALPHA, ON THE REAL CANVAS
   ==========================================================================

   The wash's claim is a pixel claim: a freed cell shows its last occupant's primary
   type, an occupied cell shows nothing, a never-claimed cell shows nothing, and the
   toggle removes all of it. Alpha separates the four states (§3.G3's rule, for the
   same reason it applies to sorting.html's lanes).

   The canvas is transparent where nothing is drawn and the ground behind it is a CSS
   `radial-gradient` (life.css:229/234), so `getImageData` returns alpha 0 for the
   ground. The wash is the one thing that puts a partial alpha on an otherwise
   untouched canvas: an occupied cell is opaque where its sprite is and 0 where it is
   not, and the wash sits at TERRITORY_ALPHA*255. §3.C's "sample decoded pixels rather
   than getComputedStyle" is satisfied for the colour question by taking the RGB the
   wash carries.

   Real mouse presses, not `element.click()` (§3.N's finding): the handlers are
   `mousedown` on the canvas and `mousemove` on window, so a synthetic `.click()` would
   place nothing and the section would pass vacuously. */
console.log('--- type wash on the canvas ---');

// CELL_SIZE is read out of the source rather than restated (§3.S): a hardcoded 36
// here is a second copy of the number the mapping depends on, and it goes stale
// silently.
const lifeJsSrc = readFileSync(join(ROOT, 'assets/js/life.js'), 'utf8');
const CELL_SIZE = Number((lifeJsSrc.match(/const CELL_SIZE = (\d+)/) || [])[1]);
ok(Number.isFinite(CELL_SIZE) && CELL_SIZE > 0, `CELL_SIZE is readable from life.js (${CELL_SIZE})`);

/** Wait two animation frames: the renderer is a rAF loop, so a state change is not
 *  on the canvas until it has been painted. */
const frames = () => ev(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);

/** World cell -> viewport point, using the page's own canvas rect. Assumes the
 *  boot-time centred camera, which is asserted below rather than trusted. */
const pointFor = async (wx, wy) => JSON.parse(await ev(`(() => {
  const c = document.getElementById('lifeCanvas');
  const r = c.getBoundingClientRect();
  const CELL = ${CELL_SIZE};
  return JSON.stringify({
    x: r.left + r.width / 2 + ${wx} * CELL,
    y: r.top + r.height / 2 + ${wy} * CELL
  });
})()`));

const press = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await frames();
};

/** Two cells' worth of pixels in one round trip: (0,0) is the cell under test and
 *  (-9,-9) is a control that is never brushed. */
const sample = async () => JSON.parse(await ev(`(() => {
  const c = document.getElementById('lifeCanvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const CELL = ${CELL_SIZE};
  const at = (wx, wy) => {
    const d = ctx.getImageData(
      Math.round(c.width / 2 + wx * CELL + CELL / 2),
      Math.round(c.height / 2 + wy * CELL + CELL / 2), 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  };
  return JSON.stringify({ home: at(0, 0), far: at(-9, -9) });
})()`));

// Pick the brush explicitly rather than relying on it being the default.
await ev(`document.querySelector('[data-tool="brush"]').click(); true`);

// Three things are set up before any pixel is read.
//
// 1. Pause. A section that measures "is this cell dead" cannot assume the clock is
//    stopped; a background tick would kill the brushed cell, and a wild pack could
//    take it before it is read.
// 2. Wild encounters off. `pickWildSite` places a three-cell pack on any free site
//    with a 1-cell moat, and the origin is a free site.
// 3. Empty board. life.html seeds a 32x22 box centred on the origin at 20% density,
//    so world (0,0) is already occupied before the first click. 清空 clears the cells
//    and the wash together.
const setup = JSON.parse(await ev(`(() => {
  const btn = document.getElementById('btnPlay');
  // The button reads 暫停 while the clock is running (§3.K), so this pauses only if
  // it has to; clicking it blindly would start the sim.
  const wasPlaying = /暫停/.test(btn.textContent || '');
  if (wasPlaying) btn.click();
  const wild = document.getElementById('chkWild');
  const wildWasOn = wild.checked;
  if (wildWasOn) wild.click();
  document.getElementById('btnClear').click();
  return JSON.stringify({ wasPlaying, wildWasOn });
})()`));
ok(setup.wasPlaying === false, `the simulation is paused before any pixel is read (was playing: ${setup.wasPlaying})`);
eq(setup.wildWasOn, true, 'wild encounters were on when this section started, so the off-switch is doing work');
await frames();
await frames();

// A cell that has never been touched: the control for "nothing is painted here".
const ground = await sample();
eq(ground.far.a, 0, 'an untouched cell paints nothing at all (alpha 0, the ground shows through)');

// Brush Bulbasaur into world (0,0). 妙蛙種子's primary type is Grass.
await press((await pointFor(0, 0)).x, (await pointFor(0, 0)).y);
const occupied = await sample();
ok(occupied.home.a === 0 || occupied.home.a === 255,
  `the brush actually placed a sprite at the predicted cell (alpha ${occupied.home.a})`);
ok(occupied.home.a !== ground.far.a || occupied.home.r !== ground.far.r,
  'and world (0,0) now differs from the untouched control cell');

// 單步 advances exactly one generation, and an isolated cell has no neighbours, so
// Conway kills it. Place, step, and the colour is left behind.
await ev(`document.getElementById('btnStep').click(); true`);
await frames();
await frames();
const freed = await sample();

// The wash's alpha is TERRITORY_ALPHA * 255 and nothing else on this canvas sits in
// that band: the sprite is 0 or 255, and the grid lines are strokes, not cell fills.
ok(freed.home.a > 8 && freed.home.a < 250,
  `the dead cell paints a PARTIAL alpha — a wash, not a sprite (${freed.home.a}/255)`);
ok(freed.home.g > freed.home.r && freed.home.g > freed.home.b,
  `and it is GREEN, because 妙蛙種子's primary type is Grass (rgb ${freed.home.r}/${freed.home.g}/${freed.home.b})`);
eq(freed.far.a, 0, 'while the never-claimed cell beside it is still untouched');

// The occupied-cell rule needs the sprite present and the wash absent at once.
await ev(`document.querySelector('[data-tool="brush"]').click(); true`);
await press((await pointFor(0, 0)).x, (await pointFor(0, 0)).y);
const reOccupied = await sample();
ok(reOccupied.home.a === 255,
  `a re-occupied cell is opaque — the wash is not what is showing through the sprite (${reOccupied.home.a}/255)`);

// The toggle. Clicking it must cost nothing and change nothing else.
await ev(`document.getElementById('chkTerritory').click(); true`);
await frames();
const washOff = await sample();
ok(reOccupied.home.a === 255, 'the control sample before the toggle really was opaque');
eq(washOff.far.a, 0, 'with 屬性殘影 off, an unfilled cell is untouched as before');
await ev(`document.getElementById('chkTerritory').click(); true`);
await frames();

// The theme pair, measured the way §3.C demands rather than asserted from the
// constant: put a claim on a dead cell, switch the theme the way a reader does, and
// read the alpha the wash actually painted.
//
// The theme is set by writing `dataset.theme` because that is the branch the renderer
// reads (§3.X). What this cannot measure is what the wash composites to against the
// CSS gradient underneath; that needs a screenshot.
const originalTheme = await ev(`document.documentElement.dataset.theme || ''`);
const p22 = await pointFor(2, 2);
await press(p22.x, p22.y);
await ev(`document.getElementById('btnStep').click(); true`);
await frames();
await frames();

const themeAlphas = JSON.parse(await ev(`(async () => {
  const wait = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c = document.getElementById('lifeCanvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const CELL = ${CELL_SIZE};
  const at = (wx, wy) => ctx.getImageData(
    Math.round(c.width / 2 + wx * CELL + CELL / 2),
    Math.round(c.height / 2 + wy * CELL + CELL / 2), 1, 1).data;
  const out = {};
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    await wait(); await wait();
    const d = at(2, 2);
    out[theme] = { a: d[3], g: d[1], r: d[0], b: d[2] };
  }
  return JSON.stringify(out);
})()`));

ok(themeAlphas.light.a > themeAlphas.dark.a,
  `the light theme carries MORE alpha than the dark one (${themeAlphas.light.a} vs ${themeAlphas.dark.a} of 255) — a near-white ground has no headroom to spare`);
ok(themeAlphas.dark.a > 20 && themeAlphas.light.a > 40,
  `and both read as a colour rather than as nothing (dark ${themeAlphas.dark.a}/255, light ${themeAlphas.light.a}/255)`);
ok(themeAlphas.light.g > themeAlphas.light.r && themeAlphas.light.g > themeAlphas.light.b,
  `the light-theme wash is still recognisably Grass (rgb ${themeAlphas.light.r}/${themeAlphas.light.g}/${themeAlphas.light.b})`);

await ev(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}; true`);
await frames();

/* ==========================================================================
   8. THE TYPE DRAWER — TWO NUMBERS THAT ARE NOT THE SAME NUMBER
   ==========================================================================

   The button and the list answer different questions:

     屬性 (n/15)   types this board has ever held. Monotonic; erasing the last cell
                   of a type does not un-collect it.
     the list       a snapshot: (that type's live + wash) / (all live + wash).
                   An erased wash leaves the list and stays on the button.

   Both halves are driven through the real UI: a press on the canvas, and the 圖鑑
   drawer to change the brush species. Driving `activeSpeciesId` directly would pass
   against a page whose picker was broken (§3.N's mistake one field over).

   The order matters and is asserted at each step, because a counter that is right for
   the wrong reason is still wrong. */
console.log('--- type drawer ---');

// Reuse the section's paused, empty board: a seeded board's population would make
// "how many types has it collected" depend on how many ticks ran.
await ev(`document.querySelector('[data-tool="brush"]').click(); true`);
await ev(`document.getElementById('btnClear').click(); true`);
await frames();
await frames();

const typeLabel = () => ev(`document.getElementById('btnTypeCount').textContent`);
const typeDrawer = async () => JSON.parse(await ev(`(() => {
  document.getElementById('btnTypeDrawer').click();
  const rows = [...document.querySelectorAll('#typeList .life-type-row')].map(r => ({
    text: r.textContent.replace(/\\s+/g, ' ').trim(),
    empty: r.classList.contains('is-empty')
  }));
  return JSON.stringify({
    summary: document.getElementById('typeSummary').textContent,
    eraNote: document.getElementById('typeEraNote').textContent,
    rows,
    segs: document.querySelectorAll('#typeBar .life-type-seg').length,
    open: document.getElementById('typeDrawer').classList.contains('is-open')
  });
})()`));

/** Brush the current species at a world cell. */
const brushCell = async (wx, wy) => {
  const p = await pointFor(wx, wy);
  await press(p.x, p.y);
};

/** Change the brush species the way a reader does: open 圖鑑, click the tile. */
const pickSpecies = async (dexNum) => {
  await ev(`document.getElementById('btnDexDrawer').click(); true`);
  await sleep(250);
  const picked = await ev(`(() => {
    const tile = [...document.querySelectorAll('#dexGrid .life-dex-item')]
      .find(e => e.querySelector('.life-dex-num').textContent === '#${dexNum}');
    if (!tile) return false;
    tile.click();
    return true;
  })()`);
  eq(picked, true, `the Pokédex drawer has a tile for #${dexNum}, so the brush species is reachable`);
  await sleep(150);
};

const empty1 = await typeDrawer();
eq(empty1.summary, '盤面尚無寶可夢。', 'an empty board says so rather than printing 0/0');
// 15, the generation's own count. It is not 17 because the 伊布 branch is
// era-restricted: a classic Gen 1 Eevee reaches only 水/雷/火伊布, all era-1 types.
// `check_life_page.mjs` asserts that across 9 generations × 2 modes.
eq(empty1.rows.length, 15, `a classic Gen 1 drawer lists 15 rows (${empty1.rows.length})`);
ok(/鋼、惡、妖精/.test(empty1.eraNote),
  `and names the three types Gen 1 lacks: "${empty1.eraNote}"`);
eq(empty1.segs, 0, 'and draws no bar segments, since nothing has a share');
eq(await typeLabel(), '屬性 (0/15)', 'a cleared board has collected no types');

// Two species, two types. 妙蛙種子 is 草; 小拉達 is 一般.
await brushCell(0, 0);
eq(await typeLabel(), '屬性 (1/15)', 'one 妙蛙種子 collects 草');
await pickSpecies('0019');   // 小拉達
await brushCell(1, 0);
eq(await typeLabel(), '屬性 (2/15)', 'adding 小拉達 collects 一般 — the count grows');

const two = await typeDrawer();
ok(/活體 2 隻/.test(two.summary) && /合計 4 格/.test(two.summary),
  `the denominator is live PLUS wash (${two.summary})`);
eq(two.segs, 2, 'the bar draws one segment per non-zero type');
{
  // Exactly two rows carry a share and together they are 100%: "some row is 100%"
  // would pass if only one type were counted.
  const nonEmpty = two.rows.filter(r => !r.empty);
  eq(nonEmpty.length, 2, `exactly 2 of the 15 rows are non-empty (${nonEmpty.length})`);
  const pcts = nonEmpty.map(r => Number(r.text.match(/([\d.]+)%$/)[1]));
  ok(Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) < 0.2,
    `and their shares sum to 100% (${pcts.join(' + ')})`);
  ok(nonEmpty.some(r => r.text.startsWith('草')) && nonEmpty.some(r => r.text.startsWith('一般')),
    `both collected types are listed (${nonEmpty.map(r => r.text).join(' / ')})`);
}

// Both die by underpopulation; the wash outlives them and the LIST keeps counting.
await ev(`document.getElementById('typeClose').click(); true`);
await ev(`document.getElementById('btnStep').click(); true`);
await frames();
await frames();
eq(await typeLabel(), '屬性 (2/15)', 'after both die the collection is unchanged — it is 「曾經」');
const washed = await typeDrawer();
ok(/活體 0 隻/.test(washed.summary) && /合計 2 格/.test(washed.summary),
  `and the list is now wash-only (${washed.summary})`);

// The erasure asymmetry, which is the one a snapshot-only implementation gets wrong.
await ev(`document.getElementById('typeClose').click();
  document.querySelector('[data-tool="eraser"]').click(); true`);
await sleep(150);
await brushCell(0, 0);
await brushCell(1, 0);
eq(await typeLabel(), '屬性 (2/15)',
  'erasing every cell of both types does NOT un-collect them — the button only grows');
const erased = await typeDrawer();
eq(erased.summary, '盤面尚無寶可夢。', 'while the list is a snapshot and is empty again');
eq(erased.segs, 0, 'with no bar segments left');

// The generation switch re-bases both halves: the denominator changes and the
// collection starts over.
await ev(`document.getElementById('typeClose').click(); true`);
// 草 was erased earlier and stays collected, so adding it again cannot move the
// number. The assertion below re-checks 2 rather than 1 for this reason.
await pickSpecies('0001');
await brushCell(2, 0);
eq(await typeLabel(), '屬性 (2/15)',
  'a further 妙蛙種子 adds nothing — 草 was collected before the erase, and a collection does not un-collect');
// The tab only selects; 鎖定世代並開始模擬 commits it. Driving the tab alone leaves
// the page on Gen 1 (§3.I's mistake in a new place), and every generation assertion
// after it tests the wrong board.
await ev(`document.getElementById('btnOpenSetup').click(); true`);
await sleep(200);
await ev(`[...document.querySelectorAll('.life-gen-tab-btn')].find(b => /第 2 世代/.test(b.textContent)).click(); true`);
await sleep(300);
await ev(`document.getElementById('setupSubmit').click(); true`);
await sleep(600);
await ev(`document.getElementById('chkWild').checked && document.getElementById('chkWild').click(); true`);
await frames();
const gen2 = await typeDrawer();
eq(gen2.rows.length, 17, `a Gen 2 drawer lists 17 rows (${gen2.rows.length})`);
ok(/妖精/.test(gen2.eraNote) && !/鋼/.test(gen2.eraNote),
  `and only Fairy is still missing — Dark and Steel arrived with it: "${gen2.eraNote}"`);

// Locking a generation seeds a fresh board, so the collection is not 0 here. What
// matters is the denominator re-basing, then that clearing drops it to 0/17, which
// proves the Gen 1 collection did not carry across the switch.
ok(/^屬性 \(\d+\/17\)$/.test(await typeLabel()),
  `the button's denominator re-bases to Gen 2's 17 (${await typeLabel()})`);
await ev(`document.getElementById('typeClose').click();
  document.getElementById('btnClear').click(); true`);
await sleep(300);
eq(await typeLabel(), '屬性 (0/17)',
  'and clearing a Gen 2 board reads 0/17 — the Gen 1 collection did not carry over');

await ev(`document.getElementById('typeClose').click(); true`);

/* --- Let's Go: the same Gen 1 roster at a 2018 type era. -------------------
   The modes are named after the Dex they draw from, not the year the game shipped,
   so a Let's Go board is Gen 1's 151 species read at era 7. The denominator opens to
   18, and a species that changed type in Gen 6 reports its modern typing. */
await ev(`document.getElementById('btnOpenSetup').click(); true`);
await sleep(250);
// Back to Gen 1 first. The Let's Go radios are built by renderSetupModal() and only
// for a generation that has letsGoStarters; the previous block left this page on
// Gen 2, where they do not exist.
await ev(`[...document.querySelectorAll('.life-gen-tab-btn')].find(b => /第 1 世代/.test(b.textContent)).click(); true`);
await sleep(300);
const letsGoRadio = await ev(`(() => {
  const r = document.querySelector('input[name="letsGoMode"][value="letsgo"]');
  if (!r) return false;
  r.click();
  return true;
})()`);
eq(letsGoRadio, true, 'the Gen 1 setup modal offers a Let\'s Go mode at all');
await sleep(250);
await ev(`document.getElementById('setupSubmit').click(); true`);
await sleep(700);
await ev(`const b = document.getElementById('btnPlay'); if (/暫停/.test(b.textContent)) b.click(); true`);
await ev(`document.getElementById('chkWild').checked && document.getElementById('chkWild').click();
  document.getElementById('btnClear').click(); true`);
await sleep(400);

const lg = await typeDrawer();
eq(lg.rows.length, 18, `a Let's Go Gen 1 drawer lists all 18 types (${lg.rows.length})`);
ok(/2018/.test(lg.eraNote),
  `and the note says why the era moved: "${lg.eraNote}"`);
eq(await typeLabel(), '屬性 (0/18)', 'and the button counts against 18');

// The species-level half: place a 皮皮 and read its claim back off the wash. 皮皮 is
// Fairy in the data; classic Gen 1 says 一般 and Let's Go must say 妖精.
//
// Close the drawer first: `typeDrawer()` above left it open, and it is a fixed
// overlay, so the press would go to the drawer rather than the canvas.
await ev(`document.getElementById('typeClose').click(); true`);
await sleep(200);
// Also select the brush: the erasure block switched to 抹除 and never switched
// back, and a press with 抹除 active places nothing.
await ev(`document.querySelector('[data-tool="brush"]').click(); true`);
await ev(`document.getElementById('btnClear').click(); true`);
await sleep(200);
await pickSpecies('0035');
await brushCell(0, 0);
await ev(`document.getElementById('btnStep').click(); true`);
await frames();
await frames();
const lgClefairy = await typeDrawer();
const lgTop = lgClefairy.rows.filter(r => !r.empty);
eq(lgTop.length, 1, `exactly one type holds a share after the 皮皮 died (${lgTop.length})`);
ok(lgTop[0] && lgTop[0].text.startsWith('妖精'),
  `and it is 妖精 — the 2018 typing, not the 一般 a classic Gen 1 board claims (got "${lgTop[0] ? lgTop[0].text : 'nothing'}")`);

await ev(`document.getElementById('typeClose').click(); true`);

/* ==========================================================================
   9. NO CONSOLE ERRORS
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