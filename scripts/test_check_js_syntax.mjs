#!/usr/bin/env node
/**
 * Negative tests for the document-structure guard in check_js_syntax.mjs.
 *
 *   node scripts/test_check_js_syntax.mjs
 *
 * Proves that guard fails, and names the right assertion, for every shape of the
 * defect it exists to prevent — including the one that shipped, verbatim.
 *
 * WHY THIS FILE IS NOT JUST "A PAGE IS BROKEN"
 *
 * The shipped defect is not a bad page. It is a page that is FINE ON DISK: 14,083
 * characters of valid module that `node --check` parses without complaint. The
 * corruption existed only in the bytes Live Server sent, so a tree-only harness
 * would be attacking something the checker already answers correctly.
 *
 * FIVE of the six cases break the TREE (cases 1-4, 6) and ONE breaks the CHECKER
 * (case 5). That is the same split `test_check_tmp_prefixes.mjs` uses and for the
 * same reason: a checker only ever attacked through its input cannot distinguish
 * "the rule is enforced" from "the checker is currently green" — all five tree
 * cases would still pass with the guard's body deleted.
 *
 * Case 5 exists because the case-insensitivity is DELIBERATE and therefore the
 * most likely to be "simplified" by someone who does not know why it is there: it
 * mirrors Live Server's own `/<\/body>/i`, so dropping the `i` leaves a page
 * closing with `</BODY>` silently unprotected.
 *
 * The block after the cases is a PAIRING, and it is inverted on purpose: it
 * asserts that the checker exits 0 once the ordering comparison is deleted. That
 * is how case 4 is known to rest on that one comparison rather than on something
 * else in the guard that the same fixture happens to satisfy — mechanism and
 * outcome, separately, because either alone can be right about the wrong thing.
 *
 * `expect` is a COPY of the checker's assertion text, not a reference to it.
 * `caughtBy` matches it against the FAIL block of a subprocess whose source is the
 * mutated tree, so the two files cannot share a constant by construction. **Do not
 * "de-duplicate" them**: the copy is what fails loudly when an assertion is renamed
 * and the expectation is not.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { caughtBy } from './lib/negative.mjs';
import { pool } from './lib/pool.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_js_syntax.mjs';
const SCRIPTS = join(ROOT, 'scripts');

/**
 * The fixture page. One `<body>`, one `</html>`, both after the last `</script>`,
 * and TWO script blocks carrying code so the parse loop does real work rather than
 * tripping its own `checked === 0` floor — a fixture that makes the checker fail
 * for the wrong reason is a fixture that cannot tell a case apart from a broken
 * tree (the shape §3.W records as "a mutation that cannot be applied").
 *
 * The `<svg>` in the head is the whole incident in miniature: it is the tag Live
 * Server falls through TO, and on the shipped page the only one sat inside a
 * template literal. Here it is in the markup, where it belongs and where it is
 * harmless.
 */
const BASE_PAGE = [
  '<!doctype html>',
  '<html lang="zh-Hant">',
  '<head>',
  '<meta charset="utf-8">',
  '<title>fixture</title>',
  '<script>var a = 1;</script>',
  '</head>',
  '<body>',
  '<p>hi</p>',
  '<svg viewBox="0 0 1 1"><path d="M0 0"></path></svg>',
  '<script type="module">const b = 2;</script>',
  '</body>',
  '</html>',
  '',
].join('\n');

/**
 * Only the checker and one small page. The checker reads NOTHING but `ROOT/*.html`
 * and itself — no corpus, no assets, no other script — which is why a case here
 * costs two `node --check` spawns and nothing else.
 */
function makeTree(mutation) {
  const dir = trackTree(mkdtempSync(join(tmpdir(), 'jss-neg-')));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(SCRIPTS, 'check_js_syntax.mjs'), join(dir, CHECKER));
  writeFileSync(join(dir, 'fixture.html'), BASE_PAGE);
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

/** The fixture page, without the extension — cases address it as `fixture.html`. */
const page = (dir) => join(dir, 'fixture.html');
const editPage = (dir, from, to) => edit(dir, 'fixture.html', from, to);
const editChecker = (dir, from, to) => edit(dir, CHECKER, from, to);

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
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    releaseTree(dir);
  }
  code === 0
    ? pass('baseline: one page, one </body>, one </html>, both after the last </script>')
    : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
}

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: 'the shipped defect, verbatim: </body> and </html> simply absent',
    mutate: (dir) => {
      editPage(dir, '</body>\n</html>\n', '');
    },
    expect: '0 </body> (need exactly 1)',
  },
  {
    name: '</body> twice — a page that closes, then closes again',
    mutate: (dir) => {
      editPage(dir, '</body>', '</body>\n</body>');
    },
    expect: '2 </body> (need exactly 1)',
  },
  {
    name: '</html> absent while </body> is present — the </html> count is its own assertion, not a rider',
    mutate: (dir) => {
      editPage(dir, '</html>\n', '');
    },
    expect: '0 </html> (need exactly 1)',
  },
  {
    name: 'one </body>, placed before a LATER </script> — the ordering term, isolated',
    mutate: (dir) => {
      editPage(dir, '<script type="module">const b = 2;</script>\n</body>',
                     '</body>\n<script type="module">const b = 2;</script>');
    },
    expect: 'precedes the last </script>',
  },
  {
    name: 'THE CHECKER: case-insensitivity dropped, so </BODY> no longer counts as closed',
    mutate: (dir) => {
      editChecker(dir, '/<\\/body>/gi', '/<\\/body>/g');
      editPage(dir, '</body>', '</BODY>');
    },
    expect: '0 </body> (need exactly 1)',
  },
  {
    name: 'a tree with no page at all — the guard must not report "all 0 pages" as a pass',
    mutate: (dir) => {
      rmSync(page(dir));
    },
    expect: 'no pages found in the repo root',
  },
];

/* Four at a time, in DECLARATION order out — see scripts/lib/pool.mjs. Each case
 * copies one file and runs one node process that spawns two `node --check`
 * children, so a case is a few tens of milliseconds and nothing else. */
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

/* ---------------------------------------------------------------------------
 * The pairing: case 4 is caught by ONE comparison, and this proves it is that one
 *
 * A negative case on its own says "this defect is caught", never "this defect is
 * caught for the reason stated". Delete the ordering term and case 4 goes on
 * passing — silently, and with a green baseline — because every other assertion in
 * the guard is satisfied by that fixture: one `</body>`, one `</html>`, both
 * counts right.
 *
 * So the assertion here is INVERTED on purpose: with the term removed the checker
 * must exit 0, which is the only way to show case 4 was not quietly resting on
 * something else. Mechanism and outcome, separately, because either alone can be
 * right about the wrong thing.
 * --------------------------------------------------------------------- */
{
  const dir = makeTree((d) => {
    editChecker(d, 'bodies[0].index < lastScript', 'false');
    editPage(d, '<script type="module">const b = 2;</script>\n</body>',
                '</body>\n<script type="module">const b = 2;</script>');
  });
  let code, out;
  try {
    ({ code, out } = await run(dir));
  } finally {
    releaseTree(dir);
  }
  code === 0
    ? pass('pairing: with the ordering term removed, the too-early </body> of case 4 is NOT caught — so case 4 rests on that comparison and nothing else')
    : fail(`pairing FAILED — the too-early </body> is still reported without the ordering term, which means case 4 is being caught by something this harness does not know about:\n${out}`);
}

console.log(`\n${failures ? `FAIL  ${failures} of ${CASES.length + 2} checks failed` : `PASS  every negative case failed for the right reason`}`);
process.exit(failures ? 1 : 0);
