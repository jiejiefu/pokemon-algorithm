/**
 * `silhouette-draft.html`'s DOM half.
 *
 * The rules live in `silhouette-draft-game.js`; this file only fetches the
 * compact roster, paints the current state and wires the controls. A round
 * stops on its reveal until `nextRound()`; `confirmMatch()` likewise stops on
 * the sixth analysis. Every click re-renders from the session rather than
 * editing a card in place, so a stale slot cannot disagree with the state.
 */

import { typeBadgeSmHtml } from './shared.js';
import { spriteUrl } from './color-palette.js';
import {
  createDraftSession,
  multiplierText,
  ROUNDS,
  TEAM_SIZE,
} from './silhouette-draft-game.js';

const DATA_URL = 'assets/data/draft_roster.json';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const typesHtml = (types) => types.map((type) => typeBadgeSmHtml(type)).join('');

const multClass = (multiplier) => (
  multiplier === null || multiplier === undefined
    ? 'sd-mult--none'
    : `sd-mult--${multiplier}`
);

const outcomeText = (outcome) => ({ win: '勝', draw: '平', loss: '敗' }[outcome] || '—');
const verdictText = (verdict) => ({ win: '勝利', draw: '平手', loss: '敗北' }[verdict] || '—');

/** A move row: name, optional type badge, optional multiplier chip. */
function moveRow(move, multiplier, showType) {
  return `<li class="sd-move">
    <span class="sd-move-name">${esc(move.zh)}</span>
    ${showType ? typeBadgeSmHtml(move.type) : ''}
    ${multiplier === undefined ? '' : `<span class="sd-mult ${multClass(multiplier)}">${multiplierText(multiplier)}</span>`}
  </li>`;
}

function focusFirst(selector) {
  const node = document.querySelector(selector);
  if (node) node.focus({ preventScroll: true });
}

export async function initSilhouetteDraft() {
  const status = $('sd-status');
  if (!status) return;

  let data;
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    status.textContent = `選秀池載入失敗：${error.message}。請確認是透過 HTTP 開啟頁面。`;
    return;
  }

  let session = createDraftSession(data);
  let pending = null;

  const byId = new Map(session.roster.map((pokemon) => [pokemon.id, pokemon]));
  const fmtTotal = (value) => Number(value.toFixed(2));

  function revealCard(label, pokemon, modifier) {
    return `<article class="sd-pick-card sd-pick-card--${modifier}">
      <p class="sd-pick-label">${esc(label)}</p>
      <img src="${spriteUrl(pokemon.id)}" alt="" width="88" height="88" decoding="async">
      <p class="sd-pick-name">${esc(pokemon.zh)} <span>${esc(pokemon.en)}</span></p>
      <div class="sd-reveal-types">${typesHtml(pokemon.types)}</div>
      <ul class="sd-reveal-moves">
        ${pokemon.moves.map((move) => moveRow(move, undefined, true)).join('')}
      </ul>
    </article>`;
  }

  function renderRoundResult() {
    const result = session.pendingRound;
    if (!result) {
      $('sd-reveal').hidden = true;
      $('sd-reveal-head').innerHTML = '';
      $('sd-reveal-cols').innerHTML = '';
      return;
    }

    $('sd-reveal').hidden = false;
    $('sd-reveal-head').innerHTML = `
      <h3>第 ${result.round} 輪結果</h3>
      <p>你選了 ${esc(result.player.zh)}；電腦從剩下的五隻拿走 ${esc(result.opponent.zh)}。</p>`;
    $('sd-reveal-cols').innerHTML = [
      revealCard('你', result.player, 'player'),
      '<div class="sd-vs" aria-hidden="true">VS</div>',
      revealCard('對手', result.opponent, 'opponent'),
    ].join('');
    $('sd-next-round').textContent = session.team.length >= TEAM_SIZE ? '開始對位' : '下一輪';
  }

  function renderCandidates() {
    const list = $('sd-candidates');
    list.innerHTML = session.candidates.map((id, index) => {
      const pokemon = byId.get(id);
      const pressed = session.selectedId === id;
      return `<li class="sd-card">
        <button class="sd-card-btn" type="button" data-id="${id}"
          aria-pressed="${pressed}" aria-label="第 ${index + 1} 個剪影，${pokemon.moves.length} 個招式">
          <span class="sd-silhouette" aria-hidden="true">
            <img src="${spriteUrl(id)}" alt="" width="96" height="96" decoding="async">
          </span>
          <ul class="sd-card-moves">
            ${pokemon.moves.map((move) => moveRow(move, undefined, true)).join('')}
          </ul>
          ${pokemon.short ? `<p class="sd-short">僅 ${pokemon.moves.length} 招</p>` : ''}
        </button>
      </li>`;
    }).join('');

    const selected = session.selectedId === null ? null : byId.get(session.selectedId);
    const selectedIndex = selected ? session.candidates.indexOf(selected.id) : -1;
    $('sd-selected').textContent = selected
      ? `已選第 ${selectedIndex + 1} 個剪影，確認後才揭曉。`
      : '尚未選擇';
    const confirm = $('sd-confirm');
    confirm.disabled = !session.canConfirmPick;
    confirm.textContent = `確認第 ${session.round} 隻`;
    $('sd-instruction').textContent = `第 ${session.round} / ${ROUNDS} 輪：點一隻剪影，再按確認。電腦會從剩下的五隻拿走一隻；名字與本體屬性在確認後揭曉。`;
  }

  function slotHtml(id, index, side) {
    if (id === undefined) {
      return `<li class="sd-slot"><span class="sd-slot-empty">第 ${index + 1} 隻</span></li>`;
    }
    const pokemon = byId.get(id);
    const used = side === 'player' && session.isUsed(id);
    const current = side === 'opponent' && session.phase === 'match'
      && index === session.matchIndex;
    const classes = [
      'sd-slot',
      'sd-slot--filled',
      used ? 'sd-slot--used' : '',
      current ? 'sd-slot--current' : '',
    ].filter(Boolean).join(' ');
    return `<li class="${classes}">
      <img src="${spriteUrl(id)}" alt="" width="72" height="72" decoding="async">
      <span class="sd-slot-name">${esc(pokemon.zh)}</span>
      <span class="sd-slot-types">${typesHtml(pokemon.types)}</span>
    </li>`;
  }

  function renderTeam() {
    $('sd-team-count').textContent = `你 ${session.team.length} / ${TEAM_SIZE}`;
    $('sd-opponent-team-count').textContent = `對手 ${session.opponent.length} / ${TEAM_SIZE}`;
    $('sd-team').innerHTML = Array.from({ length: TEAM_SIZE }, (_, index) => (
      slotHtml(session.team[index], index, 'player')
    )).join('');
    $('sd-opponent-team').innerHTML = Array.from({ length: TEAM_SIZE }, (_, index) => (
      slotHtml(session.opponent[index], index, 'opponent')
    )).join('');
  }

  function renderOpponent(opponent) {
    $('sd-opponent').innerHTML = `
      <div class="sd-opponent-hero">
        <img src="${spriteUrl(opponent.id)}" alt="" width="112" height="112" decoding="async">
        <div>
          <p class="sd-opponent-name">${esc(opponent.zh)}</p>
          <div class="sd-type-row">${typesHtml(opponent.types)}</div>
        </div>
      </div>
      <ul class="sd-opponent-moves">
        ${opponent.moves.map((move) => moveRow(move, undefined, true)).join('')}
      </ul>`;

    $('sd-opponent-count').textContent = pending
      ? `第 ${session.matchIndex} / ${TEAM_SIZE} 組結果`
      : `第 ${session.currentMatchNumber} / ${TEAM_SIZE} 組`;
    $('sd-opponent-backs').innerHTML = session.opponent.map((id, index) => {
      const pokemon = byId.get(id);
      const state = pending
        ? (index < session.matchIndex ? 'used' : 'next')
        : (index < session.matchIndex ? 'used' : index === session.matchIndex ? 'current' : 'next');
      return `<li class="sd-opponent-pick sd-opponent-pick--${state}">
        <img src="${spriteUrl(id)}" alt="" width="40" height="40" decoding="async">
        <span>${esc(pokemon.zh)}</span>
      </li>`;
    }).join('');
  }

  function renderMatchTeam() {
    $('sd-match-team').innerHTML = session.team.map((id) => {
      const pokemon = byId.get(id);
      const used = session.isUsed(id);
      const pressed = session.matchPlayerId === id;
      return `<li>
        <button class="sd-member" type="button" data-id="${id}"
          aria-pressed="${pressed}" ${used ? 'disabled' : ''}>
          <img src="${spriteUrl(id)}" alt="" width="56" height="56" decoding="async">
          <span class="sd-member-name">${esc(pokemon.zh)}</span>
        </button>
      </li>`;
    }).join('');

    const selected = session.matchPlayerId === null ? null : byId.get(session.matchPlayerId);
    $('sd-match-selected').textContent = selected ? `已選：${selected.zh}` : '尚未選擇';
    const confirm = $('sd-match-confirm');
    confirm.disabled = !session.canConfirmMatch;
  }

  function renderAnalysis(matchup) {
    const box = $('sd-analysis');
    if (!matchup) {
      box.hidden = true;
      $('sd-analysis-cols').innerHTML = '';
      $('sd-analysis-outcome').textContent = '';
      return;
    }
    box.hidden = false;
    $('sd-analysis-outcome').textContent = `本組結果：${outcomeText(matchup.outcome)}`;
    $('sd-analysis-outcome').className = `sd-analysis-outcome sd-outcome--${matchup.outcome}`;

    const column = (title, profile) => `
      <div class="sd-analysis-col">
        <h4>${esc(title)}</h4>
        <ul class="sd-analysis-moves">
          ${profile.moves.map((move) => moveRow(move, move.multiplier, true)).join('')}
        </ul>
        <p class="sd-best">最佳倍率 <strong>${multiplierText(profile.best)}</strong></p>
      </div>`;

    $('sd-analysis-cols').innerHTML = [
      column(`我方 ${matchup.player.zh} 的招式 → 對手 ${matchup.opponent.zh}`, matchup.playerOffense),
      column(`對手 ${matchup.opponent.zh} 的招式 → 我方 ${matchup.player.zh}`, matchup.computerOffense),
    ].join('');

    $('sd-next').textContent = session.matchIndex >= TEAM_SIZE ? '查看總結' : '下一組';
  }

  function renderScore() {
    const record = { wins: 0, draws: 0, losses: 0 };
    let playerTotal = 0;
    let computerTotal = 0;
    for (const matchup of session.matchups) {
      if (matchup.outcome === 'win') record.wins += 1;
      else if (matchup.outcome === 'loss') record.losses += 1;
      else record.draws += 1;
      playerTotal += matchup.playerOffense.best ?? 0;
      computerTotal += matchup.computerOffense.best ?? 0;
    }
    $('sd-score').textContent = `你 ${record.wins} 勝 ${record.draws} 平 ${record.losses} 敗 · 總倍率 ${fmtTotal(playerTotal)} : ${fmtTotal(computerTotal)}`;
  }

  function renderMatch() {
    const opponent = pending ? pending.opponent : session.currentOpponent;
    if (!opponent) return;

    renderScore();
    renderOpponent(opponent);
    $('sd-match-pick').hidden = Boolean(pending);
    renderMatchTeam();
    renderAnalysis(pending);

    $('sd-match-instruction').textContent = `第 ${session.currentMatchNumber} 組：對手是 ${opponent.zh}，選一隻還沒上場的隊員派出。`;
  }

  function renderSummary() {
    const summary = session.summary();
    $('sd-summary-rows').innerHTML = summary.rows.map((matchup) => `
      <tr>
        <td>${matchup.index}</td>
        <td>${esc(matchup.player.zh)}</td>
        <td>${esc(matchup.opponent.zh)}</td>
        <td>${multiplierText(matchup.playerOffense.best)}</td>
        <td>${multiplierText(matchup.computerOffense.best)}</td>
        <td class="sd-outcome--${matchup.outcome}">${outcomeText(matchup.outcome)}</td>
      </tr>`).join('');

    $('sd-summary-result').innerHTML = `
      <p class="sd-verdict sd-verdict--${summary.verdict}">${verdictText(summary.verdict)}</p>
      <p class="sd-summary-record">
        ${summary.record.wins} 勝 ${summary.record.draws} 平 ${summary.record.losses} 敗
        · 總倍率 ${fmtTotal(summary.playerTotal)} : ${fmtTotal(summary.computerTotal)}
        · ${esc(summary.grade)} 級
      </p>`;

    const tally = (title, bands) => `
      <div class="sd-tally">
        <h3>${esc(title)}</h3>
        <div class="sd-tally-row">
          ${bands.map((band) => `<span class="sd-tally-cell">${band.multiplier === null ? '—' : `${band.multiplier}×`}<strong>${band.count}</strong></span>`).join('')}
        </div>
      </div>`;

    $('sd-summary-tallies').innerHTML = [
      tally('我方每組最佳倍率', summary.player),
      tally('對手每組最佳倍率', summary.computer),
    ].join('');
  }

  function render() {
    const phase = session.phase;
    $('sd-draft').hidden = phase !== 'draft';
    $('sd-match').hidden = phase !== 'match';
    $('sd-summary').hidden = phase !== 'summary';

    const revealed = Boolean(session.pendingRound);
    $('sd-pick-area').hidden = phase !== 'draft' || revealed;
    $('sd-reveal').hidden = phase !== 'draft' || !revealed;

    $('sd-round').textContent = `第 ${Math.min(session.round, ROUNDS)} / ${ROUNDS} 輪`;
    $('sd-phase').textContent = phase === 'draft'
      ? (revealed ? '揭曉' : '盲選')
      : phase === 'match' ? '對位' : '總結';
    $('sd-progress').textContent = `${session.team.length} / ${TEAM_SIZE} 隻`;

    renderTeam();

    if (phase === 'draft') {
      renderCandidates();
      renderRoundResult();
      if (revealed) {
        const { player, opponent } = session.pendingRound;
        const next = session.team.length >= TEAM_SIZE ? '開始對位' : '下一輪';
        status.textContent = `第 ${session.round} 輪：你選了 ${player.zh}，電腦拿走 ${opponent.zh}。按「${next}」繼續。`;
      } else if (session.selectedId !== null) {
        const index = session.candidates.indexOf(session.selectedId) + 1;
        status.textContent = `已選第 ${index} 個剪影；按「確認第 ${session.round} 隻」鎖定。`;
      } else {
        status.textContent = `第 ${session.round} 輪：6 隻剪影，選 1 隻。`;
      }
      return;
    }

    if (phase === 'match') {
      renderMatch();
      if (pending) {
        status.textContent = session.matchIndex >= TEAM_SIZE
          ? '六組對位完成，按「查看總結」。'
          : `第 ${pending.index} 組對位完成，按「下一組」。`;
      } else {
        status.textContent = `第 ${session.currentMatchNumber} 組：對手是 ${session.currentOpponent?.zh || '—'}，選一隻未上場的隊員。`;
      }
      return;
    }

    renderSummary();
    const summary = session.summary();
    status.textContent = `選秀與六組對位完成：${verdictText(summary.verdict)}，${summary.record.wins} 勝 ${summary.record.draws} 平 ${summary.record.losses} 敗。`;
  }

  $('sd-candidates').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    if (session.select(Number(button.dataset.id))) {
      render();
      focusFirst('#sd-candidates button[aria-pressed="true"]');
    }
  });

  $('sd-confirm').addEventListener('click', () => {
    const result = session.confirmPick();
    if (!result) return;
    pending = null;
    render();
    focusFirst('#sd-next-round');
  });

  $('sd-next-round').addEventListener('click', () => {
    const advanced = session.nextRound();
    if (!advanced) return;
    pending = null;
    render();
    if (advanced.phase === 'match') focusFirst('#sd-match-team button:not(:disabled)');
    else focusFirst('#sd-candidates button');
  });

  $('sd-match-team').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button || button.disabled) return;
    if (session.selectMatchMember(Number(button.dataset.id))) {
      render();
      focusFirst('.sd-member[aria-pressed="true"]');
    }
  });

  $('sd-match-confirm').addEventListener('click', () => {
    const matchup = session.confirmMatch();
    if (!matchup) return;
    pending = matchup;
    render();
    focusFirst('#sd-next');
  });

  $('sd-next').addEventListener('click', () => {
    if (!pending) return;
    if (session.matchIndex >= TEAM_SIZE) {
      session.finish();
      pending = null;
      render();
      focusFirst('#sd-restart');
      return;
    }
    pending = null;
    render();
    focusFirst('#sd-match-team button:not(:disabled)');
  });

  $('sd-restart').addEventListener('click', () => {
    session = createDraftSession(data);
    pending = null;
    render();
    $('sd-board-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    focusFirst('#sd-candidates button');
  });

  render();
}
