/**
 * maze.html + maze-pathfinding.js regression test
 *
 *   node scripts/check_maze_page.mjs
 *
 * The page shipped without a checker, so a TypeError inside a rAF callback
 * ended every successful patrol after the search. The trigger was a missing
 * `cost` on `starRun`'s result, which the page then passed to `.toFixed()`.
 * `starRun` lives in the module so it can be imported and run (§3.F).
 *
 * Two halves:
 *   BEHAVIOURAL — imports the real `starRun` and runs it over fake grids of
 *   plain `{x, y}` objects. This half catches the crash and proves the four
 *   legs interleave.
 *   SHAPE — reads maze.html for the wiring the page owns: marker point sets,
 *   `runKind` resets, and the canvas accessible name.
 *
 * The fake grids carry no `walls` or `terrainCost`, which is why the engine
 * stays graph-generic: the patrol runs without constructing 1,600 Cells.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  bfsSolve, dfsSolve, dijkstraSolve, astarSolve, SOLVERS,
  starRun, PATROL_LEGS, largestComponent,
  manhattanHeuristic, octileHeuristic,
} from '../assets/js/maze-pathfinding.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'maze.html'), 'utf8');
const ENGINE = readFileSync(join(ROOT, 'assets/js/maze-pathfinding.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'assets/css/algo.css'), 'utf8');
const SHARED = readFileSync(join(ROOT, 'assets/css/shared.css'), 'utf8');

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, eq } = C;

function section(name) {
  console.log(`\n--- ${name}`);
}

/* Masks comments and string literals to blanks, preserving offsets so reported
 * line numbers stay correct. Needed because the docblock explaining why the
 * engine must not touch `searchVisited` has to name that token; a raw grep
 * would match its own justification. Masked characters become spaces rather
 * than being deleted, so an index into the masked text is still an index into
 * the original.
 *
 * JAVASCRIPT ONLY. maze.html is markup: its prose and `href`s are not strings,
 * so this masker would open a quote on an apostrophe and never close it. The
 * HTML assertions below scope themselves to a function body instead. */
function maskCommentsAndStrings(src) {
  const out = new Array(src.length).fill(' ');
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== '*/') {
        if (src[i] === '\n') out[i] = '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    out[i] = ch;
    i += 1;
  }
  return out.join('');
}

const ENGINE_CODE = maskCommentsAndStrings(ENGINE);

/**
 * Returns the source of one block, by brace-matching from the first `{` after
 * `startMarker`. Null when the marker is absent.
 *
 * A regex such as `/function setMode[\s\S]*?…/` runs to end of file, so a
 * `setRunKind('single')` a hundred lines later satisfies it. Deleting the real
 * one then leaves the suite green — §3.B2's vacuity with the roles reversed.
 * A detector that cannot fail reads as coverage.
 *
 * Known limit: this counts braces without understanding strings or regex
 * literals, so a `{` inside a string literal inside the block would mis-count.
 * maze.html's script has none unbalanced (its template `${…}` holes all close),
 * and a mis-count fails loudly — the assertion sees the wrong slice — rather
 * than silently passing.
 */
function blockAfter(src, startMarker) {
  const at = src.indexOf(startMarker);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

/** A block, asserting it exists — a missing function must not read as "no
 *  violation found". */
function blockOf(src, startMarker, name) {
  const body = blockAfter(src, startMarker);
  ok(body !== null, `${name} was located in maze.html`);
  return body ?? '';
}

const B_START_SEARCH = blockOf(HTML, 'function startSearch(algoId, star)', 'startSearch');
const B_SET_MODE = blockOf(HTML, 'function setMode(next)', 'setMode');
const B_CONTRAST = blockOf(HTML, "contrastRange.addEventListener('input'", 'the contrast slider handler');
const B_LOAD = blockOf(HTML, 'async function loadPokemonMaze(requestedId)', 'loadPokemonMaze');
const B_STOP_RUN = blockOf(HTML, 'function stopRun()', 'stopRun');
const B_TICK = blockOf(HTML, 'function tick()', 'tick');
const B_FINISH = blockOf(HTML, 'function finishSearch(result)', 'finishSearch');
const B_STAR_POINTS = blockOf(HTML, 'function starPoints()', 'starPoints');
const B_SET_RUN_KIND = blockOf(HTML, 'function setRunKind(next)', 'setRunKind');
/** The brace-matched block of the first `if` whose HEAD matches `headRe`.
 *
 * A lazy `[\s\S]*?return false;` span runs past the closing brace into the next
 * branch, so deleting the refusal from any one of decideSeed's three error
 * branches left the suite green — twice, each time satisfied by a sibling.
 * Every refusal is bounded to its own braces. */
function ifBlock(src, headRe) {
  const m = headRe.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

const B_DRAW_MARKERS = blockOf(HTML, 'function drawMarkers()', 'drawMarkers');
const B_ARIA = blockOf(HTML, 'const ARIA_LABEL =', 'ARIA_LABEL');

/* --- Two features added after the first run of this checker. Each had a bug
 * that a source assertion pins down in one line.
 *
 * `loadPokemonMaze` used to roll its own `Math.random()` seed before the carve,
 * so 固定種子 (fixed seed) could not work and 換種子 (new seed) announced a seed
 * the next load overwrote. The carve was always deterministic; the guarantee
 * was unreachable. */
const B_LOAD_MAZE = blockOf(HTML, 'async function loadPokemonMaze(requestedId)', 'loadPokemonMaze');
const B_DECIDE_SEED = blockOf(HTML, 'function decideSeed()', 'decideSeed');
const B_ROLL_SEED = blockOf(HTML, 'function rollSeed()', 'rollSeed');
const B_REROLL = blockOf(HTML, 'function rerollSeed()', 'rerollSeed');
const B_CARVE = blockOf(HTML, 'function carveMaze()', 'carveMaze');
const B_UNVISITED = blockOf(HTML, 'function unvisitedNeighbours(c)', 'unvisitedNeighbours');
const B_CELL_DRAW = blockOf(HTML, 'draw() {', 'Cell.draw');
const B_SET_LIT = blockOf(HTML, 'function setLitAll(next, visible)', 'setLitAll');
const B_ONPATH = blockOf(HTML, "btnLitAll.addEventListener('click'", 'the 點亮 handler');
const B_COMPUTE_FOR_GRID = blockOf(HTML, 'function computeTerrainForGrid()', 'computeTerrainForGrid');
const B_COMPUTE_ENDPOINTS = blockOf(HTML, 'function computeTerrainEndpoints()', 'computeTerrainEndpoints');

section('SHAPE — the seed is chosen once, and the maze it produces is fixed');

/* Not "no Math.random" — the loader legitimately rolls the Pokémon id on a
 * blank field, and forbidding that would forbid the page's main button. What
 * must not happen is a SEED being invented: the only Math.random line must be
 * the id line, so a reintroduced `seed = 1 + Math.floor(Math.random() *
 * 999999)` fails because that line mentions 999999 and not MAX_ID. */
{
  const randomLines = B_LOAD_MAZE.split('\n').filter((l) => /Math\.random/.test(l));
  ok(
    randomLines.length > 0 && randomLines.every((l) => /MAX_ID/.test(l)),
    'the only randomness left in loadPokemonMaze is the Pokémon id, never the seed'
  );
  ok(
    !/seed\s*=\s*[^;\n]*Math\.random/.test(B_LOAD_MAZE),
    'no assignment to `seed` derives from Math.random inside the loader'
  );
  ok(
    !/Math\.random/.test(B_UNVISITED) && !/Math\.random/.test(B_CARVE),
    'carveMaze and its neighbour scan never call Math.random — only the seeded generator'
  );
}
ok(
  !/seed\s*=\s*1\s*\+\s*Math\.floor/.test(HTML),
  'the inline `seed = 1 + Math.floor(Math.random() * 999999)` assignment appears nowhere'
);
ok(
  /id="seedField"[^>]*hidden/.test(HTML) && /id="seedLabel"[^>]*hidden/.test(HTML),
  'the seed field and its label start hidden, so unchecked 固定種子 (fixed seed) reads as 「隨機」 (random) with nothing to fill in'
);
ok(
  /id="fixedSeedToggle"(?![^>]*checked)/.test(HTML) && /id="fixedPokemonToggle"(?![^>]*checked)/.test(HTML),
  'neither axis ships checked — both default to 隨機 (random)'
);

/* One function owns "reveal the field, hide the label, clear the error, and fill
 * it with the current value". It replaces two hand-written change handlers; the
 * seed one shipped without the fill, which is the bug. */
{
  const bind = blockOf(HTML, 'function bindAxisToggle(', 'bindAxisToggle');
  ok(/hideWhenUnchecked = true\)/.test(HTML),
    'bindAxisToggle defaults hideWhenUnchecked to true, because the two axes do NOT behave the same way');
  ok(/field\.hidden = hideWhenUnchecked && !on;/.test(bind),
    'the field hides with the checkbox only when the axis asked for it');
  ok(/label\.hidden = hideWhenUnchecked && !on;/.test(bind),
    'the label follows the same rule, or it is left pointing at a control with no box');
  ok(/field\.readOnly = !on;/.test(bind),
    'an always-visible field goes readOnly when unchecked — visible and copyable, but obviously not an input');
  ok(/errorBox\.hidden = true;/.test(bind), 'bindAxisToggle clears the previous error when re-opening');
  ok(/onOpen\(\);\s*\n\s*field\.focus\(\);/.test(bind),
    'bindAxisToggle fills the field BEFORE focusing it, so the caret lands in a populated box');
  ok(/toggle\.addEventListener\('change', sync\);\s*\n\s*sync\(\);/.test(bind),
    'sync() runs once at bind time, so the initial state comes from the same code rather than from markup nobody re-runs');
}
/* The species id is shown either way. Hiding it made the CURRENT species
 * invisible in the one state where it changes on every load — exactly when a
 * reader wants to read it. */
ok(
  /bindAxisToggle\(fixedPokemonToggle, idField, idLabel, idError,[\s\S]*?\n\s*false\);/.test(HTML),
  'the Pokémon axis is bound with hideWhenUnchecked = false — the id is always on screen'
);
ok(
  /bindAxisToggle\(fixedSeedToggle, seedField, seedLabel, seedError,\s*\n\s*\(\) => \{ seedField\.value = String\(seed\); \}\);/.test(HTML),
  'the seed axis keeps the default and hides its field, so the two axes differ deliberately rather than by accident'
);
ok(
  !/id="idField"[^>]*\shidden/.test(HTML),
  'the id field is not marked hidden in the markup'
);
ok(
  !/id="idLabel"[^>]*\shidden/.test(HTML),
  'nor is its label — a visible field with a hidden label is an unlabelled input'
);
ok(
  /bindAxisToggle\(fixedSeedToggle, seedField, seedLabel, seedError,\s*\n\s*\(\) => \{ seedField\.value = String\(seed\); \}\);/.test(HTML),
  'the seed axis fills the field with `seed` — 42 before anything is generated, the last random roll after'
);
ok(
  /bindAxisToggle\(fixedPokemonToggle, idField, idLabel, idError,/.test(HTML),
  'the Pokémon axis is bound the same way, so both axes share one implementation'
);
ok(
  /if \(!idField\.value\.trim\(\)\) idField\.value = String\(currentId \?\? 1\)/.test(HTML),
  'the Pokémon axis only overwrites the field when it is empty — the loader already keeps it current'
);

/* --- The id axis. It moved OUT of loadPokemonMaze, because 「checked ⇒ the field
 * is the answer」 and 「blank ⇒ random」 are two different rules and the loader
 * was answering the old one on its own. */ok(
  /function decideId\(\)/.test(HTML),
  'decideId exists as the id axis\' counterpart to decideSeed'
);
ok(
  /if \(!fixedPokemonToggle\.checked\) return true;/.test(blockOf(HTML, 'function decideId()', 'decideId')),
  'decideId returns early when the box is unchecked — unchecked means 隨機 (random), not an error'
);
{
  const dec = blockOf(HTML, 'function decideId()', 'decideId');
  ok(
    /已勾選「固定寶可夢」，請輸入/.test(dec),
    'the empty-field branch says WHY it is refusing: the box is checked, so a blank field cannot mean random'
  );
  ok(
    /requestId\(idField\.value\)/.test(dec),
    'decideId delegates to the one id validator rather than re-testing the shape'
  );
  ok(
    !/idError/.test(B_LOAD_MAZE) || !/超出範圍/.test(B_LOAD_MAZE),
    'loadPokemonMaze no longer produces id errors — two places reporting the same mistake is how they disagree'
  );
  ok(
    !/requestId/.test(B_LOAD_MAZE),
    'loadPokemonMaze does not re-validate the id it was handed'
  );
  ok(
    /requestedId === undefined \? 1 \+ Math\.floor\(Math\.random\(\) \* MAX_ID\) : requestedId/.test(B_LOAD_MAZE),
    'the loader rolls a species only when it was given undefined, which is now decideId\'s decision to make'
  );
}
ok(
  /if \(!decideId\(\) \|\| !decideSeed\(\)\) return;/.test(HTML),
  'the submit decides BOTH axes first and aborts if either refuses'
);
ok(
  /loadPokemonMaze\(fixedPokemonToggle\.checked \? Number\(idField\.value\) : undefined\)/.test(HTML),
  'the loader is told which species to use, so 「random」 is a decision made once and in one place'
);
ok(
  !/decideId/.test(blockOf(HTML, "document.getElementById('btnRandomSeed')", 'the 換種子 (new seed) handler')),
  '換種子 does not consult the Pokémon axis — it re-carves the species already on screen'
);

/* --- The two axes are independent, and the prose says so. */
ok(
  /兩個開關都是<b>不勾＝隨機<\/b>，而且互相獨立/.test(HTML),
  'the hint states that both boxes are unchecked＝隨機 (random) and that the axes are independent'
);
ok(
  /牆完全不變/.test(HTML),
  'the hint spells out that a fixed seed survives 「載入寶可夢迷宮」 (load Pokémon maze) — the old copy did not say this'
);
ok(
  /按演算法按鈕就好，不必重新載入/.test(HTML),
  'the hint tells the reader how to accumulate 比較紀錄 (comparison history), since reloading clears it'
);
ok(
  /id="loadForm"[^>]*flex-direction:column/.test(HTML),
  'the form is a column of rows, not six controls sharing a wrapping inline row'
);
{
  const rows = [...HTML.matchAll(/<div class="al-group">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  ok(rows.length >= 3, `the form holds a button row plus one row per axis (found ${rows.length} groups)`);
  ok(rows.some((r) => r.includes('btnLoadRandom') && r.includes('btnRandomSeed')),
    'the two buttons share one row');
  ok(rows.some((r) => r.includes('fixedPokemonToggle')),
    'the Pokémon axis has its own row');
  ok(rows.some((r) => r.includes('fixedSeedToggle')),
    'the seed axis has its own row');
}
ok(
  /Math\.random/.test(B_ROLL_SEED) && /999999/.test(B_ROLL_SEED),
  'rollSeed is the one place a random seed is born, and it is bounded 1–999999 — the same range the field validates'
);
ok(
  !/Math\.random/.test(B_DECIDE_SEED),
  'decideSeed itself does no arithmetic on chance; it delegates to rollSeed so there is one roll to find'
);
/* The COMPARISON, not the message. An earlier version asserted
 * /1 到 999999/ && /return false/, which deleting the whole range check left
 * green — the string is still in the error text and `return false` still
 * appears in the two branches above it. §3.B2: a claim satisfied by an
 * unrelated part of the file. */
ok(
  /n < 1 \|\| n > 999999/.test(B_DECIDE_SEED),
  'decideSeed range-checks the field with a real comparison, not just prose about it'
);

/* Each of the three refusals, each bounded to its OWN braces. */
for (const [name, headRe, expectMessage] of [
  ['empty-field', /if \(!raw\) \{/, /取消勾選/],
  ['non-numeric', /if \(!\/\^\\d\+\$\/\.test\(raw\)\) \{/, /不是數字/],
  ['out-of-range', /if \(n < 1 \|\| n > 999999\) \{/, /超出範圍/],
]) {
  const body = ifBlock(B_DECIDE_SEED, headRe);
  ok(body !== null, `decideSeed has a ${name} branch`);
  ok(
    body !== null && /\breturn false;/.test(body),
    `the ${name} branch refuses, so a bad seed can never reach the carve`
  );
  ok(
    body !== null && expectMessage.test(body),
    `the ${name} branch says WHICH problem it was, not just that there was one`
  );
  ok(
    body !== null && /seedField\.focus\(\)/.test(body),
    `the ${name} branch puts the caret back in the field the reader has to fix`
  );
}
ok(
  /loadForm[\s\S]{0,400}if \(!decideId\(\) \|\| !decideSeed\(\)\) return;/.test(HTML),
  'the form submit decides BOTH axes first and aborts if either refuses'
);
ok(
  /btnRandomSeed[\s\S]{0,300}rerollSeed\(\);[\s\S]{0,200}loadPokemonMaze\(/.test(HTML),
  '換種子 rerolls and then calls the loader — the button re-carves for real instead of only rewording the status line'
);
/* 換種子 (new seed) must NOT go through decideSeed. In 固定種子 (fixed seed) mode
 * decideSeed reads the field, so routing the button through it rerolls the SAME
 * maze: measured live, seed 4242 stayed 4242 and the wall fingerprint did not
 * move. A button labelled 「換種子」 that does not change the seed is worse than
 * no button. */
ok(
  !/btnRandomSeed[\s\S]{0,300}decideSeed/.test(HTML),
  '換種子 does not route through decideSeed, which would honour the pinned value and change nothing'
);
ok(
  /seed = rollSeed\(\);\s*\n\s*seedField\.value = String\(seed\);/.test(B_REROLL),
  'rerollSeed sets the seed AND writes it into the field, so the new value is visible and pinnable'
);
ok(
  /rerollSeed\(\);\s*\n\s*return true;/.test(B_DECIDE_SEED),
  'decideSeed’s random branch delegates to rerollSeed, so there is one roll to find'
);
ok(
  /loadPokemonMaze\(currentId \?\? undefined\)/.test(HTML),
  '換種子 re-carves the SAME Pokémon, changing only the walls'
);
ok(
  /種子只影響<b>迷宮牆壁<\/b>模式/.test(HTML) && /完全相同的牆/.test(HTML),
  'the hint states that the seed only affects 迷宮牆壁, and makes the cross-Pokémon determinism claim below'
);

/* The determinism claim is only true if the carve reads nothing but the RNG. If
 * it ever reads a sprite's colour, the hint above becomes a lie and every
 * comparison in the run log is between two different maps. */
ok(
  !/Math\.random/.test(B_CARVE) && !/Math\.random/.test(B_UNVISITED),
  'carveMaze and its neighbour scan never call Math.random — only the seeded generator'
);
ok(
  /seededRandom\(\)/.test(B_CARVE),
  'carveMaze draws its choices from seededRandom()'
);
ok(
  !/color|terrainCost|alpha|\.a\b/.test(B_CARVE),
  'carveMaze reads nothing from the sprite, which is why seed 42 gives identical walls behind any Pokémon'
);
ok(
  /initSeed\(seed\);\s*\n\s*carveMaze\(\);/.test(HTML),
  'initSeed is called on the line immediately before carveMaze — the re-seed-per-carve guarantee from 4098b7d'
);

section('SHAPE — 點亮整張圖 (light the whole board)');

ok(
  /id="btnLitAll"[^>]*hidden/.test(HTML),
  'the 點亮 (light up) button starts hidden; there is nothing to toggle before a run has finished'
);
ok(
  /aria-pressed="false"/.test(HTML),
  'the button carries aria-pressed from the start, so it is a toggle to assistive tech and not a one-shot action'
);
ok(
  /btnLitAll\.setAttribute\('aria-pressed', String\(litAll\)\)/.test(B_SET_LIT),
  'setLitAll is what writes aria-pressed, so the attribute and the state cannot drift'
);
ok(
  /btnLitAll\.textContent = litAll \? '還原路徑顯示' : '點亮整張圖'/.test(B_SET_LIT),
  'the label names the action it will perform next, not the state it is in'
);
ok(
  /setLitAll\(litAll, true\)/.test(B_FINISH),
  'finishSearch reveals the button after ANY run — found or not'
);
ok(
  /setLitAll\(false, false\)/.test(B_START_SEARCH),
  'startSearch hides it and turns 點亮 (light up) off, so a new run dims the board itself'
);
ok(
  /setLitAll\(false, false\)/.test(B_LOAD_MAZE),
  'loadPokemonMaze hides it — a new maze has no finished picture to switch away from'
);
ok(
  /setLitAll\(false, false\)/.test(B_SET_MODE),
  'setMode hides it, for the same reason loadPokemonMaze does'
);
ok(
  /litAll \? 1 : \(this\.onPath \? 1 : \(this\.searchVisited \? 0\.5 : 0\.05\)\)/.test(B_CELL_DRAW),
  'Cell.draw forces alpha to 1 when lit — that is the whole of 「點亮」 (light up)'
);
ok(
  /setLitAll\(!litAll\);\s*\n\s*redraw\(\);/.test(B_ONPATH),
  'the toggle redraws and does nothing else — no flag is rewritten, so 復原 (restore) is the same run rendered again'
);
ok(
  !/onPath|searchVisited/.test(B_ONPATH),
  'the 點亮 (light up) handler touches neither onPath nor searchVisited, which is why restoring is lossless'
);
ok(
  !/drawMarkers|marker\(/.test(B_ONPATH),
  'the 點亮 (light up) handler does not redraw markers either — the discs survive 點亮 because drawMarkers runs after the cells'
);

/* ==================================================== BEHAVIOURAL HALF ==== */

section('BEHAVIOURAL — starRun on fake 5×5 and 7×7 open grids');

/** The four corner keys `starRun` reads, as a fake grid hands them back. */
const CORNER_KEYS = ['topLeft', 'bottomRight', 'topRight', 'bottomLeft'];

/** 8-directional open grid of plain objects. No walls, no costs — one per step. */
function openGrid(size = 5) {
  const nodes = new Map();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) nodes.set(`${x},${y}`, { x, y });
  }
  const at = (x, y) => nodes.get(`${x},${y}`) ?? null;
  return {
    size,
    at,
    neighbourFn: (n) => {
      const out = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const next = at(n.x + dx, n.y + dy);
          if (next) out.push({ node: next, stepCost: 1 });
        }
      }
      return out;
    },
  };
}

function pointsFor(grid) {
  const c = Math.floor(grid.size / 2);
  return {
    center: grid.at(c, c),
    topLeft: grid.at(0, 0),
    topRight: grid.at(grid.size - 1, 0),
    bottomLeft: grid.at(0, grid.size - 1),
    bottomRight: grid.at(grid.size - 1, grid.size - 1),
  };
}

/** Drain a run generator, recording the first `keep` yields in order. */
function drain(gen, keep = 8) {
  const first = [];
  let total = 0;
  for (;;) {
    const step = gen.next();
    if (step.done) return { result: step.value, first, total };
    total += 1;
    if (first.length < keep) first.push(step.value);
  }
}

const open = openGrid();
const openPts = pointsFor(open);

/* --- THE CRASH GUARD. Every successful patrol reads `.cost` off this result
 * and calls .toFixed() on it, so "found but cost is undefined" is the exact
 * failure that shipped. Asserted over every solver, not just one: a future
 * solver wired into the patrol would otherwise be unchecked. */
for (const id of Object.keys(SOLVERS)) {
  const heuristic = id === 'astar' ? octileHeuristic : null;
  const { result } = drain(
    starRun(SOLVERS[id], open.neighbourFn, heuristic, openPts)
  );
  ok(result.found === true, `${id}: patrol found every leg on an open grid`);
  ok(
    typeof result.cost === 'number' && Number.isFinite(result.cost),
    `${id}: result.cost is a finite number — the page calls cost.toFixed() on it\n` +
    `        (found was ${result.found}, cost was ${JSON.stringify(result.cost)})`
  );
  ok(
    result.path.length > 0,
    `${id}: patrol returned a non-empty path`
  );
}

/* --- `legs` is what the status line prints, so its SHAPE is a claim too. */
{
  const { result } = drain(starRun(bfsSolve, open.neighbourFn, null, openPts));
  eq(result.legs.length, 4, 'legs has one entry per patrol leg');
  eq(result.legs.map((l) => l.id), ['A', 'B', 'C', 'D'], 'legs carry their ids');
  eq(
    result.legs.map((l) => l.label),
    ['左上', '右下', '右上', '左下'],
    'legs carry the corner names the page prints (top-left, bottom-right, top-right, bottom-left), in rotation order'
  );
  ok(
    result.legs.every((l) => typeof l.found === 'boolean' && Array.isArray(l.path)),
    'every leg carries its own found/path, so one unreachable leg is reportable'
  );
  ok(
    result.legs.every((l) => l.path.length >= 1),
    'every leg found a path on an open grid'
  );
}

/* --- THE INTERLEAVING CLAIM. The patrol is round-robin rather than four
 * sequential runs, and this is the only assertion a sequential implementation
 * fails: the first four yields must be one step from EACH leg's own generator,
 * in PATROL_LEGS order — not four consecutive steps of leg A. */
{
  const grid = openGrid();
  const pts = pointsFor(grid);
  const { first } = drain(starRun(bfsSolve, grid.neighbourFn, null, pts), 4);

  // What each leg's FIRST yield is, run entirely on its own. Same solver, same
  // start, same neighbours — so this is a statement about scheduling, not about
  // the search.
  const soloFirst = PATROL_LEGS.map((leg) => {
    const one = drain(bfsSolve(pts.center, pts[leg.corner], grid.neighbourFn, null), 1);
    return one.first[0];
  });

  ok(first.length === 4, 'the patrol yields at least four steps');
  eq(
    first.map((n) => `${n.x},${n.y}`),
    soloFirst.map((n) => `${n.x},${n.y}`),
    'the first four yields are A,B,C,D one step each — round-robin, not four of A'
  );

  // A sequential run would yield A's first step, then A's SECOND, then A's
  // third… so assert the first four are not four cells of one leg's own walk.
  const soloRun = [];
  {
    const one = drain(bfsSolve(pts.center, pts[0], grid.neighbourFn, null), 4);
    soloRun.push(...one.first);
  }
  ok(
    first.map((n) => `${n.x},${n.y}`).join('|') !== soloRun.map((n) => `${n.x},${n.y}`).join('|'),
    'the first four yields differ from leg A running alone'
  );
}

/* --- ORDER IS A CONTRACT. `legs` is rebuilt in PATROL_LEGS order rather than in
 * completion order, because the page draws four paths and prints four labels in
 * that order.
 *
 * The centre is deliberately off-centre. On a symmetric grid every corner is the
 * same hop distance from the middle, all four legs finish in the same round, and
 * completion order already equals PATROL_LEGS order — the test then passes for
 * an implementation that does not sort at all. From (1,1) the four corners are
 * 2, 10, 6 and 6 hops away, so a completion-ordered result is B, D, C, A. */
{
  const size = 7;
  const nodes = new Map();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) nodes.set(`${x},${y}`, { x, y });
  }
  const at = (x, y) => nodes.get(`${x},${y}`) ?? null;
  const neighbourFn = (n) => {
    const out = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = at(n.x + dx, n.y + dy);
      if (next) out.push({ node: next, stepCost: 1 });
    }
    return out;
  };
  const pts = {
    center: at(1, 1),                       // off-centre, on purpose
    topLeft: at(0, 0),                      // 2 hops  — finishes first
    bottomRight: at(size - 1, size - 1),    // 10 hops — finishes last
    topRight: at(size - 1, 0),              // 6 hops
    bottomLeft: at(0, size - 1),            // 6 hops
  };
  const expectedHops = (end) =>
    Math.abs(end.x - pts.center.x) + Math.abs(end.y - pts.center.y);

  const { result } = drain(starRun(bfsSolve, neighbourFn, null, pts));
  ok(result.found === true, 'the off-centre patrol found every leg');
  eq(result.legs.map((l) => l.id), ['A', 'B', 'C', 'D'], 'legs come back in PATROL_LEGS order');
  eq(
    result.legs.map((l) => `${l.path.at(-1).x},${l.path.at(-1).y}`),
    ['0,0', '6,6', '6,0', '0,6'],
    'each leg ends at the corner PATROL_LEGS named, read out of the module'
  );
  ok(
    result.legs.every((l) => l.path.length === expectedHops(l.path.at(-1)) + 1),
    'every leg is exactly as long as the open grid\'s hop distance, so the four lengths differ'
  );
  eq(
    result.legs.map((l) => l.path.length),
    [3, 11, 7, 7],
    'leg lengths are 3/11/7/7 cells — unequal, so completion order is not PATROL_LEGS order'
  );
  eq(
    result.path.length,
    3 + 11 + 7 + 7,
    'the concatenated path is all four legs end to end'
  );
}

/* --- THE FAILURE PATH. `found: false` must not hand the page something it will
 * print, because finishSearch only guards `.toFixed()` behind `found`. */
{
  const size = 5;
  const nodes = new Map();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) nodes.set(`${x},${y}`, { x, y });
  }
  const at = (x, y) => nodes.get(`${x},${y}`) ?? null;
  // The centre's four orthogonal neighbours are the only walled cells, so the
  // centre is sealed rather than merely fenced off from one direction. Walling a
  // whole row does NOT do it: the centre at (2,2) is in row 2, but its north
  // neighbour at (2,1) is not, and the search walks straight up and out.
  const walled = new Set(['2,1', '3,2', '2,3', '1,2']);
  const neighbourFn = (n) => {
    const out = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = n.x + dx, ny = n.y + dy;
      const next = at(nx, ny);
      if (next && !walled.has(`${nx},${ny}`)) out.push({ node: next, stepCost: 1 });
    }
    return out;
  };
  const pts = {
    center: at(2, 2),
    topLeft: at(0, 0), topRight: at(4, 0),
    bottomLeft: at(0, 4), bottomRight: at(4, 4),
  };
  const { result } = drain(starRun(bfsSolve, neighbourFn, null, pts));
  ok(result.found === false, 'a sealed-off centre reports found: false');
  ok(
    result.legs.length === 4,
    'all four legs still return a result even when none of them found a path'
  );
  ok(
    result.cost === Infinity,
    'an unsolved patrol reports cost Infinity, which the page prints as 「無解」 (no solution)'
  );
  ok(
    result.path.length === 0,
    'an unsolved patrol returns no path, so nothing is drawn over the failed search'
  );
}

/* --- THE MODULE STAYS GRAPH-GENERIC. The per-leg `searchVisited` reset that
 * left three of four legs unpainted was grid awareness leaking into the run;
 * it can only leak if the engine can see the grid. */
section('BEHAVIOURAL — the engine does not know about the grid');
ok(
  !/searchVisited/.test(ENGINE_CODE),
  'no CODE in maze-pathfinding.js mentions searchVisited — it cannot reset what the page paints'
);
ok(
  !/\bwalls\b|\bterrainCost\b|GRID_SIZE/.test(ENGINE_CODE),
  'no CODE names grid structure; the callers supply neighbourFn'
);
ok(
  /astarSolve needs a heuristic/.test(ENGINE),
  'the heuristic requirement is still stated, and still throws'
);

/* ========================================================== SHAPE HALF ==== */

section('SHAPE — maze.html wiring');

ok(
  /import\s*\{[^}]*\bstarRun\b[^}]*\}\s*from\s*'\.\/assets\/js\/maze-pathfinding\.js'/.test(HTML),
  'maze.html imports starRun from the module, so the engine is the one that is checked'
);
ok(
  /import\s*\{[^}]*\bPATROL_LEGS\b[^}]*\}\s*from\s*'\.\/assets\/js\/maze-pathfinding\.js'/.test(HTML),
  'maze.html imports PATROL_LEGS from the module'
);
ok(
  !/function\s*\*?\s*starRun/.test(HTML),
  'maze.html defines no second starRun — the two copies of the leg list cannot drift apart'
);

/* --- Markers follow the point set the run uses. The defect was drawMarkers()
 * calling endpoints() unconditionally, which in terrain mode drew the passable
 * bounding box's corners rather than the four corners the patrol walks to. */
ok(
  /runKind\s*===\s*'star'/.test(B_DRAW_MARKERS),
  "drawMarkers branches on runKind === 'star'"
);
/* 點亮 (light up) hides the markers, and it has to be the FIRST statement after
 * the empty-grid guard: a `litAll` check placed after the patrol branch would
 * leave the four corner discs drawn. */
ok(
  /if \(!grid\.length\) return;\s*\n\s*if \(litAll\) return;/.test(B_DRAW_MARKERS),
  'drawMarkers bails on litAll immediately, before either branch — so S, G and the patrol A/B/C/D all go'
);
ok(
  B_DRAW_MARKERS.indexOf('if (litAll) return;') < B_DRAW_MARKERS.indexOf("runKind === 'star'"),
  'the lit check comes BEFORE the patrol branch, or the corner discs would survive it'
);
ok(
  /marker\(pts\.center, TOKENS\.start, 'S'\)/.test(B_DRAW_MARKERS)
    && /marker\(start, TOKENS\.start, 'S'\); marker\(end, TOKENS\.goal, 'G'\)/.test(B_DRAW_MARKERS),
  'both the patrol S and the single-run S/G pair are reachable only below the lit bail-out'
);
ok(
  /starPoints\(\)/.test(B_DRAW_MARKERS),
  'the patrol branch reads starPoints(), the same five points startSearch passes the engine'
);
ok(
  /endpoints\(\)/.test(B_DRAW_MARKERS),
  'the single branch reads endpoints(), which is the pair that run actually used'
);
ok(
  /for \(const leg of PATROL_LEGS\) marker\(pts\[leg\.corner\], TOKENS\.goal, leg\.id\)/.test(B_DRAW_MARKERS),
  'the four corner markers iterate PATROL_LEGS instead of restating four labels'
);
ok(
  /marker\(pts\.center, TOKENS\.start, 'S'\)/.test(B_DRAW_MARKERS),
  'the shared patrol start is drawn as S'
);

/* No corner disc is labelled by hand. A literal `marker(x, y, 'D')` beside the
 * PATROL_LEGS loop is exactly the second copy that drifts. Scoped to
 * drawMarkers' body rather than the whole file, because maze.html is markup —
 * its prose contains no single quotes today and that is not a guarantee. */
{
  const labels = [...B_DRAW_MARKERS.matchAll(/marker\([^;]*?,\s*'([A-Z])'\s*\)/g)].map((m) => m[1]);
  eq(
    [...new Set(labels)].sort(),
    ['G', 'S'],
    'the only disc labels written out in drawMarkers are S and G; A/B/C/D come from PATROL_LEGS'
  );
  eq(labels, ['S', 'S', 'G'], 'S is drawn twice — patrol centre and single start — and G once');
  ok(
    !/'[ABCD]'\s*\)/.test(B_DRAW_MARKERS),
    'no corner disc is hand-labelled A, B, C or D'
  );
}

/* --- runKind is state, and state that can go stale is the defect this section
 * is named after: markers described a run the page was not doing. Each of these
 * is tested against ITS OWN block — the earlier page-wide regexes were satisfied
 * by any other function's setRunKind, which is what let mutation M7 survive. */
const RUNKIND_RESETS = [
  ['startSearch', B_START_SEARCH, /setRunKind\(star \? 'star' : 'single'\)/],
  ['setMode', B_SET_MODE, /setRunKind\('single'\)/],
  ['the contrast slider', B_CONTRAST, /setRunKind\('single'\)/],
  ['loadPokemonMaze', B_LOAD, /setRunKind\('single'\)/],
];
for (const [where, body, re] of RUNKIND_RESETS) {
  ok(re.test(body), `runKind is (re)set inside ${where} itself`);
}
ok(
  /runKind = next;/.test(B_SET_RUN_KIND) && /canvas\.setAttribute\('aria-label'/.test(B_SET_RUN_KIND),
  'setRunKind writes the variable and the canvas accessible name together'
);
ok(
  !/runKind/.test(B_STOP_RUN),
  'stopRun does NOT reset runKind — startSearch calls it on its own first line, so a reset there is order-dependent'
);
ok(
  /star:[\s\S]*A 左上、B 右下、C 右上、D 左下/.test(B_ARIA),
  'the star aria-label names all four legs in PATROL_LEGS order'
);
ok(
  /single:[\s\S]*S 為起點，G 為終點/.test(B_ARIA),
  'the single aria-label still describes S and G'
);

/* --- The counters. `explored` is the union because it is the number of cells
 * the flag flipped, and `settled` is the per-leg total; the status line prints
 * both for a patrol because the two differ by several times. */
ok(
  /if \(!step\.value\.searchVisited\) explored\+\+;\s*step\.value\.searchVisited = true;\s*settled\+\+;/.test(B_TICK),
  'tick() counts the union into explored and every settle into settled'
);
ok(
  !/settled\s*=\s*null/.test(B_TICK) && !/let settled\b/.test(B_TICK),
  'no local `settled` shadows the module counter — `null++` would have made it NaN'
);
ok(
  /run\.star[\s\S]*四腿合計[\s\S]*settled\.toLocaleString/.test(B_TICK),
  'the visited stat shows the union first and the four-leg total second'
);
ok(
  /result\.legs\.map\(\(l\) => `\$\{l\.id\} \$\{l\.label\}/.test(B_FINISH),
  'the status line names each leg by id and corner — the four paths are one colour, so the text is the only place the legs are distinguishable'
);

/* --- starPoints: four corners that resolve to one cell is not a patrol. */
ok(
  /new Set\(PATROL_LEGS\.map\(\(leg\) => pts\[leg\.corner\]\)\)\.size/.test(B_STAR_POINTS)
    && />= 2/.test(B_STAR_POINTS),
  'starPoints rejects four corners that collapse onto fewer than two cells'
);

/* --- Prose. The page states the leg order; the engine owns it. They have to be
 * the same order, or the panel teaches the reader the wrong labels.
 *
 * Scoped to the patrol panel rather than the whole file, for the same reason
 * every assertion above is block-scoped: the aria-label contains the identical
 * 「A 左上、B 右下、C 右上、D 左下」 sequence, so a page-wide grep for it stayed
 * green after the panel's own sentence was deleted. Two places on a page making
 * the same claim is what makes the claim worth checking twice. */
{
  const title = '<h2>四角巡航是什麼</h2>';
  const start = HTML.indexOf(title);
  ok(start >= 0, 'the 四角巡航 (four-corner patrol) panel exists');
  const end = start >= 0 ? HTML.indexOf('<h2>', start + title.length) : -1;
  const panel = start >= 0 && end > start ? HTML.slice(start, end) : '';
  ok(panel.length > 0, 'the 四角巡航 panel was bounded by the next panel heading');
  ok(
    /A 左上、B 右下、C 右上、D 左下/.test(panel),
    'the patrol panel itself states the leg order, not just the aria-label'
  );
  ok(
    /探索格數是<b>聯集<\/b>/.test(panel),
    'the patrol panel itself says the explored count is the union'
  );
  ok(
    /中央 S 是四腿共用的起點/.test(panel),
    'the patrol panel says the centre is a start shared by all four legs — the thing the old markers denied'
  );
  ok(
    /只在狀態列讀得到/.test(panel),
    'the patrol panel tells the reader the four paths are one colour, so the legs are only readable in the status line'
  );
}
ok(
  /速度以「每幀處理幾格」計。/.test(HTML),
  'the speed sentence is still on the page, in one short line'
);
/* It moved out of 這一次的結果 (this run's result) and into 這四個演算法保證什麼
 * (what these four algorithms guarantee). Scoped, because the one-line form is a
 * substring of the old three-line version — a page-wide match would have kept
 * passing against the long paragraph it replaced. */
{
  const at = HTML.indexOf('速度以「每幀處理幾格」計。');
  const guarantees = HTML.indexOf('這四個演算法保證什麼');
  const results = HTML.indexOf('這一次的結果');
  ok(at > guarantees && guarantees > results,
    'the speed line sits in 這四個演算法保證什麼 (what these four algorithms guarantee), below 這一次的結果 (this run\'s result)');
  ok(
    !/演算法之間的差距本來就很大/.test(HTML),
    'the old three-line speed paragraph is gone — it was the longest text on the page for the least information'
  );
  ok(
    !/四腿合計<\/b>的量/.test(HTML),
    'the 「四腿合計」 (four-leg total) clause went with it; the per-frame budget claim now lives in the module comment where it is load-bearing'
  );
}

/* --- The run log's 探索 (explored) column means "cells painted", which is why
 * it takes `explored` and not `settled`. Asserted so a later edit does not
 * quietly make the column a different quantity from the canvas. */
ok(
  /addRunLog\(\{[\s\S]*?visited: explored,/.test(B_FINISH),
  'the run log records the union, so its 探索 (explored) column still means cells painted'
);

/* --- Tokens. The markers read --algo-start / --algo-goal, and a patrol draws
 * five discs of the same two colours. Both must still be defined in both themes
 * or a disc renders with whatever the token fell back to. */
section('SHAPE — marker tokens');
ok(
  /--algo-start:/.test(SHARED) && /--algo-goal:/.test(SHARED),
  'both marker tokens are defined'
);
{
  const dark = SHARED.slice(SHARED.indexOf(':root'));
  ok(
    (SHARED.match(/--algo-start:/g) || []).length >= 2,
    '--algo-start is defined per theme, not only in the fallback block'
  );
  ok(
    (SHARED.match(/--algo-goal:/g) || []).length >= 2,
    '--algo-goal is defined per theme, not only in the fallback block'
  );
  ok(dark.length > 0, 'the token block was locatable');
}
ok(
  /function marker\(c, color, label\)/.test(HTML),
  'marker() takes only the cell it draws — the unused grid parameter is gone'
);
ok(
  /ctx\.strokeStyle = '#ffffff'; ctx\.stroke\(\);[\s\S]*?ctx\.strokeStyle = '#000000'/.test(HTML),
  'the white-then-black ring pair is intact; it is what makes a disc legible over any sprite'
);
ok(
  CSS.includes('.al-stage') && /--canvas-wall/.test(SHARED),
  'the stage and the wall token the cells are drawn with are both still there'
);

section('SHAPE — the terrain cost model is one function, read from the module');

/* AGENTS.md §3.Q ends with 「Guarded by: nothing — the model is a constant, not a
 * claim with a threshold」 and then names two things the checker DOES assert.
 * That paragraph has to be true, so they are here: the claim is that there is
 * ONE cost function and ONE alpha threshold, and a second copy of either is
 * exactly how §3.B2's misnamed greys happened on another page. */
ok(
  /export function computeTerrainCost\(color, maxCost = TERRAIN_MAX_COST_DEFAULT\)/.test(ENGINE),
  'computeTerrainCost is defined once, in the module'
);
ok(
  !/function computeTerrainCost/.test(HTML),
  'maze.html defines no second cost function'
);
ok(
  !/0\.2126|0\.7152|0\.0722/.test(HTML),
  'maze.html holds no copy of the Rec.709 coefficients — the luminance weights live in exactly one file'
);
ok(
  /import\s*\{[^}]*TERRAIN_ALPHA_WALL_THRESHOLD[^}]*\}\s*from\s*'\.\/assets\/js\/maze-pathfinding\.js'/.test(HTML),
  'maze.html imports TERRAIN_ALPHA_WALL_THRESHOLD from the module, so the drawn-as-wall test IS the impassable test'
);
ok(
  /this\.color\.a < TERRAIN_ALPHA_WALL_THRESHOLD/.test(B_CELL_DRAW),
  'Cell.draw reads the threshold from the module constant, never from a literal'
);
ok(
  !/\ba < 50\b|\ba >= 50\b/.test(HTML),
  'no literal 50 in maze.html — one number, two consumers, and the renderer and the solver cannot disagree about it'
);
/* The VALUE is pinned, not just the one-number invariant. Moving it keeps
 * 「one number, two consumers」 true and every assertion above green, while
 * silently changing which pixels are walls, how much of every sprite is
 * walkable, and therefore which routes exist. A constant that changes what the
 * page is measuring should be a deliberate edit with a stated reason — so the
 * message below says what is at stake rather than only what was found. */
ok(
  /export const TERRAIN_ALPHA_WALL_THRESHOLD = 50;/.test(ENGINE),
  'the alpha cutoff is still 50. Changing it keeps every other assertion here green while altering which pixels are walls, how much of each sprite is walkable, and which routes exist — if you mean to move it, say why in the docblock and in the PR'
);
/* §3.Q's decision is 「ship Rec.709」, so pin the weights rather than the prose.
 * The rationale is a docblock, and a docblock is not a claim with a threshold;
 * the CONSTANTS are. */
ok(
  /0\.2126 \* color\.r \+ 0\.7152 \* color\.g \+ 0\.0722 \* color\.b/.test(ENGINE),
  'the shipped model is still Rec.709 luma, with no gamma and no colour space wrapped around it'
);
ok(
  /color\.a < TERRAIN_ALPHA_WALL_THRESHOLD\) return Infinity;/.test(ENGINE),
  'a pixel below the threshold is still IMPASSABLE rather than merely expensive'
);
ok(
  /TERRAIN_MIN_COST \+ \(255 - luminance\) \/ 255 \* \(maxCost - TERRAIN_MIN_COST\)/.test(ENGINE),
  'cost is still the linear rescale of luminance between 1 and maxCost'
);

/* ================================================================ REPORT ==== */

section('BEHAVIOURAL — largestComponent over fake grids');

/* The module is where this lives SO THAT THIS CAN BE RUN. The defect it fixes
 * (a bounding-box corner landing on a detached fragment) is a question about
 * graph structure, and a fake 7×7 answers it without a sprite. */
{
  const SIZE = 7;
  /* Node identity is by REFERENCE, same as every Set/Map in this module — which
   * is exactly why a fixture that builds a fresh object per call runs forever.
   * The real caller passes `cellAt = (x, y) => grid[y][x]`, stable by definition.
   * Getting this wrong is not a style point: it is an unbounded loop. */
  const nodes = new Map();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) nodes.set(`${x},${y}`, { x, y });
  }
  const at = (x, y) => nodes.get(`${x},${y}`) ?? null;
  const body = new Set();
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) body.add(`${x},${y}`);
  const fragment = '6,6';
  const passableSet = new Set([...body, fragment]);
  const isPassable = (n) => passableSet.has(`${n.x},${n.y}`);
  const fourWay = (pass) => (n) => {
    const out = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const t = at(n.x + dx, n.y + dy);
      if (t && pass(t)) out.push({ node: t, stepCost: 1 });
    }
    return out;
  };

  const main = largestComponent(SIZE, at, fourWay(isPassable), isPassable);
  eq(main.size, 9, 'largestComponent returns the 9-cell body, not the 10-cell union');
  ok(!main.has(at(6, 6)),
    'the detached single cell is NOT in the result — that is the whole point of the function');
  ok(
    [...body].every((k) => { const [x, y] = k.split(',').map(Number); return main.has(at(x, y)); }),
    'every body cell is in the result'
  );
  const twice = largestComponent(SIZE, at, fourWay(isPassable), isPassable);
  ok(
    [...main].every((n) => twice.has(n)) && [...twice].every((n) => main.has(n)),
    'two calls return the same set, so a caller is allowed to cache it'
  );

  const none = largestComponent(SIZE, at, fourWay(() => false), () => false);
  eq(none.size, 0, 'largestComponent returns an empty Set when nothing is passable, not null');

  /* maze.html's `terrainNeighbours` filters impassable cells out of its own
   * output, so with THAT caller the guard inside largestComponent is
   * belt-and-braces and never decides anything. This fixture does NOT filter,
   * which is the only way to test the guard at all — and the guard has to be
   * there, because a caller that returns its whole neighbourhood would otherwise
   * silently get the specks folded back into the body. */
  const unfiltered = (n) => {
    const out = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const t = at(n.x + dx, n.y + dy);
      if (t) out.push({ node: t, stepCost: 1 });
    }
    return out;
  };
  const guarded = largestComponent(SIZE, at, unfiltered, isPassable);
  eq(guarded.size, 9, 'with an UNFILTERED neighbourFn the body is still the 9 cells, not the fragment');
  ok(
    !guarded.has(at(6, 6)),
    'largestComponent filters by isPassable itself — it does not trust the caller to have done it'
  );

  const tiePass = new Set(['0,0', '6,0']);
  const tie = largestComponent(SIZE, at, fourWay((n) => tiePass.has(`${n.x},${n.y}`)),
    (n) => tiePass.has(`${n.x},${n.y}`));
  eq(tie.size, 1, 'a two-way tie returns one component');
  ok(tie.has(at(0, 0)) && !tie.has(at(6, 0)),
    'the tie-break is SCAN ORDER, first wins — the alternative makes the result depend on where the scan started');
}
ok(
  /export function largestComponent\(size, at, neighbourFn, isPassable\)/.test(ENGINE),
  'largestComponent is exported with the callback signature findNearestPassable already uses'
);
ok(
  /if \(group\.size > best\.size\) best = group;/.test(ENGINE),
  'the size comparison is a strict >, which is what makes the tie-break first-wins'
);

section('SHAPE — endpoints come from the body, surgically');

ok(
  /terrainMain = largestComponent\(GRID_SIZE, cellAt, terrainNeighbours, passable\);/.test(HTML),
  'the body is computed with the caller\'s neighbourFn, so the component matches the adjacency the solvers search with'
);
ok(
  (B_COMPUTE_FOR_GRID.match(/terrainMain\s*=/g) || []).length === 1,
  'terrainMain is assigned in exactly ONE place — a second assignment is a second opinion about the same grid'
);
ok(
  /function terrainReachable\(from, to\)/.test(HTML),
  'terrainReachable exists — the fallback is gated on ACTUAL connectivity, not on a guess'
);
/* The perf trap: drawMarkers runs EVERY FRAME and starPoints is inside it. */
ok(
  !/largestComponent/.test(B_DRAW_MARKERS),
  'drawMarkers does not label components — it runs on every animation frame'
);
ok(
  !/largestComponent/.test(B_STAR_POINTS),
  'neither does starPoints, which drawMarkers calls per frame; the body comes from the cache'
);
ok(
  /if \(terrainReachable\(start, end\)\) return \{ start, end, center \};/.test(B_COMPUTE_ENDPOINTS),
  'the OLD bbox rule is returned untouched whenever its pair is connected — that is the 96.5%'
);
ok(
  /const inBody = \(c\) => terrainMain\.has\(c\);/.test(B_COMPUTE_ENDPOINTS),
  'the fallback restricts the ring scan to the body, which is what makes it solvable BY CONSTRUCTION'
);
ok(
  /const corner = \(x, y\) => findNearestPassable\(x, y, GRID_SIZE, cellAt, inBody\);/.test(B_STAR_POINTS),
  'the patrol takes its corners from the body'
);
ok(
  /findNearestPassable\(\s*\n\s*mid\(\(bb\.minX \+ bb\.maxX\) \/ 2\), mid\(\(bb\.minY \+ bb\.maxY\) \/ 2\),\s*\n\s*GRID_SIZE, cellAt, inBody,/.test(B_STAR_POINTS),
  'and its centre too — all five patrol points come from the body bbox'
);
ok(
  !/terrainEndpoints\?\.center/.test(B_STAR_POINTS),
  'starPoints no longer borrows the single-run centre, which is the all-passable one'
);

console.log(
  C.failures.length === 0
    ? `\nall ${C.checks} checks passed`
    : `\n${C.failures.length} of ${C.checks} checks FAILED`
);
process.exit(C.failures.length === 0 ? 0 : 1);