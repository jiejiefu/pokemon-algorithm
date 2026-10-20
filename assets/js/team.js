/**
 * `team.html` — six slots, two tallies, one roster grid.
 *
 * The page is a thin shell: every transition lives in `team-state.js` and
 * every matchup in `team-analysis.js`. This module owns the DOM, the URL and
 * the announcements. It also owns the one thing the reference planner does
 * visually and this page must not lose: the slot body is two type colours
 * split on the horizontal, with the name bar using the AA fill/ink pair from
 * `shared.js` rather than a guessed white.
 *
 * Moves are a second load. The roster is 145 KB and paints the page; the move
 * table is 607 KB (151 KB gzip) and is fetched only once a member exists, so a
 * visitor who never fills a slot never pays for it. Every slot keeps four rows
 * from the first paint — as `⋯` until the table lands — because a six-column
 * grid that grows a row per slot would reflow the whole section.
 *
 * The slot image is the one third-party request: the local official artwork
 * paints first, then a probed Showdown GIF replaces it when that species has
 * one. See `SHOWDOWN_GIF` for why the GIF set is the right size for this box
 * and why the fallback is a probe rather than an `onerror` on the visible node.
 */

import {
  TYPE_EN_ZH, TYPE_COLORS, typeBadgeSmHtml, typePair, pokemonDetailUrl,
  wireRoving, MOVE_TABS,
} from './shared.js';
import { artworkUrl, spriteUrl } from './color-palette.js';
import { TYPE_CHART_ORDER } from './type-chart.js';
import { analyzeTeam, defensiveMultiplier, teamSummary } from './team-analysis.js';
import {
  TEAM_LIMIT, parseTeamParam, serializeTeamParam, parseMovesParam,
  serializeMovesParam, addMember, removeMember, filterRoster, randomTeam,
} from './team-state.js';
import {
  MOVES_PER_MEMBER, fieldIndex, parseSet, allMoveIds, methodOf, methodIds,
  moveRecord, drawMoves, isDamaging, powerText, accuracyText, classText,
} from './team-moves.js';

const PAGE_SIZE = 120;
const SEARCH_DEBOUNCE_MS = 120;
const MOVE_TABLE_URL = 'assets/data/team_moves.json';
const ART_SCALE = 1;
const ART_MAX = 136;

/**
 * The slot art is the one runtime request this site makes to a third party.
 *
 * Showdown's animated sprites are the reason: they are bottom-anchored battle
 * GIFs at 43-178px and their canvas size tracks the species, so each file is
 * drawn at its own pixels, capped at 136: #132 (43x35) stays 43x35 instead of
 * being blown up 3.2x, and #6 (133x140) is only trimmed to the cap. The
 * local Scarlet/Violet set is 120x112 with the subject occupying only 36-72px,
 * which is why drawing it at its own size looked smaller than the old 96px
 * sprite.
 *
 * Nothing is stored: the GIF is probed once per species per page load, and a
 * 404 (today #1010, #1017, #1024, #1025) or a network failure keeps the local
 * official artwork that was the `src` from the first paint. That is also why
 * the probe is an `Image()` rather than a swapped `<img>`: a failed probe never
 * puts a broken icon on the page, and `gifState` keeps a six-slot team to six
 * requests rather than one per render.
 */
const SHOWDOWN_GIF = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown';
const gifState = new Map();

function showdownUrl(id) {
  return `${SHOWDOWN_GIF}/${id}.gif`;
}

/**
 * One probe per species, and one promise every rendered `<img>` can wait on.
 *
 * A `'loading'` string in the cache was the first shape and it was wrong: the
 * move table's fetch can land between two renders, so the second `<img>` saw
 * 「already loading」 and waited for a probe whose old node was detached. The
 * promise is what makes a late render attach to the in-flight request instead
 * of sitting on the artwork forever.
 */
function showdownReady(id) {
  let entry = gifState.get(id);
  if (!entry) {
    entry = new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(true);
      probe.onerror = () => resolve(false);
      probe.src = showdownUrl(id);
    });
    gifState.set(id, entry);
  }
  return entry;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function option(value, label) {
  const node = el('option', null, label);
  node.value = value;
  return node;
}

function idText(id) {
  return `#${String(id).padStart(4, '0')}`;
}

const MULTIPLIER_TEXT = { 0.5: '½', 0.75: '¾', 1: '1' };

function multiplierText(value) {
  return MULTIPLIER_TEXT[value] || String(value);
}

/** A zero-padded stat line for a move's `title`, shared by slot and dialog. */
function moveSummary(move) {
  return `${TYPE_EN_ZH[move.type] || move.type}・${classText(move)}・威力 ${powerText(move)}・命中 ${accuracyText(move)}・PP ${move.pp}`;
}

export async function initTeamPage() {
  const slotsEl = document.getElementById('tm-slots');
  if (!slotsEl) return;

  const els = {
    count: document.getElementById('tm-count'),
    summary: document.getElementById('tm-summary'),
    defense: document.getElementById('tm-defense'),
    coverage: document.getElementById('tm-coverage'),
    defenseHead: document.getElementById('tm-defense-head'),
    coverageHead: document.getElementById('tm-coverage-head'),
    offenseNote: document.getElementById('tm-offense-note'),
    search: document.getElementById('tm-search'),
    region: document.getElementById('tm-region'),
    generation: document.getElementById('tm-generation'),
    type: document.getElementById('tm-type'),
    resultline: document.getElementById('tm-resultline'),
    status: document.getElementById('tm-status'),
    grid: document.getElementById('tm-grid'),
    empty: document.getElementById('tm-empty'),
    more: document.getElementById('tm-more'),
    random: document.getElementById('tm-random'),
    reroll: document.getElementById('tm-reroll'),
    clear: document.getElementById('tm-clear'),
    share: document.getElementById('tm-share'),
    actionStatus: document.getElementById('tm-action-status'),
    statCount: document.getElementById('tm-stat-count'),
    dialog: document.getElementById('tm-move-dialog'),
    dialogTarget: document.getElementById('tm-move-target'),
    dialogClose: document.getElementById('tm-move-close'),
    tabs: document.getElementById('tm-move-tabs'),
    moveSearch: document.getElementById('tm-move-search'),
    moveCount: document.getElementById('tm-move-count'),
    moveList: document.getElementById('tm-move-list'),
    moveEmpty: document.getElementById('tm-move-empty'),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    roster: [],
    byId: new Map(),
    validIds: new Set(),
    ids: [],
    filtered: [],
    visible: PAGE_SIZE,
    filters: { query: '', region: '', generation: '', type: '' },
    moves: new Map(),
    moveTable: null,
    records: new Map(),
    learned: new Map(),
    movesFailed: false,
  };

  let movesPromise = null;
  let dialogState = { memberIndex: -1, slotIndex: -1, method: 'level' };

  function announce(message) {
    els.actionStatus.textContent = message;
  }

  try {
    const response = await fetch('assets/data/team_roster.json');
    if (!response.ok) throw new Error(`team_roster.json: ${response.status}`);
    const data = await response.json();
    state.roster = data.pokemon;
    state.byId = new Map(state.roster.map((pokemon) => [pokemon.id, pokemon]));
    state.validIds = new Set(state.byId.keys());
    populateControls(data.regions);
  } catch (error) {
    els.status.hidden = false;
    els.status.textContent = '載入隊伍資料失敗，請重新整理頁面。';
    console.error(error);
    return;
  }

  els.statCount.textContent = state.roster.length.toLocaleString('en-US');
  els.status.hidden = true;

  const params = new URLSearchParams(location.search);
  const parsed = parseTeamParam(params.get('team'), state.validIds);
  state.ids = parsed.ids;

  applyFilters();
  update();

  if (parsed.ignored > 0) {
    announce(`已忽略 ${parsed.ignored} 個無效、重複或超過 6 隻的編號。`);
  }

  /* ---- moves ------------------------------------------------------------ */

  function learnedSet(id) {
    if (!state.learned.has(id)) state.learned.set(id, parseSet(state.moveTable.sets, id));
    return state.learned.get(id);
  }

  function allowedFor(id) {
    return allMoveIds(learnedSet(id));
  }

  /**
   * Applies `?moves=` over the current team. A member whose chunk is absent,
   * empty, or rejected is drawn a fresh four — the default is a random draw,
   * so a missing parameter is not a reason to leave the slot blank.
   */
  function applyMovesParam(value) {
    const result = parseMovesParam(value, state.ids, allowedFor);
    state.ids.forEach((id, index) => {
      state.moves.set(id, result.slots[index] || drawMoves(learnedSet(id)));
    });
    return result.ignored;
  }

  function ensureMoves() {
    if (state.moveTable || state.movesFailed) return movesPromise || Promise.resolve();
    if (!movesPromise) {
      movesPromise = fetch(MOVE_TABLE_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`${MOVE_TABLE_URL}: ${response.status}`);
          return response.json();
        })
        .then((data) => {
          state.moveTable = data;
          const index = fieldIndex(data.defs._fields);
          for (const key of Object.keys(data.defs)) {
            if (key === '_fields') continue;
            const moveId = Number(key);
            state.records.set(moveId, moveRecord(moveId, data, index));
          }
          const ignored = applyMovesParam(params.get('moves'));
          update();
          if (ignored > 0) announce(`已忽略 ${ignored} 隻隊員無法學習的招式，已重新抽選。`);
        })
        .catch((error) => {
          state.movesFailed = true;
          console.error(error);
          announce('載入招式資料失敗，隊伍分析仍以屬性計算。');
          renderSlots();
        });
    }
    return movesPromise;
  }

  /** Draws four for any member without a selection; drops departed members. */
  function seedMoves() {
    const present = new Set(state.ids);
    for (const key of [...state.moves.keys()]) {
      if (!present.has(key)) state.moves.delete(key);
    }
    for (const id of state.ids) {
      const picked = state.moves.get(id);
      if (!picked || !picked.length) state.moves.set(id, drawMoves(learnedSet(id)));
    }
  }

  /** The member's four as records the analysis can read, with STAB resolved. */
  function movesFor(memberId) {
    const pokemon = state.byId.get(memberId);
    const picked = state.moves.get(memberId) || [];
    const moves = [];
    for (const moveId of picked) {
      const move = state.records.get(moveId);
      if (!move) continue;
      moves.push({
        ...move,
        stab: pokemon.types.includes(move.type),
        damaging: isDamaging(move),
      });
    }
    return moves;
  }

  /* ---- controls --------------------------------------------------------- */

  function populateControls(regions) {
    els.region.append(option('', '全部地區'));
    for (const region of regions) els.region.append(option(region, region));

    els.generation.append(option('', '全部世代'));
    const generations = [...new Set(state.roster.map((pokemon) => pokemon.generation))]
      .sort((a, b) => a - b);
    for (const generation of generations) {
      els.generation.append(option(String(generation), `第 ${generation} 世代`));
    }

    els.type.append(option('', '全部屬性'));
    for (const type of TYPE_CHART_ORDER) {
      els.type.append(option(type, TYPE_EN_ZH[type] || type));
    }
  }

  let searchTimer = 0;
  els.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.filters.query = els.search.value;
      applyFilters();
    }, SEARCH_DEBOUNCE_MS);
  });

  els.region.addEventListener('change', () => {
    state.filters.region = els.region.value;
    applyFilters();
  });
  els.generation.addEventListener('change', () => {
    state.filters.generation = els.generation.value;
    applyFilters();
  });
  els.type.addEventListener('change', () => {
    state.filters.type = els.type.value;
    applyFilters();
  });

  els.random.addEventListener('click', () => {
    state.ids = randomTeam(state.roster.map((pokemon) => pokemon.id), TEAM_LIMIT);
    update();
    announce(`已隨機選出 ${state.ids.length} 隻寶可夢。`);
  });

  els.reroll.addEventListener('click', () => {
    if (!state.ids.length) {
      announce('隊伍是空的，請先加入寶可夢。');
      return;
    }
    if (!state.moveTable) {
      ensureMoves();
      announce(state.movesFailed ? '招式資料載入失敗。' : '招式資料載入中，請稍候再試。');
      return;
    }
    for (const id of state.ids) state.moves.set(id, drawMoves(learnedSet(id)));
    update();
    announce(`已重抽 ${state.ids.length} 隻隊員的招式。`);
  });

  els.clear.addEventListener('click', () => {
    if (!state.ids.length) {
      announce('隊伍已經是空的。');
      return;
    }
    state.ids = [];
    update();
    announce('隊伍已清空。');
  });

  els.share.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      announce(state.ids.length
        ? '已複製分享連結。'
        : '目前沒有隊伍，已複製頁面連結。');
    } catch {
      announce('無法複製連結，請直接複製網址列。');
    }
  });

  els.grid.addEventListener('click', (event) => {
    const card = event.target.closest('.tm-card');
    if (!card) return;
    toggle(Number(card.dataset.id));
  });

  els.more.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderGrid();
  });

  for (const list of [els.defense, els.coverage, els.defenseHead, els.coverageHead]) {
    list.addEventListener('pointerover', (event) => {
      const node = event.target.closest('[data-slot]');
      if (node) highlightSlot(Number(node.dataset.slot));
    });
    list.addEventListener('pointerleave', clearHighlight);
  }

  window.addEventListener('popstate', () => {
    const next = new URLSearchParams(location.search);
    state.ids = parseTeamParam(next.get('team'), state.validIds).ids;
    if (state.moveTable) applyMovesParam(next.get('moves'));
    update();
  });

  /* ---- team transitions ------------------------------------------------- */

  function toggle(id) {
    const pokemon = state.byId.get(id);
    if (!pokemon) return;

    if (state.ids.includes(id)) {
      state.ids = removeMember(state.ids, id);
      update();
      announce(`已移除 ${pokemon.names.zh}。`);
      return;
    }

    const result = addMember(state.ids, id, state.validIds);
    if (!result.ok) {
      if (result.reason === 'full') announce(`隊伍已滿（${TEAM_LIMIT} / ${TEAM_LIMIT}），請先移除一隻。`);
      else if (result.reason === 'duplicate') announce(`${pokemon.names.zh} 已在隊伍中。`);
      else announce('找不到這隻寶可夢。');
      return;
    }

    state.ids = result.ids;
    update();
    announce(`已加入 ${pokemon.names.zh}（${state.ids.length} / ${TEAM_LIMIT}）。`);
  }

  function update() {
    if (state.moveTable) seedMoves();
    renderSlots();
    renderAnalysis();
    syncGridPressed();
    els.count.textContent = `${state.ids.length} / ${TEAM_LIMIT}`;
    writeUrl();
    if (!state.moveTable && state.ids.length) ensureMoves();
  }

  function writeUrl() {
    const url = new URL(location.href);
    const pendingMoves = new URLSearchParams(location.search).get('moves');
    url.searchParams.delete('team');
    url.searchParams.delete('moves');
    /* `searchParams.set()` percent-encodes the separator into `1%2C6%2C25`, which
     * is the same URL to a parser and a different one to a reader. The documented
     * form is `?team=1,6,25`; assigning `search` keeps the commas literal while
     * still preserving every other parameter. */
    const rest = url.searchParams.toString();
    const team = state.ids.length ? `team=${serializeTeamParam(state.ids)}` : '';
    /* Until the table lands, the parameter the visitor arrived with is the
     * only copy of their picks. Rewriting it away during the fetch would lose
     * them on an immediate reload; once loaded, the draw is the source. */
    let moves = '';
    if (state.ids.length) {
      if (state.moveTable) moves = `moves=${serializeMovesParam(state.ids, state.moves)}`;
      else if (pendingMoves) moves = `moves=${pendingMoves}`;
    }
    const query = [rest, team, moves].filter(Boolean).join('&');
    url.search = query ? `?${query}` : '';
    history.replaceState(null, '', url);
  }

  /* ---- slots ------------------------------------------------------------ */

  function moveRow(pokemon, memberIndex, slotIndex) {
    const picked = state.moves.get(pokemon.id);
    const move = picked && picked[slotIndex] ? state.records.get(picked[slotIndex]) : null;
    const button = el('button', 'tm-move');
    button.type = 'button';
    button.dataset.member = String(pokemon.id);
    button.dataset.moveSlot = String(slotIndex);

    if (!picked) {
      button.classList.add('is-loading');
      button.disabled = true;
      button.textContent = '⋯';
      button.setAttribute('aria-label', `第 ${slotIndex + 1} 招載入中`);
      return button;
    }

    if (!move) {
      button.classList.add('is-empty');
      button.append(el('span', 'tm-move-label', `＋ 第 ${slotIndex + 1} 招`));
      button.setAttribute('aria-label', `${pokemon.names.zh} 的第 ${slotIndex + 1} 招：選擇招式`);
    } else {
      button.dataset.move = String(move.id);
      const dot = el('span', 'tm-move-dot');
      dot.style.background = TYPE_COLORS[move.type] || '#777777';
      button.append(
        dot,
        el('span', 'tm-move-label', move.zh),
        el('span', 'tm-move-power', powerText(move)),
      );
      button.title = moveSummary(move);
      button.setAttribute(
        'aria-label',
        `${pokemon.names.zh} 的第 ${slotIndex + 1} 招 ${move.zh}（${moveSummary(move)}），點擊更換`,
      );
    }

    button.addEventListener('click', () => openMoveDialog(memberIndex, slotIndex));
    return button;
  }

  function moveList(pokemon, memberIndex) {
    if (state.movesFailed) {
      return el('p', 'tm-moves-error', '招式資料載入失敗');
    }
    const list = el('ul', 'tm-moves');
    for (let slotIndex = 0; slotIndex < MOVES_PER_MEMBER; slotIndex += 1) {
      const item = el('li');
      item.append(moveRow(pokemon, memberIndex, slotIndex));
      list.append(item);
    }
    return list;
  }

  /**
   * The file's own pixels, capped at the slot's box. Both dimensions are
   * written because the `<img>`'s width/height attributes supply a 1:1 ratio
   * and `height: auto` would honour that instead of the GIF's.
   */
  function sizeShowdown(img) {
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const factor = Math.min(ART_SCALE, ART_MAX / longest);
    img.style.width = `${Math.round(img.naturalWidth * factor)}px`;
    img.style.height = `${Math.round(img.naturalHeight * factor)}px`;
  }

  function useShowdown(id, img) {
    img.onload = () => sizeShowdown(img);
    img.src = showdownUrl(id);
  }

  function slotArt(pokemon) {
    const img = el('img', 'tm-slot-art');
    img.src = artworkUrl(pokemon.id);
    img.alt = '';
    img.width = 136;
    img.height = 136;
    img.decoding = 'async';

    showdownReady(pokemon.id).then((ok) => {
      if (ok && img.isConnected) useShowdown(pokemon.id, img);
    });
    return img;
  }

  function renderSlots() {
    slotsEl.textContent = '';
    for (let index = 0; index < TEAM_LIMIT; index += 1) {
      const slot = el('li', 'tm-slot');
      slot.dataset.slot = String(index);
      const id = state.ids[index];
      const pokemon = id === undefined ? null : state.byId.get(id);

      if (!pokemon) {
        slot.classList.add('is-empty');
        const button = el('button', 'tm-slot-add');
        button.type = 'button';
        button.append(
          el('span', 'tm-slot-plus', '＋'),
          el('span', 'tm-slot-hint', '選擇寶可夢'),
        );
        button.addEventListener('click', () => {
          els.search.focus();
          document.getElementById('tm-picker-title')
            ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        });
        slot.append(button);
        slotsEl.append(slot);
        continue;
      }

      slot.classList.add('is-filled');
      const primary = pokemon.types[0];
      const secondary = pokemon.types[1] || primary;
      slot.style.setProperty('--tm-c1', TYPE_COLORS[primary] || '#777777');
      slot.style.setProperty('--tm-c2', TYPE_COLORS[secondary] || '#777777');
      slot.dataset.primary = primary;
      slot.dataset.secondary = secondary;

      const pair = typePair(primary);
      if (pair) {
        slot.style.setProperty('--tm-info-bg', `rgb(${pair.fill.join(', ')})`);
        slot.style.setProperty('--tm-info-fg', `rgb(${pair.text.join(', ')})`);
      }

      const fill = el('div', 'tm-slot-fill');

      const render = el('div', 'tm-slot-render');
      render.append(slotArt(pokemon));

      const remove = el('button', 'tm-slot-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除 ${pokemon.names.zh}`);
      remove.title = `移除 ${pokemon.names.zh}`;
      remove.addEventListener('click', () => toggle(pokemon.id));

      const info = el('div', 'tm-slot-info');
      const name = el('a', 'tm-slot-name', pokemon.names.zh);
      name.href = pokemonDetailUrl(pokemon);
      const types = el('div', 'tm-slot-types');
      for (const type of pokemon.types) {
        const badge = el('span');
        badge.innerHTML = typeBadgeSmHtml(type);
        types.append(badge.firstElementChild);
      }
      info.append(name, types);

      fill.append(render, remove, info, moveList(pokemon, index));
      slot.append(fill);
      slotsEl.append(slot);
    }
  }

  function highlightSlot(index) {
    for (const slot of slotsEl.children) {
      slot.classList.toggle('is-highlight', Number(slot.dataset.slot) === index);
    }
  }

  function clearHighlight() {
    for (const slot of slotsEl.children) slot.classList.remove('is-highlight');
  }

  /* ---- move dialog ------------------------------------------------------ */

  function tabButton(tab, count, active) {
    const button = el('button', 'tm-move-tab');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
    button.dataset.method = tab.key;
    button.append(
      el('span', 'tm-move-tab-label', tab.label),
      el('span', 'tm-move-tab-count', String(count)),
    );
    return button;
  }

  function renderTabs() {
    const memberId = state.ids[dialogState.memberIndex];
    const set = learnedSet(memberId);
    els.tabs.textContent = '';
    const buttons = MOVE_TABS.map((tab) => tabButton(
      tab,
      methodIds(set, tab.key).length,
      tab.key === dialogState.method,
    ));
    els.tabs.append(...buttons);
    wireRoving(buttons, 'aria-checked', (button) => {
      dialogState.method = button.dataset.method;
      renderMoveList();
    });
  }

  function pickRow(pokemon, move, set, current, usedElsewhere) {
    const item = el('li');
    const button = el('button', 'tm-move-pick');
    button.type = 'button';
    button.dataset.move = String(move.id);

    const head = el('span', 'tm-move-pick-head');
    head.append(el('span', 'tm-move-pick-name', move.zh));
    if (move.en) head.append(el('span', 'tm-move-pick-en', move.en));
    const method = methodOf(set, move.id);
    const tab = MOVE_TABS.find((entry) => entry.key === method);
    if (tab) head.append(el('span', 'tm-move-pick-method', tab.label));
    if (current === move.id) head.append(el('span', 'tm-move-pick-now', '目前招式'));

    const meta = el('span', 'tm-move-pick-meta');
    const badge = el('span');
    badge.innerHTML = typeBadgeSmHtml(move.type);
    meta.append(
      badge.firstElementChild,
      el('span', null, classText(move)),
      el('span', null, `威力 ${powerText(move)}`),
      el('span', null, `命中 ${accuracyText(move)}`),
      el('span', null, `PP ${move.pp}`),
      el('span', null, `第 ${move.generation} 世代`),
    );

    button.append(head, meta, el('span', 'tm-move-pick-effect', move.effect || '—'));
    button.setAttribute(
      'aria-label',
      `${move.zh}（${moveSummary(move)}）${usedElsewhere ? '，已用在其他招式欄' : '，選擇'}`,
    );
    button.disabled = usedElsewhere;
    button.addEventListener('click', () => chooseMove(move));
    item.append(button);
    return item;
  }

  function renderMoveList() {
    const memberId = state.ids[dialogState.memberIndex];
    const pokemon = state.byId.get(memberId);
    if (!pokemon) return;

    const set = learnedSet(memberId);
    const query = els.moveSearch.value.trim().toLowerCase();
    const current = (state.moves.get(memberId) || [])[dialogState.slotIndex];
    const usedElsewhere = new Set((state.moves.get(memberId) || [])
      .filter((moveId, index) => index !== dialogState.slotIndex && moveId !== current));

    let moveIds;
    if (query) {
      moveIds = [...allMoveIds(set)].filter((moveId) => {
        const move = state.records.get(moveId);
        return move && (`${move.zh} ${move.en}`.toLowerCase().includes(query));
      });
    } else {
      moveIds = methodIds(set, dialogState.method);
    }

    els.moveList.textContent = '';
    for (const moveId of moveIds) {
      const move = state.records.get(moveId);
      if (move) els.moveList.append(pickRow(pokemon, move, set, current, usedElsewhere.has(moveId)));
    }
    els.moveEmpty.hidden = moveIds.length !== 0;
    els.moveCount.textContent = query
      ? `搜尋到 ${moveIds.length} 個招式`
      : `${MOVE_TABS.find((tab) => tab.key === dialogState.method).label}：${moveIds.length} 個招式`;
  }

  function openMoveDialog(memberIndex, slotIndex) {
    if (state.ids[memberIndex] === undefined) return;
    if (!state.moveTable) {
      announce(state.movesFailed ? '招式資料載入失敗。' : '招式資料載入中，請稍候。');
      ensureMoves();
      return;
    }
    const pokemon = state.byId.get(state.ids[memberIndex]);
    dialogState = { memberIndex, slotIndex, method: 'level' };
    els.dialogTarget.textContent = `${pokemon.names.zh} · 第 ${slotIndex + 1} 招`;
    els.moveSearch.value = '';
    renderTabs();
    renderMoveList();
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
    els.moveSearch.focus();
  }

  function closeMoveDialog() {
    if (typeof els.dialog.close === 'function') els.dialog.close();
    else els.dialog.removeAttribute('open');
  }

  function chooseMove(move) {
    const { memberIndex, slotIndex } = dialogState;
    const memberId = state.ids[memberIndex];
    if (memberId === undefined) return;
    const pokemon = state.byId.get(memberId);

    /* The list keeps a `0` for an empty row, so picking slot 3 on a species
     * with two moves does not shift them up. Duplicates are already disabled
     * in the list; clearing any other slot honours the URL's one-move-one-slot
     * shape even if one reaches this function another way. */
    const picked = state.moves.get(memberId) || [];
    const next = [];
    for (let index = 0; index < MOVES_PER_MEMBER; index += 1) {
      next.push(index === slotIndex ? move.id : (picked[index] || 0));
    }
    state.moves.set(memberId, next);

    closeMoveDialog();
    update();
    const row = slotsEl.querySelector(
      `[data-member="${memberId}"][data-move-slot="${slotIndex}"]`,
    );
    row?.focus();
    announce(`已將 ${pokemon.names.zh} 的第 ${slotIndex + 1} 招換成 ${move.zh}。`);
  }

  if (els.dialog) {
    els.dialogClose.addEventListener('click', closeMoveDialog);
    els.dialog.addEventListener('click', (event) => {
      if (event.target === els.dialog) closeMoveDialog();
    });
    let moveSearchTimer = 0;
    els.moveSearch.addEventListener('input', () => {
      window.clearTimeout(moveSearchTimer);
      moveSearchTimer = window.setTimeout(renderMoveList, SEARCH_DEBOUNCE_MS);
    });
  }

  /* ---- analysis --------------------------------------------------------- */

  function renderAnalysis() {
    const movesById = new Map(state.ids.map((id) => [id, movesFor(id)]));
    const analysis = analyzeTeam(state.ids, state.byId, movesById);
    renderTallyHeads();
    renderSummary(analysis);
    renderDefense(analysis);
    renderCoverage(analysis);

    els.offenseNote.hidden = !analysis.members.length;
    if (!state.moveTable) {
      els.offenseNote.textContent = '招式資料載入中…';
    } else if (analysis.coverage.some((row) => row.count > 0)) {
      els.offenseNote.textContent = `18 種防守屬性中，${analysis.coverage.filter((row) => row.count > 0).length} 種有隊員能用 2× 以上招式命中（含 STAB）。`;
    } else {
      els.offenseNote.textContent = '目前沒有招式能剋制任何防守屬性。';
    }
  }

  function summaryCard(title, body) {
    const card = el('div', 'tm-summary-card');
    card.append(el('h4', null, title), body);
    return card;
  }

  function chips(pairs) {
    const list = el('ul', 'tm-chips');
    for (const [type, suffix] of pairs) {
      const item = el('li');
      const badge = el('span');
      badge.innerHTML = typeBadgeSmHtml(type);
      item.append(badge.firstElementChild);
      if (suffix) item.append(document.createTextNode(suffix));
      list.append(item);
    }
    return list;
  }

  function renderSummary(analysis) {
    els.summary.textContent = '';
    if (!analysis.members.length) return;

    const summary = teamSummary(analysis);

    els.summary.append(summaryCard(
      '共同弱點',
      summary.commonWeaknesses.length
        ? chips(summary.commonWeaknesses.map((row) => [row.type, `×${row.count}`]))
        : el('p', null, '沒有兩隻以上共用的弱點。'),
    ));

    els.summary.append(summaryCard(
      '沒有隊友抵抗',
      summary.unresisted.length
        ? chips(summary.unresisted.map((type) => [type, '']))
        : el('p', null, '每個弱點都至少有一隻隊友能抵抗或免疫。'),
    ));

    els.summary.append(summaryCard(
      '招式未覆蓋',
      summary.uncovered.length
        ? chips(summary.uncovered.map((type) => [type, '']))
        : el('p', null, '18 種屬性全數覆蓋。'),
    ));
  }

  /* The tallies have one column per member; without a header the `+`/`−` marks
   * are three anonymous boxes. The chips are decorative (the marks carry the
   * species in their title), so the whole row is aria-hidden in the HTML. */
  function renderTallyHeads() {
    for (const head of [els.defenseHead, els.coverageHead]) {
      head.textContent = '';
      head.append(el('span', 'tm-tally-head-label', '隊員'), el('span'));
      const members = el('span', 'tm-tally-head-members');
      state.ids.forEach((id, index) => {
        const pokemon = state.byId.get(id);
        if (!pokemon) return;
        const chip = el('span', 'tm-tally-member');
        chip.dataset.slot = String(index);
        chip.title = pokemon.names.zh;
        const img = el('img');
        img.src = spriteUrl(pokemon.id);
        img.alt = '';
        img.width = 22;
        img.height = 22;
        img.loading = 'lazy';
        img.decoding = 'async';
        chip.append(img);
        members.append(chip);
      });
      head.append(members);
    }
  }

  function mark(className, glyph, title, slotIndex) {
    const node = el('li', `tm-mark ${className}`, glyph);
    node.title = title;
    node.dataset.slot = String(slotIndex);
    return node;
  }

  function tallyRow(type, scoreText, marks) {
    const row = el('li', 'tm-tally');
    row.dataset.type = type;

    const typeCell = el('span', 'tm-tally-type');
    const badge = el('span');
    badge.innerHTML = typeBadgeSmHtml(type);
    typeCell.append(badge.firstElementChild);

    const score = el('span', 'tm-tally-score', scoreText);
    const list = el('ol', 'tm-marks');
    list.setAttribute('aria-hidden', 'true');
    list.append(...marks);

    row.append(typeCell, score, list);
    return row;
  }

  function renderDefense(analysis) {
    els.defense.textContent = '';
    for (const row of analysis.defense) {
      const marks = analysis.members.map((member, index) => {
        const name = member.names.zh;
        const multiplier = defensiveMultiplier(member.types, row.type);
        if (multiplier > 1) {
          return mark('is-weak', '−', `${name}：弱點 ${multiplier}×`, index);
        }
        if (multiplier === 0) {
          return mark('is-resist', '0', `${name}：免疫`, index);
        }
        if (multiplier < 1) {
          return mark('is-resist', '+', `${name}：抵抗 ${multiplier}×`, index);
        }
        return mark('is-empty', '', `${name}：普通 1×`, index);
      });

      els.defense.append(tallyRow(
        row.type,
        `${row.score > 0 ? '+' : ''}${row.score}`,
        marks,
      ));
    }
  }

  function renderCoverage(analysis) {
    els.coverage.textContent = '';
    for (const row of analysis.coverage) {
      const defender = TYPE_EN_ZH[row.type] || row.type;
      const marks = analysis.members.map((member, index) => {
        const name = member.names.zh;
        const best = row.marks[index];
        if (!best) {
          return mark('is-empty', '—', `${name}：尚無可計算的招式`, index);
        }
        const total = multiplierText(best.total);
        const detail = `${name}：${best.zh}（${TYPE_EN_ZH[best.type] || best.type}）${multiplierText(best.effectiveness)}×${best.stab ? ' × 1.5 STAB' : ''} = ${total}`;
        if (best.total >= 2) return mark('is-resist', total, detail, index);
        if (best.total < 1) return mark('is-weak', total, detail, index);
        return mark('is-empty', total, detail, index);
      });

      const offline = analysis.members.length && row.marks.every((best) => !best);
      els.coverage.append(tallyRow(
        row.type,
        offline ? '—' : String(row.count),
        marks,
      ));
    }
  }

  /* ---- roster grid ------------------------------------------------------ */

  function applyFilters() {
    state.filtered = filterRoster(state.roster, state.filters);
    state.visible = PAGE_SIZE;
    renderGrid();
  }

  function cardItem(pokemon) {
    const item = el('li');
    const button = el('button', 'tm-card');
    button.type = 'button';
    button.dataset.id = String(pokemon.id);
    button.setAttribute('aria-pressed', state.ids.includes(pokemon.id) ? 'true' : 'false');

    const img = el('img');
    img.src = spriteUrl(pokemon.id);
    img.alt = '';
    img.width = 64;
    img.height = 64;
    img.loading = 'lazy';
    img.decoding = 'async';

    const types = el('span', 'tm-card-types');
    for (const type of pokemon.types) {
      const badge = el('span');
      badge.innerHTML = typeBadgeSmHtml(type);
      types.append(badge.firstElementChild);
    }
    const typeLabels = [...types.children].map((badge) => badge.textContent).join('／');
    button.setAttribute(
      'aria-label',
      `${pokemon.names.zh}（${idText(pokemon.id)}，${typeLabels}）`,
    );

    button.append(
      img,
      el('span', 'tm-card-name', pokemon.names.zh),
      types,
      el('span', 'tm-card-id', idText(pokemon.id)),
    );
    item.append(button);
    return item;
  }

  function renderGrid() {
    const shown = state.filtered.slice(0, state.visible);
    const fragment = document.createDocumentFragment();
    for (const pokemon of shown) fragment.append(cardItem(pokemon));

    els.grid.textContent = '';
    els.grid.append(fragment);

    els.resultline.textContent = state.filtered.length
      ? `符合 ${state.filtered.length} 隻，顯示 ${shown.length} 隻。`
      : '沒有符合條件的寶可夢。';
    els.empty.hidden = state.filtered.length !== 0;
    els.more.hidden = state.visible >= state.filtered.length;
  }

  function syncGridPressed() {
    for (const card of els.grid.querySelectorAll('.tm-card')) {
      card.setAttribute('aria-pressed', state.ids.includes(Number(card.dataset.id)) ? 'true' : 'false');
    }
  }
}
