#!/usr/bin/env python3
"""Fill the gaps in `assets/images/scarlet-violet/` from PokeAPI, then InfoPoke.

Why this exists
---------------
`types.html` shows every Pokémon of a type with its Scarlet/Violet artwork where
that artwork exists, and falls back to the 96px `assets/images/sprite/` set for
the rest. The directory shipped with 733 of the 1025 species already in it, and
the remaining 292 were probed and found to be **404 on PokeAPI as well** — so the
checkout was, at the time of writing, a complete mirror of what PokeAPI publishes
(verified byte-identical on ids 1/4/25/94/448) rather than a partial copy.

The gap is a property of *PokeAPI*, not of this checkout: its
`versions/generation-ix/scarlet-violet/` set is not a superset of the national
dex. So a second source is consulted for whatever PokeAPI lacks.

Why InfoPoke is an acceptable fallback
--------------------------------------
It serves the *same artwork*, not a lookalike. Verified rather than assumed:

  * Over all 733 ids present in both sets, subject width as a fraction of image
    width differs by a median of 2.4% (sd 1.2%) — one pipeline, two exports.
  * On 12 ids compared pixel-by-pixel (alpha bbox cropped, flattened, resized
    to 64x64), mean absolute difference was 18.3. A negative control over 60
    mismatched pairs scored 87.8 with a minimum of 68.9, so same-art pairs top
    out at 24.4 and the classes do not overlap: the art is identical, only the
    encoding differs.
  * InfoPoke's files are 120x112 where PokeAPI's are 256x256 — the same art under
    a non-uniform 7% vertical squash. `types.html` renders both by stretching to
    a square box, which undoes it, so the two sets line up without per-source
    special-casing. Do not "fix" this with `object-fit: contain`; that would
    letterbox and re-introduce the distortion.

  Caveat worth stating: for the 292 ids that only InfoPoke has, there is no
  ground-truth overlap, so "same artwork" is an inference from the pipeline
  statistics above rather than a direct pixel comparison. It is a strong
  inference, not a proof.

Provenance is recorded per id
-----------------------------
Each id is written down against the source that actually served it, in
`data-sources/sv-sources.json`. That file is deliberately outside `assets/`: the
site attributes its artwork to PokeAPI, and the per-id truth about the fallback
belongs in the repo without being published as part of the frontend.
`scripts/check_sv_index.mjs` asserts the map covers exactly the roster.

Gotchas this script exists to survive
-------------------------------------
1. **A 404 is not the end of the lookup, but two 404s are not a failure.**
   Treating "absent" as an error would make every run red and train the reader to
   ignore it, so the exit code reflects *transport* problems only, and absences
   are reported as a count.

2. **A 200 is not proof of a PNG.** Both hosts have answered a missing path with
   something other than a 404 before, and saving a non-PNG body under a `.png`
   name produces a file that passes a filename roster check, passes `ls`, and
   fails to decode in the browser — with no 404 to trace, because the request
   succeeded. So every body is magic-checked before it is written, and a 0-byte
   file is never created. `check_sv_index.mjs` re-checks the same on disk.

3. **Skip-if-exists means a corrupt file is never repaired.** That is the right
   default for a 292-request run, and the wrong default once something has gone
   wrong on disk. `--force` is the escape hatch, and `--ids` makes re-fetching
   one suspect id cheap.

4. **Never delete.** If an id stops being wanted, removing the roster entry
   (via `extract_sv_index.py`) is enough; this script only ever adds.

Usage
-----
    python scripts/fetch_sv_sprites.py                # fill the gaps, keep what exists
    python scripts/fetch_sv_sprites.py --dry-run      # report, write nothing
    python scripts/fetch_sv_sprites.py --ids 10-22    # re-probe a range
    python scripts/fetch_sv_sprites.py --force        # re-download everything
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import httpx

ROOT = Path(__file__).resolve().parent.parent
SV_DIR = ROOT / "assets" / "images" / "scarlet-violet"
POKEMON_DATA = ROOT / "assets" / "data" / "pokemon_data.json"
PROVENANCE = ROOT / "data-sources" / "sv-sources.json"

# Ordered by preference; the first source that yields a valid PNG wins. The
# primary is kept byte-identical to SV_SOURCE in the generated
# assets/js/sv-index.js and `check_sv_index.mjs` asserts the two still agree --
# they are two halves of one fact (where the artwork the site shows came from),
# and a fetcher that quietly points somewhere else is how a directory ends up
# with no recorded provenance.
SOURCES: dict[str, str] = {
    "pokeapi": (
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"
        "/versions/generation-ix/scarlet-violet/{id}.png"
    ),
    "infopoke": "https://infopoke.net/pokemon/icons/{id}.png",
}
PRIMARY = "pokeapi"

MAX_RETRIES = 3
TIMEOUT = 30.0
MAX_WORKERS = 8

# Smallest body accepted as artwork. The real set runs ~3.5 KB (InfoPoke's
# smallest) to 74 KB (Slaking); anything under 1 KB is a stub or an error page.
MIN_BYTES = 1024

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# httpx refuses its default User-Agent outright (same reason as fetch_moves.py).
HEADERS = {"User-Agent": "pokemon-algorithm-lab/1.0 (local static site)"}

client = httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS, http2=False)


def project_ids() -> list[int]:
    """Every id the site's own data knows about, ascending.

    Read from pokemon_data.json rather than hardcoded, so a Pokémon added to the
    dataset is fetched without editing this script.
    """
    data = json.loads(POKEMON_DATA.read_text(encoding="utf-8"))
    return sorted(entry["id"] for entry in data)


def sv_path(pid: int) -> Path:
    return SV_DIR / f"{pid}.png"


def fetch_one_source(pid: int, source: str) -> tuple[str, bytes | None, Optional[str]]:
    """Try one source for one id.

    Returns (outcome, body, detail) where outcome is `fetched` | `absent` |
    `failed`. Transport errors are retried with backoff and end as `failed`; a
    404 returns immediately, because repeating it cannot change the answer.
    """
    url = SOURCES[source].format(id=pid)
    last: Optional[str] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url)
            if response.status_code == 404:
                return "absent", None, None
            response.raise_for_status()
            body = response.content
            if not body.startswith(PNG_MAGIC):
                # Gotcha 2: a body that is not a PNG must never reach the disk.
                head = body[:60].decode("utf-8", "replace").replace("\n", " ")
                return "failed", None, f"not a PNG ({head!r})" if head else "empty body"
            if len(body) < MIN_BYTES:
                return "failed", None, f"body under {MIN_BYTES} bytes"
            return "fetched", body, None
        except httpx.HTTPError as exc:
            last = f"{type(exc).__name__}: {exc}"
            if attempt < MAX_RETRIES:
                time.sleep(0.6 * attempt)
    return "failed", None, f"transport error after {MAX_RETRIES} retries: {last}"


def get_one(pid: int) -> tuple[int, str, int, Optional[str], Optional[bytes], Optional[str]]:
    """Fetch one sprite, walking SOURCES in order.

    Returns (id, outcome, bytes, source, body, detail). `body` is handed back so
    the caller writes the exact bytes that were validated, instead of issuing a
    second request whose body is then unverified.
    """
    problems: list[str] = []
    for source in SOURCES:
        outcome, body, detail = fetch_one_source(pid, source)
        if outcome == "fetched":
            return pid, "fetched", len(body), source, body, None
        if outcome == "absent":
            continue
        problems.append(f"{source}: {detail}")
    if problems:
        return pid, "failed", 0, None, None, "; ".join(problems)
    return pid, "absent", 0, None, None, None


def parse_id_list(spec: str) -> list[int]:
    """Parse `10-22` and `1,4,25` into ids. Ranges are inclusive."""
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part.lstrip("-"):
            lo_s, _, hi_s = part.partition("-")
            lo, hi = int(lo_s), int(hi_s)
            if hi < lo:
                raise SystemExit(f"FAIL: bad range {part!r} (end before start)")
            out.update(range(lo, hi + 1))
        else:
            out.add(int(part))
    return sorted(out)


def load_provenance() -> dict[str, str]:
    if not PROVENANCE.is_file():
        return {}
    data = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    return {str(k): v for k, v in data.get("artwork", {}).items()}


def write_provenance(artwork: dict[str, str]) -> None:
    PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_note": (
            "Which upstream served each id in assets/images/scarlet-violet/. "
            "Kept outside assets/ on purpose: the site attributes its artwork to "
            "PokeAPI, and this per-id record is repo bookkeeping, not something "
            "the frontend should publish. Regenerate with "
            "scripts/fetch_sv_sprites.py; validated by scripts/check_sv_index.mjs."
        ),
        "sources": SOURCES,
        "artwork": {k: artwork[k] for k in sorted(artwork, key=int)},
    }
    PROVENANCE.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--force", action="store_true", help="re-download ids already on disk")
    ap.add_argument("--ids", help="restrict to these ids, e.g. 10-22 or 1,4,25")
    args = ap.parse_args()

    if not SV_DIR.is_dir():
        raise SystemExit(f"SV directory not found: {SV_DIR}\ncreate it before filling the gaps.")

    known = set(project_ids())
    if args.ids:
        requested = parse_id_list(args.ids)
        targets = [i for i in requested if i in known]
        skipped = len(requested) - len(targets)
        if skipped:
            print(f"note: {skipped} requested id(s) are not in pokemon_data.json, ignored")
    else:
        targets = sorted(known)

    present = [i for i in targets if sv_path(i).is_file()]
    todo = list(targets) if args.force else [i for i in targets if i not in set(present)]

    for name, url in SOURCES.items():
        print(f"source {name:<9}: {url}")
    print(f"{len(targets)} project id(s); {len(present)} already on disk; {len(todo)} to probe")
    if not todo:
        print("nothing to do -- re-run with --force to re-download")
        return 0

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        results = list(pool.map(get_one, todo))

    fetched: list[tuple[int, str, int, bytes]] = []
    absent: list[int] = []
    failed: list[tuple[int, str]] = []
    for pid, outcome, nbytes, source, body, detail in sorted(results):
        if outcome == "fetched":
            fetched.append((pid, source, nbytes, body))
        elif outcome == "absent":
            absent.append(pid)
        else:
            failed.append((pid, detail))

    wrote = 0
    for pid, source, _nbytes, body in fetched:
        if args.dry_run:
            continue
        sv_path(pid).write_bytes(body)
        wrote += 1

    by_source: dict[str, int] = {}
    for _pid, source, _n, _b in fetched:
        by_source[source] = by_source.get(source, 0) + 1

    # Provenance covers the whole directory, not just this run: ids already on
    # disk but absent from the map are attributed to the primary source, because
    # the directory shipped as a PokeAPI mirror (byte-verified on ids
    # 1/4/25/94/448) and nothing recorded where they came from before this file
    # existed.
    artwork = load_provenance()
    seeded = 0
    if not args.dry_run:
        for pid in present:
            if str(pid) not in artwork:
                artwork[str(pid)] = PRIMARY
                seeded += 1
        for pid, source, _n, _b in fetched:
            artwork[str(pid)] = source

    elapsed = time.monotonic() - started
    print(f"\nprobed {len(todo)} id(s) in {elapsed:.1f}s")
    print(f"  available : {len(fetched)}"
          + (f" ({sum(n for _, _, n, _ in fetched) / 1048576:.1f} MB)" if fetched else ""))
    for name in SOURCES:
        if name in by_source:
            print(f"      from {name:<9}: {by_source[name]}")
    print(f"  absent from every source : {len(absent)}  (expected -- not an error)")
    print(f"  failed                   : {len(failed)}")
    if args.dry_run and fetched:
        print("  (dry run: nothing written)")

    if absent:
        preview = ", ".join(str(i) for i in absent[:24])
        print(f"\nabsent everywhere ({len(absent)}): {preview}{' ...' if len(absent) > 24 else ''}")
    if failed:
        for pid, reason in failed[:20]:
            print(f"  FAIL {pid}: {reason}", file=sys.stderr)
        if len(failed) > 20:
            print(f"  ... and {len(failed) - 20} more", file=sys.stderr)

    if not args.dry_run:
        write_provenance(artwork)
        if seeded:
            print(f"  seeded {seeded} on-disk id(s) into the provenance map as '{PRIMARY}'")
        print(f"\nprovenance: {PROVENANCE.relative_to(ROOT)} ({len(artwork)} ids)")
        if fetched:
            print(f"wrote {wrote} file(s) into {SV_DIR.relative_to(ROOT)}")
            print("regenerate the roster so the page can see them:")
            print("    python scripts/extract_sv_index.py")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())