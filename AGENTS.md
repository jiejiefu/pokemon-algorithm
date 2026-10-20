# 寶可夢演算法 — AGENTS.md

> **Environment Requirements**
> - **Python Virtualenv**: `/Users/jiejiefu/Documents/Visual_Studio_Code/.venv` (i.e. `../.venv` from the repo root; a repo-local `.venv` also works)
> - **Execution Style**: `i-have-adhd` (High scannability, concise chunks, explicit bullet points, actionable commands)
>   - This project is developed with **opencode**. Every session must load the `i-have-adhd` skill before the first reply and keep its formatting for the whole session, without waiting to be asked again.
>   - The trigger is the user naming the skill at all — e.g. typing `skill：i-have-adhd`, 「使用skill」, or just「使用skill」with no argument. Treat any mention of「使用skill」 as a request to load `i-have-adhd` specifically, since it is the only skill this project pins.
>   - It turns off only when the user says「stop adhd mode」or「normal mode」, confirmed in one line. Nothing else — a topic change, a new task, a mode change in the harness — does not turn it off.
> - **DO NOT RUN BROWSER CHECKERS UNLESS THE CHANGE DEMANDS THEM.** This machine cannot absorb them — they are the reason it gets hot enough to be noticed, and that was measured, not estimated. **A headless Chrome is a browser rendering pages forever; §3.J's incident was a machine running hot long before anything was wrong.**
>   - **What counts as a browser checker:** any entry with `browser: true` — 13 of them, plus `test_check_sorting_page.mjs`, which boots Chrome 25 times inside a `sort`-group harness. They now live in `audio-browser`, `game-browser`, `graph-browser`, `life-browser`, `moves-browser`, `outfit-browser`, `types-browser` and `sort`; the other ten groups no longer boot Chrome.
>   - **The default is therefore: run the affected checkers BY NAME, not a group.** `node scripts/check_moves_page.mjs`, `node scripts/check_learnsets.mjs` — a tier-A entry is 0.1–2 s of pure Node and costs nothing.
>   - **When the edit spans a group, filter `check_all.mjs` with `--only=<group>` rather than running it bare** — `--only` is a repeatable prefix match, runs one group and nothing else, and the §4 table is the price list. It is a time-and-heat lever, never a correctness claim: it does not excuse a browser the change genuinely needs (next bullet, and §4).
>   - **`node scripts/check_all.mjs` with no `--only` is NOT the way to verify a change on this machine.** Tier B is 10 pooled entries plus 2 serial, and `test_check_graph_browser.mjs` alone is 40 s of four sequential Chrome boots. This overrides every 「the suite is cheap because of the skip cache」 argument below — the cache makes the *second* run free, and the first run after an unrelated edit still boots thirteen browsers.
>   - **When a browser checker genuinely is the right tool** — the change is a rendered claim, or a browser half is the only half that can see it (§3.G4, §3.X, §3.AA) — **run it alone, never inside a group**: `node scripts/check_moves_page_browser.mjs`. One Chrome, one page pair, no pool contention.
>   - **§4's「ONE RUN CONFIRMS A FIX」 rule is unchanged and matters more here**: one run of the affected checker is the evidence, and a second run proves nothing about the change.
>   - **After a browser run, check for orphans — §3.J's sweep.** A killed run leaves headless Chrome alive, which is a *correctness* defect, not disk clutter: `check_gen1_page.mjs` once drove a stranger's 1246×87 window and failed 4 of its 74 checks on a perfect page.
>     ```bash
>     ps -Ao args | grep '[C]hrome --headless' | awk '{print $1}' | while read -r p; do
>       [[ "$(ps -p "$p" -o args=)" == *--headless* ]] && kill "$p" 2>/dev/null && echo "  TERM $p"
>     done
>     ```
>     Note the zsh trap §3.J records: an unquoted `for p in $(…)` hands the loop every PID as one argument and kills nothing while printing a confident `SKIP`.
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
| Page | What it is |
| :--- | :--- |
| `index.html` | Hero clip scrubbed by scroll, the intro, two algorithm demos, then the five feature cards — §3.Z |
| `today.html` | 今日推薦: the daily pick, 熱門, 探索, 精選系列, 遊戲, 工具, 快速連結, FAQ — §3.Z |
| `pokedex.html` | Searchable Pokédex: fuzzy autocomplete, generation / type / colour filters |
| `team.html` | 組隊規劃: six slots, per-member defensive tallies, STAB coverage, region / generation / type filters, shareable `?team=` — §3.AD |
| `detail.html` | Dossier: 3-col hero, Canvas radar, dual-type matrix, evolution chain, 4 move tabs. 3-way footer pager — §3.A |
| `color.html` | One species' palette: `?slug=`, shade scales, theme exporter. Bare URL = the same seeded daily pick as the homepage, one draw two callers |
| `colors-generator.html` | Reverse generator: any hex → closest Pokémon by OKLab, then a generated palette — §3.B1 |
| `color-game.html` | Daily / unlimited palette guessing game over all 1,025 measured palettes — §3.W |
| `colors-explore.html` | All 1,025 palettes, infinite scroll, URL filters |
| `sorting.html` | 6 sorters on a 1,025-sprite Canvas, plus a 2–6 lane race — §3.G3 |
| `maze.html` | BFS / DFS pathfinding, 40×40 grid, seedable RNG |
| `life.html` | Conway's Life over one generation, with real in-game evolution levels — §3.K |
| `graph.html` | 3D force-directed knowledge graph: 1,346 entities and 2,687 relations over 13 types (evolution, mega, mega-type, gmax, regional, form, pantheon, paradox-pair, paradox-clade, starter trio, pseudo-legendary, type resonance, dual-type), with search, filters and a dossier panel linking to `detail.html` / `color.html`. Data generated — §2, §3.V |
| `cries.html` | All 1,025 cry cards with measured timbre, 5 sort axes, waveform |
| `cries-gen1.html` | The 151 Gen-I cries re-synthesised by a Game Boy APU — §3.F |
| `spectrum.html` | Mel spectrogram over every cry, revealed left to right — §3.G1 |
| `cry-game.html` | 10-question, 4-option cry-guessing game; difficulty is a measured similarity ceiling — §3.Y |
| `types.html` | Type chart + per-type browser. The ONLY place the effectiveness matrix appears — §3.D, §3.H |
| `moves.html` | All 919 moves, searchable + filterable, every filter in the URL — §3.AA |
| `abilities.html`, `ability.html` | 314 abilities, searchable + filterable; `ability.html` gives the effect and the 常見/隱藏 holder split — §3.AC |
| `move.html` | One move: stats, effect text, and which of the 1,025 learn it — §3.AA |
| `category.html` | Collection-list template, `?cat=<slug>`. Never links to `types.html` — §3.H |
| `collections.html` | Collections hub: 11 cards in 4 groups, 2 `upcoming` |
| `outfit.html` | Garment colour → MMCQ → OKLab against all 1,025 palettes — §3.L |
| `generations.html` | 9 generations, 38 games, 27 regional starters |
| `model3d.html` | GLB viewer; roster generated into `glb-index.js` |
| `404.html` | GitHub Pages fallback: `/detail/<slug>` → `detail.html?slug=…&from404=1` |

---

## 2. Directory Architecture

```
pokemon-algorithm/
├── assets/          css/ · js/ · data/ · cries/ · glbs/ · images/
├── docs/            incidents/ — the receipts behind §3, one file per area
├── scripts/         verification: check_*.mjs · test_check_*.mjs · lib/
│                    data pipeline: *.py   (two layers, explained below)
└── data-sources/    raw CSV/XLSX + per-id provenance (never fetched at runtime)
```

`assets/video/` holds the nine generated hero loops (8.9 MB) and the nine stills cut from them (1.1 MB). **All eighteen are tracked** and `index.html` mounts one of each — §3.Z. `make_hero_video.py` regenerates both.

**No `package.json`, no `node_modules`, no build step.** Zero npm dependencies is a property, not an oversight: Node is invoked only as `process.execPath` and every helper lives in `scripts/lib/`. **There is also no CI** — nothing under `.github/workflows/`; the suite is run by hand.

**9,086 of the 9,471 tracked files are binary** (7,062 PNG, 2,000 OGG, plus 4 SVG/GLB and video stills) and 132 are code (100 `.mjs`, 32 `.py`). `assets/data/` holds 21 JSON tables and is the single source of truth for every page.

**The generated files under `assets/js/` and `assets/data/`, plus the nine videos under `assets/video/`, must never be hand-edited** — a key added by hand has a lifetime of one regeneration, and two of the three life.html data defects were exactly that:

| generated by | produces |
| :--- | :--- |
| `extract_genus_zh.py` / `fetch_form_names.py` | `genus-zh.js`, `form-names-zh.js` |
| `extract_glb_index.py` / `extract_sv_index.py` / `extract_cry_index.py` | `glb-index.js`, `sv-index.js`, `cry-index.js` (§3.E) |
| `fetch_gen1_cries.py` | `gen1_cries.json`, `gen1_cry_sfx.json` |
| `fetch_evolution_levels.py` | `evolution_levels.json` (§3.K) |
| `fetch_moves.py` | `moves_zh.json`, `learnsets.json`, `move_learners.json`, `move_learners_count.json` (§3.AA). The two learner indexes are written **compactly** while the other two are `indent=2`, for the reason the script's own comment gives: neither is ever hand-edited, and the formatting tax would make the index a quarter the size of the 4.4 MB file it exists to avoid fetching |
| `fetch_abilities_detail.py` | `abilities.json`, `ability_species.json`, `species_abilities.json` (§3.AC). All three written in ONE pass so they cannot disagree about a species or a slot. `abilities.json` is `indent=2`; the other two are compact (`separators=(",",":")`) because neither is ever hand-edited and the formatting tax would double the holder index. The 379 KB holder index is forward (slug → holders); the **88 KB `species_abilities.json` is its INVERSE** (dex id → that Pokémon's names + ability slugs) and exists because `abilities.html` answers 「這隻有哪些特性」 — loading `pokemon_data.json` to do it would be 2.8 MB and loading the forward table would be 388 KB |
| `analyze_cries.py` | `cry_features.json` (§3.G1) |
| `extract_color_palettes_mmcq.py` | `color_palettes.json` (§3.B) |
| `build_home_roster.py` | `home_roster.json` — 1,025 compact records (`id`, `names.zh`, `stats.total`, `height_m`, `hue`), 90 KB raw / 19 KB gzip, for `index.html`'s two demos. Derived from `pokemon_data.json`, so a roster regeneration must run this too (§3.Z) |
| `build_team_roster.py` | `team_roster.json` — 1,025 slim records (`id`, `names.zh/en`, `types`, `generation`, `regions`), 145 KB / 22 KB gzip, for `team.html`. Derived from `pokemon_data.json`, so a roster regeneration must run this too (§3.AD) |
| `build_team_moves.py` | `team_moves.json` — 1,025 four-method strings + 919 defs (`zh/en/type/class/power/accuracy/pp/generation/effect`), 607 KB / 151 KB gzip, for `team.html`. Type is capitalised to `type-chart.js` keys; `--dry-run` reports the split and the five species short of four (§3.AD) |
| `build_graph_data.py` | `graph_data.json` — 1,346 nodes / 2,687 links for `graph.html`. Reads `data-sources/pokeapi_form_stats.json` (produced by `fetch_form_stats.py`, gitignored), and **warns by name** rather than falling back silently |
| `make_hero_video.py` | `assets/video/hero-gen{1..9}.mp4` — nine 1920×1080 / 10s / 30fps seamless-loop hero videos, 8.9 MB total, baked on `--bg-primary`; plus `assets/video/poster-gen{1..9}.jpg`, one still per clip cut at the frame the timeline calls `build_end` (`--poster-only` re-cuts them in 3 s). **Both tracked.** §2's script counts below (31 `*.py`) already include it |

Two directories are outside `assets/` on purpose: `data-sources/sv-sources.json` records which host each SV PNG actually came from and is deliberately never served (§3.E), and `docs/incidents/` holds §3's receipts so AGENTS.md can stay small.

**`scripts/` is TWO unrelated toolsets, and the filename prefixes are the only thing separating them.** 97 files are verification — 60 `check_*.mjs`, 27 `test_check_*.mjs` mutation harnesses, 1 standalone test (`test_cry_overlap.mjs`, a manifest entry in `cry-page`) and 9 in `lib/` — driven by `check_all.mjs` and the §4 cache. The other 32 are `*.py` generators and scrapers, run **by hand in the order §5 gives** and never by the suite. They share one directory because nothing couples them but the files they generate, and **splitting them is not free**: a subdirectory each means editing ~100 path strings, 24 of them functional and 14 of those the manifest's own `inputs`, plus one harness that copies a `.py` into a fixture at a fixed relative path. A checker and its harness have to stay put regardless — every harness names its checker by path and imports `./lib/` relatively — which is the same reason `checks/` and `harnesses/` would be the wrong split despite being the obvious one.

**`scripts/lib/` is shared and small on purpose** — `assert.mjs` is the one `ok`/`eq`/`near` scaffold: a checker whose helper shape matches constructs a `createChecker()` so its failure printer and its summary stay byte-identical while the counting lives in one place, `negative.mjs` is the one definition of what "caught by" means, `pool.mjs` the one worker pool (§3.G7), `cdp-port.mjs` the one place a Chrome path and debug port live, `png.mjs` builds its own test PNGs, `mute-tap.mjs` silences audio before any page script, `record-inputs.cjs` proves §4's input lists, `tmp-trees.mjs` is the one registry of temp trees so an interrupted run cannot leave one behind (§3.J), and `cdp-until.mjs` is the one poll-a-page-predicate loop both browser checkers wait with. Editing any of them invalidates every cache entry, which is why they are hashed into every key unconditionally.

---


## 3. Key Technical Conventions & Invariants

Each subsection is a **rule** with the **checker that guards it** and a **Background** link to the full narrative in `docs/incidents/`. A rule with no `**Guarded by:**` line is §3.G1a's shape: a green suite over a broken page. Read the linked incident before changing anything it covers.

### A. Routing & Slugs
- **URLs:** internal nav uses query params (`detail.html?slug=bulbasaur`).
- **Nidoran disambiguation:** `nidoran-f` (#029) and `nidoran-m` (#032) are distinct slugs; a bare `nidoran` must not resolve.
- **Form links** return to the base species' detail page.
- **detail ⇄ color reciprocity:** both URLs come only from `pokemonDetailUrl()` (`shared.js`) and `paletteUrl()` (`color-palette.js`). Never assemble either by hand or string-replace `detail.html`.
**Guarded by:** nothing · **Background:** [page-defects.md#a](docs/incidents/page-defects.md#a)

### B. Color Extraction & MMCQ
`assets/data/color_palettes.json` is generated by `scripts/extract_color_palettes_mmcq.py`: a 6-colour MMCQ partition of 96×96 front sprites (alpha ≥ 200), synthetic centroids snapped to the most frequent real pixel. Shares are global pixel frequencies so they sum < 100% (median ~71.95%). Exactly 3 palettes have 5 colours (#201 Unown, #643 Kartana, shiny Bulbasaur) — **never pad them.**
**Guarded by:** `check_outfit_page.mjs` re-derives all 2,050 palettes through `mmcq.js` and requires byte-equality · **Background:** [color.md#b](docs/incidents/color.md#b)

### B1. `colors-generator.html` Is Not A Smaller `color.html`
Shares components, not layout: one reports a measured palette, the other generates a theme from a colour.
- **Five sections were DELETED, not merged** (對照·實測色盤 / 生成明暗階 / 套用展示 / 生成組成 / 匯出主題). Copy must not describe what was removed.
- **`generatedRows()` IS the input colour plus the matched species' real colours.**
- **`colors-generator.css` is `cg-`-prefixed and mounted here only** — never edit a `.cp-*`, `.sc-*` or shared token for a generator-only need.
- **The 24-cell legendary grid pins the species, not the colour** (`matchOf(id, hex)` → `rank: -1`, eyebrow 你選的). A pin survives re-ranking only while the input is one of that species' six colours. The grid is built ONCE; only its highlight moves.
- **The colour field parses HEX/RGB/HSL regardless of the toggle** (display only); `inputFormat` never round-trips through the text. Strict ranges, never clamped; three states — parse commits, a possible prefix says nothing, neither changes the result.
**Guarded by:** `check_color_match.mjs` (220, asserts the ABSENCE of the five removed sections, containers, leftover code and dangling ids) and `check_color_page.mjs`; 28 + 20 mutation cases · **Background:** [color.md#b1](docs/incidents/color.md#b1)

### B2. Three Colour Namers, One Chroma Gate
`color.html` prints two namers side by side for the same hex (`describeHex(primary)` and `chineseColorName(hex)`).
- **Every namer is gated on `chroma()` = max−min, below `NEUTRAL_CHROMA = 16` → `neutralName()`.**
- **Chroma is absolute, never HSL saturation.** `s` is a ratio against lightness, so near-whites (the largest grey bucket) measure `s = 100%`.
- **The threshold sits in a gap:** corpus chroma is empty between the grey and coloured clusters, so 16–31 behave identically; raising it cannot be caught by a "greys are named greys" check.
- **`chineseColorNameWithEn()` is gated identically** and returns the zh-only grey name.
**Guarded by:** `check_color_palettes.mjs` + 9 mutation cases against a scratch copy of the module · **Background:** [color.md#b2](docs/incidents/color.md#b2)

### C. Contrast & Accessibility
- **WCAG AA:** 4.5:1 standard text, 3:1 large text and UI components.
- **Measure contrast from decoded screenshot pixels (Canvas/CDP), not `getComputedStyle()`** — which misses alpha blending, backdrop filters and radial gradients.
- **Typography:** CJK-first `--font-sans` (`PingFang TC`, `Noto Sans TC`, `Microsoft JhengHei`).
- **Theme switching** is handled inline in `<head>` before first paint; toggling fires `themechange` for Canvas redraws.
- **Reduced motion** is honored across CSS and JS.
**Guarded by:** nothing · **Background:** [page-defects.md#c](docs/incidents/page-defects.md#c)

### D. Type Profiles & Scoped Translations
`assets/data/type_profiles.json` (from `scripts/fetch_type_profiles.py`, InfoPoke `/types/[id]`) keeps three provenances in separate fields: `blurbEn`/`battleTipsEn`/`categoryNoteEn`/`entriesEn[].effect` are **English upstream** in a collapsed block; `entries[].effect` is **Simplified Chinese upstream** via OpenCC `s2twp` (the only zh-TW effect text); `trainers[].roleZh` is **this project's own** translation.
- **Ability names come from our data** (`pokemon_data.json[].abilities` + `abilities_zh.json`); the join floor is pinned at 70%.
- **Type relationships come only from `type-chart.js`** — never InfoPoke, never `type_profiles.json`. `Electric → Water` is `2×`.
**Guarded by:** `check_type_profiles.mjs`, including the 70% join floor · **Background:** [page-defects.md#d](docs/incidents/page-defects.md#d)

### E. Scarlet/Violet Artwork & Provenance
`assets/js/sv-index.js` is generated by `scripts/extract_sv_index.py` from the PNGs on disk — never hand-edit. 1,225 PNGs (1,025 roster + 200 unclaimed variants).
- **PokeAPI first**, InfoPoke only when the primary returns no valid PNG; per-file host lives in `data-sources/sv-sources.json`, deliberately outside `assets/`. Frontend credits PokeAPI only.
- **The SW/SV set (120×112) is bottom-anchored:** `move.html` draws it at 56px with `object-fit: contain` AND `object-position: bottom`; do not copy `types.html`'s `translateY(-23%)` (its chip pairs image and name; this card does not). `contain` without `object-position` passes a fit assertion and still misplaces the subject ~3.7px.
- **`image-rendering` is absent from `.mv-learner img`** — `crisp-edges` is for upscales; both art sets here are drawn down by non-integer factors.
**Guarded by:** `check_sv_index.mjs` + 15 cases; `check_moves_page.mjs` + 4, and the rendered half by `check_moves_page_browser.mjs` · **Background:** [page-defects.md#e](docs/incidents/page-defects.md#e)

### F. Cry Audio — `gb-apu.js` Is Transcribed, Not Reasoned
`gb-apu.js` re-synthesises pokered's 38 base cries as a pure module. **Verified against the reference's own OUTPUT, not a description:** `gen1_conformance.json` holds per-species length + 48 sampled values; 151 lengths match; 98.7% of samples byte-identical, rest within one 8-bit step.
- Length parameter is the stored byte **MINUS `0x80`** (signed reading makes notes 1.5× too long).
- The duty register holds the **packed byte** (`duty & 3`), not the pattern array.
- The mix is **not peak-normalised**; **every register is scaled to the output rate — including the noise LFSR clock.**
- **Rate-dependent checks must be rate-independent:** at 1,048,576 Hz the conversion is 1 and the bug vanishes.
- `sliderToMaster()` is removed; the page presents 0..15 (default 3). `sound_loop` is applied; `count` is the play count.
- **A bounded ring-out applies only where the envelope can empty** (sweep 0 → 16 frames).
- Synthesis rate is **65,536 Hz** (Web Audio caps at 96,000).
**Guarded by:** `check_gen1_apu.mjs` (92) and `check_gen1_cries.mjs` (40) · **Background:** [cry.md#f](docs/incidents/cry.md#f)

### G. The Two Cry Pages
- **A playback cursor's guard is `!== null`, never `> 0`** — `currentTime` is exactly 0 on the first play.
- **The waveform caches offscreen** bound with `const`.
- **`cryPlayer.play()` resolves when a cry ENDS**; an additive `onStart` hook carries duration + clock.
- **Both pages share ONE autoplay switch (`cry-autoplay.js`) that must never fire on load.**
- **A mute nothing verifies is not a mute:** `scripts/lib/mute-tap.mjs` is injected before any page script and asserted on the live `AudioParam`.
- **Count drawn pixels by ALPHA, and let the assertion return false.**
- **A slider's id is not the state field's name** (three sliders created a fourth property; Length did nothing).
- Recorded and synthesised cries play at the SAME loudness (`DEFAULT_VOLUME = 3/15`).
- **A filter and a scroll position are different quantities** and must not share a field.
- **A checker that presses play must CONFIRM the press landed** (a re-render detaches the node).
**Guarded by:** `check_gen1_page.mjs` (74), `check_cries_browser.mjs` (25), `check_cries_page.mjs` (64) + `test_cry_overlap.mjs` (6) · **Background:** [cry.md#g](docs/incidents/cry.md#g)

### G1. The Spectrum Page — A Port Checked Against Its Own Extractor
**No spectrogram is stored** — the port is checked against its source.
- **`analyze_cries.py`'s `resample()` has TWO recorded bugs:** amplitude scale should be 1.0 (it keeps `n_out/n_fft`; a 100 Hz tone returns at 0.1465), and it keeps `n_out/2` bins of an `n_fft` transform (top bin duration-dependent). `m0` shifts by `log(n_out/n_fft)·√26`.
- **The port does NOT copy either bug.** It exports `UNCOMPARABLE = [peak, rms, m0]` and `M0_SCALE_OFFSET = √26`, and asserts m0 as an **IDENTITY, not a tolerance**. `peak`/`rms` are a browser limit; `m0` is upstream.
- **Five features are reported** (`dur`, `zcr`, `centroid`, `rolloff85`, `flux`); `flatness` was removed (ill-conditioned).
- **The live curve is a second measurement** — 1024 bins at device rate; **the reveal is not streaming**. The plot is **nearest-neighbour** on both axes; the ramp is **theme-independent**.
- **The live line/fill is the species' `rgb` lifted to the plot ground** (§3.G8). The 3:1 floor is because it is a **graphical object**; `contrast` is `shared.js`'s own.
**Guarded by:** `check_spectrogram_port.mjs` (55), `check_spectrum_page.mjs` (196), `check_spectrum_browser.mjs` (77) + 11 and 41 mutation cases · **Background:** [cry.md#g1](docs/incidents/cry.md#g1)

### G2. The Header Is Not One Thing
- **A bare `class="header"` is a valid class that renders the mobile column layout** — the desktop row comes from a separate six-modifier rule. Hand-written markup in the nav/theme containers is a duplication question, not a style one.
- **The theme toggle's icons are injected; leave the button empty.** `initThemeToggle()`'s `if (!btn.querySelector('.icon-sun'))` guard means a page hardcoding a differently-classed pair gets four children in a 34px box.
**Guarded by:** `check_nav_pages.mjs`, which reads the six modifier names **out of `shared.css`** · **Background:** [checker-infrastructure.md#g2](docs/incidents/checker-infrastructure.md#g2)

### G3. Race Mode — Six Lanes
- All three painters take context + timestamp from the caller; `sweep()` returns whether it is still running.
- **Count ink by ALPHA, and let the assertion return false** (min ink per lane 24,573 → 110,893).
- **The lane layout is `data-lanes` on the container, spelled out rather than derived** (4 = 2×2, not 3+1); `buildRace()` **appends** `.al-result`.
- **`align-content: stretch` is load-bearing** (a centred row track sizes to content).
- **`finishRace()` re-measures AFTER it writes the panel**; **`maxLoggedEvents: 0`** on every lane.
- A lane's cost is DESTINATION AREA, not sprite count.
**Guarded by:** `check_sorting_page.mjs`'s rendered half · **Background:** [checker-infrastructure.md#g3](docs/incidents/checker-infrastructure.md#g3)

### G4. The Sorting Page Finally Has A Checker
- **STATIC** (89 checks, ~0.3 s) reads `sorting.html` / `algo.css` / `sort-run.js` / `shared.js`; **RENDERED** (54, ~12 s) drives CDP and counts ink by alpha.
- **The rendered half answers every sprite with a 71-byte stub** — catches §3.G3 in full; gives up path/PNG resolution.
- **THE STUB IS PROVEN LIVE:** intercepted requests asserted `>= 1,025` from `ASSETS.images`.
- **The fast loop is `--static` on the HARNESS** (`test_check_sorting_page.mjs --static`, 0.3 s).
- **The strip is guarded by a CHECK COUNT** — the harness deletes the RENDERED half and requires exactly **54** dropped (hardcoded on purpose).
- **`Network.setCacheDisabled` is not what keeps a run fresh.**
**Guarded by:** `check_sorting_page.mjs` + 34 mutation cases. **Known:** the finish poll reads `.al-result` through a named `RESULT_PANEL_STATE` helper; a residual second flake exists under pool contention only · **Background:** [checker-infrastructure.md#g4](docs/incidents/checker-infrastructure.md#g4)

### G5. The Cry Suite Was Slow For Three Unrelated Reasons
- **CPU:** `test_check_gen1_apu` is pure rendering — **removed from the manifest**; the file stays runnable.
- **Payload:** `test_check_cry_index` — build the tree once, each case restores what it touched via its own recorded path (no hand-maintained list).
- **Fixed sleeps:** the three CDP checkers (42.6 → 12 s). **A fixed sleep is a guess; every ceiling exceeds the sleep it replaced.**
- **A CDP command resolving is not the page applying it** — poll the precondition; see §3.J for the `clear`-then-read race.
- **A wait and a sampling interval look identical and mean opposite things** (the 130 ms canvas window stays).
- **Two edits found real bugs in opposite directions** (a too-early poll turned a red green; a check named an END state and never read the START state).
- **The replacement is a four-row audit in the runner** (`check_all.mjs`): it reads the retired harness and fails if any of its 39 `expect` strings no longer names a checker assertion — in the runner, not a fixture.
**Background:** [checker-infrastructure.md#g5](docs/incidents/checker-infrastructure.md#g5)

### G6. State Shared Through Storage Is Not State a Per-Page Test Can See
`sorting.html` set `cryPlayer.muted = true` on load, persisting `{muted: true}` and silencing every other page; no test could see it.
- **One field cannot carry both decisions:** `#storedMuted` is the reader's choice and the only one written; `#viewMuted` is a page default in memory. **`#applyGain()` and `get muted()` must both read the OR.**
- **A wait for navigation must be gated on something only the destination has.**
- **The measurement must distinguish "muted by the checker" from "silent"** — discard the output, measure upstream of it.
**Guarded by:** `check_cries_browser.mjs`'s cross-page cry-volume regression · **Background:** [cry.md#g6](docs/incidents/cry.md#g6)

### G7. `lib/pool.mjs` — One Module For Nine Harnesses
Independent cases, each its own `node` process against its own temp tree. **Every report is byte-identical to the serial version, exit code included.**
- **Declaration order out is part of the contract** — `pool()` returns results in task order; the caller prints after the drain.
- **`POOL` is capped at 4, not core count.**
- **A pool's premise is independence; four harnesses cannot use it** (shared tree, restored between cases) — no assertion can express this.
- Each case removes its own tree in a `finally`.
**Background:** [checker-infrastructure.md#g7](docs/incidents/checker-infrastructure.md#g7)

### G8. The Live Curve's Floor Is Not A Taste
`assets/js/species-ramp.js` holds `speciesInk(rgb, ground, contrast, min)` — a module because it takes the contrast ratio as a parameter, so the checker can run it over all 1,025 records in bare Node.
- **The floor is 3:1 (SC 1.4.11) because it is a GRAPHICAL OBJECT; 68 of 1,025 species need it** (273 fall below 4.5:1). The colour is identity; the curve's meaning is its shape.
- **A floor and a ceiling are both required:** `hueOf()` returns null for greys, so the second ceiling is on **relative luminance (≤ ×4)**.
- **The page states the ink it draws (`data-ink`); the browser checker measures the canvas against it** (per-channel ±4, claim `> 0`).
- **The mel ramp is deliberately NOT species-derived** — a ramp is a scale.
**Guarded by:** `check_spectrum_browser.mjs` (measures the canvas against the page's own `data-ink`) · **Background:** [checker-infrastructure.md#g8](docs/incidents/checker-infrastructure.md#g8)

### G9. The Graph Checker Failed 100% Pooled, 0% Alone
- **The three failures were one:** a 500 ms sleep against a **150 ms debounce** (`graph.js:638`); `renderDossier()` is synchronous, so the 600 ms wait before it was useless.
- **Both became polls on a PRECONDITION, never on the assertion.**
- **`-32000 "Inspected target navigated or closed"` said nothing about where** — `lastMethod` plus Chrome's stderr on a pipe gave `CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670`.
- **The fix was a scheduling change — `serial: true`, the first such flag in the manifest.**
- **The cost is real:** harness 32.8 → 40 s, all of it ONE case waiting out an 8 s search ceiling; the message quotes the named constant or it quotes a lie.
**Background:** [checker-infrastructure.md#g9](docs/incidents/checker-infrastructure.md#g9)

### H. Category Pages vs. `types.html` — Two Different Questions
`category.html?cat=dragon` and `types.html?type=dragon` list the same 70 species. **A category page must never link to `types.html`, and must never be merged into it.** A category answers 「有哪些龍屬性寶可夢」 (roster + our zh-Hant prose); `types.html` answers battle mechanics (upstream English by design, §3.D).
**Adding a category is a three-list edit in this order:** `CATEGORIES` (append), `CATEGORY_SLUGS` (append — a literal list, not `Object.keys`, and never insert at the front), and `NON_HUB_SLUGS` or `COLLECTION_GROUPS`. Appending is the only insertion that leaves both orders untouched.
**Guarded by:** `check_categories.mjs`, which asserts the three literal lists are equal as written · **Background:** [page-defects.md#h](docs/incidents/page-defects.md#h)

### H1. `types.html`'s Roster Grid — Equal Tracks Are Not Equal Cards
The grid reported 12 columns while every card was 60px in a 96.7px track: **the grid item is the `<li>`, and the anchor inside it is `inline-flex`, which sizes to content.** Fix: `.chip-grid--roster > li { display: flex }` + `flex: 1` on the card. **The assertion that matters is `fill > 0.98` over every card** — the column count is reported.
- **Scope is asserted in both directions:** 招式/特性 stay content-sized flex rows behind a `--roster` modifier; `check_moves_page.mjs` asserts the mechanism.
- **`-25%` is the measured SV offset**; **size needs no correction.** `move.html` deliberately uses the opposite framing (§3.E).
- **`ctx.drawImage(img)` cannot see a CSS transform** — the shift comes from `getBoundingClientRect()`.
**Guarded by:** `check_types_browser.mjs` (51, ~5 s, one Chrome, group `type`) + `check_moves_page.mjs` (191) + `test_check_moves_page.mjs` (33) · **Background:** [page-defects.md#h1](docs/incidents/page-defects.md#h1)

### I. The Page/Module Boundary
`sorting.html` called `cryPlayer.muteForView()` before the module defined it — every load threw a TypeError that took every other control listener with it. **ESM verifies the imported BINDING, not the member.**
- **`check_page_module_api.mjs`** — 314 bindings across 19 pages, 0.1 s. The page set is **self-selecting** (imports from `assets/js`).
- **A comment is a false positive** (mask comments and strings; keep `${…}` holes).
- **`GbApu` assigns nineteen instance properties in its constructor** — collect `this.x =` too.
- **`export const cryPlayer = new CriesPlayer()` is an INSTANCE** — resolving members from class exports alone returns nothing.
**Guarded by:** `check_page_module_api.mjs` · **Background:** [checker-infrastructure.md#i](docs/incidents/checker-infrastructure.md#i)

### I1. `today.html` Served 14 KB Less JavaScript Than It Contains
The only page missing `</body>`/`</html>`. Live Server rewrote the response: `injectCandidates = [ /<\/body>/i , /<\/svg>/ , /<\/head>/i ]` (**no `</html>`**) and the page's only `</svg>` sat inside a template literal.
- **This is §3.I one level out:** a checker verified the *file*, not the *response*.
- **The fix is two lines; the guard asserts the precondition** — exactly one `</body>` and one `</html>`, both after the last `</script>`, case-insensitive throughout.
- **Splits like `test_check_tmp_prefixes.mjs`:** five cases break the TREE and one breaks the CHECKER.
- **Live Server is necessary only for the proof** (browsers synthesise `body`); the page set is `.html` only.
**Guarded by:** `check_js_syntax.mjs`'s document-structure assertion (all 28 pages) + `test_check_js_syntax.mjs` (6 cases + 1 pairing) · **Background:** [checker-infrastructure.md#i1](docs/incidents/checker-infrastructure.md#i1)

### J. Every CDP Checker Leaked A Chrome Profile
Three of six removed their `--user-data-dir`; tmpdir held 28 GB. **Check for orphans after a browser run — a clean run leaves zero.**
- **Cleanup is a `process.on('exit')` handler, and removing the profile is not killing the browser** — all now `chrome.kill()` from the same handler. **SIGKILL is uncatchable.**
- **An orphan is a CORRECTNESS defect** — `check_gen1_page.mjs` once drove a stranger's window. Only defence: the port guard and a zero count.
- **The sweep's key is OWNERSHIP, derived from the source across both `tmpdir()` shapes; `check_tmp_prefixes.mjs` (0.1 s) asserts zero overlapping prefixes**, with two companions: every reference classified; the scan found something.
- **Eleven negative harnesses now clean up in a `finally`** — `scripts/lib/tmp-trees.mjs` is the one registry (exit + SIGINT + SIGTERM).
- **The browser checkers leaked for a different reason:** exit handlers run in REGISTRATION order, so `tmp-trees.mjs` swept the profile *before* Chrome was signalled and Chrome recreated it; all three now `await` Chrome's exit on a 3 s ceiling, then `releaseTree()`.
**Background:** [checker-infrastructure.md#j](docs/incidents/checker-infrastructure.md#j)

### K. life.html — Conway, Genetics, And The Evolution Gate
`evolution_levels.json` is the topology, not level numbers.
- **Evolution is gated on the REAL in-game level, hence the cell field `level`:** 348 of 489 pairs carry a real level; 141 fall back to the corpus median Lv.30. Evolution is **strictly sequential**. Five pairs appear in both halves; the real level wins.
- **`backdrop-filter` turns an inert `z-index` into a real one:** `.life-toolbar` (`position: static; z-index: 20` + `backdrop-filter`) made the nav dropdown unclickable. `filter`/`transform`/`perspective`/`contain`/`will-change` too.
- **The evolution graph is the EDGE LIST, not the stage columns** (`stage` is DEX ORDER, not depth): a stage-based path produced 208 evolutions with no real edge; `unlevelled` is the topology.
- **`nth-of-type(2)` resolves to step 1**; step 2 has `id="stepStarter"`, which the checker asserts.
- **All 26 icons are filled paths**; the glyph and label must come from ONE boolean.
- **The toast card's background is themed tokens**; the icon is an `<img>`; measure against the **worse gradient stop**.
**Guarded by:** `check_life_page.mjs` (117), `check_life_browser.mjs` (61), `check_evolution_levels.mjs` (55) · **Background:** [life.md#k](docs/incidents/life.md#k)

### L. `outfit.html` — Two Ways In, And A Dropped MIME Type
- **`new File(parts, name)` DOES NOT inherit `blob.type`** (defaults `""`), so a good JPEG was rejected by `loadFile()`'s `startsWith('image/')` guard.
- **The preset row is a SIBLING of `.of-drop`, never a child** (the file input covers the zone at `inset: 0; opacity: 0`).
- **A pasted URL is not ours to decide:** `loadUrl()` distinguishes four failure outcomes (not a URL, non-`http(s)` scheme, fetched-but-not-`image/*`, CORS-blocked).
- **Only the rejection path is checked in the browser suite**, on purpose.
- **The privacy note gained a clause** — a URL fetch leaves the device.
**Guarded by:** `check_outfit_page.mjs` (130, parses `SAMPLES` out of the HTML) + `check_outfit_browser.mjs` (120) · **Background:** [page-defects.md#l](docs/incidents/page-defects.md#l)

### M. An Author `display` Beats `[hidden]`
`.of-readout` opened as an empty 40px card. `hidden` on the wrapper does not fix it — an author `display: grid` beats the UA sheet. Fix: `.of-readout[hidden] { display: none }`. Grid/flex/`inline-flex` all silently defeat the attribute while `element.hidden` still reads `true`.
- **The guard asserts the COMPUTED BOX, not the attribute.**
- **The wrapper is written inside the same contiguous group as its children** and the gate pairs it mutually.
**Guarded by:** `check_outfit_browser.mjs` (computed `display` + rect height on a fresh load) · **Background:** [page-defects.md#m](docs/incidents/page-defects.md#m)

### N. `graph.html`'s Collapsing Header
Nav is hidden; three ways to close (toggle, empty-space, Escape); never persisted.
- **`.header-3d` is shared with `model3d.html`, so every rule hangs on a new `.graph-header` class.**
- **Never declare `position` on this header** (anchors `.theme-toggle`).
- **Forced dark is one rule because custom properties inherit** (re-declare the four tokens; no light twin).
- **The hidden group is split in two:** `.theme-toggle`/`.site-nav-toggle` fade and never translate (`translateY(-50%)`); `visibility: hidden` is not a second `opacity: 0` (tab order).
- **A full-width invisible header is a click trap** (`pointer-events: none`; only `> *` opts in).
- **A click on the canvas must not close the nav** — `pointerdown` records the press start; close only if moved under 6px.
- **The hamburger closed itself:** a handler rewrote the pressed button's `innerHTML`; `e.target` detached and `header.contains(e.target)` inverted. The guard records `inside` at `pointerdown`; **`element.click()` passes where a real press fails.**
**Guarded by:** `check_graph_browser.mjs` now drives real `Input.dispatchMouseEvent` presses (reverting the fix fails 8 assertions) · **Background:** [page-defects.md#n](docs/incidents/page-defects.md#n)

### P. `maze.html` Had No Checker At All
- **The markers described a run the page was not doing** (`drawMarkers()` called `endpoints()` and never `starPoints()`).
- **Every successful patrol threw:** `starRun` returned no `cost`; a TypeError inside a rAF callback killed the frame loop.
- **Only the last leg was painted** (each leg cleared `searchVisited`).
- **`starRun` moved to `maze-pathfinding.js` to be checkable** — the module never touches it.
- **`PATROL_LEGS` is the one table**; `legs` is rebuilt in `PATROL_LEGS` order; **`explored` is the union, `settled` the total.**
- **點亮整張圖 never touches `onPath`/`searchVisited`;** `setLitAll()` is the only writer.
- **A load has two independent axes** (species, walls), each with its own 「固定」 toggle; `decideId()`/`decideSeed()` are symmetric.
- **Revealing a field is not filling it** (`bindAxisToggle()` writes `seed`); **換種子 must not route through `decideSeed`.**
**Guarded by:** `check_maze_page.mjs` (211); every shape assertion is brace-matched · **Background:** [page-defects.md#p](docs/incidents/page-defects.md#p)

### O. The Drawer Is A Column But Its Children Were Not
Every grouped drawer item laid its trigger beside its panel (748×366 pill): `flex-direction` does not cascade to flex items' own children. **The fix is one line in `shared.css`, not `graph.css`** — `.site-nav-drawer .site-nav-item-has-panel { flex-direction: column; }`.
- **A 20px `--radius-pill` is a chip radius, not a menu-row radius** (`--radius-sm`).
- **`max-width: 420px` is inert below 420px** (left-anchored).
- **A non-scrolling body propagates to the viewport** — `graph.css` gives the drawer `max-height`/`overflow-y` under `.graph-header`, not by widening the shared selector.
- **A forced-dark subtree can be incomplete in one token:** `--hairline`/`--hairline-strong` derive from `--hairline-rgb`; override the INPUT.
- **The accordion removes the problem:** groups toggle independently; `initNavDropdowns()` must skip drawer items (`closest('.site-nav-drawer')`).
**Guarded by:** nothing — a drawer that renders a 748×366 pill passes every check · **Background:** [page-defects.md#o](docs/incidents/page-defects.md#o)

### Q. Terrain Cost Is Rec.709 Luma
`computeTerrainCost()` (`maze-pathfinding.js:342`): `alpha < 50 → Infinity`; `luminance = 0.2126R + 0.7152G + 0.0722B`; `cost = 1 + (255 − luminance)/255 · (maxCost − 1)`. **The reason is an invariant, not colour science** — cost is a strictly monotonic function of the brightness the renderer draws, so a reader can predict where A* goes.
- **The three weaknesses are named in the source** (Y′ over-weights the darks; steps are not perceptually uniform; blue is nearly invisible).
- Alternatives B (OKLab L), C (slope), D (local contrast). **Moving off A needs evidence a reader cannot predict the route — not "which looks nicer".**
**Guarded by:** nothing for the model; `check_maze_page.mjs` asserts `computeTerrainCost` is the single cost function and the page reads its alpha threshold from the module · **Background:** [page-defects.md#q](docs/incidents/page-defects.md#q)

### T. The Terrain Endpoints Were The Extent Of The Specks
`computeTerrainEndpoints()` took the bounding box of **every passable cell**; on a sprite with a detached fragment the corner is the fragment, so start and goal land in different components (9 of 257 report 「無解」).
- **The single-run fix is surgical:** the old rule is tried first and returned untouched whenever `terrainReachable(start, end)` holds — 248 of 257 keep byte-identical endpoints.
- **The patrol is not surgical:** its points are the Pokémon's centre and corners; the body's bbox leaves zero unreachable legs (the all-passable bbox leaves 28 legs unreachable on 22 sprites).
- **`largestComponent()` lives in the module; tie-break is scan order, first wins** (strict `>`, the contract).
**Guarded by:** `check_maze_page.mjs` (211) — a fake 7×7 with a detached single cell and an **unfiltered** neighbourFn · **Background:** [page-defects.md#t](docs/incidents/page-defects.md#t)

### S. `color.html` Has No Header
The frame is three columns; the brand moved into the rail's top row.
- **The brand name reuses `.cp-rail-label`** so the collapse rule hides it. Not `.header-title`.
- **The casualty was one line:** the mobile button was mounted on `.header` via `?.`; below 768px the rail is hidden; that 34×34 button is the only route to the nav. Now mounted on `#cp-panel` behind an explicit `throw`.
- **`OPEN_BUTTON_MOUNT` is a named constant** `check_color_page.mjs` reads rather than restating.
- **Absolute on the panel, not fixed on the viewport** (`.cp-panel`'s ≤1023px `position: static` gives the child the initial containing block — §3.B1's shape).
- **`.cp-rail-top` is a column box**, so it needs `align-items: center`.
- **Every rule-shaped assertion reads the comment-stripped CSS.**
- **The 3px `--page-accent` did NOT move to the rail.**
**Guarded by:** `check_color_page.mjs` + 8 mutation cases (`test_check_color_page.mjs` at 61) · **Background:** [page-defects.md#s](docs/incidents/page-defects.md#s)

### V. `graph.html`'s 「精選分類」 Filtered A Pile
超級進化 drew 93 sprites with **0 edges**; 超極巨化 34. `graph.js:399-403` is not the bug: **every `mega`/`gmax` link is `base → form`, cross-category by construction.** Do not keep 1-hop neighbours in the filter.
- **A copied value is a plausible value:** form nodes had their base's `types`/`generation`/`stats`. Fixed by `scripts/fetch_form_stats.py` (`/pokemon/{id}`, which has `stats`).
- **A 200 is not evidence that a form exists** (id 10314 answers as a different form); the test is the form NAME. `order == -1` rejects 79 forms.
- **`linkColors` now covers all thirteen link types.**
- **The placeholder assertion became unsatisfiable, not false** — it reads the placeholder out of the served HTML.
- Both relation rows' chips are intentional.
**Guarded by:** `check_graph_chip_network.mjs` (127, ~0.1 s, static; tightest chip 幻之 at 52%) · **Background:** [page-defects.md#v](docs/incidents/page-defects.md#v)

### W. `color-game.html` Is A Static Game
- **THE NAME IS ONE HALF OF A PAIR** (§3.Y) — 顏色猜謎 / 叫聲猜謎. A rename is **four sites** (`<title>`, `<h1>`, NAV label, **share text**).
- **THE THREE HINTS ARE FIXED, not shuffled** (slot 2 is the whole palette).
- **THE SCORE IS OKLAB BIDIRECTIONAL AND PERCENT-WEIGHTED** (`color-match.js`).
- **THE THIRD HINT MASKS EVERY RUN OF THE NAME, LONGEST FIRST.**
- **TWO AUTOCOMPLETE LAYERS; the `<datalist>` is gone.** Enter selects, never submits, except a sole candidate; a Chinese IME's 選字 Enter is guarded. `canSubmit()` asks the same three.
- **THE ROUND ENDED BELOW THE FOLD AND SILENTLY** — `revealResult()` is called LAST and announced in `#gm-search-status`.
- **`[hidden]` ↔ `display` pairing** and **`role="img"` masking the strip link** are checked as absences.
- The ≤640px strip is `100px × 40px` on its own line; `flex: 1 1 0`.
**Guarded by:** `check_game_similarity.mjs` (101 + 24), `check_game_hints.mjs` (36), `check_color_game.mjs` (260, mutation cases run by hand and NOT committed) + `check_color_game_browser.mjs` (182, 4.2 s) · **Background:** [color.md#w](docs/incidents/color.md#w)

### X. On A Phone, The Control Rail Sits Above The Main Content
`cries.html` and `spectrum.html` flip to one column below 900px with the control bar first and `position: static`. **Nothing measured the mobile width.**
- **`<details>` broke spectrum's desktop layout** (inserts `::details-content`); disclosure is now `<button aria-expanded>` + `<div hidden>` with `.sp-picker { display: contents }`.
- **`getBoundingClientRect()` lies about descendants of a collapsed `<details>`.**
- **On mobile the document scrolls, not the roster**; field is `state.pickerReturnY`.
- **「desktop open, mobile closed」 is not expressible in CSS** — `syncPicker()`/`syncProbeDisclosure()` apply it; the width is written twice.
- **Scroll to `.cy-panel`, not `.cy-probe-head`.**
- **Play control is duplicated (rail + plot).**
**Guarded by:** `check_cry_mobile_layout.mjs` (36, both pages at 390×844 in one browser); static halves in `check_spectrum_page.mjs` (234, +17) and `check_cries_page.mjs` (78, +7) · **Background:** [page-defects.md#x](docs/incidents/page-defects.md#x)

### Y. `cry-game.html` — 「叫聲猜謎」
Ported from `pokemoncries.com`; ten questions, four sprites.
- **DIFFICULTY IS A CEILING ON ONE NUMBER** (`easy 0.35 · hard 0.65 · hell Infinity`); rank bands did not separate 困難/地獄; the ceiling is an identity.
- **THE GENERATION FILTER IS A POOL, NOT A DIFFICULTY** (derived from `availableGenerations()`).
- **ALL 34 DIMENSIONS**, not `cries.html`'s `ROBUST` five (cosine saturates at 0.996). **`cry-game.js` contains no `Math.random` at all.**
- **THE NAMES ARE HIDDEN UNTIL THE ANSWER.**
- **Four defects only driving found:** the round ended one question early; saved picks restored as nothing; `findIndex`'s −1 hit the mid-round branch; the waveform was blank until decode.
- **§3.M in both directions** (`setRevealed()` writes both `style.display` and the attribute); the header modifier is `header-cries`; `pokemonDetailUrl()` builds the URL.
- **AUTOPLAY needs an `audioUnlocked` flag set by a one-shot capture-phase listener.**
- **THE RESULT PANEL LISTS ALL FORTY, every one plays itself** (not a `<details>`); `DEFAULT_GENERATION` is a default, not an override.
**Guarded by:** `check_cry_game_similarity.mjs` (177, re-measures the ceiling every run) + its 31 cases; `check_cry_game.mjs` (134) + its 36 cases. **No browser checker.** · **Background:** [cry.md#y](docs/incidents/cry.md#y)

### Z. `index.html` Is A Clip, An Intro, And Two Demos
- **SCRUB AND PROGRESS ARE SEPARATE CONTRACTS.** Scrub writes `currentTime`, never `play()`; progress divides by `rect.height - innerHeight`.
- **BOTH ENDS OF THE CLIP ARE BLANK; THE POSTER IS NOT A PRE-PLAY FLASH.** `POSTER_FRACTION` comes from `make_hero_video.py`; `hero-gen.js` imports `taipeiDateKey`.
- **THE HERO IS A DARK BAND IN LIGHT THEME; THE PANEL IS A DARK TITLE CARD IN BOTH.** Scrim `#0b1020`; accent `#f5c542`; fill `rgba(6,9,20,0.7)`; blur ≤3px; counts are 1,025 / 9 / 6.
- **THE TWO DEMOS NEVER LOAD `pokemon_data.json`.** Fetch `home_roster.json` (90 KB, 19 KB gzip) within `400px`, draw 96 px sprites, CSS in `home-sections.css`.
- **SORT IS PACED; THE GAME IS BEATABLE.** `SORT_STEP_MS = 40`; A* `AI_TICK_MS = 420`, `AI_PAUSE_CHANCE = 0.18`, 4-direction `manhattanHeuristic` (showcase: 8 + `octileHeuristic`). Each run re-rolls; `suspended` starts true; reduced motion skips countdown; win cry respects `cryPlayer.muted`; `--canvas-wall` is wrapped in `rgba()`.
**Guarded by:** `check_home_hero.mjs` (98, 0.2 s, group `home`) + `check_home_sections.mjs` (55, 0.2 s, group `home`) + `test_check_home_hero.mjs` (25) · **Background:** [pages.md#z](docs/incidents/pages.md#z)

### AA. `moves.html` / `move.html` — 919 Moves
- **EFFECT TEXT HAS TWO PROVENANCES, boundary at a generation line:** 826 rows from PokeAPI zh-hant, 93 (ids 827–919) from InfoPoke Simplified via OpenCC `s2twp`. InfoPoke supplies only that text.
- **Converting the 826 would make them worse** (18 diverge); the checker asserts IDEMPOTENCE.
- **`total` counts DISTINCT POKÉMON** (`learnsets.json` is a union over generations).
- **Four browser-only bugs:** `wireRoving`'s `apply` gets the selected BUTTON; `Number('true')` is `NaN`; a row from `Object.entries(moves)` has no `.id`; the viewport was captured lazily.
- **The file hung after PASS** (`process.exit(0)`).
- **`power: 0` is a sentinel in 16 rows and a number in one** (`VARIABLE_POWER_MOVES`); `accuracy: 0` is 必中.
- **The 92 moves with no PokeAPI `meta` print no row.**
- **The payload split is asserted both ways**; `indent=2` is not applied to the two new indexes.
- **The shadow block is excluded by id; the script asserts the REASON.**
- **Learner cards show SV artwork with NO vertical offset**; no 「顯示全部」 cap.
**Guarded by:** `check_moves_data.mjs` (127,868, 0.1 s) + `check_moves_page.mjs` (184, 0.2 s) + `check_moves_page_browser.mjs` (89, 30 s) + `test_check_moves_page.mjs` (27) · **Background:** [pages.md#aa](docs/incidents/pages.md#aa)

### AB. `types.html` Is One Page And Moves Is Two
**Do not merge `move.html` into `moves.html`, and do not split `types.html`.** Splitting `types.html` saves 86 KB of 3.4 MB (2.5%); merging the move pages costs +424 KB on the list (77%).
- **The deciding variable is CARDINALITY AND SHAPE DIVERGENCE, not file count** (18 types → one template; 919 moves → two).
- **Both models are full-page reloads today**, so the single file buys no switching speed; **on a deep link the overview is chrome around the detail.**
- **The nav row is the one thing only a separate document can have.**
**Guarded by:** nothing (a structural judgement); `check_moves_page.mjs:109,113` guards the split's precondition in both directions · **Background:** [pages.md#ab](docs/incidents/pages.md#ab)

### AC. `abilities.html` / `ability.html` — 314 Abilities
- **THE HOLDER MAP IS READ FROM POKEAPI AND CANNOT BE INVERTED FROM `pokemon_data.json`** (30 form-exclusive holders).
- **Base species is resolved by `species.id`, never by matching names.**
- **`Farfetch'd`'s ASCII apostrophe is deliberate.** Twelve EN names were misspelled in the XLSX; fix by guarded text edit, not regeneration.
- **Three counts mean three things** (`holders` 47 / `speciesCount` 37 / `formCount`).
- **The effect sentence has two provenances** (267 zh-hant, 47 `effectEn`); one ability has no holder (面影輝映); a base species can appear under both flags (Rock Head / Marowak); hiddenness is `slug === hidden_ability`.
- **`abilities.css` is `ab-`-prefixed and mounted here only**; holder art is SV (`object-fit` + `object-position`, no `translateY`); `64px` art, `minmax(104px, 1fr)` → 9 columns.
- **A solid accent fill needs `--on-accent`, not `--text-primary`.**
- **The payload split is asserted in both directions** (`abilities.html` also loads `species_abilities.json`, 88 KB). Search uses `SPECIES_RESULT_CAP = 12`. Twelve species have one ability in both slots.
**Guarded by:** `check_abilities_data.mjs` (18,849, 0.1 s) + `check_abilities_page.mjs` (133, RUNS the filters) + `test_check_abilities_page.mjs` (12) + `check_pokemon_names.mjs` (94). **No browser entry (a priced trade).** · **Background:** [pages.md#ac](docs/incidents/pages.md#ac)

### AD. `team.html` — Six Slots, Two Tallies, One Roster
The slot's type statement is a **112px Poké Ball behind the sprite** (`.tm-slot-render::before`), **horizontal not diagonal**: `--tm-c1` top half, `--tm-c2` bottom half, a `--bg-secondary` waist and button ring; the name bar keeps `typePair(primary)` rather than white.
- **`TEAM_LIMIT` lives once, in `team-state.js`**; the analysis module takes ids, not a cap.
- **The id search is an exact padded match** — `025` must not match `0250`.
- **`?team=` keeps literal commas:** `searchParams.set` writes `%2C`; only `team-state.js` parses and writes the parameter.
- **Each tally header chip sits over its own mark column** — same grid, same gap; a chip is not a separate legend.
- **The roster is 145 KB of ids, names, types, generation and regions**, never `pokemon_data.json`; **every card states its type** in a `tm-card-types` row of `typeBadgeSmHtml()` badges, repeated in its `aria-label`.
- **Each member carries four moves, drawn from level-up first** and filled from machine → tutor → egg when the level pool is short; **five species cannot reach four** (#132, #201, #235, #789, #790) and 22 have under four level moves, so a short row is the species, not a draw failure.
- **`MOVES_PER_MEMBER = 4` lives once, in `team-moves.js`.** `?moves=` is four ids per member in team order with `0` for an empty row, parsed/written only by `team-state.js`, literal commas like `?team=`. A member's chunk is accepted or rejected whole; a member without one is redrawn.
- **`team_moves.json` is generated** (607,208 B / 151 KB gzip): `defs._fields` plus nine columns per move, and four method strings per species. Machine rows keep the id only — no TM code, no generation. The page fetches it **only after a slot is filled**, and echoes an arriving `?moves=` until the table lands.
- **Offence is move-based and STABBED:** the strongest carried move per member, `effectiveness × 1.5`, counted at ≥2×. **Seventeen moves are excluded** — fixed damage, OHKO, counter and 忍耐 — while 硬壓 keeps its type at power 0 (依情況); status is selectable and never counted.
- **The picker is a native `<dialog>`** with four method tabs, a cross-method search, and effect/PP/generation per row; a move used in another slot is disabled and **focus returns to the row** after the swap, which the re-render detaches.
**Guarded by:** `check_team_page.mjs` (219) + `test_check_team_page.mjs` (28) + `check_team_moves.mjs` (54) + `test_check_team_moves.mjs` (11). **No browser entry:** the rendered split was measured once by hand; a static PASS is not a rendered one. **Background:** [pages.md#ad](docs/incidents/pages.md#ad)


## 4. Verification & Testing Commands

Run regression checks whenever modifying data structures, selectors, or color logic.

**`node scripts/check_all.mjs` runs the suite and skips whatever cannot have changed.** `.cache/check-state.json` holds one content hash per checker over its declared `inputs` plus the last green run's duration, so a second full run is **0.0 s** rather than 87 s. Three ways it can be green and wrong:
- **A FAIL never refreshes an entry** — `last 6.0s` is always a green run's measurement — **and a FAIL is not a skip**; the next run re-runs it.
- **`--force`** exists for a checker that passed for a reason other than its inputs (missing Chrome, stale server). The cache trusts the last green result on this machine only.
- **Always in the key, whatever a checker declares:** the checker, any checker a negative harness attacks, every file in `scripts/lib/`, and `check_all.mjs`.

- **Input lists are PROVEN, not reviewed.** `--prove-inputs` runs each checker under `scripts/lib/record-inputs.cjs` (a CJS `-r` preload, not `--import`, because Node snapshots a builtin's ESM exports at link time) and fails on a disagreement in EITHER direction (`read but not declared` is the dangerous one). Three entries print as unverifiable: `check_gen1_page.mjs`, `check_cries_browser.mjs` (HTTP pages), `test_check_js_syntax.mjs` (own fixture).
- **`--only` is a REPEATABLE PREFIX MATCH** (`group === f || group.startsWith(f + '-')`), so `--only=cry` covers `cry-apu`/`cry-data`/`cry-page`; `--only=a,b` and `--only=a --only=b` are the same. `--help` prints every group with its last cost.
- **No `--quick` flag on any checker** — a flag that skips a check is a promise that stops being kept. `test_check_gen1_apu.mjs` was **removed from the manifest**, left runnable and its cost written down.
- **Groups:** `algo`, `audio-browser`, `color`, `cry-apu`, `cry-data`, `cry-page`, `data`, `game-browser`, `graph-browser`, `home`, `life-browser`, `model`, `moves-browser`, `nav`, `outfit-browser`, `sort`, `type`, `types-browser` — eighteen. The seven `*-browser` groups keep a static filter cheap; `sort` has both entries because both boot Chrome.
- **Two tiers, pooled at three; two Tier B entries are `serial: true`** (`check_graph_browser.mjs`, `check_life_browser.mjs`). Read **wall-clock**, not total: ~166 s of checker time finishes in ~88 s because browsers contend.
- **The liveness probe must not be `fetch()`** (undici keep-alive holds the socket ~6 s) **nor read `res.ok`** (undefined on an `IncomingMessage`). **Twelve** entries need the Runtime Server; all **thirteen** browsers are `manual` (execution still happens; only `--prove-inputs` prints the caveat).
- **No computed debug port.** Every browser launches with `--remote-debugging-port=0` and reads `<profile>/DevToolsActivePort`, so §3.J's orphan incident is unreachable rather than merely unlikely.

### RUN THE CHECK YOUR CHANGE NEEDS, NOT THE SUITE

**Running the whole suite is forbidden here: a cold run boots thirteen headless Chromes.** One cached run is 0.0 s, but the first run after an unrelated edit pays for every browser whose inputs moved. Filter by **what you edited**:

**`--only=<group>`** runs one group; naming a checker skips the runner. Take the narrowest option below. `--only` decides what runs, never what is true: a green filtered run says nothing about the checkers it skipped.

| you edited | run this | why this and not that |
| :--- | :--- | :--- |
| `index.html`, `home-sections.css`, `home-*.js`, `hero-gen.js` | `--only=home` | §3.Z; 153 checks, 0.2 s, no Chrome |
| `spectrum.html`, `spectrum.css` | `--only=cry-page --only=cry-data`, then `check_spectrum_browser.mjs` | four-way split; `check_cry_mobile_layout.mjs` (§3.X) is the phone width |
| `cries.html`, `cries-gen1.html`, `cry-player.js`, `gb-apu.js` | `--only=cry` | covers apu/data/page; add `audio-browser` for rendered halves |
| `sorting.html`, `algo.css`, `sort-run.js`, `sorting-algorithms.js` | `test_check_sorting_page.mjs --static`, then `--only=sort` | static 89 checks 0.3 s; `sort` boots Chrome |
| `colors*.css`, `color-palette.js`, `color-match.js`, `colors-generator.html`, `mmcq.js` | `--only=color` | 16 entries, none >5 s, no browser |
| `color-game.html`, `color-game.css`, `color-game.js`, `game-similarity.js`, `game-hints.js`, `game-tips.js` | `--only=color`, then `check_color_game_browser.mjs` | same static group; CDP half is `game-browser` |
| `today.html` | `--only=nav` **plus** `--only=color` **plus** `--only=home` | daily/熱門/精選 counts live in `color` and `home`, not `nav` |
| `team.html`, `team.css`, `team.js`, `team-analysis.js`, `team-state.js` | `--only=nav` | 18 entries, no browser; the team pair is 154 + 15 |
| `moves.html`, `move.html`, `moves.js`, `moves.css` | `check_moves_data.mjs && check_moves_page.mjs` | name them; add `check_moves_page_browser.mjs` only for a rendered claim |
| `moves_zh.json`, `learnsets.json`, `move_learners*.json` | `check_moves_data.mjs` | 127,868 checks, 0.1 s; one pass writes all four |
| `abilities.html`, `ability.html`, `abilities.js`, `abilities.css` | `check_abilities_page.mjs` | 133 checks, 0.1 s; no browser entry |
| `abilities.json`, `ability_species.json`, `species_abilities.json` | `check_abilities_data.mjs` | 18,849 checks, 0.1 s; one pass writes all three |
| `pokemon_data.json` names, or the source XLSX | `check_pokemon_names.mjs` | 94 checks; do NOT regenerate the roster (1,350 vs 1,025) |
| `types.html`, `types*`, `sv-index.js`, `sv-sources.json`, `assets/images/**` | `--only=type`, then `--only=types-browser` | four static at 3.3 s; browser is the rendered half |
| `maze.html`, `maze-pathfinding.js`, `algo.css` | `--only=algo`, then `--only=life-browser` | three static at 0.4 s; §3.P |
| `graph_data.json`, `graph.js`, `graph.html`, `pokeapi_form_stats.json` | `--only=model`, then `--only=graph-browser` | §3.V; browser only for layout |
| `shared.js`, `shared.css`, any `assets/js/*` | `--only=nav` **plus** `--only=color` | `shared.js` is read over every page; `assets/js/*` is a glob |
| `SITE_VERSION`, `CHANGELOG.md`, `docs/RELEASING.md`, `scripts/release.mjs` | `node scripts/check_version.mjs` | one declaration, one changelog entry, two footer slots; no browser |
| `*.json` under `assets/data/` | the group that owns the table | `data` owns learnsets/categories/evolution; cry tables `cry-data`, palettes `color` |
| anything in `scripts/` | `--force --only=<its group>` | editing a checker does not invalidate a prior entry |
| a file in no row above | `--help` first, then `--only` on what it names | `--prove-inputs` names the readers |

**`--only` gets you the answer now; it is not a correctness measure.** Verify a change by naming its checkers:

```bash
node scripts/check_moves_data.mjs && node scripts/check_moves_page.mjs   # 0.1s + 0.2s, no browser
```

**ONE RUN CONFIRMS A FIX; LOOPING IS NOT THE DEFAULT.**
- **After changing a checker or a page, ONE run is the evidence.** A repeat measures the ENVIRONMENT (load, contention, a leftover process); pass-then-fail means "flaky", not "fixed". Adding a timeout papers over it.
- **Loop only for a pass RATE** on a check you know is timing-dependent (`check_graph_browser.mjs`: "3 of 3 failures pooled, 3 of 3 passes standalone", §3.G9). If you cannot name the number, do not run it.
- **IF IT FAILED, DO NOT RE-RUN TO SEE IF IT PASSES.** Re-run **only** with `--force`, **only** to conclude regression vs contention, and say which.
- **A HANG IS NOT A FLAKE.** If a watchdog fires, fix the checker — raising the timeout is certainly wrong.

**Know what a group costs before choosing a filter.** `tier` does not predict wall clock — three entries of a tier are in flight at once. `entries` is read from the manifest (`node scripts/check_all.mjs --help`); `secs` is the last measured snapshot, so re-read it rather than trust it. `check_spectrogram_port.mjs` prints `SKIP` and **exits 0** when `../.venv` is absent — read the line, not the exit code.

| group | secs | entries | tier | where its time goes |
| :--- | ---: | ---: | :---: | :--- |
| `graph-browser` | 52.6 | 2 | B | `test_check_graph_browser.mjs` 40 s — four sequential Chrome boots; `check_graph_browser.mjs` ~9 s, **`serial: true`** |
| `cry-page` | 39 | 9 | B | `test_check_cry_game_similarity.mjs` 28.8 s (no browser); the page checkers are small |
| `moves-browser` | 27.9 | 1 | B | one Chrome, 919 rows |
| `sort` | 22 | 2 | B | `test_check_sorting_page.mjs` + `check_sorting_page.mjs` — **both boot Chrome, 25 boots in the harness** |
| `audio-browser` | 25.8 | 4 | B | `check_spectrum_browser.mjs` 9.8, **`check_cry_mobile_layout.mjs` 6.9 (§3.X, the only phone-width measurement)**, `check_cries_browser.mjs` 5.0, `check_gen1_page.mjs` 4.6 |
| `color` | 21.4 | 16 | B | sixteen small entries, none above 5 s (the two CDP halves moved out) |
| `life-browser` | 7.1 | 1 | B | `serial: true`, a 40×40 rAF page; one Chrome |
| `cry-data` | 8.4 | 8 | A | `test_check_cry_index.mjs` 4.7 s, `test_check_spectrogram_port.mjs` 1.4 s |
| `nav` | 9.3 | 18 | A | `check_js_syntax.mjs` 2.7 s, `test_check_nav_pages.mjs` 1.4 s, `check_team_page.mjs` 0.1 s; no browser |
| `outfit-browser` | 6.8 | 1 | B | one Chrome |
| `cry-apu` | 5.6 | **1** | A | `check_gen1_apu.mjs` alone, 4.5 s of it one pass over the 151-species corpus |
| `game-browser` / `types-browser` | 4.3 / 5 | 1 each | B | one Chrome each |
| `type` | 3.3 | 4 | A | `test_check_sv_index.mjs` 2.9 s; no browser |
| `data` | 1.8 | 9 | A | `check_learnsets.mjs` 0.2 s |
| `algo` / `model` / `home` | 0.8 | 7 | A | no browser; the life and graph browser pairs have their own groups |


**DO NOT USE `--only` AS A WAY TO AVOID A BROWSER.** Every browser sits in a `*-browser` group, or in `sort`; the other ten groups never boot Chrome. **`--only=cry-page` is still 39 s of pure Node** (`test_check_cry_game_similarity.mjs`), so read the table, not the group name. **Anything you can name directly is cheaper than its group.**

**A mutation case is only as expensive as the thing it attacks** — `test_check_color_match.mjs` went 42 s → 2.2 s on two unexamined defaults. **A check's name is a claim about its cost, and the name is not evidence.**
---

## 5. Data Pipeline & Regeneration Workflow

When rebuilding data files, always execute scripts in the correct order:

```bash
# Activate environment
source ../.venv/bin/activate  # /Users/jiejiefu/Documents/Visual_Studio_Code/.venv

# 1. Base Data: Merge CSVs and extract master JSON
    # !! DO NOT RUN WITHOUT READING THIS FIRST. !! As of 2026-10-19 this script
    # produces 1,350 records against the committed 1,025 — one of its CSV inputs
    # now carries the 325 formes too, so it does NOT reproduce the committed
    # pokemon_data.json. A regeneration is a roster change, not a data refresh.
    # The English names come from data-sources/International List of Pokémon
    # Names.xlsx, which fix_pokemon_names.py below also WRITES TO, so a name
    # correction is made there and applied to the roster as a guarded text edit
    # rather than by re-running this. See §3.AC.
python scripts/enhance_pokemon_data.py

# 1b. Homepage roster: rebuild after pokemon_data.json changes; --dry-run first.
python scripts/build_home_roster.py --dry-run && python scripts/build_home_roster.py && node scripts/check_home_sections.mjs

# 1c. Team roster: the slim 1,025-record table team.html reads; --dry-run first.
python scripts/build_team_roster.py --dry-run && python scripts/build_team_roster.py && node scripts/check_team_page.mjs

# 1d. Team moves: the four learn method pools + one def row per move.
#     Run after learnsets.json or moves_zh.json changes. --dry-run reports
#     bytes/gzip and the species that cannot reach four moves. The checker
#     rebuilds every method string from learnsets.json, so a stale table fails.
python scripts/build_team_moves.py --dry-run
python scripts/build_team_moves.py
node scripts/check_team_moves.mjs

# 2. Chinese Names: Scrape official names from tw.portal-pokemon.com
python scripts/fix_pokemon_names.py

# 3. Breeding Data: Fetch gender_rate & hatch_counter (run after Phase 1)
python scripts/fetch_breeding_data.py

# 4. Regional Dex: Fetch regional dex numbers
python scripts/fetch_regional_dex.py

# 5. Abilities: Fetch official Traditional Chinese ability names
    #     Roster-scoped: 284 slugs, read from pokemon_data.json rather than
    #     hardcoded. Still the source of the NAMES four pages consume.
    python scripts/fetch_abilities.py

# 5b. Ability detail: the effect sentence, the generation, and the holder map.
#     Writes THREE files in one pass — assets/data/abilities.json (314 rows:
#     nameEn/nameZh/effect/effectEn/generation/speciesCount/formCount),
#     assets/data/ability_species.json (slug → holder rows, 379 KB), and
#     assets/data/species_abilities.json (dex id → that Pokémon's names +
#     ability slugs, 88 KB), the last two being inverses of each other. They
#     cannot be out of step because one pass writes all three. 374 - 60 internal
#     block; 267 rows of Chinese effect and 47 English-only fallbacks.
#     --dry-run reports the provenance split and the excluded block's reason
#     without writing. Needs the venv (httpx + OpenCC), same as step 7.
python scripts/fetch_abilities_detail.py --dry-run
python scripts/fetch_abilities_detail.py
node scripts/check_abilities_data.mjs

# 6. Form Names: Scrape official zh-TW names for Pokémon forms
python scripts/fetch_form_names.py

# 7. Moves & Learnsets: Union move data across all generations.
#    Writes FOUR files in one pass — moves_zh.json, learnsets.json,
#    move_learners.json (move -> who learns it) and move_learners_count.json
#    (the 54 KB counts-only companion moves.html loads). They cannot be out of
#    step because one pass writes them; check_moves_data.mjs re-inverts
#    learnsets.json and compares, so a divergence is caught rather than assumed.
#
#    The effect sentence has TWO provenances and the boundary is a generation
#    line: 826 rows from PokeAPI's zh-hant flavour text, 93 (ids 827-919, all of
#    Generation 9) from InfoPoke's Simplified run through OpenCC s2twp. InfoPoke
#    is read for those two columns ONLY — its numbers and names are less
#    trustworthy than PokeAPI's (§3.AA). Its response is cached at the gitignored
#    data-sources/infopoke-moves.html, so delete that file to refetch.
#
#    Ships all 919 non-shadow moves, not only the ones our 1025 reference.
python scripts/fetch_moves.py
node scripts/check_moves_data.mjs

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

# 13. Real in-game evolution levels (life.html's evolution gate). 541 chain GETs,
#     cached offline under data-sources/ so re-runs do not refetch; writes the
#     {from_id: {to_id: min_level}} table plus the exact set of pairs with no level.
#     Run AFTER anything that changes pokemon_data.json's ids.
python scripts/fetch_evolution_levels.py --dry-run
python scripts/fetch_evolution_levels.py
node scripts/check_evolution_levels.mjs

# 13b. Form stats & types for every battle form (graph.html's mega/gmax nodes).
#      127 GETs -- 93 mega + 34 gmax -- ~30s. Caches to
#      data-sources/pokeapi_form_stats.json, which is GITIGNORED (raw PokeAPI
#      payload out, the generated assets/data/graph_data.json in), so a fresh
#      clone needs this before re-running build_graph_data.py. Hits
#      /pokemon/{id}, NOT /pokemon-form/{id}: the latter returns `types` but has
#      no `stats` key at all. Reports (never silently skips) any form the upstream
#      does not have -- today that is exactly Meowstic-Mega, which answers 200 as
#      a DIFFERENT form. Then rebuild the graph, which is what actually applies it.
#      --dry-run reports the roster without writing.
python scripts/fetch_form_stats.py --dry-run
python scripts/fetch_form_stats.py
python scripts/build_graph_data.py
node scripts/check_graph_chip_network.mjs

# 14. Cry features: one 34-number timbre row per roster cry, into
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

### Commit Messages

- **Subject** — `<type>(<scope>): <imperative summary>`. Type is one of `feat`,
  `fix`, `perf`, `docs`, `refactor`, `test`, `chore`, `build`, `ci` or `data`,
  and it drives `scripts/release.mjs`'s SemVer bump: an untyped commit is not
  releasable. Lowercase scope, ≤72 chars, no period or `and`; scope names the
  page or module (`index`, `moves`, `scripts`, `docs`). Name the outcome, not
  the edit; `add`/`fix`/`guard`, not `added`/`fixes`; a `!` before the colon
  marks a break and the body says what breaks and how to migrate.
- **Body** — blank line after the subject, wrap 72–76; state the problem, what
  changed, and the measurement, then the verification command and result. A
  number turns a claim into evidence; say when nothing was run.
- **Shape** — one direction per commit; no first person, emoji, or tool
  attribution. Weak: `fix stuff`; strong: `moves: restore the 92 moves with no
  PokeAPI meta`.
- **NO `Co-Authored-By` TRAILER, AND THE EXACT STRING IS NAMED HERE ON PURPOSE**: commit messages end after the prose. Do not append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`, or any `Co-Authored-By:` / `Generated with:` / `Signed-off-by:` line, or any other trailer that credits a tool. **This is not a style preference — the string is written out because an agent's own instructions may tell it to add one, and "my runtime said so" is exactly how it gets here.** On 2026-10-10 all 22 commits carrying that trailer were rewritten to remove it, and the rewrite touched every SHA in the repo, so the cost of getting it wrong is not one commit. The history is the user's alone; an agent's contribution is legible from the diff without being signed.
