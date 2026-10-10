import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, cdpPort, assertPortFree } from './lib/cdp-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 5500;
const PORT_CDP = cdpPort('graph');
await assertPortFree('test_graph_browser.mjs', PORT_CDP);

const profile = mkdtempSync(join(tmpdir(), 'graph-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--use-gl=angle',
  '--use-angle=metal',
  `--remote-debugging-port=${PORT_CDP}`,
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

  console.log('Navigating to http://localhost:5500/graph.html...');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://localhost:${PORT}/graph.html` });

  // Wait for 3D engine, data loading and graph initialization
  await new Promise(r => setTimeout(r, 4000));

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  const title = await ev('document.title');
  console.log('Page Title:', title);

  const badgeText = await ev('document.getElementById("graph-count-badge")?.textContent');
  console.log('Badge Text:', badgeText);

  const hasCanvas = await ev('document.querySelector("#graph-container canvas") !== null');
  console.log('Has 3D WebGL Canvas:', hasCanvas);

  // Test Search
  await ev(`
    const input = document.getElementById("hud-search");
    input.value = "皮卡丘";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  `);

  await new Promise(r => setTimeout(r, 800));

  const searchResultsCount = await ev('document.querySelectorAll(".search-item").length');
  console.log('Search Results for "皮卡丘":', searchResultsCount);

  // Click search result
  await ev(`
    const firstItem = document.querySelector(".search-item");
    if (firstItem) firstItem.click();
  `);

  await new Promise(r => setTimeout(r, 1200));

  const dossierName = await ev('document.getElementById("dossier-name-zh")?.textContent');
  const dossierActive = await ev('document.getElementById("graph-dossier")?.classList.contains("is-active")');
  console.log('Dossier Active:', dossierActive, 'Name:', dossierName);

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
  console.log('Test completed successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  cleanup();
  process.exit(1);
});
