#!/usr/bin/env python3
"""
Build assets/data/generations.json from infopoke_net_generations.html.

The file holds ONLY curated content — the things that cannot be derived:

    gen, numeral, region, year, description, mechanics[], games[], newTypes[],
    starters[]

Deliberately NOT stored, because they can be computed from pokemon_data.json and
would only be able to go stale:

  * per-generation count and National Dex range  -> filter the 1025 by id
  * the legendary / mythical lists              -> is_legendary / is_mythical
  * the hero's four totals (9 / 1025 / 9 / years)-> len(this file) + len(data)

The source has no ROM field, no long-form mechanic prose (mechanics are 4-5 bare
labels), and descriptions of 49-76 characters. It also has no `新屬性` for seven
of the nine generations.

`starters` is the one field that looks derivable and is not. Taking the first
three ids of each generation works for eight of nine and is wrong for the fifth:
generation 5 opens with 494 Victini, which is mythical, so the real starters are
495 / 498 / 501. The list is read positionally from the page instead, and
STARTERS_EXPECTED asserts it.

Parsing notes, each of which was a wrong answer first:

  * Articles are split on `</article>`. Splitting on the opening tag runs the
    ninth article together with the site-wide footer, which is how an earlier
    attempt ended up with a `rom` key and a range of 2000+ on some records.
  * Each chip group is bounded by the Nuxt fragment markers `<!--[-->` and
    `<!--]-->`. A fixed character window is not enough: `新屬性` appears before
    `主要遊機` in the source order, so a window that runs long enough to catch
    the type chips also swallows the game names, which is how generation 2 came
    out as 惡 / 鋼 / Gold / Silver / Crystal and generation 6 as 妖精 / X / Y.
  * `starters` are the first three distinct artwork ids in the article. The
    starter cards carry no anchor at all (they are bare <p> text), so they
    cannot be picked out by href the way the game chips can.

Writes only after every assertion passes. Idempotent.
"""

import json
import os
import re
import sys
import html as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'infopoke_net_generations.html')
SOURCE_URL = 'https://infopoke.net/zh-tw/generations'
DATA = os.path.join(ROOT, 'assets', 'data', 'pokemon_data.json')
OUT = os.path.join(ROOT, 'assets', 'data', 'generations.json')

# The one field that cannot be inferred from a rule.
STARTERS_EXPECTED = {
    1: [1, 4, 7], 2: [152, 155, 158], 3: [252, 255, 258],
    4: [387, 390, 393],
    5: [495, 498, 501],  # NOT 494/495/496 — 494 is Victini
    6: [650, 653, 656], 7: [722, 725, 728], 8: [810, 813, 816],
    9: [906, 909, 912],
}
NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']
# Only these two generations introduce a type.
NEW_TYPES_EXPECTED = {2: ['惡', '鋼'], 6: ['妖精']}


def clean(s):
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def chip_group(article, label):
    """Chip texts belonging to one label, bounded by the next fragment marker."""
    i = article.find(label)
    if i < 0:
        return []
    tail = article[i + len(label):]
    start = tail.find('<!--[-->')
    if start < 0:
        start = 0
    end = tail.find('<!--]-->', start)
    if end < 0:
        end = min(len(tail), start + 3000)
    out = []
    for m in re.finditer(r'<(a|span)\b([^>]*)>(.*?)</\1>', tail[start:end], re.S):
        text = clean(m.group(3))
        if not text or len(text) > 60:
            continue
        if m.group(1) == 'a' and '/pokemon/' not in (m.group(2) or ''):
            continue
        if text not in out:
            out.append(text)
    return out


def main():
    if not os.path.exists(SOURCE):
        # The snapshot is gitignored, so a fresh clone genuinely cannot run this.
        # Say where to get it instead of letting the open() below traceback.
        sys.exit(
            'missing source dump: %s\n'
            'It is a gitignored snapshot, not vendored. Re-fetch it with:\n'
            '  curl -L %s -o %s'
            % (SOURCE, SOURCE_URL, os.path.basename(SOURCE))
        )
    src = open(SOURCE, encoding='utf-8').read()
    articles = re.findall(r'<article.*?</article>', src, re.S)
    if len(articles) != 9:
        sys.exit('expected 9 <article> blocks, found %d' % len(articles))

    with open(DATA, encoding='utf-8') as f:
        pokemon = json.load(f)
    by_gen = {}
    for r in pokemon:
        by_gen.setdefault(r['generation'], []).append(r['id'])

    errors = []
    gens = []
    for n, article in enumerate(articles, 1):
        head = clean(article.split('lg:col-span-9')[0])
        numeral = re.search(r'世代\s+([IVX]+)', head)
        region_year = re.search(r'世代\s+[IVX]+\s+(.+?)\s+((?:19|20)\d\d)', head)
        rng = re.search(r'#(\d+)\s*-\s*#(\d+)', head)
        count = re.search(r'([\d,]+)\s*新寶可夢', head)
        body = article.split('lg:col-span-9', 1)[1]
        para = re.search(r'<p[^>]*>(.*?)</p>', body, re.S)

        ids = []
        for x in re.findall(r'artwork/(\d+)\.webp', article):
            v = int(x)
            if v not in ids:
                ids.append(v)
        starters = ids[:3]

        entry = {
            'gen': n,
            'numeral': numeral.group(1) if numeral else '',
            'region': region_year.group(1).strip() if region_year else '',
            'year': int(region_year.group(2)) if region_year else 0,
            'description': clean(para.group(1)) if para else '',
            'mechanics': chip_group(article, '新機制'),
            'games': chip_group(article, '主要遊戲'),
            'newTypes': chip_group(article, '新屬性'),
            'starters': starters,
        }
        gens.append(entry)

        if entry['numeral'] != NUMERALS[n - 1]:
            errors.append('gen %d: numeral is %r, expected %r'
                          % (n, entry['numeral'], NUMERALS[n - 1]))
        if not entry['region'] or not entry['year']:
            errors.append('gen %d: region/year not parsed (%r / %r)'
                          % (n, entry['region'], entry['year']))
        if not entry['description']:
            errors.append('gen %d: description not parsed' % n)
        if starters != STARTERS_EXPECTED[n]:
            errors.append('gen %d: starters %s, expected %s'
                          % (n, starters, STARTERS_EXPECTED[n]))
        if entry['newTypes'] != NEW_TYPES_EXPECTED.get(n, []):
            errors.append('gen %d: newTypes %s, expected %s'
                          % (n, entry['newTypes'], NEW_TYPES_EXPECTED.get(n, [])))
        if not 4 <= len(entry['mechanics']) <= 6:
            errors.append('gen %d: %d mechanics chips, expected 4-6'
                          % (n, len(entry['mechanics'])))
        if not entry['games']:
            errors.append('gen %d: no games' % n)
        # The page's own count must agree with our data, twice over: against the
        # stated range and against the generation field on the records.
        if rng and count:
            lo, hi = int(rng.group(1)), int(rng.group(2))
            stated = int(count.group(1).replace(',', ''))
            in_range = sum(1 for i in by_gen.get(n, []) if lo <= i <= hi)
            if not (stated == hi - lo + 1 == len(by_gen.get(n, [])) == in_range):
                errors.append(
                    'gen %d: stated %d, range %d-%d spans %d, data holds %d'
                    % (n, stated, lo, hi, hi - lo + 1, len(by_gen.get(n, []))))

    if errors:
        print('ABORTED — %d problem(s), nothing written:' % len(errors))
        for e in errors:
            print('  - %s' % e)
        sys.exit(1)

    print('%-4s %-5s %-8s %-5s %-6s %-4s %-4s %s'
          % ('gen', 'num', 'region', 'year', 'games', 'mech', 'typ', 'starters'))
    for g in gens:
        print('%-4d %-5s %-8s %-5d %-6d %-4d %-4d %s'
              % (g['gen'], g['numeral'], g['region'], g['year'], len(g['games']),
                 len(g['mechanics']), len(g['newTypes']), g['starters']))

    if '--dry-run' in sys.argv:
        print('\ntotal games: %d, dry run, nothing written'
              % sum(len(g['games']) for g in gens))
        return

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(gens, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('\nwrote %s (%d generations, %d games total)'
          % (OUT, len(gens), sum(len(g['games']) for g in gens)))


if __name__ == '__main__':
    main()
