/**
 * Syntax highlighting for the exported-theme code blocks.
 *
 * WHY THIS IS A MODULE AND NOT A SECOND COPY
 *
 * `color.html`'s 匯出主題 block and `outfit.html`'s 把它變成主題 block both show
 * the output of the same three generators (`themeToTailwindV4Css`,
 * `themeToTailwindV3Config`, `themeToJson`), so both need the same three-language
 * highlighter. Two copies drift invisibly: the symptom is a block where a token
 * colour quietly stopped matching the other page's, and there is no checker that
 * can tell, because both look right. This is the same reason `cry-autoplay.js` is
 * one module rather than two (§3.G) — one definition, two callers.
 *
 * The classes it emits (`cp-comment`, `cp-key`, `cp-string`, `cp-num`, `cp-hex`,
 * `cp-hex-dot`) and their contrast figures live in `colors.css`, which both pages
 * already mount. Nothing here touches the DOM, so a checker can import it in bare
 * Node — see AGENTS.md §3.B1 for why a page-local helper may not simply be added
 * to `color-palette.js`'s export surface instead.
 *
 * `innerHTML` in, `innerHTML` out. The escaped text is preserved exactly, so the
 * receiving element's `textContent` is byte-identical to the generated source —
 * which is what lets `check_outfit_browser.mjs` still `JSON.parse()` it after the
 * code pane is populated through this function. The colour chip is a span holding
 * no text for the same reason.
 */

const IDENT = /[A-Za-z_$@][A-Za-z0-9_$-]*/y;
const PROP = /--[A-Za-z0-9-]*/y;
const HEX = /#[0-9a-fA-F]{6}\b/y;
const NUM = /[0-9]+(?:\.[0-9]+)?/y;

const esc = (s) => s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const span = (cls, body) => `<span class="${cls}">${body}</span>`;

// A hex literal gets its own colour chip. The block exists so a reader can
// eyeball the colours, so the value is worth the extra eight pixels.
const hexChip = (raw) => span('cp-hex', `<span class="cp-hex-dot" style="background:${raw}"></span><span>${raw}</span>`);
const chipHexes = (escaped) => escaped.replace(/#[0-9a-fA-F]{6}\b/g, hexChip);

/**
 * The three tabs emit three different languages (CSS, JS, JSON) from the same
 * palette, so one regex cannot serve all three. This walks the string once and
 * classifies each token by what follows it, which is enough to tell a JSON key
 * from a JSON value and a CSS custom property from a word.
 *
 * @param {string} text generated source, unescaped
 * @returns {string} HTML with `<span>` wrappers; `textContent` equals `text`
 */
export function highlightCode(text) {
  if (!text) return '';
  let out = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? len : end + 2;
      out += span('cp-comment', esc(text.slice(i, stop)));
      i = stop;
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const stop = nl === -1 ? len : nl;
      out += span('cp-comment', esc(text.slice(i, stop)));
      i = stop;
      continue;
    }

    HEX.lastIndex = i;
    const hex = HEX.exec(text);
    if (hex) {
      out += hexChip(hex[0]);
      i += hex[0].length;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < len && text[j] !== ch && text[j] !== '\n') {
        if (text[j] === '\\') j++;
        j++;
      }
      if (text[j] === ch) j++;
      const body = esc(text.slice(i, j));
      let peek = j;
      while (peek < len && (text[peek] === ' ' || text[peek] === '\t')) peek++;
      // A quoted token followed by a colon is a key. That single lookahead is
      // what keeps `"border"` (a key) from reading like `"hsl(var(--border))"`
      // (a value) — the two are otherwise identical strings.
      out += text[peek] === ':' ? span('cp-key', body) : span('cp-string', chipHexes(body));
      i = j;
      continue;
    }

    if (ch === '-' && text[i + 1] === '-') {
      PROP.lastIndex = i;
      const prop = PROP.exec(text);
      if (prop) {
        out += span('cp-key', esc(prop[0]));
        i += prop[0].length;
        continue;
      }
    }

    if (/[A-Za-z_$@]/.test(ch)) {
      IDENT.lastIndex = i;
      const ident = IDENT.exec(text);
      if (ident) {
        const isAtRule = ident[0][0] === '@';
        const rest = text.slice(ident.index + ident[0].length);
        if (isAtRule || /^\s*:/.test(rest)) {
          out += span('cp-key', esc(ident[0]));
          i += ident[0].length;
          continue;
        }
      }
    }

    if (/[0-9]/.test(ch)) {
      NUM.lastIndex = i;
      const num = NUM.exec(text);
      if (num) {
        out += span('cp-num', num[0]);
        i += num[0].length;
        continue;
      }
    }

    out += esc(ch);
    i++;
  }

  return out;
}
