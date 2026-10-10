#!/usr/bin/env node
/**
 * Prove check_gen1_cries.mjs can actually fail.
 *
 * Run: node scripts/test_check_gen1_cries.mjs
 *
 * A checker that has never been seen to fail is a checker whose silence nobody
 * can interpret. Each case below copies the tree, breaks one thing, and requires
 * the checker to exit non-zero with a message naming that specific problem --
 * matching on the message is the point, because "it failed" is also what a crash
 * or an unrelated assertion produces.
 *
 * The first case is the one that matters most and is not a mutation at all.
 * cries.asm is unordered from its first row: 151 of 151 species sit at a
 * position that is not their dex id, by up to 174 places, and row 1 is Rhyhon
 * (id 112). So every id in gen1_cries.json can only have come from the
 * `; Name` comment on each row. Nothing in the generated JSON can demonstrate
 * that, because a positional join and a name join produce the same shape of
 * file -- they just disagree about which Pokémon owns which sound, and only
 * upstream can tell. So this test runs the fetcher twice over the same data,
 * once with the rows shuffled, and requires the two JSON files to be
 * byte-identical. If anyone ever swaps the join for `enumerate`, this fails and
 * no comment anywhere would have caught it.
 *
 * The 114 upstream .asm files are mirrored into data-sources/pokered-cry/ on
 * first run and reused after that; the directory is gitignored.
 */

import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caughtBy, failLines } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* EVERY SCRATCH DIRECTORY IS TRACKED AT CREATION AND REMOVED ON EXIT.
 *
 * The per-case `finally { rmSync(dir) }` blocks below already clean up on the happy path
 * and on a throw inside `run()`. They cannot cover the one window that leaks: `makeTree()`
 * calls `mkdtempSync` and then copies files and mutates the copy, so a stale anchor, a
 * missing source file or a `cpSync` failure throws AFTER the directory exists but BEFORE
 * the caller's `finally` is ever entered. The caller has no `dir` to clean up, because
 * `makeTree()` never returned one.
 *
 * Registering at creation closes that window without depending on where the throw happens,
 * and it is the same fix as test_check_color_palettes.mjs. Measured: this harness left one
 * partial tree per run — 4-5 files, never a complete one, which is what "threw halfway
 * through makeTree" looks like on disk.
 *
 * The existing finally blocks stay: they free the space promptly during a long run, and
 * `force: true` makes the exit-time removal a no-op for anything already gone.
 */
const SCRATCH = new Set();
const track = (dir) => (SCRATCH.add(dir), dir);
process.on('exit', () => {
  for (const dir of SCRATCH) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
});
const PYTHON = join(ROOT, '..', '.venv', 'bin', 'python');
const CACHE = join(ROOT, 'data-sources', 'pokered-cry');
const REPO = 'https://raw.githubusercontent.com/pret/pokered/master';

const SRC = [
  'assets/data/pokemon_data.json',
  'assets/data/gen1_cries.json',
  'assets/data/gen1_cry_sfx.json',
  'scripts/fetch_gen1_cries.py',
  'scripts/check_gen1_cries.mjs',
];
const CHECKER = 'scripts/check_gen1_cries.mjs';
const FETCHER = 'scripts/fetch_gen1_cries.py';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// A fixture tree with just what the checker reads.
// ---------------------------------------------------------------------------

function makeTree(mutate) {
  const dir = track(mkdtempSync(join(tmpdir(), 'cry1-neg-')));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

/* Async, and on process.execPath rather than whatever 'node' is first on PATH — the
 * baseline and the mutations must run the SAME interpreter to be comparable. */
const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

const editJson = (dir, name, fn) => {
  const p = join(dir, name);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  fn(data);
  writeFileSync(p, JSON.stringify(data, null, 1) + '\n');
};

/** The base entry for a given constant, mutated in place. */
const withSfx = (dir, constant, fn) =>
  editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => fn(d.sfx[constant]));

const CASES = [
  {
    name: 'a species loses its cry, so the table is short a sound',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.cries = d.cries.filter((c) => c.id !== 122);
    }),
    expect: 'the ids are exactly 1..151',
  },
  {
    name: 'two species are given the same id',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.cries.find((c) => c.id === 25).id = 24;
    }),
    expect: 'the ids are exactly 1..151',
  },
  {
    name: 'the declared count goes stale',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => { d.cryCount = 150; }),
    expect: 'the declared cry count matches',
  },
  {
    name: 'a cry is attributed to a species past the Generation I range',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.cries.find((c) => c.id === 1).id = 1025;
    }),
    expect: 'every cry id names a species',
  },
  {
    name: 'the source URL is repointed at a second host',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.source = 'https://example.invalid/cries.asm';
    }),
    expect: 'gen1_cries.json still credits',
  },
  {
    name: 'the fetcher is repointed at a second host while the JSON keeps the old URL',
    mutate: (dir) => {
      const p = join(dir, FETCHER);
      writeFileSync(p, readFileSync(p, 'utf8')
        .replace('raw.githubusercontent.com', 'cdn.example.invalid')
        .replace('pret/pokered/master', 'someone/fork/main'));
    },
    expect: 'the fetcher builds its URLs from pret/pokered',
  },
  {
    name: 'one base index is renumbered so the two files disagree',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_20.base = 31;
    }),
    expect: 'both files agree on which base index',
  },
  {
    name: 'a base cry no species uses is left in the file',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.baseCount = 39;
      d.sfx.SFX_CRY_99 = { base: 38, files: ['cry99_1.asm', 'cry99_2.asm', 'cry99_3.asm'],
                          implicitRet: [], channels: [{ ch: 5, commands: [{ op: 'ret' }] }] };
    }),
    expect: 'gen1_cry_sfx.json holds 38 base entries',
  },
  {
    name: 'a cry filename keeps the uppercase hex of its constant',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_1A', (v) => {
      v.files = ['cry1A_1.asm', 'cry1A_2.asm', 'cry1A_3.asm'];
    }),
    expect: 'three cry files its constant maps to',
  },
  {
    name: 'a pitch no longer fits its byte',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cries.json', (d) => {
      d.cries.find((c) => c.id === 25).pitch = 256;
    }),
    expect: 'every pitch is a byte',
  },
  {
    name: 'a volume sweep no longer fits a signed nibble',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      v.channels[0].commands[1].sweep = 99;
    }),
    expect: 'volume sweep fits a signed 4-bit field',
  },
  {
    name: 'a noise note stores its LFSR parameter as a 16-bit value',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      const noise = v.channels.find((c) => c.ch === 8);
      noise.commands[0].freq = 4096;
    }),
    expect: 'every noise note keeps its 8-bit LFSR parameter',
  },
  {
    name: 'the noise channel is dropped, so the cry loses its texture',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      v.channels = v.channels.filter((c) => c.ch !== 8);
    }),
    expect: 'every base cry has exactly Ch5, Ch6 and Ch8',
  },
  {
    name: 'a wave channel appears, which no cry uses',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      v.channels.push({ ch: 7, commands: [{ op: 'ret' }] });
    }),
    expect: 'no base cry uses the wave channel',
  },
  {
    name: 'a pulse channel plays a note without naming a duty cycle',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      const pulse = v.channels.find((c) => c.ch === 5);
      pulse.commands = pulse.commands.filter((c) => c.op !== 'duty');
    }),
    expect: 'opens with a duty cycle pattern',
  },
  {
    name: 'the old-style duty_cycle stops being expanded to four values',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_02', (v) => {
      for (const ch of v.channels) {
        for (const cmd of ch.commands) {
          if (cmd.expandedFrom) { cmd.pattern = [0]; delete cmd.expandedFrom; }
        }
      }
    }),
    expect: 'the one old-style duty_cycle is expanded',
  },
  {
    name: 'a note claims a length the hardware cannot hold',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      v.channels[0].commands[1].frames = 32;
    }),
    expect: 'every note has frames 1..16',
  },
  {
    name: 'a command the parser did not recognise is silently carried through',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      v.channels[0].commands.splice(1, 0, { op: 'wibble' });
    }),
    expect: 'only the five cry commands appear',
  },
  /* Dropping a channel's commands leaves it with no `ret` at all, which is the
   * upstream omission `implicitRet` exists to record — so the detector is the check
   * that recomputes the set from the commands and compares it against the stored
   * field, not the one that pins the stored field's six names. This case used to
   * claim the latter, and passed anyway: that assertion's description contains
   * "still exactly these six" whether it passes or fails, and the old matcher only
   * asked whether the string appeared anywhere. */
  {
    name: 'a whole channel of commands is dropped, leaving a terminator upstream never wrote',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_00', (v) => {
      v.channels.find((c) => c.ch === 6).commands = [];
    }),
    expect: 'implicitRet lists exactly the channels with no sound_ret',
  },
  {
    name: 'the loop target goes back to being the literal label',
    mutate: (dir) => withSfx(dir, 'SFX_CRY_0D', (v) => {
      for (const ch of v.channels) {
        for (const cmd of ch.commands) {
          if (cmd.op === 'loop') cmd.target = 'SFX_Cry0D_1_Ch5';
        }
      }
    }),
    expect: 'the single sound_loop is cry0d Ch5',
  },
  {
    name: 'a seventh channel is recorded as having no terminator',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_0D.implicitRet = [5];
    }),
    expect: 'still exactly these six',
  },
  {
    name: 'one of the six is no longer recorded, so the JSON is stale',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_21.implicitRet = [];
    }),
    expect: 'still exactly these six',
  },
  {
    name: 'implicitRet lists a channel that does terminate',
    mutate: (dir) => editJson(dir, 'assets/data/gen1_cry_sfx.json', (d) => {
      d.sfx.SFX_CRY_00.implicitRet = [5];
    }),
    expect: 'implicitRet lists exactly the channels with no sound_ret',
  },
];

// ---------------------------------------------------------------------------
// The order-independence proof.
// ---------------------------------------------------------------------------

function ensureCache() {
  mkdirSync(join(CACHE, 'sfx'), { recursive: true });
  const tablePath = join(CACHE, 'cries.asm');
  if (!existsSync(tablePath)) {
    writeFileSync(tablePath, fetchText(`${REPO}/data/pokemon/cries.asm`));
  }
  const have = new Set(existsSync(join(CACHE, 'sfx')) ? readdirSync(join(CACHE, 'sfx')) : []);
  const wanted = [];
  for (const c of Array.from({ length: 38 }, (_, i) => i.toString(16).padStart(2, '0'))) {
    for (const v of [1, 2, 3]) wanted.push(`cry${c}_${v}.asm`);
  }
  const missing = wanted.filter((f) => !have.has(f));
  for (const f of missing) {
    writeFileSync(join(CACHE, 'sfx', f), fetchText(`${REPO}/audio/sfx/${f}`));
  }
  return { fetched: missing.length + (existsSync(tablePath) ? 0 : 1) };
}

function fetchText(url) {
  const res = execFileSync('curl', ['-sSfL', url], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return res;
}

/** Deterministic shuffle, so a failure here is reproducible. */
function shuffledRows(text) {
  const lines = text.split('\n');
  const rowIdx = [];
  lines.forEach((l, i) => { if (/^\tmon_cry /.test(l)) rowIdx.push(i); });
  const rows = rowIdx.map((i) => lines[i]);
  // A fixed LCG: Math.random() would make an intermittent failure unreproducible.
  let seed = 20261004;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  rowIdx.forEach((lineAt, k) => { lines[lineAt] = rows[k]; });
  return lines.join('\n');
}

function generate(dir, asmPath) {
  execFileSync(PYTHON, [
    join(dir, FETCHER), '--source', asmPath, '--sfx-dir', join(CACHE, 'sfx'),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    cries: readFileSync(join(dir, 'assets/data/gen1_cries.json'), 'utf8'),
    sfx: readFileSync(join(dir, 'assets/data/gen1_cry_sfx.json'), 'utf8'),
  };
}

function shuffleCase() {
  const cacheNote = ensureCache();
  if (cacheNote.fetched) {
    console.log(`  ..   mirrored ${cacheNote.fetched} upstream files into data-sources/pokered-cry/`);
  }

  const scratch = track(mkdtempSync(join(tmpdir(), 'cry1-shuf-')));
  const asmShuffled = join(scratch, 'cries.asm');
  writeFileSync(asmShuffled, shuffledRows(readFileSync(join(CACHE, 'cries.asm'), 'utf8')));

  // The fixture has to carry pokemon_data.json and the fetcher, which is the
  // minimal tree fetch_gen1_cries.py touches.
  const fixture = track(mkdtempSync(join(tmpdir(), 'cry1-gen-')));
  for (const f of ['assets/data/pokemon_data.json', FETCHER]) {
    mkdirSync(join(fixture, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(fixture, f));
  }

  let name = 'shuffling cries.asm leaves the generated JSON byte-identical';
  try {
    const before = generate(fixture, join(CACHE, 'cries.asm'));
    const after = generate(fixture, asmShuffled);
    ok(name, before.cries === after.cries && before.sfx === after.sfx,
      before.cries === after.cries ? '' : 'gen1_cries.json differs once the rows move');
  } catch (e) {
    ok(name, false, `fetcher failed: ${(e.stderr || e.message || '').toString().trim().split('\n')[0]}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(fixture, { recursive: true, force: true });
  }

  // And the regenerated table must match what is committed, which is the other
  // half of the claim: the shuffle does not quietly drop or reorder species.
  const committed = readFileSync(join(ROOT, 'assets/data/gen1_cries.json'), 'utf8');
  const f2 = track(mkdtempSync(join(tmpdir(), 'cry1-gen2-')));
  try {
    for (const f of ['assets/data/pokemon_data.json', FETCHER]) {
      mkdirSync(join(f2, dirname(f)), { recursive: true });
      cpSync(join(ROOT, f), join(f2, f));
    }
    const fresh = generate(f2, join(CACHE, 'cries.asm'));
    ok('regenerating from the cached mirror reproduces the committed JSON',
      fresh.cries === committed && fresh.sfx === readFileSync(join(ROOT, 'assets/data/gen1_cry_sfx.json'), 'utf8'));
  } finally {
    rmSync(f2, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

const baseline = await run(makeTree(null));
ok('baseline: the checker passes on an unmutated copy of the tree', baseline.code === 0,
  baseline.code === 0 ? '' : baseline.out.split('\n').slice(-6).join('\n'));

shuffleCase();

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs. */const verdicts = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  let r;
  try {
    r = await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const named = r.code !== 0 && caughtBy(r.out, c.expect);
  return [c.name, named, named ? ''
    : `exit ${r.code}, expected the checker to report "${c.expect}" on a FAIL line; it said:\n${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`];
}));

for (const [name, pass, detail] of verdicts) ok(name, pass, detail);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log(`PASS  every negative case failed for the right reason`);
