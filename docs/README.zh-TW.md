# 📦 專案概覽

<p align="center">
  <img src="../assets/images/logo.png" alt="寶可夢演算法 logo" width="120">
</p>

**寶可夢演算法 (Pokemon Algorithm)** 是一個基於純前端技術、零編譯建構步驟（Zero-build）、完美相容於 **GitHub Pages** 的靜態網頁應用程式。本專案利用 **1,025 隻寶可夢** 作為資料視覺化的核心，深入探索並展示電腦科學演算法、色彩量化與前端互動介面。

* **技術特點**：無需複雜的 npm 依賴或前端框架建構，純粹透過 HTML5、CSS3 與原生 JavaScript（搭配現代 ES Modules）實現高效能渲染。
* **部署說明**：可直接託管於 GitHub Pages，所有運算與視覺化邏輯完全在客戶端（Client-side）執行。

---

## 🗺️ 主要頁面說明

本專案包含多個功能豐富的子頁面與工具模組：

| 頁面檔案 | 核心功能與說明 |
| --- | --- |
| `index.html` | 專案歡迎頁、每日推薦寶可夢、分類預覽與全 1,025 隻寶可夢網格總覽。 |
| `pokedex.html` | 可進行模糊搜尋、世代、屬性與顏色過濾的高效能寶可夢圖鑑。 |
| `detail.html` | 物種詳情頁：三欄英雄區塊、Canvas 雷達圖、雙屬性矩陣、進化鏈及 4 個招式標籤頁。 |
| `color.html` | 單種寶可夢的專屬配色：支援 `?slug=` 參數、色階尺度展示與主題導出功能。 |
| `colors-generator.html` | 逆向色彩生成器：輸入任意 Hex 顏色，透過 OKLab 演算法找出最接近的寶可夢，並自動生成調色板。 |
| `colors-explore.html` | 收錄全部 1,025 個寶可夢調色板，支援無限捲動與 URL 篩選。 |
| `sorting.html` | 在 1,025 個 Sprite 畫布上展示 6 種排序演算法，並提供 2 至 6 車道競速模式。 |
| `maze.html` | BFS / DFS 路徑尋找視覺化，具備 40×40 網格與種子可控（Seedable RNG）隨機地圖。 |
| `life.html` | 結合康威生命遊戲（Conway's Game of Life）與真實遊戲內進化等級的生態模擬器。 |
| `graph.html` | 3D 力導向知識圖譜：包含 1,346 個實體與 2,687 條關聯、13 種關聯類型，支援搜尋、過濾及與詳情頁聯動的面板。 |
| `cries.html` | 收錄全 1,025 種叫聲卡片，具備響應式音色測量、5 個排序軸與即時波形渲染。 |
| `cries-gen1.html` | 第一世代 151 種叫聲透過 Game Boy APU 進行晶片音樂（Chiptune）重合成。 |
| `spectrum.html` | 每種叫聲的 Mel 頻譜分析視覺化，支援由左至右動態揭示。 |
| `types.html` | 屬性圖表與屬性瀏覽器。全站唯一顯示屬性相剋效果矩陣（Effectiveness Matrix）的地方。 |
| `category.html` | 集合清單模板頁面（支援 `?cat=<slug>` 參數動態載入）。 |
| `collections.html` | 集合中心：收錄 11 張主題卡片（分 4 個群組）及 2 個預告（upcoming）項目。 |
| `outfit.html` | 服裝顏色輸入 → MMCQ 色彩量化 → 透過 OKLab 對照全 1,025 種寶可夢配色的穿搭工具。 |
| `generations.html` | 跨越 9 個世代、38 款遊戲及 27 個地區初始寶可夢的歷史導覽。 |
| `model3d.html` | 3D 模型檢視器（支援 GLB 格式）；模型清單由 `glb-index.js` 自動生成。 |
| `404.html` | GitHub Pages 專用備用重定向頁面：將 `/detail/<slug>` 轉向至 `detail.html?slug=…&from404=1`。 |

---

## ⚙️ 安裝與本機執行

由於專案會透過 JavaScript 動態載入 JSON 資料與圖片，**嚴禁直接以 `file://` 協定開啟檔案**，否則會因為瀏覽器的 **CORS（跨來源資源共用）安全性限制** 導致資料與圖片讀取失敗。

請務必透過 HTTP 伺服器運行本機預覽：

1. **推薦方式（VS Code）**：
* 安裝 VS Code 擴充功能 **Live Server** (`ritwickdey.liveserver`)。
* 在專案根目錄點選右鍵，選擇 **"Open with Live Server"**（預設通常運行於 `port 5500`）。


2. **命令列方式（Python）**：
* 於專案根目錄執行以下指令：
```bash
python -m http.server 5500

```


* 接著在瀏覽器打開 `http://localhost:5500` 即可訪問。



---

## 📁 專案目錄結構

```text
pokemon-algorithm/
├── assets/          # 存放 css/, js/, data/, cries/, glbs/, images/ 等前端資產
├── docs/            # 存放 incidents/（各項技術約定與除錯紀錄文件）
├── scripts/         # 包含自動化檢查器 (check_*.mjs, test_check_*.mjs, lib/) 與資料處理腳本 (*.py)
└── data-sources/    # 原始 CSV/XLSX 檔案及溯源紀錄（執行階段不直接讀取）

```

* **無套件肥大問題**：專案無 `package.json`、無 `node_modules`、無複雜的打包編譯步驟。Node.js 僅在開發或執行驗證腳本時作為執行環境（`process.execPath`）。
* **無 CI 流程**：專案刻意不設定 `.github/workflows/`，所有驗證與測試均由開發者手動執行。

---

## 📐 關鍵技術約定

1. **嚴謹的路由與 Slug 規範**：內部導覽統一透過查詢參數（Query Parameters，如 `?slug=bulbasaur`）進行。`nidoran-f` (#029) 與 `nidoran-m` (#032) 必須嚴格區分，不允許使用模糊的 `nidoran` 通用 slug。
2. **色彩量化系統**：`color_palettes.json` 透過 MMCQ 演算法從 96x96 前視圖精煉出 6 色色盤，並精準對應 OKLab 色彩空間進行視覺比對。
3. **資料生成守則**：部分核心索引檔案（如 `genus-zh.js`, `glb-index.js`, `cry-index.js`, `color_palettes.json` 等）為自動化 Python 腳本生成之產物，**切勿直接手動編輯這些檔案**，以免下次重新生成時被覆蓋。

---

## 🧪 驗證與測試系統

本專案具備完善的自動化檢測與測試機制，涵蓋演算法正確性、色彩運算、音訊合成、網頁介面與路由檢查：

* **執行所有檢查器**：
```bash
node scripts/check_all.mjs

```


* **智慧快取機制 (`.cache/`)**：
* 系統會自動記錄檔案內容雜湊值（Content Hash）。若輸入檔案未改變，第二次執行時將會自動跳過（Skip），使重複執行的時間縮減至 `0.0s`。


* **命令參數支援**：
* `--only=<group>`：僅執行特定群組的檢查器（支援的群組包含 `algo`, `color`, `cry-apu`, `cry-data`, `cry-page`, `data`, `model`, `nav`, `sort`, `type`）。
* `--skip=<group>`：跳過指定群組。
* `--force`：強制重新執行所有檢查而不理會快取狀態。

---

## 🙏 特別感謝

本專案的資料與素材皆來自以下開放資料來源與社群專案，網站名稱一律沿用其原發布名稱。

* [PokéAPI](https://pokeapi.co/)
* [Pokédex | 台灣寶可夢官方網站](https://tw.portal-pokemon.com/play/pokedex/)
* [全國寶可夢圖鑑 2025 - 所有 1,025 隻寶可夢種族值、進化 & 招式 | InfoPoke](https://infopoke.net/zh-tw)
* [PokémonPalette - Extract Color Palettes from Pokémon Sprites | Color Generator Tool](https://www.pokemonpalette.com/)
* [Pokemon Palettes](https://pokepalettes.com/)
* [Pokémon Database -- the fastest way to get your Pokémon information](https://pokemondb.net/)
* [PMD Sprite Repository](https://sprites.pmdcollab.org/)
* [Pokémon 3D Optimized Model Viewer by Pokemon-3D-api](https://pokemon-3d-api.oneapp.dev/)
* [PokéMaps – Interactive Pokémon Maps & Catch Locations](https://pokemaps.net/)
