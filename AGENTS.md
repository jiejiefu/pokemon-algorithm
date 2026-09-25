# AGENTS.md — Pokémon Algorithm Visualization Lab

## Project Overview
Static HTML/JS/CSS site (GitHub Pages ready) visualizing algorithms with 1025 Pokémon sprites.
- **index.html** — Sorting lab: 6 algorithms (Bubble, Selection, Insertion, Quick, Merge, Heap) with animated Canvas grid
- **maze.html** — Pathfinding: BFS/DFS on pixelated Pokémon sprites (40×40 grid, recursive backtracker maze gen)
- **pokedex.html** — Searchable/filterable Pokédex grid with lazy-loaded images

## Critical Runtime Requirement
**Must serve via HTTP server** — `file://` fails due to CORS on `fetch('pokemon_data.json')` and image loads.
- VS Code: "Live Server" extension (right-click index.html → Open with Live Server)
- CLI: `npx serve` / `python -m http.server` / `php -S localhost:8000`

## File Structure
```
├── index.html          # Main sorting visualization (Canvas + generators)
├── maze.html           # BFS/DFS maze on Pokémon sprite pixels
├── pokedex.html        # Grid viewer with search/filter
├── sorting.js          # 6 sorting algorithms as generators (yield per step)
├── pokemon_data.json   # 1025 entries: {id, filename, rgb, hsv, hue, sat, val, color_group}
├── Images & Descriptions of All 1025 Pokemon/
│   └── images/         # 1.png … 1025.png (sprites, ~100–200 KB each)
├── pokemon_preprocessing_script.py  # Regenerates pokemon_data.json from images
└── *.csv / *.xlsx      # Raw data sources (not used at runtime)
```

## Key Technical Patterns
- **Generator-based animation**: `sorting.js` exports `function* algoSteps(arr)` yielding per frame; `index.html` drives via `requestAnimationFrame` calling `.next()`
- **Lerp smoothing**: `PokemonNode.update()` interpolates `x/y → targetX/targetY` at 0.15 speed
- **Canvas grid**: 40 cols × 26 rows (1025 Pokémon), 28px padding
- **Color grouping**: HSV-based classification in `pokemon_preprocessing_script.py:classify_color()` → 10 groups (Red/Orange/Yellow/Green/Blue/Purple/Pink/Brown/Black/White/Gray)
- **Maze pixelation**: `maze.html` downsamples sprite to 40×40 via offscreen Canvas, runs recursive backtracker, then BFS/DFS with yield steps

## Development Workflow
| Task | Command |
|------|---------|
| Run locally | `npx serve` (or Live Server in VS Code) |
| Regenerate color data | `python pokemon_preprocessing_script.py` (requires Pillow, numpy) |
| Deploy to GitHub Pages | Push to `main` branch; enable Pages from root folder |

## Gotchas
1. **Folder name with spaces**: `"Images & Descriptions of All 1025 Pokemon"` — URL-encode as `Images%20%26%20Descriptions%20of%20All%201025%20Pokemon` in fetch paths if needed
2. **No build step** — edit HTML/JS directly; changes reflect on reload
3. **1025 images + JSON** — initial load ~200 MB; first paint shows "載入進度" counter
4. **Generator exhaustion**: `sortGenerator = null` resets; `yield` frequency controls animation speed (e.g., insertion sort yields every 5 inserts)
5. **GitHub Pages**: Ensure repo settings → Pages → Source: "Deploy from branch" / root folder

## Adding New Algorithms
1. Add `function* newAlgoSteps(arr)` in `sorting.js` (yield per visual step)
2. Add button in `index.html` header controls
3. Add case in `runAlgorithm(type)` switch

## Data Regeneration
Run `python pokemon_preprocessing_script.py` after adding/removing images in `images/`. Requires:
```bash
pip install pillow numpy
```
