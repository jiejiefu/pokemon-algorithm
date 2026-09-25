# AGENTS.md — Pokémon Algorithm Visualization Lab

## Project Overview
Static HTML/JS/CSS site (GitHub Pages ready) visualizing algorithms with 1025 Pokémon sprites.
- **index.html** — Landing page: hero + 3 feature cards + full 1025 Pokédex grid (click → detail)
- **sorting.html** — Sorting lab: 6 algorithms (Bubble, Selection, Insertion, Quick, Merge, Heap) with animated Canvas grid
- **maze.html** — Pathfinding: BFS/DFS on pixelated Pokémon sprites (40×40 grid, recursive backtracker)
- **pokedex.html** — Searchable/filterable Pokédex with fuzzy autocomplete, type/color/gen filters
- **detail.html** — Pokémon detail page (id query): sprites, multilingual names, stats radar, evolution, type effectiveness, descriptions

## Critical Runtime Requirement
**Must serve via HTTP server** — `file://` fails due to CORS on `fetch('pokemon_data.json')` and image loads.
- VS Code: "Live Server" extension (right-click index.html → Open with Live Server)
- CLI: `npx serve` / `python -m http.server` / `php -S localhost:8000`

## File Structure
```
├── index.html              # Landing page + Pokédex grid preview
├── sorting.html            # Sorting visualization (6 algorithms)
├── maze.html               # BFS/DFS maze on Pokémon sprites
├── pokedex.html            # Full searchable Pokédex (fuzzy + filters)
├── detail.html             # Pokémon detail page (?id=25)
├── assets/
│   ├── css/
│   │   └── shared.css      # Shared styles (buttons, cards, grid, tabs, radar)
│   ├── js/
│   │   ├── shared.js       # Shared utils: loadPokemonData, createPokemonCard, TYPE_EN_ZH, radar, etc.
│   │   └── sorting-algorithms.js  # 6 sorting algorithms as generators
│   ├── data/
│   │   ├── pokemon_data.json     # 1025 enhanced entries (names, types, stats, descriptions...)
│   │   └── descriptions_zh.json  # Lazy-loaded Chinese descriptions (994/1025)
│   └── images/
│       └── pokemon/              # 1.png … 1025.png (sprites)
├── scripts/
│   ├── enhance_pokemon_data.py   # Phase 1: merge CSV/XLSX → enhanced JSON
│   ├── scrape_zh_descriptions.py # Phase 2: scrape Chinese descriptions (httpx + BS4)
│   └── pokemon_preprocessing_script.py  # RGB/HSV computation from images
└── data-sources/             # Raw CSV/XLSX (not used at runtime)
    ├── legacy-pokemon-data/  # Original captions CSVs
    ├── pokemon_complete_2026.csv
    ├── International List of Pokémon Names.xlsx
    └── *.csv / *.xlsx
```

## Enhanced JSON Schema (pokemon_data.json)
Each entry now includes:
```json
{
  "id": 1,
  "filename": "1.png",
  "names": { "en": "Bulbasaur", "ja": "フシギダネ", "zh": "妙蛙种子", "zh_HK": "妙蛙種子", "fr": "...", "de": "...", "es": "...", "it": "...", "ko": "..." },
  "types": ["Grass", "Poison"],
  "types_zh": ["草", "毒"],
  "stats": { "hp": 45, "attack": 49, "defense": 49, "sp_attack": 65, "sp_defense": 65, "speed": 45, "total": 318 },
  "height_m": 0.7, "weight_kg": 6.9, "base_experience": 64,
  "abilities": ["overgrow"], "hidden_ability": "chlorophyll",
  "generation": 1, "is_legendary": false, "is_mythical": false, "is_baby": false,
  "color": "green", "shape": "quadruped", "egg_groups": ["Monster", "Plant"],
  "habitat": "grassland", "growth_rate": "medium-slow",
  "capture_rate": 45, "base_happiness": 70, "genus": "Seed Pokémon",
  "evolution_chain_id": 1,
  "rgb": [...], "hsv": [...], "hue": ..., "sat": ..., "val": ...,
  "descriptions": { "en_long": "...", "en_short": "...", "en_flavor": "...", "zh": "從出生時候開始...", "zh_text2": "從出生的時候開始背上就背著一顆種子..." }
}
```

## Key Technical Patterns
- **Generator-based animation**: `sorting-algorithms.js` exports `function* algoSteps(arr)` yielding per frame; `sorting.html` drives via `requestAnimationFrame` calling `.next()`
- **Lerp smoothing**: `PokemonNode.update()` interpolates `x/y → targetX/targetY` at 0.15 speed
- **Canvas grid**: 40 cols × 26 rows (1025 Pokémon), 28px padding
- **Color**: Official PokeAPI color (green/blue/red/yellow/purple/pink/brown/black/white/gray) — replaces computed `color_group`
- **Radar chart**: Canvas-based stats visualization in detail page
- **Type effectiveness**: Computed client-side from dual-type combination
- **ES Modules**: All JS uses `type="module"` with relative imports from `assets/js/shared.js`
- **Fuzzy search**: `<input list="pokemon-suggestions">` with `<datalist>` populated from all names (id, zh, en, ja)

## Development Workflow
| Task | Command |
|------|---------|
| Run locally | `npx serve` (or Live Server in VS Code) |
| Enhance JSON data | `source .venv/bin/activate && python scripts/enhance_pokemon_data.py` |
| Scrape Chinese descriptions | `source .venv/bin/activate && python scripts/scrape_zh_descriptions.py` (≈10 min) |
| Regenerate color data | `python scripts/pokemon_preprocessing_script.py` (requires Pillow, numpy) |
| Deploy to GitHub Pages | Push to `main` branch; enable Pages from root folder |

## Gotchas
1. **No build step** — edit HTML/JS directly; changes reflect on reload
2. **1025 images + JSON** — initial load ~200 MB; first paint shows "載入進度" counter
3. **Generator exhaustion**: `sortGenerator = null` resets; `yield` frequency controls animation speed (insertion sort yields every 5 inserts)
4. **GitHub Pages**: Ensure repo settings → Pages → Source: "Deploy from branch" / root folder
5. **Asset paths**: All HTML files reference `assets/images/pokemon/`, `assets/js/shared.js`, `assets/data/pokemon_data.json`
6. **Virtualenv required**: Python scripts need `.venv` with pandas, openpyxl, httpx, lxml, beautifulsoup4
7. **Chinese descriptions**: 1025/1025 have text1 (primary), 1025/1025 have text2 (secondary) from tw.portal-pokemon.com. Scraper handles both single-escaped and double-escaped Next.js streaming formats.
8. **Detail page URL**: `detail.html?id=25` — uses query param for dynamic rendering
9. **text2 fallback**: If tw.portal-pokemon.com doesn't have text2, it's left empty (no wiki.52poke.com fallback)

## Adding New Algorithms
1. Add `function* newAlgoSteps(arr)` in `assets/js/sorting-algorithms.js` (yield per visual step)
2. Add button in `sorting.html` header controls
3. Add case in `runAlgorithm(type)` switch

## Data Regeneration
### Phase 1: Enhance JSON (merge all sources)
```bash
source .venv/bin/activate
python scripts/enhance_pokemon_data.py
```
Reads: `pokemon_complete_2026.csv`, `International List of Pokémon Names.xlsx`, `original_captions.csv`, `compressed_captions.csv`, existing `pokemon_data.json`
Writes: `assets/data/pokemon_data.json` (overwrite)

### Phase 2: Scrape Chinese descriptions
```bash
source .venv/bin/activate
python scripts/scrape_zh_descriptions.py
```
Reads: `pokemon_data.json` (for names)
Writes: `assets/data/descriptions_zh.json` (lazy-loaded)
Then merges into `pokemon_data.json`

### Phase 3: Regenerate color data (if images change)
```bash
pip install pillow numpy
python scripts/pokemon_preprocessing_script.py
```
Reads: `assets/images/pokemon/1.png`... 
Writes: `assets/data/pokemon_data.json` (updates rgb/hsv/hue/sat/val only)