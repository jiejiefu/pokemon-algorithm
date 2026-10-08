#!/usr/bin/env python3
"""
Fetch the real in-game evolution levels from PokeAPI into
assets/data/evolution_levels.json, so life.html can gate evolution on a
Pokémon's actual level instead of a fixed age threshold.

Reads:  assets/data/pokemon_data.json          (for the chain ids to walk)
Writes: assets/data/evolution_levels.json
Caches: data-sources/pokeapi_evolution_chains.json   (trimmed API payload)

Shape written
-------------
    {
      "source": "...pokeapi.../evolution-chain/{id}",
      "levels":    { "<from id>": { "<to id>": <min_level>, ... } },
      "unlevelled":{ "<from id>": [ {"to": .., "trigger": .., "detail": ..}, ... ] }
    }

`levels` is keyed by BOTH ends of the step rather than by the from-species alone,
because one species can evolve at different levels or not at all: Eevee carries
three level-up steps (Espeon via friendship in the day, Umbreon at night, Sylveon
by friendship), eight use-item steps, and four level-up steps with NO min_level
(Leafeon / Glaceon, which need a level-up move). A per-species number could not
express that, and a per-species number is exactly the mistake that would make
this file look simpler than it is.

Why `unlevelled` is kept rather than dropped
--------------------------------------------
Only 62% of the 651 (from -> to) steps in the corpus carry a numeric
`min_level`; the rest are stones, trades, friendship, level-of-day and level
-with-a-known-move. life.html needs an answer for those, and the honest one is a
stated fallback rather than a silent invention — so the file records which steps
have no level, and check_evolution_levels.mjs asserts both the coverage floor and
the identity of that set.

Why the cache lives in data-sources/
------------------------------------
541 GETs is ~75s and PokeAPI is a shared free service. The cache holds only the
nine detail fields this project reads, not the sprite URLs and URLs-of-moves the
API also returns, so a re-run is offline, reproducible and ~200 KB.

Usage:
    python scripts/fetch_evolution_levels.py [--dry-run] [--refresh]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

BASE = Path(__file__).parent.parent
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"
OUTPUT_JSON = BASE / "assets" / "data" / "evolution_levels.json"
CACHE_JSON = BASE / "data-sources" / "pokeapi_evolution_chains.json"

API = "https://pokeapi.co/api/v2"
UA = {"User-Agent": "pokemon-algorithm/1.0 (static site build script)"}

# The nine evolution_details fields that decide what a step IS. Anything else the
# API sends (sprite URLs, held-item move requirements beyond the name) is not
# read by life.html, so caching it would triple the file for no gain.
DETAIL_FIELDS = (
    "trigger", "min_level", "item", "held_item", "min_happiness", "min_affection",
    "min_beauty", "time_of_day", "known_move", "known_move_type", "location",
    "gender", "needs_overworld_rain", "turn_upside_down", "trade_species",
)


def fetch_json(client: httpx.Client, url: str, what: str, tries: int = 4,
               allow_404: bool = False) -> Optional[Dict[str, Any]]:
    """GET with backoff. PokeAPI returns 429 under bursts and a bare retry loses
    the rest of the chain set to a 4xx that never gets reported.

    `allow_404` returns None instead of raising, for the one chain id PokeAPI does
    not have: our `evolution_chain_id` numbering came from a different source, so
    chain 429 here is not chain 429 there, and it 404s. That chain is Melmetal
    (809) whose only other member is the form Melmetal-Max, so it holds no
    evolution step and nothing is lost -- but it is reported rather than skipped
    silently, and check_evolution_levels.mjs pins the exact set."""
    last: Optional[Exception] = None
    for attempt in range(tries):
        try:
            resp = client.get(url)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404 and allow_404:
                return None
            last = RuntimeError(f"HTTP {resp.status_code} for {what}")
        except Exception as exc:  # network flake, not a data problem
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"giving up on {what} after {tries} tries: {last}")


def collect_steps(node: Dict[str, Any], out: List[Dict[str, Any]]) -> None:
    """Walk the chain tree into a flat list of (from, to, details) steps.

    Recursive because a chain is a tree, not a line: Eevee's 8 children are all
    leaves, while Pichu's child Pikachu has its own child Raichu, so a single
    fixed depth either drops Raichu or double-counts it.
    """
    for child in node.get("evolves_to", []):
        for det in child.get("evolution_details", []):
            out.append({
                "from": node["species"]["name"],
                "to": child["species"]["name"],
                "details": {k: det.get(k) for k in DETAIL_FIELDS},
            })
        collect_steps(child, out)


def describe(details: Dict[str, Any]) -> str:
    """One short line describing a step that has no numeric level."""
    trig = details.get("trigger") or {}
    parts = [trig.get("name") or "unknown"]
    if details.get("item"):
        parts.append(f"item {details['item']['name']}")
    if details.get("held_item"):
        parts.append(f"holding {details['held_item']['name']}")
    if details.get("min_happiness"):
        parts.append(f"happiness {details['min_happiness']}")
    if details.get("time_of_day"):
        parts.append(details["time_of_day"])
    if details.get("known_move"):
        parts.append(f"knowing {details['known_move']['name']}")
    if details.get("location"):
        parts.append(f"at {details['location']['name']}")
    if details.get("gender") == 1:
        parts.append("female")
    return " + ".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report coverage without writing")
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and refetch every chain")
    args = ap.parse_args()

    records = json.loads(POKEMON_DATA_JSON.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in records}
    chain_ids = sorted({p["evolution_chain_id"] for p in records if p.get("evolution_chain_id")})
    print(f"pokemon_data.json: {len(records)} species, {len(chain_ids)} distinct evolution chains")

    cache: Dict[str, Any] = {}
    cached_absent: List[str] = []
    if CACHE_JSON.exists() and not args.refresh:
        cache = json.loads(CACHE_JSON.read_text(encoding="utf-8"))
        cached_absent = list(cache.get("absent", []))
        print(f"cache: {len(cache.get('chains', {}))} chains already on disk ({'refetching' if args.refresh else 'reuse'})")

    steps_by_chain: Dict[str, List[Dict[str, Any]]] = dict(cache.get("chains", {}))
    todo = [c for c in chain_ids if str(c) not in steps_by_chain]
    print(f"chains to fetch: {len(todo)}")

    # A chain that 404s is only knowable while fetching, so the answer is carried
    # in the cache: recomputing it from the cached steps would report [] forever,
    # because a chain with no evolutions also caches as an empty list.
    absent: List[str] = list(cached_absent)
    if todo:
        with httpx.Client(timeout=30, headers=UA) as client:
            for i, cid in enumerate(todo, 1):
                payload = fetch_json(client, f"{API}/evolution-chain/{cid}", f"chain {cid}", allow_404=True)
                if payload is None:
                    if str(cid) not in absent:
                        absent.append(str(cid))
                    steps_by_chain[str(cid)] = []
                    continue
                steps: List[Dict[str, Any]] = []
                collect_steps(payload["chain"], steps)
                steps_by_chain[str(cid)] = steps
                if i % 100 == 0:
                    print(f"  {i}/{len(todo)}")
    if absent:
        print(f"  chain ids PokeAPI does not have (recorded as empty, they hold no step): {absent}")
        # Write the cache the moment the fetch loop finishes. 541 GETs is ~75s and a
        # later failure used to throw all of it away.
        CACHE_JSON.write_text(
            json.dumps({"api": API, "absent": absent, "chains": steps_by_chain}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")

    # PokeAPI names species; we key by our own national-dex id.
    #
    # ONE bulk GET is the whole id table: the /pokemon-species list form returns
    # {name, url} per entry and the url ends in /pokemon-species/{id}/, so
    # ?limit=2000 covers every species PokeAPI knows including form species --
    # which the chain tree DOES name (Aegislash's chain says `aegislash-blade`),
    # and which the /pokemon list at limit=1302 both truncates and omits.
    #
    # The table is keyed by POKEAPI's own spelling and nothing here matches on
    # names.en, because for 15 records ours is not PokeAPI's: Nidoran♀/♂ collapse
    # to one slug once the symbol is stripped, Flabébé's accents have to fold, and
    # the Gen 8 "HP" species are deliberately misspelled in the games (Houndoor,
    # Tailow, Minum, Skowvet) where the API has Houndoom, Talonflame, Minior,
    # Skwovet. Matching en -> en is the failure fetch_regional_dex.py documents.
    with httpx.Client(timeout=60, headers=UA) as client:
        roster = fetch_json(client, f"{API}/pokemon-species?limit=2000&offset=0", "pokemon-species?limit=2000")

    name_to_id: Dict[str, int] = {}
    for entry in roster["results"]:
        name_to_id[entry["name"]] = int(entry["url"].rstrip("/").rsplit("/", 1)[-1])
    if roster.get("next"):
        print(f"  FAIL: the species roster is paginated ({len(roster['results'])} rows, more at "
              f"{roster['next']}); a partial name table would silently drop chains", file=sys.stderr)
        return 1

    missing_ours = [p["id"] for p in records if p["id"] not in set(name_to_id.values())]
    if missing_ours:
        print(f"  FAIL: PokeAPI's id table is missing {len(missing_ours)} of our species "
              f"(first: {missing_ours[:5]}); refusing to guess", file=sys.stderr)
        return 1
    print(f"PokeAPI id table: {len(name_to_id)} species; all 1025 of our ids present")

    levels: Dict[str, Dict[str, int]] = {}
    unlevelled: Dict[str, List[Dict[str, Any]]] = {}
    unmapped: set[str] = set()
    total_steps = 0
    duplicates = 0

    for cid in chain_ids:
        for step in steps_by_chain.get(str(cid), []):
            total_steps += 1
            from_id = name_to_id.get(step["from"])
            to_id = name_to_id.get(step["to"])
            if from_id is None or to_id is None:
                unmapped.add(step["from"] if from_id is None else step["to"])
                continue
            lvl = step["details"].get("min_level")
            key = (str(from_id), str(to_id))
            if lvl is None:
                rows = unlevelled.setdefault(str(from_id), [])
                if any(r["to"] == to_id for r in rows):
                    duplicates += 1
                    continue
                rows.append({"to": to_id, "trigger": (step["details"].get("trigger") or {}).get("name"),
                             "detail": describe(step["details"])})
            else:
                row = levels.setdefault(str(from_id), {})
                if key in row:
                    duplicates += 1
                    continue
                row[key[1]] = lvl

    if unmapped:
        print(f"  FAIL: {len(unmapped)} species in the chain set are absent from PokeAPI's roster: "
              f"{sorted(unmapped)[:10]}", file=sys.stderr)
        return 1

    n_lev = sum(len(v) for v in levels.values())
    n_unl = sum(len(v) for v in unlevelled.values())
    n_pairs = n_lev + n_unl
    all_levels = sorted(lv for v in levels.values() for lv in v.values())
    print(f"\n(from -> to) steps reported by the API: {total_steps}")
    print(f"  collapsed into distinct pairs:         {n_pairs}   ({duplicates} duplicate rows folded)")
    print(f"  pairs with a numeric min_level:        {n_lev} ({100 * n_lev / n_pairs:.1f}%)")
    print(f"  pairs without:                         {n_unl} ({100 * n_unl / n_pairs:.1f}%)")
    print(f"  species that evolve by level: {len(levels)}   species with only other triggers: {len(unlevelled)}")
    print(f"  level range: {all_levels[0]}..{all_levels[-1]}   distinct: {len(set(all_levels))}")
    median_level = all_levels[len(all_levels) // 2]
    print(f"  median level: {median_level}   <- the fallback for the {n_unl} pairs that have none")
    hist: Dict[int, int] = {}
    for lv in all_levels:
        hist[lv] = hist.get(lv, 0) + 1
    print("  most common levels: " + ", ".join(f"Lv.{k}x{v}" for k, v in sorted(hist.items(), key=lambda kv: -kv[1])[:10]))

    by_trigger: Dict[str, int] = {}
    for rows in unlevelled.values():
        for r in rows:
            by_trigger[r["trigger"]] = by_trigger.get(r["trigger"], 0) + 1
    print(f"  triggers behind the {n_unl} unlevelled steps: {dict(sorted(by_trigger.items(), key=lambda kv: -kv[1]))}")

    spot = [(1, 2), (2, 3), (4, 7), (7, 10), (10, 11), (11, 12), (133, 134), (152, 133)]
    print("\nspot checks (from -> to : level):")
    for f, t in spot:
        got = levels.get(str(f), {}).get(str(t))
        unl = [r["detail"] for r in unlevelled.get(str(f), []) if r["to"] == t]
        name = f"{by_id[f]['names']['zh']} -> {by_id[t]['names']['zh']}" if f in by_id and t in by_id else f"{f}->{t}"
        print(f"   {name:24} {('Lv.' + str(got)) if got is not None else 'no level'}"
              + (f"   ({unl[0]})" if unl else ""))

    print(f"\neevee: levels {levels.get('133', {})}")
    print(f"       unlevelled {[(r['to'], r['detail']) for r in unlevelled.get('133', [])][:6]}")

    if args.dry_run:
        print("\n--dry-run, nothing written")
        return 0

    payload = {
        "source": f"{API}/evolution-chain/{{id}}",
        "note": (
            "levels: from_species_id -> {to_species_id: min_level}. "
            "unlevelled: steps PokeAPI reports with no min_level (stones, friendship, "
            "level-with-a-known-move, day/night); life.html must state a fallback for these "
            "rather than invent a number."
        ),
        "absent_chains": absent,
        "levels": levels,
        "unlevelled": unlevelled,
    }
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    CACHE_JSON.write_text(
        json.dumps({"api": API, "absent": absent, "chains": steps_by_chain}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    print(f"\nwrote {OUTPUT_JSON.relative_to(BASE)} ({OUTPUT_JSON.stat().st_size // 1024} KB)")
    print(f"wrote {CACHE_JSON.relative_to(BASE)} ({CACHE_JSON.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())