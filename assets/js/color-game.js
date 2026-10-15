/**
 * The colour game's state machine. The page's single module entry point.
 *
 *   color-game.html  the only page caller
 *
 * ---------------------------------------------------------------------------
 * This file does three things, and the split is deliberate
 * ---------------------------------------------------------------------------
 *
 * 1. **Arithmetic that can be measured** lives in `game-similarity.js` and
 *    `game-hints.js`. They are pure, so they run to completion in bare Node and
 *    the 101 + 55 assertions measure real output.
 * 2. **This file**: DOM, state, events, localStorage.
 * 3. **`color-game.css`**: appearance. Every rule on the page is `gm-`-prefixed
 *    (§3.B1).
 *
 * ---------------------------------------------------------------------------
 * Three shapes, all inherited from incidents this project already recorded
 * ---------------------------------------------------------------------------
 *
 * **ONE: `hidden` and an author `display` must move together.** `.gm-result` is
 *   `display: flex`, and an author declaration beats the UA sheet's
 *   `[hidden] { display: none }` (§3.M). So the CSS carries
 *   `.gm-result[hidden] { display: none; }` and JS's `setRevealed()` always moves
 *   both. Moving one leaves an empty box on screen, or a hidden panel that still
 *   takes clicks.
 *
 * **TWO: the four slots are in the DOM from the start, not built on the first
 *   guess.** Delegation therefore hits the same nodes every time (§3.G7's
 *   detached node). A guess card produced by a re-render leaves a captured node
 *   outside the tree, a detached node does not bubble, and the click becomes a
 *   silent no-op — which on screen is indistinguishable from "I clicked and
 *   nothing happened".
 *
 * **THREE: a revisit must restore the day's progress.** The daily puzzle lives in
 *   `localStorage` and reloading has to be the same round — otherwise F5 wins the
 *   puzzle a second time, and that is not a fact to leave lying around. A daily
 *   round is locked once finished, so even 「放棄」 cannot reset it.
 */

import { badgeStyle, hexToRgb, pokemonDetailUrl } from './shared.js';
import {
  spriteUrl, artworkUrl, formatShare, formatHex, paletteUrl,
  /* The colour pages' strip width, in COLOURS. The guess row's strip is the same
   * strip as `.cp-strip`, so it takes its count from the same constant rather than
   * carrying a second `5` — §3.B1's rule, and it means one edit changes both. */
  VISIBLE_STRIP_COLORS,
} from './color-palette.js';
import { hexToOklab, deltaEOk } from './color-match.js';
import { taipeiDateKey } from './daily-pick.js';
import {
  MAX_ATTEMPTS, PALETTE_COLORS_SHOWN,
  DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES,
  /* No `poolFor` — it was imported and never called, and `suggestionPool()` reads
   * `genIds` instead. `poolFor()` is the draw's own entry point and it rebuilds the
   * whole generation map on every call, which is fine once per round and wrong once
   * per keystroke. Both still come from `genIdMap`, so this is the cheaper half of
   * one source of truth rather than a second one. */
  variantOf, genIdMap, allIds,
  pickDailyTarget, pickUnlimitedTarget,
  paletteRows, visiblePalette, scoreGuess, tierOf, normalizeDifficulty, normalizeGeneration,
} from './game-similarity.js';
import { MAX_HINTS, hintRevealsPalette, generateHints } from './game-hints.js';
import {
  TIPS, tipAt, typeDelay, randomTipIndex,
  TIP_HOLD_MS, TIP_ERASE_PER_CHAR_MS,
} from './game-tips.js';

const STORE_PREFIX = 'pokemon-colorgame:';

/** Seconds between hints. The reference says 5. */
const HINT_COOLDOWN_S = 5;

/** The round's outcome, in the two channels it is stated in. See `announceResult()`. */
const RESULT_TITLE = { won: '答對了', lost: '這次沒猜到' };

const state = {
  mode: 'daily',
  difficulty: 'easy',
  gen: 1,
  target: null,       // { id, variant }
  guesses: [],        // [{ id, distance, correct, related }]
  status: 'playing',  // 'playing' | 'won' | 'lost'
  hintsShown: [],
  cooldown: 0,
};

let pokemon = [];
let palettes = null;
let byId = new Map();
let genIds = new Map();
let allGenerations = [];

const els = {};
let cooldownTimer = 0;

/**
 * The species the reader CLICKED in the dropdown but has not submitted yet, or null.
 *
 * **A click fills the field; Enter submits.** This is the deliberate asymmetry
 * between the two routes into the field, and it is not arbitrary:
 *
 *   typing -> Enter      ONE step, and unchanged. The reader named the species, so
 *                        the intent is already unambiguous.
 *   click -> Enter       TWO steps. A dropdown row is a small, imprecise target
 *                        (the list is capped at 40), so a click is the LOWEST-intent
 *                        way to choose a species — and it spends one of four
 *                        attempts. Four attempts a day in daily mode.
 *
 * The reference submits on click (`handleSelect` calls `onPokemonSelect` directly,
 * which is `handleGuess`). That is defensible there: it has accounts, a history and
 * a shareable result, so a mis-click is diluted. This page has none of those.
 *
 * It also RESOLVED the datalist problem for free. A native datalist selection fills
 * the field rather than submitting, so before this change the two autocomplete
 * layers behaved differently from each other — the custom row guessed for you and
 * the native one did not. Now both fill, and Enter submits both.
 *
 * Cleared by the `input` listener, because typing after a click is the reader
 * changing their mind.
 */
let pendingPick = null;

/**
 * True between `compositionstart` and `compositionend` on the guess field.
 *
 * **A Chinese or Japanese IME's 選字 key is `Enter`, and it is the SAME key the
 * game submits with.** There was no check for it anywhere in this project: this
 * field read `e.key === 'Enter'` and went straight into the submit chain, so a
 * reader typing 「ㄏㄞˇ」 and pressing Enter to commit 「海」 spent an attempt on
 * whatever the fallback picked — which was #86 小海獅, the first of the 26 species
 * whose name contains 「海」, because `pokemon` is dex order.
 *
 * `KeyboardEvent.isComposing` is the standard signal and is enough on Chrome and
 * Firefox. It is NOT enough on Safari, which reports `isComposing === false` on
 * the keydown that commits the composition — so the flag is tracked from the
 * composition events too, and all three are tested. **The IME keydown must also
 * NOT be `preventDefault()`ed**, or the composition never commits and the reader
 * loses the character outright; that is why this guard returns before the
 * `preventDefault()` below rather than inside the Enter branch.
 *
 * `@type {boolean}`
 */
let composing = false;

/**
 * Has THIS round's result already been REVEALED — announced, and possibly scrolled to?
 *
 * A latch, not a flag read from `state`, because the thing being latched is a
 * one-shot EVENT and `state` cannot say "already revealed". One latch rather than
 * two, because both consequences hang off the same event: a reader who was already
 * looking at the panel still has to be told the round is over.
 *
 * **WHICH HALF OF THIS IS LOAD-BEARING, MEASURED RATHERTHAN ASSUMED.** `renderAll()`
 * has exactly three callers — `newGame()`, `submitGuess()`, `giveUp()` — and after a
 * round ends none of the three can run again: `giveUp()` returns on a status that is
 * not `playing`, `submitGuess()` refuses a finished round, and `newGame()` hides the
 * panel, so `renderResult()` early-returns before reaching this function at all. So
 * the latch itself guards a path that **does not currently exist**: `revealResult()`
 * is reached exactly once per round today. It stays because §3.W's rule is about the
 * re-render, not about today's call graph, and a viewport that moves on a re-render
 * is a defect waiting for whoever adds the fourth caller.
 *
 * **`newGame()`'s reset is the other half, and that one IS load-bearing.** The
 * sequence is a real one: finish an unlimited round (the viewport is parked on its
 * result panel), then switch to a daily that was ALREADY finished — `newGame()`
 * restores that status from storage, `renderResult()` takes the early-return path it
 * takes on a live round, and without the reset the panel would appear 1,248px below
 * a viewport that is still sitting on the PREVIOUS round's panel.
 */
let resultRevealed = false;

/**
 * Take the reader to the round's payoff, which is measured to be OFF-SCREEN.
 *
 * Measured with the document at `scrollY 0`, right after 放棄:
 *
 * |                    | search row (where the eye is) | `#gm-result` top | below the fold by |
 * | ------------------ | ----------------------------: | ----------------: | -----------------: |
 * | desktop 1440 × 900 |                         y 653 |           y 1117 |            217px |
 * | phone     390 × 844 |                         y 791 |           y 1247 |            403px |
 *
 * So a round can end with nothing changing where the reader is looking — and on
 * 放棄 with no guesses at all, NOTHING in view changes: the field greys out and the
 * four slots were already empty. The panel is the only feedback the round produces,
 * and it was 217px and 403px off-screen.
 *
 * **THREE THINGS THIS IS NOT, each of which is the way the obvious version goes
 * wrong.**
 *
 *   - **It does not move a reader already looking at it.** The test is the panel's
 *     own box, measured at the moment of the call. A scroll that lands nowhere reads
 *     as the page seizing up, which is worse than not scrolling — and "already on
 *     screen" includes the reader having scrolled PAST it, which is them having
 *     found it themselves.
 *   - **It is not smooth when the reader asked for less motion.** §3.C: `smooth`
 *     becomes `auto` under `prefers-reduced-motion`. The query is read HERE, at the
 *     moment of the scroll, rather than cached at boot — `initTip()`'s copy exists
 *     because it needs a `change` LISTENER and re-enters a half-typed sentence; a
 *     one-shot read has no reason to hold a second stale copy of the answer.
 *   - **It does not move focus.** Focus is on a disabled input by this point, and
 *     yanking it to a heading would be a louder interruption than the one being
 *     fixed.
 *
 * **AND IT SAYS SO OUT LOUD, which is the same event seen from the other side.**
 * The panel is a plain `<section>`: a screen-reader user browsing the page finds it
 * by going looking for it, and nothing tells them it appeared. `#gm-search-status` is
 * already a `role="status" aria-live="polite"` region — the page's one visible status
 * line — so the round's outcome is announced there, in the channel the reader is
 * already listening to, rather than in a third region that would then talk over this
 * one.
 *
 * **TWO THINGS THAT ARE NOT SYMMETRIC, and both were measured rather than reasoned.**
 * It is announced whether or not the viewport moves: the round ending is news
 * either way, and making the utterance conditional on a scroll would tie a screen
 * reader's feedback to a layout question. And it is announced on a RESTORED round
 * too — arriving at today's daily that you already finished is exactly when 「這次沒
 * 猜到，答案是 X。」 is the most useful sentence the page could say.
 */
function revealResult() {
  if (resultRevealed) return;
  resultRevealed = true;
  announceResult();
  const box = els.result.getBoundingClientRect();
  const aboveFold = box.top < window.innerHeight;
  const scrolledAway = box.bottom <= 0;
  if (aboveFold && !scrolledAway) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.result.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/**
 * Say the round's outcome into the page's one live region.
 *
 * **WHY THIS REGION AND NOT A NEW ONE.** `#gm-search-status` is a
 * `role="status" aria-live="polite"` region and is already where the page says what
 * just happened — 找不到「…」, 本回合只從第 I 世代出題, 成績已複製. A round ending is the
 * largest thing that ever happens on this page, and a dedicated `.sr-only` region for
 * it would mean the one message a screen-reader user cannot afford to miss is the
 * only one they have to go looking for. It reuses `#gm-tip-live`'s reasoning — an
 * announcement belongs in a live region, not attached to a moving part — and the
 * page already has one of those, so this is the second and not the third.
 *
 * **THE TITLE IS SHARED, not retyped.** The panel's heading and this sentence are
 * the same claim in two channels, so both read `RESULT_TITLE`; §3.B1's rule is that
 * two copies of one string is a second thing to keep right rather than a comparison.
 *
 * **SHORT ON PURPOSE.** A `role="status"` region is read verbatim, so this is the
 * round's outcome and the answer — nothing else. The distance, the attempt count and
 * the hint count are all in the panel the reader is being scrolled to, and adding
 * them here would make the one utterance that has to land the one that is longest.
 */
function announceResult() {
  const t = byId.get(state.target.id);
  if (!t) return;
  els.searchStatus.textContent = `${RESULT_TITLE[state.status]}。答案是 ${t.names.zh}${variantSuffix()}。`;
}

/** The target's variant marker — shared by the panel's answer line and the announcement. */
function variantSuffix() {
  return state.target && state.target.variant === 's' ? '（異色）' : '';
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  },
  remove(key) {
    try { localStorage.removeItem(STORE_PREFIX + key); } catch (e) { /* private mode */ }
  },
};

/**
 * The daily key carries the tier and the generation, so 「簡單 × 第一世代」 and
 * 「困難」 are two different puzzles with two different scores. That matches the
 * reference's (date, difficulty); this project has one extra dimension because an
 * easy puzzle is determined by its generation in the first place.
 */
const dailyKey = (difficulty, gen) => `daily:${difficulty}:${difficulty === 'easy' ? gen : 'all'}`;

// ---------------------------------------------------------------------------
// Target draw
// ---------------------------------------------------------------------------

function currentTarget() {
  if (state.mode === 'daily') return pickDailyTarget(state.difficulty, state.gen, pokemon);
  return pickUnlimitedTarget(state.difficulty, state.gen, pokemon);
}

function newGame({ keepTarget = false } = {}) {
  stopCooldown();
  /* A new round cannot inherit a half-chosen species from the previous one: the
   * armed pick refers to a round that no longer exists, and Enter after a reset
   * would submit it. */
  pendingPick = null;
  /* Same lifetime as `pendingPick`, and for a related reason: both are per-ROUND
   * latches about something that happened once. Without the reset, 下一題 would hand
   * the next round a viewport already parked on the PREVIOUS round's result panel
   * and refuse to move — `revealResult()` reads the box first and sees a panel that
   * is on screen, so the latch has to be the thing that says "not yet". */
  resultRevealed = false;
  if (!keepTarget || !state.target) {
    state.target = currentTarget();
    state.guesses = [];
    state.hintsShown = [];
    state.status = 'playing';
  }
  if (state.mode === 'daily') {
    // A daily puzzle is restored from storage, never regenerated: reloading must
    // not hand out a second attempt at the same answer.
    const saved = store.get(dailyKey(state.difficulty, state.gen), null);
    if (saved && saved.date === todayKey() && Array.isArray(saved.guesses)) {
      restore(saved);
    } else {
      persistDaily();
    }
  }
  renderAll();
}

function todayKey() {
  return taipeiDateKey(new Date());
}

function persistDaily() {
  store.set(dailyKey(state.difficulty, state.gen), {
    date: todayKey(),
    target: state.target,
    guesses: state.guesses.map((g) => g.id),
    hints: state.hintsShown.length,
    status: state.status,
  });
}

function restore(saved) {
  state.target = saved.target;
  state.guesses = [];
  state.hintsShown = [];
  state.status = saved.status === 'playing' ? 'playing' : saved.status;
  const limit = attemptLimit();
  for (const id of (saved.guesses || []).slice(0, limit)) state.guesses.push(scoreOne(id));
  // Hints already spent are restored as SPENT but not re-shown: the reader paid
  // the cooldown for them and re-granting it would be a free re-roll.
  state.hintsShown = generateHintsForTarget().slice(0, saved.hints || 0);
}

function attemptLimit() {
  return state.mode === 'daily' ? MAX_ATTEMPTS : Infinity;
}

// ---------------------------------------------------------------------------
// Guessing
// ---------------------------------------------------------------------------

/** How two species relate. This feeds hint dedup, so it must match the badges on the card. */
function relatedness(guessId, targetId) {
  const g = byId.get(guessId);
  const t = byId.get(targetId);
  if (!g || !t) return { sharedTypes: [], sameEvolutionFamily: false, generationIds: [] };
  const targetTypes = new Set((t.types_zh || t.types || []).map((x) => String(x).toLowerCase()));
  const sharedTypes = (g.types_zh || g.types || []).filter((x) => targetTypes.has(String(x).toLowerCase()));
  return {
    sharedTypes,
    // `evolution_chain_id` equality, NOT the chain's `stage`. §3.K's record: a
    // branching family is stored there as one linear `main_line`, and `stage` is
    // dex order.
    sameEvolutionFamily: g.id !== t.id && g.evolution_chain_id === t.evolution_chain_id,
    generationIds: [Number(g.generation)],
  };
}

function scoreOne(guessId) {
  const targetId = state.target.id;
  const correct = guessId === targetId;
  const d = correct ? null : scoreGuess(palettes, targetId, guessId, state.target.variant);
  return { id: guessId, distance: d ? d.score : null, correct, related: relatedness(guessId, targetId) };
}

function submitGuess(id) {
  if (state.status !== 'playing' || !state.target) return false;
  if (state.guesses.some((g) => g.id === id)) return false;   // a repeat guess is ignored silently
  if (attemptLimit() !== Infinity && state.guesses.length >= attemptLimit()) return false;

  const guess = scoreOne(id);
  state.guesses.push(guess);

  if (guess.correct) {
    state.status = 'won';
  } else if (state.guesses.length >= attemptLimit()) {
    state.status = 'lost';
  }
  if (state.mode === 'daily') persistDaily();
  renderAll();
  return true;
}

function giveUp() {
  if (state.status !== 'playing') return;
  state.status = 'lost';
  /* Daily ONLY, and it has to be said here rather than left to `giveUp()`'s caller.
   *
   * `persistDaily()` has no mode check of its own — it writes to
   * `dailyKey(difficulty, gen)` unconditionally. That was safe while giving up was
   * DAILY-ONLY, because the mode gate below meant unlimited could never reach this
   * line. Removing that gate without adding this one would write an unlimited round
   * into today's store, and `newGame()`'s `restore()` would then read it back as the
   * day's puzzle: a free answer, silently, on the next visit. Same shape as §3.G6,
   * where one field's writer was read by another page's state.
   *
   * The reference draws the line in the same place — `handleGiveUp` at
   * `pokemonpalette/src/app/game/page.tsx:1808` has no mode guard either, and its
   * `saveGameAttempt` call is wrapped in `if (mode === "daily")`. */
  if (state.mode === 'daily') persistDaily();
  renderAll();
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

function generateHintsForTarget() {
  const t = byId.get(state.target.id);
  return t ? generateHints(t) : [];
}

/** Whether the bar has expanded, from the slot that owns it. */
function paletteRevealed() {
  return state.hintsShown.some((_, i) => hintRevealsPalette(i));
}

/** Evolves IFF this id is a key of the edge list. `levels` + `unlevelled`. */
/* evolution_levels.json is NOT loaded.
 *
 * It was, and `evolvesOf()` gated the third hint on it. The evolution hint is
 * gone — slot 2 is now the full palette — so the table had no reader, the fetch
 * was still on every page load, and the function was still in the module.
 * Both are removed rather than left dormant: an unused export is a second thing
 * to keep right, and life.html owns this table for the page that actually
 * evolves something. */

// ---------------------------------------------------------------------------
// The rotating tip line
// ---------------------------------------------------------------------------

/**
 * A typewriter that cycles the tips under the input, and that is allowed to be a
 * typewriter at all.
 *
 * Four things here are requirements rather than styling, and each one has a failure
 * mode that looks fine on screen:
 *
 * **THE VISIBLE TEXT IS `aria-hidden`.** It is written one character at a time, so
 * a screen reader that watched the live region would read every keystroke aloud
 * instead of the sentence. The full sentence goes into a `.sr-only` `aria-live`
 * region instead, and that region is updated ONLY when a new tip starts — so each
 * tip is announced once, as a line. Both regions are in the markup, not created
 * here, so the split is visible to a checker reading the HTML.
 *
 * **REDUCED MOTION GETS WHOLE SENTENCES.** No typing, no erasing, and the caret
 * stops blinking — it becomes a static character rather than disappearing, because
 * a caret that vanishes reads as a rendering failure. The media query is read at
 * mount AND re-read on change, so toggling the OS setting takes effect without a
 * reload; `model3d-viewer.js` and `shared.js` each read it once inline and this is
 * the third site, which is worth a shared helper someday and not worth coupling
 * this change to that refactor now.
 *
 * **IT PAUSES WHEN THE TAB IS HIDDEN.** A background tab still runs timers, so a
 * reader who switches away for a minute comes back mid-sentence. The cooldown timer
 * above has its own `visibilitychange` listener for the same reason; two listeners
 * on one event for two independent features is not shared state.
 *
 * **THE TOTAL TYPING TIME IS CAPPED**, by `typeDelay()` in the module — one CJK
 * character is a full-width glyph and costs more wall time than a Latin one, so an
 * uncapped per-character delay would make the long tips visibly slower.
 */
let tipTimer = null;
let tipPhase = 'holding';
let tipIndex = 0;
let tipPos = 0;
let tipVisible = true;
let tipReduced = false;

function stopTip() {
  if (tipTimer !== null) { clearTimeout(tipTimer); tipTimer = null; }
}

function scheduleTip(ms, fn) {
  stopTip();
  tipTimer = setTimeout(fn, ms);
}

/** Move to the next tip and announce the WHOLE of it, once. */
function advanceTip() {
  tipIndex = (tipIndex + 1) % TIPS.length;
  els.tipLive.textContent = `提示：${tipAt(tipIndex)}`;
}

function eraseTip() {
  if (!tipVisible) return;
  tipPhase = 'erasing';
  if (tipPos <= 0) {
    advanceTip();
    tipPos = 0;
    tipPhase = 'typing';
    els.tipText.textContent = '';
    /* One short delay so the empty caret gets a frame before typing starts. */
    scheduleTip(TIP_ERASE_PER_CHAR_MS, typeTip);
    return;
  }
  tipPos -= 1;
  els.tipText.textContent = tipAt(tipIndex).slice(0, tipPos);
  scheduleTip(TIP_ERASE_PER_CHAR_MS, eraseTip);
}

function typeTip() {
  if (!tipVisible) return;
  tipPhase = 'typing';
  const tip = tipAt(tipIndex);
  if (tipPos >= tip.length) {
    tipPhase = 'holding';
    els.tipText.textContent = tip;
    scheduleTip(TIP_HOLD_MS, eraseTip);
    return;
  }
  tipPos += 1;
  els.tipText.textContent = tip.slice(0, tipPos);
  scheduleTip(typeDelay(tip.length), typeTip);
}

/** One step, honouring reduced motion by swapping whole sentences. */
function tickTip() {
  if (!tipVisible) return;
  if (tipReduced) {
    tipPos = tipAt(tipIndex).length;
    tipPhase = 'holding';
    els.tipText.textContent = tipAt(tipIndex);
    scheduleTip(TIP_HOLD_MS, () => { advanceTip(); tickTip(); });
    return;
  }
  if (tipPhase === 'holding') { tipPhase = 'erasing'; scheduleTip(TIP_HOLD_MS, eraseTip); return; }
  if (tipPhase === 'erasing') { eraseTip(); return; }
  typeTip();
}

function initTip() {
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  tipReduced = mql.matches;
  mql.addEventListener('change', (e) => {
    tipReduced = e.matches;
    /* Re-enter the loop so the new branch is taken from the current sentence, not
     * from a half-typed one left over from the other branch. */
    if (tipVisible) { stopTip(); tipPos = tipAt(tipIndex).length; tickTip(); }
  });

  /* A random starting tip. `randomTipIndex()` lives in game-tips.js rather than
   * here, so this file keeps zero `Math.random` and the checker's seeded-daily-draw
   * assertion stays at full strength instead of growing an exemption. Cosmetic, so
   * it is NOT part of the daily state and nothing persists it. */
  tipIndex = randomTipIndex();
  tipPos = tipAt(tipIndex).length;
  tipPhase = 'holding';
  els.tipText.textContent = tipAt(tipIndex);
  els.tipLive.textContent = `提示：${tipAt(tipIndex)}`;

  tipVisible = document.visibilityState === 'visible';
  if (tipVisible) tickTip();

  document.addEventListener('visibilitychange', () => {
    const next = document.visibilityState === 'visible';
    if (next === tipVisible) return;
    tipVisible = next;
    if (next) tickTip(); else stopTip();
  });
}

function revealHint() {
  if (state.status !== 'playing' || state.cooldown > 0) return;
  const all = generateHintsForTarget();
  if (state.hintsShown.length >= MAX_HINTS) return;
  // Never re-show: the earlier hints were shuffled with the same seed, so index
  // `length` is the next one that was not on screen. (restart-safe)
  const next = all[state.hintsShown.length];
  if (!next) return;
  const wasFirst = state.hintsShown.length === 0;
  state.hintsShown.push(next);
  /* The FIRST hint is free; hints 2 and 3 each start a cooldown.
   *
   * Free-first is the whole point of the change and it is a deliberate asymmetry.
   * A hint exists for the reader who knows nothing yet, so gating the first one
   * behind a guess inverts what the button is for — and the gate was invented
   * during the port, not ported: the reference disables its hint button only on
   * `!targetPokemon || revealedHints.length >= 3 || hintCooldown > 0`.
   *
   * Only the first is free. The reader gets one click with no friction, and every
   * one after it has to wait five seconds, so the three hints are not three
   * seconds of holding down a button. Five seconds is not an anti-cheat — it is
   * long enough that you look at what you already have, which is the entire
   * reason to space the reveals. */
  if (!wasFirst) {
    state.cooldown = HINT_COOLDOWN_S;
    startCooldown();
  }
  if (state.mode === 'daily') persistDaily();
  renderHints();
  renderPalette();
}

function startCooldown() {
  stopCooldown();
  cooldownTimer = setInterval(() => {
    state.cooldown -= 1;
    if (state.cooldown <= 0) { state.cooldown = 0; stopCooldown(); }
    renderHints();
  }, 1000);
}

function stopCooldown() {
  if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = 0; }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCooldown();
});

// ---------------------------------------------------------------------------
// Share text
// ---------------------------------------------------------------------------

const TIER_EMOJI = { close: '🟩', mid: '🟨', far: '🟧', miss: '🟥' };
const TIER_LABEL = { close: '接近', mid: '普通', far: '偏遠', miss: '差很遠' };

/**
 * Each cell is the smallest OKLab distance between one of the target's top 3
 * colours and the WHOLE of the guessed palette.
 *
 * This differs from the reference, which compares the target's i-th colour to the
 * guess's i-th colour. That is wrong: a palette is a SET of six, so the question
 * the reader is really asking is 「有沒有出現我的色盤裡」, and cell-by-cell makes a
 * guess that fully contains the primary look like a poor one.
 */
function shareRows() {
  const target = visiblePalette(palettes, state.target.id, state.target.variant, true).slice(0, PALETTE_COLORS_SHOWN);
  return state.guesses.map((guess) => {
    const rows = paletteRows(palettes, guess.id, state.target.variant);
    return target.map((entry) => {
      if (!rows.length) return TIER_EMOJI.miss;
      let best = Infinity;
      for (const r of rows) {
        const d = oklabDelta(entry.hex, r.hex);
        if (d < best) best = d;
      }
      return TIER_EMOJI[tierOf(best)];
    }).join('');
  });
}

/** OKLab distance between two hexes. Uses the exported operators; not re-implemented. */
function oklabDelta(a, b) {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  if (!la || !lb) return Infinity;
  return deltaEOk(la, lb);
}

function shareText() {
  const rows = shareRows();
  const attempted = state.mode === 'daily'
    ? Math.min(state.guesses.length, MAX_ATTEMPTS)
    : state.guesses.length;
  const mark = state.status === 'won' ? `${attempted}/${state.mode === 'daily' ? MAX_ATTEMPTS : attempted}` : 'X';
  const variant = state.target.variant === 's' ? ' · 異色' : '';
  const head = `寶可夢演算法 猜謎${variant} · ${DIFFICULTY_LABELS[state.difficulty]} · ${mark}`;
  const hints = state.hintsShown.length ? `（${state.hintsShown.length} 則提示）` : '';
  const legend = '圖例：🟩 接近 · 🟨 普通 · 🟧 偏遠 · 🟥 差很遠';
  const blank = (state.mode === 'daily' ? MAX_ATTEMPTS : attempted) - attempted;
  const padded = [...rows, ...Array(Math.max(0, blank)).fill('⬜⬜⬜')];
  return [head + hints, ...padded, legend].join('\n');
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * The same matching as pokedex.html: national dex number, zh (incl. HK), en, ja.
 * The ordering is not reinvented here but copied from those four fields — a
 * divergence would make two pages suggest different species for the same
 * keystrokes, and there is no reason for that.
 */
/**
 * Is the suggestion list currently on screen?
 *
 * `hidden` and not `display`, because `renderSearchResults()` returns early in
 * several places and leaves the previous `innerHTML` in place — so "are there rows
 * in the DOM" is not "is there a list for the reader to choose from". Both are
 * written together by `setRevealed()` (§3.M).
 *
 * @returns {boolean}
 */
function listIsOpen() {
  return !els.searchList.hidden;
}

/**
 * The single row left to choose from, or null.
 *
 * One candidate means the choice is already made: 「海星星」 matches exactly one
 * species, so Enter there is the reader naming their answer rather than picking
 * among options, and demanding a second Enter would only be ceremony. Zero or two
 * or more means a real decision, and Enter SELECTS instead (§ the keydown handler).
 *
 * Already-guessed rows are excluded because `chooseFromSearch()` refuses them, so
 * counting them would offer to "select" a row that then says 已經猜過了.
 *
 * @returns {number|null} dex id, or null when there is no single candidate
 */
function soleCandidate() {
  if (!listIsOpen()) return null;
  const rows = els.searchList.querySelectorAll('.gm-search-item:not(.is-used)');
  return rows.length === 1 ? Number(rows[0].dataset.id) : null;
}

/**
 * The 作答 button: visible only when there is something to submit.
 *
 * It exists because a click fills the field and ENTER submits, and **a phone has no
 * Enter key.** Tapping a suggestion row put the name in the box, closed the list, and
 * printed 「按 Enter 作答」 to a reader with no way to do that — on iOS the search key
 * fires `Enter` and it happens to work, and on much of Android there is nothing to
 * press. The whole two-step flow was unreachable by touch, which is the half of a
 * page where autocomplete matters most.
 *
 * DISABLED rather than hidden while the round is over, so it cannot go from
 * actionable to inert without the reader seeing why: a button that vanishes on the
 * guess that won the game is a worse ending than one that greys out.
 *
 * Enabled by `canSubmit()`, never by "the field is non-empty" on its own — the same
 * answer the Enter key gets, so the two routes cannot disagree about whether this
 * round is still playable. That is why this asks the SAME three questions the
 * keydown handler asks, in the same order: an armed pick, then a sole candidate,
 * then a whole name. "Non-empty" was the fourth reading and it was wrong twice
 * over — it lit the button while the list was open with 26 rows and nothing chosen
 * (a tap would have to guess one), and it lit it for a query that matched nothing.
 */
function canSubmit() {
  if (state.status !== 'playing' || !state.target) return false;
  if (pendingPick != null) return true;
  if (soleCandidate() != null) return true;
  return !listIsOpen() && resolveExact(els.search.value) != null;
}

function renderSubmit() {
  els.submit.hidden = !canSubmit();
  els.submit.disabled = !canSubmit();
}

/**
 * The species the SUGGESTION LIST may show, in easy mode.
 *
 * In easy mode the round is drawn from one generation, so a suggestion from
 * another one is an answer the reader cannot act on — it would be a row that
 * fills the field and then cannot be the target. The reference does the same
 * thing and only for unlimited mode (`selectedGenerations={mode === "unlimited"
 * ? … : undefined}`); here it is wired to whichever generation is selected.
 *
 * A Set, rebuilt per call, over at most ~151 ids. `poolFor()` would be the reuse —
 * it is already imported and already the source of the draw — but it calls
 * `genIdMap(data)` internally and rebuilds the whole map, and this runs on EVERY
 * keystroke. `genIds` is that same map, built once in `init()`, so it is the
 * cheaper half of one source of truth rather than a second one.
 */
function suggestionPool() {
  if (state.difficulty !== 'easy') return null;
  return new Set(genIds.get(state.gen) || []);
}

function searchMatches(q, { ignorePool = false } = {}) {
  const text = q.trim().toLowerCase();
  if (!text) return [];
  const pool = ignorePool ? null : suggestionPool();
  const out = [];
  for (const p of pokemon) {
    if (pool && !pool.has(p.id)) continue;
    const n = p.names || {};
    const idHit = String(p.id).includes(text);
    const zhHit = (n.zh || '').toLowerCase().includes(text);
    const hkHit = (n.zh_HK || '').toLowerCase().includes(text);
    const enHit = (n.en || '').toLowerCase().includes(text);
    const jaHit = (n.ja || '').includes(q.trim());
    if (idHit || zhHit || hkHit || enHit || jaHit) out.push(p);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Resolve a typed string to exactly ONE species, by whole name or whole number.
 *
 * This is the fallback behind Enter, and it exists for the reader the design
 * actually serves: someone who knows it is 妙蛙種子 and cannot type it perfectly.
 * The substring scan usually finds them anyway (it matches on any two characters),
 * so this only fires where that did not — a paste, a name whose characters are
 * scattered, or a list capped at 40.
 *
 * Whole-string only, deliberately. A fuzzy match here would guess on a typo and
 * then submit it, and a wrong guess costs one of four attempts. Returning null
 * and saying so costs nothing.
 *
 * @returns {{id:number}|null} null when it is zero or more than one match
 */
function resolveExact(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const id = Number(text);
  const hit = Number.isInteger(id) && String(id) === text ? byId.get(id) : null;
  if (hit) return { id: hit.id };
  const exact = pokemon.filter((p) => {
    const n = p.names || {};
    return (n.zh || '').toLowerCase() === text || (n.zh_HK || '').toLowerCase() === text
      || (n.en || '').toLowerCase() === text;
  });
  return exact.length === 1 ? { id: exact[0].id } : null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function setRevealed(node, on) {
  // §3.M: the attribute AND the author display, together, every time.
  node.hidden = !on;
  node.style.display = on ? '' : 'none';
}

/**
 * The target's palette bar.
 *
 * TWO INDEPENDENT QUESTIONS, and conflating them is the whole hazard here:
 *
 *   `revealed` — how MANY swatches. 3 to begin with, all six after hint 2.
 *   `showText`  — whether each swatch PRINTS its hex and its share.
 *
 * They were one flag, and that is wrong in a way that renders plausibly: hint 2
 * arrives DURING play, so a shared condition would light the numbers up on the
 * second hint and leave them on for the rest of the round. That is the same shape
 * as `hintRevealsPalette` silently keeping its old index — a stale `2` and a stale
 * `1` both produce something that looks fine.
 *
 * `showText` is `status !== 'playing'` and nothing else: won or given up. The reason
 * the text is worth hiding is that **the share IS the pixel share and the WIDTH
 * already says so** — a wider block simply is more of the sprite. Printing the
 * number during play repeats what the eye already got. At the end it becomes a
 * readable summary of a quantity you had to estimate, which is the moment a number
 * earns its place.
 *
 * The `title` tooltip stays in BOTH states. It appears on hover, so it is not
 * printed on the bar, and it is the one place a sighted reader can read a number
 * mid-game.
 *
 * The aria-label carries every share, and this is not a nicety. A width is
 * invisible to a screen reader, so removing the printed numbers without moving
 * them into the label would delete the information for every non-visual reader —
 * trading a sighted reader's redundancy for a blind reader's loss. §3.C's rule
 * applies: colour must never be the only channel.
 */
function renderPalette() {
  const box = els.palette;
  const revealed = paletteRevealed() || state.status !== 'playing';
  const showText = state.status !== 'playing';
  setRevealed(els.paletteEmpty, false);
  if (!state.target) return;
  const rows = visiblePalette(palettes, state.target.id, state.target.variant, revealed);

  box.classList.toggle('is-detailed', showText);
  box.setAttribute('aria-label',
    `目標寶可夢的色帶：${rows.map((r) => `${formatHex(r.hex)} ${formatShare(r.share)}`).join('，')}`
    + `。共 ${rows.length} 色${revealed ? '' : '，還有更多顏色未顯示'}`);

  box.innerHTML = rows.map((row) => {
    const rgb = hexToRgb(row.hex);
    const ink = badgeStyle(rgb);
    const grow = row.share > 0 ? row.share : 1;
    const detail = showText
      ? `<span class="gm-swatch-share">${formatShare(row.share)}</span>
         <span class="gm-swatch-hex">${formatHex(row.hex)}</span>`
      : '';
    return `<div class="gm-swatch" style="flex:${grow} 1 0;${ink}"
                 title="${formatHex(row.hex)} · ${formatShare(row.share)}">${detail}</div>`;
  }).join('');
}

/**
 * The hint row: the revealed hints, and the button that reveals the next one.
 *
 * Two things about the button's shape are the reference's, not mine. It is
 * enabled from the first paint with nothing guessed — the reference's own comment
 * says the row stays mounted "so the row reserves its height on the first
 * paint", i.e. it is meant to be a stable affordance, not a reward for playing —
 * and it sits on its OWN row under the hints, right-aligned, rather than trailing
 * the hint chips. On a chip row it would sit immediately after a hint that can be
 * forty characters long, so its position would move every time one appeared.
 *
 * `state.guesses.length === 0` used to be in the disabled condition. It was
 * added during the port, the reference does not have it, and it protected
 * nothing: hints do not consume an attempt (`guesses` and `hintsShown` are
 * separate counters) and the count is printed in three places — localStorage, the
 * share string's 「（N 則提示）」 and the result panel — so a three-hint round with
 * no guesses reads exactly as loudly as one with four.
 */
function renderHints() {
  const box = els.hints;
  const spent = state.hintsShown.length;
  const total = spent >= MAX_HINTS;
  const cooling = state.cooldown > 0;

  box.innerHTML = state.hintsShown.map((h, i) =>
    `<span class="gm-hint"><span class="gm-hint-index">${i + 1}</span>${escapeHtml(h)}</span>`).join('');

  /* The chip row is hidden outright before the first hint, rather than kept at a
   * `min-height`. The reserved space was 34px plus a 12px gap, and the hint BUTTON
   * is mounted either way — so the card looked as though something was missing from
   * it. `setRevealed` rather than a direct write: `.gm-hints` is `display: flex`
   * from an author rule, so `hidden` alone loses and leaves an empty 34px box
   * (§3.M's shape). */
  setRevealed(els.hints, spent > 0);

  els.hintRow.hidden = total;
  if (total) {
    /* The button is disabled as well as hidden, because `hidden` is the row's
     * business and `disabled` is the button's. Leaving the button enabled and
     * still reading 再看一則提示 is a lie that is invisible today and true the day
     * anything unhides the row — and `revealHint()`'s own `length >= MAX_HINTS`
     * guard is not a substitute, because the label and the disabled attribute are
     * what the reader (and the next checker) reads. */
    els.hintBtn.disabled = true;
    els.hintBar.hidden = true;
    els.hintBar.style.transform = 'scaleX(0)';
    stopCooldown();
    return;
  }

  els.hintBtn.disabled = state.status !== 'playing' || cooling;
  /* The LABEL's text only. This was `els.hintBtn.innerHTML = ...`, which is
   * §3.I: writing the button's markup destroys the cooldown bar that lives inside
   * it, so `els.hintBar` was a detached node from the first render onward and
   * every `hidden` and `scaleX` after that went to a node no longer in the tree.
   * The bar never appeared — the same silent failure as `graph-header.js`
   * rewriting its own button and the click reading as outside, except this one
   * threw nothing and logged nothing. */
  const label = spent === 0 ? '看一則提示' : '再看一則提示';
  els.hintLabel.textContent = cooling ? '提示冷卻中' : label;
  els.hintBtn.setAttribute('aria-label', cooling ? '提示冷卻中' : label);

  /* The progress bar is a child of the button and is scaled by the REMAINING
   * fraction, so it drains left-to-right. It is left in the DOM while cooling and
   * removed after, rather than the reverse: a bar at scaleX(0) and a bar that is
   * not in the document are different things, and only one of them has a box. */
  els.hintBar.hidden = !cooling;
  els.hintBar.style.transform = cooling
    ? `scaleX(${(state.cooldown / HINT_COOLDOWN_S).toFixed(3)})`
    : 'scaleX(0)';
}

function renderSlots() {
  const limit = state.mode === 'daily' ? MAX_ATTEMPTS : MAX_ATTEMPTS;
  const used = new Set(state.guesses.map((g) => g.id));
  const rows = [];
  for (let i = 0; i < limit; i++) {
    const g = state.guesses[i];
    if (!g) {
      /* A NEUTRAL placeholder, and it used to carry a real sprite.
       *
       * It was `padId(i + 1)` — dex #1, #2, #3, #4 — so the four empty slots showed
       * Bulbasaur, Ivysaur, Venusaur and Charmander. Two separate problems, and
       * fixing only the obvious one makes it worse:
       *
       *   1. This project's sprites are named UNPADDED (`1.png`, `2.png`,
       *      `10.png`), so `padId(i + 1)` produced `002.png` and every empty slot
       *      was a BROKEN IMAGE. Caught by looking, not by the checker.
       *   2. Had the path been corrected to `spriteUrl(i + 1)`, the slots would show
       *      the real #1-#4 and read as four guesses already made.
       *
       * The reference renders its empty slots as skeleton blocks — a muted square,
       * two muted bars, no image and no text. That is what this is now: an empty
       * dashed square where the sprite sits, and the attempt number beside it. */
      rows.push(`<li class="gm-slot is-empty" aria-hidden="true">
        <span class="gm-slot-placeholder"></span>
        <div class="gm-slot-body"><span class="gm-slot-empty-text">第 ${i + 1} 次機會</span></div>
      </li>`);
      continue;
    }
    const p = byId.get(g.id);
    /* The strip is the HORIZONTAL five-colour one, not the target bar's three.
     *
     * It used to be `visiblePalette(..., false)`, which is the PLAYING count — 3 —
     * because the reference's GuessCard stacks all `PALETTE_COLORS_COUNT` (3)
     * vertically in a 64px column (`pokemonpalette/src/components/guess-card.tsx:101`).
     * That was a faithful port and it is not what this row wants now: the row is
     * full-width, so a 56px vertical strip reads as a chip rather than as the
     * species' palette, and three of six colours is a worse answer to 「我猜的是
     * 什麼顏色」 than five.
     *
     * EQUAL cells, not proportional, and `.cp-strip` is the reason: a 3% colour in a
     * proportional strip is a few pixels wide, so the strip would show four colours
     * and a sliver. The share stays in each segment's `title`, which is where
     * `.cp-strip` keeps it too. */
    const pal = paletteRows(palettes, g.id, state.target.variant).slice(0, VISIBLE_STRIP_COLORS);
    const badges = [];
    if (g.correct) badges.push('');
    else if (g.related.sameEvolutionFamily) badges.push('<span class="gm-badge gm-badge-family">同一進化家族</span>');
    else if (g.related.sharedTypes.length) {
      badges.push(`<span class="gm-badge gm-badge-type">同屬性 ${escapeHtml(g.related.sharedTypes.join(' / '))}</span>`);
    }
    rows.push(`<li class="gm-slot ${g.correct ? 'is-won' : ''}">
      <img class="gm-slot-sprite" src="${spriteUrl(g.id, state.target.variant === 's')}" alt="" loading="lazy" decoding="async">
      <div class="gm-slot-body">
        <!-- 名稱走圖鑑，色帶走色盤 —— 跟結果面板同一組分工。兩者不是同一個目標，
           所以沒有巢狀連結：色帶是名稱那個 <a> 的兄弟節點。 -->
        <div class="gm-slot-name"><a href="${pokemonDetailUrl(p)}">${escapeHtml(p.names.zh)}</a></div>
        <div class="gm-slot-meta">${g.correct ? '答對了' : `OKLab 色盤距離 ${g.distance.toFixed(4)} · ${TIER_LABEL[tierOf(g.distance)]}`}</div>
        ${badges.length ? `<div class="gm-slot-badges">${badges.join('')}</div>` : ''}
      </div>
      <a class="gm-slot-strip" href="${paletteUrl(p)}"
         aria-label="查看 ${escapeHtml(p.names.zh)} 的完整色盤">
        ${pal.map((r) => `<span style="background:${r.hex}" title="${formatHex(r.hex)} · ${formatShare(r.share)}"></span>`).join('')}
      </a>
    </li>`);
  }
  els.slots.innerHTML = rows.join('');
}

function renderSearchResults() {
  const q = els.search.value.trim();
  /* The status line is CLEARED here, every keystroke, and re-set below if there is
   * something to say.
   *
   * It was only written when the pool was the reason, which meant the message
   * outlived the query that produced it: type 妙喵 (filtered out, so "本回合只從
   * 第 I 世代出題"), then type 不存在的名字 — which matches nothing in the WHOLE
   * corpus — and the line still said the generation, blaming the round for a typo.
   *
   * Silence is also the right default, because Enter owns the "nothing matched"
   * case and prints 找不到「…」 with what would work. Two places reporting one
   * failure is how the wrong one ends up being the one the reader sees. */
  els.searchStatus.textContent = '';
  /* `renderSubmit()` on EVERY exit, including the early one below, because
   * `canSubmit()` now asks whether the list is open — so opening and closing it
   * are what move the 作答 button. A keystroke that empties the field closes the
   * list, and a reader who then presses Enter deserves the same answer the button
   * gives. Leaving it to the caller's own `renderSubmit()` is how the button and
   * the key started disagreeing in the first place. */
  if (!q || state.status !== 'playing') {
    setRevealed(els.searchList, false);
    renderSubmit();
    return;
  }
  const matches = searchMatches(q);
  const used = new Set(state.guesses.map((g) => g.id));
  els.searchList.innerHTML = matches.map((p) => {
    const isUsed = used.has(p.id);
    return `<li class="gm-search-item ${isUsed ? 'is-used' : ''}" role="option"
                aria-selected="false" aria-disabled="${isUsed}" data-id="${p.id}">
        <img src="${spriteUrl(p.id, state.target && state.target.variant === 's')}" alt="" loading="lazy" decoding="async">
        <span class="gm-search-item-name">${escapeHtml(p.names.zh)}</span>
        <span class="gm-search-item-id">#${p.id}</span>
      </li>`;
  }).join('');
  setRevealed(els.searchList, matches.length > 0);
  els.search.setAttribute('aria-expanded', matches.length > 0 ? 'true' : 'false');

  /* An empty list in easy mode is almost never "no such Pokémon" — it is usually
   * a real species from another generation, which the pool just removed. Saying
   * so is the difference between "my typing is broken" and "this round is narrow".
   * Checked by re-running the scan WITHOUT the pool, so the message is only shown
   * when the filter is the reason, and never when there is genuinely no match. */
  if (!matches.length && suggestionPool() && searchMatches(q, { ignorePool: true }).length) {
    els.searchStatus.textContent = `本回合只從第${numeralOf(state.gen)}世代出題。`;
  }
  renderSubmit();
}

function renderGenerations() {
  // setRevealed, not a direct write: `.gm-gen` is `display: flex` in CSS, so the
  // attribute alone loses and an empty 60px box stays on the page (§3.M).
  setRevealed(els.gen, state.difficulty === 'easy');
  els.genLabel.textContent = `只從第${numeralOf(state.gen)}世代出題`;
  els.genRow.innerHTML = allGenerations.map((g) =>
    `<button type="button" class="gm-gen-btn" role="radio"
             aria-checked="${g === state.gen}" data-gen="${g}">第${numeralOf(g)}世代</button>`).join('');
}

function renderResult() {
  const on = state.status !== 'playing';
  setRevealed(els.result, on);
  if (!on || !state.target) return;
  const t = byId.get(state.target.id);
  const won = state.status === 'won';
  els.resultTitle.textContent = RESULT_TITLE[state.status];
  els.resultTitle.className = `gm-result-title${won ? ' is-won' : ''}`;
  /* OFFICIAL ARTWORK for the reveal, not the 96x96 sprite.
   *
   * The 475x475 artwork is what every other page shows a species with —
   * `detail.html`'s `.evolution-sprite`, `generations.html`, `maze.html`, `life.js`,
   * `model3d.html`, `graph.html` — and this panel is the moment the round is over and
   * the reader gets to look at what it was, so it is the wrong place for the small
   * one. It also ups 0.6 KB to 115-200 KB, which is the honest price and is paid once,
   * at round end, because `src` is assigned here.
   *
   * `artworkUrl()` existed and was called by nothing until now. */
  els.resultSprite.src = artworkUrl(t.id, state.target.variant === 's');
  /* The NAME goes to the Pokédex entry and 「看牠的完整色盤」 below goes to the colour
   * page, so the two links in this panel answer two different questions. They used
   * to be the same destination twice.
   *
   * `pokemonDetailUrl()` rather than a hand-built `detail.html?slug=`, because it
   * carries the Nidoran ♀/♂ split (`nidoran-f` / `nidoran-m`) and the NFKD fix for
   * Flabébé. §3.A forbids assembling either URL by hand, and a bare `nidoran` slug is
   * strictly disallowed. Verified over the 1,025 records this page can reach: 1,025
   * distinct slugs, no collisions, all resolvable by `detail.html:445`. */
  els.resultAnswer.innerHTML = `<a href="${pokemonDetailUrl(t)}">${escapeHtml(t.names.zh)}</a>${variantSuffix()}`;
  /* The button below the answer is a SECOND route to the same page, so it has to
   * be re-pointed at the target too. It shipped with a hardcoded
   * `href="color.html"` and nothing ever rewrote it: finishing a game and
   * clicking 「看牠的完整色盤」 landed on color.html's own default — the daily
   * pick — which is a different Pokémon from the one just guessed. The static
   * href is only ever seen while the panel is hidden, so nothing failed
   * visibly; `check_color_game.mjs` found it as an id reached by neither lookup,
   * which is what an unused element looks like from off the page. */
  els.explore.href = paletteUrl(t);

  /* `bestDistance()` is NULL when nothing was guessed, and BOTH call sites have to
   * know that.
   *
   * Only one of them did. The stats line guarded it and this one did not, so 放棄 on a
   * round with zero guesses threw `Cannot read properties of null (reading 'toFixed')`
   * here — inside `renderAll()`, which means every line AFTER it was skipped:
   * `els.giveup.hidden = !playing` never ran, so 放棄 stayed visible on a finished
   * round. One null dereference produced a button that contradicted the page, and
   * nothing said so. §3.G1a's shape: the second usage was written, the first was not
   * checked.
   *
   * It is computed ONCE here rather than twice in one template. Two calls to a
   * function that returns null "when there is nothing" is two places to forget, and
   * the second call is the one a reader would never notice being wrong. */
  const best = bestDistance();
  const bestText = best === null ? '—' : best.toFixed(4);
  els.resultDetail.textContent = won
    ? `${state.guesses.length} 次之內猜中`
    : (best === null ? '一次都沒猜就放棄了。' : `最接近的一次是 OKLab 色盤距離 ${bestText}`);
  els.resultStats.innerHTML = `
    <div><dt>用了幾次</dt><dd>${state.guesses.length}</dd></div>
    <div><dt>提示</dt><dd>${state.hintsShown.length}</dd></div>
    <div><dt>難度</dt><dd>${DIFFICULTY_LABELS[state.difficulty]}</dd></div>
    <div><dt>最好的一次</dt><dd>${bestText}</dd></div>`;
  els.shareText.textContent = shareText();
  /* No `els.again.hidden` here — that attribute has exactly one writer, in
   * `renderAll()`. It used to be written in BOTH, which is the "state with two
   * writers" shape: they happened to compute the same expression today, so nothing
   * looked wrong, and the day one of them grows a second condition the two will
   * disagree about where the button is. The button also MOVED out of this panel, so
   * this function no longer has any business writing it. */

  /* LAST, and it has to be. §3.G4's "re-measure AFTER you write", one level down.
   *
   * The first version of this called `revealResult()` right after `setRevealed()`,
   * before the title, the answer, the stats and the share block existed — and
   * MEASURED that half-built panel. Smooth scrolling hid it, because the animation
   * outlasted the writes; `behavior: 'auto'` did not, and it landed **37px past**
   * the panel's top at 390×844, so the reader's first view of the answer started
   * with the title already scrolled off the screen.
   *
   * The 200×200 artwork below is the one thing that CAN still move the layout, and
   * `width`/`height` are attributes on the element, so the box is reserved before
   * the bytes arrive. `getBoundingClientRect()` inside the call forces layout, so
   * the number read is the number the browser will use. */
  revealResult();
}

function bestDistance() {
  const ds = state.guesses.map((g) => g.distance).filter((d) => Number.isFinite(d));
  return ds.length ? Math.min(...ds) : null;
}

function renderShinyBadge() {
  /* 地獄 and 困難 have the IDENTICAL pool (all 1,025); the only difference is the
     appearance. So without this badge the two tiers are the same game on screen,
     and this is the one place that difference can be visible. The element ships in
     the HTML already carrying `hidden` and no JS ever touched it, so 地獄 was
     quietly rendering as 困難. */
  setRevealed(els.shinyBadge, Boolean(state.target && state.target.variant === 's'));
}

/** Hide the control row when neither of its two children is showing. */
function renderFoot() {
  /* An OR over EVERY child rather than a hardcoded list of two.
   *
   * The row carries 放棄 (both modes, while playing), 異色 (a shiny draw) and 下一題
   * (unlimited only). Asking about the first two only meant that when 下一題 moved in
   * the row could still go blank — on a shiny draw in unlimited, where both
   * originals hide and only the new one shows. That reads as "unlimited broke the
   * buttons" rather than as a missing term, and it is the same defect as naming two
   * of three writers.
   *
   * `els.targetFoot.children` rather than three named ids, so a fourth control added
   * to the row is counted by default instead of being forgotten. */
  const anyVisible = [...els.targetFoot.children].some((el) => !el.hidden);
  setRevealed(els.targetFoot, anyVisible);
}

function renderAll() {
  /* The control row's own visibility is decided LAST, on purpose.
   *
   * It carries two children and can be left with NEITHER visible: 放棄 is
   * daily-only, and 異色 only appears on a shiny draw, so unlimited mode on a normal
   * target is the empty case — and an empty 32px row with a min-height reads as a
   * control that failed to load.
   *
   * It was declared directly after the `giveup.hidden` line, which read
   * `els.shinyBadge.hidden` while `renderShinyBadge()` — the only writer of that
   * attribute — had not necessarily run yet on every path. Same shape as the stale
   * `hintRevealsPalette` index: the value was plausible on the paths where the
   * caller had already got there. Reading it at the end makes it true on all of them.
   *
   * `setRevealed`, not a direct write — this row is `display: flex` from an author
   * rule, so `hidden` alone loses (§3.M). And this was a CSS `:has()` first, with
   * `:has(> [hidden]:only-child)`, which can never match: with two children neither
   * one is `:only-child`. `:has(> :not([hidden]))` would have worked, but nothing in
   * the suite can read whether a `:has()` selector matched, so the question moved
   * into JS where it became checkable. */
  els.difficultyNote.textContent = `${DIFFICULTY_LABELS[state.difficulty]}：${DIFFICULTY_NOTES[state.difficulty]}`;
  renderGenerations();
  renderShinyBadge();
  renderPalette();
  renderHints();
  renderSlots();
  renderResult();
  const playing = state.status === 'playing';
  /* The round is over, so an armed pick names a round that no longer exists — the
   * same argument as `newGame()`'s reset, at the OTHER end of the round, and
   * reachable there too: arm a row, then press 放棄 instead of Enter, then press
   * Enter. Without this the pick survives into a round `submitGuess()` refuses, and
   * `submitPendingPick()` has already returned `true` by then, so the round ends
   * with nothing on screen and nothing said. §3.W's rule that a re-render must not
   * carry state the reader did not ask to keep. */
  if (!playing) pendingPick = null;
  els.search.disabled = !playing || !state.target;
  renderSubmit();
  /* 放棄 is available in BOTH modes.
   *
   * It carried `|| state.mode !== 'daily'`, which was invented during the port: the
   * reference's `handleGiveUp` gates on `status !== "playing" || !targetPokemon` and
   * nothing else, and its Unlimited screenshot shows Give Up beside Get New Pokémon.
   * So a reader in unlimited mode had no way to say 「我不猜了，看答案」, and the
   * reason it read as a missing button rather than a deliberate one is that the
   * control row then had NOTHING visible at all in that mode — `renderFoot()` hides
   * an empty row, and 放棄 was its only always-on child.
   *
   * Only the round's own state matters now. */
  els.giveup.hidden = !playing;
  /* 下一題 is unlimited-only and needs no round state at all: a daily is one puzzle
   * a day and is already recorded, so there is no "next" to go to. In unlimited the
   * reader can skip at ANY time, matching the reference's Get New Pokémon — it is
   * not gated on the round ending, because the round costs nothing to abandon. */
  els.again.hidden = state.mode !== 'unlimited';

  for (const tab of document.querySelectorAll('[data-difficulty]')) {
    const on = tab.dataset.difficulty === state.difficulty;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  for (const tab of document.querySelectorAll('[data-mode]')) {
    const on = tab.dataset.mode === state.mode;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  /* Last, because both of its inputs are written above. See renderFoot(). */
  renderFoot();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function numeralOf(n) {
  return ({ 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' })[n] || String(n);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wire() {
  els.search.addEventListener('input', () => {
    /* Typing after a click is the reader changing their mind, so the armed pick
     * goes. Without this the sequence click row 2 -> type one more character ->
     * Enter would submit row 2, which is now not what the field says. */
    if (pendingPick !== null) {
      pendingPick = null;
      els.searchStatus.textContent = '';
    }
    renderSearchResults();
    renderSubmit();
  });
  /* The IME's 選字 key. `isComposing` covers Chrome and Firefox; `keyCode === 229`
   * is the legacy signal some Windows IMEs send instead; `composing` covers Safari,
   * which reports `isComposing === false` on the keydown that commits. All three,
   * because missing one is not a degraded result — it is a spent attempt. */
  els.search.addEventListener('compositionstart', () => { composing = true; });
  els.search.addEventListener('compositionend', () => { composing = false; });

  els.search.addEventListener('keydown', (e) => {
    /* FIRST, and before the `preventDefault()`: this keydown belongs to the input
     * method, not to the game. Preventing the default here is what stops some
     * IMEs committing at all, which loses the character rather than the guess. */
    if (e.isComposing || e.keyCode === 229 || composing) return;

    /* And nothing here answers a round that has ended.
     *
     * The input is disabled from that moment, so a real key cannot arrive — but
     * `dispatchEvent` DELIVERS to a disabled element's listeners anyway, and the
     * 作答 button works that way. It is gated on `canSubmit()`, so the button cannot
     * get here today, which is exactly why this is worth stating: measured, the
     * fall-through below printed 「先輸入名稱或全國編號。」 for a finished round, which
     * is the one message on this page that is definitely wrong — the reader is not
     * being asked to type anything. §3.I's shape one level down: a route assumed to
     * be unreachable, found by dispatching to it. */
    if (state.status !== 'playing') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      /* THE ARMED PICK, before anything else. It is the only route into this field
       * that names a species the reader has already chosen by hand, so it outranks
       * the row they last walked to and the first row they did not. */
      if (submitPendingPick()) return;

      /* WHILE THE LIST IS OPEN, ENTER SELECTS AND NEVER SUBMITS — except when the
       * list holds exactly one candidate, where there is no choice left to make and
       * a second Enter would only be ceremony.
       *
       * The rule replaced "and if there was nothing better, submit the first row",
       * which spent one of four daily attempts on #86 小海獅 because 「海」 matches
       * 26 species and `pokemon` is in dex order. The first Enter now costs nothing
       * whatever it picks: it fills the field with a WHOLE name the reader can see,
       * walk away from with ↓, or clear and retype. */
      if (listIsOpen()) {
        const only = soleCandidate();
        if (only != null) { pickFromSearch(only); return; }
        const active = els.searchList.querySelector('[aria-selected="true"]');
        const target = active && !active.classList.contains('is-used')
          ? active
          : els.searchList.querySelector('.gm-search-item:not(.is-used)');
        if (target) { chooseFromSearch(Number(target.dataset.id)); return; }
      }

      /* The list is closed and nothing is armed, so there is no row to walk to and
       * the field is the only thing that can name a species. A whole name beats the
       * substring scan's ranking: 「伊布」 matches inside 水伊布 / 雷伊布 / 妖精伊布, so
       * the scan's order is dex order rather than what the reader literally typed. */
      const exact = resolveExact(els.search.value);
      if (exact) { pickFromSearch(exact.id); return; }

      /* Nothing matched, and the text is not a whole name or number. Say so, and
       * say what would work — a silent no-op here is indistinguishable from a
       * broken field. */
      els.searchStatus.textContent = els.search.value.trim()
        ? `找不到「${els.search.value.trim()}」。可以只打部分名稱，或輸入全國編號。`
        : '先輸入名稱或全國編號。';
      renderSubmit();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...els.searchList.querySelectorAll('.gm-search-item')];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(els.searchList.querySelector('[aria-selected="true"]'));
      const step = e.key === 'ArrowDown' ? 1 : -1;
      /* Wrap, and skip the rows that are already guessed. Stopping after `length`
       * steps bounds the search so a list of only-used rows cannot spin. */
      let next = null;
      for (let k = 1; k <= items.length; k++) {
        const cand = items[(at + step * k + items.length * k) % items.length];
        if (cand && !cand.classList.contains('is-used')) { next = cand; break; }
      }
      if (!next) return;
      for (const it of items) it.setAttribute('aria-selected', 'false');
      next.setAttribute('aria-selected', 'true');
      next.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (e.key === 'Escape') {
      setRevealed(els.searchList, false);
      els.search.setAttribute('aria-expanded', 'false');
      /* Closing the list is what makes a whole name submittable, so the button
       * moves with it — see `canSubmit()`. */
      renderSubmit();
    }
  });

  /* Delegated on `document`, and the test target is the container, never the item.
     Items are regenerated on every keystroke, so a captured item can leave the
     tree before it is pressed — §3.G. */
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.gm-search-item');
    if (item) { chooseFromSearch(Number(item.dataset.id)); return; }
    const gen = e.target.closest('[data-gen]');
    if (gen) { setGeneration(Number(gen.dataset.gen)); return; }
    const diff = e.target.closest('[data-difficulty]');
    if (diff) { setDifficulty(diff.dataset.difficulty); return; }
    const mode = e.target.closest('[data-mode]');
    if (mode) { setMode(mode.dataset.mode); return; }
    if (e.target.closest('#gm-giveup')) { giveUp(); return; }
    if (e.target.closest('#gm-again')) { newGame(); return; }
    if (e.target.closest('#gm-share-copy')) { copyShare(); return; }
    /* A click on empty space dismisses the list, and that is a list-state change
     * `canSubmit()` reads — see the Escape branch for why. */
    if (!e.target.closest('.gm-search-wrap')) {
      setRevealed(els.searchList, false);
      renderSubmit();
    }
  });

  /* `/` focuses, `h` reveals a hint. Both are suppressed while typing — otherwise
     typing `h` to look for 皮卡丘 fires a hint, which is the least noticeable
     kind of annoyance there is. */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); if (!els.search.disabled) els.search.focus(); }
    else if (e.key === 'h' || e.key === 'H') { revealHint(); }
  });
}

/**
 * A dropdown row was CLICKED: fill the field, name the species, submit nothing.
 *
 * The input gets the bare zh-TW name rather than the id, so a native datalist
 * selection — which sets the same thing — lands on an identical value, and so the
 * reader can still edit what they picked. `pendingPick` carries the id, because
 * `resolveExact()` cannot recover it from a name the reader then changes.
 *
 * No `input` event is dispatched. It would re-run the search, close the list the
 * reader just chose from, and clear `pendingPick` on the way through — the handler
 * that sets the value would destroy the state that makes it mean anything.
 */
function chooseFromSearch(id) {
  const p = byId.get(id);
  if (!p) return;
  els.search.value = p.names.zh;
  setRevealed(els.searchList, false);
  els.search.setAttribute('aria-expanded', 'false');

  /* A finished round cannot be answered, so a row still on screen from before the
   * ending fills the field and SAYS SO instead of arming anything.
   *
   * Found by asking how a `.gm-search-item` can be clicked at all once the round is
   * over: `giveUp()` does not dismiss the list, because the click handler
   * `return`s on `#gm-giveup` before reaching the click-outside branch. So 放棄 with
   * the list open leaves live rows on a finished round, and the reader's next click
   * armed a species that Enter then fed to `submitGuess()`, which refuses — a click
   * that appeared to arm something and then silently did nothing. */
  if (state.status !== 'playing') {
    pendingPick = null;
    els.searchStatus.textContent = `這次已經結束了。答案是 ${p.names.zh}。`;
    renderSubmit();
    els.search.focus();
    return;
  }

  if (state.guesses.some((g) => g.id === id)) {
    /* Already guessed. Fill the field so the reader can see which one they hit,
     * but arm nothing: Enter would only be told no, and a click that appears to
     * arm something and then refuses is worse than one that says why. */
    pendingPick = null;
    els.searchStatus.textContent = `#${id} ${p.names.zh} 已經猜過了。`;
    renderSubmit();
    els.search.focus();
    return;
  }

  pendingPick = id;
  els.searchStatus.textContent = `已選好 #${id} ${p.names.zh} —— 按 Enter 或按右邊的作答。`;
  renderSubmit();
  els.search.focus();
}

/** Submit the pending pick. Returns false when there is nothing armed. */
function submitPendingPick() {
  const id = pendingPick;
  if (id == null) return false;
  pendingPick = null;
  pickFromSearch(id);
  return true;
}

function pickFromSearch(id) {
  const ok = submitGuess(id);
  els.search.value = '';
  pendingPick = null;
  setRevealed(els.searchList, false);
  renderSubmit();
  /* Only while the round is still going, and that guard is the whole reason the
   * round-end announcement survives.
   *
   * `submitGuess()` above can END the round, and by the time it returns
   * `renderResult()` has already put the outcome into this same live region — so
   * the clear that belongs to a still-playing round would delete the announcement
   * on the exact frame it is most wanted. Nothing writes it back: the search input
   * is disabled from here, so no keystroke can re-run `renderSearchResults()`
   * either. To a screen-reader user the round would then end silently, which is
   * the one thing the announcement exists to prevent. */
  if (state.status === 'playing') {
    els.searchStatus.textContent = ok ? '' : '這一隻已經猜過了。';
    if (!ok && !state.guesses.some((g) => g.id === id)) els.searchStatus.textContent = '這次已經結束了。';
  }
  els.search.focus();
}

function setDifficulty(difficulty) {
  const next = normalizeDifficulty(difficulty);
  if (next === state.difficulty) return;
  state.difficulty = next;
  store.set('difficulty', next);
  newGame();
}

function setGeneration(gen) {
  const next = normalizeGeneration(gen, allGenerations);
  if (next === state.gen) return;
  state.gen = next;
  store.set('gen', next);
  newGame();
}

function setMode(mode) {
  if (mode !== 'daily' && mode !== 'unlimited') return;
  if (mode === state.mode) return;
  state.mode = mode;
  store.set('mode', mode);
  newGame();
}

async function copyShare() {
  const text = els.shareText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.searchStatus.textContent = '成績已複製。';
  } catch (e) {
    els.searchStatus.textContent = '無法自動複製，請手動選取上面的成績。';
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function init() {
  els.palette = document.getElementById('gm-palette');
  els.paletteEmpty = document.getElementById('gm-palette-empty');
  els.hints = document.getElementById('gm-hints');
  /* The hint button and its bar are now PERMANENT nodes, found once.
   *
   * They used to be rebuilt into `innerHTML` on every render, which meant the
   * click handler was delegated by id on a node that no longer existed between
   * renders — it worked, but it also meant `disabled` was a string concatenated
   * into markup. A button that exists from the first paint can be disabled as a
   * property, and §3.G's rule about capturing a node is then not in play at all. */
  els.hintRow = document.getElementById('gm-hint-row');
  els.hintBtn = document.getElementById('gm-hint-btn');
  els.hintBar = document.getElementById('gm-hint-bar');
  els.hintLabel = els.hintBtn.querySelector('.gm-btn-hint-label');

  els.hintBtn.addEventListener('click', () => revealHint());
  els.slots = document.getElementById('gm-slots');
  els.search = document.getElementById('gm-search');
  els.searchList = document.getElementById('gm-search-list');
  els.submit = document.getElementById('gm-submit');

  /* The button submits through the SAME chain as Enter, by synthesising the key —
   * rather than calling `submitPendingPick()` itself. Two entry points that each
   * re-implement "armed pick, then sole candidate, then whole name" is how they
   * come to disagree, and the disagreement is invisible: one of them quietly
   * accepts something the other refuses. A `KeyboardEvent` with `key: 'Enter'` is
   * what the reader's own keyboard produces, so there is one implementation of the
   * rule.
   *
   * **The synthetic event must survive the IME guard above.** A constructed
   * `KeyboardEvent` reports `isComposing === false` and `keyCode === 0`, so a
   * guard written as `e.keyCode !== 229 → proceed` passes it — but one written as
   * `if (e.keyCode === 0) return` to catch untrusted events would swallow the whole
   * mobile route, where this button is the ONLY way to answer. */
  els.submit.addEventListener('click', () => {
    els.search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  els.searchStatus = document.getElementById('gm-search-status');
  els.result = document.getElementById('gm-result');
  els.resultTitle = document.getElementById('gm-result-title');
  els.resultSprite = document.getElementById('gm-result-sprite');
  els.explore = document.getElementById('gm-explore');
  els.resultAnswer = document.getElementById('gm-result-answer');
  els.resultDetail = document.getElementById('gm-result-detail');
  els.resultStats = document.getElementById('gm-result-stats');
  els.shareText = document.getElementById('gm-share-text');
  els.again = document.getElementById('gm-again');
  els.giveup = document.getElementById('gm-giveup');
  els.shinyBadge = document.getElementById('gm-shiny-badge');
  els.targetFoot = document.querySelector('.gm-target-foot');
  els.tipText = document.getElementById('gm-tip-text');
  els.tipLive = document.getElementById('gm-tip-live');
  els.gen = document.getElementById('gm-gen');
  els.genRow = document.getElementById('gm-gen-row');
  els.genLabel = document.getElementById('gm-gen-label');
  els.difficultyNote = document.getElementById('gm-difficulty-note');

  try {
    [pokemon, palettes] = await Promise.all([
      loadJson('assets/data/pokemon_data.json'),
      loadJson('assets/data/color_palettes.json'),
    ]);
  } catch (err) {
    els.palette.innerHTML = `<p class="gm-palette-empty">資料載入失敗：${escapeHtml(err.message)}</p>`;
    return;
  }

  byId = new Map(pokemon.map((p) => [p.id, p]));
  genIds = genIdMap(pokemon);
  allGenerations = [...genIds.keys()].sort((a, b) => a - b);

  /* The spec: 「第一次進來都是簡單 + 第一世代」. So the default is written down
     rather than being "the first configured value", and anything read back from
     localStorage goes through normalise — those two keys can be hand-edited and
     can hold an older version's value. */
  state.difficulty = normalizeDifficulty(store.get('difficulty', 'easy'));
  state.gen = normalizeGeneration(store.get('gen', 1), allGenerations);
  state.mode = store.get('mode', 'daily') === 'unlimited' ? 'unlimited' : 'daily';

  /* The header is mounted by the page's INLINE module, not from here: the nav mount
   * has to be readable off the HTML, because a grep over `assets/js` cannot answer
   * which pages mount it. `initThemeToggle()` is mounted beside it for the same
   * reason — and it was missing from both, which is why the button sat in the corner
   * as a 34px box that painted nothing. */
  wire();
  newGame();
  /* After `newGame()`, not before: the tip is ambient and reads better once the
   * card has its first paint, and starting the timers before the palette renders
   * means the first few hundred ms of a 5s hold are spent on a blank bar. */
  initTip();
}

init();