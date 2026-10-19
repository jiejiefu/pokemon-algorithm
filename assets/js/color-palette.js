/**
 * Colour-palette data access, colour naming, and the two silhouette techniques.
 *
 * The data is precomputed by `scripts/extract_color_palettes_mmcq.py` into
 * `assets/data/color_palettes.json` — 2050 palettes, 6 colours each, written
 * with indent=2 so every hex/share pair is reviewable in a diff. The sibling
 * `scripts/extract_color_palettes.py` transcribes the reference project's Canvas
 * `getImageData` scan and is kept for comparison; it is not what produced this
 * file, and its >5%-share rule is not the rule behind the data here.
 * Nothing here decodes a canvas: the extractor already fixed the sampling, and
 * a runtime version would be a second implementation of a measurement.
 *
 * Three image techniques live in this file because they are easy to confuse and
 * each answers a different question — which image, which element, which effect:
 *
 *   1. The identity card's top-right watermark — OFFICIAL ARTWORK as a CSS
 *      `mask-image` fill. Transcribed from the reference's pokemon-card.tsx:203
 *      (and the same markup in its serialised snapshot). There is no `<img>`
 *      in that card: the mask is the card's only reference to the artwork.
 *   2. The explore card's silhouette — SPRITE, via `brightness: 0` on an
 *      `<img>`. Pixel art, so it is drawn at 1:1 with
 *      `image-rendering: pixelated`; a 475x475 artwork at that size is a
 *      different object and reads as a photograph, not a sprite.
 *   3. The Base Stats backdrop — OFFICIAL ARTWORK, same mask technique as (1).
 *      This one is a new design, not a transcription: the reference has no
 *      silhouette behind its Base Stats, which are plain progress bars.
 *
 * Why the mask rather than a plain background-image: the artwork is a
 * transparent PNG, so `background-image` would paint the full 475x475 square
 * and its own shadow, and the card's rounded corners would have to clip it.
 * Masking fills the artwork's opaque area with a flat palette colour instead,
 * so the silhouette takes the page's palette rather than the artwork's.
 *
 * `mask-image` needs a `-webkit-` twin for Safari, and the site has to work on
 * it — the same reason `backdrop-filter` has an `@supports` fallback in
 * detail.css. A silhouette that silently does not render in one engine is
 * worse than one that renders everywhere, so `silhouetteStyle()` emits both.
 */

import { ASSETS, hexToRgb, badgeStyle, pokemonSlug } from './shared.js';

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/**
 * Load all 2050 palettes. Cached on `window` like every other loader here
 * (loadEvolutionChain, loadMoves), because the explore grid, the generator page
 * and the detail page all ask for it and none of them benefits from a second
 * parse of a quarter-megabyte object.
 *
 * @returns {Promise<Object>} `{ [id]: { n: [[hex, share]], s: [[hex, share]] } }`
 */
export async function loadColorPalettes() {
  if (window.__colorPalettes) return window.__colorPalettes;
  const response = await fetch(ASSETS.palettes);
  if (!response.ok) {
    throw new Error(`Failed to load colour palettes: ${response.status}`);
  }
  window.__colorPalettes = await response.json();
  return window.__colorPalettes;
}

/**
 * The palette rows for one Pokémon.
 *
 * @param {Object} palettes - from loadColorPalettes()
 * @param {number} id
 * @param {boolean} [shiny=false]
 * @returns {Array<[string, number]>} `[hex, share]` in descending share order.
 *   Empty for an id the file does not carry, so a caller can render an empty
 *   state instead of throwing — the roster is 1..1025 and a variant id beyond it
 *   is a link the site itself would not produce, but a stale bookmark can.
 */
export function paletteRows(palettes, id, shiny = false) {
  const entry = palettes?.[String(id)];
  const rows = entry?.[shiny ? 's' : 'n'];
  return Array.isArray(rows) ? rows : [];
}

export function paletteHexes(palettes, id, shiny = false) {
  return paletteRows(palettes, id, shiny).map(([hex]) => hex);
}

/**
 * The colour a card gradient, a silhouette or a shade scale is built from.
 *
 * Falls back through the ranking rather than to a constant, because the
 * fallback only fires for a palette that somehow lost its first entry and a
 * hardcoded brand colour would then be a lie about whose palette this is. The
 * `#cccccc` tail is unreachable for all 2050 palettes; it exists so this
 * returns a string rather than `undefined` for a malformed id.
 */
export function primaryOf(palettes, id, shiny = false) {
  return paletteHexes(palettes, id, shiny)[0] || '#cccccc';
}

/**
 * The secondary gradient stop. Reference cards read `palette[1]`, which for a
 * 5-colour palette is its last colour — so the gradient's far end is the
 * rarest colour in the sprite, not its second most common. That is what the
 * reference does and it is kept: the alternative (interpolating toward primary)
 * invents a colour the sprite does not contain.
 */
export function secondaryOf(palettes, id, shiny = false) {
  const hexes = paletteHexes(palettes, id, shiny);
  return hexes[1] || hexes[0] || '#cccccc';
}

// ---------------------------------------------------------------------------
// Image URLs
// ---------------------------------------------------------------------------

/** The 96x96 front sprite. `shiny` is a real subdirectory, not a filename. */
export function spriteUrl(id, shiny = false) {
  return `${ASSETS.sprites}${shiny ? 'shiny/' : ''}${id}.png`;
}

/** The 475x475 official artwork. `shiny` swaps the parent directory. */
export function artworkUrl(id, shiny = false) {
  return `${shiny ? ASSETS.shiny : ASSETS.images}${id}.png`;
}

// ---------------------------------------------------------------------------
// The two silhouette techniques
// ---------------------------------------------------------------------------

/**
 * Inline style for a masked watermark: a flat `fill` shaped like `url`.
 *
 * @param {string} fill - any CSS colour
 * @param {string} url - the mask image
 * @returns {string} an inline style value
 *
 * Both the standard and the `-webkit-` property are emitted. `mask-size:
 * contain` rather than `cover` because the container is square and the artwork
 * is square, so the two agree; `contain` is the one that stays correct if the
 * container is ever made non-square. `pointer-events: none` is not included
 * here — it belongs on the positioned wrapper, and putting it on this inner box
 * would not stop the wrapper from swallowing clicks over its 40%-width column.
 */
export function silhouetteStyle(fill, url) {
  // SINGLE quotes inside url(), and this is not cosmetic. The returned string
  // is written into a double-quoted `style="…"` attribute, so `url("…")`
  // terminates the attribute at its first double quote: the browser keeps
  // `style="mask-image:url("`, discards the `mask-image` declaration entirely,
  // and the element paints as a solid `fill` rectangle. That is exactly how a
  // masked watermark silently degrades into a black box — it renders, it is
  // just not shaped, and only decoded pixels catch it (do not verify an
  // overlay from computed style).
  //
  // A quoted url() token tolerates spaces and parentheses, so this one form
  // covers the cases the old `/[()\s]/` test was branching for. Only the quote
  // character itself still needs handling, hence the %27.
  const quoted = `url('${url.replace(/'/g, '%27')}')`;
  return [
    `background-color:${fill}`,
    `mask-image:${quoted}`,
    `mask-size:contain`,
    `mask-repeat:no-repeat`,
    `mask-position:center`,
    `-webkit-mask-image:${quoted}`,
    `-webkit-mask-size:contain`,
    `-webkit-mask-repeat:no-repeat`,
    `-webkit-mask-position:center`,
  ].join(';');
}

/**
 * The identity card's markup: gradient body, top-right watermark, content on
 * top. One renderer for all three pages, because the watermark and its
 * z-ordering are the whole technique and a second copy of that markup is how
 * the watermark ends up in front of the name.
 *
 * @param {Object} options - { primary, secondary, artUrl, bodyHtml }
 */
export function identityCardHtml({ primary, secondary, artUrl, bodyHtml }) {
  // {primary}15 / {primary}1a style alpha is expressed as 8-digit hex so the
  // two stops stay one declaration; the reference writes `${primary}15`, which
  // is the same thing and is why the gradient reads as a 8%/6% wash rather than
  // a saturated pair.
  const wash = `${primary}15 0%, ${secondary}10 100%`;
  return `
    <article class="cp-idcard" style="background:linear-gradient(135deg, ${wash})">
      <div class="cp-idcard-wm" aria-hidden="true">
        <div style="${silhouetteStyle(primary, artUrl)}"></div>
      </div>
      <div class="cp-idcard-body">${bodyHtml}</div>
    </article>`;
}

/**
 * The detail page's hero: animated gradient wash, visible official artwork,
 * content on top. Transcribed from the reference's `.animated-gradient`.
 *
 * The two wash stops are written as CSS custom properties rather than
 * interpolated into a `background-image` string because the artwork is a
 * sibling *element* positioned over the gradient — if the gradient were on the
 * wrapper's own background it would sit behind the border and be clipped by
 * `overflow: hidden` in a way that depends on stacking order, and the reference
 * uses a dedicated div for the same reason the identity card does.
 *
 * The alphas are the identity card's `15` / `10`, reused rather than invented a
 * second time. They are tuned for a *palette* fill over a card surface, which
 * is the same surface the hero puts them on, and the hero's largest text is a
 * name — so if these ever need raising, raise them in one place (or here, and
 * then re-measure the card, which has the smaller text). The threshold they
 * would have to clear is 4.5:1 for the 16px labels, and that is a measurement to
 * make, not a number to guess at: a 600-level
 * ramp failed 6 of 9 for exactly this reason.
 *
 * @param {Object} options - { primary, secondary, artUrl, bodyHtml, className }
 */
export function heroHtml({ primary, secondary, artUrl, bodyHtml, className = '' }) {
  return `
    <div class="cp-hero ${className}" style="--cp-wash-1:${primary}15;--cp-wash-2:${secondary}10">
      <div class="cp-hero-grad" aria-hidden="true"></div>
      <div class="cp-hero-content">${bodyHtml}</div>
      <div class="cp-hero-art">
        <img src="${artUrl}" alt="" width="450" height="450" decoding="async">
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// The two palette displays
// ---------------------------------------------------------------------------

/**
 * Columns for the full palette grid, transcribed from the reference's
 * `PokemonPaletteDisplay`: 4 for a 4-colour palette, 3 for everything else —
 * which the reference relies on to land 5 as 3+2 and 6 as 3+3. We store 5..11,
 * so 7 is 3+3+1 and 11 is 3+3+3+2, leaving a half-width gap in the last row at
 * even counts. That gap is NOT patched with a `:only-child { grid-column: 1/-1 }`
 * rule the way generations.html patches its 新屬性 hole:
 * that fix exists because a *missing* card is a hole, whereas here the last row
 * is genuinely partial and a full-width last cell would read as a 4-wide
 * palette that happens to end there.
 *
 * @param {number} n
 * @returns {number}
 */
export function paletteColumns(n) {
  return n === 4 ? 4 : 3;
}

/**
 * The full palette: one equal cell per colour, hex and share, click to copy.
 *
 * The cells are EQUAL, which is the part that looks like a missed opportunity
 * and is not. We have the percentages and proportional widths would encode them
 * twice over, but a 5-colour palette can hold a 6% swatch: at 29/22/18/15/6
 * the last cell becomes 4% of a 1180px row, roughly 47px, which cannot hold a
 * 6-digit hex and loses its own identity. Equal cells plus the share as text
 * keeps every colour readable, and the share is the precise channel.
 *
 * @param {Array<[string, number]>} rows
 * @param {Object} [options] - { id, variant, format }
 * @returns {string}
 */
export function paletteGridHtml(rows, options = {}) {
  if (!rows.length) return '<p class="cp-empty">此寶可夢沒有色盤資料</p>';
  // `format` is the NOTATION the cells speak, and it has to reach the copy
  // payload as well as the label. The click handler is delegated and reads
  // `data-cp-copy`, so writing the converted value into that attribute is what
  // makes copy follow the display — reference behaviour, at
  // pokemon-palette-display.tsx:105 (`handleCopy(colorValue)`) feeding on
  // :159 (`colorValue = convertColor(color, colorFormat)`). Copying the raw hex
  // while RGB is on screen would be the one thing a format switch must not do.
  //
  // It also reaches `title` and `aria-label`: a swatch whose pixels say
  // `rgb(76, 175, 80)` but whose accessible name says `#4CAF50` tells a screen
  // reader something different from what the sighted user is reading.
  //
  // The trailing copy glyph is a SPAN inside the button, not a second button,
  // unlike pokemon-palette-display.tsx:186 which nests one. Two reasons: a
  // <button> inside a <button> is invalid HTML and the inner control is then
  // unreachable by keyboard anyway, whereas here the cell is already the
  // control, its accessible name already reads 複製 <value>, and clicking the
  // glyph copies exactly like clicking the rest of the cell. One focus stop,
  // one name, no duplicated hit target — `aria-hidden` because the name is
  // already on the button.
  //
  // Defaults to 'hex' so the callers this change is not touching
  // (colors-generator.html:684 and colors-explore.html:257) render
  // byte-identically.
  const format = options.format || 'hex';
  const cols = paletteColumns(rows.length);
  const cells = rows
    .map(([hex, share]) => {
      const shareText = formatShare(share);
      const text = formatHex(hex, format);
      const tip = `${text} · 占比 ${shareText}`;
      return `<button type="button" class="cp-cell" style="${swatchStyle(hex)}" title="${tip}" data-cp-copy="${text}" aria-label="複製 ${tip}">
              <span class="cp-cell-hex">${text}</span>
              <span class="cp-cell-copy" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              </span>
            </button>`;
    })
    .join('');
  const dataAttrs = options.id
    ? ` data-cp-id="${options.id}" data-cp-variant="${options.variant ?? 'n'}"`
    : '';
  return `<div class="cp-palette" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr))"${dataAttrs} role="group" aria-label="色盤，共 ${rows.length} 色">${cells}</div>`;
}

/**
 * How many colours a compact strip draws, and whether the remainder is announced.
 * A card is ~190px wide and 34px tall, so 11 cells would be 17px each; the strip
 * caps at 5.
 *
 * `+N` is a per-call-site decision rather than a constant, because the consumers
 * want different things. The two single-Pokémon pages pass no options and keep
 * the chip — their strip is the full width of an identity card, and there the
 * sixth colour is worth pointing at. `colors-explore.html` opts out and draws 5
 * bare cells, since it renders 1,025 cards at once and the chip costs a cell in
 * every one of them.
 *
 * Either way the count reaches the aria-label ("共 6 色，主要 5 色"), so dropping
 * the chip does not remove from a screen-reader user the information the chip was
 * carrying. What it does remove is the visual hint, and Bulbasaur is the case to
 * remember: its sixth colour is the red `#ac0031`, invisible on the explore grid.
 */
export const VISIBLE_STRIP_COLORS = 5;

/**
 * The compact strip. NOT clickable and NOT a link: it lives inside a card that
 * is itself an `<a>`, and a nested button inside a link is invalid HTML and
 * makes the activation target ambiguous.
 *
 * @param {Array<[string, number]>} rows
 * @param {Object} [options] - { limit, showRemainder, format }
 * @returns {string}
 */
export function paletteStripHtml(rows, options = {}) {
  const limit = options.limit ?? VISIBLE_STRIP_COLORS;
  const showRemainder = options.showRemainder ?? true;
  // Same notation rule as the grid, and for the same reason: the strip's
  // `title` is a tooltip reading the SAME value as the swatch it describes, so
  // leaving it hex would put two different answers to "what colour is this" in
  // one 34px-tall element.
  const format = options.format || 'hex';
  if (!rows.length) return '';
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  const segments = shown
    .map(
      ([hex, share]) =>
        `<span class="cp-seg" style="${swatchStyle(hex)}" title="${formatHex(hex, format)} · ${formatShare(share)}"><span class="cp-seg-hex">${formatHex(hex, format)}</span></span>`
    )
    .join('');
  const more =
    showRemainder && rest > 0 ? `<span class="cp-seg-more">+${rest}</span>` : '';
  return `<div class="cp-strip" role="img" aria-label="色盤，共 ${rows.length} 色，主要 ${shown.length} 色">${segments}${more}</div>`;
}

/**
 * A share as a compact percentage. `28.95` reads as `29%` at cell width and
 * `10.0` as `10%`; a fixed 1 dp would print `10.0%` where the data has no
 * second decimal, so the trailing `.0` is dropped rather than rounded away.
 */
export function formatShare(share) {
  if (!Number.isFinite(share)) return '';
  return `${Math.round(share * 10) / 10}%`;
}

// ---------------------------------------------------------------------------
// Colour naming
// ---------------------------------------------------------------------------

/** @returns {{h:number,s:number,l:number}|null} h in degrees, s/l in 0..100 */
export function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r255, g255, b255] = rgb.map(v => v / 255);
  const max = Math.max(r255, g255, b255);
  const min = Math.min(r255, g255, b255);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    if (max === r255) h = ((g255 - b255) / d) % 6;
    else if (max === g255) h = (b255 - r255) / d + 2;
    else h = (r255 - g255) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = ln - c / 2;
  return `#${rgb
    .map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hueFamily(h) {
  if (h < 12 || h >= 345) return '紅';
  if (h < 25) return '紅橙';
  if (h < 45) return '橙';
  if (h < 60) return '琥珀';
  if (h < 72) return '黃';
  if (h < 90) return '黃綠';
  if (h < 150) return '綠';
  if (h < 175) return '青綠';
  if (h < 195) return '青';
  if (h < 230) return '藍';
  if (h < 260) return '靛';
  if (h < 285) return '紫';
  if (h < 315) return '洋紅';
  return '粉';
}

/**
 * Chroma — the widest gap between the three channels, 0..255. This is the
 * "how much colour is there at all" measure, and it is deliberately NOT HSL's
 * `s`: saturation is a RATIO against the lightness, so a near-white like
 * #fffff6 measures s = 100% while being three channels apart. Chroma is
 * absolute, so #e6e6ee measures 8 and reads as the grey it looks like.
 *
 * Every colour name below is gated on this, because a hue name is a claim that
 * a channel dominates — and on an 8/255 spread no channel dominates. Before
 * the gate, describeHex() named the pure grey #6a6a6a 紅: `max === min` leaves
 * h at 0, which fell straight into the first hue bucket. 1,510 of the corpus's
 * 12,297 swatches (12.3%) got a chromatic name they visibly do not have.
 */
export function chroma(hex) {
  const rgb = hexToRgbArray(hex);
  if (!rgb) return 0;
  return Math.max(...rgb) - Math.min(...rgb);
}

/** Below this chroma a swatch is a grey, whatever its hue happens to be.
 *  16 sits in the gap in the corpus distribution: p15 = 8, p20 = 16, p25 = 24,
 *  so the low-chroma cluster and the coloured cluster are separated rather than
 *  cut through. Of 709 distinct hexes under it, only 24 have HSL s >= 40 and
 *  every one of those is a near-white like #fffff6 — nothing visibly tinted is
 *  demoted. */
export const NEUTRAL_CHROMA = 16;

/** The five greys, chosen by lightness. 灰白 is the light one and is not 白色:
 *  it is what #e6e6ee is, and calling it white would claim it is #ffffff. */
export function neutralName(hex) {
  const hsl = hexToHsl(hex);
  const l = hsl ? hsl.l / 100 : 0;
  if (l < 0.08) return '黑';
  if (l > 0.93) return '白';
  if (l < 0.22) return '深灰';
  if (l < 0.45) return '灰色';
  if (l < 0.72) return '淺灰';
  return '灰白';
}

/** True when a hex carries no usable hue — the gate the three namers share. */
export function isNeutral(hex) {
  return chroma(hex) < NEUTRAL_CHROMA;
}

/**
 * Human-readable Chinese name for a hex color.
 * Chroma first (is it a grey?), then HSL hue + lightness for a descriptive label.
 * @param {string} hex - e.g. '#399494'
 * @returns {string} e.g. '深青'
 */
export function describeHex(hex) {
  if (!hex || typeof hex !== 'string') return '色彩';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '色彩';
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  /* The grey branch. `l > 0.93` is unreachable behind it for any hex below the
     chroma gate unless it is within 16 of pure white — at #f2f2f2, l is 0.949
     and it correctly stays 白. */
  if (isNeutral(hex)) return neutralName(hex);
  const prefix = l < 0.3 ? '深' : l > 0.75 ? '淺' : '';
  if (l < 0.08) return '黑';
  if (l > 0.93) return '白';
  const hueNames = [
    [15, '紅'], [40, '橙'], [65, '黃'], [150, '綠'],
    [195, '青'], [260, '藍'], [290, '紫'], [340, '粉紅'],
  ];
  for (const [limit, name] of hueNames) {
    if (h < limit) return prefix + name;
  }
  return prefix + '紅';
}

/** warm / cool / neutral, for the mood line under a palette.
 *  Gated on the same chroma the two namers use, so a swatch described as 灰白
 *  is not simultaneously described as 冷色. The `s < 12` test below still earns
 *  its place: chroma is absolute, so a mid-lightness desaturated colour like
 *  #7a8a7a has chroma 16 but reads far less warm than its hue suggests. */
export function colorTemperature(hex) {
  if (isNeutral(hex)) return 'neutral';
  const hsl = hexToHsl(hex);
  if (!hsl || hsl.s < 12) return 'neutral';
  const { h } = hsl;
  if ((h >= 0 && h < 70) || h >= 300) return 'warm';
  if (h >= 170 && h < 280) return 'cool';
  return 'neutral';
}

export const TEMPERATURE_ZH = { warm: '暖色', cool: '冷色', neutral: '中性' };

/** 將 hex 轉成 [r,g,b] 0-255 */
function hexToRgbArray(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

/** 歐幾里得距離（RGB） */
function rgbDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 常用顏色名稱對照表（100種，保留常用色，含中英文）
 */
export const CHINESE_COLOR_NAMES = [
  // 黑白灰 (10)
  { zh: '黑色', en: 'Black', hex: '#000000' },
  { zh: '墨黑', en: 'Dark Charcoal', hex: '#111111' },
  { zh: '深灰', en: 'Dim Gray', hex: '#696969' },
  { zh: '灰色', en: 'Gray', hex: '#808080' },
  { zh: '淺灰', en: 'Light Gray', hex: '#D3D3D3' },
  { zh: '銀色', en: 'Silver', hex: '#C0C0C0' },
  { zh: '白色', en: 'White', hex: '#FFFFFF' },
  { zh: '雪白', en: 'Snow', hex: '#FFFAFA' },
  { zh: '象牙白', en: 'Ivory', hex: '#FFFFF0' },
  { zh: '米白', en: 'Beige', hex: '#F5F5DC' },

  // 紅粉系 (16)
  { zh: '紅色', en: 'Red', hex: '#FF0000' },
  { zh: '猩紅', en: 'Scarlet', hex: '#FF2400' },
  { zh: '朱紅', en: 'Vermilion', hex: '#FF4D00' },
  { zh: '深紅', en: 'Dark Red', hex: '#8B0000' },
  { zh: '酒紅', en: 'Burgundy', hex: '#800020' },
  { zh: '磚紅', en: 'Firebrick', hex: '#B22222' },
  { zh: '緋紅', en: 'Crimson', hex: '#DC143C' },
  { zh: '洋紅', en: 'Magenta', hex: '#FF00FF' },
  { zh: '桃紅', en: 'Hot Pink', hex: '#FF69B4' },
  { zh: '深桃紅', en: 'Deep Pink', hex: '#FF1493' },
  { zh: '粉紅', en: 'Pink', hex: '#FFC0CB' },
  { zh: '淺粉紅', en: 'Light Pink', hex: '#FFB6C1' },
  { zh: '櫻桃紅', en: 'Cherry Red', hex: '#DE3163' },
  { zh: '珊瑚紅', en: 'Coral', hex: '#FF7F50' },
  { zh: '鮭魚色', en: 'Salmon', hex: '#FA8072' },
  { zh: '亮珊瑚', en: 'Light Coral', hex: '#F08080' },

  // 橙黃系 (12)
  { zh: '橙色', en: 'Orange', hex: '#FFA500' },
  { zh: '暗橙', en: 'Dark Orange', hex: '#FF8C00' },
  { zh: '橘紅', en: 'Orange Red', hex: '#FF4500' },
  { zh: '橘色', en: 'Tangerine', hex: '#FF6600' },
  { zh: '琥珀色', en: 'Amber', hex: '#FFBF00' },
  { zh: '金色', en: 'Gold', hex: '#FFD700' },
  { zh: '黃色', en: 'Yellow', hex: '#FFFF00' },
  { zh: '淺黃色', en: 'Light Yellow', hex: '#FFFFE0' },
  { zh: '檸檬黃', en: 'Lemon Chiffon', hex: '#FFFACD' },
  { zh: '香檳黃', en: 'Champagne', hex: '#FFFF99' },
  { zh: '鵝黃', en: 'Canary Yellow', hex: '#FFF143' },
  { zh: '芥末黃', en: 'Mustard Yellow', hex: '#CCCC4D' },

  // 綠系 (18)
  { zh: '檸檬綠', en: 'Chartreuse', hex: '#CCFF00' },
  { zh: '黃綠色', en: 'Yellow Green', hex: '#9ACD32' },
  { zh: '草綠色', en: 'Lawn Green', hex: '#7CFC00' },
  { zh: '嫩綠', en: 'Tender Green', hex: '#BDDD22' },
  { zh: '蘋果綠', en: 'Apple Green', hex: '#8CE600' },
  { zh: '綠色', en: 'Lime', hex: '#00FF00' },
  { zh: '淺綠', en: 'Light Green', hex: '#90EE90' },
  { zh: '淡綠色', en: 'Pale Green', hex: '#98FB98' },
  { zh: '春綠', en: 'Spring Green', hex: '#00FF7F' },
  { zh: '海綠', en: 'Sea Green', hex: '#2E8B57' },
  { zh: '森林綠', en: 'Forest Green', hex: '#228B22' },
  { zh: '深綠', en: 'Dark Green', hex: '#006400' },
  { zh: '墨綠', en: 'Dark Olive Green', hex: '#556B2F' },
  { zh: '橄欖色', en: 'Olive', hex: '#808000' },
  { zh: '橄欖綠', en: 'Olive Drab', hex: '#6B8E23' },
  { zh: '孔雀綠', en: 'Peacock Green', hex: '#00A15C' },
  { zh: '翡翠綠', en: 'Emerald Green', hex: '#50C878' },
  { zh: '薄荷綠', en: 'Mint Green', hex: '#22C32E' },

  // 藍青系 (24)
  { zh: '青色', en: 'Cyan', hex: '#00FFFF' },
  { zh: '淺青色', en: 'Light Cyan', hex: '#E0FFFF' },
  { zh: '淺藍綠', en: 'Light Sea Green', hex: '#20B2AA' },
  { zh: '青綠色', en: 'Turquoise', hex: '#40E0D0' },
  { zh: '土耳其藍', en: 'Medium Turquoise', hex: '#48D1CC' },
  { zh: '深青色', en: 'Dark Cyan', hex: '#008B8B' },
  { zh: '水鴨色', en: 'Teal', hex: '#008080' },
  { zh: '藍綠色', en: 'Aquamarine', hex: '#7FFFD4' },
  { zh: '水色', en: 'Aqua', hex: '#AFDFE4' },
  { zh: '天空藍', en: 'Sky Blue', hex: '#87CEEB' },
  { zh: '淺天空藍', en: 'Light Sky Blue', hex: '#87CEFA' },
  { zh: '深天藍', en: 'Deep Sky Blue', hex: '#00BFFF' },
  { zh: '矢車菊藍', en: 'Cornflower Blue', hex: '#6495ED' },
  { zh: '鋼藍色', en: 'Steel Blue', hex: '#4682B4' },
  { zh: '淺鋼藍', en: 'Light Steel Blue', hex: '#B0C4DE' },
  { zh: '淺藍色', en: 'Light Blue', hex: '#ADD8E6' },
  { zh: '寶藍色', en: 'Royal Blue', hex: '#4169E1' },
  { zh: '藍色', en: 'Blue', hex: '#0000FF' },
  { zh: '深藍色', en: 'Dark Blue', hex: '#00008B' },
  { zh: '藏青色', en: 'Navy Blue', hex: '#000080' },
  { zh: '午夜藍', en: 'Midnight Blue', hex: '#191970' },
  { zh: '普魯士藍', en: 'Prussian Blue', hex: '#003153' },
  { zh: '蔚藍色', en: 'Azure', hex: '#007FFF' },
  { zh: '群青色', en: 'Ultramarine', hex: '#4D9DE0' },

  // 紫系 (12)
  { zh: '薰衣草紫', en: 'Lavender', hex: '#E6E6FA' },
  { zh: '淡紫色', en: 'Thistle', hex: '#D8BFD8' },
  { zh: '李子色', en: 'Plum', hex: '#DDA0DD' },
  { zh: '紫羅蘭', en: 'Violet', hex: '#EE82EE' },
  { zh: '蘭花色', en: 'Orchid', hex: '#DA70D6' },
  { zh: '中紫色', en: 'Medium Purple', hex: '#9370DB' },
  { zh: '暗紫色', en: 'Dark Violet', hex: '#9400D3' },
  { zh: '靛藍色', en: 'Indigo', hex: '#4B0082' },
  { zh: '藍紫色', en: 'Blue Violet', hex: '#8A2BE2' },
  { zh: '紫色', en: 'Purple', hex: '#800080' },
  { zh: '深紫色', en: 'Dark Purple', hex: '#660066' },
  { zh: '紫丁香', en: 'Lilac', hex: '#B399FF' },

  // 棕褐系 (8)
  { zh: '棕色', en: 'Brown', hex: '#A52A2A' },
  { zh: '馬鞍棕', en: 'Saddle Brown', hex: '#8B4513' },
  { zh: '巧克力色', en: 'Chocolate', hex: '#D2691E' },
  { zh: '黃褐色', en: 'Burlywood', hex: '#DEB887' },
  { zh: '小麥色', en: 'Wheat', hex: '#F5DEB3' },
  { zh: '駝色', en: 'Tan', hex: '#D2B48C' },
  { zh: '卡其色', en: 'Khaki', hex: '#F0E68C' },
  { zh: '咖啡色', en: 'Coffee', hex: '#4D1F00' },
];

/** 找出最接近的中文顏色名稱（RGB 歐幾里得距離）
 *
 *  The nearest-neighbour search is only over the table's CHROMATIC entries. It
 *  is gated on chroma for the same reason describeHex() is: nearest-in-RGB will
 *  happily match a grey to a tinted name, because a table entry 8 away in one
 *  channel beats every 淺灰 that is 20 away in all three. Measured on the
 *  corpus, 351 of the 2,387 sub-16-chroma swatches got a chromatic name that
 *  way — #414141 came back 墨綠. */
export function findClosestChineseColorName(hex) {
  const rgb = hexToRgbArray(hex);
  if (!rgb) return null;
  if (isNeutral(hex)) return neutralName(hex);
  const best = nearestTableEntry(rgb);
  if (best.dist > 60) {
    const fallback = describeHex(hex);
    if (fallback && fallback !== '色彩') return fallback;
  }
  return best.entry.zh;
}

/** Nearest table entry by RGB Euclidean distance, plus the distance itself so
 *  callers can apply their own "too far, describe it instead" threshold. */
function nearestTableEntry(rgb) {
  let best = CHINESE_COLOR_NAMES[0];
  let bestDist = rgbDistance(rgb, hexToRgbArray(best.hex));
  for (let i = 1; i < CHINESE_COLOR_NAMES.length; i++) {
    const c = CHINESE_COLOR_NAMES[i];
    const crgb = hexToRgbArray(c.hex);
    if (!crgb) continue;
    const d = rgbDistance(rgb, crgb);
    if (d < bestDist - 1e-6) {
      bestDist = d;
      best = c;
      if (bestDist < 5) break;
    }
  }
  return { entry: best, dist: bestDist };
}

const colorNameCache = new Map();

/** 取得中文顏色名稱（優先常用表，次用 describeHex） */
export function chineseColorName(hex) {
  const key = (hex || '').trim().toUpperCase();
  if (colorNameCache.has(`zh:${key}`)) return colorNameCache.get(`zh:${key}`);
  const name = findClosestChineseColorName(hex);
  const result = name || describeHex(hex) || '色彩';
  colorNameCache.set(`zh:${key}`, result);
  return result;
}

/** 取得中文+英文顏色名稱（格式：中文 英文 或僅中文） */
export function chineseColorNameWithEn(hex, sep = ' ') {
  const key = (hex || '').trim().toUpperCase();
  const cacheKey = `zh-en:${key}:${sep}`;
  if (colorNameCache.has(cacheKey)) return colorNameCache.get(cacheKey);
  const rgb = hexToRgbArray(hex);
  if (!rgb) {
    const fallback = describeHex(hex);
    const result = fallback || '色彩';
    colorNameCache.set(cacheKey, result);
    return result;
  }
  /* Gated like findClosestChineseColorName, and with the zh-only name as its own
     answer: this variant is "中文 英文", and the greys have no English entry
     worth pairing — 灰白 Lavender would assert the thing being corrected. */
  if (isNeutral(hex)) {
    const result = neutralName(hex);
    colorNameCache.set(cacheKey, result);
    return result;
  }
  const best = nearestTableEntry(rgb);
  if (best.dist > 60) {
    const fallback = describeHex(hex);
    if (fallback && fallback !== '色彩') {
      colorNameCache.set(cacheKey, fallback);
      return fallback;
    }
  }
  const result = best.entry.en ? `${best.entry.zh}${sep}${best.entry.en}` : best.entry.zh;
  colorNameCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Colour notation
// ---------------------------------------------------------------------------

/**
 * A hex in the notation the reader picked: `hex` / `rgb` / `hsl`.
 *
 * Transcribed from the reference's `convertColor` in
 * `pokemon-palette-display.tsx:20`, which is the same `hex → hsl` math as
 * `hexToHsl()` here, written out a second time inside the component. Reusing
 * ours is the better half of the transcription, but not all of it: the
 * reference rounds h/s/l to integers before printing, and that rounding is
 * visible in the string a reader might paste into another tool, so this goes
 * through the same private `roundedHsl()` the theme port uses.
 *
 * The rounding is why this is not just `hexToHsl()` inline, and the reason it
 * must not be folded into `hexToHsl()` either. `hexToHsl()` is exported and
 * returns floats on purpose — the palette strip and the shade scale read the
 * exact values, and rounding there would move the scale's anchor by a step on
 * the colours nearest a target boundary. So the float form stays exported and
 * exact, and the display form rounds. Two functions, one algorithm, no
 * duplicated arithmetic.
 *
 * An unparseable hex returns `''` rather than a `NaN`-bearing string: these
 * values go straight into a `<code>` the user can copy, and `rgb(NaN, 0, 0)` is
 * a string that looks like a colour and is not one.
 */
export function formatHex(hex, format = 'hex') {
  if (format === 'hex' || !hex) return hex || '';
  const rgb = hexToRgb(hex);
  if (!rgb) return fallbackHex(hex, format);
  if (format === 'rgb') return `rgb(${rgb.join(', ')})`;
  const hsl = roundedHsl(hex);
  if (!hsl) return fallbackHex(hex, format);
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

/**
 * The raw hex, for a notation that could not be produced.
 *
 * `formatHex()` returned `''` for anything `hexToRgb()` could not read, and
 * before this was reachable from a swatch that was merely untidy. It is not
 * untidy now: the grid writes the formatted value into BOTH the label and
 * `data-cp-copy`, so an unconvertible colour renders a blank cell and copies an
 * EMPTY STRING. An empty string is the one clipboard result the user cannot
 * notice they got wrong — there is nothing to look at and nothing to paste.
 * Showing the hex is the smallest failure that stays truthful.
 *
 * Every hex in `color_palettes.json` is 6-digit (12,297 of them, checked), so
 * this is a guard against a future caller rather than a fix for today. `#FFF`
 * is the case that reaches it: 3-digit shorthand, which `hexToRgb()` rejects.
 */
function fallbackHex(hex, format) {
  console.warn(`formatHex: cannot express ${hex} as ${format}; showing the hex instead`);
  return hex;
}

/** The three notations, in the order the reference's `<Select>` lists them. */
export const HEX_FORMATS = ['hex', 'rgb', 'hsl'];

// ---------------------------------------------------------------------------
// Related Pokémon
// ---------------------------------------------------------------------------

/**
 * The species sharing this one's evolutionary line, in stage order.
 *
 * This exists to fill the palette page's "Forms / Related" tab, and the
 * interesting part is what it does NOT fetch. The natural move is
 * `evolution_chains.json`, which is 386 KB and already loaded on `detail.html`
 * — but it is not needed, and it would be the wrong source even if it were
 * cheap. `main_line` there interleaves form ids with species: 113 of its 541
 * chains carry at least one id above 1025, and a Mega Venusaur is a member of
 * its chain while owning no palette at all. `color_palettes.json` has exactly
 * 1025 keys, ids 1..1025, so every form id is an unrenderable row — the panel
 * would be full of links to `color.html?slug=venusaur-mega`, which 404s into
 * the site's own dead-link class.
 *
 * So the group is derived from `evolution_chain_id`, which every one of the 1025
 * records already carries, and that is exactly `main_line` restricted to real
 * species. Measured over all 541 chains against `evolution_chains.json`:
 *
 *   - 0 chains where the group contains a member absent from `main_line`
 *   - 113 chains differ, and every one differs only by form ids
 *   - 0 of 541 where stage order and id order disagree
 *
 * The third line is why this sorts by `id` rather than fetching a stage number.
 * It is not an assumption that ids happen to run forwards — it is measured
 * over the whole file, and the 9-member chain (Eevee's) is the one that would
 * have exposed it: Espeon (#196) and Umbreon (#197) branch off Eevean (#133)
 * before the Gen-4 members Leafeon (#470) and Glaceon (#471), so stage order
 * and id order agree there by construction and it is a *weak* probe, not a
 * strong one. The reason it is still worth naming is that it is the only chain
 * with nine members, so a regression that collapsed the branch structure would
 * show up here first.
 *
 * Returns `[]` for a species with no `evolution_chain_id` rather than guessing
 * at a fallback; every record in the file has one, and a silent same-type
 * fallback would put a different set of Pokémon behind the label depending on
 * which record lost the field.
 */
export function relatedPokemon(pokemon, allPokemon) {
  const chainId = pokemon?.evolution_chain_id;
  if (chainId == null || !Array.isArray(allPokemon)) return [];
  return allPokemon
    .filter(p => p.evolution_chain_id === chainId)
    .sort((a, b) => a.id - b.id)
    .map(p => ({
      id: p.id,
      slug: pokemonSlug(p),
      nameZh: p.names?.zh ?? p.names?.en ?? `#${p.id}`,
      nameEn: p.names?.en ?? '',
      url: paletteUrl(p),
      sprite: spriteUrl(p),
      isCurrent: p.id === pokemon.id,
    }));
}

// ---------------------------------------------------------------------------
// Shade scale
// ---------------------------------------------------------------------------

/**
 * Lightness targets and saturation multipliers per step, transcribed from the
 * reference's theme-export.ts. The lighter steps drop saturation so they read
 * as a tint rather than a washed-out copy — that is why step 50 is 0.55 and
 * not 1.0, and why raising these multipliers to "keep the colour" would
 * flatten the whole ramp.
 */
const SHADE_TARGETS = [
  { step: '50', l: 97, sScale: 0.55 },
  { step: '100', l: 93, sScale: 0.65 },
  { step: '200', l: 86, sScale: 0.75 },
  { step: '300', l: 77, sScale: 0.85 },
  { step: '400', l: 66, sScale: 0.95 },
  { step: '500', l: 57, sScale: 1.0 },
  { step: '600', l: 48, sScale: 1.0 },
  { step: '700', l: 39, sScale: 0.95 },
  { step: '800', l: 30, sScale: 0.85 },
  { step: '900', l: 22, sScale: 0.75 },
  { step: '950', l: 14, sScale: 0.6 },
];

export const SHADE_STEPS = SHADE_TARGETS.map(t => t.step);

/**
 * An 11-step scale from one hex, with the seed preserved verbatim at the step
 * nearest its own lightness.
 *
 * The anchor is the point of the function: a scale that re-derives all eleven
 * steps shows the user a row that does not contain their colour, because a
 * 45%-lightness teal lands between the 400 (66) and 500 (57) targets and
 * rounds to a different hex. So one step is the input, unchanged, and it is
 * marked for the UI.
 *
 * @returns {{scale: Record<string,string>, anchor: string}}
 */
export function generateTailwindScale(seedHex) {
  const hsl = hexToHsl(seedHex);
  if (!hsl) {
    const grey = Object.fromEntries(SHADE_STEPS.map(s => [s, '#cccccc']));
    return { scale: grey, anchor: '500' };
  }
  const { h, s } = hsl;

  let anchor = SHADE_TARGETS[0].step;
  let best = Infinity;
  for (const target of SHADE_TARGETS) {
    const delta = Math.abs(target.l - hsl.l);
    if (delta < best) {
      best = delta;
      anchor = target.step;
    }
  }

  const scale = {};
  for (const target of SHADE_TARGETS) {
    scale[target.step] =
      target.step === anchor
        ? `#${seedHex.replace('#', '').toLowerCase()}`
        : hslToHex({
          h,
          s: Math.max(0, Math.min(100, s * target.sScale)),
          l: target.l,
        });
  }
  return { scale, anchor };
}

/** The anchor index within SHADE_STEPS, for a "主要" marker. */
export function anchorIndex(anchorStep) {
  const i = SHADE_STEPS.indexOf(anchorStep);
  return i < 0 ? 5 : i;
}

// ---------------------------------------------------------------------------
// Lookup by slug
// ---------------------------------------------------------------------------

/**
 * Find a Pokémon by `?slug=`, falling back to `?id=`.
 *
 * The `?id=` fallback is not redundant, but its original reason no longer
 * applies. It used to be there because `pokemonSlug()` stripped `Nidoran♀` /
 * `Nidoran♂` to the same `nidoran` and `find()` answered 尼多蘭 for both, so id
 * 32 was unreachable by slug; that collision is fixed. The fallback
 * stays for the legacy numeric form that `detail.html` still accepts, so the two
 * pages accept exactly the same set of addresses.
 */
export function findBySlug(pokemon, slug, id) {
  if (id != null && String(id) !== '') {
    const byId = pokemon.find(p => String(p.id) === String(id));
    if (byId) return byId;
  }
  if (!slug) return null;
  return pokemon.find(p => pokemonSlug(p) === slug) || null;
}

/**
 * The link to a Pokémon's own colour page.
 *
 * Deliberately NOT derived from `pokemonDetailUrl()` by string-replacing
 * `detail.html` — that reads as a shortcut and breaks the moment either URL
 * gains a second path segment. It is the same `?slug=` shape as the detail
 * page on purpose: the clean-URL contract is a two-line change in
 * detail.html + 404.html, and inheriting it accidentally here would mean
 * touching those for a page that never asked for it.
 *
 * `?slug=` and not the clean `color/<slug>` for the same reason: the clean form
 * is only resolvable on GitHub Pages, and every local workflow breaks on it.
 */
export function paletteUrl(pokemon) {
  return `color.html?slug=${encodeURIComponent(pokemonSlug(pokemon))}`;
}

/**
 * The inline `style` for an element whose background IS a palette colour:
 * a readable foreground plus an AA-correct fill, as one pair.
 *
 * Every swatch on every colour page goes through here — palette cells, shade
 * cells, strip segments. That is the point of the indirection: the alternative
 * is three pages each pairing a fill with a foreground chosen separately, and
 * `badgeStyle()` already solves the case where neither white nor near-black
 * reaches 4.5:1 by walking the fill until one does. Splitting the pair is what
 * produced near-black on Fighting in dark and white on Electric in light.
 */
export function swatchStyle(hex) {
  return badgeStyle(hexToRgb(hex));
}

/* ---------------------------------------------------------------------------
 * A contrast-walked foreground, for text sitting ON a palette surface.
 *
 * `swatchStyle()` cannot be reused for this and the reason is worth writing
 * down, because reaching for it is the obvious move and it is wrong. It solves
 * "this fill needs a background AND a readable text colour" — it walks the FILL
 * until the pair clears 4.5:1. The showcase's muted labels are the opposite
 * problem: the fill is already fixed (the panel surface, from the scale) and it
 * is the INK that has to move. So this walks the ink instead, toward black or
 * white, and returns only the colour.
 *
 * The walk is not optional. A scale's own 700-on-50 pairing clears 4.5:1 for
 * some palettes and fails it for others, because the scale is generated by
 * nudging lightness and saturation of one hue — measured across the roster,
 * Bulbasaur's 700-on-50 lands at 3.39:1, which is a third of the way below the
 * floor for 12-13px text. Reading the ratio off a hex pair is the same
 * 50/50 guess `swatchStyle()` exists to avoid; walking is what makes it hold
 * for 1,025 sprites instead of for the one you tested.
 *
 * The direction of the walk is chosen against the BACKGROUND, and that is the
 * one thing this must not copy from `badgeStyle()`. badgeStyle picks its
 * direction by asking whether the FILL looks better under white or near-black,
 * which is sound for the saturated mid-tone fills badges use and nonsense here:
 * the showcase's surfaces are the scale's 50 and 100 steps, so they are pale for
 * essentially every palette, and the ink must always go toward black. Following
 * badgeStyle instead walked Venusaur (#103) to pure #ffffff on a #f1efe9 tile —
 * 1.06:1, the worst possible outcome, produced by the one rule that looked
 * like the house style.
 *
 * `luminance()` mirrors the 0.03928 sRGB breakpoint used by `contrast()` in
 * shared.js, which is not exported. It is duplicated rather than exported
 * because shared.js importing back from a module that already imports it would
 * be a cycle (AGENTS.md, ES Modules note). It works on rgb ARRAYS, the shape
 * hexToRgb() returns — luminance() taking a hex is a trap, because hexToRgb
 * returns null for anything that is not a 6-digit string and `.map` on that null
 * takes the whole render down rather than degrading.
 * ------------------------------------------------------------------------ */
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Walk `inkHex` toward black or white until it clears `min` against `bgHex`.
 * Whichever end is closer by luminance wins, which is the same two-candidate
 * choice `badgeStyle()` makes — but here the choice only picks the DIRECTION
 * of the walk, and the walk itself is what guarantees the ratio, so unlike
 * badgeStyle's choice this one can never be the answer.
 */
export function readableInk(bgHex, inkHex, min = 4.5) {
  // Both ends are converted once, at the boundary. luminance()/contrastRatio()
  // take rgb ARRAYS, not hex — passing hex to them is what made the first
  // version of this function return null and take the whole showcase down with
  // it, because hexToRgb() only accepts a 6-digit string.
  const bg = hexToRgb(bgHex) || [255, 255, 255];
  const ink = hexToRgb(inkHex) || [0, 0, 0];
  // Direction from the BACKGROUND, per the note above — not from the ink.
  const towards = contrastRatio([255, 255, 255], bg) >= contrastRatio([0, 0, 0], bg)
    ? [255, 255, 255]
    : [0, 0, 0];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const cand = ink.map((c, i) => Math.round(c + (towards[i] - c) * t));
    if (contrastRatio(cand, bg) >= min) return rgbToHex(cand);
  }
  return rgbToHex(towards);
}

function rgbToHex(rgb) {
  return '#' + rgb.map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

/* ---------------------------------------------------------------------------
 * Showcase — the palette applied to a realistic interface.
 *
 * Transcribed in structure from the reference's color-showcase.tsx, which is a
 * four-tab "see your palette in action" demo (Cards / Charts / Dashboard /
 * Components) built to answer one question: does this colour actually work on a
 * screen, or does it only look good in a grid of swatches? The reference is a
 * React component with hard-coded English copy and Tailwind classes; this is
 * the same idea rendered with the site's own classes and real data.
 *
 * Two things are deliberately NOT transcribed, and both are load-bearing:
 *
 * 1. The reference computes its own `primaryText` by comparing the fill against
 *    white and near-black and picking the winner. That is a two-candidate guess
 *    that can still miss 4.5:1 — and it has to, because 1,025 sprites produce
 *    1,025 primaries. We already have the solved version: `swatchStyle()` runs
 *    the same comparison, then walks the fill toward black or white in 2% steps
 *    until it actually clears 4.5:1 (see badgeStyle in shared.js). Every
 *    text-on-colour surface below goes through it, so no showcase text can fail
 *    contrast on a pale Yellow or a deep Fighting navy. This is the same
 *    problem — the reference's own pairs put near-black on Fighting in dark and
 *    white on Electric in light — arriving in a third place.
 *
 * 2. The chart data is seeded constants rather than `Math.random()`. The
 *    reference says so in a comment too, and it matters for the same reason it
 *    matters on the maze page: a demo that reshuffles on every render cannot be
 *    screenshotted and compared, and this section re-renders on every palette
 *    change (Pokémon switch, shiny toggle), so random bars would make the page
 *    look broken when it is only re-rolling.
 *
 * @param {Object} options
 * @param {string} options.primary   - the most common sprite colour
 * @param {string} options.secondary - the second most common
 * @param {Object} options.scale     - the 11-step shade map, from generateTailwindScale()
 * @param {Object} [options.stats]   - the Pokémon's real base stats, for the dashboard
 * @param {string} [options.name]    - the Pokémon's zh name, shown in the mock UI
 * @param {number} [options.count]   - how many colours this palette has
 * @param {number} [options.share]   - the primary colour's share, in percent
 */
function decorativeCurvesSvg(color) {
  return `<svg aria-hidden="true" class="sc-curves" viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice">
    <g stroke="${color}" stroke-width="1.5" fill="none" opacity="0.6">
      <circle cx="380" cy="40" r="220" />
      <circle cx="380" cy="40" r="170" />
      <circle cx="380" cy="40" r="120" />
      <circle cx="380" cy="40" r="70" />
    </g>
  </svg>`;
}

function donutChartHtml(segments, primaryColor) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = segments.map(seg => {
    const fraction = seg.value / total;
    const dash = fraction * circumference;
    const circle = `<circle cx="50" cy="50" r="${radius}" fill="none"
      stroke="${seg.color}" stroke-width="14"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" />`;
    offset += dash;
    return circle;
  }).join('');

  return `
    <div class="sc-donut-wrapper">
      <div class="sc-donut-svg-box">
        <svg viewBox="0 0 100 100" class="sc-donut-svg">
          ${circles}
        </svg>
        <div class="sc-donut-center">
          <span class="sc-donut-sub" style="color:${primaryColor}">總計</span>
          <span class="sc-donut-val">$${total.toLocaleString()}</span>
        </div>
      </div>
      <ul class="sc-donut-legend">
        ${segments.map(seg => `
          <li class="sc-donut-item">
            <span class="sc-donut-label">
              <span class="sc-donut-dot" style="background:${seg.color}"></span>
              <span>${seg.label}</span>
            </span>
            <span class="sc-donut-item-val">$${seg.value.toLocaleString()}</span>
          </li>
        `).join('')}
      </ul>
    </div>`;
}

function sparklineSvg(primaryColor, secondaryColor, scale) {
  const primarySeries = [22, 30, 28, 42, 38, 55, 48, 64, 70, 62, 78, 88];
  const secondarySeries = [18, 20, 24, 30, 28, 34, 38, 40, 46, 52, 55, 58];
  const width = 800;
  const height = 160;
  const stepX = width / (primarySeries.length - 1);

  const toPath = series => series.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / 100) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  const toArea = series => {
    const path = toPath(series);
    return `${path} L${width} ${height} L0 ${height} Z`;
  };

  const id = `spark-${Math.abs(primaryColor.replace('#', ''))}`;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="sc-sparkline-svg" role="img" aria-label="活躍用戶走勢圖">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.38" />
          <stop offset="100%" stop-color="${primaryColor}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${toArea(primarySeries)}" fill="url(#${id})" />
      <path d="${toPath(secondarySeries)}" fill="none" stroke="${secondaryColor}" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round" opacity="0.75" />
      <path d="${toPath(primarySeries)}" fill="none" stroke="${primaryColor}" stroke-width="2.5" stroke-linecap="round" />
      <line x1="0" y1="${height - 0.5}" x2="${width}" y2="${height - 0.5}" stroke="${scale['200'] || scale['300']}" stroke-width="1" />
    </svg>`;
}

export function showcaseHtml({
  primary, secondary, scale, stats, name = '', count = 0, share = 0,
}) {
  const S = step => scale[step] || primary;

  // Light surfaces
  const sfLight = S('50');
  const sfrLight = S('100');
  const bdLight = S('200');
  const inkLight = S('950');
  const inkSoftLight = readableInk(sfLight, S('700'));

  // Dark surfaces
  const sfDark = S('950');
  const sfrDark = S('900');
  const bdDark = S('800');
  const inkDark = S('50');
  const inkSoftDark = readableInk(sfDark, S('300'));

  const isDark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const surface = isDark ? sfDark : sfLight;
  const surfaceRaised = isDark ? sfrDark : sfrLight;
  const border = isDark ? bdDark : bdLight;
  const ink = isDark ? inkDark : inkLight;
  const inkSoft = isDark ? inkSoftDark : inkSoftLight;
  const accent = isDark ? S('400') : S('500');
  const accentSoft = isDark ? S('800') : S('200');
  const onPrimaryColor = themeInkFor(primary);
  const onAccentColor = themeInkFor(accent);

  const vars = `--cp-sf:${surface};--cp-sfr:${surfaceRaised};--cp-bd:${border};` +
    `--cp-ink:${ink};--cp-ink-soft:${inkSoft};--cp-accent:${accent};--cp-accent-soft:${accentSoft};` +
    `--cp-primary:${primary};--cp-secondary:${secondary};` +
    `--cp-sf-light:${sfLight};--cp-sfr-light:${sfrLight};--cp-bd-light:${bdLight};--cp-ink-light:${inkLight};--cp-ink-soft-light:${inkSoftLight};` +
    `--cp-sf-dark:${sfDark};--cp-sfr-dark:${sfrDark};--cp-bd-dark:${bdDark};--cp-ink-dark:${inkDark};--cp-ink-soft-dark:${inkSoftDark};`;

  const tabs = [
    ['cards', '卡片'],
    ['charts', '圖表'],
    ['dashboard', '儀表板'],
    ['components', '元件'],
  ];

  // 1. Cards Tab (Faithful port of pokemonpalette CardsTab)
  const cards = `
    <div class="sc-grid-2">
      <!-- Feature card with curved gradient backdrop -->
      <article class="sc-feature-card" style="background:${S('100')};color:${S('900')}">
        ${decorativeCurvesSvg(S('300'))}
        <div class="sc-feature-content">
          <span class="sc-badge-pill" style="background:${S('200')};color:${S('800')}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z"/></svg>
            ★ 精選
          </span>
          <h3 class="sc-h2">${name || '寶可夢'} 色彩美學</h3>
          <p class="sc-p-lead" style="color:${S('700')}">
            主要色 ${primary.toUpperCase()} 佔比 ${share}%，在版面上以同色系明暗階層層展開，營造自然和諧的視覺節奏。
          </p>
          <span class="sc-card-link" style="color:${S('800')}">
            深入探索 <span aria-hidden="true">→</span>
          </span>
        </div>
      </article>

      <!-- Saturated CTA card -->
      <article class="sc-cta-card" style="background:${primary};color:${onPrimaryColor}">
        ${decorativeCurvesSvg(onPrimaryColor === '#ffffff' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)')}
        <div class="sc-cta-top">
          <span class="sc-cta-tag">PRIMARY THEME</span>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" opacity="0.9"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </div>
        <div class="sc-cta-bottom">
          <h3 class="sc-h2">掌控色彩主題</h3>
          <p class="sc-p-lead" style="opacity:0.9">
            靈活運用單一主色，自動適應白字黑字高對比，打造頂級體驗。
          </p>
          <button type="button" class="sc-cta-btn" style="background:${onPrimaryColor};color:${primary}">
            立即套用
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </article>

      <!-- Blog preview card spanning full width -->
      <article class="sc-chart-card sc-span-2 sc-blog-card">
        <div class="sc-blog-media" style="background:${S('100')}">
          ${decorativeCurvesSvg(S('300'))}
          <div class="sc-blog-icon-wrap" style="background:${primary};color:${onPrimaryColor}">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          </div>
        </div>
        <div class="sc-blog-body">
          <span class="sc-blog-meta" style="color:${primary}">設計筆記 · 4 分鐘閱讀</span>
          <h3 class="sc-h3">以單一品牌色為核心的介面設計</h3>
          <p class="sc-p" style="color:var(--text-secondary)">
            探索如何僅靠一組寶可夢提取色盤，推導完整明暗階與對比關係，在不增加繁瑣配色的情況下維持極致質感。
          </p>
          <div class="sc-blog-author">
            <span class="sc-author-dot" style="background:${secondary}"></span>
            <span>作者：<strong style="color:var(--text-primary)">寶可夢演算法</strong> · 今日發布</span>
          </div>
        </div>
      </article>
    </div>`;

  // 2. Charts Tab (Faithful port of pokemonpalette ChartsTab)
  const bars = [
    { label: '1 月', values: [56, 92] },
    { label: '2 月', values: [40, 70] },
    { label: '3 月', values: [62, 28] },
    { label: '4 月', values: [80, 60] },
    { label: '5 月', values: [70, 96] },
    { label: '6 月', values: [54, 78] },
  ];

  const donut = [
    { label: '生鮮食材', value: 4973, color: primary },
    { label: '居家用品', value: 4973, color: S('400') },
    { label: '休閒旅遊', value: 4973, color: S('200') },
  ];

  const charts = `
    <div class="sc-grid-2">
      <!-- 1. Bar chart card -->
      <article class="sc-chart-card">
        <header class="sc-card-head">
          <p class="sc-card-k">支出統計 · Expenses</p>
          <p class="sc-card-val">$12,543</p>
        </header>
        <div class="sc-bars" role="img" aria-label="六個月的雙色長條圖">
          ${bars.map(b => `
            <div class="sc-bar-col">
              <div class="sc-bar-pair">
                <span class="sc-bar" style="height:${b.values[0]}%;background:${S('300')}"></span>
                <span class="sc-bar" style="height:${b.values[1]}%;background:${primary}"></span>
              </div>
              <span class="sc-bar-x">${b.label}</span>
            </div>`).join('')}
        </div>
      </article>

      <!-- 2. Donut chart card -->
      <article class="sc-chart-card">
        <header class="sc-card-head">
          <p class="sc-card-k">分類佔比 · Breakdown</p>
          <p class="sc-card-val">$14,919</p>
        </header>
        ${donutChartHtml(donut, primary)}
      </article>

      <!-- 3. Trend line card spanning full width -->
      <article class="sc-chart-card sc-span-2">
        <header class="sc-chart-trend-head">
          <div>
            <p class="sc-card-k">活躍用戶 · Active Users</p>
            <p class="sc-card-val">12,438</p>
            <p class="sc-trend-delta" style="color:${primary}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m7 17 10-10M7 7h10v10"/></svg>
              +12.4% 比上週增長
            </p>
          </div>
          <div class="sc-trend-badges">
            <span class="sc-badge-outline" style="border:1px solid ${border};color:${secondary}">
              <span class="sc-badge-dot" style="background:${secondary}"></span>
              上週
            </span>
            <span class="sc-badge-soft" style="background:${accentSoft};color:${primary}">
              <span class="sc-badge-dot" style="background:${primary}"></span>
              本週
            </span>
          </div>
        </header>
        ${sparklineSvg(primary, secondary, scale)}
      </article>
    </div>`;

  // 3. Dashboard Tab (Faithful port of pokemonpalette DashboardTab)
  const kpiStats = [
    { label: '年度營收', value: '$42,318', delta: '+8.2%' },
    { label: '活躍用戶', value: '12,438', delta: '+12.4%' },
    { label: '轉換率', value: '3.6%', delta: '+0.4%' },
  ];

  const dashboard = `
    <div class="sc-grid-3">
      ${kpiStats.map(s => `
        <article class="sc-chart-card sc-kpi-card">
          <div class="sc-kpi-top">
            <p class="sc-card-k">${s.label}</p>
            <div class="sc-kpi-icon" style="background:${accentSoft};color:${primary}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 6l-9.5 9.5-5-5L1 18"/></svg>
            </div>
          </div>
          <p class="sc-card-val">${s.value}</p>
          <p class="sc-trend-delta" style="color:${primary}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m7 17 10-10M7 7h10v10"/></svg>
            ${s.delta}
          </p>
        </article>
      `).join('')}

      <!-- Big hero progress card spanning 2 columns -->
      <article class="sc-chart-card sc-span-2-desktop">
        <header class="sc-progress-head">
          <div>
            <p class="sc-card-k">本月支出 · This Month</p>
            <p class="sc-card-val">$14,919</p>
          </div>
          <button type="button" class="sc-action-btn" style="background:${primary};color:${onPrimaryColor}">
            匯出報表
            <span aria-hidden="true">→</span>
          </button>
        </header>
        <div class="sc-prog-list">
          ${[
            { label: '生鮮食材', value: 78 },
            { label: '居家用品', value: 60 },
            { label: '休閒旅遊', value: 45 },
            { label: '訂閱服務', value: 32 },
          ].map(row => `
            <div class="sc-prog-item">
              <div class="sc-prog-labels">
                <span class="sc-prog-k">${row.label}</span>
                <span class="sc-prog-v">${row.value}%</span>
              </div>
              <div class="sc-prog-track" style="background:${S('100')}">
                <div class="sc-prog-fill" style="width:${row.value}%;background:${primary}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </article>

      <!-- Activity feed card -->
      <article class="sc-chart-card">
        <header class="sc-card-head mb-3">
          <h3 class="sc-card-k">即時動態 · Activity</h3>
        </header>
        <ul class="sc-feed-list">
          ${[
            { title: '小霞 發表了新評論', time: '2 分鐘前' },
            { title: '小剛 邀請了 3 位訓練家', time: '18 分鐘前' },
            { title: '週報數據已自動生成', time: '1 小時前' },
            { title: '色盤已儲存至收藏庫', time: '3 小時前' },
          ].map((item, idx) => `
            <li class="sc-feed-item">
              <span class="sc-feed-dot" style="background:${idx === 0 ? primary : S('300')}"></span>
              <div class="sc-feed-text">
                <p class="sc-feed-t">${item.title}</p>
                <p class="sc-feed-time">${item.time}</p>
              </div>
            </li>
          `).join('')}
        </ul>
      </article>
    </div>`;

  // 4. Components Tab (Faithful port of pokemonpalette ComponentsTab)
  const components = `
    <div class="sc-grid-2">
      <!-- Buttons + inputs card -->
      <article class="sc-chart-card">
        <header class="sc-card-head mb-3">
          <h3 class="sc-card-k">按鈕元件 · Buttons</h3>
          <p class="sc-card-desc">主要、外框、柔和與幽靈按鈕</p>
        </header>
        <div class="sc-btn-row">
          <button type="button" class="sc-btn" style="background:${primary};color:${onPrimaryColor}">主要按鈕</button>
          <button type="button" class="sc-btn is-outline" style="border:1px solid ${primary};color:${primary}">外框按鈕</button>
          <button type="button" class="sc-btn is-soft" style="background:${accentSoft};color:${primary}">柔和底色</button>
          <button type="button" class="sc-btn is-ghost" style="color:${primary}">幽靈按鈕 →</button>
        </div>
        <div class="sc-input-box mt-4">
          <label class="sc-input-label">搜尋框範例</label>
          <div class="sc-mock-search" style="border:1px solid ${border}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <span>搜尋寶可夢名稱或編號…</span>
          </div>
        </div>
      </article>

      <!-- Badges + labels card -->
      <article class="sc-chart-card">
        <header class="sc-card-head mb-3">
          <h3 class="sc-card-k">標籤與類別 · Badges</h3>
          <p class="sc-card-desc">狀態、屬性與分類指示器</p>
        </header>
        <div class="sc-tag-row">
          <span class="sc-badge-pill" style="background:${primary};color:${onPrimaryColor}">主要</span>
          <span class="sc-badge-pill" style="background:${secondary};color:${themeInkFor(secondary)}">次要</span>
          <span class="sc-badge-pill" style="background:${accentSoft};color:${primary}">柔和</span>
          <span class="sc-badge-pill" style="border:1px solid ${primary};color:${primary}">外框</span>
          <span class="sc-badge-pill" style="background:${accentSoft};color:${primary}">✓ 啟用中</span>
        </div>
        <div class="sc-type-list mt-4">
          ${[
            { label: '草屬性 Grass', color: primary },
            { label: '水屬性 Water', color: secondary },
            { label: '火屬性 Fire', color: S('400') },
          ].map(r => `
            <div class="sc-type-row" style="background:${S('50')}">
              <span class="sc-type-item">
                <span class="sc-type-dot" style="background:${r.color}"></span>
                ${r.label}
              </span>
              <span class="sc-type-arrow" style="color:${S('400')}">→</span>
            </div>
          `).join('')}
        </div>
      </article>

      <!-- Notification banner spanning full width -->
      <article class="sc-chart-card sc-span-2 sc-banner-card" style="background:${S('50')};border:1px solid ${S('200')}">
        <div class="sc-banner-icon" style="background:${primary};color:${onPrimaryColor}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z"/></svg>
        </div>
        <div class="sc-banner-body">
          <p class="sc-banner-t">您的色彩主題已就緒</p>
          <p class="sc-banner-desc" style="color:${S('700')}">
            在上方微調任何明暗階，或直接前往下方匯出完整的 Tailwind 與 CSS 主題代碼。
          </p>
        </div>
        <a href="#sec-export" class="sc-banner-btn" style="background:${primary};color:${onPrimaryColor}">
          前往匯出
          <span aria-hidden="true">→</span>
        </a>
      </article>
    </div>`;

  const bodies = { cards, charts, dashboard, components };

  return `
    <div class="sc-tabs" role="tablist" aria-label="套用展示">
      ${tabs.map(([key, label], i) => `
      <button type="button" role="tab" class="sc-tab${i === 0 ? ' is-active' : ''}" id="sc-tab-${key}"
              aria-controls="sc-panel-${key}" aria-selected="${i === 0}"
              tabindex="${i === 0 ? 0 : -1}" data-sc-tab="${key}"
              style="${i === 0 ? `background:${primary};color:${onPrimaryColor};border-color:${primary};` : ''}">${label}</button>`).join('')}
    </div>
    ${tabs.map(([key, label], i) => `
    <div role="tabpanel" class="sc-panel" id="sc-panel-${key}"
         data-sc-tab-label="${label}" aria-labelledby="sc-tab-${key}" tabindex="0"
         style="${vars}"${i === 0 ? '' : ' hidden'}>${bodies[key]}</div>`).join('')}`;
}

/**
 * WAI-ARIA tab keyboard support and robust click switching for showcase tabs.
 */
export function wireShowcaseTabs(container) {
  if (!container) return;
  const tabs = [...container.querySelectorAll('[data-sc-tab]')];
  const panels = [...container.querySelectorAll('.sc-panel')];

  const select = tab => {
    const targetKey = tab.dataset.scTab;
    const activeBg = tab.dataset.activeBg || '';
    const activeFg = tab.dataset.activeFg || '';

    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('is-active', on);
      t.tabIndex = on ? 0 : -1;
      if (on && activeBg) {
        t.style.backgroundColor = activeBg;
        t.style.color = activeFg;
        t.style.borderColor = activeBg;
      } else if (!on) {
        t.style.backgroundColor = '';
        t.style.color = '';
        t.style.borderColor = '';
      }
    });

    panels.forEach(p => {
      const isTarget = p.id === `sc-panel-${targetKey}`;
      p.hidden = !isTarget;
      if (isTarget) {
        p.removeAttribute('hidden');
        p.style.display = 'grid';
      } else {
        p.setAttribute('hidden', '');
        p.style.display = 'none';
      }
    });

    try { tab.focus(); } catch (e) { /* ignore */ }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', event => {
      event.preventDefault();
      select(tab);
    });
    tab.addEventListener('keydown', event => {
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      select(next);
    });
  });

  // Delegated click listener to catch all clicks reliably
  container.addEventListener('click', event => {
    const tab = event.target.closest('[data-sc-tab]');
    if (tab && container.contains(tab)) {
      event.preventDefault();
      select(tab);
    }
  });
}

// ---------------------------------------------------------------------------
// shadcn token generation
// ---------------------------------------------------------------------------

/**
 * Map a 6-colour palette to a full shadcn token set, in a light and a dark
 * variant, transcribed from the reference project's `src/lib/theme-export.ts`.
 *
 * WHAT IS TRANSCRIBED AND WHAT IS NOT — read this before "fixing" a value that
 * does not match the reference page.
 *
 * The *algorithm* is a faithful port, down to the integer HSL rounding and the
 * `> 0.55` luminance threshold. The *data* is ours and deliberately differs.
 * The reference measured Bulbasaur as
 *   #399494, #62d5b4, #73ac31, #a4d541, #5cb7a1, #ee2039
 * and we measure the same sprite as
 *   #399494, #62d5b4, #83eec5, #73ac31, #bdff73, #ac0031
 * — the first two agree and the other four do not, because the reference's
 * numbers come from the Canvas `getImageData` scan in
 * `scripts/extract_color_palettes.py`, which this repo keeps for comparison
 * only and which is NOT what produced `color_palettes.json`. Our file is the
 * MMCQ 6-colour partition (see the header comment) and is pinned byte-exact by
 * `scripts/check_color_palettes.mjs`. So `--accent` here is `#83eec5` where the
 * reference shows `#73ac31`, and that is the correct result of the correct
 * algorithm on the correct data. Matching the reference's hexes would mean
 * re-running the abandoned extractor and discarding 2050 pinned palettes.
 *
 * `REFERENCE_BULBASAUR_PALETTE` below is the reference's own list, kept only so
 * `scripts/check_color_page.mjs` can prove the port is faithful: feeding it must
 * reproduce the reference's own published light and dark values byte-for-byte.
 * It is a test fixture, not a data source, and nothing on a page reads it.
 */

/** The reference's own Bulbasaur palette. Test fixture only — see above. */
export const REFERENCE_BULBASAUR_PALETTE = [
  '#399494', '#62d5b4', '#73ac31', '#a4d541', '#5cb7a1', '#ee2039',
];

/** @type {Array<{key: string, label: string, cssVar: string}>} */
export const THEME_PREVIEW_ROWS = [
  { key: 'primary', label: '主要色', cssVar: '--primary' },
  { key: 'secondary', label: '次要色', cssVar: '--secondary' },
  { key: 'accent', label: '強調色', cssVar: '--accent' },
  { key: 'background', label: '背景', cssVar: '--background' },
  { key: 'foreground', label: '前景', cssVar: '--foreground' },
  { key: 'muted', label: '靜音背景', cssVar: '--muted' },
  { key: 'border', label: '邊框', cssVar: '--border' },
  { key: 'card', label: '卡片', cssVar: '--card' },
];

/** Emission order of the exported CSS, which is also the shadcn document order. */
export const THEME_TOKEN_KEYS = [
  'background', 'foreground', 'card', 'cardForeground', 'popover', 'popoverForeground',
  'primary', 'primaryForeground', 'secondary', 'secondaryForeground',
  'muted', 'mutedForeground', 'accent', 'accentForeground',
  'destructive', 'destructiveForeground', 'border', 'input', 'ring',
  'chart1', 'chart2', 'chart3', 'chart4', 'chart5',
  'sidebar', 'sidebarForeground', 'sidebarPrimary', 'sidebarPrimaryForeground',
  'sidebarAccent', 'sidebarAccentForeground', 'sidebarBorder', 'sidebarRing',
];

/**
 * CSS variable name for a token key. shadcn's naming is camelCase in the object
 * and kebab-case in CSS, and the chart/sidebar groups are not a flat kebab
 * conversion — `chart1` is `--chart-1`, which is why this is a switch and not
 * `key.replace(/([A-Z])/g, '-$1').toLowerCase()`.
 */
export function themeCssVar(key) {
  switch (key) {
    case 'cardForeground': return '--card-foreground';
    case 'popoverForeground': return '--popover-foreground';
    case 'primaryForeground': return '--primary-foreground';
    case 'secondaryForeground': return '--secondary-foreground';
    case 'mutedForeground': return '--muted-foreground';
    case 'accentForeground': return '--accent-foreground';
    case 'destructiveForeground': return '--destructive-foreground';
    case 'chart1': case 'chart2': case 'chart3': case 'chart4': case 'chart5':
      return `--chart-${key.slice(-1)}`;
    case 'sidebar': return '--sidebar';
    case 'sidebarForeground': return '--sidebar-foreground';
    case 'sidebarPrimary': return '--sidebar-primary';
    case 'sidebarPrimaryForeground': return '--sidebar-primary-foreground';
    case 'sidebarAccent': return '--sidebar-accent';
    case 'sidebarAccentForeground': return '--sidebar-accent-foreground';
    case 'sidebarBorder': return '--sidebar-border';
    case 'sidebarRing': return '--sidebar-ring';
    default: return `--${key}`;
  }
}

/**
 * HSL with each channel rounded to a whole degree / percent.
 *
 * This exists because the reference's `hexToHsl` rounds, and its `withL` /
 * `withSL` feed those rounded integers straight back into `hslToHex` — so the
 * rounding is on the data path, not cosmetic. The `hexToHsl` exported above
 * deliberately does NOT round (the palette strip and `describeHex` want the
 * true value), which is why this is a second function rather than a flag.
 * Reusing the unrounded one here shifts every derived token by 1–2 per channel
 * and produces a palette that looks right and is not the reference's.
 *
 * @returns {{h:number,s:number,l:number}|null}
 */
/**
 * The reference's integer HSL, which is what every derived token is built on.
 *
 * This is a transcription of the reference's own `hexToHsl`
 * (`theme-export.ts:81`), not `hexToHsl()` with a `Math.round` bolted on, and
 * the duplication is load-bearing. The reference keeps hue as a 0..1 fraction
 * and rounds it in one step — `Math.round(fraction * 360)` — whereas
 * `hexToHsl()` here folds the 60 in and returns degrees. Those two values are
 * algebraically equal and numerically different, and the difference is not a
 * rounding detail: it is a unit in the last place, and at an exact half-degree
 * it decides the integer.
 *
 * Recovering the fraction afterwards does not work, and both obvious attempts
 * were measured before this was written down. Over the 8,137 distinct colours
 * in `color_palettes.json`:
 *
 *   Math.round(degrees)             4 wrong    (hides a ULP the reference loses)
 *   Math.round(degrees / 360 * 360) 5 wrong    (the divide/multiply is not
 *                                               an identity in binary floats)
 *
 * and the real input set is larger than the palette colours. A token is
 * usually `withSL(secondary, 15, 45)` — a *derived* hex fed back through the
 * conversion — so sweeping the 8,137 palette colours alone, which is what the
 * first two attempts were checked against, leaves the actual use case
 * unmeasured. Widening the sweep to every `(s, l)` pair the token builder
 * reaches, 97,644 derived conversions, the surviving candidates disagree on 19.
 *
 * What makes this worth the duplicated arithmetic is the size of the residue.
 * It is 1 of 255 in a single channel, so no screenshot and no contrast sweep
 * will ever show it. The reference publishes
 * `--muted-foreground: #62847b`; the half-up path produced `#62847a` and would
 * have shipped a token that differs from the page being ported, invisibly and
 * irreproducibly. So the golden test pins all 64 values, and
 * `check_color_theme_tokens.mjs` additionally pins the conversion itself over
 * the real roster — because the three fixture colours (#399494, #62d5b4,
 * #73ac31) are not among the affected ones, and "64/64 passes" is therefore
 * NOT a reason to simplify this back to `Math.round(hexToHsl(hex).h)`.
 */
function roundedHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [rn, gn, bn] = rgb.map(v => v / 255);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const clamp01 = n => Math.min(1, Math.max(0, n));

/** `hslToHex` with the reference's clamp, which our version omits. */
function hslToHexClamped({ h, s, l }) {
  return hslToHex({ h, s: clamp01(s / 100) * 100, l: clamp01(l / 100) * 100 });
}

/** Replace lightness, keeping the rounded hue and saturation. */
function withL(hex, l) {
  const hsl = roundedHsl(hex);
  if (!hsl) return hex;
  return hslToHexClamped({ h: hsl.h, s: hsl.s, l });
}

/** Replace saturation and lightness, keeping the rounded hue. */
function withSL(hex, s, l) {
  const hsl = roundedHsl(hex);
  if (!hsl) return hex;
  return hslToHexClamped({ h: hsl.h, s, l });
}

/**
 * Ink for a fill, by perceived luminance. The threshold is 0.55, not 0.5, and
 * the direction is `L > 0.55 -> near-black`, `L <= 0.55 -> white`.
 *
 * That is the reference's number and it is load-bearing rather than
 * house-style: measured over all 12,297 palette entries in
 * `color_palettes.json`, **943 colours (7.67%, 682 distinct hexes) sit in the
 * band `0.50 < L <= 0.55`** — the only band where the two thresholds disagree —
 * the commonest being `#838383` (L 0.514, 29 occurrences) and `#808080`
 * (L 0.502, 11). Lowering the threshold to 0.5 flips all 943 from white ink to
 * near-black ink, so it is a visible change to a seventh of the roster, not a
 * refinement. Keep 0.55, because 0.55 is what the reference publishes.
 *
 * TWO TRAPS, both of which cost a real hole in the first version of the
 * checker. **It is not observable from the golden fixture**: all three of the
 * reference palette's colours sit outside the band, so all 64 golden values are
 * identical under either threshold, and the closest — accent `#73ac31` at
 * L 0.5527 — misses the line by 0.0027. A checker that only compares the golden
 * block therefore guards nothing here, which is why this function is exported
 * as `themeInkFor` and asserted directly. And **a checker must not re-derive
 * the constant in the test**: the first version computed `> 0.55` and `> 0.5`
 * inside the test file, so it agreed with the source whatever the source said,
 * and a mutation of the source passed. Assert through this function or the
 * assertion is decoration.
 */
export function themeInkFor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#0a0a0a' : '#ffffff';
}

function pickColor(colors, i) {
  if (colors.length === 0) return '#6366f1';
  return colors[i % colors.length] ?? '#6366f1';
}

/** Light variant. Surfaces stay near white; the palette tints them faintly. */
function buildLightTokens(colors) {
  const primary = pickColor(colors, 0);
  const secondary = pickColor(colors, 1);
  const accent = pickColor(colors, 2);

  const background = withSL(primary, 20, 99);
  const foreground = withSL(primary, 30, 12);
  const card = withSL(primary, 15, 100);
  const muted = withSL(secondary, 25, 96);
  const mutedForeground = withSL(secondary, 15, 45);
  const border = withSL(primary, 20, 90);
  const ring = withL(primary, Math.max(45, Math.min(65, roundedHsl(primary).l)));

  return {
    background,
    foreground,
    card,
    cardForeground: foreground,
    popover: card,
    popoverForeground: foreground,
    primary,
    primaryForeground: themeInkFor(primary),
    secondary,
    secondaryForeground: themeInkFor(secondary),
    muted,
    mutedForeground,
    accent,
    accentForeground: themeInkFor(accent),
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',
    border,
    input: border,
    ring,
    chart1: pickColor(colors, 0),
    chart2: pickColor(colors, 1),
    chart3: pickColor(colors, 2),
    chart4: pickColor(colors, 3),
    chart5: pickColor(colors, 4),
    sidebar: card,
    sidebarForeground: foreground,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: themeInkFor(primary),
    sidebarAccent: muted,
    sidebarAccentForeground: foreground,
    sidebarBorder: border,
    sidebarRing: ring,
  };
}

/**
 * Dark variant. Surfaces are built from the primary at low lightness, and
 * primary/secondary/accent are *lifted* to at least 55% lightness so a Pokémon
 * whose palette is too dark to read still has a usable accent on a dark
 * surface. The lift is why the reference's dark `--primary` is `#5abfbf` where
 * its light one is `#399494`.
 */
function buildDarkTokens(colors) {
  const primary = pickColor(colors, 0);
  const secondary = pickColor(colors, 1);
  const accent = pickColor(colors, 2);

  const background = withSL(primary, 15, 9);
  const foreground = withSL(primary, 10, 96);
  const card = withSL(primary, 18, 13);
  const muted = withSL(secondary, 20, 18);
  const mutedForeground = withSL(secondary, 15, 65);
  const border = withSL(primary, 20, 22);
  const ring = withL(primary, Math.max(55, Math.min(70, roundedHsl(primary).l)));

  const liftPrimary = withL(primary, Math.max(55, roundedHsl(primary).l));
  const liftSecondary = withL(secondary, Math.max(55, roundedHsl(secondary).l));
  const liftAccent = withL(accent, Math.max(55, roundedHsl(accent).l));

  return {
    background,
    foreground,
    card,
    cardForeground: foreground,
    popover: card,
    popoverForeground: foreground,
    primary: liftPrimary,
    primaryForeground: themeInkFor(liftPrimary),
    secondary: liftSecondary,
    secondaryForeground: themeInkFor(liftSecondary),
    muted,
    mutedForeground,
    accent: liftAccent,
    accentForeground: themeInkFor(liftAccent),
    destructive: '#dc2626',
    destructiveForeground: '#ffffff',
    border,
    input: border,
    ring,
    chart1: pickColor(colors, 0),
    chart2: pickColor(colors, 1),
    chart3: pickColor(colors, 2),
    chart4: pickColor(colors, 3),
    chart5: pickColor(colors, 4),
    sidebar: card,
    sidebarForeground: foreground,
    sidebarPrimary: liftPrimary,
    sidebarPrimaryForeground: themeInkFor(liftPrimary),
    sidebarAccent: muted,
    sidebarAccentForeground: foreground,
    sidebarBorder: border,
    sidebarRing: ring,
  };
}

/**
 * @param {string[]} colors palette hexes. **The caller slices this to the
 *   palette size, and the default is 3 — not 6.**
 * @returns {{light: Object, dark: Object, palette: string[]}}
 *
 * The slice is the one non-obvious contract in this file, and it is invisible
 * unless you check the reference's own output. Only `chart4` and `chart5` can
 * observe it, because they are the only tokens built from `pickColor(colors, 3)`
 * and `pickColor(colors, 4)`; every other token reads `colors[0..2]`. The
 * reference's published dark block has `--chart-4: #399494` and
 * `--chart-5: #62d5b4`, which are `colors[0]` and `colors[1]` — so its array had
 * period 3 and therefore length 3, even though the palette display beside it
 * shows six. Feed this function all six and the first 28 tokens come out
 * identical while `chart4`/`chart5` silently become colours 4 and 5, which is
 * the kind of divergence a page never renders visibly.
 *
 * So the page calls `paletteToThemeTokens(hexes.slice(0, n))`, and `n` is the
 * palette-size select, default 3, persisted per the reference under
 * `localStorage['pokemonpalette-palette-size']`.
 */
export function paletteToThemeTokens(colors) {
  const safe = colors.length > 0 ? colors : ['#6366f1', '#818cf8', '#c7d2fe'];
  return { light: buildLightTokens(safe), dark: buildDarkTokens(safe), palette: safe };
}

// ---- serialisers -----------------------------------------------------------

function emitVarBlock(tokens, formatValue, indent = '  ') {
  return THEME_TOKEN_KEYS
    .map(k => `${indent}${themeCssVar(k)}: ${formatValue(tokens[k])};`)
    .join('\n');
}

/** `@theme inline` alias block, the Tailwind v4 way of wiring the tokens up. */
const THEME_INLINE_BLOCK = `@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}`;

export function themeToTailwindV4Css(bundle, opts = {}) {
  const name = opts.pokemonName || 'Pokemon';
  return [
    `/* ${name} theme - generated by 寶可夢演算法 */`,
    '',
    '/* globals.css */',
    '@layer base {',
    '  :root {',
    emitVarBlock(bundle.light, v => v, '    '),
    '  }',
    '',
    '  .dark {',
    emitVarBlock(bundle.dark, v => v, '    '),
    '  }',
    '}',
    '',
    THEME_INLINE_BLOCK,
    '',
  ].join('\n');
}

function toHslTriplet(hex) {
  const hsl = roundedHsl(hex);
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`;
}

export function themeToTailwindV3Config(bundle, opts = {}) {
  const raw = opts.pokemonName || 'Pokemon';
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  const cssBlock = [
    '/* globals.css */',
    '@layer base {',
    '  :root {',
    emitVarBlock(bundle.light, toHslTriplet, '    '),
    '  }',
    '',
    '  .dark {',
    emitVarBlock(bundle.dark, toHslTriplet, '    '),
    '  }',
    '}',
  ].join('\n');

  return [
    `/* ${name} theme - generated by 寶可夢演算法 */`,
    '',
    cssBlock,
    '',
    '// tailwind.config.js',
    "/** @type {import('tailwindcss').Config} */",
    'module.exports = {',
    '  darkMode: ["class"],',
    '  content: ["./**/*.{html,js}"],',
    '  theme: {',
    '    extend: {',
    '      colors: {',
    '        border: "hsl(var(--border))",',
    '        input: "hsl(var(--input))",',
    '        ring: "hsl(var(--ring))",',
    '        background: "hsl(var(--background))",',
    '        foreground: "hsl(var(--foreground))",',
    '        primary: {',
    '          DEFAULT: "hsl(var(--primary))",',
    '          foreground: "hsl(var(--primary-foreground))",',
    '        },',
    '        secondary: {',
    '          DEFAULT: "hsl(var(--secondary))",',
    '          foreground: "hsl(var(--secondary-foreground))",',
    '        },',
    '        destructive: {',
    '          DEFAULT: "hsl(var(--destructive))",',
    '          foreground: "hsl(var(--destructive-foreground))",',
    '        },',
    '        muted: {',
    '          DEFAULT: "hsl(var(--muted))",',
    '          foreground: "hsl(var(--muted-foreground))",',
    '        },',
    '        accent: {',
    '          DEFAULT: "hsl(var(--accent))",',
    '          foreground: "hsl(var(--accent-foreground))",',
    '        },',
    '        popover: {',
    '          DEFAULT: "hsl(var(--popover))",',
    '          foreground: "hsl(var(--popover-foreground))",',
    '        },',
    '        card: {',
    '          DEFAULT: "hsl(var(--card))",',
    '          foreground: "hsl(var(--card-foreground))",',
    '        },',
    '        chart: {',
    '          1: "hsl(var(--chart-1))",',
    '          2: "hsl(var(--chart-2))",',
    '          3: "hsl(var(--chart-3))",',
    '          4: "hsl(var(--chart-4))",',
    '          5: "hsl(var(--chart-5))",',
    '        },',
    '        sidebar: {',
    '          DEFAULT: "hsl(var(--sidebar))",',
    '          foreground: "hsl(var(--sidebar-foreground))",',
    '          primary: "hsl(var(--sidebar-primary))",',
    '          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",',
    '          accent: "hsl(var(--sidebar-accent))",',
    '          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",',
    '          border: "hsl(var(--sidebar-border))",',
    '          ring: "hsl(var(--sidebar-ring))",',
    '        },',
    '      },',
    '    },',
    '  },',
    '  plugins: [require("tailwindcss-animate")],',
    '};',
    '',
  ].join('\n');
}

export function themeToJson(bundle, opts = {}) {
  const name = (opts.pokemonName || 'pokemon').toLowerCase();
  return JSON.stringify({
    name: `${name}-theme`,
    generatedBy: 'pokemon-algorithm',
    palette: bundle.palette,
    light: bundle.light,
    dark: bundle.dark,
  }, null, 2);
}

/**
 * The token set as a CSS custom-property declaration string, for the live
 * preview's `style` attribute. Includes the `--color-*` aliases because the
 * preview box is styled with Tailwind utilities in the reference, and ours uses
 * the same utilities — without the aliases `bg-background` resolves to nothing.
 *
 * @returns {string} e.g. `--primary: #399494; --color-primary: #399494;`
 */
export function themeVarBlock(tokens) {
  const pairs = THEME_TOKEN_KEYS.map(k => `${themeCssVar(k)}: ${tokens[k]}`);
  return pairs
    .concat(pairs.map(p => p.replace(/^--/, '--color-')))
    .join('; ');
}



export function getContrastHex(hex) {
  if (!hex || typeof hex !== "string") return "#ffffff";
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "#ffffff";
  // WCAG relative luminance, not the BT.601 luma this used to average, and no
  // fixed cut-off: the only correct answer is whichever of black/white actually
  // contrasts more. A 0.55 luma threshold returned white for #399494 (3.6:1,
  // under AA) when black gives 5.9:1 — the swatch label is 11px text, so that
  // is a real failure, not a rounding detail.
  const lin = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const vsWhite = 1.05 / (L + 0.05);
  const vsBlack = (L + 0.05) / 0.05;
  return vsBlack >= vsWhite ? "#0a0a0a" : "#ffffff";
}

export function slugifyName(name) {
  if (!name) return "pokemon";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pokemon";
}
