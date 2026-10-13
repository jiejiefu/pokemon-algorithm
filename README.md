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

**Pokémon Algorithm** is a static, zero-build HTML/CSS/JavaScript web application (fully compatible with **GitHub Pages**) that visualizes computer science algorithms, color quantization, and data science concepts using **1,025 Pokémon**.

* **Key Feature**: No complex bundlers or npm build steps required. Pure client-side execution leveraging modern ES Modules and high-performance canvas rendering.
* **Deployment**: Ready for instant hosting on GitHub Pages with zero server-side requirements.

---

## 🗺️ Core Pages & Modules

| Page File | Description & Core Features |
| --- | --- |
| `index.html` | Landing page: daily featured Pokémon, category previews, and the full 1,025 Pokédex grid. |
| `pokedex.html` | Searchable Pokédex: fuzzy autocomplete, generation, type, and color filters. |
| `detail.html` | Species Dossier: 3-column hero section, Canvas radar chart, dual-type matrix, evolution chain, and 4 move tabs (3-way footer pager — §3.A). |
| `color.html` | Single species color palette: supports `?slug=`, shade scales, and theme exporter. Bare URL loads the seeded daily pick. |
| `colors-generator.html` | Reverse palette generator: any hex → closest Pokémon via OKLab, followed by a generated theme palette — §3.B1. |
| `color-game.html` | Daily / unlimited palette guessing game over all 1,025 measured palettes. Three difficulties, three fixed hints, OKLab scoring — §3.W. |
| `colors-explore.html` | Full collection of all 1,025 Pokémon palettes with infinite scroll and URL filters. |
| `sorting.html` | 6 sorting algorithms running on a 1,025-sprite Canvas, plus a 2–6 lane race mode — §3.G3. |
| `maze.html` | BFS / DFS pathfinding visualizer on a 40×40 grid with seedable RNG. |
| `life.html` | Conway's Game of Life simulation mapped across generations using real in-game evolution levels — §3.K. |
| `graph.html` | 3D force-directed knowledge graph: 1,346 entities and 2,687 relations across 13 types, featuring search, filters, and a dossier panel linked to `detail.html` / `color.html`. |
| `cries.html` | All 1,025 cry cards with measured timbre, 5 sorting axes, and real-time waveforms. |
| `cries-gen1.html` | The 151 Generation I cries re-synthesised via a Game Boy APU — §3.F. |
| `spectrum.html` | Mel spectrogram analysis over every cry, revealed from left to right — §3.G1. |
| `types.html` | Type chart and per-type browser. The **only** place where the effectiveness matrix appears — §3.D, §3.H. |
| `category.html` | Collection-list template (`?cat=<slug>`). Never links to `types.html` — §3.H. |
| `collections.html` | Collections hub: 11 cards in 4 groups, plus 2 `upcoming` entries. |
| `outfit.html` | Garment colour → MMCQ → OKLab color-matching against all 1,025 palettes — §3.L. |
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
├── assets/          # css/, js/, data/, cries/, glbs/, images/
├── docs/            # incidents/ — underlying receipts for technical conventions
├── scripts/         # verification: check_*.mjs, test_check_*.mjs, lib/
│                    # data pipeline: *.py (data processing scripts)
└── data-sources/    # Raw CSV/XLSX + per-id provenance (never fetched at runtime)

```

* **No `package.json`, no `node_modules`, no build step**: Zero npm dependencies is a deliberate architecture. Node is invoked purely as `process.execPath`, and helper modules reside in `scripts/lib/`.
* **No CI pipeline**: There are no workflows under `.github/workflows/`; the test suite is executed manually.

---

## 📐 Key Technical Conventions

* **Strict Routing & Slugs**: Internal navigation uses query parameters (`detail.html?slug=bulbasaur`). `nidoran-f` (#029) and `nidoran-m` (#032) are distinct; bare `nidoran` slugs are disallowed.
* **Color Extraction & MMCQ**: `assets/data/color_palettes.json` is generated via MMCQ color quantization sampled from 96x96 front sprites and evaluated using OKLab perceptual color distance.
* **Generated Assets**: Core tables and index files (e.g., `genus-zh.js`, `glb-index.js`, `cry-index.js`, `color_palettes.json`) are automatically generated by Python scripts and **must never be edited manually**.

---

## 🧪 Verification & Testing Suite

Run the regression test suite whenever modifying data structures, selectors, or color logic:

* **Run all checkers**:
```bash
node scripts/check_all.mjs

```


* **Smart Caching (`.cache/`)**:
* Records content hashes per checker. Unchanged inputs skip execution, making repeat runs execute in `0.0s`.


* **Command Line Flags**:
* `--only=<group>`: Run specific checker groups (`algo`, `color`, `cry-apu`, `cry-data`, `cry-page`, `data`, `model`, `nav`, `sort`, `type`).
* `--skip=<group>`: Skip specific groups.
* `--force`: Force re-execution ignoring the cache.

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
