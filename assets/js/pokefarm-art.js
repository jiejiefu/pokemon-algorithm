/**
 * pokefarm-art.js — the farm's pixel art, drawn by code
 * ======================================================
 * Gen III–style 16×16 tiles, drawn with rectangles instead of shipped as PNGs.
 * Three reasons: nothing to download or license (the Bulbagarden Gen III sprite
 * archive is Nintendo's art, and this is a code project); every berry's five
 * growth stages come from ONE shape with the berry's own colour poured in, so
 * nine berries are not forty-five hand-made files; and a stage can be re-tuned
 * by changing a number.
 *
 * Tiles are rendered once into small offscreen canvases (`tile()` caches by
 * key), so a frame is 126 `drawImage` calls, not 126 tiles' worth of rectangles.
 *
 * COLOURS ARE DATA, NOT STYLING. They are the pixel-art palette (what colour is
 * a Cheri Berry?), so they live here as constants; the page's own chrome takes
 * its colours from CSS tokens in pokefarm.css. The first block is the ground and
 * structures; `BERRY_ART` is the fruit colour and its darker outline per berry.
 */

import { GRID, FIELD, WELL, KITCHEN, WAREHOUSE, BERRY_IDS } from './pokefarm-data.js';

export const T = 16;                       // art pixels per tile

const PAL = {
  grass: '#5ba44a', grassDark: '#3f8140', grassLight: '#7fc866',
  path: '#d9bd82', pathDark: '#bf9f64', pathLight: '#ead39c',
  soil: '#a8743c', soilDark: '#7e522a', soilLight: '#c89358',
  tilled: '#8f5d30', furrow: '#5f3b1c', ridge: '#b27c46',
  wet: '#5b3a1e', wetLight: '#7a5129', wetFurrow: '#3f2813',
  ash: '#6d6a66', ashLight: '#9a9690',
  leaf: '#46a84f', leafLight: '#7fd36b', leafDark: '#25692c', stem: '#2f7a35',
  bloom: '#fff4f0', bloomPink: '#ffb7c8',
  wild: '#3a7a35', wildLight: '#5eaa4c', wildDark: '#265a2a',
  stone: '#a3a9b2', stoneDark: '#6a7078', stoneLight: '#cdd2d8',
  water: '#4aa3e8', waterDark: '#2a75bf', waterLight: '#9bd4ff',
  wood: '#a8733c', woodDark: '#6e4624', woodLight: '#cf9a5c',
  roof: '#c2493d', roofDark: '#8b2b26',
  trunk: '#7a4e28', canopy: '#2f8a3c', canopyDark: '#1f6129', canopyLight: '#58b24f',
  fire: '#ff7a2b', fireLight: '#ffd23a', smoke: '#d8dde4',
  brick: '#b4584a', brickDark: '#7e3b33', iron: '#3c4047', ironLight: '#5a606a',
  flowerA: '#ffd23a', flowerB: '#ff7fa6', flowerC: '#ffffff', rock: '#8e949c',
};

/** Fruit colour, outline, and highlight for each berry. */
export const BERRY_ART = {
  cheri:  { c: '#e5413b', d: '#8f1f22', h: '#ff9a8e' },
  chesto: { c: '#7a58c4', d: '#43297f', h: '#b79cf0' },
  pecha:  { c: '#ffa38a', d: '#c9624a', h: '#ffd9cc' },
  rawst:  { c: '#9fd98a', d: '#4e8f3f', h: '#d6f5c8' },
  aspear: { c: '#f2e04a', d: '#a89416', h: '#fff7a6' },
  oran:   { c: '#4f8df5', d: '#25509f', h: '#a9c9ff' },
  persim: { c: '#f59a3c', d: '#a8591a', h: '#ffd09a' },
  lum:    { c: '#58d268', d: '#27853a', h: '#a9f2b2' },
  sitrus: { c: '#ffb81f', d: '#b87a00', h: '#ffe08a' },
};
export { BERRY_IDS };

/* ----------------------------------------------------------------- helpers */

const mkCanvas = () => {
  const c = document.createElement('canvas');
  c.width = T; c.height = T;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
};
const r = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
const p = (g, x, y, col) => r(g, x, y, 1, 1, col);

/** Small deterministic hash so tiles vary without Math.random (and never flicker). */
const hash = (a, b = 0, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* ----------------------------------------------------------------- ground */

function grass(g, v) {
  r(g, 0, 0, T, T, PAL.grass);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(hash(v, i, 1) * 15); const y = Math.floor(hash(v, i, 2) * 15);
    p(g, x, y, PAL.grassDark);
    if (i % 2 === 0) { p(g, x + 1, y - 1 < 0 ? 0 : y - 1, PAL.grassLight); }
  }
}

function path(g, v) {
  r(g, 0, 0, T, T, PAL.path);
  for (let i = 0; i < 6; i++) {
    p(g, Math.floor(hash(v, i, 3) * 16), Math.floor(hash(v, i, 4) * 16), PAL.pathDark);
    p(g, Math.floor(hash(v, i, 5) * 16), Math.floor(hash(v, i, 6) * 16), PAL.pathLight);
  }
}

function soil(g, kind, wet) {
  const base = wet ? PAL.wet : kind === 'tilled' ? PAL.tilled : PAL.soil;
  r(g, 0, 0, T, T, base);
  if (kind === 'fallow') {
    for (let i = 0; i < 10; i++) {
      p(g, Math.floor(hash(1, i, 7) * 16), Math.floor(hash(1, i, 8) * 16), PAL.soilDark);
      p(g, Math.floor(hash(1, i, 9) * 16), Math.floor(hash(1, i, 10) * 16), PAL.soilLight);
    }
    r(g, 0, 0, T, 1, PAL.soilDark); r(g, 0, 0, 1, T, PAL.soilDark);
  } else {
    const furrow = wet ? PAL.wetFurrow : PAL.furrow;
    const ridge = wet ? PAL.wetLight : PAL.ridge;
    for (let y = 2; y < T; y += 4) { r(g, 0, y, T, 1, ridge); r(g, 0, y + 2, T, 1, furrow); }
    r(g, 0, 0, T, 1, furrow); r(g, 0, 0, 1, T, furrow);
  }
}

function wild(g, v) {
  r(g, 0, 0, T, T, PAL.wild);
  for (let i = 0; i < 9; i++) {
    const x = 1 + Math.floor(hash(v, i, 11) * 13); const y = 4 + Math.floor(hash(v, i, 12) * 11);
    r(g, x, y - 3, 1, 4, PAL.wildDark);
    r(g, x + 1, y - 4, 1, 4, PAL.wildLight);
  }
  r(g, 0, 0, T, 1, PAL.wildDark);
}

function stubble(g) {
  soil(g, 'fallow', false);
  for (let i = 0; i < 7; i++) {
    const x = 1 + Math.floor(hash(2, i, 13) * 13); const y = 5 + Math.floor(hash(2, i, 14) * 9);
    r(g, x, y, 1, 3, PAL.woodLight); p(g, x, y, PAL.woodDark);
  }
}

function weeds(g) {
  for (let i = 0; i < 4; i++) {
    const x = 1 + Math.floor(hash(3, i, 15) * 12); const y = 8 + Math.floor(hash(3, i, 16) * 6);
    r(g, x, y - 2, 1, 3, PAL.wildLight); r(g, x - 1, y - 3, 1, 2, PAL.wildDark); r(g, x + 1, y - 3, 1, 2, PAL.wildDark);
  }
}

function ashSoil(g) {
  for (let i = 0; i < 12; i++) {
    p(g, Math.floor(hash(4, i, 17) * 16), Math.floor(hash(4, i, 18) * 16), i % 2 ? PAL.ash : PAL.ashLight);
  }
}

/* ----------------------------------------------------------------- plants */

function leaf(g, x, y, w = 2, h = 1) {
  r(g, x - 1, y - 1, w + 2, h + 2, PAL.leafDark);
  r(g, x, y, w, h, PAL.leaf);
  p(g, x, y, PAL.leafLight);
}

function plant(g, stage, berry) {
  // Shadow
  r(g, 4, 13, 8, 1, 'rgba(0,0,0,0.22)');
  if (stage === 0) {                         // just sown: a mound and one sprout
    r(g, 6, 11, 4, 2, PAL.soilLight); r(g, 5, 12, 6, 1, PAL.soilDark);
    p(g, 7, 10, PAL.leaf); p(g, 8, 9, PAL.leafLight); return;
  }
  const tall = stage >= 2;
  r(g, 7, tall ? 5 : 8, 2, tall ? 8 : 5, PAL.stem);
  p(g, 7, tall ? 5 : 8, PAL.leafLight);
  leaf(g, 4, 10, 3, 1); leaf(g, 9, 9, 3, 1);
  if (stage >= 2) { leaf(g, 3, 7, 3, 1); leaf(g, 10, 6, 3, 1); leaf(g, 6, 3, 4, 1); }
  if (stage === 3) {                         // flowers
    p(g, 4, 6, PAL.bloom); p(g, 11, 5, PAL.bloomPink); p(g, 7, 2, PAL.bloom); p(g, 12, 8, PAL.bloom); p(g, 3, 9, PAL.bloomPink);
  }
  if (stage === 4) {                         // ripe: clusters of fruit
    const a = BERRY_ART[berry] || BERRY_ART.cheri;
    const fruit = (x, y) => { r(g, x, y, 3, 3, a.d); r(g, x, y, 2, 2, a.c); p(g, x, y, a.h); };
    fruit(3, 5); fruit(10, 4); fruit(5, 9); fruit(9, 9); fruit(7, 6);
  }
}

/* ------------------------------------------------------------ structures */

function well(g) {
  grass(g, 90);
  r(g, 2, 8, 12, 6, PAL.stoneDark); r(g, 2, 7, 12, 6, PAL.stone);
  r(g, 4, 8, 8, 4, PAL.waterDark); r(g, 5, 8, 6, 3, PAL.water); r(g, 6, 8, 3, 1, PAL.waterLight);
  r(g, 2, 7, 12, 1, PAL.stoneLight);
  r(g, 3, 1, 1, 8, PAL.woodDark); r(g, 12, 1, 1, 8, PAL.woodDark);
  r(g, 2, 0, 12, 3, PAL.roofDark); r(g, 2, 0, 12, 2, PAL.roof);
  r(g, 7, 3, 2, 4, PAL.woodLight);
}

function kitchen(g) {
  grass(g, 91);
  r(g, 2, 6, 12, 9, PAL.brickDark); r(g, 2, 6, 12, 8, PAL.brick);
  for (let y = 8; y < 14; y += 3) r(g, 2, y, 12, 1, PAL.brickDark);
  r(g, 5, 10, 6, 4, PAL.iron); r(g, 6, 11, 4, 3, PAL.fire); r(g, 7, 12, 2, 2, PAL.fireLight);
  r(g, 3, 3, 10, 4, PAL.iron); r(g, 4, 3, 8, 1, PAL.ironLight); r(g, 3, 6, 10, 1, '#25282d');
  p(g, 6, 1, PAL.smoke); p(g, 9, 0, PAL.smoke); p(g, 8, 2, PAL.smoke);
}

function warehouse(g) {
  grass(g, 92);
  r(g, 1, 3, 14, 3, PAL.roofDark); r(g, 1, 2, 14, 3, PAL.roof);
  r(g, 2, 5, 12, 10, PAL.woodDark); r(g, 2, 5, 12, 9, PAL.wood);
  for (let x = 4; x < 14; x += 3) r(g, x, 5, 1, 9, PAL.woodDark);
  r(g, 5, 8, 6, 6, PAL.woodDark); r(g, 6, 9, 4, 5, '#3a2412');
  r(g, 2, 5, 12, 1, PAL.woodLight);
}

function tree(g, stump) {
  grass(g, 93);
  r(g, 4, 14, 8, 1, 'rgba(0,0,0,0.2)');
  if (stump) {
    r(g, 4, 9, 8, 5, PAL.woodDark); r(g, 4, 9, 8, 4, PAL.wood); r(g, 5, 9, 6, 2, PAL.woodLight);
    r(g, 6, 10, 4, 1, PAL.wood); return;
  }
  r(g, 7, 9, 3, 6, PAL.trunk); p(g, 7, 9, PAL.woodLight);
  r(g, 2, 1, 12, 10, PAL.canopyDark); r(g, 2, 1, 11, 9, PAL.canopy);
  r(g, 4, 0, 8, 2, PAL.canopyDark); r(g, 4, 0, 7, 1, PAL.canopy);
  r(g, 4, 2, 4, 3, PAL.canopyLight); r(g, 9, 4, 2, 2, PAL.canopyLight);
}

function pileBerry(g, berry) {
  const a = BERRY_ART[berry] || BERRY_ART.cheri;
  r(g, 3, 10, 10, 4, PAL.woodDark); r(g, 3, 10, 10, 3, PAL.woodLight);
  for (const [x, y] of [[4, 8], [7, 7], [10, 8], [6, 10], [9, 10]]) { r(g, x, y, 3, 3, a.d); r(g, x, y, 2, 2, a.c); p(g, x, y, a.h); }
}
function pileWood(g) {
  r(g, 2, 11, 12, 3, PAL.woodDark); r(g, 2, 11, 12, 2, PAL.wood);
  r(g, 4, 8, 8, 3, PAL.woodDark); r(g, 4, 8, 8, 2, PAL.woodLight);
  p(g, 3, 12, PAL.woodLight); p(g, 12, 12, PAL.woodLight); p(g, 5, 9, PAL.wood);
}

function decor(g, kind) {
  if (kind === 'flowers') {
    for (let i = 0; i < 4; i++) {
      const x = 2 + Math.floor(hash(5, i, 19) * 12); const y = 3 + Math.floor(hash(5, i, 20) * 11);
      p(g, x, y, [PAL.flowerA, PAL.flowerB, PAL.flowerC][i % 3]); p(g, x, y + 1, PAL.grassDark);
    }
  } else if (kind === 'rock') {
    r(g, 4, 9, 8, 5, PAL.stoneDark); r(g, 4, 8, 8, 5, PAL.rock); r(g, 5, 8, 4, 1, PAL.stoneLight);
  }
}

/* --------------------------------------------------------- the tile cache */

const cache = new Map();

/** A canal: a dug channel on a path tile (`built`), or the dashed outline of one still to dig. */
function canal(g, built) {
  path(g, 0);
  if (!built) {
    g.fillStyle = PAL.pathDark;
    for (let x = 2; x < 14; x += 4) { g.fillRect(x, 2, 2, 1); g.fillRect(x, 13, 2, 1); }
    for (let y = 2; y < 14; y += 4) { g.fillRect(2, y, 1, 2); g.fillRect(13, y, 1, 2); }
    return;
  }
  g.fillStyle = PAL.soilDark; g.fillRect(4, 0, 8, 16);
  g.fillStyle = PAL.waterDark; g.fillRect(5, 0, 6, 16);
  g.fillStyle = PAL.water; g.fillRect(6, 0, 4, 16);
  g.fillStyle = PAL.waterLight; g.fillRect(7, 2, 1, 3); g.fillRect(8, 8, 1, 3); g.fillRect(7, 13, 1, 2);
}

/**
 * A cached 16×16 tile. `key` fully describes it: kind + variant + berry + stage.
 * Layers are composed by the caller (ground first, then plant, then overlays).
 */
export function tile(kind, a = 0, b = '') {
  const key = `${kind}|${a}|${b}`;
  let c = cache.get(key);
  if (c) return c;
  const [cv, g] = mkCanvas();
  switch (kind) {
    case 'grass': grass(g, a); break;
    case 'path': path(g, a); break;
    case 'wild': wild(g, a); break;
    case 'fallow': soil(g, 'fallow', false); break;
    case 'tilled': soil(g, 'tilled', false); break;
    case 'wet': soil(g, 'tilled', true); break;
    case 'stubble': stubble(g); break;
    case 'weeds': weeds(g); break;
    case 'ash': ashSoil(g); break;
    case 'plant': plant(g, a, b); break;
    case 'well': well(g); break;
    case 'kitchen': kitchen(g); break;
    case 'warehouse': warehouse(g); break;
    case 'tree': tree(g, false); break;
    case 'stump': tree(g, true); break;
    case 'pileBerry': pileBerry(g, b); break;
    case 'pileWood': pileWood(g); break;
    case 'flowers': decor(g, 'flowers'); break;
    case 'rock': decor(g, 'rock'); break;
    case 'canal': canal(g, a); break;
    case 'sparkle': p(g, 3, 3, '#fff'); p(g, 12, 6, '#fff'); p(g, 7, 11, '#fff'); break;
    default: break;
  }
  cache.set(key, cv);
  return cv;
}

/* ------------------------------------------------------------------ board */

const inField = (x, y) => x >= FIELD.x0 && x < FIELD.x0 + FIELD.cols && y >= FIELD.y0 && y < FIELD.y0 + FIELD.rows;
const onLane = (x, y) => x >= FIELD.x0 - 1 && x <= FIELD.x0 + FIELD.cols && y >= FIELD.y0 - 1 && y <= FIELD.y0 + FIELD.rows && !inField(x, y);

/** Fixed decoration, so the board does not change between frames or reloads. */
const DECOR = new Map();
for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
  const h = hash(x, y, 21);
  if (h < 0.07) DECOR.set(`${x},${y}`, 'flowers');
  else if (h > 0.965) DECOR.set(`${x},${y}`, 'rock');
}
const isStructure = (x, y) => (x === WELL.x && y === WELL.y) || (x === KITCHEN.x && y === KITCHEN.y) || (x === WAREHOUSE.x && y === WAREHOUSE.y);

/** Size, in art pixels, of the whole board. */
export const BOARD = { w: GRID.w * T, h: GRID.h * T };

/**
 * Draw the board. `anim` is seconds, used only for the ripe-berry twinkle.
 * Workers are NOT drawn here; they are DOM images laid over the canvas.
 */
export function drawBoard(g, world, anim = 0) {
  g.imageSmoothingEnabled = false;
  const blit = (cv, x, y) => g.drawImage(cv, x * T, y * T);
  for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
    if (inField(x, y)) continue;
    if (onLane(x, y)) blit(tile('path', (x * 7 + y * 3) % 5), x, y);
    else {
      blit(tile('grass', (x * 13 + y * 7) % 6), x, y);
      const d = DECOR.get(`${x},${y}`);
      if (d && !isStructure(x, y)) blit(tile(d), x, y);
    }
  }
  blit(tile('well'), WELL.x, WELL.y);
  blit(tile('kitchen'), KITCHEN.x, KITCHEN.y);
  blit(tile('warehouse'), WAREHOUSE.x, WAREHOUSE.y);
  world.trees.forEach((t) => blit(tile(t.wood > 0 ? 'tree' : 'stump'), t.x, t.y));

  // Canals sit on the path beside the field: dashed outline until dug, water after.
  for (const c of world.canals || []) {
    const host = world.plots.some((q) => q.open && q.y === c.y && Math.abs(q.x - c.x) === 1);
    if (c.built || host) blit(tile('canal', c.built ? 1 : 0), c.x, c.y);
  }
  // A tree that has not been shaken today shows a few berries in its leaves.
  for (const t of world.trees) {
    if (t.shaken || t.wood <= 0) continue;
    g.fillStyle = '#ff5a4a'; g.fillRect(t.x * T + 4, t.y * T + 4, 2, 2);
    g.fillStyle = '#ffd23a'; g.fillRect(t.x * T + 10, t.y * T + 6, 2, 2);
    g.fillStyle = '#8f6bd6'; g.fillRect(t.x * T + 7, t.y * T + 2, 2, 2);
  }
  for (const pl of world.plots) {
    if (!pl.open) { blit(tile('wild', pl.i % 3), pl.x, pl.y); continue; }
    switch (pl.state) {
      case 'wild': blit(tile('wild', pl.i % 3), pl.x, pl.y); break;
      case 'fallow': blit(tile('fallow'), pl.x, pl.y); break;
      case 'stubble': blit(tile('stubble'), pl.x, pl.y); break;
      case 'tilled': blit(tile('tilled'), pl.x, pl.y); if (pl.ash) blit(tile('ash'), pl.x, pl.y); break;
      case 'growing':
        blit(tile(pl.stageWatered ? 'wet' : 'tilled'), pl.x, pl.y);
        blit(tile('plant', pl.stage, pl.berry), pl.x, pl.y);
        break;
      case 'ripe':
        blit(tile('tilled'), pl.x, pl.y);
        blit(tile('plant', 4, pl.berry), pl.x, pl.y);
        if (Math.floor(anim * 2 + pl.i) % 2 === 0) blit(tile('sparkle'), pl.x, pl.y);
        break;
      default: break;
    }
    if (pl.weeds && (pl.state === 'tilled' || pl.state === 'growing')) blit(tile('weeds'), pl.x, pl.y);
  }
  // Pests: a little red beetle that shuffles along the plant, 7x5 art pixels.
  for (const pl of world.plots) {
    if (!pl.pest) continue;
    const bx = pl.x * T + 4 + Math.round(Math.sin(anim * 5 + pl.i) * 2);
    const by = pl.y * T + 7 + (Math.floor(anim * 6 + pl.i) % 2);
    g.fillStyle = '#1b1b1b'; g.fillRect(bx + 1, by + 4, 1, 1); g.fillRect(bx + 5, by + 4, 1, 1); g.fillRect(bx, by + 1, 1, 1); g.fillRect(bx + 6, by + 1, 1, 1);
    g.fillStyle = '#c8321f'; g.fillRect(bx + 1, by + 1, 5, 3);
    g.fillStyle = '#7a1a10'; g.fillRect(bx + 3, by + 1, 1, 3);
    g.fillStyle = '#ffffff'; g.fillRect(bx + 2, by + 1, 1, 1); g.fillRect(bx + 4, by + 1, 1, 1);
  }
  for (const pile of world.piles) {
    const px = Math.floor(pile.x); const py = Math.floor(pile.y);
    blit(tile(pile.kind === 'berry' ? 'pileBerry' : 'pileWood', 0, pile.berry || ''), px, py);
  }
  // A bolt that has been announced and has not landed yet: a blinking yellow frame on its target.
  for (const h of world.hazards || []) {
    if (h.kind !== 'bolt' || !h.warned || h.done) continue;
    const p = world.plots[h.target];
    if (!p || Math.floor(anim * 6) % 2) continue;
    g.strokeStyle = '#ffe14a'; g.lineWidth = 1;
    g.strokeRect(p.x * T + 0.5, p.y * T + 0.5, T - 1, T - 1);
    g.fillStyle = '#ffe14a'; g.fillRect(p.x * T + 6, p.y * T + 3, 3, 4); g.fillRect(p.x * T + 5, p.y * T + 7, 3, 3);   // a tiny bolt
  }
}
