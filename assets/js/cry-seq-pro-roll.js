/**
 * The two canvases of cry-studio.html: the pitch × time board that holds cries,
 * and the drum lanes beneath it. One module, because they share a step grid, a
 * playhead and a particle field, and because the keyboard cursor moves between
 * them as a single surface.
 *
 * The look
 * --------
 * Every sound is a small square TILE with a glyph on it — dots, hatching, a ring,
 * a hash, a cross, two bars, four squares, a disc — instead of a coloured bar with
 * a portrait. A glance at the board reads as rhythm and texture first; the
 * Pokémon behind a tile is one hover (or one selection) away, and is shown big
 * for a moment when its tile fires. A Pokémon's TYPE picks its glyph and colour,
 * so a board of Water and Grass looks different from one of Ghosts without any
 * label. Drum voices have fixed glyphs of their own.
 *
 * The colours are the studio's own palette (`--sq-*` on `.sq-page`), read here
 * from the canvas's computed style. They are deliberately NOT the site's theme
 * tokens: this page is always dark, see cry-seq.css's docblock for why.
 *
 * Why canvas rather than a DOM grid
 * ---------------------------------
 * 25 rows × 64 steps is 1,600 cells and every one of them can hold a draggable
 * tile; as DOM that is 1,600 listeners and a layout per drag frame. The board
 * paints in one pass instead, and the price — canvas is opaque to assistive
 * tech — is paid back below: each canvas is a focusable `role="application"` with
 * a keyboard cursor, and every edit is announced through `announce()` so a screen
 * reader hears "第 6 步 放上皮卡丘" rather than nothing.
 *
 * Pointer model (board)
 *   - press empty cell     → place the brush there, hear it, and keep dragging to
 *                             set its length
 *   - press a tile's body  → select + drag to move (row and step)
 *   - press a tile's edge  → drag to resize (the right 7 px of its last cell)
 *   - right-click / Delete → remove
 * Touch scrolls the page horizontally first (`touch-action: pan-x pan-y`), so a
 * tap places and a drag scrolls; moving a note on a phone is done with the
 * selection bar's buttons, which the page provides.
 *
 * Pointer model (drums): press toggles a cell and the drag paints the same value
 * across the lane; Shift/right-click cycles ghost → normal → accent.
 */

import {
  rowCount, noteAt, noteCovering, placeNote, removeNote, rowToMidi, midiName, cycleDrum, setDrum, rowIsRoot,
  chordName, CHORD_STEPS,
} from './cry-seq-pro-pattern.js';

const EDGE_PX = 7;
const FLASH_MS = 280;
/** Particles per fired tile, indexed by the EMISSION meter (0–4). */
const EMISSION = [0, 3, 6, 10, 16];
const GRAVITY = 46;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Which glyph each type wears. Types that share a colour family never share a
 *  glyph, so the two cues disagree usefully rather than repeating each other. */
/* One glyph per type, no two alike, and none of them reused by a drum. Drums are
 * square tiles too, but in a separate Morandi (low-chroma) palette and with their own
 * five glyphs: kick = solid disc, snare = diagonal hatch (the snare wires), closed hat
 * = 3x3 dots, open hat = sun-burst ring (the sizzle), clap = an open hand. */
const TYPE_GLYPH = {
  normal: 'frame', fire: 'flame', water: 'waves', electric: 'bolt', grass: 'sprout', ice: 'flake',
  fighting: 'cross', poison: 'bubbles', ground: 'dome', flying: 'wings', psychic: 'eye', bug: 'quad',
  rock: 'gem', ghost: 'ghost', dragon: 'hash', dark: 'moon', steel: 'hex', fairy: 'spark',
};
const DRUM_GLYPH = { bd: 'disc', sd: 'hatch', hh: 'dots', oh: 'sun', cp: 'hand' };
const DRUM_NAMES = Object.keys(DRUM_GLYPH);
const TYPE_NAMES = Object.keys(TYPE_GLYPH);

const cssVar = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

function parseColor(str) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (m) return m[1].split(',').slice(0, 3).map((n) => parseFloat(n));
  return [128, 128, 128];
}
/** Relative luminance — decides whether a glyph is cut in dark or light. */
function luminance([r, g, b]) {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function createRoll(opts) {
  const {
    rollCanvas, drumCanvas, getPattern, getBrush, getInfo, spriteUrl, engine,
    onEdit, onSelect, onHover, announce, getEmission = () => 3,
  } = opts;

  const geo = { stepW: 30, rowH: 28, laneH: 34 };
  const sprites = new Map();
  let dirty = true;
  let selected = null;
  let cursor = { zone: 'roll', step: 0, row: 0 };
  let hover = null;
  let drag = null;
  let lastLen = 2;
  let tokens = {};
  const flashes = new Map();
  const particles = { roll: [], drums: [] };
  let raf = 0;
  let last = 0;
  let destroyed = false;

  const readTokens = () => {
    const el = rollCanvas;
    tokens = {
      bg: cssVar(el, '--sq-bg', '#0e0d0c'),
      ink: cssVar(el, '--sq-ink', '#ebe6d8'),
      hot: cssVar(el, '--sq-hot', '#ff5a36'),
      types: {},
      drums: {},
    };
    for (const t of TYPE_NAMES) tokens.types[t] = cssVar(el, `--sq-t-${t}`, '#c9c2ad');
    for (const d of DRUM_NAMES) tokens.drums[d] = cssVar(el, `--sq-d-${d}`, '#c9c2ad');
    tokens.bgRgb = parseColor(tokens.bg);
    tokens.inkRgb = parseColor(tokens.ink);
    dirty = true;
  };

  const image = (id) => {
    let img = sprites.get(id);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.onload = () => { dirty = true; };
      img.src = spriteUrl(id);
      sprites.set(id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  };

  const withAlpha = (ctx, a, fn) => { const prev = ctx.globalAlpha; ctx.globalAlpha = prev * a; fn(); ctx.globalAlpha = prev; };

  /* ------------------------------------------------------------ layout */

  function layout(availableWidth) {
    const p = getPattern();
    geo.stepW = Math.max(26, Math.floor(availableWidth / p.steps));
    const rows = rowCount(p);
    geo.rowH = rows > 15 ? 20 : Math.max(26, Math.min(36, geo.stepW));
    geo.laneH = Math.max(30, Math.min(40, geo.stepW));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = (canvas, w, h) => {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit(rollCanvas, p.steps * geo.stepW, rows * geo.rowH);
    fit(drumCanvas, p.steps * geo.stepW, p.drums.length * geo.laneH);
    dirty = true;
    return geo;
  }

  /* ----------------------------------------------------------- glyphs */

  /** One tile: a coloured square with a glyph cut into it. */
  function drawTile(ctx, kind, x, y, s, color, scale = 1) {
    const rgb = parseColor(color);
    // Cut the glyph in whichever of bg / ink contrasts more with this tile
    // (every tile colour reaches >= 4:1 this way; see the CONTRAST note in cry-seq.css).
    const lt = luminance(rgb) + 0.05;
    const ink = lt / (luminance(tokens.bgRgb) + 0.05) >= (luminance(tokens.inkRgb) + 0.05) / lt ? tokens.bg : tokens.ink;
    const cx = x + s / 2;
    const cy = y + s / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    const u = s / 10;
    switch (kind) {
      case 'hash':
        ctx.beginPath();
        ctx.moveTo(x + s * 0.36, y + s * 0.18); ctx.lineTo(x + s * 0.36, y + s * 0.82);
        ctx.moveTo(x + s * 0.64, y + s * 0.18); ctx.lineTo(x + s * 0.64, y + s * 0.82);
        ctx.moveTo(x + s * 0.18, y + s * 0.36); ctx.lineTo(x + s * 0.82, y + s * 0.36);
        ctx.moveTo(x + s * 0.18, y + s * 0.64); ctx.lineTo(x + s * 0.82, y + s * 0.64);
        ctx.stroke();
        break;
      case 'cross':
        ctx.lineWidth = Math.max(2, s * 0.12);
        ctx.beginPath();
        ctx.moveTo(x + s * 0.24, y + s * 0.24); ctx.lineTo(x + s * 0.76, y + s * 0.76);
        ctx.moveTo(x + s * 0.76, y + s * 0.24); ctx.lineTo(x + s * 0.24, y + s * 0.76);
        ctx.stroke();
        break;
      case 'quad':
        for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) ctx.fillRect(x + s * (0.24 + i * 0.28), y + s * (0.24 + j * 0.28), s * 0.2, s * 0.2);
        break;
      case 'frame':
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.strokeRect(x + s * 0.29, y + s * 0.29, s * 0.42, s * 0.42);
        break;
      case 'flame':
        ctx.beginPath();
        ctx.moveTo(x + s * 0.5, y + s * 0.15);
        ctx.bezierCurveTo(x + s * 0.5, y + s * 0.38, x + s * 0.78, y + s * 0.42, x + s * 0.76, y + s * 0.66);
        ctx.bezierCurveTo(x + s * 0.74, y + s * 0.84, x + s * 0.26, y + s * 0.84, x + s * 0.24, y + s * 0.66);
        ctx.bezierCurveTo(x + s * 0.23, y + s * 0.5, x + s * 0.36, y + s * 0.46, x + s * 0.4, y + s * 0.32);
        ctx.bezierCurveTo(x + s * 0.44, y + s * 0.4, x + s * 0.46, y + s * 0.3, x + s * 0.5, y + s * 0.15);
        ctx.fill();
        break;
      case 'waves':
        ctx.lineWidth = Math.max(2, s * 0.09);
        for (const fy of [0.38, 0.62]) {
          ctx.beginPath();
          ctx.moveTo(x + s * 0.16, y + s * fy);
          ctx.bezierCurveTo(x + s * 0.3, y + s * (fy - 0.17), x + s * 0.42, y + s * (fy - 0.17), x + s * 0.5, y + s * fy);
          ctx.bezierCurveTo(x + s * 0.58, y + s * (fy + 0.17), x + s * 0.7, y + s * (fy + 0.17), x + s * 0.84, y + s * fy);
          ctx.stroke();
        }
        break;
      case 'bolt':
        ctx.beginPath();
        ctx.moveTo(x + s * 0.58, y + s * 0.12); ctx.lineTo(x + s * 0.28, y + s * 0.54); ctx.lineTo(x + s * 0.47, y + s * 0.54);
        ctx.lineTo(x + s * 0.4, y + s * 0.88); ctx.lineTo(x + s * 0.74, y + s * 0.4); ctx.lineTo(x + s * 0.54, y + s * 0.4);
        ctx.closePath(); ctx.fill();
        break;
      case 'sprout':
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + s * 0.5, y + s * 0.82); ctx.lineTo(x + s * 0.5, y + s * 0.46);
        ctx.moveTo(x + s * 0.5, y + s * 0.46); ctx.lineTo(x + s * 0.24, y + s * 0.24);
        ctx.moveTo(x + s * 0.5, y + s * 0.46); ctx.lineTo(x + s * 0.76, y + s * 0.24);
        ctx.stroke();
        break;
      case 'flake':
        ctx.lineWidth = Math.max(1.8, s * 0.08);
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          ctx.moveTo(cx - Math.cos(a) * s * 0.3, cy - Math.sin(a) * s * 0.3);
          ctx.lineTo(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3);
        }
        ctx.stroke();
        break;
      case 'bubbles':
        ctx.lineWidth = Math.max(1.8, s * 0.08);
        ctx.beginPath(); ctx.arc(x + s * 0.4, y + s * 0.6, s * 0.2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + s * 0.66, y + s * 0.32, s * 0.11, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + s * 0.7, y + s * 0.68, s * 0.05, 0, Math.PI * 2); ctx.fill();
        break;
      case 'dome':
        ctx.beginPath(); ctx.arc(cx, y + s * 0.68, s * 0.28, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.fillRect(x + s * 0.18, y + s * 0.74, s * 0.64, s * 0.09);
        break;
      case 'wings':
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x + s * 0.24, y + s * 0.44); ctx.lineTo(x + s * 0.5, y + s * 0.26); ctx.lineTo(x + s * 0.76, y + s * 0.44);
        ctx.moveTo(x + s * 0.24, y + s * 0.68); ctx.lineTo(x + s * 0.5, y + s * 0.5); ctx.lineTo(x + s * 0.76, y + s * 0.68);
        ctx.stroke();
        break;
      case 'eye':
        ctx.lineWidth = Math.max(1.8, s * 0.08);
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.27, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.09, 0, Math.PI * 2); ctx.fill();
        break;
      case 'gem':
        ctx.beginPath();
        ctx.moveTo(cx, y + s * 0.16); ctx.lineTo(x + s * 0.8, cy); ctx.lineTo(cx, y + s * 0.84); ctx.lineTo(x + s * 0.2, cy);
        ctx.closePath(); ctx.fill();
        break;
      case 'ghost':
        ctx.beginPath();
        ctx.moveTo(x + s * 0.28, y + s * 0.82); ctx.lineTo(x + s * 0.28, y + s * 0.46);
        ctx.arc(cx, y + s * 0.46, s * 0.22, Math.PI, 0);
        ctx.lineTo(x + s * 0.72, y + s * 0.82); ctx.lineTo(x + s * 0.61, y + s * 0.71); ctx.lineTo(cx, y + s * 0.82);
        ctx.lineTo(x + s * 0.39, y + s * 0.71);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = color;
        ctx.fillRect(x + s * 0.4, y + s * 0.4, Math.max(1.5, s * 0.07), Math.max(2, s * 0.1));
        ctx.fillRect(x + s * 0.57, y + s * 0.4, Math.max(1.5, s * 0.07), Math.max(2, s * 0.1));
        break;
      case 'moon':
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.27, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(cx + s * 0.11, cy - s * 0.07, s * 0.23, 0, Math.PI * 2); ctx.fill();
        break;
      case 'hex':
        ctx.lineWidth = Math.max(2, s * 0.09);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k - Math.PI / 2;
          const px = cx + Math.cos(a) * s * 0.28, py = cy + Math.sin(a) * s * 0.28;
          if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
        break;
      case 'spark':
        ctx.beginPath();
        ctx.moveTo(cx, y + s * 0.14); ctx.lineTo(x + s * 0.58, y + s * 0.42); ctx.lineTo(x + s * 0.86, cy);
        ctx.lineTo(x + s * 0.58, y + s * 0.58); ctx.lineTo(cx, y + s * 0.86); ctx.lineTo(x + s * 0.42, y + s * 0.58);
        ctx.lineTo(x + s * 0.14, cy); ctx.lineTo(x + s * 0.42, y + s * 0.42);
        ctx.closePath(); ctx.fill();
        break;
      case 'disc':
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2); ctx.fill();
        break;
      case 'hatch':
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
        ctx.lineWidth = Math.max(1.4, s * 0.075);
        for (let k = -s; k < s * 2; k += s * 0.2) { ctx.beginPath(); ctx.moveTo(x + k, y + s); ctx.lineTo(x + k + s, y); ctx.stroke(); }
        ctx.restore();
        break;
      case 'dots':
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          ctx.fillRect(Math.round(x + u * (2 + i * 2.6) - u * 0.4), Math.round(y + u * (2 + j * 2.6) - u * 0.4), Math.max(1.5, u * 0.9), Math.max(1.5, u * 0.9));
        }
        break;
      case 'sun': {
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.8, s * 0.08);
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.16, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (Math.PI / 4) * k;
          ctx.moveTo(cx + Math.cos(a) * s * 0.26, cy + Math.sin(a) * s * 0.26);
          ctx.lineTo(cx + Math.cos(a) * s * 0.37, cy + Math.sin(a) * s * 0.37);
        }
        ctx.stroke();
        break;
      }
      case 'hand': {
        // an open hand: four fingers, a palm, a thumb
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, s * 0.085);
        ctx.beginPath();
        for (const [fx, top] of [[0.37, 0.3], [0.47, 0.22], [0.57, 0.22], [0.67, 0.3]]) { ctx.moveTo(x + s * fx, y + s * 0.54); ctx.lineTo(x + s * fx, y + s * top); }
        ctx.moveTo(x + s * 0.34, y + s * 0.62); ctx.lineTo(x + s * 0.22, y + s * 0.48);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + s * 0.33, y + s * 0.5);
        ctx.lineTo(x + s * 0.71, y + s * 0.5);
        ctx.lineTo(x + s * 0.68, y + s * 0.74);
        ctx.quadraticCurveTo(x + s * 0.66, y + s * 0.82, x + s * 0.58, y + s * 0.82);
        ctx.lineTo(x + s * 0.46, y + s * 0.82);
        ctx.quadraticCurveTo(x + s * 0.37, y + s * 0.82, x + s * 0.35, y + s * 0.74);
        ctx.closePath(); ctx.fill();
        break;
      }
      default:
    }
    ctx.restore();
  }

  const noteStyle = (id) => {
    const type = (getInfo(id).type || 'normal').toLowerCase();
    return { color: tokens.types[type] || tokens.types.normal, glyph: TYPE_GLYPH[type] || 'disc' };
  };

  function spawn(zone, x, y, color, n) {
    if (!n || reducedMotion.matches) return;
    const list = particles[zone];
    for (let i = 0; i < n && list.length < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 22 + Math.random() * 80;
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 26, age: 0, life: 520 + Math.random() * 480, size: 2 + Math.floor(Math.random() * 3), color });
    }
  }
  function stepParticles(dt) {
    for (const list of Object.values(particles)) {
      for (const q of list) { q.age += dt; q.x += (q.vx * dt) / 1000; q.y += (q.vy * dt) / 1000; q.vy += (GRAVITY * dt) / 1000; }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].age >= list[i].life) list.splice(i, 1);
    }
  }
  function drawParticles(ctx, list) {
    for (const q of list) {
      ctx.globalAlpha = 1 - q.age / q.life;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- drawing */

  function grid(ctx, W, H, cols, rowsN, cellH, rootRows) {
    const { stepW } = geo;
    ctx.fillStyle = tokens.bg;
    ctx.fillRect(0, 0, W, H);
    if (rootRows) {
      for (const y of rootRows) withAlpha(ctx, 0.05, () => { ctx.fillStyle = tokens.ink; ctx.fillRect(0, y, W, cellH); });
    }
    ctx.fillStyle = tokens.ink;
    for (let s = 0; s <= cols; s++) {
      const a = s % 16 === 0 ? 0 : s % 4 === 0 ? 0.11 : 0.045;
      if (a) withAlpha(ctx, a, () => ctx.fillRect(s * stepW, 0, 1, H));
    }
    for (let r = 0; r <= rowsN; r++) withAlpha(ctx, 0.045, () => ctx.fillRect(0, r * cellH, W, 1));
    ctx.fillStyle = tokens.ink;
    ctx.globalAlpha = 0.3;
    for (let s = 0; s <= cols; s += 16) for (let y = 0; y < H; y += 8) ctx.fillRect(s * stepW, y, 1, 4);
    ctx.globalAlpha = 1;
  }

  function drawRoll(ctx, pos, now) {
    const p = getPattern();
    const rows = rowCount(p);
    const { stepW, rowH } = geo;
    const W = p.steps * stepW;
    const H = rows * rowH;
    const rootRows = [];
    for (let row = 0; row < rows; row++) if (rowIsRoot(p, row)) rootRows.push((rows - 1 - row) * rowH);
    grid(ctx, W, H, p.steps, rows, rowH, rootRows);

    if (pos >= 0) withAlpha(ctx, 0.07, () => { ctx.fillStyle = tokens.ink; ctx.fillRect(Math.floor(pos) * stepW, 0, stepW, H); });

    if (hover && hover.zone === 'roll' && !drag) {
      ctx.strokeStyle = tokens.ink;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      ctx.strokeRect(hover.step * stepW + 1.5, (rows - 1 - hover.row) * rowH + 1.5, stepW - 3, rowH - 3);
      ctx.globalAlpha = 1;
    }

    const s0 = Math.min(stepW, rowH) - 6;
    for (const note of p.notes) {
      const { color, glyph } = noteStyle(note.id);
      const cellX = note.step * stepW;
      const cellY = (rows - 1 - note.row) * rowH;
      const s = note.vel === 1 ? s0 - 5 : s0;
      const x = cellX + (stepW - s) / 2;
      const y = cellY + (rowH - s) / 2;
      const age = (now - (flashes.get(note) ?? -1e9)) / FLASH_MS;
      const lit = age >= 0 && age < 1 ? 1 - age : 0;

      if (note.len > 1) {
        const tailEnd = (note.step + note.len) * stepW - (stepW - s) / 2;
        withAlpha(ctx, 0.5, () => { ctx.fillStyle = color; ctx.fillRect(x + s, cellY + rowH / 2 - s * 0.18, tailEnd - (x + s), s * 0.36); });
        ctx.fillStyle = color;
        ctx.fillRect(tailEnd - 3, cellY + rowH / 2 - s * 0.3, 3, s * 0.6);
      }
      drawTile(ctx, glyph, x, y, s, color, 1 + lit * 0.18);
      if (note.vel === 3) { ctx.strokeStyle = tokens.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1.5, y - 1.5, s + 3, s + 3); }
      if (note === selected) {
        ctx.strokeStyle = tokens.hot;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x - 4, y - 4, s + 8, s + 8);
        ctx.setLineDash([]);
      }
      if (lit) {
        const img = image(note.id);
        if (img) {
          const size = Math.min(56, s * 1.9);
          withAlpha(ctx, Math.min(1, lit * 1.4), () => ctx.drawImage(img, x + s / 2 - size / 2, y - size * (0.55 + (1 - lit) * 0.7), size, size));
        }
      }
    }

    if (document.activeElement === rollCanvas && cursor.zone === 'roll') {
      ctx.strokeStyle = tokens.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cursor.step * stepW + 2, (rows - 1 - cursor.row) * rowH + 2, stepW - 4, rowH - 4);
      ctx.setLineDash([]);
    }
    drawParticles(ctx, particles.roll);
    if (pos >= 0) {
      ctx.fillStyle = tokens.ink;
      ctx.fillRect(Math.round(pos * stepW) - 1, 0, 2, H);
      ctx.fillRect(Math.round(pos * stepW) - 4, 0, 8, 8);
    }
  }

  function drawDrums(ctx, pos, now) {
    const p = getPattern();
    const { stepW, laneH } = geo;
    const W = p.steps * stepW;
    const H = p.drums.length * laneH;
    grid(ctx, W, H, p.steps, p.drums.length, laneH, null);
    if (pos >= 0) withAlpha(ctx, 0.07, () => { ctx.fillStyle = tokens.ink; ctx.fillRect(Math.floor(pos) * stepW, 0, stepW, H); });

    const s0 = Math.min(stepW, laneH) - 8;
    p.drums.forEach((lane, l) => {
      const color = tokens.drums[lane.name] || tokens.types.normal;
      for (let st = 0; st < p.steps; st++) {
        const vel = Number(lane.steps[st]);
        const s = vel === 1 ? s0 - 6 : s0;
        const x = st * stepW + (stepW - s) / 2;
        const y = l * laneH + (laneH - s) / 2;
        if (!vel) {
          withAlpha(ctx, 0.2, () => { ctx.fillStyle = tokens.ink; ctx.fillRect(Math.round(st * stepW + stepW / 2) - 1, Math.round(l * laneH + laneH / 2) - 1, 2, 2); });
          continue;
        }
        const age = (now - (flashes.get(`${l}:${st}`) ?? -1e9)) / FLASH_MS;
        const lit = age >= 0 && age < 1 ? 1 - age : 0;
        withAlpha(ctx, lane.mute ? 0.25 : vel === 1 ? 0.6 : 1, () => drawTile(ctx, DRUM_GLYPH[lane.name] || 'disc', x, y, s, color, 1 + lit * 0.2));
        if (vel === 3 && !lane.mute) { ctx.strokeStyle = tokens.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1.5, y - 1.5, s + 3, s + 3); }
      }
    });
    if (document.activeElement === drumCanvas && cursor.zone === 'drums') {
      ctx.strokeStyle = tokens.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cursor.step * stepW + 2, cursor.row * laneH + 2, stepW - 4, laneH - 4);
      ctx.setLineDash([]);
    }
    drawParticles(ctx, particles.drums);
    if (pos >= 0) { ctx.fillStyle = tokens.ink; ctx.fillRect(Math.round(pos * stepW) - 1, 0, 2, H); }
  }

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (last || now));
    last = now;
    const p = getPattern();
    const emission = EMISSION[Math.max(0, Math.min(4, getEmission()))];
    for (const ev of engine.drain()) {
      if (ev.kind === 'chord') continue;
      if (reducedMotion.matches) continue;
      if (ev.kind === 'cry') {
        flashes.set(ev.note, now);
        const rows = rowCount(p);
        const { color } = noteStyle(ev.note.id);
        spawn('roll', ev.note.step * geo.stepW + geo.stepW / 2, (rows - 1 - ev.note.row) * geo.rowH + geo.rowH / 2, color, emission);
      } else {
        flashes.set(`${ev.lane}:${ev.step}`, now);
        const lane = p.drums[ev.lane];
        spawn('drums', ev.step * geo.stepW + geo.stepW / 2, ev.lane * geo.laneH + geo.laneH / 2, tokens.drums[lane?.name] || tokens.ink, Math.ceil(emission / 2));
      }
      dirty = true;
    }
    stepParticles(dt);
    const pos = engine.position();
    const animating = flashes.size > 0 || particles.roll.length > 0 || particles.drums.length > 0;
    if (!dirty && pos < 0 && !animating) return;
    drawRoll(rollCanvas.getContext('2d'), pos, now);
    drawDrums(drumCanvas.getContext('2d'), pos, now);
    for (const [k, t] of flashes) if (now - t > FLASH_MS) flashes.delete(k);
    dirty = pos >= 0;
  }

  /* ------------------------------------------------------- interaction */

  const cellOf = (canvas, e, zone) => {
    const r = canvas.getBoundingClientRect();
    const p = getPattern();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const step = Math.min(p.steps - 1, Math.max(0, Math.floor(x / geo.stepW)));
    if (zone === 'roll') {
      const rows = rowCount(p);
      return { step, row: Math.min(rows - 1, Math.max(0, rows - 1 - Math.floor(y / geo.rowH))), x };
    }
    return { step, row: Math.min(p.drums.length - 1, Math.max(0, Math.floor(y / geo.laneH))), x };
  };

  const describe = (note) => {
    const p = getPattern();
    return `${midiName(rowToMidi(p, note.row, note.step))} 第 ${note.step + 1} 步 ${getInfo(note.id).name}`;
  };

  function select(note) {
    selected = note;
    dirty = true;
    onSelect?.(note);
  }

  function placeAtCursor(cell) {
    const p = getPattern();
    const existing = noteAt(p, cell.step, cell.row);
    if (existing) {
      removeNote(p, existing);
      if (selected === existing) select(null);
      announce?.(`移除 ${describe(existing)}`);
      onEdit('notes');
      return null;
    }
    const note = placeNote(p, { id: getBrush(), step: cell.step, row: cell.row, len: lastLen });
    if (!note) { announce?.('音符已達上限'); return null; }
    select(note);
    engine.audition(note.id, note.row, note.len, note.step);
    announce?.(`放上 ${describe(note)}`);
    onEdit('notes');
    return note;
  }

  const report = (zone, cell) => {
    const p = getPattern();
    hover = cell ? { zone, step: cell.step, row: cell.row } : null;
    dirty = true;
    if (!cell) { onHover?.(null); return; }
    const chord = chordName(p, Math.min(p.chords.length - 1, Math.floor(cell.step / CHORD_STEPS)));
    if (zone === 'roll') {
      const note = noteCovering(p, cell.step, cell.row);
      onHover?.({ zone, step: cell.step, chord, pitch: midiName(rowToMidi(p, cell.row, cell.step)), note });
    } else {
      onHover?.({ zone, step: cell.step, chord, lane: p.drums[cell.row].name });
    }
  };

  rollCanvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const p = getPattern();
    const cell = cellOf(rollCanvas, e, 'roll');
    cursor = { zone: 'roll', ...cell };
    const hit = noteCovering(p, cell.step, cell.row);
    rollCanvas.setPointerCapture(e.pointerId);
    rollCanvas.focus({ preventScroll: true });
    if (hit) {
      select(hit);
      const endX = (hit.step + hit.len) * geo.stepW;
      if (endX - cell.x <= EDGE_PX) {
        drag = { mode: 'resize', note: hit };
      } else {
        drag = { mode: 'move', note: hit, dStep: cell.step - hit.step, lastRow: hit.row, moved: false };
        engine.audition(hit.id, hit.row, hit.len, hit.step);
      }
    } else {
      const note = placeAtCursor(cell);
      if (note) drag = { mode: 'resize', note, fresh: true };
    }
    e.preventDefault();
  });

  rollCanvas.addEventListener('pointermove', (e) => {
    const p = getPattern();
    const cell = cellOf(rollCanvas, e, 'roll');
    if (!drag) {
      const hit = noteCovering(p, cell.step, cell.row);
      const nearEdge = hit && (hit.step + hit.len) * geo.stepW - cell.x <= EDGE_PX;
      rollCanvas.style.cursor = nearEdge ? 'ew-resize' : hit ? 'grab' : 'copy';
      report('roll', cell);
      return;
    }
    const { note } = drag;
    if (drag.mode === 'resize') {
      const len = Math.min(p.steps - note.step, Math.max(1, cell.step - note.step + 1));
      if (len !== note.len) { note.len = len; lastLen = len; dirty = true; }
    } else {
      const step = Math.min(p.steps - note.len, Math.max(0, cell.step - drag.dStep));
      const row = cell.row;
      const clash = p.notes.find((n) => n !== note && n.step === step && n.row === row);
      if (!clash && (step !== note.step || row !== note.row)) {
        note.step = step;
        if (row !== note.row) {
          note.row = row;
          if (row !== drag.lastRow) { drag.lastRow = row; engine.audition(note.id, row, note.len, note.step); }
        }
        drag.moved = true;
        dirty = true;
      }
    }
  });
  rollCanvas.addEventListener('pointerleave', () => { if (!drag) report('roll', null); });

  const endDrag = () => {
    if (!drag) return;
    const wasEdit = drag.fresh || drag.moved || drag.mode === 'resize';
    drag = null;
    if (wasEdit) onEdit('notes');
  };
  rollCanvas.addEventListener('pointerup', endDrag);
  rollCanvas.addEventListener('pointercancel', endDrag);

  rollCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = getPattern();
    const cell = cellOf(rollCanvas, e, 'roll');
    const hit = noteCovering(p, cell.step, cell.row);
    if (hit) {
      removeNote(p, hit);
      if (selected === hit) select(null);
      announce?.(`移除 ${describe(hit)}`);
      dirty = true;
      onEdit('notes');
    }
  });

  rollCanvas.addEventListener('keydown', (e) => {
    const p = getPattern();
    const rows = rowCount(p);
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (move) {
      cursor.zone = 'roll';
      cursor.step = Math.min(p.steps - 1, Math.max(0, cursor.step + move[0]));
      cursor.row = Math.min(rows - 1, Math.max(0, cursor.row + move[1]));
      const hit = noteCovering(p, cursor.step, cursor.row);
      announce?.(`${midiName(rowToMidi(p, cursor.row, cursor.step))} 第 ${cursor.step + 1} 步${hit ? ` ${getInfo(hit.id).name}` : ''}`);
      report('roll', cursor);
    } else if (e.key === 'Enter') {
      placeAtCursor(cursor);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const hit = noteCovering(p, cursor.step, cursor.row);
      if (hit) { removeNote(p, hit); select(null); announce?.(`移除 ${describe(hit)}`); onEdit('notes'); }
    } else if (e.key === '[' || e.key === ']') {
      const hit = noteCovering(p, cursor.step, cursor.row);
      if (hit) {
        hit.len = Math.min(p.steps - hit.step, Math.max(1, hit.len + (e.key === ']' ? 1 : -1)));
        lastLen = hit.len;
        announce?.(`長度 ${hit.len} 步`);
        onEdit('notes');
      }
    } else if (e.key === 'v' || e.key === 'V') {
      const hit = noteCovering(p, cursor.step, cursor.row);
      if (hit) { hit.vel = (hit.vel % 3) + 1; announce?.(['', '輕', '中', '重音'][hit.vel]); onEdit('notes'); }
    } else {
      return;
    }
    dirty = true;
    e.preventDefault();
  });

  /* drums */

  let paint = null;
  const drumAt = (e) => cellOf(drumCanvas, e, 'drums');

  drumCanvas.addEventListener('pointerdown', (e) => {
    const p = getPattern();
    const c = drumAt(e);
    cursor = { zone: 'drums', step: c.step, row: c.row };
    drumCanvas.setPointerCapture(e.pointerId);
    drumCanvas.focus({ preventScroll: true });
    const cur = Number(p.drums[c.row].steps[c.step]);
    if (e.shiftKey || e.button === 2) {
      const v = cycleDrum(p, c.row, c.step);
      paint = { lane: c.row, value: v, last: c.step };
    } else {
      const value = cur ? 0 : 2;
      setDrum(p, c.row, c.step, value);
      paint = { lane: c.row, value, last: c.step };
    }
    if (Number(p.drums[c.row].steps[c.step])) engine.auditionDrum(c.row);
    dirty = true;
    e.preventDefault();
  });
  drumCanvas.addEventListener('pointermove', (e) => {
    const p = getPattern();
    const c = drumAt(e);
    if (!paint) { report('drums', c); return; }
    if (c.step === paint.last) return;
    paint.last = c.step;
    setDrum(p, paint.lane, c.step, paint.value);
    dirty = true;
  });
  drumCanvas.addEventListener('pointerleave', () => { if (!paint) report('drums', null); });
  const endPaint = () => { if (paint) { paint = null; onEdit('drums'); } };
  drumCanvas.addEventListener('pointerup', endPaint);
  drumCanvas.addEventListener('pointercancel', endPaint);
  drumCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  drumCanvas.addEventListener('keydown', (e) => {
    const p = getPattern();
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const say = () => announce?.(`${p.drums[cursor.row].name} 第 ${cursor.step + 1} 步 ${['關', '輕', '中', '重音'][Number(p.drums[cursor.row].steps[cursor.step])]}`);
    if (move) {
      cursor.zone = 'drums';
      cursor.step = Math.min(p.steps - 1, Math.max(0, cursor.step + move[0]));
      cursor.row = Math.min(p.drums.length - 1, Math.max(0, cursor.row + move[1]));
      say();
    } else if (e.key === 'Enter') {
      const cur = Number(p.drums[cursor.row].steps[cursor.step]);
      if (e.shiftKey) cycleDrum(p, cursor.row, cursor.step);
      else setDrum(p, cursor.row, cursor.step, cur ? 0 : 2);
      say();
      onEdit('drums');
    } else {
      return;
    }
    dirty = true;
    e.preventDefault();
  });

  for (const c of [rollCanvas, drumCanvas]) {
    c.addEventListener('focus', () => { dirty = true; });
    c.addEventListener('blur', () => { dirty = true; });
  }

  readTokens();
  raf = requestAnimationFrame(frame);

  return {
    layout,
    redraw() { dirty = true; },
    readTokens,
    select,
    get selected() { return selected; },
    get lastLen() { return lastLen; },
    set lastLen(v) { lastLen = v; },
    clearSelection() { selected = null; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
    },
  };
}
