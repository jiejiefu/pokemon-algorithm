/**
 * pokefarm.js — page controller for pokefarm.html
 * ================================================
 * The simulation (pokefarm-engine.js) is pure and knows nothing about the DOM;
 * the pixel art (pokefarm-art.js) draws the board onto a canvas; this file is the
 * glue: the game loop, the three phases of a day, the click-to-assign
 * interaction, the side panels and the dusk comparison.
 *
 * PHASES
 *   morning  paused at t = 0. The shop is open (seeds, plots, water tank, hiring).
 *            "開始今天" takes a snapshot of the world and starts the clock.
 *   day      120 s of simulated time, stepped at a fixed 0.1 s from a
 *            requestAnimationFrame accumulator so 1×/2×/4× change only how many
 *            steps run per frame, never what a step does.
 *   dusk     endDay() sells and rolls the night; the dialog replays the SAME
 *            morning snapshot under each of the four scheduling algorithms and
 *            sets the player's net-worth gain beside theirs.
 *
 * WORKERS ARE DOM IMAGES, not canvas pixels. A Showdown sprite is an animated
 * GIF, and a GIF cannot animate when drawn to a canvas, so each worker is an
 * <img> laid over the board and moved with a transform. Facing: "down" shows the
 * front GIF, "up" the back GIF, "left" the front GIF and "right" the front GIF
 * mirrored. If the remote GIF fails (offline, blocked) the local static sprite
 * takes over and gets a CSS hop so a worker still visibly moves.
 * (Checked by eye on 12 species incl. #1/#4/#7/#25/#6/#143/#94/#150/#129/#52/#66/#133:
 * front GIFs look toward the viewer and slightly to their left, back GIFs away
 * and slightly to their right, so mirroring the front GIF is the right way to
 * face "right".)
 *
 * PERSISTENCE: the world is saved to localStorage ONLY at the morning state, so a
 * reload mid-day returns to that morning, which is exactly the snapshot the dusk
 * comparison needs anyway.
 *
 * INTERACTION (works with mouse, touch and keyboard)
 *   click a worker (or its card, or press 1–9)  → selected
 *   click a tile (or move the cursor and press Enter), or a row of the 工作 tab
 *                                                → assign the selected worker
 *   Esc                                          → deselect
 */
import {
  STRATEGIES, createWorld, addWorker, syncTasks, assign, step, endDay, compareStrategies,
  netWorth, taskValue, clearMethod, canDo, unlockPlots, upgradeTank, hire, hireCost, setSeed, berryTotal,
  buyUpgrade, upgradeCost, weatherOf, orderHave, repMultiplier, orderSlots, ensureOrders,
  PLOT_UNLOCK_COST, TANK_UPGRADE_COST,
  seasonInfo, seasonGate, addLoaner, seasonGoal, ratingOf, ensureSeason, seedCost, isActive, hashStr, keepLoaner,
} from './pokefarm-engine.js';
import {
  DAY_SECONDS, STEP, SAVE_KEY, GRID, WELL, KITCHEN, WAREHOUSE, BERRIES, BERRY_IDS, FLAVOR_ZH,
  STARTERS, JOB_NAME, WEATHER, WEATHER_NOTE, UPGRADES, UPKEEP_DIV, gifUrl, staticUrl, buildWorker, topJobs, visitorIds,
  SEASONS, SEASON_KEYS, SEASON_DAYS, RUN_DAYS, RATINGS, BEST_KEY, DAILY_KEY, STRICT_SCALE, HAZARD_PLAN,
} from './pokefarm-data.js';
import {
  initAudio, setScene, stinger, sfx, jobSfx, playSfx, unlock as unlockAudio, isMuted, setMuted, setVolume, getPrefs, nowPlaying, soundTest, pickVariant, STINGERS,
} from './pokefarm-audio.js';
import { drawBoard } from './pokefarm-art.js';
import { dex } from './dex-collection.js';
import { taipeiDateKey } from './daily-pick.js';
import { cryPlayer } from './cry-player.js';

const MAX_WORKERS = 8;
const TYPE_NAMES_FALLBACK = { 1: ['Grass', 'Poison'], 4: ['Fire'], 7: ['Water'] };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('pf-stage'), board: $('pf-board'), workers: $('pf-workers'), pops: $('pf-pops'), ring: $('pf-ring'), tip: $('pf-tip'),
  hint: $('pf-hint'), day: $('pf-day'), clock: $('pf-clock'), timeMeter: $('pf-time-meter'), coins: $('pf-coins'),
  water: $('pf-water'), waterMeter: $('pf-water-meter'), wood: $('pf-wood'), stock: $('pf-stock'), flavor: $('pf-flavor'),
  weather: $('pf-weather'), forecast: $('pf-forecast'), weatherChip: $('pf-weather-chip'),
  strategy: $('pf-strategy'), pause: $('pf-pause'), start: $('pf-start'), jobCount: $('pf-jobcount'),
  ordersChip: $('pf-orders-chip'), ordersN: $('pf-orders-n'), rep: $('pf-rep'), orderCount: $('pf-ordercount'),
  help: $('pf-help'), helpBtn: $('pf-helpbtn'), helpClose: $('pf-help-close'),
  panels: { orders: $('pf-panel-orders'), workers: $('pf-panel-workers'), jobs: $('pf-panel-jobs'), shop: $('pf-panel-shop'), log: $('pf-panel-log') },
  tabs: [...document.querySelectorAll('.pf-tab')],
  dialog: $('pf-dusk-dialog'), duskBody: $('pf-dusk-body'), next: $('pf-next'), reset: $('pf-reset'),
  toast: $('pf-toast'), live: $('pf-live'),
  seasonChip: $('pf-season-chip'), season: $('pf-season'), seasonDay: $('pf-season-day'), alert: $('pf-alert'), flash: $('pf-flash'),
  startDlg: $('pf-start-dialog'), seasonPick: $('pf-season-pick'), best: $('pf-best'),
  runDlg: $('pf-run-dialog'), runBody: $('pf-run-body'), runEndless: $('pf-run-endless'), runAgain: $('pf-run-again'),
  soundBtn: $('pf-soundbtn'), soundDlg: $('pf-sound-dialog'), mute: $('pf-mute'), volMusic: $('pf-vol-music'), volSfx: $('pf-vol-sfx'),
  optStrict: $('pf-opt-strict'), dailyBtn: $('pf-daily'), dailyNote: $('pf-daily-note'), runShare: $('pf-run-share'),
  nowPlaying: $('pf-nowplaying'), soundTest: $('pf-soundtest'), soundClose: $('pf-sound-close'),
};
const g = el.board.getContext('2d');

/* ------------------------------------------------------------------ state */

let world = null;
let snapshot = null;                // the morning world, for the dusk comparison
let phase = 'morning';              // 'morning' | 'day' | 'dusk'
let paused = false;
let speed = 1;
let selected = -1;                  // index into world.workers
let cursor = { x: 5, y: 2 };
let activeTab = 'workers';
let usedStrategies = new Set();
let roster = [];                    // home_roster.json rows by id - 1
let typeTable = [];                 // home_dex.json type names
let typeRows = [];                  // home_dex.json p rows by id - 1
let dataReady = false;
let abilityRows = {};              // species_abilities.json: id -> { reg: [slug], hid: [slug] }
let abilityZh = {};                // abilities_zh.json: slug -> { zh }
const seenFx = new WeakSet();
let seenLog = 0;
const nodes = new Map();            // worker id -> { root, img, tag, bar, ... }
let tilePx = 48;
let resetArmed = false;

/* ------------------------------------------------------------- small utils */

const f1 = (n) => (Math.round(n * 10) / 10).toString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const berryName = (id) => BERRIES[id]?.zh ?? id;

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.toast.hidden = true; }, 2600);
}
function say(msg) { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); }
function hint(msg) { el.hint.textContent = msg; }

/** Replace a panel's HTML only when it changed, and keep keyboard focus on the same control. */
function setHTML(node, html) {
  if (node.__html === html) return;
  node.__html = html;
  const a = document.activeElement;
  const key = a && node.contains(a) ? a.getAttribute('data-key') : null;
  const sel = key && a.tagName === 'INPUT' ? { s: a.selectionStart, e: a.selectionEnd } : null;
  node.innerHTML = html;
  if (key) {
    const again = node.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) { again.focus({ preventScroll: true }); if (sel && again.setSelectionRange) again.setSelectionRange(sel.s, sel.e); }
  }
}

/* ------------------------------------------------------------------ data */

async function loadData() {
  try {
    const [r, d, ab, abz] = await Promise.all([
      fetch('assets/data/home_roster.json').then((x) => x.json()),
      fetch('assets/data/home_dex.json').then((x) => x.json()),
      fetch('assets/data/species_abilities.json').then((x) => x.json()).catch(() => ({})),
      fetch('assets/data/abilities_zh.json').then((x) => x.json()).catch(() => ({})),
    ]);
    abilityRows = ab; abilityZh = abz;
    roster = []; for (const row of r) roster[row.id - 1] = row;
    typeTable = d.types; typeRows = d.p;
    dataReady = true;
  } catch {
    dataReady = false;           // starters still work from the fallback table
  }
}
function typesOf(id) {
  const row = typeRows[id - 1];
  if (!row) return TYPE_NAMES_FALLBACK[id] || ['Normal'];
  return [row[2], row[3]].filter((i) => i >= 0).map((i) => typeTable[i]);
}
/** The species' first regular ability and its first hidden one, as buildWorker wants them. */
function abilitiesOf(id) {
  const a = abilityRows[id] || {};
  const mk = (slug, hidden) => ({ slug, zh: abilityZh[slug]?.zh, hidden });
  return [...(a.reg || []).slice(0, 1).map((x) => mk(x, false)), ...(a.hid || []).slice(0, 1).map((x) => mk(x, true))];
}
const defFor = (id) => buildWorker(id, roster[id - 1] || null, typesOf(id), abilitiesOf(id));

/* ------------------------------------------------------------ save / load */

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, world })); } catch { /* private mode: the farm lives in memory only */ }
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw?.v === 1 && raw.world?.v === 1 && Array.isArray(raw.world.workers) && Array.isArray(raw.world.plots)) return raw.world;
  } catch { /* corrupt save: start a new farm */ }
  return null;
}
function newGame(startSeason = Math.floor(Math.random() * 4), { strict = false, daily = false } = {}) {
  const dateKey = taipeiDateKey(new Date());
  // The daily run's seed and starting season come from the date alone, so everyone playing it that day gets the same year.
  const seed = daily ? hashStr(`pokefarm:${dateKey}`) >>> 1 : Math.floor(Math.random() * 2 ** 31);
  const w = createWorld({ seed, dateKey, startSeason: daily ? seed % 4 : startSeason, strict, daily });
  for (const id of STARTERS) { addWorker(w, defFor(id)); dex.catch(id, 'farm'); }
  return w;
}

/* ---------------------------------------------------------- tile helpers */

const plotAtTile = (x, y) => world.plots.find((p) => p.x === x && p.y === y);
const treeAtTile = (x, y) => world.trees.find((t) => t.x === x && t.y === y);
const same = (a, b) => a.x === b.x && a.y === b.y;

/** Unclaimed tasks whose work spot belongs to tile (tx, ty). */
function tasksAtTile(tx, ty) {
  return world.tasks.filter((t) => {
    if (t.claimedBy != null) return false;
    if (t.kind === 'drawWater') return same({ x: tx, y: ty }, WELL) || (tx === Math.floor(t.x) && ty === Math.floor(t.y));
    if (t.kind === 'cook') return same({ x: tx, y: ty }, KITCHEN) || (tx === Math.floor(t.x) && ty === Math.floor(t.y));
    return Math.floor(t.x) === tx && Math.floor(t.y) === ty;
  });
}

const STATE_ZH = { wild: '荒地', fallow: '空地', tilled: '已翻土', growing: '成長中', ripe: '成熟', stubble: '殘株' };
function describeTile(tx, ty) {
  if (same({ x: tx, y: ty }, WELL)) return '水井：提水補滿水槽';
  if (same({ x: tx, y: ty }, KITCHEN)) return '廚房：3 種樹果＋1 木材 → 料理（火系自己生火）';
  if (same({ x: tx, y: ty }, WAREHOUSE)) return '倉庫：搬運的樹果與木材送到這裡';
  const tr = treeAtTile(tx, ty);
  if (tr) return `${tr.wood > 0 ? `樹：可砍 ${tr.wood} 份木材` : '樹樁：正在長回來'}${tr.shaken ? '・今天搖過了' : '・葉子裡有野生樹果，可以搖樹'}`;
  const cn = (world.canals || []).find((c) => c.x === tx && c.y === ty);
  if (cn) return cn.built ? '渠道：旁邊的田每個階段自動吸水（乾旱時會乾涸）' : '渠道預定地：派人挖渠道，旁邊的田以後自動吸水';
  const p = plotAtTile(tx, ty);
  if (p) {
    if (!p.open) return `未開墾的田（商店可花 ${PLOT_UNLOCK_COST} 金幣開墾）`;
    let s = STATE_ZH[p.state];
    if (p.state === 'growing') s = `${berryName(p.berry)} 第 ${p.stage + 1}/4 階段${p.stageWatered ? '・已澆水' : '・缺水'}`;
    if (p.state === 'ripe') s = `${berryName(p.berry)} 成熟（${p.yield} 顆）`;
    if (p.weeds && p.state !== 'wild') s += '・有雜草';
    if (p.pest) s += `・有害蟲！（${Math.ceil(p.pest.left)} 秒內要趕走）`;
    if (p.ash) s += '・有草木灰（產量 +1）';
    return `田 ${p.i + 1}：${s}`;
  }
  const pile = world.piles.find((q) => Math.floor(q.x) === tx && Math.floor(q.y) === ty);
  if (pile) return pile.kind === 'berry' ? `${berryName(pile.berry)} ×${pile.qty} 等人搬運` : `木材 ×${pile.qty} 等人搬運`;
  return '草地';
}

/* ----------------------------------------------------------- assignment */

function workerLabel(w) { return `${w.def.name}`; }

function tryAssign(taskList, source) {
  if (phase !== 'day') { toast('先按「開始今天」，一天開始後才能指派'); return false; }
  if (selected < 0 || !world.workers[selected]) { toast('先選一隻工人'); return false; }
  const w = world.workers[selected];
  if (w.state === 'rest') { toast(`${workerLabel(w)} 正在休息`); return false; }
  const ok = taskList
    .filter((t) => canDo(world, w, t))
    .sort((a, b) => taskValue(world, b) - taskValue(world, a))[0];
  if (!ok) { sfx('refuse'); toast(taskList.length ? '這隻工人現在做不了這件事（缺水、缺種子或材料不足）' : '這裡現在沒有可做的工作'); return false; }
  if (!assign(world, selected, ok.id)) { toast('指派失敗'); return false; }
  sfx('assign');
  const verb = ok.kind === 'clear' && clearMethod(w) === 'burn' ? '放火' : JOB_NAME[ok.kind];
  const others = taskList.filter((t) => t !== ok).map((t) => JOB_NAME[t.kind]);
  hint(`${workerLabel(w)} → ${verb}${others.length ? `（這格還有：${[...new Set(others)].join('、')}，想指定請到「工作」分頁）` : ''}`);
  say(`${workerLabel(w)} 去${verb}`);
  if (source === 'jobs') { selectWorker(-1); }
  renderAll(true);
  return true;
}

function selectWorker(i) {
  selected = selected === i ? -1 : i;
  if (selected >= 0) {
    sfx('select');
    const w = world.workers[selected];
    hint(`已選 ${w.def.name}。點農場上的一格、或到「工作」分頁選一項工作來指派。`);
  } else hint('');
  renderAll(true);
}

/* ------------------------------------------------------- worker overlay */

function ensureNode(w) {
  let n = nodes.get(w.id);
  if (n) return n;
  const root = document.createElement('div');
  root.className = 'pf-w';
  root.innerHTML = '<div class="pf-w-shadow"></div><div class="pf-w-body"><span class="pf-w-tag"></span><img class="pf-w-img" alt="" decoding="async"></div><div class="pf-w-bar"><b></b></div>';
  const body = root.querySelector('.pf-w-body');
  body.dataset.id = w.id;
  const img = root.querySelector('img');
  const n2 = { root, body, img, tag: root.querySelector('.pf-w-tag'), bar: root.querySelector('.pf-w-bar b'), src: '', flip: false, failed: false, nat: null };
  img.addEventListener('load', () => { n2.nat = [img.naturalWidth, img.naturalHeight]; sizeImg(n2); });
  img.addEventListener('error', () => {
    if (!n2.failed) { n2.failed = true; img.classList.add('is-static'); img.src = staticUrl(w.id); n2.src = img.src; }
    else img.style.visibility = 'hidden';
  });
  body.addEventListener('click', (e) => { e.stopPropagation(); selectWorker(world.workers.findIndex((x) => x.id === w.id)); });
  el.workers.appendChild(root);
  nodes.set(w.id, n2);
  return n2;
}

/** Scale a sprite so a 0.7-tile-tall Pokémon and a 3-tile-tall one both read. */
function sizeImg(n) {
  if (!n.nat) return;
  let [nw, nh] = n.nat;
  if (n.failed) { nw = 96; nh = 96; }
  const k = tilePx / 40;
  let w = nw * k, h = nh * k;
  const big = Math.max(w, h), lo = Math.max(tilePx * 0.7, 34), hi = tilePx * 1.7;
  const fit = big < lo ? lo / big : big > hi ? hi / big : 1;
  n.img.style.width = `${Math.round(w * fit)}px`;
  n.img.style.height = `${Math.round(h * fit)}px`;
}

function taskLabel(w) {
  if (!isActive(world, w)) return '休眠（非本季屬性）';
  if (w.state === 'rest') return '休息中 💤';
  if (w.state === 'idle') return '待命';
  const t = world.tasks.find((x) => x.id === w.task);
  if (!t) return '待命';
  return t.kind === 'clear' && clearMethod(w) === 'burn' ? '放火' : JOB_NAME[t.kind];
}

function updateWorkers() {
  const ids = new Set();
  world.workers.forEach((w, i) => {
    ids.add(w.id);
    const n = ensureNode(w);
    const px = w.x * tilePx, py = w.y * tilePx;
    n.root.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    n.root.style.zIndex = String(Math.round(w.y * 10));
    n.root.dataset.state = w.state;
    n.root.classList.toggle('is-selected', i === selected);
    const back = w.face === 'up';
    const url = n.failed ? staticUrl(w.id) : gifUrl(w.id, back);
    if (n.src !== url) { n.src = url; n.img.src = url; }
    const flip = w.face === 'right';
    if (n.flip !== flip) { n.flip = flip; n.img.classList.toggle('is-flip', flip); }
    const label = taskLabel(w);
    if (n.tag.textContent !== label) n.tag.textContent = label;
    let p = 0;
    if (w.state === 'work') {
      const t = world.tasks.find((x) => x.id === w.task);
      const leg = t?.legs?.[w.leg];
      if (leg?.work > 0) p = 1 - Math.max(0, w.workLeft) / leg.work;
    }
    n.bar.parentElement.style.display = w.state === 'work' ? '' : 'none';
    n.bar.style.setProperty('--p', p.toFixed(2));
    n.root.title = `${w.def.name}${w.carry ? `（扛著 ${w.carry.qty}）` : ''}`;
  });
  for (const [id, n] of nodes) if (!ids.has(id)) { n.root.remove(); nodes.delete(id); }
}

/* ------------------------------------------------------------- pop-ups */

const POP_DEFAULT = { pest: '🐛', drop: '💧', fire: '🔥', chip: '🪵', ready: '✨', star: '⭐', coin: '🪙' };
/** Sound + screen effects for one engine event. */
let lastPestStinger = -99;
function fxSound(e) {
  switch (e.kind) {
    case 'job': jobSfx(e.job, e.type); break;
    case 'warn': sfx('warnBolt'); break;
    case 'bolt':
      if (e.absorbed) sfx('boltAbsorbed');
      else { sfx('bolt'); setTimeout(() => sfx('boltHit'), 260); flash(); shake(); }
      break;
    case 'flood': sfx('flood'); shake(); break;
    case 'frost': sfx('frost'); break;
    case 'landfall': sfx('landfall'); shake(); flash(); break;
    case 'pest':
      if (e.text === '被啃了') sfx('pestBite');
      else { sfx('pest'); if (performance.now() - lastPestStinger > 25000) { lastPestStinger = performance.now(); stinger(Math.random() < 0.5 ? STINGERS.pest : STINGERS.pestGirl); } }
      break;
    case 'ready': sfx('ready'); break;
    case 'coin': sfx('coin'); break;
    case 'fire': sfx('fire'); break;
    case 'star': sfx(e.text === '+1' ? 'lucky' : 'pestShoo'); break;
    default: break;
  }
}
function flash() { if (reduceMotion.matches) return; el.flash.classList.remove('is-on'); void el.flash.offsetWidth; el.flash.classList.add('is-on'); }
function shake() { if (reduceMotion.matches) return; el.stage.classList.remove('is-shake'); void el.stage.offsetWidth; el.stage.classList.add('is-shake'); }
el.stage.addEventListener('animationend', (ev) => { if (ev.target === el.stage) el.stage.classList.remove('is-shake'); });

function consumeFx() {
  for (const e of world.fx) {
    if (seenFx.has(e)) continue;
    seenFx.add(e);
    fxSound(e);
    if (e.kind === 'job') continue;                 // a silent event for the sound layer only
    if (el.pops.childElementCount > 18) continue;
    const d = document.createElement('div');
    d.className = 'pf-pop';
    d.dataset.k = e.kind;
    d.textContent = e.text || POP_DEFAULT[e.kind] || '';
    d.style.left = `${e.x * tilePx}px`;
    d.style.top = `${e.y * tilePx}px`;
    el.pops.appendChild(d);
    setTimeout(() => d.remove(), reduceMotion.matches ? 700 : 950);
  }
  while (seenLog < world.log.length) {
    const entry = world.log[seenLog++];
    if (entry) say(entry.text);
  }
  if (world.log.length < seenLog) seenLog = world.log.length;
}

/* ---------------------------------------------------------------- HUD */

function renderHud() {
  const left = Math.max(0, DAY_SECONDS - world.t);
  const set = (node, v) => { if (node.textContent !== v) node.textContent = v; };
  set(el.day, `第 ${world.day} 天`);
  set(el.clock, phase === 'morning' ? '早晨・準備中' : phase === 'dusk' ? '黃昏' : `剩 ${Math.ceil(left)} 秒${paused ? '（暫停）' : speed > 1 && warnedHazard() ? '（預警：降為 1×）' : ''}`);
  el.timeMeter.firstElementChild.style.setProperty('--p', (world.t / DAY_SECONDS).toFixed(3));
  set(el.coins, String(Math.floor(world.coins)));
  set(el.water, `${Math.floor(world.water)}/${world.waterMax}`);
  el.waterMeter.firstElementChild.style.setProperty('--p', (world.water / world.waterMax).toFixed(3));
  set(el.wood, String(world.wood));
  set(el.stock, `${berryTotal(world)} / ${world.stock.dishes.length}`);
  set(el.flavor, FLAVOR_ZH[world.market.flavor] || '—');
  const wk = weatherOf(world), W = WEATHER[wk] || WEATHER.sun;
  set(el.weather, `${W.icon} ${W.zh}`);
  const seer = isSeer();
  const fc = WEATHER[world.forecast] || null;
  set(el.forecast, seer && fc ? `明日 ${fc.icon}` : '明日 ？');
  el.weatherChip.title = `${W.note || WEATHER_NOTE[wk]}${seer ? '' : '（雇一隻超能力系或有預知特性的工人，就能預知明天的天氣和今天的災害時刻）'}`;
  el.stage.dataset.weather = wk;
  const si = seasonInfo(world);
  el.stage.dataset.season = si.key;
  set(el.season, `${si.def.icon} ${si.def.zh}`);
  set(el.seasonDay, `${si.dayIn}/${SEASON_DAYS}・${world.endless ? `第 ${world.seasons.length + 1} 季` : `${Math.min(4, world.seasons.length + 1)}/4`}${world.strict ? '・挑戰' : ''}${world.daily ? '・每日' : ''}`);
  el.seasonChip.title = si.def.rule;
  renderAlert();
  syncAudio();
  const dueToday = world.orders.filter((o) => o.due <= world.day).length;
  set(el.ordersN, String(world.orders.length));
  set(el.rep, `信譽 ${world.rep || 0}${dueToday ? `・今日到期 ${dueToday}` : ''}`);
  el.ordersChip.classList.toggle('is-urgent', dueToday > 0);
  set(el.orderCount, String(dueToday || world.orders.length));
  el.stage.style.setProperty('--dusk', String(Math.max(0, (world.t / DAY_SECONDS - 0.7) / 0.3).toFixed(2)));
  el.start.disabled = phase !== 'morning';
  el.pause.disabled = phase !== 'day';
  el.pause.textContent = paused ? '繼續' : '暫停';
}

/* ----------------------------------------------------- seasons & hazards */

/** A crew member with the `seer` flag (Psychic, Forewarn, Anticipation) reads the sky. */
const isSeer = () => world.workers.some((x) => isActive(world, x) && (x.def.flags?.seer || x.def.types.includes('Psychic')));
const HAZ_ZH = { bolt: '⚡ 落雷', flood: '🌊 洪水', landfall: '🌀 颱風登陸', frost: '🥶 寒流' };
const stars3 = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** The banner over the board: a live warning, or the seer's next hazard. */
function renderAlert() {
  let text = '';
  if (phase === 'day') {
    const live = (world.hazards || []).filter((h) => h.warned && !h.done).sort((a, b) => a.at - b.at)[0];
    if (live) text = `${HAZ_ZH[live.kind]}預警！${Math.max(0, Math.ceil(live.at - world.t))} 秒`;
    else if (isSeer()) {
      const nx = (world.hazards || []).filter((h) => !h.done).sort((a, b) => a.at - b.at)[0];
      if (nx) text = `🔮 預知：${HAZ_ZH[nx.kind]}約在 ${nx.at} 秒（還有 ${Math.max(0, Math.ceil(nx.at - world.t))} 秒）`;
    }
  }
  if (el.alert.textContent !== text) el.alert.textContent = text;
  el.alert.hidden = !text;
}

/** Season card for the orders and shop panels: rule, group, key type, today's sky, the star bars. */
function seasonCard() {
  const si = seasonInfo(world), gate = seasonGate(world);
  const goal = seasonGoal(world);
  const got = Math.max(0, (world.stats?.earned || 0) - (world.seasonWorth || 0));
  const top = goal[2];
  const hasKey = world.workers.some((w) => w.def.types.includes(si.def.key));
  const spec = HAZARD_PLAN[weatherOf(world)];
  const seer = isSeer();
  let sky = '';
  if (spec) {
    sky = seer && world.hazards?.length
      ? `<p>🔮 今日災害：${world.hazards.map((h) => `${HAZ_ZH[h.kind]}（${h.at} 秒）`).join('、')}</p>`
      : `<p>⚠ 今天的天氣會有災害：${esc(WEATHER_NOTE[weatherOf(world)])}（時刻要雇超能力系工人才看得到，不然只有發生前幾秒的預警。）</p>`;
  }
  if (world.event === 'locust') sky += '<p>🦗 蝗災：今天一早就有一大群害蟲，趕快派人驅趕（威嚇、念力類特性很有用）。</p>';
  const gateLine = gate.need
    ? `<p class="pf-chip is-warn">這季需要${esc(si.def.keyZh)}工人，你沒有；按「開始今天」時會借你 ${esc(defFor(gate.loan).name)}（本季免工資，季末歸還）。</p>`
    : `<p>本季關鍵屬性：${esc(si.def.keyZh)}${hasKey ? '（隊上已有 ✓）' : '（本季借來的幫手）'}</p>`;
  return `<div class="pf-season-card${gate.need ? ' pf-gate' : ''}">
    <h3><span>${si.def.icon} ${si.def.zh}・第 ${si.dayIn}/${SEASON_DAYS} 天</span><span class="pf-stars" aria-label="本季目標">${stars3(goal.filter((g) => got >= g).length)}</span></h3>
    <p>${esc(si.def.rule)}</p>
    <p>${world.strict ? '<b>挑戰模式</b>：只有這些屬性的工人上工：' : '屬性加成（工作快 15%）：'}${esc(si.def.types.join('、'))}</p>${world.strict ? `<p>${world.workers.filter((w) => !isActive(world, w)).length} 位工人本季休眠（照領工資）。</p>` : ''}
    ${gateLine}${sky}
    <div class="pf-goal" role="img" aria-label="本季營收 ${got}，三顆星要 ${goal.join('、')}"><i style="--p:${Math.min(1, got / top).toFixed(3)}"></i>${goal.map((g) => `<u style="--at:${(g / top).toFixed(3)}"></u>`).join('')}</div>
    <div class="pf-goal-legend"><span>營收 $${got}</span><span>★ ${goal[0]}　★★ ${goal[1]}　★★★ ${goal[2]}</span></div>
  </div>`;
}

/* ---------------------------------------------------------------- panels */

function chipsFor(def) {
  const jobs = topJobs(def, 2).map(([j, r]) => `<span class="pf-chip">${JOB_NAME[j]} ×${f1(r)}</span>`).join('');
  const sig = def.sig?.label ? `<span class="pf-chip is-sig">${esc(def.sig.label)}</span>` : '';
  return `${def.loan ? '<span class="pf-chip is-sig">借來・免工資</span>' : ''}<span class="pf-chip">速度 ${f1(def.speed)}</span>${jobs}${sig}`;
}
/** One line per ability perk, with the plain-language effect (touch screens have no tooltips). */
function perkLines(def) {
  return (def.perks || []).map((p) => `<span class="pf-perk"><b>${esc(p.zh)}${p.hidden ? '（隱藏特性）' : ''}</b> ${esc(p.note)}</span>`).join('');
}

function renderWorkers() {
  const rows = world.workers.map((w, i) => {
    const pct = Math.round((w.stamina / w.def.staminaMax) * 20) * 5;
    return `<li><button type="button" class="pf-card${isActive(world, w) ? '' : ' is-asleep'}" data-key="w${w.id}" data-worker="${i}" aria-pressed="${i === selected}">
      <img src="${staticUrl(w.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span><span class="pf-card-name">${esc(w.def.name)}</span><br><span class="pf-card-meta">${esc(w.def.types.join(' / '))}・搬 ${w.def.carry}</span></span>
      <span class="pf-card-state">${esc(taskLabel(w))}<br>${w.done} 件・$${w.earned}</span>
      <span class="pf-stamina"><span class="pf-meter"><i style="--p:${(pct / 100).toFixed(2)}"></i></span><span class="pf-chips">${chipsFor(w.def)}</span><span class="pf-perks">${perkLines(w.def)}</span></span>
    </button></li>`;
  }).join('');
  const loaner = world.workers.find((w) => w.def.loan);
  const keepRow = loaner ? (() => { const real = defFor(loaner.id); const cost = hireCost(world, real); return `<div class="pf-shop-row"><span>${esc(loaner.def.name)} 是這季借來的，季末要還。想留下？</span><button type="button" class="pf-btn is-small" data-keep="1" ${phase === 'morning' && world.coins >= cost ? '' : 'disabled'}>留下 $${cost}</button></div>`; })() : '';
  setHTML(el.panels.workers, `${keepRow}<p class="pf-note">${phase === 'day' ? '點一隻工人，再點農場的一格或「工作」分頁的一項來指派。' : '一天開始後才能指派；早上先到「商店」準備。'}（鍵盤：數字鍵 1–9 選工人）</p><ul class="pf-list">${rows}</ul>`);
}

function renderJobs() {
  const open = world.tasks.slice().sort((a, b) => taskValue(world, b) - taskValue(world, a));
  el.jobCount.textContent = String(open.filter((t) => t.claimedBy == null).length);
  const w = world.workers[selected];
  const rows = open.slice(0, 40).map((t) => {
    const taken = t.claimedBy != null;
    const by = taken ? world.workers.find((x) => x.id === t.claimedBy) : null;
    const burn = t.kind === 'clear' && w && clearMethod(w) === 'burn';
    const name = burn ? '放火' : JOB_NAME[t.kind];
    const where = t.plot != null ? `田 ${t.plot + 1}` : t.kind === 'chop' ? '樹' : t.kind === 'haul' ? '搬運' : t.kind === 'drawWater' ? '水井' : t.kind === 'cook' ? '廚房' : '';
    const dl = t.deadline - world.t;
    const disabled = taken || phase !== 'day' || !w || !canDo(world, w, t);
    return `<li><button type="button" class="pf-job${taken ? ' is-taken' : ''}" data-key="t${t.key}" data-task="${t.id}" ${disabled ? 'disabled' : ''}>
      <span class="pf-job-name">${name}・${where}</span><span class="pf-job-val">價值 ${f1(taskValue(world, t))}</span>
      <span class="pf-job-meta">${taken ? `${esc(by?.def.name || '')} 進行中` : dl < 999 ? `期限剩 ${Math.max(0, Math.round(dl))} 秒` : ''}</span></button></li>`;
  }).join('');
  setHTML(el.panels.jobs, `<p class="pf-note">${w ? `已選 ${esc(w.def.name)}：按一項就指派。` : '先在「工人」分頁或農場上選一隻工人。'}依價值排序；虛線的是已有人在做。</p><ul class="pf-list">${rows || '<li class="pf-note">目前沒有工作。</li>'}</ul>`);
}

const FLAVOR_ICON = '🍲';
function orderTitle(o) {
  if (o.kind === 'berry') return `${berryName(o.berry)} ×${o.qty}`;
  if (o.kind === 'dish') return `${FLAVOR_ZH[o.flavor]}味料理 ×${o.qty}`;
  return `木材 ×${o.qty}`;
}
function orderIcon(o) {
  if (o.kind === 'berry') return `<i style="background:${esc(seedColour(o.berry))}"></i>`;
  return o.kind === 'dish' ? FLAVOR_ICON : '🪵';
}
function orderHowTo(o) {
  if (o.kind === 'berry') return `收成並搬進倉庫的${berryName(o.berry)}會自動算數；賣出時會幫你留下。`;
  if (o.kind === 'dish') return `料理要含「${FLAVOR_ZH[o.flavor]}」味的樹果（${Object.values(BERRIES).filter((b) => b.flavors.includes(o.flavor)).map((b) => b.zh).join('、')}）。`;
  return '派人砍樹，木材存在倉庫；做料理（不是火系）也要用木材。';
}
function renderOrders() {
  const mult = repMultiplier(world);
  const list = world.orders.slice().sort((a, b) => a.due - b.due || b.reward - a.reward);
  const rows = list.map((o) => {
    const { have, need } = orderHave(world, o);
    const left = o.due - world.day;
    const ready = have >= need;
    const urgent = left <= 0;
    const due = left <= 0 ? '今天日終截止' : `第 ${o.due} 天截止（還有 ${left} 天）`;
    return `<li><div class="pf-order${urgent ? ' is-urgent' : ''}${ready ? ' is-ready' : ''}">
      <span class="pf-order-ico" aria-hidden="true">${orderIcon(o)}</span>
      <span><span class="pf-order-name">${esc(orderTitle(o))}</span><br><span class="pf-order-due">${due}</span></span>
      <span class="pf-order-pay">$${Math.round(o.reward * mult)}<small>${mult > 1 ? `含信譽 +${Math.round((mult - 1) * 100)}%` : '獎勵'}</small></span>
      <span class="pf-order-prog"><span class="pf-meter" role="img" aria-label="已備 ${have} / ${need}"><i style="--p:${(have / need).toFixed(2)}"></i></span><span>${ready ? '已備齊，日終交貨' : `${have} / ${need}，還差 ${need - have}`}</span></span>
      <span class="pf-order-tip">${esc(orderHowTo(o))}</span></div></li>`;
  }).join('');
  const nextSlot = (world.rep || 0) < 3 ? 3 : (world.rep || 0) < 8 ? 8 : null;
  setHTML(el.panels.orders, `
    ${seasonCard()}
    <div class="pf-rep"><span>信譽 <b>${world.rep || 0}</b>・同時 ${orderSlots(world)} 張${nextSlot ? `（信譽 ${nextSlot} 解鎖更多）` : '（已達上限）'}</span><span>獎勵 ×${mult.toFixed(2)}</span></div>
    <p class="pf-note">備齊就會在日終自動交貨並 +1 信譽；逾期的單作廢並 −1 信譽。還沒到期的單，需要的樹果和料理賣出時會幫你留下。</p>
    <ul class="pf-list">${rows || '<li class="pf-note">目前沒有訂單，明天早上會有新的。</li>'}</ul>`);
}

function renderLog() {
  const items = world.log.slice().reverse().map((l) => `<li>第 ${l.day} 天 ${Math.round(l.t)} 秒：${esc(l.text)}</li>`).join('');
  setHTML(el.panels.log, `<ul class="pf-log">${items || '<li>還沒有紀錄。</li>'}</ul>`);
}

let recruitQuery = '';
function recruitPool() {
  const visitors = visitorIds(`${world.seed}:${world.day}`, 4).map((id) => ({ id, visitor: true }));
  const owned = dex.ids().slice().reverse().filter((id) => !visitors.some((v) => v.id === id)).map((id) => ({ id, visitor: false }));
  let list = [...visitors, ...owned].filter((c) => !world.workers.some((w) => w.id === c.id));
  const q = recruitQuery.trim().toLowerCase();
  if (q) {
    list = list.filter((c) => {
      const name = roster[c.id - 1]?.names?.zh || '';
      return name.includes(q) || String(c.id) === q.replace('#', '');
    });
  }
  return list.slice(0, 10);
}

function renderShop() {
  const morning = phase === 'morning';
  const seeds = BERRY_IDS.map((id) => {
    const b = BERRIES[id];
    return `<button type="button" class="pf-seed" data-key="s${id}" data-seed="${id}" aria-pressed="${world.seedPick === id}" ${morning ? '' : 'disabled'}>
      <i style="background:${esc(seedColour(id))}"></i><b>${esc(b.zh)}</b><small>種子 $${seedCost(world, id)}・賣 $${b.price}</small><small>每階段 ${b.stage} 秒</small></button>`;
  }).join('');
  const pool = recruitPool().map((c) => {
    const def = defFor(c.id);
    const cost = hireCost(world, def);
    const can = morning && world.coins >= cost && world.workers.length < MAX_WORKERS;
    return `<div class="pf-recruit"><img src="${staticUrl(c.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div><div class="pf-recruit-name">${esc(def.name)} ${c.visitor ? '<span class="pf-chip is-sig">今日訪客</span>' : ''}${world.strict && !def.types.some((t) => seasonInfo(world).def.types.includes(t)) ? '<span class="pf-chip is-asleep">本季會休眠</span>' : ''}</div><div class="pf-recruit-meta">${esc(def.types.join(' / '))}・${topJobs(def, 2).map(([j, r]) => `${JOB_NAME[j]}×${f1(r)}`).join('、')}${def.sig?.label ? '・' + esc(def.sig.label) : ''}</div><div class="pf-perks">${perkLines(def)}</div></div>
      <button type="button" class="pf-btn is-small" data-key="h${c.id}" data-hire="${c.id}" ${can ? '' : 'disabled'}>雇用 $${cost}</button></div>`;
  }).join('');
  const plotsLeft = world.plots.length - world.plotsOpen;
  setHTML(el.panels.shop, `
    ${seasonCard()}
    ${morning ? '' : '<p class="pf-note">商店只在早上營業（一天進行中不能改，這樣日終的演算法比較才公平）。</p>'}
    <h3 class="pf-h">今天種什麼</h3><div class="pf-seeds">${seeds}</div>
    <h3 class="pf-h" style="margin-top:14px">擴充</h3>
    <div class="pf-shop-row"><span>開墾 4 格田（${world.plotsOpen}/${world.plots.length}）</span><button type="button" class="pf-btn is-small" data-key="plots" data-buy="plots" ${morning && plotsLeft > 0 && world.coins >= PLOT_UNLOCK_COST ? '' : 'disabled'}>$${PLOT_UNLOCK_COST}</button></div>
    <div class="pf-shop-row"><span>水槽 +8（${world.waterMax}）</span><button type="button" class="pf-btn is-small" data-key="tank" data-buy="tank" ${morning && world.coins >= TANK_UPGRADE_COST ? '' : 'disabled'}>$${TANK_UPGRADE_COST}</button></div>
    <h3 class="pf-h" style="margin-top:14px">升級（永久）</h3>
    ${Object.entries(UPGRADES).map(([k, u]) => { const c = upgradeCost(world, k); const lv = world.up?.[k] || 0;
      return `<div class="pf-shop-row"><span>${u.zh} Lv ${lv}/${u.max}<br><small class="pf-note">${u.desc}</small></span><button type="button" class="pf-btn is-small" data-key="u${k}" data-up="${k}" ${morning && c != null && world.coins >= c ? '' : 'disabled'}>${c == null ? '已滿級' : '$' + c}</button></div>`; }).join('')}
    <p class="pf-note">每天日終要付工資：每位工人約 工資 ÷ ${UPKEEP_DIV}。同一種樹果賣超過 10 顆、同一天料理超過 4 道會開始降價，輪著種、多做料理比較賺。</p>
    <h3 class="pf-h" style="margin-top:14px">招募（${world.workers.length}/${MAX_WORKERS}）</h3>
    <p class="pf-note">圖鑑裡收服過的寶可夢隨時能雇；每天另有 4 位訪客，雇用訪客會把牠收進你的圖鑑。</p>
    <input class="pf-select pf-search" data-key="q" type="search" placeholder="搜尋名稱或編號" value="${esc(recruitQuery)}" aria-label="搜尋可招募的寶可夢">
    <div>${pool || '<p class="pf-note">沒有符合的寶可夢。</p>'}</div>`);
}

function seedColour(id) { return ({ cheri: '#e0483a', chesto: '#7b4bb0', pecha: '#f2a0b6', rawst: '#5ec5a3', aspear: '#f2cf3a', oran: '#4a7bd9', persim: '#e07a3a', lum: '#4aa84a', sitrus: '#f0c428' })[id] || '#888'; }

function renderPanels() {
  if (activeTab === 'orders') renderOrders();
  if (activeTab === 'workers') renderWorkers();
  if (activeTab === 'jobs') renderJobs();
  if (activeTab === 'shop') renderShop();
  if (activeTab === 'log') renderLog();
  if (activeTab !== 'jobs') el.jobCount.textContent = String(world.tasks.filter((t) => t.claimedBy == null).length);
}

let panelClock = 0;
function renderAll(force) {
  const now = performance.now();
  if (!force && now - panelClock < 250) return;
  panelClock = now;
  renderHud();
  renderPanels();
}

/* --------------------------------------------------------- layout & draw */

function layout() {
  const w = el.board.clientWidth;
  if (!w) return;
  tilePx = w / GRID.w;
  el.stage.style.setProperty('--pf-tile', `${tilePx.toFixed(2)}px`);
  for (const n of nodes.values()) sizeImg(n);
}

function updateRing() {
  el.ring.hidden = false;
  el.ring.style.transform = `translate(${cursor.x * tilePx}px, ${cursor.y * tilePx}px)`;
  el.ring.style.left = '0';
  el.ring.style.top = '0';
}

let animT = 0;
function draw() {
  drawBoard(g, world, reduceMotion.matches ? 0 : animT);
}

/* ----------------------------------------------------------- game loop */

let last = 0, acc = 0;
/** A hazard has been announced and has not landed yet. */
const warnedHazard = () => (world.hazards || []).some((h) => h.warned && !h.done);
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000 || 0);
  last = now;
  animT += dt;
  if (phase === 'day' && !paused) {
    acc += dt * (warnedHazard() ? 1 : speed);     // a warning is 4 game-seconds: at 4× that is 1 real second, so drop to 1× while one is live
    let guard = 0;
    while (acc >= STEP && !world.over && guard++ < 160) { step(world, STEP); acc -= STEP; }
    if (world.over) { finishDay(); }
  }
  layout();
  updateWorkers();
  consumeFx();
  draw();
  renderAll(false);
}

/* ------------------------------------------------------------ day cycle */

function startDay() {
  if (phase !== 'morning') return;
  const gate = seasonGate(world);
  if (gate.need && addLoaner(world, defFor(gate.loan))) {
    toast(`${defFor(gate.loan).name} 來幫忙這一季（${gate.keyZh}，免工資）`);
    sfx('loaner');
  }
  sfx('startDay');
  snapshot = structuredClone(world);
  snapshot.fx = []; snapshot.log = [];
  usedStrategies = new Set([world.strategy]);
  acc = 0;
  syncTasks(world);
  phase = 'day';
  paused = false;
  hint('一天開始了。選一隻工人再點一格就能指派；沒被指派的工人會照排程方式自己找事做。');
  say(`第 ${world.day} 天開始`);
  renderAll(true);
}

function finishDay() {
  phase = 'dusk';
  const before = netWorth(snapshot);
  const rep = endDay(world);
  const you = { earned: rep.earned, gain: rep.netWorth - before };
  const rows = compareStrategies(snapshot);
  const bestRow = rows.reduce((a, b) => (b.gain > a.gain ? b : a));
  sfx('dusk');
  setTimeout(() => sfx(you.gain >= bestRow.gain ? 'good' : 'lost'), 700);
  audioOverride = rep.season ? { mode: 'season', stars: rep.season.stars } : { mode: 'dusk' };
  showDusk(rep, you, rows);
  if (rep.season) rep.season.stars && [...Array(rep.season.stars)].forEach((_, k) => setTimeout(() => sfx('star'), 1000 + k * 380));
  renderAll(true);
}

function showDusk(rep, you, rows) {
  const mine = [...usedStrategies].map((s) => STRATEGIES[s]).join('＋');
  const best = rows.reduce((a, b) => (b.gain > a.gain ? b : a));
  const top = Math.max(1, you.gain, ...rows.map((r) => r.gain));
  const all = [{ label: `你（${mine}＋指派）`, earned: you.earned, gain: you.gain, you: true },
    ...rows.map((r) => ({ label: STRATEGIES[r.strategy], earned: r.earned, gain: r.gain, best: r === best }))];
  const verdict = you.gain >= best.gain
    ? `你贏過了所有排程演算法：比最強的「${STRATEGIES[best.strategy]}」多 ${Math.round(you.gain - best.gain)}。`
    : `最強的是「${STRATEGIES[best.strategy]}」，比你多 ${Math.round(best.gain - you.gain)}。看看是哪個決定拖慢了你，明天再試。`;
  el.duskBody.innerHTML = `
    <p>${verdict}</p>
    <div class="pf-result">
      <div><b>${rep.earned}</b><span>今日收入（含訂單 $${rep.orderCoins}）</span></div>
      <div><b>${rep.dishes}</b><span>道料理（$${rep.dishCoins}）</span></div>
      <div><b>${rep.berrySold}</b><span>顆樹果賣出（$${rep.berryCoins}）</span></div>
      <div><b>−${rep.paid}</b><span>工資（應付 ${rep.upkeep}）</span></div>
      <div><b>${rep.lost}</b><span>損失（腐爛、延燒、蟲咬）</span></div>
    </div>
    ${rep.heat ? `<p class="pf-note">❄ 取暖：燒了 ${rep.heat.used}/${rep.heat.need} 份木材${rep.heat.cold ? '——不夠！明天大家體力 −15%（冬天要記得留木材）' : '，大家睡得很暖。'}</p>` : ''}
    ${rep.season ? `<div class="pf-season-card pf-reveal"><h3><span>${SEASONS[rep.season.key].icon} ${rep.season.zh}季結算</span><span class="pf-stars">${stars3(rep.season.stars)}</span></h3>
      <p>本季營收 $${Math.round(rep.season.gain)}（★ ${rep.season.goal[0]}　★★ ${rep.season.goal[1]}　★★★ ${rep.season.goal[2]}）。${rep.season.stars === 3 ? '滿星！' : rep.season.stars === 0 ? '這季很辛苦，下一季再拚。' : ''}借來的幫手回家了。</p></div>` : ''}
    ${rep.orders?.length ? `<h3 class="pf-h">訂單</h3><ul class="pf-orders-dusk">${rep.orders.map((o) => o.ok
      ? `<li class="is-ok"><span>✓ ${esc(orderTitle(o))}</span><b>+$${o.pay}</b></li>`
      : `<li class="is-bad"><span>✗ ${esc(orderTitle(o))}（逾期）</span><b>信譽 −1</b></li>`).join('')}</ul>` : ''}
    <p>「淨資產增加」把金幣、庫存、田裡還沒收的作物都折算進來，比單看收入更公平。</p>
    <table class="pf-cmp"><thead><tr><th>方式</th><th>收入</th><th>淨資產增加</th><th><span class="pf-sr">長條圖</span></th></tr></thead><tbody>
    ${all.map((r) => `<tr class="${r.you ? 'is-you' : ''}${r.best ? ' is-best' : ''}"><td>${esc(r.label)}</td><td>${Math.round(r.earned)}</td><td>${Math.round(r.gain)}</td>
      <td><span class="pf-bar"><i style="--p:${Math.max(0, r.gain / top).toFixed(2)}"></i></span></td></tr>`).join('')}
    </tbody></table>`;
  if (!el.dialog.open) el.dialog.showModal();
}

/** The morning line: sky, orders, hot flavour. */
function briefing() {
  const W = WEATHER[weatherOf(world)] || WEATHER.sun;
  const due = world.orders.filter((o) => o.due <= world.day).length;
  return `第 ${world.day} 天早晨：${W.icon}${W.zh}；訂單 ${world.orders.length} 張${due ? `（今天到期 ${due} 張）` : ''}；熱銷味道「${FLAVOR_ZH[world.market.flavor]}」。到「訂單」和「商店」決定種什麼、雇誰，再按「開始今天」。`;
}

function nextDay() {
  el.dialog.close();
  audioOverride = null;
  if (world.finished) { phase = 'morning'; save(); showRunEnd(); return; }
  stinger(STINGERS.heal);
  phase = 'morning';
  paused = false;
  snapshot = null;
  seenLog = world.log.length;
  save();
  hint(briefing());
  say(briefing());
  renderAll(true);
}

/* ------------------------------------------------------------- events */

el.start.addEventListener('click', startDay);
el.pause.addEventListener('click', () => { paused = !paused; renderAll(true); });
el.next.addEventListener('click', nextDay);
el.ordersChip.addEventListener('click', () => setTab('orders', false));
const HELP_KEY = 'pokemon-algorithm:farm:help';
function openHelp() { if (!el.help.open) el.help.showModal(); }
el.helpBtn.addEventListener('click', openHelp);
el.helpClose.addEventListener('click', () => { el.help.close(); try { localStorage.setItem(HELP_KEY, '1'); } catch { /* optional */ } });
el.help.addEventListener('close', () => { try { localStorage.setItem(HELP_KEY, '1'); } catch { /* optional */ } });
el.dialog.addEventListener('cancel', (e) => e.preventDefault());   // a day's result must be acknowledged with the button
el.reset.addEventListener('click', () => {
  if (!resetArmed) { resetArmed = true; el.reset.textContent = '再按一次確認（會清除存檔）'; setTimeout(() => { resetArmed = false; el.reset.textContent = '重新開始農場'; }, 4000); return; }
  resetArmed = false; el.reset.textContent = '重新開始農場';
  el.dialog.close();
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to remove */ }
  startWorld(newGame());
  openStart();
});
for (const b of document.querySelectorAll('.pf-speed button')) {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    for (const o of document.querySelectorAll('.pf-speed button')) o.setAttribute('aria-pressed', String(o === b));
  });
}
el.strategy.innerHTML = Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
el.strategy.addEventListener('change', () => { world.strategy = el.strategy.value; usedStrategies.add(world.strategy); renderAll(true); });

function setTab(name, focus) {
  activeTab = name;
  for (const t of el.tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const [k, p] of Object.entries(el.panels)) p.hidden = k !== name;
  renderAll(true);
}
el.tabs.forEach((t, i) => {
  t.addEventListener('click', () => setTab(t.dataset.tab, false));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { e.preventDefault(); setTab(el.tabs[(i + d + el.tabs.length) % el.tabs.length].dataset.tab, true); }
  });
});

// Panel delegation: worker cards, job rows, seeds, shop buttons, search.
document.querySelector('.pf-side').addEventListener('click', (e) => {
  const c = e.target.closest('[data-worker]');
  if (c) { selectWorker(Number(c.dataset.worker)); return; }
  const j = e.target.closest('[data-task]');
  if (j) { const t = world.tasks.find((x) => x.id === Number(j.dataset.task)); if (t) tryAssign([t], 'jobs'); return; }
  const s = e.target.closest('[data-seed]');
  if (s && phase === 'morning') { setSeed(world, s.dataset.seed); renderAll(true); return; }
  const b = e.target.closest('[data-buy]');
  if (b && phase === 'morning') {
    if (b.dataset.buy === 'plots' && unlockPlots(world)) { toast('開墾了 4 格新田'); sfx('plot'); }
    else if (b.dataset.buy === 'tank' && upgradeTank(world)) { toast('水槽變大了'); sfx('tank'); }
    save(); renderAll(true); return;
  }
  const up = e.target.closest('[data-up]');
  if (up && phase === 'morning') { if (buyUpgrade(world, up.dataset.up)) { toast(`${UPGRADES[up.dataset.up].zh}升級了`); sfx('buy'); } save(); renderAll(true); return; }
  const kp = e.target.closest('[data-keep]');
  if (kp && phase === 'morning') {
    const lw = world.workers.find((x) => x.def.loan);
    if (lw) {
      const real = defFor(lw.id);
      if (keepLoaner(world, real)) { if (dex.catch(lw.id, 'farm')) toast(`${real.name} 留下來了，並收進你的圖鑑`); else toast(`${real.name} 留下來了`); sfx('hire'); save(); renderAll(true); }
    }
    return;
  }
  const h = e.target.closest('[data-hire]');
  if (h && phase === 'morning') {
    const id = Number(h.dataset.hire);
    if (world.workers.length < MAX_WORKERS && hire(world, defFor(id))) {
      if (dex.catch(id, 'farm')) toast(`${defFor(id).name} 加入農場，並收進你的圖鑑`); else toast(`${defFor(id).name} 加入農場`);
      try { cryPlayer.play(id).catch(() => {}); } catch { /* sound is optional */ }
      sfx('hire');
      save(); renderAll(true);
    }
  }
});
document.querySelector('.pf-side').addEventListener('input', (e) => {
  if (e.target.matches('[data-key="q"]')) { recruitQuery = e.target.value; renderAll(true); }
});

// Board: pointer → tile.
function tileFromEvent(e) {
  const r = el.board.getBoundingClientRect();
  return { x: Math.min(GRID.w - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * GRID.w))), y: Math.min(GRID.h - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * GRID.h))) };
}
el.board.addEventListener('click', (e) => {
  cursor = tileFromEvent(e);
  updateRing();
  activateTile();
});
function activateTile() {
  hint(describeTile(cursor.x, cursor.y));
  if (selected >= 0 && phase === 'day') tryAssign(tasksAtTile(cursor.x, cursor.y), 'board');
  else if (selected < 0) { /* description only */ }
  else if (phase !== 'day') toast('先按「開始今天」');
}
if (window.matchMedia('(hover: hover)').matches) {
  el.board.addEventListener('pointermove', (e) => {
    const t = tileFromEvent(e);
    el.tip.textContent = describeTile(t.x, t.y);
    el.tip.hidden = false;
    const r = el.stage.getBoundingClientRect();
    el.tip.style.left = `${Math.min(r.width - 220, e.clientX - r.left + 14)}px`;
    el.tip.style.top = `${e.clientY - r.top + 14}px`;
  });
  el.board.addEventListener('pointerleave', () => { el.tip.hidden = true; });
}
el.board.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    cursor = { x: Math.min(GRID.w - 1, Math.max(0, cursor.x + d[0])), y: Math.min(GRID.h - 1, Math.max(0, cursor.y + d[1])) };
    updateRing();
    hint(describeTile(cursor.x, cursor.y));
  } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTile(); }
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'Escape' && selected >= 0) { selected = -1; hint(''); renderAll(true); }
  if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const i = Number(e.key) - 1;
    if (world.workers[i]) selectWorker(i);
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && phase === 'day') { paused = true; renderAll(true); } });
if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(el.stage);
window.addEventListener('beforeunload', () => { if (phase === 'morning') save(); });

/* ------------------------------------------------------- music director */

let audioOverride = null;            // a dialog that owns the music: { mode: 'title' | 'dusk' | 'season' | 'run', … }
/** What the game is doing, as the director's scene (see pickTrack in pokefarm-audio.js). */
function audioScene() {
  if (audioOverride) return audioOverride;
  const si = seasonInfo(world);
  const base = { season: si.key, dayIn: si.dayIn, day: world.day };
  if (phase === 'morning') return { ...base, mode: 'morning' };
  if (phase === 'dusk') return { mode: 'dusk' };
  const live = (world.hazards || []).filter((h) => (h.warned && !h.done) || (h.done && world.t - h.at < 10))
    .sort((x, y) => (y.kind === 'landfall') - (x.kind === 'landfall'))[0];     // a typhoon outranks a bolt for the music
  return {
    ...base, mode: 'day', hazard: live ? live.kind : null,
    locust: world.event === 'locust' && world.t < 40, last: !world.endless && world.day === RUN_DAYS,
  };
}
let lastScene = '';
function syncAudio() {
  const sc = audioScene();
  const key = JSON.stringify(sc);
  if (key === lastScene) return;
  lastScene = key;
  setScene(sc);
}

/* ------------------------------------------------------------ run start */

const bestKey = (strict) => (strict ? `${BEST_KEY}:strict` : BEST_KEY);
function bestRun(strict = false) { try { return JSON.parse(localStorage.getItem(bestKey(strict)) || 'null'); } catch { return null; } }
/** Daily results: { 'YYYY-MM-DD': { stars, worth, rating, strict } }, best of the day kept. */
function dailyLog() { try { return JSON.parse(localStorage.getItem(DAILY_KEY) || '{}') || {}; } catch { return {}; } }
function dayBefore(key) { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function dailyStreak(log, today) { let n = 0; for (let k = log[today] ? today : dayBefore(today); log[k]; k = dayBefore(k)) n += 1; return n; }
function openStart() {
  const best = bestRun(el.optStrict.checked);
  const today = taipeiDateKey(new Date());
  const dl = dailyLog();
  const dseed = hashStr(`pokefarm:${today}`) >>> 1;
  const dseason = SEASONS[SEASON_KEYS[dseed % 4]];
  el.dailyBtn.textContent = `📅 今日挑戰（${today}・${dseason.icon}${dseason.zh}開局）`;
  const streak = dailyStreak(dl, today);
  el.dailyNote.textContent = `${dl[today] ? `今天的最佳：${dl[today].rating} 級（${dl[today].stars} ★、$${dl[today].worth}${dl[today].strict ? '・挑戰' : ''}）。可以再挑戰。` : '今天還沒玩。'}${streak ? `　連續 ${streak} 天。` : ''}　全世界今天的天氣、災害、訂單都一樣。`;
  el.seasonPick.innerHTML = SEASON_KEYS.map((k, i) => `<button type="button" data-start="${i}"><b>${SEASONS[k].icon} 從${SEASONS[k].zh}開始</b>${esc(SEASONS[k].rule)}<br>關鍵屬性：${esc(SEASONS[k].keyZh)}</button>`).join('')
    + '<button type="button" class="is-random" data-start="random">🎲 隨機抽一季（第一次推薦）</button>';
  el.best.hidden = !best;
  if (best) el.best.textContent = `${el.optStrict.checked ? '挑戰模式' : ''}個人最佳：${best.rating} 級（${best.stars} ★，營收 $${best.worth}）`;
  audioOverride = { mode: 'title' };
  if (!el.startDlg.open) el.startDlg.showModal();
}
function beginRun(b) {
  const daily = b.dataset.start === 'daily';
  const pick = b.dataset.start === 'random' || daily ? Math.floor(Math.random() * 4) : Number(b.dataset.start);
  el.startDlg.close();
  startWorld(newGame(pick, { strict: el.optStrict.checked, daily }));
  const si = seasonInfo(world);
  toast(`${daily ? '今日挑戰：' : ''}新的一年從${si.def.zh}開始${world.strict ? '（挑戰模式）' : ''}`);
  sfx('newSeason');
}
el.seasonPick.addEventListener('click', (e) => { const b = e.target.closest('[data-start]'); if (b) beginRun(b); });
el.dailyBtn.addEventListener('click', () => beginRun(el.dailyBtn));
el.optStrict.addEventListener('change', () => { const best = bestRun(el.optStrict.checked); el.best.hidden = !best; if (best) el.best.textContent = `${el.optStrict.checked ? '挑戰模式' : ''}個人最佳：${best.rating} 級（${best.stars} ★，營收 $${best.worth}）`; });
el.startDlg.addEventListener('close', () => { audioOverride = null; });   // Esc keeps the random season already dealt

/* ----------------------------------------------------------- run result */

let shareText = '';
function showRunEnd() {
  const total = world.seasons.slice(0, 4).reduce((a, x) => a + x.stars, 0);
  const worth = world.stats.earned;
  const rating = ratingOf(total, worth, world.strict);
  const prev = world.daily ? (dailyLog()[world.dateKey] || null) : bestRun(world.strict);
  const better = !prev || total > prev.stars || (total === prev.stars && worth > prev.worth);
  if (better && world.daily) { try { const log = dailyLog(); log[world.dateKey] = { stars: total, worth, rating: rating.id, strict: !!world.strict }; localStorage.setItem(DAILY_KEY, JSON.stringify(log)); } catch { /* optional */ } }
  else if (better) { try { localStorage.setItem(bestKey(world.strict), JSON.stringify({ stars: total, worth, rating: rating.id, date: taipeiDateKey(new Date()) })); } catch { /* optional */ } }
  const k = world.strict ? STRICT_SCALE : 1;
  const nextR = [...RATINGS].reverse().find((r) => RATINGS.indexOf(r) < RATINGS.indexOf(rating));
  const need = nextR ? `距離 ${nextR.id} 級還差${total < nextR.stars ? ` ${nextR.stars - total} 顆星` : ''}${worth < nextR.worth * k ? `${total < nextR.stars ? '、' : ' '}營收 $${Math.round(nextR.worth * k - worth)}` : ''}。` : '已是最高等級！';
  el.runBody.innerHTML = `
    <div class="pf-rating pf-reveal"><b>${rating.id}</b><span>${esc(rating.zh)}</span></div>
    <div class="pf-seasons-row">${world.seasons.slice(0, 4).map((x) => `<div class="pf-reveal">${SEASONS[x.key].icon} ${SEASONS[x.key].zh}<span class="pf-stars">${stars3(x.stars)}</span>$${Math.round(x.gain)}</div>`).join('')}</div>
    <p>共 ${total}/12 顆星，一年營收 $${worth}。${better ? (prev ? '🎉 刷新個人最佳！' : '🎉 這是你的第一個紀錄！') : `個人最佳是 ${prev.rating} 級（${prev.stars} ★、$${prev.worth}）。`}</p>
    <p class="pf-note">${esc(need)}想拿高分：留意預報、用電系避雷、挖渠道防洪、冬天備木材，並多接訂單（信譽越高獎勵越大）。</p>`;
  shareText = `PokéFarm ${world.daily ? `${world.dateKey} 每日挑戰` : '一年'}${world.strict ? '（挑戰模式）' : ''}：${rating.id} 級 ${total}/12★ 營收 $${worth}\n${world.seasons.slice(0, 4).map((x) => `${SEASONS[x.key].icon}${'★'.repeat(x.stars)}${'☆'.repeat(3 - x.stars)}`).join(' ')}`;
  el.runShare.hidden = !world.daily;
  audioOverride = { mode: 'run', rating: rating.id, reveal: true };
  setTimeout(() => { if (audioOverride?.mode === 'run') audioOverride = { mode: 'run', rating: rating.id, reveal: false }; }, 6500);
  sfx(`rate${rating.id}`);
  el.runDlg.showModal();
}
el.runDlg.addEventListener('cancel', (e) => e.preventDefault());
el.runShare.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(shareText); toast('成績已複製'); } catch { toast(shareText.replace(/\n/g, '　')); }
});
el.runAgain.addEventListener('click', () => {
  el.runDlg.close(); audioOverride = null;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to remove */ }
  startWorld(newGame());
  openStart();
});
el.runEndless.addEventListener('click', () => {
  el.runDlg.close(); audioOverride = null;
  world.finished = false; world.endless = true;
  save(); hint('無盡模式：季節會一直輪下去，目標會越來越高。'); renderAll(true);
});

/* ---------------------------------------------------------------- sound */

function syncSoundDialog() {
  const p = getPrefs();
  el.mute.checked = p.mute;
  el.volMusic.value = String(Math.round(p.music * 100));
  el.volSfx.value = String(Math.round(p.sfx * 100));
  const np = nowPlaying();
  el.nowPlaying.textContent = np ? `播放中：${np}` : '';
}
el.soundBtn.addEventListener('click', async () => {
  unlockAudio();
  syncSoundDialog();
  if (!el.soundTest.childElementCount) {
    const fams = await soundTest();
    el.soundTest.innerHTML = fams.map((f) => `<button type="button" data-sfx="${esc(f.names[0])}" data-fam="${esc(f.family)}">${esc(f.family)}${f.names.length > 1 ? `<small>×${f.names.length}</small>` : ''}</button>`).join('');
  }
  el.soundDlg.showModal();
});
el.soundTest.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fam]');
  if (b) playSfx(pickVariant(b.dataset.fam, Math.random), { vol: 1 });
});
el.mute.addEventListener('change', () => { setMuted(el.mute.checked); el.soundBtn.textContent = isMuted() ? '🔇' : '🔊'; });
el.volMusic.addEventListener('input', () => setVolume('music', Number(el.volMusic.value) / 100));
el.volSfx.addEventListener('input', () => setVolume('sfx', Number(el.volSfx.value) / 100));
el.soundClose.addEventListener('click', () => el.soundDlg.close());
el.soundDlg.addEventListener('close', () => { el.soundBtn.textContent = isMuted() ? '🔇' : '🔊'; });

/* --------------------------------------------------------------- start */

function startWorld(w) {
  world = w;
  ensureOrders(world);
  ensureSeason(world);
  for (const x of world.workers) {
    if (!Array.isArray(x.def.perks) || !x.def.flags) {          // a save from before ability perks / season flags
      const loan = x.def.loan;
      x.def = defFor(x.id);
      if (loan) { x.def.loan = true; x.def.wage = 0; }
    }
  }
  snapshot = null;
  phase = 'morning';
  paused = false;
  selected = -1;
  seenLog = world.log.length;
  el.strategy.value = world.strategy;
  for (const n of nodes.values()) n.root.remove();
  nodes.clear();
  save();
  hint(briefing());
  renderAll(true);
  if (world.finished) showRunEnd();
}

(async function init() {
  await loadData();
  initAudio({ muted: cryPlayer.muted });
  const saved = load();
  startWorld(saved || newGame());
  if (!saved) openStart();
  setTab('orders', false);
  updateRing();
  layout();
  requestAnimationFrame(frame);
  let seenHelp = false;
  try { seenHelp = localStorage.getItem(HELP_KEY) === '1'; } catch { seenHelp = true; }
  el.soundBtn.textContent = isMuted() ? '🔇' : '🔊';
  if (!seenHelp && !navigator.webdriver && !el.startDlg.open) openHelp();
  el.startDlg.addEventListener('close', () => { if (!seenHelp && !navigator.webdriver) { seenHelp = true; openHelp(); } });
  // Test/debug hook: the Node checks cover the engine; this lets a browser test drive the page.
  window.__pokefarm = { openHelp, get world() { return world; }, get phase() { return phase; }, startDay, selectWorker, tryAssign, tasksAtTile, setSpeed: (s) => { speed = s; }, showRunEnd, newGame, startWorld, audioScene: () => audioScene() };
})();
