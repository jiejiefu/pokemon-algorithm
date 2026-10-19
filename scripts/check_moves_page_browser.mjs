#!/usr/bin/env node
/**
 * The rendered half of the moves pages, driven over the DevTools Protocol.
 *
 *   node scripts/check_moves_page_browser.mjs      (needs the repo on :5500)
 *
 * ## WHY THE SPLIT, AND WHAT THE STATIC HALF CANNOT SEE
 *
 * `check_moves_page.mjs` reads moves.html, move.html and moves.css off disk. That
 * is the right tool for a stylesheet contract and for filter arithmetic — it runs
 * in ~0.2s and covers the whole of §3.G4's static half. It cannot see what the
 * pages PRODUCE, and on this pair there are four claims only a browser can settle:
 *
 *   1. THE TABLE HAS ROWS. Every static assertion about the list page is about
 *      source; none of them can tell a 919-row table from a table whose body was
 *      never appended. §3.G3's shape — `paint()` closing over a canvas nobody
 *      looked at — and §3.I's: a call in the right place that throws for a reason
 *      six lines below it takes every other listener with it.
 *   2. THE FILTER NARROWS. `filterMoves()` returning 47 rows proves the function
 *      works. It does not prove the chips are wired to it, which is the part a
 *      reader touches.
 *   3. `[hidden]` HIDES. §3.M measured it: an author `display` beats the UA
 *      sheet's `[hidden] { display: none }` whatever the specificity, so
 *      `el.hidden = true` can leave a panel painted while the property reads
 *      `true`. Asserting the rule exists in CSS is not asserting the box is gone.
 *   4. THE URL ROUND-TRIPS. A deep link has to arrive with its filter already
 *      applied, or `types.html`'s new link to `moves.html?type=fire` leads to a
 *      page showing all 919.
 *
 * ## MECHANISM AND OUTCOME, BOTH
 *
 * §3.G1a's finding is 170 static and 43 CDP checks green over a visibly broken
 * page because they asked whether prose EXIST. One assertion cannot cover both
 * sides:
 *
 *   - OUTCOME ALONE is satisfied by luck. "919 rows render" is also true of a
 *     page whose data loaded but whose filter chip does nothing — the two defects
 *     are independent, and only the second is caught by clicking a chip.
 *   - MECHANISM ALONE is satisfied by a page that does the right thing for the
 *     wrong reason. Asserting `state.type` was set proves the plumbing and not
 *     the pixels, which is exactly the split §3.X used on the cry pages.
 *
 * So each filter is measured twice: the URL says it, AND the row count says it.
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * No mutation harness. Each case would boot its own Chrome against its own tree,
 * which is what §3.G5 priced when it took `test_check_gen1_apu.mjs` out of the
 * manifest. The mutations live in the static half, which is ~0.2s and can run
 * them in a fixture tree; what this file gives up is named rather than glossed —
 * it proves the pages render and the controls work, and it does not prove that
 * every assertion here would fail if the page stopped.
 *
 * One Chrome for both pages: two would be two ports and two profiles for
 * measurements that carry no state between them (§3.G7 — most of the duplication
 * in this suite was N copies of one thing rather than N things).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, waitForDebugPort } from './lib/cdp-port.mjs';
import { until } from './lib/cdp-until.mjs';
import { trackTree, releaseTree } from './lib/tmp-trees.mjs';

const PORT = process.env.MOVES_PORT || process.env.CRY_PORT || 5500;
const DESKTOP = { width: 1280, height: 1000 };
const NARROW = { width: 390, height: 844 };

const profile = trackTree(mkdtempSync(join(tmpdir(), 'mvpb-')));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', d => { chromeStderr += d; });

/*
 * Order is load-bearing, and the exit handlers were previously registered in the
 * wrong sequence for what they were asked to do.
 *
 * `trackTree()` installs an `exit` handler that removes the profile, and the
 * handler below kills Chrome. Exit handlers run in REGISTRATION order, so the
 * sequence was: sweep the directory away, then `chrome.kill()`. Chrome is a
 * separate process and does not stop the instant it is signalled — for the few
 * milliseconds between the `SIGTERM` and its actual death it keeps writing to its
 * profile and RECREATES the directory that was just removed underneath it. What
 * survives is a bare `Default/` with no `DevToolsActivePort`, which is exactly the
 * signature §3.W records for a tree left behind rather than swept.
 *
 * It is not visible from the code: `trackTree` looks like the net, and it is —
 * but only for a run that dies before the sweep. Eleven such trees had piled up in
 * this user's tmpdir, every one of them 4–8 KB, from runs that printed a verdict
 * and exited 0.
 *
 * So on the paths this file actually ends on, Chrome is killed and CONFIRMED dead
 * before the profile is released. The handlers below remain for a path that never
 * reaches `shutdown` — an uncaught throw, which is exactly when the run is already
 * going wrong. Killing Chrome there is what stops it rendering pages forever
 * (§3.J); the tree is best-effort, and the ordering caveat above is why that is
 * stated rather than assumed.
 */
async function shutdown(code) {
  try { chrome.kill(); } catch {}
  // A named ceiling, and a timeout that RETURNS rather than throws: a Chrome that
  // refuses to die must still exit the checker rather than hang it, which is the
  // same symptom §3.Z records as indistinguishable from being stuck.
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, 3000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  releaseTree(profile);
  process.exit(code);
}

process.on('exit', () => { try { chrome.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { chrome.kill(); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); });
}

const CDP = await waitForDebugPort(profile);
let targets;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
    if (r.ok) { targets = await r.json(); break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const waiting = new Map();
const exceptions = [];
/* `lastMethod` is module scope and is NEVER reset on success: the most recently
 * ISSUED method is by construction the outstanding one. The first version reset
 * it on success and printed "(idle)" for exactly the failure it existed to
 * describe (§3.G9). */
let lastMethod = '(none)';
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`EXC ${((d.exception?.description) || d.text || '').split('\n')[0]} @ ${d.url || '?'}`);
  }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  lastMethod = method;
  waiting.set(n, (x) => (x.error ? rej(new Error(`${method}: ${JSON.stringify(x.error)}`)) : res(x.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(`while calling ${lastMethod}: ${(r.exceptionDetails.exception?.description || '').split('\n')[0]}`);
  }
  return r.result.value;
};

let checks = 0;
const fails = [];
/**
 * `ok(cond, what[, detail])` — variadic, for §3.G9's reason: this file's shape
 * has a third argument at most call sites and a two-argument signature accepts it
 * silently, printing a bare ok/FAIL and discarding the measurement it just took.
 */
const ok = (cond, what, detail) => {
  checks++;
  const line = detail ? `${what} — ${detail}` : what;
  if (!cond) fails.push(line);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${line}`);
};

/** One section boundary, so the report says where a red line belongs. */
const at = label => console.log(`\n— ${label}`);

await send('Page.enable');
await send('Runtime.enable');

/**
 * Switch viewport and PROVE it took effect before measuring at it.
 *
 * `Emulation.clearDeviceMetricsOverride` is followed by a poll against the width
 * read BEFORE the override was set, not against a constant. §4 records what
 * happened when a checker asserted against its own hardcoded default instead:
 * `check_spectrum_browser.mjs` cleared, read `innerWidth` on the next line, got
 * 1280 against a 756 default, and failed for a whole life reporting a message
 * about the mel ramp. `clear` restores whatever the page HAD, which is not this
 * checker's idea of its default and differs from it by 524px on this host.
 *
 * WHICH IS WHY `defaultWidth` IS CAPTURED HERE, AT MODULE LOAD, BEFORE ANY
 * OVERRIDE EXISTS — not lazily on the first call to atDefaultSize(). The first
 * version computed it lazily and so read it while the 390px override was still
 * in force, and the restore then asserted "back to 390" and reported a failure
 * that was the assertion's own mistake. §4's rule again, one level out.
 */
const defaultWidth = await ev('innerWidth');

async function atSize(size) {
  await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: size.width < 500 });
  const SEEN = await until(ev, `innerWidth === ${size.width}`, 3000);
  const WIDTH = await ev('innerWidth');
  ok(SEEN, `the viewport is ${size.width}px before anything is measured at it`, `asked ${size.width}, innerWidth ${WIDTH}`);
  return WIDTH;
}
async function atDefaultSize() {
  await send('Emulation.clearDeviceMetricsOverride');
  const SEEN = await until(ev, `innerWidth === ${defaultWidth}`, 3000);
  const WIDTH = await ev('innerWidth');
  ok(SEEN, `the viewport is restored to ${defaultWidth}px before the next measurement`, `innerWidth ${WIDTH}`);
  return WIDTH;
}

async function open(page, size) {
  await send('Page.navigate', { url: `http://localhost:${PORT}/${page}` });
  // The size is applied AFTER the navigation and that order is load-bearing: an
  // override set on about:blank is discarded by the navigation that follows it.
  if (size) await atSize(size);
}

/* Read the page's own DOM through one place, so a selector change is one edit. */
const rows = () => ev(`document.querySelectorAll('.mv-table tbody tr').length`);
const resultText = () => ev(`document.getElementById('mv-resultline')?.textContent || ''`);

// ===========================================================================
at('moves.html — the list actually renders, and every filter narrows it');
// ===========================================================================

await open('moves.html', DESKTOP);

// Wait on a PRECONDITION, never on the assertion: a poll for "919 rows" returns
// true on a correct page and times out on a wrong one, which asserts nothing.
const LIST_READY = `document.querySelector('.mv-table') !== null && document.getElementById('mv-status') === null`;
const listReady = await until(ev, LIST_READY, 25000);
ok(listReady, 'moves.html finished rendering its table', exceptions.length ? exceptions.join(' | ') : 'no exceptions');
ok(exceptions.length === 0, 'moves.html raised no uncaught exception', exceptions.join(' | '));

const total = await rows();
ok(total === 919, 'the unfiltered table has a row for all 919 moves', `${total} rows`);
ok((await resultText()).includes('919'), 'the result line reports the same 919', await resultText());

/* Every chip group has to be ON THE PAGE and to be the size the data implies.
 * A chip row that rendered empty passes "the chips exist" and fails this. */
const chipGroups = await ev(`document.querySelectorAll('.mv-chipgroup').length`);
ok(chipGroups === 4, 'the four filter groups rendered', `${chipGroups} groups`);
const chipCounts = await ev(`JSON.stringify([...document.querySelectorAll('.mv-chipgroup')].map(g => g.querySelectorAll('.mv-chip').length))`);
ok(chipCounts === '[18,3,9,2]', 'the chip rows offer 18 types, 3 classes, 9 generations, 2 learnability states', chipCounts);

const activeType = await ev(`document.querySelectorAll('.mv-chip[aria-pressed="true"]').length`);
ok(activeType === 0, 'nothing is pressed on a first load', `${activeType} pressed`);

/*
 * THE TYPE CHIPS CARRY THEIR OWN COLOUR, and the dot is that same fill rather
 * than the raw TYPE_COLORS hex — pressing a chip then spreads the dot across the
 * pill instead of swapping one colour for another, so the row does not reflow
 * around the button the reader just pressed.
 *
 * Read from the COMPUTED style, not from the class name: an unstyled `.mv-chip--type`
 * and a styled one are the same markup, and this file's whole argument is that
 * a rendered claim needs a rendered check. The fill is compared against
 * `typePair()` re-derived in the page, which is the same lookup the chips were
 * built with — so this asserts the CSS applied the value, not that two copies
 * of a colour table agree.
 */
const chipPaint = await ev(`(() => {
  const chips = [...document.querySelectorAll('.mv-chip--type')];
  const fire = chips.find(c => c.textContent.trim() === '火');
  if (!fire) return null;
  const dot = fire.querySelector('.mv-chip-dot');
  const cs = getComputedStyle(fire);
  return JSON.stringify({
    count: chips.length,
    fill: cs.getPropertyValue('--mv-type-fill').trim(),
    ink: cs.getPropertyValue('--mv-type-ink').trim(),
    dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
    // parseFloat, not Math.round: getComputedStyle().width returns '9px', and
    // Math.round('9px') is NaN, which JSON.stringify turns into null — a failed
    // assertion that reported as "nullpx" and named nothing.
    dotW: dot ? parseFloat(getComputedStyle(dot).width) : 0,
    text: fire.textContent.trim()
  });
})()`);
if (chipPaint === null) {
  ok(false, 'the 屬性 chips should be findable on the page');
} else {
  const chip = JSON.parse(chipPaint);
  ok(chip.count === 18, 'all 18 type chips are decorated', `${chip.count}`);
  // 「火屬性」 would be the group label's word repeated 18 times; the dot
  // already carries the type.
  ok(chip.text === '火', 'the chip text is the bare type name', `"${chip.text}"`);
  ok(/^rgb\(/.test(chip.fill) && chip.fill !== chip.ink, 'the chip carries a fill distinct from its ink', `${chip.fill} on ${chip.ink}`);
  ok(chip.dotW === 9, 'the dot is 9px', `${chip.dotW}px`);
  // Compared NORMALISED. getComputedStyle returns `rgb(240, 128, 48)` with
  // spaces while the custom property the page wrote is `rgb(240,128,48)`
  // without, so a raw string comparison reports a difference in punctuation.
  const norm = s => (s || '').replace(/\s+/g, '');
  ok(
    norm(chip.dotBg) === norm(chip.fill),
    'the dot is painted with the same fill the chip was given',
    `dot ${chip.dotBg} vs fill ${chip.fill}`
  );
}

/*
 * THE INK CLEARS 4.5:1 AGAINST ITS OWN FILL — for all eighteen, measured.
 *
 * The first version of this assertion was 「the fill is not the raw TYPE_COLORS
 * hex」, which is UNSATISFIABLE and therefore vacuous: `badgePair()` corrects
 * zero of the 18, because every type colour already clears 4.5:1 against the ink
 * it picks and so is returned unchanged. Asserting a difference that does not
 * exist is §3.B2's shape, and the mutation that would catch it — swapping the
 * dot for the raw hex — is indistinguishable from correct today.
 *
 * The contrast is the claim that survives whether or not a future palette entry
 * needs correcting, so that is what is asserted, over every chip rather than one.
 */
const chipContrast = await ev(`(() => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = s => {
    const [r, g, b] = s.match(/\\d+/g).map(Number);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = L(a) >= L(b) ? [L(a), L(b)] : [L(b), L(a)];
    return (hi + 0.05) / (lo + 0.05);
  };
  const chips = [...document.querySelectorAll('.mv-chip--type')];
  return JSON.stringify(chips.map(c => {
    const cs = getComputedStyle(c);
    const fill = cs.getPropertyValue('--mv-type-fill').trim();
    const ink = cs.getPropertyValue('--mv-type-ink').trim();
    return { label: c.textContent.trim(), ratio: Math.round(ratio(fill, ink) * 100) / 100 };
  }));
})()`);
const contrasts = JSON.parse(chipContrast);
ok(contrasts.length === 18, 'every type chip was measured', `${contrasts.length} measured`);
const worst = contrasts.reduce((a, b) => (b.ratio < a.ratio ? b : a), contrasts[0]);
ok(
  contrasts.every(c => c.ratio >= 4.5),
  'every chip label clears WCAG AA 4.5:1 against its own fill',
  `worst is ${worst.label} at ${worst.ratio}:1`
);

// The other three rows stay neutral: a modifier is what leaves them untouched,
// and a chipRow that coloured every row would look identical on the page.
const neutralChips = await ev(`(() => {
  const groups = [...document.querySelectorAll('.mv-chipgroup')];
  const nonType = groups.slice(1).flatMap(g => [...g.querySelectorAll('.mv-chip')]);
  return JSON.stringify({
    nonType: nonType.length,
    decorated: nonType.filter(c => c.classList.contains('mv-chip--type')).length
  });
})()`);
const neutral = JSON.parse(neutralChips);
ok(neutral.decorated === 0, 'only the 屬性 row is decorated — the other three rows carry no colour', `${neutral.nonType} chips checked, ${neutral.decorated} decorated`);

// -- the search box narrows the rows -----------------------------------------
await ev(`(() => {
  const input = document.getElementById('mv-search');
  input.value = 'thunderbolt';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const bySearch = await rows();
/* TWO rows, not one, and the second is real: `10-000-000-volt-thunderbolt` is the
 * Z-Move 千萬伏特 and its slug contains the word. An assertion written expecting
 * one would have "found" a bug here on its first run and the fix would have been
 * to make the search stop matching substrings — which is the search box losing
 * the thing it is for. The expected count is therefore derived from the data
 * rather than typed, so it is a claim about the page and not about my memory of
 * how many moves Pokémon has. */
const searchHits = await ev(`(async () => {
  const moves = await (await fetch('assets/data/moves_zh.json')).json();
  return Object.entries(moves)
    .filter(([k, v]) => k !== '_meta' && (v.en + v.zh).toLowerCase().includes('thunderbolt'))
    .length;
})()`);
ok(bySearch === searchHits, `typing an English name leaves exactly the ${searchHits} moves whose name contains it`, `${bySearch} rows`);
const searchedNames = await ev(`[...document.querySelectorAll('.mv-table tbody .mv-name')].map(n => n.textContent).join('|')`);
ok(searchedNames.includes('十萬伏特'), 'and the plain move is among them', searchedNames);
ok(
  (await ev(`location.search`)).includes('q=thunderbolt'),
  'the search term reached the URL',
  await ev(`location.search`)
);

await ev(`(() => {
  const input = document.getElementById('mv-search');
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
ok((await rows()) === 919, 'clearing the box restores all 919', `${await rows()} rows`);

// -- a chip narrows, in the DOM and in the URL --------------------------------
/* A REAL CLICK, not `.click()`. §3.N measured `element.click()` passing where a
 * dispatched mouse press failed — 5 of 5 programmatic calls opened the nav, 0 of
 * 5 real presses did, because a page that re-renders its own markup makes the
 * captured node detached and a detached node does not bubble. The presses below
 * go through `Input.dispatchMouseEvent` so the same defect cannot hide here. */
async function pressChip(label) {
  const box = await ev(`(() => {
    const chip = [...document.querySelectorAll('.mv-chip')].find(c => c.textContent.trim() === ${JSON.stringify(label)});
    if (!chip) return null;
    const r = chip.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
  if (!box) return false;
  const { x, y } = JSON.parse(box);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  return true;
}

const FIRE = '火';   // the bare type name — the 屬性 suffix was removed from the chip text
const fireCount = await ev(`(async () => {
  const moves = await (await fetch('assets/data/moves_zh.json')).json();
  return Object.entries(moves).filter(([k, v]) => k !== '_meta' && v.type === 'fire').length;
})()`);
const pressed = await pressChip(FIRE);
ok(pressed, `the ${FIRE} chip was found and pressed`, `expected ${fireCount} rows`);
const byChip = await rows();
ok(byChip === fireCount, `pressing ${FIRE} narrows the table to the moves of that type`, `${byChip} rows vs ${fireCount} in the data`);
ok(
  (await ev(`location.search`)).includes('type=fire'),
  'the chip reached the URL',
  await ev(`location.search`)
);
// §3.G3's counting rule, applied to the DOM: EVERY rendered row must actually be
// that type. Counting the rows is satisfied by a filter that returns the right
// number of the wrong things.
const wrongType = await ev(`[...document.querySelectorAll('.mv-table tbody tr .type-badge')].filter(b => b.textContent.trim() !== '火').length`);
ok(wrongType === 0, 'and every rendered row is that type', `${wrongType} wrong`);

// Pressing the same chip again clears it, so a chip is a toggle rather than a
// one-way door.
await pressChip(FIRE);
ok((await rows()) === 919, 'pressing the same chip again clears the filter', `${await rows()} rows`);
ok(!(await ev(`location.search`)).includes('type=fire'), 'and the URL follows', await ev(`location.search`));

// -- the learnability filter, in both directions ------------------------------
await pressChip('無寶可夢可學');
const unlearnable = await rows();
ok(unlearnable === 137, 'the 無寶可夢可學 branch is the 137 moves no Pokémon learns', `${unlearnable} rows`);
await pressChip('無寶可夢可學');
await pressChip('有寶可夢學得會');
const learnable = await rows();
ok(learnable === 782, 'and its complement is the 782 moves that are learnable', `${learnable} rows`);
await pressChip('有寶可夢學得會');

// ===========================================================================
at('moves.html — a deep link arrives with its filter already applied');
// ===========================================================================

/* `types.html` links to `moves.html?type=fire`, so the filter has to survive the
 * navigation rather than being applied only by a click. Opening the URL is the
 * test; asserting that the chip reads pressed is what makes it more than a URL
 * test. */
await open('moves.html?type=fire', DESKTOP);
await until(ev, LIST_READY, 25000);
const deepRows = await rows();
ok(deepRows === fireCount, `moves.html?type=fire arrives filtered`, `${deepRows} rows vs ${fireCount}`);
const deepPressed = await ev(`[...document.querySelectorAll('.mv-chip[aria-pressed="true"]')].map(c => c.textContent.trim()).join('|')`);
ok(deepPressed.includes('火'), 'and the matching chip is pressed on arrival', deepPressed || '(none)');
const deepSearch = await ev(`document.getElementById('mv-search').value`);
ok(deepSearch === '', 'a ?type= deep link does not put anything in the search box', `"${deepSearch}"`);

/* An unrecognised filter is dropped, not applied — a filter that matches nothing
 * and a page that is broken look identical from the outside, and only one of
 * them is. */
await open('moves.html?type=firex', DESKTOP);
await until(ev, LIST_READY, 25000);
ok((await rows()) === 919, 'moves.html?type=firex falls back to the full list rather than showing nothing', `${await rows()} rows`);

await open('moves.html?q=zzzznotamove', DESKTOP);
await until(ev, LIST_READY, 25000);
const emptyText = await ev(`document.querySelector('.mv-empty')?.textContent || ''`);
ok(emptyText.includes('沒有符合條件'), 'a search matching nothing shows the empty state, not an empty table', emptyText.slice(0, 40));
const emptyTable = await ev(`document.querySelector('.mv-table') === null`);
ok(emptyTable, 'and the table is gone — a heading with no body reads as a failed load');

// ===========================================================================
at('moves.html at 390x844');
// ===========================================================================

await open('moves.html', NARROW);
await until(ev, LIST_READY, 25000);
const phoneRows = await rows();
ok(phoneRows === 919, 'all 919 rows render on a phone', `${phoneRows} rows`);
const phoneOverflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
ok(phoneOverflow <= 1, 'the page does not scroll sideways at 390px', `${phoneOverflow}px of overflow`);
const searchBox = await ev(`(() => { const r = document.getElementById('mv-search').getBoundingClientRect(); return JSON.stringify({ w: Math.round(r.width) }); })()`);
ok(JSON.parse(searchBox).w > 200, 'the search box is still usable at that width', searchBox);

await atDefaultSize();

// ===========================================================================
at('move.html — the detail page, its tabs, and the unknown-slug contract');
// ===========================================================================

const MOVE_READY = `document.getElementById('mv-detail') && !document.getElementById('mv-detail').hidden`;
await open('move.html?move=thunderbolt', DESKTOP);
const detailReady = await until(ev, MOVE_READY, 25000);
ok(detailReady, 'move.html?move=thunderbolt finished rendering', exceptions.length ? exceptions.join(' | ') : 'no exceptions');
ok(exceptions.length === 0, 'move.html raised no uncaught exception', exceptions.join(' | '));

const title = await ev(`document.getElementById('mv-name').textContent`);
ok(title === '十萬伏特', 'the move name came from the data, not the URL', title);
const effect = await ev(`document.getElementById('mv-effect').textContent`);
ok(effect.length > 10 && !effect.includes('undefined'), 'the effect sentence is present and real', `"${effect.slice(0, 40)}…"`);
const source = await ev(`document.getElementById('mv-effect-source').textContent`);
ok(source.includes('PokeAPI'), 'the effect says which source it came from', source);

/* Every fact row on a status move that PokeAPI has no meta for must be ABSENT,
 * not 「無」. §3.B2: `drain: null` means "we have no data", and printing 無 for it
 * is a claim the data did not make. 冰山風 is one of the 92. */
await open('move.html?move=mountain-gale', DESKTOP);
await until(ev, MOVE_READY, 25000);
const galeFacts = await ev(`[...document.querySelectorAll('.mv-facts dt')].map(d => d.textContent).join('|')`);
ok(!galeFacts.includes('吸取'), 'a move with no meta omits 吸取 rather than printing 無', galeFacts);
ok(!galeFacts.includes('異常狀態'), 'and omits 異常狀態 for the same reason', galeFacts);
ok(galeFacts.includes('對象'), 'while the fields PokeAPI does have are still shown', galeFacts);

/* 硬壓's power 0 is a real HP-scaling value, not an absence. */
await open('move.html?move=hard-press', DESKTOP);
await until(ev, MOVE_READY, 25000);
const hardPress = await ev(`[...document.querySelectorAll('.mv-facts dd')].map(d => d.textContent).join('|')`);
ok(hardPress.includes('依對手剩餘 HP 變化'), '硬壓 renders its variable power as a label, not a dash', hardPress.slice(0, 60));

/* 迅子利刃 is accuracy 0, which is 必中. The page's own effect text says
 * 「必定命中」, so printing 0% would contradict the panel directly below. */
await open('move.html?move=tachyon-cutter', DESKTOP);
await until(ev, MOVE_READY, 25000);
const accuracy = await ev(`[...document.querySelectorAll('.mv-facts dd')].map(d => d.textContent).join('|')`);
ok(accuracy.includes('必中'), 'accuracy 0 renders as 必中', accuracy.slice(0, 60));
ok(!accuracy.includes('0%'), 'and never as 0%', accuracy.slice(0, 60));

// -- the tabs ---------------------------------------------------------------
await open('move.html?move=pound', DESKTOP);
await until(ev, MOVE_READY, 25000);

/* 拍擊 has 89 learn-method SLOTS across two tabs (87 level-up, 2 egg) but only
 * 87 DISTINCT species, because one Pokémon learns it both ways in different
 * generations. The page prints the distinct number and the tabs add up to more
 * than it — which is the whole point of the union decision, and both halves are
 * measured against the data rather than against a number typed here. */
const poundCounts = await ev(`(async () => {
  const l = await (await fetch('assets/data/move_learners.json')).json();
  const row = l['1'];
  const distinct = new Set(['level','machine','egg','tutor'].flatMap(m => row[m] || [])).size;
  return JSON.stringify({ distinct, slots: ['level','machine','egg','tutor'].reduce((n,m) => n + row[m].length, 0), tabs: Object.entries(row).filter(([,v]) => v.length).map(([k,v]) => k + ':' + v.length) });
})()`);
const pound = JSON.parse(poundCounts);
const totals = await ev(`JSON.stringify({
  total: document.getElementById('mv-learners-total').textContent,
  tabs: [...document.querySelectorAll('.mv-tab')].map(t => t.textContent.trim())
})`);
const parsed = JSON.parse(totals);
ok(
  parsed.total.includes(String(pound.distinct)),
  `the learner total is the ${pound.distinct} distinct species, not the ${pound.slots} method slots`,
  parsed.total
);
ok(pound.slots > pound.distinct, 'sanity: this move really is learned twice by someone, or the assertion above is vacuous', `${pound.slots} slots vs ${pound.distinct} distinct`);
ok(parsed.tabs.length === pound.tabs.length, 'every non-empty learn method became a tab', `${parsed.tabs.length} tabs vs ${pound.tabs.join(', ')}`);

const visibleBefore = await ev(`[...document.querySelectorAll('.mv-tabpanel')].filter(p => !p.hidden).length`);
ok(visibleBefore === 1, 'exactly one tabpanel is shown on arrival', `${visibleBefore} shown`);

/* §3.M, measured rather than asserted from the CSS: `hidden = true` is not the
 * same as the box being gone. `getComputedStyle().display` decides it, because the
 * attribute is the thing that lies. */
const hiddenPanelsPainted = await ev(`[...document.querySelectorAll('.mv-tabpanel[hidden]')].filter(p => getComputedStyle(p).display !== 'none').length`);
ok(hiddenPanelsPainted === 0, 'every hidden tabpanel has computed display:none — an author display beats [hidden]', `${hiddenPanelsPainted} still painted`);

const visibleBox = await ev(`(() => { const p = document.querySelector('.mv-tabpanel:not([hidden])'); const r = p.getBoundingClientRect(); return Math.round(r.height); })()`);
ok(visibleBox > 0, 'the visible panel has real height', `${visibleBox}px`);

/* Switch tabs with a REAL press, and read the resulting box rather than the
 * attribute — the same press-lands problem as the chips above. */
const tabsBox = await ev(`(() => {
  const tabs = [...document.querySelectorAll('.mv-tab')];
  if (tabs.length < 2) return null;
  const r = tabs[1].getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, label: tabs[1].textContent.trim() });
})()`);
if (tabsBox) {
  const { x, y } = JSON.parse(tabsBox);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  const shownNow = await ev(`[...document.querySelectorAll('.mv-tabpanel')].filter(p => !p.hidden).length`);
  ok(shownNow === 1, 'pressing the second tab still shows exactly one panel', `${shownNow} shown`);
  const secondSelected = await ev(`[...document.querySelectorAll('.mv-tab')].findIndex(t => t.getAttribute('aria-selected') === 'true')`);
  ok(secondSelected === 1, 'and aria-selected followed', `index ${secondSelected}`);
} else {
  /* 拍擊 has a single learn method, so there is no second tab to press — but
   * "no second tab" is a claim about the page, not a reason to skip. Counted
   * rather than asserted as `true`: a bare `ok(true)` is a check that cannot
   * fail, and it would inflate the total whether or not the page is right. */
  const tabCount = await ev(`document.querySelectorAll('.mv-tab').length`);
  ok(tabCount === 1, '拍擊 has one learn method, so the page shows exactly one tab', `${tabCount} tabs`);
}

const learnerCards = await ev(`document.querySelectorAll('.mv-learner').length`);
ok(learnerCards > 0, 'the learner grid has cards', `${learnerCards} cards`);
const firstHref = await ev(`document.querySelector('.mv-learner')?.getAttribute('href') || ''`);
ok(firstHref.startsWith('detail.html?slug='), 'each card links through the shared species URL helper', firstHref);

/*
 * THE CARDS SHOW THE OFFICIAL SCARLET/VIOLET ARTWORK.
 *
 * Asserted on `naturalWidth`, which is the only thing that distinguishes "the
 * browser decoded the PNG we asked for" from "the element exists" — a card whose
 * src is wrong still has an `<img>`, still occupies its box, and still renders
 * its name. `naturalHeight` is asserted alongside it because the two sets have
 * different ASPECT RATIOS (120×112 against 96×96), so a height of 96 would mean
 * the sprite answered a request that named the SV file.
 */
const artInfo = await ev(`(() => {
  const img = document.querySelector('.mv-learner img');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  const cs = getComputedStyle(img);
  return JSON.stringify({
    src: img.getAttribute('src'),
    natural: [img.naturalWidth, img.naturalHeight],
    box: [Math.round(r.width), Math.round(r.height)],
    fit: cs.objectFit,
    position: cs.objectPosition,
    rendering: cs.imageRendering,
    complete: img.complete && img.naturalWidth > 0
  });
})()`);
if (artInfo === null) {
  ok(false, 'a learner card should carry an <img>');
} else {
  const art = JSON.parse(artInfo);
  ok(art.complete, 'the learner artwork actually decoded', `${art.src}`);
  ok(
    art.src.startsWith('assets/images/scarlet-violet/'),
    'and it came from the Scarlet/Violet set, not the 96px sprite directory',
    art.src
  );
  ok(
    art.natural[0] === 120 && art.natural[1] === 112,
    'the file is the 120x112 SV icon — a 96x96 natural size would mean the sprite answered',
    `${art.natural[0]}x${art.natural[1]}`
  );
  ok(art.fit === 'contain', 'it is scaled without distortion', `object-fit: ${art.fit}`);
  /*
   * `bottom` is the AUTHORED keyword; getComputedStyle returns the computed
   * form, `50% 100%`. Asserting one spelling rather than the other is the same
   * mistake as checking for `color: red` when the computed value is
   * `rgb(255, 0, 0)` — §3.G1a's pixel check, in a property instead of a colour.
   * Both are accepted, and the behavioural assertion below is the one that would
   * actually catch a card whose subject is off its own baseline.
   */
  ok(
    art.position === 'bottom' || art.position === '50% 100%',
    'and pinned to the bottom of its box',
    `object-position: ${art.position}`
  );
  ok(art.rendering === 'auto', 'with no image-rendering — both art sets are drawn DOWN here', art.rendering);

  /*
   * THE SUBJECT SITS ON THE BOX'S BOTTOM EDGE, which is the whole point of the
   * artwork set and the reason there is no `translateY` on this page. Measured
   * from the live canvas rather than asserted from the CSS, because the
   * assertion "object-position is bottom" is about the declaration and this is
   * about where the Pokémon actually lands.
   *
   * The SVG subject is bottom-ANCHORED with the empty space above, so a card
   * whose subject stops short of its own bottom edge has been moved off it —
   * which is what `contain` without `object-position: bottom` would do, by
   * 3.7px.
   */
  const subjectBottom = await ev(`(() => {
    const img = document.querySelector('.mv-learner img');
    const box = img.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let last = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 16) { last = y; break; }
      }
    }
    if (last === -1) return JSON.stringify({ last, drawn: false });
    // naturalHeight is where the subject ends; the box bottom is one natural
    // height lower. A zero gap means the subject touches the box edge.
    const gapNatural = c.height - 1 - last;
    return JSON.stringify({
      drawn: true,
      gapNatural,
      gapBox: Math.round(gapNatural * (box.height / c.height) * 10) / 10
    });
  })()`);
  const subject = JSON.parse(subjectBottom);
  ok(subject.drawn, 'the artwork has visible pixels');
  ok(
    subject.gapBox < 1,
    'the Pokémon reaches the card\'s bottom edge — no offset, by design',
    `${subject.gapBox}px of gap below the subject`
  );
}

// -- a move nobody can learn -------------------------------------------------
await open('move.html?move=max-flare', DESKTOP);
await until(ev, MOVE_READY, 25000);
const unlearnableText = await ev(`document.getElementById('mv-panels').textContent`);
ok(
  unlearnableText.includes('沒有任何一隻寶可夢學得會'),
  'a move no Pokémon learns says so in words, not with an empty panel',
  unlearnableText.slice(0, 40)
);
ok((await ev(`document.querySelectorAll('.mv-tab').length`)) === 0, 'and it renders no tabs');

// -- an unknown slug is an error, never a fallback ---------------------------
await open('move.html?move=not-a-move', DESKTOP);
const unknownShown = await until(ev, `document.querySelector('.mv-status.is-error') !== null`, 15000);
ok(unknownShown, 'move.html?move=not-a-move renders an error state');
const unknownText = await ev(`document.querySelector('.mv-status')?.textContent || ''`);
ok(unknownText.includes('not-a-move'), 'and it names what it could not find', unknownText.slice(0, 50));
const fallbackShown = await ev(`document.getElementById('mv-detail')?.hidden !== false`);
ok(fallbackShown, 'and it does NOT fall back to a real move — 拍擊 would answer a different question');

/* No parameter at all is the same class of error, not a crash. */
await open('move.html', DESKTOP);
const noParam = await until(ev, `document.querySelector('.mv-status.is-error') !== null`, 15000);
ok(noParam, 'move.html with no ?move= at all renders the same error state');

// ===========================================================================
at('move.html at 390x844');
// ===========================================================================
await open('move.html?move=pound', NARROW);
await until(ev, MOVE_READY, 25000);
const detailOverflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
ok(detailOverflow <= 1, 'the detail page does not scroll sideways at 390px', `${detailOverflow}px`);
const detailBox = await ev(`(() => { const r = document.querySelector('.mv-panel').getBoundingClientRect(); return Math.round(r.width); })()`);
ok(detailBox > 200, 'the panels are still readable at that width', `${detailBox}px wide`);

await atDefaultSize();

// ===========================================================================
at('result');
// ===========================================================================

/* Nothing is asserted about the profile tree here, on purpose. `tmp-trees.mjs`
 * sweeps it on exit and `check_tmp_prefixes.mjs` + its own harness prove the
 * prefix does not collide with any other; a check in this file that merely
 * restated "the directory was created" would pass on a run that leaked it,
 * which is §3.P's vacuous assertion in the exact shape §3.J warns about. */

/*
 * EXIT EXPLICITLY. `check_home_hero_browser.mjs` hung for 12 minutes inside
 * tier B three times with every check already green, and the cause was this: the
 * CDP WebSocket and the spawned Chrome both keep the event loop alive, so a
 * checker that has finished printing and then falls off the end never exits.
 *
 * From outside it is indistinguishable from a hang — a running row, no cache
 * write, a pool that never drains. §3.Z's rule: a checker that has finished and
 * does not exit is the same symptom as one that is stuck, and nothing in the
 * output tells them apart. That file added a 4-minute watchdog first, aimed at a
 * cause it did not have, and the watchdog never fired under the condition it was
 * written for; the one line below is the fix.
 *
 * `shutdown()` rather than `process.exit()`, because "the profile is swept either
 * way" was the belief this file was carrying and it was not true — the sweep ran
 * first and Chrome undid it. The exit code is unchanged, and it is passed in
 * rather than hard-coded so the FAIL path reaches the same teardown.
 */
if (fails.length === 0) {
  console.log(`\nPASS ${checks} checks`);
  await shutdown(0);
} else {
  console.error(`\nFAIL ${fails.length} of ${checks} checks`);
  for (const f of fails) console.error(`  · ${f}`);
  await shutdown(1);
}