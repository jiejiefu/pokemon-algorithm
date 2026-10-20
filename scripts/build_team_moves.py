#!/usr/bin/env python3
"""Build the team planner's compact move table.

`team.html` gives each of six members four moves and lets any of them be
swapped from the four learn methods in `learnsets.json`. It needs, per species,
the four method lists and, per move, just enough to render a row: names, type,
damage class, power, accuracy, PP, generation and the effect sentence.

The full files are the wrong shape for that page: `learnsets.json` is 4.5 MB and
`moves_zh.json` is 508 KB. This table is ~607 KB raw / ~151 KB gzip, fetched
lazily on the first team member, and carries no effect metadata the dialog does
not print. The effect text IS kept — it is what the picker shows under each move
name; PP and generation are kept for the same reason.

Machine rows lose their `TM01`/generation pair: `move.zh` is what the row shows,
and the team picker groups by method rather than by machine code. Dropping the
code and generation saves ~120 KB raw with no loss the page can display.

The `defs` object opens with `_fields`, so the column order is data rather than
a convention two files have to remember. Every set's move id is asserted to have
a def, every def is asserted to be a real move, and duplicates inside one
method are rejected — all three are generation defects that would otherwise
surface as a blank picker row.

Run after `learnsets.json` or `moves_zh.json` changes, then:
    node scripts/check_team_moves.mjs
"""

import argparse
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROSTER = ROOT / "assets/data/team_roster.json"
LEARNSETS = ROOT / "assets/data/learnsets.json"
MOVES = ROOT / "assets/data/moves_zh.json"
OUT = ROOT / "assets/data/team_moves.json"

# Column order of every entry under `defs`; the page reads these positions out
# of `_fields` rather than hard-coding indices.
FIELDS = [
    "zh", "en", "type", "class", "power", "accuracy", "pp", "generation", "effect",
]
METHODS = ("level", "machine", "egg", "tutor")


def column(move, field):
    """`moves_zh.json` stores the type as a lowercase slug; every consumer here
    keys it against `type-chart.js`, whose keys are capitalised (`Fire`)."""
    value = move.get(field)
    if field == "type" and value:
        return value[:1].upper() + value[1:]
    return value


def method_rows(rows, method):
    """Ids for one method, in learnset order, after a duplicate check."""
    ids = []
    for row in rows:
        move_id = row[0] if isinstance(row, list) else row
        ids.append(move_id)
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise SystemExit(f"{method}: duplicate move ids {dupes}")
    return ids


def build(roster, learnsets, moves):
    defs = {"_fields": FIELDS}
    for key, move in moves.items():
        if key.startswith("_"):
            continue
        defs[key] = [column(move, field) for field in FIELDS]

    sets = {}
    for pokemon in roster:
        dex_id = str(pokemon["id"])
        entry = learnsets.get(dex_id)
        if not entry:
            raise SystemExit(f"#{dex_id} {pokemon['names']['zh']} has no learnset")

        level = []
        for row in entry.get("level", []):
            level.append(f"{row[0]}:{row[1]}")
        # A duplicate anywhere is generation noise that would let one species
        # draw the same move twice; refuse rather than silently dedupe.
        level_ids = [row.split(":")[0] for row in level]
        if len(level_ids) != len(set(level_ids)):
            raise SystemExit(f"#{dex_id} level: duplicate move ids")

        sets[pokemon["id"]] = {
            "l": ",".join(level),
            "m": ",".join(str(i) for i in method_rows(entry.get("machine", []), "machine")),
            "e": ",".join(str(i) for i in method_rows(entry.get("egg", []), "egg")),
            "t": ",".join(str(i) for i in method_rows(entry.get("tutor", []), "tutor")),
        }

    referenced = set()
    for entry in sets.values():
        for key in ("l", "m", "e", "t"):
            for token in filter(None, entry[key].split(",")):
                referenced.add(token.split(":")[0])
    missing = sorted(referenced - set(defs) - {"_fields"})
    if missing:
        raise SystemExit(f"move ids with no def: {missing}")

    return {"defs": defs, "sets": sets}


def report(payload, text):
    raw = text.encode("utf-8")
    print(
        f"{len(payload['sets'])} species, {len(payload['defs']) - 1} moves; "
        f"{len(raw)} bytes raw / {len(gzip.compress(raw))} gzip"
    )
    for method, label in zip("lmet", METHODS):
        total = sum(len([x for x in e[method].split(",") if x]) for e in payload["sets"].values())
        print(f"  {label:8} {total:6} entries")

    short_level = []
    short_total = []
    for dex_id, entry in payload["sets"].items():
        level = len([x for x in entry["l"].split(",") if x])
        everything = set()
        for method in "lmet":
            for token in filter(None, entry[method].split(",")):
                everything.add(token.split(":")[0])
        if level < 4:
            short_level.append(dex_id)
        if len(everything) < 4:
            short_total.append(dex_id)
    print(f"  {len(short_level)} species have under 4 level-up moves; "
          f"{len(short_total)} have under 4 moves in total: {', '.join(map(str, short_total))}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    roster = json.loads(ROSTER.read_text(encoding="utf-8"))["pokemon"]
    learnsets = json.loads(LEARNSETS.read_text(encoding="utf-8"))
    moves = json.loads(MOVES.read_text(encoding="utf-8"))

    payload = build(roster, learnsets, moves)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    report(payload, text)

    if args.dry_run:
        return

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} — {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
