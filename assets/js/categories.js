/**
 * Special-category configuration — the single source of truth for
 * `category.html?cat=<slug>`.
 *
 * WHY ONE TEMPLATED PAGE AND NOT TEN FILES
 * -----------------------------------------
 * All ten categories share the same five regions (breadcrumb → hero → stat
 * tiles → prose → filter row → card grid) and differ only in data: a title, a
 * gradient, four tile values, a paragraph, a member selector and a filter
 * dimension. Ten near-identical HTML files would mean ten copies of the hero
 * markup to keep in sync, which is how this repo already got bitten twice
 * (AGENTS.md gotcha 23 — dead code in a file that never ran; gotcha 32 — a
 * second, unreachable copy of the maze search). One page driven by this table
 * makes it impossible for the copies to drift, and it follows the precedent the
 * user already approved for `pokedex.html?gen=N`: query-parameter addressing
 * rather than a file per value.
 *
 * WHY THE GRADIENTS ARE 700, NOT THE SOURCE'S 600
 * -----------------------------------------------
 * InfoPoke's heroes use Tailwind's 600 shades. Copied verbatim they fail WCAG AA
 * for the hero's own subtitle: `text-lg sm:text-xl` is 18–20px in normal weight,
 * which is NOT "large text" (that needs 24px, or 18.66px bold), so the bar is
 * 4.50:1, not 3.00:1. Measured against white text, six of the thirteen 600
 * shades in use come up short — orange 3.56, yellow 2.94, green 3.30,
 * emerald 3.77, teal 3.74, cyan 3.68 — and yellow-600 at 2.94:1 misses even the
 * relaxed 3:1 large-text bar that the `text-5xl` h1 would be entitled to.
 *
 * The hues, their order and the gradient direction are all the source's. Only
 * the level moves, 600 → 700, which lifts the worst case to 4.92:1 (yellow-700)
 * and the rest to 5.02–6.29:1. Same rule as `generations.html`: keep the
 * reference's composition, do not copy its palette's contrast defects.
 *
 * WHY EVERY COUNT IS A FUNCTION
 * -----------------------------
 * Each tile value is computed from the members that actually rendered, never
 * typed in. A hardcoded number silently rots the first time
 * `pokemon_data.json` is regenerated, which is exactly how InfoPoke came to
 * advertise "16 Paradox Pokémon" and "11 Ultra Beasts" on pages whose own data
 * holds 22 and 12.
 */

// The `shiny` category reports how many ids have real shiny artwork, so the
// number has to come from the generated index rather than be written down here
// — a hardcoded 1327 is exactly the kind of duplication COLLECTION_GROUPS
// already needs check_categories.mjs to police (AGENTS.md gotcha 38), and
// regenerating the index would then silently leave the tile wrong.
import { SHINY_IDS } from './shiny-index.js';

/** Region slug → Traditional Chinese, for regional-form card titles and filters. */
const REGION_ZH = {
  alola: '阿羅拉',
  galar: '伽勒爾',
  hisui: '他思岐',
  paldea: '帕底亞',
};

/** Form kind → the corner badge drawn on a form card. */
const FORM_BADGE = {
  mega: '超級進化',
  gigantamax: '超極巨化',
};

/**
 * Mega and Gigantamax names are stored per-form in `forms[].name_en` because a
 * form's identity is occasionally the whole point — Charizard has *two* Mega
 * forms, and calling both of them 「噴火龍」 would be wrong, so the X/Y suffix
 * is carried through. Every other form collapses to the base's Chinese name.
 */
function formTitleZh(base, form) {
  const baseEn = base?.names?.en || '';
  const baseZh = base?.names?.zh || '';
  if (!form.name_en || form.name_en === baseEn) return baseZh;
  const suffix = form.name_en.slice(baseEn.length).trim();
  return suffix ? `${baseZh} ${suffix}` : baseZh;
}

/**
 * Regional forms are the one member set that does not live in
 * `pokemon_data.json`, and reading it wrong is easy in three independent ways.
 *
 * 1. Reading only `variants` misses four real forms. The 3 Paldean Tauros
 *    breeds (10250–10252) and Darmanitan-Galar (10177) are filed under
 *    `special_forms.other` with `form: "other"`, not under `variants.paldea` /
 *    `variants.galar`. Keying on the bucket name — the obvious approach, and the
 *    one that matches how the file is organised — drops them with no error:
 *    54 forms instead of 58.
 * 2. So the region is taken from the NAME (`-Alola-`, `-Galar-`, `-Hisui-`,
 *    `-Paldea-`), which is where it is actually encoded, and that finds all 58.
 * 3. The BASE species cannot be taken from the chain, either. `special_forms`
 *    rows carry no `base_id`, so the fallback is `main_line[0]` — and that is
 *    wrong twice over. Darmanitan's chain 282 starts at Darumaka, so
 *    `Darmanitan-Galar-Standard` and `-Zen` both resolve to Darumaka and get
 *    labelled 「火紅不倒翁（伽勒爾）」, identical to the real Darumaka-Galar card
 *    beside them. And Mr. Mime's chain 57 has an EMPTY main line (the canonical
 *    case called out in AGENTS.md gotcha 15), so `main_line[0]` is undefined,
 *    the base lookup returns nothing, and `Mr-Mime-Galar` is dropped entirely —
 *    silently, because "skip the row when the chain looks empty" is exactly the
 *    heuristic that gotcha exists to warn about.
 *
 *    So the base is parsed out of the form's own name, ahead of every other
 *    source. See `resolveBase` for the matching rules.
 *
 * Costumes are then removed. `Raticate-Totem-Alola` (10093) and
 * `Pikachu-Alola-Cap` (10099) are regional-*skinned* but not regional *forms* —
 * a Totem is a boss costume and the cap is a hat, both reusing the base
 * silhouette. Counting them yields 60.
 *
 * The 58 that remain split alola 18 / galar 20 / hisui 16 / paldea 4, against
 * InfoPoke's 57 = 18 / 19 / 16 / 4. The one-form difference is Darmanitan:
 * 10177 `-Standard` and 10178 `-Zen` are two distinct pieces of artwork that
 * InfoPoke counts once. This page counts what it can actually display, so its
 * number is 58 and the difference is a dedup on their side, not a missing record
 * here. All 58 have artwork on disk.
 */
const REGION_IN_NAME = /-(Alola|Galar|Hisui|Paldea)(-|$)/i;
const NOT_A_FORM = /-(Cap|Totem)(-|$)/i;

/**
 * Match key for English names: letters and digits only, lowercased.
 *
 * This is what lets `Mr-Mime` in the chain data find `Mr. Mime` in
 * pokemon_data.json, and `Farfetchd` find `Farfetch'd`. The chain data spells
 * these with hyphens and no apostrophe because they are filename-safe slugs,
 * while the JSON carries the display spelling — so a literal comparison fails
 * on exactly the two families most likely to matter.
 */
const nameKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find the base species a regional form belongs to.
 *
 * Order is deliberate: the form's own name beats everything, because it is the
 * only source that is correct for both failure cases above. `base_id` is
 * consulted second (it is authoritative when present), and `main_line[0]` last,
 * since it is only a heuristic about where the chain happens to start.
 */
function resolveBase(row, chain, byId, byEn) {
  const cut = REGION_IN_NAME.exec(row.name_en || '');
  if (cut) {
    const stem = row.name_en.slice(0, cut.index);
    // The name can carry extra qualifiers before the region marker
    // (`Tauros-Paldea-Combat-Breed` cuts at the marker; `Mr-Mime-Galar` does not),
    // so try the full stem first and then progressively shorter prefixes. This
    // covers a base whose English name itself contains a hyphen.
    let candidate = stem;
    for (;;) {
      const hit = byEn.get(nameKey(candidate));
      if (hit) return hit;
      const next = candidate.lastIndexOf('-');
      if (next <= 0) break;
      candidate = candidate.slice(0, next);
    }
  }
  if (row.base_id && byId.get(row.base_id)) return byId.get(row.base_id);
  const first = chain.main_line?.[0]?.id;
  return first ? byId.get(first) : undefined;
}

/**
 * Build one displayable pseudo-Pokémon from a base species plus a form row.
 *
 * `linkTo` is always the BASE species. Forms have no record in
 * `pokemon_data.json`, so `detail.html?slug=` or `?id=` cannot resolve a form id
 * like 10033 — linking there would produce a working-looking card that lands on
 * an error. The base is the only page our detail view can actually render.
 */
function formCard(base, form, opts = {}) {
  return {
    ...base,
    id: form.id,
    filename: form.filename,
    names: { ...base.names, zh: opts.title ?? formTitleZh(base, form) },
    formBadge: opts.badge || null,
    regionKey: opts.regionKey || null,
    linkTo: base,
  };
}

/* ===== Member selectors ===== */

const speciesFlags = (key) => (data) => data.filter((p) => p[key]);

/**
 * The 600 族 ("pseudo-legendary") members.
 *
 * Two rules, not one. A pure `total === 600` filter is *not* sufficient, and the
 * 11th record it admits is the reason this needs its own function:
 *
 *   - 36 species in the file carry `stats.total === 600`, and this picks out the
 *     11 that are neither `is_legendary` nor `is_mythical`.
 *   - 鋁鋼橋龍 (#1018) is one of those 11, and the category's own definition —
 *     「需要經過兩次進化」 — is what excludes it. Its line is
 *     Duraludon(884) → Archaludon(1018), one evolution, not two.
 *
 * So the honest description of `PSEUDO_EXCLUDED` is "the 600-BST species that
 * fails the two-evolution half of the definition", not "a number I disagreed
 * with". `scripts/check_categories.mjs` asserts the exact 10-id roster AND
 * re-derives the two-evolution count from the chains, so this exclusion cannot
 * quietly become a silent drop: a new 600-BST species fails the roster
 * assertion instead of appearing here unremarked.
 *
 * WHY THIS IS NOT COMPUTED FROM `main_line`
 * -----------------------------------------
 * It looks like the cleaner rule — walk the chain, count stages, require 3 — and
 * it is wrong, because two chain shapes in this data defeat it:
 *
 *   - 杖尾鱗甲龍 (#784) has chain 408 with `main_line: []`. Its three real
 *     stages (Jangmo-O, Hakamo-O, Kommo-O) are filed in `special_forms.other`.
 *     A `main_line` stage count reads 0 evolutions and DROPS the Pokémon, so the
 *     page would render 9 cards against a page that says 10.
 *   - Most other chains pad `main_line` with form rows — 妙蛙草(1),
 *     妙蛙花(2), 妙蛙種子(3), 妙蛙種子-Mega(10001) — so an unfiltered count
 *     yields 3 evolutions and would wrongly drop 快龍, 暴飛龍, 班基拉斯, 烈咬陸鯊,
 *     黏美龍, 杖尾鱗甲龍, 多龍巴魯托 and 戟脊龍 too.
 *
 * Both shapes are facts about the data, not about the rule, so the rule keeps to
 * the two flags it can evaluate correctly and the checker owns the rest. See
 * AGENTS.md gotcha 37 for the sibling `variants: {}` truthiness trap.
 */
const PSEUDO_EXCLUDED = new Set([1018]);
const pseudoLegendaryMembers = (data) =>
  data.filter((p) => p.stats?.total === 600 && !p.is_legendary && !p.is_mythical && !PSEUDO_EXCLUDED.has(p.id));

function formMembers(kind) {
  return (data) =>
    data
      .flatMap((p) => (p.forms || []).filter((f) => f.form === kind).map((f) => formCard(p, f, { badge: FORM_BADGE[kind] })))
      .sort((a, b) => a.id - b.id);
}

/**
 * Regional-form members.
 *
 * The `_gens` slot is named, not omitted. Every selector here is called with the
 * same three positional arguments — (pokemon, generations, chains) — matching the
 * order of a category's `needs` array, and `category.html` passes all three
 * unconditionally with `null` for the ones a category did not declare. Writing
 * this as `(data, chains)` therefore compiled, ran, and returned **zero** members:
 * `chains` received the generations array, `Object.values()` over it yielded
 * arrays rather than chain objects, `chain.variants` was undefined, and the
 * regional page rendered an empty grid with no error anywhere. The skipped
 * middle argument has to be visible in the signature so the next reader does not
 * "tidy" it away. `scripts/check_categories.mjs` asserts a non-zero member count
 * for all ten categories, which is the check that would have caught it.
 */
function regionalMembers() {
  return (data, _gens, chains) => {
    const byId = new Map(data.map((p) => [p.id, p]));
    const byEn = new Map(data.map((p) => [nameKey(p.names?.en), p]));
    const out = [];
    let unresolved = 0;
    for (const chain of Object.values(chains)) {
      const rows = [
        ...Object.values(chain.variants || {}).flat(),
        ...Object.values(chain.special_forms || {}).flat(),
      ];
      for (const row of rows) {
        const nameEn = row.name_en || '';
        const region = REGION_IN_NAME.exec(nameEn);
        if (!region || NOT_A_FORM.test(nameEn)) continue;
        const key = region[1].toLowerCase();
        const base = resolveBase(row, chain, byId, byEn);
        if (!base) {
          unresolved++;
          continue;
        }
        // Anything trailing the region marker is a form qualifier, and it is
        // load-bearing: `Darmanitan-Galar-Standard` and `-Zen` are two different
        // pieces of artwork, and the 3 Paldean Tauros breeds are three. Without
        // it those five cards would render as identical titles in a row. The
        // qualifier is kept in its official Latin form for the same reason Mega's
        // X/Y suffix is — these are proper form names, and a guessed Chinese
        // translation would be worse than none.
        const qualifier = nameEn.slice(region.index + region[0].length).replace(/^-+/, '').replace(/-/g, ' ');
        out.push(
          formCard(base, row, {
            title: `${base.names.zh}（${REGION_ZH[key]}${qualifier ? `・${qualifier}` : ''}）`,
            badge: REGION_ZH[key],
            regionKey: key,
          })
        );
      }
    }
    if (unresolved) {
      // Loud, not silent. A regional form we cannot attribute to a base species
      // is a hole in the page, and the failure mode of every shortcut above is
      // that it disappears without a word.
      console.warn(`[categories] ${unresolved} regional form(s) could not be matched to a base species`);
    }
    return out.sort((a, b) => a.id - b.id);
  };
}

/**
 * Starters are the one category sourced from `generations.json` rather than a
 * per-species flag: each generation lists its three `starters`, giving 27 across
 * nine generations.
 *
 * The filter row is therefore 世代, not 遊戲. InfoPoke filters its starter page by
 * fourteen individual games (Red/Blue, Gold/Silver, Sword/Shield, Legends:
 * Arceus, Legends: Z-A, …), which is only answerable from a starter→game table
 * that no file in `assets/data/` holds — a starter belongs to its generation's
 * original game plus remakes plus whichever Legends entry, and reconstructing
 * that by hand would be invention dressed as data. Nine generation buttons are
 * what the data actually supports, so that is what ships.
 */
function starterMembers() {
  return (data, gens) => {
    const byId = new Map(data.map((p) => [p.id, p]));
    const out = [];
    for (const g of gens) {
      for (const id of g.starters || []) {
        const base = byId.get(id);
        if (base) out.push({ ...base, starterGen: g.gen });
      }
    }
    return out.sort((a, b) => a.starterGen - b.starterGen || a.id - b.id);
  };
}

/* ===== The ten categories ===== */

export const CATEGORIES = {
  legendary: {
    title: '傳說寶可夢',
    titleEn: 'Legendary Pokémon',
    subtitle: '探索 71 隻傳說級寶可夢的完整名單',
    note: '從關都的三聖鳥到帕底亞的故勒頓與密勒頓',
    accent: ['#7e22ce', '#c2410c', '#b91c1c'],
    needs: ['pokemon'],
    members: speciesFlags('is_legendary'),
    tiles: (m) => [
      [m.length, '傳說寶可夢'],
      [new Set(m.map((p) => p.generation)).size, '涵蓋世代'],
      [m.filter((p) => p.is_legendary).length ? Math.max(...m.map((p) => p.stats?.total || 0)) : 0, '最高能力總和'],
      [m.filter((p) => p.base_experience >= 200).length, '基礎經驗 200 以上'],
    ],
    prose:
      '傳說寶可夢是在寶可夢世界的神話與傳說中佔據核心地位的稀有存在，通常與特定地點、事件或自然現象相關，許多甚至被認為參與塑造了世界本身。牠們往往擁有卓越的能力值、獨特的屬性組合與招牌招式。與一般寶可夢不同，傳說寶可夢多半無法繁殖，並且在每個遊戲中只會出現一次。從關都的三聖鳥——火焰鳥、雷鳥與鳳凰——到神奧的時空三神帝牙盃、帕路奇亞與騎拉帝納，再到劍盾的傳說之劍與劍之日，每個世代都會帶來屬於自己的傳說。',
  },

  mythical: {
    title: '幻之寶可夢',
    titleEn: 'Mythical Pokémon',
    subtitle: '23 隻僅能透過特殊活動取得的幻之寶可夢',
    note: '從夢幻到桃歹郎——世上最稀有的一批',
    accent: ['#be185d', '#7e22ce', '#4338ca'],
    needs: ['pokemon'],
    members: speciesFlags('is_mythical'),
    tiles: (m) => [
      [m.length, '幻之總數'],
      [new Set(m.map((p) => p.generation)).size, '涵蓋世代'],
      ['100%', '皆為活動限定'],
      [m.filter((p) => p.generation === 9).length, '第九世代'],
    ],
    prose:
      '幻之寶可夢是傳說寶可夢的一個特殊子集，通常只能透過特殊活動、遊戲內分發或限時開放的活動取得，因此在遊戲本篇中無法以一般流程捕捉。從夢幻、克蕾塞克、席多豪司到密勒頓，牠們被更強的神祕感所環繞，也一直是收藏者追逐的目標。與傳說寶可夢不同，牠們並不會被標記為傳說分類，兩者在資料上是完全互斥的。',
  },

  'ultra-beast': {
    title: '究極異獸',
    titleEn: 'Ultra Beasts',
    subtitle: '12 隻來自超空間的異獸完整名單',
    note: '阿羅拉地區以外空間降臨的神秘生物',
    accent: ['#4338ca', '#7e22ce', '#0e7490'],
    needs: ['pokemon'],
    members: speciesFlags('is_ultra_beast'),
    tiles: (m) => [
      [m.length, '究極異獸'],
      ['第 7 世代', '阿羅拉地區'],
      [m.length ? Math.min(...m.map((p) => p.stats?.total || 0)) : 0, '最低能力總和'],
      [m.length ? Math.max(...m.map((p) => p.stats?.total || 0)) : 0, '最高能力總和'],
    ],
    prose:
      '究極異獸是與阿羅拉地區毫無淵源的異世界生物。牠們會在稱為極巨化洞穴的裂縫深處出現，得用特殊的究極之球才有辦法捕捉。每一隻都擁有極為壓倒性的能力總和——全部 12 隻落在 420 到 600 之間，其中 11 隻擁有能夠在連續擊倒對手時逐步強化自身的能力。牠們與阿羅拉原有的寶可夢之間沒有任何進化關係。',
  },

  starter: {
    title: '最初的夥伴',
    titleEn: 'Starter Pokémon',
    subtitle: '27 隻御三家——每位訓練家的起點',
    note: '從妙蛙種子到潤水鴨，跨越九個世代',
    accent: ['#15803d', '#1d4ed8', '#b91c1c'],
    needs: ['pokemon', 'generations'],
    members: starterMembers(),
    filters: [
      { key: 'all', label: '全部' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => ({ key: `gen${g}`, label: `第 ${g} 世代`, test: (m) => m.starterGen === g })),
    ],
    tiles: (m) => [
      [m.length, '御三家'],
      [new Set(m.map((p) => p.starterGen)).size, '涵蓋世代'],
      [new Set(m.flatMap((p) => p.types)).size, '涉及屬性'],
      // The 4th tile is a *derived* fact, not a restatement of tile 2. It used
      // to be a hardcoded [9, '世代總數'], which printed "9 涵蓋世代" directly
      // above "9 世代總數" — two tiles, one number, and no way to tell from the
      // row whether the second was a different measurement. `gens` is already
      // loaded for this category (that is where starterGen comes from), so the
      // earliest generation present is the honest fourth fact.
      [`第 ${Math.min(...m.map((p) => p.starterGen))} 世代`, '最早推出'],
    ],
    prose:
      '御三家是每位訓練家在冒險一開始可以選擇的初始夥伴，通常每一代各有三隻，並且各自對應一種屬性。從關都的妙蛙種子、小火龍與傑尼龜，到帕底亞的新葉喵、呆火鱷與潤水鴨，九個世代共 27 隻。牠們的共同點是進化潛力高、最終型態的總和能力在同世代中偏高，而且每一代都至少有一隻能進化到最終型態。',
  },

  shiny: {
    title: '異色寶可夢',
    titleEn: 'Shiny Pokémon',
    subtitle: '1,025 隻寶可夢的異色外觀一覽',
    note: '本頁卡片的色彩由濾鏡位移而來；真實異色 artwork 請見各寶可夢的詳情頁',
    accent: ['#92400e', '#a16207', '#c2410c'],
    needs: ['pokemon'],
    members: (data) => data,
    disclaimer: true,
    tiles: (m) => [
      [m.length, '寶可夢總數'],
      [new Set(m.map((p) => p.generation)).size, '涵蓋世代'],
      // Not "0 real shiny artwork" any more — the artwork landed, and 1327 of
      // the 1350 referenced ids have it. What is still true is the *asymmetry*:
      // this page shows 1025 cards at once, so it filters where the detail page
      // swaps src. State the count and where the real thing lives.
      [SHINY_IDS.size, '具真實異色 artwork（詳情頁）'],
      // "濾鏡" as a *value* read as a stray word next to three numbers. One
      // rendering method, stated as a count, with the method in the label.
      ['1', '呈現方式（CSS 濾鏡）'],
    ],
    prose:
      '異色是寶可夢極其罕見的個體變體，在遊戲中的出現機率通常只有數千分之一以下，官方從未公布統一的計算方式。本頁把全部 1,025 隻都列出來，讓你一次看完整份名單。由於本頁一次鋪滿 1,025 張卡，每張卡都另外讀取一張異色圖並不划算，因此卡片上呈現的是一組色彩濾鏡的示意效果，而不是真正的異色 artwork。真正的異色 artwork 已經收錄在站內 —— 進入任一寶可夢的詳情頁，按下名稱旁的「切換閃亮外觀」按鈕即可看到原版異色圖。',
  },

  paradox: {
    title: '悖謬寶可夢',
    titleEn: 'Paradox Pokémon',
    subtitle: '22 隻悖謬寶可夢——古代的過去與遙遠的未來',
    note: '來自帕底亞的兩條時間線',
    accent: ['#6d28d9', '#7e22ce', '#a21caf'],
    needs: ['pokemon'],
    members: speciesFlags('is_paradox'),
    filters: [
      { key: 'all', label: '全部' },
      { key: 'ancient', label: '古代', test: (m) => m.paradox_side === 'ancient' },
      { key: 'future', label: '未來', test: (m) => m.paradox_side === 'future' },
    ],
    tiles: (m) => [
      [m.length, '悖謬總數'],
      [m.filter((p) => p.paradox_side === 'ancient').length, '古代'],
      [m.filter((p) => p.paradox_side === 'future').length, '未來'],
      ['第 9 世代', '帕底亞地區'],
    ],
    prose:
      '悖謬寶可夢是從與現世並存卻又截然不同的過去或未來穿越而來的寶可夢。古代側的個體往往體型巨大、性情凶暴，像是傳說生物的復刻；未來側則體型小型化、動作迅速而兇狠。22 隻之中有 20 隻擁有能夠隨天氣或時間改變自身能力的悖謬特性，唯二例外是故勒頓與密勒頓，牠們各有專屬的機體特性。',
  },

  mega: {
    title: '超級進化',
    titleEn: 'Mega Evolution',
    subtitle: '48 個超級進化形態完整名單',
    note: '戰鬥中暫時性的強力變身，無法跨世代使用',
    accent: ['#7e22ce', '#be185d', '#4338ca'],
    needs: ['pokemon'],
    members: formMembers('mega'),
    tiles: (m) => [
      [m.length, '超級進化形態'],
      [new Set(m.map((p) => p.linkTo?.id)).size, '對應寶可夢'],
      [new Set(m.map((p) => p.linkTo?.generation)).size, '涵蓋世代'],
      [new Set(m.flatMap((p) => p.types)).size, '涉及屬性'],
    ],
    prose:
      '超級進化是寶可夢在戰鬥中發生的暫時性變身。變身後的能力值會大幅提升，還能改變屬性組合，部分形態甚至會顛覆原本的弱點。代價是每場戰鬥只能變身一次、結束後即恢復原狀，而且必須先完成特定的前置進化階段——例如妙蛙種子必須先進化成妙蛙草才具備超級進化的資格。超級進化只存在於第六世代的《寶可夢 紅寶石／藍寶石／綠寶石》之中，之後的世代都沒有延續這項機制。',
  },

  gigantamax: {
    title: '超極巨化',
    titleEn: 'Gigantamax',
    subtitle: '32 個超極巨化形態完整名單',
    note: '伽勒爾原生的特殊氣象，附帶專屬 G-Max 招式',
    accent: ['#b91c1c', '#c2410c', '#a16207'],
    needs: ['pokemon'],
    members: formMembers('gigantamax'),
    tiles: (m) => [
      [m.length, '超極巨化形態'],
      [new Set(m.map((p) => p.linkTo?.id)).size, '對應寶可夢'],
      [new Set(m.map((p) => p.linkTo?.generation)).size, '涵蓋世代'],
      ['第 8 世代', '伽勒爾地區'],
    ],
    prose:
      '超極巨化是《寶可夢 劍／盾》引入的系統。當伽勒爾地區出現特殊的超極巨化氣象時，寶可夢就能進行超極巨化，體型會變得巨大，並且獲得專屬的 G-Max 招式——那是只有超極巨化狀態下才能使用的招式。相較於超級進化，超極巨化不要求任何前置進化階段，絕大多數寶可夢都能進行，但同一場戰鬥只能有一隻超極巨化。',
  },

  regional: {
    title: '地區型態',
    titleEn: 'Regional Forms',
    subtitle: '58 個地區型態完整名單',
    note: '阿羅拉、伽勒爾、他思岐與帕底亞的在地變體',
    accent: ['#0f766e', '#047857', '#0e7490'],
    needs: ['pokemon', 'chains'],
    members: regionalMembers(),
    filters: [
      { key: 'all', label: '全部地區' },
      ...Object.entries(REGION_ZH).map(([key, zh]) => ({ key, label: zh, test: (m) => m.regionKey === key })),
    ],
    tiles: (m) => [
      [m.length, '地區型態'],
      [m.filter((p) => p.regionKey === 'alola').length, '阿羅拉'],
      [m.filter((p) => p.regionKey === 'galar').length, '伽勒爾'],
      [m.filter((p) => p.regionKey === 'hisui').length, '他思岐'],
    ],
    prose:
      '地區型態是指某個寶可夢在特定地區演化或存在時所呈現的不同樣貌，屬性與能力值都可能與原版大相逕庭。阿羅拉的妙蛙種子因為適應了日照而變得擅長吸收光能，伽勒爾的喵喵則因為金屬與都市環境而改變了原本的生活方式；他思岐的型態大多體型巨大、性情溫順，與關都的印象截然不同。本頁的 58 個型態以名稱中的地區標記判定，並排除妖裝型態。',
  },
  'pseudo-legendary': {
    title: '600族寶可夢',
    titleEn: 'Pseudo-Legendary Pokémon',
    subtitle: '10 隻準傳說級寶可夢的完整名單',
    note: '從關都的快龍到帕底亞的戟脊龍',
    // lime-700 -> yellow-700 -> red-700: the 700 level per the file header's rule
    // (InfoPoke's 600 shades fail AA for an 18-20px subtitle). Warm ramp because
    // 8 of the 10 members are Dragon-type and the page is about peak power.
    accent: ['#4d7c0f', '#a16207', '#b91c1c'],
    needs: ['pokemon'],
    members: pseudoLegendaryMembers,
    filters: [
      { key: 'all', label: '全部' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => ({ key: `gen${g}`, label: `第 ${g} 世代`, test: (m) => m.generation === g })),
    ],
    tiles: (m) => [
      [m.length, '600族寶可夢'],
      [new Set(m.map((p) => p.generation)).size, '涵蓋世代'],
      [Math.max(...m.map((p) => p.stats?.total || 0)), '最高能力總和'],
      // The 4th tile's value is the member count, NOT a computed evolution depth.
      // The claim it makes — that all 10 need two evolutions — is asserted against
      // the chains in check_categories.mjs, which is the only place that can
      // handle chain 408's empty `main_line` and the `-Mega`/`-Gmax` padding rows
      // without a 15-line helper duplicating what gotcha 37 already warns about.
      // Recomputing it here would be a second implementation to keep correct.
      [m.length, '皆需兩次進化'],
    ],
    prose:
      '「600族」又稱準傳說寶可夢或準神，是最終進化形態的種族值總和剛好為 600、需要經過兩次進化、且不是傳說或幻之寶可夢的一類強力寶可夢。牠們的種族值總和與傳說級寶可夢相同，因此培育困難卻極具實戰價值，分佈在關都到帕底亞的九個世代之中。',
    // `notes` is optional and absent on the other nine categories (all of which predate
    // it): an
    // acknowledgement, or a correction, that is specific to this one page and
    // has no business in a shared `prose` paragraph. `category.html` renders one
    // `<p class="cat-note">` per entry and inherits `.cat-intro p`, so a config
    // without `notes` is unchanged.
    notes: [
      '繁殖與培育：600族寶可夢全部都可以正常繁殖，可與百變怪或同蛋群的寶可夢生蛋，大量取得並培育後方的完整進化線，不需要特殊道具或限定條件。',
      '黏美龍的差異一：牠是這 10 隻之中唯一單一屬性的成員（純龍系）。其餘每一隻都擁有兩種屬性，分別是快龍與暴飛龍的龍／飛行、班基拉斯的岩石／惡、巨金怪的鋼／超能力、烈咬陸鯊的龍／地面、三首惡龍的惡／龍、杖尾鱗甲龍的龍／格鬥、多龍巴魯托的龍／幽靈，以及戟脊龍的龍／冰。',
      '黏美龍的差異二：牠也是唯一需要天氣條件才能進化的成員。幼體黏美兒不能只靠升級進化，必須在雨天或大霧的環境下才會變成黏美龍。',
    ],
  },
};

/**
 * Card + tag colours for the collections hub, transcribed from InfoPoke.
 *
 * The 50/100/200/400/700/900/950 values below are Tailwind palette entries, and
 * the *pairings* are InfoPoke's, read off its own markup rather than invented:
 *
 *   card   bg-gradient-to-br from-{A}-50 to-{B}-50  +  border-{A}-200 / hover:{A}-400
 *   tag    bg-{hue}-100 text-{hue}-700
 *
 * InfoPoke ships its Tailwind output as an external /_nuxt/style.css that was
 * never saved alongside the HTML, so the utility *class strings* were recovered
 * from the markup and the hexes resolved from the standard palette. The hexes
 * that also appear literally in the saved pages (purple-50 #faf5ff, green-50
 * #f0fdf4, cyan-50 #ecfeff, orange-100 #ffedd5, pink-100 #fce7f3, indigo-100
 * #e0e7ff, gray-50 #f9fafb, yellow-400 #facc15, gray-400 #9ca3af, purple-500
 * #a855f7) all match, which is what makes the rest trustworthy.
 *
 * Two deliberate departures, both forced by this site being dark-first:
 *
 * 1. InfoPoke is light-only, so its -50 card gradient and -100 tag fill are
 *    near-white. Dropped onto a #21262d card they would glare, so dark mode
 *    substitutes the same hues' -950 (card) and -900 (tag) at measured alpha,
 *    with -300 text. Same hue family, same relative ordering, tuned for a dark
 *    surface. Alpha is not a free parameter: check_categories.mjs composites
 *    every one of these over the real card colour and fails below 4.5:1.
 *
 * 2. InfoPoke colours tags SEMANTICALLY, not by section — Alola is orange,
 *    Galar purple, Hisui cyan, Ancient amber, Future cyan, Event-Only pink,
 *    "All Generations" yellow. So TAG_TONES is keyed by what a tag *says*, and
 *    that is why regional's three tags are three different hues while its
 *    count is one number. A region's hue travels with the region, not the card.
 */
export const COLLECTION_TINTS = {
  legendary: { from: 'violet', to: 'fuchsia' },
  mythical: { from: 'pink', to: 'purple' },
  'ultra-beast': { from: 'indigo', to: 'cyan' },
  starter: { from: 'red', to: 'orange' },
  shiny: { from: 'yellow', to: 'amber' },
  paradox: { from: 'purple', to: 'fuchsia' },
  mega: { from: 'purple', to: 'indigo' },
  gigantamax: { from: 'red', to: 'yellow' },
  regional: { from: 'green', to: 'cyan' },
  upcoming: { from: 'slate', to: 'gray' },
};

/** Tailwind steps for every hue named above, as hex for light and rgb for dark. */
const HUES = {
  violet: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 700: '#6d28d9', 900: '#4c1d95', 950: '#2e1065' },
  fuchsia: { 50: '#fdf4ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9', 700: '#a21caf', 900: '#86198f', 950: '#4a044e' },
  pink: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 700: '#be185d', 900: '#831843', 950: '#500724' },
  purple: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 700: '#7e22ce', 900: '#581c87', 950: '#3b0764' },
  indigo: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 700: '#4338ca', 900: '#312e81', 950: '#1e1b4b' },
  cyan: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 700: '#0e7490', 900: '#164e63', 950: '#083344' },
  red: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 700: '#b91c1c', 900: '#991b1b', 950: '#450a0a' },
  orange: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 700: '#c2410c', 900: '#7c2d12', 950: '#431407' },
  yellow: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 700: '#a16207', 900: '#713f12', 950: '#422006' },
  amber: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 700: '#b45309', 900: '#78350f', 950: '#451a03' },
  green: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 700: '#15803d', 900: '#14532d', 950: '#052e16' },
  blue: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 700: '#1d4ed8', 900: '#1e3a8a', 950: '#172554' },
  slate: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 700: '#334155', 900: '#0f172a', 950: '#020617' },
  gray: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 700: '#374151', 900: '#111827', 950: '#030712' },
};

export const HUE_STEPS = HUES;

/**
 * '#1e3a8a' -> '30 58 138', for the `rgba(var(--x-rgb), a)` convention shared.css
 * already uses for --card-accent-rgb. Local rather than imported because
 * shared.js pulls in browser-facing modules and this file has to stay loadable
 * by `node scripts/check_categories.mjs` with no DOM.
 */
// "46, 16, 101" — COMMA-separated, because that is the shape every rgba(var(--x), a)
// on this site is written in (--card-accent-rgb, set in shared.js:229 from
// pokemon.rgb.join(', ')). It is load-bearing in a way that is invisible until it
// is too late: a SPACE-separated "46 16 101" makes rgba(46 16 101, 0.55) invalid,
// because rgb() may not mix space-separated components with a comma alpha, so the
// whole declaration is dropped at parse time and the element keeps its initial
// value — border 0px none, background-image none, transparent tag. No error, no
// warning, and a computed style that looks like a CSS selector typo.
export function rgbOf(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
}

/**
 * Alphas for the dark-theme substitutes. They live here rather than in the
 * stylesheet so that collections.html, the contrast assertions in
 * check_categories.mjs and a human reading the CSS all read the same number —
 * the earlier version of this idea kept them in two places, which is exactly the
 * kind of duplication gotcha 38 exists to prevent.
 */
export const TINT_ALPHA = { from: 0.55, to: 0.4, border: 0.35, borderHover: 0.7 };
export const TAG_ALPHA = { bg: 0.55 };

/** Card gradient + border, as the CSS custom properties collections.html sets. */
export function cardTintVars(tint) {
  const a = HUES[tint.from];
  const b = HUES[tint.to];
  return {
    // light: InfoPoke's opaque -50 pair and -200/-400 border, verbatim
    '--coll-tint-from': a[50],
    '--coll-tint-to': b[50],
    '--coll-tint-border': a[200],
    '--coll-tint-border-hover': a[400],
    // dark: the same hues at -950, and a -400 border because a -200/-900 line is
    // darker than the card it is supposed to separate
    '--coll-tint-from-rgb': rgbOf(a[950]),
    '--coll-tint-to-rgb': rgbOf(b[950]),
    '--coll-tint-border-rgb': rgbOf(a[400]),
    '--coll-tint-from-a': String(TINT_ALPHA.from),
    '--coll-tint-to-a': String(TINT_ALPHA.to),
    '--coll-tint-border-a': String(TINT_ALPHA.border),
    '--coll-tint-border-hover-a': String(TINT_ALPHA.borderHover),
  };
}

/**
 * Tag tones, keyed by meaning. Every entry is a hue that appears in InfoPoke's
 * own tag markup for the same concept where one exists — see the table above.
 * 'neutral' is for facts about absence (not yet built / not recorded),
 * which InfoPoke also renders in plain gray.
 */
export const TAG_TONES = {
  // InfoPoke: "All Generations" -> yellow
  spans: { hue: 'yellow', why: '涵蓋世代 — InfoPoke "All Generations"' },
  earliest: { hue: 'amber', why: '最早推出' },
  // InfoPoke: "Ancient" -> amber, "Future" -> cyan
  ancient: { hue: 'amber', why: 'InfoPoke "Ancient" -> amber' },
  future: { hue: 'cyan', why: 'InfoPoke "Future" -> cyan' },
  // InfoPoke: "Event-Only" -> pink
  eventOnly: { hue: 'pink', why: 'InfoPoke "Event-Only" -> pink' },
  // InfoPoke region hues: Alola -> orange, Galar -> purple, Hisui -> cyan
  alola: { hue: 'orange', why: 'InfoPoke "Alola" -> orange' },
  galar: { hue: 'purple', why: 'InfoPoke "Galar" -> purple' },
  hisui: { hue: 'cyan', why: 'InfoPoke "Hisui" -> cyan' },
  paldea: { hue: 'indigo', why: '帕底亞 — no InfoPoke precedent, kept off 古代/未來' },
  // A bare generation, when the tag is not also naming a region
  generation: { hue: 'indigo', why: '單一世代，無 InfoPoke 前例' },
  // Warm reads high, cool reads low — the two never share a card *and* a hue
  statHigh: { hue: 'red', why: '最高能力總和' },
  statLow: { hue: 'blue', why: '最低能力總和' },
  statBar: { hue: 'amber', why: '基礎經驗 200 以上' },
  breadth: { hue: 'green', why: '涉及屬性／對應寶可夢（廣度）' },
  baseSpecies: { hue: 'blue', why: '對應寶可夢' },
  // Repurposed from "尚無 artwork — 關於「沒有」的事實" (gray) when the real
  // artwork landed. Only the shiny card used it, and it now reports a positive
  // count, which gray would read as "absent" — the exact inversion. Gold is the
  // accent this category's own hero already uses, and shiny reads gold.
  shinyArt: { hue: 'amber', why: '已收錄的真實異色 artwork 數量' },
  rendering: { hue: 'indigo', why: '呈現方式（CSS 濾鏡）' },
  neutral: { hue: 'gray', why: '尚未建立／資料未收錄' },
};

/** Resolve a tone key to the CSS custom properties one .coll-tag needs. */
export function tagToneVars(toneKey) {
  const tone = TAG_TONES[toneKey];
  if (!tone) return null;
  const h = HUES[tone.hue];
  return {
    '--tag-bg': h[100],
    '--tag-bg-rgb': rgbOf(h[900]),
    '--tag-bg-a': String(TAG_ALPHA.bg),
    '--tag-text': h[700],
    '--tag-text-dark': h[300],
  };
}

/**
 * The collections hub: 11 cards in 4 groups, rendered by collections.html.
 *
 * The `count` and `stats` fields are DUPLICATED from the category configs on
 * purpose, and that duplication is the point worth understanding.
 *
 * The hub is a navigation page. Computing its numbers live would mean fetching
 * pokemon_data.json (614 KB) and, for the regional card, evolution_chains.json
 * too — 900 KB and two requests so a landing page can print "71". So the numbers
 * are written down here instead.
 *
 * Written-down numbers drift. That is normally the argument for computing them,
 * and here it is answered by an assertion rather than by a fetch:
 * `scripts/check_categories.mjs` recomputes every member count and every `stats`
 * triple from the real selectors and fails if this table disagrees. So the hub
 * cannot go stale silently — editing a selector without editing this table breaks
 * a test, and `node scripts/check_categories.mjs` is the command to run after
 * touching either side. The same file also asserts the 9 slugs here are exactly
 * the 9 in HUB_SLUGS, in the same order, so a card can never point at a category
 * that does not exist or appear twice — HUB_SLUGS rather than CATEGORY_SLUGS
 * because those two are no longer the same list (600族 is a page without a card).
 *
 * `stats` is tiles(members).slice(1) — the count is already the card's big
 * number, so the first tile would be redundant. See that assertion too.
 */
export const COLLECTION_GROUPS = [
  {
    key: 'rare',
    title: '稀有與傳說',
    desc: '遊戲裡最難以取得的那些寶可夢。',
    items: [
      { slug: 'legendary', count: 71, stats: [[9, '涵蓋世代', 'spans'], [690, '最高能力總和', 'statHigh'], [65, '基礎經驗 200 以上', 'statBar']] },
      { slug: 'mythical', count: 23, stats: [[9, '涵蓋世代', 'spans'], ['100%', '皆為活動限定', 'eventOnly'], [1, '第九世代', 'generation']] },
      { slug: 'ultra-beast', count: 12, stats: [['第 7 世代', '阿羅拉地區', 'alola'], [420, '最低能力總和', 'statLow'], [600, '最高能力總和', 'statHigh']] },
    ],
  },
  {
    key: 'popular',
    title: '熱門分類',
    desc: '被點閱最多的三個分類。',
    items: [
      { slug: 'starter', count: 27, stats: [[9, '涵蓋世代', 'spans'], [5, '涉及屬性', 'breadth'], ['第 1 世代', '最早推出', 'earliest']] },
      { slug: 'shiny', count: 1025, stats: [[9, '涵蓋世代', 'spans'], [SHINY_IDS.size, '具真實異色 artwork（詳情頁）', 'shinyArt'], ['1', '呈現方式（CSS 濾鏡）', 'rendering']] },
      { slug: 'paradox', count: 22, stats: [[11, '古代', 'ancient'], [11, '未來', 'future'], ['第 9 世代', '帕底亞地區', 'paldea']] },
    ],
  },
  {
    key: 'event',
    title: '遊戲與活動',
    desc: '跟著作品與活動開放的收藏。',
    items: [
      // Not links, and deliberately not placeholders pointing at a page that does
      // not exist. `?cat=` accepts the slugs in CATEGORY_SLUGS and each of those
      // has a real page, so a tenth card would have to render as something, and
      // "即將推出" is the honest thing to render until the data for it exists.
      {
        slug: 'legends-za',
        upcoming: true,
        count: null,
        title: '傳說：Z-A',
        desc: '以都市傳說為舞台的全新章節，尚未公布完整名單。',
        stats: [['—', '尚未建立', 'neutral'], ['—', '資料未收錄', 'neutral'], ['—', '敬請期待', 'neutral']],
      },
      {
        slug: 'thirtieth',
        upcoming: true,
        count: null,
        title: '30 週年',
        desc: '三十週年紀念內容的寶可夢尚未收錄。',
        stats: [['—', '尚未建立', 'neutral'], ['—', '資料未收錄', 'neutral'], ['—', '敬請期待', 'neutral']],
      },
    ],
  },
  {
    key: 'forms',
    title: '特殊形態',
    desc: '同一隻寶可夢，在特定條件下換了模樣。',
    items: [
      { slug: 'mega', count: 48, stats: [[46, '對應寶可夢', 'baseSpecies'], [6, '涵蓋世代', 'spans'], [18, '涉及屬性', 'breadth']] },
      { slug: 'gigantamax', count: 32, stats: [[32, '對應寶可夢', 'baseSpecies'], [4, '涵蓋世代', 'spans'], ['第 8 世代', '伽勒爾地區', 'galar']] },
      { slug: 'regional', count: 58, stats: [[18, '阿羅拉', 'alola'], [20, '伽勒爾', 'galar'], [16, '他思岐', 'hisui']] },
    ],
  },
];

/**
 * Every slug `?cat=` accepts, in menu order. `category.html` builds its VALID set
 * from this and falls back to element [0] for an unknown value, so APPEND new
 * slugs — inserting one at the front silently changes the unknown-slug landing
 * page from 傳說寶可夢 to whatever you prepended.
 */
export const CATEGORY_SLUGS = [
  'legendary',
  'mythical',
  'ultra-beast',
  'starter',
  'shiny',
  'paradox',
  'mega',
  'gigantamax',
  'regional',
  'pseudo-legendary',
];

/**
 * The subset that has a card in the collections hub, in hub order.
 *
 * This is a separate list because "every category" and "every category with a hub
 * card" stopped being the same set when 600族 was added: the user wanted the page
 * and the index.html link, but not a tenth hub card. Until then
 * `check_categories.mjs` asserted `hubSlugs === CATEGORY_SLUGS` in two places
 * (the card list and COLLECTION_TINTS' keys), which quietly encoded "the hub
 * shows everything" as an invariant. That is not true of the site, and encoding
 * it is what would force the next category into a hub group it may not belong in.
 *
 * The checker now asserts against this list instead, and additionally asserts
 * that `CATEGORY_SLUGS \ HUB_SLUGS` is exactly `['pseudo-legendary']`, so adding
 * a category still requires a conscious decision about the hub.
 *
 * It is written out as literals rather than derived as
 * `CATEGORY_SLUGS.filter((s) => s !== 'pseudo-legendary')`. A filter is the
 * version that reads like the separate list while quietly defeating the point:
 * it is the *only* form under which appending a category to the registry
 * auto-joins the hub, which is precisely the unexamined insertion the separate
 * list exists to prevent. A literal cannot silently absorb the next category,
 * and a typo here fails `HUB_SLUGS ⊆ CATEGORY_SLUGS` rather than reading as
 * intent. Registry order and hub order happen to coincide, so the two
 * differences (`CATEGORY_SLUGS \ HUB_SLUGS` and `HUB_SLUGS \ CATEGORY_SLUGS`)
 * are each asserted with `===` on the exact value rather than as a length.
 */

/**
 * The categories that deliberately have no card in the collections hub. Read
 * before HUB_SLUGS on purpose: a filter-derived HUB_SLUGS referencing this is
 * then a *failing* check rather than a ReferenceError, which aborts the run
 * before any assertion is reported.
 */
export const NON_HUB_SLUGS = ['pseudo-legendary'];

export const HUB_SLUGS = [
  'legendary',
  'mythical',
  'ultra-beast',
  'starter',
  'shiny',
  'paradox',
  'mega',
  'gigantamax',
  'regional',
];


export function getCategory(slug) {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, slug) ? CATEGORIES[slug] : null;
}

/**
 * Does a member pass the selected filter? An unknown or absent key never hides
 * anything — a filter row that silently emptied the grid would look identical to
 * a data-loading failure.
 *
 * `filters` is passed in rather than looked up, because the page holds the
 * active config and this module has no module-level "current slug" to read.
 */
export function passesFilter(member, filterKey, filters) {
  if (!filterKey || filterKey === 'all' || !filters?.length) return true;
  const active = filters.find((f) => f.key === filterKey);
  return active?.test ? active.test(member) : true;
}
