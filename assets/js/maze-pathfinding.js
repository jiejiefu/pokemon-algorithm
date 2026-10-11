// ==========================================
// 寶可夢演算法 — 迷宮尋路引擎 (maze-pathfinding.js)
// ==========================================
// Graph-generic on purpose: every solver takes a
// `neighborFn(node) => [{ node, stepCost }, ...]` and knows nothing about
// Cell, grid, walls or sprites. maze.html supplies two different neighborFn
// closures — one that respects the generated maze walls (unit cost,
// 4-directional) and one that reads terrain cost off the Pokémon's own pixels
// (8-directional, no walls) — and all four solvers below work unchanged against
// either. Node identity is by reference (a Cell object), which is why Map/Set
// are used rather than string keys.
//
// Every solver YIELDS the node it just settled, so the caller can flip a
// `searchVisited` flag and let requestAnimationFrame paint it, and RETURNS one
// shared result shape when it finishes:
//
//   { found, path, cost, visited }
//
// `cost` is the sum of stepCost along the path actually found. For BFS/DFS
// that is whatever cost their cost-BLIND traversal happened to produce, not
// necessarily the minimum — and "not necessarily" is doing real work in that
// sentence. Measured over three 40×40 weighted terrains: on two of them BFS's
// cost TIES Dijkstra's exactly, and only on the third is it worse (316.78 vs
// 261.83). So the page must say BFS's cost is not GUARANTEED minimal, and
// check_algo_pages.mjs forbids the copy from claiming it is worse — a claim
// that is false two times out of three.

export class MinHeap {
  constructor() { this.data = []; }
  get size() { return this.data.length; }

  push(item) {
    const d = this.data;
    d.push(item);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p].priority <= d[i].priority) break;
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }

  pop() {
    const d = this.data;
    const top = d[0];
    const last = d.pop();
    if (d.length) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < d.length && d[l].priority < d[smallest].priority) smallest = l;
        if (r < d.length && d[r].priority < d[smallest].priority) smallest = r;
        if (smallest === i) break;
        [d[smallest], d[i]] = [d[i], d[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function reconstructPath(end, prev) {
  const path = [end];
  let c = end;
  while (prev.has(c)) { c = prev.get(c); path.push(c); }
  path.reverse();
  return path;
}

/** Both cost-tracking maps, because BFS and DFS record them for the run log
 *  and neither reads `gScore` while choosing what to expand. */
function tracer(start) {
  return { prev: new Map(), gScore: new Map([[start, 0]]) };
}

// ------------------------------------------------------------------ BFS ---
// Expands in strict FIFO order, so the path it returns is minimal in HOP
// COUNT and nothing else. `gScore` is tracked purely for reporting.
export function* bfsSolve(start, end, neighborFn) {
  const visited = new Set([start]);
  const { prev, gScore } = tracer(start);
  // Index-based queue. Array.shift() is O(n) and this one holds 1,600 nodes.
  const queue = [start];
  let head = 0, visitedCount = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    visitedCount++;
    yield cur;
    if (cur === end) return { found: true, path: reconstructPath(end, prev), cost: gScore.get(end), visited: visitedCount };
    for (const { node: next, stepCost } of neighborFn(cur)) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, cur);
      gScore.set(next, gScore.get(cur) + stepCost);
      queue.push(next);
    }
  }
  return { found: false, path: [], cost: Infinity, visited: visitedCount };
}

// ------------------------------------------------------------------ DFS ---
// Marks a node "seen" the moment it is PUSHED, matching the stack-based DFS
// this replaces — not when it is popped, or the same branch gets queued onto
// the stack many times over.
export function* dfsSolve(start, end, neighborFn) {
  const seen = new Set([start]);
  const { prev, gScore } = tracer(start);
  const stack = [start];
  let visitedCount = 0;
  while (stack.length) {
    const cur = stack.pop();
    visitedCount++;
    yield cur;
    if (cur === end) return { found: true, path: reconstructPath(end, prev), cost: gScore.get(end), visited: visitedCount };
    for (const { node: next, stepCost } of neighborFn(cur)) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      gScore.set(next, gScore.get(cur) + stepCost);
      stack.push(next);
    }
  }
  return { found: false, path: [], cost: Infinity, visited: visitedCount };
}

// -------------------------------------------------------------- Dijkstra --
export function* dijkstraSolve(start, end, neighborFn) {
  const { prev, gScore } = tracer(start);
  const settled = new Set();
  const heap = new MinHeap();
  heap.push({ node: start, priority: 0 });
  let visitedCount = 0;
  while (heap.size > 0) {
    const { node: cur } = heap.pop();
    if (settled.has(cur)) continue; // stale entry: a cheaper route was already settled
    settled.add(cur);
    visitedCount++;
    yield cur;
    if (cur === end) return { found: true, path: reconstructPath(end, prev), cost: gScore.get(end), visited: visitedCount };
    for (const { node: next, stepCost } of neighborFn(cur)) {
      if (settled.has(next)) continue;
      const tentative = gScore.get(cur) + stepCost;
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
        prev.set(next, cur);
        heap.push({ node: next, priority: tentative });
      }
    }
  }
  return { found: false, path: [], cost: Infinity, visited: visitedCount };
}

// -------------------------------------------------------------------- A* ---
// Dijkstra with the heap ordered by gScore + heuristic. With an ADMISSIBLE
// heuristic — octileHeuristic below, paired with terrain whose cheapest cell
// costs exactly 1 — this returns the same `cost` as dijkstraSolve on the same
// input, while settling fewer nodes.
//
// HOW MUCH FEWER IS NOT A CONSTANT, and the page must not quote one. Measured
// on three 40×40 weighted terrains, A* settled 96.8%, 96.0% and 5.3% fewer
// cells than Dijkstra. The saving shrinks as the real cost range widens,
// because an admissible heuristic has to assume every remaining step could
// cost as little as the floor. So the honest claim is "always optimal, and
// usually explores less — the run log on the right is where you read how much
// on THIS terrain", and check_algo_modules asserts strictly-less rather than
// any ratio.
//
// `heuristicFn` is REQUIRED rather than defaulted to a zero function. A
// zero-heuristic default would make astarSolve quietly identical to
// dijkstraSolve, the page would still label the run "A*", and the only symptom
// would be the explored-cell count failing to drop — a claim nothing else
// contradicts. Failing loudly is cheaper than that.
//
// VALIDATED EAGERLY, which is a real distinction and not a style preference: a
// generator function's body does not run until the first `.next()`, so a `throw`
// written inside one fires a step INTO an animation rather than at the call
// that got the arguments wrong. This wrapper is a plain function precisely so
// the mistake surfaces where it was made.
export function astarSolve(start, end, neighborFn, heuristicFn) {
  if (typeof heuristicFn !== 'function') {
    throw new TypeError('astarSolve needs a heuristic; without one it is dijkstraSolve wearing A*’s label');
  }
  return astarWalk(start, end, neighborFn, heuristicFn);
}

function* astarWalk(start, end, neighborFn, heuristicFn) {
  const { prev, gScore } = tracer(start);
  const settled = new Set();
  const heap = new MinHeap();
  heap.push({ node: start, priority: heuristicFn(start, end) });
  let visitedCount = 0;
  while (heap.size > 0) {
    const { node: cur } = heap.pop();
    if (settled.has(cur)) continue;
    settled.add(cur);
    visitedCount++;
    yield cur;
    if (cur === end) return { found: true, path: reconstructPath(end, prev), cost: gScore.get(end), visited: visitedCount };
    for (const { node: next, stepCost } of neighborFn(cur)) {
      if (settled.has(next)) continue;
      const tentative = gScore.get(cur) + stepCost;
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
        prev.set(next, cur);
        heap.push({ node: next, priority: tentative + heuristicFn(next, end) });
      }
    }
  }
  return { found: false, path: [], cost: Infinity, visited: visitedCount };
}

export const SOLVERS = { bfs: bfsSolve, dfs: dfsSolve, dijkstra: dijkstraSolve, astar: astarSolve };

// ------------------------------------------------------------ FOUR-LEG PATROL
/** The four legs, in the order they take their turn, as the ONE table both the
 *  engine and the page read.
 *
 *  The previous version had this list written down twice — once here (as four
 *  `{ start, end }` pairs inside the runner) and once in maze.html's marker code
 *  as four literal disc labels — so nothing stopped the two from disagreeing,
 *  and the page drew S/G on the two points it happened to have rather than on
 *  the five the run actually used. `corner` is a key into the caller's points
 *  object, so a leg names a CORNER rather than a cell and this module keeps
 *  knowing nothing about grids. */
export const PATROL_LEGS = [
  { id: 'A', corner: 'topLeft', label: '左上' },
  { id: 'B', corner: 'bottomRight', label: '右下' },
  { id: 'C', corner: 'topRight', label: '右上' },
  { id: 'D', corner: 'bottomLeft', label: '左下' },
];

/**
 * Four searches that run TOGETHER rather than one after another.
 *
 * ## WHY THE INTERLEAVING IS FREE, AND WHY THAT MATTERS
 * Every solver above is a self-contained generator: its own `visited`/`settled`
 * set, its own `prev`/`gScore`, its own queue or heap. Nothing in this module
 * touches a node's `searchVisited` flag — that is the caller's, and it is how
 * the caller learns what to paint. So calling four generators' `.next()` in
 * rotation cannot change what any of them computes: A still returns A's path.
 * A change here that reordered the legs or reused one generator's state for
 * another WOULD, which is why check_maze_page asserts both the round-robin
 * order and that this file never mentions `searchVisited`.
 *
 * ## THE ORDER IS A CONTRACT, NOT A SCHEDULER ARTIFACT
 * Each round visits the live legs in PATROL_LEGS order, so a given cell is
 * yielded in the same sequence on every run and two runs can be diffed. Legs
 * that finish leave the rotation by being dropped from `pending`, so the
 * remaining ones speed up rather than polling four generators to get one answer.
 * The RETURNED `legs` is rebuilt from PATROL_LEGS order rather than in the order
 * they happened to finish — the page draws the four paths and prints four labels
 * in that order, and "whichever leg's goal happened to be nearest came first"
 * is not an order a reader can check a screenshot against.
 *
 * ## `cost` IS HERE BECAUSE THE PAGE CALLS .toFixed() ON IT
 * The original maze.html copy returned `{ legs, found, path }` and the page read
 * `result.cost` — `undefined` — then threw a TypeError inside a
 * requestAnimationFrame callback, which silently ended the run after the
 * search. `cost` is the SUM of the legs' costs: each leg is an independent
 * path out of the shared centre, so the sum is the patrol's total, and `found`
 * is false whenever any leg failed, in which case `cost` is Infinity and the
 * page does not print it.
 *
 * ## NO PER-LEG RESET, ON PURPOSE
 * There is no `searchVisited` write in this function to reset, and that is the
 * fix: the earlier version cleared all 1,600 flags before each leg, so the
 * first three legs' cells were wiped before the fourth painted and the canvas
 * showed one leg while the status line reported four.
 *
 * @param {Function} solver     one of SOLVERS
 * @param {Function} neighbourFn `(node) => [{ node, stepCost }]`
 * @param {Function|null} heuristicFn  required only for astarSolve
 * @param {object} pts          `{ center, topLeft, topRight, bottomLeft, bottomRight }`
 * @yields {object} the node that leg just settled — the same shape a single run yields
 * @returns {{legs: object[], found: boolean, path: object[], cost: number}}
 *   `legs` is one entry per PATROL_LEGS row, in that order, each carrying that
 *   leg's `id` and `label` beside the solver's own `{ found, path, cost }`.
 */
export function* starRun(solver, neighbourFn, heuristicFn, pts) {
  const runners = PATROL_LEGS.map((leg) => ({
    leg,
    result: null,
    gen: heuristicFn
      ? solver(pts.center, pts[leg.corner], neighbourFn, heuristicFn)
      : solver(pts.center, pts[leg.corner], neighbourFn),
  }));
  let pending = runners;
  while (pending.length) {
    const stillRunning = [];
    for (const runner of pending) {          // A → B → C → D, one step each
      const step = runner.gen.next();
      if (step.done) runner.result = step.value;
      else { stillRunning.push(runner); yield step.value; }
    }
    pending = stillRunning;
  }
  const legs = runners.map((r) => ({ id: r.leg.id, label: r.leg.label, ...r.result }));
  const found = legs.every((l) => l.found);
  let path = [];
  for (const l of legs) if (l.found) path = path.concat(l.path);
  const cost = found ? legs.reduce((sum, l) => sum + (l.cost || 0), 0) : Infinity;
  return { legs, found, path, cost };
}

// ------------------------------------------------------- Connected regions --
/**
 * The largest connected component of `isPassable` nodes, as a `Set`.
 *
 * ## WHAT THIS EXISTS FOR
 * maze.html picks its terrain endpoints at the corners of the bounding box of
 * **every** passable cell. On a sprite whose silhouette has a detached fragment
 * — a wing tip, a stray anti-aliased pixel — that corner is the FRAGMENT, not
 * the Pokémon, and start and goal land in different components, so the search
 * reports 「無解」 on a map that is perfectly solvable. Measured over 257 sprites
 * through the page's own `drawImage`: **9 sprites (3.5%)** are unsolvable that
 * way, and the largest fragment on a sprite that has one is a median of
 * **0.59%** of the grid — a handful of cells.
 *
 * ## TIE-BREAK IS SCAN ORDER, AND THAT IS THE CONTRACT
 * Two equal components keep the FIRST one found, because the comparison is
 * strict `>`. The alternative — the last — makes the result depend on where the
 * scan happened to start, and a caller that re-derives this would get a
 * different body on a different implementation.
 *
 * ## GRAPH-GENERIC, LIKE EVERYTHING ELSE HERE
 * `neighbourFn` is the caller's, so this knows nothing about walls, sprites or
 * eight directions — it takes the 8-directional no-corner-cut rule as given.
 * That is what makes the two call sites agree: maze.html's `terrainNeighbours`
 * supplies it, and the component therefore matches exactly the adjacency its
 * solvers search with.
 *
 * ## `at` MUST RETURN THE SAME OBJECT FOR THE SAME CELL
 * `seen` is a `Set`, so membership is by IDENTITY, not by coordinates — the same
 * rule the solvers follow, and the reason this module uses Map/Set rather than
 * string keys. A caller whose `at(x, y)` builds a fresh object per call does not
 * get a wrong answer, it gets **an unbounded loop**: no node is ever seen twice.
 * maze.html passes `cellAt = (x, y) => grid[y][x]`, which is stable by
 * construction. The checker found this by writing the fixture the wrong way.
 *
 * @param {number} size
 * @param {Function} at          `(x, y) => node | null`
 * @param {Function} neighbourFn `(node) => [{ node, stepCost }, …]`
 * @param {Function} isPassable  `(node) => boolean`
 * @returns {Set<object>} empty when nothing is passable
 */
export function largestComponent(size, at, neighbourFn, isPassable) {
  const seen = new Set();
  let best = new Set();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const seed = at(x, y);
      if (!seed || !isPassable(seed) || seen.has(seed)) continue;
      const group = new Set();
      const stack = [seed];
      seen.add(seed);
      while (stack.length) {
        const node = stack.pop();
        group.add(node);
        for (const { node: next } of neighbourFn(node)) {
          if (!isPassable(next) || seen.has(next)) continue;
          seen.add(next);
          stack.push(next);
        }
      }
      if (group.size > best.size) best = group;   // strict > ⇒ first wins a tie
    }
  }
  return best;
}

/** Octile distance: the standard A* heuristic for an 8-directional grid
 *  (orthogonal cost 1, diagonal √2). Admissible exactly when no edge in the
 *  graph costs less than 1 — which is why terrain cost below is clamped to
 *  [TERRAIN_MIN_COST, maxCost] rather than, say, [0, 8]. Verified over 200,000
 *  random pairs: it never exceeds the terrain-free octile lower bound. */
export function octileHeuristic(a, b) {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  const F = Math.SQRT2 - 1;
  return Math.max(dx, dy) + F * Math.min(dx, dy);
}

/** Manhattan distance — admissible on 4-directional grids only. Kept because
 *  迷宮牆壁 mode is 4-directional, so pairing it with A* there is honest. */
export function manhattanHeuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// ---------------------------------------------------------- Terrain cost --
/** The same alpha cutoff maze.html's renderer already uses to decide a pixel is
 *  "too transparent to read as colour", so a cell that is DRAWN as wall is a
 *  cell that is IMPASSABLE. One number, two consumers. */
export const TERRAIN_ALPHA_WALL_THRESHOLD = 50;
export const TERRAIN_MIN_COST = 1;
export const TERRAIN_MAX_COST_DEFAULT = 6;

/** Darker sprite pixels cost more to enter; lighter pixels cost closer to 1.
 *  The terrain's height map IS the sprite's own luminance, so what you see is
 *  what you pay, with no second overlay to keep in sync.
 *
 *  ## WHY Rec.709 LUMA AND NOT A PERCEPTUALLY UNIFORM LIGHTNESS
 *
 *  The reason is NOT "luma is the most correct colour science" — it is not, and
 *  all three weaknesses below are real. The reason is an INVARIANT:
 *
 *    **cost is a strictly monotonic function of the brightness the renderer
 *    actually draws**, so a reader can look at the grid and predict where A*
 *    will go.
 *
 *  A cost model that diverges from the visible image breaks that promise
 *  SILENTLY: the page still shows the sprite, the numbers still print, and
 *  nothing anywhere says the two have come apart. For a page whose claim is
 *  「看到的就是要付的」 that is a worse failure than a slightly lumpy
 *  landscape — and luminance-based brightness is itself a perceptual model
 *  (Rec.709 is the video standard's Y'), so the invariant and perceptual
 *  accuracy do not actually fight here.
 *
 *  ## MEASURED, SO THE NEXT PERSON DOES NOT RE-DERIVE IT
 *  Over 33,143,750 pixels sampled from 147 sprites (every 7th id), cost at
 *  maxCost = 6, passable cells only:
 *
 *      model          min     p25   median     p75     max
 *      Rec.709 luma  1.000   2.219   3.148    4.144   6.000   <- this one
 *      CIELAB L*     1.000   2.074   2.915    3.919   6.000
 *      OKLab L       1.000   1.936   2.643    3.504   6.000
 *
 *  They disagree MOST IN THE DARKS, which is weakness 1.
 *
 *  ## THE THREE WEAKNESSES, NAMED SO THEY ARE NOT REDISCOVERED AS BUGS
 *  1. **Y' is luma, not luminance.** Rec.709's Y' is gamma-encoded and this
 *    uses it as though it were linear brightness, which over-weights the dark
 *    end. That is the whole of the median gap above.
 *  2. **Cost steps are not perceptually uniform.** A 0.1 step between two
 *    near-black cells is as big a number as a 0.1 step between two near-white
 *    cells, but only the second is visible. The landscape over-penalises shade.
 *  3. **Blue is nearly invisible to the weights** — 7.2% against green's 71.5%.
 *    A vivid blue and a near-black navy cost almost the same.
 *
 *  ## WHAT WAS CONSIDERED, AND WHAT WOULD CHANGE THE ANSWER
 *  **A. Keep luma.** Status quo, invariant holds. The decision.
 *  **B. OKLab L.** Perceptually uniform, and `rgbToOklab()` ALREADY EXISTS in
 *    assets/js/color-match.js — whose docblock names this exact class of
 *    decision as the reason one conversion must have one implementation. Best
 *    evidence-to-effort ratio of the alternatives. Costs 1,600 conversions per
 *    地形對比度 change, and turns 「what you see is what you pay」 from literal
 *    into approximate.
 *  **C. Slope / elevation.** `cost = 1 + k·max(0, h(next) − h(current))`, so
 *    descending is free. This is what game AI actually does, and it is the most
 *    interesting pedagogically — 「climbing costs, flat is free」 is a real
 *    idea, and A* would route AROUND dark regions instead of through them. Not
 *    a fix but a redesign: cost becomes a property of a MOVE rather than a
 *    PLACE, 「路徑成本」 changes meaning, and octileHeuristic's admissibility has
 *    to be re-proved rather than inherited.
 *  **D. Local contrast.** Charge only for CHANGE, so a flat pale wing is free
 *    and the map's STRUCTURE is what costs. The largest change of the four.
 *
 *  **WHAT WOULD JUSTIFY MOVING OFF A:** evidence that a reader cannot predict
 *  the route from the image. The question to test is not 「which model looks
 *  nicer」 but 「does the visible grid explain the printed cost」 — and Rec.709
 *  fails that in the darks, not in the light, which is where the interesting
 *  paths are.
 *
 *  `maxCost` is the 地形對比度 dial. The width of [1, maxCost] bounds how much
 *  an admissible heuristic can possibly tell you — see the note on
 *  astarSolve — which is why the dial is exposed rather than fixed. Measured
 *  range is always exactly [1, maxCost]: 1.000 for #ffffff, maxCost for
 *  #000000. */
export function computeTerrainCost(color, maxCost = TERRAIN_MAX_COST_DEFAULT) {
  if (color.a < TERRAIN_ALPHA_WALL_THRESHOLD) return Infinity;
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b; // 0..255
  return TERRAIN_MIN_COST + (255 - luminance) / 255 * (maxCost - TERRAIN_MIN_COST);
}

export const DIAGONAL_DIRS = [
  { dx: 0, dy: -1, diag: false }, { dx: 1, dy: 0, diag: false },
  { dx: 0, dy: 1, diag: false }, { dx: -1, dy: 0, diag: false },
  { dx: 1, dy: -1, diag: true }, { dx: 1, dy: 1, diag: true },
  { dx: -1, dy: 1, diag: true }, { dx: -1, dy: -1, diag: true },
];

/** Nearest passable node to (tx,ty), scanning outward in square rings, via a
 *  caller-supplied `at(x,y) => node|null` and `isPassable(node)`.
 *  Grid-shape-agnostic for the same reason the solvers are: this is what the
 *  terrain mode's endpoints need, and it is testable on a 3×3 fake grid
 *  without constructing 1,600 Cells. */
export function findNearestPassable(tx, ty, size, at, isPassable) {
  if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
    const here = at(tx, ty);
    if (here && isPassable(here)) return here;
  }
  for (let r = 1; r < size * 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only, not a filled square
        const x = tx + dx, y = ty + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const node = at(x, y);
        if (node && isPassable(node)) return node;
      }
    }
  }
  return null; // everything is impassable — the caller decides the fallback
}
