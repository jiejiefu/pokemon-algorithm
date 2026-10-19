#!/usr/bin/env python3
"""Fetch ability detail -> assets/data/abilities.json + assets/data/ability_species.json

Why this exists
---------------
fetch_abilities.py already fetched abilities_zh.json, which is NAMES ONLY — a
`{en, zh}` pair per ability slug. A reader who opens 威嚇 is owed the sentence
that says what it does, and that sentence does not exist anywhere in the repo.
types.html shows effect text for 74 abilities today, but it gets them from
type_profiles.json's per-type scrape rather than from an ability table, so they
are scattered across 18 files and reachable only by knowing the type first.

Two outputs, both keyed by PokeAPI's ability slug, because the slug is what the
URL carries (`ability.html?ability=intimidate`) and what abilities_zh.json and
type_profiles.json already key on.

  abilities.json       one row per ability: names, effect, provenance, counts
  ability_species.json slug -> the Pokemon that hold it, split by hidden flag
  species_abilities.json dex id -> that Pokemon's names + its ability slugs

Why a third file, which is derivable from the second
---------------------------------------------------
abilities.html answers the REVERSE question — 「威嚇有誰能持有」 — and the
only table that carries it is keyed by ability, so the browser would have to
download 388 KB and invert 1,025 species at page load. `pokemon_data.json` is not
an alternative: it is 2.8 MB and carries no ability slugs.

This file is the inverse, written by the SAME pass that writes the other two, so
it cannot disagree with ability_species.json about which species exist or which
slot an ability sits in. Measured 93 KB against 388 KB, and it drops the per-row
name fields (each species appeared once per ability it holds) while storing NO
ability names at all — the page already has all 314 in abilities.json.

Only `inRoster` rows go in, keyed by `baseId`. That is what makes it a 1,025-row
index rather than a 1,350-row one: a forme-exclusive holder (Gyarados' forme
records, Meowstic-Mega) is folded onto the base species it belongs to.

Why BOTH, and why the second one is not derived from pokemon_data.json
-----------------------------------------------------------------------
The ability roster is 374 abilities but our own pokemon_data.json references
only 284. The 90 that are missing are FORM-exclusive ones — 原始大地 belongs to
Primal Groudon, 對決 to Mega Evolutions, battle-bond to Greninja-Ash — and
pokemon_data.json cannot supply them: Groudon and Zacian both carry `forms: []`,
and even where a form record exists (Gyarados) it has no `abilities` field. So
the holder map is read from PokeAPI's `ability[].pokemon[]` and never inverted
from our roster.

A holder that is not a roster species is resolved through `/pokemon/{name}`,
which reports `species.name` authoritatively. Stripping a `-primal` suffix off
the name and hoping would be the same class of guess this project keeps refusing
(see the type-chart note in fetch_abilities.py), so the string surgery never
happens here — the qualifier is READ OFF the response instead.

Effect text: zh-hant first
--------------------------
PokeAPI's `effect_entries` are English-only, so the flavour entries are the
Traditional source, exactly as they are for moves (fetch_moves.py: ids 1-826).
Anything with no zh-hant falls back to OpenCC `s2twp` over PokeAPI's own
zh-hans, and a row that has neither ships `effect: null` — NOT a blank string and
never a hand-written or English-fallback sentence. check_abilities_data.mjs
pins the three counts against each other so the floor cannot drift.

Provenance: https://pokeapi.co/api/v2/ability
Run: source ../.venv/bin/activate && python scripts/fetch_abilities_detail.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
import opencc

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "assets" / "data"
ABILITIES_OUT = DATA / "abilities.json"
SPECIES_OUT = DATA / "ability_species.json"
SPECIES_INDEX_OUT = DATA / "species_abilities.json"
POKEMON_DATA = DATA / "pokemon_data.json"

API = "https://pokeapi.co/api/v2"
PAGE_SIZE = 100
MAX_RETRIES = 4
TIMEOUT = 30.0
MAX_WORKERS = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pokemon-algorithm/1.0)"}

# zh-hant flavour text exists across several version groups and they do not
# always word the same effect identically. A preference order, not an
# assumption of completeness — see the identical constant in fetch_moves.py.
FLAVOUR_VG_PREFERENCE = (
    "scarlet-violet",
    "sword-shield",
    "lets-go-pikachu-lets-go-eevee",
    "ultra-sun-ultra-moon",
    "sun-moon",
)

# Ids at or above this are PokeAPI's internal block: no name in any language,
# no effect text in any language, and no Pokemon anywhere in the API as a
# holder. They are the ability-side twin of fetch_moves.py's SHADOW_BLOCK_START,
# and they are excluded for the same reason — a catalogue row with no name, no
# description and no holder is a blank rectangle, not a database entry, and
# shipping 60 of them would put a 16% hole in the page whose entire subject is
# the description.
#
# Excluded BY ID, and the reason is what gets asserted: check_abilities_data.mjs
# requires every ability at or above this line to still be unnameable, unheld
# and unflavoured, so it goes red the day one of those stops being true and the
# block would have to be re-admitted rather than silently dropped again.
INTERNAL_BLOCK_START = 10001

client = httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS, http2=False)


def get(path: str, **params) -> dict:
    """GET one PokeAPI resource, retrying with linear backoff."""
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
    """Fetch each record concurrently, reporting progress every 100 items."""
    done = 0
    out: List[dict] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for item in pool.map(lambda r: get(r["url"]), details):
            out.append(item)
            done += 1
            if done % 100 == 0 or done == len(details):
                print(f"  {label}: {done}/{len(details)}", flush=True)
    return out


def flatten_text(text: Optional[str]) -> Optional[str]:
    """Collapse a flavour entry's whitespace to single spaces.

    PokeAPI uses `\\n` for the in-game line break; 威嚇's zh-hant entry arrives as
    「出場時威嚇對手，\\n使其退縮，\\n從而降低對手的攻擊。」 and a raw newline inside a
    JSON string renders as a single collapsed line in HTML anyway, but the page
    measures and sorts these, so the stored form is the normalised one.
    """
    if text is None:
        return None
    return " ".join(text.split())


def generation_number(name: str) -> int:
    """'generation-ix' -> 9."""
    match = re.fullmatch(r"generation-([ivx]+)", name)
    if not match:
        return 0
    return {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9}[match.group(1)]


def zh_flavour(ability: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(text, language, version_group) for the best available Chinese flavour entry.

    zh-hant is preferred outright and the preference is a hard one: converting
    the zh-hant text through OpenCC would change official Taiwanese wording away
    from itself, which is the finding fetch_moves.py documents for 18 of its 826
    rows. So s2twp only ever runs on PokeAPI's zh-hans.
    """
    for lang in ("zh-hant", "zh-hans"):
        entries = [e for e in ability["flavor_text_entries"] if e["language"]["name"] == lang]
        if not entries:
            continue
        by_vg = {e["version_group"]["name"]: e for e in entries}
        for vg in FLAVOUR_VG_PREFERENCE:
            if vg in by_vg:
                return flatten_text(by_vg[vg]["flavor_text"]), lang, vg
        first = entries[0]
        return flatten_text(first["flavor_text"]), lang, first["version_group"]["name"]
    return None, None, None


def en_short_effect(ability: dict) -> Optional[str]:
    """PokeAPI's English `short_effect` — the upstream sentence, kept SEPARATE.

    This is §3.D's `blurbEn` / `entriesEn` rule applied to abilities: 107 of the
    374 have no Chinese effect text at all (63 have no Chinese NAME either), so
    something has to render in that slot. Merging English into `effect` would
    pass it off as ours, and shipping the row blank would print nothing on 28.6%
    of a page whose entire reason for existing is the sentence. So it is its
    own field and the page shows it in a collapsed block labelled as upstream
    English — never inside the zh body.
    """
    hit = next((e for e in ability["effect_entries"] if e["language"]["name"] == "en"), None)
    if not hit:
        return None
    return flatten_text(hit.get("short_effect")) or flatten_text(hit.get("effect"))


def zh_name(ability: dict) -> Optional[str]:
    """The official Traditional Chinese ability name.

    The language key is lowercase `zh-hant` — the capitalised `zh-Hant` reads as
    correct and returns null, which is how "PokeAPI has no Chinese ability
    names" was nearly concluded twice. fetch_abilities.py documents the same
    trap for the same field.
    """
    for lang in ("zh-hant", "zh-hans"):
        hit = next((n for n in ability["names"] if n["language"]["name"] == lang), None)
        if hit:
            return hit["name"]
    return None


def en_name(ability: dict) -> Optional[str]:
    hit = next((n for n in ability["names"] if n["language"]["name"] == "en"), None)
    return hit["name"] if hit else None


def roster_slugs() -> Dict[str, int]:
    """PokeAPI pokemon name -> our roster id, for every species we carry.

    Keyed by `names.en` verbatim, which is the same string PokeAPI uses for all
    but 14 species. Those 14 are NOT special-cased here: `resolve_forms()`
    catches every name this map misses and resolves it by `species.id` instead,
    so the miss is a second pass rather than a wrong answer.
    """
    data = json.loads(POKEMON_DATA.read_text(encoding="utf-8"))
    return {entry["names"]["en"].lower(): entry["id"] for entry in data}


def roster_by_id() -> Dict[int, dict]:
    """Our roster id -> the record. pokemon_data.json's `id` is PokeAPI's species
    id, which is what makes it usable as a join key."""
    data = json.loads(POKEMON_DATA.read_text(encoding="utf-8"))
    return {entry["id"]: entry for entry in data}


def roster_slugs_referenced() -> set:
    """Every ability slug our own pokemon_data.json references."""
    data = json.loads(POKEMON_DATA.read_text(encoding="utf-8"))
    slugs: set = set()
    for entry in data:
        for slug in entry.get("abilities") or []:
            if slug:
                slugs.add(slug)
        if entry.get("hidden_ability"):
            slugs.add(entry["hidden_ability"])
    return slugs


def resolve_forms(names: List[str], roster_by_id: Dict[int, dict]) -> Dict[str, dict]:
    """slug -> {baseId, baseName, form, inRoster} for every holder NOT matched by name.

    Only the unmatched names are fetched, which is what keeps this to ~377
    requests instead of ~1100.

    The base species is read from `/pokemon/{name}`'s `species.id` and never from
    the name string. Matching on names was the first attempt and it was wrong in
    a way that looked like missing data: 14 ordinary species fail it (PokeAPI
    `amoonguss` against our "Amoongus" — a one-letter typo in the roster,
    `farfetchd` against our "Farfetch'd", and ten more), so 14 species would have
    been silently reported as form-only holders. pokemon_data.json's `id` IS
    PokeAPI's species id — verified at 459 (Snover), 1024 (Terapagos) and 1025
    (Pecharunt) — so `species.id` resolves all 14 plus every genuine form, and
    the qualifier comes off the form entry instead of off a suffix we guessed.

    Why the row carries the roster's own `nameEn` rather than PokeAPI's name:
    the page builds its cross-page links with shared.js's `pokemonSlug()`, and
    that function slugs "Farfetch'd" to `farfetch-d` while PokeAPI calls the
    species `farfetchd`. Shipping PokeAPI's string would dead-link 14 species.
    Storing the roster's spelling lets the ONE slug implementation on this site
    do the work, and `nameZh` rides along so the holder grid is not a page of
    English names.
    """
    out: Dict[str, dict] = {}
    unresolved = sorted(set(names))
    if not unresolved:
        return out
    print(f"  resolving {len(unresolved)} holders not matched by name", flush=True)

    def one(name: str) -> Tuple[str, Optional[dict]]:
        detail = get(f"pokemon/{name}")
        species = detail["species"]
        # `/pokemon/{name}` returns `species` as a STUB — {name, url}, no id —
        # so the species id is the trailing number of its URL, read the same way
        # fetch_moves.py's resource_id() reads one. Following the URL instead
        # would be a second request per holder for a number already in the
        # string we were handed.
        base_id = int(species["url"].rstrip("/").split("/")[-1])
        qualifier = None
        for form in detail["forms"]:
            if form["name"].lower() == name.lower():
                if not form.get("is_default", False):
                    qualifier = name.lower()[len(species["name"].lower()) :].lstrip("-") or None
                break
        entry = roster_by_id.get(base_id)
        return name, (
            {
                "baseId": base_id,
                "baseName": entry["names"]["en"].lower() if entry else None,
                "form": qualifier,
                "inRoster": entry is not None,
            }
            if entry
            else None
        )

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for name, info in pool.map(one, unresolved):
            out[name] = info
    return out


def build(dry_run: bool) -> None:
    listed = list_all("ability")
    print(f"PokeAPI abilities: {len(listed)}", flush=True)

    details = paged(listed, "ability detail")
    details.sort(key=lambda a: a["id"])

    roster = roster_slugs()
    by_id = roster_by_id()
    referenced = roster_slugs_referenced()
    print(f"our roster: {len(roster)} species, referencing {len(referenced)} abilities", flush=True)

    holder_names: List[str] = []
    for ability in details:
        for entry in ability["pokemon"]:
            holder_names.append(entry["pokemon"]["name"].lower())

    form_info = resolve_forms([n for n in holder_names if n not in roster], by_id)

    converter = opencc.OpenCC("s2twp")

    abilities: Dict[str, dict] = {}
    species: Dict[str, list] = {}
    sources = {"pokeapi-zh-hant": 0, "opencc-s2twp": 0, "none": 0}
    names_missing = 0
    unresolved_base: set = set()
    no_en_effect: List[str] = []
    form_only: List[str] = []
    excluded: List[dict] = []

    for ability in details:
        if ability["id"] >= INTERNAL_BLOCK_START:
            excluded.append(
                {
                    "slug": ability["name"],
                    "named": zh_name(ability) is not None,
                    "flavoured": bool(zh_flavour(ability)[0]),
                    "holders": len(ability["pokemon"]),
                }
            )
            continue
        slug = ability["name"]
        effect, lang, version = zh_flavour(ability)

        if effect is None:
            source = None
            sources["none"] += 1
        elif lang == "zh-hant":
            source = "pokeapi-zh-hant"
            sources["pokeapi-zh-hant"] += 1
        else:
            effect = converter.convert(effect)
            source = "opencc-s2twp"
            sources["opencc-s2twp"] += 1

        rows = []
        for entry in sorted(ability["pokemon"], key=lambda e: (e["is_hidden"], e["pokemon"]["name"])):
            name = entry["pokemon"]["name"]
            key = name.lower()
            pokemon_id = int(entry["pokemon"]["url"].rstrip("/").split("/")[-1])
            if key in roster:
                record = by_id[roster[key]]
                rows.append(
                    {
                        "id": pokemon_id,
                        "name": key,
                        "nameEn": record["names"]["en"],
                        "nameZh": record["names"].get("zh"),
                        "form": None,
                        "isHidden": bool(entry["is_hidden"]),
                        "baseId": record["id"],
                        "inRoster": True,
                    }
                )
            else:
                info = form_info.get(key)
                if info is None:
                    unresolved_base.add(name)
                    rows.append(
                        {
                            "id": pokemon_id,
                            "name": key,
                            "nameEn": None,
                            "nameZh": None,
                            "form": None,
                            "isHidden": bool(entry["is_hidden"]),
                            "baseId": None,
                            "inRoster": False,
                        }
                    )
                    continue
                record = by_id.get(info["baseId"])
                rows.append(
                    {
                        "id": pokemon_id,
                        "name": key,
                        "nameEn": record["names"]["en"] if record else None,
                        "nameZh": record["names"].get("zh") if record else None,
                        "form": info.get("form"),
                        "isHidden": bool(entry["is_hidden"]),
                        "baseId": info["baseId"],
                        "inRoster": bool(info["inRoster"]),
                    }
                )

        zh = zh_name(ability)
        if zh is None:
            names_missing += 1
        english_effect = en_short_effect(ability)
        if effect is None and english_effect is None:
            no_en_effect.append(slug)

        roster_count = sum(1 for r in rows if r["inRoster"])
        # Three different numbers, and the page must not conflate them:
        #   holders    PokeAPI pokemon carrying it, forms included (47 for 威嚇)
        #   speciesCount distinct BASE species, which is what 「N 隻寶可夢」 means
        #               to a reader (37 for 威嚇 — the other 10 are Hisuian /
        #               Mega / Paldean formes of species already counted)
        #   formCount  the difference between them, so the detail page can say
        #               how many of its chips are formes rather than species
        base_ids = {r["baseId"] for r in rows if r["inRoster"]}
        form_count = sum(1 for r in rows if r["inRoster"] and r["form"])
        if roster_count == 0:
            form_only.append(slug)

        abilities[slug] = {
            "id": ability["id"],
            "nameEn": en_name(ability),
            "nameZh": zh,
            "generation": generation_number(ability["generation"]["name"]),
            "effect": effect,
            "effectSource": source,
            "effectVersion": version,
            "effectEn": english_effect,
            "holders": len(rows),
            "roster": roster_count,
            "speciesCount": len(base_ids),
            "formCount": form_count,
            "hasHidden": any(r["isHidden"] for r in rows),
        }
        species[slug] = rows

    print()
    print(f"effect source      zh-hant {sources['pokeapi-zh-hant']}  s2twp {sources['opencc-s2twp']}  none {sources['none']}")
    print(f"zh names missing   {names_missing}   (these render nameEn instead)")
    print(f"holders w/ no base species in our roster: {len(unresolved_base)}")
    print(f"abilities with zero roster holders       : {len(form_only)}")
    print(f"slug overlap with pokemon_data.json      : {len(set(abilities) & referenced)}/{len(referenced)}")
    if no_en_effect:
        print(f"no English fallback either               : {len(no_en_effect)}  <- would render a blank card")
    print(
        f"internal block (id >= {INTERNAL_BLOCK_START})   : {len(excluded)} excluded"
        f"  (named {sum(1 for e in excluded if e['named'])},"
        f" flavoured {sum(1 for e in excluded if e['flavoured'])},"
        f" held {sum(1 for e in excluded if e['holders'])})"
    )
    print(f"SHIPPING {len(abilities)} abilities")

    if unresolved_base:
        print(f"  unresolved holder sample: {', '.join(sorted(unresolved_base)[:10])}")
    if form_only:
        print(f"  form-only sample: {', '.join(sorted(set(form_only))[:12])}")

    if dry_run:
        print("\n--dry-run: nothing written.")
        return

    ABILITIES_OUT.write_text(
        json.dumps(abilities, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    SPECIES_OUT.write_text(
        json.dumps(species, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    species_index = build_species_index(species)
    single = sum(1 for e in species_index.values() if len(e["reg"]) == 1 and not e["hid"])
    SPECIES_INDEX_OUT.write_text(
        json.dumps(species_index, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"\nwrote {ABILITIES_OUT.relative_to(ROOT)} ({ABILITIES_OUT.stat().st_size // 1024} KB)")
    print(f"wrote {SPECIES_OUT.relative_to(ROOT)} ({SPECIES_OUT.stat().st_size // 1024} KB)")
    print(
        f"wrote {SPECIES_INDEX_OUT.relative_to(ROOT)}"
        f" ({SPECIES_INDEX_OUT.stat().st_size // 1024} KB,"
        f" {len(species_index)} species, {single} with a single ability)"
    )


def build_species_index(species: Dict[str, List[dict]]) -> Dict[str, dict]:
    """Invert `species` (slug -> holders) into dex id -> {names, slugs}.

    The inverse of the file written directly above it, deliberately derived in
    this pass rather than in the browser: a page that has to invert 1,025 rows
    on every load is paying for a shape it could have been handed.

    `inRoster` is the filter that makes this a 1,025-row index rather than a
    1,350-row one — a forme-exclusive holder collapses onto the base species it
    belongs to, which is also the species the reader will search for.

    Deduplication is by slug per slot, NOT by row: one species can reach the same
    ability through several formes, and the index is keyed by baseId so those are
    entries to merge rather than duplicates to print twice.

    The SAME slug can legitimately land in BOTH slots, and 12 species do: a
    regional forme's regular ability is often the base forme's hidden one (Alolan
    Grimer's poison-touch is Kantonian Grimer's hidden 毒觸, and Rock Head is the
    case §3.AC already records for Marowak). Merging formes onto one row therefore
    produces a species whose two lists intersect, and the page renders that third
    case separately rather than printing the same ability twice — a plausible
    reading of which slot it belongs to is a wrong answer, not a cosmetic one.
    check_abilities_data.mjs pins the count at 12.
    """
    index: Dict[str, dict] = {}
    for slug, rows in species.items():
        for row in rows:
            if not row.get("inRoster") or row.get("baseId") is None:
                continue
            key = str(row["baseId"])
            entry = index.get(key)
            if entry is None:
                entry = index[key] = {
                    "zh": row.get("nameZh") or "",
                    "en": row.get("nameEn") or row.get("name") or "",
                    "reg": [],
                    "hid": [],
                }
            slot = "hid" if row.get("isHidden") else "reg"
            if slug not in entry[slot]:
                entry[slot].append(slug)
    for entry in index.values():
        entry["reg"].sort()
        entry["hid"].sort()
    return dict(sorted(index.items(), key=lambda kv: int(kv[0])))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report coverage without writing")
    args = parser.parse_args()
    build(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())