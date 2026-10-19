#!/usr/bin/env python3
"""
Build the move table and the move learnsets for all 1025 Pokemon from PokeAPI

Sources:
  PokeAPI (https://pokeapi.co) — /move, /pokemon, /machine, /version-group
  InfoPoke (https://infopoke.net/zh-tw/moves) — effect text, and ONLY effect text

InfoPoke is the layout reference for the detail page's four move tabs, but it is
not a usable data source for anything else. Its Nuxt 3 SSR snapshot carries a
684-byte `__NUXT_DATA__` payload that is nothing but i18n config, and the
level-up table in the HTML holds only 6 rows while its own tab label claims 12 —
the remaining rows, and all of the machine/egg/tutor rows, are fetched by a
private client-side call. PokeAPI exposes all four learn methods structurally, so
the layout is imitated and the data is taken from the API.

MEASURED AGAINST POKEAPI, InfoPoke's /moves table is wrong where this file used
to be right, and the two failure modes are different:

  * Its numbers are placeholders for every move no Pokemon learns. Across all 937
    rows its type disagrees with PokeAPI on 126, power on 104 and PP on 122 —
    the Z-moves, Max Moves, Gigantamax moves, Hisuian sigils and Struggle all
    print an em dash and "一般/物" where PokeAPI has real values (Freeze Shock is
    `ice`, 140 power, 5 PP; InfoPoke prints `—/—/—`). Those numbers are not read.

  * Its name column is mixed Traditional and Simplified, and differs from the
    official zh-hant name on 64 rows (力量转换 vs 力量轉換, 克命爪 vs 剋命爪). The
    name comes from PokeAPI and always has.

What IS taken from InfoPoke is the effect sentence, because PokeAPI has no
Traditional Chinese effect entry (`effect_entries` carries English only, 844
moves). PokeAPI's `flavor_text_entries` DOES carry zh-hant, for 826 of the 919 —
the same wording InfoPoke shows, already in Traditional. So the split is by
generation and nothing else:

  ids    1– 826   effectSource "pokeapi-zh-hant"   effectVersion <version group>
  ids  827– 919   effectSource "infopoke-s2twp"    effectVersion "infopoke"

That is the same failure mode as `type_profiles.json` (see §3.D) with the
provenance kept per row rather than merged — and it is smaller: two sources, one
clean boundary, and 90% of the file needs no conversion at all. The 93 converted
rows go through OpenCC `s2twp`, pinned in requirements.txt.

`effectVersion` is carried because the wording is per-version-group: PokeAPI has
zh-hant flavour text for sword-shield, lets-go-pikachu-lets-go-eevee,
ultra-sun-ultra-moon and sun-moon, and they are not always the same sentence.
The preferred order is the list FLAVOUR_VG_PREFERENCE. This is the same reason a
machine row carries its generation (below) — a move's text and a move's TM
number both vary by game, and a union row has no single correct answer.

PokeAPI returns Traditional Chinese move names natively (`names[].language.name
== "zh-hant"`), so nothing has to be scraped for the localisation.

  * 919 of the 937 moves carry a zh-hant name. The 18 that do not are the
    `shadow-*` block (ids 10001-10018, type "shadow"), untranslated even in
    ja/ko, and no core-game Pokemon learns them — the script fails loudly if
    that ever stops being true rather than shipping an English fallback. They are
    excluded from every output rather than shipped as English rows.

  * `version_group_details` has no `machine` object, so TM/HM numbers are not
    obtainable from /pokemon. They are recovered by walking all 2372 /machine
    records into a (move, version group) -> machine_number index.

Scope decision: each tab is the UNION of that learn method across every
version group, because the current generation alone leaves two of the four tabs
empty for most Pokemon (Pikachu, Gengar, Mewtwo, Rayquaza and Dragapult all have
0 egg and 0 tutor moves in scarlet-violet). Level-up rows show the LOWEST level
the move was ever learned at.

A machine row carries the number the move held in the most recent version group
that still had it on a TM/HM/TR, *plus* that group's generation. The generation
is not decoration: TM numbering is per-game, so a union row has no single
correct number — Bulbasaur legitimately has three different moves that were each
"TM01", in three different generations. Emitting the number alone renders as
"TM01 TM01 TM01" down the column and reads as a bug, so the UI shows the number
and marks the rows that did not come from the newest tracked generation.

Output:
  assets/data/moves_zh.json          { id: { en, zh, type, class, power, accuracy, … } }
  assets/data/learnsets.json         { id: { level, machine, egg, tutor } }
  assets/data/move_learners.json     { id: { level, machine, egg, tutor } }   [pokemon ids]
  assets/data/move_learners_count.json { id: { level, machine, egg, tutor, total } }

`move_learners.json` is learnsets.json INVERTED, and it exists because
`move.html` has to answer 「誰能學這招」 for one move: doing that from
`learnsets.json` means a 4.5 MB fetch to render one list. The inverse is 424 KB,
of which `machine` alone is 236 KB because TM numbering is per-game and the same
move is listed under different codes for different species.

`move_learners_count.json` is the 11 KB counts-only companion. `moves.html` prints
「N 隻可學」 on all 919 rows, and paying 424 KB for a number is the exact trade
§3.G5 is about — so the list page loads this file and the detail page loads the
other. Splitting them is a payload decision, and the two files are generated from
the same pass so they cannot disagree.

learnsets.json encodes each method as a compact array to keep the file small
(the union is ~100 rows per Pokemon across 1025 Pokemon):
  level   [[moveId, level], ...]     sorted by level, then move id
  machine [[moveId, number, gen], ...] sorted by number, then move id
  egg     [moveId, ...]              sorted by move id
  tutor   [moveId, ...]              sorted by move id

`hits` and `turns` are [min, max] pairs from PokeAPI's `move.meta` (28 and 44
moves respectively) — 連環巴掌 hits 2–5 times. They are null when the move is not
variable, which is why they are pairs and not two scalars: `max_hits: null` with
`min_hits: 2` means "at least twice", and flattening that to a number loses it.

`category`, `ailment`, `drain` and `heal` are null for 92 moves — the whole of
Generation 9 — because PokeAPI ships `meta: null` for them, NOT because the move
lacks those properties. The distinction is carried rather than smoothed:
`drain: 0` would assert "this move does not heal you", which is a claim PokeAPI
has not made for a move it has no meta for, and a team builder reading that
column would act on it. 0 and null are different answers here and the file keeps
both. Asserted by check_moves_data.mjs, which counts the nulls rather than
requiring them to be zero — a count that happens to be right today is not the
claim being made.

WHY ONLY THE 93 ARE CONVERTED — because it is not an optimisation. Running
`s2twp` over the 826 PokeAPI rows would change 18 of them AWAY from the official
wording: 起風's 「用翅膀刮起狂風」 becomes 「颳起狂風」, 污泥攻擊's 「投擲污泥」
becomes 「投擲汙泥」, and 念力's 「發送」 becomes 「傳送」. OpenCC's phrase
dictionary carries the mainland-preferred form of words Taiwanese official text
does not use, so the 826 are left exactly as upstream publishes them. The
property check_moves_data.mjs asserts is therefore IDEMPOTENCE and not "contains
no Simplified characters": a hand-written Simplified-character set is exactly
the kind of assertion that produces 565 false positives here (手, 岩 and 污 are
all flagged by a naive set and all three are correct Traditional), while
`s2twp(shipped) === shipped` is satisfied by exactly one condition — the
conversion ran to completion on the rows it was supposed to run on.

All 93 converted rows are verified to be fixed points, and 0 of the 826 are
expected to be.
"""

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup
from opencc import OpenCC

BASE = Path(__file__).parent.parent
API = "https://pokeapi.co/api/v2"
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"
OUTPUT_MOVES = BASE / "assets" / "data" / "moves_zh.json"
OUTPUT_LEARNSETS = BASE / "assets" / "data" / "learnsets.json"
OUTPUT_LEARNERS = BASE / "assets" / "data" / "move_learners.json"
OUTPUT_LEARNERS_COUNT = BASE / "assets" / "data" / "move_learners_count.json"
INFOPOKE_CACHE = BASE / "data-sources" / "infopoke-moves.html"
INFOPOKE_URL = "https://infopoke.net/zh-tw/moves"

MAX_ID = 1025
PAGE_SIZE = 1000
MAX_RETRIES = 4
TIMEOUT = 30.0
MAX_WORKERS = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pokemon-algorithm/1.0)"}

# learn method -> learnsets.json key
METHODS = {"level-up": "level", "machine": "machine", "egg": "egg", "tutor": "tutor"}

# The four learn methods in table order. A literal, because build_move_learners
# emits all four on every move rather than only the ones present — see its
# docblock for why an absent key is a different claim from an empty one.
LEARN_METHODS = ("level", "machine", "egg", "tutor")

# Ids at or above this are the `shadow-*` block: no zh-hant name in any language
# PokeAPI carries, no effect text anywhere, and no core-game Pokemon learns them.
# They are a Legends-Arceus-only internal, not a move a reader can look up, so
# they are excluded from every output rather than shipped as English rows.
SHADOW_BLOCK_START = 10001

# zh-hant flavour text exists for four version groups and they do not always say
# the same thing. This is a preference order, not an assumption of completeness —
# a move with only sun-moon text still gets its text, from further down the list.
FLAVOUR_VG_PREFERENCE = (
    "sword-shield",
    "lets-go-pikachu-lets-go-eevee",
    "ultra-sun-ultra-moon",
    "sun-moon",
)

# InfoPoke's row for move 552 (Ember) is [id, name, type, class, power, accuracy,
# pp, effect]. Only columns 0 and 7 are read — see the docblock on why its other
# columns are not trusted.
INFOPOKE_COLUMNS = 8

# TM/HM/TR item names encode the in-game machine number: tm00, hm07, tr09.
MACHINE_ITEM = re.compile(r"^(?:tm|hm|tr)(\d+)$")

client = httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS, http2=False)


def get(path: str, **params) -> dict:
    """GET one PokeAPI resource, retrying with linear backoff.

    `path` may be a bare resource ("move/33") or one of the absolute URLs that
    the list endpoints hand back in their `url` fields.
    """
    url = path if path.startswith("http") else f"{API}/{path.lstrip('/')}"
    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url, params=params or None)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(0.6 * attempt)
    raise SystemExit(f"FAIL: could not fetch {path} after {MAX_RETRIES} tries: {last}")


def resource_id(url: str) -> int:
    return int(url.rstrip("/").split("/")[-1])


def list_all(path: str) -> List[dict]:
    """Follow a paginated list endpoint to the end and return every record."""
    out: List[dict] = []
    offset = 0
    while True:
        page = get(path, limit=PAGE_SIZE, offset=offset)
        results = page.get("results", [])
        out.extend(results)
        if len(results) < PAGE_SIZE or len(out) >= page.get("count", 0):
            return out
        offset += PAGE_SIZE


def paged(details: List[dict], label: str) -> List[dict]:
    """Fetch each record concurrently, reporting progress every 250 items."""
    done = 0
    out: List[dict] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for item in pool.map(lambda r: get(r["url"]), details):
            out.append(item)
            done += 1
            if done % 250 == 0 or done == len(details):
                print(f"  {label}: {done}/{len(details)}", flush=True)
    return out


def generation_number(name: str) -> int:
    """'generation-ix' -> 9."""
    match = re.fullmatch(r"generation-([ivx]+)", name)
    if not match:
        return 0
    return {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9}[match.group(1)]


def build_version_rank() -> Dict[int, Tuple[int, int, int]]:
    """Map version group id -> sort key, so 'most recent' is well defined.

    Sorted by generation, then the version group's own order field, then id.
    """
    groups = paged(list_all("version-group"), "version groups")
    rank: Dict[int, Tuple[int, int, int]] = {}
    for group in groups:
        gen = generation_number(group.get("generation", {}).get("name", ""))
        rank[group["id"]] = (gen, group.get("order") or 0, group["id"])
    return rank


def flatten_text(text: Optional[str]) -> Optional[str]:
    """Collapse a flavour entry's whitespace to single spaces.

    PokeAPI uses `\\n` for the in-game line break and `\\f` for the page break
    around it; InfoPoke writes the same sentence with a space. Collapsing both to
    one form is what lets a row's provenance be compared against its content.
    """
    if text is None:
        return None
    return " ".join(text.split())


def zh_flavour(move: dict) -> tuple:
    """(text, version_group_name) for the best zh-hant flavour entry, or (None, None).

    `effect_entries` is English-only on PokeAPI, so this is the Traditional
    source — and for ids 1-826 it is the same sentence InfoPoke publishes, in
    Traditional rather than Simplified.
    """
    entries = [
        e for e in move["flavor_text_entries"] if e["language"]["name"] == "zh-hant"
    ]
    by_vg = {e["version_group"]["name"]: e for e in entries}
    for vg in FLAVOUR_VG_PREFERENCE:
        if vg in by_vg:
            return flatten_text(by_vg[vg]["flavor_text"]), vg
    if entries:
        # An unlisted version group still beats shipping nothing. This branch
        # existing at all is asserted by check_moves_data.mjs, because a move
        # quietly moving to a fifth zh-hant version group changes what the page
        # says and nothing else would notice.
        first = entries[0]
        return flatten_text(first["flavor_text"]), first["version_group"]["name"]
    return None, None


def pair_or_none(low: Optional[int], high: Optional[int]) -> Optional[List[int]]:
    """[min, max] when the move varies, None when it does not.

    Kept as a pair because `max_hits: null, min_hits: 2` means "at least twice"
    and flattening that to a scalar would print "2 times" — a different claim.
    """
    if low is None and high is None:
        return None
    return [low, high]


def build_moves() -> Tuple[Dict[int, dict], Dict[int, dict]]:
    """Every non-shadow move's definition, zh-hant name and zh-hant effect.

    Returns (shipped, excluded). `excluded` is the shadow block, kept so main()
    can assert the REASON it is excluded still holds rather than asserting the
    exclusion happened — a `startswith("shadow-")` test is wrong here, because
    Shadow Ball, Shadow Claw, Shadow Punch, Shadow Force and Shadow Bone are
    ordinary moves that happen to start with the same four letters.

    Emits all 919 non-shadow moves, not only the ones our 1025 reference: a
    招式 page is a database, and Z-moves, Max Moves and sigils are catalogue
    entries even though no Pokemon learns them. `learners` is filled in later,
    from the learnset pass, because a move with no learners is a normal row and
    not a reason to drop it.
    """
    print("fetching moves", flush=True)
    raw = paged(list_all("move"), "moves")
    out: Dict[int, dict] = {}
    excluded: Dict[int, dict] = {}
    for move in raw:
        if move["id"] >= SHADOW_BLOCK_START:
            excluded[move["id"]] = move
            continue
        zh = next(
            (n["name"] for n in move["names"] if n["language"]["name"] == "zh-hant"),
            None,
        )
        effect, effect_version = zh_flavour(move)
        meta = move.get("meta") or {}
        out[move["id"]] = {
            "en": move["name"],
            "zh": zh,
            "type": move["type"]["name"],
            "class": move["damage_class"]["name"],
            "power": move.get("power"),
            "accuracy": move.get("accuracy"),
            "pp": move.get("pp"),
            "priority": move.get("priority"),
            "target": move["target"]["name"],
            "generation": generation_number(move["generation"]["name"]),
            "category": (meta.get("category") or {}).get("name"),
            "ailment": (meta.get("ailment") or {}).get("name"),
            "hits": pair_or_none(meta.get("min_hits"), meta.get("max_hits")),
            "turns": pair_or_none(meta.get("min_turns"), meta.get("max_turns")),
            "drain": meta.get("drain"),
            "heal": meta.get("healing"),
            "effect": effect,
            "effectSource": "pokeapi-zh-hant" if effect else None,
            "effectVersion": effect_version,
        }
    return out, excluded


def build_machine_numbers(vg_rank: Dict[int, Tuple[int, int, int]]) -> Dict[Tuple[int, int], str]:
    """(move id, version group id) -> machine code, from all /machine records.

    PokeAPI has no `machine_number` field; the number is only encoded in the
    item's name (`tm00`, `hm07`, `tr09`). The same item is reused across
    generations — item `tm01` is a different move in red-blue than in
    gold-silver — which is exactly the per-generation numbering we want, since
    the caller keeps the most recent version group for each move.

    The whole code is kept, not just the number, because the number alone is
    ambiguous: PokeAPI ships 8 HMs (hm01-hm08), 230 TMs (tm00-tm99) and 100 TRs
    (tr00-tr99), and the TR range overlaps the TM range entirely. Storing `9`
    would render `tr09` as "TM09". `item.name.upper()` is already the label a
    player sees on the machine, and is zero-padded by PokeAPI.
    """
    print("fetching machines", flush=True)
    machines = paged(list_all("machine"), "machines")
    table: Dict[Tuple[int, int], str] = {}
    unparsable = []
    for machine in machines:
        name = machine["item"]["name"]
        match = MACHINE_ITEM.match(name)
        if not match:
            unparsable.append(name)
            continue
        key = (resource_id(machine["move"]["url"]), resource_id(machine["version_group"]["url"]))
        table[key] = name.upper()
    if unparsable:
        raise SystemExit(
            f"FAIL: {len(unparsable)} machine items do not encode a TM/HM/TR number "
            f"(expected e.g. 'tm01'): {sorted(set(unparsable))[:10]}"
        )
    return table


def build_learnsets(
    moves: Dict[int, dict], machine_numbers: Dict[Tuple[int, int], str], vg_rank: Dict[int, Tuple[int, int, int]]
) -> Dict[int, dict]:
    """Union each learn method across every version group, per Pokemon."""
    print("fetching pokemon", flush=True)
    details = paged(list_all("pokemon"), "pokemon")
    by_id = {pokemon["id"]: pokemon for pokemon in details}
    missing = [i for i in range(1, MAX_ID + 1) if i not in by_id]
    if missing:
        raise SystemExit(f"FAIL: PokeAPI is missing pokemon ids {missing[:10]}")

    learnsets: Dict[int, dict] = {}

    for pid in range(1, MAX_ID + 1):
        pokemon = by_id[pid]
        # method key -> move id -> best value seen for that move
        picked: Dict[str, Dict[int, object]] = {key: {} for key in METHODS.values()}
        best_tm_rank: Dict[int, Tuple[Tuple[int, int, int], int, int]] = {}

        for entry in pokemon["moves"]:
            move_id = resource_id(entry["move"]["url"])
            for detail in entry["version_group_details"]:
                method = METHODS.get(detail["move_learn_method"]["name"])
                if method is None:
                    continue
                vg_id = resource_id(detail["version_group"]["url"])

                if method == "level":
                    level = detail.get("level_learned_at")
                    # A level of 0 means "not by levelling up"; the union wants
                    # the lowest level the move was genuinely taught at.
                    if not level:
                        continue
                    seen = picked["level"].get(move_id)
                    if seen is None or level < seen:
                        picked["level"][move_id] = level
                elif method == "machine":
                    number = machine_numbers.get((move_id, vg_id))
                    if number is None:
                        continue
                    rank = vg_rank.get(vg_id, (0, 0, vg_id))
                    current = best_tm_rank.get(move_id)
                    if current is None or rank > current[0]:
                        best_tm_rank[move_id] = (rank, number, rank[0])
                else:
                    picked[method][move_id] = True

        for move_id, (rank, number, gen) in best_tm_rank.items():
            picked["machine"][move_id] = (number, gen)

        learnsets[pid] = {
            "level": sorted(
                ([mid, lvl] for mid, lvl in picked["level"].items()),
                key=lambda row: (row[1], row[0]),
            ),
            "machine": sorted(
                ([mid, num, gen] for mid, (num, gen) in picked["machine"].items()),
                key=lambda row: (row[1], row[0]),
            ),
            "egg": sorted(picked["egg"]),
            "tutor": sorted(picked["tutor"]),
        }

    return learnsets


def referenced_move_ids(learnsets: Dict[int, dict]) -> set:
    """Every move id any tab points at, across both encodings."""
    used = set()
    for entry in learnsets.values():
        for method, rows in entry.items():
            for row in rows:
                # level/machine rows are [moveId, value]; egg/tutor are bare ids.
                used.add(row[0] if isinstance(row, list) else row)
    return used


def fetch_infopoke_moves_html() -> str:
    """The cached InfoPoke moves page, fetching it if the cache is missing.

    InfoPoke is a Nuxt SSR page with no version guarantee on its markup, so the
    response is cached under data-sources/ (gitignored, like the form-stats
    cache) and the cached copy is what a re-run reads. That makes an ordinary
    re-run reproducible and makes the parse's failure mode "the cache went
    stale", not "the page changed under us mid-run".
    """
    if INFOPOKE_CACHE.exists():
        return INFOPOKE_CACHE.read_text(encoding="utf-8")

    last: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(INFOPOKE_URL)
            response.raise_for_status()
            INFOPOKE_CACHE.parent.mkdir(parents=True, exist_ok=True)
            INFOPOKE_CACHE.write_text(response.text, encoding="utf-8")
            return response.text
        except httpx.HTTPError as exc:
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(0.6 * attempt)
    raise SystemExit(f"FAIL: could not fetch {INFOPOKE_URL}: {last}")


def infopoke_effects() -> Dict[int, str]:
    """{move id: Simplified-Chinese effect} from InfoPoke's moves table.

    Two columns are read and the other six are discarded, which is the whole
    argument in the docblock: its numbers and its names are less trustworthy
    than what PokeAPI already gave us, and its effect sentence is the only field
    we cannot get in Traditional from anywhere else.

    A row whose column count is not INFOPOKE_COLUMNS is skipped rather than
    guessed at, and the count of skipped rows is returned to the caller so a
    restructured table surfaces as a number instead of as 93 missing effects.
    """
    print("reading InfoPoke effect text", flush=True)
    soup = BeautifulSoup(fetch_infopoke_moves_html(), "lxml")
    out: Dict[int, str] = {}
    skipped = 0
    for tr in soup.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) != INFOPOKE_COLUMNS:
            if cells:
                skipped += 1
            continue
        raw_id = cells[0].get_text(strip=True)
        if not raw_id.isdigit():
            continue
        effect = flatten_text(cells[7].get_text(" ", strip=True))
        if not effect or effect == "—":
            continue
        out[int(raw_id)] = effect
    if skipped:
        print(f"  note: {skipped} InfoPoke rows had {INFOPOKE_COLUMNS} columns minus this many and were skipped")
    return out


def fill_missing_effects(moves: Dict[int, dict]) -> Dict[int, int]:
    """Fill the no-zh-hant-flavour rows from InfoPoke, converted s2twp.

    826 of 919 moves already carry a Traditional sentence from PokeAPI; the
    remaining 93 are the whole of Generation 9, which PokeAPI has no zh-hant
    flavour entry for. Converting only what PokeAPI does not have is the point —
    running 826 rows through OpenCC would be both slower and no more correct.
    """
    missing = sorted(mid for mid, m in moves.items() if not m["effect"])
    if not missing:
        return {}
    print(f"filling {len(missing)} effect rows from InfoPoke", flush=True)

    infopoke = infopoke_effects()
    converter = OpenCC("s2twp")
    counts = {"infopoke-s2twp": 0}
    still_missing: List[int] = []
    for mid in missing:
        text = infopoke.get(mid)
        if not text:
            still_missing.append(mid)
            continue
        moves[mid]["effect"] = converter.convert(text)
        moves[mid]["effectSource"] = "infopoke-s2twp"
        moves[mid]["effectVersion"] = "infopoke"
        counts["infopoke-s2twp"] += 1

    if still_missing:
        raise SystemExit(
            f"FAIL: {len(still_missing)} moves have no effect text from either source: "
            f"{still_missing[:10]}. Either PokeAPI added zh-hant flavour entries (then the "
            "split is stale and this should not fire) or InfoPoke's table changed shape."
        )
    return counts


def build_move_learners(learnsets: Dict[int, dict]) -> Dict[int, dict]:
    """Invert learnsets.json: move id -> the Pokemon that learn it.

    Only the POKEMON ids are kept, not the level or the TM code — the reverse
    index answers 「誰學得會」, and the per-Pokemon detail lives in learnsets.json
    where it already is.

    All four method keys are emitted on every move, empty ones included. A move
    with only a machine row gets `level: []`, not a missing key, because the two
    answers are different claims and the reader is the one who has to know which
    one they are looking at: "nobody learns it by levelling up" is a fact about
    the game, while a missing key is a fact about this file. Both the page and
    check_moves_data.mjs would otherwise need a `?? 0` at every read, and one of
    them would eventually forget.
    """
    out: Dict[int, Dict[str, List[int]]] = {}
    for pid, entry in learnsets.items():
        for method, rows in entry.items():
            for row in rows:
                mid = row[0] if isinstance(row, list) else row
                out.setdefault(mid, {}).setdefault(method, []).append(pid)
    return {
        mid: {method: sorted(slots.get(method, [])) for method in LEARN_METHODS}
        for mid, slots in sorted(out.items())
    }


def build_learners_count(learners: Dict[int, dict]) -> Dict[int, dict]:
    """The counts-only companion, from the same pass as the full index.

    `total` is the number of DISTINCT Pokemon, not the sum of the four methods,
    and that is not a detail. 473 of the 782 moves are learned by at least one
    Pokemon through two methods — because learnsets.json is a union over every
    generation, so a move that was a TM in Gen 4 and a level-up in Gen 5 is
    counted twice for that Pokemon. Move 809 is the shape: 44 on machines + 36
    from tutors, but only 55 distinct Pokemon. Summing would print 「80 隻可學」
    for a move 55 Pokemon can learn, and the reader cannot see which of the two
    numbers was meant.

    The four per-method counts are still reported as-is, including the overlap —
    「44 學得到、36 傳授得到、55 隻寶可夢」 is the true and useful reading, and it
    is what move.html's four tabs add up to on screen.

    Generated rather than written by hand so the two files cannot disagree: a
    「N 隻可學」 that disagrees with the list it links to is the defect this split
    is most likely to introduce.
    """
    return {
        mid: {
            **{method: len(ids) for method, ids in slots.items()},
            "total": len({pid for ids in slots.values() for pid in ids}),
        }
        for mid, slots in learners.items()
    }


def main() -> None:
    started = datetime.now(timezone.utc)
    vg_rank = build_version_rank()
    moves, shadow_block = build_moves()
    effect_sources = fill_missing_effects(moves)
    machine_numbers = build_machine_numbers(vg_rank)
    learnsets = build_learnsets(moves, machine_numbers, vg_rank)

    used = referenced_move_ids(learnsets)
    unknown = sorted(mid for mid in used if mid not in moves)
    if unknown:
        raise SystemExit(f"FAIL: learnsets reference unknown move ids {unknown[:10]}")

    # Every SHIPPED row, not just the ones a Pokemon learns. The old check only
    # covered the 782, so a shadow block or a Z-move could have shipped
    # untranslated without this firing — and the file's whole claim is that its
    # zh coverage is 100%.
    untranslated = sorted(mid for mid, m in moves.items() if not m["zh"])
    if untranslated:
        names = ", ".join(moves[mid]["en"] for mid in untranslated)
        raise SystemExit(
            f"FAIL: {len(untranslated)} shipped moves have no zh-hant name: {names}. "
            "Either PokeAPI dropped a translation or the shadow block moved below "
            "SHADOW_BLOCK_START; add an explicit override rather than shipping English."
        )

    # The shadow block is excluded by id, and this asserts the REASON rather than
    # the exclusion: a block we skip because no Pokemon learns it and no language
    # names it should stop being skipped the moment either becomes true. Comparing
    # the reason to the current data is the only version of this that can fail
    # for a reason worth hearing.
    recoverable = []
    for mid, move in shadow_block.items():
        zh = next(
            (n["name"] for n in move["names"] if n["language"]["name"] == "zh-hant"),
            None,
        )
        has_flavour = any(
            e["language"]["name"] == "zh-hant" for e in move["flavor_text_entries"]
        )
        if zh or has_flavour or mid in used:
            recoverable.append(move["name"])
    if recoverable:
        raise SystemExit(
            f"FAIL: {len(recoverable)} moves at id >= {SHADOW_BLOCK_START} are now "
            f"translatable or learnable and should ship: {recoverable[:10]}. "
            "They were excluded as unnameable and unlearnable; raise SHADOW_BLOCK_START "
            "or add explicit overrides rather than continuing to skip them."
        )

    # Ship all 919, not only the 782 our Pokemon reference: a 招式 page is a
    # database, and a move no Pokemon can learn is still a catalogue entry.
    move_out = {str(mid): moves[mid] for mid in sorted(moves)}
    learnset_out = {str(pid): learnsets[pid] for pid in sorted(learnsets)}
    learners = build_move_learners(learnsets)
    # Only moves a Pokemon actually reaches get an entry here, so an absent key
    # means 「沒有寶可夢學得會」 rather than 「四種方式都是空的」.
    learners_out = {str(mid): slots for mid, slots in learners.items()}
    # The counts file DOES carry every move, all four methods, explicit zeros —
    # because the list page renders a 「N 隻可學」 on all 919 rows and every one of
    # those reads has to distinguish a real 0 from an absent key.
    count_out: Dict[int, dict] = {
        mid: {method: 0 for method in LEARN_METHODS} | {"total": 0}
        for mid in moves
    }
    count_out.update(build_learners_count(learners))

    totals = {key: sum(len(e[key]) for e in learnsets.values()) for key in METHODS.values()}
    empty = {
        key: sum(1 for e in learnsets.values() if not e[key])
        for key in METHODS.values()
    }
    for mid, row in move_out.items():
        if mid == "_meta":
            continue
        row["learners"] = count_out[int(mid)]["total"]

    meta = {
        "source": API,
        "generated": started.replace(microsecond=0).isoformat(),
        "pokemon": len(learnset_out),
        "moves": len(move_out),
        "moves_referenced": len(used),
        "effect_sources": {
            "pokeapi-zh-hant": sum(
                1 for mid, m in moves.items() if m["effectSource"] == "pokeapi-zh-hant"
            ),
            **effect_sources,
        },
        "rows_per_method": totals,
        "pokemon_with_none": empty,
    }
    move_out["_meta"] = meta
    learnset_out["_meta"] = meta
    learners_out["_meta"] = meta
    count_out["_meta"] = meta

    # indent=2 to match every other file in assets/data/. The compact
    # separators this started with produced a 1.2 MB single line, which git
    # can only ever show as one changed line -- any later edit to a single
    # learnset would rewrite the whole file and make the diff unreadable.
    # A trailing newline is likewise the convention in the tracked files.
    #
    # The two learner indexes are the EXCEPTION, and the reason is the argument
    # above rather than a preference: neither file is ever hand-edited — both are
    # inverted out of learnsets.json by the pass that just ran, and a human
    # editing one would be editing a copy — so the diff-readability this buys
    # moves_zh.json and learnsets.json does not apply to them, while the cost
    # does: indent=2 puts every Pokemon id on its own line and inflates
    # move_learners.json from 409 KB to 1130 KB, which is a quarter the size of
    # the 4.4 MB learnsets.json it exists to avoid fetching. A file whose whole
    # reason to exist is to be smaller than another file should not be the one
    # paying a 2.8x formatting tax to look like its neighbours.
    for path in (
        OUTPUT_MOVES,
        OUTPUT_LEARNSETS,
        OUTPUT_LEARNERS,
        OUTPUT_LEARNERS_COUNT,
    ):
        path.parent.mkdir(parents=True, exist_ok=True)

    def dump(path: Path, payload: dict, indent) -> None:
        text = (
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            if indent is None
            else json.dumps(payload, ensure_ascii=False, indent=indent)
        )
        path.write_text(text + "\n", encoding="utf-8")

    dump(OUTPUT_MOVES, move_out, 2)
    dump(OUTPUT_LEARNSETS, learnset_out, 2)
    dump(OUTPUT_LEARNERS, learners_out, None)
    dump(OUTPUT_LEARNERS_COUNT, count_out, None)

    print(f"\nversion groups   : {len(vg_rank)}")
    print(f"moves shipped    : {len(move_out) - 1}  referenced by our 1025: {len(used)}")
    print(f"shadow block     : {len(shadow_block)} excluded (unnameable, unlearnable)")
    for src, n in sorted(meta["effect_sources"].items()):
        print(f"  effect {src:<18} {n:>4}")
    print(f"machine records  : {len(machine_numbers)}")
    print(f"pokemon          : {len(learnsets)}")
    for key in METHODS.values():
        print(f"  {key:<8} rows: {totals[key]:>7}   pokemon with none: {empty[key]}")
    for path in (OUTPUT_MOVES, OUTPUT_LEARNSETS, OUTPUT_LEARNERS, OUTPUT_LEARNERS_COUNT):
        print(f"wrote {path.relative_to(BASE)} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
