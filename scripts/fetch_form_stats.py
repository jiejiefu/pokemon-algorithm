#!/usr/bin/env python3
"""
Fetch every battle-form's OWN types and base stats from PokeAPI into
data-sources/pokeapi_form_stats.json.

Reads:  assets/data/pokemon_data.json
        assets/data/evolution_chains.json
        assets/images/pokemon/            (which form ids we actually ship art for)
Writes: data-sources/pokeapi_form_stats.json
        (assets/data/graph_data.json is NOT written here -- build_graph_data.py reads
         this cache and is the only thing that rebuilds the graph)

Why this exists
---------------
build_graph_data.py used to copy the BASE species' `types` onto every form node.
That is wrong in a way the page renders silently: `Charizard-Mega-X` was drawn as
Fire/Flying, when the whole point of the form is that it is Fire/**Dragon**. The
same copy gave every form the base's `stats`, so the dossier's six bars showed
Venusaur's numbers on `Venusaur-Gmax`.

It was never caught because the values were plausible rather than absent: a wrong
type still colours the node and still passes the type filter, it is just the wrong
colour. 17 of the 93 mega forms actually change type, so 76 looked right by
accident -- which is the worst ratio for a defect of this class.

Why `/pokemon/{id}` and not `/pokemon-form/{id}`
-----------------------------------------------
`/pokemon-form/` returns `types` but has NO `stats` key at all (measured, not
assumed -- every one of the 127 forms answers 200 with `types` and without
`stats`). `/pokemon/{id}` answers both and takes the same id, so one request per
form covers the two fields that matter.

Why there is no generation
--------------------------
`/pokemon/{id}` has no `generation` field, and `game_indices` comes back as an
empty array for every battle-only form (measured on all 181). So the generation of
a form node is left as the base species' generation rather than invented. That is
wrong for Gmax (a Galarian-origin form's base may be Gen 1) and it is documented
in build_graph_data.py rather than patched over.

The REGIONAL family is included for a different reason than the other two
--------------------------------------------------------------------
Mega and Gmax forms were added because their base's types are wrong. Regional
forms needed it too, and by a wider margin: 53 of the 54 differ from the base,
because a regional form is a DIFFERENT creature wearing the same slot. Alolan
Rattata is Dark/Normal and Rattata is Normal; Galarian Meowth is Steel and Meowth
is Psychic. The one that does not differ is Paldean Wooper, which is Ground — and
Wooper already is.

Its ids happen to line up with this project's, which was worth checking rather
than assuming: `/pokemon/rattata-alola/` answers id 10091, which is our
Rattata-Alola node. That is NOT true of the other endpoint -- `/pokemon-form/
10091/` answers `vivillon-elegant` -- so the two endpoints keep separate id
sequences upstream and only `/pokemon/` matches ours.

What this does NOT carry
------------------------
The REGION. `regional_clade` groups by alola/galar/hisui/paldea, and that comes
from the `variants` key in evolution_chains.json rather than from here, because
PokeAPI spells it inside the form NAME (`rattata-alola`) and a name is not a field.
Parsing a region back out of a slug would be a guess dressed as a lookup; the
key is already sitting there and was being thrown away.

Meowstic-Mega does not exist
----------------------------
Our `evolution_chains.json` carries `Meowstic-Mega` (id 10314) with artwork, and
PokeAPI has no such form: id 10314 answers 200 as `meowstic-male-mega`, with
`order: -1` and Meowstic's physical stats (74/48/76) bolted onto a different
special spread. Meowstic has never had a Mega Evolution.

**HTTP 200 is therefore not evidence that the form exists**, and the check is the
form NAME, not the status code:

    slug(our name_en) == upstream name

Id 10314 answers 200 as `meowstic-male-mega` -- a different form wearing the id we
asked for -- and a 200 that is the wrong answer is worse than a 404, because a 404
is visible.

  * `order == -1` looks like it should also disqualify an entry, and **it does not**:
    measured across the mega/gmax families it rejected 79 legitimate ones, because
    PokeAPI's `order` is a position within the species' own form list and Gen 7/8
    forms genuinely sit at -1. Every one of the 34 Gmax forms and all 45 Gen 7/8
    megas have it. It was tried, it was measured, and it was deleted -- a heuristic
    that rejects two thirds of the truth teaches a reader to ignore it.

Usage:
    python scripts/fetch_form_stats.py [--dry-run] [--refresh]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

BASE = Path(__file__).parent.parent
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"
EVOLUTION_CHAINS_JSON = BASE / "assets" / "data" / "evolution_chains.json"
FORM_IMAGE_DIR = BASE / "assets" / "images" / "pokemon"
CACHE_JSON = BASE / "data-sources" / "pokeapi_form_stats.json"

API = "https://pokeapi.co/api/v2"
UA = {"User-Agent": "pokemon-algorithm/1.0 (static site build script)"}

# Only these form families are fetched. `other` (117 nodes: Oricorio, Minior,
# Greninja-Ash, Zygarde-Complete, Palafin-Hero...), `totem`, `cap` and `primal`
# carry the base's own types in every case PokeAPI publishes, so fetching them
# would be 150 GETs that cannot change an answer. The Mega, Gmax and Regional
# families are exactly the ones where the base's types are known to be the wrong
# answer -- 17 of 93 mega forms change type, and 53 of 54 regional forms do.
FETCHED_FORMS = ("mega", "gmax", "regional")


def collect_form_ids() -> List[Dict[str, Any]]:
    """Every form id we ship artwork for whose family is in FETCHED_FORMS."""
    chains = json.loads(EVOLUTION_CHAINS_JSON.read_text(encoding="utf-8"))
    art_ids = {int(p.stem) for p in FORM_IMAGE_DIR.glob("*.png")}

    found: Dict[int, Dict[str, Any]] = {}

    def record(item: Any, family: Optional[str]) -> None:
        """`family` is the CONTAINER's name and is authoritative.

        This took one wrong turn. An earlier version preferred the item's own `form`
        over the container, which collected 127 of the 181 forms and reported no
        error: for `special_forms` the two agree (`{'mega': [...]}` items all say
        `form: 'mega'`), so the preference looked harmless. It is not for
        `variants`, which is keyed by REGION -- `{alola: [{..., 'form': 'alola'}]}`
        -- so 'alola' is not in FETCHED_FORMS and all 54 regional forms were
        silently skipped. A collection step that reports a plausible count rather
        than the count you asked for is the worst kind of quiet."""
        if not isinstance(item, dict):
            return
        fid = item.get("id")
        if not isinstance(fid, int) or fid <= 1025 or fid not in art_ids:
            return
        fam = (family or "").lower()
        if fam not in FETCHED_FORMS:
            return
        found.setdefault(fid, {
            "id": fid,
            "base_id": item.get("base_id"),
            "name_en": item.get("name_en"),
            "family": fam,
        })

    for chain in chains.values():
        # main_line carries no container name, so the item's own `form` is the only
        # thing there is -- and it IS the family there (mega / gmax / primal).
        for item in chain.get("main_line", []):
            record(item, item.get("form"))
        # `variants` is keyed by region. The family is always `regional`; the key is
        # the REGION and build_graph_data.py reads it from here, because the cache
        # has no business deriving a region out of a slug.
        for _region, group in chain.get("variants", {}).items():
            if isinstance(group, list):
                for item in group:
                    record(item, "regional")
            elif isinstance(group, dict):
                record(group, "regional")
        for family, group in chain.get("special_forms", {}).items():
            if isinstance(group, list):
                for item in group:
                    record(item, family)
            elif isinstance(group, dict):
                record(group, family)

    return sorted(found.values(), key=lambda f: f["id"])


def form_slug(name: str) -> str:
    """`Charizard-Mega-X` -> `charizard-mega-x`, matching PokeAPI's form names.

    Same normalisation get_slug() uses in build_graph_data.py, so a mismatch here
    means the upstream entry really is a different form and not a spelling
    difference."""
    slug = name.lower().strip()
    return slug.replace(" ", "-").replace("'", "").replace(".", "")


def fetch_one(client: httpx.Client, form: Dict[str, Any], tries: int = 4) -> Dict[str, Any]:
    """GET /pokemon/{id} and keep only the two fields this project reads.

    A 200 is NOT accepted as proof the form exists -- see the Meowstic-Mega note
    in the module docblock. The test is the upstream form NAME, because PokeAPI
    answers 200 with a different form for an id we do not have."""
    url = f"{API}/pokemon/{form['id']}/"
    last: Optional[Exception] = None
    for attempt in range(tries):
        try:
            resp = client.get(url)
            if resp.status_code == 404:
                return {**form, "found": False, "reason": "HTTP 404"}
            if resp.status_code == 200:
                payload = resp.json()
                upstream = payload.get("name") or ""
                if form_slug(form["name_en"] or "") != upstream:
                    return {**form, "found": False, "name_en_upstream": upstream,
                            "reason": f"id answers as a different form ({upstream})"}
                return {
                    **form,
                    "found": True,
                    "name_en_upstream": upstream,
                    "types": [t["type"]["name"] for t in payload.get("types", [])],
                    "stats": {s["stat"]["name"]: s["base_stat"] for s in payload.get("stats", [])},
                }
            last = RuntimeError(f"HTTP {resp.status_code}")
        except Exception as exc:
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"giving up on form {form['id']} ({form['name_en']}): {last}")


def capitalise(name: str) -> str:
    """PokeAPI returns lowercase type names; the project's tables use Title Case
    (`type_colors` in build_graph_data.py is keyed 'Fire', 'Psychic', ...)."""
    return name[:1].upper() + name[1:]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be fetched and write nothing")
    ap.add_argument("--refresh", action="store_true",
                    help="ignore the cache and refetch every form")
    args = ap.parse_args()

    forms = collect_form_ids()
    by_family: Dict[str, int] = {}
    for f in forms:
        by_family[f["family"]] = by_family.get(f["family"], 0) + 1
    print(f"forms to fetch: {len(forms)}  {by_family}")

    cache: Dict[str, Any] = {}
    if CACHE_JSON.exists() and not args.refresh:
        cache = json.loads(CACHE_JSON.read_text(encoding="utf-8")).get("forms", {})
        print(f"cache: {len(cache)} forms already on disk "
              f"({'refetching' if args.refresh else 'reuse'})")

    todo = [f for f in forms if str(f["id"]) not in cache or not cache[str(f["id"])].get("found")]
    if args.refresh:
        todo = list(forms)

    if args.dry_run:
        cached_hits = len(forms) - len(todo)
        print(f"would fetch {len(todo)}, reuse {cached_hits}")
        print("no writes in --dry-run")
        return 0

    results: Dict[str, Any] = {}
    if todo:
        with httpx.Client(headers=UA, timeout=30.0) as client:
            with ThreadPoolExecutor(max_workers=6) as pool:
                for i, record in enumerate(pool.map(lambda f: fetch_one(client, f), todo), 1):
                    results[str(record["id"])] = record
                    if i % 25 == 0:
                        print(f"  {i}/{len(todo)}")

    merged: Dict[str, Any] = {}
    for form in forms:
        rec = results.get(str(form["id"])) or cache.get(str(form["id"]))
        if rec is None:
            continue
        if rec.get("found") and rec.get("types"):
            # PokeAPI returns lowercase type names; the project's tables are Title
            # Case (`type_colors` in build_graph_data.py is keyed 'Fire', not 'fire'),
            # so the capitalisation happens ONCE here rather than in every reader.
            rec = {**rec, "types": [capitalise(t) for t in rec["types"]]}
        merged[str(form["id"])] = rec

    # Written AFTER the merge, not after the fetch loop. An earlier draft wrote
    # `results` at the end of the loop and built `merged` afterwards without ever
    # saving it, which meant the file on disk carried lowercase types while the
    # capitalisation existed only in a local variable -- so a re-run's `--dry-run`
    # reported "reuse" against a file that was not the one the reader expected.
    CACHE_JSON.write_text(
        json.dumps({"api": API, "forms": merged}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    missing = [r for r in merged.values() if not r.get("found")]
    print(f"\ncache written: {CACHE_JSON.relative_to(BASE)}  ({len(merged)} forms)")
    print(f"fetched {len(merged) - len(missing)} / {len(merged)}")
    if missing:
        print(f"\n{len(missing)} form(s) NOT a real PokeAPI form -- reported, not silently skipped:")
        for r in missing:
            print(f"  #{r['id']:>6} {r['name_en']} (base #{r['base_id']}): {r.get('reason')}")
        print("\nbuild_graph_data.py falls these back to the base species' values, and\n"
              "check_graph_chip_network.mjs asserts the exact set, so a new one cannot\n"
              "appear without a checker failing.")

    return 0


if __name__ == "__main__":
    sys.exit(main())