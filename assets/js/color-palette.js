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
  // just not shaped, and only decoded pixels catch it (AGENTS.md gotcha 25 and
  // 41: do not verify an overlay from computed style).
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
 * make, not a number to guess at: see AGENTS.md gotcha 39, where a 600-level
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
 * rule the way generations.html patches its 新屬性 hole (AGENTS.md gotcha 43):
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
 * @param {Object} [options] - { id, variant }
 * @returns {string}
 */
export function paletteGridHtml(rows, options = {}) {
  if (!rows.length) return '<p class="cp-empty">此寶可夢沒有色盤資料</p>';
  const cols = paletteColumns(rows.length);
  const cells = rows
    .map(([hex, share]) => {
      const shareText = formatShare(share);
      const tip = `${hex} · 占比 ${shareText}`;
      return `<button type="button" class="cp-cell" style="${swatchStyle(hex)}" title="${tip}" data-cp-copy="${hex}" aria-label="複製 ${tip}">
              <span class="cp-cell-hex">${hex}</span>
              <span class="cp-cell-share">${shareText}</span>
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
 * makes the activation target ambiguous (AGENTS.md gotcha 27).
 *
 * @param {Array<[string, number]>} rows
 * @param {Object} [options] - { limit, showRemainder }
 * @returns {string}
 */
export function paletteStripHtml(rows, options = {}) {
  const limit = options.limit ?? VISIBLE_STRIP_COLORS;
  const showRemainder = options.showRemainder ?? true;
  if (!rows.length) return '';
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  const segments = shown
    .map(
      ([hex, share]) =>
        `<span class="cp-seg" style="${swatchStyle(hex)}" title="${hex} · ${formatShare(share)}"><span class="cp-seg-hex">${hex}</span></span>`
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
 * A short human-readable name for a hex, used in the generator page's prose
 * ("以 #399494 為主的深青色"). Deterministic on purpose: the same hex must
 * produce the same words on every load, so this buckets by HSL rather than
 * consulting a nearest-named-colour table.
 *
 * Transcribed from the reference's color-name.ts with the hue-family names
 * localised. The bucket boundaries are the reference's and are not re-tuned:
 * they are prose, and a re-tuned boundary changes every sentence on the page
 * for no measurable gain.
 */
export function describeHex(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return '色彩';
  const { h, s, l } = hsl;

  if (l >= 96) return '近白';
  if (l <= 6) return '近黑';

  if (s < 8) {
    if (l < 25) return '極深灰';
    if (l < 45) return '深灰';
    if (l < 65) return '灰';
    if (l < 85) return '淺灰';
    return '灰白';
  }

  // The brown band: low-to-mid lightness at an orange/amber hue with
  // mid saturation reads as brown rather than orange. Eevee and Bidoof are
  // entirely inside it, which is why the band is checked before the hue family.
  if (h >= 15 && h <= 50 && l < 45 && s < 70) {
    return l < 22 ? '深棕' : '棕';
  }

  const family = hueFamily(h);

  // The two modifiers are computed independently and then one is chosen,
  // rather than an if/else chain. The distinction is not cosmetic: the
  // reference's chain and an exclusive one happen to agree on all 13,767
  // colours we store, because the "vivid" condition (s > 80 with 35 < l < 70)
  // is itself bounded to the lightness range where neither lightness modifier
  // fires. They would diverge the moment a threshold moved — a vivid-pale
  // colour, say — and the reason to keep them separate is that the *intent* is
  // "prefer the more informative modifier", not "stop at the first match".
  let lightnessMod = '';
  if (l < 22) lightnessMod = '深';
  else if (l < 35) lightnessMod = '暗';
  else if (l > 78) lightnessMod = '淡';
  else if (l > 65) lightnessMod = '淺';

  let satMod = '';
  if (s < 25) satMod = '柔';
  else if (s > 80 && l > 35 && l < 70) satMod = '鮮';

  const mod = lightnessMod || satMod;
  return mod ? `${mod}${family}` : family;
}

/** warm / cool / neutral, for the mood line under a palette. */
export function colorTemperature(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl || hsl.s < 12) return 'neutral';
  const { h } = hsl;
  if ((h >= 0 && h < 70) || h >= 300) return 'warm';
  if (h >= 170 && h < 280) return 'cool';
  return 'neutral';
}

export const TEMPERATURE_ZH = { warm: '暖色', cool: '冷色', neutral: '中性' };

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
  if (format === 'hex') return hex || '';
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  if (format === 'rgb') return `rgb(${rgb.join(', ')})`;
  const hsl = roundedHsl(hex);
  if (!hsl) return '';
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
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
 * the site's own dead-link class (gotcha 15).
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
 * 32 was unreachable by slug; that collision is fixed (gotcha 30). The fallback
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
 * page on purpose: gotcha 8's clean-URL contract is a two-line change in
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
 * produced near-black on Fighting in dark and white on Electric in light
 * (AGENTS.md gotcha 20).
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
 *    contrast on a pale Yellow or a deep Fighting navy. This is gotcha 20's
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
export function showcaseHtml({
  primary, secondary, scale, stats, name = '', count = 0, share = 0,
}) {
  const S = step => scale[step] || primary;
  // The three surfaces every panel paints on, derived from the scale rather than
  // from site tokens: the point is to show THIS palette, not the site's theme.
  const surface = S('50');
  const surfaceRaised = S('100');
  const border = S('300');
  const ink = S('950');
  // Muted ink is WALKED, not read off the scale: a generated scale's own
  // 700-on-50 pairing fails 4.5:1 on some palettes (Bulbasaur measures 3.39).
  // It is walked against the DARKER of the two surfaces it lands on, because
  // `--cp-ink-soft` is used both on the panel (`--cp-sf`) and inside the tiles,
  // tracks and inputs (`--cp-sfr`), and one ink has to serve both — walking
  // against the lighter one leaves the darker tile 0.4:1 short.
  const inkBase = luminance(hexToRgb(surface)) <= luminance(hexToRgb(surfaceRaised))
    ? surface : surfaceRaised;
  const inkSoft = readableInk(inkBase, S('700'));
  const accent = S('500');
  const accentSoft = S('200');

  // Text on a coloured fill. swatchStyle() also returns the background, so it
  // is the single source for both halves of the pair.
  const onPrimary = swatchStyle(primary);
  const onAccent = swatchStyle(accent);
  const onSoft = swatchStyle(accentSoft);

  const vars = `--cp-sf:${surface};--cp-sfr:${surfaceRaised};--cp-bd:${border};` +
    `--cp-ink:${ink};--cp-ink-soft:${inkSoft};--cp-accent:${accent};--cp-accent-soft:${accentSoft};` +
    `--cp-primary:${primary};--cp-secondary:${secondary};`;

  const tabs = [
    ['cards', '卡片'],
    ['charts', '圖表'],
    ['dashboard', '儀表板'],
    ['components', '元件'],
  ];

  // ---- panel bodies --------------------------------------------------------
  const cards = `
      <article class="sc-card sc-spotlight" style="${onPrimary}">
        <p class="sc-eyebrow">精選</p>
        <h3 class="sc-h3">${name || '這隻寶可夢'}</h3>
        <p class="sc-p">主要色 ${primary.toUpperCase()} 佔整張圖 ${share}%，在卡片上以本色作底，白字或黑字由對比自動取捨。</p>
        <span class="sc-cta">查看色盤 <span aria-hidden="true">→</span></span>
      </article>
      <div class="sc-tile-row">
        ${[['色票數', `${count} 色`], ['主要色', primary.toUpperCase()], ['次要色', secondary.toUpperCase()]]
          .map(([k, v]) => `
        <div class="sc-tile">
          <span class="sc-tile-k">${k}</span>
          <span class="sc-tile-v">${v}</span>
        </div>`).join('')}
      </div>
      <article class="sc-card sc-post">
        <div class="sc-post-dot" style="background:${secondary}" aria-hidden="true"></div>
        <div>
          <p class="sc-eyebrow" style="color:${accent}">筆記 · 4 分鐘</p>
          <h3 class="sc-h4">用單一主色做版面</h3>
          <p class="sc-p sm">以次要色點綴其餘區塊，確認對比後再大面積使用。</p>
        </div>
      </article>`;

  // Two series across six months, the reference's own numbers.
  const bars = [
    { label: '1 月', a: 56, b: 92 },
    { label: '2 月', a: 40, b: 70 },
    { label: '3 月', a: 62, b: 28 },
    { label: '4 月', a: 80, b: 60 },
    { label: '5 月', a: 70, b: 96 },
    { label: '6 月', a: 54, b: 78 },
  ];
  const charts = `
      <figure class="sc-figure">
        <figcaption class="sc-cap">每月色票用量（示意數據）</figcaption>
        <div class="sc-bars" role="img"
             aria-label="六個月的兩組長條圖，數值為示意，非真實統計">
          ${bars.map(b => `
            <div class="sc-bar-col">
              <div class="sc-bar-pair">
                <span class="sc-bar" style="height:${b.a}%;background:${accent}"></span>
                <span class="sc-bar" style="height:${b.b}%;background:${secondary}"></span>
              </div>
              <span class="sc-bar-x">${b.label}</span>
            </div>`).join('')}
        </div>
        <p class="sc-legend">
          <span class="sc-key" style="background:${accent}"></span>主要色階
          <span class="sc-key" style="background:${secondary}"></span>次要色
        </p>
      </figure>`;

  // The dashboard tab uses the Pokémon's REAL base stats rather than more mock
  // numbers — the same seven the detail page shows, painted in this palette.
  const statRows = stats
    ? [['hp', '體力'], ['attack', '攻擊'], ['defense', '防禦'],
       ['sp_attack', '特攻'], ['sp_defense', '特防'], ['speed', '速度']]
      .map(([key, label]) => ({ label, value: stats[key] }))
    : [];
  const peak = statRows.length ? Math.max(...statRows.map(s => s.value)) : 255;
  const dashboard = `
      <div class="sc-tile-row">
        ${statRows.slice(0, 3).map(s => `
        <div class="sc-tile">
          <span class="sc-tile-k">${s.label}</span>
          <span class="sc-tile-v">${s.value}</span>
          <span class="sc-delta">／${peak}</span>
        </div>`).join('')}
      </div>
      <div class="sc-meter-row">
        ${statRows.map(s => `
        <div class="sc-meter">
          <span class="sc-meter-k">${s.label}</span>
          <span class="sc-track"><span class="sc-fill" style="width:${Math.round(s.value / peak * 100)}%;background:${accent}"></span></span>
          <span class="sc-meter-v">${s.value}</span>
        </div>`).join('')}
        ${statRows.length ? '' : '<p class="sc-p sm">此頁未載入能力值資料。</p>'}
      </div>
      <p class="sc-note">長條使用實際能力值，非示意資料。色票全部取自上方色盤與明暗階。</p>`;

  const components = `
      <div class="sc-field">
        <span class="sc-field-k">按鈕</span>
        <div class="sc-btn-row">
          <span class="sc-btn" style="${onAccent}">主要動作</span>
          <span class="sc-btn is-soft" style="${onSoft}">次要</span>
          <span class="sc-btn is-outline" style="border-color:${accent};color:${accent}">外框</span>
          <span class="sc-btn is-disabled">停用</span>
        </div>
      </div>
      <div class="sc-field">
        <span class="sc-field-k">標籤</span>
        <div class="sc-tag-row">
          ${[primary, secondary, accent, S('700'), S('300')].map((hex, i) => `
          <span class="sc-tag" style="${swatchStyle(hex)}">色票 ${i + 1}</span>`).join('')}
        </div>
      </div>
      <div class="sc-field">
        <span class="sc-field-k">輸入框</span>
        <div class="sc-input" role="img" aria-label="輸入框示意">
          <span style="color:${inkSoft}">搜尋寶可夢…</span>
        </div>
      </div>
      <div class="sc-field">
        <span class="sc-field-k">動態</span>
        <ul class="sc-list">
          ${['已匯出 CSS 變數', '已複製主要色', '明暗階重新計算', '色盤組成更新']
            .map((t, i) => `
          <li class="sc-list-row">
            <span class="sc-list-dot" style="background:${i === 0 ? accent : border}"></span>
            <span class="sc-list-t">${t}</span>
            <span class="sc-list-when" style="color:${inkSoft}">${i === 0 ? '剛剛' : (i + 1) * 7 + ' 分鐘前'}</span>
          </li>`).join('')}
        </ul>
      </div>`;

  const bodies = { cards, charts, dashboard, components };

  return `
    <div class="sc-tabs" role="tablist" aria-label="套用展示">
      ${tabs.map(([key, label], i) => `
      <button type="button" role="tab" class="sc-tab" id="sc-tab-${key}"
              aria-controls="sc-panel-${key}" aria-selected="${i === 0}"
              tabindex="${i === 0 ? 0 : -1}" data-sc-tab="${key}">${label}</button>`).join('')}
    </div>
    ${tabs.map(([key, label], i) => `
    <div role="tabpanel" class="sc-panel" id="sc-panel-${key}"
         data-sc-tab-label="${label}" aria-labelledby="sc-tab-${key}" tabindex="0"
         style="${vars}"${i === 0 ? '' : ' hidden'}>${bodies[key]}</div>`).join('')}`;
}

/**
 * WAI-ARIA tab keyboard support, same contract as the move tabs in shared.js:
 * arrows move between tabs, Home/End jump to the ends, only the selected tab is
 * in the tab order (roving tabindex), and every panel is in the DOM with the
 * inactive ones carrying `hidden` (AGENTS.md gotcha 13 — the ARIA relationships
 * need the panels to exist, and that is also what `@media print` reveals).
 */
export function wireShowcaseTabs(container) {
  const tabs = [...container.querySelectorAll('[data-sc-tab]')];
  const select = tab => {
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute('aria-selected', String(on));
      other.tabIndex = on ? 0 : -1;
      const panel = container.querySelector(`#sc-panel-${other.dataset.scTab}`);
      if (panel) panel.hidden = !on;
    }
    tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
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
