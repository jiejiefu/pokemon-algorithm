# 專案架構導覽（GitNexus 版）

> 以 GitNexus 靜態索引（commit `81c452b`，2026-10-25 盤點）加上人工複核整理。
> 目標讀者：第一次加入、需要改動程式碼的人。
>
> 這份文件回答「程式碼怎麼組織、依賴往哪走、改動會影響誰」。
> 它**不**回答「這個網站有什麼頁面」，也**不**取代 `AGENTS.md` 的規則。

---

## 0. 先讀哪一份

| 文件 | 讀者 | 回答什麼 |
| :--- | :--- | :--- |
| `docs/README.zh-TW.md` | 訪客、使用者 | 這是什麼專案、有哪些頁面、怎麼本機啟動 |
| `AGENTS.md` | 代理人、維護者 | 不可違反的規則（§3）、驗證指令與成本（§4）、資料重生順序（§5） |
| **本文件** | 新加入的開發者 | 分層、依賴圖、資料表流向、GitNexus 怎麼用、改動影響範圍 |
| `docs/incidents/*.md` | 除錯者 | §3 每條規則背後的除錯紀錄（六個檔，共 400 KB） |

三份文件的關係：README 講**產品**，AGENTS 講**紀律**，本文件講**結構**。

---

## 1. 30 秒版本

- **技術**：31 個靜態 HTML、62 個原生 ES Module、19 個 CSS、23 張 JSON。零框架、零打包、零 npm 依賴、零 CI。
- **一句話分層**：
  `HTML`（入口殼）→ `assets/js/<page>.js`（頁面控制器）→ **純模組**（26 支零 import，只做運算）→ `shared.js`（跨頁共用平台）→ `assets/data/*.json`（資料）→ `scripts/`（產生器 + 驗證器）。
- **最重要的一條結構規則**：
  **頁面不碰資料細節，純模組不碰 DOM，`shared.js` 只放真的跨頁共用的東西。**
- **第二條**：`assets/data/` 與 `assets/js/` 底下由腳本產生的檔案**不准手改**（清單見 §8）。

---

## 2. 索引現況

| 項目 | 值 |
| :--- | :--- |
| 索引 commit | `81c452b27744b49e761a97d627889c490c26d660`（branch `main`）|
| 索引時間 | 2026-10-25T08:26:36Z，GitNexus CLI 1.6.12 |
| files / symbols / edges | 396 / 10,408 / 31,819 |
| communities / processes | 609 / 508 |
| embeddings | **0**（只用圖 + BM25，沒有向量檢索）|
| 儲存位置 | `.gitnexus/`（本機，不進版控的索引產物）|
| 目前狀態 | **已刪除**（2026-10-25，189 MiB／Finder 顯示 198.6 MB）。本文件保留的是當天的索引快照 |

**索引新鮮度**：盤點當時工作樹只有 `AGENTS.md` 被修改，程式碼與索引一致。
判斷方式：

```bash
git rev-parse HEAD        # 應等於上表的索引 commit
```

### 重建索引（需要時才做）

索引不是必需品 —— 只有要用 GitNexus 查圖時才需要。重建會再佔 189 MiB：

```bash
npx gitnexus analyze          # 在 repo 根目錄；會重新產生 .gitnexus/
npx gitnexus setup            # 每個編輯器只需要設定一次（MCP 連線）
npx gitnexus serve            # 要用 web UI / MCP HTTP 時才啟動
```

重建後 `.gitnexus/run.cjs` 也會回來，屆時 `npx gitnexus ...` 與
`node .gitnexus/run.cjs ...` 兩種寫法都可用。

> MCP 端點在 `http://localhost:4747/api/mcp`。沒開 server 時一律走 CLI，語法見 §10。
> 刪掉索引不影響網站、不影響 checker、不影響任何執行期功能 —— 它只影響「用圖查程式」這件事。

---

## 3. 六層架構

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 頁面殼        31 × *.html                                  │
│    每頁一個 inline <script type="module">，只做 import + init  │
├──────────────────────────────────────────────────────────────┤
│ 2. 頁面控制器    assets/js/<page>.js        （team.js 100 符號）│
│    抓 DOM、組 HTML、綁事件、呼叫純模組                          │
├──────────────────────────────────────────────────────────────┤
│ 3. 純模組        26 支零 import（type-chart、color-match、     │
│    maze-pathfinding、cry-seq-pattern、gb-apu …）               │
│    無 DOM、無 fetch → 可在裸 Node 直接測                        │
├──────────────────────────────────────────────────────────────┤
│ 4. 平台層        assets/js/shared.js       （106 符號；15 個     │
│    導覽 / 主題 / 路徑 / 徽章 / 卡片 / 資料 loader               │
│    執行期模組 import 它，另有 7 支 checker）                    │
├──────────────────────────────────────────────────────────────┤
│ 5. 資料層        assets/data/*.json（23 張，16 MB）             │
│    全部由 scripts/*.py 產生                                     │
├──────────────────────────────────────────────────────────────┤
│ 6. 驗證層        scripts/check_*.mjs 64 + test_check_*.mjs 28  │
│    + lib/ 9；由 check_all.mjs 手動驅動，無 CI                   │
└──────────────────────────────────────────────────────────────┘
```

**依賴方向只有一個**：第 1 層往下叫，第 3 層不回頭碰第 2、4 層。
唯一例外是 `shared.js` 會 import 兩個「資料索引模組」（`form-names.js`、`shiny-index.js`），
因為它們是純資料查表，不是頁面邏輯。

---

## 4. 平台層：`shared.js` 的分區

`shared.js` 有 106 個符號、2,395 行，是全站最重要的檔案。
它的行號分區（由 GitNexus `context` + 原始碼核對）：

| 行號 | 區段 | 代表符號 | 誰在用 |
| ---: | :--- | :--- | :--- |
| 26–110 | 常數與型別 | `SITE_VERSION`、`TYPE_EN_ZH`、`TYPE_COLORS`、`MOVE_TABS`、`typeBadgeHtml` | 幾乎每一頁 |
| 112–198 | 路徑與資料載入 | `ASSETS`、`loadPokemonData`、`formatPokemonId`、`nameEn` | 每一頁 |
| 199–264 | Slug 與路由 | `SYMBOL_SLUGS`、`pokemonSlug`、`pokemonDetailPath`、**`pokemonDetailUrl`** | detail / color / types / moves |
| 266–440 | 色彩與卡片 | `toLinear`、`luminance`、`contrast`、`hexToRgb`、`typePair`、`createPokemonCard` | 圖鑑、分類頁、首頁 |
| 446–680 | 圖示與主題 | `ICON_PATHS`、`iconSvg`、`THEME_*`、`initThemeToggle`、`readThemeToken` | 每一頁 |
| 686–1290 | 導覽 | `NAV`、`PLANNED_PAGES`、`initHeaderNav`、`initFooterNav`、`initNavDropdowns`、`initMobileNav` | 每一頁 |
| 1388–1660 | 色彩頁側欄 | `RAIL_COOKIE`、`initColorRail`、`applyCollapsed` | `color*.html` |
| 1687–2395 | 寶可夢圖 / 進化 / 招式表 | `PokemonNode`、`loadEvolutionChain`、`moveTableHtml`、`renderMoveSection`、`wireRoving` | detail / types / move |

**四條硬規則**（違反會被 checker 抓到）：

1. `pokemonDetailUrl()`（L256）與 `paletteUrl()` 是**唯一**合法的 URL 產生器；禁止手拼、禁止字串取代 `detail.html`。
2. `NAV`（L734）是導覽的唯一註冊表；新頁面沒註冊就不會出現在任何 header。
3. `ASSETS`（L113）是資產路徑的唯一來源；不要在頁面裡寫死 `assets/data/...`。
4. `initThemeToggle()` 會**注入**圖示，HTML 裡那顆按鈕必須保持空的。

---

## 5. 頁面 → 模組 → 樣式（31 頁全表）

`shared.js` / `shared.css` 每一頁都有（`404.html` 除外，它不載任何模組），下表省略。
**粗體**是該頁的入口控制器。

| 頁面 | 依賴模組（除 `shared.js`） | 專屬 CSS |
| :--- | :--- | :--- |
| `index.html` | **home-hero**, hero-gen, home-sections | home-sections.css |
| `today.html` | categories, pokemon-lexicon, daily-pick | — |
| `pokedex.html` | （只 import `shared.js`） | — |
| `detail.html` | shiny-index, color-palette, cry-index, cry-player, pokemon-lexicon | detail.css |
| `team.html` | **team** → team-analysis, team-state, team-moves, type-chart, color-palette | team.css |
| **`moves.html`** | **moves** | moves.css |
| **`move.html`** | **moves**, sv-index | moves.css |
| `abilities.html` | **abilities** → color-palette, sv-index | abilities.css |
| `ability.html` | **abilities** | abilities.css |
| `types.html` | type-chart, sv-index, pokemon-lexicon | — |
| `category.html` | **categories** | — |
| `collections.html` | **categories** | — |
| `generations.html` | （只 import `shared.js`） | — |
| `color.html` | **color-palette**, pokemon-lexicon, daily-pick, code-highlight | colors.css |
| `colors-explore.html` | **color-palette**, type-chart, pokemon-lexicon | colors.css |
| `colors-generator.html` | **color-palette**, color-match, mmcq-anatomy, cover-roster | colors.css, colors-generator.css |
| `color-game.html` | **color-game**（外部 module）+ color-match/daily-pick/game-* 由它自己 import | colors.css, color-game.css |
| `outfit.html` | **outfit-palette**, color-palette, color-match, mmcq, code-highlight | colors.css, outfit.css |
| `sorting.html` | **sort-run**, sort-keys, sorting-algorithms, cry-player | algo.css |
| `maze.html` | **maze-pathfinding** | algo.css |
| `life.html` | **life** → life-engine, type-era, type-chart, cry-player | life.css |
| `graph.html` | **graph**, graph-header（+ vendored `3d-force-graph.min.js`、`three.min.js`）| graph.css |
| `silhouette-draft.html` | **silhouette-draft** → silhouette-draft-game, team-analysis, team-moves | silhouette-draft.css |
| `cries.html` | **cry-player**, cry-index, cry-autoplay, cover-roster | cries.css |
| `cries-gen1.html` | **gb-apu**, cry-autoplay | cries.css |
| `spectrum.html` | **cry-spectrogram**, cry-player, cry-index, cry-autoplay, gb-apu, species-ramp, cover-roster | spectrum.css |
| `cry-game.html` | **cry-game**（外部 module）+ cry-player, cry-game-similarity, cry-autoplay | cry-game.css |
| `cry-studio.html` | **cry-seq-engine**, cry-seq-pattern, cry-seq-roll, cry-index | cry-seq.css |
| `cry-studio-pro.html` | **cry-seq-pro-engine**, cry-seq-pro-pattern, cry-seq-pro-roll, cry-index | cry-seq-pro.css |
| `model3d.html` | **model3d-viewer**, glb-index | — |
| `404.html` | （無） | — |

**兩個例外要知道**：

- `color-game.html`（L226）與 `cry-game.html`（L200）用 **`<script type="module" src="...">`** 載入入口，
  其他頁面都是在 inline module 裡 `import`。找入口時不要只看 inline。
- `cry-studio-pro.html` **不在 `NAV` 裡**，只由 `cry-studio.html:55` 的切換鈕連過去（刻意的進階模式頁）。

### 頁面入口長什麼樣

以 `team.html:144` 為模板：

```html
<script type="module">
  import { initThemeToggle, initHeaderNav } from './assets/js/shared.js';
  import { initTeamPage } from './assets/js/team.js';

  initThemeToggle();
  initHeaderNav('team.html');   // 這一個字串決定哪個 nav 項目亮

  initTeamPage();
</script>
```

**新增頁面時的四件事**：建立 HTML（`</body></html>` 缺一不可，§3.I1）→ 掛 `shared.css` + 自己的 CSS →
inline module 呼叫 `initThemeToggle()` + `initHeaderNav('<自己>.html')` → 在 `shared.js:734` 的 `NAV` 註冊。

---

## 6. 模組依賴圖

### 6.1 樞紐排名（被幾個模組 import）

GitNexus 的 `IMPORTS` 邊會把 **checker 也算進去**（checker 直接 import 平台模組來共用同一套計算，
這是刻意的）。下表分兩欄，才不會把驗證層的依賴誤讀成執行期依賴：

| 模組 | 執行期 importers | 全部（含 `scripts/`）| 角色 |
| :--- | ---: | ---: | :--- |
| `shared.js` | **15** | **22**（+7 checker）| 平台層，全站共用 |
| `type-chart.js` | 6 | 12 | 屬性相剋的唯一來源（§3.D）|
| `color-palette.js` | 6 | 9 | 色盤 / sprite URL / OKLab |
| `cry-player.js` | 5 | 5 | 播放器（單例 `cryPlayer`）|
| `daily-pick.js` | 4 | 5 | 每日抽選（`taipeiDateKey`）|
| `maze-pathfinding.js` | 3 | 4 | BFS/DFS/A* + 地形成本 |
| `team-moves.js` | 3 | 5 | 招式表 + 四招組裝 |
| `team-analysis.js` | 2 | 4 | 防禦 / 覆蓋計算 |
| `color-match.js` | 2 | 4 | OKLab 最近色 |
| `cry-index.js` | 2 | 5 | 叫聲檔案索引 |
| `type-era.js` | 2 | 3 | 世代 × 屬性 |
| `shiny-index.js` | 2 | 3 | 異色有無查表 |
| `team-state.js` | 1 | 3 | `?team=` / `?moves=` 解析 |
| `sorting-algorithms.js` | 1 | 3 | 排序步驟產生器 |
| `life-engine.js` | 1 | 3 | Conway + 進化 |
| 其餘模組 | 1 | 1–2 | 葉節點 |

**讀法**：`shared.js` 的 7 個 checker 依賴代表「驗證層會直接跑平台層的程式」，
所以平台層的計算改了，checker 也會跟著用新程式碼判斷 —— 這正是它抓得到不一致的原因。

### 6.2 26 個「零 import」純模組

這一組就是驗證層的測試對象 —— 它們不需要瀏覽器、不需要伺服器，可以在裸 Node 直接 `import`：

`type-chart` `color-match` `mmcq` `mmcq-anatomy` `maze-pathfinding` `sorting-algorithms` `sort-run`
`species-ramp` `outfit-palette` `cry-seq-pattern` `cry-seq-pro-pattern` `cry-spectrogram`
`gb-apu` `cry-index` `cry-autoplay` `game-hints` `game-tips` `cover-roster`
`code-highlight` `shiny-index` `sv-index` `glb-index` `genus-zh` `form-names-zh` `home-hero` `moves`

判準不是「有沒有 import」，而是**有沒有碰 DOM 或 fetch**。
幾個「只依賴其他純模組」的近純模組：`life-engine`（→ type-era）、`color-palette`（→ shared）、
`daily-pick`（→ categories）、`pokemon-lexicon`、`type-era`。
這一圈仍然全部可在 Node 測，只是要先滿足它的 import。
`assets/js/moves.js` 是另一種例外：零 import，但 `loadJson()` 會 fetch。

### 6.3 依賴邊（依功能分群）

```
資料 / 屬性（以下只看 assets/js 內部，頁面端的 import 見 §5）
  type-chart ──── team-analysis, team, life, type-era, sort-keys, pokemon-lexicon
  color-palette ─ abilities, team, cry-game, color-game, home-sections,
                  silhouette-draft（頁面端：所有 color*.html、team、detail）
  cry-index ───── cry-player, graph
  daily-pick ──── hero-gen, color-game, game-similarity, cry-game-similarity
  
隊伍 / 選秀
  team → team-analysis, team-state, team-moves（+ shared, color-palette, type-chart）
  team-state → team-moves
  silhouette-draft → silhouette-draft-game → team-analysis, team-moves

聲音
  cry-player → cry-index
  cry-seq-engine → cry-seq-pattern；cry-seq-pro-engine → cry-seq-pro-pattern
  cry-seq-roll → cry-seq-pattern；cry-seq-pro-roll → cry-seq-pro-pattern
  gb-apu → 無（純合成器；由 cries-gen1 / spectrum 直接 import）

首頁
  home-sections → home-showcase, home-maze-game（+ color-palette）
  home-showcase → sorting-algorithms, sort-keys, maze-pathfinding, home-sprite-grid
  home-maze-game → maze-pathfinding, home-sprite-grid, cry-player
```

完整 76 條邊見**附錄 A**。

### 6.4 模組大小排名（符號數）

| 模組 | 符號 | 說明 |
| :--- | ---: | :--- |
| `color-palette.js` | 166 | 色盤、sprite、OKLab、URL、shade 生成都集中在這 |
| `cry-seq-pro-pattern.js` | 115 | 進階編曲機的純資料層 |
| `shared.js` | 106 | 平台層 |
| `team.js` | 100 | 頁面控制器中包含最多 DOM 組裝 |
| `color-game.js` | 96 | 遊戲狀態機 |
| `maze-pathfinding.js` | 86 | BFS/DFS/A* + 地形 |
| `life-engine.js` | 84 | Conway + 進化拓撲 |
| `cry-seq-pattern.js` | 83 | 編曲機純資料層 |
| `life.js` | 81 | 頁面控制器 |
| `model3d-viewer.js` | 77 | three.js 包裝 |

`assets/js` 全部：**976 個 Function、186 個 Method、500 個 Const**。

### 6.5 圖上**沒有**邊的三個地方（重要）

| 缺口 | 原因 | 怎麼補 |
| :--- | :--- | :--- |
| HTML → JS | 入口是 inline `<script type="module">`，tree-sitter 不解析 HTML | 用 §5 的表，或 `rg -o "from '(\./)?assets/js/[^']+'"` |
| JS → JSON | `fetch()` 是執行期字串，不是 import | 用 §7 的表 |
| HTML → CSS | `<link>` 不是程式關係 | 用 §5 的表 |

CSS 沒有進入依賴圖，是這份索引最大的盲點；改 `shared.css` 時請看 §12 的 `nav` + `color` 群組。

---

## 7. 資料層：23 張表

產生的檔案**不要手改**（改了下一次重生就沒了）。欄位「產生者」取自 `AGENTS.md` §2 與 `scripts/` 實際輸出。

| 表 | KB | 產生者 | 執行期消費者 | 備註 |
| :--- | ---: | :--- | :--- | :--- |
| `learnsets.json` | 4,415 | `fetch_moves.py` | `moves.js`（moves / move）| 跨世代聯集，`total` 是**不重複**寶可夢數 |
| `pokemon_data.json` | 2,844 | `enhance_pokemon_data.py` | 7 處（pokedex / detail / types…）| 基礎表；**重生會變成 1,350 筆，不是 1,025** |
| `graph_data.json` | 1,630 | `build_graph_data.py` | `graph.js` | 1,346 節點 / 2,794 邊 |
| `color_palettes.json` | 642 | `extract_color_palettes_mmcq.py` | `color-palette.js` | 2,050 盤；3 盤只有 5 色，不補 |
| `team_moves.json` | 593 | `build_team_moves.py` | `team-moves.js` | 919 招 + 1,025 隻四招字串 |
| `cry_features.json` | 499 | `analyze_cries.py` | `cry-player` / `cry-spectrogram` / `cry-game` / `cover-roster` | 34 維，15 種取樣率重採到 16 kHz |
| `moves_zh.json` | 496 | `fetch_moves.py` | `moves.js` | 826 PokeAPI + 93 InfoPoke/OpenCC |
| `move_learners.json` | 424 | `fetch_moves.py` | `moves.js` | 反向索引（招式 → 學習者）|
| `ability_species.json` | 379 | `fetch_abilities_detail.py` | `abilities.js` | 正向持有者 |
| `evolution_chains.json` | 377 | `extract_evolution_chains.py` | `shared.js`（進化鏈渲染）| 541 條鏈 |
| `team_roster.json` | 142 | `build_team_roster.py` | `team.js` | 145 KB → 22 KB gzip，就是不載 2.8 MB |
| `abilities.json` | 136 | `fetch_abilities_detail.py` | `abilities.js` | 314 筆 |
| `gen1_cry_sfx.json` | 92 | `fetch_gen1_cries.py` | `gb-apu.js` | 38 個基底叫聲 |
| `species_abilities.json` | 89 | `fetch_abilities_detail.py` | `abilities.js` | 反向（id → 特性），88 KB |
| `home_roster.json` | 88 | `build_home_roster.py` | `home-sections.js`、`home-showcase.js` | 首頁兩個 demo 專用，90 KB / 19 KB gzip |
| `gen1_conformance.json` | 81 | 固定測試資料 | **無（只有 checker 讀）** | `check_gen1_apu.mjs` 的基準 |
| `type_profiles.json` | 67 | `fetch_type_profiles.py` | `types.html`、`categories.js` | 三種來源分欄保存 |
| `move_learners_count.json` | 54 | `fetch_moves.py` | `moves.js` | 列表頁用的輕量計數 |
| `draft_roster.json` | 46 | `build_draft_roster.py` | `silhouette-draft.js` | 568 隻最終/單階 |
| `evolution_levels.json` | 30 | `fetch_evolution_levels.py` | `life.js`、`life-engine.js`、`color-game.js` | 348 對有真實等級，141 對回退 Lv.30 |
| `abilities_zh.json` | 19 | `fetch_abilities.py` | 3 處 | 官方繁中名 |
| `gen1_cries.json` | 14 | `fetch_gen1_cries.py` | 2 處 | pokered 表 |
| `generations.json` | 5 | `extract_generations.py` | 2 處 | 9 世代 / 38 遊戲 |

**兩個載入策略**：

- **eager**：`color_palettes.json`（254 KB / 74 KB gzip）跟著頁面直接載，因為每個色彩頁都需要全部。
- **gate / 延後**：`learnsets.json`（223 KB gzip）、`team_moves.json`（只在有隊員後才 fetch）、`home_roster.json`（進到首頁 demo 可視範圍才載）。

`pokemon_data.json` 是**沒人想要但大家都在用**的重表（2.8 MB）。新頁面請優先找替代的 slim 表
（`team_roster`、`home_roster`、`draft_roster`），這三張就是為此存在的。

---

## 8. 驗證層：64 + 28 + 9

| 類別 | 數量 | 位置 | 作用 |
| :--- | ---: | :--- | :--- |
| `check_*.mjs` | 64 | `scripts/` | 斷言（0.1 s – 40 s）|
| `test_check_*.mjs` | 28 | `scripts/` | 變異測試：故意弄壞，確認 checker 會紅 |
| `lib/` | 9 | `scripts/lib/` | `assert` `negative` `pool` `cdp-port` `cdp-until` `mute-tap` `png` `tmp-trees` `record-inputs` |
| `*.py` | 34 | `scripts/` | 資料產生器（不屬驗證層，見 §9）|

### 18 個群組與成本（實測快照）

| 群組 | 秒 | 項目 | 開 Chrome |
| :--- | ---: | ---: | :---: |
| `graph-browser` | 52.6 | 2 | 是（`serial: true`）|
| `cry-page` | 39 | 9 | 否（但 `test_check_cry_game_similarity` 一個就 28.8 s）|
| `moves-browser` | 27.9 | 1 | 是 |
| `audio-browser` | 25.8 | 4 | 是 |
| `sort` | 22 | 2 | 是（harness 內 25 次 boot）|
| `color` | 21.4 | 16 | 否 |
| `nav` | 9.3 | 21 | 否 |
| `cry-data` | 8.4 | 8 | 否 |
| `life-browser` | 7.1 | 1 | 是（`serial: true`）|
| `outfit-browser` | 6.8 | 1 | 是 |
| `cry-apu` | 5.6 | 1 | 否 |
| `types-browser` | 5 | 1 | 是 |
| `game-browser` | 4.3 | 1 | 是 |
| `type` | 3.3 | 4 | 否 |
| `data` | 1.8 | 10 | 否 |
| `algo` / `model` / `home` | 0.8 | 7 | 否 |

**這台機器不要把 `node scripts/check_all.mjs` 當預設動作**：冷啟動會開 13 個 headless Chrome。
依改動範圍挑最窄的：

```bash
node scripts/check_moves_data.mjs && node scripts/check_moves_page.mjs   # 0.1 s + 0.2 s
node scripts/check_all.mjs --only=home                                   # 0.2 s，不開瀏覽器
node scripts/check_all.mjs --only=cry-page                               # 39 s，純 Node 但很貴
```

快取規則（`.cache/check-state.json`）：內容 hash 沒變就 SKIP，第二次全套 0.0 s；**FAIL 不會更新快取**；
改過 checker 本身要用 `--force --only=<群組>`。

---

## 9. 資料生產線

34 支 Python 腳本，**手動、照順序跑**，順序寫在 `AGENTS.md` §5。這裡只列骨架：

```
enhance_pokemon_data.py          # 1. 基礎表（會變 1,350 筆，勿盲跑）
 ├─ build_home_roster.py         # 1b. 首頁 slim 表
 ├─ build_team_roster.py         # 1c. 隊伍 slim 表
 └─ build_team_moves.py          # 1d. 招式表
fix_pokemon_names.py             # 2. 繁中名
fetch_breeding_data.py           # 3. 生蛋資料
fetch_regional_dex.py            # 4. 地區圖鑑
fetch_abilities.py               # 5. 特性名
fetch_abilities_detail.py        # 5b. abilities.json + 正向 + 反向
fetch_form_names.py              # 6. 形態名
fetch_moves.py                   # 7. 招式 + 學習集 + 兩個索引（一次寫四檔）
scrape_zh_descriptions.py        # 8. 描述
extract_color_palettes_mmcq.py   # 9. 2,050 盤
fetch_type_profiles.py           # 10. 屬性文案
fetch_sv_sprites.py → extract_sv_index.py   # 11. SV 圖 + 索引
fetch_gen1_cries.py              # 12. Gen-I 叫聲
fetch_evolution_levels.py        # 13. 進化等級
fetch_form_stats.py → build_graph_data.py   # 13b. 圖資料
analyze_cries.py                 # 14. 叫聲特徵
```

**一次寫多檔的腳本**（不能只跑一半）：`fetch_moves.py`（4 檔）、`fetch_abilities_detail.py`（3 檔）、
`fetch_gen1_cries.py`（2 檔）、`build_graph_data.py`（讀 `pokeapi_form_stats.json`，該檔 gitignored）。

**不准手改**的代表：`genus-zh.js`、`form-names-zh.js`、`glb-index.js`、`sv-index.js`、`cry-index.js`、
`color_palettes.json`、`moves_zh.json`、`learnsets.json`、`abilities.json`、`graph_data.json`、九支 hero 影片。

---

## 10. GitNexus 實戰

### 10.1 四種問題 → 四種工具

| 你想問 | 用哪個 | 這專案的實際情況 |
| :--- | :--- | :--- |
| 「這頁依賴什麼？」 | `rg`（HTML 不在圖裡）| §5 的表 |
| 「這個符號是誰在用？」 | `context` | 回傳 incoming / outgoing / process 參與 |
| 「改這個會壞什麼？」 | `impact` | 回傳深度分組 + 風險 + 受影響流程 |
| 「這條流程怎麼跑？」 | `query` → process resource | 但 process 名稱是合成的，見 §13 |

CLI 與 MCP 對應（本專案用 MCP，因為 server 已啟動）：

```bash
npx gitnexus cypher "<查詢>" --repo .
npx gitnexus context "符號名" --repo .
npx gitnexus impact "符號名" --direction upstream --repo .
npx gitnexus detect-changes --scope all --repo .
```

### 10.2 範例 A：誰在依賴 `shared.js`

```bash
npx gitnexus cypher \
  "MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File)
   WHERE b.filePath = 'assets/js/shared.js'
   RETURN a.filePath ORDER BY a.filePath" --repo .
```

實測 22 個 importers = **15 個執行期模組 + 7 支 checker**（`check_abilities_page`、`check_categories`、
`check_draft_page`、`check_learnsets`、`check_life_page`、`check_moves_page`、`check_pokemon_names`）。
**改 `shared.js` 的真正風險不是那 22 個檔案，是 31 個頁面** —— 因為 HTML 端不在圖裡（§6.5）。
所以改完要跑 `--only=nav` + `--only=color`。

### 10.3 範例 B：`defensiveMultiplier` 的爆炸半徑（完整走一遍）

這是本專案最適合當教材的符號，因為它同時被頁面與 checker 使用。

**第一步：看它自己**

```bash
npx gitnexus context "defensiveMultiplier" --repo .
```

回傳（實測節錄）：

- 定義：`assets/js/team-analysis.js:17-24`（8 行）
- outgoing：**空**（只讀 `TYPE_CHART`，不呼叫任何函式）
- 直接呼叫者 6 個：`analyzeTeam`、`bestAgainst`、`defensiveProfile`、
  `renderDefense`（`team.js`）、`attackProfile`（`silhouette-draft-game.js`）、`check_team_page.mjs`
- 參與的流程 2 條：`RenderAnalysis → DefensiveMultiplier`（4/4）、`ConfirmMatch → DefensiveMultiplier`（3/3）

**第二步：查上游影響**

```bash
npx gitnexus impact "defensiveMultiplier" --direction upstream --repo .
```

實測結果：

| 指標 | 值 |
| :--- | :--- |
| risk | **CRITICAL** |
| riskSharedAxes | MEDIUM |
| 受影響符號 | 11（d1: 6、d2: 4、d3: 1）|
| 受影響流程 | 6 |

受影響的入口（d=1 直接壞，`team.js` 一個檔案佔五個）：

| 符號 | 檔案 | 角色 |
| :--- | :--- | :--- |
| `renderAnalysis` | `team.js` | 隊伍分析主渲染 |
| `chooseMove` | `team.js` | 招式選擇器 |
| `renderDefense` | `team.js` | 防禦表 |
| `ensureMoves` | `team.js` | 四招載入 |
| `openMoveDialog` | `team.js` | 對話框 |
| `confirmMatch` | `silhouette-draft-game.js` | 選秀對戰結算 |

**這正是 `AGENTS.md` 要你在改動前跑 `impact` 的理由**：一個 8 行的乘法函式，
牽動隊伍頁與剪影選秀兩個功能；而 `risk: CRITICAL` 不是「大概會壞」，是「d=1 有 6 個直接呼叫者」。

### 10.4 範例 C：一條流程長什麼樣

`gitnexus://repo/pokemon-algorithm/process/RenderAnalysis → DefensiveMultiplier`

```
1. renderAnalysis      assets/js/team.js
2. analyzeTeam         assets/js/team-analysis.js
3. bestAgainst         assets/js/team-analysis.js
4. defensiveMultiplier assets/js/team-analysis.js
```

讀法：`renderAnalysis`（頁面）→ `analyzeTeam`（彙總）→ `bestAgainst`（單招）→ `defensiveMultiplier`（屬性表）。
四步，跨 2 個檔案，這就是「頁面控制器 → 純模組」的分工在圖上的樣子。

### 10.5 範例 D：改資料表前先查消費者

```bash
npx gitnexus cypher \
  "MATCH (f:File) WHERE f.filePath ENDS WITH 'team_moves.json' RETURN f.filePath" --repo .
```

JSON 不在圖裡，所以這一步查不到東西 —— **這不是錯誤，是邊界**。
資料表的流向只有兩個可靠來源：`rg` 與 §7 的表。

```bash
rg -l --fixed-strings "team_moves.json" --glob '!assets/data/*' .
```

### 10.6 Cypher 方言限制（實測，省你半小時）

| 寫法 | 結果 |
| :--- | :--- |
| `f.path` | 錯，屬性是 **`filePath`** |
| `f.extension` | 錯，沒有這個屬性；用 `ENDS WITH '.json'` |
| `split(p,'.')` | 錯，**沒有 `split()`** |
| `WHERE (n:Function OR n:Method)` | 解析錯誤；label 判斷要分開查或 `MATCH (n:Function)` |
| `labels(s)[0]` | 回傳空字串（可用，但別依賴）|
| `count(DISTINCT a)`、`STARTS WITH`、`ENDS WITH`、`ORDER BY`、`LIMIT` | 可用 |

---

## 11. 五步學習路線（約 70 分鐘）

| # | 動作 | 時間 | 驗收 |
| ---: | :--- | ---: | :--- |
| 1 | 讀 §3 + §5，把 31 頁分成「資料型 / 遊戲型 / 工具型」三類 | 10 分 | 說得出 `team.html` 與 `types.html` 為何依賴不同模組 |
| 2 | 跑 §10.2，確認 `shared.js` 有 15 個執行期 importer（+7 支 checker）| 5 分 | 解釋為何風險是 31 頁不是 22 檔 |
| 3 | 跑 §10.3，讀 `team-analysis.js:1-120` | 15 分 | 說得出 `defensiveMultiplier` 為何是 CRITICAL |
| 4 | 挑一個純模組（建議 `type-chart.js` 或 `maze-pathfinding.js`），跑 `context` | 15 分 | 說得出它為何能在裸 Node 測 |
| 5 | 讀 `AGENTS.md` §3.A / §3.B / §3.AA + §4 對照表 | 20 分 | 給一個假設改動，說出要跑哪個 `--only` 與哪支 checker |

**第一天不要做的事**：不要跑 `check_all.mjs`、不要重生 `pokemon_data.json`、不要碰 `shared.css`。

> 每步的參考解答在 **[附錄 D](#附錄-d五步學習路線的參考解答)**。
> 用法：先用 30 秒寫下自己的答案，再展開對照；五題各 20 分，60 分以上建議開始改程式碼。

---

## 12. 任務速查表（改什麼 → 跑什麼）

| 你改了 | 先跑這個 | 為什麼 |
| :--- | :--- | :--- |
| 任何 `.html` 的 nav / 結構 | `--only=nav` | 21 個項目，含 `check_js_syntax`、`check_page_module_api` |
| `shared.js` / `shared.css` | `--only=nav` **加** `--only=color` | 兩組都會讀 shared |
| `team.*` | `--only=nav` | 229 + 32 檢查，不開瀏覽器 |
| `moves.*` / `move.html` | `check_moves_data.mjs && check_moves_page.mjs` | 0.3 s |
| `abilities.*` | `check_abilities_page.mjs`（資料改動再加 `check_abilities_data.mjs`）| 0.2 s |
| `color-*.js` / `colors*.css` | `--only=color` | 16 項目，全部 < 5 s |
| `color-game.*` | `--only=color`，再 `check_color_game_browser.mjs` | 第二個要 Chrome，只為算繪宣稱 |
| `sorting.*` | `test_check_sorting_page.mjs --static`，再 `--only=sort` | 前者 0.3 s |
| `maze.*` / `maze-pathfinding.js` | `--only=algo`，再 `--only=life-browser` | 三個靜態 0.4 s |
| `graph.*` / `graph_data.json` | `--only=model`，再 `--only=graph-browser` | 後者 52.6 s，只在版面真的改了才跑 |
| `cries*` / `cry-player.js` / `gb-apu.js` | `--only=cry` | 會含 39 s 的 cry-page |
| `team_moves.json` | `check_team_moves.mjs` | 54 檢查 |
| `assets/data/*.json` | 由表決定：招式 → `moves`、色盤 → `color`、叫聲 → `cry-data` | 見 §7 |
| 任何 `scripts/*` | `--force --only=<它的群組>` | 改 checker 不會讓快取失效 |

**規則**：一次改動只跑它需要的檢查；**一次 PASS 就是證據**，不要重跑「看它會不會過」。

---

## 13. 已知邊界（不要誤讀索引）

| 現象 | 事實 | 對策 |
| :--- | :--- | :--- |
| `clusters` 只回 2 個模組（`Js` 1092 / `Scripts` 1035）| community 的 `heuristicLabel` 只反映副檔名，609 個群集全是 `Js` / `Scripts` | 用 import 圖 + §5 / §7 的表分區 |
| `processes` 前 20 筆全是 `X → Y`、`step_count: 10` | 是分析器合成的候選鏈，不是命名過的使用者旅程 | 當「呼叫鏈」讀，不要引用成功能名稱 |
| HTML、CSS、JSON 沒有任何節點或邊 | 分析器只解析 JS / Python | §5 / §7 的表是唯一來源 |
| `embeddings: 0` | `query` 只靠 BM25，不是語意搜尋 | 用符號名或英文關鍵字查，不要用長句 |
| `risk: UNKNOWN` | 代表「查不到呼叫者」，不是「安全」| 先 `rg` 確認再改 |
| `docs/` 裡有約 397 KB 的 incidents | 不在圖裡，是規則的背景故事 | 改到 §3 涵蓋的區域前，讀對應段落 |

---

## 附錄 A：76 條 import 邊（`assets/js` 內部）

```
abilities        → shared, color-palette, sv-index
categories       → shiny-index, shared
color-game       → shared, color-palette, color-match, daily-pick,
                   game-similarity, game-hints, game-tips
color-palette    → shared
cry-game         → shared, color-palette, cry-player, cry-autoplay, cry-game-similarity
cry-game-similarity → daily-pick
cry-player       → cry-index
cry-seq-engine   → cry-player, cry-seq-pattern
cry-seq-pro-engine → cry-player, cry-seq-pro-pattern
cry-seq-pro-roll → cry-seq-pro-pattern
cry-seq-roll     → cry-seq-pattern
daily-pick       → categories
form-names       → form-names-zh
game-similarity  → color-match, daily-pick
graph            → shared, cry-index
graph-header     → shared
hero-gen         → daily-pick
home-maze-game   → shared, cry-player, maze-pathfinding, home-sprite-grid
home-sections    → color-palette, home-showcase, home-maze-game
home-showcase    → shared, sorting-algorithms, sort-keys, maze-pathfinding, home-sprite-grid
home-sprite-grid → maze-pathfinding
life             → shared, life-engine, type-era, type-chart, cry-player
life-engine      → type-era
maze-pathfinding → （無）
model3d-viewer   → glb-index, shared
pokemon-lexicon  → shared, genus-zh, type-chart
shared           → form-names, shiny-index
silhouette-draft → shared, color-palette, silhouette-draft-game
silhouette-draft-game → team-analysis, team-moves
sort-keys        → type-chart
team             → shared, color-palette, type-chart, team-analysis, team-state, team-moves
team-analysis    → type-chart
team-moves       → shared
team-state       → team-moves
type-era         → type-chart
```

（上表含 `life-engine → type-era` 與 `type-era → type-chart`，即「純模組依賴純模組」的那兩條。）

其餘 26 個檔案沒有 outgoing import：`type-chart`、`color-match`、`mmcq`、`mmcq-anatomy`、
`maze-pathfinding`、`sorting-algorithms`、`sort-run`、`species-ramp`、`outfit-palette`、
`cry-index`、`cry-autoplay`、`cry-seq-pattern`、`cry-seq-pro-pattern`、`cry-spectrogram`、
`gb-apu`、`game-hints`、`game-tips`、`cover-roster`、`code-highlight`、`shiny-index`、
`sv-index`、`glb-index`、`genus-zh`、`form-names-zh`、`home-hero`、`moves`。

vendored：`three.min.js`、`3d-force-graph.min.js`（只有 `graph.html` 用，不要改）。

---

## 附錄 B：本次盤點的實際指令

```bash
# 索引狀態
git rev-parse HEAD

# 樞紐排名
npx gitnexus cypher \
 "MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File)
  RETURN b.filePath, count(DISTINCT a) ORDER BY count(DISTINCT a) DESC LIMIT 30" --repo .

# 純模組（零 import）
npx gitnexus cypher \
 "MATCH (f:File) WHERE f.filePath STARTS WITH 'assets/js'
  OPTIONAL MATCH (f)-[r:CodeRelation {type:'IMPORTS'}]->()
  WITH f, count(r) AS outs WHERE outs = 0 RETURN f.filePath" --repo .

# 模組大小
npx gitnexus cypher \
 "MATCH (f:File)-[:CodeRelation {type:'DEFINES'}]->(s)
  WHERE f.filePath STARTS WITH 'assets/js'
  RETURN f.filePath, count(s) ORDER BY count(s) DESC LIMIT 25" --repo .

# 頁面 → 模組（HTML 不在圖裡）
for f in *.html; do
  mods=$(rg -o "from '(\./)?assets/js/[^']+'" "$f" | sed "s/from '//;s/'//" | tr '\n' ' ')
  [ -n "$mods" ] && printf '%-26s %s\n' "$f" "$mods"
done

# 資料表消費者
rg -o --no-filename "assets/data/[a-z0-9_]+\.json" assets/js/*.js *.html | sort | uniq -c

# 影響分析
npx gitnexus impact "defensiveMultiplier" --direction upstream --repo .
```

---

## 附錄 C：名詞對照

| 名詞 | 在本專案的意思 |
| :--- | :--- |
| 純模組 | 零 DOM、零 fetch，可在裸 Node import 的 `.js` |
| 頁面控制器 | 每個 `.html` 對應的入口 `.js`，負責 DOM 與事件 |
| 平台層 | `shared.js`，跨頁共用的導航、主題、路徑、徽章 |
| slim 表 | 為單一頁面裁切的輕量 JSON（`team_roster` / `home_roster` / `draft_roster`）|
| checker | `scripts/check_*.mjs`，對檔案或算繪結果的斷言 |
| harness | `scripts/test_check_*.mjs`，故意弄壞來驗證 checker 的變異測試 |
| generated | 由 `scripts/*.py` 產生、禁止手改的檔案 |
| §3.X | `AGENTS.md` 第 3 節的第 X 條不變量 |

---

## 附錄 D：五步學習路線的參考解答

> **用法**：先在 §11 每一步用 30 秒寫下自己的答案，再展開對照。
> 五題各 20 分；60 分以上建議開始改程式碼，40 分以下建議重讀 §3 與 §5。
> 答案不是唯一解，但**數字必須對**——所有數字都可用 §10 的指令重跑驗證。

### 評分表

| 步驟 | 拿分條件（每項 5 分）|
| ---: | :--- |
| 1 | 分類合理 / `team` 與 `types` 的差異講對 / 提到「狀態是否跨元件共享」/ 指出 inline module 的角色 |
| 2 | 15 對（不是 22 對）/ 說出 7 支 checker / 說出 HTML 不在圖裡 / 推論到 31 頁 |
| 3 | 列出 6 個直接呼叫者 / 說出 CRITICAL 的兩個來源 / 指出跨兩個頁面 / 說出要跑哪個 `--only` |
| 4 | 跑出 `Electric → Water = 2` / 說出零 import / 說出零 DOM、零 fetch / 舉出一個反例 |
| 5 | 說出 `--only=color` / 16 個項目 / 約 21 秒 / 說出「不需要 Chrome」|

---

### 步驟 1：31 頁分成三類

<details>
<summary>展開參考解答</summary>

分類的判準是**狀態是否跨元件或跨網址共享**，不是「有沒有動畫」：

| 類 | 頁面 | 判準 |
| :--- | :--- | :--- |
| **資料型**（11）| `pokedex` `detail` `types` `moves` `move` `abilities` `ability` `category` `collections` `generations` `today` | 把 JSON 渲染成 DOM；狀態只有「目前篩選」且留在頁面內 |
| **工具型**（6）| `team` `outfit` `colors-generator` `color` `colors-explore` `model3d` | 使用者輸入 → 計算 → 輸出；狀態可能要寫回網址 |
| **遊戲 / 演示**（13）| `index` `sorting` `maze` `life` `graph` `silhouette-draft` `color-game` `cry-game` `cries` `cries-gen1` `spectrum` `cry-studio` `cry-studio-pro` | 狀態機 + rAF / 音訊 / 回合流程 |
| **其他**（1）| `404` | 不載任何模組 |

**`team.html` 與 `types.html` 為什麼不同**（本步的核心）：

| | `team.html` | `types.html` |
| :--- | :--- | :--- |
| 狀態 | 6 格 × 4 招、`?team=` / `?moves=`、選擇器對話框、即時分析 | 只有 `?type=` |
| 狀態是否跨元件 | 是：格子 → 分析 → 對話框 → 網址都讀同一份 | 否：一次渲染就結束 |
| 結果 | 抽出 `team.js`（100 符號）+ `team-state.js` + `team-analysis.js` | inline module 直接 import `type-chart` / `sv-index` / `pokemon-lexicon` |

換句話說：**`types.html` 沒有「控制器」這個檔案，不是漏了，是它不需要**。
`pokedex.html` 也是同一類——它有搜尋狀態，但狀態不跨元件，所以邏輯留在 inline module。

驗收句：「需要控制器的是**狀態**，不是頁面大小。」

</details>

---

### 步驟 2：`shared.js` 的 22 個 importers

<details>
<summary>展開參考解答</summary>

**22 = 15 個執行期模組 + 7 支 checker。**

15 個執行期模組：`abilities` `categories` `color-game` `color-palette` `cry-game`
`graph-header` `graph` `home-maze-game` `home-showcase` `life` `model3d-viewer`
`pokemon-lexicon` `silhouette-draft` `team-moves` `team`

7 支 checker：`check_abilities_page` `check_categories` `check_draft_page` `check_learnsets`
`check_life_page` `check_moves_page` `check_pokemon_names`

分開的查法（少這一行就會把驗證層算進來）：

```bash
npx gitnexus cypher \
 "MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File)
  WHERE a.filePath STARTS WITH 'assets/js'
    AND b.filePath = 'assets/js/shared.js'
  RETURN a.filePath ORDER BY a.filePath" --repo .
```

**為什麼風險是 31 頁而不是 22 檔**：
GitNexus 只解析 JS，HTML 的 inline `<script type="module">` 不在圖裡（§6.5）。
31 個頁面各有一份 inline module，每個都會呼叫 `initThemeToggle()` / `initHeaderNav()`。
所以 `shared.js` 改壞，22 個 importer 會紅，但**壞掉的是 31 個頁面**。

推論：改完跑 `--only=nav`（21 項，含 `check_js_syntax` 的文件結構與 `check_page_module_api` 的綁定）
加 `--only=color`（16 項）。**不要只跑 import 圖給你的 22 個檔案。**

驗收句：「圖上的 importer 數是下限，頁面數才是影響面。」

</details>

---

### 步驟 3：`defensiveMultiplier` 為什麼是 CRITICAL

<details>
<summary>展開參考解答</summary>

**直接呼叫者 6 個（d=1）**：

| 呼叫者 | 檔案 | 屬於 |
| :--- | :--- | :--- |
| `analyzeTeam` | `team-analysis.js` | 隊伍彙總 |
| `bestAgainst` | `team-analysis.js` | 單招最佳化 |
| `defensiveProfile` | `team-analysis.js` | 單隻防禦剖析 |
| `renderDefense` | `team.js` | 隊伍頁渲染 |
| `attackProfile` | `silhouette-draft-game.js` | 剪影選秀對戰 |
| `check_team_page.mjs` | `scripts` | 驗證層 |

**CRITICAL 的兩個來源**（`impact` 的 summary）：

| 軸 | 值 | 意思 |
| :--- | ---: | :--- |
| direct | 6 | 6 個符號會直接壞 |
| total | 11 | 加上 d=2（4）、d=3（1）|
| processes | 6 | 6 條流程會斷，最早在第 1 步 |

**為什麼一個 8 行的乘法函式這麼貴**：它不是「一個函式」，是**兩個頁面功能的共同基礎**——
隊伍頁的防禦表與覆蓋率、剪影選秀的六場對戰，全部經過它。
改一行 `multiplier *= ...`，`renderAnalysis` 與 `chooseMove` 會一起受影響（兩者都在 `team.js`）。

**改完該跑什麼**：`--only=nav`（`check_team_page` 229、`check_team_moves` 54、`check_draft_page` 425），
因為這三個都在 `nav` 群組。不需要開瀏覽器。

**注意**：`risk` 與 `riskSharedAxes` 不可互換。前者是編輯前的警報（含流程軸），
後者只算 direct/total，適合拿來跟檔案型目標比較。看到 `risk: CRITICAL` 就停下來讀 d=1。

驗收句：「CRITICAL 不是『大概會壞』，是『d=1 有 6 個、流程有 6 條』。」

</details>

---

### 步驟 4：為什麼 `type-chart.js` 可以在裸 Node 跑

<details>
<summary>展開參考解答</summary>

實測指令與輸出：

```bash
node --input-type=module -e "
  const m = await import('./assets/js/type-chart.js');
  console.log(Object.keys(m).join(', '));
  console.log('Electric->Water =', m.TYPE_CHART.Electric.Water);
"
```

```
TYPE_CHART, TYPE_CHART_ORDER, TYPE_CHART_SOURCE
Electric->Water = 2
```

三個理由：

1. **零 import** —— GitNexus 的 `IMPORTS` 查詢回傳 0 條 out-edge（§6.2）。
2. **零 DOM** —— 檔案裡沒有 `document` / `window`，只有常數與純函式。
3. **零 fetch** —— 資料是寫在模組裡的常數，不是 JSON。

**反例（也是 5 分的關鍵）**：`color-palette.js`「幾乎」純，但它 import `shared.js`，
所以嚴格說不是零 import 組；`moves.js` 零 import 但 `loadJson()` 會 fetch。
**「零 import」不等於「可測」，「沒有副作用」才是。**

延伸：`maze-pathfinding.js` 同樣可測，而且刻意寫成 graph-generic
（每個 solver 只收 `neighborFn`），所以 checker 可以用假的 7×7 網格驗證它（§3.T）。

驗收句：「能不能在裸 Node 跑，看的是副作用，不是檔案大小。」

</details>

---

### 步驟 5：改 `color-match.js` 要跑什麼

<details>
<summary>展開參考解答</summary>

假設改動：OKLab 距離公式（`deltaEOk`）。

**影響面（實測 `rg`）**：

| 層 | 受影響 |
| :--- | :--- |
| 頁面 | `colors-generator.html`、`outfit.html` |
| 模組 | `color-game.js`、`game-similarity.js`、`cry-game-similarity.js` |
| checker | `check_color_match`（+28 個變異案例）、`check_game_similarity`（+24）、`check_color_game`、`check_color_page`、`check_outfit_page` |

> `maze-pathfinding.js` 的檔案裡也出現 `color-match` 字樣，但那只是註解（§3.Q 的說明），不是 import。
> **文字搜尋會騙人，圖不會** —— 這也是 §6.5 要你兩邊都看的原因。

**該跑的指令**：

```bash
node scripts/check_all.mjs --only=color
```

| 事實 | 值 |
| :--- | :--- |
| 項目數 | 16 |
| 時間 | 約 21.4 s |
| 開 Chrome | **否** |
| 覆蓋 | `check_color_match` / `check_game_similarity` / `check_color_game` / `check_color_page` / `check_outfit_page` |

只有在「算繪結果」也是宣稱的一部分時，才再加：

```bash
node scripts/check_color_game_browser.mjs    # 屬於 game-browser，一個 Chrome
```

**為什麼不是 `--only=nav`**：`nav` 讀的是 HTML 結構、導覽註冊與模組綁定，不讀 OKLab 公式。
**為什麼不是直接跑 `check_all.mjs`**：冷啟動會開 13 個 headless Chrome，這台機器撐不住。

驗收句：「`--only=color` = 16 項 / 21 秒 / 0 個瀏覽器。」

</details>

---

### 如果你五題都答對了

那你已經具備這個專案最需要的三件事：

1. **知道圖的邊界**（HTML / CSS / JSON 不在圖裡）。
2. **知道風險要用頁面數衡量**，不是檔案數。
3. **知道驗證要挑最窄的一組**，不是整套。

下一步：挑一個 `nav` 群組的 bug 修，跑 `--only=nav`，再讀 `docs/incidents/` 對應章節。

