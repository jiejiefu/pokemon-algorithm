/**
 * Pokémon Conway's Game of Life — Application Controller & Canvas Renderer
 */

import {
  initHeaderNav,
  initThemeToggle,
  loadPokemonData,
  loadEvolutionChains,
  TYPE_COLORS,
  TYPE_EN_ZH,
  hexToRgb
} from './shared.js';

import {
  GameEngine,
  buildGenMetadata,
  FALLBACK_EVOLUTION_LEVEL,
  PATTERNS,
  cellKey
} from './life-engine.js';

/* Which types exist in this generation, in chart order. The drawer prints them
 * all — including the ones at 0% — so the list it walks is this one rather than
 * whatever the board happens to hold today. */
import { typesForGeneration } from './type-era.js';
/* The era note lists the types a generation is MISSING by walking the full chart
 * and subtracting the ones it has, so it needs the unfiltered order too. It is
 * imported rather than reconstructed because a hardcoded 18-name array is the
 * second source of truth §3.I is about — and the first version of this line
 * omitted the import entirely, threw a ReferenceError halfway down
 * updateTypeDrawer(), and left the list half-built with the note blank. */
import { TYPE_CHART_ORDER } from './type-chart.js';

/* The encounter cry player. `play()` takes the SPECIES ID and builds the URL
 * itself from `cryUrl()`, so this file never spells an `assets/cries/` path — the
 * same reason detail.html imports only the player. `latest/` covers all 1,025
 * species, so there is no roster gate to write here either. */
import { cryPlayer } from './cry-player.js';

// --- Global State -------------------------------------------------------------
let allPokemon = [];
let evolutionChains = {};
let generationsData = [];
let evolutionLevels = null;
let currentMetadata = null;
let engine = null;

let isPlaying = false;
let currentSpeed = 1; // 0.5, 1, 2, 5, 10
let activeTool = 'brush'; // 'pan', 'brush', 'eraser', 'stamp'
let activeStamp = 'glider';
let activeSpeciesId = 1;
let showGrid = true;
let showTerritory = true;

/**
 * Alpha of the type wash, per theme.
 *
 * TWO VALUES BECAUSE THE GROUNDS HAVE OPPOSITE ENDS, and the wash composites
 * over a CSS `radial-gradient` (life.css:229 / :234) rather than over a flat
 * colour: dark runs #111832 -> #0b1020, light runs #ffffff -> #e9edf7. A near-white
 * ground has no headroom to spare and a near-black one has plenty, so one value
 * cannot serve both — the number that reads on #0b1020 is close to invisible on
 * #ffffff.
 *
 * MEASURED off the live canvas, not chosen. check_life_browser.mjs brushes a
 * cell, steps the simulation once so Conway kills the isolated cell, and reads
 * back the alpha the wash actually painted: **41/255 in the dark theme and
 * 77/255 in the light one**, which is 0.16 and 0.30 as written. It asserts light
 * > dark and both > a visible floor, so collapsing this to one value — the tidy
 * that looks like a simplification — fails.
 *
 * WHAT IS NOT MEASURED, named rather than implied: what the wash composites to
 * once the gradient is under it. That needs a screenshot and a PNG decode, this
 * file has neither, and an offline decoder would be §3.Q's lesson about a
 * measurement taken with a different implementation than the one under test. So
 * the numbers above are what the renderer WRITES, and whether they read well
 * against both ends of each gradient is a look at the page — which is why the
 * toggle is there.
 *
 * DECORATIVE. 3:1 is SC 1.4.11's figure for a graphical object whose meaning is
 * carried by shape, and nothing here has to be read to play — the colour records
 * what used to live in a cell and no control depends on recovering it. The
 * toggle's title is the one place a reader is told what the colour means,
 * because 18 type colours have no legend anywhere on this page.
 */
const TERRITORY_ALPHA = { light: 0.30, dark: 0.16 };

/**
 * `#78C850` + 0.16 -> `rgba(120, 200, 80, 0.16)`.
 *
 * Built on shared.js's `hexToRgb` rather than parsing the hex here: colour
 * parsing is that module's job, and a second copy is §3.B1's rule waiting to be
 * broken. Unparseable input falls back to the same `#78c850` the cell renderer
 * already uses, so a type outside TYPE_COLORS cannot paint nothing — and
 * `check_life_page.mjs` asserts no record ever needs that fallback.
 */
const withAlpha = (hex, alpha) => {
  const rgb = hexToRgb(hex) || [120, 200, 80];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
};

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
    const [pokes, evos, genRes, levelRes] = await Promise.all([
      loadPokemonData(),
      loadEvolutionChains(),
      fetch('assets/data/generations.json').then(r => r.json()),
      fetch('assets/data/evolution_levels.json').then(r => r.json())
    ]);

    allPokemon = pokes;
    evolutionChains = evos;
    generationsData = genRes;
    // Without this table every evolution falls back to the corpus median, so a
    // failed fetch would silently flatten all 489 distinct thresholds to one.
    evolutionLevels = levelRes;

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
  els.btnDexCount = document.getElementById('btnDexCount');
  els.btnHofCount = document.getElementById('btnHofCount');
  els.btnTypeCount = document.getElementById('btnTypeCount');
  els.btnHofDrawer = document.getElementById('btnHofDrawer');
  els.btnTypeDrawer = document.getElementById('btnTypeDrawer');
  els.stampSelect = document.getElementById('stampSelect');
  els.speedSeg = document.getElementById('speedSeg');
  els.toolSeg = document.getElementById('toolSeg');
  els.chkWild = document.getElementById('chkWild');
  els.chkGrid = document.getElementById('chkGrid');
  els.chkTerritory = document.getElementById('chkTerritory');
  els.chkEncounterCry = document.getElementById('chkEncounterCry');
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
  els.stageLevel1 = document.getElementById('stageLevel1');
  els.stageLevel2 = document.getElementById('stageLevel2');

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
  els.stepStarter = document.getElementById('stepStarter');
  els.setupSubmit = document.getElementById('setupSubmit');
  els.hofDrawer = document.getElementById('hofDrawer');
  els.hofClose = document.getElementById('hofClose');
  els.hofProgressText = document.getElementById('hofProgressText');
  els.hofProgressFill = document.getElementById('hofProgressFill');
  els.hofMedalsList = document.getElementById('hofMedalsList');
  els.dexDrawer = document.getElementById('dexDrawer');
  els.typeDrawer = document.getElementById('typeDrawer');
  els.typeClose = document.getElementById('typeClose');
  els.typeSummary = document.getElementById('typeSummary');
  els.typeBar = document.getElementById('typeBar');
  els.typeList = document.getElementById('typeList');
  els.typeEraNote = document.getElementById('typeEraNote');
  els.dexClose = document.getElementById('dexClose');
  els.dexSearch = document.getElementById('dexSearch');
  els.dexGrid = document.getElementById('dexGrid');
  els.celebrationToast = document.getElementById('celebrationToast');
  els.toastHeadline = document.getElementById('toastHeadline');
  els.toastIcon = document.querySelector('#celebrationToast .life-toast-icon');
  els.toastEyebrow = document.querySelector('#celebrationToast .life-toast-eyebrow');
}

// --- Setup & Generation Locking ----------------------------------------------
function setupGeneration(gen, starterId, isRandomSeed = true, mode = '') {
  // The starter is read here, not inside buildGenMetadata: whether the Pokédex
  // carries the 伊布家族 section is the reader's choice, and the reader's choice
  // is this value. Passing it in is also why the counter's denominator and the
  // drawer's row count stay the same number under either answer.
  currentMetadata = buildGenMetadata(gen, allPokemon, evolutionChains, generationsData, { starterId });

  if (!engine) {
    engine = new GameEngine(currentMetadata, evolutionLevels, mode);
  } else {
    engine.reset(currentMetadata);
    engine.setEvolutionLevels(evolutionLevels);
    engine.setMode(mode);
  }

  // Set default active species to chosen starter
  activeSpeciesId = starterId || (currentMetadata.starters[0]?.id || 1);
  updateBrushPreview();

  // Update Toolbar labels
  if (els.genBadge) {
    els.genBadge.textContent = `第 ${gen} 世代 · ${currentMetadata.region} ▾`;
  }

  // The legend's own sentence, written once from the constant the engine uses so
  // the number in the tooltip cannot drift from the number in the gate.
  const legendNote =
    `以該物種的真實進化等級為準（Lv.7–Lv.64）；` +
    `遊戲中沒有等級條件的進化使用全站中位數 Lv.${FALLBACK_EVOLUTION_LEVEL}。` +
    `括號內為當前盤面最常見的實際進化等級。`;
  if (els.stageLevel1 && els.stageLevel1.parentElement) els.stageLevel1.parentElement.title = legendNote;
  if (els.stageLevel2 && els.stageLevel2.parentElement) els.stageLevel2.parentElement.title = legendNote;

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

  // A wild pack landed. Announced BEFORE the medal so that an encounter never
  // gets silently overwritten by a medal earned from the family it discovered —
  // the encounter is the more specific news of the two.
  if (stats.wildSpawnEvent) {
    showWildEncounter(stats.wildSpawnEvent);
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

  // 3. Type Wash — what last lived in each now-empty cell.
  //
  // DRAWN UNDER THE SPRITES AND NOT UNDERNEATH THEM.
  //
  // The wash is painted before the cells, so z-order alone looks like it is
  // doing the job — and it is not. A sprite is an RGBA PNG and 45.7% of its
  // pixels are transparent (measured on 1.png, 475x475), so a Grass wash under a
  // Bulbasaur reads through the gap around its body. Cells that are currently
  // OCCUPIED are skipped outright instead; that skip is the whole requirement.
  //
  // BATCHED BY TYPE, which is a performance requirement rather than tidiness.
  // CELL_SIZE is 36 and the smallest zoom is 0.2, so `effCell` can be 7.2px and a
  // 1440x900 viewport then holds ~25,000 cells. One `fillRect` per cell is
  // 25,000 draw calls a frame at 60fps; grouping the same type into one path
  // makes it 18 fills, one per type that is actually on screen.
  if (showTerritory && engine.territory.size > 0) {
    const alpha = TERRITORY_ALPHA[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];

    // type -> path. Built fresh each frame because the camera moves between
    // frames; a retained set would have to be invalidated on every pan anyway.
    const byType = new Map();
    for (const [key, type] of engine.territory) {
      // Occupied cells are excluded, and `cells` is the only thing that knows
      // that. It is also the cheaper test to ask first: the wash outlives the
      // population, so most entries here ARE occupied and the Map lookup is
      // doing the work.
      if (engine.cells.has(key)) continue;

      const comma = key.indexOf(',');
      const x = Number(key.slice(0, comma));
      const y = Number(key.slice(comma + 1));
      if (x < minWorldX || x > maxWorldX || y < minWorldY || y > maxWorldY) continue;

      let path = byType.get(type);
      if (!path) byType.set(type, path = new Path2D());
      // World -> screen. `camera.x`/`camera.y` are the load-bearing half and they
      // are the same two the cell pass gets from worldToScreen(); leaving them
      // off draws every wash at the canvas origin instead of its cell, which at
      // the default centred camera means world (0,0) is the ONLY cell that
      // lands correctly and every other one is silently stacked into the top-left
      // corner. Inset by a hair so adjacent washes leave the grid line readable
      // between them rather than reading as one solid field.
      path.rect(
        x * effCell + camera.x + 0.5,
        y * effCell + camera.y + 0.5,
        effCell - 1,
        effCell - 1
      );
    }

    for (const [type, path] of byType) {
      ctx.fillStyle = withAlpha(TYPE_COLORS[type] || '#78c850', alpha);
      ctx.fill(path);
    }
  }

  // 4. Render Alive Cells
  const isHighLOD = camera.zoom >= 0.55;

  for (const cell of engine.cells.values()) {
    if (cell.x < minWorldX || cell.x > maxWorldX || cell.y < minWorldY || cell.y > maxWorldY) {
      continue;
    }

    const scr = worldToScreen(cell.x, cell.y);
    const sp = currentMetadata.speciesById.get(cell.speciesId);
    // typesOf(), not sp.types — on a Gen 1 board 皮皮 is 一般 and 小磁怪 is 電, and
    // this colour is what a low-LOD cell and a failed sprite load both fall back
    // to. Reading the raw array here would paint a Fairy cell the one colour
    // that generation does not have.
    const typeColor = TYPE_COLORS[engine.typesOf(sp)?.[0]] || '#78c850';

    if (isHighLOD) {
      // Evolution stage: a FRAME, and the frame's WIDTH is what says which
      // stage it is.
      //
      // Both fills are gone (`rgba(155,89,182,0.22)` for stage 2 and
      // `rgba(230,126,34,0.18)` for stage 1). The reason is the wash, not taste:
      // an alpha fill over a cell is the same visual channel as the type wash,
      // so a stage-2 cell on a Fire claim read as a purple Fire cell and the two
      // encodings sat on top of each other. A stroke sits on the cell's edge, so
      // the sprite covers its middle and the two never fight.
      //
      // Stage 1 HAD no frame at all — fill only — so removing the fill would have
      // silently deleted the stage-1 marker at high LOD and left the stage
      // readable only on the HUD bar and at low zoom. Both stages now stroke, and
      // the widths differ enough (1 vs 2.5) to read apart at CELL_SIZE 36 without
      // reading as a colour. `check_life_page.mjs` asserts the two widths are
      // unequal, because making them equal is the obvious "tidy" that would put
      // both stages back to one signal.
      if (cell.stage > 0) {
        const stage2 = cell.stage === 2;
        ctx.strokeStyle = stage2 ? '#9b59b6' : '#e67e22';
        ctx.lineWidth = stage2 ? 2.5 : 1;
        ctx.strokeRect(scr.x + 0.5, scr.y + 0.5, effCell - 1, effCell - 1);
      }

      // Veteran single-stage aura (golden corners / glow).
      //
      // Measured against FALLBACK_EVOLUTION_LEVEL, not a literal 5: the claim the
      // gold corner is making is "this one has reached the level at which the ones
      // that DO evolve would have, and never will". The old `age >= 5` was true of
      // essentially every cell five generations in, so the glow marked nothing.
      if (cell.isVeteran && cell.level >= engine.fallbackEvolutionLevel) {
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

  // 5. Render Evolution Shockwaves / Particle Rings
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

      ctx.strokeStyle = fx.tone === 'wild'
        ? `rgba(126, 231, 255, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 3 * (1 - progress);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Outer starburst ring
      ctx.strokeStyle = fx.tone === 'wild'
        ? `rgba(46, 204, 113, ${alpha * 0.7})`
        : `rgba(245, 197, 66, ${alpha * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
      ctx.stroke();

      return true;
    });
    ctx.restore();
  }

  // 6. Tool Cursor Hover Previews
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
/**
 * The level at which the cells currently on the board most often entered a stage.
 *
 * Taken from `evolvedAtLevel` — the level each cell REACHED to evolve, captured at
 * that moment rather than read back later, because a cell's own `level` keeps
 * climbing after it evolves and would otherwise report where it is now, not
 * where the gate was. Ties go to the lower level, which is the order a reader
 * scans the legend in.
 *
 * Null when no cell has entered that stage, and the legend then shows a dash
 * rather than the fallback: naming Lv.30 for an empty stage would be claiming a
 * level nobody on the board reached.
 */
function commonEvolveLevel(stage) {
  const counts = new Map();
  for (const cell of engine.cells.values()) {
    if (cell.stage !== stage) continue;
    if (typeof cell.evolvedAtLevel !== 'number') continue;
    counts.set(cell.evolvedAtLevel, (counts.get(cell.evolvedAtLevel) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [level, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && level < best)) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

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

  const lvl1 = commonEvolveLevel(1);
  const lvl2 = commonEvolveLevel(2);
  if (els.stageLevel1) els.stageLevel1.textContent = lvl1 === null ? '' : `(Lv.${lvl1})`;
  if (els.stageLevel2) els.stageLevel2.textContent = lvl2 === null ? '' : `(Lv.${lvl2})`;

  // Update Drawer button badges
  //
  // The count lives in its own <span> rather than in the button's textContent.
  // Assigning textContent to the button is what erased the icon: the first tick
  // after load replaced `<svg>圖鑑 (0/151)</button>` with a bare string, and no
  // check noticed because a checker that only reads the numbers sees them either
  // way. `.icon` is 1em and `margin-right: .3em`, so an icon at the end of a
  // button also sits 0.3em off centre; the span is what keeps them apart.
  if (els.btnDexCount) {
    // The denominator is the drawer's own roster length, not totalSpeciesCount.
    // On Gen 1 those differ: the 伊布家族 section files four species out of the
    // 151 and appends nine, so the drawer shows 156 tiles and a `/151` was a
    // claim about progress the reader could check and find false.
    els.btnDexCount.textContent = `圖鑑 (${engine.unlockedSpecies.size}/${currentMetadata.dexRoster.length})`;
  }
  if (els.btnHofCount) {
    els.btnHofCount.textContent = `傳說 (${engine.unlockedMedals.length}/${currentMetadata.legendaries.length})`;
  }
  if (els.btnTypeCount) {
    // The denominator is the GENERATION's type count — 15 in Gen 1, 17 in Gens
    // 2-5, 18 from Gen 6 — not the number of types on the board. That is what
    // makes the numerator a collection rather than a snapshot: a reader who has
    // seen 9 of the 15 types Gen 1 has is 60% through that generation, and the
    // same 9 on a Gen 6 board would be 50% of 18 with two eras of types still
    // out of reach. `seenTypes` only grows within a board, and clear()/reset()
    // empty it, so the fraction always describes one run of one generation.
    els.btnTypeCount.textContent = `屬性 (${engine.seenTypes.size}/${typesForGeneration(engine.typeEra()).length})`;
  }
  // The drawer's list is a snapshot, so it is refreshed only while it is open.
  // Rebuilding 15 rows every tick on a closed drawer is work nobody can see.
  if (els.typeDrawer?.classList.contains('is-open')) updateTypeDrawer();
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
        ${!isUnlocked ? '<div class="life-medal-lock-badge"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg></div>' : ''}
      </div>
      <div class="life-medal-info">
        <div class="life-medal-name">#${String(leg.id).padStart(4, '0')} ${leg.names.zh}</div>
        <div class="life-medal-tag">${leg.types_zh ? leg.types_zh.join(' / ') : ''} · ${leg.genus || ''}</div>
      </div>
      <div class="life-medal-status ${isUnlocked ? 'unlocked' : 'locked'}">
        ${isUnlocked ? '已獲得 <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zm-16 3V7h2v4.17C3.84 10.87 3 9.63 3 8zm18 0c0 1.63-.84 2.87-2 3.17V7h2v1z"/></svg>' : `${requiredFamilies} 家族解鎖`}
      </div>
    `;

    els.hofMedalsList.appendChild(card);
  });
}

/** Hide the announcer, cancelling any pending timer from a previous message. */
function hideToast() {
  clearTimeout(toastHideTimer);
  if (els.celebrationToast) els.celebrationToast.classList.remove('is-visible');
}

let toastHideTimer = 0;

/**
 * One announcer, two tones. `role="alert"` on the element means whatever arrives
 * here is announced either way, and a second stacked toast would fight the first
 * for the same 120 z-index — so the tone is a class, not a second box.
 */
function showToast({ icon, eyebrow, headline, tone, duration = 4000 }) {
  if (!els.celebrationToast) return;
  if (els.toastIcon) els.toastIcon.innerHTML = icon;
  if (els.toastEyebrow) els.toastEyebrow.textContent = eyebrow;
  if (els.toastHeadline) els.toastHeadline.textContent = headline;

  els.celebrationToast.classList.toggle('is-wild', tone === 'wild');
  els.celebrationToast.classList.add('is-visible');

  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(hideToast, duration);
}

function showCelebrationToast(medal) {
  showToast({
    icon: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zm-16 3V7h2v4.17C3.84 10.87 3 9.63 3 8zm18 0c0 1.63-.84 2.87-2 3.17V7h2v1z"/></svg>',
    eyebrow: '成就達成 · 傳說',
    headline: `解鎖成就獎章！#${String(medal.id).padStart(4, '0')} ${medal.names.zh}`,
    tone: 'medal',
    duration: 4000
  });
}

/**
 * A wild encounter was announced nowhere at all before this existed.
 *
 * `wildSpawnEvent` came back from tick() and no page code read it, so an
 * encounter was a 0.16s flicker at 10x speed followed by silence — the reader
 * could not tell it had happened from not having happened.
 *
 * The same gold burst the evolution shockwave uses, at the spawn point, because
 * the pack really did just arrive; the cyan tone is deliberate rather than a
 * second colour set, since a wild arrival is a different KIND of event from a
 * medal and reusing gold for both is what made the medal feel unearned.
 */
function showWildEncounter(event) {
  const sp = event.species;
  const name = sp.names?.zh || `#${sp.id}`;

  visualEffects.push({
    x: event.x + 0.5,
    y: event.y + 0.5,
    startTime: performance.now(),
    duration: 1100,
    tone: 'wild'
  });

  playEncounterCry(sp.id);

  showToast({
    // The species' own sprite rather than a generic leaf. It was not decoration
    // chosen over a leaf — the leaf was invisible: it inherited `currentColor`
    // from a themed foreground onto a hardcoded navy card, and in light theme
    // that measured 1.03:1. An `<img>` carries its own pixels and cannot inherit
    // a theme at all, which is the fix and the reason.
    //
    // `assets/images/sprite/` is the 96px set, the guaranteed floor for all 1,025
    // species, and it is the same path the Pokédex drawer already uses — one
    // source for one job. `alt=""` because `name` is in the headline as text.
    icon: `<img class="life-toast-sprite" src="assets/images/sprite/${sp.id}.png" alt="" width="44" height="44">`,
    eyebrow: '野生遭遇 · 生態事件',
    headline: `#${String(sp.id).padStart(4, '0')} ${name} ×${event.count}`,
    tone: 'wild',
    duration: 2200
  });
}

// --- Encounter cry -------------------------------------------------------------

/**
 * Speeds at which an encounter stays silent, whatever the checkbox says.
 *
 * Measured over 20 x 60 seconds per generation: a wild encounter fires every
 * **2.0s at 10x**, every 3.8s at 5x, every 11s at 2x. Cries are 1.10s at the
 * median and 3.26s at the worst, so the two fastest speeds are not "often" —
 * they are a firehose, and at 10x a cry is sounding more than half the time.
 *
 * The speed control exists to watch population change, and at 5x/10x the board
 * is a blur nobody is reading an arrival off. The TOAST still fires at every
 * speed; only the sound is withheld, and the checkbox's own title says so, so a
 * reader who ticks it and hears nothing at 10x has been told why.
 */
const CRY_SILENT_ABOVE_SPEED = 2;

/**
 * Floor between two encounter cries, on top of never overlapping.
 *
 * The player is one-cry-at-a-time by default (`overlap: false` stops the last
 * one), which at 2x means a cry is followed 9.9 seconds of silence by the next
 * attempt. This only guards the case the player cannot: two encounters landing
 * inside the same tick's worth of time, where the second would cut the first off
 * mid-cry and sound like a click.
 */
const CRY_MIN_GAP_MS = 1200;

let lastEncounterCryAt = 0;

/**
 * Play the encountered species' cry, if the reader asked for one.
 *
 * Three guards, in the order that saves the most work: muted, too fast, too
 * soon. The muted guard is first because a reader who turned sound off should
 * not have a cry fetched and decoded — `sorting.html` learned that the hard way,
 * where a silent run still fetched up to 1,025 files.
 *
 * NEVER awaited, and `.catch(() => {})` is load-bearing rather than tidy:
 * `cryPlayer.unlock()` is `if (state === 'suspended') await ctx.resume()` with no
 * timeout and no catch, so until the reader has clicked something the promise
 * does not settle — measured, a headless probe past 120s. Awaiting it here would
 * leave the encounter handler suspended forever; the call is fire-and-forget and
 * a cry that cannot play is a supported state, not an error.
 */
function playEncounterCry(speciesId) {
  if (cryPlayer.muted) return;
  if (currentSpeed > CRY_SILENT_ABOVE_SPEED) return;
  if (!cryPlayer.has(speciesId)) return;

  const now = performance.now();
  if (now - lastEncounterCryAt < CRY_MIN_GAP_MS) return;
  lastEncounterCryAt = now;

  cryPlayer.play(speciesId).catch(() => {});
}

// --- Pokédex Drawer -----------------------------------------------------------
function updateDexDrawer() {
  if (!currentMetadata || !els.dexGrid) return;

  const filterText = els.dexSearch ? els.dexSearch.value.trim().toLowerCase() : '';
  els.dexGrid.innerHTML = '';

  const renderSpecies = (sp, extraClass = '') => {
    const isUnlocked = engine ? engine.unlockedSpecies.has(sp.id) : false;
    const zh = sp.names.zh;
    const idStr = String(sp.id).padStart(4, '0');

    if (filterText && !zh.toLowerCase().includes(filterText) && !idStr.includes(filterText)) {
      return null;
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = `life-dex-item ${isUnlocked ? 'is-unlocked' : 'is-locked'} ${sp.id === activeSpeciesId ? 'is-selected' : ''} ${extraClass}`;
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

    return item;
  };

  // The roster, and the section headers, come from ONE list — the same one the
  // 「圖鑑 (n/N)」 counter divides by. Rendering sections here while the
  // denominator lived in updateHUD is how the drawer came to show 156 tiles
  // against a `/151`.
  let lastSection = null;
  for (const entry of currentMetadata.dexRoster) {
    if (entry.section !== lastSection) {
      lastSection = entry.section;
      if (entry.section) {
        const header = document.createElement('div');
        header.className = 'life-dex-section-header';
        const label = document.createElement('span');
        label.textContent = entry.section.label;
        const note = document.createElement('small');
        note.textContent = entry.section.note;
        header.append(label, note);
        els.dexGrid.appendChild(header);
      }
    }
    const item = renderSpecies(entry.species, entry.section ? 'life-dex-branch' : '');
    if (item) els.dexGrid.appendChild(item);
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

/**
 * The type drawer: one distribution over every cell the board can point at —
 * live AND washed — as a share of all of them.
 *
 * THE DENOMINATOR IS THE WASH TOO, and that is the whole difference from the
 * button. `屬性 (9/15)` counts what has ever been here and only grows; this list
 * is a photograph of the board right now, and a wash the reader erased is gone
 * from it while staying on the button. Two numbers, two questions, one drawer's
 * title has to disambiguate — which is what the note under the list does.
 *
 * EVERY TYPE OF THE GENERATION IS LISTED, including the ones at 0%. A Gen 1
 * reader is looking at a board that cannot hold a Fairy cell at all, and a list
 * that hid the empty rows would make the generation's own restriction invisible.
 * Sorted by share so the common types read first, ties broken by chart order so
 * two runs of the same board print in the same order.
 */
function updateTypeDrawer() {
  if (!currentMetadata || !els.typeList) return;

  // The era's own type set, and the branch cannot widen it: `branchDestinationsFor`
  // admits only destinations whose types the era already has, so the 伊布 family
  // never contributes a type its board could not already hold. That is a verified
  // property rather than an assumption — `check_life_page.mjs` asserts the two
  // sets are equal across all 9 generations and both modes, so a future loosening
  // of the branch is a red test rather than a drawer that quietly disagrees with
  // its own denominator.
  const types = typesForGeneration(engine.typeEra());
  const total = types.length;

  // One pass over both populations. `territory` and `cells` are separate maps on
  // purpose — a wash never overlaps a live cell — so they can simply be added.
  const counts = new Map(types.map(t => [t, 0]));
  for (const type of engine.territory.values()) {
    if (counts.has(type)) counts.set(type, counts.get(type) + 1);
  }
  for (const cell of engine.cells.values()) {
    const t = engine.typesOf(currentMetadata.speciesById.get(cell.speciesId))?.[0];
    if (t && counts.has(t)) counts.set(t, counts.get(t) + 1);
  }

  const live = engine.cells.size;
  const washed = engine.territory.size;
  const grand = live + washed;

  if (els.typeSummary) {
    els.typeSummary.textContent = grand === 0
      ? '盤面尚無寶可夢。'
      : `活體 ${live} 隻 · 殘影 ${washed} 格 · 合計 ${grand} 格`;
  }

  const rows = types.map((type, i) => ({
    type,
    chartIndex: i,
    count: counts.get(type),
    pct: grand === 0 ? 0 : (counts.get(type) / grand) * 100
  }));
  rows.sort((a, b) => b.pct - a.pct || a.chartIndex - b.chartIndex);

  // The bar is rebuilt rather than resized, because the set of types with a
  // non-zero share changes from tick to tick and there is no fixed segment to
  // grow. Each segment carries the same number the row prints, so the bar and the
  // list cannot disagree — and both are written from `rows`.
  if (els.typeBar) {
    els.typeBar.innerHTML = '';
    for (const r of rows) {
      if (r.count === 0) continue;
      const seg = document.createElement('div');
      seg.className = 'life-type-seg';
      seg.style.width = `${r.pct}%`;
      seg.style.background = TYPE_COLORS[r.type] || '#78c850';
      seg.title = `${TYPE_EN_ZH[r.type] || r.type} ${r.count} 格 ${r.pct.toFixed(1)}%`;
      els.typeBar.appendChild(seg);
    }
    // The bar's own label, because a 0x0 bar reads as a broken element rather
    // than as an empty board.
    els.typeBar.setAttribute('aria-label', grand === 0 ? '屬性比例：尚無資料' : '屬性比例');
  }

  if (els.typeList) {
    els.typeList.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = 'life-type-row' + (r.count === 0 ? ' is-empty' : '');
      li.innerHTML = `
        <span class="life-type-swatch" style="background:${TYPE_COLORS[r.type] || '#78c850'}"></span>
        <span class="life-type-name">${TYPE_EN_ZH[r.type] || r.type}</span>
        <span class="life-type-count">${r.count}</span>
        <span class="life-type-pct">${grand === 0 ? '0' : r.pct.toFixed(1)}%</span>
      `;
      els.typeList.appendChild(li);
    }
  }

  if (els.typeEraNote) {
    // WHY THE DENOMINATOR IS WHAT IT IS, stated where the reader sees the number.
    const missing = TYPE_CHART_ORDER.filter(t => !types.includes(t));
    const zh = t => TYPE_EN_ZH[t] || t;

    // TWO SHAPES, and the difference is the mode rather than the number: a Let's
    // Go board is a 2018 game playing Gen 1's roster, so its denominator comes
    // from the game's era and there is nothing left to explain. A classic board's
    // comes from its own generation, and naming the absent types is what makes
    // 「15」 mean something — the reader can see that a Fairy cell is not
    // missing from the simulation but from the games.
    els.typeEraNote.textContent = engine.mode === 'letsGo'
      ? `Let's Go 是 2018 年的遊戲，${total} 種屬性全開。`
      : `第 ${currentMetadata.gen} 世代有 ${total} 種屬性` +
        (missing.length ? `（尚無 ${missing.map(zh).join('、')}）。` : '。');
  }
}

function closeDrawers() {
  if (els.hofDrawer) els.hofDrawer.classList.remove('is-open');
  if (els.dexDrawer) els.dexDrawer.classList.remove('is-open');
  if (els.typeDrawer) els.typeDrawer.classList.remove('is-open');
}

// --- Setup Modal --------------------------------------------------------------
let modalSelectedGen = 1;
let modalSelectedStarterId = 1;
let modalLetsGoMode = false;

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
  if (!genDef) return;

  // For Gen 1, determine which starter list to use based on Let's Go mode
  let starterIds = genDef.starters;
  if (gen === 1 && modalLetsGoMode && genDef.letsGoStarters) {
    starterIds = genDef.letsGoStarters;
  }
  const starters = starterIds.map(id => allPokemon.find(p => p.id === id)).filter(Boolean);

  if (starters.length > 0 && !starters.some(s => s.id === modalSelectedStarterId)) {
    modalSelectedStarterId = starters[0].id;
  }

  // The Let's Go switch lives in step 2's title, because it is what changes
  // step 2's cards. It used to be found with
  // `.life-modal-section-title:nth-of-type(2)`, which resolves to the element
  // that is both that class AND the dialog's 2nd <div> — and `.life-modal-header`
  // is the 1st, so the match was step 1 (選擇目標世代). A screenshot agreed and no
  // check did: a switch that swaps the starter list sat above the generation
  // tabs, two sections away from the only thing it changes.
  const titleEl = els.stepStarter;
  if (titleEl) {
    const existingToggle = titleEl.querySelector('.life-lets-go-toggle');
    if (gen === 1 && genDef.letsGoStarters) {
      if (!existingToggle) {
        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'life-lets-go-toggle';
        titleEl.appendChild(toggleDiv);
      }
      const toggle = titleEl.querySelector('.life-lets-go-toggle');
      // Re-bound rather than added to, because the innerHTML below replaces both
      // inputs on every render: a listener added without being re-assigned dies on
      // the first change event and the switch stops working after one use.
      toggle.innerHTML = `
        <label class="life-lets-go-option ${!modalLetsGoMode ? 'is-selected' : ''}">
          <input type="radio" name="letsGoMode" value="classic" ${!modalLetsGoMode ? 'checked' : ''}>
          <span>經典模式</span>
        </label>
        <label class="life-lets-go-option ${modalLetsGoMode ? 'is-selected' : ''}">
          <input type="radio" name="letsGoMode" value="letsgo" ${modalLetsGoMode ? 'checked' : ''}>
          <span>Let's Go 模式</span>
        </label>
      `;
      toggle.querySelectorAll('input[name="letsGoMode"]').forEach(input => {
        input.addEventListener('change', () => {
          modalLetsGoMode = input.value === 'letsgo';
          modalSelectedStarterId = modalLetsGoMode ? 25 : 1;
          renderSetupStarters(gen);
        });
      });
    } else if (existingToggle) {
      // Remove the switch for every other generation. `.life-modal-section-title`
      // is the class all three steps' titles carry, so this cannot be expressed as
      // a selector that only ever matches step 2.
      existingToggle.remove();
    }
  }

  starters.forEach(starter => {
    const card = document.createElement('div');
    card.className = `life-starter-card ${starter.id === modalSelectedStarterId ? 'is-selected' : ''}`;
    const primaryType = (engine.typesOf(starter) || [])[0] || 'Normal';
    const typeColor = TYPE_COLORS[primaryType] || '#78c850';
    // TYPE_EN_ZH keyed off the ERA type, never `starter.types_zh[0]`. Both halves
    // of that matter: the data's own label is the modern one, so on a Gen 1
    // screen a 皮皮 card would have been a green swatch reading 妖精 — the
    // colour and the word disagreeing with each other inside one 20px badge.
    const typeLabel = TYPE_EN_ZH[primaryType] || '';

    card.innerHTML = `
      <img class="life-starter-img" src="assets/images/pokemon/${starter.id}.png" alt="${starter.names.zh}">
      <div class="life-starter-name">${starter.names.zh}</div>
      <div class="life-starter-type" style="background:${typeColor}">${typeLabel}</div>
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
    // The glyph and the label both have to follow `isPlaying`, and they came in
    // mismatched: the button drew a PLAY triangle on 暫停 and PAUSE bars on 播放.
    // Two controls in two states and both of them wrong, which is why the glyph
    // is derived from the same boolean as the label rather than typed beside it.
    els.btnPlay.innerHTML = isPlaying
      ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>暫停'
      : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>播放';
  });

  // Step
  els.btnStep?.addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      els.btnPlay.classList.remove('is-playing');
      els.btnPlay.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>播放';
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

  els.chkTerritory?.addEventListener('change', e => {
    showTerritory = e.target.checked;
  });

  /* The encounter cry. The page's DEFAULT is a view mute, applied once here, and
   * only the reader's own tick writes the shared preference — that split is the
   * whole of §3.G6's bug: `cryPlayer.muted = true` persists to the site-wide key,
   * so merely LOADING this page used to be enough to silence cries.html,
   * detail.html and spectrum.html for everyone who visited it.
   *
   * The default is off rather than on because of the numbers above, and the two
   * halves are separate decisions: `#viewMuted` is this page's opinion, and the
   * checkbox is the reader's. `muteForView(false)` has to be called alongside the
   * un-mute because `get muted()` is the OR of the two — clearing only
   * `#storedMuted` would leave `#viewMuted` true and the page still silent. */
  cryPlayer.muteForView(true);
  els.chkEncounterCry?.addEventListener('change', e => {
    cryPlayer.muted = !e.target.checked;
    if (e.target.checked) {
      // Restart the gap, or the first encounter after ticking the box is
      // swallowed by a window opened while the reader was reaching for it.
      lastEncounterCryAt = 0;
      cryPlayer.muteForView(false);
    }
  });

  // Generation Modal triggers
  els.btnOpenSetup?.addEventListener('click', openSetupModal);
  els.genBadge?.addEventListener('click', openSetupModal);
  els.setupClose?.addEventListener('click', closeSetupModal);
  els.setupSubmit?.addEventListener('click', () => {
    const seedModeInput = document.querySelector('input[name="setupSeedMode"]:checked');
    const isRandom = seedModeInput ? seedModeInput.value === 'random' : true;
    // The mode is a real mode, not a label: it changes the seed roster AND
    // freezes Pikachu in the engine, so it is passed rather than kept here.
    setupGeneration(modalSelectedGen, modalSelectedStarterId, isRandom, modalLetsGoMode ? 'letsGo' : '');
    closeSetupModal();
  });

  // Drawers triggers
  els.btnHofDrawer?.addEventListener('click', () => {
    closeDrawers();
    updateHallOfFameDrawer();
    els.hofDrawer?.classList.add('is-open');
  });
  els.hofClose?.addEventListener('click', () => {
    els.hofDrawer?.classList.remove('is-open');
  });

  // The type drawer, wired exactly like the other two: close the others, rebuild
  // the content ON OPEN (it is a snapshot, and a stale one is a wrong one), then
  // show it. The rebuild-on-open is what lets updateHUD() skip it while closed.
  els.btnTypeDrawer?.addEventListener('click', () => {
    closeDrawers();
    updateTypeDrawer();
    els.typeDrawer?.classList.add('is-open');
  });
  els.typeClose?.addEventListener('click', () => {
    els.typeDrawer?.classList.remove('is-open');
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
