/**
 * A debug port a CDP checker can be sure is its own.
 *
 * ## WHY THIS EXISTS
 *
 * Seven browser checkers under `scripts/` launch headless Chrome with
 * `--remote-debugging-port` and then poll `http://127.0.0.1:<port>/json/list`
 * for the page target. That poll is a **global** lookup: it answers from WHATEVER
 * browser holds the port, including one this process did not start. So the whole
 * run — every navigation, every click, every measurement — can be taken against a
 * stranger's browser, and nothing in the output says so.
 *
 * This is not hypothetical. `check_gen1_page.mjs` spent a run reporting four
 * failures (`playhead moves during playback`, `play button reflects playing
 * state`, `clicking a species plays it`, and a prose column 474px wide against a
 * 571px measure) on a page that measures 590px and plays correctly at 1440x900.
 * The four failures were real measurements — of an orphan Chrome, left by an
 * unrelated run, whose window was 1246x87. Its tab had been navigated to
 * cries-gen1.html by the checker's own `Page.navigate`, so the checker was
 * driving a page it did not open, in a window it did not size.
 *
 * ## WHAT WENT WRONG TWICE, AND BOTH ARE FIXED HERE
 *
 * 1. **A fixed port is a collision waiting to happen.** Chrome holds its
 *    debugging port for the life of the process, and §3.J already made every
 *    checker kill its browser on the exit path for exactly that reason. But only
 *    `check_sorting_page.mjs` went further and derived the port from the PID;
 *    the other six spelled a literal, so any two of them — or any orphan — can
 *    take the port first.
 *
 * 2. **The spawn and the poll each had their own copy of the number.** Changing
 *    the spawn's literal alone leaves the poll asking the old port, which is
 *    precisely what happened while diagnosing the above: two experiments moved
 *    the browser to a free port and still "measured" the orphan, because the
 *    browser moved and the poll did not. One `cdpPort()` call feeds both.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * A free port before the spawn is a strong guard, not a proof: something can
 * bind between the check and the spawn. The PID-derived number makes that a
 * narrow race rather than a standing condition. What is guaranteed is that a
 * checker which finds the port occupied **stops and says so**, instead of
 * quietly measuring the other browser — which is the failure that actually
 * happened, and the one nothing in the suite could see.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Chrome's path, in one place: seven checkers had seven copies of it. */
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * One base per checker, so two of them cannot land on the same port by luck.
 *
 * The bases are spread far enough apart that a 120-wide PID window around one cannot
 * reach into another's.
 *
 * THE SECOND SENTENCE IS WRONG, and it was load-bearing until this was measured.
 * `cdpPort()` returns `base + (pid % 120)`, so each checker occupies a 120-wide window
 * rather than a point, and the bases only span 9330..9470 — 140. Checked pairwise, 20
 * of the 21 combinations overlap; `gen1` [9330,9449] against `spectrum` [9470,9589] is
 * the single pair that does not. `gen1` overlaps all six others, and `cries` [9370,9489]
 * overlaps five of the remaining six.
 *
 * This does NOT mean two concurrent CDP checkers are likely to collide. Concurrent runs
 * have different PIDs, so a given pair lands on the same number only about 1 time in
 * 120, and `assertPortFree()` below turns even that into a loud refusal rather than a
 * measurement of somebody else's window.
 *
 * It does mean the comment could not be used as an argument for running them in
 * parallel, which is precisely how it read. `check_all.mjs`'s two-tier runner leaves
 * the seven browser entries SERIAL, and the honest reason is this overlap plus §3.J:
 * six concurrent Chromes is the condition the 28 GB of tmpdir came from. Spread the
 * bases to 400 apart if you want the sentence to become true; do not rely on it until
 * you have.
 */
export const CDP_PORT_BASE = {
  gen1: 9330,
  cries: 9370,
  spectrum: 9470,
  outfit: 9371,
  life: 9381,
  graph: 9388,
  sorting: 9400
};

/** How wide a PID window each checker may sweep. Wider means more collisions. */
const PID_SPAN = 120;

/**
 * The port for `name`, derived from this process's PID.
 *
 * Derived rather than fixed so two concurrent runs of the SAME checker cannot
 * collide, and so an orphan from an earlier run is on a different number than the
 * next attempt.
 */
export function cdpPort(name) {
  const base = CDP_PORT_BASE[name];
  if (!base) throw new Error(`cdpPort: unknown checker "${name}" — add it to CDP_PORT_BASE`);
  return base + (process.pid % PID_SPAN);
}

/** The browser already listening on `port`, or null if the port is free. */
export async function browserOnPort(port, timeoutMs = 600) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const v = await r.json();
    return v.Browser || v['User-Agent'] || 'a browser';
  } catch {
    return null;
  }
}

/**
 * Fail loudly when `port` is already serving a browser.
 *
 * Called BEFORE the spawn. This is the assertion whose absence let the run
 * above report four confident failures about a page that was fine — and note
 * what makes it worth having: the failures were not invented. They were accurate
 * measurements of the wrong document, which is worse than a crash.
 */
export async function assertPortFree(name, port) {
  const holder = await browserOnPort(port);
  if (!holder) return port;
  throw new Error(
    `${name}: debug port ${port} is already serving ${holder}, and this process did not start it.\n` +
    `  Refusing to drive it. Every measurement below would be taken against that\n` +
    `  browser's window and tabs, and nothing in the report would say so.\n` +
    `  It is usually an orphan from an interrupted run — look for it with:\n` +
    `    ps -Ao pid,args | grep '[C]hrome --headless' | grep ${port}\n` +
    `  and kill only what you recognise.`
  );
}

/**
 * The debug port Chrome chose, for a browser launched with `--remote-debugging-port=0`.
 *
 * ## WHY THIS REPLACES cdpPort() FOR EVERY CHECKER
 *
 * `cdpPort()` hands out `base + (pid % 120)`. That works while browsers run one at a
 * time, and it is why they used to: two checkers in flight can land on the same number
 * about once in 120, and `assertPortFree()` turns that into a loud abort rather than a
 * wrong measurement — which is correct, and is also a 5% flake across six concurrent
 * browsers. So the browser tier stayed serial, and that was 80 of a 99-second run.
 *
 * `--remote-debugging-port=0` hands the choice to the OS, which writes the number it
 * chose to `<profile>/DevToolsActivePort`. The port cannot collide, because the next
 * browser is not offered it.
 *
 * `assertPortFree()` is therefore not called by any checker any more, and nothing is
 * lost by that: its job was to stop a checker driving a browser it did not start, and a
 * port the OS assigned for this browser cannot already be serving somebody else's. The
 * two earlier alternatives were worse in ways worth recording — an explicit
 * `9600 + index` is deterministic, so one interrupted run poisons that index for every
 * later run, which is exactly what happened twice in a row while this was being written.
 *
 * `CDP_PORT_BASE` and `cdpPort()` stay exported for a browser launched outside a
 * `--user-data-dir` of its own; nothing in scripts/ uses them now.
 *
 * @param {string} profile  the same path passed as `--user-data-dir`
 * @param {number} timeoutMs  how long to wait for Chrome to publish the port
 * @returns {Promise<number>}
 */
export async function waitForDebugPort(profile, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const first = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      const n = Number(first);
      if (n > 0) return n;
      last = `read ${JSON.stringify(first)}`;
    } catch (err) {
      last = err.code ?? err.message;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Chrome published no debug port to ${join(profile, 'DevToolsActivePort')} within ${timeoutMs}ms (${last}).\n` +
    `  It either did not start, or it was started without --remote-debugging-port=0.`
  );
}