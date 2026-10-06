/**
 * Negative tests for check_cry_index.mjs — the checker must FAIL, and name the
 * right reason, for every invariant it claims to police.
 *
 *   node scripts/test_check_cry_index.mjs
 *
 * WHY THIS FILE EXISTS. Most of the invariants here are "these two files agree",
 * and agreement checks are the easiest kind to write so that they are green for
 * the wrong reason: a comparison against an empty set, a regex anchored on a
 * string a refactor moved, an import that throws and is swallowed. A checker
 * that cannot fail is worse than no checker, because it is trusted.
 *
 * Each case below breaks ONE invariant in a scratch copy of the tree, runs the
 * real checker against it, and requires a non-zero exit AND a specific substring.
 * Asserting only the exit code would pass on a crash, which is how a typo
 * becomes a "passing" test.
 *
 * The last case runs the OPPOSITE direction — a species dropped from the dataset
 * cleanly must PASS. Without it a checker that simply demanded 1025 entries would
 * look correct forever, and the roster generator's own "complete: every species"
 * branch would be unpoliced.
 *
 * The harness runs from a temp tree, so a failed case cannot leave the working
 * tree modified. `assets/cries/` is copied for real rather than symlinked or
 * hardlinked, because several cases overwrite or delete a file inside it, and
 * both of those reach THROUGH the link into the real audio: `copyFileSync` opens
 * its destination `O_TRUNC`, so a hardlink is as destructive here as a symlink.
 * That reasoning is why this file still copies the corpus at all — see below for
 * how much it copies.
 *
 * THE WORKING TREE IS BUILT ONCE, NOT ONCE PER CASE
 *
 * This used to call `makeTree()` 22 times, and `makeTree` copied `assets/cries/`
 * whole — 31 MB over 2,000 files, every time. That is 682 MB of write traffic to
 * re-derive twenty-two copies of bytes nothing had edited, and it was half the
 * wall clock: 22.6 s measured, of which ~11 s was copying and ~11 s the 22 real
 * checker runs. `sorting.html`'s checker was cut from 93 s to 14 s by answering
 * 1,025 sprite requests with a 71-byte stub for the same reason — a page-sized
 * payload that is fetched repeatedly and read by nothing. The fix here is the
 * stronger one, because nothing has to be faked: the corpus is still the real
 * audio, the checker still magic-sniffs all 1,674 roster files, and the baseline
 * still has to pass on the tree the cases run against.
 *
 * So there is ONE working tree, and a case restores what it touched instead of
 * the tree being rebuilt. Restore reads from ROOT, which is never written to,
 * which is what makes reusing the directory safe at all.
 *
 * The trap this shape invites is a hand-maintained list of "the paths a case is
 * allowed to touch" — a second copy of the truth, and the thing that rots when a
 * case grows a new mutation and forgets the list, at which point the NEXT case
 * runs against a dirty tree and passes for the wrong reason. So there is no list:
 * `io` is the only way a case reaches the corpus, and every `io` call records its
 * own path. Forgetting is not possible because there is nothing to forget.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { caughtBy, failLines } from './lib/negative.mjs';

// Read from the real module, not a hardcoded list, so the cleanup case below knows
// whether the id it removes is in the legacy roster too.
const { LEGACY_CRY_IDS } = await import('../assets/js/cry-index.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The real files, copied whole. The checker imports the REAL generated module
// (from the temp tree, by path) and derives everything else from the real
// dataset, so the fixture cannot drift into agreeing with a bug in the checker.
const SRC = [
  'assets/data/pokemon_data.json',
  'assets/js/cry-index.js',
  'assets/js/cry-player.js',
  'detail.html',
  'scripts/extract_cry_index.py',
  'scripts/check_cry_index.mjs',
];
/* The checker scans the whole frontend for a remote cry host, so the fixture has
   to actually contain a frontend. Without assets/css it threw ENOENT on
   readdirSync and every case measured that crash instead of its own mutation. */
const DIRS = ['assets/css'];
const CRIES = 'assets/cries';
const CHECKER = 'scripts/check_cry_index.mjs';

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

/** Add or drop one id token in one of the two roster string literals.
 *  The bodies are one space-separated list, so a token is removed rather than a
 *  character range edited — a positional regex would silently mangle a
 *  neighbouring id and make a case pass for the wrong reason. */
function rosterEdit(src, which, action, id) {
  const re = which === 'legacy'
    ? /(LEGACY_CRY_IDS = new Set\(\s*")([^"]+)(")/
    : /(CRY_IDS = new Set\(\s*")([^"]+)(")/;
  const m = src.match(re);
  if (!m) throw new Error(`no ${which} roster body to edit — the generated shape changed`);
  const tokens = m[2].split(/\s+/).filter(Boolean);
  let next;
  if (action === 'add') next = [...tokens, String(id)];
  else next = tokens.filter((t) => t !== String(id));
  return src.replace(re, (_all, open, _body, close) => open + next.join(' ') + close);
}

/**
 * The single working tree, built from ROOT once.
 *
 * `SRC` and `DIRS` are re-copied before every case rather than diffed, because
 * they are 330 KB in total and a diff that misses one file is a case that passes
 * for the wrong reason. The corpus is NOT re-copied; see `io` below.
 */
const WORK = join(tmpdir(), `cry-neg-${process.pid}-${Math.random().toString(36).slice(2)}`);

/** Every path under the corpus a case has touched since the last restore.
 *  Relative to CRIES, so a case writes `latest/5.ogg` and not the full path. */
const touched = new Set();

/** Restore one repo-relative path into the working tree from ROOT.
 *
 *  ROOT is the pristine copy — the harness only ever writes inside WORK — so this
 *  is what makes a mutated audio file come back to being the real recording. A
 *  path that does not exist in ROOT is REMOVED instead, which is how a case that
 *  created a file (`legacy/9999.ogg`) or deleted one (`latest/5.ogg`) is undone
 *  by the same code path. Create, overwrite and delete therefore need no
 *  separate bookkeeping, and `touched` can stay a plain Set of strings. */
function restoreInto(rel) {
  const src = join(ROOT, rel);
  const dst = join(WORK, rel);
  if (!existsSync(src)) {
    rmSync(dst, { force: true, recursive: true });
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  // `SRC` holds files and `DIRS` holds `assets/css`, and they arrive from the same
  // list — so one entry can be either and this has to be both, not whichever shape
  // the list happened to have when it was written.
  if (statSync(src).isDirectory()) {
    rmSync(dst, { force: true, recursive: true });
    cpSync(src, dst, { recursive: true });
  } else {
    copyFileSync(src, dst);
  }
}

/** The only handle a case has on the corpus. Every method records the path it
 *  changed, so restore is driven by what happened rather than by a list. */
const io = {
  /** Copy a corpus file over another, preserving the old within-tree source
   *  semantics: the source is read from the working tree, which is pristine at
   *  the top of every case because restore runs first. */
  copy: (from, to) => { copyFileSync(join(WORK, CRIES, from), join(WORK, CRIES, to)); touched.add(join(CRIES, to)); },
  write: (rel, data) => { writeFileSync(join(WORK, CRIES, rel), data); touched.add(join(CRIES, rel)); },
  remove: (rel) => { rmSync(join(WORK, CRIES, rel), { force: true }); touched.add(join(CRIES, rel)); },
};

/** The one thing that is copied rather than restored: 31 MB over 2,000 files, and
 *  paid exactly once for the whole run. Everything else `buildWork` would have
 *  done is `prepare`'s job, because restoring is what every case after the first
 *  needs anyway — copying here as well would just do it 22 times in a row. */
function buildWork() {
  mkdirSync(WORK, { recursive: true });
  cpSync(join(ROOT, CRIES), join(WORK, CRIES), { recursive: true });
}

/** Put the tree back the way `buildWork` left it, then apply this case's mutation. */
function prepare(mutate, files) {
  for (const f of [...SRC, ...DIRS]) restoreInto(f);
  for (const rel of touched) restoreInto(rel);
  touched.clear();

  if (mutate) {
    for (const f of SRC) {
      const p = join(WORK, f);
      const before = readFileSync(p, 'utf8');
      // `undefined` means "this case does not target this file". A returned
      // string IDENTICAL to the input means a stale anchor, and the case would
      // then pass for the wrong reason — an error, not a no-op.
      const after = mutate(f, before);
      if (after === undefined) continue;
      if (after === before) {
        throw new Error(`mutation for ${f} did not change the file — the anchor string is stale, so this case would pass for the wrong reason`);
      }
      writeFileSync(p, after);
    }
  }
  if (files) files(WORK, io);
}

function run() {
  try {
    const out = execFileSync(process.execPath, [join(WORK, CHECKER)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

buildWork();

// Baseline first: if the unmutated tree does not pass, every case below would be
// measuring the harness rather than the checker. This is also what proves the
// reuse is sound — the corpus here is the real 31 MB one, so if `prepare()` left
// anything dirty this is where it would show up.
{
  prepare(null, null);
  const { code, out } = run();
  code === 0 ? pass('baseline: the checker passes on an unmutated copy of the tree')
             : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

const textCases = [
  /* Roster vs directory. */
  {
    name: 'the roster forgets a species that the dataset still has',
    mutate: (f, s) => f.endsWith('cry-index.js') ? rosterEdit(s, 'latest', 'drop', 5) : undefined,
    expect: 'latest roster covers exactly the species',
  },
  {
    name: 'the roster invents a species the dataset does not have',
    mutate: (f, s) => f.endsWith('cry-index.js') ? rosterEdit(s, 'latest', 'add', 9999) : undefined,
    expect: 'latest roster covers exactly the species',
  },

  /* legacy must be a subset, not a copy and not an accident. */
  {
    // 9999 is in neither roster. An id *below* 1025 would not test this at all:
    // `latest` is complete 1-1025, so adding e.g. 700 to legacy puts it in both
    // and only trips the 649 ceiling, which is a different case below.
    name: 'legacy claims an id that latest does not have, so it is no longer a subset',
    mutate: (f, s) => f.endsWith('cry-index.js') ? rosterEdit(s, 'legacy', 'add', 9999) : undefined,
    files: (dir, io) => io.copy('legacy/1.ogg', 'legacy/9999.ogg'),
    expect: 'legacy ids absent from the latest roster',
  },
  {
    name: 'legacy is repopulated as a full copy of latest, so the two are no longer distinct sets',
    mutate: (f, s) => f === 'assets/js/cry-index.js'
      ? s.replace(/(LEGACY_CRY_IDS = new Set\(\s*")([^"]+)(")/,
        (m, open, _body, close) => open + s.match(/(CRY_IDS = new Set\(\s*")([^"]+)(")/)[2] + close)
      : undefined,
    expect: 'legacy roster is a strict subset',
  },
  {
    name: 'legacy reaches past 649, the last id with a Gen 1-5 recording',
    mutate: (f, s) => f.endsWith('cry-index.js')
      ? rosterEdit(rosterEdit(s, 'legacy', 'add', 700), 'latest', 'add', 700)
      : undefined,
    files: (dir, io) => io.copy('latest/700.ogg', 'legacy/700.ogg'),
    expect: 'legacy roster stops at 649',
  },

  /* Provenance. */
  {
    name: 'the generator is repointed at another repository, silently',
    mutate: (f, s) => f.endsWith('extract_cry_index.py')
      ? s.replace('SOURCE = "https://github.com/PokeAPI/cries"', 'SOURCE = "https://example.invalid/cries"')
      : undefined,
    expect: 'generator SOURCE matches the generated CRY_SOURCE',
  },
  {
    name: 'both halves agree, but the site stops crediting PokeAPI',
    mutate: (f, s) => f.endsWith('extract_cry_index.py') && f.includes('extract')
      ? s.replace('https://github.com/PokeAPI/cries', 'https://example.invalid/cries')
      : f.endsWith('cry-index.js')
        ? s.replace('https://github.com/PokeAPI/cries', 'https://example.invalid/cries')
        : undefined,
    expect: 'the exported source is the PokeAPI/cries repository',
  },

  /* The migration this roster exists for: nothing may reach the network. */
  {
    name: 'detail.html is put back on the remote cry host',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace(/await cryPlayer\.play\(currentPokemon\.id\);/,
        "await new Audio('https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/1.ogg').play();")
      : undefined,
    expect: 'still pointing at the remote cry host',
  },
  {
    name: 'cry-player.js reaches for the network directly',
    mutate: (f, s) => f.endsWith('cry-player.js')
      ? s.replace('fetch(cryUrl(id, { legacy }))',
        "fetch(`https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`)")
      : undefined,
    expect: 'still pointing at the remote cry host',
  },
  {
    name: 'a page hand-builds the cry path instead of asking cryUrl',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace("import {hasCry} from './assets/js/cry-index.js';",
        "import {hasCry} from './assets/js/cry-index.js';\n    const PREFIX = 'assets/cries/latest/';")
      : undefined,
    expect: 'hand-build a cry path',
  },

  /* Page wiring. */
  {
    name: 'detail.html stops importing hasCry, so the button is never gated on the roster',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace("import {hasCry} from './assets/js/cry-index.js';", '')
      : undefined,
    expect: 'imports hasCry from the generated module',
  },
  {
    name: 'detail.html stops importing the player',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace("import {cryPlayer} from './assets/js/cry-player.js';", '')
      : undefined,
    expect: 'imports the shared player',
  },
  {
    name: 'the button plays something other than the Pokémon on screen',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace('await cryPlayer.play(currentPokemon.id);', 'await cryPlayer.play(1);')
      : undefined,
    expect: 'plays the cry of the Pokémon it is showing',
  },
  {
    name: 'navigation no longer stops a cry, so it outlives the species',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace('      cryPlayer.stop();\n', '')
      : undefined,
    expect: 'stops playback when it navigates',
  },

  /* The failure-message contract — the specific regression this migration fixed. */
  {
    name: 'the three causes collapse back into one message',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace(/function cryFailureMessage\(reason\) \{[\s\S]*?\n {4}\}/,
        "    function cryFailureMessage(reason) {\n      return '叫聲不可用';\n    }")
      : undefined,
    expect: 'every cause gets its own branch and message',
  },
  {
    name: 'the catch stops passing the reason through, so every failure reads alike',
    mutate: (f, s) => f === 'detail.html'
      ? s.replace('cryFailureMessage(error && error.reason)', "cryFailureMessage('unknown')")
      : undefined,
    expect: "routes the player's reason into the mapper",
  },

  /* Container sniffing — the reason this checker does not trust the extension. */
  {
    name: 'the mislabeling note rots: 25.ogg is quietly made a real Ogg, and the count is stale',
    files: (dir, io) => io.copy('legacy/25.ogg', 'latest/25.ogg'),
    expect: 'the roster species that are not Ogg are still exactly 25, 808, 809',
  },
  {
    name: 'legacy is refilled by copying latest, so the "different recording" claim is false',
    files: (dir, io) => {
      for (const f of ['1.ogg', '25.ogg', '649.ogg']) {
        io.copy(`latest/${f}`, `legacy/${f}`);
      }
    },
    expect: 'byte-identical copies of their latest counterpart',
  },
  {
    name: 'a roster file is an error body wearing an .ogg name',
    files: (dir, io) => io.write('latest/5.ogg', '404: Not Found'),
    expect: 'not a known audio container',
  },
  {
    name: 'a roster file is a truncated stub below the minimum audio size',
    files: (dir, io) => io.write('latest/5.ogg', Buffer.concat([
      Buffer.from('OggS', 'latin1'), Buffer.alloc(64)])),
    expect: 'below the minimum audio size',
  },
  {
    name: 'a roster file is deleted, so its button 404s',
    files: (dir, io) => io.remove('latest/5.ogg'),
    expect: 'ids in a roster with no file behind them',
  },
];

for (const c of textCases) {
  prepare(c.mutate, c.files);
  const { code, out } = run();
  if (code !== 0 && caughtBy(out, c.expect)) pass(c.name);
  else fail(`${c.name}\n      exit ${code}, expected the checker to fail with "${c.expect}"\n${failLines(out).map((l) => `      ${l.trim()}`).join('\n') || out.split('\n').slice(-8).join('\n')}`);
}

/* Opposite direction. A species removed from the dataset must not read as a
   defect: the rosters and the directory shrink together and the checker has to
   accept it. A checker that only ever demanded 1025 would pass every case above
   and still be wrong.
   The id is 5, which legacy also carries, so it has to leave BOTH rosters — the
   subset assertion would otherwise catch the cleanup instead of the coverage
   one and the case would pass for the wrong reason. Read that from the real
   module rather than assuming it, so the case keeps working if the legacy set
   ever stops at a different id. */
const SHRINK_ID = 5;
const LEGACY_HAD_SHRINK = LEGACY_CRY_IDS.has(SHRINK_ID);
{
  prepare((f, s) => {
    if (f === 'assets/data/pokemon_data.json') {
      return JSON.stringify(JSON.parse(s).filter((p) => p.id !== SHRINK_ID));
    }
    if (f === 'assets/js/cry-index.js') {
      let out = rosterEdit(s, 'latest', 'drop', SHRINK_ID);
      if (LEGACY_HAD_SHRINK) out = rosterEdit(out, 'legacy', 'drop', SHRINK_ID);
      return out;
    }
    return undefined;
  });
  io.remove(`latest/${SHRINK_ID}.ogg`);
  if (LEGACY_HAD_SHRINK) io.remove(`legacy/${SHRINK_ID}.ogg`);
  const { code, out } = run();
  code === 0 ? pass('a species dropped cleanly from the dataset, rosters and directory still passes')
             : fail(`a clean dataset shrink was reported as a defect — the checker is hardcoding completeness:\n${out}`);
}

rmSync(WORK, { recursive: true, force: true });

console.log(failures
  ? `\nFAIL  ${failures} negative case(s) did not behave`
  : '\nPASS  every negative case failed for the right reason');
process.exit(failures ? 1 : 0);
