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
| [`colors.html`](./colors.html) | Reverse palette generator: takes ANY hex, finds the closest Pokémon by OKLab distance over the 6,148 measured sprite colours, and generates a shade ramp + theme tokens from it. Shiny is not indexed. Also runs the four Component Showcases (Card, Chart, Dashboard, Component) on the GENERATED palette. See §3.B1 |
| [`colors-explore.html`](./colors-explore.html) | 1,025 Pokémon color palette gallery with infinite scroll and URL filters |
| [`color.html`](./color.html) | Single Pokémon color palette page (`?slug=`): hero card, palette grid, shade scales, base stats, and theme exporter. A **bare** `color.html` (no `?slug`/`?id`) shows the same seeded daily pick as the homepage's 今日推薦寶可夢, not the not-found error — one draw, one seed, two callers |
| [`model3d.html`](./model3d.html) | GLB 3D model viewer driven by `model3d-viewer.js`; the file roster is generated into `glb-index.js` and the models live in `assets/glbs/` |
| [`collections.html`](./collections.html) | Special collections hub: 11 cards in 4 groups (稀有與傳說 / 熱門分類 / 遊戲與活動 / 特殊形態), 2 of which are `upcoming` and render as non-links |
| [`category.html`](./category.html) | Reusable template for collection lists (`category.html?cat=<slug>`). 11 categories, one per config in `categories.js`; the roster + a zh-Hant introduction. Does not link to `types.html` — see §3.H |
| [`generations.html`](./generations.html) | Chronological generation guide: 9 generations, 38 games, and 27 regional starters |
| [`cries-gen1.html`](./cries-gen1.html) | Generation I cry lab: a Game Boy APU re-synthesises all 151 cries from their 38 base command lists, with pitch/length/volume controls, per-channel mute and a timeline that marks the end-of-cry crash |
| [`cries.html`](./cries.html) | Cry overview: 1,025 cards carrying their measured timbre features (brightness, hoarseness, duration), sortable along five axes, with a timbre-similarity panel, a waveform, and the two recorded sets kept apart behind a warning |
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
│   │   ├── color-match.js         # OKLab ΔE + closest-Pokémon ranking for colors.html ONLY. Normal palettes only (no shiny). Adds nothing to color-palette.js's exports
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
│   │   ├── gb-apu.js              # Game Boy APU: 2 pulse + noise channels, syntheses gen1_cry_sfx.json to PCM
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
│   │   ├── gen1_conformance.json  # 151 x 48 sampled values of the REFERENCE synthesiser's own output
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
│   │   ├── check_all.mjs          # One entry point for the whole §4 suite, with a content-keyed skip cache (see §4)
│   │   └── lib/                   # negative.mjs — what "caught by" means; record-inputs.cjs; mute-tap.mjs
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

### B1. The Generator Is Not a Smaller Report — `colors.html`

`colors.html` and `color.html` share `paletteGridHtml`, `paletteStripHtml`, `generateTailwindScale`, `.cp-cell` and `.cp-strip`. That is a **shared component library, not a shared layout**: the pages differ in what they are *for*, and the difference is structural, so it must be maintained deliberately or the generator drifts back into being a duplicate.

| | `color.html` | `colors.html` |
| :--- | :--- | :--- |
| Verb | **reports** one species' measured palette | **generates** a theme from a colour you supply |
| First viewport | the species (450px artwork hero) | the **colour input** (the dial is the hero) |
| Measured palette | the subject, in three ramps and a showcase | **not rendered — one click away** |
| Shade ramp | three rows, one per top colour | **derived for the export only, never drawn** |
| Shiny | a toggle, on-page | **not indexed at all** (see below) |

- **Three sections were DELETED, not merged: 「對照 · 實測色盤」, 「生成明暗階」 and 「套用展示」.** All three belong to `color.html`, and this page used to carry a copy of each. Two copies of one species' palette is duplication, not comparison — and the first version of this section claimed the measured grid was "the differentiation that cannot exist on `color.html`", which was true of the *concept* and false of the *value*: by the time a reader reached it, `color.html` was one click away and the second copy was strictly worse. **This page's job ends at the generated palette and the export.** The measured palette, the ramps and the showcase are `color.html`'s, and the provenance chip's whole job is to say where they went.
- **The ramp is still derived, from the INPUT colour, even though it is no longer drawn** — the export ships eleven `--cg-*` variables and they have to come from somewhere. Removing the drawn section must not remove the value, so `generateTailwindScale(inputHex)` stays in `render()` and `.cp-scale` / `.cp-shade` are no longer written. **A grid the reader cannot see and cannot copy from is not a section, it is a string builder with headings.**
- **THE PAGE'S OWN COPY MUST NOT DESCRIBE WHAT WAS REMOVED.** The meta description and the intro paragraph both kept promising 「生成明暗階、套用展示」 and 「同時擺出生成與量測兩種東西」 after those sections were gone. A search-result summary and the first paragraph are the two places a reader is most likely to believe, and no shape check reads either.
- **Do not restore a removed section "just to be helpful".** `check_color_match.mjs` asserts the ABSENCE of `sec-measured` / `sec-gen-scale` / `sec-showcase`, of their containers, of the leftover `showcaseHtml` import, of the `.cg-measured` / `.cg-collapse` rules, and of any dangling `getElementById` target for them — in both the use form (`els.scale`) and the declaration form, because a null key throws in exactly the same way one step later.
- **`color.html`'s shade scale is THREE ramps, the generator's is one.** The report page takes the top **three** palette colours by share and derives an 11-step ramp from each, so the other measured colours are no longer bare swatches with nothing derived from them. **Each row is seeded from its OWN hex, and that is the whole reason the ★ is honest**: `generateTailwindScale` keeps its seed verbatim at the anchor step and the page marks that step, so three ramps all seeded from `primary` would render three credible rows with three ★s, every one marking a colour its row is not showing. Bulbasaur's three anchors land on steps **700 / 500 / 300**, so "★ = the primary" is not even true of the primary's own row any more — the page's prose says 「★ 標示的是該列色票本身」 instead, and that sentence is asserted. The row gutter is a 28px colour bar with **no text**: a `<button>`, because a colour chip's first instinct is to be copied, which is why it carries its own `aria-label`. 28px and not 22 — WCAG 2.2 SC 2.5.8 asks 24×24 of a target and a narrower bar clears it on height alone. `colors.html` renders no ramp at all — `.cp-scale` is untouched and `.cp-scale-stack` / `.cp-scale-row` / `.cp-scale-seed` belong to `color.html` alone.
- **Every element id is a named property of the document, so a bare `scale` in `color.html` is `<div id="scale">`.** This broke the showcase for real and it is the reason the guard below exists. Moving the ramps inside the row callback took `const { scale, anchor }` out of `render()`'s scope, and the showcase call's shorthand `scale,` then resolved to `window.scale` instead of throwing. A DOM node answers `scale['50']` as `undefined`, so `showcaseHtml`'s `scale[step] || primary` returned the primary for **every** step, which set `--cp-sf`, `--cp-ink` and `--cp-bd` all to one colour and drew 「色彩美學」 in the primary on a primary background. Silent, invisible, and in the one section whose entire job is to prove the palette is readable. The showcase now generates its own ramp from `primary` and names it `primaryScale`. **Expect this shape anywhere a page uses short ids** (`#scale`, `#q`, `#sort`): a missing `const` is not a `ReferenceError` when the document already owns the name, and a `Map`-style lookup on a DOM node answers `undefined` rather than throwing, so any `obj[key] || fallback` quietly becomes `fallback` for every key.
- **`generatedRows()` IS THE INPUT COLOUR PLUS THE MATCHED SPECIES' REAL COLOURS, and that is why the generated palette is anchored rather than invented.** It is not six shades of one guess: it is your colour, then the six colours the sprite measurably contains, so the export has a measured basis. The corollary, now that the measured grid is gone, is that **the generated palette IS the measurement** whenever the input happens to be that species' primary — which is the default landing state, since the page opens on Bulbasaur's primary. That is the coincidence that used to need `#cg-collapse` to explain itself, and the deletion resolved it rather than documenting it.
- **`assets/css/colors-generator.css` exists so this page's rules are not `color.html`'s problem.** Every rule in it is `cg-`-prefixed and mounted only here; it is the reverse of the arrangement `colors.css` documents ("page shell inline, components in colors.css"), which exists because three colour pages share components. Putting generator-only rules in `colors.css` couples three pages to one. **Never edit an existing `.cp-*`, `.sc-*` or shared token for a generator-only need — add a `cg-` rule.**
- **The 24-cell legendary grid is a NAMED entry point, and it pins the species — not just the colour.** `LEGENDS` in `colors.html` is `[id, edition]` pairs only; the name comes from `pokemon_data.json`, because a second copy of an official name is a second thing to keep right. 8 across × 3 rows, because 8 is what fits 1,180px at ~130px a cell, and the hero's 380px left column fits nothing.
  - **Loading only the colour and re-running the matcher answers the wrong question.** `#FFFFFF` is the primary of **29** species, so the rank-1 result for white is #0278 and clicking 萊希拉姆 would present a Wingull's palette under a card that says Reshiram. A tie is not the same as an absence: the matcher is right and the answer is still wrong, because "closest" was never asked. `matchOf(id, hex)` therefore builds the record for a named species, with `rank: -1` — a pin did not win a competition.
  - **The winner card's eyebrow is the honest part, and it depends on how the species was chosen.** 最接近 for a ranker's pick, **你選的** for a reader's, plus a tie notice reading 「這個主色有 N 隻共用，排名不由它決定」 from `primaryShareCount()`. Labelling a rank-29 pin 最接近 would be a false claim on the page's largest type.
  - **A pin survives re-ranking ONLY while the input is still one of that species' own six colours.** An unconditional exemption is wrong the other way: click 萊希拉姆 then type `#00ff00` and you keep seeing Groudon. The species' own palette is the exception because the 「換一個生成起點」 row feeds those in one at a time.
  - **The grid is built ONCE, in `init()`, and only its highlight moves.** Calling `renderPresets()` from `render()` threw away 24 buttons and re-requested 24 sprites on every keystroke to change one class — and, worse, left every reference pointing at detached nodes, which do not bubble to the delegated `document` handler, so the control went dead after first use.
  - **Two of the 24 have a near-white primary** (萊希拉姆 `#FFFFFF` 36.5%, 索爾迦雷歐 `#FBF7EE` 37.8%) and the page says so under the grid. They are there because a cover Pokémon is a cover Pokémon; dropping the two that flattered the page would be curating the evidence.
- **The colour field speaks three notations, and the toggle is DISPLAY ONLY.** HEX / RGB / HSL. `parseColorInput()` accepts all three regardless of which is showing, so pasting `rgb(57, 148, 148)` out of a stylesheet works on the HEX setting; a toggle that filtered input would split the typed path from the paste path. `inputFormat` never round-trips through the text, because `formatHex(hex,'hsl')` rounds to whole numbers and `#399494` reads out as `hsl(180,44%,40%)` and back as **`#399393`** — flipping the toggle would restate the colour and every number on the page would then describe one the reader never chose. The hex is the single stored value.
  - **THREE states, not two.** Parseable → commit. **A possible prefix** → say nothing (`hsl(18` is the fourth keystroke of a colour, not a mistake). Neither → flag it and LEAVE THE PREVIOUS RESULT ON SCREEN. `couldBePrefix()` is what keeps the error from scolding per keystroke.
  - **Ranges are strict, never clamped.** `rgb(300,0,0)` is a typo; clamping it to `rgb(255,0,0)` answers a different question.
  - **The format note is LIVE and appears only on error.** It shows the current colour in the two notations the reader is *not* using, so the thing to copy is the thing on screen. It was a static paragraph first, which said a true thing nobody needed until they were already stuck.
  - `parseColorInput()` and `pinSurvivesRequery()` are page-local — §3.B1 forbids adding them to `color-palette.js`'s exports — so `check_color_match.mjs` **lifts them out of the source and runs them** against the real corpus. A source-shape regex over the same lines passes for any mutation that leaves the substrings in place, which is how the first version of the pin guard was blind.
- **The error colour was a hardcoded `#ff9b9f`, and it failed in the light theme.** 8.72:1 on the dark grounds, **1.72:1** on the light `--bg-controls` — a pale pink on a pale blue-grey, invisible in every screenshot taken in dark mode. Now `var(--error-text)`, which shared.css already themes (`#ff7a85` dark = 7.00:1, `#b3261e` light = **5.57:1**). The checker computes both ratios rather than reading the declaration.
- **`#cg-winner` had no `class` attribute, so `display: flex` never applied** and the sprite, strip and text stacked vertically for the life of the page. Nothing about that is visible to a shape check — the elements existed and carried the right classes. Pinned explicitly.
- **The sprite and the strip are side by side inside one `flex: none` figure.** As siblings of the card their width was decided by the species NAME, so the strip was 168px for 無極汰那 and 60px for 夢幻. A caption that changes size with its neighbour is not a caption.
- **`assets/js/color-match.js` never adds to `color-palette.js`'s export surface.** Three pages import that file; the matcher is imported by exactly one. It also does no DOM, no fetch and no audio, which is the only reason its claims are checkable.

**Shiny palettes are deliberately NOT in the match index.** A shiny palette is the same creature recoloured, not a different creature, so indexing both lets one Pokémon enter under two identities and the reader cannot see why it outranked the others. Measured on 3,872 probes of the sRGB cube, **58.2% of winners would have been shiny** — so this is not cosmetic, it changes more than half of all answers. Shiny belongs to `color.html`'s toggle, which is a same-page comparison; this page ranks across species. The cost is real and measured rather than waved away: excluding shiny raises the match distance by **median +0.0026, p95 +0.041, max +0.076** (`#00ff00` resolves to #167 at 0.0894 instead of shiny #140 at 0.0844).

**The distance is OKLab ΔE, and that choice is load-bearing.** §3.B2 records `findClosestChineseColorName()` returning 墨綠 for `#414141` because nearest-in-RGB let a table entry 8 away in one channel beat every grey 20 away in all three. That table was 100 names; this searches 6,148 sprite colours, 61× more. Measured: plain RGB Euclidean and the redmean approximation disagree on the **winner** for 12.8% of a 576-point cube sweep, and on the whole top five for 83.2%. Two further traps the checker pins, both found by writing the mutation and watching the obvious assertion survive:
  - **`#ffffff has L = 1` cannot detect a wrong transfer function.** 1.0 is 1.0 however it is decoded; a swap to plain gamma 2.2 passes it. The assertion that works is **mid-grey**: `#808080` reads 0.599871 and gamma 2.2 reads 0.603241, against a 1e-4 tolerance.
  - **A greys-vs-tinted pair cannot detect a dropped chroma axis either.** With `a` and `b` zeroed every colour lands on the lightness axis, and a grey still beats a dark green, because `#414141` (L 0.3753) really is nearer `#3a3a3a` (L 0.3485) than `#0b3d0b` (L 0.3159). The detector is a **saturated red's chroma coordinates**, which no axis-only metric can produce. Expect this shape: the check that reads like the guard is not the guard.
- **Ranking is primary-first, secondary-as-tiebreak, then ascending id**, and every one of those three is a claim with a wrong version that returns a plausible list. Primary-first rarely bites — **6 of 4,545 corpus colours (0.13%)** have a non-primary nearer than the winner's own primary, and `#20317b` → #970 is pinned as one that does. It is a correctness statement, not a tuning knob. The id tiebreak is what makes `#ffffff` reproducible: it is the primary of **29** species, all at distance exactly 0, and 222 of the 1,025 palettes contain it somewhere.
- **There is no "too far to match" threshold**, deliberately: 6,148 colours cover enough of the cube that any input has an answer, and a threshold is lying to the user occasionally. The ΔE number is displayed instead, as one of the six tiles.
- `node scripts/check_color_match.mjs` (215 checks) and `node scripts/test_check_color_match.mjs` (28 mutation cases) guard it. **Seven of the twenty-eight cases named the wrong assertion when first written and every one was blind** — the RGB swap (it multiplied OKLab coordinates by 255, a change of *units*, which cannot reorder anything), the gamma 2.2 swap, the dropped chroma rows, the reversed tiebreak chain, the reordered palette rows, and two count assertions. The §4 table is the right place to add this suite's entries.

### B2. Colour Naming — Three Namers, One Chroma Gate

The pages do not use one colour namer, they use **three**, and `color.html` prints two of them **side by side for the same hex**: the prose at `color.html:589` is `describeHex(primary)` and the swatch list at `color.html:577` is `chineseColorName(hex)`. Before the gate below they disagreed on **97.6% of primary colours**, and the disagreement was not two words for one colour — each was separately wrong about greys. Arceus #493 was the visible one: primary `#e6e6ee` at 35.73% is 230/230/238, so max−min = **8 of 255**, a grey. `describeHex()` read hue 240 and lightness 91.8 and never looked at saturation, so it said **淺藍**; `chineseColorName()` ran a 100-entry nearest-neighbour over RGB and landed on **薰衣草紫** (`#E6E6FA`, 12 away in one channel). The page said both.

**Every namer is gated on `chroma()` = max−min of the three channels, below `NEUTRAL_CHROMA = 16` → `neutralName()`** (黑/深灰/灰色/淺灰/灰白 by lightness). Measured on all 12,297 corpus swatches: `describeHex` renamed 1,620 (13.2%), `chineseColorName` 2,387 (19.4%), `colorTemperature` 178 (now all `neutral`), and **0 chromatic swatches changed** — the gate sits below the coloured cluster.

Four things here are load-bearing and each was measured rather than assumed:

- **Chroma is absolute and must never be HSL saturation.** `s` is a ratio against lightness, so `#fffff6` measures **s = 100%** while being nine channels from grey, and near-whites are the largest single grey bucket in the corpus (白: 698 of the 2,387). Refactor the gate onto `s` and every near-white flips from grey to a loud colour name. `#e6e6ee` is the mirror image at s = 19%. `chroma()` has two pinned values and one `isNeutral('#fffff6')` assertion for exactly this.
- **The threshold is in a gap, not merely low.** The corpus chroma histogram is empty between the grey cluster and the coloured one, so **16 through 31 all behave identically**; 32 is where it starts eating. That is why raising it cannot be caught by a "greys are named greys" check — nothing between 16 and 32 changes. Of 709 distinct hexes under 16, only 24 have `s >= 40` and every one is a near-white, so nothing visibly tinted is demoted.
- **`describeHex()` on a pure grey returned 紅, not 白.** `max === min` leaves `h` at 0, which is the first bucket in `hueNames`. This is why 1,510 of 12,297 (12.3%) were mis-named before, and it is the checker's most direct detector.
- **Nearest-in-RGB will always match a grey to a tinted name**, because an entry 8 away in one channel beats every 淺灰 that is 20 away in all three: `#414141` came back **墨綠**. 351 of the 2,387 sub-threshold swatches were named this way.

**`灰白` exists because 白色 would be a false claim.** `#e6e6ee` is 92% lightness and is not `#ffffff`; the highest band above 淺灰 is 灰白 and the `l > 0.93` branch keeps real whites white.

**`chineseColorNameWithEn()` is gated identically and deliberately returns the zh-only grey name** — pairing 灰白 with *Lavender* would assert the exact claim being corrected. It is on no colour page today, which is precisely why it needs its own case: an unpaired gate there is invisible until someone imports it.

`check_color_palettes.mjs` guards all of the above, and `test_check_color_palettes.mjs` adds **9 mutation cases against a scratch copy of the module** (the 11 pre-existing cases mutate the palette *data*, which cannot reach this code at all). The scratch tree copies all of `assets/js` because `color-palette.js` → `shared.js` reaches five more files, and a case failing on "cannot find module `form-names.js`" passes for the wrong reason — the baseline case is what proves the harness sound.

**Expect this shape when a guard can only be satisfied vacuously.** Raising `NEUTRAL_CHROMA` to 255 satisfies all three "must not be chromatic" assertions *and* the demotion check at once, because with the threshold at 255 there are **no chromatic swatches left** and the demotion check counts zero. The detector has to be an assertion about colours that ARE still chromatic — here four pinned names (`深藍`/`綠`/`黃`/`青`) beside the threshold. One case was declared as the demotion check and had to be repointed after measuring that it was blind.

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
- `node scripts/check_gen1_cries.mjs` (40 checks) and `node scripts/test_check_gen1_cries.mjs` (23 mutation cases plus the shuffle proof) guard it.

**`assets/js/gb-apu.js`** re-synthesises those 38 base cries, so `cries-gen1.html` plays the cries rather than loading them. It is a pure module with no DOM, no Web Audio and no fetch, which is the only reason the claims below are checkable at all.

**It is verified against the reference's own OUTPUT, not against a description of it.** `assets/data/gen1_conformance.json` holds, for all 151 species, the output length plus 48 sampled values of the 8-bit form the reference page's Download button produces — generated by driving that page in headless Chrome, not by reading its source. The checker also re-imports the APU at 1,048,576 Hz to produce those renders, since Web Audio's ceiling is why the page uses 65,536.

*This distinction is the single most important thing in this section.* Six bugs had this APU confidently disagreeing with the reference while **agreeing with every other file in the project**, because every assertion compared it to a *description* — and a description can be wrong in ways that are self-consistent. Nothing short of comparing output found any of them. Current result: all 151 lengths match exactly, 98.7% of sampled values are byte-identical, every remaining one within one 8-bit step.

**The comparison is 48 samples per species, and that is deliberate.** It used to be 48 samples plus one full-file byte-compare: `assets/data/gen1_charizard_ref.raw`, the reference's complete 1,000,692-byte download for #006. Nothing read it. `check_gen1_apu.mjs` only ever opened the three JSON tables, `gb-apu.js` and `cries-gen1.html`, so the file was copied into all 36 mutation fixtures — about 36 MB of pointless I/O — while AGENTS.md described a byte comparison that had not existed for some time. That is the §4 failure shape exactly: a claim nothing was checking, written down so precisely that it read as verified. The file is gone; the 151 × 48 comparison is what runs, and what the numbers above describe. Regenerating a whole-file vector would mean a 1 MB tracked artifact per species change, which is the cost the sampled form exists to avoid.

- **The length parameter is the stored byte MINUS `0x80`, not its two's-complement signed reading.** The reference's slider holds `byte - 0x80` and the multiplier is `+0x100`. Reading the byte as signed gives a multiplier `0x80` larger, which makes every note **1.5× too long**. Charizard stores `0x80`, so its parameter is `0` and its multiplier `0x100` — no stretch at all; the byte-as-signed reading makes it `0x180`. Its sampled vector settles it: the lengths stop matching.
- **The duty register holds the PACKED byte, not the pattern array.** The reference reads it as `duty & 3`, so an array coerces to `NaN` and then to `0` — silently selecting the 12.5% window on every note of every channel whose low two bits are not `00`. Charizard's second pulse channel is duty `$5A`, low bits `2`, so that channel played inverted for the entire cry. The two channels whose low bits happened to be `0` matched by luck, which is what made this look like tuning rather than a bug.
- **The mix is NOT peak-normalised.** Three channels at a third each sum to at most 1.0, so the signal cannot clip; normalising only rescaled every cry, made a soloed channel as loud as a full one, and made comparison against the reference impossible.
- **Every register is in samples at the Game Boy's clock, so each must be scaled to the output rate — including the noise LFSR clock, which was not.** The pulse channel's `period` was; the noise channel's was not, so at 65,536 Hz the LFSR ran once per 512 *output* samples: 128 Hz where the hardware means 2,048. The symptom was a cry that was correct in every respect except that it had **no hiss in it**. Measured on the rendered channel, 76 zero crossings per second against the reference's 1,533; after the fix, 1,532.
- **…and that is precisely what a native-rate conformance comparison is blind to.** At 1,048,576 Hz the conversion factor is exactly 1 and the bug is a no-op. Comparing at the native rate is what makes every length and every waveform sample verifiable, and it is exactly the rate at which a rate-dependent bug disappears. So the checks for it are **rate-independent by construction**: the same species must report the same noise clocks and render the same grain at 65,536 and at 1,048,576. Expect this shape again — a quantity that only matters on the way to the speakers can only be checked on the way to the speakers. The master volume was the other one, and **it has been removed rather than checked**: `sliderToMaster()` mapped a 0..10 page slider onto the channel scale's 0..15, which made the default reading of 3 a master volume of 5 — a third of full scale, too loud — and it was a conversion between two numbers that were already the same unit, so there was nothing for it to be right about. The page now presents 0..15 directly and defaults to 3, and the claim is asserted **by measuring** rather than by reading an expression, because it is still the one loudness quantity no waveform assertion can reach.
- **The duty register turns once per FRAME** (upstream's own comment says "once per frame"), and the volume envelope steps once per `|sweep|` frames. Charizard's first three notes sit at RMS 0.3125, 0.2849, 0.2708 — each slightly lower because of its own fade, with no collapse inside a note.
- **`sound_loop` IS applied**, and the reference's feature list marking it "unsupported" refers to its UI, not its data: cry0d's Ch5 arrives there with the block already duplicated, 14 entries where the raw table holds 7. `count` is the number of TIMES the block plays. Dropping it left the nine species on base cry0d short by exactly one block.
- **The one sound_loop's `target` and `count` are the only fields used**, so loop targets are stored as `"Ch5"` and not as literal labels.
- **Note positions are accumulated in clock units and rounded once**, not per note: the reference's `17,556 × frames` is an integer at its own rate, and rounding each note's delta instead of the cumulative position lost 4 samples across Charizard.
- **The pitch-shift cancellation is per note, not per sample**, and the offset is decided at the note's start against a cutoff one frame before the pulses are *scheduled* to end — the sum of the notes, not the length they render to, since the ring-out runs on past it. Measured over the corpus: of 689 noise notes, 620 keep the offset, 69 begin after the cutoff and never get one, and **63 span it**, so for those the pitch changes partway through. `noiseOffset()` is the single definition both the renderer and the timeline call, after they each carried their own copy and disagreed on every note (one in samples, one in seconds).
- **The ring-out is bounded only where the envelope can never empty.** Upstream does not implement `sound_ret`, so its last note rings until the volume reaches zero; a sweep of `0` means it never does, and an unbounded version rang one synthetic note for four million samples. Sixteen frames is the bound there. Bounding *every* note is wrong and was: a legitimate tail is up to fifteen envelope steps each a whole `|sweep|` frames apart, so 240 frames at the largest sweep, and a flat 16-frame cap silently truncated seven species by one frame each. **Those seven were then recorded in the checker as a "known set" on the reasoning that a tolerance beat a red test** — which was covering up a bound that would equally have hidden a truncation twice as large. Do not do that: a named exception list is for upstream quirks you cannot fix, never for your own truncation.
- **The data is diffed against the reference's own command tables**, and it is byte-identical across all 38 bases — every `frames`, `volume`, `sweep`, `freq` and `duty` byte in all 114 channels. That diff found the one remaining data bug: `fetch_gen1_cries.py` read the fade as an unsigned literal, while the tables use a **4-bit signed magnitude** (`pokered`'s macro packs the direction into bit 7 and notes that "a value of 8 is the same as a negative one"), so `square_note 12, 0, 8, 0` means *increase*. Stored as `+8` it is a fade out of a note whose volume is 0, which clamps at 0 and makes the note **silent** — nine notes across six bases. pokered's own engine agrees, writing `$8` to NR12 with the comment "fade in sound". The checker asserts the **range** `[-8, +7]`, not the nine values, so the next one is caught whatever it is.
- **The synthesis rate is 65,536 Hz, not the real 1,048,576 Hz**, because Web Audio caps a buffer at 96,000. The ratio is exactly 1/16, so nothing drifts.

`node scripts/check_gen1_apu.mjs` (89 checks) and `node scripts/test_check_gen1_apu.mjs` (36 mutation cases) guard it. Sixteen of those cases failed when first written and **every one was a real gap rather than a bad expectation** — the mutation test is the reason this section exists, so read it before trusting any assertion here that "looks obviously true".

**The mutation harness had the disease this section warns about, and the rule now lives in §4.** A case's `expect` must name the assertion that actually detects its mutation; four of the 34 did not, and every one of them passed for an accidental reason because the matcher asked only whether the text appeared *anywhere* in the checker's output — and a checker prints an assertion's description whether it passes or fails. The worst of them had been calling itself a timeline test for its whole life while being a waveform test. `scripts/lib/negative.mjs` now decides this for all ten negative suites, and §4 has the full table of what each case was actually detected by.


**Where the 34 cases' time goes, and the two structural fixes.** The checker's native-rate conformance loop is **4.8 s of its 6.5 s**, so:

- The corpus is walked **once**, not four times. Four separate loops each rendered all 151 species and two measured the same thing; `renderSpeciesCry` is pure for `(cries, sfx, id)` with no options, so one pass answers all four questions. The per-species result is reduced to scalars and **dropped** — retaining 151 renders would hold ~78 MB of Float32Array alive, which is the one way this edit could cost more than it saves. Checker: 6.5 s → 5.5 s, and its output is unchanged line for line.
- The 19 cases whose detector is *not* the conformance comparison run against a fixture whose **copy** of the checker has that section removed: 5.5 s → 0.63 s each. `scripts/check_gen1_apu.mjs` gains no switch and no environment variable, because a supported way to skip the conformance comparison is how it would stop happening; the baseline always runs the whole checker. Eligibility is decided by `expect` alone, so there is no per-case flag to forget and an unflagged case runs everything.
- The one guard that makes the strip safe: the baseline runs a **second** time with the section removed and requires it to pass having dropped **exactly 4** of the 89 checks. A strip that took one check too many would leave the 19 cheap cases asserting against a silently narrower checker, and every one of them would still pass — they only require their own detector, which a narrower checker satisfies more easily, not less.
- Measured on this machine at `POOL = 4`: **~62 s → ~34 s**, with all 36 cases and all 89 checks intact. Cheapest first is wrong — the heavy cases are issued up front, so every trailing wave is short.

**Generating the conformance vectors has one trap worth writing down.** The reference's roster is a **0-indexed array**, so a dex id is `index + 1`. Reading it as `pokemon[id]` shifts every vector by one species and produces a plausible-looking file that matches nothing — including one species whose vector is not a species at all. The checker therefore asserts the two rosters agree on cry, pitch and length for all 150 before it trusts any of the audio, and the vectors carry those three fields for exactly that reason.

### G. The Two Cry Pages

`cries-gen1.html` and `cries.html` are driven over the Chrome DevTools Protocol by `scripts/check_gen1_page.mjs` (74 checks) and `scripts/check_cries_browser.mjs` (19 checks). Those exist because they are the claims no static checker can make — `check_gen1_apu.mjs` can prove the synthesis is right, but not that the page says true things about it or that pressing play does anything.

- **A playback cursor's guard must be `!== null`, never `> 0`.** `AudioContext.currentTime` reads exactly `0` on the first play, because the context has only just resumed, so `startedAt > 0` reported "not started" for the entire first playback and the cursor simply never appeared. Both pages draw one, from one clock, so the waveform's played region and the timeline's playhead cannot drift.
- **The waveform is cached in an offscreen canvas** and playing costs one `drawImage`. It is a thousand-odd line segments plus labels, none of which change while audio plays. The cache is bound with `const` from the first line — there is no "get the visible context, then reassign it to the cache" step, which is how `cries.html` ended up throwing a TypeError instead of drawing anything (below).
- **`cryPlayer.play()` resolves when a cry ENDS**, so a caller had no way to know when playback began or how long it would run. It takes an additive `onStart` hook carrying the duration and the clock reading; the player owns the AudioContext and is the only thing that can read that clock.
- **Both cry pages share ONE autoplay switch, and it must never fire on load.** `assets/js/cry-autoplay.js` mounts a `role="switch"` control with `aria-checked`, ON by default and persisted under its own localStorage key — one module rather than two copies that would drift apart invisibly. It is ON by default because both pages exist to be skimmed: comparing two species means clicking a chip and listening. **The rule that matters is the load case, and it takes a different shape on each page.** `cries-gen1.html`'s `select()` runs at boot, on every hashchange and from the reset button as well as from a chip, so there the switch is a *parameter* (`autoplay: autoplay.on`) and only the click handler passes it. `cries.html` reads the switch inside `probe()`, which is only ever reached from two click handlers — so the check there is on the call sites, and `check_cries_page.mjs` counts them on comment-stripped source: a fourth mention lives in a comment, and matching prose would make the count change when the code is explained. Expect this shape: on a page where one function serves boot and clicks alike, the feature flag has to be an argument rather than a read.
- **A mute nothing verifies is not a mute, so the second line is installed in the page.** Both CDP checkers keep `--mute-audio`, and that flag is the right *first* line — it mutes at the browser, so the AudioContext still runs and `currentTime` still advances, which is what keeps the playback assertions meaningful. It is not the whole guarantee, because it is a request: a mute that quietly stops working produces no red output, only a cry at a fifth of full scale, which is the worst pair of failure modes available. So `scripts/lib/mute-tap.mjs` is injected with `Page.addScriptToEvaluateOnNewDocument` — before any page script, so the module scope cannot race it — and replaces `AudioContext.destination` with a gain node at zero. Both pages wire their output through exactly that one call (`cry-player.js:196`, `cries-gen1.html:279`), so nothing reaches the speakers.
  - **Nothing either checker reads is downstream of that gain.** `currentTime`, `startedAt`, `duration`, `aria-pressed` and canvas pixels are all clock or DOM. The APU still renders every sample and `resume()` is still what unblocks the clock, so "pressing play reaches the synthesiser and moves a cursor" is still precisely what is measured. Only the last centimetre is discarded.
  - **And it is asserted, by reading the live `AudioParam` rather than a value recorded at install time** — so the question answered is "is the output muted *now*", and a page that opened the tap back up is caught. The probe sits **after the first play**, because the AudioContext is built lazily and a probe before that reads a tap that has not been asked to do anything. Verified by mutating the module in a scratch copy: `FAIL ... (0 AudioContext(s), gain null, the tap script never ran)` and `FAIL ... (1 AudioContext(s), gain 1)`. A mute that fails loudly is a mute; this one used to fail silently.
  - **One module, not two copies** — for the reason `cry-autoplay.js` is one module. Two copies of a mute drift invisibly, and the drift is noise.
  - **The limit, named:** it wraps `window.AudioContext`, so it does not cover `OfflineAudioContext` (which has no output device to mute anyway) or a page that reached the audio hardware another way. Neither page does.
- Both also take `CRY_PORT` (default 5500) so they can run against whichever Live Server port is actually up.
- **Never assert that an idle control is showing live state.** The timeline lane label read 播放中 for every unmuted channel, which was never true of anything.
- **A `details` group must stay open when it holds the current species.** Selecting a Pokémon used to collapse the list it had just been picked from, so comparing two relatives meant reopening the same group for every click.
- **The stored length byte is the frame count minus one.** Printing it as a frame count made every note in the command list read one frame short. The list shows the real count with the raw byte beside it, since the byte is what the ROM stores.
- **Count drawn pixels by ALPHA, and the assertion must be able to return false.** `cries.html`'s `drawWave()` bound its context with `const` and then reassigned it to the offscreen cache two lines later, which is a TypeError in module scope — the probe waveform never drew at all. `check_cries_browser.mjs` reported `ok` for the entire time, because it counted "dark" pixels in the top four rows while ignoring alpha, so every untouched pixel `(0,0,0,0)` scored as dark (2,400 of them, a perfect score), and because it asserted `typeof drew === 'number'`, which is true of `undefined` and therefore of no result whatsoever. It now measures ink across the whole canvas and requires more than 500 of it. Expect this shape on any canvas check: **a blank canvas is transparent, so alpha is the only thing that distinguishes "drew nothing" from "drew black".**
- **A slider's id is not the state field's name.** The three sliders were wired `for (const id of ['pitch','length','volume']) state[id] = value`, which worked for two of them and silently created a fourth property for the third: the Length slider's key is `lengthSigned`. So `state.length = 40` was written and `state.lengthSigned` never moved — the Length slider did **nothing at all**, same bytes rendered, same duration, bit-identical audio, while looking exactly like a working control. It is now an explicit `SLIDERS = { pitch, length, volume }` mapping, and `check_gen1_page.mjs` moves each slider and reads back the field it names — for Length the observable is the **sample count**, because a label can follow a readout that is wired to nothing while the sample count is the audio's own length. Expect this shape: a control can be inert and there is nothing in a screenshot to notice.
- **The recorded cries play at the SAME loudness as the synthesised ones.** `cry-player.js` exports `DEFAULT_VOLUME = 3 / 15` and it is the default in *both* localStorage branches and the field initialiser. It was unity, and pressing play on `cries.html` or `detail.html` was genuinely startling — a recorded cry is a plucked square-ish tone with a wide dynamic range, and comparing twenty of them at full scale is not something to ask of anyone. It is 3/15 specifically because that is the master volume the Generation I lab presents as its default, so the two pages can be compared without one being louder for reasons that have nothing to do with the Pokémon. It lives in the **player** because the player owns the output gain; a page-level trim would have to be written twice and one page would eventually be missed. The per-call `volume` argument in `play()` is a separate per-play trim and still defaults to **1** — it multiplies into the shared gain, so defaulting it to the same number would square the level to 0.04.
- **The three sliders' rows must be pinned, not bottom-aligned.** `align-items: flex-end` aligns the one edge that differs: the hint under each slider is one or two lines of 10px text and they do not come out even, so 長度 was pushed up while 音高 and 音量 were pushed down — three labels at three heights. Each `.cg-slider` is therefore its own grid with `grid-template-rows: 20px auto 1fr`: the label always gets the same height, so the labels share a baseline and the tracks share a line, and the hint — the only part that varies — hangs below freely. The range also gets an explicit `height: 22px`, because an unstyled range's default height differs per engine and 2px there moves the whole track.
- **The intro's 6:4 split must leave the prose column AT LEAST its own measure.** The paragraph is set to 68ch, so a split that narrows the column below that does not change the line breaks — it just makes the grid the binding constraint and leaves the measure a lie written in the stylesheet. 7:3 gives ~700px at this page's width, well past 571px of measure, so the extra room buys nothing and costs the sprite its share; 6:4 lands at 590px. `check_gen1_page.mjs` asserts the column is not narrower than the measure, and reads the **grid tracks** rather than the sprite figure's box — `justify-self: center` shrinks that box to its 112px of content, so measuring it reports a 9:1 split for a grid set to 6:4.
- **The waveform ink is not the accent.** `--accent-gold` is gold in dark and **Poké Ball red** in light — by design, per shared.css's own comment on the light palette. Right for a link or a 3px outline, wrong for a 120px trace, where at ~4,000 points a red trace stops being a waveform and reads as one solid block. The traces and the playhead therefore use `--cy-wave-ink` (the gold in dark, a slate mixed from `--text-primary` and `--bg-card` in light); the **note bars keep the accent**, because the unshifted-tail marker has to stay a different colour from its parent bar and that difference is the load-bearing part of the crash explanation. Both values are theme tokens, so the no-raw-hex rule still holds.
- **The mix's sample count was printing seconds.** `${samples.length / SYNTH_RATE | 0} 個樣本` floors a sub-second cry to zero, so that line read **"0 個樣本" for all 151 species**. And it is now printed with a thousands separator, which broke the check that reads it — matching `\d+` against "62,541 個樣本" captures **"541"**, a different number that still scaled correctly with the slider, so nothing downstream could tell.
- **The four waveforms are four ROWS OF ONE STAFF, not a waveform above a timeline.** `cries-gen1.html` draws `mix / pulse1 / pulse2 / noise` the way the reference does — one band each, sharing a time axis — and each band carries its own note bars underneath its trace. Two reasons, and the second is the load-bearing one: **a waveform's horizontal extent *is* a timeline's extent** (same `total`, same interval), so drawing it twice as two stacked blocks asked the reader to hold an alignment in their head that the page could guarantee for them. One row per channel cannot disagree with itself. The mix is row 0 of the **same grid**, not a separate canvas above it — that is what makes all four share a left edge and a width, and a checker asserts the mix is `.cg-lane-mix`'s plot rather than a sibling of the staff.
- **Draw a trace, not a min/max envelope.** The reference draws a polyline through the samples, one point every four, and that is the only reason its lanes read as waveforms. A per-column min/max cannot show a Game Boy square wave at all: at 65,536 samples over ~700 columns a column holds ~87 samples and contains **both** extremes, so every column spans the full height and the lane comes out as a solid bar. Following the samples has a second benefit — a flat run needs no special case, because the noise LFSR shifts only every 128 samples, so most of that lane is a plateau and a plateau drawn as a line is a visible horizontal line. The envelope version needed a one-pixel branch for exactly that and still came out 96% blank (173 inked pixels of 34,656).
- **The lane traces hang from the bottom of their band, not centred in it.** The negative excursion is given up on purpose: a symmetric trace uses the band twice over and reads as a filled block, whereas hanging it frees the lower half for the note bars, so a lane reads as *sound above, notes below*. The low level is not discarded — it is the line on the zero line, so a square wave shows its two levels, which is the duty cycle the command list prints as a percentage.
- **Every one of the six synthesis bugs above was found by comparing against rgmechex's OWN OUTPUT, and that is the page to thank.** [rgmechex.com/tech/gen1cries.html](https://rgmechex.com/tech/gen1cries.html) is the reference synthesiser; `gb-apu.js` is transcribed from its source rather than reasoned about, and the six documented failures (per-quarter-period duty rotation, continuously-decaying envelope, time-stretched noise, single-field noise rate, no ring-out, byte-minus-0x80 length parameter) were each written wrong first and each only surfaced against that page's output. **This is recorded here rather than on `cries-gen1.html` on purpose:** the page's 出處 section names the reference and the behaviours taken from it, which is what a reader needs, and the story of our own debugging is not theirs to read.
- **A waveform must be drawn at full scale even when the audio is quiet.** The APU multiplies the mix by `clampVolume(volume)/15`, so at the default of 3 the array the page holds is a fifth of full scale — and the mix was drawn from it directly, so the whole thing looked like a whisper *and changed shape as the reader dragged the volume slider*. `unmasterGain()` inverts the APU's own factor; loudness belongs in the ears, a waveform is a picture of the sound's shape. A master volume of 0 renders all zeros, and that lane says 音量 0 rather than drawing a flat line, which would be a different and wrong claim (「this Pokémon is silent」).
- **Two axes in one row: bars are positioned in SECONDS, the waveform is indexed by SAMPLES.** Dividing a note's start by the sample count puts every bar under 0.02% of a 62,541-sample lane — seven bars stacked on the left edge, and a check that only counted them saw nothing wrong. `check_gen1_page.mjs` reads the last bar's right edge, the one number that moves when the two are conflated.
- **A muted lane changes colour rather than only opacity**, because gold at 0.28 alpha over a dark panel is still gold, so the dimming communicated nothing. Measured as a colour distance between two lanes, since "it looks dimmer" is not something a checker can be asked about.
- **The picker's 151 sprites are asserted as a BINDING, not as a download count.** All 151 chips are `loading="lazy"` and the panel is long, so a few seconds in only some 50 have decoded. An earlier version of the check asserted "every sprite in the viewport has decoded" and failed — that measures Live Server's throughput, not the page, and the only way to satisfy it would be to delete the lazy loading that is correct. What is checked instead: every chip has a sprite, each one's `src` is **its own species'** file rather than a shared placeholder, all are lazy, and the one image the reader is looking at — the selected species' — decodes at 96px, which is the only failure mode the binding can have.
- **A clock read every frame and written nowhere is the same bug as a dead slider.** `cries.html`'s probe cursor computed `(progress.now - progress.startedAt) / progress.duration`, and `progress.now` was initialised to 0 and never assigned again — so the ratio was negative, clamped to 0, and the cursor sat at the origin for the life of the page. `cry-player.js` now exports `now()`, because the AudioContext is private to the player and a page cannot fake that clock on a different timebase without drifting against the `startedAt` it was handed. Two instances of this shape on one page, which is the tell: **a field that is read but never written is a feature that was never built.**
- **The probe waveform's played region is painted in the Pokémon's own colour**, not with a dark wash. The wash is the Generation I lab's device and it reads as "already played" only because that trace is gold on a dark panel; on a neutral slate it is a dirty smear that says nothing about *which* Pokémon is sounding. So `drawWave()` keeps the trace as **geometry** as well as pixels — a 220-segment `Float32Array` — and `blitProbe()` re-strokes the played part over the neutral one, in the sprite's average `rgb` (the same value detail.html puts on its hero card). **The accent keeps BOTH endpoints of every envelope segment** — `probeTrace` is four numbers per sample (x, top, bottom), not two. It was two, holding only the top, and the played region drew as a single line along the upper envelope: playback showed the top half of every bar and nothing below it, which is not the same waveform in another colour but half a waveform. The accent also strokes at the **same weight** as the neutral trace, because a heavier accent made the played half a different-looking shape rather than the same shape recoloured. `check_cries_browser.mjs` counts the accent's ink either side of the zero line for exactly this reason.
**The two regions are drawn as two DISJOINT regions, not one over the other** — the cache is blitted only into the unplayed span and the accent stroked only into the played one. Stroking the accent on top does not work on this waveform specifically: it is a peak envelope, 220 vertical segments from each sample's top to its bottom, so at this width consecutive segments merge into solid bars and a 2px accent on the same path as the 1px neutral line puts the neutral line **down the middle** of the accent. All that shows is a tan fringe either side of a white core, which is exactly what "it looks like it is behind the grey" was. Because nothing overlaps, the accent can be as heavy as it needs to be to read at all. `check_cries_browser.mjs` locates the accent by colour **derived from that species' rgb**, not by comparing two thirds of the canvas: at the frame the loop stops on, the played region is a sliver, so a thirds-based mean compares two neutral bands and finds nothing. Its first version also wrote the predicate as channel tests tuned for a reddish accent, which excluded Charizard's tan exactly — so build the predicate from the colour you are looking for.
- **A filter and a scroll position are different quantities and must not share a field.** `cries.html` had one `state.gen` serving as both the generation filter and the page counter, so `render()` sliced `state.gen * PAGE_SIZE`: 第 1 世代 asked for 60 cards out of all 1,025 and showed exactly what the unfiltered page showed, with `aria-pressed` claiming the chip was on, and the sentinel's `state.gen++` re-picked a generation on every scroll. It is now `state.gen` (filter, narrowed by the pokemon record's own `generation`) plus `state.pages` (batches on screen), and `computeAxisRange()` reads the filtered set too — otherwise the meters stayed scaled against all 1,025 while the cards showed one generation.
- **The master volume is on the channel scale's own 0..15, and the page presents that same 0..15 slider, defaulting to 3** — about a fifth of full scale, which is comfortable where 15 is not. `sliderToMaster()` is gone, per the rate-independence note above. `check_gen1_apu.mjs` renders species 6 at volume 3 and at volume 15 and requires the peaks to stand in a ratio of one fifth: the mix divides by three and never normalises, so a ratio of peaks **is** a ratio of volumes. Note which mutation that actually catches — squaring the curve, which stays in range and leaves every waveform byte identical. The obvious one, `/ 15` to `/ 10`, is caught by the clipping check instead, because a full-scale render then exceeds 1.0; a case must name the assertion that detects it.

**`assets/data/cry_features.json` (generated by `scripts/analyze_cries.py`)** is one 34-number row per roster file — `dur` `peak` `rms` `zcr` `centroid` `rolloff85` `flatness` `flux`, then 13 MFCC means and 13 MFCC standard deviations — for 1,025 latest and 649 legacy cries. 499 KB, and no similarity matrix: 1,025² floats is 4 MB, and the browser multiplies the rows it already has.

- **Every file is resampled to 16 kHz first, and that is not cosmetic.** The corpus spans **fifteen sample rates**, 8,000–48,000 Hz, with 784 files at 32,728 Hz against 120 at 44,100 Hz. A mel filterbank built over each file's own Nyquist gives those two groups different meanings for the same coefficient, so a search would partly rank which encoder produced the file. 16 kHz is justified by measurement: 90.6% of energy is below 4 kHz and 98.2% below 8 kHz.
- **`peak` and `rms` are measured on the decoded signal, not after resampling**, because both are independent of sample rate and FFT resampling smooths `25.ogg`'s peak down from 1.0391 to under 0.94 — which would hide the fact that the corpus is not clipped. The measured maximum is 1.2111. Consumers drawing an envelope clamp at draw time.
- **legacy and latest are NOT comparable.** Centroid medians are 1,327 Hz against 2,992 Hz, flatness differs by two orders of magnitude, every legacy file is at 10,512 Hz. That is a difference in how the two sets were recorded, not between the Pokémon. They are stored under separate keys, range-checked separately, and the checker asserts the offset is *still present* so a change that quietly merged them is noticed.
- **`node scripts/check_cry_features.mjs` (24 checks)** and `node scripts/test_check_cry_features.mjs` (19 mutation cases) guard it. The assertion that earns its keep is **every dimension must vary across the corpus**: a constant column means a filterbank that collapsed or a DCT that never ran, which passes every shape and NaN check while the search degrades to chance.
- **"Most similar cry" cannot be a similarity ranking here.** Measured within one corpus: same-family pairs average 0.2076 against 0.0075 for unrelated pairs — a real separation — but top-1 same-family accuracy is **2.1%** against a ~0.1% random baseline. Log-mel mean+std (26/40 bands), MFCC 13, MFCC 20 and a 40 ms window all land between 1.5% and 2.1%; nothing is meaningfully better, because each modern cry was composed independently and evolutionary relation does not predict how a Pokémon sounds. These features are honest timbre descriptors. Present them as axes, not as a semantic ranking.
- `cries.html` therefore ships the search as a **音色** ranking with the measured figures on screen — top-1 2.1%, top-20 12.6% against a 3.2% baseline — and says 音色而非血緣 in the DOM. Two consequences worth knowing before editing it, both found by measurement rather than by reading:
  - **Scores must be standardised per dimension before they are compared.** Raw, `centroid` runs to 3,167 while `flatness` runs to 0.7, so an unstandardised cosine returns **1.000 for every pair** and the list looks perfectly plausible while being decided by two dimensions. `indexSet()` computes means and deviations **per set**, not once, because the two recordings differ enough that a legacy vector standardised with latest's statistics is not the same measurement.
  - **No weight preset may activate a single dimension.** Cosine over a 1-D vector is always ±1, so a preset called 「只看明亮度」 returns 1.000 for every neighbour and orders them by distance *descending* — the exact opposite of its label, silently. Ordering by one axis is what the sort dropdown is for. `similarTo()` still falls back to absolute distance if only one dimension is ever active, because that failure is silent rather than loud. `check_cries_page.mjs` asserts both.
- `node scripts/check_cries_page.mjs` (64 checks) and `node scripts/test_check_cries_page.mjs` (35 mutation cases) guard the page's claims. Five of those cases failed when first written and each was a weak assertion rather than a bad expectation: a `key:` regex that matched the weight presets as well as the axes, a `cp-` scan that found the comment explaining why `cries.css` must not claim one, a roster-gate check that tested for the identifiers instead of the import, a hardcoded-row detector whose threshold also flagged the probe's legitimate `[0, 1, 2, 3]` MFCC readout, and a `state.gen` write-count that balanced because the `IntersectionObserver` it was supposed to exclude is defined *after* the handler — so a mutation moving the sentinel onto the filter passed. The last two are the §4 rule in its purest form: the count has to be a count of something that cannot be on both sides, and the forbidden region has to be bounded at the thing that actually commits the sin.

### H. Category Pages vs. `types.html` — Two Different Questions

`category.html?cat=dragon` and `types.html?type=dragon` both exist and both list the same 70 species. **A category page must never link to `types.html`, and must never be merged into it.** Decided by the user when the Dragon page was added; do not re-propose the cross-link.

- A **category page** answers 「有哪些龍屬性寶可夢」 — a roster plus an introduction. Its `prose` and `notes` are this project's own zh-Hant editorial, which is the point: it is the detailed species introduction.
- **`types.html`** answers 「龍屬性的招式、特性、道具、訓練家與相剋關係」 — battle mechanics, and the only place the effectiveness matrix appears. Its prose is upstream English by design (§3.D), so it is not a substitute for a zh-Hant introduction and must not be given one.
- The two are complementary, not overlapping, so a reader who needs the mechanics follows the site's own type browser from the nav. Adding a "see also types.html" link to the category template was considered and declined: it would put a battle-mechanics page on the path of someone who asked a species question.

**Adding a category is a three-list edit, in this order.** `CATEGORIES` (append the config), `CATEGORY_SLUGS` (append the slug — it is a literal list, *not* `Object.keys(CATEGORIES)`, and `category.html` falls back to element `[0]` on an unknown slug, so never insert at the front), and `NON_HUB_SLUGS` or `COLLECTION_GROUPS`. All three are literal lists on purpose: `check_categories.mjs` asserts `CATEGORY_SLUGS \ HUB_SLUGS === NON_HUB_SLUGS` and hub order against `CATEGORY_SLUGS.filter(...)` with `===` on the exact array, so a category that reaches the hub by omission is impossible by construction. Appending is the only insertion that leaves both orders untouched.

- `totalCards === 11` in `check_categories.mjs` is a hardcoded count of the hub. Prefer `NON_HUB_SLUGS` (the 600族 and 龍屬性 precedent): the homepage already links both from the 熱門搜尋 row, and the collections hub is a different navigation surface that neither page needs to appear in.

---

## 4. Verification & Testing Commands

Run regression checks whenever modifying data structures, selectors, or color logic.

**`node scripts/check_all.mjs` runs everything, and skips whatever cannot have changed.** The suite is 33 scripts run by hand and they are not equally expensive: `check_gen1_apu.mjs` is 6.0 s of which 5.0 s is one pass over the 151-species corpus at 1,048,576 Hz (146,311,704 samples), and `test_check_gen1_apu.mjs` is 37 s because sixteen of its thirty-four cases need that same pass. So forty seconds of every run was re-deriving a fact about `gb-apu.js`, which a colour edit cannot change. Measured on this machine: **2m10s cold, 0.0s when nothing relevant moved**, 99 s when `gb-apu.js` alone is touched.

- **There is deliberately no `--quick` flag on any checker.** `check_gen1_apu.mjs` already says why: "a supported way to skip the conformance comparison is exactly how it would stop happening." A flag is a promise the reader has to remember to keep. The skip lives in the runner, is derived from file CONTENT, and a skipped checker says so on its own line with the reason.
- **The input lists are PROVEN, not reviewed.** `--prove-inputs` runs each checker under `scripts/lib/record-inputs.cjs`, a CommonJS preload that records every repo file it opens, and fails if the recording disagrees with the manifest. Miss one file and the checker is skipped after that file changed, so the run is green having verified nothing — strictly worse than no cache, because it looks like coverage. A grep cannot answer it, for the reason `check_nav_pages.mjs` documents about `rg -l initHeaderNav *.html`. Two directions are both required: **read but not declared** (the dangerous one) and **declared but not read** (a typo or a checker that stopped reading something). Proven by breaking the manifest in a scratch copy — both fire.
- **It is a `-r` preload and not `--import`, and the difference is silent.** Node snapshots a builtin's ESM named exports when the module is first linked, so `import { readFileSync } from 'node:fs'` binds the ORIGINAL function and a patch applied by an `--import` module afterwards is never seen. Measured: with `--import`, `check_color_palettes.mjs` recorded five files and missed both JSON tables it plainly reads. A CJS preload runs before the main module is linked, so the same patch is picked up by every named import.
- **What is always in the key, whatever a checker declares:** the checker itself, the checker a negative harness exists to attack, every file in `scripts/lib/`, and `check_all.mjs` itself. Editing a checker therefore invalidates its own entry with nothing extra for a maintainer to remember, and changing the cache's own rules cannot reuse entries the old rules produced.
- **Two checkers are honestly unverifiable and say so on every run.** `check_gen1_page.mjs` and `check_cries_browser.mjs` open NO repo file — their pages arrive over HTTP from Live Server — so their input lists are read off the HTML by hand. That is the weakest claim in the manifest and it is printed as such rather than hidden behind a green tick. The recording is what *establishes* that they touch nothing, rather than a comment claiming it.
- **Also named, because each is a way this can be green and wrong:** a file read only on a branch NOT taken during the recording is not seen (mitigated by the checker's own hash being in the key); existence probes are keyed on `path:size`, not content; files over 256 KB — the cry corpus, the GLBs — are keyed on `path:size:mtime` rather than content; and the cache trusts the last green result on this machine, so `--force` exists for a checker that passed for a reason other than its inputs.
- Groups are `cry-apu`, `cry-data`, `cry-page`, `color`, `nav`, `data`, `type`, `model`. `--skip=cry` covers the first three without naming them; `--only=`, `--force` and `--no-cache` also work.

```bash
# Everything, with the content-keyed skip cache
node scripts/check_all.mjs

# Prove every declared input list against what the checker actually reads.
# Run this after editing a checker, adding one, or renaming an input file.
node scripts/check_all.mjs --prove-inputs

# One group, or everything but one
node scripts/check_all.mjs --only=cry-apu
node scripts/check_all.mjs --skip=cry
```

**A negative test must name the assertion that actually catches its mutation, and `scripts/lib/negative.mjs` is the only thing that decides it.** Every `test_check_*.mjs` answers the same question — did this deliberate defect make the checker report the failure it was supposed to report? — and the obvious way to ask is `output.includes(expect)`. That is wrong, because a checker prints an assertion's description whether it PASSES or FAILS, so matching anywhere only asks "is this text present", which a case whose `expect` names a *different* assertion satisfies for free.

`caughtBy(out, expect)` requires the string to appear inside a **failure report**: the `FAIL` line plus its indented continuation. The continuation matters — `eq()` prints the offending values on a `got:` line, and a case is allowed to name one of those. An earlier version matched the `FAIL` line alone and so rejected two perfectly good cases in `test_check_cry_features.mjs` that name the violated condition (`rms 1.23 > peak 0.61`, `centroid above Nyquist`) under a shared "physically possible" assertion. Matching the line alone would have had me "fix" two correct cases into wrong ones. **The rule is not "on the FAIL line", it is "not in a passing check's description".**

Twelve cases across four suites were naming the wrong assertion and passing for an accidental reason:

| Suite | Case declared | Actually detected by | Why the declared one was blind |
| :--- | :--- | :--- | :--- |
| `color_match` | `#414141 is closer to a grey` | `a saturated red has a large positive a` | with the chroma rows zeroed every colour lands on the L axis, and a grey still beats a dark green on lightness alone |
| `color_match` | `#ffffff has OKLab L = 1` | `#808080 lands at OKLab L = 0.5999` | 1.0 is 1.0 however it is decoded, so plain gamma 2.2 passes it — the discrimination is in the midtones |
| `color_match` | `ties fall through the declared chain` | `the species whose PRIMARY is the input wins` | on `#ffffff` all five primaries are at distance 0, so reversing the chain compares five equal values and lands in the same order |
| `color_match` | `every reported primary is in the corpus rows` | `the reported primary is the highest-share colour` | reversing a palette's rows leaves every colour present, so membership still holds |
| `color_match` | `one group per species, not per variant` | `the index holds every NORMAL-palette colour` | appending shiny rows into an existing group leaves the count at 1,025 |
| `color_match` | `a pin survives only while the input is one of that species own colours` | `but NOT after an unrelated colour is typed` | the guard was `/currentMatch\.pinned/ && /own\.some\(/` — a source-shape regex, which any mutation that keeps the substrings passes |
| `color_match` | `the light-theme contrast guard` | `both tokens actually differ between the themes` | it sliced shared.css from the first `[data-theme="light"]`, which is inside the file's own header comment, so it measured `:root`'s dark values and compared dark with dark |
| `color_match` | `no species appears twice in the results` | `every probe returns five DISTINCT species` | the mutation needed to trip it no longer exists — one group per species makes duplicates unreachable, so the case has to attack the guarantee from the other side |
| `gen1_apu` | `never get one` | `within one 8-bit step` | the timeline calls `noiseOffset()` itself, so it cannot see a mutation to the **renderer's** call site — the two share one definition (§3.F) |
| `gen1_apu` | `clocks are the same at 65,536 Hz` | `the same grain at both rates` | `noiseClocks` reports Hz, and Hz is a property of the register not the output rate, so that equality holds **by design** even with the clock unscaled |
| `gen1_apu` | `Machop` | `Hz its register predicts` | a species name inside a passing check's description |
| `gen1_apu` | `byte-identical` | `Rhyhon do NOT` | occurs only in the two *passing* identical-pair checks |
| `gen1_cries` | `still exactly these six` | `implicitRet lists exactly the channels with no sound_ret` | the mutation drops a channel's commands but leaves the stored `implicitRet` field alone, so the check that pins the stored six names still passes |
| `color_page` | `claimed by exactly one element` | `no page is claimed by a group with no row of its own` | deleting the row does not unclaim the page — the group still claims it, so the owner *count* is still one |

**The sixth `color_match` case failed for a different reason and is worth separating: it was not blind, it was a NO-OP.** The first draft swapped OKLab for RGB Euclidean by multiplying the coordinates by 255 — a change of *units*. Every distance scales by 255 and every ranking is unchanged, so the mutation could only ever trip the absolute-value assertions, and the greys assertion compares two distances and is scale-invariant. A mutation that cannot change any output the check reads is not a mutation. It was replaced with a real swap (`hexToOklab` replaced by channel extraction), whose detector is a measured *inversion*: for `#414141`, RGB ranks `#399494` nearer at 117.7 channels while OKLab ranks `#7362ac` nearer at 0.2043 against 0.2526.

Two of the others exposed real defects in the checkers rather than in the tests, which is the point of the audit:

- **`check_color_page.mjs` had a dead `bad` predicate.** The owner string is built as `` `${label} (group, no row)` ``, so it ends in a closing parenthesis, but the filter tested `endsWith('no row')` — which can never match. That check's detail was therefore permanently empty and it could only ever report the generic *"predicate disagrees with its own message"* fallback, which is the very outcome the `check()` guard exists to make visible. It was visible only as an absence.
- **`check_color_page.mjs`'s `check()` dropped the description on failure**, printing only the detail. Every other checker prints the assertion's name when it fails, which is what makes a failure identifiable afterwards. It now prints `description — detail`.

**Three more failure modes showed up writing the `color_match` suite, and all three are ways a green suite means nothing.** A **loader error is not a test failure.** The suite's scratch tree listed `color-match.js` and `color_palettes.json` only, so every case died with `ERR_MODULE_NOT_FOUND` the moment the checker began importing `hslToHex` from `color-palette.js` — twenty-three cases "failing" while running zero assertions, and a parse-time error reads as neither pass nor fail. The tree now copies all of `assets/js`, for the same reason §3.B2 does: the import chain reaches five more files and a case that dies on a missing module passes for the wrong reason. And an assertion that has become *vacuous* — the property still holds because the code that could break it was deleted, so no mutation can trip it — is removed rather than kept as reassurance; `check_color_match.mjs` therefore asserts the ABSENCE of the guard that used to exist (no dedupe pass, one group per species) instead of its presence. And the ordering cross-check is noise-tolerant by necessity, because two independent implementations of one matrix product disagree in the 16th digit and four of twenty probes reorder under an exact comparison while their distances agree to 1e-9 — so a `NOISE` floor wide enough to merge unrelated probes would make that comparison vacuously true, and one of the twenty-eight cases widens it to 1.0 precisely to prove the check is not.

When a negative case fails after tightening, read the checker's own output before touching the expectation: the case may be mislabelled, the checker may be reporting through the wrong assertion, or the mutation may have stopped applying at all. **Assert that the mutation actually changed the file** (`if (out === before) throw`) — two `color_match` cases passed for a fourth reason, a `replace()` whose target string no longer existed after an earlier edit. And **mutate the line the defect is in**: the unconditional-pin case was first written as `if (match.pinned) {` → `if (match.pinned || true)`, which sends *unpinned* matches down the pin path and leaves pinned ones correct, so it tripped an unrelated assertion and proved nothing. Fixing the *expectation* to match a wrong checker is how a harness stops being evidence.

```bash
# Verify color palette contracts & invariant guards. The palette half guards
# color_palettes.json; the naming half guards the chroma gate that all three
# colour namers share, and the mutation suite proves each guard can fail by
# breaking the module in a scratch copy. See §3.B2 before changing a name
node scripts/check_color_palettes.mjs
node scripts/test_check_color_palettes.mjs

# Verify the reverse palette matcher behind colors.html: the OKLab conversion
# (white, black, mid-grey, and a saturated red's chroma so an axis-only metric
# cannot pass), the primary-first ranking against a SEPARATE brute-force
# implementation, per-species grouping, the tiebreak chain, and that every hex a
# match can return is one the corpus actually contains. The mutation suite proves
# each guard fails for its own reason — see §3.B1 for the seven cases that named
# the wrong assertion when first written
node scripts/check_color_match.mjs
node scripts/test_check_color_match.mjs

# Verify the shared nav from both ends. check_color_page.mjs owns the NAV table
# and its claims; check_nav_pages.mjs owns the other half — that every page but
# the two documented exceptions actually mounts it, which no table check can see.
# check_color_page.mjs also owns color.html's three-ramp shade scale: that there
# are exactly three rows, that each row's ramp is seeded from THAT row's own hex
# (a ★ is only honest if it marks the colour the row is showing), that the seed
# bar is styled and named, and that the showcase builds its own ramp from
# `primary` rather than naming a bare `scale` — see §3.B1 for why that one is
# silent rather than a ReferenceError
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

# Verify the APU against the REFERENCE SYNTHESISER'S OWN OUTPUT: all 151 output
# lengths exactly, 48 sampled 8-bit values each, and the rate-independence
# claims a native-rate comparison structurally cannot make. See §3.F before
# changing anything here
node scripts/check_gen1_apu.mjs
node scripts/test_check_gen1_apu.mjs

# Verify the two cry PAGES over the DevTools Protocol: that the playback cursors
# move, that the lane labels are not claiming to be playing, that the current
# species' group stays open, that the page discloses sound_loop, and that the
# output is muted at the AudioContext's destination — measured off the live
# AudioParam, not read off a value the install script recorded. See §3.G for why
# that assertion exists and what it does NOT cover. Needs the repo served on
# :5500 — see the Runtime Server rule at the top
node scripts/check_gen1_page.mjs
node scripts/check_cries_browser.mjs

# The APU mutation test runs its cases in a POOL of 4 workers, not sequentially:
# 33 x a 6 s checker is three and a half minutes of waiting to re-verify
# arithmetic. Measured here, 6 workers 44.5 s, 8 workers 38.9 s, 12 workers 38.5 s.
# Four is a deliberate choice because other work shares this machine — raise POOL in
# scripts/test_check_gen1_apu.mjs when the machine is idle. At four this is ~34 s,
# down from ~62 s before the corpus was walked once and the cases that do not need
# the conformance comparison were routed around it — see the end of §3.F.

# Verify the Generation I cry table: the 151-row name join against pokered's
# unordered table, the 38 base cries, the channel/command shape, and the pinned
# set of upstream inconsistencies. The mutation test shuffles cries.asm's rows
# and requires the regenerated JSON to be byte-identical, which is the only real
# proof the join is by name — it mirrors the 114 .asm files into
# data-sources/pokered-cry/ on first run
node scripts/check_gen1_cries.mjs
node scripts/test_check_gen1_cries.mjs

# Verify cries.html's claims about that table: that it reads the generated JSON,
# that its five axes exist in featureNames, that scores are standardised before
# they are compared, that no preset is degenerate, and that the caveat and the
# legacy warning are on the page rather than in a comment
node scripts/check_cries_page.mjs
node scripts/test_check_cries_page.mjs

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
- **Batch by direction, not by file**: One commit per *direction of change*, and a direction may legitimately touch several files — a fix plus the test that proves it, a refactor plus the docs that describe it, or one invariant tightened across every checker that enforces it. Splitting those apart produces a history where no commit is independently verifiable, which is the thing atomicity is for. Do not split work that only makes sense together, and do not merge work that could be reverted separately.
- **The line is unrelatedness, not file count.** Lumping genuinely unrelated modifications together is still wrong — a colour-palette fix and a nav fix are two directions even if they land the same afternoon. But "one commit per file" and "one commit per hunk" are both wrong in the other direction: they bury each commit's intent in bookkeeping. When in doubt, ask whether reverting this commit alone would leave the repo coherent; if yes, it is its own commit, and if no, it belonged with whatever it is entangled with.
- **Targeted Staging**: Stage only the specific files touched by the unit (`git add path/to/file`). Never use `git add -A` or `git add .` to avoid capturing untracked scratch files.
- **Meaningful Messages**: State what changed, why, and any specific metrics or design choices involved.