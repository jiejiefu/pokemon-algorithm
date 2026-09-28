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
 * copy. An earlier draft mirrored the regex in this file and asserted the two
 * matched textually — which is how it shipped a test that agreed with a
 * *wrong* reading of the clip names: 1.glb's clips are `model_skeleton|001a`
 * + token (`001aidle`, `001ako`, `001awalk`, nine for nine), not `001idle`, and
 * a test that checks its own copy against itself cannot notice.
 *
 * `new Function` over a two-line string is not a security concern: the source
 * is this repo's, and evaluating it is the only way to exercise the shipped
 * implementation rather than a reimplementation of it.
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

if (problems.length) {
  for (const p of problems.slice(0, 30)) console.error(`  FAIL ${p}`);
  if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
  console.error(`\n${problems.length} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
