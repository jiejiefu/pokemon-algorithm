/**
 * Record every repo file a checker actually opens, for `check_all.mjs --prove-inputs`.
 *
 * WHY THIS IS A RUNTIME INSTRUMENT AND NOT A GREP
 *
 * A skip cache is only as good as the list of files it keys on. If that list is
 * missing a file, the checker is skipped after that file changed, and the run comes
 * back green having verified nothing — which is worse than having no cache at all,
 * because it looks like coverage. So the list has to be PROVEN rather than reviewed,
 * and the only honest way to prove it is to watch the checker open its own files. A
 * grep cannot answer this question, for the reason `check_nav_pages.mjs` documents
 * about `rg -l initHeaderNav *.html`: an import still names the symbol, so
 * sorting.html's call keeps it listed, and two other pages contain the bare token
 * inside a COMMENT.
 *
 * WHY IT IS CommonJS AND LOADED WITH `-r`
 *
 * Because `--import` does not work, and the failure is silent. Node builds the ESM
 * facade for a builtin when it is first linked, and it snapshots the named exports at
 * that moment — so `import { readFileSync } from 'node:fs'` binds the ORIGINAL
 * function, and a patch applied by an `--import` module afterwards is never seen by
 * the checker. Measured: with `--import`, `check_color_palettes.mjs` recorded five
 * files and missed both JSON tables it plainly reads on lines 57 and 59. A CommonJS
 * preload runs before the main module is linked, so the same patch is picked up by
 * every named import. Nothing about the checkers had to change; only the loader did.
 *
 * TWO LISTS, because "reads the bytes" and "checks the file is there" are different
 * claims with different costs
 *
 *   read    readFileSync / readdirSync — the bytes reach the checker, so the cache
 *           key needs a content hash of them.
 *   exists  existsSync / statSync — the checker only asked whether the path is
 *           present. `check_color_palettes.mjs` does this for all 1,025 sprites and
 *           their 3,274 shiny pairs, which is 4,299 probes and would make the
 *           manifest unreadable if each were a line.
 *
 * So both lists come back here, and `check_all.mjs` folds them into ONE space by
 * letting a manifest entry be a glob: `assets/images/sprite/*.png` stands for every
 * sprite. Both sides of the comparison are expanded before they are compared and
 * before anything is hashed, which is what makes deletion work — remove one sprite
 * and the glob expands to one path fewer, so the key changes and the checker runs.
 *
 * WHAT IT CANNOT SEE, all three named because all three would be silent
 *
 *   1. A CHILD PROCESS. `test_check_*.mjs` build fixtures with `cpSync` and then exec
 *      a fresh `node` against a temp tree, so nothing in the parent's read set
 *      describes what the child looked at. Those harnesses are declared
 *      `proof: 'by-construction'` with the reason printed on every run.
 *
 *   2. A FILE READ ONLY ON A BRANCH NOT TAKEN. Inherent to recording one execution.
 *      This is why the cache key also carries the checker script's own hash: editing
 *      the checker invalidates its entry, so a newly added branch is observed the
 *      next time it runs.
 *
 *   3. A SERVER-SIDE READ. The two CDP checkers fetch their pages over HTTP from
 *      Live Server, so the page and its data never pass through this process at all.
 *      Also declared by construction, for the same reason.
 */

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const OUT = process.env.RECORD_INPUTS_OUT;
const ROOT = process.env.RECORD_INPUTS_ROOT;
if (!OUT || !ROOT) {
  throw new Error('record-inputs: RECORD_INPUTS_OUT and RECORD_INPUTS_ROOT must both be set. '
    + 'This module is a preload for check_all.mjs and is not meant to be run directly.');
}

const read = new Set();
const exists = new Set();

/* Captured BEFORE anything is patched, and used by the helpers below. The first
 * version of the directory filter called a bare `statSync`, which in a CommonJS
 * module is not a global at all — every call threw, the `catch` returned false, and
 * every directory was recorded as if it were a file. That is why `assets/cries` and
 * `assets/css` turned up in the manifest, and it is silent: the file exists, it is
 * just the wrong shape. */
const realStatSync = fs.statSync.bind(fs);

/* Directories are NOT recorded. A bare directory cannot be content-hashed, and its
 * presence is already implied by whatever glob reaches into it — so recording it
 * would only force the manifest to name `assets/cries` next to
 * `assets/cries/latest/*`, saying the same thing twice. Checkers that probe a
 * directory still invalidate correctly, because deleting it makes the inner glob
 * expand to nothing and the key changes.
 *
 * A PATH THAT DOES NOT EXIST is recorded, because that is a real and meaningful
 * probe: `check_evolution_chains.mjs` asks for four pokemon sprites that are not in
 * the tree, and whether they turn up is part of what it checks. */
const isDir = (abs) => { try { return realStatSync(abs).isDirectory(); } catch { return false; } };

function rel(p) {
  let s;
  try {
    s = (p && typeof p === 'object' && p.href)
      ? fileURLToPath(p)
      : (typeof p === 'string' && p.startsWith('file:') ? fileURLToPath(p) : String(p));
  } catch { return null; }
  const abs = path.resolve(s);
  const r = path.relative(ROOT, abs);
  /* Only the repo counts. The negative harnesses read whole fixture trees out of
   * tmpdir(), and a checker's own source sits outside ROOT when it runs from a
   * scratch copy — neither is an input the manifest can name. */
  if (!r || r.startsWith('..') || path.isAbsolute(r) || isDir(abs)) return null;
  return r.split(path.sep).join('/');
}

const wrap = (key, bucket) => {
  const real = fs[key];
  fs[key] = function (p, ...rest) {
    const r = rel(p);
    if (r) bucket.add(r);
    return real.call(this, p, ...rest);
  };
};

wrap('readFileSync', read);
wrap('existsSync', exists);
wrap('statSync', exists);
wrap('lstatSync', exists);

/* A DIRECTORY LISTING IS A READ OF ITS ENTRIES, so it is recorded as them rather
 * than as the directory. `test_check_color_palettes.mjs` walks `assets/js`, and
 * recording the bare directory name would make the manifest say `assets/js` — which
 * is not a file, cannot be hashed, and would silently cover every future addition
 * to that directory whether or not the harness looked at it. Expanding it is also
 * what makes a new module invalidate the harness that walks its directory, which is
 * the correct behaviour: it is reading the roster. */
const realReaddirSync = fs.readdirSync;
fs.readdirSync = function (p, options) {
  const r = rel(p);
  if (!r) return realReaddirSync.call(this, p, options);
  const out = realReaddirSync.call(this, p, options);
  /* NOT `Array.isArray(out) ? out : out.map(...)`: with `{ withFileTypes: true }` the
   * result is STILL an array, of Dirent objects, so that test hands back Dirents and
   * every recorded "name" becomes the string "[object Object]". Which is exactly what
   * it did — check_cry_index.mjs walks assets/js that way. */
  for (const e of out) {
    const n = typeof e === 'string' ? e : e && e.name;
    if (typeof n !== 'string') continue;
    const child = `${r}/${n}`;
    if (!isDir(join(ROOT, child))) read.add(child);
  }
  return out;
};

process.on('exit', () => {
  /* The original writer: the patch above is not what a checker reads from here, and
   * recording our own output would be a loop. */
  fs.writeFileSync(OUT, JSON.stringify({ read: [...read].sort(), exists: [...exists].sort() }));
});
