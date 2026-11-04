/**
 * pokefarm-engine.js — the farm as a pure simulation
 * ===================================================
 * No DOM, no clock, no Math.random. A `world` is plain JSON, `step(world, dt)`
 * advances it by a fixed slice, and the same world + the same strategy always
 * produces the same day. That one property buys the page's signature feature:
 * at dusk it replays the day from its starting snapshot under each scheduling
 * strategy and shows what the algorithms would have earned (`compareStrategies`).
 *
 * THE LOOP
 * --------
 *   syncTasks   the world decides which jobs exist (a ripe plot "wants" a
 *               harvest; a fallow plot wants tilling; a pile wants hauling)
 *   assign      an idle worker picks one with the strategy (or the player does)
 *   walk, work  legs: go somewhere, spend work-seconds, apply an effect
 *   endDay      sell, grow overnight, roll the market
 *
 * Jobs are DERIVED from state, never stored as a queue the player must keep
 * consistent: a task that stops being true (the plot was scorched) vanishes by
 * itself, and a task that is true again (the stubble is back) reappears.
 *
 * SCHEDULING STRATEGIES (`STRATEGIES`)
 * ------------------------------------
 *   fifo     the oldest open job
 *   nearest  the closest job
 *   greedy   highest `value / (travel + work)` — the classic ratio rule
 *   edf      the earliest deadline (a ripe plot's rot, a stage ending unwatered)
 *   manual   idle workers wait for the player
 */

import {
  DAY_SECONDS, NIGHT_GROWTH, GRID, FIELD, FIELD_START, WELL, KITCHEN, WAREHOUSE,
  TREES, TREE_WOOD, TREE_REGROW, TANK, RIPE_ROT, WEED_RATE, FIRE_SPREAD, ASH_BONUS,
  BERRIES, BERRY_IDS, JOBS, BURN_TIME, FLAVOR_ZH, MARKET_BONUS, FLAVORS,
  dishMultiplier, START_COINS,
  SEASONS, SEASON_KEYS, SEASON_DAYS, RUN_DAYS, SEASON_GOAL, WEEK_SCALE, STRICT_SCALE, SEASON_AFFINITY, RATINGS, WET_WEATHER, WINDY_WEATHER, WX_ALIAS,
  HAZARD_PLAN, BOLT_WARN, LOCUST_FROM_DAY, LOCUST_CHANCE,
  WEATHER, PEST_FROM_DAY, PEST_CHANCE, PEST_TIME, PEST_BITE,
  ORDER_MAX_OPEN, REP_BONUS, REP_CAP, RUSH,
  FIELD_CANALS, SHAKE_POOL,
  UPKEEP_DIV, SALE_FREE_BERRY, SALE_DECAY_BERRY, SALE_FREE_DISH, SALE_DECAY_DISH, UPGRADES, HIRE_STEP,
} from './pokefarm-data.js';

export const STRATEGIES = {
  manual:  '手動',
  fifo:    '先進先出',
  nearest: '最近優先',
  greedy:  '貪婪（價值÷時間）',
  edf:     '最早到期',
};
export const AUTO_STRATEGIES = ['fifo', 'nearest', 'greedy', 'edf'];

const KEEP_BERRIES = 6;          // berries kept back at dusk for tomorrow's cooking
const SYNC_EVERY = 5;            // steps between task syncs
const WOOD_CAP = 12;

/* --------------------------------------------------------------- randomness */

/** Mulberry32 whose state lives in the world, so a cloned world replays exactly. */
export function rnd(world) {
  world.rng = (world.rng + 0x6D2B79F5) >>> 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ helpers */

const tileCentre = (x, y) => ({ x: x + 0.5, y: y + 0.5 });
const standBelow = (s) => ({ x: s.x + 0.5, y: s.y + 1.5 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const plotXY = (i) => ({ x: FIELD.x0 + (i % FIELD.cols), y: FIELD.y0 + Math.floor(i / FIELD.cols) });
const plotAt = (world, x, y) => world.plots.find((p) => p.x === x && p.y === y) || null;
const neighbours = (world, p) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
  .map(([dx, dy]) => plotAt(world, p.x + dx, p.y + dy)).filter((q) => q && q.open);

function fx(world, kind, x, y, text = '', extra = null) {
  if (world.noFx) return;
  world.fx.push({ kind, x, y, text, t: world.t, ...extra });
  if (world.fx.length > 60) world.fx.shift();
}
function log(world, text) {
  if (world.noFx) return;
  world.log.push({ t: world.t, day: world.day, text });
  if (world.log.length > 40) world.log.shift();
}

export function berryTotal(world) {
  return Object.values(world.stock.berries).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ creation */

export function createWorld({ seed = 1, workers = [], coins = START_COINS, dateKey = '', startSeason = 0, strict = false, daily = false } = {}) {
  const world = {
    v: 1, seed, strict: !!strict, daily: !!daily, rng: seed >>> 0, day: 1, t: 0, over: false, noFx: false,
    dateKey, coins, water: TANK.start, waterMax: TANK.max, wood: 0, nextId: 1, steps: 0,
    plotsOpen: FIELD_START, seedPick: 'cheri', strategy: 'greedy',
    market: { flavor: 'sweet' }, up: { tools: 0, kitchen: 0, cart: 0 },
    weather: 'sun', forecast: 'sun', pestPlan: [], orders: [], rep: 0, canals: [],
    run: { start: startSeason % 4 }, seasons: [], seasonWorth: 0, finished: false, endless: false, hazards: [], event: null, cold: false,
    plots: [], trees: [], piles: [], workers: [], tasks: [],
    stock: { berries: {}, dishes: [] },
    stats: { harvested: 0, hauled: 0, cooked: 0, lost: 0, earned: 0 },
    fx: [], log: [],
  };
  for (let i = 0; i < FIELD.cols * FIELD.rows; i++) {
    const { x, y } = plotXY(i);
    world.plots.push({
      i, x, y, open: i < FIELD_START, state: i < FIELD_START ? 'fallow' : 'wild', berry: null,
      stage: 0, prog: 0, waters: 0, stageWatered: false, weeds: false, ash: false, wait: 0, yield: 0, pest: null,
    });
  }
  TREES.forEach((t) => world.trees.push({ x: t.x, y: t.y, wood: TREE_WOOD, regrow: 0 }));
  world.market.flavor = FLAVORS[Math.floor(rnd(world) * FLAVORS.length)];
  world.forecast = rollWeather(world, 2);       // day 1 itself is always a plain sunny day
  rollOrders(world);
  ensureCanals(world);
  for (const def of workers) addWorker(world, def);
  world.seasonWorth = 0;                          // revenue (stats.earned) when the current season began
  return world;
}

export function addWorker(world, def) {
  const c = standBelow(WAREHOUSE);
  const slot = world.workers.length;
  world.workers.push({
    id: def.id, def, x: c.x - 0.6 * (slot % 4), y: c.y + 0.4 * Math.floor(slot / 4),
    face: 'down', state: 'idle', task: null, leg: 0, workLeft: 0, restLeft: 0,
    stamina: def.staminaMax, carry: null, done: 0, earned: 0,
  });
}

/* -------------------------------------------------------------- task helpers */

function berryPrice(b) { return BERRIES[b].price; }
/** Upgrade levels, tolerant of a save written before upgrades existed. */
const upOf = (world) => world.up || (world.up = { tools: 0, kitchen: 0, cart: 0 });

/* ------------------------------------------------------------------ orders */

const dishMatches = (d, flavor) => d.flavors.includes(flavor);
const priceSorted = BERRY_IDS.slice().sort((a, b) => BERRIES[a].price - BERRIES[b].price);

/** Make a save written before orders existed playable: no orders yet, no reputation. */
export function ensureOrders(world) {
  ensureCanals(world);
  ensureSeason(world);
  if (!Array.isArray(world.orders)) { world.orders = []; world.rep = world.rep || 0; rollOrders(world); }
  if (typeof world.rep !== 'number') world.rep = 0;
}

/**
 * Berries free to cook with: the stock minus what open berry orders are waiting
 * for. Without this a worker would happily cook the very oranges a customer is
 * due to collect tonight (found in a browser run: a covered order expired).
 */
export function spareBerries(world) {
  const spare = { ...world.stock.berries };
  for (const o of world.orders || []) if (o.kind === 'berry') spare[o.berry] = Math.max(0, (spare[o.berry] || 0) - o.qty);
  return spare;
}
const spareTotal = (world) => Object.values(spareBerries(world)).reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------------ seasons */

/** Season of `day` (default: today): { idx, key, def, dayIn }. Old saves start in spring. */
export function seasonInfo(world, day = world.day) {
  const start = world.run?.start ?? 0;
  const idx = (start + Math.floor((day - 1) / SEASON_DAYS)) % 4;
  const key = SEASON_KEYS[idx];
  return { idx, key, def: SEASONS[key], dayIn: ((day - 1) % SEASON_DAYS) + 1 };
}
const modsOf = (world) => seasonInfo(world).def.mods;

/**
 * CHALLENGE MODE (`world.strict`): from the second week on, only workers of the
 * season's type group work (the loaner always does; the first week is an
 * orientation week where everybody works, so a starting crew of 1/4/7 is not
 * stranded in a season it has no group for). The rest sleep at the warehouse but still draw
 * their wage — a retainer — so the crew has to be built per season, not piled up.
 */
export function isActive(world, worker) {
  return !world.strict || (world.seasons?.length || 0) < 1 || !!worker.def.loan || worker.def.types.some((t) => seasonInfo(world).def.types.includes(t));
}

/** FNV-1a: a stable 32-bit hash of a string (the daily seed comes from the date). */
export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/**
 * DAILY SEED: everything rolled at dawn (flavour, tomorrow's sky, pests, hazards,
 * orders) is drawn from a stream seeded by (seed, day) instead of the world's
 * running stream, so every player of that date sees the same year no matter how
 * many luck rolls their own workers consumed.
 */
function atDawn(world, fn) {
  if (!world.daily) { fn(); return; }
  const keep = world.rng;
  world.rng = hashStr(`${world.seed}:dawn:${world.day}`);
  try { fn(); } finally { world.rng = keep; }
}

/** Prices and costs under today's season rule. */
export function seedCost(world, id) { return Math.max(1, Math.round(BERRIES[id].seed * (modsOf(world).seedCost || 1))); }
const sellPrice = (world, b) => BERRIES[b].price * (modsOf(world).berryPrice || 1);
const growthMul = (world) => (modsOf(world).growth || 1) * ({ frost: 0.6, snow: 0.75 }[weatherOf(world)] || 1);
const affinity = (world, worker) => (worker.def.types.some((t) => seasonInfo(world).def.types.includes(t)) ? SEASON_AFFINITY : 1);

/** Weather multiplier for a worker's `wx` perks, falling back through the weather's aliases. */
function wxMul(world, def) {
  const w = weatherOf(world);
  let m = def.wx?.[w] || 1;
  for (const a of WX_ALIAS[w] || []) m = Math.max(m, def.wx?.[a] || 1);
  return m;
}
const crew = (world, flag) => world.workers.filter((w) => w.def.flags?.[flag] && isActive(world, w)).length;

/** The key-type gate on the first morning of a season: { need, key, keyZh, loan }. */
export function seasonGate(world) {
  const { def, dayIn } = seasonInfo(world);
  const has = world.workers.some((w) => w.def.types.includes(def.key));
  return { need: dayIn === 1 && !has && !world.finished, key: def.key, keyZh: def.keyZh, loan: def.loan };
}
/** Lend the season's helper for this season only. Returns false if one is already on the farm. */
export function addLoaner(world, def) {
  if (world.workers.some((w) => w.def.loan)) return false;
  addWorker(world, { ...def, loan: true, wage: 0 });
  return true;
}
/**
 * Keep the loaner for good: pay the normal hire price and swap its free loan
 * definition for the real one (`realDef`, same species, real wage).
 */
export function keepLoaner(world, realDef) {
  const w = world.workers.find((x) => x.def.loan);
  if (!w || w.id !== realDef.id) return false;
  const cost = hireCost(world, realDef);
  if (world.coins < cost) return false;
  world.coins -= cost;
  w.def = { ...realDef, loan: false };
  return true;
}
/** The three revenue bars for the world's current week (`world.seasons.length` weeks are done). */
export function seasonGoal(world) {
  const k = world.seasons?.length || 0;
  const scale = WEEK_SCALE[Math.min(k, WEEK_SCALE.length - 1)] + Math.max(0, k - (WEEK_SCALE.length - 1)) * 0.2;
  return SEASON_GOAL.map((g) => Math.round((g * scale * (world.strict ? STRICT_SCALE : 1)) / 50) * 50);
}
export function ratingOf(totalStars, worth, strict = false) {
  const k = strict ? STRICT_SCALE : 1;
  return RATINGS.find((r) => totalStars >= r.stars && worth >= r.worth * k) || RATINGS[RATINGS.length - 1];
}
export function ensureSeason(world) {
  if (!world.run) world.run = { start: 0 };
  for (const [k, v] of Object.entries({ seasons: [], hazards: [], finished: false, endless: false, event: null, cold: false })) if (world[k] == null) world[k] = v;
  if (world.seasonWorth == null) world.seasonWorth = world.stats?.earned || 0;
}

/**
 * CANALS. A canal tile sits on the path beside the first or last column of the
 * field and, once dug, waters the plot next to it at the start of every growth
 * stage (like rain) — except in a drought, when it runs dry. Dug canals are
 * permanent. Eight slots: one beside each of the four rows on both sides.
 */
export function ensureCanals(world) {
  if (Array.isArray(world.canals) && world.canals.length) return;
  world.canals = [];
  for (let r = 0; r < FIELD.rows; r++) {
    world.canals.push({ x: FIELD.x0 - 1, y: FIELD.y0 + r, built: false });
    world.canals.push({ x: FIELD.x0 + FIELD.cols, y: FIELD.y0 + r, built: false });
  }
}
/** Is this plot fed by a canal that is flowing today? */
export function canalFeeds(world, p) {
  if (weatherOf(world) === 'drought') return false;
  return (world.canals || []).some((c) => c.built && c.y === p.y && Math.abs(c.x - p.x) === 1);
}

/** How much of order `o` the stock covers right now: { have, need }. */
export function orderHave(world, o) {
  if (o.kind === 'berry') return { have: Math.min(o.qty, world.stock.berries[o.berry] || 0), need: o.qty };
  if (o.kind === 'wood') return { have: Math.min(o.qty, world.wood), need: o.qty };
  return { have: Math.min(o.qty, world.stock.dishes.filter((d) => dishMatches(d, o.flavor)).length), need: o.qty };
}
export const repMultiplier = (world) => 1 + REP_BONUS * Math.min(REP_CAP, world.rep || 0);
/** The most orders open at once: 2, then 3 at reputation 3, 4 at reputation 8. */
export const orderSlots = (world) => Math.min(ORDER_MAX_OPEN, 2 + ((world.rep || 0) >= 3 ? 1 : 0) + ((world.rep || 0) >= 8 ? 1 : 0));

function makeOrder(world) {
  const o = makeOrderRaw(world);
  o.reward = Math.round(o.reward * (modsOf(world).orderReward || 1));
  return o;
}
function makeOrderRaw(world) {
  const rep = world.rep || 0, day = world.day;
  const r = rnd(world);
  const minLen = day <= 2 ? 2 : 1;                       // the first days are not a sprint
  const len = minLen + Math.floor(rnd(world) * (4 - minLen)); // 1..3 days of notice (day 1-2: 2..3)
  const f = RUSH[len];
  const base = { id: world.nextId++, born: day, due: day + len - 1 };
  if (r < 0.5 || day < 2 && r < 0.8) {
    const pool = priceSorted.slice(0, Math.min(priceSorted.length, 4 + Math.floor(day / 3)));
    const berry = pool[Math.floor(rnd(world) * pool.length)];
    const qty = Math.min(14, 3 + Math.floor(rnd(world) * 4) + Math.floor(rep / 3));
    return { ...base, kind: 'berry', berry, qty, reward: Math.round(BERRIES[berry].price * qty * f) };
  }
  if (r < 0.8) {
    const flavor = FLAVORS[Math.floor(rnd(world) * FLAVORS.length)];
    const qty = 1 + (rep >= 5 && rnd(world) < 0.5 ? 1 : 0);
    return { ...base, kind: 'dish', flavor, qty, reward: Math.round(qty * (60 + day * 3) * f) };
  }
  const qty = Math.min(12, 3 + Math.floor(rnd(world) * 4) + Math.floor(rep / 4));
  return { ...base, kind: 'wood', qty, reward: Math.round(qty * 10 * f) };
}

/** Top the board up to `orderSlots`; called each morning (and at creation). */
function rollOrders(world) {
  let guard = 0;
  while (world.orders.length < orderSlots(world) && guard++ < 8) world.orders.push(makeOrder(world));
}

/** What the open orders still lack, for the greedy value: { berry:{id:n}, flavor:{f:n}, wood:n }. */
function orderShort(world) {
  const short = { berry: {}, flavor: {}, wood: 0 };
  const dishesLeft = world.stock.dishes.slice();
  for (const o of world.orders) {
    if (o.kind === 'berry') short.berry[o.berry] = (short.berry[o.berry] || 0) + o.qty;
    else if (o.kind === 'wood') short.wood += o.qty;
    else {
      let need = o.qty;
      for (let i = dishesLeft.length - 1; i >= 0 && need > 0; i--) if (dishMatches(dishesLeft[i], o.flavor)) { dishesLeft.splice(i, 1); need -= 1; }
      if (need > 0) short.flavor[o.flavor] = (short.flavor[o.flavor] || 0) + need;
    }
  }
  for (const b of Object.keys(short.berry)) short.berry[b] = Math.max(0, short.berry[b] - (world.stock.berries[b] || 0));
  short.wood = Math.max(0, short.wood - world.wood);
  return short;
}

/** Fill what can be filled (earliest due first), expire what is due, return the results. */
function settleOrders(world) {
  const results = [];
  const order = world.orders.slice().sort((a, b) => a.due - b.due || b.reward - a.reward);
  const mult = repMultiplier(world);
  for (const o of order) {
    const { have, need } = orderHave(world, o);
    if (have < need) continue;
    if (o.kind === 'berry') world.stock.berries[o.berry] -= o.qty;
    else if (o.kind === 'wood') world.wood -= o.qty;
    else {
      const idx = world.stock.dishes.map((d, i) => [d, i]).filter(([d]) => dishMatches(d, o.flavor)).sort((a, b) => a[0].value - b[0].value).slice(0, o.qty).map(([, i]) => i);
      world.stock.dishes = world.stock.dishes.filter((_, i) => !idx.includes(i));
    }
    const pay = Math.round(o.reward * mult);
    world.rep = (world.rep || 0) + 1;
    results.push({ ...o, ok: true, pay });
    world.orders = world.orders.filter((x) => x !== o);
  }
  for (const o of world.orders.slice()) {
    if (o.due > world.day) continue;
    world.rep = Math.max(0, (world.rep || 0) - 1);
    results.push({ ...o, ok: false, pay: 0 });
    world.orders = world.orders.filter((x) => x !== o);
  }
  return results;
}

/* ------------------------------------------------------------ weather, pests */

export const weatherOf = (world) => world.weather || 'sun';
const ripeRot = (world) => RIPE_ROT * (WINDY_WEATHER.has(weatherOf(world)) ? 0.7 : 1) * (modsOf(world).rot || 1);

function rollWeather(world, day = world.day) {
  const odds = seasonInfo(world, day).def.odds;
  const r = rnd(world);
  let a = 0;
  for (const [k, w] of Object.entries(odds)) { a += w; if (r < a) return k; }
  return 'sun';
}
/** Rolled once per morning: when (in seconds) pests visit. Empty before PEST_FROM_DAY. */
function planPests(world) {
  world.pestPlan = [];
  if (world.day < PEST_FROM_DAY) { world.event = null; return; }
  const n = (rnd(world) < PEST_CHANCE ? 1 : 0) + (rnd(world) < PEST_CHANCE * 0.3 ? 1 : 0);
  for (let i = 0; i < n; i++) world.pestPlan.push(Math.round(15 + rnd(world) * 70));
  // Locusts (a summer/autumn disaster): a swarm of visits in the morning.
  world.event = null;
  const si = seasonInfo(world);
  if (world.day >= LOCUST_FROM_DAY && (si.key === 'summer' || si.key === 'autumn') && rnd(world) < LOCUST_CHANCE) {
    world.event = 'locust';
    const k = 4 + Math.floor(rnd(world) * 3);
    for (let i = 0; i < k; i++) world.pestPlan.push(Math.round(10 + rnd(world) * 35));
  }
  world.pestPlan.sort((a, b) => a - b);
}
function runPests(world, dt) {
  const plan = world.pestPlan || [];
  while (plan.length && world.t >= plan[0]) {
    plan.shift();
    const hosts = world.plots.filter((p) => p.open && !p.pest && (p.state === 'growing' || p.state === 'ripe'));
    if (!hosts.length) continue;
    const p = hosts[Math.floor(rnd(world) * hosts.length)];
    p.pest = { left: PEST_TIME };
    fx(world, 'pest', p.x + 0.5, p.y + 0.5, '害蟲！');
    log(world, `田 ${p.i + 1} 出現害蟲，${PEST_TIME} 秒內不趕走就會被啃`);
  }
  for (const p of world.plots) {
    if (!p.pest) continue;
    if (p.state !== 'growing' && p.state !== 'ripe') { p.pest = null; continue; }
    p.pest.left -= dt;
    if (p.pest.left > 0) continue;
    p.pest = null;
    world.stats.lost += 1;
    if (p.state === 'growing') { p.prog = 0; p.stageWatered = false; }
    else {
      p.yield = Math.max(0, p.yield - PEST_BITE);
      if (p.yield === 0) Object.assign(p, { state: 'stubble', berry: null, stage: 0, prog: 0, waters: 0, stageWatered: false, wait: 0 });
    }
    fx(world, 'pest', p.x + 0.5, p.y + 0.5, '被啃了');
    log(world, `田 ${p.i + 1} 被害蟲啃了`);
  }
}

/** Coins for selling `n` units of one kind when the first `free` are full price. */
function saturated(unit, n, free, decay) {
  let v = 0;
  for (let k = 0; k < n; k++) v += unit * (k < free ? 1 : decay ** (k - free + 1));
  return v;
}
/** What the berry stock and the dishes would fetch at dusk, saturation included. */
function saleValue(world, berries = world.stock.berries, dishes = world.stock.dishes) {
  let v = 0;
  for (const [b, n] of Object.entries(berries)) v += saturated(sellPrice(world, b), n, SALE_FREE_BERRY, SALE_DECAY_BERRY);
  const sorted = dishes.map((d) => d.value).sort((a, b) => b - a);
  sorted.forEach((val, k) => { v += val * (k < SALE_FREE_DISH ? 1 : SALE_DECAY_DISH ** (k - SALE_FREE_DISH + 1)); });
  return v;
}
function stockValue(world) { return saleValue(world); }

/** What a plot will yield at its current moisture history (without luck rolls). */
export function expectedYield(plot) {
  const b = BERRIES[plot.berry];
  if (!b) return 0;
  const w = Math.min(4, plot.waters + (plot.stageWatered ? 1 : 0));
  return Math.min(b.max + (plot.ash ? ASH_BONUS : 0), b.min + Math.floor(((b.max - b.min) * w) / 4 + 0.001) + (plot.ash ? ASH_BONUS : 0));
}

/** Rough net worth, used to compare how two strategies leave the farm. */
export function netWorth(world) {
  let v = world.coins + stockValue(world) + world.wood * 2;
  for (const p of world.piles) v += p.kind === 'berry' ? sellPrice(world, p.berry) * p.qty : p.qty * 2;
  for (const p of world.plots) {
    if (p.state === 'growing') {
      const b = BERRIES[p.berry];
      v += expectedYield(p) * sellPrice(world, p.berry) * ((p.stage + p.prog / b.stage) / 4) * 0.7;
    } else if (p.state === 'ripe') v += p.yield * sellPrice(world, p.berry);
  }
  return Math.round(v);
}

function taskEntity(world, t) {
  if (t.plot != null) return world.plots[t.plot];
  return null;
}

/* -------------------------------------------------------------------- tasks */

function wantedTasks(world) {
  const want = [];
  const seed = BERRIES[world.seedPick];
  const stage = seed.stage;
  const dayEnd = DAY_SECONDS;
  for (const p of world.plots) {
    if (!p.open) continue;
    const c = tileCentre(p.x, p.y);
    const base = { plot: p.i, x: c.x, y: c.y };
    const sowBy = dayEnd - 4 * stage;
    if (p.state === 'wild' || p.state === 'stubble') want.push({ key: `clear:${p.i}`, kind: 'clear', ...base, deadline: sowBy - 8 });
    else if (p.state === 'fallow') want.push({ key: `till:${p.i}`, kind: 'till', ...base, deadline: sowBy - 5 });
    else if (p.state === 'tilled' && world.coins >= seedCost(world, world.seedPick)) want.push({ key: `sow:${p.i}`, kind: 'sow', ...base, deadline: sowBy });
    if ((p.state === 'tilled' || p.state === 'growing') && p.weeds) want.push({ key: `weed:${p.i}`, kind: 'weed', ...base, deadline: dayEnd });
    if (p.state === 'growing' && !p.stageWatered && world.water >= 1) {
      const b = BERRIES[p.berry];
      want.push({ key: `water:${p.i}`, kind: 'water', ...base, deadline: world.t + Math.max(0, b.stage - p.prog) });
    }
    if (p.pest) want.push({ key: `shoo:${p.i}`, kind: 'shoo', ...base, deadline: world.t + Math.max(0, p.pest.left) });
    if (p.state === 'ripe') want.push({ key: `harvest:${p.i}`, kind: 'harvest', ...base, deadline: world.t + Math.max(0, ripeRot(world) - p.wait) });
  }
  for (const pile of world.piles) {
    want.push({ key: `haul:${pile.id}`, kind: 'haul', pile: pile.id, x: pile.x, y: pile.y, deadline: dayEnd - 6 });
  }
  if (world.wood < WOOD_CAP) {
    world.trees.forEach((tr, i) => {
      if (tr.wood > 0) { const c = tileCentre(tr.x, tr.y); want.push({ key: `chop:${i}`, kind: 'chop', tree: i, x: c.x, y: c.y, deadline: dayEnd }); }
    });
  }
  world.trees.forEach((tr, i) => {
    if (!tr.shaken) { const c = tileCentre(tr.x, tr.y); want.push({ key: `shake:${i}`, kind: 'shake', tree: i, x: c.x, y: c.y, deadline: dayEnd }); }
  });
  (world.canals || []).forEach((c, i) => {
    const host = world.plots.find((p) => p.open && p.y === c.y && Math.abs(p.x - c.x) === 1);
    if (!c.built && host) { const t = tileCentre(c.x, c.y); want.push({ key: `canal:${i}`, kind: 'canal', canal: i, x: t.x, y: t.y, deadline: dayEnd }); }
  });
  if (world.water <= world.waterMax - TANK.perDraw) {
    const s = standBelow(WELL);
    want.push({ key: 'draw', kind: 'drawWater', x: s.x, y: s.y, deadline: dayEnd });
  }
  // A claimed cook has already taken its ingredients out of the stock, so the
  // stock alone would say "nothing to cook" and the task would be cancelled.
  const cooking = world.tasks.some((t) => t.kind === 'cook' && t.claimedBy != null);
  if (cooking || spareTotal(world) >= 3) {
    const s = standBelow(KITCHEN);
    want.push({ key: 'cook', kind: 'cook', x: s.x, y: s.y, deadline: dayEnd - 12 });
  }
  return want;
}

export function syncTasks(world) {
  const want = wantedTasks(world);
  const byKey = new Map(want.map((w) => [w.key, w]));
  // Drop tasks that stopped being true; release their worker.
  world.tasks = world.tasks.filter((t) => {
    if (byKey.has(t.key)) return true;
    const w = t.claimedBy != null ? world.workers.find((x) => x.id === t.claimedBy) : null;
    // A haul whose pile is gone because THIS worker just picked it up is still
    // in flight: dropping the task here would spill the cargo and loop forever.
    if (w && w.task === t.id && t.kind === 'haul' && w.leg >= 1) return true;
    if (w && w.task === t.id) cancelWorker(world, w, t);
    return false;
  });
  const have = new Set(world.tasks.map((t) => t.key));
  for (const w of want) {
    if (have.has(w.key)) {
      const t = world.tasks.find((x) => x.key === w.key);
      t.deadline = w.deadline;       // deadlines move (a stage ticking toward its end)
      continue;
    }
    world.tasks.push({ id: world.nextId++, ...w, since: world.t, claimedBy: null, legs: [] });
  }
}

function cancelWorker(world, worker, task) {
  if (task.reserved) {                        // refund cook ingredients
    for (const b of task.reserved.berries) world.stock.berries[b] = (world.stock.berries[b] || 0) + 1;
    world.wood += task.reserved.wood;
    task.reserved = null;
  }
  if (worker.carry && worker.carry.kind === 'berry') { /* carried goods are dropped as a pile */
    world.piles.push({ id: world.nextId++, x: worker.x, y: worker.y, kind: 'berry', berry: worker.carry.berry, qty: worker.carry.qty });
  } else if (worker.carry && worker.carry.kind === 'wood') {
    world.piles.push({ id: world.nextId++, x: worker.x, y: worker.y, kind: 'wood', qty: worker.carry.qty });
  }
  worker.carry = null;
  worker.task = null;
  worker.state = 'idle';
  task.claimedBy = null;
  task.legs = [];
}

/* ---------------------------------------------------------- worker capability */

/** Which method a worker uses for a `clear` job. */
export function clearMethod(worker) { return worker.def.rates.burn > 0 ? 'burn' : 'cut'; }

export function canDo(world, worker, task) {
  if (!isActive(world, worker)) return false;
  switch (task.kind) {
    case 'sow': return world.coins >= seedCost(world, world.seedPick);
    case 'water': return world.water >= 1;
    case 'cook': return spareTotal(world) >= 3 && (world.wood >= 1 || worker.def.rates.burn > 0);
    default: return true;
  }
}

function workSeconds(worker, task, world) {
  const j = JOBS[task.kind];
  const base = (1 + 0.08 * upOf(world).tools) * wxMul(world, worker.def) * affinity(world, worker);
  if (task.kind === 'clear' && clearMethod(worker) === 'burn') return BURN_TIME / (worker.def.rates.burn * base);
  const tool = base;
  let t = j.time / ((worker.def.rates[task.kind] || 1) * tool);
  if (task.kind === 'haul') t = 1 / ((worker.def.rates.haul || 1) * tool);      // pick up; the drop is its own leg
  return t;
}

function speedOf(world, worker) {
  let s = worker.def.speed;
  if (worker.def.sig?.earlyBird && world.t < 30) s *= worker.def.sig.earlyBird;
  return s * wxMul(world, worker.def) * ({ snow: 0.85, typhoon: 0.85, flood: 0.9 }[weatherOf(world)] || 1);
}

/** Legs of a task for this worker: [{x,y,work,effect}]. */
function planLegs(world, worker, task) {
  const here = { x: task.x, y: task.y };
  const ws = workSeconds(worker, task, world);
  if (task.kind === 'haul') {
    const dest = standBelow(WAREHOUSE);
    return [{ ...here, work: ws, effect: 'pickup' }, { x: dest.x, y: dest.y, work: 0.8, effect: 'drop' }];
  }
  return [{ ...here, work: ws, effect: task.kind }];
}

/** Value (coins) of finishing a task, for the greedy strategy and the UI. */
export function taskValue(world, task) {
  const p = taskEntity(world, task);
  switch (task.kind) {
    case 'clear': return 3;
    case 'till': return 3;
    case 'sow': return 5 + BERRIES[world.seedPick].price * 0.5;
    case 'weed': return 4;
    case 'shake': return 5 + 4;
    case 'canal': return 6;
    case 'shoo': return p && p.berry ? 6 + Math.max(2, expectedYield(p)) * berryPrice(p.berry) * 0.5 : 6;
    case 'water': return 6;
    case 'harvest': return (p && p.berry ? p.yield * berryPrice(p.berry) * 0.5 + 2 : 3) + (p && orderShort(world).berry[p.berry] > 0 ? 3 : 0);
    case 'haul': {
      const pile = world.piles.find((q) => q.id === task.pile);
      return pile ? (pile.kind === 'berry' ? berryPrice(pile.berry) * pile.qty : 2 * pile.qty) : 1;
    }
    case 'chop': return world.wood < 3 || orderShort(world).wood > 0 ? 8 : 2;      // wood only matters if something burns it
    case 'drawWater': return 3 + (1 - world.water / world.waterMax) * 9;
    case 'cook': {
      const r = bestRecipe(world);
      if (!r) return 1;
      const sh = orderShort(world).flavor;
      const orderBonus = r.flavors.some((f) => sh[f] > 0) ? 25 : 0;   // a dish somebody is waiting for
      return Math.max(1, r.value - r.sum) + orderBonus;
    }   // the margin over selling the berries raw
    default: return 1;
  }
}

/* ------------------------------------------------------------------ cooking */

/** Best 3-berry recipe from the stock (ties broken by cheaper berries). */
export function bestRecipe(world) {
  const spare = spareBerries(world);
  const avail = Object.entries(spare).filter(([, n]) => n > 0).map(([b]) => b);
  if (!avail.length || spareTotal(world) < 3) return null;
  let best = null;
  for (const a of avail) for (const b of avail) for (const c of avail) {
    const picks = [a, b, c];
    const need = {};
    for (const x of picks) need[x] = (need[x] || 0) + 1;
    if (Object.entries(need).some(([k, n]) => (spare[k] || 0) < n)) continue;
    const flav = new Set(picks.flatMap((k) => BERRIES[k].flavors));
    const sum = picks.reduce((s, k) => s + BERRIES[k].price, 0);
    let value = sum * (dishMultiplier(flav.size) + 0.15 * upOf(world).kitchen);
    if (flav.has(world.market.flavor)) value *= MARKET_BONUS;
    value = Math.round(value * (modsOf(world).dishValue || 1));
    if (!best || value > best.value || (value === best.value && sum < best.sum)) best = { picks, value, flavors: [...flav], sum };
  }
  return best;
}

/* ------------------------------------------------------------- strategies */

function etaOf(world, worker, task) {
  const legs = planLegs(world, worker, task);
  let at = { x: worker.x, y: worker.y };
  let t = 0;
  const sp = speedOf(world, worker);
  for (const l of legs) { t += dist(at, l) / sp + l.work; at = l; }
  return Math.max(0.2, t);
}

function scoreOf(strategy, world, worker, task) {
  switch (strategy) {
    case 'fifo': return -task.since * 1000 - task.id;
    case 'nearest': return -dist(worker, task) * 1000 - task.id;
    case 'edf': return -task.deadline * 1000 - dist(worker, task);
    case 'greedy':
    default: return (taskValue(world, task) / etaOf(world, worker, task)) * 1000 - task.id * 0.001;
  }
}

export function chooseTask(world, worker, strategy = world.strategy) {
  let best = null;
  let bestScore = -Infinity;
  for (const t of world.tasks) {
    if (t.claimedBy != null || !canDo(world, worker, t)) continue;
    const s = scoreOf(strategy, world, worker, t);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

/** Claim `task` for `worker`. Returns false if it cannot be done. */
export function claim(world, worker, task) {
  if (task.claimedBy != null || !canDo(world, worker, task)) return false;
  if (task.kind === 'cook') {
    const r = bestRecipe(world);
    if (!r) return false;
    const fire = worker.def.rates.burn > 0;
    for (const b of r.picks) world.stock.berries[b] -= 1;
    if (!fire) world.wood -= 1;
    task.reserved = { berries: r.picks, wood: fire ? 0 : 1, recipe: r };
  }
  task.claimedBy = worker.id;
  task.legs = planLegs(world, worker, task);
  worker.task = task.id;
  worker.leg = 0;
  worker.state = 'walk';
  return true;
}

/** Player override: give `worker` a specific task right now. */
export function assign(world, workerIndex, taskId) {
  const worker = world.workers[workerIndex];
  const task = world.tasks.find((t) => t.id === taskId);
  if (!worker || !task || task.claimedBy != null) return false;
  if (!canDo(world, worker, task)) return false;
  if (worker.task != null) {
    const old = world.tasks.find((t) => t.id === worker.task);
    if (old) cancelWorker(world, worker, old);
  }
  if (worker.state === 'rest') return false;
  return claim(world, worker, task);
}

/* ---------------------------------------------------------------- effects */

function pickupRoll(world, worker) {
  if (worker.def.pickup > 0 && rnd(world) < worker.def.pickup) {
    const c = 3 + Math.floor(rnd(world) * 6);
    world.coins += c;
    world.stats.earned += c;
    worker.earned += c;
    fx(world, 'coin', worker.x, worker.y, `+${c}`);
  }
}

function burn(world, plot, worker) {
  // Burning leaves ploughable ash-soil: it skips the tilling job, which is what
  // makes slash-and-burn worth more than its raw speed.
  plot.state = 'tilled';
  plot.weeds = false;
  plot.ash = true;
  plot.berry = null;
  fx(world, 'fire', plot.x + 0.5, plot.y + 0.5);
  if (worker.def.sig?.safeBurn) return;
  for (const q of neighbours(world, plot)) {
    const exposed = (q.state === 'growing' && !q.stageWatered) || q.state === 'ripe';
    if (exposed && rnd(world) < FIRE_SPREAD * (WINDY_WEATHER.has(weatherOf(world)) ? 2 : 1)) {
      q.state = 'stubble'; q.berry = null; q.yield = 0; q.stage = 0; q.prog = 0;
      world.stats.lost += 1;
      fx(world, 'fire', q.x + 0.5, q.y + 0.5, '延燒');
      log(world, `火燒到了隔壁的田（${q.x},${q.y}）`);
    }
  }
}

function applyEffect(world, worker, task, leg) {
  const plot = taskEntity(world, task);
  // A silent event for the sound layer: which job, by whom (type picks the move sound).
  if (leg.effect !== 'pickup' && leg.effect !== 'drop') fx(world, 'job', worker.x, worker.y, '', { job: leg.effect, type: worker.def.types[0] || 'Normal' });
  switch (leg.effect) {
    case 'clear':
      if (!plot) break;
      if (clearMethod(worker) === 'burn') burn(world, plot, worker);
      else { plot.state = 'fallow'; plot.weeds = false; plot.ash = false; plot.berry = null; }
      break;
    case 'till':
      if (!plot) break;
      plot.state = 'tilled';
      if (worker.def.sig?.dig) {
        const next = neighbours(world, plot).find((q) => q.state === 'fallow');
        if (next) next.state = 'tilled';
      }
      break;
    case 'sow': {
      const b = BERRIES[world.seedPick];
      if (!plot || plot.state !== 'tilled' || world.coins < seedCost(world, world.seedPick)) break;
      world.coins -= seedCost(world, world.seedPick);
      Object.assign(plot, { state: 'growing', berry: world.seedPick, stage: 0, prog: 0, waters: 0, stageWatered: WET_WEATHER.has(weatherOf(world)) || canalFeeds(world, plot), pest: null });
      break;
    }
    case 'weed': if (plot) plot.weeds = false; break;
    case 'shoo': if (plot?.pest) { plot.pest = null; fx(world, 'star', plot.x + 0.5, plot.y + 0.4, '趕走了'); } break;
    case 'water': {
      if (!plot || plot.state !== 'growing' || world.water < 1) break;
      world.water -= 1;
      plot.stageWatered = true;
      fx(world, 'drop', plot.x + 0.5, plot.y + 0.5);
      if (worker.def.sig?.splash) {
        const nb = neighbours(world, plot).find((q) => q.state === 'growing' && !q.stageWatered);
        if (nb && world.water >= 1) { world.water -= 1; nb.stageWatered = true; fx(world, 'drop', nb.x + 0.5, nb.y + 0.5); }
      }
      break;
    }
    case 'drawWater':
      world.water = Math.min(world.waterMax, world.water + (weatherOf(world) === 'drought' ? TANK.perDraw / 2 : TANK.perDraw));
      fx(world, 'drop', WELL.x + 0.5, WELL.y + 1);
      break;
    case 'harvest': {
      if (!plot || plot.state !== 'ripe' || !plot.berry) break;      // a hazard may have wiped it while the worker walked over
      let n = plot.yield;
      if (rnd(world) < worker.def.luck) { n += 1; fx(world, 'star', plot.x + 0.5, plot.y + 0.3, '+1'); }
      world.piles.push({ id: world.nextId++, x: plot.x + 0.5, y: plot.y + 0.5, kind: 'berry', berry: plot.berry, qty: n });
      world.stats.harvested += n;
      const berry = plot.berry;
      Object.assign(plot, { state: 'stubble', berry: null, stage: 0, prog: 0, waters: 0, stageWatered: false, weeds: false, ash: false, wait: 0, yield: 0 });
      if (worker.def.sig?.regrow && rnd(world) < worker.def.sig.regrow) {
        Object.assign(plot, { state: 'growing', berry });
        fx(world, 'star', plot.x + 0.5, plot.y + 0.5, '再長一輪');
      }
      break;
    }
    case 'pickup': {
      const pile = world.piles.find((q) => q.id === task.pile);
      if (!pile) break;
      const cap = (worker.def.carry + upOf(world).cart) * (pile.kind === 'berry' ? 3 : 2);
      const take = Math.min(cap, pile.qty);
      worker.carry = { kind: pile.kind, berry: pile.berry, qty: take };
      pile.qty -= take;
      if (pile.qty <= 0) world.piles = world.piles.filter((q) => q !== pile);
      break;
    }
    case 'drop': {
      const c = worker.carry;
      if (!c) break;
      if (c.kind === 'berry') world.stock.berries[c.berry] = (world.stock.berries[c.berry] || 0) + c.qty;
      else world.wood += c.qty;
      world.stats.hauled += c.qty;
      worker.carry = null;
      break;
    }
    case 'chop': {
      const tr = world.trees[task.tree];
      if (!tr || tr.wood <= 0) break;
      tr.wood -= 1;
      if (tr.wood === 0) tr.regrow = TREE_REGROW;
      world.piles.push({ id: world.nextId++, x: tr.x + 0.5, y: tr.y + 0.9, kind: 'wood', qty: 2 });
      fx(world, 'chip', tr.x + 0.5, tr.y + 0.5);
      break;
    }
    case 'shake': {
      const tr = world.trees[task.tree];
      if (!tr || tr.shaken) break;
      tr.shaken = true;
      // Wild berries: mostly cheap ones, now and then a good one.
      const pool = rnd(world) < 0.12 ? SHAKE_POOL.rare : SHAKE_POOL.common;
      const berry = pool[Math.floor(rnd(world) * pool.length)];
      world.piles.push({ id: world.nextId++, x: tr.x + 0.5, y: tr.y + 0.9, kind: 'berry', berry, qty: 1 + (rnd(world) < 0.5 ? 1 : 0) });
      fx(world, 'star', tr.x + 0.5, tr.y + 0.4, `${BERRIES[berry].zh}掉下來`);
      break;
    }
    case 'canal': {
      const c = world.canals[task.canal];
      if (!c || c.built) break;
      c.built = true;
      fx(world, 'drop', c.x + 0.5, c.y + 0.5, '渠道完成');
      log(world, `挖好一條渠道（${c.x},${c.y}），旁邊的田以後會自動吸水`);
      break;
    }
    case 'cook': {
      const r = task.reserved?.recipe;
      if (!r) break;
      world.stock.dishes.push({ value: r.value, flavors: r.flavors, picks: r.picks });
      world.stats.cooked += 1;
      task.reserved = null;
      fx(world, 'star', KITCHEN.x + 0.5, KITCHEN.y + 0.5, `料理 ${r.value}`);
      break;
    }
    default: break;
  }
}

/* -------------------------------------------------------------------- step */

function growPlots(world, dt, allowRot = true) {
  for (const p of world.plots) {
    if (!p.open) continue;
    if (p.state === 'growing') {
      const b = BERRIES[p.berry];
      p.prog += dt * (p.weeds ? 0.5 : 1) * growthMul(world);
      while (p.prog >= b.stage) {
        p.prog -= b.stage;
        if (p.stageWatered) p.waters += 1;
        p.stageWatered = false;
        p.stage += 1;
        if (WET_WEATHER.has(weatherOf(world)) || canalFeeds(world, p)) p.stageWatered = true;
        if (p.stage >= 4) {
          p.state = 'ripe';
          p.prog = 0;
          p.wait = 0;
          p.yield = expectedYield(p);
          fx(world, 'ready', p.x + 0.5, p.y + 0.5);
          break;
        }
      }
    } else if (p.state === 'ripe' && allowRot) {
      p.wait += dt;
      if (p.wait >= ripeRot(world)) {
        p.state = 'stubble'; p.berry = null; p.yield = 0; p.stage = 0; p.prog = 0; p.waters = 0; p.stageWatered = false; p.wait = 0;
        world.stats.lost += 1;
        log(world, '有樹果熟過頭，爛掉了');
      }
    }
    if (allowRot && (p.state === 'tilled' || p.state === 'growing') && !p.weeds && rnd(world) < WEED_RATE * (WET_WEATHER.has(weatherOf(world)) ? 1.5 : 1) * (modsOf(world).weed || 1) * dt) p.weeds = true;
  }
}

function moveWorker(world, worker, target, dt) {
  const sp = speedOf(world, worker) * dt;
  const dx = target.x - worker.x;
  const dy = target.y - worker.y;
  const d = Math.hypot(dx, dy);
  if (d <= sp || d < 0.001) { worker.x = target.x; worker.y = target.y; return true; }
  worker.x += (dx / d) * sp;
  worker.y += (dy / d) * sp;
  worker.face = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left');
  return false;
}

function updateWorker(world, worker, dt) {
  const def = worker.def;
  if (worker.state === 'rest') {
    worker.restLeft -= dt;
    worker.stamina = Math.min(def.staminaMax, worker.stamina + def.staminaMax * 0.08 * dt);
    if (worker.restLeft <= 0) { worker.state = 'idle'; worker.stamina = Math.max(worker.stamina, def.staminaMax * 0.6); }
    return;
  }
  if (worker.state === 'idle') {
    worker.stamina = Math.min(def.staminaMax, worker.stamina + 1 * dt);
    if (worker.stamina <= 1) { worker.state = 'rest'; worker.restLeft = 10; return; }
    if (world.strategy !== 'manual' && isActive(world, worker)) {
      const t = chooseTask(world, worker);
      if (t) claim(world, worker, t);
    }
    return;
  }
  const task = world.tasks.find((t) => t.id === worker.task);
  if (!task) { worker.state = 'idle'; worker.task = null; return; }
  const leg = task.legs[worker.leg];
  if (!leg) { worker.state = 'idle'; worker.task = null; return; }
  if (worker.state === 'walk') {
    worker.stamina -= 0.2 * dt;
    if (moveWorker(world, worker, leg, dt)) { worker.state = 'work'; worker.workLeft = leg.work; }
    return;
  }
  if (worker.state === 'work') {
    worker.stamina -= JOBS[task.kind].cost * dt;
    worker.workLeft -= dt;
    if (worker.workLeft > 0) return;
    applyEffect(world, worker, task, leg);
    worker.leg += 1;
    if (worker.leg < task.legs.length) { worker.state = 'walk'; return; }
    // Task finished.
    pickupRoll(world, worker);
    worker.done += 1;
    world.tasks = world.tasks.filter((t) => t !== task);
    worker.task = null;
    worker.state = 'idle';
  }
}

/* ----------------------------------------------------------------- hazards */

/**
 * HAZARDS. Rolled once each morning from the day's weather (`HAZARD_PLAN`):
 * thunder → bolts, flood → a flood, typhoon → a landfall, frost → a hard frost.
 * Each is `{ kind, at, warn, done, target? }`; `warn` seconds before `at` it is
 * announced on the board (`warned`). A `seer` crew member (Psychic type, Forewarn,
 * Anticipation) reads the whole list in the morning — that is the UI's business;
 * the engine just keeps the plan in the world so a replay sees the same sky.
 */
const WARN_SECONDS = { bolt: BOLT_WARN, landfall: 10, flood: 6, frost: 3 };
function planHazards(world) {
  world.hazards = [];
  const spec = HAZARD_PLAN[weatherOf(world)];
  if (!spec) return;
  const n = spec.count[0] + Math.floor(rnd(world) * (spec.count[1] - spec.count[0] + 1));
  for (let i = 0; i < n; i++) {
    const at = Math.round(spec.from + rnd(world) * (spec.to - spec.from));
    world.hazards.push({ kind: spec.kind, at, warn: WARN_SECONDS[spec.kind], warned: false, done: false, target: null });
  }
  world.hazards.sort((a, b) => a.at - b.at);
}

const destroyCrop = (p) => Object.assign(p, { state: 'stubble', berry: null, yield: 0, stage: 0, prog: 0, waters: 0, stageWatered: false, wait: 0, pest: null });

function runHazards(world) {
  for (const h of world.hazards || []) {
    if (h.done) continue;
    if (!h.warned && world.t >= h.at - h.warn) {
      h.warned = true;
      if (h.kind === 'bolt') {
        const open = world.plots.filter((p) => p.open);
        const p = open[Math.floor(rnd(world) * open.length)];
        h.target = p.i;
        fx(world, 'warn', p.x + 0.5, p.y + 0.5, '⚡', { hz: 'bolt' });
      } else fx(world, 'warn', GRID.w / 2, 1, { landfall: '颱風登陸！', flood: '洪水來了！', frost: '寒流！' }[h.kind], { hz: h.kind });
    }
    if (world.t < h.at) continue;
    h.done = true;
    resolveHazard(world, h);
  }
}

function resolveHazard(world, h) {
  if (h.kind === 'bolt') {
    const p = world.plots[h.target];
    const rods = crew(world, 'rod');
    if (rods && rnd(world) < Math.min(0.9, 0.5 * rods)) {
      fx(world, 'bolt', p.x + 0.5, p.y + 0.5, '引走了', { absorbed: true });
      log(world, `雷被避雷針引走了（田 ${p.i + 1}）`);
      world.stats.bolts = (world.stats.bolts || 0) + 1;
      return;
    }
    fx(world, 'bolt', p.x + 0.5, p.y + 0.5, '落雷！');
    if (p.state === 'growing' || p.state === 'ripe') {
      destroyCrop(p);
      p.ash = true;                                  // lightning leaves ash-soil, a small consolation
      world.stats.lost += 1;
      log(world, `落雷劈中了田 ${p.i + 1}`);
    } else log(world, `雷劈在空地上（田 ${p.i + 1}）`);
  } else if (h.kind === 'flood') {
    const mid = FIELD.y0 + FIELD.rows / 2;
    let hit = 0;
    for (const p of world.plots) {
      if (!p.open || p.y < mid || (p.state !== 'growing' && p.state !== 'ripe')) continue;
      if (canalFeeds(world, p)) continue;                       // a dug canal beside the plot drains it
      if (crew(world, 'drain') && rnd(world) < 0.5) continue;
      if (p.state === 'ripe') { p.yield = Math.floor(p.yield / 2); if (p.yield <= 0) destroyCrop(p); }
      else Object.assign(p, { stage: 0, prog: 0, waters: 0, stageWatered: true });
      hit += 1;
    }
    world.water = world.waterMax;
    fx(world, 'flood', GRID.w / 2, FIELD.y0 + FIELD.rows - 1, hit ? `淹了 ${hit} 塊` : '平安度過');
    log(world, hit ? `洪水淹了 ${hit} 塊田，水槽被灌滿` : '洪水來了，但田都沒事；水槽被灌滿');
    world.stats.lost += hit;
  } else if (h.kind === 'landfall') {
    let hit = 0;
    for (const p of world.plots) if (p.open && p.state === 'ripe' && p.yield > 0) { p.yield = Math.ceil(p.yield / 2); hit += 1; }
    world.piles = world.piles.map((q) => ({ ...q, qty: Math.floor(q.qty / 2) })).filter((q) => q.qty > 0);
    fx(world, 'landfall', GRID.w / 2, 2, '颱風登陸');
    log(world, `颱風登陸：${hit} 塊成熟的田和地上的堆都減半了`);
    world.stats.lost += hit;
  } else if (h.kind === 'frost') {
    const warm = crew(world, 'warm') > 0;
    let hit = 0;
    for (const p of world.plots) {
      if (!p.open || p.state !== 'growing' || p.stage > 1) continue;
      if (rnd(world) < (warm ? 0.15 : 0.5)) { destroyCrop(p); hit += 1; }
    }
    fx(world, 'frost', GRID.w / 2, 2, hit ? `凍死 ${hit} 株` : '幼苗撐住了');
    log(world, hit ? `寒流凍死了 ${hit} 株幼苗` : '寒流來了，幼苗都撐住了');
    world.stats.lost += hit;
  }
}

export function step(world, dt) {
  if (world.over) return;
  world.t += dt;
  world.steps += 1;
  growPlots(world, dt);
  runPests(world, dt);
  runHazards(world);
  for (const tr of world.trees) {
    if (tr.wood === 0) { tr.regrow -= dt; if (tr.regrow <= 0) tr.wood = TREE_WOOD; }
  }
  if (world.steps % SYNC_EVERY === 1) syncTasks(world);
  for (const w of world.workers) updateWorker(world, w, dt);
  if (world.t >= DAY_SECONDS) world.over = true;
}

/* ------------------------------------------------------------------ end of day */

/**
 * Sell, grow overnight, roll tomorrow. Returns a report. Dishes always sell
 * (market flavour bonus is already in their `value`); berries sell down to
 * KEEP_BERRIES so tomorrow's cooking has something to start with.
 */
export function endDay(world) {
  const report = { day: world.day, dishes: world.stock.dishes.length, dishCoins: 0, berrySold: 0, berryCoins: 0, lost: world.stats.lost };
  ensureOrders(world);
  report.orders = settleOrders(world);
  report.orderCoins = report.orders.reduce((a, o) => a + o.pay, 0);
  // What the orders still open (due later) need is held back from the sale.
  const hold = { berry: {}, dishes: [] };
  const spare = world.stock.dishes.slice().sort((a, b) => a.value - b.value);
  for (const o of world.orders) {
    if (o.kind === 'berry') hold.berry[o.berry] = (hold.berry[o.berry] || 0) + o.qty;
    else if (o.kind === 'dish') {
      let need = o.qty;
      for (let i = 0; i < spare.length && need > 0; i++) if (dishMatches(spare[i], o.flavor)) { hold.dishes.push(spare[i]); spare.splice(i, 1); need -= 1; i -= 1; }
    }
  }
  report.dishCoins = Math.round(saleValue(world, {}, spare));
  report.dishes = spare.length;
  world.stock.dishes = hold.dishes;
  // Keep one of each berry type (up to KEEP_BERRIES types) for tomorrow's cooking
  // — variety is what makes a dish worth more — and sell everything else.
  const kept = {};
  let slots = KEEP_BERRIES;
  for (const [b, n] of Object.entries(world.stock.berries)) if (n > 0 && slots > 0) { kept[b] = 1; slots -= 1; }
  for (const [b, n] of Object.entries(hold.berry)) kept[b] = Math.min(world.stock.berries[b] || 0, Math.max(kept[b] || 0, n));
  for (const [b, n] of Object.entries(world.stock.berries)) {
    const sell = n - (kept[b] || 0);
    if (sell > 0) { report.berrySold += sell; report.berryCoins += Math.round(saturated(sellPrice(world, b), sell, SALE_FREE_BERRY, SALE_DECAY_BERRY)); }
    world.stock.berries[b] = kept[b] || 0;
  }
  report.earned = report.dishCoins + report.berryCoins + report.orderCoins;
  report.rep = world.rep;
  report.upkeep = world.workers.reduce((a, w) => a + Math.round(w.def.wage / UPKEEP_DIV), 0);
  report.paid = Math.min(report.upkeep, world.coins + report.earned);      // a farm cannot go below 0 coins
  world.coins += report.earned - report.paid;
  world.stats.earned += report.earned;
  report.coins = world.coins;
  report.netWorth = netWorth(world);

  // Night: crops grow, weeds do not, nothing rots.
  growPlots(world, NIGHT_GROWTH, false);
  for (const p of world.plots) if (p.state === 'ripe') p.wait = Math.min(p.wait, RIPE_ROT / 2);
  // Winter: the crew needs firewood to sleep warm; without it they start cold tomorrow.
  const endMods = modsOf(world);
  world.cold = false;
  if (endMods.heat) {
    const need = Math.ceil(world.workers.length / 2);
    const used = Math.min(need, world.wood);
    world.wood -= used;
    world.cold = used < need;
    report.heat = { need, used, cold: world.cold };
  }
  for (const w of world.workers) {
    if (w.task != null) {
      const t = world.tasks.find((x) => x.id === w.task);
      if (t) cancelWorker(world, w, t);
    }
    w.state = 'idle'; w.stamina = Math.round(w.def.staminaMax * (world.cold ? 0.85 : 1));
  }
  world.tasks = [];
  world.water = Math.min(world.waterMax, world.water + Math.round(6 * (endMods.refill ?? 1)));
  // End of a season: stars for the net worth it added, then the loaner goes home.
  const si = seasonInfo(world);
  if (si.dayIn === SEASON_DAYS) {
    const gain = world.stats.earned - world.seasonWorth;     // revenue, not net worth: spending on growth is not punished
    const goal = seasonGoal(world);
    const stars = goal.filter((g) => gain >= g).length;
    report.season = { key: si.key, zh: si.def.zh, gain, stars, goal };
    world.seasons.push({ key: si.key, gain, stars });
    world.seasonWorth = world.stats.earned;
    world.workers = world.workers.filter((w) => !w.def.loan);
    if (!world.endless && report.day >= RUN_DAYS) {
      const total = world.seasons.slice(0, 4).reduce((a, x) => a + x.stars, 0);
      world.finished = true;
      report.run = { stars: total, worth: world.stats.earned, rating: ratingOf(total, world.stats.earned, world.strict).id };
    }
  }
  for (const p of world.plots) p.pest = null;              // pests leave at dusk without biting
  for (const tr of world.trees) tr.shaken = false;         // the trees have berries again tomorrow
  world.day += 1;
  world.t = 0;
  world.over = false;
  world.stats.lost = 0;
  world.weather = world.forecast || 'sun';
  atDawn(world, () => {
    world.market.flavor = FLAVORS[Math.floor(rnd(world) * FLAVORS.length)];
    world.forecast = rollWeather(world, world.day + 1);
    if (world.weather === 'drought') world.water = Math.floor(world.water / 2);
    planPests(world);
    planHazards(world);
    rollOrders(world);
  });
  log(world, `第 ${report.day} 天結算：${report.earned} 金幣，今日熱銷味道換成「${FLAVOR_ZH[world.market.flavor]}」`);
  return report;
}

/* ------------------------------------------------------ strategy comparison */

/** Run a full day from `snapshot` under `strategy`; returns { earned, worth, gain }. */
export function runDay(snapshot, strategy) {
  const w = structuredClone(snapshot);
  w.strategy = strategy;
  w.noFx = true;
  const before = netWorth(w);
  const steps = Math.round(DAY_SECONDS / 0.1);
  for (let i = 0; i < steps && !w.over; i++) step(w, 0.1);
  const rep = endDay(w);
  return { strategy, earned: rep.earned, worth: rep.netWorth, gain: rep.netWorth - before };
}

export function compareStrategies(snapshot) {
  return AUTO_STRATEGIES.map((s) => runDay(snapshot, s));
}

/* ------------------------------------------------------------------ economy */

export const PLOT_UNLOCK_COST = 150;
export const TANK_UPGRADE_COST = 120;

export function unlockPlots(world) {
  if (world.plotsOpen >= world.plots.length || world.coins < PLOT_UNLOCK_COST) return false;
  world.coins -= PLOT_UNLOCK_COST;
  for (let i = world.plotsOpen; i < world.plotsOpen + 4 && i < world.plots.length; i++) world.plots[i].open = true;
  world.plotsOpen += 4;
  return true;
}
export function upgradeTank(world) {
  if (world.coins < TANK_UPGRADE_COST) return false;
  world.coins -= TANK_UPGRADE_COST;
  world.waterMax += 8;
  world.water += 8;
  return true;
}
/** What `def` costs to hire now: dearer with every hand beyond the starter three. */
export function hireCost(world, def) {
  // The season's loaner is on the farm only on loan, so it must not make the next hire dearer.
  const crew = world.workers.filter((w) => !w.def.loan).length;
  return Math.round(def.wage * (1 + HIRE_STEP * Math.max(0, crew - 3)));
}
export function hire(world, def) {
  const cost = hireCost(world, def);
  if (world.workers.some((w) => w.id === def.id) || world.coins < cost) return false;
  world.coins -= cost;
  addWorker(world, def);
  return true;
}
/** Cost of the next level of upgrade `key`, or null at the maximum. */
export function upgradeCost(world, key) {
  const u = UPGRADES[key];
  const lv = upOf(world)[key];
  return !u || lv >= u.max ? null : Math.round(u.base * u.mult ** lv);
}
export function buyUpgrade(world, key) {
  const c = upgradeCost(world, key);
  if (c == null || world.coins < c) return false;
  world.coins -= c;
  upOf(world)[key] += 1;
  return true;
}
export function setSeed(world, id) { if (BERRIES[id]) world.seedPick = id; }
export { BERRY_IDS, GRID };
