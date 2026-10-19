#!/usr/bin/env node
/**
 * Negative harness for check_moves_page.mjs.
 *
 *   node scripts/test_check_moves_page.mjs
 *
 * ## WHY THIS EXISTS AND WHAT IT IS FOR
 *
 * `check_moves_page.mjs` is 155 assertions about a page that had four shipped
 * defects no text reader can see (§3.AA), which makes it exactly the kind of
 * checker that can be green because its assertions are vacuous rather than
 * because the page is right. Every case below introduces one defect and has to
 * break the checker WITH THAT REASON — not merely break it. `caughtBy()` reads
 * the FAIL block rather than the whole output, because this project's checkers
 * print each assertion's description whether it passes or fails, so a plain
 * substring match would be satisfied by any check whose description happens to
 * contain the expected words.
 *
 * ## THE CASES ARE CHOSEN BY WHERE A VACUOUS ASSERTION CAN HIDDENOT BY WHAT IS
 * INTERESTING ABOUT THE PAGE
 *
 * Four of the twenty below exist because their assertion is currently a
 * substring search, which is the shape §3.P records going green on a perfect
 * page: the `[hidden]` guard, the payload split, the hand-built-URL ban, and the
 * `mv-` prefix sweep. The rest are the claims that would be quietly wrong if a
 * formatter lost a branch — 必中 rendering as 0%, 硬壓's variable power rendering
 * as a dash, `至少 N` collapsing to `N`.
 *
 * ## ANCHORS MUST BE LIVE CODE, NOT PROSE
 *
 * The stale-anchor guard below catches a `String.replace` that matched nothing.
 * It does NOT catch one that matched a COMMENT: the file changes, the guard
 * passes, and the case then reports 「checker exited 0」 for a reason that has
 * nothing to do with the assertion it was written for. `test_check_color_page.mjs`
 * lost a case exactly that way when its anchor `planned: 'moves.html'` outlived
 * the row it named (§3.S). Every anchor below is a line that exists in the file
 * and is load-bearing.
 *
 * ## NO POOL FOR THE DATA FILES' SAKE, BUT POOLED ANYWAY
 *
 * §3.G7: these cases are independent and each is its own `node` process against
 * its own tree, so they go through `lib/pool.mjs` (capped at 4) rather than a
 * `for` loop around `execFileSync`. `pool()` returns results in declaration
 * order and the report is printed after the drain, so two green runs diff.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy, failLines } from './lib/negative.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_moves_page.mjs';

/* Every file the checker OPENS, plus every module its two imports pull in, plus
 * the checker itself so a case can attack an assertion and not only its input.
 *
 * A file missing from this list is an ENOENT that kills the checker before its
 * first assertion, which the harness then reports as twenty-four cases that ran
 * nothing — §4's shape, and the reason both existing harnesses spell their SRC
 * out at length. It bit this file on its first run: `shared.js` imports
 * `form-names.js`, which imports `form-names-zh.js` and `shiny-index.js`, and a
 * tree without the first one dies at module resolution before a single
 * assertion — twenty-four reds that all say ERR_MODULE_NOT_FOUND and none of
 * which tested anything.
 *
 * That closure is DERIVED rather than written by hand for the same reason
 * §4 derives its numbers: a hand-kept import list is a second answer to the same
 * question, and it goes stale the day an import is added. `MODULE_CLOSURE`
 * below walks the two entry points and asserts the copy is complete, so an
 * import added to shared.js turns this harness red at its baseline rather than
 * turning every case into an ENOENT. */
const MODULE_ROOTS = ['assets/js/shared.js', 'assets/js/moves.js'];

function moduleClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(join(ROOT, file))) continue;
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const resolved = join(dirname(file), specifier).replace(/\\/g, '/');
      if (resolved.endsWith('.js')) queue.push(resolved.replace(/^\//, ''));
    }
  }
  return [...seen];
}

const MODULE_CLOSURE = moduleClosure(MODULE_ROOTS);

const SRC = [
  CHECKER,
  'moves.html',
  'move.html',
  'types.html',
  'assets/css/moves.css',
  'assets/data/moves_zh.json',
  'assets/data/move_learners_count.json',
  ...MODULE_CLOSURE,
];

{
  // Cheap and load-bearing: this is the assertion that would have caught the
  // ENOENT above at design time rather than as twenty-four red cases.
  const missing = MODULE_CLOSURE.filter(f => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`harness: the module closure is incomplete — ${missing.join(', ')}`);
    process.exit(1);
  }
  const unlisted = MODULE_CLOSURE.filter(f => !SRC.includes(f));
  if (unlisted.length) {
    console.error(`harness: SRC is missing ${unlisted.join(', ')} — add them or every case ENOENTs`);
    process.exit(1);
  }
}

/*
 * The prefix is INLINED into the template rather than held in a constant, and
 * that is `check_tmp_prefixes.mjs` deciding this file's shape. The scanner
 * derives its allowlist by reading the head of every `mkdtempSync(join(tmpdir(),
 * \`…\`))` template out of the source, and a template whose head is an
 * interpolation is reported UNCLASSIFIED rather than guessed at — so a constant
 * would have produced one red line here and made this file the only one in the
 * suite its scanner cannot account for. §3.J's rule is that the prefix is
 * derived from the source, which only works if it IS the source.
 *
 * `mvpage-neg-` must not collide with another harness's. §3.J's incident was two
 * harnesses picking names in the same family, each checking only the one it knew
 * about; the zero overlapping pairs that scanner asserts is what stops that
 * recurring.
 */

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

function makeTree(mutate) {
  const dir = trackTree(join(tmpdir(), `mvpage-neg-${Math.random().toString(36).slice(2)}`));
  mkdirSync(dir, { recursive: true });
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  /* The pages under test are copies, but shared.js and the CSS resolve their
   * siblings relative to ROOT, and a checker that imports a module which imports
   * another module would ENOENT on the second one. Symlinking every remaining
   * .html proves the harness itself is sound in the baseline run instead of
   * letting each case die on "missing moves.html" — the reason
   * test_check_nav_pages.mjs does the same. */
  for (const f of readdirSync(ROOT)) {
    if (f.endsWith('.html') && !existsSync(join(dir, f))) symlinkSync(join(ROOT, f), join(dir, f));
  }

  if (mutate) {
    for (const f of SRC) {
      const p = join(dir, f);
      const before = readFileSync(p, 'utf8');
      // `undefined` means "not my file". A returned string IDENTICAL to the input
      // is a stale anchor and the case would pass for the wrong reason, so it is
      // an error rather than a no-op.
      const after = mutate(f, before);
      if (after === undefined) continue;
      if (after === before) {
        throw new Error(`mutation for ${f} did not change the file — the anchor is stale, so this case would pass for the wrong reason`);
      }
      writeFileSync(p, after);
    }
  }
  return dir;
}

const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

// Baseline first: an unmutated tree that does not pass means every case below
// is measuring the harness rather than the checker.
{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  code === 0
    ? pass('baseline: the checker passes on an unmutated copy of the tree')
    : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
  releaseTree(dir);
}

const cases = [
  // ---------------------------------------------------------------- §3.A
  {
    name: 'a page that assembles the move URL by hand is not the one place that does it',
    mutate: (f, s) => f === 'moves.html'
      ? s.replace("href=\"${moveUrl(move)}\"", "href=\"move.html?move=${move.en}\"")
      : undefined,
    expect: 'may write a move.html?move=',
  },
  {
    name: 'a hand-assembled species URL loses the nidoran distinction',
    mutate: (f, s) => f === 'move.html'
      ? s.replace('a.href = pokemonDetailUrl(species);', "a.href = `detail.html?slug=${species.names.en}`;")
      : undefined,
    expect: 'must not write a detail URL by hand',
  },

  // ---------------------------------------------------------------- §3.M
  {
    name: 'the [hidden] guard is deleted, so every hidden tab panel keeps its box',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace(/\.mv-panel\[hidden\],\s*\.mv-tabpanel\[hidden\]\s*\{\s*display:\s*none;\s*\}/, '')
      : undefined,
    expect: '.mv-panel[hidden]',
  },
  {
    name: 'the hidden guard keeps the selector and loses the declaration',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace('display: none;', '/* display: none; */')
      : undefined,
    expect: 'must set display: none explicitly',
  },

  // ---------------------------------------------------------------- payload split
  {
    name: 'moves.html loads the 424 KB index to print a number it already has',
    mutate: (f, s) => f === 'moves.html'
      ? s.replace('prepareMoves, filterMoves, loadMoves, loadMoveLearnersCount,',
          'prepareMoves, filterMoves, loadMoves, loadMoveLearnersCount, loadMoveLearners,')
      : undefined,
    expect: 'NOT the full 424 KB reverse index',
  },
  {
    name: 'move.html loads the counts file as well and pays for both',
    mutate: (f, s) => f === 'move.html'
      ? s.replace('loadMoves, loadMoveLearners,', 'loadMoves, loadMoveLearners, loadMoveLearnersCount,')
      : undefined,
    expect: 'not also the counts file',
  },

  // ---------------------------------------------------------------- §3.B2 sentinels
  {
    name: 'accuracy 0 renders as 0% and contradicts the effect text below it',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace("if (accuracy === 0) return '必中';", '')
      : undefined,
    expect: 'accuracy 0 is 必中',
  },
  {
    name: 'hard-press renders its HP-scaling power as a dash',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace("if (move.power === 0 && move.class !== 'status') return '依對手剩餘 HP 變化';", '')
      : undefined,
    expect: '硬壓 is physical with power 0',
  },
  {
    name: 'a status move with power 0 renders as the number 0',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace("if (move.power === 0) return '—';", '')
      : undefined,
    expect: 'power 0 should read as an absence',
  },
  {
    name: 'a null max collapses to its min and 2–5 times becomes 2 times',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace("if (min !== null) return `至少 ${min}${unit}`;", '')
      : undefined,
    expect: 'a null max means',
  },
  {
    name: 'a -7 priority is clamped to a floor the data does not have',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace("return priority > 0 ? `+${priority}` : String(priority);", 'return String(Math.max(priority, -6));')
      : undefined,
    expect: 'must not be clamped',
  },
  // ---------------------------------------------------------------- the union count
  {
    name: 'the total sums four learn methods and 80 becomes 55 species',
    mutate: (f, s) => f === 'move.html'
      ? s.replace('const total = new Set(MOVE_LEARN_METHODS.flatMap(m => slots[m] || [])).size;',
        'const total = MOVE_LEARN_METHODS.reduce((n, m) => n + (slots[m] || []).length, 0);')
      : undefined,
    expect: 'count DISTINCT species',
  },

  // ---------------------------------------------------------------- §3.I
  {
    name: 'a slug-indexed row stops carrying its id and the learner panel goes empty',
    mutate: (f, s) => f === 'move.html'
      ? s.replace('bySlug.set(move.en, { id: Number(id), ...move });', 'bySlug.set(move.en, move);')
      : undefined,
    expect: 'carry the id onto each slug-indexed row',
  },
  {
    name: 'an unknown slug falls back to a real move instead of saying so',
    mutate: (f, s) => f === 'move.html'
      ? s.replace('if (!move) {', 'if (false) {')
      : undefined,
    expect: 'check it resolved',
  },

  // ---------------------------------------------------------------- §3.B1
  {
    name: 'a rule in moves.css loses its mv- prefix and becomes every page\'s business',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace('.mv-learners-grid {', '.learners-grid {')
      : undefined,
    expect: 'mv- prefixed',
  },
  {
    name: 'the error state names a token only types.html declares',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace('.mv-status.is-error { color: var(--error-text); }', '.mv-status.is-error { color: var(--chart-bad-text); }')
      : undefined,
    expect: 'chart token',
  },
  {
    name: 'the page mounts detail.css and inherits another page\'s move-table geometry',
    mutate: (f, s) => f === 'moves.html'
      ? s.replace('<link rel="stylesheet" href="assets/css/moves.css">',
        '<link rel="stylesheet" href="assets/css/detail.css">\n  <link rel="stylesheet" href="assets/css/moves.css">')
      : undefined,
    expect: 'should mount detail.css',
  },

  // ---------------------------------------------------------------- the deep link
  {
    name: 'a filter is not addressable and the deep link arrives unfiltered',
    mutate: (f, s) => f === 'moves.html'
      ? s.replace("params.get('type') || null", "null")
      : undefined,
    expect: 'should read ?type= from the URL',
  },
  {
    name: 'types.html stops sending its reader to the move list it filtered',
    mutate: (f, s) => f === 'types.html'
      ? s.replace('moves.html?type=${slug}', 'moves.html')
      : undefined,
    expect: 'should link to the per-type move list',
  },

  // ------------------------------------------- types.html's roster: MECHANISM
  //
  // Eight assertions with no case would be a number nobody can check, and this
  // file's own header says the cases are chosen BY WHERE A VACUOUS ASSERTION CAN
  // HIDE. All eight below are new, so all eight get one.
  {
    name: 'the roster card stops filling its grid track — the 60px-in-96.7px defect',
    mutate: (f, s) => f === 'types.html'
      ? s.replace('.chip-grid--roster .chip-item {\n      flex: 1;\n', '.chip-grid--roster .chip-item {\n')
      : undefined,
    expect: 'fill the grid track it is placed in',
  },
  {
    name: 'the roster card puts the name back beside the image',
    mutate: (f, s) => f === 'types.html'
      ? s.replace('      flex: 1;\n      flex-direction: column;\n', '      flex: 1;\n')
      : undefined,
    expect: 'should stack its image above its name',
  },
  {
    name: 'the roster grid loses its modifier and starts styling all three blocks',
    mutate: (f, s) => f === 'types.html'
      ? s.replace(/^(\s*)\.chip-grid--roster \{$/m, '$1.chip-grid {')
      : undefined,
    expect: 'should scope the rule that turns the roster into a grid behind a --roster modifier',
  },
  {
    name: 'the equal-width declarations leak onto the shared .chip-item, flattening 招式 and 特性',
    // Added to the shared rule rather than MOVED off the roster's: renaming the
    // roster's own header would take `flex-direction: column` with it and trip a
    // different assertion, which is a caught mutation but not proof that the
    // shared-rule guard is the thing doing the catching.
    mutate: (f, s) => f === 'types.html'
      ? s.replace('    .chip-item {\n      display: inline-flex;\n',
        '    .chip-item {\n      flex: 1;\n      flex-direction: column;\n      display: inline-flex;\n')
      : undefined,
    expect: 'must not carry flex or flex-direction',
  },
  {
    name: 'the roster image goes back to stretching the 120x112 art',
    mutate: (f, s) => f === 'types.html'
      ? s.replace('.chip-grid--roster .chip-item img { object-fit: contain; }',
        '.chip-grid--roster .chip-item img { object-fit: fill; }')
      : undefined,
    expect: 'should scale without distorting',
  },
  {
    name: 'the offset reverts to the single-sample -23% it was measured off',
    mutate: (f, s) => f === 'types.html'
      ? s.replace('translateY(-25%)', 'translateY(-23%)')
      : undefined,
    expect: 'should be the measured 25%',
  },

  // ---------------------------------------------------------------- search
  {
    name: 'the search haystack is rebuilt per keystroke instead of once per row',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace("if (needle && !move.haystack.includes(needle)) return false;",
        "if (needle && !moveSearchText(move).includes(needle)) return false;")
      : undefined,
    expect: 'read the precomputed haystack',
  },
  {
    name: 'the learnable filter keeps only its true branch and 137 rows look learnable',
    mutate: (f, s) => f === 'assets/js/moves.js'
      ? s.replace('if (learnable === false && moveIsLearnable(move)) return false;', '')
      : undefined,
    expect: 'learnable:false',
  },

  // ---------------------------------------------------------------- the artwork
  {
    name: 'the SV branch is deleted and every card falls back to the 96px sprite',
    mutate: (f, s) => f === 'move.html'
      ? s.replace('const src = sv ? svUrl(species.id) : ASSETS.sprites + species.filename;',
        'const src = ASSETS.sprites + species.filename;')
      : undefined,
    expect: 'should ask whether the artwork exists BEFORE building the src',
  },
  {
    name: 'object-fit without object-position scales the art to fill and lifts it off the baseline',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace('  object-position: bottom;\n', '')
      : undefined,
    expect: 'and be pinned to the bottom',
  },
  {
    name: 'a vertical offset is added to line the SV art up with a name that is on another row',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace('.mv-learner img {', '.mv-learner.is-sv img { transform: translateY(-25%); }\n.mv-learner img {')
      : undefined,
    expect: 'should NOT lift the SV artwork',
  },
  {
    name: 'nearest-neighbour is turned back on for two image sets that are drawn down',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace('  object-fit: contain;', '  object-fit: contain;\n  image-rendering: pixelated;')
      : undefined,
    expect: 'should declare no image-rendering',
  },

  // ---------------------------------------------------------------- the type chips
  {
    name: 'the type chips lose the colour and become three identical neutral rows',
    mutate: (f, s) => f === 'assets/css/moves.css'
      ? s.replace(/\.mv-chip--type\s*\{[^}]*\}[\s\S]*?--mv-type-ink\);\n/, '')
      : undefined,
    expect: 'should declare both the type modifier and its dot',
  },
  {
    name: 'the type chip text goes back to spelling 屬性 eighteen times',
    mutate: (f, s) => f === 'moves.html'
      ? s.replace('return TYPE_EN_ZH[capitalize(slug)] || slug;', "return (TYPE_EN_ZH[capitalize(slug)] || slug) + '屬性';")
      : undefined,
    expect: 'should not append 屬性',
  },
];

console.log(`\n${cases.length} negative cases, each must exit non-zero AND name its reason\n`);

const verdicts = await pool(cases.map(c => async () => {
  let dir;
  try {
    dir = makeTree(c.mutate);
  } catch (e) {
    return { name: c.name, detail: `harness: ${e.message}` };
  }
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    releaseTree(dir);
  }
  if (code === 0) return { name: c.name, detail: 'checker exited 0 — the invariant is not actually policed' };
  if (!caughtBy(out, c.expect)) {
    return {
      name: c.name,
      detail: `exited ${code} but no FAIL line reported "${c.expect}"; it said:\n${failLines(out).map((l) => `      ${l.trim()}`).join('\n') || '      (no FAIL line at all)'}`,
    };
  }
  return { name: c.name, detail: '' };
}));

for (const v of verdicts) v.detail ? fail(`${v.name}\n    ${v.detail}`) : pass(v.name);

console.log();
if (failures) {
  console.log(`${failures} of ${cases.length} negative case(s) did not hold`);
  process.exit(1);
} else {
  console.log(`all ${cases.length} negative cases held: each broke the checker with the right reason`);
}