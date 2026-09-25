// ==========================================
// 1025 寶可夢演算法實驗室 - 排序模組 (sorting.js)
// ==========================================

/**
 * 共用的陣列元素交換函式
 */
function swap(arr, i, j) {
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
}

/**
 * 1. 氣泡排序法 (Bubble Sort)
 * 時間複雜度: O(n²) | 穩定性: 穩定
 */
function* bubbleSortSteps(arr) {
    const n = arr.length;
    for (let i = 0; i < n - 1; i++) {
        let swapped = false;
        for (let j = 0; j < n - i - 1; j++) {
            if (arr[j].data.id > arr[j + 1].data.id) {
                swap(arr, j, j + 1);
                swapped = true;
            }
        }
        yield; // 每一輪氣泡浮出後暫停，更新 Canvas 畫面
        if (!swapped) break;
    }
}

/**
 * 2. 選擇排序法 (Selection Sort)
 * 時間複雜度: O(n²) | 穩定性: 不穩定
 */
function* selectionSortSteps(arr) {
    const n = arr.length;
    for (let i = 0; i < n - 1; i++) {
        let minIdx = i;
        for (let j = i + 1; j < n; j++) {
            if (arr[j].data.id < arr[minIdx].data.id) {
                minIdx = j;
            }
        }
        if (minIdx !== i) {
            swap(arr, i, minIdx);
        }
        yield; // 找到當前最小值並歸位後暫停
    }
}

/**
 * 3. 插入排序法 (Insertion Sort)
 * 時間複雜度: O(n²) | 穩定性: 穩定
 */
function* insertionSortSteps(arr) {
    const n = arr.length;
    for (let i = 1; i < n; i++) {
        let current = arr[i];
        let j = i - 1;
        while (j >= 0 && arr[j].data.id > current.data.id) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = current;
        // 每插入 5 筆資料暫停一次，兼顧動畫速度與觀賞性
        if (i % 5 === 0 || i === n - 1) yield;
    }
    yield;
}

/**
 * 4. 快速排序法 (Quick Sort)
 * 時間複雜度: O(n log n) | 穩定性: 不穩定
 * 說明：遞迴 Generator 需使用 yield* 來傳遞遞迴子任務的 Generator 狀態
 */
function* quickSortSteps(arr, low = 0, high = arr.length - 1) {
    if (low < high) {
        let pivot = arr[high].data.id;
        let i = low - 1;
        
        for (let j = low; j < high; j++) {
            if (arr[j].data.id < pivot) {
                i++;
                swap(arr, i, j);
            }
        }
        swap(arr, i + 1, high);
        let pi = i + 1;

        yield; // Pivot 基準點歸位後暫停，展示分治切割過程

        // 遞迴呼叫左右子陣列
        yield* quickSortSteps(arr, low, pi - 1);
        yield* quickSortSteps(arr, pi + 1, high);
    }
}

/**
 * 5. 合併排序法 (Merge Sort)
 * 時間複雜度: O(n log n) | 穩定性: 穩定
 */
function* mergeSortSteps(arr, l = 0, r = arr.length - 1) {
    if (l < r) {
        const m = Math.floor(l + (r - l) / 2);
        
        // 遞迴分割左、右半邊
        yield* mergeSortSteps(arr, l, m);
        yield* mergeSortSteps(arr, m + 1, r);

        // 合併過程 (Merge)
        let temp = [];
        let i = l, j = m + 1;
        while (i <= m && j <= r) {
            if (arr[i].data.id <= arr[j].data.id) {
                temp.push(arr[i++]);
            } else {
                temp.push(arr[j++]);
            }
        }
        while (i <= m) temp.push(arr[i++]);
        while (j <= r) temp.push(arr[j++]);

        // 將合併好的暫存陣列放回原陣列
        for (let k = 0; k < temp.length; k++) {
            arr[l + k] = temp[k];
        }
        
        yield; // 完成一次區塊合併後暫停更新畫面
    }
}

/**
 * 6. 堆積排序法 (Heap Sort)
 * 時間複雜度: O(n log n) | 穩定性: 不穩定
 */
function* heapify(arr, n, i) {
    let largest = i;
    let l = 2 * i + 1;
    let r = 2 * i + 2;

    if (l < n && arr[l].data.id > arr[largest].data.id) {
        largest = l;
    }
    if (r < n && arr[r].data.id > arr[largest].data.id) {
        largest = r;
    }

    if (largest !== i) {
        swap(arr, i, largest);
        yield; // 調整堆積結構時暫停
        yield* heapify(arr, n, largest);
    }
}

function* heapSortSteps(arr) {
    const n = arr.length;

    // 建立最大堆積 (Build Max Heap)
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
        yield* heapify(arr, n, i);
    }

    // 逐一取出堆積頂端最大值並進行調整
    for (let i = n - 1; i > 0; i--) {
        swap(arr, 0, i);
        yield; // 最大值放至末端後暫停
        yield* heapify(arr, i, 0);
    }
}