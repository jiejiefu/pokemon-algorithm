/**
 * Negative tests for check_sv_index.mjs — the checker must FAIL, and name the
 * right reason, for every invariant it claims to police.
 *
 *   node scripts/test_check_sv_index.mjs
 *
 * WHY THIS FILE EXISTS. The invariants here are mostly "these two files agree",
 * and agreement checks are the easiest kind to write so that they are green for
 * the wrong reason: a comparison against an empty set, a regex anchored on a
 * string that a refactor moved, or an import that throws and is swallowed. A
 * checker that cannot fail is worse than no checker, because it is trusted.
 *
 * Each case below breaks ONE invariant in a scratch copy of the tree, runs the
 * real checker against it, and requires a non-zero exit AND a specific
 * substring. Asserting only the exit code would pass on a crash, which is how a
 * typo becomes a "passing" test.
 *
 * The last two cases police the OPPOSITE direction — a species dropped from the
 * dataset, cleanly, must PASS. Without them a checker that simply demanded 1025
 * entries would look correct forever.
 *
 * The harness runs from a temp tree, so a failed case cannot leave the working
 * tree modified. Both image directories are copied for real rather than
 * symlinked, because three cases delete a file inside one — through a symlink
 * that would delete the actual asset and leave the repo one sprite short.
 *
 * ONE TREE, BUILT ONCE, RESTORED BETWEEN CASES — 22 s to about 3 s.
 *
 * It used to call `makeTree()` per case, and `makeTree()` copies 1,225 SV PNGs
 * and 1,025 sprite PNGs along with the six source files. That is 2,250 files,
 * sixteen times, for a checker that runs in 0.17 s: 22 s of the suite's 190 to
 * re-derive 15 facts about `sv-index.js`, none of which a palette edit can
 * have changed. This is the same trade `test_check_cry_index.mjs` already
 * makes — see AGENTS.md §3.G5 — and it is made the same way.
 *
 * The trap this shape invites is a HAND-MAINTAINED LIST of "paths a case may
 * touch". That is a second copy of the truth: a case grows a new mutation,
 * forgets the list, and the NEXT case runs against a dirty tree and passes for
 * the wrong reason. So there is no list. `io.write` and `io.remove` are the only
 * handles a case has, and each records its own path; restore is driven by what
 * happened rather than by what someone remembered. Disabling the restore makes
 * cases fail (`got: [5.png] want: []`), which is what proves it is load-bearing
 * rather than decorative.
 *
 * RESTORING THE SIX SOURCE FILES EVERY CASE is nearly free and they are small;
 * restoring all 2,250 images every case is the cost being removed, so only
 * `touched` paths are restored. Create, overwrite and delete all restore through
 * one code path, because a path absent from ROOT has to be removed rather than
 * copied.
 *
 * Hardlinks and symlinks are both refused for the reason §3.F records:
 * `copyFileSync` opens its destination `O_TRUNC`, so a link is as destructive
 * here as a symlink would be.
 */

import {
  readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, cpSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy, failLines } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The real files, copied whole. The checker imports the REAL generated module
// and derives everything else from the real dataset, so the fixture cannot drift
// into agreeing with a bug in the checker.
const SRC = [
  'assets/data/pokemon_data.json',
  'assets/js/sv-index.js',
  'data-sources/sv-sources.json',
  'scripts/fetch_sv_sprites.py',
  'scripts/check_sv_index.mjs',
  'types.html',
];
const SV_IMAGES = 'assets/images/scarlet-violet';
const SPRITE_IMAGES = 'assets/images/sprite';
const CHECKER = 'scripts/check_sv_index.mjs';

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

/* ONE working tree, copied once. `process.on('exit')` rather than a line at the
 * bottom, because the bottom does not run when a case throws — and a throw is
 * exactly when the run is already going wrong. */
const WORK = join(tmpdir(), `csv-neg-${Math.random().toString(36).slice(2)}`);
mkdirSync(WORK, { recursive: true });
process.on('exit', () => rmSync(WORK, { recursive: true, force: true }));

mkdirSync(join(WORK, 'assets/images'), { recursive: true });
for (const f of SRC) {
  mkdirSync(join(WORK, dirname(f)), { recursive: true });
  cpSync(join(ROOT, f), join(WORK, f));
}
cpSync(join(ROOT, SV_IMAGES), join(WORK, SV_IMAGES), { recursive: true });
cpSync(join(ROOT, SPRITE_IMAGES), join(WORK, SPRITE_IMAGES), { recursive: true });

/** Every path a case has changed since the last restore, relative to WORK. */
const touched = new Set();

/** The ONLY handles a case has on the corpus. Both record, so a case cannot
 *  mutate something the restore does not know about. A case that reaches for
 *  `rmSync` directly is bypassing this and the next case will inherit it. */
const io = {
  write: (rel, data) => { writeFileSync(join(WORK, rel), data); touched.add(rel); },
  remove: (rel) => { rmSync(join(WORK, rel), { force: true }); touched.add(rel); },
};

function restore() {
  for (const f of SRC) copyFileSync(join(ROOT, f), join(WORK, f));
  for (const rel of touched) {
    const abs = join(WORK, rel);
    /* A path that exists in ROOT is copied back; one that does not was created
       by the case and has to be removed. Both are the same restore, which is why
       they are one code path and not two. */
    if (existsSync(join(ROOT, rel))) copyFileSync(join(ROOT, rel), abs);
    else rmSync(abs, { force: true });
  }
  touched.clear();
}

/** Apply a case's text mutation to WORK. `undefined` means "this case does not
 *  target this file". A returned string IDENTICAL to the input means a stale
 *  anchor, and the case would then pass for the wrong reason — an error, not a
 *  no-op. */
function applyTextMutations(mutate) {
  for (const f of SRC) {
    const p = join(WORK, f);
    const before = readFileSync(p, 'utf8');
    const after = mutate(f, before);
    if (after === undefined) continue;
    if (after === before) {
      throw new Error(`mutation for ${f} did not change the file — the anchor string is stale, so this case would pass for the wrong reason`);
    }
    writeFileSync(p, after);
    touched.add(f);
  }
}

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Baseline first: if the unmutated copy does not pass, every case below would be
// measuring the harness rather than the checker.
{
  restore();
  const { code, out } = run(WORK);
  code === 0 ? pass('baseline: the checker passes on an unmutated copy of the tree')
             : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

const cases = [
  {
    name: 'the provenance map loses an entry, so one file has no recorded source',
    mutate: (f, s) => f.endsWith('sv-sources.json')
      ? s.replace(/\n\s*"5": "pokeapi",/, '')
      : undefined,
    expect: 'provenance map covers exactly the species',
  },
  {
    name: 'a provenance entry names a source nothing declares',
    mutate: (f, s) => f.endsWith('sv-sources.json')
      ? s.replace('"5": "pokeapi"', '"5": "somewhere-else"')
      : undefined,
    expect: 'naming a source the map does not declare',
  },
  {
    name: 'the fetcher is repointed at another host, silently',
    mutate: (f, s) => f.endsWith('fetch_sv_sprites.py')
      ? s.replace('/PokeAPI/sprites/master/', '/someone-else/mirror/')
      : undefined,
    expect: 'fetcher primary URL matches the generated SV_SOURCE',
  },
  {
    name: 'the fallback is consulted first, shadowing the source the site credits',
    mutate: (f, s) => f.endsWith('fetch_sv_sprites.py')
      ? s.replace('"pokeapi": (', '"tmp": (\n        "https://example.invalid/{id}.png"\n    ),\n    "pokeapi": (')
      : undefined,
    expect: 'consults PokeAPI before the fallback',
  },
  {
    name: 'the fallback source is named in the file the frontend loads',
    mutate: (f, s) => f.endsWith('sv-index.js')
      ? s.replace('export const SV_PATH_PREFIX', 'export const SV_FALLBACK = "https://infopoke.net/pokemon/icons/{id}.png";\nexport const SV_PATH_PREFIX')
      : undefined,
    expect: 'does not name the fallback source',
  },
  {
    name: 'types.html stops importing hasSv, so the roster is never consulted',
    mutate: (f, s) => f === 'types.html'
      ? s.replace(/\bhasSv\b, /, '')
      : undefined,
    expect: 'imports hasSv from the generated module',
  },
  {
    name: 'types.html stops importing svUrl, so no chip ever asks for real artwork',
    mutate: (f, s) => f === 'types.html'
      ? s.replace("import { hasSv, svUrl } from './assets/js/sv-index.js';",
                  "import { hasSv } from './assets/js/sv-index.js';")
      : undefined,
    expect: 'imports svUrl from the generated module',
  },
  {
    name: 'the onerror net is removed, so a stale roster paints a broken image',
    mutate: (f, s) => f === 'types.html'
      ? s.replace(/\s*onerror="this\.onerror=null;this\.src=[^"]*"/, '')
      : undefined,
    expect: 'keeps an onerror net that falls back to the sprite',
  },
  {
    name: 'the stand-in count is rendered unconditionally, so every type claims a gap',
    mutate: (f, s) => f === 'types.html'
      ? s.replace("${subCount ? `・${subCount} 隻使用替代圖` : ''}", '・0 隻使用替代圖')
      : undefined,
    expect: 'hides the stand-in count when nothing falls back',
  },
  {
    name: 'the badge loses its light-theme tone, so it cannot read over a pale sprite',
    mutate: (f, s) => f === 'types.html'
      ? s.replace('--chip-sub-mark: #3a4252;', '--chip-sub-mark: #8a93a5;')
      : undefined,
    expect: 'badge mark colour is defined for both themes',
  },
  {
    name: 'svUrl is repointed at a directory that is not the artwork one',
    mutate: (f, s) => f.endsWith('sv-index.js')
      ? s.replace('export const SV_PATH_PREFIX = "assets/images/scarlet-violet/";',
                  'export const SV_PATH_PREFIX = "assets/images/pokemon/";')
      : undefined,
    expect: 'is a directory',
  },
  {
    name: 'a species loses its 96px sprite, so the fallback is no longer safe',
    files: (io) => io.remove(`${SPRITE_IMAGES}/1.png`),
    expect: 'no 96px sprite to fall back to',
  },
];

/* Cases that must corrupt or remove real artwork. */
const imageCases = [
  {
    name: 'a file in the roster is deleted, so its chip 404s',
    files: (io) => io.remove(`${SV_IMAGES}/5.png`),
    expect: 'ids in the roster with no file behind them',
  },
  {
    name: 'a roster entry is a non-PNG body wearing a .png name (fetcher gotcha 2)',
    files: (io) => io.write(`${SV_IMAGES}/5.png`, '404: Not Found'),
    expect: 'not PNGs',
  },
  {
    name: 'a roster file is a stub below the minimum artwork size',
    files: (io) => io.write(`${SV_IMAGES}/5.png`, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])),
    expect: 'below the minimum artwork size',
  },
];

// One loop for both kinds of case. Text mutations and filesystem mutations are
// independent hooks, and a case may use either or both; splitting them into two
// loops is how the sprite case above ended up shipping a `files` hook that
// nothing ever called. `files` takes the tracked `io` rather than a directory, so
// a case cannot change a file the next case would inherit.
for (const c of [...cases, ...imageCases]) {
  restore();
  if (c.mutate) applyTextMutations(c.mutate);
  if (c.files) c.files(io);
  const { code, out } = run(WORK);
  if (code !== 0 && caughtBy(out, c.expect)) pass(c.name);
  else fail(`${c.name}\n      exit ${code}, expected the checker to fail with "${c.expect}"\n${failLines(out).map((l) => `      ${l.trim()}`).join('\n') || out.split('\n').slice(-8).join('\n')}`);
}

/* Opposite direction. A species removed from the dataset must not read as a
   defect: the roster, the directory and the provenance map all shrink together
   and the checker has to accept it. A checker that only ever demanded 1025 would
   pass every case above and still be wrong. */
{
  restore();
  applyTextMutations((f, s) => {
    if (f === 'assets/data/pokemon_data.json') {
      const data = JSON.parse(s).filter((p) => p.id !== 5);
      return JSON.stringify(data);
    }
    if (f === 'assets/js/sv-index.js') {
      // The roster body is one space-separated string, so drop the token rather
      // than a character range — a positional regex would silently mangle a
      // neighbouring id and make this case pass for the wrong reason.
      return s.replace(/(new Set\(\s*")([^"]+)(")/,
        (_m, open, body, close) => open + body.split(/\s+/).filter((t) => t !== '5').join(' ') + close);
    }
    if (f === 'data-sources/sv-sources.json') {
      const j = JSON.parse(s);
      delete j.artwork['5'];
      return JSON.stringify(j, null, 1);
    }
    return undefined;
  });
  io.remove(`${SV_IMAGES}/5.png`);
  const { code, out } = run(WORK);
  code === 0 ? pass('a species dropped cleanly from the dataset, roster, directory and map still passes')
             : fail(`a clean dataset shrink was reported as a defect — the checker is hardcoding completeness:\n${out}`);
  restore();
}

console.log(failures ? `\nFAIL  ${failures} negative case(s) did not behave` : '\nPASS  every negative case failed for the right reason');
process.exit(failures ? 1 : 0);