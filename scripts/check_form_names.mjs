/**
 * Form name authority — regression test.
 *
 * FORM_NAME_OVERRIDES is a hand-written table of Chinese strings, so a
 * plausible-looking entry could render as if it were official wording. Every
 * override is asserted to appear verbatim in the generated portal table for the
 * same species. A typo, a reworded descriptor, or a differently spelled portal
 * name all fail here rather than shipping.
 *
 * Run: node scripts/check_form_names.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PORTAL_FORM_NAMES } from '../assets/js/form-names-zh.js';
import { FORM_DESCRIPTOR_ZH, FORM_NAME_OVERRIDES, formNameZh } from '../assets/js/form-names.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isChinese = (s) => typeof s === 'string' && /[^\x00-\x7F]/.test(s);

let checks = 0;
const fails = [];
const eq = (got, want, what) => {
  checks++;
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fails.push(`${what}\n      got:  ${a}\n      want: ${b}`);
};
const ok = (cond, what) => eq(!!cond, true, what);

const chains = JSON.parse(readFileSync(join(root, 'assets/data/evolution_chains.json'), 'utf8'));
const pokemon = JSON.parse(readFileSync(join(root, 'assets/data/pokemon_data.json'), 'utf8'));
const forms = [];
Object.values(chains).forEach((c) => {
  [...c.main_line, ...Object.values(c.variants || {}).flat(), ...Object.values(c.special_forms || {}).flat()]
    .forEach((n) => { if (n.form) forms.push(n); });
});

/* 1. Every override is a string the portal actually publishes. */
const unverified = [];
for (const [baseId, byQualifier] of Object.entries(FORM_NAME_OVERRIDES)) {
  const listed = (PORTAL_FORM_NAMES[baseId] || []).map((r) => r.nameZh);
  for (const [qualifier, name] of Object.entries(byQualifier)) {
    checks++;
    if (!listed.includes(name)) {
      unverified.push(`base ${baseId} / ${qualifier}: "${name}" not in portal [${listed.join(' | ') || 'none'}]`);
    }
  }
}
eq(unverified, [], 'overrides that are not verbatim portal strings');

/* 2. Every override key corresponds to a real local node, so the table has no
   dead entries, and every local node an override claims is really that form. */
const deadOverrides = [];
for (const [baseId, byQualifier] of Object.entries(FORM_NAME_OVERRIDES)) {
  for (const qualifier of Object.keys(byQualifier)) {
    checks++;
    if (!forms.some((n) => String(n.base_id) === String(baseId) && n.qualifier === qualifier)) {
      deadOverrides.push(`base ${baseId} / ${qualifier}`);
    }
  }
}
eq(deadOverrides, [], 'override entries with no matching local form node');

/* 3. Every descriptor rule is used by at least one node, so a rule cannot go
   stale unnoticed when the qualifier vocabulary changes. */
const unusedDescriptors = Object.keys(FORM_DESCRIPTOR_ZH)
  .filter((q) => !forms.some((n) => n.qualifier === q));
eq(unusedDescriptors, [], 'descriptor rules no local form uses');

/* 4. The 127 rows that were already Chinese must not regress. The 9
   portal-absent Megas survive because of this: 10278-10284, 10306 and 10308
   appear in no portal list, so an implementation that preferred the portal
   unconditionally would blank them. */
const regressed = forms
  .filter((n) => isChinese(n.name_zh) && formNameZh(n) !== n.name_zh)
  .map((n) => `${n.name_en}: was ${n.name_zh}, now ${formNameZh(n)}`);
eq(regressed, [], 'already-Chinese form names altered');

/* 5. No node renders empty. */
eq(forms.filter((n) => !formNameZh(n)).map((n) => n.name_en), [], 'forms with no name at all');

/* 6. Coverage, pinned by count. The residual is a known, measured gap rather
   than a surprise: 69 of 325 forms still fall through to their English name
   because the official source has no Chinese for them. The split is 127 rows
   that were already Chinese plus 129 newly localised; both halves are asserted
   separately because they fail for opposite reasons — the first is a regression
   guard, the second is the win. */
const localised = forms.filter((n) => isChinese(formNameZh(n)));
const preChinese = forms.filter((n) => isChinese(n.name_zh));
eq(preChinese.length, 127, 'form nodes whose stored name_zh is already Chinese');
eq(localised.length, 256, 'form nodes resolving to a Chinese name');
eq(localised.length - preChinese.length, 129, 'form nodes newly localised by the authority');
const stillEnglish = forms.filter((n) => !isChinese(formNameZh(n)));
eq(stillEnglish.length, 69, 'form nodes still falling through to English');
ok(stillEnglish.every((n) => n.name_zh === n.name_en),
  'every form still rendering in English is one whose stored zh name is its English name — none falls through while a Chinese name exists');

/* 7. The approved sub_names land verbatim where a local node exists. */
const approved = [
  ['達摩狒狒（達摩模式）', 'Zen', 555],
  ['達摩狒狒（伽勒爾的樣子/達摩模式）', 'Galar-Zen', 555],
  ['酋雷姆（焰白酋雷姆）', 'Black', 646],
  ['酋雷姆（闇黑酋雷姆）', 'White', 646],
  ['基格爾德（完全體形態）', 'Complete', 718],
];
eq(approved.map(([name, q, id]) => {
  const n = forms.find((x) => x.base_id === id && x.qualifier === q);
  return n ? formNameZh(n) : `<no node ${id}/${q}>`;
}), approved.map(([name]) => name), 'approved sub_names render verbatim');

/* 8. Two of the approved sub_names have no local node; that is recorded rather
   than faked with a guessed qualifier. 刀劍形態 (Blade Form) is NOT in this list:
   it has a node (10026 Aegislash-Blade, base 681) and the Blade rule resolves it,
   so listing it here would assert a false gap. */
const PORTAL_ONLY_APPROVED = ['東海', '真品形態'];
for (const sub of PORTAL_ONLY_APPROVED) {
  checks++;
  const inPortal = Object.values(PORTAL_FORM_NAMES).flat().some((r) => r.nameZh.includes(`（${sub}）`));
  ok(inPortal, `approved sub_name ${sub} missing from the generated table`);
  const hasNode = forms.some((n) => (PORTAL_FORM_NAMES[n.base_id] || []).some((r) => r.nameZh.includes(`（${sub}）`)));
  ok(!hasNode, `${sub} unexpectedly now has a local node — add it to FORM_NAME_OVERRIDES`);
}
eq(
  forms.filter((n) => n.qualifier === 'Blade').map((n) => formNameZh(n)),
  ['堅盾劍怪（刀劍形態）'],
  'the Blade form resolves through the descriptor rule',
);

/* 9. The region words the regional category page asserts. Hisui must read 洗翠,
   the site's spelling, in both the form names and the category's own label. */
eq(
  forms.filter((n) => n.qualifier === 'Hisui').map((n) => formNameZh(n)),
  forms.filter((n) => n.qualifier === 'Hisui').map((n) => `${n.base_name_zh}（洗翠的樣子）`),
  'Hisui forms use 洗翠的樣子 (Hisuian form)',
);
ok(!JSON.stringify(FORM_DESCRIPTOR_ZH).includes('他思岐'), 'the misspelling 他思岐 is absent from FORM_DESCRIPTOR_ZH');

/* 10. The 9 newer Megas the portal does not list must keep their local name. */
const newerMegas = [10278, 10279, 10280, 10281, 10282, 10283, 10284, 10306, 10308];
eq(newerMegas.map((id) => {
  const n = forms.find((x) => x.id === id);
  return n ? formNameZh(n) : '<no node>';
}), newerMegas.map((id) => forms.find((x) => x.id === id).name_zh),
  'portal-absent Megas keep their local names');

/* 11. The sprite fallback is driven by the FILESYSTEM, not by `has_art`.
   `has_art` is false on 9 nodes, but 5 of those 9 sprites are on disk: 10301
   (Zygarde-Mega) and the four Koraidon/Miraidon forms 10265/10267/10269/10271.
   Keying the fallback off `has_art` would silently swap 5 forms that do have
   artwork for their base. The 4 that genuinely lack a file are all
   Koraidon/Miraidon build forms, and each has a base sprite, so the fallback is
   always renderable. */
const hasFile = (id) => existsSync(join(root, `assets/images/pokemon/${id}.png`));
const noSprite = forms.filter((n) => !hasFile(n.id));
eq(noSprite.map((n) => n.id), [10264, 10266, 10268, 10270], 'form nodes with no sprite on disk');
eq(noSprite.filter((n) => !hasFile(n.base_id)).map((n) => n.id), [],
  'form nodes with neither their own sprite nor a base sprite');
eq(forms.filter((n) => n.has_art === false && hasFile(n.id)).map((n) => n.id).sort(),
  [10265, 10267, 10269, 10271, 10301],
  'has_art=false nodes whose sprite is actually present (stale data — do not use as the fallback signal)');
ok(!noSprite.some((n) => !formNameZh(n)), 'a sprite-less form has no name to fall back to');

/* 12. All three evolution-chain render loops go through the helpers. The bug this
   module exists for was a raw `${p.name_zh}` interpolated at each site, so the
   regression to guard is a site going back to reading the field directly — which
   would silently restore English on that loop only and leave the page looking
   half-fixed. Counting the call sites also keeps the name and the sprite fallback
   from drifting apart. */
const shared = readFileSync(join(root, 'assets/js/shared.js'), 'utf8');
eq((shared.match(/\$\{(pokemon|p)\.name_zh\}/g) || []).length, 0,
  'renderEvolutionChain still interpolates a raw name_zh');
eq((shared.match(/\$\{nodeSpriteHtml\(/g) || []).length, 3,
  'all three render loops call the shared sprite helper');
eq((shared.match(/\$\{nodeName\(/g) || []).length, 5,
  'the name helper is used 3x as a label and 2x as an alt attribute');
eq((shared.match(/import \{ formNameZh \}/g) || []).length, 1,
  'formNameZh is imported exactly once');

/* 13. A form name must never be able to become a route. All 325 forms are ids
   above 1025 and pokemon_data.json holds 1..1025 only, so no form has a detail
   page to link to and a form name can never resolve as a slug. Asserting the
   absence of the id is the real invariant; asserting something about the string
   would only be a proxy for it. */
const knownIds = new Set(pokemon.map((p) => p.id));
eq(forms.filter((n) => knownIds.has(n.id)).map((n) => n.id), [],
  'a form id collides with a species id');
ok(forms.every((n) => n.id > 1025), 'every form id is above the species range');
ok(!/pokemonSlug\([^)]*formNameZh/.test(shared), 'pokemonSlug consumes a form name');

console.log(`  form name overrides verified against the portal: ${Object.values(FORM_NAME_OVERRIDES).reduce((n, q) => n + Object.keys(q).length, 0)}`);
console.log(`  forms resolving to Chinese: ${localised.length} / ${forms.length}`);
console.log(`  forms still English (no official source): ${stillEnglish.length}`);

if (fails.length) {
  console.log(`\nFAIL  ${fails.length} of ${checks} checks failed\n`);
  fails.forEach((f) => console.log(`  FAIL  ${f}`));
  process.exit(1);
}
console.log(`\nPASS  ${checks} checks`);
