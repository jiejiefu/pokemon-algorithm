/**
 * 猜謎遊戲的出題與計分。純函式，沒有 DOM、沒有 fetch、沒有 localStorage。
 *
 *   color-game.html  唯一的頁面呼叫者
 *   check_game_similarity.mjs  在純 Node 裡跑它，這是它沒有副作用的原因
 *
 * ---------------------------------------------------------------------------
 * 為什麼計分不用參考專案那套 sRGB 歐氏距離
 * ---------------------------------------------------------------------------
 *
 * 移植來源是 pokemonpalette 的 `src/lib/game/similarity.ts`，那裡用純 sRGB
 * 距離、`effectiveMaxDistance = 250`。這裡不用它，理由是本專案自己的 §3.B2：
 *
 *   `findClosestChineseColorName()` 用 nearest-in-RGB 把 `#414141` 判成**墨綠**
 *   —— 表格裡一個通道只差 8 的項目，贏過所有三通道都差 20 的淺灰。
 *
 * 那次的表格是 100 個中文色名，這裡的語料是 6,148 個 sprite 色票，61 倍。
 *
 * 兩種度量差多少，是量出來的而不是推論的（實測見下），因為「差很多」這種
 * 形容詞在兩個頁面之間沒有任何意義：
 *
 *   - 「最接近的那一隻」相同的目標：47 / 80
 *   - **前 10 名名單完全相同：0 / 80**
 *   - 兩個前 10 名的平均重疊：**0.65 / 10**
 *
 * 所以照抄 RGB 不是「換一個演算法」，是讓兩個頁面對同一組顏色講不同的話：
 * colors-generator.html 說最接近的是 A，color-game.html 會說是 B。
 *
 * ---------------------------------------------------------------------------
 * 這個模組自己建索引，而不是呼叫 `color-match.js` 的 `matchPalette()`
 * ---------------------------------------------------------------------------
 *
 * 因為 `buildMatchIndex()` 只讀 `palettes[key].n` —— 它的索引裡**只有原始色**，
 * 而地獄難度全是異色。這個模組因此需要兩套索引，而 `color-match.js` 的
 * `groups` 是 module 級單例，沒有辦法同時持有兩種外觀。
 *
 * §3.B1 的規則是「不要擴大 color-match.js 的 export 介面」：color.html 與
 * colors-explore.html 共用那個檔案，加東西進去等於把風險攤到兩個頁面上。
 * 所以這裡 import 它的 `hexToOklab` / `deltaEOk`，索引自己建。
 *
 * **計分算式與 `matchPalette()` 逐行相同**（forward / reverse 雙向、依占比
 * 加權）。這不是重寫一個更好的演算法，是讓遊戲的分數與
 * colors-generator.html 顯示的是同一個量。若這裡改了權重，那一頁就開始
 * 講另一套話，而沒有任何檢查會發現。
 */

import { hexToOklab, deltaEOk } from './color-match.js';
import { taipeiDateKey, fnv1a, mulberry32 } from './daily-pick.js';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

/** 參考專案是 4 次，這裡照抄。 */
export const MAX_ATTEMPTS = 4;

/**
 * 三個難度。`easy` 單一世代、`hard` 全圖鑑、`hell` 全圖鑑異色。
 * 參考專案是 easy / hard 兩軌；地獄是本專案新增的第三軌。
 */
export const DIFFICULTIES = ['easy', 'hard', 'hell'];

export const DIFFICULTY_LABELS = {
  easy: '簡單',
  hard: '困難',
  hell: '地獄',
};

/** 難度的中文說明，給世代選擇器與說明文字用。 */
export const DIFFICULTY_NOTES = {
  easy: '單一世代，全部原始色',
  hard: '全 1,025 隻，全部原始色',
  hell: '全 1,025 隻，全部異色',
};

/**
 * 一局最多顯示幾色。
 *
 * 參考專案 `PALETTE_COLORS_COUNT = 3`，從 6 色裡切前 3。照抄這個數字，
 * 但來源不同：它切的是執行期抽出來的 6 色，這裡切的是
 * `color_palettes.json` 裡**已經按占比排好序**的 6 色，所以「前 3 色」在兩邊
 * 是同一個意義（占比最高的三色），不需要重新排序。
 */
export const PALETTE_COLORS_SHOWN = 3;

/** 第三則提示揭露全部 6 色。Unown 一般與異色都只有 5 色，所以是「全部」不是「6 色」。 */
export const PALETTE_COLORS_REVEALED = 6;

/** 兩局挑戰（無限模式）各自的最大重試次數，沒有限次。 */
export const MAX_ATTEMPTS_UNLIMITED = Infinity;

/**
 * 分享字串的四個色階門檻。
 *
 * 參考專案用的是相似度的 0.75 / 0.5 / 0.25 分界，而那個相似度是
 * `(1 - d/250)^1.5`。那個算式裡的 250 是 **sRGB 空間的上界**，不是 OKLab 的
 * —— 用在 OKLab 距離上會讓幾乎每一格都變成 0%，因為 OKLab 的距離最大只有
 * 0.33（見下）。
 *
 * 所以門檻是從語料庫量出來的，不是從參考專案換算的。實測 25 個目標 ×
 * 全部 1,025 隻 = 25,600 對的色盤距離分佈：
 *
 *   p0.1 0.0380 · p1 0.0525 · p5 0.0662 · p10 0.0749 · p25 0.0925
 *   p50 0.1158 · p75 0.1413 · p90 0.1642 · p99 0.2044 · p99.9 0.2366
 *   max 0.3326
 *
 * 四個分界對應約 p10 / p55 / p90，讓四個格子都被用到而不是全部擠在第一格。
 * 這四個數字由 `check_game_similarity.mjs` 重新量一次，所以語料庫變了它會
 * 紅——不是變成一個還能通過的門檻。
 */
export const TIER_CLOSE = 0.075;
export const TIER_MID = 0.120;
export const TIER_FAR = 0.165;

/**
 * 距離 → 色階。**小的是近的**，與參考專家的方向相反，因為那邊是相似度
 * （大的是近的）。混淆這兩個方向會讓分享字串整個反過來，而它看起來仍然
 * 是一張合理的圖。
 *
 * @returns {'close'|'mid'|'far'|'miss'}
 */
export function tierOf(distance) {
  if (!Number.isFinite(distance)) return 'miss';
  if (distance <= TIER_CLOSE) return 'close';
  if (distance <= TIER_MID) return 'mid';
  if (distance <= TIER_FAR) return 'far';
  return 'miss';
}

/**
 * 出題的種子前綴。與 `daily-pick.js` 的 `DAILY_BUCKETS` 共用同一顆命名空間，
 * 前綴不同所以兩個抽取永不互相影響——而它們本來就該互相獨立：今日推薦是
 * 「看看今天主打誰」，猜謎的目標是「一道每天固定的題」。
 */
export const GAME_SEED = 'pokemon-colorgame:';

// ---------------------------------------------------------------------------
// 難度 → 外觀
// ---------------------------------------------------------------------------

/**
 * 難度決定外觀，這是本專案相對於參考專案的一個收斂。
 *
 * 參考專案有 `Any / Normal / Shiny` 三個讓使用者自己選的變體 tile。
 * 這裡不需要，因為使用者的規格把變體綁在難度上了：簡單與困難是原始色，
 * 地獄固定是異色。讓一個選擇器去挑一個只有一種答案的東西，是多一個可以
 * 設成不一致的狀態欄位。
 *
 * 參考專案的 `Variant` filter 因此整個消失，而不是被移到某處。
 *
 * @param {string} difficulty
 * @returns {'n'|'s'}
 */
export function variantOf(difficulty) {
  return difficulty === 'hell' ? 's' : 'n';
}

/** 地獄以外都是原始色。 */
export function isShinyMode(difficulty) {
  return variantOf(difficulty) === 's';
}

// ---------------------------------------------------------------------------
// 出爐池
// ---------------------------------------------------------------------------

/**
 * `pokemon_data.json` 的 `generation` 欄位衍生出的世代 → id 清單。
 *
 * **不寫死世代區間。** 參考專案在 `daily-pool.ts` 寫死 `GEN_RANGES`，因為它
 * 讀的是自己的資料表而那張表沒有世代欄位；這邊有，所以區間是推導出來的。
 * 寫死一份區間就是第二個真相，而它會在資料更新時過期——§3.K 記錄過一次
 * 類似的東西。
 *
 * 回傳 `Map<number, number[]>`（id 由小到大）。空清單代表該世代不存在，
 * 呼叫者必須處理，不能當成「沒有這個世代以外的情況」。
 *
 * @param {Array<{id:number, generation:number}>} data
 * @returns {Map<number, number[]>}
 */
export function genIdMap(data) {
  const map = new Map();
  for (const p of data || []) {
    const g = Number(p && p.generation);
    if (!Number.isFinite(g) || g < 1) continue;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(p.id);
  }
  for (const ids of map.values()) ids.sort((a, b) => a - b);
  return map;
}

/** 全 1,025 隻，由小到大。 */
export function allIds(data) {
  return (data || []).map((p) => p.id).sort((a, b) => a - b);
}

/**
 * 某一難度的出爐池。
 *
 * - `easy`：單一世代。使用者選哪一代就只抽那一代，所以池大小是 72 到 156。
 * - `hard`：全 1,025。
 * - `hell`：全 1,025。池與 hard 相同，但 `variantOf()` 回傳 `'s'`。
 *
 * @param {string} difficulty
 * @param {number} gen  只有 easy 用到
 * @param {Array} data
 * @returns {number[]}
 */
export function poolFor(difficulty, gen, data) {
  if (difficulty === 'easy') {
    const g = Number(gen);
    if (!Number.isFinite(g)) return [];
    return genIdMap(data).get(g) || [];
  }
  return allIds(data);
}

// ---------------------------------------------------------------------------
// 出題
// ---------------------------------------------------------------------------

/**
 * 從池裡抽一隻，回傳它在池中的位置。
 *
 * `mulberry32(seed)` 回傳的是一個**產生器函式**而不是數字——那是
 * `daily-pick.js` 的簽章，它的整個設計就是「一個 PRNG 的狀態只有一個數字」。
 * 第一次寫成 `mulberry32(fnv1a(seed)) % pool.length` 時，`函式 % 151` 是
 * `NaN`，`NaN < 0` 為 false，於是 `pool[NaN]` 是 `undefined`，而整個函式回傳
 * 一個 `{id: undefined}` 的目標——**沒有丟出任何東西**。它必須呼叫一次。
 *
 * 回傳**位置**而不是 id，是為了讓「位置 < 0」成為一個可以被 caller 看見的
 * 狀態（池是空的），而不是回傳一個 fallback 之後所有人都忘記池是空的。
 */
function pickIndex(pool, seed) {
  if (!pool.length) return -1;
  return Math.floor(mulberry32(fnv1a(seed))() * pool.length);
}

/**
 * 每日題目。同一天、同一難度、同一世代 → 同一隻。
 *
 * **種子裡有世代**，所以 easy 難度下兩個使用者選不同世代會看到不同的題目。
 * 這是規格要的（easy 讓使用者自己選世代），而它與參考專案「同一個日期全世界
 * 看到同一隻」的性質並不衝突：那只在難度與世代都相同時成立，而那正是
 * 「同一道題」的定義。
 *
 * 用台北日曆日（`taipeiDateKey`）而不是 UTC 日：這個專案對「每日」的既有
 * 定義是台北的，`daily-pick.js` 的第四條決策專門記錄了為什麼。遊戲若用 UTC，
 * 台北讀者會在早上 8 點換題、首頁的今日推薦卻不換，而那兩件事在同一個網站上
 * 都叫「今日」。
 *
 * @returns {{id:number, variant:'n'|'s', index:number}|null}
 */
export function pickDailyTarget(difficulty, gen, data, { now = new Date() } = {}) {
  const pool = poolFor(difficulty, gen, data);
  const index = pickIndex(pool, `${GAME_SEED}${difficulty}:${difficulty === 'easy' ? gen : 'all'}:${taipeiDateKey(now)}`);
  if (index < 0) return null;
  return { id: pool[index], variant: variantOf(difficulty), index };
}

/**
 * 無限模式的目標。沒有日期，也就不需要種子。
 *
 * `rand` 接受注入是為了讓檢查可以對同一組資料重現同一局；不注入時才用
 * `Math.random()`。這是本專案的慣例（`pokemon-search` 的 debounce、圖鑑的
 * 篩選都是同一個理由）。
 */
export function pickUnlimitedTarget(difficulty, gen, data, rand = Math.random) {
  const pool = poolFor(difficulty, gen, data);
  if (!pool.length) return null;
  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return { id: pool[index], variant: variantOf(difficulty), index };
}

// ---------------------------------------------------------------------------
// 色盤
// ---------------------------------------------------------------------------

/**
 * 一隻寶可夢在某個外觀下的 6 色（Unown 是 5 色）。
 *
 * **占比不重算、不重排序。** `color_palettes.json` 的 rows 已經是
 * `extract_color_palettes_mmcq.py` 按占比降冪排好的，所以第 0 列就是主色。
 * 重排一次就是多一次可以排錯的機會，而且會讓「主色」這個詞有兩個定義。
 *
 * @param {object} palettes `color_palettes.json` 的形狀 `{ [id]: { n, s } }`
 * @param {number} id
 * @param {'n'|'s'} variant
 * @returns {Array<{hex:string, share:number}>} 該物種不存在時是 `[]`
 */
export function paletteRows(palettes, id, variant = 'n') {
  const entry = palettes && palettes[String(id)];
  const rows = entry && entry[variant];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
    .map((r) => ({ hex: r[0], share: Number(r[1]) || 0 }));
}

/** 對局中實際顯示的色數：預設 3 色，第三則提示之後是全部。 */
export function visiblePalette(palettes, id, variant, revealed = false) {
  const rows = paletteRows(palettes, id, variant);
  const n = revealed ? rows.length : PALETTE_COLORS_SHOWN;
  return rows.slice(0, Math.min(n, revealed ? PALETTE_COLORS_REVEALED : PALETTE_COLORS_SHOWN));
}

// ---------------------------------------------------------------------------
// 計分
// ---------------------------------------------------------------------------

/**
 * 兩組色之間的對稱距離。與 `color-match.js` 的 `matchPalette()` 算式逐行相同。
 *
 * 兩組色不一樣多時，這個數字不能當百分比讀——它是一個距離，越小越近，而
 * 距離沒有上界。頁面因此不印百分比，而是印距離本身，理由見 §3.B2 的結論：
 *
 *   誠實的做法是把 ΔE 數字本身顯示出來。距離大就是大，那是一個事實而不是
 *   一個失敗。
 *
 * 對稱是必要的而且不是細節：`forward` 單獨用的時候，一組連續調的褐色可以零
 * 懲罰地蓋住任何褐色穿搭。`matchPalette()` 加 `reverse` 就是為此，所以這個
 * 函式不能為了「照抄參考專案」而退回單向——參考專案用的算式本身是單向平均，
 * 那是它比較弱的一環，不是它值得保留的特徵。
 */
export function paletteDistance(rowsA, rowsB) {
  const a = (rowsA || []).filter((r) => r && r.hex).map((r) => ({
    lab: hexToOklab(r.hex), share: Number(r.share) || 0,
  })).filter((r) => r.lab);
  const b = (rowsB || []).filter((r) => r && r.hex).map((r) => ({
    lab: hexToOklab(r.hex), share: Number(r.share) || 0,
  })).filter((r) => r.lab);
  if (!a.length || !b.length) return null;

  // 查詢側的占比總和為 0（全 0 或缺資料）時退回等權，而不是回傳 NaN。
  let aSum = a.reduce((s, r) => s + r.share, 0);
  if (!(aSum > 0)) for (const r of a) r.share = 1;
  aSum = a.reduce((s, r) => s + r.share, 0);

  const bSumRaw = b.reduce((s, r) => s + (r.share > 0 ? r.share : 0), 0);
  if (!(bSumRaw > 0)) return null;

  let forward = 0;
  for (const o of a) {
    let best = Infinity;
    for (const e of b) { const d = deltaEOk(o.lab, e.lab); if (d < best) best = d; }
    forward += o.share * best;
  }
  forward /= aSum;

  let reverse = 0;
  for (const e of b) {
    let best = Infinity;
    for (const o of a) { const d = deltaEOk(o.lab, e.lab); if (d < best) best = d; }
    reverse += (e.share > 0 ? e.share : 0) * best;
  }
  reverse /= bSumRaw;

  return { forward, reverse, score: (forward + reverse) / 2 };
}

/**
 * 猜測的分數：一個距離，**不是** 0 到 1 的相似度。
 *
 * 頁面直接印這個數字（4 位小數，與 colors-generator.html 同一個格式），
 * 而不是印百分比。參考專案印 `NN% match`，那需要一個把距離映射到 0..1 的
 * 正規化常數，而任何常數都是選擇：
 *
 *   - 用語料庫實測的 0.8925 當上界，`% = (1 - d/0.8925) * 100`
 *   - 用參考專案的 250（那是 sRGB 空間的上界，不是 OKLab 的）
 *
 * 兩者都不影響「誰比較近」的排序，只影響那個數字看起來像什麼。第二個會
 * 讓幾乎每一格都變成 0%，因為 OKLab 的距離最大只有 0.8925 而門檻是 250。
 *
 * 所以這裡回傳距離，並且把它命名為距離。
 *
 * @returns {{score:number, forward:number, reverse:number}|null}
 */
export function scoreGuess(palettes, targetId, guessId, variant) {
  const target = paletteRows(palettes, targetId, variant);
  const guess = paletteRows(palettes, guessId, variant);
  return paletteDistance(guess, target);
}

// ---------------------------------------------------------------------------
// 難度與世代的正規化
// ---------------------------------------------------------------------------

export function isDifficulty(value) {
  return DIFFICULTIES.indexOf(value) >= 0;
}

/** 不認得的難度落到 `easy`，因為那是首次進入的預設值。 */
export function normalizeDifficulty(value) {
  return isDifficulty(value) ? value : 'easy';
}

/**
 * 不認得的世代落到 1。
 *
 * 規格是「第一次進來都是 Easy + 第一世代」，而 localStorage 可以被手改、
 * 可以是舊版本寫的、可以在另一個世代數目的站上留下來。所以正規化是必要的，
 * 而它的 fallback 必須是規格指定的那一個值，不是「最小的那個」。
 */
export function normalizeGeneration(value, availableGenerations) {
  const g = Number(value);
  const max = Math.max(...(availableGenerations || [1]));
  if (!Number.isFinite(g) || g < 1 || g > max) return 1;
  return Math.floor(g);
}

export { taipeiDateKey, fnv1a, mulberry32 };