/**
 * check_pokefarm_audio — every sound file is on disk, listed, and REACHABLE.
 *
 * The user's brief was "use all of the sound effects and all of the music", so
 * that is what this proves rather than hopes:
 *   - every manifest entry has its file (.ogg for SFX, .m4a for music) and vice versa;
 *   - every one of the 328 SFX belongs to a family that the foley tables
 *     (JOB_MOVES, TYPE_MOVES, EVENT_MOVES) name, and every family they name exists;
 *   - every one of the 45 music tracks is named by the director's tables;
 *   - `pickTrack` answers sensibly for each kind of scene;
 *   - the whole set stays small enough to commit (< 70 MB).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pickTrack, familyOf, referencedFamilies, referencedTracks, DAY_TRACKS, HAZARD_TRACKS, SEASON_RESULT, RUN_RESULT, TYPE_MOVES,
} from '../assets/js/pokefarm-audio.js';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'audio');
const problems = [];
let checks = 0;
const ok = (c, m) => { checks++; if (!c) problems.push(m); };

const sfx = JSON.parse(readFileSync(join(BASE, 'sfx/manifest.json'), 'utf8'));
const music = JSON.parse(readFileSync(join(BASE, 'music/manifest.json'), 'utf8'));
const EXT = { sfx: '.ogg', music: '.m4a' };
const onDisk = (d) => readdirSync(join(BASE, d)).filter((f) => f.endsWith(EXT[d])).map((f) => f.slice(0, -4)).sort();

ok(Object.keys(sfx).length === 328, `328 sound effects are listed, got ${Object.keys(sfx).length}`);
ok(Object.keys(music).length === 45, `45 music tracks are listed, got ${Object.keys(music).length}`);
ok(JSON.stringify(onDisk('sfx')) === JSON.stringify(Object.keys(sfx).sort()), 'sfx folder and manifest list the same files');
ok(JSON.stringify(onDisk('music')) === JSON.stringify(Object.keys(music).sort()), 'music folder and manifest list the same files');
ok(!readdirSync(join(BASE, 'music')).some((f) => f.endsWith('.ogg')), 'music folder has no stale .ogg files');
ok(Object.values(sfx).every((s) => s > 0 && s < 12), 'every sfx has a sane duration');
ok(Object.values(music).every((t) => t.secs > 5), 'every track has a sane duration');

const fams = new Set(Object.keys(sfx).map(familyOf));
const named = referencedFamilies();
const missing = [...fams].filter((f) => !named.has(f));
const bogus = [...named].filter((f) => !fams.has(f));
ok(missing.length === 0, `families no table plays: ${missing.join(', ')}`);
ok(bogus.length === 0, `tables name families that do not exist: ${bogus.join(', ')}`);
ok(familyOf('thunder-3') === 'thunder' && familyOf('solar-beam2-3direct') === 'solar-beam' && familyOf('karate-chop-whit') === 'karate-chop', 'familyOf strips part numbers and takes');

const tracks = referencedTracks();
const idle = Object.keys(music).filter((t) => !tracks.has(t));
const ghosts = [...tracks].filter((t) => !music[t]);
ok(idle.length === 0, `tracks the director never plays: ${idle.join(', ')}`);
ok(ghosts.length === 0, `director names tracks that do not exist: ${ghosts.join(', ')}`);

ok(Object.values(DAY_TRACKS).every((a) => a.length === 7), 'each season has a track for each of its seven days');
ok(Object.keys(TYPE_MOVES).length === 18, 'all 18 types have a move pool');
ok(pickTrack({ mode: 'title' }).track === 'title', 'title screen plays the title');
ok(pickTrack({ mode: 'morning', dayIn: 1 }).track === 'oaks-lab' && pickTrack({ mode: 'morning', dayIn: 3 }).track === 'pokemon-center', 'mornings: the lab on a season\'s first day, the Pokémon Center otherwise');
ok(pickTrack({ mode: 'day', season: 'winter', dayIn: 2 }).track === DAY_TRACKS.winter[1], 'a winter day plays the winter list');
const hz = pickTrack({ mode: 'day', season: 'summer', dayIn: 1, hazard: 'bolt' });
ok(hz.track === HAZARD_TRACKS.bolt && hz.then === DAY_TRACKS.summer[0], 'a bolt switches to the hazard theme and returns to the day track');
ok(pickTrack({ mode: 'day', last: true }).track === 'final-battle', 'the last day of the year is the final battle');
ok(pickTrack({ mode: 'dusk' }).track === 'rival-appears', 'the dusk comparison is the rival');
ok([0, 1, 2, 3].every((s) => pickTrack({ mode: 'season', stars: s }).track === SEASON_RESULT[s]), 'each star count has its result jingle');
ok(pickTrack({ mode: 'run', reveal: true, rating: 'S' }).then === RUN_RESULT.S, 'the rating reveal builds on Evolution and lands on the result');
ok(pickTrack({ mode: 'run', rating: 'C' }).track === 'ending', 'a plain year ends with the ending theme');

const size = (d) => readdirSync(join(BASE, d)).reduce((a, f) => a + statSync(join(BASE, d, f)).size, 0);
const mb = (size('sfx') + size('music')) / 1048576;
ok(mb < 70, `audio folder is ${mb.toFixed(1)} MB, want < 70`);

if (problems.length) { for (const p of problems) console.log(`  FAIL ${p}`); console.log(`\nFAIL  ${problems.length} of ${checks} checks failed`); process.exit(1); }
console.log(`PASS  ${checks} checks — all 328 sound effects (.ogg) and all 45 tracks (.m4a) are on disk and reachable (${mb.toFixed(1)} MB)`);
