/**
 * AGENTS.md size + cross-reference regression test
 *
 *   node scripts/check_agents_size.mjs
 *
 * AGENTS.md is loaded into context at the start of every session, so its size is
 * a tax paid on every conversation rather than a file-size curiosity. It grew to
 * 313,327 chars / 1,307 lines because §3 had become a second, fuller copy of the
 * narratives in docs/incidents/ — the same incidents, told twice, once as a rule
 * and once as prose. §3 is now the rule table (rule / Guarded by / Background
 * link) and the prose lives only in docs/incidents/.
 *
 * This checker is what keeps that from happening again. It asserts:
 *
 *   1. the whole file is under a ceiling, so a section cannot quietly re-inflate;
 *   2. no single §3 section is over its own ceiling, so one incident cannot grow
 *      back into the weight of twenty;
 *   3. every §3 section carries a **Background:** link;
 *   4. every one of those links resolves — the file exists AND the '#anchor'
 *      matches an '<a id="…">' in it. A bare '#a' is not evidence the narrative
 *      is reachable;
 *   5. every '§3.X' reference in the file names a §3 heading, so a rewrite that
 *      drops or renames a section leaves no dangling citation behind.
 *   6. Chinese in a heading is a DEFECT — every '##'-'####' heading is English.
 *      The only exception is AGENTS.md's H1, which is the site's name;
 *   7. unwrapped Chinese in the body is BUDGETED per file, not banned. Prose is
 *      English and Chinese survives as 「」-quoted UI labels, species / form
 *      names and code spans — but a name or an eyebrow may still appear unquoted
 *      mid-sentence, so a flat "no Chinese" rule would be false.
 *
 * The ceiling is not a taste. The floors are real: §3 is ~47 KB of load-bearing
 * rules and the guard exists to stop growth, not to force a rewrite. If a future
 * change genuinely needs more room, raise CEILING_CHARS in the same commit and
 * say why — the same discipline §4 asks of any threshold.
 *
 * The language rules exist because AGENTS.md and docs/incidents/ are the
 * project's reading surface: a heading carrying Chinese is not greppable, while
 * a 「」-quoted UI name is load-bearing (it is the label the page renders) and
 * must stay verbatim. The budget bounds incidental Chinese; it does not claim
 * there is none.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = join(ROOT, 'AGENTS.md');

/** Whole-file budget. Current: ~84 KB. Original (pre-§3 move): ~313 KB. */
const CEILING_CHARS = 90_000;
const CEILING_LINES = 720;
/** One §3 section. Largest real section today is '#AC' at 1,873 chars. */
const SECTION_CEILING = 3_500;

let failures = 0;
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  }
}

const source = readFileSync(AGENTS, 'utf8');
const lines = source.split('\n');

// ---- 1/2. Size ceilings ----------------------------------------------------

ok(
  source.length <= CEILING_CHARS,
  `AGENTS.md is ${source.length} chars (ceiling ${CEILING_CHARS})`
);
ok(
  lines.length <= CEILING_LINES,
  `AGENTS.md is ${lines.length} lines (ceiling ${CEILING_LINES})`
);

// ---- Locate § 3 and split it into sections ---------------------------------

const i3 = lines.findIndex((l) => l.startsWith('## 3.'));
const i4 = lines.findIndex((l) => l.startsWith('## 4.'));
ok(i3 >= 0 && i4 > i3, 'AGENTS.md has a § 3 followed by a § 4');

const s3 = lines.slice(i3, i4).join('\n');
const firstHeading = s3.search(/^### /m);
const intro = firstHeading < 0 ? s3 : s3.slice(0, firstHeading);
const sectionText = firstHeading < 0 ? '' : s3.slice(firstHeading);

// Split on '### ' headings, keeping each heading with its body.
const sections = [];
const re = /^### (.*)$/gm;
const heads = [...sectionText.matchAll(re)];
for (let i = 0; i < heads.length; i += 1) {
  const start = heads[i].index;
  const end = i + 1 < heads.length ? heads[i + 1].index : sectionText.length;
  sections.push({ heading: heads[i][1].trim(), body: sectionText.slice(start, end) });
}

ok(sections.length >= 30, `§ 3 has ${sections.length} sections (expected at least 30)`);

const headingLetters = new Set(
  sections.map((s) => (s.heading.match(/^([A-Z]+[0-9]*)[.\s]/) || [])[1]).filter(Boolean)
);

const linkRe = /\[[^\]]*\]\((docs\/incidents\/[^)#]*)#([^)]+)\)/g;

for (const { heading, body } of sections) {
  const letter = (heading.match(/^([A-Z]+[0-9]*)[.\s]/) || [])[1] || heading.slice(0, 8);

  ok(
    body.length <= SECTION_CEILING,
    `§3.${letter} is ${body.length} chars (ceiling ${SECTION_CEILING})`
  );

  ok(
    /\*\*Background:\*\*/.test(body),
    `§3.${letter} carries a **Background:** link`
  );

  const links = [...body.matchAll(linkRe)];
  ok(links.length > 0, `§3.${letter} links to a docs/incidents/ anchor`);

  for (const [, file, anchor] of links) {
    const target = join(ROOT, file);
    if (!existsSync(target)) {
      ok(false, `§3.${letter} links to ${file}, which does not exist`);
      continue;
    }
    const doc = readFileSync(target, 'utf8');
    const hasAnchor = new RegExp(`<a id="${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></a>`).test(doc);
    ok(hasAnchor, `§3.${letter}'s ${file}#${anchor} resolves to an <a id>`);
  }
}

// ---- 5. Every '§3.X' reference names a heading -----------------------------

const refs = [...source.matchAll(/§3\.([A-Z]+[0-9]*)/g)].map((m) => m[1]);
const dangling = [...new Set(refs)].filter((r) => !headingLetters.has(r));
ok(
  dangling.length === 0,
  `every §3.x reference resolves${dangling.length ? ` (dangling: ${dangling.join(', ')})` : ''}`
);

// ---- 6/7. Heading language + per-file unwrapped-CJK budget -----------------

/** The reading surface: AGENTS.md plus every docs/incidents/ narrative. */
const DOCS_DIR = join(ROOT, 'docs', 'incidents');
const docFiles = existsSync(DOCS_DIR)
  ? readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => join(DOCS_DIR, f))
  : [];
const langFiles = [AGENTS, ...docFiles];

/** Non-vacuity floor (§4): a scan that finds nothing proves nothing. */
const EXPECTED_LANG_FILES = 7;
ok(
  langFiles.length >= EXPECTED_LANG_FILES,
  `language scan covers ${langFiles.length} files (expected at least ${EXPECTED_LANG_FILES})`
);

/** Strip fenced blocks, 「…」 UI names and `code spans` before counting. */
function maskCjk(s) {
  return s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/「[^」]*」/g, '')
    .replace(/`[^`]*`/g, '');
}
const countCjk = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;

/**
 * Per-file budget for UNWRAPPED Chinese in prose. Measured today: the largest
 * file is docs/incidents/color.md at 161, so 250 leaves real headroom without
 * letting a second language creep back into the narratives.
 */
const PROSE_CJK_BUDGET = 250;

for (const file of langFiles) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');

  const cjk = countCjk(maskCjk(text));
  ok(
    cjk <= PROSE_CJK_BUDGET,
    `${rel} carries ${cjk} unwrapped CJK (budget ${PROSE_CJK_BUDGET})`
  );

  // Headings are exempt only at H1 (AGENTS.md's own title). Every other heading
  // is pure English, so the section map stays greppable and searchable.
  const badHeads = [];
  text.split('\n').forEach((line, i) => {
    if (/^#{2,4}\s/.test(line) && countCjk(maskCjk(line)) > 0) {
      badHeads.push(`${rel}:${i + 1} "${line.trim()}"`);
    }
  });
  ok(
    badHeads.length === 0,
    `headings are English in ${rel}${badHeads.length ? `: ${badHeads.join(' | ')}` : ''}`
  );
}

// ---- Summary ---------------------------------------------------------------

console.log(
  failures === 0
    ? `\nall ${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`
);
process.exit(failures === 0 ? 0 : 1);
