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

---

## Part 4 — Round 2: the ledger, extended

A second human-play session, with a tighter protocol: two boards played in
parallel. On board A the human clued and a **blind LLM guesser** (given only the
words and the clue, never the key) adjudicated each clue; on board B the AI
clued against the human guessing blind, with the key committed up front as a
SHA-256 hash. Outcome: the human's board closed **9/9 in 6 turns** (3 misfires,
assassin never touched); the AI's board died **8/9 with an assassin hit on
turn 4**. The distribution of damage is the headline: the first twelve guesses
across both boards went twelve-for-twelve red — every casualty of the round,
including the assassin, landed from turn 3 onward.

### New lessons (7–13)

| # | Lesson | Illustration |
|---|--------|--------------|
| 7 | **Exemplar asymmetry.** An instance-clue ("Thunderball" for BOND + NOVEL) asks the guesser to climb *up* to type-memberships, but salience radiates *down* into the work's vivid contents. Title-clues are only safe as **content bundles**; meta-attributes ("it's a novel") route through the creator instead. Dual of lesson #3. | Blind guesser on `Thunderball 2`: POOL (shark pool) 0.62 and CASINO 0.58 both outranked the intended NOVEL at 0.30. `Fleming 2` was the clean counterfactual. |
| 8 | **Confidence is per-edge, never pooled.** "Bond novel" felt like one unbreakable unit to the cluer, but the guesser cashes each target separately; the BOND edge's 0.95 transferred nothing to NOVEL's 0.30. 🟢 *The engine already models this correctly (`leadOwn` requires each intended card to clear `maxNonOwn + margin` individually) — first case where the engine is the corrective model for a human bias.* | Same play as #7. |
| 9 | **Clue debt.** A misread clue costs more than its fizzled turn: the stranded target keeps radiating *phantom* candidates under the wrong frame in later turns. | Thunderball's unfound NOVEL made CASINO (the film's brightest unrevealed content word) a bonus-guess magnet — burned a neutral a full two turns later, after a perfect `Carpathia 2`. |
| 10 | **Referent collision.** "You'll either know it or you won't" has a third branch: *you'll know a different one.* Unknown references fail **closed** (blank → cautious forced guess); colliding references fail **open** (wrong referent → confident wrong guesses). Fame-gating (`commonnessBias`) and ambiguity-gating are different tests. | `Nicolette 2` meant Ray Nicolette (Elmore Leonard). The blind guesser resolved to *Aucassin et Nicolette*, took NOVEL (right, wrong reason) then STAR via the chantefable's star-song — blue. RAY appeared nowhere in its ranking. |
| 11 | **The endgame spiral.** Clue ordering is common knowledge: spymasters sequence best-first and lower standards late ("if I thought it was a great clue I would've given it earlier"); guessers know it and lower acceptance thresholds late ("last clues are always a little stretched"). Each side's relaxation licenses the other's — the endgame is structurally the high-risk phase, so that is when the assassin berth must *widen*. | 12/12 red on early guesses; TOOTH, BOX 💀, STAR, CASINO all from turn 3 on. |
| 12 | **Generation failure ≠ selection failure.** Under endgame pressure humans *satisfice retrieval*: the first workable bridge wins, unexamined alternatives never surface. Exhaustive candidate generation is the engine's structural advantage; judgment over candidates is the human's — the seam is the advisor-bot thesis. | `Nicolette 2` was "literally the best I could come up with"; `Bradbury 2` (Ray Bradbury: RAY + NOVEL, both one-hop, high fame, low collision) existed and was never generated. |
| 13 | **Completion entropy (the orphan modifier).** A compound-completion clue is safe exactly when the completion mass concentrates on the target: "manta" has essentially one continuation. It is dangerous when the head is shared — "engine ___" spreads over {box, hood, room, block}, and FOSSIL splits between the compound (fuel) and category members (tooth, bone). | `manta 1` → RAY at 0.95, tapped without hesitation; contrast failures D and E below. |

### Where the AI failed (again)

| # | Failure | Root cause |
|---|---------|-----------|
| D | **`FOSSIL 2` (DINOSAUR + GAS) delivered a blue TOOTH.** The human guessed member-first: "dinosaur tooth for fossil — nothing else is close"; GAS (via *fossil fuel*) never registered. | Corpus co-occurrence ("fossil fuel") ≠ human free association (fossil → dinosaur, bone, tooth). A category clue promises **members** (lesson #3, violated by the AI this time). Direct evidence for plan 2.7. |
| E | **`ENGINE 2` (HOOD + GAS) hit the assassin.** The human never rated HOOD ("vaguely mechanical"), actively *constructed* the compound "engine box," and tapped BOX. | Failure A recommitted, with a process record: the pre-round red-team had named "gearbox for CAR/ENGINE clues" inside BOX's banned clue-space, while a different agent in the same review recommended `ENGINE 2` as a tightening — and at give-time the suggestion was inherited without re-running the assassin gate. Guessers don't just receive collocations; they **manufacture** them in both directions. |

### What held

- **Human guess discipline, six for six:** banked at exactly the promised number
  every turn; the turn-1 BELL flirtation was rejected in favor of SWITCH (the
  pre-round red-team had priced that contest ~70/30 the same way).
- **Pre-emptive halo vetoes:** QUICKSAND (BOOT + SINK) killed because the
  viscous-goo frame drifts toward the KETCHUP assassin — the assassin-first
  check, run live; WADERS killed after self-detecting that neutral STREAM
  out-glows SINK in the fly-fishing frame — failure B caught *before* the clue
  was given. Risk pricing stayed proportional: Mountie was played through a
  faint ketchup-chips brush (0.22, far below the 0.85/0.72 targets).
- **The capitalization convention carried signal in both directions:** the
  human's casing was convention-perfect all round (lowercase `limestone`/`manta`,
  mixed-case `Thunderball`/`Carpathia`/`Mountie`/`Nicolette`), and the blind
  guesser used the *lowercase* of `manta` to kill the Black Manta → COMIC trap.
- **Primacy:** the cluer's first-listed target delivered 6/6; every misfire
  lived in the second slot or the bonus. "Core + stretch" is real, and the core
  is often exactly one word.
- **The blind guesser independently reproduced the shipped clicker:** its bonus
  refusal on `LIMESTONE 2` restated the `CLIFF_*` triple condition (steep drop +
  absolutely weak + blurred alternatives) nearly verbatim — and after the CASINO
  burn it *recalibrated within the game*, refusing the next leftover hunt as
  negative-EV. The bot clicker has no such cross-turn adaptivity (see 2.12).

### Engineering plan, extended

**2.8 Give-time assassin re-gate. 🟢 (implemented: `passesAssassinGate` re-asserted at emission; ramped-floor retry never bypasses the berth)** Any clue carried over from an earlier
plan, suggestion, or cached candidate list must re-run the full assassin/halo
gate against the *current* board at the moment it is given. When two analyses
conflict, the assassin-negative verdict wins unconditionally — the loss function
is asymmetric (failure E).

**2.9 Completion-entropy term. 🔴** Score `P(completion | clue word)` in both
directions ("X box", "gearbox") from a bigram/collocation source and penalize
clues whose high-probability completions land on non-own board words; reward
orphan modifiers whose mass concentrates on the target. Would have red-flagged
ENGINE and FOSSIL and green-lit manta (lessons 13, failures D/E). Natural home:
the semantics backend, beside `commonness()`.

**2.10 Referent-ambiguity sweep. 🔴** Reference entries in
`properAssociations` / semantic maps should store **rival referents** per clue
word and *exhaustive* content lists per referent (Thunderball ⊃ pool, casino,
shark…), so a title-clue collides with its own board-resident contents — and
with its rivals' contents — at scoring time (lessons 7, 10).

**2.11 Endgame calibration. 🟡 (spymaster side implemented: one-way `ENDGAME_BERTH_RAMP` on the berth floor + endgame-sliced `dangerNextRate`; clicker/advisor stretch-prior modeling remains)** Spymaster: scale the assassin berth *up* as the
board empties and own-words dwindle. Clicker/advisor: model the human stretch
prior — late clues get looser guesses — and require an explicit
assassin-candidate check before any late stretched guess (lesson 11).

**2.12 Within-game leftover reframing. 🔴** Track leftover targets per clue;
when a leftover's top candidate bounces (POOL blue → later CASINO neutral),
downgrade the whole frame's bonus-guess EV rather than just the burned word
(lesson 9). This is the cross-turn adaptivity the blind guesser showed
naturally.

**2.13 Hypernym candidates for unknown references. 🔴** Guesser-side: an
unrecognized proper-noun clue should generate type-membership candidates
(hypernyms: "is a novel", "is a Bond title") *below* content candidates —
robustness against human exemplar clues (lesson 7).

**Sequencing:** 2.8 and 2.11 are near-free gating/scaling changes inside
existing scoring paths — do them first. 2.9 needs a collocation source and can
piggyback on the `commonness()` backend. 2.10 and 2.13 are curation and
map-schema work (`npm run bots:map` output format). All remain
strategy/semantics-layer changes: `npm run bots:parity` unaffected, run it
anyway, and extend `bots:analyze` with an endgame-sliced `dangerNextRate` so
lesson 11 is measured, not vibed.

**Round-2 through-line:** both catastrophic failures — the human's STAR and the
AI's BOX — were *the same error at different layers*: projecting your own
salience (an association, a compound, a referent) onto a mind that had filed the
world differently. The assassin gate, the completion-entropy check, and the
referent sweep are all the same defense: before you speak, ask what else these
sounds could mean to someone who isn't you.

---

## Part 5 — Round 3: the number is a promise, the referent is a contract

Third session, protocol upgrades: a live colored key-card board (artifact,
updated per turn), give-time re-gating practiced on every AI clue, and — after
a mid-round dispute — an explicit **calibration instruction** for the blind
guesser: median strong-human retrieval only, specialist-trivia edges flagged and
downweighted. Outcome: the human's board died **8/9, assassin on turn 4**
(`Tinder 3` → DATE ✓ MATCH ✓ **GOLD 💀** — Tinder Gold, the app's premium
tier); the AI's board ran **7/9 clean in four clues** (MYTH 3/3, POKER 2/2,
RECITAL 2/2), whiffed `REMOVAL 2` (0/2, neutral), then **forfeited its ending
by leaking its own remaining targets in table-talk**.

### New lessons (14–20)

| # | Lesson | Illustration |
|---|--------|--------------|
| 14 | **Knowledge-depth calibration.** A simulator (or embedding backend) over-retrieves: its within-referent fame gradient inverts a human's. "For most humans, knowing who Hooke is *at all* is the deep cut." Association edges need a *human-penetration* weight — fame of the **fact**, not just commonness of the word. This is why curated tables can beat embeddings at guessing: the bots are the encyclopedic player. | `Hooke 3` (SPRING/FORCE/GENIUS): the uncalibrated guesser took BARK 0.55 — *Micrographia*'s cork→"cell" coinage — an edge that exists only in an encyclopedic mind. GENIUS, the correct human third, sat sixth at 0.25. |
| 15 | **Table-talk is part of the clue — in both directions.** Disclaimers modulate depth-seeking: "you know it or you don't" reads as *the referent is the gate* to a knowledge-poor guesser and as *a target is a deep cut* to a knowledge-rich one — the listener's depth selects the reading. And the spymaster's chatter is bound by the same information discipline as the clue itself. | The YKIOYD framing steered the Hooke guesser into deep-content spelunking; two turns later the AI casually named its two remaining words in commentary and voided its own endgame. |
| 16 | **The concreteness gradient, fourth datapoint.** Parts and mechanism outshine function-output, completing the series: contents > meta-attributes (Thunderball, Hooke), members > compounds (FOSSIL), parts/mechanism > what-it-computes (sundial). One gradient: perceptual concreteness wins. Implementable as a concreteness prior on edges. | `sundial 2` (RAY + DATE): the guesser took RAY 0.80 then POLE 0.55 — *the gnomon is a pole in the ground* — while DATE (what the device tells you) sat fourth at 0.15. |
| 17 | **Negative-space inference can invert.** Lesson #5's guesser-side power tool — "the clue they didn't give is information" — misfires when the guesser misattributes *why* the alternative was rejected, converting a target into a repellent. | The sundial guesser reasoned "they said *sundial*, not *Egypt*, because Egypt would splash onto DATE (date palms), GOLD, SCORPION" — and demoted the actual target DATE. |
| 18 | **The number is a promise, and it arms the residual halo.** When N exceeds the targets the *guesser* can see clearing the bar, the excess promise is spent on the clue's tier-2 halo, brightest-first, whatever color it is. Corollary: never set N by inventory ("I have 3 words left") — both assassin hits across rounds 2–3 came from whole-remaining-hand numbers. | `Dumbledore 3` exactly covered TEACHER/SPELL/GENIUS, so GOLD-at-0.35 (Flamel, alchemy) stayed safely *below* the promise line. `Tinder 3` had two visible targets (FILE scored 0.03), so the promise dredged GOLD-at-0.60 *above* it: "there is no other viable third target, and this spymaster's proper-noun clues have been precise." |
| 19 | **The referent knows more than you.** A reference clue commits you to *all* of the referent's famous contents — including the ones outside your knowledge, which is demographically gated (a 20-years-married cluer had never heard of Tinder Gold; the guesser judged it pub-quiz-level). The content sweep must therefore be external, not introspective. | Tinder Gold, assassin, guess three. The `npm run bots:map` machinery — an LLM-curated content list — flags it in milliseconds; the strongest human-facing advisor argument yet. |
| 20 | **Frame monopolization (guesser-side first-instinct gone wrong).** The first frame that fires monopolizes the search; the *detectable* signal that it's the wrong frame is uniform weak fit — every candidate mediocre, none clean. The cluer's own alarm ("I worry I'm missing the point… but") fired and was overridden. Procedure, not vibes: when the current frame's best fits are all sub-threshold, enumerate the clue's other senses and re-score before guessing. | `REMOVAL 2` (mole removal, cast removal — medical frame): the guesser's "destruction/removal" frame (torch it, sink it, cast it off) arrived first and won; SINK (neutral) mercifully ended the turn before TORCH (blue). The guesser even touched CAST — right word, wrong path — and discarded it. |

### Where each side failed (F–G) and what held

- **F (AI): `REMOVAL 2` bet on fixed collocations against a frame-constructing
  guesser.** The sequencing logic (clear ORGAN and SUIT first so the medical
  reads are unique) was correct *inside* a frame that never fired. Failure D's
  root cause again, mirrored: in round 2 the AI over-trusted its own compound
  ("fossil fuel"); here it under-modeled the guesser's constructed frame.
- **G (AI): the table-talk leak** — lesson 15 enforced on its author, two turns
  after writing it.
- **What held:** Dumbledore was the round's masterclass — the stranded GENIUS
  debt cleared by *bundling into a fresh tight frame* (plan 2.12 from the
  cluer's side), the attribute leg finally cashing because the referent's
  board-resident contents came along with it, and the number sized exactly to
  the visible targets, which is what kept the assassin below the promise line.
  The human's casing stayed convention-perfect (`sundial` lowercase, `Tinder`
  capitalized). The blind guesser's within-game recalibration compounded:
  it declined every leftover chase, explicitly citing its own BARK and POLE
  burns as evidence its frame-model of this spymaster was unreliable.
- **Scoring philosophy (the cluer's caveat):** "we get the words we get —
  sometimes there are no good clues." Judge line *selection* against the lines
  the board actually offered, not against a platonic clue.

### Engineering plan, extended (2.14–2.19)

**2.14 Fame-of-fact weighting. 🔴** Extend 2.7: weight association edges by
human penetration of the *fact*, not just corpus strength or word frequency.
Guesser-side critical (lesson 14); the table backend's advantage, formalized.

**2.15 Number-inventory guard. 🟢 (implemented: `PROMISE_FLOOR` tail trim — never promises an absolutely-weak card, never trims below 1, desperate win attempts exempt)** The spymaster must not set N above the
count of targets clearing the guesser-visible strength bar; endgame stragglers
get deferred or singled, never folded into an inflated N (lesson 18 — would
have blocked both `Tinder 3`→GOLD and round 2's whole-hand `ENGINE 2`→BOX).

**2.16 External referent-content sweep. 🔴** Reference clues validate against
externally curated content lists (the `bots:map` LLM pipeline), including
product/brand tiers and rival referents (merges with 2.10) — never against the
cluer's internal knowledge alone (lesson 19).

**2.17 Sense-enumeration in the clicker. 🔴** Split a clue into senses/frames,
score candidates per-sense, and trigger a frame switch when the current frame's
best fits are uniformly weak (lesson 20). Surfaces in the advisor as "your
frame may be wrong," the procedural form of the human's ignored alarm.

**2.18 Concreteness prior. 🔴** Boost parts/members/contents edges over
function/attribute/compound edges in `scoreClue` and the clicker (lesson 16
completes the gradient begun in lessons 7 and 13).

**2.19 Board-difficulty normalization. 🟢 (implemented: `boardBestLead` ceiling + `ceilingUtilization` with shared boards per index, one per color, full-board clue legality)** In `bots:analyze`, score chosen
clues relative to the best line an exhaustive search found for that board, so
per-persona stats separate bad *selection* from bad *luck* (the cluer's caveat).

**Round-3 through-line:** the number is a promise and the referent is a
contract — both bind you to things you cannot see. The promise spends whatever
halo you didn't audit; the contract includes contents you never knew existed.
Every defense in this document converges on outsourcing that audit: to the
assassin-first sweep, to an external content list, to a second frame, to a
teammate — to anything that isn't your own certainty.
