/**
 * A fixed-width pool for independent negative-test cases, in DECLARATION order out.
 *
 * WHY THIS IS A MODULE AND NOT FIVE COPIES. Nine of the fourteen harnesses under
 * `scripts/` are the same construct: a list of independent cases, each its own `node`
 * process against its own temp tree, run one at a time by a `for` loop around an
 * `execFileSync`. That is ~49 s of a 96 s suite spent with four cores idle, and the
 * shape is identical enough that fixing it five times means the fifth copy gets the
 * fix with a typo in it. §3.G records the same reasoning for the mute tap: two copies
 * of a thing drift invisibly, and the drift is noise.
 *
 * WHY `POOL` IS CAPPED AT 4 AND NOT AT THE CORE COUNT. Each worker is a full
 * JIT-compiling interpreter rather than a thread, and other work shares this machine —
 * a run that saturates every core makes the editor and the server sluggish for the
 * duration, which is a worse trade than the seconds it saves. Four is also the number
 * `test_check_gen1_apu.mjs` and `test_check_color_match.mjs` arrived at by
 * measurement, so raising it is a deliberate act in one place rather than a constant
 * that drifted.
 *
 * WHAT IT DOES NOT CHANGE, and the list is short on purpose:
 *
 *   - Every task runs. A pool changes when a case starts, never whether.
 *   - Results come back in the order the tasks were given, so a report is still read
 *     top to bottom against the case list and two green runs diff the same way. A
 *     pool that logged from inside its workers would make the output order a property
 *     of the scheduler, and a red case could not be located by reading.
 *   - The tasks are independent. Nothing here serialises anything, so a harness whose
 *     cases share a directory must not use it — that is a property of the caller, not
 *     something this can check.
 *
 * `limit` defaults to the same `POOL` the harnesses use, computed the same way.
 */

import { cpus } from 'node:os';

/**
 * @param {Array<() => Promise<any>>} tasks  one thunk per case, in report order
 * @param {{limit?: number, onError?: (e: Error, i: number) => any}} [opts]
 * @returns {Promise<any[]>} one result per task, in the order they were given
 */
export async function pool(tasks, opts = {}) {
  if (!Array.isArray(tasks)) throw new TypeError('pool() takes an array of thunks');
  const limit = Math.max(1, opts.limit ?? defaultPool());
  if (tasks.length <= 1) return Promise.all(tasks.map((t) => t()));

  let next = 0;
  const out = new Array(tasks.length);
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        out[i] = await tasks[i]();
      } catch (e) {
        /* A worker that throws must not take the pool down with it and lose the other
         * results, because the one case that broke is exactly the case a reader needs
         * to see. The task's own verdict belongs in its result; reaching here at all
         * is the harness being wrong, so it is reported as a failing slot. */
        if (opts.onError) { out[i] = opts.onError(e, i); continue; }
        throw e;
      }
    }
  }));
  return out;
}

/** The number every harness in this repo agrees on, derived rather than written twice. */
export const defaultPool = () =>
  Math.max(1, Math.min(4, (cpus().length - 1) >> 1));
