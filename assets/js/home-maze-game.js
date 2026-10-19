/*
 * THE HOMEPAGE'S A* RACE — the reader's moves against the same algorithm.
 *
 * The AI is deliberately the honest opponent: four-directional moves and
 * `manhattanHeuristic`, because that pair is admissible on this grid. The
 * showcase uses octile + eight directions; the game does not, and copying the
 * showcase's neighbour function here would make A* quietly cut corners.
 *
 * The only sound is the winner's cry, once, and only when the site-wide mute
 * is off. Nothing plays on load: this module is imported for `cryPlayer`, not
 * for an autoplay side effect.
 */

import { readThemeToken } from './shared.js';
import { cryPlayer } from './cry-player.js';
import {
  astarSolve,
  largestComponent,
  manhattanHeuristic,
} from './maze-pathfinding.js';
import {
  buildPassableGrid,
  makeNeighborFn,
  pickFarEndpoints,
} from './home-sprite-grid.js';

const GRID_SIZE = 20;
// A* is deliberately beatable: 420 ms per cell, plus a 1 s breather on
// roughly one step in five. At 230 ms a perfect 13-step run finished in 3 s
// and a first-time player never got close.
const AI_TICK_MS = 420;
const AI_PAUSE_MS = 1000;
const AI_PAUSE_CHANCE = 0.18;
const MOVE_THROTTLE_MS = 95;
const SPRITE_TIMEOUT_MS = 3000;

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

export function initMazeGame(host, roster, imageUrl, ui) {
  if (!host || !ui) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'home-game-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '迷宮遊戲畫面，使用方向鍵或 WASD 移動');
  host.appendChild(canvas);

  const fit = makeCanvasFitter(canvas, host);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const statusEl = ui.status;
  const subtitleEl = ui.subtitle;
  const startBtn = ui.startBtn;
  const againBtn = ui.againBtn;

  let tokenCache = new Map();
  const token = (name) => {
    if (!tokenCache.has(name)) tokenCache.set(name, readThemeToken(name));
    return tokenCache.get(name);
  };

  let destroyed = false;
  let prepToken = 0;
  let grid = null;
  let sprite = null;
  let picked = null;
  let start = null;
  let end = null;
  let optimalPath = null;
  let optimalSteps = 0;
  let player = null;
  let steps = 0;
  let phase = 'loading';
  let ai = 0;
  let aiTimer = 0;
  let countdownTimer = 0;
  let countdownLeft = 0;
  let lastMoveAt = 0;
  // Starts suspended: the observer clears it only once the section is on screen,
  // so arrow keys and Space cannot drive (or start) a game the reader cannot see.
  let suspended = true;

  function announce(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function draw() {
    const { ctx, w, h } = fit();
    const bg = token('--canvas-bg');
    // --canvas-wall is an RGB triplet (`63, 74, 114`), not a colour; handing
    // it to fillStyle raw is silently ignored and the walls vanish.
    const wall = `rgba(${token('--canvas-wall')}, 1)`;
    const gold = token('--accent-gold');
    const aiColor = token('--home-game-ai');
    const text = token('--canvas-text');
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
    const cell = Math.min(
      (w - gap * (grid.size + 1)) / grid.size,
      (h - gap * (grid.size + 1)) / grid.size,
    );
    const total = cell * grid.size + gap * (grid.size + 1);
    const ox = (w - total) / 2;
    const oy = (h - total) / 2;
    const spriteSize = Math.max(4, cell - 2);

    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const node = grid.rows[y][x];
        if (node.empty) continue;
        const px = ox + gap + x * (cell + gap);
        const py = oy + gap + y * (cell + gap);
        ctx.fillStyle = wall;
        ctx.fillRect(px, py, cell, cell);
        if (sprite) {
          ctx.globalAlpha = 0.9;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sprite, px + (cell - spriteSize) / 2, py + (cell - spriteSize) / 2, spriteSize, spriteSize);
          ctx.imageSmoothingEnabled = true;
          ctx.globalAlpha = 1;
        }
      }
    }

    const centre = (node) => ({
      cx: ox + gap + node.x * (cell + gap) + cell / 2,
      cy: oy + gap + node.y * (cell + gap) + cell / 2,
    });

    if (start && end) {
      const s = centre(start);
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
      const e = centre(end);
      ctx.fillStyle = aiColor;
      ctx.beginPath();
      ctx.arc(e.cx, e.cy, cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (optimalPath && optimalPath[ai]) {
      const a = centre(optimalPath[ai]);
      ctx.fillStyle = aiColor;
      ctx.beginPath();
      ctx.arc(a.cx, a.cy, cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = token('--on-accent');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (player) {
      const p = centre(player);
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = token('--on-accent');
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (phase === 'result') {
      ctx.fillStyle = text;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`你 ${steps} 步 · A* ${optimalSteps} 步`, w / 2, h - 4);
    }
  }

  function clearTimers() {
    clearTimeout(aiTimer);
    clearTimeout(countdownTimer);
    aiTimer = 0;
    countdownTimer = 0;
  }

  function endRound(playerWon) {
    if (destroyed || phase !== 'racing') return;
    phase = 'result';
    clearTimers();
    draw();
    if (playerWon) {
      announce(`你贏了！${steps} 步，A* 需要 ${optimalSteps} 步。`);
      if (!cryPlayer.muted) {
        cryPlayer.play(picked.id).catch(() => {});
      }
    } else {
      announce(`A* 先到了。牠走了 ${optimalSteps} 步，你走了 ${steps} 步。`);
    }
    if (startBtn) startBtn.hidden = true;
    if (againBtn) againBtn.hidden = false;
  }

  function aiStep() {
    if (destroyed || phase !== 'racing') return;
    if (ai < optimalPath.length - 1) {
      ai++;
      draw();
      if (ai >= optimalPath.length - 1) endRound(false);
    }
  }

  function nextAiDelay() {
    return AI_TICK_MS + (Math.random() < AI_PAUSE_CHANCE ? AI_PAUSE_MS : 0);
  }

  function scheduleAi() {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      aiTimer = 0;
      if (destroyed || phase !== 'racing') return;
      aiStep();
      if (phase === 'racing') scheduleAi();
    }, nextAiDelay());
  }

  function startRace() {
    if (destroyed || phase === 'racing' || !grid || !start || !end) return;
    clearTimers();
    suspended = false;
    lastMoveAt = 0;
    player = start;
    steps = 0;
    ai = 0;
    phase = 'countdown';
    if (startBtn) startBtn.hidden = true;
    if (againBtn) againBtn.hidden = true;
    draw();

    const begin = () => {
      if (destroyed) return;
      phase = 'racing';
      announce('移動吧！A* 也在跑。');
      scheduleAi();
      draw();
      canvas.focus();
    };

    if (motion.matches) { begin(); return; }
    countdownLeft = 3;
    announce(`準備… ${countdownLeft}`);
    const tick = () => {
      if (destroyed || phase !== 'countdown') return;
      countdownLeft--;
      if (countdownLeft > 0) {
        announce(`準備… ${countdownLeft}`);
        draw();
        countdownTimer = setTimeout(tick, 500);
      } else {
        begin();
      }
    };
    countdownTimer = setTimeout(tick, 500);
  }

  function attemptMove(dx, dy) {
    if (destroyed || phase !== 'racing' || !player) return;
    const now = performance.now();
    if (now - lastMoveAt < MOVE_THROTTLE_MS) return;
    lastMoveAt = now;
    const x = player.x + dx;
    const y = player.y + dy;
    if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return;
    const next = grid.rows[y][x];
    if (next.empty) return;
    player = next;
    steps++;
    draw();
    if (player === end) endRound(true);
  }

  async function setupRound() {
    if (destroyed) return;
    prepToken++;
    const mine = prepToken;
    clearTimers();
    phase = 'loading';
    player = null;
    start = null;
    end = null;
    optimalPath = null;
    grid = null;
    sprite = null;
    if (startBtn) { startBtn.disabled = true; startBtn.hidden = true; }
    if (againBtn) againBtn.hidden = true;
    announce('正在挑選寶可夢並生成地形…');
    if (subtitleEl) subtitleEl.textContent = '正在挑選寶可夢…';
    draw();

    const p = roster[Math.floor(Math.random() * roster.length)];
    const image = await loadSprite(imageUrl(p));
    if (destroyed || mine !== prepToken) return;
    if (!image) {
      announce('精靈圖載入失敗，正在重試…');
      setTimeout(setupRound, 800);
      return;
    }

    const g = buildPassableGrid(image, GRID_SIZE);
    if (!g.passable) {
      setTimeout(setupRound, 400);
      return;
    }
    const neighbourFn = makeNeighborFn(g, { diagonal: false });
    const component = largestComponent(
      g.size,
      (x, y) => g.rows[y][x],
      neighbourFn,
      (node) => !node.empty,
    );
    if (component.size < 2) {
      setTimeout(setupRound, 400);
      return;
    }
    const [s, e] = pickFarEndpoints(component);
    const gen = astarSolve(s, e, neighbourFn, manhattanHeuristic);
    let r = gen.next();
    while (!r.done) r = gen.next();
    const path = r.value?.path ?? [];
    if (path.length < 6) {
      setTimeout(setupRound, 400);
      return;
    }

    picked = p;
    sprite = image;
    grid = g;
    start = s;
    end = e;
    player = null;
    optimalPath = path;
    optimalSteps = path.length - 1;
    ai = 0;
    steps = 0;
    phase = 'ready';
    if (startBtn) { startBtn.disabled = false; startBtn.hidden = false; }
    if (againBtn) againBtn.hidden = true;
    announce('地形已生成，按「開始挑戰」或按空白鍵開始。');
    if (subtitleEl) subtitleEl.textContent = `${p.names?.zh ?? `#${p.id}`} · 最短路徑 ${optimalSteps} 步`;
    draw();
  }

  const keydown = (event) => {
    if (suspended) return;
    const target = event.target;
    if (target instanceof Element
      && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const k = event.key;
    const move = {
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
      ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
      ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    }[k];
    if (move) {
      event.preventDefault();
      attemptMove(move[0], move[1]);
      return;
    }
    if ((k === ' ' || k === 'Enter') && (phase === 'ready' || phase === 'result')) {
      event.preventDefault();
      if (phase === 'result' && againBtn) againBtn.click();
      else startRace();
    }
  };

  window.addEventListener('keydown', keydown);
  if (startBtn) startBtn.addEventListener('click', startRace);
  if (againBtn) againBtn.addEventListener('click', setupRound);
  if (ui.pad) {
    ui.pad.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-dir]');
      if (!btn) return;
      const [dx, dy] = btn.dataset.dir.split(',').map(Number);
      attemptMove(dx, dy);
    });
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  const onTheme = () => { tokenCache = new Map(); draw(); };
  window.addEventListener('themechange', onTheme);

  setupRound();

  function pause() {
    suspended = true;
    clearTimers();
    if (phase === 'countdown') {
      phase = 'ready';
      if (startBtn) startBtn.hidden = false;
      announce('已暫停，按「開始挑戰」重新開始。');
      draw();
    }
  }

  function resume() {
    if (!suspended) return;
    suspended = false;
    if (phase === 'racing') scheduleAi();
  }

  return {
    pause,
    resume,
    destroy() {
      destroyed = true;
      prepToken++;
      clearTimers();
      ro.disconnect();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('themechange', onTheme);
    },
  };
}
