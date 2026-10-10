/**
 * Browser check for graph.html — the 3D force-directed knowledge graph.
 *
 * IT HAD NO ASSERTIONS. It measured five values, printed all five, and then exited
 * zero unconditionally; the only way it could fail was for the CDP plumbing to throw,
 * so it reported "Test completed successfully!" having verified nothing. A smoke test
 * that cannot fail is worse than no test in a manifest, because it costs seconds and
 * its green row reads like coverage. The values were already computed and thrown away,
 * so the assertions below are mostly a matter of deciding what each one means.
 *
 * RENAMED from test_graph_browser.mjs. Every harness in scripts/ is named
 * test_check_<checker>.mjs, so the mutation harness for this file is
 * test_check_graph_browser.mjs, and a checker called check_graph_browser.mjs has to
 * exist for that name to refer to anything.
 *
 * The four assertions that were worth making are the ones a broken page would fail:
 * the canvas exists (§3.G3's shape — a graph page that renders nothing), the entity
 * and relation counts match graph_data.json rather than the placeholder the HTML
 * ships with, and the two-step search -> dossier flow actually opens something.
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from './lib/cdp-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* The expected counts are FETCHED FROM THE PAGE, not read off disk, and the difference
 * matters more than it looks. Reading the file compares the badge against a second copy
 * of the data — one the browser never saw — so a page served a different graph_data.json
 * than the one on disk would be judged against the wrong numbers. Fetching it in-page
 * compares the badge against the data the page actually loaded, which is the only pair
 * that can be wrong together.
 *
 * It also makes this checker work against a tree it did not come from. The mutation
 * harness serves a trimmed graph on its own port (test_check_graph_browser.mjs), and a
 * disk read would assert 1,346 against a badge showing 120.
 *
 * The HTML ships a PLACEHOLDER badge ("1,346 實體 · 978 關係") that graph.js overwrites;
 * asserting the placeholder would assert nothing at all.
 */

/* GRAPH_PORT so the mutation harness can serve a mutated tree on its own port.
 * The other five CDP checkers already honour an env var and the runner's probe only
 * reads CRY_PORT, so this one hardcoded 5500 could disagree with the runner about
 * which server is up. */
const PORT = Number(process.env.GRAPH_PORT) || 5500;
/* CHROME PICKS ITS OWN DEBUG PORT, AND THIS FILE READS IT BACK.
 *
 * `--remote-debugging-port=0` hands the choice to the OS, which then writes the number
 * it chose into <profile>/DevToolsActivePort. That deletes a whole class of problem
 * rather than managing it. Two earlier versions both collided:
 *
 *   - cdpPort('graph'), which is base + (pid % 120). Concurrent cases are separate
 *     processes, so two of them land on the same number about 1 time in 120.
 *   - 9600 + caseIndex, which is deterministic and therefore WORSE: a run interrupted
 *     before cleanup leaves a Chrome holding 9603, and every later run asks for 9603
 *     again. It failed twice in a row, and assertPortFree was right to refuse both
 *     times — a loud abort beats a wrong measurement, but a 100% flake is still a flake.
 *
 * An OS-assigned port cannot be poisoned, because the next run is not given it again.
 * assertPortFree is therefore not called here and this checker is the one browser
 * check in the suite that does not use cdpPort('graph'): a port nothing else could
 * have been handed cannot already be serving a stranger's browser. `graph` stays in
 * CDP_PORT_BASE because it costs one line and removing it would move every other
 * checker's window.
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
], { stdio: 'ignore' });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

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

  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)));
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

  /* POLL FOR READINESS INSTEAD OF SLEEPING FOUR SECONDS.
   *
   * graph.js hides its loader when the graph is built and replaces it with an error
   * message when the build fails, so `is-hidden` on #graph-loading is the page saying
   * it is done — and its absence with the error text present is the page saying it
   * failed. A fixed sleep is a guess in both directions (§3.G5): too short and this
   * measures a page that has not built, too long and every run pays the margin.
   */
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

  /* THE CANVAS IS THE WHOLE POINT OF THE PAGE. §3.G3 shipped six permanently blank
   * lanes through a 41-script suite, and this is the same shape one layer up: a
   * knowledge graph that renders no canvas looks like a page with a spinner that
   * never resolves, and nothing about the DOM says why. */
  const hasCanvas = await ev('document.querySelector("#graph-container canvas") !== null');
  ok(hasCanvas === true, `the 3D canvas exists (got ${hasCanvas})`);

  const canvasSized = await ev('(() => { const c = document.querySelector("#graph-container canvas"); return c ? [c.width, c.height] : null; })()');
  ok(Array.isArray(canvasSized) && canvasSized[0] > 0 && canvasSized[1] > 0,
     `the canvas is sized (${JSON.stringify(canvasSized)})`);

  /* What the page itself loaded. Fetched over HTTP from the page's own origin, so this
   * is the same bytes graph.js built the graph from. */
  const META = await ev('fetch("assets/data/graph_data.json").then((r) => r.json()).then((j) => j.metadata)');
  ok(META && typeof META.total_nodes === 'number', `the page can re-read its own graph_data.json (${JSON.stringify(META && META.total_nodes)})`);

  // ---- the counts came from the data, not the placeholder ---------------
  /* graph.html ships "1,346 實體 · 978 關係" as static text and graph.js overwrites
   * it from the loaded graph. Asserting the HTML value would pass on a page whose
   * JavaScript never ran at all, which is the failure this file spent its life
   * reporting as success. The relation count is the sharper of the two: 978 is in
   * neither graph_data.json nor anything derivable from it. */
  const badge = await ev('document.getElementById("graph-count-badge")?.textContent ?? null');
  ok(typeof badge === 'string' && !badge.includes('978'),
     `the entity/relation badge was rewritten at runtime (${badge})`);
  ok(typeof badge === 'string' && badge.includes(String(META.total_nodes)),
     `the badge reports graph_data.json's ${META.total_nodes} entities (${badge})`);
  ok(typeof badge === 'string' && badge.includes(String(META.total_links)),
     `the badge reports graph_data.json's ${META.total_links} relations (${badge})`);

  // ---- search ----------------------------------------------------------
  await ev(`
    const input = document.getElementById("hud-search");
    input.value = "皮卡丘";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await new Promise(r => setTimeout(r, 500));

  const hits = await ev('[...document.querySelectorAll(".search-item-name")].map((e) => e.textContent)');
  ok(Array.isArray(hits) && hits.length > 0, `searching 皮卡丘 returns at least one result (got ${Array.isArray(hits) ? hits.length : typeof hits})`);
  ok(Array.isArray(hits) && hits.includes('皮卡丘'), `the result set contains 皮卡丘 itself (got ${JSON.stringify(hits)})`);

  // ---- dossier ---------------------------------------------------------
  await ev('document.querySelector(".search-item")?.click()');
  await new Promise(r => setTimeout(r, 600));

  const dossierActive = await ev('document.getElementById("graph-dossier")?.classList.contains("is-active")');
  ok(dossierActive === true, `clicking a search result opens the dossier (got ${dossierActive})`);
  const dossierName = await ev('document.getElementById("dossier-name-zh")?.textContent');
  eq(dossierName, '皮卡丘', 'the dossier names the species that was clicked');

  if (logs.length > 0) {
    console.log('Browser Logs:', logs);
  }

  // Capture screenshot
  //
  // Under `.cache/`, resolved from THIS FILE rather than the process CWD. The
  // original wrote a bare relative path, so the file landed in whatever
  // directory the test happened to be launched from — the repo root under
  // `check_all.mjs`, which is how a 545 KB PNG became an untracked file that
  // `git status` shows on every subsequent run. `.cache/` is already gitignored
  // (it holds the §4 skip cache), so nothing new has to be taught to ignore it,
  // and the artefact is deleted rather than left to accumulate.
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
  console.error('Test error:', err);
  cleanup();
  process.exit(1);
});
