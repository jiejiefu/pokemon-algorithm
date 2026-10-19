/**
 * The shared assertion primitives for the verification suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * Twenty of the checkers define their own `ok`, and thirty-odd define their own
 * `eq`. They are not the same function five different ways — they are five
 * different functions wearing the same name, and the differences are load-bearing:
 *
 *   - some collect failures and print nothing on success (`check_categories.mjs`),
 *     because a green run of 1,019 checks should not print 1,019 lines;
 *   - some stream an `ok`/`FAIL` line per assertion (`check_cries_page.mjs`),
 *     because the reader is watching a browser drive a page and wants to see it
 *     getting somewhere;
 *   - some take a third `detail` argument and some silently drop it. The dropped
 *     ones are the defect §3.G9 names: a two-argument `ok` accepts a third
 *     argument and prints a FAIL line that cannot say what it measured.
 *
 * A rule retyped in twenty places is a rule that will be retyped wrong in one of
 * them, which is the argument `negative.mjs` already makes for `caughtBy`. This
 * module is the same argument for `ok` and `eq`.
 *
 * WHAT IT PRESERVES
 * -----------------
 * `lib/negative.mjs` derives every harness verdict from lines that match
 * `/^\s*(?:ok\b|FAIL\b|PASS\b)/`, so the two output shapes below are the contract,
 * not a style:
 *
 *   - `stream: true`  prints `  ok   <line>` and `  FAIL <line>` for every check;
 *   - `stream: false` prints only `  FAIL <line>`, so a green run stays quiet.
 *
 * A failure line's `detail` is appended after ` — `, which is where `caughtBy`
 * looks for the measurement a case names. The summary is `PASS  <n> checks` or
 * `FAIL  <n> of <m> checks failed`, and `check_all.mjs` prints its last line, so
 * the two spaces after `PASS`/`FAIL` are part of what a reader sees.
 */

/**
 * Deep structural equality, for arrays and plain objects, over `Object.is` for
 * everything else. `NaN` equals `NaN`; `+0` and `-0` do not. This is the
 * comparison a `.json` assertion needs, and it is deliberately NOT `===` on
 * arrays: `[1,2] === [1,2]` is false, and a file that wrote its own `===` `eq`
 * only ever used it on primitives.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** A value rendered for a failure line: strings unquoted, everything else JSON. */
export function show(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value}n`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * A checker's assertion state.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.stream=false] print a line per assertion, not only failures
 * @param {function} [opts.fail] how a failure is printed; defaults to `console.log('  FAIL ' + line)`.
 *                              Pass `(line) => console.error(`  FAIL  ${line}`)` to keep a checker's
 *                              existing stream, because the two-space prefix and the stderr target
 *                              are part of what the harnesses already read.
 * @param {function} [opts.okLine] how a passing assertion is printed under `stream`;
 *                              defaults to `console.log('  ok   ' + line)`.
 * @returns {{
 *   ok:   (cond: unknown, what: string, detail?: string) => void,
 *   is:   (actual: unknown, expected: unknown, what: string, detail?: string) => void,
 *   eq:   (actual: unknown, expected: unknown, what: string, detail?: string) => void,
 *   near: (actual: number, expected: number, tol: number, what: string, detail?: string) => void,
 *   note: (what: string) => void,
 *   readonly checks: number,
 *   readonly failures: readonly string[],
 *   report: (code?: number) => number,
 * }}
 */
export function createChecker({
  stream = false,
  fail = (line) => console.log(`  FAIL ${line}`),
  okLine = (line) => console.log(`  ok   ${line}`),
} = {}) {
  let checks = 0;
  const failures = [];
  const notes = [];

  /** `ok(cond, what[, detail])` — the third argument is the MEASUREMENT. */
  const ok = (cond, what, detail) => {
    checks += 1;
    const line = detail ? `${what} — ${detail}` : `${what}`;
    if (cond) {
      if (stream) okLine(line);
      return;
    }
    failures.push(line);
    fail(line);
  };

  /** Identity, for the call sites where `===` is the claim (a primitive). */
  const is = (actual, expected, what, detail) =>
    ok(Object.is(actual, expected), what, detail ?? `expected ${show(expected)}, got ${show(actual)}`);

  /** Structural equality, for JSON-shaped values. */
  const eq = (actual, expected, what, detail) =>
    ok(deepEqual(actual, expected), what, detail ?? `expected ${show(expected)}, got ${show(actual)}`);

  /** |actual − expected| ≤ tol, for a measured number. */
  const near = (actual, expected, tol, what, detail) =>
    ok(Math.abs(actual - expected) <= tol, what,
      detail ?? `expected ${show(expected)} ± ${show(tol)}, got ${show(actual)}`);

  /**
   * A deliberate skip — something the branch proves cannot be measured here. It
   * is NOT a passing check: a bare `ok(true, …)` inflates the total whether or
   * not the page is right, which is the one shape this module exists to remove.
   */
  const note = (what) => {
    notes.push(what);
    console.log(`  note ${what}`);
  };

  return {
    ok, is, eq, near, note,
    get checks() { return checks; },
    get failures() { return failures; },
    get notes() { return notes; },
    /** Print the verdict and return the process exit code. */
    report(code = failures.length ? 1 : 0) {
      if (failures.length) {
        console.log(`FAIL  ${failures.length} of ${checks} checks failed`);
        for (const f of failures) console.log(`  · ${f}`);
      } else {
        console.log(`PASS  ${checks} checks`);
      }
      return code;
    },
  };
}
