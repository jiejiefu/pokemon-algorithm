/**
 * Repo-wide cross-reference guard: every `§3.<letter>` citation names a real §3
 * heading, and the retired numbered "gotcha" pointers stay gone.
 *
 *   node scripts/check_section_refs.mjs
 *
 * WHY
 * ---
 * AGENTS.md's §3 sections are cited from more than a thousand places across
 * assets/js, assets/css, the pages, scripts/ and docs/. AGENTS.md's OWN citations
 * are guarded by check_agents_size.mjs, but a citation anywhere else had nothing
 * watching it: rename §3.G4 and every comment still pointing at the old letter
 * keeps its green tick. The same is true of the numbered "gotcha" list that §3
 * replaced — a stale `gotcha N` reads as authoritative while pointing at nothing.
 *
 * A citation is a claim about a document, so it belongs in the suite rather than
 * in review. This checker walks the text half of the repo, collects every
 * `§3.<letter>` citation and asserts the letter is a `### X.` heading between
 * AGENTS.md's `## 3.` and `## 4.`, and asserts no numbered `gotcha` pointer
 * survives. Static, reads files off disk only, so it costs a fraction of a second.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not police `§4`/`§5`/`§6` citations — those are section numbers, not
 * lettered anchors — and it prunes the binary asset trees rather than filtering
 * them, because a §3 citation cannot live in a PNG.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = join(ROOT, 'AGENTS.md');

/* Two files are exempt, and the second is not a convenience. SELF carries the
 * §3 anchors and the word `gotcha` in its own prose; the mutation harness embeds
 * the exact strings it plants — a `gotcha N` and a dangling `§3.QQ` — so a scan
 * over it would report the fixture rather than the repo. Same reason
 * test_check_sorting_page.mjs carries the 71-byte sprite stub it serves. */
const SELF = 'scripts/check_section_refs.mjs';
const EXEMPT = new Set([SELF, 'scripts/test_check_section_refs.mjs']);

/* Only files that can carry a comment. The binary trees are pruned by path so a
 * walk never even lists their contents. */
const SCAN_EXT = new Set(['.mjs', '.js', '.cjs', '.html', '.css', '.md', '.py']);
const SKIP_NAMES = new Set(['.git', 'node_modules', '.cache', '__pycache__',
  '.impeccable', '.opencode', '.vscode']);
const SKIP_PATHS = new Set(['assets/images', 'assets/cries', 'assets/glbs',
  'assets/video', 'assets/data', 'data-sources']);

const C = createChecker();

// ---- The set of real §3 anchors, read out of AGENTS.md itself ---------------

const agents = readFileSync(AGENTS, 'utf8').split('\n');
const i3 = agents.findIndex((l) => l.startsWith('## 3.'));
const i4 = agents.findIndex((l) => l.startsWith('## 4.'));
C.ok(i3 >= 0 && i4 > i3, 'AGENTS.md has a § 3 followed by a § 4');

const headings = agents.slice(i3, i4)
  .map((l) => (l.match(/^### ([A-Z]+[0-9]*)[.\s]/) || [])[1])
  .filter(Boolean);
const anchors = new Set(headings);
C.ok(headings.length >= 30, `§3 exposes ${headings.length} lettered headings`);

// ---- Walk the text half of the repo ----------------------------------------

const files = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (e.isDirectory()) {
      if (SKIP_NAMES.has(e.name) || SKIP_PATHS.has(rel)) continue;
      walk(abs);
      continue;
    }
    if (EXEMPT.has(rel)) continue;
    const dot = e.name.lastIndexOf('.');
    const ext = dot < 0 ? '' : e.name.slice(dot);
    if (SCAN_EXT.has(ext)) files.push(rel);
  }
})(ROOT);

// ---- Every citation resolves, and no dead gotcha pointer survives -----------

let refs = 0;
const dangling = new Set();
const gotcha = [];
for (const rel of files) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const g = line.match(/gotcha\s*#?\d/i);
    if (g) gotcha.push(`${rel}:${i + 1} (${g[0]})`);
    for (const m of line.matchAll(/§3\.([A-Z]+[0-9]*)/g)) {
      refs += 1;
      if (!anchors.has(m[1])) dangling.add(`§3.${m[1]} at ${rel}:${i + 1}`);
    }
  }
}

C.ok(files.length > 50, `scanned ${files.length} text files`);
C.ok(refs > 0, `found ${refs} §3 citations to check`);
C.ok(
  dangling.size === 0,
  `every §3 citation names a §3 heading${dangling.size ? ` — dangling: ${[...dangling].join(', ')}` : ''}`
);
C.ok(
  gotcha.length === 0,
  `no dead numbered 'gotcha' pointer survives${gotcha.length ? ` — ${gotcha.join(', ')}` : ''}`
);

process.exit(C.report());
