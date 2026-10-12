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
 * The HTML ships a PLACEHOLDER badge as static text that graph.js overwrites;
 * asserting the placeholder would assert nothing at all. The check reads the
 * placeholder OUT of the served HTML rather than naming it, because a literal here
 * went stale the moment graph.html's copy was corrected -- see the note at the
 * assertion itself for what that turned the check into.
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
/* Chrome's own stderr is CAPTURED, not inherited, and the reason is that a renderer
   that dies under WebGL contention says so here and nowhere else: the CDP side reports
   the same "Inspected target navigated or closed" -32000 that a navigation produces,
   which is a message that cannot tell the two apart. `stdio: 'ignore'` — what this used
   to be — threw the only evidence away, which is why this entry spent its life being
   "flaky" with no way to tell flaky from crashed. Only the tail is kept, and only when
   something went wrong, because a 1400x900 WebGL page is chatty on a normal run. */
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr?.on('data', d => { chromeErr = (chromeErr + d).slice(-4000); });

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* The method a pending call was waiting on, kept so a transport failure can name
     itself. "Inspected target navigated or closed" is a -32000 that says WHERE nothing:
     every CDP call in this file goes through `send`, so an unannotated crash reported a
     bare message and the reader had to bisect the file by hand to find which step lost
     the renderer. Two runs of this entry failed differently under tier B's three-at-a-
     time pool — one a transport error, one a dossier that had not opened yet — and
     without this line the first of those is indistinguishable from a page bug.
     Module scope, not local to run(), because the report is printed by the .catch
     BELOW run() and a variable declared inside the function it reports on is not in
     scope there. */
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

/* The method a pending call was waiting on, kept so a transport failure can name
     itself. See the module-scope declaration above. NOT reset on success: every call
     here is awaited one at a time, so the most recently ISSUED method is by
     construction the outstanding one, and a reset would report "(idle)" for exactly
     the failure it exists to describe. */
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

  /* ---- waitFor: poll a page-side PREDICATE, never sleep a fixed time ----
   *
   * This file slept 500ms for the search and 600ms for the dossier, and it was the
   * only reason this entry failed intermittently: 3 of 4 runs in `--only=model`, where
   * the runner has three browser entries plus this one's four-case harness in flight
   * and every one of them is a WebGL page. graph.js's search is a 150ms debounce
   * (graph.js:638), so the 500ms was a 350ms margin over a `setTimeout` competing with
   * a 1,346-node force-directed rAF loop on a saturated main thread. Under that load
   * the timer lands late and the assertion read an empty list — and the two assertions
   * after it failed for the same reason, not three separate defects.
   *
   * The poll is for a PREDICATE, never for the assertion itself (§3.B2's vacuity
   * shape): what is waited for is "the search has rendered a result", and what is then
   * asserted is WHICH result. A poll that waited for `hits.includes('皮卡丘')` would
   * return true on a page that got it right and would time out on one that got it
   * wrong — the same either way, which is to say it asserted nothing.
   *
   * Every ceiling here EXCEEDS the sleep it replaced, so the change can only add
   * tolerance, and a timeout returns false so the assertion still runs and still
   * prints its real number. That is §3.G5's rule, not a paraphrase of it.
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
  /* graph.html ships a PLACEHOLDER badge as static text and graph.js overwrites it
   * from the loaded graph. Asserting the HTML value would pass on a page whose
   * JavaScript never ran at all, which is the failure this file spent its life
   * reporting as success.
   *
   * THE PLACEHOLDER IS READ FROM THE SERVED HTML, NOT TYPED IN HERE. This assertion
   * used to be `!badge.includes('978')`, a negative check on one magic number, and
   * that is §3.B2's exact shape: the day graph.html's copy was corrected from 978 to
   * 2,687 the badge could no longer possibly contain 978, so the check became
   * UNSATISFIABLE-BY-CONSTRUCTION rather than false -- it passes on a page whose
   * JavaScript never ran. The mutation harness caught the consequence (the check it
   * attacks started failing on a different assertion) a day later than it should
   * have; the number was the fragile part and the comparison was the claim.
   *
   * Reading the placeholder also keeps this working against the harness's trimmed
   * tree, whose real count is 120 and whose HTML still says 1,346. */
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
/* EVERY OTHER ASSERTION IN THIS FILE CALLS `element.click()`, AND THAT IS WHY THE
 * HAMBURGER BROKE WITHOUT ANYBODY NOTICING.
 *
 * graph-header.js answers a click on the toggle by rewriting the button's
 * `innerHTML` (`toggle.innerHTML = iconSvg(open ? 'close' : 'menu')`). That destroys
 * the `<svg><path>` the reader pressed. The click keeps bubbling to the document with
 * an `e.target` that is no longer in the tree — measured, `isConnected === false` —
 * and the module's click-outside guard read `header.contains(e.target)`, which is
 * `false` for a detached node by definition. An INSIDE click therefore read as an
 * OUTSIDE one and the bar closed itself in the same task it opened: opened at 158 ms,
 * closed at 158 ms.
 *
 * `element.click()` passes where this fails, so a checker built on it reports the
 * page working. Measured before the fix: 0 of 5 dispatched mouse clicks opened the
 * bar, 5 of 5 `element.click()` calls did. The two disagree about whether the same
 * click worked, which is the shape §3.G4 warns about for a stubbed fixture — except
 * here the stub is the test harness itself, and it is the faithful one.
 *
 * So this section dispatches REAL Input events at the button's own measured centre.
 * It also asserts the three close paths that had to SURVIVE the fix, because "the
 * button opens" and "the button opens and nothing else changed" are different claims
 * and the guard is worth exactly as much as the weaker one. */
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
      ok(await headerOpen() === true, `a real mouse press on the toggle OPENS the header (round ${round})`);
      ok(await ev("getComputedStyle(document.querySelector('.graph-header .site-nav')).visibility") === 'visible',
         `the nav is actually visible once open (round ${round})`);
      await realClickAt(toggleBox.x, toggleBox.y);
      ok(await headerOpen() === false, `the same button CLOSES it again (round ${round})`);
    }

    /* The three close paths the fix had to leave alone. A guard that only proves the
     * button opens is half a guard: closing the bar by clicking a drag is exactly the
     * defect §3.N's 6px threshold exists to prevent, and a regression there would be
     * invisible to the round above. */
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
    ok(await headerOpen() === true, 'an 80px orbit DRAG on the canvas does NOT close the bar');

    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await sleep(400);
    ok(await headerOpen() === false, 'Escape closes the bar');
  }

  // ---- search ----------------------------------------------------------
/* THE TWO POLL CEILINGS, NAMED, because both the wait and the message that reports a
     timeout have to read the same number. The first version of this file passed 8000 to
     the search poll and printed "nothing rendered within 12000ms" — a report quoting a
     constant nobody set, which is a report that lies the day somebody changes it. The
     harness reads that string, so a mismatch is not cosmetic either. */
  const SEARCH_TIMEOUT_MS = 8000;
  const DOSSIER_TIMEOUT_MS = 3000;

  await ev(`
    const input = document.getElementById("hud-search");
    input.value = "皮卡丘";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  `);

  /* "The search has rendered SOMETHING" — not "it rendered the right thing". See
     waitFor's note: the predicate has to be weaker than the assertion, or the poll
     becomes the assertion and a wrong page times out instead of failing. */
  const searched = await waitFor('search results',
    'document.querySelectorAll(".search-item").length > 0', SEARCH_TIMEOUT_MS);

  const hits = await ev('[...document.querySelectorAll(".search-item-name")].map((e) => e.textContent)');
  ok(searched.ok && Array.isArray(hits) && hits.length > 0,
     `searching 皮卡丘 returns at least one result (got ${Array.isArray(hits) ? hits.length : typeof hits}${searched.ok ? '' : ` — nothing rendered within ${SEARCH_TIMEOUT_MS}ms`})`);
  ok(Array.isArray(hits) && hits.includes('皮卡丘'), `the result set contains 皮卡丘 itself (got ${JSON.stringify(hits)})`);

  // ---- dossier ---------------------------------------------------------
  /* The clicked row's id, read BEFORE the click, because the predicate below has to
     compare against it. `#dossier-id` is `formatPokemonId(...)` — "#0025" — so the
     comparison strips the punctuation rather than string-matching a format this file
     would otherwise have to restate. */
  const wantId = await ev('document.querySelector(".search-item")?.dataset.id ?? null');
  await ev('document.querySelector(".search-item")?.click()');

    /* "The dossier has been REPOPULATED with the row that was clicked" — a state, not
     the assertion. `renderDossier()` is synchronous (graph.js:452), so this returns on
     the first tick in every healthy run; it exists because the 600ms sleep it replaced
     was waiting for nothing, and a poll degrades to a no-op rather than to a flake.
     `wantId` being null (no search row) makes this false forever, which is correct:
     the click was a no-op and the two assertions below have to say so.

     THE COMPARISON IS NUMERIC, and it has to be. `data-id` is the raw node id (`25`)
     while `#dossier-id` is `formatPokemonId(...)`, which zero-pads (`#0025`) — so
     stripping the non-digits yields "0025" and a string comparison against "25" is
     false forever. That is not hypothetical: it is what the first version of this
     predicate did, and it failed on a page doing exactly the right thing. */
  /* 8s for the search and 3s for the dossier, both down from this helper's 12s default,
     and the asymmetry between them is the measurement rather than a preference.

     The search is genuinely debounced (150ms, graph.js:638) behind a `setTimeout` that
     competes with a 1,346-node rAF loop, so it is the one wait that was ever observed
     to need headroom. 8s is 16x the 500ms it replaced.

     The dossier needs none: `renderDossier()` is synchronous (graph.js:452), so a healthy
     page has already repopulated it before the click's own task ends and the FIRST poll
     tick reads true. 3s covers a click whose handler is slow to start and nothing else.

     MEASURED, because these numbers are a cost and not a preference: at 12s/5s the
     mutation harness went 32.8s -> 49.3s, and the whole +16.5s was ONE case — the
     mutation that breaks the page — waiting out both ceilings before reporting what it
     already knew. The healthy path is unaffected either way (6.30s vs 6.35s measured
     against the old fixed sleeps), so this is time paid only on runs that are already
     red. Both ceilings still exceed what they replaced, so the change can only add
     tolerance (§3.G5). */
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
  /* Reported separately from the two above because it is a DIFFERENT question: they ask
     whether the dossier is right, this asks whether the wait that produced that reading
     was sound. A green pair with `repopulated.ok === false` would mean the assertions
     passed against a dossier the poll never saw repopulate — which on a page whose click
     handler does nothing is the difference between "correct" and "never happened".

     The two failure messages are DISTINCT because they are different diagnoses, and
     collapsing them is what made this a flake nobody could read: `skipped` means there
     was no row to click, so the ceiling was never spent and the 3s was correctly not
     paid; `waited` means the row existed and the dossier ignored it, which is a page
     defect. The number is the ceiling actually configured, not the 12000 this line used
     to print — a report that quotes a constant nobody set is a report that lies the day
     somebody changes it. */
  ok(repopulated.ok,
     `the dossier was repopulated with #${wantId} before it was read (${repopulated.ok ? 'observed'
        : repopulated.skipped ? 'no search row to click, so nothing was waited on'
        : 'still showing its previous contents after ' + DOSSIER_TIMEOUT_MS + 'ms'})`);

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
  console.error(`Test error: ${err.message}`);
  console.error(`  (last CDP call: ${lastMethod})`);
  if (chromeErr.trim()) {
    console.error('  Chrome stderr (tail):');
    for (const line of chromeErr.trim().split('\n').slice(-12)) console.error(`    ${line}`);
  }
  cleanup();
  process.exit(1);
});
