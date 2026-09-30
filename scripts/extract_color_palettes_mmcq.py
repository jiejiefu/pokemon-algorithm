#!/usr/bin/env python3
"""Generate `assets/data/color_palettes.json` with MMCQ, snapped to real pixels.

This is a sibling of `extract_color_palettes.py`, not a replacement for its file.
That script reproduces the `color-extractor.ts` Canvas scan verbatim and keeps its
>5%-share rule; both are still wanted, because they answer a different question.
This one answers: *given six slots, which six colours?*

Why the raw MMCQ answer cannot be used
-------------------------------------
`MMCQ.quantize()` returns each region's **weighted mean** colour. That mean is
computed at 5-bit precision (`MMCQ.SIGBITS`), so it is a centroid of a
quantised histogram cell, not a colour that appears in the image. Measured over
all 2,050 sprites at `max_color=6`, **12,118 of 12,300 returned colours (98.5%)
are not present in the sprite at all**, and the worst sits 101/255 away from the
nearest real pixel.

That number is what makes the grouping worth keeping and the output worthless.
MMCQ's *partition* of the sprite is perceptually good -- it is the same VBox
priority queue `color-thief` has used for a decade -- and `snap_to_real()`
below throws away only the centroids. The result is 0 synthetic colours across
the same 2,050 sprites while preserving MMCQ's sense of which colours belong
together.

The snap is per region, not per sprite
--------------------------------------
    for pixel in pixels:
        region = the first VBox whose bounds contain it
    for region:
        colour = the most frequent REAL pixel in that region

`histogram[colour] / total`, never `len(region) / total`. This is not a detail.
A region's pixel count and the final colour's share are different numbers, and
they can disagree a long way: on Bulbasaur the region won by `#399494` also
holds every `#184a4a` and `#317373` pixel. Reporting the region share would
claim 29.40% for `#399494` while the six reported shares summed to 131.28% --
over 100%, because the top-up pass counted pixels already counted once. The
share is a property of the colour, so it is counted from the global histogram.

The consequence is that shares sum to less than 100 (median 71.96%, min 34.68%,
max 100.00%). That is correct, not a bug: the six colours are a sample, and the
unreported pixels are the ones that lost.

k=6, and why not more
---------------------
The obvious tuning -- raise `max_color` to 15 or 20 so MMCQ splits finer, then
filter by HSV saturation -- was measured and it **hurts**, on both axes that
matter:

    max_color   red-family sprites   near-duplicate pairs
         6                 920                       28
        20                 799                       56
        20, saturation x1.5 790                       61

A finer split produces *more* regions, and the six that survive a share
ranking are then the six largest individual colours -- which is exactly the
large muted background the extra regions were supposed to displace. Boosting
saturation beforehand widens the gap MMCQ cuts along, so it displaces more of
the same large colours. Both make the accent colours harder to reach, not
easier. `max_color=6` is kept, and the saturation boost is dropped.

`quality=1` throughout
----------------------
`color-thief`'s `get_palette()` defaults to `quality=10`, which samples every
10th pixel before quantising. This script never calls it -- it calls
`MMCQ.quantize()` directly on the complete pixel list, so no stride sampling
happens at any point. That is the `quality=1` case, achieved by not having the
parameter.

Three sprites keep five colours
-------------------------------
`#201` (Unown) and `#643` (Kartana) have only five distinct colours that clear
the alpha and background filters, and no top-up can invent a sixth. They emit
five, and `check_color_palettes.mjs` pins that count. Do not "fix" this by
duplicating a colour or relaxing the filter to reach six.
"""

import argparse
import collections
import json
import os
import sys

import numpy as np
from PIL import Image
from colorthief import MMCQ

# Imported rather than restated. `EXCLUDED_RGB` and `MIN_ALPHA` decide which
# pixels reach the quantiser, so a second copy here would be free to drift and
# every comparison against the old extractor would silently be against a
# different input. `sample_path` is the old script's own path builder, so both
# extractors address the same 2,050 files by construction.
from extract_color_palettes import (  # noqa: E402
    DATA_DIR,
    EXPECTED_IDS,
    EXCLUDED_RGB,
    MIN_ALPHA,
    OUT_PATH,
    ROOT,
    sample_path,
)

# Six regions in, six colours out. See the k=6 table in the module docstring
# before raising this.
COLOR_COUNT = 6
MIN_COLORS = 6
MAX_COLORS = 6


def load_pixels(path):
    """Every opaque, non-background pixel, as a list of `(r, g, b)` tuples.

    A list of tuples rather than an ndarray slice: `MMCQ.quantize()` indexes the
    sequence and compares `pixel[0]`, and handing it a numpy row would make
    every channel an `np.int64`, which `VBox.contains()` then bit-shifts.
    """
    with Image.open(path) as im:
        arr = np.asarray(im.convert("RGBA")).reshape(-1, 4)

    keep = arr[:, 3] >= MIN_ALPHA
    for background in EXCLUDED_RGB:
        keep &= ~np.all(arr[:, :3] == np.array(background, dtype=arr.dtype), axis=1)

    return [tuple(int(channel) for channel in row) for row in arr[keep][:, :3]]


def snap_to_real(pixels, colour_count=COLOR_COUNT):
    """MMCQ regions, each replaced by its most common real pixel.

    Returns `[(hex, share_pct), ...]`, share taken from the global histogram and
    the list sorted by share descending.
    """
    total = len(pixels)
    histogram = collections.Counter(pixels)
    shares = {
        f"#{red:02x}{green:02x}{blue:02x}": count / total * 100
        for (red, green, blue), count in histogram.items()
    }

    boxes = [
        entry["vbox"]
        for entry in MMCQ.quantize(pixels, colour_count).vboxes.contents
    ]
    regions = [[] for _ in boxes]
    for pixel in pixels:
        for index, box in enumerate(boxes):
            if box.contains(pixel):
                regions[index].append(pixel)
                break
        else:
            # Unreachable in practice: `MMCQ` derives its boxes from these very
            # pixels, so every pixel falls inside at least one. Kept so that the
            # region counts sum to `total` if that ever stops holding, instead
            # of silently dropping pixels and inflating every share.
            nearest = min(
                range(len(boxes)),
                key=lambda i: sum(
                    (pixel[c] - boxes[i].avg[c]) ** 2 for c in range(3)
                ),
            )
            regions[nearest].append(pixel)

    representatives = set()
    for region in regions:
        # A region can be empty even though the pixels were all assigned. MMCQ
        # builds a box per region *and* leaves a final box that can capture
        # nothing: Bulbasaur shiny yields 6 boxes for 5 populated regions, and
        # #201 (Unown) and #643 (Kartana) are short a colour for the same
        # reason. An empty region yields no representative, so the palette falls
        # below COLOR_COUNT and the top-up pass below fills the gap.
        if not region:
            continue
        # Ties on count are broken by the channel triple, not by insertion
        # order, so the result does not depend on how the sprite was scanned.
        red, green, blue = min(
            collections.Counter(region).items(), key=lambda kv: (-kv[1], kv[0])
        )[0]
        representatives.add(f"#{red:02x}{green:02x}{blue:02x}")

    # The `hex` tie-break in every sort below is load-bearing. Sorting on share
    # alone leaves equal-share colours in whatever order the set produced, and
    # `set` iteration order for strings follows PYTHONHASHSEED -- so the file
    # would differ between runs while looking identical run to run.
    chosen = []
    seen = set()
    for hex_ in sorted(representatives, key=lambda h: (-shares[h], h)):
        seen.add(hex_)
        chosen.append(hex_)
    for hex_ in sorted(shares, key=lambda h: (-shares[h], h)):
        if len(chosen) >= MAX_COLORS:
            break
        if hex_ not in seen:
            seen.add(hex_)
            chosen.append(hex_)

    # Re-sorted, because the top-up pass above appends. That is load-bearing
    # rather than tidiness: an empty region costs a representative, so the
    # top-up can add a colour far larger than the one it replaces. Bulbasaur
    # shiny has 6 boxes but only 5 populated regions, so the sixth slot is
    # filled by the largest unseen colour -- `#316220` at 10.20% -- appended
    # after `#005a00` at 2.91%. Without this sort the palette is not in
    # descending share order, which `check_color_palettes.mjs` fails on.
    return sorted(
        ((hex_, shares[hex_]) for hex_ in chosen[:MAX_COLORS]),
        key=lambda row: (-row[1], row[0]),
    )


def build():
    data = json.load(
        open(os.path.join(DATA_DIR, "pokemon_data.json"), encoding="utf-8")
    )
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
            picked = snap_to_real(load_pixels(path))
            if len(picked) < MIN_COLORS:
                short.append((pid, key, len(picked)))
            entry[key] = [[hex_, round(float(share), 2)] for hex_, share in picked]
        palettes[str(pid)] = entry

    return palettes, short


def report(palettes, short, stream):
    total = sum(len(v["n"]) + len(v["s"]) for v in palettes.values())
    palettes_n = len(palettes) * 2
    print(f"palettes: {len(palettes)} ids x 2 variants = {palettes_n}", file=stream)
    print(
        f"colour entries: {total} (avg {total / palettes_n:.2f} per palette)",
        file=stream,
    )
    print(
        f"  at the {MAX_COLORS}-colour cap: "
        f"{sum(1 for v in palettes.values() for k in 'ns' if len(v[k]) == MAX_COLORS)}",
        file=stream,
    )
    if short:
        print(
            f"  below the {MIN_COLORS}-colour floor (fewer distinct colours "
            f"survive the filter):",
            file=stream,
        )
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

    # indent=2, because this file is reviewed in diffs and every entry is a
    # hand-checkable colour/share pair. The old extractor writes it compactly
    # because it was written before the palettes were six colours wide. The
    # resulting size is not reported and not worth reporting: the file is served
    # from a CDN, the palette is bounded at six colours per sprite regardless,
    # and every byte saved here would come out of the reviewability above.
    blob = json.dumps(palettes, indent=2, ensure_ascii=False).encode("utf-8") + b"\n"
    target = os.path.relpath(OUT_PATH, ROOT)
    if args.dry_run:
        report(palettes, short, sys.stdout)
        print(f"would write {len(palettes)} palettes to {target}")
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUT_PATH, "wb") as fh:
        fh.write(blob)

    report(palettes, short, sys.stdout)
    print(f"wrote {len(palettes)} palettes to {target}")


if __name__ == "__main__":
    main()
