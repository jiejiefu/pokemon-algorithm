#!/usr/bin/env node
/**
 * index.html's two demos — "演算法，自動上演" and "換你來挑戰 A*".
 * Run: node scripts/check_home_sections.mjs
 *
 * Each assertion here guards a break that still renders:
 *   - `home_roster.json` drifting from `pokemon_data.json` (a renamed sort key
 *     would silently sort every value as 0);
 *   - the homepage fetching the 2.8 MB roster instead of the 90 KB table;
 *   - the game copying the showcase's octile/8-direction opponent, which is not
 *     admissible on the game's 4-directional grid;
 *   - the reference's own bug: it passed `getElementById('game-subtitle')` while
 *     the markup had no such id, so the round's Pokémon name never rendered;
 *   - `[hidden]` losing to an author `display` on the action row (§3.M).
 *
 * The CSS lives in `assets/css/home-sections.css`, not inline: these sections
 * are below the fold, and the hero's own shell lives in `home-hero.css` instead.
 * This checker therefore reads both stylesheets and the page that mounts them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SHOWCASE_ALGO_IDS, SHOWCASE_KEY_IDS } from '../assets/js/home-showcase.js';
import { ALGO_IDS } from '../assets/js/sorting-algorithms.js';
import { SORT_KEY_IDS } from '../assets/js/sort-keys.js';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(BASE, p), 'utf8');

let checks = 0;
const problems = [];
const ok = (cond, msg, why) => {
  checks++;
  if (!cond) problems.push(why ? `${msg} — ${why}` : msg);
};
const eq = (got, want, msg) => ok(
  Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
  `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
);

const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const html = read('index.html');
const htmlCode = stripComments(html);
const heroCss = read('assets/css/home-hero.css');
const heroNoComments = stripComments(heroCss);
const css = read('assets/css/home-sections.css');
const cssNoComments = stripComments(css);

const sections = read('assets/js/home-sections.js');
const showcase = read('assets/js/home-showcase.js');
const game = read('assets/js/home-maze-game.js');
const grid = read('assets/js/home-sprite-grid.js');
const newJs = [sections, showcase, game, grid].join('\n');

const source = JSON.parse(read('assets/data/pokemon_data.json'));
const roster = JSON.parse(read('assets/data/home_roster.json'));
const expected = source.map((p) => ({
  id: p.id,
  names: { zh: p.names.zh },
  stats: { total: p.stats.total },
  height_m: p.height_m,
  hue: p.hue,
}));

const at = (needle) => htmlCode.indexOf(needle);

console.log('\n--- the compact roster is the source table, not a second copy ---');
eq(roster.length, source.length, 'home_roster.json has one record per pokemon_data.json record');
const firstMismatch = roster.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(expected[i]));
ok(firstMismatch === -1,
  `home_roster.json record ${firstMismatch} is byte-identical to the fields it derives`,
  `record ${firstMismatch} diverged from pokemon_data.json; regenerate with scripts/build_home_roster.py`);
ok(roster.every((r) => Object.keys(r).join(',') === 'id,names,stats,height_m,hue'),
  'every roster record carries exactly the five fields the demos read',
  'a field was added or removed, so the payload split and the sort keys are no longer described by this file');
ok(roster.every((r) => Object.keys(r.names).join(',') === 'zh'
  && Object.keys(r.stats).join(',') === 'total'),
  'the nested names/stats objects carry only the fields the showcase uses',
  'a nested key changed; the compact shape is no longer compact');
ok(roster.every((r) => Number.isFinite(r.height_m) && Number.isFinite(r.hue) && Number.isFinite(r.stats.total)),
  'every sort value is numeric, so the comparators cannot fall through to 0',
  'a null or string slipped in and every comparison for that record now ties');

console.log('\n--- the page mounts the two sections in the only order the hero allows ---');
ok(/<link rel="stylesheet" href="assets\/css\/home-sections\.css">/.test(htmlCode),
  'index.html links the below-fold stylesheet');
ok(at('assets/css/home-sections.css') < at('assets/css/home-hero.css'),
  'the below-fold stylesheet is mounted before the hero shell, so the hero still wins the cascade');
ok(!/\.home-showcase|\.home-game/.test(heroNoComments),
  'the two demos\' rules are not in the hero stylesheet',
  'a new rule was written into home-hero.css, where it is neither cacheable nor below the fold');
ok(/<section class="home-section" id="showcase" aria-labelledby="showcase-title">/.test(htmlCode),
  'the showcase section has its own id and points at its h2');
ok(/<section class="home-section" id="game" aria-labelledby="game-title">/.test(htmlCode),
  'the game section has its own id and points at its h2');
ok(at('id="showcase-title"') > 0 && at('id="showcase-title"') < at('id="game-title"')
  && at('id="game-title"') < at('id="features"'),
  'the order is showcase, game, then the feature grid',
  'the two demos are not between the intro and the feature grid, so the hero stats ordering claim is no longer the only placement');
eq((htmlCode.match(/<h1[\s>]/g) || []).length, 1, 'the page still has exactly one h1');
ok(/<a class="home-hero-scroll-hint" href="#showcase-title">/.test(htmlCode),
  'the scroll hint points at the first section it now introduces');
ok(/id="showcase-sort-stage" aria-hidden="true"><\/div>/.test(htmlCode)
  && /id="showcase-maze-stage" aria-hidden="true"><\/div>/.test(htmlCode),
  'both showcase stages exist and are hidden from the accessibility tree',
  'a showcase stage is missing or no longer aria-hidden; its canvas is decorative');
ok(/id="game-subtitle"/.test(htmlCode),
  'the game has a subtitle element',
  'the reference passed this element to initMazeGame but never wrote it into the markup, so the round\'s Pokémon name never appeared');
ok(/id="game-status"[^>]*role="status"[^>]*aria-live="polite"/.test(htmlCode),
  'the game status is a polite live region, so a countdown or result is announced');
eq((htmlCode.match(/data-dir="/g) || []).length, 4, 'the on-screen pad has four directions');
ok(/id="game-start"[^>]*hidden/.test(htmlCode) && /id="game-again"[^>]*hidden/.test(htmlCode),
  'both game actions start hidden, so no clickable control promises a round before one exists');

console.log('\n--- the roster is lazy, and the homepage never asks for the 2.8 MB table ---');
ok(/home_roster\.json/.test(sections), 'home-sections.js fetches the compact roster');
ok(!/loadPokemonData/.test(newJs),
  'none of the new modules imports loadPokemonData',
  'the homepage is back on the 2.8 MB pokemon_data.json, which is the payload this design exists to avoid');
ok(/IntersectionObserver/.test(sections) && /rootMargin:\s*PRELOAD_MARGIN/.test(sections),
  'the roster load is gated on an IntersectionObserver with a named margin',
  'the demos start at page load again, so the hero pays for a roster it has not reached');
ok(/PRELOAD_MARGIN\s*=\s*'400px 0px'/.test(sections),
  'the preload margin is one named constant');
ok(/visibilitychange/.test(sections),
  'a hidden tab pauses the demos, not only a section that scrolled away');
ok(/spriteUrl/.test(sections),
  'images come from spriteUrl (96 px, ~1.9 KB), not the artwork directory');
ok(!/assets\/images\/pokemon|artworkUrl/.test(newJs + htmlCode),
  'no new code references the 126 KB artwork the demos deliberately avoid');

console.log('\n--- the showcase runs the real engines ---');
ok(SHOWCASE_KEY_IDS.every((k) => SORT_KEY_IDS.includes(k)),
  `every showcase sort key (${SHOWCASE_KEY_IDS.join(', ')}) exists in sort-keys.js`);
ok(SHOWCASE_ALGO_IDS.every((a) => ALGO_IDS.includes(a)),
  `every showcase algorithm (${SHOWCASE_ALGO_IDS.join(', ')}) exists in sorting-algorithms.js`);
ok(/ALGO_META/.test(showcase) && /SORT_KEY_MAP/.test(showcase),
  'the showcase calls ALGO_META.run and SORT_KEY_MAP.compare rather than reimplementing either');
ok(/astarSolve/.test(showcase) && /octileHeuristic/.test(showcase),
  'the showcase solves with the real astarSolve and the admissible octile heuristic');
ok(!/manhattanHeuristic/.test(showcase),
  'the showcase does not use the 4-directional heuristic with its 8-directional neighbours');
ok(/prefers-reduced-motion/.test(showcase) && /runOnceInstant/.test(showcase),
  'reduced motion drains the generator to a completed frame instead of looping');
ok(/function pause\(/.test(showcase) && /function resume\(/.test(showcase),
  'the showcase can be paused and resumed by the orchestrator');
ok(/SORT_STEP_MS\s*=\s*40/.test(showcase) && /now - lastStepAt < SORT_STEP_MS/.test(showcase),
  'the sort showcase advances one generator step every 40 ms, not eight per frame');
ok(/Math\.random\(\)\s*\*\s*roster\.length/.test(showcase),
  'the maze demo picks a fresh random roster entry on every run');

console.log('\n--- the game is fair, quiet on load, and named ---');
ok(/manhattanHeuristic/.test(game),
  'the game uses the 4-directional heuristic');
ok(/diagonal:\s*false/.test(game),
  'the game builds 4-directional neighbours, so manhattan is admissible');
ok(!/octileHeuristic/.test(game),
  'the game does not borrow the showcase\'s diagonal heuristic');
ok(/cryPlayer\.muted/.test(game),
  'the winner\'s cry respects the site-wide mute');
eq((game.match(/cryPlayer\.play\(/g) || []).length, 1,
  'the game calls cryPlayer.play exactly once, on the win path');
ok(/prefers-reduced-motion/.test(game) && /motion\.matches/.test(game),
  'the game skips its countdown under reduced motion');
ok(/game-subtitle|subtitleEl/.test(game),
  'the game writes the round\'s Pokémon name into a subtitle');
ok(/optimalPath/.test(game), 'the game measures the AI against its own optimal path');
ok(/AI_TICK_MS\s*=\s*420/.test(game) && /AI_PAUSE_MS\s*=\s*1000/.test(game),
  'the AI moves at a readable 420 ms per cell and can pause for a full second');
ok(/AI_PAUSE_CHANCE/.test(game) && /nextAiDelay/.test(game),
  'the AI pause is probabilistic and chosen per step');
ok(/setTimeout\(/.test(game) && !/setInterval\(aiStep/.test(game),
  'the AI runs on a re-armed timeout, so one step can be delayed without bunching the rest');
ok(/function pause\(/.test(game) && /function resume\(/.test(game),
  'the game can be paused and resumed by the orchestrator');
ok(/rgba\(\$\{token\('--canvas-wall'\)\}/.test(game),
  'the wall token is an RGB triplet wrapped in rgba() before it reaches fillStyle',
  'a raw triplet is not a colour; canvas silently keeps the previous fillStyle and the walls disappear');

console.log('\n--- the round\'s numbers are text, not 12px of canvas ink ---');
ok(/id="game-score"/.test(htmlCode)
  && /id="game-score-you"/.test(htmlCode)
  && /id="game-score-ai"/.test(htmlCode),
  'index.html mounts the score panel and both of its numbers');
ok(/id="game-score"[^>]*hidden/.test(htmlCode),
  'the score panel starts hidden — a fresh load has no round to report');
ok(!/fillText\(`你 \$\{steps\} 步/.test(game),
  'the canvas no longer draws the result line under the maze',
  'the result is still painted at h - 4, where the board is at its darkest');
eq((game.match(/scoreYou\.textContent/g) || []).length, 1,
  'the player\'s step count is written in exactly one place');
eq((game.match(/scoreAi\.textContent/g) || []).length, 1,
  'the A* step count is written in exactly one place');
ok(/function hideScore\(/.test(game) && (game.match(/hideScore\(\)/g) || []).length >= 2,
  'a new round clears the previous round\'s numbers, on both the setup and the start path');

console.log('\n--- the shared grid derives walls from the same threshold as maze.html ---');
ok(/TERRAIN_ALPHA_WALL_THRESHOLD/.test(grid),
  'the grid uses the full maze page\'s alpha threshold rather than a second constant');
ok(/DIAGONAL_DIRS/.test(grid),
  'the neighbour directions come from maze-pathfinding.js');

console.log('\n--- the below-fold stylesheet owns layout and both theme tokens ---');
ok(/\.home-section\s*\{[^}]*max-width:\s*1000px/.test(cssNoComments),
  'the section aligns with the 1000px feature grid');
ok(/\.home-showcase-stage\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*7/.test(cssNoComments),
  'the showcase stage reserves its box before the canvas exists (CLS)');
ok(/\.home-game-stage\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/.test(cssNoComments),
  'the game stage reserves a square before its canvas exists (CLS)');
ok(/:root\s*\{[^}]*--home-game-ai:\s*#4cc9f0/.test(cssNoComments)
  && /\[data-theme="light"\]\s*\{[^}]*--home-game-ai:\s*#1d4ed8/.test(cssNoComments),
  'the opponent token is declared for both themes');
ok(/\.home-game-actions \.btn\[hidden\]\s*\{\s*display:\s*none/.test(cssNoComments),
  'an author display cannot beat [hidden] on the two action buttons (§3.M)');
ok(/\.home-game-score\[hidden\]\s*\{\s*display:\s*none/.test(cssNoComments),
  'an author display cannot beat [hidden] on the score panel (§3.M)');
ok(/@media \(max-width: 860px\)\s*\{\s*\.home-game-stage\s*\{\s*max-width:\s*none/.test(cssNoComments),
  'the game stage drops its 520px cap before the single-column breakpoint');

if (problems.length) {
  console.error(`\nFAIL  ${problems.length} of ${checks} checks failed`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nPASS  ${checks} checks`);
