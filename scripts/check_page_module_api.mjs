/**
 * Every member a page reaches through a named import must exist in the module it
 * named — the one direction a page-vs-module checker cannot see.
 *
 *   node scripts/check_page_module_api.mjs
 *
 * WHY THIS FILE EXISTS, AND IT IS A COMMITTED DEFECT RATHER THAN A HYPOTHESIS
 *
 * `sorting.html` called `cryPlayer.muteForView(true)` from commit e1eb879. The
 * method did not exist: `assets/js/cry-player.js` did not define it until 8957cc0.
 * For the commits in between, every load of sorting.html threw
 * `TypeError: cryPlayer.muteForView is not a function`, and because that call sits
 * about six lines ABOVE the listeners for the mute checkbox, the volume slider, the
 * legacy checkbox and every keyboard shortcut, the throw took all of them with it.
 * The page rendered. The header rendered. The race ran. The controls were dead.
 *
 * Two things made that ship, and both are about what the suite cannot see:
 *
 *   1. NOTHING CHECKS THAT A PAGE'S CALLS EXIST. ESM statically verifies the
 *      IMPORTED BINDING — `cryPlayer` is a real export, so the import is legal and
 *      the module loads — and says nothing about the member. A missing method is a
 *      runtime TypeError, in a page, on a line no checker reads.
 *   2. THE COMMIT DID NOT LOOK LIKE IT DID THIS. e1eb879 is titled "sorting.html:
 *      the race lanes were painting into a hidden canvas". A reader auditing that
 *      diff for race lanes has no reason to read an audio line, and the audio line
 *      is the one that shipped broken.
 *
 * Measured, not assumed: renaming `muteForView` in a scratch copy of the tree makes
 * this checker report sorting.html for it, and makes it the ONLY checker in the
 * suite that does. `check_sorting_page.mjs` — 66 checks over that page — does not
 * see it, because all of them are about the DOM and the stylesheet.
 *
 * WHY THE PAGE SET IS SELF-SELECTING RATHER THAN AN EXCLUSION LIST
 *
 * The subject is "pages that import from assets/js". A page with no such import has
 * nothing to assert, so deriving the set from that predicate means there is no list
 * to keep right — no new page to add, no 404.html-style exception to document, and
 * no exclusions that can rot into a place to hide a regression. `check_nav_pages.mjs`
 * has to carry an exclusion list and then asserts each exclusion still works; this
 * does not need one, and `pageCount > 0` is asserted so an empty derivation cannot
 * pass silently.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED
 *
 * - That the member is CALLED correctly. `cryPlayer.mute(1,2,3)` exists and is still
 *   wrong; arity is the page's business and no static reading here could settle it.
 * - Bracket access (`cryPlayer[name]`). Dynamic, and unknowable without running it.
 * - Members of non-class exports. A `const` object literal's shape would need a real
 *   parser, and the defect this guards against is a missing CLASS method. Under-
 *   approximating a class is the dangerous direction, so that is the only place the
 *   member set is derived, and it is derived generously (see below).
 * - Namespace imports (`import * as ns`). Everything is reachable by definition.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const check = (cond, ok, bad) => {
  if (cond) return pass(ok);
  const why = typeof bad === 'function' ? bad() : bad;
  fail(`${ok} — ${why || 'the check failed but the detail was empty (predicate disagrees with its own message)'}`);
};

/* ---------------------------------------------------------------- masking
 *
 * A page's own prose talks about the very expressions this checker looks for.
 * sorting.html:964 is a comment reading "`cryPlayer.muted` reads and WRITES the
 * site-wide `cry-volume` key" — so scanning raw source would read the member out of
 * a sentence about it. Comments go entirely; string and template literals go too,
 * EXCEPT the `${...}` holes of a template, which are real code and can hold a call.
 */
const maskLiteralsAndComments = (src) => {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? n : nl;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        if (src[j] === '\n') break;   // unterminated: do not swallow the rest of the file
        j++;
      }
      i = j + 1;
      out += " '' ";
    } else if (c === '`') {
      // Keep the interpolations, drop the literal text: a template can hold both.
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
            if (depth === 0) break;
            k++;
          }
          out += ' ' + src.slice(j + 2, k) + ' ';
          j = k + 1;
          continue;
        }
        j++;
      }
      i = j + 1;
      out += " '' ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

/* The body of a brace-delimited block, so a class's members are read from ITS text
 * and not from whatever follows it in the file. Depth counting, not a regex: the
 * naive `/\{([^}]*)\}/` stops at the first `}` inside any nested block, which for a
 * class this size is inside the first method. */
const braceBody = (src, openIndex) => {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  return src.slice(openIndex + 1);
};

/* Not a member, though it is followed by `(` and would match any method pattern. */
const NOT_A_MEMBER = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'class',
  'typeof', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try',
  'await', 'yield', 'case', 'super', 'this', 'constructor',
]);

/** Everything reachable as `x.` on an instance of `className`.
 *
 *  Derived GENEROUSLY, because over-approximating is the safe direction: a member
 *  wrongly believed to exist turns a red line into a green one, while a member
 *  wrongly believed missing produces a false positive that a reader learns to
 *  ignore. So this takes every `name(` in the class body and every `this.name =`.
 *
 *  `this.name =` is not optional here. `GbApu` assigns nineteen public instance
 *  properties in its constructor and none of them are methods, so a member set
 *  built from method syntax alone would report every one of them as missing the
 *  first time a page read `apu.notes` — and then the checker would be right about
 *  nothing. */
const classSurface = (src, className) => {
  const head = new RegExp(`\\bclass\\s+${className}\\b[^\\{]*\\{`).exec(src);
  if (!head) return null;
  const body = braceBody(src, head.index + head[0].length - 1);
  const members = new Set();
  // Method, getter, setter, static and async all end in `name(`; the keyword list
  // is what keeps `if (` and friends out of a set of members.
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!NOT_A_MEMBER.has(m[1])) members.add(m[1]);
  }
  for (const m of body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=/g)) members.add(m[1]);
  return members;
};

const moduleCache = new Map();

/** `{ names, classMembers }` for one module under assets/js. */
const surfaceOf = (relPath) => {
  if (moduleCache.has(relPath)) return moduleCache.get(relPath);
  const src = maskLiteralsAndComments(read(relPath));
  const names = new Set();
  const classMembers = new Map();
  /* An exported INSTANCE of a class, and it is not a detail. `cry-player.js` ends
   * with `export const cryPlayer = new CriesPlayer();` and every page imports THAT,
   * not the class — so resolving members from class exports alone skips the one
   * binding this checker was written for, and it did: renaming `muteForView` made
   * only the self-check go red while the real assertion stayed green. Resolving
   * `new Cls(...)` back to `Cls`'s members is what closes it. */
  const instanceMembers = new Map();

  /* `function*` is in here because the first version of this line did not have it,
   * and running the checker against the live tree reported three missing exports in
   * maze.html — `bfsSolve`, `dfsSolve`, `dijkstraSolve` — which the module exports as
   * GENERATORS. The pages were fine and the parser was wrong, which is the cheaper of
   * the two mistakes to have made and only because this file was run against real
   * source instead of a fixture. A derivation that is never run finds nothing. */
  for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s*\*?\s*([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/\bexport\s+default\b/.test(src)) names.add('default');

  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\b/g)) {
    const members = classSurface(src, m[1]);
    if (members) classMembers.set(m[1], members);
  }

  /* Classes first: an instance can only be resolved once its class is known. */
  for (const m of src.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)/g)) {
    const members = classMembers.get(m[2]);
    if (members) instanceMembers.set(m[1], members);
  }

  const result = { names, classMembers, instanceMembers, path: relPath };
  moduleCache.set(relPath, result);
  return result;
};

/* --------------------------------------------------------------- the check */

/* `import { a, b as c } from './assets/js/x.js'` — the named form only. A default
 * import and a namespace import are skipped rather than guessed at: the first is one
 * name with no module to check it against, the second can reach anything by
 * definition. Both are visible in the count printed below. */
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/(assets\/js\/[^'"]+)['"]/g;

const pages = [];
for (const file of readdirSync(ROOT).sort()) {
  if (!file.endsWith('.html')) continue;
  const raw = read(file);
  const imports = [...raw.matchAll(NAMED_IMPORT)].map((m) => ({
    module: m[2],
    names: m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => {
        const as = s.split(/\s+as\s+/);
        return { local: (as[1] || as[0]).trim(), exported: as[0].trim() };
      }),
  })).filter((i) => i.names.length);
  if (imports.length) pages.push({ file, raw, code: maskLiteralsAndComments(raw), imports });
}

console.log('the pages that import from assets/js');

check(pages.length > 0,
  `the page set derives to a non-empty list (${pages.length} page(s) import from assets/js)`,
  () => 'no page matched `import { … } from "./assets/js/…"`. That is either every page stopped using a module — in which case this checker has nothing left to say and should be deleted — or the import syntax moved and the derivation below is now reading nothing. Either way it must not pass as "0 violations".');

/* One assertion per (page, imported name). The description names the page and the
 * binding, because a failure has to be identifiable without reading the source —
 * the same rule §4 states for check_nav_pages.mjs. */
const missing = [];

for (const page of pages) {
  const surfaceCache = new Map();
  for (const imp of page.imports) {
    if (!surfaceCache.has(imp.module)) {
      if (!existsSyncSafe(imp.module)) { missing.push(`${page.file}: imports "${imp.module}", which is not in the tree`); continue; }
      surfaceCache.set(imp.module, surfaceOf(imp.module));
    }
    const surface = surfaceCache.get(imp.module);

    for (const { local, exported } of imp.names) {
      if (!surface.names.has(exported)) {
        missing.push(`${page.file}: \`import { ${exported} }\` from '${imp.module}' — that module exports no "${exported}"`
          + ` (exports: ${[...surface.names].sort().join(', ') || 'none'})`);
        continue;
      }
      // A CLASS — or an INSTANCE of one, which is what pages actually import — is
      // where members live. Anything else (a function, a plain const) is left alone
      // rather than guessed at.
      const members = surface.classMembers.get(exported) || surface.instanceMembers.get(exported);
      if (!members) continue;

      // `local.member` and `local?.member`. Not `local[expr]`: that is dynamic.
      const used = new Set();
      /* `\??\.` and NOT `\?\.`, and the difference is this whole checker.
       *
       * `\?` is an ESCAPED LITERAL QUESTION MARK, not a quantifier — the quantifier
       * is the `?` that would follow it. Written `\?\.` this group demands the
       * two-character sequence `?.`, which no ordinary member access contains, so it
       * matched nothing: `used` came back empty for all 295 bindings, the loop below
       * had nothing to compare, and the assertion printed PASS having measured
       * NOTHING. A checker that cannot fail is worse than no checker.
       *
       * It was found by renaming a method and watching the checker stay green —
       * not by reading it, and not by the two self-checks, which were both happy
       * because they test the member SET and never touch this pattern. So the
       * proof that matters for this file is the mutation one above: a member the
       * module lacks must appear in the failure. Run it before trusting a change
       * here. */
      const re = new RegExp(`\\b${local}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
      for (const m of page.code.matchAll(re)) used.add(m[1]);

      for (const member of [...used].sort()) {
        if (!members.has(member)) {
          missing.push(`${page.file}: ${local}.${member} — ${exported} (${surface.path}) has no "${member}"`
            + (member === 'then' || member === 'prototype' ? '' : ''));
        }
      }
    }
  }
}

check(missing.length === 0,
  `every member a page reaches through a named import exists in that module`
    + ` (${pages.reduce((n, p) => n + p.imports.reduce((m, i) => m + i.names.length, 0), 0)} binding(s) across ${pages.length} page(s))`,
  () => `${missing.length} unresolved member(s):\n      ${missing.map((m) => `        ${m}`).join('\n      ')}\n      This is the e1eb879 defect shape: the import is legal, the module loads, and the member is a runtime TypeError on a line no other checker reads.`);

/* A guard on the guard. Every class the derivation FOUND must have produced a member
 * set, and the two biggest classes in the project are named here so that a parsing
 * regression — `classSurface` returning null, or a regex quietly matching nothing —
 * shows up as "0 bindings checked" rather than as a clean run. This is the same
 * shape as check_nav_pages.mjs asserting its row-modifier list is non-empty. */
const spotClasses = [['assets/js/cry-player.js', 'CriesPlayer'], ['assets/js/gb-apu.js', 'GbApu']];
const spotBad = [];
for (const [path, cls] of spotClasses) {
  const s = surfaceOf(path);
  const members = s.classMembers.get(cls);
  if (!members) { spotBad.push(`${path}: no member set derived for class ${cls}`); continue; }
  if (members.size < 3) spotBad.push(`${path}: ${cls} produced only ${members.size} member(s) — ${[...members].join(', ') || 'none'}, which is too few to be a real parse`);
}
check(spotBad.length === 0,
  'the class parser reads the two biggest classes in the project (CriesPlayer, GbApu)',
  () => spotBad.join('; '));

/* And the negative direction: the member set must actually REJECT a name. A parser
 * that accepted everything would make the assertion above pass for the wrong reason
 * — which is the failure §3.F calls out for `gb-apu.js`'s own mutation suite. */
{
  const s = surfaceOf('assets/js/cry-player.js');
  const members = s.classMembers.get('CriesPlayer');
  check(members && members.has('muteForView') && members.has('muted') && !members.has('methodThatDoesNotExist'),
    'the derived member set accepts a real method and rejects an invented one',
    () => members
      ? `CriesPlayer members include muteForView: ${members.has('muteForView')}, muted: ${members.has('muted')}, methodThatDoesNotExist: ${members.has('methodThatDoesNotExist')}`
      : 'no member set was derived for CriesPlayer at all');
}

/* The INSTANCE binding, separately, and this assertion is here because of the bug it
 * would have caught in THIS file. `cryPlayer` is `new CriesPlayer()`, so a member
 * lookup keyed on class exports alone returns nothing for it, skips the check, and
 * reports a clean run — the whole assertion silently measuring nothing while the
 * self-check above stayed green. Asserting that an instance export resolves to a
 * member set is what makes that failure mode impossible to ship again. */
{
  const s = surfaceOf('assets/js/cry-player.js');
  const viaInstance = s.instanceMembers.get('cryPlayer');
  check(!!viaInstance && viaInstance.has('muteForView') && viaInstance.has('muted'),
    'an exported INSTANCE resolves to its class members (cryPlayer -> CriesPlayer)',
    () => viaInstance
      ? `cryPlayer resolved to a member set of ${viaInstance.size} but it lacks ${!viaInstance.has('muteForView') ? 'muteForView ' : ''}${!viaInstance.has('muted') ? 'muted' : ''}`
      : 'cryPlayer resolved to NO member set, so every `cryPlayer.x` in every page is currently unchecked — the e1eb879 defect shape, blind');
}

console.log('');
console.log(failures ? `FAIL  ${failures} check(s) failed` : `PASS  the page/module API is consistent`);
process.exit(failures ? 1 : 0);

function existsSyncSafe(p) {
  try { readFileSync(join(ROOT, p)); return true; } catch { return false; }
}