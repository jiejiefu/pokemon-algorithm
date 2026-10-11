// ==========================================
// 寶可夢演算法 — 排序演算法 (sorting-algorithms.js)
// ==========================================
// This file used to be a CLASSIC script, loaded with <script src> at the end of
// sorting.html, because the page's buttons carried inline onclick="" handlers
// and an inline handler resolves its callee on `window`. Both of those reasons
// are gone — the buttons are wired with addEventListener like every other page
// — so this is now an ES module the page imports directly, and the six
// generators are no longer globals. Nothing else on the site reads them.
//
// Two changes over the original, both load-bearing for what sorting.html can
// now do:
//
// 1. Every generator takes `compare(a, b)` instead of reading `.data.id`. The
//    original hardcoded `.data.id` in EIGHT places across the six functions, so
//    "sort by height" was not a dropdown away — it was an edit to every
//    algorithm at once. See sort-keys.js for the eight keys that work now.
//
// 2. Every generator yields on every comparison AND every swap/write, not once
//    per outer pass. That is what makes the pseudocode panel able to follow the
//    run line by line and the cries player able to sound each swap. It is also
//    ~n× more yields than before, which is why sorting.html's speed control is
//    "steps processed per animation frame" rather than "frames per step".
//
// STEP EVENT SHAPES yielded by every generator below. `i`/`j` are always
// CURRENT ARRAY POSITIONS, never Pokémon ids, because the caller maps array
// position → grid cell:
//
//   { t:'compare', i, j }             — comparing positions i and j
//   { t:'swap',    i, j, phase? }     — arr[i]/arr[j] just exchanged
//   { t:'write',   i, node }          — position i took a new occupant (merge
//                                       only: a write with no swap partner)
//   { t:'mark',    i, role }          — a non-mutating highlight
//                                       (role: 'min' | 'pivot')
//   { t:'range',   lo, hi, depth }    — a recursive call just started on
//                                       arr[lo..hi]
//
// `write` CARRIES ITS NODE, and that is not redundant bookkeeping. Which of
// left[i]/right[j] was smaller is a decision the generator makes once, when it
// yields; SortRun.seekTo replays recorded writes onto a restored array that no
// longer holds `left`/`right` at all, so it has to read the answer back out of
// the event. Measured: strip `node` and a full replay of a 400-element merge
// leaves 151 of 400 cells holding `undefined`.

export function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

// ---------------------------------------------------------------- Bubble --
export function* bubbleSortSteps(arr, compare) {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      yield { t: 'compare', i: j, j: j + 1 };
      if (compare(arr[j], arr[j + 1]) > 0) {
        swap(arr, j, j + 1);
        swapped = true;
        yield { t: 'swap', i: j, j: j + 1, phase: 'bubble' };
      }
    }
    if (!swapped) break; // already sorted — O(n) rather than O(n²)
  }
}

// ------------------------------------------------------------- Selection --
export function* selectionSortSteps(arr, compare) {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      yield { t: 'compare', i: minIdx, j };
      if (compare(arr[j], arr[minIdx]) < 0) {
        minIdx = j;
        yield { t: 'mark', i: minIdx, role: 'min' };
      }
    }
    if (minIdx !== i) {
      swap(arr, i, minIdx);
      yield { t: 'swap', i, j: minIdx, phase: 'select' };
    }
  }
}

// ------------------------------------------------------------- Insertion --
/* Reimplemented as adjacent swaps. It used to be shift-based — `arr[j+1] =
 * arr[j]` in a loop, then one write of the held-aside value — which sorts into
 * the identical final order for the identical O(n²) work, but produced a THIRD
 * mutation shape (a write with no known partner) for the renderer, the replayer
 * and the sound to special-case. Adjacent swaps are the same shape the other
 * five already use. */
export function* insertionSortSteps(arr, compare) {
  const n = arr.length;
  for (let i = 1; i < n; i++) {
    let j = i;
    while (j > 0) {
      yield { t: 'compare', i: j - 1, j };
      if (compare(arr[j - 1], arr[j]) <= 0) break;
      swap(arr, j - 1, j);
      yield { t: 'swap', i: j - 1, j, phase: 'insert' };
      j--;
    }
  }
}

// ----------------------------------------------------------------- Quick --
// Pivot by MEDIAN OF THREE, not a fixed arr[high]. The fixed-last-element pivot
// is the textbook version and degrades to O(n²) on already-sorted or
// reverse-sorted input — and this page walks straight into its own worst case:
// after 快速 finishes the array IS sorted, so pressing 快速 again without
// reshuffling feeds it exactly that. Measured at n=1025 on already-sorted
// input: 524,800 comparisons with a fixed pivot, 9,747 with median-of-three.
// 53.8× on a button a reader is invited to press twice.
//
// The three-comparator sorting network below (compare-swap mid/low, high/low,
// high/mid) leaves the median at `mid`; one further swap moves it to `high`, so
// the rest of the function keeps its original "pivot lives at arr[high]"
// convention and the partition loop is unchanged. Skipped below 3 elements,
// where there is no choice to make.
export function* quickSortSteps(arr, compare, low = 0, high = arr.length - 1, depth = 0) {
  if (low >= high) return;
  yield { t: 'range', lo: low, hi: high, depth };

  if (high - low >= 2) {
    const mid = low + ((high - low) >> 1);
    yield { t: 'compare', i: mid, j: low };
    if (compare(arr[mid], arr[low]) < 0) { swap(arr, mid, low); yield { t: 'swap', i: mid, j: low, phase: 'median' }; }
    yield { t: 'compare', i: high, j: low };
    if (compare(arr[high], arr[low]) < 0) { swap(arr, high, low); yield { t: 'swap', i: high, j: low, phase: 'median' }; }
    yield { t: 'compare', i: high, j: mid };
    if (compare(arr[high], arr[mid]) < 0) { swap(arr, high, mid); yield { t: 'swap', i: high, j: mid, phase: 'median' }; }
    swap(arr, mid, high);
    yield { t: 'swap', i: mid, j: high, phase: 'median' };
  }

  const pivotIdx = high;
  yield { t: 'mark', i: pivotIdx, role: 'pivot' };
  const pivot = arr[pivotIdx];

  let i = low - 1;
  for (let j = low; j < high; j++) {
    yield { t: 'compare', i: j, j: pivotIdx };
    if (compare(arr[j], pivot) < 0) {
      i++;
      if (i !== j) {
        swap(arr, i, j);
        yield { t: 'swap', i, j, phase: 'partition' };
      }
    }
  }
  if (i + 1 !== high) {
    swap(arr, i + 1, high);
    yield { t: 'swap', i: i + 1, j: high, phase: 'pivot' };
  }
  const pi = i + 1;
  yield* quickSortSteps(arr, compare, low, pi - 1, depth + 1);
  yield* quickSortSteps(arr, compare, pi + 1, high, depth + 1);
}

// ----------------------------------------------------------------- Merge --
export function* mergeSortSteps(arr, compare, l = 0, r = arr.length - 1, depth = 0) {
  if (l >= r) return;
  const m = Math.floor(l + (r - l) / 2);
  yield { t: 'range', lo: l, hi: r, depth };

  yield* mergeSortSteps(arr, compare, l, m, depth + 1);
  yield* mergeSortSteps(arr, compare, m + 1, r, depth + 1);

  const left = arr.slice(l, m + 1);
  const right = arr.slice(m + 1, r + 1);
  let i = 0, j = 0, k = l;
  while (i < left.length && j < right.length) {
    yield { t: 'compare', i: l + i, j: m + 1 + j };
    const node = compare(left[i], right[j]) <= 0 ? left[i++] : right[j++];
    arr[k] = node;
    yield { t: 'write', i: k, node }; // `node` rides along — see the file header
    k++;
  }
  while (i < left.length) { const node = left[i++]; arr[k] = node; yield { t: 'write', i: k, node }; k++; }
  while (j < right.length) { const node = right[j++]; arr[k] = node; yield { t: 'write', i: k, node }; k++; }
}

// ------------------------------------------------------------------ Heap --
export function* heapify(arr, compare, n, i) {
  let largest = i;
  const l = 2 * i + 1, r = 2 * i + 2;
  if (l < n) {
    yield { t: 'compare', i: l, j: largest };
    if (compare(arr[l], arr[largest]) > 0) largest = l;
  }
  if (r < n) {
    yield { t: 'compare', i: r, j: largest };
    if (compare(arr[r], arr[largest]) > 0) largest = r;
  }
  if (largest !== i) {
    swap(arr, i, largest);
    yield { t: 'swap', i, j: largest, phase: 'heapify' };
    yield* heapify(arr, compare, n, largest);
  }
}

export function* heapSortSteps(arr, compare) {
  const n = arr.length;
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
    yield* heapify(arr, compare, n, i);
  }
  for (let i = n - 1; i > 0; i--) {
    swap(arr, 0, i);
    yield { t: 'swap', i: 0, j: i, phase: 'extract' };
    yield* heapify(arr, compare, i, 0);
  }
}

// ==========================================================================
// METADATA — pseudocode text, and which line lights up for a given step event.
//
// `pseudo` and `lineFor` are ONE contract, not two: `lineFor` returns an index
// INTO `pseudo`, and the panel would silently highlight nothing (or the wrong
// line) if the two ever drifted. check_sorting_page.mjs asserts every index
// lineFor can return is a valid index of that algorithm's own array — AND of
// `pseudoPy`, which is the reason the next paragraph exists.
//
// The pseudocode is the SAME algorithm the generator runs, in the same order.
// It is not a summary and it is not a simplification: `while j > 0` really is
// the loop condition, `if not swapped: break` really is the early exit.
//
// --------------------------------------------------------------------------
// `pseudoPy` — THE SAME ALGORITHM IN PYTHON, AND WHY IT IS INDEX-PARALLEL
//
// `pseudoPy` is not a second rendering of `pseudo` and it is not a translation
// of the prose; it is the same statement list written in Python syntax, because
// a reader who knows Python cannot read `←` and `≠` and this panel exists to
// be read. Its defining property is that **index i means the same statement in
// both arrays**, which is what lets ONE `lineFor` drive both and what makes a
// second mapping unnecessary. A second `pythonLineFor` per algorithm would put
// the drift the contract above warns about back, in the one place it would be
// least visible: a highlight that lands one line off, on a correct-looking
// panel, for one algorithm out of six.
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO
//
// 1. `n = len(arr)` IS NOT LINE 0. Adding it shifts every index below it by one
//    and the whole `lineFor` table with it, so the panel says where `n` comes
//    from in a caption instead (sorting.html). Same reason `def quicksort(...)`
//    takes no `arr`: the signature is kept as short as the generic one so the
//    line COUNT matches. Python-shaped, not runnable — and it is not meant to
//    be run, because `swap()` is not a Python builtin.
//
// 2. THE TWO ARRAYS ARE NOT REQUIRED TO BE THE SAME LENGTH. merge is the case
//    that proves why: its generic line is one prose sentence, and its Python
//    equivalent is an if/else that cannot honestly be one line. So the rule the
//    checker enforces is "every index `lineFor` can return is in range for BOTH
//    arrays" — which merge satisfies at index 4 with one line left over that no
//    event ever selects. An equal-length rule would need merge listed as an
//    exception, and an exception list is where the next drift goes.
//
// 3. `//` MEANS TWO THINGS ACROSS THE TWO ARRAYS. In `pseudo` it opens a
//    comment; in `pseudoPy` `(low + high) // 2` is floor division and `#` opens
//    the comment. Each array is internally unambiguous — which is all a reader
//    switching between them actually needs.
// ==========================================================================

export const ALGO_META = {
  bubble: {
    label: '氣泡排序', short: '氣泡',
    complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)' },
    stable: true, inPlace: true,
    run: bubbleSortSteps,
    pseudo: [
      'for i ← 0 to n-2',
      '  swapped ← false',
      '  for j ← 0 to n-i-2',
      '    if arr[j] > arr[j+1]',
      '      swap(arr[j], arr[j+1])',
      '      swapped ← true',
      '  if not swapped: break   // 已排序，O(n)',
    ],
    pseudoPy: [
      'for i in range(n - 1):',
      '  swapped = False',
      '  for j in range(n - i - 1):',
      '    if arr[j] > arr[j + 1]:',
      '      swap(arr[j], arr[j + 1])',
      '      swapped = True',
      '  if not swapped: break   # 已排序，O(n)',
    ],
    lineFor(ev) {
      if (ev.t === 'compare') return 3;
      if (ev.t === 'swap') return 4;
      return null;
    },
  },

  selection: {
    label: '選擇排序', short: '選擇',
    complexity: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)' },
    stable: false, inPlace: true,
    run: selectionSortSteps,
    pseudo: [
      'for i ← 0 to n-2',
      '  minIdx ← i',
      '  for j ← i+1 to n-1',
      '    if arr[j] < arr[minIdx]',
      '      minIdx ← j',
      '  if minIdx ≠ i',
      '    swap(arr[i], arr[minIdx])',
    ],
    pseudoPy: [
      'for i in range(n - 1):',
      '  min_idx = i',
      '  for j in range(i + 1, n):',
      '    if arr[j] < arr[min_idx]:',
      '      min_idx = j',
      '  if min_idx != i:',
      '    swap(arr[i], arr[min_idx])',
    ],
    lineFor(ev) {
      if (ev.t === 'compare') return 3;
      if (ev.t === 'mark') return 4;
      if (ev.t === 'swap') return 6;
      return null;
    },
  },

  insertion: {
    label: '插入排序', short: '插入',
    complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)' },
    stable: true, inPlace: true,
    run: insertionSortSteps,
    pseudo: [
      'for i ← 1 to n-1',
      '  j ← i',
      '  while j > 0 and arr[j-1] > arr[j]',
      '    swap(arr[j-1], arr[j])',
      '    j ← j-1',
    ],
    pseudoPy: [
      'for i in range(1, n):',
      '  j = i',
      '  while j > 0 and arr[j - 1] > arr[j]:',
      '    swap(arr[j - 1], arr[j])',
      '    j -= 1',
    ],
    lineFor(ev) {
      if (ev.t === 'compare') return 2;
      if (ev.t === 'swap') return 3;
      return null;
    },
  },

  quick: {
    label: '快速排序', short: '快速',
    complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)' },
    stable: false, inPlace: true,
    run: quickSortSteps,
    pseudo: [
      'quicksort(low, high):',
      '  if low ≥ high: return',
      '  pivot ← medianOfThree(low, mid, high)   // 不是固定取最後一個',
      '  把 pivot 換到 arr[high]',
      '  i ← low-1',
      '  for j ← low to high-1',
      '    if arr[j] < pivot',
      '      i++; swap(arr[i], arr[j])',
      '  swap(arr[i+1], arr[high])   // pivot 歸位',
      '  quicksort(low, i); quicksort(i+2, high)',
    ],
    /* Line 3 is not a restatement of the generic prose — it is what the
     * generator actually does (`sorting-algorithms.js`: median-of-three leaves
     * the median at `mid`, then `swap(arr, mid, high)`). A comment saying 「把
     * pivot 換到 arr[high]」 would have kept the index and lost the one place a
     * reader could check the Python against the JavaScript.
     *
     * The re-read the generator does next (`const pivot = arr[pivotIdx]`) is NOT
     * written here, and that is a correctness point rather than brevity: the swap
     * RELOCATES the median, so the value `pivot` already holds is unchanged by
     * it. The line is also the panel's only ~330px-wide row, and appending the
     * rebinding pushed the closing `)` past the edge — clipping a reader out of
     * the one line they had a reason to check. */
    pseudoPy: [
      'def quicksort(low, high):',
      '  if low >= high: return',
      '  pivot = median_of_three(low, mid, high)   # mid=(low+high)//2；不是固定取最後一個',
      '  swap(arr[mid], arr[high])',
      '  i = low - 1',
      '  for j in range(low, high):',
      '    if arr[j] < pivot:',
      '      i += 1; swap(arr[i], arr[j])',
      '  swap(arr[i + 1], high)   # pivot 歸位',
      '  quicksort(low, i); quicksort(i + 2, high)',
    ],
    lineFor(ev) {
      if (ev.t === 'range') return 0;
      if (ev.t === 'swap' && ev.phase === 'median') return 2;
      if (ev.t === 'mark') return 3;
      if (ev.t === 'compare') return 6;
      if (ev.t === 'swap') return ev.phase === 'pivot' ? 8 : 7;
      return null;
    },
  },

  merge: {
    label: '合併排序', short: '合併',
    complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
    stable: true, inPlace: false,
    run: mergeSortSteps,
    pseudo: [
      'mergesort(l, r):',
      '  if l ≥ r: return',
      '  m ← (l+r) / 2',
      '  mergesort(l, m); mergesort(m+1, r)',
      '  比較 left[i], right[j]，較小者寫回 arr[k]',
    ],
    /* SIX lines against a FIVE-line `pseudo`, and that is the honest count: the
     * generic line is one prose sentence and this is an if/else. The extra line
     * is index 5, which no event selects — `lineFor` sends compare and write to
     * index 4, the `if`. Forcing it to five lines would mean either dropping the
     * `else` (Python that sorts nothing) or gluing both branches onto one line
     * (Python nobody can read at 280px). See the METADATA header. */
    pseudoPy: [
      'def mergesort(l, r):',
      '  if l >= r: return',
      '  m = (l + r) // 2',
      '  mergesort(l, m); mergesort(m + 1, r)',
      '  if left[i] <= right[j]: arr[k] = left[i]; i += 1',
      '  else: arr[k] = right[j]; j += 1',
    ],
    lineFor(ev) {
      if (ev.t === 'range') return 0;
      if (ev.t === 'compare' || ev.t === 'write') return 4;
      return null;
    },
  },

  heap: {
    label: '堆積排序', short: '堆積',
    complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)' },
    stable: false, inPlace: true,
    run: heapSortSteps,
    pseudo: [
      'buildMaxHeap(): for i ← n/2-1 downto 0: heapify(i, n)',
      'for i ← n-1 downto 1',
      '  swap(arr[0], arr[i])',
      '  heapify(0, i)',
      'heapify(i, size):',
      '  比較左右子節點，找出最大值 largest',
      '  if largest ≠ i: swap(arr[i],arr[largest]); heapify(largest)',
    ],
    /* Index 5 is prose in `pseudo` and Python here. A real `heapify` body needs
     * ~10 lines (two child lookups, a `if left > right` compare, a `if left > i`
     * compare) and would put index 6, the line that actually swaps, eight lines
     * below the generic one — so `lineFor`'s two swap indices would stop meaning
     * the same thing. One line, saying what it says, keeps both indices. */
    pseudoPy: [
      'build_max_heap(): for i in range(n // 2 - 1, -1, -1): heapify(i, n)',
      'for i in range(n - 1, 0, -1):',
      '  swap(arr[0], arr[i])',
      '  heapify(0, i)',
      'def heapify(i, size):',
      '  largest = max(arr[i], arr[l], arr[r])   # l、r 是左右子節點',
      '  if largest != i: swap(arr[i], largest); heapify(largest)',
    ],
    lineFor(ev) {
      if (ev.t === 'compare') return 5;
      if (ev.t === 'swap') return ev.phase === 'extract' ? 2 : 6;
      return null;
    },
  },
};

export const ALGO_IDS = Object.keys(ALGO_META);
