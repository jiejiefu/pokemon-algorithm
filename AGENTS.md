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
| [`detail.html`](./detail.html) | In-depth Pokémon dossier: 3-column glass hero, Base Stats + Canvas Radar chart, dual-type effectiveness matrix, evolution chain, 4 move tabs (Level, TM, Egg, Tutor). The footer is a 3-way nav — 上一隻 / 單一色盤 / 下一隻 — where each pager link carries the neighbour's `#0001`-style id over its zh name, and the middle link is the reciprocal of `color.html`'s 完整資料頁 |
| [`sorting.html`](./sorting.html) | Sorting algorithm lab: 6 algorithms (Bubble, Selection, Insertion, Quick, Merge, Heap) on a 1,025-sprite Canvas grid |
| [`maze.html`](./maze.html) | Pathfinding lab: BFS / DFS maze traversal on pixelated Pokémon sprites (40×40 grid) with seedable RNG and speed controls |
| [`colors.html`](./colors.html) | Color Palette Generator & Component Showcase (interactive Card, Chart, Dashboard, Component previews) |
| [`colors-explore.html`](./colors-explore.html) | 1,025 Pokémon color palette gallery with infinite scroll and URL filters |
| [`color.html`](./color.html) | Single Pokémon color palette page (`?slug=`): hero card, palette grid, shade scales, base stats, and theme exporter. A **bare** `color.html` (no `?slug`/`?id`) shows the same seeded daily pick as the homepage's 今日推薦寶可夢, not the not-found error — one draw, one seed, two callers |
| [`model3d.html`](./model3d.html) | GLB 3D model viewer driven by `model3d-viewer.js`; the file roster is generated into `glb-index.js` and the models live in `assets/glbs/` |
| [`collections.html`](./collections.html) | Special collections hub: 11 cards in 4 groups (稀有與傳說 / 熱門分類 / 遊戲與活動 / 特殊形態), 2 of which are `upcoming` and render as non-links |
| [`category.html`](./category.html) | Reusable template for collection lists (`category.html?cat=<slug>`). 11 categories, one per config in `categories.js`; the roster + a zh-Hant introduction. Does not link to `types.html` — see §3.F |
| [`generations.html`](./generations.html) | Chronological generation guide: 9 generations, 38 games, and 27 regional starters |
| [`types.html`](./types.html) | Type chart and per-type browser: overview (18 types, full 18×18 chart, history, FAQ) plus `?type=<slug>` pages listing that type's Pokémon, moves, abilities, items, and trainers |
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
│   │   ├── sv-index.js            # Generated by extract_sv_index.py — 1,025-ID Scarlet/Violet roster
│   │   ├── cry-index.js           # Generated by extract_cry_index.py — 1,025-ID + 649-ID cry rosters
│   │   ├── cry-player.js          # Web Audio player for cry playback (decode, envelope, failure reasons)
│   │   └── model3d-viewer.js      # GLB scene, lighting and animation wiring for model3d.html
│   ├── data/
│   │   ├── pokemon_data.json      # Master data: 1,025 Pokémon (stats, names, types, rgb, breeding, dex)
│   │   ├── color_palettes.json    # 2,050 palettes (normal + shiny) generated via MMCQ
│   │   ├── evolution_chains.json  # 541 complete evolution chains including mega/gmax forms
│   │   ├── moves_zh.json          # 782 referenced moves with traditional Chinese names & stats
│   │   ├── learnsets.json         # Complete move learnsets unioned across generations
│   │   ├── generations.json       # 9 generations: 38 games, 27 starters, mechanics, new types
│   │   ├── type_profiles.json     # Per-type prose + zh-TW effects + trainers scraped from InfoPoke (see §3.D)
│   │   ├── gen1_cries.json        # Generated by fetch_gen1_cries.py — 151 Gen-1 cries: base, pitch, length
│   │   ├── gen1_cry_sfx.json      # Generated by fetch_gen1_cries.py — 38 base cries as GB channel commands
│   │   ├── cry_features.json      # Generated by analyze_cries.py — 34 timbre features per cry, resampled to 16 kHz
│   │   └── abilities_zh.json      # 284 official Traditional Chinese ability names
│   ├── cries/                     # Local cry audio for cry-index.js: latest/ (1,351) + legacy/ (649)
│   ├── glbs/                      # 3D model binaries for model3d.html (1.glb, 25.glb)
│   └── images/
│       ├── pokemon/               # 1,347 front sprites (1.png ... 1025.png + variants)
│       ├── scarlet-violet/        # 1,225 SV artwork PNGs (1,025-ID roster + 200 unclaimed variants)
│       ├── sprite/                # 1,025 96px fallback sprites (the guaranteed floor for every species)
│       ├── shiny/                 # 1,327 official shiny artwork PNGs (475×475)
│       ├── logo.png               # Header brand mark — byte-identical copy of apple-touch-icon.png, drawn at 40px
│       ├── apple-touch-icon.png   # Pokéball icon (180×180) — the file logo.png was copied from
│       └── favicon-32.png         # Pokéball icon (used strictly as tab favicon)
├── scripts/                       # Python & Node.js build, scrape, and test utilities
└── data-sources/                  # Raw CSV/XLSX data sources + per-id provenance (never fetched at runtime)
    └── sv-sources.json            # Records which host each scarlet-violet/*.png actually came from
```

---

## 3. Key Technical Conventions & Invariants

### A. Routing & Slugs
- **Local & GitHub Pages URLs**: Internal navigation uses query parameters (`detail.html?slug=bulbasaur` or `color.html?slug=bulbasaur`).
- **Nidoran Disambiguation**:
  - `nidoran-f` (#029) and `nidoran-m` (#032) are distinct slugs.
  - A bare `nidoran` slug is strictly disallowed and must not resolve.
- **Form Links**: Alternate forms link back to their base species detail page.
- **detail ⇄ color Reciprocity**: `detail.html` and `color.html` link to each other (`單一色盤` ↔ `完整資料頁`), and both must build their cross-page URL from the one canonical helper — `pokemonDetailUrl()` in `shared.js` and `paletteUrl()` in `color-palette.js`. **Never assemble either URL by hand or by string-replacing `detail.html`** — `paletteUrl()`'s docblock gives the reason: `color.html` deliberately does *not* inherit detail's clean-URL contract, so the two shapes can diverge and a derived string breaks the day either gains a path segment. `detail.html` imports `paletteUrl` from `color-palette.js` for exactly this reason; that module has no top-level side effects, so the one-function import costs a parse and nothing else.

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

### D. Type Profiles & Scoped Translations
`assets/data/type_profiles.json` is generated by `scripts/fetch_type_profiles.py`, which scrapes the InfoPoke `/types/[id]` Nuxt chunk. InfoPoke publishes **no zh-TW catalogue** for this route — its own zh-TW pages render raw i18n keys — so the file mixes three provenances and they are kept in separate fields rather than merged:

- `blurbEn` / `battleTipsEn` / `categoryNoteEn` and `entriesEn[].effect` are **English upstream**. They are shown in `types.html` inside a collapsed block explicitly labelled as upstream English, never passed off as a translation of ours.
- `entries[].effect` is **Simplified Chinese upstream**, converted with `OpenCC` `s2twp` and pinned by `requirements.txt`. This is the only zh-TW effect text on the page.
- `trainers[].roleZh` is **this project's own translation** of InfoPoke's English role titles. Trainer and city proper nouns stay English.

Two consequences worth knowing before editing `types.html`:

- **Ability names come from our data, not the scrape.** `types.html` builds the ability list from `pokemon_data.json[].abilities` + `abilities_zh.json` and borrows only effect text from the scrape, matched on the official Chinese name. InfoPoke's own zh-TW ability names are its own translations (悠遊自如 for Swift Swim, 仙氣護衛 for Fairy Aura) and a few of its entries are not real abilities at all. 59 of 74 scraped ability names join; `check_type_profiles.mjs` pins that floor at 70% so the join cannot silently collapse.
- **Type relationships come only from `type-chart.js`.** Never from InfoPoke and never from `type_profiles.json`. `Electric → Water` is `2×`; that is correct and matches PokeAPI, the InfoPoke grid, and the wiki.

### E. Scarlet/Violet Artwork & Provenance
`assets/js/sv-index.js` is generated by `scripts/extract_sv_index.py` from the PNGs actually on disk. It is **not** a list of what exists upstream, and it must never be hand-edited.

- `assets/images/scarlet-violet/` holds 1,225 PNGs: the 1,025-ID roster plus 200 unclaimed variants (`10001+`, top-level alternate forms, gendered suffixes). Unclaimed files are counted and reported but never added to the roster.
- Artwork is fetched by `scripts/fetch_sv_sprites.py`: **PokeAPI first**, falling back to InfoPoke only when the primary host does not return a valid PNG. The fallback exists because PokeAPI's SV set is incomplete; it is not a second source of truth.
- **The frontend credits PokeAPI only.** `SV_SOURCE` in the generated module names the primary host, and `types.html` must not name the fallback anywhere a reader can see it. The real per-file answer lives in `data-sources/sv-sources.json`, which records which host each id actually came from. That file is deliberately outside `assets/` so it is never served to the browser.
- The roster is complete today (1,025/1,025), so the stand-in path in `types.html` is dormant: `hasSv()` is true for every species, the ring badge and the stand-in count render nothing, and `.chip-thumb.is-sub` is never applied. The code stays so a future upstream removal degrades to the 96px `assets/images/sprite/` floor instead of a broken image.
- `node scripts/check_sv_index.mjs` guards all of the above, including that the roster is not stale, that `types.html` still imports both `hasSv` and `svUrl`, that the `onerror` net is intact, that both badge tones exist, and that the count is suppressed at zero. `node scripts/test_check_sv_index.mjs` mutates a scratch copy of the tree to prove each guard can actually fail.

### F. Cry Audio & the Generation I Table
Two independent sources, two independent sets of traps. Neither may be hand-edited; both are generated and both are checked.

**`assets/js/cry-index.js` (generated by `scripts/extract_cry_index.py`)** rosters `assets/cries/`, a byte-for-byte copy of [PokeAPI/cries](https://github.com/PokeAPI/cries). No re-encode, no rename — what plays is exactly what played when the page fetched it from `raw.githubusercontent.com`.

- `latest/` holds 1,351 files and covers all 1,025 species; the 326 unclaimed `10000+` form files are counted and reported but kept out of the roster, on the same rule as §3.E. `legacy/` holds 649 files, the older Gen 1-5 recordings.
- **93 files under `latest/` are not Ogg despite the extension** — 92 are MPEG layer III and one is a WAV. Only ids **25, 808, 809** are roster species; the other 90 are form files. So `Content-Type: audio/ogg` on `25.ogg` is a lie the browser never sees: `decodeAudioData` sniffs content rather than trusting the header, and `canPlayType` cannot be trusted to detect them at all. The checker magic-sniffs all 1,674 roster files rather than reading extensions.
- **Every legacy file differs from its latest counterpart — 649 of 649, byte for byte.** "Old recording" is the entire reason `legacy/` exists; a copy backfill would silently retire it, so the checker compares all 649 pairs.
- **Peaks exceed 1.0.** `25.ogg` decodes to a maximum sample of 1.0391, so any envelope built by sampling raw float data must clamp or it draws outside the canvas.
- `node scripts/check_cry_index.mjs` (46 checks) and `node scripts/test_check_cry_index.mjs` (21 mutation cases) guard it. Four of those cases failed when first written and each was a real hole, not a bad expectation — worth reading before trusting any assertion here that "looks obviously true".

**`assets/data/gen1_cries.json` + `gen1_cry_sfx.json` (generated by `scripts/fetch_gen1_cries.py`)** parse [pret/pokered](https://github.com/pret/pokered)'s `data/pokemon/cries.asm` and 114 `audio/sfx/cry{NN}_{1,2,3}.asm`. The `.asm` files are **build-time inputs and are not vendored**; they mirror into the gitignored `data-sources/pokered-cry/` when `test_check_gen1_cries.mjs` needs them.

- **The table is unordered from its first row.** All 151 species sit at a position that is not their dex id, by up to 174 places; row 1 is Rhyhon (id 112). So every id in the JSON can only have come from the `; Name` comment — a positional join would hand Bulbasaur Rhyhon's cry. `test_check_gen1_cries.mjs` **shuffles the rows and requires the regenerated JSON to be byte-identical**, which is the only thing that actually proves it; a comment cannot.
- **The join key has two hazards in it.** Punctuation differs (`Mr.Mime` upstream, `Mr. Mime` in `pokemon_data.json`), so punctuation is dropped; but Nidoran♀ (29) and Nidoran♂ (32) differ *only* by a gender symbol, so symbols are transliterated (`♀`→`f`, `♂`→`m`) rather than dropped. Getting either backwards merges two species onto one key, which is why an ambiguous key is a hard error and never a coin flip.
- **38 base cries, not 114 files.** Upstream ships each base three times as three link entries for one sound; the copies carry identical commands and differ only in the `_1`/`_2`/`_3` inside their labels — including inside cry0d's `sound_loop` target, which is why loop targets are stored as `"Ch5"` and not as literal labels. The fetcher stops the build if the replicas ever diverge, and `check_gen1_cries.mjs` re-asserts it.
- **Case is the whole filename trap.** Constants are uppercase hex (`SFX_CRY_1A`), filenames are lowercase (`cry1a_1.asm`). A case-sloppy map looks right for the ten all-digit bases and 404s for the other twenty-eight.
- **Upstream is not self-consistent, and the checker must not be.** `cry02_1.asm` uses the older single-value `duty_cycle` (expanded to four repeats on parse); the volume sweep is a signed nibble written both ways (`noise_note 13, 1, -1, 124`); `cry06_1.asm`'s Ch6 is an empty channel; and **six** of the 114 channels have no `sound_ret` at all — recorded in `implicitRet` and asserted as an exact set, because "at most six" would pass both when the parser drops commands and when upstream fixes one. Never assert something upstream does not do.
- `node scripts/check_gen1_cries.mjs` (37 checks) and `node scripts/test_check_gen1_cries.mjs` (24 mutation cases plus the shuffle proof) guard it.

**`assets/data/cry_features.json` (generated by `scripts/analyze_cries.py`)** is one 34-number row per roster file — `dur` `peak` `rms` `zcr` `centroid` `rolloff85` `flatness` `flux`, then 13 MFCC means and 13 MFCC standard deviations — for 1,025 latest and 649 legacy cries. 499 KB, and no similarity matrix: 1,025² floats is 4 MB, and the browser multiplies the rows it already has.

- **Every file is resampled to 16 kHz first, and that is not cosmetic.** The corpus spans **fifteen sample rates**, 8,000–48,000 Hz, with 784 files at 32,728 Hz against 120 at 44,100 Hz. A mel filterbank built over each file's own Nyquist gives those two groups different meanings for the same coefficient, so a search would partly rank which encoder produced the file. 16 kHz is justified by measurement: 90.6% of energy is below 4 kHz and 98.2% below 8 kHz.
- **`peak` and `rms` are measured on the decoded signal, not after resampling**, because both are independent of sample rate and FFT resampling smooths `25.ogg`'s peak down from 1.0391 to under 0.94 — which would hide the fact that the corpus is not clipped. The measured maximum is 1.2111. Consumers drawing an envelope clamp at draw time.
- **legacy and latest are NOT comparable.** Centroid medians are 1,327 Hz against 2,992 Hz, flatness differs by two orders of magnitude, every legacy file is at 10,512 Hz. That is a difference in how the two sets were recorded, not between the Pokémon. They are stored under separate keys, range-checked separately, and the checker asserts the offset is *still present* so a change that quietly merged them is noticed.
- **`node scripts/check_cry_features.mjs` (24 checks)** and `node scripts/test_check_cry_features.mjs` (20 mutation cases) guard it. The assertion that earns its keep is **every dimension must vary across the corpus**: a constant column means a filterbank that collapsed or a DCT that never ran, which passes every shape and NaN check while the search degrades to chance.
- **"Most similar cry" cannot be a similarity ranking here.** Measured within one corpus: same-family pairs average 0.2076 against 0.0075 for unrelated pairs — a real separation — but top-1 same-family accuracy is **2.1%** against a ~0.1% random baseline. Log-mel mean+std (26/40 bands), MFCC 13, MFCC 20 and a 40 ms window all land between 1.5% and 2.1%; nothing is meaningfully better, because each modern cry was composed independently and evolutionary relation does not predict how a Pokémon sounds. These features are honest timbre descriptors. Present them as axes, not as a semantic ranking.

### G. Category Pages vs. `types.html` — Two Different Questions

`category.html?cat=dragon` and `types.html?type=dragon` both exist and both list the same 70 species. **A category page must never link to `types.html`, and must never be merged into it.** Decided by the user when the Dragon page was added; do not re-propose the cross-link.

- A **category page** answers 「有哪些龍屬性寶可夢」 — a roster plus an introduction. Its `prose` and `notes` are this project's own zh-Hant editorial, which is the point: it is the detailed species introduction.
- **`types.html`** answers 「龍屬性的招式、特性、道具、訓練家與相剋關係」 — battle mechanics, and the only place the effectiveness matrix appears. Its prose is upstream English by design (§3.D), so it is not a substitute for a zh-Hant introduction and must not be given one.
- The two are complementary, not overlapping, so a reader who needs the mechanics follows the site's own type browser from the nav. Adding a "see also types.html" link to the category template was considered and declined: it would put a battle-mechanics page on the path of someone who asked a species question.

**Adding a category is a three-list edit, in this order.** `CATEGORIES` (append the config), `CATEGORY_SLUGS` (append the slug — it is a literal list, *not* `Object.keys(CATEGORIES)`, and `category.html` falls back to element `[0]` on an unknown slug, so never insert at the front), and `NON_HUB_SLUGS` or `COLLECTION_GROUPS`. All three are literal lists on purpose: `check_categories.mjs` asserts `CATEGORY_SLUGS \ HUB_SLUGS === NON_HUB_SLUGS` and hub order against `CATEGORY_SLUGS.filter(...)` with `===` on the exact array, so a category that reaches the hub by omission is impossible by construction. Appending is the only insertion that leaves both orders untouched.

- `totalCards === 11` in `check_categories.mjs` is a hardcoded count of the hub. Prefer `NON_HUB_SLUGS` (the 600族 and 龍屬性 precedent): the homepage already links both from the 熱門搜尋 row, and the collections hub is a different navigation surface that neither page needs to appear in.

---

## 4. Verification & Testing Commands

Run regression checks whenever modifying data structures, selectors, or color logic:

```bash
# Verify color palette contracts & invariant guards
node scripts/check_color_palettes.mjs
node scripts/test_check_color_palettes.mjs

# Verify the shared nav from both ends. check_color_page.mjs owns the NAV table
# and its claims; check_nav_pages.mjs owns the other half — that every page but
# the two documented exceptions actually mounts it, which no table check can see
node scripts/check_color_page.mjs
node scripts/test_check_color_page.mjs
node scripts/check_nav_pages.mjs
node scripts/test_check_nav_pages.mjs

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

# Verify per-type prose, zh-TW effect text, and trainer role labels
node scripts/check_type_profiles.mjs

# Verify move learnsets & move data
node scripts/check_learnsets.mjs

# Verify regional Pokédex data integrity
node scripts/check_regional_dex.mjs

# Verify the SV roster, its artwork files, and the PokeAPI-only frontend claim
node scripts/check_sv_index.mjs
node scripts/test_check_sv_index.mjs

# Verify the Generation I cry table: the 151-row name join against pokered's
# unordered table, the 38 base cries, the channel/command shape, and the pinned
# set of upstream inconsistencies. The mutation test shuffles cries.asm's rows
# and requires the regenerated JSON to be byte-identical, which is the only real
# proof the join is by name — it mirrors the 114 .asm files into
# data-sources/pokered-cry/ on first run
node scripts/check_gen1_cries.mjs
node scripts/test_check_gen1_cries.mjs

# Verify the cry feature table: 1,025 + 649 rows x 34 timbre features, resampled
# to 16 kHz. The check that earns its keep is that every dimension varies across
# the corpus -- a constant column means the filterbank collapsed or the DCT never
# ran, which passes every shape and NaN check while the search degrades to chance
node scripts/check_cry_features.mjs
node scripts/test_check_cry_features.mjs
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

# 8. Chinese Descriptions: Fill descriptions.zh / zh_text2 from tw.portal-pokemon.com
#    MUST run after step 1 — enhance_pokemon_data.py writes zh: "" for every
#    record. Writes straight into pokemon_data.json; use --ids 899,901 to
#    re-scrape a subset and --dry-run to parse without writing.
python scripts/scrape_zh_descriptions.py

# 9. Color Palettes: Rebuild 2,050 MMCQ palettes from front sprites
python scripts/extract_color_palettes_mmcq.py

# 10. Type Profiles: Re-scrape per-type prose, zh-TW effects, and trainers.
#     Locates the InfoPoke `/types/[id]` Nuxt chunk by runtime resolution rather
#     than a hardcoded filename, so a chunk hash bump does not break it.
python scripts/fetch_type_profiles.py

# 11. Scarlet/Violet Artwork: fetch only the missing roster entries, then
#     rebuild assets/js/sv-index.js from what is actually on disk. PokeAPI is
#     primary; InfoPoke is consulted only when PokeAPI yields no valid PNG, and
#     every file's real host is recorded in data-sources/sv-sources.json (never
#     shown in the browser). Re-running with a complete tree is a no-op.
python scripts/fetch_sv_sprites.py --dry-run   # report coverage first
python scripts/fetch_sv_sprites.py
python scripts/extract_sv_index.py
node scripts/check_sv_index.mjs

# 12. Generation I cries: parse pokered's cry table and its 38 base cries.
#     Nothing is vendored — the .asm files are fetched and turned into JSON.
#     --dry-run parses and reports without writing. --source/--sfx-dir take
#     local paths, which is how the mutation test shuffles the rows offline.
python scripts/fetch_gen1_cries.py --dry-run
python scripts/fetch_gen1_cries.py
node scripts/check_gen1_cries.mjs

# 13. Cry features: one 34-number timbre row per roster cry, into
#     assets/data/cry_features.json. Everything is resampled to 16 kHz first,
#     because the corpus spans fifteen sample rates. No similarity matrix is
#     stored. --dry-run computes and reports without writing.
python scripts/analyze_cries.py --dry-run
python scripts/analyze_cries.py
node scripts/check_cry_features.mjs
```

---

## 6. Git Workflow Rules

- **No Push Without Explicit Permission**: Commit freely, but **never run `git push`** — not for a first push, not for a branch, not for a fix, not because CI is red. The remote is only pushed when the user says so in their own words, and a request to commit is not a request to push. When it is unclear whether more work is coming, assume it is and stay local. Check what is pending with `git log --oneline origin/<branch>..HEAD`.
- **Atomic Commits**: Commit at the end of every coherent unit of work (e.g. one bug fix, one component layout, one page enhancement).
- **Never Batch**: Do not lump multiple unrelated modifications into a single commit.
- **Targeted Staging**: Stage only the specific files touched by the unit (`git add path/to/file`). Never use `git add -A` or `git add .` to avoid capturing untracked scratch files.
- **Meaningful Messages**: State what changed, why, and any specific metrics or design choices involved.