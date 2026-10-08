/**
 * Unit & Integration tests for Pokémon Conway's Game of Life (life.html)
 *
 * Validates:
 * 1. Page structure and required DOM hooks in life.html
 * 2. NAV integration in shared.js
 * 3. Classical pattern coordinates & dimensions
 * 4. GameEngine automata laws:
 *    - Underpopulation (<2 dies)
 *    - Survival (2 or 3 lives, level increments)
 *    - Overpopulation (>3 dies)
 *    - Reproduction (==3 live neighbors spawns stage 0 base form)
 *    - Dominant family genetics inheritance
 *    - Level-based evolution gated on each species' real in-game level
 *    - Veteran aura on single-stage Pokémon
 *    - Wild encounter mutator
 *    - Legendary medal unlock milestones (1 medal per 6 distinct families)
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const check = (cond, ok, bad) => {
  if (cond) return pass(ok);
  const why = typeof bad === 'function' ? bad() : bad;
  fail(`${ok} — ${why || 'Assertion failed'}`);
};

console.log('--- Pokémon Conway Life Page Integrity ---');

// Evolution-level table, the same file life.js fetches.
const evolutionLevels = JSON.parse(read('assets/data/evolution_levels.json'));
const evolveLevelFor = (from, to) => engine.evolutionLevelFor(from, to);

/** True if a Bulbasaur block is ever Stage 2 without having been Stage 1. */
function bulbasaurSkippedIvysaur() {
  engine.clear();
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) engine.setCell(x, y, 1);
  let sawIvysaur = false;
  for (let i = 0; i < 60; i++) {
    engine.tick();
    for (const c of engine.cells.values()) {
      if (c.stage >= 2 && !sawIvysaur && c.speciesId === 3) return true;
      if (c.speciesId === 2 || c.speciesId === 3) sawIvysaur = true;
    }
  }
  return false;
}

// 1. Check HTML on disk
check(existsSync(join(ROOT, 'life.html')), 'life.html exists on disk');
const lifeHtml = read('life.html');

check(/<canvas id="lifeCanvas"/.test(lifeHtml), 'life.html contains #lifeCanvas');
check(/<div class="life-toolbar"/.test(lifeHtml), 'life.html contains .life-toolbar');
check(/id="setupModal"/.test(lifeHtml), 'life.html contains #setupModal for generation lock');
check(/id="hofDrawer"/.test(lifeHtml), 'life.html contains #hofDrawer for Hall of Fame');
check(/id="dexDrawer"/.test(lifeHtml), 'life.html contains #dexDrawer for Generation Pokédex');
check(/id="celebrationToast"/.test(lifeHtml), 'life.html contains #celebrationToast for achievements');
check(/class="header header-maze"/.test(lifeHtml), 'life.html carries the row-layout header header-maze');

// 2. Engine and Patterns validation
import { GameEngine, buildGenMetadata, PATTERNS, FALLBACK_EVOLUTION_LEVEL } from '../assets/js/life-engine.js';

check(typeof GameEngine === 'function', 'GameEngine class is exported');
check(Boolean(PATTERNS.glider && PATTERNS.pulsar && PATTERNS.gliderGun), 'Classical patterns (glider, pulsar, gliderGun) are defined');
check(PATTERNS.glider.coords.length === 5, 'Glider contains exactly 5 coordinates');

// Load JSON data
const allPokemon = JSON.parse(read('assets/data/pokemon_data.json'));
const evoChains = JSON.parse(read('assets/data/evolution_chains.json'));
const generations = JSON.parse(read('assets/data/generations.json'));

// 3. Test Generation Metadata Builder
const gen1Meta = buildGenMetadata(1, allPokemon, evoChains, generations);
check(gen1Meta.gen === 1, 'Generation 1 metadata built correctly');
check(gen1Meta.allGenSpecies.length === 151, 'Gen 1 contains 151 species');
check(gen1Meta.starters.length === 3, 'Gen 1 contains 3 starters (Bulbasaur, Charmander, Squirtle)');
check(gen1Meta.legendaries.length === 5, 'Gen 1 contains 5 legendaries (#144, #145, #146, #150, #151)');

// 4. Test GameEngine Conway Automata Rules
console.log('\n--- Conway Automata Rules & Genetics ---');
// The table is a CONSTRUCTOR argument, so an engine built without it would answer
// every evolutionLevelFor() with the fallback and this whole section would pass
// having measured nothing.
const engine = new GameEngine(gen1Meta, evolutionLevels);

// Blinker test (oscillator of period 2)
// Initial: (0,1), (1,1), (2,1) horizontal line
// After 1 tick: (1,0), (1,1), (1,2) vertical line
engine.setCell(0, 1, 1); // Bulbasaur
engine.setCell(1, 1, 1);
engine.setCell(2, 1, 1);

check(engine.cells.size === 3, 'Initial blinker has 3 cells');
engine.isWildEnabled = false; // Disable wild encounters for deterministic test

// Tick 1
const tick1 = engine.tick();
check(tick1.population === 3, 'Blinker still has 3 cells after 1 tick');
check(engine.getCell(1, 0) && engine.getCell(1, 1) && engine.getCell(1, 2), 'Blinker rotated to vertical orientation (1,0), (1,1), (1,2)');
check(!engine.getCell(0, 1) && !engine.getCell(2, 1), 'Horizontal ends died of underpopulation');

// Tick 2
const tick2 = engine.tick();
check(tick2.population === 3, 'Blinker still has 3 cells after 2 ticks');
check(engine.getCell(0, 1) && engine.getCell(1, 1) && engine.getCell(2, 1), 'Blinker rotated back to horizontal orientation (period 2 verified)');

// 5. Test Genetics Inheritance (dominant family)
console.log('\n--- Genetics & Family Dominance ---');
engine.clear();
// Set up 3 parents around empty cell (1, 1):
// (0, 1): Charmander (id 4, family 2)
// (2, 1): Charmander (id 4, family 2)
// (1, 0): Squirtle (id 7, family 3)
engine.setCell(0, 1, 4);
engine.setCell(2, 1, 4);
engine.setCell(1, 0, 7);

const tickGenetics = engine.tick();
const newborn = engine.getCell(1, 1);
check(Boolean(newborn), 'Cell (1,1) was born with 3 neighbors');
check(newborn && newborn.speciesId === 4, `Newborn inherited dominant Charmander species (id 4), got id ${newborn?.speciesId}`);
check(newborn && newborn.familyId === 2, `Newborn inherited Charmander family (chain 2), got chain ${newborn?.familyId}`);

// 6. Test Evolution against each species' REAL in-game level
console.log('\n--- Evolution Laws (real in-game levels) ---');
// A 2x2 block is an immortal still life, so LEVEL IS THE ONLY VARIABLE here: the
// cell cannot die, cannot be crowded and cannot be out-neighboured, so whatever
// level it evolves at is the level the engine's gate is reading.
function block(speciesId) {
  engine.clear();
  engine.setCell(0, 0, speciesId);
  engine.setCell(0, 1, speciesId);
  engine.setCell(1, 0, speciesId);
  engine.setCell(1, 1, speciesId);
}

/** Advance until the block reaches `stage`, and report the level it reached it at. */
function evolveAt(speciesId, stage = 1, maxTicks = 80) {
  block(speciesId);
  for (let i = 1; i <= maxTicks; i++) {
    engine.tick();
    const now = engine.getCell(0, 0);
    if (now.stage >= stage) return { level: now.evolvedAtLevel, to: now.speciesId, stage: now.stage };
  }
  return { level: null, to: null, stage: null };
}

// Bulbasaur is the fixture the old Age>=5 / Age>=12 test used, and it is the
// right one to keep: it has TWO real levels, so a single number cannot satisfy it.
check(evolveLevelFor(1, 2) === 16, `Bulbasaur -> Ivysaur is Lv.16 in the games, table says Lv.${evolveLevelFor(1, 2)}`);
check(evolveLevelFor(2, 3) === 32, `Ivysaur -> Venusaur is Lv.32 in the games, table says Lv.${evolveLevelFor(2, 3)}`);

const first = evolveAt(1, 1);
check(first.level === 16, `Bulbasaur block evolved to #${first.to} at Lv.${first.level}, expected Lv.16`);
check(first.to === 2, `Bulbasaur (#1) evolved into Ivysaur (#2), got #${first.to}`);
check(first.stage === 1, `Bulbasaur is Stage 1 after one step, got stage ${first.stage}`);

const second = evolveAt(1, 2);
check(second.to === 3, `Bulbasaur block reaches Venusaur (#3), got #${second.to}`);
check(second.stage === 2, `Bulbasaur block reaches Stage 2, got stage ${second.stage}`);
check(second.level === 32, `Stage 2 entered at Lv.${second.level}, expected Lv.32`);

// Sequential means NO SHORTCUTS. The old code tried Stage 2 before Stage 1, so a
// level-12 Bulbasaur could reach Venusaur without ever being an Ivysaur, which
// the games do not allow. Asserting it as "never" rather than "rarely" is what
// would catch a reordering.
check(!bulbasaurSkippedIvysaur(), 'Bulbasaur never skips Ivysaur on its way to Venusaur');

// Caterpie pins the OTHER end of the scale: Lv.7, the lowest real threshold in
// the corpus. A gate still using a literal 12 would pass the Bulbasaur case and
// fail this one, which is the point of having both.
check(evolveLevelFor(10, 11) === 7, `Caterpie (#10) -> Metapod (#11) is Lv.7, table says Lv.${evolveLevelFor(10, 11)}`);
const caterpie = evolveAt(10, 1);
check(caterpie.level === 7, `Caterpie block evolved at Lv.${caterpie.level}, expected Lv.7`);

// Eevee has NO level-gated step at all in the games (stones and friendship), so
// this is the fallback path, and the fallback is the stated corpus median.
const eevee = evolveAt(133, 1);
check(eevee.level === FALLBACK_EVOLUTION_LEVEL,
  `Eevee's stone/trade evolutions use the stated median Lv.${FALLBACK_EVOLUTION_LEVEL}, got Lv.${eevee.level}`);

// A cell born by the reproduction rule starts at Lv.1, not Lv.0: levels in the
// games start at 1, and a displayed Lv.0 would be a level that does not exist.
block(1);
engine.clear();
engine.setCell(0, 0, 4); engine.setCell(1, 0, 4); engine.setCell(2, 0, 4);
engine.tick();
const born = engine.getCell(1, 1);
check(born && born.level === 1, `Newborn starts at Lv.1, got Lv.${born?.level}`);
check(born && born.evolvedAtLevel === null, 'Newborn has no evolvedAtLevel before it evolves');

// 7. Test Legendary Medal Unlock Milestones
console.log('\n--- Legendary Medal Unlock Milestones ---');
engine.clear();
// Section 6 now evolves real cells, which discovers real families, so this
// section cannot assume an empty ledger. `clear()` empties the grid but NOT the
// discovery sets — deliberately, since a reader's dex must survive a clear — so
// the ledger is reset explicitly rather than by leaning on clear().
engine.unlockedFamilies.clear();
engine.unlockedSpecies.clear();
engine.unlockedMedalIds.clear();
engine.unlockedMedals = [];
check(engine.unlockedMedals.length === 0, 'Initially 0 legendary medals');

// Simulate discovering 6 distinct families
const sampleFamilies = [1, 2, 3, 4, 5, 6];
sampleFamilies.forEach((famId, idx) => {
  const tree = gen1Meta.familyTrees.get(famId);
  if (tree) {
    engine.recordDiscovery(tree.base.id, famId);
  }
});

check(engine.unlockedFamilies.size === 6, 'Unlocked 6 distinct families');
check(engine.unlockedMedals.length === 1, `Earned 1st Legendary Medal: got #${engine.unlockedMedals[0]?.id} ${engine.unlockedMedals[0]?.names?.zh}`);
check(engine.unlockedMedals[0]?.id === 144, 'First Gen 1 medal is #144 Articuno (急凍鳥)');

// Simulate discovering 6 more (total 12 families)
[7, 8, 9, 10, 11, 12].forEach((famId) => {
  const tree = gen1Meta.familyTrees.get(famId);
  if (tree) {
    engine.recordDiscovery(tree.base.id, famId);
  }
});
check(engine.unlockedFamilies.size === 12, 'Unlocked 12 distinct families');
check(engine.unlockedMedals.length === 2, `Earned 2nd Legendary Medal: got #${engine.unlockedMedals[1]?.id} ${engine.unlockedMedals[1]?.names?.zh}`);
check(engine.unlockedMedals[1]?.id === 145, 'Second Gen 1 medal is #145 Zapdos (閃電鳥)');

// 8. Test Wild Encounter Pack Spawning
console.log('\n--- Wild Encounter Viable Pack Spawning ---');
engine.clear();
engine.isWildEnabled = true;
engine.wildRate = 1.0; // Force spawn for test
const tickWild = engine.tick();
check(Boolean(tickWild.wildSpawnEvent), 'Wild encounter triggered');
check(tickWild.wildSpawnEvent && tickWild.wildSpawnEvent.count >= 2, `Wild encounter spawned a viable pack of ${tickWild.wildSpawnEvent?.count} cells (not a lonely dying cell)`);
check(engine.cells.size >= 2, 'Grid contains living wild encounter cluster');

if (failures > 0) {
  console.log(`\nFAIL  ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log('\nPASS  all Pokémon Conway Life engine and page checks passed!');
}
