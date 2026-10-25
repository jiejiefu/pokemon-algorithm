/**
 * The pre-paint theme resolver: ONE definition, shared by the tool that writes it
 * and the checker that guards it.
 *
 * WHY THIS FILE EXISTS
 *
 * Every content page carries a blocking inline `<script>` in `<head>` that reads
 * the reader's stored theme and writes `data-theme` onto `<html>` before the first
 * paint — and before the first stylesheet, so the resolver never depends on that
 * sheet being render-blocking. That placement is not a preference (see `shared.js`'s
 * Theme docblock): a module is deferred by definition, so resolving the theme there
 * paints once in `:root`'s dark palette and then repaints — a white flash on every
 * navigation, on a site where the default is dark.
 *
 * The placement is correct. The COPYING was not: the block existed in thirty pages
 * in six variants, and the variants had already drifted — `spectrum.html` had
 * rewritten the algorithm and shipped a different pair of colours, so its address
 * bar tint disagreed with the other twenty-nine pages for the same theme, and
 * `graph.html` had hardcoded its dark value into both branches.
 *
 * A static site with no build step has no place to put "one block, thirty copies"
 * except a generator plus a checker. This module is the one block:
 *
 *   scripts/sync_theme_init.mjs --check   reports every page that has drifted
 *   scripts/sync_theme_init.mjs --write   rewrites them
 *   scripts/check_js_syntax.mjs           fails the suite when they disagree
 *
 * `normalizeThemeInit()` is what all three call, so the checker cannot hold a
 * second opinion about what "correct" is.
 *
 * WHAT IS DELIBERATELY NOT UNIFIED
 *
 *   - the `<meta name="theme-color">` VALUES are per page, because two pages are
 *     not drawn on `--bg-primary` in both themes (`graph.html`) or at all
 *     (`cry-studio-pro.html`). The BLOCK is the same code everywhere; only two
 *     hex literals differ, and this table is the single place they are written.
 *   - `404.html`, which is a `location.replace` stub with no visible surface.
 *
 * The comment above each block is NOT in this list: it is generated with the block,
 * and both are compared byte-for-byte. Ten hand-written variants had accumulated
 * across the thirty pages, so leaving the prose to each page is how the last drift
 * got in — see `themeComment()`.
 *
 * WHAT WAS REJECTED, AND WHY THIS IS NOT RE-LITIGATED
 *
 * "Why does every page carry this?" is asked periodically, so the answer sits
 * beside the code it is about. The block and its comment measure 829 bytes / 18
 * lines — 3.0% of `index.html`, 5.0% of `moves.html`, 479 bytes gzipped:
 *
 *   - CSS-only (`@media (prefers-color-scheme)`) is 0 bytes and loses the manual
 *     toggle, which is the feature the block exists to serve.
 *   - An external `theme-init.js` blocks the same way and needs no `try` here, but
 *     it puts a request on the critical path of every first load and adds a
 *     cross-page cache-invalidation surface. Its one advantage — editing a single
 *     file — is what `sync_theme_init.mjs --write` already provides.
 *   - Deleting the `theme-color` write saves ~180 bytes because `shared.js:575`
 *     repaints the meta anyway, at the cost of a wrong address-bar tint until
 *     `shared.js` runs.
 *
 * A cheaper variant needs a number — bytes saved, requests removed, or a feature
 * gained. `docs/incidents/page-defects.md#c` carries the same comparison.
 */

/** The site's own pair, mirroring `--bg-primary` in `assets/css/shared.css`. */
export const SITE_THEME = Object.freeze({ light: '#f3f5fa', dark: '#0b1020' });

/**
 * Pages whose `<meta name="theme-color">` is NOT the shared pair, each with its
 * reason. An override without a reason is indistinguishable from drift, so the
 * reason is carried in the table rather than in a comment beside it.
 */
export const PAGE_THEME = new Map([
  ['graph.html', {
    light: '#090e1f',
    dark: '#030712',
    reason: 'graph.html keeps a near-black canvas in BOTH themes (graph.css:19), '
      + 'so the browser chrome follows --graph-bg rather than --bg-primary',
  }],
]);

/**
 * Pages that pin the dark palette instead of resolving the reader's choice. The
 * block is a different, one-line script for these — and it is still one table, so
 * a page cannot half-pin (script pinned, meta flipping).
 */
export const PINNED_PAGES = new Map([
  ['cry-studio-pro.html', {
    dark: '#0e0d0c',
    reason: 'the studio is a dark instrument (cry-seq-pro.css); its toggle is hidden '
      + 'and initThemeToggle() is not called, so the stored choice is left alone for '
      + 'the reader\'s other pages',
  }],
]);

/** Pages with no theme to resolve, each with its reason. */
export const EXEMPT_PAGES = new Map([
  ['404.html', 'a location.replace stub — the page has no visible surface and no header'],
]);

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const META_RE = /<meta\s+name="theme-color"\s+content="([^"]*)"\s*\/?>/i;
const SHEET_RE = /<link\b[^>]*\brel=["']?stylesheet/i;
const HTML_OPEN_RE = /<html\b[^>]*>/i;
/* A comment can own the block, and when it does it is part of the block: the
 * writer replaces both, and the checker compares both. Anchored at the end of the
 * prefix so only a comment with nothing but whitespace after it qualifies. */
const ADJACENT_COMMENT_RE = /<!--[\s\S]*?-->[ \t]*\r?\n[ \t]*$/;

/** The colours a page's block should carry. */
export function themeColors(page) {
  const pinned = PINNED_PAGES.get(page);
  if (pinned) return { light: pinned.dark, dark: pinned.dark };
  return PAGE_THEME.get(page) ?? SITE_THEME;
}

/**
 * The comment that rides with the block.
 *
 * It names the definition, the writer and the rule, and deliberately does NOT
 * restate the rationale. Ten hand-written variants had accumulated across the
 * thirty pages — one said 「identical on all five themed pages」 when there were
 * thirty, another told the reader to see `index.html`'s copy when `index.html`
 * had none — so a comment that repeats the argument is a comment that can be
 * wrong. The argument lives in AGENTS.md §3.C and in this file's docblock; the
 * comment only says where it is.
 */
export function themeComment(indent = '  ') {
  return [
    `${indent}<!-- Pre-paint theme resolver. Generated from scripts/lib/theme-init.mjs by`,
    `${indent}     scripts/sync_theme_init.mjs; the rationale is AGENTS.md §3.C. -->`,
  ].join('\n');
}

/** The pinned page's comment: the palette is not the reader's to choose here. */
export function pinnedComment(indent = '  ') {
  return [
    `${indent}<!-- Pinned dark: a dark instrument rather than a theme choice, so this writes the`,
    `${indent}     dark palette and leaves the reader's stored choice alone. Generated from`,
    `${indent}     scripts/lib/theme-init.mjs by scripts/sync_theme_init.mjs (AGENTS.md §3.C). -->`,
  ].join('\n');
}

/**
 * The `<script>` block itself, indented to sit directly inside `<head>`.
 * @param {{light: string, dark: string}} colors
 * @param {string} [indent] leading whitespace for the `<script>` line
 */
export function themeScript(colors, indent = '  ') {
  const body = [
    '(function () {',
    "  var THEME_KEY = 'pokemon-theme';",
    '  var theme = null;',
    '  try {',
    '    theme = localStorage.getItem(THEME_KEY);',
    '  } catch (e) { /* private mode / storage disabled: resolve from the OS instead */ }',
    "  if (theme !== 'light' && theme !== 'dark') {",
    "    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');",
    "    theme = mq && mq.matches ? 'light' : 'dark';",
    '  }',
    '  document.documentElement.dataset.theme = theme;',
    "  var meta = document.querySelector('meta[name=\"theme-color\"]');",
    `  if (meta) meta.setAttribute('content', theme === 'light' ? '${colors.light}' : '${colors.dark}');`,
    '})();',
  ];
  const inner = body.map((l) => `${indent}  ${l}`).join('\n');
  return `${themeComment(indent)}\n${indent}<script>\n${inner}\n${indent}</script>`;
}

/** The pinned page's one-liner. */
export function pinnedScript(indent = '  ') {
  return `${pinnedComment(indent)}\n${indent}<script>document.documentElement.dataset.theme = 'dark';</script>`;
}

/** The `<meta>` line a page must carry, before the script. */
export function themeMeta(colors, indent = '  ') {
  return `${indent}<meta name="theme-color" content="${colors.dark}">`;
}

/** The first line that differs, so a failure says WHERE rather than "drifted". */
function firstDiff(actual, expected) {
  const a = actual.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { line: i + 1, actual: a[i] ?? '(missing)', expected: b[i] ?? '(missing)' };
  }
  return null;
}

/**
 * Rewrite a page's theme block and meta to the canonical form.
 *
 * Three outcomes, kept separate because they need different responses:
 *   `problems` — the page is structurally wrong (no block at all, block outside
 *                `<head>`, block after the stylesheet). A rewrite cannot fix those,
 *                and inserting a second block to "fix" one would be worse.
 *   `reasons`  — the page is fixable, and this is why it was rewritten.
 *   `src`      — the fixed source, whether or not anything changed.
 *
 * The checker fails on either list; the writer applies `src` and reports the rest.
 *
 * @param {string} src
 * @param {string} page repo-relative filename, e.g. `moves.html`
 * @returns {{ src: string, reasons: string[], problems: string[] }}
 */
export function normalizeThemeInit(src, page) {
  const colors = themeColors(page);
  const pinned = PINNED_PAGES.get(page);
  const out = { src, reasons: [], problems: [] };

  const htmlOpen = (HTML_OPEN_RE.exec(src) || [''])[0];
  if (!pinned && /\bdata-theme\s*=/i.test(htmlOpen)) {
    out.problems.push(`${page}: the <html> tag carries data-theme itself (${htmlOpen.trim()}) — the inline script is the only place a theme is resolved, so a static value is a second declaration that can disagree with it`);
  }

  let block = null;
  let found = 0;
  for (const m of src.matchAll(SCRIPT_RE)) {
    if (!m[1].includes('dataset.theme')) continue;
    found++;
    if (!block) {
      // The comment directly above the script belongs to the block, so capture it
      // too: comparing only the `<script>` would leave ten variants of prose
      // unguarded, which is exactly how the last drift got in. A comment separated
      // from the script by a blank line is NOT owned, and stays where it is.
      const lead = ADJACENT_COMMENT_RE.exec(src.slice(0, m.index));
      const start = lead ? lead.index : m.index;
      const end = m.index + m[0].length;
      block = { index: start, end, text: src.slice(start, end) };
    }
  }
  if (!block) {
    out.problems.push(`${page}: no <script> sets documentElement.dataset.theme — the page paints once in the stylesheet's dark default and then repaints, and the address bar is never tinted`);
    return out;
  }
  if (found > 1) {
    out.problems.push(`${page}: ${found} scripts set documentElement.dataset.theme — the theme is resolved in exactly one place`);
  }

  const headEnd = src.search(/<\/head>/i);
  if (headEnd === -1) {
    out.problems.push(`${page}: no </head>, so there is nowhere a pre-paint script can be placed`);
  } else if (block.index > headEnd) {
    out.problems.push(`${page}: the theme script sits after </head> — it must run before the stylesheet paints`);
  }

  const sheetAt = src.search(SHEET_RE);
  if (sheetAt !== -1 && sheetAt < block.index) {
    out.problems.push(`${page}: the theme script runs after the first stylesheet — the block still wins a race it should not be running, because a \`media\`-qualified or otherwise non-render-blocking sheet can paint first`);
  }

  const lineStart = src.lastIndexOf('\n', block.index) + 1;
  const rawIndent = src.slice(lineStart, block.index);
  const indent = /^[ \t]*$/.test(rawIndent) ? rawIndent : '  ';
  // `block.text` starts at the block's first non-whitespace character — the
  // `<!--` of its comment, or `<script` when it has none — so the canonical text
  // must lose the same leading indent the file already carries; the lines after
  // it keep theirs.
  const want = (pinned ? pinnedScript(indent) : themeScript(colors, indent)).slice(indent.length);

  let fixed = src;
  if (block.text !== want) {
    const d = firstDiff(block.text, want);
    out.reasons.push(`${page}: the block is not the canonical one`
      + (d ? ` — first difference at block line ${d.line}: ${JSON.stringify(d.actual)} vs ${JSON.stringify(d.expected)}` : ''));
    fixed = fixed.slice(0, block.index) + want + fixed.slice(block.end);
  }

  const meta = META_RE.exec(fixed);
  if (!meta) {
    const at = fixed.lastIndexOf('\n', block.index) + 1;
    out.reasons.push(`${page}: no <meta name="theme-color"> — inserted one before the block`);
    fixed = fixed.slice(0, at) + `${themeMeta(colors, indent)}\n` + fixed.slice(at);
  } else if (meta[1] !== colors.dark) {
    out.reasons.push(`${page}: <meta name="theme-color" content="${meta[1]}"> should be "${colors.dark}"`);
    fixed = fixed.slice(0, meta.index)
      + meta[0].replace(/content="[^"]*"/i, `content="${colors.dark}"`)
      + fixed.slice(meta.index + meta[0].length);
  } else if (meta.index > block.index) {
    out.problems.push(`${page}: <meta name="theme-color"> is after the theme script — the browser can act on it before the script rewrites it`);
  }

  out.src = fixed;
  return out;
}
