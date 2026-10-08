/**
 * Pokémon Conway's Game of Life — Core Automata & Genetics Engine
 *
 * Implements:
 * 1. Infinite sparse grid Map<string, Cell>
 * 2. Moore neighborhood Conway 4-rule evolution
 * 3. Dominant family genetics & inheritance on reproduction
 * 4. Age-based multi-stage evolution (Age >= 5 -> Stage 1, Age >= 12 -> Stage 2)
 * 5. Single-stage veteran tenure handling
 * 6. Wild encounter mutator (1%~3% probability)
 * 7. Generation locking & Legendary Medals unlock milestones (1 medal per 6 families)
 * 8. Classical Conway stamp patterns
 */

// Classical Conway patterns (coordinates relative to top-left / center)
export const PATTERNS = {
  glider: {
    id: 'glider',
    name: '滑翔翼 (Glider)',
    desc: '最著名的微型太空船，沿對角線持續前進',
    coords: [
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 }
    ]
  },
  lwss: {
    id: 'lwss',
    name: '輕型太空船 (LWSS)',
    desc: '正交方向前進的飛行陣型（週期 4）',
    coords: [
      { x: 1, y: 0 }, { x: 4, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 4, y: 2 },
      { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }
    ]
  },
  pulsar: {
    id: 'pulsar',
    name: '脈衝星 (Pulsar)',
    desc: '經典的大型週期 3 震盪器，如同呼吸般律動',
    coords: [
      // Top left quadrant
      { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 0, y: 2 }, { x: 5, y: 2 },
      { x: 0, y: 3 }, { x: 5, y: 3 },
      { x: 0, y: 4 }, { x: 5, y: 4 },
      { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
      // Top right quadrant
      { x: 8, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 },
      { x: 7, y: 2 }, { x: 12, y: 2 },
      { x: 7, y: 3 }, { x: 12, y: 3 },
      { x: 7, y: 4 }, { x: 12, y: 4 },
      { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 },
      // Bottom left quadrant
      { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 },
      { x: 0, y: 8 }, { x: 5, y: 8 },
      { x: 0, y: 9 }, { x: 5, y: 9 },
      { x: 0, y: 10 }, { x: 5, y: 10 },
      { x: 2, y: 12 }, { x: 3, y: 12 }, { x: 4, y: 12 },
      // Bottom right quadrant
      { x: 8, y: 7 }, { x: 9, y: 7 }, { x: 10, y: 7 },
      { x: 7, y: 8 }, { x: 12, y: 8 },
      { x: 7, y: 9 }, { x: 12, y: 9 },
      { x: 7, y: 10 }, { x: 12, y: 10 },
      { x: 8, y: 12 }, { x: 9, y: 12 }, { x: 10, y: 12 }
    ]
  },
  blinker: {
    id: 'blinker',
    name: '閃爍燈 (Blinker)',
    desc: '週期 2 的基礎震盪條',
    coords: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }
    ]
  },
  toad: {
    id: 'toad',
    name: '蟾蜍 (Toad)',
    desc: '雙排 6 格週期 2 震盪器',
    coords: [
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }
    ]
  },
  beacon: {
    id: 'beacon',
    name: '信標 (Beacon)',
    desc: '對角閃爍的週期 2 震盪器',
    coords: [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
      { x: 2, y: 2 }, { x: 3, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }
    ]
  },
  gliderGun: {
    id: 'gliderGun',
    name: '高斯帕滑翔翼槍 (Gosper Gun)',
    desc: '無限生產滑翔翼的經典發射機',
    coords: [
      { x: 24, y: 0 },
      { x: 22, y: 1 }, { x: 24, y: 1 },
      { x: 12, y: 2 }, { x: 13, y: 2 }, { x: 20, y: 2 }, { x: 21, y: 2 }, { x: 34, y: 2 }, { x: 35, y: 2 },
      { x: 11, y: 3 }, { x: 15, y: 3 }, { x: 20, y: 3 }, { x: 21, y: 3 }, { x: 34, y: 3 }, { x: 35, y: 3 },
      { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 10, y: 4 }, { x: 16, y: 4 }, { x: 20, y: 4 }, { x: 21, y: 4 },
      { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 10, y: 5 }, { x: 14, y: 5 }, { x: 16, y: 5 }, { x: 17, y: 5 }, { x: 22, y: 5 }, { x: 24, y: 5 },
      { x: 10, y: 6 }, { x: 16, y: 6 }, { x: 24, y: 6 },
      { x: 11, y: 7 }, { x: 15, y: 7 },
      { x: 12, y: 8 }, { x: 13, y: 8 }
    ]
  }
};

/**
 * Build Generation-locked metadata from master data
 * @param {number} gen - 1 to 9
 * @param {Array} allPokemon - 1025 master records
 * @param {Object} evolutionChains - evolution_chains.json
 * @param {Array} generations - generations.json
 */
export function buildGenMetadata(gen, allPokemon, evolutionChains, generations) {
  const genNum = Number(gen);
  const genSpecies = allPokemon.filter(p => p.generation === genNum);
  const speciesById = new Map(allPokemon.map(p => [p.id, p]));

  // Legendary / Mythical roster for achievement medals
  const legendaries = genSpecies
    .filter(p => p.is_legendary || p.is_mythical)
    .sort((a, b) => a.id - b.id);

  // Starters of this generation
  const genDef = generations.find(g => g.gen === genNum);
  const starterIds = genDef ? genDef.starters : [];
  const starters = starterIds.map(id => speciesById.get(id)).filter(Boolean);

  // Group non-legendary species by evolution family (evolution_chain_id)
  const nonLegendaries = genSpecies.filter(p => !p.is_legendary && !p.is_mythical);
  const familiesMap = new Map();

  for (const p of nonLegendaries) {
    const famId = p.evolution_chain_id;
    if (!familiesMap.has(famId)) {
      familiesMap.set(famId, []);
    }
    familiesMap.get(famId).push(p);
  }

  // Build structured family trees for this generation
  const familyTrees = new Map();
  const baseSpeciesList = [];

  for (const [famId, members] of familiesMap.entries()) {
    const chain = evolutionChains[String(famId)];
    const mainLine = chain ? chain.main_line.filter(m => m.id <= 1025) : [];

    // Map member stages based on evolution_chains mainLine
    const memberStages = members.map(m => {
      const node = mainLine.find(n => n.id === m.id);
      return {
        species: m,
        rawStage: node ? node.stage : 1
      };
    }).sort((a, b) => a.rawStage - b.rawStage || a.species.id - b.species.id);

    // Group into distinct stages in this generation
    const uniqueRawStages = [...new Set(memberStages.map(ms => ms.rawStage))];
    const stage0Members = memberStages.filter(ms => ms.rawStage === uniqueRawStages[0]).map(ms => ms.species);
    const stage1Members = uniqueRawStages.length > 1
      ? memberStages.filter(ms => ms.rawStage === uniqueRawStages[1]).map(ms => ms.species)
      : [];
    const stage2Members = uniqueRawStages.length > 2
      ? memberStages.filter(ms => ms.rawStage === uniqueRawStages[2]).map(ms => ms.species)
      : [];

    const baseSpecies = stage0Members[0];
    baseSpeciesList.push(baseSpecies);

    const isSingleStage = uniqueRawStages.length === 1;

    familyTrees.set(famId, {
      familyId: famId,
      base: baseSpecies,
      stage0: stage0Members,
      stage1: stage1Members,
      stage2: stage2Members,
      isSingleStage,
      allMembers: members
    });
  }

  return {
    gen: genNum,
    region: genDef ? genDef.region : '',
    totalSpeciesCount: genSpecies.length,
    allGenSpecies: genSpecies,
    speciesById,
    starters,
    legendaries,
    familyTrees,
    baseSpeciesList
  };
}

/**
 * Key for cell position in sparse Map
 */
export const cellKey = (x, y) => `${x},${y}`;

/**
 * Parse key back into coordinates
 */
export const parseKey = key => {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
};

/**
 * Game of Life Automata Engine
 */
export class GameEngine {
  constructor(metadata) {
    this.metadata = metadata;
    this.cells = new Map(); // key -> Cell
    this.generation = 0;
    this.unlockedFamilies = new Set();
    this.unlockedSpecies = new Set();
    this.unlockedMedalIds = new Set();
    this.unlockedMedals = []; // ordered list of earned legendary medals
    this.wildEncounterCount = 0;
    this.isWildEnabled = true;
    this.wildRate = 0.02; // 2% chance per tick

    // Pre-build quick lookup for species to family
    this.speciesFamilyMap = new Map();
    for (const [famId, tree] of this.metadata.familyTrees.entries()) {
      for (const m of tree.allMembers) {
        this.speciesFamilyMap.set(m.id, {
          familyId: famId,
          tree
        });
      }
    }
  }

  /**
   * Reset the engine with fresh or updated metadata
   */
  reset(newMetadata = null) {
    if (newMetadata) {
      this.metadata = newMetadata;
      this.speciesFamilyMap = new Map();
      for (const [famId, tree] of this.metadata.familyTrees.entries()) {
        for (const m of tree.allMembers) {
          this.speciesFamilyMap.set(m.id, {
            familyId: famId,
            tree
          });
        }
      }
    }
    this.cells.clear();
    this.generation = 0;
    this.unlockedFamilies.clear();
    this.unlockedSpecies.clear();
    this.unlockedMedalIds.clear();
    this.unlockedMedals = [];
    this.wildEncounterCount = 0;
  }

  /**
   * Place a cell at (x, y)
   */
  setCell(x, y, speciesId, options = {}) {
    const famInfo = this.speciesFamilyMap.get(speciesId);
    const familyId = famInfo ? famInfo.familyId : (this.metadata.speciesById.get(speciesId)?.evolution_chain_id || 0);

    // Determine initial stage
    let stage = 0;
    if (famInfo) {
      if (famInfo.tree.stage2.some(m => m.id === speciesId)) stage = 2;
      else if (famInfo.tree.stage1.some(m => m.id === speciesId)) stage = 1;
    }

    const cell = {
      x,
      y,
      speciesId,
      familyId,
      stage: options.stage ?? stage,
      age: options.age ?? 0,
      evolvedAtGen: options.evolvedAtGen ?? null,
      isVeteran: famInfo ? famInfo.tree.isSingleStage : false
    };

    const key = cellKey(x, y);
    this.cells.set(key, cell);

    this.recordDiscovery(speciesId, familyId);
    return cell;
  }

  /**
   * Remove a cell at (x, y)
   */
  deleteCell(x, y) {
    this.cells.delete(cellKey(x, y));
  }

  /**
   * Check if a cell exists at (x, y)
   */
  getCell(x, y) {
    return this.cells.get(cellKey(x, y));
  }

  /**
   * Clear all cells
   */
  clear() {
    this.cells.clear();
    this.generation = 0;
  }

  /**
   * Record that a species & family appeared
   */
  recordDiscovery(speciesId, familyId) {
    this.unlockedSpecies.add(speciesId);
    if (familyId > 0) {
      this.unlockedFamilies.add(familyId);
      this.checkMedalProgress();
    }
  }

  /**
   * Check if legendary medals are earned (1 medal per 6 distinct families)
   */
  checkMedalProgress() {
    const earnedCount = Math.floor(this.unlockedFamilies.size / 6);
    const available = this.metadata.legendaries;
    const maxMedals = Math.min(earnedCount, available.length);

    while (this.unlockedMedals.length < maxMedals) {
      const nextMedal = available[this.unlockedMedals.length];
      if (nextMedal && !this.unlockedMedalIds.has(nextMedal.id)) {
        this.unlockedMedalIds.add(nextMedal.id);
        this.unlockedMedals.push(nextMedal);
        return nextMedal; // Newly unlocked medal
      }
    }
    return null;
  }

  /**
   * Randomize grid with specified density in a given bounding box
   */
  seedRandom(density = 0.20, width = 30, height = 24, centerX = 0, centerY = 0, defaultSpeciesId = null) {
    this.cells.clear();
    this.generation = 0;

    const startX = Math.floor(centerX - width / 2);
    const startY = Math.floor(centerY - height / 2);

    const basePool = this.metadata.baseSpeciesList;
    if (basePool.length === 0) return;

    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (Math.random() < density) {
          const x = startX + dx;
          const y = startY + dy;
          const chosenSpecies = defaultSpeciesId
            ? defaultSpeciesId
            : basePool[Math.floor(Math.random() * basePool.length)].id;
          this.setCell(x, y, chosenSpecies);
        }
      }
    }
    this.checkMedalProgress();
  }

  /**
   * Stamp a classical pattern onto the grid
   */
  applyPattern(patternKey, originX, originY, defaultSpeciesId = null) {
    const pattern = PATTERNS[patternKey];
    if (!pattern) return;

    const chosenSpecies = defaultSpeciesId
      ? defaultSpeciesId
      : (this.metadata.baseSpeciesList[0]?.id || 1);

    for (const pt of pattern.coords) {
      this.setCell(originX + pt.x, originY + pt.y, chosenSpecies);
    }
    this.checkMedalProgress();
  }

  /**
   * Determine inherited family from 3 live neighbors
   */
  getInheritedFamilyId(parentCells) {
    if (!parentCells || parentCells.length === 0) {
      // Fallback to random base family
      const randFam = this.metadata.baseSpeciesList[Math.floor(Math.random() * this.metadata.baseSpeciesList.length)];
      return randFam ? randFam.evolution_chain_id : 1;
    }

    // Tally family frequencies
    const counts = new Map();
    for (const cell of parentCells) {
      counts.set(cell.familyId, (counts.get(cell.familyId) || 0) + 1);
    }

    let topFam = parentCells[0].familyId;
    let maxCount = 0;
    for (const [famId, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topFam = famId;
      }
    }

    // If all 3 differ, pick one randomly among the parents
    if (maxCount === 1) {
      const pick = parentCells[Math.floor(Math.random() * parentCells.length)];
      return pick.familyId;
    }

    return topFam;
  }

  /**
   * Determine next evolution stage for a cell
   */
  checkCellEvolution(cell, newAge) {
    const famInfo = this.speciesFamilyMap.get(cell.speciesId);
    if (!famInfo) return { speciesId: cell.speciesId, stage: cell.stage, evolved: false };

    const tree = famInfo.tree;
    let evolved = false;
    let nextSpeciesId = cell.speciesId;
    let nextStage = cell.stage;

    // Stage 2 evolution: Age >= 12
    if (newAge >= 12 && tree.stage2.length > 0 && cell.stage < 2) {
      const pick = tree.stage2[Math.floor(Math.random() * tree.stage2.length)];
      if (pick.id !== cell.speciesId) {
        nextSpeciesId = pick.id;
        nextStage = 2;
        evolved = true;
      }
    }
    // Stage 1 evolution: Age >= 5
    else if (newAge >= 5 && tree.stage1.length > 0 && cell.stage < 1) {
      const pick = tree.stage1[Math.floor(Math.random() * tree.stage1.length)];
      if (pick.id !== cell.speciesId) {
        nextSpeciesId = pick.id;
        nextStage = 1;
        evolved = true;
      }
    }

    return {
      speciesId: nextSpeciesId,
      stage: nextStage,
      evolved
    };
  }

  /**
   * Advance simulation by 1 generation (Conway's Law + Genetics + Evolution + Wild)
   */
  tick() {
    this.generation++;
    const neighborMap = new Map(); // key -> { count: number, parents: Cell[] }

    // 1. Tally 8 Moore neighbors for all currently alive cells
    for (const cell of this.cells.values()) {
      const cx = cell.x;
      const cy = cell.y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          const nKey = cellKey(nx, ny);

          let entry = neighborMap.get(nKey);
          if (!entry) {
            entry = { count: 0, parents: [] };
            neighborMap.set(nKey, entry);
          }
          entry.count++;
          entry.parents.push(cell);
        }
      }
    }

    const nextCells = new Map();
    const evolutionEvents = [];

    // 2. Apply Conway Rules to all evaluated coordinates
    for (const [key, entry] of neighborMap.entries()) {
      const current = this.cells.get(key);
      const { count, parents } = entry;

      if (current) {
        // Survival Rule: live cell with 2 or 3 neighbors survives
        if (count === 2 || count === 3) {
          const newAge = current.age + 1;
          const evoResult = this.checkCellEvolution(current, newAge);

          const cellData = {
            ...current,
            age: newAge,
            speciesId: evoResult.speciesId,
            stage: evoResult.stage,
            evolvedAtGen: evoResult.evolved ? this.generation : current.evolvedAtGen
          };

          if (evoResult.evolved) {
            evolutionEvents.push({
              x: current.x,
              y: current.y,
              fromSpeciesId: current.speciesId,
              toSpeciesId: evoResult.speciesId,
              stage: evoResult.stage
            });
            this.recordDiscovery(evoResult.speciesId, current.familyId);
          }

          nextCells.set(key, cellData);
        }
        // Underpopulation (<2) or Overpopulation (>3): cell dies (not copied)
      } else {
        // Reproduction Rule: dead cell with exactly 3 neighbors becomes alive
        if (count === 3) {
          const { x, y } = parseKey(key);
          const inheritedFamId = this.getInheritedFamilyId(parents);
          const famTree = this.metadata.familyTrees.get(inheritedFamId);
          const baseSpecies = famTree ? famTree.base : this.metadata.baseSpeciesList[0];
          const speciesId = baseSpecies ? baseSpecies.id : 1;

          const newCell = {
            x,
            y,
            speciesId,
            familyId: inheritedFamId,
            stage: 0,
            age: 0,
            evolvedAtGen: null,
            isVeteran: famTree ? famTree.isSingleStage : false
          };

          nextCells.set(key, newCell);
          this.recordDiscovery(speciesId, inheritedFamId);
        }
      }
    }

    // 3. Wild Encounter Mutation (1% ~ 3% chance)
    let wildSpawnEvent = null;
    if (this.isWildEnabled && Math.random() < this.wildRate && this.metadata.baseSpeciesList.length > 0) {
      // Choose empty coordinate adjacent to living population or center
      const candidateKeys = [];
      if (nextCells.size > 0) {
        // Pick an existing cell, pick an empty adjacent spot
        const liveCells = Array.from(nextCells.values());
        const anchor = liveCells[Math.floor(Math.random() * liveCells.length)];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const k = cellKey(anchor.x + dx, anchor.y + dy);
            if (!nextCells.has(k)) candidateKeys.push({ x: anchor.x + dx, y: anchor.y + dy });
          }
        }
      } else {
        candidateKeys.push({ x: 0, y: 0 });
      }

      if (candidateKeys.length > 0) {
        const spot = candidateKeys[Math.floor(Math.random() * candidateKeys.length)];
        const wildSpecies = this.metadata.baseSpeciesList[Math.floor(Math.random() * this.metadata.baseSpeciesList.length)];
        const wildFamTree = this.metadata.familyTrees.get(wildSpecies.evolution_chain_id);

        // Spawn a viable small cluster (3-cell pack) so they have >= 2 neighbors to survive, breed, and evolve
        const patterns = [
          [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }], // L-tromino
          [{ dx: -1, dy: 0 }, { dx: 0, dy: 0 }, { dx: 1, dy: 0 }], // Blinker line
        ];
        const chosenPattern = patterns[Math.floor(Math.random() * patterns.length)];

        let spawnedCount = 0;
        for (const off of chosenPattern) {
          const nx = spot.x + off.dx;
          const ny = spot.y + off.dy;
          const k = cellKey(nx, ny);
          if (!nextCells.has(k)) {
            const wildCell = {
              x: nx,
              y: ny,
              speciesId: wildSpecies.id,
              familyId: wildSpecies.evolution_chain_id,
              stage: 0,
              age: 0,
              evolvedAtGen: null,
              isVeteran: wildFamTree ? wildFamTree.isSingleStage : false,
              isWildSpawn: true
            };
            nextCells.set(k, wildCell);
            spawnedCount++;
          }
        }

        if (spawnedCount > 0) {
          this.wildEncounterCount++;
          this.recordDiscovery(wildSpecies.id, wildSpecies.evolution_chain_id);
          wildSpawnEvent = { x: spot.x, y: spot.y, species: wildSpecies, count: spawnedCount };
        }
      }
    }

    this.cells = nextCells;

    // 4. Check for newly unlocked legendary medal
    const newlyUnlockedMedal = this.checkMedalProgress();

    // 5. Compute Stage Distribution Statistics
    let stage0Count = 0;
    let stage1Count = 0;
    let stage2Count = 0;
    const activeFamilies = new Set();

    for (const cell of this.cells.values()) {
      activeFamilies.add(cell.familyId);
      if (cell.stage === 0) stage0Count++;
      else if (cell.stage === 1) stage1Count++;
      else if (cell.stage === 2) stage2Count++;
    }

    return {
      generation: this.generation,
      population: this.cells.size,
      activeFamiliesCount: activeFamilies.size,
      unlockedFamiliesCount: this.unlockedFamilies.size,
      stage0Count,
      stage1Count,
      stage2Count,
      evolutionEvents,
      wildSpawnEvent,
      newlyUnlockedMedal
    };
  }
}
