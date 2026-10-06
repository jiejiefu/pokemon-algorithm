// ==========================================
// 寶可夢演算法 — 排序執行狀態 (sort-run.js)
// ==========================================
// No DOM here on purpose — this file is the part of "單步 / 倒退 / 時間軸"
// that has nothing to do with canvases or audio, so it's the part that's
// actually practical to unit-test. sorting.html only ever calls playChunk /
// stepForward / stepBack / seekTo and reads the counters; it never reaches
// into `events` or `checkpoints` itself.
//
// THE THREE NUMBERS THAT DECIDE WHAT THE UI MAY OFFER, at n=1,025, measured by
// `scripts/check_sorting_page.mjs`, which drives these generators and diffs the
// numbers against the ones quoted below. An earlier version of this comment cited
// a checker that never existed — check_algo_modules.mjs, with no path, because a
// path here IS a citation and one that no longer resolves — and carried a number it
// therefore could not have confirmed:
//
//   524,800   選擇排序 on ALREADY-SORTED input. The old text attributed it to
//             氣泡／選擇／插入 on REVERSE-SORTED input; measured, reverse-sorted
//             is 1,049,600 for 氣泡 and 插入 and 787,968 for 選擇, and already-
//             sorted is 1,024 for 氣泡 and 插入. Same ballpark, wrong algorithm,
//             wrong input — and the wrong version reads fine, which is why it sat
//             here. All four are over DEFAULT_MAX_LOGGED_EVENTS, so the
//             consequence the UI draws from it (timeline and step-back off) was
//             never affected; the claim was, not the behaviour.
//   400,000   DEFAULT_MAX_LOGGED_EVENTS. 選擇排序 exceeds it on all three inputs
//             tried at n=1,025 — 531,495 shuffled, 524,800 already-sorted,
//             787,968 reverse-sorted — so on that one algorithm the timeline is
//             never offered.
//   11,795    快速 on already-sorted input, the fewest steps any of the six log at
//             n=1,025 without capping, which is why the cap is 400,000 and not
//             something a reader would notice as arbitrary. Shuffled it is 17,234.
//
// That last asymmetry is the design constraint: "已停用單步／時間軸" is not an
// error state to apologise for, it is the honest answer for a third of the
// algorithm/input combinations, and the page has to say so rather than hide the
// controls.
//
// `maxLoggedEvents: 0` is the fourth caller-facing knob and it is the one
// sorting.html's race mode uses. A race lane never rewinds, so it asks for no
// history at all: at n=1,025 the log plus its every-300-events `arr.slice()`
// costs ~33 MB per lane, six of which is ~200 MB that nothing would read. Setting
// it to 0 flips `canStep` to false, which is correct — race mode has no timeline —
// and the events the renderer needs arrive in `playChunk()`'s return value, not
// in `this.events`.
//
// The core problem this solves: a JS generator object can't be rewound. Once
// you've called .next() past some point, that point is gone from the
// generator's own state. So "step back" can't mean "ask the generator for
// the previous value" — it means replaying the RECORDED events onto a copy
// of the array. Doing that from event #0 every time would make step-back on
// event #400,000 of a bubble sort replay 400,000 swaps to go back one step.
// Checkpointing the array order every `checkpointInterval` events bounds
// that replay to at most one interval's worth, no matter where in a run you
// are.

export const DEFAULT_CHECKPOINT_INTERVAL = 300;
export const DEFAULT_MAX_LOGGED_EVENTS = 400000;

export class SortRun {
  /**
   * @param {Array} arr - working array, mutated in place as the run advances
   * @param {Function} compare - (a,b) => number
   * @param {Function} generatorFn - one of the *Steps exports from
   *   sorting-algorithms.js, called as generatorFn(arr, compare)
   */
  constructor(arr, compare, generatorFn, opts = {}) {
    this.arr = arr;
    this.compare = compare;
    this.gen = generatorFn(arr, compare);

    this.checkpointInterval = opts.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
    this.maxLoggedEvents = opts.maxLoggedEvents ?? DEFAULT_MAX_LOGGED_EVENTS;

    this.events = [];
    this.checkpoints = [{ atEvent: 0, order: arr.slice(), comparisons: 0, moves: 0 }];
    this.cursor = 0;          // events[0..cursor) have been applied to `arr`
    this.comparisons = 0;
    this.moves = 0;           // swap + write, i.e. "the array actually changed"
    this.totalSteps = 0;      // keeps counting even after logging is capped
    this.done = false;
    this.cappedLogging = false;
  }

  get atLiveHead() { return this.cappedLogging || this.cursor === this.events.length; }
  /** Step-back and the timeline scrubber both need real history; once a run
   *  is big enough to hit maxLoggedEvents, neither is safe any more, so the
   *  UI should hide those controls when this is false. */
  get canStep() { return !this.cappedLogging; }

  /** Pulls exactly one new value from the generator (the ONLY thing that can
   *  advance the underlying generator — everything else replays events
   *  already recorded here). Always operates at the live head. */
  _advanceGenerator() {
    if (this.done) return null;
    const res = this.gen.next();
    if (res.done) { this.done = true; return null; }
    const ev = res.value;

    if (ev.t === 'compare') this.comparisons++;
    else if (ev.t === 'swap' || ev.t === 'write') this.moves++;
    this.totalSteps++;

    if (!this.cappedLogging) {
      this.events.push(ev);
      this.cursor = this.events.length;
      if (this.events.length >= this.maxLoggedEvents) {
        this.cappedLogging = true;
        this.events = [];        // nothing will read history again once capped
        this.checkpoints = [];
      } else if (this.events.length % this.checkpointInterval === 0) {
        this.checkpoints.push({
          atEvent: this.events.length,
          order: this.arr.slice(),
          comparisons: this.comparisons,
          moves: this.moves
        });
      }
    }
    return ev;
  }

  /** Live-play entry point: advances up to n NEW steps, stopping early if
   *  the generator finishes. Returns the events produced, in order, so the
   *  caller can react (grid repaint, audio) without re-deriving them. If the
   *  run had been rewound by stepBack/seekTo, play always resumes from the
   *  live head — see seekTo's docstring for why a generator can't branch. */
  playChunk(n) {
    if (!this.atLiveHead) this.seekTo(this.events.length);
    const produced = [];
    for (let k = 0; k < n && !this.done; k++) {
      const ev = this._advanceGenerator();
      if (ev) produced.push(ev);
    }
    return produced;
  }

  /** Restores `this.arr` to the state after exactly `target` recorded
   *  events, by loading the nearest checkpoint at or before `target` and
   *  replaying swap/write events forward from there. `target` must be
   *  `<= events.length` — this can rewind or fast-forward WITHIN recorded
   *  history, but it cannot go past the live head, because past the live
   *  head there is no recorded history yet, only the generator's own
   *  internal state, and that can only move forward one step at a time via
   *  _advanceGenerator(). ('write' events carry the node that was written,
   *  not just the destination index — merge sort's write is "was left[i] or
   *  right[j] smaller", a decision already made when the generator yielded
   *  it, so replay reads it back rather than re-deriving it from an array
   *  state that, mid-replay, may not even hold `left`/`right` any more.) */
  seekTo(target) {
    if (this.cappedLogging) return;
    target = Math.max(0, Math.min(target, this.events.length));

    let cp = this.checkpoints[0];
    for (const c of this.checkpoints) {
      if (c.atEvent <= target) cp = c; else break;
    }

    this.arr.length = 0;
    for (const node of cp.order) this.arr.push(node);
    this.comparisons = cp.comparisons;
    this.moves = cp.moves;

    for (let i = cp.atEvent; i < target; i++) {
      const ev = this.events[i];
      if (ev.t === 'swap') {
        const tmp = this.arr[ev.i];
        this.arr[ev.i] = this.arr[ev.j];
        this.arr[ev.j] = tmp;
      } else if (ev.t === 'write') {
        this.arr[ev.i] = ev.node;
      }
      /* Counters are REWOUND TOO, by replaying them from the checkpoint rather
       * than left as they are. This was a real defect and not a rounding quibble:
       * sorting.html puts 比較次數 next to a timeline the reader can drag, and a
       * counter that only ever climbs means dragging back to step 0 still reads
       * 「524,800 次比較」 — the panel describing a state the grid is not in.
       *
       * The checkpoint already stored `comparisons` and `moves`, and nothing read
       * them: a field that is written and never read is the exact shape §4 of
       * AGENTS.md calls out, and here it was hiding a bug rather than a feature.
       * `totalSteps` is deliberately NOT rewound — it is a measure of work done,
       * not of position, and the page labels it 目前步數 while the run is live and
       * 步數 once finished. */
      if (ev.t === 'compare') this.comparisons++;
      else if (ev.t === 'swap' || ev.t === 'write') this.moves++;
    }
    this.cursor = target;
  }

  /** One step forward. Replays a already-recorded step if the run had been
   *  rewound; otherwise pulls a genuinely new one from the generator.
   *  Returns the event that was just (re)applied, or null at the very end. */
  stepForward() {
    if (this.cappedLogging) return this._advanceGenerator();
    if (this.cursor < this.events.length) {
      const ev = this.events[this.cursor];
      this.seekTo(this.cursor + 1);
      return ev;
    }
    return this._advanceGenerator();
  }

  /** One step back. No-op (returns null) at event 0 or once logging has
   *  been capped for memory — see the `canStep` getter. */
  stepBack() {
    if (this.cappedLogging || this.cursor === 0) return null;
    const ev = this.events[this.cursor - 1];
    this.seekTo(this.cursor - 1);
    return ev;
  }
}
