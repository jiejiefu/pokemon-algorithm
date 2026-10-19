# Changelog

All notable changes to 寶可夢演算法 are recorded here. The version is the value
of `SITE_VERSION` in `assets/js/shared.js`, printed by the footers of
`index.html` and `today.html`.

The project uses SemVer 0.x: while the major is 0, a breaking change bumps the
minor. `scripts/release.mjs` derives the number from commit types, so the
number is reproducible from history rather than chosen at release time. See
[`docs/RELEASING.md`](docs/RELEASING.md).

## [0.1.0] - 2026-10-20

### Added

- Baseline release. The first tag, and the anchor every later version is
  derived from; earlier history is not reclassified.
- Version tracking itself: one declared constant, two footer slots, this
  changelog, and `scripts/release.mjs`.
- The site as shipped at this tag: 1,025 Pokémon across 25 pages, 919 moves,
  314 abilities, 1,346 graph entities, and the colour / cry / algorithm
  sections described in `README.md`.
