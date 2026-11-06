/**
 * pokefarm-data.js — the numbers behind PokéFarm
 * ===============================================
 * Everything here is DATA or a pure function of data: no DOM, no clock, no
 * Math.random, so the engine that imports it can run under bare Node (the
 * checker and the end-of-day strategy replay both rely on that).
 *
 * THESE ARE GAME-BALANCE NUMBERS, NOT OFFICIAL ONES. Berry flavours are
 * simplified (the games give each berry a 0–40 potency in five flavours; here a
 * berry has one or two flavours), and every type multiplier is this project's
 * own. The tuning table is meant to be edited: `docs/pokefarm-design.md` §6 is
 * the human-readable twin of `TYPE_APTITUDE` below.
 *
 * TIME UNITS: everything is in "day seconds". One day is DAY_SECONDS long at 1×
 * speed; crops keep growing at night by NIGHT_GROWTH seconds.
 */

export const DAY_SECONDS = 120;
export const NIGHT_GROWTH = 30;
export const STEP = 0.1;                 // fixed simulation step, seconds
export const SAVE_KEY = 'pokemon-algorithm:farm:v1';

/** Tile grid. Tiles are 16 art-pixels; the page scales them. */
export const GRID = { w: 14, h: 9 };

/** 4×4 field in the middle; the first FIELD_START plots are open at the start. */
export const FIELD = { x0: 5, y0: 2, cols: 4, rows: 4 };
export const FIELD_START = 8;

export const WELL = { x: 2, y: 2 };
export const KITCHEN = { x: 11, y: 2 };
export const WAREHOUSE = { x: 11, y: 5 };
/** Trees (wood). They grow back after TREE_REGROW seconds. */
export const TREES = [
  { x: 1, y: 6 }, { x: 3, y: 7 }, { x: 12, y: 7 }, { x: 0, y: 0 }, { x: 13, y: 0 },
];
export const TREE_WOOD = 3;
export const TREE_REGROW = 70;

/** Water tank. */
export const TANK = { max: 24, start: 16, perDraw: 8 };

/** Seconds a ripe plot can wait before the berries rot. */
export const RIPE_ROT = 45;
/** Chance per second that a worked plot sprouts weeds. */
export const WEED_RATE = 0.012;
/** Chance an UNWATERED growing neighbour is scorched when a plot is burned. */
export const FIRE_SPREAD = 0.3;
/** One extra berry from a burned plot's ash, once. */
export const ASH_BONUS = 1;

export const FLAVORS = ['spicy', 'dry', 'sweet', 'bitter', 'sour'];
export const FLAVOR_ZH = { spicy: '辣', dry: '乾', sweet: '甜', bitter: '苦', sour: '酸' };

/**
 * Berries. `stage` = seconds per growth stage (four stages, then ripe), `min`/`max`
 * = yield with 0 / 4 waterings, `price` = coins per berry, `seed` = seed cost.
 * Names are the official Traditional Chinese names; the first five are the five
 * flavour berries of Gen III.
 */
export const BERRIES = {
  cheri:  { en: 'Cheri',  zh: '櫻子果', flavors: ['spicy'],           stage: 6, min: 2, max: 4, price: 8,  seed: 3 },
  chesto: { en: 'Chesto', zh: '零餘果', flavors: ['dry'],             stage: 7, min: 2, max: 4, price: 9,  seed: 4 },
  pecha:  { en: 'Pecha',  zh: '桃桃果', flavors: ['sweet'],           stage: 7, min: 2, max: 4, price: 10, seed: 4 },
  rawst:  { en: 'Rawst',  zh: '莓莓果', flavors: ['bitter'],          stage: 8, min: 2, max: 4, price: 10, seed: 4 },
  aspear: { en: 'Aspear', zh: '利木果', flavors: ['sour'],            stage: 8, min: 2, max: 4, price: 11, seed: 5 },
  oran:   { en: 'Oran',   zh: '橙橙果', flavors: ['sweet', 'bitter'], stage: 5, min: 2, max: 3, price: 6,  seed: 3 },
  persim: { en: 'Persim', zh: '柿仔果', flavors: ['spicy', 'sour'],   stage: 9, min: 2, max: 4, price: 14, seed: 6 },
  lum:    { en: 'Lum',    zh: '木子果', flavors: ['dry', 'bitter'],   stage: 13, min: 1, max: 3, price: 20, seed: 8 },
  sitrus: { en: 'Sitrus', zh: '文柚果', flavors: ['sweet', 'sour'],   stage: 15, min: 1, max: 3, price: 24, seed: 10 },
};
export const BERRY_IDS = Object.keys(BERRIES);

/**
 * WEATHER AND PESTS. One weather per day, rolled with the world's own RNG at
 * dusk (so a cloned morning snapshot carries it and every strategy replay sees
 * the same sky). `odds` sum to 1.
 *   rain     stages water themselves, but weeds grow 1.5x as fast
 *   drought  the tank starts the day half empty and each draw brings half
 *   wind     berries rot 30% sooner and fire spreads twice as often
 * Pests (a bug in the beans) start on day 3: each day has a chance of one or two
 * visits at random times; a visited growing/ripe plot loses its progress or two
 * berries unless somebody shoos the pest within PEST_TIME seconds.
 */
export const WEATHER = {
  sun:     { zh: '晴天', icon: '☀️' },
  rain:    { zh: '下雨', icon: '🌧️' },
  drought: { zh: '乾旱', icon: '🏜️' },
  wind:    { zh: '強風', icon: '🍃' },
  thunder: { zh: '打雷', icon: '⛈️' },
  flood:   { zh: '暴雨', icon: '🌊' },
  typhoon: { zh: '颱風', icon: '🌀' },
  frost:   { zh: '霜凍', icon: '🥶' },
  snow:    { zh: '下雪', icon: '❄️' },
};
export const WEATHER_NOTE = {
  sun: '一般的一天。',
  rain: '作物自己吸水，不用澆；雜草長得比較快。',
  drought: '水槽一早只剩一半，提水一次也只補一半，渠道乾涸。',
  wind: '熟透的樹果更快掉落，放火更容易延燒。',
  thunder: '會下雨（自動澆水），但有 2–3 道落雷會劈中田地；電系、地面系或避雷針類特性的工人能把雷引走。',
  flood: '下雨加積水：田地下半部會被淹，旁邊有渠道的田不受影響，水系、排水類特性有機會救回來。',
  typhoon: '強風加豪雨，約 55–70 秒颱風登陸，地裡成熟的樹果會被吹掉一半、地上的堆也會損失；有預報就提早收。',
  frost: '作物長得慢（60%），一大早剛播下的幼苗可能凍死；隊上有火系或暖身特性的工人能保住大多數。',
  snow: '雪水自動澆田，但作物長得慢（75%）、走路變慢；冰系與雪天特性的工人如魚得水。',
};
/** Weather that wets the plots by itself (no watering needed), and that blows. */
export const WET_WEATHER = new Set(['rain', 'thunder', 'flood', 'typhoon', 'snow']);
export const WINDY_WEATHER = new Set(['wind', 'typhoon']);
/** The weather a perk's `wx` is looked up under, besides the weather's own name. */
export const WX_ALIAS = { thunder: ['rain'], flood: ['rain'], typhoon: ['wind', 'rain'], frost: ['snow'] };

/**
 * HAZARDS (rolled at dawn from the weather; see engine). Seconds into the day.
 * The player always gets a BOLT_WARN-second warning on the board; a crew member
 * with the `seer` flag (Psychic, Forewarn, Anticipation) sees the whole schedule.
 */
export const BOLT_WARN = 4;
export const HAZARD_PLAN = {
  thunder: { kind: 'bolt',  count: [2, 3], from: 12, to: 100 },
  flood:   { kind: 'flood', count: [1, 2], from: 25, to: 90 },
  typhoon: { kind: 'landfall', count: [1, 1], from: 55, to: 70 },
  frost:   { kind: 'frost', count: [1, 1], from: 10, to: 14 },
};
export const LOCUST_FROM_DAY = 5;
export const LOCUST_CHANCE = 0.1;

/**
 * SEASONS. A run is RUN_DAYS days: four seasons of SEASON_DAYS, in the natural
 * order from whichever one you start in. Each season
 *   - groups some of the 18 types (`types`): those workers work 15% faster;
 *   - needs a `key` type on the crew before it can begin (a free loaner `loan` is
 *     lent for the season if you have none);
 *   - has its own weather `odds` and one rule (`mods`);
 *   - is rated 0-3 stars by its revenue against SEASON_GOAL (see below).
 */
export const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_DAYS = 7;
export const RUN_DAYS = SEASON_DAYS * 4;
export const SEASON_AFFINITY = 1.15;
export const SEASONS = {
  spring: {
    zh: '春', icon: '🌸', types: ['Grass', 'Bug', 'Fairy', 'Normal', 'Flying'], key: 'Grass', keyZh: '草系', loan: 43,
    rule: '春耕：種子便宜 25%、作物長得快 10%，但雜草多 40%。',
    mods: { seedCost: 0.75, growth: 1.1, weed: 1.4 },
    odds: { sun: 0.38, rain: 0.30, wind: 0.12, thunder: 0.10, flood: 0.10 },
  },
  summer: {
    zh: '夏', icon: '☀️', types: ['Fire', 'Water', 'Electric', 'Fighting'], key: 'Fire', keyZh: '火系', loan: 37,
    rule: '炎夏：熟果更快爛（時間 ×0.8）、夜裡水槽不會補水；乾旱、落雷、颱風都在這一季。',
    mods: { rot: 0.8, refill: 0 },
    odds: { sun: 0.34, drought: 0.22, thunder: 0.14, typhoon: 0.12, rain: 0.10, wind: 0.08 },
  },
  autumn: {
    zh: '秋', icon: '🍂', types: ['Rock', 'Ground', 'Poison', 'Dark', 'Ghost'], key: 'Rock', keyZh: '岩石系', loan: 74,
    rule: '秋收：樹果賣價 +20%、訂單獎勵 +15%；風大，偶爾颱風。',
    mods: { berryPrice: 1.2, orderReward: 1.15 },
    odds: { sun: 0.34, wind: 0.26, rain: 0.16, typhoon: 0.10, thunder: 0.06, frost: 0.08 },
  },
  winter: {
    zh: '冬', icon: '❄️', types: ['Ice', 'Steel', 'Psychic', 'Dragon'], key: 'Ice', keyZh: '冰系', loan: 220,
    rule: '寒冬：作物長得慢 20%、料理價值 +20%；日終要燒木材取暖（沒柴，隔天體力少 15%）。',
    mods: { growth: 0.8, dishValue: 1.2, heat: true },
    odds: { snow: 0.27, frost: 0.25, sun: 0.28, wind: 0.12, thunder: 0.08 },
  },
};
/**
 * Season stars are earned on REVENUE (coins sold in the season, upkeep not
 * deducted, so buying growth is never punished). The three bars are SEASON_GOAL
 * × the scale of that week of the run: the farm is meant to be bigger each week.
 * (Measured with a naive bot: a lazy fifo crew earns about 4–11k a week, a
 * greedy crew that keeps hiring and upgrading 7–23k.)
 */
export const SEASON_GOAL = [3500, 6500, 10000];
export const WEEK_SCALE = [1, 1.6, 2, 2.2];
/** Run rating from total stars (max 12) and total revenue over the year. */
export const RATINGS = [
  { id: 'S', zh: '傳說農場主', stars: 11, worth: 60000 },
  { id: 'A', zh: '名人農場主', stars: 9, worth: 45000 },
  { id: 'B', zh: '勤奮農場主', stars: 6, worth: 28000 },
  { id: 'C', zh: '新手農場主', stars: 0, worth: 0 },
];
/** Challenge mode (only the season's type group works) earns on a smaller economy, so its bars are this fraction. */
export const STRICT_SCALE = 0.7;
export const DAILY_KEY = 'pokemon-algorithm:farm:daily';
export const BEST_KEY = 'pokemon-algorithm:farm:best';
/** Wild berries a shaken tree drops: cheap ones mostly, 12% of the time a good one. */
export const SHAKE_POOL = { common: ['cheri', 'chesto', 'pecha', 'rawst', 'aspear', 'oran'], rare: ['persim', 'lum', 'sitrus'] };
export const FIELD_CANALS = 8;
export const PEST_FROM_DAY = 3;
export const PEST_CHANCE = 0.4;
export const PEST_TIME = 22;
export const PEST_BITE = 2;

/**
 * ORDERS. Customers ask for something by a due DAY: berries of one kind, a dish
 * with a given flavour, or wood. They are rolled each morning with the world's
 * RNG (so a snapshot carries them), filled automatically at dusk from the stock
 * (earliest due first), and an unfilled one at its due day expires. Filling one
 * earns `reward` x (1 + REP_BONUS per reputation point, up to REP_CAP) and a point
 * of reputation; expiring costs a point. Reputation also grows how many orders
 * are open at once and how big they are. Shorter notice pays more (RUSH).
 */
export const ORDER_MAX_OPEN = 4;
export const REP_BONUS = 0.02, REP_CAP = 15;
export const RUSH = { 1: 1.9, 2: 1.7, 3: 1.55 };

/**
 * SINKS AND PRESSURE (added after a 16-day simulation showed coins piling up to
 * 23,000 with nothing left to buy by day 6).
 *  - upkeep: every worker costs wage / UPKEEP_DIV coins at dusk.
 *  - saturation: the first SALE_FREE_* units of one kind sell at full price, each
 *    one after that at `decay` of the one before. Berries are priced per kind
 *    (so rotating what you sow pays), dishes per dish (so cooking beats dumping).
 *  - upgrades: permanent, cost = base * mult^level.
 *  - hiring gets dearer with every extra hand beyond the starter three.
 */
export const UPKEEP_DIV = 14;
export const SALE_FREE_BERRY = 10, SALE_DECAY_BERRY = 0.95;
export const SALE_FREE_DISH = 4, SALE_DECAY_DISH = 0.93;
export const UPGRADES = {
  tools:   { zh: '工具', desc: '所有工作快 8% / 級',          max: 12, base: 200, mult: 1.6 },
  kitchen: { zh: '廚房', desc: '料理倍率 +0.15 / 級',        max: 8, base: 250, mult: 1.7 },
  cart:    { zh: '推車', desc: '每人一次多搬 1 / 級',         max: 3, base: 300, mult: 2.2 },
};
export const HIRE_STEP = 0.15;     // +15% wage per worker beyond the third

/** Dish value = sum of berry prices × this, where variety = distinct flavours. */
export function dishMultiplier(variety) { return 1.6 + 0.4 * (Math.max(1, variety) - 1); }
export const MARKET_BONUS = 1.5;

/**
 * Jobs. `time` is the base seconds of WORK at efficiency 1 (walking is extra);
 * `cost` is stamina per second of work.
 */
export const JOBS = {
  clear:      { zh: '清理',   time: 3,  cost: 0.6 },
  weed:       { zh: '除草',   time: 2.5, cost: 0.5 },
  till:       { zh: '翻土',   time: 3,  cost: 0.8 },
  sow:        { zh: '播種',   time: 2,  cost: 0.4 },
  water:      { zh: '澆水',   time: 2,  cost: 0.4 },
  drawWater:  { zh: '提水',   time: 6,  cost: 0.9 },
  harvest:    { zh: '採收',   time: 3,  cost: 0.5 },
  haul:       { zh: '搬運',   time: 2,  cost: 0.7 },
  chop:       { zh: '砍材',   time: 6,  cost: 1.2 },
  cook:       { zh: '料理',   time: 12, cost: 0.5 },
  shoo:       { zh: '驅趕',   time: 2.5, cost: 0.6 },
  shake:      { zh: '搖樹',   time: 4,  cost: 0.8 },
  canal:      { zh: '挖渠道', time: 9,  cost: 1.0 },
};
export const BURN_TIME = 1.5;
export const JOB_IDS = Object.keys(JOBS);

/** Per-type multipliers on a job's work rate. `speed` multiplies walking speed;
 *  `burn` is how fast a Fire-type clears by burning (others cut). */
export const TYPE_APTITUDE = {
  Normal:   { haul: 1.2 },
  Fire:     { burn: 2.2, cook: 1.5, water: 0.6, shoo: 1.2 },
  Water:    { water: 1.8, drawWater: 1.4, canal: 1.5 },
  Electric: { drawWater: 1.7, cook: 1.3 },
  Grass:    { weed: 1.5, clear: 1.5, sow: 1.4, shake: 1.2 },
  Ice:      { harvest: 1.1 },
  Fighting: { chop: 1.8, haul: 1.5, shake: 1.6, shoo: 1.3 },
  Poison:   { weed: 1.2, sow: 1.1 },
  Ground:   { till: 2.0, canal: 2.0 },
  Flying:   { harvest: 1.4, sow: 1.2, shake: 1.3, speed: 1.25 },
  Psychic:  { haul: 1.4, cook: 1.2, shoo: 1.3 },
  Bug:      { weed: 1.3, clear: 1.2, harvest: 1.2, shoo: 0.6 },
  Rock:     { haul: 1.3, till: 1.2, canal: 1.3 },
  Ghost:    { clear: 1.3, haul: 1.2, shoo: 1.5 },
  Dragon:   { clear: 1.15, weed: 1.15, till: 1.15, sow: 1.15, water: 1.15, drawWater: 1.15, harvest: 1.15, haul: 1.15, chop: 1.15, cook: 1.15, shoo: 1.15, shake: 1.15, canal: 1.15 },
  Dark:     { harvest: 1.1, shoo: 1.7 },
  Steel:    { chop: 1.4, till: 1.3, canal: 1.2 },
  Fairy:    { sow: 1.1 },
};
/** Type-flavoured passive effects (see `Worker.passives`). */
export const TYPE_PASSIVE = { Fairy: { luck: 0.15 }, Dark: { pickup: 0.1 } };

/** Hand-written specialties, keyed by dex id. Each is a small flag object the
 *  engine understands; `label` is what the UI shows. */
export const SIGNATURES = {
  52:  { label: '拾取',   pickup: 0.2 },
  231: { label: '拾取',   pickup: 0.2 },
  417: { label: '頰囊',   carry: 1 },
  103: { label: '收獲',   regrow: 0.3 },
  357: { label: '收獲',   regrow: 0.3 },
  4:   { label: '火花',   safeBurn: true },
  155: { label: '火花',   safeBurn: true },
  7:   { label: '潑水',   splash: true },
  129: { label: '潑水',   splash: true },
  25:  { label: '充電',   drawBonus: 1.5 },
  27:  { label: '挖洞',   dig: true },
  50:  { label: '挖洞',   dig: true },
  63:  { label: '念力',   carry: 1 },
  65:  { label: '念力',   carry: 1 },
  66:  { label: '怪力',   haulBonus: 1.3, chopBonus: 1.3 },
  68:  { label: '怪力',   haulBonus: 1.3, chopBonus: 1.3 },
  84:  { label: '早起鳥', earlyBird: 1.3 },
  85:  { label: '早起鳥', earlyBird: 1.3 },
};

/**
 * ABILITY PERKS. A species' real in-game abilities (assets/data/species_abilities.json:
 * `reg` = regular slots, `hid` = hidden) become farm perks, so a Pokémon is good at
 * what its ability says it should be: Chlorophyll is quick in the sun, Intimidate
 * scares pests off, Flash Fire shrugs off its own fires, Pickup finds coins.
 *
 * buildWorker applies the FIRST regular ability and the first hidden one, when the
 * table has them. Effects (all optional):
 *   rates {job: x}  multiply a job's work rate      all x   multiply every job
 *   speed x         walking speed                   stamina x   stamina pool
 *   carry n         extra carry                     pickup p / luck p   chances
 *   wx {weather: x} work AND walk x as fast in that weather (wind stands in for sand)
 *   sig {...}       the same flags SIGNATURES uses (safeBurn, splash, dig, regrow, earlyBird)
 */
export const ABILITY_PERKS = {
  'swift-swim':   { zh: '悠游自如', note: '下雨時動作快 40%', wx: { rain: 1.4 } },
  'rain-dish':    { zh: '雨盤', note: '下雨時快 30%，澆水更快', wx: { rain: 1.3 }, rates: { water: 1.15 } },
  'hydration':    { zh: '濕潤之軀', note: '下雨時快 25%', wx: { rain: 1.25 } },
  'dry-skin':     { zh: '乾燥皮膚', note: '下雨時快 20%', wx: { rain: 1.2 }, flags: { drain: true } },
  'water-veil':   { zh: '水幕', note: '下雨時快 15%', wx: { rain: 1.15 } },
  'sap-sipper':   { zh: '食草', note: '下雨時快 15%，播種快 10%', wx: { rain: 1.15 }, rates: { sow: 1.1 } },
  'lightning-rod': { zh: '避雷針', note: '提水快 30%，下雨時快 15%', rates: { drawWater: 1.3 }, wx: { rain: 1.15 }, flags: { rod: true } },
  'storm-drain':  { zh: '引水', note: '提水快 30%，下雨時快 20%', rates: { drawWater: 1.3 }, wx: { rain: 1.2 }, flags: { drain: true } },
  'chlorophyll':  { zh: '葉綠素', note: '晴天動作快 40%', wx: { sun: 1.4 } },
  'solar-power':  { zh: '太陽之力', note: '晴天動作快 30%', wx: { sun: 1.3 } },
  'leaf-guard':   { zh: '葉子防守', note: '除草快 30%，晴天快 15%', rates: { weed: 1.3 }, wx: { sun: 1.15 } },
  'sand-rush':    { zh: '撥沙', note: '強風天動作快 40%', wx: { wind: 1.4 } },
  'sand-force':   { zh: '沙之力', note: '強風天快 35%，翻土快 15%', wx: { wind: 1.35 }, rates: { till: 1.15 } },
  'sand-veil':    { zh: '沙隱', note: '強風天快 30%', wx: { wind: 1.3 } },
  'overcoat':     { zh: '防塵', note: '強風天快 30%', wx: { wind: 1.3 } },
  'early-bird':   { zh: '早起', note: '一天最初 30 秒快 30%', sig: { earlyBird: 1.3 } },
  'run-away':     { zh: '逃跑', note: '走路快 20%', speed: 1.2 },
  'quick-feet':   { zh: '飛毛腿', note: '走路快 20%', speed: 1.2 },
  'unburden':     { zh: '輕裝', note: '走路快 20%', speed: 1.2 },
  'levitate':     { zh: '飄浮', note: '走路快 15%', speed: 1.15 },
  'limber':       { zh: '柔軟', note: '走路快 15%', speed: 1.15 },
  'prankster':    { zh: '惡作劇之心', note: '走路快 15%', speed: 1.15 },
  'weak-armor':   { zh: '碎裂鎧甲', note: '走路快 10%', speed: 1.1 },
  'rattled':      { zh: '膽怯', note: '走路快 10%', speed: 1.1 },
  'pickup':       { zh: '拾取', note: '做完工作 20% 機率撿到金幣', pickup: 0.2 },
  'honey-gather': { zh: '採蜜', note: '做完工作 15% 機率撿到金幣', pickup: 0.15 },
  'ball-fetch':   { zh: '撿球', note: '做完工作 15% 機率撿到金幣', pickup: 0.15 },
  'frisk':        { zh: '察覺', note: '做完工作 10% 機率撿到金幣', pickup: 0.1 },
  'harvest':      { zh: '收獲', note: '採收後 30% 機率再長一輪', sig: { regrow: 0.3 } },
  'cud-chew':     { zh: '反芻', note: '採收後 15% 機率再長一輪', sig: { regrow: 0.15 } },
  'ripen':        { zh: '熟成', note: '採收時 25% 機率多 1 顆', luck: 0.25 },
  'serene-grace': { zh: '天恩', note: '採收時 20% 機率多 1 顆', luck: 0.2 },
  'super-luck':   { zh: '超幸運', note: '採收時 15% 機率多 1 顆', luck: 0.15 },
  'compound-eyes': { zh: '複眼', note: '採收時 15% 機率多 1 顆', luck: 0.15 },
  'cute-charm':   { zh: '迷人之軀', note: '採收時 10% 機率多 1 顆', luck: 0.1 },
  'cheek-pouch':  { zh: '頰囊', note: '一次多搬 1', carry: 1 },
  'sticky-hold':  { zh: '黏著', note: '一次多搬 1', carry: 1 },
  'suction-cups': { zh: '吸盤', note: '一次多搬 1', carry: 1 },
  'magnet-pull':  { zh: '磁力', note: '搬運快 30%', rates: { haul: 1.3 } },
  'flash-fire':   { zh: '引火', note: '放火不會延燒隔壁的田', sig: { safeBurn: true } },
  'flame-body':   { zh: '火焰之軀', note: '放火不延燒，料理快 20%', sig: { safeBurn: true }, rates: { cook: 1.2 }, flags: { warm: true } },
  'magma-armor':  { zh: '熔岩鎧甲', note: '放火不會延燒隔壁的田', sig: { safeBurn: true }, flags: { warm: true } },
  'blaze':        { zh: '猛火', note: '放火快 20%', rates: { burn: 1.2 } },
  'torrent':      { zh: '激流', note: '澆水快 20%，提水快 15%', rates: { water: 1.2, drawWater: 1.15 } },
  'overgrow':     { zh: '茂盛', note: '清理、除草快 20%', rates: { clear: 1.2, weed: 1.2 } },
  'swarm':        { zh: '蟲之預感', note: '除草快 25%', rates: { weed: 1.25 } },
  'water-absorb': { zh: '儲水', note: '澆水時順便澆隔壁一格', sig: { splash: true }, flags: { drain: true } },
  'damp':         { zh: '潮濕身軀', note: '澆水快 15%', rates: { water: 1.15 } },
  'static':       { zh: '靜電', note: '提水快 40%', rates: { drawWater: 1.4 } },
  'volt-absorb':  { zh: '蓄電', note: '提水快 30%', rates: { drawWater: 1.3 }, flags: { rod: true } },
  'motor-drive':  { zh: '電氣引擎', note: '提水快 30%', rates: { drawWater: 1.3 }, flags: { rod: true } },
  'arena-trap':   { zh: '沙穴', note: '翻土時順便翻隔壁一格', sig: { dig: true } },
  'intimidate':   { zh: '威嚇', note: '驅趕害蟲快 60%', rates: { shoo: 1.6 } },
  'stench':       { zh: '惡臭', note: '驅趕害蟲快 40%', rates: { shoo: 1.4 } },
  'sniper':       { zh: '狙擊手', note: '驅趕害蟲快 40%', rates: { shoo: 1.4 } },
  'shadow-tag':   { zh: '踩影', note: '驅趕害蟲快 30%', rates: { shoo: 1.3 } },
  'keen-eye':     { zh: '銳利目光', note: '驅趕害蟲快 30%', rates: { shoo: 1.3 } },
  'poison-point': { zh: '毒刺', note: '驅趕害蟲快 30%', rates: { shoo: 1.3 } },
  'pressure':     { zh: '壓力', note: '驅趕害蟲快 20%', rates: { shoo: 1.2 } },
  'unnerve':      { zh: '緊張感', note: '驅趕害蟲快 20%', rates: { shoo: 1.2 } },
  'anticipation': { zh: '危險預知', note: '驅趕害蟲快 20%', rates: { shoo: 1.2 }, flags: { seer: true } },
  'forewarn':     { zh: '預知夢', note: '驅趕害蟲快 20%', rates: { shoo: 1.2 }, flags: { seer: true } },
  'illuminate':   { zh: '發光', note: '驅趕害蟲快 20%', rates: { shoo: 1.2 } },
  'effect-spore': { zh: '孢子', note: '驅趕害蟲快 20%', rates: { shoo: 1.2 } },
  'soundproof':   { zh: '隔音', note: '驅趕害蟲快 10%', rates: { shoo: 1.1 } },
  'slush-rush':   { zh: '撥雪', note: '下雪天動作快 40%', wx: { snow: 1.4 } },
  'snow-warning': { zh: '降雪', note: '下雪天動作快 20%', wx: { snow: 1.2 } },
  'thermal-exchange': { zh: '熱交換', note: '霜凍時保住幼苗', flags: { warm: true } },
  'huge-power':   { zh: '大力士', note: '所有工作快 30%', all: 1.3 },
  'pure-power':   { zh: '瑜伽之力', note: '所有工作快 30%', all: 1.3 },
  'adaptability': { zh: '適應力', note: '所有工作快 10%', all: 1.1 },
  'moxie':        { zh: '自信過度', note: '所有工作快 10%', all: 1.1 },
  'hustle':       { zh: '活力', note: '所有工作快 15%，但體力少 15%', all: 1.15, stamina: 0.85 },
  'competitive':  { zh: '不服輸', note: '所有工作快 6%', all: 1.06 },
  'telepathy':    { zh: '心靈感應', note: '所有工作快 6%', all: 1.06 },
  'synchronize':  { zh: '同步', note: '所有工作快 8%', all: 1.08 },
  'guts':         { zh: '毅力', note: '體力多 40%', stamina: 1.4 },
  'insomnia':     { zh: '不眠', note: '體力多 40%', stamina: 1.4 },
  'vital-spirit': { zh: '幹勁', note: '體力多 40%', stamina: 1.4 },
  'sturdy':       { zh: '結實', note: '體力多 30%', stamina: 1.3 },
  'regenerator':  { zh: '再生力', note: '體力多 30%', stamina: 1.3 },
  'thick-fat':    { zh: '厚脂肪', note: '體力多 25%', stamina: 1.25 },
  'natural-cure': { zh: '自然回復', note: '體力多 20%', stamina: 1.2 },
  'shed-skin':    { zh: '蛻皮', note: '體力多 20%', stamina: 1.2 },
  'shell-armor':  { zh: '甲殼護身', note: '體力多 20%', stamina: 1.2 },
  'ice-body':     { zh: '冰凍之軀', note: '體力多 20%，下雪天快 30%', stamina: 1.2, wx: { snow: 1.3 } },
  'steadfast':    { zh: '不屈之心', note: '體力多 20%', stamina: 1.2 },
  'healer':       { zh: '治癒之心', note: '體力多 20%', stamina: 1.2 },
  'multiscale':   { zh: '多重鱗片', note: '體力多 20%', stamina: 1.2 },
  'clear-body':   { zh: '恆淨之軀', note: '體力多 15%', stamina: 1.15 },
  'oblivious':    { zh: '遲鈍', note: '體力多 15%', stamina: 1.15 },
  'snow-cloak':   { zh: '雪隱', note: '體力多 15%，下雪天快 30%', stamina: 1.15, wx: { snow: 1.3 } },
  'defiant':      { zh: '不服輸', note: '體力多 15%', stamina: 1.15 },
  'unaware':      { zh: '純樸', note: '體力多 10%', stamina: 1.1 },
  'inner-focus':  { zh: '精神力', note: '採收快 25%', rates: { harvest: 1.25 } },
  'big-pecks':    { zh: '健壯胸肌', note: '採收快 20%', rates: { harvest: 1.2 } },
  'infiltrator':  { zh: '穿透', note: '採收快 15%，搬運快 10%', rates: { harvest: 1.15, haul: 1.1 } },
  'gluttony':     { zh: '貪吃鬼', note: '料理快 30%', rates: { cook: 1.3 } },
  'technician':   { zh: '技術高手', note: '播種快 30%，澆水快 15%', rates: { sow: 1.3, water: 1.15 } },
  'own-tempo':    { zh: '我行我素', note: '播種快 15%', rates: { sow: 1.15 } },
  'flower-veil':  { zh: '花幕', note: '播種快 20%', rates: { sow: 1.2 } },
  'hyper-cutter': { zh: '怪力鉗', note: '清理快 30%，除草快 20%', rates: { clear: 1.3, weed: 1.2 } },
  'grass-pelt':   { zh: '草之毛皮', note: '清理快 20%', rates: { clear: 1.2 } },
  'mold-breaker': { zh: '破格', note: '清理快 20%，翻土快 15%', rates: { clear: 1.2, till: 1.15 } },
  'sheer-force':  { zh: '強行', note: '砍材快 30%，翻土快 20%', rates: { chop: 1.3, till: 1.2 } },
  'rock-head':    { zh: '堅硬腦袋', note: '砍材快 30%', rates: { chop: 1.3 } },
  'sharpness':    { zh: '鋒銳', note: '砍材快 30%', rates: { chop: 1.3 } },
  'iron-fist':    { zh: '鐵拳', note: '砍材快 25%，搬運快 15%', rates: { chop: 1.25, haul: 1.15 } },
  'tough-claws':  { zh: '硬爪', note: '砍材快 20%', rates: { chop: 1.2 } },
  'strong-jaw':   { zh: '強壯之顎', note: '砍材快 20%', rates: { chop: 1.2 } },
  'scrappy':      { zh: '膽量', note: '砍材快 15%，搬運快 10%', rates: { chop: 1.15, haul: 1.1 } },
};
export const PERK_RATE_CAP = 3.5;

/** Starter crew: Bulbasaur, Charmander, Squirtle. */
export const STARTERS = [1, 4, 7];
export const START_COINS = 120;

/** Showdown animated sprites (network) and the local static fallback. */
export const SHOWDOWN = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown';
export const gifUrl = (id, back = false) => `${SHOWDOWN}/${back ? 'back/' : ''}${id}.gif`;
export const staticUrl = (id) => `assets/images/sprite/${id}.png`;

/* ------------------------------------------------------------ worker builder */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Derive a farmhand from public data. `row` is a home_roster.json record
 * (`stats.total`, `height_m`, `names.zh`) and `types` the species' type names.
 * Every one of the 1,025 species gets a worker; only the ones in SIGNATURES get
 * a specialty.
 */
export function buildWorker(id, row, types, abilities = []) {
  const total = row?.stats?.total ?? 400;
  const h = clamp(row?.height_m ?? 1, 0.2, 10);
  const power = 0.75 + total / 1200;                      // 318 -> 1.0, 680 -> 1.32
  let speed = clamp(2.4 - 0.35 * Math.log2(h / 0.8), 1.0, 3.2);
  const rates = {};
  for (const j of JOB_IDS) rates[j] = 1;
  rates.burn = 0;                                           // only Fire types can burn
  const passive = {};

  types.forEach((t, i) => {
    const w = i === 0 ? 1 : 0.5;                            // second type counts half
    const apt = TYPE_APTITUDE[t] || {};
    for (const [job, m] of Object.entries(apt)) {
      const eff = 1 + (m - 1) * w;
      if (job === 'speed') speed *= eff;
      else if (job === 'burn') rates.burn = Math.max(rates.burn, eff);
      else rates[job] = Math.max(rates[job], eff);
    }
    for (const [k, v] of Object.entries(TYPE_PASSIVE[t] || {})) passive[k] = Math.max(passive[k] || 0, v * w);
  });
  // A penalty (<1) is only applied from the PRIMARY type, so Fire/Water never
  // gets stuck at 0.6 because of a secondary type.
  const primary = TYPE_APTITUDE[types[0]] || {};
  for (const j of JOB_IDS) if (primary[j] != null && primary[j] < 1) rates[j] = Math.min(rates[j], primary[j]);

  for (const j of JOB_IDS) rates[j] = +(rates[j] * power).toFixed(3);
  if (rates.burn) rates.burn = +(rates.burn * power).toFixed(3);

  // Ability perks: the first regular ability and the first hidden one (if they have a perk).
  const perks = [];
  const perkSig = {};
  let staminaMul = 1, speedMul = 1, perkCarry = 0, perkLuck = 0, perkPickup = 0;
  const wx = {};
  const flags = {};
  for (const a of abilities) {
    const pk = ABILITY_PERKS[a.slug];
    if (!pk || perks.some((x) => x.slug === a.slug)) continue;
    perks.push({ slug: a.slug, zh: a.zh || pk.zh, note: pk.note, hidden: !!a.hidden });
    for (const [j, m] of Object.entries(pk.rates || {})) if (j === 'burn' ? rates.burn > 0 : true) rates[j] = +Math.min(PERK_RATE_CAP, rates[j] * m).toFixed(3);
    if (pk.all) for (const j of JOB_IDS) rates[j] = +Math.min(PERK_RATE_CAP, rates[j] * pk.all).toFixed(3);
    if (pk.speed) speedMul *= pk.speed;
    if (pk.stamina) staminaMul *= pk.stamina;
    perkCarry += pk.carry || 0;
    perkLuck = Math.max(perkLuck, pk.luck || 0);
    perkPickup = Math.max(perkPickup, pk.pickup || 0);
    Object.assign(perkSig, pk.sig || {});
    Object.assign(flags, pk.flags || {});
    for (const [w, m] of Object.entries(pk.wx || {})) wx[w] = Math.max(wx[w] || 1, m);
  }
  speed = clamp(speed * speedMul, 1.0, 4.2);
  const sig = SIGNATURES[id] || Object.keys(perkSig).length ? { ...(SIGNATURES[id] || {}), ...perkSig } : null;
  let carry = 1 + (h >= 1.5 ? 1 : 0) + (h >= 3 ? 1 : 0);
  if (types.includes('Psychic') && !sig?.carry) carry += 0; // psychic gets it via signature only
  if (sig?.carry) carry += sig.carry;
  carry += perkCarry;
  if (sig?.haulBonus) rates.haul = +(rates.haul * sig.haulBonus).toFixed(3);
  if (sig?.chopBonus) rates.chop = +(rates.chop * sig.chopBonus).toFixed(3);
  if (sig?.drawBonus) rates.drawWater = +(rates.drawWater * sig.drawBonus).toFixed(3);

  for (const j of JOB_IDS) rates[j] = Math.min(PERK_RATE_CAP, rates[j]);      // however many bonuses stack
  if (rates.burn) rates.burn = Math.min(PERK_RATE_CAP, rates.burn);

  return {
    id,
    name: row?.names?.zh ?? `#${id}`,
    types,
    speed: +speed.toFixed(2),
    rates,
    carry,
    staminaMax: Math.round((50 + total / 12) * staminaMul),
    pickup: Math.max(passive.pickup || 0, sig?.pickup || 0, perkPickup),
    luck: Math.max(passive.luck || 0, perkLuck),
    perks,
    wx,
    flags: { ...flags, rod: flags.rod || types.some((t) => t === 'Electric' || t === 'Ground'), drain: flags.drain || types.includes('Water'), warm: flags.warm || types.includes('Fire'), seer: flags.seer || types.includes('Psychic') },
    sig: sig ? { ...sig } : null,
    wage: Math.round(60 + total / 3),                       // hiring price
  };
}

/** Best two jobs of a worker, for the roster line: [[job, rate], ...]. */
export function topJobs(worker, n = 2) {
  const list = JOB_IDS.map((j) => [j, worker.rates[j]]);
  if (worker.rates.burn > 0) list.push(['burn', worker.rates.burn]);
  return list.sort((a, b) => b[1] - a[1]).slice(0, n);
}
export const JOB_NAME = { ...Object.fromEntries(JOB_IDS.map((j) => [j, JOBS[j].zh])), burn: '放火' };

/* ------------------------------------------------------------ visitor pool */

/**
 * Today's visitors are the farm's only hires. They must look like they belong
 * in a field: no babies (a baby should not be put to work), no legendaries or
 * mythicals (their Showdown canvases dwarf a starter's), and no evolved form.
 * That is "the first non-baby stage of every chain": drop the 19 `is_baby`
 * species from `evolution_levels.json`, then keep the survivors with no
 * incoming evolution edge.
 *
 * 455 ids, written as ranges because the literal array is 455 lines of noise.
 * `check_pokefarm_engine.mjs` re-derives the set from the two JSON tables and
 * fails on any disagreement, so this is a snapshot, not a second source.
 */
const VISITOR_RANGES = '1,4,7,10,13,16,19,21,23,25,27,29,32,35,37,39,41,43,46,48,50,52,54,56,58,60,63,66,69,72,74,77,79,81,83-84,86,88,90,92,95-96,98,100,102,104,106-109,111,113-116,118,120,122-129,131-133,137-138,140,142-143,147,152,155,158,161,163,165,167,170,176-177,179,183,185,187,190-191,193-194,198,200-204,206-207,209,211,213-216,218,220,222-223,225-228,231,234-235,237,241,246,252,255,258,261,263,265,270,273,276,278,280,283,285,287,290,293,296,299-300,302-304,307,309,311-316,318,320,322,324-325,327-328,331,333,335-339,341,343,345,347,349,351-353,355,357-359,361,363,366,369-371,374,387,390,393,396,399,401,403,408,410,412,415,417-418,420,422,425,427,431,434,436,441-443,448-449,451,453,455-456,459,479,495,498,501,504,506,509,511,513,515,517,519,522,524,527,529,531-532,535,538-540,543,546,548,550-551,554,556-557,559,561-562,564,566,568,570,572,574,577,580,582,585,587-588,590,592,594-595,597,599,602,605,607,610,613,615-616,618-619,621-622,624,626-627,629,631-633,636,650,653,656,659,661,664,667,669,672,674,676-677,679,682,684,686,688,690,692,694,696,698,701-704,707-708,710,712,714,722,725,728,731,734,736,739,741-742,744,746-747,749,751,753,755,757,759,761,764-767,769,771,774-782,793-799,803,805-806,810,813,816,819,821,824,827,829,831,833,835,837,840,843,845-846,849-850,852,854,856,859,868,870-872,874-878,880-885,906,909,912,915,917,919,921,924,926,928,931-932,935,938,940,942,944,946,948,950-951,953,955,957,960,962-963,965,967-969,971,973-974,976-978,984-996,999,1005-1006,1009-1010,1012,1020-1023';

export const VISITOR_IDS = (() => {
  const out = [];
  for (const part of VISITOR_RANGES.split(',')) {
    const [lo, hi = lo] = part.split('-').map(Number);
    for (let id = lo; id <= hi; id++) out.push(id);
  }
  return out;
})();

const VISITOR_SET = new Set(VISITOR_IDS);
export const isVisitorSpecies = (id) => VISITOR_SET.has(id);

/** Today's visitors: a few species seeded by the date, the same for everyone. */
export function visitorIds(dateKey, count = 4, pool = VISITOR_IDS) {
  let h = 2166136261;
  for (const ch of String(dateKey)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const out = [];
  let s = h >>> 0;
  while (out.length < count) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const id = pool[s % pool.length];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
