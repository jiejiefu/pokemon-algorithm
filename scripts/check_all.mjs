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
 * `test_check_gen1_apu.mjs` is 37.8 s because 17 of its 39 cases need that same pass.
 * So forty seconds of every full run is spent re-deriving a fact about `gb-apu.js`,
 * which is a file a colour-palette edit cannot have changed. That harness is no longer
 * an entry at all — see RETIRED_HARNESSES, and the comment at the gap it left.
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
  /* test_check_gen1_apu.mjs IS DELIBERATELY NOT HERE, and this is where you are reading
   * why. It is the 39-case mutation harness for check_gen1_apu.mjs — the thing that
   * proves each of that checker's 92 assertions is LOAD-BEARING rather than trivially
   * true — and it cost 42 s, 22% of the suite, for the largest single item in it.
   *
   * §4's rule is that there is no flag to skip a check, because a supported way to skip
   * one is how it stops happening. So the mechanism had to be removal, not an opt-out,
   * and the file stays on disk runnable with `node scripts/test_check_gen1_apu.mjs`.
   *
   * What that gives up, stated plainly: check_gen1_apu.mjs itself STILL RUNS below, so
   * the synthesis is still compared against the reference on every pass. What is gone is
   * the proof that each of the 92 assertions would fail if the thing it polices stopped
   * being true. The two are not the same claim, and the second is the one this removal
   * trades away.
   *
   * The guard that replaces the daily proof is small and lives in the checker: it reads
   * the retired harness and fails if any of its 39 declared expectations no longer names
   * an assertion the checker contains. It cannot prove an assertion is still meaningful
   * — only that the harness is still pointed at something real.
   */

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
      /* LIFTED OUT OF ITS FILE AND RUN over all 1,025 records, not shape-checked. */
      'assets/js/species-ramp.js',
      'assets/data/cry_features.json', 'assets/data/gen1_cries.json',
      /* The 傳說/幻之 claims are read against the data rather than asserted from
       * memory — 71 / 23 / and zero records carrying both flags. Found by
       * `--prove-inputs`, which is the whole argument for it: a checker that reads
       * a file nobody declared is skipped the moment that file changes, so the run
       * goes green having verified nothing. */
      'assets/data/pokemon_data.json',
    ],
  },
  {
    script: 'scripts/test_check_spectrum_page.mjs', checker: 'scripts/check_spectrum_page.mjs', group: 'cry-page',
    note: 'runs the above in child trees',
    inputs: [
      'spectrum.html', 'assets/css/spectrum.css', 'assets/js/cry-spectrogram.js',
      'assets/js/cry-player.js', 'assets/js/cry-autoplay.js', 'assets/js/shared.js',
      'assets/js/gb-apu.js', 'scripts/analyze_cries.py',
      /* Copied into the tree because the checker reads them there, not in the repo.
       * species-ramp.js is here for the same reason: the checker lifts the function
       * out of its TEXT and runs it, so a harness tree without the file cannot test
       * the live curve's ink at all. */
      'assets/js/species-ramp.js',
      'assets/data/cry_features.json', 'assets/data/gen1_cries.json',
      /* The 傳說/幻之 claims are read against the data rather than asserted from
       * memory — 71 / 23 / and zero records carrying both flags. Found by
       * `--prove-inputs`, which is the whole argument for it: a checker that reads
       * a file nobody declared is skipped the moment that file changes, so the run
       * goes green having verified nothing. */
      'assets/data/pokemon_data.json',
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
      // The page checker parses SAMPLES out of outfit.html and asserts each
      // path resolves, so the page and this list have to invalidate together.
      'outfit.html',
      'assets/images/outfit-samples/*',
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
      'assets/images/outfit-samples/*',
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
    note: '28 cases in child trees, four at a time',
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
  {
    script: 'scripts/check_mmcq_anatomy.mjs', group: 'color',
    inputs: [
      'assets/data/color_palettes.json',
      'assets/js/mmcq-anatomy.js',
      'scripts/lib/png.mjs',
      'assets/images/sprite/*',
    ],
  },
  {
    script: 'scripts/test_check_mmcq_anatomy.mjs', checker: 'scripts/check_mmcq_anatomy.mjs', group: 'color',
    inputs: [
      'assets/data/color_palettes.json',
      'assets/js/mmcq-anatomy.js',
      'scripts/lib/png.mjs',
      'scripts/lib/negative.mjs',
      'scripts/check_mmcq_anatomy.mjs',
      'assets/images/sprite/*',
    ],
  },

  {
    /* Reads every page and every module under assets/js, which is the claim: a page
     * that reaches a member through a named import is reaching something that
     * exists. Written because sorting.html called `cryPlayer.muteForView` for every
     * commit from e1eb879 to 8957cc0, a method cry-player.js did not define — a
     * runtime TypeError six lines above the mute checkbox, the volume slider and
     * every keyboard shortcut, and nothing in the suite could see it.
     *
     * The inputs are the whole page set and the whole module set by derivation, not
     * by list, so a new page or a new module is covered the moment it exists. */
    script: 'scripts/check_page_module_api.mjs', group: 'nav',
    inputs: ['*.html', 'assets/js/*.js'],
  },
  /* ---- nav and structure ---- */
  {
    /* Reads every page in the root, which is the claim: the nav is on all of them
     * or on none. */
    script: 'scripts/check_nav_pages.mjs', group: 'nav',
    inputs: ['*.html', 'assets/css/shared.css'],
  },
  {
    script: 'scripts/test_check_nav_pages.mjs', checker: 'scripts/check_nav_pages.mjs', group: 'nav',
    note: 'runs the above in child trees',
    inputs: ['*.html', 'assets/css/shared.css'],
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

  /* ---- sorting ----
     * Its own group for one reason: this is the only group whose cost is dominated by
     * a browser booting a page that fetches 1,025 sprites, so `--skip=sort` is the one
     * filter a reader will actually want while working on something else. Measured
     * 93s for the checker and ~97s for the suite, against 0.5s for the static
     * half — so the honest advice is not "skip the group" but "run
     * `test_check_sorting_page.mjs --static`" while editing, and the group filter for
     * when the browser half is simply not the question. */
  {
    script: 'scripts/check_sorting_page.mjs', group: 'sort', needsServer: true, manual: true,
    note: 'static half reads the files below; the browser half reads its inputs off the HTML by hand',
    inputs: [
      'sorting.html',
      'assets/css/algo.css',
      'assets/js/sort-run.js',
      'assets/js/sorting-algorithms.js',
      /* fetched by the page, not by the checker — same caveat as
       * check_spectrum_browser.mjs, and the reason `manual` is set */
      'assets/css/shared.css',
      'assets/js/shared.js',
      'assets/js/sort-keys.js',
      'assets/js/cry-player.js',
      'assets/data/pokemon_data.json',
      'assets/images/pokemon/*',
    ],
  },
  {
    script: 'scripts/test_check_sorting_page.mjs', checker: 'scripts/check_sorting_page.mjs', group: 'sort',
    /* `manual: true` for a reason that is NOT the usual one. check_gen1_page.mjs and
     * check_cries_browser.mjs are manual because they open no repo file at all. This
     * one opens plenty — it copies sorting.html, algo.css, sort-run.js and the sorting
     * modules into a temp tree — but every one of those reads happens in a CHILD
     * process over a tree OUTSIDE ROOT, and record-inputs.cjs ignores anything outside
     * ROOT (see its own docstring, and §3.G1's parallel case where the subprocess
     * could not resolve `../.venv`). Inheriting the preload would not help: the paths
     * being opened are the temp copies, so they are out of scope by design.
     *
     * The list is therefore hand-maintained and it is still the right list — these are
     * exactly the files whose content must invalidate the skip cache, since a change to
     * any of them can change what this suite reports. The unverifiable part is stated
     * rather than hidden, which is the whole point of the flag. */
    manual: true,
    note: 'reads happen in child processes over a temp tree outside ROOT, so the recorder cannot see them',
    inputs: [
      'scripts/check_sorting_page.mjs',
      'sorting.html',
      'assets/css/algo.css',
      'assets/js/sort-run.js',
      'assets/js/sorting-algorithms.js',
      /* read for ASSETS.images, which the sprite-stub glob is derived from */
      'assets/js/shared.js',
      'assets/js/*',
    ],
  },

  /* ---- life ---- */
  {
    // `--prove-inputs` says life.css and life.js are NOT read here, which is
    // true and was wrong in the manifest before: this checker drives the engine
    // and reads the HTML string, and it never opened either. They belong to
    // check_life_browser.mjs below, which is the one that opens them.
    script: 'scripts/check_life_page.mjs', group: 'algo',
    inputs: [
      'life.html', 'assets/js/life-engine.js',
      'assets/data/pokemon_data.json', 'assets/data/evolution_chains.json',
      'assets/data/generations.json', 'assets/data/evolution_levels.json',
    ],
  },
  // The levels table is its own entry rather than folded into the page checker:
  // it is generated, its fetcher is a separate script, and every claim in
  // check_evolution_levels.mjs is about the TABLE (coverage floor, the exact set
  // of pairs with no level, the fallback being the median). Merging them would
  // make an edit to the engine look like it invalidated the table.
  {
    script: 'scripts/check_evolution_levels.mjs', group: 'algo',
    inputs: ['assets/data/evolution_levels.json', 'assets/data/pokemon_data.json', 'assets/js/life-engine.js'],
  },
  // manual: true for the same reason as the other CDP checkers — its pages
  // arrive over HTTP from Live Server, so `--prove-inputs` would record it
  // opening NO repo file at all.
  {
    script: 'scripts/check_life_browser.mjs', group: 'algo', needsServer: true, manual: true,
    inputs: ['life.html', 'assets/css/life.css', 'assets/css/shared.css', 'assets/js/life.js',
             'assets/js/life-engine.js', 'assets/js/shared.js'],
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
   HARNESSES THAT ARE NOT ENTRIES

   A mutation harness can be taken out of the manifest without disabling it — no flag,
   no opt-out, the entry is simply gone — because it is expensive and it proves a
   claim about a CHECKER rather than about the site. That is a real trade and it is
   recorded where the reader is already looking (the comment at the gap in CHECKERS
   above, and AGENTS.md §3.G5). What is NOT acceptable is a removal that is invisible
   the moment somebody edits an assertion message, because the harness's whole method
   is a string that names an assertion: rename one description and every case pointing
   at it silently stops pointing at it.

   So the runner reads them. One row here is cheap — two files, no subprocess — and it
   cannot be skipped by skipping the entry, because the entry is what is gone.
   --------------------------------------------------------------------------- */
const RETIRED_HARNESSES = [
  { harness: 'scripts/test_check_gen1_apu.mjs', checker: 'scripts/check_gen1_apu.mjs' },
];

/* WHY ORPHANS ARE SLICED PER ASSERTION, AND WHY THAT IS NOT THE INTERESTING PART.
   Each `expect` is tested against SOME ONE assertion's description rather than against
   the file, because §3.G4 records what the weaker version cost: check_sorting_page.mjs
   asserted `docblock.includes('524,800')` and the same number appears in the next
   paragraph, so editing the quotation left the check green. Presence is not
   attribution.

   What this still cannot do is tell one assertion from another when two share a
   description. Three of the 39 do — `byte-identical`, `Rhyhon`, `0.071` — and for
   those it is a weaker claim than the harness makes. The harness resolves them with
   `caughtBy`, which reads the FAIL lines; here there are no FAIL lines, because a
   retired harness does not run. That limit is the price of retiring it and it is why
   the harness is not gone, only unlisted. */
function auditRetiredHarnesses() {
  const bad = [];
  const say = (pass, what) => {
    if (!pass) bad.push(what);
    console.log(`      ${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  for (const { harness, checker } of RETIRED_HARNESSES) {
    const hs = existsSync(join(ROOT, harness)) ? readFileSync(join(ROOT, harness), 'utf8') : null;
    say(hs !== null,
      `${harness} is still on disk`
        + (hs === null
          ? ' — it is gone, so editing an assertion message in the checker it attacks now has nothing saying the cases stopped pointing at it'
          : ''));
    if (hs === null) continue;

    const cs = readFileSync(join(ROOT, checker), 'utf8');
    /* Slice the checker into one chunk per assertion call. `eq` and `near` forward to
       `ok`, so all three openers matter; `ok` on its own would miss two assertions and
       the missing ones could then be renamed freely. */
    const starts = [...cs.matchAll(/^\s*(?:eq|ok|near)\(/gm)].map((m) => m.index);
    const chunks = starts.map((s, i) => cs.slice(s, starts[i + 1] ?? cs.length));
    /* The source escapes an apostrophe inside a single-quoted description and the
       harness's string holds it literally. Measured: 1 of the 39 stops matching
       without this, so it is not tidying. */
    const descriptions = chunks.map((c) => c.replace(/\\'/g, "'"));

    const expectations = [...hs.matchAll(/^\s*expect:\s*(['"])([\s\S]*?)\1\s*,?\s*$/gm)].map((m) => m[2]);
    const declared = [...hs.matchAll(/^\s{4}name: /gm)].length;

    /* NON-VACUITY, AS AN IDENTITY RATHER THAN A FLOOR. Two independent parses of the
       same file: how many cases are NAMED, and how many carry an expectation. If the
       `expect:` key is ever renamed or reformatted the first count collapses to 0
       while the second does not move, and "zero orphans" would then be reporting
       nothing at all — the shape §3.B2 names, where a guard that can only be satisfied
       by having nothing left to complain about is a guard that passes forever. A
       floor would work today and stop working when the roster shrinks; the identity
       cannot. */
    say(expectations.length === declared,
      `${harness}: all ${declared} of its cases carry an expectation it can be measured by`
        + (expectations.length === declared
          ? ''
          : ` — ${expectations.length} matched the \`expect:\` key, so the orphans below would be a vacuous PASS`));

    const orphans = expectations.filter((e) => !descriptions.some((c) => c.includes(e)));
    say(orphans.length === 0,
      `...and every one of those expectations still names an assertion in ${checker}`
        + (orphans.length ? '' : ' — no assertion description has been edited out from under it'));
    for (const o of orphans) {
      console.log(`        orphaned: ${JSON.stringify(o)}`);
    }

    const claimed = /(\d+)\s+cases\b/.exec(hs.slice(0, hs.indexOf('*/')))?.[1];
    say(claimed === String(declared),
      `...and its header still claims the case count it actually has (${declared})`
        + (claimed === String(declared) ? '' : ' — its header says ' + (claimed ?? 'nothing')));
  }
  return bad;
}


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
  help: has('--help') || has('-h'),
};

/** `--skip=cry` covers `cry-apu`, `cry-data` and `cry-page` without naming three. */
const inGroup = (group, filters) => filters.some((f) => group === f || group.startsWith(`${f}-`));

/* ---------------------------------------------------------------------------
   --help
   ---------------------------------------------------------------------------
   A flag nobody can find is a flag nobody uses, and the reader who most needs
   `--only` is someone who has just edited one file and wants the cheapest check
   that covers it — which is the opposite of running everything. The runner already
   knows every group and what it last cost; the table below is that knowledge with no
   derivation step in front of it.

   The costs are the CACHE's, so they are the last GREEN run's measured durations and
   are labelled that way. A `-` means the entry has never run green here, which is a
   real answer rather than a missing one — it means the cost is unknown, not zero.
   --------------------------------------------------------------------------- */
function help() {
  const state = existsSync(CACHE) ? (() => { try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return {}; } })() : {};
  const secsOf = (s) => (s == null ? '-' : `${Number(s).toFixed(1)}s`);

  console.log(`
  node scripts/check_all.mjs [options]

    --only=<group>    run just these groups. 'cry' means cry-apu, cry-data, cry-page.
    --skip=<group>    run everything except these. Takes the same prefixes.
    --force           ignore the skip cache and run every selected entry.
    --no-cache        do not read OR write the cache. Use when you want a real number
                      rather than a remembered one, and when proving inputs.
    --prove-inputs    run each checker under a recorder and fail if what it reads
                      disagrees with the manifest's \`inputs\`. Slow: it runs the
                      negative harnesses for real.
    --help            this.

  Groups, cheapest first. Costs are the last GREEN run, from the skip cache:

    group       entries   last green total   its most expensive entry
`);

  const groups = new Map();
  for (const c of CHECKERS) {
    const g = c.group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const rows = [...groups].map(([g, cs]) => {
    const total = cs.reduce((a, c) => a + (state[`${c.script.replace(/^scripts\//, '')}~`] ?? 0), 0);
    const known = cs.some((c) => state[`${c.script.replace(/^scripts\//, '')}~`] != null);
    const worst = cs
      .map((c) => [c.script.replace(/^scripts\//, ''), state[`${c.script.replace(/^scripts\//, '')}~`] ?? 0])
      .sort((a, b) => b[1] - a[1])[0];
    return { g, n: cs.length, total: known ? `${total.toFixed(1)}s` : '-', worst };
  }).sort((a, b) => (a.total === '-' ? 1 : b.total === '-' ? -1 : parseFloat(a.total) - parseFloat(b.total)));

  for (const r of rows) {
    const w = r.total === '-' ? '(never run green here)' : `${r.worst[0].replace(/\.mjs$/, '')} ${secsOf(r.worst[1])}`;
    console.log(`    ${r.g.padEnd(12)} ${String(r.n).padStart(4)}   ${r.total.padStart(15)}   ${w}`);
  }

  console.log(`
  Not an entry any more, and still runnable by hand — §3.G5 says what was traded:

    node scripts/test_check_gen1_apu.mjs

  One harness carries its own filter, and it is much cheaper than anything above —
  it is the whole point of the sorting checker's split (§3.G4):

    node scripts/test_check_sorting_page.mjs --static    # the 31 static checks, ~0.5s
`);
}

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
  if (opts.help) return help();
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

    /* `execFile` buffers, so nothing appears until the child exits — which for the
     * longest entry in the manifest is tens of seconds either way (11 s idle here,
     * 42 s measured on a machine competing with Chrome at 97% CPU), i.e. a terminal
     * that looks hung for either. The line names what is about to run and is replaced
     * by the result line, so the run is never silent for longer than one check. */
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
  /* The retired-harness audit is not an entry and has no time column: it is two files
     and a few regexes, and printing a duration for it would be a measurement of the
     regex engine. It runs on EVERY invocation including `--only=nav`, because it is a
     claim about the manifest rather than about any one checker's inputs, and a claim
     about the manifest that only holds on some invocations is not a claim. */
  console.log('  retired mutation harnesses');
  const orphans = auditRetiredHarnesses();
  if (orphans.length) failed += orphans.length;

  console.log('');
  console.log(`  ${ran} ran, ${skipped} skipped, ${failed} failed, ${secs(budget)} of checker time`);
  if (skipped && !opts.force) console.log('  (skips are content-keyed; --force runs everything)');
  if (failed) process.exit(1);
}

await main();
