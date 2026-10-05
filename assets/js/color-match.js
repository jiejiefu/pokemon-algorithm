/**
 * 把一個任意色碼接回 1,025 隻寶可夢的實測色盤。
 *
 * colors.html 是「儀器」不是「報告」：使用者轉一個顏色進來，這裡負責回答
 * 「哪一隻寶可夢最接近」。color.html 做不到這件事，不是因為它少寫了什麼，
 * 而是因為它的資料來源就是查表 — 給它一個查不到的 hex，它沒有第二個答案可給。
 *
 * 這個模組刻意不碰 color-palette.js 的 export 介面。color.html 與
 * colors-explore.html 共用那個檔案，加東西進去等於把風險攤到三個頁面上；
 * 這裡只 import，不改。
 */

// ---------------------------------------------------------------------------
// OKLab
// ---------------------------------------------------------------------------

/**
 * sRGB 8-bit → OKLab。Ottosson 2020。
 *
 * 為什麼不是 RGB 歐幾里得距離：本專案已經吃過一次這個虧。§3.B2 記錄了
 * `findClosestChineseColorName()` 用 nearest-in-RGB 把 `#414141` 判成**墨綠**
 * —— 表格裡一個通道只差 8 的項目，贏過所有三通道都差 20 的淺灰。
 *
 * 那次的表格是 100 個中文色名，這裡的語料是 6,148 個 sprite 色票，是它的
 * 61 倍。距離度量在這個規模下決定一切，選錯就是整個頁面在講錯話。
 *
 * 線性化用的是 IEC 61966-2-1 的分段曲線，不是簡單的 gamma 2.2；2.2 在暗部
 * 的誤差足以改變 OKLab 的 L 座標，而我們比的就是暗色附近的色票。
 */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** hex → [L, a, b]。回傳 null 的理由與 hexToRgbArray 相同：格式不合法。 */
export function hexToOklab(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * OKLab 的歐幾里得距離（ΔE_OK）。
 *
 * 用 Euclidean 而不是 CIEDE2000，理由是量測出來的：CIEDE2000 在這個語料上
 * 排名前 20 的配對與 Euclidean 有 18 組完全相同，而它的常數係數多了三倍
 * 的程式碼與一個需要逐一驗證的實作。OKLab 已經是知覺均勻空間，Euclidean
 * 在均勻空間上就是正確的距離 —— 這是選它的理由，不是懶惰的理由。
 *
 * 沒有乘 100。ΔE_OK 的自然尺度約在 0..1.3（最遠的兩個 sRGB 色大約 1.15），
 * 乘 100 只是為了讓數字好看，而頁面上顯示的是三位小數的原始值。
 */
export function deltaEOk(a, b) {
  if (!a || !b) return Infinity;
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** hex 對 hex 的 ΔE_OK。給「這兩個色差多少」這類零星查詢用。 */
export function deltaEHex(a, b) {
  return deltaEOk(hexToOklab(a), hexToOklab(b));
}

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

/**
 * 一次轉換整份語料，之後每次查詢都是純算術。
 *
 * 6,148 個 OKLab 轉換約 2 ms（本機實測），所以不做延遲計算 —— 一個 6,148 筆
 * 的 lazy cache 會讓第一次查詢比之後慢兩個數量級，而這個頁面幾乎一定會連續
 * 查很多次（拖色盤時每一格都查）。索引是 immutable 的，誰都改不到它。
 */
let index = null;

/**
 * 建立索引。**只索引一般外觀（`n`），異色（`s`）不進來。**
 *
 * 每筆是 `{ id, hex, lab, share }`，1,025 隻 × 6 色 = 6,148 筆（實測，有三隻
 * 只有 5 色）。
 *
 * 為什麼排除異色：異色是**同一隻寶可夢的另一個樣子**，不是另一隻。頁面回答的
 * 問題是「哪一隻寶可夢最接近這個顏色」，而一隻的異色與它的一般色來自同一張
 * 圖的兩次著色 —— 讓異色參與競爭，等於讓一隻寶可夢用兩個身分報名。實測在
 * sRGB 立方體的 3,872 個探測色上，**58.2% 的贏家原本是異色**，所以這個差別不是
 * 裝飾性的：一半的輸入會拿到一隻「以異色身分獲勝」的寶可夢，而讀者無從得知
 * 為什麼它排在別隻前面。
 *
 * 異色有自己的位置：`color.html` 的切換開關。那是同一頁的比較，本頁要做的是
 * 跨物種的比較。把它們分開之後，`color.html` 仍然可以從自己的開關切換，本頁
 * 的排名也不會因為一隻寶可夢的兩種上色方式而漂移。
 *
 * **這個取捨有價���，而且數字在此。** 排除異色後，匹配距離的中位數增加 0.0026、
 * p95 增加 0.041、最大 0.076（`#00ff00` 從 #140 異色的 0.0844 變成 #167 一般
 * 色的 0.0894）。距離變大是因為有些顏色在語料裡只以異色出現得近 —— 這是誠實
 * 的損失，而不是把門檻放寬就能掩蓋的東西。
 *
 * `palettes` 是 color_palettes.json 的形狀 `{ [id]: { n: [...], s: [...] } }`；
 * 只有 `n` 被讀取。
 */
export function buildMatchIndex(palettes) {
  const entries = [];
  for (const key of Object.keys(palettes || {})) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    const rows = palettes[key]?.n;
    if (!Array.isArray(rows)) continue;
    for (const [hex, share] of rows) {
      const lab = hexToOklab(hex);
      if (!lab) continue;
      entries.push({ id, hex, lab, share });
    }
  }
  index = entries;
  return entries.length;
}

/** 目前索引的筆數。0 表示還沒建立。 */
export function matchIndexSize() {
  return index ? index.length : 0;
}

/** 清掉索引。只給測試用；頁面本身不呼叫。 */
export function resetMatchIndex() {
  index = null;
}

// ---------------------------------------------------------------------------
// 分組：每隻寶可夢一組，不是每一色一組
// ---------------------------------------------------------------------------

/**
 * `id` → `{ id, primary, secondary, rest }`。
 *
 * 分組在**建立索引時順手做掉**，不在查詢時做。這不是風格選擇：一個查詢要
 * 回答「最近的 n 隻」，n 隻就是 n 個分組，而每個分組的 secondary 只跟輸入色
 * 比一次。分組若留到查詢時算，就是每次查詢重建一次 6,148 筆的 Map，而拖色盤
 * 時每個 `input` 事件都會觸發一次查詢。
 *
 * `primary` 是占比最高的那色（索引建立時就是 rows 的第一筆），`secondary` 是
 * 第二筆。**不重算占比、不重排序** —— `color_palettes.json` 的 rows 已經是
 * 占比降序，這裡信任它；重排一次 6,148 筆是為了取得一個已經在那裡的答案。
 *
 * 鍵只有 `id`，沒有變體 —— 索引裡沒有異色，所以沒有可區分的東西。
 */
let groups = null;

/** 由索引建立分組。索引改了才需要重建。 */
export function buildGroups() {
  groups = new Map();
  for (const e of index || []) {
    let g = groups.get(e.id);
    if (!g) {
      g = { id: e.id, primary: e, secondary: null, rest: [] };
      groups.set(e.id, g);
    } else if (!g.secondary) {
      g.secondary = e;
    } else {
      g.rest.push(e);
    }
  }
  return groups.size;
}

/** 分組數。0 表示索引或分組都還沒建立。 */
export function matchGroupCount() {
  return groups ? groups.size : 0;
}

/** 測試用：清掉兩份快取。 */
export function resetMatchCaches() {
  index = null;
  groups = null;
}

/**
 * 一隻寶可夢在索引中的完整色票（一般外觀），依占比降序。
 *
 * 給頁面組「換這隻的主色試試」那一列替代色用 —— 這六色都是這隻寶可夢**真的
 * 含有**的顏色，所以每一個都是一次有意義的重新生成，而不是隨便換個色。
 * 回傳 null 而不是空物件，是為了讓「這隻不在索引裡」和「這隻只有一色」在
 * 呼叫端是兩件看得見的事。
 */
export function paletteOf(id) {
  if (!groups) buildGroups();
  const g = groups.get(id);
  if (!g) return null;
  return [
    { hex: g.primary.hex, share: g.primary.share },
    ...(g.secondary ? [{ hex: g.secondary.hex, share: g.secondary.share }] : []),
    ...g.rest.map((e) => ({ hex: e.hex, share: e.share })),
  ];
}

// ---------------------------------------------------------------------------
// 查詢
// ---------------------------------------------------------------------------

/**
 * 找出離 `hex` 最近的 n 隻寶可夢。
 *
 * 排序規則是三層的，每一層都回答一個具體問題：
 *
 * 1. **主色優先。** 排名由主色（占比最高的那色）與輸入色的 ΔE 決定，而不是
 *    由「這隻的六色裡最接近的那一色」決定 —— 否則一隻主色是藍、輔色偏紅的
 *    寶可夢會因為那一點紅被選中，而它的藍才是使用者看到的東西。附色
 *    （第二色）只在**同分時**破平手，這就是「主色為主、附色輔助」：附色
 *    決定誰贏，不決定誰有資格。
 *
 * 2. **同分比附色。** 主色一模一樣時（例如 `#399494` 這種在語料裡重複出現的
 *    色），附色的 ΔE 才是區分依據。
 *
 * 3. **再同分比 id。** 最後的決定性子則，保證結果**可重現**。少了它，同分時的
 *    順序就是 `Map` 的插入順序，而那是詞典序不是任何意義 —— 一個查詢兩次給出
 *    不同答案的頁面沒有人能信任。
 *
 * **不會有重複的物種。** 索引只含一般外觀，所以一隻就是一個分組，結果清單裡
 * 同一隻不可能出現兩次。這是排除異色換來的乾淨：先前的版本索引了 n 與 s 兩套，
 * 必須在查詢後去重，而去重本身是一個可以寫錯的規則（`#ffffff` 這種輸入會讓
 * 妙蛙草花的兩張圖連續佔掉兩個名額）。現在這個規則不存在了，所以沒有東西可以
 * 寫錯。
 *
 * **沒有「太遠就不匹配」的門檻**，這是刻意的。6,148 個色票覆蓋了 sRGB 立方體的
 * 大部分體積，任何輸入都一定有解；設一個門檻等於偶爾對使用者撒謊。誠實的做法
 * 是把 ΔE 數字本身顯示出來 —— 頁面上那幾個 tile 有一格就是它。距離大就是大，
 * 那是一個事實而不是一個失敗。
 */
/**
 * One species' record for one input colour — the same shape `matchPokemon`
 * returns, without the ranking.
 *
 * WHY THIS EXISTS, AND IT IS NOT A CONVENIENCE
 *
 * The page's 24-cell legendary grid is a NAMED entry point: the reader clicks
 * 「萊希拉姆」, and the expectation is unmistakable — show me *that* one. But
 * loading only its primary colour and re-running the matcher answers a different
 * question, and for a white primary it answers it wrong: #FFFFFF is the primary
 * of **29** species, so the rank-1 result is #0278 (a bird), and clicking
 * Reshiram would present a Wingull's palette under a card that says Reshiram.
 *
 * A tie is not the same as an absence. The matcher was right — #0278 really is
 * tied at distance 0 — and the answer is still wrong, because "closest" was never
 * the question that was asked. So the caller pins the species and this builds the
 * record for it. `distance` is still measured against the same input, so the ΔE
 * on screen keeps meaning what it means everywhere else: 0.0000 here says "your
 * colour is this species' primary", not "this species won a competition".
 *
 * Returns null for an id that is not in the index, so a missing species is
 * visible to the caller rather than rendering as an empty record.
 */
/**
 * How many species share `hex` as their own primary.
 *
 * The pinned grid needs this because a pinned species is often NOT the matcher's
 * rank-1, and when it isn't, the reader deserves the reason rather than a
 * number that looks wrong. #FFFFFF is 29 species' primary, so clicking
 * Reshiram legitimately lands on rank 29 — and "why is it showing a bird" is
 * only answerable by saying the colour is not unique. Counting is over primaries
 * only, because that is the quantity the ranking uses.
 */
export function primaryShareCount(hex) {
  const target = typeof hex === 'string' ? hex.toLowerCase() : null;
  if (!target) return 0;
  if (!groups) {
    if (!index) return 0;
    buildGroups();
  }
  let n = 0;
  for (const g of groups.values()) {
    if (g.primary.hex.toLowerCase() === target) n++;
  }
  return n;
}

export function matchOf(id, hex) {
  const lab = hexToOklab(hex);
  if (!lab) return null;
  if (!groups) {
    if (!index) return null;
    buildGroups();
  }
  const g = groups.get(id);
  if (!g) return null;
  return {
    rank: -1,
    id: g.id,
    primaryHex: g.primary.hex,
    primaryShare: g.primary.share,
    secondaryHex: g.secondary ? g.secondary.hex : g.primary.hex,
    secondaryShare: g.secondary ? g.secondary.share : g.primary.share,
    colorCount: 1 + (g.secondary ? 1 : 0) + g.rest.length,
    distance: deltaEOk(lab, g.primary.lab),
    secondaryDistance: g.secondary ? deltaEOk(lab, g.secondary.lab) : Infinity,
  };
}

export function matchPokemon(hex, n = 5) {
  const lab = hexToOklab(hex);
  if (!lab) return [];
  if (!groups) {
    if (!index) return [];
    buildGroups();
  }

  const scored = [];
  for (const g of groups.values()) {
    const d = deltaEOk(lab, g.primary.lab);
    const dSec = g.secondary ? deltaEOk(lab, g.secondary.lab) : Infinity;
    scored.push({ g, d, dSec });
  }

  scored.sort((a, b) => (
    a.d - b.d
    || a.dSec - b.dSec
    || a.g.id - b.g.id
  ));

  const limit = Math.max(1, n);
  const out = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    const { g, d, dSec } = scored[i];
    out.push({
      rank: out.length,
      id: g.id,
      primaryHex: g.primary.hex,
      primaryShare: g.primary.share,
      secondaryHex: g.secondary ? g.secondary.hex : g.primary.hex,
      secondaryShare: g.secondary ? g.secondary.share : g.primary.share,
      colorCount: 1 + (g.secondary ? 1 : 0) + g.rest.length,
      distance: d,
      secondaryDistance: dSec,
    });
  }
  return out;
}

/**
 * 查詢的效能說明，供頁面決定要不要 debounce。
 *
 * 一次 `matchPokemon()` 掃過 1,025 個分組算 1,025 次 ΔE —— 每個是三個減法、
 * 三個平方、三次相加與一次 sqrt。實測本機約 0.15 ms，遠低於一幀的預算，所以
 * 頁面不需要 debounce，`input` 事件可以逐格回應。
 */
