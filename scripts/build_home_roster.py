#!/usr/bin/env python3
"""Build the homepage's compact Pokémon roster.

`index.html` never loads the 2.8 MB `pokemon_data.json`. The two home demos need
only the four sort keys `home-showcase.js` exposes (id / stats / height / hue)
and the Chinese name the maze game prints, so this writes them as one compact
90 KB table. Shape is kept compatible with `sort-keys.js` comparators
(`{ data: { id, stats.total, height_m, hue } }`) so no adapter is needed.

Run after `pokemon_data.json` changes, then:
    node scripts/check_home_sections.mjs
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/data/pokemon_data.json"
OUT = ROOT / "assets/data/home_roster.json"

FIELDS = ("id", "names.zh", "stats.total", "height_m", "hue")


def build(records):
    roster = []
    for p in records:
        roster.append({
            "id": p["id"],
            "names": {"zh": p["names"]["zh"]},
            "stats": {"total": p["stats"]["total"]},
            "height_m": p["height_m"],
            "hue": p["hue"],
        })
    return roster


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    records = json.loads(SRC.read_text(encoding="utf-8"))
    roster = build(records)
    payload = json.dumps(roster, ensure_ascii=False, separators=(",", ":"))

    if args.dry_run:
        print(f"{len(roster)} records, {len(payload.encode('utf-8'))} bytes; fields: {', '.join(FIELDS)}")
        return

    OUT.write_text(payload, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} — {len(roster)} records, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
