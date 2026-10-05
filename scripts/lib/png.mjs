/**
 * Minimal PNG reader for the sprites this repo actually ships.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A DEPENDENCY
 *
 * The claim that `assets/js/mmcq.js` reproduces
 * `scripts/extract_color_palettes_mmcq.py` is checkable in a way nothing else can
 * check: run both on the same pixels and compare. That needs the sprite's
 * pixels, and Node has no image decoder — so either this file, an npm dependency,
 * or a Python subprocess.
 *
 * All three were rejected for the same reason. A dependency makes the checker fail
 * to install rather than fail to run, which §4's "a loader error is not a test
 * failure" is exactly about: a suite that dies with ERR_MODULE_NOT_FOUND reads as
 * neither pass nor fail. A Python subprocess makes a colour assertion depend on
 * `../.venv` existing. And `scripts/lib/` already exists for shared checker code.
 *
 * SCOPE IS MEASURED, NOT GUESSED
 *
 * `assets/data/color_palettes.json` was built from `assets/images/sprite/`, and
 * that directory is not uniform. Counted over all 1,530 files:
 *
 *     774 × colour type 3, bit depth 4      (4-bit indexed, 2 pixels per byte)
 *     473 × colour type 3, bit depth 8      (8-bit indexed)
 *     281 × colour type 6, bit depth 8      (RGBA)
 *       1 × colour type 3, bit depth 2      (2-bit indexed, 4 pixels per byte)
 *
 * So "colour type 6 only" would cover 18% of the corpus and a reader that quietly
 * assumed 8-bit indices would misread 775 of them. Every one of those four shapes
 * is handled, and each unhandled one throws a named error rather than returning
 * wrong pixels — a decoder that guesses is worse than no decoder, because the
 * checker would then be measuring an image nobody chose.
 *
 * The 4-bit and 2-bit cases are why `SPRITE_DIR` matters: the sibling directory
 * `assets/images/pokemon/` holds 475×475 RGBA official artwork, which is what the
 * PAGES show (`spriteUrl()` points there), and it is NOT what the palettes were
 * measured from. Reading `pokemon/` and comparing against `color_palettes.json`
 * produces a completely different palette for every species, which is exactly the
 * kind of plausible-looking wrong answer this checker exists to prevent.
 *
 * No colour management, no premultiply, no scaling. PIL's
 * `Image.open(path).convert("RGBA")` on these files is: PLTE for the colours,
 * tRNS for the alpha, and nothing else — they carry no ancillary colour chunk, so
 * there is nothing to convert.
 */

import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Read index samples out of one unfiltered scanline.
 *
 * PNG packs indexed rows most-significant-bits first, so a 4-bit row holds two
 * indices per byte with the left pixel in the HIGH nibble. Getting that backwards
 * transposes every sprite, which for a symmetric image looks fine and for
 * Unown's letterform does not — and a transposed image still produces six
 * plausible colours.
 */
function unpackRow(rawRow, width, depth) {
  const out = new Uint8Array(width);
  if (depth === 8) {
    out.set(rawRow.subarray(0, width));
    return out;
  }
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  for (let x = 0; x < width; x++) {
    const byte = rawRow[Math.floor(x / perByte)];
    const shift = 8 - depth * ((x % perByte) + 1);
    out[x] = (byte >> shift) & mask;
  }
  return out;
}

/**
 * Decode a PNG into straight RGBA bytes.
 *
 * @param {Uint8Array} bytes the whole file
 * @param {string} label a name for error messages — a checker that fails with
 *   "unsupported colour type" and no filename has left the reader to work out
 *   which of 1,530 sprites it was reading.
 * @returns {{width: number, height: number, data: Uint8Array}} `data` is
 *   `width * height * 4`, row-major, no padding, 8-bit alpha.
 */
export function readRgba(bytes, label = '<png>') {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error(`${label}: not a PNG (bad signature at byte ${i})`);
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let paletteAlpha = null;
  const idat = [];

  while (pos + 8 <= bytes.length) {
    const len = readU32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = pos + 8;

    if (type === 'IHDR') {
      width = readU32(bytes, body);
      height = readU32(bytes, body + 4);
      bitDepth = bytes[body + 8];
      colorType = bytes[body + 9];
      interlace = bytes[body + 12];
    } else if (type === 'PLTE') {
      palette = bytes.subarray(body, body + len);
    } else if (type === 'tRNS') {
      paletteAlpha = bytes.subarray(body, body + len);
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(body, body + len));
    } else if (type === 'IEND') {
      break;
    }

    pos = body + len + 4; // +4 for the CRC, which is not verified
  }

  if (!width || !height) throw new Error(`${label}: no IHDR chunk`);
  if (interlace !== 0) throw new Error(`${label}: interlaced, this reader only handles non-interlaced`);
  if (colorType !== 3 && colorType !== 6) {
    throw new Error(`${label}: colour type ${colorType}, this reader only handles 3 (indexed) and 6 (RGBA)`);
  }
  if (colorType === 6 && bitDepth !== 8) {
    throw new Error(`${label}: RGBA at bit depth ${bitDepth}, this reader only handles 8`);
  }
  if (![1, 2, 4, 8].includes(bitDepth)) {
    throw new Error(`${label}: bit depth ${bitDepth}, which is not a valid PNG depth`);
  }
  if (colorType === 3 && !palette) throw new Error(`${label}: indexed with no PLTE chunk`);
  if (!idat.length) throw new Error(`${label}: no IDAT chunk`);

  const indexed = colorType === 3;
  const channels = indexed ? 1 : 4;
  // PNG's filter unit is one BYTE for every indexed depth, not one sample — a
  // 4-bit row filters two pixels at a time and using bpp=0.5 breaks the arithmetic.
  const bpp = Math.max(1, Math.ceil((bitDepth * channels) / 8));
  const rowBytes = Math.ceil((width * bitDepth * channels) / 8);
  const stride = width * 4;

  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const expected = (rowBytes + 1) * height;
  if (raw.length < expected) {
    throw new Error(`${label}: inflated to ${raw.length} bytes, expected ${expected} for ${width}x${height}`);
  }

  // Unfiltered samples, one row per stride of `rowBytes`.
  const flat = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const up = dst - rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const rawByte = raw[src + x];
      const a = x >= bpp ? flat[dst + x - bpp] : 0;
      const b = y > 0 ? flat[up + x] : 0;
      const c = x >= bpp && y > 0 ? flat[up + x - bpp] : 0;

      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default:
          throw new Error(`${label}: unknown scanline filter ${filter} on row ${y}`);
      }
      flat[dst + x] = value & 0xff;
    }
  }

  const data = new Uint8Array(stride * height);
  const paletteEntries = palette ? palette.length / 3 : 0;

  for (let y = 0; y < height; y++) {
    const samples = indexed ? unpackRow(flat.subarray(y * rowBytes, (y + 1) * rowBytes), width, bitDepth) : null;
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (indexed) {
        const idx = samples[x];
        if (idx >= paletteEntries) {
          throw new Error(`${label}: palette index ${idx} at (${x},${y}) exceeds the ${paletteEntries}-entry PLTE`);
        }
        data[d] = palette[idx * 3];
        data[d + 1] = palette[idx * 3 + 1];
        data[d + 2] = palette[idx * 3 + 2];
        // tRNS is shorter than PLTE on purpose: entries past its end are opaque.
        data[d + 3] = paletteAlpha && idx < paletteAlpha.length ? paletteAlpha[idx] : 255;
      } else {
        const s = y * rowBytes + x * 4;
        data[d] = flat[s];
        data[d + 1] = flat[s + 1];
        data[d + 2] = flat[s + 2];
        data[d + 3] = flat[s + 3];
      }
    }
  }

  return { width, height, data };
}

function readU32(bytes, pos) {
  return ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
}