/**
 * home-dex-wall.js — all 1,025 species on one canvas, filling up as you catch them
 * ==================================================================================
 * The homepage's centrepiece. One cell per species in dex order. A cell is:
 *
 *   not caught  a flat square tinted with the species' own measured colour at low
 *               strength, so an EMPTY dex is already a mosaic of the real roster
 *   caught      the sprite, on a lit cell, with a bar in its primary type's colour
 *
 * Clicking a cell throws a ball. The chance comes from the species' real capture
 * rate (Pidgey is certain, Mewtwo is not), floored so nothing is a chore:
 * see `catchChance`. A miss shakes the cell and costs nothing.
 *
 * WHY A CANVAS, AND WHY NO IMAGES UNTIL THEY ARE EARNED
 * -----------------------------------------------------
 * 1,025 DOM nodes with 1,025 <img> would load every sprite on arrival. Here the
 * uncaught cells are rectangles from `home_dex.json` (36 KB) and only caught
 * species ever request `assets/images/sprite/<id>.png` — the sprite count a
 * visitor downloads is exactly the number they have collected.
 *
 * THE STATIC LAYER
 * ----------------
 * The 1,025 cells are drawn once onto an offscreen canvas and re-drawn only when
 * something changes (a catch, a resize, a sprite arriving). Each frame composites
 * that layer and adds the moving parts: the scanner row, pop and shake effects,
 * particles.
 *
 * WHY THE SCANNER DOES NOT RUN AT 60 FPS
 * --------------------------------------
 * It is the only part of this page that would animate forever, and it advances
 * one row every `SCAN_ROW_MS` — so a 60 Hz loop repaints a full-width canvas
 * about five times per row for no visible gain. On a laptop that is the single
 * largest cost the homepage can impose while idle, so while the scanner is the
 * only thing moving the loop is a `setTimeout` at the scanner's own step. Effects
 * and particles still use `requestAnimationFrame`, and with neither running the
 * loop stops entirely (off screen, reduced motion, paused between sweeps).
 *
 * INPUT
 * -----
 * Fine pointer (mouse): a click throws at once. Coarse pointer (touch): the first
 * tap SELECTS and shows the cell's info, tapping the same cell again throws,
 * because a 20 px target is too small to commit to blind. Keyboard: arrows move a
 * cursor, Enter or Space throws. `onSelect`/`onResult` let the page announce what
 * happened, so a screen-reader user gets the same news a sighted one sees.
 *
 * Reduced motion: no scanner, no particles, no shake; the state still changes and
 * is still announced.
 */

/** Chance a throw succeeds. Capture rates run 3 (legendaries) to 255 (Rattata);
 *  mapped onto 0.3 .. 1 so the rarest still lands in about three or four tries.
 *
 *  0 is a RATE, not an absence — `Number(rate) || 45` treated a real 0 as a
 *  missing value and gave it the 45 default (0.42 instead of 0.30). The roster
 *  has no 0 today, which is exactly why the bug would survive a data change. */
export function catchChance(rate) {
  const n = Number(rate);
  const r = Math.max(0, Math.min(255, Number.isFinite(n) ? n : 45));
  return Math.min(1, 0.3 + (r / 255) * 0.7);
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const css = (rgb, alpha = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;

/** The gutter between cells. A cell's tappable area is `cell` square; the drawn
 *  square is `cell - GAP`, which is why a 20 px cell measures 18 px of ink. */
const GAP = 2;
/** The floor on a cell's TAPPABLE size, so the phone layout stays hittable even
 *  though it then has to scroll. `layout()` clamps to it twice, because the
 *  second division (spreading the leftover width) can only ever lower the value. */
const MIN_CELL = 20;
const MAX_CELL = 44;
const POP_MS = 520;
const FAIL_MS = 360;
const SCAN_ROW_MS = 90;
const SCAN_PAUSE_MS = 2600;
/** How much of its own colour an uncaught cell shows. 0.3 read as mud at 20 px;
 *  0.42 keeps the mosaic legible while a caught sprite still stands out. */
const TINT = 0.42;
const TINT_TODAY = 0.58;

export function createDexWall(opts) {
  const {
    canvas, data, dex, spriteUrl, onSelect, onHover, onResult, onCry, announce = () => {},
  } = opts;
  const ctx = canvas.getContext('2d');
  const stat = document.createElement('canvas');
  const sctx = stat.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');
  const N = data.p.length;

  let tokens = {};
  let geo = { cols: 1, rows: 1, cell: MIN_CELL, w: 0, h: 0, dpr: 1 };
  let today = { lo: 0, hi: -1 };
  let selected = 0;      // 0 = none, else species id
  let cursor = 1;        // keyboard cursor, species id
  let hoverId = 0;
  let dirty = true;
  let raf = 0;
  let timer = 0;
  let visible = false;
  let destroyed = false;
  let focused = false;

  const sprites = new Map(); // id -> HTMLImageElement once loaded, null while loading, false if it failed
  const effects = [];        // { id, kind: 'pop' | 'fail', t0 }
  const particles = [];      // { x, y, vx, vy, t0, life, size, color }
  let scan = { row: -1, t0: 0, paused: true, until: 0 };

  const idAt = (col, row) => {
    const i = row * geo.cols + col;
    return i >= 0 && i < N && col >= 0 && col < geo.cols ? i + 1 : 0;
  };
  const cellXY = (id) => {
    const i = id - 1;
    return { x: (i % geo.cols) * geo.cell, y: Math.floor(i / geo.cols) * geo.cell };
  };

  /* -------------------------------------------------------------- tokens */

  function readTokens() {
    const cs = getComputedStyle(canvas);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    tokens = {
      bg: v('--hx-bg', '#0b1020'),
      cell: v('--hx-cell', '#161e38'),
      ink: v('--hx-ink', '#eef1fb'),
      gold: v('--hx-gold', '#f5c542'),
      scan: v('--hx-scan', '#4cc9f0'),
      warn: v('--hx-warn', '#ff7a85'),
      types: data.types.map((t) => v(`--hx-t-${t.toLowerCase()}`, '#c9c2ad')),
    };
    tokens.bgRgb = hexToRgb(tokens.bg);
    tokens.cellRgb = hexToRgb(tokens.cell);
    dirty = true;
  }

  /* ------------------------------------------------------------- layout */

  function layout() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width));
    // Aim for the whole dex inside about 78% of the viewport height; on a phone
    // that is impossible at a tappable size, so it floors at MIN_CELL and scrolls.
    const targetH = window.innerHeight * 0.78;
    let cell = Math.floor(Math.sqrt((w * targetH) / N));
    cell = Math.max(MIN_CELL, Math.min(MAX_CELL, cell));
    const cols = Math.max(1, Math.floor(w / cell));
    // Spread the leftover width so the grid meets both edges. `cols` was derived
    // from a cell of at least MIN_CELL, so this can only round down to the same
    // floor; the clamp is here so the invariant survives a future change to that
    // derivation rather than resting on the algebra above it.
    cell = Math.max(MIN_CELL, Math.floor(w / cols));
    const rows = Math.ceil(N / cols);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    geo = { cols, rows, cell, w: cols * cell, h: rows * cell, dpr };
    canvas.width = Math.round(geo.w * dpr);
    canvas.height = Math.round(geo.h * dpr);
    canvas.style.width = `${geo.w}px`;
    canvas.style.height = `${geo.h}px`;
    stat.width = canvas.width;
    stat.height = canvas.height;
    dirty = true;
    schedule();
  }

  /* ------------------------------------------------------------ sprites */

  function ensureSprite(id) {
    if (sprites.has(id)) return sprites.get(id) || null;
    sprites.set(id, null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { sprites.set(id, img); dirty = true; schedule(); };
    img.onerror = () => { sprites.set(id, false); };
    img.src = spriteUrl(id);
    return null;
  }

  /** Load every already-caught sprite, a few per idle slice, so a returning
   *  visitor with 300 catches does not fire 300 requests in one frame. Only the
   *  first paint needs this: a catch made later is drawn by `paintStatic()`,
   *  which asks for its own sprite. */
  function preloadCaught() {
    const queue = dex.ids();
    const step = () => {
      if (destroyed) return;
      for (let i = 0; i < 12 && queue.length; i++) ensureSprite(queue.shift());
      if (queue.length) (window.requestIdleCallback || ((f) => setTimeout(f, 60)))(step);
    };
    step();
  }

  /* ------------------------------------------------------------ drawing */

  function drawCell(c, id, inset = GAP / 2) {
    const { x, y } = cellXY(id);
    const s = geo.cell - inset * 2;
    const row = data.p[id - 1];
    const have = dex.has(id);
    const inToday = id >= today.lo && id <= today.hi;
    if (have) {
      c.fillStyle = tokens.cell;
      c.fillRect(x + inset, y + inset, s, s);
      const img = ensureSprite(id);
      if (img) {
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(img, x + inset + 1, y + inset, s - 2, s - 2);
      }
      c.fillStyle = tokens.types[row[2]] || tokens.ink;
      c.fillRect(x + inset, y + inset + s - 3, s, 3);
    } else {
      // The species' own colour, thinned out. Today's region reads brighter.
      const tint = mix(tokens.bgRgb, hexToRgb(row[1]), inToday ? TINT_TODAY : TINT);
      c.fillStyle = css(tint);
      c.fillRect(x + inset, y + inset, s, s);
    }
  }

  function paintStatic() {
    sctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    sctx.fillStyle = tokens.bg;
    sctx.fillRect(0, 0, geo.w, geo.h);
    for (let id = 1; id <= N; id++) drawCell(sctx, id);
    dirty = false;
  }

  function ring(c, id, color, width = 2, grow = 0) {
    const { x, y } = cellXY(id);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.strokeRect(x + GAP / 2 - grow, y + GAP / 2 - grow, geo.cell - GAP + grow * 2, geo.cell - GAP + grow * 2);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    if (dirty) paintStatic();
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.drawImage(stat, 0, 0, geo.w, geo.h);

    const motion = !reduced.matches;

    // The scanner: a row of light that walks down the dex and brightens what is
    // still missing. It is the "lab" half of the page and it is also the reader's
    // map of what is left. Off for reduced motion and while the wall is off screen.
    if (motion && visible) {
      if (scan.paused && now >= scan.until) { scan = { row: 0, t0: now, paused: false, until: 0 }; }
      if (!scan.paused) {
        const row = Math.floor((now - scan.t0) / SCAN_ROW_MS);
        if (row >= geo.rows) scan = { row: -1, t0: 0, paused: true, until: now + SCAN_PAUSE_MS };
        else {
          scan.row = row;
          const y = row * geo.cell;
          ctx.fillStyle = css(hexToRgb(tokens.scan), 0.1);
          ctx.fillRect(0, y, geo.w, geo.cell);
          for (let col = 0; col < geo.cols; col++) {
            const id = idAt(col, row);
            if (id && !dex.has(id)) {
              const { x } = cellXY(id);
              ctx.fillStyle = css(mix(tokens.bgRgb, hexToRgb(data.p[id - 1][1]), 0.62));
              ctx.fillRect(x + GAP / 2, y + GAP / 2, geo.cell - GAP, geo.cell - GAP);
            }
          }
          ctx.fillStyle = css(hexToRgb(tokens.scan), 0.9);
          ctx.fillRect(0, y + geo.cell - 1, geo.w, 1.5);
        }
      }
    }

    // Selection, hover, keyboard cursor.
    if (hoverId && hoverId !== selected) ring(ctx, hoverId, css(hexToRgb(tokens.ink), 0.55), 1.5);
    if (selected) ring(ctx, selected, tokens.gold, 2.5);
    if (focused && cursor !== selected) ring(ctx, cursor, tokens.ink, 2);

    // Effects.
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const t = (now - e.t0) / (e.kind === 'pop' ? POP_MS : FAIL_MS);
      if (t >= 1) { effects.splice(i, 1); continue; }
      const { x, y } = cellXY(e.id);
      const cx = x + geo.cell / 2;
      const cy = y + geo.cell / 2;
      if (e.kind === 'pop') {
        const k = 1 - Math.pow(1 - t, 3);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ring(ctx, e.id, tokens.gold, 2.5, k * geo.cell * 0.9);
        ctx.restore();
      } else {
        const dx = Math.sin(t * Math.PI * 6) * (1 - t) * 3;
        ctx.fillStyle = css(hexToRgb(tokens.warn), 0.5 * (1 - t));
        ctx.fillRect(x + GAP / 2 + dx, y + GAP / 2, geo.cell - GAP, geo.cell - GAP);
        ctx.fillStyle = tokens.warn;
        ctx.fillRect(cx - 5 + dx, cy - 1, 10, 2);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      const t = (now - q.t0) / q.life;
      if (t >= 1) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x + q.vx * t * 40), Math.round(q.y + q.vy * t * 40 + t * t * 18), q.size, q.size);
    }
    ctx.globalAlpha = 1;

    // Three rates, not one: effects and particles need every frame; the scanner
    // needs one per row; nothing else needs a frame at all.
    if (effects.length || particles.length || dirty) { schedule(); return; }
    if (motion && visible) scheduleIn(scan.paused ? Math.max(16, scan.until - now) : SCAN_ROW_MS);
  }

  function schedule() {
    if (!raf && !timer && !destroyed) raf = requestAnimationFrame(frame);
  }

  /** The scanner's own step. Not rAF: see this file's header. */
  function scheduleIn(ms) {
    if (raf || timer || destroyed) return;
    timer = setTimeout(() => { timer = 0; frame(performance.now()); }, Math.max(16, ms));
  }

  /* -------------------------------------------------------------- actions */

  function sparkle(id) {
    if (reduced.matches) return;
    const { x, y } = cellXY(id);
    const now = performance.now();
    const color = tokens.types[data.p[id - 1][2]] || tokens.gold;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      particles.push({ x: x + geo.cell / 2, y: y + geo.cell / 2, vx: Math.cos(a), vy: Math.sin(a) - 0.4, t0: now, life: 520 + Math.random() * 300, size: 2 + Math.floor(Math.random() * 3), color: i % 3 ? color : tokens.gold });
    }
  }

  /** Throw a ball at `id`. Returns { id, ok, isNew }. */
  function attempt(id) {
    if (!id || id < 1 || id > N) return null;
    onCry?.(id);
    if (dex.has(id)) {
      effects.push({ id, kind: 'pop', t0: performance.now() });
      schedule();
      const res = { id, ok: true, isNew: false };
      onResult?.(res);
      return res;
    }
    const ok = Math.random() < catchChance(data.p[id - 1][4]);
    if (ok) {
      dex.catch(id, 'wall');
      dirty = true;
      effects.push({ id, kind: 'pop', t0: performance.now() });
      sparkle(id);
    } else {
      effects.push({ id, kind: 'fail', t0: performance.now() });
    }
    schedule();
    const res = { id, ok, isNew: ok };
    onResult?.(res);
    return res;
  }

  function select(id) {
    selected = id || 0;
    if (id) cursor = id;
    onSelect?.(selected);
    schedule();
  }

  /* ---------------------------------------------------------------- input */

  function idFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (geo.w / r.width);
    const y = (e.clientY - r.top) * (geo.h / r.height);
    return idAt(Math.floor(x / geo.cell), Math.floor(y / geo.cell));
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const id = idFromEvent(e);
    if (id !== hoverId) { hoverId = id; onHover?.(id, e); schedule(); }
  });
  canvas.addEventListener('pointerleave', () => { hoverId = 0; onHover?.(0); schedule(); });
  canvas.addEventListener('click', (e) => {
    const id = idFromEvent(e);
    if (!id) return;
    cursor = id;
    // Touch: select first, throw on the second tap of the same cell.
    if (coarse.matches && id !== selected) { select(id); return; }
    select(id);
    attempt(id);
  });

  canvas.addEventListener('focus', () => { focused = true; schedule(); });
  canvas.addEventListener('blur', () => { focused = false; schedule(); });
  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: geo.cols, ArrowUp: -geo.cols, PageDown: geo.cols * 5, PageUp: -geo.cols * 5 }[e.key];
    if (step) {
      cursor = Math.max(1, Math.min(N, cursor + step));
      select(cursor);
      e.preventDefault();
    } else if (e.key === 'Home') { select(1); e.preventDefault(); }
    else if (e.key === 'End') { select(N); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { attempt(cursor); e.preventDefault(); }
  });

  // A catch repaints the static layer, which asks for its own sprite. Re-queuing
  // every caught id here would make one catch cost a walk over the whole dex.
  const unsub = dex.onChange(() => { dirty = true; schedule(); });

  const ro = new ResizeObserver(() => layout());
  ro.observe(canvas.parentElement);
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) schedule();
  }, { rootMargin: '80px' });
  io.observe(canvas);
  const onMotion = () => { dirty = true; schedule(); };
  reduced.addEventListener?.('change', onMotion);

  readTokens();
  layout();
  preloadCaught();

  return {
    attempt,
    select,
    /** Highlight a generation's id range as "today's region". */
    setToday(lo, hi) { today = { lo, hi }; dirty = true; schedule(); },
    redraw() { readTokens(); schedule(); },
    get geometry() { return geo; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      unsub();
    },
  };
}
