# Missing / planned pages

Pages the homepage and the shared header **link to or advertise** that do not
exist as files yet. Nothing in the site points at a 404 — anything advertised
but unbuilt renders as a non-focusable `<span>` carrying a
`.home-tag-badge` reading 敬請期待, never as an empty `<a>`. A focusable
control that does nothing when activated is worse than a non-focusable one
(AGENTS.md gotcha 37).

**Source of truth: `PLANNED_PAGES` in `assets/js/shared.js`.** All 16 entries
are registered there and **all 16 are missing as files**; the `data` field
records whether the site's own data would already support the page, and the
`why` field carries the specific gap. This file is the human-readable
companion — do not treat it as authoritative, and if the two disagree, the
array wins.

Two rows had drifted in OPPOSITE directions: `color-game.html` was registered in
the array but had no row here at all, while `types.html` still had one here long
after it shipped — it is a live `href` in NAV's 圖鑑 group and a 55 KB file, and
its gap read 「缺瀏覽頁」, which is the page that now exists. Both were corrected,
and the count stayed where it was. A companion table whose whole job is to mirror
an array has to be checked against it rather than
read; nothing in the suite reads this file.

| Slug | 標題 | Data | Gap |
|---|---|---|---|
| `abilities.html` | 特性 | present | `abilities_zh.json` 已有 284 筆中文名，缺彙整頁 |
| `moves.html` | 招式 | present | `moves_zh.json` 已有 783 筆，缺可搜尋的瀏覽頁 |
| `natures.html` | 性格 | **absent** | 連資料都沒有 — PokeAPI `/pokemon-species` 不帶 nature |
| `type-chart.html` | 屬性相剋表 | present | 詳情頁已有相剋計算，缺獨立對照頁 |
| `evolution-guide.html` | 進化指南 | present | `evolution_chains.json` 已有 541 條鏈，缺教學式呈現 |
| `breeding-guide.html` | 生蛋指南 | present | `gender_rate` / `hatch_counter` / 遺傳招式都有，缺指南頁 |
| `games.html` | 全部遊戲 | present | `generations.json` 已有 38 種遊戲，缺獨立頁 |
| `eevee-evolutions.html` | 伊布進化 | present | 8 條進化鏈都在資料裡，缺對照頁 |
| `strongest.html` | 最強寶可夢 | present | 可由 `stats.total` 排序產生，缺排名頁 |
| `search.html` | 進階搜尋 | present | `pokedex.html` 目前只支援 `?gen=` 深連結 |
| `guides.html` | 攻略 | **absent** | InfoPoke 導覽列的入口，本站無對應內容 |
| `blogs.html` | Blogs | **absent** | 同上 |
| `about.html` | 關於我們 | present | 頁尾連結 |
| `privacy.html` | 隱私權政策 | present | 頁尾連結 |
| `sitemap.html` | Sitemap | present | 頁尾連結 |
| `color-game.html` | 猜謎遊戲 | present | 色帶已足夠作答，缺出題、計分與難度 |

Three of these — `about.html`, `privacy.html`, `sitemap.html` — exist in
InfoPoke's footer and **are not transcribed into our footer**: a static site
with no backend has nothing true to put in a privacy policy, and the homepage
footer is a 3-column link block plus the provenance line rather than a copy of
the source's sitemap. They stay registered so the header nav is unchanged.

## Adding a page

1. Create the file at the repo root. Every page is a flat `*.html` — there is
   no router; `404.html` only rewrites `/detail/<slug>` (gotcha 8).
2. Update that entry's `data` field if appropriate, and flip the header nav row
   from planned to a real link by dropping `planned: true` in `NAV`.
3. Remove the matching `is-planned` `<span>` + `.home-tag-badge` from
   `index.html` — the 精選系列 / 寶可夢遊戲 / 對戰工具 cards, the 快速連結
   panels, and the footer — and make it a real link.
4. `node scripts/check_categories.mjs` — it asserts the hub's slugs and the
   category link targets still exist (gotcha 38).
