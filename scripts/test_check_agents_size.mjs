#!/usr/bin/env node
/**
 * Negative tests for check_agents_size.mjs's language guards.
 *
 *   node scripts/test_check_agents_size.mjs
 *
 * The size and §3-cross-reference halves of check_agents_size.mjs predate these
 * cases; this file attacks the two rules added with them:
 *
 *   FIVE cases break the TREE or the CHECKER and must fail naming the right
 *   assertion;
 *   FOUR cases run the OTHER direction — a 「」-quoted UI name, a fenced code
 *   block, an unquoted species name under budget, and an H1 title — and must
 *   stay GREEN. They are the reason the rules are a budget and a level rule
 *   rather than a flat "no Chinese", and they are checked as passes, not as
 *   `caughtBy` expectations, because a case that must NOT fail cannot live in the
 *   `cases` + `caughtBy` array without asserting the opposite of its name.
 *
 * `expect` is a COPY of the checker's assertion text, not a reference to it —
 * `caughtBy` matches it against the FAIL block of a subprocess whose source is
 * the mutated tree, so the two files cannot share a constant by construction.
 * **Do not "de-duplicate" them**: the copy is what fails loudly when an assertion
 * is renamed and the expectation is not.
 *
 * The tree is `AGENTS.md`, `docs/incidents/*.md` and the checker itself — the
 * three things the language scan reads. The checker opens no `scripts/lib/`, so
 * neither does this harness; that keeps its recorded input set to one glob for
 * `docs/incidents/` and one path per document.
 */

import {
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
const CHECKER = 'scripts/check_agents_size.mjs';
const DOCS_REL = 'docs/incidents';
const DOCS_ABS = join(ROOT, DOCS_REL);

/** Copy bytes through `readFileSync`/`writeFileSync`, so the read is recorded. */
const copy = (from, to) => writeFileSync(to, readFileSync(from));

function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'agsize-neg-')));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, DOCS_REL), { recursive: true });
  copy(join(ROOT, 'AGENTS.md'), join(dir, 'AGENTS.md'));
  for (const f of readdirSync(DOCS_ABS).filter((f) => f.endsWith('.md'))) {
    copy(join(DOCS_ABS, f), join(dir, DOCS_REL, f));
  }
  copy(join(ROOT, CHECKER), join(dir, CHECKER));
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

/** Append a line — CJK on a line needs no exact anchor to plant. */
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
    ? pass('baseline: the undocumented scan is green and every heading is English')
    : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

// ---------------------------------------------------------------------------
// Negative cases — each must fail, naming the right assertion
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: 'AGENTS.md gives a §3 heading CJK',
    mutate: (dir) => edit(dir, 'AGENTS.md',
      '### X. On A Phone, The Control Rail Sits Above The Main Content',
      '### X. 手機上的控制欄在主內容之上'),
    expect: 'headings are English in AGENTS.md',
  },
  {
    name: 'a docs/incidents heading gives in to CJK',
    mutate: (dir) => edit(dir, `${DOCS_REL}/color.md`,
      '## B. Color Extraction & MMCQ System',
      '## B. 色彩萃取 & MMCQ System'),
    expect: `headings are English in ${DOCS_REL}/color.md`,
  },
  {
    name: 'a narrative blows the unwrapped-CJK budget',
    mutate: (dir) => poke(dir, `${DOCS_REL}/life.md`, '中'.repeat(300)),
    expect: 'unwrapped CJK (budget 250)',
  },
  {
    name: 'the docs scan is narrowed to nothing — only the non-vacuity floor can catch it',
    mutate: (dir) => edit(dir, CHECKER,
      ".filter((f) => f.endsWith('.md'))",
      ".filter((f) => f.endsWith('.mdx'))"),
    expect: 'language scan covers',
  },
  {
    name: 'AGENTS.md slips over its whole-file ceiling',
    mutate: (dir) => poke(dir, 'AGENTS.md', 'x'.repeat(20000)),
    expect: 'chars (ceiling',
  },
];

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

// ---------------------------------------------------------------------------
// Opposite direction — these must stay GREEN (budget, not ban)
// ---------------------------------------------------------------------------

const GREENS = [
  {
    name: 'a 「」-quoted UI name in a heading is not a defect',
    mutate: (dir) => edit(dir, 'AGENTS.md',
      '### X. On A Phone, The Control Rail Sits Above The Main Content',
      '### X. On A Phone, The 「控制欄」 Sits Above The Main Content'),
  },
  {
    name: 'a 「」-quoted UI name in prose does not count against the budget',
    mutate: (dir) => poke(dir, `${DOCS_REL}/life.md`, `「${'中'.repeat(300)}」`),
  },
  {
    name: 'CJK inside a fenced code block does not count against the budget',
    mutate: (dir) => poke(dir, `${DOCS_REL}/life.md`, `\`\`\`\n${'中'.repeat(300)}\n\`\`\``),
  },
  {
    name: 'an unquoted species name in prose passes — the body is budgeted, not banned',
    mutate: (dir) => poke(dir, `${DOCS_REL}/color.md`, '萊希拉姆與索爾迦雷歐同框，兩個名字都超過預算嗎？不，預算之內。'),
  },
  {
    name: "an H1 title is exempt, wherever it appears",
    mutate: (dir) => poke(dir, `${DOCS_REL}/life.md`, '# 這是一級標題，中文允許'),
  },
];

for (const g of GREENS) {
  const dir = makeTree(g.mutate);
  const { code, out } = await run(dir);
  releaseTree(dir);
  code === 0
    ? pass(g.name)
    : fail(`${g.name}: expected the checker to stay green, but it exited ${code}\n${out.split('\n').slice(-8).join('\n')}`);
}

console.log(`\n${failures ? `FAIL  ${failures} of ${CASES.length + GREENS.length + 1} checks failed` : `PASS  every negative case failed for the right reason, and every green case stayed green`}`);
process.exit(failures ? 1 : 0);
