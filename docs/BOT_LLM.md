# LLM-Backed Bots (opt-in)

The strongest bot tier available: with a model configured, bots consult Claude
before each decision — the LLM **proposes**, and the existing deterministic
machinery **verifies**. This raises the ceiling that embeddings and tables
cannot reach (compositional, board-aware judgment), while every safety
guarantee stays enforced by code, not by the model.

## Enabling

```bash
# .env / deployment environment
ANTHROPIC_API_KEY=sk-ant-...        # standard Anthropic SDK credential chain
BOT_LLM_MODEL=claude-sonnet-5       # naming a model turns the layer on
# BOT_LLM_TIMEOUT_MS=8000           # per-call budget (default 8000, min 1000)

# Per-seat overrides (fall back to BOT_LLM_MODEL; the value 'off' disables a
# seat). Clue proposals are quality-sensitive; guess scoring runs on every bot
# guess and is latency-sensitive — the classic split is sonnet clues + haiku
# guesses:
# BOT_LLM_MODEL_SPYMASTER=claude-sonnet-5
# BOT_LLM_MODEL_CLICKER=claude-haiku-4-5
```

Unset `BOT_LLM_MODEL` (or remove the key) to turn it off. Nothing else changes:
strategies receive no advice and behave exactly as before, so tests and the
self-play harness stay deterministic.

### Production (Fly.io)

`fly.toml` ships `BOT_LLM_MODEL = "claude-sonnet-5"` in `[env]`, so the layer is
one secret away from live:

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...   # restarts the machine; tier is live
```

Until the secret exists the layer stays dormant: the SDK client fails to
initialise, logs one warning (`Bot LLM advice disabled: Anthropic SDK/client
unavailable`), and bots play the embeddings tier as before. To disable, run
`fly secrets unset ANTHROPIC_API_KEY` (dormant again) or remove the
`BOT_LLM_MODEL` line from `fly.toml`.

### Choosing a model

Any current Claude model ID works (use the exact alias — no date suffixes).
Rules of thumb, priced per million tokens (mid-2026):

| Model            | ID                | $ in / out | Fit                                                                  |
| ---------------- | ----------------- | ---------- | -------------------------------------------------------------------- |
| Claude Sonnet 5  | `claude-sonnet-5` | $3 / $15   | Shipped default — strong proposals at ~1–2 s latency                  |
| Claude Haiku 4.5 | `claude-haiku-4-5`| $1 / $5    | Cheapest and fastest; weaker proposals, still fully verified          |
| Claude Opus 4.8  | `claude-opus-4-8` | $5 / $25   | Highest ceiling; brushes the 8 s timeout more often on big boards     |

A decision sends ~400–600 input tokens and returns ~100–300; a busy game makes
20–40 calls. That is roughly **$0.10–0.20 per game on Sonnet 5** (~3× less on
Haiku, ~2× more on Opus) — game pace, not model choice, dominates the bill.

The two call types have different sweet spots: guess scoring (every bot guess,
latency player-visible) is an easy task Haiku handles well in ~1–2 s, while
clue proposals (once per bot turn) reward Sonnet's composition. Mix them with
the per-seat overrides:

```bash
BOT_LLM_MODEL_SPYMASTER=claude-sonnet-5
BOT_LLM_MODEL_CLICKER=claude-haiku-4-5
```

## How it works

The live controller (`bots/botController.ts`) computes advice **asynchronously
before** each bot decision and passes it to the pure, synchronous strategy as
data (`BotContext.llm` — see `bots/llm/llmAdvice.ts`):

- **Spymaster**: the LLM proposes up to 6 clue candidates (word, number,
  intended targets). Proposals enter the standard candidate pool at the same
  choke point as generated candidates and face the SAME legality check,
  board-safety filter, assassin berth, and guesser-safety margins — a proposal
  the gates can't certify is simply never emitted. (Corollary: the layer works
  best with embeddings enabled, since the verifier scores proposals with the
  semantic backend; a brilliant clue the backend can't see the connection for
  scores poorly and loses.)
- **Clicker / advisor**: the LLM scores how strongly the current clue points at
  each unrevealed card (0–1). That read replaces backend retrieval as the
  primary ranking; the discipline layer (confidence floors, plausible-set
  noise, bonus-guess gates, persona knobs) still shapes the actual guess, so
  the difficulty ladder keeps meaning. LLM scores run hot relative to the
  backend scale the discipline floors were tuned on, so the `+1` bonus-guess
  floor is raised (`LLM_BONUS_FLOOR_BUMP`) whenever the ranking is LLM-scored —
  "tighter than the core, not merely plausible" holds on both scales.
- **Guesser dry-run** (`bots/llm/clueDryRun.ts`): after the spymaster picks its
  clue — from proposals or its own generation — ONE extra LLM call simulates
  the clicker's exact scoring call on that clue, and the resulting ranking is
  read with the key in hand. This closes the verifier/guesser asymmetry (the
  margins are certified against the semantic backend, but the guesser acting
  on the clue reads richer): if the assassin sits inside the engine's `number+1`
  guess grant the clue is **vetoed** (the word is burned via the no-repeat
  memory and the spymaster re-picks once); a non-own card intruding inside the
  promise **trims** the number to the clean own-card prefix; a clean own-card
  prefix longer than the promise, each card read with real confidence,
  **raises** the number — the fix for the 1-clue treadmill. Any failure leaves
  the clue exactly as chosen; duet is exempt (dual keys don't fit the
  single-key walk). The call bills to the spymaster seat's model, falling back
  to the clicker's so clicker-only setups still get verified clues.
- **Desperation proposals**: when the opponent sits at match point (classic /
  match modes), a safe partial clue loses anyway, so the proposal prompt says
  so outright — the guesser must find ALL remaining own words this turn — and
  asks for clues bridging the full set. The proposals still face every
  deterministic gate; desperation never relaxes the assassin machinery.

Every failure mode — no key, timeout, refusal, malformed output — degrades to
`null` and the bot decides exactly as it does without the layer. The client
makes exactly **one attempt per decision** (SDK retries are disabled — the
default retry policy silently tripled a slow decision's worst case), so LLM
advice can slow a decision by at most the timeout; it can never stall or break
one.

## Cost and latency

One API call per bot decision (a clue or a guess ranking), plus one dry-run
call per bot clue (two on a veto re-pick), with bounded output (`max_tokens` ≈
1.5k). Game pace naturally limits volume: a busy room makes a few calls per
minute. Bots already pause "to think", so a couple of seconds of latency reads
naturally; the timeout caps the worst case.

## Security notes

Board words and human clues are player-controlled text and are embedded in the
prompts (marked as game data to ignore instructions in). The blast radius is
bounded by construction: a spymaster proposal only ever ADDS a candidate that
must pass the deterministic gates, and guess scores only reorder a fixed set of
board indices — the LLM cannot name a card to reveal, exceed the board, or
bypass the assassin machinery. Advice for clickers/advisors derives from the
MASKED view only (no key information leaves the server for those calls; the
spymaster call necessarily includes the key, as the spymaster legitimately
sees it).

## Measuring it

- `npm run bots:eval -- --norms <file>` — the human-association eval
  (docs/BOT_CLUE_LESSONS.md 2.7) grades the non-LLM semantic backends.
- Live play with `BOT_LLM_MODEL` set is the LLM layer's own proof; watch the
  server log for `Bot LLM advice call failed` warnings (one per failure kind)
  if bots seem to be ignoring it.
