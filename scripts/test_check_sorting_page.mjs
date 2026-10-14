/**
 * Negative tests for check_sorting_page.mjs — the checker must FAIL, and name the
 * right reason, for every invariant it claims to police.
 *
 *   node scripts/test_check_sorting_page.mjs
 *
 * WHY THIS FILE EXISTS. check_sorting_page.mjs has a static half that is a source
 * shape check, and §4 of AGENTS.md is explicit that this is the weak kind: "A
 * source-shape regex over the same lines passes for any mutation that leaves the
 * substrings in place, which is how the first version of the pin guard was blind."
 * The rendered half is the strong half — it counts ink by alpha and would have caught
 * the blank-canvas defect outright — but it cannot be attacked from a scratch tree,
 * because the page arrives over HTTP from the live repo.
 *
 * So the split is inverted here. The static half is made attackable from a scratch
 * tree by mutating the LINE THE DEFECT IS IN, and every case names the assertion that
 * detects it. `caughtBy` from scripts/lib/negative.mjs decides, not `includes`: a
 * checker prints an assertion's description whether it passes or fails, so a case
 * whose `expect` names a different assertion is satisfied for free — which is how
 * four APU cases and seven color_match cases came to be passing for the wrong reason.
 *
 * COST. The rendered half is stripped from a COPY for these cases, because eighteen
 * full runs at 93s each is half an hour to re-verify regular expressions. Two
 * guards keep that safe:
 *
 *   - The baseline runs the FULL checker, so the fast path is never the only path.
 *   - The baseline ALSO runs the stripped copy and requires it to pass having dropped
 *     EXACTLY the rendered half's check count. A strip one check too wide would leave
 *     every cheap case asserting against a silently narrower checker, and they would
 *     all still pass — they only require their own detector, which a narrower checker
 *     satisfies more easily, not less. This is the same guard §3.F of AGENTS.md
 *     describes for the APU harness, and it exists for the same reason.
 *
 * There is no flag on the checker for this, deliberately: §4 rules out a supported
 * way to skip a check, because that is how the check stops happening. The strip is in
 * the harness, the baseline is whole, and eligibility is decided by `expect` alone so
 * there is no per-case flag to forget.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy } from './lib/negative.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_sorting_page.mjs';

/* The checker reads three text files off disk and imports a fourth, so all four are
 * in the tree. assets/js is copied WHOLE rather than file-by-file because
 * sorting-algorithms.js is imported by the checker itself and a case that dies with
 * ERR_MODULE_NOT_FOUND passes for the wrong reason — the §4 shape this suite exists
 * to catch. It is ~40 KB, so the whole directory is cheaper than reasoning about the
 * import graph. */
const FILES = [
  CHECKER,
  'sorting.html',
  'assets/css/algo.css',
  'assets/js/sort-run.js',
  'assets/js/sorting-algorithms.js',
  'assets/js/shared.js',
  /* Listed for the MUTATION pass, not the copy — the whole assets/js directory is
     already copied wholesale above, and the copy loop skips `assets/js/` entries.
     That makes this list the only thing that decides which files a case may touch,
     and a case aimed at a module NOT in it applies nothing: the checker runs
     unmutated and the harness reports 「the guard does not exist」. That is exactly
     what happened to the two 排序鍵 cases, and it is §3.W's shape — a mutation that
     cannot be applied prints what a mutation the assertion survives prints. */
  'assets/js/sort-keys.js',
];

/* The rendered half's check count. Hardcoded on purpose, and updating it is the
 * point: the guard's job is to catch a strip that takes the WRONG number, and a
 * derived number cannot do that (deriving it from the source is tautological). When a
 * check is added to either half this has to move, which forces whoever added it to
 * look at where the sentinels are — which is exactly the moment a misplaced sentinel
 * would otherwise go unnoticed.
 *
 * It moved 35 → 37 when `min ∞ px` was closed, and BOTH of those checks are in the
 * rendered half, which is the point of the guard: `the speed picker is built before
 * anything clicks it` and `every configuration the browser half visited was actually
 * measured` have no static counterpart to move the total by instead.
 *
 * 41 → 48 for the 390×844 scope-gate section: gate up, ZERO sprite requests, ten
 * labelled options, the pick loading, exactly 156 requests for 第 5 世代, the
 * 72-generation's single derived sample size, and `?scope=1` not being gated.
 * 48 → 53 for the toolbar-geometry sweep, which is FIVE and not six: squeezed
 * controls and toolbar height in each of single and race, plus the algorithm
 * picker's single row at 320px. Counted from the run rather than from the edit.
 * 48 → 53 for the toolbar-geometry sweep, which is FIVE and not six: squeezed
 * controls and toolbar height in each of single and race, plus the algorithm
 * picker's single row at 320px. Counted from the run rather than from the edit.
 * Deliberate, not incidental — see §3.G4 on why this number is hardcoded rather
 * than derived. */
const EXPECTED_STRIP_DROP = 54;

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

/** Strip the sentinelled rendered half, so a case can run in ~0.2s instead of 93s. */
function stripRendered(src) {
  const OPEN = '// >>> RENDERED HALF';
  const CLOSE = '// <<< RENDERED HALF';
  const a = src.indexOf(OPEN);
  const b = src.indexOf(CLOSE);
  if (a < 0 || b < 0 || b < a) throw new Error('the checker lost its RENDERED HALF sentinels — every case below would run the full 93s checker');
  return src.slice(0, a) + src.slice(b + CLOSE.length);
}

function countChecks(out) {
  const m = out.match(/^PASS {2}all (\d+) checks/m);
  return m ? Number(m[1]) : null;
}

function makeTree(mutate, { strip = false } = {}) {
  const dir = trackTree(join(tmpdir(), `spp-neg-${Math.random().toString(36).slice(2)}`));
  mkdirSync(join(dir, 'assets/js'), { recursive: true });
  mkdirSync(join(dir, 'assets/css'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'assets/js'), join(dir, 'assets/js'), { recursive: true });
  /* scripts/lib too, for the same reason and the same evidence: the checker
   * imports `./lib/cdp-port.mjs`, and a tree without it dies at import with
   * ERR_MODULE_NOT_FOUND — which every case in this file reads as "the mutation
   * broke the checker", so all twenty-seven pass for the wrong reason. The
   * harness already distinguishes that case mechanically ("produced NO assertion"),
   * which is how it was caught rather than shipped. */
  cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
  for (const f of FILES) {
    if (!f.startsWith('assets/js/')) cpSync(join(ROOT, f), join(dir, f));
  }
  if (strip) writeFileSync(join(dir, CHECKER), stripRendered(readFileSync(join(dir, CHECKER), 'utf8')));

  if (mutate) {
    for (const f of FILES) {
      const p = join(dir, f);
      const before = readFileSync(p, 'utf8');
      const after = mutate(f, before);
      if (after === undefined) continue;
      if (after === before) {
        throw new Error(`mutation for ${f} did not change the file — the anchor string is stale, so this case would pass for the wrong reason`);
      }
      writeFileSync(p, after);
    }
  }
  return dir;
}

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/* ------------------------------------------------------------ STATIC-ONLY
 * The everyday loop, and it exists because of how this file was written. The first
 * pass at check_sorting_page.mjs debugged a STATIC assertion by running the full
 * 93s browser checker, several times, for a regex. The static half is 30 checks and
 * about 0.2s; only the browser is slow, and only because the page fetches 1,025
 * sprites on boot.
 *
 *     node scripts/test_check_sorting_page.mjs --static
 *
 * runs the stripped copy against the real working tree and prints it. That is the loop
 * to use while editing anything the static half guards.
 *
 * It is NOT a flag on the checker, and that placement is the point rather than a
 * detail. §4 rules out a supported way to skip a check — "a supported way to skip the
 * conformance comparison is exactly how it would stop happening" — because a cheap path
 * becomes the path a reader reaches for by default. This one is also placed ABOVE the
 * two baselines, and it was originally below them: which meant pressing it still ran
 * the 93s browser baseline and all 24 cases first, so the "fast loop" took longer
 * than the thing it was a shortcut for. A slow escape hatch is not an escape hatch.
 * The full checker has no such flag and never will. */
if (process.argv.includes('--static')) {
  const dir = makeTree(null, { strip: true });
  const { code, out } = run(dir);
  releaseTree(dir);
  console.log(out.trimEnd());
  console.log('\n(static half only — the browser half is NOT run. For that: node scripts/check_sorting_page.mjs)');
  process.exit(code);
}

/* Two baselines, and the second is the one that matters.
 *
 * The FIRST runs the whole checker, so the fast path is never the only path: if the
 * stripped copy is sound but the real one is not, this fails.
 *
 * The SECOND requires the stripped copy to pass having dropped EXACTLY the rendered
 * half's checks. It is the guard on the harness rather than on the checker, and it
 * is the reason eighteen cheap cases are trustworthy. */
let fullTotal = null;
{
  const dir = makeTree(null);
  const { code, out } = run(dir);
  if (code === 0) { pass('baseline: the full checker passes on an unmutated copy of the tree'); fullTotal = countChecks(out); }
  else fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
  releaseTree(dir);
}
{
  const dir = makeTree(null, { strip: true });
  const { code, out } = run(dir);
  const strippedTotal = countChecks(out);
  if (code !== 0) fail(`the STRIPPED copy does not pass, so every fast case below is measuring a broken checker:\n${out}`);
  else if (fullTotal === null) fail('cannot compare strip sizes: the full baseline did not report a check count');
  else if (strippedTotal === null) fail('the stripped copy did not print "PASS  all N checks", so its check count is unknown');
  else if (fullTotal - strippedTotal !== EXPECTED_STRIP_DROP) {
    fail(`the strip took ${fullTotal - strippedTotal} checks, expected exactly ${EXPECTED_STRIP_DROP} (${fullTotal} → ${strippedTotal}). A strip one check too WIDE would leave every cheap case asserting against a narrower checker, and they would all still pass; too NARROW and they are testing the browser for no reason. If you added or removed a check, update EXPECTED_STRIP_DROP deliberately.`);
  } else pass(`the stripped copy passes and drops exactly ${EXPECTED_STRIP_DROP} checks (${fullTotal} → ${strippedTotal})`);
  releaseTree(dir);
}

const cases = [
  /* ---- the shipped defect, attacked at its own line ---- */
  {
    /* This is the whole reason the file exists. paint() closing over the module ctx
     * drew every race lane into the hidden single-mode canvas. */
    name: 'the race call to paint() drops its context',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('paint(lane.ctx, lane.nodes, events, race.playing)', 'paint(lane.nodes, events, race.playing)') : undefined,
    expect: 'every paint() call site passes its context explicitly',
  },
  {
    name: 'the single-mode call to paint() drops its context too',
    /* The anchor carries the 5th argument. `50bbf84` gave paint() a
     * `showGridIndices` parameter, and the shorter anchor this used to stop
     * matching — so the mutation changed nothing and the case passed for the
     * wrong reason. The harness's own "did not change the file" guard is what
     * caught it, which is the guard earning its keep. */
    mutate: (f, s) => f === 'sorting.html' ? s.replace('paint(ctx, single.nodes, events, single.playing, state.gridIndices)', 'paint(single.nodes, events, single.playing, state.gridIndices)') : undefined,
    expect: 'every paint() call site passes its context explicitly',
  },
  {
    name: 'ring() loses its context argument at a call site',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('ring(g, nodes[compare.i], TOKENS.compare)', 'ring(nodes[compare.i], TOKENS.compare)') : undefined,
    expect: 'every ring() call site passes its context explicitly',
  },
  {
    /* The second half of the same bug: sweep() took a parameter and read the
     * MODULE-level sweepAt, so lane.sweepAt was dead code and a lane's finish wipe
     * could only ever paint on the single-mode canvas. */
    name: 'sweep() goes back to testing a module-level sweepAt',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('function sweep(g, cfg, startedAt) {\n      if (!startedAt) return false;', 'function sweep(g, cfg, progress) {\n      if (!sweepAt) return false;')
      : undefined,
    expect: 'sweep() reads the timestamp it was passed, not a module-level sweepAt',
  },
  {
    name: 'a sweep() caller stops clearing its own timestamp',
    /* The mutation keeps `lane.ctx` as the first argument, so "every call site passes
     * its context" is satisfied and this case passed for a reason unrelated to what it
     * claims — the exact blind case §4's table is a catalogue of. It needed a NEW
     * assertion rather than a re-pointed `expect`, because clearing the timestamp was
     * never guarded at all. */
    mutate: (f, s) => f === 'sorting.html' ? s.replace('if (!sweep(lane.ctx, lane.cfg, lane.sweepAt)) lane.sweepAt = 0;', 'sweep(lane.ctx, lane.cfg, lane.sweepAt);') : undefined,
    expect: 'both sweep() callers clear their own timestamp when it finishes',
  },

  /* NOTE ON WHAT IS *NOT* HERE, because it is the more useful half of this section.
 *
 * The checker's own guards on the result panel — RESULT_PANEL_STATE surviving a
 * missing `.al-result`, and the two READY results that used to be discarded — live
 * in the RENDERED half, and this harness strips that half before it mutates
 * (`makeTree(c.mutate, { strip: true })`). A case aimed at either would report
 * 「the anchor string is stale」 for every run, which is what three of them did
 * before this note existed.
 *
 * It is not a gap that a slightly better case could close: the guard's whole
 * subject is a CONDITION — `.al-result` being absent — which only occurs on the
 * flake, so no harness can produce it on demand either. The proof that the guard
 * works is a direct mutation instead: restoring the hard dereference in
 * RESULT_PANEL_STATE turns `the result-panel read returns an ANSWER when the panel
 * is absent, rather than throwing` red, by renaming the element out of the way and
 * running the very expression the poll uses. That is why the read is a named
 * constant rather than an inline expression — so the check and the poll cannot
 * diverge, and so the condition can be produced deliberately.
 */

  /* ---- the layout contract ---- */
  {
    /* Prepending shifts every :nth-child by one, so the five-lane shape would give
     * the wrong two lanes half a row. This is asserted against buildRace() rather
     * than left to the rendered half, because a stylesheet check cannot see order. */
    name: '.al-result is prepended again, shifting the five-lane :nth-child selectors',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('raceGrid.appendChild(raceResult);', 'raceGrid.prepend(raceResult);') : undefined,
    expect: '.al-result is appended to the lane grid, so :nth-child(4)/(5) are the bottom two lanes',
  },
  {
    /* The three declarations that make the lane canvas grow. Removing any one turns
     * `flex: 1 1 auto` into a silent no-op, which is the state this shipped in for
     * months. */
    name: 'align-content goes back to center, making the canvas grow a no-op',
    mutate: (f, s) => f === 'assets/css/algo.css' ? s.replace('align-content: stretch;', 'align-content: center;') : undefined,
    expect: 'the lane canvas actually grows: align-content stretch + grid-auto-rows + flex 1 1 auto',
  },
  {
    name: 'grid-auto-rows is dropped, so the rows stop splitting the stage height',
    mutate: (f, s) => f === 'assets/css/algo.css' ? s.replace('grid-auto-rows: minmax(0, 1fr);', '') : undefined,
    expect: 'the lane canvas actually grows: align-content stretch + grid-auto-rows + flex 1 1 auto',
  },
  {
    name: 'the lane canvas loses flex: 1 1 auto and stops filling its row',
    mutate: (f, s) => f === 'assets/css/algo.css' ? s.replace('  flex: 1 1 auto;\n', '') : undefined,
    expect: 'the lane canvas actually grows: align-content stretch + grid-auto-rows + flex 1 1 auto',
  },
  {
    /* `cols = count <= 3 ? count : 3` is the formula that looks right and gives four
     * lanes a 3+1 row with one empty cell. Here the five-lane six-column form is
     * replaced with the default three, which is that same mistake by hand. */
    name: 'the five-lane shape falls back to three columns and leaves an empty cell',
    mutate: (f, s) => f === 'assets/css/algo.css' ? s.replace('.al-lanes[data-lanes="5"] { grid-template-columns: repeat(6, 1fr); }', '') : undefined,
    expect: 'data-lanes="5" gets repeat(6, 1fr)',
  },
  {
    name: 'the bottom two lanes of a five lose their span 3 and do not take half a row',
    mutate: (f, s) => f === 'assets/css/algo.css'
      ? s.replace('.al-lanes[data-lanes="5"] .al-lane:nth-child(4),\n.al-lanes[data-lanes="5"] .al-lane:nth-child(5) { grid-column: span 3; }', '')
      : undefined,
    expect: 'the five-lane shape gives three lanes span 2 and the bottom two span 3',
  },
  {
    /* Specificity, not source order: `[data-lanes] .al-lane` is (0,2,0) and beats the
     * media query's own `[data-lanes]` (0,1,0), so a phone grid would keep two-column
     * spans. A reader on a phone is the case this protects. */
    name: 'the narrow-screen block stops resetting the five-lane span',
    mutate: (f, s) => f === 'assets/css/algo.css' ? s.replace('.al-lanes[data-lanes] .al-lane { grid-column: auto; }', '') : undefined,
    expect: 'the narrow-screen rules restore reflow AND reset the five-lane span',
  },
  {
    name: 'the four-lane shape goes back to three columns, giving a 3+1 row',
    mutate: (f, s) => f === 'assets/css/algo.css' ? s.replace('.al-lanes[data-lanes="4"] { grid-template-columns: repeat(2, 1fr); }', '') : undefined,
    expect: 'data-lanes="4" gets repeat(2, 1fr)',
  },

  /* ---- the four places one ceiling is written ---- */
  {
    name: 'the lane ceiling is silently lowered to four',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('const RACE_N_MAX = 6;', 'const RACE_N_MAX = 4;') : undefined,
    expect: 'the lane ceiling is RACE_N_MAX = 6',
  },
  {
    /* A share link asking for six lanes while the picker refuses a fifth is exactly
     * the drift the constant exists to prevent. */
    name: 'the ?algos= parameter is capped by a literal instead of the constant',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('.slice(0, RACE_N_MAX)', '.slice(0, 4)') : undefined,
    expect: 'the ?algos= parameter is capped by RACE_N_MAX, not by a literal',
  },
  {
    name: 'the picker refuses a seventh lane through a literal instead of the constant',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('checked.length > RACE_N_MAX', 'checked.length > 4') : undefined,
    expect: 'the chip picker refuses a seventh lane through RACE_N_MAX',
  },
  {
    name: 'the picker aria-label is left claiming the old 2 至 4 個 range',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('aria-label="參賽演算法（2 至 6 個）"', 'aria-label="參賽演算法（2 至 4 個）"') : undefined,
    expect: 'the picker’s aria-label says the real range (2 至 6 個)',
  },
  {
    name: 'the meta description still claims the old lane range',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('2–6 條競速賽道', '2–4 條競速賽道') : undefined,
    expect: 'the meta description says 2–6 lanes',
  },

  /* ---- sample sizes ---- */
  {
    /* Retargeted when the 取样 options became derived. The old case deleted a
     * static `<option value="1025">` and the harness reported the anchor stale —
     * which is §3.W's shape working: a mutation that cannot be applied prints
     * exactly what a mutation the assertion survives prints. The equivalent defect
     * now is an option list that stopped being derived, so that is what this
     * breaks: the filter becomes a hardcoded array of the four, which is what
     * `offeredRaceSizes` exists to prevent and what `syncRaceSizes` would then
     * repopulate from under a 72-scope. */
    name: 'offeredRaceSizes() stops filtering, so a small scope offers sizes it cannot fill',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('      const usable = RACE_SIZES.filter(s => Number(s) <= len);', '      const usable = RACE_SIZES.slice();')
      : undefined,
    expect: 'the sample-size <select> is built from offeredRaceSizes(), which FILTERS by the loaded count',
  },
  {
    name: 'syncRaceSizes() stops re-validating state.n against what it offers',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('  if (!offered.includes(state.n)) state.n = offered[0];', '  ;')
      : undefined,
    expect: 'syncRaceSizes() re-validates state.n against the offered set',
  },
  {
    name: 'the sample sizes themselves change',
    mutate: (f, s) => f === 'sorting.html' ? s.replace("const RACE_SIZES = ['100', '250', '500', '1025'];", "const RACE_SIZES = ['100', '250', '500'];") : undefined,
    expect: 'RACE_SIZES is 100 / 250 / 500 / 1025',
  },

  /* ---- the toolbar wraps its own children ----
   *
   * The first two are a PAIR on purpose. Either alone is inert, which is exactly
   * what makes them easy to delete one at a time and never notice: without the
   * wrap the `nowrap` changes nothing, and without the `nowrap` the wrap changes
   * nothing. If only one of the two assertions existed, dropping the other would
   * pass. */
  {
    name: 'the control groups stop wrapping their own children',
    mutate: (f, s) => f === 'assets/css/algo.css'
      ? s.replace('#singleControls,\n#raceControls {\n  flex-wrap: wrap;\n}', '#singleControls,\n#raceControls {\n}')
      : undefined,
    expect: 'both control groups wrap their own children',
  },
  {
    name: 'the toolbar buttons lose their nowrap, so the wrap becomes inert',
    mutate: (f, s) => f === 'assets/css/algo.css'
      ? s.replace('body.al-body .al-toolbar .btn {\n  white-space: nowrap;\n}', 'body.al-body .al-toolbar .btn {\n}')
      : undefined,
    expect: 'the toolbar\'s buttons are nowrap, which is what makes the wrap mean anything',
  },
  {
    name: 'the nowrap is hoisted onto .btn, which is shared.css\'s rule for every button on the site',
    mutate: (f, s) => f === 'assets/css/algo.css'
      ? s.replace('body.al-body .al-toolbar .btn {\n  white-space: nowrap;\n}', 'body.al-body .btn {\n  white-space: nowrap;\n}')
      : undefined,
    expect: 'the nowrap rule is scoped to .al-toolbar, not to .btn',
  },
  {
    /* The 2px margin. 294px of buttons against 296px of content box, so rounding
     * the padding up by one re-wraps the picker at exactly 320px — a width nothing
     * else in the file would notice. */
    name: 'the algorithm button padding is rounded from 9px to 10px',
    mutate: (f, s) => f === 'assets/css/algo.css'
      ? s.replace('    padding: 5px 9px;\n    font-size: 12px;', '    padding: 5px 10px;\n    font-size: 12px;')
      : undefined,
    expect: 'the ≤560px rule shrinks the algorithm buttons, with the 9px padding named',
  },

/* ---- the 排序鍵 dropdown ----
   *
   * The first mutation is the one this defect actually WAS: a label lengthened with
   * prose its own note already carries. It is caught by the duplication assertion
   * rather than by the pixel one, because the pixel assertion needs a browser and the
   * duplication is the cause — §3.F's rule that comparing an implementation to a
   * DESCRIPTION is how an APU ends up confidently agreeing with the wrong thing. */
  {
    name: 'a sort-key label is lengthened back with prose its note already carries',
    mutate: (f, s) => f === 'assets/js/sort-keys.js'
      ? s.replace("id: 'type', label: '屬性', short: '屬性',", "id: 'type', label: '屬性（穩定性示範：同屬性視為相等）', short: '屬性',")
      : undefined,
    expect: 'no sort-key label repeats an explanation its own note already prints',
  },
  {
    /* Found by writing it and watching the assertion above stay green: deleting a
     * legitimate parenthetical leaves a label with NO parenthetical, which a check
     * phrased as 「carries one and is not on the list」 cannot see. REVEALING was an
     * allowance; it had to become a FLOOR, and this case is what proves it is one. */
    name: 'a legitimate disclosure parenthetical is deleted, so 「we cannot promise this」 becomes a silent claim',
    /* Matched by SHAPE, not by typing the label: an earlier version of this case
     * wrote the parenthetical out by hand and got one character wrong, so the
     * replace matched nothing and the harness reported 「the guard does not exist」
     * for a mutation that had never been aimed at anything. §3.S's rule applied to a
     * mutation — the anchor is a pattern over the file, never a transcription of it.
     * That is the SECOND time in this session a hand-copied string was the whole
     * defect, and the first was the REVEALING list it was aimed at. */
    mutate: (f, s) => f === 'assets/js/sort-keys.js'
      ? s.replace(/(id: 'name-stroke', label: '[^']*)（[^）]*）/, '$1')
      : undefined,
    expect: 'every sort-key that is allowed a parenthetical still carries one',
  },
  {
    name: '#sortKeySelect drops its own max-width back to the shared .al-select value',
    mutate: (f, s) => f === 'assets/css/algo.css'
      ? s.replace('#sortKeySelect {\n  max-width: 18em;\n}', '')
      : undefined,
    expect: '#sortKeySelect declares its own max-width, above the shared .al-select\'s 15em',
  },

  /* ---- the 資料範圍 scope gate ---- */
  {
    /* The one line the whole feature turns on. Dropping it and the gate still
     * works on first load — it avoids the FIRST 168 MB — so every rendered check
     * about arriving at the gate would still pass, and the memory is never given
     * back when a reader switches scope. This is why it is a static assertion and
     * not a browser one. */
    name: 'a scope change stops releasing the previous scope\'s images',
    mutate: (f, s) => f === 'sorting.html' ? s.replace('      IMG.clear();\n', '') : undefined,
    expect: 'a scope change releases the previous scope: IMG.clear() plus both node holders',
  },
  {
    name: 'the gate is decided by width alone, so a shared ?scope= link gets overridden',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('const needsChoice = scopeFromUrl == null && matchMedia(NARROW_MQ).matches;', 'const needsChoice = matchMedia(NARROW_MQ).matches;')
      : undefined,
    expect: 'the gate is a media query on the width, gated on the link saying nothing',
  },
  {
    name: 'the breakpoint moves to 600px, so phones above it load 168 MB silently',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace("const NARROW_MQ = '(max-width: 900px)';", "const NARROW_MQ = '(max-width: 600px)';")
      : undefined,
    expect: 'the JS breakpoint matches algo.css\'s phone breakpoint',
  },
  {
    /* The reason deviceMemory is not the gate, asserted as an absence so the
     * question cannot be re-opened by a well-meaning edit. */
    name: 'the gate starts sniffing navigator.deviceMemory, which Safari does not implement',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('const needsChoice = scopeFromUrl == null && matchMedia(NARROW_MQ).matches;',
                  'const needsChoice = scopeFromUrl == null && (navigator.deviceMemory ?? 8) <= 4;')
      : undefined,
    expect: 'no capability sniff decides what loads',
  },
  {
    name: 'the overlay goes back to stating 1,025 whatever is loaded',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('setOverlay(`載入 ${scope.count.toLocaleString()} 隻寶可夢…`);', 'setOverlay(`載入 1,025 隻寶可夢…`);')
      : undefined,
    expect: 'the loading overlay no longer states 1,025 as a fixed count',
  },
  {
    name: 'buildRace() stops refusing an empty scope, so the gate builds lanes over zero nodes',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('      if (!ALL.length) {\n        race = null;\n        updateRaceButton();\n        return;\n      }\n', '')
      : undefined,
    expect: 'buildRace() refuses to build lanes over an empty scope',
  },

  /* ---- the memory claim ---- */
  {
    /* ~33 MB per lane at n=1,025, ~200 MB across six, all of it unread. This is a
     * measurable cost, not a style rule, which is why it has its own assertion. */
    name: 'a race lane goes back to logging its whole history',
    mutate: (f, s) => f === 'sorting.html' ? s.replace("                               { maxLoggedEvents: 0 });", ');') : undefined,
    expect: 'race lanes build their SortRun with maxLoggedEvents: 0',
  },
  {
    /* The stub's glob is READ OUT OF shared.js so there is only one copy of the path.
     * This case is the cost of that choice made visible: with the entry gone the
     * checker cannot tell where the page loads sprites from, falls back to a literal,
     * and would answer 1,025 real HTTP requests — still passing every check, at four
     * times the runtime. Note that MOVING the directory does not trip this case, and
     * should not: the glob follows the move, which is the whole point of deriving it. */
    name: 'shared.js stops declaring the images path the sprite stub is derived from',
    mutate: (f, s) => f === 'assets/js/shared.js' ? s.replace(/\n\s*images: '[^']*',/, '') : undefined,
    expect: "the sprite stub intercepts the page's own sprite directory",
  },

  /* ---- sort-run.js's own claims ---- */
  {
    /* The number the checker re-derives. It was attributed to the wrong algorithms
     * on the wrong input and sat there reading as verified. */
    name: 'a quoted step count is edited into something the generators do not produce',
    mutate: (f, s) => f === 'assets/js/sort-run.js' ? s.replace('524,800   選擇排序', '480,000   選擇排序') : undefined,
    expect: 'sort-run.js quotes 選擇排序 on already-sorted input as 524,800, and attaches it to that row',
  },
  {
    /* The defect this suite's own first version had: the check was "the string never
     * appears", which fires on the docblock EXPLAINING the removed citation. It is
     * now "every scripts/*.mjs path named resolves", which is immune to phrasing. */
    name: 'sort-run.js cites a checker that does not exist',
    mutate: (f, s) => f === 'assets/js/sort-run.js' ? s.replace('`scripts/check_sorting_page.mjs`,', '`scripts/check_algo_modules.mjs`,') : undefined,
    expect: 'every checker sort-run.js names exists',
  },
  {
    name: 'sort-run.js names no checker at all, so its numbers are claims again',
    mutate: (f, s) => f === 'assets/js/sort-run.js' ? s.replace('`scripts/check_sorting_page.mjs`, which drives these generators', 'A generator loop, which drives them') : undefined,
    expect: 'sort-run.js names the checker that actually measures its numbers',
  },

  /* ---- pseudoPy, the Python view of the pseudocode panel ----
   * Each of these attacks a way the two arrays can stop meaning the same
   * statement at the same index — which is the property the WHOLE switcher rests
   * on, since one `lineFor` drives both and there is deliberately no second
   * mapping to catch the drift. */
  {
    /* The classic drift: a line is dropped from the Python view, so every index
     * below it now lights a different statement. Length happens to stay legal
     * for merge, which is why the out-of-range check alone is not enough. */
    name: 'a line is deleted from pseudoPy, shifting every index below it',
    mutate: (f, s) => f === 'assets/js/sorting-algorithms.js'
      ? s.replace("      '  swapped = False',\n      '  for j in range(n - i - 1):',", "      '  for j in range(n - i - 1):',")
      : undefined,
    expect: 'every live index is pinned, and both arrays say the same operation there',
  },
  {
    /* Subtler than the deletion, and the case that found the gap PINNED left.
     * Both lines swapped here are ones the panel NEVER highlights, so length
     * stays legal and every pinned line stays intact — the first version of this
     * case passed green. It is aimed at the structural check, not the pinned one,
     * because that is the assertion that can actually see it. */
    name: 'two never-highlighted pseudoPy lines are swapped, keeping the length identical',
    mutate: (f, s) => f === 'assets/js/sorting-algorithms.js'
      ? s.replace("      '  min_idx = i',\n      '  for j in range(i + 1, n):',", "      '  for j in range(i + 1, n):',\n      '  min_idx = i',")
      : undefined,
    expect: 'both arrays carry the same KIND of statement at every shared index',
  },
  {
    /* And the counterpart on the lines the panel DOES highlight, so the pinned
     * table is still proven able to fail on its own. Swapping 3 and 4 in bubble
     * also satisfies the structural rule — `if` and `swap` move together — so
     * only the pinned content check can catch this one. */
    name: 'two highlighted pseudoPy lines are swapped, keeping the roles intact too',
    mutate: (f, s) => f === 'assets/js/sorting-algorithms.js'
      ? s.replace("      '    if arr[j] > arr[j + 1]:',\n      '      swap(arr[j], arr[j + 1])',", "      '      swap(arr[j], arr[j + 1])',\n      '    if arr[j] > arr[j + 1]:',")
      : undefined,
    expect: 'every live index is pinned, and both arrays say the same operation there',
  },
  {
    /* LineFor points past the end of ONE array only. Nothing about this is
     * visible in the default view, which is why it needs a checker rather than
     * an eye. */
    name: 'lineFor is widened by one and overflows pseudoPy on the longest algorithm',
    mutate: (f, s) => f === 'assets/js/sorting-algorithms.js'
      ? s.replace("      if (ev.t === 'compare' || ev.t === 'write') return 4;", "      if (ev.t === 'compare' || ev.t === 'write') return 6;")
      : undefined,
    expect: 'live lineFor indices are in range for BOTH pseudo and pseudoPy',
  },
  {
    /* A line left unconverted — the failure mode of anyone editing this file by
     * hand, and the one a reader would hit as 「this is not Python」. */
    name: 'a generic-pseudocode arrow survives in pseudoPy',
    mutate: (f, s) => f === 'assets/js/sorting-algorithms.js'
      ? s.replace("      '    j -= 1',", "      '    j ← j-1',")
      : undefined,
    expect: 'pseudoPy carries no generic-pseudocode glyphs',
  },
  {
    /* Both picker entries pointing at one array: every other check still passes,
     * because there is only ever one array to be right about. The Python button
     * renders the generic pseudocode, correctly, forever. */
    name: 'both languages read the same array, so Python renders the generic view',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace("{ id: 'py', label: 'Python', field: 'pseudoPy' },", "{ id: 'py', label: 'Python', field: 'pseudo' },")
      : undefined,
    expect: "the page offers exactly two pseudocode languages",
  },
  {
    /* The mid-run switch that repaints without re-highlighting: the panel keeps
     * tracking the run numerically and stops naming the executing line, which is
     * the only reason it exists. */
    name: 'switching language drops the current highlight mid-run',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace('          highlightPseudo(state.algo, single.run?.events[single.run.cursor - 1]);\n', '')
      : undefined,
    expect: 'switching language re-renders AND re-applies the current highlight',
  },
  {
    /* The bug the CDP probe found and the shape test above missed: `syncUrl`
     * wrote the literal `'py'` while the reader validated against
     * `['pseudo','python']`. Two true assertions, one broken feature. */
    name: 'syncUrl writes a hardcoded lang literal that the reader does not accept',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace("if (state.lang !== PSEUDO_LANGS[0].id) p.set('lang', state.lang); else p.delete('lang');", "if (state.lang === 'python') p.set('lang', 'py'); else p.delete('lang');")
      : undefined,
    expect: 'the language is read from and written back to the URL using ONE vocabulary',
  },
  {
    /* `?lang=py` is how a reader's choice survives a share link. Reading it is
     * what fails when only the READ is removed. */
    name: 'the page stops reading ?lang=py back out of the URL',
    mutate: (f, s) => f === 'sorting.html'
      ? s.replace("lang: pick(params.get('lang'), PSEUDO_LANGS.map(l => l.id), PSEUDO_LANGS[0].id),", "lang: PSEUDO_LANGS[0].id,")
      : undefined,
    expect: 'the language is read from and written back to the URL using ONE vocabulary',
  },
];

const t0 = Date.now();
for (const c of cases) {
  let dir;
  try {
    dir = makeTree(c.mutate, { strip: true });
    const { code, out } = run(dir);
    /* A checker that reports NO assertion at all is not "failed for the wrong
     * reason" — it did not run. §4 calls this out for the loader-error case, and this
     * harness hit it for real while being written: a syntax error in the checker
     * (nested backticks inside a template literal in a detail message) made all 26
     * cases report "failed, but not on the assertion it claims" with empty output,
     * which reads as 26 mislabelled detectors rather than one broken file. Distinguishing
     * the two is mechanical: a real mislabel prints the checker's own FAIL line. */
    if (code !== 0 && !/\bFAIL\b/.test(out)) {
      const first = out.split('\n').filter(Boolean).slice(0, 3).join(' | ');
      fail(`${c.name} — the checker produced NO assertion (exit ${code}), so this case measured nothing. First output: ${first}`);
    } else if (code === 0) {
      fail(`${c.name} — the checker PASSED, so the guard does not exist`);
    } else if (caughtBy(out, c.expect)) {
      pass(c.name);
    } else {
      fail(`${c.name} — failed, but not on the assertion it claims.\n    expect: ${c.expect}\n    output:\n${out.split('\n').filter(l => /FAIL|PASS|checks/.test(l)).map(l => '      ' + l).join('\n')}`);
    }
  } catch (e) {
    fail(`${c.name} — harness error: ${e.message}`);
  } finally {
    if (dir) releaseTree(dir);
  }
}

console.log(`\n  ${cases.length} cases, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (failures) {
  console.log(`\nFAIL  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\nPASS  every negative case failed for its own reason');