/**
 * MMCQ 分區 + snap_to_real — `extract_color_palettes_mmcq.py` 的執行期對應物。
 *
 * 這個檔案是為了 `outfit.html` 而存在的，但它的內容不是為穿搭而寫的：它是
 * `scripts/extract_color_palettes_mmcq.py` 那個建置期抽取器的**逐字轉錄**，加
 * 上同一支程式裡的 `snap_to_real()`。兩者回答同一個問題 ——
 *
 *     給定一組像素與六個槽位，這六個顏色是什麼？
 *
 * 而「哪一隻寶可夢」與「哪一套穿搭」只是那個問題的兩個餵法。寶可夢餵的是
 * sprite 自己 `alpha ≥ 200` 的像素（透明背景被濾掉），穿搭餵的是遮罩裡的衣物
 * 像素。**遮罩之後的每一行都相同**，所以這個模組不知道自己有兩種用途，而那
 * 是刻意的：讓「用同一套演算法算兩件事」成為一個可以被檢查的事實，而不是兩份
 * 看起來相似的實作。
 *
 * 為什麼是這支檔案而不是一個 npm 套件
 * ---------------------------------
 *
 * 我們需要的不是「量化」，是「把圖切成 N 個區域，並交出每個區域的**邊界**」。
 * `snap_to_real()` 的兩行核心就是拿邊界去問兩個問題：這個像素屬於哪一格、以及
 * 那一格裡最常見的**真實**像素是什麼。沒有任何套件會回傳邊界：
 *
 * - `color-thief`（npm 上那個，latest 2.2.5 / 2019）：`main` 是 CommonJS，
 *   零 ESM export；`dependencies` 含 native `canvas`，瀏覽器跑不動；`MMCQ` 是
 *   內部的，公開 API 吃圖不吃像素。
 * - `colorthief`（改名後那個，活躍維護中，v3.5.0）：`colorthief/internals`
 *   確實 export `MmcqQuantizer`，而且 `quantize(pixels, maxColors)` 正好吃
 *   `Array<[r,g,b]>`。但 `VBox` 是 `class VBox`，**沒有 export**，收尾是
 *   `results.push({ color: box.avg(), population: box.count() })` ——
 *   邊界在模組內被消費掉然後丟棄。
 *
 * 而那正是 `snap_to_real()` 存在的全部理由。`extract_color_palettes_mmcq.py`
 * 的 docblock 已經量過：在 2,050 張 sprite 上，MMCQ 回傳的 12,300 個顏色裡
 * **98.5% 根本不在圖裡**，最糟的一個離最近的真像素 101/255。分區是好的，離心
 * 是不能用的。丟掉離心的那一層是這個 repo 的，不是套件的。
 *
 * 所以這個檔案做兩件事，而且刻意分開：
 *
 * 1. `quantizeBoxes()` / `quantize()` — MMCQ 的轉錄，**逐字**對照
 *    `colorthief@3.5.0/src/quantizers/mmcq.ts`。轉錄的正誤不由本文檔保證，
 *    由 `scripts/check_outfit_page.mjs` 把它和那份檔案的 `MmcqQuantizer` 餵
 *    同一份像素陣列、斷言離心逐個相同來證明。
 * 2. `snapToReal()` — 本 repo 的那一層，也是兩件事唯一的差別。
 *
 * 常數與上游一致，不是巧合也不是自由發揮：`SIGBITS = 5`、`RSHIFT = 8 - SIGBITS`、
 * `MAX_ITERATIONS = 1000`、`FRACT_BY_POPULATIONS = 0.75`、
 * `HISTO_SIZE = 1 << (3 * SIGBITS)`。要對齊 `color_palettes.json` 就必須是這
 * 幾個數，改任何一個都會讓穿搭色盤和 1,025 隻的色盤用不同的尺子在算。
 *
 * 純模組：沒有 DOM、沒有 fetch、沒有 Web Audio。這是它能在 Node 底下被 import
 * 進 checker 的唯一原因，而那個能力撐著上面整段論證。
 */

// ---------------------------------------------------------------------------
// 常數：與 colorthief@3.5.0 / colorthief(python) 完全一致
// ---------------------------------------------------------------------------

const SIGBITS = 5;
const RSHIFT = 8 - SIGBITS;
const MAX_ITERATIONS = 1000;
const FRACT_BY_POPULATIONS = 0.75;
const HISTO_SIZE = 1 << (3 * SIGBITS);

// ---------------------------------------------------------------------------
// VBox — 5-bit 精度的三維盒子
// ---------------------------------------------------------------------------

function colorIndex(r, g, b) {
  return (r << (2 * SIGBITS)) + (g << SIGBITS) + b;
}

/**
 * 一個區域。
 *
 * 邊界 `r1..b2` 存的是 **5-bit 值**（已右移 RSHIFT），不是 8-bit 值。這個區別
 * 不是細節：`contains()` 會把傳入的 8-bit 通道右移後比較，兩邊的尺度必須一致，
 * 否則除了全黑全白以外每個像素都落在盒子外面。
 */
class VBox {
  constructor(r1, r2, g1, g2, b1, b2, histo) {
    this.r1 = r1;
    this.r2 = r2;
    this.g1 = g1;
    this.g2 = g2;
    this.b1 = b1;
    this.b2 = b2;
    this.histo = histo;
    this._volume = undefined;
    this._count = undefined;
    this._avg = undefined;
  }

  volume(force = false) {
    if (this._volume === undefined || force) {
      this._volume = (this.r2 - this.r1 + 1) * (this.g2 - this.g1 + 1) * (this.b2 - this.b1 + 1);
    }
    return this._volume;
  }

  /**
   * 盒子裡的像素數。
   *
   * 這是**盒子總體積的遍歷**，不是像素的數量 —— 盒子裡有大量 5-bit 格子是空的。
   * 迴圈的邊界就是這個方法慢的原因，也是 `iterate()` 每輪都重算的原因；快取
   * 只在盒子被切開（`force`）時失效。
   */
  count(force = false) {
    if (this._count === undefined || force) {
      let npix = 0;
      for (let i = this.r1; i <= this.r2; i++) {
        for (let j = this.g1; j <= this.g2; j++) {
          for (let k = this.b1; k <= this.b2; k++) {
            npix += this.histo[colorIndex(i, j, k)] || 0;
          }
        }
      }
      this._count = npix;
    }
    return this._count;
  }

  copy() {
    // 共享 histo：快照不是深拷貝，盒子切開時兩邊都讀同一份直方圖，而直方圖從頭
    // 到尾沒有被寫過。
    return new VBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.histo);
  }

  /**
   * 盒子的加權平均色 —— **這是我們要丟掉的那個數字。**
   *
   * 5-bit 精度下的量質平均，所以它是量化格子的離心，不是圖裡真的存在的顏色。
   * `snapToReal()` 存在的理由就是換掉它。留在這裡是為了讓 port-fidelity 檢查
   * 能把它和 `colorthief@3.5.0` 的輸出逐個比對。
   */
  avg(force = false) {
    if (this._avg === undefined || force) {
      const mult = 1 << RSHIFT;

      // 單色盒子：回傳精確色，不要走下面的平均。
      if (this.r1 === this.r2 && this.g1 === this.g2 && this.b1 === this.b2) {
        this._avg = [this.r1 << RSHIFT, this.g1 << RSHIFT, this.b1 << RSHIFT];
      } else {
        let ntot = 0;
        let rsum = 0;
        let gsum = 0;
        let bsum = 0;

        for (let i = this.r1; i <= this.r2; i++) {
          for (let j = this.g1; j <= this.g2; j++) {
            for (let k = this.b1; k <= this.b2; k++) {
              const hval = this.histo[colorIndex(i, j, k)] || 0;
              ntot += hval;
              rsum += hval * (i + 0.5) * mult;
              gsum += hval * (j + 0.5) * mult;
              bsum += hval * (k + 0.5) * mult;
            }
          }
        }

        if (ntot) {
          this._avg = [~~(rsum / ntot), ~~(gsum / ntot), ~~(bsum / ntot)];
        } else {
          this._avg = [
            ~~((mult * (this.r1 + this.r2 + 1)) / 2),
            ~~((mult * (this.g1 + this.g2 + 1)) / 2),
            ~~((mult * (this.b1 + this.b2 + 1)) / 2),
          ];
        }
      }
    }
    return this._avg;
  }

  /**
   * 這個 8-bit 顏色在盒子裡嗎。
   *
   * `color-thief` 2.x 有這個方法，`colorthief@3.5.0` 刪掉了（它不需要知道哪些像素
   * 屬於哪一格），而我們需要 —— `snapToReal()` 的整個分區步驟就是靠它。參照
   * `colorthief` 的 Python 版：`VBox.contains(pixel)` 同樣是把三個通道右移
   * RSHIFT 後再比較。
   */
  contains(r, g, b) {
    const rv = r >> RSHIFT;
    const gv = g >> RSHIFT;
    const bv = b >> RSHIFT;
    return rv >= this.r1 && rv <= this.r2
      && gv >= this.g1 && gv <= this.g2
      && bv >= this.b1 && bv <= this.b2;
  }
}

// ---------------------------------------------------------------------------
// PQueue — 延遲排序的優先佇列
// ---------------------------------------------------------------------------

/**
 * 不是二元堆，是「push 時標記髒、讀取時才排序」的陣列。
 *
 * 抄上游是因為它在這個規模下真的夠用，而且**排序方向是承載語意的**：
 * comparator 回傳 `a - b`（升冪），`pop()` 取的是陣列尾端，所以 `pop()` 拿到的
 * 是 comparator 眼中**最大**的那個。改成 min-heap 的話這兩件事都要跟著改，而
 * 它們不是可以用重構去改的細節。
 */
class PQueue {
  constructor(comparator) {
    this.contents = [];
    this.sorted = false;
    this.comparator = comparator;
  }

  sort() {
    this.contents.sort(this.comparator);
    this.sorted = true;
  }

  push(item) {
    this.contents.push(item);
    this.sorted = false;
  }

  peek(index) {
    if (!this.sorted) this.sort();
    return this.contents[index === undefined ? this.contents.length - 1 : index];
  }

  pop() {
    if (!this.sorted) this.sort();
    return this.contents.pop();
  }

  size() {
    return this.contents.length;
  }
}

// ---------------------------------------------------------------------------
// 直方圖與起始盒子
// ---------------------------------------------------------------------------

/** 5-bit RGB 直方圖，`Uint32Array(32768)`。像素進來就已經決定好 8-bit→5-bit 的丟棄。 */
function buildHistogram(pixels) {
  const histo = new Uint32Array(HISTO_SIZE);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    histo[colorIndex(p[0] >> RSHIFT, p[1] >> RSHIFT, p[2] >> RSHIFT)]++;
  }
  return histo;
}

/**
 * 包住所有像素的起始盒子。
 *
 * **與兩個上游都不同的唯一一行。** `color-thief` 2.x 寫成
 * `if (rval > rmax) rmax = rval; else if (rval < rmin) rmin = rval;` ——
 * 單一顏色的圖會讓 `rmin` 停在初始的 1,000,000，得到一個 `r1 > r2` 的空盒子。
 * `colorthief@3.5.0` 把順序翻成先 `rmin`，於是同一個 bug 換成 `rmax` 停在 0。
 * 兩邊都在只有一種顏色時壞掉，而且是靜默地壞：`count()` 回傳 0，
 * `medianCutApply()` 直接回傳 undefined，`iterate()` 也就靜靜地什麼都不做。
 *
 * 一張純色穿搭（例如一件全黑 T 恤配純白背景）的遮罩，真的會是單一顏色，所以
 * 這個邊界不是假想的。上游的寫法不能照抄，但**行為必須和上游在 ≥2 種顏色時
 * 一致** —— `scripts/check_outfit_page.mjs` 用單色與雙色兩組像素各斷言一次。
 */
function initialVBox(pixels, histo) {
  const first = pixels[0];
  let rmin = first[0] >> RSHIFT;
  let rmax = rmin;
  let gmin = first[1] >> RSHIFT;
  let gmax = gmin;
  let bmin = first[2] >> RSHIFT;
  let bmax = bmin;

  for (let i = 1; i < pixels.length; i++) {
    const p = pixels[i];
    const rv = p[0] >> RSHIFT;
    const gv = p[1] >> RSHIFT;
    const bv = p[2] >> RSHIFT;
    if (rv < rmin) rmin = rv; else if (rv > rmax) rmax = rv;
    if (gv < gmin) gmin = gv; else if (gv > gmax) gmax = gv;
    if (bv < bmin) bmin = bv; else if (bv > bmax) bmax = bv;
  }

  return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
}

// ---------------------------------------------------------------------------
// Median cut
// ---------------------------------------------------------------------------

/**
 * 切一個盒子。回傳 `[左, 右]`，或 `[原盒, null]`（只有一個像素，切不開）。
 *
 * 切法是「沿著像素數最多的那一個軸，找中位數那一格」，但 `doCut` 裡那個
 * `~~(i + right / 2)` 的偏移是 MMCQ 的重點：它讓切口**不**落在中位數格，而是
 * 偏向讓兩邊的人口數量接近。抄錯這個偏移不會讓結果變色，只會讓分區的邊界往
 * 偏移，而邊界正是我們要的東西。
 */
function medianCutApply(histo, vbox) {
  if (!vbox.count()) return undefined;

  // 只有一個像素：切不開。
  if (vbox.count() === 1) return [vbox.copy(), null];

  // **體積為 1 的盒子同樣切不開，而這是唯一需要自己加的守衛。** 體積 1 代表盒子
  // 在三個軸上都沒有延展，也就是裡面只有一種 5-bit 顏色。這時 `doCut` 的偏移
  // 會算成 `d2 = Math.min(dim2 - 1, …)` = -1，接著 `vbox2[dim1] = vbox1[dim2] + 1`
  // = 1，於是第二個盒子拿到 dim1 = 1 > dim2 = 0 的**反轉邊界**。
  //
  // 上游沒遇到這個，是因為 `initialVBox` 的哨兵 bug 先讓 `count()` 回傳 0，
  // `medianCutApply` 在第一行就 return 了 —— 換句話說上游是**用錯誤的順序換來
  // 這個正確的結果**，而我們改了順序（見 `initialVBox` 的註解）就必須自己接住。
  // 這個守衛只在 `doCut` 本來就會產生反轉盒子時才會開火，所以對多色輸入是
  // 完全的 no-op。
  if (vbox.volume() === 1) return [vbox.copy(), null];

  const rw = vbox.r2 - vbox.r1 + 1;
  const gw = vbox.g2 - vbox.g1 + 1;
  const bw = vbox.b2 - vbox.b1 + 1;
  const maxw = Math.max(rw, gw, bw);

  let total = 0;
  const partialsum = [];
  const lookaheadsum = [];

  if (maxw === rw) {
    for (let i = vbox.r1; i <= vbox.r2; i++) {
      let sum = 0;
      for (let j = vbox.g1; j <= vbox.g2; j++) {
        for (let k = vbox.b1; k <= vbox.b2; k++) {
          sum += histo[colorIndex(i, j, k)] || 0;
        }
      }
      total += sum;
      partialsum[i] = total;
    }
  } else if (maxw === gw) {
    for (let i = vbox.g1; i <= vbox.g2; i++) {
      let sum = 0;
      for (let j = vbox.r1; j <= vbox.r2; j++) {
        for (let k = vbox.b1; k <= vbox.b2; k++) {
          sum += histo[colorIndex(j, i, k)] || 0;
        }
      }
      total += sum;
      partialsum[i] = total;
    }
  } else {
    for (let i = vbox.b1; i <= vbox.b2; i++) {
      let sum = 0;
      for (let j = vbox.r1; j <= vbox.r2; j++) {
        for (let k = vbox.g1; k <= vbox.g2; k++) {
          sum += histo[colorIndex(j, k, i)] || 0;
        }
      }
      total += sum;
      partialsum[i] = total;
    }
  }

  // 稀疏陣列：`partialsum.forEach` 只走有指派過的索引，而沒走到的格子的
  // `partialsum[i]` 是 undefined。下面 `while (!partialsum[d2]) d2++` 正是靠這個
  // undefined 跳過空格子 —— 這不是巧合，是 `partialsum` 必須是稀疏陣列的原因。
  partialsum.forEach((d, i) => {
    lookaheadsum[i] = total - d;
  });

  function doCut(color) {
    const dim1 = color + '1';
    const dim2 = color + '2';

    for (let i = vbox[dim1]; i <= vbox[dim2]; i++) {
      if (partialsum[i] > total / 2) {
        const vbox1 = vbox.copy();
        const vbox2 = vbox.copy();
        const left = i - vbox[dim1];
        const right = vbox[dim2] - i;

        let d2;
        if (left <= right) {
          d2 = Math.min(vbox[dim2] - 1, ~~(i + right / 2));
        } else {
          d2 = Math.max(vbox[dim1], ~~(i - 1 - left / 2));
        }

        // 避免切出 0 像素的盒子。
        while (!partialsum[d2]) d2++;
        let count2 = lookaheadsum[d2];
        while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];

        vbox1[dim2] = d2;
        vbox2[dim1] = vbox1[dim2] + 1;

        return [vbox1, vbox2];
      }
    }
    return undefined;
  }

  if (maxw === rw) return doCut('r');
  if (maxw === gw) return doCut('g');
  return doCut('b');
}

/** 反覆取人口最多的盒子切開，直到數量到 target 或沒有盒子能切。 */
function iterate(pq, target, histo) {
  let ncolors = pq.size();
  let niters = 0;

  while (niters < MAX_ITERATIONS) {
    if (ncolors >= target) return;
    niters++;

    const vbox = pq.pop();

    // 人口為 0 的盒子放回去重試，不是丟掉。丟掉會讓數量提早到達 target，而
    // target 是按人口切的，不是按「有多少個不空的盒子」。
    if (!vbox.count()) {
      pq.push(vbox);
      continue;
    }

    const result = medianCutApply(histo, vbox);
    if (!result || !result[0]) return;

    pq.push(result[0]);
    if (result[1]) {
      pq.push(result[1]);
      ncolors++;
    }
  }
}

// ---------------------------------------------------------------------------
// 公開的量化入口
// ---------------------------------------------------------------------------

/**
 * MMCQ：把像素切成 `maxColors` 個區域，並回傳**區域的邊界**。
 *
 * 這是那個沒有套件會做的函式。`colorthief@3.5.0` 的 `MmcqQuantizer.quantize()`
 * 只回傳 `{ color, population }`，邊界在它內部被消費掉；我們需要邊界是因為
 * `snapToReal()` 要靠它決定「每個像素歸哪一格」，以及「那一格裡最常見的真實
 * 像素是什麼」。
 *
 * 回傳陣列的順序是 `PQueue` 彈出的順序，也就是**人口 × 體積遞減**的結束順序
 * （Phase 2 用那個 comparator）。`snapToReal()` 不依賴這個順序 —— 它自己會重
 * 排 —— 但回傳它的邊界是誠實的，不是無意義的。
 *
 * @param {Array<[number,number,number]>} pixels 8-bit RGB 三元組
 * @returns {VBox[]} 長度 ≤ `maxColors`
 */
export function quantizeBoxes(pixels, maxColors = 6) {
  if (!pixels || !pixels.length || maxColors < 2 || maxColors > 256) return [];

  const histo = buildHistogram(pixels);
  const pq = new PQueue((a, b) => a.count() - b.count());
  pq.push(initialVBox(pixels, histo));

  // Phase 1：純按人口切到 FRACT_BY_POPULATIONS * maxColors（0.75 * 6 = 4.5）。
  iterate(pq, FRACT_BY_POPULATIONS * maxColors, histo);

  // Phase 2：換 comparator 為「人口 × 體積」繼續切到 maxColors。**兩個階段
  // 用不同的度量，這是 MMCQ 的名字裡那個 M 的由來**，不是可以合併的兩段。
  const pq2 = new PQueue((a, b) => a.count() * a.volume() - b.count() * b.volume());
  while (pq.size()) pq2.push(pq.pop());
  iterate(pq2, maxColors, histo);

  const boxes = [];
  while (pq2.size()) boxes.push(pq2.pop());
  return boxes;
}

/**
 * MMCQ 的離心輸出 —— **只給 port-fidelity 檢查用，頁面不呼叫。**
 *
 * 存在的原因是可驗證性而不是方便：`scripts/check_outfit_page.mjs` 把它和
 * `colorthief@3.5.0` 的 `MmcqQuantizer` 餵同一份像素陣列，斷言每一個離心
 * 逐通道相同。那就是「這份轉錄沒有改動演算法」的證據（§3.F 的做法：拿參考
 * 實作自己的輸出來比，而不是拿它的描述來比）。
 *
 * 而比較能夠成立，是因為 `quantizeBoxes()` 和這個函式共用同一段程式碼 ——
 * 一個自寫的 port 若沒有這樣的對照點，就只是另一份看起來合理的實作。
 */
export function quantize(pixels, maxColors = 6) {
  const boxes = quantizeBoxes(pixels, maxColors);
  const out = [];
  for (const box of boxes) {
    out.push({ color: box.avg(), population: box.count() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// snap_to_real — 本 repo 那一層，也是兩件事唯一的差別
// ---------------------------------------------------------------------------

const hexOf = (r, g, b) => (
  '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0')
);

/**
 * 分區，每一區換成它裡最常見的**真實**像素。
 *
 * 這是 `extract_color_palettes_mmcq.py:127` 的 `snap_to_real()` 的轉錄。四個
 * 決定性的細節，每一個寫錯都不會報錯、只會讓穿搭色盤和 `color_palettes.json`
 * 悄悄使用不同的定義：
 *
 * 1. **占比取自全域直方圖，永遠不是區域大小。** `histogram[colour] / total`。
 *    這不是細節：一個區域的像素數和它最終顏色的占比是兩個數字，而且可以差很
 *    遠。妙蛙種子上由 `#399494` 拿下的那個區域，同時含所有 `#184a4a` 和
 *    `#317373` 的像素。用區域占比會讓 `#399494` 報 29.40%，而六個占比加起來
 *    是 131.28% —— 超過 100%，因為補位的那一輪數到了已經被數過的像素。
 *    **占比是顏色的性質，所以要從全域直方圖算。**
 *
 * 2. **代表色平手時由 RGB 三元組升序決定**，不是由插入順序。上游註解寫得很
 *    直接：只按占比排，相同占比的顏色順序就是 `set` 產生的順序，而字串的 set
 *    迭代順序跟著 `PYTHONHASHSEED` 走 —— 檔案每次跑出來不同，跑起來看起來
 *    卻一模一樣。
 *
 * 3. **占比相加 < 100% 是正確的，不是 bug。** 六個顏色是一份樣本，沒被報出來的
 *    像素就是輸掉分區的那些。整個 `color_palettes.json` 的占比中位數是 71.96%，
 *    最小 34.68%。所以穿搭色盤的占比也不會加到 100%，而頁面不應該假裝它會。
 *
 * 4. **補位之後要重排。** 空的區域會少掉一個代表色，於是補位可以塞進一個比它
 *    換掉的那個大得多的顏色。妙蛙種子異色有 6 個盒子但只有 5 個非空區域，
 *    第六格被補上未見過的最大色 `#316220`（10.20%），接在 `#005a00`（2.91%）
 *    後面。不重排就不是占比降序，`check_color_palettes.mjs` 會紅。
 *
 * @param {Array<[number,number,number]>} pixels 已經濾過的像素（見 outfit-palette.js）
 * @param {number} colorCount 槽位數。寶可夢色盤是 6。
 * @returns {Array<{hex: string, share: number}>} 占比降序，share 是百分比
 */
export function snapToReal(pixels, colorCount = 6) {
  if (!pixels || !pixels.length) return [];
  const total = pixels.length;

  // 全域直方圖：像素 → 次數。
  const histogram = new Map();
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const key = (p[0] << 16) | (p[1] << 8) | p[2];
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }

  // 占比表。key 是打包的整數，所以要先展開成 hex 才能排 —— 排序鍵是 hex 字串，
  // 不是那個整數（見細節 2）。
  const shares = new Map();
  for (const [key, count] of histogram) {
    shares.set(key, (count / total) * 100);
  }

  const boxes = quantizeBoxes(pixels, colorCount);
  const regions = boxes.map(() => []);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    let assigned = false;
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].contains(p[0], p[1], p[2])) {
        regions[b].push(p);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      // 實務上不可達：MMCQ 的盒子是從這些像素本身推導出來的，所以每個像素至少
      // 落在其中一個裡。留著是為了讓區域總數維持等於 total，而不是靜靜地丟棄
      // 像素並讓每個占比都膨脹。
      let nearest = 0;
      let bestDist = Infinity;
      for (let b = 0; b < boxes.length; b++) {
        const a = boxes[b].avg(true);
        const d = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2;
        if (d < bestDist) { bestDist = d; nearest = b; }
      }
      regions[nearest].push(p);
    }
  }

  const representatives = new Map();
  for (const region of regions) {
    // 空的區域不給代表色，於是色盤會低於 colorCount，由下面的補位填回去。
    if (!region.length) continue;

    // 區域內的直方圖。代表色 = 最多出現的真實像素。
    const local = new Map();
    for (let i = 0; i < region.length; i++) {
      const p = region[i];
      const key = (p[0] << 16) | (p[1] << 8) | p[2];
      local.set(key, (local.get(key) || 0) + 1);
    }

    // 平手由 RGB 三元組升序決定（細節 2）。`>>> 0` 是必要的：打包鍵最高可到
    // 0xffffff 是 16,777,215，還在正數範圍，但為了讓「升序」在任何鍵上都是
    // 同一個順序而不是「正負交錯的順序」，這裡顯式收斂成無號整數。
    let bestKey = null;
    let bestCount = -1;
    for (const [key, count] of local) {
      const k = key >>> 0;
      if (count > bestCount || (count === bestCount && (bestKey === null || k < bestKey))) {
        bestCount = count;
        bestKey = k;
      }
    }
    representatives.set(bestKey >>> 0, hexOf((bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff));
  }

  // 依占比排序，字串排序的每一層都是刻意的（細節 2）。
  const byShareThenHex = (a, b) => {
    const sa = shares.get(keyOfHex(a));
    const sb = shares.get(keyOfHex(b));
    if (sa !== sb) return sb - sa;
    return a < b ? -1 : a > b ? 1 : 0;
  };

  const chosen = [];
  const seen = new Set();
  for (const hex of [...representatives.values()].sort(byShareThenHex)) {
    if (chosen.length >= colorCount) break;
    seen.add(hex);
    chosen.push(hex);
  }
  // 補位：所有全域顏色依占比降序，把沒見過的補到滿。
  for (const hex of [...shares.keys()].map((k) => hexOf((k >> 16) & 0xff, (k >> 8) & 0xff, k & 0xff)).sort(byShareThenHex)) {
    if (chosen.length >= colorCount) break;
    if (seen.has(hex)) continue;
    seen.add(hex);
    chosen.push(hex);
  }

  // 重排（細節 4）。不是整理，是正確性：補位可以補進更大的顏色。
  const rows = chosen.map((hex) => ({ hex, share: shares.get(keyOfHex(hex)) }));
  rows.sort((a, b) => {
    if (a.share !== b.share) return b.share - a.share;
    return a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;
  });
  return rows;
}

function keyOfHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r << 16) | (g << 8) | b;
}