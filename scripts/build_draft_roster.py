#!/usr/bin/env python3
"""Build the silhouette draft's compact roster.

`silhouette-draft.html` draws six concealed candidates per round, six times,
from the 568 species that are final evolutions or have no evolution at all.
Showing a name or a type would give the round away, so the page needs one table
of ids, two names, types and move ids only -- never `pokemon_data.json` (2.9 MB)
and never `team_moves.json` (607 KB, four methods for all 1,025).

The final-evolution pool is read from `evolution_levels.json`'s EDGE LIST, not
from `evolution_chains.json`'s `stage` column: `stage` is dex order, not depth
(§3.K). A species is in the pool when it has no outgoing edge to another
roster id. Edges to forms are not evolutions and are ignored by the same test.

Each candidate carries four level-up moves, because a silhouette with no moves
would make the first round a coin flip. `other` is filled only when the level
list is short, in `team-moves.js`'s machine -> tutor -> egg order, so a species
still reaches four without the page loading two tables.

Compact keys are deliberate: `id/zh/en/t`, `l` (level) and `o` (other) because
every byte here is fetched before the first round. `defs` is the same shape as
`team_moves.json` minus everything the page never prints.

Run after `pokemon_data.json`, `evolution_levels.json`, `learnsets.json` or
`moves_zh.json` changes, then:
    node scripts/check_draft_data.mjs
"""

import argparse
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POKEMON = ROOT / "assets/data/pokemon_data.json"
EVOLUTION = ROOT / "assets/data/evolution_levels.json"
LEARNSETS = ROOT / "assets/data/learnsets.json"
MOVES = ROOT / "assets/data/moves_zh.json"
OUT = ROOT / "assets/data/draft_roster.json"

ROSTER_MAX = 1025
MOVES_PER_CANDIDATE = 4

# `team_moves.json` drops machine codes; this table drops the method split but
# keeps the order `drawMoves()` uses, so a short pool is filled the same way.
OTHER_METHODS = ("machine", "tutor", "egg")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def evolution_edges(evolution, roster_ids):
    """Every real evolution edge among roster species, from both halves."""
    edges = set()
    for key, children in (evolution.get("levels") or {}).items():
        if int(key) not in roster_ids:
            continue
        for child in children:
            if int(child) in roster_ids:
                edges.add((int(key), int(child)))
    for key, steps in (evolution.get("unlevelled") or {}).items():
        if int(key) not in roster_ids:
            continue
        for step in steps:
            child = step["to"]
            if int(child) in roster_ids:
                edges.add((int(key), int(child)))
    return edges


def level_ids(rows):
    """`learnsets.json` stores level rows as [move_id, level]."""
    ids = []
    for row in rows or []:
        move_id = row[0] if isinstance(row, list) else row
        ids.append(int(move_id))
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise SystemExit(f"level: duplicate move ids {dupes}")
    return ids


def other_ids(entry):
    seen = set()
    ids = []
    for method in OTHER_METHODS:
        for row in entry.get(method) or []:
            move_id = int(row[0] if isinstance(row, list) else row)
            if move_id in seen:
                continue
            seen.add(move_id)
            ids.append(move_id)
    return ids


def build(records, evolution, learnsets, moves):
    roster = [p for p in records if p["id"] <= ROSTER_MAX]
    roster_ids = {p["id"] for p in roster}
    if len(roster) != ROSTER_MAX:
        raise SystemExit(f"#{ROSTER_MAX} roster expected, found {len(roster)}")

    edges = evolution_edges(evolution, roster_ids)
    final_ids = sorted(roster_ids - {a for a, _ in edges})

    pokemon = []
    referenced = set()
    short = []
    legendary = 0
    for p in sorted(roster, key=lambda row: row["id"]):
        dex_id = p["id"]
        if dex_id not in final_ids:
            continue
        if p.get("is_legendary") or p.get("is_mythical"):
            legendary += 1

        entry = learnsets.get(str(dex_id))
        if not entry:
            raise SystemExit(f"#{dex_id} {p['names']['zh']} has no learnset")

        level = level_ids(entry.get("level"))
        pool = level if len(level) >= MOVES_PER_CANDIDATE else level + [
            i for i in other_ids(entry) if i not in level
        ]
        picked = pool[:MOVES_PER_CANDIDATE]
        if len(picked) < MOVES_PER_CANDIDATE:
            short.append((dex_id, p["names"]["zh"], len(picked)))
        picked = pool[:MOVES_PER_CANDIDATE]
        record = [dex_id, p["names"]["zh"], p["names"]["en"], p["types"], level[:MOVES_PER_CANDIDATE]]
        if len(picked) < MOVES_PER_CANDIDATE or len(record[4]) < len(picked):
            record.append(pool[len(record[4]):MOVES_PER_CANDIDATE])
        referenced.update(record[4])
        referenced.update(record[5] if len(record) > 5 else [])
        pokemon.append(record)

    defs = {}
    missing = sorted(referenced - {int(k) for k in moves if not k.startswith("_")})
    if missing:
        raise SystemExit(f"move ids with no def: {missing}")
    for move_id in sorted(referenced):
        move = moves[str(move_id)]
        move_type = move.get("type") or ""
        defs[str(move_id)] = [
            move.get("zh") or "",
            move_type[:1].upper() + move_type[1:] if move_type else "",
            move.get("class") or "",
        ]

    return {
        "fields": ["id", "zh", "en", "types", "level", "other"],
        "moveFields": ["zh", "type", "class"],
        "pokemon": pokemon,
        "moves": defs,
    }, {"edges": edges, "short": short, "legendary": legendary, "final": len(final_ids)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    payload, stats = build(
        load(POKEMON), load(EVOLUTION), load(LEARNSETS), load(MOVES)
    )
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    raw = text.encode("utf-8")

    print(
        f"{len(payload['pokemon'])} species, {len(payload['moves'])} moves; "
        f"{len(raw)} bytes raw / {len(gzip.compress(raw))} gzip"
    )
    print(
        f"  {stats['final']} final/single-stage, {stats['legendary']} legendary/mythical, "
        f"{len(stats['edges'])} evolution edges"
    )
    for dex_id, name, count in stats["short"]:
        print(f"  short: #{dex_id:03d} {name} — {count} moves")

    if args.dry_run:
        return

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} — {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
