#!/usr/bin/env python3
"""
Tag pokemon_data.json with collection membership so collections.html can derive
its category counts without a second fetch.

Four things are added, in place, to assets/data/pokemon_data.json:

    is_ultra_beast  bool    12 records
    is_paradox      bool    22 records
    paradox_side    str     'ancient' | 'future'  (only where is_paradox)
    forms           list    [{id, base_id, form, name_en, filename}]
                             form in {'mega', 'gigantamax'}

Regional forms are deliberately NOT written here. They already live in
assets/data/evolution_chains.json under `variants`, keyed by region, and that
file is consumed by renderEvolutionChain() in shared.js behind a guard that
AGENTS.md documents at length. Adding a second copy here would create two
sources of truth for the same 54 sprites. See AGENTS.md for the sibling
variants:{} truthiness trap.

SOURCE OF EACH LIST
-------------------
mega / gigantamax   parsed from infopoke_net_mega.html and
                    infopoke_net_gigantamax.html. Each card carries both
                    href="/zh-TW/pokemon/<slug>" and the base's #NNNN, so the
                    base <-> form mapping is read from the page rather than
                    inferred from sprite id ranges.

ultra beast         infopoke_net_ultra-beast.html. Hardcoded rather than parsed
                    so the set is reviewable in the diff; the count is
                    asserted against the dump.

paradox             HAND-CORRECTED, and this is the important part.
                    infopoke_net_paradox.html lists 16 ids and is WRONG in both
                    directions: it includes 996/997/998 (the Walking fossil
                    trio), which are not paradox, and it omits nine real ones
                    (991, 1005, 1006, 1009, 1010, 1020, 1021, 1022, 1023).
                    The list below is transcribed from the official Chinese
                    naming table supplied by the maintainer, which covers all
                    22 including the two legendaries Koraidon and Miraidon.
                    DO NOT "fix" this list by re-parsing the dump.

Every id is asserted to exist in the 1025, every referenced sprite to exist on
disk, and every name below to equal the record's own names.zh — that last
assertion is what catches a mis-transcribed Chinese name here, by aborting
instead of quietly tagging the wrong record. names.zh remains the single
source of truth for display; this file never writes a name.

Idempotent: rerunning recomputes every field from scratch, so the tags are
rebuilt rather than accumulated. Writes only after all asserts pass.
"""

import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'assets', 'data', 'pokemon_data.json')
SPRITES = os.path.join(ROOT, 'assets', 'images', 'pokemon')

# The gitignored snapshots this script parses, and where to re-fetch each one.
# `infopoke_net_paradox.html` is deliberately absent: the paradox list below is
# hand-corrected, not parsed (see the module docstring), so nothing reads it.
DUMP_URLS = {
    'infopoke_net_mega.html':
        'https://infopoke.net/zh-tw/mega',
    'infopoke_net_gigantamax.html':
        'https://infopoke.net/zh-tw/gigantamax',
    'infopoke_net_ultra-beast.html':
        'https://infopoke.net/zh-tw/ultra-beast',
}


def read_dump(filename):
    """Read a snapshot, or exit with the curl line that restores it.

    Every reader goes through here. Returning 0 or '' on a missing file was the
    bug this replaced: a fresh clone has no snapshots, so `count_dump_artwork`
    answered 0 and the ultra-beast assertion below failed with "expected 12,
    found 0" — a statement about the DATA, when the real fault was a missing
    INPUT. Same FileNotFoundError from the two open() sites, but with no hint
    that the file is gitignored on purpose.
    """
    path = os.path.join(ROOT, filename)
    if not os.path.exists(path):
        sys.exit(
            'missing source dump: %s\n'
            'It is a gitignored snapshot, not vendored. Re-fetch it with:\n'
            '  curl -L %s -o %s'
            % (filename, DUMP_URLS.get(filename, 'https://infopoke.net/zh-tw'),
               filename)
        )
    return open(path, encoding='utf-8').read()

# --- Ultra Beasts (12) -----------------------------------------------------
# PokeAPI does not flag these as legendary or mythical, so nothing in
# pokemon_data.json implied them before this script.
ULTRA_BEAST_IDS = [
    793, 794, 795, 796, 797, 798, 799, 800, 803, 804, 805, 806,
]

# --- Paradox (22) ----------------------------------------------------------
# id: (side, official Traditional Chinese name)
# Side follows the Scarlet/Violet split: ancient paradoxes are past relatives
# of current species, future paradoxes are their descendants.
PARADOX = {
    # 古代寶可夢 (朱 / Scarlet)
    1007: ('ancient', '故勒頓'),
    984: ('ancient', '雄偉牙'),
    985: ('ancient', '吼叫尾'),
    986: ('ancient', '猛惡菇'),
    987: ('ancient', '振翼髮'),
    988: ('ancient', '爬地翅'),
    989: ('ancient', '沙鐵皮'),
    1005: ('ancient', '轟鳴月'),
    1009: ('ancient', '波盪水'),
    1020: ('ancient', '破空焰'),
    1021: ('ancient', '猛雷鼓'),
    # 未來寶可夢 (紫 / Violet)
    1008: ('future', '密勒頓'),
    990: ('future', '鐵轍跡'),
    991: ('future', '鐵包袱'),
    992: ('future', '鐵臂膀'),
    993: ('future', '鐵脖頸'),
    994: ('future', '鐵毒蛾'),
    995: ('future', '鐵荊棘'),
    1006: ('future', '鐵武者'),
    1010: ('future', '鐵斑葉'),
    1022: ('future', '鐵磐岩'),
    1023: ('future', '鐵頭殼'),
}

# Counts the dumps independently establish. A change here means the source
# page moved, not that the transcription is wrong.
EXPECTED = {'ultra_beast': 12, 'paradox': 22, 'mega_forms': 48, 'gmax_forms': 32}


def parse_form_cards(filename):
    """Pull (base_id, form_id, form_name_en) out of one InfoPoke form page.

    Splits on '<a ' rather than matching one big regex: the cards are dense
    sibling markup, and a single regex either misses cards or bleeds across
    card boundaries depending on how the attribute order shifts upstream.
    Each card carries the artwork id and the base species' #NNNN.
    """
    src = read_dump(filename)
    cards = []
    for chunk in src.split('<a ')[1:]:
        if 'artwork/' not in chunk:
            continue
        chunk = chunk.split('</a>')[0]
        art = re.search(r'artwork/(\d+)\.webp', chunk)
        num = re.search(r'#(\d{1,4})', chunk)
        h3 = re.search(r'<h3[^>]*>(.*?)</h3>', chunk, re.S)
        if not (art and num):
            continue
        cards.append({
            'base_id': int(num.group(1)),
            'form_id': int(art.group(1)),
            'name_en': re.sub(r'<[^>]+>', '', h3.group(1)).strip() if h3 else '',
        })
    return cards


def count_dump_artwork(filename):
    src = read_dump(filename)
    seen = []
    for x in re.findall(r'/pokemon/artwork/(\d+)\.webp', src):
        i = int(x)
        if i not in seen:
            seen.append(i)
    return len(seen)


def main():
    with open(DATA, encoding='utf-8') as f:
        data = json.load(f)
    by_id = {r['id']: r for r in data}
    print('loaded %d records' % len(data))

    errors = []

    # --- Ultra beasts -------------------------------------------------------
    for pid in ULTRA_BEAST_IDS:
        if pid not in by_id:
            errors.append('ultra beast %d is not in the dataset' % pid)

    # --- Paradox: existence + name assertion -------------------------------
    for pid, (side, name_zh) in sorted(PARADOX.items()):
        rec = by_id.get(pid)
        if rec is None:
            errors.append('paradox %d is not in the dataset' % pid)
            continue
        actual = rec['names'].get('zh', '')
        if actual != name_zh:
            errors.append(
                'paradox %d name mismatch: this script says %r, '
                'pokemon_data.json says %r' % (pid, name_zh, actual))

    # --- Forms --------------------------------------------------------------
    forms = {}
    for form, filename, expected_key in (
        ('mega', 'infopoke_net_mega.html', 'mega_forms'),
        ('gigantamax', 'infopoke_net_gigantamax.html', 'gmax_forms'),
    ):
        cards = parse_form_cards(filename)
        n = len(cards)
        if n != EXPECTED[expected_key]:
            errors.append('%s: parsed %d cards, expected %d'
                          % (form, n, EXPECTED[expected_key]))
        for c in cards:
            if c['base_id'] not in by_id:
                errors.append('%s: base species %d is not in the dataset'
                              % (form, c['base_id']))
                continue
            if c['form_id'] in by_id:
                errors.append('%s: form id %d collides with a real species id'
                              % (form, c['form_id']))
            sprite = os.path.join(SPRITES, '%d.png' % c['form_id'])
            if not os.path.exists(sprite):
                errors.append('%s: sprite %d.png is not on disk'
                              % (form, c['form_id']))
            forms.setdefault(c['base_id'], []).append({
                'id': c['form_id'],
                'base_id': c['base_id'],
                'form': form,
                'name_en': c['name_en'],
                'filename': '%d.png' % c['form_id'],
            })

    # Cross-check the ultra-beast count against the dump we did not parse.
    ub_dump = count_dump_artwork('infopoke_net_ultra-beast.html')
    if ub_dump != EXPECTED['ultra_beast']:
        errors.append('ultra beast: dump shows %d sprites, list has %d'
                      % (ub_dump, len(ULTRA_BEAST_IDS)))

    if errors:
        print('\nABORTED — %d problem(s), nothing written:' % len(errors))
        for e in errors:
            print('  - %s' % e)
        sys.exit(1)

    # --- Apply --------------------------------------------------------------
    for rec in data:
        pid = rec['id']
        rec['is_ultra_beast'] = pid in ULTRA_BEAST_IDS
        if pid in PARADOX:
            rec['is_paradox'] = True
            rec['paradox_side'] = PARADOX[pid][0]
        else:
            rec['is_paradox'] = False
            rec['paradox_side'] = None
        # Rebuild rather than extend, so a stale form id cannot survive a rerun.
        rec['forms'] = sorted(forms.get(pid, []), key=lambda f: f['id'])

    mega_species = sum(1 for r in data if any(f['form'] == 'mega' for f in r['forms']))
    gmax_species = sum(1 for r in data if any(f['form'] == 'gigantamax' for f in r['forms']))

    print('\nwould write:')
    print('  is_ultra_beast  %d records' % sum(1 for r in data if r['is_ultra_beast']))
    print('  is_paradox      %d records (ancient %d / future %d)'
          % (sum(1 for r in data if r['is_paradox']),
             sum(1 for r in data if r['paradox_side'] == 'ancient'),
             sum(1 for r in data if r['paradox_side'] == 'future')))
    print('  mega            %d forms on %d species'
          % (sum(len([f for f in r['forms'] if f['form'] == 'mega']) for r in data), mega_species))
    print('  gigantamax      %d forms on %d species'
          % (sum(len([f for f in r['forms'] if f['form'] == 'gigantamax']) for r in data), gmax_species))
    print('  forms present   %d species' % sum(1 for r in data if r['forms']))

    if '--dry-run' in sys.argv:
        print('\ndry run, nothing written')
        return

    shutil.copy2(DATA, DATA + '.bak')
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('\nwrote %s (backup at %s.bak)' % (DATA, DATA))


if __name__ == '__main__':
    main()
