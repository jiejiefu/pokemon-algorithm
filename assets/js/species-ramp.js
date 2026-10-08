/**
 * The live curve's ink: a species' own sprite colour, made legible on the plot's
 * ground.
 *
 * WHY THIS IS A MODULE AND NOT A LINE IN spectrum.html
 * ----------------------------------------------------
 * Everything here is arithmetic, and arithmetic is the kind of claim this project
 * does not accept on trust — `spectrum.html` is a browser module whose colour logic
 * cannot be run without a page, a Web Audio graph and a decoded cry. So the function
 * takes the contrast ratio as a PARAMETER rather than importing it, which leaves this
 * module with no imports at all: `check_spectrum_page.mjs` lifts it out of the source
 * and runs it over all 1,025 records in bare Node, the same way
 * `check_color_match.mjs` does. An import would have made that impossible, because
 * the lifting harness evaluates the function's body without the module graph.
 *
 * Passing `contrast` in rather than calling `shared.js`'s own has a second reason,
 * which is the important one: `shared.js:251` deliberately keeps WCAG's 0.03928
 * luminance breakpoint instead of 0.04045, and documents that the difference is small
 * but that changing it "would invalidate those numbers for no gain". Every contrast
 * figure recorded in AGENTS.md comes from that breakpoint. A luminance written here
 * with 0.04045 would disagree with all of them, and the disagreement would be a
 * rounding-scale bug living in the one function whose entire job is a threshold.
 *
 * WHY A FLOOR IS NEEDED AT ALL
 * ----------------------------
 * Measured over all 1,025 `pokemon_data.json` records against this page's own plot
 * ground `#07050e`: 68 species (6.6%) fall below WCAG's 3:1 for a graphical object and
 * 273 (26.6%) fall below 4.5:1, at a median of 6.05:1.
 *
 * The assumption this replaces was 「黑色系寶可夢看不見」, and it is wrong twice over.
 * The worst case is 大炭車 #838 at 1.63:1 — but it is not a dark Pokémon, it is a
 * DESATURATED one at rgb(56,51,50). The list is 捷克羅姆 (53,57,59), 薩戮德
 * (55,62,52), 巨炭山 (70,62,58): greys and near-greys, which is `color-palette.js`'s
 * `chroma()` gate (`NEUTRAL_CHROMA = 16`) catching up with this page. 197 species
 * (19.2%) have a grey average colour altogether. A greyness that is invisible here is
 * the same greyness that `describeHex()` once reported as 淺藍 (§3.B2) — the failure is
 * never 「too dark」, it is 「not a colour, so treat it as one anyway」.
 *
 * WHAT THE FLOOR COSTS
 * --------------------
 * Very little, and it was worth measuring rather than assuming: lifting 月亮伊布
 * #197 from rgb(75,76,71) to rgb(91,92,87) is a 16-unit move, the median species needs
 * a shift of about the same size, worst-case chroma retention is 100% and worst-case
 * hue drift is 9°. The colour still reads as that Pokémon. An earlier draft of this
 * measurement reported a median lift of "100% white", which would have meant the
 * colour was destroyed — that number came from a white-mix written as `c + (1-c)*t`
 * on a 0-255 channel, i.e. mixing toward BLACK. The bug was in the measurement, not
 * in the method, and it is recorded here because a floor that appears to destroy the
 * colour is exactly the shape of result that would have got this function deleted.
 *
 * WHY 2% STEPS AND NOT A BINARY SEARCH
 * ------------------------------------
 * `badgePair()` at `shared.js:293` already solves this shape of problem for type
 * badges: scale the fill toward black or white in 2% steps, and stop the moment the
 * threshold is met. A binary search would be shorter and would land within a channel
 * of the same answer, but it would be a SECOND way to lift a colour toward a
 * background, in a project that already has one, and §3.B1's reason applies: two
 * copies of a small algorithm drift invisibly and neither is right when you look.
 */

/** Fixed sRGB triples in, fixed triple out — no clamping, no rounding inside. */
const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * A species' sprite colour, lifted toward white only until it clears `min` against
 * `ground`.
 *
 * Toward WHITE and not toward black because the ground is near-black in both themes:
 * `--sp-plot-bg` is declared once in `:root` (`spectrum.css:80`) and is not overridden
 * per theme, so there is exactly one ground and one direction, and the "pick the
 * better of two directions" half of `badgePair()` has nothing to decide here. If a
 * future theme gives the plot a light ground, this needs a direction argument rather
 * than a hardcoded white — that is the one thing to change then, and the reason the
 * ground is a parameter is so the caller is the one that knows.
 *
 * Steps at 2% and stops at the first step that clears. Stopping early matters: the
 * whole point is to keep the species recognisable, so the last few percent of contrast
 * above the floor are not worth spending on.
 *
 * @param {[number,number,number]|null|undefined} rgb  the sprite's own colour
 * @param {[number,number,number]} ground               the colour it will be drawn on
 * @param {(a:number[],b:number[])=>number} contrast   WCAG ratio; `shared.js`'s
 * @param {number} min                                  floor, e.g. 3
 * @returns {[number,number,number]|null} null when there is no colour to lift
 */
export function speciesInk(rgb, ground, contrast, min = 3) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return null;
  if (!Array.isArray(ground) || ground.length !== 3) return null;
  if (typeof contrast !== 'function') return null;

  const src = rgb.map(v => clamp255(Number(v)));
  if (!src.every(Number.isFinite)) return null;

  /* Already legible: return the species' own colour BYTE FOR BYTE. Rounding it
   * through the steps would cost a species its exact stored colour for no reason, and
   * 957 of the 1,025 records are already above the floor — so this branch is the
   * common case, not a fast path. */
  if (contrast(src, ground) >= min) return src.slice();

  /* The direction, decided ONCE from the ground rather than per channel: this page's
   * ground is near-black, so the answer is white, and the branch exists only so that a
   * future light ground does not need a second function. */
  const towards = ground.some(v => v > 127) ? 0 : 255;

  /* `badgePair()`'s loop verbatim in shape: `t` walks 0 → 1 and the FIRST step that
   * clears wins, with the bound written as `<= 1.0001` because a float that is a hair
   * under 1 must still be evaluated. A species at exactly rgb(0,0,0) reaches t = 1
   * and is drawn white, which is correct: there is no black-on-black answer and the
   * reader is owed a visible curve. */
  let fill = src.slice();
  for (let t = 0; t <= 1.0001; t += 0.02) {
    fill = src.map(c => Math.round(c + (towards - c) * t));
    if (contrast(fill, ground) >= min) break;
  }
  return fill;
}
