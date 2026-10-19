#!/usr/bin/env node
/**
 * Regression checks for the 3D viewer. Run: node scripts/check_glb.mjs
 *
 * There is no `glTF-Validator` in the toolchain and adding one to a no-build
 * static site to check two files would be the wrong trade, so the GLB container
 * and the JSON chunk are parsed here directly. That is enough to pin the four
 * things a later edit could silently break, and each of them is a real trap
 * rather than a formality:
 *
 *  1. `extensionsRequired` vs the decoder path. model3d-viewer.js hardcodes a
 *     Draco decoder URL for performance. If a model ever ships without
 *     `KHR_draco_mesh_compression` that call becomes dead weight; the failure is
 *     invisible, because an unused decoder breaks nothing. So the assertion runs
 *     in BOTH directions: every model must require Draco, and the viewer must
 *     still configure the decoder.
 *
 *  2. glb-index.js vs the directory. The index is what stops the page firing a
 *     404 for each of the 1023 ids that have no model, so a stale index is a
 *     regression in the exact direction it was written to prevent. Checked as
 *     set equality, not "index is a subset of the directory".
 *
 *  3. clipToken(). The 0/1/N clip handling is the whole point of the page, and
 *     the two models on disk disagree about name format — `model_skeleton|
 *     001idle` against a bare `Impactrueno`. A regex change that breaks the
 *     first silently degrades every button label to the raw string, which still
 *     looks like a working page.
 *
 *  4. The scale spread. A 24x difference in root scale (109.50 vs 4.53) is the
 *     reason the camera is derived from a measured box instead of a constant.
 *     If a new model arrives already normalised, someone will be tempted to
 *     hardcode the camera; this prints the spread so that temptation has to
 *     survive reading the number.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const problems = [];
const ok = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
const eq = (got, want, msg) => ok(
  Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
  `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`
);

const GLB_DIR = join(BASE, 'assets/glbs');

/**
 * Parse a .glb container: 12-byte header, then length/type-prefixed chunks.
 * Only the JSON chunk is of interest, but the walk itself is what proves the
 * declared chunk length matches the file — a truncated upload is the failure
 * this catches, and it is exactly what a fetch-based viewer reports as an
 * unhelpful "load failed".
 */
function parseGlb(path) {
  const buf = readFileSync(path);
  if (buf.length < 12) throw new Error(`${path}: shorter than a GLB header`);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'glTF') throw new Error(`${path}: bad magic ${JSON.stringify(magic)}`);
  const version = buf.readUInt32LE(4);
  const declared = buf.readUInt32LE(8);
  if (declared !== buf.length) {
    throw new Error(`${path}: header declares ${declared} bytes, file is ${buf.length} (truncated?)`);
  }

  let offset = 12;
  let json = null;
  let binaryBytes = 0;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (start + len > buf.length) {
      throw new Error(`${path}: ${type} chunk claims ${len} bytes but only ${buf.length - start} remain`);
    }
    if (type === 'JSON') json = JSON.parse(buf.toString('utf8', start, start + len));
    if (type === 'BIN') binaryBytes = len;
    offset = start + len;
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { version, json, bytes: buf.length, binaryBytes };
}

// === 1. the container, per model ===

const onDisk = readdirSync(GLB_DIR).filter(f => f.endsWith('.glb'));
const numbered = onDisk.filter(f => /^\d+\.glb$/.test(f));
ok(onDisk.length === numbered.length,
  `every .glb is named by numeric id; non-numeric: ${onDisk.filter(f => !/^\d+\.glb$/.test(f)).join(', ') || 'none'}`);
ok(numbered.length > 0, 'assets/glbs holds at least one model');

const models = [];
for (const file of numbered.sort()) {
  const id = Number(file.slice(0, -4));
  let parsed;
  try {
    parsed = parseGlb(join(GLB_DIR, file));
  } catch (e) {
    ok(false, `assets/glbs/${file}: ${e.message}`);
    continue;
  }
  models.push({ id, ...parsed });

  const g = parsed.json;
  eq(g.asset?.version, '2.0', `${file}: asset.version`);
  ok(Array.isArray(g.animations), `${file}: animations is an array (0 is valid)`);
  ok((g.meshes || []).length > 0, `${file}: has at least one mesh`);

  // 1a. the two-way Draco assertion
  const required = g.extensionsRequired || [];
  ok(required.includes('KHR_draco_mesh_compression'),
    `${file}: requires KHR_draco_mesh_compression, so the viewer's decoder path is live (got: ${JSON.stringify(required)})`);

  // WebP textures: both models declare EXT_texture_webp, which iOS Safari
  // only supports from 14+. Not a check that can fail usefully today, but the
  // fact is worth having in the log next to the Draco line.
  if (required.includes('EXT_texture_webp')) {
    console.log(`  ${file}: EXT_texture_webp (iOS Safari 14+ only)`);
  }
}

const viewer = readFileSync(join(BASE, 'assets/js/model3d-viewer.js'), 'utf8');
ok(/draco\.setDecoderPath\(DRACO_DECODER_PATH\)/.test(viewer),
  'the viewer configures the Draco decoder (the assertion above depends on it)');
ok(/new DRACOLoader\(\)/.test(viewer), 'a DRACOLoader is constructed');
ok(/gltfLoader\.setDRACOLoader\(draco\)/.test(viewer), 'the DRACOLoader is attached to the GLTFLoader');

// === 2. the index against the directory ===

const indexSrc = readFileSync(join(BASE, 'assets/js/glb-index.js'), 'utf8');
const indexIds = [...indexSrc.matchAll(/export const GLB_IDS = new Set\(\s*"([^"]*)"/g)]
  .flatMap(m => m[1].split(' ').filter(Boolean).map(Number))
  .sort((a, b) => a - b);
eq(indexIds, models.map(m => m.id), 'glb-index.js matches assets/glbs/ exactly');

const glbIdsInData = JSON.parse(
  readFileSync(join(BASE, 'assets/data/pokemon_data.json'), 'utf8')
).map(p => p.id);
indexIds.forEach(id => ok(glbIdsInData.includes(id),
  `id ${id} has a model AND a pokemon_data.json record, so the name lookup resolves`));

// === 3. clipToken() / clipLabel(), against the real names on disk ===

/**
 * Load the reducer out of the module and run it here, rather than keeping a
 * copy: a test that checks its own copy against itself cannot notice a wrong
 * reading of the clip names. `new Function` is safe here — the source is this
 * repo's, and evaluating it exercises the shipped implementation rather than a
 * reimplementation of it.
 */
function loadFromViewer(names) {
  const slices = names.map(name => {
    const at = viewer.indexOf(`export function ${name}(`);
    ok(at !== -1, `model3d-viewer.js exports ${name}()`);
    if (at === -1) return `function ${name}(){ throw new Error('${name} missing'); }`;
    // Slice to the matching closing brace at column 0 — both helpers are
    // top-level, so the next line that starts with `}` ends the function.
    const end = viewer.indexOf('\n}', at);
    return viewer.slice(at, end + 2).replace('export ', '');
  });
  const labelsAt = viewer.indexOf('const ANIM_LABELS = {');
  const labelsEnd = viewer.indexOf('\n};', labelsAt);
  // One generated scope for the whole set: clipLabel calls clipToken, so
  // building them separately leaves that reference undefined.
  return new Function(
    `${viewer.slice(labelsAt, labelsEnd + 3)}\n${slices.join('\n')}\n` +
    `return { ${names.join(', ')} };`
  )();
}

const { clipToken, clipLabel } = loadFromViewer(['clipToken', 'clipLabel']);

eq(clipToken('model_skeleton|001aidle'), 'aidle', '001aidle -> aidle');
eq(clipToken('model_skeleton|001fight_b'), 'fight_b', 'a suffixed token keeps its suffix');
eq(clipToken('Impactrueno'), 'Impactrueno', 'a bare name is left alone');
eq(clipToken('model_skeleton|002'), '2', 'a name with no trailing token is not silently empty');

// The `a` prefix: all nine of 1.glb's clips must resolve to a Chinese label,
// or the page degrades to nine raw-name buttons and still looks fine.
const nine = models.find(m => m.id === 1);
if (nine) {
  const names = (nine.json.animations || []).map(a => a.name);
  eq(names.length, 9, '1.glb carries nine clips');
  const unresolved = names.filter(n => !clipLabel(n).label);
  eq(unresolved, [], 'every 1.glb clip resolves to a label through the `a` prefix');
  // Specific enough to catch a strip that over-reaches: `aerial` must NOT lose
  // its first letter just because `idle` does.
  eq(clipLabel('model_skeleton|001aerial').token, 'aerial', 'an unknown a-word keeps its token');
  eq(clipLabel('model_skeleton|001aerial').label, null, 'an unknown a-word gets no label');
  eq(clipLabel('model_skeleton|001jump_s').label, '跳躍', 'a suffixed token falls back to its base');
  eq(clipLabel('Impactrueno').label, null, 'an unknown bare name gets no label');
}

for (const m of models) {
  for (const a of m.json.animations || []) {
    const { token } = clipLabel(a.name);
    ok(token && token.length > 0, `${m.id}.glb: clip "${a.name}" reduces to a non-empty token`);
  }
}

// === 4. the 0 / 1 / N contract the page is built around ===

const counts = models.map(m => (m.json.animations || []).length).sort((a, b) => a - b);
ok(counts.includes(0) || counts.includes(1) || counts.length > 1,
  `the roster exercises more than one clip count (got ${JSON.stringify(counts)})`);

const page = readFileSync(join(BASE, 'model3d.html'), 'utf8');
ok(/playback\.hidden = clips\.length === 0/.test(page),
  'the playback panel is HIDDEN for a 0-clip model, not disabled');
ok(/clipCard\.hidden = clips\.length === 0/.test(page),
  'the clip card is HIDDEN for a 0-clip model');
ok(/state\.loop = state\.clips\.length > 1/.test(viewer),
  'loop defaults on for N clips and off for a single clip');
ok(/hasGlb\(id\)/.test(viewer), 'the viewer asks glb-index before requesting a model');

/**
 * Clip length, as the MAX over every sampler's input accessor.
 *
 * NOT `samplers[0].input`, which is the trap this script shipped with. In both
 * models the first sampler is a CONSTANT channel — one keyframe at t=0, accessor
 * `count: 1, max: [0]` — so reading only that reports every clip in 1.glb as
 * 0.000s. Three.js is not fooled: it builds an AnimationClip from the union of
 * all track times, which is why the viewer is correct and only this report was
 * wrong. The longest keyframe set is the honest duration.
 */
function clipDuration(model, anim) {
  return Math.max(0, ...(anim.samplers || []).map(s => model.json.accessors[s.input]?.max?.[0] ?? 0));
}

console.log('');
for (const m of models) {
  const anims = m.json.animations || [];
  const root = m.json.scenes?.[0]?.nodes?.[0];
  const scale = m.json.nodes?.[root]?.scale;
  const longest = anims.reduce((a, x) => Math.max(a, clipDuration(m, x)), 0);
  console.log(`  ${m.id}.glb  ${(m.bytes / 1024).toFixed(0)} KB  ` +
    `${anims.length} clip(s)  meshes ${m.json.meshes.length}  materials ${(m.json.materials || []).length}  ` +
    `root scale ${scale ? scale.join(' ') : 'n/a'}  longest ${longest.toFixed(2)}s`);
  for (const a of anims) {
    console.log(`      ${a.name.padEnd(28)} ${clipDuration(m, a).toFixed(3)}s  channels ${a.channels.length}  -> "${clipToken(a.name)}"`);
  }
}

console.log('');
if (models.length > 1) {
  // The number that decides whether the camera can be a constant. See the
  // header: a 24x spread is the reason normaliseAndFrame() measures the box.
  const scales = models.map(m => {
    const root = m.json.scenes?.[0]?.nodes?.[0];
    return m.json.nodes?.[root]?.scale?.[0] ?? null;
  });
  const present = scales.filter(s => typeof s === 'number');
  if (present.length > 1) {
    const spread = Math.max(...present) / Math.min(...present);
    console.log(`  root scale spread: ${spread.toFixed(1)}x ` +
      `(${present.map(s => s.toFixed(2)).join(' vs ')}) — the camera is derived from a measured box for this reason`);
  }
}

// === 5. lighting: the light-theme regression, and the toggle's own state ===

/**
 * No theme token may set a light's colour.
 *
 * This is the whole of the original "3D model is too dark" report, and it is
 * invisible in dark mode: `--text-primary` is #f0f6fc there, so tinting the key
 * light with it produced a near-white lamp. In light mode the same token is
 * #1f2328, so the key light was a near-black one. Measured on Bulbasaur at the
 * time, the model's median relative luma went 0.081 -> 0.822 and the share of
 * pixels below the 0.18 floor went 88% -> 0.2%. The key intensity was IDENTICAL
 * on both sides of that measurement, so nothing about the model, the GLB or the
 * renderer explained the swing — only the token.
 *
 * Read the 0.822 as historical, not as the current value. The lighting was
 * retuned afterwards for a separate reason (the model was too BRIGHT and too
 * glary, the opposite complaint), and the median now measures 0.545-0.647. A
 * static number in a comment cannot be kept current by editing it after every
 * retune; the point of this check is the invariant, not the measurement.
 *
 * Ground colour is excluded, and that is not leniency: a `HemisphereLight`'s
 * ground is standing in for the FLOOR, so it is the one colour that should track
 * the page. It is `hemi.`, not `key.`/`fill.`, that the pattern below allows.
 */
// NOTE: `matchAll` returns an ITERATOR, whose `.length` is undefined, so the
// first version of this check read `undefined === 0` and failed forever against
// clean code. Spread it.
const themedLights = [...viewer.matchAll(/(key|fill|rim|spot)\w*\.color\.(copy|set)\s*\(\s*[^)]*(tokenColor|tint)/g)];
ok(themedLights.length === 0,
  'no light colour is bound to a theme token' +
  (themedLights.length ? ` (found ${themedLights.map(m => m[1] + '.color').join(', ')})` : ''));

// The ambient term. Every material in the roster is metallicFactor 0, which
// means a model with no `scene.environment` has nothing to reflect and the whole
// shadow side collapses to the hemisphere term.
ok(/scene\.environment\s*=/.test(viewer),
  'scene.environment is set, so metallic-0 materials have something to reflect');
ok(/PMREMGenerator/.test(viewer), 'the environment is PMREM-prefiltered, not a raw cube');

/**
 * `scene.environmentIntensity` must be assigned EXACTLY ONCE, and below 1.
 *
 * This is a guard against a specific, already-committed bug. A sweep harness
 * patched the value into the source with a `String.replace` that APPENDED a new
 * assignment each run instead of replacing it, so after four candidates the file
 * carried four `scene.environmentIntensity = N;` lines. Nothing errored: it
 * parsed, it rendered, and the console was clean. Only the pixel measurement
 * disagreed, and only by the difference between the value the results table was
 * labelled with (0.4, the last line written) and the one actually in effect
 * (0.5, the last line ASSIGNED — the insert was LIFO, so "written" and
 * "effective" were not the same line).
 *
 * A duplicate assignment is therefore worse than a wrong one: it is invisible to
 * review, to `node --check`, and to the page itself. Counting them is the only
 * cheap channel that catches it, and the count must be `=== 1` — a `> 0` test
 * passes the broken file.
 */
const envIntensityAssignments = [...viewer.matchAll(/scene\.environmentIntensity\s*=\s*([\d.]+)\s*;/g)];
ok(envIntensityAssignments.length === 1,
  `scene.environmentIntensity is assigned exactly once, not ${envIntensityAssignments.length} times` +
  (envIntensityAssignments.length > 1
    ? ` (values: ${envIntensityAssignments.map(m => m[1]).join(', ')} — the last one wins)`
    : ''));
if (envIntensityAssignments.length === 1) {
  const envIntensity = Number(envIntensityAssignments[0][1]);
  ok(envIntensity > 0 && envIntensity < 1,
    `scene.environmentIntensity is dialled back from RoomEnvironment's default 1.0 (is ${envIntensity})`);
}

/**
 * A toggle that only sets `aria-pressed` with no rule reading it.
 *
 * Both playback toggles did exactly this, so pressing 循環播放 or 自動旋轉
 * changed the DOM and not one pixel — the reported "I can't tell whether looping
 * is applied". A static grep is the whole check: this is a stylesheet fact, and
 * the failure mode is invisible at runtime precisely because the JS is correct.
 */
const css = readFileSync(join(BASE, 'assets/css/shared.css'), 'utf8');
ok(/\.btn\[aria-pressed=["']true["']\]/.test(css),
  'shared.css has a rule for a pressed .btn');
// The same shape, one level down: some rule must match a pressed button with
// NOTHING else on that selector. Checking for the *declarations* instead is
// wrong — the hover rule legitimately repeats them, so their presence proves
// nothing about the resting state. And the selector cannot be found by
// anchoring on `^` or `,` either, because the rule sits below a comment.
function hasRestingPressedRule(src) {
  // Comments are stripped FIRST and this is not optional: the block comment
  // above the rule explains the very selectors being searched for, so
  // `aria-pressed` and `:hover` both appear in prose before the first real
  // selector. Without this, a captured "selector" is a paragraph of English
  // ending in `.btn[aria-pressed="true"]]` and the check reads as absent.
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',')) {
      if (sel.trim() === '.btn[aria-pressed="true"]') return true;
    }
  }
  return false;
}
ok(hasRestingPressedRule(css),
  'the pressed style applies at rest, not only on :hover or :not(:disabled)');

ok(/循環播放/.test(page) && /單次播放/.test(page),
  'the loop button names the current mode, so its state is not colour-only');
ok(/paintPlaybackButtons\(viewer\.state\)/.test(page),
  'the buttons are repainted from the viewer state on load, not only on click');

/* ── Zoom ────────────────────────────────────────────────────────────────
 *
 * Five separate ways the zoom control could be added and still not work, each
 * worth a check because each was plausible while being written:
 *
 *  1. A ratio that hardcodes a world-space step. The two shipped models differ
 *     24.2x in root scale (reported above) and `minDistance`/`maxDistance` are
 *     both multiples of a per-model measured radius, so "move 1 unit" is a nudge
 *     on one and a lurch on the other. Checked as `distance * ratio`.
 *  2. A button wired to nothing. Checked against the public API surface, not the
 *     call site, so a renamed method cannot leave the wiring looking present.
 *  3. A limit the buttons know about and the wheel does not (or vice versa).
 *     Both must read the SAME two numbers, or the wheel and the button disagree
 *     about where the floor is.
 *  4. Zoom controls visible over an empty stage. The pair is hidden by
 *     setStatus(), which is the single choke point for loading / no-GLB /
 *     failure / no-WebGL / context-lost — a second flag per site would be five
 *     chances to miss one.
 *  5. A keyboard handler that eats the browser's own zoom (Ctrl/Cmd + -) or
 *     types a "+" into the speed slider. The guard has to be asserted, because
 *     the handler is trivially "correct" by inspection and then wrong.
 */
ok(/function zoomBy\(\s*ratio\s*\)/.test(viewer),
  'the viewer exposes zoomBy(ratio) — a RATIO, so one gesture means the same thing on a 109.5x and a 4.5x model');
ok(/next\s*=\s*Math\.min\(\s*Math\.max\(\s*distance\s*\*\s*ratio/.test(viewer),
  'zoomBy scales the current distance by the ratio instead of adding a fixed offset');
ok(/controls\.minDistance/.test(viewer) && /controls\.maxDistance/.test(viewer),
  'the zoom clamp reads the same minDistance/maxDistance OrbitControls clamps the wheel to');
ok(/zoomBy,\s*\n\s*zoomLimits,/.test(viewer) ||
   /zoomBy[\s\S]{0,40}zoomLimits[\s\S]{0,40}resetView/.test(viewer),
  'zoomBy and zoomLimits are on the public API the page is allowed to call');
ok(/function zoomLimits\(\)/.test(viewer),
  'the viewer reports whether each direction has room left, so a press at the stop is explainable');
ok(/zoomBox\.hidden\s*=\s*!!title/.test(page),
  'the zoom pair hides with the status overlay, so it cannot float over an empty stage');
ok(/id="zoom-in"[\s\S]{0,400}id="zoom-out"/.test(page),
  'both zoom buttons are in the markup — a half-added pair is one dead control');
ok(/aria-label="拉近"[\s\S]{0,400}aria-label="拉遠"/.test(page),
  'each zoom button names its direction for assistive tech, since the glyph is aria-hidden');
// No `disabled` attribute: aria-disabled keeps the control focusable so it can
// report the limit, the same rule the shiny toggle follows.
const zoomButtons = page.match(/<button[^>]*class="m3d-zoom-btn"[^>]*>/g) || [];
ok(zoomButtons.length === 2, 'exactly two zoom buttons, neither hard-disabled');
ok(zoomButtons.every(b => !/\sdisabled[\s>=]/.test(b)),
  'zoom buttons use aria-disabled, not disabled, so a limit is readable rather than a disappearance');
ok(/e\.ctrlKey\s*\|\|\s*e\.metaKey|e\.metaKey\s*\|\|\s*e\.ctrlKey/.test(page),
  'the keyboard zoom skips when a modifier is held, leaving Ctrl/Cmd +/- to the browser');
ok(/isComposing/.test(page) && /e\.repeat/.test(page),
  'the keyboard zoom skips IME composition and key auto-repeat');
ok(/isContentEditable[\s\S]{0,120}input\|textarea\|select/.test(page),
  'the keyboard zoom stands down in a text field or select, so "+" still types');
ok(/syncZoomButtons\(\);/.test(page) && /onFrame[\s\S]{0,400}syncZoomButtons/.test(page),
  'aria-disabled tracks the WHEEL too, not only button clicks — both move the camera');

// === 6. the three.js pin, and the shadow constant it has to be paired with ===

/**
 * Nothing in this file used to mention the pinned version, which is exactly why
 * the pin could drift out from under the importmap with no test going red.
 *
 * The load-bearing half is `PCFSoftShadowMap`. From r186 it is not merely
 * deprecated — it is *unreachable*. `WebGLProgram.js` resolves the type through
 *
 *     shadowMapTypeDefines[ type ] || 'SHADOWMAP_TYPE_BASIC'
 *
 * and the table holds only PCF and VSM, so the constant silently compiles to a
 * single unfiltered tap: a hard shadow, no error, no console warning. Asserting
 * the constant is *absent* is therefore the whole point; asserting it is
 * *present* is the boring half, and without it a deletion would also pass.
 */
const pinCore = page.match(/"three":\s*"https:\/\/unpkg\.com\/three@([^/"]+)\//);
const pinAddons = page.match(/"three\/addons\/":\s*"https:\/\/unpkg\.com\/three@([^/"]+)\//);
const pinConst = viewer.match(/THREE_VERSION\s*=\s*'([^']+)'/);
const pins = [pinCore?.[1], pinAddons?.[1], pinConst?.[1]];
const allPinsFound = pins.every(v => typeof v === 'string');
// Each of these names all three values rather than a Set size: a bare "got 2,
// want 1" and a "got 0.186.1" that reads fine while the check is red both send
// the reader to the wrong file.
ok(allPinsFound,
  `all three three.js pins parse (importmap x2 + THREE_VERSION); got ${JSON.stringify(pins)}`);
ok(allPinsFound && new Set(pins).size === 1,
  `the importmap and THREE_VERSION name the same three.js release; core=${pinCore?.[1]} addons=${pinAddons?.[1]} const=${pinConst?.[1]}`);
ok(allPinsFound && parseInt(pinCore?.[1]?.split('.')[1], 10) >= 186,
  `the core pin is at r186 or newer, where PCFShadowMap is the only soft path; core=${pinCore?.[1]} addons=${pinAddons?.[1]} const=${pinConst?.[1]}`);

/**
 * Strips comments, because the constant's NAME has to appear in the prose on
 * purpose — the block comment on THREE_VERSION is the record of why it went, and
 * AGENTS.md wants that reasoning to outlive this conversation. So the checks
 * below count *uses in code*, not mentions in text. `//` preceded by `:` is left
 * alone so the Draco decoder URL on the DRACO_DECODER_PATH line survives,
 * harmless either way since that URL never mentions the constant.
 */
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const viewerCode = stripComments(viewer);
const pageCode = stripComments(page);

const softRefs = [...viewerCode.matchAll(/PCFSoftShadowMap/g)].length
               + [...pageCode.matchAll(/PCFSoftShadowMap/g)].length;
ok(softRefs === 0,
  'PCFSoftShadowMap is used nowhere in code — r186 drops the shader branch, so it renders a hard shadow silently');
ok(/\bPCFShadowMap\b/.test(viewerCode) && /renderer\.shadowMap\.type\s*=\s*PCFShadowMap/.test(viewerCode),
  'the shadow type is PCFShadowMap, imported and actually assigned');
// r180's PCF_SOFT was a fixed ±1-texel 9-tap that ignored the radius, and r186's
// PCF defaults to radius 1, so leaving it unset is the faithful port. This is
// here to make a deliberate raise cost one line, not to forbid it.
ok(!/shadow\.radius\s*=/.test(viewerCode),
  'key.shadow.radius is still unset (default 1 matches the old soft filter) — if you raised it on purpose, update the comment on THREE_VERSION and drop this line');

if (problems.length) {
  for (const p of problems.slice(0, 30)) console.error(`  FAIL ${p}`);
  if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
  console.error(`\n${problems.length} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
