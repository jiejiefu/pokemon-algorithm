import { eraTypes, TYPE_INTRO_GEN, LETS_GO_TYPE_ERA } from './type-era.js';

/**
 * Pokémon Conway's Game of Life — Core Automata & Genetics Engine
 *
 * Implements:
 * 1. Infinite sparse grid Map<string, Cell>
 * 2. Moore neighborhood Conway 4-rule evolution
 * 3. Dominant family genetics & inheritance on reproduction
 * 4. Level-based multi-stage evolution, gated on each species' REAL in-game
 *    evolution level (Lv.7 to Lv.64) from assets/data/evolution_levels.json
 * 5. Single-stage veteran tenure handling
 * 6. Wild encounter mutator (wildRate chance per generation, placed on a site
 *    proved empty with a 1-cell moat — see pickWildSite)
 * 7. Generation locking & Legendary Medals unlock milestones (1 medal per 6 families)
 * 8. Classical Conway stamp patterns
 * 9. Type territory: what last lived in each cell, and which types the board
 *    has collected at all (see #claim / typesOf / seenTypes)
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
 * @param {object} [options]
 * @param {number} [options.starterId] - the species the reader chose as their
 *   starter, which decides whether the Pokédex carries a cross-generation
 *   branch section. 0 (the default) means no starter chosen, and therefore no
 *   section: a reader who did not pick 伊布 gets their generation's own roster in
 *   its own order, and the counter agrees with it again.
 */
export function buildGenMetadata(gen, allPokemon, evolutionChains, generations, { starterId = 0 } = {}) {
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
    dexRoster: buildDexRoster(genNum, genSpecies, speciesById, evolutionChains, starterId),
    speciesById,
    starters,
    legendaries,
    familyTrees,
    baseSpeciesList
  };
}

/**
 * The Pokédex drawer's roster, as an ordered list with one optional section.
 *
 * ONE list, because the drawer and the 「圖鑑 (n/N)」 counter used to read two
 * different things: the counter said `totalSpeciesCount` (151 for Gen 1) while
 * the drawer rendered 156 tiles, because the Eevee section removed 4 species from
 * the main list and appended all 9. A denominator that is not the number of rows
 * is a claim about progress the reader can check and find false.
 *
 * THE SECTION IS THE READER'S CHOICE, not the generation's. It appears only when
 * `starterId` belongs to a cross-generation branch family — today that is
 * exactly 「始祖物種選了伊布」, because Eevee is the only such root and #133 is the
 * only one of the five Gen 1 starters inside it. The rule is written as the
 * family rather than as the id so a second root needs no new branch here, and
 * stated as one condition rather than a per-generation exception list.
 *
 * Its members come from the family's own chain rather than a second hardcoded id
 * list, which is why 水/雷/火伊布 leave the 151 and rejoin the nine: they are not
 * a duplicate roster, they are the same nine species filed under the branch that
 * reaches them.
 */
function buildDexRoster(genNum, genSpecies, speciesById, evolutionChains, starterId) {
  let main = genSpecies;
  const sections = [];

  for (const rootId of CROSS_GEN_BRANCH_ROOTS) {
    const root = speciesById.get(rootId);
    if (!root || root.generation !== genNum) continue;

    // The reader picked the branch's family, not merely the generation it lives in.
    const starter = speciesById.get(starterId);
    if (!starter || starter.evolution_chain_id !== root.evolution_chain_id) continue;

    const chain = evolutionChains[String(root.evolution_chain_id)];
    const members = (chain ? chain.main_line : []).filter(n => n.id <= 1025);
    if (members.length === 0) continue;

    const inSection = new Set(members.map(n => n.id));
    main = main.filter(s => !inSection.has(s.id));
    sections.push({
      section: BRANCH_SECTIONS.get(rootId) || { label: '', note: '' },
      species: members.map(n => speciesById.get(n.id)).filter(Boolean)
    });
  }

  return [
    ...main.map(species => ({ species, section: null })),
    ...sections.flatMap(s => s.species.map(species => ({ species, section: s.section })))
  ];
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
 * The two shapes a wild encounter can land as.
 *
 * Both are viable on their OWN, which was verified by running each on an empty
 * sparse grid: the L-tromino settles into a 2x2 block by generation 1 and the
 * blinker oscillates, both holding 3 cells indefinitely. So the shape was never
 * the reason wild encounters died — see `pickWildSite` for the one that was.
 */
export const WILD_PACKS = [
  [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }],  // L-tromino
  [{ dx: -1, dy: 0 }, { dx: 0, dy: 0 }, { dx: 1, dy: 0 }]  // blinker line
];

/** Empty cells required around every pack cell, on top of the pack itself. */
const WILD_MOAT = 1;

/** How far from a sampled anchor a candidate origin may land. */
const WILD_SITE_RADIUS = 8;

/** Anchors sampled to build the candidate origins. Bounded so the cost of a
 *  spawn attempt does not scale with the population. */
const WILD_SITE_ANCHORS = 64;

/** Re-roll budget before an encounter is abandoned. */
const WILD_SITE_TRIES = 500;

/** Wild-pool weight for a family that has a stage 1 or stage 2 to evolve into. */
const EVOLVABLE_WEIGHT = 3;

/**
 * The ONE family whose branch is drawn from the whole dex rather than from this
 * generation's members.
 *
 * The page locks a generation on which species are SEEDED, not on which the
 * player can end up holding — and Eevee is the case where the difference is the
 * whole feature: 仙子伊布 (#700) is a Gen 6 species, so a Gen 1 board that drew
 * its branch from Gen 1 members could never produce it, and 「大家都喜歡仙子伊布」
 * is not a reason to make the most-wanted evolution unreachable in the most
 * played generation.
 *
 * It is a named set rather than a flag for a reason. Of the 489 edges in
 * evolution_levels.json, 70 cross a generation boundary, and most of them are
 * worse: #172 Pichu -> #25 Pikachu and #236 Slowpoke -> #106 Slowbro are
 * backwards in the other direction, and #52 Primeape -> #863 Annihilape would
 * put a Gen 8 form on a Gen 1 board. Generation-locking is right for all of
 * those and wrong only for Eevee, so the exception is one id rather than a
 * policy. `check_life_page.mjs` asserts this set is exactly {133}.
 */
export const CROSS_GEN_BRANCH_ROOTS = new Set([133]);

/**
 * Where a cross-generation branch's members go in the Pokédex drawer.
 *
 * Keyed by the same root, so a second exception needs one entry here and nowhere
 * else. The section exists because the branch's members are NOT all this
 * generation's species: on a Gen 1 board the drawer would otherwise list four
 * Eeveelutions among the 151 and the other five nowhere at all, while being
 * reachable the moment the cross-gen branch is on.
 */
export const BRANCH_SECTIONS = new Map([
  [133, { label: '★ 伊布家族', note: '可進化為任一分支，含跨世代型態' }]
]);

/**
 * How likely each of Eevee's eight destinations is, per evolution.
 *
 * THE ONLY INVENTED NUMBERS IN THE ENGINE, and they are a design choice rather
 * than game data — the games gate these on stones, friendship, a location and a
 * move, none of which this simulation models. They are keyed by species id
 * rather than inlined at the call site for one reason: `check_life_page.mjs`
 * asserts this map's key set is exactly the `to` set of Eevee's eight real
 * edges, so a ninth Eeveelution or a mistyped id is a red test instead of a
 * silent no-op (an id absent from this map falls back to weight 1, which is how
 * a typo hides).
 *
 * 仙子伊布 carries 1 on purpose. Under the original 3/2/1 scheme with the branch
 * restricted to one generation it was unreachable at all; with the branch opened
 * up it lands at 1/16 per Eevee.
 */
export const BRANCH_WEIGHTS = new Map([
  [134, 3], // 水伊布  water stone
  [135, 3], // 雷伊布  thunder stone
  [136, 3], // 火伊布  fire stone
  [196, 2], // 太陽伊布  friendship, daytime
  [197, 2], // 月亮伊布  friendship, night
  [470, 1], // 葉伊布   mossy rock / eternal forest
  [471, 1], // 冰伊布   icy rock / snowy route
  [700, 1]  // 仙子伊布  fairy move
]);

const GEN1_STONE_EVOLUTIONS = new Set([134, 135, 136]);

/**
 * Species that stop evolving entirely while a given mode is on.
 *
 * A Let's Go Pikachu is the partner you are given, not a thing you raise, and
 * Let's Go's stones are a post-game mechanic the engine does not model — so under
 * Let's Go it is frozen rather than quietly becoming a Thunder-Stone Raichu.
 *
 * Keyed by mode rather than hardcoded as `speciesId === 25` in the evolution
 * path, because the ID-only version froze Pikachu on EVERY Gen 1 board too, and
 * #26 Raichu's only source on a Gen 1 board is a Pikachu that evolves. That made
 * one of the 151 tiles permanently unreadable, with no checker able to see it.
 */
export const MODE_FROZEN_SPECIES = new Map([
  ['letsGo', new Set([25])]
]);

/**
 * Level used for evolutions the games do not gate on a level.
 *
 * The median of the 348 real levels in assets/data/evolution_levels.json. It is
 * exported so the HUD can say the same number the engine is using, rather than
 * showing a figure that happens to be near it — see evolutionLevelFor() for why
 * this is a stated median rather than a learnset inference.
 */
export const FALLBACK_EVOLUTION_LEVEL = 30;

/**
 * True when every pack cell and its whole WILD_MOAT ring is empty.
 *
 * That is a single box — the pack's bounding box grown by the moat — so the test
 * is four comparisons per live cell with an early exit, not a per-cell scan.
 *
 * The moat is the load-bearing half. A pack dropped against the living
 * population is overpopulation on the very next generation — Conway's survival
 * rule is `count === 2 || count === 3` and a cell touching the soup easily has
 * 4+ neighbours — and measured over 25 x 400 generations that single change
 * moved the median wild pack's life from 4 generations to 26.
 */
function isWildSiteFree(cells, ox, oy, pack) {
  let minDx = Infinity, maxDx = -Infinity, minDy = Infinity, maxDy = -Infinity;
  for (const off of pack) {
    if (off.dx < minDx) minDx = off.dx;
    if (off.dx > maxDx) maxDx = off.dx;
    if (off.dy < minDy) minDy = off.dy;
    if (off.dy > maxDy) maxDy = off.dy;
  }
  const left = ox + minDx - WILD_MOAT;
  const right = ox + maxDx + WILD_MOAT;
  const top = oy + minDy - WILD_MOAT;
  const bottom = oy + maxDy + WILD_MOAT;
  for (const cell of cells.values()) {
    if (cell.x >= left && cell.x <= right && cell.y >= top && cell.y <= bottom) return false;
  }
  return true;
}

/**
 * Choose where a wild pack lands, or null when no viable site exists.
 *
 * The previous policy drew the origin from "any empty cell within 2 of a random
 * living cell", i.e. deliberately adjacent to the population, and then placed
 * each pack cell only `if (!nextCells.has(k))`. Two things followed, both
 * measured over 210 encounters: 36-39% of encounters were born with 1 or 2 cells
 * (a 2-cell pack is dead on arrival — each cell has exactly one neighbour, so
 * both die), and the rest were dropped into overpopulation. Median pack life was
 * 4 generations, which is 0.16s of wall clock at 10x.
 *
 * An empty board still returns the origin, which is what keeps an extinction
 * recoverable: at 10% seed density the old policy left the grid empty for 29
 * generations (worst run 22) because recovery was a 2%-per-tick roll.
 *
 * WHY THE ORIGINS ARE DE-DUPLICATED. Sampling "a random living cell, then a
 * random offset" weights every candidate by how many living cells sit near it, so
 * the search keeps re-finding pockets buried INSIDE the colony rather than its
 * fringe — and a pocket is where a fresh pack gets crowded out again a few
 * generations later. Listing each candidate position once and sampling that
 * uniformly was measured against it over 25 x 400 generations at 20% seed
 * density: median pack life 10 -> 27 generations, still alive at 400 from 32%
 * to 57%. The anchor sample is capped so a 2,000-cell board does not build a
 * 70,000-entry list per spawn attempt.
 */
export function pickWildSite(cells, rng = Math.random) {
  if (cells.size === 0) {
    return { x: 0, y: 0, pack: WILD_PACKS[0] };
  }

  const live = Array.from(cells.values());
  const anchors = live.length <= WILD_SITE_ANCHORS
    ? live
    : Array.from({ length: WILD_SITE_ANCHORS }, () => live[Math.floor(rng() * live.length)]);

  const origins = new Set();
  for (const cell of anchors) {
    for (let dy = -WILD_SITE_RADIUS; dy <= WILD_SITE_RADIUS; dy++) {
      for (let dx = -WILD_SITE_RADIUS; dx <= WILD_SITE_RADIUS; dx++) {
        origins.add(cellKey(cell.x + dx, cell.y + dy));
      }
    }
  }
  const list = Array.from(origins);

  for (let attempt = 0; attempt < WILD_SITE_TRIES; attempt++) {
    const pack = WILD_PACKS[Math.floor(rng() * WILD_PACKS.length)];
    const { x: ox, y: oy } = parseKey(list[Math.floor(rng() * list.length)]);
    if (isWildSiteFree(cells, ox, oy, pack)) return { x: ox, y: oy, pack };
  }
  return null;
}

/**
 * Game of Life Automata Engine
 *
 * `evolutionLevels` is the parsed assets/data/evolution_levels.json — the
 * {from_id: {to_id: min_level}} table from fetch_evolution_levels.py. Without it
 * every evolution falls back to FALLBACK_EVOLUTION_LEVEL, so the constructor
 * takes it rather than importing it: this module stays free of fetch and DOM so
 * the checkers can drive it in bare Node.
 */
export class GameEngine {
  constructor(metadata, evolutionLevels = null, mode = '') {
    this.metadata = metadata;
    this.cells = new Map(); // key -> Cell
    this.territory = new Map(); // key -> primary type name of the last occupant
    this.seenTypes = new Set(); // every type this board has ever held (monotonic)
    this.generation = 0;
    this.unlockedFamilies = new Set();
    this.unlockedSpecies = new Set();
    this.unlockedMedalIds = new Set();
    this.unlockedMedals = []; // ordered list of earned legendary medals
    this.wildEncounterCount = 0;
    this.isWildEnabled = true;
    this.wildRate = 0.02; // 2% chance per tick

    this.setEvolutionLevels(evolutionLevels);
    this.setMode(mode);
    this.rebuildWildIndex();
  }

  /**
   * Install the evolution-level table.
   *
   * `fallbackEvolutionLevel` is what a single-stage species' veteran aura is
   * measured against: "this one has reached the age at which the ones that DO
   * evolve would have, and never will". Under the old Age>=5 rule that was true
   * of nearly every cell five generations in, which made the gold corner mean
   * nothing at all.
   *
   * The SAME table is also the engine's evolution topology, which is the reason
   * it is worth building an index out of. `levels` and `unlevelled` between them
   * are all 489 steps PokeAPI reports, keyed by BOTH ends, so they answer "what
   * can this species become, and at what level" without inventing anything.
   * `unlevelled` was previously loaded and never read — it was only reachable as
   * the absence of a key.
   */
  setEvolutionLevels(evolutionLevels) {
    this.evolutionLevels = (evolutionLevels && evolutionLevels.levels) || {};
    this.unlevelledSteps = (evolutionLevels && evolutionLevels.unlevelled) || {};
    this.fallbackEvolutionLevel = FALLBACK_EVOLUTION_LEVEL;

    // fromId -> [{ to, level, trigger, detail }], in one array per source so a
    // species with two routes to the same destination stays two entries and the
    // weighted draw sees them twice.
    this.evolutionEdges = new Map();
    const push = (fromId, edge) => {
      if (!this.evolutionEdges.has(fromId)) this.evolutionEdges.set(fromId, []);
      this.evolutionEdges.get(fromId).push(edge);
    };
    for (const [from, row] of Object.entries(this.evolutionLevels)) {
      for (const [to, level] of Object.entries(row)) {
        push(Number(from), { to: Number(to), level, trigger: 'level-up', detail: `Lv.${level}` });
      }
    }
    for (const [from, row] of Object.entries(this.unlevelledSteps)) {
      for (const step of row) {
        push(Number(from), { to: step.to, level: null, trigger: step.trigger, detail: step.detail });
      }
    }
  }

  /**
   * The species frozen by the mode the engine is currently running, if any.
   *
   * `mode` is the setup modal's Lets Go switch, which is a real mode rather than
   * a display flag: the seed roster differs, so the engine has to know.
   */
  setMode(mode) {
    this.mode = mode || '';
    this.frozenSpecies = MODE_FROZEN_SPECIES.get(this.mode) || null;
  }

  /**
   * The three evolution stones available in the original games.
   *
   * A STATED FACT, not a derivation, and the reason it cannot be derived is the
   * interesting part. Filtering the branch by type era — "a destination whose
   * types all exist in this generation may be reached" — admits SIX of the eight
   * on a Gen 1 board, because 太陽伊布 (超能力), 葉伊布 (草) and 冰伊布 (冰) are all
   * typed with Gen 1 types too. The set of destinations and the set of types are
   * not the same question, and only one of them is answerable from TYPE_INTRO_GEN.
   *
   * 红/绿/蓝/黄's 伊布 evolves with 水之石 / 雷之石 / 火之石 into 水伊布 / 雷伊布 /
   * 火伊布 and nothing else. All three are era-1 types, so restricting the branch
   * to them leaves a Gen 1 board holding exactly the 15 types its generation had —
   * which is the whole point, and why the table is a constant rather than a
   * computation.
   */
/**
   * Which of the eight 伊布 destinations a board at `era` can reach.
   *
   * GEN 1 GETS THE THREE STONES; every later era gets every destination whose
   * types it has. A Let's Go board is era 7 (LETS_GO_TYPE_ERA), so it reaches all
   * eight — the 2018 game's roster is Gen 1's, but its typing is not.
   *
   * THE CONSEQUENCE WORTH NAMING: because every admitted destination is era-valid
   * BY CONSTRUCTION, the branch can never contribute a type its board does not
   * already have. That is why the type denominator is simply the generation's own
   * count — 15 in Gen 1, 17 in Gens 2-5, 18 from Gen 6 — with no special case and
   * no reachable-set arithmetic. `check_life_page.mjs` asserts that equality
   * across all 9 eras and both modes, so it stays a verified property rather than
   * a coincidence.
   */
  branchDestinationsFor(era = this.typeEra()) {
    return [...BRANCH_WEIGHTS.keys()].filter(id => {
      if (era === 1) return GEN1_STONE_EVOLUTIONS.has(id);
      const sp = this.metadata.speciesById.get(id);
      return !!sp && era >= Math.max(...sp.types.map(t => TYPE_INTRO_GEN[t]));
    });
  }

  /**
   * Species `fromId` can become on this board, newest generation's rules aside.
   *
   * Generation-locked by default, and the filter is what makes the exception mean
   * something: without the `generation === this.metadata.gen` test, a Gen 1 Eevee
   * would have no reachable destinations at all, because every one of the eight
   * belongs to a later generation.
   *
   * The branch is then narrowed by TYPE ERA rather than by which generation the
   * destination belongs to. That is what keeps a Gen 1 board inside its 15 types:
   * 仙子伊布 is Fairy, so it is unreachable before Gen 6, and 月亮伊布 is 惡, so
   * it is unreachable before Gen 2 — while 水/雷/火伊布 are era-1 types and stay
   * reachable on every board.
   */
  successorsOf(fromId) {
    const edges = this.evolutionEdges.get(fromId);
    if (!edges || edges.length === 0) return [];
    if (CROSS_GEN_BRANCH_ROOTS.has(fromId)) {
      const allowed = new Set(this.branchDestinationsFor());
      return edges.filter(e => allowed.has(e.to));
    }
    const gen = this.metadata.gen;
    return edges.filter(e => this.metadata.speciesById.get(e.to)?.generation === gen);
  }

  /**
   * One edge, drawn proportionally to BRANCH_WEIGHTS.
   *
   * A single candidate is returned as-is rather than run through `Math.random`,
   * which is both cheaper and one fewer thing to be surprised by.
   */
  weightedPick(edges) {
    if (edges.length === 1) return edges[0];
    let total = 0;
    for (const e of edges) total += BRANCH_WEIGHTS.get(e.to) ?? 1;
    let roll = Math.random() * total;
    for (const e of edges) {
      roll -= BRANCH_WEIGHTS.get(e.to) ?? 1;
      if (roll <= 0) return e;
    }
    return edges[edges.length - 1];
  }

  /**
   * Rebuild both metadata-derived lookup tables.
   *
   * One method, called from the constructor and from `reset(newMetadata)`, so
   * the wild pool cannot drift out of sync with the family trees the way a third
   * inline copy would.
   */
  rebuildWildIndex() {
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

    // Wild spawn pool, weighted by whether the family can actually evolve.
    //
    // 19% of Gen 1's base species and 52-58% of Gens 2/4/7/8/9's are
    // single-stage, so a flat draw spent more than half of some generations'
    // encounters on a family that can never leave stage 0 and never shows the
    // level-driven evolution the page promises. EVOLVABLE_WEIGHT vs 1 puts a 3:1
    // odds on a family that has somewhere to go while keeping every species
    // reachable.
    this.wildPool = [];
    for (const base of this.metadata.baseSpeciesList) {
      const tree = this.metadata.familyTrees.get(base.evolution_chain_id);
      const evolvable = tree && (tree.stage1.length > 0 || tree.stage2.length > 0);
      const weight = evolvable ? EVOLVABLE_WEIGHT : 1;
      for (let i = 0; i < weight; i++) this.wildPool.push(base);
    }
  }

  /**
   * Reset the engine with fresh or updated metadata
   */
  reset(newMetadata = null) {
    if (newMetadata) {
      this.metadata = newMetadata;
      this.rebuildWildIndex();
    }
    this.cells.clear();
    this.territory.clear();
    this.seenTypes.clear();
    this.generation = 0;
    this.unlockedFamilies.clear();
    this.unlockedSpecies.clear();
    this.unlockedMedalIds.clear();
    this.unlockedMedals = [];
    this.wildEncounterCount = 0;
  }

  /**
   * The generation whose TYPE RULES this board runs under, which is not always
   * the generation whose ROSTER it runs under.
   *
   * They come apart in exactly one mode: a Let's Go board is a 2018 game playing
   * the Gen 1 roster, so its types are read at LETS_GO_TYPE_ERA while its species
   * stay the Gen 1 151. Every other mode answers the roster's own generation.
   */
  typeEra() {
    return this.mode === 'letsGo' ? LETS_GO_TYPE_ERA : this.metadata.gen;
  }

  /**
   * The types THIS board knows a species by.
   *
   * The one answer to that question, and the renderer, the wash and the type
   * drawer all ask it rather than reading `species.types` themselves — three
   * places each holding their own idea of a species' type is §3.I's shape with
   * a colour attached.
   *
   * THERE IS NO CROSS-GENERATION EXEMPTION HERE, and there used to be one. It
   * existed because the branch was not era-restricted: 仙子伊布 could be reached
   * from a Gen 1 board, its Fairy type had no Gen 1 era, and `eraTypes` returned
   * `[]` for it — which renders as the hardcoded `#78c850` fallback rather than as
   * a bug. `branchDestinationsFor()` removed the cause, so the symptom's treatment
   * went with it. The two were one change and must be reverted together: reinstating
   * a later-generation branch without reinstating the exemption yields an empty
   * typing again, and nothing else on the page would say so.
   */
  typesOf(species) {
    if (!species) return [];
    return eraTypes(species, this.typeEra());
  }

  /**
   * Record the type of whatever last occupied a cell.
   *
   * ONE entry per key, so a cell is one colour and a newcomer REPLACES the old
   * owner rather than adding a second wash: Grass gives way to Fire and the
   * green is gone from that cell. Nothing is ever composited and no cell ever
   * carries two types.
   *
   * The stored value is the TYPE NAME (`'Grass'`), not a colour. Type colours
   * live in shared.js and are a rendering concern; the engine stays free of DOM
   * so `check_life_page.mjs` can drive it in bare Node.
   *
   * PRIMARY TYPE ONLY (`types[0]`), which is the same field the cell renderer
   * already keys `TYPE_COLORS` on. 499 of 1,025 species are mono-type so for
   * them this is unambiguous; the other 526 show their first type only, which
   * is what the claim means and not a fallback for a missing one — all 1,025
   * records carry a non-empty typing on every generation, and
   * `check_life_page.mjs` asserts that rather than assuming it.
   */
  #claim(x, y, speciesId) {
    const type = this.typesOf(this.metadata.speciesById.get(speciesId))?.[0];
    if (!type) return;
    this.territory.set(cellKey(x, y), type);
    // Collected, not derived: a type stays on the board's record once anything
    // has ever carried it, which is what makes the button a "seen" count rather
    // than a snapshot. Note that `deleteCell` does NOT reach this line — erasing
    // the last cell of a type leaves it collected, and that is the intended
    // asymmetry between the wash (current) and this set (ever).
    this.seenTypes.add(type);
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
      level: options.level ?? 1,
      evolvedAtGen: options.evolvedAtGen ?? null,
      evolvedAtLevel: null,
      isVeteran: famInfo ? famInfo.tree.isSingleStage : false
    };

    const key = cellKey(x, y);
    this.cells.set(key, cell);
    this.#claim(x, y, speciesId);

    this.recordDiscovery(speciesId, familyId);
    return cell;
  }

  /**
   * Remove a cell at (x, y)
   *
   * THE ERASER, AND ONLY THE ERASER. The wash goes with it, because a reader who
   * erased a cell is asking for the cell back, and a leftover colour would be a
   * mark no action on the page can remove.
   *
   * This is load-bearing in the other direction too: Conway deaths never come
   * through here. `tick()` builds a fresh `nextCells` and assigns it wholesale,
   * so a cell that starved or overcrowded is simply not copied — its wash
   * survives, which is the entire point of the layer. `check_life_page.mjs`
   * asserts BOTH directions, because the difference between them is invisible
   * from either side alone: erasing is a method call and starving is an
   * omission.
   */
  deleteCell(x, y) {
    const key = cellKey(x, y);
    this.cells.delete(key);
    this.territory.delete(key);
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
    this.territory.clear();
    this.seenTypes.clear();
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
    // `clear()`, NOT `this.cells.clear()`.
    //
    // The two were identical until the wash existed, and a reseed that emptied
    // the board while leaving every old colour behind is the §3.M shape: one
    // state, two writers, and the second one is silent about the half it does
    // not know about. `clear()` is the single writer of "the board is empty".
    this.clear();

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
   * The level at which `fromId` actually evolves into `toId`.
   *
   * Keyed by BOTH ends of the step, because a species can evolve at different
   * levels or not at all: Eevee carries three level-up steps (Espeon by friendship
   * in the day, Umbreon at night, Sylveon by friendship), eight use-item steps,
   * and four level-up steps with no min_level at all (Leafeon / Glaceon need a
   * level-up move). A per-species number could not express that.
   *
   * `FALLBACK_EVOLUTION_LEVEL` covers the 141 of 489 distinct pairs that PokeAPI
   * reports with no numeric level — stones, trades, friendship, day/night. It is
   * the MEDIAN of the 348 real levels, which is what keeps those pairs on the
   * same pace as the real ones instead of running 1.6x late. The alternative
   * considered and measured: "the level at which the from-species learns its last
   * level-up move" (learnsets.json). It applies to all 141, but its median is 48
   * and its max is 85, against a real median of 30 — Nidorina -> Nidoqueen would
   * have become Lv.71. So the stated constant wins, and it is a constant rather
   * than an inference from an unrelated table.
   */
  evolutionLevelFor(fromId, toId) {
    const row = this.evolutionLevels[String(fromId)];
    if (row) {
      const level = row[String(toId)];
      if (typeof level === 'number') return level;
    }
    return this.fallbackEvolutionLevel;
  }

  /**
   * Determine next evolution stage for a cell.
   *
   * `newLevel` is the cell's level AFTER this generation's survival check.
   *
   * Successors come from the real edge list in evolution_levels.json rather than
   * from the family tree's stage columns, and that is the whole of the fix for
   * the branch bug: `evolution_chains.json` numbers `stage` by DEX ORDER (the
   * generator has no `evolves_from` column to number by, which is why its own
   * comment says so), so Eevee's eight branches read as eight successive stages
   * and only 水伊布 was ever reachable. The stage columns are still what SEEDS a
   * family and what a brushed cell's stage is; they are just no longer what
   * decides where a cell goes.
   *
   * Strictly one stage per generation, and always the NEXT one. The old code
   * tried stage 2 first and fell back to stage 1, which with real levels let a
   * level-32 Bulbasaur jump straight to Venusaur and never be an Ivysaur — the
   * games have no such shortcut.
   */
  checkCellEvolution(cell, newLevel) {
    const unchanged = { speciesId: cell.speciesId, stage: cell.stage, evolved: false, requiredLevel: null };

    // A frozen species keeps its stage AND its level, so a Let's Go Pikachu
    // accumulates tenure and can still earn the veteran aura.
    if (this.frozenSpecies && this.frozenSpecies.has(cell.speciesId)) return unchanged;

    const nextStage = cell.stage + 1;
    if (nextStage > 2) return unchanged;

    const candidates = this.successorsOf(cell.speciesId);
    if (candidates.length === 0) return unchanged;

    const pick = this.weightedPick(candidates);
    const requiredLevel = pick.level ?? this.evolutionLevelFor(cell.speciesId, pick.to);
    if (newLevel < requiredLevel) return unchanged;

    return { speciesId: pick.to, stage: nextStage, evolved: true, requiredLevel };
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
          const newLevel = current.level + 1;
          const evoResult = this.checkCellEvolution(current, newLevel);

          const cellData = {
            ...current,
            level: newLevel,
            speciesId: evoResult.speciesId,
            stage: evoResult.stage,
            evolvedAtGen: evoResult.evolved ? this.generation : current.evolvedAtGen,
            // The level it reached to evolve, kept because the cell's own `level`
            // keeps climbing afterwards and the HUD legend reports the level
            // each stage is entered at.
            evolvedAtLevel: evoResult.evolved ? newLevel : current.evolvedAtLevel
          };

          if (evoResult.evolved) {
            evolutionEvents.push({
              x: current.x,
              y: current.y,
              fromSpeciesId: current.speciesId,
              toSpeciesId: evoResult.speciesId,
              stage: evoResult.stage,
              level: newLevel
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
            level: 1,
            evolvedAtGen: null,
            evolvedAtLevel: null,
            isVeteran: famTree ? famTree.isSingleStage : false
          };

          nextCells.set(key, newCell);
          this.recordDiscovery(speciesId, inheritedFamId);
        }
      }
    }

    // 3. Wild Encounter Mutation (wildRate chance per generation)
    //
    // A site is picked first and the pack is placed unconditionally inside it,
    // because `pickWildSite` already proved all three cells AND their moat are
    // empty. The old code picked the origin first and then skipped any occupied
    // pack cell, which is how 36-39% of encounters were recorded as successes
    // while being born with 1 or 2 cells and dying on the spot.
    //
    // No site means NO encounter: nothing is placed, `wildEncounterCount` is not
    // advanced and no family is recorded as discovered. The counter is labelled
    // 野生遭遇次數 on the HUD, so it has to mean "a pack that landed".
    let wildSpawnEvent = null;
    if (this.isWildEnabled && Math.random() < this.wildRate && this.wildPool.length > 0) {
      const site = pickWildSite(nextCells);
      if (site) {
        const wildSpecies = this.wildPool[Math.floor(Math.random() * this.wildPool.length)];
        const wildFamTree = this.metadata.familyTrees.get(wildSpecies.evolution_chain_id);

        for (const off of site.pack) {
          const nx = site.x + off.dx;
          const ny = site.y + off.dy;
          nextCells.set(cellKey(nx, ny), {
            x: nx,
            y: ny,
            speciesId: wildSpecies.id,
            familyId: wildSpecies.evolution_chain_id,
            stage: 0,
            level: 1,
            evolvedAtGen: null,
            evolvedAtLevel: null,
            isVeteran: wildFamTree ? wildFamTree.isSingleStage : false,
            isWildSpawn: true
          });
        }

        this.wildEncounterCount++;
        this.recordDiscovery(wildSpecies.id, wildSpecies.evolution_chain_id);
        wildSpawnEvent = {
          x: site.x,
          y: site.y,
          species: wildSpecies,
          count: site.pack.length
        };
      }
    }

    this.cells = nextCells;

    // 3b. Claim the wash for every live cell, AFTER the swap.
    //
    // One pass over the FINAL population rather than a claim inside each of the
    // four branches above, and the reason is EVOLUTION: a cell that evolved this
    // generation changed species, and the wash has to name the species it is now.
    // The branch runs at CROSS_GEN_BRANCH_ROOTS (#133), so 伊布 -> 水伊布 is a
    // real crossing — Normal becomes Water, and the old green-on-a-Normal-cell
    // would be the stale answer. Claiming during the loop would record the
    // species on the way IN and be wrong from that generation onward.
    //
    // Reading `nextCells` rather than the parents is the whole point, and it is
    // also what keeps this to one write site: survive, evolve, reproduce and the
    // wild spawn all land in the same map before this line runs.
    for (const c of nextCells.values()) this.#claim(c.x, c.y, c.speciesId);

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
