/**
 * Poll a page predicate over CDP until it holds, or until a named ceiling expires.
 *
 * WHY THIS IS A MODULE. It existed twice — once inside `check_spectrum_browser.mjs`,
 * once as a hand-rolled loop in `check_outfit_browser.mjs` — and §3.G7 is the precedent
 * for not letting that stand: nine harnesses doing one thing at a time became
 * `pool.mjs`, one module. The two copies were also not identical, which is the worse
 * half of it: the loop counted iterations where the function counted milliseconds, so
 * they disagreed about what a ceiling meant.
 *
 * WHY `ev` IS A PARAMETER rather than something this module opens itself. Every
 * checker owns its own CDP session and its own `send`, and `waitForDebugPort` exists
 * because that connection is per-checker by design (§4). A module that opened its own
 * would be a second answer to "how does a checker talk to Chrome" — and the one that
 * mattered was a second answer that was wrong by default, not by accident.
 *
 * THE CONTRACT, in three parts, each of which has bitten something:
 *
 * 1. **A POLL IS FOR A PRECONDITION, NEVER FOR THE ASSERTION.** The caller polls for a
 *    fact the page has to reach — a play button's `aria-pressed`, a viewport restored
 *    to its default width — and then asserts on something else. Polling for the thing
 *    being asserted makes the assertion vacuous: §3.B2's shape, where raising the
 *    threshold to an impossible value satisfies every assertion because there is
 *    nothing left to fail.
 * 2. **A THROWN EVALUATION IS `false`, NOT AN ERROR.** During a navigation the
 *    execution context is destroyed and `ev` throws; a poll that propagated that would
 *    abort the checker on the one path where retrying is exactly right. The cost of
 *    this leniency is that a permanently broken page reads as "not yet" until the
 *    ceiling — which is why the ceiling is a parameter and the caller quotes it.
 * 3. **THE CEILING IS WALL-CLOCK, NOT AN ITERATION COUNT**, and the predicate is
 *    evaluated at least once before it is judged. A count-based ceiling silently
 *    becomes a time ceiling that nobody chose, at whatever the machine is doing that
 *    day.
 *
 * `expression` is JavaScript evaluated IN THE PAGE, and `ev` is expected to pass
 * `awaitPromise: true` — one of the existing call sites polls a
 * `requestAnimationFrame` promise, which cannot be observed otherwise.
 *
 * @param {(expression: string) => Promise<any>} ev this checker's `Runtime.evaluate`
 * @param {string} expression page-side predicate; truthy when the wait is over
 * @param {number} ceilingMs wall-clock budget, in milliseconds
 * @param {number} [step] delay between attempts, in milliseconds
 * @returns {Promise<boolean>} whether the predicate held before the ceiling
 */
export async function until(ev, expression, ceilingMs, step = 60) {
  const deadline = Date.now() + ceilingMs;
  for (;;) {
    let v;
    try { v = await ev(expression); } catch { v = false; }
    if (v) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}