/*
 * THE HOMEPAGE'S TWO SILENT DEMOS: A SORT AND AN A* SEARCH.
 *
 * This runs the same engines the full pages run — `sorting-algorithms.js` and
 * `maze-pathfinding.js` — with the sort keys from `sort-keys.js`. It is a
 * port of the reference's `home-showcase.js`, with three deliberate changes:
 *
 *   1. The roster is the compact `home_roster.json`; images are 96 px sprites
 *      (`spriteUrl`), not the 475 px artwork.
 *   2. `prefers-reduced-motion` draws a completed frame instead of looping.
 *   3. Canvas size is cached across frames. Resetting `canvas.width` every
 *      frame reallocates the bitmap and is measurable on a looping page.
 *
 * The step events are the repo's own shapes (`t`, `i`, `j`, `node`, …), not the
 * reference's (`type`, `a`, `b`). The generators MUTATE the array in place;
 * this file only reads it back and paints highlights.
 */

import { readThemeToken } from './shared.js';
import { ALGO_META } from './sorting-algorithms.js';
import { SORT_KEY_MAP } from './sort-keys.js';
import {
  astarSolve,
  largestComponent,
  octileHeuristic,
} from './maze-pathfinding.js';
import {
  buildPassableGrid,
  makeNeighborFn,
  pickFarEndpoints,
} from './home-sprite-grid.js';

const SHOWCASE_KEY_IDS = ['id', 'stats', 'height', 'hue'];
const SHOWCASE_ALGO_IDS = ['quick', 'merge', 'heap', 'insertion'];
const SETTLE_MS = 1400;
// One generator step every 40 ms. The old loop drained 8 steps per frame
// (~2 ms each), which made a 26-sprite sort finish before the eye could
// follow a single swap. 40 ms is slow enough to read and still loops.
const SORT_STEP_MS = 40;
const SPRITE_TIMEOUT_MS = 3000;
const SORT_GRID_ROWS = 2;
const SORT_COLS = 13;
const MAZE_GRID = 18;
const MAX_STEPS_PER_FRAME = 8;

function makeCanvasFitter(canvas, host) {
  const ctx = canvas.getContext('2d');
  let last = { w: 0, h: 0, dpr: 0 };
  return function fit(force = false) {
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (force || w !== last.w || h !== last.h || dpr !== last.dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      last = { w, h, dpr };
    }
    return { ctx, w, h };
  };
}

function loadSprite(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), SPRITE_TIMEOUT_MS);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function tokenReader() {
  let cache = new Map();
  return {
    read(name) {
      if (!cache.has(name)) cache.set(name, readThemeToken(name));
      return cache.get(name);
    },
    clear() { cache = new Map(); },
  };
}

function makeSortPanel(host, roster, imageUrl, ui) {
  const canvas = document.createElement('canvas');
  canvas.className = 'home-showcase-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '排序演算法精靈格自動展示');
  host.appendChild(canvas);
  const fit = makeCanvasFitter(canvas, host);
  const tokens = tokenReader();
  const labelEl = ui.label || null;
  const statusEl = ui.status || null;

  const byId = new Map(roster.map((p) => [p.id, p]));
  const images = new Map();
  const entries = [];
  const shuffled = roster.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const seen = new Set();
  for (const p of shuffled) {
    if (entries.length >= SORT_COLS * SORT_GRID_ROWS) break;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    entries.push({ id: p.id, data: byId.get(p.id) });
  }

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  let gen = null;
  let algo = null;
  let key = null;
  let work = entries.slice();
  let comparisons = 0;
  let swaps = 0;
  let marks = { compare: new Set(), swap: new Set(), mark: new Set() };
  let raf = 0;
  let timer = 0;
  let lastStepAt = 0;
  let paused = false;
  let destroyed = false;

  function clearMarks() {
    marks = { compare: new Set(), swap: new Set(), mark: new Set() };
  }

  function startRun() {
    algo = ALGO_META[SHOWCASE_ALGO_IDS[Math.floor(Math.random() * SHOWCASE_ALGO_IDS.length)]];
    key = SORT_KEY_MAP[SHOWCASE_KEY_IDS[Math.floor(Math.random() * SHOWCASE_KEY_IDS.length)]];
    if (!algo || !key) {
      if (labelEl) labelEl.textContent = '無法載入演算法';
      return;
    }
    work = entries.slice();
    clearMarks();
    lastStepAt = 0;
    comparisons = 0;
    swaps = 0;
    gen = algo.run(work, key.compare);
    const name = algo.short ?? algo.label;
    if (labelEl) labelEl.textContent = `${name} · ${key.short ?? key.label}`;
    if (statusEl) statusEl.textContent = `正在示範${name}，依${key.label}排序 ${work.length} 隻寶可夢`;
  }

  function apply(ev) {
    if (ev.t === 'compare') {
      comparisons++;
      marks.compare.add(ev.i);
      marks.compare.add(ev.j);
    } else if (ev.t === 'swap') {
      swaps++;
      marks.swap.add(ev.i);
      marks.swap.add(ev.j);
    } else if (ev.t === 'mark') {
      marks.mark.add(ev.i);
    } else if (ev.t === 'range') {
      for (let i = ev.lo; i <= ev.hi; i++) marks.mark.add(i);
    } else if (ev.t === 'write') {
      marks.mark.add(ev.i);
    }
  }

  function draw() {
    const { ctx, w, h } = fit();
    const bg = tokens.read('--canvas-bg');
    const text = tokens.read('--canvas-text');
    const compare = tokens.read('--algo-compare');
    const swap = tokens.read('--algo-swap');
    const gold = tokens.read('--accent-gold');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pad = 6;
    const gap = 4;
    const cell = Math.min(
      (w - pad * 2 - gap * (SORT_COLS - 1)) / SORT_COLS,
      (h - pad * 2 - gap * (SORT_GRID_ROWS - 1)) / SORT_GRID_ROWS,
    );
    const gridW = cell * SORT_COLS + gap * (SORT_COLS - 1);
    const gridH = cell * SORT_GRID_ROWS + gap * (SORT_GRID_ROWS - 1);
    const x0 = (w - gridW) / 2;
    const y0 = (h - gridH) / 2;
    const imgSize = Math.max(8, cell - 8);

    for (let i = 0; i < work.length; i++) {
      const col = i % SORT_COLS;
      const row = Math.floor(i / SORT_COLS);
      const x = x0 + col * (cell + gap);
      const y = y0 + row * (cell + gap);
      const t = work[i];
      let ring = null;
      if (marks.swap.has(i)) ring = swap;
      else if (marks.compare.has(i)) ring = compare;
      else if (marks.mark.has(i)) ring = gold;
      if (ring) {
        ctx.strokeStyle = ring;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
      }
      const img = images.get(t.id);
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x + (cell - imgSize) / 2, y + (cell - imgSize) / 2, imgSize, imgSize);
        ctx.imageSmoothingEnabled = true;
      }
    }

    if (!gen && comparisons + swaps > 0) {
      ctx.fillStyle = text;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`完成 · ${comparisons} 次比較 · ${swaps} 次交換`, w / 2, h - 4);
    }
  }

  function loop(now = performance.now()) {
    if (destroyed || paused || !gen) return;
    if (now - lastStepAt < SORT_STEP_MS) {
      raf = requestAnimationFrame(loop);
      return;
    }
    lastStepAt = now;
    clearMarks();
    const r = gen.next();
    if (r.done) {
      gen = null;
      clearMarks();
      draw();
      timer = setTimeout(() => {
        if (destroyed || paused) return;
        startRun();
        loop();
      }, SETTLE_MS);
      return;
    }
    apply(r.value);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function runOnceInstant() {
    if (destroyed || paused) return;
    startRun();
    lastStepAt = 0;
    if (!gen) return;
    clearMarks();
    let r = gen.next();
    while (!r.done) {
      apply(r.value);
      r = gen.next();
    }
    gen = null;
    clearMarks();
    draw();
  }

  function pause() {
    paused = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
  }

  function resume() {
    if (destroyed || !paused) return;
    paused = false;
    if (reduced) { runOnceInstant(); return; }
    if (!gen) startRun();
    lastStepAt = 0;
    loop();
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  const onTheme = () => { tokens.clear(); draw(); };
  const onMotion = () => {
    reduced = motion.matches;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    if (reduced) runOnceInstant();
    else if (!paused) { if (!gen) startRun(); lastStepAt = 0; loop(); }
  };
  window.addEventListener('themechange', onTheme);
  if (motion.addEventListener) motion.addEventListener('change', onMotion);

  (async () => {
    const loaded = await Promise.all(entries.map((t) => loadSprite(imageUrl(t.data))
      .then((img) => [t.id, img])));
    if (destroyed) return;
    for (const [id, img] of loaded) if (img) images.set(id, img);
    if (reduced) runOnceInstant();
    else { startRun(); loop(); }
  })();

  return {
    pause,
    resume,
    destroy() {
      destroyed = true;
      pause();
      ro.disconnect();
      window.removeEventListener('themechange', onTheme);
      if (motion.removeEventListener) motion.removeEventListener('change', onMotion);
    },
  };
}

function makeMazePanel(host, roster, imageUrl, ui) {
  const canvas = document.createElement('canvas');
  canvas.className = 'home-showcase-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'A* 路徑搜尋自動展示');
  host.appendChild(canvas);
  const fit = makeCanvasFitter(canvas, host);
  const tokens = tokenReader();
  const setBusy = ui.setBusy || (() => {});
  const setLabel = ui.setLabel || (() => {});

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  let paused = false;
  let destroyed = false;
  let raf = 0;
  let timer = 0;
  let gen = null;
  let grid = null;
  let img = null;
  let starting = false;
  let picked = null;
  let start = null;
  let end = null;
  let path = null;
  let ai = -1;
  let visited = null;
  let steps = 0;

  function draw() {
    const { ctx, w, h } = fit();
    const bg = tokens.read('--canvas-bg');
    const text = tokens.read('--canvas-text');
    const aiColor = tokens.read('--algo-compare');
    const startColor = tokens.read('--algo-start');
    const goalColor = tokens.read('--algo-goal');
    const gold = tokens.read('--accent-gold');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!grid) {
      ctx.fillStyle = text;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('正在準備地形…', w / 2, h / 2);
      return;
    }

    const gap = 1;
    const size = Math.min(
      (w - gap * (grid.size + 1)) / grid.size,
      (h - gap * (grid.size + 1)) / grid.size,
    );
    const total = size * grid.size + gap * (grid.size + 1);
    const ox = (w - total) / 2;
    const oy = (h - total) / 2;
    const imgSize = Math.max(4, size - 2);

    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const node = grid.rows[y][x];
        if (node.empty) continue;
        const px = ox + gap + x * (size + gap);
        const py = oy + gap + y * (size + gap);
        if (visited && visited.has(node)) {
          ctx.fillStyle = 'rgba(76,201,240,0.22)';
          ctx.fillRect(px, py, size, size);
        }
        if (img) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, px + (size - imgSize) / 2, py + (size - imgSize) / 2, imgSize, imgSize);
          ctx.imageSmoothingEnabled = true;
        }
      }
    }

    const cellXY = (node) => ({
      cx: ox + gap + node.x * (size + gap) + size / 2,
      cy: oy + gap + node.y * (size + gap) + size / 2,
    });

    if (path && path.length) {
      ctx.strokeStyle = aiColor;
      ctx.lineWidth = Math.max(2, size * 0.22);
      ctx.beginPath();
      path.forEach((node, i) => {
        const { cx, cy } = cellXY(node);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      const { cx, cy } = cellXY(path[Math.min(Math.max(ai, 0), path.length - 1)]);
      ctx.fillStyle = aiColor;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }

    const s = cellXY(start);
    ctx.fillStyle = startColor;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, size * 0.32, 0, Math.PI * 2);
    ctx.fill();

    const e = cellXY(end);
    ctx.fillStyle = goalColor;
    ctx.beginPath();
    ctx.arc(e.cx, e.cy, size * 0.32, 0, Math.PI * 2);
    ctx.fill();

    if (!gen && path) {
      ctx.fillStyle = gold;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`已找到 · ${steps} 步`, w / 2, h - 4);
    }
  }

  function loop() {
    if (destroyed || paused || !gen) return;
    let r = null;
    for (let n = 0; n < MAX_STEPS_PER_FRAME; n++) {
      r = gen.next();
      if (r.done) break;
      if (!visited.has(r.value)) visited.add(r.value);
    }
    if (r && r.done) {
      path = r.value?.path ?? [];
      ai = path.length - 1;
      steps = Math.max(0, path.length - 1);
      gen = null;
      draw();
      setLabel(`${picked.names?.zh ?? `#${picked.id}`} · 最短路徑 ${steps} 步`);
      timer = setTimeout(() => {
        if (destroyed || paused) return;
        startRun();
      }, SETTLE_MS);
      return;
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  async function startRun() {
    if (destroyed || paused || starting) return;
    starting = true;
    cancelAnimationFrame(raf);
    const p = roster[Math.floor(Math.random() * roster.length)];
    setBusy(true);
    const image = await loadSprite(imageUrl(p));
    starting = false;
    if (destroyed || paused) { setBusy(false); return; }
    if (!image) {
      setLabel('精靈圖載入失敗，稍後重試');
      setBusy(false);
      timer = setTimeout(startRun, 800);
      return;
    }
    const g = buildPassableGrid(image, MAZE_GRID);
    if (!g.passable) {
      timer = setTimeout(startRun, 400);
      return;
    }
    const neighbourFn = makeNeighborFn(g);
    const component = largestComponent(
      g.size,
      (x, y) => g.rows[y][x],
      neighbourFn,
      (node) => !node.empty,
    );
    if (component.size < 2) {
      timer = setTimeout(startRun, 400);
      return;
    }
    const [s, e] = pickFarEndpoints(component);
    picked = p;
    img = image;
    grid = g;
    start = s;
    end = e;
    path = null;
    ai = -1;
    visited = new Set();
    steps = 0;
    gen = astarSolve(s, e, neighbourFn, octileHeuristic);
    setLabel(`${p.names?.zh ?? `#${p.id}`} · A* 搜尋中`);
    setBusy(false);
    if (reduced) runOnceInstant();
    else loop();
  }

  function pause() {
    paused = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
  }

  function resume() {
    if (destroyed || !paused) return;
    paused = false;
    if (reduced) runOnceInstant();
    else if (gen) loop();
    else startRun();
  }

  function runOnceInstant() {
    if (destroyed || paused) return;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    if (!gen) { startRun(); return; }
    let r = gen.next();
    while (!r.done) {
      if (!visited.has(r.value)) visited.add(r.value);
      r = gen.next();
    }
    path = r.value?.path ?? [];
    ai = path.length - 1;
    steps = Math.max(0, path.length - 1);
    gen = null;
    draw();
    setBusy(false);
    setLabel(`${picked.names?.zh ?? `#${picked.id}`} · 最短路徑 ${steps} 步`);
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  const onTheme = () => { tokens.clear(); draw(); };
  const onMotion = () => {
    reduced = motion.matches;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    if (reduced) runOnceInstant();
    else if (!paused) startRun();
  };
  window.addEventListener('themechange', onTheme);
  if (motion.addEventListener) motion.addEventListener('change', onMotion);

  startRun();

  return {
    pause,
    resume,
    destroy() {
      destroyed = true;
      pause();
      ro.disconnect();
      window.removeEventListener('themechange', onTheme);
      if (motion.removeEventListener) motion.removeEventListener('change', onMotion);
    },
  };
}

export function initSortShowcase(host, roster, imageUrl, ui = {}) {
  if (!host) return null;
  return makeSortPanel(host, roster, imageUrl, ui);
}

export function initMazeShowcase(host, roster, imageUrl, ui = {}) {
  if (!host) return null;
  return makeMazePanel(host, roster, imageUrl, ui);
}

export { SHOWCASE_KEY_IDS, SHOWCASE_ALGO_IDS };
