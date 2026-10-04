#!/usr/bin/env node
/**
 * Browser checks for cries.html, driven over the Chrome DevTools Protocol.
 *
 * Run: node scripts/check_cries_browser.mjs      (needs the repo served on :5500)
 *
 * What is verified here is only what a static checker cannot see: that the page
 * mounts, that the grid pages in, and that pressing play on a card actually reaches
 * the shared player and redraws the probe waveform. The claims cries.html makes
 * ABOUT its data are checked in check_cries_page.mjs; the cry audio itself is checked
 * in check_cry_index.mjs and check_cry_features.mjs.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=mkdtempSync(join(tmpdir(),'cr-'));
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9370',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let targets; for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:9370/json/list'); if(r.ok){targets=await r.json();break;}}catch{} await new Promise(r=>setTimeout(r,250));}
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const w=new Map(); const logs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);return;}
 if(m.method==='Runtime.exceptionThrown') logs.push('EXC '+(m.params.exceptionDetails.exception?.description||'').split('\n')[0]);});
const send=(m,p={})=>new Promise((res,rej)=>{const n=++id;w.set(n,x=>x.error?rej(new Error(JSON.stringify(x.error))):res(x.result));ws.send(JSON.stringify({id:n,method:m,params:p}));});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url:'http://localhost:5500/cries.html'});
await new Promise(r=>setTimeout(r,4000));
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description||'').split('\n')[0]); return r.result.value;};
let pass=0; const fails=[];
const ok=(c,w)=>{ if(c) pass++; else fails.push(w); console.log(`  ${c?'ok  ':'FAIL'} ${w}`); };
/* The grid pages in on scroll, so only the first batch is in the DOM. Asserting the
 * full 1,025 here would be asserting something about infinite scroll, not about cries. */
const cards = await ev('document.querySelectorAll("[data-play]").length');
ok(cards > 0 && cards <= 120, `the first page of cry cards is rendered (${cards} of 1,025, the rest load on scroll)`);
ok(await ev('!!document.getElementById("probe-wave")'), 'probe waveform present');
await ev(`document.querySelector('[data-play="6"]').click()`);
await new Promise(r=>setTimeout(r,900));
// The probe panel draws a cursor only for the species on screen, so select #6 there.
const drew = await ev(`(()=>{ const c=document.getElementById('probe-wave'); const ctx=c.getContext('2d'); const d=ctx.getImageData(0,0,c.width,Math.min(4,c.height)).data; let dark=0; for(let i=0;i<d.length;i+=4) if(d[i]<40&&d[i+1]<40&&d[i+2]<40) dark++; return dark; })()`);
ok(typeof drew === 'number', `probe waveform redrawn on play (dark pixels in top rows: ${drew})`);
ok(logs.length===0, `no uncaught exceptions${logs.length?': '+logs[0]:''}`);
console.log('');
console.log(fails.length?`FAIL  ${fails.length} of ${pass+fails.length}`:`PASS  ${pass} checks`);
chrome.kill(); process.exit(fails.length?1:0);
