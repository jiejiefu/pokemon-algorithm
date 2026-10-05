/**
 * 穿搭照片 → 遮罩像素。這是 `outfit.html` 唯一自己寫的那一層。
 *
 * `assets/js/mmcq.js` 不知道自己有兩種用途，「算寶可夢的色盤」和「算穿搭的色盤」
 * 餵給它的是同一個函式。這個檔案存在的理由是：喂給它之前，得先決定**哪些像素算
 * 數**，而兩種餵法的遮罩來源完全不同 —— 寶可夢是 sprite 自己的 alpha，穿搭是讀者
 * 點的地方。遮罩之後的每一行都共用，遮罩這一段不共用。
 *
 * 「點一下就完成」的取色方式，以及它為什麼要能被看見
 * -------------------------------------------------
 *
 * 一個圓盤取樣最誠實的問題是：**圓盤壓到衣物邊緣時會混進背景，而沒有任何門檻能乾淨
 * 分開兩者。** 這不是推測，是量出來的。同一套 MMCQ 產生的單一 sprite 內部，兩色
 * 之間的 ΔE_OK 分位數是 p10 0.118 / p50 0.252 / p90 0.476（最大 0.858）；而一塊衣物
 * 與其背景之間是 0.37–0.60。**兩個分布重疊** —— 深紅配石板底是 0.367，低於
 * 同一件衣服自己的 p90。所以「把背景濾掉」這句話在任何門檻下都是不成立的。
 *
 * 因此這個模組不宣稱去背。它做兩件可被檢查的事：
 *
 * 1. 用一個**中位數**當中心（不是平均 —— 平均會被背景拉走，而圓盤剛好壓到邊緣正是
 *    平均失效的時候），把離它太遠的像素丟掉。
 * 2. **把留下來的像素交回去給頁面畫出來。** 讀者看得到我們量了什麼，這比一個看不見
 *    的啟發式規則誠實得多 —— 門檻猜錯時，畫面會自己說出來。
 *
 * 每個圓盤貢獻同樣數目的像素
 * --------------------------
 *
 * 整身穿搭模式下，每個點擊的圓盤取**同樣數目**的像素。理由是可見的：一件外套在照片
 * 上佔的像素是鞋子���五倍，所以按原比例餵進去，答案其實是「你的外套多大」，而不是
 * 「你穿什麼顏色」。
 *
 * 這個規則有代價，而且代價是真的：被裁到最少的那個圓盤決定了每個圓盤的取樣上限，
 * 所以一個點得很差的圓盤會拉低整組的取樣量。這是刻意的取捨而不是疏漏 —— 一個會
 * 自己適應的取樣量（對少的圓盤重複抽樣）會**捏造**顏色分布，而捏造出來的占比會看起來
 * 和量出來的一樣。寧可少拿一點，也不要假裝。
 *
 * 「不能平均」
 * ----------
 *
 * 這裡沒有任何地方把顏色平均掉。`OUTLIER_DELTA` 是**排除**離群值而不是求平均，
 * 均值與中位數都只在「決定哪些像素算數」這一步出現，而那一步的輸出還是一組個別的
 * 像素。MMCQ 收到的仍然是像素，不是色票。
 */

// ---------------------------------------------------------------------------
// 取樣參數
// ---------------------------------------------------------------------------

/**
 * 工作解析度的長邊上限。
 *
 * 512 不是為了畫質 —— MMCQ 的直方圖只有 5-bit（每通道 32 階），畫素再細也不會讓它
 * 多看見一個格子。放大只換來**空間**精度，也就是圓盤落在哪裡。512 讓 96px 的 sprite
 * 尺度有四倍的線性餘裕，1,025 隻寶可夢的色盤仍然和穿搭用同一把尺子。
 */
export const WORKING_LONG_EDGE = 512;

/**
 * 圓盤半徑 = 短邊的這個比例，並夾在 [DISC_MIN_PX, DISC_MAX_PX]。
 *
 * 用比例而不是絕對像素，是因為同一張照片可能以任何尺寸進來；用夾上下限，是因為
 * 0.05 × 短邊在一張 4000px 的照片上是 200px 的圓盤，那已經把整個人圈進去了。
 */
export const DISC_FRACTION = 0.05;
export const DISC_MIN_PX = 12;
export const DISC_MAX_PX = 64;

/**
 * 離群門檻，ΔE_OK。
 *
 * 量出來的（見上方模組註解）：同一件衣物自己內部的色差 p10 0.118 / p50 0.252，
 * 衣物對背景 0.37–0.60。0.18 落在「保留布料的明暗」與「丟掉明顯不同的東西」之間，
 * 刻意**偏保守** —— 寧可留著一些背景像素讓讀者看見，也不要把真正屬於布料的顏色
 * 當成背景丟掉。
 *
 * 這個數字沒有對應一個乾淨的分界，所以它不是「正確值」，而是一個**寫下來**的值。
 * 檢查器釘住它，而頁面把它連同「量到的像素」一起顯示，所以它被改動時讀者看得見。
 */
export const OUTLIER_DELTA = 0.18;

/**
 * 一個圓盤至少要留下這麼多像素，否則視為這一點沒點到東西。
 *
 * 低於這個數量時回傳 null 而不是硬擠出六個顏色：MMCQ 對兩個像素也能跑，而回傳一個
 * 每次都不一樣的「六色」比明說「這一點沒量到東西」更糟。
 */
export const MIN_KEEP = 24;

/** 一次最多接受幾個點擊。每多一點，讀者要重量的衣服就多一件。 */
export const MAX_CLICKS = 5;

/**
 * 整身穿搭模式取樣圓盤時要從**每一個**圓盤取的像素數。
 *
 * 0 表示「取最少的那個圓盤實際留下的數量」，那個數量由每一輪實際量到的結果決定。
 */
export const EQUAL_PER_DISC = 0;

// ---------------------------------------------------------------------------
// 尺寸
// ---------------------------------------------------------------------------

/** 等比縮到長邊 ≤ `longEdge`，回傳 { width, height }，至少 1×1。 */
export function fitWorkingSize(width, height, longEdge = WORKING_LONG_EDGE) {
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

/** 圓盤半徑（像素），依影像短邊而定，並夾在文件註解寫的上下限之間。 */
export function discRadius(width, height) {
  const short = Math.min(width, height);
  const raw = short * DISC_FRACTION;
  return Math.max(DISC_MIN_PX, Math.min(DISC_MAX_PX, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// 遮罩
// ---------------------------------------------------------------------------

/**
 * 一個圓盤的像素座標，含邊界內的點。
 *
 * 回傳的是**座標**而不是顏色，因為頁面要把兩件事分開做：這裡決定「哪裡算數」，
 * 那裡（讀 `ImageData`）決定「那些像素是什麼顏色」。合成一個函式的話，之後要畫
 * 取樣結果就得多一份顏色資料，而那正是這個模組刻意不持有的東西。
 */
export function discCoordinates(width, height, cx, cy, radius) {
  const out = [];
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) out.push([x, y]);
    }
  }
  return out;
}

/**
 * 一組座標的外框。
 *
 * **輸入是一個扁平的 `[x, y]` 陣列，不是「多組座標的陣列」。** 這個區別值得寫下來，
 * 因為第一版簽的是 `boundsOf(sets)` 並在內層 `for (const [x, y] of set)` —— 頁面
 * 傳進去的是 `samples.flatMap(s => s.kept)`，於是第一個元素是 `[x, y]` 而不是一組
 * 座標，解構整數時拋出 `.for is not iterable`。整個 render() 中斷，而被丟掉的是
 * 「第一次點擊」那條路徑上的所有東西。
 *
 * 這個形狀差異正好是 §3.G 記錄的那一類：一個函式的參數形狀錯了不會擲出可讀的訊息，
 * 它擲出的是下游某一行的 TypeError，而真正的原因在兩個函式之外。
 *
 * 這個外框是「sprite 要擺在哪裡」的答案，而且它是**免費**的：人物佔住的位置就是被
 * 量到的那團像素，所以寶可夢可以擺在外框之外，讀者的臉不會被擋住。一個沒有遮罩的
 * 版本只能靠把 sprite 塞到角落來猜，而那個角落有一半機率壓在人身上。
 */
export function boundsOf(coords) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of coords) {
    // A coordinate pair is a 2-element array. Destructuring it blindly would
    // throw on a 3-element row, and this function is called from a page with
    // hand-built fixture data, so the shape is checked rather than assumed.
    if (!Array.isArray(c) || c.length < 2) continue;
    const [x, y] = c;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// 顏色統計
// ---------------------------------------------------------------------------

/**
 * OKLab 三元組的**逐座標中位數**。
 *
 * 為什麼是中位數不是平均：這個模組唯一的使用情境就是「圓盤壓到衣物邊緣」，而那正是
 * 平均值失效的情況 —— 布佔七成、背景佔三成時，平均出來的顏色偏向背景，而那個顏色在
 * 圖上任何一個地方都不存在。中位數不動，它停在七成的那一邊，於是離群值檢查的中心
 * 點是**圖上真的有的顏色**。
 *
 * **但這不代表中位數比平均更適合每一種情況，而把它說成更適合是這段註解一度寫錯的
 * 地方。** 兩種顏色**各佔一半**時，中位數正好落在正中間，和平均完全一樣 —— 它們在
 * 對稱的分佈上必然一致。差別只在不對稱的時候出現。`check_outfit_page.mjs` 因此是拿
 * 20/80 的分佈去斷言，不是拿 50/50：50/50 的案例兩個函數都會通過，而它假裝成一個
 * 穩健性的證明。
 *
 * 逐座標而不是在 OKLab 空間裡找最近的中位點，是因為後者要解一個最佳化問題，而這個
 * 模組的職責是「用一個能被說明的規則決定哪些像素算數」，不是「用最好的演算法猜主色」。
 * 逐座標的三個軸**各自獨立**，所以它產生的中心有可能不是任何一個真實像素的顏色 ——
 * 那個候選是它變得不夠誠實的時候，而 `sampleDisc()` 保留整個圓盤而不是只留離中心
 * 最近的像素，正是為了讓邊緣像素有機會進來。
 */
export function medianOklab(labs) {
  if (!labs.length) return null;
  const axes = [[], [], []];
  for (const lab of labs) {
    axes[0].push(lab[0]);
    axes[1].push(lab[1]);
    axes[2].push(lab[2]);
  }
  return axes.map((axis) => {
    axis.sort((a, b) => a - b);
    const mid = axis.length >> 1;
    // 偶數個時取中間兩個的平均；這個平均是**排序後的位置**上的，不是顏色的平均。
    return axis.length % 2 ? axis[mid] : (axis[mid - 1] + axis[mid]) / 2;
  });
}

// ---------------------------------------------------------------------------
// 取樣
// ---------------------------------------------------------------------------

/**
 * 從 `imageData` 的 (cx, cy) 取一個圓盤，回傳留下了哪些像素。
 *
 * `imageData` 必須已經是**工作解析度**（`fitWorkingSize()` 的結果）且座標與之一致
 * —— 頁面縮放顯示時呼叫端負責把 CSS 座標換算回這張圖的座標，因為只有頁面知道顯示
 * 尺寸，而模組不該知道顯示這件事。
 *
 * @returns {{pixels: Array<[number,number,number]>, kept: Array<[number,number]>,
 *            radius: number, rejected: number} | null}
 *   `null` 表示這一點沒量到東西（見 MIN_KEEP）。**回傳 null 而不是空物件**，因為
 *   「點空了」和「量到一種顏色」在呼叫端是兩件必須看得見的事。
 */
export function sampleDisc(imageData, cx, cy, { oklab, radius } = {}) {
  const { width, height, data } = imageData;
  const coords = discCoordinates(width, height, cx, cy, radius);
  if (!coords.length) return null;

  // 先把圓盤裡的像素和它們的 OKLab 座標配對取出來。α 一律當不透明：照片的形狀是
  // 遮罩決定的，不是透明度決定的，而 `mmcq.js` 收到的像素也沒有 α 這個維度。
  const found = [];
  for (const [x, y] of coords) {
    const i = (y * width + x) * 4;
    if (data[i + 3] === 0) continue;
    found.push({
      xy: [x, y],
      rgb: [data[i], data[i + 1], data[i + 2]],
      lab: oklab([data[i], data[i + 1], data[i + 2]]),
    });
  }
  if (!found.length) return null;

  const centre = medianOklab(found.map((f) => f.lab));
  const kept = [];
  const pixels = [];
  for (const f of found) {
    const dl = f.lab[0] - centre[0];
    const da = f.lab[1] - centre[1];
    const db = f.lab[2] - centre[2];
    if (Math.sqrt(dl * dl + da * da + db * db) > OUTLIER_DELTA) continue;
    kept.push(f.xy);
    pixels.push(f.rgb);
  }

  if (pixels.length < MIN_KEEP) return null;
  return { pixels, kept, radius, rejected: found.length - pixels.length };
}

/**
 * 把每個圓盤裁到同樣數目的像素，再接成一個集合。
 *
 * 見模組註解「每個圓盤貢獻同樣數目的像素」。`perSet` 傳 0 表示取各圓盤的最小值；
 * 傳正數則是不超過該數量（每個圓盤各自能給多少就給多少，都不超過它）。兩種都不會
 * **重複抽樣**，所以輸出裡沒有任何一個顏色的占比是被捏造出來的。
 */
export function equalise(samples, perSet = EQUAL_PER_DISC) {
  if (!samples.length) return [];
  const smallest = samples.reduce((a, s) => Math.min(a, s.pixels.length), Infinity);
  const limit = perSet > 0 ? perSet : smallest;
  const out = [];
  for (const s of samples) {
    for (let i = 0; i < Math.min(limit, s.pixels.length); i++) out.push(s.pixels[i]);
  }
  return out;
}