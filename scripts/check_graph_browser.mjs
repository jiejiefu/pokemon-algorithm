/**
 * Browser check for graph.html, the 3D force-directed knowledge graph.
 *
 * The four assertions a broken page would fail: the canvas exists (§3.G3's shape —
 * a graph page that renders nothing), the entity and relation counts match
 * graph_data.json rather than the placeholder the HTML ships with, and the two-step
 * search -> dossier flow actually opens something.
 *
 * Named check_graph_browser.mjs because every harness in scripts/ is
 * test_check_<checker>.mjs, and the mutation harness for this file is
 * test_check_graph_browser.mjs.
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from './lib/cdp-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* The expected counts are fetched from the page, not read off disk: the badge is
 * compared against the data the page actually loaded, which is the only pair that can
 * be wrong together. It also lets the checker run against the mutation harness's
 * trimmed graph on its own port, where a disk read would assert 1,346 against a badge
 * showing 120.
 *
 * The HTML ships a placeholder badge that graph.js overwrites. The check reads that
 * placeholder out of the served HTML rather than naming it; see the note at the
 * assertion itself.
 */

/* GRAPH_PORT lets the mutation harness serve a mutated tree on its own port. */
const PORT = Number(process.env.GRAPH_PORT) || 5500;
/* Chrome picks its own debug port and this file reads it back.
 *
 * `--remote-debugging-port=0` makes the OS choose and write the number into
 * <profile>/DevToolsActivePort. An OS-assigned port cannot be poisoned, because the
 * next run is not given it again, so assertPortFree is not called here and this is
 * the one browser check that does not use cdpPort('graph').
 */
const profile = mkdtempSync(join(tmpdir(), 'graph-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--use-gl=angle',
  '--use-angle=metal',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  `--window-size=1400,900`,
  'about:blank',
/* Chrome's own stderr is captured because a renderer that dies under WebGL contention
   says so here and nowhere else; CDP reports the same "Inspected target navigated or
   closed" for both cases. Only the tail is kept, and only when something goes wrong. */
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr?.on('data', d => { chromeErr = (chromeErr + d).slice(-4000); });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* The method the last pending call was waiting on, so a transport failure can name
     itself. "Inspected target navigated or closed" says where nothing. Module scope
     because the report is printed by the .catch below run(). */
let lastMethod = '(none)';

async function run() {
  /* Wait for Chrome to publish the port it chose, then for the page target on it. */
  let PORT_CDP = 0;
  for (let i = 0; i < 80 && !PORT_CDP; i++) {
    try {
      const n = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      if (n > 0) PORT_CDP = n;
    } catch (e) {}
    if (!PORT_CDP) await new Promise((r) => setTimeout(r, 100));
  }
  if (!PORT_CDP) {
    console.error('  FAIL Chrome never published a debug port to DevToolsActivePort');
    cleanup();
    process.exit(1);
  }

  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`);
      if (r.ok) { targets = await r.json(); break; }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!targets) {
    console.error('Could not reach Chrome target list');
    cleanup();
    process.exit(1);
  }

  const pageTarget = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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
  });

/* See the module-scope declaration above. Not reset on success: calls are awaited one
     at a time, so the most recently issued method is the outstanding one. */
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    lastMethod = method;
    pending.set(n, (x) => x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  let pass = 0; const fails = [];
  const ok = (c, w) => { if (c) pass++; else fails.push(w); console.log(`  ${c ? 'ok  ' : 'FAIL'} ${w}`); };
  const eq = (got, want, what) => ok(got === want,
    `${what} = ${JSON.stringify(got)}${got === want ? '' : ` (expected ${JSON.stringify(want)})`}`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://localhost:${PORT}/graph.html` });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  /* ---- waitFor: poll a page-side predicate, never sleep a fixed time ----
   *
   * graph.js's search is a 150ms debounce (graph.js:638) competing with a 1,346-node
   * force-directed rAF loop, so a fixed sleep is a guess in both directions.
   *
   * The poll waits for a predicate, never for the assertion itself (§3.B2's vacuity
   * shape): what is waited for is "the search has rendered a result", and what is
   * then asserted is which result. A timeout returns false so the assertion still runs
   * and prints its real number (§3.G5).
   */
  const waitFor = async (label, expression, timeoutMs = 12000, stepMs = 100) => {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await ev(expression);
      if (value) return { ok: true, value, waited: 0 };
      await new Promise(r => setTimeout(r, stepMs));
    }
    return { ok: false, value, waited: timeoutMs };
  };

  /* Poll for readiness. graph.js hides its loader when the graph is built and replaces
   * it with an error message when the build fails, so `is-hidden` on #graph-loading is
   * the page saying it is done. A fixed sleep is a guess in both directions (§3.G5):
   * too short and this measures a page that has not built. */
  const deadline = Date.now() + 30000;
  let ready = null;
  while (Date.now() < deadline) {
    ready = await ev(`(() => {
      const l = document.getElementById('graph-loading');
      if (!l) return { state: 'no-loader' };
      if (l.classList.contains('is-hidden')) return { state: 'ready' };
      if (l.textContent.includes('載入知識圖譜失敗')) return { state: 'failed', text: l.textContent.trim() };
      return { state: 'loading' };
    })()`);
    if (ready?.state === 'ready' || ready?.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  eq(ready?.state, 'ready', 'the graph finished building before the deadline');

  // ---- the page mounted -------------------------------------------------
  ok(logs.length === 0, `no uncaught exception while the graph built${logs.length ? `: ${logs.join(' | ')}` : ''}`);

  const title = await ev('document.title');
  ok(typeof title === 'string' && title.includes('寶可夢演算法'), `document.title names the site (${title})`);

  /* The canvas is the whole point of the page (§3.G3): a knowledge graph that renders
   * no canvas looks like a spinner that never resolves. */
  const hasCanvas = await ev('document.querySelector("#graph-container canvas") !== null');
  ok(hasCanvas === true, `the 3D canvas exists (got ${hasCanvas})`);

  const canvasSized = await ev('(() => { const c = document.querySelector("#graph-container canvas"); return c ? [c.width, c.height] : null; })()');
  ok(Array.isArray(canvasSized) && canvasSized[0] > 0 && canvasSized[1] > 0,
     `the canvas is sized (${JSON.stringify(canvasSized)})`);

  /* What the page itself loaded, over HTTP from its own origin. */
  const META = await ev('fetch("assets/data/graph_data.json").then((r) => r.json()).then((j) => j.metadata)');
  ok(META && typeof META.total_nodes === 'number', `the page can re-read its own graph_data.json (${JSON.stringify(META && META.total_nodes)})`);

  // ---- the counts came from the data, not the placeholder ---------------
  /* graph.html ships a placeholder badge as static text and graph.js overwrites it.
   * Asserting the HTML value would pass on a page whose JavaScript never ran.
   *
   * The placeholder is read from the served HTML, not typed in here. The earlier
   * `!badge.includes('978')` became unsatisfiable once graph.html's copy changed
   * (§3.B2's shape), and an unsatisfiable check passes on a page whose JavaScript never
   * ran. Reading it also
   * keeps this working against the harness's trimmed tree, whose real count is 120 and
   * whose HTML still says 1,346. */
  const placeholder = await ev(
    'fetch(location.pathname).then((r) => r.text()).then((t) => '
    + '(t.match(/id="graph-count-badge"[^>]*>([^<]*)</) || [])[1] ?? null)');
  const badge = await ev('document.getElementById("graph-count-badge")?.textContent ?? null');
  ok(typeof placeholder === 'string' && placeholder.length > 0,
     `graph.html still ships a static placeholder badge (${JSON.stringify(placeholder)})`);
  ok(typeof badge === 'string' && badge !== placeholder,
     `the entity/relation badge was rewritten at runtime (badge ${JSON.stringify(badge)}, placeholder ${JSON.stringify(placeholder)})`);
  ok(typeof badge === 'string' && badge.includes(String(META.total_nodes)),
     `the badge reports graph_data.json's ${META.total_nodes} entities (${badge})`);
  ok(typeof badge === 'string' && badge.includes(String(META.total_links)),
     `the badge reports graph_data.json's ${META.total_links} relations (${badge})`);

  // ---- the collapsed header, driven by REAL mouse events -----------------
/* This section dispatches real Input events at the button's own measured centre.
 *
 * graph-header.js rewrites the toggle's `innerHTML` on click, which destroys the
 * `<svg><path>` the reader pressed. The click then bubbles with an `e.target` that is
 * no longer in the tree (`isConnected === false`), so the module's click-outside guard
 * reads an inside click as an outside one and the bar closes itself in the same task.
 * `element.click()` passes where a real press fails (§3.G4's stubbed-fixture shape,
 * with the harness as the stub), so a checker built on it reports the page working.
 *
 * The three close paths that must survive the fix are asserted too: "the button opens"
 * and "the button opens and nothing else changed" are different claims. */
  const headerOpen = () => ev("document.querySelector('.graph-header')?.classList.contains('is-open') === true");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const realClickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(450);
  };

  const toggleBox = await ev(`(() => {
    const t = document.querySelector('[data-graph-header-toggle]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  ok(toggleBox && Number.isFinite(toggleBox.x) && toggleBox.y > 0 && toggleBox.y < 60,
     `graph.html mounts a visible [data-graph-header-toggle] in the header row (${JSON.stringify(toggleBox)})`);

  if (toggleBox) {
    ok(await headerOpen() === false, 'the header starts collapsed');
    for (let round = 1; round <= 3; round++) {
      await realClickAt(toggleBox.x, toggleBox.y);
      ok(await headerOpen() === true, `a real mouse press on the toggle opens the header (round ${round})`);
      ok(await ev("getComputedStyle(document.querySelector('.graph-header .site-nav')).visibility") === 'visible',
         `the nav is actually visible once open (round ${round})`);
      await realClickAt(toggleBox.x, toggleBox.y);
      ok(await headerOpen() === false, `the same button closes it again (round ${round})`);
    }

    /* The close paths. Closing the bar on a drag is what §3.N's 6px threshold exists
     * to prevent, and a regression there is invisible to the round above. */
    await realClickAt(toggleBox.x, toggleBox.y);
    ok(await headerOpen() === true, 'reopened for the close-path checks');

    /* A real click on the canvas — no drag, so the 6px threshold does not apply. */
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 520, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 520, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 520, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(450);
    ok(await headerOpen() === false, 'a click on empty canvas still closes the bar');

    await realClickAt(toggleBox.x, toggleBox.y);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 520, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 520, button: 'left', clickCount: 1, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 980, y: 580, button: 'left', clickCount: 1, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 980, y: 580, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
    ok(await headerOpen() === true, 'an 80px orbit drag on the canvas does not close the bar');

    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await sleep(400);
    ok(await headerOpen() === false, 'Escape closes the bar');
  }

  // ---- search ----------------------------------------------------------
/* The two poll ceilings are named because both the wait and the timeout message must
     read the same number; the harness reads that string. */
  const SEARCH_TIMEOUT_MS = 8000;
  const DOSSIER_TIMEOUT_MS = 3000;

  await ev(`
    const input = document.getElementById("hud-search");
    input.value = "皮卡丘";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  `);

  /* "The search has rendered something", not "it rendered the right thing": the
     predicate must be weaker than the assertion, or a wrong page times out instead of
     failing. */
  const searched = await waitFor('search results',
    'document.querySelectorAll(".search-item").length > 0', SEARCH_TIMEOUT_MS);

  const hits = await ev('[...document.querySelectorAll(".search-item-name")].map((e) => e.textContent)');
  ok(searched.ok && Array.isArray(hits) && hits.length > 0,
     `searching 皮卡丘 returns at least one result (got ${Array.isArray(hits) ? hits.length : typeof hits}${searched.ok ? '' : ` — nothing rendered within ${SEARCH_TIMEOUT_MS}ms`})`);
  ok(Array.isArray(hits) && hits.includes('皮卡丘'), `the result set contains 皮卡丘 itself (got ${JSON.stringify(hits)})`);

  // ---- dossier ---------------------------------------------------------
  /* The clicked row's id, read before the click because the predicate compares against
     it. `#dossier-id` is `formatPokemonId(...)` — "#0025" — so the comparison strips
     the punctuation. */
  const wantId = await ev('document.querySelector(".search-item")?.dataset.id ?? null');
  await ev('document.querySelector(".search-item")?.click()');

    /* "The dossier has been repopulated with the row that was clicked", a state rather
     than the assertion. `renderDossier()` is synchronous (graph.js:452), so this returns
     on the first tick in a healthy run. A null `wantId` (no search row) makes it false
     forever, which is correct: the click was a no-op.

     The comparison is numeric. `data-id` is the raw node id (`25`) while `#dossier-id`
     is `formatPokemonId(...)`, which zero-pads (`#0025`), so stripping the non-digits
     and string-comparing against "25" is false forever. */
  /* 8s for the search and 3s for the dossier. The search is debounced (150ms,
     graph.js:638) behind a setTimeout competing with a 1,346-node rAF loop, so it is the
     one wait that needs headroom. The dossier needs none: `renderDossier()` is
     synchronous (graph.js:452), so a healthy page has repopulated it before the click's
     task ends. At 12s/5s the harness spent +16.5s on one failing case alone; both
     ceilings still exceed the sleeps they replaced (§3.G5). */
  const repopulated = wantId === null
    ? { ok: false, skipped: true }
    : await waitFor('dossier repopulation',
        `(() => { if (${JSON.stringify(wantId)} === null) return false;
                  const el = document.getElementById('dossier-id');
                  return !!el && Number(el.textContent.replace(/\\D/g, '')) === Number(${JSON.stringify(wantId)}); })()`,
        DOSSIER_TIMEOUT_MS);

  const dossierActive = await ev('document.getElementById("graph-dossier")?.classList.contains("is-active")');
  ok(dossierActive === true, `clicking a search result opens the dossier (got ${dossierActive})`);
  const dossierName = await ev('document.getElementById("dossier-name-zh")?.textContent');
  eq(dossierName, '皮卡丘', 'the dossier names the species that was clicked');
  /* A different question from the two above: they ask whether the dossier is right,
     this asks whether the wait that produced that reading was sound. `skipped` means
     there was no row to click and the ceiling was never spent; a timeout means the row
     existed and the dossier ignored it, a page defect. */
  ok(repopulated.ok,
     `the dossier was repopulated with #${wantId} before it was read (${repopulated.ok ? 'observed'
        : repopulated.skipped ? 'no search row to click, so nothing was waited on'
        : 'still showing its previous contents after ' + DOSSIER_TIMEOUT_MS + 'ms'})`);

  if (logs.length > 0) {
    console.log('Browser Logs:', logs);
  }

  // Capture screenshot under `.cache/`, resolved from this file rather than the
  // process CWD. `.cache/` is already gitignored (it holds the §4 skip cache), so the
  // artefact stays untracked.
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  const shotPath = join(ROOT, '.cache', 'graph', 'screenshot_graph3d.png');
  mkdirSync(dirname(shotPath), { recursive: true });
  writeFileSync(shotPath, buf);
  console.log('Saved screenshot (gitignored):', shotPath.replace(`${ROOT}/`, ''), 'bytes:', buf.length);

  ws.close();
  cleanup();
  console.log(fails.length
    ? `\nFAIL  ${fails.length} of ${pass + fails.length} checks failed`
    : `\nPASS  ${pass} checks`);
  process.exit(fails.length ? 1 : 0);
}

run().catch(err => {
  console.error(`Test error: ${err.message}`);
  console.error(`  (last CDP call: ${lastMethod})`);
  if (chromeErr.trim()) {
    console.error('  Chrome stderr (tail):');
    for (const line of chromeErr.trim().split('\n').slice(-12)) console.error(`    ${line}`);
  }
  cleanup();
  process.exit(1);
});
