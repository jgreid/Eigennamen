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

**2.7 Human-association-calibrated backend. 🟡 (partial: rank-based `commonness()` frequency prior in the vector backend, disabled for alphabetical Numberbatch files; the offline human-association eval is SHIPPED — `npm run bots:eval -- --norms <file>` (harness/evalAssociations.ts) grades every backend tier against a SWOW/USF-format dataset by rank agreement + board-shaped retrieval; open: acting on its verdict — backend blending/selection from the measured scores)**
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

**2.9 Completion-entropy term. 🟡 (Phase 2 shipped the mechanism: `SemanticBackend.collocation` channel, `clueRetrieval = max(relatedness, collocation)` on both sides of the clue channel — spymaster margins, clicker/advisor ranking, harness yardstick — and `bots:map` v2 emits per-edge collocation; open: collocation data for the baked default-list table)** Score `P(completion | clue word)` in both
directions ("X box", "gearbox") from a bigram/collocation source and penalize
clues whose high-probability completions land on non-own board words; reward
orphan modifiers whose mass concentrates on the target. Would have red-flagged
ENGINE and FOSSIL and green-lit manta (lessons 13, failures D/E). Natural home:
the semantics backend, beside `commonness()`.

**2.10 Referent-ambiguity sweep. 🟡 (Phase 3 shipped the mechanism: `PROPER_RIVALS` — rival referents whose weighted contents pull at weight × rival fame through the table's reference reading, mirrored in v2 map `rivals` and emitted by the `bots:map` sweep; open: rival curation across the full baked table)** Reference entries in
`properAssociations` / semantic maps should store **rival referents** per clue
word and *exhaustive* content lists per referent (Thunderball ⊃ pool, casino,
shark…), so a title-clue collides with its own board-resident contents — and
with its rivals' contents — at scoring time (lessons 7, 10).

**2.11 Endgame calibration. 🟢 (spymaster side: one-way `ENDGAME_BERTH_RAMP` on the berth floor + endgame-sliced `dangerNextRate`. Clicker side: `ENDGAME_STRETCH_CEILING`/`ENDGAME_STRETCH_SEPARATION` bank a weak, field-blurred guess beyond the first when ≤ 3 own cards remain (`BotClickerView.ownRemaining`, public scoreboard data), and the number+1 bonus floor rises by `ENDGAME_BONUS_BUMP` — calibrated so margin-certified bot clues never trip it (self-play trajectories unchanged); the advisor's late-stretch warning covers the advisory seat)** Spymaster: scale the assassin berth *up* as the
board empties and own-words dwindle. Clicker/advisor: model the human stretch
prior — late clues get looser guesses — and require an explicit
assassin-candidate check before any late stretched guess (lesson 11).

**2.12 Within-game leftover reframing. 🟡 (Phase 4.3 shipped the memory: `BotContext.memory` — promised-vs-taken per clue, threaded by the harness loop and a live per-room tracker in `botController` — with the clicker's `DEBT_BOOST` for owed unbounced frames and a hard zero for bounced ones; open: the spymaster style profile from lesson 27 and duet support)** Track leftover targets per clue;
when a leftover's top candidate bounces (POOL blue → later CASINO neutral),
downgrade the whole frame's bonus-guess EV rather than just the burned word
(lesson 9). This is the cross-turn adaptivity the blind guesser showed
naturally.

**2.13 Hypernym candidates for unknown references. 🟢 (Phase 3: `PROPER_HYPERNYMS` type-level readings at `HYPERNYM_SCORE` 0.55 — below every content match, above the promise floor; the clicker reaches NOVEL from "Thunderball" without knowing the plot)** Guesser-side: an
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

**2.14 Fame-of-fact weighting. 🟡 (Phase 2 shipped the channel: per-edge `penetration` in v2 maps → `SemanticBackend.edgeInfo` → `FAME_OF_FACT_WEIGHT` penalty on the weakest-penetration intended edge; open: penetration curation in the `bots:map` prompt and the baked table)** Extend 2.7: weight association edges by
human penetration of the *fact*, not just corpus strength or word frequency.
Guesser-side critical (lesson 14); the table backend's advantage, formalized.

**2.15 Number-inventory guard. 🟢 (implemented: `PROMISE_FLOOR` tail trim — never promises an absolutely-weak card, never trims below 1, desperate win attempts exempt)** The spymaster must not set N above the
count of targets clearing the guesser-visible strength bar; endgame stragglers
get deferred or singled, never folded into an inflated N (lesson 18 — would
have blocked both `Tinder 3`→GOLD and round 2's whole-hand `ENGINE 2`→BOX).

**2.16 External referent-content sweep. 🟡 (Phase 3: the `bots:map` prompt now mandates the "referent knows more than you" sweep — exhaustive contents incl. scenes and brand tiers, plus rivals; the ledger's live cases are curated in the baked table (Thunderball ⊃ POOL/CASINO/SHARK, Tinder ⊃ GOLD, GoldenEye, Hooke @ fame 0.35); open: the exhaustive sweep across all ~95 baked references)** Reference clues validate against
externally curated content lists (the `bots:map` LLM pipeline), including
product/brand tiers and rival referents (merges with 2.10) — never against the
cluer's internal knowledge alone (lesson 19).

**2.17 Sense-enumeration in the clicker. 🟢 (Phase 4.1: `resolveClueFrame` — the case convention makes senses enumerable, so the flipped-case probe scores the other sense; switch on the uniform-weak tell (`FRAME_DOUBT_FLOOR`) when the alternate clears `FRAME_SWITCH_BAR` on 2+ candidates; shared by clicker and advisor, which also says so via the frame-doubt warning)** Split a clue into senses/frames,
score candidates per-sense, and trigger a frame switch when the current frame's
best fits are uniformly weak (lesson 20). Surfaces in the advisor as "your
frame may be wrong," the procedural form of the human's ignored alarm.

**2.18 Concreteness prior. 🟡 (Phase 2 shipped the channel: per-edge `kind` in v2 maps → `EDGE_ABSTRACTNESS` gradient scaled by `CONCRETENESS_WEIGHT` in `scoreClue`; open: kinds for the baked table and the Phase-3 proper-contents restructure)** Boost parts/members/contents edges over
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

---

## Part 6 — Round 4: both boards survived

Fourth session, same two-board protocol — and the first round in which **nobody
died**. The human's board closed **9/9 in 4 turns** (one blue, assassin never
threatened) — their best cluing of the series, with a visible learning curve
*inside* the round: a frame-momentum misfire on turn 1, then three straight
clean turns applying the ledger in real time. The AI's board closed **9/9 in
7 turns with zero misfires** — the slow-clean extreme of the delivery/tempo
tradeoff — after its pre-round red-team killed the drafted opener (the audit's
own guesser simulation walked into a blue card on the promised third slot:
`PIE 3`'s tail wasn't weak, it was *contested* — chicken pot pie is a pie;
whipped cream is a topping). The shipped Phase-1 discipline was exercised live:
promise-floor reasoning at the frame level, give-time re-gating on every clue,
and the risky-multi-goes-late sequencing rule.

### New lessons (21–28)

| # | Lesson | Illustration |
|---|--------|--------------|
| 21 | **Frame momentum.** A 2+1 mixed-frame clue doesn't deliver 2+1 — it delivers the 2, then the *majority frame's continuation*, whatever color that is. Each correct guess strengthens the frame and raises the conditional confidence of the frame's own next member. Mixed frames are safe exactly when each frame's board-best is yours. | `assault 3` (CHARGE, POLICE, SWING): the guesser took CHARGE, POLICE, then CLUB — *"the crime trio is all but confirmed and CLUB completes it; conditional confidence rises well above its raw 0.50."* SWING (the off-frame leg) sat fifth. Contrast `penguin 3`: three frames, each with a red board-best — 3/3. |
| 22 | **Granularity asymmetry.** The cluer's expert-granularity veto can pass on a distinction the guesser cannot perceive. Halo sweeps must run at *folk* granularity. | The cluer saw CLUB and dismissed it — "that's battery, not assault." Legally correct, invisible from the other side of the table. (Bot note: corpus-trained edges blur legal categories — model coarseness is *protective* here.) |
| 23 | **Friendly fire: sweep your own words too.** The halo audit checks non-own threats, but an own *non-target* outranking an own target scrambles the plan at zero material cost — the guess "succeeds" while the intended target strands and a later clue's pair breaks. Also: acronym casing is a frame *amplifier*. | `IT 2` (TAG, CRASH): the guesser took APPLE — Apple-the-company, primed by the all-caps acronym signal — and CRASH. 2/2 "delivered," wrong two: TAG stranded, the planned `PIE 2` broken. |
| 24 | **Double-coding: why debt-bundling works.** Folding a stranded target into a new frame doesn't just clear the debt — it *disambiguates the contested slot*, because two independent clue-paths converging on one card beat one path each at two cards. | `tree 2`: SWING (0.78) vs STICK (0.66) was close on tree-frame strength alone; the stranded `assault` target broke the tie — *"both readings say it's ours. STICK can't say that."* |
| 25 | **Negative-space inference is reliable in proportion to how canonical the rejected alternative is.** Round 3's sundial inversion and round 4's network save are the same mechanism with opposite outcomes. | `network 2`: SPY at 0.58 vs SWITCH at 0.62 — held by *"a spymaster holding SPY had RING as the tighter clue; network is exactly what you say for SERVER + SWITCH."* RING is canonical; sundial's "Egypt" counterfactual never was. |
| 26 | **The singles doctrine (number-conditional narrowness).** At N=1 the optimal clue property inverts: breadth clues need commonness (the guesser must generalize), a single needs only *narrowness* — a rare, near-definitional word with an empty board halo beats a common compound trailing laterals. Rarity costs only when the guesser must spread the clue. | The cluer's own critique of `BOOK 1` (spine): "I'd give *vertebrae* — less likely to trigger on other words." Applied live twice: `GRAFFITI 1` over PLAYGROUND (marbles/musical-chairs laterals), `LASH 1` over CREAM (hand-cream rival compound). |
| 27 | **Guessers profile the spymaster across turns.** The blind guesser explicitly used the cluer's style history ("this spymaster clues in idioms: penguin suit, lemon tree, tree swing") to re-rate candidates. The bot clicker has no cross-turn opponent model at all. | `network 2`: SPY's rating was *inflated* by the idiom-heavy profile before negative space pulled it back. |
| 28 | **Table-talk discipline must be structural, not aspirational.** Three rounds, three spymaster leaks (round 3's target names; round 4's "APPLE wasn't a target" tell and the pre-guess CREAM mention) — each made in full knowledge of lesson 15. The fix is procedural: never discuss unplayed alternatives or intent while their targets are live; the advisor's `reason`/`warning` strings need the same hard rule. | Leak #3 handed the guesser a second code-path onto the final word before the guess. |

### Engineering additions

**2.20 Number-conditional rarity. 🟢 (Phase 4.4: `RARITY_SINGLES_SCALE` — full rarity tax on breadth clues, mostly waived at N=1 where narrowness dominates; the vertebrae-over-book flip is pinned in `clickerNuance.test.ts`)** Scale `RARITY_WEIGHT` with the intended
number in `scoreClue`: full penalty on breadth clues, waived (or inverted
toward a narrowness bonus — low `maxNonOwn` heat) at N=1 (lesson 26). Cheap:
both terms already exist in the score expression.

**Scope extensions to existing items:** lesson 21 gives 2.17's sense-enumeration
a spymaster-side dual (score the *continuation* of each frame the intended set
activates — the frame's next-brightest board member must be own); lesson 23
adds own-word spillover to the give-time sweep (harness leftover-tracking in
2.12 must model it); lesson 27 folds into the Phase-4 memory work (the clicker's
cross-turn state should include a spymaster style profile, not just leftover
targets); lesson 28 hardens 4.2's advisor-string discipline rule.

**Round-4 through-line:** the round where the loop closed. The red-team killed
the AI's opening the way rounds 2–3 said it should; the human ran the ledger
forward turn by turn — burned once by frame momentum, then penguin, tree, and
network each demonstrated a different Part-1-through-5 lesson executed
correctly; and the one failure mode that survived all four rounds intact is the
one no scoring function touches: the spymaster's mouth. Discipline that
depends on remembering to be disciplined isn't discipline — it's luck with
good intentions.

---

## Part 7 — Round 5: the go-big experiment

Fifth session, played under forcing rules — every spymaster owed at least one
4+ clue, with no 1-clues until the final word — to probe the offense after
four rounds of accumulating defense. Both boards closed 9/9 and the assassin
was never touched, but the tempo gap was a rout: **human 9/9 in 4 turns**
(batarang 5 → four cards in one turn, the series record) versus **AI 9/9 in
7 turns with four misfires**, including a forced quad (`monster 4`) that died
on its *first guess* to a neutral. The constraint did its job: it generated an
entire family of lessons about what numbers mean, and it showed whose cluing
style scales — reference-scene bundles scaled; manufactured category quads
did not.

### New lessons (29–36)

| # | Lesson | Illustration |
|---|--------|--------------|
| 29 | **Coerced numbers pool; floor+1 separates (costly signaling).** Forcing a minimum makes the floor number uninformative — it could hide any true set plus padding. Going one above the floor is a mildly costly signal that at least the floor-th target is real. | On `batarang 5` the guesser reasoned: "a 4 would have told me almost nothing... but they said 5, one beyond the forced minimum — I trust ~4 and treat the 5th as the rule-mandated pad." Took exactly 4, all red. |
| 30 | **Promise compulsion survives common knowledge of coercion.** The number is a quota the guesser fills, not advice they weigh — even when they know it was forced, even against their own stated uncertainty. | The cluer planned all 4 monster guesses while "only confident in two"; end-game, they would have tapped the known-pad slot of a structurally forced 2 (YARD, blue) after rating it "a distant second." |
| 31 | **Panel variance is the verdict.** When independent halo auditors disagree several-fold on one word's salience, the disagreement itself flags the fragile word — siding with any point estimate is the error. Corollary: "worst case is only a neutral" mis-prices slot 1 of a wide clue, where the whole promise rides on the first guess. | The red-team split 4× on SCORPION (guesser-sim 0.75, audit 0.19); the optimists won the argument and the quad delivered 0/4 when SCORPION went first. |
| 32 | **Sequencing rules are game-mode-dependent.** Round 4's "risky multi goes late" assumed lurkers leave the board; in solitaire nothing does, the red:trap ratio worsens monotonically, and the wide clue is safest on turn 1 with the most true targets diluting its halo. The guesser-side dual: one agent hallucinated opponent-turn pressure in a solitaire game to justify over-extending. | Alt-search's inversion analysis; the club-3 "banking is close to conceding" rationale. |
| 33 | **A famous world's object radiates the world before its mechanics.** Narrowing from the franchise to one artifact does not confine the halo to the artifact's function — characters and imagery still come first. Contents > function, at reference scale. | `batarang 5` intended HAND and SHOT (held, thrown); the guesser delivered ROBIN, SUPERHERO, SHADOW, and a lucky PHOENIX, leaving both mechanics legs stranded. |
| 34 | **Register is a frame over all 25 words — sweep the assassin in the clue's register, not the board's default.** An adult-register clue re-scored the whole board and lifted the assassin to 4th via slang the register itself activated; playable only because N=2 sat under two deafening locks. The auditing guesser even identified "assassin-shaped" words from hop-structure alone. | `masturbation 2`: ICE CREAM rose to 0.30 (cream-slang, "smells like a trap"); WHALE flagged via *sperm whale* as "exactly the shape the assassin takes." |
| 35 | **Stray inference must invert the salience prior.** A stranded target is by definition the one whose link was *weakest* — reconstructing strays by strongest-association to the dead clue is methodologically backwards, and wrong theories don't die when refuted, they mutate (lore → mechanics) and make the surface read look like bait. Current-clue fit leads; old-frame fit is a weak tiebreaker; expect the true stray's old link to look limp. First-instinct primacy (lesson 1) exists precisely to cap theory-stacking — the machine recommitted the ledger's very first human sin, with citations. | SHARK (0.70, phantom lore), then CHECK (0.60, "deductive" restaurant theory) and a planned BACK (mutated mechanics theory) — while the actual strays, triple-coded SHOT and HAND, were dismissed in writing as "classic bait." The theory died on attempt three: "HAND back-fits batarang only limply — and limply is what a stray looks like." |
| 36 | **Sweep completeness is unbounded for human-shaped attention.** After five rounds of accumulated discipline, `GAME → YARD` (backyard games) walked past the AI spymaster's halo sweep entirely — unlisted, unpriced, blue. Exhaustive enumeration belongs to the machine even when the spymaster is the machine. | The round's final misfire, missed by the same process that caught Mario's pipes. |

### Scorecards under forcing rules

- **Human:** 9/9 in 4 turns — `batarang 5` (4/5, series-record turn), `pepper 3` (2/3), `club 3` (1/3), `masturbation 2` (2/2). Both misfires (SHARK, CHECK) were the guesser's debt-theories, not clue defects. The 5 was a *chosen* over-commitment ("might have given 6") that the costly-signal effect converted into trust.
- **AI:** 9/9 in 7 turns — `monster 4` (0/4!), `Godzilla 3` (2/3, STAR lost to a fame-of-fact inversion: the cluer filed *Godzilla-the-movie-star* above the "deep" 1998 New York reference), `DONOR 2` (1/2, agent-frame beat apparatus-frame: "a donor is a *person*"), `SOUP 2` (2/2), `SKYSCRAPER 2` (2/2), `GAME 2` (1/2, the unswept YARD), `TODDLER 1` (1/1). The forced quad was manufactured, not found — and the round's clean turns were all pairs with single-referent or compound locks.

### Engineering additions (2.21–2.24)

**2.21 Variance-gated halo audit. 🔴** Sample the halo model several times (or
several agents/temperatures) per candidate clue; treat high variance on any
single non-own word as a hot word regardless of its mean (lesson 31). Extends
the round-2 rule "conflicting analyses resolve assassin-negative" from verdicts
to distributions.

**2.22 Slot-position risk weighting. 🔴** Score a clue's expected delivery as
the survival function over ordered guesses — P(prefix delivered) — not as
independent per-card margins; a contested word near the *front* of the
guesser's predicted order costs the entire promise (lesson 31's corollary,
`monster 4`'s epitaph). Natural home: beside `leadOwn` in `scoreClue`, using
the clicker model's predicted pick order.

**2.23 Register-conditional scoring. 🔴** Tag clue candidates with an activated
register (slang/adult/technical/nursery) and re-score the assassin and blue
halos *within that register* (lesson 34). Depends on Phase 2 edge channels; the
capitalization convention is precedent that register signals are already part
of the table's contract.

**2.24 Leftover inference with an inverted prior. 🔴** In the clicker/advisor
leftover tracker (2.12): score stray candidates by current-clue fit first, use
dead-frame fit only as a weak tiebreaker, and *penalize* head-of-distribution
matches to the dead clue (the guessers already rejected those — lesson 35).
Cap theory depth: after one refuted reconstruction of a given stray, fall back
to surface reads (lesson 1 as a hard rule).

**Round-5 through-line:** numbers are language. A free number speaks
(round 4); a forced number pools; one-above-the-floor pays to be believed; and
the guesser obeys the quota even knowing it was coerced. The offense that
survived going big was the same offense the ledger has endorsed since lesson 4
— vivid scenes with their contents on the board — and the failures on both
sides came from theories: the panel's theory of a scorpion, the guesser's
theory of a stray, the spymaster's theory that a category could be stretched
into a quad. When in doubt, the surface is the strategy.

---

## Part 8 — Round 6: the embeddings bench

Sixth session, protocol change: the human clued and the **AI spymaster** was
put on the bench directly — a word-embedding backend (ConceptNet Numberbatch,
board-restricted via `build-board-vectors.mjs`) swapped in for the offline table
to prove the "real embeddings" path closes the lateral-association gap the table
structurally can't see. It did: the everyday lateral `COLD~PENGUIN` — invisible
to the baked table — now scores, and a board that had leaked a **`COLD 3`**
(the third card an opponent's) re-scored to a safe **`WATER 2`** once the vectors
graded it. The scoring half of §20 is validated. But the *generation* half
regressed in a way the table never could: `nearest()` over a 40k-token model
proposes candidates the fixed-vocabulary scan never would, and two classes of
that pool are junk that sails through `isClueLegalForBoard`.

### New lessons (37–41)

| # | Lesson | Illustration |
|---|--------|--------------|
| 37 | **Embeddings fix selection, not the candidate set.** Real vectors close the relatedness blind spot (the table's missing laterals), so *scoring* improves — but `nearest()` GENERATES from the whole model, and a poisoned candidate can't be scored back to safety once it's the argmax. The upgrade moves the failure surface from "couldn't see the link" to "offered a word it shouldn't own." | `COLD 3`→leak became `WATER 2`→safe (scoring win), the same turn the generator started surfacing `REVOLUCIÓN` and `OVERBOUGHT` (generation loss). |
| 38 | **Cross-language cognates leak through legality.** `isClueLegalForBoard` rejects exact/substring/stem collisions; a cognate in another language is none of those, so it passes — yet a guesser reads it straight back to the board word it mirrors. Orthographic near-duplicates (shared root + tiny edit distance) and wrong-language accented tokens must be filtered at *generation*, board-derived so the test stays language-agnostic (an English board rejects the accent a Spanish board keeps). | `REVOLUCIÓN` proposed for a board holding `REVOLUTION`: folded edit distance 1, not a substring — legal, and a total self-leak. |
| 39 | **An alphabetical vector source silently disables the commonness prior.** Numberbatch is the best common-sense source *because* it's a knowledge graph — but it's ordered alphabetically, so file rank is not frequency and the loader turns its rarity tax OFF. Obscure words then generate as clues untaxed. The prior must key off a frequency signal the vector source itself doesn't carry. | `OVERBOUGHT` (a real but deep-cut word) rode into the candidate pool from the breadth sample and scored without a rarity penalty, because commonness was disabled for the alphabetical file. |
| 40 | **Board geometry is signal the engine ignores (the proximity rule).** Humans clue and find words that sit *adjacent* on the 5×5 grid more readily than words scattered across it; a weak semantic link survives when the two cards are neighbours. The engine models only the word graph — the board's spatial layout is invisible to it. | `TEACHER`→`SCHOOL` was "nothing even close" on relatedness, yet playable because the two sat adjacent — a proximity assist the bot neither gives nor reads. *(Logged, not implemented — see 2.27.)* |
| 41 | **The spymaster satisfices.** A stretch single where a tighter clue existed is the cluing-side dual of lesson 12 (generation ≠ selection): the bot took the first workable line rather than the best the generator could reach. | `STOCK` on round 2 was a stretch for one word when a cleaner single was available — "why such a stretch clue for 1 word?" *(Logged, not implemented — see 2.28.)* |

### Where the AI failed (H–I) and what held

- **H: `REVOLUCIÓN` (cognate self-leak).** The generator's top neighbour of an
  own card was the board word itself in another language. Root cause is lesson
  38: legality is a substring test, and a cognate isn't a substring. Fixed by
  the candidate-quality filter (2.25).
- **I: `OVERBOUGHT` (untaxed obscurity).** A breadth-sample deep cut scored with
  no rarity penalty because the alphabetical source disabled the prior (lesson
  39). Fixed at the asset layer by the `--freq` commonness reference (2.26).
- **What held:** the embeddings closed the lateral gap they were brought in for
  — `COLD~PENGUIN` grades, and the `COLD 3`→`WATER 2` re-score is the leak-to-
  safe flip that proves the scoring path. Every failure this round was a
  *generation-hygiene* defect layered on top of a scoring *win*.

### Engineering additions (2.25–2.28)

**2.25 Candidate-quality filter. 🟢 (implemented: `makeBoardSafetyCheck` /
`isClueBoardSafe` in `spymasters.ts`, wired into `generateClueCandidates`'
legality choke point, precomputed once per decision)** Reject, at generation,
clue candidates that (a) use a non-ASCII letter absent from every board word (a
wrong-language token — kills `REVOLUCIÓN` via its `Ó`; ASCII punctuation in a
reference like `McDonald's` is preserved) or (b) are a long same-script cognate
of a board word (diacritic-folded shared prefix ≥ 6 + edit distance ≤ 2 on words
≥ 6 long — catches `REVOLUCION`↔`REVOLUTION` while leaving short look-alikes like
`PLANT`↔`PLANE` alone, since an orthographic test can't tell a leak from a
coincidence and dropping a good clue has a real cost). Board-derived, so
language-agnostic (lessons 37/38).

**2.26 Model-order-independent commonness prior. 🟢 (implemented in tooling:
`build-board-vectors.mjs --freq <freq-ordered.vec>`)** Distil the vectors from
the knowledge-graph source (edge quality) but take the *ordering* from a
frequency-ordered reference: the breadth sample is restricted to that
reference's common region (obscurities never become candidates), and the output
is written most-common-first so the runtime loader re-enables its rank→commonness
prior. The prior no longer depends on the embedding source's own order (lesson
39). Without `--freq` the output is alphabetical and the prior stays off — no
faked signal.

**2.27 Board-geometry / proximity prior. 🔴** Model the 5×5 adjacency and reward
clues whose intended targets cluster spatially (and read the assist when
guessing): a weak-but-adjacent link is more findable than a strong-but-scattered
one (lesson 40). Nothing in the engine sees the board layout today.

**2.28 Spymaster anti-satisficing. 🔴** When the best generated single is a
stretch, prefer a tighter alternative over the first workable line, and carry a
cross-turn clue-quality sense so round-2 clues aren't stretchier than round-1's
(lesson 41; the cluing-side dual of the advisor thesis in lesson 12).

**Round-6 through-line:** upgrading the backend is not upgrading the bot. Real
embeddings paid off exactly where promised — the laterals a curated table can't
enumerate — and cost exactly where a bigger, blinder generator always does: it
will hand you a word in the wrong language, or a word no one knows, unless you
filter the candidate set before you score it. Selection was never the whole
game; the candidate set is half of it, and this round is where that half came
due.

---

## Part 9 — Round 7: quantifying the signal-strength cliff (batch self-play, not human play)

Seventh session, protocol change again: no human at the table this time.
Reviewing single-seed bot-vs-bot transcripts (`embeddingSpymaster` +
`greedyClicker`, offline association table — no `BOT_EMBEDDINGS_PATH`
configured) surfaced two Guardian-persona (`temperature: 0.15`) misfires in one
game: `Camelot 1` → STOCK (neutral) and `LOCK 1` → CHICK (neutral). Manually
scoring the candidate pool at each clue moment showed the two misfires had
different root causes — `LOCK→CHICK` was a real target (SOCK, 0.667) beaten by
temperature noise on a ~6% roll; `Camelot→STOCK` was a **table-coverage gap**:
every candidate except the real target (PILOT) scored a flat 0.000, and PILOT
itself only scored 0.200 — too weak, in *absolute* terms, for the temperature-
0.15 softmax to reliably favor it over the crowd of zero-scoring rivals. That
prompted a batch measurement: does a clue's best-real-target score, at the
moment it's given, predict the clicker's hit rate — independent of which
persona is guessing?

It does, sharply. Across 300 self-play games (3657 total clues), bucketing
every Guardian-clicker guess by the table backend's best real-target score at
clue time:

| Best real-target score | Guesses | Own-hit rate | Miss rate |
|---|---|---|---|
| [0.0–0.1) | 22 | 22.7% | 77.3% |
| [0.1–0.3) | 127 | 40.2% | 59.8% |
| [0.3–0.6) | 308 | 61.7% | 38.3% |
| [0.6–1.0] | 1744 | 92.5% | 7.5% |

(Strategist/red is deterministic argmax and never misses, so the table is
Guardian/blue guesses only — mixing in a zero-temperature persona would pad
every bucket with trivial hits and hide the effect.) And this isn't a rare
edge case: **310 of the 3657 clues (8.5%) had literally zero nonzero-scoring
candidate anywhere on the board except one weak real target** — the exact
`Camelot→PILOT` shape, at 8-9% frequency.

### New lesson (42)

| # | Lesson | Illustration |
|---|--------|--------------|
| 42 | **A clue's miss rate is gated by its weakest link's absolute strength, not just persona difficulty.** The clicker's temperature-softmax weighs candidates by their *relative* gap to the best score, scaled by a fixed `temperature` — but it is blind to how weak that best score is in *absolute* terms. A best-real-target score of 0.2 with a runner-up at 0.0 gets nowhere near the same confidence as 0.667 vs 0.333, at the identical temperature, because the softmax normalizes over however many near-zero rivals are still on the board. Persona-independent: a nonzero-temperature clicker facing a thin-coverage clue is closer to a coin flip (or worse) than its nominal difficulty would suggest. | `Camelot 1`→PILOT (real target, 0.200, only nonzero candidate) landed only ~24% of the softmax mass; `LOCK 1`→SOCK (real target, 0.667, next-best 0.333) landed ~76%. Same persona, same temperature, very different reliability — because the *table's* coverage of "Camelot" is thin and "LOCK" is not. |

### Root cause, contrasted with Round 6

This is a different mechanism from lesson 41's `HISTORY→STOCK` stretch-clue
example: that was the **spymaster** manufacturing a spurious second target
from the lexical (bigram-overlap) fallback when the table had no real
HISTORY↔STOCK signal (table score for the pair == lexical score exactly,
confirming the fallback fired, not a curated entry). Lesson 42 is the
**clicker** side of the same underlying gap: table coverage for many clue
words — especially proper-noun references, per lesson 39's "encyclopedic
player" framing — is thin enough that even the *correct* target sits barely
above the lexical floor, and no amount of persona tuning changes how a fixed-
temperature softmax handles a weak absolute signal.

### Engineering addition (2.29)

**2.29 Signal-strength floor on clue selection. 🟡 (clicker/advisor half
shipped)** The guesser side of this item has since landed: the clicker's
`selectIndexByTemperature` and the advisor's `sampleWithoutReplacement` are now
**scale-invariant and confidence-scaled** — weights read *relative* scores
(`exp((score/best − 1)/t)`) and the effective temperature shrinks when the
whole field is weak (`t = temperature × min(1, best/TEMPERATURE_CONFIDENCE_REF)`,
`TEMPERATURE_CONFIDENCE_REF = 0.5` in `strategies/clickers.ts`), so a thin
field no longer randomizes *harder* than a strong one — exactly the
weak-absolute-signal failure lesson 42 measured (and what live-play misfires
like gear→HAND picking the assassin below the argmax confirmed). The
spymaster-side floor — treating a thin real-target read as a risk factor in
`scoreClue` itself — remains open, as originally specified: `scoreClue` (or the
spymaster's candidate legality/ranking step) should treat "the best-scoring
candidate for this intended target barely clears the table's floor" as a
distinct risk factor, independent of `assassinCaution`/`defenseBias` — a
clue whose real-target score sits in the empirically-measured coin-flip-or-
worse range (below ~0.3, where hit rate is under 50%) is a bad clue to give
*even when the assassin/opponent margin looks completely safe*, because the
risk isn't misdirection, it's the guesser's confidence collapsing on a thin
read. Natural home: alongside 2.2's rarity/ambiguity term, but scored on the
target's own strength rather than the halo's heat. Would directly flag both
`Camelot 1` (spymaster side: don't give a clue whose only real target sits at
0.2) and predict `LOCK 1`'s residual risk (clicker side: even a "good" clue at
0.667 isn't argmax-safe at nonzero temperature). Measurement to validate a fix:
rerun the bucketed hit-rate table above and confirm the low buckets either
shrink in frequency (spymaster avoids them) or shift right (clicker reads them
better) without regressing `npm run bots:parity` or the existing
`bots:analyze` metrics.

**Round-7 through-line:** the ledger has so far treated "how good is this
clue" as a question about the *halo* — what else it might hit. This round adds
a second axis measured directly from batch play, not narrated from a human
session: how good is this clue at hitting what it's *for*, in absolute terms,
independent of anything it might accidentally also hit. A clue can pass every
assassin/opponent gate in this document and still be a bad clue, because the
gates all ask "what's the worst it touches" and none of them ask "how
confident is the read on the thing it's aimed at."

## Part 10 — Round 8: absolute thresholds are backend-scale-relative (batch self-play on the shipped Numberbatch backend)

With the distilled Numberbatch board-vectors now the shipped production backend
(Steps 1–3 of the English-strength push), a batch red-team of `bots:analyze`
across all three modes surfaced one dominant, persona-independent gap: **the
spymaster almost never gives a 2 or a 3.** avgNum sat at 1.06–1.32 for every
persona and `ceilingUtilization` at 0.41–0.59 — i.e. safe multi-card lines that
the *relative-margin* yardstick credited were being left on the table, uniformly,
across novice→expert and all six personae.

### New lesson (43)

| # | Lesson | Illustration |
|---|--------|--------------|
| 43 | **An absolute relatedness threshold is only meaningful relative to the backend's scale.** Lesson 42 / addition 2.29 read "~0.3 is the coin-flip floor" as a property of clue quality; it is really a property of the *curated table's* scale. A dense vector backend's cosine similarities are compressed — under distilled Numberbatch a genuinely-related own pair sits ~0.22 and the strongest own card only ~0.33 — so `PROMISE_FLOOR = 0.3` (calibrated on the table, aligned to the clicker's `CLIFF_ABS_CEILING`) was not gating coin-flips, it was trimming ~84% of safe 2-card clues down to 1s *purely on scale*. The number is a promise, but the floor that trims the promise must live on the same scale the promise is measured in. | Over 300 opening boards, all 300 offered a safe 2+ by the relative-margin yardstick; the 2nd promised card's absolute relatedness had median 0.224 (mean 0.237) — below 0.3, so 84% were trimmed. Fixing the floor to scale with the board's strongest own pull lifted daredevil avgNum 1.32→1.79 / ceilUse 0.59→0.86 and strategist 1.29→1.43 / 0.57→0.65 with delivery held at ~100% and leak/misfire/assassin unchanged (~0). |

### Engineering addition (2.30 — shipped)

**2.30 Backend-relative promise floor. 🟢 (shipped)** `scoreClue`'s promise trim
now scales `PROMISE_FLOOR` to the board's strongest own pull (`own[0] *
PROMISE_FLOOR_REL`), clamped so it can only ever *relax* the floor (≤ the original
0.3, so the curated table is byte-for-byte unchanged) and never below a noise guard
(`PROMISE_FLOOR_MIN`). Safety is untouched: the assassin berth and relative safety
margin already certified every promised card, so the worst case of a relaxed floor
is a short-delivery, never a lit assassin — borne out by the batch numbers (delivery
~100%, misfire/assassin ~0 in classic and match; the 5-rung difficulty ladder stayed
monotonically ordered). Regression-tested in `spymasterGuards.test.ts` (compressed
backend promises the safe 2; a sub-floor tail still trims; the high-scale table floor
stays pinned at 0.3).

### Still open (2.31)

**2.31 The other absolute constants share the latent miscalibration. 🟡** The same
table-calibrated absolutes live in the clicker (`CLIFF_ABS_CEILING`,
`BONUS_FLOOR_BASE`) and the spymaster's cohesion/debt terms (`STRAND_THRESHOLD`,
`DEBT_FIT_BAR`). Delivery held at ~100% after 2.30, so the clicker's cliff is not
currently *blocking* the bigger numbers (it also requires the "blurred" condition,
which a distinct target clears) — but on a still-more-compressed backend those
floors would bite the same way `PROMISE_FLOOR` did. The principled end state is a
single backend-scale signal the strategies read, rather than N independently-tuned
absolutes; deferred until a backend actually trips one of them (measure first).
One HAS since tripped: the clicker's temperature softmax went near-uniform on the
compressed Numberbatch scale (live-play assassin picks below the argmax) and was
made scale-invariant + confidence-scaled (see 2.29's shipped half) — the same
relative-scale treatment the remaining constants should get if they ever bite.

### One persona to watch

In **duet** (cooperative, denser assassins, no opponent group), the by-design
reckless **daredevil** — already flagged for assassin exposure pre-change — rises
from 2.6% to 3.7% assassin as it now acts on the bigger numbers 2.30 unlocks;
tightening `PROMISE_FLOOR_REL` does not move it (its thin, low-`assassinCaution`
berth is the driver, not the promise floor). The other five personae and all of
classic/match are safe or improved. This is the intended high-variance end of the
spectrum (contrast the Guardian at ~0.5%), not a regression to chase.

## Part 11 — Round 9: duet is the weak mode, but the residual is difficulty, not a bug (batch self-play)

A dedicated red-team of the post-2.30 bots, all three modes, embeddings backend,
asked "where is the next weakness now that cluing is healthy?" **Classic and match
are clean** — delivery ~100%, misfire 0%, assassin ~0% across every persona; the
only flags are the persona-by-design selection gaps on the defensive personae (they
deliberately sit below the aggressive ceiling). **Duet is the outlier**: assassin
0.5–3.7%, misfire 1–10%, fallback 2–14%, delivery 91–98% — and it holds across ALL
personae, including the defensive ones that never err in classic.

### New lesson (44)

| # | Lesson | Illustration |
|---|--------|--------------|
| 44 | **A mode's error rate is not one mechanism.** Reveal-event classification (compare each hit card's clue-relatedness to the best *still-unrevealed* own card) split duet's errors two ways, and the split is the whole story: ~62% of assassin hits and ~41% of misfires are "the clue lit it" (no own card was brighter), the rest are "clicker noise" (a brighter own card existed, a noisy persona picked worse). The cluing half is almost entirely an **endgame own-depletion** artifact — late in a duet round the strong greens are gone, the spymaster is forced to clue faint leftovers, and against a thin field the assassin is relatively bright. At CLUE time the spymaster almost never makes the assassin the raw argmax (`pickBestEffort` already prefers an own- or neutral-brighter clue), so the cluing-side lever has near-zero headroom. The noise half is the persona difficulty ladder working as designed (a temp-1.2 apprentice clicker is *supposed* to misread). | strategist self-play gave 0 assassin-argmax clues at give time over many games, yet still hit the assassin ~1.4% of duet clues; the hits land at reveal time, in the depleted endgame, not at clue time. |

### Disposition (no code change)

The only lever with real headroom is the **clicker's first guess**: it always takes
guess #1 (the cliff stop guards guesses 2+ only), so a no-signal duet clue's first
guess can be the assassin. A duet first-guess floor — decline to guess (spend a
timer token) when the best card clears nothing — would cut both halves, but it is a
genuine **co-op caution design decision** (guess-and-risk vs pass-and-spend), it is
duet-specific, and it risks delivery/win-rate; it is NOT a clean bug like 2.30. Call:
**accept duet as harder by design** and log the lever rather than ship a speculative
behavior change. Classic and match — the modes without a co-op assassin-ends-it
rule — are clean and need nothing. If duet caution is ever revisited, the measurement
to gate it is: cut duet assassin/misfire without dropping delivery or the duet
win-rate ladder, and with zero change to classic/match (the floor must almost never
fire there).

## Part 12 — Round 10: the guesser-safety margin belongs to the guesser, not the giver

Asked to *maximize* classic clueing (not just remove bugs), a measurement of the
strongest bot's cluing showed real headroom: the strategist used only ~67% of the
board's safe-line ceiling, and even after 2.30 the residual was a **selection gap**
(the scorer picks a clue that safely leads fewer cards than the board's best),
tracking the persona's safety `baseMargin`. On the compressed Numberbatch scale that
margin (~0.10–0.13) is 2–2.6× the yardstick's reference (0.05), so strong bots
under-cover. But a global margin cut is a trap: it 2–3×'d misfire for a noisy/human
guesser (an argmax bot clicker stays 0% at half-margin; an intermediate/novice
clicker jumps to 11–13%). The margin is the buffer that keeps an own card ahead of
the field so the **guesser** takes it and not a look-alike — its right size is a
property of the *reader*, not the giver.

### New lesson (45)

| # | Lesson | Illustration |
|---|--------|--------------|
| 45 | **The guesser-safety margin is calibrated to the GUESSER's noise, not the giver's caution.** The spymaster's `baseMargin` was driven by its own `riskAversion` — so the expert preset (riskAversion 0.8) gave the WIDEST, most conservative margin, even though its clicker is argmax (temperature 0) and reads the tightest clue correctly. That inversion is the whole selection gap: strong bots gave over-cautious clues their own strong clickers didn't need. Size the margin to the team clicker's competence instead — tight for a known argmax bot guesser, full width for a noisy bot / unknown / human guesser — and the coverage headroom is realized without a misfire cost. It is the guesser-side analogue of 2.30's PROMISE_FLOOR scale fix: an absolute threshold tuned for one reader is wrong for a different one. | At margin×0.5 a strategist spymaster + expert clicker covers ceilUse 0.84 at misfire 0%; the SAME half-margin + a noisy clicker misfires 13%. Competence-aware, the strong self-play jumps ceilUse 0.45–0.66 → 0.79–0.83 (misfire 0%), while strong-spymaster + noisy-clicker stays ~3–6% (the wide-margin baseline), and the human/unknown guesser is untouched. |

### Engineering addition (2.32 — shipped)

**2.32 Clicker-competence-aware margin. 🟢 (shipped)** `BotContext.guesserTemperature`
carries the team clicker's temperature when that clicker is a known bot (plumbed by
`botController` from the teammate seat's config, and by the harness from the clicker
binding); `guesserMarginScale` maps it to a multiplier on `baseMargin` —
`MARGIN_SCALE_MIN` (0.5) at temperature 0, interpolating up to 1.0 by
`GUESSER_TEMP_REF` (0.4), and **1.0 when absent** (human/unknown). It only ever
RELAXES the margin for a known-competent guesser, so a bot spymaster's clues to a
human are byte-for-byte unchanged. Validated: strong self-play ceilUse 0.79–0.83 at
misfire/assassin 0%; the 5-rung difficulty ladder stayed monotonic and the strong
end got stronger (expert 83%→90% win, ~4.5 clues/game vs ~5.8 for the weak rungs);
strong-spymaster + noisy-clicker misfire held at the wide-margin baseline (3–6%, not
the naive-tightening 11–13%). Regression-tested in `spymasterGuards.test.ts`
(argmax guesser → promises 2; noisy or absent guesser → promises 1). The assassin
berth and hard floor are untouched — this sizes the field margin only.

### Still open (2.33)

**2.33 The guessing side's absolute floors are the same shape. 🟡** The clicker's own
opportunistic `+1` bonus (`BONUS_FLOOR_BASE` 0.6) is dead on the compressed backend
for the same reason PROMISE_FLOOR was, and the cliff/confidence floors are absolute
too. Unlike the spymaster margin, the clicker's own guesses are its own risk (no
human in the loop), so a backend-relative bonus is safe in principle — but the
compressed scale makes "this leftover is clearly a safe extra" hard to establish, so
enabling it risks fishing into the halo. Deferred: measure whether a core-relative
bonus (take the +1 only when the top leftover reads as tight as the core already
taken — the intent CLAUDE.md already documents) gains cards without adding misfire.
