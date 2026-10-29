#!/usr/bin/env python3
"""Build assets/data/home_dex.json — the homepage's 1,025-cell collection wall.

`index.html` must not load `pokemon_data.json` (2.8 MB), so the wall reads this
file instead: one short row per species, in dex order, which makes the row index
`id - 1` and lets the wall skip a lookup per cell.

    row = [generation, "#rrggbb", type1, type2, capture_rate, "中文名"]

`type1`/`type2` index into `TYPES` below (-1 = none). The colour is the species'
measured dominant colour (`rgb` in `pokemon_data.json`); it tints a cell that has
not been caught yet, so an empty dex is already a mosaic of the real roster
rather than a field of identical empty boxes.

`capture_rate` is the real in-game value, and the wall's throw chance is derived
from it, so the file is the only place that number comes from.

Run after `pokemon_data.json` changes, then:
    node scripts/check_home_lab.mjs
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/data/pokemon_data.json"
OUT = ROOT / "assets/data/home_dex.json"

TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground",
         "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"]

FIELDS = "generation, colour, type1, type2, capture_rate, 中文名"


def build(records):
    rows = []
    for p in records:
        r, g, b = (max(0, min(255, int(c))) for c in p["rgb"][:3])
        t = [TYPES.index(x) for x in p["types"]] + [-1, -1]
        rows.append([
            p["generation"],
            f"#{r:02x}{g:02x}{b:02x}",
            t[0],
            t[1],
            int(p.get("capture_rate") or 45),
            p["names"]["zh"],
        ])
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    data = sorted(json.loads(SRC.read_text(encoding="utf-8")), key=lambda p: p["id"])
    ids = [p["id"] for p in data]
    assert ids == list(range(1, len(ids) + 1)), "ids must be 1..N with no gaps"

    rows = build(data)
    gens = [sum(1 for x in rows if x[0] == n) for n in range(1, 10)]
    payload = json.dumps({"v": 1, "types": TYPES, "gens": gens, "p": rows},
                         ensure_ascii=False, separators=(",", ":"))

    if args.dry_run:
        print(f"{len(rows)} species, generations {gens}, {len(payload.encode('utf-8'))} bytes; fields: {FIELDS}")
        return

    OUT.write_text(payload, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} species, generations {gens}, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
