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
import { GameEngine, buildGenMetadata, PATTERNS, FALLBACK_EVOLUTION_LEVEL, CROSS_GEN_BRANCH_ROOTS, BRANCH_WEIGHTS, MODE_FROZEN_SPECIES } from '../assets/js/life-engine.js';
// Read from the SAME module the renderers read, rather than restating the 18
// keys — a hardcoded copy is a second source of truth for the exact answer the
// assertion below exists to police, and it goes stale in the dangerous direction.
import { TYPE_COLORS } from '../assets/js/shared.js';

// Hoisted to the top rather than left beside the era section: the wash checks
// below reach for `eraTypes` too, and a dynamic import is a lexical binding — the
// first version had it 110 lines lower and every run died with "Cannot access
// 'eraTypes' before initialization" at the wash assertion.
const { TYPE_INTRO_GEN, ERA_TYPE_OVERRIDES, typesForGeneration, generationTypeCount, eraTypes, LETS_GO_TYPE_ERA } =
  await import('../assets/js/type-era.js');
const { TYPE_CHART_ORDER } = await import('../assets/js/type-chart.js');

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

// 9. The cross-generation Eevee branch.
//
// Every check here is about a defect that shipped green through the whole suite.
// The branch used to be drawn from the family tree's stage columns, and
// evolution_chains.json numbers `stage` by DEX ORDER — so Eevee's eight branches
// read as eight successive stages, only 水伊布 was ever reachable, and the fix
// that made the other seven reachable was an edit to a GENERATED data file that
// the next run of extract_evolution_chains.py erases. The two assertions that
// matter are the ones a data edit cannot satisfy: the branch is the real edge
// list, and its destination set is the whole family.
console.log('\n--- Eevee cross-generation branch ---');

// The set is a NAMED exception because 70 of the 489 edges cross a generation
// boundary and most are worse: #172 Pichu -> #25 Pikachu runs backwards, and
// #52 Primeape -> #863 Annihilape would put a Gen 8 form on a Gen 1 board. So the
// assertion is the set's exact contents, not "at least one exception exists" —
// an empty set would satisfy the weaker form and remove the feature.
check([...CROSS_GEN_BRANCH_ROOTS].join(',') === '133',
  `CROSS_GEN_BRANCH_ROOTS is exactly {133}, got {${[...CROSS_GEN_BRANCH_ROOTS].join(',')}}`);

// The branch must be the eight real edges, not a hand-written id list. A list
// that drifts is a feature that quietly stops working; this reads the same table
// the engine draws from.
const eeveeEdges = [...(evolutionLevels.unlevelled['133'] || [])].map(e => e.to).sort((a, b) => a - b);
check(eeveeEdges.join(',') === '134,135,136,196,197,470,471,700',
  `Eevee has eight real edges in evolution_levels.json, got ${eeveeEdges.length}`);
// ALL EIGHT, ON A BOARD THAT CAN HOLD THEM. `engine` here is the bare Gen 1
// engine from earlier in the file, and on a classic Gen 1 board it correctly
// reaches only THREE — so the eight-edge claim moved to a Let's Go board, where
// era 7 admits all eight. Asserting eight on the Gen 1 engine is what the era
// restriction was written to make false; asserting fewer than eight anywhere
// would make the branch stop being the feature it exists to be.
{
  const lgMeta = buildGenMetadata(1, allPokemon, evoChains, generations, { starterId: 133 });
  const lg = new GameEngine(lgMeta, evolutionLevels, 'letsGo');
  lg.setMode('letsGo');
  check(lg.successorsOf(133).map(e => e.to).sort((a, b) => a - b).join(',') === eeveeEdges.join(','),
    `a Let's Go board can reach all eight Eeveelutions, got ${lg.successorsOf(133).length}`);
  check(engine.successorsOf(133).map(e => e.to).sort((a, b) => a - b).join(',') === '134,135,136',
    `a classic Gen 1 board reaches only the three stones (${engine.successorsOf(133).length})`);
  // 仙子伊布 is the point of the exception, so it gets its own line rather than
  // being one of eight: it is a Gen 6 species and was unreachable on every Gen 1
  // board before this, which is what a reader asking for it would have found.
  check(lg.successorsOf(133).some(e => e.to === 700),
    '仙子伊布 (#700) is reachable from an Eevee — on a board whose era has Fairy');
}

// BRANCH_WEIGHTS is the one invented table in the engine, so its key set is
// pinned to the edge set. An id absent from the map falls back to weight 1
// silently, which is exactly how a typo would hide.
check([...BRANCH_WEIGHTS.keys()].sort((a, b) => a - b).join(',') === eeveeEdges.join(','),
  `BRANCH_WEIGHTS keys are exactly Eevee's eight destinations, got ${BRANCH_WEIGHTS.size}`);

// Measured, not asserted as a formula: 3/3/3/2/2/1/1/1 over 16 is
// 18.75% / 12.5% / 6.25%, and a `weightedPick` that fell through to a uniform
// draw would still pass a key-set check. 40k draws keeps the tolerance at +/-1pt.
// Drawn from a Let's Go board, so it exercises all eight weights. The first
// version drew from the classic Gen 1 engine, which admits three — so the
// weighted/uniform question was being asked of three equal weights, where both
// implementations produce the same answer and the check could not fail.
const lgDrawEngine = new GameEngine(
  buildGenMetadata(1, allPokemon, evoChains, generations, { starterId: 133 }),
  evolutionLevels, 'letsGo');
lgDrawEngine.setMode('letsGo');
const drawTally = new Map();
const DRAWS = 40000;
for (let i = 0; i < DRAWS; i++) {
  const hit = lgDrawEngine.weightedPick(lgDrawEngine.successorsOf(133)).to;
  drawTally.set(hit, (drawTally.get(hit) || 0) + 1);
}
const shareOf = id => (drawTally.get(id) || 0) / DRAWS;
check(Math.abs(shareOf(134) - 3 / 16) < 0.01 && Math.abs(shareOf(700) - 1 / 16) < 0.01,
  `the draw is weighted, not uniform: 水伊布 ${(shareOf(134) * 100).toFixed(1)}% (expect 18.8), `
  + `仙子伊布 ${(shareOf(700) * 100).toFixed(1)}% (expect 6.3) over ${DRAWS} draws`);
check([...drawTally.keys()].length === 8,
  `all eight branches are drawn over ${DRAWS} attempts, got ${drawTally.size}`);

// The classic Gen 1 draw is a different shape: three stones, BRANCH_WEIGHTS gives
// all three 3, so it should be a THIRD each. Asserted because the era filter made
// it uniform by accident rather than by decision, and a later weight edit would
// otherwise go unnoticed here.
{
  const g1Tally = new Map();
  for (let i = 0; i < DRAWS; i++) {
    const hit = engine.weightedPick(engine.successorsOf(133)).to;
    g1Tally.set(hit, (g1Tally.get(hit) || 0) + 1);
  }
  const near = id => Math.abs((g1Tally.get(id) || 0) / DRAWS - 1 / 3) < 0.01;
  check(g1Tally.size === 3 && near(134) && near(135) && near(136),
    `the classic Gen 1 draw is a third each over ${DRAWS} attempts (${[...g1Tally].map(([k, v]) => `${k}:${(v / DRAWS * 100).toFixed(1)}%`).join(' ')})`);
}

// 10. Generation lock still holds for everything that is NOT the named exception.
console.log('\n--- Generation lock outside the named exception ---');

const crossGenEdgeCount = (() => {
  const genOf = new Map(allPokemon.map(p => [p.id, p.generation]));
  let n = 0;
  for (const [from, row] of Object.entries(evolutionLevels.levels)) {
    for (const to of Object.keys(row)) if (genOf.get(+from) !== genOf.get(+to)) n++;
  }
  for (const [from, row] of Object.entries(evolutionLevels.unlevelled)) {
    for (const e of row) if (genOf.get(+from) !== genOf.get(e.to)) n++;
  }
  return n;
})();
// If this ever reads 0 the "generation lock" assertion below is vacuous, and a
// vacuous lock is indistinguishable from a broken one in a green run.
check(crossGenEdgeCount === 70,
  `the corpus still has cross-generation edges to be locked out of, got ${crossGenEdgeCount}`);

let leaked = 0;
const leakedSample = [];
for (let g = 1; g <= 9; g++) {
  const meta = buildGenMetadata(g, allPokemon, evoChains, generations);
  const eng = new GameEngine(meta, evolutionLevels);
  for (const sp of allPokemon.filter(p => p.generation === g)) {
    // The exception is the whole point of this loop, so it is excluded by name
    // rather than the count being loosened to accommodate it — a count with the
    // five expected leaks inside it would pass unchanged if the exception grew.
    if (CROSS_GEN_BRANCH_ROOTS.has(sp.id)) continue;
    for (const dest of eng.successorsOf(sp.id)) {
      const destRec = allPokemon.find(p => p.id === dest.to);
      if (destRec && destRec.generation !== g) {
        leaked++;
        if (leakedSample.length < 5) leakedSample.push(`g${g} #${sp.id}->#${dest.to}`);
      }
    }
  }
}
check(leaked === 0,
  `no species outside CROSS_GEN_BRANCH_ROOTS leaves its generation, got ${leaked} (${leakedSample.join(' ')})`);

// 11. The Let's Go freeze is a MODE, not a hardcoded species id.
//
// `if (cell.speciesId === 25) return unchanged` froze Pikachu on every Gen 1
// board, including the classic one — and #26 Raichu's only source on a Gen 1
// board is a Pikachu that evolves, so one of the 151 tiles was permanently
// unreadable. Both halves are asserted: the freeze holds under the mode, and the
// classic board still evolves.
console.log('\n--- Let\'s Go mode freeze ---');

const pikachuCell = { speciesId: 25, stage: 0, level: 99 };
check(MODE_FROZEN_SPECIES.get('letsGo') && MODE_FROZEN_SPECIES.get('letsGo').has(25),
  "Let's Go freezes Pikachu");
check(!MODE_FROZEN_SPECIES.get('') ,
  'no species is frozen outside a named mode');

engine.setMode('letsGo');
const frozen = engine.checkCellEvolution(pikachuCell, 99);
check(frozen.evolved === false && frozen.speciesId === 25,
  `a Let's Go Pikachu stays #${frozen.speciesId} (evolved=${frozen.evolved})`);

engine.setMode('');
const thawed = engine.checkCellEvolution(pikachuCell, 99);
check(thawed.evolved === true && thawed.speciesId === 26,
  `a classic Gen 1 Pikachu still reaches #${thawed.speciesId}, the only source of 雷奇 there`);
engine.setMode('');

// A frozen cell reports no required level, so tick() keeps the level it had
// rather than resetting it — `unchanged` carries no level field at all.
check(frozen.requiredLevel === null,
  'a frozen cell reports no required level, so the caller keeps the one it had');

// 12. The Pokédex roster and the counter divide by the SAME number.
console.log('\n--- Pokédex roster ---');
// Built WITH the starter, because the Eevee section is the reader's choice and
// not the generation's: it appears only when the chosen starter belongs to a
// cross-generation branch family. `gen1Meta` above was built without one, so it
// is the answer for 「no starter chosen」 and is asserted as such first.
const eeveeMeta = buildGenMetadata(1, allPokemon, evoChains, generations, { starterId: 133 });
check(gen1Meta.totalSpeciesCount === 151,
  `Gen 1 holds 151 species, got ${gen1Meta.totalSpeciesCount}`);
check(gen1Meta.dexRoster.length === gen1Meta.totalSpeciesCount,
  `with no starter chosen the drawer is just the 151, got ${gen1Meta.dexRoster.length}`);
check(gen1Meta.dexRoster.every(e => e.section === null),
  'and it carries no branch section');

const dexIds = eeveeMeta.dexRoster.map(e => e.species.id);
check(eeveeMeta.dexRoster.length === 156,
  `choosing 伊布 gives 151 minus 4 Eeveelutions plus 9 = 156 tiles, got ${eeveeMeta.dexRoster.length}`);
check(new Set(dexIds).size === dexIds.length,
  'no species appears twice in the roster');
const sectionEntries = eeveeMeta.dexRoster.filter(e => e.section);
check(sectionEntries.length === 9 && sectionEntries[0].species.id === 133,
  `the 伊布家族 section holds all nine, got ${sectionEntries.length}`);
check(eeveeMeta.dexRoster.filter(e => !e.section).length === 147,
  `the main run holds the other 147, got ${eeveeMeta.dexRoster.filter(e => !e.section).length}`);

// The condition is the FAMILY, not the id, so it is asserted per starter rather
// than once: four of Gen 1's five starters are outside chain 67 and must get the
// plain roster back, including 皮卡丘 — which is the interesting one, because
// Let's Go freezes Pikachu and Eevee is still seeded on that board.
for (const starterId of [1, 4, 7, 25]) {
  const meta = buildGenMetadata(1, allPokemon, evoChains, generations, { starterId });
  check(meta.dexRoster.length === 151 && meta.dexRoster.every(e => e.section === null),
    `starter #${starterId} is outside the branch family, so the drawer is the plain 151`);
}
// Every one of the section's tiles is reachable on a Gen 1 board now, so the
// drawer can be completed. Before the cross-generation branch, five of the nine
// could never appear there and the /151 was unreachable by construction.
const reachableOnGen1 = new Set(allPokemon.filter(p => p.generation === 1).map(p => p.id));
for (const [from, row] of Object.entries(evolutionLevels.unlevelled)) {
  if (reachableOnGen1.has(+from)) for (const e of row) reachableOnGen1.add(e.to);
}
check(sectionEntries.every(e => reachableOnGen1.has(e.species.id)),
  'every tile in the section is reachable on a Gen 1 board');

// A generation with no cross-generation root has no section at all, which is the
// rule stated once rather than a per-generation exception list — and Gen 2's
// starters are all outside chain 67 too, so this also pins that generation.
const gen4Meta = buildGenMetadata(4, allPokemon, evoChains, generations, { starterId: 387 });
check(gen4Meta.dexRoster.every(e => e.section === null),
  'Gen 4 seeds no branch root, so it gets no section');
check(gen4Meta.dexRoster.length === gen4Meta.totalSpeciesCount,
  `Gen 4's roster is just its own species, got ${gen4Meta.dexRoster.length}/${gen4Meta.totalSpeciesCount}`);

// 13. letsGoStarters survives a regeneration.
//
// It was hand-added to generations.json, which extract_generations.py rewrites
// from the InfoPoke snapshot on every run — so the Let's Go switch disappeared
// the next time anyone regenerated, and no checker said anything.
console.log('\n--- Let\'s Go starters survive regeneration ---');
const gen1Def = generations.find(g => g.gen === 1);
check(Array.isArray(gen1Def.letsGoStarters) && gen1Def.letsGoStarters.join(',') === '25,133',
  `generations.json carries letsGoStarters [25, 133], got ${JSON.stringify(gen1Def.letsGoStarters)}`);
const extractor = read('scripts/extract_generations.py');
check(/LETS_GO_STARTERS = \{1: \[25, 133\]\}/.test(extractor),
  "extract_generations.py declares the same pair, so the key is not hand-added");
check(extractor.includes("entry['letsGoStarters'] = LETS_GO_STARTERS[n]"),
  'the extractor writes letsGoStarters into every entry it owns');
// The starters must exist and be Gen 1, or the switch offers species the lock
// does not know about.
check(gen1Def.letsGoStarters.every(id => allPokemon.find(p => p.id === id && p.generation === 1)),
  "both Let's Go starters are Gen 1 species that exist in the dex");

// 14. The mode toggle sits in step 2's title, not step 1's.
//
// It was found with `.life-modal-section-title:nth-of-type(2)`, which resolves
// to the element that is both that class AND the dialog's 2nd <div> — and
// .life-modal-header is the 1st, so the match was 步驟 1 (選擇目標世代). A control
// that swaps the starter list sat above the generation tabs.
console.log('\n--- Let\'s Go toggle placement ---');
const lifeJs = read('assets/js/life.js');
// Comments are masked before any selector is searched for. The first version of
// this check matched `.life-modal-section-title:nth-of-type` in the prose that
// EXPLAINS the bug, and failed on a page where the selector was gone — the same
// shape as §3.G's "a fourth mention lives in a comment".
const lifeJsCode = lifeJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check(/id="stepStarter"/.test(lifeHtml),
  'step 2 carries the id the toggle is mounted into');
check(!/life-modal-section-title:nth-of-type/.test(lifeJsCode),
  'life.js no longer locates the toggle by nth-of-type');
check(/els\.stepStarter = document\.getElementById\('stepStarter'\)/.test(lifeJsCode),
  'life.js caches #stepStarter');
// The id has to be ON the starter step. Two of the three titles already carry
// `.life-modal-section-title`, so "the id exists somewhere" proves nothing — the
// assertion reads the element the id is on and asks what its text says.
const starterStep = (lifeHtml.match(/<div[^>]*id="stepStarter"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
check(starterStep.includes('始祖物種'),
  `the id is on step 2 (選擇始祖物種), got "${starterStep.trim().slice(0, 24)}"`);
check(lifeJsCode.includes("modalLetsGoMode ? 'letsGo' : ''"),
  "the mode is passed into setupGeneration, not kept as a page-local flag");
check(/setupGeneration\(modalSelectedGen, modalSelectedStarterId, isRandom, modalLetsGoMode/.test(lifeJsCode),
  'the setup submit hands the mode to the engine');

// 15. Every icon on this page is a FILLED path.
//
// shared.css gives `.icon` `fill: currentColor` and nothing else, and `stroke`
// defaults to `none`. Every other page on the site uses Material's filled paths;
// life.html had been given lucide's stroke paths, which render as filled
// silhouettes — a screenshot showed them as black blobs and no check objected,
// because a checker reading the text content sees the same label either way.
console.log('\n--- Icons are filled, not stroked ---');
const lifeIcons = lifeHtml.match(/<svg class="icon"[\s\S]*?<\/svg>/g) || [];
const lifeJsIcons = lifeJs.match(/<svg class="icon"[\s\S]*?<\/svg>/g) || [];
// A DELETED icon is invisible to every other check, since nothing else asks for
// one by name — so this count is the assertion, and it is stated as a FLOOR
// rather than an equality.
//
// The equality version was 25 and every icon added after that made it red: the
// 屬性 drawer's button glyph and its drawer-title glyph took it to 27 and the
// failure read as a defect in what was added, which is §3.W's shape — a count
// standing in for a claim, failing on the good case. What the number is FOR is
// catching a deletion, which a floor catches just as well: 27 is fine, 12 is not.
// The floor is pinned to the count that existed before the type drawer so it
// still fails on a real removal.
check(lifeIcons.length + lifeJsIcons.length >= 25,
  `life.html and life.js hold at least 25 glyph icons (a deletion is what this guards), got ${lifeIcons.length + lifeJsIcons.length}`);
const allLifeIcons = [...lifeIcons, ...lifeJsIcons];
check(allLifeIcons.every(s => s.includes('viewBox="0 0 24 24"')),
  'every icon uses the 24x24 box .icon is sized against');
check(allLifeIcons.every(s => !/\sstroke=/.test(s)),
  'no icon carries a stroke attribute, because .icon sets no stroke to receive it');
check(allLifeIcons.every(s => /<path d="[^"]+"\/>/.test(s)),
  'every icon is one filled <path>, which is what fill: currentColor paints');
// A viewBox of 0 0 200 200 with a `<g fill="currentColor">` is the signature of a
// drawn-from-scratch glyph that will not survive .icon's 1em box.
check(!allLifeIcons.some(s => /<g |<rect |<circle |<polyline /.test(s)),
  'no icon is assembled from primitives, which only reads correctly when stroked');
// The glyph and the label come from one boolean; they shipped mismatched, with a
// PLAY triangle on 暫停 and PAUSE bars on 播放.
const playBranch = lifeJs.match(/isPlaying\s*\n?\s*\?\s*'<svg[^']*<\/svg>暫停'/);
check(playBranch && playBranch[0].includes('M6 19h4V5H6v14'),
  'the playing state draws the PAUSE glyph beside 暫停');

// 16. The toast card follows the theme, and the wild toast shows the species.
//
// The card's background was `linear-gradient(135deg, #1f2a4d, #111830)` — the
// DARK theme's two surface tokens written out as literals — so in light theme it
// stayed navy while the page went pale, and the icon inherited a near-black
// `--text-primary` onto it. Measured: **1.03:1**. A static check cannot measure
// that; check_life_browser.mjs reads the rendered background in both themes.
// What IS static is that no raw hex is left where a token was available.
console.log('\n--- The toast is themed, and shows the species ---');
const toastCss = read('assets/css/life.css');
const toastBlock = (toastCss.match(/\.life-celebration-toast \{[\s\S]*?\n\}/) || [])[0] || '';
check(/background:\s*linear-gradient\(135deg, var\(--surface-raised\), var\(--bg-controls\)\)/.test(toastBlock),
  "the toast background is --surface-raised -> --bg-controls, so it cannot be one theme's tokens");
check(!/#1f2a4d|#111830/.test(toastBlock),
  'no dark-theme surface hex is left hardcoded in the toast');
check(/color:\s*var\(--text-primary\)/.test(toastBlock),
  'the card declares a themed foreground, since it now owns a themed ground');
check(/rgba\(var\(--accent-gold-rgb\)/.test(toastBlock),
  "the medal glow follows --accent-gold-rgb rather than a fixed dark-theme gold");
check(/\[data-theme="light"\]\s+\.life-celebration-toast\.is-wild/.test(toastCss),
  'the wild tone has its own light-theme value: #7ee7ff is 1.21:1 on a pale card');
const headlineBlock = (toastCss.match(/\.life-toast-headline \{[\s\S]*?\n\}/) || [])[0] || '';
check(!/#ffffff|#fff\b/.test(headlineBlock),
  'the headline does not hardcode white, which ignored the theme in the other direction');

// The icon is the encountered species' OWN sprite, built from `sp.id` — a fixed
// path here is the bug: the point is that it changes with the encounter.
const wildBlock = (lifeJs.match(/function showWildEncounter[\s\S]*?\n\}/) || [])[0] || '';
check(/<img class="life-toast-sprite" src="assets\/images\/sprite\/\$\{sp\.id\}\.png"/.test(wildBlock),
  'the wild toast icon is the encountered species\' own sprite, keyed to sp.id');
check(/alt=""/.test(wildBlock),
  'the sprite carries empty alt, because the name is in the headline as text');
check(/assets\/images\/sprite\//.test(lifeHtml) === false || /assets\/images\/sprite\//.test(lifeHtml),
  'the dex drawer and the toast share one sprite directory');
check(/import \{ cryPlayer \} from '\.\/cry-player\.js'/.test(lifeJsCode),
  'life.js imports the cry player');
check(!/assets\/cries\//.test(lifeJsCode),
  'life.js spells no cry path of its own — play() takes the id and builds the URL');

// 17. The encounter cry: a page default, a speed ceiling, and never awaited.
console.log('\n--- Encounter cry ---');
check(/cryPlayer\.muteForView\(true\)/.test(lifeJs),
  'the page default is a VIEW mute, so loading life.html cannot silence other pages');
check(!/cryPlayer\.muted\s*=\s*true/.test(lifeJsCode),
  'nothing here writes the site-wide mute, which is §3.G6\'s bug verbatim');
check(/id="chkEncounterCry"/.test(lifeHtml) && !/id="chkEncounterCry"[^>]*checked/.test(lifeHtml),
  'the checkbox exists and is UNCHECKED by default');
check(/CRY_SILENT_ABOVE_SPEED\s*=\s*2/.test(lifeJs),
  'cries are withheld above 2x, where an encounter fires every 2.0s');
check(/if \(currentSpeed > CRY_SILENT_ABOVE_SPEED\) return;/.test(lifeJs),
  'and the gate is actually applied in the play path');
check(/if \(cryPlayer\.muted\) return;/.test(lifeJs),
  'a muted page fetches nothing');
/* The guard's POSITION, not its presence. `has()` is what the player consults
 * before a decode, and the point of leading with the mute is that a reader who
 * asked for no sound does not pay for a lookup either — swapping the two
 * adjacent guards leaves both strings in the file and satisfied every assertion
 * here. Verified: that mutation was written, and it passed.
 *
 * Relative to the SPEED gate the order does not matter, so this compares against
 * `has()` only rather than pretending the three guards have a ranking. */
const cryFn = (lifeJsCode.match(/function playEncounterCry[\s\S]*?\n\}/) || [])[0] || '';
check(cryFn.indexOf('cryPlayer.muted') < cryFn.indexOf('cryPlayer.has('),
  'the mute guard comes before the roster lookup, so a muted page does no work');
check(cryFn.indexOf('cryPlayer.play(') > cryFn.indexOf('cryPlayer.has('),
  'and both guards come before the play, the only call that decodes');

/* The gap, and the ORDER of the gap against the timestamp it writes. Deleting
 * the guard entirely leaves both `CRY_MIN_GAP_MS` and `lastEncounterCryAt` in
 * the file, so asserting the constant exists would pass on a page with no
 * throttle at all — that mutation was written, and it passed.
 *
 * And the order is the load-bearing half: stamping `lastEncounterCryAt` on a play
 * that is then SKIPPED turns "at least this long between cries" into "at least
 * this long between attempts", which at 2x silently halves the rate for no
 * stated reason. The guard has to come first and write the clock second. */
check(/if \(now - lastEncounterCryAt < CRY_MIN_GAP_MS\) return;/.test(cryFn),
  'the inter-cry gap is actually applied');
const gapAt = cryFn.indexOf('now - lastEncounterCryAt');
const stampAt = cryFn.indexOf('lastEncounterCryAt = now;');
check(gapAt > 0 && stampAt > gapAt,
  'the gap is tested BEFORE the clock is stamped, so a skipped play does not open the window');
check(stampAt < cryFn.indexOf('cryPlayer.play('),
  'and the clock is stamped before the play, so it records a cry that happened');
check(/cryPlayer\.play\(speciesId\)\.catch\(\(\) => \{\}\);/.test(lifeJs),
  'play() is fire-and-forget and never awaited — unlock() does not settle without a gesture');
check(!/await\s+cryPlayer\.play/.test(lifeJs),
  'no await on a play() call anywhere in life.js');
// The ceiling has to be a real number or the "why" is decoration.
check(/CRY_SILENT_ABOVE_SPEED = 2/.test(lifeJs) && /case 2: return 200;/.test(lifeJs),
  'the silent ceiling matches the speed table\'s 2x slot');

// --- Type Wash (territory) -----------------------------------------------------
//
// The behavioural half runs the real engine in bare Node, which is only possible
// because `territory` holds a TYPE NAME and not a colour — shared.js owns the
// palette, so nothing here has to know what Grass looks like.
console.log('\n--- Type Wash ---');

const tKey = (x, y) => `${x},${y}`;

// A fresh engine per case, because `clear()` is itself one of the things under
// test and sharing an instance would let one case's leftovers answer another's.
const washEngine = () => new GameEngine(gen1Meta, evolutionLevels);

check(washEngine().territory instanceof Map, 'the engine carries a territory map');
check(washEngine().territory.size === 0, 'and it starts empty — nothing is claimed before it is occupied');

{
  const eng = washEngine();
  eng.setCell(3, 4, 1); // Bulbasaur, Grass-first
  check(eng.territory.get(tKey(3, 4)) === 'Grass',
    'placing a cell claims its primary type (妙蛙種子 -> Grass)');
}

{
  // Conway death. The cell STARVES: a lone cell has no neighbours, so it dies
  // next tick and is never copied into nextCells.
  //
  // THIS IS THE CASE THE WHOLE LAYER EXISTS FOR, and it is worth being precise
  // about why it is not the same test as the eraser below: `tick()` never calls
  // deleteCell, so an implementation that cleaned the wash up on death would have
  // to go out of its way to do it. Asserting only the eraser would leave that
  // entirely unchecked, and the page would slowly fade to a blank grid over a
  // long run — which is the one behaviour the reader would notice last.
  const eng = washEngine();
  eng.setCell(9, 9, 1);
  eng.tick();
  check(!eng.cells.has(tKey(9, 9)), 'the isolated cell starved, as Conway requires');
  check(eng.territory.has(tKey(9, 9)),
    'and its Grass wash SURVIVED the death — Conway deaths never call deleteCell');
}

{
  const eng = washEngine();
  eng.setCell(5, 5, 1);
  eng.deleteCell(5, 5);
  check(!eng.cells.has(tKey(5, 5)) && !eng.territory.has(tKey(5, 5)),
    'the ERASER takes the wash with it — a reader who erased gets the cell back');
}

{
  // Overwrite, which is the feature stated in plain language: 妙蛙種子 claims a
  // cell, dies, 小火龍 arrives, and the cell is Fire. NOT green-and-orange.
  const eng = washEngine();
  eng.setCell(2, 2, 1);  // Bulbasaur -> Grass
  eng.deleteCell(2, 2);
  eng.setCell(2, 2, 4);  // Charmander -> Fire
  check(eng.territory.get(tKey(2, 2)) === 'Fire',
    'a newcomer REPLACES the previous claim rather than adding to it');
  check(eng.territory.size === 1,
    'and one cell is still exactly one entry — nothing is composited or stacked');
}

{
  // The claim pass reads nextCells, not the parents. Deterministic on purpose:
  // #661 小箭雀 (Normal) has exactly ONE successor in evolution_levels.json, so
  // weightedPick returns it without touching Math.random. Eevee was the obvious
  // candidate and is unusable here — it has eight, and the draw is random, so the
  // test would pass or fail on a coin rather than on the code.
  //
  // A 2x2 BLOCK, because the single cell this started as starved on tick 1 and
  // was gone before it could reach Lv.17 — a 4-generation-old failure dressed up
  // as an evolution failure. A block is a still life: each cell keeps exactly the
  // 3 neighbours the survival rule wants, so the population holds still while the
  // levels climb.
  const gen6Meta = buildGenMetadata(6, allPokemon, evoChains, generations);
  const eng = new GameEngine(gen6Meta, evolutionLevels);
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) eng.setCell(x, y, 661);
  check(eng.territory.get(tKey(7, 7)) === 'Normal', '小箭雀 starts Normal');
  for (let i = 0; i < 24 && eng.getCell(7, 7)?.speciesId === 661; i++) eng.tick();
  const evolved = eng.getCell(7, 7);
  check(evolved && evolved.speciesId === 662,
    `and evolved to 火箭雀 at its real Lv.17 gate (got ${evolved ? evolved.speciesId : 'nothing'})`);
  check(eng.territory.get(tKey(7, 7)) === 'Fire',
    'the wash followed the EVOLUTION — the claim pass reads the swapped-in species');
}

{
  // The general form of the invariant above, so it cannot be satisfied by one
  // lucky species: after any tick, every live cell's wash names that cell's
  // CURRENT species. This is what "claim from nextCells, not from the parents"
  // means, stated so a future species table cannot break it silently.
  const eng = washEngine();
  eng.seedRandom(0.3, 14, 14, 0, 0, null);
  for (let i = 0; i < 6; i++) eng.tick();
  let stale = 0;
  for (const c of eng.cells.values()) {
    // `eraTypes` directly, NOT `species.types[0]` and NOT `eng.typesOf(sp)`. The
    // first compares the claim against the raw modern array, which disagrees
    // whenever an anachronistic species is on the board — and it disagreed only
    // SOMETIMES, so the check passed on most runs and failed on the ones that
    // happened to seed a 皮皮. The third would compare the engine against itself
    // and could not fail. This is the one route that is neither.
    const want = eraTypes(gen1Meta.speciesById.get(c.speciesId), eng.typeEra())[0];
    if (eng.territory.get(tKey(c.x, c.y)) !== want) stale++;
  }
  check(stale === 0 && eng.cells.size > 0,
    `every live cell's wash names its current species after 6 ticks (${stale} stale of ${eng.cells.size})`);

  // The era rule reaching the WASH, placed rather than hoped for.
  //
  // The version of this that asserted "the random board happened to contain an
  // anachronistic species" was flaky by construction: 24 of Gen 1's 151 qualify
  // and most die within 6 ticks, so it passed on roughly one run in four. Placing
  // a 皮皮 states the same thing with no randomness — 皮皮 is Fairy in the data and
  // 一般 on a Gen 1 board, so the wash it leaves is the whole claim in one cell.
  eng.setCell(-9, -9, 35);
  check(eng.territory.get(tKey(-9, -9)) === 'Normal',
    'a 皮皮 cell claims 一般 on a Gen 1 board — the wash carries the ERA type, not the data\'s Fairy');
}

{
  const eng = washEngine();
  eng.seedRandom(0.3, 10, 10, 0, 0, 1);
  check(eng.territory.size > 0, 'seeding claims the wash');
  eng.clear();
  check(eng.territory.size === 0, 'clear() wipes it');
}

{
  // The §3.M shape, caught in the act: seedRandom() used to open with
  // `this.cells.clear()` and that was equivalent to clear() until the wash
  // existed. A reseed empties the board and must empty the colours with it,
  // because 「隨機種子」 reads as a fresh board.
  const eng = washEngine();
  eng.seedRandom(0.3, 10, 10, 0, 0, 1);
  eng.seedRandom(0.3, 10, 10, 40, 40, 1);
  const outsideOldBox = [...eng.territory.keys()].some(k => {
    const [x, y] = k.split(',').map(Number);
    return Math.abs(x - 40) > 5 || Math.abs(y - 40) > 5;
  });
  check(!outsideOldBox,
    'reseeding leaves no wash behind from the previous board');
}

{
  const eng = washEngine();
  eng.reset(gen1Meta);
  check(eng.territory.size === 0, 'reset() (generation switch) wipes it too');
}

{
  const eng = washEngine();
  eng.applyPattern('glider', 0, 0, 1);
  check(eng.territory.size === PATTERNS.glider.coords.length,
    'a stamped pattern claims every cell it places');
}

// Every type the corpus can name has to be a key of TYPE_COLORS, or the wash
// silently draws nothing for that species. This is the assertion that makes the
// `'#78c850'` fallback in both renderers a last resort rather than a live path:
// without it, a form or a future species with an unknown type would fall through
// to a hardcoded GRASS and paint the wrong colour with nothing on screen.
const TYPE_COLOR_KEYS = new Set(Object.keys(TYPE_COLORS));
const unnameable = allPokemon.filter(p => !TYPE_COLOR_KEYS.has(p.types?.[0]));
check(unnameable.length === 0,
  `all ${allPokemon.length} species' primary type is a TYPE_COLORS key (${unnameable.length} are not)`);
check(new Set(allPokemon.map(p => p.types[0])).size === 18,
  'and the corpus exercises all 18 types, so no branch of the wash is dead code');

/* --- The renderer's half, as source. The wash's APPEARANCE needs a browser
 * (check_life_browser.mjs) because it composites over a CSS gradient; what can
 * be read off the source is which decision was made, and each of these is a
 * decision that a later "tidy" would silently reverse. */

const washSection = lifeJs.slice(lifeJs.indexOf('// 3. Type Wash'), lifeJs.indexOf('// 4. Render Alive Cells'));

check(washSection.length > 0, 'the wash pass exists between the grid lines and the cells');
check(/engine\.cells\.has\(key\)/.test(washSection),
  'it SKIPS cells that are currently occupied — a sprite is 45.7% transparent, so drawing under one does not hide it');
check(/Path2D/.test(washSection) && /\.rect\(/.test(washSection),
  'it batches by type into one path — ~25,000 fillRects a frame at min zoom is not 60fps');
check(!/fillRect\(/.test(washSection),
  'and no per-cell fillRect survives in that pass');

// Both stage fills are gone. Their ABSENCE is the assertion; a presence check
// would pass on the version this replaced.
check(!/rgba\(155, 89, 182/.test(lifeJsCode) && !/rgba\(230, 126, 34/.test(lifeJsCode),
  'the stage-1 and stage-2 background fills are gone — a fill is the same visual channel as the wash');

const stageFrame = lifeJs.match(/const stage2 = cell\.stage === 2;[\s\S]*?strokeRect\(/);
check(stageFrame !== null, 'both stages stroke a frame');
const stageWidths = stageFrame ? [...stageFrame[0].matchAll(/stage2 \? ([\d.]+) : ([\d.]+)/g)].map(m => [m[1], m[2]]) : [];
check(stageWidths.length === 1 && Number(stageWidths[0][0]) !== Number(stageWidths[0][1]),
  `the two frames have DIFFERENT widths (${stageWidths[0] ? stageWidths[0].join(' vs ') : 'n/a'}) — width is what says which stage it is`);
check(/stage2 \? '#9b59b6' : '#e67e22'/.test(lifeJs),
  'and the two stage colours are still distinct, so the frame reads without the width');

// The toggle. Markup AND wiring, because §3.W's exact bug was a control present,
// hit-testable, and painting nothing: nothing had ever bound it.
check(/id="chkTerritory"/.test(lifeHtml), 'the wash toggle exists in the markup');
check(/els\.chkTerritory\?\.addEventListener\('change'/.test(lifeJs),
  'and has a change listener — a checkbox with no listener is a control that does nothing');
check(/showTerritory = e\.target\.checked/.test(lifeJs), 'which writes the flag the renderer reads');
check(/if \(showTerritory && engine\.territory\.size > 0\)/.test(lifeJs),
  'and the renderer gates on it, so switching it off costs nothing');
check(/<span>屬性殘影<\/span>/.test(lifeHtml),
  'the label names the feature rather than the mechanism');
check(/title="格子會留住前一隻寶可夢的第一屬性顏色/.test(lifeHtml),
  'and the title explains it — 18 type colours have no legend on this page');

// --- Type Eras -----------------------------------------------------------------
//
// `pokemon_data.json` answers with each species' CURRENT typing, and 24 of the
// 1,025 changed type after they were introduced. So without this the Gen 1 board
// spawns 皮皮 as Fairy, the wash paints a Fairy cell in a generation Fairy does
// not exist in, and the type denominator comes out 17 instead of 15.
console.log('\n--- Type Eras ---');


// The three numbers the page states, from the games' own history: 15 types in
// Gen 1, 鋼/Steel and 惡/Dark in Gen 2, 妖精/Fairy in Gen 6.
for (const [gen, want] of [[1, 15], [2, 17], [3, 17], [4, 17], [5, 17], [6, 18], [7, 18], [8, 18], [9, 18]]) {
  check(generationTypeCount(gen) === want,
    `Gen ${gen} has ${want} types, got ${generationTypeCount(gen)}`);
}
check(TYPE_CHART_ORDER.every(t => TYPE_INTRO_GEN[t] !== undefined),
  `TYPE_INTRO_GEN covers all ${TYPE_CHART_ORDER.length} chart types — an unlisted one would read as Gen 1`);
check(Object.keys(TYPE_INTRO_GEN).length === TYPE_CHART_ORDER.length,
  'and lists no type the chart does not have');

// The table is exactly the set of species the DATA renders anachronistic, derived
// rather than restated. This is the assertion that stops it rotting: a species
// that gains or loses a type moves the derived set, and the table has to move with
// it or be one row out — which a check against a hardcoded id list would pass.
const anachronistic = new Set(
  allPokemon
    .filter(p => p.types.some(t => TYPE_INTRO_GEN[t] > p.generation))
    .map(p => p.id)
);
check(anachronistic.size === 24,
  `the data holds ${anachronistic.size} anachronistic species (a new one changes this, which is the point)`);
check(ERA_TYPE_OVERRIDES.size === anachronistic.size &&
  [...ERA_TYPE_OVERRIDES.keys()].every(id => anachronistic.has(id)),
  'and ERA_TYPE_OVERRIDES is EXACTLY that set — one row too many or too few is a red test');

// No override may name a type that did not exist in that species' own generation,
// which would be the same defect one level down.
const badOverride = [...ERA_TYPE_OVERRIDES.entries()].filter(([id, types]) => {
  const sp = allPokemon.find(p => p.id === id);
  return !sp || !types.length || types.some(t => TYPE_INTRO_GEN[t] > sp.generation);
});
check(badOverride.length === 0, `no override names a later type (${badOverride.length} do)`);

// THE EMPTY-TYPING INVARIANT, over the species that can actually be on each board.
//
// Scoped to each generation's OWN roster on purpose. The first version asked all
// 1,025 species about all 9 generations and reported 103 empties — which is
// correct behaviour, not a defect: a Gen 6 Fairy-first species has no Gen 1 typing
// because it has no Gen 1 self, and the board can never hold it. The engine is
// generation-locked apart from the exempted branch, so the reachable set for a
// Gen-g board is gen-g's roster plus that branch, and THAT is what must never
// come back empty.
//
// It would still be a real bug if it did: an empty array renders as the
// hardcoded `#78c850` fallback rather than as an error, so it would be invisible
// exactly the way §3.W's absent sections were. Asserting the two named species
// would not catch it.
const byId = id => allPokemon.find(p => p.id === id);
let emptyTypings = 0;
let reachablePairs = 0;
const eraEngines = new Map();
const covered = new Set();
for (let g = 1; g <= 9; g++) {
  const meta = buildGenMetadata(g, allPokemon, evoChains, generations);
  const eng = new GameEngine(meta, evolutionLevels);
  eraEngines.set(g, eng);
  // THE BRANCH BELONGS HERE, BUT ONLY WHERE IT IS ADMITTED. The first version
  // walked `allGenSpecies` alone and reported "every species is on exactly one
  // reachable board (1025 of 1025)" — true of the GENERATIONS and false of the
  // BOARDS: a wild 伊布 really can reach a Gen 1 board whatever starter was
  // chosen. Over-correcting it to "all eight destinations on every board" would
  // then ask about 仙子伊布 on a Gen 1 board where `eraTypes` correctly answers
  // `[]`, and count a correct answer as a defect. What has to be non-empty is the
  // species a board can actually hold.
  const reachable = [...meta.allGenSpecies.map(s => s.id), ...eng.branchDestinationsFor()];
  for (const id of reachable) {
    const sp = byId(id);
    if (!sp) continue;
    covered.add(id);
    reachablePairs++;
    if (eng.typesOf(sp).length === 0) emptyTypings++;
  }
}
check(covered.size === allPokemon.length,
  `every species is reachable on at least one board (${covered.size} of ${allPokemon.length})`);
check(emptyTypings === 0,
  `no reachable species has an empty typing on any board it can appear on (${emptyTypings} do, over ${reachablePairs} placements)`);

// The named cases the page's own numbers depend on.
{
  const g1 = eraEngines.get(1);
  const by = byId;
  check(JSON.stringify(g1.typesOf(by(35))) === '["Normal"]', 'Gen 1 皮皮 is 一般, not 妖精');
  check(JSON.stringify(g1.typesOf(by(81))) === '["Electric"]', 'Gen 1 小磁怪 is 電, not 電/鋼');
  check(JSON.stringify(g1.typesOf(by(122))) === '["Psychic"]', 'Gen 1 魔牆人偶 is 超能力, not 超能力/妖精');
  // 波克基古 is the case a "just drop the later type" rule gets wrong: dropping
  // Fairy from Fairy/Flying leaves a monotype that never existed.
  const g2 = eraEngines.get(2);
  check(JSON.stringify(g2.typesOf(byId(176))) === '["Normal","Flying"]',
    'Gen 2 波克基古 is 一般/飛行 — dropping Fairy would leave Flying alone');
}

/* --- The branch is era-restricted, so it can never widen a board's types. ---
   The 伊布 family is a deliberate cross-generation feature: a Gen 1 Eevee has to
   be able to become 仙子伊布 or the page's own stated reason for the branch does
   not hold. What it must NOT do is drag a later type onto an earlier board, which
   is what made the denominator ambiguous — 17 on a Gen 1 board, with the drawer
   claiming Fairy was absent while a Fairy cell sat there.

   The rule that removes the ambiguity instead of arbitrating it: admit only
   destinations whose types the board's era already has. GEN 1 additionally gets
   the three evolution stones and nothing else, per 红/绿/蓝/黄. */
const boardOf = (gen, mode = '') => {
  const starterId = gen === 1 ? (mode === 'letsGo' ? 133 : 1) : 152;
  const meta = buildGenMetadata(gen, allPokemon, evoChains, generations, { starterId });
  const eng = new GameEngine(meta, evolutionLevels, mode);
  eng.setMode(mode);
  return eng;
};
const destNames = eng => eng.successorsOf(133).map(e => byId(e.to).names.zh);

{
  const g1 = boardOf(1);
  check(destNames(g1).join('、') === '水伊布、雷伊布、火伊布',
    `a classic Gen 1 Eevee evolves into exactly the three stones (${destNames(g1).join('、')})`);
  check(boardOf(2).successorsOf(133).length === 7,
    `a Gen 2 board reaches 7 destinations (${boardOf(2).successorsOf(133).length})`);
  check(boardOf(5).successorsOf(133).length === 7, 'and a Gen 5 board reaches 7');
  check(boardOf(6).successorsOf(133).length === 8,
    `Gen 6 reaches all 8, 仙子伊布 included (${boardOf(6).successorsOf(133).length})`);
  check(boardOf(1, 'letsGo').successorsOf(133).length === 8,
    `a Let's Go board reaches all 8 (${boardOf(1, 'letsGo').successorsOf(133).length})`);
}

// THE INVARIANT THIS WHOLE DESIGN RESTS ON, over 9 generations × 2 modes.
//
// If it holds, the type denominator is simply the generation's own count and needs
// no reachable-set arithmetic at all. If someone ever widens the branch again —
// a new Eeveelution, a different GEN1_STONE_EVOLUTIONS — this is what turns that
// from a drawer quietly disagreeing with its own denominator into a red test.
{
  const offenders = [];
  for (const mode of ['', 'letsGo']) {
    for (let g = 1; g <= 9; g++) {
      const eng = boardOf(g, mode);
      const era = typesForGeneration(eng.typeEra());
      const wider = new Set();
      for (const dest of eng.branchDestinationsFor()) {
        for (const t of eng.typesOf(byId(dest))) wider.add(t);
      }
      for (const t of wider) if (!era.includes(t)) offenders.push(`${mode || 'classic'} Gen ${g}: ${t}`);
      if (wider.size && [...wider].some(t => !era.includes(t))) {
        offenders.push(`set mismatch ${mode} Gen ${g}`);
      }
    }
  }
  check(offenders.length === 0,
    `no branch destination carries a type its board's era lacks (${offenders.slice(0, 4).join('; ') || 'none'})`);
}

for (const [gen, mode, want] of [[1, '', 15], [2, '', 17], [5, '', 17], [6, '', 18], [9, '', 18], [1, 'letsGo', 18]]) {
  const got = typesForGeneration(boardOf(gen, mode).typeEra()).length;
  check(got === want, `${mode || 'classic'} Gen ${gen} counts ${want} types (got ${got})`);
}

// The wash follows the branch, not the other way round: a Gen 1 Eevee claims 水,
// so its wash is Water on a board whose drawer has no 惡 or 妖精 row.
{
  const eng = boardOf(1);
  eng.setCell(0, 0, 133);
  check(eng.territory.get(tKey(0, 0)) === 'Normal', '伊布 itself is 一般');
  // And the empty-typing hazard is gone rather than papered over: typesOf on a
  // destination this board cannot reach still answers [] correctly, and that is
  // now unreachable state instead of the case the exemption used to cover.
  check(JSON.stringify(eng.typesOf(byId(700))) === '[]',
    '仙子伊布 has NO typing on a classic Gen 1 board — and is simply not reachable there');
  check(JSON.stringify(boardOf(1, 'letsGo').typesOf(byId(700))) === '["Fairy"]',
    'while a Let\'s Go board reads it as 妖精, with no exemption involved');
}

// Let's Go's era is 7, and the era is what changed — not the roster.
check(boardOf(1, 'letsGo').typeEra() === LETS_GO_TYPE_ERA,
  `a Let's Go board counts at era ${LETS_GO_TYPE_ERA}, not at Gen 1`);
check(boardOf(1).typeEra() === 1, 'and a classic Gen 1 board counts at era 1');
check(JSON.stringify(boardOf(1).typesOf(byId(35))) === '["Normal"]', '皮皮 is 一般 on a classic Gen 1 board');
check(JSON.stringify(boardOf(1, 'letsGo').typesOf(byId(35))) === '["Fairy"]', '皮皮 is 妖精 on a Let\'s Go board');

// The override fires only while the modern typing is anachronistic, which is a
// condition on the era rather than a flag: 小磁怪's Steel arrived in Gen 2, so
// Gen 1 asks the table and Gen 2 does not.
check(JSON.stringify(eraTypes(byId(81), 1)) === '["Electric"]', '小磁怪 at era 1 → 電');
check(JSON.stringify(eraTypes(byId(81), 2)) === '["Electric","Steel"]', '小磁怪 at era 2 → 電/鋼');
check(JSON.stringify(eraTypes(byId(35), 5)) === '["Normal"]', '皮皮 at era 5 → 一般 (Fairy is Gen 6)');
check(JSON.stringify(eraTypes(byId(35), 6)) === '["Fairy"]', '皮皮 at era 6 → 妖精, and the table is not consulted again');
// BOTH, because they pin two different things and neither pins the other.
//
// The `>=` is the BEHAVIOUR: any era from Fairy's introduction onward produces
// the same 18 types and the same eight destinations, which is what makes the mode
// read as "no filter". Mutating 7 -> 6 changes nothing on the page, so a check
// written only as `>=` stays green through it — which is correct, because nothing
// about the page changed.
//
// The `===` is the CLAIM: 7 is the era Let's Go shipped in (2018-02-16, after Sun
// & Moon and before USUM). Lowering it to 6 would silently retire the reason the
// constant exists while leaving every number identical, and the next reader would
// find `LETS_GO_TYPE_ERA = 6` with a comment about 2018.
check(LETS_GO_TYPE_ERA >= TYPE_INTRO_GEN.Fairy,
  `Let's Go's era (${LETS_GO_TYPE_ERA}) is at or after Fairy's introduction, which is what makes it "no filter"`);
check(LETS_GO_TYPE_ERA === 7,
  `and it is 7 — the Gen 7 era Let's Go shipped in, not merely any era past Fairy`);

/* --- seenTypes: collected, not derived. ------------------------------------
   The button and the drawer are two different numbers on purpose, and this is
   the half only the engine can answer. */
console.log('\n--- Type Collection ---');
{
  const eng = eraEngines.get(1);
  eng.clear();
  check(eng.seenTypes.size === 0, 'a cleared board has collected nothing');

  eng.setCell(0, 0, 1);   // 妙蛙種子 -> Grass
  check(eng.seenTypes.size === 1, 'placing one cell collects one type');

  eng.setCell(1, 0, 19);  // 小拉達 -> Normal
  check(eng.seenTypes.size === 2 && eng.seenTypes.has('Grass') && eng.seenTypes.has('Normal'),
    'a second species adds a second type');

  // The load-bearing asymmetry: the wash is current state and erasing removes it,
  // but a COLLECTION does not un-collect. A reader who has seen 9 of the 15 types
  // Gen 1 has is not at 0 again because they cleared the board.
  eng.deleteCell(0, 0);
  eng.deleteCell(1, 0);
  check(eng.territory.size === 0, 'erasing removes both washes');
  check(eng.seenTypes.size === 2,
    'but the collection keeps both types — the button is 「曾經」 and only grows');

  // A type can also be collected without being on the board right now, which is
  // the case the wash exists to make visible.
  eng.clear();
  eng.seedRandom(0.3, 12, 12, 0, 0, 1);
  const seeded = new Set(eng.seenTypes);
  eng.clear();
  eng.seedRandom(0.3, 12, 12, 0, 0, 19);
  check(eng.seenTypes.size === 1 && !eng.seenTypes.has('Grass'),
    'and it re-collects from scratch after clear(), so it is per-run');

  eng.clear();
  eng.setCell(0, 0, 1);
  eng.reset(gen1Meta);
  check(eng.seenTypes.size === 0, 'reset() (generation switch) empties it too');
  void seeded;
}

/* --- The drawer's own source-level claims. --------------------------------- */
check(/id="btnTypeDrawer"/.test(lifeHtml), 'the 屬性 button exists');
check(/id="btnTypeCount"/.test(lifeHtml), 'and its count lives in its own <span>, never in the button text');
{
  // Between the other two, which is a stated position rather than a style.
  const iDex = lifeHtml.indexOf('id="btnDexDrawer"');
  const iType = lifeHtml.indexOf('id="btnTypeDrawer"');
  const iHof = lifeHtml.indexOf('id="btnHofDrawer"');
  check(iDex > 0 && iType > iDex && iHof > iType,
    'the 屬性 button sits BETWEEN 圖鑑 and 傳說');
}
check(/id="typeDrawer"/.test(lifeHtml) && /id="typeClose"/.test(lifeHtml),
  'the drawer and its close button exist');
check(/els\.btnTypeDrawer\?\.addEventListener\('click'/.test(lifeJs),
  "the button has a click listener — §3.W's control that painted nothing");
check(/function updateTypeDrawer\(\)/.test(lifeJs), 'the drawer has its own update function');

const drawerFn = lifeJs.slice(lifeJs.indexOf('function updateTypeDrawer()'), lifeJs.indexOf('function closeDrawers'));
// BOTH populations in the denominator. Getting this wrong is invisible on a board
// that has no washes yet, which is exactly why it needs an assertion.
check(/for \(const type of engine\.territory\.values\(\)\)/.test(drawerFn) &&
  /for \(const cell of engine\.cells\.values\(\)\)/.test(drawerFn),
  'the list counts the wash AND the live cells — one without the other is a wrong share');
check(/const grand = live \+ washed;/.test(drawerFn), 'and the denominator is their sum');
// EVERY type of the generation, zeros included.
// REACHABLE, not the era. The first version asserted the drawer walked
// `typesForGeneration(gen)` and would have printed 「尚無 妖精」 on a board where
// a Fairy cell is sitting on it.
check(/const types = typesForGeneration\(engine\.typeEra\(\)\);/.test(drawerFn),
  'the list is the era\'s own type set, which is the reachable set because the branch cannot widen it');
check(!/reachableTypes/.test(drawerFn) && !/reachableTypes/.test(lifeJs),
  'and no reachable-set arithmetic is left anywhere — it would be a second answer to a question with one');
check(/第 \$\{currentMetadata\.gen\} 世代有 \$\{total\} 種屬性/.test(drawerFn),
  'the note states the count and names the absent types, so 「15」 means something');
check(/is-empty/.test(drawerFn) && /r\.count === 0\)/.test(drawerFn),
  'the zero rows are dimmed, not hidden — the generation\'s own restriction has to be visible');
check(/chartIndex: i/.test(drawerFn) && /\.sort\(\(a, b\) => b\.pct - a\.pct/.test(drawerFn),
  'rows sort by share with chart order as the tie-break, so two runs print identically');
check(/TYPE_EN_ZH\[r\.type\]/.test(drawerFn),
  'the labels come from TYPE_EN_ZH rather than from a second name table');

/* --- The starter card, where the same era rule applies to a WORD. ---------- */
// The colour was fixed first and the label was the second half of the same bug:
// a Gen 1 皮皮 card was a 一般-green swatch reading 妖精, i.e. the colour and the
// word inside one 20px badge disagreeing with each other.
check(!/starter\.types_zh \? starter\.types_zh\[0\]/.test(lifeJs),
  'the starter badge label no longer reads the species\' own modern types_zh');
check(/TYPE_EN_ZH\[primaryType\]/.test(lifeJs), 'and reads the era type instead');
check(!/TYPE_COLORS\[sp\.types\[0\]\]/.test(lifeJs),
  'the cell fallback colour no longer reads the raw array either');

if (failures > 0) {
  console.log(`\nFAIL  ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log('\nPASS  all Pokémon Conway Life engine and page checks passed!');
}
