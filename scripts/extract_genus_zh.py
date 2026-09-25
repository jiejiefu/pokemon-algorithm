#!/usr/bin/env python3
"""
Generate assets/js/genus-zh.js from the 52poke category list

Source: 神奇寶貝百科 (52poke) 分類列表 — 全國編號 / 中文 / 日文 / 英文
        https://wiki.52poke.com/zh-hant/分类

The page's table is scraped live rather than read from a checked-in dump, so
regenerating needs network access. The zht page is requested by URL instead of
through `action=parse`, because that API returns the default *simplified*
variant (全国编号 / 宝可梦 / 中文) and the genus column headings are the only
reliable marker for the table we want.

A row's last three cells are always 中文 / 日文 / 英文, and the 宝可梦 cell is
empty in the rendered markup, so fields are anchored from the right rather than
by column index.

A 全國編號 can appear more than once when a Pokémon has several forms with
different categories (e.g. #999 索財靈 is 寶箱寶可夢 / 尋寶寶可夢), so rows are
kept as a list and voting happens per English genus, never per id.

A row for an alternate form is wrapped onto its own line that carries no id, e.g.

    720\t\t胡帕
    懲戒胡帕\t頑童寶可夢\tいたずらポケモン\tMischief Pokémon

Those continuation rows are attached to the id of the row directly above them.
The table also mixes 3- and 4-digit ids and sprinkles zero-width spaces into the
English genus, so field cleanup is deliberately permissive.

Some English genus names map to more than one Traditional Chinese rendering on the
wiki. We resolve those by majority vote, then pin the minority entries with an
explicit id -> zh override so no Pokémon can inherit the wrong wording.

The script fails loudly if any Pokémon in pokemon_data.json has no mapping, so a
truncated or restructured page can never silently ship a half-translated page.
"""

import json
import re
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

BASE = Path(__file__).parent.parent
API_URL = "https://wiki.52poke.com/api.php"
PAGE_WIKI = "https://wiki.52poke.com/zh-hant/分类"
PAGE_TITLE = "分类"  # api.php wants a bare title; the full URL normalizes to a missing page
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"
OUTPUT_JS = BASE / "assets" / "js" / "genus-zh.js"

Row = Tuple[int, str, str]  # (national id, english genus, chinese genus)

# Zero-width and non-breaking characters the wiki sprinkles into the table.
INVISIBLE = {ord(ch): " " for ch in "\u200b\u200c\u200d\u2060\ufeff\u00a0\u3000"}
MAX_ID = 1025
FORMS_PER_ID = 6  # continuation rows allowed to attach to one id
MAX_RETRIES = 3
TIMEOUT = 20.0
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pokemon-algorithm/1.0)"}
TABLE_MARKER = "全國編號"  # traditional; the simplified variant says 全国编号


def clean(text: str) -> str:
    return text.translate(INVISIBLE).strip()


def normalize_zh(text: str) -> str:
    """Normalize fullwidth latin (ＤＮＡ) to ASCII so the label renders consistently."""
    out = []
    for ch in text.strip():
        if "Ａ" <= ch <= "Ｚ" or "ａ" <= ch <= "ｚ" or "０" <= ch <= "９":
            out.append(unicodedata.normalize("NFKC", ch))
        else:
            out.append(ch)
    return "".join(out)


def fetch_page(client: httpx.Client) -> Tuple[str, Dict[str, str]]:
    """Return (rendered html, latest revision) for the category list page."""
    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            html = client.get(PAGE_WIKI).text
            revision = client.get(
                API_URL,
                params={
                    "action": "query", "prop": "revisions", "titles": PAGE_TITLE,
                    "rvprop": "ids|timestamp", "format": "json", "formatversion": "2",
                },
            ).json()["query"]["pages"][0]["revisions"][0]
            return html, revision
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(1.0 * attempt)
    raise SystemExit(f"FAIL: could not fetch {PAGE_WIKI} after {MAX_RETRIES} tries: {last}")


def pick_table(soup: BeautifulSoup):
    """Return the one table headed 全國編號."""
    candidates = [
        table for table in soup.find_all("table")
        if table.find("th") and TABLE_MARKER in table.get_text()
    ]
    if len(candidates) != 1:
        raise SystemExit(
            f"FAIL: expected exactly one '{TABLE_MARKER}' table, found {len(candidates)}"
        )
    return candidates[0]


def parse_table(html: str) -> Tuple[List[Row], Dict[int, set]]:
    """Return every data row plus the distinct English genus seen per national id."""
    rows: List[Row] = []
    genus_by_id: Dict[int, set] = defaultdict(set)
    pending_id: Optional[int] = None
    pending_forms = 0
    continuations: List[Tuple[int, str]] = []

    for tr in pick_table(BeautifulSoup(html, "lxml")).find_all("tr"):
        fields = [clean(c.get_text()) for c in tr.find_all(["td", "th"])]
        if not any(fields):
            continue

        en = fields[-1]
        zh = fields[-3] if len(fields) >= 3 else ""
        if not en.endswith("Pokémon") or not zh or "？" in zh or "?" in zh:
            continue

        head = fields[0]
        if re.fullmatch(r"\d{1,4}", head) and int(head) <= MAX_ID:
            pending_id = int(head)
            pending_forms = 0
        elif pending_id is not None and pending_forms < FORMS_PER_ID:
            continuations.append((pending_id, en))
            pending_forms += 1
        else:
            continue

        rows.append((pending_id, en, normalize_zh(zh)))
        genus_by_id[pending_id].add(en)

    if continuations:
        print(f"note: {len(continuations)} alternate-form rows attached to their id")
    return rows, genus_by_id


def resolve(rows: List[Row]) -> Tuple[Dict[str, str], Dict[str, List[str]]]:
    """Majority vote per english genus; report the keys that were contested."""
    votes: Dict[str, Counter] = defaultdict(Counter)
    for _pid, en, zh in rows:
        votes[en][zh] += 1

    resolved: Dict[str, str] = {}
    contested: Dict[str, List[str]] = {}
    for en, counter in votes.items():
        winner, _top = counter.most_common(1)[0]
        resolved[en] = winner
        if len(counter) > 1:
            contested[en] = [zh for zh, _count in counter.most_common()]
    return resolved, contested


def build_overrides(
    rows: List[Row], resolved: Dict[str, str], contested: Dict[str, List[str]], genus_by_id: Dict[int, set]
) -> Dict[int, str]:
    """Pin every Pokémon whose wiki row disagrees with the majority rendering.

    Ids carrying more than one English genus are skipped: a single id -> zh entry
    could not describe both forms, and neither form is a minority reading anyway.
    """
    overrides: Dict[int, str] = {}
    skipped: List[int] = []
    for _pid, en, zh in rows:
        if en not in contested:
            continue
        majority = resolved[en]
        if zh == majority or zh not in contested[en]:
            continue
        pid = _pid
        if len(genus_by_id[pid]) > 1:
            if pid not in skipped:
                skipped.append(pid)
            continue
        overrides[pid] = zh
    if skipped:
        print(f"note: skipped {len(skipped)} multi-form ids from overrides: {skipped}")
    return overrides


def to_js(mapping: Dict[str, str], overrides: Dict[int, str], stats: Dict[str, int],
          revid: str, timestamp: str) -> str:
    def dump(obj: Dict, quote_key: bool = True) -> str:
        width = 100
        lines, current = [], " "
        for key, value in obj.items():
            k = f"'{key}'" if quote_key else str(key)
            piece = f"{k}: '{value}',"
            if len(current) + len(piece) > width:
                lines.append(current.rstrip())
                current = " "
            current += piece + " "
        if current.strip():
            lines.append(current.rstrip())
        return "\n".join(lines)

    source = json.dumps(
        {"url": PAGE_WIKI, "revid": int(revid), "timestamp": timestamp}, ensure_ascii=False
    )

    return f"""export const GENUS_SOURCE = {source};

export const GENUS_EN_ZH = {{
{dump(mapping)}
}};

export const GENUS_ZH_BY_ID = {{
{dump(overrides, quote_key=False)}
}};

export const GENUS_STATS = {json.dumps(stats, ensure_ascii=False)};
"""


def main() -> None:
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS) as client:
        html, revision = fetch_page(client)
    revid = str(revision["revid"])
    timestamp = revision["timestamp"]

    rows, genus_by_id = parse_table(html)
    resolved, contested = resolve(rows)
    overrides = build_overrides(rows, resolved, contested, genus_by_id)

    with POKEMON_DATA_JSON.open(encoding="utf-8") as fh:
        pokemon = json.load(fh)

    used = {p["genus"] for p in pokemon if p.get("genus")}
    missing = sorted(g for g in used if g not in resolved)
    unused = sorted(g for g in resolved if g not in used)
    unpinned = sorted(
        p["id"]
        for p in pokemon
        if p.get("genus") in contested
        and resolved[p["genus"]] != next((zh for pid, en, zh in rows if pid == p["id"] and en == p["genus"]), None)
        and p["id"] not in overrides
    )

    mapping = {k: resolved[k] for k in sorted(resolved)}
    overrides = dict(sorted(overrides.items()))
    stats = {
        "source_rows": len(rows),
        "distinct_genus": len(mapping),
        "pokemon_genus": len(used),
        "covered": len(used) - len(missing),
        "contested": len(contested),
        "overrides": len(overrides),
    }

    if missing:
        raise SystemExit(f"FAIL: {len(missing)} genus without zh mapping: {missing}")
    if unpinned:
        raise SystemExit(f"FAIL: {len(unpinned)} minority rows not pinned by id: {unpinned}")

    OUTPUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JS.write_text(
        to_js(mapping, overrides, stats, revid, timestamp), encoding="utf-8"
    )

    print(f"source              : {PAGE_WIKI} rev {revid} ({timestamp})")
    print(f"source rows parsed  : {len(rows)}  (ids: {len(genus_by_id)})")
    print(f"distinct genus      : {len(mapping)}")
    print(f"pokemon genus keys  : {len(used)}  covered: {stats['covered']}")
    print(f"contested keys      : {len(contested)}  id overrides: {len(overrides)} {overrides}")
    if unused:
        print(f"note: {len(unused)} wiki genera unused by our data: {sorted(unused)}")
    print(f"wrote {OUTPUT_JS.relative_to(BASE)}")


if __name__ == "__main__":
    main()
