/**
 * Pokémon Conway's Game of Life — Application Controller & Canvas Renderer
 */

import {
  initHeaderNav,
  initThemeToggle,
  loadPokemonData,
  loadEvolutionChains,
  TYPE_COLORS
} from './shared.js';

import {
  GameEngine,
  buildGenMetadata,
  PATTERNS,
  cellKey
} from './life-engine.js';

// --- Global State -------------------------------------------------------------
let allPokemon = [];
let evolutionChains = {};
let generationsData = [];
let currentMetadata = null;
let engine = null;

let isPlaying = false;
let currentSpeed = 1; // 0.5, 1, 2, 5, 10
let activeTool = 'brush'; // 'pan', 'brush', 'eraser', 'stamp'
let activeStamp = 'glider';
let activeSpeciesId = 1;
let showGrid = true;

// Camera State
const camera = {
  x: 0,
  y: 0,
  zoom: 1
};
const CELL_SIZE = 36;

// Image sprite cache: id -> HTMLImageElement
const spriteCache = new Map();
function getSprite(id) {
  if (spriteCache.has(id)) return spriteCache.get(id);
  const img = new Image();
  img.src = `assets/images/sprite/${id}.png`;
  spriteCache.set(id, img);
  return img;
}

// Visual effects for newly evolved cells: { x, y, startTime, duration }
let visualEffects = [];

// Dragging & Interaction State
let isPointerDown = false;
let pointerMoved = false;
let pointerStartX = 0;
let pointerStartY = 0;
let hoveredWorld = { x: 0, y: 0, valid: false };

// DOM Elements Cache
const els = {};

// --- Initialization -----------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();

  cacheDOMElements();
  bindEvents();

  // Load all master data in parallel
  try {
    const [pokes, evos, genRes] = await Promise.all([
      loadPokemonData(),
      loadEvolutionChains(),
      fetch('assets/data/generations.json').then(r => r.json())
    ]);

    allPokemon = pokes;
    evolutionChains = evos;
    generationsData = genRes;

    // Default to Generation 1 with Bulbasaur
    setupGeneration(1, 1, true);

    // Initial canvas sizing
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start render loop
    requestAnimationFrame(renderLoop);

    // Hide initial loading screen
    if (els.loadingOverlay) {
      els.loadingOverlay.hidden = true;
      els.loadingOverlay.style.display = 'none';
    }

    // Show initial generation setup modal on first launch if not configured
    openSetupModal();
  } catch (err) {
    console.error('Failed to initialize Pokémon Life Game:', err);
    if (els.loadingOverlay) {
      els.loadingOverlay.textContent = '載入資料失敗，請重新整理頁面。';
    }
  }
});

function cacheDOMElements() {
  els.canvas = document.getElementById('lifeCanvas');
  els.ctx = els.canvas.getContext('2d');
  els.stage = document.getElementById('lifeStage');
  els.loadingOverlay = document.getElementById('loadingOverlay');

  // Toolbar
  els.btnPlay = document.getElementById('btnPlay');
  els.btnStep = document.getElementById('btnStep');
  els.btnReseed = document.getElementById('btnReseed');
  els.btnClear = document.getElementById('btnClear');
  els.btnCenter = document.getElementById('btnCenter');
  els.btnOpenSetup = document.getElementById('btnOpenSetup');
  els.btnDexDrawer = document.getElementById('btnDexDrawer');
  els.btnHofDrawer = document.getElementById('btnHofDrawer');
  els.stampSelect = document.getElementById('stampSelect');
  els.speedSeg = document.getElementById('speedSeg');
  els.toolSeg = document.getElementById('toolSeg');
  els.chkWild = document.getElementById('chkWild');
  els.chkGrid = document.getElementById('chkGrid');
  els.genBadge = document.getElementById('genBadge');
  els.brushPreview = document.getElementById('brushPreview');
  els.brushImg = document.getElementById('brushImg');
  els.brushName = document.getElementById('brushName');

  // Stats HUD
  els.statGen = document.getElementById('statGen');
  els.statPop = document.getElementById('statPop');
  els.statFamilies = document.getElementById('statFamilies');
  els.statWild = document.getElementById('statWild');
  els.stageBar0 = document.getElementById('stageBar0');
  els.stageBar1 = document.getElementById('stageBar1');
  els.stageBar2 = document.getElementById('stageBar2');
  els.stagePct0 = document.getElementById('stagePct0');
  els.stagePct1 = document.getElementById('stagePct1');
  els.stagePct2 = document.getElementById('stagePct2');

  // Camera HUD
  els.camZoom = document.getElementById('camZoom');
  els.camCoords = document.getElementById('camCoords');
  els.btnZoomIn = document.getElementById('btnZoomIn');
  els.btnZoomOut = document.getElementById('btnZoomOut');
  els.btnZoomReset = document.getElementById('btnZoomReset');

  // Modals & Drawers
  els.setupModal = document.getElementById('setupModal');
  els.setupClose = document.getElementById('setupClose');
  els.setupTabs = document.getElementById('setupGenTabs');
  els.setupStarters = document.getElementById('setupStarters');
  els.setupSubmit = document.getElementById('setupSubmit');
  els.hofDrawer = document.getElementById('hofDrawer');
  els.hofClose = document.getElementById('hofClose');
  els.hofProgressText = document.getElementById('hofProgressText');
  els.hofProgressFill = document.getElementById('hofProgressFill');
  els.hofMedalsList = document.getElementById('hofMedalsList');
  els.dexDrawer = document.getElementById('dexDrawer');
  els.dexClose = document.getElementById('dexClose');
  els.dexSearch = document.getElementById('dexSearch');
  els.dexGrid = document.getElementById('dexGrid');
  els.celebrationToast = document.getElementById('celebrationToast');
  els.toastHeadline = document.getElementById('toastHeadline');
}

// --- Setup & Generation Locking ----------------------------------------------
function setupGeneration(gen, starterId, isRandomSeed = true) {
  currentMetadata = buildGenMetadata(gen, allPokemon, evolutionChains, generationsData);

  if (!engine) {
    engine = new GameEngine(currentMetadata);
  } else {
    engine.reset(currentMetadata);
  }

  // Set default active species to chosen starter
  activeSpeciesId = starterId || (currentMetadata.starters[0]?.id || 1);
  updateBrushPreview();

  // Update Toolbar labels
  if (els.genBadge) {
    els.genBadge.textContent = `第 ${gen} 世代 · ${currentMetadata.region} ▾`;
  }

  // Center camera
  centerCamera();

  // Populate grid based on selected layout
  if (isRandomSeed) {
    engine.seedRandom(0.20, 32, 22, 0, 0, activeSpeciesId);
  }

  updateHUD();
  updateHallOfFameDrawer();
  updateDexDrawer();

  if (els.loadingOverlay) {
    els.loadingOverlay.hidden = true;
    els.loadingOverlay.style.display = 'none';
  }
}

function updateBrushPreview() {
  const species = currentMetadata?.speciesById.get(activeSpeciesId) || allPokemon[0];
  if (!species) return;

  if (els.brushImg) {
    els.brushImg.src = `assets/images/sprite/${species.id}.png`;
    els.brushImg.alt = species.names.zh;
  }
  if (els.brushName) {
    els.brushName.textContent = `#${String(species.id).padStart(4, '0')} ${species.names.zh}`;
  }
}

function centerCamera() {
  camera.x = els.canvas.width / 2;
  camera.y = els.canvas.height / 2;
  camera.zoom = 1.0;
  updateCamHUD();
}

function resizeCanvas() {
  const rect = els.stage.getBoundingClientRect();
  els.canvas.width = rect.width;
  els.canvas.height = rect.height;
  if (camera.x === 0 && camera.y === 0) {
    centerCamera();
  }
}

// --- Coordinate Systems -------------------------------------------------------
function screenToWorld(sx, sy) {
  const effectiveSize = CELL_SIZE * camera.zoom;
  return {
    x: Math.floor((sx - camera.x) / effectiveSize),
    y: Math.floor((sy - camera.y) / effectiveSize)
  };
}

function worldToScreen(wx, wy) {
  const effectiveSize = CELL_SIZE * camera.zoom;
  return {
    x: wx * effectiveSize + camera.x,
    y: wy * effectiveSize + camera.y
  };
}

// --- Simulation Loop ----------------------------------------------------------
let lastTickTime = performance.now();

function getTickInterval() {
  switch (currentSpeed) {
    case 0.5: return 800;
    case 1: return 400;
    case 2: return 200;
    case 5: return 80;
    case 10: return 40;
    default: return 400;
  }
}

function stepSimulation() {
  if (!engine) return;
  const stats = engine.tick();

  // Trigger visual effects for evolutions
  if (stats.evolutionEvents && stats.evolutionEvents.length > 0) {
    const now = performance.now();
    for (const ev of stats.evolutionEvents) {
      visualEffects.push({
        x: ev.x,
        y: ev.y,
        startTime: now,
        duration: 800
      });
    }
  }

  // Trigger celebration toast if medal unlocked
  if (stats.newlyUnlockedMedal) {
    showCelebrationToast(stats.newlyUnlockedMedal);
    updateHallOfFameDrawer();
  }

  updateHUD(stats);
  updateDexDrawerUnlocked();
}

function renderLoop(timestamp) {
  // Simulation step
  if (isPlaying) {
    const interval = getTickInterval();
    if (timestamp - lastTickTime >= interval) {
      stepSimulation();
      lastTickTime = timestamp;
    }
  }

  // Continuous render
  renderCanvas(timestamp);
  requestAnimationFrame(renderLoop);
}

// --- Canvas Renderer ----------------------------------------------------------
function renderCanvas(timestamp) {
  const ctx = els.ctx;
  const width = els.canvas.width;
  const height = els.canvas.height;
  const effCell = CELL_SIZE * camera.zoom;

  ctx.clearRect(0, 0, width, height);

  // 1. Grid Lines
  if (showGrid && camera.zoom >= 0.4) {
    ctx.save();
    const startX = ((camera.x % effCell) + effCell) % effCell;
    const startY = ((camera.y % effCell) + effCell) % effCell;
    const alpha = Math.min(0.2, (camera.zoom - 0.35) * 0.3);

    ctx.strokeStyle = document.documentElement.dataset.theme === 'light'
      ? `rgba(0, 0, 0, ${alpha * 0.6})`
      : `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = startX; x <= width; x += effCell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = startY; y <= height; y += effCell) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 2. Viewport Culling Bounds
  const minWorldX = Math.floor(-camera.x / effCell) - 1;
  const maxWorldX = Math.ceil((width - camera.x) / effCell) + 1;
  const minWorldY = Math.floor(-camera.y / effCell) - 1;
  const maxWorldY = Math.ceil((height - camera.y) / effCell) + 1;

  // 3. Render Alive Cells
  const isHighLOD = camera.zoom >= 0.55;

  for (const cell of engine.cells.values()) {
    if (cell.x < minWorldX || cell.x > maxWorldX || cell.y < minWorldY || cell.y > maxWorldY) {
      continue;
    }

    const scr = worldToScreen(cell.x, cell.y);
    const sp = currentMetadata.speciesById.get(cell.speciesId);
    const typeColor = (sp && sp.types && TYPE_COLORS[sp.types[0]]) || '#78c850';

    if (isHighLOD) {
      // Cell background glow based on evolution stage
      if (cell.stage === 2) {
        ctx.fillStyle = 'rgba(155, 89, 182, 0.22)';
        ctx.fillRect(scr.x, scr.y, effCell, effCell);
        ctx.strokeStyle = '#9b59b6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(scr.x + 0.5, scr.y + 0.5, effCell - 1, effCell - 1);
      } else if (cell.stage === 1) {
        ctx.fillStyle = 'rgba(230, 126, 34, 0.18)';
        ctx.fillRect(scr.x, scr.y, effCell, effCell);
      }

      // Veteran single-stage aura (golden corners / glow)
      if (cell.isVeteran && cell.age >= 5) {
        ctx.save();
        ctx.strokeStyle = '#f5c542';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#f5c542';
        ctx.shadowBlur = 8;
        ctx.strokeRect(scr.x + 2, scr.y + 2, effCell - 4, effCell - 4);
        ctx.restore();
      }

      // Draw Pokémon Sprite
      const sprite = getSprite(cell.speciesId);
      if (sprite.complete && sprite.naturalWidth > 0) {
        const pad = Math.max(2, effCell * 0.05);
        ctx.drawImage(sprite, scr.x + pad, scr.y + pad, effCell - pad * 2, effCell - pad * 2);
      } else {
        // Fallback tile
        ctx.fillStyle = typeColor;
        ctx.fillRect(scr.x + 2, scr.y + 2, effCell - 4, effCell - 4);
      }
    } else {
      // Low LOD: Type-colored cell with core
      ctx.fillStyle = typeColor;
      ctx.beginPath();
      const r = Math.max(1, effCell * 0.12);
      ctx.roundRect(scr.x + 1, scr.y + 1, effCell - 2, effCell - 2, r);
      ctx.fill();

      // Stage dot indicator
      if (cell.stage > 0) {
        ctx.fillStyle = cell.stage === 2 ? '#ffffff' : '#f5c542';
        ctx.beginPath();
        ctx.arc(scr.x + effCell / 2, scr.y + effCell / 2, Math.max(1.5, effCell * 0.15), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 4. Render Evolution Shockwaves / Particle Rings
  if (visualEffects.length > 0) {
    ctx.save();
    visualEffects = visualEffects.filter(fx => {
      const elapsed = timestamp - fx.startTime;
      if (elapsed > fx.duration) return false;

      const progress = elapsed / fx.duration;
      const scr = worldToScreen(fx.x, fx.y);
      const cx = scr.x + effCell / 2;
      const cy = scr.y + effCell / 2;
      const radius = (effCell * 0.5) + (effCell * 1.2 * progress);
      const alpha = 1 - progress;

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 3 * (1 - progress);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Outer gold starburst ring
      ctx.strokeStyle = `rgba(245, 197, 66, ${alpha * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
      ctx.stroke();

      return true;
    });
    ctx.restore();
  }

  // 5. Tool Cursor Hover Previews
  if (hoveredWorld.valid) {
    const scr = worldToScreen(hoveredWorld.x, hoveredWorld.y);

    if (activeTool === 'brush') {
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 197, 66, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(scr.x, scr.y, effCell, effCell);

      const previewSprite = getSprite(activeSpeciesId);
      if (previewSprite.complete) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(previewSprite, scr.x + 2, scr.y + 2, effCell - 4, effCell - 4);
      }
      ctx.restore();
    } else if (activeTool === 'eraser') {
      ctx.save();
      ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(231, 76, 60, 0.2)';
      ctx.fillRect(scr.x, scr.y, effCell, effCell);
      ctx.strokeRect(scr.x, scr.y, effCell, effCell);
      ctx.restore();
    } else if (activeTool === 'stamp') {
      const pattern = PATTERNS[activeStamp];
      if (pattern) {
        ctx.save();
        ctx.strokeStyle = 'rgba(46, 204, 113, 0.7)';
        ctx.lineWidth = 1.5;
        const stampSprite = getSprite(activeSpeciesId);

        for (const pt of pattern.coords) {
          const ptScr = worldToScreen(hoveredWorld.x + pt.x, hoveredWorld.y + pt.y);
          ctx.strokeRect(ptScr.x, ptScr.y, effCell, effCell);
          if (stampSprite.complete) {
            ctx.globalAlpha = 0.4;
            ctx.drawImage(stampSprite, ptScr.x + 2, ptScr.y + 2, effCell - 4, effCell - 4);
          }
        }
        ctx.restore();
      }
    }
  }
}

// --- HUD & Stats Updating -----------------------------------------------------
function updateHUD(stats = null) {
  if (!engine) return;

  const gen = stats ? stats.generation : engine.generation;
  const pop = stats ? stats.population : engine.cells.size;
  const fams = stats ? stats.unlockedFamiliesCount : engine.unlockedFamilies.size;
  const wild = engine.wildEncounterCount;

  if (els.statGen) els.statGen.textContent = gen;
  if (els.statPop) els.statPop.textContent = pop;
  if (els.statFamilies) els.statFamilies.textContent = fams;
  if (els.statWild) els.statWild.textContent = wild;

  // Stages bar
  let s0 = 0, s1 = 0, s2 = 0;
  if (stats) {
    s0 = stats.stage0Count;
    s1 = stats.stage1Count;
    s2 = stats.stage2Count;
  } else {
    for (const c of engine.cells.values()) {
      if (c.stage === 0) s0++;
      else if (c.stage === 1) s1++;
      else if (c.stage === 2) s2++;
    }
  }

  const total = pop || 1;
  const p0 = Math.round((s0 / total) * 100);
  const p1 = Math.round((s1 / total) * 100);
  const p2 = Math.round((s2 / total) * 100);

  if (els.stageBar0) els.stageBar0.style.width = `${p0}%`;
  if (els.stageBar1) els.stageBar1.style.width = `${p1}%`;
  if (els.stageBar2) els.stageBar2.style.width = `${p2}%`;
  if (els.stagePct0) els.stagePct0.textContent = `${p0}%`;
  if (els.stagePct1) els.stagePct1.textContent = `${p1}%`;
  if (els.stagePct2) els.stagePct2.textContent = `${p2}%`;

  // Update Drawer button badges
  if (els.btnDexDrawer) {
    els.btnDexDrawer.textContent = `圖鑑 (${engine.unlockedSpecies.size}/${currentMetadata.totalSpeciesCount})`;
  }
  if (els.btnHofDrawer) {
    els.btnHofDrawer.textContent = `名人堂 (${engine.unlockedMedals.length}/${currentMetadata.legendaries.length})`;
  }
}

function updateCamHUD() {
  if (els.camZoom) {
    els.camZoom.textContent = `${Math.round(camera.zoom * 100)}%`;
  }
  if (els.camCoords) {
    const centerWorld = screenToWorld(els.canvas.width / 2, els.canvas.height / 2);
    els.camCoords.textContent = `(${centerWorld.x}, ${centerWorld.y})`;
  }
}

// --- Hall of Fame Drawer -----------------------------------------------------
function updateHallOfFameDrawer() {
  if (!currentMetadata || !els.hofMedalsList) return;

  const unlockedCount = engine ? engine.unlockedFamilies.size : 0;
  const totalLegs = currentMetadata.legendaries.length;
  const medalsEarned = engine ? engine.unlockedMedals.length : 0;

  // Next medal target progress
  const nextTarget = (medalsEarned + 1) * 6;
  const currentStep = unlockedCount % 6;
  const pct = Math.min(100, Math.round((currentStep / 6) * 100));

  if (els.hofProgressText) {
    if (medalsEarned >= totalLegs) {
      els.hofProgressText.textContent = `全神獸獎章已解鎖！(${unlockedCount} 家族)`;
      if (els.hofProgressFill) els.hofProgressFill.style.width = '100%';
    } else {
      els.hofProgressText.textContent = `下一面獎章進度: ${currentStep}/6 (累計 ${unlockedCount} 家族)`;
      if (els.hofProgressFill) els.hofProgressFill.style.width = `${pct}%`;
    }
  }

  els.hofMedalsList.innerHTML = '';

  currentMetadata.legendaries.forEach((leg, index) => {
    const isUnlocked = index < medalsEarned;
    const requiredFamilies = (index + 1) * 6;

    const card = document.createElement('div');
    card.className = `life-medal-card ${isUnlocked ? 'is-unlocked' : 'is-locked'}`;

    card.innerHTML = `
      <div class="life-medal-icon-wrap">
        <img src="assets/images/pokemon/${leg.id}.png" alt="${leg.names.zh}">
        ${!isUnlocked ? '<div class="life-medal-lock-badge">🔒</div>' : ''}
      </div>
      <div class="life-medal-info">
        <div class="life-medal-name">#${String(leg.id).padStart(4, '0')} ${leg.names.zh}</div>
        <div class="life-medal-tag">${leg.types_zh ? leg.types_zh.join(' / ') : ''} · ${leg.genus || ''}</div>
      </div>
      <div class="life-medal-status ${isUnlocked ? 'unlocked' : 'locked'}">
        ${isUnlocked ? '已獲得 🏆' : `${requiredFamilies} 家族解鎖`}
      </div>
    `;

    els.hofMedalsList.appendChild(card);
  });
}

function showCelebrationToast(medal) {
  if (!els.celebrationToast) return;
  if (els.toastHeadline) {
    els.toastHeadline.textContent = `解鎖成就獎章！#${String(medal.id).padStart(4, '0')} ${medal.names.zh}`;
  }
  els.celebrationToast.classList.add('is-visible');
  setTimeout(() => {
    els.celebrationToast.classList.remove('is-visible');
  }, 4000);
}

// --- Pokédex Drawer -----------------------------------------------------------
function updateDexDrawer() {
  if (!currentMetadata || !els.dexGrid) return;

  const filterText = els.dexSearch ? els.dexSearch.value.trim().toLowerCase() : '';
  els.dexGrid.innerHTML = '';

  const speciesList = currentMetadata.allGenSpecies;

  for (const sp of speciesList) {
    const isUnlocked = engine ? engine.unlockedSpecies.has(sp.id) : false;
    const zh = sp.names.zh;
    const idStr = String(sp.id).padStart(4, '0');

    if (filterText && !zh.toLowerCase().includes(filterText) && !idStr.includes(filterText)) {
      continue;
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = `life-dex-item ${isUnlocked ? 'is-unlocked' : 'is-locked'} ${sp.id === activeSpeciesId ? 'is-selected' : ''}`;
    item.title = `${zh} (#${idStr})`;

    item.innerHTML = `
      <img src="assets/images/sprite/${sp.id}.png" alt="${zh}">
      <div class="life-dex-num">#${idStr}</div>
      <div class="life-dex-name">${isUnlocked ? zh : '???'}</div>
    `;

    item.addEventListener('click', () => {
      activeSpeciesId = sp.id;
      updateBrushPreview();
      updateDexDrawerSelection();
      closeDrawers();
    });

    els.dexGrid.appendChild(item);
  }
}

function updateDexDrawerUnlocked() {
  if (!els.dexGrid || !currentMetadata) return;
  const items = els.dexGrid.querySelectorAll('.life-dex-item');
  items.forEach(el => {
    const num = el.querySelector('.life-dex-num')?.textContent.replace('#', '');
    const id = Number(num);
    if (id && engine.unlockedSpecies.has(id)) {
      el.classList.remove('is-locked');
      el.classList.add('is-unlocked');
      const sp = currentMetadata.speciesById.get(id);
      if (sp) {
        const nameEl = el.querySelector('.life-dex-name');
        if (nameEl) nameEl.textContent = sp.names.zh;
      }
    }
  });
}

function updateDexDrawerSelection() {
  if (!els.dexGrid) return;
  const items = els.dexGrid.querySelectorAll('.life-dex-item');
  items.forEach(el => {
    const num = el.querySelector('.life-dex-num')?.textContent.replace('#', '');
    el.classList.toggle('is-selected', Number(num) === activeSpeciesId);
  });
}

function closeDrawers() {
  if (els.hofDrawer) els.hofDrawer.classList.remove('is-open');
  if (els.dexDrawer) els.dexDrawer.classList.remove('is-open');
}

// --- Setup Modal --------------------------------------------------------------
let modalSelectedGen = 1;
let modalSelectedStarterId = 1;

function openSetupModal() {
  if (!els.setupModal) return;
  modalSelectedGen = currentMetadata ? currentMetadata.gen : 1;
  renderSetupGenTabs();
  renderSetupStarters(modalSelectedGen);
  els.setupModal.hidden = false;
}

function closeSetupModal() {
  if (els.setupModal) els.setupModal.hidden = true;
  if (els.loadingOverlay) {
    els.loadingOverlay.hidden = true;
    els.loadingOverlay.style.display = 'none';
  }
}

function renderSetupGenTabs() {
  if (!els.setupTabs) return;
  els.setupTabs.innerHTML = '';

  for (let g = 1; g <= 9; g++) {
    const genDef = generationsData.find(x => x.gen === g);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `life-gen-tab-btn ${g === modalSelectedGen ? 'is-selected' : ''}`;
    btn.innerHTML = `
      <span class="life-gen-tab-title">第 ${g} 世代</span>
      <span class="life-gen-tab-region">${genDef ? genDef.region : ''}</span>
    `;

    btn.addEventListener('click', () => {
      modalSelectedGen = g;
      renderSetupGenTabs();
      renderSetupStarters(g);
    });

    els.setupTabs.appendChild(btn);
  }
}

function renderSetupStarters(gen) {
  if (!els.setupStarters) return;
  els.setupStarters.innerHTML = '';

  const genDef = generationsData.find(x => x.gen === gen);
  const starterIds = genDef ? genDef.starters : [];
  const starters = starterIds.map(id => allPokemon.find(p => p.id === id)).filter(Boolean);

  if (starters.length > 0 && !starters.some(s => s.id === modalSelectedStarterId)) {
    modalSelectedStarterId = starters[0].id;
  }

  starters.forEach(starter => {
    const card = document.createElement('div');
    card.className = `life-starter-card ${starter.id === modalSelectedStarterId ? 'is-selected' : ''}`;
    const primaryType = starter.types ? starter.types[0] : 'Normal';
    const typeColor = TYPE_COLORS[primaryType] || '#78c850';

    card.innerHTML = `
      <img class="life-starter-img" src="assets/images/pokemon/${starter.id}.png" alt="${starter.names.zh}">
      <div class="life-starter-name">${starter.names.zh}</div>
      <div class="life-starter-type" style="background:${typeColor}">${starter.types_zh ? starter.types_zh[0] : ''}</div>
    `;

    card.addEventListener('click', () => {
      modalSelectedStarterId = starter.id;
      renderSetupStarters(gen);
    });

    els.setupStarters.appendChild(card);
  });
}

// --- Event Handlers & Binding -------------------------------------------------
function bindEvents() {
  // Play / Pause
  els.btnPlay?.addEventListener('click', () => {
    isPlaying = !isPlaying;
    els.btnPlay.classList.toggle('is-playing', isPlaying);
    els.btnPlay.textContent = isPlaying ? '⏸ 暫停' : '▶ 播放';
  });

  // Step
  els.btnStep?.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      els.btnPlay.classList.remove('is-playing');
      els.btnPlay.textContent = '▶ 播放';
    }
    stepSimulation();
  });

  // Reseed / Randomize
  els.btnReseed?.addEventListener('click', () => {
    if (!engine) return;
    engine.seedRandom(0.20, 32, 22, 0, 0, activeSpeciesId);
    updateHUD();
  });

  // Clear
  els.btnClear?.addEventListener('click', () => {
    if (!engine) return;
    engine.clear();
    updateHUD();
  });

  // Center
  els.btnCenter?.addEventListener('click', () => {
    centerCamera();
  });

  // Speed segmented buttons
  els.speedSeg?.querySelectorAll('.life-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.speedSeg.querySelectorAll('.life-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentSpeed = Number(btn.dataset.speed || 1);
    });
  });

  // Tool segmented buttons
  els.toolSeg?.querySelectorAll('.life-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.toolSeg.querySelectorAll('.life-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeTool = btn.dataset.tool || 'brush';
      els.stage.className = `life-stage cursor-${activeTool}`;
      if (els.stampSelect) {
        els.stampSelect.hidden = activeTool !== 'stamp';
      }
    });
  });

  // Stamp selector
  els.stampSelect?.addEventListener('change', e => {
    activeStamp = e.target.value;
  });

  // Toggles
  els.chkWild?.addEventListener('change', e => {
    if (engine) engine.isWildEnabled = e.target.checked;
  });

  els.chkGrid?.addEventListener('change', e => {
    showGrid = e.target.checked;
  });

  // Generation Modal triggers
  els.btnOpenSetup?.addEventListener('click', openSetupModal);
  els.genBadge?.addEventListener('click', openSetupModal);
  els.setupClose?.addEventListener('click', closeSetupModal);
  els.setupSubmit?.addEventListener('click', () => {
    const seedModeInput = document.querySelector('input[name="setupSeedMode"]:checked');
    const isRandom = seedModeInput ? seedModeInput.value === 'random' : true;
    setupGeneration(modalSelectedGen, modalSelectedStarterId, isRandom);
    closeSetupModal();
  });

  // Drawers triggers
  els.btnHofDrawer?.addEventListener('click', () => {
    closeDrawers();
    els.hofDrawer?.classList.add('is-open');
  });
  els.hofClose?.addEventListener('click', () => {
    els.hofDrawer?.classList.remove('is-open');
  });

  els.btnDexDrawer?.addEventListener('click', () => {
    closeDrawers();
    updateDexDrawer();
    els.dexDrawer?.classList.add('is-open');
  });
  els.dexClose?.addEventListener('click', () => {
    els.dexDrawer?.classList.remove('is-open');
  });

  els.brushPreview?.addEventListener('click', () => {
    closeDrawers();
    updateDexDrawer();
    els.dexDrawer?.classList.add('is-open');
  });

  els.dexSearch?.addEventListener('input', () => {
    updateDexDrawer();
  });

  // Zoom buttons
  els.btnZoomIn?.addEventListener('click', () => {
    zoomAtPoint(els.canvas.width / 2, els.canvas.height / 2, 1.25);
  });
  els.btnZoomOut?.addEventListener('click', () => {
    zoomAtPoint(els.canvas.width / 2, els.canvas.height / 2, 0.8);
  });
  els.btnZoomReset?.addEventListener('click', centerCamera);

  // Canvas Mouse & Wheel interactions
  const canvas = els.canvas;

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    zoomAtPoint(e.offsetX, e.offsetY, factor);
  }, { passive: false });

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return; // Left click only
    isPointerDown = true;
    pointerMoved = false;
    pointerStartX = e.offsetX;
    pointerStartY = e.offsetY;

    if (activeTool === 'brush') {
      const w = screenToWorld(e.offsetX, e.offsetY);
      engine.setCell(w.x, w.y, activeSpeciesId);
      updateHUD();
    } else if (activeTool === 'eraser') {
      const w = screenToWorld(e.offsetX, e.offsetY);
      engine.deleteCell(w.x, w.y);
      updateHUD();
    } else if (activeTool === 'stamp') {
      const w = screenToWorld(e.offsetX, e.offsetY);
      engine.applyPattern(activeStamp, w.x, w.y, activeSpeciesId);
      updateHUD();
    }
  });

  window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height) {
      hoveredWorld = { ...screenToWorld(sx, sy), valid: true };
    } else {
      hoveredWorld.valid = false;
    }

    if (!isPointerDown) return;

    const dx = e.movementX;
    const dy = e.movementY;

    if (Math.abs(sx - pointerStartX) > 4 || Math.abs(sy - pointerStartY) > 4) {
      pointerMoved = true;
    }

    if (activeTool === 'pan') {
      camera.x += dx;
      camera.y += dy;
      updateCamHUD();
    } else if (activeTool === 'brush') {
      const w = screenToWorld(sx, sy);
      engine.setCell(w.x, w.y, activeSpeciesId);
      updateHUD();
    } else if (activeTool === 'eraser') {
      const w = screenToWorld(sx, sy);
      engine.deleteCell(w.x, w.y);
      updateHUD();
    }
  });

  window.addEventListener('mouseup', () => {
    isPointerDown = false;
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredWorld.valid = false;
  });

  // Touch Support
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const sx = touch.clientX - rect.left;
      const sy = touch.clientY - rect.top;
      isPointerDown = true;
      pointerStartX = sx;
      pointerStartY = sy;
      if (activeTool === 'brush') {
        const w = screenToWorld(sx, sy);
        engine.setCell(w.x, w.y, activeSpeciesId);
        updateHUD();
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (!isPointerDown || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const sx = touch.clientX - rect.left;
    const sy = touch.clientY - rect.top;

    if (activeTool === 'pan') {
      camera.x += sx - pointerStartX;
      camera.y += sy - pointerStartY;
      pointerStartX = sx;
      pointerStartY = sy;
      updateCamHUD();
    } else if (activeTool === 'brush') {
      const w = screenToWorld(sx, sy);
      engine.setCell(w.x, w.y, activeSpeciesId);
      updateHUD();
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    isPointerDown = false;
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', e => {
    // Don't trigger if inside input
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      els.btnPlay?.click();
    } else if (e.code === 'KeyN' || e.code === 'ArrowRight') {
      e.preventDefault();
      els.btnStep?.click();
    } else if (e.code === 'KeyH') {
      switchTool('pan');
    } else if (e.code === 'KeyB') {
      switchTool('brush');
    } else if (e.code === 'KeyE') {
      switchTool('eraser');
    } else if (e.code === 'KeyS') {
      switchTool('stamp');
    } else if (e.code === 'KeyC') {
      els.btnClear?.click();
    } else if (e.code === 'KeyR') {
      els.btnReseed?.click();
    } else if (e.code === 'Digit0') {
      centerCamera();
    } else if (e.code === 'Escape') {
      closeSetupModal();
      closeDrawers();
    }
  });
}

function switchTool(tool) {
  const btn = els.toolSeg?.querySelector(`[data-tool="${tool}"]`);
  if (btn) btn.click();
}

function zoomAtPoint(sx, sy, factor) {
  const newZoom = Math.min(3.5, Math.max(0.15, camera.zoom * factor));
  if (newZoom === camera.zoom) return;

  // Keep world point under cursor fixed:
  // sx = worldX * cellSize * zoom + camera.x
  const worldX = (sx - camera.x) / (CELL_SIZE * camera.zoom);
  const worldY = (sy - camera.y) / (CELL_SIZE * camera.zoom);

  camera.zoom = newZoom;
  camera.x = sx - worldX * (CELL_SIZE * camera.zoom);
  camera.y = sy - worldY * (CELL_SIZE * camera.zoom);

  updateCamHUD();
}
