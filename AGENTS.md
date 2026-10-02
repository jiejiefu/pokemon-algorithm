# 寶可夢演算法 — AGENTS.md

> **Environment Requirements**
> - **Python Virtualenv**: `/Users/jiejiefu/Documents/Visual_Studio_Code/.venv` (i.e. `../.venv` from the repo root; a repo-local `.venv` also works)
> - **Execution Style**: `i-have-adhd` (High scannability, concise chunks, explicit bullet points, actionable commands)
>   - This project is developed with **opencode**. Every session must load the `i-have-adhd` skill before the first reply and keep its formatting for the whole session, without waiting to be asked again.
>   - The trigger is the user naming the skill at all — e.g. typing `skill：i-have-adhd`, 「使用skill」, or just「使用skill」with no argument. Treat any mention of「使用skill」as a request to load `i-have-adhd` specifically, since it is the only skill this project pins.
>   - It turns off only when the user says「stop adhd mode」or「normal mode」, confirmed in one line. Nothing else — a topic change, a new task, a mode change in the harness — does not turn it off.
> - **Runtime Server**: Must be served via HTTP. Direct `file://` fails due to CORS on JSON and image fetching.
>   - **One server: port 5500, VS Code Live Server** (`ritwickdey.liveserver`). Start it from Live Server in the editor, or `python -m http.server 5500` from the repo root.
>   - **Do not start another `python -m http.server` on a fresh port.** `http.server` does not exit with its terminal — it reparents to launchd (PPID 1) and keeps the port forever, so each stray run leaves an orphan that only shows up as a duplicate in `lsof`. That is how five accumulated here (8123, 8731, 8811, and 8899 twice — one IPv6 wildcard, one IPv4-only, both live).
>   - Auditing before you start one:
>     ```bash
>     lsof -nP -iTCP -sTCP:LISTEN | rg ':(5500|8000|8123|8731|8811|8899)\s'
>     ```
>   - **Port 8000 is not this project** — it is a `uvicorn main:app` for `~/Documents/Opencode/tw_stocker`. Leave it alone.

---

## 1. Project Overview

**寶可夢演算法** is a static, zero-build HTML/CSS/JavaScript web application (GitHub Pages compatible) visualizing computer science algorithms and design tools using 1,025 Pokémon.

### Core Pages
| Page | Purpose & Key Features |
| :--- | :--- |
| [`index.html`](./index.html) | Landing page: daily featured Pokémon, quick links, category previews, full 1,025 Pokédex grid |
| [`pokedex.html`](./pokedex.html) | Searchable Pokédex with fuzzy autocomplete, generation filters, and type/color filters |
| [`detail.html`](./detail.html) | In-depth Pokémon dossier: 3-column glass hero, Base Stats + Canvas Radar chart, dual-type effectiveness matrix, evolution chain, 4 move tabs (Level, TM, Egg, Tutor) |
| [`sorting.html`](./sorting.html) | Sorting algorithm lab: 6 algorithms (Bubble, Selection, Insertion, Quick, Merge, Heap) on a 1,025-sprite Canvas grid |
| [`maze.html`](./maze.html) | Pathfinding lab: BFS / DFS maze traversal on pixelated Pokémon sprites (40×40 grid) with seedable RNG and speed controls |
| [`colors.html`](./colors.html) | Color Palette Generator & Component Showcase (interactive Card, Chart, Dashboard, Component previews) |
| [`colors-explore.html`](./colors-explore.html) | 1,025 Pokémon color palette gallery with infinite scroll and URL filters |
| [`color.html`](./color.html) | Single Pokémon color palette page (`?slug=`): hero card, palette grid, shade scales, base stats, and theme exporter. A **bare** `color.html` (no `?slug`/`?id`) shows the same seeded daily pick as the homepage's 今日推薦寶可夢, not the not-found error — one draw, one seed, two callers |
| [`model3d.html`](./model3d.html) | GLB 3D model viewer driven by `model3d-viewer.js`; the file roster is generated into `glb-index.js` and the models live in `assets/glbs/` |
| [`collections.html`](./collections.html) | Special collections hub: 11 cards in 4 groups (稀有與傳說 / 熱門分類 / 遊戲與活動 / 特殊形態), 2 of which are `upcoming` and render as non-links |
| [`category.html`](./category.html) | Reusable template for collection lists (`category.html?cat=<slug>`) |
| [`generations.html`](./generations.html) | Chronological generation guide: 9 generations, 38 games, and 27 regional starters |
| [`404.html`](./404.html) | GitHub Pages fallback: cleanly redirects `/detail/<slug>` to `detail.html?slug=<slug>&from404=1` |

---

## 2. Directory Architecture

```
pokemon-algorithm/
├── assets/
│   ├── css/
│   │   ├── shared.css             # Base styles, variables, typography, buttons, cards, tabs, theme tokens
│   │   ├── detail.css             # Styles specific to detail.html (3-col hero, move tables, radar)
│   │   └── colors.css             # Styles for color pages (hero wash, palette grids, shade scales, showcase)
│   ├── js/
│   │   ├── shared.js              # Core utilities, data loader, theme toggle, type badges, slug helpers
│   │   ├── color-palette.js       # Palette extraction readers, shade scale generator, copy handlers
│   │   ├── daily-pick.js          # Seeded daily draw shared by index.html and color.html (one seed, two callers)
│   │   ├── categories.js          # Category data definitions, hub configuration, tag tone mappings
│   │   ├── form-names.js          # Official zh-TW names for the 325 evolution-chain form nodes
│   │   ├── pokemon-lexicon.js     # Traditional Chinese lexicon (genus, habitat, shapes, egg groups)
│   │   ├── type-chart.js          # Gen 6+ 18×18 type effectiveness matrix
│   │   ├── shiny-index.js         # Lookup index of 1,327 official shiny artwork IDs
│   │   ├── sorting-algorithms.js  # Generator-based sorting algorithms for Canvas rendering
│   │   ├── genus-zh.js            # Generated by extract_genus_zh.py — 734 zh-Hant genus translations
│   │   ├── form-names-zh.js       # Generated by fetch_form_names.py — portal scrape keyed by base species id
│   │   ├── glb-index.js           # Generated by extract_glb_index.py — roster of assets/glbs/
│   │   └── model3d-viewer.js      # GLB scene, lighting and animation wiring for model3d.html
│   ├── data/
│   │   ├── pokemon_data.json      # Master data: 1,025 Pokémon (stats, names, types, rgb, breeding, dex)
│   │   ├── color_palettes.json    # 2,050 palettes (normal + shiny) generated via MMCQ
│   │   ├── evolution_chains.json  # 541 complete evolution chains including mega/gmax forms
│   │   ├── moves_zh.json          # 782 referenced moves with traditional Chinese names & stats
│   │   ├── learnsets.json         # Complete move learnsets unioned across generations
│   │   ├── generations.json       # 9 generations: 38 games, 27 starters, mechanics, new types
│   │   ├── abilities_zh.json      # 284 official Traditional Chinese ability names
│   │   └── descriptions_zh.json   # 1,025 official Traditional Chinese Pokédex descriptions
│   ├── glbs/                      # 3D model binaries for model3d.html (1.glb, 25.glb)
│   └── images/
│       ├── pokemon/               # 1,347 front sprites (1.png ... 1025.png + variants)
│       ├── shiny/                 # 1,327 official shiny artwork PNGs (475×475)
│       ├── logo.png               # Header brand mark — byte-identical copy of apple-touch-icon.png, drawn at 40px
│       ├── apple-touch-icon.png   # Pokéball icon (180×180) — the file logo.png was copied from
│       └── favicon-32.png         # Pokéball icon (used strictly as tab favicon)
├── scripts/                       # Python & Node.js build, scrape, and test utilities
└── data-sources/                  # Raw CSV/XLSX data sources (not fetched at runtime)
```

---

## 3. Key Technical Conventions & Invariants

### A. Routing & Slugs
- **Local & GitHub Pages URLs**: Internal navigation uses query parameters (`detail.html?slug=bulbasaur` or `color.html?slug=bulbasaur`).
- **Nidoran Disambiguation**:
  - `nidoran-f` (#029) and `nidoran-m` (#032) are distinct slugs.
  - A bare `nidoran` slug is strictly disallowed and must not resolve.
- **Form Links**: Alternate forms link back to their base species detail page.

### B. Color Extraction & MMCQ System
- `assets/data/color_palettes.json` is generated by `scripts/extract_color_palettes_mmcq.py`:
  - 6-color MMCQ partition sampled from 96×96 front sprites (alpha ≥ 200).
  - **Pixel Snapping**: Synthetic MMCQ centroids are snapped to the most frequent real pixel in each bounding box.
  - **Frequency Share**: Shares represent global pixel frequencies across the sprite (sum < 100%, median ~71.95%).
  - **Short Palettes**: Exactly 3 palettes have 5 colors instead of 6 (#201 Unown, #643 Kartana, Bulbasaur shiny) due to sprite pixel limitations. Never pad these artificially.
- **Reference Project**: `pokemonpalette` is credited for color scales and UI concepts, while `color-thief` is credited for the palette algorithm.

### C. Contrast & Accessibility Rules
- **Color Contrast (WCAG AA)**: Minimum 4.5:1 for standard text, 3:1 for large text and UI components.
- **Measurement Method**: Verify contrast by sampling decoded screenshot pixels via Canvas/CDP, not via `getComputedStyle()` (which misses alpha blending, backdrop filters, and radial gradients).
- **Typography**: CJK-first font stack in `--font-sans` (`PingFang TC`, `Noto Sans TC`, `Microsoft JhengHei`) to avoid mismatched English/Chinese rendering.
- **Theme Switching**: Handled inline in `<head>` before first paint to prevent flashes. Toggling triggers a `themechange` event for Canvas redraws.
- **Reduced Motion**: Honored across CSS and JavaScript. Sprites snap immediately to target coordinates instead of lerping.

---

## 4. Verification & Testing Commands

Run regression checks whenever modifying data structures, selectors, or color logic:

```bash
# Verify color palette contracts & invariant guards
node scripts/check_color_palettes.mjs
node scripts/test_check_color_palettes.mjs

# Verify category definitions, hub card sync & contrast
node scripts/check_categories.mjs

# Verify the seeded daily Pokémon draw (bucket parity, Taipei day key, one
# draw shared by index/color with no per-page seed, and the bare-URL fallback)
node scripts/check_color_daily.mjs
node scripts/test_check_color_daily.mjs

# Verify evolution chains and slug integrity
node scripts/check_evolution_chains.mjs

# Verify official zh-TW form names against the portal cache
node scripts/check_form_names.mjs

# Verify type effectiveness matrix
node scripts/check_type_chart.mjs

# Verify move learnsets & move data
node scripts/check_learnsets.mjs

# Verify regional Pokédex data integrity
node scripts/check_regional_dex.mjs
```

---

## 5. Data Pipeline & Regeneration Workflow

When rebuilding data files, always execute scripts in the correct order:

```bash
# Activate environment
source ../.venv/bin/activate  # /Users/jiejiefu/Documents/Visual_Studio_Code/.venv

# 1. Base Data: Merge CSVs and extract master JSON
python scripts/enhance_pokemon_data.py

# 2. Chinese Names: Scrape official names from tw.portal-pokemon.com
python scripts/fix_pokemon_names.py

# 3. Breeding Data: Fetch gender_rate & hatch_counter (run after Phase 1)
python scripts/fetch_breeding_data.py

# 4. Regional Dex: Fetch regional dex numbers
python scripts/fetch_regional_dex.py

# 5. Abilities: Fetch official Traditional Chinese ability names
python scripts/fetch_abilities.py

# 6. Form Names: Scrape official zh-TW names for Pokémon forms
python scripts/fetch_form_names.py

# 7. Moves & Learnsets: Union move data across all generations
python scripts/fetch_moves.py

# 8. Color Palettes: Rebuild 2,050 MMCQ palettes from front sprites
python scripts/extract_color_palettes_mmcq.py
```

---

## 6. Git Workflow Rules

- **No Push Without Explicit Permission**: Commit freely, but **never run `git push`** — not for a first push, not for a branch, not for a fix, not because CI is red. The remote is only pushed when the user says so in their own words, and a request to commit is not a request to push. When it is unclear whether more work is coming, assume it is and stay local. Check what is pending with `git log --oneline origin/<branch>..HEAD`.
- **Atomic Commits**: Commit at the end of every coherent unit of work (e.g. one bug fix, one component layout, one page enhancement).
- **Never Batch**: Do not lump multiple unrelated modifications into a single commit.
- **Targeted Staging**: Stage only the specific files touched by the unit (`git add path/to/file`). Never use `git add -A` or `git add .` to avoid capturing untracked scratch files.
- **Meaningful Messages**: State what changed, why, and any specific metrics or design choices involved.