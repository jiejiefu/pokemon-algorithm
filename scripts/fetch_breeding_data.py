#!/usr/bin/env python3
"""
Fetch the two breeding fields the detail page needs and merge them into
assets/data/pokemon_data.json.

Reads:  assets/data/pokemon_data.json (1025 records)
Writes: assets/data/pokemon_data.json, in place, adding:
          gender_rate    int, eighths female, -1 when the species is genderless
          hatch_counter  int, total cycles (in-game "hatch counter" units)

Note on hatch_counter: do NOT assume it is 20 for a single-stage line and 35
for a two-stage one. Measured across the 1025 records it takes 11 distinct
values -- 5, 10, 15, 20, 25, 30, 35, 40, 50, 80, 120 -- and they track the
line's generation, not its stage count (Ho-Oh, Mew, Palkia and Terapagos all
carry 120, while Terapagos, a baby-adjacent single stage, carries 5). Store
whatever PokeAPI returns and only sanity-check that it is a positive int.

Why /pokemon-species/ and not /pokemon/:
    Both fields live on the species resource. /pokemon/ does not carry them at
    all, and it does not say so -- the keys are simply absent, so a script that
    reads them there gets None for all 1025 records and reports success. Always
    read these from pokemon-species/{id}.

Why in place, and not a separate file:
    Every page already loads pokemon_data.json (614 KB gzipped ~180 KB), so two
    small integers per record cost about 8 KB raw and need no extra request and
    no lazy loader. learnsets.json is 4.3 MB and earns a separate file with an
    IntersectionObserver; this does not.

Ordering:
    Run this AFTER enhance_pokemon_data.py, for the same reason descriptions
    are scraped after it. build_pokemon_entry() assembles a whitelist dict, so
    a Phase 1 re-run rebuilds every record from the CSVs and drops any key it
    does not name -- including these two. enhance_pokemon_data.py now carries
    them through from `existing`, so re-running the pair in order is safe, but
    running Phase 1 alone will still reset them to the defaults.

    The shiny toggle on the detail page is a CSS filter, not real artwork; this
    script deliberately fetches no artwork.
"""

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import httpx

BASE = Path(__file__).parent.parent
API = "https://pokeapi.co/api/v2"
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"

MAX_ID = 1025
MAX_RETRIES = 4
TIMEOUT = 30.0
MAX_WORKERS = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pokemon-algorithm/1.0)"}

client = httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS, http2=False)


def get_species(pid: int) -> dict:
    """GET one pokemon-species resource, retrying with linear backoff."""
    url = f"{API}/pokemon-species/{pid}"
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
    raise SystemExit(f"FAIL: could not fetch pokemon-species/{pid} after {MAX_RETRIES} tries: {last}")


def fetch_all(ids: list[int]) -> dict:
    """Fetch every species in parallel, preserving input order in the result."""
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        return dict(zip(ids, pool.map(get_species, ids)))


def validate(entries: list[dict], species_by_id: dict) -> None:
    """Fail loudly rather than write 1025 plausible-looking wrong values."""
    problems = []

    if len(entries) != MAX_ID:
        problems.append(f"expected {MAX_ID} records in pokemon_data.json, found {len(entries)}")

    for entry in entries:
        pid = entry["id"]
        species = species_by_id.get(pid)
        if species is None:
            problems.append(f"id {pid}: no species response")
            continue

        # gender_rate is eighths female: -1 is genderless, otherwise 0-8.
        rate = entry.get("gender_rate")
        if not isinstance(rate, int) or not -1 <= rate <= 8:
            problems.append(f"id {pid}: gender_rate out of range or wrong type: {rate!r}")
        elif rate != -1 and rate + (8 - rate) != 8:
            problems.append(f"id {pid}: gender split does not sum to 8: {rate}")

        if "gender_rate" not in species:
            problems.append(f"id {pid}: source has no gender_rate -- wrong endpoint?")

        counter = entry.get("hatch_counter")
        if not isinstance(counter, int) or counter <= 0:
            problems.append(f"id {pid}: hatch_counter not a positive int: {counter!r}")

    if problems:
        for line in problems[:25]:
            print(f"  {line}", file=sys.stderr)
        if len(problems) > 25:
            print(f"  ... and {len(problems) - 25} more", file=sys.stderr)
        raise SystemExit(f"FAIL: {len(problems)} validation problem(s); nothing written")


def main() -> None:
    print(f"Reading {POKEMON_DATA_JSON.relative_to(BASE)} ...")
    entries = json.loads(POKEMON_DATA_JSON.read_text(encoding="utf-8"))

    ids = [entry["id"] for entry in entries]
    print(f"Fetching pokemon-species/1..{MAX_ID} ({len(ids)} records) ...")
    started = time.monotonic()
    species_by_id = fetch_all(ids)
    print(f"  fetched in {time.monotonic() - started:.1f}s")

    touched = 0
    for entry in entries:
        species = species_by_id[entry["id"]]
        rate = species.get("gender_rate")
        counter = species.get("hatch_counter")
        if rate is None or counter is None:
            raise SystemExit(
                f"FAIL: id {entry['id']} came back without gender_rate/hatch_counter; "
                "pokemon-species/ is the wrong endpoint"
            )
        if entry.get("gender_rate") != rate or entry.get("hatch_counter") != counter:
            touched += 1
        entry["gender_rate"] = rate
        entry["hatch_counter"] = counter

    print("Validating ...")
    validate(entries, species_by_id)

    POKEMON_DATA_JSON.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    genderless = sum(1 for entry in entries if entry["gender_rate"] == -1)
    female_only = sum(1 for entry in entries if entry["gender_rate"] == 0)
    male_only = sum(1 for entry in entries if entry["gender_rate"] == 8)
    hatches = sorted({entry["hatch_counter"] for entry in entries})

    print(f"  {touched} of {len(entries)} records changed")
    print(f"  genderless (-1): {genderless}   female-only (0): {female_only}   male-only (8): {male_only}")
    print(f"  hatch_counter values present: {hatches}")
    print(f"  wrote {POKEMON_DATA_JSON.relative_to(BASE)} ({POKEMON_DATA_JSON.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
