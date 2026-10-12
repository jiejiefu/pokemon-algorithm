/**
 * 每一條斷言都會不會紅？—— check_game_similarity.mjs 的變異測試。
 *
 *   node scripts/test_check_game_similarity.mjs
 *
 * 為什麼需要：這個檢查器裡有一半的斷言是量出來的（分佈、對稱性、涵蓋率），
 * 而量出來的斷言有兩種死法——一個是真的過不了，或是**怎麼改都會過**。第二種
 * 比較危險：它報 PASS，而 PASS 這個字本身沒有說明它量到了什麼。
 *
 * 所以每一個 case 都在一個 scratch tree 裡改壞 `game-similarity.js` 的一處，
 * 然後要求檢查器**用具名的那一句**變紅（`caughtBy`）。用具名而不是用
 * 「exit != 0」是 §3.V 的規則：一個只是壞掉的檢查器也會非零離開。
 *
 * scratch tree 複製整個 `assets/js`（§3.B2 的理由）：這個模組 import
 * `color-match.js` 與 `daily-pick.js`，而後者的 import 鏈會再拉進
 * `shared.js` → `form-names.js` / `shiny-index.js`。少複製一個檔案會讓
 * 每個 case 都死在 `ERR_MODULE_NOT_FOUND`——那是**解析期**的錯，檢查器一條
 * 斷言都沒跑，於是二十幾個 case 全部「紅」著卻什麼都沒證明。baseline case
 * 就是用來證明這棵樹是好的。
 */

import { mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { caughtBy, failLines } from './lib/negative.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'scripts/check_game_similarity.mjs';
const MODULE = 'assets/js/game-similarity.js';

const JS_TREE = readdirSync(join(ROOT, 'assets/js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `assets/js/${f}`);

const SRC = [
  ...JS_TREE,
  'assets/data/color_palettes.json',
  'assets/data/pokemon_data.json',
  CHECKER,
];

/** 改壞模組，並且在目標字串不見時丟出——否則 case 會靜靜地什麼都沒改就「通過」。 */
const editModule = (dir, from, to) => {
  const p = join(dir, MODULE);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`mutation target not found: ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
};

const CASES = [
  /* ---- 出題：最容易壞掉而且最難發現的那幾處 ---- */
  {
    name: 'easy stops filtering by generation and becomes the full dex',
    mutate: (dir) => editModule(dir,
      "  if (difficulty === 'easy') {\n    const g = Number(gen);\n    if (!Number.isFinite(g)) return [];\n    return genIdMap(data).get(g) || [];\n  }",
      '  if (difficulty === \'easy\') {\n    return allIds(data);\n  }'),
    expect: 'easy draws only the chosen generation',
  },
  {
    name: 'hard narrows to one generation too, so all three difficulties collapse',
    mutate: (dir) => editModule(dir,
      "export function poolFor(difficulty, gen, data) {\n  if (difficulty === 'easy') {",
      "export function poolFor(difficulty, gen, data) {\n  if (difficulty !== 'nonsense') {"),
    expect: 'hard draws from all 1,025',
  },
  {
    name: '地獄 stops being shiny, so the third difficulty is a label',
    mutate: (dir) => editModule(dir,
      "return difficulty === 'hell' ? 's' : 'n';",
      "return 'n';"),
    expect: 'hell is 異色',
  },
  {
    name: 'the daily seed drops the generation, so picking one changes nothing',
    mutate: (dir) => editModule(dir,
      "`${GAME_SEED}${difficulty}:${difficulty === 'easy' ? gen : 'all'}:${taipeiDateKey(now)}`",
      "`${GAME_SEED}${difficulty}:${taipeiDateKey(now)}`"),
    /* This case is why the checker asserts the seed from the SOURCE. The obvious
       behavioural check for this mutation — 「easy(gen1) 的目標與 easy(gen3) 的
       目標不同」 — passes with the mutation in place, because the two pools are
       disjoint id sets: a target drawn from 1–151 can never equal one drawn from
       252–386, no matter what the seed says. The generation reaches the result
       twice, through the pool and through the seed, and only a source assertion
       can see the second one. */
    expect: 'the daily seed carries the generation, the difficulty and the Taipei day',
  },
  {
    name: 'the daily draw stops being date-seeded and becomes a coin flip',
    /* Replacing only the call's opening left the rest of the template literal
       dangling, so the mutated module was a SYNTAX ERROR and the checker died
       at parse time — exit 1 with no FAIL line at all, which reads as "caught
       it" to anything that only tests the exit code. The whole call is replaced
       here. */
    mutate: (dir) => editModule(dir,
      'const index = pickIndex(pool, `${GAME_SEED}${difficulty}:${difficulty === \'easy\' ? gen : \'all\'}:${taipeiDateKey(now)}`);',
      'const index = pickIndex(pool, String(Math.random()));'),
    expect: 'the same day draws the same Pokémon twice',
  },
  {
    /* `mulberry32` 回傳產生器。不呼叫它不會丟出任何東西——`函式 % n` 是 NaN，
       `NaN < 0` 是 false，於是回傳一個 `{id: undefined}` 的目標。這是這個
       模組在第一版就真的犯過的錯，所以它必須有一個 case。 */
    name: 'the PRNG is used as a number instead of called, which silently yields undefined',
    mutate: (dir) => editModule(dir,
      'return Math.floor(mulberry32(fnv1a(seed))() * pool.length);',
      'return mulberry32(fnv1a(seed)) % pool.length;'),
    /* NOT the stability check, and that is the finding. `fn % n` is NaN, `NaN < 0`
       is false, so `pool[NaN]` is `undefined` — and two `{id: undefined}` objects
       compare EQUAL, so 「同一個日子抽到同一隻」 passes while every target is
       broken. The assertion that catches it is reachability. */
    expect: 'a decade of hard targets reaches most of the dex',
  },
  {
    name: 'an empty pool falls back to the first Pokémon instead of saying so',
    mutate: (dir) => editModule(dir,
      '  if (!pool.length) return -1;\n  return Math.floor',
      '  if (!pool.length) return 0;\n  return Math.floor'),
    expect: 'an empty pool returns null rather than a fallback Pokémon',
  },
  {
    name: 'the generation fallback is 9 instead of 第一世代',
    mutate: (dir) => editModule(dir,
      'if (!Number.isFinite(g) || g < 1 || g > max) return 1;',
      'if (!Number.isFinite(g) || g < 1 || g > max) return max;'),
    expect: 'an out-of-range generation falls back to 第一世代',
  },

  /* ---- 色盤：占比不重排、6 色只是上限而不是硬數字 ---- */
  {
    name: 'rows are re-sorted by share, so "primary" stops meaning row 0',
    mutate: (dir) => editModule(dir,
      '  return rows\n    .filter((r) => Array.isArray(r) && typeof r[0] === \'string\')\n    .map((r) => ({ hex: r[0], share: Number(r[1]) || 0 }));',
      '  return rows\n    .filter((r) => Array.isArray(r) && typeof r[0] === \'string\')\n    .map((r) => ({ hex: r[0], share: Number(r[1]) || 0 }))\n    .sort((a, b) => b.share - a.share);'),
    // 重新排序在資料已經排序時是 no-op，所以這一條**不會**變紅。它留下來是
    // 為了說明那個 no-op 的形狀，並且它在資料順序變亂時才有意義。見下面的
    // DATA 案例，那才是能抓到它的東西。
    expect: null,
  },
  {
    /* A REAL no-op, kept as a case because the no-op is the thing worth knowing:
       `Array.prototype.slice` already clamps to the array length, so the
       `Math.min` against `rows.length` is belt-and-braces. Removing it cannot
       change behaviour, so expecting a FAIL here would be expecting the
       impossible. The case asserts the no-op IS one — and it would go red if
       someone swapped `slice` for something that does not clamp. */
    name: 'the Math.min clamp against rows.length is belt-and-braces (slice clamps too)',
    mutate: (dir) => editModule(dir,
      '  return rows.slice(0, Math.min(n, revealed ? PALETTE_COLORS_REVEALED : PALETTE_COLORS_SHOWN));',
      '  return rows.slice(0, revealed ? PALETTE_COLORS_REVEALED : PALETTE_COLORS_SHOWN);'),
    expect: null,
  },
  {
    name: 'the reveal hard-codes 6 colours, which is one too many for Unown',
    mutate: (dir) => editModule(dir,
      'export const PALETTE_COLORS_REVEALED = 6;',
      'export const PALETTE_COLORS_REVEALED = 5;'),
    // The 6-colour species fail first; Unown only fails once the cap is at 4.
    expect: 'the reveal shows every row it has',
  },
  {
    name: '地獄 reads the normal palette because the variant is defaulted away',
    mutate: (dir) => editModule(dir,
      "export function paletteRows(palettes, id, variant = 'n') {",
      "export function paletteRows(palettes, id, _variant = 'n') {\n  const variant = 'n';"),
    expect: 'scoring in 異色 gives different answers from 原始色',
  },

  /* ---- 計分：這裡是本專案自己的規則，不是參考專案的 ---- */
  {
    name: 'the distance drops its reverse term, so a brown outfit matches any brown for free',
    mutate: (dir) => editModule(dir,
      '  return { forward, reverse, score: (forward + reverse) / 2 };',
      '  return { forward, reverse, score: forward };'),
    expect: 'the score is their mean, as matchPalette() defines it',
  },
  {
    name: 'the distance becomes one-directional AND unweighted',
    mutate: (dir) => editModule(dir,
      '    forward += o.share * best;',
      '    forward += best;'),
    // Not the mean assertion — the mean is untouched. Dropping the share weight
    // makes the two directions disagree, which is the first thing that notices.
    expect: 'the distance is symmetric',
  },
  {
    name: 'the distance stops being symmetric',
    mutate: (dir) => editModule(dir,
      '  return { forward, reverse, score: (forward + reverse) / 2 };',
      '  return { forward, reverse, score: (forward + 0.1 * reverse) / 1.1 };'),
    expect: 'the distance is symmetric',
  },
  {
    name: 'zero shares produce NaN instead of falling back to equal weight',
    mutate: (dir) => editModule(dir,
      '  if (!(aSum > 0)) for (const r of a) r.share = 1;',
      '  // the fallback removed'),
    expect: 'zero shares fall back to equal weight rather than NaN',
  },
  {
    name: 'an empty palette scores 0, which reads as "identical" rather than "unknown"',
    mutate: (dir) => editModule(dir,
      '  if (!a.length || !b.length) return null;',
      '  if (!a.length || !b.length) return { forward: 0, reverse: 0, score: 0 };'),
    expect: 'an empty side is null, not 0',
  },
  {
    name: 'a palette is scored against itself at a non-zero distance',
    mutate: (dir) => editModule(dir,
      '    for (const e of b) { const d = deltaEOk(o.lab, e.lab); if (d < best) best = d; }',
      '    for (const e of b) { const d = deltaEOk(o.lab, e.lab) + 0.01; if (d < best) best = d; }'),
    expect: 'a palette against itself is 0',
  },

  /* ---- 色階：方向反了也會是一張看起來合理的圖 ---- */
  {
    name: 'the tier ladder is inverted, so the share grid reads backwards',
    mutate: (dir) => editModule(dir,
      "  if (distance <= TIER_CLOSE) return 'close';\n  if (distance <= TIER_MID) return 'mid';\n  if (distance <= TIER_FAR) return 'far';\n  return 'miss';",
      "  if (distance >= TIER_FAR) return 'close';\n  if (distance >= TIER_MID) return 'mid';\n  if (distance >= TIER_CLOSE) return 'far';\n  return 'miss';"),
    expect: 'the tiers get worse as the distance grows',
  },
  {
    name: 'the tiers collapse so every pair lands in one bucket',
    mutate: (dir) => editModule(dir,
      'export const TIER_CLOSE = 0.075;',
      'export const TIER_CLOSE = 99;'),
    expect: 'the far tier is reachable',
  },
  {
    name: 'the close tier is widened until nothing is ever a miss',
    mutate: (dir) => editModule(dir,
      'export const TIER_FAR = 0.165;',
      'export const TIER_FAR = 99;'),
    expect: 'the miss tier is reachable',
  },
  {
    name: 'an unmeasurable guess is called close rather than a miss',
    mutate: (dir) => editModule(dir,
      "  if (!Number.isFinite(distance)) return 'miss';",
      "  if (!Number.isFinite(distance)) return 'close';"),
    expect: 'an unmeasurable guess scores as a miss, not as close',
  },

  /* ---- 常數：把參考專案的 250 搬過來是這個專案明確拒絕的 ---- */
  {
    name: "the reference's sRGB ceiling is pasted in, which puts every OKLab distance past zero",
    mutate: (dir) => editModule(dir,
      'export const TIER_FAR = 0.165;',
      'export const TIER_FAR = 250;'),
    expect: 'far tier',
  },
  {
    name: 'MAX_ATTEMPTS is doubled, so the game is twice as long as the reference',
    mutate: (dir) => editModule(dir,
      'export const MAX_ATTEMPTS = 4;',
      'export const MAX_ATTEMPTS = 8;'),
    expect: '4 attempts, copied from the reference',
  },
  {
    name: 'the shown palette is 6 colours, which gives the whole answer away on turn one',
    mutate: (dir) => editModule(dir,
      'export const PALETTE_COLORS_SHOWN = 3;',
      'export const PALETTE_COLORS_SHOWN = 6;'),
    expect: '3 colours during play, copied from the reference',
  },
];

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function makeTree(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'gamesim-neg-'));
  for (const f of SRC) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

const run = (dir) => new Promise((res) => {
  execFile(process.execPath, [join(dir, CHECKER)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
});

const POOL = Math.max(1, Math.min(4, (cpus().length - 1) >> 1));

/* The BASELINE runs first and alone. If it is red, every case below is being
 * measured against a broken tree and each of them "fails" for a reason that has
 * nothing to do with the mutation — which is exactly the state that produced a
 * green suite in §3.G5. One baseline, before the pool starts. */
{
  const dir = makeTree(null);
  let r;
  try { r = await run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  ok('baseline: the checker is green on the real tree', r.code === 0,
    r.code === 0 ? '' : `it already fails, so every case below proves nothing:\n${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n')}`);
  if (r.code !== 0) {
    console.log('\nFAIL  the baseline is red, so this suite cannot mean anything');
    process.exit(1);
  }
}

let next = 0;
const finished = new Array(CASES.length);

async function runCase(i) {
  const c = CASES[i];
  /* `makeTree` is INSIDE the try. A case whose `replace()` target has drifted
     throws there, and when it was outside, that exception escaped the whole
     worker and killed the suite — the pool never drained and the remaining
     cases never ran, so a drifted mutation target looks like a crashed run
     rather than like the one case that needs fixing. `editModule`'s own guard
     exists so that case is reported as itself. */
  let dir = null;
  try {
    dir = makeTree(c.mutate);
    const r = await run(dir);

    /* A case with `expect: null` is a REMOVAL of a guard, or — as with the
       re-sort case above — a mutation that is a no-op against data that is
       already sorted. It is expected to leave the checker green, and what it
       asserts is that the no-op really is a no-op. Treated as an ordinary case
       it would fail, and a failure here means the mutation is no longer a
       no-op. */
    if (c.expect === null) {
      const green = r.code === 0;
      return {
        name: c.name,
        pass: green,
        detail: green ? '' : 'expected this no-op mutation to change nothing, and it did not',
      };
    }

    const named = r.code !== 0 && caughtBy(r.out, c.expect);
    return {
      name: c.name,
      pass: named,
      detail: named ? '' : `exit ${r.code}, expected "${c.expect}" on a FAIL line; it said:\n${failLines(r.out).map((l) => `        ${l.trim()}`).join('\n') || '        (no FAIL line at all)'}`,
    };
  } catch (e) {
    return { name: c.name, pass: false, detail: `the mutation itself threw: ${e.message}` };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

await Promise.all(Array.from({ length: POOL }, async () => {
  while (next < CASES.length) {
    const i = next++;
    finished[i] = await runCase(i);
  }
}));

/* Declaration order, after the drain. Logging from inside the worker makes the
 * output order a property of the scheduler, so two green runs stop diffing and
 * a red case cannot be located by reading. */
for (const r of finished) ok(r.name, r.pass, r.detail);

ok(`the suite declares every case it runs (${CASES.length})`,
  CASES.every((c) => typeof c.name === 'string' && typeof c.mutate === 'function')
    && CASES.every((c) => c.expect === null || typeof c.expect === 'string'),
  `${CASES.length} cases`);

const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length) {
  console.log(`FAIL  ${failed.length} case(s) did not behave`);
  process.exit(1);
}
console.log('PASS  every negative case failed for the right reason');