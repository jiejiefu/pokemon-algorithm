/**
 * Scarlet/Violet artwork index — regression test.
 *
 * The failure this guards against is a chip that renders fine and is wrong.
 * `hasSv()` is a promise that a file exists at `svUrl(id)`; if the roster and
 * the directory drift apart, a stale entry paints a broken image and a missing
 * one silently drops a Pokémon back to the 96px sprite with nothing to say so.
 * Neither shows up as an exception, so both are asserted here.
 *
 * The second thing guarded is provenance drift. The artwork comes from two
 * upstreams — PokeAPI carries 733 of the species and a second source covers the
 * rest, serving byte-different but visually identical files — and the site
 * attributes its art to PokeAPI. That makes it easy to write something that is
 * true of the directory and false of any individual file, e.g. a header claiming
 * every PNG came from one host, or a fetcher quietly reordered so the fallback
 * shadows the primary. So the map is asserted to cover exactly the roster, the
 * primary URL is asserted byte-identical across the fetcher and the generated
 * module, and the fallback name is asserted absent from the file the frontend
 * loads.
 *
 * Run: node scripts/check_sv_index.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SV_IDS, SV_SOURCE, SV_PATH_PREFIX, hasSv, svUrl } from '../assets/js/sv-index.js';

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
const knownIds = pokemon.map((p) => p.id);
const svDir = join(root, SV_PATH_PREFIX);

/* 1. Roster == species == provenance keys. Any drift here means a chip will
   either 404 or silently fall back, so the three are asserted to be one set. */
const provenancePath = join(root, 'data-sources/sv-sources.json');
ok(existsSync(provenancePath), 'data-sources/sv-sources.json exists');
const provenance = existsSync(provenancePath)
  ? JSON.parse(readFileSync(provenancePath, 'utf8'))
  : { sources: {}, artwork: {} };
const provIds = Object.keys(provenance.artwork || {}).map(Number).sort((a, b) => a - b);

eq([...SV_IDS].sort((a, b) => a - b), [...knownIds].sort((a, b) => a - b),
  'roster covers exactly the species in pokemon_data.json');
eq(provIds, [...knownIds].sort((a, b) => a - b),
  'provenance map covers exactly the species in pokemon_data.json');

/* 2. Every promised file exists at the promised URL, and is a real PNG.
   A host that answers a miss with a non-404 body produces a file that passes a
   filename check and fails in the browser. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_BYTES = 1024;
const notPng = [];
const tooSmall = [];
const missingOnDisk = [];
for (const id of knownIds) {
  if (!hasSv(id)) { missingOnDisk.push(id); continue; }
  const path = join(root, svUrl(id));
  if (!existsSync(path)) { missingOnDisk.push(id); continue; }
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) notPng.push(id);
  else if (buf.length < MIN_BYTES) tooSmall.push(`${id} (${buf.length}B)`);
}
eq(missingOnDisk, [], 'ids in the roster with no file behind them');
eq(notPng, [], 'files under the roster that are not PNGs');
eq(tooSmall, [], 'files under the roster below the minimum artwork size');
ok(existsSync(svDir) && statSync(svDir).isDirectory(), `${SV_PATH_PREFIX} is a directory`);

/* 3. Provenance values are real source names, and that name is one the fetcher
   actually knows -- otherwise the map can record a source nothing will ever
   use, which claims a provenance the fetcher cannot honour. */
const fetcher = readFileSync(join(root, 'scripts/fetch_sv_sprites.py'), 'utf8');
const declaredSources = Object.keys(provenance.sources || {});
const unknownSource = Object.entries(provenance.artwork || {})
  .filter(([, src]) => !declaredSources.includes(src))
  .map(([id, src]) => `${id} -> ${src}`);
eq(unknownSource, [], 'provenance entries naming a source the map does not declare');
ok(declaredSources.length >= 2, 'at least two sources are declared');
for (const name of declaredSources) {
  ok(fetcher.includes(`"${name}"`), `fetcher knows the "${name}" source`);
}

/* 4. The primary URL is byte-identical in the fetcher and the generated module.
   Two halves of one fact; a fetcher that points elsewhere is how a directory
   loses its provenance without anyone noticing. */
const primaryBlock = fetcher.match(/"pokeapi":\s*\(([\s\S]*?)\)/);
ok(!!primaryBlock, 'fetcher declares a pokeapi source');
const fetcherPrimary = primaryBlock
  ? [...primaryBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).join('')
  : '';
eq(fetcherPrimary, SV_SOURCE, 'fetcher primary URL matches the generated SV_SOURCE');
ok(SV_SOURCE.includes('PokeAPI'), 'the exported source is PokeAPI, the one the site credits');

/* 5. Order matters: PokeAPI is the credited source, so the fallback must not be
   consulted first. */
const order = [...fetcher.matchAll(/^\s{4}"(\w+)":/gm)].map((m) => m[1]);
eq(order.slice(0, 2), ['pokeapi', 'infopoke'], 'fetcher consults PokeAPI before the fallback');

/* 6. The fallback must not be published. The map lives outside assets/ and the
   generated module names only the primary, so nothing the frontend loads or
   fetches reveals it. */
const moduleText = readFileSync(join(root, 'assets/js/sv-index.js'), 'utf8');
ok(!/infopoke/i.test(moduleText), 'generated module does not name the fallback source');
ok(!SV_PATH_PREFIX.startsWith('assets/data-sources') && !/data-sources/.test(SV_PATH_PREFIX),
  'artwork path does not expose the provenance directory');
ok(!existsSync(join(root, 'assets/data-sources')),
  'no provenance copy under assets/ that would ship to the frontend');

/* 7. The fallback the page promises actually covers every species. This is what
   makes the sprite path safe, and it is checked against pokemon_data filenames
   rather than assumed from the count. */
const noSprite = pokemon.filter((p) => !existsSync(join(root, 'assets/images/sprite/', p.filename)));
eq(noSprite.map((p) => p.id), [], 'species with no 96px sprite to fall back to');

/* 8. Page wiring. A correct roster with a page that ignores it still shows
   sprites, so the consumer is asserted too: it must import the helpers, ask
   svUrl for real artwork, keep an onerror net, and hide the stand-in count when
   nothing is standing in. */
const html = readFileSync(join(root, 'types.html'), 'utf8');
ok(/import\s*\{[^}]*\bhasSv\b[^}]*\}\s*from\s*['"][^'"]*sv-index\.js['"]/.test(html),
  'types.html imports hasSv from the generated module');
ok(/import\s*\{[^}]*\bsvUrl\b[^}]*\}\s*from\s*['"][^'"]*sv-index\.js['"]/.test(html),
  'types.html imports svUrl from the generated module');
ok(/svUrl\(p\.id\)/.test(html), 'types.html asks svUrl for the artwork it shows');
ok(/onerror="this\.onerror=null;this\.src=/.test(html),
  'types.html keeps an onerror net that falls back to the sprite');
/* Both halves of "hide at zero" are asserted separately. `subCount ?` appears
   twice in the block — once gating the count suffix, once gating the note — so a
   bare `/subCount\s*\?/` would be satisfied by either and could not tell which
   one broke. */
ok(/subCount\s*\?[^)]*使用替代圖[^)]*:\s*''/.test(html),
  'types.html hides the stand-in count when nothing falls back');
ok(/subCount\s*\?[^)]*圓環/.test(html),
  'types.html gates the ring explanation on there being stand-ins');
ok(/assets\/images\/sprite\/['"]\s*\+\s*p\.filename|ASSETS\.sprites/.test(html),
  'types.html builds the sprite fallback from the dataset filename');
/* The badge has to read over both the chip surface and an unknown-coloured
   sprite, so it is two tones; a one-tone ring fails against half of them. */
const markDark = /--chip-sub-mark:\s*#e8edf5/.test(html);
const markLight = /--chip-sub-mark:\s*#3a4252/.test(html);
ok(markDark && markLight, 'badge mark colour is defined for both themes');
ok(/--chip-sub-halo:/.test(html), 'badge halo colour is defined');

console.log(`  species: ${knownIds.length}`);
console.log(`  artwork on disk: ${[...SV_IDS].length} (${declaredSources.map((s) => {
  const n = Object.values(provenance.artwork).filter((v) => v === s).length;
  return `${n} ${s}`;
}).join(', ')})`);

if (fails.length) {
  console.log(`\nFAIL  ${fails.length} of ${checks} checks failed\n`);
  fails.forEach((f) => console.log(`  FAIL  ${f}`));
  process.exit(1);
}
console.log(`\nPASS  ${checks} checks`);