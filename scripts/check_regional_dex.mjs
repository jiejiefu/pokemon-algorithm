#!/usr/bin/env node
/**
 * Regression checks for the `regional_dex` field written by
 * scripts/fetch_regional_dex.py. Run: node scripts/check_regional_dex.mjs
 *
 * Pins the invariants that are cheap to check and expensive to get wrong. It
 * deliberately does NOT re-derive the numbers from PokeAPI: that is the
 * generator's job and would make this test depend on the network. What it pins
 * is everything a later edit to either file could silently break.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(join(BASE, p), 'utf8'));

const MAX_ID = 1025;

// PokeAPI slugs, in the order the script writes them. Kept as slug/label pairs
// because the label is what the page renders and the slug is what pins *which*
// pokedex produced a number -- `hoenn` vs `updated-hoenn` is the distinction
// that Bulbasaur's 城都 226 exists to settle.
const DEXES = [
  ['national', '全國'],
  ['kanto', '關都'],
  ['original-johto', '城都'],
  ['hoenn', '豐緣'],
  ['original-sinnoh', '神奧'],
  ['original-unova', '合眾'],
  ['kalos-central', '卡洛斯'],
  ['original-alola', '阿羅拉'],
  ['galar', '伽勒爾'],
  ['hisui', '洗翠'],
  ['paldea', '帕底亞'],
  ['blueberry', '藍莓學園'],
];
const LABELS = DEXES.map(([, l]) => l);
const NATIONAL = LABELS[0];

let checks = 0;
const problems = [];
const ok = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
// === on two objects compares references, so anything structural is compared
// through its serialisation. Key order is part of the contract here, and JSON
// preserves insertion order, so this is exact rather than order-insensitive.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (got, want, msg) => ok(same(got, want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const data = read('assets/data/pokemon_data.json');
const generations = read('assets/data/generations.json');

console.log('dataset shape');
eq(data.length, MAX_ID, 'record count');
eq(data.filter(p => typeof p.regional_dex === 'object' && p.regional_dex !== null).length,
  MAX_ID, 'records carrying a regional_dex object');
eq(new Set(data.map(p => p.id)).size, MAX_ID, 'distinct ids');
ok(data.every(p => p.id >= 1 && p.id <= MAX_ID), 'ids are within 1..1025');

console.log('the national entry is the id, always');
ok(data.every(p => p.regional_dex[NATIONAL] === p.id),
  '全國 equals the record id for all 1025');
// Defends the positional mapping the generator relies on.
eq(data.filter(p => p.regional_dex[NATIONAL] !== p.id).length, 0, '全國 mismatches');

console.log('key order and key set');
ok(data.every(p => {
  const keys = Object.keys(p.regional_dex);
  const rank = k => LABELS.indexOf(k);
  return keys.every(k => rank(k) >= 0) && keys.every((k, i) => i === 0 || rank(keys[i - 1]) < rank(k));
}), 'every key is a known label, in DEXES order, so the page never sorts');
ok(data.every(p => Object.keys(p.regional_dex)[0] === NATIONAL), '全國 is the first key');

console.log('values');
ok(data.every(p => Object.values(p.regional_dex).every(v => Number.isInteger(v) && v >= 0)),
  'all values are non-negative integers (Victini is 合眾 0)');
const regionalMax = Math.max(...data.flatMap(p =>
  Object.entries(p.regional_dex).filter(([k]) => k !== NATIONAL).map(([, v]) => v)));
eq(regionalMax, 400, 'widest regional number');
const victini = data.find(p => p.id === 494);
eq(victini.regional_dex['合眾'], 0, 'id 494 (Victini) is 合眾 0');
ok(data.some(p => Object.keys(p.regional_dex).length === 1),
  'at least one record has only 全國, so that branch is exercised');

console.log('the 28 regional-dex-free records are not empty');
const nationalOnly = data.filter(p => Object.keys(p.regional_dex).length === 1);
eq(nationalOnly.length, 28, 'records with only 全國');
ok(nationalOnly.every(p => p.regional_dex[NATIONAL] === p.id), 'their 全國 is still present');

console.log('distribution');
const sizes = data.map(p => Object.keys(p.regional_dex).length);
eq(Math.min(...sizes), 1, 'fewest dexes on any record');
eq(Math.max(...sizes), 10, 'most dexes on any record');
const pikachu = data.find(p => p.id === 25);
eq(Object.keys(pikachu.regional_dex).length, 10, 'id 25 (Pikachu) has 10');

console.log('spot checks against the InfoPoke snapshot');
// The one record whose dex rows were cross-checked against the reference site.
eq(data[0].regional_dex, { 全國: 1, 關都: 1, 城都: 226, 卡洛斯: 80, 藍莓學園: 164 },
  'id 1 (Bulbasaur) matches the snapshot 5/5');
// First appearance, not the updated list: updated-johto would say 231.
eq(data[0].regional_dex['城都'], 226, 'Bulbasaur 城都 is 226, not updated-johto 231');

console.log('label vocabulary agrees with the generations guide');
const regions = new Set(generations.map(g => g.region));
eq(regions.size, 9, 'generations.json region count');
ok([...regions].every(r => LABELS.includes(r)),
  'every generations.json region has a dex label');
// The converse is intentional, and smaller than it looks: 9 of the 12 labels
// ARE generations.json regions (帕底亞 is gen 9's), so only three are outside --
// 洗翠, a Gen 8 sub-region, plus 全國 and 藍莓學園, which are not regions.
eq(LABELS.filter(l => !regions.has(l)).sort(), ['洗翠', '全國', '藍莓學園'].sort(),
  'the labels outside generations.json are exactly the three expected ones');
eq(LABELS.filter(l => regions.has(l)).length, 9, 'nine of the twelve labels are regions');
ok(LABELS.includes('洗翠'), '洗翠 is the Hisui label in use, not 蒼炎 or 他思岐');
// The site spells this region one way. It was 他思岐 in both the dex labels and
// categories.js until the form-name work found the same region rendered under two
// words, so the whole repo asserts the single spelling rather than fixing one page.
ok(!LABELS.includes('他思岐'), 'the old 他思岐 label is gone from the dex');
ok(!/他思岐/.test(readFileSync(join(BASE, 'assets/js/categories.js'), 'utf8')),
  'categories.js no longer spells Hisui 他思岐');

console.log('the detail page renders every label it stores');
const detail = readFileSync(join(BASE, 'detail.html'), 'utf8');
ok(detail.includes('renderRegionalDex(p)'), 'renderRegionalDex is called by renderDetail');
ok(detail.includes('id="dex-list"'), 'the #dex-list container exists');
ok(detail.includes('id="grp-dex"'), 'the 地區圖鑑 heading exists and is the aria-labelledby target');
ok(detail.includes('aria-labelledby="grp-dex"'), 'the group is labelled by its heading');
ok(detail.includes("label === '全國' ? formatPokemonId(number)"),
  '全國 goes through formatPokemonId (4 digits) and regional numbers are 3');
// The generator's ordering guarantee, asserted on the consumer side too.
ok(/Object\.entries\(dex\)/.test(detail), 'the renderer iterates the stored key order');

console.log('enhance_pokemon_data.py carries the key through Phase 1');
const enhance = readFileSync(join(BASE, 'scripts/enhance_pokemon_data.py'), 'utf8');
ok(/'regional_dex':\s*dict\(existing\['regional_dex'\]\)\s*if existing\.get\('regional_dex'\)\s+is\s+not\s+None\s+else\s+\{\}/.test(enhance),
  "the whitelist entry is `is not None`, not truthiness");

if (problems.length) {
  for (const p of problems.slice(0, 30)) console.error(`  FAIL ${p}`);
  if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
  console.error(`\n${problems.length} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
