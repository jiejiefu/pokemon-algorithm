# cry-studio Phase 2 — Structured Random Compose

**Status:** Phase 1 shipped in `9d986e1`; Phase 2 not started. Listen to 10+ random
patterns before deciding.

## Trigger

Do Phase 2 only when one of these holds:

- after 10+ presses of 隨機作曲, the pattern still reads as 「每拍換物種」 or the timbre
  jumps are more noticeable than the groove;
- five minutes of listening still ends in fatigue rather than a loop you can leave on;
- the user explicitly asks for it.

Phase 1 fixed the mix (darkness, space, bus glue). Phase 2 is about **structure**,
not tone — do not reopen the FX defaults to compensate.

## Scope

Only `assets/js/cry-seq-pattern.js`, only `randomPattern()`:

1. **One cast per voice per pattern.** Bass prefers low-pitched species, lead
   mid/high, chords mid. No `pick(cast)` per note, so a voice cannot change species
   between beats.
2. **Monophonic per voice.** A new note on the same voice must not overlap the
   previous one; shorten the previous note or skip the new one.
3. **Phrase shape.** Eight bars of call/response, two bars of rest at the end of the
   phrase; the repeat changes only the fill.
4. **One drum groove.** Build an eight-bar groove once and vary only the fill at the
   phrase end, instead of re-rolling every bar.

## Out of scope

- Do not change the `#s=` share format. `cast` is already serialized; only the way
  `randomPattern()` fills it changes.
- Do not touch `cry-studio-pro.html` or `cry-seq-pro-*`.
- Do not change the Phase 1 engine graph, envelopes or `DEFAULT_FX`.

## Verification

- `node --input-type=module --check < assets/js/cry-seq-pattern.js`
- `node scripts/check_all.mjs --only=nav --only=color`
- A/B by ear against `9d986e1`. Revert that commit to hear the Phase 1 baseline.

Known unrelated reds in the color group: palette #1025 is missing from
`color_palettes.json`, and `AGENTS.md` is over its size ceiling. Neither is caused
by this page.
