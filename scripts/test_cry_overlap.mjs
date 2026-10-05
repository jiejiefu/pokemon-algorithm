/**
 * Proves the `overlap: true` path in cry-player.js, in bare Node, with a stub
 * AudioContext. The browser is not involved because a stub makes this
 * deterministic: Live Server reloads the page whenever the concurrent session
 * writes a file, and a test whose subject is "does this promise resolve" should
 * not depend on whether anybody is editing.
 *
 *   node scripts/test_cry_overlap.mjs
 *
 * WHAT IT CLAIMS, and why a claim about a promise is worth this much: the bug
 * this guards was `this.#overlapping.add(cur)` in `play()`, where `cur` is a
 * name that exists only in `stop()`. Every `overlap: true` call therefore threw
 * a ReferenceError — and sorting.html ends that call in `.catch(() => {})`, so
 * nothing was logged, the cry still played, and the page looked fine. The
 * consequences were real and silent: the returned promise REJECTED instead of
 * resolving on `ended`, `onStart` never ran, and `#overlapping` stayed empty so
 * `stop()` could not silence the voices it had layered.
 *
 * So the assertion is on the promise's SETTLEMENT, which is the one thing the
 * swallowed rejection could not hide.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/js/cry-player.js');

/* ------------------------------------------------------------------ stub --
 * Enough of Web Audio for `play()`: a context whose clock advances, a source
 * that fires `ended` on a timer, and a gain node with the AudioParam methods
 * play()/stop() actually call. Every AudioNode the player creates is recorded,
 * so a test can ask how many were still running rather than inferring it. */
const started = [];
const live = new Set();

class FakeParam {
  constructor() { this.value = 0; }
  cancelScheduledValues() {}
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
}

class FakeNode {
  constructor(kind) { this.kind = kind; this.gain = new FakeParam(); }
  connect(n) { this.destination = n; return n; }
}


class FakeSource {
  constructor(ctx, buffer) {
    this.ctx = ctx; this.buffer = buffer;
    this.playbackRate = new FakeParam();
    this.onended = null; this.onerror = null;
    this._listeners = new Map();
    this.stopped = false;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  _fire(type) {
    const direct = this[`on${type}`];
    if (typeof direct === 'function') direct();
    for (const fn of this._listeners.get(type) ?? []) fn();
  }
  start() {
    started.push(this);
    live.add(this);
    // A cry is ~300ms; end it on the stub's clock rather than a wall timer so the
    // test cannot race it.
    setTimeout(() => { if (!this.stopped) { live.delete(this); this._fire('ended'); } }, 40);
  }
  /* The source is an AudioNode too — `play()` does source.connect(out) — so it
   * needs the same `connect`. Without it every play died on "source.connect is
   * not a function", which is a stub defect reading exactly like a product one. */
  connect(n) { this.destination = n; return n; }
  disconnect() {}
  stop() { this.stopped = true; setTimeout(() => { live.delete(this); this._fire('ended'); }, 1); }
}

class FakeContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new FakeNode('destination'); }
  get state() { return this._state; }
  set state(v) { this._state = v; }
  createGain() { return new FakeNode('gain'); }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, minDecibels: 0, maxDecibels: 0, frequencyBinCount: 1, connect() {} }; }
  createBufferSource() { return new FakeSource(this, { duration: 0.3 }); }
  createBuffer() { return { copyToChannel() {}, duration: 0.3 }; }
  async decodeAudioData() { return { duration: 0.3 }; }
  async resume() { this.state = 'running'; }
  close() {}
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.window = { AudioContext: FakeContext, webkitAudioContext: FakeContext };
/* `fetch` is stubbed rather than shimmed by path: the player asks for
 * `assets/cries/latest/1.ogg`, a RELATIVE url that only a page can resolve. */
globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });

/* `has()` reads the generated roster, which is a module import. Rather than
 * fake the whole data layer, assert on the ids the real roster contains. */
const ID = 1;

const live2 = await import(`file://${SRC}?t=${Date.now()}`);
const player = live2.cryPlayer;

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? pass(m) : fail(m));

console.log('cry-player.js overlap path\n');

await player.unlock();

/* 1. The claim. Three overlapping plays must all RESOLVE. */
const results = await Promise.all([ID, ID, ID].map(() =>
  player.play(ID, { overlap: true, rate: 1 })
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, err: String(e?.message ?? e) }))));
check(results.every(r => r.ok),
  `three overlap: true plays all resolve (${results.filter(r => !r.ok).map(r => r.err).join('; ') || 'no rejections'})`);

/* 2. `#overlapping` must actually be populated. It is private, so the question is
 * asked the only way that means anything: stop() has to silence EVERY layered
 * voice, and it can only do that if the set was filled. */
started.length = 0;
await Promise.all([ID, ID, ID].map(() => player.play(ID, { overlap: true, rate: 1 }).catch(() => {})));
const layered = started.length;
check(layered === 3, `three sources were started (${layered})`);
await player.stop();
await new Promise(r => setTimeout(r, 60));
/* Guarded on `layered`: without that conjunct this reads true whenever NOTHING
 * started, which is the vacuous-pass shape — the previous version of this file
 * reported "0 still running" as a pass while the run above it had started no
 * sources at all. */
check(layered > 1 && live.size === 0,
  `stop() silenced every layered voice, not just the newest (${live.size} of ${layered} still running)`);

/* 3. The DEFAULT must still interrupt. cries.html and detail.html were written
 * against one-at-a-time playback — pressing play while something sounds should
 * switch to it — so a changed default would layer cries there with no way to
 * silence them.
 *
 * The claim is about SEQUENTIAL calls, which is how a reader presses play twice.
 * Asserting it with three CONCURRENT calls instead was the first version here and
 * it was wrong: `play()` awaits `unlock()` before `stop()`, so three overlapping
 * calls interleave and all three sources legitimately start. That is a property
 * of the await, not of the guarantee. */
started.length = 0;
const first = player.play(ID).catch(() => {});
await new Promise(r => setTimeout(r, 10));      // let the first voice start
await player.play(ID).catch(() => {});
await new Promise(r => setTimeout(r, 60));
check(started.length === 2 && started[0].stopped === true && live.size <= 1,
  `without overlap the second play cuts the first off (2 started, first stopped=${started[0]?.stopped}, ${live.size} still sounding)`);
await player.stop();
await new Promise(r => setTimeout(r, 60));

/* 4. onStart must fire on the overlap path. It did not when the ReferenceError
 * was thrown after `source.start()`, which is a second silent symptom of that
 * same bug and the reason a play cursor on this path would have frozen. */
let startedHook = 0;
await player.play(ID, { overlap: true, rate: 1, onStart: () => { startedHook++; } }).catch(() => {});
check(startedHook === 1, `onStart fires on the overlap path (${startedHook})`);
await player.stop();

/* 5. THE MUTATION. Break it exactly the way it was broken and require the
 * assertion above to notice — a guard that cannot fail is worse than no guard,
 * because it is trusted. */
const src = readFileSync(SRC, 'utf8');
/* In a temp directory OUTSIDE the repo, with cry-index.js copied alongside: the
 * mutant's own `import ... from './cry-index.js'` has to resolve, and cry-index.js
 * imports nothing itself, so the two of them travel as a pair. It used to be
 * `.cache/cry-overlap-neg/` inside the repo, on the reasoning that a directory
 * outside the repo could not resolve a relative import — which is true of the
 * mutant alone and false of the mutant plus its one import. Inside the repo the
 * scratch reads were real reads of real paths, so `--prove-inputs` reported them as
 * "read but not declared", and declaring them was not an option either: the same
 * proof then fails the other way, on a glob that matches nothing once the directory
 * has been deleted. The recorder ignores anything outside ROOT
 * (scripts/lib/record-inputs.cjs), so a temp directory is what makes this entry's
 * input list exact rather than hand-maintained. */
const dir = mkdtempSync(join(tmpdir(), 'cry-overlap-neg-'));
copyFileSync(join(ROOT, 'assets/js/cry-index.js'), join(dir, 'cry-index.js'));
const mutantPath = join(dir, 'cry-player-mutant.mjs');
const mutant = src
  .replace('this.#overlapping.add(voice);', 'this.#overlapping.add(cur);')
  .replace('const forget = () => this.#overlapping.delete(voice);', 'const forget = () => this.#overlapping.delete(cur);');
if (mutant === src) {
  fail('the mutation did not change the file — the anchor is stale, so case 1 cannot be trusted');
} else {
  writeFileSync(mutantPath, mutant);
  const m = await import(`file://${mutantPath}`);
  await m.cryPlayer.unlock();
  const r = await m.cryPlayer.play(ID, { overlap: true, rate: 1 })
    .then(() => ({ ok: true }))
    .catch(e => ({ ok: false, err: String(e?.message ?? e) }));
  check(!r.ok && /cur is not defined/.test(r.err),
    `the mutation IS caught: the mutant rejects with "${r.err}"`);
  await m.cryPlayer.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures
  ? `\nFAIL  ${failures} overlap check(s) did not behave`
  : '\nPASS  the overlap path resolves, layers, silences, and can still fail');
process.exit(failures ? 1 : 0);
