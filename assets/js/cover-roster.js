/**
 * The 24 cover Pokémon, as `[id, edition]` pairs, in generation order and then by
 * the game that put them on a box.
 *
 * WHY THIS IS A MODULE AND NOT A LITERAL IN EACH PAGE
 * ----------------------------------------------------
 * Three pages wanted this list and two of them had already written it out:
 * `spectrum.html` as `COVERS`, `colors-generator.html` as `LEGENDS`, byte-for-byte
 * the same 24 pairs. A third copy would have been a third thing to keep right, and
 * the two existing copies were already in violation of the comment either one of
 * them carries — `spectrum.html` said "one list of the cover roster is a better
 * answer than two that can disagree" while being the second list.
 *
 * `check_cover_roster.mjs` asserts the absence as well as the content: no page may
 * define a roster of its own. That direction matters. An assertion that a file IS
 * present is satisfied by the file coming back, so only an absence can hold the
 * single-source claim shut — and it has to run on comment-stripped source, or it is
 * satisfied by the paragraph above explaining what was removed. That is the same
 * trap §3.W recorded for the `<datalist>` on `color-game.html`, which is why
 * `htmlCode` exists beside `html` in that file.
 *
 * IDS AND EDITIONS ONLY, NEVER NAMES
 * ----------------------------------
 * `pokemon_data.json` carries the official zh-TW name for every one of them, and a
 * second copy of a name is a second thing to keep right. `check_cover_roster.mjs`
 * asserts that all 24 resolve to a record with a name.
 *
 * The edition label is kept rather than dropped, because 383 and 382 are different
 * species AND different games, and a grid of 24 identical-looking sprites with no
 * edition would not say why those 24. `cries.html` imports only `COVER_IDS`: its
 * filter is a narrowing and prints no per-species label, so an edition it never
 * renders would be a second field nothing reads.
 *
 * WHY THESE 24
 * ------------
 * Ordering matters and is not alphabetical. It reads the way someone who played them
 * remembers them — Mewtwo then Mew, the Box legendaries by version,
 * Groudon/Kyogre/Rayquaza by game — and it is why the 8-wide grid in
 * `colors-generator.html` lands where it does: gen 1's two are followed by gen 2's
 * two, so the first row is Kanto, Johto and Hoenn rather than three of Hoenn.
 *
 * Two of the 24 have a near-white primary (Reshiram #FFFFFF at 36.5%, Solgaleo
 * #FBF7EE at 37.8%) and `colors-generator.html` says so under its grid. They are on
 * the list because a cover Pokémon is a cover Pokémon, not because their palette is a
 * good demo — dropping the two that flattered the page would be curating the
 * evidence.
 *
 * Two of them (Alolan Exeggutor, Hisuian Samurott) are deliberately NOT here even
 * though they are box legendaries: they would need form artwork that none of the
 * three pages has a reason to load.
 *
 * THE SOURCE FILTER BITES, AND THAT IS HONEST
 * -------------------------------------------
 * A page offering this roster still has to intersect it with whatever it actually
 * has. On `cry_features.json`'s 最新錄音 all 24 are offered; on 舊版錄音 (ids 1–649,
 * Gen 1–5) **thirteen** survive; on 第一世代合成 only 150 and 151 do. `cries.html`
 * prints the live number on its chip for exactly this reason — a filter labelled
 * 封面神獸 that quietly yields 13 rows under a different recording is a filter whose
 * count the reader cannot predict. A grid of two is a real answer to 「這裡有什麼」,
 * not a layout failure.
 */

/** @type {ReadonlyArray<[number, string]>} */
export const COVER_ROSTER = Object.freeze([
  [150, '關都 · 銀'], [151, '關都 · 金'],
  [250, '城都 · 金'], [249, '城都 · 銀'],
  [383, '豐緣 · 紅寶石'], [382, '豐緣 · 藍寶石'], [384, '豐緣 · 綠寶石'],
  [483, '神奧 · 鑽石'], [484, '神奧 · 珍珠'], [487, '神奧 · 白金'],
  [643, '合眾 · 黑'], [644, '合眾 · 白'], [646, '合眾 · 黑2／白2'],
  [716, '卡洛斯 · X'], [717, '卡洛斯 · Y'], [718, '卡洛斯 · Z'],
  [791, '阿羅拉 · 太陽'], [792, '阿羅拉 · 月亮'], [800, '阿羅拉 · 究極之日'],
  [888, '伽勒爾 · 劍'], [889, '伽勒爾 · 盾'], [890, '伽勒爾 · 劍／盾'],
  [1007, '帕底亞 · 朱'], [1008, '帕底亞 · 紫'],
]);

/** The ids alone, for a page that narrows by them and prints no edition.
 *
 *  Derived from `COVER_ROSTER` rather than written out beside it: a second list of
 *  24 numbers is 24 chances to disagree with the 24 pairs, and the failure is
 *  silent — a chip that filters to a set nobody can name. */
export const COVER_IDS = new Set(COVER_ROSTER.map(([id]) => id));
