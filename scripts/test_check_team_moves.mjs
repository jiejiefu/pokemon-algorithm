#!/usr/bin/env node
/**
 * Negative tests for check_team_moves.mjs.
 *
 *   node scripts/test_check_team_moves.mjs
 *
 * The checker has two halves and both need a hostile input. The table half is
 * generated YAML-shaped JSON that nobody edits by hand — until the day someone
 * does, which is exactly when a self-consistent but wrong table survives. These
 * cases break the table against its sources (a changed level, a repeated move,
 * a TM code leaking back in, the capitalised type) and against its own claims
 * (a missing def, an emptied species).
 *
 * The module half gets the four claims that read as obviously fine: the move
 * count, the excluded-damage list, level-first drawing, and the URL's zeros.
 *
 * `expect` is a COPY of the checker's assertion text, so an assertion renamed
 * without its expectation fails here rather than passing silently.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_team_moves.mjs';
const POOL = 4;

const TREE_FILES = [
  'assets/data/team_moves.json',
  'assets/data/team_roster.json',
  'assets/data/moves_zh.json',
  'assets/data/learnsets.json',
];

function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'teammoves-neg-')));
  for (const rel of TREE_FILES) {
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(ROOT, rel), to);
  }
  cpSync(join(ROOT, 'assets/js'), join(dir, 'assets/js'), { recursive: true });
  cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
  cpSync(join(ROOT, CHECKER), join(dir, CHECKER));
  if (mutation) mutation(dir);
  return dir;
}

function edit(dir, rel, from, to) {
  const path = join(dir, rel);
  const source = readFileSync(path, 'utf8');
  if (!source.includes(from)) {
    throw new Error(`mutation target not found in ${rel}: ${JSON.stringify(from)}`);
  }
  writeFileSync(path, source.replace(from, to));
}

function patchTable(dir, fn) {
  const path = join(dir, 'assets/data/team_moves.json');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  fn(data);
  writeFileSync(path, JSON.stringify(data));
}

const run = (dir) => new Promise((resolve) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
  });
});

let failures = 0;
const ok = (name, pass, detail) => {
  if (pass) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
  }
};

{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  releaseTree(dir);
  ok('baseline: the unmodified tree passes', code === 0,
    out.trim().split('\n').slice(-2).join('\n         '));
}

const CASES = [
  {
    name: 'a move loses its def',
    why: 'the dialog looks up a def by id; a missing one renders a blank row with no error, and the picker still counts the move in its tab',
    mutate: (dir) => patchTable(dir, (data) => { delete data.defs['53']; }),
    expect: 'one def per move, and no def for `_meta`',
  },
  {
    name: 'a level-up row changes its level',
    why: 'the table is the only copy the page reads, so a hand edit looks authoritative; comparing against learnsets.json is what catches it',
    mutate: (dir) => patchTable(dir, (data) => {
      data.sets['1'].l = data.sets['1'].l.replace('33:1', '33:2');
    }),
    expect: 'every method string is rebuilt byte-for-byte from learnsets.json',
  },
  {
    name: 'a method teaches the same move twice',
    why: 'a duplicate inflates the tab count and lets one species draw the same move into two slots',
    mutate: (dir) => patchTable(dir, (data) => { data.sets['1'].l += ',33:5'; }),
    expect: 'no method teaches the same move twice',
  },
  {
    name: 'a machine row keeps its TM code',
    why: 'the code and generation are ~120 KB the page never prints; their return is also how a future regeneration silently re-expands the table',
    mutate: (dir) => patchTable(dir, (data) => { data.sets['1'].m = 'TM01,15'; }),
    expect: 'machine rows carry the id only',
  },
  {
    name: 'a def type goes back to the lowercase slug',
    why: 'type-chart.js keys are capitalised; `fire` misses the chart and reads as 1x against everything, which is a silent wrong answer on every row',
    mutate: (dir) => patchTable(dir, (data) => { data.defs['53'][2] = 'fire'; }),
    expect: 'every def row is the 9 named columns of moves_zh.json',
  },
  {
    name: 'a species keeps no move at all',
    why: 'a member with an empty pool draws nothing and the four rows become unclickable invitations with no explanation',
    mutate: (dir) => patchTable(dir, (data) => {
      data.sets['132'] = { l: '', m: '', e: '', t: '' };
    }),
    expect: 'every species can learn at least one move',
  },
  {
    name: 'the exclusion list loses a one-hit KO',
    why: 'a one-hit KO has a type and no multiplier; counting it promises coverage the chart does not deliver',
    mutate: (dir) => edit(dir, 'assets/js/team-moves.js',
      '  12, 32, 49, 68, 69, 82, 90, 101, 117, 149, 162, 243, 283, 329, 368, 515, 717,',
      '  32, 49, 68, 69, 82, 90, 101, 117, 149, 162, 243, 283, 329, 368, 515, 717,'),
    expect: 'seventeen moves are excluded from coverage',
  },
  {
    name: 'a member gets five slots',
    why: 'four is the URL chunk width and the grid the slot was measured for; five silently redefines both',
    mutate: (dir) => edit(dir, 'assets/js/team-moves.js',
      'export const MOVES_PER_MEMBER = 4;',
      'export const MOVES_PER_MEMBER = 5;'),
    expect: 'four moves per member',
  },
  {
    name: 'the draw stops preferring level-up moves',
    why: 'the default is 「等級提升」; a draw that starts at machine moves relabels the first tab while the rows show TM moves',
    mutate: (dir) => edit(dir, 'assets/js/team-moves.js',
      "const level = [...new Set(methodIds(set, 'level'))];",
      'const level = [];'),
    expect: 'a species with four level moves draws nothing else',
  },
  {
    name: 'an empty row serializes as a one',
    why: 'a `1` decodes as move 1 in a shared link, so an empty fourth row becomes a fourth move nobody chose',
    mutate: (dir) => edit(dir, 'assets/js/team-state.js',
      "tokens.push(picked[index] ? String(picked[index]) : '0');",
      "tokens.push(picked[index] ? String(picked[index]) : '1');"),
    expect: 'a member with no picks serializes to four zeros',
  },
  {
    name: 'the moves parser allows a duplicate id',
    why: 'two identical ids pass the learnable check and the slot shows the same move twice; disabling it in the dialog is not a parser rule',
    mutate: (dir) => edit(dir, 'assets/js/team-state.js',
      '|| seen.has(moveId)) {',
      ') {'),
    expect: 'a repeated id discards the whole member',
  },
];

const results = await pool(
  CASES.map((testCase) => async () => {
    let dir;
    try {
      dir = makeTree(testCase.mutate);
      const { code, out } = await run(dir);
      return { ...testCase, pass: code !== 0 && caughtBy(out, testCase.expect), detail: out, code };
    } finally {
      if (dir) releaseTree(dir);
    }
  }),
  {
    limit: POOL,
    onError: (error, index) => ({
      ...CASES[index],
      pass: false,
      detail: `the case threw: ${error.message}`,
      code: -1,
    }),
  },
);

for (const result of results) {
  ok(result.name, result.pass, result.pass ? '' :
    `exit ${result.code}, no line matching ${JSON.stringify(result.expect)}\n${String(result.detail).trim().split('\n').slice(0, 4).join('\n         ')}`);
}

console.log('');
if (failures) {
  console.error(`FAIL ${failures} of ${results.length} cases`);
  process.exit(1);
}
console.log(`PASS ${results.length} cases`);
