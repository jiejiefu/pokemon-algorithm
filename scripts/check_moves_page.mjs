/**
 * Moves pages static regression test
 *
 *   node scripts/check_moves_page.mjs
 *
 * The static half of the §3.G4 split. It reads moves.html, move.html,
 * moves.css and moves.js off disk — a stylesheet contract is checked by reading
 * it, and this costs a fraction of a second, so the whole of it runs.
 *
 * What it deliberately does NOT cover is what the pages PRODUCE: the rendered
 * half is check_moves_page_browser.mjs, which drives both over CDP. Three
 * defects on this pair are invisible to a text reader — the filter row count,
 * the `[hidden]` box, and whether the search box narrows anything — and §3.G4's
 * whole argument is that a static-only page checker would have reported "PASS"
 * over all of them.
 *
 * Three existing checkers already read these pages and are NOT duplicated here,
 * because re-asserting a rule in a second file is a second place for it to be
 * wrong: check_js_syntax.mjs owns the `</body>`/`</html>` extent (§3.I1),
 * check_nav_pages.mjs owns the header/nav/toggle markup (§3.G2), and
 * check_page_module_api.mjs owns the named imports (§3.I). Both page sets are
 * self-selecting, so all three cover moves.html and move.html with no edit.
 *
 * It imports moves.js and runs it, so the vocabulary tables, the formatters and
 * filterMoves() are executed against the real 919 rows rather than shape-read.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const LIST = read('moves.html');
const DETAIL = read('move.html');
const CSS = read('assets/css/moves.css');
const MOVES_JS = read('assets/js/moves.js');

/* Comments and strings are masked before any stylesheet or source shape test.
 * §3.S records check_color_page.mjs's false positive: a rule-shaped regex over
 * raw text walked out of a comment that named a selector and "found" it in the
 * next rule. Three of this file's assertions are rule-shaped, so all of them
 * read the stripped copy. */
const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const MOVES = readData('moves_zh.json');
const COUNTS = readData('move_learners_count.json');
const rows = prepareMoves(MOVES);

let failures = 0;
let checks = 0;

function ok(condition, message, detail) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}${detail ? `\n        ${detail}` : ''}`);
  }
}

function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    message,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

/** Keys of a generated map, ignoring the provenance record. */
function dataKeys(map) {
  return Object.keys(map).filter(k => k !== '_meta');
}

/* ===== the two files the split is about ===== */

/*
 * THE PAYLOAD SPLIT IS ASSERTED IN BOTH DIRECTIONS.
 *
 * moves.html needs 「N 隻可學」 on 919 rows and loads move_learners_count.json
 * (54 KB). move.html needs the actual list and loads move_learners.json (424 KB).
 * Asserting only the half that saves bytes would pass on a moves.html that also
 * pulls the 424 KB index — which is the mistake the split exists to prevent, and
 * the one a reader pays for on every visit.
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
 * What is deliberately NOT done is blanking string literals as well. An earlier
 * version of this file stripped them to dodge the explanatory sentences around
 * each rule — and then six assertions below silently stopped matching real code,
 * because the masking was removing the calls they were asserting. §3.P's lesson
 * twice over: a vacuous assertion looks exactly like a passing one. So the
 * assertions below match the DANGEROUS SPELLINGS specifically, and a comment
 * naming one in backticks cannot produce them. */
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

// §3.A again, for species. move.html renders up to 1025 learner cards and every
// one of them is a link; a hand-assembled species URL is exactly how nidoran-f
// and nidoran-m stop being distinct.
eq(
  [...detailCode.matchAll(/(?:href=|`|'|")\s*detail\.html\?slug=/g)].length,
  0,
  'move.html must not write a detail URL by hand — pokemonDetailUrl() does it'
);
ok(detailCode.includes('pokemonDetailUrl('), 'move.html should reach the species URL through pokemonDetailUrl()');

/* ===== the deep link types.html now sends ===== */

ok(
  LIST.includes("params.get('type')"),
  'moves.html should read ?type= from the URL — types.html links to moves.html?type=<slug>'
);
ok(
  read('types.html').includes('moves.html?type=${slug}'),
  'types.html should link to the per-type move list it filtered'
);

/* ===== the filter state is the URL ===== */

/*
 * A filter the reader cannot link to, cannot share, and cannot survive a reload
 * is a control rather than a feature. The four params are asserted as a set
 * because the claim is "every filter is addressable", and checking that three of
 * them are would be satisfied by the one that isn't being written yet.
 */
for (const param of ['q', 'type', 'class', 'gen', 'learnable']) {
  ok(LIST.includes(`'${param}'`), `moves.html should keep the "${param}" filter in the URL`);
}
ok(LIST.includes('replaceState'), 'moves.html should write filter changes into the URL without navigating');

/* ===== a deep link with a bad value drops the filter, it does not empty the page ===== */

/*
 * `?type=firex` has to behave like no filter at all, not like a filter that
 * matches nothing. The difference is visible: one shows 919 rows, the other
 * shows 「沒有符合條件的招式」 and looks like a broken page.
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
// The chip sets are derived from the rows, so a chip can never offer a value
// that matches nothing — which is the other half of the bad-deep-link contract.
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

// learnable is a filter rather than a default because 「誰能學這招」 is the
// question a team-builder asks constantly. Both directions must work, and the
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
// column, so a disagreement between the two files is what fails — they are
// written by the same pass and §3.B1 says one of them has to be wrong.
eq(
  learnable.length,
  [...rows.filter(moveIsLearnable).map(m => m.id)].filter(id => moveHasLearners(COUNTS, id)).length,
  'the learnable filter should agree with move_learners_count.json'
);

/* ===== the search box ===== */

eq(moveSearchText({ id: 1, zh: '拍擊', en: 'pound', target: 'selected-pokemon', ailment: 'none', category: 'damage' }).includes('拍擊'), true, 'search should match the Chinese name');
eq(moveSearchText({ id: 1, zh: '拍擊', en: 'pound', target: 'selected-pokemon', ailment: 'none', category: 'damage' }).includes('pound'), true, 'search should match the English name');
eq(moveSearchText({ id: 85, zh: '雷霆萬鈞', en: 'thunderbolt', target: 'selected-pokemon', ailment: 'paralysis', category: 'damage-ailment' }).includes('85'), true, 'search should match a bare id');
// Typing 拍擊 must not also match a move that merely shares a character, and
// typing an id must not match 0850.
eq(filterMoves(rows, { q: '85' }).every(m => String(m.id).includes('85')), true, 'an id query should only return ids containing it');
ok(filterMoves(rows, { q: 'zzzznotamove' }).length === 0, 'a query matching nothing should return nothing');

// The haystack is built once in prepareMoves, not per keystroke — 919 rows ×
// one string build per character typed is the difference between a search box
// and a page that stutters.
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
 * Asserting that a haystack EXISTS says nothing about WHEN it is built, which
 * is why this reads filterMoves' own body rather than its output. Swapping the
 * field read for a moveSearchText() call returns byte-identical rows and passes
 * every other assertion in this file — found by the mutation that did exactly
 * that, and the reason the "one run confirms a fix" rule (§4) is not a licence
 * to stop writing the mechanism down next to the outcome.
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
// The three moves that carry accuracy 0. 迅子利刃 says 「必定命中」 in its own
// effect text, so printing 「0%」 would contradict the panel two lines below.
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

// [min, max] pairs, because `max: null` with `min: 2` means 「至少 2 次」 and
// flattening it to 2 is a different claim.
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
// A label table that also carries a slug the data never produces is a second
// answer to a question only the data can answer.
for (const key of Object.keys(MOVE_TARGET_ZH)) {
  ok(
    rows.some(m => m.target === key),
    `MOVE_TARGET_ZH maps "${key}", which no shipped move has`
  );
}

/* ===== the four learn methods agree with detail.html ===== */

/*
 * move.html's tabs and detail.html's move tables are the same four methods on
 * the same file. If one of them renames a tab the other is wrong and nothing
 * downstream would say so — detail.html reads MOVE_TABS, this page reads
 * MOVE_LEARN_METHODS, and they were written months apart in intent.
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
 * `[hidden]` needs the explicit display:none. §3.M measured that an author
 * `display` beats the UA sheet's `[hidden] { display: none }` whatever the
 * specificity, so `el.hidden = true` leaves the box painted while the property
 * still reads true. Both classes here are declared with a display of their own.
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

// types.html declares its chart tokens inside its own inline <style>, so a
// var() naming one of them from here resolves to nothing. The token name is
// spelled out here in prose and NOT in moves.css, because a check that greps
// for it cannot tell a declaration from the sentence explaining why the
// declaration is a different one — §3.S, self-inflicted.
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
 * would answer "here is 拍擊" to a question about something else, and the reader
 * cannot tell that happened — §3.B2's vacuity shape applied to a URL.
 *
 * Asserted on the Map lookup the page actually uses rather than on a `.find()`
 * this checker was written expecting: what matters is that the slug resolves and
 * that a miss is checked, not which of the two ways to do that was chosen.
 */
ok(DETAIL.includes('找不到招式'), 'move.html should say so when ?move= names nothing');
/*
 * Asserted on the PROPERTY the lookup depends on, not on the spelling. The
 * first version of this line matched `bySlug.set(move.en, move)` and went red
 * the moment the page was fixed — because the fix WAS to change that call. The
 * thing that matters is that a row taken out of `Object.entries(moves)` carries
 * the id it is filed under, since `learners[String(move.id)]` is otherwise
 * `learners["undefined"]` and the learner panel renders empty with no error.
 * The rendered half is what found that; this is here so the next person to
 * simplify the loop finds a red line instead of a regression.
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
 * because learnsets.json is a union over every generation. A total that summed
 * the four lists would overstate more than half the catalogue.
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
 * The 屬性 row is the one the reader scans by hue, and the other three rows stay
 * neutral. A MODIFIER rather than a change to `.mv-chip` is what leaves those
 * three untouched; colors-explore.html reaches the same shape under `.cp-`,
 * because colors.css is not mounted here and §3.B1 says a page's own rules live
 * in its own prefixed file.
 *
 * Asserted on the emitted inline style rather than on `typePair()` being called,
 * because a call that produced nothing would still satisfy the call.
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
// The 屬性 suffix is why the group label exists. Eighteen chips each spelling
// 屬性 is the word twice, and the dot carries the type already.
ok(
  /return TYPE_EN_ZH\[capitalize\(slug\)\] \|\| slug;/.test(listCode),
  'the type chip label should be the bare type name'
);
ok(
  !/\+ *'屬性'|\}[`'"]屬性/.test(listCode),
  'and should not append 屬性 — the group label already says it'
);
// Only the type row is decorated, so the accent has to be a parameter and not
// something chipRow applies to every row it builds. The count is on the CALL
// SITES (`frag.appendChild(chipRow(`), not on the function definition, which
// shares the same name and would make the count five.
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
 * Both pages name PokeAPI, because 919 moves of numbers and 919 zh-hant names
 * come from it and a reader is owed the provenance. This is the `.footer-note`
 * shape types.html and generations.html use — a bare <p>, no runtime mount, one
 * CSS class from shared.css — rather than index.html's `data-footer-nav` grid,
 * which exists to re-derive NAV's columns and would be five more link lists on a
 * page whose own nav row already points at everything it links to.
 *
 * The position assertion is that the note is a SIBLING of the footer content and
 * not inside the module block, matching types.html's order exactly: </main>, the
 * note, then the script. The `</body>`/`</html>` extent is check_js_syntax.mjs's
 * (§3.I1) and is not restated here.
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

if (failures === 0) {
  console.log(`PASS ${checks} checks`);
} else {
  console.error(`FAIL ${failures} of ${checks} checks`);
  process.exit(1);
}