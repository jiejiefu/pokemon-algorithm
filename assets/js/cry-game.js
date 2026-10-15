/**
 * 叫聲猜謎 — cry-game.html, the only page caller.
 *
 *   cry-game.html                  this file
 *   check_cry_game.mjs             the shell contract and the shape assertions
 *   assets/js/cry-game-similarity.js  the draw, the difficulty and the scoring
 *
 * ---------------------------------------------------------------------------
 * THREE LAYERS, AND THE BOUNDARY IS WHAT MAKES EACH OF THEM CHECKABLE
 * ---------------------------------------------------------------------------
 *
 *   1. `cry-game-similarity.js`  arithmetic. No DOM, no fetch, no audio, no
 *      localStorage — which is why `check_cry_game_similarity.mjs` can run it in
 *      bare Node and assert the design rather than the syntax. It also owns the
 *      DIFFICULTY, as a similarity ceiling measured over the corpus; this file
 *      never computes one.
 *   2. THIS FILE. State, DOM, events, audio, localStorage. Nothing here is a
 *      measurement.
 *   3. `cry-game.css`. Every selector carries a `cg-` prefix, and there is no
 *      `.cy-`, `.sp-` or `.gm-` rule in it (§3.B1).
 *
 * ---------------------------------------------------------------------------
 * THE NAMES ARE HIDDEN UNTIL THE ANSWER IS GIVEN, and that is a DELIBERATE
 * departure from the reference rather than an omission
 * ---------------------------------------------------------------------------
 *
 * The reference (`pokemoncries`, `/select-answers/:step`) prints the species
 * name on all four cards and asks the player to pick. That is a MEMORY test — it
 * asks 「which name belongs to this sound」, which is unanswerable by anyone who
 * has not memorised the dex and says nothing about recognition. A page titled
 * 「Guess the Pokémon by its Cry」 whose options all have their names printed on
 * them is not that.
 *
 * So a card is a 96×96 sprite and a national dex number while the round is
 * playing, and the name appears when the question resolves. The name element
 * still occupies its line before then (`min-height`), so resolving a question
 * does not change the height of the four cards.
 *
 * ---------------------------------------------------------------------------
 * THE ANSWER IS NOT AUTO-PLAYED, AND THAT IS A BROWSER CONSTRAINT RATHER THAN
 * A CHOICE
 * ---------------------------------------------------------------------------
 *
 * Every AudioContext starts suspended and `resume()` needs a user gesture, so a
 * question that played itself on arrival would be silent on every browser
 * unless the page had been unlocked by an earlier click. The play control is
 * therefore the largest target on the card, it sits directly over the waveform
 * rather than beside it, and `#cg-player` says what to press.
 *
 * What the page does NOT do is add a mute switch, and the reason is that this
 * page makes no sound a reader did not ask for: nothing plays until they press
 * play. The site-wide `cryPlayer.muted` preference is still honoured, because
 * that is a reader's own setting rather than this page's default — and this page
 * deliberately does NOT call `muteForView()`, which is the whole point of that
 * method (§3.G6: merely LOADING a page must not speak for pages it has not
 * visited).
 *
 * ---------------------------------------------------------------------------
 * `Math.random` IS DELIBERATELY ABSENT FROM THIS FILE
 * ---------------------------------------------------------------------------
 *
 * The daily round is seeded and the unlimited round is not, and BOTH draws take
 * their randomness from `cry-game-similarity.js` — which is to say neither this
 * file nor `buildDailyRound()` ever names a generator. So there is no
 * `Math.random(` anywhere in these 900 lines, and `check_cry_game.mjs` asserts
 * that as a standing invariant rather than with an exemption.
 *
 * The alternative was to pass `Math.random` in explicitly, which is honest-looking
 * and worse: the claim then becomes "this page reaches for randomness only where
 * the module says it may", which is a shape a reader has to check by eye, rather
 * than "this page never reaches for randomness at all", which a checker can
 * enforce. Same reason `game-tips.js` is a module rather than a constant inside
 * colour-game's page (§3.W).
 */

import { TYPE_COLORS, TYPE_EN_ZH, pokemonDetailUrl } from './shared.js';
import { spriteUrl } from './color-palette.js';
import { cryPlayer } from './cry-player.js';
import { mountAutoplay } from './cry-autoplay.js';
import {
  MAX_QUESTIONS, CHOICES, DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES,
  SIMILARITY_CEILING, FEATURE_SET, DEFAULT_GENERATION,
  cryIndex, poolFor, availableGenerations,
  buildRound, buildDailyRound, eliminateIndex,
  scoreRound, shareText,
  normalizeDifficulty, normalizeGeneration,
  taipeiDateKey,
} from './cry-game-similarity.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_PREFIX = 'pokemon-crygame:';

/**
 * The cry set this page plays, read from the module rather than written here.
 *
 * `cry-game-similarity.js` exports `FEATURE_SET`, and `LEGACY_SET` above it is
 * the single switch. Both the measurement and the playback have to agree on
 * which recording a question is about — a page playing `latest` while the index
 * measures `legacy` is a game whose difficulty is a fiction — so the value is
 * READ rather than restated, and `check_cry_game.mjs` asserts that this file and
 * the module name the same one.
 */
const CRY_SET = FEATURE_SET;

/** Peaks drawn across the waveform. 220 is `cries.html`'s number, on purpose. */
const WAVE_BUCKETS = 220;

/** Roman numerals for the generation chips, matching colour-game's own helper. */
const NUMERALS = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  mode: 'daily',        // 'daily' | 'unlimited'
  difficulty: 'easy',   // 'easy' | 'hard' | 'hell'
  gen: 0,               // 0 is 全部世代
  /**
   * Has the reader ever clicked a generation chip?
   *
   * This is what separates 「簡單 opens on 第I世代」 from 「clicking 簡單 yanks the
   * pool back to 第I世代」. The second reading is defensible on paper and hostile
   * in use: a reader who picked 第六世代 to hear sixth-generation cries would have
   * it taken away by the difficulty tab, with nothing in the interface saying the
   * filter moved — §3.W's shape, a control changing something the reader was not
   * told about.
   *
   * So the module's `DEFAULT_GENERATION` applies only while this is false, and the
   * first chip click makes it true forever. It is PERSISTED rather than inferred
   * from the stored generation, because the two are indistinguishable afterwards:
   * a reader who lands on 簡單 and never touches the chips stores `gen: 1` exactly
   * as one who chose it deliberately does, and inferring one from the other would
   * hand a deliberate choice to a default on the next visit.
   */
  genTouched: false,    // the reader has chosen a generation themselves
  questions: [],        // the round
  picks: [],            // one entry per answered question, null until then
  revealed: false,      // the current question has resolved
  answeredAt: null,     // the index just answered, or null — see indexOfCurrent
  eliminated: new Set(), // option indices removed by the hint, this question only
  hintUsed: false,      // this question's one hint is spent
  status: 'playing',    // 'playing' | 'done'
};

/** id -> pokemon record, and the feature index. Built once. */
let byId = new Map();
let index = null;
let generations = [];
let pool = [];

/** Every element this page writes to. Built in `init()`, never at module scope. */
const els = {};
let waveCache = null;
let progressRaf = 0;
let resultRevealed = false;
/**
 * The sentence `#cg-player` will carry on the NEXT `renderAll()`, and `null`
 * otherwise. Consumed and cleared by `renderAll()`.
 *
 * It exists because the region must have exactly one writer and there are three
 * places that need to speak — the outcome of a pick, the outcome of a round, and
 * the hint saying what it just did. Without this they would each write
 * `textContent` directly, and the two that ran on the same frame as a re-render
 * would overwrite each other in an order that depends on which came first in the
 * function.
 */
let lastAnnouncement = null;

/** `cry-autoplay.js`'s handle. Mounted in `init()`, read by `maybeAutoPlay()`. */
let autoplay = null;

/**
 * HAS THIS DOCUMENT BEEN ACTIVATED?
 *
 * **THE WHOLE AUTOPLAY FEATURE RESTS ON THIS FLAG, and it is not an optimisation.
 * Measured, not assumed: calling `cryPlayer.play()` before the page has had any
 * user gesture leaves the promise **PENDING forever** — three seconds measured,
 * no rejection, `onStart` never fires — because `unlock()` awaits `ctx.resume()`
 * and Chrome holds that promise open until the document is activated. The audio
 * never plays, the play button never flips to its pause glyph, and the caller
 * learns nothing: not an error, a hang.
 *
 * So the page never *attempts* an auto-play before it knows it can. The unlock
 * itself is a one-shot document listener calling `cryPlayer.unlock()` on the
 * reader's first click of ANY kind — including a click on a choice card, which is
 * what makes this seamless: a reader who guesses question 1 blind has still
 * activated the document, so question 2 auto-plays.
 *
 * Measured after a single card press: unawaited `play()` calls start within
 * 1.2 s with **no further gesture**, repeatedly.
 *
 * A reload resets it, so a reader who reloads mid-round gets one ▶ on the next
 * question. That is correct rather than a workaround, and the rules section says
 * so in the open rather than leaving them to wonder.
 */
let audioUnlocked = false;

/**
 * Install the one-shot unlock. Capture phase, because the reader's first click
 * may be stopped or swallowed by whatever handled it — and a listener that never
 * runs leaves the page permanently in the "no auto-play" state with nothing
 * wrong-looking on screen.
 */
function installUnlock() {
  const once = () => {
    document.removeEventListener('click', once, true);
    cryPlayer.unlock()
      .then(() => { audioUnlocked = true; })
      .catch(() => { /* Web Audio unavailable; the play button reports it */ });
  };
  document.addEventListener('click', once, true);
}

/**
 * Play the current question once, if that is both wanted and possible.
 *
 * Called from `newRound()` and `advance()` only — never from `renderAll()`, which
 * runs on a theme flip, a resize and every state write. The three conditions are
 * all necessary:
 *
 *   `autoplay.on`     the reader's own preference
 *   `audioUnlocked`   the browser will actually produce sound; see above
 *   `!playing`        a replay mid-cry is not an auto-play, it is a re-listen
 */
function maybeAutoPlay() {
  if (!autoplay || !autoplay.on || !audioUnlocked) return;
  if (cryPlayer.playing) return;
  if (state.status !== 'playing') return;
  playCurrent({ fromAutoPlay: true });
}

// ---------------------------------------------------------------------------
// localStorage, entirely inside a try/catch
// ---------------------------------------------------------------------------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* private mode */ }
  },
};

/**
 * The daily store key.
 *
 * It carries the mode's own inputs — difficulty AND generation — because two
 * readers on the same day under different filters were shown the same round once
 * already, when the filter only narrowed the pool. The seed carries the same
 * three values for the same reason.
 */
const dailyKey = (difficulty, gen) => `daily:${difficulty}:${gen}`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Show or hide by writing `display`, never `hidden` alone.
 *
 * §3.M: an author `display` beats the user agent's `[hidden] { display: none }`
 * regardless of specificity, so `element.hidden = true` on a flex element leaves
 * a painted box that reads as `true`. Every element hidden through here has an
 * author `display` in `cry-game.css`, and `check_cry_game.mjs` derives which
 * those are and requires the `[hidden]` pairing in the stylesheet.
 *
 * Nothing else in this file may write `.style.display`; the checker asserts that
 * by counting the call sites, because a second writer is how a panel ends up
 * neither hidden nor shown depending on which ran last.
 */
function setRevealed(node, on) {
  if (!node) return;
  /* BOTH, AND THAT IS THE POINT. §3.M is usually quoted in the direction
   * 「setting `hidden` does not hide it»; this is the other direction and it bit
   * this page on its first browser run. Seven elements ship with `hidden` in the
   * markup, `renderAll()` called `setRevealed(el, true)` on each, and the 下一題
   * button stayed invisible — because writing `style.display = ''` says nothing
   * about an attribute the UA sheet is still acting on. `element.hidden` read
   * `true`, the author `[hidden]` rule read true, and 109 static assertions were
   * green because every one of them asks whether a `[hidden]` pairing EXISTS, not
   * whether anything ever clears the attribute.
   *
   * Writing both cannot disagree, and `check_cry_game.mjs` asserts that this
   * function writes both and that no other function writes either. */
  node.hidden = !on;
  node.style.display = on ? '' : 'none';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const numeralOf = (n) => NUMERALS[n] || String(n);

/**
 * Today, in Taipei's day.
 *
 * **`daily-pick.js`'s `taipeiDateKey(now)` REQUIRES the argument.** It reads
 * `now.getTime()` with no default of its own, so a bare call is a TypeError
 * rather than a date — and this page called it bare in four places, which is how
 * the first browser run of this page died: `newRound()` threw inside
 * `persistDaily()`, so no round was ever built, the four cards the smoke test
 * counted were the ones the failing render had left behind, and the waveform had
 * zero ink because `loadWave()` was three lines below the throw.
 *
 * Nothing anywhere said so — no console error a static check would surface, and
 * 109 shape assertions all green. §3.G1a's shape exactly, and the reason the
 * page was driven in a real browser before it was called done. One helper here
 * rather than four bare calls is the fix; `cry-game-similarity.js` does the same
 * for the same reason.
 */
function todayKey() {
  return taipeiDateKey(new Date());
}

/** The cry URL for a species, through cry-index.js so a 404 is knowable. */
const crySetName = () => (CRY_SET === 'legacy' ? '舊版錄音' : '現行錄音');

// ---------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------

/** The pool a round draws from, recomputed whenever the filter changes. */
function currentPool() {
  return poolFor(index, POKEMON_DATA, state.gen);
}

/**
 * Build a fresh round.
 *
 * Daily is seeded over the day's own key so every reader gets the same ten
 * questions; unlimited takes the module's own default generator. Neither path
 * names one here — see the file docblock on why that is the invariant rather
 * than an accident.
 */
function newRound() {
  stopProgress();
  setRevealed(els.waveProgress, true);
  els.waveProgress.style.transform = 'scaleX(0)';
  setPlayState(false);
  cryPlayer.stop();

  const p = currentPool();
  if (p.length < CHOICES) {
    /* A filter with fewer than four playable species. The pool is derived, so
     * this cannot happen for any of the nine generations on the shipped corpus —
     * the smallest holds 72 — and it exists for a future table whose rows are
     * patchier. Refusing is the right answer rather than drawing a short round:
     * a round of three that reports 「3 / 10」 is worse than no round, because the
     * result panel would claim a denominator it never offered. */
    state.questions = [];
    state.picks = [];
    state.status = 'playing';
    lastAnnouncement = '這個範圍沒有足夠的寶可夢出題，請改一個世代或選「全部」。';
    renderAll();
    return;
  }

  /* THE RANDOMNESS IS THE MODULE'S, NOT THIS PAGE'S. `buildRound` and
   * `eliminateIndex` both default `rand` to `Math.random`, and neither default
   * is passed here — so this file contains no `Math.random(` at all, and
   * `check_cry_game.mjs` asserts that as a standing invariant rather than with an
   * exemption. The claim is worth making because a page that reached for a random
   * number of its own would be able to do so without anyone noticing, and the
   * check that the daily round is reproducible would quietly stop covering it. */
  state.questions = state.mode === 'daily'
    ? buildDailyRound(index, p, state.difficulty, state.gen)
    : buildRound(index, p, state.difficulty);
  state.picks = state.questions.map(() => null);
  state.revealed = false;
  state.answeredAt = null;
  state.eliminated = new Set();
  state.hintUsed = false;
  state.status = 'playing';
  waveCache = null;
  lastAnnouncement = null;

  if (state.mode === 'daily') persistDaily();
  renderAll();
  loadWave();
  maybeAutoPlay();
}

/**
 * Restore a daily round played earlier today.
 *
 * **The questions are rebuilt from the SEED, not stored.** A stored round would
 * pin today's puzzle to whatever the module produced when the reader first
 * arrived — so a change to the ceiling or to the tie-break would leave everyone
 * with a different 「今日」 than a reader who arrives an hour later. Rebuilding
 * costs a few milliseconds and keeps 「everyone sees the same ten questions」
 * literally true.
 *
 * Only the PICKS are restored, and they are restored by id and re-checked
 * against the rebuilt questions, so a saved round whose answers no longer match
 * a changed round drops those picks rather than scoring them wrong.
 */
function restoreDaily() {
  const saved = store.get(`${STORE_PREFIX}${dailyKey(state.difficulty, state.gen)}`, null);
  if (!saved || saved.date !== todayKey()) return false;
  const p = currentPool();
  if (p.length < CHOICES) return false;
  const questions = buildDailyRound(index, p, state.difficulty, state.gen);
  if (questions.length !== MAX_QUESTIONS) return false;

  state.questions = questions;
  /* BY POSITION, `i` — not by the question. The first version wrote
   * `(saved.picks || [])[q]`, indexing the array by the question OBJECT, which
   * stringifies to `[object Object]` and is therefore `undefined` for every
   * question. Every pick restored as `null`, `first` came back 0, and the round
   * silently started again from question 1 — so a reader who finished all ten,
   * closed the tab, and came back was shown the same ten questions with nothing
   * remembered.
   *
   * That one character also defeats the check that looks like it would catch it:
   * the picks are still validated against the rebuilt questions, they are just
   * all empty. A shape assertion cannot tell 「restored」 from 「reset to nothing」
   * because they are the same value. */
  state.picks = questions.map((q, i) => {
    const id = (saved.picks || [])[i];
    return typeof id === 'number' ? id : null;
  });
  waveCache = null;

  /* THREE EXITS, AND `findIndex` HAS THREE ANSWERS, NOT TWO.
   *
   * `first` is the index of the first question with no pick. It is 0 when
   * nothing has been answered, a positive number mid-round, and **-1 when the
   * round is FINISHED**. The second version tested `first === 0` and then
   * `first < MAX_QUESTIONS` — and `-1 < 10` is true, so a completed round took
   * the mid-round branch and `slice(0, -1)` quietly dropped its tenth question:
   * the board came back reading 「第 9 / 9 題」 on a round the reader had finished,
   * and the result panel never appeared.
   *
   * So `-1` is tested FIRST and explicitly. `findIndex` returning -1 is not an
   * edge case to be swept up by an inequality; it is the ordinary answer for
   * 「every element matched」. */
  const first = state.picks.findIndex((x) => x == null);
  state.eliminated = new Set();
  state.hintUsed = false;

  if (first === -1) {
    /* FINISHED. `answeredAt` is null, so `indexOfCurrent` derives the last
     * question, and the result panel is the whole of what this round is now. */
    state.answeredAt = null;
    state.revealed = true;
    state.status = 'done';
    renderAll();
    return true;
  }

  if (first > 0) {
    /* MID-ROUND: resume at the first unanswered question, which is the one the
     * reader was looking at. Truncating rather than keeping the tail matters:
     * `indexOfCurrent` is derived from the picks, so a tail of `null`s would put
     * the reader on question `first` anyway — but the questions AFTER it would
     * still be in the round, and 「下一題」 would count a round of ten when only
     * `first` of them were ever shown. */
    state.questions = state.questions.slice(0, first);
    state.picks = state.picks.slice(0, first);
    state.answeredAt = null;
    state.revealed = false;
    state.status = 'playing';
    /* BEFORE `renderAll()`, not after. `renderAll()` is what consumes
     * `lastAnnouncement` and then clears it, so setting the sentence afterwards
     * leaves it set for the NEXT render — where it would displace whatever the
     * reader was told then. The order is the same as in `answer()`. */
    lastAnnouncement = `接續今天的題目——已經答了 ${first} 題。`;
    renderAll();
    loadWave();
    return true;
  }

  /* A saved round with no picks at all is not a restored round, and returning
   * `true` here without drawing is what made the reload path a no-op: `init()`
   * reads `true` and skips `newRound()`, so nothing was ever rendered. Every
   * path that returns `true` has drawn, because the caller's only action on
   * `true` is to do nothing. */
  state.answeredAt = null;
  state.revealed = false;
  state.status = 'playing';
  renderAll();
  loadWave();
  return true;
}

/** Everything a finished daily round needs to survive a reload. */
function persistDaily() {
  store.set(`${STORE_PREFIX}${dailyKey(state.difficulty, state.gen)}`, {
    date: todayKey(),
    picks: state.picks,
  });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * Record a pick and resolve the question.
 *
 * A repeat pick is ignored SILENTLY rather than announced: the card is already
 * disabled by then, so there is nothing to tell the reader that the interface has
 * not already shown. A second guard refuses a pick for a question already
 * answered, which the disabled state should make unreachable — and it is here
 * because "should" is not a guarantee when the two writers are different
 * functions.
 */
function answer(optionIndex) {
  if (state.status !== 'playing') return false;
  if (state.revealed) return false;
  /* THE DERIVED INDEX, READ ONCE. `state.indexOfCurrent` is a getter that walks
     `picks` for the first null, and reading it twice means the pick write below
     could land on a different question than the one whose options were validated
     above — which is the kind of thing that cannot be seen and takes a reload to
     reproduce. */
  const i = state.indexOfCurrent;
  const q = state.questions[i];
  if (!q) return false;
  const id = q.options[optionIndex];
  if (id == null) return false;

  state.picks[i] = id;
  state.answeredAt = i;
  state.revealed = true;
  state.eliminated = new Set();
  state.hintUsed = true;
  if (state.mode === 'daily') persistDaily();

  const correct = id === q.answer;
  /* Announced into `#cg-player` BEFORE `renderAll()`, which writes it again from
     `renderPlayer()`. The order is the other way round on purpose for the
     opposite reason: `renderPlayer()` is the single writer of this region, and
     putting the announcement after it would mean two functions own one live
     region — which is how a round outcome gets deleted on the frame it was most
     wanted. So the announcement is the INPUT, and `renderPlayer()` is what says
     it. */
  lastAnnouncement = correct
    ? `答對了，這是 #${q.answer} ${byId.get(q.answer).names.zh}。`
    : `這是 #${q.answer} ${byId.get(q.answer).names.zh}，不是牠。`;

  renderAll();
  return true;
}

/** The one hint: drop one wrong option. Never the answer — see the module. */
function useHint() {
  if (state.status !== 'playing' || state.revealed || state.hintUsed) return false;
  const q = state.questions[state.indexOfCurrent];
  if (!q) return false;
  const k = eliminateIndex(q);
  if (k == null) {
    lastAnnouncement = '這一題沒有可以排除的選項了。';
    renderAll();
    return false;
  }
  state.eliminated.add(k);
  state.hintUsed = true;
  lastAnnouncement = '已排除一個選項。每題只能排除一次，而且不會排除掉正確答案。';
  renderAll();
  return true;
}

/** Advance to the next question, or end the round. */
function advance() {
  stopProgress();
  cryPlayer.stop();
  setPlayState(false);
  waveCache = null;

  /* ON `answeredAt`, NOT ON `indexOfCurrent + 1` — the getter already answered
   * this question, so adding one to it asks about the question AFTER the one
   * being left, and the round closes one question early. */
  if (state.answeredAt + 1 >= state.questions.length) {
    state.status = 'done';
    state.revealed = true;
    if (state.mode === 'daily') persistDaily();
    const s = scoreRound(state.questions, state.picks);
    lastAnnouncement = `這一輪結束了，${s.correct} / ${s.total} 題答對。`;
    renderAll();
    return;
  }
  state.answeredAt = null;
  state.revealed = false;
  state.eliminated = new Set();
  state.hintUsed = false;
  lastAnnouncement = null;
  renderAll();
  loadWave();
  maybeAutoPlay();
}

/**
 * Where the reader is.
 *
 * **DERIVED FROM THE PICKS, and it is NOT the question they last answered.**
 * After answering, the reader STAYS on that question — they are reading the
 * reveal, and the reveal is the reason they answered. So the getter returns
 * `answeredAt` while it is set, and falls back to 「the first question with no
 * pick yet」 otherwise, which is also what makes a reload resume correctly
 * because `answeredAt` is not persisted and starts null.
 *
 * The first version left this out, and it cost the tenth question of every
 * round. `advance()` asked `indexOfCurrent + 1 >= length`, but answering had
 * already advanced `indexOfCurrent` by writing the pick — so after question 9 of
 * 10 the getter said 9, the test said `10 >= 10`, and the round ENDED. Measured:
 * nine questions played, a result panel reading 「2 / 9」, and a stored round with
 * nine picks and a `null`. Nothing in the static checker can see it: every
 * assertion is about shape, and a round that is one question short is a
 * correctly-shaped round.
 */
Object.defineProperty(state, 'indexOfCurrent', {
  get() {
    if (state.answeredAt != null) return state.answeredAt;
    const i = state.picks.findIndex((x) => x == null);
    return i < 0 ? Math.max(0, state.questions.length - 1) : i;
  },
});

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

async function playCurrent({ fromAutoPlay = false } = {}) {
  const q = state.questions[state.indexOfCurrent];
  if (!q) return;
  stopProgress();
  try {
    await cryPlayer.play(q.answer, {
      legacy: CRY_SET === 'legacy',
      onStart: ({ duration, startedAt }) => {
        setPlayState(true);
        runProgress(startedAt, duration);
      },
    });
  } catch (e) {
    setPlayState(false);
    /* RENDERED, because setting `lastAnnouncement` without a `renderAll()` leaves
     * it sitting in the field until some later render consumes it — so a failed
     * play would surface as a message about a different question, several clicks
     * later. The first version of this catch only assigned, and nothing anywhere
     * said so.
     *
     * AND AN AUTO-PLAY FAILURE FALLS BACK TO SILENCE, not to an error. A
     * background question whose cry 404s or fails to decode should not tell the
     * reader 「可以跳過這一題」 about a question they never chose to play — the
     * auto-play is a convenience, and a convenience that raises an alarm is a
     * second thing to react to. */
    lastAnnouncement = fromAutoPlay
      ? null
      : `這一段叫聲播不出來（${e && e.reason ? e.reason : 'unknown'}），可以跳過這一題。`;
    renderAll();
  }
}

/** `data-state` drives the glyph, so the icon and the state are ONE value. */
function setPlayState(playing) {
  if (playing) els.play.dataset.state = 'playing';
  else delete els.play.dataset.state;
  els.play.setAttribute('aria-label', playing ? '停止播放' : '播放這一段叫聲');
}

function runProgress(startedAt, duration) {
  stopProgress();
  if (!Number.isFinite(duration) || duration <= 0) return;
  const step = () => {
    const t = (cryPlayer.now() - startedAt) / duration;
    els.waveProgress.style.transform = `scaleX(${Math.min(1, Math.max(0, t)).toFixed(4)})`;
    if (t >= 1) {
      stopProgress();
      setPlayState(false);
      els.waveProgress.style.transform = 'scaleX(0)';
      return;
    }
    progressRaf = requestAnimationFrame(step);
  };
  progressRaf = requestAnimationFrame(step);
}

function stopProgress() {
  if (progressRaf) cancelAnimationFrame(progressRaf);
  progressRaf = 0;
}

// ---------------------------------------------------------------------------
// The waveform
// ---------------------------------------------------------------------------

/**
 * Draw the current question's waveform behind the play button.
 *
 * **OFFSCREEN, AND BOUND WITH `const` FROM THE FIRST LINE.** `cries.html`
 * measured this: a couple of hundred vertical strokes redrawn per frame is a
 * different page from one redrawn per question. The first version of this drew
 * into the visible canvas and then "moved it to a cache", which is the order
 * §3.G records `cries.html` getting wrong — `ctx` was rebound mid-function and
 * the next draw threw a TypeError.
 *
 * **COLOUR COMES FROM `getComputedStyle`, READ AT DRAW TIME**, so the wave is
 * legible in both themes without a per-theme rule and without the page having to
 * re-read it on `themechange`. This page has no `themechange` listener because
 * `waveCache` is dropped whenever the question changes and the theme toggle
 * navigates nothing — but a theme flip while a question is on screen leaves the
 * old ink until the next question, which is the honest cost of the cache and the
 * reason the cache is keyed on (question, theme, size) rather than on question
 * alone.
 */
async function loadWave() {
  const q = state.questions[state.indexOfCurrent];
  if (!q || !els.wave) return;
  const id = q.answer;
  const cssW = els.wave.clientWidth || 600;
  const cssH = els.wave.clientHeight || 132;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const theme = document.documentElement.dataset.theme || 'dark';
  const key = `${id}|${CRY_SET}|${cssW}x${cssH}|${dpr}|${theme}`;

  if (waveCache && waveCache.key === key) {
    /* `.canvas`, because `paintWave` takes the element — the cache WRAPPER is
     * what is keyed, the element is what gets blitted, and passing the wrapper
     * is what left the waveform blank on the first run. */
    paintWave(waveCache.canvas);
    return;
  }

  const canvas = els.wave;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  waveCache = null;

  /* SOMETHING ON SCREEN IMMEDIATELY, before the await.
   *
   * Setting `canvas.width` clears the canvas, and `waveformPeaks()` is a fetch
   * plus a decode. Measured across a ten-question round driven as fast as a click
   * allows: questions 1, 5, 8 and 10 had ink and the other six had ZERO — the
   * six being the ones measured before their own decode resolved. A reader
   * arriving at a question is therefore looking at an empty box for as long as a
   * network round trip takes, on every question after the first.
   *
   * So the flat line is drawn FIRST, as a placeholder that is genuinely correct
   * for a silent cry, and overwritten when the peaks arrive. The reference does
   * the same thing with its `M0,0 L100,0` fallback path. */
  const placeholder = document.createElement('canvas');
  placeholder.width = canvas.width;
  placeholder.height = canvas.height;
  {
    const pctx = placeholder.getContext('2d');
    pctx.scale(dpr, dpr);
    pctx.strokeStyle = getComputedStyle(canvas).color || '#888';
    pctx.globalAlpha = 0.3;
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(0, cssH / 2);
    pctx.lineTo(cssW, cssH / 2);
    pctx.stroke();
  }
  paintWave(placeholder);

  let peaks = null;
  let peakError = null;
  try {
    peaks = await cryPlayer.waveformPeaks(id, { legacy: CRY_SET === 'legacy', count: WAVE_BUCKETS });
  } catch (e) {
    peakError = e;
  }

  const cache = document.createElement('canvas');
  cache.width = canvas.width;
  cache.height = canvas.height;
  const ctx = cache.getContext('2d');
  ctx.scale(dpr, dpr);

  const ink = getComputedStyle(canvas).color || '#888';
  const mid = cssH / 2;

  if (peakError || !peaks || !peaks.length) {
    /* A QUESTION WITH NO DECODED WAVE IS STILL PLAYABLE, so the failure draws a
     * flat line and says so rather than leaving an empty box that looks like a
     * page which has not finished loading. */
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(cssW, mid);
    ctx.stroke();
    waveCache = { key, canvas: cache, flat: true };
    paintWave(cache);
    return;
  }

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  const step = cssW / (peaks.length - 1);
  for (let i = 0; i < peaks.length; i++) {
    const x = i * step;
    ctx.moveTo(x, mid - peaks[i] * (cssH / 2 - 6));
    ctx.lineTo(x, mid + peaks[i] * (cssH / 2 - 6));
  }
  ctx.stroke();

  waveCache = { key, canvas: cache, flat: false };
  paintWave(cache);
}

/**
 * Blit a pre-rendered canvas onto the visible one.
 *
 * IT TAKES THE CANVAS ELEMENT, and the first version took the cache WRAPPER and
 * then read `.canvas` off it — so the two call sites disagreed about what they
 * were passing and the waveform drew nothing. Caught by the first browser run,
 * not by the 109 static assertions: 「the wave canvas exists and has a size」 was
 * true, and 「a drawImage was called」 was not anything this checker asks about.
 *
 * `clearRect` first because the wipe overlay is a separate element and the canvas
 * itself is only ever fully replaced.
 */
function paintWave(source) {
  const ctx = els.wave.getContext('2d');
  ctx.clearRect(0, 0, els.wave.width, els.wave.height);
  ctx.drawImage(source, 0, 0);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The one writer of the screen.
 *
 * The ORDER is the contract, and three of the steps are load-bearing:
 *
 *   - `renderFoot()` is LAST. It reads its children's `.hidden`, which the steps
 *     above write. Declared right after one of those writes it read a flag before
 *     its only writer had run, on the paths where that writer was skipped.
 *   - `renderResult()` calls `revealResult()` as its LAST statement, after the
 *     panel has been filled in. §3.G4's rule — re-measure after you write. A
 *     first version measured a half-built panel, which smooth scrolling hid and
 *     `behavior: 'auto'` under reduced motion did not: it landed 37px past the
 *     top of the panel, so the reader's first view of the answer started with the
 *     heading already off-screen.
 *   - `if (!playing) state.eliminated = new Set()` cannot live inside
 *     `renderChoices()`, because `renderResult()` writes the cell grid from the
 *     same round and would then report fewer options than the board shows.
 */
function renderAll() {
  const i = state.indexOfCurrent;
  const q = state.questions[i];
  const playing = state.status === 'playing' && !!q && !state.revealed;

  els.difficultyNote.textContent =
    `${DIFFICULTY_LABELS[state.difficulty]}：${DIFFICULTY_NOTES[state.difficulty]}`;
  renderGenerations();
  renderProgress(q, i);
  renderChoices(q, playing, i);
  renderPlayer(q, playing);
  renderHint(playing);
  renderNext(q, playing);
  renderResult();
  renderFoot();
  lastAnnouncement = null;
  for (const tab of document.querySelectorAll('[data-difficulty]')) {
    const on = tab.dataset.difficulty === state.difficulty;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-checked', String(on));
  }
  for (const tab of document.querySelectorAll('[data-mode]')) {
    const on = tab.dataset.mode === state.mode;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-checked', String(on));
  }
}

/**
 * The generation chips, built ONCE.
 *
 * Built in `init()` rather than per render for the same reason `cries.html` does
 * not re-read the DOM: the chip list is derived from `availableGenerations()`,
 * which is a function of the data, and rebuilding ten buttons on every keystroke
 * of nothing would leave the `is-on` state to be re-applied by hand each time.
 */
function renderGenerations() {
  if (els.genRow.childElementCount === 0) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'cg-gen-btn';
    all.setAttribute('role', 'radio');
    all.setAttribute('aria-checked', 'false');
    all.dataset.gen = '0';
    all.textContent = '全部';
    els.genRow.appendChild(all);
    for (const g of generations) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cg-gen-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.dataset.gen = String(g);
      b.textContent = `第${numeralOf(g)}世代`;
      els.genRow.appendChild(b);
    }
  }
  for (const btn of els.genRow.children) {
    const on = Number(btn.dataset.gen) === state.gen;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', String(on));
  }
}

function renderProgress(q, i) {
  els.progress.textContent = q
    ? `第 ${i + 1} / ${state.questions.length} 題`
    : '';
}

function renderChoices(q, playing, i) {
  if (!q) {
    els.choices.innerHTML = '';
    return;
  }
  const html = q.options.map((id, k) => {
    const p = byId.get(id);
    const types = (p.types || []).map((t) => {
      const hex = TYPE_COLORS[t];
      return hex ? `<span style="background:${hex}"></span>` : '';
    }).join('');
    let cls = 'cg-choice';
    if (state.eliminated.has(k)) cls += ' is-eliminated';
    if (state.revealed) {
      if (id === q.answer) cls += ' is-correct';
      else if (state.picks[i] === id) cls += ' is-wrong';
    }
    const name = state.revealed ? escapeHtml(p.names.zh) : '';
    const typeNames = state.revealed
      ? (p.types || []).map((t) => TYPE_EN_ZH[t] || t).join(' / ')
      : '？';
    return `<button type="button" class="${cls}" data-option="${k}" aria-label="第 ${k + 1} 個選項，#${id}，${typeNames}">
      <img class="cg-choice-sprite" src="${spriteUrl(id)}" alt="" width="96" height="96" loading="lazy" decoding="async">
      <span class="cg-choice-name">${name}</span>
      <span class="cg-choice-id">#${id}</span>
      <span class="cg-choice-types" aria-hidden="true">${types}</span>
    </button>`;
  }).join('');
  els.choices.innerHTML = html;
  for (const btn of els.choices.children) btn.disabled = !playing;
}

/**
 * The status line — and the page's ONLY live region.
 *
 * §3.W's rule: an announcement belongs in a live region, not attached to a part
 * that moves. This page has one (`#cg-player`, `role="status"`), and the round
 * outcome goes into it rather than into the result panel, because the panel sits
 * below the fold and a sighted reader who is moved there still has to be told
 * what happened by the same sentence a blind reader is.
 */
function renderPlayer(q, playing) {
  if (!q) return;
  if (lastAnnouncement) {
    /* ONE WRITER OF THE REGION, and this is it. `answer()` and `advance()` set
     * `lastAnnouncement` as the INPUT and this function is what puts it on
     * screen, so there is exactly one place in the file that writes
     * `els.player.textContent` — `check_cry_game.mjs` counts the write sites and
     * fails on a second, because a live region with two writers loses whichever
     * one rendered last, and a reader loses the one that mattered. */
    els.player.textContent = lastAnnouncement;
    return;
  }
  if (state.status === 'done') {
    const s = scoreRound(state.questions, state.picks);
    els.player.textContent = `這一輪結束了，${s.correct} / ${s.total} 題答對。`;
    return;
  }
  if (playing) {
    els.player.textContent = '按 ▶ 聽叫聲，從四張圖裡選一隻。答不出來可以排除一個選項，每題一次。';
  }
}

function renderHint(playing) {
  setRevealed(els.hintRow, playing);
  els.hintBtn.disabled = !playing || state.hintUsed;
  els.hintBtn.textContent = state.hintUsed ? '這一題已用過提示' : '排除一個選項';
}

/**
 * 「下一題」, and it is the ONLY way forward.
 *
 * The alternative was an automatic advance on a timer, which the reference does
 * not have either. A reader who wants to hear the cry again after answering —
 * which is the most common thing anyone does on this page — would be timed out
 * of doing it, and the answer card would scroll away under them mid-listen.
 * `ArrowRight` is a convenience bound to the same function and is asserted to be
 * nothing else.
 */
function renderNext(q, playing) {
  const answered = !!q && state.revealed && state.status === 'playing';
  setRevealed(els.next, answered);
  els.next.textContent = state.answeredAt != null && state.answeredAt + 1 >= state.questions.length
    ? '看成績' : '下一題';
}

/**
 * The result panel.
 *
 * `revealResult()` is called LAST, here, and nowhere else — see the ordering
 * note on `renderAll()`.
 */
/** The id of the question now on screen, or null before the first is built. */
function currentAnswer() {
  const q = state.questions[state.indexOfCurrent];
  return q ? q.answer : null;
}

function renderResult() {
  /* The dossier link is written on EVERY render, before the early return — it
   * belongs to a resolved question, not to a finished round. Declaring it after
   * the `if (!done) return` is the obvious place and the wrong one: a reader who
   * answers question 4, reloads, and comes back would have no link on the board
   * at all, and nothing anywhere would say why. */
  const revealedAnswer = state.revealed ? currentAnswer() : null;
  if (revealedAnswer != null) {
    els.listen.href = pokemonDetailUrl(byId.get(revealedAnswer));
    els.listen.textContent = `看 #${revealedAnswer} ${byId.get(revealedAnswer).names.zh} 的檔案`;
    setRevealed(els.listen, true);
  } else {
    setRevealed(els.listen, false);
  }

  const done = state.status === 'done';
  setRevealed(els.result, done);
  if (!done) return;

  const s = scoreRound(state.questions, state.picks);
  els.resultTitle.textContent = `${s.correct} / ${s.total}`;
  els.resultBand.textContent = s.band;

  els.grid.innerHTML = state.questions.map((q, i) => {
    const ok = state.picks[i] != null && state.picks[i] === q.answer;
    return `<span class="cg-cell ${ok ? 'is-right' : 'is-wrong'}" title="第 ${i + 1} 題 ${ok ? '答對' : '答錯'}">${ok ? '🟩' : '🟥'}</span>`;
  }).join('');

  els.resultDetail.textContent = `用的是${crySetName()}，題目難度${DIFFICULTY_LABELS[state.difficulty]}，相似度上限 ${
    Number.isFinite(SIMILARITY_CEILING[state.difficulty]) ? SIMILARITY_CEILING[state.difficulty] : '無'
  }。`;

  els.shareText.textContent = shareText({
    questions: state.questions,
    picks: state.picks,
    mode: state.mode,
    difficulty: state.difficulty,
    gen: state.gen,
    dateKey: todayKey(),
  });

  revealResult();
}

/**
 * Take the reader to the result if it is not already in view.
 *
 * It declines to move a viewport that already shows the panel, or one that has
 * scrolled PAST it — that reader found it themselves. It reads
 * `prefers-reduced-motion` AT THE MOMENT of the scroll rather than caching it at
 * boot, because the only other use of that query on this page is a `change`
 * listener and a cached answer would be a second stale thing to keep.
 *
 * It does NOT move focus: focus is still on the button that ended the round, and
 * yanking it to a heading is a louder interruption than the one being fixed.
 */
function revealResult() {
  if (resultRevealed) return;
  resultRevealed = true;
  const box = els.result.getBoundingClientRect();
  if (box.top < window.innerHeight && box.bottom > 0) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.result.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/**
 * The control row, hidden when nothing in it is visible.
 *
 * An OR over `children` rather than a list of the two ids it knows about, so a
 * third control is counted by default rather than by remembering to add it. Its
 * contents are decided EARLIER than this, deliberately: `renderHint` and the
 * `again` line both write `.hidden` above, and a row that reads a flag before its
 * writer has run is visible with nothing in it.
 */
function renderFoot() {
  /* 「再一輪」 IS UNLIMITED-ONLY, and it shows in every state of an unlimited
   * round — while playing AND after the result. Restricting it to 「playing」
   * would take away the one control a reader has at the end of an unlimited
   * round, which is the state they are in when they want it. */
  els.again.hidden = state.mode !== 'unlimited';
  setRevealed(els.targetFoot, [...els.targetFoot.children].some((el) => !el.hidden));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function setMode(mode) {
  const next = mode === 'unlimited' ? 'unlimited' : 'daily';
  if (next === state.mode) return;
  state.mode = next;
  store.set(`${STORE_PREFIX}mode`, next);
  resultRevealed = false;
  if (next === 'daily') restoreDaily() || newRound();
  else newRound();
}

function setDifficulty(difficulty) {
  const next = normalizeDifficulty(difficulty);
  if (next === state.difficulty) return;
  state.difficulty = next;
  store.set(`${STORE_PREFIX}difficulty`, next);
  /* THE DEFAULT FOLLOWS THE DIFFICULTY ONLY WHILE THE READER HAS NOT CHOSEN. */
  if (!state.genTouched) state.gen = DEFAULT_GENERATION[next];
  resultRevealed = false;
  restoreDaily() || newRound();
}

function setGeneration(gen) {
  const next = normalizeGeneration(gen, generations);
  /* `genTouched` IS SET BEFORE THE EARLY RETURN, not after it. Re-clicking the chip
   * that is already selected is a no-op for the pool and is the one moment the
   * reader has unambiguously chosen a generation, so returning first would leave a
   * reader who opened on 簡單 and clicked 第I世代 — which is exactly the default they
   * were given — permanently in the "no choice made" state, and their first real
   * pick of 第六世代 would be treated as the first click rather than the second. */
  state.genTouched = true;
  store.set(`${STORE_PREFIX}genTouched`, true);
  if (next === state.gen) return;
  state.gen = next;
  store.set(`${STORE_PREFIX}gen`, next);
  resultRevealed = false;
  restoreDaily() || newRound();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Three listeners, and two of them are DIRECT on permanent nodes.
 *
 * `#cg-choices` is delegated because its four buttons are re-rendered on every
 * question change and every resolve: a listener bound to a card is bound to a
 * node that is about to be thrown away, and a detached node does not bubble
 * (§3.I). `#cg-play` and `#cg-hint-btn` are direct because neither is ever
 * re-rendered — the play glyph comes from `data-state` and the hint label from
 * `textContent`, precisely so these two can own a permanent node.
 *
 * `check_cry_game.mjs` counts both routes and requires a floor on each, because
 * "there is an `addEventListener` for this id" is not the same claim as
 * "something listens to a node that survives a re-render" — which is the
 * distinction `color-game.mjs` learned by getting it wrong on an improvement.
 */
function wire() {
  els.play.addEventListener('click', () => {
    if (cryPlayer.playing) { stopProgress(); cryPlayer.stop(); setPlayState(false); return; }
    playCurrent();
  });
  els.hintBtn.addEventListener('click', useHint);

  els.choices.addEventListener('click', (e) => {
    const btn = e.target.closest('.cg-choice');
    if (!btn || btn.disabled) return;
    answer(Number(btn.dataset.option));
  });

  document.addEventListener('click', (e) => {
    const modeTab = e.target.closest('[data-mode]');
    if (modeTab) { setMode(modeTab.dataset.mode); return; }
    const diffTab = e.target.closest('[data-difficulty]');
    if (diffTab) { setDifficulty(diffTab.dataset.difficulty); return; }
    const genBtn = e.target.closest('[data-gen]');
    if (genBtn) { setGeneration(Number(genBtn.dataset.gen)); return; }
    if (e.target.closest('#cg-next')) { advance(); return; }
    if (e.target.closest('#cg-again')) { resultRevealed = false; newRound(); return; }
    if (e.target.closest('#cg-share-copy')) { copyShare(); return; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
      e.preventDefault();
      playCurrent();
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); advance(); return; }
    if (e.key === 'h' || e.key === 'H') { useHint(); }
  });

  window.addEventListener('resize', () => {
    waveCache = null;
    loadWave();
  });
}

async function copyShare() {
  const text = els.shareText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.shareCopy.textContent = '已複製';
  } catch (e) {
    /* Clipboard is refused without a real gesture in headless Chrome, so the
     * failure branch is what this checker actually exercises. Selecting the text
     * is the honest fallback, and it is the one a phone reader gets. */
    const range = document.createRange();
    range.selectNodeContents(els.shareText);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    els.shareCopy.textContent = '請手動複製';
  }
  setTimeout(() => { els.shareCopy.textContent = '複製成績'; }, 1800);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Loaded once and kept, because the pools need it on every filter change. */
let POKEMON_DATA = [];

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function init() {
  els.wave = document.getElementById('cg-wave');
  els.waveProgress = document.getElementById('cg-wave-progress');
  els.play = document.getElementById('cg-play');
  els.player = document.getElementById('cg-player');
  els.choices = document.getElementById('cg-choices');
  els.progress = document.getElementById('cg-progress');
  els.difficultyNote = document.getElementById('cg-difficulty-note');
  els.autoplaySlot = document.getElementById('cg-autoplay-slot');
  els.hintRow = document.getElementById('cg-hint-row');
  els.hintBtn = document.getElementById('cg-hint-btn');
  els.genRow = document.getElementById('cg-gen-row');
  els.gen = document.getElementById('cg-gen');
  els.genLabel = document.getElementById('cg-gen-label');
  els.targetFoot = document.getElementById('cg-target-foot');
  els.next = document.getElementById('cg-next');
  els.again = document.getElementById('cg-again');
  els.result = document.getElementById('cg-result');
  els.resultTitle = document.getElementById('cg-result-title');
  els.grid = document.getElementById('cg-grid');
  els.resultBand = document.getElementById('cg-result-band');
  els.resultDetail = document.getElementById('cg-result-detail');
  els.shareText = document.getElementById('cg-share-text');
  els.shareCopy = document.getElementById('cg-share-copy');
  els.listen = document.getElementById('cg-listen');

  try {
    const [data, features] = await Promise.all([
      loadJson('assets/data/pokemon_data.json'),
      loadJson('assets/data/cry_features.json'),
    ]);
    POKEMON_DATA = data;
    byId = new Map(data.map((p) => [p.id, p]));
    index = cryIndex(features, CRY_SET);
    if (!index) throw new Error(`cry_features.json has no "${CRY_SET}" table`);
    generations = availableGenerations(index, data);
  } catch (e) {
    /* The ONE place this file writes the live region directly, and it is the
     * one place a single writer cannot cover: `init()` has no `renderAll()` to
     * call, because nothing has rendered. It is also the only message on the page
     * that is not about a question, so nothing can overwrite it later — the boot
     * failure returns before `wire()` and before any round exists. */
    els.player.textContent = `資料讀取失敗：${e.message}`;
    return;
  }

  state.difficulty = normalizeDifficulty(store.get(`${STORE_PREFIX}difficulty`, state.difficulty));
  state.genTouched = store.get(`${STORE_PREFIX}genTouched`, false) === true;
  /* THE DEFAULT IS APPLIED ONLY ON THE UNTOUCHED PATH, so a reader who chose a
   * generation keeps it even across a difficulty change that happened while they
   * were away. */
  state.gen = state.genTouched
    ? normalizeGeneration(store.get(`${STORE_PREFIX}gen`, 0), generations)
    : DEFAULT_GENERATION[state.difficulty];
  state.mode = store.get(`${STORE_PREFIX}mode`, state.mode) === 'unlimited' ? 'unlimited' : 'daily';

  /* THE SWITCH IS MOUNTED BEFORE THE FIRST ROUND IS DRAWN, because `maybeAutoPlay()`
   * reads `autoplay` and a default-constructed `null` there would mean the very
   * first question never honours the reader's preference — on a page whose
   * preference is stored site-wide by a module that has had this preference since
   * before this page existed. */
  autoplay = mountAutoplay(els.autoplaySlot, {
    className: 'cg-autoplay',
    label: '自動播放',
    hint: '換題時自動播一次',
    onChange: (on) => {
      /* Switching it OFF stops whatever is sounding, copied from
       * `cries-gen1.html`: the control has to mean what its label says at the
       * moment it is pressed, and a switch that turns autoplay off while the
       * current cry keeps playing does not. */
      if (!on) {
        stopProgress();
        cryPlayer.stop();
        setPlayState(false);
      }
      lastAnnouncement = `自動播放已${on ? '開啟' : '關閉'}。`;
      renderAll();
    },
  });

  installUnlock();

  els.genLabel.textContent = '出題範圍';
  setRevealed(els.gen, true);
  setRevealed(els.waveProgress, true);
  els.waveProgress.style.transform = 'scaleX(0)';

  wire();
  if (!restoreDaily()) newRound();
}

init();