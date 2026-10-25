/**
 * Pattern model for cry-studio.html — pure data, no Web Audio, no DOM.
 *
 * Why this is its own file
 * ------------------------
 * The audio engine, the canvas editor and the share-link code all have to agree
 * on what "a pattern" is, and the only way that stays true is for the shape to
 * live in one place that none of them owns. Nothing here touches `window`, so
 * `node --input-type=module` can import it and the serialiser round-trip is
 * testable without a browser.
 *
 * The grid
 * --------
 * Rows are SCALE DEGREES, not semitones. Row 0 is the lowest; with a 5-note
 * pentatonic scale a two-octave grid is 11 rows (root, 4 notes, root, 4 notes,
 * root), with the chromatic scale it is 25. A note stores `row`, so changing the
 * scale re-pitches every note instead of leaving it stranded between the cells
 * of a grid that no longer has a row there. That is the whole reason notes are
 * not stored as MIDI numbers: the point of the page is that anything you place
 * lands on a pitch that belongs.
 *
 * Time is in STEPS, a step being a sixteenth note. `steps` is the loop length
 * (16, 32 or 64). `len` is a note's length in steps.
 *
 * Drum lanes are rows of velocities, one digit per step: 0 off, 1 ghost, 2 normal,
 * 3 accent. The lane's `name` is a Strudel sound name (bd, sd, hh ...) on purpose:
 * `strudel.json` sample maps key their files by exactly these names, so a lane
 * and a Strudel `s("bd")` mean the same thing and `toStrudel()` below can write a
 * pattern a reader can paste into strudel.cc.
 */

export const STEP_OPTIONS = [16, 32, 64];
export const MAX_NOTES = 400;

/** Scale name → semitone offsets inside one octave. Labels are what the page shows. */
export const SCALES = {
  'pent-minor': { label: '小調五聲', intervals: [0, 3, 5, 7, 10] },
  'pent-major': { label: '大調五聲', intervals: [0, 2, 4, 7, 9] },
  miyako: { label: '都節（日本）', intervals: [0, 1, 5, 7, 8] },
  ryukyu: { label: '琉球', intervals: [0, 4, 5, 7, 11] },
  major: { label: '大調', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: '自然小調', intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: '多利亞', intervals: [0, 2, 3, 5, 7, 9, 10] },
  blues: { label: '藍調', intervals: [0, 3, 5, 6, 7, 10] },
  whole: { label: '全音', intervals: [0, 2, 4, 6, 8, 10] },
  chromatic: { label: '半音', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Lane order is also the order on screen. `name` is the Strudel sound name. */
export const DRUM_LANES = [
  { name: 'cp', label: '拍手' },
  { name: 'oh', label: '開鈸' },
  { name: 'hh', label: '閉鈸' },
  { name: 'sd', label: '小鼓' },
  { name: 'bd', label: '大鼓' },
];

/** The base MIDI note of row 0 before the octave knob. C4 — see engine docblock
 *  for why: most cries sit between 250 and 1100 Hz, so C4..C6 keeps the
 *  auto-tune ratio close to 1 instead of asking for a four-octave drop. */
export const BASE_MIDI = 60;

export const DEFAULT_FX = Object.freeze({
  cryVol: 0.8, drumVol: 0.8, master: 0.8, duck: 0,
  drive: 0, crush: 0, filterType: 'lowpass', cutoff: 18000, reso: 0.7,
  wahRate: 0, wahDepth: 0,
  delayDiv: 3, delayFb: 0.35, delayCry: 0, delayDrum: 0,
  reverbSize: 1.6, reverbCry: 0, reverbDrum: 0,
});

/** Slider ranges — one table, so the UI, the clamp on import and the tests agree. */
export const FX_RANGES = {
  cryVol: [0, 1], drumVol: [0, 1], master: [0, 1], duck: [0, 1],
  drive: [0, 1], crush: [0, 1], cutoff: [120, 18000], reso: [0.3, 14],
  wahRate: [0, 8], wahDepth: [0, 1],
  delayDiv: [0, 3], delayFb: [0, 0.9], delayCry: [0, 1], delayDrum: [0, 1],
  reverbSize: [0.4, 4], reverbCry: [0, 1], reverbDrum: [0, 1],
};
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'];
/** Delay time as a number of steps, indexed by `delayDiv`: 1/16, 1/8, 3/16, 1/4. */
export const DELAY_STEPS = [1, 2, 3, 4];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** A fresh, empty pattern. */
export function emptyPattern(steps = 32) {
  return {
    v: 1,
    bpm: 100,
    steps,
    swing: 0,
    scale: 'pent-minor',
    key: 9, // A
    octave: 0,
    tune: 'auto', // 'auto' | 'raw'
    gate: 'note', // 'note' | 'free'
    bank: '',
    notes: [],
    drums: DRUM_LANES.map((l) => ({ name: l.name, n: 0, mute: false, steps: '0'.repeat(steps) })),
    fx: { ...DEFAULT_FX },
  };
}

export const rowCount = (pattern) => SCALES[pattern.scale].intervals.length * 2 + 1;

/** MIDI note number for a grid row. */
export function rowToMidi(pattern, row) {
  const iv = SCALES[pattern.scale].intervals;
  const oct = Math.floor(row / iv.length);
  return BASE_MIDI + pattern.key + pattern.octave * 12 + oct * 12 + iv[row % iv.length];
}
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const midiName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
/** Strudel / Tidal spell sharps `c#4`; flats would need a second table for no gain. */
export const midiStrudel = (m) => midiName(m).toLowerCase();

/** Is this row a root of the scale? The editor shades these. */
export function rowIsRoot(pattern, row) {
  return row % SCALES[pattern.scale].intervals.length === 0;
}

/** Resize a pattern's loop length, truncating or padding every lane. Notes that
 *  would start past the new end are dropped; notes that run past it are clipped. */
export function resizeSteps(pattern, steps) {
  if (!STEP_OPTIONS.includes(steps)) return pattern;
  pattern.steps = steps;
  pattern.notes = pattern.notes
    .filter((n) => n.step < steps)
    .map((n) => ({ ...n, len: Math.min(n.len, steps - n.step) }));
  for (const lane of pattern.drums) lane.steps = lane.steps.slice(0, steps).padEnd(steps, '0');
  return pattern;
}

/** After a scale change the row count changes, so clamp rather than lose notes. */
export function clampRows(pattern) {
  const max = rowCount(pattern) - 1;
  for (const n of pattern.notes) n.row = clamp(n.row, 0, max);
  // Two notes can now share a cell; keep the later one so nothing sounds twice.
  const seen = new Map();
  for (const n of pattern.notes) seen.set(`${n.step}:${n.row}`, n);
  pattern.notes = [...seen.values()];
  return pattern;
}

export const noteAt = (pattern, step, row) => pattern.notes.find((n) => n.step === step && n.row === row) || null;

/** The note whose body covers (step,row) — a held note is clickable along its
 *  whole length, not just its first cell. */
export function noteCovering(pattern, step, row) {
  return pattern.notes.find((n) => n.row === row && step >= n.step && step < n.step + n.len) || null;
}

/** Place a note; replaces whatever starts in that cell. Returns the note, or
 *  null at the cap — the cap is what keeps a share link under a few KB. */
export function placeNote(pattern, { id, step, row, len = 2, vel = 2 }) {
  if (step < 0 || step >= pattern.steps || row < 0 || row >= rowCount(pattern)) return null;
  const existing = noteAt(pattern, step, row);
  if (!existing && pattern.notes.length >= MAX_NOTES) return null;
  const note = { id, step, row, len: clamp(len, 1, pattern.steps - step), vel };
  if (existing) Object.assign(existing, note);
  else pattern.notes.push(note);
  return existing || note;
}

export function removeNote(pattern, note) {
  const i = pattern.notes.indexOf(note);
  if (i >= 0) pattern.notes.splice(i, 1);
}

/** Cycle a drum cell: off → normal → accent → ghost → off. Returns the new digit. */
export function cycleDrum(pattern, lane, step) {
  const s = pattern.drums[lane].steps;
  const next = { 0: 2, 2: 3, 3: 1, 1: 0 }[Number(s[step])];
  pattern.drums[lane].steps = s.slice(0, step) + next + s.slice(step + 1);
  return next;
}
export function setDrum(pattern, lane, step, vel) {
  const s = pattern.drums[lane].steps;
  pattern.drums[lane].steps = s.slice(0, step) + vel + s.slice(step + 1);
}

/* ---------------------------------------------------------------- euclid */

/** Bjorklund-by-accumulator: spreads `k` hits across `n` steps as evenly as
 *  possible. It is the rhythm generator Strudel's `(3,8)` mini-notation is named
 *  after, so the 🎲 button and a Strudel reader are talking about one thing. */
export function euclid(k, n, rot = 0) {
  const out = new Array(n).fill(0);
  if (k <= 0 || n <= 0) return out;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += k;
    if (acc >= n) { acc -= n; out[(i + rot) % n] = 1; }
  }
  return out;
}

/** mulberry32 — a tiny seeded PRNG, so "random" patterns are reproducible from a
 *  seed shown to the reader and a bug report can say which one. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh random song: euclidean drums, a random-walk melody on the scale, and
 *  a small cast of species drawn from `ids`. Returns a new pattern. */
export function randomPattern(seed, ids, { steps = 32 } = {}) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const p = emptyPattern(steps);
  p.bpm = Math.round(80 + r() * 60);
  p.scale = pick(['pent-minor', 'pent-major', 'miyako', 'dorian', 'blues', 'ryukyu']);
  p.key = Math.floor(r() * 12);
  p.swing = r() < 0.4 ? 0.2 : 0;

  const cast = Array.from({ length: 3 + Math.floor(r() * 3) }, () => pick(ids));
  const rows = rowCount(p);
  let row = Math.floor(rows / 2);
  let step = 0;
  while (step < steps) {
    const gap = pick([1, 2, 2, 2, 3, 4]);
    if (r() < 0.78) {
      row = clamp(row + pick([-2, -1, -1, 0, 1, 1, 2]), 0, rows - 1);
      const len = Math.min(pick([1, 2, 2, 3, 4]), steps - step);
      placeNote(p, { id: pick(cast), step, row, len, vel: r() < 0.2 ? 3 : 2 });
    }
    step += gap;
  }

  const laneOf = (name) => p.drums.findIndex((l) => l.name === name);
  const write = (name, hits, vel = 2) => {
    const lane = laneOf(name);
    for (let i = 0; i < steps; i++) if (hits[i % hits.length]) setDrum(p, lane, i, vel);
  };
  write('bd', r() < 0.6 ? [1, 0, 0, 0] : euclid(pick([3, 5]), 8), 3);
  write('sd', [0, 0, 0, 0, 1, 0, 0, 0]);
  write('hh', euclid(pick([5, 7, 9, 11]), 16, Math.floor(r() * 3)), 1);
  if (r() < 0.6) write('oh', [0, 0, 1, 0, 0, 0, 1, 0]);
  if (r() < 0.4) write('cp', euclid(pick([2, 3]), 8, 4));
  return p;
}

/* -------------------------------------------------------------- presets */

const fromNotes = (base, notes, drums) => {
  const p = { ...emptyPattern(base.steps || 32), ...base };
  p.fx = { ...DEFAULT_FX, ...(base.fx || {}) };
  for (const [id, step, row, len = 2, vel = 2] of notes) placeNote(p, { id, step, row, len, vel });
  for (const [name, str] of Object.entries(drums || {})) {
    const lane = p.drums.findIndex((l) => l.name === name);
    if (lane >= 0) p.drums[lane].steps = str.replace(/[^0-3]/g, '0').padEnd(p.steps, '0').slice(0, p.steps);
  }
  return p;
};

/** Ids are species numbers: 25 皮卡丘, 39 胖丁, 52 喵喵, 94 耿鬼, 143 卡比獸,
 *  150 超夢, 54 可達鴨, 129 鯉魚王, 79 呆呆獸, 35 皮皮, 133 伊布, 1 妙蛙種子. */
export const PRESETS = [
  {
    id: 'pika',
    label: '皮卡丘小夜曲',
    build: () => fromNotes(
      { bpm: 92, steps: 32, scale: 'pent-minor', key: 9, swing: 0.12, fx: { reverbSize: 2.2, reverbCry: 0.28, delayCry: 0.18, delayFb: 0.4 } },
      [
        [25, 0, 5, 2], [25, 3, 7, 1], [39, 4, 6, 2], [25, 8, 8, 2], [52, 11, 6, 1], [39, 12, 5, 3],
        [25, 16, 5, 2], [133, 19, 7, 1], [25, 20, 9, 2], [39, 24, 7, 2], [52, 27, 5, 1], [25, 28, 3, 4, 3],
        [143, 0, 0, 4, 3], [143, 16, 1, 4, 3],
      ],
      { bd: '1000000010000000100000001000001', sd: '0000100000001000000010000000100', hh: '0010001000100010001000100010001', cp: '0000000000000000000000000000100' },
    ),
  },
  {
    id: 'mewtwo',
    label: '超夢夜店',
    build: () => fromNotes(
      { bpm: 126, steps: 32, scale: 'minor', key: 2, octave: -1, swing: 0, fx: { drive: 0.25, cutoff: 5200, wahRate: 2, wahDepth: 0.35, duck: 0.6, delayCry: 0.22, delayDiv: 2 } },
      [
        [150, 0, 0, 2, 3], [150, 4, 0, 2], [150, 8, 2, 2, 3], [150, 12, 0, 2], [150, 16, 0, 2, 3], [150, 20, 3, 2], [150, 24, 2, 2, 3], [150, 28, 4, 3],
        [94, 2, 9, 1], [94, 6, 10, 1], [94, 10, 9, 1], [94, 14, 12, 1], [94, 18, 9, 1], [94, 22, 10, 1], [94, 26, 12, 1], [94, 30, 13, 1, 3],
      ],
      { bd: '10001000100010001000100010001000', sd: '00001000000010000000100000001000', oh: '00100010001000100010001000100010', hh: '10101010101010101010101010101011', cp: '00000000000010000000000000001000' },
    ),
  },
  {
    id: 'slowpoke',
    label: '呆呆獸慢搖',
    build: () => fromNotes(
      { bpm: 68, steps: 32, scale: 'dorian', key: 5, swing: 0.28, fx: { reverbSize: 3.2, reverbCry: 0.4, crush: 0.15, cutoff: 3200, cryVol: 0.9 } },
      [
        [79, 0, 7, 3], [54, 4, 9, 2], [79, 8, 8, 3], [129, 12, 10, 2, 3], [79, 16, 7, 3], [54, 20, 11, 2],
        [79, 24, 9, 3], [35, 28, 7, 3], [143, 0, 0, 8, 2], [143, 16, 2, 8, 2],
      ],
      { bd: '10000000001000001000000000100000', sd: '00000000100000000000000010000000', hh: '10001000100010001000100010001000' },
    ),
  },
  {
    id: 'ryukyu',
    label: '琉球微風',
    build: () => fromNotes(
      { bpm: 84, steps: 16, scale: 'ryukyu', key: 4, swing: 0, fx: { delayCry: 0.32, delayFb: 0.5, delayDiv: 2, reverbCry: 0.3, reverbSize: 2.6 } },
      [
        [7, 0, 4, 2], [7, 2, 6, 1], [4, 3, 5, 1], [7, 4, 7, 2], [1, 6, 5, 2], [4, 8, 4, 2], [7, 10, 3, 2], [133, 12, 5, 1], [133, 13, 6, 1], [133, 14, 8, 2, 3],
      ],
      { bd: '1000000010000010', hh: '0010001000100010', sd: '0000100000001000' },
    ),
  },
  /* ---- v3 additions. Melodies are written as scale degrees RELATIVE to the chord
   *  (the row follows the chord root), so on a 7-note scale rows 0/2/4/6 are the
   *  root/3rd/5th/7th and +7 is the next octave. Drum digits: 1 ghost, 2 normal, 3 accent. */
  {
    id: 'funk',
    label: '噴火龍放克',
    build: () => fromNotes(
      { bpm: 104, steps: 32, scale: 'minor', key: 7, octave: -1, swing: 0.14, prog: 'i IV i bVII', style: 'city', fx: { padVol: 0.2, duck: 0.35, drive: 0.2, wahRate: 3, wahDepth: 0.4, cutoff: 9000, reverbCry: 0.12, delayCry: 0.1, drumVol: 0.85 } },
      [
        // bass (Snorlax) — syncopated 16ths on the root, fifth and third
        [143, 0, 0, 1, 3], [143, 3, 0, 1], [143, 6, 4, 1], [143, 8, 0, 1, 3], [143, 11, 0, 1], [143, 14, 2, 1],
        [143, 16, 0, 1, 3], [143, 19, 0, 1], [143, 22, 4, 1], [143, 24, 0, 1, 3], [143, 27, 2, 1], [143, 30, 4, 1],
        // lead (Charizard) and skank stabs (Voltorb) on the backbeat
        [6, 2, 7, 1], [6, 5, 9, 1], [6, 10, 11, 2, 3], [6, 13, 9, 1], [6, 18, 7, 1], [6, 21, 9, 1], [6, 26, 12, 2, 3], [6, 29, 11, 1],
        [100, 4, 9, 1, 1], [100, 12, 9, 1, 1], [100, 20, 9, 1, 1], [100, 28, 9, 1, 1],
      ],
      { bd: '3000201020100000' + '3000201020102010', sd: '0000300100001000' + '0100300000001011', hh: '2121212121212122'.repeat(2), oh: '0000000200000002'.repeat(2) },
    ),
  },
  {
    id: 'lapras',
    label: '拉普拉斯夜航',
    build: () => fromNotes(
      { bpm: 70, steps: 32, scale: 'major', key: 2, swing: 0, prog: 'I iii IV V', style: 'koto', fx: { padVol: 0.5, reverbSize: 3.6, reverbCry: 0.5, delayCry: 0.35, delayFb: 0.55, delayDiv: 3, cutoff: 7000, drumVol: 0.5 } },
      [
        // Lapras sings the tune; Gyarados is the sub-bass; Horsea are the bubbles
        [131, 0, 4, 6, 3], [131, 6, 5, 2], [131, 8, 7, 4, 3], [131, 12, 6, 4], [131, 16, 4, 4, 3], [131, 20, 6, 2], [131, 22, 5, 2], [131, 24, 7, 8, 3],
        [130, 0, 0, 8], [130, 8, 0, 8], [130, 16, 0, 8], [130, 24, 0, 8],
        [116, 3, 11, 1, 1], [116, 7, 10, 1, 1], [116, 11, 12, 1, 1], [116, 15, 9, 1, 1], [116, 19, 11, 1, 1], [116, 23, 13, 1, 1], [116, 27, 12, 1, 1], [116, 31, 10, 1, 1],
      ],
      { bd: '2000000000000000' + '2000000020000000', hh: '0010001000100010'.repeat(2), cp: '0'.repeat(30) + '10' },
    ),
  },
  {
    id: 'gengar',
    label: '耿鬼地下派對',
    build: () => fromNotes(
      { bpm: 132, steps: 32, scale: 'minor', key: 9, octave: -1, swing: 0, prog: 'i i bVI V', style: 'city', fx: { padVol: 0.3, drive: 0.3, cutoff: 6000, reso: 3, duck: 0.7, reverbCry: 0.35, reverbSize: 3, delayCry: 0.25, delayDiv: 2, crush: 0.1 } },
      [
        // Gastly: rolling 8th-note bass on the root
        ...Array.from({ length: 16 }, (_, i) => [92, i * 2, 0, 1, i % 4 === 0 ? 3 : 2]),
        // Gengar riff, Misdreavus wails
        [94, 3, 7, 1, 3], [94, 6, 9, 1], [94, 10, 7, 1], [94, 13, 8, 1], [94, 19, 7, 1, 3], [94, 22, 9, 2], [94, 26, 11, 1], [94, 29, 10, 1],
        [200, 12, 11, 2], [200, 28, 12, 2, 3],
      ],
      { bd: '2000200020002000'.repeat(2), oh: '0020002000200020'.repeat(2), hh: '1111111111111112'.repeat(2), cp: '0000200000002000'.repeat(2) },
    ),
  },
  {
    id: 'eevee',
    label: '伊布午後爵士',
    build: () => fromNotes(
      { bpm: 92, steps: 32, scale: 'major', key: 5, swing: 0.3, prog: 'ii V I vi', style: 'city', fx: { padVol: 0.35, reverbSize: 2, reverbCry: 0.25, delayCry: 0.12, cutoff: 11000, drumVol: 0.6 } },
      [
        // Eevee's melody, Slowpoke walks the bass, Togepi sprinkles
        [133, 0, 4, 2], [133, 3, 6, 1], [133, 4, 5, 2], [133, 7, 4, 1], [133, 8, 4, 1], [133, 10, 5, 1], [133, 11, 6, 2], [133, 14, 7, 1],
        [133, 16, 7, 3, 3], [133, 19, 6, 1], [133, 20, 5, 2], [133, 23, 4, 1], [133, 24, 4, 2], [133, 27, 3, 1], [133, 28, 2, 3],
        [79, 0, 0, 3, 3], [79, 4, 4, 3], [79, 8, 0, 3, 3], [79, 12, 2, 3], [79, 16, 0, 3, 3], [79, 20, 4, 3], [79, 24, 0, 3, 3], [79, 28, 4, 3],
        [175, 6, 11, 1, 1], [175, 14, 12, 1, 1], [175, 22, 11, 1, 1], [175, 30, 13, 1, 1],
      ],
      { bd: '2000000000100000' + '2000000020000000', sd: '0000100000001000'.repeat(2), hh: '2020202020202020'.repeat(2) },
    ),
  },
  {
    id: 'magikarp',
    label: '鯉魚王跳跳',
    build: () => fromNotes(
      { bpm: 150, steps: 32, scale: 'pent-major', key: 0, swing: 0, prog: 'I vi IV V', style: 'city', fx: { padVol: 0.15, crush: 0.35, cutoff: 14000, reverbCry: 0.1, delayCry: 0.15, delayDiv: 1, drumVol: 0.75 } },
      [
        // Magikarp hops up the scale; Pikachu bounces on root and fifth
        [129, 0, 5, 1], [129, 2, 6, 1], [129, 4, 7, 1], [129, 6, 8, 2, 3], [129, 8, 5, 1], [129, 10, 7, 1], [129, 12, 6, 1], [129, 14, 5, 2],
        [129, 16, 5, 1], [129, 18, 6, 1], [129, 20, 8, 1], [129, 22, 7, 2, 3], [129, 24, 7, 1], [129, 26, 8, 1], [129, 28, 9, 1], [129, 30, 10, 2, 3],
        [25, 0, 0, 2, 3], [25, 4, 3, 1], [25, 8, 0, 2, 3], [25, 12, 3, 1], [25, 16, 0, 2, 3], [25, 20, 3, 1], [25, 24, 0, 2, 3], [25, 28, 3, 1],
      ],
      { bd: '2000200120002010', sd: '0000300000003000'.repeat(2), hh: '3212321232123212'.repeat(2) },
    ),
  },
  {
    id: 'dragonite',
    label: '快龍・天空卡農',
    build: () => fromNotes(
      { bpm: 74, steps: 64, scale: 'major', key: 2, swing: 0, prog: 'I V vi iii IV I IV V', style: 'gagaku', fx: { padVol: 0.55, reverbSize: 3.4, reverbCry: 0.38, delayCry: 0.2, delayDiv: 2, cutoff: 10000, drumVol: 0.5 } },
      [
        // The descending canon line, one long note per chord (rows chosen so the pitches fall F#–E–D–C#–B–A–B–C#)
        [149, 0, 9, 7, 3], [149, 8, 11, 7], [149, 16, 9, 7], [149, 24, 4, 7], [149, 32, 2, 7], [149, 40, 4, 7], [149, 48, 2, 7], [149, 56, 9, 4, 3],
        // Onix holds the root of every chord
        ...Array.from({ length: 8 }, (_, i) => [95, i * 8, 0, 8, 2]),
        // Dratini arpeggiates each chord's own triad (root-3rd-5th, so it follows major/minor by itself)
        ...Array.from({ length: 8 }, (_, i) => [[147, i * 8 + 2, 7, 1, 1], [147, i * 8 + 4, 9, 1, 1], [147, i * 8 + 6, 11, 1, 1]]).flat(),
        [250, 60, 11, 4, 3],
      ],
      { bd: '2000000010000000'.repeat(4), hh: '0010001000100010'.repeat(4) },
    ),
  },
  {
    id: 'abra',
    label: '凱西電音琶音',
    build: () => fromNotes(
      { bpm: 138, steps: 32, scale: 'minor', key: 4, swing: 0, prog: 'i bVI bIII bVII', style: 'city', fx: { padVol: 0.35, duck: 0.65, cutoff: 8000, reso: 2.5, delayCry: 0.25, delayDiv: 2, reverbCry: 0.2, drive: 0.15 } },
      [
        // 16th-note arpeggio on each chord's root-3rd-5th-octave, Abra and Kadabra taking turns
        ...Array.from({ length: 32 }, (_, s) => [s % 2 ? 64 : 63, s, [0, 2, 4, 7, 9, 7, 4, 2][s % 8], 1, [3, 1, 2, 1][s % 4]]),
        // Mew floats over the top; Voltorb pulses the root
        [151, 0, 11, 6, 3], [151, 8, 9, 6], [151, 16, 14, 6, 3], [151, 24, 13, 6, 2],
        ...Array.from({ length: 8 }, (_, i) => [100, i * 4, 0, 1, 3]),
      ],
      { bd: '2000200020002000'.repeat(2), oh: '0020002000200020'.repeat(2), hh: '1111111111111111'.repeat(2), cp: '0000200000002000'.repeat(2) },
    ),
  },
  {
    id: 'clefairy',
    label: '皮皮月光音樂盒',
    build: () => fromNotes(
      { bpm: 66, steps: 32, scale: 'pent-major', key: 7, swing: 0, prog: 'I iii IV I', style: 'gagaku', fx: { padVol: 0.45, reverbSize: 3, reverbCry: 0.45, delayCry: 0.3, delayDiv: 2, cutoff: 12000 } },
      [
        // Clefairy's music-box arpeggio (root–5th–octave only, so it fits major and minor chords alike)
        [35, 0, 5, 2], [35, 2, 8, 2], [35, 4, 10, 2], [35, 6, 8, 2], [35, 8, 5, 2], [35, 10, 8, 2], [35, 12, 10, 2], [35, 14, 8, 2],
        [35, 16, 5, 2], [35, 18, 8, 2], [35, 20, 10, 2], [35, 22, 8, 2], [35, 24, 10, 2], [35, 26, 8, 2], [35, 28, 5, 4],
        [39, 0, 0, 6], [39, 8, 0, 6], [39, 16, 0, 6], [39, 24, 0, 6],
        [175, 7, 9, 1, 1], [175, 15, 9, 1, 1], [175, 23, 9, 1, 1], [175, 31, 10, 1, 1],
      ],
      {},
    ),
  },
];

/* --------------------------------------------------------- serialisation */

const b64url = {
  enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

/** Only what differs from the default goes in the link — a pattern with no fx
 *  changes is a few hundred characters. Notes are `[id,step,row,len,vel]`. */
export function serialize(p) {
  const fx = {};
  for (const k of Object.keys(DEFAULT_FX)) if (p.fx[k] !== DEFAULT_FX[k]) fx[k] = +Number(p.fx[k]).toFixed(3) || p.fx[k];
  const o = {
    v: 1, b: p.bpm, s: p.steps, w: +p.swing.toFixed(3), c: p.scale, k: p.key, o: p.octave, t: p.tune, g: p.gate,
    n: p.notes.map((n) => [n.id, n.step, n.row, n.len, n.vel]),
    d: p.drums.map((l) => [l.name, l.n, l.mute ? 1 : 0, l.steps]),
  };
  if (p.bank) o.a = p.bank;
  if (Object.keys(fx).length) o.f = fx;
  return b64url.enc(JSON.stringify(o));
}

/** Parse untrusted input (a URL hash, a pasted file). Never throws: a bad
 *  payload returns null, and every field of a good one is clamped, because this
 *  is the one entry point where the pattern did not come from this module. */
export function deserialize(str) {
  try {
    const o = JSON.parse(b64url.dec(str));
    if (!o || o.v !== 1) return null;
    const steps = STEP_OPTIONS.includes(o.s) ? o.s : 32;
    const p = emptyPattern(steps);
    p.bpm = clamp(Math.round(finite(o.b, 100)), 40, 220);
    p.swing = clamp(finite(o.w, 0), 0, 0.5);
    p.scale = SCALES[o.c] ? o.c : p.scale;
    p.key = clamp(Math.round(finite(o.k, 9)), 0, 11);
    p.octave = clamp(Math.round(finite(o.o, 0)), -2, 2);
    p.tune = o.t === 'raw' ? 'raw' : 'auto';
    p.gate = o.g === 'free' ? 'free' : 'note';
    p.bank = typeof o.a === 'string' ? o.a.slice(0, 40) : '';
    for (const k of Object.keys(DEFAULT_FX)) {
      const v = o.f?.[k];
      if (k === 'filterType') p.fx[k] = FILTER_TYPES.includes(v) ? v : DEFAULT_FX[k];
      else if (typeof v === 'number' && Number.isFinite(v)) p.fx[k] = clamp(v, ...FX_RANGES[k]);
    }
    if (Array.isArray(o.n)) {
      for (const row of o.n.slice(0, MAX_NOTES)) {
        if (!Array.isArray(row)) continue;
        const [id, step, r, len, vel] = row.map(Number);
        if (!Number.isInteger(id) || id < 1 || id > 1025) continue;
        placeNote(p, { id, step, row: r, len: finite(len, 2), vel: clamp(finite(vel, 2), 1, 3) });
      }
    }
    if (Array.isArray(o.d)) {
      for (const [name, n, mute, str] of o.d) {
        const lane = p.drums.findIndex((l) => l.name === name);
        if (lane < 0) continue;
        p.drums[lane].n = clamp(Math.round(finite(Number(n), 0)), 0, 99);
        p.drums[lane].mute = mute === 1;
        p.drums[lane].steps = String(str || '').replace(/[^0-3]/g, '0').padEnd(steps, '0').slice(0, steps);
      }
    }
    return p;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- strudel */

/** Write the pattern as Strudel code. One cycle is the whole loop, so `cps` is
 *  bpm/60 divided by the loop's length in beats. Melody lines are one per
 *  species with `s("cry<id>")`: Strudel has no cry sample until the reader loads
 *  one, which the header comment says how to do. */
export function toStrudel(p) {
  const beats = p.steps / 4;
  const cps = +(p.bpm / 60 / beats).toFixed(4);
  const out = [
    '// 由「叫聲編曲室」匯出',
    `// 叫聲取樣：samples({ cry25: 'assets/cries/latest/25.ogg', ... }, '<你的網站網址>/')`,
    `setcps(${cps})  // ${p.bpm} BPM，一個循環 = ${beats} 拍`,
    'stack(',
  ];
  const lines = [];
  for (const lane of p.drums) {
    if (lane.mute || !/[1-3]/.test(lane.steps)) continue;
    const cells = [...lane.steps].map((c) => (c === '0' ? '~' : lane.n ? `${lane.name}:${lane.n}` : lane.name));
    lines.push(`  s("${cells.join(' ')}")`);
  }
  const ids = [...new Set(p.notes.map((n) => n.id))].sort((a, b) => a - b);
  for (const id of ids) {
    const cells = [];
    for (let i = 0; i < p.steps; i++) {
      const here = p.notes.filter((n) => n.id === id && n.step === i).map((n) => midiStrudel(rowToMidi(p, n.row)));
      cells.push(here.length === 0 ? '~' : here.length === 1 ? here[0] : `[${here.join(',')}]`);
    }
    lines.push(`  note("${cells.join(' ')}").s("cry${id}")`);
  }
  out.push(lines.join(',\n'));
  out.push(')');
  return out.join('\n');
}
