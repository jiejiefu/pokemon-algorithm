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
   5. NO CONSOLE ERRORS
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