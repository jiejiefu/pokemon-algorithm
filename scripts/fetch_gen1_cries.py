#!/usr/bin/env python3
"""Fetch the Generation I cry table and its 38 base sound effects from pret/pokered.

Writes two files:

  assets/data/gen1_cries.json    151 rows of {id, base, sfx, pitch, length}
  assets/data/gen1_cry_sfx.json  38 base cry command lists, 3 channels each

Neither the .asm sources nor any preprocessed copy of them are vendored. The
upstream tree is small, stable and public, so the same rule the rest of this
repo follows applies: parse at build time, track only the JSON each script
produces (the reason moves_zh.json and type-chart.js are JSON modules rather
than checked-in spreadsheets or HTML).

WHY THE TABLE IS JOINED BY NAME, NOT BY POSITION
-------------------------------------------------
cries.asm holds 190 `mon_cry` rows between `CryData::` and
`assert_table_length NUM_POKEMON_INDEXES`: 151 real species and 39 rows of
`MissingNo.` padding. The rows are not in Pokédex order and are not close to
it. Measured against pokemon_data.json, 150 of the 151 rows sit at an index
that is not their id, and the largest drift is 139 places -- row 1 is Rhyhon
(id 112), not Bulbasaur. The table is unordered from its very first row, so
"take the Nth row for id N" misassigns essentially every species rather than
shifting a tail section. The `; Name` comment on each row is the only link.

The join key is `names.en` lowercased with every non-alphanumeric character
removed, because the two sides disagree on punctuation: upstream writes
`Mr.Mime` and pokemon_data.json writes `Mr. Mime` (id 122). A hardcoded alias
table would be the wrong fix -- it fails silently and invisibly the day
upstream respells a name, whereas normalising makes the mismatch show up as a
name that matches nothing. Ambiguity is checked rather than assumed away: if
two species ever normalise to the same key, that is an error, not a coin flip.

WHY 38 BASES AND NOT 114 FILES
------------------------------
Each base cry exists upstream as three files, cry{NN}_1.asm through
cry{NN}_3.asm, and all three are byte-identical apart from the _1/_2/_3 in
their labels (verified by diff). They are three link entries for one sound,
not three variants. So the JSON stores 38 command lists and check_gen1_cries
asserts the replicas still agree -- if upstream ever diverges them, the
assumption this file's shape rests on has stopped being true and the checker
says so instead of the reader finding out from a wrong playback.

The 38 figure is the one in the reference article "Generation I Pokémon Cries
Explained", and it is what the upstream table actually uses.

CASE IS THE WHOLE TRAP HERE
---------------------------
The constants in cries.asm are uppercase hex (SFX_CRY_1A) and the filenames
are lowercase (cry1a_1.asm). A case-insensitive or case-sloppy mapping looks
right for the ten all-digit bases and 404s for the other twenty-eight.

Usage:
    python scripts/fetch_gen1_cries.py            # write both JSON files
    python scripts/fetch_gen1_cries.py --dry-run  # parse and report, write nothing
    python scripts/fetch_gen1_cries.py --source path/to/cries.asm
        # read the table from a local file instead of the network; the SFX files
        # still come from upstream unless --sfx-dir points at a local mirror.
        # test_check_gen1_cries.mjs uses these to prove the join is
        # order-independent by shuffling the rows and diffing the output.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_CRIES = ROOT / "assets" / "data" / "gen1_cries.json"
OUT_SFX = ROOT / "assets" / "data" / "gen1_cry_sfx.json"

REPO = "https://raw.githubusercontent.com/pret/pokered/master"
CRY_TABLE_URL = f"{REPO}/data/pokemon/cries.asm"
SFX_URL = f"{REPO}/audio/sfx/cry{{}}_{{}}.asm"
SFX_DIR_URL = f"{REPO}/audio/sfx"

#: The two constants below are pinned rather than discovered, and
#: check_gen1_cries.mjs asserts the generated files still carry them. A URL that
#: silently changes host is how a generator ends up parsing an error page.
EXPECTED_TABLE_HOST = "raw.githubusercontent.com"
EXPECTED_TABLE_PATH = "/pret/pokered/master/data/pokemon/cries.asm"

#: A row of CryData. Group 1 is the SFX constant, groups 2 and 3 are the pitch
#: and length bytes, group 4 is the English name the row is matched on.
ROW_RE = re.compile(
    r"^\s*mon_cry\s+(SFX_CRY_[0-9A-F]+)\s*,\s*\$([0-9A-F]{2})\s*,\s*\$([0-9A-F]{2})\s*;\s*(.+?)\s*$"
)

#: cry1a_1.asm -> SFX_Cry1A_1_Ch5:
CHANNEL_RE = re.compile(r"^SFX_Cry([0-9A-Fa-f]{2})_(\d)_Ch(\d+):\s*$")

#: The same label as a `sound_loop` target, i.e. without the trailing colon.
#: The _1/_2/_3 in the label is which of the three identical copies the file is,
#: so a loop target written as SFX_Cry0D_2_Ch5 in cry0d_2.asm means the same
#: thing as SFX_Cry0D_1_Ch5 in cry0d_1.asm. Storing the raw label would make the
#: three replicas compare unequal for a difference that is not one.
LOOP_TARGET_RE = re.compile(r"^SFX_Cry([0-9A-Fa-f]{2})_(\d)_Ch(\d+)$")

#: The five commands the Game Boy cry format uses, plus one upstream synonym.
#: Anything else in a cry file is an error rather than something to skip: a
#: silently skipped line is how a regenerated JSON quietly loses a channel's
#: worth of notes.
#:
#: `duty_cycle N` appears exactly once in the whole upstream tree (cry02_1.asm)
#: and is the older single-value spelling of the same thing -- the reference
#: article notes that a non-alternating pattern is expressed by repeating the
#: duty four times. It is normalised to the four-value form here so that a
#: renderer has one shape to handle, and the checker asserts the expansion.
#:
#: `sound_loop`'s second operand is a label, not a literal address; it is stored
#: as written and resolved by the consumer.
COMMAND_RES = {
    "duty_cycle_pattern": re.compile(r"^duty_cycle_pattern\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$"),
    "duty_cycle": re.compile(r"^duty_cycle\s+(\d+)\s*$"),
    "square_note": re.compile(r"^square_note\s+(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*$"),
    "noise_note": re.compile(r"^noise_note\s+(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*$"),
    "sound_loop": re.compile(r"^sound_loop\s+(\d+)\s*,\s*(\S+)\s*$"),
    "sound_ret": re.compile(r"^sound_ret\s*$"),
}

#: Ch5 and Ch6 are the two pulse channels; Ch8 is the noise channel. The wave
#: channel (Ch7) is unused for cries -- the reference article notes the whole
#: wave channel goes unused for this purpose -- so it is not in this set and its
#: absence from a file is not expected but its presence would be unexplained.
EXPECTED_CHANNELS = (5, 6, 8)

MISSING_NO = "MissingNo."


#: Transliterated rather than stripped. Nidoran♀ (id 29) and Nidoran♂ (id 32)
#: differ only by these two symbols, and both sides of the join carry them, so
#: dropping them as "non-alphanumeric" collapses two species onto one key. The
#: ambiguity check below catches that collision, but the fix is to keep the
#: distinction in ASCII, not to resolve the tie arbitrarily.
SYMBOL_KEYS = {"♀": "f", "♂": "m"}


def name_key(name: str) -> str:
    """The join key: gender symbols transliterated, then lowercase alphanumerics.

    Two separate hazards live here, both found by running the join rather than
    reading it:

      Mr.Mime vs Mr. Mime  -- punctuation differs between the two sources, so
        punctuation is removed.
      Nidoran♀ vs Nidoran♂ -- the only difference is a symbol, and removing it
        would merge two species, so symbols are transliterated first.

    Getting either backwards produces a plausible-looking file that is wrong,
    which is why load_gen1_names() refuses to return an ambiguous key.
    """
    for symbol, replacement in SYMBOL_KEYS.items():
        name = name.replace(symbol, replacement)
    return re.sub(r"[^a-z0-9]", "", name.lower())


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "pokemon-algorithm/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def parse_table(text: str) -> list[dict]:
    """Extract the mon_cry rows from cries.asm, padding rows included.

    Rows are returned in file order and tagged with their 0-based position so
    the caller can see how far the table is from Pokédex order. Nothing is
    sorted or keyed by that position: doing so is the bug this docstring is
    about.
    """
    lines = text.splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == "CryData::")
    except StopIteration:
        raise SystemExit("cries.asm has no CryData:: label -- is this the right file?")

    # `table_width 3` sits between the label and the first row, and `; base cry,
    # pitch, length` heads the table. Both are structure, not data: the width is
    # checked against the number of db columns the macro writes, and comments are
    # skipped like any other. Anything else in this span has to be a row, because
    # a cry the parser cannot read is a species that silently loses its cry.
    TABLE_DIRECTIVES = {"table_width 3"}

    try:
        end = next(
            i for i, l in enumerate(lines)
            if i > start and l.strip().startswith("assert_table_length")
        )
    except StopIteration:
        raise SystemExit("cries.asm has no assert_table_length after CryData::")

    rows = []
    for lineno in range(start + 1, end):
        line = lines[lineno]
        stripped = line.strip()
        if not stripped or stripped.startswith(";") or stripped in TABLE_DIRECTIVES:
            continue
        m = ROW_RE.match(line)
        if not m:
            raise SystemExit(
                f"cries.asm:{lineno + 1}: unparsed row in CryData -- refusing to skip it\n"
                f"  {line!r}\n"
                "If upstream changed the mon_cry format this needs a real parser change, "
                "not a filter that drops what it does not understand."
            )
        rows.append({
            "sfx": m.group(1),
            "pitch": int(m.group(2), 16),
            "length": int(m.group(3), 16),
            "name": m.group(4),
            "rowIndex": len(rows),
            "lineno": lineno + 1,
        })
    return rows


def load_gen1_names() -> dict[str, list[int]]:
    """Map normalised names.en -> the ids that claim it, for ids 1..151 only.

    Returns a dict of key -> list of ids rather than key -> id so that a
    collision is visible to the caller instead of being resolved by whichever
    species happened to be read last.
    """
    data = json.loads((ROOT / "assets" / "data" / "pokemon_data.json").read_text("utf-8"))
    table: dict[str, list[int]] = {}
    for p in data:
        if p["id"] > 151:
            continue
        table.setdefault(name_key(p["names"]["en"]), []).append(p["id"])
    return table


def resolve_cries(rows: list[dict]) -> tuple[list[dict], dict]:
    """Join the 151 real rows to their species ids by name.

    MissingNo. rows are dropped, not joined: they exist so the table indexes to
    NUM_POKEMON_INDEXES, they name no species, and matching them would need a
    rule that cannot be right.
    """
    names = load_gen1_names()

    ambiguous = {k: v for k, v in names.items() if len(v) > 1}
    if ambiguous:
        raise SystemExit(
            f"names.en normalises to the same key for {len(ambiguous)} species "
            f"in 1..151: {ambiguous}\nThe join key is no longer unique, so matching by "
            "it would be a guess."
        )

    real = [r for r in rows if r["name"] != MISSING_NO]
    cries, unmatched = [], []
    for row in real:
        ids = names.get(name_key(row["name"]))
        if not ids:
            unmatched.append(f"{row['name']!r} (cries.asm:{row['lineno']})")
            continue
        cries.append({
            "id": ids[0],
            "sfx": row["sfx"],
            "pitch": row["pitch"],
            "length": row["length"],
            "_rowIndex": row["rowIndex"],
        })

    if unmatched:
        raise SystemExit(
            f"{len(unmatched)} CryData rows name no species in 1..151:\n  "
            + "\n  ".join(unmatched)
            + "\nDropping them would quietly shrink the table below 151 species, so "
            "this stops instead."
        )

    distinct_sfx = sorted({c["sfx"] for c in cries}, key=lambda s: int(s.rsplit("_", 1)[1], 16))
    base_of = {sfx: i for i, sfx in enumerate(distinct_sfx)}
    for c in cries:
        c["base"] = base_of[c["sfx"]]

    ordered = sorted(cries, key=lambda c: c["id"])
    # Reported, never used for the join. This is the number that shows why the
    # join exists: for how many species the row's position in the file is not its
    # dex id. Comparing against the id (rather than against the species' rank
    # among the 151) is the comparison that matters -- it is the one a positional
    # parse would get wrong.
    misplaced = [c for c in ordered if c["_rowIndex"] != c["id"] - 1]
    return ordered, {
        "totalRows": len(rows),
        "missingNoRows": len(rows) - len(real),
        "cryCount": len(ordered),
        "baseCount": len(distinct_sfx),
        "rowsOutOfDexOrder": len(misplaced),
        "maxRowDrift": max((abs(c["_rowIndex"] - (c["id"] - 1)) for c in ordered), default=0),
    }


def sfx_filename(constant: str, variant: int) -> str:
    """SFX_CRY_1A + variant 1 -> cry1a_1.asm.

    The case change is the whole point of this function; see the module
    docstring.
    """
    digits = constant.rsplit("_", 1)[1].lower()
    if len(digits) != 2:
        raise SystemExit(f"unexpected SFX constant {constant!r}: expected two hex digits")
    return f"cry{digits}_{variant}.asm"


def sfx_url(constant: str, variant: int) -> str:
    """The upstream URL for one cry file, from the constant and variant directly.

    Taking the two apart here rather than reassembling a filename and then
    slicing it back apart is deliberate: the first version of this passed
    `cry00_1` into a template already containing `cry{}_{}.asm` and asked for
    crycry00_1_1.asm, which 404s on all 114 files and looks like an upstream
    problem rather than the string surgery it was.
    """
    digits = constant.rsplit("_", 1)[1].lower()
    return SFX_URL.format(digits, variant)


def parse_sfx(text: str, filename: str) -> dict[int, list]:
    """Parse one cry .asm into {channel: [commands]}.

    Command values are kept as the numbers the assembler wrote, not folded into
    packed bytes, because every consumer of this file (the APU page) wants the
    individual fields and a round trip through a packed byte is a chance to lose
    the volume/sweep split.
    """
    channels: dict[int, list] = {}
    current: int | None = None
    digits = filename[3:5]

    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith(";"):
            continue

        m = CHANNEL_RE.match(line)
        if m:
            current = int(m.group(3))
            if current in channels:
                raise SystemExit(f"{filename}:{lineno}: channel Ch{current} appears twice")
            channels[current] = []
            continue

        if current is None:
            raise SystemExit(f"{filename}:{lineno}: command outside any channel: {line!r}")

        op = line.split(None, 1)[0]
        pattern = COMMAND_RES.get(op)
        if pattern is None:
            raise SystemExit(
                f"{filename}:{lineno}: unknown command {op!r}\n"
                "  The cry format has five commands and this is not one of them. "
                "Skipping it would drop notes silently, so this stops."
            )
        cm = pattern.match(line)
        if not cm:
            raise SystemExit(f"{filename}:{lineno}: {op} with unexpected operands: {line!r}")

        args = [int(g) for g in cm.groups() if g.lstrip("-").isdigit()]
        if op == "duty_cycle_pattern":
            channels[current].append({"op": "duty", "pattern": args})
        elif op == "duty_cycle":
            # Expanded to the four-value form; see COMMAND_RES.
            channels[current].append({"op": "duty", "pattern": args * 4,
                                      "expandedFrom": "duty_cycle"})
        elif op == "sound_ret":
            channels[current].append({"op": "ret"})
        elif op == "sound_loop":
            label = cm.group(2)
            tm = LOOP_TARGET_RE.match(label)
            if not tm:
                raise SystemExit(
                    f"{filename}:{lineno}: sound_loop target {label!r} is not a cry "
                    "channel label, so it cannot be resolved"
                )
            if tm.group(1).lower() != digits:
                raise SystemExit(
                    f"{filename}:{lineno}: sound_loop points into cry{tm.group(1)}, "
                    f"but this file is cry{digits}"
                )
            # Stored as a channel within this base, not as the literal label, so
            # the three identical copies of a base compare equal.
            channels[current].append({"op": "loop", "count": args[0],
                                      "target": f"Ch{int(tm.group(3))}"})
        else:
            # The fade is a 4-bit SIGNED MAGNITUDE, spanning [-8, +7], and the tables
            # lean on that:
            # `square_note 12, 0, 8, 0` means "increase", not "decrease". pokered's
            # macro notes that a value of 8 is the same as a negative one, because 8
            # overflows the magnitude field into -8. Read as an
            # unsigned literal it becomes a fade OUT of a note whose volume is 0, so
            # the volume clamps at 0 and the note is silent -- which is exactly what
            # this file produced for nine notes across six bases before it was caught.
            #
            # Caught by diffing all 38 bases against the reference synthesiser's own
            # command tables: of every frames, volume, sweep, freq and duty byte in
            # all 114 channels, these nine were the only differences.
            sweep = args[2]
            if sweep > 7:
                sweep -= 16
            channels[current].append({
                "op": "pulse" if op == "square_note" else "noise",
                "frames": args[0],
                "volume": args[1],
                "sweep": sweep,
                "freq": args[3],
            })

    if not channels:
        raise SystemExit(f"{filename}: no channels found")
    return channels


def build_sfx(cries: list[dict], read_sfx) -> dict:
    """Fetch and parse all 38 base cries, and prove the three replicas agree."""
    sfx_constants = sorted(
        {c["sfx"] for c in cries}, key=lambda s: int(s.rsplit("_", 1)[1], 16)
    )

    out: dict[str, dict] = {}
    for base, constant in enumerate(sfx_constants):
        variants: dict[int, dict[int, list]] = {}
        files = []
        for variant in (1, 2, 3):
            filename = sfx_filename(constant, variant)
            files.append(filename)
            variants[variant] = read_sfx(filename, constant, variant)

        # The three files are meant to be the same sound three times over. This
        # is the assertion the whole 38-not-114 shape rests on, so it is made
        # here, at generation time, rather than only in the checker -- a
        # divergence should stop the build, not be discovered by a reader.
        first = variants[1]
        for variant in (2, 3):
            if variants[variant] != first:
                raise SystemExit(
                    f"{constant}: {files[0]} and {files[variant - 1]} no longer hold the "
                    "same commands.\nUpstream used to ship three identical copies of each "
                    "base cry; if they have diverged, one species' cry would depend on "
                    "which copy the engine happened to play."
                )

        for ch in EXPECTED_CHANNELS:
            if ch not in first:
                raise SystemExit(
                    f"{constant}: {files[0]} has no Ch{ch} (found "
                    f"{sorted(first)}).\nEvery base cry is expected to use both pulse "
                    "channels and the noise channel."
                )

        # Not every upstream channel ends with an explicit sound_ret. cry02's
        # Ch6 simply stops after its last note -- the same file that uses the
        # old `duty_cycle` spelling, so it looks like the same file having been
        # touched less carefully. Requiring a terminator everywhere would be
        # asserting something upstream does not do, so instead the exceptions
        # are recorded and the checker pins the set to exactly these. A second
        # channel losing its terminator fails there; none at all also fails,
        # because the list would be empty and the quirk would have been fixed
        # without anyone noticing the data still claims it.
        implicit_ret = [
            ch for ch in EXPECTED_CHANNELS
            if not any(c["op"] == "ret" for c in first[ch])
        ]

        out[constant] = {
            "base": base,
            "files": files,
            "implicitRet": implicit_ret,
            "channels": [
                {"ch": ch, "commands": first[ch]} for ch in sorted(first)
            ],
        }

    return {
        "source": SFX_URL,
        "baseCount": len(sfx_constants),
        "replicaCountPerBase": 3,
        "note": (
            "Upstream ships each base cry three times (cry{NN}_1..3.asm) as three link "
            "entries for one sound; the copies are command-identical and only the "
            "label suffix differs. 38 bases are stored, not 114 files. "
            "check_gen1_cries.mjs asserts the copies still agree."
        ),
        "sfx": out,
    }


def default_read_sfx(filename: str, constant: str, variant: int) -> dict[int, list]:
    return parse_sfx(fetch(sfx_url(constant, variant)), filename)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true",
                    help="parse and report without writing the JSON files")
    ap.add_argument("--source", help="read cries.asm from this path instead of the network")
    ap.add_argument("--sfx-dir", help="read cry{NN}_{V}.asm from this directory")
    args = ap.parse_args()

    if args.source:
        table_text = Path(args.source).read_text("utf-8")
    else:
        for url in (CRY_TABLE_URL, SFX_URL, SFX_DIR_URL):
            if EXPECTED_TABLE_HOST not in url:
                raise SystemExit(f"refusing to fetch an unexpected host: {url}")
        table_text = fetch(CRY_TABLE_URL)

    rows = parse_table(table_text)
    cries, stats = resolve_cries(rows)
    for c in cries:
        del c["_rowIndex"]

    if args.sfx_dir:
        def read_sfx(filename: str, _constant: str, _variant: int,
                     _d=Path(args.sfx_dir)) -> dict[int, list]:
            return parse_sfx((_d / filename).read_text("utf-8"), filename)
    else:
        read_sfx = default_read_sfx

    sfx = build_sfx(cries, read_sfx)

    print(f"cries.asm rows        : {stats['totalRows']} "
          f"({stats['cryCount']} species + {stats['missingNoRows']} MissingNo. padding)")
    print(f"rows not at dex id    : {stats['rowsOutOfDexOrder']}/{stats['cryCount']} "
          f"(largest drift {stats['maxRowDrift']} places) -- so the join is by name")
    print(f"base cries            : {stats['baseCount']}")
    print(f"sfx files parsed      : {stats['baseCount'] * 3}")

    if args.dry_run:
        print("dry run: nothing written")
        return 0

    OUT_CRIES.write_text(json.dumps({
        "source": CRY_TABLE_URL,
        "cryCount": stats["cryCount"],
        "baseCount": stats["baseCount"],
        "note": (
            "Joined to species by the `; Name` comment on each cry.asm row, matched "
            "against pokemon_data.json names.en lowercased with non-alphanumerics "
            "removed (upstream writes Mr.Mime, we write Mr. Mime). Row order carries "
            "no meaning: 150 of 151 rows sit away from their dex position, by as much "
            "as 139 places. `base` is this file's own 0-based index over the distinct "
            "SFX constants, which is stable regardless of how upstream numbers them."
        ),
        "cries": cries,
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")

    OUT_SFX.write_text(json.dumps(sfx, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"wrote {OUT_CRIES.relative_to(ROOT)}")
    print(f"wrote {OUT_SFX.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as exc:
        raise SystemExit(f"upstream fetch failed: {exc}")
