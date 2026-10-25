/**
 * `silhouette-draft.html` static regression test.
 *
 *   node scripts/check_draft_page.mjs
 *
 * Two halves, both cheap:
 *   1. the page's DOM/stylesheet contract, read off disk;
 *   2. the pure session, driven through a seeded generator — six rounds, a
 *      disjoint opponent, six pairings, the summary's counts.
 *
 * The rendered claims — that a silhouette actually paints, that a confirm bar
 * sticks to a phone viewport — are NOT asserted here. A static PASS is not a
 * rendered one (§3.G4).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { NAV } from '../assets/js/shared.js';
import { TYPELESS_MOVES } from '../assets/js/team-moves.js';
import {
  CANDIDATES,
  MOVES_PER_MEMBER,
  MULTIPLIER_BANDS,
  ROUNDS,
  SWAPS,
  TEAM_SIZE,
  attackProfile,
  createDraftSession,
  duelOutcome,
  multiplierBand,
  multiplierText,
  pickMoves,
  prepareDraftRoster,
} from '../assets/js/silhouette-draft-game.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const HTML = read('silhouette-draft.html');
const CSS = read('assets/css/silhouette-draft.css');
const JS = read('assets/js/silhouette-draft.js');
const GAME = read('assets/js/silhouette-draft-game.js');
const PALETTE = read('assets/js/color-palette.js');
const DATA = readData('draft_roster.json');

const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const jsCode = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const gameCode = GAME.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, is, eq } = C;

const attrs = (id) => (HTML.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [''])[0];

/* ===== the document ===== */

ok(/<html lang="zh-TW">/.test(HTML), 'the page declares a zh-TW document');
ok(/<title>[^<]*剪影選秀/.test(HTML), 'the title names the page');
ok(/name="description"/.test(HTML), 'the page carries a meta description');
ok((HTML.match(/assets\/css\/shared\.css/g) || []).length === 1, 'shared.css is mounted exactly once');
ok((HTML.match(/assets\/css\/silhouette-draft\.css/g) || []).length === 1, 'the page stylesheet is mounted exactly once');
ok(/<header class="header header-sort">/.test(HTML), 'the header is the algorithms row layout');
ok(/data-nav/.test(HTML) && /data-nav-toggle/.test(HTML), 'the shared header mounts the nav and its toggles');
ok(/<main class="sd-page">/.test(HTML), 'the page body is the sd- scoped main');
ok(/class="breadcrumb"/.test(HTML), 'the page keeps a breadcrumb');

for (const id of [
  'sd-status', 'sd-round', 'sd-phase', 'sd-progress',
  'sd-draft', 'sd-pick-area', 'sd-instruction', 'sd-candidates', 'sd-selected', 'sd-confirm',
  'sd-pick-dialog', 'sd-pick-dialog-title', 'sd-pick-dialog-preview', 'sd-pick-dialog-note',
  'sd-pick-cancel', 'sd-pick-confirm',
  'sd-reveal', 'sd-reveal-head', 'sd-reveal-cols', 'sd-next-round',
  'sd-match', 'sd-battle', 'sd-battle-player', 'sd-battle-opponent',
  'sd-battle-player-name', 'sd-battle-player-types',
  'sd-battle-opponent-name', 'sd-battle-opponent-types', 'sd-battle-verdict',
  'sd-score', 'sd-opponent', 'sd-opponent-count', 'sd-opponent-backs',
  'sd-match-team', 'sd-match-selected', 'sd-match-confirm', 'sd-analysis',
  'sd-analysis-outcome', 'sd-analysis-cols', 'sd-next',
  'sd-team', 'sd-team-count', 'sd-opponent-team', 'sd-opponent-team-count',
  'sd-summary', 'sd-summary-result', 'sd-summary-rows', 'sd-summary-tallies', 'sd-restart',
  'sd-board-title', 'sd-steps',
]) ok(attrs(id).length > 0, `the page carries #${id}`);

const readIds = [...new Set([...JS.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(match => match[1]))];
const missingReadIds = readIds.filter(id => attrs(id).length === 0);
ok(missingReadIds.length === 0, 'every id the script reads exists in the page', missingReadIds.join(', '));

ok(/id="sd-candidates"[^>]*data-candidate-count="6"/.test(HTML), 'the candidate list declares six cards');
ok(/id="sd-team"[^>]*data-slot-count="6"/.test(HTML), 'the team rail declares six slots');
ok(/id="sd-match-team"[^>]*data-team-count="6"/.test(HTML), 'the match picker declares six members');
ok(/id="sd-opponent-backs"[^>]*data-back-count="6"/.test(HTML), 'the opponent rail declares six picks');
ok(/id="sd-opponent-team"[^>]*data-slot-count="6"/.test(HTML), 'the opponent roster declares six slots');

ok(/<ol class="sd-steps" id="sd-steps" aria-label="遊戲進度">/.test(HTML),
  'the board carries a labelled progress rail');
is((HTML.match(/class="sd-step"/g) || []).length, 3, 'the rail has three macro stages');
for (const step of ['draft', 'match', 'summary']) {
  ok(new RegExp(`data-step="${step}"`).test(HTML), `the rail names the ${step} stage`);
}
ok(/id="sd-steps"[\s\S]*?data-step="draft" aria-current="step"/.test(HTML),
  'the rail starts on the draft stage');
ok(/renderSteps/.test(JS) && /aria-current/.test(JS), 'the page marks the active stage');
ok(/PHASE_STEPS\s*=\s*\['draft',\s*'match',\s*'summary'\]/.test(jsCode),
  'the rail order matches the session phase names');
ok(/function renderSteps\(phase\)[\s\S]*?index < active[\s\S]*?aria-current/.test(jsCode),
  'a completed stage is derived from the active index, not a second flag');

for (const id of ['sd-reveal', 'sd-match', 'sd-analysis', 'sd-summary']) {
  ok(new RegExp(`id="${id}"[^>]*hidden`).test(HTML), `#${id} starts hidden`);
}
ok(/id="sd-battle-player"[^>]*hidden/.test(HTML), 'the player battle sprite starts hidden');
ok(HTML.indexOf('id="sd-battle"') < HTML.indexOf('id="sd-score"'),
  'the battle scene precedes the score strip');
ok(/id="sd-opponent-title">對手的六隻/.test(HTML), 'the opponent panel names the six it lists');
ok(HTML.indexOf('sd-battle-plate--opponent') < HTML.indexOf('id="sd-opponent"')
  && HTML.indexOf('id="sd-opponent"') < HTML.indexOf('sd-battle-plate--player'),
  'the opponent moves sit inside the opponent plate');
ok(/id="sd-battle-player-moves"/.test(HTML), 'the player plate has a moves slot');
ok(!/class="sd-opponent"/.test(HTML), 'the standalone moves card is gone');
ok(/id="sd-confirm"[^>]*disabled/.test(HTML), 'the draft confirm starts disabled');
ok(/id="sd-match-confirm"[^>]*disabled/.test(HTML), 'the match confirm starts disabled');

/* The quick-pick dialog: a second activation of the selected card, not a
   `dblclick`. Selecting re-renders the candidate list, so the second click of a
   fast double-click hits a new node and Chrome restarts its click count. Keying
   on `session.selectedId` gives the same shortcut to a slow double click, a
   second tap and a second Enter. */
ok(/id="sd-pick-dialog"/.test(HTML) && /<dialog\b/.test(HTML),
  'the quick pick is a native dialog');
ok(/id="sd-pick-dialog"[^>]*aria-labelledby="sd-pick-dialog-title"/.test(HTML),
  'the dialog is labelled by its title');
ok(/id="sd-pick-dialog"[^>]*aria-describedby="sd-pick-dialog-note"/.test(HTML),
  'the dialog describes the irreversible step');
ok(!/<dialog[^>]*id="sd-pick-dialog"[^>]*\sopen\b/.test(HTML),
  'the pick dialog starts closed');
ok(/確認後才會揭曉名字與本體屬性/.test(HTML),
  'the dialog warns that the name is revealed only after confirming');
ok(/id="sd-pick-cancel"/.test(HTML) && /id="sd-pick-confirm"/.test(HTML),
  'the dialog offers cancel and confirm');
ok(/再點同一隻/.test(HTML) && /再點一次/.test(jsCode),
  'the page states the second-activation shortcut');
ok(/if \(session\.selectedId === id\) \{\s*openPickDialog\(id\)/.test(jsCode),
  'a second activation opens the dialog instead of reselecting');
ok(/function commitPick\(\)[\s\S]*?session\.confirmPick\(\)/.test(jsCode),
  'one commit path owns the confirm');
ok(/\$\('sd-confirm'\)\.addEventListener\('click', commitPick\)/.test(jsCode),
  'the confirm bar uses the shared commit path');
ok(/\$\('sd-pick-confirm'\)\.addEventListener\('click', commitPick\)/.test(jsCode),
  'the dialog confirm uses the shared commit path');
ok(/typeof dialog\.showModal === 'function'/.test(jsCode) && /showModal\(\)/.test(jsCode),
  'the dialog opens modally, with an attribute fallback');
ok(/addEventListener\('cancel'/.test(jsCode) && /function finishPickDialog\(\)/.test(jsCode),
  'Escape closes the dialog and returns focus to the card');
ok(/event\.target === pickDialog/.test(jsCode), 'a backdrop click cancels');
const pickDialogCode = jsCode.match(/function openPickDialog\(id\)[\s\S]*?\n  \}/)?.[0] || '';
ok(/sd-card-moves/.test(pickDialogCode) && /spriteUrl\(id\)/.test(pickDialogCode),
  'the dialog previews the silhouette and its four moves');
ok(!/sd-reveal-types/.test(pickDialogCode),
  'the dialog preview does not leak the species types');
ok(/touch-action:\s*manipulation/.test(cssCode),
  'a tapped card cannot start a double-tap zoom');

for (const id of ['sd-status', 'sd-team-count', 'sd-opponent-count']) {
  ok(/role="status"/.test(attrs(id)) && /aria-live="polite"/.test(attrs(id)),
    `#${id} is a polite live region`);
}
ok(/只計招式屬性/.test(HTML), 'the page says the matchup is type-only');
ok(/先比勝場/.test(HTML), 'the page says wins are compared before the multiplier total');
ok(!/不判定勝負/.test(HTML), 'the page no longer denies a verdict');
ok(/STAB/.test(HTML), 'the page names STAB as something it does not use');

ok(/from '\.\/assets\/js\/silhouette-draft\.js'/.test(HTML), 'the page imports its DOM module');
ok(/^\s*initSilhouetteDraft\(\);$/m.test(HTML), 'the page starts the draft');
ok(/^\s*initHeaderNav\('silhouette-draft\.html'\);$/m.test(HTML), 'the page marks itself current in the nav');

/* ===== the stylesheet ===== */

ok(/\.sd-silhouette img\s*\{[^}]*filter:\s*brightness\(0\)/.test(cssCode),
  'a light-theme silhouette is the sprite with its colour removed');
ok(/\[data-theme="dark"\] \.sd-silhouette img\s*\{[^}]*filter:\s*brightness\(0\) invert\(1\)/.test(cssCode),
  'a dark-theme silhouette is inverted, so black on a dark card cannot vanish');
ok(!/\.sd-silhouette[^{]*\{[^}]*image-rendering/.test(cssCode),
  'the 96px silhouette is not given a crispness setting it does not need');
ok(/\.sd-battle-slot img\s*\{[^}]*image-rendering:\s*pixelated/.test(cssCode),
  'the scaled battle sprites are drawn pixelated');
is((cssCode.match(/image-rendering/g) || []).length, 1,
  'only the battle sprite gets a crispness setting');
ok(/\.sd-battle\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(cssCode),
  'the battle scene spans both match columns');
ok(/\.sd-battle\s*\{[^}]*height:\s*clamp\(320px,\s*34vw,\s*440px\)/.test(cssCode),
  'the battle scene has a bounded height');
ok(/\.sd-battle-slot\s*\{[^}]*width:\s*var\(--sd-battle-sprite-size\)[^}]*height:\s*var\(--sd-battle-sprite-size\)/.test(cssCode),
  'both battle sprites share one box size');
const slotRules = (side) => [...cssCode.matchAll(new RegExp(`\\.sd-battle-slot--${side}\\s*\\{([^}]*)\\}`, 'g'))]
  .map(match => match[1]);
for (const side of ['player', 'opponent']) {
  const rules = slotRules(side);
  ok(rules.length > 0, `the ${side} battle slot is positioned`);
  ok(rules.every(rule => !/(?:^|;)\s*(?:width|height)\s*:/.test(rule)),
    `the ${side} battle slot does not override the shared sprite size`);
}
ok(slotRules('player').some(rule => /left:/.test(rule) && /bottom:/.test(rule)),
  'the player back sprite sits at the bottom-left');
ok(slotRules('opponent').some(rule => /right:/.test(rule) && /top:/.test(rule)),
  'the opponent front sprite sits at the top-right');
ok(/\.sd-battle-plate--opponent\s*\{[^}]*top:/.test(cssCode)
  && /\.sd-battle-plate--opponent\s*\{[^}]*left:/.test(cssCode),
  'the opponent plate sits at the top-left');
ok(/\.sd-battle-plate--player\s*\{[^}]*right:/.test(cssCode)
  && /\.sd-battle-plate--player\s*\{[^}]*bottom:/.test(cssCode),
  'the player plate sits at the bottom-right');
ok(/\.sd-battle-verdict\[hidden\]\s*\{\s*display:\s*none/.test(cssCode),
  'the battle verdict pairs [hidden] with its display');
ok(/@media \(max-width: 600px\)[\s\S]*?\.sd-battle\s*\{[^}]*height:\s*320px/.test(cssCode),
  'the battle scene has a phone height');
ok(/\.sd-battle-plate--opponent\s*\{[^}]*width:\s*min\(46%,\s*336px\)/.test(cssCode)
  && /\.sd-battle-plate--player\s*\{[^}]*width:\s*min\(46%,\s*336px\)/.test(cssCode),
  'both plates declare the same capped width');
ok(/\.sd-battle-head\s*\{[^}]*display:\s*flex/.test(cssCode)
  && /\.sd-battle-head\s*\{[^}]*align-items:\s*baseline/.test(cssCode),
  'the species types share the name row');
ok(/\.sd-plate-moves\s*\{[^}]*grid-template-columns:\s*repeat\(2/.test(cssCode),
  'the four moves lay out two rows of two');
ok(/\.sd-backs\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(cssCode)
  && !/\.sd-backs\s*\{[^}]*repeat\(6/.test(cssCode),
  'the opponent six lays out three across, two rows');
ok(/\.sd-opponent-pick img\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/.test(cssCode),
  'an opponent pick matches the match picker art size');
ok(/const playerMoves = \$\('sd-battle-player-moves'\)/.test(jsCode)
  && /playerMoves\.innerHTML = `[\s\S]*?sd-plate-moves[\s\S]*?player\.moves/.test(jsCode),
  'selecting a member paints its four moves into the player plate');
ok(/sd-plate-moves" aria-label="對手招式"/.test(jsCode)
  && /sd-plate-moves" aria-label="我方招式"/.test(jsCode),
  'both move lists are labelled');
ok(/\.sd-candidates\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(cssCode),
  'six candidates lay out three across on desktop');
ok(/@media \(max-width: 900px\)[\s\S]*?\.sd-candidates\s*\{\s*grid-template-columns:\s*repeat\(2/.test(cssCode),
  'the candidate grid drops to two on a tablet');
ok(/@media \(max-width: 600px\)[\s\S]*?\.sd-candidates\s*\{\s*grid-template-columns:\s*1fr/.test(cssCode),
  'the candidate grid drops to one on a phone');
ok(/\.sd-rosters\s*\{[^}]*grid-template-columns:\s*repeat\(2/.test(cssCode),
  'the two sixes sit side by side on desktop');
ok(/@media \(max-width: 900px\)[\s\S]*?\.sd-team-slots\s*\{\s*grid-template-columns:\s*repeat\(3/.test(cssCode),
  'the six team slots collapse to three');
ok(/@media \(max-width: 600px\)[\s\S]*?\.sd-rosters\s*\{\s*grid-template-columns:\s*1fr/.test(cssCode),
  'the two sixes stack on a phone');
ok(/@media \(max-width: 600px\)[\s\S]*?\.sd-team-slots\s*\{\s*grid-template-columns:\s*repeat\(2/.test(cssCode),
  'the six team slots collapse to two on a phone');
ok(/@media \(max-width: 900px\)[\s\S]*?\.sd-confirmbar\s*\{[^}]*position:\s*sticky/.test(cssCode),
  'the confirm bar sticks to the bottom on a tablet and a phone');
ok(/@media \(max-width: 600px\)[\s\S]*?\.sd-match-team\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(cssCode),
  'the phone match picker lays out three across, saving a row');
ok(/\.sd-step\[aria-current="step"\]/.test(cssCode), 'the active stage is styled');
ok(/\.sd-step--done/.test(cssCode), 'a completed stage is styled');
ok(/\.sd-card-btn:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/.test(cssCode),
  'a hovered card lifts');
ok(/\.sd-silhouette::before/.test(cssCode), 'a hover wash sits behind the silhouette');
ok(/\.sd-match,\s*\.sd-summary\s*\{[^}]*animation:/.test(cssCode),
  'entering the match and the summary is animated');
ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sd-match,[\s\S]*?animation:\s*none/.test(cssCode),
  'the entry animation is disabled under reduced motion');
ok(/\.sd-match\[hidden\][\s\S]*?\.sd-match-pick\[hidden\][\s\S]*?\.sd-summary\[hidden\]\s*\{\s*display:\s*none/.test(cssCode),
  'every author display has a [hidden] companion');
ok(/\.sd-pick-area\[hidden\][\s\S]*?\.sd-reveal\[hidden\]\s*\{\s*display:\s*none/.test(cssCode)
  && /\.sd-analysis\[hidden\]\s*\{\s*display:\s*none/.test(cssCode),
  'the pick area, reveal and analysis panels pair [hidden] with their display');
ok(/@media \(prefers-reduced-motion: reduce\)/.test(cssCode), 'reduced motion is honoured');
ok(/\.sd-card-btn:focus-visible/.test(cssCode) && /\.sd-btn:focus-visible/.test(cssCode),
  'the cards and the buttons have visible focus rings');

/* ===== the page's own module ===== */

ok(/createDraftSession/.test(JS), 'the DOM module uses the pure session');
ok(/fetch\(DATA_URL\)/.test(JS) && /assets\/data\/draft_roster\.json/.test(JS),
  'the page fetches the compact roster');
ok(!/pokemon_data\.json/.test(jsCode) && !/team_moves\.json/.test(jsCode),
  'the page never loads the 2.9 MB roster or the 607 KB move table');
ok(/backSpriteUrl/.test(PALETTE) && /back\/\$\{id\}\.png/.test(PALETTE)
  && /ASSETS\.sprites/.test(PALETTE) && /backSpriteUrl/.test(JS),
  'the back sprite path comes from the shared palette module');
ok(/backSpriteUrl\(player\.id\)/.test(jsCode), 'the battle scene draws the player from the back sprite');
ok(/spriteUrl\(opponent\.id\)/.test(jsCode), 'the battle scene draws the opponent from the front sprite');
ok(/function renderBattle/.test(jsCode) && /renderBattle\(\);/.test(jsCode),
  'the battle scene is painted from the match state');

const candidateFn = jsCode.slice(jsCode.indexOf('function renderCandidates'), jsCode.indexOf('function slotHtml'));
ok(candidateFn.length > 0, 'renderCandidates is locatable');
ok(!/pokemon\.zh/.test(candidateFn), 'a draft card still does not print the name');
ok(/moveRow\(move, undefined, true\)/.test(candidateFn), 'a draft card prints each move type badge');
ok(/pokemon\.moves/.test(candidateFn), 'a draft card prints the move names it is allowed to show');
ok(/pokemon\.short/.test(candidateFn), 'a short species is labelled rather than padded');

const revealFn = jsCode.slice(jsCode.indexOf('function revealCard'), jsCode.indexOf('function renderCandidates'));
ok(/typesHtml/.test(revealFn) && /moveRow\(move, undefined, true\)/.test(revealFn),
  'the round result prints both names and move types');
ok(/pendingRound/.test(jsCode) && /session\.nextRound\(\)/.test(jsCode),
  'the DOM waits on the round result before advancing');
ok(/function revealIntoView\(node\)[\s\S]*?DOMMatrixReadOnly[\s\S]*?scrollBy[\s\S]*?prefers-reduced-motion/.test(jsCode),
  'a revealed panel is pulled into view with its entrance offset removed, and reduced motion is respected');
ok(/revealIntoView\(\$\('sd-reveal'\)\)/.test(JS)
  && /revealIntoView\(\$\('sd-analysis'\)\)/.test(JS)
  && /revealIntoView\(\$\('sd-summary'\)\)/.test(JS),
  'the reveal, the analysis and the summary are all brought back');
const opponentFn = jsCode.slice(jsCode.indexOf('function renderOpponent'), jsCode.indexOf('function renderMatchTeam'));
ok(opponentFn.length > 0, 'renderOpponent is locatable');
ok(!/spriteUrl\(opponent\.id\)/.test(opponentFn),
  'the opponent panel does not duplicate the battle artwork');
ok(/sd-opponent-team/.test(JS), 'the opponent six is painted next to the player six');
ok(/summary\.verdict/.test(jsCode) && /summary\.record/.test(jsCode),
  'the summary prints the verdict and the record');

ok(/defensiveMultiplier/.test(GAME), 'the game module reads the one type chart');
ok(/TYPELESS_MOVES|isDamaging/.test(GAME), 'the game module reads the one damaging-move rule');
ok(!/1\.5/.test(gameCode), 'the game module applies no STAB multiplier');
ok(!/Math\.random\(/.test(gameCode), 'no rule calls Math.random directly; the generator is injected');

/* ===== the session, driven deterministically ===== */

const roster = prepareDraftRoster(DATA);
const byId = new Map(roster.map((pokemon) => [pokemon.id, pokemon]));

is(roster.length, 568, 'the session sees the 568-species pool');
is(ROUNDS, 6, 'six rounds');
is(CANDIDATES, 6, 'six candidates per round');
is(TEAM_SIZE, 6, 'six team members');

const shortSpecies = roster.filter((pokemon) => pokemon.short);
eq(shortSpecies.map((pokemon) => pokemon.id).sort((a, b) => a - b), [132, 201, 235],
  'the three short species are the ones the data checker names');
for (const pokemon of shortSpecies) is(pokemon.moves.length, 1, `#${pokemon.id} keeps its one move`);

/* ===== the move rule: a pool, two swaps, two guarantees ===== */

is(SWAPS, 2, 'a run swaps two of the four moves');
is(MOVES_PER_MEMBER, 4, 'a card shows four moves');

let moveSeed = 0x9e3779b9;
const moveRng = () => {
  moveSeed = (moveSeed * 1664525 + 1013904223) >>> 0;
  return moveSeed / 2 ** 32;
};
const variants = new Map();
for (const pokemon of roster) {
  const protectedMove = pokemon.pool.at(-1)?.id;
  const sets = new Set();
  const canScore = [...pokemon.pool, ...pokemon.fill].some((move) => move.damaging);
  const guardedTypes = pokemon.types.filter(
    (type) => pokemon.anchors.some((anchor) => anchor.type === type),
  );
  for (let i = 0; i < 24; i += 1) {
    const moves = pickMoves(pokemon, moveRng);
    const ids = moves.map((move) => move.id);
    is(new Set(ids).size, ids.length, `#${pokemon.id} never repeats a move`);
    ok(moves.length <= MOVES_PER_MEMBER, `#${pokemon.id} offers at most four moves`);
    is(moves.length, Math.min(MOVES_PER_MEMBER, new Set([
      ...pokemon.pool.map((move) => move.id),
      ...pokemon.fill.map((move) => move.id),
    ]).size), `#${pokemon.id} offers every move it has, up to four`);
    ok(ids.includes(protectedMove), `#${pokemon.id} keeps its highest-level move`);
    if (pokemon.pool.length >= MOVES_PER_MEMBER) {
      is(ids[MOVES_PER_MEMBER - 1], protectedMove,
        `#${pokemon.id} keeps it as the fourth slot`);
    }
    if (canScore) ok(moves.some((move) => move.damaging), `#${pokemon.id} still has a move that scores`);
    for (const type of guardedTypes) {
      ok(moves.some((move) => move.damaging && move.type === type),
        `#${pokemon.id} keeps a damaging ${type} move`);
    }
    sets.add(ids.join(','));
  }
  variants.set(pokemon.id, sets.size);
}
eq([...variants].filter(([, count]) => count === 1).map(([id]) => id).sort((a, b) => a - b),
  [132, 201, 225, 235, 512, 514, 516],
  'only the seven species with four or fewer level moves cannot vary');
ok([...variants.values()].filter((count) => count > 1).length >= 555,
  'at least 555 species vary between runs');

let seed = 0x5eed;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const session = createDraftSession(DATA, rng);
const sessionById = new Map(session.roster.map((pokemon) => [pokemon.id, pokemon]));
is(session.phase, 'draft', 'a run starts in the draft');
is(session.round, 1, 'a run starts on round 1');
is(session.candidates.length, 6, 'the first round offers six');
is(new Set(session.candidates).size, 6, 'the first round has no duplicate candidate');
ok(session.candidates.every((id) => byId.has(id)), 'every candidate resolves in the roster');
ok(!session.canConfirmPick, 'a run cannot confirm before a selection');

ok(!session.select(999999), 'an id outside the candidates cannot be selected');
is(session.confirmPick(), null, 'confirming with no selection does nothing');

const shown = new Set(session.candidates);
for (let round = 1; round <= ROUNDS; round += 1) {
  is(session.round, round, `round ${round} is current`);
  is(session.candidates.length, 6, `round ${round} offers six`);
  is(session.pendingRound, null, `round ${round} starts with no reveal waiting`);
  for (const id of session.candidates) {
    ok(!shown.has(id) || session.seen.has(id), `round ${round} candidate ${id} is tracked`);
  }

  const offered = [...session.candidates];
  session.select(offered[round % offered.length]);
  ok(session.canConfirmPick, `round ${round} accepts a selection`);
  const picked = session.confirmPick();
  ok(Boolean(picked), `round ${round} confirms a pick`);
  is(picked.player.id, offered[round % offered.length], `round ${round}'s player pick is the selected id`);
  ok(session.team.includes(picked.player.id), `round ${round}'s pick joins the team`);
  ok(session.opponent.includes(picked.opponent.id), `round ${round}'s computer pick joins its team`);
  ok(offered.includes(picked.opponent.id) && picked.opponent.id !== picked.player.id,
    `round ${round}'s computer picks one of the five the player passed on`);
  is(session.team.length, round, `the team grows to ${round}`);
  is(session.opponent.length, round, `the computer team grows to ${round}`);
  is(session.selectedId, null, `round ${round} clears the selection after confirming`);
  is(session.pendingRound, picked, `round ${round} holds its reveal until nextRound()`);
  ok(!session.canConfirmPick, `round ${round} cannot confirm twice`);
  is(session.confirmPick(), null, `round ${round} rejects a second confirm`);
  ok(!session.select(offered[0]), `round ${round} cannot change its pick after confirming`);

  const advanced = session.nextRound();
  ok(Boolean(advanced), `round ${round} advances explicitly`);
  is(session.pendingRound, null, `round ${round} clears its reveal on advance`);
  if (round < ROUNDS) {
    is(session.phase, 'draft', `round ${round} stays in the draft`);
    is(advanced.round, round + 1, `advance names round ${round + 1}`);
    for (const id of session.candidates) {
      ok(!shown.has(id), `round ${round + 1} never repeats a shown silhouette`);
      shown.add(id);
    }
  } else {
    is(session.phase, 'match', 'the sixth advance enters the match');
    is(advanced.round, ROUNDS, 'the sixth advance reports six rounds');
    is(session.candidates.length, 0, 'the candidate list is empty after the draft');
    is(session.nextRound(), null, 'the match cannot be advanced as another round');
  }
}

is(session.team.length, 6, 'six picks make a team');
is(new Set(session.team).size, 6, 'the team has six distinct species');
is(session.phase, 'match', 'the sixth advance enters the match');
is(session.opponent.length, 6, 'the computer drafts six');
is(new Set(session.opponent).size, 6, 'the computer team has no duplicate');
ok(session.opponent.every((id) => !session.team.includes(id)),
  'the computer team is disjoint from the player team');

is(session.currentMatchNumber, 1, 'the first matchup is current');
ok(Boolean(session.currentOpponent), 'the first opponent is revealed');
ok(!session.canConfirmMatch, 'the match cannot confirm before a member is selected');
is(session.confirmMatch(), null, 'confirming with no member does nothing');
ok(!session.selectMatchMember(session.team[0] + 999999), 'a non-member cannot be sent out');

for (let index = 0; index < TEAM_SIZE; index += 1) {
  const member = session.team.find((id) => !session.isUsed(id));
  ok(session.selectMatchMember(member), `match ${index + 1} selects an unused member`);
  const matchup = session.confirmMatch();
  ok(Boolean(matchup), `match ${index + 1} confirms`);
  is(matchup.index, index + 1, `match ${index + 1} is numbered`);
  eq(matchup.playerOffense.moves.length, byId.get(member).moves.length,
    `match ${index + 1} scores every move the player has`);
  eq(matchup.computerOffense.moves.length, byId.get(matchup.opponentId).moves.length,
    `match ${index + 1} scores every move the opponent has`);
  for (const move of [...matchup.playerOffense.moves, ...matchup.computerOffense.moves]) {
    if (TYPELESS_MOVES.has(move.id)) is(move.multiplier, null, `move ${move.id} is not scored`);
  }
  ok(session.isUsed(member), `match ${index + 1}'s member is marked used`);
  ok(!session.selectMatchMember(member), 'a used member cannot be sent out twice');
}

is(session.matchups.length, 6, 'six matchups complete');
is(session.matchIndex, 6, 'the match index reaches six');
is(session.phase, 'match', 'the sixth analysis stays on screen until finish()');
ok(!session.canConfirmMatch, 'no seventh match exists');
ok(session.finish(), 'finish() advances to the summary');
is(session.phase, 'summary', 'the run ends in the summary');

const summary = session.summary();
is(summary.rows.length, 6, 'the summary has six rows');
for (const side of [summary.player, summary.computer]) {
  is(side.reduce((total, band) => total + band.count, 0), 6,
    'each tally accounts for all six matchups');
}
eq(summary.player.map((band) => band.multiplier), [...MULTIPLIER_BANDS, null],
  'a tally lists the canonical bands and then none');
is(summary.player.at(-1).multiplier, null, 'the no-scoring bucket is separate from 0x');

is(summary.record.wins + summary.record.draws + summary.record.losses, 6,
  'the record accounts for all six matchups');
ok(summary.rows.every((matchup) => ['win', 'draw', 'loss'].includes(matchup.outcome)),
  'every matchup carries a verdict');
const expectedWins = summary.rows.filter((matchup) => matchup.outcome === 'win').length;
const expectedLosses = summary.rows.filter((matchup) => matchup.outcome === 'loss').length;
is(summary.record.wins, expectedWins, 'the win count matches the rows');
is(summary.record.losses, expectedLosses, 'the loss count matches the rows');
const expectedVerdict = expectedWins > expectedLosses ? 'win'
  : expectedWins < expectedLosses ? 'loss'
    : summary.playerTotal > summary.computerTotal ? 'win'
      : summary.playerTotal < summary.computerTotal ? 'loss' : 'draw';
is(summary.verdict, expectedVerdict, 'wins decide the verdict before the multiplier total');
const expectedGrade = expectedWins >= 6 ? 'S'
  : expectedWins >= 5 ? 'A' : expectedWins >= 4 ? 'B' : expectedWins >= 3 ? 'C' : 'D';
is(summary.grade, expectedGrade, 'the grade follows the win count');

/* ===== the arithmetic itself ===== */

const fire = {
  id: 1,
  types: ['Fire'],
  moves: [{ id: 1, zh: '火焰', type: 'Fire', class: 'special', damaging: true }],
};
const grassSteel = { id: 2, types: ['Grass', 'Steel'], moves: [] };
const fireVsGrassSteel = attackProfile(fire, grassSteel);
is(fireVsGrassSteel.moves[0].multiplier, 4,
  'dual-type defence multiplies both halves: Fire vs Grass/Steel is 4x');
is(fireVsGrassSteel.best, 4, 'the best multiplier is the chart value, not 6x from STAB');

const statusMove = {
  id: 3,
  types: ['Normal'],
  moves: [{ id: 182, zh: '守住', type: 'Normal', class: 'status', damaging: false }],
};
const protectedProfile = attackProfile(statusMove, grassSteel);
is(protectedProfile.moves[0].multiplier, null, 'a status move has no type multiplier');
is(protectedProfile.best, null, 'a status-only side has no best multiplier');

is(multiplierText(4), '4×', '4x prints as 4×');
is(multiplierText(0.25), '0.25×', 'a quarter prints as 0.25×');
is(multiplierText(0), '0×', 'an immunity prints as 0×, not blank');
is(multiplierText(null), '—', 'an unscored move prints an em dash');
is(multiplierBand(0.5), '0.5', 'the band is the exact multiplier');
is(multiplierBand(null), 'none', 'an unscored move has its own band');

is(duelOutcome(2, 1), 'win', 'a higher best multiplier wins');
is(duelOutcome(1, 1), 'draw', 'equal best multipliers draw');
is(duelOutcome(0.5, 2), 'loss', 'a lower best multiplier loses');
is(duelOutcome(null, 0), 'draw', 'no scorable move counts as zero against an immunity');
is(duelOutcome(0, null), 'draw', 'an immunity counts as zero against no scorable move');

/* ===== the nav row ===== */

const algo = NAV.find((item) => item.id === 'algo');
ok(Boolean(algo), 'the nav keeps the 演算法 group');
ok(algo.pages.includes('silhouette-draft.html'), '演算法 claims the new page');
const row = algo.groups.flatMap((group) => group.items).find((item) => item.href === 'silhouette-draft.html');
ok(Boolean(row), '演算法 has a row for the new page');
is(row?.label, '剪影選秀', 'the row uses the page name');
ok(/對位/.test(row?.desc || ''), 'the row says what the page does');

C.report();
