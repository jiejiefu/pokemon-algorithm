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

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9333', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/list');
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

await send('Page.navigate', { url: 'http://localhost:5500/cries-gen1.html' });
await new Promise((r) => setTimeout(r, 3500));

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

let pass = 0; const fails = [];
const ok = (c, w) => { if (c) pass++; else fails.push(w); console.log(`  ${c ? 'ok  ' : 'FAIL'} ${w}`); };

const init = await evalJs(`(() => ({ groups: document.querySelectorAll('.cg-group').length, notes: document.querySelectorAll('.cg-note').length, cur: document.getElementById('cur-name')?.textContent, canvasW: document.getElementById('wave')?.width, lanes: document.querySelectorAll('.cg-lane').length, states: [...document.querySelectorAll('.cg-lane-state')].map(e=>e.textContent), track: !!document.getElementById('timeline-track'), head: !!document.querySelector('.cg-playhead'), loopTxt: document.body.textContent.includes('sound_loop') && document.body.textContent.includes('總次數') }))()`);
ok(init.groups === 38, `38 base groups rendered (got ${init.groups})`);
ok(!!init.cur, `current species shown (${init.cur})`);
ok(init.canvasW > 0, `waveform canvas sized (${init.canvasW}px)`);
ok(init.lanes === 3, `3 timeline lanes (got ${init.lanes})`);
ok(init.track && init.head, 'playhead element and its track exist');
ok(init.states.every((t) => t === '啟用' || t === '靜音'), `lane states are 啟用/靜音, never 播放中 (${init.states.join('/')})`);
ok(init.loopTxt, 'the page discloses what sound_loop does');
const bodyHtml = await evalJs('document.body.innerHTML');
ok(!/cmd\.count - 1/.test(bodyHtml), 'and does not claim one extra repetition');

// The selected species' group must be open.
const grp = await evalJs(`(() => { const d=[...document.querySelectorAll('.cg-group')]; const cur=document.getElementById('cur-name').textContent; const zh = cur.split(' · ')[0]; const hit=d.find(g=>g.open && g.textContent.includes(zh)); return { openCount: d.filter(x=>x.open).length, found: !!hit }; })()`);
ok(grp.found, 'the current species\' group is open after load');
ok(grp.openCount >= 1, `at least one group is open (${grp.openCount})`);

// Noise notes must have real length (the zero-length timeline bug).
const noise = await evalJs(`(() => { const t=document.getElementById('timeline'); const lane=[...t.querySelectorAll(".cg-lane")].find(l=>l.textContent.includes("噪音")); const bars=[...(lane?lane.querySelectorAll(".cg-note-bar"):[])]; return { n: bars.length, zero: bars.filter(b=>parseFloat(b.style.width)===0).length }; })()`);
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

// Selecting another species in the SAME group must not collapse that group.
const sel = await evalJs(`(() => {
  const cur = document.getElementById('cur-name').textContent;
  const g = [...document.querySelectorAll('.cg-group')].find(x => x.open && x.textContent.includes(cur.split(' · ')[0]));
  const other = [...g.querySelectorAll('[data-species]')].find(b => !b.classList.contains('is-current'));
  const id = other.dataset.species;
  other.click();
  return { id, name: other.textContent };
})()`);
await new Promise((r) => setTimeout(r, 400));
const after = await evalJs(`(() => {
  const d = document.getElementById('cur-name').textContent;
  const g = [...document.querySelectorAll('.cg-group')].find(x => x.textContent.includes(d.split(' · ')[0]));
  return { cur: d, anyOpen: [...document.querySelectorAll('.cg-group')].some(x => x.open) };
})()`);
ok(after.cur.split(' \u00b7 ')[0] === sel.name, `selecting a species switches to it (${after.cur})`);
ok(after.anyOpen, 'and some group stays open afterwards');

ok(logs.filter((l) => l.startsWith('EXCEPTION')).length === 0,
  `no uncaught exceptions${logs.filter((l) => l.startsWith('EXCEPTION')).length ? ': ' + logs.filter((l) => l.startsWith('EXCEPTION')).join(' | ') : ''}`);

console.log('');
console.log(fails.length ? `FAIL  ${fails.length} case(s) of ${pass + fails.length}` : `PASS  ${pass} checks`);
chrome.kill();
try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(fails.length ? 1 : 0);
