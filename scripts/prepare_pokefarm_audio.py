#!/usr/bin/env python3
"""
Prepare the PokéFarm sound files from the two source packs.

  python3 scripts/prepare_pokefarm_audio.py --music <dir of .m4a> --sfx <dir of .ogg>

writes (never touches the sources):
  assets/audio/music/<slug>.m4a   the 45 BGM tracks, copied unchanged (original quality)
  assets/audio/sfx/<kebab>.ogg    the 328 Gen 1 move sounds, renamed to ascii kebab-case
  assets/audio/music/manifest.json  { slug: { n, title, secs } }
  assets/audio/sfx/manifest.json    { name: secs }

The sources are the officially distributed Pokémon Red/Blue music (personal use,
no remixing, no commercial use) and the Gen 1 move SFX rips (Celebi MM8BDM, edits
BellBlitzKing). Both are third-party audio — see assets/audio/README.md.
Needs ffprobe (ffmpeg-full is fine) for durations; no re-encoding.

Adding a later generation: point --sfx at its folder, but the game's
JOB_MOVES / TYPE_MOVES / EVENT_MOVES tables and check_pokefarm_audio.mjs's
counts must be extended too (see assets/audio/README.md).
"""
import argparse, json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'audio'

# n -> (slug, zh title). The slug is what the game refers to.
TRACKS = {
 1:('title','標題畫面'), 2:('pallet-town','真新鎮'), 3:('prof-oak','大木博士'), 4:('oaks-lab','大木研究所'),
 5:('rival-appears','勁敵登場'), 6:('road-viridian','前往常磐市'), 7:('battle-wild','野生寶可夢對戰'), 8:('victory-wild','野生對戰勝利'),
 9:('pewter-city','深灰市'), 10:('pokemon-center','寶可夢中心'), 11:('pokemon-healed','寶可夢恢復'), 12:('viridian-forest','常磐森林'),
 13:('guide','嚮導'), 14:('trainer-girl','訓練家登場（女）'), 15:('battle-trainer','訓練家對戰'), 16:('victory-trainer','訓練家對戰勝利'),
 17:('mt-moon','月見山'), 18:('road-cerulean','前往華藍市'), 19:('cerulean-city','華藍市'), 20:('gym','道館'),
 21:('to-bill','前往小拳石的家'), 22:('jigglypuff','胖丁之歌'), 23:('vermilion-city','橙華市'), 24:('ss-anne','聖特安奴號'),
 25:('road-lavender','前往紫苑鎮'), 26:('poke-flute','寶可夢笛'), 27:('trainer-boy','訓練家登場（男）'), 28:('battle-gym-leader','道館館主對戰'),
 29:('victory-gym-leader','館主對戰勝利'), 30:('cycling','騎腳踏車'), 31:('lavender-town','紫苑鎮'), 32:('pokemon-tower','寶可夢塔'),
 33:('celadon-city','彩虹市'), 34:('game-corner','火箭隊遊戲廳'), 35:('trainer-bad-guy','訓練家登場（壞人）'), 36:('rocket-hideout','火箭隊基地'),
 37:('silph-co','西爾佛公司'), 38:('the-sea','大海'), 39:('cinnabar','紅蓮島'), 40:('pokemon-mansion','寶可夢屋敷'),
 41:('evolution','進化'), 42:('final-road','冠軍之路'), 43:('final-battle','最終對戰（勁敵）'), 44:('hall-of-fame','名人堂'), 45:('ending','片尾曲'),
}

def secs(path):
    r = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)], capture_output=True, text=True)
    return round(float(r.stdout.strip()), 2)

def kebab(stem):
    s = stem.replace('(LOOP)', '-loop').replace('+', '-')
    s = re.sub(r'([a-z])([A-Z])', r'\1-\2', s)
    s = re.sub(r'([A-Za-z])(\d)', r'\1-\2', s) if False else s
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return s

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--music'); ap.add_argument('--sfx')
    a = ap.parse_args()
    if a.music:
        d = OUT / 'music'; d.mkdir(parents=True, exist_ok=True)
        for old in d.glob('*.ogg'):
            old.unlink()
        man = {}
        for f in sorted(Path(a.music).glob('*.m4a')):
            n = int(f.name[:2]); slug, zh = TRACKS[n]
            dst = d / f'{slug}.m4a'
            shutil.copyfile(f, dst)
            man[slug] = {'n': n, 'title': zh, 'secs': secs(dst)}
        (d / 'manifest.json').write_text(json.dumps(man, ensure_ascii=False, separators=(',', ':')))
        print('music', len(man))
    if a.sfx:
        d = OUT / 'sfx'; d.mkdir(parents=True, exist_ok=True)
        man = {}
        for f in sorted(Path(a.sfx).glob('*.ogg')):
            name = kebab(f.stem)
            assert name not in man, name
            shutil.copyfile(f, d / f'{name}.ogg')
            man[name] = secs(d / f'{name}.ogg')
        (d / 'manifest.json').write_text(json.dumps(man, separators=(',', ':')))
        print('sfx', len(man))

if __name__ == '__main__':
    sys.exit(main())
