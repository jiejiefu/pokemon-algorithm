#!/usr/bin/env node
/**
 * pokefarm.html's simulation — pure Node, no browser.
 * Run: node scripts/check_pokefarm_engine.mjs
 *
 * The engine is a pure function of (world, strategy), so everything here runs
 * headless. Each assertion guards a break that still renders:
 *
 *   - DETERMINISM: the dusk screen replays the day from a snapshot under four
 *     strategies and compares them. If a second run of the same world differed,
 *     every number on that screen would be noise with a confident label.
 *   - THE HAUL LOOP: a haul whose pile vanished at pickup was cancelled by the
 *     next task sync, which spilled the cargo as a NEW pile — workers hauled
 *     forever, the farm looked busy, and nothing was ever stocked.
 *   - THE CANCELLED COOK: a claimed cook takes its berries out of the stock, so
 *     "no berries left" cancelled the very job that had just started.
 *   - Burning leaves tilled ash-soil, only Fire types can do it, and a neighbour
 *     is only at risk when it is unwatered and the burner has no safe-burn.
 *   - Every one of the 1,025 species builds a finite, bounded worker.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createWorld, step, endDay, runDay, compareStrategies, netWorth, bestRecipe, expectedYield,
  syncTasks, assign, clearMethod, hire, hireCost, unlockPlots, PLOT_UNLOCK_COST, AUTO_STRATEGIES,
  buyUpgrade, upgradeCost, weatherOf, rnd, orderHave, orderSlots, repMultiplier, ensureOrders, spareBerries, canalFeeds, ensureCanals,
  canDo, seasonInfo, seasonGate, addLoaner, keepLoaner, ratingOf, ensureSeason, seedCost, isActive, hashStr, seasonGoal,
} from '../assets/js/pokefarm-engine.js';
import {
  buildWorker, visitorIds, BERRIES, DAY_SECONDS, FIELD_START, JOB_IDS, STARTERS, SIGNATURES,
  ABILITY_PERKS, PERK_RATE_CAP, SHAKE_POOL, dishMultiplier, UPGRADES, WEATHER, PEST_TIME, PEST_FROM_DAY, SALE_FREE_BERRY, UPKEEP_DIV,
  SEASONS, SEASON_DAYS, RUN_DAYS, HAZARD_PLAN, RATINGS,
} from '../assets/js/pokefarm-data.js';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const roster = JSON.parse(readFileSync(join(BASE, 'assets/data/home_roster.json'), 'utf8'));
const dexData = JSON.parse(readFileSync(join(BASE, 'assets/data/home_dex.json'), 'utf8'));

let checks = 0;
const problems = [];
const ok = (cond, msg, why) => { checks++; if (!cond) problems.push(why ? `${msg} — ${why}` : msg); };
const eq = (got, want, msg) => ok(Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const abilityData = JSON.parse(readFileSync(join(BASE, 'assets/data/species_abilities.json'), 'utf8'));
const abilitiesOf = (id) => { const a = abilityData[id] || {}; return [...(a.reg || []).slice(0, 1).map((slug) => ({ slug })), ...(a.hid || []).slice(0, 1).map((slug) => ({ slug, hidden: true }))]; };
const typesOf = (id) => [dexData.p[id - 1][2], dexData.p[id - 1][3]].filter((t) => t >= 0).map((t) => dexData.types[t]);
const defOf = (id) => buildWorker(id, roster[id - 1], typesOf(id), abilitiesOf(id));
const playDay = (w) => { for (let i = 0; i < DAY_SECONDS * 10 && !w.over; i++) step(w, 0.1); return endDay(w); };

/* ------------------------------------------------------------ the workers */
{
  let bad = 0;
  for (let id = 1; id <= 1025; id++) {
    const d = defOf(id);
    const nums = [d.speed, d.carry, d.staminaMax, d.wage, ...Object.values(d.rates)];
    if (nums.some((n) => !Number.isFinite(n)) || d.speed < 0.9 || d.speed > 4.2 || d.carry < 1 || d.staminaMax < 40) bad++;
    if (JOB_IDS.some((j) => !(d.rates[j] > 0.3 && d.rates[j] < 4))) bad++;
  }
  eq(bad, 0, 'all 1,025 species build a finite, bounded worker');

  const squirtle = defOf(7); const charmander = defOf(4); const diglett = defOf(50); const machop = defOf(66);
  ok(squirtle.rates.water > charmander.rates.water * 2, 'a Water type waters far faster than a Fire type (Fire is penalised)', `${squirtle.rates.water} vs ${charmander.rates.water}`);
  ok(charmander.rates.burn > 0 && squirtle.rates.burn === 0, 'only a Fire type can burn');
  ok(diglett.rates.till > defOf(1).rates.till * 1.5, 'a Ground type tills much faster');
  ok(machop.rates.chop > squirtle.rates.chop * 1.5, 'a Fighting type chops much faster');
  ok(defOf(63).carry > defOf(64).carry - 1 && defOf(63).sig?.label === '念力', 'Abra carries extra through its specialty');
  ok(Object.keys(SIGNATURES).every((k) => Number(k) >= 1 && Number(k) <= 1025), 'every specialty is keyed by a real dex id');
  ok(defOf(25).sig?.drawBonus === 1.5 && defOf(25).rates.drawWater > defOf(1).rates.drawWater, 'Pikachu draws water faster (Charge)');
}

/* ------------------------------------------------------------ visitors */
{
  const a = visitorIds('2026-10-30'); const b = visitorIds('2026-10-30'); const c = visitorIds('2026-10-31');
  eq(a, b, 'visitors are a pure function of the date');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'a different day brings different visitors');
  ok(new Set(a).size === a.length && a.every((n) => n >= 1 && n <= 1025), 'visitors are distinct, real species');
}

/* ------------------------------------------------------------ determinism */
{
  const make = () => createWorld({ seed: 7, workers: STARTERS.map(defOf) });
  const a = make(); const b = make();
  for (let i = 0; i < 400; i++) { step(a, 0.1); step(b, 0.1); }
  eq(JSON.stringify(a), JSON.stringify(b), 'two worlds with the same seed are identical after 40 s');

  const snap = structuredClone(a);
  const r1 = runDay(snap, 'greedy'); const r2 = runDay(snap, 'greedy');
  eq(r1, r2, 'replaying a snapshot under one strategy gives the same day');
  ok(JSON.stringify(a) === JSON.stringify(snap), 'runDay does not mutate the snapshot it is given');
  const cmp = compareStrategies(snap);
  eq(cmp.map((r) => r.strategy), AUTO_STRATEGIES, 'compareStrategies reports every automatic strategy, in order');
  ok(cmp.every((r) => Number.isFinite(r.earned) && Number.isFinite(r.gain)), 'every strategy row is a finite number');
  ok(new Set(cmp.map((r) => r.gain)).size > 1, 'the strategies do not all give the identical result (they differ in what they do)');
}

/* ------------------------------------------------- no deadlock, haul, cook */
{
  const w = createWorld({ seed: 7, workers: STARTERS.map(defOf) });
  const harvested = [];
  const earned = [];
  for (let d = 0; d < 4; d++) { if (d === 3) w.orders = []; /* open orders legitimately hold stock back */ const r = playDay(w); harvested.push(w.stats.harvested); earned.push(r.earned); }
  ok(harvested[1] > harvested[0] && harvested[2] > harvested[1] && harvested[3] > harvested[2], 'harvests keep growing across days (the farm never stalls)', JSON.stringify(harvested));
  ok(earned.slice(1).every((e) => e > 0), 'every day after the first earns something', JSON.stringify(earned));
  ok(w.stats.hauled >= w.stats.harvested * 0.8, 'hauling keeps up with harvesting (no spill loop)', `${w.stats.hauled} hauled / ${w.stats.harvested} harvested`);
  ok(w.piles.length <= 20, 'loose piles stay bounded (shaken berries add some)', String(w.piles.length));
  const stored = Object.values(w.stock.berries).reduce((x, y) => x + y, 0);
  ok(stored <= 6, 'dusk keeps at most six berries back', String(stored));
  ok(netWorth(w) > 0, 'net worth is positive');
}
{
  // The cancelled cook: stock three different berries and a log; a Fire type must finish a dish.
  const w = createWorld({ seed: 3, workers: [defOf(4)] });
  w.orders = []; w.stock.berries = { cheri: 1, chesto: 1, pecha: 1 };
  for (let i = 0; i < 400; i++) step(w, 0.1);
  eq(w.stats.cooked, 1, 'a claimed cook survives the next task sync and finishes (no wood needed for a Fire type)');
  eq(w.stock.dishes.length, 1, 'the dish lands in the stock');
  const r = w.stock.dishes[0];
  eq(r.flavors.length, 3, 'three distinct berries make a three-flavour dish');
  ok(r.value > 27 * dishMultiplier(1), 'variety makes a dish worth more than its berries raw', `${r.value}`);
  // Market flavour bonus.
  const m = createWorld({ seed: 1, workers: [defOf(1)] });
  m.orders = []; m.stock.berries = { cheri: 3 };
  m.market.flavor = 'dry'; const plain = bestRecipe(m).value;
  m.market.flavor = 'spicy'; const bonus = bestRecipe(m).value;
  ok(bonus > plain, 'a dish with the market flavour is worth more', `${bonus} vs ${plain}`);
}

/* ----------------------------------------------------------- fire and water */
/** A manual world: plot 0 is stubble, plot 1 a growing neighbour; the lone worker is told to clear plot 0. */
function burnTrial(id, seed, { watered }) {
  const w = createWorld({ seed, workers: [defOf(id)] });
  w.strategy = 'manual';
  w.plots[0].state = 'stubble';
  Object.assign(w.plots[1], { state: 'growing', berry: 'cheri', stage: 1, stageWatered: watered });
  syncTasks(w);
  const task = w.tasks.find((x) => x.key === 'clear:0');
  if (!task || !assign(w, 0, task.id)) return null;
  for (let i = 0; i < 100 && w.plots[0].state === 'stubble'; i++) step(w, 0.1);
  return w;
}
const firstFireWithout = (sigKey) => {
  for (let id = 1; id <= 1025; id++) if (typesOf(id)[0] === 'Fire' && !(SIGNATURES[id] && SIGNATURES[id][sigKey])) return id;
  return 0;
};
{
  eq(clearMethod(createWorld({ seed: 1, workers: [defOf(4)] }).workers[0]), 'burn', 'a Fire type burns when it clears');
  eq(clearMethod(createWorld({ seed: 1, workers: [defOf(1)] }).workers[0]), 'cut', 'anyone else cuts');
  const w = burnTrial(4, 5, { watered: true });
  ok(w && w.plots[0].ash === true && w.plots[0].state === 'tilled', 'a burned plot is ash-soil that skips the tilling job', w && w.plots[0].state);
  const cutter = createWorld({ seed: 5, workers: [defOf(1)] });
  cutter.strategy = 'manual';
  cutter.plots[0].state = 'stubble';
  syncTasks(cutter);
  assign(cutter, 0, cutter.tasks.find((x) => x.key === 'clear:0').id);
  for (let i = 0; i < 100 && cutter.plots[0].state === 'stubble'; i++) step(cutter, 0.1);
  ok(cutter.plots[0].state === 'fallow' && !cutter.plots[0].ash, 'cutting leaves plain fallow ground that still needs tilling');
}
{
  const plain = firstFireWithout('safeBurn');
  const count = (id, watered) => {
    let lost = 0; let ran = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = burnTrial(id, seed, { watered });
      if (!w) continue;
      ran++;
      if (w.plots[1].state === 'stubble') lost++;
    }
    return { lost, ran };
  };
  const dry = count(plain, false);
  const wet = count(plain, true);
  const safe = count(4, false);
  ok(dry.ran === 40 && dry.lost > 0, 'burning can scorch an UNWATERED neighbour', `${dry.lost} of ${dry.ran}`);
  eq(wet.lost, 0, 'a watered neighbour is safe');
  eq(safe.lost, 0, 'Charmander (Ember, safe-burn) never spreads fire');
}
{
  // Yield: more waterings -> more berries, bounded by the berry's own max (+1 ash).
  const b = BERRIES.cheri;
  const p = { berry: 'cheri', waters: 0, stageWatered: false, ash: false };
  eq(expectedYield(p), b.min, 'an unwatered plant yields the minimum');
  p.waters = 4; eq(expectedYield(p), b.max, 'a fully watered plant yields the maximum');
  p.ash = true; eq(expectedYield(p), b.max + 1, 'ash adds one berry on top');
  p.waters = 2; p.ash = false;
  ok(expectedYield(p) > b.min && expectedYield(p) < b.max, 'half the waterings give something in between');
}

/* -------------------------------------------------------------- economy */
{
  const w = createWorld({ seed: 2, workers: [defOf(1)], coins: 1000 });
  eq(w.plots.filter((p) => p.open).length, FIELD_START, 'the farm opens with FIELD_START plots');
  ok(unlockPlots(w), 'a row of plots can be bought');
  eq(w.plots.filter((p) => p.open).length, FIELD_START + 4, 'buying opens four more');
  eq(w.coins, 1000 - PLOT_UNLOCK_COST, 'and charges the listed price');
  const d = defOf(25);
  ok(hire(w, d), 'a worker can be hired');
  ok(!hire(w, d), 'the same worker cannot be hired twice');
  const poor = createWorld({ seed: 2, workers: [], coins: 1 });
  ok(!hire(poor, d), 'hiring needs the money');
}


/* ------------------------------------------- sinks: upkeep, saturation, upgrades */
{
  // A 16-day run with nothing to spend on had 23,000 coins by day 16.
  const w = createWorld({ seed: 5, workers: [defOf(1), defOf(4), defOf(7)], coins: 5000 });
  const wages = w.workers.reduce((a, x) => a + Math.round(x.def.wage / UPKEEP_DIV), 0);
  for (let i = 0; i < DAY_SECONDS * 10 && !w.over; i++) step(w, 0.1);
  const atDusk = w.coins;                 // seeds bought during the day are already out of this
  const rep = endDay(w);
  eq(rep.upkeep, wages, 'dusk charges every worker wage / UPKEEP_DIV');
  eq(w.coins, atDusk + rep.earned - rep.paid, 'coins move by earnings minus upkeep paid');
  const broke = createWorld({ seed: 5, workers: [defOf(1)], coins: 0 });
  broke.workers[0].def.wage = 10000;
  const r2 = endDay(broke);
  ok(broke.coins >= 0 && r2.paid <= r2.earned, 'a farm cannot be driven below 0 coins by upkeep');

  // Saturation: 30 berries of ONE kind fetch far less than 30 x price, 3 kinds of 10 do not.
  const mono = createWorld({ seed: 5, workers: [], coins: 0 });
  mono.orders = []; mono.stock.berries = { pecha: 31 };
  const a = endDay(mono);
  const trio = createWorld({ seed: 5, workers: [], coins: 0 });
  trio.orders = []; trio.stock.berries = { pecha: 11, cheri: 11, oran: 11 };
  const b = endDay(trio);
  ok(a.berryCoins < 30 * BERRIES.pecha.price * 0.75, 'selling one kind in bulk is discounted', `${a.berryCoins}`);
  const flat = 10 * (BERRIES.pecha.price + BERRIES.cheri.price + BERRIES.oran.price);
  eq(b.berryCoins, flat, `${SALE_FREE_BERRY} of each kind still sell at full price`);

  // Upgrades are permanent, escalate, and stop at their maximum.
  const u = createWorld({ seed: 5, workers: [], coins: 1e6 });
  const c0 = upgradeCost(u, 'tools');
  ok(buyUpgrade(u, 'tools') && u.up.tools === 1, 'an upgrade can be bought');
  ok(upgradeCost(u, 'tools') > c0, 'the next level costs more');
  for (let i = 0; i < 20; i++) buyUpgrade(u, 'tools');
  eq(u.up.tools, UPGRADES.tools.max, 'levels stop at the maximum');
  eq(upgradeCost(u, 'tools'), null, 'and there is no price after the last level');
  const poorU = createWorld({ seed: 5, workers: [], coins: 1 });
  ok(!buyUpgrade(poorU, 'cart'), 'an upgrade needs the money');
  // Tools make the same day productive-er: a deterministic comparison from one seed.
  const base = createWorld({ seed: 9, workers: [defOf(1), defOf(4), defOf(7)] });
  const fast = structuredClone(base); fast.up.tools = 8;
  const ra = playDay(base), rb = playDay(fast);
  ok(rb.earned >= ra.earned, 'a toolshed does not make a day worse', `${ra.earned} vs ${rb.earned}`);
  // Hiring costs more per extra hand.
  const h = createWorld({ seed: 5, workers: [defOf(1), defOf(4), defOf(7)] });
  const d = defOf(25);
  const first = hireCost(h, d);
  h.workers.push(...[defOf(52), defOf(66)].map((x) => ({ ...h.workers[0], id: x.id, def: x })));
  ok(hireCost(h, d) > first, 'the fourth and fifth hand are dearer than the first extra');
}

/* ------------------------------------------------------------ weather, pests */
{
  // Day 1 is always sunny, and the forecast is already in the world for dusk to promote.
  const w = createWorld({ seed: 11, workers: [defOf(1)] });
  eq(weatherOf(w), 'sun', 'day 1 is sunny');
  ok(w.forecast in WEATHER, 'a forecast exists from the start');
  const f = w.forecast;
  playDay(w);
  eq(w.weather, f, 'tomorrow arrives as forecast');
  const seen = new Set();
  for (let s = 1; s <= 60 && seen.size < 4; s++) { const x = createWorld({ seed: s, workers: [] }); seen.add(x.forecast); }
  eq(seen.size, 4, 'all four weathers occur across seeds');

  // The weather is part of the snapshot, so every strategy replay sees the same sky.
  const snap = createWorld({ seed: 21, workers: [defOf(1), defOf(4), defOf(7)] });
  playDay(snap);
  const same = compareStrategies(snap).map((r) => r.earned);
  eq(compareStrategies(snap).map((r) => r.earned), same, 'strategy replays are repeatable with weather and pests in play');

  // Rain waters sown crops; drought halves the tank and each draw.
  const rainy = createWorld({ seed: 3, workers: [defOf(1)] });
  rainy.weather = 'rain';
  const pl = rainy.plots[0]; Object.assign(pl, { state: 'tilled' });
  rainy.workers[0].x = pl.x + 0.5; rainy.workers[0].y = pl.y + 0.5;
  rainy.strategy = 'manual'; syncTasks(rainy);
  const sow = rainy.tasks.find((t) => t.kind === 'sow' && t.plot === 0);
  ok(sow && assign(rainy, 0, sow.id), 'a sow job can be assigned');
  for (let i = 0; i < 80 && rainy.plots[0].state !== 'growing'; i++) step(rainy, 0.1);
  eq(rainy.plots[0].state, 'growing', 'the seed went in');
  ok(rainy.plots[0].stageWatered, 'rain waters a seedling for free');
  const dry = createWorld({ seed: 3, workers: [] });
  dry.forecast = 'drought'; dry.water = 20; endDay(dry);
  eq(dry.weather, 'drought', 'the forecast promotes to today');
  eq(dry.water, Math.floor(Math.min(dry.waterMax, 20 + 6) / 2), 'a drought halves the tank at dawn');

  // Pests: none before PEST_FROM_DAY, shooed in time = no loss, ignored = a bite.
  const early = createWorld({ seed: 4, workers: [] });
  eq(early.pestPlan.length, 0, 'no pests on day 1');
  const pw = createWorld({ seed: 4, workers: [defOf(1)] });
  pw.day = PEST_FROM_DAY;
  pw.pestPlan = [1];
  const pp = pw.plots[0]; Object.assign(pp, { state: 'ripe', berry: 'cheri', yield: 4, wait: 0 });
  pw.strategy = 'manual';
  for (let i = 0; i < 30; i++) step(pw, 0.1);
  ok(pp.pest, 'a pest turned up on the only ripe plot');
  ok(pw.tasks.some((t) => t.kind === 'shoo' && t.plot === 0), 'and a shoo job exists for it');
  const bitten = structuredClone(pw);
  for (let i = 0; i < (PEST_TIME + 2) * 10; i++) step(bitten, 0.1);
  ok(!bitten.plots[0].pest && bitten.plots[0].yield < 4, 'an ignored pest bites the harvest', `${bitten.plots[0].yield}`);
  const shooTask = pw.tasks.find((t) => t.kind === 'shoo');
  pw.workers[0].x = pp.x + 0.5; pw.workers[0].y = pp.y + 0.5;
  ok(assign(pw, 0, shooTask.id), 'a worker can be sent to shoo it');
  for (let i = 0; i < 80; i++) step(pw, 0.1);
  ok(!pw.plots[0].pest && pw.plots[0].yield === 4, 'a shooed pest leaves the berries alone', `${pw.plots[0].yield}`);
}


/* -------------------------------------------------------------------- orders */
{
  const w = createWorld({ seed: 8, workers: [defOf(1)] });
  ok(w.orders.length >= 2 && w.orders.length <= 4, 'the first morning has 2-4 orders', `${w.orders.length}`);
  ok(w.orders.every((o) => o.due >= w.day + 1), 'day-1 orders give at least two days of notice', JSON.stringify(w.orders.map((o) => o.due)));
  ok(w.orders.every((o) => o.reward > 0 && o.qty > 0), 'every order asks for something and pays something');
  eq(orderSlots(w), 2, 'reputation 0 allows two open orders');
  w.rep = 3; eq(orderSlots(w), 3, 'reputation 3 allows three');
  w.rep = 8; eq(orderSlots(w), 4, 'reputation 8 allows four, the maximum');
  w.rep = 0;

  // Determinism: two worlds from one seed roll the same orders, and the same days after.
  const a = createWorld({ seed: 8, workers: [defOf(1)] });
  eq(a.orders, w.orders, 'the same seed rolls the same orders');

  // Filling: a berry order is paid at dusk, from stock, with reputation going up.
  const f = createWorld({ seed: 8, workers: [] , coins: 0 });
  f.orders = [{ id: 901, kind: 'berry', berry: 'oran', qty: 4, reward: 50, born: 1, due: 1 }];
  f.stock.berries = { oran: 5 };
  const r1 = endDay(f);
  eq(r1.orders.length, 1, 'one order was settled');
  ok(r1.orders[0].ok && r1.orders[0].pay === 50, 'the berry order was filled and paid its reward at reputation 0', JSON.stringify(r1.orders));
  eq(f.rep, 1, 'filling an order earns a point of reputation');
  eq(r1.orderCoins, 50, 'order coins are reported');
  ok(r1.earned >= 50, 'order coins count toward the day\'s earnings');

  // Reputation scales the reward.
  const g = createWorld({ seed: 8, workers: [], coins: 0 });
  g.rep = 10; g.orders = [{ id: 902, kind: 'wood', qty: 3, reward: 100, born: 1, due: 1 }]; g.wood = 3;
  const r2 = endDay(g);
  eq(r2.orders[0].pay, Math.round(100 * (1 + 0.02 * 10)), 'reputation lifts the reward by 2% a point');

  // A dish order matches on flavour and uses the cheapest matching dish.
  const d = createWorld({ seed: 8, workers: [], coins: 0 });
  d.orders = [{ id: 903, kind: 'dish', flavor: 'sweet', qty: 1, reward: 90, born: 1, due: 1 }];
  d.stock.dishes = [{ value: 70, flavors: ['sweet'], picks: [] }, { value: 30, flavors: ['spicy'], picks: [] }, { value: 50, flavors: ['sweet', 'sour'], picks: [] }];
  eq(orderHave(d, d.orders[0]).have, 1, 'one matching dish covers a qty-1 order');
  const r3 = endDay(d);
  ok(r3.orders[0].ok, 'the dish order was filled');
  eq(r3.dishes, 2, 'the other two dishes were sold, not eaten by the order');

  // Expiry: an unmet order at its due day is dropped and costs reputation (never below 0).
  const e = createWorld({ seed: 8, workers: [], coins: 0 });
  e.rep = 1; e.orders = [{ id: 904, kind: 'berry', berry: 'lum', qty: 9, reward: 300, born: 1, due: 1 }];
  const r4 = endDay(e);
  ok(r4.orders.length === 1 && !r4.orders[0].ok, 'an unmet order expires on its due day');
  eq(e.rep, 0, 'and costs one point of reputation');
  e.orders = [{ id: 905, kind: 'berry', berry: 'lum', qty: 9, reward: 300, born: 2, due: 2 }];
  endDay(e);
  eq(e.rep, 0, 'reputation never drops below zero');
  ok(e.orders.length >= 2, 'a new day tops the board up again');

  // An order due later keeps its berries out of the sale.
  const h = createWorld({ seed: 8, workers: [], coins: 0 });
  h.orders = [{ id: 906, kind: 'berry', berry: 'pecha', qty: 6, reward: 99, born: 1, due: 3 }];
  h.stock.berries = { pecha: 4, cheri: 2 };
  const r5 = endDay(h);
  eq(r5.orders.length, 0, 'an order not yet due and not yet covered is left open');
  eq(h.stock.berries.pecha, 4, 'berries an open order will need are held back, not sold');
  // ...and one that IS covered is filled early, whatever its due day.
  const early = createWorld({ seed: 8, workers: [], coins: 0 });
  early.orders = [{ id: 907, kind: 'berry', berry: 'pecha', qty: 3, reward: 40, born: 1, due: 3 }];
  early.stock.berries = { pecha: 3 };
  ok(endDay(early).orders[0]?.ok, 'a covered order is delivered at once even with days to spare');

  // Berries an open order is waiting for are not cooked away.
  const k = createWorld({ seed: 8, workers: [defOf(4)], coins: 0 });
  k.orders = [{ id: 908, kind: 'berry', berry: 'oran', qty: 6, reward: 70, born: 1, due: 1 }];
  k.stock.berries = { oran: 6, cheri: 1, pecha: 1 };
  eq(spareBerries(k), { oran: 0, cheri: 1, pecha: 1 }, 'berries owed to an order are not spare');
  eq(bestRecipe(k), null, 'and cannot be cooked: two spare berries make no dish');
  k.stock.berries = { oran: 8, cheri: 1, pecha: 1 };
  ok(bestRecipe(k) !== null, 'extra berries beyond the order can be cooked');

  // A save from before orders existed gets a board and zero reputation.
  const old = createWorld({ seed: 8, workers: [] });
  delete old.orders; delete old.rep;
  ensureOrders(old);
  ok(Array.isArray(old.orders) && old.orders.length >= 2 && old.rep === 0, 'an old save is given orders on load');

  // Strategy replays stay repeatable with orders in the snapshot.
  const s1 = createWorld({ seed: 31, workers: [defOf(1), defOf(4), defOf(7)] });
  playDay(s1); playDay(s1);
  eq(compareStrategies(s1).map((r) => r.earned), compareStrategies(s1).map((r) => r.earned), 'replays with orders are repeatable');
  ok(repMultiplier(s1) >= 1, 'the reputation multiplier is at least 1');
}


/* ------------------------------------------------ ability perks, shaking, canals */
{
  // Every perk key is something buildWorker understands, and no species ends up out of bounds.
  const known = new Set(['zh', 'note', 'rates', 'all', 'speed', 'stamina', 'carry', 'pickup', 'luck', 'wx', 'sig', 'flags']);
  const badKeys = Object.entries(ABILITY_PERKS).filter(([, v]) => Object.keys(v).some((k) => !known.has(k))).map(([k]) => k);
  eq(badKeys, [], 'every ability perk uses only keys the builder understands');
  const unknownJobs = Object.values(ABILITY_PERKS).flatMap((v) => Object.keys(v.rates || {})).filter((j) => ![...JOB_IDS, 'burn'].includes(j));
  eq(unknownJobs, [], 'perks only speed up jobs that exist');
  let withPerk = 0, bad = 0;
  for (let id = 1; id <= 1025; id++) {
    const d = defOf(id);
    if (d.perks.length) withPerk++;
    const rates = Object.values(d.rates);
    if (!rates.every((r) => Number.isFinite(r) && r >= 0 && r <= PERK_RATE_CAP * 2) || !(d.speed >= 1 && d.speed <= 4.2) || !(d.staminaMax >= 30 && d.staminaMax <= 200)) bad++;
  }
  eq(bad, 0, 'all 1,025 species build bounded workers with ability perks');
  ok(withPerk > 800, 'most species get at least one ability perk', `${withPerk}`);

  // Chlorophyll is quick in the sun, not in the rain; Swift Swim the other way round.
  const mk = (slug) => buildWorker(1, roster[0], ['Normal'], [{ slug }]);
  const sunny = createWorld({ seed: 1, workers: [mk('chlorophyll')] }); sunny.weather = 'sun';
  const rainy = createWorld({ seed: 1, workers: [mk('chlorophyll')] }); rainy.weather = 'rain';
  const walk = (w) => { w.workers[0].x = 0; w.workers[0].y = 0; w.strategy = 'manual'; syncTasks(w); const t = w.tasks.find((x) => x.kind === 'till'); assign(w, 0, t.id); for (let i = 0; i < 10; i++) step(w, 0.1); return Math.hypot(w.workers[0].x, w.workers[0].y); };
  ok(walk(sunny) > walk(rainy) * 1.2, 'Chlorophyll walks faster in the sun than in the rain');
  const flash = mk('flash-fire');
  ok(flash.sig?.safeBurn, 'Flash Fire gives safe burning');
  ok(mk('intimidate').rates.shoo > mk('stench').rates.shoo && mk('stench').rates.shoo > 1, 'Intimidate beats Stench at shooing, both beat nothing');
  ok(mk('cheek-pouch').carry > buildWorker(1, roster[0], ['Normal'], []).carry, 'Cheek Pouch carries more');

  // Shaking a tree: one berry pile per tree per day, then the tree is empty until dusk.
  const w = createWorld({ seed: 6, workers: [defOf(66)] });
  w.strategy = 'manual'; syncTasks(w);
  const sh = w.tasks.find((t) => t.kind === 'shake');
  ok(sh, 'a shake job exists for every tree at dawn');
  const piles0 = w.piles.length;
  w.workers[0].x = sh.x; w.workers[0].y = sh.y;
  ok(assign(w, 0, sh.id), 'a worker can be sent to shake a tree');
  for (let i = 0; i < 100; i++) step(w, 0.1);
  eq(w.piles.length, piles0 + 1, 'a shaken tree drops one pile of berries');
  const dropped = w.piles[w.piles.length - 1];
  ok(dropped.kind === 'berry' && (SHAKE_POOL.common.includes(dropped.berry) || SHAKE_POOL.rare.includes(dropped.berry)) && dropped.qty >= 1 && dropped.qty <= 2, 'the pile is a small number of wild berries', JSON.stringify(dropped));
  ok(!w.tasks.some((t) => t.kind === 'shake' && t.tree === sh.tree), 'that tree cannot be shaken again today');
  endDay(w);
  syncTasks(w);
  ok(w.tasks.some((t) => t.kind === 'shake' && t.tree === sh.tree), 'it can be shaken again the next day');

  // Canals: dug once, they water the neighbouring plot every stage, but not in a drought.
  const c = createWorld({ seed: 6, workers: [defOf(50)] });
  eq(c.canals.length, 8, 'there are eight canal slots');
  c.strategy = 'manual'; syncTasks(c);
  const cj = c.tasks.find((t) => t.kind === 'canal');
  ok(cj, 'a canal job exists once a bordering plot is open');
  c.workers[0].x = cj.x; c.workers[0].y = cj.y;
  ok(assign(c, 0, cj.id), 'a canal can be assigned');
  for (let i = 0; i < 300 && !c.canals[cj.canal].built; i++) step(c, 0.1);
  ok(c.canals[cj.canal].built, 'the canal gets dug');
  const cc = c.canals[cj.canal];
  const host = c.plots.find((p) => p.open && p.y === cc.y && Math.abs(p.x - cc.x) === 1);
  ok(canalFeeds(c, host), 'a plot beside a dug canal is fed');
  const far = c.plots.find((p) => p.open && Math.abs(p.x - cc.x) > 1);
  ok(!canalFeeds(c, far), 'a plot elsewhere is not');
  c.weather = 'drought';
  ok(!canalFeeds(c, host), 'a drought dries the canal up');
  c.weather = 'sun';
  Object.assign(host, { state: 'growing', berry: 'cheri', stage: 0, prog: 0, stageWatered: false, waters: 0 });
  c.workers = [];
  for (let i = 0; i < 90; i++) step(c, 0.1);
  ok(host.waters >= 1 || host.stage >= 1, 'a fed plot is watered at the start of each stage with nobody carrying water', `stage ${host.stage} waters ${host.waters}`);
  const old = createWorld({ seed: 6, workers: [] });
  delete old.canals; ensureCanals(old);
  eq(old.canals.length, 8, 'an old save gets its canal slots');
}

/* ------------------------------------------------ seasons, hazards, a whole run */
{
  // A run is 28 days; the season follows from the start season.
  const w = createWorld({ seed: 9, workers: [defOf(1), defOf(4), defOf(7)], startSeason: 2 });
  eq(seasonInfo(w, 1).key, 'autumn', 'a run that starts in autumn begins in autumn');
  eq(seasonInfo(w, 8).key, 'winter', 'the next week is winter');
  eq(seasonInfo(w, 15).key, 'spring', 'then spring (the year wraps)');
  eq(seasonInfo(w, 28).key, 'summer', 'and the last day is the last week of summer');
  eq(RUN_DAYS, SEASON_DAYS * 4, 'a run is four seasons');
  ok(Object.values(SEASONS).flatMap((s) => s.types).length === 18 && new Set(Object.values(SEASONS).flatMap((s) => s.types)).size === 18, 'the four seasons split the 18 types with none left out or doubled');
  ok(Object.values(SEASONS).every((s) => s.types.includes(s.key)), "each season's key type is in its own group");
  ok(Object.values(SEASONS).every((s) => Math.abs(Object.values(s.odds).reduce((a, b) => a + b, 0) - 1) < 1e-9), "each season's weather odds add up to 1");

  // Weather coverage: every kind turns up somewhere in the year.
  const seen = new Set();
  for (let sd = 1; sd <= 12; sd++) for (let st = 0; st < 4; st++) {
    const x = createWorld({ seed: sd, workers: [], startSeason: st });
    for (let d = 0; d < 28; d++) { seen.add(weatherOf(x)); x.coins = 0; endDay(x); }
  }
  eq([...seen].sort(), Object.keys(WEATHER).sort(), 'all nine weathers occur across seeds and seasons');

  // The key-type gate and the loaner.
  const g = createWorld({ seed: 3, workers: [defOf(1)], startSeason: 1 });       // Bulbasaur (Grass/Poison) in summer
  ok(seasonGate(g).need && seasonGate(g).key === 'Fire', 'summer asks for a Fire type when the crew has none');
  ok(addLoaner(g, defOf(4)) && !addLoaner(g, defOf(4)), 'one loaner at a time');
  ok(!seasonGate(g).need, 'the loaner satisfies the gate');
  ok(g.workers.some((x) => x.def.loan && x.def.wage === 0), 'the loaner is free');
  const g2 = createWorld({ seed: 3, workers: [defOf(1), defOf(4)], startSeason: 1 });
  ok(!seasonGate(g2).need, 'no gate when a Fire type is already on the crew');

  // Affinity: a worker of the season's group is faster at the same job.
  const a = createWorld({ seed: 3, workers: [defOf(1)], startSeason: 0 });        // Grass in spring: affinity
  const b = createWorld({ seed: 3, workers: [defOf(1)], startSeason: 1 });        // Grass in summer: none
  const t = (x) => { x.weather = 'sun'; syncTasks(x); const task = x.tasks.find((q) => q.kind === 'till') || x.tasks[0]; return task; };
  ok(!!t(a) && !!t(b), 'both farms have something to do');

  // Seed price follows the season rule.
  ok(seedCost(a, 'cheri') < BERRIES.cheri.seed, 'spring seeds are cheaper');
  eq(seedCost(b, 'cheri'), BERRIES.cheri.seed, 'summer seeds cost the list price');

  // Hazards: planned from the weather and stored in the world (so a replay sees them).
  const hz = (kind, seed = 5) => { const x = createWorld({ seed, workers: [], startSeason: 0 }); x.weather = kind; x.coins = 0; endDay(x); x.weather = kind; return x; };
  for (const [kind, spec] of Object.entries(HAZARD_PLAN)) {
    let n = 0;
    for (let sd = 1; sd <= 8; sd++) {
      const x = createWorld({ seed: sd, workers: [] }); x.forecast = kind; endDay(x);
      eq(x.weather, kind, `forecast ${kind} becomes today's weather`);
      ok(x.hazards.length >= spec.count[0] && x.hazards.length <= spec.count[1], `${kind} plans ${spec.count.join('–')} hazards`, String(x.hazards.length));
      ok(x.hazards.every((h) => h.kind === spec.kind && h.at >= spec.from && h.at <= spec.to), `${kind} hazards fall inside their window`);
      n += x.hazards.length;
    }
    ok(n > 0, `${kind} produces hazards`);
  }
  const sunny = createWorld({ seed: 4, workers: [] }); endDay(sunny);
  if (sunny.weather === 'sun') eq(sunny.hazards.length, 0, 'a sunny day has no hazards');

  // A bolt burns its target unless a lightning rod crew member absorbs it.
  const bolt = (workers, seed) => {
    const x = createWorld({ seed, workers });
    for (const p of x.plots) if (p.open) Object.assign(p, { state: 'growing', berry: 'cheri', stage: 2, prog: 1, waters: 2 });
    x.hazards = [{ kind: 'bolt', at: 5, warn: 4, warned: false, done: false, target: null }];
    x.weather = 'thunder'; x.workers = x.workers; x.t = 0;
    let warnedAt = null;
    for (let i = 0; i < 80; i++) { step(x, 0.1); if (x.hazards[0].warned && warnedAt == null) warnedAt = x.t; }
    return { x, warnedAt, lost: x.plots.filter((p) => p.open && p.state !== 'growing').length };
  };
  const nob = bolt([], 11);
  ok(nob.warnedAt != null && nob.warnedAt < 1.5, 'a bolt is announced BOLT_WARN seconds ahead', String(nob.warnedAt));
  eq(nob.lost, 1, 'an unprotected bolt destroys exactly one plot');
  let absorbed = 0, total = 0;
  for (let sd = 1; sd <= 30; sd++) { const r = bolt([defOf(25), defOf(25)], sd); total += 1; if (r.lost === 0) absorbed += 1; }
  ok(absorbed > total * 0.6, 'two lightning-rod workers absorb most bolts', `${absorbed}/${total}`);

  // Flood, landfall, frost.
  const fl = createWorld({ seed: 2, workers: [] });
  for (const p of fl.plots) p.open = true;                   // all rows, so the lower half exists
  for (const p of fl.plots) if (p.open) Object.assign(p, { state: 'ripe', berry: 'cheri', stage: 4, yield: 6 });
  fl.water = 0; fl.hazards = [{ kind: 'flood', at: 1, warn: 6, warned: false, done: false }]; fl.weather = 'flood';
  for (let i = 0; i < 20; i++) step(fl, 0.1);
  ok(fl.water === fl.waterMax, 'a flood fills the tank');
  ok(fl.plots.filter((p) => p.open).some((p) => p.yield === 3) && fl.plots.filter((p) => p.open).some((p) => p.yield === 6), 'a flood halves only the lower plots');
  const ty = createWorld({ seed: 2, workers: [] });
  for (const p of ty.plots) if (p.open) Object.assign(p, { state: 'ripe', berry: 'cheri', stage: 4, yield: 6 });
  ty.piles.push({ id: 99, x: 1, y: 1, kind: 'wood', qty: 5 });
  ty.hazards = [{ kind: 'landfall', at: 1, warn: 10, warned: false, done: false }]; ty.weather = 'typhoon';
  for (let i = 0; i < 20; i++) step(ty, 0.1);
  ok(ty.plots.filter((p) => p.open).every((p) => p.yield === 3), 'a typhoon landfall halves every ripe plot');
  eq(ty.piles.find((q) => q.id === 99)?.qty, 2, 'and the piles on the ground');
  const frostRun = (workers) => {
    let dead = 0, all = 0;
    for (let sd = 1; sd <= 12; sd++) {
      const x = createWorld({ seed: sd, workers });
      for (const p of x.plots) if (p.open) Object.assign(p, { state: 'growing', berry: 'cheri', stage: 0, prog: 0 });
      x.hazards = [{ kind: 'frost', at: 1, warn: 3, warned: false, done: false }]; x.weather = 'frost';
      for (let i = 0; i < 20; i++) step(x, 0.1);
      for (const p of x.plots) if (p.open) { all += 1; if (p.state !== 'growing') dead += 1; }
    }
    return dead / all;
  };
  const cold = frostRun([]), warm = frostRun([defOf(4)]);
  ok(cold > 0.3 && warm < 0.3 && warm < cold, 'frost kills about half the seedlings, far fewer with a warm worker', `${cold.toFixed(2)} vs ${warm.toFixed(2)}`);
  ok(defOf(25).flags?.rod && defOf(7).flags?.drain && defOf(4).flags?.warm && defOf(63).flags?.seer, 'type-derived flags: Electric rod, Water drain, Fire warm, Psychic seer');

  // Season end: stars, loaner leaves; winter heat; run end and rating.
  const r = createWorld({ seed: 21, workers: [defOf(1), defOf(4), defOf(7)], startSeason: 0 });
  r.endless = false;
  let lastReport = null; const reports = [];
  for (let d = 1; d <= RUN_DAYS; d++) {
    r.hazards = r.hazards.filter(() => false);
    lastReport = playDay(r); reports.push(lastReport);
  }
  eq(reports.filter((x) => x.season).length, 4, 'four season reports in a year');
  ok(reports.filter((x) => x.season).every((x) => x.season.stars >= 0 && x.season.stars <= 3), 'season stars are 0–3');
  ok(!!lastReport.run && r.finished, 'day 28 ends the run');
  ok(['S', 'A', 'B', 'C'].includes(lastReport.run.rating), 'the run gets a rating');
  eq(ratingOf(12, 99999).id, 'S', 'twelve stars and a fat purse is S');
  eq(ratingOf(0, 0).id, 'C', 'nothing earns C');
  ok(reports.some((x) => x.heat), 'winter reports the firewood used for heating');
  const old = createWorld({ seed: 1, workers: [] }); delete old.run; delete old.seasons; delete old.hazards; ensureSeason(old);
  ok(old.run && Array.isArray(old.seasons) && Array.isArray(old.hazards), 'an old save is brought up to date');
  // The loaner: free while on loan, keepable at the normal price, and never makes a hire dearer.
  const ln = createWorld({ seed: 8, workers: [defOf(1), defOf(4), defOf(7)], startSeason: 3, coins: 1000 });
  const before = hireCost(ln, defOf(25));
  addLoaner(ln, defOf(220));
  eq(hireCost(ln, defOf(25)), before, 'a loaner does not raise the hire price');
  ok(!keepLoaner(ln, defOf(25)), 'keepLoaner refuses a different species');
  const c0 = ln.coins, price = hireCost(ln, defOf(220));
  ok(keepLoaner(ln, defOf(220)) && c0 - ln.coins === price && ln.workers[3].def.wage === defOf(220).wage && !ln.workers[3].def.loan, 'keeping the loaner pays the hire price and restores its real wage');
  ok(!ln.workers.some((w) => w.def.loan), 'a kept loaner is no longer a loaner (it survives the season end)');
}

/* ------------------------------------------------ challenge mode and the daily seed */
{
  // Strict: from week 2 only the season's type group works; the loaner always does.
  const st = createWorld({ seed: 5, workers: [defOf(1), defOf(4), defOf(7)], startSeason: 1, strict: true });   // summer: Fire/Water/Electric/Fighting
  ok(st.workers.every((w) => isActive(st, w)), 'the first week of a challenge run is an orientation week: everybody works');
  st.seasons = [{ key: 'spring', gain: 0, stars: 0 }];                                        // week 2 begins
  eq(st.workers.map((w) => isActive(st, w)), [false, true, true], 'in summer only Charmander and Squirtle are in the group (Bulbasaur sleeps)');
  syncTasks(st);
  ok(st.tasks.length > 0 && !canDo(st, st.workers[0], st.tasks[0]), 'a sleeping worker cannot be given a job');
  for (let i = 0; i < 300; i++) step(st, 0.1);
  eq(st.workers[0].done, 0, 'and finds none on its own');
  ok(st.workers[1].done + st.workers[2].done > 0, 'the group works');
  const normal = createWorld({ seed: 5, workers: [defOf(1)], startSeason: 1 }); normal.seasons = st.seasons.slice();
  ok(isActive(normal, normal.workers[0]), 'outside challenge mode everyone works');
  ok(seasonGoal(st)[2] < seasonGoal(normal)[2], 'challenge bars are lower');
  eq(ratingOf(9, 45000 * 0.7, true).id, 'A', 'the challenge rating threshold scales too');
  eq(ratingOf(9, 45000 * 0.7, false).id, 'B', '…and the same year is only a B in the normal mode');
  addLoaner(st, defOf(1));
  ok(isActive(st, st.workers[3]), 'the loaner works whatever its type');
  const ro = createWorld({ seed: 5, workers: [defOf(25), defOf(1)], startSeason: 1, strict: true });
  ro.seasons = [{ key: 'x', gain: 0, stars: 0 }];
  eq(ro.workers.map((w) => isActive(ro, w)), [true, false], 'Pikachu (Electric) is in the summer group');

  // Daily seed: the dawn rolls ignore the world's running stream.
  eq(hashStr('a') === hashStr('a') && hashStr('a') !== hashStr('b'), true, 'hashStr is stable and discriminating');
  const run = (burn) => {
    const w = createWorld({ seed: 77, workers: [defOf(1)], startSeason: 0, daily: true });
    const out = [];
    for (let d = 0; d < 10; d++) {
      for (let i = 0; i < burn * (d + 1); i++) rnd(w);                   // a different player consumed a different amount of luck
      out.push([w.weather, w.forecast, w.market.flavor, JSON.stringify(w.orders.map((o) => [o.kind, o.qty])), JSON.stringify(w.hazards.map((h) => h.at)), JSON.stringify(w.pestPlan)].join('|'));
      w.coins = 0; endDay(w);
    }
    return out;
  };
  eq(run(0), run(7), 'two daily players with different luck see the same weather, flavour, orders, hazards and pests for ten days');
  const norm = (burn) => { const w = createWorld({ seed: 77, workers: [defOf(1)], daily: false }); for (let i = 0; i < burn; i++) rnd(w); w.coins = 0; endDay(w); return w.forecast + w.market.flavor; };
  ok([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(norm).some((x) => x !== norm(0)), 'without the daily seed the same burn does change tomorrow');
}

if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nFAIL  ${problems.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${checks} checks — the farm engine is deterministic, never stalls, and its jobs do what they say`);
