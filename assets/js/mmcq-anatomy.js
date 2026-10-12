/**
 * MMCQ 演算法解剖模組 (MMCQ Algorithm Anatomy)
 *
 * 專為 colors-generator.html 的演算法視覺化解剖設計。
 * 純函式、零 DOM 依賴，可在 Node.js 與瀏覽器環境無縫執行。
 *
 * 核心功能：
 * 1. loadSpritePixels: 過濾 alpha < 200 與 EXCLUDED_RGB 五個暗底色
 * 2. mmcqPalette: 完整記錄 MMCQ 5 刀切分 trace、6 個三維空間箱子 bounds、
 *    每箱代表色、區域像素數、空區域旗標，並產出與 color_palettes.json 逐 byte 相符的色盤。
 */

export const SIGBITS = 5;
export const RSHIFT = 8 - SIGBITS; // 3
export const HISTO_SIZE = 1 << (3 * SIGBITS); // 32768
export const MAX_ITERATIONS = 1000;
export const FRACT_BY_POPULATIONS = 0.75;
export const MIN_ALPHA = 200;

export const EXCLUDED_HEX = new Set([
  '#000000',
  '#101010',
  '#121212',
  '#010101',
  '#0f0f0f',
]);

const EXCLUDED_KEYS = new Set([
  0x000000,
  0x101010,
  0x121212,
  0x010101,
  0x0f0f0f,
]);

export function colorIndex(r, g, b) {
  return (r << (2 * SIGBITS)) + (g << SIGBITS) + b;
}

export function hexOf(r, g, b) {
  return '#' + r.toString(16).padStart(2, '0')
             + g.toString(16).padStart(2, '0')
             + b.toString(16).padStart(2, '0');
}

export function keyOf(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

export function keyOfHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r << 16) | (g << 8) | b;
}

/**
 * 載入並過濾 Sprite 像素。
 * @param {{ data: Uint8Array|Uint8ClampedArray }|Uint8Array} imageData 
 * @returns {Array<[number, number, number]>}
 */
export function loadSpritePixels(imageData) {
  const data = imageData.data || imageData;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    if (EXCLUDED_KEYS.has(key)) continue;
    pixels.push([r, g, b]);
  }
  return pixels;
}

/**
 * 5-bit 精度三維 VBox
 */
export class VBox {
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
    return new VBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.histo);
  }

  avg(force = false) {
    if (this._avg === undefined || force) {
      const mult = 1 << RSHIFT;
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

  contains(r, g, b) {
    const rv = r >> RSHIFT;
    const gv = g >> RSHIFT;
    const bv = b >> RSHIFT;
    return rv >= this.r1 && rv <= this.r2
        && gv >= this.g1 && gv <= this.g2
        && bv >= this.b1 && bv <= this.b2;
  }
}

/**
 * 延遲排序佇列
 */
export class PQueue {
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

export function buildHistogram(pixels) {
  const histo = new Uint32Array(HISTO_SIZE);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    histo[colorIndex(p[0] >> RSHIFT, p[1] >> RSHIFT, p[2] >> RSHIFT)]++;
  }
  return histo;
}

export function initialVBox(pixels, histo) {
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

/**
 * median_cut_apply: 切割一個盒子，並回傳切分細節
 */
export function medianCutApplyWithDetail(histo, vbox) {
  if (!vbox.count()) return null;
  if (vbox.count() === 1) return { vbox1: vbox.copy(), vbox2: null, axis: null, cut: null };
  if (vbox.volume() === 1) return { vbox1: vbox.copy(), vbox2: null, axis: null, cut: null };

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

        while (!partialsum[d2]) d2++;
        let count2 = lookaheadsum[d2];
        while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];

        vbox1[dim2] = d2;
        vbox2[dim1] = vbox1[dim2] + 1;

        return { vbox1, vbox2, axis: color, cut: d2 };
      }
    }
    return null;
  }

  if (maxw === rw) return doCut('r');
  if (maxw === gw) return doCut('g');
  return doCut('b');
}

/** 排序鍵常數：Phase 1 依人口、Phase 2 依人口×體積 */
export const COMPARATOR_COUNT = (a, b) => a.count() - b.count();
export const COMPARATOR_PRODUCT = (a, b) => a.count() * a.volume() - b.count() * b.volume();

/**
 * MMCQ 演算法執行與解剖。
 *
 * @param {Array<[number,number,number]>} pixels
 * @param {number} maxColors 預設 6
 * @returns {{
 *   rows: Array<{hex: string, share: number}>,
 *   trace: Array<{phase: number, axis: string, count: number, volume: number, cut: number}>,
 *   boxes: Array<{bounds: object, pixelCount: number, representative: string|null, isEmpty: boolean}>,
 *   vbox2NoneCount: number
 * }}
 */
export function mmcqPalette(pixels, maxColors = 6) {
  if (!pixels || !pixels.length) {
    const emptyTrace = [];
    emptyTrace.boxes = [];
    return { rows: [], trace: emptyTrace, boxes: [], vbox2NoneCount: 0 };
  }

  const total = pixels.length;

  // 全域直方圖
  const histogram = new Map();
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const key = (p[0] << 16) | (p[1] << 8) | p[2];
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }

  const shares = new Map();
  for (const [key, count] of histogram) {
    shares.set(key, (count / total) * 100);
  }

  const histo = buildHistogram(pixels);
  const pq = new PQueue(COMPARATOR_COUNT);
  const initBox = initialVBox(pixels, histo);
  pq.push(initBox);

  const trace = [];
  trace.steps = [[initBox.copy()]];
  let vbox2NoneCount = 0;

  // Phase 1: 依人口切到 FRACT_BY_POPULATIONS * maxColors
  const targetPhase1 = FRACT_BY_POPULATIONS * maxColors;
  let niters = 0;
  while (niters < MAX_ITERATIONS && pq.size() < targetPhase1) {
    niters++;
    const vbox = pq.pop();
    if (!vbox.count()) {
      pq.push(vbox);
      continue;
    }
    const countBefore = vbox.count();
    const volumeBefore = vbox.volume();
    const result = medianCutApplyWithDetail(histo, vbox);
    if (!result || !result.vbox1) break;

    if (result.vbox2 === null) {
      vbox2NoneCount++;
    }

    trace.push({
      phase: 1,
      axis: result.axis,
      count: countBefore,
      volume: volumeBefore,
      cut: result.cut,
    });

    pq.push(result.vbox1);
    if (result.vbox2) {
      pq.push(result.vbox2);
    }
    trace.steps.push(pq.contents.map(b => b.copy()));
  }

  // Phase 2: 換成人口 × 體積繼續切到 maxColors
  const pq2 = new PQueue(COMPARATOR_PRODUCT);
  while (pq.size()) pq2.push(pq.pop());

  niters = 0;
  while (niters < MAX_ITERATIONS && pq2.size() < maxColors) {
    niters++;
    const vbox = pq2.pop();
    if (!vbox.count()) {
      pq2.push(vbox);
      continue;
    }
    const countBefore = vbox.count();
    const volumeBefore = vbox.volume();
    const result = medianCutApplyWithDetail(histo, vbox);
    if (!result || !result.vbox1) break;

    if (result.vbox2 === null) {
      vbox2NoneCount++;
    }

    trace.push({
      phase: 2,
      axis: result.axis,
      count: countBefore,
      volume: volumeBefore,
      cut: result.cut,
    });

    pq2.push(result.vbox1);
    if (result.vbox2) {
      pq2.push(result.vbox2);
    }
    trace.steps.push(pq2.contents.map(b => b.copy()));
  }

  // 取得 6 個箱子
  const boxes = [];
  while (pq2.size()) boxes.push(pq2.pop());

  // snapToReal: 分區指派
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

  // 建立每箱結構資訊
  const boxDetails = [];
  const representatives = new Map();

  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    const region = regions[b];
    const isEmpty = region.length === 0;
    let repHex = null;

    if (!isEmpty) {
      const local = new Map();
      for (let i = 0; i < region.length; i++) {
        const p = region[i];
        const key = (p[0] << 16) | (p[1] << 8) | p[2];
        local.set(key, (local.get(key) || 0) + 1);
      }

      // 平手由 RGB 數值升序決定
      let bestKey = null;
      let bestCount = -1;
      for (const [key, count] of local) {
        const k = key >>> 0;
        if (count > bestCount || (count === bestCount && (bestKey === null || k < bestKey))) {
          bestCount = count;
          bestKey = k;
        }
      }
      repHex = hexOf((bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff);
      representatives.set(bestKey >>> 0, repHex);
    }

    boxDetails.push({
      bounds: {
        r1: box.r1, r2: box.r2,
        g1: box.g1, g2: box.g2,
        b1: box.b1, b2: box.b2,
      },
      pixelCount: region.length,
      representative: repHex,
      isEmpty,
    });
  }

  // 依占比排序與補位
  const byShareThenHex = (a, b) => {
    const sa = shares.get(keyOfHex(a));
    const sb = shares.get(keyOfHex(b));
    if (sa !== sb) return sb - sa;
    return a < b ? -1 : a > b ? 1 : 0;
  };

  const chosen = [];
  const seen = new Set();
  for (const hex of [...representatives.values()].sort(byShareThenHex)) {
    if (chosen.length >= maxColors) break;
    seen.add(hex);
    chosen.push(hex);
  }

  // 補位：全域未見色依占比降序填補
  for (const hex of [...shares.keys()].map(k => hexOf((k >> 16) & 0xff, (k >> 8) & 0xff, k & 0xff)).sort(byShareThenHex)) {
    if (chosen.length >= maxColors) break;
    if (seen.has(hex)) continue;
    seen.add(hex);
    chosen.push(hex);
  }

  // 補位後重新排序
  const rows = chosen.map(hex => ({
    hex,
    share: Number((shares.get(keyOfHex(hex)) || 0).toFixed(2)),
  }));
  rows.sort((a, b) => {
    if (a.share !== b.share) return b.share - a.share;
    return a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0;
  });

  trace.boxes = boxDetails;

  return {
    rows,
    trace,
    boxes: boxDetails,
    vbox2NoneCount,
  };
}
