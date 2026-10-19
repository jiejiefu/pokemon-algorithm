/**
 * Moves pages static regression test
 *
 *   node scripts/check_moves_page.mjs
 *
 * The static half of the §3.G4 split: reads moves.html, move.html, moves.css and
 * moves.js off disk. A stylesheet contract is checked by reading it, and this
 * costs a fraction of a second.
 *
 * What the pages PRODUCE is check_moves_page_browser.mjs, which drives both over
 * CDP. Three defects on this pair are invisible to a text reader — the filter row
 * count, the `[hidden]` box, and whether the search box narrows anything — and
 * §3.G4's argument is that a static-only checker would report "PASS" over all of
 * them.
 *
 * Three existing checkers already read these pages and are NOT duplicated here,
 * because re-asserting a rule in a second file is a second place for it to be
 * wrong: check_js_syntax.mjs owns the `</body>`/`</html>` extent (§3.I1),
 * check_nav_pages.mjs owns the header/nav/toggle markup (§3.G2), and
 * check_page_module_api.mjs owns the named imports (§3.I). Both page sets are
 * self-selecting, so all three cover moves.html and move.html with no edit.
 *
 * moves.js is imported and executed, so the vocabulary tables, the formatters and
 * filterMoves() run against the real 919 rows rather than being shape-read.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MOVE_COLUMNS, MOVE_CLASS_ZH, typeBadgeSmHtml } from '../assets/js/shared.js';
import {
  MOVE_TARGET_ZH,
  MOVE_CATEGORY_ZH,
  MOVE_AILMENT_ZH,
  MOVE_EFFECT_SOURCE_ZH,
  MOVE_LEARN_METHODS,
  MOVE_LEARN_METHODS_ZH,
  moveUrl,
  movePowerText,
  moveAccuracyText,
  moveNumber,
  movePairText,
  movePriorityText,
  moveIsLearnable,
  moveHasLearners,
  moveSearchText,
  filterMoves,
  prepareMoves
} from '../assets/js/moves.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const LIST = read('moves.html');
const DETAIL = read('move.html');
const CSS = read('assets/css/moves.css');
const MOVES_JS = read('assets/js/moves.js');

/* Comments are masked before any stylesheet or source shape test. §3.S records
 * check_color_page.mjs's false positive: a rule-shaped regex over raw text walked
 * out of a comment that named a selector and "found" it in the next rule. Three
 * assertions here are rule-shaped, so all of them read the stripped copy. */
const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const MOVES = readData('moves_zh.json');
const COUNTS = readData('move_learners_count.json');
const rows = prepareMoves(MOVES);

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, eq } = C;

/** Keys of a generated map, ignoring the provenance record. */
function dataKeys(map) {
  return Object.keys(map).filter(k => k !== '_meta');
}

/* ===== the two files the split is about ===== */

/*
 * THE PAYLOAD SPLIT IS ASSERTED IN BOTH DIRECTIONS.
 *
 * moves.html needs 「N 隻可學」 (N can learn) on 919 rows and loads
 * move_learners_count.json (54 KB). move.html needs the actual list and loads
 * move_learners.json (424 KB). Asserting only the half that saves bytes would pass
 * on a moves.html that also pulls the 424 KB index — the mistake the split exists
 * to prevent, and one a reader pays for on every visit.
 */
ok(
  LIST.includes('loadMoveLearnersCount') && !/\bloadMoveLearners\b\s*[,)]/.test(LIST),
  'moves.html should load the counts-only file and NOT the full 424 KB reverse index'
);
ok(
  DETAIL.includes('loadMoveLearners') && !/\bloadMoveLearnersCount\b/.test(DETAIL),
  'move.html should load the full learner index and not also the counts file'
);
ok(
  LIST.includes('assets/js/moves.js') && DETAIL.includes('assets/js/moves.js'),
  'both pages should import the shared vocabulary module'
);

/* ===== §3.A: the two URL shapes ===== */

/* Comments are stripped before any source-shape test; §3.S records
 * check_color_page.mjs's false positive, a rule-shaped regex walking out of a
 * comment that named a selector and "finding" it in the next rule.
 *
 * String literals are deliberately NOT blanked as well. An earlier version
 * stripped them to dodge the explanatory sentences around each rule, and six
 * assertions below silently stopped matching real code because the masking was
 * removing the calls they asserted. §3.P's lesson twice over: a vacuous assertion
 * looks exactly like a passing one. The assertions below match the DANGEROUS
 * SPELLINGS specifically, and a comment naming one in backticks cannot produce
 * them. */
const stripComments = html => html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const listCode = stripComments(LIST);
const detailCode = stripComments(DETAIL);

/** Every way a hand-written move link can appear, and none of them may. */
const HAND_BUILT_MOVE_URL = /(?:href=|`|'|")\s*move\.html\?move=/g;
eq(
  [...listCode.matchAll(HAND_BUILT_MOVE_URL)].length + [...detailCode.matchAll(HAND_BUILT_MOVE_URL)].length,
  0,
  'neither page may write a move.html?move= href or template literal — moveUrl() does it'
);
ok(listCode.includes('moveUrl('), 'moves.html should reach the move URL through moveUrl()');
eq(
  moveUrl({ en: 'double-slap' }),
  'move.html?move=double-slap',
  'moveUrl() should encode the slug it is given'
);
eq(
  moveUrl('double-slap'),
  'move.html?move=double-slap',
  'moveUrl() should accept a bare slug as well than a row'
);
eq(
  moveUrl({ en: '100% 如意' }),
  `move.html?move=${encodeURIComponent('100% 如意')}`,
  'moveUrl() should percent-encode a slug'
);

// §3.A again, for species. move.html renders up to 1,025 learner cards, each a
// link; a hand-assembled species URL is exactly how nidoran-f and nidoran-m stop
// being distinct.
eq(
  [...detailCode.matchAll(/(?:href=|`|'|")\s*detail\.html\?slug=/g)].length,
  0,
  'move.html must not write a detail URL by hand — pokemonDetailUrl() does it'
);
ok(detailCode.includes('pokemonDetailUrl('), 'move.html should reach the species URL through pokemonDetailUrl()');

/* ===== the deep link types.html now sends ===== */

const typesHtml = read('types.html');

ok(
  LIST.includes("params.get('type')"),
  'moves.html should read ?type= from the URL — types.html links to moves.html?type=<slug>'
);
ok(
  typesHtml.includes('moves.html?type=${slug}'),
  'types.html should link to the per-type move list it filtered'
);

/* ===== types.html's roster: MECHANISM, beside the browser checker's OUTCOME ===== */

/*
 * `.chip-grid` and `.chip-item` are shared by THREE blocks on types.html — the
 * roster (links + a thumbnail), 招式 (moves: a span + a power number) and 特性
 * (abilities: a span + a count). The roster was given equal-width columns and a
 * stacked card; the other two are lists of short pills that want content-sized
 * widths.
 *
 * Every one of those declarations must therefore sit behind the `--roster`
 * modifier. `check_types_browser.mjs` asserts the CONSEQUENCE — that the other
 * two blocks remain flex rows whose cards differ in width — because a stylesheet
 * cannot state that. This asserts the MECHANISM, because a mutation that drops
 * the modifier from `flex: 1` is invisible to the browser checker until the
 * mobile breakpoint, and the two halves fail independently.
 */
const typesCss = typesHtml.replace(/\/\*[\s\S]*?\*\//g, '');
/*
 * Two of these eight were VACUOUS on arrival, which is why the harness is worth
 * the second it costs.
 *
 * The first version asked whether `.chip-grid--roster { … }` exists. Renaming it
 * to `.chip-grid { … }` left every OTHER `.chip-grid--roster` rule in the file, so
 * the assertion stayed green — satisfied by a page where the grid rule did not
 * carry the modifier at all, which is §3.B2's shape: a guard satisfiable by the
 * thing it exists to forbid. It now asks which rule declares `display: grid`.
 *
 * The second asked for `Math.abs(value + 25) < 3`, allowing for measurement
 * noise. -23 is 2 away, so the exact pre-fix value passed: a tolerance wide enough
 * to absorb the regression is not a tolerance. The measurement spans 25.0 / 25.4 /
 * 25.8 across three box sizes, so 1% covers all three and excludes both
 * neighbours.
 */
const rosterGridRule = typesCss.match(/\.chip-grid--roster\s*\{([^}]*)\}/);
ok(
  rosterGridRule && /display\s*:\s*grid/.test(rosterGridRule[1]),
  'types.html should scope the rule that turns the roster into a grid behind a --roster modifier',
  rosterGridRule ? rosterGridRule[1].trim().replace(/\s+/g, ' ').slice(0, 70) : 'no .chip-grid--roster { … } rule found'
);
/*
 * The bare `.chip-item` rule is shared by all three blocks, so these three
 * properties are what would equalise 招式 and 特性 if they leaked. They are
 * asserted ABSENT from the bare rule and PRESENT under the modifier — the pairing
 * §3.M records: asserting only the absence passes on a page where the roster was
 * never given the properties at all.
 */
const bareChipItem = typesCss.match(/\n\s*\.chip-item\s*\{([^}]*)\}/);
ok(
  bareChipItem && !/\b(flex\s*:|flex-direction\s*:)/.test(bareChipItem[1]),
  'the shared .chip-item rule must not carry flex or flex-direction — 招式 and 特性 use it too',
  bareChipItem ? bareChipItem[1].trim().replace(/\s+/g, ' ').slice(0, 60) : 'no bare .chip-item rule found'
);
const rosterChipItem = typesCss.match(/\.chip-grid--roster\s+\.chip-item\s*\{([^}]*)\}/);
ok(
  rosterChipItem && /flex-direction\s*:\s*column/.test(rosterChipItem[1]),
  'and the roster card should stack its image above its name'
);
ok(
  rosterChipItem && /\bflex\s*:\s*1\b/.test(rosterChipItem[1]),
  'and fill the grid track it is placed in — the rule that was missing when the first measurement found 60px cards in 96.7px tracks'
);
/*
 * The image inside the roster card is a 120×112 icon in a square box, so `contain`
 * is load-bearing: `fill` stretches it 7% horizontally. `check_types_browser.mjs`
 * asserts the computed value and the measured box; this is the declaration.
 */
/*
 * `object-fit` lives in its OWN rule. An earlier version named the selector and
 * took the first match — the rule ABOVE it, which sets width and height — and
 * failed on a correct page. §3.P's shape with the polarity reversed: the pattern
 * was too eager, answering about a different construct than the one it named.
 *
 * The harness caught it, because `test_check_moves_page` fails a run whose
 * BASELINE is red before it looks at a mutation. That is the one assertion here
 * that cannot be attacked through its input.
 *
 * So every rule on that selector is collected and the declaration is required in
 * one of them: "this selector declares X" is not "the first rule found does".
 */
const rosterImgRules = [...typesCss.matchAll(/\.chip-grid--roster\s+\.chip-item img\s*\{([^}]*)\}/g)].map(m => m[1]);
ok(
  rosterImgRules.some(body => /object-fit\s*:\s*contain/.test(body)),
  'the roster image should scale without distorting the 120x112 SV art',
  `${rosterImgRules.length} rule(s) on that selector; object-fit in ${rosterImgRules.filter(b => /object-fit/.test(b)).length}`
);

/* ===== the filter state is the URL ===== */

/*
 * A filter the reader cannot link to, share, or survive a reload is a control
 * rather than a feature. The params are asserted as a set because the claim is
 * "every filter is addressable", and checking three of them would be satisfied by
 * the one not yet written.
 */
for (const param of ['q', 'type', 'class', 'gen', 'learnable']) {
  ok(LIST.includes(`'${param}'`), `moves.html should keep the "${param}" filter in the URL`);
}
ok(LIST.includes('replaceState'), 'moves.html should write filter changes into the URL without navigating');

/* ===== a deep link with a bad value drops the filter, it does not empty the page ===== */

/*
 * `?type=firex` must behave like no filter at all, not like a filter that matches
 * nothing. The difference is visible: one shows 919 rows, the other shows
 * 「沒有符合條件的招式」 (no matching moves) and looks like a broken page.
 */
ok(
  LIST.includes('unknown ?') && LIST.includes('ignoring it'),
  'moves.html should warn and drop an unrecognised filter value'
);
eq(
  filterMoves(rows, { type: 'firex' }).length,
  0,
  'filterMoves() with an unknown type matches nothing — the page is what drops it'
);
eq(
  filterMoves(rows, {}).length,
  rows.length,
  'filterMoves() with no predicate returns every row'
);

/* ===== the filters actually filter, over the real 919 ===== */

eq(
  filterMoves(rows, { type: 'fire' }).every(m => m.type === 'fire'),
  true,
  'filterMoves(type) should only return that type'
);
eq(
  filterMoves(rows, { cls: 'status' }).every(m => m.class === 'status'),
  true,
  'filterMoves(cls) should only return that class'
);
eq(
  filterMoves(rows, { generation: 1 }).every(m => m.generation === 1),
  true,
  'filterMoves(generation) should only return that generation'
);
// The chip sets are derived from the rows, so a chip can never offer a value that
// matches nothing — the other half of the bad-deep-link contract.
eq(
  [...new Set(rows.map(m => m.type))].length,
  18,
  'the type chip row should offer all 18 types'
);
eq(
  [...new Set(rows.map(m => m.generation))],
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
  'the generation chip row should offer 1..9'
);
eq(
  [...new Set(rows.map(m => m.class))].sort(),
  Object.keys(MOVE_CLASS_ZH).sort(),
  'the class chip row should offer exactly the damage classes MOVE_CLASS_ZH labels'
);

// learnable is a filter rather than a default because 「誰能學這招」 (who can learn
// this) is a constant team-builder question. Both directions must work, and the
// false branch is the one that would be silently unimplemented.
const learnable = filterMoves(rows, { learnable: true });
const unlearnable = filterMoves(rows, { learnable: false });
ok(learnable.length > 0 && unlearnable.length > 0, 'both learnable branches should be non-empty');
eq(
  learnable.every(moveIsLearnable),
  true,
  'learnable:true should keep only moves a Pokémon learns'
);
eq(
  unlearnable.some(moveIsLearnable),
  false,
  'learnable:false should keep only moves no Pokémon learns'
);
eq(
  learnable.length + unlearnable.length,
  rows.length,
  'the two learnable branches should partition the 919'
);
// Cross-checked against the counts FILE rather than moves_zh's own denormalised
// column, so a disagreement between the two files fails: one pass writes both, and
// §3.B1's rule means one of them has to be wrong.
eq(
  learnable.length,
  [...rows.filter(moveIsLearnable).map(m => m.id)].filter(id => moveHasLearners(COUNTS, id)).length,
  'the learnable filter should agree with move_learners_count.json'
);

/* ===== the search box ===== */

eq(moveSearchText({ id: 1, zh: '拍擊', en: 'pound', target: 'selected-pokemon', ailment: 'none', category: 'damage' }).includes('拍擊'), true, 'search should match the Chinese name');
eq(moveSearchText({ id: 1, zh: '拍擊', en: 'pound', target: 'selected-pokemon', ailment: 'none', category: 'damage' }).includes('pound'), true, 'search should match the English name');
eq(moveSearchText({ id: 85, zh: '雷霆萬鈞', en: 'thunderbolt', target: 'selected-pokemon', ailment: 'paralysis', category: 'damage-ailment' }).includes('85'), true, 'search should match a bare id');
// Typing 拍擊 (pound) must not also match a move that merely shares a character,
// and typing an id must not match 0850.
eq(filterMoves(rows, { q: '85' }).every(m => String(m.id).includes('85')), true, 'an id query should only return ids containing it');
ok(filterMoves(rows, { q: 'zzzznotamove' }).length === 0, 'a query matching nothing should return nothing');

// The haystack is built once in prepareMoves, not per keystroke — 919 rows × one
// string build per character typed is the difference between a search box and a
// page that stutters.
eq(
  filterMoves(rows, { q: 'pound' }).some(m => m.id === 1),
  true,
  'prepareMoves() should attach the haystack filterMoves() needs'
);
eq(
  filterMoves(rows, { q: 'pound' })[0].haystack !== undefined,
  true,
  'the haystack should survive onto the filtered rows'
);
/*
 * Asserting that a haystack EXISTS says nothing about WHEN it is built, so this
 * reads filterMoves' own body rather than its output. Swapping the field read for
 * a moveSearchText() call returns byte-identical rows and passes every other
 * assertion here — found by the mutation that did exactly that. §4's "one run
 * confirms a fix" rule is not a licence to stop recording the mechanism.
 */
const filterBody = MOVES_JS.match(/export function filterMoves\([\s\S]*?\n}/);
ok(
  Boolean(filterBody) && /move\.haystack\.includes\(/.test(filterBody[0]),
  'filterMoves() should read the precomputed haystack rather than build one per keystroke'
);
ok(
  Boolean(filterBody) && !/moveSearchText\(/.test(filterBody[0]),
  'and should not call moveSearchText() inside the filter'
);
ok(
  /prepareMoves[\s\S]{0,240}haystack: moveSearchText\(move\)/.test(MOVES_JS),
  'prepareMoves() should be what builds the haystack'
);

/* ===== the four formatters, on the rows that are interesting ===== */

const byId = id => MOVES[String(id)];

eq(moveNumber(40), '40', 'moveNumber should pass a real number through');
eq(moveNumber(null), '—', 'moveNumber should dash a null');
eq(moveNumber(0), '0', 'moveNumber should keep 0 — it is a real value');

eq(moveAccuracyText(100), '100%', 'moveAccuracyText should render a percentage');
eq(moveAccuracyText(null), '—', 'moveAccuracyText should dash a null');
// The three moves that carry accuracy 0. 迅子利刃 says 「必定命中」 (always hits) in
// its own effect text, so printing 「0%」 would contradict the panel below.
eq(moveAccuracyText(0), '必中', 'accuracy 0 is 必中, not 0%');
eq(
  rows.filter(m => m.accuracy === 0).map(m => m.id).sort((a, b) => a - b),
  [908, 911, 913],
  'the three moves PokeAPI gives accuracy 0'
);

eq(movePowerText(byId(1)), '40', 'a normal power should render as its number');
eq(movePowerText(byId(829)), '—', 'a status move with power 0 should read as an absence, not 0');
eq(
  movePowerText(byId(912)),
  '依對手剩餘 HP 變化',
  '硬壓 is physical with power 0 — a real HP-scaling value, not a dash'
);

// [min, max] pairs: `max: null` with `min: 2` means 「至少 2 次」 (at least twice),
// and flattening it to 2 is a different claim.
eq(movePairText([2, 5], ' 次'), '2～5 次', 'a bounded pair should read as a range');
eq(movePairText([2, null], ' 次'), '至少 2 次', 'a null max means 「至少」, not 「2」');
eq(movePairText(null), '—', 'a null pair should dash');
eq(movePairText([null, null]), '—', 'an all-null pair should dash');

eq(movePriorityText(0), '0', 'priority 0 should read as 0');
eq(movePriorityText(4), '+4', 'a positive priority should carry its sign');
eq(movePriorityText(-7), '-7', '先制 替身 is -7 and must not be clamped');

/* ===== the vocabulary tables cover the data ===== */

eq(
  Object.keys(MOVE_TARGET_ZH).length,
  new Set(rows.map(m => m.target)).size,
  'MOVE_TARGET_ZH should map every target the data carries'
);
for (const target of new Set(rows.map(m => m.target))) {
  ok(MOVE_TARGET_ZH[target] !== undefined, `MOVE_TARGET_ZH has no label for "${target}"`);
}
for (const category of new Set(rows.filter(m => m.category).map(m => m.category))) {
  ok(MOVE_CATEGORY_ZH[category] !== undefined, `MOVE_CATEGORY_ZH has no label for "${category}"`);
}
for (const ailment of new Set(rows.filter(m => m.ailment).map(m => m.ailment))) {
  ok(MOVE_AILMENT_ZH[ailment] !== undefined, `MOVE_AILMENT_ZH has no label for "${ailment}"`);
}
// A label table carrying a slug the data never produces is a second answer to a
// question only the data can answer.
for (const key of Object.keys(MOVE_TARGET_ZH)) {
  ok(
    rows.some(m => m.target === key),
    `MOVE_TARGET_ZH maps "${key}", which no shipped move has`
  );
}

/* ===== the four learn methods agree with detail.html ===== */

/*
 * move.html's tabs and detail.html's move tables are the same four methods over
 * the same file. If one renames a tab the other is wrong and nothing downstream
 * says so: detail.html reads MOVE_TABS, this page reads MOVE_LEARN_METHODS, and
 * they were written months apart.
 */
eq(
  MOVE_LEARN_METHODS,
  Object.keys(COUNTS[String(1)]).filter(k => k !== 'total'),
  "move.html's tab order should be the order move_learners_count.json uses"
);
for (const method of MOVE_LEARN_METHODS) {
  ok(
    MOVE_LEARN_METHODS_ZH[method] !== undefined,
    `MOVE_LEARN_METHODS_ZH has no label for "${method}"`
  );
}
eq(
  Object.keys(MOVE_LEARN_METHODS_ZH),
  MOVE_LEARN_METHODS,
  'MOVE_LEARN_METHODS_ZH and MOVE_LEARN_METHODS should carry the same four keys'
);

/* ===== the effect provenance is on the page ===== */

eq(
  Object.keys(MOVE_EFFECT_SOURCE_ZH).sort(),
  [...new Set(rows.map(m => m.effectSource))].sort(),
  'MOVE_EFFECT_SOURCE_ZH should label exactly the sources the data carries'
);
ok(
  DETAIL.includes('MOVE_EFFECT_SOURCE_ZH'),
  'move.html should say which source each effect sentence came from — 93 are converted'
);

/* ===== CSS ===== */

ok(LIST.includes('assets/css/moves.css') && DETAIL.includes('assets/css/moves.css'), 'both pages should mount moves.css');
ok(
  !LIST.includes('detail.css') && !DETAIL.includes('detail.css'),
  "neither page should mount detail.css — the .move-* rules there are sized for a dossier column"
);
ok(
  !/assets\/css\/shared\.css/.test(cssCode.replace(/url\([^)]*\)/g, '')),
  'moves.css should not redeclare anything from shared.css'
);

// §3.B1: a page's own rules live in its own prefixed file. An unprefixed rule
// here is one that would apply to whatever page mounts it next.
const ruleSelectors = [...cssCode.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/g)].map(m => m[1]);
const selectors = ruleSelectors.flatMap(s => s.split(',').map(x => x.trim())).filter(s => s && !s.startsWith('@'));
const unprefixed = selectors.filter(s => !/^\.mv-/.test(s) && !/^(html|body|@|:root)/.test(s));
eq(unprefixed, [], 'every selector in moves.css should be mv- prefixed');

/*
 * `[hidden]` needs the explicit display:none. §3.M: an author `display` beats the
 * UA sheet's `[hidden] { display: none }` whatever the specificity, so
 * `el.hidden = true` leaves the box painted while the property still reads true.
 * Both classes here declare a display of their own.
 */
ok(
  /\.mv-panel\s*\{/.test(cssCode),
  'moves.css should declare .mv-panel'
);
ok(
  /\.mv-tabpanel(?=[:{.\s])/.test(cssCode),
  'moves.css should declare .mv-tabpanel — the focusable role=tabpanel panels have no geometry of their own otherwise'
);
const hiddenRule = cssCode.match(/\.mv-panel\[hidden\][^{]*\{([^}]*)\}/);
ok(hiddenRule !== null, 'moves.css needs .mv-panel[hidden] — an author display defeats the UA [hidden] rule');
ok(
  hiddenRule && /display:\s*none/.test(hiddenRule[1]),
  '.mv-panel[hidden] must set display: none explicitly'
);
ok(
  /\.mv-tabpanel\[hidden\][^{]*\{[^}]*display:\s*none/.test(cssCode),
  '.mv-tabpanel[hidden] must set display: none explicitly'
);

// types.html declares its chart tokens in its own inline <style>, so a var()
// naming one from here resolves to nothing. The token name is spelled out here in
// prose and NOT in moves.css, because a grep cannot tell a declaration from the
// sentence explaining why the declaration is a different one — §3.S.
ok(
  /type-specific chart token/.test(CSS) === false,
  'sanity: this file documents the chart-token rule in a comment it does not share with moves.css'
);
ok(
  !/var\(--(?!error-text)[a-z-]*chart[a-z-]*\)/.test(cssCode),
  'moves.css should not reference a chart token: those are declared in types.html, not shared.css'
);
ok(
  /\.mv-status\.is-error\s*\{[^}]*--error-text/.test(cssCode),
  'the error state should use --error-text, which shared.css declares for both themes'
);

/* ===== the tablist is not a fourth one ===== */

ok(DETAIL.includes('wireRoving('), 'move.html should use the shared roving-tabindex widget');
eq(
  [...DETAIL.matchAll(/role="tablist"/g)].length,
  1,
  'move.html should declare exactly one tablist'
);
ok(
  detailCode.includes("setAttribute('role', 'tab')") && detailCode.includes("setAttribute('role', 'tabpanel')"),
  "move.html's tabs need the tab/tabpanel contract"
);
ok(
  /addEventListener\('keydown'/.test(DETAIL) === false,
  'move.html should not hand-roll arrow-key handling — wireRoving owns it'
);

/* ===== an unknown move is an error, not a fallback ===== */

/*
 * `?move=nonexistent` renders an error naming the move. Falling back to move 1
 * would answer "here is 拍擊" (pound) to a question about something else, and the
 * reader cannot tell — §3.B2's vacuity shape applied to a URL.
 *
 * Asserted on the Map lookup the page actually uses rather than a `.find()` this
 * checker expected: what matters is that the slug resolves and a miss is checked,
 * not which of the two ways was chosen.
 */
ok(DETAIL.includes('找不到招式'), 'move.html should say so when ?move= names nothing');
/*
 * Asserted on the PROPERTY the lookup depends on, not on the spelling. An earlier
 * version matched `bySlug.set(move.en, move)` and went red the moment the page was
 * fixed, because the fix WAS to change that call. What matters is that a row taken
 * out of `Object.entries(moves)` carries the id it is filed under, since
 * `learners[String(move.id)]` is otherwise `learners["undefined"]` and the learner
 * panel renders empty with no error. The rendered half found that; this is here so
 * the next simplification of the loop finds a red line instead of a regression.
 */
ok(
  detailCode.includes('bySlug.set(move.en, { id: Number(id), ...move })'),
  'move.html should carry the id onto each slug-indexed row — learners[String(move.id)] is otherwise empty'
);
ok(
  detailCode.includes('bySlug.get(requested)') && detailCode.includes('if (!move) {'),
  'move.html should index the moves by slug, look the requested one up, and check it resolved'
);

/* ===== the learner count is distinct species ===== */

/*
 * 473 of the 782 moves are learned by at least one Pokémon through two methods,
 * because learnsets.json is a union over every generation. A total summing the
 * four lists would overstate more than half the catalogue.
 */
const overlap = [1, 15, 85, 809].filter(id => {
  const row = COUNTS[String(id)];
  const summed = MOVE_LEARN_METHODS.reduce((n, m) => n + row[m], 0);
  return summed !== row.total;
});
ok(
  overlap.length > 0,
  'sanity: some moves should be learned through two methods, or this whole assertion is vacuous'
);
ok(
  detailCode.includes('new Set(MOVE_LEARN_METHODS.flatMap(') && detailCode.includes('total'),
  'move.html should count DISTINCT species for the total, not sum the four tabs'
);

/* ===== the type chips carry their own colour ===== */

/*
 * The 屬性 (type) row is the one the reader scans by hue; the other three stay
 * neutral. A MODIFIER rather than a change to `.mv-chip` leaves those three
 * untouched; colors-explore.html reaches the same shape under `.cp-`, because
 * colors.css is not mounted here and §3.B1 requires a page's own rules to live in
 * its own prefixed file.
 *
 * Asserted on the emitted inline style rather than on `typePair()` being called:
 * a call that produced nothing would still satisfy the call.
 */
ok(
  listCode.includes('mv-chip--type') && listCode.includes('mv-chip-dot'),
  'moves.html should mark the type chips so a rule can colour them'
);
ok(
  listCode.includes('typePair(') && /--mv-type-fill:rgb\(\$\{/.test(listCode),
  'the chip accent should come from typePair() as inline custom properties, not a second colour calculation'
);
ok(
  /\.mv-chip--type\s*\{/.test(cssCode) && /\.mv-chip--type \.mv-chip-dot\s*\{/.test(cssCode),
  'moves.css should declare both the type modifier and its dot'
);
ok(
  /\.mv-chip--type \.mv-chip-dot\s*\{[^}]*background:\s*var\(--mv-type-fill/.test(cssCode),
  "the dot should be painted with the SAME fill, not the raw TYPE_COLORS hex — pressing a chip then spreads it instead of swapping one colour for another"
);
// The 屬性 (type) suffix is why the group label exists. Eighteen chips each
// spelling 屬性 is the word twice, and the dot already carries the type.
ok(
  /return TYPE_EN_ZH\[capitalize\(slug\)\] \|\| slug;/.test(listCode),
  'the type chip label should be the bare type name'
);
ok(
  !/\+ *'屬性'|\}[`'"]屬性/.test(listCode),
  'and should not append 屬性 — the group label already says it'
);
// Only the type row is decorated, so the accent is a parameter rather than
// something chipRow applies to every row. The count is on the CALL SITES
// (`frag.appendChild(chipRow(`), not the function definition, which shares the
// name and would make the count five.
eq(
  (listCode.match(/appendChild\(chipRow\(/g) || []).length,
  4,
  'all four filter rows should still be built'
);
ok(
  /chipRow\('屬性', 'type', types, typeLabel, typeAccent\)/.test(listCode),
  'and only the 屬性 row should be passed the accent'
);
eq(
  [...cssCode.matchAll(/\.mv-chip\[aria-pressed="true"\]\s*\{/g)].length,
  1,
  'the neutral pressed state must survive — three of the four rows have no colour'
);

/* ===== the footer credits the source ===== */

/*
 * Both pages name PokeAPI, because the 919 rows of numbers and zh-hant names come
 * from it and a reader is owed the provenance. This is the `.footer-note` shape
 * types.html and generations.html use — a bare <p>, no runtime mount, one CSS
 * class from shared.css — rather than index.html's `data-footer-nav` grid, which
 * exists to re-derive NAV's columns.
 *
 * The note must be a SIBLING of the footer content, not inside the module block,
 * matching types.html's order: </main>, the note, then the script. The
 * `</body>`/`</html>` extent belongs to check_js_syntax.mjs (§3.I1).
 */
for (const [name, code] of [['moves.html', LIST], ['move.html', DETAIL]]) {
  ok(
    /<p class="footer-note">[^<]*PokeAPI/.test(code),
    `${name} should credit PokeAPI in a footer note`
  );
  ok(
    code.lastIndexOf('footer-note') > code.lastIndexOf('</main>'),
    `${name}'s footer should sit after </main>, not inside it`
  );
  ok(
    code.lastIndexOf('footer-note') < code.lastIndexOf('<script'),
    `${name}'s footer should precede the module block, the way types.html does it`
  );
}

/* ===== the learner cards use the official artwork ===== */

/*
 * `hasSv()` is asked BEFORE the request rather than after a 404. §3.E: the check
 * exists so an upstream removal degrades to the 96px sprite instead of leaving a
 * console error and nothing to trace. The code stays even though `hasSv` is true
 * for all 1,025 today — that dormancy is the case the branch exists for.
 *
 * The frontend credits PokeAPI only (§3.E), so nothing here names InfoPoke.
 */
ok(
  detailCode.includes("from './assets/js/sv-index.js'") &&
    /import\s*\{\s*hasSv,\s*svUrl\s*\}/.test(DETAIL),
  'move.html should import hasSv() and svUrl() from the generated index'
);
ok(
  detailCode.includes('hasSv(species.id)') && detailCode.includes('svUrl(species.id)'),
  "and should ask whether the artwork exists BEFORE building the src"
);
ok(
  detailCode.includes('ASSETS.sprites + species.filename'),
  'the stand-in path must remain — §3.E requires a graceful degradation, not a broken image'
);
ok(
  detailCode.includes("classList.add('is-sub')"),
  'a species without official artwork should be marked, so a stand-in is never mistaken for it'
);
ok(
  /\.mv-learner\.is-sub\s*\{/.test(cssCode),
  'moves.css should style that mark'
);
// `title` alone is not read by a screen reader; types.html pairs it with an
// `.sr-only` span and so does this.
ok(
  detailCode.includes('sr-only'),
  'the stand-in should be announced, not only titled'
);

/*
 * object-fit WITH object-position, and both.
 *
 * The SV set is 120×112, the sprite is 96×96 and the box is 56×56. Setting
 * width/height — as `.chip-item img` does on types.html and this rule used to —
 * stretches the SV art 6% horizontally AND scales it to fill the box, moving the
 * subject 3.7px UP off the card's bottom edge. The SV subject is bottom-anchored
 * with its empty space above; `contain` scales to 56×52.3 and
 * `object-position: bottom` puts the 3.7px of slack at the top, where the
 * artwork's own padding already is.
 *
 * Asserting `object-fit` without `object-position` would pass on a page that
 * undoes the anchoring — the same defect in the other order.
 */
ok(
  /\.mv-learner img\s*\{[^}]*object-fit:\s*contain/.test(cssCode),
  'the learner image should scale without distorting the 120x112 SV art'
);
ok(
  /\.mv-learner img\s*\{[^}]*object-position:\s*bottom/.test(cssCode),
  'and be pinned to the bottom, which is where the SV subject belongs'
);
// THIS PAGE DELIBERATELY HAS NO VERTICAL OFFSET: types.html's roster chips carry a
// `translateY` because their thumbnail shares a line with a name. These cards put
// the image on its own row above the name, so there is nothing to align and the
// offset would only lift the subject off the card's baseline.
ok(
  !/\.mv-learner[^{}]*is-sv[^{]*\{[^}]*translateY/.test(cssCode),
  "move.html's cards should NOT lift the SV artwork — the bottom-anchored framing is the intent"
);

/*
 * The counterpart on the page that DOES lift: a percentage of its own box, so it
 * survives the thumbnail changing size between the desktop and phone figures.
 *
 * The value is read out of types.html rather than restated. An earlier version
 * named `-23%` in a comment beside the assertion above; when the roster moved to a
 * 40px/32px thumbnail and the offset was re-measured, that comment described a
 * declaration that no longer existed while every assertion stayed green. A comment
 * is not a check, and a number copied next to a checker goes stale in the one
 * direction a reader cannot see (§3.S).
 */
const rosterLift = typesHtml.match(
  /\.chip-grid--roster\s+\.chip-thumb\.is-sv\s+img\s*\{[^}]*translateY\((-?[\d.]+)%\)/
);
ok(rosterLift, 'types.html should lift its roster artwork by a percentage of the box');
ok(
  rosterLift && Math.abs(Number(rosterLift[1]) + 25) < 1,
  'and the percentage should be the measured 25% the SV subject sits low',
  rosterLift ? `${rosterLift[1]}%` : ''
);

/*
 * No `image-rendering` on the learner image at all.
 *
 * The house convention is `crisp-edges`, used only on UPSCALES — the 96px sprite
 * drawn at 140px in a pokedex card. Both sets here are drawn DOWN (96→56 and
 * 120→56) by a non-integer factor, where nearest-neighbour drops pixels unevenly
 * and reads worse than smooth. The rule that was here said `pixelated`, the legacy
 * alias for the same thing.
 */
const learnerImgRule = cssCode.match(/\.mv-learner img\s*\{([^}]*)\}/);
ok(Boolean(learnerImgRule), 'moves.css should still declare .mv-learner img');
ok(
  Boolean(learnerImgRule) && !/image-rendering/.test(learnerImgRule[1]),
  'the learner image should declare no image-rendering — both art sets are drawn DOWN, not up'
);

if (C.failures.length === 0) {
  console.log(`PASS ${C.checks} checks`);
} else {
  console.error(`FAIL ${C.failures.length} of ${C.checks} checks`);
  process.exit(1);
}