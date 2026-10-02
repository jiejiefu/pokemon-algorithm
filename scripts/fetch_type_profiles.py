#!/usr/bin/env python3
"""Phase 10: Per-type profile scraper (InfoPoke `/types/[id]` payload).

The InfoPoke type-detail route is a client-rendered Nuxt page: its server HTML
ships an almost empty `<main>`, so scraping the rendered document only ever
yields i18n keys (`types.detail.faqWeakToQ`, `types.detail.metaTitle`, ...).
The actual per-type prose lives in the page's JS chunk, which carries four
top-level literals:

    { name, description, battleTips, categoryNote } x 18   English only
    [ { category, name, effect } ] x 18                    English
    [ { category, name, effect } ] x 18                    Simplified Chinese
    [ { name, title, location, generation } ] x 18         English

InfoPoke ships no Traditional Chinese catalog at all -- the zh-TW pages leak
raw keys precisely because that catalog is missing -- so the Simplified Chinese
literal is run through OpenCC `s2twp` to produce the zh-TW text this project
uses everywhere else. Trainer names and city names stay English (proper nouns,
no official zh-TW source in assets/data); only the role label is translated,
from the table in TRAINER_ROLE_ZH below.

Chunk filenames are content hashes that change on every InfoPoke deploy, so the
chunk is resolved at run time by scanning the module preloads of the live page
for the one that contains `battleTips` rather than being hardcoded. The four
literals are likewise located by shape rather than by minified variable name,
since minification renames them freely.

Output: assets/data/type_profiles.json

Usage:
    python scripts/fetch_type_profiles.py
    python scripts/fetch_type_profiles.py --out /tmp/profiles.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import opencc

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "assets" / "data" / "type_profiles.json"

SITE = "https://infopoke.net"
PAGE_URL = f"{SITE}/zh-tw/types/normal"
CHUNK_MARKER = "battleTips"  # only present in the type-description literal

USER_AGENT = "pokemon-algorithm type profile scraper (read-only; contact: repo owner)"

TYPE_SLUGS = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
    "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark",
    "steel", "fairy",
]

# InfoPoke ships trainer roles in English only. These are this project's own
# renderings, kept here so a scrape stays reproducible instead of depending on
# a translator being present.
TRAINER_ROLE_ZH = {
    "Gym Leader": "道館館主",
    "Gym Leaders": "道館館主",
    "Elite Four": "四天王",
    "Champion": "冠軍",
    "Former Champion": "前任冠軍",
    "Rival": "勁敵",
    "Trial Captain": "試煉隊長",
    "Island Kahuna": "島嶼卡胡納",
    "Team Star Boss": "巨星隊隊長",
    "Team Skull Boss": "枯骨幫幫主",
    "Team Skull Admin": "枯骨幫幹部",
    "Gym Leader / Elite Four": "道館館主 / 四天王",
    "Gym Leader / Champion": "道館館主 / 冠軍",
    "Gym Leader / Team Rocket Boss": "道館館主 / 火箭隊隊長",
    "Trial Captain / Elite Four": "試煉隊長 / 四天王",
    "Elite Four / Champion": "四天王 / 冠軍",
}

CJK = re.compile(r"[\u4e00-\u9fff]")

MAX_RETRIES = 3


class ScrapingError(RuntimeError):
    """Raised when the live payload cannot be read or fails validation."""


# --------------------------------------------------------------- JS literal parsing

class JsLiteralParser:
    """Recursive-descent parser for the object/array/string/number subset that
    Nuxt data literals use. Minified output is not JSON, but it is a strict
    subset of JS: double-quoted strings, numbers (incl. the `.5` shorthand),
    arrays, objects, and unquoted identifier keys.
    """

    IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
    NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)")

    def __init__(self, text: str) -> None:
        self.text = text
        self.pos = 0

    def _ws(self) -> None:
        while self.pos < len(self.text) and self.text[self.pos] in " \t\r\n":
            self.pos += 1

    def parse(self) -> Any:
        self._ws()
        value = self._value()
        self._ws()
        return value

    def _value(self) -> Any:
        self._ws()
        if self.pos >= len(self.text):
            raise ScrapingError("unexpected end of literal")
        ch = self.text[self.pos]
        if ch == "{":
            return self._object()
        if ch == "[":
            return self._array()
        if ch == '"' or ch == "'":
            return self._string()
        match = self.NUMBER.match(self.text, self.pos)
        if match:
            self.pos = match.end()
            return float(match.group(0)) if "." in match.group(0) else int(match.group(0))
        match = self.IDENT.match(self.text, self.pos)
        if match:
            self.pos = match.end()
            word = match.group(0)
            if word in ("true", "false"):
                return word == "true"
            if word == "null":
                return None
            raise ScrapingError(f"unsupported bare identifier {word!r} at {self.pos}")
        raise ScrapingError(f"unexpected character {ch!r} at {self.pos}")

    def _string(self) -> str:
        quote = self.text[self.pos]
        self.pos += 1
        out: List[str] = []
        while True:
            if self.pos >= len(self.text):
                raise ScrapingError("unterminated string")
            ch = self.text[self.pos]
            if ch == "\\":
                self.pos += 1
                esc = self.text[self.pos]
                out.append({"n": "\n", "t": "\t", "r": "\r"}.get(esc, esc))
                self.pos += 1
                continue
            if ch == quote:
                self.pos += 1
                return "".join(out)
            out.append(ch)
            self.pos += 1

    def _array(self) -> List[Any]:
        self.pos += 1  # [
        out: List[Any] = []
        self._ws()
        if self.text[self.pos] == "]":
            self.pos += 1
            return out
        while True:
            out.append(self._value())
            self._ws()
            ch = self.text[self.pos]
            self.pos += 1
            if ch == "]":
                return out
            if ch != ",":
                raise ScrapingError(f"expected , or ] at {self.pos}, got {ch!r}")

    def _object(self) -> Dict[str, Any]:
        self.pos += 1  # {
        out: Dict[str, Any] = {}
        self._ws()
        if self.text[self.pos] == "}":
            self.pos += 1
            return out
        while True:
            self._ws()
            ch = self.text[self.pos]
            if ch in "\"'":
                key = self._string()
            else:
                match = self.IDENT.match(self.text, self.pos)
                if not match:
                    raise ScrapingError(f"bad object key at {self.pos}")
                key = match.group(0)
                self.pos = match.end()
            self._ws()
            if self.text[self.pos] != ":":
                raise ScrapingError(f"expected : after key {key!r} at {self.pos}")
            self.pos += 1
            out[key] = self._value()
            self._ws()
            ch = self.text[self.pos]
            self.pos += 1
            if ch == "}":
                return out
            if ch != ",":
                raise ScrapingError(f"expected , or }} at {self.pos}, got {ch!r}")


def extract_literals(chunk: str) -> List[Tuple[int, Dict[str, Any]]]:
    """Return every top-level `<identifier> = { ... }` object literal in the chunk.

    Depth is tracked with a string-aware scanner so that braces inside string
    values (which the prose is full of) do not end an object early.
    """
    found: List[Tuple[int, Dict[str, Any]]] = []
    for match in re.finditer(r"(?:^|[;,}\s])([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{", chunk):
        start = chunk.index("{", match.end() - 1)
        depth = 0
        i = start
        quote: Optional[str] = None
        while i < len(chunk):
            ch = chunk[i]
            if quote:
                if ch == "\\":
                    i += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in "\"'`":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:
            continue
        try:
            value = JsLiteralParser(chunk[start:i + 1]).parse()
        except ScrapingError:
            continue
        if isinstance(value, dict):
            found.append((start, value))
    return found


def has_all_slugs(value: Dict[str, Any]) -> bool:
    return isinstance(value, dict) and all(slug in value for slug in TYPE_SLUGS)


def classify(literals: List[Tuple[int, Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    """Bucket the parsed literals by shape, ignoring minified variable names."""
    profiles: Optional[Dict[str, Any]] = None
    entries_en: Optional[Dict[str, Any]] = None
    entries_zh: Optional[Dict[str, Any]] = None
    trainers: Optional[Dict[str, Any]] = None

    for _, value in literals:
        if not has_all_slugs(value):
            continue
        sample = next(iter(value.values()))
        if isinstance(sample, dict) and "description" in sample and "battleTips" in sample:
            profiles = value
        elif isinstance(sample, list) and sample and isinstance(sample[0], dict):
            keys = set(sample[0])
            if {"category", "name", "effect"} <= keys:
                blob = json.dumps(sample, ensure_ascii=False)
                if CJK.search(blob):
                    entries_zh = value
                else:
                    entries_en = value
            elif {"name", "title", "location"} <= keys:
                trainers = value

    missing = [
        name for name, val in [
            ("descriptions", profiles), ("entriesEn", entries_en),
            ("entriesZh", entries_zh), ("trainers", trainers),
        ] if val is None
    ]
    if missing:
        raise ScrapingError(
            "could not locate these literals in the chunk: " + ", ".join(missing)
        )
    return {
        "profiles": profiles, "entriesEn": entries_en,
        "entriesZh": entries_zh, "trainers": trainers,
    }


# ------------------------------------------------------------------------ fetching

def get(client: httpx.Client, url: str, **params: Any) -> httpx.Response:
    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url, params=params or None)
            response.raise_for_status()
            return response
        except (httpx.HTTPError, ValueError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                continue
    raise ScrapingError(f"could not fetch {url} after {MAX_RETRIES} tries: {last}")


def resolve_chunk(client: httpx.Client) -> Tuple[str, str]:
    """Find the JS chunk holding the type-profile literals.

    Returns (chunk_url, chunk_text). The filename is a build hash, so it is
    discovered from the live page's module preloads instead of hardcoded.
    """
    page = get(client, PAGE_URL).text
    candidates = sorted(set(re.findall(r'/_nuxt/[A-Za-z0-9_\-]+\.js', page)))
    if not candidates:
        raise ScrapingError(f"no /_nuxt/*.js references found on {PAGE_URL}")

    def fetch(path: str) -> str:
        return get(client, SITE + path).text

    for path in candidates:
        chunk = fetch(path)
        if CHUNK_MARKER in chunk:
            return SITE + path, chunk

    # The marker may live in a lazily imported chunk that is not preloaded on
    # the first paint; fall back to the chunk ids embedded in the entry bundle.
    for path in candidates:
        entry = fetch(path)
        for lazy in sorted(set(re.findall(r'"\./([A-Za-z0-9_\-]+\.js)"', entry))):
            lazy_path = path.rsplit("/", 1)[0] + "/" + lazy
            chunk = fetch(lazy_path)
            if CHUNK_MARKER in chunk:
                return SITE + lazy_path, chunk

    raise ScrapingError(
        f"no chunk containing {CHUNK_MARKER!r} found among {len(candidates)} candidates"
    )


# ------------------------------------------------------------------------ building

def build(client: httpx.Client, out_path: Path) -> Dict[str, Any]:
    chunk_url, chunk = resolve_chunk(client)
    buckets = classify(extract_literals(chunk))
    to_tw = opencc.OpenCC("s2twp")

    def convert(value: str) -> str:
        return to_tw.convert(value)

    unknown_roles: Dict[str, int] = {}
    types: Dict[str, Any] = {}
    for slug in TYPE_SLUGS:
        profile = buckets["profiles"][slug]
        zh_rows = buckets["entriesZh"][slug]
        en_rows = buckets["entriesEn"][slug]
        trainer_rows = buckets["trainers"][slug]

        trainers = []
        for row in trainer_rows:
            role = row.get("title") or ""
            if role not in TRAINER_ROLE_ZH:
                unknown_roles[role] = unknown_roles.get(role, 0) + 1
            trainers.append({
                "name": row.get("name", ""),
                "roleZh": TRAINER_ROLE_ZH.get(role, role),
                "location": row.get("location", ""),
                "generations": row.get("generation", ""),
            })

        types[slug] = {
            "blurbEn": profile.get("description", ""),
            "battleTipsEn": profile.get("battleTips", ""),
            "categoryNoteEn": profile.get("categoryNote", ""),
            "entries": [
                {
                    "category": row.get("category", ""),
                    "name": convert(row.get("name", "")),
                    "effect": convert(row.get("effect", "")),
                }
                for row in zh_rows
            ],
            "entriesEn": [
                {
                    "category": row.get("category", ""),
                    "name": row.get("name", ""),
                    "effect": row.get("effect", ""),
                }
                for row in en_rows
            ],
            "trainers": trainers,
        }

    if unknown_roles:
        print("WARN unmapped trainer roles: " + ", ".join(
            f"{role!r} x{count}" for role, count in sorted(unknown_roles.items())
        ), file=sys.stderr)

    document = {
        "source": {
            "site": "https://infopoke.net",
            "page": PAGE_URL,
            "chunk": chunk_url,
            "fetchedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "simplifiedToTraditional": "OpenCC s2twp",
            "note": (
                "InfoPoke publishes no zh-TW catalog for this route; its own zh-TW "
                "pages render raw i18n keys. Descriptions and trainers are English "
                "upstream, effect text is Simplified Chinese upstream and converted "
                "here, trainer role labels are this project's own translations."
            ),
        },
        "types": types,
    }

    validate(document)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return document


def validate(document: Dict[str, Any]) -> None:
    """Fail loudly rather than writing a half-populated file."""
    types = document["types"]
    if list(types) != TYPE_SLUGS:
        raise ScrapingError(f"type keys {list(types)} != {TYPE_SLUGS}")

    categories = {"ability", "move", "item"}
    total_entries = 0
    for slug, entry in types.items():
        for key in ("blurbEn", "battleTipsEn", "entries", "entriesEn", "trainers"):
            if key not in entry:
                raise ScrapingError(f"{slug} is missing {key!r}")
        if not entry["entries"]:
            raise ScrapingError(f"{slug} has no zh-TW entries")
        if not entry["trainers"]:
            raise ScrapingError(f"{slug} has no trainers")
        for row in entry["entries"]:
            if row["category"] not in categories:
                raise ScrapingError(f"{slug} has bad category {row['category']!r}")
            if not row["name"] or not row["effect"]:
                raise ScrapingError(f"{slug} has an entry missing name/effect")
            if not CJK.search(row["effect"]):
                raise ScrapingError(f"{slug} effect is not Chinese: {row['effect']!r}")
        total_entries += len(entry["entries"])

    if total_entries < 100:
        raise ScrapingError(f"only {total_entries} zh-TW entries scraped; expected >100")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_JSON)
    args = parser.parse_args()

    try:
        with httpx.Client(
            timeout=90, headers={"User-Agent": USER_AGENT}, follow_redirects=True
        ) as client:
            document = build(client, args.out)
    except ScrapingError as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1

    types = document["types"]
    entries = sum(len(t["entries"]) for t in types.values())
    trainers = sum(len(t["trainers"]) for t in types.values())
    counts = {slug: len(t["entries"]) for slug, t in types.items()}
    spread = sorted(set(counts.values()))
    print(f"chunk            : {document['source']['chunk']}")
    print(f"types            : {len(types)}")
    print(f"zh-TW entries    : {entries}  (per type: {spread[0]}-{spread[-1]})")
    print(f"trainers         : {trainers}")
    print(f"categories       : {sorted({r['category'] for t in types.values() for r in t['entries']})}")
    print(f"written          : {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
