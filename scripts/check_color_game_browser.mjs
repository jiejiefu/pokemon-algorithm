#!/usr/bin/env node
/**
 * color-game.html driven over the DevTools Protocol. Run:
 *   node scripts/check_color_game_browser.mjs          (needs the repo on :5500)
 *
 * ## WHY THIS EXISTS, AND WHY IT IS A SEPARATE FILE
 *
 * `check_color_game.mjs` has 260 static checks. Every one of them reads a file off
 * disk, and §3.G1a's finding is the reason that is a ceiling rather than a detail:
 * 170 static and 43 CDP checks once stayed green over a visibly broken page because
 * they asked whether the prose EXIST rather than what it claims. Eight claims on this
 * page had nothing standing behind them but a throwaway CDP probe in `/tmp`, which
 * §3.P's rule already covers — a scratch harness is a checker with no assertions, and
 * `/tmp` makes it one that does not even survive the session. Two of the eight are
 * the shape this project has been bitten by more than once:
 *
 *   - the `≤640px` strip at `100x40`, which §3.W records as **never measured at any
 *     viewport** — a number in a CSS comment, asserted nowhere
 *   - §3.M's `[hidden]` ↔ `display` pairing, asserted as stylesheet TEXT here, where
 *     §3.M's own rule says the computed box is the assertion because the attribute is
 *     the thing that lies
 *
 * and one of the eight is a defect that shipped on the day this file was written:
 *
 *   - a Chinese IME's 選字 (candidate-selection) key IS `Enter`. Nothing in `assets/`
 *     tested `isComposing`, `keyCode === 229` or a composition flag, so typing
 *     「ㄏㄞˇ」 and pressing Enter to commit 「海」 spent one of four daily attempts
 *     on #86 小海獅 (Seel) — the first of the 26 species whose name contains 「海」,
 *     because `pokemon` is in dex order.
 *
 * ## IT IS THE OUTCOME HALF, NOT A REPLACEMENT (§3.G4's split)
 *
 * `check_color_game.mjs` already asserts all four sizes as CSS text: the strip's
 * `140px`, the `≤640px` rule's `100px`, the result sprite's `200px`, and the absence
 * of `image-rendering` on it. **Those assertions stay** — a stylesheet contract is
 * checked by reading it, and they cost 0.2s. What only a browser can say is what the
 * stylesheet actually PRODUCED, so this file measures boxes and pixels, and the
 * direction that matters is measured in BOTH senses of every breakpoint.
 *
 * ## THE SEQUENCING TRAP, PAID FOR ONCE
 *
 * The first version of this file measured the result artwork on a round that had not
 * ended and reported `naturalWidth: 0`. `#gm-result-sprite`'s `src` is assigned inside
 * `renderResult()`, which early-returns while the round is playing — so the element
 * exists, the CSS box is real, and there is no image. Every measurement here is
 * therefore taken on a FINISHED round, and every round is played in **unlimited**
 * mode: a daily round is locked once finished, so a checker that answered today's
 * puzzle would leave `localStorage` holding a result that no later run could replace.
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * **No mutation harness.** Each case would boot its own Chrome against its own tree,
 * so four cases cost about as much as the whole of `test_check_color_game.mjs` — the
 * file that does not exist — would. §3.G5 priced this exact trade when it took
 * `test_check_gen1_apu.mjs` out of the manifest: the cost is named rather than
 * glossed, and what is given up is stated. The mutations live in
 * `check_color_game.mjs`, and three of this file's own invariants were broken by hand
 * to prove the assertions below are not vacuous — see the end of the header.
 *
 * **No sprite stubbing.** §3.G4 had to answer 1,025 sprite requests with 71-byte
 * stubs because `sorting.html` preloads the whole corpus at ~130 MB. This page does
 * not: `spriteUrl` is called from four render functions and only for rows actually on
 * screen, so a stub would be a second thing to keep right in exchange for nothing.
 *
 * **No real input method.** Every key here is dispatched by `dispatchEvent`. That is
 * enough to prove the handler RESPECTS `isComposing` — measured, a constructed
 * `KeyboardEvent` does carry the flag — and to prove the composition-event route
 * works. It cannot prove what Safari or a Windows IME actually send, because that is
 * an engine decision no synthetic event reproduces. The claim is narrowed to what the
 * code does with the signals, not to what any browser sends.
 *
 * **No clipboard.** `navigator.clipboard.writeText` is refused without a real user
 * gesture, so `copyShare()` takes its failure branch here and the assertion would be
 * about headless Chrome rather than about this page.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';
import { until } from './lib/cdp-until.mjs';
import { trackTree } from './lib/tmp-trees.mjs';

/* `cgpage-`, and the prefix is not cosmetic. §3.J's sweep identifies a temp tree by a
 * prefix globbed out of the source, so a prefix that is a PREFIX OF ANOTHER TOOL'S is a
 * sweep that can delete the other tool's live work: `cg-` would have matched another
 * session's `cg-sim-neg-*`, four 6.1 MB trees, and §3.J's own warning is about taking
 * 4.2 GB belonging to something else. `cgpage-` cannot collide with that, and it follows
 * the `crl-` / `lifepage-` / `sortpage-` convention for the same reason.
 *
 * It is registered in AGENTS.md §3.J's allowlist, which is derived from source by that
 * section's own rule. A prefix nobody records is one the sweep cannot recognise as ours. */
const profile = trackTree(mkdtempSync(join(tmpdir(), 'cgpage-')));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
/* Chrome chose its own debug port; §3.J's orphan incident makes reading it back from
 * the profile the only scheme, because a derived port is a collision and a collision
 * is a checker driving a stranger's browser. */
const CDP = await waitForDebugPort(profile);
process.on('exit', () => { try { chrome.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { chrome.kill(); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); });
}

let targets;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); if (r.ok) { targets = await r.json(); break; } } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map(); const exceptions = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`EXC ${((d.exception && d.exception.description) || d.text || '').split('\n')[0]} @ ${d.url || '?'}`);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  waiting.set(n, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]);
  return r.result.value;
};

let checks = 0; const fails = [];
/**
 * `ok(cond, what[, detail])`, and the third argument is the MEASUREMENT.
 *
 * Not decoration. Every assertion in this file took a number, and a geometry line
 * whose failure cannot say what it measured is a red nobody can act on. §3.G9's rule:
 * 「the message quotes the named constant or it quotes a lie」.
 */
const ok = (cond, what, detail) => {
  checks++;
  const line = detail ? `${what} — ${detail}` : what;
  if (!cond) fails.push(line);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${line}`);
};

/**
 * `until()`, but a TIMEOUT IS A RED LINE WITH A NAME rather than a discarded `false`.
 *
 * `until` returns a boolean and the first version of this file ignored it at seven
 * call sites, which is §3.G5's rule in its purest form: **an unchecked poll is a
 * fixed sleep with extra steps**. It cost one intermittent failure in nine runs — a
 * result panel measured at `top: 0, height: 0`, which is the signature of a
 * `display: none` element's rect, so a poll had given up and the assertion below it
 * went on to describe a page that was not there. The downstream check failed for the
 * wrong reason, and the reason it failed for the wrong reason was invisible.
 *
 * One red line naming the wait, and the cascade after it is readable rather than
 * mysterious.
 */
async function settle(what, expr, ceiling = 8000) {
  const hit = await until(ev, expr, ceiling);
  ok(hit, `waited for: ${what}`,
    `\`${expr.replace(/\s+/g, ' ').slice(0, 80)}\` never held within ${ceiling}ms — an unchecked poll is a fixed sleep with extra steps`);
  return hit;
}

await send('Page.enable');
await send('Runtime.enable');

const PORT = process.env.CRY_PORT || 5500;
const PAGE = `http://localhost:${PORT}/color-game.html`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/* 641 is one pixel WIDER than the `max-width: 640px` rule that resizes the strip.
 * A breakpoint asserted only from one side is satisfied by a rule that never stops
 * applying, and that is a rule which silently overrides the desktop layout at every
 * width above it. */
const JUST_ABOVE = { width: 641, height: 900 };

/**
 * Switch viewport, and PROVE it took effect before anything is measured at it.
 *
 * `Emulation.setDeviceMetricsOverride` rather than a Chrome flag, because the flag is
 * clamped to the host's screen here. And the read is on the far side of the command:
 * A CDP COMMAND RESOLVING IS NOT THE PAGE HAVING APPLIED IT — measured on
 * `check_spectrum_browser.mjs`, `innerWidth` read on the line after the override
 * returned the PREVIOUS width, and every number taken against it described a layout
 * the file did not intend to check.
 */
async function atSize(size) {
  await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: size.width < 500 });
  const SEEN = await settle(`the viewport to become ${size.width}px wide`, `innerWidth === ${size.width}`, 3000);
  const WIDTH = await ev('innerWidth');
  ok(SEEN, `the viewport is ${size.width}x${size.height} before anything is measured at it`,
    `asked for ${size.width}, page reports ${WIDTH}px — a CDP command resolving is not the page having applied it`);
  return WIDTH;
}

/**
 * Load the page, size it, and start an UNLIMITED round.
 *
 * **Navigate FIRST, then size.** An override set on `about:blank` is discarded by the
 * navigation that follows it, so the first version of `check_cry_mobile_layout.mjs`
 * sized first and then navigated, and its own poll caught it reporting 980px where
 * 390 had been asked for.
 *
 * Readiness is polled on the search field being ENABLED, not on `readyState`. `init()`
 * fetches `pokemon_data.json` (2.9 MB) and `color_palettes.json` (0.66 MB) before it
 * enables anything, so `complete` is true while the page is still unusable — and a
 * checker that measured there would measure a page mid-boot.
 */
async function open(size, { fresh = true, mode = 'unlimited' } = {}) {
  if (fresh) await send('Page.navigate', { url: PAGE });
  await atSize(size);
  /* TWO WRONG SIGNALS BEFORE THE RIGHT ONE, and both are the shape this session has
   * been catching all afternoon.
   *
   * **NOT "the field is enabled".** Arriving at a daily you already finished RESTORES a
   * finished round, and `renderAll()` disables the search field for the rest of the
   * page's life — so "enabled" is a claim about whether the round is still playable,
   * not about whether init() ran, and on a restored round this checker deliberately
   * provokes it never becomes true.
   *
   * **NOT "`aria-checked` is not null" either.** That is the second version and it is
   * worse, because it was VACUOUS: `<button aria-checked="true">` is in the markup, so
   * the predicate was true on the first byte, before one line of the module had run.
   * The geometry group then measured a page mid-boot — a 0px-tall result panel and a
   * give-up click that went nowhere — and three of its checks failed for that reason
   * and no other. A readiness gate satisfied by static markup is not a gate.
   *
   * `#gm-difficulty-note` is EMPTY in the markup and written by `renderAll()`
   * unconditionally, so it can only be non-empty once the module has run to the end. */
  const BOOT = await settle('init() to run to the end', `!!document.getElementById('gm-difficulty-note').textContent`, 25000);
  ok(BOOT, 'init() ran to the end — it filled the difficulty note',
    'the note is empty in color-game.html and written by renderAll(); aria-checked is in the MARKUP, so waiting for it waits for nothing');
  /* Unlimited: infinite attempts, and no daily write, so no round here can lock the
   * day for the next run. Every measurement below needs more than four guesses'
   * worth of freedom, and a daily would refuse the fifth. */
  await ev(`document.querySelector('[data-mode="${mode}"]').click(); 1`);
  const SWITCHED = await settle(`the ${mode} tab to be selected`, `document.querySelector('[data-mode="${mode}"]').getAttribute('aria-checked') === 'true'`);
  ok(SWITCHED, mode === 'unlimited'
    ? 'and it is in unlimited mode — a daily round locks once finished, so a checker that answered one would poison the next run'
    : 'and it is in DAILY mode, because the win case must answer the round the store names');
}

const type = (n) => ev(`(() => { const i = document.getElementById('gm-search'); i.value = ${JSON.stringify(n)};
  i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const enter = (extra = '') => ev(`document.getElementById('gm-search')
  .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true ${extra} })); 1`);
const status = () => ev(`document.getElementById('gm-search-status').textContent`);
/* FILLED slots, and the distinction is not cosmetic. `.gm-slot` is **always four**:
 * §3.W's invariant is that the slots are in the DOM from the start so the row's height
 * does not jump mid-round, which means counting them measures nothing at all — the first
 * version of this file asserted `slots() === 0` after a composing Enter and read `4`,
 * failing every attempt check for the same reason while learning nothing about attempts.
 * `.gm-slot-sprite` is only written for a real guess; `.gm-slot-placeholder` is the
 * empty state. */
const slots = () => ev(`document.querySelectorAll('.gm-slot-sprite').length`);
const placeholders = () => ev(`document.querySelectorAll('.gm-slot-placeholder').length`);
const rowCount = () => ev(`document.querySelectorAll('#gm-search-list .gm-search-item').length`);
const clickRow = () => ev(`document.querySelector('#gm-search-list .gm-search-item').click(); 1`);
const giveUp = () => ev(`document.getElementById('gm-giveup').click(); 1`);
const submit = () => ev(`document.getElementById('gm-submit').click(); 1`);

/* The target's own name, read out of the page's visible answer line rather than from
 * any internal. Everything below asks about THAT species, so no assertion can pass by
 * guessing a different answer to a different question. */
const answerName = () => ev(`(() => { const a = document.querySelector('.gm-result-answer a'); return a ? a.textContent : ''; })()`);

// ===========================================================================
console.log('\n§3.M: every [hidden] element has NO BOX, not an attribute that says so');
// ===========================================================================
{
  exceptions.length = 0;
  await open(DESKTOP);
  /* Measured on a fresh load: all seven are `display: none` AND `height: 0`. The
   * second reading is not redundant — §3.M's whole finding is that an author `display`
   * beats the user-agent's `[hidden] { display: none }` REGARDLESS of specificity, so
   * `getComputedStyle` is what decides it and `el.hidden` reads `true` either way. */
  /* EVERY `[hidden]` element on the page, not a list of the ones this file remembers.
   * A hardcoded id list is satisfied vacuously by a page that stopped using the
   * attribute, and it also broke on the first run: `#gm-gen` carries `hidden` in the
   * markup and is SHOWN in easy mode, which is the default — so "hidden on a fresh
   * load" is a claim about a round's state, not about an element. The invariant is the
   * one that does not care: if the attribute is set, nothing paints. */
  const hidden = await ev(`(() => [...document.querySelectorAll('[hidden]')].map((el) => {
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return { id: el.id || el.className.split(' ')[0], display: cs.display, h: Math.round(b.height) };
  }))()`);
  const WANTED = ['gm-hints', 'gm-hint-bar', 'gm-shiny-badge', 'gm-submit', 'gm-search-list', 'gm-result'];
  ok(hidden.length >= WANTED.length, `the page carries ${hidden.length} [hidden] elements on a fresh load`,
    `expected at least ${WANTED.length}; a count that fell means an element stopped being hidden, and a per-id list would pass anyway`);
  for (const h of hidden) {
    ok(h.display === 'none' && h.h === 0, `#${h.id} paints nothing`,
      `display: ${h.display}, height ${h.h}px — an author display beats the UA sheet's [hidden] whatever its specificity`);
  }
  const missing = WANTED.filter((id) => !hidden.some((h) => h.id === id));
  ok(missing.length === 0, 'and this page\'s own six are among them',
    missing.length ? `not hidden: ${missing.join(', ')}` : 'gm-hints, gm-hint-bar, gm-shiny-badge, gm-submit, gm-search-list, gm-result');
  /* The other direction, because the attribute only lies in ONE of them. A panel that
   * is `hidden` correctly but can never be shown again passes every check above. */
  await type('皮卡丘');
  const shown = await ev(`(() => { const b = document.getElementById('gm-submit'); const r = b.getBoundingClientRect();
    return { display: getComputedStyle(b).display, h: Math.round(r.height), w: Math.round(r.width) }; })()`);
  ok(shown.display !== 'none' && shown.h >= 40 && shown.w >= 40, 'and the same elements do paint when revealed',
    `#gm-submit became ${shown.w}x${shown.h}, display: ${shown.display} — a button that can be hidden correctly and never shown passes the half above`);
  ok(exceptions.length === 0, 'nothing threw while the page booted and the field became usable',
    exceptions.join(' | '));
}

// ===========================================================================
console.log('\n§3.F: a Chinese IME 選字 (candidate-selection) key is Enter too, and it must cost nothing');
// ===========================================================================
{
  exceptions.length = 0;
  await open(DESKTOP);
  await type('海');
  const rows = await rowCount();
  ok(rows > 1, `「海」 is genuinely ambiguous (${rows} rows) — the case that spent an attempt`,
    'a one-row query would submit on the first Enter and the whole guard would be untested');

  /* MEASURED, and this is what makes the assertion worth writing: a constructed
   * KeyboardEvent DOES carry the init dict's `isComposing`, so the flag the handler
   * reads can be set from here. If it could not, every assertion below would be green
   * for the wrong reason — the handler would be reached and the guard would never be
   * the reason nothing happened. */
  const carried = await ev(`(() => { const e = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true });
    return { isComposing: e.isComposing, key: e.key }; })()`);
  ok(carried.isComposing === true, 'a constructed KeyboardEvent can carry isComposing, so the guard is reachable from here',
    `read back isComposing: ${carried.isComposing}, key: ${carried.key} — if this were false the three checks below would pass for the wrong reason`);

  const before = { field: await ev(`document.getElementById('gm-search').value`), status: await status(), rows: await rowCount() };
  await enter(', isComposing: true');
  const after = await ev(`(() => ({ field: document.getElementById('gm-search').value,
    status: document.getElementById('gm-search-status').textContent,
    rows: document.querySelectorAll('#gm-search-list .gm-search-item').length,
    slots: document.querySelectorAll('.gm-slot').length,
    listOpen: !document.getElementById('gm-search-list').hidden }))()`);
  ok(after.field === before.field && after.status === before.status && after.rows === before.rows,
    'an Enter carrying isComposing leaves the field, the list and the status line exactly as they were',
    `field ${JSON.stringify(before.field)} → ${JSON.stringify(after.field)}, status ${JSON.stringify(before.status)} → ${JSON.stringify(after.status)}`);
  ok(!after.listOpen === false, 'and it does not close the list either', `list still open: ${after.listOpen}`);
  ok(await slots() === 0, 'and NO attempt is spent — this is the whole defect',
    `${await slots()} slots after a composing Enter; the shipped behaviour was one of four daily attempts gone`);

  /* The legacy signal, separately, because it is a separate engine. */
  await enter(', keyCode: 229');
  ok(await status() === before.status && await slots() === 0,
    'and so does an Enter carrying keyCode 229, which is what some Windows IMEs send instead',
    `status ${JSON.stringify(await status())}, ${await slots()} slots`);

  /* Safari's route: `isComposing === false` on the keydown that commits, so the guard
   * has to be tracking `compositionstart`/`compositionend` too. Asserted with REAL
   * composition events rather than the flag, so the wiring itself is what is measured. */
  await ev(`document.getElementById('gm-search').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); 1`);
  await enter();
  const mid = await status();
  await ev(`document.getElementById('gm-search').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); 1`);
  ok(mid === before.status && await slots() === 0,
    'compositionstart alone holds the guard too, which is the path Safari takes',
    `status after Enter mid-composition: ${JSON.stringify(mid)}, ${await slots()} slots`);

  /* AND IT RELEASES. A guard that never lifts is not a guard, it is a dead field. */
  await enter();
  const released = await status();
  ok(/^已選好 #\d+/.test(released), 'and compositionend releases it — the next Enter selects as normal',
    `status: ${JSON.stringify(released)}`);
  ok(await slots() === 0, 'still with nothing spent, because a selection is not a guess', `${await slots()} slots`);
  ok(exceptions.length === 0, 'nothing threw through the whole IME sequence', exceptions.join(' | '));
}

// ===========================================================================
console.log('\nwhile the list is open, Enter SELECTS — and one row means it submits');
// ===========================================================================
{
  exceptions.length = 0;
  /* AMBIGUOUS: select, never submit. */
  await open(DESKTOP);
  await type('海');
  const first = await ev(`document.querySelector('#gm-search-list .gm-search-item').dataset.id`);
  await enter();
  const picked = await ev(`document.getElementById('gm-search').value`);
  ok(!!picked && picked !== '海' && /^已選好 #\d+/.test(await status()),
    'Enter on an ambiguous list fills the field with a whole name and arms it',
    `typed 「海」, field became 「${picked}」, status 「${await status()}」`);
  ok(await slots() === 0, 'and spends nothing', `${await slots()} slots — the shipped defect spent one of four attempts here`);
  /* The second Enter is what submits, and it must submit the ARMED species rather
   * than re-deriving one from the field. */
  await enter();
  ok(await slots() === 1, 'the SECOND Enter submits it', `${await slots()} slots`);
  /* PARENTHESES. `await ev(x).includes(y)` parses as `await (ev(x).includes(y))` — the
   * method binds to the PROMISE, which is the same silent shape as §3.X's
   * `nth-of-type` and it threw rather than passing, which is the better of the two. */
  const href = await ev(`(document.querySelector('.gm-slot-strip') || {}).getAttribute ? document.querySelector('.gm-slot-strip').getAttribute('href') : ''`);
  ok(String(href).includes('color.html'), 'and it submits the one that was armed',
    `the slot strip links to ${href} — the palette page of the species the reader chose, which §3.A requires be built by paletteUrl()`);

  /* ARROW KEYS, because a listbox that cannot be walked leaves the first row as the
   * only reachable one — which is the defect the two-step rule was half-solving. */
  await open(DESKTOP);
  await type('海');
  await ev(`document.getElementById('gm-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); 1`);
  await ev(`document.getElementById('gm-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); 1`);
  const walked = await ev(`document.querySelector('#gm-search-list [aria-selected="true"]')?.dataset.id`);
  ok(walked && walked !== first, 'and ↓ walks to a row other than the first',
    `first row #${first}, two ↓ land on #${walked} — with no arrow handling the only reachable row is the top one`);
  await enter();
  ok(String(await ev(`document.getElementById('gm-search').value`)).length > 1 && await slots() === 0,
    'and Enter then takes the row the reader walked to, still without spending anything',
    `field 「${await ev(`document.getElementById('gm-search').value`)}」, ${await slots()} slots`);

  /* SOLE CANDIDATE: submit. 「海星星」 matches one species, so Enter there is the reader
   * naming their answer rather than choosing among options. */
  await open(DESKTOP);
  await type('海星星');
  const sole = await ev(`document.querySelectorAll('#gm-search-list .gm-search-item:not(.is-used)').length`);
  ok(sole === 1, '「海星星」 is a unique name, so the list holds one candidate', `${sole} candidate(s)`);
  await enter();
  ok(await slots() === 1, 'and Enter submits it in ONE press',
    `${await slots()} slots — the exception exists because there is no choice left to make`);

  /* THE CLOSED-LIST ROUTE, and reaching it took a correction. `searchMatches()`
   * already covers zh / zh_HK / en / ja and the number by substring, so ANY whole name
   * matches at least itself and the list is always open — the first version typed
   * `Staryu`, which is #121's own English name, and asserted the list was closed. The
   * list closes the way a reader closes it: `Escape`. That is also the route
   * `canSubmit()`'s Escape branch exists for, and it is the only way `resolveExact()`
   * is reachable at all. */
  await open(DESKTOP);
  await type('海星星');
  const wasOpen = await ev(`!document.getElementById('gm-search-list').hidden`);
  ok(wasOpen === true, 'a whole name opens the list on its own match', `list open: ${wasOpen}`);
  await ev(`document.getElementById('gm-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); 1`);
  ok(await ev(`document.getElementById('gm-search-list').hidden`) === true,
    'Escape closes it', 'the list is closed and the field still holds a whole name');
  ok(await ev(`!document.getElementById('gm-submit').hidden`), 'and the 作答 button appears, because canSubmit() asks the same question Enter will',
    'the button and the key cannot disagree about whether this round is still answerable');
  await enter();
  ok(await slots() === 1, 'and Enter then submits the whole name', `${await slots()} filled slot — resolveExact() is the only route left with no list open`);

  /* And a query matching NOTHING costs nothing and says why — the failure path that a
   * silent no-op would make indistinguishable from a broken field. */
  await open(DESKTOP);
  await type('zzzz');
  await enter();
  ok(/^找不到/.test(await status()), 'a query matching nothing reports why and spends no attempt',
    `status 「${await status()}」, ${await slots()} slots`);
  ok(exceptions.length === 0, 'nothing threw across the whole Enter chain', exceptions.join(' | '));
}

// ===========================================================================
console.log('\nthe round ends 217px and 403px below the fold, and is said out loud');
// ===========================================================================
{
  /* The eight round-end paths, each read back off the page's own live region. Every
   * one of them is a defect that shipped: the status line was cleared AFTER the round
   * ended; 放棄 does not dismiss the suggestion list; an armed pick survived the round;
   * and a dispatched Enter reached a handler on a disabled input. */
  const endsWith = async (n, want) => ok(await status() === want, n, `status 「${await status()}」`);
  /* Recomputed per round, and that is a bug this file shipped into itself first.
   * `lost` was computed once from the first 放棄 and compared against three later
   * rounds — and unlimited mode draws a NEW species every time, so two of the three
   * were being compared to another round's answer. An assertion about "the round that
   * just ended" has to name THAT round. */
  const lostNow = async () => `這次沒猜到。答案是 ${await answerName()}。`;

  /* 放棄 with nothing guessed: NOTHING in view changes, which is why this exists. */
  await open(DESKTOP);
  await giveUp();
  await settle('the result panel to be revealed', `!document.getElementById('gm-result').hidden`);
  await endsWith('放棄 with no guesses announces the answer', await lostNow());
  ok(await slots() === 0, 'having spent nothing', `${await slots()} filled of 4 slots`);

  /* The scroll: measured at both widths and with reduced motion, all landing at
   * top: 0 — `block: 'start'` on a panel the header does not cover, because
   * `.header` is `position: relative` and not sticky. */
  /* POLLED, because the panel unhides on the same frame the scroll STARTS. Reading
   * `scrollY` on the line after the unhide reported 0 and `top` 1118 — the animation
   * had not moved yet, which is §3.G5's rule (a command resolving is not the page
   * having applied it) wearing a scroll's clothes. The predicate is the DESTINATION,
   * never the fact of having called the scroll. */
  await settle('the panel to finish scrolling to the top', `(() => { const el = document.getElementById('gm-result');
    if (el.hidden) return false; const b = el.getBoundingClientRect();
    return b.height > 200 && Math.abs(b.top) < 2; })()`);
  const landed = await ev(`(() => { const b = document.getElementById('gm-result').getBoundingClientRect();
    return { top: Math.round(b.top), scrollY: Math.round(scrollY), h: Math.round(b.height) }; })()`);
  ok(Math.abs(landed.top) <= 1 && landed.h > 200, 'and the reader is scrolled to it, aligned to the top',
    `#gm-result is at top ${landed.top}px, ${landed.h}px tall, scrollY ${landed.scrollY} — it starts 217px below the fold at 1440x900`);

  /* 放棄 with the suggestion list OPEN. It stays open, because the give-up click
   * handler returns before the click-outside branch — and a live row on a finished
   * round is what armed a species Enter then fed to a `submitGuess()` that refuses. */
  await open(DESKTOP);
  await type('海');
  await giveUp();
  await settle('the result panel to be revealed', `!document.getElementById('gm-result').hidden`);
  ok(await ev(`!document.getElementById('gm-search-list').hidden`) === true,
    '放棄 leaves the suggestion list open — the trap this assertion documents',
    'its click handler returns on #gm-giveup before reaching the click-outside branch');
  await clickRow();
  await endsWith('and a stale row clicked after it says the round is over', '這次已經結束了。答案是 小海獅。');
  await enter();
  await endsWith('and Enter after that still does not answer', '這次已經結束了。答案是 小海獅。');
  ok(await slots() === 0, 'and spends nothing', `${await slots()} slots`);

  /* ARM, THEN 放棄, THEN Enter — the armed pick must not survive into a round
   * `submitGuess()` refuses, with `submitPendingPick()` having already said yes. */
  await open(DESKTOP);
  await type('海');
  await clickRow();
  const armed = await status();
  ok(/^已選好/.test(armed), 'a row click arms a pick while the round is going', `status 「${armed}」`);
  await giveUp();
  await settle('the result panel to be revealed', `!document.getElementById('gm-result').hidden`);
  await enter();
  await endsWith('arm → 放棄 → Enter announces the outcome rather than submitting into a dead round', await lostNow());
  ok(await slots() === 0, 'with nothing spent by that Enter', `${await slots()} filled of 4 slots`);

  /* THE WIN. The daily round is the only one whose target can be read without
   * guessing — `localStorage` holds it — and answering it writes a locked result, so
   * this runs in a FRESH profile by construction (every run gets its own
   * `--user-data-dir`) and it is the last thing the file does. */
  await open(DESKTOP, { fresh: true, mode: 'daily' });
  const won = await ev(`(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('pokemon-colorgame:daily:'));
    const t = JSON.parse(localStorage.getItem(key)).target;
    const data = await (await fetch('assets/data/pokemon_data.json')).json();
    return data.find((x) => x.id === t.id).names.zh + (t.variant === 's' ? '（異色）' : '');
  })()`);
  await type(won);
  const soleWin = await ev(`document.querySelectorAll('#gm-search-list .gm-search-item:not(.is-used)').length`);
  await enter();
  if (soleWin === 1) {
    await endsWith('a win announces the answer', `答對了。答案是 ${won}。`);
    ok(await ev(`document.getElementById('gm-result-title').textContent`) === '答對了',
      'and the panel heading says the same thing',
      `heading 「${await ev(`document.getElementById('gm-result-title').textContent`)}」`);
  } else {
    /* The name is a substring of other names, so the list holds several rows and the
     * first Enter only SELECTS. That is the rule working, not a failure. */
    ok(soleWin > 1, `the answer 「${won}」 matches ${soleWin} species, so Enter selects first`,
      'a name that is a substring of others cannot submit in one press — that is the rule, not a defect');
    await enter();
    await endsWith('a win announces the answer after the second Enter', `答對了。答案是 ${won}。`);
  }
  /* AND IT SURVIVES a second Enter, which is what the status-line guard is for. */
  await enter();
  await endsWith('and survives a second Enter, which used to clear it', `答對了。答案是 ${won}。`);
}

// ===========================================================================
console.log('\n§3.M: the ≤640px rule, measured at 390 AND at 641');
// ===========================================================================
{
  /* The row §3.W records as **never measured at any viewport**. Five segments across
   * the sprite's own 44px is 8.8px each, which is not a colour — so the strip gets its
   * own size, and the number is a claim rather than a measurement until now. */
  const measure = `(() => {
    const st = document.querySelector('.gm-slot-strip');
    const sp = document.querySelector('.gm-slot-sprite');
    const a = st.getBoundingClientRect();
    return {
      strip: [Math.round(a.width), Math.round(a.height)],
      segs: [...st.querySelectorAll('span')].map((x) => Math.round(x.getBoundingClientRect().width * 10) / 10),
      sprite: [Math.round(sp.getBoundingClientRect().width), Math.round(sp.getBoundingClientRect().height)],
      artwork: Math.round(document.getElementById('gm-result-sprite').getBoundingClientRect().width),
    };
  })()`;

  const oneGuess = async (size) => {
    await open(size);
    await type('皮卡丘');
    await clickRow();
    await submit();
    await settle('the first guess to paint its slot', `document.querySelectorAll('.gm-slot-strip').length === 1`);
    /* The artwork is assigned in `renderResult()`, which early-returns while the round
     * plays. Measuring it here reports `naturalWidth: 0` — the sequencing trap in the
     * header, paid for once. */
    await giveUp();
    await settle('the result panel AND its artwork', `!document.getElementById('gm-result').hidden && document.getElementById('gm-result-sprite').naturalWidth > 0`);
    return ev(measure);
  };

  const d = await oneGuess(DESKTOP);
  ok(d.strip[0] === 140 && d.strip[1] === 56, 'the strip is 140x56 on the desktop',
    `measured ${d.strip.join('x')}px`);
  ok(d.segs.length === 5, 'and carries exactly five segments', `${d.segs.length} segments: ${d.segs.join(' / ')}`);
  /* 28.2 x 4 and 27.2 for the last: `border-right: 1px` on every cell but the last,
   * so the odd one out is the border and not a rounding accident. A proportional strip
   * would answer with the shares instead. */
  ok(d.segs.slice(0, 4).every((w) => Math.abs(w - 28.2) < 0.5) && Math.abs(d.segs[4] - 27.2) < 0.5,
    'each of which is 28.2px, the last 27.2 — equal cells, not proportional to share',
    `segments ${d.segs.join(' / ')}px; a 3.1% share on real sprites would make the first cell a third of the strip`);

  /* THE BASIS, because the pixel widths CANNOT answer this and the assertion above
   * looks like it can. A mutation from `flex: 1 1 0` to `flex: 1 1 auto` left all four
   * desktop widths and both segment measurements byte-identical — the cells are EMPTY,
   * so an `auto` basis resolves from content width, which is 0, and flex-grow then
   * divides the row evenly anyway. So §3.W's claim (`flex: 1 1 0`, "not `flex: 1 1
   * auto` and not a percentage of each share") is a claim about the COMPUTED BASIS, and
   * that is what is read. The proportionality bites the day a cell carries content —
   * a share label inside the strip — and it is exactly the day nobody re-reads this. */
  const basis = await ev(`(() => { const c = getComputedStyle(document.querySelector('.gm-slot-strip span'));
    return { basis: c.flexBasis, grow: c.flexGrow, shrink: c.flexShrink }; })()`);
  ok(basis.basis === '0px' && basis.grow === '1',
    'and each cell\'s flex-basis is 0, so the cells are equal rather than content-sized',
    `flex: ${basis.grow} ${basis.shrink} ${basis.basis} — an auto basis resolves from the cell's content, and these cells are empty today, so the WIDTHS cannot tell the two apart`);

  const p = await oneGuess(PHONE);
  ok(p.strip[0] === 100 && p.strip[1] === 40, 'and 100x40 at 390x844, on its own selector',
    `measured ${p.strip.join('x')}px — the ≤640px rule lists .gm-slot-strip separately, and lumping it in with the sprite's 44px is the mutation that must not survive`);
  ok(p.segs.length === 5 && p.segs.every((w) => w >= 19),
    'still five legible bands, ~20px each',
    `segments ${p.segs.join(' / ')}px — at the sprite's own 44px they would be 8.8px each, which is not a colour`);
  ok(p.sprite[0] === 44 && p.sprite[1] === 44, 'while the sprite beside it is still 44x44',
    `sprite ${p.sprite.join('x')}px — the strip resizes, the sprite does not`);
  ok(p.artwork === 200, "and the result artwork is still 200px — the round's only reward survives to 390px",
    `${p.artwork}px at 390x844; the ≤640px rule must not reach it`);

  /* THE OTHER DIRECTION. A breakpoint asserted only from one side is satisfied by a
   * rule that never stops applying. */
  const j = await oneGuess(JUST_ABOVE);
  ok(j.strip[0] === 140 && j.strip[1] === 56, 'and it goes BACK to 140x56 one pixel above the breakpoint',
    `measured ${j.strip.join('x')}px at 641px — a max-width rule with no upper bound would hold the phone size forever`);

  /* The artwork's own claim: official 475px art at 200px is a DOWNSCALE, so
   * `image-rendering: pixelated` would be wrong here and is right on the 96px slot. */
  const art = await ev(`(() => { const s = document.getElementById('gm-result-sprite');
    return { naturalWidth: s.naturalWidth, rendering: getComputedStyle(s).imageRendering,
             slotRendering: getComputedStyle(document.querySelector('.gm-slot-sprite')).imageRendering }; })()`);
  ok(art.naturalWidth === 475, 'the result image is official 475px artwork',
    `naturalWidth ${art.naturalWidth} — a 96px sprite here would mean the reveal never got its own upgrade`);
  ok(art.rendering === 'auto' && art.slotRendering === 'pixelated',
    'scaled smoothly, while the 96px slot sprite is still pixelated',
    `result: ${art.rendering}, slot: ${art.slotRendering} — nearest-neighbour is right for a 96px sprite upscaled and wrong for 475px art at 200px`);
}

// ===========================================================================
console.log('\n§3.X: the reduced-motion path lands where the animated one does');
// ===========================================================================
{
  /* Two claims, one measurement: `revealResult()` reads the query at the moment of
   * the scroll and swaps `smooth` for `auto`, so the two configurations must agree on
   * WHERE they land. If only the animated one were asserted, a reader who asked for
   * less motion would get a different page. */
  for (const [reduce, label, instant] of [['no-preference', 'motion allowed', false], ['reduce', 'REDUCED MOTION', true]]) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce }] });
    await open(DESKTOP);
    await giveUp();
    await settle('the result panel to be revealed', `!document.getElementById('gm-result').hidden`);
    /* TWO SAMPLES, because DESTINATION ALONE CANNOT ANSWER THE QUESTION and asserting
     * it anyway was VACUOUS — the mutation that deletes the `reduced ? 'auto' : 'smooth'`
     * ternary and scrolls smoothly either way leaves every other check in this file
     * green, because both paths end in the same place. That is the whole defect
     * `prefers-reduced-motion` exists for, measured away.
     *
     * `behavior: 'auto'` completes inside the same task as the click, so the first
     * `scrollY` read is already the destination. `behavior: 'smooth'` queues an
     * animation, so the same read is still short of it — 40ms apart is enough to see
     * the difference without being a fixed sleep, because the assertion is "did it
     * move between these two reads", not "was N milliseconds enough". */
    const first = await ev('scrollY');
    await new Promise((r) => setTimeout(r, 40));
    const second = await ev('scrollY');
    const dest = await ev(`Math.round(document.getElementById('gm-result').getBoundingClientRect().top + scrollY)`);
    /* AGAINST THE DESTINATION, not as a delta between two samples. The delta version
     * was `Math.abs(second - first) > 2` and a mutation that changed something
     * unrelated was caught by IT — `scrollY 0 → 2` across 40ms — which is a 2px
     * threshold on the first frames of a browser animation, i.e. a threshold that can
     * lose a race with the frame clock. The distance from the destination is the
     * quantity with room in it: measured 1118 → 0 under `auto`, and 0 → ~1100 under
     * `smooth`, which is three orders of magnitude of margin rather than one pixel.
     *
     * `second` is still read, and it is what makes the failure legible: a reader who
     * asked for less motion and got an animation is visible as motion BETWEEN the
     * samples, not only as a slow start. */
    const arrivedAtOnce = Math.abs(first - dest) < 5;
    const stillMoving = Math.abs(second - first) > 2;
    ok(instant ? (arrivedAtOnce && !stillMoving) : !arrivedAtOnce,
      `${label}: the viewport ${instant ? 'does not' : 'does'} animate on the way`,
      `scrollY ${Math.round(first)} → ${Math.round(second)} against a destination of ${dest} — the first read is ${arrivedAtOnce ? '' : 'not '}already there; only measuring the PAIR can tell an instant jump from an animation`);

    await settle('the panel to finish scrolling to the top', `(() => { const el = document.getElementById('gm-result');
      if (el.hidden) return false; const b = el.getBoundingClientRect();
      return b.height > 200 && Math.abs(b.top) < 2; })()`);
    const r = await ev(`(() => { const b = document.getElementById('gm-result').getBoundingClientRect();
      return { top: Math.round(b.top), scrollY: Math.round(scrollY) }; })()`);
    ok(Math.abs(r.top) <= 1, `and the panel lands at the top with ${label}`,
      `top ${r.top}px, scrollY ${r.scrollY} — the two configurations must agree, or a reader who asked for less motion gets a different page`);
  }
  await send('Emulation.setEmulatedMedia', { features: [] });
}

// ===========================================================================
console.log('\nnothing threw, and no browser is left running');
// ===========================================================================
{
  ok(exceptions.length === 0, 'no uncaught exception was raised at any point in this file',
    exceptions.join(' | '));
}

/* Chrome is killed and WAITED FOR before letting `tmp-trees.mjs`'s sweep run:
 * `rmSync` on a directory Chrome is still writing to throws `EBUSY`, the throw is
 * swallowed by that module's `catch {}`, and a 6 MB profile survives every run while
 * `ps` reads clean. §3.J's shape. */
async function finish(code) {
  ws.close();
  chrome.kill();
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    chrome.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
  process.exit(code);
}

console.log('');
if (fails.length) {
  console.log(`FAIL  ${fails.length} of ${checks} checks failed`);
  for (const f of fails) console.log(`        ${f}`);
  await finish(1);
}
console.log(`PASS  ${checks} checks`);
/* The script ends here and the process does not: the DevTools WebSocket and the
 * `fetch` that found the target both hold the event loop open — undici keeps that
 * socket alive for keep-alive, so a finished checker sits there until something kills
 * it. §4 records the same trap for the runner's own liveness probe, where it presented
 * as 「the skip cache is broken」. */
await finish(0);