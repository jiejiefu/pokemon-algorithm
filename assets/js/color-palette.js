/**
 * Colour-palette data access, colour naming, and the two silhouette techniques.
 *
 * The data is precomputed by `scripts/extract_color_palettes.py` into
 * `assets/data/color_palettes.json` (254 KB raw / 74 KB gzip, 2050 palettes).
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
 * How many colours a card's compact strip draws, and what it does with the
 * rest. A card is ~190px wide and 34px tall, so 11 cells would be 17px each; the
 * strip caps at 5 and renders the remainder as a `+N` chip.
 *
 * The marker is the part that is not optional. A 6-colour palette shown as 5
 * silently loses its rarest colour and the card claims to be the whole
 * palette; `+1` is the only thing that says otherwise. The count is also in the
 * card's aria-label, so the information is not carried by the chip alone.
 */
export const VISIBLE_STRIP_COLORS = 5;

/**
 * The compact strip. NOT clickable and NOT a link: it lives inside a card that
 * is itself an `<a>`, and a nested button inside a link is invalid HTML and
 * makes the activation target ambiguous (AGENTS.md gotcha 27).
 *
 * @param {Array<[string, number]>} rows
 * @param {Object} [options] - { limit }
 * @returns {string}
 */
export function paletteStripHtml(rows, options = {}) {
  const limit = options.limit ?? VISIBLE_STRIP_COLORS;
  if (!rows.length) return '';
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  const segments = shown
    .map(
      ([hex, share]) =>
        `<span class="cp-seg" style="${swatchStyle(hex)}" title="${hex} · ${formatShare(share)}"><span class="cp-seg-hex">${hex}</span></span>`
    )
    .join('');
  const more = rest > 0 ? `<span class="cp-seg-more">+${rest}</span>` : '';
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
 * The `?id=` fallback is not redundant. `pokemonSlug()` normalises `names.en`
 * to `[a-z0-9]`, which strips `Nidoran♀` / `Nidoran♂` — both slug to `nidoran`
 * and `find()` returns the first match, so id 32 is unreachable by slug. That
 * collision is pre-existing and documented in AGENTS.md gotcha 30; fixing it
 * means changing the URL scheme, which also touches the clean-URL contract.
 * Until then every page keyed on a slug accepts the numeric form, exactly as
 * detail.html does.
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
