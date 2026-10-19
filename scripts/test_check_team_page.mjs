#!/usr/bin/env node
/**
 * Negative tests for check_team_page.mjs.
 *
 *   node scripts/test_check_team_page.mjs
 *
 * Each case breaks one thing the checker claims to guard, then requires the
 * exact assertion named in `expect` to fire. The cases are the claims a reader
 * cannot verify by reading: that the slot's split is horizontal, that the cap
 * and the duplicate rule survive, that the region list and the records are the
 * same set, and that the URL parser still refuses an out-of-range id.
 *
 * `expect` is a COPY of the checker's assertion text, not a shared constant.
 * The copy is what fails when an assertion is renamed and the expectation is
 * not — see the same note in test_check_abilities_page.mjs.
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
const CHECKER = 'scripts/check_team_page.mjs';
const POOL = 4;

const TREE_FILES = [
  'team.html',
  'assets/css/team.css',
  'assets/data/team_roster.json',
];

function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'teampage-neg-')));
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

function patchRoster(dir, fn) {
  const path = join(dir, 'assets/data/team_roster.json');
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

/* ------------------------------------------------------------------ baseline */

{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  releaseTree(dir);
  ok('baseline: the unmodified tree passes', code === 0,
    out.trim().split('\n').slice(-2).join('\n         '));
}

/* -------------------------------------------------------------------- cases */

const CASES = [
  {
    name: 'the slot split turns diagonal',
    why: 'the reference planner splits on the horizontal; 135deg is the obvious wrong way to read a two-colour background and still looks deliberate',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      'linear-gradient(180deg, var(--tm-c1) 0 50%, var(--tm-c2) 50% 100%)',
      'linear-gradient(135deg, var(--tm-c1) 0 50%, var(--tm-c2) 50% 100%)'),
    expect: 'the slot is not a diagonal split',
  },
  {
    name: 'team.js stops feeding the second colour',
    why: 'a dual-type slot that paints the primary twice looks filled, not wrong — the missing secondary is invisible without reading the property name',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      "slot.style.setProperty('--tm-c2', TYPE_COLORS[secondary] || '#777777');",
      "slot.style.setProperty('--tm-c2-unused', TYPE_COLORS[secondary] || '#777777');"),
    expect: 'team.js feeds both halves of the slot from the type palette',
  },
  {
    name: 'a second TEAM_LIMIT is added to the analysis module',
    why: 'two copies of the cap drift silently: the page can render six slots while the parser stops at five',
    mutate: (dir) => edit(dir, 'assets/js/team-analysis.js',
      'export function defensiveMultiplier',
      'export const TEAM_LIMIT = 6;\n\nexport function defensiveMultiplier'),
    expect: 'TEAM_LIMIT is defined once',
  },
  {
    name: 'the parser loses its cap',
    why: 'seven ids in ?team= would render six slots and drop the seventh with no announcement',
    mutate: (dir) => edit(dir, 'assets/js/team-state.js',
      '|| ids.length >= TEAM_LIMIT',
      '|| false'),
    expect: 'parse stops at the six-member cap',
  },
  {
    name: 'the parser loses its duplicate check',
    why: 'the same species twice would count twice in every tally while drawing one sprite',
    mutate: (dir) => edit(dir, 'assets/js/team-state.js',
      '|| ids.includes(id)',
      '|| false'),
    expect: 'parse keeps valid ids in order and drops duplicates',
  },
  {
    name: 'the id matcher goes back to a loose prefix',
    why: '025 must mean Pikachu, not every id whose four-digit form contains 025 (0250–0259)',
    mutate: (dir) => edit(dir, 'assets/js/team-state.js',
      "if (String(pokemon.id).padStart(4, '0') === digits.padStart(4, '0')) return true;",
      "if (String(pokemon.id).padStart(4, '0').includes(digits)) return true;"),
    expect: '025 does not match 0250',
  },
  {
    name: 'addMember loses its full check',
    why: 'the card grid is the other caller, and it must report 「full」 rather than silently append a seventh',
    mutate: (dir) => edit(dir, 'assets/js/team-state.js',
      'if (ids.length >= TEAM_LIMIT) return { ids, ok: false, reason: \'full\' };',
      'if (false) return { ids, ok: false, reason: \'full\' };'),
    expect: 'a seventh member is rejected with the full reason',
  },
  {
    name: 'the roster region list drops a region the records still use',
    why: 'the filter would lose a whole dex while every record still claims membership — the two-way set equality is the only visible symptom',
    mutate: (dir) => patchRoster(dir, (data) => { data.regions.pop(); }),
    expect: 'the region list and the records agree in both directions',
  },
  {
    name: 'a record carries a third type',
    why: 'every multiplier downstream assumes one or two types; a third silently multiplies into a 8x weakness',
    mutate: (dir) => patchRoster(dir, (data) => { data.pokemon[0].types.push('Fire'); }),
    expect: 'every record has names, 1–2 chart types, a generation, and a region',
  },
  {
    name: 'the slot container stops declaring six slots',
    why: 'the number is the contract between the HTML and TEAM_LIMIT; five slots would still render a plausible row',
    mutate: (dir) => edit(dir, 'team.html', 'data-slot-count="6"', 'data-slot-count="5"'),
    expect: 'the slot container declares six slots',
  },
  {
    name: 'the page imports the planner but never starts it',
    why: 'the §3.I shape: every module is correct and the page is inert, which no module test can see',
    mutate: (dir) => edit(dir, 'team.html', '    initTeamPage();', '    // initTeamPage();'),
    expect: 'the page actually starts the planner',
  },
  {
    name: 'the status line loses its [hidden] pairing',
    why: '「載入中…」 sits above a loaded grid forever; an author display rule is what makes the attribute mean anything (§3.M)',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      '.tm-status[hidden] {\n  display: none;\n}',
      '.tm-status[hidden] {\n}'),
    expect: 'the status line pairs [hidden] with an author display rule',
  },
  {
    name: 'the info bar stops using the measured badge pair',
    why: 'a hard-coded white on the type fill fails AA for half the 18 types, and the slot still looks finished',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      'const pair = typePair(primary);',
      'const pair = { fill: [0, 0, 0], text: [255, 255, 255] };'),
    expect: 'the name bar uses the measured AA fill/ink pair',
  },
  {
    name: 'dual-type defence multiplies only the first type',
    why: 'Rock on Fire/Flying is 4x; taking only Fire reports 2x, which understates the weakness the page exists to show',
    mutate: (dir) => edit(dir, 'assets/js/team-analysis.js',
      'for (const type of types) {\n    const row = TYPE_CHART[attackType];',
      'for (const type of types.slice(0, 1)) {\n    const row = TYPE_CHART[attackType];'),
    expect: 'Rock is a 4x weakness on Fire/Flying',
  },
  {
    name: 'STAB coverage reads only the first type',
    why: 'a dual type contributes both halves; Poison is the only reason Bulbasaur covers Fairy',
    mutate: (dir) => edit(dir, 'assets/js/team-analysis.js',
      'for (const type of types) {\n    const row = TYPE_CHART[type] || {};',
      'for (const type of types.slice(0, 1)) {\n    const row = TYPE_CHART[type] || {};'),
    expect: 'Bulbasaur STAB covers Water, Ground, Rock, Grass and Fairy',
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
