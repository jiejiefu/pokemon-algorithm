/**
 * The one definition of "this mutation was caught by the assertion it claims".
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `output.includes(expect)`
 *
 * Every negative test in scripts/ answers the same question — did this deliberate
 * defect make the checker report the failure it was supposed to report? — and the
 * obvious way to ask it is `output.includes(expect)`. That is wrong, and it was
 * wrong in four cases of test_check_gen1_apu.mjs at once.
 *
 * A checker prints each assertion's description whether it PASSES or FAILS, so the
 * description text is in the output either way. Matching anywhere therefore only
 * asks "did this string appear", which a case whose `expect` names a *different*
 * assertion satisfies for free. Four APU cases did exactly that: their `expect`
 * sat inside the description of a check that still passed under the mutation, and
 * the case was really being caught somewhere else entirely. One of them had been
 * calling itself a timeline test for its whole life while being a waveform test.
 *
 * Requiring the string to appear on a line that REPORTED A FAILURE is the same
 * question asked properly: not "is this text present" but "did the assertion I am
 * claiming credit for actually fail". Tightening the matcher is what surfaced all
 * four; loosening it back would make every one of them undetectable again, which
 * is the same shape as the seven truncated species that were once recorded as a
 * known exception set — a green test standing in for a claim nothing was checking.
 *
 * It is one exported function rather than nine copies because a rule that has to
 * be re-typed in nine places is a rule that will be retyped wrong in one of them.
 *
 * @param {string} out     the checker's combined stdout+stderr
 * @param {string} expect  the assertion's description, as the case declares it
 * @returns {boolean}
 */
export function caughtBy(out, expect) {
  if (!expect) return false;
  return failBlocks(out).some((b) => b.includes(expect));
}

/* A check line is one the checker emits per assertion: `  ok   …`, `  FAIL …`, and
 * the `FAIL  3 of 86 checks failed` summary. A failure REPORT is that line plus the
 * indented continuation beneath it, because `eq()` prints the offending values there
 * and a case is allowed to name one of those.
 *
 * This is the same discipline as the rest of the section applied one level down: the
 * first version matched only the `FAIL` line itself and so rejected two perfectly
 * good cases in test_check_cry_features.mjs that name the violated condition —
 * `rms 1.23 > peak 0.61` and `centroid above Nyquist` — which the checker reports on
 * the `got:` line under a shared "physically possible" assertion. Matching the line
 * alone would have had me "fix" two correct cases into wrong ones. The rule is not
 * "on the FAIL line", it is "not in a passing check's description". */
function failBlocks(out) {
  const CHECK_LINE = /^\s*(?:ok\b|FAIL\b|\d+ checks?\b|PASS\b)/;
  const blocks = [];
  let cur = null;
  for (const line of out.split('\n')) {
    const isCheck = CHECK_LINE.test(line);
    const startsFailure = line.includes('FAIL');
    if (isCheck && startsFailure) {
      if (cur) blocks.push(cur);
      cur = [line];
    } else if (isCheck) {
      if (cur) blocks.push(cur);
      cur = null;
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks.map((b) => b.join('\n'));
}

/**
 * Every failure report in the output, for a failure message that has to explain what
 * the checker said instead. Prefer this over dumping the whole output: it is the only
 * part that is evidence.
 */
export function failLines(out) {
  return failBlocks(out).map((b) => b.split('\n')[0]);
}