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

import { badgeStyle, hexToRgb } from './shared.js';
import { spriteUrl, formatShare, formatHex, paletteUrl } from './color-palette.js';
import { hexToOklab, deltaEOk } from './color-match.js';
import { taipeiDateKey } from './daily-pick.js';
import {
  MAX_ATTEMPTS, PALETTE_COLORS_SHOWN,
  DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES,
  variantOf, poolFor, genIdMap, allIds,
  pickDailyTarget, pickUnlimitedTarget,
  paletteRows, visiblePalette, scoreGuess, tierOf, normalizeDifficulty, normalizeGeneration,
} from './game-similarity.js';
import { MAX_HINTS, hintRevealsPalette, generateHints } from './game-hints.js';

const STORE_PREFIX = 'pokemon-colorgame:';

/** Seconds between hints. The reference says 5. */
const HINT_COOLDOWN_S = 5;

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
  if (state.status !== 'playing' || state.mode !== 'daily') return;
  state.status = 'lost';
  persistDaily();
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
function searchMatches(q) {
  const text = q.trim().toLowerCase();
  if (!text) return [];
  const out = [];
  for (const p of pokemon) {
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

function renderPalette() {
  const box = els.palette;
  const revealed = paletteRevealed() || state.status !== 'playing';
  setRevealed(els.paletteEmpty, false);
  if (!state.target) return;
  const rows = visiblePalette(palettes, state.target.id, state.target.variant, revealed);
  box.setAttribute('aria-label',
    `目標寶可夢的色帶，共 ${rows.length} 色${revealed ? '（已顯示全部）' : '（還有更多顏色）'}`);
  box.innerHTML = rows.map((row) => {
    const rgb = hexToRgb(row.hex);
    const ink = badgeStyle(rgb);
    const grow = row.share > 0 ? row.share : 1;
    return `<div class="gm-swatch" style="flex:${grow} 1 0;${ink}"
                 title="${formatHex(row.hex)} · ${formatShare(row.share)}">
        <span class="gm-swatch-share">${formatShare(row.share)}</span>
        <span class="gm-swatch-hex">${formatHex(row.hex)}</span>
      </div>`;
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
      rows.push(`<li class="gm-slot is-empty" aria-hidden="true">
        <img class="gm-slot-sprite" alt="" src="assets/images/pokemon/${padId(i + 1)}.png" loading="lazy" decoding="async">
        <div class="gm-slot-body"><span class="gm-slot-empty-text">第 ${i + 1} 次機會</span></div>
      </li>`);
      continue;
    }
    const p = byId.get(g.id);
    const pal = visiblePalette(palettes, g.id, state.target.variant, false);
    const badges = [];
    if (g.correct) badges.push('');
    else if (g.related.sameEvolutionFamily) badges.push('<span class="gm-badge gm-badge-family">同一進化家族</span>');
    else if (g.related.sharedTypes.length) {
      badges.push(`<span class="gm-badge gm-badge-type">同屬性 ${escapeHtml(g.related.sharedTypes.join(' / '))}</span>`);
    }
    rows.push(`<li class="gm-slot ${g.correct ? 'is-won' : ''}">
      <img class="gm-slot-sprite" src="${spriteUrl(g.id, state.target.variant === 's')}" alt="" loading="lazy" decoding="async">
      <div class="gm-slot-body">
        <div class="gm-slot-name"><a href="${paletteUrl(p)}">${escapeHtml(p.names.zh)}</a></div>
        <div class="gm-slot-meta">${g.correct ? '答對了' : `OKLab 色盤距離 ${g.distance.toFixed(4)} · ${TIER_LABEL[tierOf(g.distance)]}`}</div>
        ${badges.length ? `<div class="gm-slot-badges">${badges.join('')}</div>` : ''}
      </div>
      <div class="gm-slot-strip" role="img" aria-label="${escapeHtml(p.names.zh)} 的色盤">
        ${pal.map((r) => `<span style="background:${r.hex}" title="${formatHex(r.hex)}"></span>`).join('')}
      </div>
    </li>`);
  }
  els.slots.innerHTML = rows.join('');
}

function renderSearchResults() {
  const q = els.search.value.trim();
  if (!q || state.status !== 'playing') { setRevealed(els.searchList, false); return; }
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
  els.resultTitle.textContent = won ? '答對了' : '這次沒猜到';
  els.resultTitle.className = `gm-result-title${won ? ' is-won' : ''}`;
  els.resultSprite.src = spriteUrl(t.id, state.target.variant === 's');
  els.resultAnswer.innerHTML = `<a href="${paletteUrl(t)}">${escapeHtml(t.names.zh)}</a>${state.target.variant === 's' ? '（異色）' : ''}`;
  /* The button below the answer is a SECOND route to the same page, so it has to
   * be re-pointed at the target too. It shipped with a hardcoded
   * `href="color.html"` and nothing ever rewrote it: finishing a game and
   * clicking 「看牠的完整色盤」 landed on color.html's own default — the daily
   * pick — which is a different Pokémon from the one just guessed. The static
   * href is only ever seen while the panel is hidden, so nothing failed
   * visibly; `check_color_game.mjs` found it as an id reached by neither lookup,
   * which is what an unused element looks like from off the page. */
  els.explore.href = paletteUrl(t);
  els.resultDetail.textContent = won
    ? `${state.guesses.length} 次之內猜中`
    : `最接近的一次是 OKLab 色盤距離 ${bestDistance().toFixed(4)}`;
  els.resultStats.innerHTML = `
    <div><dt>用了幾次</dt><dd>${state.guesses.length}</dd></div>
    <div><dt>提示</dt><dd>${state.hintsShown.length}</dd></div>
    <div><dt>難度</dt><dd>${DIFFICULTY_LABELS[state.difficulty]}</dd></div>
    <div><dt>最好的一次</dt><dd>${bestDistance() === null ? '—' : bestDistance().toFixed(4)}</dd></div>`;
  els.shareText.textContent = shareText();
  els.again.hidden = state.mode !== 'unlimited';
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

function renderAll() {
  els.difficultyNote.textContent = `${DIFFICULTY_LABELS[state.difficulty]}：${DIFFICULTY_NOTES[state.difficulty]}`;
  renderGenerations();
  renderShinyBadge();
  renderPalette();
  renderHints();
  renderSlots();
  renderResult();
  const playing = state.status === 'playing';
  els.search.disabled = !playing || !state.target;
  els.giveup.hidden = !playing || state.mode !== 'daily';
  els.attempts.textContent = state.mode === 'daily'
    ? `剩下 ${Math.max(0, MAX_ATTEMPTS - state.guesses.length)} 次機會`
    : `已猜 ${state.guesses.length} 次`;
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
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function numeralOf(n) {
  return ({ 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' })[n] || String(n);
}

function padId(id) {
  return String(id).padStart(3, '0');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wire() {
  els.search.addEventListener('input', () => renderSearchResults());
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      /* Arrow keys first, so Enter takes the row the reader has walked to rather
       * than snapping back to the first. Without them the ↓ key did nothing and
       * the only reachable row was the top one, which is the same as having no
       * listbox — it is a <ul role="listbox">, so it owes the reader navigation. */
      const active = els.searchList.querySelector('[aria-selected="true"]');
      if (active && !active.classList.contains('is-used')) {
        pickFromSearch(Number(active.dataset.id));
        return;
      }

      /* THEN THE EXACT NAME, and this ordering is the fix. It used to be
       * first-suggestion-then-nothing, so a reader who typed 「伊布」 in full got
       * whatever the substring scan ranked first — and 「伊布」 is not always that:
       * the scan matches inside other names too (水伊布, 雷伊布, 妖精伊布), so the
       * rank is dex order rather than "what you literally typed". A whole-name
       * match is the stronger signal, so it is asked first. */
      const exact = resolveExact(els.search.value);
      if (exact) { pickFromSearch(exact.id); return; }

      const first = els.searchList.querySelector('.gm-search-item:not(.is-used)');
      if (first) { pickFromSearch(Number(first.dataset.id)); return; }

      /* Nothing matched, and the text is not a whole name or number. Say so, and
       * say what would work — a silent no-op here is indistinguishable from a
       * broken field. */
      els.searchStatus.textContent = els.search.value.trim()
        ? `找不到「${els.search.value.trim()}」。可以只打部分名稱，或輸入全國編號。`
        : '先輸入名稱或全國編號。';
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
    }
  });

  /* Delegated on `document`, and the test target is the container, never the item.
     Items are regenerated on every keystroke, so a captured item can leave the
     tree before it is pressed — §3.G. */
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.gm-search-item');
    if (item && !item.classList.contains('is-used')) { pickFromSearch(Number(item.dataset.id)); return; }
    const gen = e.target.closest('[data-gen]');
    if (gen) { setGeneration(Number(gen.dataset.gen)); return; }
    const diff = e.target.closest('[data-difficulty]');
    if (diff) { setDifficulty(diff.dataset.difficulty); return; }
    const mode = e.target.closest('[data-mode]');
    if (mode) { setMode(mode.dataset.mode); return; }
    if (e.target.closest('#gm-giveup')) { giveUp(); return; }
    if (e.target.closest('#gm-again')) { newGame(); return; }
    if (e.target.closest('#gm-share-copy')) { copyShare(); return; }
    if (!e.target.closest('.gm-search-wrap')) { setRevealed(els.searchList, false); }
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

function pickFromSearch(id) {
  const ok = submitGuess(id);
  els.search.value = '';
  setRevealed(els.searchList, false);
  els.searchStatus.textContent = ok ? '' : '這一隻已經猜過了。';
  if (!ok && !state.guesses.some((g) => g.id === id)) els.searchStatus.textContent = '這次已經結束了。';
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
  els.names = document.getElementById('gm-names');
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
  els.attempts = document.getElementById('gm-attempts');
  els.shinyBadge = document.getElementById('gm-shiny-badge');
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

  /* The native fallback list, built ONCE.
   *
   * Built once rather than per keystroke because it is 1,025 options and it never
   * changes — rebuilding it on every `input` event would be ~40 KB of DOM churn per
   * character typed, on a page whose whole point is that the reader does not know
   * the name and is therefore typing a lot.
   *
   * `value` is the bare zh-TW name because that is what the keyboard completes INTO;
   * the id rides in `label` so the suggestion shows it without the reader having to
   * remember a number. No `option` is disabled: the datalist cannot express "already
   * guessed" and faking it would need a value the reader could not complete to. */
  els.names.innerHTML = pokemon
    .map((p) => `<option value="${escapeHtml(p.names.zh)}" label="#${p.id}"></option>`)
    .join('');

  /* The spec: 「第一次進來都是簡單 + 第一世代」. So the default is written down
     rather than being "the first configured value", and anything read back from
     localStorage goes through normalise — those two keys can be hand-edited and
     can hold an older version's value. */
  state.difficulty = normalizeDifficulty(store.get('difficulty', 'easy'));
  state.gen = normalizeGeneration(store.get('gen', 1), allGenerations);
  state.mode = store.get('mode', 'daily') === 'unlimited' ? 'unlimited' : 'daily';

  wire();
  newGame();
}

init();