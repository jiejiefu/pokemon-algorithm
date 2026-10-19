#!/usr/bin/env node
/**
 * Derive the next version from commit types, write it, and tag it.
 *
 *   node scripts/release.mjs                    # dry run: classify, propose a bump
 *   node scripts/release.mjs --apply            # write SITE_VERSION + CHANGELOG, commit, tag
 *   node scripts/release.mjs --baseline 0.1.0   # the first tag, before any range exists
 *   node scripts/release.mjs --from v0.1.0      # override the range's start
 *   node scripts/release.mjs --allow-untyped    # skip commits the parser cannot type
 *
 * WHY THIS EXISTS
 *
 * SemVer on a static site has no importers and no API contract, so the number is
 * a communication device. That is exactly why it should not be a judgement call
 * at release time: the only durable signal is the commit that made the change,
 * written down when the author still remembers it. This script reads that signal
 * and does the arithmetic, so `v0.2.0` means "there was a feat" rather than
 * "the author felt 0.2.0 today".
 *
 * The type table below IS the policy. `feat` → minor, `fix`/`perf`/`revert`/
 * `data` → patch, everything else → no bump. While the major is 0 a breaking
 * change bumps the MINOR, which is what `0.x` means; at 1.0 it starts bumping
 * the major. Docs-only and refactor-only ranges produce no release at all.
 *
 * WHAT IT REFUSES
 *
 *   - a dirty working tree (a release must be reproducible from HEAD);
 *   - a branch other than `main`;
 *   - an untyped commit in the range, because guessing its bump is the free
 *     judgement this script exists to remove (`--allow-untyped` says so out loud);
 *   - a version or CHANGELOG heading that is not written EXACTLY once;
 *   - a tag that already exists.
 *
 * WHAT IT NEVER DOES
 *
 * Push. `git push` is the user's decision (AGENTS §6); the script prints the
 * command and stops. Everything before that point is local and reversible.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = 'assets/js/shared.js';
const CHANGELOG = 'CHANGELOG.md';

const USAGE = `Usage: node scripts/release.mjs [options]

  (no option)            dry run: classify the range and print the proposed bump
  --apply                write SITE_VERSION and CHANGELOG, commit, create an annotated tag
  --baseline <version>   tag HEAD as the first release (requires --apply)
  --from <ref>           start the range at <ref> instead of the newest tag
  --allow-untyped        skip commits that are not <type>(<scope>): <summary>
  --help                 print this text

Types: feat (minor), fix/perf/revert/data (patch), docs/refactor/test/chore/
build/ci (no bump). A "!" or BREAKING CHANGE bumps minor while major is 0, and
major from 1.0 on.`;

/* ---- git helpers ---------------------------------------------------------- */

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function tryGit(...args) {
  try {
    /* `describe` says "fatal: No names found" on stderr when the repository has
     * no tags yet. That is the expected first-run state, not an error to show. */
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/* ---- policy --------------------------------------------------------------- */

const TYPES = new Map([
  ['feat', { bump: 'minor', section: 'Added' }],
  ['fix', { bump: 'patch', section: 'Fixed' }],
  ['perf', { bump: 'patch', section: 'Changed' }],
  ['revert', { bump: 'patch', section: 'Fixed' }],
  ['data', { bump: 'patch', section: 'Data' }],
  ['refactor', { bump: null, section: 'Changed' }],
  ['docs', { bump: null, section: 'Docs' }],
  ['test', { bump: null, section: 'Internal' }],
  ['chore', { bump: null, section: 'Internal' }],
  ['build', { bump: null, section: 'Internal' }],
  ['ci', { bump: null, section: 'Internal' }],
]);

const SECTION_ORDER = ['Added', 'Changed', 'Fixed', 'Data', 'Docs', 'Internal'];

const SUBJECT = /^(feat|fix|perf|docs|refactor|test|chore|build|ci|data|revert)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const BREAKING_BODY = /(^|\n)BREAKING[ -]CHANGE:/;

const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

/* ---- argv ----------------------------------------------------------------- */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (has('--help') || has('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const APPLY = has('--apply');
const ALLOW_UNTYPED = has('--allow-untyped');
const BASELINE = valueOf('--baseline');
const FROM = valueOf('--from');

if (has('--baseline') && !APPLY) fail('--baseline writes a tag; pass --apply as well');
if (BASELINE && FROM) fail('pick one: --baseline starts at nothing, --from starts at a ref');

/* ---- range ---------------------------------------------------------------- */

const lastTag = tryGit('describe', '--tags', '--abbrev=0');
const from = BASELINE ? null : FROM ?? lastTag;

if (!BASELINE && !from) {
  console.log('release: no tags yet, so there is no range to derive a version from.');
  console.log('         create the first one with:');
  console.log('           node scripts/release.mjs --baseline 0.1.0 --apply');
  process.exit(0);
}

if (from && !tryGit('rev-parse', '--verify', `${from}^{commit}`)) {
  fail(`--from ${from} is not a commit or tag in this repository`);
}

/* `%x1f` separates fields and `%x1e` records. A body can contain newlines but not
 * those two control characters, so this does not need a CSV-style escape. */
const RAW = from
  ? git('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', `${from}..HEAD`)
  : '';

const commits = RAW.split('\x1e')
  .map((row) => row.trim())
  .filter(Boolean)
  .map((row) => {
    const [hash, subject, body = ''] = row.split('\x1f');
    return { hash, subject, body };
  })
  .reverse(); // oldest first, so the changelog reads chronologically

const typed = [];
const untyped = [];

for (const commit of commits) {
  const match = commit.subject.match(SUBJECT);
  if (!match) {
    untyped.push(commit);
    continue;
  }
  const [, type, scope, bang, summary] = match;
  const policy = TYPES.get(type);
  typed.push({
    ...commit,
    type,
    scope: scope || '',
    summary,
    section: policy.section,
    bump: policy.bump,
    breaking: Boolean(bang) || BREAKING_BODY.test(commit.body),
  });
}

if (untyped.length && !ALLOW_UNTYPED) {
  console.error(`release: ${untyped.length} commit(s) in ${from}..HEAD have no type:`);
  for (const commit of untyped) console.error(`  ${commit.hash.slice(0, 8)} ${commit.subject}`);
  console.error('release: rewrite them, or pass --allow-untyped to skip them.');
  process.exit(1);
}

/* ---- version -------------------------------------------------------------- */

const shared = readFileSync(join(ROOT, SHARED), 'utf8');
const VERSION_DECL = /export const SITE_VERSION = '(\d+)\.(\d+)\.(\d+)';/g;
const declarations = [...shared.matchAll(VERSION_DECL)];

if (declarations.length !== 1) {
  fail(`${SHARED} must contain exactly one SITE_VERSION declaration, found ${declarations.length}`);
}

const current = declarations[0].slice(1).map(Number);

function bump(currentVersion, entries) {
  const rank = { patch: 1, minor: 2, major: 3 };
  let level = null;
  for (const entry of entries) {
    const next = entry.breaking
      ? (currentVersion[0] === 0 ? 'minor' : 'major')
      : entry.bump;
    if (next && (!level || rank[next] > rank[level])) level = next;
  }
  if (!level) return null;

  const [major, minor, patch] = currentVersion;
  if (level === 'major') return [major + 1, 0, 0];
  if (level === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

if (BASELINE && !/^\d+\.\d+\.\d+$/.test(BASELINE)) fail(`--baseline ${BASELINE} is not x.y.z`);

const next = BASELINE
  ? BASELINE.split('.').map(Number)
  : bump(current, typed);

if (!next) {
  console.log(`release: ${typed.length} commit(s) since ${from}, none of them bump the version.`);
  console.log('         docs / refactor / test / chore ranges do not release.');
  process.exit(0);
}

const version = next.join('.');
const tag = `v${version}`;

if (tryGit('rev-parse', '--verify', `refs/tags/${tag}`)) {
  fail(`tag ${tag} already exists`);
}

/* ---- changelog ------------------------------------------------------------ */

/* The author's calendar day, not UTC's: a release cut at 23:00 in Taipei should
 * carry today's date, and `toISOString()` would stamp yesterday on it. */
const now = new Date();
const date = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-');

function sectionFor(entries, baselineVersion) {
  if (baselineVersion) {
    return [
      `## [${baselineVersion}] - ${date}`,
      '',
      '### Added',
      '',
      '- Baseline release: the first tagged state, and the anchor every later',
      '  version is derived from. Earlier history is not reclassified.',
      '',
    ].join('\n');
  }

  const grouped = new Map(SECTION_ORDER.map((name) => [name, []]));
  for (const entry of entries) {
    if (entry.bump === null && entry.section === 'Internal') {
      grouped.get('Internal').push(`- **${entry.scope || entry.type}:** ${entry.summary}`);
      continue;
    }
    grouped.get(entry.section).push(
      `- ${entry.scope ? `**${entry.scope}:** ` : ''}${entry.summary}`,
    );
  }

  const blocks = [`## [${version}] - ${date}`];
  for (const name of SECTION_ORDER) {
    const rows = grouped.get(name);
    if (rows.length) blocks.push('', `### ${name}`, '', ...rows);
  }
  blocks.push('');
  return blocks.join('\n');
}

if (!existsSync(join(ROOT, CHANGELOG))) fail(`${CHANGELOG} does not exist`);

let changelog = readFileSync(join(ROOT, CHANGELOG), 'utf8');
const section = sectionFor(typed, BASELINE ? version : null);

if (!BASELINE && changelog.includes(`## [${version}]`)) {
  fail(`${CHANGELOG} already has a ${version} section`);
}

/* A baseline is often cut on a tree whose CHANGELOG was written by hand. If the
 * section is already there, keep it — the tag is the thing being created, not a
 * second copy of prose the author just wrote. */
const needsSection = BASELINE ? !changelog.includes(`## [${version}]`) : true;

if (needsSection) {
  const firstHeading = changelog.search(/^## \[/m);
  changelog = firstHeading === -1
    ? `${changelog.trimEnd()}\n\n${section}`
    : `${changelog.slice(0, firstHeading)}${section}\n${changelog.slice(firstHeading)}`;
}

/* ---- report --------------------------------------------------------------- */

if (!APPLY) {
  console.log(`release: ${from}..HEAD, ${commits.length} commit(s)`);
  for (const entry of typed) {
    const marks = [entry.bump ?? 'no bump'];
    if (entry.breaking) marks.unshift('breaking');
    console.log(`  ${entry.type}${entry.scope ? `(${entry.scope})` : ''}: ${entry.summary} — ${marks.join(', ')}`);
  }
  if (untyped.length) console.log(`  (${untyped.length} untyped commit(s) skipped)`);
  console.log(`\nrelease: ${BASELINE ? 'baseline' : `${current.join('.')} -> ${version}`}`);
  console.log('         dry run only; pass --apply to write the files and create the tag.');
  process.exit(0);
}

/* ---- apply ---------------------------------------------------------------- */

const dirty = git('status', '--porcelain');
if (dirty) fail(`working tree is not clean:\n${dirty}`);
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('releases are cut from main only');

writeFileSync(
  join(ROOT, SHARED),
  shared.replace(VERSION_DECL, `export const SITE_VERSION = '${version}';`),
);
writeFileSync(join(ROOT, CHANGELOG), changelog);

git('add', SHARED, CHANGELOG);

/* A baseline on a tree whose version and section are already correct has nothing
 * to commit — the tag is the only event. `git commit` exits 1 on an empty index,
 * and turning "already written" into a crash is the wrong answer. */
if (tryGit('status', '--porcelain', '--', SHARED, CHANGELOG)) {
  git('commit', '-m', `chore(release): ${tag}`);
}

git('tag', '-a', tag, '-m', tag);

console.log(`release: wrote ${version} and tagged ${tag}`);
console.log('         nothing was pushed. When you decide to publish:');
console.log(`           git push origin main --follow-tags`);
console.log(`         then GitHub -> Releases -> Draft a new release -> ${tag}`);
