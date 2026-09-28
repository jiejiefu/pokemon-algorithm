/**
 * 3D model viewer for model3d.html.
 *
 * The page is deliberately built around 0/1/N clips, not the nine that 1.glb
 * happens to ship, because the two models on disk disagree about almost
 * everything:
 *
 *   1.glb  541 KB  9 clips  model_skeleton|001aidle ...  root 001_0           scale 109.50
 *   25.glb 146 KB  1 clip   Impactrueno                 root GLTF_created_0 scale 4.53
 *
 * Two consequences a hardcoded assumption would get wrong:
 *
 *  1. CLIP NAMES are not a shared vocabulary. `1.glb` is
 *     `model_skeleton|001<token>`; `25.glb` is a bare name with no skeleton
 *     prefix at all, and most of the rest of the roster carries one clip or
 *     none. Nothing in the name states the motion, so a label is a lookup with
 *     a prefix fallback AND THE RAW NAME IS ALWAYS SHOWN beside it. A label is
 *     a reading aid, never the only record of what the file contains.
 *
 *  2. SCALE. The two root nodes differ by 24x (109.50 vs 4.53) and that ratio
 *     is an artefact of the DCC export unit, not of the creatures. A camera
 *     position tuned against 1.glb frames 25.glb as a speck. So nothing here is
 *     a constant: the model is normalised to TARGET_HEIGHT and the camera is
 *     placed from the measured bounding box. Do not "simplify" that into a
 *     hardcoded camera — it is why this file is longer than it looks.
 *
 * The accessor min/max in the GLB JSON are NOT the body's extent either. 1.glb
 * reports POSITION min [-0.25, 0.25, 0.32] / max [0.24, 0.46, 0.48] for a
 * creature 55 units tall, because those bounds belong to the joint leaves. The
 * box has to be read off the loaded object.
 *
 * Three.js and its addons are imported by BARE specifier and resolved by the
 * importmap in model3d.html, not by a path here. That is deliberate: pointing
 * the importmap at locally vendored copies later is a change to model3d.html
 * alone and touches nothing in this module.
 */

import { hasGlb } from './glb-index.js';
import { readThemeToken, ASSETS } from './shared.js';

import {
  Scene, PerspectiveCamera, WebGLRenderer, Group,
  Box3, Vector3, Color, DirectionalLight, HemisphereLight,
  Mesh, CircleGeometry, ShadowMaterial, ACESFilmicToneMapping, SRGBColorSpace,
  PCFSoftShadowMap, MathUtils, AnimationMixer, LoopOnce, LoopRepeat
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Pinned in the importmap. Bumping three.js is a version-bump decision, not a
 *  silent one — the addon paths move between releases. */
export const THREE_VERSION = '0.180.0';

/** Draco decoder, served from gstatic. Both models declare
 *  `KHR_draco_mesh_compression` in `extensionsRequired`, so this is not
 *  optional; check_glb.mjs fails if that ever stops being true. The
 *  `Access-Control-Allow-Origin: *` these files carry is load-bearing rather
 *  than incidental: the decoder is instantiated with
 *  WebAssembly.instantiateStreaming, which refuses a cross-origin response
 *  without it. */
export const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

/** Every model is scaled to roughly this tall, in world units, so the camera,
 *  the ground plane and the shadow frustum are all model-independent.
 *  Bulbasaur at 55 units and Pikachu at 4.5 units both land here. */
const TARGET_HEIGHT = 1.7;

/**
 * Chinese labels for clip tokens this project has actually seen.
 *
 * The suffix entries are DELIBERATE and are the point of the table:
 * `fight_b`, `fight_d`, `jump_e`, `jump_l` and `jump_s` do not say what they
 * mean. A duration reading says nothing either — `jump_e` and `jump_l` are both
 * 0.750s, `jump_s` is 0.542s, and `run` is 0.375s, the SHORTEST clip in the
 * file, which no reading of "run" predicts. So the raw name is always rendered
 * beside the label and nobody has to take a guess on faith. Add a key only for
 * a token whose meaning is actually known.
 */
const ANIM_LABELS = {
  idle: '待機',
  walk: '行走',
  run: '奔跑',
  jump: '跳躍',
  fight: '戰鬥',
  attack: '攻擊',
  ko: '倒地',
  die: '倒地',
  impact: '衝撞'
};

/**
 * Reduce a clip name to the token the label table is keyed on.
 *
 * `model_skeleton|001aidle` -> `aidle`;  `Impactrueno` -> `Impactrueno`.
 *
 * The digit strip is why the leading `0*` is there: without it `001aidle` would
 * yield `1aidle` and match nothing. It is a heuristic on an export artefact, so
 * the caller must keep the raw name visible whatever this returns.
 */
export function clipToken(name) {
  const tail = name.includes('|') ? name.slice(name.lastIndexOf('|') + 1) : name;
  const m = tail.match(/^0*\d*[_-]?(.+)$/);
  return m ? m[1] : tail;
}

/**
 * Resolve a clip name to `{ token, label }`, where `label` is null when nothing
 * is known about it.
 *
 * NOTE the leading `a`. Every clip in 1.glb is `model_skeleton|001a` + token —
 * `001aidle`, `001ako`, `001awalk` — so the exporter puts a literal `a` between
 * the zero-padded index and the token, and nine for nine. Treating it as part of
 * the token means NO label resolves, and the page still looks completely
 * functional because every button falls back to its raw name. That is why the
 * strip lives here and in a candidate list rather than inside clipToken():
 * clipToken only claims to remove things it can justify (the arm prefix and the
 * zero padding), while `a` is an inference — it happens to leave a known word
 * behind all nine times, which is the whole of the evidence.
 *
 * Candidates are tried in order and the FIRST that resolves wins, so a token
 * that is already a label is never re-stripped. A miss returns null rather than
 * a guess, which is what keeps `aerial` from becoming `erial`.
 *
 * @returns {{token: string, label: string|null}}
 */
export function clipLabel(name) {
  const token = clipToken(name);
  const candidates = [token];
  if (token.startsWith('a') && token.length > 1) candidates.push(token.slice(1));
  const base = token.split('_')[0];
  if (base !== token) candidates.push(base);
  if (base.startsWith('a') && base.length > 1) candidates.push(base.slice(1));

  for (const c of candidates) {
    if (ANIM_LABELS[c]) return { token, label: ANIM_LABELS[c] };
  }
  return { token, label: null };
}

/** Read a CSS custom property as a colour, for the WebGL side. */
function tokenColor(name, fallback) {
  const raw = readThemeToken(name);
  return raw ? new Color(raw) : new Color(fallback);
}

/** True when the visitor asked for less motion. The viewer still works; it just
 *  opens paused on frame 0 rather than running a loop on load. */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The viewer: WebGL context, scene graph, clock and current model.
 *
 * A plain object rather than a class because there is exactly one viewer per
 * page and nothing subclasses it; these fields are the whole API.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.mount   sized element the canvas is appended to
 * @param {(p: number, state: Object) => void} [opts.onFrame]
 *   called every rendered frame with playback progress 0..1
 * @param {(message: string) => void} [opts.onContextLost]
 * @param {(message: string) => void} [opts.onContextRestored]
 */
export function createViewer({ mount, onFrame, onContextLost, onContextRestored }) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.className = 'm3d-canvas';
  mount.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.05, 60);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  // Never under the ground plane: orbiting below it shows the back of the
  // shadow disc, which reads as a broken scene rather than a low angle.
  controls.maxPolarAngle = Math.PI * 0.495;

  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(2.2, 3.4, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  // A fixed frustum, valid because every model is normalised to TARGET_HEIGHT
  // (see the header). A per-model shadow camera would be a second thing to get
  // right for no visible gain.
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -0.6, near: 0.5, far: 12 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new DirectionalLight(0xffffff, 0.75);
  fill.position.set(-2.6, 1.4, -1.8);
  scene.add(fill);

  const hemi = new HemisphereLight(0xffffff, 0x2a2a30, 0.5);
  scene.add(hemi);

  // Contact shadow. Cheap, and it is what stops the model reading as a sticker
  // floating in a void. The colour stays black in both themes — a "shadow"
  // tinted to the text colour is a glow — so only opacity tracks the theme.
  const shadow = new Mesh(
    new CircleGeometry(1.1, 48),
    new ShadowMaterial({ color: 0x000000, opacity: 0.32 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.receiveShadow = true;
  scene.add(shadow);

  const state = {
    mixer: null,
    actions: [],
    clips: [],
    activeIndex: -1,
    pivot: null,
    loop: true,
    playing: false,
    timeScale: 1,
    reduced: prefersReducedMotion(),
    raf: 0,
    disposed: false
  };

  let last = performance.now();
  let loadToken = 0;

  /**
   * A canvas cannot see `var(--x)`, so the clear colour, the light tint and the
   * hemisphere ground are all read per repaint — the same reason
   * `readThemeToken()` exists for the radar canvas (gotcha 14) and
   * `wallColor()` for the maze (gotcha 35). Wired to `themechange`, not just to
   * load, or switching themes leaves a dark canvas on a light page.
   */
  function applyTheme() {
    renderer.setClearColor(tokenColor('--bg-primary', '#0d1117'));
    const tint = tokenColor('--text-primary', '#f0f6fc');
    key.color.copy(tint);
    fill.color.copy(tint);
    hemi.groundColor.copy(tokenColor('--bg-secondary', '#161b22'));
    // A dark background swallows the shadow, so it needs more of one to read at
    // all; a light page shows the same disc at half the strength.
    shadow.material.opacity = currentIsLight() ? 0.2 : 0.36;
    shadow.material.needsUpdate = true;
  }

  function currentIsLight() {
    return document.documentElement.dataset.theme === 'light';
  }
  applyTheme();

  /** Release everything the current model owns. Called before the next load so
   *  stepping through ids does not leak a scene graph per navigation — the bug
   *  a loader that only ever runs once cannot catch. */
  function disposeModel() {
    if (state.mixer) {
      state.mixer.stopAllAction();
      if (state.pivot) state.mixer.uncacheRoot(state.pivot);
      state.mixer = null;
    }
    if (state.pivot) {
      state.pivot.traverse(o => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if (!m) return;
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose();
        });
      });
      scene.remove(state.pivot);
      state.pivot = null;
    }
    state.actions = [];
    state.clips = [];
    state.activeIndex = -1;
  }

  function resize() {
    const w = Math.max(1, mount.clientWidth);
    const h = Math.max(1, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /**
   * 0..1 through the active clip, or 0 when nothing is loaded.
   *
   * The wrap is CONDITIONAL, and the condition is load-bearing. `action.time`
   * keeps counting past the end of a looping clip, so it needs a modulo — but a
   * one-shot does not loop, and `clampWhenFinished` parks its `action.time` on
   * exactly `duration`. `duration % duration` is 0, so an unconditional modulo
   * reports a clip that is sitting on its LAST FRAME as 0% complete: the bar
   * empties, the readout says `0.00s / 4.50s`, and the two together look like a
   * viewer that failed to start rather than one that finished. Clamp instead.
   */
  function progressFraction() {
    const action = state.actions[state.activeIndex];
    if (!action) return 0;
    const total = action.getClip().duration || 1;
    const t = state.loop ? action.time % total : Math.min(action.time, total);
    return MathUtils.clamp(t / total, 0, 1);
  }

  /**
   * True when a non-looping action has run past its last frame.
   *
   * `clampWhenFinished` parks `action.time` on the clip's duration, so the test
   * is `>=` against the duration and not against the total frame count — those
   * are different numbers (`duration` is seconds, `time` is seconds, and the
   * frame count is only reachable through `getClip().duration * fps`). A 1e-4
   * tolerance because the last `mixer.update()` overshoots by up to one frame's
   * worth of delta, which at a 2x speed setting and a dropped frame is a
   * measurable fraction of a second.
   */
  function atClipEnd() {
    const action = state.actions[state.activeIndex];
    if (!action) return false;
    const total = action.getClip().duration || 0;
    return total > 0 && action.time >= total - 1e-4;
  }

  /**
   * Push the current time scale onto every clip action.
   *
   * `AnimationMixer` has no `setTimeScale` — the time scale is per-ACTION, via
   * `AnimationAction.setEffectiveTimeScale`, and a mixer created fresh for each
   * model means the scale has to be re-applied to every action on every load,
   * not stored once. Setting it on the mixer silently does nothing (there is no
   * such method, so it throws on the first frame instead, sixty times a second).
   */
  function applyTimeScale() {
    for (const a of state.actions) a.setEffectiveTimeScale(state.timeScale);
  }

  /**
   * WebGL context loss.
   *
   * A lost context leaves the canvas showing the last composited frame, and the
   * default on `webglcontextrestored` is to do nothing — three.js rebuilds its
   * own GL state, but only the app knows what the visitor should be told. Both
   * events are prevented so the browser is allowed to restore rather than
   * treating the loss as permanent, and a mobile tab that is backgrounded
   * (which is where context loss mostly comes from) then recovers by itself.
   * Without `preventDefault()` the restore event never fires, so a listener
   * that only reported the loss would leave the page stuck.
   */
  function onContextLost(e) {
    e.preventDefault();
    if (onContextLost) onContextLost('3D 畫面暫時中斷，正在等待重新載入…');
  }
  function onContextRestored() {
    // Re-apply everything the new context lost: the clear colour, the light
    // tints and the shadow opacity are all context-independent GL state, but
    // the shader programs behind them were just rebuilt.
    applyTheme();
    renderer.render(scene, camera);
    if (onContextRestored) onContextRestored('');
  }
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

  function frame() {
    if (state.disposed) return;
    state.raf = requestAnimationFrame(frame);
    const now = performance.now();
    // Cap the delta so a backgrounded tab does not resume with one enormous
    // step — a 30 second gap would otherwise fast-forward the whole clip.
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (state.mixer && state.playing) {
      state.mixer.update(dt);
      // A one-shot that reached its end clamps on the last frame. Nothing would
      // otherwise move it off that frame, so `playing` stayed true and the
      // button kept reading 暫停 over a clip that is over. Reset instead of
      // holding: the control is play/pause, and a paused-at-the-end clip is
      // indistinguishable from a stuck one.
      if (!state.loop && atClipEnd()) state.playing = false;
    }
    // Damping needs a tick every frame whether or not anything is animating,
    // or the camera freezes mid-glide when playback is paused.
    controls.update();
    renderer.render(scene, camera);
    if (onFrame) onFrame(progressFraction(), state);
  }

  /**
   * Scale the model to TARGET_HEIGHT, stand it on y = 0, and place the camera.
   *
   * Two measuring passes, because scaling about the origin moves the box: the
   * second pass reads `min.y` from the SCALED model, not the raw one. The
   * wrapper Group is what makes this re-runnable — the model's own root scale
   * (109.5 or 4.53) is left untouched, so a second call cannot compound.
   */
  function normaliseAndFrame(model) {
    const pivot = new Group();
    pivot.add(model);
    // Reparenting does NOT remove the old wrapper from the scene: `add()`
    // moves `model` out of the previous pivot, which is then an empty Group
    // still sitting in the scene graph. resetView() runs this again, so
    // without this line every press of 重設視角 strands another node.
    if (state.pivot && state.pivot !== pivot) scene.remove(state.pivot);
    // ...and the new one has to be ADDED, which is the line whose absence is
    // invisible from every signal the page can report. The mixer still runs,
    // the clips still parse, the camera is still placed from a correct box, the
    // canvas is still cleared to the theme colour and `renderer.render` is
    // still called sixty times a second — an empty scene renders identically to
    // a populated one that happens to be entirely out of frame. The stage is
    // just flat, with no error anywhere.
    scene.add(pivot);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    pivot.updateMatrixWorld(true);

    const first = new Box3().setFromObject(pivot);
    const pivotScale = TARGET_HEIGHT / Math.max(first.getSize(new Vector3()).y, 1e-6);
    pivot.scale.setScalar(pivotScale);
    pivot.updateMatrixWorld(true);

    const scaled = new Box3().setFromObject(pivot);
    // Stand it on the ground plane rather than centring it: a creature whose
    // feet sit at the centre of frame floats above its own shadow.
    pivot.position.y -= scaled.min.y;
    pivot.updateMatrixWorld(true);

    const framed = new Box3().setFromObject(pivot);
    const centre = framed.getCenter(new Vector3());
    const size = framed.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.2);

    // Frame on the bounding SPHERE, not the height, so a model twice as wide as
    // it is tall (Pikachu) is not cropped the way a height-only fit crops it.
    const distance = (radius / Math.sin(MathUtils.degToRad(camera.fov * 0.5))) * 1.15;
    controls.target.copy(centre);
    camera.position.set(centre.x, centre.y + radius * 0.18, centre.z + distance);
    camera.near = Math.max(distance * 0.01, 0.01);
    camera.far = distance * 12;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.6;
    controls.maxDistance = radius * 6;
    controls.update();

    state.pivot = pivot;
    return pivot;
  }

  /**
   * Put one action into the current loop mode.
   *
   * `AnimationAction.setLoop(mode, repetitions)` — BOTH arguments, and the
   * second one is the number of repeats after the first run, not a duration, a
   * weight or a loop index. The first version of this file called
   * `setLoop(Infinity, 0)` for "loop forever" and `setLoop(1, 1)` for
   * "play once", and both are wrong in a way that still mostly runs:
   *
   *   - `LoopOnce`/`LoopRepeat`/`LoopPingPong` are 0/1/2, so `Infinity` is not
   *     a mode at all, and `1` is LoopRepeat rather than "once".
   *   - `repetitions = 0` means "run the first pass and stop", which is exactly
   *     what the branch was trying to avoid.
   *
   * A nine-clip model therefore played its opening 待機 once, parked on
   * `action.time === duration` — 1.667s — and stayed there: the time readout
   * read `0.00s / 1.67s` because the wrap is a modulo, the progress bar read
   * 0%, and the 循環 button claimed to be on. Nothing errored, the model
   * rendered, the clips were all listed and every one was selectable, because
   * the loop mode only controls whether the mixer wraps — it is invisible in
   * every other state on the page.
   */
  function applyLoopMode(action) {
    action.setLoop(state.loop ? LoopRepeat : LoopOnce, state.loop ? Infinity : 1);
    action.clampWhenFinished = !state.loop;
  }

  /** Make clip `i` the only active action. */
  function selectClip(i) {
    if (!state.mixer || i < 0 || i >= state.actions.length) return;
    state.actions.forEach((a, k) => { if (k !== i) a.stop(); });

    const action = state.actions[i];
    action.reset();
    applyLoopMode(action);
    // Fade rather than snap, so switching 待機 -> 行走 does not teleport every
    // bone to its new value in a single frame.
    action.fadeIn(0.25).play();
    state.activeIndex = i;
    setPlaying(!state.reduced);
  }

  function setPlaying(on) {
    const action = state.actions[state.activeIndex];
    if (!action) return;
    const next = !!on;
    // Pressing 播放 on a one-shot that has finished has to restart it, and
    // `play()` alone does not: an action whose repetitions are exhausted and
    // whose `clampWhenFinished` is holding the last frame is not paused, so
    // there is nothing for play() to un-pause. Without this the button snapped
    // back to 暫停 on the next frame and the same final pose sat on screen for
    // the rest of the visit — a play control that cannot replay what it just
    // played. reset() is the only thing that rewinds `time`, and it also clears
    // `repetitions` and `clampWhenFinished`, hence the re-apply.
    if (next && !state.loop && atClipEnd()) {
      action.reset();
      applyLoopMode(action);
      action.fadeIn(0.25).play();
    }
    state.playing = next;
    action.paused = !state.playing;
  }

  function setTimeScale(v) {
    // Linear, and it is a plain multiplier. Do not copy maze.html's quadratic
    // slider here: that curve exists to make 0.1x-10x algorithm pacing usable
    // (gotcha 33), and this control only spans 0.1x-2x, where a curve would
    // make the top half of the travel feel dead.
    state.timeScale = MathUtils.clamp(Number(v) || 1, 0.05, 4);
    applyTimeScale();
  }

  function setLoop(on) {
    state.loop = !!on;
    const action = state.actions[state.activeIndex];
    if (!action) return;
    applyLoopMode(action);
  }

  function setAutoRotate(on) {
    controls.autoRotate = !!on;
    controls.autoRotateSpeed = 1.6;
  }

  function resetView() {
    // Re-frame the MODEL, not the pivot: normaliseAndFrame wraps whatever it is
    // given in a fresh Group and reparents it, so handing it the pivot would
    // nest a Group inside a Group and the second call's scale would compound
    // with the first. `children[0]` is the gltf.scene because load() passes the
    // bare scene in.
    if (state.pivot) normaliseAndFrame(state.pivot.children[0]);
  }
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  /**
   * Load the model for `id` and rebuild playback around whatever clips it has.
   * Resolves to a status object; it never throws, because a page that dies on a
   * missing model is worse than one that says which id is missing.
   */
  async function load(id) {
    disposeModel();
    resize();

    if (!hasGlb(id)) {
      renderer.render(scene, camera);
      return { ok: false, reason: 'missing', id };
    }

    // Two loads can be in flight at once: the picker's change handler does not
    // wait, and a 541 KB Draco decode is slow enough that flipping through ids
    // outruns it. loadAsync resolves in completion order, not call order, so
    // without this the SLOWER earlier request would win and leave Bulbasaur on
    // screen under Pikachu's name. A token, not a boolean: three rapid
    // A -> B -> C leaves two stale tokens, and a flag would be cleared by B
    // arriving after C.
    const token = ++loadToken;

    let gltf;
    try {
      gltf = await gltfLoader.loadAsync(`${ASSETS.glbs}${id}.glb`);
    } catch (error) {
      // A request superseded by a newer one is not a failure — it is the
      // expected outcome of switching ids mid-decode, and reporting it would
      // put an error in the console for a load nobody is waiting on.
      if (token !== loadToken) return { ok: false, reason: 'superseded', id };
      console.error('model3d: load failed', error);
      renderer.render(scene, camera);
      return { ok: false, reason: 'error', id, error };
    }
    if (token !== loadToken) return { ok: false, reason: 'superseded', id };

    normaliseAndFrame(gltf.scene);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      // The model is rescaled by a known constant and the animations move it
      // within that box; culling it against the pre-animation bounds is how a
      // 1.7-unit model ends up disappearing at some poses.
      o.frustumCulled = false;
    });

    state.clips = gltf.animations || [];
    if (state.clips.length) {
      state.mixer = new AnimationMixer(state.pivot);
      state.actions = state.clips.map(clip => state.mixer.clipAction(clip));
      // A lone clip is a one-shot — Pikachu's 4.5s Impactrueno visibly
      // restarts on loop — so loop defaults OFF there and ON for a pose
      // library like 1.glb's nine. A default, not a rule: it is a toggle.
      state.loop = state.clips.length > 1;
      // Before selectClip, because selectClip fades the action in and the
      // effective time scale is a property of the action, not of the mixer.
      applyTimeScale();
      selectClip(0);
    }

    applyTheme();
    renderer.render(scene, camera);
    return { ok: true, id, clips: state.clips };
  }

  last = performance.now();
  state.raf = requestAnimationFrame(frame);

  return {
    state,
    load,
    selectClip,
    setPlaying,
    setTimeScale,
    setLoop,
    setAutoRotate,
    resetView,
    onThemeChange() {
      applyTheme();
      renderer.render(scene, camera);
    },
    progressFraction,
    dispose() {
      state.disposed = true;
      cancelAnimationFrame(state.raf);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      disposeModel();
      renderer.dispose();
      renderer.domElement.remove();
      draco.dispose();
    }
  };
}
