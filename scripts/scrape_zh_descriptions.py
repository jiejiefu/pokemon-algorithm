#!/usr/bin/env python3
"""
Phase 2: Chinese Description Scraper (Parallel Version)

Scrape Traditional Chinese descriptions from the official TW portal:
    https://tw.portal-pokemon.com/pokedex/{id:04d}/

Each page embeds one JSON payload with three fields:

    text1   夢想 / 官方介紹 (first entry)
    text2   夢想 / 官方介紹 (second entry)
    text3   Pokédex flavor text, equivalent to the English `en_flavor`

`text1`/`text2` are the pair the site shows as its two version tabs. `text3` is
only populated for some Pokémon, and for a few (the Hisui species introduced in
Legends: Arceus) it is the *only* field filled in — those pages have no text1
or text2 at all.

This script writes the result straight into the master file's
`descriptions.zh` / `descriptions.zh_text2`. It used to keep a parallel cache
in descriptions_zh.json, but nothing ever merged that cache back, so the pair
could silently drift and a full pipeline re-run blanked every Chinese
description. One file, one owner.

Usage:
    python scripts/scrape_zh_descriptions.py                 # fill every gap
    python scripts/scrape_zh_descriptions.py --ids 899,1     # just these
    python scripts/scrape_zh_descriptions.py --dry-run       # parse, write nothing
"""

import argparse
import json
import re
import asyncio
import httpx
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, Optional, Tuple

BASE = Path(__file__).parent.parent
POKEMON_DATA = BASE / "assets" / "data" / "pokemon_data.json"

# Parallel scraping settings
MAX_RETRIES = 3
TIMEOUT = 20.0
MAX_CONCURRENT = 8  # max concurrent requests

# User agent
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}

# The portal serves this site-wide string as its og:description whenever a page
# has no description of its own, so it is what an unguarded scrape ends up
# storing. Treat it as "no data" rather than as a description.
#
# Known offenders — the only four records in the master file that had this
# string stored as their Chinese description. All four are Hisui species from
# Legends: Arceus, whose portal pages carry the Pokédex entry in `text3` only
# and leave `text1`/`text2` blank, which is exactly what makes og:description
# fall back to this site-wide filler:
#
#     #899  Wyrdeer    詭角鹿
#     #901  Ursaluna   月月熊
#     #903  Sneasler   大狃拉
#     #905  Enamorus   眷戀雲
#
# If a future scrape reports "no description found" for a page you believe has
# one, check this list first — the fix is almost certainly the `text3` fallback
# in parse_portal_pokemon(), not the regexes.
PLACEHOLDER_RE = re.compile(r'Search for your favorite Pok', re.IGNORECASE)

# The payload is JSON escaped inside a JS string literal, so the real bytes are
# \"text1\":\"…\". Matching the unescaped form is why the previous revision
# extracted nothing at all and silently fell through to the meta-tag fallback.
TEXT_FIELD_PATTERNS = (
    r'\\"%s\\":\\"(.*?)\\"',   # \"text1\":\"…\"   <- the format the site serves
    r'"%s"\s*:\s*"(.*?)"',    # "text1": "…"     <- plain JSON fallback
)


def clean_flavor_text(text: str) -> str:
    """Strip the trailing artifacts the portal leaves on its flavor text.

    The embedded page script terminates text2 with an escaped quote, so every
    value captured picks up a trailing backslash (raw `\\\\` becomes one literal
    `\\` once stored). text2 is affected on all 1025 entries; text1 is usually
    already clean. Some values also arrive with trailing whitespace or CRLF.

    The strip is anchored to the end so interior paragraph breaks (a literal
    \\r\\n pair, e.g. ids 480/922/926) survive; `.strip()` only touches the two
    ends, where the portal's own padding is.
    """
    return re.sub(r'[\\]+\s*$', '', text or '').strip()


def is_placeholder(text: str) -> bool:
    """True when the portal gave us its site-wide filler instead of a Pokédex entry."""
    return not text.strip() or bool(PLACEHOLDER_RE.search(text))


def extract_text_fields(script_src: str) -> Dict[str, str]:
    """Pull text1/text2/text3 out of one embedded script, unescaping as needed."""
    fields = {}
    for key in ('text1', 'text2', 'text3'):
        value = None
        for pattern in TEXT_FIELD_PATTERNS:
            match = re.search(pattern % key, script_src)
            if match:
                value = match.group(1)
                break
        fields[key] = clean_flavor_text(value) if value is not None else ''
    return fields


def parse_portal_pokemon(html: str) -> Tuple[str, str]:
    """Return (zh, zh_text2) for one portal page, both free of placeholders."""
    soup = BeautifulSoup(html, 'lxml')

    for script in soup.find_all('script'):
        src = script.string
        if not src or 'text1' not in src:
            continue

        fields = extract_text_fields(src)
        if not any(fields.values()):
            continue

        text1, text2 = fields['text1'], fields['text2']

        # Legends: Arceus species carry their Pokédex entry in text3 only.
        if not text1 and not text2 and fields['text3']:
            text1 = fields['text3']

        if is_placeholder(text1):
            text1 = ''
        if is_placeholder(text2):
            text2 = ''

        return text1, text2

    # No meta-tag fallback on purpose: og:description mirrors text1 for most
    # pages but is the site-wide placeholder for the ones that have none, which
    # is how 899/901/903/905 ended up described as "Search for your favorite
    # Pokémon!". A missing entry is recoverable, a fabricated one is not.
    return '', ''


async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """Fetch page with retries"""
    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code == 404:
                return None
        except Exception:
            pass
        await asyncio.sleep(0.5 * (2 ** attempt))
    return None


async def scrape_pokemon(client: httpx.AsyncClient, pid: int) -> Tuple[str, str]:
    url = f"https://tw.portal-pokemon.com/pokedex/{pid:04d}/"
    html = await fetch_page(client, url)
    if not html:
        return '', ''
    return parse_portal_pokemon(html)


async def scrape_all(pokemon_data, ids: Optional[list]) -> Dict[int, Tuple[str, str]]:
    """Scrape the requested Pokémon (or every one lacking a description)."""
    if ids is not None:
        targets = [p for p in pokemon_data if p['id'] in ids]
    else:
        targets = [p for p in pokemon_data if needs_scrape(p)]

    if not targets:
        return {}

    print(f"Scraping {len(targets)} Pokémon")
    results: Dict[int, Tuple[str, str]] = {}
    limits = httpx.Limits(max_connections=MAX_CONCURRENT, max_keepalive_connections=4)
    sem = asyncio.Semaphore(MAX_CONCURRENT)

    async with httpx.AsyncClient(limits=limits, http2=True) as client:
        async def one(pokemon):
            async with sem:
                desc = await scrape_pokemon(client, pokemon['id'])
                if desc[0] or desc[1]:
                    results[pokemon['id']] = desc
                    print(f"  #{pokemon['id']:>4} {pokemon['names'].get('zh', '')}: "
                          f"{desc[0][:38] or '(empty)'}")
                else:
                    print(f"  #{pokemon['id']:>4} {pokemon['names'].get('zh', '')}: "
                          f"no description found")

        await asyncio.gather(*(one(p) for p in targets))

    return results


def needs_scrape(pokemon) -> bool:
    """True when a record has no usable Chinese description yet."""
    descriptions = pokemon.get('descriptions') or {}
    return is_placeholder(descriptions.get('zh', ''))


def write_pokemon_data(pokemon_data) -> None:
    """Persist the master file, matching its existing byte-for-byte format."""
    with open(POKEMON_DATA, 'w', encoding='utf-8') as f:
        json.dump(pokemon_data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', help='comma-separated ids to scrape, e.g. 899,901')
    parser.add_argument('--dry-run', action='store_true',
                        help='report what was parsed without writing anything')
    args = parser.parse_args()

    ids = None
    if args.ids:
        ids = {int(v) for v in args.ids.split(',') if v.strip()}

    with open(POKEMON_DATA, 'r', encoding='utf-8') as f:
        pokemon_data = json.load(f)

    total = len(pokemon_data)
    gaps = sum(1 for p in pokemon_data if needs_scrape(p))
    print(f"Loaded {total} Pokémon, {gaps} missing a Chinese description")

    results = asyncio.run(scrape_all(pokemon_data, ids))

    if args.dry_run:
        print(f"\n--dry-run: {len(results)} of "
              f"{len(ids) if ids else gaps} would be written. Nothing changed.")
        return

    if not results:
        print("\nNothing to update.")
        return

    by_id = {p['id']: p for p in pokemon_data}
    for pid, (text1, text2) in results.items():
        descriptions = by_id[pid].setdefault('descriptions', {})
        descriptions['zh'] = text1
        descriptions['zh_text2'] = text2

    write_pokemon_data(pokemon_data)

    remaining = sum(1 for p in pokemon_data if needs_scrape(p))
    print(f"\nUpdated {len(results)} Pokémon. "
          f"Still missing a description: {remaining}/{total}")


if __name__ == '__main__':
    main()