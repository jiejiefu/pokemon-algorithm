/**
 * 猜謎遊戲的三則提示。
 *
 *   color-game.html  唯一的頁面呼叫者
 *   check_game_hints.mjs  在純 Node 裡跑它
 *
 * ---------------------------------------------------------------------------
 * 移植來源與它必須改掉的地方
 * ---------------------------------------------------------------------------
 *
 * 來源是 pokemonpalette 的 `src/lib/game/hints.ts`。它的骨架照抄了：七類候選、
 * 模糊 → 中等 → 收尾三段、每一步都避開讀者已經知道的事實。第三段的固定字串
 * 也照抄了（那邊是 `"Full palette shown"`，這邊是繁中），因為「最後一則永遠是
 * 同一句」本身就是規則：它讓兩則資訊提示可以被預期，而不是每次都抽到不同的。
 *
 * 三處**不能**照抄：
 *
 * 1. **進化階段不能用 `stage`。** 參考專案讀自己那份資料的 `evolution` 陣列，
 *    而這個專案的 `evolution_chains.json` 有 §3.K 記錄的陷阱：`stage` 是
 *    **圖鑑順序不是深度**，所以一個分支家族會變成八個「接續的階段」。用它判斷
 *    「這是不是最終型」會把兄弟節點當成祖先。
 *
 *    正確的來源是 `evolution_levels.json` 的**邊清單**：`levels` 加上
 *    `unlevelled` 就是全部 789 條邊（457 隻會進化，568 隻是最終型）。這一隻會
 *    進化 ⇔ 它的 id 是兩張表其中一張的 key。這是 §3.K 的結論直接可用。
 *
 * 2. **分類用 `genusZh()`，不要自己寫。** `pokemon-lexicon.js` 已經有一份
 *    完整的中文分類對照（`GENUS_ZH_BY_ID`），在這裡重寫一份就是第二個真相。
 *
 * 3. **說明文字不能洩漏答案。** 這個專案的 `descriptions.zh` 是短句（median
 *    32 字），其中 **93 條把寶可夢自己的名字寫在裡面**——那等於直接把答案印在
 *    提示上。所以任何含有該物種中文名的說明一律不可用。
 *
 * ---------------------------------------------------------------------------
 * 提示與已知事實的去重，是這個模組存在的理由
 * ---------------------------------------------------------------------------
 *
 * 猜錯之後，猜測卡片上已經掛著「同屬性」「同一進化家族」的徽章。所以如果提示再
 * 說一次「這是一隻火屬性」，讀者得到的是零新資訊，而那是他按了 5 秒冷卻才拿到
 * 的東西。`knownFacts` 把所有前幾次猜測已經揭露的事實收集起來，被講過的類別直接
 * 退回下一類。
 */

import { genusZh } from './pokemon-lexicon.js';
import { fnv1a, mulberry32 } from './daily-pick.js';

/** 七類候選。順序是「資訊量由高到低」之外的一個實務順序：便宜的先算。 */
export const HINT_CATEGORIES = [
  'type',
  'evolution',
  'generation',
  'species',
  'description',
  'first_letter',
  'weight_class',
];

export const HINT_CATEGORY_LABELS = {
  type: '屬性',
  evolution: '進化',
  generation: '世代',
  species: '分類',
  description: '圖鑑說明',
  first_letter: '首字母',
  weight_class: '體重',
};

/** 每類落在哪一段。vague 是第一則、medium 是第二則、specific 是候補。 */
export const HINT_CATEGORY_BUCKETS = {
  type: 'medium',
  evolution: 'vague',
  generation: 'medium',
  species: 'medium',
  description: 'specific',
  first_letter: 'vague',
  weight_class: 'vague',
};

/** 最多幾則提示。參考專案是 3。 */
export const MAX_HINTS = 3;

/**
 * 第三則，永遠是這一句。
 *
 * 它不是「一個」提示，是三則之中的**收尾**：前兩則是線索，第三則是揭示。
 * 固定成一句話（而不是抽一個類別）有兩個好處：讀者按到底會預期看到什麼，
 * 而「顯示完整色盤」是一個不消耗任何推理的獎勵，所以它放在最後不會讓人覺得
 * 被卡住。
 */
export const FINAL_HINT = '顯示完整色盤 — 目標的所有顏色都在下面了';

/** 讀者已經知道的事實。猜測卡片的徽章會填進來。 */
export function emptyKnownFacts() {
  return { types: [], sameFamily: false, generations: [] };
}

/** 把一次猜測的關聯結果併進已知事實。 */
export function learnFromGuess(known, related) {
  const next = known || emptyKnownFacts();
  const types = new Set((next.types || []).map((t) => String(t).toLowerCase()));
  for (const t of (related && related.sharedTypes) || []) types.add(String(t).toLowerCase());
  const generations = new Set(next.generations || []);
  for (const g of (related && related.generationIds) || []) generations.add(g);
  return {
    types: [...types],
    sameFamily: Boolean(next.sameFamily || (related && related.sameEvolutionFamily)),
    generations: [...generations],
  };
}

// ---------------------------------------------------------------------------
// 各類提示的文字
// ---------------------------------------------------------------------------

/** 一隻寶可夢的屬性，繁中。單屬性與雙屬性用不同的句型，因為讀起來不一樣。 */
export function typeHint(p) {
  const t = Array.isArray(p.types_zh) && p.types_zh.length ? p.types_zh : p.types;
  if (!Array.isArray(t) || !t.length) return null;
  if (t.length === 1) return `這一隻是${t[0]}屬性。`;
  return `這一隻是${t.join('、')}的雙屬性。`;
}

/**
 * 會不會進化。資料來自邊清單，不是 `stage` —— 見檔頭第三點。
 *
 * 兩句都是負面或正面的單一事實，中間沒有灰階，所以它只能出現一次。
 */
export function evolutionHint(p, evolves) {
  return evolves ? '這一隻還會再進化。' : '這一隻已經是進化的最終型。';
}

export function generationHint(p) {
  const numeral = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' };
  const n = Number(p.generation);
  if (!n || !numeral[n]) return null;
  return `這一隻出現在第${numeral[n]}世代。`;
}

/** 分類。走 `genusZh()`，因為那份對照表已經在專案裡了。 */
export function speciesHint(p) {
  const genus = genusZh(p);
  if (!genus || genus === '—') return null;
  return `這一隻屬於${genus}。`;
}

/**
 * 圖鑑說明，**但不能包含自己的名字**。
 *
 * 93 條 zh 說明裡有這個問題，所以這是硬條件不是過濾器。字數上限沿用參考專案的
 * 200 —— 這個專案的說明本來就都只有 50 字以內，所以那個上限在這裡從不生效，
 * 保留它是為了有人換資料來源時不會變成一篇百科全書。
 */
export function descriptionHint(p) {
  const zh = p.descriptions && (p.descriptions.zh || p.descriptions.zh_text2);
  const text = typeof zh === 'string' ? zh.trim() : '';
  if (!text || text.length >= 200) return null;
  const name = p.names && p.names.zh;
  if (name && text.includes(name)) return null;
  return `官方說明：「${text}」`;
}

export function firstLetterHint(p) {
  const name = p.names && p.names.zh;
  if (!name || !name.length) return null;
  return `名字的第一個字是「${name[0]}」。`;
}

/**
 * 體重級距。分界沿用參考專案那一組，因為它讀起來是「大概的量級」而不是假精確。
 *
 * **`Number(null)` 是 `0`** —— 所以 `if (!Number.isFinite(kg))` 擋不住一個缺值的
 * 物種，它會安靜地通過 `Number(null) < 10` 並回答「不到 10 公斤」。這與
 * `check_all.mjs` 的快取讀 `== null` 而誤判成 `last 0.0s` 是同一個坑：把
 * 「沒有值」轉成數字再拿它做比較，得到的是一個**看起來合理**的答案。所以先擋
 * 型別，再轉換。
 */
export function weightHint(p) {
  if (!p || typeof p.weight_kg !== 'number' || !Number.isFinite(p.weight_kg)) return null;
  const kg = p.weight_kg;
  if (kg < 10) return '體重不到 10 公斤。';
  if (kg < 50) return '體重在 10 到 50 公斤之間。';
  if (kg < 100) return '體重在 50 到 100 公斤之間。';
  if (kg < 250) return '體重在 100 到 250 公斤之間。';
  return '體重超過 250 公斤。';
}

// ---------------------------------------------------------------------------
// 候選與挑選
// ---------------------------------------------------------------------------

/**
 * 這一隻能產生的所有候選，依類別。
 *
 * 回傳物件而不是字串，是為了讓「已知事實」能在**產生之後**過濾掉某一類，而
 * 不用把 `knownFacts` 塞進每一個文字函式的簽章裡——七個函式、七個參數，而其中
 * 六個根本不需要它。
 */
export function buildCandidates(p, evolves) {
  const out = [];
  const push = (category, text) => {
    if (text) out.push({ category, bucket: HINT_CATEGORY_BUCKETS[category], text });
  };
  push('type', typeHint(p));
  push('evolution', evolutionHint(p, evolves));
  push('generation', generationHint(p));
  push('species', speciesHint(p));
  push('description', descriptionHint(p));
  push('first_letter', firstLetterHint(p));
  push('weight_class', weightHint(p));
  return out;
}

/**
 * 已被講過的類別。**只**看讀者真的看過的東西。
 *
 * 注意「同世代」不在這裡：參考專案的徽章從不顯示 sameGeneration（它算出來了卻
 * 沒渲染），所以把它當成已知事實會讓世代提示被錯誤地跳過——而那正是有 bug 的
 * 那一邊的錯，不是保守那一邊的。
 */
function spentCategories(p, known) {
  const spent = new Set();
  const k = known || {};
  const targetTypes = new Set((p.types_zh || p.types || []).map((t) => String(t).toLowerCase()));
  if ((k.types || []).some((t) => targetTypes.has(String(t).toLowerCase()))) spent.add('type');
  if (k.sameFamily) spent.add('evolution');
  if ((k.generations || []).includes(Number(p.generation))) spent.add('generation');
  return spent;
}

/**
 * 決定性的洗牌，種子是目標的 id。
 *
 * **沒有洗牌，七個類別裡有五個永遠不會出現。** 這一版的 bug 就是這樣：固定取
 * `vague[0]` 與 `medium[0]`，而 `evolution` 排在 `type` 前面，所以每一局的第一
 * 則都是「這一隻還會再進化」、第二則都是屬性。世代、分類、說明、首字母、體重
 * 全部是死碼——它們有函式、有單元、有 docblock，而沒有一個字會被玩家讀到。
 *
 * 量測方式是「這個類別的文字有沒有出現在任何一隻的 `generateHints()` 結果裡」，
 * 不是「它有沒有產生過候選」：後者七個全過，前者只有兩個。
 *
 * **種子必須是 id 而不是 `Math.random()`。** 頁面每次重繪都會重新呼叫這個函式
 * （§3.B1 記錄過重建節點的教訓），用隨機種子會讓已經顯示在畫面上的提示換一句
 * 話，而已經按過的提示是不能收回的資訊。用 id 當種子則是「這隻寶可夢的三則
 * 提示永遠是這三句」，同一局裡���數次呼叫得到同一個答案。
 */
function shuffle(list, seed) {
  const rand = mulberry32(fnv1a(`game-hints:${seed}`));
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 去掉「已經講過的」之後，還剩哪些類別可用。
 *
 * 這不是為了測試而存在的。**去重機制只能從類別集合觀察，不能從輸出文字觀察**：
 * 某一類被移除之後，洗牌本來就有可能不選它，所以「輸出裡沒有某一類的字」無法
 * 區分「被去重了」與「這次沒抽到」。而頁面需要知道還剩幾則可拿，才能決定提示
 * 按鈕的狀態——猜測卡片徽章已經講過三件事之後，按鈕還亮著卻每按一次都給一句
 * 換過的東西，那比不亮更糟。
 *
 * @returns {string[]} 類別名，順序是 `HINT_CATEGORIES` 的順序
 */
export function remainingCategories(p, evolves, knownFacts = null) {
  const spent = spentCategories(p, knownFacts);
  return buildCandidates(p, evolves)
    .filter((c) => !spent.has(c.category))
    .map((c) => c.category);
}

/**
 * 產生三則提示。
 *
 * 保證：長度**永遠**是 3。少於 3 會讓第三則的「顯示完整色盤」被抽掉，而那是
 * 整個提示系統的終點；所以任何不足都從剩下的類別裡補，補到底用一句不帶任何
 * 資訊的話，而不是回傳一個短陣列——一個長度會變的提示陣列，頁面上的「3 則」
 * 就變成了一句可能不成立的話。
 *
 * 順序：第一則從 vague 裡挑、第二則從 medium 挑，兩者都先洗牌。第三則固定。
 *
 * @param {object} p pokemon_data.json 的一筆
 * @param {boolean} evolves 是否還會進化（來自邊清單，不是 `stage`）
 * @param {object} knownFacts `learnFromGuess()` 的結果
 * @returns {string[]}
 */
export function generateHints(p, evolves, knownFacts = null) {
  const spent = spentCategories(p, knownFacts);
  const candidates = buildCandidates(p, evolves).filter((c) => !spent.has(c.category));

  const vague = shuffle(candidates.filter((c) => c.bucket === 'vague'), p.id);
  const medium = shuffle(candidates.filter((c) => c.bucket === 'medium'), p.id);
  const specific = shuffle(candidates.filter((c) => c.bucket === 'specific'), p.id);

  const hints = [];
  /* 第一則從 vague、第二則從 medium，各自在自己的池裡洗牌。不做參考專案那個
     「至少有一則屬性提示」的保證：使用者已經可以從猜測卡片看到屬性，硬塞一則
     屬性提示是把已知資訊再說一次，而那是花了他 5 秒冷卻才拿到的東西。 */
  const first = vague[0] || medium[0];
  if (first) hints.push(first.text);

  // 第二則：`medium` 與 `specific` 一起洗牌競爭。
  //
  // 原本是把 `specific` 當成 medium 用完之後的最後手段，而那讓它永遠輪不到：
  // 七個類別裡有四個 vague、三個 medium，所以 medium 用完之前 specific 永遠在
  // 候補席上。量測是「這個類別的文字有沒有出現在任何一隻的結果裡」——候選階段
  // 七個全過，能到玩家手上的只有六個。`description` 不是被刪掉的，是被排在
  // 一個永遠輪不到的位置。
  //
  // 所以 medium 與 specific 合併競爭，而「先 vague 再 medium」的那一段仍然成立
  // （第一則一定是最不具體的那一類）。參考專案的 specific 有兩個成員而且同樣
  // 排在最後，它只是沒有兩邊的候選都這麼多，所以那個排序在那邊看不出問題。
  const second = shuffle([...medium, ...specific], p.id).find((c) => !hints.includes(c.text))
    || vague.find((c) => !hints.includes(c.text));
  if (second) hints.push(second.text);

  // 補到兩則為止（第三則是固定的收尾，所以前面需要湊滿 2）。
  for (const pool of [shuffle([...medium, ...specific], p.id), vague, shuffle(candidates, p.id)]) {
    for (const c of pool) {
      if (hints.length >= 2) break;
      if (!hints.includes(c.text)) hints.push(c.text);
    }
    if (hints.length >= 2) break;
  }
  while (hints.length < 2) hints.push('這一次沒有更多線索了。');

  return [hints[0], hints[1], FINAL_HINT];
}

/** 已揭露了幾則，其中第三則會把色帶擴成全部。 */
export function hintRevealsPalette(index) {
  return index >= 2;
}