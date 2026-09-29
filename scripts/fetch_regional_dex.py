#!/usr/bin/env python3
"""
Fetch the first-appearance regional dex numbers the detail page needs and merge
them into assets/data/pokemon_data.json.

Reads:  assets/data/pokemon_data.json (1025 records)
Writes: assets/data/pokemon_data.json, in place, adding:
          regional_dex  dict, {"全國": 1, "關都": 1, "城都": 226, ...}

Source: PokeAPI /pokedex/{name}, not /pokemon-species/{id}.
    The numbers themselves are on the species resource (pokedex_numbers), but
    that would cost 1025 GETs to learn something 12 of them already say.

Why 12 requests, and why positionally:
    The national dex lists all 1025 species in order, and its entry_number for
    each is exactly our record's id -- verified 1025/1025. So one GET of
    /pokedex/national gives an ordered species_name -> id table, and the other
    eleven pokedexes are then resolved by *name* through that table. That is
    what makes 12 requests sufficient instead of 1025.

    It also sidesteps the name-matching traps: names.zh is scraped from the
    Chinese site, but pokedex entries carry names.en, and names.en disagrees
    with PokeAPI's own species name for 15 records (Mr. Mime, Farfetch'd,
    Sirfetch'd, Nidoran♀, Nidoran♂ and others). Matching en -> en is not safe
    either, because pokemon_data.json spells the Nidorans with a symbol
    (Nidoran♀ / Nidoran♂) while PokeAPI's national list spells them
    nidoran-f / nidoran-m, and they are the pair most likely to be collapsed
    into one row by anything that normalises to [a-z0-9]. Positional lookup has
    no such failure mode.

Why these 12 dexes:
    First appearance, not every regional list. PokeAPI carries 35 pokedexes
    (updated-johto, black-2-white-2-unova, legends-arceus, ...), which is more
    than the detail page can show and more than the reference site lists.
    InfoPoke shows exactly: 全國, 關都, 城都, 豐緣, 神奧, 合眾, 卡洛斯,
    阿羅拉, 伽勒爾, 他思岐, 帕底亞, 藍莓學園 -- the first regional appearance
    of each of the nine regions plus 全國 and the Gen 9 Blueberry Academy one.
    Bulbasaur confirms the rule: Johto #226 is original-johto's first entry and
    updated-johto's is #231, so the first-appearance dex is the one to keep.

Why 全國 is in the list:
    28 of the 1025 records -- legendaries, mythicals, paradox and other
    specials -- appear in no regional dex at all. Without 全國 those 28 would
    render an empty 地區圖鑑, and 全国 is also what InfoPoke shows. It is
    stored under the same key as every other dex and formatted by the existing
    formatPokemonId() (4 digits), while regional numbers use 3.

Labels:
    The nine region names are the same strings the site already uses for the
    generations guide, read from assets/data/generations.json. 全國 and 藍莓學園
    come from the InfoPoke snapshot. 他思岐 is the one in assets/js/categories.js
    -- NOT 蒼炎, which was a draft label in an earlier probe and appears
    nowhere else in the repo. 阿羅拉 is the standard form; the categories.js
    "hisui/galar" region list had it as 阿羅亞, which this work corrects.

Ordering:
    Run this AFTER enhance_pokemon_data.py. build_pokemon_entry() assembles a
    whitelist dict, so a Phase 1 re-run rebuilds every record from the CSVs and
    drops any key it does not name -- including this one.
    enhance_pokemon_data.py carries it through from `existing`, so re-running
    the pair in order is safe; running Phase 1 alone will reset it.

Usage:
    python scripts/fetch_regional_dex.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

BASE = Path(__file__).parent.parent
API = "https://pokeapi.co/api/v2"
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"
GENERATIONS_JSON = BASE / "assets" / "data" / "generations.json"

MAX_ID = 1025
MAX_RETRIES = 4
TIMEOUT = 30.0
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pokemon-algorithm/1.0)"}

# (pokedex slug, Chinese label), in render order. The 9 region labels are
# cross-checked against generations.json at runtime; 全國 and 藍莓學園 are not
# regions and so are exempt from that check.
DEXES: list[tuple[str, str]] = [
    ("national", "全國"),
    ("kanto", "關都"),
    ("original-johto", "城都"),
    ("hoenn", "豐緣"),
    ("original-sinnoh", "神奧"),
    ("original-unova", "合眾"),
    ("kalos-central", "卡洛斯"),
    ("original-alola", "阿羅拉"),
    ("galar", "伽勒爾"),
    ("hisui", "他思岐"),
    ("paldea", "帕底亞"),
    ("blueberry", "藍莓學園"),
]

client = httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS, http2=False)


def get_pokedex(slug: str) -> dict:
    """GET one pokedex resource, retrying with linear backoff."""
    url = f"{API}/pokedex/{slug}"
    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(0.6 * attempt)
    raise SystemExit(f"FAIL: could not fetch pokedex/{slug} after {MAX_RETRIES} tries: {last}")


def region_names_from_generations() -> set[str]:
    """The 9 region names, read from the data the generations page renders.

    generations.json is a bare list of 9 generation objects, each with a single
    `region` string -- not an object with a "generations" key.

    Used in one direction only. Every region in here must appear among the dex
    labels, or the detail page would ship a region the generations guide has
    never heard of. The converse is NOT an error: 他思岐 is a Gen 8 sub-region
    and appears nowhere in generations.json, and 全國/藍莓學園 are not regions
    at all.
    """
    if not GENERATIONS_JSON.exists():
        print(f"  note: {GENERATIONS_JSON.name} absent, skipping label cross-check")
        return set()
    payload = json.loads(GENERATIONS_JSON.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(
            f"FAIL: {GENERATIONS_JSON.name} is a {type(payload).__name__}, expected a list of generations"
        )
    return {g["region"] for g in payload if isinstance(g, dict) and g.get("region")}


def build_id_by_species_name(national: dict) -> dict[str, int]:
    """species_name -> our id, from the national dex's own ordering.

    Deliberately positional: entry_number is only consulted to prove the
    ordering assumption, never to build the table.
    """
    entries = national.get("pokemon_entries") or []
    if len(entries) != MAX_ID:
        raise SystemExit(
            f"FAIL: national dex has {len(entries)} entries, expected {MAX_ID}; "
            "the positional mapping is only valid if it is complete"
        )
    table: dict[str, int] = {}
    for position, item in enumerate(entries, start=1):
        name = (item.get("pokemon_species") or {}).get("name")
        number = item.get("entry_number")
        if name is None or number is None:
            raise SystemExit(f"FAIL: national dex position {position} is malformed: {item!r}")
        if number != position:
            raise SystemExit(
                f"FAIL: national dex entry_number {number} at position {position}; "
                "the mapping relies on entry_number == our id"
            )
        if name in table:
            raise SystemExit(f"FAIL: species {name!r} appears twice in the national dex")
        table[name] = position
    return table


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    args = parser.parse_args()

    print(f"Reading {POKEMON_DATA_JSON.relative_to(BASE)} ...")
    entries = json.loads(POKEMON_DATA_JSON.read_text(encoding="utf-8"))
    if len(entries) != MAX_ID:
        raise SystemExit(f"FAIL: expected {MAX_ID} records, found {len(entries)}")

    by_id = {entry["id"]: entry for entry in entries}
    if sorted(by_id) != list(range(1, MAX_ID + 1)):
        raise SystemExit("FAIL: record ids are not exactly 1..1025")

    print(f"Fetching {len(DEXES)} pokedexes ...")
    started = time.monotonic()
    pokedexes = {}
    for slug, label in DEXES:
        pokedexes[slug] = get_pokedex(slug)
        print(f"  {slug:<16} {label:<6} {len(pokedexes[slug].get('pokemon_entries') or []):>5} entries")
    print(f"  fetched in {time.monotonic() - started:.1f}s")

    print("Building the positional species_name -> id table from the national dex ...")
    id_by_name = build_id_by_species_name(pokedexes["national"])

    # Merge. Iterate DEXES in render order so the stored dict is already ordered
    # and the page never has to sort by anything.
    unresolved: list[str] = []
    numbers: dict[int, dict[str, int]] = {pid: {} for pid in by_id}
    for slug, label in DEXES:
        for item in pokedexes[slug].get("pokemon_entries") or []:
            name = (item.get("pokemon_species") or {}).get("name")
            number = item.get("entry_number")
            if name is None or number is None:
                continue
            pid = id_by_name.get(name)
            if pid is None:
                unresolved.append(f"{slug}: {name}")
                continue
            numbers[pid][label] = number

    print("Validating ...")
    problems: list[str] = list(unresolved)
    if unresolved:
        problems.insert(0, f"{len(unresolved)} pokedex entries did not resolve to a known species")
    for pid, dex in numbers.items():
        if "全國" not in dex:
            problems.append(f"id {pid}: no 全國 entry, but the national dex covers all {MAX_ID}")
        if dex.get("全國") != pid:
            problems.append(f"id {pid}: 全國 says {dex.get('全國')!r}")
        for label, number in dex.items():
            # 0 is legal: Victini is 合眾 #000, because in Black/White it is
            # obtainable before the Pokedex and is listed ahead of #001.
            if not isinstance(number, int) or isinstance(number, bool) or number < 0:
                problems.append(f"id {pid}: {label} is not a non-negative int: {number!r}")
    if problems:
        for line in problems[:25]:
            print(f"  {line}", file=sys.stderr)
        if len(problems) > 25:
            print(f"  ... and {len(problems) - 25} more", file=sys.stderr)
        raise SystemExit(f"FAIL: {len(problems)} validation problem(s); nothing written")

    region_names = region_names_from_generations()
    dex_labels = {label for _, label in DEXES}
    missing_regions = sorted(region_names - dex_labels) if region_names else []
    if missing_regions:
        print(f"  FAIL: generations.json has region(s) with no dex: {missing_regions}", file=sys.stderr)
        raise SystemExit("FAIL: a region in generations.json has no pokedex; refusing to write")
    extra_labels = sorted(dex_labels - region_names - {"全國", "藍莓學園"}) if region_names else []
    covered = len(region_names & dex_labels)

    touched = 0
    for pid, entry in by_id.items():
        if entry.get("regional_dex") != numbers[pid]:
            touched += 1
        entry["regional_dex"] = numbers[pid]

    sizes = sorted({len(d) for d in numbers.values()})
    widest = max(numbers, key=lambda p: len(numbers[p]))
    print(f"  generations.json regions covered: {covered}/{len(region_names)}"
          + (f"   labels not a generations.json region (expected): {extra_labels}" if extra_labels else ""))
    print(f"  dexes per record: {sizes[0]}..{sizes[-1]}   most: id {widest} with {len(numbers[widest])}")
    print(f"  records with only 全國: {sum(1 for d in numbers.values() if len(d) == 1)}")
    zeroes = sorted((pid, lbl) for pid, d in numbers.items() for lbl, v in d.items() if v == 0)
    print(f"  #000 entries (Victini-style): {zeroes or 'none'}")
    print(f"  regional numbers span: "
          f"{min(v for d in numbers.values() for k, v in d.items() if k != '全國')}.."
          f"{max(v for d in numbers.values() for k, v in d.items() if k != '全國')}")
    print(f"  {touched} of {len(entries)} records changed")

    bulbasaur = by_id[1]["regional_dex"]
    print(f"  id 1 spot check: {bulbasaur}")

    if args.dry_run:
        print("  --dry-run, nothing written")
        return

    POKEMON_DATA_JSON.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"  wrote {POKEMON_DATA_JSON.relative_to(BASE)} ({POKEMON_DATA_JSON.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
