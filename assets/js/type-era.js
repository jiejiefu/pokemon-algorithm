/**
 * Which types existed in which generation — and therefore what a given species
 * was TYPED as in that generation.
 *
 * WHY THIS EXISTS AT ALL, since `pokemon_data.json` already carries a `types`
 * array. Because PokeAPI's `/pokemon/{id}` answers with a species' CURRENT
 * typing, and 24 of the 1,025 changed type after they were introduced. So on a
 * Gen 1 board the data would spawn 皮皮 as Fairy, 小磁怪 as Electric/Steel and
 * 魔牆人偶 as Psychic/Fairy, and the type denominator would come out 17 instead
 * of 15 — a Fairy type in a generation Fairy does not exist in.
 *
 * SCOPE IS life.html ONLY, and that is a decision rather than a limitation of
 * scope. detail.html showing 皮皮 as Fairy is CORRECT: the dex describes
 * today's Pokémon. Historical typing is only meaningful for a page simulating
 * what could have existed in a past generation, and rewriting the shared table
 * would make the detail page wrong in order to make the board right.
 *
 * PURE, AND THEREFORE CHECKABLE. No DOM, no fetch, no engine import — which is
 * the only reason `check_life_page.mjs` can assert the 24 overrides against all
 * 1,025 records and all 9 generations in bare Node.
 */

import { TYPE_CHART_ORDER } from './type-chart.js';

/**
 * The generation a type was introduced in.
 *
 * 15 types existed in Gen 1 (the games' original set), 鋼/Steel and 惡/Dark
 * arrived together in Gen 2, and 妖精/Fairy in Gen 6. Everything else is Gen 1,
 * which is why they are stated as a spread rather than one line each.
 */
export const TYPE_INTRO_GEN = {
  Normal: 1, Fighting: 1, Flying: 1, Poison: 1, Ground: 1, Rock: 1, Bug: 1,
  Ghost: 1, Fire: 1, Water: 1, Grass: 1, Electric: 1, Psychic: 1, Ice: 1,
  Dragon: 1,
  Steel: 2, Dark: 2,
  Fairy: 6,
};

/**
 * The historical typing of every species whose modern typing postdates its own
 * generation — 24 records across 6 generations.
 *
 * NOT DERIVABLE, and the reason is the whole point of the table. The obvious
 * rule is "drop the types that did not exist yet", and it gets 8 of the 24
 * wrong:
 *
 *   - 5 would be left with NO type at all. 皮皮, 皮可西, 皮寶寶, 波克比 and
 *     布魯 are Fairy-first in the data, and Fairy is post-Gen-6, so dropping it
 *     empties the list rather than correcting it. Their real pre-Fairy typing is
 *     一般/Normal.
 *   - 3 would lose a type they genuinely had. 波克基古 and 波克基斯 are
 *     Flying-first in the data, but Togetic was 一般／飛行 BEFORE Fairy arrived,
 *     so dropping Fairy leaves a monotype that never existed.
 *
 * So this is a stated fact table, and `check_life_page.mjs` holds it to two
 * things that are not restatements of it: that its key set is EXACTLY the set of
 * species the data renders anachronistic (one row too many or too few is a red
 * test, so it cannot rot as a species gains or loses a type), and that no value
 * here names a type introduced after that species' own generation.
 */
export const ERA_TYPE_OVERRIDES = new Map([
  // Gen 1 — Fairy (6) and Steel (2) had not been invented yet.
  [35, ['Normal']],   // 皮皮     Fairy -> 一般
  [36, ['Normal']],   // 皮可西   Fairy -> 一般
  [39, ['Normal']],   // 胖丁     Normal/Fairy -> 一般
  [40, ['Normal']],   // 胖可丁   Normal/Fairy -> 一般
  [81, ['Electric']], // 小磁怪   Electric/Steel -> 電
  [82, ['Electric']], // 三合一磁怪 Electric/Steel -> 電
  [122, ['Psychic']], // 魔牆人偶 Psychic/Fairy -> 超能力

  // Gen 2 — Fairy (6) only.
  [173, ['Normal']],        // 皮寶寶     Fairy -> 一般
  [174, ['Normal']],        // 寶寶丁     Normal/Fairy -> 一般
  [175, ['Normal']],        // 波克比     Fairy -> 一般
  [176, ['Normal', 'Flying']], // 波克基古 Fairy/Flying -> 一般／飛行
  [183, ['Water']],         // 瑪力露     Water/Fairy -> 水
  [184, ['Water']],         // 瑪力露麗   Water/Fairy -> 水
  [209, ['Normal']],        // 布魯       Fairy -> 一般
  [210, ['Normal']],        // 布魯皇     Fairy -> 一般

  // Gen 3 — Fairy (6) only.
  [280, ['Psychic']], // 拉魯拉絲 Psychic/Fairy -> 超能力
  [281, ['Psychic']], // 奇魯莉安 Psychic/Fairy -> 超能力
  [282, ['Psychic']], // 沙奈朵   Psychic/Fairy -> 超能力
  [298, ['Normal']],  // 露力麗   Normal/Fairy -> 一般

  // Gen 4 — Fairy (6) only.
  [303, ['Steel']],         // 大嘴娃   Steel/Fairy -> 鋼
  [439, ['Psychic']],       // 魔尼尼   Psychic/Fairy -> 超能力
  [468, ['Normal', 'Flying']], // 波克基斯 Fairy/Flying -> 一般／飛行

  // Gen 5 — Fairy (6) only.
  [546, ['Grass']], // 木棉球 Grass/Fairy -> 草
  [547, ['Grass']], // 風妖精 Grass/Fairy -> 草
]);

/**
 * The types that exist in `gen`, in the chart's own order.
 *
 * ORDERED BY `TYPE_CHART_ORDER` rather than by introduction or by the object's
 * key order, because this list is also what the type drawer prints and the chart
 * order is the one the rest of the site already uses (types.html).
 */
export function typesForGeneration(gen) {
  return TYPE_CHART_ORDER.filter(t => TYPE_INTRO_GEN[t] <= gen);
}

/** How many types `gen` has: 15 in Gen 1, 17 in Gens 2-5, 18 from Gen 6. */
export function generationTypeCount(gen) {
  return typesForGeneration(gen).length;
}

/**
 * The type era the Let's Go board counts as.
 *
 * 7, not 6. Let's Go Pikachu / Let's Go Eevee shipped 2018-02-16, which is after
 * Sun & Moon (2016-11) and Ultra Beasts (2017-01) and before USUM — the Gen 7
 * era. Fairy arrived in Gen 6 (2013), so 7 and "no filter at all" name the same
 * 18 types, and the generation number is kept because it keeps one mechanism:
 * `eraTypes` is asked for an era rather than being told whether to filter.
 *
 * WHY IT IS NOT 5, which is the intuitive answer: the modes are named after the
 * Dex they draw from (Gen 1, Johto's 151), not after the year the game shipped.
 * A Let's Go board is a 2018 game that happens to use the Gen 1 roster, so the
 * ROSTER stays Gen 1 and the TYPING follows the game — a Let's Go Clefairy is
 * Fairy, because in the game it is.
 */
export const LETS_GO_TYPE_ERA = 7;

/**
 * What `species` was typed as in `gen`, defaulting to its own generation.
 *
 * THE OVERRIDE FIRES ONLY WHEN THE MODERN TYPING IS ANACHRONISTIC, which is the
 * one thing the table means and the first version did not do. It looked the
 * override up unconditionally, so on a Let's Go board — which is Gen 7 by
 * `LETS_GO_TYPE_ERA` — 皮皮 came back 一般 instead of 妖精: the row for a game from
 * 2018 was being decided by a table about games before 1990.
 *
 * The condition is derivable rather than a flag, because it is exactly the
 * question the table answers: the modern typing becomes valid once the LAST of
 * the species' own types exists. 水伊布's latest type is Steel, introduced in
 * Gen 2, so a Gen 1 board asks the table (電) and a Gen 2 board does not
 * (電/鋼) — and 皮皮's latest is Fairy, Gen 6, so Let's Go does not ask either.
 */
export function eraTypes(species, gen = species.generation) {
  const latestTypeGen = Math.max(...species.types.map(t => TYPE_INTRO_GEN[t] ?? 1));
  if (gen >= latestTypeGen) return species.types;

  const override = ERA_TYPE_OVERRIDES.get(species.id);
  if (override) return override;
  return species.types.filter(t => TYPE_INTRO_GEN[t] <= gen);
}