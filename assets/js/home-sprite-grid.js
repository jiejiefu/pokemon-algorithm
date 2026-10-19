/*
 * TURN A 96×96 SPRITE INTO A GRID THE HOME DEMOS CAN WALK.
 *
 * The homepage deliberately does not load artwork: the showcase's maze draws
 * the silhouette at ~11 px a cell and the game at ~26 px, so the 96 px sprite
 * is both the correct resolution and 1.9 KB instead of 126 KB.
 *
 * A wall is any pixel whose alpha is below the same threshold `maze.html`
 * uses (`TERRAIN_ALPHA_WALL_THRESHOLD` from `maze-pathfinding.js`), so the
 * demos agree with the full page about what counts as terrain.
 */

import {
  DIAGONAL_DIRS,
  TERRAIN_ALPHA_WALL_THRESHOLD,
} from './maze-pathfinding.js';

const EMPTY = { empty: true, x: 0, y: 0 };

export function buildPassableGrid(img, size) {
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.drawImage(img, 0, 0, size, size);
  const { data } = octx.getImageData(0, 0, size, size);

  const rows = [];
  let passable = 0;
  for (let y = 0; y < size; y++) {
    const row = new Array(size);
    for (let x = 0; x < size; x++) {
      const alpha = data[(y * size + x) * 4 + 3];
      if (alpha < TERRAIN_ALPHA_WALL_THRESHOLD) {
        row[x] = EMPTY;
      } else {
        row[x] = { x, y, empty: false };
        passable++;
      }
    }
    rows.push(row);
  }
  return { size, rows, passable };
}

const STEP_COST = { true: Math.SQRT2, false: 1 };

export function makeNeighborFn(grid, options = {}) {
  const diagonal = options.diagonal !== false;
  const dirs = diagonal ? DIAGONAL_DIRS : DIAGONAL_DIRS.filter((d) => !d.diag);
  return (node) => {
    const out = [];
    for (const { dx, dy, diag } of dirs) {
      const x = node.x + dx;
      const y = node.y + dy;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      const next = grid.rows[y][x];
      if (!next.empty) out.push({ node: next, stepCost: STEP_COST[diag] });
    }
    return out;
  };
}

export function pickFarEndpoints(component) {
  const nodes = Array.from(component);
  const a = nodes[0];
  let b = a;
  let best = -1;
  for (const n of nodes) {
    const d = (n.x - a.x) ** 2 + (n.y - a.y) ** 2;
    if (d > best) { best = d; b = n; }
  }
  let a2 = b;
  best = -1;
  for (const n of nodes) {
    const d = (n.x - b.x) ** 2 + (n.y - b.y) ** 2;
    if (d > best) { best = d; a2 = n; }
  }
  return [a2, b];
}
