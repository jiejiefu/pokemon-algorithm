#!/usr/bin/env node
/**
 * Prove that check_spectrum_page.mjs can actually fail, one deliberate defect at a
 * time.
 *
 * Run: node scripts/test_check_spectrum_page.mjs
 *
 * THE CASES ARE GROUPED BY WHAT THEY PROVE, AND THE GROUPING IS THE POINT
 * ---------------------------------------------------------------------
 * Four of these mutate things that look like style and are not:
 *
 *   - A hard-coded ramp colour in the page. `spectrum.css` declares the six stops
 *     once and the legend gradient is built from the same six custom properties, so
 *     a seventh hex in the script is a stop nobody declared and a legend that may
 *     no longer describe the picture. §3.B1's rule, applied to colour.
 *   - A borrowed class name in the stylesheet. `cries.css` is already shared by two
 *     pages and `cp-*` belongs to three, so writing `.cy-anything` here would produce
 *     breakage that depends on stylesheet order.
 *   - A redefinition of a shared.css class. `.sp-app > .header` must keep MATCHING
 *     `.header`, because that is the class the markup carries — renaming the
 *     selector would silently stop the whole header block from applying, and nothing
 *     else would notice.
 *   - A constant changed on ONE side only. This is the one that matters most and it
 *     is why the checker compares by VALUE: `SR = 16000` and `SR = 160000` are both
 *     present, both look right, and only the comparison catches it.
 *
 * And two mutate prose, which is what §3.B1 is actually about: `colors.html` kept
 * promising a section it had deleted, because no shape check reads a meta
 * description. Here the intro's claim about the reveal, the live curve's claim about
 * being a separate measurement, and the cross-check panel's three causes are all
 * asserted as TEXT — so deleting one is a red test rather than a page that quietly
 * promises something it does not do.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_spectrum_page.mjs';
const SRC = [
  CHECKER,
  'spectrum.html',
  'assets/css/spectrum.css',
  'assets/js/cry-spectrogram.js',
  'assets/js/cry-player.js',
  'assets/js/cry-autoplay.js',
  'assets/js/shared.js',
  'assets/js/gb-apu.js',
  'scripts/analyze_cries.py',
  /* The checker LIFTS speciesInk out of this file and runs it over all 1,025 records.
     A harness tree without it fails its own BASELINE — the harness telling the truth
     about its inputs rather than a mutation being caught. */
  'assets/js/species-ramp.js',
  'assets/data/cry_features.json',
  'assets/data/gen1_cries.json',
  /* The checker reads this for the 傳說/幻之 facet counts AND, now, to sweep the live
     curve's ink over every record. It was MISSING here while `check_all.mjs` declared
     it, so every one of this harness's cases was reporting FAIL — including the
     baseline — because `read()` throws on a file the tree does not have, before any
     assertion is reached. A harness whose baseline is red measures nothing, and the
     failure mode is loud rather than silent, which is the only reason it was findable:
     `check_all.mjs` declaring a file is not the same as the harness copying it. */
  'assets/data/pokemon_data.json',
];

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const replaceOrThrow = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutation target not found: ${JSON.stringify(from)}`);
  const out = src.replace(from, to);
  if (out === src) throw new Error(`mutation replaced nothing: ${JSON.stringify(from)}`);
  return out;
};

function makeTree(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'spectrum-neg-'));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

function run(dir) {
  try {
    const stdout = execFileSync('node', [join(dir, CHECKER)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: `${stdout}` };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const edit = (dir, file, fn) => {
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error('the mutation changed nothing');
  writeFileSync(p, after);
};

const CASES = [
  {
    /* The harness. Every case below is meaningless without it. */
    name: 'baseline: the unmutated tree passes every check',
    mutate: null,
    expect: null,
    baseline: true,
  },

  {
    // THE constant case. SR on one side only.
    name: 'SR is changed in the module and not in the extractor',
    mutate: (dir) => edit(dir, 'assets/js/cry-spectrogram.js', (s) =>
      replaceOrThrow(s, 'export const SR = 16000;', 'export const SR = 160000;')),
    expect: 'SR is numerically identical in both implementations',
  },

  {
    // FRAME is `int(round(0.025 * SR))` in one and `Math.round(0.025 * SR)` in the
    // other, so a comparison that only read digits would "pass" while comparing
    // nothing. A 1-sample difference moves the window's symmetric ends.
    name: 'FRAME is off by one sample in the module',
    mutate: (dir) => edit(dir, 'assets/js/cry-spectrogram.js', (s) =>
      replaceOrThrow(s, 'export const FRAME = Math.round(0.025 * SR);',
        'export const FRAME = Math.round(0.025 * SR) + 1;')),
    expect: 'FRAME is numerically identical in both implementations',
  },

  {
    name: 'the module reaches for `document`',
    mutate: (dir) => edit(dir, 'assets/js/cry-spectrogram.js', (s) =>
      replaceOrThrow(s, 'export const DIMENSIONS = FEATURE_NAMES.length;',
        'export const DIMENSIONS = FEATURE_NAMES.length;\nconst probe = document.title;')),
    expect: 'cry-spectrogram.js uses no `document`',
  },

  {
    name: 'the module imports shared.js',
    mutate: (dir) => edit(dir, 'assets/js/cry-spectrogram.js', (s) =>
      replaceOrThrow(s, 'export const SR = 16000;',
        "import { ASSETS } from './shared.js';\n\nexport const SR = 16000;")),
    expect: 'cry-spectrogram.js imports nothing',
  },

  {
    name: 'UNCOMPARABLE stops excluding m0',
    mutate: (dir) => edit(dir, 'assets/js/cry-spectrogram.js', (s) =>
      replaceOrThrow(s, "  FEATURE_NAMES.indexOf('rms'),\n  FEATURE_NAMES.indexOf('m0'),",
        "  FEATURE_NAMES.indexOf('rms'),")),
    expect: 'm0 is on it',
  },

  {
    // §3.B1's rule: a well-conditioned-looking feature added to the comparable set
    // on the strength of a property that turns out to be unrelated. flatness IS
    // scale-invariant and it measures 31% different on a real file.
    name: 'flatness is put back among the well-conditioned features',
    mutate: (dir) => edit(dir, 'assets/js/cry-spectrogram.js', (s) =>
      replaceOrThrow(s, "export const ROBUST = ['dur', 'zcr', 'centroid', 'rolloff85', 'flux']",
        "export const ROBUST = ['dur', 'zcr', 'centroid', 'rolloff85', 'flatness', 'flux']")),
    expect: 'flatness is NOT among them',
  },

  {
    /* §3.B1: the page keeps promising a reveal it no longer performs.
     *
     * The name said 「the intro」 and the string now lives in the PLOT'S CAPTION, so both
     * were updated together — a case whose name points at a location the mutation no longer
     * touches is a case that reads as covering something it does not. */
    name: 'the page stops saying the spectrogram is computed before playback',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, '整段算好了', '邊播邊算好了')),
    /* The expect had said 「the intro」 too, and after the sentence moved that was a case
     * naming an assertion which no longer exists: it matched nothing, so the case passed
     * for the wrong reason. §4's rule — a case's expect must name the assertion that
     * actually detects its mutation. */
    expect: 'the page says the spectrogram is computed BEFORE playback',
  },

  {
    name: 'the live curve stops disclosing that it is a different measurement',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, '不是同一組參數', '是同一組參數')),
    expect: 'the live curve says it is a SECOND measurement',
  },

  {
    // Two of the three causes removed. Asserting the COUNT of them would pass a
    // panel that named one cause three times.
    name: 'the cross-check panel drops two of its three causes',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) => replaceOrThrow(s,
      '解碼器不同', '原因').replace('取樣率被改過', '原因')),
    expect: 'the cross-check panel gives all three causes',
  },

  {
    name: 'the panel stops explaining the near-zero denominators',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, '0.002 附近', '不明原因')),
    expect: 'says why a relative difference is not reported',
  },

  {
    name: 'the panel stops saying the browser cannot know the file\'s true rate',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, '瀏覽器拿不到', '瀏覽器知道')),
    expect: 'states plainly that a browser is never told',
  },

  {
    // A borrowed prefix. cries.css is already shared by two pages; this is the
    // breakage that depends on stylesheet order and nothing else.
    name: 'the stylesheet borrows cries.css\'s prefix',
    mutate: (dir) => edit(dir, 'assets/css/spectrum.css', (s) =>
      replaceOrThrow(s, '.sp-plot {', '.cy-plot {')),
    expect: 'every class in spectrum.css is sp-prefixed',
  },

  {
    // The subtler one: `.sp-app > .header` must keep MATCHING shared.css's class,
    // because that is the class the markup carries.
    name: 'the stylesheet redefines shared.css\'s .header',
    mutate: (dir) => edit(dir, 'assets/css/spectrum.css', (s) =>
      replaceOrThrow(s, '.sp-app > .header {', '.header {')),
    expect: 'shared.css\'s own classes are never redefined here',
  },

  {
    name: 'the page hard-codes a seventh ramp colour',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, "stops.push(cs.getPropertyValue(`--sp-${i}`).trim() || '#000000');",
        "stops.push(cs.getPropertyValue(`--sp-${i}`).trim() || '#00ff88');")),
    expect: 'the page carries no ramp colour outside the four',
  },

  {
    name: 'the script stops reading the ramp from CSS',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, 'getPropertyValue(`--sp-${i}`)', "'#fbe28d'")),
    expect: 'the script reads those six rather than carrying its own copy',
  },

  {
    // The tap moved in front of the gain. A muted curve would then keep moving, and
    // the one thing §3.G's mute assertion is there to catch is that muting is real.
    name: 'the spectrum tap is moved off the shared gain node',
    mutate: (dir) => edit(dir, 'assets/js/cry-player.js', (s) =>
      replaceOrThrow(s, 'this.#gain.connect(this.#analyser);',
        'this.#ctx.destination.connect(this.#analyser);')),
    expect: 'the spectrum tap hangs off the shared GAIN node',
  },

  {
    // The decimation fallback is what stops the page from throwing on a browser
    // that refuses a 65,536 Hz buffer, and it is three lines nobody would notice
    // missing until a reader hits one.
    name: "playSamples loses the 65,536 Hz decimation fallback",
    mutate: (dir) => edit(dir, 'assets/js/cry-player.js', (s) =>
      replaceOrThrow(s, '      decimated = true;\n      buffer = ctx.createBuffer(1, samples.length >> 1, sampleRate / 2);',
        '      decimated = true;\n      buffer = ctx.createBuffer(1, samples.length, sampleRate);')),
    expect: 'playSamples has the 65,536 Hz decimation fallback',
  },

  {
    /* The version of this case that ran first asserted only that the page MENTIONS
     * `playSamples`, and it passed a page that opened its own AudioContext and then
     * called playSamples anyway — which is the whole failure, since the second
     * context is a second clock for a playback cursor to be driven from and a second
     * gain for a mute to reach. The assertion now reads the structure. */
    name: 'the page opens its own AudioContext alongside the shared one',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, 'await cryPlayer.playSamples(r.samples, {',
        'await new AudioContext().resume(), cryPlayer.playSamples(r.samples, {')),
    expect: 'never builds an audio graph of its own',
  },

  {
    /* The gesture bug, as it existed. Invisible to the CDP checker, which runs with
     * --autoplay-policy=no-user-gesture-required so resume() always resolves there —
     * and to every screenshot taken the same way. Found by launching Chrome the way a
     * visitor's browser launches, and the symptom was a page that never finished
     * loading rather than an error anywhere. */
    name: 'decoding goes back through unlock(), which needs a gesture',
    mutate: (dir) => edit(dir, 'assets/js/cry-player.js', (s) =>
      replaceOrThrow(s, '.then((bytes) => this.#ensureContext().decodeAudioData(bytes))',
        '.then((bytes) => this.unlock().then((ctx) => ctx.decodeAudioData(bytes))')),
    expect: 'decoding does not require a user gesture',
  },

  {
    name: 'the autoplay switch is copied instead of shared',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, "className: 'sp-autoplay',", "className: 'cy-autoplay',")),
    expect: 'the autoplay switch is the shared module asked for this page\'s prefix',
  },

  /* ---- the live curve's ink ------------------------------------------------
   *
   * Four cases, and each one names the assertion that detects IT rather than the one
   * that happens to go red. The first version of the visibility case asserted 「all
   * 1,025 clear the floor」 and that assertion was satisfied by a function that lifts
   * every colour all the way to white — 1,025 colours clearing 3:1 is not the claim,
   * it is the claim's absence wearing its shape. The pair below is the one that
   * separates them: a floor, and a ceiling on what the floor costs. */

  {
    // The whole feature, gone, with the function left in place so the "does it exist"
    // assertions stay green and only the MEASURED one can catch this.
    name: 'the visibility floor is removed and the raw colour is drawn',
    mutate: (dir) => edit(dir, 'assets/js/species-ramp.js', (s) =>
      replaceOrThrow(s, 'if (contrast(src, ground) >= min) return src.slice();',
        'if (contrast(src, ground) >= min) return src.slice();\n  return src.slice();')),
    expect: 'every one of the 1025 lands at or above 3:1 against the plot ground',
  },

  {
    // A STRIDE too coarse: still clears the floor on every record, and overshoots it —
    // x5.5 in luminance against the real x3.2, and 20° of hue against a 12° ceiling.
    name: 'the lift takes 0.34-sized strides, clearing the floor but overshooting the colour',
    mutate: (dir) => edit(dir, 'assets/js/species-ramp.js', (s) =>
      replaceOrThrow(s, 't += 0.02', 't += 0.34')),
    expect: 'by no more than 12',
  },

  {
    // THE OTHER HALF OF THE SAME FAILURE, and the one the case above cannot reach.
    // Removing the `break` sends all 68 to pure white — which clears 3:1 everywhere,
    // so the floor assertion passes and the hue assertion reports 0° for every one of
    // them because a pure grey has no hue. It is caught only by the luminance ceiling,
    // which is why that ceiling exists and why this case expects it and not the hue.
    name: 'the loop stops at the first clearing step and now runs to white',
    mutate: (dir) => edit(dir, 'assets/js/species-ramp.js', (s) =>
      replaceOrThrow(s, 'if (contrast(fill, ground) >= min) break;',
        'if (contrast(fill, ground) >= min && false) break;')),
    expect: 'by at most x4 in relative luminance',
  },

  {
    // Lift toward BLACK instead of white. Every one of these assertions except one is
    // satisfied by it, because a black curve on a near-black ground still "returns a
    // colour for all 1,025" and the export signature is untouched.
    name: 'the lift runs toward black instead of toward the ground opposite',
    mutate: (dir) => edit(dir, 'assets/js/species-ramp.js', (s) =>
      replaceOrThrow(s, 'const towards = ground.some(v => v > 127) ? 0 : 255;',
        'const towards = 0;')),
    expect: 'every one of the 1025 lands at or above 3:1 against the plot ground',
  },

  {
    // The 60fps shape. `drawLive()` is the frame loop; putting the resolution there
    // computes a contrast ratio sixty times a second for a value that changes when the
    // reader picks a Pokémon. The assertion reads drawLive()'s own body.
    name: 'the ink is resolved inside the 60fps frame loop instead of once per selection',
    mutate: (dir) => edit(dir, 'spectrum.html', (s) =>
      replaceOrThrow(s, '      state.liveInk = speciesInk(meta?.rgb, state.plotGround, contrast);',
        '      state.liveInk = null;\n      globalThis.__perFrame = () => speciesInk(meta?.rgb, state.plotGround, contrast);')),
    expect: 'the ink is resolved in select() and stored on state',
  },
];

console.log(`check_spectrum_page.mjs — ${CASES.length - 1} mutations + 1 baseline\n`);

const trees = [];
try {
  for (const c of CASES) {
    const dir = makeTree(c.mutate);
    trees.push(dir);
    const { code, out } = run(dir);
    if (c.baseline) {
      const passed = code === 0 && /PASS  \d+ checks/.test(out);
      ok(c.name, passed, passed ? out.match(/PASS  (\d+) checks/)[1] + ' checks'
        : out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 2).join(' | '));
      continue;
    }
    ok(c.name, code !== 0 && caughtBy(out, c.expect),
      code === 0 ? 'the checker still passed'
        : caughtBy(out, c.expect) ? '' : `caught, but not by "${c.expect}"`);
  }
} finally {
  for (const d of trees) rmSync(d, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} of ${results.length} cases`);
  process.exit(1);
}
console.log(`PASS  ${results.length} cases`);
