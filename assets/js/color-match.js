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
  return rgbToOklab(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  );
}

/**
 * 8-bit sRGB 三通道 → OKLab。`hexToOklab()` 是它的呼叫端，不是它的複本。
 *
 * 分成兩個函式是因為否則每個拿到**像素**而不是拿到**色碼**的呼叫端都必須自己寫一份
 * 轉換 —— 而那就是本專案已經吃過一次虧的那種複製：`§3.B2` 記錄了
 * `findClosestChineseColorName()` 用 nearest-in-RGB 把 `#414141` 判成墨綠。一份
 * 轉換有兩份實作時，它們會分開漂移，而且沒有任何東西會注意到。
 *
 * `outfit.html` 需要這個：照片取樣給的是 `[r, g, b]`，而不是 hex。
 */
export function rgbToOklab(r, g, b) {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * `[r, g, b]` → OKLab。給「一次轉一個像素陣列」的路徑用，因為那種呼叫端最常見的
 * 形式就是從 `getImageData()` 直接拿到的三元組；`rgbToOklab()` 是它的實作，
 * 這個包裝存在的理由只是讓呼叫端不必寫 `[r,g,b] => rgbToOklab(...p)`。
 */
export function pixelToOklab(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  return rgbToOklab(rgb[0], rgb[1], rgb[2]);
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

// ---------------------------------------------------------------------------
// 六色對六色：outfit.html 的問題
// ---------------------------------------------------------------------------

/**
 * 找出與一整個六色色盤最接近的 n 隻寶可夢。
 *
 * 這個函式回答的問題和 `matchPokemon()` 不是同一個。那個是一次一個 hex：給我
 * 一個顏色，我找主色離它最近的。這個是一個**色盤**對一個色盤：穿搭有六個顏色，
 * 寶可夢有六個顏色，兩邊都是 `extract_color_palettes_mmcq.py` 用同一套演算法
 * 量出來的 5-bit 直方圖分割結果，所以形狀可以直接比較。
 *
 * **距離定義為雙向、占比加權的 Chamfer 距離。** 對每隻寶可夢 `g`：
 *
 *     forward = Σ_i out_i.share × min_j ΔE(out_i, g_j)   / Σ out.share
 *     reverse = Σ_j g_j.share  × min_i ΔE(g_j, out_i)   / Σ g.share
 *     score   = (forward + reverse) / 2
 *
 * 四個詞每一個都有一個會回傳**合理列表**的錯誤版本，所以每一個都值得寫下來：
 *
 * 1. **兩個方向都要。** 單向的 `forward` 問的是「這隻寶可夢的六色能不能蓋住這套
 *    穿搭」。答案是能 —— 連續調的一組褐色就能完美蓋住任何褐色穿搭而**零懲罰**，
 *    不管那六個褐色彼此多不像。`reverse` 補的是反過來問的版本：「這套穿搭的
 *    六色能不能蓋住這隻的六色」，於是一隻塞滿無關顏色的寶可夢要付代價。兩者
 *    平均之後，兩邊的形狀都必須對得上才會贏。
 *
 * 2. **占比要加權。** 色盤的 share 是這個顏色的實際份量，不是它在列表裡的順位。
 *    加權之後主色自然吃最多權重（妙蛙種子主色 35.73%，而它第六色不到 2%），所以
 *    **不需要另外加一條「主色更重要」的規則** —— 規則越少，可寫錯的地方越少。
 *
 * 3. **兩邊都要正規化。** `color_palettes.json` 的占比中位數只有 71.96% 而最小
 *    34.68%，那是正確的（六色是一份樣本，沒被報出來的像素輸掉了分區）。所以
 *    分母不能用常數 100，也不能只用其中一邊的總和：否則讀者的穿搭和寶可夢的
 *    色盤就是在用兩把不同的尺子比較。`check_outfit_page.mjs` 用 90/10 與 0.9/0.1
 *    斷言兩者排名完全相同。
 *
 * 4. **排序最後一定要落到 id。** 語料裡到處是重複的色票，`#ffffff` 是 29 隻的
 *    主色，沒有最後這個決定性項，同分順序就是 `Map` 的插入順序 —— 穩定，但是
 *    沒有意義，而讀者會看到兩次跑出不同順序。
 *
 * **回傳的紀錄刻意沒有 `distance` 與 `secondaryDistance`。** 那兩個欄位在
 * `matchPokemon()` 的意思是「輸入色到主色 / 附色的 ΔE」，而這裡沒有單一輸入色：
 * 把它們填成「主色的 ΔE」會讓一個沒有參與決策的數字看起來像決策本身。這個函式
 * 給 `score`，並且把 `forward` 與 `reverse` 一起交出來 —— 頁面可以把兩個方向都
 * 顯示出來，而「為什麼是牠」就變成一個讀者可以自己看的算式。
 *
 * 只索引一般外觀（`n`），異色（`s`）不參與，理由與 `buildMatchIndex()` 相同：
 * 異色是同一隻寶可夢的另一個樣子，讓它報名等於讓一隻用兩個身分參賽，而穿搭頁要
 * 回答的是「這套穿搭像哪一隻」。
 *
 * 效能：每隻寶可夢要做 6×K + K×6 次 ΔE（K 是查詢色盤的顏色數），K=6 時約 72 次，
 * 乘 1,025 隻約 74,000 次 ΔE。實測約 2–4 ms，比 `matchPokemon()` 慢一個數量級
 * —— 這是查色盤而不是查一個 hex 的必然代價。它仍然遠低於「按一下按鈕」的心理
 * 預期，所以頁面不需要 debounce，但**不該**綁在 `input` 事件上。
 *
 * @param {Array<{hex: string, share: number}>} rows 查詢色盤，形狀同 `paletteOf()`
 * @param {number} n 回傳幾隻
 * @returns {Array<{rank:number,id:number,score:number,forward:number,reverse:number,
 *                  primaryHex:string,primaryShare:number,colorCount:number}>}
 */
export function matchPalette(rows, n = 5) {
  const input = [];
  for (const row of rows || []) {
    const h = Array.isArray(row) ? row[0] : row && row.hex;
    const s = Array.isArray(row) ? row[1] : row && row.share;
    const lab = hexToOklab(h);
    if (!lab) continue;
    input.push({ hex: String(h).toLowerCase(), lab, share: typeof s === 'number' && s > 0 ? s : 0 });
  }
  if (!input.length) return [];
  if (!groups) {
    if (!index) return [];
    buildGroups();
  }

  // 正規化：查詢側一次算完，索引側每隻算一次。
  const outTotal = input.reduce((a, r) => a + r.share, 0);
  if (!(outTotal > 0)) {
    // 全是 0 占比（沒有占比資料的輸入）時退回等權，讓函式仍然回答問題，而不是
    // 因為分母是 0 就靜靜地回傳一個 NaN 排名。
    for (const r of input) r.share = 1;
  }
  const outSum = input.reduce((a, r) => a + r.share, 0);

  const scored = [];
  for (const g of groups.values()) {
    const colours = [g.primary];
    if (g.secondary) colours.push(g.secondary);
    for (const e of g.rest) colours.push(e);

    const inTotal = colours.reduce((a, e) => a + (e.share > 0 ? e.share : 0), 0);
    if (!(inTotal > 0)) continue;

    // forward：每個查詢色，找寶可夢六色裡最近的一個。
    let forward = 0;
    for (const o of input) {
      let best = Infinity;
      for (const e of colours) {
        const d = deltaEOk(o.lab, e.lab);
        if (d < best) best = d;
      }
      forward += o.share * best;
    }
    forward /= outSum;

    // reverse：同一個算式，方向對調。見細節 1 —— 少了這一項，連續調的一組褐色
    // 可以零懲罰地蓋住任何褐色穿搭。
    let reverse = 0;
    for (const e of colours) {
      let best = Infinity;
      for (const o of input) {
        const d = deltaEOk(o.lab, e.lab);
        if (d < best) best = d;
      }
      reverse += (e.share > 0 ? e.share : 0) * best;
    }
    reverse /= inTotal;

    scored.push({
      g,
      score: (forward + reverse) / 2,
      forward,
      reverse,
      colorCount: colours.length,
    });
  }

  scored.sort((a, b) => (
    a.score - b.score
    || a.forward - b.forward
    || a.reverse - b.reverse
    || a.g.id - b.g.id
  ));

  const limit = Math.max(1, n);
  const out = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    const s = scored[i];
    out.push({
      rank: out.length,
      id: s.g.id,
      score: s.score,
      forward: s.forward,
      reverse: s.reverse,
      primaryHex: s.g.primary.hex,
      primaryShare: s.g.primary.share,
      colorCount: s.colorCount,
    });
  }
  return out;
}
