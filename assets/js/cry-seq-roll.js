/**
 * The two canvases of cry-studio.html: the pitch × time roll that holds cries,
 * and the drum lanes beneath it. One module, because they share a step grid, a
 * playhead and a flash animation, and because the keyboard cursor moves between
 * them as a single surface.
 *
 * Why canvas rather than a DOM grid
 * ---------------------------------
 * 25 rows × 64 steps is 1,600 cells and every one of them can hold a draggable
 * sprite; as DOM that is 1,600 listeners and a layout per drag frame. The roll
 * paints in one pass instead, and the price — canvas is opaque to assistive
 * tech — is paid back below: each canvas is a focusable `role="application"`
 * with a keyboard cursor, and every edit is announced through `announce()` so a
 * screen reader hears "A5 第 6 步 放上皮卡丘" rather than nothing.
 *
 * Pointer model (roll)
 *   - press empty cell     → place the brush there, hear it, and keep dragging to
 *                             set its length
 *   - press a note's body  → select + drag to move (row and step)
 *   - press a note's edge  → drag to resize (the right 7 px)
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
} from './cry-seq-pattern.js';

const EDGE_PX = 7;
/** Playback flashes are decoration, not information (the playhead already says
 *  where we are), so a reader who asked for less motion simply does not get them. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const FLASH_MS = 260;
const LANE_TOKENS = ['--algo-pivot', '--algo-min', '--algo-compare', '--algo-swap', '--algo-start'];

/** Read a CSS custom property off :root. Mirrors shared.js `readThemeToken`, kept
 *  local so this module has no import beyond the pattern model. */
const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createRoll(opts) {
  const {
    rollCanvas, drumCanvas, getPattern, getBrush, getInfo, spriteUrl, engine,
    onEdit, onSelect, announce,
  } = opts;

  const geo = { stepW: 30, rowH: 24, laneH: 34 };
  const sprites = new Map();
  let dirty = true;
  let selected = null; // a note object
  let cursor = { zone: 'roll', step: 0, row: 0 };
  let drag = null;
  let lastLen = 2;
  let tokens = {};
  const flashes = new Map(); // key → start ms
  let raf = 0;
  let destroyed = false;

  const readTokens = () => {
    tokens = {
      bg: token('--bg-card', '#161e38'),
      rowAlt: token('--surface-hover', 'rgba(238,241,251,0.06)'),
      hair: token('--hairline', 'rgba(238,241,251,0.1)'),
      hairStrong: token('--hairline-strong', 'rgba(238,241,251,0.2)'),
      play: token('--accent-gold', '#f5c542'),
      focus: token('--focus-ring', '#f5c542'),
      ink: token('--bg-primary', '#0b1020'),
      text: token('--text-muted', '#94a1c6'),
      lanes: LANE_TOKENS.map((t) => token(t, '#4cc9f0')),
    };
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

  /* ------------------------------------------------------------ layout */

  function layout(availableWidth) {
    const p = getPattern();
    geo.stepW = Math.max(26, Math.floor(availableWidth / p.steps));
    const rows = rowCount(p);
    geo.rowH = rows > 15 ? 20 : 26;
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

  /* ---------------------------------------------------------- drawing */

  function drawRoll(ctx, pos, now) {
    const p = getPattern();
    const rows = rowCount(p);
    const { stepW, rowH } = geo;
    const W = p.steps * stepW;
    const H = rows * rowH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = tokens.bg;
    ctx.fillRect(0, 0, W, H);

    for (let row = 0; row < rows; row++) {
      const y = (rows - 1 - row) * rowH;
      if (rowIsRoot(p, row)) {
        ctx.fillStyle = tokens.rowAlt;
        ctx.fillRect(0, y, W, rowH);
      }
      ctx.fillStyle = tokens.hair;
      ctx.fillRect(0, y + rowH - 1, W, 1);
    }
    for (let s = 0; s <= p.steps; s++) {
      ctx.fillStyle = s % 16 === 0 ? tokens.hairStrong : s % 4 === 0 ? tokens.hairStrong : tokens.hair;
      ctx.fillRect(s * stepW, 0, s % 4 === 0 ? 1.5 : 1, H);
    }

    if (pos >= 0) {
      ctx.fillStyle = tokens.play;
      ctx.globalAlpha = 0.13;
      ctx.fillRect(Math.floor(pos) * stepW, 0, stepW, H);
      ctx.globalAlpha = 1;
    }

    for (const note of p.notes) {
      const info = getInfo(note.id);
      const x = note.step * stepW + 1;
      const y = (rows - 1 - note.row) * rowH + 1;
      const w = note.len * stepW - 2;
      const h = rowH - 2;
      const t0 = flashes.get(note);
      const age = t0 ? (now - t0) / FLASH_MS : 1;
      const lit = age >= 0 && age < 1 ? 1 - age : 0;
      const hop = lit ? -Math.sin(Math.min(1, age * 2) * Math.PI) * 3 : 0;

      ctx.globalAlpha = [0, 0.6, 0.85, 1][note.vel] || 0.85;
      ctx.fillStyle = info.color;
      roundRect(ctx, x, y, w, h, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (lit) {
        ctx.strokeStyle = '#fff';
        ctx.globalAlpha = lit * 0.9;
        ctx.lineWidth = 2;
        roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = note === selected ? tokens.focus : tokens.ink;
      ctx.lineWidth = note === selected ? 2.5 : 1;
      roundRect(ctx, x, y, w, h, 5);
      ctx.stroke();

      const img = image(note.id);
      const size = h - 2;
      ctx.save();
      roundRect(ctx, x, y, w, h, 5);
      ctx.clip();
      if (img) ctx.drawImage(img, x + 1, y + 1 + hop, size, size);
      ctx.restore();
      if (note.vel === 3) {
        ctx.fillStyle = tokens.ink;
        ctx.fillRect(x + w - 5, y + 3, 2, h - 6);
      }
      if (note.len > 1) {
        ctx.fillStyle = tokens.ink;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x + w - 4, y + 4, 1.5, h - 8);
        ctx.globalAlpha = 1;
      }
    }

    if (document.activeElement === rollCanvas && cursor.zone === 'roll') {
      ctx.strokeStyle = tokens.focus;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cursor.step * stepW + 1, (rows - 1 - cursor.row) * rowH + 1, stepW - 2, rowH - 2);
      ctx.setLineDash([]);
    }
    if (pos >= 0) {
      ctx.fillStyle = tokens.play;
      ctx.fillRect(pos * stepW - 1, 0, 2, H);
    }
  }

  function drawDrums(ctx, pos, now) {
    const p = getPattern();
    const { stepW, laneH } = geo;
    const W = p.steps * stepW;
    const H = p.drums.length * laneH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = tokens.bg;
    ctx.fillRect(0, 0, W, H);

    p.drums.forEach((lane, l) => {
      const y = l * laneH;
      const color = tokens.lanes[l % tokens.lanes.length];
      ctx.fillStyle = tokens.hair;
      ctx.fillRect(0, y + laneH - 1, W, 1);
      for (let s = 0; s < p.steps; s++) {
        const x = s * stepW;
        const vel = Number(lane.steps[s]);
        if (s % 4 === 0) {
          ctx.fillStyle = tokens.rowAlt;
          ctx.fillRect(x, y, stepW * 2 > W ? stepW : stepW, laneH - 1);
        }
        const age = (now - (flashes.get(`${l}:${s}`) || -1e9)) / FLASH_MS;
        const lit = age >= 0 && age < 1 ? 1 - age : 0;
        const pad = vel === 1 ? 9 : 5;
        const w = stepW - pad * 2;
        const h = laneH - pad * 2 - 2;
        ctx.globalAlpha = lane.mute ? 0.25 : 1;
        if (vel) {
          ctx.fillStyle = color;
          ctx.globalAlpha *= vel === 1 ? 0.55 : 1;
          roundRect(ctx, x + pad, y + pad, w, h + (vel === 3 ? 0 : 0), 5);
          ctx.fill();
          if (vel === 3) {
            ctx.strokeStyle = tokens.focus;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          if (lit) {
            ctx.globalAlpha = lit;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            roundRect(ctx, x + pad - 2, y + pad - 2, w + 4, h + 4, 6);
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = tokens.hair;
          ctx.lineWidth = 1;
          roundRect(ctx, x + 5, y + 5, stepW - 10, laneH - 12, 5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    });
    for (let s = 0; s <= p.steps; s += 4) {
      ctx.fillStyle = tokens.hairStrong;
      ctx.fillRect(s * stepW, 0, 1.5, H);
    }
    if (pos >= 0) {
      ctx.fillStyle = tokens.play;
      ctx.globalAlpha = 0.13;
      ctx.fillRect(Math.floor(pos) * stepW, 0, stepW, H);
      ctx.globalAlpha = 1;
      ctx.fillRect(pos * stepW - 1, 0, 2, H);
    }
    if (document.activeElement === drumCanvas && cursor.zone === 'drums') {
      ctx.strokeStyle = tokens.focus;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cursor.step * stepW + 2, cursor.row * laneH + 2, stepW - 4, laneH - 5);
      ctx.setLineDash([]);
    }
  }

  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    for (const ev of engine.drain()) {
      if (reducedMotion.matches) continue;
      if (ev.kind === 'cry') flashes.set(ev.note, now);
      else flashes.set(`${ev.lane}:${ev.step}`, now);
      dirty = true;
    }
    const pos = engine.position();
    const animating = flashes.size > 0;
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
    return `${midiName(rowToMidi(p, note.row))} 第 ${note.step + 1} 步 ${getInfo(note.id).name}`;
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
    engine.audition(note.id, note.row, note.len);
    announce?.(`放上 ${describe(note)}`);
    onEdit('notes');
    return note;
  }

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
      if (endX - cell.x <= EDGE_PX && hit.len >= 1) {
        drag = { mode: 'resize', note: hit };
      } else {
        drag = { mode: 'move', note: hit, dStep: cell.step - hit.step, lastRow: hit.row, moved: false };
        engine.audition(hit.id, hit.row, hit.len);
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
          if (row !== drag.lastRow) { drag.lastRow = row; engine.audition(note.id, row, note.len); }
        }
        drag.moved = true;
        dirty = true;
      }
    }
  });

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
      announce?.(`${midiName(rowToMidi(p, cursor.row))} 第 ${cursor.step + 1} 步${hit ? ` ${getInfo(hit.id).name}` : ''}`);
      dirty = true;
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
    } else if (e.key === 'Tab' && !e.shiftKey) {
      return; // let focus leave the canvas
    } else {
      return;
    }
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
    if (!paint) return;
    const p = getPattern();
    const c = drumAt(e);
    if (c.step === paint.last) return;
    paint.last = c.step;
    setDrum(p, paint.lane, c.step, paint.value);
    dirty = true;
  });
  const endPaint = () => { if (paint) { paint = null; onEdit('drums'); } };
  drumCanvas.addEventListener('pointerup', endPaint);
  drumCanvas.addEventListener('pointercancel', endPaint);
  drumCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  drumCanvas.addEventListener('keydown', (e) => {
    const p = getPattern();
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (move) {
      cursor.zone = 'drums';
      cursor.step = Math.min(p.steps - 1, Math.max(0, cursor.step + move[0]));
      cursor.row = Math.min(p.drums.length - 1, Math.max(0, cursor.row + move[1]));
      announce?.(`${p.drums[cursor.row].name} 第 ${cursor.step + 1} 步 ${['關', '輕', '中', '重音'][Number(p.drums[cursor.row].steps[cursor.step])]}`);
    } else if (e.key === 'Enter') {
      const cur = Number(p.drums[cursor.row].steps[cursor.step]);
      if (e.shiftKey) cycleDrum(p, cursor.row, cursor.step);
      else setDrum(p, cursor.row, cursor.step, cur ? 0 : 2);
      announce?.(`${p.drums[cursor.row].name} 第 ${cursor.step + 1} 步 ${['關', '輕', '中', '重音'][Number(p.drums[cursor.row].steps[cursor.step])]}`);
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

  document.addEventListener('themechange', readTokens);
  readTokens();
  raf = requestAnimationFrame(frame);

  return {
    layout,
    redraw() { dirty = true; },
    select,
    get selected() { return selected; },
    get lastLen() { return lastLen; },
    set lastLen(v) { lastLen = v; },
    clearSelection() { selected = null; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('themechange', readTokens);
    },
  };
}
