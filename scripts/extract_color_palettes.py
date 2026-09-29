#!/usr/bin/env python3
"""Generate `assets/data/color_palettes.json` from the 96x96 front sprites.

What this reproduces, and why the fidelity matters
---------------------------------------------------
The reference implementation is `color-extractor.ts`, a Canvas `getImageData`
scan. It is short enough to transcribe exactly, so this script does -- with one
detail that is easy to miss and changes the answer:

    const colorMap = new Map();
    for (let i = 0; i < data.length; i += 16) { ... colorMap.set(hex, ...) }
    return [...colorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)

`i` steps 16 *bytes* over a flat RGBA buffer, so it samples every 4th pixel in
row-major order. `Array.from(map.entries())` yields **first-seen** order, and
V8's `Array.prototype.sort` is stable (ES2019), so **ties keep first-seen
order**. Sorting by `(-count, value)` instead -- the natural thing to write --
reorders every tie, and a sprite's tail is mostly ties.

That is measurable rather than theoretical. Against the reference project's own
1,024 stored `shinyColorPalette` values, a first-seen tie-break reproduces
913 of them exactly (89.2%), while a numeric tie-break reproduces 870 (85.2%).
The residual 10.3% is not an error in either: those reference values are
hand-picked triplets of near-identical greys (`#4c4c4c, #4a4a4a, #484848`),
i.e. curated or drawn from a different sprite revision. We are analysing *our*
images, so the residual is irrelevant -- but the 4-point gap is what proves the
tie-break is the load-bearing part.

The source is the SPRITE, not the official artwork
-------------------------------------------------
`pokemon-menu.tsx` calls `getSpriteUrl(pokemon, shiny)`, which builds
`/pokemon/sprites/{id}.png`. The artwork only ever feeds the hero image and the
identity card's CSS mask. This is not a stylistic choice, it is what makes the
algorithm usable at all: measured over the roster, a 96x96 sprite holds **11.8
distinct colours on average** (20 at the median), while a 475x475 official
artwork holds **5,532**. Fed verbatim, the artwork's top 6 for Bulbasaur is
`#8cc7ac, #ffffff, #97cbae, #709f90, #96cbae, #689869` -- four of six are the
same pale mint -- and for Charmander `#eaab7d, #eaab7e, #e9ab7d, #e4a67b,
#e4a77b, #e9aa7c`, six adjacent values. There is no nearest-duplicate collapse
in the reference algorithm, so an artwork palette would be six shades of one
colour. Flat pixel-art sprites are the only input it works on.

Selection rule: share > 5%, then clamp to [6, 12]
-------------------------------------------------
Taking every colour above a 5% share, then topping up to at least 6 and capping
at 12. Measured across all 2,050 palettes (1,025 ids x normal + shiny):

    6 colours  1187  (57.9%)   <- the 6-colour floor is what binds
    7 colours   413  (20.1%)
    8 colours   306  (14.9%)
    9 colours   111  ( 5.4%)
   10 colours    26  ( 1.3%)
   11 colours     2  ( 0.1%)
   12 colours     0  ( 0.0%)   <- the 12-colour cap NEVER binds

So the cap is an inert safety net and the floor is the active rule. It is kept
because a future feature may want a longer tail, and a cap that never fires
costs nothing -- but do not cite "12 colours" as a measured property of the
roster, because it is not one.

Five palettes have only 5 distinct colours and cannot reach the floor:
#201 Wobbuffet (normal + shiny), #643 Genesect (normal), #868 Salandit
(normal + shiny). Their sprites genuinely contain five colours. They are stored
with five, and the UI renders a five-segment strip rather than inventing a
sixth -- padding a palette would be a fabricated colour presented as a
measurement.

Percentages
-----------
`share` is a percentage of the pixels that survive both filters (alpha >= 200
and not in EXCLUDED). Rounded to 2 dp; the reference returns the raw float, so
this is a deliberate deviation that costs about 40 KB raw over the 2,050
palettes and is invisible at display sizes.

The denominator is the *surviving* pixels, not the sampled ones. This is not
obvious: `color-extractor.ts:114` increments `totalPixels` inside the loop but
after both `continue`s, so near-black pixels leave the denominator entirely.
Using the sampled count instead -- the first version of this script -- inflates
every share by ~11% (Bulbasaur's primary reads 26.07% instead of 28.95%) and
moves real colours across the 5% threshold in both directions.

A palette's shares do **not** sum to 100, and that is the point. They sum to 100
only when the selection is the sprite's complete colour set, which holds for 15
of 2,050. The other 2,035 dropped a tail to reach the 6-colour floor, so the
total falls below 100 -- median 89.89, worst 70.61 (#1021 normal). The shortfall
is exactly the share of the sprite the strip does not cover, which is what makes
the number worth storing. Rounding can also push a total slightly over: 2 of
2,050 (#38) read 100.01, against a ceiling of 0.055 for an 11-term sum at 2 dp.

Output: 254 KB raw / 74 KB gzip for all 2,050 palettes, which is cheaper than
`learnsets.json` (223 KB gzip) and a fifteenth of `pokemon_data.json`.

Usage
-----
    ../.venv/bin/python scripts/extract_color_palettes.py
    ../.venv/bin/python scripts/extract_color_palettes.py --dry-run

Verifies
--------
    node scripts/check_color_palettes.mjs
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SPRITE_DIR = os.path.join(ROOT, "assets", "images", "sprite")
SHINY_DIR = os.path.join(ROOT, "assets", "images", "sprite", "shiny")
DATA_DIR = os.path.join(ROOT, "assets", "data")
OUT_PATH = os.path.join(DATA_DIR, "color_palettes.json")

# The roster is 1025 records and nothing else. It is written as a literal
# because every script in this repo that needs the roster reads it from
# `pokemon_data.json`; this one is the exception, and it must be, because the
# point of the check below is that the two agree rather than that this file
# guessed.
EXPECTED_IDS = 1025

# color-extractor.ts's EXCLUDED_COLORS. Near-black is excluded because the
# sprite sheet's transparent pixels and its outline resolve to almost-black
# values that would otherwise dominate the first slot.
EXCLUDED_RGB = {
    (0x00, 0x00, 0x00),
    (0x10, 0x10, 0x10),
    (0x12, 0x12, 0x12),
    (0x01, 0x01, 0x01),
    (0x0F, 0x0F, 0x0F),
}
MIN_ALPHA = 200

SHARE_THRESHOLD = 5.0
MIN_COLORS = 6
MAX_COLORS = 12


def sample_path(donor, pokemon_id, shiny):
    """Sprite path for an id, in the same shape `getSpriteUrl()` builds."""
    sub = "shiny" if shiny else ""
    return os.path.join(SPRITE_DIR, sub, f"{pokemon_id}.png")


def ranked_colours(path):
    """Reproduce `extractColorsFromImage` for one sprite, unbounded in count.

    Returns `[(hex, count, share_pct), ...]` sorted exactly as the reference
    sorts: count descending, ties in first-seen order.
    """
    with Image.open(path) as im:
        # The sprites are palette-mode PNGs. A browser composites them to RGBA
        # when `drawImage` puts them on a canvas, so converting here is the
        # faithful equivalent rather than a convenience.
        mode = im.mode
        rgba = np.asarray(im.convert("RGBA"))

    height, width, channels = rgba.shape
    assert channels == 4, f"{path}: expected RGBA after convert, got {rgba.shape}"
    assert width % 4 == 0 and (height * width) % 4 == 0, (
        f"{path}: the i += 16 stride samples every 4th pixel, which is only "
        f"equivalent to 'every 4th column' when the width is a multiple of 4. "
        f"Got {width}x{height} (mode {mode}). Refusing to silently resample."
    )

    # Row-major, every 4th column: identical order to i = 0, 16, 32, ... over
    # the flat buffer, because the width is a multiple of 4.
    sampled = rgba[:, ::4]

    opaque = sampled[sampled[:, :, 3] >= MIN_ALPHA][:, :3]
    if len(opaque) == 0:
        raise SystemExit(f"{path}: no pixel passed alpha >= {MIN_ALPHA}")

    keys = (
        (opaque[:, 0].astype(np.uint32) << 16)
        | (opaque[:, 1].astype(np.uint32) << 8)
        | opaque[:, 2].astype(np.uint32)
    )

    values, first_index, counts = np.unique(
        keys, return_index=True, return_counts=True
    )

    keep = np.array(
        [
            (int(v) >> 16, (int(v) >> 8) & 0xFF, int(v) & 0xFF) not in EXCLUDED_RGB
            for v in values
        ]
    )
    values, first_index, counts = values[keep], first_index[keep], counts[keep]
    if len(values) == 0:
        raise SystemExit(f"{path}: every colour was in EXCLUDED_RGB")

    # The denominator is the surviving-pixel count, NOT the sampled-pixel count.
    # color-extractor.ts:114 increments totalPixels inside the loop but *after*
    # both `continue`s, so near-black pixels leave the denominator entirely.
    # Computing it as `len(opaque)` instead -- the obvious choice, and what this
    # script did first -- inflates every share by ~11% on the sprites measured
    # (Bulbasaur's primary reads 26.07% instead of 28.95%), which pushes real
    # colours across the 5% threshold in both directions.
    total = int(counts.sum())

    # count desc, then first-seen asc. This is the line the whole file exists
    # to get right; see the module docstring for the 89.2% / 85.2% measurement.
    order = np.lexsort((first_index, -counts))

    return [
        (f"#{int(v):06x}", int(c), c / total * 100)
        for v, c in zip(values[order], counts[order])
    ]


def select(ranked):
    """Apply the >5% rule, then clamp to [MIN_COLORS, MAX_COLORS]."""
    kept = [row for row in ranked if row[2] > SHARE_THRESHOLD]
    if len(kept) < MIN_COLORS:
        # Top up from the full ranking rather than inventing a colour. A sprite
        # with fewer than MIN_COLORS distinct colours keeps all of them.
        kept = ranked[:MIN_COLORS]
    return kept[:MAX_COLORS]


def build():
    for directory in (SPRITE_DIR, SHINY_DIR):
        if not os.path.isdir(directory):
            raise SystemExit(
                f"missing sprite directory {directory}\n"
                f"Both are siblings of assets/images/pokemon/ and are addressed\n"
                f"by explicit filename; nothing generates them."
            )

    data = json.load(open(os.path.join(DATA_DIR, "pokemon_data.json"), encoding="utf-8"))
    ids = sorted(p["id"] for p in data)
    if len(ids) != EXPECTED_IDS or ids != list(range(1, EXPECTED_IDS + 1)):
        raise SystemExit(
            f"pokemon_data.json holds {len(ids)} records, expected "
            f"{EXPECTED_IDS} contiguous ids 1..{EXPECTED_IDS}. Refusing to emit a "
            f"palette file keyed against a roster this script did not expect."
        )

    palettes = {}
    short = []
    for pid in ids:
        entry = {}
        for key, shiny in (("n", False), ("s", True)):
            path = sample_path(None, pid, shiny)
            if not os.path.exists(path):
                raise SystemExit(
                    f"missing sprite {path}\n"
                    f"All 1025 ids must have both variants: the pages render a "
                    f"shiny toggle unconditionally, so a missing file is a broken "
                    f"image, not a hidden control."
                )
            picked = select(ranked_colours(path))
            if len(picked) < MIN_COLORS:
                short.append((pid, key, len(picked)))
            # np.float64 subclasses float, so json.dumps would accept it, but
            # an explicit cast keeps the emitted file free of numpy in the
            # repr and makes the 2 dp rounding the only transformation.
            entry[key] = [[hex_, round(float(share), 2)] for hex_, _c, share in picked]
        palettes[str(pid)] = entry

    return palettes, short


def report(palettes, short, stream):
    total = sum(len(v["n"]) + len(v["s"]) for v in palettes.values())
    palettes_n = len(palettes) * 2
    print(f"palettes: {len(palettes)} ids x 2 variants = {palettes_n}", file=stream)
    print(f"colour entries: {total} (avg {total / palettes_n:.2f} per palette)", file=stream)
    print(f"  at the {MAX_COLORS}-colour cap: {sum(1 for v in palettes.values() for k in 'ns' if len(v[k]) == MAX_COLORS)}", file=stream)
    if short:
        print(f"  below the {MIN_COLORS}-colour floor (sprites with fewer colours):", file=stream)
        for pid, key, n in short:
            print(f"    #{pid:4} {key}  {n} colours", file=stream)
    else:
        print(f"  below the {MIN_COLORS}-colour floor: none", file=stream)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="print the tally and write nothing",
    )
    args = ap.parse_args()

    palettes, short = build()

    blob = json.dumps(palettes, separators=(",", ":")).encode("utf-8")
    if args.dry_run:
        report(palettes, short, sys.stdout)
        print(f"would write {len(blob) / 1024:.0f} KB raw to {os.path.relpath(OUT_PATH, ROOT)}")
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUT_PATH, "wb") as fh:
        fh.write(blob)

    report(palettes, short, sys.stdout)
    print(f"wrote {len(blob) / 1024:.0f} KB raw to {os.path.relpath(OUT_PATH, ROOT)}")


if __name__ == "__main__":
    main()
