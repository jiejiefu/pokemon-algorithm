/**
 * `team.html` — six slots, two tallies, one roster grid.
 *
 * The page is a thin shell: every transition lives in `team-state.js` and
 * every matchup in `team-analysis.js`. This module owns the DOM, the URL and
 * the announcements. It also owns the one thing the reference planner does
 * visually and this page must not lose: the slot body is two type colours
 * split on the horizontal, with the name bar using the AA fill/ink pair from
 * `shared.js` rather than a guessed white.
 */

import {
  TYPE_EN_ZH, TYPE_COLORS, typeBadgeSmHtml, typePair, pokemonDetailUrl,
} from './shared.js';
import { spriteUrl } from './color-palette.js';
import { TYPE_CHART_ORDER } from './type-chart.js';
import { analyzeTeam, defensiveMultiplier, teamSummary } from './team-analysis.js';
import {
  TEAM_LIMIT, parseTeamParam, serializeTeamParam, addMember, removeMember,
  filterRoster, randomTeam,
} from './team-state.js';

const PAGE_SIZE = 120;
const SEARCH_DEBOUNCE_MS = 120;

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
    clear: document.getElementById('tm-clear'),
    share: document.getElementById('tm-share'),
    actionStatus: document.getElementById('tm-action-status'),
    statCount: document.getElementById('tm-stat-count'),
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
  };

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
    const next = parseTeamParam(
      new URLSearchParams(location.search).get('team'),
      state.validIds,
    );
    state.ids = next.ids;
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
    renderSlots();
    renderAnalysis();
    syncGridPressed();
    els.count.textContent = `${state.ids.length} / ${TEAM_LIMIT}`;
    writeUrl();
  }

  function writeUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('team');
    /* `searchParams.set()` percent-encodes the separator into `1%2C6%2C25`, which
     * is the same URL to a parser and a different one to a reader. The documented
     * form is `?team=1,6,25`; assigning `search` keeps the commas literal while
     * still preserving every other parameter. */
    const rest = url.searchParams.toString();
    const team = state.ids.length ? `team=${serializeTeamParam(state.ids)}` : '';
    const query = [rest, team].filter(Boolean).join('&');
    url.search = query ? `?${query}` : '';
    history.replaceState(null, '', url);
  }

  /* ---- slots ------------------------------------------------------------ */

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
      const img = el('img', 'tm-slot-sprite');
      img.src = spriteUrl(pokemon.id);
      img.alt = '';
      img.width = 72;
      img.height = 72;
      img.decoding = 'async';
      render.append(img);

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

      fill.append(render, remove, info);
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

  /* ---- analysis --------------------------------------------------------- */

  function renderAnalysis() {
    const analysis = analyzeTeam(state.ids, state.byId);
    renderTallyHeads();
    renderSummary(analysis);
    renderDefense(analysis);
    renderCoverage(analysis);
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
      'STAB 未覆蓋',
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
      const marks = analysis.members.map((member, index) => (
        row.ids.includes(member.id)
          ? mark('is-resist', '✓', `${member.names.zh} 的屬性可剋制 ${TYPE_EN_ZH[row.type] || row.type}`, index)
          : mark('is-empty', '', `${member.names.zh} 的屬性無法剋制 ${TYPE_EN_ZH[row.type] || row.type}`, index)
      ));

      els.coverage.append(tallyRow(row.type, String(row.count), marks));
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
    button.setAttribute('aria-label', `${pokemon.names.zh}（${idText(pokemon.id)}）`);

    const img = el('img');
    img.src = spriteUrl(pokemon.id);
    img.alt = '';
    img.width = 64;
    img.height = 64;
    img.loading = 'lazy';
    img.decoding = 'async';

    button.append(
      img,
      el('span', 'tm-card-name', pokemon.names.zh),
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
