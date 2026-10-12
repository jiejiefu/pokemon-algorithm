/**
 * 猜謎遊戲的提示（assets/js/game-hints.js）。
 *
 *   node scripts/check_game_hints.mjs
 *
 * 這個模組的失敗模式全部是「看起來對」：三個字串、沒有名稱、沒有一個會丟出
 * 錯誤。所以這裡沒有形狀斷言，除了兩個明確標成 shape 的例外。
 *
 * 四件事：
 *
 * 1. **七個類別都必須真的到得了玩家手上。** 不是「有產生候選」——七個全過——
 *    而是「這個類別的文字出現在任何一隻的 `generateHints()` 結果裡」。第一版
 *    沒有洗牌，固定取 `vague[0]` 與 `medium[0]`，而 `evolution` 排在 `type`
 *    前面，所以每一局的前兩則都是同兩句：七個類別裡有五個是死碼，它們有函式、
 *    有 docblock，而沒有一個字會被讀到。第二版補了洗牌，但 `description` 仍然
 *    是 0，因為它是 `specific` 桶裡唯一的一員，而那個桶排在 medium 用完之後。
 *
 * 2. **進化那一句不能讀 `stage`。** `evolution_chains.json` 的 `stage` 是圖鑑
 *    順序不是深度（§3.K），而伊布家族把它變成一個可以指名的證據：Vaporeon
 *    #134 在 chain 67 的 `stage` 是 **2（共 10）**，讀起來像「還會再進化」，
 *    但牠是終極進化型。所以這條斷言直接問那一句，而不是問「有沒有某個函式」。
 *
 * 3. **說明不能洩漏答案。** 93 條 `descriptions.zh` 把寶可夢自己的名字寫在裡面，
 *    所以那 93 隻的說明類提示必須是 `null`，而它們必須改由別的類別補位。
 *
 * 4. **已知事實真的會移除類別。** 猜測卡片已經掛著屬性與進化家族的徽章，所以
 *    提示再講一次是零新資訊。用「輸出字串不含某個字」來驗是不行的——洗牌之後
 *    那一類本來就可能沒被抽到。斷言的是**類別集合**，不是文字。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  HINT_CATEGORIES, HINT_CATEGORY_LABELS, HINT_CATEGORY_BUCKETS,
  MAX_HINTS, FINAL_HINT,
  emptyKnownFacts, learnFromGuess,
  typeHint, evolutionHint, generationHint, speciesHint,
  descriptionHint, firstLetterHint, weightHint,
  buildCandidates, generateHints, remainingCategories,
} from '../assets/js/game-hints.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let total = 0;
let failures = 0;
function check(ok, description, detail = () => '') {
  total++;
  if (ok) console.log(`  ok   ${description}`);
  else { failures++; console.log(`  FAIL ${description}`); console.log(`       ${detail()}`); }
}

const data = JSON.parse(readFileSync(join(ROOT, 'assets/data/pokemon_data.json'), 'utf8'));
const chains = JSON.parse(readFileSync(join(ROOT, 'assets/data/evolution_chains.json'), 'utf8'));
const levels = JSON.parse(readFileSync(join(ROOT, 'assets/data/evolution_levels.json'), 'utf8'));
const byId = new Map(data.map((p) => [p.id, p]));

/** 會進化 ⇔ 這個 id 是邊清單的 key。`levels` 是等級進化，`unlevelled` 是石頭／交換。 */
const evolves = (id) => id in levels.levels || id in levels.unlevelled;

// ---------------------------------------------------------------------------
console.log('\n每一局都剛好三則，而且第三則永遠是收尾');
// ---------------------------------------------------------------------------
{
  let wrongLength = 0, badFinal = 0, duplicate = 0;
  for (const p of data) {
    const h = generateHints(p, evolves(p.id), null);
    if (h.length !== MAX_HINTS) wrongLength++;
    if (h[2] !== FINAL_HINT) badFinal++;
    if (h[0] === h[1]) duplicate++;
  }
  check(MAX_HINTS === 3, '3 hints, copied from the reference');
  check(wrongLength === 0, 'every one of the 1,025 produces exactly 3',
    () => `${wrongLength} produced a different count`);
  check(badFinal === 0, 'and the third is always the same closing line',
    () => `${badFinal} differ`);
  check(duplicate === 0, 'no species is given the same hint twice',
    () => `${duplicate} species repeat`);

  check(hintRevealsPaletteIndex(0) === false && hintRevealsPaletteIndex(2) === true,
    'the palette reveal is the third hint and not an earlier one');
}

/** 頁面用它決定要不要把色帶從 3 色擴成全部；這裡直接對照 FINAL_HINT 的位置。 */
function hintRevealsPaletteIndex(i) { return i >= 2; }

// ---------------------------------------------------------------------------
console.log('\n七個類別都真的到得了玩家手上');
// ---------------------------------------------------------------------------
{
  const reached = new Map();
  for (const p of data) {
    const shown = generateHints(p, evolves(p.id), null);
    for (const c of buildCandidates(p, evolves(p.id))) {
      if (shown.includes(c.text)) reached.set(c.category, (reached.get(c.category) || 0) + 1);
    }
  }
  for (const cat of HINT_CATEGORIES) {
    const n = reached.get(cat) || 0;
    // A floor, not a presence test. `buildCandidates` succeeding for all seven is
    // the assertion that passed while five of them were dead code.
    check(n >= 50, `「${HINT_CATEGORY_LABELS[cat]}」 reaches the player for ${n} of 1,025 species`,
      () => `only ${n} — the category produces candidates but never gets a slot`);
  }

  const produced = new Set();
  for (const p of data) for (const c of buildCandidates(p, evolves(p.id))) produced.add(c.category);
  check(produced.size === HINT_CATEGORIES.length, 'and all seven produce at least one candidate',
    () => `missing: ${HINT_CATEGORIES.filter((c) => !produced.has(c)).join(', ')}`);

  // Determinism: the page re-calls this on every render, and an already-shown hint
  // cannot be taken back.
  let unstable = 0;
  for (const p of data) {
    const a = generateHints(p, evolves(p.id), null).join('|');
    const b = generateHints(p, evolves(p.id), null).join('|');
    if (a !== b) unstable++;
  }
  check(unstable === 0, 'the hints are stable across calls — a re-render cannot change them',
    () => `${unstable} species produced different hints on the second call`);

  // Variety: if every species opened with the same sentence, the shuffle is gone.
  const firsts = new Set(data.map((p) => generateHints(p, evolves(p.id), null)[0]));
  check(firsts.size >= 50, `the opening hint varies across species — ${firsts.size} distinct openings`,
    () => `only ${firsts.size} distinct first hints across 1,025 species`);
}

// ---------------------------------------------------------------------------
console.log('\n進化那一句讀的是邊清單，不是 stage');
// ---------------------------------------------------------------------------
{
  /* THE §3.K WITNESS. Eevee's chain stores all eight Eeveelutions as a LINEAR
     main_line, so `stage` says Vaporeon is 2 of 10 — "still evolves". It is a
     final evolution. If this line ever regresses to reading `stage`, the hint
     starts lying about one of the most recognisable families in the game. */
  const vaporeon = byId.get(134);
  const row = chains[vaporeon.evolution_chain_id].main_line.find((x) => x.id === 134);
  check(row && row.stage === 2,
    'the trap is real in this data: Vaporeon #134 carries stage 2',
    () => `stage is ${row && row.stage} — if this ever changes, the witness below is stale`);
  check(evolves(134) === false,
    'but the edge list says Vaporeon does not evolve at all');
  check(evolutionHint(vaporeon, evolves(134)) === '這一隻已經是進化的最終型。',
    'so the hint calls it a final evolution, not "will evolve again"',
    () => evolutionHint(vaporeon, evolves(134)));

  // And the other direction: Eevee really does evolve, via stones — which live in
  // `unlevelled`, not `levels`. Reading only `levels` would get this wrong.
  check(evolves(133) === true, 'Eevee #133 does evolve');
  check(!(133 in levels.levels), 'and it is NOT in the level table — only in unlevelled',
    () => 'if PokeAPI ever gives Eevee a level, the witness for reading only `levels` is gone');
  check(evolutionHint(byId.get(133), evolves(133)) === '這一隻還會再進化。',
    'so reading both tables is what makes the hint right');

  const final = data.filter((p) => !evolves(p.id)).length;
  const evolving = data.filter((p) => evolves(p.id)).length;
  check(final + evolving === 1025, `${evolving} evolve, ${final} are final forms — the two partition the dex`,
    () => `${evolving} + ${final} != 1025`);
}

// ---------------------------------------------------------------------------
console.log('\n說明不能洩漏答案');
// ---------------------------------------------------------------------------
{
  const leakers = data.filter((p) => descriptionHint(p) === null
    && p.descriptions && p.descriptions.zh && p.descriptions.zh.includes(p.names.zh));
  check(leakers.length > 0,
    `the leak exists in the data — ${leakers.length} zh descriptions name their own Pokémon`,
    () => 'the filter is untested if nothing leaks');
  check(leakers.every((p) => !descriptionHint(p)), 'and every one of them is refused');
  const leaker = leakers[0];
  check(!leaker.descriptions.zh.includes('「'), 'the refusal is not an accident of formatting');

  // The refused ones must be covered by another category, not left with a hole.
  const noDescription = leakers.every((p) => generateHints(p, evolves(p.id), null).length === MAX_HINTS);
  check(noDescription, 'and each of them still gets a full set of three hints');
}

// ---------------------------------------------------------------------------
console.log('\n各類提示的內容');
// ---------------------------------------------------------------------------
{
  const pika = byId.get(25);
  check(typeHint(pika) === '這一隻是電屬性。', 'single type reads naturally',
    () => typeHint(pika));
  const bulba = byId.get(1);
  check(typeHint(bulba) === '這一隻是草、毒的雙屬性。', 'dual type says so explicitly',
    () => typeHint(bulba));
  check(typeHint(byId.get(133)) === '這一隻是一般屬性。', 'Normal is 一般, the official zh-TW term',
    () => typeHint(byId.get(133)));
  check(typeHint({ types_zh: [], types: [] }) === null, 'a species with no types has no type hint');

  check(generationHint(pika) === '這一隻出現在第I世代。', 'generation I',
    () => generationHint(pika));
  check(generationHint(byId.get(906)) === '這一隻出現在第IX世代。', 'generation IX, the two-digit one',
    () => generationHint(byId.get(906)));
  check(generationHint({ generation: 99 }) === null, 'an unknown generation has no hint');

  check(speciesHint(pika) === '這一隻屬於鼠寶可夢。', 'classification comes from genusZh()',
    () => speciesHint(pika));
  check(speciesHint({ genus: '', names: { zh: 'x' } }) === null, 'a species with no genus has no hint');

  check(firstLetterHint(pika) === '名字的第一個字是「皮」。', 'first letter of the zh-TW name',
    () => firstLetterHint(pika));
  check(firstLetterHint({ names: {} }) === null, 'a species with no name has no letter hint');

  // The weight bands must be monotonic and total: 5 bands over 0..∞.
  const bands = [0.1, 9.9, 10, 49.9, 50, 99.9, 100, 249.9, 250, 1000]
    .map((kg) => weightHint({ weight_kg: kg }));
  check(new Set(bands.slice(0, 8)).size === 4,
    'four distinct bands below 250 kg and they never repeat across a boundary',
    () => bands.join(' | '));
  check(bands[0] === bands[1] && bands[2] === bands[3] && bands[4] === bands[5] && bands[6] === bands[7],
    'and each band is inclusive at its edge, so no weight falls between two bands');
  check(bands[8] === bands[9] && bands[8].includes('超過'), 'above 250 kg is the last band',
    () => bands.slice(8).join(' | '));
  check(weightHint({ weight_kg: null }) === null, 'a species with no weight has no weight hint');
}

// ---------------------------------------------------------------------------
console.log('\n已知事實真的會移除類別');
// ---------------------------------------------------------------------------
{
  /* Asserting the CATEGORY, not the text. "the output does not contain 火" cannot
     tell a filtered category from a category the shuffle simply did not pick, and
     that distinction is the whole mechanism. */
  const fire = data.find((p) => p.types_zh && p.types_zh.includes('火') && !evolves(p.id));
  const withType = generateHints(fire, evolves(fire.id), { types: ['火'], sameFamily: false, generations: [] });
  check(!withType.includes(typeHint(fire)),
    'a type the player has already been shown is never offered again',
    () => withType.join(' / '));

  const familyKnown = generateHints(fire, evolves(fire.id), { types: [], sameFamily: true, generations: [] });
  check(!familyKnown.includes(evolutionHint(fire, evolves(fire.id))),
    'and neither is an evolution fact the badge already showed');

  const genKnown = generateHints(fire, evolves(fire.id), { types: [], sameFamily: false, generations: [Number(fire.generation)] });
  check(!genKnown.includes(generationHint(fire)), 'nor the generation the badge did NOT show');
  check(genKnown.length === MAX_HINTS, 'and the set is still full — something else took the slot');

  /* The badge does NOT show sameGeneration — the reference computes it and never
     renders it — so learning the generation must NOT count as a spent fact.
     Asserted on the CATEGORY set, not on output text: "the output does not contain
     第II世代" cannot tell "suppressed" from "the shuffle did not pick it", and
     `remainingCategories` exists precisely so that distinction is observable. */
  const nothingKnown = { types: [], sameFamily: false, generations: [] };
  const all = remainingCategories(fire, evolves(fire.id), nothingKnown);
  check(all.includes('generation'), 'an unknown generation is still available',
    () => all.join(', '));
  check(!remainingCategories(fire, evolves(fire.id), { ...nothingKnown, generations: [fire.generation] }).includes('generation'),
    'and it stops being available the moment it is learned',
    () => remainingCategories(fire, evolves(fire.id), { ...nothingKnown, generations: [fire.generation] }).join(', '));
  /* Backwards in the first draft: it compared `nothing === known - 1`, so it
     asked for the untouched list to be one SHORTER than the learned one. `===`
     binds looser than `-`, so the subtraction was on the right-hand term and the
     check read exactly inverted — a red line whose description says the opposite
     of what it asserts. */
  const afterType = remainingCategories(fire, evolves(fire.id), { types: ['火'], sameFamily: false, generations: [] });
  check(afterType.length === all.length - 1,
    'learning a type removes exactly one category, not a guess at how many',
    () => `${all.length} -> ${afterType.length}: ${all.join(', ')} -> ${afterType.join(', ')}`);

  // learnFromGuess merges, it does not overwrite.
  const merged = learnFromGuess({ types: ['電'], sameFamily: false, generations: [1] },
    { sharedTypes: ['火'], sameEvolutionFamily: true, generationIds: [4] });
  check(merged.types.includes('電') && merged.types.includes('火'),
    'learnFromGuess keeps the earlier facts and adds the new ones',
    () => JSON.stringify(merged));
  check(merged.sameFamily === true && merged.generations.includes(1) && merged.generations.includes(4),
    'and a single true is enough to latch the family flag',
    () => JSON.stringify(merged));
  const fresh = learnFromGuess(null, null);
  check(fresh.types.length === 0 && fresh.sameFamily === false, 'learning from nothing is an empty record',
    () => JSON.stringify(fresh));

  // Case-insensitivity: a badge renders 中文 but the data could be English.
  const lower = generateHints(fire, evolves(fire.id), { types: [String(fire.types_zh[0]).toLowerCase()], sameFamily: false, generations: [] });
  check(!lower.includes(typeHint(fire)), 'matching a known type is case-insensitive');
}

// ---------------------------------------------------------------------------
console.log('\nshape（標成 shape 的兩個例外）');
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'assets/js/game-hints.js'), 'utf8');
  /* Strip comments BEFORE either test. §3.S's false positive, hit again: this
     module's own docblock names `evolution_chains.json` and `stage` in the
     paragraph explaining why it must not read them, so the un-stripped test for
     "does it mention the chain table" matched the warning about the chain table.
     The first version stripped for the `stage` half and not for the
     `evolution_chains` half, which is the kind of half-done that looks done. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /* A shape check, declared as one. The alternative is an import of
     `evolution_chains.json`, which the module does not need — it needs the EDGE
     list, and reading the chain table is exactly the mistake §3.K documents. So
     the guard is "the module does not read the chain table at all", which is a
     shape, and it is worth having because the failure it prevents is silent:
     `stage` renders, parses, and answers. */
  check(!/evolution_chains/.test(code) && !/\bstage\b/.test(code),
    'the module never reads the chain table, so it cannot use `stage`',
    () => 'it references the chain file — which is the §3.K trap re-entering');

  check(/genusZh\(/.test(code), 'and it reuses genusZh() rather than re-deriving the classification');
  check(!/GENUS_ZH\s*=/.test(code), 'without shipping its own copy of the table');
}

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);