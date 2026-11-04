# 寶可夢演算法 — AGENTS.md

> **Environment Requirements**
> - **Python Virtualenv**: `/Users/jiejiefu/Documents/Visual_Studio_Code/.venv` (i.e. `../.venv` from the repo root; a repo-local `.venv` also works)
> - **Execution Style**: `i-have-adhd` (High scannability, concise chunks, explicit bullet points, actionable commands)
>   - This project is developed with **opencode**. Every session must load the `i-have-adhd` skill before the first reply and keep its formatting for the whole session, without waiting to be asked again.
>   - The trigger is the user naming the skill at all — e.g. typing `skill：i-have-adhd`, 「使用skill」, or just「使用skill」with no argument. Treat any mention of「使用skill」 as a request to load `i-have-adhd` specifically, since it is the only skill this project pins.
>   - It turns off only when the user says「stop adhd mode」or「normal mode」, confirmed in one line. Nothing else — a topic change, a new task, a mode change in the harness — does not turn it off.
> - **DO NOT RUN BROWSER CHECKERS UNLESS THE CHANGE DEMANDS THEM.** This machine cannot absorb them; a headless Chrome is a browser rendering pages forever, and §3.J's incident was a machine running hot long before anything was wrong.
>   - **Run the affected checkers BY NAME, not a group.** A tier-A entry is 0.1–2 s of pure Node. When the edit spans a group use `--only=<group>`; **never run `check_all.mjs` bare** — a cold run boots thirteen browsers. Costs: §4.
>   - **When a browser checker is genuinely the right tool, run it alone**, never inside a group: one Chrome, one page pair, no pool contention.
>   - **One run is the evidence** — a second run measures the environment, not the fix.
>   - **After a browser run, sweep orphans** — a killed run leaves headless Chrome alive, which is a correctness defect, not disk clutter (§3.J). Command and the zsh trap: `README.md` §Installation.
> - **Runtime Server**: HTTP only; `file://` fails on CORS for JSON and images.
>   - **One server: port 5500** (VS Code Live Server or `python -m http.server 5500`). **Do not start a second one on a fresh port** — `http.server` reparents to launchd and keeps the port forever.
>   - **Port 8000 is not this project** (`uvicorn` for `~/Documents/Opencode/tw_stocker`). Audit command: `README.md` §Installation.

---

## 1. Project Overview

**寶可夢演算法** is a static, zero-build HTML/CSS/JavaScript web application (GitHub Pages compatible) visualizing computer science algorithms and design tools using 1,025 Pokémon.

### Core Pages

**28 pages, one rule per page in §3.** `moves.html` → §3.AA, `team.html` → §3.AD, `index.html` → §3.Z, and so on; a page with no §3 letter has no page-specific invariant.

The page inventory lives in two places already, so it is not repeated here:

- **What each page is:** `README.md` §Core Pages & Modules / `docs/README.zh-TW.md` §主要頁面說明.
- **Page → module → stylesheet, all 31 HTML files:** `docs/ARCHITECTURE.zh-TW.md` §5.

---

## 2. Directory Architecture

```
pokemon-algorithm/
├── assets/          css/ · js/ · data/ · cries/ · drums/ · glbs/ · images/
├── docs/            incidents/ — the receipts behind §3, one file per area
├── scripts/         verification: check_*.mjs · test_check_*.mjs · lib/
│                    data pipeline: *.py   (two layers, explained below)
└── data-sources/    raw CSV/XLSX + per-id provenance (never fetched at runtime)
```

`assets/video/` holds the nine generated hero loops (29 MB) and the nine stills cut from them (1.0 MB), all tracked and mounted by `index.html` (§3.Z); `make_hero_video.py` regenerates both. `assets/drums/` holds 397 WAV samples (28 MB) and the `strudel.json` map `cry-studio.html` loads — third-party audio, tracked because the page is silent without it (§3.AF).

**No `package.json`, no `node_modules`, no build step, and no CI.** Zero npm dependencies is a property, not an oversight: Node is invoked only as `process.execPath` and every helper lives in `scripts/lib/`.

**Never hand-edit a generated file.** `assets/js/` and `assets/data/` outputs, plus the nine videos, have a one-regeneration lifetime — a key added by hand is gone at the next run. The generator → artifact table and the file-count breakdown live in `docs/ARCHITECTURE.zh-TW.md` §7.

**`scripts/` is two unrelated toolsets**, separated only by filename prefix: 103 verification files (64 `check_*.mjs`, 28 `test_check_*.mjs`, 1 standalone, 10 in `lib/`) and 36 `*.py` generators, run by hand in §5's order and never by the suite. `docs/ARCHITECTURE.zh-TW.md` §8 carries the inventory and why a subdirectory each is not free. **Every file in `scripts/lib/` is hashed into every cache key unconditionally**, so editing one invalidates the whole cache.

Two paths sit outside `assets/` on purpose: `data-sources/sv-sources.json` records which host each SV PNG came from and is never served (§3.E), and `docs/incidents/` holds §3's receipts.

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
- **Theme switching** resolves inline in `<head>`, above the first stylesheet, from `localStorage` else `matchMedia`; toggling fires `themechange` for Canvas redraws.
- **That block is ONE canonical string, not thirty hand-copies.** `scripts/lib/theme-init.mjs` is the definition, `scripts/sync_theme_init.mjs --write` is the only writer, and the four exemptions (`graph.html`'s own palette, `cry-studio-pro.html` and `index.html` pinned dark, `404.html` no surface) carry their reasons in that module's tables. **The comment above the block is generated with it** — the ten hand-written variants had rotted (one claimed 「all five themed pages」), so the rationale lives in this section and in the module, never restated per page.
- **It stays inline per page on purpose** — do not extract it to a shared `theme-init.js`, and do not replace it with a CSS media query: in a multi-document site only a blocking inline script can read `localStorage` before first paint, and the manual toggle is the feature that a media query would delete. The measured comparison is in the incident doc; a cheaper variant needs a number, not an opinion.
- **Reduced motion** is honored across CSS and JS.
**Guarded by:** `check_js_syntax.mjs` (canonical bytes, inside `<head>`, before the first stylesheet, no static `data-theme` on `<html>`) + `test_check_js_syntax.mjs` (10 cases) · **Background:** [page-defects.md#c](docs/incidents/page-defects.md#c)

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

### Z. `index.html` Is A Collection Instrument
The page is one idea — **every experiment fills a 1,025-cell Pokédex** — and it is pinned dark, because the hero clip's background is baked to `#0b1020`.
- **PINNED MEANS WRITTEN, NOT STORED.** The inline block sets `data-theme` and touches no `localStorage`, so the reader's choice still governs every other page; `initThemeToggle()` is never called and the button carries `hidden`. `--hx-bg` is `SITE_THEME.dark`.
- **THE HERO IS A CLIP AND A COUNTER.** One generation's loop scrubbed by scroll, the live count over it; the day's generation comes from `heroGenFor()`, the poster is set before the `src`.
- **THE TRACK IS 175vh IN CSS AND `HOME_HERO_TRACK_VH` IN THE MODULE.** `check_home_lab.mjs` compares the two; a mismatch stops the scrub at 0.73 of the clip and looks correct. Reduced motion collapses the track to `100dvh`.
- **THE SEEK COSTS ONE GOP, AND ONLY ONE IS IN FLIGHT.** `KEYFRAME_FRAMES = 10`; `pump()` parks the newest target until `seeked` — writing `currentTime` per rAF cancels the running seek. Measured on a 1.2s flick: avg lag 0.47s → 0.20s; `make_hero_video.py`'s `verify()` measures the encoded gap.
- **SCRUB AND PROGRESS ARE SEPARATE CONTRACTS.** Scrub writes `currentTime`, never `play()`; progress divides by `rect.height - innerHeight`.
- **BOTH ENDS OF THE CLIP ARE BLANK; THE POSTER IS NOT A PRE-PLAY FLASH.** `POSTER_FRACTION` comes from `make_hero_video.py`; `hero-gen.js` imports `taipeiDateKey`.
- **THE WALL IS 1,025 CELLS FROM `home_dex.json` (36 KB), NOT `pokemon_data.json`.** Row N must name the species at index N. `MIN_CELL = 20` is applied **twice** (fit and refit); `GAP = 2` is why a 20px cell measures 18px of ink; `TINT 0.42` / `TINT_TODAY 0.58`.
- **THE SCANNER SCHEDULES ITS NEXT ROW, NOT ITS NEXT FRAME.** `SCAN_ROW_MS = 90` via `scheduleIn()`, so an idle wall runs no frame loop.
- **THE SELECTION IS STATE, NOT RENDERED TEXT.** `selectedId` is a variable; the throw must never be recovered from `info.no.textContent`.
- **A CAPTURE RATE OF 0 IS A RATE, NOT AN ABSENCE.** `catchChance()` uses `Number.isFinite`, not `|| 45` (§3.AA's `power: 0` lesson).
- **THE DAILY CARD IS THE SAME DRAW AS `today.html`'s.** `home-daily-draw.js` re-expresses only the two `mulberry32` calls over `home_daily.json`'s pools; seed, hash, generator and date key are imported from `daily-pick.js`. `check_home_lab.mjs` asserts the same id for 400 consecutive days, and **pool ORDER is part of the draw**.
- **A MAZE WIN IS A CATCH, AND A LOSS IS NOT.** `maze:result` carries `{ won, id }`; `home-lab.js` ignores `!won` and a non-integer id.
- **PROGRESS LIVES IN `dex-collection.js`** — one versioned `STORAGE_KEY`, `MILESTONES` ending at `DEX_SIZE`, and `onChange`.
- **THE TWO DEMOS NEVER LOAD `pokemon_data.json`.** Fetch `home_roster.json` (90 KB) within `400px`, draw 96 px sprites; `home-lab.css` may re-tint them only under `.hx-page`.
- **SORT IS PACED; THE GAME IS BEATABLE.** `SORT_STEP_MS = 40`; A* `AI_TICK_MS = 420`, `AI_PAUSE_CHANCE = 0.18`, 4-direction `manhattanHeuristic` (showcase: 8 + `octileHeuristic`). Each run re-rolls; `suspended` starts true; reduced motion skips countdown; win cry respects `cryPlayer.muted`; `--canvas-wall` is wrapped in `rgba()`.
**Guarded by:** `check_home_lab.mjs` (90, 0.1 s, group `home`) + `check_home_sections.mjs` (62, 0.2 s, group `home`) + `test_check_home_lab.mjs` (23 cases, unlisted) · **Background:** [pages.md#z](docs/incidents/pages.md#z)

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
The slot's type statement is a **148px Poké Ball behind the art** (`.tm-slot-render::before`), **horizontal not diagonal**: `--tm-c1` top half, `--tm-c2` bottom half, a `--bg-secondary` waist and button ring; the name bar keeps `typePair(primary)` rather than white.
- **`TEAM_LIMIT` lives once, in `team-state.js`**; the analysis module takes ids, not a cap.
- **The id search is an exact padded match** — `025` must not match `0250`.
- **`?team=` keeps literal commas:** `searchParams.set` writes `%2C`; only `team-state.js` parses and writes the parameter.
- **Each tally header chip sits over its own mark column** — same grid, same gap; a chip is not a separate legend.
- **The roster is 145 KB of ids, names, types, generation and regions**, never `pokemon_data.json`; **every card states its type** in a `tm-card-types` row of `typeBadgeSmHtml()` badges, repeated in its `aria-label`.
- **`--tm-ball-size` sizes both the disc and the render box** (`min-height: calc(var(--tm-ball-size) + 12px)`). They were 112px and 84px, so `overflow: hidden` clipped 14px off each end of the ball; the shared token is the guard, not a second eye.
- **The slot art is the one runtime third-party request.** Local official artwork (475px) paints first, then a probed Showdown GIF replaces it when that species has one — the set is 43–178px, so each file is drawn at **its own pixels, capped at 136** — no upscale, so an early stage cannot outgrow its final form. A failed probe (#1010, #1017, #1024, #1025 today) leaves the artwork, so a 404 is not a broken icon; `gifState` holds a **promise** per species, so six slots cost six requests and a re-render during the probe still upgrades.
- **Each member carries four moves, drawn from level-up first** and filled from machine → tutor → egg when the level pool is short; **five species cannot reach four** (#132, #201, #235, #789, #790) and 22 have under four level moves, so a short row is the species, not a draw failure.
- **`MOVES_PER_MEMBER = 4` lives once, in `team-moves.js`.** `?moves=` is four ids per member in team order with `0` for an empty row, parsed/written only by `team-state.js`, literal commas like `?team=`. A member's chunk is accepted or rejected whole; a member without one is redrawn.
- **`team_moves.json` is generated** (607,208 B / 151 KB gzip): `defs._fields` plus nine columns per move, and four method strings per species. Machine rows keep the id only — no TM code, no generation. The page fetches it **only after a slot is filled**, and echoes an arriving `?moves=` until the table lands.
- **Offence is move-based and STABBED:** the strongest carried move per member, `effectiveness × 1.5`, counted at ≥2×. **Seventeen moves are excluded** — fixed damage, OHKO, counter and 忍耐 — while 硬壓 keeps its type at power 0 (依情況); status is selectable and never counted.
- **The picker is a native `<dialog>`** with four method tabs, a cross-method search, and effect/PP/generation per row; a move used in another slot is disabled and **focus returns to the row** after the swap, which the re-render detaches.
**Guarded by:** `check_team_page.mjs` (229) + `test_check_team_page.mjs` (32) + `check_team_moves.mjs` (54) + `test_check_team_moves.mjs` (11). **No browser entry:** the rendered split and the 148px ball were measured by hand (slot, 390px, blocked-network fallback); a static PASS is not a rendered one. **Background:** [pages.md#ad](docs/incidents/pages.md#ad)

### AE. `silhouette-draft.html` — Blind Draft, Live Opponent, Six Type-Only Matchups
- **The page loads only `draft_roster.json`**, never `pokemon_data.json` or `team_moves.json`; the pool is the evolution edge list: 568 final/single-stage species, 89 legendary/mythical, 5 excluded. Types are visible; names and species types stay hidden until confirmation; **the computer immediately takes one of the five the player passed on**, so both sixes are disjoint by construction.
- **Four moves come from the last EIGHT, two of the three swappable slots are redrawn, and every own type that can score gets a move.** `anchors` holds one highest-level damaging move per own type — 327 of 338 dual types need two, 57 deeper than the pool. `pickMoves()` swaps twice, fills each uncovered type without touching the highest-level move, then guarantees a damaging move. A type whose level moves are all status is skipped; five species have no own-type damaging move.
- **No STAB, stats, abilities, items, HP, or damage:** `attackProfile()` reads `defensiveMultiplier`; `TYPELESS_MOVES` / `isDamaging` print `—`. Best multiplier gives win/draw/loss; the summary grades it. **The scene draws the back sprite bottom-left, the front top-right, in one `--sd-battle-sprite-size` box;** `backSpriteUrl()` is the only back path; `image-rendering: pixelated` is scoped to `.sd-battle-slot img`. **The local PNG is the first paint and fallback; a probed Showdown GIF replaces it** (opponent front, player back), and a 404, reduced motion or a stale probe all keep the PNG.
- **The scene's terrain is the OPPONENT's primary type** (`data-terrain` from `types[0]`), as 18 hand-tuned light/dark pairs, not a `TYPE_COLORS` fill. Every palette keeps ONE ladder (brightest horizon 54%, ground below, `ground-deep` below) and the checker measures luminance; the `drop-shadow` is load-bearing for Grass-on-Grass, and `Normal` is the fallback.
- **Both plates hold the same four-move block.** Its four are a 2×2 grid clear of the 54% sky line; `.sd-battle-head` puts the name and `.sd-battle-types` on one baseline; plate chips take `typeBadgeSmHtml(type, zh, true)`.
- **A second press opens a confirm dialog.** Not `dblclick`: the re-render moves the node and touch has none. It shows the silhouette and four moves, never name or types, sharing `commitPick()`; Escape/backdrop cancel and restore focus. **`dialog.close()` queues its `close` event**, so Escape-then-click in one tick saw a stale `dialogPickId`; `finishPickDialog()` is idempotent.
- **The reveal is a beat, not a flash:** `confirmPick()` holds `pendingRound` until `nextRound()`; the sixth analysis waits for `finish()`. Every id `$()` reads must exist — the checker derives the set from the script.
- **The page must travel to the beat it earned.** `confirmPick()` collapses `#sd-pick-area`, so the scroll clamps past `#sd-reveal`; `revealIntoView()` pulls reveal/analysis/summary into the top 60%, auto under reduced motion, by LAYOUT offset (`translateY(8px)` settles 8px high); `focusFirst()` keeps `preventScroll`.
- **The stepper is three macro stages:** 選秀 → 對位 → 結算; 盲選 and 揭曉 alternate inside the first. `PHASE_STEPS` maps `session.phase` to `aria-current="step"`.
- **The confirm bar sticks from `max-width: 900px`**, and the phone picker three across.
**Guarded by:** `check_draft_data.mjs` (27,657) + `check_draft_page.mjs` (103,651) + a one-off 24-check CDP pass; no browser entry is kept. **Background:** [pages.md#ae](docs/incidents/pages.md#ae)

### AF. `cry-studio.html` — A Sequencer Whose Notes Are Scale Degrees

- **Rows are SCALE DEGREES, not semitones.** A note stores `row`, so changing scale re-pitches every note instead of stranding it between cells of a grid that no longer has that row; `rowCount()` is `intervals.length × 2 + 1` (11 for pentatonic, 25 for chromatic). Time is 16th-note `steps` (16 / 32 / 64).
- **The drum lanes are Strudel names on purpose** (`cp / oh / hh / sd / bd`), with velocity digits 0–3 (off / ghost / normal / accent). `assets/drums/strudel.json` keys its files by those same names, so `toStrudel()` writes a pattern that runs on strudel.cc; 791 references resolve to 397 files, and a missing sample falls back to `synthDrum()` rather than silence.
- **Live and exported audio are ONE code path.** `scheduleStep()` is called by the look-ahead timer and by `renderWav()`'s `OfflineAudioContext`, so the WAV is the performance rather than a second renderer.
- **Auto-tune is YIN (`analyseCry()`), and its limits are stated.** `rate = targetHz / f0` is clamped to [0.25, 4]; a gliding cry is tuned by its median, a noisy one uses `FALLBACK_F0 = 330`, and `tune: 'raw'` is the honest mode for both.
- **Nothing sounds before a gesture, and the site-wide cry mute is deliberately not applied** — pressing ▶ on an editor is the opt-in that mute exists to protect. `unlock()` creates the context inside the click.
- **The editor is canvas, but not opaque to assistive tech:** both canvases are focusable `role="application"` surfaces with a keyboard cursor, and every edit is announced through `#sq-live`.
- **The share format is the whole song in `#s=`**, written and read only by `serialize()` / `deserialize()` in the pure-data pattern module (which imports in bare Node); localStorage autosave, JSON import/export and the Strudel textarea all reuse that string.

**Guarded by:** `check_page_module_api.mjs` (bindings), `check_js_syntax.mjs` (document structure), `check_nav_pages.mjs` (nav mount) and `check_color_page.mjs`'s page count. **No dedicated checker and no browser entry** — the audio claims were measured by hand. **Background:** [pages.md#af](docs/incidents/pages.md#af)
## 4. Verification & Testing Commands

Run regression checks whenever modifying data structures, selectors, or color logic.

**`node scripts/check_all.mjs` skips whatever cannot have changed** (`.cache/check-state.json`: one content hash per checker over its declared `inputs`). A FAIL never refreshes an entry and is not a skip; `--force` exists for a pass that happened for another reason; the checker, any checker a harness attacks, every `scripts/lib/` file and `check_all.mjs` are always in the key. **Input lists are proven, not reviewed:** `--prove-inputs` fails on a disagreement in either direction, and `read but not declared` is the dangerous one. **No `--quick` flag on any checker** — a flag that skips a check is a promise that stops being kept.

**`--only` is a repeatable prefix match** (`--only=cry` covers `cry-apu`/`cry-data`/`cry-page`; `--only=a,b` is `--only=a --only=b`). `--help` prints every group with its last cost.

### RUN THE CHECK YOUR CHANGE NEEDS, NOT THE SUITE

**Running the whole suite is forbidden here: a cold run boots thirteen headless Chromes.** One cached run is 0.0 s, but the first run after an unrelated edit pays for every browser whose inputs moved. Filter by **what you edited**:

**`--only=<group>`** runs one group; naming a checker skips the runner. Take the narrowest option below. `--only` decides what runs, never what is true: a green filtered run says nothing about the checkers it skipped.

| you edited | run this | why this and not that |
| :--- | :--- | :--- |
| `index.html`, `home-lab.css`, `home-sections.css`, `home-*.js`, `dex-collection.js`, `hero-gen.js`, `build_home_dex.py`, `build_home_daily.py` | `--only=home` | §3.Z; 152 checks, 0.2 s, no Chrome |
| `spectrum.html`, `spectrum.css` | `--only=cry-page --only=cry-data`, then `check_spectrum_browser.mjs` | four-way split; `check_cry_mobile_layout.mjs` (§3.X) is the phone width |
| `cries.html`, `cries-gen1.html`, `cry-player.js`, `gb-apu.js` | `--only=cry` | covers apu/data/page; add `audio-browser` for rendered halves |
| `sorting.html`, `algo.css`, `sort-run.js`, `sorting-algorithms.js` | `test_check_sorting_page.mjs --static`, then `--only=sort` | static 89 checks 0.3 s; `sort` boots Chrome |
| `colors*.css`, `color-palette.js`, `color-match.js`, `colors-generator.html`, `mmcq.js` | `--only=color` | 16 entries, none >5 s, no browser |
| `color-game.html`, `color-game.css`, `color-game.js`, `game-similarity.js`, `game-hints.js`, `game-tips.js` | `--only=color`, then `check_color_game_browser.mjs` | same static group; CDP half is `game-browser` |
| `cry-studio.html`, `cry-seq-*.js`, `cry-seq.css`, `assets/drums/**` | `--only=nav` **plus** `--only=color` | no dedicated checker; nav registration, module bindings, document structure and the page count |
| `today.html`, `today.css` | `--only=nav` **plus** `--only=color` **plus** `--only=home` | daily/熱門/精選 counts live in `color` and `home`, not `nav` |
| `team.html`, `team.css`, `team.js`, `team-analysis.js`, `team-state.js` | `--only=nav` | 20 entries, no browser; the team pair is 230 + 32 |
| `moves.html`, `move.html`, `moves.js`, `moves.css` | `check_moves_data.mjs && check_moves_page.mjs` | name them; add `check_moves_page_browser.mjs` only for a rendered claim |
| `moves_zh.json`, `learnsets.json`, `move_learners*.json` | `check_moves_data.mjs` | 127,868 checks, 0.1 s; one pass writes all four |
| `abilities.html`, `ability.html`, `abilities.js`, `abilities.css` | `check_abilities_page.mjs` | 133 checks, 0.1 s; no browser entry |
| `abilities.json`, `ability_species.json`, `species_abilities.json` | `check_abilities_data.mjs` | 18,849 checks, 0.1 s; one pass writes all three |
| `pokemon_data.json` names, or the source XLSX | `check_pokemon_names.mjs` | 94 checks; do NOT regenerate the roster (1,350 vs 1,025) |
| `types.html`, `types.css`, `types*`, `sv-index.js`, `sv-sources.json`, `assets/images/**` | `--only=type`, then `--only=types-browser` | four static at 3.3 s; browser is the rendered half |
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

**Know what a group costs before choosing a filter.** The group table, tier/pool layout, `serial` entries, the liveness probe and the debug-port rule live in `docs/ARCHITECTURE.zh-TW.md` §8 — read it before widening a run. `check_spectrogram_port.mjs` prints `SKIP` and **exits 0** when `../.venv` is absent — read the line, not the exit code.


**DO NOT USE `--only` AS A WAY TO AVOID A BROWSER.** Every browser sits in a `*-browser` group, or in `sort`; the other ten groups never boot Chrome. **`--only=cry-page` is still 39 s of pure Node** (`test_check_cry_game_similarity.mjs`), so read the table, not the group name. **Anything you can name directly is cheaper than its group.**

**A mutation case is only as expensive as the thing it attacks** — `test_check_color_match.mjs` went 42 s → 2.2 s on two unexamined defaults. **A check's name is a claim about its cost, and the name is not evidence.**---

## 5. Data Pipeline & Regeneration Workflow

Run the generators by hand, in order, from the repo root with the venv active. **The full command block and each step's `--dry-run`/checker pair live in `docs/ARCHITECTURE.zh-TW.md` §9.**

- **Step 1 (`enhance_pokemon_data.py`) is not a refresh.** It yields 1,350 records against the committed 1,025; treat it as a roster change, not a data refresh (§3.AC).
- **One pass can write several files** (`fetch_moves.py` 4, `fetch_abilities_detail.py` 3, `fetch_gen1_cries.py` 2, `build_graph_data.py` reads a gitignored cache). Never run half of one.
- **Rebuild derived tables after their source changes:** `home_roster` / `home_dex` / `home_daily` after `pokemon_data.json`; `team_roster` after the roster; `team_moves` after `learnsets.json` or `moves_zh.json`.

---

## 6. Git Workflow Rules

- **No Push Without Explicit Permission**: Commit freely, but **never run `git push`** — not for a first push, not for a branch, not for a fix, not because CI is red. The remote is only pushed when the user says so in their own words, and a request to commit is not a request to push. When it is unclear whether more work is coming, assume it is and stay local. Check what is pending with `git log --oneline origin/<branch>..HEAD`.
- **Coherent Commits**: Commit at the end of every coherent unit of work (e.g. one bug fix, one component layout, one page enhancement). "Atomic" means one revertable direction, not one small edit or one file; a large feature, its assets, its checkers and its docs are one commit when reverting them together leaves the repo coherent.
- **Batch by direction, not by file.** One commit per *direction of change*; a direction may touch several files (a fix plus its test, a refactor plus its docs). The line is **unrelatedness, not file count**: a colour-palette fix and a nav fix are two directions even on the same afternoon, while "one commit per file" and "one commit per hunk" bury the intent in bookkeeping. Ask whether reverting this commit alone leaves the repo coherent; if yes it is its own commit, if no it belonged with what it is entangled with.
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
