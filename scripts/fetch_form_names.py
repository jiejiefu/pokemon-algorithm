#!/usr/bin/env python3
"""
Scrape the official Chinese form names from the Taiwanese Pokédex list page.

Emits assets/js/form-names-zh.js — a generated, committed cache of the site's
form labels. That file is one *tier* of a four-tier lookup that lives in
assets/js/form-names.js; this script owns only the first tier.

Why one request
    The list page ships every row in its Next.js flight payload, so 1,281 rows
    (1,048 species + 233 form rows) arrive in a single ~600 KB document. The
    species count exceeds our 1,025 because the portal also lists entries our
    dex does not carry; they are filtered out downstream, not here. Fetching
    a page per form, as fix_pokemon_names.py does for species names, would be
    232 requests for data already present.

Why the parser is hand-rolled
    Three things in the payload each break the obvious approach:
      * The pushes are all on one minified line, and their string bodies contain
        escaped quotes (`\"`), so a `[^"]*` regex stops at the first one. The
        body has to be scanned with awareness of backslash escapes.
      * Each body is a JSON string literal, so it is decoded with json.loads
        per chunk. Decoding the *concatenated* blob with unicode_escape instead
        corrupts every CJK character in it, and decoding the joined result as
        JSON raises `Extra data` because the flight protocol interleaves a
        record id prefix (`0:{...}`) into what is not one JSON document.
      * The rows are concatenated into that blob, so objects are recovered with
        a brace counter that is also string-aware — the row values include
        bracketed ASCII art, and counting braces naively truncates them.

Provenance
    The source is the same official portal that scripts/fix_pokemon_names.py
    already scrapes for species names (tw.portal-pokemon.com), so this adds no
    new third-party dependency to the naming chain. The site's list page is not
    versioned and shifts when it is redesigned, which is why the output is
    committed and this script is not run at page load.

Usage
    python scripts/fetch_form_names.py                # fetch and regenerate
    python scripts/fetch_form_names.py --from FILE    # regenerate from a snapshot
    python scripts/fetch_form_names.py --out FILE     # write somewhere else
"""
import argparse
import json
import re
import sys
from pathlib import Path

import httpx

BASE = Path(__file__).parent.parent
OUT_PATH = BASE / "assets" / "js" / "form-names-zh.js"
LIST_URL = "https://tw.portal-pokemon.com/play/pokedex/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}
TIMEOUT = 30.0

# A push whose second element is a string carries flight-payload text. The
# other kinds (module references, opaque blobs) are not row data.
PUSH_PREFIX = 'self.__next_f.push([1,"'
ROW_START = '{"zukan_id"'

# Floor counts, not exact ones: the site adds rows whenever it is updated, so a
# hard 1,281 would make an upstream addition look like a parser regression. These
# exist to catch the opposite failure — a redesigned payload that yields a
# handful of rows, which would otherwise regenerate the file with a name table
# that looks plausible and is nearly empty.
MIN_SPECIES_ROWS = 1000
MIN_FORM_ROWS = 200


def read_dump(path: Path) -> str:
    """Read a saved snapshot, or exit with the exact command to produce one.

    A missing *input* must never reach the validation below and report itself as
    bad data — that sends the reader to the wrong file entirely.
    """
    if not path.exists():
        sys.exit(
            f"input not found: {path}\n"
            f"save a snapshot first:\n"
            f"  curl -L '{LIST_URL}' -o {path}"
        )
    return path.read_text(encoding="utf-8")


def fetch(url: str) -> str:
    for attempt in range(3):
        try:
            response = httpx.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
            if response.status_code == 200:
                return response.text
            if response.status_code == 404:
                sys.exit(f"404 from {url} — the source page moved.")
        except httpx.HTTPError as exc:
            if attempt == 2:
                sys.exit(f"could not fetch {url}: {exc}")
    sys.exit("unreachable")


def flight_chunks(html: str) -> list[str]:
    """Every string body pushed to the flight stream, decoded in page order."""
    chunks, cursor = [], 0
    while True:
        start = html.find(PUSH_PREFIX, cursor)
        if start < 0:
            break
        i = start + len(PUSH_PREFIX)
        # Scan to the closing quote, treating \" as an escaped quote rather than
        # the end of the body. Without this the first escaped quote inside the
        # payload truncates every chunk that has one.
        while i < len(html):
            if html[i] == "\\":
                i += 2
                continue
            if html[i] == '"':
                break
            i += 1
        if i >= len(html):
            break
        body = html[start + len(PUSH_PREFIX):i]
        try:
            chunks.append(json.loads('"' + body + '"'))
        except json.JSONDecodeError:
            # A single undecodable chunk is not fatal; the row counters below
            # decide whether enough survived to be a real table.
            pass
        cursor = i + 1
    return chunks


def json_objects(blob: str, needle: str) -> list[dict]:
    """Every complete JSON object in `blob` that begins with `needle`."""
    found, cursor = [], 0
    while True:
        start = blob.find(needle, cursor)
        if start < 0:
            return found
        depth, in_str, esc, i = 0, False, False, start
        while i < len(blob):
            ch = blob[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        found.append(json.loads(blob[start:i + 1]))
                    except json.JSONDecodeError:
                        pass
                    break
            i += 1
        cursor = start + 1


def build(html: str) -> dict[int, list[dict]]:
    blob = "".join(flight_chunks(html))
    rows = json_objects(blob, ROW_START)

    species = [r for r in rows if int(r.get("zukan_sub_id", 0)) == 0]
    forms = [r for r in rows if int(r.get("zukan_sub_id", 0)) > 0]
    print(f"rows: {len(rows)} ({len(species)} species, {len(forms)} form)")

    if len(species) < MIN_SPECIES_ROWS:
        sys.exit(
            f"only {len(species)} species rows (floor {MIN_SPECIES_ROWS}) — the page layout "
            f"probably changed, so the object scan is no longer finding rows. "
            f"Re-inspect the payload before trusting any output."
        )
    if len(forms) < MIN_FORM_ROWS:
        sys.exit(
            f"only {len(forms)} form rows (floor {MIN_FORM_ROWS}) — see the note above."
        )

    table: dict[int, list[dict]] = {}
    for row in forms:
        zukan_id = int(row["zukan_id"])
        sub_id = int(row["zukan_sub_id"])
        name = (row.get("pokemon_name") or "").strip()
        sub = (row.get("pokemon_sub_name") or "").strip()
        if not name:
            # 7 rows exist with a name-less form (585_2, 641_1, 448_1, 19_1,
            # 901_1, 842_1, 52_2). They carry artwork and stats but no label, so
            # there is nothing to record; they are counted, not guessed at.
            print(f"  dropping nameless form {zukan_id}_{sub_id}")
            continue
        # An empty descriptor is a Mega: the portal folds the distinction into
        # the name itself (超級噴火龍Ｘ) and every one of the 50 such rows has a
        # pokemon_name that differs from its species name. A non-empty one is a
        # qualifier to append, verbatim and in full-width brackets
        # (妙蛙花（超極巨化）, 小拉達（阿羅拉的樣子）).
        name_zh = name if not sub else f"{name}（{sub}）"
        table.setdefault(zukan_id, []).append(
            {"subId": sub_id, "subZh": sub, "nameZh": name_zh}
        )

    for entries in table.values():
        entries.sort(key=lambda e: e["subId"])
    total = sum(len(v) for v in table.values())
    print(f"named forms: {total} across {len(table)} species")
    return table


HEADER = """/**
 * Official Chinese form names, generated by scripts/fetch_form_names.py.
 * Do not edit by hand; re-run the script instead.
 *
 * Keyed by the *base species* national dex id, so a consumer joins on the id
 * every form node already carries. subId is the site's own index within that
 * species and is kept only for provenance — it is NOT safe to join on, because
 * the site's form order does not match the order of the local chain, and
 * subZh is what the join actually matches on.
 */
export const PORTAL_FORM_NAMES = """

FOOTER = """
/** Where the table above came from, and what it is not allowed to be used for. */
export const FORM_NAMES_SOURCE = {
  url: '%s',
  fetched: '%s',
  rowCount: %d,
  note: 'The site is not versioned and shifts when redesigned, which is why this '
      + 'file is committed rather than fetched at page load. Our own dataset is '
      + 'newer than this table for several forms, so a missing row means "use the '
      + 'local name", never "drop the form".',
};
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="source", type=Path,
                        help="regenerate from a saved snapshot instead of the network")
    parser.add_argument("--out", type=Path, default=OUT_PATH, help="output path")
    args = parser.parse_args()

    html = read_dump(args.source) if args.source else fetch(LIST_URL)
    table = build(html)

    from datetime import date, timezone
    total = sum(len(v) for v in table.values())
    body = json.dumps(table, ensure_ascii=False, indent=2, sort_keys=True)
    body = "\n".join("  " + line for line in body.splitlines())
    args.out.write_text(
        HEADER + body + ";\n" + FOOTER % (LIST_URL, date.today().isoformat(), total),
        encoding="utf-8",
    )
    print(f"wrote {args.out} ({total} names, {args.out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
