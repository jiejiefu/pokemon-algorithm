/**
 * Every `<script>` block on every page must PARSE. Not "look right" — parse.
 *
 *   node scripts/check_js_syntax.mjs
 *
 * WHY A PARSE AND NOT A GREP FOR BACKTICKS
 *
 * The bug this exists for is a backtick inside an HTML comment that sits inside a
 * JavaScript template literal:
 *
 *     els.winner.innerHTML = `
 *       <!-- of-winner-img, not -sprite: ... -->
 *       <figure class="of-winner-fig"> ... </figure>`;
 *
 * The backtick ends the template string, the rest of the page's renderer becomes
 * bare syntax, and the file does not load AT ALL — `data-outfit-ready` stays null
 * and the checker that boots the page fails on the spot. That happened five times
 * in one session, in two files, and each one cost a round trip to find.
 *
 * A grep is the obvious tool and it is the wrong one, for a reason specific to
 * this repo: NESTED template literals are everywhere and are perfectly legal —
 *
 *     ${record ? `<p class="of-winner-links"> ... </p>` : ''}
 *
 * so `rg` on backticks reports every one of those alongside the real defect. The
 * signal is buried under the project's own idioms. `node --check` asks the only
 * question that matters — is this valid JavaScript — and answers it with no false
 * positives at all.
 *
 * WHY IT IS NOT A `pre-commit` HOOK
 *
 * `.git/hooks/` is not version-controlled, so a hook protects exactly one
 * machine and vanishes on clone; it is also invisible to CI, and it would only be
 * able to look for backticks rather than for syntax errors. An entry in
 * `check_all.mjs` is versioned, runs for everyone, and covers every page whether
 * or not a browser checker ever opens it.
 *
 * THE REAL GAP THIS CLOSES, WHICH IS NOT ABOUT BACKTICKS
 *
 * Six CDP checkers boot pages over HTTP, so a syntax error in THOSE pages fails
 * loudly and immediately. Three pages carry `innerHTML` template literals and are
 * booted by nothing:
 *
 *     index.html   types.html   generations.html
 *
 * A typo in any of them ships silently, and nothing in a 46-entry suite looks.
 * That is the whole reason this is a checker rather than a habit.
 *
 * WHY THE LINE NUMBERS ARE MAPPED BACK TO THE HTML
 *
 * The parser reports "line 873" of the EXTRACTED block, which is a line number in
 * a string that does not exist on disk. Every message here carries the line in
 * `foo.html` instead, so it can be opened directly. Getting that mapping wrong
 * would make the checker's output actively misleading, so the offset is derived
 * from the tag's own position rather than counted, and asserted below.
 *
 * COST, AND THE OPTIMISATION THAT WAS DECLINED
 *
 * ~1.9s, almost all of it one `node` spawn per block — 38 of them — because that is
 * the only route to V8's own line numbers. The alternative is a single child
 * process using `vm.SourceTextModule` for the modules, which would make this
 * ~0.2s. Measured and declined: SourceTextModule's SyntaxError carries NO
 * `lineNumber`, and the whole value of this checker is a line number you can open.
 * A cheaper check that cannot say WHERE is worse than a slower one that can, and
 * two parsers is also two opinions that can disagree.
 *
 * MEASURED, not assumed: 19 pages, 19 module + 19 classic blocks, 1 importmap
 * skipped and reported, 0 failing.

 */

import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

/* ------------------------------------------------------------------ extract
 *
 * `<script type="module">` and classic `<script>` are parsed with different
 * goals: a module may use `import`/`export` and is strict by default, a classic
 * block may not. Parsing a module as a classic script therefore reports a false
 * error on its first import, and parsing a classic block as a module would accept
 * `with` — so the `type` attribute decides, rather than a default.
 */
/* A block is JavaScript if it says so, or if it says nothing at all. Anything
 * else is skipped AND REPORTED, because a silent skip is how a page stops being
 * checked without anything turning red. model3d.html has an importmap, which is
 * JSON by spec — parsing it as a script is a false positive, not a defect. */
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript',
                          'text/ecmascript', 'application/ecmascript', 'javascript']);

function scriptBlocks(src) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const attrs = m[1];
    // `src=` means the body is empty and the code lives in another file, which
    // `check_page_module_api.mjs` covers by import; there is nothing to parse here.
    if (/\bsrc\s*=/.test(attrs)) continue;
    const declared = (/\btype\s*=\s*["']?([^"'>\s]+)/.exec(attrs) || [, ''])[1].toLowerCase();
    const line = src.slice(0, m.index).split('\n').length;
    if (!JS_TYPES.has(declared)) {
      out.push({ kind: 'skipped', type: declared, code: m[2], startLine: line });
      continue;
    }
    out.push({
      kind: declared === 'module' ? 'module' : 'classic',
      code: m[2],
      startLine: line,
    });
  }
  return out;
}

/** Run the real parser. `--check` only parses; it does not execute or resolve imports. */
function parse(code, kind) {
  const args = kind === 'module'
    ? ['--input-type=module', '--check']
    : ['--check'];
  return spawnSync(process.execPath, args, { input: code, encoding: 'utf8' });
}

/**
 * V8's report is FOUR lines, not one, and getting this wrong makes every message
 * below say "parser gave no line" while looking like it tried:
 *
 *     [stdin]:1
 *     this is not javascript
 *          ^^
 *     SyntaxError: Unexpected identifier 'is'
 *
 * The prefix is `[stdin]` — angle brackets were the first guess here and they
 * match nothing. The column is NOT in the prefix; it is the caret's offset in the
 * line below, so it has to be counted out of that line.
 */
function where(stderr) {
  const m = /\[stdin\]:(\d+)/.exec(stderr);
  if (!m) return null;
  const caret = stderr.split('\n').find((l) => /^\s*\^+\s*$/.test(l));
  return { line: Number(m[1]), col: caret ? caret.indexOf('^') + 1 : 1 };
}

/** The message with V8's `SyntaxError:` prefix removed. */
function message(stderr) {
  // NOT /\bError\b/: there is no word boundary between the x of SyntaxError
  // and the E, so that regex matches nothing and the fallback silently returns
  // the raw "[stdin]:2" line instead of the message.
  const line = stderr.split('\n').find((l) => l.includes('Error')) || stderr.split('\n')[0] || '';
  return line.replace(/^SyntaxError:\s*/, '').trim();
}

/* -------------------------------------------------------------------- run */

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

// The page set is DERIVED, never listed: a new page is covered the moment it
// exists. Both counts are asserted below so an empty or silently-narrowed
// derivation cannot report a clean run having parsed nothing — the failure mode
// where a guard measures nothing and prints PASS.
let moduleBlocks = 0;
let classicBlocks = 0;
let skipped = 0;
const skippedKinds = new Map();
let checked = 0;

for (const page of pages) {
  const src = readFileSync(join(ROOT, page), 'utf8');
  const blocks = scriptBlocks(src);
  for (const b of blocks) {
    if (b.kind === 'skipped') {
      skipped++;
      skippedKinds.set(b.type, (skippedKinds.get(b.type) || 0) + 1);
      continue;
    }
    if (b.kind === 'module') moduleBlocks++; else classicBlocks++;
    if (!b.code.trim()) continue;
    const r = parse(b.code, b.kind);
    checked++;
    if (r.status === 0) continue;
    const at = where(r.stderr);
    // startLine is the line the OPENING tag sits on, so the tag's own line is
    // where the block's line 1 is; a line inside the block is startLine + n.
    const htmlLine = at ? b.startLine + at.line : null;
    fail(`${page}: the ${b.kind} script does not parse — ${message(r.stderr)}`
       + (htmlLine ? ` (${page}:${htmlLine}:${at.col})` : ' (parser gave no line)'));
  }
}

console.log(`  ${pages.length} pages, ${moduleBlocks} module + ${classicBlocks} classic blocks`
  + (skipped
    ? `, ${skipped} non-JavaScript block(s) not parsed: ${[...skippedKinds].map(([t, n]) => `${t} x${n}`).join(', ')}`
    : ''));

if (pages.length === 0) {
  fail('no pages found in the repo root — the page set is derived from a directory listing, so an empty one reads as "nothing to check"');
}
if (checked === 0) {
  fail('no script block with any code in it was parsed, so every assertion above ran zero times');
}

/* ------------------------------------------------------- document structure
 *
 * `</body>` and `</html>` are not politeness here. They are the precondition that
 * decides HOW LONG AN INLINE `<script>` IS, and today.html lost 14 KB of
 * JavaScript over their absence while every checker in this suite stayed green.
 *
 * VS Code Live Server injects its live-reload <script> before the FIRST tag it
 * matches, in this order (live-server/index.js, `injectCandidates`):
 *
 *     [ /<\/body>/i , /<\/svg>/ , /<\/head>/i ]
 *
 * `</html>` is NOT in that list. A page with no `</body>` falls through to
 * `</svg>`, and today.html's only `</svg>` sat INSIDE a template literal — the
 * 今日推薦 (Today's Pick) card's chevron icon. The injected `</script>` therefore ended the
 * inline module early at the HTML-PARSER level, which is a different thing from
 * the file failing to parse: the file on disk parsed perfectly. That is why this
 * checker could not see it — everything here reads the FILE, and the corruption
 * existed only in the bytes the server sent.
 *
 * What the reader got: `SyntaxError: Unexpected end of input` at the injected
 * line, an empty navbar, an empty theme toggle, an empty 今日推薦 card, an empty
 * 熱門 (Popular) grid, three empty 快速連結 (Quick Links) panels, nine untinted
 * 精選系列 (Featured Series) cards, and about
 * four screens of raw JavaScript rendered as page text.
 *
 * So the assertion is the PRECONDITION rather than the symptom, and it is
 * deliberately the thing Live Server keys on rather than "the page renders":
 * an inline script's extent must be decided by the file. One `</body>`, exactly
 * once, after the last `</script>` — which is also just correct HTML, and is
 * what all but one of the 23 pages did before today.html was fixed.
 */
{
  const offenders = [];
  for (const page of pages) {
    const src = readFileSync(join(ROOT, page), 'utf8');
    const bodies = [...src.matchAll(/<\/body>/gi)];
    const htmls = [...src.matchAll(/<\/html>/gi)];
    const lastScript = Math.max(-1, ...[...src.matchAll(/<\/script>/gi)].map((m) => m.index + m[0].length));
    const why = [];
    // Case-insensitive throughout, mirroring Live Server's /<\/body>/i: a page
    // carrying `</BODY>` looks closed to it and must look closed here too.
    if (bodies.length !== 1) why.push(`${bodies.length} </body> (need exactly 1)`);
    if (htmls.length !== 1) why.push(`${htmls.length} </html> (need exactly 1)`);
    // `lastScript` is the offset just PAST the last `</script>`, and the question
    // is whether `</body>` starts after the tag ENDS — not after it opens, which
    // is what a bare `</script>` index would have compared.
    if (bodies.length === 1 && bodies[0].index < lastScript) {
      why.push(`</body> at offset ${bodies[0].index} precedes the last </script> ending at ${lastScript}`);
    }
    if (why.length) offenders.push(`${page}: ${why.join('; ')}`);
  }
  if (offenders.length) {
    fail(`${offenders.length} page(s) cannot be served correctly — every check in this suite reads the file, but Live Server rewrites the bytes it sends, and a page with no </body> gets its reload <script> injected before the first </svg> or </head> instead, which silently truncates any inline script that appears before it:\n`
       + offenders.map((o) => `         ${o}`).join('\n'));
  } else {
    pass(`all ${pages.length} pages carry exactly one </body> and one </html>, each after the last </script>, so no inline script's extent is decided by the server`);
  }
}

/* The line mapping is load-bearing — a checker whose only output is a line number
 * in a string that does not exist on disk is worse than no message — so it is
 * asserted rather than assumed. An HTML file with its module on line 5 must map
 * a first-line parser error to that page's line 5. */
{
  const probe = '<!doctype html>\n<title>x</title>\n<body>\n<script type="module">\nthis is not javascript\n</script>\n';
  const blocks = scriptBlocks(probe);
  const b = blocks[0];
  const r = parse('this is not javascript', b.kind);
  const at = where(r.stderr);
  const mapped = at ? b.startLine + at.line : null;
  if (b.kind !== 'module' || r.status === 0 || at?.line !== 1 || mapped !== 5) {
    fail(`the self-check on the line mapping failed: a first-line error on the module of a 5-line probe should report line 5, got ${mapped} (block starts ${b.startLine}, parser says ${at?.line}) — every message above is a line number, so a wrong offset makes the output misleading rather than merely unhelpful`);
  } else {
    pass('a parse error is reported as a line in the .html file, not in the extracted block');
  }
}

console.log('');
console.log(failures
  ? `FAIL  ${failures} check(s) failed`
  : `PASS  every script on all ${pages.length} pages parses (${checked} block(s) actually parsed)`);
process.exit(failures ? 1 : 0);