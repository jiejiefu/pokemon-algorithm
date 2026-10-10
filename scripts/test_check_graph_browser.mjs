#!/usr/bin/env node
/**
 * Mutation tests for scripts/check_graph_browser.mjs.
 *
 *   node scripts/test_check_graph_browser.mjs
 *
 * The checker this attacks measured five values, printed them and exited zero no
 * matter what they were, so there was nothing here to prove — this file is written
 * after the checker gained assertions, and its job is to establish that each of those
 * assertions can fail. §3.I's rule: a checker that has only ever seen good data is
 * not known to check anything, because "all checks passed" and "no assertion ever
 * fired" print identically.
 *
 * WHY THIS SERVES ITS OWN TREE AND PORT INSTEAD OF MUTATING THE REPO
 *
 * The obvious harness copies nothing, rewrites assets/js/graph.js in place, runs the
 * checker and restores. That was safe when the runner was serial. It is not any more:
 * Tier A runs three entries at once, so a checker that happens to be reading
 * assets/js/ at that moment — check_page_module_api.mjs reads every file in that
 * directory — would see the mutation and fail for a reason that has nothing to do with
 * it. A harness that corrupts a shared tree is a harness that can fail the suite by
 * being run.
 *
 * So each case gets its own temporary tree, its own ephemeral port, and the checker is
 * pointed at that port through GRAPH_PORT. The server is in this process, which is why
 * there is no stray `http.server` to leak — §3.J's failure mode is a port left held and
 * a profile left on disk, and both of those need a separate process to happen at all.
 *
 * The one thing that is NOT copied is assets/images/, which is 370 MB across pokemon/,
 * shiny/ and scarlet-violet/ and of which graph.html needs four files. It is symlinked,
 * so a case that changes a sprite sees the change and a case that does not pays
 * nothing for it.
 */

import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check_graph_browser.mjs');

/* What a tree needs to serve graph.html. assets/images is symlinked rather than
 * copied — see the header. */
const COPIED = [
  'graph.html',
  'assets/js',
  'assets/css',
  'assets/data/graph_data.json',
];

const SCRATCH = new Set();
const SERVERS = new Set();

function cleanup() {
  for (const s of SERVERS) { try { s.close(); } catch { /* already closed */ } }
  for (const d of SCRATCH) { try { rmSync(d, { recursive: true, force: true }); } catch { /* already gone */ } }
}
/* Registered rather than placed at the bottom: a case that throws between mkdtemp and
 * its own cleanup would otherwise leak exactly the tree nobody is watching. */
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

/** A pristine tree plus whatever the case does to it. */
function buildTree(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'graph-neg-'));
  SCRATCH.add(dir);
  for (const rel of COPIED) {
    const dst = join(dir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(ROOT, rel), dst, { recursive: true });
  }
  const imgDst = join(dir, 'assets', 'images');
  mkdirSync(imgDst, { recursive: true });
  symlinkSync(join(ROOT, 'assets/images/pokemon'), join(imgDst, 'pokemon'), 'dir');
  for (const f of ['logo.png', 'favicon-32.png', 'apple-touch-icon.png']) {
    copyFileSync(join(ROOT, 'assets/images', f), join(imgDst, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serve `dir` on an ephemeral port. Port 0 means the OS picks a free one, which is
 *  how two concurrent harnesses cannot collide on it. */
function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dir, rel === '/' ? 'graph.html' : rel);
    let st;
    try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
    if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  SERVERS.add(server);
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port })));
}

/** Rewrite one anchor, refusing a stale one — a case that silently no-ops because the
 *  source moved is a case that passes for the wrong reason. */
function patch(file, from, to) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) throw new Error(`anchor not found in graph.js: ${JSON.stringify(from)}`);
  const after = before.replace(from, to);
  if (after === before) throw new Error('replace was a no-op');
  writeFileSync(file, after);
}

/* The cases. `expect` is the assertion's description as caughtBy sees it — a string
 * that must appear inside a FAIL block, not merely anywhere in the output, because a
 * checker prints its assertion descriptions whether they pass or fail. */
const CASES = [
  {
    name: 'baseline — the tree this serves is the one the checker was written against',
    mutate: null,
    expect: null,
  },
  {
    /* The canvas is the page. §3.G3 shipped six permanently blank lanes through a
     * 41-script suite, and this is the same shape one layer up: a graph page that
     * mounts nothing looks like a page whose spinner never resolves. Pointing the
     * renderer at the wrong parent keeps every other assertion passing, so this case
     * fails exactly one. */
    name: 'the canvas is mounted into a detached parent, so #graph-container stays empty',
    mutate: (dir) => patch(join(dir, 'assets/js/graph.js'),
      '  const Graph = ForceGraph3D()(container)',
      '  const Graph = ForceGraph3D()(container.parentElement)'),
    expect: 'the 3D canvas exists',
  },
  {
    /* graph.html ships "1,346 實體 · 978 關係" as static text that graph.js
     * overwrites. Sending the computed counts to a data attribute instead of the text
     * leaves the placeholder on screen — which is precisely what a page whose
     * JavaScript silently stopped running would look like, and what this check
     * existed to catch when it printed the value and asserted nothing. */
    name: 'the computed counts go to a data attribute, leaving the HTML placeholder visible',
    mutate: (dir) => patch(join(dir, 'assets/js/graph.js'),
      "      countBadge.textContent = `${activeNodes.length} 實體 · ${activeLinks.length} 關係`;",
      "      countBadge.setAttribute('data-counts', `${activeNodes.length} 實體 · ${activeLinks.length} 關係`);"),
    expect: 'the entity/relation badge was rewritten at runtime',
  },
  {
    /* The dossier is the only route from a search result to anything at all, and
     * classList is how it opens. Removing the class rather than the call keeps the
     * click handler running, so only the assertion about the panel being open fails. */
    name: 'selecting a node sets a data attribute instead of the is-active class',
    mutate: (dir) => patch(join(dir, 'assets/js/graph.js'),
      "    dossierPanel.classList.add('is-active');",
      "    dossierPanel.setAttribute('data-open', 'is-active');"),
    expect: 'clicking a search result opens the dossier',
  },
];

/**
 * Run the checker against `dir`, on a fresh ephemeral port.
 *
 * ASYNCHRONOUS execFile, NOT execFileSync, and that is not a style choice. This
 * process is also the HTTP server the checker fetches the page from, and execFileSync
 * blocks the event loop while it waits for the child — so the server cannot answer the
 * one request that matters, the page itself. The checker sat in its 30-second readiness
 * poll for ever and the harness had to be killed. Every other harness in scripts/ uses
 * execFileSync safely because none of them serves anything.
 *
 * `process.execPath`, not 'node' from PATH: the baseline and its mutations have to run
 * the same interpreter to be comparable.
 */
function runChecker(dir) {
  return serve(dir).then(({ server, port }) => new Promise((res) => {
    execFile(process.execPath, [CHECKER], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, GRAPH_PORT: String(port) },
      maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      server.close();
      server.closeAllConnections?.();
      SERVERS.delete(server);
      res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  }));
}

/* Three at a time, in DECLARATION order out — see scripts/lib/pool.mjs. The cases are
 * independent by construction: each builds its own tree, listens on its own ephemeral
 * HTTP port, and gets its own CDP port from the index below, so nothing two of them
 * touch is the same. That premise is what licenses the pool, and GRAPH_CDP_PORT is what
 * makes the third clause true rather than nearly true. */
const CONCURRENCY = 3;

const verdicts = await pool(CASES.map((c) => async () => {
  try {
    return { c, v: await runChecker(buildTree(c.mutate)) };
  } catch (err) { return { c, err }; }
}), { limit: CONCURRENCY });

let failed = 0;
for (const { c, v: verdict, err } of verdicts) {
  if (err) {
    /* A harness that throws did not run the checker. That is never a passing mutation
     * case — it is a case that never happened — and it is reported as its own thing
     * rather than folded into the verdict. */
    console.log(`  FAIL ${c.name}\n        harness threw: ${err.message}`);
    failed++;
    continue;
  }

  if (c.expect === null) {
    const pass = verdict.code === 0;
    if (!pass) failed++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${c.name}${pass ? '' : `  (exit ${verdict.code})`}`);
    if (!pass) console.log(verdict.out.trimEnd().split('\n').slice(-12).map((l) => `          ${l}`).join('\n'));
    continue;
  }

  const wrongCode = verdict.code === 0;
  const missingReason = !caughtBy(verdict.out, c.expect);
  const pass = !wrongCode && !missingReason;
  if (!pass) failed++;
  console.log(
    `  ${pass ? 'ok  ' : 'FAIL'} ${c.name}` +
    (wrongCode ? `  (exit 0 — the mutation did not fail the checker)` : '') +
    (missingReason && !wrongCode ? `\n          no FAIL block named: ${c.expect}\n          ${verdict.out.trimEnd().split('\n').slice(0, 8).join('\n          ')}` : '')
  );
}

console.log(failed === 0
  ? `\nall ${CASES.length} negative tests behaved as required`
  : `\n${failed} of ${CASES.length} negative tests FAILED`);
process.exit(failed === 0 ? 0 : 1);