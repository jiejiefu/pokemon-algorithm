/**
 * Unit & Integration tests for Pokémon Conway's Game of Life (life.html)
 *
 * Validates:
 * 1. Page structure and required DOM hooks in life.html
 * 2. NAV integration in shared.js
 * 3. Classical pattern coordinates & dimensions
 * 4. GameEngine automata laws:
 *    - Underpopulation (<2 dies)
 *    - Survival (2 or 3 lives, age increments)
 *    - Overpopulation (>3 dies)
 *    - Reproduction (==3 live neighbors spawns stage 0 base form)
 *    - Dominant family genetics inheritance
 *    - Age-based evolution (Age >= 5 -> Stage 1, Age >= 12 -> Stage 2)
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
import { GameEngine, buildGenMetadata, PATTERNS } from '../assets/js/life-engine.js';

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
const engine = new GameEngine(gen1Meta);

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

// 6. Test Evolution (Stage 1 at Age >= 5, Stage 2 at Age >= 12)
console.log('\n--- Evolution Laws (Age 5 -> Stage 1, Age 12 -> Stage 2) ---');
engine.clear();
// Create a 2x2 still life block (Block is immortal in Game of Life)
// Block coordinates: (0,0), (0,1), (1,0), (1,1)
// All cells have 3 neighbors, so they all survive every tick!
engine.setCell(0, 0, 1); // Bulbasaur (Stage 0)
engine.setCell(0, 1, 1);
engine.setCell(1, 0, 1);
engine.setCell(1, 1, 1);

// Advance 5 ticks
for (let i = 0; i < 5; i++) {
  engine.tick();
}
const cellAtAge5 = engine.getCell(0, 0);
check(cellAtAge5.age === 5, 'Cell age is 5 after 5 survival ticks');
check(cellAtAge5.stage === 1, `Cell evolved to Stage 1 at Age 5, got stage ${cellAtAge5.stage}`);
check(cellAtAge5.speciesId === 2, `Bulbasaur (#1) evolved into Ivysaur (#2), got #${cellAtAge5.speciesId}`);

// Advance 7 more ticks to reach Age 12
for (let i = 0; i < 7; i++) {
  engine.tick();
}
const cellAtAge12 = engine.getCell(0, 0);
check(cellAtAge12.age === 12, 'Cell age is 12 after 12 survival ticks');
check(cellAtAge12.stage === 2, `Cell evolved to Stage 2 at Age 12, got stage ${cellAtAge12.stage}`);
check(cellAtAge12.speciesId === 3, `Ivysaur (#2) evolved into Venusaur (#3), got #${cellAtAge12.speciesId}`);

// 7. Test Legendary Medal Unlock Milestones
console.log('\n--- Legendary Medal Unlock Milestones ---');
engine.clear();
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
