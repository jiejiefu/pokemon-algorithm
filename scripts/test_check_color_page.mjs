/**
 * Negative tests for check_color_page.mjs — it must FAIL, and name the right
 * reason, for every invariant it claims to police.
 *
 *   node scripts/test_check_color_page.mjs
 *
 * WHY THIS FILE EXISTS. Every check in the checker is a source-level regex or a
 * table invariant, and a regex that no longer matches its target passes for the
 * wrong reason: `node --check` succeeds, the page still renders, and the check
 * reports green while policing nothing. That is the trap the repo already hit
 * twice — gotcha 15's dead-link probe (which passed while `pokemonSlug()` had
 * changed underneath it) and gotcha 25's "check what runs, not what exists".
 * A probe that passes for the wrong reason is worse than no probe, because it
 * is read as coverage.
 *
 * So each case below breaks ONE invariant in a scratch copy of the tree, runs
 * the real checker against it, and requires a non-zero exit AND a specific
 * substring in the output. Asserting only the exit code would pass on a
 * checker that crashed for an unrelated reason, which is how a typo becomes a
 * "passing" test.
 *
 * The harness runs the checker from a temp tree rather than mutating the repo,
 * so a failed case can never leave the working tree modified.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// assets/css/shared.css is here because check_color_page.mjs resolves the
// Theme Exporter's var() targets against it — a checker that reads a file the
// harness does not copy fails its own baseline and takes all 36 cases with it.
const SRC = ['assets/js/shared.js', 'assets/css/colors.css', 'assets/css/shared.css', 'color.html', 'assets/js/color-palette.js'];
const CHECKER = 'scripts/check_color_page.mjs';

let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL ${m}`); };

/** Build a scratch tree containing only what the checker reads, then mutate it. */
function makeTree(mutate) {
  const dir = join(tmpdir(), `ccp-neg-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'assets/js'), { recursive: true });
  mkdirSync(join(dir, 'assets/css'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of SRC) cpSync(join(ROOT, f), join(dir, f));
  cpSync(join(ROOT, CHECKER), join(dir, CHECKER));
  // The checker resolves every NAV href against its own ROOT, and 16 of the 18
  // targets are pages this case does not copy. Symlink the real ones rather
  // than copying: the baseline run then proves the harness itself is sound,
  // instead of every case failing on "missing index.html".
  for (const f of readdirSync(ROOT)) {
    if (f.endsWith('.html') && !existsSync(join(dir, f))) symlinkSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) {
    for (const f of SRC) {
      const p = join(dir, f);
      const before = readFileSync(p, 'utf8');
      // `undefined` means "this case does not target this file". A returned
      // string IDENTICAL to the input means the anchor is stale, and the case
      // would then pass for the wrong reason — so it is an error, not a no-op.
      const after = mutate(f, before);
      if (after === undefined) continue;
      if (after === before) {
        throw new Error(`mutation for ${f} did not change the file — the anchor string is stale, so this case would pass for the wrong reason`);
      }
      writeFileSync(p, after);
    }
  }
  return dir;
}

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Baseline first: if the unmutated copy does not pass, every case below would be
// measuring the harness rather than the checker.
{
  const dir = makeTree(null);
  const { code, out } = run(dir);
  code === 0 ? pass('baseline: the checker passes on an unmutated copy of the tree')
             : fail(`baseline FAILED — the harness is wrong, not the checker:\n${out}`);
  rmSync(dir, { recursive: true, force: true });
}

const cases = [
  {
    // The bug this whole group exists for: the Export Theme rebuild left three
    // `els` keys pointing at ids the new markup no longer had, all null, and
    // `els.copyTheme.addEventListener` threw at module top level — killing the
    // module before init(), so the page never loaded a Pokémon. Every other
    // check stayed green because a null *reference* is legal JS.
    name: 'an els entry pointing at an id the markup no longer declares',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('      themeFilename: document.getElementById', '      themeFilename: null || document.getElementById')
          .replace("getElementById('theme-filename')", "getElementById('theme-filename-gone')")
      : undefined,
    expect: 'never declares',
  },
  {
    name: 'the exporter emitting a class the stylesheet never styles',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('.cp-theme-token-var {', '.cp-theme-token-var-RENAMED {')
      : undefined,
    expect: 'but colors.css never styles them',
  },
  {
    // --surface-1 is the reference project\'s shadcn name. Nothing here defines
    // it, so `background: var(--surface-1)` is dropped at computed-value time
    // and the element goes transparent with no error in any console.
    name: 'the Theme Exporter reaching for a custom property nobody defines',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('.cp-theme-code-block {', '.cp-theme-code-block { background: var(--surface-1);')
      : undefined,
    expect: 'no stylesheet defines',
  },
  {
    name: 'the Theme Exporter CSS block losing its marker',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('/* ── Theme Exporter', '/* Theme Exporter')
      : undefined,
    expect: 'marker is gone',
  },
  {
    // The hover this replaced. A screenshot review would have called it
    // "fine, it has hover feedback", so it has to be a named case.
    name: 'putting the scale back on the swatch',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('.cp-cell:hover {\n  border-color: var(--hairline-strong);', '.cp-cell:hover {\n  transform: scale(0.98);')
      : undefined,
    expect: 'scales under the cursor',
  },
  {
    name: 'dimming the copy glyph to a decorative 0.55',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('  color: inherit;\n  transition: background-color 0.15s ease;\n}', '  color: inherit;\n  opacity: 0.55;\n  transition: background-color 0.15s ease;\n}')
      : undefined,
    expect: 'is at opacity 0.55',
  },
  {
    name: 'dropping the copy glyph, leaving a bare swatch to click',
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace(/\s*<span class="cp-cell-copy" aria-hidden="true">[\s\S]*?<\/span>/, '')
      : undefined,
    expect: 'renders no copy glyph',
  },
  {
    // What the reference project does, and what cannot be copied here.
    name: 'nesting a real button inside the cell button, as the reference does',
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace('<span class="cp-cell-copy" aria-hidden="true">', '<button type="button" class="cp-cell-copy">')
          .replace(/<\/svg>\n\s*<\/span>/, '</svg>\n              </button>')
      : undefined,
    expect: 'nested inside the cell',
  },
  {
    name: 'hardcoding the glyph white instead of inheriting the AA-corrected ink',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('  color: inherit;\n  transition: background-color 0.15s ease;\n}', '  color: #ffffff;\n  transition: background-color 0.15s ease;\n}')
      : undefined,
    expect: 'sets its own colour',
  },
  {
    name: 'deleting the [hidden] companion restores the reported second-sidebar bug',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace(/\.cp-rail-sub\[hidden\]\s*,\s*\.cp-nav-drawer\[hidden\]\s*\{\s*display:\s*none;\s*\}/, '.cp-rail-sub[hidden], .cp-nav-drawer[hidden] { /* gone */ }')
      : undefined,
    expect: 'companion rule is gone',
  },
  {
    name: 'removing the drawer\'s own display:flex makes the companion rule redundant',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace(/(\.cp-nav-drawer\s*\{[^}]*?)display:\s*flex;/s, '$1/* no display */;')
      : undefined,
    expect: 'no longer sets display:flex',
  },
  {
    name: 'hardcoding the disclosure closed hides the page you are on',
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace('aria-expanded="${open}"', 'aria-expanded="false"')
      : undefined,
    expect: 'hardcodes',
  },
  {
    name: 'an always-closed panel is as wrong as an always-open one',
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace("id=\"${panelId}\"${open ? '' : ' hidden'}", 'id="${panelId}" hidden')
      : undefined,
    expect: 'hardcodes',
  },
  {
    name: 'removing the color.html nav row leaves that page claiming nothing',
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace(/\s*\{ href: 'color\.html', label: '單一寶可夢色盤'[^\n]*\n/, '\n')
      : undefined,
    expect: 'claimed by exactly one element',
  },
  {
    name: 'dropping 特殊分類\'s row-level pages strands category.html',
    // The row, not the group, is what claims category.html. Remove its `pages`
    // and the group is left claiming a page no row owns, which is the
    // "no row of its own" rule. The claim-table count below it drops to 10 in
    // the same run, so this deletion is caught twice.
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace("{ href: 'collections.html', pages: ['category.html'], label: '特殊分類'", "{ href: 'collections.html', label: '特殊分類'")
      : undefined,
    expect: 'no row of its own',
  },
  {
    name: 'a row-claimed page missing from the group\'s pages sits inside a closed panel',
    // The other half of the same decision, and the failure the closed-panel
    // section of the checker's own header describes. 圖鑑's `pages` has to list
    // category.html or the group renders collapsed on that page, taking the
    // aria-current it just gained with it — claimed and invisible at once.
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace("pages: ['pokedex.html', 'generations.html', 'collections.html', 'category.html', 'types.html'],", "pages: ['pokedex.html', 'generations.html', 'collections.html', 'types.html'],")
      : undefined,
    expect: 'the group does not list',
  },
  {
    name: 'widening the claim to a bare isActive puts aria-current on a group trigger too',
    // Opposite failure mode of the same expression: the trigger would claim the
    // page as well as the row, and the trigger's claim is invisible whenever the
    // group is collapsed.
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace('const claimsCurrent = isGroup ? item.href === currentPage : isActive;', 'const claimsCurrent = isActive;')
      : undefined,
    expect: 'not the two-branch form',
  },
  {
    name: 'narrowing the claim to href === page drops category.html\'s aria-current',
    // The regression this file's own first run caught: 特殊分類 lists
    // category.html in `pages` and has no groups, so requiring href equality
    // leaves that page with `.is-active` and no aria-current. The TABLE-level
    // ownership checks cannot see this — they read NAV, not the renderer.
    mutate: (f, s) => f.endsWith('shared.js')
      ? s.replace('const claimsCurrent = isGroup ? item.href === currentPage : isActive;', 'const claimsCurrent = item.href === currentPage;')
      : undefined,
    expect: 'not the two-branch form',
  },
  {
    name: 'passing the wrong page name to initColorRail marks nothing current',
    mutate: (f, s) => f.endsWith('color.html') ? s.replace("initColorRail('color.html')", "initColorRail('colors.html')") : undefined,
    expect: 'passes the wrong page',
  },
  {
    name: 'un-exporting initColorRail is a parse-time SyntaxError for every importer',
    mutate: (f, s) => f.endsWith('shared.js') ? s.replace('export function initColorRail', 'function initColorRail') : undefined,
    expect: 'is not exported',
  },
  {
    name: 're-adding the old header nav means the rail was added beside the old chrome',
    mutate: (f, s) => f.endsWith('color.html') ? s.replace('<div class="cp-app"', '<nav class="site-nav"></nav>\n    <div class="cp-app"') : undefined,
    expect: 'old header nav',
  },
  {
    name: 'a drawer mount that ships unhidden paints over the desktop rail',
    mutate: (f, s) => f.endsWith('color.html') ? s.replace('<div class="cp-nav-drawer" data-rail-drawer hidden></div>', '<div class="cp-nav-drawer" data-rail-drawer></div>') : undefined,
    expect: 'does not ship hidden',
  },
  {
    name: 'a skip link relocated out of first position is not the first Tab stop',
    // The first attempt at this case appended text AFTER the link, which the
    // old offset comparison happily accepted — the mutation did not break the
    // invariant it claimed to break, so the case would have passed for the wrong
    // reason. The check now demands the link be the first child of .cp-app.
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace(/(<a class="cp-skip"[\s\S]*?<\/a>)/, '$1PLACEHOLDER') && (() => {
          const m = s.match(/(<a class="cp-skip"[\s\S]*?<\/a>)[\s\S]*?(<div class="cp-scroll")/);
          return m ? s.replace(m[0], '$2') : undefined;
        })()
      : undefined,
    expect: 'not the first child',
  },
  {
    name: 'an unnamed <nav> is announced only as "navigation"',
    mutate: (f, s) => f.endsWith('color.html') ? s.replace('<nav class="cp-rail" data-rail aria-label="主選單">', '<nav class="cp-rail" data-rail>') : undefined,
    expect: 'missing or unnamed',
  },
  {
    name: 'a nav row with no rule is announced but not shown',
    mutate: (f, s) => f.endsWith('colors.css') ? s.replace('.cp-rail-sub-row.is-active,', '.cp-rail-sub-row.was-active,') : undefined,
    expect: 'announced but not shown',
  },
  {
    name: 'a planned row whose target PLANNED_PAGES does not list is a broken promise',
    mutate: (f, s) => f.endsWith('shared.js') ? s.replace("planned: 'moves.html'", "planned: 'moves2.html'") : undefined,
    expect: 'PLANNED_PAGES does not list',
  },
  {
    name: 'a nav href to a file that does not exist is a dead link',
    mutate: (f, s) => f.endsWith('shared.js') ? s.replace("href: 'model3d.html'", "href: 'model3dx.html'") : undefined,
    expect: 'missing files',
  },

  // ---------------------------------------------------------------- panel
  {
    name: 'a grid that displays one notation and copies another looks perfectly correct',
    // The headline bug this unit exists to prevent. The cell renders whatever
    // formatHex returns, so only data-cp-copy betrays it — a screenshot review
    // would pass this.
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace('data-cp-copy="${text}"', 'data-cp-copy="${hex}"')
      : undefined,
    expect: 'silently disagree with the screen',
  },
  {
    name: 'a title/aria-label built from the hex tells a screen reader a different colour than the eye sees',
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace('const tip = `${text} · ', 'const tip = `${hex} · ')
      : undefined,
    expect: 'different colours',
  },
  {
    name: 'dropping the format option default lets a caller that omits it get undefined',
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace("const format = options.format || 'hex';\n  const cols", 'const cols')
      : undefined,
    expect: "no 'format' option defaulting to hex",
  },
  {
    name: 'a format option that is accepted but ignored leaves every caller on hex',
    // The subtlety: the default is still pinned by the case above, so removing
    // only the *use* of the option passes that check and renders rgb pages back
    // as hex with nothing to show for it.
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace("const text = formatHex(hex, format);", 'const text = hex;')
      : undefined,
    expect: 'ignores the format option',
  },
  {
    name: 'a shade scale that follows the format switch loses its stable hex identity',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('<span class="cp-shade-hex">${hex}</span>', '<span class="cp-shade-hex">${format}</span>')
      : undefined,
    expect: 'shade scale follows the format switch',
  },
  {
    name: 'four radios means the control and HEX_FORMATS have drifted apart',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('<label class="sc-tab"><input class="cp-tab-input" type="radio" name="cp-format" value="hsl">',
                  '<label class="sc-tab"><input class="cp-tab-input" type="radio" name="cp-format" value="lab"><span>LAB</span></label>\n              <label class="sc-tab"><input class="cp-tab-input" type="radio" name="cp-format" value="hsl">')
      : undefined,
    expect: 'expected hex, rgb, hsl',
  },
  {
    name: 'radios without a shared name can be checked together, so "the notation" stops having one answer',
    mutate: (f, s) => f.endsWith('color.html') ? s.replace(/name="cp-format"/g, 'name="cp-format-x"') : undefined,
    expect: 'do not share a name',
  },
  {
    name: 'display:none on the radios removes all three from the tab order',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('.cp-tab-input {\n  position: absolute;', '.cp-tab-input {\n  display: none;\n  position: absolute;')
      : undefined,
    expect: 'takes them out of the tab order',
  },
  {
    // The companion case: clipping kept the input reachable, so only the ring
    // was left. A 1px clipped input shows no ring at all, so focus appears to do
    // nothing — which is why the ring is asserted on the label.
    name: 'a 1px clipped radio with the ring only on the input shows keyboard focus doing nothing',
    mutate: (f, s) => f.endsWith('colors.css')
      ? s.replace('.cp-format-tabs .sc-tab:has(.cp-tab-input:focus-visible) {\n  outline: 2px solid currentColor;\n  outline-offset: 2px;\n}', '.cp-tab-input:focus-visible {\n  outline: 2px solid currentColor;\n}')
      : undefined,
    expect: 'shows no ring',
  },
  {
    name: 'a dex field that is a div of buttons loses Enter-to-submit',
    mutate: (f, s) => f.endsWith('color.html') ? s.replace('<form class="cp-panel-group" id="dex-form"', '<div class="cp-panel-group" id="dex-form"') : undefined,
    expect: 'not a <form>',
  },
  {
    name: 'type=number in a scrollport panel lets the wheel edit the dex number',
    // The tag spans two lines, so a one-line anchor moves type="number" onto line
    // 1 and leaves inputmode="numeric" sitting on line 2. The mutation "worked"
    // and still failed the wrong check — the same shape of error as the skip-link
    // case earlier. The whole tag is replaced.
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace(/<input type="text" id="dex-input" class="cp-dex" inputmode="numeric"\n(\s*)placeholder/, '<input type="number" id="dex-input" class="cp-dex"\n$1placeholder')
      : undefined,
    expect: 'type=number inside a scrollable panel',
  },
  {
    name: 'a {1,4} digit test misreports an out-of-range dex as a non-numeric one',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('!/^\\d+$/.test(raw)', '!/^\\d{1,4}$/.test(raw)')
      : undefined,
    expect: 'misreporting an out-of-range dex',
  },
  {
    name: 'a range message that omits the upper bound sends the reader hunting for a roster',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('全國編號範圍是 1–${pokemon.length}。', '這個寶可夢不存在。')
      : undefined,
    expect: 'hardcodes or omits the range',
  },
  {
    name: 'an announcer without aria-live says nothing to a screen reader',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('<p class="sr-only" id="cp-announce" role="status" aria-live="polite"></p>', '<p class="sr-only" id="cp-announce"></p>')
      : undefined,
    expect: 'no polite sr-only live region',
  },
  {
    // The two lists live in different files and are edited by hand, so drift is
    // a matter of time. Each of these is silent: the page renders, nothing
    // throws, and a tab either does nothing or cannot format anything.
    name: 'HEX_FORMATS gaining a notation no radio offers leaves a tab that does nothing',
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace("['hex', 'rgb', 'hsl']", "['hex', 'rgb', 'hsl', 'lab']")
      : undefined,
    expect: 'HEX_FORMATS declares lab with no radio to reach it',
  },
  {
    name: 'a radio offering a notation HEX_FORMATS dropped leaves a tab that formats nothing',
    mutate: (f, s) => f.endsWith('color-palette.js')
      ? s.replace("export const HEX_FORMATS = ['hex', 'rgb', 'hsl'];", "export const HEX_FORMATS = ['hex', 'hsl'];")
      : undefined,
    expect: 'radios offer rgb that HEX_FORMATS does not declare',
  },
  {
    name: 're-typing the notations inline instead of importing them lets the two lists drift',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace(', swatchStyle, HEX_FORMATS,', ', swatchStyle,')
      : undefined,
    expect: 'does not import HEX_FORMATS',
  },
  {
    name: 'a VISIBLE announcer is a label the reader must go hunting for, not an announcement',
    mutate: (f, s) => f.endsWith('color.html')
      ? s.replace('<p class="sr-only" id="cp-announce" role="status" aria-live="polite"></p>', '<p class="cp-results-note" id="cp-announce" role="status" aria-live="polite"></p>')
      : undefined,
    expect: 'no polite sr-only live region',
  },
];

console.log(`\n${cases.length} negative cases, each must exit non-zero AND name its reason\n`);

for (const c of cases) {
  let dir;
  try {
    dir = makeTree(c.mutate);
  } catch (e) {
    fail(`${c.name}\n    harness: ${e.message}`);
    continue;
  }
  const { code, out } = run(dir);
  rmSync(dir, { recursive: true, force: true });
  if (code === 0) fail(`${c.name}\n    checker exited 0 — the invariant is not actually policed`);
  else if (!out.includes(c.expect)) fail(`${c.name}\n    exited ${code} but the output never said "${c.expect}"; it said:\n${out.split('\n').filter((l) => l.includes('FAIL')).join('\n') || '      (no FAIL line at all)'}`);
  else pass(c.name);
}

console.log();
if (failures) {
  console.log(`${failures} of ${cases.length} negative case(s) did not hold`);
  process.exit(1);
}
console.log(`all ${cases.length} negative cases held: each broke the checker with the right reason`);
