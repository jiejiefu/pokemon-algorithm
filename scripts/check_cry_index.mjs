/**
 * Cry roster — regression test.
 *
 *   node scripts/check_cry_index.mjs
 *
 * The failure this guards against is a silent one. `hasCry()` promises that a
 * file exists at `cryUrl(id)`; if the roster and the directory drift apart, a
 * stale entry 404s on the one button the site has for audio and a missing one
 * leaves `detail.html` to report 「叫聲不可用」 for a species that simply has no
 * audio. Neither throws, so both are asserted here.
 *
 * The unusual thing about this roster, and the reason the file check sniffs
 * container magic instead of trusting the extension: 93 of the files in
 * `latest/` are not Ogg at all. 92 are MPEG Layer III and one is PCM WAV, every
 * one of them named `.ogg`, three of them ordinary species (25, 808, 809).
 * That is deliberate — upstream ships it that way, browsers sniff rather than
 * trust the MIME type, and the files were measured to fetch, decode and play in
 * Chrome over HTTP. So a checker that asserted "starts with OggS" would be
 * red on a correct tree and get muted, and a checker that trusted the extension
 * would be green on a truncated download. This one accepts exactly the three
 * measured containers and rejects everything else, which is the same rule the
 * audio actually plays by.
 *
 * `legacy/` is asserted to be a real second recording set and not a copy: all
 * 649 legacy files are byte-different from their `latest` counterpart. If
 * someone repopulates `legacy/` by copying `latest/`, the "compare the Gen I
 * recording to the modern one" page becomes a lie that still passes a
 * coverage-only test.
 *
 * The third thing guarded is the reason this roster exists at all. `detail.html`
 * used to fetch cries from raw.githubusercontent.com, and a local roster is only
 * worth anything if nothing still reaches the network — so every frontend file
 * is asserted free of the remote host, and asserted to build its URL from
 * `cryUrl()` rather than from a hand-written path prefix.
 *
 * Run: node scripts/check_cry_index.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CRY_IDS, LEGACY_CRY_IDS, CRY_SOURCE, CRY_PATH_PREFIX, LEGACY_CRY_PATH_PREFIX,
  hasCry, hasLegacyCry, cryUrl,
} from '../assets/js/cry-index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
const fails = [];
const eq = (got, want, what) => {
  checks++;
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fails.push(`${what}\n      got:  ${a}\n      want: ${b}`);
};
const ok = (cond, what) => eq(!!cond, true, what);

const pokemon = JSON.parse(readFileSync(join(root, 'assets/data/pokemon_data.json'), 'utf8'));
const knownIds = pokemon.map((p) => p.id).sort((a, b) => a - b);

/** Identify an audio container from its leading bytes.
 *
 * `KNOWN_CONTAINERS` is the measured set, not "whatever plays" — a file that
 * sniffs as none of these is a bad download or an error body wearing an .ogg
 * name, and that is exactly what this has to catch.
 */
const KNOWN_CONTAINERS = new Set(['OGG', 'MP3', 'WAV']);
function sniffContainer(buf) {
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return 'OGG';
  // ID3v2 tag, or a bare MPEG audio frame sync (11 set bits).
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'MP3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'MP3';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'WAV';
  return 'UNKNOWN';
}

/* 1. Roster == species. Any drift means the button either 404s or is hidden for
   a species that does have audio. */
eq([...CRY_IDS].sort((a, b) => a - b), knownIds,
  'latest roster covers exactly the species in pokemon_data.json');

/* 2. legacy is a proper subset, not a copy and not an accident of ordering.
   Asserted as three separate facts because any one of them could hold alone
   while the set is wrong: membership (every legacy id is addressable), size (it
   is strictly smaller), and ceiling (it stops where the Gen 1-5 recordings do). */
ok(LEGACY_CRY_IDS.size > 0, 'legacy roster is not empty');
ok(LEGACY_CRY_IDS.size < CRY_IDS.size,
  `legacy roster is a strict subset of latest (${LEGACY_CRY_IDS.size} < ${CRY_IDS.size})`);
eq([...LEGACY_CRY_IDS].filter((id) => !CRY_IDS.has(id)), [],
  'legacy ids absent from the latest roster');
eq([...LEGACY_CRY_IDS].sort((a, b) => a - b), [...LEGACY_CRY_IDS].sort((a, b) => a - b)
  .filter((id) => id <= 649),
  'legacy roster stops at 649, the last id with a Gen 1-5 recording');

/* 3. The two helpers agree with the two sets, including the string and float
   forms of an id — a page that reads an id off a URL gets a string. */
for (const id of [1, 25, 649, 650, 1025, 9999]) {
  ok(hasCry(id) === CRY_IDS.has(id), `hasCry(${id}) agrees with the roster`);
  ok(hasLegacyCry(id) === LEGACY_CRY_IDS.has(id), `hasLegacyCry(${id}) agrees with the roster`);
}
ok(hasCry('25') === hasCry(25), 'hasCry coerces a string id');
ok(hasLegacyCry('649') === hasLegacyCry(649), 'hasLegacyCry coerces a string id');

/* 4. Every promised file exists and is a real audio container. Extension is
   ignored on purpose — see the file docblock. */
const MIN_BYTES = 1024;
const missing = [];
const unrecognised = [];
const tooSmall = [];
const containers = {};
/** Container kind per id, kept so check 5 can reuse it. Re-reading the files
 *  there instead would have meant a second unguarded `readFileSync`, which turns
 *  "a roster file is missing" from a named failure into a stack trace — the
 *  exact shape the delete case below used to crash on. */
const latestKind = new Map();
for (const [set, prefix, label] of [
  [CRY_IDS, CRY_PATH_PREFIX, 'latest'],
  [LEGACY_CRY_IDS, LEGACY_CRY_PATH_PREFIX, 'legacy'],
]) {
  for (const id of set) {
    const path = join(root, prefix + `${id}.ogg`);
    if (!existsSync(path) || !statSync(path).isFile()) { missing.push(`${label}/${id}`); continue; }
    const buf = readFileSync(path);
    const kind = sniffContainer(buf);
    containers[kind] = (containers[kind] || 0) + 1;
    if (label === 'latest') latestKind.set(id, kind);
    if (!KNOWN_CONTAINERS.has(kind)) unrecognised.push(`${label}/${id} (${kind})`);
    else if (buf.length < MIN_BYTES) tooSmall.push(`${label}/${id} (${buf.length}B)`);
  }
}
eq(missing, [], 'ids in a roster with no file behind them');
eq(unrecognised, [], 'files under a roster that are not a known audio container');
eq(tooSmall, [], 'files under a roster below the minimum audio size');
for (const prefix of [CRY_PATH_PREFIX, LEGACY_CRY_PATH_PREFIX]) {
  ok(existsSync(join(root, prefix)) && statSync(join(root, prefix)).isDirectory(),
    `${prefix} is a directory`);
}

/* 5. The mislabeling the generated docblock talks about is still true of the
   files, so the note in the file the frontend loads cannot rot into a claim.
   The three roster species it names are asserted by id — a count alone would
   pass on the wrong three. */
eq([...CRY_IDS]
  .filter((id) => latestKind.get(id) !== undefined && latestKind.get(id) !== 'OGG')
  .sort((a, b) => a - b), [25, 808, 809],
  'the roster species that are not Ogg are still exactly 25, 808, 809');
ok(/92 are\s*\n?\s*MPEG Layer III/.test(readFileSync(join(root, 'assets/js/cry-index.js'), 'utf8'))
  || /MPEG Layer III/.test(readFileSync(join(root, 'assets/js/cry-index.js'), 'utf8')),
  'generated module still documents the mislabelled MP3s');

/* 6. legacy is a different recording, not a copy. Reading both sets in full is
   ~20 MB and takes well under a second; a sampled check would let a copy of
   648 files hide behind one untouched pair. */
const identical = [...LEGACY_CRY_IDS].filter((id) => {
  try {
    return readFileSync(join(root, cryUrl(id, { legacy: true })))
      .equals(readFileSync(join(root, cryUrl(id))));
  } catch { return false; }
});
eq(identical, [], 'legacy files that are byte-identical copies of their latest counterpart');

/* 7. Provenance. The generated module names where the audio is refreshed from;
   two halves of one fact, so the generator's constant is asserted to match it. */
const generator = readFileSync(join(root, 'scripts/extract_cry_index.py'), 'utf8');
const genSource = generator.match(/^SOURCE = "(.+)"$/m);
ok(!!genSource, 'generator declares a SOURCE');
eq(genSource ? genSource[1] : '', CRY_SOURCE, 'generator SOURCE matches the generated CRY_SOURCE');
ok(CRY_SOURCE.includes('PokeAPI/cries'),
  'the exported source is the PokeAPI/cries repository, the one the site credits');

/* 8. Local roster, local audio. The whole reason cry-index.js exists is that
   detail.html stopped reaching the network, so every frontend file is asserted
   free of the remote host — including the ones nobody is thinking about.
   `raw.githubusercontent.com` is matched rather than `PokeAPI/cries`, because
   the generated module legitimately carries the repository URL as provenance. */
const frontend = [
  ...readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => f),
  ...readdirSync(join(root, 'assets/js')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`),
  ...readdirSync(join(root, 'assets/css')).filter((f) => f.endsWith('.css')).map((f) => `assets/css/${f}`),
];
/* The two scans above are the easiest thing in this file to get silently wrong:
   a renamed directory, or a moved frontend file, leaves the list empty and every
   assertion below green over nothing. Asserting the tree that was scanned is the
   fix, and it is asserted *before* the results so a missing directory is a named
   failure rather than a stack trace. */
ok(frontend.length >= 3, `the frontend scan found files to check (found ${frontend.length})`);
ok(frontend.includes('detail.html'), 'the frontend scan reached detail.html');
const remote = frontend.filter((f) =>
  /raw\.githubusercontent\.com\/PokeAPI\/cries/.test(readFileSync(join(root, f), 'utf8')));
eq(remote, [], 'frontend files still pointing at the remote cry host');

/* 9. And no page may hand-assemble the path: the prefix exists in one generated
   module, and a literal `assets/cries/` outside it is a URL that will drift. */
const handBuilt = frontend.filter((f) => f !== 'assets/js/cry-index.js'
  && /assets\/cries\/(latest|legacy)\//.test(readFileSync(join(root, f), 'utf8')));
eq(handBuilt, [], 'frontend files that hand-build a cry path instead of using cryUrl()');

/* 10. Page wiring. A correct roster that no page consults still fetches nothing,
   so the consumer is asserted too. */
const detail = readFileSync(join(root, 'detail.html'), 'utf8');
ok(/import\s*\{[^}]*\bhasCry\b[^}]*\}\s*from\s*['"][^'"]*cry-index\.js['"]/.test(detail),
  'detail.html imports hasCry from the generated module');
ok(/import\s*\{[^}]*\bcryPlayer\b[^}]*\}\s*from\s*['"][^'"]*cry-player\.js['"]/.test(detail),
  'detail.html imports the shared player');
ok(/cryPlayer\.play\(\s*currentPokemon\.id\s*\)/.test(detail),
  'detail.html plays the cry of the Pokémon it is showing');
ok(/hasCry\(\s*currentPokemon\.id\s*\)/.test(detail),
  'detail.html gates the cry button on the roster');

/* The one thing this migration was for: a single `.catch()` used to turn a 404, a
   dropped connection and a blocked autoplay into the same four characters, so a
   reader could not tell a fact about the species from a fact about their browser.
   Asserted against the mapper that owns the distinction rather than the catch
   that calls it, because the mapper is the unit with the contract: it switches on
   `reason`, it returns a different string per reason, and the catch routes the
   error's `reason` into it. A catch that passed something else, or a mapper that
   ignored its argument, fails all three. */
const mapper = detail.match(/function cryFailureMessage\(\s*reason\s*\)\s*\{([\s\S]*?)\n {4}\}/);
ok(!!mapper, 'detail.html has a cryFailureMessage(reason) mapper');
const mapperBody = mapper ? mapper[1] : '';
const reasons = [...mapperBody.matchAll(/reason\s*={2,3}\s*'([^']+)'/g)].map((m) => m[1]);
ok(reasons.length >= 2,
  `cryFailureMessage distinguishes at least two causes (found ${reasons.length}: ${reasons.join(', ')})`);
ok(reasons.includes('missing'), 'cryFailureMessage has a message for a species with no cry');
ok(reasons.some((r) => r.includes('decode') || r.includes('web-audio')),
  'cryFailureMessage has a message for a browser that cannot decode the audio');
/* Two reasons sharing one message is correct — "no Web Audio" and "this browser
   cannot decode Ogg Vorbis" are the same fact to a reader. Two *branches* sharing
   one message is the regression this migration fixed, so the count asserted is
   branches + fallback, not reasons + fallback. The lower bound is in the same
   assertion rather than the two above because a mapper reduced to one
   unconditional `return` satisfies `size === 0 + 1` and would otherwise pass
   this while failing only the weaker, separately-named checks. */
const branches = (mapperBody.match(/if\s*\(\s*reason\s*===/g) || []).length;
const messages = new Set([...mapperBody.matchAll(/return\s+'([^']+)'/g)].map((m) => m[1]));
ok(branches >= 2 && messages.size === branches + 1,
  `every cause gets its own branch and message (${branches} branches, ${messages.size} messages)`);
ok(/cryFailureMessage\(\s*error\s*&&\s*error\.reason\s*\)/.test(detail),
  "the catch routes the player's reason into the mapper");
ok(!/new Audio\(/.test(detail),
  'detail.html no longer builds an Audio element from a raw URL');

/* The button has to be re-synced on navigation, or the state of the species just
   left behind survives onto the next one — the same reason resetShiny() is
   called there rather than in the shiny toggle's own handler. Scoped to
   renderDetail's body on purpose: the toggle branch also calls stop(), so a
   whole-file search for the call is satisfied by code that has nothing to do
   with navigation. */
const renderBody = detail.match(/function renderDetail\(\)\s*\{([\s\S]*?)\n {4}\}/);
ok(!!renderBody && /cryPlayer\.stop\(\)/.test(renderBody[1]),
  'detail.html stops playback when it navigates');

console.log(`  species: ${knownIds.length}`);
console.log(`  latest cries: ${CRY_IDS.size}`);
console.log(`  legacy cries: ${LEGACY_CRY_IDS.size} (strict subset)`);
console.log(`  containers on disk: ${Object.entries(containers)
  .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`);

if (fails.length) {
  console.log(`\nFAIL  ${fails.length} of ${checks} checks failed\n`);
  fails.forEach((f) => console.log(`  FAIL  ${f}`));
  process.exit(1);
}
console.log(`\nPASS  ${checks} checks`);
