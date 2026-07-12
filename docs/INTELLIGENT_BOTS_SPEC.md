# Intelligent Bots — Design Specification

**Status:** Partly shipped — this document is now part design spec, part
retrospective. The core pieces have landed: the `game:clue` / `game:clueGiven`
clue channel (event, `gameService.submitClue`, `submitClue.lua`), the bot
subsystem under `server/src/bots/`, and the `bot:add` / `bot:remove` host
events. Sections below preserve the original design narrative; where they
described future work that has since shipped, this is flagged inline. **For the
current state, the code in `server/src/bots/` is authoritative.**

**Shipped since the original spec (see `server/src/bots/`):**

- **Multi-factor clue scoring** (`strategies/spymasters.ts` `scoreClue`): coverage
  - clarity + a graded assassin penalty + a defensive "don't arm the opponent"
    penalty + (match mode) a card-value bonus. The `temperature` knob is now wired
    as a softmax over candidates, so one strategy spans "scary good" (temp 0) →
    "off-kilter but sensible" (high temp); the five-rung
    `novice`/`beginner`/`intermediate`/`advanced`/`expert` presets are a real
    self-play-verified ladder (monotonic win-rate on the embeddings tournament).
    The clicker's noise only draws from the _plausible_ set (cards scoring ≥ half
    the best card's clue-fit), so weak rungs misread real candidates instead of
    blundering onto the clue-unrelated assassin.
- **Embedding-backed clue GENERATION**: `SemanticBackend.nearest()` lets the
  spymaster generate board-specific candidates (nearest own-card neighbours),
  not just score a fixed vocabulary. Enabled via `BOT_EMBEDDINGS_PATH`, or by
  auto-detection of a previously downloaded/baked vectors file at the
  well-known locations (opt-in in prod; graceful table fallback).
- **New roles**: `advisor` (suggests ranked guesses to a human clicker via
  `game:botSuggestion`, never acts) and `observer` (watches the unmasked board,
  never participates). Bots can be seated as advisors; the advisor honours its
  skill preset.
- **Live "thinking" pace** between bot actions (controller only; zero in tests).

**Scope:** Add AI-controlled players ("bots") to Eigennamen for two purposes:

1. **Solo playtesting** — a human (or no human at all) plays a real game with bots filling the empty seats, in a normal multiplayer room.
2. **A training ground** — bots of different _types_ and _skill levels_ are pitted against each other headlessly, at scale, scored, and iterated on.

This document is a plan, not an implementation. It records the recommended
architecture, the one hard constraint that shapes everything, the new
interfaces and files, a phased roadmap, the testing strategy, and the open
decisions that still need an owner.

---

## 1. TL;DR

- **Bots are ordinary server-side `Player` records** (`isBot: true`) with no
  websocket. An in-process `botController` reacts to the existing
  `onGameMutation` notifier and drives moves by calling the **same**
  `gameService` functions a socket handler calls. No new game engine, no
  headless browsers, no protocol rewrite.
- **The same decision code runs headless.** A single pure helper,
  `playOneAction`, is shared verbatim by the live controller and a
  `worker_threads`-sharded tournament runner (`npm run bots:train`). Because
  both paths call the same helper, the training ground provably cannot drift
  from real gameplay.
- **One genuinely new game feature is required first:** a first-class
  `game:clue` event. Today there is **no way for a spymaster to transmit a clue
  through the app** — clues are given verbally. Bots that play the spymaster
  seat need a real channel, and humans benefit from it too. This ships and is
  tested **before and independently of** the bots.
- **Skill is a typed parameter bundle**, not a 0–1 dial, and is orthogonal to
  bot type. Every tie-break flows through a per-bot seeded RNG, so
  `(strategyId, botSeed, gameSeed)` reproduces a game byte-for-byte.

Roughly **16–26 dev-days** to a credible training ground, with a _playable_
solo-test build after Phase 1.

---

## 2. Goals and non-goals

### Goals

- A host can add/remove bots to seats in a normal room; a game with any mix of
  humans and bots plays correctly in **classic**, **duet**, and **match** modes.
- A fully autonomous bot-vs-bot game runs end-to-end with no human.
- A headless harness runs thousands of seeded bot-vs-bot games, scores
  strategies (Elo/TrueSkill + mode-specific fitness), and supports a tight
  edit → re-run → diff iteration loop.
- New bot _types_ and _skill presets_ are added by editing one registry entry /
  one preset table — no controller or engine changes.
- Reproducibility: a reported "the bot did something dumb on seed X" game can be
  replayed deterministically.

### Non-goals (initially)

- A strong, human-competitive **spymaster** bot. Good clue _generation_ needs
  semantic word-association data (embeddings) and is gated behind a later phase.
  The clicker side and a human-spymaster-with-bot-clickers experience come first.
- Reinforcement-learning training of neural policies. The harness is the
  substrate that _could_ support that later; v1 ships heuristic + search bots.
- Any change to the existing win/turn/score **rules**. Bots are new _callers_ of
  existing rules, plus the one additive clue event.

---

## 3. The one hard constraint that shaped the design: the clue channel (now SHIPPED)

This was the single most important fact for autonomous play. When this document
was first written there was **no way for a spymaster to transmit a clue through
the app** — the `Clue` types existed but `currentClue` / `guessesAllowed` were
only ever reset to `null`/`0`, never set to a real value. That gap has since
been closed; the clue channel is **IMPLEMENTED**:

- `config/socketConfig.ts` defines `GAME_CLUE: 'game:clue'` and
  `GAME_CLUE_GIVEN: 'game:clueGiven'`.
- `services/gameService.ts` exports `submitClue(...)`, which validates
  turn/role, runs the atomic Lua writer, and fires `notifyGameMutation`.
- `scripts/submitClue.lua` is the atomic writer — it sets `currentClue`,
  appends to `clues[]` and a `ClueHistoryEntry`, and sets `guessesAllowed`,
  executed under the `reveal:{roomCode}` lock (see §6).
- `socket/handlers/gameHandlers.ts` registers `game:clue`, gated on
  `role === 'spymaster' && team === currentTurn`.

The previously-"vestigial" clue fields (`currentClue` / `clues[]` /
`ClueHistoryEntry`) are now the live coordination channel — `revealEngine.ts`,
`revealCard.lua`, and `endTurn.lua` still _clear_ them at turn boundaries as
before, but `submitClue` is what populates them.

Consequences for bots (the design rationale, still valid):

- A **clicker bot** only needs the existing reveal/endTurn channel _plus_ the
  ability to read a clue. A **spymaster bot** needs somewhere to put its clue —
  which the shipped `game:clue` event now provides.
- The real `game:clue` event (§6) is what unblocks autonomous spymaster play.
  The **natural-language
  clue word is the coordination channel**: a clicker (human or bot) ranks
  unrevealed cards by semantic similarity to `currentClue.word`. Bots get no
  information a human clicker wouldn't — no covert side channel.

---

## 4. Codebase facts the design relies on (all verified)

| Fact                                                                                                  | Evidence                                                                                                                                                                              | Why it matters                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players are plain Redis records decoupled from sockets; `connected:false` is a valid persisted state. | `services/player/schemas.ts` (`playerSchema`); socket mapping is a separate Redis key.                                                                                                | Bots can be "virtual players" with no socket.                                                                                                                              |
| A mutation notifier already exists.                                                                   | `socket/gameMutationNotifier.ts` — `onGameMutation(listener)` / `notifyGameMutation(roomCode)`.                                                                                       | The bot controller reacts to game changes with **zero polling**.                                                                                                           |
| `notifyGameMutation` fires **inside** the `reveal:{roomCode}` lock.                                   | `gameService.ts:354` is within the `withLock(...)` callback.                                                                                                                          | The controller **must defer** its reaction (e.g. `queueMicrotask`/`setImmediate`) or it will try to re-enter a held lock. Captured as a design rule (§9) and a risk (§17). |
| Role-masked views are already produced by one function.                                               | `getGameStateForPlayer(game, player)` at `revealEngine.ts:253` returns `PlayerGameState` with `types[]` nulled for non-spymasters.                                                    | Bot views are **structural subsets** of an existing type — no new masking logic.                                                                                           |
| Game services are socket-free and directly callable.                                                  | `createGame`, `getGame`, `revealCard`, `endTurn`, `forfeitGame`, and the shipped `submitClue` (`gameService.ts:423`) — all callable without a socket.                                 | Both the live controller and the headless harness call the same functions.                                                                                                 |
| The clue channel is implemented (was a prerequisite, now SHIPPED).                                    | `socketConfig.ts` `GAME_CLUE`/`GAME_CLUE_GIVEN`; `gameService.submitClue`; `scripts/submitClue.lua`; `game:clue` handler in `gameHandlers.ts` (spymaster + turn gated).               | Spymaster bots have a real channel; no covert side channel — see §3, §6.                                                                                                   |
| Card reveal/turn already serialize under a distributed lock.                                          | `revealCard`/`endTurn` wrap `withLock('reveal:{roomCode}', …, {lockTimeout: LOCKS.CARD_REVEAL*1000, maxRetries:5})`.                                                                  | A bot acting on a stale snapshot is safely rejected by the lock + Lua preconditions (`NOT_YOUR_TURN`, `ALREADY_REVEALED`).                                                 |
| Board generation is pure, seeded, environment-agnostic.                                               | `services/game/boardGenerator.ts` (`generateBoardLayout`, `selectBoardWords`, `generateCardScores`, `generateDuetBoard`, `seededRandom`/Mulberry32, `hashString`, `shuffleWithSeed`). | Per-game seeds for tournaments reuse this verbatim; reproducible boards for free.                                                                                          |
| Turn timers are skippable.                                                                            | `timerService` / `timerHandlers`; `startTurnTimer` is gated on room settings.                                                                                                         | Headless self-play disables timers for fast simulation.                                                                                                                    |
| Game history is unsuitable as a training corpus.                                                      | `gameHistoryService` has a 30-day TTL and a ~100-games-per-room cap.                                                                                                                  | The harness writes its **own** append-only NDJSON store; history stays for replay/attribution only.                                                                        |

---

## 5. Recommended architecture

> **Decision basis.** Four independent design angles were generated and scored
> by four judges (solo-playtest, training-scalability, minimal-rework,
> extensibility). _Seat-Filler Bots via Service-Layer Reuse + a first-class clue
> event_ won 3 of 4 lenses (it was a close second on scalability). _Pure Engine
> Core_ won the scalability lens. The recommended design takes Seat-Filler as the
> spine and **grafts in** the Pure-Engine purity/determinism (as the shared
> `playOneAction` helper + a Lua-vs-TS parity gate) and the Headless-Socket
> design's wire-fidelity sampling as CI insurance.

### 5.1 Three execution contexts, one strategy codebase

```
                 ┌──────────────────────── ONE strategy codebase ───────────────────────┐
                 │  server/src/bots/strategies/*  + playOneAction.ts (pure, IO-free)     │
                 └───────────────┬───────────────────────────────┬──────────────────────┘
                                 │                               │
   (1) SOLO PLAYTEST (live room) │                               │ (2) HEADLESS TRAINING (scale)
   ┌─────────────────────────────▼───────────┐     ┌─────────────▼─────────────────────────┐
   │ botController (singleton, socket init)   │     │ runMatches.ts  (npm run bots:train)    │
   │  onGameMutation(roomCode) ──defer──►      │     │  worker_threads shards, 1 redis/worker │
   │  load game → is next seat a bot? →        │     │  createGame({turnTimer:null}) loop     │
   │  getGameStateForPlayer → playOneAction →  │     │  playOneAction → gameService.* until    │
   │  gameService.submitClue/revealCard/endTurn│     │  gameOver → MatchResult → NDJSON        │
   │  (same locks, same Lua, same broadcasts)  │     │  → scoring.ts (Elo + fitness)           │
   └───────────────────────────────────────────┘     └─────────────────────────────────────────┘
                                 │
                                 │ (3) FIDELITY SAMPLE (CI insurance)
                 ┌───────────────▼───────────────────────────┐
                 │ a few full games via real socket.io-client │
                 │ exercising auth / Zod / rate limits / lock │
                 └────────────────────────────────────────────┘
```

1. **Solo playtest (live, real room).** The host adds bots to empty seats. A
   singleton `botController` registered at socket init subscribes to
   `onGameMutation`. On each (deferred) notification it loads the game, finds
   the seat that owns the next action for `currentTurn`, and — if that seat is a
   bot — builds the role-masked view via the existing
   `getGameStateForPlayer(game, botPlayer)`, calls the strategy, and applies the
   move through the **same** `gameService.submitClue/revealCard/endTurn`
   functions a socket handler uses. The resulting mutation re-fires
   `notifyGameMutation`, cascading the next bot action. Humans receive the
   identical `room:playerJoined` / `game:cardRevealed` / `game:clueGiven`
   payloads via existing `safeEmit`. **Zero frontend changes** are required for a
   playable cut (a bot badge is a nice-to-have, §16).

2. **Headless training (scale).** `runMatches.ts` bypasses Socket.IO and timers
   entirely (`turnTimer: null` skips `startTurnTimer`). It calls the **same**
   `playOneAction` in a tight loop against an in-memory mock Redis
   (`createMockRedis` from `__tests__/helpers/mocks.ts`) or a real Redis,
   sharded across `worker_threads` (one Redis client per worker). Per-game seeds
   derive from `hashString(baseSeed + ':' + pairId + ':' + gameIndex)`, reusing
   `boardGenerator`. Because live and harness share `playOneAction`, the two
   paths cannot diverge.

3. **Fidelity sample (CI insurance).** A _small_ periodic set of games runs
   through the real socket path (a headless `socket.io-client`) purely to
   exercise auth, Zod validation, rate limits, and the distributed lock
   end-to-end. This is a layered integration check, never the primary self-play
   vehicle — the per-IP connection cap (10) and per-event rate limits make the
   socket path unsuitable as the main training channel.

### 5.2 Why not the alternatives (one line each)

- **Headless socket clients as the _main_ path** — protocol-perfect but
  rate-limited, per-IP-capped, and slow; great as a _sample_, wrong as the bulk
  engine.
- **Full pure-engine extraction on day one** — the cleanest long-term core and
  best raw training throughput, but it carries a permanent obligation to keep a
  whole second rules implementation in parity with production Lua. We capture
  most of its benefit with the shared `playOneAction` helper + a parity gate,
  without the day-one rewrite.

---

## 6. Phase 0 — the `game:clue` event (prerequisite — SHIPPED)

> **Status: DONE.** This phase has shipped. The event, schema, Lua writer,
> service function, and handler all exist (see §3 / §4). The design steps below
> are retained as the as-built record; verify specifics against the code.

A real game action, not chat-encoding and not an admin mutation. Same path for
human and bot spymasters. Wired in dependency order:

1. **`config/socketConfig.ts`** — add `GAME_CLUE: 'game:clue'` and
   `GAME_CLUE_GIVEN: 'game:clueGiven'`.
2. **`validators/gameSchemas.ts`** — add a **shared** `gameClueSchema` used by
   both the socket handler and any internal caller:
   - `word`: a single token after NFKC + `removeControlChars`, length ≤ 40,
     **rejected if it equals — or is a stemming-aware grammatical variant /
     substring of — any board word** (not just exact match; prevents trivially
     winning clues that ruin a playtest or corrupt the training signal).
   - `number`: integer `0..9`.
3. **`scripts/submitClue.lua`** (+ export in `scripts/index.ts`) — atomic writer
   mirroring `endTurn.lua`, executed **under the existing `reveal:{roomCode}`
   lock** so it serializes with reveals. It writes `currentClue`, appends to
   `clues[]`, appends a `ClueHistoryEntry` (type already exists), sets
   `guessesAllowed = number + 1`, bumps `stateVersion`, preserves/falls-back TTL.
   It touches **only** these fields — it changes _who can write `currentClue`_,
   never the win/turn/score rules.
4. **`services/gameService.ts`** — add
   `submitClue(roomCode, team, word, number, spymasterName)`: a thin wrapper that
   validates turn/role, runs the Lua op, then calls `notifyGameMutation(roomCode)`.
5. **`socket/handlers/gameHandlers.ts`** — register
   `socket.on(GAME_CLUE, createGameHandler(...))` enforcing
   `role === 'spymaster' && player.team === game.currentTurn` (reuse the exact
   permission pattern from the reveal handler), then
   `safeEmitToRoom(GAME_CLUE_GIVEN, { word, number, team })`.
6. **Frontend** (human UX; can land just after the harness) — a spymaster-only
   clue input in `frontend/roles.ts` wired to a new
   `EigennamenClient.submitClue(word, number)` (mirror `revealCard` in
   `socket-client.ts`), and a `game:clueGiven` handler in
   `handlers/gameEventHandlers.ts` to render the clue and clear the form.

Until the frontend form lands, a human spymaster playing _with bot clickers_ can
still give clues verbally; pure-bot spymaster seats already work via the server
event.

> **Throwaway prototype (optional).** To watch a self-play loop before
> `game:clue` lands, clues can be temporarily encoded as a specially formatted
> `chat:message` (`##CLUE word 3`) that the clicker bot parses. Explicitly
> disposable — it leaks to the chat UI and cannot set `guessesAllowed`
> server-side — deleted once the real event exists.

---

## 7. Bot identity and data model

A bot is a `Player` Redis record like any other, plus a small config blob.

| Change                                                                                 | Location                                            | Notes                                                                                                                              |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `isBot?: boolean`                                                                      | `types/player.ts` (`Player`)                        | Controller reads it to decide whether to act for a seat.                                                                           |
| `isBot?: boolean`                                                                      | `frontend/multiplayerTypes.ts` (`ServerPlayerData`) | Lets `multiplayerUI-player.ts` render a "Bot" badge (avoids the "looks human but never chats" UX).                                 |
| `bot:{sessionId}:cfg` (new Redis key)                                                  | —                                                   | Stores `BotConfig` = `{ strategyId, skillPreset, seed? }`, validated by `botConfigSchema`.                                         |
| `botId`, `strategyId`, `decisionTime`, `clueEvaluation {targetCards, actuallyGuessed}` | `services/gameHistory/types.ts` (optional fields)   | One schema shared by live and training games; makes clue quality measurable. Populated by `gameHandlerUtils`/`gameHistoryService`. |
| **No changes** to `types[]` / `duetTypes[]` / `cardScores[]` / `revealedBy[]`          | —                                                   | Bot views are subsets built by the existing `getGameStateForPlayer`.                                                               |
| **No new clue types**                                                                  | —                                                   | `currentClue` / `clues[]` / `ClueHistoryEntry` already exist; `submitClue.lua` just populates them.                                |

A bot player is created via a new `botService` (parallel to `playerService`)
that sets `isBot`, assigns team+role, keeps `connected: true`, and persists the
config. Keeping `connected: true` (and touching `lastSeen` each tick) is what
prevents the 10-minute disconnected-player GC from reaping a seat-filling bot
mid-game.

---

## 8. The strategy interface

Pure, synchronous-first contracts. Strategy modules are **forbidden** (via an
ESLint `no-restricted-imports` rule on `server/src/bots/strategies/**`) from
importing redis, sockets, or async IO. Views are structural subsets of the
existing `PlayerGameState`.

```ts
// server/src/bots/strategies/types.ts
import type { CardType, Team, GameMode, Clue } from "../../types";

/** Per-bot deterministic RNG (reuse Mulberry32 from boardGenerator.ts).
 *  Every tie-break / exploration draw MUST flow through this so that
 *  (gameSeed, botSeed) fully reproduces a bot's play. */
export interface SeededRng {
  next(): number; // float in [0, 1)
  int(n: number): number; // integer in [0, n)
}

/** Typed skill knobs — pure data. Adding a difficulty = a new preset only. */
export interface SkillParams {
  temperature: number; // softmax temp over ranking; 0 = argmax (strongest)
  blunderRate: number; // probability of an outright random legal move
  riskAversion: number; // clicker stop-vs-continue + assassin/opponent penalty
  seed: number; // seeds the per-bot SeededRng
  // Style knobs (personae, all optional — neutral defaults keep plain
  // difficulty presets unchanged; see personas.ts):
  defenseBias?: number; // multiplier on the "don't arm the opponent" penalty
  aggression?: number; // 0 = tightest safe clue … 1 = stretch for coverage
  assassinCaution?: number; // multiplier on assassin penalty + safety berth
  commonnessBias?: number; // multiplier on legibility/anti-idiosyncrasy penalties
}

export interface BotContext {
  readonly gameMode: GameMode;
  readonly skill: SkillParams;
  readonly rng: SeededRng;
  readonly memory?: BotSeatMemory; // within-game seat memory (absent = no adjustment) — drives the
  // clicker's clue-debt boost, the spymaster's no-repeat rule
  // (burnedClueKeys: a bounced/undershot clue word is never re-given)
  // and its redundancy discount (prefer cluing un-indicated cards)
  readonly llm?: BotLLMAdvice; // opt-in LLM advice for this decision (absent = normal play)
  readonly guesserTemperature?: number; // team clicker's temperature when it is a known bot —
  // sizes the guesser-safety margin (absent = human/unknown,
  // full misread-tolerant width)
}

/** Spymaster view: full unmasked types[] (+ duetTypes/cardScores per mode). */
export interface BotSpymasterView {
  readonly seat: { team: Team; role: "spymaster" };
  readonly words: readonly string[];
  readonly revealed: readonly boolean[];
  readonly types: readonly CardType[]; // unmasked
  readonly duetTypes?: readonly CardType[]; // duet
  readonly cardScores?: readonly number[]; // match
  readonly currentTurn: Team;
  readonly redScore: number;
  readonly blueScore: number;
  readonly redTotal: number;
  readonly blueTotal: number;
  readonly timerTokens?: number;
  readonly greenFound?: number;
  readonly greenTotal?: number; // duet
  readonly history: readonly unknown[];
}

/** Clicker view: types[] masked to null for unrevealed cards. */
export interface BotClickerView {
  readonly seat: { team: Team; role: "clicker" };
  readonly words: readonly string[];
  readonly revealed: readonly boolean[];
  readonly types: readonly (CardType | null)[]; // null = hidden
  readonly currentTurn: Team;
  readonly currentClue: Clue | null;
  readonly guessesUsed: number;
  readonly guessesAllowed: number;
  readonly redScore: number;
  readonly blueScore: number;
  readonly cardScores?: readonly (number | null)[]; // match: revealed only
  readonly timerTokens?: number;
  readonly greenFound?: number; // duet
  readonly ownRemaining?: number; // public scoreboard info: own cards left (endgame discipline)
  readonly oppRemaining?: number; // public scoreboard info: opponent cards left (pressure override)
  readonly history: readonly unknown[];
}

/** One variant per legal move; translates 1:1 to socket payloads. */
export type BotAction =
  | { kind: "clue"; word: string; number: number }
  | { kind: "reveal"; index: number }
  | { kind: "endTurn" }
  | { kind: "noop" };

export interface SpymasterStrategy {
  readonly strategyId: string;
  chooseClue(
    view: BotSpymasterView,
    ctx: BotContext,
  ): BotAction | Promise<BotAction>;
}
export interface ClickerStrategy {
  readonly strategyId: string;
  chooseGuess(
    view: BotClickerView,
    ctx: BotContext,
  ): BotAction | Promise<BotAction>;
}

/** Adding a bot type = one entry in registry.ts. */
export interface StrategyFactory {
  readonly strategyId: string;
  makeSpymaster?(skill: SkillParams): SpymasterStrategy;
  makeClicker?(skill: SkillParams): ClickerStrategy;
}

/** Persisted per-bot descriptor (Redis bot:{sessionId}:cfg). */
export interface BotConfig {
  readonly strategyId: string;
  readonly skillPreset: string; // 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert' | …
  readonly seed?: number;
}
```

`decide()` is sync-by-default and pure; an async return is allowed **only** for
future embedding/LLM-backed bots and must still never touch redis/socket.

---

## 9. The shared decision helper (`playOneAction`) and the live controller

`server/src/bots/playOneAction.ts` is the **anti-divergence chokepoint**. Given a
game, the seat strategies, and a context, it:

1. determines whose action it is for `currentTurn` (spymaster if
   `currentClue` is null, else clicker);
2. builds the role-masked view via `getGameStateForPlayer`;
3. calls the strategy;
4. returns an internal `EngineEvent[]` mirroring `RevealResult`/`EndTurnResult`,
   so live adapters translate 1:1 to socket payloads.

A parity test asserts its view construction equals `getGameStateForPlayer`.

`server/src/bots/botController.ts` (singleton, registered at socket init):

- `onGameMutation(roomCode)` → **defer** (`queueMicrotask`/`setImmediate`) →
  `tickRoom(roomCode)`. Deferral is mandatory because `notifyGameMutation` fires
  _inside_ the `reveal:{roomCode}` lock; reacting synchronously would re-enter a
  held lock.
- `tickRoom` loads the game, finds the acting seat, and if it's a bot, calls
  `playOneAction` then applies via `gameService.*`. The new mutation re-fires the
  notifier, cascading to the next action.
- A **per-room in-flight guard** (re-entrancy flag) prevents double-acting when
  multiple notifications arrive.
- Touches `lastSeen`/keeps `connected: true` each tick so bots survive cleanup.
- Stale-snapshot safety is free: if a bot computes a move against an outdated
  view, the `reveal:{roomCode}` lock + Lua preconditions reject it
  (`NOT_YOUR_TURN`, `ALREADY_REVEALED`).
- Optional skill-jittered debounce (50–150 ms) so bots feel natural to humans
  (off in headless mode).

---

## 10. Bot types (the "various types")

Added one registry entry at a time. The catalogue grows; the interface does not.

The five strategies that shipped (`registry.ts` `STRATEGY_IDS`):

| Strategy             | Role      | How it works                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `randomClicker`      | clicker   | Uniform random over legal unrevealed indices. Baseline / regression anchor.                                                                                                                                                                                                                                                                                                                                                                                            |
| `greedyClicker`      | clicker   | Ranks unrevealed cards by semantic similarity to `currentClue.word`; reveals the top candidate; continues until `guessesAllowed` or a stop heuristic (risk-gated). Duet- and match-aware internally: it branches on `view.gameMode` and weights match `cardScores` rather than shipping as separate strategies.                                                                                                                                                        |
| `cautiousClicker`    | clicker   | `greedyClicker` that ends turn early when the top candidate's similarity margin over the next is thin (careful human model).                                                                                                                                                                                                                                                                                                                                           |
| `randomSpymaster`    | spymaster | Emits an arbitrary legal clue word + number. Degenerate driver so the harness runs **with no semantic assets**.                                                                                                                                                                                                                                                                                                                                                        |
| `embeddingSpymaster` | spymaster | Generates clue candidates from the active semantic backend (curated association table by default; word vectors via `semantics/vectorBackend.ts` when an embeddings asset is present); picks the candidate maximizing own-card coverage while keeping a graded assassin berth and defensive margins. Match- and duet-aware internally (value-weighted targets, duet green hunting). Falls back to lexical similarity for out-of-vocabulary custom-list words (see §20). |

Early drafts of this spec sketched additional separate strategies
(`numberOnlySpymaster`, `mctsLiteSpymaster`, `duetCooperativeClicker`,
`matchAwareClicker`/`matchAwareSpymaster`). None were built as registry
entries: mode-awareness was folded _into_ `greedyClicker`/`embeddingSpymaster`,
and no search-based spymaster exists.

---

## 11. Skill model (the "various skill")

- Skill is a **typed `SkillParams` bundle** (`temperature`, `blunderRate`,
  `riskAversion`, `seed`, plus the optional style knobs of §11.1) — not a
  single 0–1 scalar. More expressive while staying pure data.
- **Named presets** in `server/src/bots/presets.ts` — a five-rung ladder
  (`novice` → `beginner` → `intermediate` → `advanced` → `expert`), referenced
  by string from the Add-Bot UI and the tournament spec:
  - `novice` — high temperature, high blunder rate, low risk aversion.
  - `intermediate` — moderate temperature/blunder, balanced risk aversion.
  - `expert` — temperature → 0 (argmax), blunder → 0, calibrated risk aversion.
    (The ladder is tuned monotonic against the embeddings tournament; a persona
    id from `personas.ts` is a drop-in replacement for a preset id.)
- **Orthogonal to type:** any `(strategyId, skillPreset)` pair is valid. A weak
  expert-family bot and a strong novice-family bot are both expressible without a
  combinatorial difficulty matrix.
- **Determinism:** the triple `(strategyId, skillParams.seed, gameSeed)` fully
  reproduces a bot's play because every draw flows through the per-bot
  `SeededRng` (Mulberry32). A solo playtester can reproduce an exact buggy game;
  a tournament regression is a byte-diff in the NDJSON results.

### 11.1 Style knobs and personae (the "meaningfully different playstyles")

Difficulty alone (temperature/blunder/risk) makes a bot _stronger or weaker_ but
not _different in character_. Four optional **style knobs** on `SkillParams`
shape how a bot of a given strength plays — its personality — independently of
how strong it is:

| Knob                  | Effect in `scoreClue`                                                                                                                                                                         | Low                                      | High                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `aggression` (0–1)    | Shrinks the safety margin (down to ½) and adds a coverage bonus, so more own cards ride one clue; on the clicker it loosens the stop-cliff and unlocks the disciplined `number+1` bonus guess | tight, reliable small numbers            | gutsy 2s/3s/4s on thin margins             |
| `defenseBias` (×)     | Multiplies the "don't arm the opponent" penalty                                                                                                                                               | ignores the opponent's board             | refuses to hand them a clue                |
| `assassinCaution` (×) | Multiplies the assassin penalty **and** its soft safety berth                                                                                                                                 | flirts closer to the assassin            | wide assassin wall                         |
| `commonnessBias` (×)  | Multiplies the robustness penalties: hot halos (high best non-own relatedness) and rare clue words (via the backend's optional `commonness()` frequency prior)                                | happily off-kilter, obscure associations | insists on legible, common-knowledge clues |

All default to neutral (aggression 0, defenseBias 1, assassinCaution 1,
commonnessBias 1) via `resolveStyle`, so a plain difficulty preset behaves as
before. The base `margin` floor is applied regardless, and the assassin berth
additionally has a **hard, persona-independent floor** (`ASSASSIN_BERTH_FLOOR`):
recklessness buys bigger numbers, never a thinner assassin wall — even the
boldest persona can never make the assassin the clicker's top card nor let an
intended card hug it. (The berth only applies while an assassin remains
unrevealed — with none left there is nothing to steer clear of.)

**Guesser-competence margin** (persona-independent): the field `margin` is the
buffer that keeps an own card far enough ahead of the brightest non-own that the
_guesser_ takes it and not a look-alike — so its right size depends on how noisily
the guesser reads, not on the giver's caution. The spymaster scales `baseMargin` by
its own team clicker's competence (`guesserMarginScale` from
`BotContext.guesserTemperature`): a known low-temperature (argmax) bot clicker earns
a tight margin (much more coverage — strong self-play ceiling utilization ~0.5→~0.83,
expert-ladder win-rate 83%→90%), while a noisy bot clicker — or an unknown/human
guesser, where `guesserTemperature` is absent — keeps the full misread-tolerant
width. It only ever RELAXES for a known-competent guesser and never tightens for a
human, so a bot spymaster's clues to a human teammate are unchanged; the assassin
berth/floor above are untouched (this sizes the field margin only). Lesson 45 /
ledger 2.32.

**Turn economy** (persona-independent, shared by every spymaster): a clue that
safely covers _every_ remaining own card wins the board this turn, is decisively
preferred (`WIN_BONUS`), and may carry its true count past the normal
`MAX_CLUE_NUMBER` cap of 4 (up to the server-wide `CLUE_NUMBER_MAX` of 9); when
the opponent is one card from winning, safety margins shrink hard
(`DESPERATION_MARGIN_FACTOR`) because banking a safe single forfeits the game —
the assassin floor is never relaxed; and among partial clues, ones that strand
leftover own cards away from any related partner pay `STRAND_WEIGHT` per
stranded card for the future single-card turns they create. (A graded
race-aware margin — thinner whenever trailing the card count — was tried and
measurably REGRESSED mirror-match turn counts; only the binary last-stand
trigger earned its keep.)

**Personae** (`server/src/bots/personas.ts`) bundle a difficulty with a
playstyle into a named, user-facing identity. They live in the same namespace as
the difficulty presets — `resolveSkill` checks personae first — so a persona id
is a drop-in for any `skillPreset` (Add-Bot UI, bot config, harness spec):

| Persona              | Tier         | Character                                                                  |
| -------------------- | ------------ | -------------------------------------------------------------------------- |
| **The Strategist**   | expert       | Scary-good all-rounder: strong coverage, real defense, wide assassin berth |
| **The Sharpshooter** | expert       | Precise, low-variance: small, unmistakable clues that almost never misfire |
| **The Guardian**     | expert       | Defensive wall: refuses to arm the opponent, even at coverage cost         |
| **The Daredevil**    | expert       | High-roller: big numbers on thin margins — huge upside, real risk          |
| **The Maverick**     | intermediate | Creative, off-kilter: surprising associations, sometimes brilliant/odd     |
| **The Apprentice**   | novice       | Beginner: wobbly reads, frequent blunders, an easy warm-up                 |

The knob values were tuned against the diagnostics harness (§12.1) so each
persona shows a distinct clue-number distribution, leak rate, and assassin
exposure — verified in `__tests__/bots/personas.test.ts` and the persona
strength ladder.

### 11.2 As-built behavior contracts

Gameplay invariants the shipped strategies guarantee, beyond §11.1's knobs and
turn economy. Tuning history for each lives in
[BOT_CLUE_LESSONS.md](BOT_CLUE_LESSONS.md) (ledger numbers cited).

**Guessing (clicker/advisor):**

- **Plausible-set noise.** Temperature/blunder noise only ever draws from the
  _plausible_ set — cards scoring ≥ half the best card's clue-fit — so a weak
  bot loses by MISREADING real candidates, never by a blind pick onto the
  clue-unrelated assassin. Easy bots feel gently beatable, not swingy.
- **Scale-invariant, confidence-scaled softmax** (`selectIndexByTemperature`,
  mirrored by the advisor's sampler): weights read relative scores and the
  effective temperature shrinks when the whole field is weak
  (`TEMPERATURE_CONFIDENCE_REF`), so a compressed backend scale can't turn
  selection near-uniform. Near-no-op on the curated table scale. Ledger 2.29.
- **Provenance-aware guessing.** Every backend reports whether a pair's score
  is real semantic knowledge or the lexical bigram floor
  (`SemanticBackend.hasSignal`); `guessRetrieval` damps lexical-floor scores
  (`LEXICAL_GUESS_DAMP`) so a spelling coincidence (SUNDIAL→INDIA) never
  outranks a genuine read. A clue with NO semantic signal against any live
  card gets one least-bad guess and then banks the turn; the advisor labels
  such suggestions spelling-only. The **spymaster's danger halos stay on raw
  retrieval** — orthographic confusion is a real hazard for a human guesser,
  so the damp never weakens safety margins.
- **Inflection folding.** The association table folds English inflections
  (ANIMALS→ANIMAL, SWIMMING→SWIM) at lookup, so inflected human clues still
  hit the concepts it knows.
- **Core + stretch discipline.** A relative-cliff stop (bank when the next
  card is steep-below the last take, absolutely weak, AND blurred into its
  alternatives) plus an aggression-gated `number+1` bonus guess taken only
  when the top leftover is tighter than the core. Ledger 2.11.
- **Late-game pressure override** (`PRESSURE_OPP_REMAINING_MAX`): when the
  clue's remaining grant covers ALL own unrevealed cards (win in reach) or the
  opponent sits at match point (≤1 card left, so a banked turn's option value
  is ~zero), every caution gate yields and the clicker takes the deterministic
  argmax — including the bonus guess, with no aggression requirement — because
  in those states NOT guessing is the play that loses the game. Pressed picks
  are argmax, never temperature samples; duet is exempt (no opponent).

**Clue selection (spymaster):**

- **No-repeat rule.** A clue word whose earlier frame FAILED (bounced or
  undershot) is never re-given (`burnedClueKeys` filters the candidate pool
  via seat memory): the guesser demonstrably couldn't read it, so the designed
  recovery is a DIFFERENT word — composing with the clicker's clue-debt boost,
  which skips same-word frames. A fully-delivered clue may repeat for fresh
  cards (the classic "more of the same" tactic).
- **Redundancy discount.** Targets an owed (undelivered, unbounced) frame
  still points at are discounted (`REDUNDANCY_WEIGHT`, graded by
  `guessRetrieval` fit against `INDICATED_FIT_REF`): the clicker converts owed
  cards with later turns' bonus guesses, so each new clue prefers transmitting
  NEW information. A preference, not a ban — a decisively better covered-only
  clue still wins; bounced frames are void.
- **Promise trim, backend-relative floor.** The number is a promise: a tail
  card the guesser won't chase is trimmed off it, with `PROMISE_FLOOR` scaled
  to the board's strongest own pull (clamped to only ever relax, never below a
  noise guard) so compressed vector scales don't trim safe 2s into 1s.
  Ledger 2.30.
- **Embeddings clue hygiene.** With a `nearest()`-capable backend the
  spymaster generates candidates from the whole model, so `isClueBoardSafe`
  (`strategies/clueSafety.ts`, wired into `generateClueCandidates`' legality
  choke point) additionally rejects cross-language cognates / orthographic
  near-duplicates of a board word (the REVOLUCIÓN/REVOLUTION self-leak) and
  tokens using a non-ASCII letter absent from the board. The board bake
  restores a **commonness prior** for alphabetical sources
  (`build-board-vectors.mjs --freq`) so the rank→commonness rarity tax works —
  decisive for recognizability (85% → ~19% of clue words outside the top-50k
  without/with it; BOT_CLUE_LESSONS Round 6).
- **Clue-capitalization house rule** — mixed-case denotes the pop-culture
  reference, lowercase the common sense, canonical acronyms carry the signal:
  see §20 "The clue-capitalization signal"; clue case is preserved end-to-end.

---

## 12. The training ground (headless harness)

`server/src/bots/harness/runMatches.ts`, exposed as `npm run bots:train`
(mirrors the existing `loadtest` convention).

**Execution model**

- `TournamentSpec` (Zod-validated): entrants (`strategyId` + `skillPreset` per
  seat), schedule (round-robin or Swiss), `gamesPerPair`, `gameMode`, `baseSeed`.
- The runner expands the schedule into deterministic game jobs; each job's seed
  is `hashString(baseSeed + ':' + pairId + ':' + gameIndex)`.
- Jobs are sharded across `worker_threads`, one Redis client (or
  `createMockRedis`) per worker — CPU-bound, near-linear scale, no socket
  overhead.
- Per match: `gameService.createGame(roomCode, { gameMode, seed })` with
  `turnTimer: null`; instantiate per-seat strategies via the registry; loop the
  shared `playOneAction` applying moves via `gameService.submitClue/revealCard/
endTurn` until `gameOver`.

**Validity staging (de-risks "train against the wrong rules")**

- The **first** corpus is generated against the real `gameService`/Lua path
  (full production rules).
- A faster **pure-rules fast path** is introduced **only after** the
  Lua-vs-TS parity gate (§15) is green across all three modes.
- The socket-mode fidelity sample cross-validates that any fast path still
  matches wire behavior.

**Scoring**

- `MatchResult` per game: `{ seed, gameMode, redConfig, blueConfig, winner,
redScore, blueScore, turns, clues, assassinHit, durationMs }`.
- Aggregate to per-strategy **Elo** (or TrueSkill), plus win-rate with a Wilson
  interval, average clue efficiency (`targetCards` intended vs actually guessed),
  and assassin-hit rate.
- **Mode-specific fitness** (essential): classic/match = win + margin +
  cardScore total; **duet uses a graded co-op signal** (greens-found +
  tokens-remaining + turns-to-win), _not_ binary win/loss — pure win/loss gives
  almost no training gradient in cooperative mode.

**Results store**

- Append-only **NDJSON** corpus written by the harness (own store, not under a
  committed `results/` dir — see `server/src/bots/harness/` for the as-built
  output handling). The `gameHistoryService` TTL/cap make Redis history unusable
  as a corpus; history stays for replay/attribution only.

**Iteration loop**

- Tweak a strategy/preset → re-run with the same `baseSeed` → diff
  `leaderboard.json`. Seeded + deterministic ⇒ a regression is a byte-diff.

### 12.1 Clue diagnostics harness (`npm run bots:analyze`)

`bots:train` tells you **who wins**; the diagnostics harness
(`server/src/bots/harness/analyze.ts`) tells you **why a spymaster's clues are
weak**, so personae and scoring weights can be tuned against real numbers.

It reuses the same self-play loop via a new `onEvent` hook on `playEngineGame`
(no second game loop), reconstructs each clue's outcome, and compares the clue
number the bot actually gave against the board's **theoretical safe ceiling**
(computed with the configured backend at a fixed `REF_MARGIN` yardstick, so every
persona is judged alike). Per clue it records: own cards landed, opponent leaks,
neutral misfires, assassin grazes, the turn-end reason, and whether the
spymaster had _no_ safe lead (a best-effort/OOV fallback).

Aggregated per persona it reports clue-number distribution, delivery rate
(`ownGained / intendedNumber`), **ambition** (`avgNumber / avgSafeLead`), and
leak / misfire / assassin / fallback rates, then flags concrete **strategy
gaps** via thresholds:

- _under-cluing_ — numbers below the board's safe ceiling (only when `ambition`
  shows real headroom, so a coarse-backend low ceiling isn't a false positive);
- _poor delivery_ — the clicker takes < 55% of intended cards;
- _leaky_ / _imprecise_ — clues also point at the opponent / a neutral too often;
- _assassin exposure_ — hits the assassin > 2% of clues;
- _weak coverage_ — > 25% of clues have no safe lead (backend covers the board
  poorly — the signal to enable embeddings, see [BOT_EMBEDDINGS.md](BOT_EMBEDDINGS.md)).

Output is a console table + `results/analysis-<stamp>.json`. The pure functions
(`referenceLead`, `aggregate`, `detectGaps`, `analyzeGames`) are deterministic
and unit-tested in `__tests__/bots/analyze.test.ts`. Flags:
`--mode classic|duet|match`, `--games <perPair>`, `--seed <baseSeed>`.

---

## 13. Socket events (SHIPPED)

> **Status: DONE.** All four events below are implemented:
> `game:clue` / `game:clueGiven` in `socketConfig.ts` + `gameHandlers.ts`, and
> `bot:add` / `bot:remove` (`BOT_ADD` / `BOT_REMOVE`) in `socketConfig.ts` +
> `socket/handlers/botHandlers.ts`. Verify guards/payloads against the code.

| Event                                   | Direction       | Guard                                          | Payload                                                                                                        |
| --------------------------------------- | --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `game:clue`                             | client → server | `role === 'spymaster' && team === currentTurn` | `{ word, number }`                                                                                             |
| `game:clueGiven`                        | server → client | broadcast to room                              | `{ word, number, team }`                                                                                       |
| `bot:add`                               | client → server | host-only (`createHostHandler`)                | `{ team, role, strategyId, skillPreset }`                                                                      |
| `bot:remove`                            | client → server | host-only                                      | `{ sessionId }`                                                                                                |
| `room:playerJoined` / `room:playerLeft` | server → client | **reused, not new**                            | existing payloads, emitted when bots are added/removed so the player list renders bots with no frontend change |

---

## 14. Files and modules

> **As-built.** The tree below reflects the **actual** `server/src/bots/`
> layout (strategies collapsed into `clickers.ts` / `spymasters.ts`; flat
> `semantics/` files; an added `engine.ts` and `rng.ts`; a richer `harness/`).
> The original proposal split strategies into one file per type and put
> semantic backends under a `backends/` subdir — the shipped code does not.
> `server/src/bots/` is authoritative.

```
server/src/bots/
├── engine.ts               # core game-loop driver shared by live + harness
├── rng.ts                  # Mulberry32-based per-bot SeededRng
├── playOneAction.ts        # pure shared decision helper (live + harness)
├── botController.ts        # singleton; onGameMutation subscriber, tickRoom, reentrancy guard, lastSeen refresh
├── presets.ts              # named SkillParams presets (5-rung novice→beginner→intermediate→advanced→expert); routes persona ids
├── personas.ts             # persona registry (difficulty + style knobs) → SkillParams; resolvePersona/isPersona
├── strategies/
│   ├── types.ts            # BotAction, Spymaster/ClickerStrategy, views, SeededRng, SkillParams (+ style knobs), StyleParams/resolveStyle, BotContext, BotConfig
│   ├── registry.ts         # strategyId → StrategyFactory; one entry per type
│   ├── clickers.ts         # clicker strategies (random/greedy/cautious; duet- and match-aware internally)
│   ├── spymasters.ts       # spymaster strategies (random/embedding; match- and duet-aware internally)
│   ├── advisor.ts          # advisor role: ranked guess suggestions, never acts
│   └── clueFrame.ts        # sense/frame-switch resolution shared by clicker + advisor
├── semantics/
│   ├── backend.ts          # SemanticBackend interface: relatedness + edgeInfo?/collocation? channels
│   ├── associationIndex.ts # weighted EdgeMeta index (Map<string, Map<string, EdgeMeta>>)
│   ├── tableBackend.ts     # baked curated association table (dictionary-word fallback)
│   ├── properAssociations.ts # clue-capitalization PROPER_ASSOCIATIONS/RIVALS/HYPERNYMS reference table
│   ├── mapBackend.ts       # custom semantic-map overlay (npm run bots:map)
│   ├── vectorBackend.ts    # pre-trained word vectors (fastText/GloVe/word2vec/Numberbatch)
│   ├── selectBackend.ts    # lazy backend selection via BOT_EMBEDDINGS_PATH
│   └── associations.ts     # baked clue→board-word table for the default list (generated; see §20)
└── harness/
    ├── runMatches.ts       # headless tournament runner
    ├── playGame.ts         # single-game self-play loop (+ onEvent instrumentation hook)
    ├── analyze.ts          # clue diagnostics harness (bots:analyze); per-persona gap report (§12.1)
    ├── parity.ts           # Lua-vs-TS parity harness (see §15)
    ├── scoring.ts          # Elo/TrueSkill + mode-specific fitness + Wilson interval
    └── types.ts            # MatchResult, TournamentSpec, harness types

server/src/services/botService.ts                 # buildBotPlayer/removeBotPlayer; sets isBot, team+role, connected:true; persists bot:{sessionId}:cfg
server/src/socket/handlers/botHandlers.ts          # host-only bot:add / bot:remove via createHostHandler
server/src/validators/botSchemas.ts                # botConfigSchema, botAddSchema
server/src/scripts/submitClue.lua (+ index.ts)     # atomic clue writer under reveal:{roomCode} lock

eslint.config.js  → no-restricted-imports on server/src/bots/strategies/** (forbid redis/socket/async-IO)
server/src/__tests__ → parity suite, determinism suite, gameClueSchema suite, playOneAction view-parity, socket-payload contract
```

---

## 15. Per-mode considerations and the parity gate

Rule duplication is **bounded, not ignored**. We do not extract a full engine on
day one, but we do add a **blocking CI parity gate** that diffs the pure TS rules
(`revealEngine.ts`) against production Lua (`revealCard.lua` / `endTurn.lua`) over
thousands of randomized seeds across **all three modes**.

- **Match mode is the highest-risk area** — its score accumulation currently
  lives only in Lua + `finalizeMatchRound`, so a pure-TS mirror is most likely to
  drift there.
- **Duet** has the trickiest view logic (per-side `types[]` vs `duetTypes[]`
  lookup keyed on `currentTurn`) and a token economy that needs its own
  strategy branch and graded fitness.
- **Classic** is the simplest and ships first.

Appendix A summarizes the per-mode rules a bot engine must respect.

---

## 16. Phased roadmap

> **Status:** Phases 0 and 1 have largely shipped — the `game:clue` channel,
> the bot subsystem under `server/src/bots/` (`engine.ts`, `playOneAction.ts`,
> `botController.ts`, strategies, presets), and the `bot:add` / `bot:remove`
> host handlers all exist. Later phases (harness scoring, embedding spymasters,
> per-mode polish) are partly in tree under `server/src/bots/harness/` and
> `server/src/bots/semantics/`; treat the estimates below as the original plan
> and the code as the source of truth.

| Phase                | Deliverable                                                                                                                                                                                                                                                                                                                                                        | Est.  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **0** ✅ **SHIPPED** | `game:clue` feature, decoupled from bots: socketConfig events, shared stemming-aware `gameClueSchema`, `submitClue.lua` under the reveal lock, `gameService.submitClue`, the handler (reusing the reveal permission pattern), cross-mode tests, minimal frontend clue form + `EigennamenClient.submitClue` + `game:clueGiven` handler. Independently human-usable. | 3–5 d |
| **1** ✅ **SHIPPED** | Solo playtest, **classic** mode: `isBot` field, `botService`, `botController` on `onGameMutation`, `playOneAction`, `bot:add/remove` host handlers, reentrancy guard + `connected:true`/`lastSeen` cleanup survival, `randomClicker` + `greedyClicker`. Playable bot-filled room with human or bot clues.                                                          | 5–8 d |
| **2**                | Parity gate + harness skeleton: share the already-pure `revealEngine`/`boardGenerator` rules; add the blocking Lua-vs-TS parity test across all three modes; `runMatches.ts` running the first corpus against the real `gameService`/Lua path via `createMockRedis`; `worker_threads` sharding; `MatchResult` + NDJSON output.                                     | 4–6 d |
| **3**                | Spymaster strategies + skill model: `registry`, `presets.ts`, per-bot `SeededRng` wiring, `embeddingSpymaster` (pluggable vector backend). (An `mctsLite` search spymaster was sketched here but never built.) Add 2–4 d if bundling/licensing an embedding set.                                                                                                   | 4–7 d |
| **4**                | Scoring + iteration loop: Elo/TrueSkill, mode-specific + graded-duet fitness, Wilson-interval win-rate, `leaderboard.json`, seed-stable regression diffing, optional pure-rules fast path **only after** the parity gate is green, periodic socket-mode fidelity sample.                                                                                           | 4–6 d |
| **5**                | Per-mode coverage + polish: duet token-economy and match score-aware branches with targeted tests (reuse `duetMode`/`matchMode` patterns), `isBot` UI badge, bot attribution in history.                                                                                                                                                                           | 3–5 d |

**Total ≈ 16–26 dev-days** to a credible training ground, with a playable
solo-test build after Phase 1.

---

## 17. Testing strategy

All existing quality gates remain non-negotiable (`npm test` at backend
80/75/85/80 and frontend 70s, `lint`, `format:check`, `typecheck`). Bot-specific
suites:

- **Lua-vs-pure parity gate (blocking CI, all 3 modes)** — pure rules vs
  production Lua over thousands of seeds; fail the build on any divergence.
- **Bot-determinism suite** — `(strategyId, skillSeed, gameSeed)` reproduces an
  identical action sequence byte-for-byte across reruns.
- **`gameClueSchema` unit tests** — single-token enforcement, NFKC +
  `removeControlChars`, stemming-aware rejection of board-word variants /
  substrings, `number 0..9` bounds — landed **before** enabling spymaster bots.
- **`playOneAction` view-parity test** — its view construction equals
  `getGameStateForPlayer` for the same `(game, player)`, so live and training
  paths cannot silently fork.
- **Socket-payload contract test** — diff bot-produced broadcasts
  (`game:cardRevealed`, `game:clueGiven`, `room:playerJoined`) against
  `socket-events.ts` types to catch protocol drift.
- **Reentrancy/race tests** — a bot acting on a stale `onGameMutation` snapshot
  is rejected by the `reveal:{roomCode}` lock + Lua preconditions; the per-room
  in-flight guard prevents double-acting.
- **Cleanup-survival test** — bots survive the 10-minute disconnected-player GC.
- **Periodic socket-mode fidelity sample** — a few full games through real
  `socket.io-client` exercising auth, Zod, rate limits, and the lock (reuse the
  `raceConditions` / `fullGameFlow` integration patterns).
- **Per-mode strategy tests** — duet token-economy and match score-aware
  branches, extending the existing `duetMode`/`matchMode` fixtures beyond the
  classic-only mocks.

---

## 18. Risks and mitigations

| Risk                                                                                                                                                     | Mitigation                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Engine/Lua divergence** — bots train against rules that differ subtly from production (esp. match scoring, duet perspective lookup).                   | Hard CI parity gate across all 3 modes over thousands of seeds; first corpus generated against real Lua; fast path only after the gate is green.                     |
| **Clue-legality gap** — a permissive schema lets a bot/human submit an illegal or trivially-winning clue, corrupting training and the playtest illusion. | Shared stemming-aware `gameClueSchema` used by both handler and internal callers; unit-tested before spymaster bots are enabled.                                     |
| **Re-entrancy / race** — a bot acts on a stale snapshot and double-reveals or moves out of turn.                                                         | Controller defers reactions out of the lock; per-room in-flight guard; existing `reveal:{roomCode}` lock + Lua preconditions reject bad moves.                       |
| **Bot player cleanup** — the 10-minute GC reaps a seat-filling bot mid-game.                                                                             | Controller keeps `connected:true` / touches `lastSeen` each tick; explicit survival test; never schedule bots into `scheduled:player:cleanup`.                       |
| **Spymaster quality / semantic data** — weak without embeddings; bundling vectors adds size + GPL-v3 license obligations.                                | Pluggable vector backend; small curated default table; gate strong-spymaster claims behind Phase 3; ship clicker-focused training + human-spymaster solo play first. |
| **Live load coupling** — hot live bot rooms add CPU/Redis load to the production game server.                                                            | Keep large-scale scoring in the headless `worker_threads` harness; cap concurrent live bot rooms via config.                                                         |
| **Mode-coverage scope creep** — duet/match are materially harder than classic; a "classic-only" deliverable could masquerade as complete.                | Explicitly phase classic-first; stub duet/match with targeted tests before claiming full coverage.                                                                   |
| **Two-path subtle divergence** — in-process harness skips auth/locks/timing and could mislead.                                                           | Periodic socket-mode fidelity sample cross-validates; `playOneAction` is the single shared chokepoint so the _decision_ logic cannot fork.                           |

---

## 19. Open questions (need a decision before/within the relevant phase)

1. **Semantic backend & custom word lists** — fully analyzed in **§20**.
   _Recommendation:_ a tiered, pluggable `SemanticBackend` — ConceptNet
   Numberbatch (CC BY-SA 4.0 → GPL-v3-compatible, strong named-entity coverage,
   multilingual) as the strong default, a small curated table as the
   license-clean fallback, and an LLM used **offline** to index custom lists
   (never in the training hot path). The harness still defaults to
   `randomSpymaster` so it runs with **no** ML assets.
2. **Long-term rules ownership** — thin `revealCard.lua` to a CAS-only persist
   with rules in the service under the existing lock (eliminating duplication
   entirely), or keep the parity gate as a permanent state? _Defer_ until the
   parity gate proves stable.
3. **Live bot-room cap** — what concurrent-live-bot-room limit, enforced where,
   to bound CPU/Redis coupling on the game server?
4. **Clue `number` semantics** in unlimited variants — _resolved in Phase 0_:
   a clue `number` of N grants N+1 guesses and **`number = 0` means unlimited**
   (`guessesAllowed = 0`), matching the reveal engine's existing convention.
5. **Elo vs TrueSkill**, and how to seed initial ratings for new strategy
   versions across iteration runs.
6. **Duet fitness weighting** (greens-found vs tokens-remaining vs
   turns-to-win) — needs empirical calibration to produce a useful gradient.
7. **Mixed human+bot pacing** — how aggressively should bots debounce
   (skill-jittered 50–150 ms) to feel natural without making the room feel laggy?
8. **Semantic asset versioning** — embed an asset hash in `BotConfig` so a
   `(gameSeed, botSeed)` reproduction is valid only against a pinned vector file?

---

## 20. Semantic data, custom word lists & OOV

> **Implementation status.** The tiered, pluggable backend described here is
> shipped: lexical floor (`backend.ts`) → baked association table
> (`tableBackend.ts`) → optional pre-trained word vectors
> (`vectorBackend.ts`, fastText / GloVe / word2vec / ConceptNet Numberbatch),
> selected lazily by `selectBackend.ts` via `BOT_EMBEDDINGS_PATH` (or
> auto-detected at the well-known download/bake locations when unset). OOV words
> fall through the chain, so custom lists always get a signal — and every
> backend reports per-pair PROVENANCE (`hasSignal`), so the guesser side
> (`guessRetrieval`) damps lexical-floor scores, banks an uninformed streak
> after one guess, and the advisor labels spelling-only suggestions. Operator
> guide: [docs/BOT_EMBEDDINGS.md](BOT_EMBEDDINGS.md).

The game is **Eigennamen** — _proper nouns_ — and custom word lists (a stored
`wordListId`, or an inline `wordList` passed to `game:start`) are a first-class,
expected use case, not an edge case. Proper nouns, names, neologisms, multi-word
entries, and other-language words are exactly what static semantic resources
handle worst (**out-of-vocabulary**, OOV). This reshapes the §19-#1 backend
choice.

### Who breaks, who degrades

- **Clicker bots degrade gracefully.** They rank the 25 board words by
  relatedness to `currentClue.word`; when a word is OOV they fall back to
  lexical similarity (shared substrings / edit distance), the clue number, and
  `riskAversion`. A clicker always has a legal move.
- **Spymaster bots are the fragile side.** They must _produce_ a clue word. A
  curated table cannot for unknown words; a static embedding model has no vector
  for OOV board words and no clue vocabulary to search. This is where custom
  lists bite.
- **Clue legality is unaffected.** `isClueLegalForBoard` is pure string logic
  and already works for any board words. (Only caveat: the substring rule can
  over-reject with short custom words — tunable.)

### Two regimes

1. **Training ground — vocabulary is controlled.** Tournaments run only on
   _pre-indexed_ lists: the four bundled lists plus any onboarded list. A custom
   list joins the corpus by being **indexed once, offline**, before use — so it
   never breaks determinism or throughput.
2. **Live solo-play — vocabulary is arbitrary.** The bot handles OOV at runtime
   via a tiered spymaster fallback:
   1. in-vocab → embeddings (fast, free, deterministic);
   2. OOV → **fastText subword vectors** yield a vector for _any_ token (proper
      nouns / morphology), offline — but its pretrained Wikipedia vectors are
      CC BY-SA 3.0, so train/host rather than bundle into a GPL-v3 repo;
   3. still stuck → **LLM backend (Claude)** — the right tool for arbitrary
      proper-noun / multilingual lists; acceptable for _one live game_, never
      the training hot path;
   4. floor → lexical similarity on both seats (the curated table's
      dictionary-word fallback), so the game never stalls.

### The unifying primitive: a hash-keyed association index

`server/src/bots/semantics/associations.ts` precomputes the word→word
relatedness a strategy needs and **caches it keyed by a content hash of the
normalized board word set** — _not_ by `wordListId`, so an ephemeral inline
`wordList` and a stored list share the cache and identical lists collide on one
entry.

- The first bot game on a new list pays the indexing cost once (embedding
  lookups, or **one offline LLM pass**); every later game is cheap,
  deterministic, and reproducible.
- This is the ideal use of Claude: index a custom list _offline_, bake the
  associations, then bots play deterministically against them — LLM quality, no
  runtime LLM, no nondeterminism.
- Extends the §11 reproducibility guarantee to
  `(strategyId, botSeed, gameSeed, vectorAssetHash, wordlistAssocHash)`.

The shipped baked table for the default word list lives in
`server/src/bots/semantics/associations.ts` and is **generated, not hand-edited**:
edit the concept→board-word groups in `scripts/generate-associations.mjs` (every
target is filtered against `DEFAULT_WORDS`, so only real board words survive) and
regenerate with `npm run bots:associations` (currently 91 clue concepts / 704
verified pairs). The `tableBackend` falls back to lexical similarity for any pair
not covered, so custom word lists still degrade gracefully.

### Custom semantic maps (SHIPPED — the prepared-list path)

The "give the bots the list in advance" primitive is live: `npm run bots:map`
(scripts/build-semantic-map.mjs) sends a custom word list to Claude in batches
and curates the same two structures the default list ships with — concept
groups and fame-rated proper-noun references (canonical case, honouring the
clue-capitalization signal) — into a JSON **semantic map**
(`semantics/mapBackend.ts`). At runtime every map in `BOT_SEMANTIC_MAPS_DIR`
(default `src/bots/data/semantic-maps`) is merged into one overlay in the
backend chain:

```
vectors? → custom maps → baked table → lexical
```

Merged (rather than hash-keyed per list) because associations are pairwise
facts that only fire when their words are on the board — one directory serves
any number of lists, and unprepared lists degrade to lexical exactly as
before. The overlay reuses the baked table's scoring machinery
(`semantics/associationIndex.ts`) so both grade identically, and per-key
commonness/fame from the map feeds the spymaster's rarity penalty. See
[BOT_SEMANTIC_MAPS.md](BOT_SEMANTIC_MAPS.md).

### Backend choice, updated

- **ConceptNet Numberbatch stays the strong default** and is _more_ justified
  here than GloVe/word2vec: it ingests DBpedia/Wiktionary, so its **named-entity
  coverage is materially better**, and it is multilingual (matches custom lists
  in any of the four languages). CC BY-SA 4.0 → one-way compatible with GPL v3.
- **Curated table = dictionary-word lists only** — a fallback, not the answer
  for arbitrary lists.
- **Runtime LLM graduates** from "showcase only" to "the correct backend for
  live play on arbitrary proper-noun lists" — still firewalled out of training.
- A `SemanticBackend` interface (`relatedness(a, b)`, `vectorize(word)`) makes
  curated / numberbatch / fasttext / llm interchangeable; `BotConfig` records
  which backend + asset hash a result depended on.

### The clue-capitalization signal (SHIPPED)

A house rule the whole stack speaks (`semantics/properAssociations.ts`): the
CASE of a clue word carries meaning.

- **Mixed case ("Alien", "iPhone") = the specific proper-noun reference.** The
  curated `PROPER_ASSOCIATIONS` table maps ~97 widely-known references (films,
  characters, myths, brands, places, events) onto default-list board words —
  "Cinderella" → GLASS + PRINCESS + BALL. On a proper-signal clue the table
  backend scores associated words 1 and dampens everything else to lexical
  noise: the reference sense deliberately _excludes_ the common sense.
- **All lowercase ("alien") = explicitly the common sense** — the proper table
  is never consulted.
- **ALL CAPS = no signal** (legacy clients, bot concept clues): the best of
  both readings is used, so groups that ignore the rule lose nothing.

The clue's case is preserved end-to-end (validation, Lua storage, broadcast,
replay were already case-faithful; the display CSS no longer uppercases), so a
bot spymaster EMITS references in display case — the emission is the signal —
and human or bot guessers can read it. Each reference carries a **fame**
rating exposed through `SemanticBackend.commonness()`, so the spymaster's
rarity penalty × `commonnessBias` implements "only clue culture references
the guessers are going to know": a Sharpshooter (1.5) sticks to household
names, a Maverick (0.4) reaches for the deep cuts. The vector backend blends
the curated proper reading with cosine (max) for proper-signal clues, since
embeddings conflate every sense of a token under one vector.

### Practical notes

- **Multi-word board entries** ("NEW YORK", "Marie Curie") → average token
  vectors or treat the phrase as a unit; board words may be up to 50 chars
  (`gameStartSchema`), clue words are single-token ≤ 40.
- **Default-zero assets:** with no embeddings asset the bots run on the baked
  curated association table (and `randomSpymaster` remains as the zero-semantics
  driver), so CI and fresh clones run with no downloads; embedding backends are
  opt-in via a configured path or auto-detected download.

---

## Appendix A — Per-mode rules reference

Shared constants live in `shared/gameRules.ts`; mode internals in
`config/gameConfig.ts`. Board is always 25 cards.

### Classic (`classic`)

- First team: 9 cards, second team: 8, neutral: 7, assassin: 1.
- Which team goes first is seeded (`seededRandom(seed + FIRST_TEAM_SEED_OFFSET)`).
- Reveal own card → keep going (up to `guessesAllowed`); reveal neutral/opponent
  → turn ends; reveal assassin → **instant loss**. Win by revealing all your
  team's cards.

### Duet (`duet`, cooperative, 2 sides)

- Two key cards over one 25-card board. Side A (`types[]`) and Side B
  (`duetTypes[]`): each side sees 9 greens, 3 assassins, 13 bystanders.
- Overlaps: 3 greens green-for-both, 6 green-only-A, 6 green-only-B ⇒ **15 unique
  greens to find** (`greenTotal: 15`).
- Wrong guess costs a **timer token**; start at 9, lose at 0. Any assassin is an
  instant loss. Win by finding all 15 greens.
- `red`/`blue` in the type arrays encode "green from this side", **not** teams.

### Match (`match`, competitive, multi-round)

- Same 9/8/7/1 layout as classic, plus a per-card **score** in `cardScores[]`
  and `revealedBy[]` tracking who revealed each card.
- Card scores: gold (3 pts) ×2–4, silver (2) ×3–6, standard (1) ×8 fixed,
  trap (−1) ×0–4, blank (0) fills the rest; assassin drawn from
  `[-2,-2,-1,-1,-1,0,0,1,2]`. Total board value constrained to `[20, 30]`.
- Round winner gets a **+7** bonus. **Match target 42**, win by a **≥3** margin.
  Cumulative scores in `redMatchScore` / `blueMatchScore`; round results in
  `roundHistory[]`.

---

_Generated from a structured review of the codebase: 11 subsystem analyses, 3
independent architecture proposals scored by 4 judges, and a synthesis pass.
Every file/line reference in §3–§4 and §6–§9 was verified against the working
tree._
