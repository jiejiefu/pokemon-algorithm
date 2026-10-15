/**
 * Will every assertion go red? — the mutation suite for check_cry_game.mjs.
 *
 *   node scripts/test_check_cry_game.mjs
 *
 * This one is cheaper than its sibling and for a different reason. The page
 * checker reads four files off disk and its assertions are all SHAPE claims —
 * a selector prefix, a mount in the HTML, a writer count — so a case costs one
 * `node` spawn of a checker that reads 60 KB, not a browser and not a 1,025 x
 * 1,025 sweep. Thirty-odd cases land around four seconds.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT COVER, AND WHY THAT IS NOT A GAP IN THE HARNESS
 * ---------------------------------------------------------------------------
 *
 * **None of the four defects this page shipped with are reachable from here**,
 * and it is worth being exact about why, because the temptation is to write cases
 * that "should" catch them:
 *
 *   - the round ended one question early, so question 10 never happened
 *   - saved picks restored as nothing, so a reloaded round started over
 *   - `findIndex`'s -1 answer falling into the mid-round branch
 *   - the waveform blank until the decode resolved
 *
 * Every one of them is a page that is *correctly shaped* and behaves wrongly. A
 * mutation harness proves that a change to the source is noticed; these were
 * never changes to the source, they were bugs in source that had never been
 * wrong in any way a shape assertion can see. The fix for that class is a
 * browser, and the page was driven in one before being called done — which is
 * also why `check_cry_game.mjs` ends with a section that pins the four by name,
 * so the SECOND occurrence is at least caught by a shape assertion.
 *
 * A case that cannot fail is worse than no case: it reports a sweep it never ran.
 * So this file only declares cases that genuinely go red, and the two no-op
 * experiments found while writing it are recorded at the bottom rather than
 * deleted.
 */

import { mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { caughtBy, failLines } from './lib/negative.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';
import { pool, defaultPool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_cry_game.mjs';

/* ALL of `assets/js`, not a hand-picked few — §3.B2's reason, and it cost this
 * harness its first run. The checker reads `assets/js/daily-pick.js` to assert
 * that `taipeiDateKey` really does dereference its argument, and the module
 * imports it, so a tree without it died on ERR_MODULE_NOT_FOUND: exit 1, zero
 * assertions run, and every case "going red" while proving nothing. A named list
 * of files is a second thing to keep right; the directory is not. */
const JS_TREE = readdirSync(join(ROOT, 'assets/js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `assets/js/${f}`);

const SRC = [
  'cry-game.html',
  'assets/css/cry-game.css',
  // The checker reads shared.css to learn which row-layout modifiers EXIST, which
  // is the assertion that caught this page carrying a `header-cries` that no rule
  // ever defined. A scratch tree without it gets an empty list, and the
  // membership check passes against nothing — a §3.B2 shape one level up.
  'assets/css/shared.css',
  // The three sibling 叫聲 pages, because the checker asserts this page's header
  // modifier is the SAME one they use — read out of those files rather than
  // remembered, so a fourth invented name for one group cannot pass. A scratch
  // tree without them dies on ENOENT, and ENOENT is not a FAIL line.
  'cries.html',
  'spectrum.html',
  'cries-gen1.html',
  ...JS_TREE,
  CHECKER,
];

/** Break one file, and THROW when the target string is absent. */
const edit = (dir, rel, from, to) => {
  const p = join(dir, rel);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`mutation target not found in ${rel}: ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
};
const editHtml = (dir, from, to) => edit(dir, 'cry-game.html', from, to);
const editCss = (dir, from, to) => edit(dir, 'assets/css/cry-game.css', from, to);
const editJs = (dir, from, to) => edit(dir, 'assets/js/cry-game.js', from, to);

const CASES = [
  {
    name: 'baseline — an unmutated tree still passes',
    mutate: () => {},
    expect: null,
  },

  /* ---- The header. §3.G2's shape, twice. ---- */
  {
    name: 'the row-layout modifier is dropped, so the header renders the mobile column',
    mutate: (dir) => editHtml(dir, 'class="header header-colors"', 'class="header"'),
    expect: 'the header carries exactly one row-layout modifier',
  },
  {
    /* `initThemeToggle()` guards on `.icon-sun`, so a hardcoded pair of ANY other
     * class satisfies nothing: the canonical pair is injected as well and the
     * button ends up with four children in a 34px grid box. */
    name: 'the theme toggle ships a hand-drawn icon pair, so the runtime injects a second one',
    mutate: (dir) => editHtml(dir,
      '<button class="theme-toggle" type="button" aria-pressed="false" aria-label="淺色主題" title="淺色主題"></button>',
      '<button class="theme-toggle" type="button" aria-pressed="false"><svg class="my-sun"></svg><svg class="my-moon"></svg></button>'),
    expect: 'the theme toggle ships with no child elements',
  },
  {
    /* `check_nav_pages.mjs` reads this off the HTML by design — a grep over
     * `assets/js` cannot answer "which pages mount the nav". So an external
     * module would pass the import and fail the mount, and the failure is an
     * empty nav container rather than an exception. */
    name: 'the header mount moves into the page module, where the HTML check cannot see it',
    mutate: (dir) => {
      editHtml(dir, "import { initHeaderNav, initThemeToggle } from './assets/js/shared.js';\n    initThemeToggle();\n    initHeaderNav('cry-game.html');",
        "import { initHeaderNav, initThemeToggle } from './assets/js/shared.js';\n    initThemeToggle();");
      editJs(dir, "async function init() {", "async function init() {\n  initHeaderNav('cry-game.html');");
    },
    expect: "and initHeaderNav('cry-game.html') with its own filename",
  },
  {
    name: 'the mount loses its filename argument, so aria-current can never be claimed',
    mutate: (dir) => editHtml(dir, "initHeaderNav('cry-game.html');", 'initHeaderNav();'),
    expect: "and initHeaderNav('cry-game.html') with its own filename",
  },
  {
    /* The comment six lines above the call names initThemeToggle() too, so a
     * bare-name match is satisfied by the explanation. */
    name: 'the initThemeToggle() call is commented out',
    mutate: (dir) => editHtml(dir, '    initThemeToggle();\n', '    // initThemeToggle();\n'),
    expect: 'it calls initThemeToggle()',
  },
  {
    name: 'the theme script becomes an external one, which is deferred and paints first',
    mutate: (dir) => editHtml(dir, '  <script>\n    (function () {\n      var theme', '  <script src="theme.js">\n    (function () {\n      var theme'),
    expect: 'and it is an inline <script> with no src',
  },

  /* ---- §3.M: the `[hidden]` pairing. ---- */
  {
    name: 'one [hidden] pairing is deleted, so the element paints while hidden',
    mutate: (dir) => editCss(dir, '.cg-hint-row[hidden] { display: none; }\n\n', ''),
    expect: 'and every one of those has a `.class[hidden] { display: none }` rule',
  },
  {
    /* §3.S's false positive, from the other side: a pairing rule that does not
     * declare `display: none` satisfies a substring search and does nothing. */
    name: 'a pairing rule is emptied, leaving a selector with no declaration in it',
    mutate: (dir) => editCss(dir, '.cg-target-foot[hidden] { display: none; }', '.cg-target-foot[hidden] { }'),
    expect: 'every pairing rule really declares display: none',
  },
  {
    /* THE INVERSE OF §3.M, and it cost this page its 下一題 button on the first
     * browser run: clearing `style.display` says nothing about the `hidden`
     * ATTRIBUTE the UA sheet is still acting on. */
    name: 'setRevealed() clears the display but leaves the hidden attribute, so nothing ever reappears',
    mutate: (dir) => editJs(dir, '  node.hidden = !on;\n  node.style.display = on ? \'\' : \'none\';',
      '  node.style.display = on ? \'\' : \'none\';'),
    expect: 'setRevealed() writes BOTH the display and the hidden attribute',
  },
  {
    name: 'a second function writes .style.display, so a panel is visible or hidden by whichever ran last',
    mutate: (dir) => editJs(dir, 'function renderHint(playing) {', 'function renderHint(playing) {\n  els.hintRow.style.display = playing ? \'\' : \'none\';'),
    expect: 'and exactly ONE function in the page writes .style.display',
  },

  /* ---- The live region. ---- */
  {
    name: 'answer() writes the region directly, so two writers race for one announcement',
    mutate: (dir) => editJs(dir, '  lastAnnouncement = correct', '  els.player.textContent = `x`;\n  lastAnnouncement = correct'),
    expect: 'and the region has exactly two writers',
  },
  {
    name: 'a third live region is added, so a reader has two places to look for the outcome',
    mutate: (dir) => editHtml(dir, '<p class="cg-progress" id="cg-progress"></p>',
      '<p class="cg-progress" id="cg-progress" aria-live="polite"></p>'),
    expect: 'the page has exactly ONE live region',
  },

  /* ---- §3.I: the node capture. ---- */
  {
    name: 'each option card gets its own listener, so a re-rendered card stops working',
    mutate: (dir) => editJs(dir,
      '  els.choices.innerHTML = html;\n  for (const btn of els.choices.children) btn.disabled = !playing;',
      '  els.choices.innerHTML = html;\n  for (const btn of els.choices.children) { btn.disabled = !playing; btn.addEventListener(\'click\', () => answer(Number(btn.dataset.option))); }'),
    expect: 'and no listener is attached to an option card',
  },
  {
    name: 'the play glyph is rebuilt with innerHTML, destroying the node its own click target was',
    mutate: (dir) => editJs(dir, '  els.play.setAttribute(\'aria-label\', playing ? \'停止播放\' : \'播放這一段叫聲\');',
      '  els.play.innerHTML = playing ? \'||\' : \'&#9654;\';\n  els.play.setAttribute(\'aria-label\', playing ? \'停止播放\' : \'播放這一段叫聲\');'),
    expect: 'no control on this page rebuilds its own contents',
  },
  {
    /* §3.W's hint-bar defect one level up: the button's contents are rewritten
     * and the child that carried the progress is destroyed. */
    name: 'the hint button rebuilds its label with innerHTML',
    mutate: (dir) => editJs(dir,
      "  els.hintBtn.textContent = state.hintUsed ? '這一題已用過提示' : '排除一個選項';",
      "  els.hintBtn.innerHTML = state.hintUsed ? '這一題已用過提示' : '排除一個選項';"),
    expect: 'no control on this page rebuilds its own contents',
  },

  /* ---- §3.B1: the page prefix. ---- */
  {
    name: 'a cry-game rule claims a colour-game selector',
    mutate: (dir) => editCss(dir, '.cg-page {', '.gm-page {'),
    expect: 'every one of the',
  },
  {
    name: 'cry-game.css acquires a .cy- rule, which is cries.html\'s to own',
    mutate: (dir) => editCss(dir, '.cg-note {', '.cy-note {'),
    expect: 'cry-game.css contains no .cy- rule',
  },

  /* ---- §3.B1 again, and §3.W's white-on-white bug. ---- */
  {
    /* ONE value cannot serve both themes: the `--rule-*` tokens are `:root`-level
     * and identical in both, and no cyan clears 4.5:1 against both a white card
     * and a `#161e38` one. An existence check passes on the single-value version
     * and leaves the defect in place — so the assertion is that they DIFFER. */
    name: 'both themes get the same accent, which is how colour-game rendered white on white',
    mutate: (dir) => editCss(dir, '[data-theme="light"] .cg-page {\n  --cg-accent: #0e7490;',
      '[data-theme="light"] .cg-page {\n  --cg-accent: #4cc9f0;'),
    expect: 'and the two values DIFFER',
  },
  {
    name: 'the light-theme accent declaration is removed entirely',
    mutate: (dir) => editCss(dir, '[data-theme="light"] .cg-page {\n  --cg-accent: #0e7490;\n}\n\n', ''),
    expect: '--cg-accent is declared once per theme',
  },

  /* ---- The card geometry. §3.W's flush bar. ---- */
  {
    name: 'the card gets its padding back, leaving an 8px band between the wave and the edge',
    mutate: (dir) => editCss(dir, '.cg-target {\n  padding: 0;', '.cg-target {\n  padding: 16px;'),
    expect: '.cg-target has padding: 0',
  },
  {
    name: 'the type band\'s segments go back to flex-basis auto, so they collapse to their borders',
    mutate: (dir) => editCss(dir, '.cg-choice-types span {\n  flex: 1 1 0;', '.cg-choice-types span {\n  flex: 1 1 auto;'),
    expect: "the type band's segments are flex: 1 1 0",
  },
  {
    /* Two readers' share rows are only comparable if they are the same SHAPE on
     * different screens, so the ten columns must not be reflowed at a
     * breakpoint. */
    name: 'a breakpoint rewrites the share grid to four columns',
    mutate: (dir) => editCss(dir, '  .cg-cell { font-size: 13px; }', '  .cg-grid { grid-template-columns: repeat(4, 1fr); }\n  .cg-cell { font-size: 13px; }'),
    expect: 'and no media query redefines it',
  },

  /* ---- The nameless-until-answered decision. ---- */
  {
    /* The reference prints the name on every card, which makes the game a memory
     * test. This is the claim that it does not, and an absence test is the only
     * form it can take. */
    name: 'the name is written on every card, turning recognition back into recall',
    mutate: (dir) => editJs(dir, "const name = state.revealed ? escapeHtml(p.names.zh) : '';", "const name = escapeHtml(p.names.zh);"),
    expect: 'the name is written only when state.revealed',
  },
  {
    name: 'the option sprite becomes the 475px artwork, which is not the render the cry was measured beside',
    mutate: (dir) => editJs(dir, 'spriteUrl(id)', 'artworkUrl(id)'),
    expect: 'and never the 475px official artwork',
  },

  /* ---- The autoplay switch. §3.G: one preference, one piece of markup. ---- */
  {
    name: 'the switch is reimplemented as a local checkbox, so the site-wide preference is a second thing',
    mutate: (dir) => {
      editJs(dir, "import { mountAutoplay } from './cry-autoplay.js';", '');
      editJs(dir, '  autoplay = mountAutoplay(els.autoplaySlot, {\n    className: \'cg-autoplay\',',
        '  els.autoplaySlot.innerHTML = \'<input type="checkbox" checked>\';\n  autoplay = { get on() { return true; }, set() {} };\n  if (0) mountAutoplay(els.autoplaySlot, {\n    className: \'cg-autoplay\',');
    },
    expect: 'the page imports mountAutoplay from cry-autoplay.js',
  },
  {
    /* The module builds its markup from `className`, so cries.css's
     * `.cy-autoplay` rules cannot reach a switch mounted as `cy-autoplay` here —
     * and §3.B1 says this page's rules are its own. */
    name: 'the switch is mounted with cries.html\'s class prefix, so cry-game.css styles none of it',
    mutate: (dir) => editJs(dir, "className: 'cg-autoplay',", "className: 'cy-autoplay',"),
    expect: "with a `cg-` className",
  },
  {
    name: 'the slot is given content in the markup, which mountAutoplay never removes',
    mutate: (dir) => editHtml(dir,
      '<div class="cg-autoplay-slot" id="cg-autoplay-slot"></div>',
      '<div class="cg-autoplay-slot" id="cg-autoplay-slot"><span>舊的開關</span></div>'),
    expect: 'the slot div is empty in the markup',
  },
  {
    /* THE MEASURED ONE. `cryPlayer.play()` with no prior gesture leaves the
     * promise PENDING forever — three seconds measured, no rejection, onStart
     * never fires. Removing the guard turns the flag from load-bearing into a
     * nicety and the page starts calling a play that can only hang. */
    name: 'the activation guard is dropped, so the page attempts plays the browser can never resolve',
    mutate: (dir) => editJs(dir,
      '  if (!autoplay || !autoplay.on || !audioUnlocked) return;',
      '  if (!autoplay || !autoplay.on) return;'),
    expect: 'refuses unless the switch is on AND the document has been activated',
  },
  {
    name: 'the unlock listener is a bubble-phase one, so a swallowed first click disables autoplay forever',
    mutate: (dir) => editJs(dir, "document.addEventListener('click', once, true);", "document.addEventListener('click', once);"),
    expect: 'the unlock is a CAPTURE-phase one-shot listener',
  },
  {
    /* `renderAll()` runs on a theme flip, a resize and every state write. */
    name: 'renderAll() auto-plays, so a theme change replays the cry',
    mutate: (dir) => editJs(dir, '  renderFoot();\n  lastAnnouncement = null;', '  renderFoot();\n  lastAnnouncement = null;\n  maybeAutoPlay();'),
    expect: 'renderAll() does not auto-play',
  },
  {
    /* THE ORDER IS REVERSED, NOT A CALL REMOVED. The first version of this case
     * deleted `installUnlock()`, which left `mountAutoplay()` exactly where it was
     * — so the assertion about ordering stayed green while the case claimed to
     * break it. A case that removes a side effect is not a case about order. */
    name: 'the first round is drawn before the switch is mounted, so question 1 ignores the stored preference',
    mutate: (dir) => editJs(dir,
      '  autoplay = mountAutoplay(els.autoplaySlot, {',
      "  if (!restoreDaily()) newRound();\n  autoplay = mountAutoplay(els.autoplaySlot, {"),
    expect: 'the switch is mounted BEFORE the first round is drawn',
  },

  /* ---- The four the browser found, pinned as shapes. ---- */
  {
    name: 'advance() closes the round from the derived index, ending one question early',
    mutate: (dir) => editJs(dir, 'if (state.answeredAt + 1 >= state.questions.length) {', 'if (state.indexOfCurrent + 1 >= state.questions.length) {'),
    expect: 'advance() closes the round from answeredAt',
  },
  {
    name: 'saved picks are restored by question rather than by position, so a reloaded round starts over',
    mutate: (dir) => editJs(dir, 'const id = (saved.picks || [])[i];', 'const id = (saved.picks || [])[q];'),
    expect: 'restoreDaily() maps the saved picks BY POSITION',
  },
  {
    name: 'the finished-restore case is dropped, so -1 falls into the mid-round branch',
    mutate: (dir) => editJs(dir, '  if (first === -1) {', '  if (first === -99) {'),
    expect: 'restoreDaily() tests `first === -1` FIRST',
  },
  {
    name: 'the waveform placeholder is drawn after the decode, so every question opens on an empty box',
    mutate: (dir) => {
      const body = readFileSync(join(ROOT, 'assets/js/cry-game.js'), 'utf8');
      const start = body.indexOf('  const placeholder = document.createElement');
      const at = body.indexOf('  paintWave(placeholder);');
      void start; void at;
      editJs(dir, '  paintWave(placeholder);\n', '');
    },
    expect: 'loadWave() draws a flat placeholder BEFORE awaiting the decode',
  },
  {
    name: 'paintWave reads a .canvas off the wrapper it is handed, so the waveform never draws',
    mutate: (dir) => editJs(dir, 'ctx.drawImage(source, 0, 0);', 'ctx.drawImage(source.canvas, 0, 0);'),
    expect: 'paintWave() blits the element it is given',
  },

  /* ---- §3.B1 on the module boundary. ---- */
  {
    name: 'the page names the cry set instead of reading it, so it can play a set the index did not measure',
    mutate: (dir) => editJs(dir, 'const CRY_SET = FEATURE_SET;', "const CRY_SET = 'latest';"),
    expect: 'the page reads the cry set from the module',
  },
  {
    name: 'the page reaches for a random number of its own, which no shape check can then cover',
    mutate: (dir) => editJs(dir, '  state.questions = state.mode === \'daily\'', '  state.questions = Math.random() > 2 ? [] : state.mode === \'daily\''),
    expect: 'cry-game.js contains no Math.random',
  },
  {
    name: 'the dossier link is assembled by hand, which is what merges nidoran-f and nidoran-m',
    mutate: (dir) => editJs(dir, 'els.listen.href = pokemonDetailUrl(byId.get(revealedAnswer));',
      "els.listen.href = `detail.html?slug=${byId.get(revealedAnswer).name}`;"),
    expect: 'and never assembles a detail URL by hand',
  },
  {
    name: 'the daily key drops the generation filter, so two filters share one round',
    /* THE TEMPLATE, NOT THE SIGNATURE. The first version dropped the `gen`
     * parameter, which left the call site `dailyKey(state.difficulty, state.gen)`
     * still matching the assertion — two arguments, second ignored, and the key
     * unchanged. Mutating the template is the defect. */
    mutate: (dir) => editJs(dir, '`daily:${difficulty}:${gen}`', '`daily:${difficulty}`'),
    expect: 'the daily key template carries BOTH the difficulty and the generation filter',
  },
  {
    name: 'the generation chips are written into the markup, becoming a second list to keep right',
    mutate: (dir) => editHtml(dir, '<div class="cg-gen-row" id="cg-gen-row" role="radiogroup" aria-labelledby="cg-gen-label"></div>',
      '<div class="cg-gen-row" id="cg-gen-row" role="radiogroup" aria-labelledby="cg-gen-label"><button data-gen="0">全部</button></div>'),
    expect: 'and no chip is written into the markup',
  },
  {
    /* `taipeiDateKey(now)` reads `now.getTime()` with no default, so a bare call
     * is a TypeError. This page called it bare in four places and `newRound()`
     * threw inside `persistDaily()` — no round, no waveform, and a page that
     * looked loaded. */
    name: 'the Taipei day key is called bare again, which is a TypeError rather than a date',
    mutate: (dir) => editJs(dir, 'function todayKey() {\n  return taipeiDateKey(new Date());', 'function todayKey() {\n  return taipeiDateKey();'),
    expect: 'cry-game.js never calls taipeiDateKey() with no argument',
  },
];

// ---------------------------------------------------------------------------

const POOL = defaultPool();
const results = [];

function ok(name, pass, detail = '') {
  results.push({ name, pass });
  if (pass) console.log(`  ok   ${name}`);
  else console.log(`  FAIL ${name}${detail ? `\n${detail}` : ''}`);
}

function makeTree() {
  const dir = mkdtempSync(join(tmpdir(), 'cgpage-neg-'));
  for (const rel of SRC) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(ROOT, rel), dest);
  }
  return trackTree(dir);
}

const run = (rel, cwd) => new Promise((resolve) => {
  execFile(process.execPath, [rel], { cwd, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

async function runCase(i) {
  const c = CASES[i];
  let dir = null;
  try {
    dir = makeTree();
    c.mutate(dir);
    const r = await run(CHECKER, dir);
    if (c.expect === null) {
      const green = r.code === 0;
      return { name: c.name, pass: green, detail: green ? '' : 'expected this no-op mutation to change nothing, and it did not' };
    }
    const named = r.code !== 0 && caughtBy(r.out, c.expect);
    return {
      name: c.name,
      pass: named,
      detail: named ? ''
        : `exit ${r.code}, expected "${c.expect}" on a FAIL line; it said:\n`
          + `${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`,
    };
  } catch (e) {
    return { name: c.name, pass: false, detail: `the mutation itself threw: ${e.message}` };
  } finally {
    if (dir) releaseTree(dir);
  }
}

const finished = await pool(
  CASES.map((_, i) => () => runCase(i)),
  { limit: POOL, onError: (e, i) => ({ name: CASES[i].name, pass: false, detail: `the case threw: ${e.message}` }) }
);
for (const r of finished) ok(r.name, r.pass, r.detail);

ok(`the suite declares every case it runs (${CASES.length})`,
  CASES.every((c) => typeof c.name === 'string' && typeof c.mutate === 'function')
    && CASES.every((c) => c.expect === null || typeof c.expect === 'string'),
  `${CASES.length} cases`);
void basename;

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');