#!/usr/bin/env node
/**
 * Negative tests for check_abilities_page.mjs's reverse-lookup half.
 *
 *   node scripts/test_check_abilities_page.mjs
 *
 * Why this file exists rather than a note in the checker: AGENTS.md §3.W records
 * a set of 14 mutations that were RUN BY HAND and never committed, and names the
 * consequence — 「the claim is reproducible by nobody」. A mutation count written
 * in prose is a count nobody can re-derive, which is the same defect as §3.J's
 * "35 prefixes" that turned out to be 36 the day the guard was written.
 *
 * Every case here is a mutation the checker MUST catch, and each names the exact
 * assertion expected to fire. The point is not coverage of the checker but
 * coverage of its NEWEST claims, because those are the ones a reader is least
 * able to audit by reading: a cap, a de-duplication, and a derived table's
 * referential integrity all read as obviously fine and are three plausible ways
 * to ship a confidently wrong species panel.
 *
 * The three cases below were all found by hand while building this feature, and
 * the first one is the one a reader should look at twice: the "impossible"
 * assertion for a slug in both slots was wrong about the DATA, not about
 * the code — a regional forme's regular ability IS the base forme's hidden one,
 * for 12 species. A checker that encodes a belief instead of a measurement does
 * not fail when the belief is wrong; it fails when upstream changes, which may be
 * never.
 *
 * `expect` is a COPY of the checker's assertion text, not a reference to it, so
 * the two files cannot share a constant by construction. Do not "de-duplicate"
 * them: the copy is what fails loudly when an assertion is renamed and the
 * expectation is not.
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
const CHECKER = 'scripts/check_abilities_page.mjs';
const POOL = 4;

/**
 * The checker's whole reach, and nothing else.
 *
 * `assets/js/` is copied whole rather than as a list because both modules under
 * test import a graph four files deep (abilities.js -> shared.js -> form-names.js
 * -> the generated form-names-zh.js), and a list is a second thing to keep in
 * step with an import graph that changes without warning. The data side is named,
 * because the one file deliberately NOT copied is `pokemon_data.json` at 2.8 MB:
 * this checker must never need it, and copying it would hide the fact that it
 * does not.
 */
const TREE_FILES = [
  'abilities.html',
  'ability.html',
  'assets/css/abilities.css',
  'assets/css/moves.css',
  'assets/data/abilities.json',
  'assets/data/ability_species.json',
  'assets/data/species_abilities.json',
];

function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'abpage-neg-')));
  for (const rel of TREE_FILES) {
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(ROOT, rel), to);
  }
  cpSync(join(ROOT, 'assets/js'), join(dir, 'assets/js'), { recursive: true });
  cpSync(join(ROOT, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(ROOT, CHECKER), join(dir, CHECKER));
  if (mutation) mutation(dir);
  return dir;
}

/** Break one file, and THROW when the target string is absent. */
function edit(dir, rel, from, to) {
  const p = join(dir, rel);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`mutation target not found in ${rel}: ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
}

/** Rewrite the generated reverse index in place — the file a case is corrupting. */
function patchIndex(dir, fn) {
  const p = join(dir, 'assets/data/species_abilities.json');
  const data = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify(fn(data)));
}

const run = (dir) => new Promise((resolve) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
  });
});

let failures = 0;
const ok = (m, pass, detail) => {
  if (pass) console.log(`  ok   ${m}`);
  else { failures++; console.log(`  FAIL ${m}${detail ? `\n         ${detail}` : ''}`); }
};

/* ------------------------------------------------------------------ baseline */

{
  const dir = makeTree(null);
  const { code, out } = await run(dir);
  releaseTree(dir);
  ok('baseline: the unmodified tree passes', code === 0, out.trim().split('\n').slice(-2).join('\n         '));
}

/* -------------------------------------------------------------------- cases */

const CASES = [
  {
    name: 'the cap is removed from filterSpecies, so a one-character query renders all 574 species',
    why: 'the cap is the only thing between 「a」 and a 574-row panel, and nothing else about the page changes when it goes',
    mutate: (dir) => edit(dir, 'assets/js/abilities.js',
      'if (hits.length < cap) hits.push(row);',
      'hits.push(row);'),
    expect: 'a one-character query must stop at the cap',
  },
  {
    name: 'the cap is raised past the bomb case rather than removed',
    why: 'the two halves of the guard are separate — hits.length === cap AND total === 574 — so a cap that merely got large enough is caught by the first',
    mutate: (dir) => edit(dir, 'assets/js/abilities.js',
      'export const SPECIES_RESULT_CAP = 12;',
      'export const SPECIES_RESULT_CAP = 600;'),
    expect: 'a one-character query must stop at the cap',
  },
  {
    name: 'an empty query returns the whole roster instead of nothing',
    why: '「no Pokémon named」 and 「all 1,025」 are the same empty box drawn differently, and the panel would open on everything',
    mutate: (dir) => edit(dir, 'assets/js/abilities.js',
      "if (!query) return { hits: [], total: 0 };",
      "if (!query) return { hits: index.slice(0, cap), total: index.length };"),
    expect: 'an empty query must return no species',
  },
  {
    name: 'speciesSlots stops separating the slug that sits in both slots',
    why: 'the 12 folded-forme species would print one ability under two headings and read as two abilities',
    mutate: (dir) => edit(dir, 'assets/js/abilities.js',
      'reg: reg.filter(slug => !hidSet.has(slug)),',
      'reg: reg,'),
    expect: 'the three slot lists must be disjoint',
  },
  {
    name: 'the 單一特性 flag drops the hidden-slot half of its test',
    why: 'it is a claim about the species, and testing only the regular side puts the badge on the 280 species that have exactly one regular ability AND a hidden one — which is not 「單一特性」',
    mutate: (dir) => edit(dir, 'assets/js/abilities.js',
      'single: reg.length === 1 && hid.length === 0',
      'single: reg.length === 1'),
    expect: 'the 單一特性 flag must mean exactly one regular ability',
  },
  {
    name: 'the index names an ability slug abilities.json does not have',
    why: 'the reverse index stores slugs and nothing else, so a ghost slug has no name to print and the chip becomes a dead link — the failure mode a DERIVED table has and the originals do not',
    mutate: (dir) => patchIndex(dir, (d) => { d['1'].reg.push('hustlee'); return d; }),
    expect: 'the panel must not link an ability slug that abilities.json cannot name',
  },
  {
    name: 'a species loses its English name, so the search box cannot match half the queries',
    why: 'the index is what makes 「pikachu」 work without pokemon_data.json; an empty `en` is invisible in the JSON and only shows as a failed search',
    mutate: (dir) => patchIndex(dir, (d) => { d['25'].en = ''; return d; }),
    expect: 'every species the panel can render must carry a Chinese and an English name',
  },
  {
    name: 'the panel stops passing the shared cap and writes the number out instead',
    why: 'a literal beside the assertion is a second copy of the truth, and §3.S records what happens when the two drift — the stale copy passes',
    mutate: (dir) => edit(dir, 'abilities.html',
      'filterSpecies(speciesIndex, state.q, SPECIES_RESULT_CAP)',
      'filterSpecies(speciesIndex, state.q, 12)'),
    expect: 'the page should pass the shared cap into filterSpecies',
  },
  {
    name: 'the ability chips are nested inside the species link',
    why: 'two answers to two questions going to two pages; wrapped, a chip click lands on detail.html — §3.W\'s role-overrides-the-anchor shape',
    mutate: (dir) => edit(dir, 'abilities.html',
      '</a>\n        <div class="ab-species-slots">',
      '<div class="ab-species-slots">')
      && edit(dir, 'abilities.html',
        '      </li>`;\n    }',
        '      </div></a>\n      </li>`;\n    }'),
    expect: 'the species link must close before the ability slots open',
  },
  {
    name: 'the empty state is rendered even when the species panel found something',
    why: 'the whole point of the branch is that 「皮卡丘」 has an answer; printing 「沒有符合的特性」 under it contradicts the panel directly above',
    mutate: (dir) => edit(dir, 'abilities.html',
      "els.wrap.innerHTML = '';",
      "els.wrap.innerHTML = '<p class=\"ab-empty\">沒有符合的篩選條件，換個關鍵字或放寬世代試試。</p>';"),
    expect: 'the red empty state should be rendered on one branch only',
  },
  {
    name: 'the sprite loses object-position: bottom',
    why: '§3.E — the SV set is bottom-anchored, so `contain` alone passes a "does it fit" assertion while the subject floats ~3.7px above the row baseline',
    mutate: (dir) => edit(dir, 'assets/css/abilities.css',
      '  object-fit: contain;\n  object-position: bottom;\n}\n\n.ab-species-name',
      '  object-fit: contain;\n}\n\n.ab-species-name'),
    expect: 'the sprite must pair object-fit with object-position: bottom',
  },
  {
    name: 'renderSpecies() is bound without destructuring, so the result line prints [object Object]',
    why: 'THE defect this feature actually shipped with. Every other assertion here asks whether the prose EXISTS and none asks what it renders, which is §3.G1a\'s shape — the page answered the question correctly and printed a broken sentence about it',
    mutate: (dir) => edit(dir, 'abilities.html',
      'const { total: speciesTotal } = renderSpecies();',
      'const speciesTotal = renderSpecies();'),
    expect: 'renderSpecies() must be destructured at its call site',
  },
  {
    name: 'the gold fill is given --text-secondary instead of --on-accent',
    why: 'THE trap §3.AC measured on this exact fill. --accent-gold-surface inverts between themes, so a text token lands on the dark end every time — 1.58:1 dark and 1.24:1 light. The guard asserts the PAIR, because a rule may reach for either token but a gold fill can never sit under a text colour',
    mutate: (dir) => edit(dir, 'assets/css/abilities.css',
      '  color: var(--on-accent);\n  background: var(--accent-gold-surface);',
      '  color: var(--text-secondary);\n  background: var(--accent-gold-surface);'),
    expect: 'no text token may sit on the accent fill',
  },
  {
    name: 'align-items goes back to baseline on .ab-slot',
    why: 'the label became a padded pill and a padded box aligned on its text baseline sits LOWER than an unpadded one — the label is 12px and the chips 13px, so the whole group drops rather than lining up',
    mutate: (dir) => edit(dir, 'assets/css/abilities.css',
      '  align-items: center;\n  gap: 8px;\n}',
      '  align-items: baseline;\n  gap: 8px;\n}'),
    expect: '.ab-slot should centre its label against its chips',
  },
  {
    name: 'the two slot groups go back to 20px apart',
    why: 'a pill carries its own edge, so the gap that read as generous between bare text reads as cramped once there are two of them — and a pixel assertion here would only see the numbers',
    mutate: (dir) => edit(dir, 'assets/css/abilities.css',
      '  gap: 10px 28px;',
      '  gap: 8px 20px;'),
    expect: 'the two slot groups should be separated by 28px',
  },
  {
    name: 'the empty slot 「沒有隱藏特性」 is given a solid border, like a filled one',
    why: 'solid means the slot HAS abilities and dashed means it does not. That rule is only worth something if the two are actually distinguishable, and 169 of 1,025 species have no hidden ability at all',
    mutate: (dir) => edit(dir, 'assets/css/abilities.css',
      '  border: 1px dashed var(--hairline-strong);\n  border-radius: var(--radius-pill);\n}\n\n.ab-badge-single',
      '  border: 1px solid var(--hairline);\n  border-radius: var(--radius-pill);\n}\n\n.ab-badge-single'),
    expect: '「沒有隱藏特性」 is the dashed one',
  },
  {
    name: 'the page drops the shared-slot key, so 常見或隱藏 renders as is-undefined',
    why: 'the class is interpolated, so a missing argument styles nothing and renders the literal string `is-undefined` — invisible in a diff, invisible to a pixel check, and the reason the three keys are asserted as slot() ARGUMENTS rather than read off the markup',
    mutate: (dir) => edit(dir, 'abilities.html',
      "slot('常見或隱藏（依形態）', 'shared', shared)",
      "slot('常見或隱藏（依形態）', shared)"),
    expect: 'the page should build exactly the three slot modifiers',
  },
  {
    name: 'the page stops loading the reverse index at all',
    why: '§3.I — a module full of working queries is worth nothing if the page never calls them, and nothing renders wrong',
    mutate: (dir) => edit(dir, 'abilities.html',
      'loadSpeciesAbilities().catch(err => {',
      'Promise.resolve(null).catch(err => {'),
    expect: 'the page must actually load the reverse index',
  },
];

const results = await pool(
  CASES.map(c => async () => {
    let dir;
    try {
      dir = makeTree(c.mutate);
      const { code, out } = await run(dir);
      return { ...c, pass: code !== 0 && caughtBy(out, c.expect), detail: out, code };
    } finally {
      if (dir) releaseTree(dir);
    }
  }),
  {
    limit: POOL,
    onError: (e, i) => ({ ...CASES[i], pass: false, detail: `the case threw: ${e.message}`, code: -1 }),
  }
);

for (const r of results) {
  ok(r.name, r.pass, r.pass ? '' :
    `exit ${r.code}, no line matching ${JSON.stringify(r.expect)}\n${String(r.detail).trim().split('\n').slice(0, 4).join('\n         ')}`);
}

console.log('');
if (failures) {
  console.error(`FAIL ${failures} of ${results.length} cases`);
  process.exit(1);
}
console.log(`PASS ${results.length} cases`);