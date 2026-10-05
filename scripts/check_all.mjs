#!/usr/bin/env node
/**
 * One entry point for the §4 suite, with a skip cache keyed on what each checker
 * actually reads.
 *
 * Run: node scripts/check_all.mjs [options]
 * Prove: node scripts/check_all.mjs --prove-inputs
 *
 * WHY THIS EXISTS
 *
 * The suite is twenty-odd scripts run by hand, and they are not equally expensive.
 * Measured here: `check_gen1_apu.mjs` is 6.0 s of which 5.0 s is one pass over the
 * 151-species corpus at 1,048,576 Hz — 146,311,704 samples — and
 * `test_check_gen1_apu.mjs` is 37.8 s because sixteen of its thirty-four cases need
 * that same pass. So forty seconds of every full run is spent re-deriving a fact
 * about `gb-apu.js`, which is a file a colour-palette edit cannot have changed.
 *
 * The obvious fix — a `--quick` flag on the expensive checker — is the one thing
 * that must not be built. `check_gen1_apu.mjs` already says why in its own comment:
 * "a supported way to skip the conformance comparison is exactly how it would stop
 * happening." A flag is a promise the reader has to remember to keep. So the skip
 * lives HERE, it is derived from file CONTENT rather than asked for, and a checker
 * that was skipped says so on its own line with the reason.
 *
 * WHY THE INPUT LISTS ARE PROVEN INSTEAD OF REVIEWED
 *
 * A skip cache is only as good as the list it keys on. Miss one file and the checker
 * is skipped after that file changed, and the run is green having verified nothing —
 * strictly worse than no cache, because it looks like coverage. So `--prove-inputs`
 * runs each checker under `scripts/lib/record-inputs.cjs`, a preload that records
 * every repo file it opens, and fails if the recording disagrees with the declared
 * list. A grep cannot do this: `rg -l initHeaderNav *.html` lists sorting.html
 * because its import names the symbol, and two other pages only because they mention
 * it in a COMMENT (which is why `check_nav_pages.mjs` reads the tree properly).
 *
 * Three `proof` levels, and the difference matters:
 *
 *   exact           recorded set === declared set. Most checkers.
 *   subset          recorded set ⊆ declared set. The negative harnesses, whose real
 *                   work happens in a CHILD process against a temp fixture tree, and
 *                   the two CDP checkers, whose pages arrive over HTTP and never pass
 *                   through the recording process at all. The dangerous direction is
 *                   still enforced: a harness that starts reading a file it never
 *                   declared fails, because that is a missing fixture and it would
 *                   quietly test less than it claims.
 *   by-construction not recordable, and the reason is mandatory and printed on every
 *                   run. Nothing may sit here silently.
 *
 * WHAT IS ALWAYS IN THE KEY, whatever a checker declares
 *
 * Its own source and every `scripts/lib/*.mjs` it imports, because Node's module
 * loader reads them through the same `readFileSync` the preload patches — so editing
 * a checker invalidates its own entry with nothing extra to remember. `this file` is
 * in there too, so changing the cache's own rules cannot be mistaken for a green run
 * computed by the old ones.
 *
 * THE LIMITS, named because each one is a way this can be green and wrong
 *
 *   - A file read only on a branch NOT taken during the recording is not seen. The
 *     checker's own hash being in the key is the mitigation: edit the checker and the
 *     entry is invalidated, so the branch is observed the next time it runs.
 *   - Existence probes are keyed on `path:size`, not content. A sprite replaced by a
 *     different file of the same size would not be noticed; a sprite deleted would.
 *   - The cache trusts the LAST GREEN result on this machine. A checker that passes
 *     for a reason other than its inputs — a missing Chrome, a stale server — is
 *     cached as green. `--force` exists for exactly that.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache/check-state.json');
const RECORDER = join(ROOT, 'scripts/lib/record-inputs.cjs');
const SELF = 'scripts/check_all.mjs';

/* ---------------------------------------------------------------------------
   THE MANIFEST
   --------------------------------------------------------------------------- */

/* `inputs` are globs. A directory with more than a handful of probes collapses to
 * one line — `check_color_palettes.mjs` stats all 1,025 sprites and their shiny
 * pairs, which is 2,050 paths and would be unreadable spelled out. Both sides of
 * `--prove-inputs` and everything that is hashed are EXPANDED first, so deleting one
 * sprite shrinks the expansion and changes the key.
 *
 * A path that no glob covers is a manifest bug, and `--prove-inputs` names it. */
const CHECKERS = [
  /* ---- cry: the synthesiser. The two most expensive things in the suite, and the
     reason this file exists: 6.0 s and 37.8 s, both re-deriving a fact about
     assets/js/gb-apu.js that a colour edit cannot change. ---- */
  {
    script: 'scripts/check_gen1_apu.mjs', group: 'cry-apu',
    inputs: [
      'assets/js/gb-apu.js',
      'assets/data/gen1_cries.json',
      'assets/data/gen1_cry_sfx.json',
      'assets/data/gen1_conformance.json',
      'cries-gen1.html',
    ],
  },
  {
    script: 'scripts/test_check_gen1_apu.mjs', checker: 'scripts/check_gen1_apu.mjs', group: 'cry-apu',
    note: '34 cases, each a fresh checker in a temp tree',
    inputs: [
      'assets/js/gb-apu.js',
      'assets/data/gen1_cries.json',
      'assets/data/gen1_cry_sfx.json',
      'assets/data/gen1_conformance.json',
      'cries-gen1.html',
    ],
  },

  /* ---- cry: the generated tables ---- */
  {
    script: 'scripts/check_gen1_cries.mjs', group: 'cry-data',
    inputs: [
      'assets/data/gen1_cries.json',
      'assets/data/gen1_cry_sfx.json',
      'assets/data/pokemon_data.json',
      'scripts/fetch_gen1_cries.py',
    ],
  },
  {
    script: 'scripts/test_check_gen1_cries.mjs', checker: 'scripts/check_gen1_cries.mjs', group: 'cry-data',
    note: 'runs the above in child trees, and mirrors pokered\'s 114 .asm files',
    inputs: [
      'assets/data/gen1_cries.json',
      'assets/data/gen1_cry_sfx.json',
      'assets/data/pokemon_data.json',
      'scripts/fetch_gen1_cries.py',
      'data-sources/pokered-cry/cries.asm',
      'data-sources/pokered-cry/sfx/*',
    ],
  },
  {
    /* Probes all 1,674 roster files by magic-sniffing their first bytes, so this
     * hashes more than anything else here. They are under the 256 KB big-file
     * threshold for all but a handful, which is stated in keyOf(). */
    script: 'scripts/check_cry_index.mjs', group: 'cry-data',
    inputs: [
      'assets/cries/latest/*',
      'assets/cries/legacy/*',
      'assets/js/*',
      'assets/css/*',
      'assets/data/pokemon_data.json',
      '*.html',
      'scripts/extract_cry_index.py',
    ],
  },
  {
    script: 'scripts/test_check_cry_index.mjs', checker: 'scripts/check_cry_index.mjs', group: 'cry-data',
    note: 'runs the above in child trees, so it also needs the checker\'s own inputs',
    inputs: [
      'detail.html',
      'assets/js/cry-index.js',
      'assets/js/cry-player.js',
      'scripts/extract_cry_index.py',
      'assets/data/pokemon_data.json',
      'assets/cries/latest/*',
      'assets/cries/legacy/*',
      'assets/css/*',
      '*.html',
    ],
  },
  {
    script: 'scripts/check_cry_features.mjs', group: 'cry-data',
    inputs: ['assets/data/cry_features.json', 'assets/js/cry-index.js', 'scripts/analyze_cries.py'],
  },
  {
    script: 'scripts/test_check_cry_features.mjs', checker: 'scripts/check_cry_features.mjs', group: 'cry-data',
    note: 'runs the above in child trees',
    inputs: ['assets/data/cry_features.json', 'assets/js/cry-index.js', 'scripts/analyze_cries.py'],
  },

  {
    script: 'scripts/check_spectrogram_port.mjs', group: 'cry-data',
    note: 'differences cry-spectrogram.js against analyze_cries.py itself; needs the venv',
    inputs: ['assets/js/cry-spectrogram.js', 'scripts/analyze_cries.py'],
  },
  {
    script: 'scripts/test_check_spectrogram_port.mjs', checker: 'scripts/check_spectrogram_port.mjs', group: 'cry-data',
    note: 'runs the above in child trees, beside a symlinked venv',
    inputs: ['assets/js/cry-spectrogram.js', 'scripts/analyze_cries.py'],
  },
  {
    script: 'scripts/check_spectrum_page.mjs', group: 'cry-page',
    inputs: [
      'spectrum.html', 'assets/css/spectrum.css', 'assets/js/cry-spectrogram.js',
      'assets/js/cry-player.js', 'assets/js/cry-autoplay.js', 'assets/js/shared.js',
      'assets/js/gb-apu.js', 'scripts/analyze_cries.py',
      'assets/data/cry_features.json', 'assets/data/gen1_cries.json',
    ],
  },
  {
    script: 'scripts/test_check_spectrum_page.mjs', checker: 'scripts/check_spectrum_page.mjs', group: 'cry-page',
    note: 'runs the above in child trees',
    inputs: [
      'spectrum.html', 'assets/css/spectrum.css', 'assets/js/cry-spectrogram.js',
      'assets/js/cry-player.js', 'assets/js/cry-autoplay.js', 'assets/js/shared.js',
      'assets/js/gb-apu.js', 'scripts/analyze_cries.py',
      /* Copied into the tree because the checker reads them there, not in the repo. */
      'assets/data/cry_features.json', 'assets/data/gen1_cries.json',
    ],
  },

  /* ---- outfit: the mmcq port, the sampling, and the page ---- */
  {
    script: 'scripts/check_outfit_page.mjs', group: 'color',
    note: 're-derives all 2,050 sprite palettes through assets/js/mmcq.js',
    inputs: [
      'assets/js/mmcq.js',
      'assets/js/outfit-palette.js',
      'assets/js/color-match.js',
      'assets/data/color_palettes.json',
      'assets/images/sprite/*',
      'assets/images/sprite/shiny/*',
    ],
  },
  {
    /* NO fs read describes the page: it is fetched over HTTP from Live Server, so
     * the list below is read off the HTML by hand. Same caveat as the two cry
     * page checkers, and `manual: true` is what makes check_all print that
     * rather than tick it. */
    script: 'scripts/check_outfit_browser.mjs', group: 'color', needsServer: true, manual: true,
    note: 'page inputs read off the HTML, not recorded',
    inputs: [
      'outfit.html',
      'assets/css/shared.css',
      'assets/css/colors.css',
      'assets/css/outfit.css',
      'assets/js/shared.js',
      'assets/js/color-palette.js',
      'assets/js/color-match.js',
      'assets/js/mmcq.js',
      'assets/js/outfit-palette.js',
      'assets/data/pokemon_data.json',
      'assets/data/color_palettes.json',
    ],
  },

  /* ---- cry: the pages ---- */
  {
    script: 'scripts/check_cries_page.mjs', group: 'cry-page',
    inputs: ['cries.html', 'assets/css/cries.css', 'assets/data/cry_features.json', 'assets/js/shared.js'],
  },
  {
    /* A bare-Node unit test of the player rather than a page check, because its
     * subject is "does this promise settle" and a stub AudioContext answers that
     * deterministically — Live Server reloads the page every time a concurrent
     * session writes a file, which is not a variable a promise test should carry.
     * It reads cry-index.js only to copy it beside the mutant, whose own import
     * must resolve. fetch() is stubbed, so no audio file is opened. */
    script: 'scripts/test_cry_overlap.mjs', group: 'cry-page',
    note: 'stub AudioContext, no server; guards the overlap: true path',
    inputs: ['assets/js/cry-player.js', 'assets/js/cry-index.js'],
  },
  {
    script: 'scripts/test_check_cries_page.mjs', checker: 'scripts/check_cries_page.mjs', group: 'cry-page',
    note: 'runs the above in child trees',
    inputs: ['cries.html', 'assets/css/cries.css', 'assets/data/cry_features.json', 'assets/js/shared.js'],
  },
  {
    /* NO fs read describes the page: it is fetched over HTTP from Live Server, so
     * this list is the page's own imports and fetches, read off the HTML. That is a
     * human reading, not a recording, and it is the one place in this manifest where
     * a missed entry would be silent — mitigated only by the fact that editing the
     * page itself invalidates the entry. */
    script: 'scripts/check_gen1_page.mjs', group: 'cry-page', needsServer: true, manual: true,
    note: 'page inputs read off the HTML, not recorded',
    inputs: [
      'cries-gen1.html',
      'assets/css/shared.css',
      'assets/css/cries.css',
      'assets/js/gb-apu.js',
      'assets/js/cry-autoplay.js',
      'assets/js/shared.js',
      'assets/data/gen1_cries.json',
      'assets/data/gen1_cry_sfx.json',
      'assets/images/sprite/*',
    ],
  },
  {
    script: 'scripts/check_spectrum_browser.mjs', group: 'cry-page',
    needsServer: true, manual: true,
    inputs: [
      'spectrum.html', 'assets/css/spectrum.css', 'assets/css/shared.css',
      'assets/js/cry-spectrogram.js', 'assets/js/cry-player.js',
      'assets/js/cry-autoplay.js', 'assets/js/cry-index.js', 'assets/js/gb-apu.js',
      'assets/js/shared.js', 'assets/data/cry_features.json',
      'assets/data/gen1_cries.json', 'assets/data/gen1_cry_sfx.json',
      'assets/data/pokemon_data.json', 'assets/images/sprite/*',
    ],
  },
  {
    script: 'scripts/check_cries_browser.mjs', group: 'cry-page', needsServer: true, manual: true,
    note: 'page inputs read off the HTML, not recorded',
    inputs: [
      'cries.html',
      'assets/css/shared.css',
      'assets/css/cries.css',
      'assets/js/cry-index.js',
      'assets/js/cry-player.js',
      'assets/js/cry-autoplay.js',
      'assets/js/shared.js',
      'assets/data/pokemon_data.json',
      'assets/data/cry_features.json',
      'assets/images/sprite/*',
    ],
  },

  /* ---- colour ---- */
  {
    script: 'scripts/check_color_palettes.mjs', group: 'color',
    inputs: [
      'assets/data/color_palettes.json',
      'assets/data/pokemon_data.json',
      'assets/js/color-palette.js',
      'assets/js/form-names.js',
      'assets/js/form-names-zh.js',
      'assets/js/shared.js',
      'assets/js/shiny-index.js',
      'assets/images/sprite/*',
      'assets/images/sprite/shiny/*',
    ],
  },
  {
    script: 'scripts/test_check_color_palettes.mjs', checker: 'scripts/check_color_palettes.mjs', group: 'color',
    note: 'runs the above in child trees',
    inputs: [
      'assets/data/color_palettes.json',
      'assets/data/pokemon_data.json',
      'assets/js/*',
      'assets/images/sprite/*',
      'assets/images/sprite/shiny/*',
    ],
  },
  {
    script: 'scripts/check_color_theme_tokens.mjs', group: 'color',
    inputs: [
      'assets/data/color_palettes.json',
      'assets/js/color-palette.js',
      'assets/js/form-names.js',
      'assets/js/form-names-zh.js',
      'assets/js/shared.js',
      'assets/js/shiny-index.js',
    ],
  },
  {
    script: 'scripts/check_color_page.mjs', group: 'color',
    inputs: ['*.html', 'assets/css/colors.css', 'assets/css/shared.css', 'assets/js/color-palette.js', 'assets/js/shared.js'],
  },
  {
    script: 'scripts/test_check_color_page.mjs', checker: 'scripts/check_color_page.mjs', group: 'color',
    note: 'runs the above in child trees',
    inputs: ['color.html', 'assets/css/colors.css', 'assets/css/shared.css', 'assets/js/color-palette.js', 'assets/js/shared.js'],
  },
  {
    script: 'scripts/check_color_daily.mjs', group: 'color',
    inputs: [
      'color.html', 'index.html',
      'assets/data/color_palettes.json',
      'assets/data/pokemon_data.json',
      'assets/js/categories.js',
      'assets/js/daily-pick.js',
      'assets/js/form-names.js',
      'assets/js/form-names-zh.js',
      'assets/js/shared.js',
      'assets/js/shiny-index.js',
    ],
  },
  {
    script: 'scripts/test_check_color_daily.mjs', checker: 'scripts/check_color_daily.mjs', group: 'color',
    note: 'runs the above in child trees',
    inputs: [
      'color.html', 'index.html',
      'assets/data/color_palettes.json',
      'assets/data/pokemon_data.json',
      'assets/js/*',
    ],
  },
  {
    script: 'scripts/check_color_match.mjs', group: 'color',
    // The five beyond the checker's own module and its two data files are the
    // chain it reaches by importing color-palette.js, which imports shared.js.
    // They were undeclared, which --prove-inputs reports as "read but not
    // declared": the skip cache would have kept reusing this checker's result
    // after someone edited shared.js. Declaring the glob is honest here because
    // the chain is a module-resolution fact, not a list someone maintains.
    inputs: [
      'assets/data/color_palettes.json',
      'assets/data/pokemon_data.json',
      'assets/js/color-match.js',
      'assets/js/color-palette.js',
      'assets/js/shared.js',
      'assets/js/form-names.js',
      'assets/js/form-names-zh.js',
      'assets/js/shiny-index.js',
      'assets/css/shared.css',
      'assets/css/colors-generator.css',
      'colors.html',
    ],
  },
  {
    script: 'scripts/test_check_color_match.mjs', checker: 'scripts/check_color_match.mjs', group: 'color',
    note: 'runs the above in child trees',
    // `assets/js/*` and not a file list: the suite COPIES every .js in that
    // directory into its scratch trees (`JS_TREE = readdirSync(...)`), so adding
    // one file to the directory is a change to this suite's inputs. Listing the
    // files by hand meant adding mmcq.js and outfit-palette.js silently widened
    // it while the cache still claimed otherwise.
    inputs: [
      'assets/data/color_palettes.json',
      'assets/data/pokemon_data.json',
      'assets/js/*',
      'assets/css/shared.css',
      'assets/css/colors-generator.css',
      'colors.html',
    ],
  },

  /* ---- nav and structure ---- */
  {
    /* Reads every page in the root, which is the claim: the nav is on all of them
     * or on none. */
    script: 'scripts/check_nav_pages.mjs', group: 'nav',
    inputs: ['*.html'],
  },
  {
    script: 'scripts/test_check_nav_pages.mjs', checker: 'scripts/check_nav_pages.mjs', group: 'nav',
    note: 'runs the above in child trees',
    inputs: ['*.html'],
  },
  {
    script: 'scripts/check_categories.mjs', group: 'nav',
    inputs: [
      'category.html', 'index.html',
      'assets/css/shared.css',
      'assets/data/evolution_chains.json',
      'assets/data/generations.json',
      'assets/data/pokemon_data.json',
      'assets/js/categories.js',
      'assets/js/form-names.js',
      'assets/js/form-names-zh.js',
      'assets/js/shared.js',
      'assets/js/shiny-index.js',
      'assets/images/pokemon/*',
      'assets/images/shiny/*',
    ],
  },

  /* ---- data ---- */
  {
    script: 'scripts/check_evolution_chains.mjs', group: 'data',
    inputs: ['assets/data/evolution_chains.json', 'assets/data/pokemon_data.json', 'assets/images/pokemon/*'],
  },
  {
    script: 'scripts/check_form_names.mjs', group: 'data',
    inputs: [
      'assets/data/evolution_chains.json', 'assets/data/pokemon_data.json',
      'assets/images/pokemon/*',
      'assets/js/form-names.js', 'assets/js/form-names-zh.js', 'assets/js/shared.js',
    ],
  },
  {
    script: 'scripts/check_learnsets.mjs', group: 'data',
    inputs: [
      'assets/data/learnsets.json', 'assets/data/moves_zh.json', 'assets/data/pokemon_data.json',
      'assets/js/form-names.js', 'assets/js/form-names-zh.js',
      'assets/js/shared.js', 'assets/js/shiny-index.js',
    ],
  },
  {
    script: 'scripts/check_regional_dex.mjs', group: 'data',
    inputs: [
      'detail.html',
      'assets/data/generations.json', 'assets/data/pokemon_data.json',
      'assets/js/categories.js', 'scripts/enhance_pokemon_data.py',
    ],
  },

  /* ---- models ---- */
  {
    script: 'scripts/check_glb.mjs', group: 'model',
    inputs: [
      'model3d.html', 'assets/css/shared.css', 'assets/data/pokemon_data.json',
      'assets/glbs/*', 'assets/js/glb-index.js', 'assets/js/model3d-viewer.js',
    ],
  },

  /* ---- types ---- */
  {
    script: 'scripts/check_type_chart.mjs', group: 'type',
    inputs: [
      'assets/data/pokemon_data.json',
      'assets/js/form-names.js', 'assets/js/form-names-zh.js', 'assets/js/genus-zh.js',
      'assets/js/pokemon-lexicon.js', 'assets/js/shared.js', 'assets/js/shiny-index.js',
      'assets/js/type-chart.js',
    ],
  },
  {
    script: 'scripts/check_type_profiles.mjs', group: 'type',
    inputs: ['assets/data/abilities_zh.json', 'assets/data/type_profiles.json', 'assets/js/type-chart.js'],
  },
  {
    script: 'scripts/check_sv_index.mjs', group: 'type',
    inputs: [
      'types.html', 'assets/data/pokemon_data.json',
      'assets/images/scarlet-violet/*', 'assets/images/sprite/*',
      'assets/js/sv-index.js', 'data-sources/sv-sources.json', 'scripts/fetch_sv_sprites.py',
      /* §3.E: the checker asserts this path does NOT exist. Keyed as a literal so that
       * creating it changes the key and the assertion gets a chance to fail. */
      'assets/data-sources',
    ],
  },
  {
    script: 'scripts/test_check_sv_index.mjs', checker: 'scripts/check_sv_index.mjs', group: 'type',
    note: 'runs the above in child trees',
    inputs: [
      'types.html', 'assets/data/pokemon_data.json',
      'assets/images/scarlet-violet/*', 'assets/images/sprite/*',
      'assets/js/sv-index.js', 'data-sources/sv-sources.json', 'scripts/fetch_sv_sprites.py',
    ],
  },
];


/* ---------------------------------------------------------------------------
   GLOBS
   --------------------------------------------------------------------------- */

/** `*` within a path segment, `**` across them. Enough for this manifest. */
function globToRegExp(pattern) {
  const parts = pattern.split('/').map((seg) => {
    if (seg === '**') return '§§';
    return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  });
  const body = parts.join('/').split('§§').map((s) => (s === '' ? '.*' : s)).join('/');
  return new RegExp(`^${body}$`);
}

function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else out.push(relative(ROOT, p).split(sep).join('/'));
  }
}

const expand = (patterns) => {
  const out = new Set();
  const isDir = (abs) => { try { return statSync(abs).isDirectory(); } catch { return false; } };
  for (const p of patterns) {
    /* A literal names a FILE, or a path that does not exist yet — and the second case
     * is not a corner, it is an assertion. `check_sv_index.mjs:117` requires
     * `assets/data-sources/` NOT to exist, because §3.E keeps the provenance file out
     * of assets/ so it is never served. Keying such a path needs it present in the key
     * while absent, which keyOf()'s `missing` branch already does: create the
     * directory and the key changes, so the checker runs and fails. Skipping
     * nonexistent literals would have made that hole invisible.
     *
     * A literal that IS a directory is skipped rather than handed to keyOf(), which
     * would stat it and then try to read it; a glob reaching into it already covers
     * everything a directory probe was asking about. */
    if (!p.includes('*')) { if (!isDir(join(ROOT, p))) out.add(p); continue; }
    /* A glob's directory prefix decides how deep the walk has to go: a pattern
     * whose last segment is a single star scans one level, a double star walks the
     * whole subtree. Note that a literal double star cannot be written inside a block
     * comment like this one without closing it, which is why the rule is stated in
     * words. */
    const segments = p.split('/');
    const firstStar = segments.findIndex((s) => s.includes('*'));
    const deep = segments[firstStar].includes('**');
    const base = join(ROOT, ...segments.slice(0, firstStar));
    const found = [];
    walk(base, found, deep ? 0 : firstStar);
    const re = globToRegExp(p);
    for (const f of found) if (re.test(f)) out.add(f);
  }
  return out;
};

/* ---------------------------------------------------------------------------
   HASHING
   --------------------------------------------------------------------------- */

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * One key over a checker's whole world.
 *
 * Content for everything it READS, and `path:size` for everything it merely probed
 * for existence — a sprite's bytes are never hashed because nothing ever read them,
 * and a 1 MB palette table is hashed once rather than 1,025 times. The checker's own
 * source and its lib imports are in `paths` already, because the recorder saw the
 * module loader open them, which is what makes editing a checker invalidate its own
 * entry with nothing extra to remember.
 */
function keyOf(paths) {
  const h = createHash('sha256');
  for (const p of [...paths].sort()) {
    const abs = join(ROOT, p);
    let st;
    try { st = statSync(abs); } catch { h.update(`${p}\nmissing\n`); continue; }
    if (st.size > 262144) {
      /* Big files are hashed by `path:size:mtime` rather than content. This is the
       * one place the key can lie, and it is stated rather than hidden: 4 MB of Ogg
       * and 1 MB of GLB are regenerated wholesale by their extractors, never edited
       * in place, so a same-size same-mtime edit does not exist in practice. */
      h.update(`${p}\nbig:${st.size}:${Math.floor(st.mtimeMs)}\n`);
    } else {
      h.update(`${p}\n${sha(readFileSync(abs))}\n`);
    }
  }
  return h.digest('hex');
}

/* ---------------------------------------------------------------------------
   ARGS
   --------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : [];
};
const opts = {
  prove: has('--prove-inputs'),
  force: has('--force'),
  noCache: has('--no-cache'),
  verbose: has('--verbose'),
  only: flagValue('only'),
  skip: flagValue('skip'),
};

/** `--skip=cry` covers `cry-apu`, `cry-data` and `cry-page` without naming three. */
const inGroup = (group, filters) => filters.some((f) => group === f || group.startsWith(`${f}-`));

const selected = CHECKERS.filter((c) => {
  if (opts.only.length && !inGroup(c.group, opts.only)) return false;
  if (opts.skip.length && inGroup(c.group, opts.skip)) return false;
  return true;
});

/* ---------------------------------------------------------------------------
   RUNNING
   --------------------------------------------------------------------------- */

const port = process.env.CRY_PORT || '5500';
let serverUp = null;
const serverIsUp = async () => {
  if (serverUp !== null) return serverUp;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${port}/index.html`, { signal: ctl.signal });
    clearTimeout(t);
    serverUp = r.ok;
  } catch { serverUp = false; }
  return serverUp;
};

const RECORDED = '.cache/recorded-inputs.json';

const run = (script, extraArgs = [], preload = false) => new Promise((res) => {
  const args = [...(preload ? ['-r', RECORDER] : []), join(ROOT, script), ...extraArgs];
  const started = process.hrtime.bigint();
  /* The preload throws without these, and a throw in a `-r` module kills the child
   * before the checker starts — which is why "no recording" and "the checker is
   * broken" have to be told apart by the exit code rather than assumed. */
  const env = preload
    ? { ...process.env, RECORD_INPUTS_ROOT: ROOT, RECORD_INPUTS_OUT: join(ROOT, RECORDED) }
    : process.env;
  execFile(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env },
    (err, stdout, stderr) => res({
      code: err ? (err.code ?? 1) : 0,
      out: `${stdout}${stderr}`,
      /* SECONDS, despite the neighbouring helpers: nanoseconds / 1e9. It was
       * milliseconds once and the summary divided by 1000 again, so a 130-second
       * run reported "0.1s of checker time". */
      s: Number(process.hrtime.bigint() - started) / 1e9,
    }));
});

const lastLine = (out) => {
  const lines = out.trimEnd().split('\n').filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : '(no output)';
};

const secs = (s) => (s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`);

/**
 * One line per manifest entry, whatever happened to it.
 *
 * Every branch that finishes an entry goes through here — five kinds of row, ok /
 * FAIL / a cached skip / a skip that never had a server / the `▶` that precedes a
 * run — because the time column is only readable if they all agree on where it
 * starts, and five call sites each building their own padding is five chances for
 * the table to drift.
 *
 * `detail` is PADDED but never sliced, and the difference is load-bearing: an
 * `ok` line must fit 56 columns or the table loses its right edge, while a `skip`
 * that names the Runtime Server rule has to keep that sentence whole, and
 * truncating an instruction is how a reader ends up not knowing why a check did not
 * run. Callers slice where they need to.
 *
 * The time column carries three different claims and they must not be confused:
 *
 *   6.0s          measured THIS run
 *   last 6.0s     not run now; the number is the previous green run's, from the cache
 *   -             never ran at all, so there is no measurement to report
 *
 * The third case is the one that used to be missing entirely: a skip printed the
 * timestamp the entry was last written and nothing else, so a fully-cached run read
 * as a list of timestamps rather than a list of checks with known costs.
 */
const row = (status, pad, detail, time, tail = '') =>
  console.log(`  ${status.padEnd(5)} ${pad} ${String(detail).padEnd(56)} ${String(time).padStart(11)}${tail}`.trimEnd());

/* ---------------------------------------------------------------------------
   --prove-inputs
   --------------------------------------------------------------------------- */

/* Coverage is PATTERN matching, not set membership, and it has to be: the manifest
 * says `assets/images/pokemon/*`, that glob expands to the 329 files on disk, and
 * `check_evolution_chains.mjs` probes four MORE that are not there — 10264.png,
 * 10266.png, 10268.png and 10270.png, all of which are part of what it checks. A
 * set comparison cannot see that the pattern covers them; a pattern test can, and a
 * path that does not exist is still a path the checker cared about. */
const covers = (patterns, p) => patterns.some((pat) => (
  pat.includes('*') ? globToRegExp(pat).test(p) : pat === p
));

/* Two paths are ALWAYS outside the comparison and always inside the key: the
 * checker itself, the checker a negative harness exists to attack, and every file in
 * scripts/lib/. Node's module loader reads them through the same readFileSync the
 * preload patches, so the recorder reports them — but they are CODE, not data, and a
 * manifest that had to spell out its own checker on every line would be unreadable.
 * Folding the whole of scripts/lib/ in rather than parsing each checker's imports is
 * deliberate over-invalidation: editing negative.mjs re-runs all ten harnesses,
 * which is correct, and editing mute-tap.mjs re-runs every checker, which is merely
 * harmless. */
const libFiles = () => expand(['scripts/lib/*']);
const codeOf = (c) => [SELF, c.script, ...(c.checker ? [c.checker] : [])];

async function prove() {
  let bad = 0;
  const lib = libFiles();
  console.log(`\n  proving declared inputs against what each checker actually reads`);
  console.log(`  (a record that disagrees is a skip cache that would skip something real)\n`);
  for (const c of selected) {
    const tmp = join(ROOT, RECORDED);
    mkdirSync(dirname(tmp), { recursive: true });
    /* Removed first, not overwritten: a script that fails to launch leaves the PREVIOUS
     * run's recording on disk, and reading that back would prove a manifest against
     * a run that never happened. Missing file is the honest answer. */
    rmSync(tmp, { force: true });
    const r = await run(c.script, [], true);
    let rec;
    try { rec = JSON.parse(readFileSync(tmp, 'utf8')); } catch { rec = null; }

    const label = c.script.replace(/^scripts\//, '').padEnd(34);
    if (!existsSync(join(ROOT, c.script))) {
      console.log(`  ??     ${label} listed in the manifest but not on disk — cannot be proven`);
      bad++;
      continue;
    }
    if (!rec) {
      console.log(`  ??     ${label} no recording (exit ${r.code}) — is the checker runnable here?`);
      bad++;
      continue;
    }

    const raw = [...rec.read, ...rec.exists];
    const seen = new Set(raw);
    const code = new Set([...codeOf(c), ...lib]);
    for (const skip of code) seen.delete(skip);

    /* `manual` marks the two CDP checkers, and the server is what makes their
     * recording mean anything: with :5500 down they die partway through and record a
     * TRUNCATED set, which then looks exactly like a manifest that over-declares.
     * That is not a proof failing, it is a proof that never ran, and the difference
     * matters — so it is a failure with an actionable message rather than a green
     * tick earned by accident. */
    if (c.manual && !(await serverIsUp())) {
      console.log(`  ??     ${label} needs :${port} — a CDP checker cannot be proven without it`);
      bad++;
      continue;
    }

    /* A checker that opens NO repo file at all is a real and useful fact, not an
     * excuse: the pages arrive over HTTP, so nothing either depends on passes through
     * this process. Their input lists are read off the HTML by hand, which is the
     * weakest claim in this manifest, so it is printed as such on every run rather
     * than hidden behind a green tick. */
    if (!seen.size) {
      console.log(`  ok     ${label} opens no repo file — ${c.inputs.length} declared input(s) are hand-maintained`);
      continue;
    }

    /* TWO RULES, both required, and the asymmetry is the point.
     *
     * Undeclared reads are the dangerous direction: a file that can change the
     * verdict but is not in the key is exactly the silent stale skip this whole
     * mechanism exists to prevent. It applies to a hand-maintained list too, which is
     * the only thing keeping one honest.
     *
     * The other direction only applies to LITERAL entries, and never to a manual one.
     * A glob is allowed to be broader than one run touched — `assets/images/sprite/*`
     * covers 1,530 files and `check_color_palettes.mjs` stats 1,025 of them, so
     * demanding equality would make the manifest impossible to write. A literal is
     * different: if the manifest names `assets/js/shreded-index.js` and nothing opened
     * it, that is a typo or a checker that stopped reading it, and both are worth
     * being told. A manual entry has nothing to tell, because by construction most of
     * its list was never touched by the recording. */
    const undeclared = [...seen].filter((p) => !covers(c.inputs, p)).sort();
    const unread = c.manual ? [] : c.inputs.filter((p) => !p.includes('*') && !seen.has(p)).sort();
    const unusedGlobs = c.inputs.filter((p) => p.includes('*') && expand([p]).size === 0);

    if (!undeclared.length && !unread.length && !unusedGlobs.length) {
      const how = c.manual ? 'hand-maintained, unrecorded' : `${seen.size} covered`;
      console.log(`  ok     ${label} ${how}${c.note ? `   (${c.note})` : ''}`);
    } else {
      bad++;
      console.log(`  MISMATCH ${label}`);
      if (undeclared.length) console.log(`      read but not declared:  ${undeclared.join(' ')}`);
      if (unread.length) console.log(`      declared but not read:  ${unread.join(' ')}`);
      if (unusedGlobs.length) console.log(`      glob matched nothing:  ${unusedGlobs.join(' ')}`);
    }
  }
  console.log('');
  if (bad) { console.log(`FAIL  ${bad} manifest entr${bad === 1 ? 'y' : 'ies'} cannot be trusted`); process.exit(1); }
  console.log('PASS  every declared input list is proven');
}

/* ---------------------------------------------------------------------------
   MAIN
   --------------------------------------------------------------------------- */

async function main() {
  if (opts.prove) return prove();

  let state = {};
  if (!opts.noCache && existsSync(CACHE)) {
    try { state = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { state = {}; }
  }
  const next = { ...state };
  const lib = libFiles();
  let ran = 0; let skipped = 0; let failed = 0; let budget = 0;

  /* One legend for the whole table, because the time column mixes three different
   * claims (this run / last run / never ran) and a bare `6.0s` next to a
   * `last 6.0s` is otherwise a guess. The second line exists because the column
   * does NOT add up: a cached skip's number is real but it was not paid for during
   * this run, and the total below only sums what actually ran. */
  console.log('  time: bare = measured this run   "last <n>s" = cached from the last green run   "-" = never ran');
  console.log('        the final total adds up ran checks only');

  for (const c of selected) {
    const name = c.script.replace(/^scripts\//, '');
    const pad = name.padEnd(34);

    /* A manifest entry naming a script that is not there is a manifest bug — a
     * checker renamed, or an entry added ahead of the file. execFile would report it
     * as an opaque ENOENT, so it is caught here with the one line that says which.
     * `-` rather than a time because nothing ran: there is nothing to measure, and
     * a zero here would read as a measurement. */
    if (!existsSync(join(ROOT, c.script))) {
      row('FAIL', pad, 'listed in the manifest but not on disk', '-');
      failed++;
      continue;
    }

    if (c.needsServer && !(await serverIsUp())) {
      row('skip', pad, `no server on :${port} — see the Runtime Server rule in AGENTS.md`, '-');
      skipped++;
      continue;
    }

    /* SELF, the checker, the checker it attacks, and all of scripts/lib/ are in every
     * key whatever the manifest says: changing the cache's own rules must not reuse
     * entries the old rules produced, and editing a checker must invalidate its own
     * entry with nothing extra for a maintainer to remember. */
    const paths = expand([...c.inputs, SELF]);
    for (const extra of codeOf(c)) paths.add(extra);
    for (const l of lib) paths.add(l);
    if (paths.size === 0) {
      row('FAIL', pad, 'no input file matched its globs — a renamed file would be a silent skip', '-');
      failed++;
      continue;
    }
    const key = keyOf(paths);

    /* This is where the two silent quantities were. Expanding 1,674 roster globs and
     * hashing them is not free, and it is not the checker either — which is why the
     * skip row reports the CACHED cost of the last green run and says so, instead of
     * either inventing a duration or claiming the hash time is the check's. */
    if (!opts.force && !opts.noCache && state[name] === key) {
      const prior = state[`${name}~`];
      /* `== null`, not Number(): Number(null) is 0 and Number(undefined) is NaN, so
       * the obvious `Number(...)` prints `last 0.0s` for every entry written before
       * durations were stored, which is a measurement that never happened. Every
       * cached entry from an older run therefore reads `-` once, honestly. */
      const cached = prior == null ? '-' : `last ${secs(Number(prior))}`;
      row('skip', pad, `inputs unchanged since ${String(state[`${name}@`]).slice(0, 16)}`, cached);
      skipped++;
      continue;
    }

    /* `execFile` buffers, so nothing appears until the child exits — which for
     * `test_check_gen1_apu.mjs` is 34 s idle and 120 s measured on a loaded machine,
     * i.e. a terminal that looks hung for either. The line names what is about to run
     * and is replaced by the result line, so the run is never silent for longer than
     * one check. */
    row('▶', pad, 'running…', '');

    const r = await run(c.script);
    ran++;
    budget += r.s;
    if (r.code === 0) {
      row('ok', pad, lastLine(r.out).slice(0, 56), secs(r.s), c.note ? `  [${c.note}]` : '');
      /* The duration lives beside the key and the timestamp, and is written ONLY
       * here — a FAIL never refreshes a cache entry, so the number a later skip
       * reports is always from a green run. A duration remembered from a failing one
       * would be the one number on the page that does not describe a passing check. */
      if (!opts.noCache) {
        next[name] = key;
        next[`${name}@`] = new Date().toISOString();
        next[`${name}~`] = r.s;
      }
    } else {
      failed++;
      row('FAIL', pad, lastLine(r.out).slice(0, 56), secs(r.s));
      const tail = r.out.trimEnd().split('\n').slice(-14).join('\n');
      console.log(tail.split('\n').map((l) => `        ${l}`).join('\n'));
    }
  }

  if (!opts.noCache) {
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, `${JSON.stringify(next, null, 2)}\n`);
  }

  console.log('');
  console.log(`  ${ran} ran, ${skipped} skipped, ${failed} failed, ${secs(budget)} of checker time`);
  if (skipped && !opts.force) console.log('  (skips are content-keyed; --force runs everything)');
  if (failed) process.exit(1);
}

await main();
