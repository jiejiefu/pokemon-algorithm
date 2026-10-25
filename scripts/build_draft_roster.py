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

Each candidate carries a POOL of its eight highest level-up moves, not four
fixed ones. `learnsets.json` orders each list by level and a final evolution
keeps its pre-evolution's Lv.1 relearn block, so the pool is the TAIL of that
list, never its head: slicing from the front put 撞擊 on 189 of 568 cards and
拍擊/瞪眼 on 149. The page keeps the highest-level move, keeps or swaps the next
three (two swaps), and fills from the pool, so a species stays recognisable
without showing the same four cards on every run.

`anchors` is one highest-level DAMAGING move per own type, in the species' type
order, for every type its level list can supply. The page guarantees each of
those types appears in the final four, so a dual-type species cannot arrive with
one half of its identity missing — 妙蛙花 without Grass reads as broken — while
the duel itself still scores only move type against defence and applies no STAB.
A type whose level moves are all status is omitted rather than padded with a
move that cannot score (#003 Poison, #765 Normal); five species have no own-type
damaging move and four have no damaging move at all, so their rows stay honest.
`other` is filled only when the level list is short, in `team-moves.js`'s
machine -> tutor -> egg order, so a species still reaches four without the page
loading two tables.

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
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POKEMON = ROOT / "assets/data/pokemon_data.json"
EVOLUTION = ROOT / "assets/data/evolution_levels.json"
LEARNSETS = ROOT / "assets/data/learnsets.json"
MOVES = ROOT / "assets/data/moves_zh.json"
TEAM_MOVES = ROOT / "assets/js/team-moves.js"
OUT = ROOT / "assets/data/draft_roster.json"

ROSTER_MAX = 1025
MOVES_PER_CANDIDATE = 4
SWAP_POOL = 8

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


def typeless_moves():
    """`isDamaging()`'s second half, read from the one place it is defined.

    `team-moves.js` owns TYPELESS_MOVES — the 17 moves the duel cannot score and
    prints as —. A copy here would be a list that can disagree with the page, and
    a disagreement is invisible: the card simply stops scoring. The set is
    written as a literal, so read it and stop loudly if that changes.
    """
    source = TEAM_MOVES.read_text(encoding="utf-8")
    block = re.search(
        r"export const TYPELESS_MOVES = new Set\(\[(.*?)\]\);", source, re.S
    )
    if not block:
        raise SystemExit(
            f"TYPELESS_MOVES is no longer a literal in {TEAM_MOVES.relative_to(ROOT)}"
        )
    ids = {int(token) for token in re.findall(r"\d+", block.group(1))}
    if len(ids) != 17:
        raise SystemExit(f"TYPELESS_MOVES: expected 17 ids, read {len(ids)}")
    return ids


TYPELESS = typeless_moves()


def is_damaging(move_id, moves):
    """The Python side of `isDamaging()`: not status, and not a blank-type move."""
    move = moves.get(str(move_id)) or {}
    return move.get("class") != "status" and move_id not in TYPELESS


def anchors_for(all_level, types, moves):
    """One highest-level damaging move per own type, in the species' type order.

    It is the page's plausibility rule, not a scoring one — the duel applies no
    STAB. A dual-type species whose four moves ignore one of its types reads as
    broken, so each type the level list can score with gets its own anchor.
    A type that only supplies status moves is skipped rather than padded with a
    move that cannot score (#003 Poison, #765 Normal), and a species with none
    at all (Ditto, Wobbuffet, Smeargle, Pyukumuku) has an empty list.
    """
    found = []
    for wanted in types:
        for move_id in reversed(all_level):
            if not is_damaging(move_id, moves):
                continue
            if (moves[str(move_id)].get("type") or "").lower() != wanted.lower():
                continue
            found.append(move_id)
            break
    return found


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
    no_stab = []
    deep_anchor = []
    two_anchors = 0
    pinned = []
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

        all_level = level_ids(entry.get("level"))
        pool = all_level[-SWAP_POOL:]
        anchors = anchors_for(all_level, p["types"], moves)
        if not anchors:
            no_stab.append((dex_id, p["names"]["zh"]))
        if len(anchors) == 2:
            two_anchors += 1
        if any(anchor not in pool for anchor in anchors):
            deep_anchor.append((dex_id, p["names"]["zh"]))
        if len(anchors) == 2 and all(anchor not in pool for anchor in anchors):
            pinned.append((dex_id, p["names"]["zh"]))
        other = []
        if len(pool) < MOVES_PER_CANDIDATE:
            other = [
                i for i in other_ids(entry) if i not in pool
            ][: MOVES_PER_CANDIDATE - len(pool)]
        total = len(pool) + len(other)
        if total < MOVES_PER_CANDIDATE:
            short.append((dex_id, p["names"]["zh"], total))
        record = [dex_id, p["names"]["zh"], p["names"]["en"], p["types"], pool, anchors]
        if other or total < MOVES_PER_CANDIDATE:
            record.append(other)
        referenced.update(pool)
        referenced.update(anchors)
        referenced.update(other)
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
        "fields": ["id", "zh", "en", "types", "pool", "anchors", "other"],
        "moveFields": ["zh", "type", "class"],
        "pokemon": pokemon,
        "moves": defs,
    }, {
        "edges": edges,
        "short": short,
        "legendary": legendary,
        "final": len(final_ids),
        "no_stab": no_stab,
        "deep_anchor": deep_anchor,
        "two_anchors": two_anchors,
        "pinned": pinned,
        "swappable": sum(1 for row in pokemon if len(row[4]) > MOVES_PER_CANDIDATE),
    }


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
    print(
        f"  {stats['swappable']} can swap 2 of 4; {stats['two_anchors']} guard two types; "
        f"{len(stats['deep_anchor'])} need an anchor deeper than the last {SWAP_POOL}"
    )
    print(
        f"  {len(stats['pinned'])} pin both anchors outside the pool: "
        + ", ".join(f"#{i:03d} {n}" for i, n in stats["pinned"])
    )
    for dex_id, name, count in stats["short"]:
        print(f"  short: #{dex_id:03d} {name} — {count} moves")
    for dex_id, name in stats["no_stab"]:
        print(f"  no own-type damaging move: #{dex_id:03d} {name}")

    if args.dry_run:
        return

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} — {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
