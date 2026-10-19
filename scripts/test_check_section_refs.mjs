#!/usr/bin/env node
/**
 * Negative tests for check_section_refs.mjs.
 *
 *   node scripts/test_check_section_refs.mjs
 *
 * Proves the cross-reference checker fails, and names the right assertion, for
 * every shape of the defect it exists to prevent.
 *
 * **Five cases break the TREE and ONE breaks the CHECKER, and the last is the
 * one that makes the file worth more than a coverage number.** A checker only
 * attacked through its input cannot tell "the rule is enforced" from "the walk
 * happens to be green" — the five tree cases would all still pass with every
 * assertion deleted, because they only ever confirm the checker notices a
 * planted string. Case 6 narrows the walk until it scans nothing at all, and the
 * non-vacuity floors (`scanned ... text files`, `found ... §3 citations`) are the
 * only thing between that and a silent zero.
 *
 * `expect` is a COPY of the checker's assertion text, not a reference to it —
 * `caughtBy` matches it against the FAIL block of a subprocess whose source is
 * the mutated tree, so the two files cannot share a constant by construction.
 * **Do not "de-duplicate" them**: the copy is what fails loudly when an assertion
 * is renamed and the expectation is not.
 *
 * Two mutations are planted through files the checker scans on purpose: case 4
 * writes a `gotcha` pointer into a `.py`, so it fails the moment `.py` leaves
 * SCAN_EXT, and case 2 renames a heading in AGENTS.md, so it fails if the anchor
 * set is ever hardcoded instead of read out of the document.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_section_refs.mjs';
const SCRIPTS = join(ROOT, 'scripts');

/**
 * The tree is `scripts/*.mjs`, `scripts/*.py`, `scripts/lib/` and `AGENTS.md` —
 * nothing else. The scripts carry the §3 citations and `gotcha` pointers the walk
 * counts, and AGENTS.md is the anchor set the walk resolves them against. The
 * checker and this harness are copied too and skipped by the checker's EXEMPT
 * list. A `.py` is copied because one case plants a defect there, so a change to
 * SCAN_EXT that dropped `.py` would fail that case rather than pass silently.
 */
function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'sref-neg-')));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of readdirSync(SCRIPTS)) {
    if (f.endsWith('.mjs') || f.endsWith('.py')) cpSync(join(SCRIPTS, f), join(dir, 'scripts', f));
  }
  cpSync(join(SCRIPTS, 'lib'), join(dir, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), readFileSync(join(ROOT, 'AGENTS.md')));
  if (mutation) mutation(dir);
  return dir;
}

/** Break one file's contents, and THROW when the target string is absent. */
function edit(dir, rel, from, to) {
  const p = join(dir, rel);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`mutation target not found in ${rel}: ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
}

/** Append a line — a citation lives on a line, so it needs no exact anchor. */
function poke(dir, rel, line) {
  writeFileSync(join(dir, rel), `${readFileSync(join(dir, rel), 'utf8')}\n${line}\n`);
}

const run = (dir) => new Promise((resolve) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
  });
});

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  releaseTree(dir);
  code === 0
    ? pass('baseline: the §3 anchors resolve, zero dangling citations, no gotcha pointer')
    : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: 'a citation to a heading that does not exist',
    mutate: (dir) => poke(dir, 'scripts/check_agents_size.mjs', '// see §3.QQ for the rationale'),
    expect: 'every §3 citation names a §3 heading',
  },
  {
    name: 'AGENTS.md renames a §3 heading, so every citation to the old letter dangles — proves the anchor set is read, not hardcoded',
    mutate: (dir) => edit(dir, 'AGENTS.md', '### G4. The Sorting Page Finally Has A Checker',
      '### GX. The Sorting Page Finally Has A Checker'),
    expect: 'every §3 citation names a §3 heading',
  },
  {
    name: 'a numbered gotcha pointer is reintroduced in a script',
    mutate: (dir) => poke(dir, 'scripts/check_agents_size.mjs', '// supersedes the old gotcha 3 note'),
    expect: "no dead numbered 'gotcha' pointer survives",
  },
  {
    name: 'a gotcha pointer hides in a .py — caught only while .py is in SCAN_EXT',
    mutate: (dir) => poke(dir, 'scripts/fetch_moves.py', '# was tracked as gotcha 9'),
    expect: "no dead numbered 'gotcha' pointer survives",
  },
  {
    name: 'AGENTS.md loses its ## 3 section marker, so the anchor set has no span',
    mutate: (dir) => edit(dir, 'AGENTS.md', '## 3. Key Technical Conventions & Invariants',
      '## 3b. Key Technical Conventions & Invariants'),
    expect: 'AGENTS.md has a § 3',
  },
  {
    name: 'the walk is narrowed until it scans nothing — only the non-vacuity floors can catch it',
    mutate: (dir) => edit(dir, CHECKER, 'if (SCAN_EXT.has(ext)) files.push(rel);',
      'if (false) files.push(rel);'),
    expect: 'scanned',
  },
];

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs. Each case
 * copies ~66 small files and runs one node process that reads only those files,
 * so a case is a few tens of milliseconds of work and nothing else. */
const verdicts = await pool(CASES.map((c) => async () => {
  const dir = makeTree(c.mutate);
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    releaseTree(dir);
  }
  if (code === 0) return { name: c.name, detail: `exited with 0 (expected failure naming "${c.expect}")` };
  if (caughtBy(out, c.expect)) return { name: c.name, detail: null };
  return { name: c.name, detail: `failed, but NOT caught by expected assertion "${c.expect}". Output was:\n${out}` };
}));

for (const v of verdicts) v.detail === null ? pass(v.name) : fail(`${v.name}: ${v.detail}`);

console.log(`\n${failures ? `FAIL  ${failures} of ${CASES.length + 1} checks failed` : `PASS  every negative case failed for the right reason`}`);
process.exit(failures ? 1 : 0);
