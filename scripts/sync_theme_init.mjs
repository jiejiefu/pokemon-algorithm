#!/usr/bin/env node
/**
 * Keep every page's pre-paint theme block identical.
 *
 *   node scripts/sync_theme_init.mjs           # report drift (default, exits 1)
 *   node scripts/sync_theme_init.mjs --check   # the same thing, spelled out
 *   node scripts/sync_theme_init.mjs --write   # rewrite the drifted pages
 *
 * WHY A GENERATOR AND NOT A SHARED SCRIPT TAG
 *
 * The block has to be INLINE (a module is deferred by definition, so shared.js
 * cannot do this at all) and in `<head>`, above the first stylesheet so it never
 * depends on that sheet being render-blocking. A classic `<script src>` would
 * block the same way but costs a request before first paint on every page, and
 * `blocking="render"` only covers Chromium — leaving Safari and Firefox to paint
 * the dark default first.
 *
 * So thirty files genuinely must carry the bytes. That makes "what the bytes are"
 * a single-source question, and this is the source: `scripts/lib/theme-init.mjs`
 * holds the block, and `check_js_syntax.mjs` calls the same `normalizeThemeInit()`
 * rather than restating it.
 *
 * The three yes-cases that are NOT drift — `graph.html`'s own palette,
 * `cry-studio-pro.html` pinning dark, `404.html` having no theme at all — live in
 * that module's tables with a reason each.
 *
 * `--write` is idempotent: a second run reports nothing.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXEMPT_PAGES, normalizeThemeInit } from './lib/theme-init.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--check' && a !== '--write');
if (unknown.length) {
  console.error(`unknown argument(s): ${unknown.join(', ')}\nusage: node scripts/sync_theme_init.mjs [--check|--write]`);
  process.exit(2);
}
const WRITE = args.includes('--write');

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
if (pages.length === 0) {
  console.error('FAIL  no pages in the repo root — the page set is derived, so an empty one is a broken checkout, not a clean run');
  process.exit(1);
}

console.log(`theme-init  ${pages.length} page(s), ${EXEMPT_PAGES.size} exempt${WRITE ? ', write' : ', check'}`);

const stale = [...EXEMPT_PAGES.keys()].filter((p) => !pages.includes(p));
let drifted = 0;
let broken = 0;
let skipped = 0;

for (const page of pages) {
  if (EXEMPT_PAGES.has(page)) {
    skipped++;
    continue;
  }
  const src = readFileSync(join(ROOT, page), 'utf8');
  const { src: fixed, reasons, problems } = normalizeThemeInit(src, page);
  for (const p of problems) {
    broken++;
    console.error(`  FAIL  ${p}`);
  }
  if (reasons.length === 0) continue;
  drifted++;
  for (const r of reasons) console.log(`  ${WRITE ? 'fix   ' : 'DRIFT '} ${r}`);
  if (WRITE && fixed !== src) writeFileSync(join(ROOT, page), fixed);
}

for (const p of stale) {
  broken++;
  console.error(`  FAIL  ${p} is exempt from the theme-init contract but no longer exists — a stale exemption would silently cover a future page of that name`);
}

if (broken) {
  console.log('');
  console.error(`FAIL  ${broken} problem(s) a rewrite cannot fix — see above`);
  process.exit(1);
}
if (drifted && !WRITE) {
  console.log('');
  console.error(`FAIL  ${drifted} page(s) drifted from the canonical block — run: node scripts/sync_theme_init.mjs --write`);
  process.exit(1);
}

console.log('');
console.log(WRITE
  ? `PASS  ${drifted} page(s) rewritten, ${pages.length - skipped - drifted} already canonical, ${skipped} exempt`
  : `PASS  all ${pages.length - skipped} themed page(s) carry the canonical block (${skipped} exempt)`);
