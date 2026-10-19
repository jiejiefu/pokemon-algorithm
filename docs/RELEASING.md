# Releasing

One page: how a version is decided, how it is cut, and what to run once a week.
Nothing here needs CI — GitHub Pages already deploys `main` on push.

## The policy

| Commit type | Bump | Why |
| :--- | :--- | :--- |
| `feat` | minor | a reader can see something new |
| `fix`, `perf`, `revert` | patch | the same page, now correct or faster |
| `data` | patch | regenerated tables and indexes change behaviour |
| `docs`, `refactor`, `test`, `chore`, `build`, `ci` | none | no reader-visible change |

While the major is `0`, a breaking change (`feat!:` or a `BREAKING CHANGE:`
body) bumps the **minor**. From `1.0.0` it bumps the major. A range with no
bumping commit does not release at all.

The type is chosen when the commit is written, not at release time. That is the
whole point: `scripts/release.mjs` does the arithmetic, so the number is
reproducible from history instead of being a judgement call three weeks later.

## The files that hold the version

| File | Role |
| :--- | :--- |
| `assets/js/shared.js` | `SITE_VERSION` — the only declaration |
| `CHANGELOG.md` | one dated section per release; the newest must match |
| `index.html`, `today.html` | `<span data-version>`, filled by `initVersion()` |
| `scripts/release.mjs` | writes the three together and tags |
| `scripts/check_version.mjs` | fails when they disagree |

## Weekly tracking (about 2 seconds)

```bash
node scripts/release.mjs          # dry run — the default writes nothing
```

It prints every commit since the newest tag, its type and bump, and the
proposed version. Nothing is written. Do this weekly; it is the drift report.

## Cutting a release

```bash
# 1. classify the range without writing anything
node scripts/release.mjs

# 2. read the proposal, then write the files, commit, and tag
node scripts/release.mjs --apply

# 3. verify what was written
node scripts/check_version.mjs

# 4. publish — only when you decide to
git push origin main --follow-tags
```

Then on GitHub: **Releases → Draft a new release → choose the tag → paste the
new `CHANGELOG.md` section**. The script never pushes; `git push` stays a
deliberate, separate act (AGENTS §6).

## The first tag

A repository with no tags has no range to derive a version from, so the first
release is explicit:

```bash
node scripts/release.mjs --baseline 0.1.0 --apply
```

It tags `HEAD` and keeps the `0.1.0` section already written by hand. Every
release after it is derived from `v0.1.0..HEAD`.

## Rules the script enforces

- A clean working tree, on `main`.
- Every commit in the range is `<type>(<scope>): <summary>`. If one is not, the
  script stops and prints it; `--allow-untyped` skips them explicitly.
- `SITE_VERSION` matches exactly once, and the new tag does not already exist.
- It never pushes.

If the answer is "nothing to release", that is a valid outcome: docs and
refactors alone do not move the number.

## Data snapshots

The roster, move table and graph move independently of the site version. Record
their counts in the `Data` section when a release regenerates them — today
1,025 Pokémon / 919 moves / 314 abilities / 1,346 graph entities — so a reader
can tell a content refresh from a layout change.
