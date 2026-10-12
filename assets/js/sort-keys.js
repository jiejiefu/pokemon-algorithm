// ==========================================
// 寶可夢演算法 — 排序鍵 (sort-keys.js)
// ==========================================
// Every key here compares two PokemonNode objects; `node.data` is the raw
// pokemon_data.json record. 圖鑑編號 is the only key the original sorting.html
// had — the rest are what makes "排序" say something about THIS dataset instead
// of re-deriving the array index.
//
// Every comparator returns <0 / 0 / >0, exactly like Array.prototype.sort's
// contract, so the same function serves the six generators in
// sorting-algorithms.js and a plain arr.sort() self-check alike.
//
// WHY `屬性` IS THE ONLY KEY WITH NO SECOND TIEBREAK.  The other seven all end
// in `|| a.data.id - b.data.id`, which makes them total orders: no two records
// ever compare equal.  屬性 deliberately does not, because 18 types over 1,025
// records means heavy ties, and THAT is the point — see the 顯示原始順序 toggle
// on sorting.html.  Adding a tiebreak to this key would silently delete the
// stability demonstration it exists to provide, and the page's copy would then
// be claiming a lesson its own control can no longer show.  check_algo_modules
// asserts the tiebreak is absent, by measuring that equal-type pairs really do
// compare 0.

import { TYPE_CHART_ORDER } from './type-chart.js';

/** The 18 types in the order this project already uses everywhere else.
 *
 *  pokemon_data.json carries types Capitalised ("Grass", "Poison"), which is
 *  why TYPE_CHART_ORDER's own casing is right here and a hand-written
 *  lowercase slug list would put every record in the fallback bucket.  Using
 *  the shared table rather than a local copy also means the sort buckets match
 *  the type chart the rest of the site shows. */
const TYPE_RANK = Object.fromEntries(TYPE_CHART_ORDER.map((t, i) => [t, i]));
const TYPE_FALLBACK = TYPE_CHART_ORDER.length;

/** Rank by the record's PRIMARY type, falling back to last for a type this
 *  table has never heard of (a dual-typed record whose first type is new). */
function typeRankOf(data) {
  return TYPE_RANK[data.types?.[0]] ?? TYPE_FALLBACK;
}

/** Stroke-count collation, when the browser's ICU carries it.
 *
 *  Chrome/Edge and Safari resolve 'zh-Hant-u-co-stroke' to real 筆畫 order; a
 *  build without that collation data silently falls back to the platform's
 *  default zh collator rather than throwing, so there is no feature test worth
 *  writing.  The UI label says 視瀏覽器而定 instead of claiming a guarantee the
 *  page cannot make — the same reason colors-generator.html's contrast guard measures
 *  both themes rather than reading one declaration. */
let strokeCollator = null;
try { strokeCollator = new Intl.Collator('zh-Hant-u-co-stroke'); } catch { /* no Intl.Collator at all */ }

/** A SMALL DISCLOSURE ABOUT 顏色, because there is no honest way to do better.
 *
 *  pokemon_data.json ALREADY carries a measured `hue` (and `sat`/`val`), from
 *  the same MMCQ sampling that produced rgb — so this recomputes nothing.  The
 *  tempting improvement is to sort near-greys first, on the grounds that a grey
 *  has no hue.  Measured over all 1,025 records, `sat` is CONTINUOUS from 0.003
 *  to 0.795 with no gap anywhere: 185 records sit under 0.10 and grade straight
 *  into 0.11, 0.12, 0.13.  There is no threshold that separates "grey" from
 *  "barely tinted" without cutting through a continuum, and a cut placed in the
 *  middle of one is a number chosen by taste that then changes 180-odd
 *  records' positions.  So the key sorts the measured hue as stored, and the
 *  page says plainly that a near-greysprite's hue carries no visual meaning.
 *
 *  (This is the same lesson as the chroma gate in §3.B2, and it lands the
 *  opposite way: that gate sits in a gap and is worth having; this one would
 *  not sit in a gap, so it is not worth having.) */
export const HUE_KEYS_MEANINGLESS_BELOW_SAT = 0;

export const SORT_KEYS = [
  {
    id: 'id', label: '圖鑑編號', short: '編號',
    compare: (a, b) => a.data.id - b.data.id,
  },
  {
    id: 'height', label: '身高（矮→高）', short: '身高',
    compare: (a, b) => (a.data.height_m ?? 0) - (b.data.height_m ?? 0) || a.data.id - b.data.id,
  },
  {
    id: 'weight', label: '體重（輕→重）', short: '體重',
    compare: (a, b) => (a.data.weight_kg ?? 0) - (b.data.weight_kg ?? 0) || a.data.id - b.data.id,
  },
  {
    id: 'stats', label: '能力值總和', short: '總和',
    compare: (a, b) => (a.data.stats?.total ?? 0) - (b.data.stats?.total ?? 0) || a.data.id - b.data.id,
  },
  {
    id: 'gen', label: '世代', short: '世代',
    compare: (a, b) => (a.data.generation - b.data.generation) || (a.data.id - b.data.id),
  },
  {
    id: 'hue', label: '顏色（色相環）', short: '色相',
    note: '色相來自精靈圖實測。接近灰階的精靈（飽和度低）色相沒有視覺意義，會排在它量到的位置。',
    compare: (a, b) => a.data.hue - b.data.hue || a.data.id - b.data.id,
  },
  {
    id: 'name-stroke', label: '中文名筆畫（視瀏覽器而定）', short: '筆畫',
    compare: (a, b) => {
      const za = a.data.names.zh, zb = b.data.names.zh;
      return (strokeCollator ? strokeCollator.compare(za, zb) : za.localeCompare(zb, 'zh-Hant'))
        || a.data.id - b.data.id;
    },
  },
  {
    id: 'name-en', label: '英文名稱（A–Z）', short: '英文',
    compare: (a, b) => a.data.names.en.localeCompare(b.data.names.en, 'en') || a.data.id - b.data.id,
  },
  {
    /* Single-key ON PURPOSE — see the file header. 18 types over 1,025 records
     * means heavy ties, which is exactly what the 顯示原始順序 toggle needs in
     * order to show that a stable algorithm keeps the shuffled relative order
     * inside a tie group and an unstable one does not. */
    id: 'type', label: '屬性（穩定性示範：同屬性視為相等）', short: '屬性',
    note: '這個鍵刻意沒有第二排序鍵，所以同屬性的寶可夢互為相等。開啟「顯示原始順序」後，穩定的演算法會保留洗牌後的相對順序，不穩定的會打亂。',
    compare: (a, b) => typeRankOf(a.data) - typeRankOf(b.data),
  },
];

export const SORT_KEY_MAP = Object.fromEntries(SORT_KEYS.map(k => [k.id, k]));
export const SORT_KEY_IDS = SORT_KEYS.map(k => k.id);
export const DEFAULT_SORT_KEY = 'id';
