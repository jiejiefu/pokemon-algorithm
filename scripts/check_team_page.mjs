/**
 * `team.html` static regression test.
 *
 *   node scripts/check_team_page.mjs
 *
 * Covers four things a text reader can decide: the page's DOM contract, the
 * stylesheet's two-tone slot rule and `tm-` prefix, the roster table's
 * referential integrity, and the pure modules' arithmetic/state transitions.
 * It never boots a browser, so it costs ~0.1 s.
 *
 * The rendered claims — that six slots actually paint, that a mark lights its
 * slot, that the grid narrows — are deliberately NOT asserted here. If this
 * page earns a browser checker it goes in its own `*-browser` file, alone, per
 * §4; a static PASS must not be read as a rendered one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TYPE_CHART_ORDER } from '../assets/js/type-chart.js';
import {
  analyzeTeam, defensiveMultiplier, defensiveProfile, stabCoverage, teamSummary,
} from '../assets/js/team-analysis.js';
import {
  TEAM_LIMIT, parseTeamParam, serializeTeamParam, addMember, removeMember,
  filterRoster, matchesQuery, randomTeam,
} from '../assets/js/team-state.js';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const readData = name => JSON.parse(read(`assets/data/${name}`));

const HTML = read('team.html');
const CSS = read('assets/css/team.css');
const JS = read('assets/js/team.js');
const SHARED = read('assets/js/shared.js');
const PALETTE = read('assets/js/color-palette.js');
const ANALYSIS = read('assets/js/team-analysis.js');
const STATE = read('assets/js/team-state.js');
const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const roster = readData('team_roster.json');
const byId = new Map(roster.pokemon.map((pokemon) => [pokemon.id, pokemon]));
const allIds = roster.pokemon.map((pokemon) => pokemon.id);

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, is, eq } = C;

const attrs = (id) => (HTML.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [''])[0];

/* ===== the page's DOM contract ===== */

ok(/<html lang="zh-TW">/.test(HTML), 'team.html declares a zh-TW document');
ok((HTML.match(/assets\/css\/shared\.css/g) || []).length === 1, 'team.html mounts shared.css exactly once');
ok((HTML.match(/assets\/css\/team\.css/g) || []).length === 1, 'team.html mounts team.css exactly once');
ok(/class="header header-dex"/.test(HTML), 'team.html carries exactly one row-layout header modifier');

ok(/<ol[^>]*id="tm-slots"[^>]*data-slot-count="6"/.test(HTML),
  'the slot container declares six slots');
ok(/<ol[^>]*id="tm-defense"[^>]*data-tally-count="18"/.test(HTML),
  'the defensive tally declares eighteen rows');
ok(/<ol[^>]*id="tm-coverage"[^>]*data-tally-count="18"/.test(HTML),
  'the coverage tally declares eighteen rows');
ok(/<ul[^>]*id="tm-grid"[^>]*>\s*<\/ul>/.test(HTML),
  'the roster grid starts empty — every card is built from the table, not hand-written');

const controls = ['tm-search', 'tm-region', 'tm-generation', 'tm-type'];
for (const id of controls) ok(attrs(id).length > 0, `the picker still carries #${id}`);
for (const id of ['tm-empty', 'tm-more', 'tm-status', 'tm-resultline', 'tm-action-status']) {
  ok(attrs(id).length > 0, `the page still carries #${id}`);
}
ok(/id="tm-empty"[^>]*hidden/.test(HTML), '#tm-empty starts hidden');
ok(/id="tm-more"[^>]*hidden/.test(HTML), '#tm-more starts hidden');

for (const id of ['tm-count', 'tm-resultline', 'tm-action-status']) {
  ok(/role="status"/.test(attrs(id)) && /aria-live="polite"/.test(attrs(id)),
    `#${id} is a polite live region`);
}
ok(/不含特性、道具與招式/.test(HTML),
  'the page states the analysis is type-only, so it is not read as a battle prediction');

ok(/from '\.\/assets\/js\/team\.js'/.test(HTML), 'the page imports the feature module');
ok(/^\s*initTeamPage\(\);$/m.test(HTML), 'the page actually starts the planner');
ok(/^\s*initHeaderNav\('team\.html'\);$/m.test(HTML), 'the page marks team.html current in the nav');

/* ===== the stylesheet's two-tone slot ===== */

const twoTone = cssCode.match(/\.tm-slot\.is-filled::before\s*\{([^}]*)\}/);
ok(Boolean(twoTone), 'team.css still declares the two-tone slot body');
ok(
  Boolean(twoTone) && /linear-gradient\(180deg,\s*var\(--tm-c1\)\s+0\s+50%,\s*var\(--tm-c2\)\s+50%\s+100%\)/.test(twoTone[1]),
  'the slot splits on the horizontal: primary top half, secondary bottom half',
  twoTone ? twoTone[1].replace(/\s+/g, ' ').trim() : 'rule missing',
);
ok(
  Boolean(twoTone) && !/(135deg|45deg|to bottom right|to top right|to right bottom|to left bottom)/.test(twoTone[1]),
  'the slot is not a diagonal split',
);
ok(/\.tm-slot\.is-filled::after\s*\{/.test(cssCode), 'the slot draws the Poké Ball seam between the halves');
ok(/var\(--tm-c1\)/.test(cssCode) && /var\(--tm-c2\)/.test(cssCode),
  'both type colours are consumed as custom properties');
ok(/\.tm-tally-head\s*\{[^}]*grid-template-columns:\s*92px 38px 1fr/.test(cssCode),
  'the member header shares the tally grid, so a chip sits over its own mark column');
ok(/@media \(max-width: 560px\)[\s\S]*?\.tm-tally,\s*\.tm-tally-head\s*\{\s*grid-template-columns:\s*84px 32px 1fr/.test(cssCode),
  'the header and the rows share the narrow-screen grid too, not just the wide one');

ok(/--tm-weak:\s*#[0-9a-f]{6}/i.test(cssCode), 'the weak mark colour is a named token');
ok(/--tm-resist:\s*#[0-9a-f]{6}/i.test(cssCode), 'the resist mark colour is a named token');
ok(/\[data-theme="light"\]\s*\{[^}]*--tm-tint/.test(cssCode),
  'the light theme re-declares the slot tint instead of inheriting the dark one');
ok(/\.tm-status\[hidden\]\s*\{\s*display:\s*none/.test(cssCode),
  'the status line pairs [hidden] with an author display rule');

ok(/@media \(max-width: 1100px\)[\s\S]*?\.tm-slots\s*\{\s*grid-template-columns:\s*repeat\(3/.test(cssCode),
  'the six slots collapse to three on narrow desktop');
ok(/@media \(max-width: 560px\)[\s\S]*?\.tm-slots\s*\{\s*grid-template-columns:\s*repeat\(2/.test(cssCode),
  'the six slots collapse to two on a phone');
ok(/@media \(prefers-reduced-motion: reduce\)/.test(cssCode), 'reduced motion is honoured');
ok(/\.tm-card:focus-visible/.test(cssCode) && /\.tm-search:focus-visible/.test(cssCode),
  'the cards and the search field have visible focus rings');

const selectors = [...cssCode.matchAll(/([^{}]+)\{/g)].map((match) => match[1]).join(',');
const classes = [...new Set([...selectors.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))];
const stray = classes.filter((name) => (
  !name.startsWith('tm-') && !name.startsWith('is-') && name !== 'type-badge'
));
eq(stray, [], 'every class in team.css is tm- prefixed or an is- state (plus the shared .type-badge)');
ok(!/(^|\})\s*\.type-badge\s*\{/.test(cssCode),
  'team.css never redefines the shared .type-badge at top level');

const NEEDED = [
  'tm-slot', 'tm-slot-add', 'tm-slot-plus', 'tm-slot-hint', 'tm-slot-fill',
  'tm-slot-render', 'tm-slot-sprite', 'tm-slot-remove', 'tm-slot-info',
  'tm-slot-name', 'tm-slot-types', 'tm-card', 'tm-card-name', 'tm-card-id',
  'tm-summary-card', 'tm-chips', 'tm-tally', 'tm-tally-type', 'tm-tally-score',
  'tm-marks', 'tm-mark', 'tm-empty', 'tm-more', 'tm-tint', 'tm-seam',
  'tm-tally-head', 'tm-tally-member',
];
for (const name of NEEDED) {
  ok(cssCode.includes(`.${name}`) || cssCode.includes(`--${name}`),
    `team.css defines ${name.startsWith('tm-') ? `.${name}` : name}`);
}
for (const modifier of ['is-filled', 'is-highlight', 'is-weak', 'is-resist', 'is-empty']) {
  ok(cssCode.includes(`.${modifier}`), `team.css styles the ${modifier} state`);
}

/* ===== the feature module's contracts ===== */

ok(/fetch\('assets\/data\/team_roster\.json'\)/.test(JS),
  'team.js reads the compact roster, never pokemon_data.json');
ok(/spriteUrl\(pokemon\.id\)/.test(JS), 'cards and slots use the 96px sprite helper');
ok(/pokemonDetailUrl\(pokemon\)/.test(JS), 'the slot name links through pokemonDetailUrl()');
ok(/history\.replaceState/.test(JS), 'the URL is rewritten in place rather than pushing a step per click');
ok(/parseTeamParam\(/.test(JS) && /serializeTeamParam\(/.test(JS),
  'the URL is parsed and written by the state module, not by hand');
ok(!/searchParams\.set\(\s*['"]team['"]/.test(JS),
  'the team param never goes through searchParams.set(), which turns the commas into %2C');
ok(/team=\$\{serializeTeamParam\(/.test(JS),
  'the written query spells ?team= with literal commas, the documented share form');
ok(/setProperty\('--tm-c1'/.test(JS) && /setProperty\('--tm-c2'/.test(JS),
  'team.js feeds both halves of the slot from the type palette');
ok(/typePair\(primary\)/.test(JS), 'the name bar uses the measured AA fill/ink pair');
ok((HTML.match(/id="tm-(defense|coverage)-head"/g) || []).length === 2,
  'both tallies mount a member header row');
ok(/renderTallyHeads\(\)/.test(JS) && /chip\.dataset\.slot/.test(JS),
  'the header chips are rebuilt from the team and carry the mark column index');
ok(/typeBadgeSmHtml/.test(JS), 'type chips come from the shared badge helper');
ok(/export function typePair\b/.test(SHARED) && /export function typeBadgeSmHtml\b/.test(SHARED),
  'the shared helpers team.js calls still exist in shared.js');
ok(/export function pokemonDetailUrl\b/.test(SHARED),
  'the detail-page URL helper still exists, so a slot name is not assembled by hand');
ok(/export function spriteUrl\b/.test(PALETTE),
  'the 96px sprite helper still exists in color-palette.js');

const limitDefs = [ANALYSIS, STATE, JS].filter((source) => /export const TEAM_LIMIT\s*=\s*6/.test(source));
is(limitDefs.length, 1, 'TEAM_LIMIT is defined once, so the cap cannot drift between modules');
ok(/TEAM_LIMIT/.test(JS), 'team.js consumes the shared cap');

/* ===== the roster table ===== */

is(roster.pokemon.length, 1025, 'the roster carries all 1,025 species');
ok(roster.pokemon.every((pokemon, index) => pokemon.id === index + 1),
  'ids are unique, contiguous, and in national-dex order');
is(roster.regions.length, 12, 'the roster names twelve regional dexes');
is(new Set(roster.regions).size, 12, 'the region names are unique');

const union = new Set();
for (const pokemon of roster.pokemon) for (const region of pokemon.regions) union.add(region);
eq([...union].sort(), [...roster.regions].sort(),
  'the region list and the records agree in both directions');

const badRecords = roster.pokemon.filter((pokemon) => (
  !pokemon.names || !pokemon.names.zh || !pokemon.names.en
  || !Array.isArray(pokemon.types) || pokemon.types.length < 1 || pokemon.types.length > 2
  || !pokemon.types.every((type) => TYPE_CHART_ORDER.includes(type))
  || !Number.isInteger(pokemon.generation) || pokemon.generation < 1 || pokemon.generation > 9
  || !Array.isArray(pokemon.regions) || pokemon.regions.length < 1
));
is(badRecords.length, 0, 'every record has names, 1–2 chart types, a generation, and a region');

const bulbasaur = byId.get(1);
is(bulbasaur.names.zh, '妙蛙種子', '#0001 is Bulbasaur in Chinese');
eq(bulbasaur.types, ['Grass', 'Poison'], '#0001 is Grass/Poison');
is(byId.get(6).names.zh, '噴火龍', '#0006 is Charizard');
is(byId.get(1025).names.zh, '桃歹郎', '#1025 is Pecharunt');
is(byId.get(1025).generation, 9, '#1025 is Generation 9');

/* ===== defensive arithmetic ===== */

const profile = defensiveProfile(bulbasaur.types);
is(profile.length, 18, 'a defensive profile covers all eighteen attacking types');
eq(
  profile.filter((row) => row.kind === 'weak').map((row) => row.type).sort(),
  ['Fire', 'Flying', 'Ice', 'Psychic'].sort(),
  'Bulbasaur is weak to Fire, Flying, Ice and Psychic',
);
eq(
  profile.filter((row) => row.kind === 'resist').map((row) => row.type).sort(),
  ['Water', 'Electric', 'Fighting', 'Fairy', 'Grass'].sort(),
  'Bulbasaur resists Water, Electric, Fighting, Fairy and Grass',
);
is(profile.find((row) => row.type === 'Grass').multiplier, 0.25,
  'Grass is a 4x resistance on a Grass/Poison body');
is(defensiveMultiplier(['Flying'], 'Ground'), 0, 'Flying is immune to Ground');
is(defensiveMultiplier(['Fire', 'Flying'], 'Rock'), 4, 'Rock is a 4x weakness on Fire/Flying');

eq(
  [...stabCoverage(bulbasaur.types)].sort(),
  ['Water', 'Ground', 'Rock', 'Grass', 'Fairy'].sort(),
  'Bulbasaur STAB covers Water, Ground, Rock, Grass and Fairy',
);

const team = analyzeTeam([1, 6, 25], byId);
is(team.members.length, 3, 'analyzeTeam keeps the supplied order');
eq(team.members.map((member) => member.names.zh), ['妙蛙種子', '噴火龍', '皮卡丘'],
  'the team is reported in slot order');
eq(team.defense.map((row) => row.type), TYPE_CHART_ORDER,
  'defensive rows follow the chart order');
eq(team.coverage.map((row) => row.type), TYPE_CHART_ORDER,
  'coverage rows follow the chart order');

const empty = analyzeTeam([], byId);
is(empty.members.length, 0, 'an empty team analyzes to zero members');
ok(empty.defense.every((row) => row.score === 0 && row.weak.length === 0),
  'an empty team has no weakness marks');
ok(empty.coverage.every((row) => row.count === 0), 'an empty team covers nothing');

const summary = teamSummary(team);
eq(summary.commonWeaknesses, [], 'the fixture team shares no weakness');
eq(summary.unresisted, ['Rock', 'Psychic', 'Ice'],
  'Rock, Psychic and Ice have a weak member and no resisting one');
eq(
  summary.uncovered.sort(),
  ['Normal', 'Poison', 'Ghost', 'Fire', 'Electric', 'Psychic', 'Dragon', 'Dark'].sort(),
  'the fixture team leaves eight types uncovered by STAB',
);

/* ===== state transitions ===== */

const parsed = parseTeamParam('1,1,6,25,9999', new Set(allIds));
eq(parsed.ids, [1, 6, 25], 'parse keeps valid ids in order and drops duplicates');
is(parsed.ignored, 2, 'parse counts the duplicate and the out-of-range id');
is(parseTeamParam('', new Set(allIds)).ignored, 0, 'an empty ?team= is not an error');
eq(parseTeamParam('abc,1.5,-1,0', new Set(allIds)).ids, [],
  'non-integers and ids outside the roster are dropped');
is(parseTeamParam('1,2,3,4,5,6,7', new Set(allIds)).ids.length, 6,
  'parse stops at the six-member cap');
is(parseTeamParam('1,2,3,4,5,6,7', new Set(allIds)).ignored, 1,
  'the seventh id is counted, never silently truncated');

is(serializeTeamParam([1, 6, 25]), '1,6,25', 'serialize writes the documented ?team= form');
eq(parseTeamParam(serializeTeamParam([1, 6, 25]), new Set(allIds)).ids, [1, 6, 25],
  'serialize -> parse is an identity for a legal team');

is(addMember([1], 6, new Set(allIds)).ok, true, 'a new id is accepted');
is(addMember([1], 1, new Set(allIds)).reason, 'duplicate', 'a duplicate is rejected with a reason');
is(addMember([1], 9999, new Set(allIds)).reason, 'invalid', 'an unknown id is rejected with a reason');
is(addMember([1, 2, 3, 4, 5, 6], 7, new Set(allIds)).reason, 'full',
  'a seventh member is rejected with the full reason');
eq(removeMember([1, 6, 25], 6), [1, 25], 'remove keeps the remaining order');
eq(removeMember([1], 9999), [1], 'removing an absent id is a no-op');

is(matchesQuery(byId.get(25), '025'), true, 'a zero-padded id matches exactly');
is(matchesQuery(byId.get(250), '025'), false, '025 does not match 0250');
is(matchesQuery(byId.get(1), '#0001'), true, 'a #-prefixed id matches');
is(matchesQuery(byId.get(122), 'mrmime'), true, 'Mr. Mime matches without its space or period');
is(matchesQuery(byId.get(669), 'flabebe'), true, 'Flabébé matches without its accent');
is(matchesQuery(byId.get(25), '皮卡丘'), true, 'a Chinese name matches');
is(matchesQuery(byId.get(25), 'pikachu'), true, 'an English name matches');

is(filterRoster(roster.pokemon, {}).length, 1025, 'an empty filter keeps the whole roster');
const kanto = filterRoster(roster.pokemon, { region: '關都' });
is(kanto.length, 151, 'the Kanto filter is the 151-species regional dex');
ok(kanto.some((pokemon) => pokemon.id === 151), 'Kanto includes Mew');
ok(!kanto.some((pokemon) => pokemon.id === 152), 'Kanto excludes Chikorita');
is(filterRoster(roster.pokemon, { generation: '1' }).length, 151,
  'the Generation 1 filter is 151 species');
is(filterRoster(roster.pokemon, { generation: '1' }).at(-1).id, 151,
  'Generation 1 ends at #0151');
is(filterRoster(roster.pokemon, { type: 'Fire' }).length, 81, 'the Fire filter finds 81 species');
eq(
  filterRoster(roster.pokemon, {
    region: '關都', generation: '1', type: 'Fire', query: 'charizard',
  }).map((pokemon) => pokemon.id),
  [6],
  'the four filters compose',
);

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const drawA = randomTeam(allIds, TEAM_LIMIT, seeded(42));
const drawB = randomTeam(allIds, TEAM_LIMIT, seeded(42));
eq(drawA, drawB, 'randomTeam is deterministic under an injected generator');
is(drawA.length, 6, 'randomTeam fills six slots');
is(new Set(drawA).size, 6, 'randomTeam never repeats a species');
ok(drawA.every((id) => byId.has(id)), 'randomTeam draws only roster ids');
is(randomTeam([1, 2, 3], TEAM_LIMIT, seeded(7)).length, 3,
  'a pool smaller than the cap is returned whole');

process.exit(C.report());
