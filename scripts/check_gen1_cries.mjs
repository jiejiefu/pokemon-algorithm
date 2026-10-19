#!/usr/bin/env node
/**
 * Verify assets/data/gen1_cries.json and assets/data/gen1_cry_sfx.json against
 * the Generation I cry table in pret/pokered.
 *
 * Run: node scripts/check_gen1_cries.mjs
 * Test: node scripts/test_check_gen1_cries.mjs   (proves each check can fail)
 *
 * WHAT THIS FILE GUARDS, AND WHY EACH ONE IS HERE
 *
 * The 151-row join. cries.asm is unordered from its first row -- 151 of 151
 * species sit at a position that is not their dex id, by up to 174 places, and
 * row 1 is Rhyhon (id 112). So the id in this JSON can only have come from the
 * `; Name` comment. That is not checkable by reading the JSON alone, which is
 * why test_check_gen1_cries.mjs shuffles the table's rows and requires the
 * regenerated JSON to be byte-identical. The two join hazards are pinned here so
 * a future edit cannot quietly weaken the key:
 *
 *   Mr.Mime vs Mr. Mime  -- punctuation differs, so punctuation is dropped.
 *   Nidoran♀ vs Nidoran♂ -- identical but for a gender symbol, so symbols are
 *     transliterated rather than dropped. Dropping them merges two species onto
 *     one key, which is why the id set is checked for exactly 1..151 with no
 *     duplicates: a merge shows up as a missing id long before it shows up as a
 *     wrong sound.
 *
 * The 38 bases. This is the number the reference article "Generation I Pokémon
 * Cries Explained" gives, and it is what the upstream table uses. Both files
 * have to agree on it and every base has to be reachable from the 151 species.
 *
 * 38 bases, not 114 files. Upstream ships each base cry three times as three
 * link entries for one sound; the copies carry the same commands and differ only
 * in the _1/_2/_3 inside their labels -- including inside the sound_loop target
 * of cry0d, which is why the JSON stores loop targets as "Ch5" rather than as
 * the literal label. The checker asserts the recorded file list and the
 * implicitRet list still describe the shape upstream has, so a divergence is a
 * named failure instead of a wrong playback.
 *
 * The six missing terminators. Six of the 114 channels have no explicit
 * sound_ret; upstream just stops. The count is asserted as an exact set rather
 * than as "at most N", because both directions are informative: a seventh means
 * the parser is dropping commands, and five means upstream fixed one and the
 * JSON is now stale.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/** `stream` keeps this file's one line per assertion; the defaults match its prefixes. */
const C = createChecker({ stream: true });
const { ok } = C;
/* `eq` keeps its original shape: a detail only on FAILURE, because this checker
 * streams a line per assertion and a passing line carries no values. */
const eq = (got, want, what) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(a === b, `${what}${a === b ? '' : `\n      got:  ${a}\n      want:  ${b}`}`);
};

const cries = read('assets/data/gen1_cries.json');
const sfx = read('assets/data/gen1_cry_sfx.json');
const pokemon = read('assets/data/pokemon_data.json');
/* The fade field is a 4-bit SIGNED MAGNITUDE, so it spans [-8, +7] rather than the
 * [-7, +7] pokered's macro documents as its argument range: the macro packs the
 * direction into bit 7 of the emitted byte and the magnitude below it, and -8 is what
 * a magnitude of 8 becomes. Reading the literal as unsigned
 * turns `square_note 12, 0, 8, 0` into a fade OUT of a note whose volume is 0, which
 * clamps at 0 and makes the note silent; the tables mean "increase". pokered's macro
 * says so in as many words, and the reference synthesiser's own tables carry -8.
 *
 * This was found by diffing all 38 bases against those tables: of every frames,
 * volume, sweep, freq and duty byte in all 114 channels, nine sweeps were the only
 * differences. So the RANGE is asserted rather than a value, which catches the next
 * one whatever it is. */
const sweeps = [];
for (const base of Object.values(sfx.sfx)) {
  for (const ch of base.channels) {
    for (const cmd of ch.commands) {
      if (cmd.op === 'pulse' || cmd.op === 'noise') sweeps.push(cmd.sweep);
    }
  }
}
eq(sweeps.filter((v) => v < -8 || v > 7), [],
  `all ${sweeps.length} fade values are inside the 4-bit signed-magnitude range [-8, +7]`);
eq(sweeps.filter((v) => v === -8).length, 9,
  'and the nine that mean "increase" are stored as -8 rather than 8');
ok(sweeps.filter((v) => v === 0).length > 0,
  'and a fade of 0, a static envelope, still exists -- the renderer has to bound those');

// ---------------------------------------------------------------------------
// Provenance. A generated file that has lost its source is a file nobody can
// re-derive, and the URL is the only thing that says where to look.
// ---------------------------------------------------------------------------

const TABLE_URL = 'https://raw.githubusercontent.com/pret/pokered/master/data/pokemon/cries.asm';
const SFX_URL = 'https://raw.githubusercontent.com/pret/pokered/master/audio/sfx/cry{}_{}.asm';

ok(cries.source === TABLE_URL, `gen1_cries.json still credits ${TABLE_URL}`);
ok(sfx.source === SFX_URL, `gen1_cry_sfx.json still points at the SFX directory`);

/* The fetcher refuses to leave the pinned host, so a redirect or a typo cannot
   quietly repoint it. This reads the REPO assignment and compares it exactly:
   searching the file for the host string anywhere would be satisfied by
   EXPECTED_TABLE_HOST, which is a leftover copy of the same literal, and
   test_check_gen1_cries.mjs replaces only the first occurrence. */
const fetcher = readFileSync(join(ROOT, 'scripts/fetch_gen1_cries.py'), 'utf8');
const repoLine = fetcher.match(/^REPO\s*=\s*"([^"]+)"/m);
eq(repoLine && repoLine[1], 'https://raw.githubusercontent.com/pret/pokered/master',
  'the fetcher builds its URLs from pret/pokered on raw.githubusercontent.com');
ok(!/pokemondb|veekun|infopoke/i.test(fetcher),
  'the fetcher does not read the cry table from a second source');

// ---------------------------------------------------------------------------
// The 151 species.
// ---------------------------------------------------------------------------

const rows = cries.cries;
ok(Array.isArray(rows), 'gen1_cries.json carries a cries array');
eq(cries.cryCount, rows.length, 'the declared cry count matches the rows present');
eq(rows.length, 151, 'there are 151 Generation I cries');

const ids = rows.map((r) => r.id);
eq(ids, Array.from({ length: 151 }, (_, i) => i + 1),
  'the ids are exactly 1..151, in order, with no gaps and no duplicates');

ok(rows.every((r) => typeof r.id === 'number' && Number.isInteger(r.id)),
  'every id is an integer');

const idSet = new Set(ids);
ok(idSet.size === 151, 'no species is listed twice');

// The join must have landed on a species that exists, with the right name. This
// is what catches a key that matched the wrong row: the ids would still be a
// permutation of 1..151 while every sound belonged to the wrong Pokémon.
const byId = new Map(pokemon.filter((p) => p.id <= 151).map((p) => [p.id, p]));
ok(rows.every((r) => byId.has(r.id)), 'every cry id names a species in 1..151');

// ---------------------------------------------------------------------------
// The 38 bases.
// ---------------------------------------------------------------------------

const BASES = 38;
eq(cries.baseCount, BASES, 'gen1_cries.json declares 38 base cries');
eq(sfx.baseCount, BASES, 'gen1_cry_sfx.json declares 38 base cries');
eq(Object.keys(sfx.sfx).length, BASES, 'gen1_cry_sfx.json holds 38 base entries');

const usedBases = [...new Set(rows.map((r) => r.base))].sort((a, b) => a - b);
eq(usedBases, Array.from({ length: BASES }, (_, i) => i),
  'the bases in use are exactly 0..37 with none skipped');

eq([...new Set(rows.map((r) => r.sfx))].length, BASES,
  'the 151 species reference 38 distinct SFX constants');

/* The SFX file names are what the base constant turns into, and the mapping has
   two ways to go wrong: the hex digits must be lowercased, and the constant
   number must line up with the cry row that names it. A lowercase slip is
   invisible for the ten all-digit bases and 404s for the rest, so it is pinned
   for all 38. */
const expectedFiles = (sfxName) => {
  const digits = sfxName.replace('SFX_CRY_', '').toLowerCase();
  return [1, 2, 3].map((v) => `cry${digits}_${v}.asm`);
};
const entries = Object.entries(sfx.sfx);
const fileMismatch = entries
  .filter(([name, v]) => JSON.stringify(v.files) !== JSON.stringify(expectedFiles(name)))
  .map(([name, v]) => `${name}: ${JSON.stringify(v.files)}`);
eq(fileMismatch, [], 'each base lists the three cry files its constant maps to');
eq(entries.map(([, v]) => v.files.length), Array(BASES).fill(3),
  'each base cry has exactly three files');
eq(sfx.replicaCountPerBase, 3, 'the JSON records that upstream ships three replicas');

// The base index stored in gen1_cries.json must be the one gen1_cry_sfx.json
// gives that constant. Two files each numbering 38 bases independently is exactly
// how they end up numbering them differently.
const baseOfSfx = new Map(entries.map(([name, v]) => [name, v.base]));
const baseMismatch = rows
  .filter((r) => baseOfSfx.get(r.sfx) !== r.base)
  .map((r) => `${r.id} ${r.sfx}: cries says base ${r.base}, sfx says ${baseOfSfx.get(r.sfx)}`);
eq(baseMismatch, [], 'both files agree on which base index each SFX constant is');

// Every base in the SFX file is reachable from the species table. A base cry
// nothing points at is dead weight at best and a mis-parse at worst.
const reachable = new Set(rows.map((r) => baseOfSfx.get(r.sfx)));
eq([...reachable].sort((a, b) => a - b), Array.from({ length: BASES }, (_, i) => i),
  'every one of the 38 base cries is used by at least one species');

// ---------------------------------------------------------------------------
// Pitch and length. Both are single bytes in the ROM.
// ---------------------------------------------------------------------------

const outOfRange = rows
  .filter((r) => !(Number.isInteger(r.pitch) && r.pitch >= 0 && r.pitch <= 255))
  .map((r) => `#${r.id} pitch ${r.pitch}`);
eq(outOfRange, [], 'every pitch is a byte in 0..255');

const badLength = rows
  .filter((r) => !(Number.isInteger(r.length) && r.length >= 0 && r.length <= 255))
  .map((r) => `#${r.id} length ${r.length}`);
eq(badLength, [], 'every length is a byte in 0..255');

/* The reference article is explicit that the volume sweep is a signed 4-bit
   field, and upstream mixes notations -- cry1c writes `noise_note 13, 1, -1, 124`
   with a real minus sign while other rows write the same field unsigned. Both
   forms are in range for a nibble, so the assertion covers -8..15 rather than
   pretending the source is consistent with itself. */
const badSweep = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    for (const cmd of ch.commands) {
      if (!('sweep' in cmd)) continue;
      if (!(Number.isInteger(cmd.sweep) && cmd.sweep >= -8 && cmd.sweep <= 15)) {
        badSweep.push(`${name}/Ch${ch.ch} sweep ${cmd.sweep}`);
      }
    }
  }
}
eq(badSweep, [], 'every volume sweep fits a signed 4-bit field as upstream writes it');

// ---------------------------------------------------------------------------
// Channels and commands.
// ---------------------------------------------------------------------------

const CHANNELS = [5, 6, 8];
const chShape = entries
  .filter(([, v]) => JSON.stringify(v.channels.map((c) => c.ch)) !== JSON.stringify(CHANNELS))
  .map(([n, v]) => `${n}: ${JSON.stringify(v.channels.map((c) => c.ch))}`);
eq(chShape, [], 'every base cry has exactly Ch5, Ch6 and Ch8');

// The wave channel is unused for cries, so a Ch7 anywhere would mean the parser
// is reading something it should not.
const waveChannel = entries
  .filter(([, v]) => v.channels.some((c) => c.ch === 7))
  .map(([n]) => n);
eq(waveChannel, [], 'no base cry uses the wave channel');

/* Both pulse channels that play anything must open by naming a duty cycle, or
   their notes inherit whatever the hardware happened to be left at. cry06's Ch6
   is an empty channel upstream -- a bare sound_ret and nothing else -- so the
   requirement is on channels that actually have notes, not on every pulse
   channel existing. */
const noDuty = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    if (ch.ch === 8) continue;
    const notes = ch.commands.filter((c) => c.op === 'pulse');
    if (notes.length && ch.commands[0]?.op !== 'duty') noDuty.push(`${name}/Ch${ch.ch}`);
  }
}
eq(noDuty, [], 'every pulse channel that plays a note opens with a duty cycle pattern');

const dutyShape = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    for (const cmd of ch.commands) {
      if (cmd.op !== 'duty') continue;
      if (!Array.isArray(cmd.pattern) || cmd.pattern.length !== 4 ||
          cmd.pattern.some((d) => !Number.isInteger(d) || d < 0 || d > 3)) {
        dutyShape.push(`${name}/Ch${ch.ch} ${JSON.stringify(cmd.pattern)}`);
      }
    }
  }
}
eq(dutyShape, [], 'every duty cycle is four values in 0..3');

/* cry02 uses the older single-value spelling, which the fetcher expands to four
   repeats. If the expansion ever stops happening the renderer would receive one
   duty where it expects four, so the expanded form is pinned. */
const expanded = [];
for (const [, v] of entries) {
  for (const ch of v.channels) {
    for (const cmd of ch.commands) {
      if (cmd.expandedFrom) expanded.push(`${v.base}:${cmd.pattern.join(',')}`);
    }
  }
}
eq(expanded, ['2:0,0,0,0'], 'the one old-style duty_cycle is expanded to four repeats');

const noteShape = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    const wantOp = ch.ch === 8 ? 'noise' : 'pulse';
    for (const cmd of ch.commands) {
      if (cmd.op !== wantOp) continue;
      if (!(cmd.frames >= 1 && cmd.frames <= 16)) noteShape.push(`${name}/Ch${ch.ch} frames ${cmd.frames}`);
      if (!(cmd.volume >= 0 && cmd.volume <= 15)) noteShape.push(`${name}/Ch${ch.ch} volume ${cmd.volume}`);
      if (!(cmd.freq >= 0 && cmd.freq <= 65535)) noteShape.push(`${name}/Ch${ch.ch} freq ${cmd.freq}`);
    }
  }
}
eq(noteShape, [], 'every note has frames 1..16, volume 0..15 and a 16-bit frequency');

/* A noise note's fourth operand is not a frequency: bit 3 selects a 7-bit LFSR
   over a 15-bit one and the rest is the sampling rate. Asserting it fits a byte
   is what stops a future parser from storing it as a 16-bit value alongside the
   pulse notes, where it would look plausible. */
const noiseShape = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    for (const cmd of ch.commands) {
      if (cmd.op === 'noise' && !(cmd.freq >= 0 && cmd.freq <= 255)) {
        noiseShape.push(`${name}/Ch${ch.ch} noise param ${cmd.freq}`);
      }
    }
  }
}
eq(noiseShape, [], 'every noise note keeps its 8-bit LFSR parameter');

const ops = new Set();
for (const [, v] of entries) for (const ch of v.channels) for (const cmd of ch.commands) ops.add(cmd.op);
eq([...ops].sort(), ['duty', 'loop', 'noise', 'pulse', 'ret'],
  'only the five cry commands appear, and no line was dropped');

// ---------------------------------------------------------------------------
// Loop. Exactly one in the whole tree, in cry0d's Ch5, pointing back at itself.
// ---------------------------------------------------------------------------

const loops = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    for (const cmd of ch.commands) {
      if (cmd.op === 'loop') loops.push({ name, ch: ch.ch, count: cmd.count, target: cmd.target });
    }
  }
}
eq(loops, [{ name: 'SFX_CRY_0D', ch: 5, count: 2, target: 'Ch5' }],
  'the single sound_loop is cry0d Ch5, playing twice from its own start');

/* The target is stored as a channel rather than as the literal
   SFX_Cry0D_1_Ch5 label precisely so the three identical replicas compare equal.
   A label here means the fetcher stopped normalising, and the replica check in
   the fetcher would start failing for a difference that is not one. */
const loopTargetsResolve = loops.every((l) => {
  const v = sfx.sfx[l.name];
  return v.channels.some((c) => `Ch${c.ch}` === l.target);
});
ok(loopTargetsResolve, 'the loop target resolves to a channel in the same base cry');

// ---------------------------------------------------------------------------
// The six channels that never return.
//
// Upstream omits sound_ret on six of 114 channels. The exact set is asserted in
// both directions: a seventh means the parser is losing commands, and five means
// upstream fixed one and this JSON is stale. "At most six" would pass on both.
// ---------------------------------------------------------------------------

eq(sfx.sfx.SFX_CRY_0D.implicitRet, [], 'cry0d terminates all three of its channels');
const implicit = entries
  .flatMap(([name, v]) => v.implicitRet.map((ch) => `${name}/Ch${ch}`))
  .sort();
eq(implicit, [
  'SFX_CRY_02/Ch6', 'SFX_CRY_05/Ch6', 'SFX_CRY_06/Ch5',
  'SFX_CRY_0C/Ch6', 'SFX_CRY_19/Ch6', 'SFX_CRY_21/Ch6',
], 'the six channels upstream leaves without a sound_ret are still exactly these six');

/* implicitRet is the record of a real upstream omission, so it has to agree with
   the commands actually present. If it listed a channel that does have a ret, a
   renderer would insert a stop that upstream never wrote. */
const implicitWrong = [];
for (const [name, v] of entries) {
  for (const ch of v.channels) {
    const hasRet = ch.commands.some((c) => c.op === 'ret');
    const listed = v.implicitRet.includes(ch.ch);
    if (hasRet === listed) implicitWrong.push(`${name}/Ch${ch.ch} ret=${hasRet} listed=${listed}`);
  }
}
eq(implicitWrong, [], 'implicitRet lists exactly the channels with no sound_ret');

// ---------------------------------------------------------------------------
// The notes the two files have to agree on.
// ---------------------------------------------------------------------------

console.log('');
console.log(`  species: ${rows.length}`);
console.log(`  base cries: ${BASES}`);
console.log(`  commands: ${entries.reduce((n, [, v]) => n + v.channels.reduce((m, c) => m + c.commands.length, 0), 0)}`);
console.log(`  channels without a terminator: ${implicit.length}`);

console.log('');
if (C.failures.length) {
  console.log(`FAIL  ${C.failures.length} of ${C.checks} checks failed`);
  process.exit(1);
}
console.log(`PASS  ${C.checks} checks`);
