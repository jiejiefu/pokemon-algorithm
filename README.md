# 📖 Pokémon Algorithm (`pokemon-algorithm`)

<p align="center">
  <a href="./README.md">English</a> | 
  <a href="./docs/README.zh-TW.md">繁體中文</a>
  <!-- <a href="./docs/README.zh-CN.md">简体中文</a> |  -->
  <!-- <a href="./docs/README.ja.md">日本語</a> -->
</p>

<p align="center">
  <img src="assets/images/logo.png" alt="Pokémon Algorithm logo" width="120">
</p>

## 📦 Project Overview

**Pokémon Algorithm** is a static, zero-build HTML/CSS/JavaScript web application (fully compatible with **GitHub Pages**) that visualizes computer science algorithms, color quantization, audio analysis, and data science concepts using **1,025 Pokémon**.

* **Key Feature**: No complex bundlers or npm build steps required. Pure client-side execution leveraging modern ES Modules and high-performance canvas rendering.
* **Deployment**: Ready for instant hosting on GitHub Pages with zero server-side requirements.

---

## 🗺️ Core Pages & Modules

| Page File | Description & Core Features |
| --- | --- |
| `index.html` | Landing page: scroll-scrubbed hero clip, site intro, two self-running algorithm demos (sorting and A* pathfinding), a playable A* maze, and five feature cards. |
| `today.html` | 「今日推薦」: the seeded daily pick, 「熱門」, 「探索」, 「精選系列」, 「遊戲」, 「工具」, quick links and FAQ. |
| `pokedex.html` | Searchable Pokédex: fuzzy autocomplete, generation, type, and color filters. |
| `team.html` | Team planner: six slots with per-member defensive tallies, STAB coverage, region / generation / type filters, and a shareable `?team=` URL with four moves per member (`?moves=`). |
| `detail.html` | Species Dossier: 3-column hero section, Canvas radar chart, dual-type matrix, evolution chain, and 4 move tabs (3-way footer pager). |
| `color.html` | Single species color palette: supports `?slug=`, shade scales, and theme exporter. Bare URL loads the seeded daily pick. |
| `colors-generator.html` | Reverse palette generator: any hex → closest Pokémon via OKLab, followed by a generated theme palette. |
| `color-game.html` | Daily / unlimited palette guessing game over all 1,025 measured palettes. Three difficulties, three fixed hints, OKLab scoring. |
| `colors-explore.html` | Full collection of all 1,025 Pokémon palettes with infinite scroll and URL filters. |
| `sorting.html` | 6 sorting algorithms running on a 1,025-sprite Canvas, plus a 2–6 lane race mode. |
| `maze.html` | BFS / DFS pathfinding visualizer on a 40×40 grid with seedable RNG. |
| `life.html` | Conway's Game of Life simulation mapped across generations using real in-game evolution levels. |
| `graph.html` | 3D force-directed knowledge graph: 1,346 entities and 2,794 relations across 14 types, featuring search, filters, and a dossier panel linked to `detail.html` / `color.html`. |
| `silhouette-draft.html` | Silhouette draft: six blind picks against a live opponent who takes one of your five leftovers each round, then a 6v6 type-only matchup with win/draw/loss, a multiplier total and a verdict. Each duel plays out in a GBA-style battle scene with the player's back sprite bottom-left and the opponent's front sprite top-right. No stats, STAB or HP. |
| `cries.html` | All 1,025 cry cards with measured timbre, 5 sorting axes, and real-time waveforms. |
| `cries-gen1.html` | The 151 Generation I cries re-synthesised via a Game Boy APU. |
| `spectrum.html` | Mel spectrogram analysis over every cry, revealed from left to right. |
| `cry-game.html` | 「叫聲猜謎」: a ten-question, four-choice cry-guessing game where difficulty is a measured similarity ceiling. |
| `moves.html` | All 919 moves, searchable and filterable, with every filter kept in the URL. |
| `move.html` | One move: stats, effect text, and which of the 1,025 Pokémon learn it. |
| `abilities.html` | All 314 abilities, searchable and filterable, with the 「常見」/「隱藏」 holder split. |
| `ability.html` | One ability: its effect and the 「常見」/「隱藏」 holder lists. |
| `types.html` | Type chart and per-type browser. The **only** place where the effectiveness matrix appears. |
| `category.html` | Collection-list template (`?cat=<slug>`). Never links to `types.html`. |
| `collections.html` | Collections hub: 11 cards in 4 groups, plus 2 `upcoming` entries. |
| `outfit.html` | Garment colour → MMCQ → OKLab color-matching against all 1,025 palettes. |
| `generations.html` | Overview of 9 generations, 38 games, and 27 regional starter Pokémon. |
| `model3d.html` | GLB 3D model viewer; roster automatically generated into `glb-index.js`. |
| `404.html` | GitHub Pages fallback: redirects `/detail/<slug>` → `detail.html?slug=…&from404=1`. |

---

## ⚙️ Installation & Local Execution

Direct `file://` opening is **strictly forbidden** due to browser CORS security restrictions on JSON and image fetching. You must run the project via a local HTTP server:

1. **Recommended (VS Code)**:
* Install the **Live Server** extension (`ritwickdey.liveserver`).
* Right-click the project root and select **"Open with Live Server"** (runs on port `5500` by default).


2. **Command Line (Python)**:
* Run from the repository root:
```bash
python -m http.server 5500

```


* Open `http://localhost:5500` in your browser.



---

## 📁 Directory Architecture

```text
pokemon-algorithm/
├── assets/          # css/, js/, data/ (23 JSON tables), cries/, glbs/, images/, video/
├── docs/            # README.zh-TW.md; incidents/ — receipts for technical conventions
├── scripts/         # verification: check_*.mjs, test_check_*.mjs, lib/
│                    # data pipeline: *.py (data processing scripts)
└── data-sources/    # Raw CSV/XLSX + per-id provenance (never fetched at runtime)

```

* **No `package.json`, no `node_modules`, no build step**: Zero npm dependencies is a deliberate architecture. Node is invoked purely as `process.execPath`, and helper modules reside in `scripts/lib/`.
* **No CI pipeline**: There are no workflows under `.github/workflows/`; the test suite is executed manually.
* **Tracked media**: `assets/video/` holds nine generated hero loops and nine poster stills, all tracked and mounted by `index.html`. Regenerate both with `make_hero_video.py`; never hand-edit them.

---

## 📐 Key Technical Conventions

* **Strict Routing & Slugs**: Internal navigation uses query parameters (`detail.html?slug=bulbasaur`). `nidoran-f` (#029) and `nidoran-m` (#032) are distinct; bare `nidoran` slugs are disallowed.
* **Color Extraction & MMCQ**: `assets/data/color_palettes.json` is generated via MMCQ color quantization sampled from 96x96 front sprites and evaluated using OKLab perceptual color distance.
* **Generated Assets**: Core tables and index files (e.g., `genus-zh.js`, `glb-index.js`, `cry-index.js`, `color_palettes.json`, `moves_zh.json`, `learnsets.json`, `abilities.json`, `graph_data.json`) are generated by scripts under `scripts/` and **must never be edited manually** — a hand-added key survives only until the next regeneration.

---

## 🧪 Verification & Testing Suite

Run the affected checkers whenever modifying data structures, selectors, or color logic:

* **Run the whole suite** (a cold run boots thirteen headless browsers):
```bash
node scripts/check_all.mjs

```


* **Prefer the narrowest check**: name the checker directly, or filter by group. A green filtered run says nothing about what it skipped.
```bash
node scripts/check_moves_data.mjs && node scripts/check_moves_page.mjs
```


* **Smart Caching (`.cache/`)**:
* Records content hashes per checker. Unchanged inputs skip execution, making repeat runs execute in `0.0s`.


* **Command Line Flags**:
* `--only=<group>`: Run only these groups (prefix match). Available groups, cheapest first: `home`, `model`, `algo`, `types-browser`, `data`, `life-browser`, `type`, `game-browser`, `cry-apu`, `outfit-browser`, `cry-data`, `nav`, `sort`, `audio-browser`, `color`, `moves-browser`, `cry-page`, `graph-browser`. `--only=cry` covers `cry-apu`, `cry-data` and `cry-page`.
* `--skip=<group>`: Run everything except these groups. Takes the same prefixes.
* `--force`: Force re-execution ignoring the cache.
* `--no-cache`: Neither read nor write the cache, so the reported duration is real.
* `--prove-inputs`: Verify that each checker reads exactly the inputs it declares.
* `--help`: List every group, its entry count, and its last measured cost.

---

## 🙏 Special Thanks

This project stands on the shoulders of the following open data sources and community projects. Their names are reproduced exactly as their authors publish them.

* [PokéAPI](https://pokeapi.co/)
* [Pokédex | 台灣寶可夢官方網站](https://tw.portal-pokemon.com/play/pokedex/)
* [全國寶可夢圖鑑 2025 - 所有 1,025 隻寶可夢種族值、進化 & 招式 | InfoPoke](https://infopoke.net/zh-tw)
* [PokémonPalette - Extract Color Palettes from Pokémon Sprites | Color Generator Tool](https://www.pokemonpalette.com/)
* [Pokemon Palettes](https://pokepalettes.com/)
* [Pokémon Database -- the fastest way to get your Pokémon information](https://pokemondb.net/)
* [PMD Sprite Repository](https://sprites.pmdcollab.org/)
* [Pokémon 3D Optimized Model Viewer by Pokemon-3D-api](https://pokemon-3d-api.oneapp.dev/)
* [PokéMaps – Interactive Pokémon Maps & Catch Locations](https://pokemaps.net/)
