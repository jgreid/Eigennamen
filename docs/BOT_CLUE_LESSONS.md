# Bot Clue Lessons — Human Play → Engine Improvements

This document distills a set of lessons about how a strong human plays the
clue/guess game (Codenames-style) and turns them into a concrete, prioritized
plan for improving the AI bots in [`server/src/bots/`](../server/src/bots).

It is deliberately grounded in the existing code. Several lessons are **already
implemented** in [`strategies/spymasters.ts`](../server/src/bots/strategies/spymasters.ts)
— the spymaster already computes an assassin berth and a clarity gap, so in
bot-vs-bot play it structurally avoids the worst mistakes. The value here is in
naming the *remaining* gaps precisely and pointing at the exact hooks to change.

Legend used throughout: 🟢 already in code · 🟡 partial · 🔴 missing.

---

## Part 1 — The Ledger

### How a strong human plays (the offense)

| # | Lesson | Illustration |
|---|--------|--------------|
| 1 | **First-instinct primacy.** The first honest read is usually right; elaborate reinterpretation is often noise dressed as rigor. | A correct first read (two obvious targets) reasoned *away* in favor of a cleverer, wrong reading. |
| 2 | **Core + stretch.** Lock a tight core, spend *at most one* word on a gamble. A clue number is often `core + 1 gamble`, not `N equally-solid`. | A "3" that was a solid 2-word core plus one deliberate stretch. |
| 3 | **"Related-to ≠ is-a."** A category clue means *members* of the set, not *attributes* of it. | `ANATOMY` → spine/organ, never "things that *have* a spine"; `ICE` → "things literally *made of* ice." |
| 4 | **Proper-noun scene anchoring.** Don't clue a category — clue a *specific vivid scene* and hide its contents on the board. The specificity resolves forks. 🟢 *(implemented: the clue-capitalization convention + `PROPER_ASSOCIATIONS` — a mixed-case clue like "Cinderella" bundles GLASS + PRINCESS + BALL as one scene, fame-rated so `commonnessBias` keeps references within the guessers' knowledge)* | `KHONSU` → TEMPLE (not the generic NIGHT); a single painting bundling three of its elements. |
| 5 | **Negative space as signal.** *Which* synonym you choose steers the guesser; the clue you **didn't** give is information. | `CAVALRY` chosen over `CHESS` to steer a guesser off a same-category opponent word (KNIGHT). |
| 6 | **Cross-domain bridges.** Bundle words from *different* silos under one concrete image. | `TUXEDO` = penguin (cold) + maestro (music). |

### Where the AI failed (the diagnosis)

| # | Failure | Root cause |
|---|---------|-----------|
| A | **Clue pointed at the assassin.** Aimed at two intended words; the *brightest* association of the clue was actually the assassin. | Salience ranked from the model's weights; the human's top association differed — and the gap landed on the death word. |
| B | **Clue pointed at a neutral over a target.** A neutral bystander outranked one of the intended words. | Theme-membership ≠ brightness. The clue frame made a bystander the brightest bulb. |
| C | **Under-clue.** Two timid single-word clues where one safe two-word bridge existed. | Over-correction from (A), plus a tendency to cluster *within* a theme instead of hunting cross-domain bridges. |

### The single principle under all of it

**The guesser's mind is the real board.** A strong human models which association
lights up brightest *in the other person's head* — including that person's
idiosyncrasies. A naive engine models the word graph and assumes its own
salience ranking is universal. Every failure above is that gap. Two defenses
survive contact:

- **Assassin-first halo check** — "a clue is only as good as its worst plausible
  misfire." Locate the death word first, then verify no clue's *brightest
  spillover* touches it. This raises the floor from "instant loss" to
  "lost a turn."
- **Prefer universal salience** — anchor on *shared* culture/knowledge, not a
  personal or niche sub-association. Robust clues live in common knowledge.

---

## Part 2 — Engineering plan

### Spymaster — [`strategies/spymasters.ts`](../server/src/bots/strategies/spymasters.ts)

**2.1 Assassin halo → persona-independent hard floor. 🟢 (implemented: `ASSASSIN_BERTH_FLOOR`)**
`scoreClue` already drops intended cards within
`berth = margin * 2 * style.assassinCaution` of the assassin, and `leadOwn`
requires each intended card to clear `maxNonOwn + margin` (which includes
`maxAss`). But the berth is scaled by `assassinCaution`, so a reckless persona
(e.g. The Daredevil) trims the wall — the exact mindset behind failure (A).
**Change:** split into (a) a *hard, persona-independent* floor that never lets
the weakest intended card sit within a fixed ε of `maxAss`, plus (b) the existing
*soft, tunable* `assassinPenalty`. Aggression/recklessness tunes the *number*,
never the assassin gate.

**2.2 Robustness / anti-idiosyncrasy term. 🟢 (implemented: `AMBIGUITY_WEIGHT` + `RARITY_WEIGHT` × `commonnessBias`; frequency prior via `SemanticBackend.commonness`)**
Add a term to `score` in `scoreClue` that penalizes clues which are (a)
rare/obscure (a word-frequency prior — downweight deep cuts) and (b) *ambiguous*
— near many **unrelated** board words. A cheap proxy for (b) from values already
computed: penalize a high absolute `maxNonOwn` even when the margin clears, i.e.
a clue whose halo is "hot." Expose as a `commonnessBias` knob in `StyleParams`;
experts / The Sharpshooter weight it high (legible clues), The Maverick low
(off-kilter).

**2.3 Cross-domain bridge generation. 🟢 (implemented: pair-centroid `nearest()` queries over the top-`PAIR_TOP_CARDS` densest own cards)**
`generateClueCandidates` draws `nearest()` from the *full-own centroid* plus
per-card neighbours. The full centroid is dominated by the largest own-cluster
and misses 2-card bridges across silos. **Change:** also generate candidates near
each **pair / small-subset centroid** of own cards (bounded: top-K densest own
cards, pairs only), which is what surfaces a word sitting between two words in
different domains. Raises `avgNumber` / `deliveryRate` without leaking.

### Clicker — [`strategies/clickers.ts`](../server/src/bots/strategies/clickers.ts)

**2.4 Confidence-gap stopping (core + stretch). 🟢 (implemented: `CLIFF_*` constants)**
`makeGreedyClicker` stops at the clue `number` or when
`bestScore < confidenceFloor`. Add a **relative cliff**: stop when the next
card's score falls more than a fraction δ below the *last taken* card's score —
"tap the confident core, stop before the stretch" (lesson #2, guessing side).
*Calibration learned in self-play:* the raw relative test eats genuinely-intended
tail cards on cold boards (a margin-sound spymaster's third card can score ~0.3
absolute yet be near-certain), so the shipped cliff fires only when the next card
is **steep** below the last take AND **weak** in absolute terms AND **blurred**
into its alternatives — the no-information state a clue never promised.

**2.5 Opportunistic bonus — the disciplined "+1". 🟢 (implemented: `BONUS_*` constants, gated by `aggression`)**
Neither greedy nor cautious ever takes the `number + 1` bonus guess. Add it *only*
when the top remaining card clears both a high absolute floor and the field by a
wide margin, gated by `aggression`. This is the calibrated version of a human
stretch: take the bonus when it is *tighter than the core*, not merely plausible.

**2.6 First-instinct = argmax. 🟢** Correct at temperature 0; leave it.

### Semantics — [`semantics/`](../server/src/bots/semantics) (highest leverage)

**2.7 Human-association-calibrated backend. 🟡 (partial: rank-based `commonness()` frequency prior in the vector backend, disabled for alphabetical Numberbatch files; the offline human-association eval remains open)**
Failures (A) and (B) are ultimately *"backend relatedness ≠ human salience."*
The default `lexicalBackend` (character-bigram overlap) is semantically blind.
Plan: (a) ensure the embedding backend prefers **ConceptNet Numberbatch** (see
[`docs/BOT_EMBEDDINGS.md`](BOT_EMBEDDINGS.md)), which is partly human-derived;
(b) add an **offline eval** scoring backend relatedness against a human
word-association dataset (e.g. Small World of Words), and pick/blend the backend
that best matches *human association*, not raw co-occurrence. Root cause, not a
symptom.

### Diagnostics — [`harness/analyze.ts`](../server/src/bots/harness/analyze.ts)

The harness already tracks `assassinRate`, `leakRate`, `misfireRate`, `ambition`,
`clarity`, `assassinArgmax`, `deliveryRate` and an under-cluing gap. Add:

- **`dangerNextRate` 🟢** — fraction of clues whose *best non-own* card is an
  **opponent/assassin** (not a harmless neutral). The failure-(A) metric: how
  often the brightest spillover is lethal rather than merely wasteful.
- **`robustness` 🟢** — average frequency/ambiguity of chosen clue words (from
  2.2), to catch idiosyncratic clues. Per clue: `(commonness + (1 − heat)) / 2`.
- **`overReachRate` 🟢** (guessing side) — how often the clicker guessed beyond
  the safe core and missed (validates 2.4 / 2.5). A miss on the *first* guess is
  a misread, not over-reach — the record must have a banked core.
- **New `detectGaps` flags 🟢** for the above thresholds, surfaced by
  `npm run bots:analyze` alongside the existing per-persona flags.

---

## Part 3 — Sequencing & guardrails

1. **Backend eval + human-association calibration (2.7)** — root cause; do first,
   it re-grades everything downstream.
2. **Analyze metrics (Part 2, Diagnostics)** — instrument *before* tuning so
   changes are measured, not vibed.
3. **Spymaster hard assassin floor + robustness term (2.1, 2.2)** — the
   failure-A / idiosyncrasy fixes.
4. **Bridge generation (2.3)** and **clicker discipline (2.4, 2.5)**.
5. **Persona re-tune** via [`personas.ts`](../server/src/bots/personas.ts) /
   [`presets.ts`](../server/src/bots/presets.ts) against the new metrics.

**Guardrails**

- All changes live in the strategy/semantics layer, so `npm run bots:parity`
  (engine-vs-Lua game-op parity) is unaffected — but run it anyway.
- Add unit tests beside the existing deterministic ones in `analyze.ts` for each
  new pure function / metric.
- Every scoring change flows through the seeded `ctx.rng`, so regressions are
  reproducible via `npm run bots:analyze --seed <seed>`.

**Through-line:** the assassin gate must be a hard, un-tunable floor; everything
else is calibration; and the whole edifice is only as good as how well the
semantic backend matches a *human's* sense of which word is brightest.
