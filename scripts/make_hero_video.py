#!/usr/bin/env python3
"""Render one 1920x1080 hero video per generation — assets/video/hero-gen{N}.mp4.

Each video is a 10s seamless loop: the generation's roster fills a square-cell
grid in dex order, a light wave sweeps the completed grid, then the whole
frame fades back to the page background so frame 299 is byte-identical to
frame 0.  The video is meant to sit behind the .home-hero title, so the
background is the site's own --bg-primary baked in rather than an alpha
channel — H.264 yuv420p plays everywhere and there is no blend-mode to get
wrong per theme.

The roster comes from pokemon_data.json's `generation` field and the grid is
solved per generation, because the counts range from 72 to 156 and a fixed
15-per-row leaves 156 sprites at a size the 1080px height cannot afford.

  Each clip also gets a still — assets/video/poster-gen{N}.jpg — cut from the
frame where the roster is COMPLETE and the wave has not reached it yet.  That
still is what index.html's <video poster> shows, which is what makes it worth
generating here rather than in the page: index.html never calls video.play()
(it scrubs currentTime), so the poster is not a pre-play flash, it is the still
image for reduced-motion readers, for a load that never arrives, and for the
~200ms before metadata does.  One still per clip, extracted from the ENCODED
file rather than re-rendered, so the poster is literally a frame of the video
rather than a claim that the pipeline is deterministic.

  python scripts/make_hero_video.py --dry-run     # print the layout table
  python scripts/make_hero_video.py               # render all nine
  python scripts/make_hero_video.py --gen 3       # one generation
  python scripts/make_hero_video.py --save-frames # also dump the PNG sequence
  python scripts/make_hero_video.py --poster-only # re-cut the nine stills only

Not a manifest entry: like every other *.py here this is run by hand, and the
videos it writes are artifacts rather than something a checker can assert on.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "assets/data/pokemon_data.json"
SPRITE_DIR = ROOT / "assets/images/scarlet-violet"
OUT_DIR = ROOT / "assets/video"
FRAME_DIR = ROOT / ".cache/hero-frames"

WIDTH, HEIGHT = 1920, 1080
FPS = 30
SECONDS = 10.0
BG = (0x0B, 0x10, 0x20)  # --bg-primary, shared.css:30

# How often the encoder emits a keyframe.  THE NUMBER IS A SCRUBBING CONTRACT,
# not a compression preference: index.html writes video.currentTime on scroll,
# and every seek decodes from the nearest keyframe forward.  x264's default
# puts one every 250 frames (8.33s of a 30fps clip), so a seek to 4s decoded
# 120 frames of 1080p before it could paint — measured as a visible stutter in
# the hero.  10 frames = 0.33s is the compromise this repo ships.  Measured on
# gen 1 against the long-GOP master: keyint=6/crf24 is 6.0MB, keyint=15/crf26
# is 2.7MB, keyint=10/crf26 is 3.6MB at SSIM 0.995 and caps a seek at 9 frames
# of decode.  The nine clips are 29MB total instead of 8.9MB, and a visit
# fetches exactly one.  verify() measures the real gap in the encoded file and
# rejects a clip above it, so this constant cannot drift from the bytes.
KEYFRAME_FRAMES = 10

# Timeline as fractions of the frame count, so --fps/--seconds cannot drift the
# four phases apart.  The tail is dead time on purpose: it is what makes the
# loop seamless, and the wave needs a held frame to land on.
PHASE = {
    "build_end": 0.65,
    "wave_end": 0.86,
    "fade_end": 0.967,
}

# The Scarlet/Violet sprites are 120x112 canvases in which the creature occupies
# a median 54x58 — a 5x spread between the smallest (Caterpie) and the largest
# (Necrozma).  Scaling on height gives a roster that reads as one wall instead
# of a scatter; W_CAP then stops a wide body from growing into its neighbour's
# cell, which 139 of the 1025 sprites would otherwise do.
H_FACTOR = 0.72
W_CAP = 0.92

POP_FRAMES = 9
POP_FROM, POP_PEAK, POP_TO = 0.55, 1.06, 1.00
POP_ARC = 0.62  # frame fraction spent growing past POP_TO before settling

WAVE_GAIN = 0.35  # brightness multiplier at the crest
WAVE_SCALE = 0.08  # scale multiplier at the crest
WAVE_WIDTH = 0.16  # gaussian half-width in normalised diagonal space


# --------------------------------------------------------------------------
# poster
# --------------------------------------------------------------------------
# The frame the still is cut from is DERIVED from the timeline, not written
# down, because the claim the poster makes is "the roster is complete and the
# wave has not touched it yet" and PHASE is what defines both halves of that:
# build_end is where the last sprite lands, and the wave's crest STARTS off the
# top-left corner (see render()), so the frame AT build_end is still the
# unmodulated grid.  A literal 195 here would be a second place to be wrong
# after a --fps/--seconds change — and it would fail silently, because a poster
# cut mid-wave or mid-fade is still a plausible-looking picture of a roster.

# 1280 wide at q4.  Measured across all nine: 88-130KB, against 936KB for the
# PNG the same frame decodes to and 1.2MB for the clip itself.  Only the one
# still for the day's generation is ever served, so nine on disk cost a reader
# nothing; what has to be small is THIS one, because it is what paints before
# the video's metadata arrives.
POSTER_WIDTH = 1280
POSTER_QUALITY = 4
POSTER_INK_FLOOR = 0.01  # fraction of pixels off BG; the blank frame is 0.000


def poster_frame() -> int:
    return round(PHASE["build_end"] * round(FPS * SECONDS))


def poster_path(gen: int) -> Path:
    return OUT_DIR / f"poster-gen{gen}.jpg"


def cut_poster(src: Path) -> Path:
    """Cut the still out of the ENCODED clip, and refuse to write a blank one.

    Re-rendering frame N through the frame pipeline would be cheaper to reason
    about and wrong to ship: the poster would then be a claim that two code
    paths agree, and they only agree until an encode setting moves.  Decoding
    the shipped bytes makes the poster literally a frame of the clip a reader
    will scrub through.
    """
    out = poster_path(int(src.stem.removeprefix("hero-gen")))
    frame = poster_frame()
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(src),
         "-vf", f"select=eq(n\\,{frame}),scale={POSTER_WIDTH}:-2",
         "-fps_mode", "passthrough", "-frames:v", "1",
         "-q:v", str(POSTER_QUALITY), "-pix_fmt", "yuvj420p", str(out)],
        capture_output=True, text=True, check=True,
    )
# A poster with no sprites in it still looks like a dark rectangle, which is
    # indistinguishable from the hero working — the same failure as a blank
    # canvas counting as painted ink.  Off-background pixel fraction is the
    # claim, so it is measured through the SAME ink_count the seam check uses
    # rather than a second one written here.
    img = Image.open(out).convert("RGB")
    ink = ink_count(img) / (img.width * img.height)
    if ink < POSTER_INK_FLOOR:
        out.unlink()
        raise SystemExit(
            f"frame {frame} of {src.name} has no roster in it ({ink:.4%} off BG) — "
            f"the poster would be an empty rectangle, so nothing was written"
        )
    return out


# --------------------------------------------------------------------------
# roster and layout
# --------------------------------------------------------------------------

def load_roster() -> dict[int, list[int]]:
    """Group species ids by generation, in dex order.

    Read from pokemon_data.json rather than hardcoded id ranges: the ranges are
    contiguous today (1-151, 152-251, ...) but they are a property of the dex,
    not of this script, and a table that restates them is a second thing to
    keep right.
    """
    gens: dict[int, list[int]] = defaultdict(list)
    for rec in json.loads(DATA.read_text()):
        gens[rec["generation"]].append(rec["id"])
    return {g: sorted(ids) for g, ids in sorted(gens.items())}


def plan_grid(count: int) -> tuple[int, int, int]:
    """Largest square cell that fits `count` sprites in 1920x1080.

    On a cell-size tie the WIDER grid wins, which is the whole "full bleed"
    requirement: rows are unchanged by a tie, so more columns means the grid
    spans more of the frame and leaves less empty margin.  Generations 2 and 3
    both tie and both come out edge-to-edge (1890x1080, 1920x1080) only
    because of this.  `>=` and not `>`.

    The grid is still not always edge-to-edge in the other axis, and that is
    deliberate: "full bleed" is the GRID reaching the frame, not every sprite
    filling its cell — a Pokémon silhouette is ~21% opaque even at the tightest
    fit, so a denser frame would mean larger sprites than the height allows.
    """
    best_cell, best_cols, best_rows = 0.0, 1, 1
    for cols in range(1, count + 1):
        rows = math.ceil(count / cols)
        cell = min(WIDTH / cols, HEIGHT / rows)
        if cell >= best_cell:
            best_cell, best_cols, best_rows = cell, cols, rows
    return int(best_cell), best_cols, best_rows


def layout(ids: list[int], cols: int, rows: int, cell: int):
    """Top-left pixel of every sprite's cell, grid centred, last row centred.

    Returns (spots, ox, oy) so the caller can assert the rendered result against
    the rectangle it planned rather than against the frame.
    """
    ox = (WIDTH - cols * cell) // 2
    oy = (HEIGHT - rows * cell) // 2
    rest = len(ids) - (rows - 1) * cols
    row_pad = (cols * cell - rest * cell) // 2 if rest < cols else 0
    spots = []
    for i, pid in enumerate(ids):
        row, col = divmod(i, cols)
        # row_pad shifts the FINAL row only, and it is added to the column
        # offset rather than replacing it.  Both halves are load-bearing and
        # both were wrong in turn: replacing `x` outright stacked all `rest`
        # sprites of that row on one pixel (the last one drawn was the only one
        # visible), and adding the pad to every row shoved the whole grid right
        # and clipped it against x = WIDTH — which still passed the loop-seam
        # check, the ink-percentage table and every eyeball of a scaled preview.
        pad = row_pad if row == rows - 1 else 0
        spots.append((pid, ox + pad + col * cell, oy + row * cell))
    return spots, ox, oy


# --------------------------------------------------------------------------
# sprites
# --------------------------------------------------------------------------

def load_art(pid: int):
    """RGBA image cropped to its alpha bbox, plus the bbox size."""
    with Image.open(SPRITE_DIR / f"{pid}.png") as im:
        im = im.convert("RGBA")
        bbox = im.getchannel("A").getbbox()
        if bbox is None:
            return None, None
        return im.crop(bbox), (bbox[2] - bbox[0], bbox[3] - bbox[1])


def prep_sprite(pid: int, cell: int):
    """(rgb, alpha_mask) at final size, to be pasted bottom-centre in the cell.

    The RGB under alpha 0 is whatever the resize left there and is never written:
    paste() with a 0 mask value skips the pixel.  That is why this returns a
    colour image plus a mask instead of compositing a cell-sized RGBA tile.
    """
    art, size = load_art(pid)
    if art is None:
        return None
    w, h = size
    k = min(H_FACTOR * cell / h, W_CAP * cell / w)
    art = art.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    return art.convert("RGB"), art.getchannel("A")


def measure(pid: int) -> tuple[int, int, float]:
    """(bbox_w, bbox_h, mean alpha over the BBOX 0..1) — for the --dry-run table."""
    art, size = load_art(pid)
    if art is None:
        return 0, 0, 0.0
    alpha = art.getchannel("A")
    total = sum(i * n for i, n in enumerate(alpha.histogram()))
    return size[0], size[1], total / (255.0 * art.width * art.height)


def ease_out(t: float) -> float:
    return 1.0 - (1.0 - t) ** 3


def pop_state(age: int) -> tuple[float, float]:
    """(scale, alpha) for a sprite `age` frames into its entrance.

    Scale overshoots to POP_PEAK and settles, so a row of arrivals reads as a
    bounce rather than a wipe.  Alpha ramps over the first 45% of the window
    only, which is also what makes frame 0 identical to an empty canvas: the
    first sprite is scheduled at frame 0 and is fully transparent there.
    """
    if age <= 0:
        return 0.0, 0.0
    if age >= POP_FRAMES:
        return 1.0, 1.0
    t = age / POP_FRAMES
    if t < POP_ARC:
        scale = POP_FROM + (POP_PEAK - POP_FROM) * ease_out(t / POP_ARC)
    else:
        scale = POP_PEAK + (POP_TO - POP_PEAK) * ease_out((t - POP_ARC) / (1 - POP_ARC))
    return scale, min(1.0, t / 0.45)


def wave_gain(u: float, p: float) -> float:
    d = (u - p) / WAVE_WIDTH
    return 0.0 if d < -3.0 or d > 3.0 else math.exp(-d * d)


def paste_scaled(canvas, rgb, alpha, x, y, cell, scale=1.0, gain=0.0, opacity=1.0):
    """Paste a sprite bottom-centre in its cell, optionally scaled/brightened."""
    tw, th = rgb.size
    if gain > 0.0:
        # point() reads one LUT entry PER BAND, so an RGB tile needs three
        # copies of it.  A bare 256-entry list raises "wrong number of lut
        # entries" here, which is at least a loud failure rather than a
        # silently grey tile.
        lut = [min(255, int(v * (1.0 + gain))) for v in range(256)]
        rgb = rgb.point(lut * len(rgb.getbands()))
    if scale != 1.0:
        tw, th = max(1, round(tw * scale)), max(1, round(th * scale))
        rgb = rgb.resize((tw, th), Image.LANCZOS)
        alpha = alpha.resize((tw, th), Image.LANCZOS)
    if opacity < 1.0:
        alpha = alpha.point([int(v * opacity) for v in range(256)])
    canvas.paste(rgb, (x + (cell - tw) // 2, y + cell - th), alpha)


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------

def ffmpeg_writer(path: Path, total: int) -> subprocess.Popen:
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}",
        "-r", str(FPS), "-i", "-",
        "-frames:v", str(total),
        "-c:v", "libx264", "-preset", "slow", "-crf", "24",
        "-pix_fmt", "yuv420p",
        "-x264-params", f"keyint={KEYFRAME_FRAMES}:min-keyint={KEYFRAME_FRAMES}:scenecut=0",
        "-movflags", "+faststart", "-an", str(path),
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def render(gen: int, ids: list[int], out_path: Path, save_frames: bool) -> dict:
    cell, cols, rows = plan_grid(len(ids))
    spots, ox, oy = layout(ids, cols, rows, cell)
    tiles = {pid: prep_sprite(pid, cell) for pid in ids}

    total = round(FPS * SECONDS)
    build_end = round(PHASE["build_end"] * total)
    wave_end = round(PHASE["wave_end"] * total)
    fade_end = round(PHASE["fade_end"] * total)

    # Last arrival finishes exactly at build_end, so the wave starts on a full
    # grid rather than on a frame where the final sprite is still growing.
    span = max(1, build_end - POP_FRAMES)
    arrivals = [round(i * span / (len(ids) - 1)) for i in range(len(ids))]

    diag = [
        (x + cell / 2) / WIDTH * 0.5 + (y + cell / 2) / HEIGHT * 0.5
        for _, x, y in spots
    ]

    problems = list(layout_problems(spots, cols, rows, cell))
    bg = Image.new("RGB", (WIDTH, HEIGHT), BG)
    canvas = bg.copy()
    grid = None
    fade_ink: list[int] = []
    proc = ffmpeg_writer(out_path, total)
    frames_dir = FRAME_DIR / f"gen{gen}" if save_frames else None
    if frames_dir:
        frames_dir.mkdir(parents=True, exist_ok=True)

    seam: dict[str, bytes | int] = {}
    try:
        for f in range(total):
            if f < build_end:
                for (pid, x, y), u, arrive in zip(spots, diag, arrivals):
                    if not (0 < f - arrive < POP_FRAMES):
                        continue
                    scale, opacity = pop_state(f - arrive)
                    rgb, alpha = tiles[pid]
                    paste_scaled(canvas, rgb, alpha, x, y, cell, scale, 0.0, opacity)
            elif f < wave_end:
                canvas = bg.copy()
                # The crest STARTS off the top-left corner and EXITS past the
                # bottom-right one, so the last wave frame is byte-identical to
                # the unmodulated grid and the handoff into the fade does not
                # step.  At p = 1 + 3*WAVE_WIDTH the nearest sprite is exactly
                # 3 sigma out, where the brightness LUT comes out as identity.
                p = -3.0 * WAVE_WIDTH + (f - build_end) / (wave_end - build_end) * (1.0 + 6.0 * WAVE_WIDTH)
                for (pid, x, y), u in zip(spots, diag):
                    rgb, alpha = tiles[pid]
                    g = wave_gain(u, p)
                    paste_scaled(canvas, rgb, alpha, x, y, cell,
                                 1.0 + WAVE_SCALE * g, WAVE_GAIN * g)
            else:
                if grid is None:
                    grid = bg.copy()
                    for (pid, x, y) in spots:
                        rgb, alpha = tiles[pid]
                        paste_scaled(grid, rgb, alpha, x, y, cell)
                    # The rendered grid against its PLANNED rectangle, with a
                    # one-cell slack for the end sprites' own margins.  Both
                    # directions are asserted: outside catches a grid spilled
                    # off-frame, inside catches one bunched into the middle —
                    # and "inside" is the one that catches a displaced grid,
                    # because getbbox() is clamped to the image and therefore
                    # CANNOT report clipping at all.  A margin comparison
                    # cannot either: |left - right| is the width difference
                    # between the two end sprites, not the grid's centring.
                    bb = ink_bbox(grid)
                    if bb is None:
                        problems.append("grid rendered nothing")
                    else:
                        gx0, gy0 = ox, oy
                        gx1, gy1 = ox + cols * cell, oy + rows * cell
                        if (bb[0] < gx0 - cell or bb[2] > gx1 + cell
                                or bb[1] < gy0 - cell or bb[3] > gy1 + cell):
                            problems.append(
                                f"grid spills past its planned rect {bb} vs "
                                f"({gx0}, {gy0}, {gx1}, {gy1})")
                        if (bb[0] > gx0 + cell or bb[2] < gx1 - cell
                                or bb[1] > gy0 + cell or bb[3] < gy1 - cell):
                            problems.append(
                                f"grid bunched away from its planned rect: {bb} "
                                f"vs ({gx0}, {gy0}, {gx1}, {gy1})")
                span_f = fade_end - wave_end
                t = min(1.0, (f - wave_end) / span_f) if span_f > 0 else 1.0
                # GRID first, background second: this phase dissolves INTO the
                # page colour.  The reverse order fades the grid back IN and the
                # loop's last frame is a full roster over a full-bleed hero.
                if t >= 1.0:
                    canvas = bg.copy()
                else:
                    canvas = Image.blend(grid, bg, ease_out(t))
                    # This phase DISSOLVES AWAY, and the loop-seam check cannot
                    # see the difference: the explicit branch above already
                    # guarantees the final frame is the background, so swapping
                    # the blend's arguments passes every other assertion here
                    # while the roster fades back IN over a full-bleed hero.
                    # Monotone ink is the claim, and it is checked per frame.
                    fade_ink.append(ink_count(canvas))

            payload = canvas.tobytes()
            proc.stdin.write(payload)
            if frames_dir:
                canvas.save(frames_dir / f"frame_{f:04d}.png")
            # The loop seam is the one claim this video makes that nothing else
            # can check, so it is compared here rather than asserted in prose:
            # frame 0 and the last frame are held as bytes and diffed below.
            if f == 0:
                seam["first"] = payload
            seam["last"] = payload
    finally:
        proc.stdin.close()
        rc = proc.wait()
    if rc != 0:
        raise SystemExit(f"ffmpeg exited {rc} for {out_path}")

    seam["diff"] = sum(a != b for a, b in zip(seam["first"], seam["last"]))
    if fade_ink != sorted(fade_ink, reverse=True):
        problems.append(f"fade does not dissolve away: ink {fade_ink[:4]}…")
    if not fade_ink or fade_ink[0] <= 0:
        problems.append("fade starts on an empty frame")
    return {
        "gen": gen, "count": len(ids), "cols": cols, "rows": rows, "cell": cell,
        "frames": total, "build_end": build_end, "wave_end": wave_end,
        "fade_end": fade_end, "seam_diff": seam["diff"], "problems": problems,
    }


def ink_bbox(image: Image.Image):
    """Bounding box of everything that differs from the background, or None."""
    from PIL import ImageChops
    diff = ImageChops.difference(image, Image.new("RGB", image.size, BG))
    return diff.point(lambda v: 255 if v > 8 else 0).getbbox()


def ink_count(image: Image.Image) -> int:
    """Pixels differing from the background — via histogram, not a Python scan."""
    from PIL import ImageChops
    diff = ImageChops.difference(image, Image.new("RGB", image.size, BG))
    return diff.point(lambda v: 255 if v > 8 else 0).histogram()[255]


def layout_problems(spots, cols: int, rows: int, cell: int) -> list[str]:
    """Static guard on the grid itself — no pixels, no encoder involved.

    Two defects got through every other check this script has, and both are
    arithmetic on `spots` rather than anything about encoding:
      - two sprites sharing one cell, which renders as a full grid with a
        stray sprite under it (the last one drawn wins);
      - the final-row pad applied to every row, which shifts the grid right and
        clips it against the frame edge — the loop seam still matches, the ink
        percentage still lands near 20%, and a scaled preview still looks
        plausible.  Only a margin measurement sees it, which is why one is here.
    """
    problems = []
    positions = {(x, y) for _, x, y in spots}
    if len(positions) != len(spots):
        dupes = len(spots) - len(positions)
        problems.append(f"{dupes} sprite(s) share a cell with another")
    if any(x < 0 or y < 0 or x + cell > WIDTH or y + cell > HEIGHT
           for _, x, y in spots):
        problems.append("grid extends past the frame")
    return problems


def keyframe_times(path: Path) -> list[float]:
    """Timestamps of the clip's keyframes, in seconds.

    Read back out of the ENCODED file with `-skip_frame nokey` — the same index
    a browser's seeker consults — rather than inferred from the encoder flags.
    The number that decides whether the scrub stutters is the distance a seek
    has to decode, and only the file knows that.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-skip_frame", "nokey", "-show_entries", "frame=pts_time",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return sorted(float(line.split(",")[0]) for line in out.splitlines() if line.strip())


def verify(path: Path, total: int, seam_diff: int, render_problems: list[str]) -> dict:
    """Decode-count and pixel-format probe, plus the loop-seam verdict.

    -count_frames is used rather than the container's nb_frames: the latter is
    an estimate for some muxers, and "300 frames" is the difference between a
    10.0s loop and a 9.9s one.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames",
         "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    s = data["streams"][0]
    info = {
        "codec": s["codec_name"], "width": s["width"], "height": s["height"],
        "pix_fmt": s["pix_fmt"], "fps": s["r_frame_rate"],
        "decoded_frames": int(s["nb_read_frames"]),
        "duration": float(data["format"]["duration"]),
        "bytes": path.stat().st_size,
    }
    problems = []
    if (info["width"], info["height"]) != (WIDTH, HEIGHT):
        problems.append(f"size {info['width']}x{info['height']}")
    if info["pix_fmt"] != "yuv420p":
        problems.append(f"pix_fmt {info['pix_fmt']}")
    if info["fps"] != f"{FPS}/1":
        problems.append(f"fps {info['fps']}")
    if info["decoded_frames"] != total:
        problems.append(f"decoded {info['decoded_frames']} != {total} frames")
    if abs(info["duration"] - SECONDS) > 0.05:
        problems.append(f"duration {info['duration']:.3f}s")
    # The scrub's precondition, measured on the encoded file rather than
    # trusted from KEYFRAME_FRAMES: a seek decodes from the previous keyframe,
    # so a long gap is a stutter no other check here can see.
    kf = keyframe_times(path)
    gaps = [b - a for a, b in zip(kf, kf[1:])]
    want_gap = KEYFRAME_FRAMES / FPS
    info["keyframes"] = len(kf)
    info["keyframe_gap"] = max(gaps) if gaps else 0.0
    if not kf or kf[0] > 0.01:
        problems.append("clip does not start on a keyframe")
    if len(kf) < total // KEYFRAME_FRAMES:
        problems.append(f"only {len(kf)} keyframes (want >= {total // KEYFRAME_FRAMES})")
    if gaps and max(gaps) > want_gap + 0.05:
        problems.append(f"keyframe gap {max(gaps):.2f}s > {want_gap:.2f}s - the hero scrub will stutter")
    if seam_diff != 0:
        problems.append(f"loop seam differs in {seam_diff} bytes")
    problems.extend(render_problems)
    info["problems"] = problems
    return info


# --------------------------------------------------------------------------
# dry run
# --------------------------------------------------------------------------

def dry_run(gens: dict[int, list[int]], wanted: list[int]) -> None:
    frame_px = WIDTH * HEIGHT
    print(f"{'gen':>3} {'count':>5} {'grid':>9} {'cell':>5} {'visH med':>9} {'w-capped':>8} {'ink%':>6} {'rows'}")
    for gen, ids in gens.items():
        if gen not in wanted:
            continue
        cell, cols, rows = plan_grid(len(ids))
        target_h = H_FACTOR * cell
        cap_w = W_CAP * cell
        ink = 0.0
        heights = []
        capped = 0
        for pid in ids:
            w, h, cov = measure(pid)
            k = min(target_h / h, cap_w / w)
            if target_h / h > cap_w / w:
                capped += 1
            ink += cov * w * h * k * k
            heights.append(h * k)
        heights.sort()
        full, rest = divmod(len(ids), cols)
        print(f"{gen:>3} {len(ids):>5} {cols:>5}x{rows:<3} {cell:>5} "
              f"{heights[len(heights) // 2]:>9.0f} {capped:>8} "
              f"{ink / frame_px * 100:>5.1f}%  {full} full + {rest}")
    total = round(FPS * SECONDS)
    print(f"\n{WIDTH}x{HEIGHT} @ {FPS}fps, {total} frames = {SECONDS:.1f}s")
    print(f"  build  frames   0-{round(PHASE['build_end'] * total)}"
          f"  ({PHASE['build_end'] * SECONDS:.2f}s)  arrivals every "
          f"{(round(PHASE['build_end'] * total) - POP_FRAMES) / max(1, len(ids) - 1):.2f} frames, pop {POP_FRAMES} frames")
    print(f"  wave   frames {round(PHASE['build_end'] * total)}-{round(PHASE['wave_end'] * total)}"
          f"  ({PHASE['build_end'] * SECONDS:.2f}-{PHASE['wave_end'] * SECONDS:.2f}s)")
    print(f"  fade   frames {round(PHASE['wave_end'] * total)}-{round(PHASE['fade_end'] * total)}"
          f"  ({PHASE['wave_end'] * SECONDS:.2f}-{PHASE['fade_end'] * SECONDS:.2f}s)")
    print(f"  hold   frames {round(PHASE['fade_end'] * total)}-{total - 1}"
          f"  empty, so frame {total - 1} == frame 0 and the loop is seamless")
    print(f"  poster frame {poster_frame()}  the last complete frame before the wave"
          f"  ({poster_frame() / FPS:.2f}s)  -> {POSTER_WIDTH}px q{POSTER_QUALITY}"
          f"  poster-gen{{N}}.jpg")


# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gen", help="comma-separated generations (default: all)")
    ap.add_argument("--dry-run", action="store_true", help="print the layout table and exit")
    ap.add_argument("--save-frames", action="store_true",
                    help=f"also write the PNG sequence to {FRAME_DIR.relative_to(ROOT)}/")
    ap.add_argument("--poster-only", action="store_true",
                    help="re-cut the stills from the existing clips and exit, without rendering")
    args = ap.parse_args()

    gens = load_roster()
    wanted = ([int(v) for v in args.gen.split(",") if v.strip()]
              if args.gen else sorted(gens))
    unknown = [g for g in wanted if g not in gens]
    if unknown:
        raise SystemExit(f"no such generation(s) in {DATA.name}: {unknown}")

    if args.dry_run:
        dry_run(gens, wanted)
        return

    if args.poster_only:
        # Its own flag rather than a default: re-cutting nine stills is 3
        # seconds and rendering nine clips is several minutes, and a reader who
        # only wants to move POSTER_FRAME should not pay for the second one.
        for gen in wanted:
            src = OUT_DIR / f"hero-gen{gen}.mp4"
            if not src.exists():
                raise SystemExit(f"{src.relative_to(ROOT)} does not exist — render it first")
            out = cut_poster(src)
            print(f"[gen {gen}] frame {poster_frame()} -> {out.relative_to(ROOT)}"
                  f"  {out.stat().st_size / 1024:.0f}KB")
        return

    failed = 0
    for gen in wanted:
        ids = gens[gen]
        out = OUT_DIR / f"hero-gen{gen}.mp4"
        print(f"[gen {gen}] {len(ids)} sprites -> {out.relative_to(ROOT)}", flush=True)
        stats = render(gen, ids, out, args.save_frames)
        info = verify(out, stats["frames"], stats["seam_diff"], stats["problems"])
        poster_kb = cut_poster(out).stat().st_size / 1024
        print(f"         grid {stats['cols']}x{stats['rows']} cell {stats['cell']}px  "
              f"{info['codec']} {info['width']}x{info['height']} {info['pix_fmt']} "
              f"{info['decoded_frames']}f {info['duration']:.2f}s "
              f"{info['bytes'] / 1024:.0f}KB  seam {'OK' if stats['seam_diff'] == 0 else 'DIFF'}"
              f"  {info['keyframes']} keyframes max gap {info['keyframe_gap']:.2f}s"
              f"  poster frame {poster_frame()} {poster_kb:.0f}KB")
        for problem in info["problems"]:
            print(f"         FAIL {problem}")
            failed += 1
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()