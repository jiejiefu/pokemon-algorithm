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
| Page | What it is |
| :--- | :--- |
| `index.html` | Landing: daily pick, category previews, full 1,025 Pokédex grid |
| `pokedex.html` | Searchable Pokédex: fuzzy autocomplete, generation / type / colour filters |
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
| `types.html` | Type chart + per-type browser. The ONLY place the effectiveness matrix appears — §3.D, §3.H |
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

**No `package.json`, no `node_modules`, no build step.** Zero npm dependencies is a property, not an oversight: Node is invoked only as `process.execPath` and every helper lives in `scripts/lib/`. **There is also no CI** — nothing under `.github/workflows/`; the suite is run by hand.

**9,063 of the 10,000+ tracked files are binary** (7,063 PNG, 2,000 OGG) and 84 are code (57 `.mjs`, 27 `.py`). `assets/data/` holds 14 JSON tables and is the single source of truth for every page.

**Ten files under `assets/js/` and `assets/data/` are GENERATED and must never be hand-edited** — a key added by hand has a lifetime of one regeneration, and two of the three life.html data defects were exactly that:

| generated by | produces |
| :--- | :--- |
| `extract_genus_zh.py` / `fetch_form_names.py` | `genus-zh.js`, `form-names-zh.js` |
| `extract_glb_index.py` / `extract_sv_index.py` / `extract_cry_index.py` | `glb-index.js`, `sv-index.js`, `cry-index.js` (§3.E) |
| `fetch_gen1_cries.py` | `gen1_cries.json`, `gen1_cry_sfx.json` |
| `fetch_evolution_levels.py` | `evolution_levels.json` (§3.K) |
| `analyze_cries.py` | `cry_features.json` (§3.G1) |
| `extract_color_palettes_mmcq.py` | `color_palettes.json` (§3.B) |
| `build_graph_data.py` | `graph_data.json` — 1,346 nodes / 2,687 links for `graph.html`. Reads `data-sources/pokeapi_form_stats.json` (produced by `fetch_form_stats.py`, gitignored), and **warns by name** rather than falling back silently |

Two directories are outside `assets/` on purpose: `data-sources/sv-sources.json` records which host each SV PNG actually came from and is deliberately never served (§3.E), and `docs/incidents/` holds §3's receipts so AGENTS.md can stay small.

**`scripts/` is TWO unrelated toolsets, and the filename prefixes are the only thing separating them.** 58 files are verification — 35 `check_*.mjs`, 15 `test_check_*.mjs` mutation harnesses, 2 standalone tests (`test_cry_overlap.mjs` is a manifest entry in `cry-page`; `test_graph_browser.mjs` is a CDP smoke test that is **not** one) and 6 in `lib/` — driven by `check_all.mjs` and the §4 cache. The other 27 are `*.py` generators and scrapers, run **by hand in the order §5 gives** and never by the suite. They share one directory because nothing couples them but the files they generate, and **splitting them is not free**: a subdirectory each means editing ~100 path strings, 24 of them functional and 14 of those the manifest's own `inputs`, plus one harness that copies a `.py` into a fixture at a fixed relative path. A checker and its harness have to stay put regardless — every harness names its checker by path and imports `./lib/` relatively — which is the same reason `checks/` and `harnesses/` would be the wrong split despite being the obvious one.

**`scripts/lib/` is shared and small on purpose** — `negative.mjs` is the one definition of what "caught by" means, `pool.mjs` the one worker pool (§3.G7), `cdp-port.mjs` the one place a Chrome path and debug port live, `png.mjs` builds its own test PNGs, `mute-tap.mjs` silences audio before any page script, and `record-inputs.cjs` proves §4's input lists. Editing any of them invalidates every cache entry, which is why they are hashed into every key unconditionally.

---

## 3. Key Technical Conventions & Invariants

Each subsection below is a **rule**, the **shape of the defect** it came from, and the **checker that guards it**. The narrative and the measurements are in `docs/incidents/`, one file per area, reachable from each section's Background line.

**Five of the twenty-four rules are ENFORCED BY NOTHING, and that is worth knowing rather than discovering:** §3.A (routing and slugs), §3.C (contrast), §3.G5 (suite cost), §3.G7 (the pool) and §3.J (Chrome profile cleanup). A rule with no `Guarded by:` line below is not an oversight in this file — it is the §3.G1a shape, where 170 static and 43 CDP checks stayed green on a visibly broken page because they asked whether the prose EXIST rather than what it claims. If you touch one of those five, the evidence is whatever you measure yourself.

### A. Routing & Slugs
- **Local & GitHub Pages URLs**: Internal navigation uses query parameters (`detail.html?slug=bulbasaur` or `color.html?slug=bulbasaur`).
- **Nidoran Disambiguation**: `nidoran-f` (#029) and `nidoran-m` (#032) are distinct slugs. A bare `nidoran` slug is strictly disallowed and must not resolve.
- **Form Links**: Alternate forms link back to their base species detail page.
- **detail ⇄ color Reciprocity**: both pages must build their cross-page URL from the one canonical helper — `pokemonDetailUrl()` in `shared.js` and `paletteUrl()` in `color-palette.js`. **Never assemble either URL by hand or by string-replacing `detail.html`**: `color.html` deliberately does *not* inherit detail's clean-URL contract, so the two shapes can diverge and a derived string breaks the day either gains a path segment.

**Background:** [`docs/incidents/page-defects.md#a`](docs/incidents/page-defects.md#a)

### B. Color Extraction & MMCQ System
`assets/data/color_palettes.json` is generated by `scripts/extract_color_palettes_mmcq.py`: a 6-colour MMCQ partition sampled from 96×96 front sprites (alpha ≥ 200), with synthetic centroids **snapped** to the most frequent real pixel in each bounding box. Shares are global pixel frequencies across the sprite, so they sum < 100% (median ~71.95%). Exactly 3 palettes have 5 colours instead of 6 (#201 Unown, #643 Kartana, Bulbasaur shiny) — **never pad these artificially.** `color-thief` is credited for the algorithm; `pokemonpalette` for the colour scales and UI concepts.

**Guarded by:** `check_outfit_page.mjs` re-derives all 2,050 palettes through `mmcq.js` and requires byte-equality.

**Background:** [`docs/incidents/color.md#b`](docs/incidents/color.md#b)

### B1. `colors-generator.html` Is Not A Smaller `color.html`
The two colour pages share a component library (`paletteGridHtml`, `paletteStripHtml`, `.cp-cell`, `.cp-strip`) but **not a layout**: one *reports* a species' measured palette, the other *generates* a theme from a colour you supply.

- **Five sections were DELETED, not merged** (對照·實測色盤 / 生成明暗階 / 套用展示 / 生成組成 / 匯出主題). Two copies of one species' palette is duplication, not comparison. **This page's job ends at the generated palette** — the ramps, the showcase and theme tokens are `color.html`'s.
- **The page's own copy must not describe what was removed.** The meta description and intro both promised 「生成明暗階、套用展示」 after those sections were gone. A search-result summary and the first paragraph are the two places a reader is most likely to believe, and no shape check reads either.
- **`generatedRows()` IS the input colour plus the matched species' real colours** — the generated palette *is* the measurement whenever the input is that species' primary, which is the default landing state.
- **`assets/css/colors-generator.css` exists so this page's rules are not `color.html`'s problem.** Every rule is `cg-`-prefixed and mounted only here. **Never edit an existing `.cp-*`, `.sc-*` or shared token for a generator-only need — add a `cg-` rule.**
- **The 24-cell legendary grid pins the species, not just the colour.** `#FFFFFF` is the primary of **29** species, so re-ranking white would present a Wingull's palette under a card saying Reshiram. `matchOf(id, hex)` therefore builds the record with `rank: -1` — a pin did not win a competition — and the eyebrow reads 你選的, not 最接近. A pin survives re-ranking **only while the input is still one of that species' own six colours**. The grid is built ONCE in `init()`; only its highlight moves, because re-rendering throws away 24 buttons and leaves every reference pointing at detached nodes, which do not bubble.
- **The colour field speaks three notations and the toggle is display only.** `parseColorInput()` accepts HEX/RGB/HSL regardless of what is showing, because a toggle that filtered input would split the typed path from the paste path. `inputFormat` never round-trips through the text — `hsl(180,44%,40%)` reads back as `#399393` — **so flipping the toggle would restate the colour and every number on the page would then describe one the reader never chose.** Three states: parseable commits, a possible prefix says nothing (`hsl(18` is the fourth keystroke), neither flags it and **leaves the previous result on screen**. Ranges are strict, never clamped. The format note appears only on error.

**Expect this shape on any short element id:** every id is a named property of the document, so a bare `scale` in `color.html` is `<div id="scale">`. A missing `const` is not a `ReferenceError` when the document already owns the name, and a `Map`-style lookup on a DOM node answers `undefined` rather than throwing, so any `obj[key] || fallback` quietly becomes `fallback` for every key.

**Guarded by:** `check_color_match.mjs` (220 checks, asserts the ABSENCE of the five removed sections, their containers, their leftover code and their dangling ids) and `check_color_page.mjs`; 28 + 20 mutation cases.

**Background:** [`docs/incidents/color.md#b1`](docs/incidents/color.md#b1)

### B2. Three Colour Namers, One Chroma Gate
`color.html` prints two of them **side by side for the same hex**: the prose is `describeHex(primary)`, the swatch list is `chineseColorName(hex)`. Before the gate they disagreed on **97.6% of primary colours** — and each was separately wrong about greys. Arceus #493's primary `#e6e6ee` has max−min = **8 of 255**, a grey; `describeHex()` read hue 240 and lightness 91.8 and never looked at saturation, so it said **淺藍**, while `chineseColorName()` ran a 100-entry nearest-neighbour over RGB and said **薰衣草紫** (`#E6E6FA`, 12 away in one channel). The page said both.

**Every namer is gated on `chroma()` = max−min, below `NEUTRAL_CHROMA = 16` → `neutralName()`.** Measured on all 12,297 corpus swatches: `describeHex` renamed 1,620, `chineseColorName` 2,387, `colorTemperature` 178 (now all `neutral`), and **0 chromatic swatches changed**.

- **Chroma is absolute and must never be HSL saturation.** `s` is a ratio against lightness, so `#fffff6` measures **s = 100%** while being nine channels from grey — and near-whites are the largest grey bucket (白: 698 of the 2,387). `#e6e6ee` is the mirror image at s = 19%. **Refactor the gate onto `s` and every near-white flips from grey to a loud colour name.**
- **The threshold is in a gap, not merely low.** The corpus chroma histogram is empty between the grey cluster and the coloured one, so **16 through 31 all behave identically**; 32 is where it starts eating. That is why raising it cannot be caught by a "greys are named greys" check.
- **`describeHex()` on a pure grey returned 紅, not 白**, because `max === min` leaves `h` at 0, the first bucket in `hueNames`. That is 1,510 of 12,297.
- **Nearest-in-RGB will always match a grey to a tinted name**, because an entry 8 away in one channel beats every 淺灰 that is 20 away in all three: `#414141` came back **墨綠**.
- **`灰白` exists because 白色 would be a false claim** — `#e6e6ee` is 92% lightness and is not `#ffffff`.
- **`chineseColorNameWithEn()` is gated identically and returns the zh-only grey name** — pairing 灰白 with *Lavender* would assert the exact claim being corrected. It is on no colour page today, which is precisely why it needs its own case.

**Expect this shape when a guard can only be satisfied vacuously:** raising `NEUTRAL_CHROMA` to 255 satisfies all three "must not be chromatic" assertions *and* the demotion check at once, because there are then no chromatic swatches left. The detector has to be an assertion about colours that ARE still chromatic.

**Guarded by:** `check_color_palettes.mjs` + 9 mutation cases against a scratch copy of the module (the 11 pre-existing cases mutate the palette *data*, which cannot reach this code at all).

**Background:** [`docs/incidents/color.md#b2`](docs/incidents/color.md#b2)

### C. Contrast & Accessibility Rules
- **Color Contrast (WCAG AA)**: 4.5:1 for standard text, 3:1 for large text and UI components.
- **Measurement Method**: verify contrast by sampling decoded screenshot pixels via Canvas/CDP, **not** via `getComputedStyle()` — which misses alpha blending, backdrop filters and radial gradients.
- **Typography**: CJK-first stack in `--font-sans` (`PingFang TC`, `Noto Sans TC`, `Microsoft JhengHei`).
- **Theme Switching**: handled inline in `<head>` before first paint; toggling fires `themechange` for Canvas redraws.
- **Reduced Motion**: honored across CSS and JS — sprites snap to target coordinates instead of lerping.

**Background:** [`docs/incidents/page-defects.md#c`](docs/incidents/page-defects.md#c)

### D. Type Profiles & Scoped Translations
`assets/data/type_profiles.json` is generated by `scripts/fetch_type_profiles.py`, which scrapes the InfoPoke `/types/[id]` Nuxt chunk. **InfoPoke publishes no zh-TW catalogue for this route**, so the file mixes three provenances and they are kept in separate fields rather than merged:
- `blurbEn` / `battleTipsEn` / `categoryNoteEn` / `entriesEn[].effect` — **English upstream**, shown inside a collapsed block labelled as upstream English, never passed off as our translation.
- `entries[].effect` — **Simplified Chinese upstream**, converted with `OpenCC` `s2twp` and pinned by `requirements.txt`. The only zh-TW effect text on the page.
- `trainers[].roleZh` — **this project's own translation** of InfoPoke's English role titles. Trainer and city proper nouns stay English.

Two consequences before editing `types.html`: **ability names come from our data**, not the scrape — the list is built from `pokemon_data.json[].abilities` + `abilities_zh.json` and borrows only effect text, matched on the official Chinese name (59 of 74 scraped names join; the floor is pinned at 70% so the join cannot silently collapse). **Type relationships come only from `type-chart.js`** — never from InfoPoke and never from `type_profiles.json`. `Electric → Water` is `2×`.

**Guarded by:** `check_type_profiles.mjs`, including the 70% ability-join floor.

**Background:** [`docs/incidents/page-defects.md#d`](docs/incidents/page-defects.md#d)

### E. Scarlet/Violet Artwork & Provenance
`assets/js/sv-index.js` is generated by `scripts/extract_sv_index.py` from the PNGs actually on disk. **It is not a list of what exists upstream, and it must never be hand-edited.** `assets/images/scarlet-violet/` holds 1,225 PNGs (the 1,025-ID roster plus 200 unclaimed variants); unclaimed files are counted and reported but never added.

Artwork is fetched by `scripts/fetch_sv_sprites.py`, **PokeAPI first**, falling back to InfoPoke only when the primary host returns no valid PNG — the fallback exists because PokeAPI's SV set is incomplete, so it is not a second source of truth. **The frontend credits PokeAPI only**; `types.html` must not name the fallback anywhere a reader can see. The real per-file answer lives in `data-sources/sv-sources.json`, deliberately outside `assets/` so it is never served.

The roster is complete today, so the stand-in path is dormant: `hasSv()` is true for every species and `.chip-thumb.is-sub` is never applied. **The code stays** so a future upstream removal degrades to the 96px sprite floor instead of a broken image.

**Guarded by:** `check_sv_index.mjs` + 15 mutation cases.

**Background:** [`docs/incidents/page-defects.md#e`](docs/incidents/page-defects.md#e)

### F. Cry Audio — `gb-apu.js` Is Transcribed, Not Reasoned
`assets/js/gb-apu.js` re-synthesises pokered's 38 base cries. It is a pure module with no DOM, Web Audio or fetch, which is the only reason its claims are checkable. **It is verified against the reference's own OUTPUT, not against a description of it** — `gen1_conformance.json` holds, per species, the output length plus 48 sampled values of the 8-bit form the reference page's Download button produces, generated by driving that page in headless Chrome. Current result: all 151 lengths match exactly, 98.7% of sampled values are byte-identical, every remaining one within one 8-bit step.

*This distinction is the single most important thing in this section.* Six bugs had the APU confidently disagreeing with the reference while **agreeing with every other file in the project**, because every assertion compared it to a *description* — and a description can be wrong in ways that are self-consistent. **Nothing short of comparing output found any of them.**

- **The length parameter is the stored byte MINUS `0x80`, not its signed reading.** Reading it signed gives a multiplier `0x80` larger, making every note **1.5× too long**.
- **The duty register holds the PACKED byte**, not the pattern array — the reference reads `duty & 3`, so an array coerces to `NaN` then `0`, silently selecting the 12.5% window on every note whose low two bits are not `00`. The two channels whose low bits happened to be `0` matched by luck, which is what made this look like tuning rather than a bug.
- **The mix is NOT peak-normalised.** Three channels at a third each cannot clip; normalising only rescaled every cry and made a soloed channel as loud as a full one.
- **Every register is in samples at the Game Boy's clock and each must be scaled to the output rate — including the noise LFSR clock, which was not.** At 65,536 Hz the LFSR ran once per 512 *output* samples: 128 Hz where the hardware means 2,048. The symptom was a cry correct in every respect except that **it had no hiss in it** — 76 zero crossings per second against the reference's 1,533.
- **…and that is precisely what a native-rate conformance comparison is blind to.** At 1,048,576 Hz the conversion factor is exactly 1 and the bug is a no-op. **So the rate-dependent checks are rate-independent by construction: the same species must report the same noise clocks and render the same grain at 65,536 and at 1,048,576.** Expect this shape: a quantity that only matters on the way to the speakers can only be checked on the way to the speakers.
- **The master volume has been removed rather than checked.** `sliderToMaster()` mapped a 0..10 page slider onto the channel scale's 0..15, which was a conversion between two numbers that were already the same unit, so there was nothing for it to be right about. The page now presents 0..15 directly and defaults to 3.
- **`sound_loop` IS applied** (the reference's "unsupported" label refers to its UI, not its data), `count` is the number of *times* the block plays, and loop targets are stored as `"Ch5"` rather than literal labels.
- **The ring-out is bounded only where the envelope can never empty.** A sweep of `0` means it never does, so 16 frames is the bound there. Bounding *every* note is wrong and was: a legitimate tail is 240 frames at the largest sweep, and a flat 16-frame cap silently truncated seven species. **Those seven were then recorded as a "known set" on the reasoning that a tolerance beat a red test** — covering up a bound that would equally have hidden a truncation twice as large. A named exception list is for upstream quirks you cannot fix, never for your own truncation.
- **The synthesis rate is 65,536 Hz, not the real 1,048,576**, because Web Audio caps a buffer at 96,000. The ratio is exactly 1/16, so nothing drifts.

**Background:** [`docs/incidents/cry.md#f`](docs/incidents/cry.md#f) — including all six documented failures (per-quarter-period duty rotation, continuously-decaying envelope, time-stretched noise, single-field noise rate, no ring-out, byte-minus-0x80 length), each written wrong first.

**Guarded by:** `check_gen1_apu.mjs` (92 checks) and `check_gen1_cries.mjs` (40 checks). `test_check_gen1_apu.mjs` (39 mutation cases) is **deliberately not a manifest entry** — see §4.

### G. The Two Cry Pages
Driven over CDP because they make claims no static checker can. **A playback cursor's guard must be `!== null`, never `> 0`:** `AudioContext.currentTime` reads exactly `0` on the first play, so `startedAt > 0` reported "not started" for the entire first playback and the cursor never appeared.

- **The waveform is cached in an offscreen canvas**, bound with `const` from the first line. There is no "get the visible context, then reassign it to the cache" step — which is how `cries.html` threw a TypeError instead of drawing.
- **`cryPlayer.play()` resolves when a cry ENDS**, so a caller had no way to know when playback began; it takes an additive `onStart` hook carrying the duration and the clock reading.
- **Both pages share ONE autoplay switch, and it must never fire on load** (`assets/js/cry-autoplay.js`, one module rather than two copies). On `cries-gen1.html` the flag is a *parameter* because `select()` serves boot and clicks alike; on `cries.html` it is a read inside two click handlers, so the check counts call sites on comment-stripped source.
- **A mute nothing verifies is not a mute.** Both CDP checkers keep `--mute-audio` — which is the right *first* line, because it mutes at the browser so the AudioContext still runs and the clock still advances — but it is a request. So `scripts/lib/mute-tap.mjs` is injected **before any page script** and replaces `AudioContext.destination` with a gain node at zero, asserted by reading the live `AudioParam` rather than a value recorded at install time, so the question answered is "is the output muted *now*".
- **Count drawn pixels by ALPHA, and the assertion must be able to return false.** A blank canvas is transparent, so alpha is the only thing that distinguishes 「drew nothing」 from 「drew black」. `check_cries_browser.mjs` once reported `ok` for its entire life because it counted every untouched `(0,0,0,0)` pixel as dark (2,400 of them, a perfect score) and asserted `typeof drew === 'number'`, which is true of `undefined`.
- **A slider's id is not the state field's name.** Three sliders were wired `state[id] = value`, which silently created a fourth property: the Length slider's key is `lengthSigned`, so **the Length slider did nothing at all** — same bytes, bit-identical audio, looking exactly like a working control.
- **The recorded cries play at the SAME loudness as the synthesised ones** (`DEFAULT_VOLUME = 3 / 15`, in the player because the player owns the output gain; the per-call `volume` argument is a separate trim and still defaults to 1, since squaring it would drop the level to 0.04).
- **A filter and a scroll position are different quantities and must not share a field.** `cries.html` had one `state.gen` serving as both, so 第 1 世代 asked for 60 cards out of all 1,025 and showed exactly what the unfiltered page showed.
- **A checker that presses play must CONFIRM the press landed**, because a page that re-renders a control's markup makes the captured node detached, a detached node does not bubble, and the click is a silent no-op — which surfaced as a flake (`x=669` idle, `x=696` under load) that would have been "fixed" by widening a tolerance.

**Background:** [`docs/incidents/cry.md#g`](docs/incidents/cry.md#g)

**Guarded by:** `check_gen1_page.mjs` (74), `check_cries_browser.mjs` (25), `check_cries_page.mjs` (64) + `test_cry_overlap.mjs` (6).

### G1. The Spectrum Page — A Port That Is Checked Against Its Own Extractor
**No spectrogram is stored.** `analyze_cries.py` already computes the band to get its MFCC, so the spectrum is one function away; a stored bank would be ~2.3 MB and would go stale on every re-encode. The second reason is that **a port can be checked against the thing it ports**; a stored image is a claim.

- **`analyze_cries.py`'s `resample()` has TWO BUGS, recorded rather than fixed, because fixing them moves the stored table.** It scales by `n_out / n_fft` where zero-padding does not change `X`, so the amplitude-preserving scale is **1.0** — a 100 Hz tone resampled from 32,728 Hz comes back at 0.1465 of its amplitude. And it keeps `n_out / 2` bins of an `n_fft`-point transform, so its top kept bin sits at a **duration-dependent** frequency (4.1 kHz for a 0.7 s signal, against the 8 kHz a resample to 16 kHz must keep). Measured cost: **31 of 34 features have a median relative difference of `0.00e+00`**, because the cries barely use the top of the band. **`m0` alone moves systematically**, by exactly `log(n_out / n_fft) · √26` — about a quarter of `m0`'s variance is a function of how long the file is, and `cries.html` standardises `m0` before its search.
- **The module does NOT copy either bug.** It exports `UNCOMPARABLE = [peak, rms, m0]` and `M0_SCALE_OFFSET = √26`, and the checker asserts the m0 relationship as an **IDENTITY rather than a tolerance** — satisfied by exactly one relationship between the two numbers. A tolerance would have been satisfied by a mutation whose own difference is under 5%.
- **`UNCOMPARABLE` HAS TWO CAUSES and the page says so in two sentences.** `peak` and `rms` are a *limit of the browser* (measured at the true source rate, which `decodeAudioData` makes unrecoverable); `m0` is a *defect upstream*. Conflating them tells a reader to distrust a tool when the tool is right.
- **The page reports five features and not a relative difference for the other 29.** Across the 31 comparable features the browser and `cry_features.json` differ by a **median 5.5%** and by **1,181%** on the worst — and that worst is an `ms` column whose stored magnitude is about 0.002. The five reported are `dur`, `zcr`, `centroid`, `rolloff85`, `flux`. **`flatness` was in that set on the reasoning that it is a ratio bounded by 1 and therefore stable, and measured 31%** — it is scale-invariant and ill-conditioned, a ratio of two nearly equal numbers. **That is the second time in this project a property which sounds like a guarantee turned out to be an unrelated one.**
- **The live curve is a second measurement, and the caption says so** — 1024 *linear* bins at the *device* rate over a 2,048-point window with smoothing 0.3, folded into the same 26 mel bands. It answers 「where is the energy *right now*」 at 60fps, which an offline grid cannot do at all.
- **THE REVEAL IS NOT A STREAMING ANALYSIS, and the intro says so.** The whole spectrogram is computed before the reader presses play; playback uncovers one set of pixels.
- **The plot is NEAREST-NEIGHBOUR on both axes, and the blockiness IS the resolution** — 10 ms on a fixed hop, so a 0.18 s cry really does put ~55 pixels between two measurements. **The colour ramp is deliberately theme-INDEPENDENT**, because re-mapping a scale per theme would mean the same number in the same cell reading as two different things.
- **The live line and fill are the species' own `rgb`, lifted only as far as the plot ground requires** (`assets/js/species-ramp.js`). **The floor is 3:1 because this is a GRAPHICAL OBJECT, and 68 of 1,025 species need it.** **「黑色系寶可夢看不見」 is the wrong diagnosis**: the four worst are *desaturated, not dark*, and 197 species (19.2%) have a grey average colour altogether — the same `chroma()` gate as §3.B2. **`contrast` must be `shared.js`'s own, passed in, never re-derived** — a luminance written into `species-ramp.js` would disagree with every contrast figure in the project.

**Background:** [`docs/incidents/cry.md#g1`](docs/incidents/cry.md#g1) (including §3.G1a: a stray `</div>` auto-placed seven children as four rows while **170 static and 43 CDP checks stayed green**).

**Guarded by:** `check_spectrogram_port.mjs` (55), `check_spectrum_page.mjs` (196), `check_spectrum_browser.mjs` (72) + 11 and 41 mutation cases.

### G2. The Header Is Not One Thing
Two defects produced a visibly broken page with **no console output, no failed request and no exception** — because the header's contents are owned by `shared.js` at runtime, so hand-written markup in those containers is a duplication question, not a style question.

- **A bare `class="header"` is not a missing-style page — it is a valid class that renders the column layout.** The row layout comes from a *separate* rule listing six modifier classes, so a page carrying only the base class falls through and every other nav check passes on it. Measured: the header grew 55px → 98px and the nav overlapped the theme toggle. **Expect this shape whenever a base class is the mobile layout and a modifier supplies the desktop one** — a bare base class is a valid, rendering, wrong page.
- **The theme toggle's own icons are injected, and the runtime's guard is the trap.** `initThemeToggle()` adds its pair only `if (!btn.querySelector('.icon-sun'))`, so a page hardcoding a *differently-classed* pair satisfies nothing: the guard is still true, the canonical pair is injected *as well*, and the button ends up with four children in a 34px grid box, one painting outside it. **Leave the button empty and let the runtime own its contents**, exactly as the nav container is left empty.

**Background:** [`docs/incidents/checker-infrastructure.md#g2`](docs/incidents/checker-infrastructure.md#g2)

**Guarded by:** `check_nav_pages.mjs`, which reads the six modifier names **out of `shared.css` rather than restating them** and asserts the list is non-empty.

### G3. Race Mode — Six Lanes, and the One Shape That Renders Nothing
It shipped with **every lane blank** and no console output, the same family as §3.B1's bare `scale`: **a bare name that resolves to the module's variable instead of the caller's.**

- **`paint()`, `ring()` and `sweep()` all closed over the module-level `ctx`**, the single-mode canvas. `frameRace()` cleared `lane.ctx` then called `paint()`, which drew 130 sprites a frame into a canvas `setMode()` had set `hidden`. All three helpers now take the context and timestamp from the caller, and `sweep()` returns whether it is *still running* so the caller clears its own field.
- **Count ink by ALPHA, and let the assertion return false.** Measured over 5 layouts × 4 sizes with real sprites, min ink per lane was **24,573 → 110,893** — a FLOOR, not a bound, because sprites are mid-lerp on every frame.
- **The lane layout is `data-lanes` on the container, and it is spelled out rather than derived** — 4 lanes is 2×2, *not* 3+1, and five's `span 3` on its last two lanes is positional, which is why `buildRace()` **appends** `.al-result` rather than prepending it.
- **`align-content: stretch` is load-bearing, not cosmetic.** A `center`ed row track is sized to its *content*, so the canvas has no free space to grow into and `flex: 1 1 auto` on it is a no-op: two lanes at n=1,025 gave 483×302 canvases with `center`, and 483×655 with `stretch`.
- **`finishRace()` re-measures AFTER it writes the panel**, because the lane rows are `1fr` and filling an empty `<p>` makes every canvas shrink again.
- **`maxLoggedEvents: 0` on every lane**, because a race lane is the only `SortRun` on this site that never rewinds — the log costs ~33 MB per lane at n=1,025 and nothing would read it.
- **A race lane's cost is DESTINATION AREA, not sprite count.** Six 311×289 lanes total 539k px, less than the single-mode canvas this page already runs at 60fps.

**Guarded by:** `check_sorting_page.mjs`'s rendered half, counting ink by alpha.

**Background:** [`docs/incidents/checker-infrastructure.md#g3`](docs/incidents/checker-infrastructure.md#g3)

### G4. The Sorting Page Finally Has A Checker
`sort` was the newest group and the defect above shipped through a 41-script suite: no checker read the page's DOM or its stylesheet, so six permanently blank canvases were invisible to everything the manifest covered. `check_sorting_page.mjs` (102 checks) is split in two, and the split is the design:

- **STATIC, 65 checks, ~0.2 s** — reads `sorting.html` / `algo.css` / `sort-run.js` / `shared.js` off disk. A stylesheet contract can be checked by reading it.
- **RENDERED, 37 checks, ~12 s** — drives the real page over CDP and counts ink by alpha.
- **The rendered half answers every sprite with a 71-byte stub, and that is a deliberate trade.** The page boots by fetching 1,025 sprites at ~130 MB, which was 85% of the runtime. **The stub still catches everything §3.G3 is about** (sprites painted into a hidden canvas give zero ink whichever sprite they are, so the original defect is caught in full), and **what it gives up is that the sprite paths resolve and the PNGs decode** — `PokemonNode.draw()` skips an image whose `naturalWidth` is 0. **The PNG is built, not pasted** — a corrupt stub leaves every lane blank and the checker fails for a reason that has nothing to do with the page, so the chunk/CRC32 constructor re-parses its own output and a bad signature is a startup throw, not 37 red checks.
- **THE STUB IS PROVEN LIVE, or the speedup is a claim nothing checks.** The intercepted-request count is asserted `>= 1,025`, and the glob is read out of `ASSETS.images` rather than written down. **Its ink figures are higher than the real ones and not comparable** — an opaque stub fills its destination box; §3.G3's `24,573 → 110,893` is the real-sprite measurement and stays as the historical figure.
- **THE FAST LOOP IS `--static` ON THE HARNESS, and its placement is the point.** `node scripts/test_check_sorting_page.mjs --static` — 0.5 s. It is **not a flag on the checker** (§4's rule), and it sits **above the harness's two baselines**, because it originally sat below them and the fast loop took longer than the thing it shortcut.
- **THE STRIP IS GUARDED BY A CHECK COUNT, not by "it still passes".** The harness deletes everything between the `RENDERED HALF` sentinels and requires the stripped copy to pass having dropped **exactly 37** checks. That number is **hardcoded, and updating it is the point**: deriving it from the source would be tautological.
- **`Network.setCacheDisabled` IS NOT WHAT KEEPS THE RUN FRESH.** One run reported the old `.al-lanes` rule and the first explanation was a stale cache; it was a concurrent session that had reverted `algo.css` on disk. **Believing the flag was the safeguard means believing the page is being tested current when nothing was checking it.**

**Background:** [`docs/incidents/checker-infrastructure.md#g4`](docs/incidents/checker-infrastructure.md#g4)

**Guarded by:** `check_sorting_page.mjs` + 34 mutation cases. **Known:** the browser half is still flaky under tier-B contention — but the recorded symptom is FIXED, so this note describes the one that is left. `min ∞ px` no longer prints: `laneMin` is seeded to `0` when nothing was read, and a `check(Number.isFinite(minInk), …)` asserts that at least one configuration was measured at all. What remains is a **second, quieter** failure: `.al-result` is appended by `buildRace()` as its **last act**, so "the result row is not in the DOM yet" is a legitimate state, and the finish poll used to dereference it unguarded — a TypeError that `evalJs` rethrows, killing the checker ~70 lines from the cause. The poll now reads through a named `RESULT_PANEL_STATE` helper that reports `present`/`shown`, and the two `READY` results it depends on are checked rather than discarded. **Not reproducible on demand:** the condition only occurs under pool contention, so it could not be pinned with 3 standalone runs plus a forced pooled run; see [`#u`](docs/incidents/page-defects.md#u).

### G5. The Cry Suite Was Slow For Three Unrelated Reasons, And Only One Of Them Was A Payload
The obvious move was to stub the cry suite the way §3.G4 stubbed the sorting sprites. **The measurement came first, and the stub fits exactly one cell.** Sorted by where the time actually went: `test_check_gen1_apu` 54.4 s is **CPU**; `test_check_cry_index` 22.6 s → 6.1 s is **a payload** (31 MB copied 22 times); the three CDP checkers' 42.6 s → 12 s is **fixed `setTimeout`** — 35.5 of it sleeping, and they were never waiting on the network.

- **`test_check_cry_index.mjs` builds its working tree once and each case restores what it touched.** The corpus is still the real 31 MB. **The trap this shape invites is a hand-maintained list of "paths a case may touch"** — a second copy of the truth, where a case grows a mutation, forgets the list, and the *next* case runs against a dirty tree and passes for the wrong reason. So there is no list: each case records its own path, and disabling the restore makes cases fail, which is what proves it is load-bearing.
- **A FIXED SLEEP IS A GUESS, AND A GUESS FAILS IN BOTH DIRECTIONS.** Every ceiling used exceeds the sleep it replaced, so tolerance only goes up, and a timeout returns `false` so the assertion still runs and still reports its real number.
- **A WAIT AND A SAMPLING INTERVAL LOOK IDENTICAL IN THE SOURCE AND MEAN OPPOSITE THINGS.** The 130 ms between two `getImageData` calls is the *measurement window* of a "did this canvas MOVE" assertion, so it stays. Conversely the 2200 ms "let it play, then stop it" interval was replaced with 500 ms, not with a poll, and **trying the poll made the file SLOWER (14.6 s → 17.6 s)**.
- **TWO OF THESE EDITS FOUND REAL BUGS, IN OPPOSITE DIRECTIONS.** A poll that fires too early **turned a red into a green**: waiting for the AudioContext to exist returned instantly, before the page had read the stored mute off disk, so a *failing* check passed. The fix polls for the precondition for *reading a live measurement*: that the value has **stopped changing**. And an assertion that assumes a precondition nobody established **can never pass**: `check_spectrum_browser.mjs` asserted `theme === 'light'` while headless Chrome reports `prefers-color-scheme: light`, so it failed for its whole life while reporting a message about the ramp. **Expect this shape whenever a check names an END state and never reads the START state.**
- **WHAT DID NOT GET FASTER, AND WHY IT CANNOT, IS WHY IT IS NOT IN THE SUITE.** `test_check_gen1_apu.mjs` runs 34 s and cannot be made cheaper: 17 heavy cases each render 151 species at the native rate, and `renderSpeciesCry` is pure, so there is nothing to cache, share or stub. **The entry was removed rather than flagged**, and the file stays runnable by hand. **What that gives up is named, not glossed:** `check_gen1_apu.mjs` still runs, so the synthesis is still compared against the reference every pass; what is gone is the proof that each of its 92 assertions would fail if the thing it polices stopped being true.
- **THE REPLACEMENT IS A FOUR-ROW AUDIT IN THE RUNNER, and it is weak on purpose.** It reads the retired harness and fails if any of its 39 `expect` strings no longer names an assertion the checker contains. **It lives in `check_all.mjs` because a guard that reads the file under test runs in every fixture too** — 22 of the 39 cases run a tree whose checker has been stripped, so the guard read a stripped source, could not find the assertions 17 expectations name, and emitted 17 failures into the one assertion that exists to make stripping safe. **A fixture is not the file; the runner is not a fixture.**

**Background:** [`docs/incidents/checker-infrastructure.md#g5`](docs/incidents/checker-infrastructure.md#g5)

### G6. State Shared Through Storage Is Not State a Per-Page Test Can See
`sorting.html` starts with its cry switch off, which is correct. It expressed that as `cryPlayer.muted = true`, and **that setter persists** — so merely *loading* the page wrote `{muted: true}` and `cries.html`, `detail.html` and `spectrum.html` went permanently silent, with no control of their own to undo it. **No test could see it, because the bug needed a VISIT ORDER**, and every checker runs on a fresh `--user-data-dir`. `cries-gen1.html` was unaffected because it builds its own `AudioContext` — which is exactly why the report read as two unrelated bugs.

- **THE FIRST FIX CLOSED ONE GATE AND LEFT A WORSE ONE, and the shape is the point.** `muteForView()` closes the load path, but `#save()` is also reached from the volume setter, which serialised the *effective* mute — so the page's default rode out through a slider the reader was using for an unrelated reason, which is worse than one written on load because **it presents as the reader's own doing.**
- **One field cannot carry both decisions because `#save()` cannot tell them apart.** `#storedMuted` is the reader's choice and the only one written; `#viewMuted` is a page's default and lives in memory. **`#applyGain()` and `get muted()` must both read the OR** — `#storedMuted` alone makes `sorting.html` loud by default, `#viewMuted` alone ignores an explicit un-mute. Neither wrong answer throws.
- **A WAIT FOR NAVIGATION MUST BE GATED ON SOMETHING ONLY THE DESTINATION HAS.** The cross-page wait was gated on `nav[data-nav] a`, which **the page being navigated away from also has**, so the wait returned instantly against the old document. `Page.navigate` resolves when the navigation is committed to the browser, not when `Runtime.evaluate` reaches the new document, and **the two documents share an origin — so anything they have in common is evidence of nothing.**
- **THE MEASUREMENT HAS TO DISTINGUISH "MUTED BY THE CHECKER" FROM "SILENT".** The tap zeroes `ctx.destination`, so the probe's own gain is 0 by construction; the player's level is read one node upstream. **Expect this shape anywhere a test silences the thing under test: discard the output, measure upstream of it.**

**Guarded by:** `check_cries_browser.mjs`'s cross-page cry-volume regression.

**Background:** [`docs/incidents/cry.md#g6`](docs/incidents/cry.md#g6)

### G7. Nine Harnesses Were Running One Child At A Time, And The Fix Is One Module
`scripts/lib/pool.mjs` exists because nine of the fourteen harnesses were the same construct: independent cases, each its own `node` process against its own temp tree, run one at a time by a `for` loop around an `execFileSync`. **Every report is byte-identical to the version it replaced, exit code included** — that is the whole verification, and it is the only one that counts.

- **DECLARATION ORDER OUT IS PART OF THE CONTRACT, not an accident of scheduling.** The obvious implementation logs from inside the worker, which makes output order a property of the scheduler — so two green runs stop diffing and a red case cannot be found by reading. `pool()` returns one result per task in the order they were given and the caller prints after the drain.
- **`POOL` IS CAPPED AT 4 AND NOT AT THE CORE COUNT, and that is a real choice on a 10-core machine.** Each worker is a full JIT-compiling interpreter rather than a thread, and other work shares this machine: a run that saturates every core makes the editor and the server sluggish for its duration.
- **A POOL'S PREMISE IS THAT CASES ARE INDEPENDENT, and four harnesses cannot use it at all** because their cases share ONE working tree and restore it between cases. **There is no assertion for this and there cannot be: it is a property of what the case does to the directory, and the harness knows it because it wrote the harness.**
- **ELEVEN NOW, AND TWO OF THEM ALSO LEAKED STDERR.** `execSync` inherits stderr by default, so a failing child's report went to the *parent's* stderr instead of into the captured `out` — half the output arriving out of band means no case could rely on `caughtBy`.
- **SEVEN OF THE ELEVEN USED `execFileSync('node', …)`, WHICH IS A DIFFERENT INTERPRETER FROM `process.execPath`.** A baseline and its mutations have to run the same machine to be comparable.
- **EACH CASE REMOVES ITS OWN TREE IN A `finally`, WHICH MATTERS ONLY BECAUSE OF THE POOL** — four live trees instead of 36.

**Background:** [`docs/incidents/checker-infrastructure.md#g7`](docs/incidents/checker-infrastructure.md#g7)

### G8. The Live Curve Is Drawn In The Species' Own Colour, And The Floor Is Not A Taste
`spectrum.html`'s live line and fill are `pokemon_data.json`'s own `rgb`, lifted only as far as the plot ground requires. `assets/js/species-ramp.js` holds the one function, and **it is a module rather than a line in the page because `speciesInk(rgb, ground, contrast, min)` takes the contrast ratio as a parameter**, so the checker can lift it out of its source and run it over all 1,025 records in bare Node. An import would have made that impossible, and reimplementing the ratio would have been worse than impossible.

- **The floor is 3:1 because this is a GRAPHICAL OBJECT, and 68 of 1,025 species need it.** 273 (26.6%) fall below 4.5:1. 3:1 is SC 1.4.11's figure and the curve's meaning is carried by its **shape** — the colour is identity. **Expect this shape: the check that reads like the guard is not the guard.**
- **The floor costs almost nothing, and the measurement that said otherwise was itself buggy.** Lifting the worst species is a 16-unit move; worst-case chroma retention 100%, worst hue drift 8.0°. An earlier draft reported a median lift of "100% white", which would have meant the lift destroys the colour and got the function deleted — it came from a white-mix written `c + (1-c)*t` on a 0-255 channel, i.e. mixing toward **black**. **The bug was in the measurement, not the method.** Steps are 2%, from `badgePair()` at `shared.js:293` — a binary search lands within a channel of the same answer but would be a second way to lift a colour toward a background in a project that already has one.
- **A FLOOR AND A CEILING ARE BOTH REQUIRED, because the hue check has a hole exactly where the defect is concentrated.** `hueOf()` returns null for a colour whose channels are equal and the lifted records are largely greys, so the hue assertion measures 0° and a lift that destroyed its colour sails through. The second ceiling is on **relative luminance** (≤ ×4), which does not care whether a colour has a hue.
- **The page states the ink it is about to draw (`data-ink`), and the browser checker measures the canvas against the statement.** Re-deriving it in the checker would compare two implementations of the same arithmetic and pass even when both were wrong. **THREE WRONG VERSIONS OF THAT PIXEL CHECK ARE RECORDED IN ITS SOURCE, because all three PASSED** — an unbounded projection (a canvas in a completely different colour counted 8,485 "matching" pixels), a 45-unit Euclidean band (too loose here because the ink and the panel are both nearly grey), and an idle-palette difference (which assumes the resting panel lacks the ink colour — **it does not**, because `drawLive()` runs on every selection). What remains is per-channel **±4** with the claim `> 0`, and the count is honestly variable (39–77 px across five runs) because it tracks where the curve sits.
- **The mel ramp is deliberately NOT species-derived, and that is a measurement rather than a preference.** The ramp's monotonic lightness **is** its accessibility contract. A single curve is an *identity cue*; a ramp is a *scale*, and **only one of those may change per selection.**

**Guarded by:** `check_spectrum_browser.mjs` measures the canvas against the page's own `data-ink`.

**Background:** [`docs/incidents/checker-infrastructure.md#g8`](docs/incidents/checker-infrastructure.md#g8)

### G9. The Graph Checker Failed 100% Pooled And 0% Alone, And Two Guesses Were Only One Of The Reasons
`check_graph_browser.mjs` failed **3 of 3** pooled and passed **3 of 3** standalone, with **three different symptoms across four runs** — which is what "flaky" looks like when nobody isolated the variable. Two causes, and fixing the obvious one did not fix the entry.

- **THE THREE FAILURES WERE ONE.** The file slept 500 ms after dispatching the search input; the page's search is a **150 ms debounce** (`graph.js:638`) competing with a 1,346-node rAF loop, so under tier B that timer lands late and the assertion read an empty list. The two assertions after it failed for the same reason — with no row, `.search-item?.click()` is a no-op. **A cascading failure prints as N independent reds, and only the first is worth reading.** The 600 ms before reading the dossier was worse than useless: **`renderDossier()` is synchronous** (`graph.js:452`), so there was never anything to wait for.
- **Both became POLLS ON A PRECONDITION, NEVER ON THE ASSERTION** (§3.B2's vacuity shape). The search waits for *a row to exist*, the dossier for *the id to equal the clicked row's*; what is asserted is still **which** row and **which** species. A poll waiting for `hits.includes('皮卡丘')` returns true on a correct page and times out on a wrong one — the same either way, which is to say it asserts nothing.
- **`-32000 "Inspected target navigated or closed"` SAID NOTHING ABOUT WHERE**, because every CDP call goes through one `send`. Two things made it answer: **`lastMethod`** (module scope, **never reset on success** — the most recently *issued* method is by construction the outstanding one, and the first version reset it to `(idle)`, printing that for exactly the failure it existed to describe) and **Chrome's stderr captured rather than inherited** (`stdio: [...,'pipe']`). What it said was **`CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670`**, repeated. **A display-link failure and a navigation are the byte-identical string, and nothing downstream could tell them apart.**
- **THE FIX WAS A SCHEDULING CHANGE, and `serial: true` is now the only such flag in the manifest.** §4's note that un-serialised tier B is fine argues from `cdpPort()`'s **overlapping ports**, which says nothing about CPU or GPU. §4 already accepts contention as a *cost* (`check_life_browser.mjs` is 5.1 s alone, 13 s pooled); this is a **failure**, and **a red that appears only when the pool's draw puts a second full-corpus WebGL graph beside it trains a reader that red can mean nothing.** Costs ~6 s of wall clock.
- **THE COST IS REAL AND WAS PAID DOWN, NOT EXPLAINED AWAY.** The harness went **32.8 s → 40 s**, and **the entire +6.8 s is ONE case** — the mutation that breaks the page — waiting out the 8 s search ceiling; the healthy path is unchanged at 6.1 s, and the first-guess 12 s/5 s ceilings measured **49.3 s**. A poll that cannot return early on a dead page is paid for on every dead page. **The message quotes the named constant or it quotes a lie** — the first version passed 8000 and printed `12000ms`, and the harness reads that string.

**Background:** [`docs/incidents/checker-infrastructure.md#g9`](docs/incidents/checker-infrastructure.md#g9)

### H. Category Pages vs. `types.html` — Two Different Questions
`category.html?cat=dragon` and `types.html?type=dragon` both exist and both list the same 70 species. **A category page must never link to `types.html`, and must never be merged into it.** Decided by the user when the Dragon page was added; do not re-propose the cross-link.

- A **category page** answers 「有哪些龍屬性寶可夢」 — a roster plus an introduction. Its `prose` and `notes` are this project's own zh-Hant editorial, which is the point.
- **`types.html`** answers 「龍屬性的招式、特性、道具、訓練家與相剋關係」 — battle mechanics, and the only place the effectiveness matrix appears. Its prose is upstream English by design (§3.D), so it is not a substitute for a zh-Hant introduction and must not be given one.
- Adding a "see also types.html" link would put a battle-mechanics page on the path of someone who asked a species question.

**Adding a category is a three-list edit, in this order:** `CATEGORIES` (append the config), `CATEGORY_SLUGS` (append the slug — a literal list, *not* `Object.keys(CATEGORIES)`, and `category.html` falls back to element `[0]` on an unknown slug, so **never insert at the front**), and `NON_HUB_SLUGS` or `COLLECTION_GROUPS`. All three are literal lists on purpose: `check_categories.mjs` asserts `CATEGORY_SLUGS \ HUB_SLUGS === NON_HUB_SLUGS` and hub order with `===` on the exact array, **so a category that reaches the hub by omission is impossible by construction. Appending is the only insertion that leaves both orders untouched.**

**Guarded by:** `check_categories.mjs`, which asserts the three literal lists are equal as written.

**Background:** [`docs/incidents/page-defects.md#h`](docs/incidents/page-defects.md#h)

### I. The Page/Module Boundary Had A Shipped Defect, And Nothing Could See It
`sorting.html` called `cryPlayer.muteForView()` in one commit; `assets/js/cry-player.js` did not define it until the next. **For the commits in between, every load threw a TypeError — and because the call sat about six lines ABOVE the listeners for every other control, the throw took all of them with it.** The page rendered, the race ran, and the controls were dead.

**ESM statically verifies the IMPORTED BINDING and says nothing about the member**, so the import was legal, the module loaded, and the defect was a runtime TypeError on a line no checker read. `scripts/check_page_module_api.mjs` is the guard: 314 bindings across 19 pages, 0.1 s. Three things about writing it are worth more than the checker:

- **THE PAGE SET HAD TO BE SELF-SELECTING** — derived from "imports from `assets/js`" rather than an exclusion list, so a new page is covered the moment it exists and `404.html` needs no exception.
- **A COMMENT IS A FALSE POSITIVE.** `sorting.html` reads "`cryPlayer.muted` reads and WRITES the site-wide `cry-volume` key", so scanning raw source reads members out of sentences about them. Comments and string literals are masked; template `${…}` holes are kept because those are code.
- **`GbApu` ASSIGNS NINETEEN PUBLIC INSTANCE PROPERTIES IN ITS CONSTRUCTOR**, so a member set built from method syntax alone reports every one of them missing. `this.x =` is collected too, **and the direction is deliberate: over-approximating turns a red line green, while under-approximating produces noise a reader learns to ignore.**
- **`export const cryPlayer = new CriesPlayer()` IS AN INSTANCE, NOT A CLASS, and that nearly shipped the checker blind** — resolving members from class exports alone returns nothing for the one binding this checker was written for, so `used` was empty and the assertion printed PASS having measured nothing.
- **THE ESCAPE WAS WRONG IN A WAY ONLY A MUTATION COULD FIND.** The member pattern was written `(?:\?\.)`, an optional literal `?` then a literal `.`, so it demanded the sequence `?.` that no ordinary member access contains. **`\?` is an ESCAPED LITERAL, not a quantifier — the quantifier is a second `?`.** Reading it does not surface that; renaming a method and watching the checker stay green does.

**Guarded by:** `check_page_module_api.mjs` — 314 bindings across 19 pages, 0.1 s.

**Background:** [`docs/incidents/checker-infrastructure.md#i`](docs/incidents/checker-infrastructure.md#i)

### J. Every CDP Checker Leaked A Chrome Profile, And 28 GB of tmpdir Proved It
Three of the **six** browser checkers that existed at the time removed their `--user-data-dir`; three did not, and nothing reported it. `tmpdir` held **3,229 entries and 28 GB**, of which 291 were Chrome profiles. **There are now seven browser checkers** — `test_check_sorting_page.mjs` was added and boots Chrome 25 times — so read "six" below as the count at the time of the incident, and §4's `browser: true` for the list today.

- **Cleanup is a `process.on('exit')` handler rather than a line at the bottom, because the bottom does not run when a check throws** — and a throw is exactly when the run is already going wrong.
- **REMOVING THE PROFILE WAS NOT KILLING THE BROWSER, AND THE TWO ARE NOT THE SAME ACT.** All six removed the directory on exit but only one killed its Chrome on any path but success, and it derived its debug port from the PID (`9400 + pid % 200`), so an orphan was not a slowdown but a **collision**: the next run's Chrome could not bind, `fetch(:dbg/json/list)` answered from the orphan, and the checker drove a browser whose profile directory the process had already deleted under it. All five now call `chrome.kill()` from the same `exit` handler, with SIGINT and SIGTERM mapped to it. **SIGKILL cannot be caught at all, which is the honest limit and the reason the port is printed rather than abstracted away.**
- **A LEAK THAT NOTHING REPORTED IS THE SAME DISEASE, and it was found by a machine running hot rather than by a checker.** An orphaned headless Chrome is a browser rendering pages forever, which is a thermal problem before it is a correctness one: `ps -Ao args | grep -c '[C]hrome --headless'`.

**CHECK FOR ORPHANS AFTER A TEST RUN — a clean run leaves zero, and on 2026-10-10 it left six.** Those six had `PPID=1`, had been up for up to 1 day 15 hours, and **four were holding the same port 9415**, because only one process can bind and the losers sit there anyway. Their `--user-data-dir` trees were never removed either; the machine's tmpdir held **2,885 directories and 11.5 GB** of this residue — 540 Chrome profiles, and 1,872 scratch trees from `test_check_color_palettes.mjs`, which leaked one per case under a prefix that does not appear until line 188 of the file. The checkers are fixed, the sweep is not:

```bash
# no check_* may be running first — killing a Chrome mid-run corrupts that run
ps -Ao args | grep '[C]hrome --headless' | awk '{print $1}' | while read -r p; do
  [[ "$(ps -p "$p" -o args=)" == *--headless* ]] && kill "$p" 2>/dev/null && echo "  TERM $p"
done
```

Two traps worth knowing: **zsh does not word-split an unquoted variable**, so `for p in $(…)` hands the loop all six PIDs as one argument and kills nothing while printing a confident `SKIP`; and the four-on-one-port case is why the raw count misleads. Deleting the residue means removing only directories containing `DevToolsActivePort` or `Default/` — **never the whole tmpdir, which other tools share.**

**An orphan is a CORRECTNESS defect, not just disk clutter, and `check_gen1_page.mjs` is the proof.** On 2026-10-10 it was reported failing 4 of its 74 checks: the playhead did not move, the play button did not reflect state, clicking a species did not play it, and a prose column measured 474 px against a 571 px measure. **Those four are the ones `cdp-port.mjs` records from the incident that created `assertPortFree()`**, and the cause was a window **1246×87** — the checker drove a stranger's browser, so every number it took was a real measurement of a page rendered 87 px tall. Sweeping the six orphans above was followed by `PASS 74 checks` on four consecutive forced runs. What that does NOT prove is which orphan caused it: `browserOnPort()` returns null on a timeout as well as on an empty port, so an unresponsive orphan reads as free, and the PID window means a collision is a ~1-in-120 coincidence per run rather than a standing condition. **The claim worth keeping is the narrow one — an orphan turns a checker into a confident liar, and the only defence is the port guard plus a zero count.**

**Background:** [`docs/incidents/checker-infrastructure.md#j`](docs/incidents/checker-infrastructure.md#j)

### K. life.html — Conway, Genetics, And The Evolution Gate
Four defects shipped, all of them green through the whole suite, fixed by one architectural move: **`evolution_levels.json` is the engine's topology, not just its level numbers.**

- **The wild encounter died on arrival 60% of the time, and the HUD counted it anyway.** `nextCells` was scanned for "any empty cell within 2 of a live cell", so a pack was born touching the soup — median 2 adjacent live cells — and Conway's rule is `count === 2 || count === 3`. **THE FIX IS A MOAT, NOT A SMARTER PACK:** `pickWildSite()` requires every pack cell *and a 1-cell ring* to be empty, re-rolls up to 500 times, and returns null otherwise — and null means **no encounter**: nothing placed, counter not advanced. Measured: median life 4 → **24** generations, alive at generation 400 4% → **57%**, partial-born 36–39% → **0%**. **The candidate origins are de-duplicated too** — "a random placement near X" is actually a two-step sample, and the first half of the distribution is invisible in the second.
- **Evolution is gated on the species' REAL in-game level, which is why the cell field is `level` and not `age`.** 348 of 489 pairs carry a real level (Lv.7–Lv.64); 141 are stones, trades, friendship or day/night, and those fall back to the **corpus median, Lv.30** (the alternative — "the level it learns its last level-up move" — has median **48** and max **85**). Evolution is now **strictly sequential**, because the old "stage 2 first, fall back to stage 1" ordering under real levels becomes a shortcut the games do not have. **Five pairs appear in both halves, and that is the games rather than a bug** — the real level wins, because a level *is* one of the two routes. The original assertion here was "no pair may overlap", which was the wrong question and would have failed on correct data.
- **`backdrop-filter` turns an inert `z-index` into a real one, and life.html was the only page it happened to.** `.life-toolbar` carried `position: static; z-index: 20` plus `backdrop-filter: blur(18px)`. On a static element the z-index does nothing — **but `backdrop-filter` creates a stacking context, which makes the number apply**, and the nav panel's `z-index: 120` is scoped *inside* that header context so it could never beat 20. Measured: **5 of 22 hit-test points resolved to the toolbar**, so the dropdown was unclickable across its top 55px. **Expect this shape wherever a decorative value on a non-positioned element starts meaning something** — `filter`, `transform`, `perspective`, `contain` and `will-change` each do it, and each looks inert in review.
- **THE EVOLUTION GRAPH IS THE EDGE LIST, NOT THE STAGE COLUMNS.** `stage` in `evolution_chains.json` is **DEX ORDER, NOT DEPTH** — its own generator comment says so, so a branching family is eight *siblings* presented as eight successive stages. Measured over every species × stage × generation: the stage-based path produced **208 evolutions with no real edge at all**. `evolution_levels.json`'s `unlevelled` field — **loaded by `setEvolutionLevels()` and never read** — was the topology all along. **Expect this shape whenever a table's meaning has quietly narrowed from "the graph" to "one field of it": the other field was already complete, and the reader of the narrow one never noticed.**
- **THREE OF THE FOUR FIXES WERE HAND-EDITS TO GENERATED FILES, and one was already RED.** `evolution_chains.json` stages 3..9 → all 2 (`check_evolution_chains.mjs` failed on the spot); `generations.json` gained `letsGoStarters`, erased by the next run with nothing noticing. Both reverted; the code now reads what it needs from data that is already checked. **Expect this shape whenever a feature cannot be derived: the fix belongs in the generator, and a key added to its output by hand has a lifetime of one regeneration.**
- **`nth-of-type(2)` RESOLVES TO STEP 1, AND A SCREENSHOT WAS THE ONLY WITNESS** — `nth-of-type` counts TAGS among siblings and only one sibling has the class, so the control that swaps the starter list rendered two sections above the cards it changes, while all 145 static and 24 rendered checks passed. Step 2 now has `id="stepStarter"` and the browser checker asserts the **box**.
- **ALL 26 ICONS ON THIS PAGE ARE NOW FILLED PATHS**, and they were lucide STROKE paths for one commit. `.icon` has `fill: currentColor` and nothing else, and `stroke` defaults to `none`, so they rendered as filled silhouettes — **a screenshot showed two labels as black blobs and a checker reading text content sees the same label either way.** The guard is a shape check **and** a browser check that rasterises each glyph and counts alpha, **because the shape check cannot tell a filled path from a stroke path that merely lacks its attributes.** **The glyph and the label must come from ONE boolean** — the play button drew a PLAY triangle beside 暫停 and PAUSE bars beside 播放, which survived only because each was written next to a label rather than derived from it.
- **The toast card ignored the theme.** The card's background was the dark theme's two tokens **typed out as literals**, so `.life-toast-icon` inherited `--text-primary` and painted near-black ink onto navy in light theme — **1.03:1 for the icon and 2.57:1 for the eyebrow**, both below WCAG's 4.5 and both invisible. **The icon is an `<img>`, and that is the point rather than a detail:** an `<img>` carries its own pixels and cannot inherit a theme at all, so the defect class is gone rather than mitigated. The wild cyan needed a per-theme value **because making the card themed is what created that** — measured against the **worse of the card's two gradient stops**, because a card that reads 3.5:1 on one end and 2.9:1 on the other is not a readable card.

**Background:** [`docs/incidents/life.md#k`](docs/incidents/life.md#k) (including the full K1–K5 measurements).

**Guarded by:** `check_life_page.mjs` (117), `check_life_browser.mjs` (61), `check_evolution_levels.mjs` (55).

### L. `outfit.html` Gains Two Ways In, And `new File([blob], name)` Silently Drops The MIME Type
- **`new File(parts, name)` DOES NOT INHERIT `blob.type` — the `type` option defaults to `""`.** So building a File from a `response.blob()` of a perfectly good JPEG handed it to the existing `loadFile()`, whose own guard read `!file.type.startsWith('image/')` and printed 「這不是一個圖片檔」 — about a file the same server had just answered `Content-Type: image/jpeg` for. No exception, no console output, and the thumbnail on screen was the very picture it refused. **Expect this shape anywhere a `Blob` becomes a `File`: the two look like the same object and share neither this field nor any other.**
- **THE PRESET ROW IS A SIBLING OF `.of-drop`, NEVER A CHILD, because the file input covers the zone.** `.of-file-input` is `position:absolute; inset:0` at `opacity:0`, so anything nested inside `.of-drop` sits *under* the input and never receives a click — and it looks correct in review because a thumbnail inside an upload box is exactly where a thumbnail belongs.
- **A PASTED URL IS NOT OURS TO DECIDE, AND THE PAGE SAYS SO IN THREE SEPARATE PLACES.** A static host cannot proxy, so `fetch` succeeds **only** when that server sends `Access-Control-Allow-Origin`. `loadUrl()` distinguishes four outcomes, because a bare CORS rejection is a `TypeError` whose message says nothing about the cause: not a URL, non-`http(s)` scheme (`javascript:` is the dangerous one), fetched-but-not-`image/*` (a 404 page, a paywall and a hotlink block all arrive as `200 text/html`), and CORS-blocked — the single most likely outcome and the only one the reader can act on.
- **ONLY THE REJECTION PATH IS CHECKED IN THE BROWSER SUITE, AND THAT IS THE WHOLE OF IT.** Asserting a *successful* remote fetch needs a second origin that sends CORS, and every checker here runs on one host — it would be asserting on Live Server's own behaviour. The checker therefore drives all four rejection states and says in a comment why the fifth is absent, **because "we didn't test the working case" is otherwise a thing a reader has to notice themselves.**
- **THE PRIVACY NOTE GAINED A CLAUSE, because the feature made the sentence less absolute.** 「照片不會離開你的裝置」 was true and load-bearing, and a URL fetch *is* a request that leaves the device.

**Background:** [`docs/incidents/page-defects.md#l`](docs/incidents/page-defects.md#l)

**Guarded by:** `check_outfit_page.mjs` (130 — which parses `SAMPLES` out of the HTML rather than restating it, so a hardcoded copy could keep passing after the page moved a preset), `check_outfit_browser.mjs` (119).

### M. An Author `display` Beats `[hidden]`, And The Obvious Fix For An Empty Card Does Not Work
`.of-readout` opened the page as an empty 40px card. **Putting `hidden` on the wrapper does not fix it**, and that is the whole finding: an author `display: grid` beats the user-agent's `[hidden] { display: none }`, because the UA sheet loses to *any* author declaration regardless of specificity. Measured in headless Chrome on the same box:

```
inline display:grid + hidden            -> computed=grid   h=0
stylesheet .g{display:grid} + hidden   -> computed=grid
stylesheet .n{display:none} + hidden   -> computed=none
```

So it needed `.of-readout[hidden] { display: none; }` — the fix `shared.css` already uses for `.site-nav-drawer[hidden]`, and the reason that rule exists there in the first place. **Expect this shape on any wrapper whose own `display` is not `block`:** grid, flex and `inline-flex` all silently defeat the attribute that every other element on the page relies on, and `element.hidden === true` still reads `true` while the box paints.

- **The guard asserts the COMPUTED BOX, not the attribute, because the attribute is the thing that lies.** The two halves are separately load-bearing: deleting the CSS rule while keeping the attribute reproduces **exactly** the 40px card, and deleting `els.readout.hidden` from `render()` trips the source gate. **A checker that only read `.hidden` would have passed both.**
- **THE WRAPPER IS WRITTEN INSIDE THE SAME CONTIGUOUS GROUP AS ITS CHILDREN, and the gate check pairs it.** §3.G's rule is that a comment between two sibling writes is enough to separate them; a wrapper is a fifth thing that must be hidden on every exit, so `els.readout` joined that group and the pairing became mutual rather than counted — **a path that hid all three sections but left the card's own border on screen would pass every other assertion in the file.**

**Guarded by:** `check_outfit_browser.mjs`, reading `getComputedStyle().display` and `getBoundingClientRect().height` on a fresh load.

**Background:** [`docs/incidents/page-defects.md#m`](docs/incidents/page-defects.md#m)

---

### N. `graph.html`'s Header Collapses To The Logo — And The Four Traps Around It
The nav is hidden by default: `graph.html` opens on the full-viewport 3D scene with **one 40px control in the logo's slot**, and the full row runs out on click. Three ways to close — the toggle again, a click on empty space, `Escape`. **The state is never persisted**; every visit starts collapsed, which is the point of a full-screen page.

- **`.header-3d` IS SHARED WITH `model3d.html`, so `shared.css` IS NOT TOUCHED.** Every rule hangs on a new `.graph-header` class. `check_nav_pages.mjs` also requires each header to carry exactly **one** `.header-*` row-layout modifier, read out of `shared.css` rather than restated.
- **The rule this replaced WAS DEAD.** `graph.css` carried a full `.header-graph` block matching **no page** (`graph.html` wore `header-3d`), so it could not be wrong in any way a run would notice. **A stylesheet rule for a class no page carries is a rule nobody is maintaining.** Renaming it to `.graph-header` makes it live — §3.G2's shape, one layer down.
- **Never declare `position` on this header.** `.header`'s `position: relative` is what anchors `.theme-toggle` (`absolute; right: 16px`, no `top`/`left`) to the header; `absolute` would resolve it against the viewport. The dead block said `absolute`, so copying it would have shipped a bug that never existed.
- **FORCED DARK IS ONE RULE BECAUSE CUSTOM PROPERTIES INHERIT.** `.graph-header` re-declares `--btn-*`, `--bg-card`, `--surface-hover`, `--text-primary` at the **dark** theme's values, which covers light theme for the whole subtree with **no `[data-theme="light"]` twin** — §3.B1's rule, add a page-prefixed rule and never restate a shared token. `--bg-card` is why the dropdown panel and mobile drawer are dark too, being children. Measured at `data-theme="light"`: chip `rgba(238,241,251,.08)` on `rgb(238,241,251)`. **Without those three `--btn-*` values a light-theme reader gets WHITE pills on a `#030712` starfield.**
- **THE HIDDEN GROUP IS SPLIT IN TWO AND THE SPLIT IS LOAD-BEARING.** `.theme-toggle` and `.site-nav-toggle` fade and never translate, because `.theme-toggle` is positioned by `transform: translateY(-50%)` — a transform drops it by half its 34px. That is the same reason shared.css's reduced-motion block does not set `transform: none`. And `visibility: hidden` is **not** a second copy of `opacity: 0`: a transparent chip is still in the tab order (§3.L). Measured: **0 of 21 nav links tab-reachable while collapsed.**
- **A FULL-WIDTH INVISIBLE HEADER IS A CLICK TRAP.** Collapsed, `.graph-header` is `pointer-events: none` and only `> *` opts back in, or every orbit drag starting in the top 55px is eaten. Same pairing as `.graph-open-btn` in this very file.
- **A CLICK ON THE CANVAS MUST NOT CLOSE THE NAV.** The stage fills the viewport, so 「click outside」 *is* the canvas — and a drag ends down+up on the same element, which the DOM reports as a `click`. `pointerdown` records where the press **started**; the click closes only if the pointer moved **under 6px**. **A press is a click; a drag is not.**
- **`open` IS INITIALISED TO `null`, NOT `false`.** `false` makes the setup call `setOpen(false)` compare equal, early-return, and never draw the first glyph — a blank 40px box on a page whose entire collapsed affordance is that button. Caught by screenshot, not by reading the source.

**Background:** [`docs/incidents/page-defects.md#n`](docs/incidents/page-defects.md#n)

**AND THE HAMBURGER CLOSED ITSELF IN THE SAME TASK IT OPENED — because a handler destroyed the click's own target.** `graph-header.js` answers a click on the toggle by rewriting the button's `innerHTML` (`toggle.innerHTML = iconSvg(...)`), which destroys the `<svg><path>` that was pressed. The click keeps bubbling to the document with an `e.target` that is **no longer in the tree — measured `isConnected === false`** — and the click-outside guard read `header.contains(e.target)`, which is `false` for a detached node by definition. An INSIDE click read as an OUTSIDE one: opened at 158 ms, closed at 158 ms. **§3.I inverted**: there a detached node does not bubble and the click is a no-op; here it bubbles perfectly and the *membership test* silently inverts. The guard now records `inside` at `pointerdown`, where the target is still attached — the same "the press is the fact, the click is a report" reasoning the 6px threshold above already uses.

**`element.click()` PASSES WHERE A REAL PRESS FAILS, WHICH IS WHY NOBODY NOTICED — and it is the same failure as §3.G4's stub, except the stub is the test harness.** Measured before the fix: **0 of 5 dispatched mouse clicks opened the bar, 5 of 5 `element.click()` calls did.** Two snapshots of the same click disagreed about whether the target was connected.

**Guarded by:** `check_graph_browser.mjs` now drives the toggle with **real `Input.dispatchMouseEvent` presses** at the button's measured centre, 3 open/close rounds plus the nav's computed `visibility`, and the three close paths the fix had to leave alone (a canvas click closes, an 80px orbit drag does not, Escape closes). **Reverting the guard fails 8 of those assertions** — verified by reverting the fix and re-running, because a guard nobody has seen fail is a claim rather than a check.

---

### P. `maze.html` Had No Checker At All — And Its Patrol Had Never Drawn A Path
**The page had ZERO coverage.** Nothing in the manifest mentioned the string `maze`, so a page with four solvers, two terrain modes and a four-leg patrol shipped through a 51-entry suite unread. Three defects, only one of which was visible:

- **THE MARKERS DESCRIBED A RUN THE PAGE WAS NOT DOING.** `drawMarkers()` called `endpoints()` and never `starPoints()`. Wall mode's S/G pair sits on legs **A's and B's goals**, leaving the shared start and legs C and D unmarked; terrain mode aimed at the **passable bounding box** while the patrol walked to the **literal** corners, so S/G sat on cells belonging to no leg.
- **EVERY SUCCESSFUL PATROL THREW.** `starRun` returned no `cost`; the page called `result.cost.toFixed(1)`, and the TypeError fired **inside a `requestAnimationFrame` callback** — so no hops stat, no run-log row, no status line, `run` never nulled, no path animation. The frame loop then spun on an exhausted generator forever. **The patrol had never drawn a path.** A return shape is a claim: `results.every(r => r.found)` does not imply `cost` exists.
- **ONLY THE LAST LEG WAS PAINTED**, because each leg cleared `searchVisited` on all 1,600 cells before it ran.

**`starRun` MOVED TO `maze-pathfinding.js` IS WHAT MADE IT CHECKABLE.** It lived in a `<script type="module">` block, so it could not be imported, so any assertion would have compared its **source** — §3.F's disease with the roles swapped. **THE MODULE NEVER TOUCHES `searchVisited`**, so rotating four `.next()` calls cannot change what any leg computes; that is the whole argument for the interleave, and the checker asserts both the round-robin and the absence.

- **`PATROL_LEGS` IS THE ONE TABLE the engine and the markers read**, so the four disc labels cannot drift from the four legs the way the hand-written S/G pair did. Legs that finish leave the rotation; **`legs` is rebuilt in `PATROL_LEGS` order, not completion order** — which is indistinguishable from a sorted result unless the corners are unequal distances, so the checker's grid puts the centre at `(1,1)` on a 7×7 where the corners are 2/10/6/6 hops apart.
- **`explored` IS THE UNION and `settled` is the total**, both printed. For a single run they are identical, so the run log's 探索 column keeps meaning "cells painted". **Reporting only the total is how a status line describes a number no reader can see.**
- **點亮整張圖 NEVER TOUCHES `onPath` or `searchVisited`,** so 復原 is not a re-run — and it hides the markers too, **with the `litAll` bail-out placed BEFORE the `runKind` branch** so the patrol's A/B/C/D cannot survive it. Measured on the live canvas by counting exact-token pixels: 41/40 → **0/0** lit → 39/38 restored, and 39/**178** for the patrol → **0/0** → 39/**178**. Both facts about the button are state, and state with four writers is the defect above, so `setLitAll()` is the only writer.
- **A LOAD IS THE PRODUCT OF TWO INDEPENDENT AXES** — which Pokémon, and which walls — each with its own 「固定」 toggle, **unchecked meaning 隨機 for both**. The species used to be random only as a *side effect of the field being blank*, which is indistinguishable from 「I left it empty on purpose」 and left a 「或指定」 label with no control behind it. `decideId()` and `decideSeed()` are the symmetric pair and **the id check moved OUT of `loadPokemonMaze`**, which used to own it: a loader that also guesses is a second source of truth for the question that decides what is on screen.
- **REVEALING A FIELD IS NOT THE SAME AS FILLING IT, and the difference only showed before the first load.** `placeholder="42"` is not a value, `decideSeed` reads `.value`, and nothing wrote there until a random load did — so checking 固定種子 first produced 「請輸入種子」 with no way for the reader to tell they had done anything wrong. After a load it worked, in every other position in the sequence. `bindAxisToggle()` now writes `seed` itself: **42 before anything is generated, the last random roll after.**
- **換種子 MUST NOT ROUTE THROUGH `decideSeed`:** in 固定種子 mode it reads the field, so the button rerolled the same maze (4242 → 4242, identical fingerprint) — found by the live probe, not by reading. **A button labelled 「換種子」 that does not change the seed is worse than no button.**

**FOUR OF THE CHECKER'S OWN 23 MUTATIONS STAYED GREEN, ALL FOUR VACUOUS** (a later round added 19 more over the two-axis and 點亮 work, all of which were caught). `/function setMode[\s\S]*?…/` **runs to end of file** and was satisfied by a call in a different function; **a lazy `[\s\S]*?return false;` is not a branch** and runs past the brace into its sibling; **an error-message string is not a range check** (`/1 到 999999/` survived deleting the comparison). Every shape assertion is now **brace-matched to its own block**. **A vacuous assertion in a brand-new checker is the same defect the checker was written to catch, and none of the four could have been found by reading it.**

**Background:** [`docs/incidents/page-defects.md#p`](docs/incidents/page-defects.md#p)

**Guarded by:** `check_maze_page.mjs` (211) — behavioural half executes `starRun` over 5×5 and 7×7 fake grids, shape half is block-scoped to the function it names. **23 mutations were run against it and four stayed green**, all in the two ways below. It is the **only** entry that covers maze.html.

---

### O. The Drawer Is A Column But Its Children Were Not — On Every Page
The mobile drawer rendered each group as a **748 × 366 px rounded pill** with its sub-menu crushed into a **120 px** column beside it. One line was missing, in `shared.css`, and it had been wrong on **all twelve pages** rather than only the one it was noticed on.

- **A `flex-direction` DOES NOT CASCADE TO THE FLEX ITEMS' OWN CHILDREN.** `.site-nav-drawer` sets `flex-direction: column`, which reorients the drawer's direct children. Each of those is a `.site-nav-item`, which is `display: flex` with the **default `row`** — so every grouped item laid its trigger out **side by side** with its panel. Measured at 900×800, **identically on `index.html` and `graph.html`**: trigger `left 16, width 748, height 366`; panel `left 764, width 120, height 366`. The trigger took the whole group's height because it is a stretched flex item, and the panel was squeezed until its rows wrapped. **Expect this shape on any container that is a column whose children are themselves flex.**
- **THE RULE BESIDE IT PROVES THE INTENT, which is how this was diagnosable at all.** `.site-nav-drawer .site-nav-panel { padding-left: 14px; border-left }` is meaningless unless the panel sits **below** its trigger. The author wrote the styling for a column and forgot the one declaration that makes it one.
- **THE FIX IS ONE LINE** — `.site-nav-drawer .site-nav-item-has-panel { flex-direction: column; }` — and it goes in **`shared.css`, not `graph.css`.** Measuring `index.html` alongside `graph.html` is what made that obvious: two pages with byte-identical numbers are a shared defect, and scoping the fix to the page it was noticed on would have left eleven pages broken and added a fourth header class to explain.
- **A 20px `--radius-pill` IS A CHIP RADIUS AND NOT A MENU-ROW RADIUS.** The drawer now uses `--radius-sm` (12px) and `padding: 10px 14px`, matching `.site-nav-row` one level down. A 20px radius on a 388px-wide element reads as a capsule, which is what 26 stacked capsules looked like.
- **`max-width: 420px` IS INERT BELOW 420px, WHICH IS WHY IT IS SAFE.** A phone is unchanged by it; a 900px tablet stops stretching every row to the full viewport. It is left-anchored on purpose — it hangs from the left edge under the hamburger that opened it — and the existing `box-shadow` separates the capped block from the page, so `border-bottom` does not have to reach the viewport edge.
- **A NON-SCROLLING BODY IS THE SECOND-HALF OF THIS, AND §3.N's PAGE IS THE SECOND PAGE THAT HAS ONE.** `body.graph-body` is `height: 100vh; overflow: hidden`, and `overflow` on the body propagates to the viewport, so **neither the page nor the drawer could scroll**: 1086px of drawer opening at y=55 in an 800px window, with **3 rows below the fold and no way to reach them**. `shared.css:1516` gave `max-height`/`overflow-y` to `.header-sort` on the stated grounds that sorting "is the one page whose body cannot scroll" — true when written, false now. The graph rule lives in **`graph.css` under `.graph-header`** and not by widening that shared selector, because **`.header-3d` is shared with `model3d.html`, which has not been measured for this.** Measured after: 720px tall, `scrollable: true`, and 「3D 模型」 confirmed `reachable: true` after scrolling to the bottom at 390×844.
- **A FORCED-DARK SUBTREE CAN BE INCOMPLETE IN ONE TOKEN.** §3.N forces `--btn-*`, `--bg-card` and `--text-primary` on `.graph-header`. `--hairline` and `--hairline-strong` are both derived from **`--hairline-rgb`**, so light theme's `15, 23, 48` was drawing a **dark hairline on the `#161e38` drawer** — and the rule it killed, `.site-nav-drawer .site-nav-panel { border-left }`, exists for exactly one purpose. **Overriding the derived value's INPUT fixes every consumer at once; overriding each consumer is how the list grows without anyone noticing which are missing.**

**Background:** [`docs/incidents/page-defects.md#o`](docs/incidents/page-defects.md#o)

- **AND THEN THE ACCORDION, WHICH REMOVES THE PROBLEM INSTEAD OF CONTAINING IT.** Scrolling to reach a menu's last row is a workaround for a menu that is too tall, and the drawer was 1130px because **all twenty sub-items were open at once**. The rule that forced that shipped with its own condition — *"the nav is short enough (4 items, 8 rows) that showing everything beats a broken accordion"* — and **the condition stopped being true when NAV grew to 6 items and 25 rows, while the rule stayed.** A justification is a claim about the present, not a decision recorded once.
- **`initNavDropdowns()` MUST SKIP DRAWER ITEMS, or the accordion inverts itself on touch.** A tap synthesises `mouseenter` **before** `click`, so hover opened the panel and `click` then read `panel.hidden` as true and closed it — one tap, no visible result. Skipped by `closest('.site-nav-drawer')`, **not** by a `.site-nav .site-nav-item-has-panel` selector, because a page that ever mounted the drawer without the desktop row would then get no handler at all and fail silently.
- **GROUPS TOGGLE INDEPENDENTLY, NOT ONE AT A TIME.** A classic accordion closes its siblings, which is right for a settings panel and wrong for navigation — a menu that closes the section you are reading reads as a mistake. The `max-height` stays as the safety net for opening all four.
- **Measured at 900×620: 1130px → 331px collapsed**, and every state fits without scrolling (331 collapsed / 481 one group / 540 two). Desktop hover, leave-to-close and Escape re-verified unchanged. `navItemHtml` already shipped `hidden` + `aria-expanded="false"`, so only the CSS override and one click handler were needed.

**Guarded by:** nothing — `check_nav_pages.mjs` asserts the drawer's **markup** (`<div class="site-nav-drawer" data-nav-drawer hidden>`) and not its **layout**, so a drawer that renders a 748 × 366 pill passes every check in the suite. **This is the second unguarded header rule in a row (§3.N), and both are the same gap: nothing in the suite reads a header's geometry.**

---

### Q. Terrain Cost Is Rec.709 Luma, And That Is A Decision, Not An Omission
`computeTerrainCost()` (`assets/js/maze-pathfinding.js:342`) is two steps and **no colour space at all**: `alpha < 50 → Infinity`, `luminance = 0.2126R + 0.7152G + 0.0722B`, `cost = 1 + (255 − luminance)/255 · (maxCost − 1)`. Hue and saturation are discarded. **Pure colours therefore have a fixed global order on every sprite** — measured at `maxCost = 6`: 白 1.000 · 黃 1.361 · 青 2.063 · 綠 2.424 · 洋紅 4.576 · 紅 4.937 · **藍 5.639** · 黑 6.000. Blue is dearest and yellow cheapest purely because Rec.709 gives green 71.5%, red 21.3% and **blue 7.2%**.

**THE REASON IS AN INVARIANT, NOT COLOUR SCIENCE.** Cost is a strictly monotonic function of the brightness the renderer actually draws, so **a reader can look at the grid and predict where A\* will go.** A model that diverges from the visible image breaks that promise *silently* — the page still shows the sprite, the numbers still print, and nothing says the two have come apart. For a page whose claim is 「看到的就是要付的」 that is a worse failure than a lumpy landscape. And luminance-based brightness is itself perceptual (Rec.709 is video's Y′), so the invariant and perceptual accuracy do not actually fight here.

**Measured over 33,143,750 pixels from 147 sprites**, cost at `maxCost = 6`:

| model | min | p25 | median | p75 | max |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Rec.709 luma (shipped)** | 1.000 | 2.219 | **3.148** | 4.144 | 6.000 |
| CIELAB L\* | 1.000 | 2.074 | 2.915 | 3.919 | 6.000 |
| OKLab L | 1.000 | 1.936 | **2.643** | 3.504 | 6.000 |

**THE THREE WEAKNESSES ARE NAMED IN THE SOURCE SO THEY ARE NOT REDISCOVERED AS BUGS.** Y′ is luma, not luminance, so the dark end is over-weighted — that is the whole of the median gap; cost steps are not perceptually uniform, because a 0.1 gap between two near-blacks is as big a *number* as one between two near-whites but only the second is visible; and blue is nearly invisible to the weights.

- **A. Keep luma.** The decision.
- **B. OKLab L.** Perceptually uniform, and `rgbToOklab()` **already exists** in `color-match.js` — whose docblock names this exact class of decision as the reason one conversion must have one implementation. Best evidence-to-effort ratio. Costs 1,600 conversions per contrast change, and makes 「what you see is what you pay」 approximate.
- **C. Slope / elevation.** `cost = 1 + k·max(0, h(next) − h(current))`, descending free. What game AI actually does, and the most interesting pedagogically, but a **redesign rather than a fix**: cost becomes a property of a *move*, 「路徑成本」 changes meaning, and `octileHeuristic`'s admissibility has to be re-proved rather than inherited.
- **D. Local contrast.** Charge only for change, so a flat pale wing is free and the map's *structure* is what costs.

**WHAT WOULD JUSTIFY MOVING OFF A** is evidence that a reader cannot predict the route from the image — not 「which model looks nicer」. Rec.709 fails that in the **darks**, not the light, which is where the interesting paths are.

**Expect this shape whenever a measurement is taken with a different implementation than the one under test.** An offline decoder was used to claim terrain endpoints could be an isolated cell, and the claim was **wrong** — re-measured through the page's own `drawImage`, **144/147 sprites are solvable with zero isolated starts**. Same sprite, same 40×40, opposite answer, because an area-average box filter treats a transparent pixel as a black pixel and Chrome's `drawImage` premultiplies. **The three that do fail are real and are a different defect:** their passable region splits into several components, and the bbox-corner rule puts start and goal in different ones (#904: start in 368 cells, goal in **1**), so the reader gets 「無解」 on a solvable map. The 9 sprites that genuinely fail are a **different** defect — see §3.T — **and a second probe of the same question got it wrong differently**, letting diagonal moves into impassable cells, which inflated every count it printed while leaving its conclusion intact. A scratch harness is a checker with no assertions. See [`#r`](docs/incidents/page-defects.md#r).

**Background:** [`docs/incidents/page-defects.md#q`](docs/incidents/page-defects.md#q)

**Guarded by:** nothing — the model is a constant, not a claim with a threshold. The corpus histogram above is a hand measurement; `check_maze_page.mjs` asserts that `computeTerrainCost` is still the single cost function and that the page reads its alpha threshold from the module.

---

### T. The Terrain Endpoints Were The Extent Of The Specks, Not Of The Pokémon
`computeTerrainEndpoints()` took the bounding box of **every passable cell**, then `findNearestPassable` at each corner. On a sprite with a detached fragment — Beautifly's wing tip, Flygon's wing, an anti-aliased speck on Overqwil — that corner is the FRAGMENT, and start and goal land in different components. **Measured through the page's own `drawImage` over 257 sprites: 9 (3.5%) report 「無解」 on walkable maps, zero isolated starts, and the start is CORRECT in all three named cases while the goal is not.**

- **THE SINGLE-RUN FIX IS SURGICAL, AND THE BLAST RADIUS IS WHY.** The old rule is tried first and returned untouched whenever `terrainReachable(start, end)` holds — **248 of 257 keep byte-identical endpoints and the fallback never runs.** The unconditional version was measured and rejected: it moves endpoints on **7.4%**, of which **10 sprites are currently working fine**. The fallback is correct **by construction** — the ring scan is restricted to the body, so both ends land inside it.
- **THE PATROL IS NOT SURGICAL**, because its semantics are unambiguous: its five points are *this Pokémon's centre and corners*, and a bbox over stray pixels is not that. Measured over 1,028 legs, the all-passable bbox leaves **28 legs unreachable on 22 sprites (8.6%)**; the body's bbox leaves **zero**.
- **`largestComponent()` LIVES IN THE MODULE SO ALL OF THIS CAN BE RUN**, and its tie-break is **scan order, first wins** — the strict `>` is the contract, because the alternative makes the result depend on where the scan started.
- **EXPECT THIS SHAPE WHENEVER A FIX IS DEFENDED BY A SINGLE NUMBER.** The first measurement here looked at patrol leg **length**, found no difference, and nearly argued against the change. The defect was leg **REACHABILITY**, which it never computed — a quantity with nothing to do with length. **Measuring the wrong quantity is worse than not measuring**, because the number says 「this fixes nothing」 with exactly the same confidence as a number that would have said the opposite.
- **AND EXPECT A SCRATCH HARNESS TO BE A CHECKER WITH NO ASSERTIONS.** `at(x, y)` returning a fresh object per call does not give a wrong answer, it gives **an unbounded loop** — `seen` is a `Set`, so membership is by identity. The first fixture did exactly that and the checker died with `RangeError: Set maximum size exceeded`.

**Background:** [`docs/incidents/page-defects.md#t`](docs/incidents/page-defects.md#t)

**Guarded by:** `check_maze_page.mjs` (211) — a fake 7×7 with a 3×3 body and a detached single cell, plus an **unfiltered** neighbourFn because `terrainNeighbours` filters impassable cells itself, which would otherwise leave `largestComponent`'s own guard untested.

---

### S. `color.html` Has No Header — And The One Line That Would Have Failed Silently Is The Mobile Menu Button
The frame is three columns and the viewport is the frame. Measured before the change at 1440×900: `.cp-shell`, `.cp-rail`, `.cp-panel` and `.cp-main` all at **y=55** and `.cp-scroll` **758px** against a 900px viewport, because a 55px `.header` sat above all three. After: all four at **y=0**, `.cp-scroll` **900px**. **The header carried nothing but the brand link** — `initColorRail` had already replaced the nav and the theme toggle — so the brand moved into the rail's top row, which is where the reference keeps it too (`collapsible-sidebar.tsx:205-218`; its root is `flex h-screen overflow-hidden` precisely because the logo lives in the sidebar).

- **THE BRAND NAME REUSES `.cp-rail-label` AND THAT IS THE LOAD-BEARING PART.** The existing `.cp-rail.is-collapsed .cp-rail-label { display: none }` is what hides the six characters, so the 64px rail needs **zero** new CSS for the collapse state. It is **not** `.header-title`, which is `28px` with a gradient text clip sized for a full-width header row: at 28px 「寶可夢演算法」 measures **~178px** against the expanded rail's 240px content box, which does not clear a 40px logo plus its 12px gap.
- **THE CASUALTY WAS ONE LINE, AND IT IS §3.I'S SHAPE.** The mobile button was mounted with `document.querySelector('.header')?.appendChild(openBtn)`. Below 768px `.cp-rail` is `display: none`, so that one 34×34 button is the **only** route to the site nav on a phone — measured at 390×844 at x=336, y=12. Deleting the header turns an optional chain with nothing behind it into a silent no-op: every phone loses navigation, nothing throws, nothing logs, and every other check in the file stays green. It is now mounted on `#cp-panel` behind an explicit `throw`.
- **`OPEN_BUTTON_MOUNT` IS A NAMED CONSTANT BECAUSE `check_color_page.mjs` READS IT** rather than restating the id. A hardcoded copy in the assertion is a second source of truth for the exact answer the assertion exists to police, and it goes stale in the dangerous direction. The same reasoning as `check_outfit_page.mjs` parsing `SAMPLES` out of the HTML, and `check_color_match.mjs`'s absence checks.
- **ABSOLUTE ON THE PANEL, NOT FIXED ON THE VIEWPORT** — and that was measured, not chosen for taste. The panel is present at every width (only the rail hides), the button is `display: none` from 768px up so the desktop frame is untouched, and the panel keeps `z-index: auto` so the drawer scrim (40) and drawer (50) paint above the button, which makes the *scrim* block a second tap rather than a z-index. Absolute beat a dedicated 34px flow row because the panel is 320px wide at **320 / 390 / 560 / 767px** and a 34×34 box at its top-right 8px in intersects **zero** leaf elements at all four.
- **`.cp-panel`'s ≤1023px BLOCK SAYS `position: static`, WHICH IS THE WRONG ANSWER NOW.** `static` hands an absolutely-positioned child the initial containing block, so `top`/`right` resolve against the **viewport** — §3.B1's shape, a declaration that looks right and places the element somewhere else. Above 1024px the panel is `sticky`, which is already positioned, so the two halves agree.
- **A DEAD DECLARATION THAT ONLY STARTED MATTERING WHEN THE BRAND ARRIVED.** `.cp-rail.is-collapsed .cp-rail-top` shipped in the same rule as three **row** flex containers under `justify-content: center`, on a block element, where it did nothing — the toggle only looked centred because it is `width: 100%`. Making `.cp-rail-top` a column box turned the dead declaration into a wrong one: `justify-content` on a column is the **vertical** axis. It is now `align-items: center`, separately. **Expect this shape whenever a rule's effect depends on a property of the element it names, and a later change gives that element a box type it did not have.**
- **THE CHECKER FOUND ITS OWN FALSE POSITIVE FIRST.** `/\.cp-panel[^{}]*\{[^}]*display:\s*none[^}]*\}/` failed on a rule that does not exist, because `colors.css` documents its decisions in prose that **names selectors** and `[^{}]*` walks out of a comment into the next rule. Every rule-shaped assertion now reads `css.replace(/\/\*[\s\S]*?\*\//g, '')`; `check_page_module_api.mjs` masks JS comments for the same reason, and the difference is only that here the false positive was in the checker written to catch the real thing. **Expect this shape on any assertion made of a stylesheet's raw text.**
- **TWO DEAD RULES DELETED, AND ONE DECISION NOT TO MAKE.** `.cp-app > .header` and the `.header-colors` padding override matched nothing once the header was gone — §3.N's `.header-graph` shape, a rule for an element the page never mounts. `.header-colors` still styles seven other pages and this touches none of them. **The 3px `--page-accent` did NOT move to the rail:** asked for explicitly rather than assumed, because hanging the identity line off the left column would put a rule across the top of a frame the request was to start at y=0.

**Background:** [`docs/incidents/page-defects.md#s`](docs/incidents/page-defects.md#s)

**Guarded by:** `check_color_page.mjs` — no `<header>`, no `.cp-app > .header` rule, the mount id read from `shared.js` and found in the markup, the mount behind a guard rather than a `?.`, the button and the rail's `display: none` in the **same** media query, the mount positioned at ≤1023px, nothing hiding the mount, and the collapsed top row on `align-items`. Plus 8 mutation cases; `test_check_color_page.mjs` is at **61**.

---

### V. `graph.html`'s 精選分類 Filtered A Pile, And The Reason Was Three Correct Lines
Pressing **超級進化** drew **93 sprites with 0 edges between them** and **超極巨化** 34, both scattered by `d3Force('charge').strength(-140)`. Measured with the filter's own predicate, over the induced subgraph:

| chip | nodes | links | components |
| :--- | ---: | ---: | ---: |
| 600族 · 御三家 · 究極異獸 | 30 · 81 · 11 | 48 · 140 · 60 | **1** each |
| 幻之 · 悖謬 | 23 · 20 | 12 · 8 | 11 · 12 |
| **超級進化 · 超極巨化** | **93 · 34** | **0 · 0** | **93 · 34** |

- **`graph.js:399-403` IS NOT THE BUG.** Keeping a link only when both endpoints survive is right — an edge to an undrawn node points at nothing. **Every `mega` and `gmax` link is `base → form`, cross-category by construction**, so filtering to the form category drops the parents and with them every edge. 600族 worked *because* its ring is intra-category; that is the whole difference between a chip that filters a web and one that filters a pile. **Do not "fix" this by keeping 1-hop neighbours in the filter** — it would report ~180 entities for a category of 93, and the badge would describe a set the reader never chose. The three families below are internal to one category each, on purpose.
- **A COPIED VALUE IS A PLAUSIBLE VALUE.** `build_graph_data.py` gave every form node its base's `types`/`generation`/`stats`, so `Charizard-Mega-X` drew as **Fire/Flying**. **17 of the 93 mega forms change type and 76 do not** — 82% of the defect was invisible and the visible 18% was the interesting part. A wrong type still colours the node and still passes the type filter. `scripts/fetch_form_stats.py` supplies the form's own values; **`/pokemon/{id}` and not `/pokemon-form/{id}`,** which has `types` but **no `stats` key at all**.
- **A 200 IS NOT EVIDENCE THAT A FORM EXISTS.** Id **10314** answers 200 as `meowstic-male-mega` — a different form, with Meowstic's physical stats on a different special spread. **Meowstic has never had a Mega Evolution.** The test is the form **name**. **The rejected check is the more useful half: `order == -1` looks disqualifying and is not** — measured across all 127 forms it rejects **79 legitimate ones**, because PokeAPI's `order` is a position in the species' own form list and every Gen 7/8 form sits at -1. Written, measured, deleted. **A heuristic that rejects two thirds of the truth teaches a reader to ignore it.**
- **`linkColors` HAD EIGHT KEYS FOR TEN LINK TYPES, and the fallback was `starter_trio`'s colour.** So **1,545 of 2,523 links (61%) rendered as `#38bdf8`,** indistinguishable from the starter-trio edge. `978` was the sum of `metadata.link_types`, which omitted `type_resonance` (1,025) and `dual_type` (520) — **the object claimed to describe the links and did not.** All thirteen types are now counted and coloured; the two background-weave types are drawn deliberately dim.
- **`check_graph_browser.mjs`'s placeholder assertion BECAME UNSATISFIABLE, NOT FALSE.** It read `!badge.includes('978')` — a negative check on one magic number — and correcting the copy to `2,687` meant the badge could no longer possibly contain `978`, so it began passing on a page whose JS never ran. §3.B2's shape exactly. It now **reads the placeholder out of the served HTML** and asserts the badge differs from it.
- **`graph.html`'s relation row carries both rows' worth of lookalike chips on purpose.** `超級進化` there is `base → mega` (93 edges across 1,346 nodes, pressable on its own); `超級形態屬性群` is `mega → mega`, invisible unless the category chip has removed the other 1,253 nodes first. Two rows that look interchangeable answer different questions.

**Background:** [`docs/incidents/page-defects.md#v`](docs/incidents/page-defects.md#v)

**Guarded by:** `check_graph_chip_network.mjs` (127 checks, ~0.1 s, static — the filter is three lines of arithmetic over `graph_data.json`, so a CDP checker would spend 6 s and a Chrome boot computing a connected-components count). It parses the chip list out of `graph.html` and `linkColors` out of `graph.js` rather than restating either (§3.S's rule), and asserts per chip that `links > 0` and the largest component clears a **50% floor**. **The tightest chip against that floor is 幻之 at 12/23 = 52%, and that 0.02 IS the finding** — one edge (#808→#809, the only bridge between its halves) from red. `超極巨化` is in `DECLARED_ISOLATED` with its reason (no Dynamax nodes or artwork exist — `find assets -iname '*dynamax*'` → 0) and **the checker fails if it ever gains links**, so the exception cannot outlive its reason. 15 mutations; 15 caught.

### W. `color-game.html` Is A Static Game, And Three Things On It Are Decisions Rather Than Ports
Ported from `pokemonpalette`'s `src/app/game/page.tsx` and `src/lib/game/`. **Nothing behind the reference's design was ported, because the reference is Next.js with accounts, leaderboards, a collection and a paid tier — and this site is static.** So each of the three interesting parts is a decision, and each is named below as one.

- **THE THREE HINTS ARE FIXED AND NOT SHUFFLED, and the category machine that preceded them was 40% of the port.** The reference picks from seven categories with a seeded shuffle and dedupes against the guess card's badges. Three fixed answers cannot collide with anything, so `remainingCategories()` and `learnFromGuess()` were deleted rather than left dormant — an exported function nobody calls is a second thing to keep right. **Slot 2 is the whole palette, not a further reveal after it** — and it is what `evolution_levels.json` was fetched for. **That fetch and `evolvesOf()` are gone**; `life.html` owns the table.
- **THE SCORE IS OKLAB BIDIRECTIONAL AND PERCENT-WEIGHTED, against the reference's sRGB channel sum.** The reference ranks by a hand-weighted per-channel distance, which is not a metric and can rank a palette closer that a reader sees as further. Colour distance is `color-match.js`'s problem and §3.B1's rule — one implementation, so `colors-generator.html` and this page cannot disagree about what 「接近」 means. **Nothing renders a percentage:** OKLab distance over a six-colour palette is not a 0–100 quantity, and printing one would invent precision the arithmetic does not have. The four share tiers are bands over the measured distribution, and `test_check_game_similarity.mjs` re-measures all four against the corpus.
- **THE THIRD HINT MASKS EVERY RUN OF THE NAME, LONGEST FIRST, and both halves of that are load-bearing.** 93 of 1,025 `descriptions.zh` state their own species outright; 38 more carry a fragment (Bulbasaur's line holds 種子, two of 妙蛙種子's four characters), for **131 of 1,025**. Longest-first is a **correctness** requirement, not a speed one — replacing occurrences one character at a time turns 噴火龍 into `ＯＯ龍`, because the 火 that 龍 needs has already been replaced. The two orders differ on **66** species. **Substrings are masked too, so over-masking is accepted on purpose:** under-masking is a leak, over-masking is a word the reader can still read.

**THE GUESS BOX HAS TWO AUTOCOMPLETE LAYERS BECAUSE NEITHER ONE ALONE SERVES THE STATED NEED** — 「知道是哪一隻，但打不出全名」.

- **The custom list matches on SUBSTRING, so `伊布` finds 水伊布.** A `<datalist>` matches on **prefix** and would find only 伊布. The custom list also knows which species are already guessed and can disable them; a datalist cannot express that without offering a value the reader cannot complete to.
- **The datalist is the only layer a phone's software keyboard will read.** The input was `autocomplete="off"` with no `list`, so there were **no** keyboard suggestions at all — the reader had to discover the dropdown. **It is built ONCE in `init()`**, never per keystroke: 1,025 options rebuilt on every `input` event is ~40 KB of DOM churn on the page whose whole premise is that the reader types a lot.
- **Enter's order is walked row → whole name → first row, and the middle one is the fix.** The substring scan matches *inside* other names — 水伊布, 雷伊布, 妖精伊布 all contain 伊布 — so "the first row" is dex order rather than what was typed, and typing 「伊布」 in full had a real chance of submitting something else. **`resolveExact()` is whole-string only and returns `null` unless the match is unambiguous**: a fuzzy fallback would submit a typo and spend one of four attempts. A miss reports 找不到「…」 and what would work, **because a silent no-op is indistinguishable from a broken field.**
- **Down/Up are not a nicety — a `<ul role="listbox">` with no arrow handling leaves exactly one row reachable.** They skip already-guessed rows and scroll the chosen one into view.

**THE FIRST HINT IS FREE AND THE NEXT TWO ARE NOT, and the asymmetry is the point.** The button used to be gated on `state.guesses.length === 0` — **invented during the port, not ported**: the reference disables on `!targetPokemon || revealedHints.length >= 3 || hintCooldown > 0` only. It also protected nothing, because **hints do not consume an attempt** (`guesses` and `hintsShown` are separate counters) and the count is printed in three places, so a three-hint round with no guesses reads exactly as loudly as one with four. A hint exists for the reader who knows nothing yet, so gating the first one inverts what the button is for. Only the FIRST is free — one click with no friction, then five seconds before each of the rest, which is not an anti-cheat but long enough that you look at what you already have.

**THREE THINGS THAT LOOKED FINE AND WERE NOT, all found by looking rather than by running the checker.**

- **THE COOLDOWN BAR WAS A DETACHED NODE FROM THE FIRST RENDER.** `renderHints()` wrote `els.hintBtn.innerHTML = …`, which destroys the `<span class="gm-hint-bar">` living inside that button — §3.I, the same shape as `graph-header.js` rewriting its own button. `els.hintBar` then held a node no longer in the tree, so every `hidden` and `scaleX` after the first reveal went nowhere and **the bar never appeared at all**. Nothing threw and nothing logged. The button and the bar are now permanent nodes and only the label's `textContent` is written.
- **THE HINT BUTTON WAS WHITE ON WHITE IN LIGHT THEME, and `--page-accent` IS A HEADER-SCOPED TOKEN.** shared.css defines it on six `.header-*` modifiers and nowhere else; this file used it **13 times in the body**, which is a *sibling* of the header, so nothing inherited. An invalid `var()` computes to the inherited value, so `color` was white from the body and `border-color` took `currentcolor`. It looked right in dark theme, where white on near-black happens to be correct — which is why it survived. **The fix is per-theme, not one value:** the `--rule-*` tokens are declared once in `:root` and so are identical in both themes, and **no single colour clears 4.5:1 against both a white card and a `#161e38` one** — white needs relative luminance ≤ 0.183 and the dark card needs ≥ 0.127, and no cyan in the palette lands in that band. `--rule-cyan` measured **1.92:1** on white. The pair used measures **5.36:1 / 8.55:1**.
- **`.gm-btn` AND `.gm-btn-hint` ARE BOTH ONE CLASS, so the winner was source order.** Carrying both put a filled `background` at `min-height: 40px` where the reference has a small outlined button. Two rules claiming the same properties is the bug, not the fix — it keeps one class and brought its own `:focus-visible`.

**AND A COUNT THAT STOOD IN FOR A CLAIM, WHICH FAILED ON THE GOOD CASE.** `check_color_game.mjs` asserted `delegated.size >= 4` on `closest('#id')` call sites — a smell detector for "no control is bound to a node a re-render can detach". Moving the hint button to a direct listener on a permanent node is **stronger**, and dropped the count to 3, so the check failed on an improvement — §3.B2's shape. It now counts **both** safe routes and resolves the binding from the `els` table, because "there is an `els.foo` line" is not "something listened to `els.foo`". The companion assertion requires the two `--page-accent` values to **differ**, since a single-value accent is the defect and an existence check would have passed the version that measured 1.92:1.

**`check_game_hints.mjs` (36) AND `check_color_game.mjs` (85) COVER ALL OF IT, and one of the 65 was WRONG ON ARRIVAL.** Enter's precedence is asserted as an **index comparison** over the keydown block — the only form that catches a reordering rather than merely the presence of three strings. The `!/A|B/.test(src)` assertion, "no edit distance anywhere near `resolveExact`", parses as `/A|B/.test(src)`: the alternation lands **inside** the literal, so the pattern became *the word `distance` anywhere in the file*, it matched `renderSlots` a thousand lines away, and it reported the field fuzzy when it is not. Grouped, with that reasoning left in the file.

**Guarded by:** `check_game_similarity.mjs` (101, plus 24 mutation cases), `check_game_hints.mjs` (36), `check_color_game.mjs` (85, which also re-checks §3.M's `[hidden]` pairing and §3.G's node captures).

---

## 4. Verification & Testing Commands

Run regression checks whenever modifying data structures, selectors, or color logic.

**`.cache/` IS THE SKIP CACHE, AND DELETING IT COSTS ONE SLOW RUN AND NOTHING ELSE.** `scripts/check_all.mjs` writes `.cache/check-state.json` — one content hash per checker over the files it declared in `inputs` (globs expanded first), plus the previous green run's duration and timestamp. Unchanged inputs mean the entry is skipped and reported with the cost it last cost. It is the whole reason a second full run is **0.0 s** rather than 87 s, and the gitignored ~10 KB is the cheapest performance work in the project. Three things about it are named because each is a way the mechanism can be green and wrong:

- **A FAIL never refreshes an entry**, so a `last 6.0s` is always a green run's measurement. A duration remembered from a failing one would be the one number on the page that does not describe a passing check.
- **`--force` exists for a checker that passed for a reason other than its inputs** — a missing Chrome, a stale server. The cache trusts the last green result on this machine and nothing else.
- **A FAIL is not a skip either.** Nothing is written on the failure path, so the next run re-runs it rather than remembering it as answered.

`.cache/recorded-inputs.json` is written only by `--prove-inputs`, and `.cache/algo-neg/` is a harness scratch tree rather than state — a leftover there means some run was interrupted, and deleting it is harmless.

**`node scripts/check_all.mjs` runs everything, and skips whatever cannot have changed.** The suite is **53 manifest entries run by hand — 38 checkers and 15 mutation harnesses** — (the 53rd is `check_graph_chip_network.mjs`, §3.V, added because 精選分類 had **no reader anywhere in the suite** — `check_graph_browser.mjs` is `manual: true` and `serial: true`, so it is both the most expensive entry and the one least likely to run) and they are not equally expensive: `check_gen1_apu.mjs` is 5.6 s of which 4.5 s is one pass over the 151-species corpus at 1,048,576 Hz (146,311,704 samples). **Measured on this machine: ~86 s of checker time cold, finished in ~60 s of wall clock now that the runner has two tiers, and 0.0 s of work when nothing relevant moved.** Over half of that cold run is headless Chrome — the 6 `needsServer` CDP checkers plus `test_check_sorting_page.mjs`, whose 25 cases each boot one — and 20% is four CPU-bound pure-Node entries. The other 42 entries total ~19 s, so a "slow suite" is really a handful of browsers. The four spectrum scripts add ~9 s cold, and two of them (`check_spectrogram_port.mjs` and its mutation suite) need the venv, so a machine without it skips those with the reason printed rather than passing.

- **There is deliberately no `--quick` flag on any checker.** `check_gen1_apu.mjs` already says why: "a supported way to skip the conformance comparison is exactly how it would stop happening." A flag is a promise the reader has to remember to keep. The skip lives in the runner, is derived from file CONTENT, and a skipped checker says so on its own line with the reason.
- **Every manifest entry gets ONE line with a time column, and the column makes three different claims.** `6.0s` is measured this run, `last 6.0s` is a cache hit reporting the previous green run's measured duration (stored as `${name}~` beside the key and the `@` timestamp), and `-` is a row that never ran — a missing script, or a CDP checker with no server on `:5500`. One `row()` helper emits all of them, because five call sites each padding their own column is five chances for the table to drift; it pads the detail but never truncates it, because an `ok` line must fit 56 columns while a skip naming the Runtime Server rule must keep that sentence whole. Two traps are named in the source: the durations live in a **non-cached region of the output's meaning, not in `budget`** — a cache hit's number is real but was not paid for this run, which is why the legend says so and the summary total still sums only what ran; and the cached value is read with `== null`, because `Number(null)` is `0` and would print `last 0.0s` for every entry written before durations were stored. A `▶` line precedes each run because `execFile` buffers — without it, the 10 s of `test_check_sorting_page.mjs` is a terminal that looks hung.
- **The input lists are PROVEN, not reviewed.** `--prove-inputs` runs each checker under `scripts/lib/record-inputs.cjs`, a CommonJS preload that records every repo file it opens, and fails if the recording disagrees with the manifest. Miss one file and the checker is skipped after that file changed, so the run is green having verified nothing — strictly worse than no cache, because it looks like coverage. A grep cannot answer it, for the reason `check_nav_pages.mjs` documents about `rg -l initHeaderNav *.html`. Two directions are both required: **read but not declared** (the dangerous one) and **declared but not read** (a typo or a checker that stopped reading something). Proven by breaking the manifest in a scratch copy — both fire.
- **It is a `-r` preload and not `--import`, and the difference is silent.** Node snapshots a builtin's ESM named exports when the module is first linked, so `import { readFileSync } from 'node:fs'` binds the ORIGINAL function and a patch applied by an `--import` module afterwards is never seen. Measured: with `--import`, `check_color_palettes.mjs` recorded five files and missed both JSON tables it plainly reads. A CJS preload runs before the main module is linked, so the same patch is picked up by every named import.
- **What is always in the key, whatever a checker declares:** the checker itself, the checker a negative harness exists to attack, every file in `scripts/lib/`, and `check_all.mjs` itself. Editing a checker therefore invalidates its own entry with nothing extra for a maintainer to remember, and changing the cache's own rules cannot reuse entries the old rules produced.
- **Two checkers are honestly unverifiable and say so on every run.** `check_gen1_page.mjs` and `check_cries_browser.mjs` open NO repo file — their pages arrive over HTTP from Live Server — so their input lists are read off the HTML by hand. That is the weakest claim in the manifest and it is printed as such rather than hidden behind a green tick. The recording is what *establishes* that they touch nothing, rather than a comment claiming it.
- **`check_spectrogram_port.mjs` prints `SKIP` and EXITS 0 when `../.venv` is absent**, so a machine without Python reports that entry as green. Read the line, not the exit code, when the venv matters — the same reason §3.G5's audit lives in the runner rather than in a fixture.
- **Also named, because each is a way this can be green and wrong:** a file read only on a branch NOT taken during the recording is not seen (mitigated by the checker's own hash being in the key); existence probes are keyed on `path:size`, not content; files over 256 KB — the cry corpus, the GLBs — are keyed on `path:size:mtime` rather than content; and the cache trusts the last green result on this machine, so `--force` exists for a checker that passed for a reason other than its inputs.
- **Groups are `algo`, `color`, `cry-apu`, `cry-data`, `cry-page`, `data`, `model`, `nav`, `sort`, `type`** — ten, not eight. `--skip=cry` covers `cry-apu`/`cry-data`/`cry-page` without naming them; `--only=`, `--force` and `--no-cache` also work. `node scripts/check_all.mjs --help` prints them with each group's last measured cost, so the runner can be asked what it costs rather than read to find out.
- **The runner runs TWO TIERS, both pooled at three — and one Tier B entry is flagged `serial: true` and opts out.** Tier A is the 44 entries not marked `browser: true`; Tier B is the 9 browser entries, of which **`check_graph_browser.mjs` runs alone**. Both go through `lib/pool.mjs` and both print **after the drain, in declaration order** — §3.G7's contract, because an order that follows the scheduler cannot be diffed between two green runs. **The two halves of Tier B are RE-INTERLEAVED into declaration order before printing, and that is load-bearing**: printing the serial half before the pooled half would make the report depend on which entries carry the flag — §3.G7's contract obeyed inside each half and broken across them. The serial half runs first so it is never idle-waiting on the pool. Tier B used to be serial throughout: see the next two bullets for why that stopped being true, and why one entry came back. Measured: **~99 s of wall clock became ~68 s**, while the reported checker time went *up* by about 10 s, because concurrent browsers contend (`check_life_browser.mjs` is 5.1 s alone and 13 s in a pool of three). **The two numbers are different claims and the legend says so** — read the wall-clock figure, not the total, when you are waiting for one.
- **`serial: true` EXISTS FOR ONE ENTRY, and the §4 note that un-serialised Tier B is not evidence it does not apply.** `cdpPort()`'s pid-derived windows overlapped, which retired Tier B's serial run — that argument is entirely about **colliding ports** and says nothing about CPU or GPU. `check_graph_browser.mjs` measured **3 of 3 failures pooled and 3 of 3 passes standalone**, same tree, same server, same machine; Chrome's own stderr says why (`CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670`, repeated, on a 1,346-node page at 60fps) and the CDP side reports it as the **byte-identical** message a real navigation produces. §4 already accepts contention as a *cost*; this is not a cost, it is a **failure**, and **a red that appears only when the pool's draw puts a second full-corpus WebGL graph beside it trains a reader that red can mean nothing.** It costs ~6 s of wall clock, and the harness beside it stays pooled because it serves a trimmed fixture. **The fix was verified both ways — 3 pooled failures on a `git stash`ed clean tree — because "it passes now" is not evidence of anything.**
- **`browser: true` is a seventh `needsServer`-shaped flag, and the two sets differ by one.** Six entries need the Runtime Server. Seven are browsers. The extra is `test_check_sorting_page.mjs`, which boots Chrome 25 times without needing the server — so a split keyed on `needsServer` would have put the single most expensive harness into the pool.
- **NO CHECKER USES A COMPUTED DEBUG PORT ANY MORE, so `assertPortFree()` is GONE and Tier B can be parallel.** Every browser launches with `--remote-debugging-port=0` and reads the number back from `<profile>/DevToolsActivePort` via `waitForDebugPort()`. The OS assigns a port nothing else was given, so the collision class is deleted rather than tolerated. This matters because `cdpPort()` — `base + (pid % 120)` — overlapped: **20 of its 21 base pairs**, once the 120-wide window is counted, and a collision was a ~1-in-120 flake per pair that `assertPortFree()` turned into a loud abort. Retiring it is a **net gain**, not a removed guard: its job was to stop a checker driving a browser it did not start, and §3.J's orphan incident becomes unreachable rather than merely unlikely. **Two schemes were tried first and both were worse than the pid-derived one**: an explicit `9600 + index` is deterministic, so one interrupted run poisons that index for every later run. The history is in `waitForDebugPort`'s docblock.
- **`--only` is a PREFIX MATCH and is REPEATABLE**, and it was silently neither-correct-nor-wrong until recently: `flagValue()` used `argv.find`, so `--only=a --only=b` ran only the first group and reported a clean `0 failed`. The failure mode is the point — nothing said a group had been ignored. `--only=a,b` and `--only=a --only=b` now select the same entries.
- **Six entries need the Runtime Server and six are `manual`.** `check_cries_browser`, `check_gen1_page`, `check_spectrum_browser`, `check_life_browser`, `check_outfit_browser`, `check_sorting_page`. **The runner probes with `CRY_PORT` only, while those six honour `CRY_PORT`, `LIFE_PORT`, `SORT_PORT` and `OUTFIT_PORT`** — so overriding one without the others leaves the probe disagreeing with the checkers it is gating.
- **THE PROBE MUST NOT BE `fetch()`.** A liveness probe wants no connection pool: `fetch` runs on undici, which holds the socket open for keep-alive, and an open socket keeps the event loop alive. Measured, same URL and same 1.5 s ceiling: **`fetch` finished its work at 31 ms and exited at 6033 ms; `http.request` with `agent:false` exited at 29 ms.** The symptom looked like a broken skip cache — a fully-cached run took 6.5 s of wall clock to do 0.09 s of work. It also must not read `res.ok`, which is a `fetch` `Response` property and `undefined` on an `IncomingMessage`: that version answered false against a live server and skipped all six browser entries without reporting an error.
- **`.cache/check-state.json` can hold MORE KEYS THAN THE MANIFEST HAS ENTRIES.** A retired entry is left behind on write, because the write path copies the previous state and adds to it. `--help` reads the same `~` durations, so a ghost is a cost figure on the page for a check that no longer runs.

### RUN THE CHECK YOUR CHANGE NEEDS, NOT THE SUITE

**There is a mechanism for this and it is `--only=`, and the reason it exists is arithmetic.** A full cold run is ~87 s across 52 entries. A quarter of that was nine mutation harnesses running one child process at a time, all of which §3.G7 pooled or removed. The skip cache already handles the *second* run — 0.0 s when nothing relevant moved — so what is left unhandled is the first run after an unrelated edit, and the answer to that is not "run less often", it is "run the group that covers the file".

**The mapping below is by WHAT YOU EDITED, not by group, because a group is an implementation detail and a file is what you have in your hand.** Each row is derived from the `inputs` lists in `check_all.mjs`, which is why `--prove-inputs` matters: a missing entry there is a file whose checker would be skipped after that file changed, so the first column is a claim and not a convenience.

| you edited | run this | why this and not that |
| :--- | :--- | :--- |
| `spectrum.html`, `spectrum.css` | `--only=cry-page --only=cry-data` | the spectrum page's claims are split across a CDP checker, a page checker and the port checker |
| `cries.html`, `cries-gen1.html`, `cry-player.js`, `gb-apu.js` | `--only=cry` | `cry` is the prefix for `cry-apu`, `cry-data` and `cry-page` |
| `sorting.html`, `algo.css`, `sort-run.js`, `sorting-algorithms.js` | `node scripts/test_check_sorting_page.mjs --static` first, then `--only=sort` | the static half is 65 checks at ~0.5 s and catches the stylesheet contract; the browser half is a real page and costs 7.6 s |
| `colors*.css`, `color-palette.js`, `color-match.js`, `colors-generator.html`, `mmcq.js` | `--only=color` | 13 entries, and **nothing above 2.3 s** — this group used to be one 42 s harness and is now thirteen small ones |
| `maze.html`, `maze-pathfinding.js`, `algo.css` | `--only=algo` | four entries, and only `check_life_browser.mjs` costs anything — **§3.P.** This row is new because the page had **no checker at all** until then, so the mapping itself was missing rather than the entry |
| `sv-index.js`, `sv-sources.json`, `types.html`, any `assets/images/**` | `--only=type` | |
| `graph_data.json`, `graph.js`, `graph.html`, `data-sources/pokeapi_form_stats.json` | `--only=model` | **§3.V.** the static chip checker is 0.1 s; the CDP checker and its 40 s harness are `manual`/`serial` and only needed for a layout question |
| `shared.js`, `shared.css`, any `assets/js/*` | `--only=nav` **plus** `--only=color` | `shared.js` is read by `check_page_module_api.mjs` over every page, and by the nav checker. It is also the one file whose glob coverage matters: `assets/js/*` is declared as a glob because harnesses copy the whole directory |
| `*.json` under `assets/data/` | the group that owns the table, not `data` | `data` is four cheap checks over learnsets, categories and evolution. The cry tables are `cry-data`, the palettes are `color` |
| anything in `scripts/` | `--force --only=<its group>` | editing a checker does not invalidate a cache entry that was written before, and `--force` is the only way to be sure |
| **a file that is in no row above** | `--help` first, then `--only` on what it names | `--help` prints every group with its last green cost, sorted cheapest first, so an unlisted file is a 3-second question rather than a guess. If it is still unclear, `--prove-inputs` names the checkers that read it (see below) |

**AND IF YOU ALREADY KNOW YOU ONLY NEEDED ONE GROUP, RUNNING THE WHOLE SUITE IS STILL CHEAP.** The skip cache is content-keyed, so a second full run is 0.0 s and even the first one after an unrelated edit only pays for the checkers whose declared `inputs` actually moved. `--only` is for the case where you want the answer *now* rather than after 87 s of waiting; it is not a correctness measure, and `--force` on a group you did not touch buys nothing.

**`--only=cry` IS A PREFIX MATCH, NOT A LIST, and that is why it is the right default.** `inGroup()` tests `group === f || group.startsWith(f + '-')`, so `--only=cry` picks up three groups and `--skip=cry` drops three, without anyone maintaining a fourth list of what "cry" means.

**WHAT NOT TO DO.** There is no `--quick`, and §4's rule says why: a flag that skips a check is a promise, and the promise is what stops being kept. When `test_check_gen1_apu.mjs` had to come out of the suite, it came out by being **removed**, with the file left runnable and the cost of the removal written down — not by a flag. If a check is too slow to run, the two legitimate moves are to make it cheaper (§3.G5's fixture and pool work) or to take it out of the manifest and say what is no longer proven.

**AND WHEN YOU DO NOT KNOW WHICH GROUP OWNS A FILE, ASK.** `node scripts/check_all.mjs --prove-inputs` answers "which checkers read this file" from the recording rather than from a guess, and it is the same recording that keeps the cache honest. A grep cannot: `rg -l initHeaderNav *.html` lists `sorting.html` because its import names the symbol, and two other pages only because they mention it in a comment.

**Know what a group costs before choosing a filter.** Measured from one forced run after both tiers were pooled, and the column carries a **tier** because it does not predict wall clock: three entries of a tier are in flight at once, so their durations overlap and the total exceeds the clock you wait for. **139 s of checker time over 51 entries finished in 77 s of wall clock** (68 s before `check_graph_browser.mjs` was given `serial: true`, which is what that +9 s bought). A group is not a share of your wait unless it is the only thing you ran.

| group | secs | entries | tier | where its time goes |
| :--- | ---: | ---: | :---: | :--- |
| `model` | 46.2 | 4 | B | `test_check_graph_browser.mjs` 40 s — four cases, each its own tree and its own ephemeral port, and **Chrome's boot and a fresh `--user-data-dir` are what cost, not the WebGL build**: a trimmed 120-node fixture changed nothing measurable. **It was 33 s before §3.G9's poll fix and the +6.8 s is ONE case** — the mutation that breaks the page — waiting out the 8 s search ceiling; the healthy path is unchanged at 6.1 s. `check_graph_browser.mjs` is ~9 s (the header toggle's real-mouse section added ~3 s) and is **`serial: true`**, so it does not overlap with the harness. `check_graph_chip_network.mjs` and `check_glb.mjs` are 0.1 s each |
| `color` | 22.2 | 13 | B | `check_outfit_browser.mjs` ~7 s (CDP) carries it; the other twelve are each under 2.3 s. `test_check_color_match.mjs` was **42 s** and is now 2.3 s — see below |
| `sort` | 20.3 | 2 | B | `test_check_sorting_page.mjs` 13 s and `check_sorting_page.mjs` 8 s — the harness's cost IS the checker's full baseline, so it tracks it one-for-one. **Both are browsers** |
| `cry-page` | 20.2 | 8 | B | `check_spectrum_browser.mjs` 5.7 s, `check_cries_browser.mjs` 5.1 s, `check_gen1_page.mjs` ~4 s — all CDP, and §3.G5 already removed their sleeps. `test_check_spectrum_page.mjs` is 4.0 s of it and is NOT pooled for §3.G7's reason: each case copies a 2.8 MB `pokemon_data.json` |
| `algo` | 10.2 | 4 | B | `check_life_browser.mjs` is the group (CDP, needs :5500); the three static halves are 0.1 s each, the newest being `check_maze_page.mjs` (§3.P) **It is 5.1 s alone and 13 s in a pool of three** — the clearest single illustration of why the wall-clock figure is the one to read |
| `cry-data` | 8.4 | 8 | A | `test_check_cry_index.mjs` 4.7 s, then `test_check_spectrogram_port.mjs` 1.4 s (was 5.0 s before §3.G7) |
| `cry-apu` | 5.6 | **1** | A | `check_gen1_apu.mjs` alone, 4.5 s of it one pass over the 151-species corpus. Its 39-case harness is no longer an entry — §3.G5 explains what was traded for it |
| `nav` | 4.5 | 5 | A | `test_check_nav_pages.mjs` 1.6 s, **`check_js_syntax.mjs` 1.7 s — almost all of it one `node` spawn per `<script>` block, 38 of them, because that is the only route to V8's own line numbers. A `vm.SourceTextModule` version would be 0.2 s and was declined: it throws SyntaxError with no `lineNumber`**, `check_page_module_api.mjs` 0.1 s over 314 bindings in 19 pages |
| `type` | 3.0 | 4 | A | `test_check_sv_index.mjs` 2.9 s, was 22 s when it copied 2,250 images into a tree per case |
| `data` | 0.4 | 4 | A | `check_learnsets.mjs` 0.2 s |

**Tier A is ~43 s over 44 entries and tier B is ~96 s over 9** (one of which is `serial: true` and cannot overlap with anything) — which is the shape that makes a pool worth having and worth bounding. **Of the ten most expensive entries, nine are browsers**, and §3.G7 removed every harness-shaped cost that was removable; what remains is Chrome itself.

**WHAT IS LEFT IS ONE ENTRY.** `test_check_graph_browser.mjs` at 40 s is now larger than every other entry combined, and its cost is four sequential Chrome boots. The two ways to cut it are to drop a case (four to three buys about 8 s and gives up a proven assertion) or to reuse one browser across the cases, which needs the checker to accept an external Chrome. Neither is done. Everything else in the suite is 63 s of work in 35 s of clock.

**What is left is a browser or it is the APU.** Of the ten most expensive entries, five are CDP checkers or the sorting checker, one is `check_gen1_apu.mjs`'s 151-species corpus render, and the rest are harnesses whose cost is one browser boot each. §3.G7 removed every harness-shaped cost that was removable; what remains is the work itself.

**A mutation case is only as expensive as the thing it is attacking**, and that is now the whole question when a harness looks slow. `test_check_color_match.mjs` went **42 s → 2.2 s** across two commits, and neither commit was about a hard case — both were an unexamined default. The first was that its 28 cases ran sequentially (§3.G7). The second was that the checker it attacks spent 1,118 ms of its 1,310 ms scanning all 4,545 corpus colours to re-derive a frequency that has not moved since the corpus was 6,148 colours; the figure is now a pinned `6`, and the rule it documents is still exercised by the `#20317b` assertions beside it. `test_check_sv_index.mjs` went 22 s → 3 s because it copied 2,250 images into a fresh tree per case.

**So the question to ask of a slow check is "what is this actually computing?", and the answer is usually in the profile rather than in the code.** Timing each `check()` individually found the one that mattered in a second; the section headings said `primary-first ranking`, which reads like arithmetic on a few species and is in fact a full-corpus sweep. §4's rule about a checker that prints a description whether it passes or fails has a sibling here: **a check's name is a claim about its cost, and the name is not evidence.**

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
- **Meaningful Messages**: State what changed, why, and any specific metrics or design choices involved.
- **NO `Co-Authored-By` TRAILER, AND THE EXACT STRING IS NAMED HERE ON PURPOSE**: commit messages end after the prose. Do not append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`, or any `Co-Authored-By:` / `Generated with:` / `Signed-off-by:` line, or any other trailer that credits a tool. **This is not a style preference — the string is written out because an agent's own instructions may tell it to add one, and "my runtime said so" is exactly how it gets here.** On 2026-10-10 all 22 commits carrying that trailer were rewritten to remove it, and the rewrite touched every SHA in the repo, so the cost of getting it wrong is not one commit. The history is the user's alone; an agent's contribution is legible from the diff without being signed.
