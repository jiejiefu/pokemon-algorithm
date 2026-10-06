/**
 * Silence a CDP-driven page at the AudioContext's destination.
 *
 * WHY THIS EXISTS RATHER THAN A `--mute-audio` ALONE
 *
 * Both browser checkers already pass `--mute-audio`, and that flag is the right
 * first line: it mutes at the BROWSER, so the AudioContext still runs, still
 * resumes, and still advances `currentTime` — every claim either checker makes
 * about playback stays testable. Zeroing the page's volume slider instead would
 * be the wrong fix twice over: the slider feeds `clampVolume(masterVolume) / 15`
 * inside the APU, so a zeroed slider means the synthesiser never runs at all and
 * the playback check would be asserting that silence plays.
 *
 * The flag is not sufficient on its own, though. It is a request, and a silent
 * cry leak is not the kind of failure anyone notices until it has been happening
 * for a month — there is no red output, only a cry at a fifth of full scale in a
 * quiet room. So the guarantee is made inside the page instead, where it does not
 * depend on the browser honouring anything: `destination` is replaced by a gain
 * node sitting at zero, and the page's own `connect(ctx.destination)` — which is
 * how both pages wire their output — lands on that node instead of the speakers.
 *
 * WHAT THIS DOES NOT TOUCH, and why no assertion is weakened
 *
 * Everything either checker reads about playback comes from the AudioContext
 * CLOCK or from the DOM: `currentTime`, `startedAt`, `duration`, `aria-pressed`,
 * and canvas pixels. Gain at the destination is downstream of all of it. The APU
 * still renders every sample, `createBufferSource()` still runs, `resume()` is
 * still the thing that unblocks the clock — so "pressing play reaches the
 * synthesiser and moves a cursor" is still exactly what is being measured. Only
 * the last centimetre before the speakers is discarded.
 *
 * THE LIMIT, STATED PLAINLY
 *
 * This wraps `window.AudioContext`, so it covers every path through the two pages
 * today: `cry-player.js:196` and `cries-gen1.html:279` both connect into
 * `ctx.destination`. It does NOT cover `OfflineAudioContext`, which has no output
 * device to mute anyway, nor a page that reached the audio hardware by some other
 * route. `TAP_PROBE` reads the LIVE AudioParam rather than a value recorded at
 * install time, so a page that opened the tap back up would be caught by the
 * assertion rather than assumed away.
 *
 * It is one module rather than two copies in the two checkers for the reason
 * `cry-autoplay.js` is one module: a silent drift between two copies of a mute is
 * invisible, and the failure mode is noise.
 */

/** Source for `Page.addScriptToEvaluateOnNewDocument`. Runs before any page script. */
export const MUTE_TAP = `(() => {
  const Real = window.AudioContext || window.webkitAudioContext;
  const state = { taps: 0, tap: null, tapIn: [], error: null };
  // Non-configurable, so the page cannot overwrite the record of what was done to
  // its audio — an assertion reading a page-controlled value proves nothing.
  Object.defineProperty(window, '__cdpMutedTap', { value: state, configurable: false });
  if (typeof Real !== 'function') {
    // Recorded rather than thrown. Both checkers assert "no uncaught exceptions", so
    // a throw here would fail as a confusing unrelated line, and this way the reason
    // reaches the reader through the assertion that is actually about muting.
    state.error = 'no AudioContext constructor on this page';
    return;
  }
  class Muted extends Real {
    constructor(...args) {
      super(...args);
      const tap = this.createGain();
      tap.gain.value = 0;
      tap.connect(this.destination);          // wire it to the REAL speakers...
      Object.defineProperty(this, 'destination', { get: () => tap, configurable: true });
      state.taps++;                          // ...then make the page's connect land here.
      state.tap = tap;
      // Record what the page connects IN, so a checker can read the LEVEL the page
      // itself is producing. The tap is a sink, so nothing it sees tells you what
      // arrived — and the mute question is not "is the tap at zero" but "is the page
      // asking for sound at all".
      //
      // The interception is on AudioNode.prototype.connect and keyed on the target
      // being THIS tap, because the page's call runs the other way round: the player
      // does gain.connect(ctx.destination), so the tap is the ARGUMENT and its own
      // connect is never called. Overriding tap.connect — the obvious reading —
      // records nothing and the probe returns an empty list, which is what the first
      // version did.
      //
      // This is the only handle on the player's own gain from outside the module:
      // cry-player.js keeps it in a private field and the pages expose no control,
      // which is precisely why a page's silence could not be attributed to anything
      // the reader did. The NODE is held, not a reading of it, so what is asked for
      // is the live AudioParam and not whatever the gain was at connect time.
      if (!state.patched) {
        state.patched = true;
        const proto = Object.getPrototypeOf(Object.getPrototypeOf(tap));   // AudioNode.prototype
        const realConnect = proto.connect;
        proto.connect = function (dest, ...rest) {
          if (dest === tap && this.gain) state.tapIn.push(this);
          return realConnect.call(this, dest, ...rest);
        };
      }
    }
  }
  Object.defineProperty(Muted, 'name', { value: Real.name });
  window.AudioContext = Muted;
  if (window.webkitAudioContext === Real) window.webkitAudioContext = Muted;
})();`;

/**
 * Expression for `Runtime.evaluate`. Returns what the tap can be ASKED rather than
 * what it claimed: `gain` is read back off the live AudioParam, so it answers
 * "is the output still muted right now" and not "was it muted at install time".
 *
 * `inGain` is the same discipline applied one node upstream: the page's own
 * output level, read off the live `AudioParam` of whatever it connected to the
 * destination. A page asking for 0 is not muted BY THE CHECKER, it is silent, and
 * the two must not be confused — which is the whole question when a page is
 * expected to be audible.
 */
export const TAP_PROBE =
  '(() => { const s = window.__cdpMutedTap; return s ? '
  + '{ taps: s.taps, error: s.error, gain: s.tap ? s.tap.gain.value : null, '
  + '  inGain: s.tapIn.map((n) => (n && n.gain ? n.gain.value : null)) } '
  + ': { taps: 0, error: "the tap script never ran", gain: null, inGain: [] }; })()';