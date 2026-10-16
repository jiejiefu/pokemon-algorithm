#!/usr/bin/env node
/**
 * Every temp-dir prefix this suite hands to a factory, and the one property
 * that matters about them.
 *
 *   node scripts/check_tmp_prefixes.mjs
 *
 * §3.J's rule: a prefix is a namespace, not a label, and a prefix which is a
 * PREFIX OF ANOTHER TOOL'S is a sweep that deletes it. It has been enforced by
 * hand since it was written, and it has been wrong twice: a cry-game harness
 * built `cgpage-neg-*` trees inside the `cgpage-` namespace another session had
 * deliberately chosen because it could not collide with `cg-sim-neg-*`. Two
 * tools, same first token, each checking only the one they knew about.
 *
 * **The whole reason this file exists is that hand-checking does not scale and
 * the count in the prose was wrong twice.** One revision of §3.J said 30, then
 * 31, then 33 — three edits of a number nothing measures. The 33 was mine, and
 * it missed two prefixes for reasons this checker is now built to make
 * impossible to miss: `cr-` is written `join(tmpdir(),'cr-')` with no space
 * after the comma, and `tree-` is nested under a BASE that is itself a
 * `join(tmpdir(), …)`. A regex written for the shape AGENTS.md itself
 * documents as "not the only one" dropped both, silently, and then cheerfully
 * reported zero overlaps.
 *
 * So there are three assertions, and the first two exist because the third can
 * pass for the wrong reason:
 *
 * 1. **EVERY `tmpdir()` REFERENCE IS CLASSIFIED.** Not "no known bad pattern" —
 *    every reference the scanner finds, classified as a literal prefix, a
 *    template prefix, or a nested-under-BASE prefix. Anything else is
 *    UNCLASSIFIED and fails, naming file:line. This is what turns "a regex
 *    quietly missed a shape" from an invisible failure into a red line.
 * 2. **NO PREFIX IS A PREFIX OF ANOTHER.** Zero overlapping pairs.
 * 3. **THE SCAN FOUND SOMETHING.** Without this the first assertion is
 *    vacuous: a scanner that classifies nothing finds nothing unclassified.
 *    §3.B2's shape — a guard that can only be satisfied by not running.
 *
 * WHY A STRING PREFIX IS THE RIGHT COMPARISON, since the sweep is a glob: the
 * sweep enumerates `${prefix}*`, and `A*` matching a name that starts with B is
 * exactly "B starts with A". So the glob question and the string question are
 * the same question here — which is worth stating, because it is the only
 * reason a `startsWith` is a faithful model of the thing being policed.
 *
 * A NESTED prefix (`join(BASE, 'tree-')`) is included in the set. Its trees
 * live one level down, so a top-level `${prefix}*` sweep never matches it — but
 * it is still a string that reaches a temp-dir factory, and leaving it out is
 * how a future `tree-` at the top level would arrive without a red line.
 *
 * KNOWN LIMIT, and it is a limit of the scanner rather than of the property: a
 * `/` that begins a regex literal is recognised by the preceding-token
 * heuristic (a `/` after `( , = : [ ! & | ? { } ;` or at the start). A regex
 * that follows an identifier — `x /foo/` — is read as division and its body as
 * code. Nothing in `scripts/` writes that, and the failure would be a miscount
 * in assertion 1, which prints the file and line it could not read.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');

/**
 * The floor for assertion 3. It is the number of `tmpdir()` references one
 * below what the suite has today, because a floor that equals the current
 * count is a tripwire on the next commit rather than on the next typo.
 */
const MIN_TMPDIR_REFS = 30;

let failures = 0;
let total = 0;

function check(ok, description, detail = () => '') {
  total++;
  if (ok) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}`);
    const d = typeof detail === 'function' ? detail() : detail;
    if (d) console.log(`       ${d}`);
  }
}

/**
 * Blank out every character that is NOT executable code, preserving length and
 * offsets. String and template CONTENT is blanked too — the prefix literal is
 * read back out of the original source at the offset the mask points at, so
 * nothing is lost and no `//` inside a URL or a regex can open a comment.
 *
 * A naive `/^\/\/.*$/m` would eat `https://…` in check_cries_browser.mjs and
 * the `//` in `/^scripts\//` in check_all.mjs:1363, which is the shape
 * §3.S already had to fix in a checker written to catch a real defect.
 */
function codeMask(src) {
  const out = src.split('');
  let i = 0;
  // Characters after which a `/` begins a regex literal rather than a division.
  const REGEX_OK = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const blank = (from, to) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  let prevCode = '';

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === c) break;
        if (src[k] === '\n') break;
        k++;
      }
      blank(i + 1, k);
      i = k + 1;
      prevCode = c;
      continue;
    }
    if (c === '`') {
      // A template with ${} holes: blank the text spans, keep the holes as code.
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === '\\') { blank(k, k + 2); k += 2; continue; }
        if (src[k] === '`') break;
        if (src[k] === '$' && src[k + 1] === '{') {
          let depth = 1;
          let j = k + 2;
          while (j < src.length && depth > 0) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            if (depth === 0) break;
            j++;
          }
          prevCode = '(';
          k = j;
          continue;
        }
        blank(k, k + 1);
        k++;
      }
      i = k + 1;
      prevCode = '`';
      continue;
    }
    if (c === '/') {
      // Regex literal or division — decided by the last code character.
      if (prevCode === '' || REGEX_OK.has(prevCode)) {
        let k = i + 1;
        let inClass = false;
        while (k < src.length) {
          if (src[k] === '\\') { k += 2; continue; }
          if (src[k] === '[') inClass = true;
          else if (src[k] === ']') inClass = false;
          else if (src[k] === '/' && !inClass) break;
          else if (src[k] === '\n') break;
          k++;
        }
        blank(i, Math.min(k + 1, src.length));
        i = k + 1;
        prevCode = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prevCode = c;
    i++;
  }
  return out.join('');
}

/** Read the token at `at` out of the ORIGINAL source: a quoted string, a template, or an identifier. */
function tokenAt(src, at) {
  let i = at;
  while (i < src.length && /\s/.test(src[i])) i++;
  const c = src[i];
  if (c === "'" || c === '"') {
    let k = i + 1;
    while (k < src.length && !(src[k] === c && src[k - 1] !== '\\')) k++;
    return { kind: 'literal', value: src.slice(i + 1, k), end: k + 1 };
  }
  if (c === '`') {
    const close = src.indexOf('`', i + 1);
    const body = src.slice(i + 1, close === -1 ? src.length : close);
    /* Only the head is the prefix — `` `ccd-neg-${…}` `` builds `ccd-neg-` plus a
     * random suffix, and the suffix is what mkdtemp appends to as well. Reading the
     * whole template as the prefix would make every two template sites "overlap"
     * with each other, which is a true statement about nothing. A template whose
     * head is not a plain prefix — `${…}` first, or an interpolation in the middle
     * — cannot be reduced to a namespace string and is reported unclassified rather
     * than guessed at. */
    const head = /^([a-z0-9-]+)/.exec(body);
    if (!head || head[0].length !== /^([a-z0-9-]*)(\$\{[^}]*\})/.exec(body)?.[1].length) {
      return { kind: 'template-unknown', value: body.slice(0, 24), end: (close === -1 ? src.length : close) + 1 };
    }
    return { kind: 'template', value: head[1], end: (close === -1 ? src.length : close) + 1 };
  }
  const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
  if (m) return { kind: 'ident', value: m[0], end: i + m[0].length };
  return { kind: 'unknown', value: src.slice(i, i + 24), end: i + 24 };
}

const files = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).sort();

/** @type {{prefix: string, file: string, line: number, shape: string}[]} */
const sites = [];
/** @type {{file: string, line: number, text: string}[]} */
const unclassified = [];
let tmpdirRefs = 0;

for (const file of files) {
  const src = readFileSync(join(SCRIPTS, file), 'utf8');
  const mask = codeMask(src);
  const lineOf = (off) => src.slice(0, off).split('\n').length;

  // (a) every tmpdir() reference, classified by the argument to its join()
  for (const m of mask.matchAll(/tmpdir\(\)/g)) {
    tmpdirRefs++;
    const before = mask.slice(0, m.index);
    if (!/join\(\s*$/.test(before)) {
      unclassified.push({ file, line: lineOf(m.index), text: 'tmpdir() is not the first argument of a join()' });
      continue;
    }
    const after = m.index + m[0].length;
    const comma = /^\s*,/.exec(src.slice(after));
    if (!comma) {
      unclassified.push({ file, line: lineOf(m.index), text: 'join(tmpdir() …) has no second argument' });
      continue;
    }
    const tok = tokenAt(src, after + comma[0].length);
    if (tok.kind === 'literal' || tok.kind === 'template') {
      sites.push({ prefix: tok.value, file, line: lineOf(m.index), shape: tok.kind });
    } else {
      unclassified.push({
        file,
        line: lineOf(m.index),
        text: `join(tmpdir(), ${tok.kind === 'ident' ? `\`${tok.value}\` (identifier)` : tok.value})`,
      });
    }
  }
  // (b) nested: mkdtempSync(join(IDENT, 'x')) where IDENT is a BASE built on tmpdir()
  for (const m of mask.matchAll(/mkdtempSync\(\s*join\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,/g)) {
    const ident = m[1];
    const tok = tokenAt(src, m.index + m[0].length);
    const decl = new RegExp(`const\\s+${ident}\\s*=\\s*join\\(\\s*tmpdir\\(\\)\\s*,`, 'g');
    const isBase = (mask.match(decl) || []).length > 0;
    if (!isBase) {
      unclassified.push({ file, line: lineOf(m.index), text: `nested join(${ident}, …) but ${ident} is not a tmpdir() BASE` });
      continue;
    }
    sites.push({ prefix: tok.value, file, line: lineOf(m.index), shape: `nested:${ident}` });
  }
}

const prefixes = [...new Set(sites.map((s) => s.prefix))].sort();

console.log('Temp-dir prefixes — one namespace per tool, and every reference classified');
console.log(`  ${files.length} files scanned, ${tmpdirRefs} tmpdir() references, ${sites.length} prefix sites\n`);

check(
  unclassified.length === 0,
  'every tmpdir() reference is classified (literal / template / nested BASE)',
  () => `${unclassified.length} unclassified:\n` + unclassified.map((u) => `         ${u.file}:${u.line}  ${u.text}`).join('\n')
);

check(
  tmpdirRefs >= MIN_TMPDIR_REFS,
  `the scan found something (${tmpdirRefs} >= ${MIN_TMPDIR_REFS} tmpdir() references)`,
  () => 'the scanner may be broken, and "nothing is unclassified" would then pass vacuously — §3.B2\'s shape'
);

/* The property. Both directions, because a sweep for A* is one-directional and
 * "B starts with A" is exactly the case where B's trees get deleted by A's
 * sweep. Reported as the pair, not as two separate counts, so the message says
 * which two namespaces are the problem. */
const overlaps = [];
for (const a of prefixes) {
  for (const b of prefixes) {
    if (a === b) continue;
    if (b.startsWith(a)) overlaps.push({ shorter: a, longer: b });
  }
}

check(
  overlaps.length === 0,
  'no prefix is a prefix of another, so no `${prefix}*` sweep eats another tool\'s trees',
  () => `${overlaps.length} overlapping pairs:\n` + overlaps.map((o) => `         \`${o.shorter}\` is a prefix of \`${o.longer}\``).join('\n')
);

/* Duplicates are not an overlap — two tools may legitimately share a namespace
 * only if they are the same tool, which this cannot tell. So it is reported,
 * never failed: a duplicate means two files hand the same string to a factory,
 * and the sweep that deletes it is still one deletion. */
const dupes = [...new Set(sites.map((s) => s.prefix).filter((p, _i, arr) => arr.indexOf(p) !== arr.lastIndexOf(p)))];

check(
  dupes.length === 0,
  'no two files hand the same prefix',
  () => `${dupes.length} duplicates: ${dupes.map((d) => `\`${d}\``).join(', ')}`
);

console.log(`\n  ${prefixes.length} prefixes derived: ${prefixes.map((p) => `\`${p}\``).join(' ')}`);
console.log('  (AGENTS.md §3.J states this total; this line is where it is checked by eye —\n' +
            '   parsing prose for a number is a hardcoded copy that goes stale in the\n' +
            '   dangerous direction, and the assertion worth keeping is the zero above.)');

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);
