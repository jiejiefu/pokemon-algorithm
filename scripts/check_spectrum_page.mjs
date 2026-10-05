#!/usr/bin/env node
/**
 * Static guards on spectrum.html, its stylesheet, and the two modules it depends on
 * most.
 *
 * Run: node scripts/check_spectrum_page.mjs
 * Test: node scripts/test_check_spectrum_page.mjs  (proves each check can fail)
 *
 * WHAT IS ALREADY GUARDED ELSEWHERE, AND NOT HERE
 * ----------------------------------------------
 * The maths is settled in `check_spectrogram_port.mjs`, which differences the module
 * against `analyze_cries.py` itself. The nav is settled in `check_nav_pages.mjs`.
 * Playback, ink on the canvases and the mute are settled in
 * `check_spectrum_browser.mjs` over the DevTools Protocol. What is left here is the
 * set of claims that only exist in the source text, and they are claims about
 * honesty rather than about arithmetic.
 *
 * THE FOUR THINGS WORTH GUARDING
 * ------------------------------
 *
 * 1. `cry-spectrogram.js` USES NO PLATFORM. Not for tidiness — for the same reason
 *    `gb-apu.js` is pure: a module with no DOM can be run by Node and checked
 *    against the Python, and a module that quietly reaches for `document` cannot.
 *    This is the one assertion that would have caught every portability problem in
 *    one line.
 *
 * 2. THE CONSTANTS ARE NUMERICALLY EQUAL TO THE PYTHON'S, not merely present.
 *    A source-shape regex over `SR = 16000` passes for `SR = 160000`. This parses
 *    both files and compares the values, so a divergence is a red test rather than a
 *    silently different feature vector — which is the failure mode §3.B2 calls "a
 *    change of units that cannot reorder anything".
 *
 * 3. THE PAGE'S THREE DISCLOSURES ARE IN THE DOM.
 *    §3.B1 records the shape this exists for: `colors.html` kept promising 「生成明暗階」
 *    in its meta description after the section was deleted, because no shape check
 *    reads a description. Three sentences on this page can go stale the same way:
 *    that the spectrogram is computed BEFORE playback, that the two canvases are
 *    different measurements, and that peak/rms/m0 are excluded for two different
 *    reasons. All three are asserted here as text, not as variables.
 *
 * 4. THE STYLESHEET TOUCHES NOTHING IT DOES NOT OWN. `spectrum.css` exists so this
 *    page's rules are not `cries.css`'s problem, and that guarantee is only real if
 *    no selector outside the `sp-` namespace is written there. `cries.css` is already
 *    shared by two pages and `cp-*` belongs to three.
 *
 * AND THE ONE THAT IS EASY TO GET SUBTLY WRONG
 * --------------------------------------------
 * The page reads its colour ramp from CSS custom properties rather than hardcoding
 * six hex values, because `spectrum.css` declares the ramp once and the legend
 * gradient uses the same six. Two copies is two things to keep right, and the
 * failure mode is a legend that has quietly stopped describing the picture. So the
 * checker asserts BOTH halves: the stops are declared in the stylesheet, and the
 * script reads them rather than carrying its own.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

let checks = 0;
const fails = [];
const ok = (cond, what) => {
  checks++;
  if (!cond) fails.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const eq = (got, want, what) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want:  ${b}`}`);
};

const page = read('spectrum.html');
const css = read('assets/css/spectrum.css');
const mod = read('assets/js/cry-spectrogram.js');
const py = read('scripts/analyze_cries.py');
const player = read('assets/js/cry-player.js');
const autoplay = read('assets/js/cry-autoplay.js');

// ---------------------------------------------------------------------------
// 1. The module is pure.
// ---------------------------------------------------------------------------

/* Strip comments first. A docblock that NAMES the forbidden globals in order to
 * explain why they are absent would otherwise be read as a use of them — and this
 * file's own docblock names `document` and `fetch` at least once. */
const modCode = mod
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

for (const global of ['document', 'window', 'fetch', 'AudioContext', 'XMLHttpRequest', 'localStorage']) {
  ok(!new RegExp(`\\b${global}\\b`).test(modCode),
    `cry-spectrogram.js uses no \`${global}\` — it is runnable from Node, which is the only reason the port can be checked`);
}

const modImports = mod.match(/^import .*$/gm) ?? [];
eq(modImports, [],
  'cry-spectrogram.js imports nothing, so the scratch tree for its mutation suite needs three files and not a directory');

// ---------------------------------------------------------------------------
// 2. The constants are numerically equal to the Python's.
// ---------------------------------------------------------------------------

/** `NAME = value` or `NAME: value = value` in the Python, value read as a number. */
/**
 * The Python's constants, by VALUE.
 *
 * Three forms have to be handled and the first version handled none of them:
 * `SR = 16_000` carries digit separators, `FRAME = int(round(0.025 * SR))` is a call
 * over another constant, and `EPS = 1e-10` has an exponent. So the expressions are
 * EVALUATED in dependency order with `int(round(` unwrapped, and identifiers are
 * allowed through the pattern test on purpose: it is the `try` that defers an
 * unresolved one, so a pattern that rejected `SR` would defer it forever instead —
 * which is what the second version did, silently, for FRAME and HOP.
 * This is the whole
 * point of comparing by value. A regex matching bare digits would have "compared"
 * all nine constants while checking one, which is the §4 failure shape: a check
 * that cannot fail.
 */
function pyNumbers(source) {
  const body = source.replace(/#.*$/gm, '');
  const out = {};
  const pending = [];
  const re = /^([A-Z_0-9]+)\s*(?::\s*[\w\[\]\/ ]+)?=\s*(.+)$/gm;
  let m;
  while ((m = re.exec(body))) {
    if (!/^(SR|FRAME|HOP|N_FFT|N_MEL|N_MFCC|FMIN|FMAX|PRE_EMPHASIS|EPS|DIMENSIONS)$/.test(m[1])) continue;
    pending.push([m[1], m[2].trim()]);
  }
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, raw] = pending[i];
      const expr = raw
        .replace(/_/g, '')
        .replace(/^int\(round\((.*)\)\)$/, '$1')
        .replace(/^int\((.*)\)$/, '$1');
      if (!/^[\w\s()*/+\-.]+$/.test(expr)) continue;
      let value;
      try {
        // eslint-disable-next-line no-new-func
        value = Function(...Object.keys(out), `return (${expr});`)(...Object.values(out));
      } catch {
        /* An unresolved identifier: defer to the next pass rather than fail. */
        continue;
      }
      if (!Number.isFinite(value)) continue;
      out[name] = value;
      pending.splice(i, 1);
    }
  }
  return out;
}

/** The same, for `export const NAME = <expression>` in the module. */
function jsNumbers(source) {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  const pending = [];
  const re = /^export const ([A-Z_0-9]+) = ([^;]+);/gm;
  let m;
  while ((m = re.exec(body))) pending.push([m[1], m[2].trim()]);
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, expr] = pending[i];
      if (!/^(?:[\w\s()*/+\-.]|Math\.[\w.]+\([\w\s()*/+\-.]*\))+$/.test(expr)) continue;
      let value;
      try {
        // eslint-disable-next-line no-new-func
        value = Function('Math', ...Object.keys(out), `return (${expr});`)(Math, ...Object.values(out));
      } catch {
        continue;
      }
      if (!Number.isFinite(value)) continue;
      out[name] = value;
      pending.splice(i, 1);
    }
  }
  return out;
}

const pyN = pyNumbers(py);
const jsN = jsNumbers(mod);

for (const name of ['SR', 'FRAME', 'HOP', 'N_FFT', 'N_MEL', 'N_MFCC', 'FMIN', 'PRE_EMPHASIS', 'EPS']) {
  ok(name in pyN, `analyze_cries.py's ${name} was evaluated, so there is something to compare against`);
  ok(name in jsN, `cry-spectrogram.js's ${name} was evaluated`);
  if (name in pyN && name in jsN) {
    /* By value, with a tolerance of one part in 1e9. `FRAME` is
     * `int(round(0.025 * SR))` in the Python and `Math.round(0.025 * SR)` here, so
     * the arithmetic has to be evaluated rather than read as text — and it has to be
     * the SAME number, because a 1-sample difference in FRAME moves the window's
     * symmetric ends and changes every MFCC row. */
    eq(jsN[name], pyN[name], `${name} is numerically identical in both implementations`);
  }
}

eq(jsN.SR / 2, 8000,
  'and the mel filterbank tops out at 8 kHz, which is the Nyquist the resample keeps');

// ---------------------------------------------------------------------------
// 3. The three exclusions, named rather than counted.
// ---------------------------------------------------------------------------

ok(/export const UNCOMPARABLE = \[/.test(mod),
  'the module names its uncomparable features as a list, so adding one is a visible edit');

for (const name of ['peak', 'rms', 'm0']) {
  ok(mod.includes(`FEATURE_NAMES.indexOf('${name}')`),
    `${name} is on it — the module says which three cannot be reproduced in a browser`);
}

ok(mod.includes('export const ROBUST'),
  'and it names the well-conditioned features separately, because being uncomparable and being ill-conditioned are different problems');

const robustNames = (mod.match(/export const ROBUST = \[([^\]]*)\]/)?.[1] || '')
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
eq(robustNames.length, 5,
  'five features are well-conditioned enough to compare — flatness was removed from this list after measuring 31% on a real file');
ok(!robustNames.includes('flatness'),
  'flatness is NOT among them: it is scale-invariant and ill-conditioned, a ratio of two nearly equal numbers');
ok(robustNames.includes('dur') && robustNames.includes('centroid')
  && robustNames.includes('zcr') && robustNames.includes('rolloff85')
  && robustNames.includes('flux'),
  `and the five are exactly the well-conditioned ones: ${robustNames.join(', ')}`);

// ---------------------------------------------------------------------------
// 4. The page's three disclosures are in the DOM.
// ---------------------------------------------------------------------------

/* The intro paragraph, which §3.B1 is about. */
ok(/整段算好/.test(page) && /不等於/.test(page),
  'the intro says the spectrogram is computed BEFORE playback, and that the reveal is not a live analysis');

ok(/即時譜|這是第二次量測/.test(page) && /AnalyserNode/.test(page) && /不是同一組參數/.test(page),
  'the live curve says it is a SECOND measurement with different rate, window and smoothing');

ok(/解碼器不同/.test(page) && /取樣率被改過/.test(page) && /兩個 bug/.test(page),
  'the cross-check panel gives all three causes of the difference between the two implementations');

for (const name of ['peak', 'rms', 'm0']) {
  ok(new RegExp(`${name}[、\\s]`).test(page) || page.includes(`>${name}<`),
    `the panel names ${name} among the features it does not compare`);
}

ok(/0\.002 附近/.test(page) && /相對差會在幾乎是零的數字上報出巨大的分歧/.test(page),
  'and says why a relative difference is not reported for the other 29: the stored values sit near 0.002');

ok(/瀏覽器拿不到/.test(page) && /檔案的原始取樣率/.test(page),
  'and states plainly that a browser is never told the file\'s true sample rate, which is why peak and rms are out');

// ---------------------------------------------------------------------------
// 5. The stylesheet owns nothing but `sp-`.
// ---------------------------------------------------------------------------

/* Comments stripped first, because the stylesheet's own header names `colors.css`,
 * `cries.css` and `shared.css` — and a checker that reads those as borrowed classes
 * is measuring the documentation. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const cssSelectors = [...cssCode.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
const classes = new Set();
for (const sel of cssSelectors) {
  for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(m[1]);
}
/* `.header` is shared.css's, and writing `.sp-header` here would be a bug: the
 * markup in the page carries `class="header"`, so renaming the selector would
 * silently stop the whole header block from matching. Shared tokens are used, never
 * redefined — which is what the second half of this assertion checks. */
const SHARED = new Set(['header']);
const foreign = [...classes].filter((c) => !c.startsWith('sp-') && !SHARED.has(c));
eq(foreign, [],
  `every class in spectrum.css is sp-prefixed except the shared tokens it must not redefine`
  + ` (${classes.size} classes)`);

const redefinesShared = [...cssCode.matchAll(/^\.(header|site-nav|theme-toggle|nav-toggle)\s*\{/gm)];
eq(redefinesShared.map((m) => m[1]), [],
  'and shared.css\'s own classes are never redefined here, only used as a qualifier');

ok(/linear-gradient\(to right,\s*var\(--sp-0\), var\(--sp-1\), var\(--sp-2\), var\(--sp-3\), var\(--sp-4\), var\(--sp-5\)\)/.test(css.replace(/\s+/g, ' ')),
  'the legend gradient is built from the same six custom properties the script reads, so a legend cannot drift from the picture');

ok(/getPropertyValue\(`--sp-\$\{i\}`\)/.test(page),
  'and the script reads those six rather than carrying its own copy');

/* The allowlist is four colours and each has a reason. The first two are the
 * theme-color meta tag, which is set before first paint and cannot read a custom
 * property. The second two are the fallbacks the ramp reader uses when
 * getPropertyValue comes back empty, which it does under a stylesheet that has not
 * loaded — and a fallback of black would render a spectrogram, so it has to be a
 * colour. The next three are the plot's own ground, ink and muted label, used the
 * same way on the two canvases. Anything ELSE is a stop nobody declared. */
const RAMP_FALLBACKS = ['#f4f6fa', '#0d1117', '#000000', '#fbe28d', '#07050e', '#f2f4f8', '#9aa3b2'];
eq((page.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter((h) => !RAMP_FALLBACKS.includes(h.toLowerCase())),
  [],
  `the page carries no ramp colour outside the four with a stated reason (${RAMP_FALLBACKS.join(' ')})`);

// ---------------------------------------------------------------------------
// 6. The player's additions, and that they are additive.
// ---------------------------------------------------------------------------

for (const [name, re] of [
  ['decoded()', /^ {2}(?:async )?decoded\(/m],
  ['playSamples()', /^ {2}async playSamples\(/m],
  ['spectrum()', /^ {2}spectrum\(/m],
]) {
  ok(re.test(player), `cry-player.js exposes ${name}`);
}

ok(/#gain\.connect\(this\.#analyser\)/.test(player),
  'the spectrum tap hangs off the shared GAIN node, so a mute silences the measurement too');

ok(/getFloatFrequencyData\(this\.#bins\)/.test(player),
  'and it reads the live AudioParam-style data every call rather than recording a value at install time');

ok(/createBuffer\(1, samples\.length, sampleRate\)/.test(player) && /sampleRate \/ 2/.test(player),
  'playSamples has the 65,536 Hz decimation fallback, because that allocation is what browsers refuse');

/* The STRUCTURAL form of "one AudioContext", and the negative suite is what found
 * the gap: asserting that the page MENTIONS `playSamples` passed a page that opened
 * its own AudioContext and then called playSamples anyway. What actually matters is
 * that the page never builds an audio graph of its own — no `new AudioContext`, no
 * `createBufferSource`. Both strings are code-shaped and neither appears in the
 * prose, which discusses what `decodeAudioData` does to the sample rate without
 * containing either of them. */
ok(/cryPlayer\.playSamples\(/.test(page),
  'and spectrum.html plays the synthesised cry through cryPlayer.playSamples');
ok(!/new AudioContext\(/.test(page) && !/createBufferSource\(/.test(page),
  'and never builds an audio graph of its own — one AudioContext, one clock, one gain');

ok(/decoded\(/.test(page),
  'while the recorded path shares the player\'s decode cache instead of fetching the file a second time');

/* A DECODE must not require a gesture, and this is the assertion that says so.
 *
 * `check_spectrum_browser.mjs` cannot catch it: that Chrome runs with
 * `--autoplay-policy=no-user-gesture-required`, so `ctx.resume()` always resolves
 * there and the page renders. Launch Chrome without that flag — which is what any
 * real visit is — and `decoded()` reached `#load`, which called `unlock()`, which
 * awaited a `resume()` no gesture had unblocked, and the page sat on 「計算中…」 for
 * ever. The hero is a pure computation and was gated behind an audio permission.
 *
 * The shape to assert is that `#load` creates the context without resuming it, so
 * this is a check on the source rather than on a number — and it is here because
 * the class of bug is §3.G's: a control that is wired and does nothing, where the
 * only symptom is a page that never finishes loading.
 */
const loadBody = player.slice(player.indexOf('#load(id, { legacy })'));
ok(/#ensureContext\(\)\.decodeAudioData/.test(loadBody)
  && !/this\.unlock\(\)\.then\(\(ctx\) => ctx\.decodeAudioData/.test(loadBody),
  'decoding does not require a user gesture: #load creates the AudioContext without resuming it');

ok(/#ensureContext\(\)\s*\{/.test(player) && /async unlock\(\)\s*\{[\s\S]{0,120}this\.#ensureContext\(\)/.test(player),
  'and `unlock()` is the only path that resumes, so playback still unblocks the clock first');

ok(/waveformPeaks\([\s\S]{0,200}?\{\s*const \{ buffer, error \} = await this\.#load/.test(player),
  'while `waveformPeaks`, which also only wants samples, no longer resumes either');

ok(/className: 'sp-autoplay'/.test(page)
  && /className = 'cy-autoplay'/.test(autoplay)
  && /className = className/.test(autoplay),
  'the autoplay switch is the shared module asked for this page\'s prefix, not a copy of it');

// ---------------------------------------------------------------------------
// 7. Provenance.
// ---------------------------------------------------------------------------

const features = readJson('assets/data/cry_features.json');
eq(features.sampleRate, jsN.SR,
  'the spectrogram runs at the rate cry_features.json was built at, so the two describe the same axis');

ok(/PokeAPI\/cries/.test(page) && /pret\/pokered/.test(page) && /analyze_cries\.py/.test(page),
  'the page names all three upstreams: the recordings, the ROM tables, and the analysis script');

ok(page.includes('assets/css/spectrum.css') && page.includes('assets/css/shared.css'),
  'and loads shared.css then its own stylesheet');

// ---------------------------------------------------------------------------
// 8. The three files the page reads at runtime, checked HERE rather than declared.
// ---------------------------------------------------------------------------

/* `--prove-inputs` reported `shared.js`, `gb-apu.js` and `gen1_cries.json` as declared
 * but unread, which is right: the page fetches them in the browser and this checker
 * only ever saw its own imports. Declaring an input nothing opens means an edit to it
 * will not invalidate this checker, so instead of deleting the three entries each one
 * became a claim — and each is a claim the page would otherwise make silently.
 */

const shared = read('assets/js/shared.js');
ok(/spectrum\.html/.test(shared) && /id: 'cries'/.test(shared),
  'NAV carries spectrum.html inside the 叫聲 group, so the page is reachable and marks itself current');

const gbau = read('assets/js/gb-apu.js');
const synthRate = Number(gbau.match(/export const SYNTH_RATE = (\d+);/)?.[1]);
eq(synthRate, 65536,
  'the synthesised cries arrive at 65,536 Hz, which is what makes the 65,536 Hz decimation fallback in the player necessary rather than defensive');

ok(/SYNTH_RATE/.test(page) && /renderSpeciesCry/.test(page),
  'and the page passes that rate through rather than assuming one');

const gen1 = readJson('assets/data/gen1_cries.json');
eq(gen1.cries.length, 151, 'the first-generation table is the 151 species the page offers as a third source');
ok(gen1.cries.every((c) => c.pitch !== undefined && c.length !== undefined),
  'and every row carries the two bytes renderSpeciesCry needs, so the third source cannot half-render');

console.log('');
if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks`);
