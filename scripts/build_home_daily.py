#!/usr/bin/env python3
"""Build assets/data/home_daily.json — the homepage's 今日野生寶可夢 table.

`index.html` shows the same daily Pokémon `today.html` does, but it must not load
`pokemon_data.json` (2.8 MB) to find it. This file carries only what the draw and
the card need: the four pools' member ids **in the order the pools resolve**, and
one short row per member.

    row = ["中文名", "English name", "屬性（已串好）", "圖鑑說明", "官方圖檔名"]

The English name is here because `pokemonDetailUrl()` builds the dossier link
from `names.en`; storing a pre-computed slug would be a second copy of a rule
that already has one owner. The artwork filename is `pokemon_data.json`'s own
`filename`, so the card can show the same 475 px official artwork `today.html`
does rather than a 96 px sprite.

WHY THE ORDER MATTERS: `drawDaily()` calls `mulberry32` twice — once for the
bucket, once for the index **within that bucket's member array**. Reproducing the
same pick from this table therefore requires the arrays to be in the same order
the live selectors produce: dex order for the three real categories, and
`POPULAR_IDS` order for the popular pool. `scripts/check_home_lab.mjs` asserts
the drawn id equals `pickDailyPokemon(pokemon_data.json)` for a run of days, so a
reorder here fails rather than silently changing what the homepage shows.

The four predicates are copies of `categories.js`'s own selectors, because this
script cannot import JavaScript. They are guarded the same way: the checker
re-derives all four pools by importing the modules and requires exact equality,
including membership and order.

Run after `pokemon_data.json` or `daily-pick.js` changes, then:
    node scripts/check_home_lab.mjs
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/data/pokemon_data.json"
PICKER = ROOT / "assets/js/daily-pick.js"
OUT = ROOT / "assets/data/home_daily.json"

BUCKETS = ["popular", "legendary", "mythical", "pseudo-legendary"]

# `categories.js`'s `PSEUDO_EXCLUDED`, carried across because the rule is two
# halves: 600 BST, and two evolutions. 鋁鋼橋龍 (#1018) satisfies the first and
# not the second. The set has one owner and this is a transcription of it, not a
# second opinion — the checker re-derives the roster from `categories.js`.
PSEUDO_EXCLUDED = {1018}


def popular_ids():
    src = PICKER.read_text(encoding="utf-8")
    match = re.search(r"export const POPULAR_IDS = \[([^\]]*)\]", src)
    if not match:
        raise SystemExit("daily-pick.js no longer declares POPULAR_IDS in the expected shape")
    ids = [int(x) for x in re.findall(r"\d+", match.group(1))]
    if len(ids) != 10:
        raise SystemExit(f"POPULAR_IDS parsed as {len(ids)} ids, expected 10")
    return ids


def build(records):
    by_id = {p["id"]: p for p in records}
    pools = {
        "popular": popular_ids(),
        "legendary": [p["id"] for p in records if p.get("is_legendary")],
        "mythical": [p["id"] for p in records if p.get("is_mythical")],
        "pseudo-legendary": [
            p["id"] for p in records
            if p.get("stats", {}).get("total") == 600
            and not p.get("is_legendary")
            and not p.get("is_mythical")
            and p["id"] not in PSEUDO_EXCLUDED
        ],
    }

    missing = sorted({i for ids in pools.values() for i in ids if i not in by_id})
    if missing:
        raise SystemExit(f"pool members missing from pokemon_data.json: {missing}")

    rows = {}
    for ids in pools.values():
        for i in ids:
            if i in rows:
                continue
            p = by_id[i]
            rows[i] = [
                p["names"]["zh"],
                p["names"].get("en", ""),
                " / ".join(p.get("types_zh") or []),
                (p.get("descriptions") or {}).get("zh", ""),
                p.get("filename", ""),
            ]

    return {"v": 1, "buckets": {k: pools[k] for k in BUCKETS}, "p": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    records = json.loads(SRC.read_text(encoding="utf-8"))
    payload_obj = build(records)
    payload = json.dumps(payload_obj, ensure_ascii=False, separators=(",", ":"))

    counts = {k: len(v) for k, v in payload_obj["buckets"].items()}
    union = len(payload_obj["p"])
    summary = (f"pools {counts}, union {union} species, "
               f"{len(payload.encode('utf-8'))} bytes")

    if args.dry_run:
        print(summary)
        return

    OUT.write_text(payload, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {summary}")


if __name__ == "__main__":
    main()
