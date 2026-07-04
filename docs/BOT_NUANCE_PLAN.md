# Bot Nuance Plan — from the Play-Session Ledger to Code

Companion to [BOT_CLUE_LESSONS.md](BOT_CLUE_LESSONS.md). That document is the
*ledger* — 36 lessons and 7 catalogued failure modes from five human-vs-AI play
sessions. This one is the *build sheet*: open plan items (2.8–2.24) mapped to the
exact functions, constants, and data structures that host it, sequenced into
phases with the metric that gates each change.

All paths relative to `server/src/bots/`. Line anchors are as of the round-3
audit; treat them as landmarks, not contracts.

## The keystone constraint

Five items (completion entropy 2.9, referent sweeps 2.10/2.16, fame-of-fact
2.14, concreteness 2.18, and richer endgame context) are blocked by one root
limitation: `SemanticBackend.relatedness(a, b)` (`semantics/backend.ts:13`)
returns a **bare scalar**, and the underlying stores are **unweighted
membership sets** (`associationIndex.ts` `Map<string, Set<string>>`;
`PROPER_ASSOCIATIONS` `Record<string, string[]>` with fame in a separate
per-key map). There is no per-edge weight, no edge-kind, no phrase/direction
channel. Phase 2 widens this interface once; everything downstream threads
through it. Do not implement the blocked items piecemeal ahead of it.

---

## Phase 0 — Instrument first (harness only, no gameplay change)

> Ledger guardrail: measure before tuning. Both assassin hits in live play
> (BOX, GOLD) were endgame events; today's metrics can't even see that.

**0.1 Endgame-sliced `dangerNextRate`** *(discharges the measurement half of
lesson 11/18)*
`ClueRecord` (`harness/analyze.ts:42-70`) already captures `ownAvailable`;
add `revealedCount` populated in the `'clue'` branch (`analyze.ts:212-235`)
from the live `game`, then emit `dangerNextRateEndgame` (slice:
`ownAvailable <= 3`) beside the flat rate (`analyze.ts:291`) and a
`detectGaps` flag (`analyze.ts:309-329`).

**0.2 Board-difficulty normalization (2.19)** *(lesson: "we get the words we
get" — separate bad selection from bad luck)*
Two changes in `analyzeGames` (`analyze.ts:332-350`): (a) fix boards across
entrants — derive the board seed from `(baseSeed, g)` only, not the entrant
pair (`analyze.ts:343`); (b) compute a per-board best-line baseline — best
clue over `backend.vocabulary()`/`nearest()` scored with the existing
`referenceLead` machinery (`analyze.ts:152-184`) — and report per-entrant
deltas vs that baseline. Reuse `spec.words` (`harness/types.ts:48-49`) for
fixed pools.

**Gate:** new metrics appear in `npm run bots:analyze`, deterministic under
`--seed`; existing metric values unchanged (pure addition).

## Phase 1 — Free safety wins (existing scoring paths, no interface change)

**1.1 Number-inventory guard (2.15)** *(lesson 18: Tinder 3 → GOLD; round-2
ENGINE 2 → BOX)*
`chooseClue` clamps at `spymasters.ts:302` (`intended`) and
`spymasters.ts:555-556` (emission). `leadOwn` already counts margin-clearing
cards; the gap is the **absolute** strength of the tail card. Add
`PROMISE_FLOOR`: the emitted number may only count intended cards with
`own[i] >= PROMISE_FLOOR` in absolute terms — a weak-but-margin-clearing tail
card gets deferred, never promised. The number must never be set by remaining
inventory.

**1.2 Give-time assassin re-gate (2.8)** *(failure E's process bug)*
`chooseClue` recomputes fresh per tick (no plan caching today) — encode the
invariant so that stays true: thread `maxAss` and `berth` into `ClueEval`
(`spymasters.ts:177`) and assert the berth after `selectByTemperature`
(`spymasters.ts:551-557`). Any future plan-caching path must call the same
assert.

**1.3 Endgame berth widening (2.11)** *(lesson 11/18: both sides relax late —
the engine must stiffen instead)*
Enrich `ScoreContext` (`spymasters.ts:190-201`) with own/opponent remaining
counts (derived where `desperate` is computed, `spymasters.ts:518`). Scale the
berth floor up as own count shrinks — e.g.
`ASSASSIN_BERTH_FLOOR * (1 + ENDGAME_BERTH_RAMP * (1 - ownRemaining/ownTotal))`
at `spymasters.ts:291`. Direction is one-way: endgame may only *widen* the
wall. Desperation (`DESPERATION_MARGIN_*`, `spymasters.ts:167-168, 256-259`)
keeps thinning margins but still never touches the berth. Note the harness
yardstick uses fixed `REF_MARGIN` (`analyze.ts:28`) — leave it fixed; the
Phase 0 endgame slice is the measuring stick.

**Gate:** `dangerNextRateEndgame` and `assassinRate` drop vs Phase 0 baseline;
`deliveryRate` loss ≤ 2 points; `bots:parity` clean.

## Phase 2 — Widen the semantic backend (the keystone)

> **Shipped.** `edgeInfo`/`collocation` on `SemanticBackend` +
> `clueRetrieval = max(relatedness, collocation)` as the shared guesser
> retrieval model (spymaster margins, clicker/advisor ranking, harness
> yardstick); weighted `EdgeMeta` association index; SemanticMap v2
> (`bots:map` now emits it; v1 still loads); consumers wired per below with
> `FAME_OF_FACT_WEIGHT` / `CONCRETENESS_WEIGHT`. Gate held: v1 fixtures
> regression-tested, misfire class D reproduces channel-blind and not
> channel-aware (`edgeChannels.test.ts`). Status per item in
> [BOT_CLUE_LESSONS.md](BOT_CLUE_LESSONS.md) (2.9/2.14/2.18 🟡 — data
> curation for the baked table remains).

New **optional** methods on `SemanticBackend` (`backend.ts:13-37`), so every
backend stays valid, plus a versioned data format:

- `edgeInfo?(clue, word): { strength: number; kind?: EdgeKind; penetration?: number }`
  where `EdgeKind = 'content' | 'member' | 'part' | 'compound' | 'function' | 'attribute'`.
  One method carries both **fame-of-fact** (2.14, lesson 14 — how many humans
  would retrieve this edge at table speed, distinct from word commonness) and
  the **concreteness kind** (2.18, lesson 16 — the gradient: contents >
  members/parts > compounds > function/attribute).
- `collocation?(a, b): number` — phrase/completion frequency, the
  **completion-entropy** source (2.9, lesson 13: "manta ray" concentrated vs
  "engine ___" spread; would have red-flagged ENGINE and FOSSIL).

Data-side changes:
- `buildAssociationIndex` (`associationIndex.ts:17`) value type
  `Set<string>` → `Map<string, EdgeMeta>`; weights default 1 when absent so
  the baked v1 tables keep working.
- `SemanticMap` v2 (`mapBackend.ts:27-42`): per-edge weights and structured
  `proper` entries (see Phase 3); `isSemanticMap` accepts v1 and v2.
- `scripts/build-semantic-map.mjs` and `generate-associations.mjs` prompts
  updated to emit weights/kinds; `commonness()` implementations untouched.

Consumers wire in at exactly two places: the additive `score` expression in
`scoreClue` (`spymasters.ts:333-343`, beside the existing
`ambiguityPenalty`/`rarityPenalty` at 325-326) and the clicker's score
construction (`clickers.ts:167-171`).

**Gate:** `mapBackend` v1 fixtures still load (regression on the existing
`mapBackend.test.ts` suite); with weights present, `robustness` improves and
misfire class D (member-beats-compound) reproduces *in the harness* before the
fix and not after.

## Phase 3 — Reference-clue safety (rides on Phase 2 data)

> **Shipped.** Weighted `PROPER_ASSOCIATIONS` contents (Thunderball ⊃
> POOL/CASINO/SHARK, Tinder ⊃ GOLD, GoldenEye, Hooke @ fame 0.35) +
> `PROPER_RIVALS` (pull = weight × rival fame) + `PROPER_HYPERNYMS`
> (`HYPERNYM_SCORE` 0.55, exemplar asymmetry) in the table's reference
> reading; v2 map `rivals` consumed by the overlay; `bots:map` prompt gains
> the referent-knows-more-than-you sweep and emits rivals. Gates held
> (`referenceSafety.test.ts`): the Thunderball board rejects the title clue
> with POOL blue and embraces it at 3 with the contents own; the brand-tier
> edge caps the number below the tier word (before/after). Open: rival +
> exhaustive-content curation across the full baked table (see 2.10/2.16
> markers in the ledger).

**3.1 External referent-content + rival-referent sweep (2.10 + 2.16)**
*(lessons 10, 19: Aucassin's STAR; Tinder Gold)*
Restructure `PROPER_ASSOCIATIONS` (`properAssociations.ts:33`) entries into
records: `{ contents: weighted words (exhaustive — including product tiers and
brands), fame, rivals?: [{ referent, fame, contents }] }`. The spymaster's
existing generic `maxNonOwn`/`maxAss` machinery already punishes hot halos —
**if the edges exist**. The mandate is curation: Thunderball's entry must
contain POOL and CASINO; Tinder's must contain GOLD; and rival contents
(Aucassin's star) count against the clue too. `bots:map` prompt gains the
"referent knows more than you" sweep: enumerate contents from external
knowledge, never the curator's.

**3.2 Hypernym candidates for unknown references (2.13)** *(lesson 7)*
`tableBackend` proper-miss branch (`tableBackend.ts:101-110`): before
degrading to common scoring, consult a small `PROPER_HYPERNYMS` table
(reference → type-level words: novel, film, scientist…), scored *below*
content matches per the exemplar-asymmetry lesson.

**Gate:** harness scenario tests: a Thunderball-style board (title clue with
board-resident contents) must reject the title clue; a Tinder-style board must
cap the number below the brand-tier word.

## Phase 4 — Clicker and advisor nuance

> **Shipped (4.1–4.4).** 4.1: `strategies/clueFrame.ts` — the case convention
> makes senses enumerable (flipped-case probe = the other sense); the clicker
> and advisor re-rank on the uniform-weak tell. 4.2: `GuessSuggestion.warning`
> (fixed strings only — failure-G discipline) for frame doubt, unresolved
> references, and late-game stretches; plumbed through `botController` →
> `game:botSuggestion` → board badge. 4.3: `BotContext.memory` clue-debt
> snapshots threaded by the harness loop and a live per-room tracker;
> `DEBT_BOOST` for owed unbounced frames, zero for bounced (classic/match;
> duet's masked key exempts it like the cliff estimate). 4.4:
> `RARITY_SINGLES_SCALE`. Gate held on seed `ph4-gate`: delivery flat for
> every competent persona, overreach flat at 0%, misfire/dangerEG nudged
> down; warnings covered in `clickerNuance.test.ts`. **4.5 (2.21–2.24)
> remains open** — variance-gated audits need a sampling-capable halo model
> and register channels need curated data; both are Phase-5-and-beyond work.

**4.1 Sense-enumeration + frame-switch (2.17)** *(lesson 20: REMOVAL tunnel
vision; the uniform-weak-fit tell)*
In `makeGreedyClicker` (`clickers.ts:156-235`): enumerate the clue's senses
where the backend can (concept keys, proper-vs-common via `caseSignal`),
score candidates per-sense. Frame-doubt trigger: dominant sense's best fit
below `FRAME_DOUBT_FLOOR` while another sense clears the bar with ≥ 2
candidates → re-rank under that sense. Co-locate with the existing
`CLIFF_*`/`BONUS_*` gates (`clickers.ts:114-125, 194-229`).

**4.2 Advisor warnings** *(lessons 11, 15, 18, 19 — the human-facing payoff)*
Add optional `warning?: string` to `GuessSuggestion` (`advisor.ts:19-26`),
populated at `advisor.ts:100-104`; it flows through `emitAdvisorSuggestions`
(`botController.ts:158-207`) unchanged; widen `stateTypes.ts:166-169` and
render in `frontend/board.ts:336-349`. Warnings: late stretch beyond the
strong core ("run the assassin check"), unresolved reference ("consider
type-level readings"), frame doubt (from 4.1). The advisor view is type-masked
(`botController.ts:182`) — plumb own-remaining *count* (public via score) for
the endgame test. Discipline rule from failure G: `reason`/`warning` strings
must never encode key information beyond the suggestion itself.

**4.3 Within-game leftover memory (2.12)** *(lesson 9: clue debt; the blind
guesser's CASINO burn and subsequent self-correction; round-4 lessons 24/27:
double-coding means leftover candidates should BOOST matching new-clue
candidates, and the memory should carry a spymaster style profile — the
round-4 guesser demonstrably used one)*
Strategies are pure (`types.ts:5-9`) — keep them pure by passing memory as
data: extend `BotContext` (`types.ts:76-81`) with an optional per-seat
`memory` snapshot, threaded by the two callers (`harness/playGame.ts:90-91`,
`botController` per-decision). Track promised-vs-taken per clue; when a
leftover frame's top candidate bounces, downgrade the whole frame's
bonus-guess EV, not just the burned word.

**Gate:** `overReachRate` flat or down while `deliveryRate` holds; new
frame-switch fires in a REMOVAL-style harness scenario; advisor warnings
appear in `game:botSuggestion` payloads without protocol breakage
(`socket-events` types).

**4.4 Number-conditional rarity (2.20, round 4)** *(lesson 26: the singles
doctrine)* Scale `RARITY_WEIGHT` by intended number in `scoreClue`
(`spymasters.ts` robustness block): full penalty on breadth clues, waived at
N=1 where narrowness (low `maxNonOwn` heat) dominates — a rare definitional
single (vertebrae → spine) beats a common compound trailing laterals.

**4.5 Round-5 additions (2.21–2.24).** Variance-gated halo audits (multi-sample
the halo model; high per-word variance = hot word), slot-position risk
weighting (score expected delivery as the survival function over the clicker's
predicted pick order — a front-slot contest costs the whole promise),
register-conditional scoring (rides Phase 2 edge channels), and
inverted-prior leftover inference with a theory-depth cap (extends 4.3; see
ledger Part 7 for the derivations).

## Phase 5 — Retune and validate

Re-run the full `bots:analyze` roster (`analyze.ts:353-359`) against the
Phase 0 baselines; retune personas (`personas.ts` style knobs) where the new
terms shifted equilibria — the assassin gate and berth ramp stay
persona-independent. Then **round 4** of human play: the human against the
improved bots, with the advisor live — the validation round the first three
sessions earned.

> **Retune half — verified no-op (evidence, not assumption).** Roster on
> `phase5-roster` (8 games/pair, classic): the four competent personae all
> pass every gate — delivery 94–100%, leak ≤ 2%, misfire ≤ 5%, assassin 0%,
> `ceilUse` 0.52–0.64, overreach 0%. The only two flags are BY DESIGN, not
> regressions: **apprentice** (the beginner) carries its intended
> assassin-exposure / weak-coverage profile, flat vs the Phase-4 baseline
> (assassin 2.7–2.8%), and **maverick** (off-kilter, low `commonnessBias`)
> shows a borderline selection gap (`ceilUse` 0.52) that is its creative
> identity, not a defect — on the `ph4-gate` seed it isn't even flagged
> (0.59). A seed-matched run against the Phase-4 baseline is **bit-identical**
> across all six personae, so the Phase 2–4 scoring terms + the hardening
> fixes shifted no equilibrium: each term was gated at introduction and the
> cumulative effect is stable. Per the "measure before tuning" guardrail, no
> knob is changed — manufacturing a tune without a demonstrated problem would
> be fiddling. The persona ladder is validated as healthy; the remaining half
> is the live human-play validation round.

## Traceability

| Ledger item | Discharged by |
|---|---|
| Lessons 11, 18 (endgame spiral, number-as-promise) | 0.1, 1.1, 1.3, 4.2 |
| Failure E process bug (stale plan → assassin) | 1.2 |
| Lessons 13, D/E compound asymmetry | 2 (`collocation`), gate scenario |
| Lessons 14 (fame-of-fact), 16 (concreteness) | 2 (`edgeInfo`) |
| Lessons 7, 10, 19 (exemplar, collisions, referent contract) | 3.1, 3.2 |
| Lesson 20 (frame monopolization) | 4.1 |
| Lesson 9 (clue debt) | 4.3 |
| Lesson 15 / failure G (table-talk discipline) | 4.2 discipline rule |
| Board-luck caveat | 0.2 |

**Standing guardrails:** all changes live in the strategy/semantics layer —
`npm run bots:parity` must stay green anyway; every stochastic path stays on
the seeded `ctx.rng`; deterministic unit tests beside each new pure function;
`--seed` reproduces any regression.
