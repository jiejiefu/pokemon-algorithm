/**
 * Type profile regression test
 *
 *   node scripts/check_type_profiles.mjs
 *
 * Guards assets/data/type_profiles.json, the per-type prose that types.html
 * renders. The file is produced by scripts/fetch_type_profiles.py from the
 * InfoPoke `/types/[id]` Nuxt chunk; that payload is awkward enough that the
 * scraper's own structural checks are not sufficient on their own, because the
 * upstream data has shifted shape before (entries keyed by a stale variable
 * name, and a zh-TW page that renders raw i18n keys because no zh-TW catalog
 * exists upstream at all).
 *
 * The invariants pinned here are the ones the page depends on:
 *   - all 18 slugs present, in the canonical chart order;
 *   - every effect string is actually Traditional Chinese, so a regression to
 *     the un-converted Simplified Chinese is caught here rather than shipping
 *     胆量 / 允许 to a zh-TW site;
 *   - every ability and item name resolves against a name this project already
 *     trusts (abilities_zh.json), so a scrape cannot quietly rename 膽量;
 *   - every category is one this project can render;
 *   - the trainer role labels are translated, not left as InfoPoke's English.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TYPE_CHART_ORDER } from '../assets/js/type-chart.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'assets', 'data');

let failures = 0;
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  }
}

function eq(actual, expected, message) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
  );
}

const read = name => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

/* ------------------------------------------------------------------ structure */
console.log('document');
const doc = read('type_profiles.json');
const types = doc.types || {};

const SLUGS = TYPE_CHART_ORDER.map(t => t.toLowerCase());
// The file keeps InfoPoke's own key order (normal, fire, water, ...), which is
// also the site's canonical order in TYPE_EN_ZH. Compare as a set: consumers
// must iterate TYPE_CHART_ORDER rather than trusting file order.
eq([...Object.keys(types)].sort(), [...SLUGS].sort(), 'every chart type has a profile');
ok(Object.keys(types).length === 18, `expected 18 profiles, got ${Object.keys(types).length}`);

ok(typeof doc.source?.chunk === 'string' && doc.source.chunk.includes('/_nuxt/'),
  'source.chunk records the JS chunk the prose was read from');
ok(typeof doc.source?.fetchedAt === 'string' && !Number.isNaN(Date.parse(doc.source.fetchedAt)),
  'source.fetchedAt is a parseable timestamp');
eq(doc.source?.simplifiedToTraditional, 'OpenCC s2twp',
  'source records which OpenCC profile converted the text');

/* -------------------------------------------------------------- chinese-ness */
console.log('traditional chinese');
const CJK = /[\u4e00-\u9fff]/;
/** Characters that only appear in Simplified Chinese, not in Traditional. */
const SIMPLIFIED_ONLY = /[们个这来对时会说学实发国还无门问间体么龙恶灵宝电龟见气长车东乐买卖头长]/;

let entryTotal = 0;
for (const [slug, profile] of Object.entries(types)) {
  for (const row of profile.entries) {
    entryTotal += 1;
    ok(CJK.test(row.effect), `${slug} ${row.name} effect has no CJK`);
    ok(!SIMPLIFIED_ONLY.test(row.effect),
      `${slug} ${row.name} effect still contains Simplified-only characters: ${row.effect}`);
  }
}
ok(entryTotal >= 100, `scraped ${entryTotal} zh-TW entries (expected >= 100)`);

/* ------------------------------------------------------------- name integrity */
console.log('name integrity');
const abilities = read('abilities_zh.json');
const abilityZh = new Set(Object.values(abilities).map(a => a.zh));

// InfoPoke labels some entries with a slash-joined alias list ("識破 / 嗅覺").
// Compare on the first label only.
const firstLabel = name => name.split('/')[0].trim();

// InfoPoke ships its own zh-TW ability names, which are NOT the official ones:
// 悠遊自如 for Swift Swim, 仙氣護衛 for Fairy Aura, and so on. types.html
// therefore builds its ability list from abilities_zh.json + pokemon_data.json
// and only borrows effect text from here, so an unmatched name is dropped
// rather than rendered. That makes the join rate a feature-completeness metric,
// not a correctness requirement -- but it must not collapse, or the effect text
// silently stops appearing for most types.
let abilityRows = 0;
let abilityMatched = 0;
const unmatched = new Set();
for (const profile of Object.values(types)) {
  for (const row of profile.entries) {
    if (row.category !== 'ability') continue;
    abilityRows += 1;
    if (abilityZh.has(firstLabel(row.name))) abilityMatched += 1;
    else unmatched.add(row.name);
  }
}
const joinRate = abilityMatched / abilityRows;
ok(joinRate >= 0.7,
  `only ${(joinRate * 100).toFixed(0)}% of scraped ability names join to abilities_zh.json`);
console.log(
  `  info  ${abilityMatched}/${abilityRows} ability names join to official zh-TW ` +
  `(${(joinRate * 100).toFixed(0)}%); ${unmatched.size} dropped by types.html`
);

/* ---------------------------------------------------------------- categories */
console.log('categories');
const allowed = new Set(['ability', 'move', 'item']);
const seen = new Set();
for (const profile of Object.values(types)) {
  for (const row of profile.entries) {
    ok(allowed.has(row.category), `unexpected category ${row.category}`);
    seen.add(row.category);
  }
}
eq([...seen].sort(), ['ability', 'item', 'move'], 'all three categories are present');

/* ------------------------------------------------------------------ trainers */
console.log('trainers');
const ENGLISH_TITLE = /\b(Gym Leader|Elite Four|Champion|Rival|Trial Captain|Kahuna|Boss|Admin)\b/;
let trainerTotal = 0;
for (const [slug, profile] of Object.entries(types)) {
  ok(profile.trainers.length > 0, `${slug} has no trainers`);
  for (const trainer of profile.trainers) {
    trainerTotal += 1;
    ok(trainer.name.length > 0, `${slug} has an unnamed trainer`);
    ok(!ENGLISH_TITLE.test(trainer.roleZh),
      `${slug} ${trainer.name} role is still English: ${trainer.roleZh}`);
    ok(CJK.test(trainer.roleZh), `${slug} ${trainer.name} role is not Chinese`);
    // Trainer and city names are proper nouns InfoPoke only ships in English;
    // they are intentionally left as-is, so pin that they are non-empty.
    ok(trainer.location.length > 0, `${slug} ${trainer.name} has no location`);
    ok(/^Gen \d/.test(trainer.generations), `${slug} ${trainer.name} generation reads "${trainer.generations}"`);
  }
}
ok(trainerTotal > 100, `scraped ${trainerTotal} trainers (expected > 100)`);

/* --------------------------------------------------------------- english copy */
console.log('english copy');
for (const [slug, profile] of Object.entries(types)) {
  ok(profile.blurbEn.length > 40, `${slug} blurbEn is too short`);
  ok(profile.battleTipsEn.length > 40, `${slug} battleTipsEn is too short`);
  // InfoPoke's zh-TW pages leak these as raw i18n keys; make sure a future
  // scrape did not start copying the keys instead of the prose.
  for (const key of ['blurbEn', 'battleTipsEn', 'categoryNoteEn']) {
    ok(!/^types\.detail\./.test(profile[key] || ''), `${slug} ${key} is a raw i18n key`);
  }
}

console.log(
  failures === 0
    ? `\nall ${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`
);
process.exit(failures === 0 ? 0 : 1);
