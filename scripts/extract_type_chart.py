#!/usr/bin/env python3
"""
Generate assets/js/type-chart.js from the 52poke wiki type chart

Source: 神奇寶貝百科 (52poke) 屬性相剋表 — https://wiki.52poke.com/wiki/属性相克表
Table:  the 第六世代起 (XY and later) "正常對戰" grid, i.e. the modern 18x18 chart.

Why the wiki and not PokeAPI
---------------------------
PokeAPI stores `damage_relations` per type, but only records damage in the
direction that type happens to be stored for. Merging the `*_damage_from` and
`*_damage_to` fields of all 18 types still leaves most cells unspecified, and
because the two directions never overlap the merge produces no conflicts to
warn about. A Pokémon's own endpoints (`/api/v2/type/psychic`, `normal`) are
demonstrably incomplete: normal lists no `half_damage_from` and psychic
mis-assigns several rows. The wiki page states the chart in full, so the wiki
page is the only source that can be verified cell by cell.

Why not Pokémon Showdown
------------------------
`data/typechart.ts` on the master branch is a modded chart (it carries a
`prankster` ability key and a Stellar row) rather than the canonical table.

Table selection
---------------
The page holds three "effect" grids, all with class `hover`:

    index 2  18 types (Gen 6+, includes 妖精)   <- the one we want
    index 3  17 types (Gen 2-5, pre- Fairy)
    index 4  15 types (Gen 1, pre- Steel/Dark)

They are told apart by the 「Ｘ／Ｙ」 applicability note that trails only the
modern table. The 18-type header is asserted as a second, independent guard.

Row structure quirk
-------------------
The first data row is fused into the header block: `tr[2]` carries the two
`th[rowspan=18]` vertical 「攻擊方使用的招式屬性」 row labels *and* the 一般
row, so it yields 22 cells while every other row yields 20 (label, 18 values,
label). A naive "rows with 20 cells" scan silently drops 一般.

Cell values are read from the text and cross-checked against the cell's CSS
class (`half` / `double` / `zero` / unclassed), so a layout change that
reshuffles columns cannot quietly transpose the matrix.

The script fails loudly on any inconsistency, so a wiki edit can never silently
ship a half-parsed chart.
"""

import json
import re
import time
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag

BASE = Path(__file__).parent.parent
API_URL = "https://wiki.52poke.com/api.php"
PAGE_WIKI = "https://wiki.52poke.com/wiki/属性相克表"
PAGE_TITLE = "属性相克表"
APPLICABILITY_NOTE = "Ｘ／Ｙ"
OUTPUT_JS = BASE / "assets" / "js" / "type-chart.js"
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"

MAX_RETRIES = 3
TIMEOUT = 20.0
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like, Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

# The API renders whichever variant the wiki picks as its default, and that has
# been observed to change between calls, so both 简体 and 繁體 spellings are
# accepted. Ten of the eighteen names are identical in both; the other eight are
# listed as a pair. Row/column identity is carried by position rather than by
# the label text, so no downstream value depends on which variant came back.
CN2EN: Dict[str, str] = {
    "一般": "Normal", "格斗": "Fighting", "格鬥": "Fighting",
    "飞行": "Flying", "飛行": "Flying", "毒": "Poison", "地面": "Ground",
    "岩石": "Rock", "虫": "Bug", "蟲": "Bug", "幽灵": "Ghost", "幽靈": "Ghost",
    "钢": "Steel", "鋼": "Steel", "火": "Fire", "水": "Water", "草": "Grass",
    "电": "Electric", "電": "Electric", "超能力": "Psychic", "冰": "Ice",
    "龙": "Dragon", "龍": "Dragon", "恶": "Dark", "惡": "Dark", "妖精": "Fairy",
}

# Multiplier as written in the cell text. U+2044 FRACTION SLASH is what the
# wiki uses for the ½ glyph, not ASCII '/'.
TEXT_VALUES: Dict[str, float] = {
    "1×": 1.0, "2×": 2.0, "0×": 0.0, "1⁄2×": 0.5, "1⁄4×": 0.25,
}

# The same multiplier as encoded in the cell's CSS class. Empty class = 1x.
CLASS_VALUES: Dict[str, float] = {
    "": 1.0, "double": 2.0, "half": 0.5, "quarter": 0.25, "zero": 0.0,
}

TYPE_COUNT = 18
ROW_LABEL_SPAN = 18  # th[rowspan=18] vertical row labels
ROW_LABEL_TEXT = "攻擊方使用的招式屬性"

# The eight immune matchups of the Gen 6+ chart, as (attacker, defender).
# Pokémon doubles since Gen 6 removed Ghost/Steel weaknesses, which leaves
# exactly these, and they are the hardest cells to get right by hand.
IMMUNITIES = {
    ("Ghost", "Normal"), ("Normal", "Ghost"), ("Fighting", "Ghost"),
    ("Electric", "Ground"), ("Ground", "Flying"), ("Psychic", "Dark"),
    ("Poison", "Steel"), ("Dragon", "Fairy"),
}

# The complete chart, written defensively: for each defending type, which
# attacking types hit it hard, resist it, or are blocked. This is the direction
# the wiki grid is easiest to read in, and it pins all 120 non-neutral cells at
# once rather than sampling a few. Read off the 「第六世代起」 grid.
PROFILES: Dict[str, Dict[str, List[str]]] = {
    "Normal":   {"2x": ["Fighting"], "half": [], "0x": ["Ghost"]},
    "Fighting": {"2x": ["Flying", "Psychic", "Fairy"], "half": ["Rock", "Bug", "Dark"], "0x": []},
    "Flying":   {"2x": ["Rock", "Electric", "Ice"], "half": ["Fighting", "Bug", "Grass"], "0x": ["Ground"]},
    "Poison":   {"2x": ["Ground", "Psychic"], "half": ["Fighting", "Poison", "Bug", "Grass", "Fairy"], "0x": []},
    "Ground":   {"2x": ["Water", "Grass", "Ice"], "half": ["Poison", "Rock"], "0x": ["Electric"]},
    "Rock":     {"2x": ["Fighting", "Ground", "Steel", "Water", "Grass"],
                 "half": ["Normal", "Flying", "Poison", "Fire"], "0x": []},
    "Bug":      {"2x": ["Flying", "Rock", "Fire"], "half": ["Fighting", "Ground", "Grass"], "0x": []},
    "Ghost":    {"2x": ["Ghost", "Dark"], "half": ["Poison", "Bug"], "0x": ["Normal", "Fighting"]},
    "Steel":    {"2x": ["Fighting", "Ground", "Fire"],
                 "half": ["Normal", "Flying", "Rock", "Bug", "Steel", "Grass",
                          "Psychic", "Ice", "Dragon", "Fairy"], "0x": ["Poison"]},
    "Fire":     {"2x": ["Ground", "Rock", "Water"],
                 "half": ["Bug", "Steel", "Fire", "Grass", "Ice", "Fairy"], "0x": []},
    "Water":    {"2x": ["Grass", "Electric"], "half": ["Steel", "Fire", "Water", "Ice"], "0x": []},
    "Grass":    {"2x": ["Flying", "Poison", "Bug", "Fire", "Ice"],
                 "half": ["Ground", "Water", "Grass", "Electric"], "0x": []},
    "Electric": {"2x": ["Ground"], "half": ["Flying", "Steel", "Electric"], "0x": []},
    "Psychic":  {"2x": ["Bug", "Ghost", "Dark"], "half": ["Fighting", "Psychic"], "0x": []},
    "Ice":      {"2x": ["Fighting", "Rock", "Steel", "Fire"], "half": ["Ice"], "0x": []},
    "Dragon":   {"2x": ["Ice", "Dragon", "Fairy"],
                 "half": ["Fire", "Water", "Grass", "Electric"], "0x": []},
    "Dark":     {"2x": ["Fighting", "Bug", "Fairy"], "half": ["Ghost", "Dark"], "0x": ["Psychic"]},
    "Fairy":    {"2x": ["Poison", "Steel"], "half": ["Fighting", "Bug", "Dark"], "0x": ["Dragon"]},
}

Revision = Dict[str, str]  # {"revid": ..., "timestamp": ...}


def fetch_page(client: httpx.Client) -> Tuple[str, Revision]:
    """Return (rendered html, latest revision) for the type chart page."""
    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            parsed = client.get(
                API_URL,
                params={
                    "action": "parse", "page": PAGE_TITLE, "prop": "text",
                    "format": "json", "formatversion": "2",
                },
            ).json()["parse"]
            revision = client.get(
                API_URL,
                params={
                    "action": "query", "prop": "revisions", "titles": PAGE_TITLE,
                    "rvprop": "ids|timestamp", "format": "json", "formatversion": "2",
                },
            ).json()["query"]["pages"][0]["revisions"][0]
            return parsed["text"], revision
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(1.0 * attempt)
    raise SystemExit(f"FAIL: could not fetch {PAGE_WIKI} after {MAX_RETRIES} tries: {last}")


def pick_chart(soup: BeautifulSoup) -> Tag:
    """Return the Gen 6+ grid: the `hover` table trailed by the Ｘ／Ｙ note."""
    candidates = [
        table for table in soup.find_all("table")
        if "hover" in (table.get("class") or [])
        and table.find_next(string=re.compile(APPLICABILITY_NOTE))
    ]
    if len(candidates) != 1:
        raise SystemExit(
            f"FAIL: expected exactly one {APPLICABILITY_NOTE} 'hover' table, found {len(candidates)}"
        )
    return candidates[0]


def cell_text(cell: Tag) -> str:
    """Cell text with zero-width characters removed and fullwidth digits folded."""
    text = cell.get_text("", strip=True)
    for ch in "\u200b\u200c\u200d\u2060\ufeff\u00a0\u3000":
        text = text.replace(ch, "")
    return unicodedata.normalize("NFKC", text)


def parse_chart(chart: Tag) -> Tuple[List[str], Dict[str, Dict[str, float]], List[str]]:
    """Return (column order, attacker -> defender -> multiplier, class mismatches)."""
    trs = chart.find_all("tr")

    header_cells = trs[1].find_all(["td", "th"])
    columns = [cell_text(c) for c in header_cells]
    if len(columns) != TYPE_COUNT or any(name not in CN2EN for name in columns):
        raise SystemExit(
            f"FAIL: expected a {TYPE_COUNT}-type header of known names, got {len(columns)}: {columns}"
        )
    order = [CN2EN[name] for name in columns]
    if len(set(order)) != TYPE_COUNT:
        raise SystemExit(f"FAIL: header does not resolve to {TYPE_COUNT} distinct types: {order}")

    chart_: Dict[str, Dict[str, float]] = {}
    mismatches: List[str] = []

    def is_row_label(cell: Tag) -> bool:
        return cell.name == "th" and (
            cell.get("rowspan") == str(ROW_LABEL_SPAN) or cell_text(cell) == ROW_LABEL_TEXT
        )

    for tr in trs[2:]:
        cells = tr.find_all(["td", "th"])
        while cells and is_row_label(cells[0]):
            cells.pop(0)
        while cells and is_row_label(cells[-1]):
            cells.pop()
        if len(cells) != TYPE_COUNT + 2:
            continue
        attacker = cell_text(cells[0])
        if attacker not in CN2EN or attacker != cell_text(cells[-1]):
            continue

        row: Dict[str, float] = {}
        for defender, cell in zip(order, cells[1:-1]):
            text = cell_text(cell)
            value = TEXT_VALUES.get(text)
            classes = " ".join(cell.get("class") or []).strip()
            if value is None:
                raise SystemExit(f"FAIL: unrecognised cell text {text!r} at {attacker}->{defender}")
            if CLASS_VALUES.get(classes, value) != value:
                mismatches.append(f"{attacker}->{defender}: text {text!r} vs class {classes!r}")
            row[defender] = value
        chart_[CN2EN[attacker]] = row

    return order, chart_, mismatches


def validate(order: List[str], chart: Dict[str, Dict[str, float]], mismatches: List[str]) -> int:
    """Assert the parsed grid equals the canonical Gen 6+ chart. Returns non-neutral count."""
    if mismatches:
        raise SystemExit(f"FAIL: {len(mismatches)} cells disagree with their CSS class: {mismatches[:5]}")

    if list(chart) != order:
        missing = [t for t in order if t not in chart]
        extra = [t for t in chart if t not in order]
        raise SystemExit(f"FAIL: attacker rows != column order (missing={missing}, extra={extra})")

    for attacker, row in chart.items():
        wrong = [d for d, v in row.items() if v not in (0.0, 0.25, 0.5, 1.0, 2.0, 4.0)]
        if wrong:
            raise SystemExit(f"FAIL: {attacker} has non-canonical multipliers for {wrong}")

    if set(order) != set(PROFILES):
        raise SystemExit(
            f"FAIL: reference covers {sorted(PROFILES)}, chart parsed {sorted(order)}"
        )

    # Compare the whole grid at once: transpose what we parsed into per-defender
    # buckets and diff each against the reference profile.
    parsed: Dict[str, Dict[str, List[str]]] = {
        defender: {"2x": [], "half": [], "0x": []} for defender in order
    }
    for attacker, row in chart.items():
        for defender, value in row.items():
            if value == 2.0:
                parsed[defender]["2x"].append(attacker)
            elif value == 0.5:
                parsed[defender]["half"].append(attacker)
            elif value == 0.0:
                parsed[defender]["0x"].append(attacker)
            elif value != 1.0:
                raise SystemExit(f"FAIL: {attacker}->{defender} is {value}, which the chart never uses")

    non_neutral = 0
    for defender, buckets in parsed.items():
        expected = PROFILES[defender]
        for bucket, attackers in buckets.items():
            want = sorted(expected[bucket])
            got = sorted(attackers)
            non_neutral += len(got)
            if got != want:
                raise SystemExit(
                    f"FAIL: {defender} {bucket}\n  expected {want}\n  parsed   {got}"
                )

    found = {(a, d) for a, row in chart.items() for d, v in row.items() if v == 0.0}
    if found != IMMUNITIES:
        raise SystemExit(
            f"FAIL: immunity set changed (missing={sorted(IMMUNITIES - found)}, extra={sorted(found - IMMUNITIES)})"
        )

    return non_neutral


def validate_pokemon_types(order: List[str]) -> int:
    """Every type in pokemon_data.json must exist in the chart, or detail pages break."""
    with POKEMON_DATA_JSON.open(encoding="utf-8") as fh:
        pokemon = json.load(fh)
    used = {t for entry in pokemon for t in (entry.get("types") or [])}
    unknown = sorted(used - set(order))
    if unknown:
        raise SystemExit(
            f"FAIL: pokemon_data.json uses {len(unknown)} types absent from the chart: {unknown}"
        )
    return len(used)


def to_js(
    order: List[str],
    chart: Dict[str, Dict[str, float]],
    revid: str,
    timestamp: str,
) -> str:
    def dump_row(name: str, row: Dict[str, float]) -> str:
        inner = ", ".join(f"{d}: {v:g}" for d, v in row.items() if v != 1.0)
        return f"  {name}: {{ {inner} }},\n"

    columns = ",\n".join(f"  '{t}'" for t in order)
    rows = "".join(dump_row(t, chart[t]) for t in order)
    header = (
        "/**\n"
        " * Gen 6+ type chart — 自動產生，請勿手動編輯。\n"
        f" * 產生方式: ../scripts/extract_type_chart.py\n"
        f" * 來源: {PAGE_WIKI}（{APPLICABILITY_NOTE} 起的「正常對戰」表）\n"
        f" * revision: {revid} ({timestamp})\n"
        " *\n"
        " * TYPE_CHART[attacker][defender] is the damage multiplier; unlisted cells are 1x.\n"
        " */\n\n"
    )
    source = json.dumps(
        {
            "url": PAGE_WIKI,
            "section": f"{APPLICABILITY_NOTE} 起的「正常對戰」表",
            "revid": int(revid),
            "timestamp": timestamp,
        },
        ensure_ascii=False,
    )
    return (
        f"{header}"
        "export const TYPE_CHART_ORDER = [\n"
        f"{columns}\n"
        "];\n\n"
        "export const TYPE_CHART = {\n"
        f"{rows}"
        "};\n\n"
        f"export const TYPE_CHART_SOURCE = {source};\n"
    )


def main() -> None:
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS) as client:
        html, revision = fetch_page(client)

    revid = str(revision["revid"])
    timestamp = revision["timestamp"]
    chart_table = pick_chart(BeautifulSoup(html, "lxml"))
    order, chart, mismatches = parse_chart(chart_table)
    non_neutral = validate(order, chart, mismatches)
    type_count = validate_pokemon_types(order)

    OUTPUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JS.write_text(to_js(order, chart, revid, timestamp), encoding="utf-8")

    print(f"source              : {PAGE_WIKI} rev {revid} ({timestamp})")
    print(f"grid                : {len(chart)} attackers x {len(order)} defenders")
    print(f"non-neutral cells   : {non_neutral} (all match reference)")
    print(f"immunities          : {len(IMMUNITIES)} (all verified)")
    print("cell text vs class  : consistent")
    print(f"pokemon types known : {type_count}/{TYPE_COUNT}")
    print(f"wrote {OUTPUT_JS.relative_to(BASE)}")


if __name__ == "__main__":
    main()
