#!/usr/bin/env python3
"""Build the team planner's compact Pokémon roster.

`team.html` needs every one of the 1,025 species, but only six fields per
species: id, Chinese/English names, types, generation, and which regional
dexes it belongs to. `pokemon_data.json` is 2.9 MB raw / 668 KB gzip; this
table is 112 KB raw / 21 KB gzip, so the planner never pays for the dossier.

The region list is written alongside the records because the page's region
filter must describe the data rather than a second hand-written copy of it.
Order is canonical here; the checker asserts it agrees with every record's
`regional_dex` keys in both directions.

Run after `pokemon_data.json` changes, then:
    node scripts/check_team_page.mjs
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/data/pokemon_data.json"
OUT = ROOT / "assets/data/team_roster.json"

# Display order, broad to narrow, and the only order the filter renders.
REGIONS = [
    "全國", "關都", "城都", "豐緣", "神奧", "合眾",
    "卡洛斯", "阿羅拉", "伽勒爾", "帕底亞", "洗翠", "藍莓學園",
]


def build(records):
    roster = []
    for p in records:
        dex = p.get("regional_dex") or {}
        roster.append({
            "id": p["id"],
            "names": {
                "zh": p["names"]["zh"],
                "en": p["names"]["en"],
            },
            "types": p["types"],
            "generation": p["generation"],
            "regions": [r for r in REGIONS if r in dex],
        })
    return {"regions": REGIONS, "pokemon": roster}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    records = json.loads(SRC.read_text(encoding="utf-8"))
    payload = build(records)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    if args.dry_run:
        print(
            f"{len(payload['pokemon'])} records, {len(text.encode('utf-8'))} bytes; "
            f"regions: {', '.join(payload['regions'])}"
        )
        return

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} — {len(payload['pokemon'])} records, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
