# PokéFarm audio

Third-party audio used by `pokefarm.html`. Nothing here is original to this project, and none of it is covered by the site's own licence.

| Folder | What | Files | Size |
|---|---|---|---|
| `music/` | Pokémon Red / Blue soundtrack, original `.m4a` | 45 | ~51 MB |
| `sfx/` | Gen 1 move sound effects (Red / Blue / Yellow), Ogg | 328 | ~6 MB |

Total: ~57 MB. `check_pokefarm_audio.mjs` fails above 70 MB.

## Sources and terms

- **Music** — the Red/Blue music released through the *Pokémon Game Sound Library* (Asia). It is distributed for **personal use only: no remixing, no re-editing, no commercial use**. This repository keeps it byte-for-byte inside a free, non-commercial study site; there is no re-encode. If you fork the project, accept the same terms yourself or remove `music/`.
- **Sound effects** — *GEN 1 SFX – Attack Moves – RBY*: ripped by Celebi MM8BDM, cleaned and edited by BellBlitzKing. Original post: <https://cutstuff.net/forum/index.php?topic=6528.0>. Parts of a move are named `Move1`, `Move2`; `…Direct` / `…Single` files are alternative takes (see the original README).
- Pokémon and its music and sounds belong to Nintendo, Creatures Inc. and GAME FREAK inc.

## How it was made

```sh
python3 scripts/prepare_pokefarm_audio.py --music <dir with the 45 .m4a> --sfx <dir with the 328 .ogg>
```

re-creates both folders and both `manifest.json` files. The 45 music tracks are copied unchanged as `.m4a` (original quality, ~51 MB); the 328 SFX are copied and renamed to ascii kebab-case, e.g. `AcidArmor.ogg` → `acid-armor.ogg` (~6 MB). Only `ffprobe` is needed, for durations. GitHub warns above 50 MB for a single file and blocks at 100 MB; the largest file here is ~3 MB.

## Future generations

Only the Gen 1 set is wired today. Gen 2–7, `_Album Art`, `Pokemon Cries, Music and Soundtrack Links`, both README text files and the YouTube link are preserved in `data-sources/audio-sources/` (gitignored, never served).

Adding more `.ogg` files to `assets/audio/sfx/` is **not** enough. `assets/js/pokefarm-audio.js`'s `JOB_MOVES` / `TYPE_MOVES` / `EVENT_MOVES` tables must name every new file family, and `scripts/check_pokefarm_audio.mjs` pins the current counts (328 SFX, 45 tracks) and the 70 MB ceiling. Update the mapping and the checker together.

## Where each sound is used

All of it is wired up in `assets/js/pokefarm-audio.js`, and `node scripts/check_pokefarm_audio.mjs` proves every file is reachable.

- **Music director** — title: Title Screen · morning: Oak's Lab (first day of a season) / Pokémon Center · each day: a per-season list of seven town and route themes · thunder: Rocket Hideout · flood: wild battle · typhoon landfall: gym-leader battle · frost: Pokémon Tower · locust: trainer battle · last day of the year: final rival battle · dusk comparison: *A Rival Appears* · season result by stars: Jigglypuff's Song / wild victory / trainer victory / gym-leader victory · year rating: Evolution, then Hall of Fame (S/A) or Ending (B/C). Stingers: Poké Flute (hire), trainer-appears jingles (pests, locusts), Pokémon Healed (new morning).
- **Sound effects** — a worker finishing a job plays the move that suits the job (Cut, Dig, Water Gun …) or, half the time, a move of its own primary type; hazards, orders, shop and rating moments have their own moves. `音效室` in the 🔊 dialog lists every family so a player can listen to all of them.
