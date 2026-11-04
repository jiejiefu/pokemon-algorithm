/**
 * PokéFarm sound — a music director and a move-sound "foley" layer.
 *
 * Two kinds of audio, both from files under assets/audio/ (see its README for
 * where they come from and the licence they come with):
 *
 *   MUSIC  45 Pokémon Red/Blue tracks (original .m4a). One track plays at a time and
 *          a change cross-fades. `pickTrack(scene)` is a PURE function from a
 *          description of the game ({mode, season, dayIn, hazard, …}) to a track
 *          slug, so the "which song when" table can be read — and tested — without
 *          a browser. Jingles (the heal tune, the victory fanfares, the Hall of
 *          Fame) play once and hand back to the scene's normal track.
 *   SFX    328 Gen 1 move sounds. A worker finishing a job plays the move that
 *          suits the job (Cut for chopping, Dig for tilling, Water Gun for
 *          watering …) — and, about half the time, a move of the worker's own
 *          primary TYPE instead, so a Charmander's farm sounds different from a
 *          Squirtle's. Files that are parts or "direct" takes of a move
 *          (Thunder1, Thunder2, ThunderDirect …) are its VARIANTS and are mixed
 *          in at random, which is how every one of the 328 is reachable
 *          (scripts/check_pokefarm_audio.mjs proves it).
 *
 * Browser rules this respects: nothing makes a sound until the first pointer or
 * key press (autoplay policy); the tab being hidden pauses the music; a mute
 * switch and two volumes persist; `prefers-reduced-motion` has nothing to do
 * with sound so it is ignored on purpose; and every failure (404, decode error,
 * no AudioContext) is swallowed — the game is fully playable in silence.
 *
 * Playback limits so a busy farm is not a wall of noise: at most MAX_VOICES
 * sounds at once, MIN_GAP_MS between any two, MIN_SAME_MS between two of the
 * same file.
 */

const BASE = new URL('../audio/', import.meta.url).href;
const PREF_KEY = 'pokemon-algorithm:farm:audio';
const MAX_VOICES = 6;
const MIN_GAP_MS = 45;
const MIN_SAME_MS = 140;
const FADE_MS = 1400;
const DUCK = 0.22;

/* ============================================================ music tables */

/** What plays on each day of a season (index = day within the season − 1). */
export const DAY_TRACKS = {
  spring: ['pallet-town', 'road-viridian', 'viridian-forest', 'guide', 'road-cerulean', 'to-bill', 'cycling'],
  summer: ['vermilion-city', 'celadon-city', 'game-corner', 'silph-co', 'the-sea', 'ss-anne', 'road-lavender'],
  autumn: ['pewter-city', 'cerulean-city', 'gym', 'final-road', 'prof-oak', 'cycling', 'viridian-forest'],
  winter: ['mt-moon', 'lavender-town', 'cinnabar', 'pokemon-mansion', 'oaks-lab', 'guide', 'road-cerulean'],
};
/** The sky decides the soundtrack when something is actually happening. */
export const HAZARD_TRACKS = {
  bolt: 'rocket-hideout', flood: 'battle-wild', landfall: 'battle-gym-leader', frost: 'pokemon-tower', locust: 'battle-trainer',
};
/** Season result by stars (0–3), then the year's rating. */
export const SEASON_RESULT = ['jigglypuff', 'victory-wild', 'victory-trainer', 'victory-gym-leader'];
export const RUN_RESULT = { S: 'hall-of-fame', A: 'hall-of-fame', B: 'ending', C: 'ending' };
/** One-shot stingers (play over the music, which ducks). */
export const STINGERS = { hire: 'poke-flute', pest: 'trainer-boy', pestGirl: 'trainer-girl', locust: 'trainer-bad-guy', heal: 'pokemon-healed' };

/** Jingles: they play once, then the scene's normal track comes back. */
const ONE_SHOT = new Set(['victory-wild', 'victory-trainer', 'victory-gym-leader', 'jigglypuff', 'pokemon-healed', 'poke-flute', 'trainer-boy', 'trainer-girl', 'trainer-bad-guy', 'evolution']);

/**
 * scene → { track, then } (`then` = what follows a one-shot).
 *   mode: 'title' | 'morning' | 'day' | 'dusk' | 'season' | 'run'
 *   season, dayIn, day: where we are in the year; hazard: kind of a live hazard
 *   stars: 0–3 (season mode); rating: 'S'|'A'|'B'|'C' (run mode); reveal: bool
 */
export function pickTrack(scene = {}) {
  const { mode = 'title', season = 'spring', dayIn = 1, hazard = null, stars = 0, rating = 'C', reveal = false, last = false, locust = false } = scene;
  const normal = { track: DAY_TRACKS[season]?.[(dayIn - 1) % 7] || 'pallet-town' };
  switch (mode) {
    case 'title': return { track: 'title' };
    case 'morning': return { track: dayIn === 1 ? 'oaks-lab' : 'pokemon-center' };
    case 'day':
      if (hazard && HAZARD_TRACKS[hazard]) return { track: HAZARD_TRACKS[hazard], then: normal.track };
      if (locust) return { track: HAZARD_TRACKS.locust, then: normal.track };
      return last ? { track: 'final-battle' } : normal;
    case 'dusk': return { track: 'rival-appears' };               // the dusk table is you versus the four rival schedulers
    case 'season': return { track: SEASON_RESULT[Math.max(0, Math.min(3, stars))], then: 'pokemon-center' };
    case 'run': return reveal ? { track: 'evolution', then: RUN_RESULT[rating] } : { track: RUN_RESULT[rating] || 'ending' };
    default: return normal;
  }
}

/* =============================================================== sfx tables */

/**
 * Gen 1 families only. Adding Gen 2–7 files is not enough: these tables and
 * `check_pokefarm_audio.mjs`'s 328 count must change too. The raw multi-gen
 * packs live in `data-sources/audio-sources/` (gitignored).
 * The move that suits each job (a family name: its variants are mixed in).
 */
export const JOB_MOVES = {
  clear: ['cut', 'slash'], burn: ['ember', 'fire-spin'], till: ['dig', 'scratch', 'fury-swipes'], sow: ['pound', 'vine-whip', 'sand-attack'],
  weed: ['razor-leaf', 'vine-whip', 'cut'], shoo: ['leer', 'supersonic', 'screech', 'glare'], water: ['water-gun', 'bubble'],
  drawWater: ['bubble', 'bubblebeam', 'surf'], harvest: ['pound', 'double-slap', 'comet-punch', 'peck'], chop: ['cut', 'karate-chop', 'slash'],
  shake: ['body-slam', 'stomp', 'headbutt', 'strength'], canal: ['dig', 'earthquake', 'fissure'], cook: ['ember', 'softboiled', 'flamethrower'],
  sell: ['payday'],
};
/** A worker's own flavour: moves of its primary type (all 168 families appear in one list or another). */
export const TYPE_MOVES = {
  Normal: ['pound', 'tackle', 'scratch', 'slam', 'headbutt', 'body-slam', 'double-edge', 'take-down', 'hyper-beam', 'swift', 'strength', 'quick-attack', 'tail-whip', 'harden', 'minimize', 'defense-curl', 'barrage', 'comet-punch', 'double-slap', 'fury-attack', 'horn-attack', 'horn-drill', 'guillotine', 'vice-grip', 'wrap', 'bind', 'constrict', 'stomp', 'thrash', 'rage', 'struggle', 'tri-attack', 'sonicboom', 'sharpen', 'super-fang', 'skull-bash', 'splash', 'substitute', 'bide', 'egg-bomb', 'spike-cannon', 'focus-energy', 'double-team', 'mimic', 'transform', 'metronome', 'conversion'],
  Fire: ['ember', 'flamethrower', 'fire-punch', 'fire-spin', 'fire-blast', 'explosion', 'self-destruct', 'smoke-screen'],
  Water: ['water-gun', 'bubble', 'bubblebeam', 'surf', 'hydro-pump', 'waterfall', 'clamp', 'crabhammer', 'withdraw', 'mist', 'haze', 'acid-armor'],
  Electric: ['thunder-shock', 'thunder-wave', 'thunderbolt', 'thunder', 'thunder-punch', 'flash', 'agility'],
  Grass: ['vine-whip', 'razor-leaf', 'absorb', 'mega-drain', 'leech-seed', 'sleep-powder', 'stun-spore', 'spore', 'petal-dance', 'solar-beam', 'growth'],
  Ice: ['ice-beam', 'blizzard', 'ice-punch', 'aurora-beam', 'mist', 'haze'],
  Fighting: ['karate-chop', 'low-kick', 'jump-kick', 'high-jump-kick', 'rolling-kick', 'mega-punch', 'mega-kick', 'submission', 'seismic-toss', 'counter', 'double-kick', 'dizzy-punch', 'swords-dance'],
  Poison: ['poison-sting', 'poison-gas', 'poison-powder', 'poisoned', 'acid', 'sludge', 'smog', 'toxic', 'twin-needle'],
  Ground: ['dig', 'earthquake', 'fissure', 'sand-attack', 'bone-club', 'bonemerang'],
  Flying: ['peck', 'wing-attack', 'gust', 'fly-hit', 'fly-up', 'drill-peck', 'sky-attack', 'whirlwind', 'razor-wind'],
  Psychic: ['confusion', 'confused', 'psychic', 'psybeam', 'psywave', 'kinesis', 'teleport', 'hypnosis', 'meditate', 'disable', 'amnesia', 'light-screen', 'reflect', 'barrier', 'recover', 'rest', 'dream-eater', 'sleeping'],
  Bug: ['string-shot', 'leech-life', 'twin-needle', 'fury-attack', 'fury-swipes', 'spike-cannon', 'sonicboom'],
  Rock: ['rock-throw', 'rock-slide', 'earthquake', 'harden', 'rolling-kick'],
  Ghost: ['lick', 'night-shade', 'confuse-ray', 'sleeping', 'dream-eater', 'screech'],
  Dragon: ['dragon-rage', 'hyper-beam', 'thrash', 'bite', 'rage', 'glare'],
  Dark: ['bite', 'leer', 'glare', 'super-fang', 'hyper-fang', 'night-shade', 'sand-attack', 'screech'],
  Steel: ['harden', 'withdraw', 'barrier', 'sharpen', 'slash', 'guillotine', 'metronome', 'swift'],
  Fairy: ['sing', 'lovely-kiss', 'softboiled', 'confusion', 'recover', 'supersonic', 'metronome', 'double-team'],
};
/** Game events (not jobs): one or several candidate families, in order of use. */
export const EVENT_MOVES = {
  warnBolt: ['thunder-wave'], bolt: ['thunder', 'thunderbolt'], boltAbsorbed: ['absorb', 'recover'], boltHit: ['imhit-damage'],
  flood: ['surf', 'hydro-pump'], frost: ['blizzard', 'ice-beam'], landfall: ['whirlwind', 'razor-wind', 'earthquake'],
  pest: ['supersonic'], pestBite: ['bite'], pestShoo: ['leer'], locust: ['fury-swipes', 'string-shot'],
  fire: ['fire-spin'], ready: ['softboiled'], coin: ['payday'], lost: ['imhitweak-not-very-effective'], good: ['imhitsuper-super-effective'],
  orderOk: ['payday'], orderFail: ['imhitweak-not-very-effective'], buy: ['growth', 'swords-dance'], hire: ['teleport'], plot: ['dig'], tank: ['harden'],
  startDay: ['double-team'], dusk: ['rest'], assign: ['agility'], select: ['tail-whip'], refuse: ['struggle'], newSeason: ['conversion'],
  star: ['swift'], rateS: ['hyper-beam'], rateA: ['solar-beam'], rateB: ['fire-blast'], rateC: ['splash'], loaner: ['mimic'], lucky: ['metronome'],
};

/** Family of a manifest name: strip part numbers and "direct"/"single"/… takes. */
export function familyOf(name) {
  let n = name;
  for (;;) {
    const b = n.replace(/-?(?:\d+|direct|single|delay|full|shield|laser|loop|whit)$/, '');
    if (b === n || !b) return n;
    n = b;
  }
}
/** Every family name the tables above can ask for. */
export function referencedFamilies() {
  const s = new Set();
  for (const v of Object.values(JOB_MOVES)) v.forEach((x) => s.add(x));
  for (const v of Object.values(TYPE_MOVES)) v.forEach((x) => s.add(x));
  for (const v of Object.values(EVENT_MOVES)) v.forEach((x) => s.add(x));
  return s;
}
/** Every music slug a scene or stinger can ask for (used to prove all 45 are played). */
export function referencedTracks() {
  const s = new Set(['title', 'oaks-lab', 'pokemon-center', 'rival-appears', 'final-battle', 'evolution', 'hall-of-fame', 'ending', 'prof-oak']);
  for (const v of Object.values(DAY_TRACKS)) v.forEach((x) => s.add(x));
  Object.values(HAZARD_TRACKS).forEach((x) => s.add(x));
  SEASON_RESULT.forEach((x) => s.add(x));
  Object.values(RUN_RESULT).forEach((x) => s.add(x));
  Object.values(STINGERS).forEach((x) => s.add(x));
  return s;
}

/* ================================================================== runtime */

const prefs = { mute: false, music: 0.55, sfx: 0.8 };
let ctx = null;                       // AudioContext (SFX)
let sfxGain = null;
let manifest = null;                  // { name: seconds }
let manifestP = null;
let families = null;                  // family → [names]
const buffers = new Map();            // name → Promise<AudioBuffer|null>
const lastPlayed = new Map();         // name → performance.now()
let lastAny = 0;
let voices = 0;
let unlocked = false;
let defaultMuted = false;

/* music */
let cur = null;                       // { slug, el, once, then }
let scene = null;
let ducking = 0;                      // number of stingers playing
const fades = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.mute === 'boolean') prefs.mute = raw.mute;
      for (const k of ['music', 'sfx']) if (Number.isFinite(raw[k])) prefs[k] = Math.max(0, Math.min(1, raw[k]));
      return;
    }
  } catch { /* storage can throw */ }
  prefs.mute = defaultMuted;
}
function save() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* optional */ } }

/** Call once. `muted` is the site-wide mute (cries) used until the player chooses here. */
export function initAudio({ muted = false } = {}) {
  defaultMuted = muted;
  load();
  const wake = () => { unlock(); };
  addEventListener('pointerdown', wake, { once: true, capture: true });
  addEventListener('keydown', wake, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!cur) return;
    if (document.hidden) cur.el.pause(); else if (unlocked && !prefs.mute) cur.el.play().catch(() => {});
  });
}

export function unlock() {
  if (unlocked) return;
  unlocked = true;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = prefs.mute ? 0 : prefs.sfx;
    sfxGain.connect(ctx.destination);
    ctx.resume?.();
  } catch { ctx = null; }
  if (scene) setScene(scene, true);
}

export const isMuted = () => prefs.mute;
export const getPrefs = () => ({ ...prefs });
export function setMuted(m) {
  prefs.mute = !!m; save();
  if (sfxGain) sfxGain.gain.value = prefs.mute ? 0 : prefs.sfx;
  if (cur) { if (prefs.mute) cur.el.pause(); else if (unlocked) { cur.el.volume = musicVol(); cur.el.play().catch(() => {}); } }
}
export function setVolume(kind, v) {
  if (kind !== 'music' && kind !== 'sfx') return;
  prefs[kind] = Math.max(0, Math.min(1, v)); save();
  if (kind === 'sfx' && sfxGain && !prefs.mute) sfxGain.gain.value = prefs.sfx;
  if (kind === 'music' && cur) cur.el.volume = musicVol();
}
const musicVol = () => (prefs.mute ? 0 : prefs.music * (ducking > 0 ? DUCK : 1));

/* ---------------------------------------------------------------- music */

function ramp(el, to, ms, done) {
  const from = el.volume, t0 = performance.now();
  const f = { stop: false };
  fades.add(f);
  const tick = () => {
    if (f.stop) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) setTimeout(tick, 50); else { fades.delete(f); done?.(); }
  };
  tick();
}

function startTrack(slug, { once = false, then = null } = {}) {
  const el = new Audio(`${BASE}music/${slug}.m4a`);
  el.preload = prefs.mute ? 'none' : 'auto';       // muted: do not download tracks nobody will hear
  el.loop = !once;
  el.volume = 0;
  const entry = { slug, el, once, then };
  const old = cur;
  cur = entry;
  if (old) ramp(old.el, 0, FADE_MS, () => { old.el.pause(); old.el.src = ''; });
  if (!prefs.mute && unlocked && !document.hidden) {
    el.play().then(() => ramp(el, musicVol(), old ? FADE_MS : 500)).catch(() => {});
  }
  el.addEventListener('ended', () => {
    if (cur !== entry || !once) return;
    const next = entry.then || pickTrack(scene || {}).track;
    cur = null;
    startTrack(next);
  });
  el.addEventListener('error', () => { if (cur === entry) cur = null; });
}

/**
 * Tell the director what the game is doing; it plays the matching track (and
 * does nothing when that track is already playing).
 */
export function setScene(s, force = false) {
  scene = { ...s };
  if (!unlocked) return;                      // remembered; unlock() replays it
  const { track, then } = pickTrack(scene);
  if (!force && cur && cur.slug === track) return;
  startTrack(track, { once: ONE_SHOT.has(track), then });
}

/** Play a one-shot over the music, which ducks while it sounds. */
export function stinger(slug) {
  if (!unlocked || prefs.mute || !slug) return;
  const el = new Audio(`${BASE}music/${slug}.m4a`);
  el.volume = Math.min(1, prefs.music * 1.2);
  ducking += 1;
  if (cur) cur.el.volume = musicVol();
  const done = () => { ducking = Math.max(0, ducking - 1); if (cur) ramp(cur.el, musicVol(), 600); };
  el.addEventListener('ended', done, { once: true });
  el.addEventListener('error', done, { once: true });
  el.play().catch(done);
}

export const nowPlaying = () => (cur ? cur.slug : null);

/* ------------------------------------------------------------------ sfx */

function ensureManifest() {
  if (manifestP) return manifestP;
  manifestP = fetch(`${BASE}sfx/manifest.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((m) => {
    manifest = m;
    families = new Map();
    for (const n of Object.keys(m)) { const f = familyOf(n); if (!families.has(f)) families.set(f, []); families.get(f).push(n); }
    return m;
  });
  return manifestP;
}

function bufferFor(name) {
  if (!buffers.has(name)) {
    buffers.set(name, fetch(`${BASE}sfx/${name}.ogg`).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => (ab && ctx ? ctx.decodeAudioData(ab) : null)).catch(() => null));
  }
  return buffers.get(name);
}

/** Play one file by its manifest name. Quiet no-op when muted, locked or unknown. */
export async function playSfx(name, { vol = 1, rate = 1 } = {}) {
  if (!unlocked || prefs.mute || !ctx || !name) return false;
  const now = performance.now();
  if (voices >= MAX_VOICES || now - lastAny < MIN_GAP_MS || now - (lastPlayed.get(name) || 0) < MIN_SAME_MS) return false;
  lastAny = now; lastPlayed.set(name, now);
  await ensureManifest();
  if (!manifest[name]) return false;
  const buf = await bufferFor(name);
  if (!buf || prefs.mute) return false;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.value = rate;
  g.gain.value = Math.max(0, Math.min(1.5, vol));
  src.connect(g).connect(sfxGain);
  voices += 1;
  src.addEventListener('ended', () => { voices -= 1; });
  src.start();
  return true;
}

/** A random member of a family: the plain move most of the time, a variant now and then. */
export function pickVariant(family, rng = Math.random) {
  const list = families?.get(family);
  if (!list) return family;                   // manifest not loaded yet: try the family name itself
  if (list.length === 1) return list[0];
  const main = list.includes(family) ? family : list[0];
  return rng() < 0.65 ? main : list[Math.floor(rng() * list.length)];
}
const pickOf = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

/** A named game event (EVENT_MOVES key): plays the first candidate or a random one. */
export function sfx(event, opts = {}) {
  const c = EVENT_MOVES[event];
  if (!c) return false;
  ensureManifest().then(() => playSfx(pickVariant(pickOf(c)), opts));
  return true;
}

/** A worker finished a job: the job's move, or (≈50%) one of the worker's type. */
export function jobSfx(job, type = 'Normal') {
  const pool = JOB_MOVES[job];
  if (!pool) return false;
  const useType = Math.random() < 0.5 && TYPE_MOVES[type];
  const fam = useType ? pickOf(TYPE_MOVES[type]) : pickOf(pool);
  ensureManifest().then(() => playSfx(pickVariant(fam), { vol: useType ? 0.55 : 0.8, rate: 0.95 + Math.random() * 0.1 }));
  return true;
}

/** The family list the "sound test" shows: [{ family, names:[…] }] sorted. */
export async function soundTest() {
  await ensureManifest();
  return [...families.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([family, names]) => ({ family, names }));
}
