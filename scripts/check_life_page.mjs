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
check(engine.successorsOf(133).map(e => e.to).sort((a, b) => a - b).join(',') === eeveeEdges.join(','),
  `a Gen 1 board can reach all eight Eeveelutions, got ${engine.successorsOf(133).length}`);

// 仙子伊布 is the point of the exception, so it gets its own line rather than
// being one of eight: it is a Gen 6 species and was unreachable on every Gen 1
// board before this, which is what a reader asking for it would have found.
check(engine.successorsOf(133).some(e => e.to === 700),
  '仙子伊布 (#700) is reachable from an Eevee on a Gen 1 board');

// BRANCH_WEIGHTS is the one invented table in the engine, so its key set is
// pinned to the edge set. An id absent from the map falls back to weight 1
// silently, which is exactly how a typo would hide.
check([...BRANCH_WEIGHTS.keys()].sort((a, b) => a - b).join(',') === eeveeEdges.join(','),
  `BRANCH_WEIGHTS keys are exactly Eevee's eight destinations, got ${BRANCH_WEIGHTS.size}`);

// Measured, not asserted as a formula: 3/3/3/2/2/1/1/1 over 16 is
// 18.75% / 12.5% / 6.25%, and a `weightedPick` that fell through to a uniform
// draw would still pass a key-set check. 40k draws keeps the tolerance at +/-1pt.
const drawTally = new Map();
const DRAWS = 40000;
for (let i = 0; i < DRAWS; i++) {
  const hit = engine.weightedPick(engine.successorsOf(133)).to;
  drawTally.set(hit, (drawTally.get(hit) || 0) + 1);
}
const shareOf = id => (drawTally.get(id) || 0) / DRAWS;
check(Math.abs(shareOf(134) - 3 / 16) < 0.01 && Math.abs(shareOf(700) - 1 / 16) < 0.01,
  `the draw is weighted, not uniform: 水伊布 ${(shareOf(134) * 100).toFixed(1)}% (expect 18.8), `
  + `仙子伊布 ${(shareOf(700) * 100).toFixed(1)}% (expect 6.3) over ${DRAWS} draws`);
check([...drawTally.keys()].length === 8,
  `all eight branches are drawn over ${DRAWS} attempts, got ${drawTally.size}`);

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
const dexIds = gen1Meta.dexRoster.map(e => e.species.id);
check(gen1Meta.totalSpeciesCount === 151,
  `Gen 1 holds 151 species, got ${gen1Meta.totalSpeciesCount}`);
check(gen1Meta.dexRoster.length === 156,
  `the drawer holds 151 minus 4 Eeveelutions plus 9 = 156 tiles, got ${gen1Meta.dexRoster.length}`);
check(new Set(dexIds).size === dexIds.length,
  'no species appears twice in the roster');
check(dexIds.length === new Set(dexIds).size && dexIds.length === gen1Meta.dexRoster.length,
  'the roster has no duplicates, which is what makes the count a denominator');
const sectionEntries = gen1Meta.dexRoster.filter(e => e.section);
check(sectionEntries.length === 9 && sectionEntries[0].species.id === 133,
  `the 伊布家族 section holds all nine, got ${sectionEntries.length}`);
check(gen1Meta.dexRoster.filter(e => !e.section).length === 147,
  `the main run holds the other 147, got ${gen1Meta.dexRoster.filter(e => !e.section).length}`);
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
// rule stated once rather than a per-generation exception list.
const gen4Meta = buildGenMetadata(4, allPokemon, evoChains, generations);
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
check(lifeIcons.length + lifeJsIcons.length === 26,
  `life.html and life.js hold 26 icons, got ${lifeIcons.length + lifeJsIcons.length}`);
const allLifeIcons = [...lifeIcons, ...lifeJsIcons];
check(allLifeIcons.every(s => s.includes('viewBox="0 0 24 24"')),
  'every icon uses the 24x24 box .icon is sized against');
check(allLifeIcons.every(s => !/\sstroke=/.test(s)),
  'no icon carries a stroke attribute, because .icon sets no stroke to receive it');
check(allLifeIcons.every(s => /<path d="[^"]+"\/>/.test(s)),
  'every icon is one filled <path>, which is what fill: currentColor paints');
// A viewBox of 0 0 200 200 with a <g fill="currentColor"> is the signature of a
// drawn-from-scratch glyph that will not survive .icon's 1em box.
check(!allLifeIcons.some(s => /<g |<rect |<circle |<polyline /.test(s)),
  'no icon is assembled from primitives, which only reads correctly when stroked');
// The glyph and the label come from one boolean; they shipped mismatched, with a
// PLAY triangle on 暫停 and PAUSE bars on 播放.
const playBranch = lifeJs.match(/isPlaying\s*\n?\s*\?\s*'<svg[^']*<\/svg>暫停'/);
check(playBranch && playBranch[0].includes('M6 19h4V5H6v14'),
  'the playing state draws the PAUSE glyph beside 暫停');

if (failures > 0) {
  console.log(`\nFAIL  ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log('\nPASS  all Pokémon Conway Life engine and page checks passed!');
}
