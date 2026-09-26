#!/usr/bin/env python3
"""
Build the move learnsets for all 1025 Pokemon from PokeAPI

Source: PokeAPI (https://pokeapi.co) — /move, /pokemon, /machine, /version-group

InfoPoke is the layout reference for the detail page's four move tabs, but it is
not a usable data source. Its Nuxt 3 SSR snapshot carries a 684-byte
`__NUXT_DATA__` payload that is nothing but i18n config, and the level-up table
in the HTML holds only 6 rows while its own tab label claims 12 — the remaining
rows, and all of the machine/egg/tutor rows, are fetched by a private
client-side call. PokeAPI exposes all four learn methods structurally, so the
layout is imitated and the data is taken from the API.

PokeAPI returns Traditional Chinese move names natively (`names[].language.name
== "zh-hant"`), so nothing has to be scraped for the localisation.

  * 919 of the 937 moves carry a zh-hant name. The 18 that do not are the
    `shadow-*` block (ids 10001-10018, type "shadow"), untranslated even in
    ja/ko, and no core-game Pokemon learns them — the script fails loudly if
    that ever stops being true rather than shipping an English fallback.

  * `version_group_details` has no `machine` object, so TM/HM numbers are not
    obtainable from /pokemon. They are recovered by walking all 2372 /machine
    records into a (move, version group) -> machine_number index.

Scope decision: each tab is the UNION of that learn method across every
version group, because the current generation alone leaves two of the four tabs
empty for most Pokemon (Pikachu, Gengar, Mewtwo, Rayquaza and Dragapult all have
0 egg and 0 tutor moves in scarlet-violet). Level-up rows show the LOWEST level
the move was ever learned at.

A machine row carries the number the move held in the most recent version group
that still had it on a TM/HM/TR, *plus* that group's generation. The generation
is not decoration: TM numbering is per-game, so a union row has no single
correct number — Bulbasaur legitimately has three different moves that were each
"TM01", in three different generations. Emitting the number alone renders as
"TM01 TM01 TM01" down the column and reads as a bug, so the UI shows the number
and marks the rows that did not come from the newest tracked generation.

Output:
  assets/data/moves_zh.json  { id: { en, zh, type, class, power, accuracy } }
  assets/data/learnsets.json { id: { level, machine, egg, tutor } }

learnsets.json encodes each method as a compact array to keep the file small
(the union is ~100 rows per Pokemon across 1025 Pokemon):
  level   [[moveId, level], ...]     sorted by level, then move id
  machine [[moveId, number, gen], ...] sorted by number, then move id
  egg     [moveId, ...]              sorted by move id
  tutor   [moveId, ...]              sorted by move id
"""

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

BASE = Path(__file__).parent.parent
API = "https://pokeapi.co/api/v2"
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"
OUTPUT_MOVES = BASE / "assets" / "data" / "moves_zh.json"
OUTPUT_LEARNSETS = BASE / "assets" / "data" / "learnsets.json"

MAX_ID = 1025
PAGE_SIZE = 1000
MAX_RETRIES = 4
TIMEOUT = 30.0
MAX_WORKERS = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pokemon-algorithm/1.0)"}

# learn method -> learnsets.json key
METHODS = {"level-up": "level", "machine": "machine", "egg": "egg", "tutor": "tutor"}

# TM/HM/TR item names encode the in-game machine number: tm00, hm07, tr09.
MACHINE_ITEM = re.compile(r"^(?:tm|hm|tr)(\d+)$")

client = httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS, http2=False)


def get(path: str, **params) -> dict:
    """GET one PokeAPI resource, retrying with linear backoff.

    `path` may be a bare resource ("move/33") or one of the absolute URLs that
    the list endpoints hand back in their `url` fields.
    """
    url = path if path.startswith("http") else f"{API}/{path.lstrip('/')}"
    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url, params=params or None)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(0.6 * attempt)
    raise SystemExit(f"FAIL: could not fetch {path} after {MAX_RETRIES} tries: {last}")


def resource_id(url: str) -> int:
    return int(url.rstrip("/").split("/")[-1])


def list_all(path: str) -> List[dict]:
    """Follow a paginated list endpoint to the end and return every record."""
    out: List[dict] = []
    offset = 0
    while True:
        page = get(path, limit=PAGE_SIZE, offset=offset)
        results = page.get("results", [])
        out.extend(results)
        if len(results) < PAGE_SIZE or len(out) >= page.get("count", 0):
            return out
        offset += PAGE_SIZE


def paged(details: List[dict], label: str) -> List[dict]:
    """Fetch each record concurrently, reporting progress every 250 items."""
    done = 0
    out: List[dict] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for item in pool.map(lambda r: get(r["url"]), details):
            out.append(item)
            done += 1
            if done % 250 == 0 or done == len(details):
                print(f"  {label}: {done}/{len(details)}", flush=True)
    return out


def generation_number(name: str) -> int:
    """'generation-ix' -> 9."""
    match = re.fullmatch(r"generation-([ivx]+)", name)
    if not match:
        return 0
    return {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9}[match.group(1)]


def build_version_rank() -> Dict[int, Tuple[int, int, int]]:
    """Map version group id -> sort key, so 'most recent' is well defined.

    Sorted by generation, then the version group's own order field, then id.
    """
    groups = paged(list_all("version-group"), "version groups")
    rank: Dict[int, Tuple[int, int, int]] = {}
    for group in groups:
        gen = generation_number(group.get("generation", {}).get("name", ""))
        rank[group["id"]] = (gen, group.get("order") or 0, group["id"])
    return rank


def build_moves() -> Dict[int, dict]:
    """Fetch every move's definition plus its zh-hant name."""
    print("fetching moves", flush=True)
    moves = paged(list_all("move"), "moves")
    out: Dict[int, dict] = {}
    for move in moves:
        zh = next((n["name"] for n in move["names"] if n["language"]["name"] == "zh-hant"), None)
        out[move["id"]] = {
            "en": move["name"],
            "zh": zh,
            "type": move["type"]["name"],
            "class": move["damage_class"]["name"],
            "power": move.get("power"),
            "accuracy": move.get("accuracy"),
        }
    return out


def build_machine_numbers(vg_rank: Dict[int, Tuple[int, int, int]]) -> Dict[Tuple[int, int], str]:
    """(move id, version group id) -> machine code, from all /machine records.

    PokeAPI has no `machine_number` field; the number is only encoded in the
    item's name (`tm00`, `hm07`, `tr09`). The same item is reused across
    generations — item `tm01` is a different move in red-blue than in
    gold-silver — which is exactly the per-generation numbering we want, since
    the caller keeps the most recent version group for each move.

    The whole code is kept, not just the number, because the number alone is
    ambiguous: PokeAPI ships 8 HMs (hm01-hm08), 230 TMs (tm00-tm99) and 100 TRs
    (tr00-tr99), and the TR range overlaps the TM range entirely. Storing `9`
    would render `tr09` as "TM09". `item.name.upper()` is already the label a
    player sees on the machine, and is zero-padded by PokeAPI.
    """
    print("fetching machines", flush=True)
    machines = paged(list_all("machine"), "machines")
    table: Dict[Tuple[int, int], str] = {}
    unparsable = []
    for machine in machines:
        name = machine["item"]["name"]
        match = MACHINE_ITEM.match(name)
        if not match:
            unparsable.append(name)
            continue
        key = (resource_id(machine["move"]["url"]), resource_id(machine["version_group"]["url"]))
        table[key] = name.upper()
    if unparsable:
        raise SystemExit(
            f"FAIL: {len(unparsable)} machine items do not encode a TM/HM/TR number "
            f"(expected e.g. 'tm01'): {sorted(set(unparsable))[:10]}"
        )
    return table


def build_learnsets(
    moves: Dict[int, dict], machine_numbers: Dict[Tuple[int, int], str], vg_rank: Dict[int, Tuple[int, int, int]]
) -> Dict[int, dict]:
    """Union each learn method across every version group, per Pokemon."""
    print("fetching pokemon", flush=True)
    details = paged(list_all("pokemon"), "pokemon")
    by_id = {pokemon["id"]: pokemon for pokemon in details}
    missing = [i for i in range(1, MAX_ID + 1) if i not in by_id]
    if missing:
        raise SystemExit(f"FAIL: PokeAPI is missing pokemon ids {missing[:10]}")

    learnsets: Dict[int, dict] = {}

    for pid in range(1, MAX_ID + 1):
        pokemon = by_id[pid]
        # method key -> move id -> best value seen for that move
        picked: Dict[str, Dict[int, object]] = {key: {} for key in METHODS.values()}
        best_tm_rank: Dict[int, Tuple[Tuple[int, int, int], int, int]] = {}

        for entry in pokemon["moves"]:
            move_id = resource_id(entry["move"]["url"])
            for detail in entry["version_group_details"]:
                method = METHODS.get(detail["move_learn_method"]["name"])
                if method is None:
                    continue
                vg_id = resource_id(detail["version_group"]["url"])

                if method == "level":
                    level = detail.get("level_learned_at")
                    # A level of 0 means "not by levelling up"; the union wants
                    # the lowest level the move was genuinely taught at.
                    if not level:
                        continue
                    seen = picked["level"].get(move_id)
                    if seen is None or level < seen:
                        picked["level"][move_id] = level
                elif method == "machine":
                    number = machine_numbers.get((move_id, vg_id))
                    if number is None:
                        continue
                    rank = vg_rank.get(vg_id, (0, 0, vg_id))
                    current = best_tm_rank.get(move_id)
                    if current is None or rank > current[0]:
                        best_tm_rank[move_id] = (rank, number, rank[0])
                else:
                    picked[method][move_id] = True

        for move_id, (rank, number, gen) in best_tm_rank.items():
            picked["machine"][move_id] = (number, gen)

        learnsets[pid] = {
            "level": sorted(
                ([mid, lvl] for mid, lvl in picked["level"].items()),
                key=lambda row: (row[1], row[0]),
            ),
            "machine": sorted(
                ([mid, num, gen] for mid, (num, gen) in picked["machine"].items()),
                key=lambda row: (row[1], row[0]),
            ),
            "egg": sorted(picked["egg"]),
            "tutor": sorted(picked["tutor"]),
        }

    return learnsets


def referenced_move_ids(learnsets: Dict[int, dict]) -> set:
    """Every move id any tab points at, across both encodings."""
    used = set()
    for entry in learnsets.values():
        for method, rows in entry.items():
            for row in rows:
                # level/machine rows are [moveId, value]; egg/tutor are bare ids.
                used.add(row[0] if isinstance(row, list) else row)
    return used


def main() -> None:
    started = datetime.now(timezone.utc)
    vg_rank = build_version_rank()
    moves = build_moves()
    machine_numbers = build_machine_numbers(vg_rank)
    learnsets = build_learnsets(moves, machine_numbers, vg_rank)

    used = referenced_move_ids(learnsets)
    unknown = sorted(mid for mid in used if mid not in moves)
    if unknown:
        raise SystemExit(f"FAIL: learnsets reference unknown move ids {unknown[:10]}")

    untranslated = sorted(
        mid for mid in used if not moves[mid]["zh"]
    )
    if untranslated:
        names = ", ".join(moves[mid]["en"] for mid in untranslated)
        raise SystemExit(
            f"FAIL: {len(untranslated)} moves used by our Pokemon have no zh-hant name: {names}. "
            "Either PokeAPI dropped a translation or a non-core-game move became learnable; "
            "add an explicit override rather than shipping English."
        )

    # Only ship the moves our 1025 actually reference, so the zh-hant coverage
    # of this file is 100% by construction.
    move_out = {str(mid): moves[mid] for mid in sorted(used)}
    learnset_out = {str(pid): learnsets[pid] for pid in sorted(learnsets)}

    totals = {key: sum(len(e[key]) for e in learnsets.values()) for key in METHODS.values()}
    empty = {
        key: sum(1 for e in learnsets.values() if not e[key])
        for key in METHODS.values()
    }
    meta = {
        "source": API,
        "generated": started.replace(microsecond=0).isoformat(),
        "pokemon": len(learnset_out),
        "moves_referenced": len(move_out),
        "rows_per_method": totals,
        "pokemon_with_none": empty,
    }
    move_out["_meta"] = meta
    learnset_out["_meta"] = meta

    # indent=2 to match every other file in assets/data/. The compact
    # separators this started with produced a 1.2 MB single line, which git
    # can only ever show as one changed line -- any later edit to a single
    # learnset would rewrite the whole file and make the diff unreadable.
    # A trailing newline is likewise the convention in the tracked files.
    OUTPUT_MOVES.parent.mkdir(parents=True, exist_ok=True)
    for path, payload in ((OUTPUT_MOVES, move_out), (OUTPUT_LEARNSETS, learnset_out)):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print(f"\nversion groups   : {len(vg_rank)}")
    print(f"moves fetched    : {len(moves)}  referenced by our 1025: {len(used)}")
    print(f"machine records  : {len(machine_numbers)}")
    print(f"pokemon          : {len(learnsets)}")
    for key in METHODS.values():
        print(f"  {key:<8} rows: {totals[key]:>7}   pokemon with none: {empty[key]}")
    print(f"wrote {OUTPUT_MOVES.relative_to(BASE)} ({OUTPUT_MOVES.stat().st_size // 1024} KB)")
    print(f"wrote {OUTPUT_LEARNSETS.relative_to(BASE)} ({OUTPUT_LEARNSETS.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
