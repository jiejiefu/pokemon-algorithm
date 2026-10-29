/**
 * home-lab.js — wires the homepage ("寶可夢演算法實驗室") together
 * ================================================================
 * The page is one idea: every experiment in the lab fills a Pokédex. This module
 * is the only place that knows about all of it:
 *
 *   hero            the day's scrubbed clip (hero-gen.js / home-hero.js, unchanged)
 *                   + the live counter and today's mission
 *   #dex            the 1,025-cell wall (home-dex-wall.js) and its info panel
 *   #showcase       the two auto-playing demos (home-sections.js, unchanged)
 *   #game           the A* challenge; WINNING IT CATCHES THE TERRAIN POKÉMON
 *   #today          the daily pick as a guaranteed catch
 *   #lab            the index of the other experiments
 *
 * Progress lives in dex-collection.js, so any other page can award a catch too.
 *
 * What it deliberately does NOT do: load pokemon_data.json (2.8 MB). The wall runs
 * on home_dex.json (36 KB) and the daily card on home_daily.json (18 KB), and
 * neither is fetched until its section is near the viewport.
 *
 * THE DAILY DRAW IS THE SAME DRAW AS today.html's
 * -----------------------------------------------
 * `drawDailyFromTable()` lives in home-daily-draw.js, which imports nothing but
 * daily-pick.js so it can be run in bare Node. It is a re-implementation of
 * `drawDaily()` only because that one needs the full 2.8 MB records; the RNG,
 * the seed prefix and the date key are imported, not copied, and
 * `check_home_lab.mjs` asserts the two agree on the drawn id for a run of days —
 * so a divergence fails instead of silently changing what the homepage shows.
 */

import { pokemonDetailUrl } from './shared.js';
import { initHomeHero } from './home-hero.js';
import { heroGenFor, heroVideoUrl, heroPosterUrl } from './hero-gen.js';
import { initHomeSections } from './home-sections.js';
import { drawDailyFromTable } from './home-daily-draw.js';
import { cryPlayer } from './cry-player.js';
import { dex, DEX_SIZE, MILESTONES, nextMilestone } from './dex-collection.js';
import { createDexWall } from './home-dex-wall.js';

const REGIONS = ['關都', '城都', '豐緣', '神奧', '合眾', '卡洛斯', '阿羅拉', '伽勒爾', '帕底亞'];
const TYPE_ZH = { Normal: '一般', Fire: '火', Water: '水', Electric: '電', Grass: '草', Ice: '冰', Fighting: '格鬥', Poison: '毒', Ground: '地面', Flying: '飛行', Psychic: '超能力', Bug: '蟲', Rock: '岩石', Ghost: '幽靈', Dragon: '龍', Dark: '惡', Steel: '鋼', Fairy: '妖精' };
const pad4 = (n) => String(n).padStart(4, '0');
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');

/** Easy / medium / hard from the real capture rate, in words a player uses. */
function difficulty(rate) {
  if (rate >= 150) return '容易';
  if (rate >= 45) return '普通';
  if (rate >= 10) return '困難';
  return '極難';
}

export async function initHomeLab() {
  /* ------------------------------------------------------------- hero clip */
  const video = $('home-hero-video');
  const gen = heroGenFor();
  video.poster = heroPosterUrl(gen);
  video.src = heroVideoUrl(gen);
  initHomeHero({ track: document.querySelector('.hx-hero'), video });
  initHomeSections();

  /* ------------------------------------------------------------------ data */
  let data;
  try {
    const res = await fetch('assets/data/home_dex.json');
    if (!res.ok) throw new Error(`home_dex.json: HTTP ${res.status}`);
    data = await res.json();
  } catch (error) {
    console.error('[home] dex data failed to load', error);
    $('dex')?.setAttribute('data-failed', '');
    $('hx-live').textContent = '圖鑑資料載入失敗，請重新整理頁面。';
    return;
  }

  // Id range of every generation, from the counts in the data.
  const ranges = [];
  data.gens.reduce((lo, n) => { ranges.push([lo, lo + n - 1]); return lo + n; }, 1);
  const todayRange = ranges[gen - 1];
  const nameOf = (id) => data.p[id - 1][5];

  /* ------------------------------------------------------------------ wall */
  const live = $('hx-live');
  const say = (msg) => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };
  const info = { no: $('hx-info-no'), name: $('hx-info-name'), meta: $('hx-info-meta'), throwBtn: $('hx-throw'), result: $('hx-info-result') };
  const tip = $('hx-tip');
  const stage = $('hx-wall-stage');
  // The selected cell is STATE. It used to be read back out of the info panel's
  // own text (`Number(info.no.textContent.replace('#',''))`), which made the
  // throw depend on what had been rendered — an ellipsis, an empty string or a
  // future format change silently threw at species 0.
  let selectedId = 0;

  const wall = createDexWall({
    canvas: $('hx-wall'),
    data,
    dex,
    spriteUrl: (id) => `assets/images/sprite/${id}.png`,
    onCry: (id) => { if (!cryPlayer.muted) cryPlayer.play(id).catch(() => {}); },
    onSelect: showInfo,
    onHover: (id, e) => {
      if (!id) { tip.hidden = true; return; }
      tip.textContent = dex.has(id) ? `#${pad4(id)} ${nameOf(id)}` : `#${pad4(id)} ???`;
      const r = stage.getBoundingClientRect();
      tip.style.left = `${Math.min(r.width - 120, Math.max(0, e.clientX - r.left + 12))}px`;
      tip.style.top = `${Math.max(0, e.clientY - r.top - 34)}px`;
      tip.hidden = false;
    },
    onResult: ({ id, ok, isNew }) => {
      tip.hidden = true; // its text was written before the result changed what the cell is
      const msg = isNew ? `抓到了！${nameOf(id)}（#${pad4(id)}）`
        : ok ? `${nameOf(id)} 已經在圖鑑裡了`
          : `#${pad4(id)} 掙脫了，再試一次`;
      info.result.textContent = msg;
      info.result.dataset.state = isNew ? 'caught' : ok ? 'have' : 'miss';
      say(msg);
      showInfo(id);
    },
  });
  wall.setToday(todayRange[0], todayRange[1]);

  function showInfo(id) {
    selectedId = id || 0;
    if (!selectedId) {
      info.no.textContent = '';
      info.name.textContent = '還沒選格子';
      info.meta.textContent = '點一格，或用方向鍵移動、Enter 丟球。';
      info.throwBtn.disabled = true;
      return;
    }
    const row = data.p[selectedId - 1];
    const have = dex.has(selectedId);
    info.no.textContent = `#${pad4(selectedId)}`;
    info.name.textContent = have ? row[5] : '？？？';
    const types = [row[2], row[3]].filter((t) => t >= 0).map((t) => TYPE_ZH[data.types[t]] || data.types[t]).join(' / ');
    info.meta.textContent = have
      ? `第 ${row[0]} 世代 ${REGIONS[row[0] - 1]} · ${types}`
      : `第 ${row[0]} 世代 ${REGIONS[row[0] - 1]} · 難度${difficulty(row[4])}`;
    info.throwBtn.disabled = false;
    info.throwBtn.textContent = have ? '再聽一次叫聲' : '丟出精靈球';
  }
  info.throwBtn.addEventListener('click', () => {
    if (selectedId) wall.attempt(selectedId);
  });
  showInfo(0);

  /* ------------------------------------------------------------------- HUD */
  const bars = document.querySelectorAll('[data-hx-fill]');
  const counts = document.querySelectorAll('[data-hx-count]');
  const recent = $('hx-recent');
  const regionList = $('hx-region-list');

  // Built once; renderHud only updates their numbers.
  regionList.innerHTML = ranges.map(([lo, hi], i) => `
    <li class="hx-region" data-gen="${i + 1}">
      <span class="hx-region-name">第 ${i + 1} 世代 ${REGIONS[i]}<span class="hx-region-tag" hidden>今日</span></span>
      <span class="hx-region-bar" aria-hidden="true"><i></i></span>
      <span class="hx-region-n"><b data-n>0</b> / ${hi - lo + 1}</span>
    </li>`).join('');

  function renderHud() {
    const n = dex.size;
    const p = n / DEX_SIZE;
    for (const el of counts) el.textContent = fmt(n);
    for (const el of bars) el.style.setProperty('--p', p.toFixed(4));
    for (const el of document.querySelectorAll('[role="progressbar"][data-hx-total]')) el.setAttribute('aria-valuenow', String(n));

    const next = nextMilestone(n);
    $('hx-next').textContent = next ? `下一個里程碑：${fmt(next)} 隻（還差 ${fmt(next - n)}）` : '圖鑑完成，全部收集了。';

    const [lo, hi] = todayRange;
    const t = dex.countRange(lo, hi);
    const tSize = hi - lo + 1;
    $('hx-mission').textContent = t >= tSize
      ? `今日任務完成：第 ${gen} 世代 ${REGIONS[gen - 1]} 全部收齊`
      : `今日任務：收集第 ${gen} 世代 ${REGIONS[gen - 1]}，${t} / ${tSize}`;
    $('hx-mission').dataset.done = String(t >= tSize);

    regionList.querySelectorAll('.hx-region').forEach((li, i) => {
      const [a, b] = ranges[i];
      const c = dex.countRange(a, b);
      const size = b - a + 1;
      li.querySelector('[data-n]').textContent = c;
      li.style.setProperty('--p', (c / size).toFixed(4));
      li.classList.toggle('is-today', i + 1 === gen);
      li.querySelector('.hx-region-tag').hidden = i + 1 !== gen;
      li.classList.toggle('is-done', c === size);
    });

    const last = dex.ids().slice(-8).reverse();
    recent.replaceChildren(...last.map((id) => {
      const img = new Image();
      img.src = `assets/images/sprite/${id}.png`;
      img.alt = nameOf(id);
      img.title = `#${pad4(id)} ${nameOf(id)}`;
      img.width = 36;
      img.height = 36;
      return img;
    }));
    $('hx-recent-wrap').hidden = last.length === 0;

    $('hx-intro-line').textContent = n === 0 ? '圖鑑還是空的。往下，點一格開始。' : '繼續收集，每個實驗都會讓圖鑑多亮幾格。';
    $('hx-storage-note').hidden = dex.persistent;
  }

  const toast = $('hx-toast');
  let toastTimer = 0;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  dex.onChange((e) => {
    renderHud();
    if (e.type !== 'catch') return;
    if (MILESTONES.includes(e.size)) {
      showToast(e.size === DEX_SIZE ? '圖鑑完成！1,025 隻全部收集了。' : `里程碑：已收集 ${fmt(e.size)} 隻`);
      say(toast.textContent);
    }
    const [lo, hi] = todayRange;
    if (dex.countRange(lo, hi) === hi - lo + 1 && e.id >= lo && e.id <= hi) showToast(`今日任務完成：第 ${gen} 世代 ${REGIONS[gen - 1]}`);
  });
  renderHud();

  $('hx-reset').addEventListener('click', () => {
    if (dex.size === 0) return;
    if (window.confirm(`要清空圖鑑重新開始嗎？目前已收集 ${dex.size} 隻。`)) dex.reset();
  });

  /* --------------------------------------------- A* challenge: win = catch */
  document.addEventListener('maze:result', (e) => {
    const { won, id } = e.detail || {};
    if (!won || !Number.isInteger(id)) return;
    const isNew = dex.catch(id, 'maze');
    const name = id <= data.p.length ? nameOf(id) : '';
    $('hx-game-reward').textContent = isNew ? `獎勵：抓到了 ${name}（#${pad4(id)}）` : `${name} 已經在你的圖鑑裡了`;
    $('hx-game-reward').dataset.state = isNew ? 'caught' : 'have';
    if (isNew) say(`獎勵：抓到了 ${name}`);
  });

  /* --------------------------------------------- today's encounter (lazy) */
  const todaySection = $('today');
  let dailyLoaded = false;
  async function loadDaily() {
    if (dailyLoaded) return;
    dailyLoaded = true;
    try {
      const res = await fetch('assets/data/home_daily.json');
      if (!res.ok) throw new Error(`home_daily.json: HTTP ${res.status}`);
      const table = await res.json();
      const draw = drawDailyFromTable(table);
      if (!draw) throw new Error('empty daily pool');
      renderDaily(draw.id, table.p[draw.id]);
    } catch (error) {
      console.error('[home] daily pick failed', error);
      $('hx-daily-loading').textContent = '今日寶可夢暫時載入失敗，請稍後再試。';
    }
  }
  function renderDaily(id, row) {
    const [zh, en, types, desc, filename] = row;
    const img = $('hx-daily-img');
    img.src = `assets/images/pokemon/${filename}`;
    img.alt = zh;
    $('hx-daily-no').textContent = `#${pad4(id)}`;
    $('hx-daily-name').textContent = zh;
    $('hx-daily-types').textContent = types;
    $('hx-daily-desc').textContent = desc;
    $('hx-daily-link').href = pokemonDetailUrl({ names: { en } });
    const btn = $('hx-daily-catch');
    const sync = () => {
      const have = dex.has(id);
      btn.textContent = have ? '今天已收服，聽牠的叫聲' : '收服今日寶可夢';
      btn.dataset.state = have ? 'have' : 'new';
    };
    btn.onclick = () => {
      if (!cryPlayer.muted) cryPlayer.play(id).catch(() => {});
      if (dex.catch(id, 'daily')) say(`收服了 ${zh}`);
      sync();
    };
    dex.onChange(sync);
    sync();
    $('hx-daily').hidden = false;
  }
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); loadDaily(); }
  }, { rootMargin: '300px 0px' }).observe(todaySection);

  // The wall needs the theme tokens re-read if they ever change; the page pins
  // dark, so this is a no-op today, but it keeps the canvas honest if that changes.
  new MutationObserver(() => wall.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
