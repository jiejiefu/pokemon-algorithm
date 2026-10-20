#!/usr/bin/env node
/**
 * Negative tests for check_team_page.mjs.
 *
 *   node scripts/test_check_team_page.mjs
 *
 * Each case breaks one thing the checker claims to guard, then requires the
 * exact assertion named in `expect` to fire. The cases are the claims a reader
 * cannot verify by reading: that the ball's split is horizontal and round, that
 * every roster card names its types, that the cap and the duplicate rule
 * survive, that the region list and the records are the same set, and that the
 * URL parser still refuses an out-of-range id.
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
    name: 'the ball split turns diagonal',
    why: 'the reference planner splits on the horizontal; 135deg is the obvious wrong way to read a two-colour ball and still looks deliberate',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      'linear-gradient(180deg, var(--tm-c1) 0 50%, var(--tm-c2) 50% 100%)',
      'linear-gradient(135deg, var(--tm-c1) 0 50%, var(--tm-c2) 50% 100%)'),
    expect: 'the ball is not a diagonal split',
  },
  {
    name: 'the ball loses its circular clipping',
    why: 'a 14px rounded rectangle behind the sprite still shows both type colours, so the circle is the only thing that says Poké Ball',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      '  border-radius: 50%;\n  background-image:\n    radial-gradient(circle at 50% 50%,',
      '  border-radius: 14px;\n  background-image:\n    radial-gradient(circle at 50% 50%,'),
    expect: 'the ball is a circle',
  },
  {
    name: 'the ball loses its button ring',
    why: 'without the centre button the disc is a two-tone circle, which is a colour key, not the reference planner\'s ball',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      'radial-gradient(circle at 50% 50%,',
      'radial-gradient(closest-side at 50% 50%,'),
    expect: 'the ball keeps the centre button and its ring',
  },
  {
    name: 'a roster card stops mounting its type row',
    why: 'the grid is where a player picks by type; a sprite alone does not say whether it is Poison or Fire',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      "const types = el('span', 'tm-card-types');",
      "const types = el('span', 'tm-card-types-off');"),
    expect: 'every roster card mounts a type row',
  },
  {
    name: 'the card label drops the types',
    why: 'the badges are visible but the accessible name is not, so a screen reader hears a species with no type',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      '`${pokemon.names.zh}（${idText(pokemon.id)}，${typeLabels}）`',
      '`${pokemon.names.zh}（${idText(pokemon.id)}）`'),
    expect: 'the card label speaks the types the badges show',
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
    name: 'the best move drops its STAB bonus',
    why: 'a Fire move on a Fire body reads 2x instead of 3x, so the tally understates exactly the members built for the type',
    mutate: (dir) => edit(dir, 'assets/js/team-analysis.js',
      'const total = effectiveness * (move.stab ? 1.5 : 1);',
      'const total = effectiveness;'),
    expect: 'a STAB 2x move is reported at 3x',
  },
  {
    name: 'status moves are counted as coverage',
    why: 'a status move has a type and no damage; counting it promises a super-effective hit that cannot happen',
    mutate: (dir) => edit(dir, 'assets/js/team-analysis.js',
      'if (!move.damaging) continue;',
      'if (!move) continue;'),
    expect: 'a status move offers no coverage',
  },
  {
    name: 'the coverage threshold drops to any multiplier',
    why: '1x is not coverage; counting it marks all 18 rows as covered and the summary says the team has no gaps',
    mutate: (dir) => edit(dir, 'assets/js/team-analysis.js',
      '.filter((member, index) => marks[index] && marks[index].total >= 2)',
      '.filter((member, index) => marks[index] && marks[index].total > 0)'),
    expect: 'the three fixture members cover eight defending types between them',
  },
  {
    name: 'the move table is fetched on the initial paint',
    why: 'the 607 KB table would load for a visitor who never fills a slot; the roster alone is what paints the page',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      'if (!state.moveTable && state.ids.length) ensureMoves();',
      'ensureMoves();'),
    expect: 'the fetch is triggered by a filled slot, so an empty team never pays for it',
  },
  {
    name: 'the picker is a div instead of a native dialog',
    why: 'Escape, the backdrop and the focus trap come from showModal(); a div needs all three re-implemented and usually loses Escape',
    mutate: (dir) => edit(dir, 'team.html', '<dialog class="tm-move-dialog"', '<div class="tm-move-dialog"'),
    expect: 'the picker is a native <dialog>, not a hand-built modal',
  },
  {
    name: 'the tabs lose their radiogroup semantics',
    why: 'four independent toggles read as a multi-select; the picker filters one list',
    mutate: (dir) => edit(dir, 'team.html', 'id="tm-move-tabs" role="radiogroup"', 'id="tm-move-tabs"'),
    expect: 'the four method tabs are a radiogroup',
  },
  {
    name: 'focus is not returned to the row after a swap',
    why: 'update() rebuilds the slot, so the button that opened the dialog is detached; without an explicit focus the keyboard lands back at the top of the document',
    mutate: (dir) => edit(dir, 'assets/js/team.js', '    row?.focus();', ''),
    expect: 'focus returns to the row after a swap',
  },
  {
    name: 'the moves parameter goes through searchParams.set()',
    why: 'the documented share form has literal commas; set() silently percent-encodes them (§3.AD)',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      'const query = [rest, team, moves].filter(Boolean).join(\'&\');',
      'url.searchParams.set(\'moves\', moves);\n    const query = [rest, team].filter(Boolean).join(\'&\');'),
    expect: 'the moves param never goes through searchParams.set()',
  },
  {
    name: 'the picker list stops scrolling',
    why: '200 rows in an overflow-visible dialog push the hint off-screen and make the close button unreachable',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      '  overflow-y: auto;\n  border-top: 1px solid var(--hairline);\n}\n\n.tm-move-pick',
      '  border-top: 1px solid var(--hairline);\n}\n\n.tm-move-pick'),
    expect: 'the picker scrolls inside the dialog',
  },
  {
    name: 'the ball and its box stop sharing the size token',
    why: 'this is the clipping bug itself: a 148px disc in a box that sizes itself to the image loses 14px off the top, and the slot still looks like a Poké Ball',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      'min-height: calc(var(--tm-ball-size) + 12px);',
      'min-height: 120px;'),
    expect: 'the render box is sized from the ball, so the disc cannot be clipped again',
  },
  {
    name: 'a slot paints the 96px sprite instead of the artwork',
    why: 'the sprite is a 35px subject on a 96px canvas; the fallback has to be the 475px official artwork or a failed GIF silently halves the picture',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      'img.src = artworkUrl(pokemon.id);',
      'img.src = spriteUrl(pokemon.id);'),
    expect: 'a slot paints the local official artwork before anything is fetched',
  },
  {
    name: 'a failed probe swaps in the broken URL anyway',
    why: 'the fallback is the whole point of probing: a 404 on #1025 must leave the artwork, not a broken-image icon',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      'probe.onerror = () => resolve(false);',
      'probe.onerror = () => { resolve(false); img.src = showdownUrl(id); };'),
    expect: 'a failed probe keeps the local artwork rather than replacing it with a broken icon',
  },
  {
    name: 'the GIF is stretched into the square box',
    why: 'a uniform 136px box blows a 43x35 Ditto up 3.9x; the file owns its size and its aspect ratio',
    mutate: (dir) => edit(dir, 'assets/js/team.js',
      'img.style.width = `${Math.round(img.naturalWidth * factor)}px`;',
      "img.style.width = '136px';"),
    expect: 'both dimensions come from the file, so its aspect ratio is not forced into a square',
  },
  {
    name: 'a move already in another slot is no longer disabled',
    why: 'the same move in two rows is representable in the URL, and only the disabled state stops it',
    mutate: (dir) => edit(dir, 'assets/css/team.css',
      '.tm-move-pick:disabled {\n  opacity: 0.45;',
      '.tm-move-pick:disabled-unused {\n  opacity: 0.45;'),
    expect: 'a move already in another slot is visibly disabled',
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
