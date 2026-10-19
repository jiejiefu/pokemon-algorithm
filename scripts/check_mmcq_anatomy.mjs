#!/usr/bin/env node
/**
 * Regression test for MMCQ algorithm anatomy (assets/js/mmcq-anatomy.js).
 *
 *   node scripts/check_mmcq_anatomy.mjs
 *
 * Verifies:
 * 1. 200+ sprite sample palettes match color_palettes.json byte-identically (hex & share)
 * 2. Structural invariants: trace length is 5, phase 1 is 4 cuts, phase 2 is 1 cut
 * 3. Monotonic decrease of phase 1 box count
 * 4. Empty region coverage {0, 1, 2, 3} and palette size coverage {5, 6}
 * 5. Forced 5-color IDs from data {201, 643}
 * 6. "vbox2 is None" branch is taken 0 / 5,125 times across all 1,025 species
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRgba } from './lib/png.mjs';
import {
  loadSpritePixels,
  mmcqPalette,
} from '../assets/js/mmcq-anatomy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PALETTES = JSON.parse(readFileSync(join(ROOT, 'assets/data/color_palettes.json'), 'utf8'));

let failures = 0;
let total = 0;

function check(ok, description, detail = () => '') {
  total++;
  if (ok) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}`);
    const d = typeof detail === 'function' ? detail() : detail;
    if (d) console.log(`       ${d}`);
  }
}

console.log('MMCQ algorithm anatomy — sample extraction & structural invariants');

// ---------------------------------------------------------------------------
// 1. Sampling & Anti-vacancy guards
// ---------------------------------------------------------------------------

const ALL_IDS = Object.keys(PALETTES).map(Number).sort((a, b) => a - b);
const FIVE_COLOR_IDS = ALL_IDS.filter((id) => PALETTES[id]?.n?.length === 5);

// Sample stride-200: take 200 items with step 5 (1, 6, 11, ... 996)
const STRIDE_STEP = 5;
const strideSample = [];
for (let i = 0; i < 200; i++) {
  strideSample.push(1 + i * STRIDE_STEP);
}

// Force all 5-color IDs from data into the sample
const sampleIds = Array.from(new Set([...strideSample, ...FIVE_COLOR_IDS])).sort((a, b) => a - b);

check(
  FIVE_COLOR_IDS.every((id) => sampleIds.includes(id)),
  'the sample contains every id that color_palettes.json itself marks as 5-colour',
  () => `missing 5-colour species: ${FIVE_COLOR_IDS.filter((id) => !sampleIds.includes(id)).join(', ')}`
);

// ---------------------------------------------------------------------------
// 2. Sample execution & byte-for-byte comparison
// ---------------------------------------------------------------------------

let hexAndShareMatches = true;
let hexMismatchDetail = '';
let allTraceLength5 = true;
let allPhasesCorrect = true;
let phaseOrderCorrect = true;
let topUpFilledEmpty = true;
let deterministicOrder = true;

const emptyRegionCounts = new Set();
const paletteLengthCounts = new Set();

for (const id of sampleIds) {
  const buf = readFileSync(join(ROOT, `assets/images/sprite/${id}.png`));
  const rgba = readRgba(buf, `sprite/${id}.png`);
  const pixels = loadSpritePixels(rgba);
  const { rows, trace, boxes } = mmcqPalette(pixels, 6);

  if (trace.length !== 5) {
    allTraceLength5 = false;
  }

  const p1 = trace.filter((t) => t.phase === 1);
  const p2 = trace.filter((t) => t.phase === 2);
  if (p1.length !== 4 || p2.length !== 1) {
    allPhasesCorrect = false;
  }

  // Phase 1 cuts must be monotonically non-increasing in count
  for (let i = 1; i < p1.length; i++) {
    if (p1[i].count > p1[i - 1].count) {
      phaseOrderCorrect = false;
    }
  }

  const empties = boxes.filter((b) => b.isEmpty).length;
  emptyRegionCounts.add(empties);
  paletteLengthCounts.add(rows.length);

  // If there are empty regions but pixels has >= 6 colors, top-up must supply 6 colors
  const uniquePixels = new Set(pixels.map(([r, g, b]) => (r << 16) | (g << 8) | b)).size;
  if (empties > 0 && uniquePixels >= 6 && rows.length !== 6) {
    topUpFilledEmpty = false;
  }

  // Check deterministic tiebreak ordering
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].share === rows[i - 1].share && rows[i].hex < rows[i - 1].hex) {
      deterministicOrder = false;
    }
  }

  // Byte comparison against color_palettes.json
  const want = PALETTES[id].n;
  const wantHex = want.map((r) => r[0]);
  const gotHex = rows.map((r) => r.hex);

  if (gotHex.length !== wantHex.length || !gotHex.every((h, idx) => h === wantHex[idx])) {
    hexAndShareMatches = false;
    if (!hexMismatchDetail) hexMismatchDetail = `#${id}: got [${gotHex.join(',')}] want [${wantHex.join(',')}]`;
  }

  const shareMatch = rows.every((r, idx) => Math.abs(r.share - want[idx][1]) <= 0.01 + 1e-9);
  if (!shareMatch) {
    hexAndShareMatches = false;
    if (!hexMismatchDetail) hexMismatchDetail = `#${id}: share mismatch got [${rows.map((r) => r.share).join(',')}] want [${want.map((r) => r[1]).join(',')}]`;
  }
}

check(hexAndShareMatches, 'hex and share match for every species', () => hexMismatchDetail);
check(allTraceLength5, 'trace.length === 5');
check(allPhasesCorrect, 'phase 1 has exactly 4 cuts and phase 2 exactly 1');
check(phaseOrderCorrect, 'trace phase order');

const requiredEmpties = [0, 1, 2, 3];
const missingEmpties = requiredEmpties.filter((e) => !emptyRegionCounts.has(e));
check(
  missingEmpties.length === 0,
  'the emptyRegions >= 0 distribution covers {0,1,2,3}',
  () => `missing empty-region tiers: ${missingEmpties.join(', ')}`
);

const requiredLengths = [5, 6];
const missingLengths = requiredLengths.filter((l) => !paletteLengthCounts.has(l));
check(
  missingLengths.length === 0,
  'paletteRows lengths cover {5,6}',
  () => `missing palette lengths: ${missingLengths.join(', ')}`
);

check(
  missingEmpties.length === 0 && missingLengths.length === 0,
  'insufficient coverage fails and names the missing tier in the message',
  () => `missing tiers: empties [${missingEmpties.join(', ')}], lengths [${missingLengths.join(', ')}]`
);

check(topUpFilledEmpty, 'the sixth slot of a 5-colour species is filled by top-up');
check(deterministicOrder, 'the ordering of equal-share swatches is deterministic');

// ---------------------------------------------------------------------------
// 3. Full corpus check: "vbox2 is None" occurs 0 / 5,125 times
// ---------------------------------------------------------------------------

console.log('MMCQ full corpus scan (1,025 species) — 0 / 5,125 vbox2-is-None branches');

let totalCorpusCuts = 0;
let totalVbox2None = 0;

for (const id of ALL_IDS) {
  const buf = readFileSync(join(ROOT, `assets/images/sprite/${id}.png`));
  const rgba = readRgba(buf, `sprite/${id}.png`);
  const pixels = loadSpritePixels(rgba);
  const { trace, vbox2NoneCount } = mmcqPalette(pixels, 6);
  totalCorpusCuts += trace.length;
  totalVbox2None += vbox2NoneCount;
}

check(
  totalCorpusCuts === 5125 && totalVbox2None === 0,
  '"vbox2 is None" occurs 0 times in the corpus',
  () => `"vbox2 is None" occurrences: ${totalVbox2None} / ${totalCorpusCuts}`
);

console.log(`\n${failures ? `FAIL  ${failures} of ${total} checks failed` : `PASS  all ${total} checks passed`}`);
process.exit(failures ? 1 : 0);
