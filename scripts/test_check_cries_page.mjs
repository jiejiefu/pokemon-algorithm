#!/usr/bin/env node
/**
 * Prove check_cries_page.mjs can actually fail.
 *
 * Run: node scripts/test_check_cries_page.mjs
 *
 * The cases cluster on the three ways this page could go wrong without looking
 * broken. It could stop reading the generated table. It could compare
 * unstandardised numbers, which returns a confident ranking decided by
 * whichever dimension happens to have the largest scale. And it could keep a
 * claim the measurements do not support — a "most similar" panel that never says
 * it means timbre. Each case breaks one of those and requires the checker to
 * exit non-zero naming it, because "it failed" is also what a crash produces.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy, failLines } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = [
  'cries.html',
  'assets/css/cries.css',
  'assets/data/cry_features.json',
  'assets/js/shared.js',
  'scripts/check_cries_page.mjs',
];
const CHECKER = 'scripts/check_cries_page.mjs';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeTree(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'criespage-neg-'));
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

const editPage = (dir, fn) => {
  const p = join(dir, 'cries.html');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
const editCss = (dir, fn) => {
  const p = join(dir, 'assets/css/cries.css');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

const CASES = [
  {
    name: 'the page stops reading the generated table and embeds its own numbers',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("const FEATURES_URL = 'assets/data/cry_features.json';",
        "const FEATURES_URL = 'assets/data/cry_features.json';\n      const INLINE = { latest: { 1: [0.94, 1.03, 0.31, 412, 1358, 2031, 0.0006, 0.11] } };")),
    expect: 'no feature row is hardcoded',
  },
  {
    name: 'an axis is renamed in the page but not in the data, so its bar reads undefined',
    mutate: (dir) => editPage(dir, (s) => s.replace("key: 'flatness',", "key: 'flatness_v2',")),
    expect: 'every axis the page offers exists in featureNames',
  },
  {
    name: 'scores are compared without standardising, so two dimensions decide everything',
    mutate: (dir) => editPage(dir, (s) => s
      .replace(/std\[k\] = \(rows\[i\]\[k\] - mean\[k\]\) \/ sd\[k\];/, 'std[k] = rows[i][k];')),
    expect: 'per-dimension standardised',
  },
  {
    name: 'a zero standard deviation divides by zero and puts NaN in every vector',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('sd[k] = Math.sqrt(sd[k] / rows.length) || 1;', 'sd[k] = Math.sqrt(sd[k] / rows.length);')),
    expect: 'zero standard deviation falls back to 1',
  },
  {
    name: 'the two recorded sets are standardised with one shared set of statistics',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('indexSet(state.legacy ? features.legacy : features.latest);', 'indexSet(features.latest);')),
    expect: 'switching the set re-indexes it',
  },
  {
    name: 'a preset isolates one axis, where cosine is always 1.000 and the ranking inverts',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("{ key: 'bright', label: '明亮偏重', weight: { centroid: 2.5, rolloff85: 2, zcr: 1.5 } },",
        "{ key: 'bright', label: '只看明亮度', only: ['centroid'] },")),
    expect: 'no preset isolates a single axis',
  },
  {
    name: 'the degenerate single-dimension fallback is removed along with the preset that needed it',
    mutate: (dir) => editPage(dir, (s) => s
      .replace(/if \(active <= 1\) \{[\s\S]*?\n      \} else \{/, 'if (false) {\n      } else {')),
    expect: 'falls back to absolute distance',
  },
  {
    name: 'the default preset stops excluding absolute level, which is a recording property',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("zero: ['peak', 'rms']", "zero: []")),
    expect: 'excludes absolute level',
  },
  {
    name: 'the caveat is moved out of the served DOM and built by script instead',
    mutate: (dir) => editPage(dir, (s) => s
      .replace(/<div class="cy-caveat">[\s\S]*?<\/div>\n        <\/div>/, '</div>')),
    expect: 'caveat is part of the served DOM',
  },
  {
    name: 'the caveat stops saying this is not lineage',
    mutate: (dir) => editPage(dir, (s) => s.replace('不是血緣', '是同類的親緣關係')),
    expect: 'states plainly that this is not lineage',
  },
  {
    name: 'the measured figures are deleted, leaving a confident claim with no evidence',
    mutate: (dir) => editPage(dir, (s) => s.replace('12.6%', '很高').replace('3.2%', '很低')),
    expect: 'carries the measured top-20 figure',
  },
  {
    name: 'the prose promises a semantic ranking the numbers do not support',
    mutate: (dir) => editPage(dir, (s) => s.replace('點任何一隻，看它的數值和音色最接近的同伴。',
      '點任何一隻，找出最相似血緣的寶可夢。')),
    expect: 'the intro never claims the similarity is semantic',
  },
  {
    name: 'the legacy warning is deleted, so the two non-comparable sets look interchangeable',
    mutate: (dir) => editPage(dir, (s) => s
      .replace(/<div class="cy-warning" id="legacy-warning"[\s\S]*?<\/div>\n\n/, '')),
    expect: 'legacy warning element is in the DOM',
  },
  {
    name: 'the legacy warning stops saying the sets cannot be compared',
    mutate: (dir) => editPage(dir, (s) => s.replace('不能與新版直接比較', '和新版完全一致')),
    expect: 'cannot be compared directly',
  },
  {
    name: 'the page hand-builds a cry path instead of asking the roster',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("import { hasCry, hasLegacyCry } from './assets/js/cry-index.js';",
        "const cryUrl = (id) => `assets/cries/latest/${id}.ogg`;")),
    expect: 'never spells out a cry path',
  },
  {
    name: 'playback goes back to a remote cry host',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("await cryPlayer.play(id, {\n          legacy: state.legacy,",
        "await cryPlayer.play(id, {\n          legacy: false,")
      .replace("cryPlayer.play(id, {", "new Audio('https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/' + id + '.ogg').play(); cryPlayer.play(id, {")),
    expect: 'does not reach for a remote cry host',
  },
  {
    name: 'playback stops passing the set through, so a legacy id plays a latest file',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("await cryPlayer.play(id, {\n          legacy: state.legacy,\n", "await cryPlayer.play(id, {\n")),
    expect: 'passes the set through the player',
  },
  {
    name: 'playback is no longer gated on the rosters, so an absent file becomes a 404',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("import { hasCry, hasLegacyCry } from './assets/js/cry-index.js';", '')),
    expect: 'imports the rosters',
  },
  {
    name: 'the in-card play control loses its keyboard handling',
    mutate: (dir) => editPage(dir, (s) => s
      .replace(/grid\.addEventListener\('keydown'[\s\S]*?\n    \}\);/, '')),
    expect: 'handles Enter and Space',
  },
  {
    name: 'the polite live region becomes a visible paragraph',
    mutate: (dir) => editPage(dir, (s) => s.replace('class="sr-only" id="announce"', 'id="announce"')),
    expect: 'visually hidden',
  },

  /* ---- The autoplay switch, which must never fire on load ---- */
  {
    /* The failure this guards: reading the switch inside the function that runs at
     * boot, so the page cries out the moment it opens. The Gen I lab's equivalent is
     * a `select()` that plays on every call, including its own boot call. */
    name: 'autoplay fires from the boot path, so the page makes noise on load',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('if (autoplay.on) togglePlay(id);', 'togglePlay(id);')),
    expect: 'reads the switch',
  },
  {
    name: 'the autoplay switch is built from scratch instead of the shared module',
    mutate: (dir) => editPage(dir, (s) => s
      .replace("import { mountAutoplay } from './assets/js/cry-autoplay.js';", '')),
    expect: 'mounts the shared autoplay switch',
  },
  {
    name: 'the autoplay switch is mounted outside the panel that owns it',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('<aside class="cy-panel"', '<div id="autoplay-slot"></div>\n      <aside class="cy-panel"')
      .replace('        <div id="autoplay-slot"></div>\n', '')),
    expect: 'a mount point INSIDE the timbre panel',
  },

  /* ---- The generation filter, which was a scroll position wearing a filter's name ---- */
  {
    /* The original bug. One field, `state.gen`, serving as both the filter and the
     * page count: pressing 第 1 世代 sliced 60 cards out of all 1,025 and showed
     * exactly what the unfiltered page showed. */
    name: 'the generation filter and the page counter collapse back into one field',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('ordered.slice(0, state.pages * PAGE_SIZE)', 'ordered.slice(0, state.gen * PAGE_SIZE)')
      .replace('pages: 1,', 'gen: 0,')),
    expect: 'the grid is sliced by the scroll position',
  },
  {
    name: 'the sentinel moves the generation instead of the page count, so scrolling re-filters',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('state.pages = next;', 'state.gen = next;')),
    /* Named for the assertion that actually catches it. The first version of this
     * case expected "every write to state.gen is inside the filter handler" — a
     * count that balanced, because the IntersectionObserver is defined AFTER the
     * filter handler and so fell inside the "everything after" side of the
     * comparison. That check was blind by construction; the one that replaced it
     * bounds the forbidden region at the observer itself. */
    expect: 'nothing after the IntersectionObserver writes state.gen',
  },
  {
    name: 'the filter stops narrowing the id list, so a generation chip only changes the count',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('return state.ids.filter((id) => state.meta.get(id)?.generation === state.gen);', 'return state.ids;')),
    expect: "the filter narrows by the pokemon record's own generation",
  },
  {
    name: 'the meter ranges ignore the filter, so every bar is scaled against all 1,025',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('for (const id of pool) {', 'for (const id of state.ids) {')),
    expect: 'computed from the filtered set',
  },
  {
    name: 'a species filtered out of the grid stays described in the panel',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('if (state.probeId !== null && !filteredIds().includes(state.probeId)) state.probeId = null;', '')),
    expect: 'dropped from the probe panel',
  },
  {
    name: 'the scroll handler is uncapped, so a one-page set keeps re-rendering forever',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('const next = Math.min(state.pages + 1, Math.max(1, Math.ceil(total / PAGE_SIZE)));', 'const next = state.pages + 1;')),
    expect: 'stops at the end of the FILTERED list',
  },
  {
    name: 'reduced motion is no longer honoured',
    mutate: (dir) => editCss(dir, (s) => s.replaceAll('@media (prefers-reduced-motion: reduce) {', '@media (min-width: 0px) {')),
    expect: 'honours reduced motion',
  },
  {
    name: 'cries.css starts claiming a cp- selector, colliding with colors.css',
    mutate: (dir) => editCss(dir, (s) => s + '\n.cp-card { border-radius: 0; }\n'),
    expect: 'claims no `cp-` selector',
  },
  {
    name: 'cries.css hardcodes a colour instead of following the theme tokens',
    mutate: (dir) => editCss(dir, (s) => s + '\n.cy-card { background: #1a1a2e; }\n'),
    expect: 'defines no raw colour',
  },
  {
    name: 'the page drops the shared stylesheet, so it renders with no tokens at all',
    mutate: (dir) => editPage(dir, (s) => s
      .replace('<link rel="stylesheet" href="assets/css/shared.css">', '')),
    expect: 'loads the shared tokens',
  },
  {
    name: 'the nav row loses its icon',
    mutate: (dir) => {
      const p = join(dir, 'assets/js/shared.js');
      writeFileSync(p, readFileSync(p, 'utf8').replace("icon: 'waveform',", ''));
    },
    expect: 'the nav row is the 叫聲 group',
  },
  {
    name: 'the waveform icon is referenced but never defined',
    mutate: (dir) => {
      const p = join(dir, 'assets/js/shared.js');
      writeFileSync(p, readFileSync(p, 'utf8').replace(/^\s*waveform: '[^']*'\n/m, ''));
    },
    expect: 'waveform icon is defined',
  },
];

const baseline = run(makeTree(null));
ok('baseline: the checker passes on an unmutated copy of the tree', baseline.code === 0,
  baseline.code === 0 ? '' : baseline.out.split('\n').slice(-6).join('\n'));

for (const c of CASES) {
  const dir = makeTree(c.mutate);
  let r;
  try {
    r = run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const named = r.code !== 0 && caughtBy(r.out, c.expect);
  ok(c.name, named, named ? ''
    : `exit ${r.code}, expected the checker to report "${c.expect}" on a FAIL line; it said:\n${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`);
}

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');