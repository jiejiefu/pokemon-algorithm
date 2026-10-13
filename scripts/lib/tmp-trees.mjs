/**
 * The one registry of temp trees, so that an INTERRUPTED run cannot leave one behind.
 *
 * WHY THIS EXISTS, measured rather than assumed. On 2026-10-13 a `du` of this user's
 * tmpdir found 5,841 entries, of which **27 were this project's** — and four of them
 * were `gamesim-neg-*`, born at the *same second*, all six megabytes each. `POOL` is
 * 4 on a 10-core machine (`Math.min(4, (cpus().length - 1) >> 1)`), so four trees
 * born together is exactly one per worker, which is the signature of a run that was
 * killed before its `finally` blocks ran. Eleven of the eighteen negative harnesses
 * cleaned up in a `finally` and nothing else, and a `finally` does not execute when
 * the process is terminated from outside.
 *
 * The Chrome-based checkers already solved this shape individually — `exit` plus
 * SIGINT plus a `rmSync`, which is why their leftovers are only the SIGKILLed ones
 * (§3.J). Eleven copies of those six lines is the alternative, and §3.G7 is the
 * precedent for not making it: nine harnesses doing one thing at a time became
 * `pool.mjs`, one module.
 *
 * WHAT THIS DOES NOT DO. **SIGKILL cannot be caught at all**, so a `kill -9` still
 * leaves a tree. That is the honest limit rather than a bug to engineer around, and
 * it is the same limit §3.J already records for the browser checkers.
 *
 * HOW TO USE IT. Wrap the directory you create, and call `releaseTree` in place of the
 * `rmSync` that removes it on the happy path:
 *
 *     const dir = trackTree(mkdtempSync(join(tmpdir(), 'x-neg-')));
 *     ...
 *     releaseTree(dir);                       // not rmSync
 *
 * The per-case removal stays: it frees the megabytes during a long run, and the
 * registry is only the net for the paths that never reach it. `releaseTree` drops the
 * path from the set as well as deleting it, so an exit sweep is not chasing trees that
 * are already gone — the Set is a live list, not a log.
 */

import { rmSync } from 'node:fs';

const live = new Set();
let hooked = false;

function sweep() {
  for (const dir of live) {
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  live.clear();
}

function install() {
  /* `exit` is what covers an uncaught exception AND a normal return, which is why it
   * is the first hook and not the only one: the throw path is exactly when the run is
   * already going wrong. SIGINT is Ctrl-C and SIGTERM is what a runner or a plain
   * `kill` sends; both sweep before exiting so the exit code stays the conventional
   * one rather than becoming a silent success. */
  process.on('exit', sweep);
  process.on('SIGINT', () => { sweep(); process.exit(130); });
  process.on('SIGTERM', () => { sweep(); process.exit(143); });
}

/**
 * Register `dir` as a temp tree this process owns. Returns it, so it wraps the
 * creating call rather than sitting on its own line.
 *
 * @param {string} dir an absolute path the caller just created
 * @returns {string} the same path
 */
export function trackTree(dir) {
  live.add(dir);
  if (!hooked) { hooked = true; install(); }
  return dir;
}

/**
 * Remove `dir` and stop tracking it. This is the drop-in replacement for the
 * `rmSync(dir, { recursive: true, force: true })` a case already had.
 *
 * @param {string} dir
 */
export function releaseTree(dir) {
  live.delete(dir);
  rmSync(dir, { recursive: true, force: true });
}

/** How many trees this process still owns. For a harness to assert on at the end. */
export function liveTreeCount() { return live.size; }
