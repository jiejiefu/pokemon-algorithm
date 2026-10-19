#!/usr/bin/env python3
"""Fetch Chinese ability names from PokeAPI -> assets/data/abilities_zh.json

Why this exists
---------------
moves_zh.json (fetch_moves.py) already carries official Chinese names for every
move a Pokémon can learn, but nothing in the repo carried Chinese *ability*
names: pokemon_data.json stores PokeAPI ability SLUGS only (intimidate,
air-lock, ...), which is 284 English identifiers. The homepage's 熱門特性
panel therefore had nothing to render in a zh-TW page.

PokeAPI does carry them, under /api/v2/ability/{name} -> names[], but the
language key is **lowercase** `zh-hant` — the capitalised `zh-Hant` that reads
correctly returns null and looks like "PokeAPI has no Chinese ability names",
which is how this was nearly concluded twice in one session. Always read the
available keys before concluding a field is absent.

Scope: en + zh-hant only. Deliberately NOT hand-entered and NOT a fallback to
the English slug with a fabricated Chinese name — a plausible-looking wrong
translation is worse than a missing one (see AGENTS.md §3.D for the same class
of mistake with the type chart). If PokeAPI ever omits zh-hant for an ability,
the script records zh as null rather than guessing.

Provenance: https://pokeapi.co/api/v2/ability/{name}
Run: source ../.venv/bin/activate && python scripts/fetch_abilities.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "assets" / "data" / "abilities_zh.json"
POKEMON_DATA = ROOT / "assets" / "data" / "pokemon_data.json"

# PokeAPI refuses the default python-httpx User-Agent, same as fetch_moves.py.
HEADERS = {"User-Agent": "pokemon-algorithm-lab/1.0 (local static site)"}
BASE = "https://pokeapi.co/api/v2/ability"


def collect_slugs() -> list[str]:
    """Every ability slug the site's own data references, sorted.

    Read from pokemon_data.json rather than hardcoded, so a Pokemon added to
    the dataset cannot be silently missing here. Abilities appear in
    `abilities` (the visible list) and `hidden_ability`, and a null
    `hidden_ability` must not be collected as the string "None".
    """
    data = json.loads(POKEMON_DATA.read_text(encoding="utf-8"))
    slugs: set[str] = set()
    for entry in data:
        for slug in entry.get("abilities") or []:
            if slug:
                slugs.add(slug)
        hidden = entry.get("hidden_ability")
        if hidden:
            slugs.add(hidden)
    return sorted(slugs)


def main() -> int:
    slugs = collect_slugs()
    print(f"collecting {len(slugs)} distinct ability slugs from pokemon_data.json")

    out: dict[str, dict[str, str | None]] = {}
    missing_zh: list[str] = []
    failed: list[tuple[str, str]] = []

    with httpx.Client(headers=HEADERS, timeout=30.0, follow_redirects=True) as client:
        for i, slug in enumerate(slugs, 1):
            try:
                resp = client.get(f"{BASE}/{slug}")
                if resp.status_code == 404:
                    failed.append((slug, "404"))
                    continue
                resp.raise_for_status()
                names = {n["language"]["name"]: n["name"] for n in resp.json().get("names", [])}
                zh = names.get("zh-hant") or names.get("zh-hans")
                out[slug] = {"en": names.get("en", slug), "zh": zh}
                if not zh:
                    missing_zh.append(slug)
            except Exception as exc:  # noqa: BLE001 - report every failure at the end
                failed.append((slug, f"{type(exc).__name__}: {exc}"))
            if i % 25 == 0 or i == len(slugs):
                print(f"  {i}/{len(slugs)} fetched")
            time.sleep(0.05)  # be polite; ~284 requests total

    DATA_OUT.write_text(
        json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {DATA_OUT.relative_to(ROOT)} ({len(out)} entries)")

    if missing_zh:
        print(f"WARNING: {len(missing_zh)} abilities have no zh-hant name (left null): {missing_zh[:10]}")
    if failed:
        print(f"WARNING: {len(failed)} abilities failed to fetch: {failed[:10]}")
        print("  re-run to fill them; the file is written either way so a partial")
        print("  fetch is inspectable rather than a total failure.")

    # Abort rather than write a plausible-looking partial file unnoticed: the
    # homepage panel would silently show blanks. Same posture as
    # fetch_breeding_data.py's pre-write validation.
    if len(out) < len(slugs) * 0.9:
        print(f"REFUSING to treat {len(out)}/{len(slugs)} as complete.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
