/**
 * Version regression test: one source, one changelog entry, two visible slots.
 *
 *   node scripts/check_version.mjs
 *
 * The version is written in `assets/js/shared.js` and printed by two footers.
 * `scripts/release.mjs` writes all three together, but a hand edit can desync
 * them, and a footer that claims a version the CHANGELOG never shipped is a
 * release note that lies. This is the cheap text reader that catches it: ~0.1 s,
 * no browser, no git history.
 *
 * It deliberately does NOT check the tag. A tag is a release-time event, and a
 * checker that fails whenever HEAD is ahead of the newest tag would be red for
 * every commit between releases — which is most of them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChecker } from './lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const SHARED = read('assets/js/shared.js');
const CHANGELOG = read('CHANGELOG.md');
const INDEX = read('index.html');
const TODAY = read('today.html');
const RELEASING = read('docs/RELEASING.md');
const RELEASE = read('scripts/release.mjs');

const C = createChecker({ fail: (line) => console.error(`  FAIL  ${line}`) });
const { ok, is } = C;

/* ---- one declaration ------------------------------------------------------ */

const declarations = [...SHARED.matchAll(/export const SITE_VERSION = '([^']+)';/g)];
is(declarations.length, 1, 'shared.js declares SITE_VERSION exactly once');

const version = declarations[0]?.[1] ?? '';
ok(/^\d+\.\d+\.\d+$/.test(version), 'SITE_VERSION is a bare x.y.z', `got ${version || '(none)'}`);

ok(/export function initVersion\s*\(/.test(SHARED), 'shared.js exports initVersion()');
ok(/initVersion\(\);/.test(SHARED), 'initFooterNav() calls initVersion()');
ok(/el\.textContent = `v\$\{SITE_VERSION\}`/.test(SHARED),
  'initVersion() writes exactly the declared constant', 'a second literal would be a second source');

/* ---- the changelog agrees ------------------------------------------------- */

const headings = [...CHANGELOG.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/gm)];
ok(headings.length > 0, 'CHANGELOG.md has at least one dated version heading');

if (headings.length) {
  is(headings[0][1], version, 'the newest CHANGELOG heading equals SITE_VERSION');
  ok(!/^Unreleased$/i.test(headings[0][1]), 'the newest heading is a release, not Unreleased');
  ok(
    headings.every(([, name]) => /^\d+\.\d+\.\d+$/.test(name)),
    'every CHANGELOG heading is a bare x.y.z',
  );
}

/* ---- two visible slots ---------------------------------------------------- */

for (const [name, html] of [['index.html', INDEX], ['today.html', TODAY]]) {
  const slots = (html.match(/data-version\b/g) || []).length;
  is(slots, 1, `${name} mounts exactly one [data-version] slot`);
  ok(!/v\d+\.\d+\.\d+/.test(html), `${name} holds no hardcoded version literal`);
}

/* ---- the release script's policy is the documented one -------------------- */

ok(/SITE_VERSION/.test(RELEASE), 'release.mjs rewrites SITE_VERSION');
ok(/CHANGELOG/.test(RELEASE), 'release.mjs writes CHANGELOG.md');
ok(!/git\('push'/.test(RELEASE), 'release.mjs never pushes (AGENTS §6)');
ok(/'--apply'/.test(RELEASE) && /'--baseline'/.test(RELEASE),
  'release.mjs documents --apply and --baseline');

for (const type of ['feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'chore', 'build', 'ci', 'data']) {
  ok(new RegExp(`\\['${type}'`).test(RELEASE), `release.mjs classifies '${type}'`);
}

/* ---- the playbook names the commands it promises -------------------------- */

ok(/scripts\/release\.mjs/.test(RELEASING), 'RELEASING.md names scripts/release.mjs');
ok(/--dry-run|dry run/i.test(RELEASING), 'RELEASING.md names the dry run');
ok(/--apply/.test(RELEASING), 'RELEASING.md names --apply');
ok(/git push/.test(RELEASING), 'RELEASING.md keeps the push step explicit');

process.exit(C.report());
