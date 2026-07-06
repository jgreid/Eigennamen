# Improvement Plan — July 2026 Follow-up Review

This is the tracked improvement plan from the second codebase-wide review, conducted 2026-07-05 against `main` at `53be238` (post-PR #497). It is the companion to **[HARDENING_PLAN.md](HARDENING_PLAN.md)**: that document tracks the first review's findings (Phases 0–1 shipped, Phases 2–3 planned); this one tracks everything the second review found that the first one missed or that was introduced since. Nothing here duplicates a HARDENING_PLAN item — where an item interacts with one (e.g. P2-2 timers, P3-1 decomposition), the dependency is called out explicitly.

**Status of this document:** all items are `Planned`. Update each item's status marker in the same PR that closes it, mirroring HARDENING_PLAN.md's convention.

**How the review was conducted:** fourteen independent review passes (game integrity, concurrency/resilience, authentication/input validation, bots, frontend state, accessibility/i18n/PWA, testing/CI, code quality/docs, performance, feature gaps, deployment/ops, unread-subsystem sweep, a regression audit of all 18 shipped HARDENING_PLAN items, and a completeness critique of the review itself), each reading source directly. Every candidate finding was then independently re-derived by an adversarial verification pass that read the cited code plus its callers/callees with instructions to refute; only findings that survived are tracked here. Findings that merely restated HARDENING_PLAN items were dropped. The completeness critique's severity recalibrations (deployment-reality weighting, double-count merges) are applied.

**Baseline at review time:** 175 test suites / 4,386 tests passing, `npm run lint`, `npm run typecheck`, and `npm run format:check` all clean on unmodified `main`. The regression audit confirmed all 18 shipped Phase 0/1 hardening items are present in the code as described — no regressions.

**Deployment context used for severity calls:** production is a single Fly.io machine running memory-mode Redis (`fly.toml`: `REDIS_URL = "memory"`, deploy `strategy = "immediate"`, 512 MB VM, embeddings opt-in and disabled). Severities are rated against that reality — several items note explicitly how their severity changes if external networked Redis or multi-instance scaling (HARDENING_PLAN Phase 2) arrives first.

## How to read this document

Each item has:

- **Root cause** — why the defect exists, not just what it does
- **Fix** — the concrete change, naming actual functions/files
- **Touches** — files that need to change
- **Tests** — regression coverage the fix must ship with
- **Risk / Notes** — hazards of the fix itself, dependencies on other items, product decisions needed

Phases group by theme; the **Suggested sequencing** section at the end orders the first tranche of work across phases. IDs are `A1…H4` (letter = phase) to avoid colliding with HARDENING_PLAN's `P*` namespace.

---

## Phase A — Broken user-facing flows

Deterministic defects reachable in ordinary play. These are the "a user hits this and the game misbehaves" tier.

### A1 — Duet blue spymaster never receives their key card on game start — **FIXED**

**Severity:** High · **Area:** Game integrity (Duet)

**Resolution (shipped):** took option (a). Extracted the resync/role-change payload logic into a pure `buildSpymasterViewPayload(game, player)` (`socket/handlers/roomHandlerUtils.ts`) and, after the `GAME_STARTED` emission loop (`socket/handlers/gameHandlers.ts`), emit `game:spymasterView` to every seated spymaster/observer via `safeEmitToPlayers` — so a pre-seated Duet blue spymaster gets their key (duetTypes-as-types) immediately at start, exactly as the resync path already delivers it. Unit-tested (`__tests__/handlers/spymasterViewPayload.test.ts`, 8 cases); the existing resync tests regression-cover the refactor.

**Root cause:** `getGameStateForPlayer` (`services/game/revealEngine.ts:337-339`) gives a duet blue spymaster masked `types` (null for unrevealed cards) with the real key only in `duetTypes` — but the board only renders `types`, and the one code path that remaps the blue key into `types` (`sendSpymasterViewIfNeeded`, `socket/handlers/roomHandlerUtils.ts:44`) fires only on role change and resync, never on `game:started` (`socket/handlers/gameHandlers.ts:134-137`). Seats are preserved across games (`resetRolesForNewGame`), so no role-change event ever fires post-start.

**Fix:** Either (a) after the `GAME_STARTED` emission loop, emit `game:spymasterView` per seated spymaster/observer with the same payload logic `sendSpymasterViewIfNeeded` uses (duetTypes-as-types for duet blue, `cardScores` for match, both keys for duet observers) — note the handler holds only the host's socket, so use `safeEmitToPlayers`, not the helper directly; or (b) cleaner: change `getGameStateForPlayer` so a duet blue spymaster receives their acting perspective in `types` directly, matching what the client renders.

**Touches:** `socket/handlers/gameHandlers.ts` or `services/game/revealEngine.ts`; possibly `socket/handlers/roomHandlerUtils.ts`

**Tests:** E2E duet spec: blue spymaster's board must show `spy-green`/`spy-assassin` classes immediately after game start (the existing `game-modes.spec.js` only checks perspectives differ after a resync-driven view). Unit test asserting the start path emits a perspective-correct view to a seated blue spymaster.

**Risk / Notes:** Low. Every duet game with a pre-seated blue spymaster hits this today; recovery currently requires a manual resync or reconnect.

---

### A2 — A brief network blip silently detaches the client from all room broadcasts — **FIXED**

**Severity:** High · **Area:** Frontend state / reconnection

**Resolution (shipped):** the `connect` handler (`frontend/socket-client-connection.ts`) no longer keys reconnect detection off `reconnectAttempts` alone. The `disconnect` handler now sets `host.hadUnexpectedDisconnect = true` for any drop other than an intentional `io client disconnect`, and `connect` treats `reconnectAttempts > 0 || hadUnexpectedDisconnect` as a reconnect — so a transient blip whose *first* retry succeeds (no `connect_error`, `reconnectAttempts` still 0) now runs `attemptRejoin` + `requestResync` and the fresh socket rejoins its rooms instead of going silently deaf. Unit-tested in `__tests__/frontend/socket-client-connection.test.ts` (transient-drop rejoins; intentional disconnect does not; the pre-existing `connect_error` path still works).

**Root cause:** `wasReconnecting` (`frontend/socket-client-connection.ts:147-149`) is derived from `reconnectAttempts > 0`, which only increments on `connect_error` (line 175-178). Socket.io fires `connect_error` only for *failed* attempts — a transient disconnect whose first retry succeeds re-fires `connect` with `reconnectAttempts === 0`, so `attemptRejoin`/resync are skipped entirely. Server-side, the new socket is a member of zero Socket.io rooms, and nothing on this path ever writes `connected: true` back to the player record.

**Fix:** Set a `hadUnexpectedDisconnect` flag in the `disconnect` handler (when the socket was previously connected) and gate `attemptRejoin` on that instead of `reconnectAttempts`. Belt-and-braces: always rejoin + `requestResync()` when `connect` fires while a room code is stored and the socket id changed.

**Touches:** `frontend/socket-client-connection.ts`, possibly `frontend/multiplayerUI-status.ts`

**Tests:** Frontend unit test simulating connect → disconnect → connect with zero `connect_error` events; assert `attemptRejoin`/`requestResync` are invoked. Regression: reconnection overlay is hidden by the rejoin path, not the 15s failsafe.

**Risk / Notes:** Low. Today the affected player receives no reveals/clues/chat until they themselves act, and the 10-minute disconnected-player cleanup can evict an actively playing player (compounded by B1). This is the single most common real-network failure mode.

---

### A3 — While disconnected in multiplayer, board actions fall through to the standalone engine — **FIXED**

**Severity:** High · **Area:** Frontend state

**Resolution (shipped):** added the `state.isMultiplayerMode`-guard-and-return (with a `multiplayer.reconnecting` toast) to `revealCard` (`frontend/game/reveal.ts`), `endTurn` and `newGame` (`frontend/game.ts`) right after their existing multiplayer-connected branches, so a disconnected client never records a local reveal, flips the turn, or replaces the board / rewrites the shareable URL to a standalone game. `handleReconnection` (`frontend/handlers/roomEventHandlers.ts`) now calls `updateURLWithRoomCode` so the `?room=CODE` URL heals on reconnect. Unit-tested in `__tests__/frontend/game.test.ts` (no state mutation, no `updateURL`, reconnecting toast) and an existing test that asserted the old fall-through was corrected to the fixed behavior.

**Root cause:** `revealCard`/`endTurn`/`newGame` (`frontend/game/reveal.ts:63`, `frontend/game.ts:415,128`) gate the server path on `state.isMultiplayerMode && isClientConnected()` — when disconnected, execution falls through to the *standalone* branch instead of stopping: reveals are recorded locally as 'neutral', the turn flips, `newGame` replaces the board and sets `isHost=true`, and `url-state.ts` rewrites the shareable URL from `?room=CODE` to standalone `?game=…` params. The reconnection overlay never blocks clicks (`pointer-events: none`), so no UI element prevents this. State heals on the next resync but the URL never does — `handleReconnection` doesn't call `updateURLWithRoomCode`, so a later refresh loads a standalone game instead of rejoining the room.

**Fix:** In `revealCard`, `endTurn`, and `newGame`, when `state.isMultiplayerMode && !isClientConnected()`, show a "reconnecting…" toast and return (mirror the `isInRoom()` guard pattern in `roles.ts` `setTeam`). Restore `updateURLWithRoomCode` in `handleReconnection`.

**Touches:** `frontend/game/reveal.ts`, `frontend/game.ts`, `frontend/multiplayerUI-status.ts` (or wherever `handleReconnection` lives)

**Tests:** With `isMultiplayerMode=true` and a disconnected client: assert `revealCard`/`endTurn`/`newGame` perform no state mutation and no `history.replaceState` call; assert the `room` URL param survives a disconnect–reconnect cycle.

**Risk / Notes:** Low — pure guard additions.

---

### A4 — `player:kick` fails to disconnect the target once their session–socket mapping expires — **FIXED**

**Severity:** High · **Area:** Game integrity / moderation

**Resolution (shipped):** the kick handler no longer looks the target up via `getSocketId` (the 5-minute, never-refreshed session→socket mapping). It targets the `player:<sessionId>` Socket.io room (joined at room-join/reconnect) via `io.in(...).fetchSockets()` and disconnects each socket — TTL-independent, and consistent with how broadcasts already address players (`safeEmitToPlayer`). The per-event mapping-TTL refresh in the plan was scoped out: broadcasts don't use the mapping, so the kick was its only broadcast-affecting consumer.

**Root cause:** The session→socket mapping is written exactly once per connection at auth (`middleware/socketAuth.ts:53`) with a 5-minute TTL (`config/roomConfig.ts:18` `SESSION_SOCKET: 5*60`) and never refreshed. The kick handler (`socket/handlers/playerHandlers/playerModerationHandlers.ts:43`) locates the target's live socket via `getSocketId` — for any player connected longer than 5 minutes (the normal case) this returns null: the Redis player record is deleted and the reconnect token invalidated, but the live socket is never disconnected and never leaves the `room:<code>`/`player:<sessionId>` Socket.io rooms. The kicked client sees no `ROOM_KICKED` UI and keeps receiving every room broadcast — chat, reveals, clues, player lists — indefinitely.

**Fix:** Don't rely on the mapping to find a live local socket: use `io.in('player:' + targetSessionId).fetchSockets()` / `disconnectSockets(true)` (or iterate `io.sockets.sockets`) so the kick lands regardless of mapping TTL. Independently, refresh the mapping TTL periodically (e.g. in `contextHandler` alongside the existing lastSeen touch) for the mapping's other consumers.

**Touches:** `socket/handlers/playerHandlers/playerModerationHandlers.ts`, `socket/contextHandler.ts` (TTL refresh), possibly `services/playerService.ts`

**Tests:** Kick a target whose `getSocketId` resolves null but whose socket is present in `io.sockets` — assert the socket is disconnected and removed from the room; regression that a kicked socket receives no further room broadcasts.

**Risk / Notes:** A host-removed player silently retaining a full room feed is also an information-exposure issue (they see the ongoing game they were removed from), which is why this rates High despite being moderation-path-only.

---

### A5 — `gameStateSchema` silently strips the `paused` field (and will strip any future field) — **FIXED**

**Severity:** Medium · **Area:** Game integrity / data layer

**Resolution (shipped):** added `paused` to `gameStateSchema` (it now round-trips); added `if (game.paused) throw GameStateError.gamePaused()` inside both `forfeitGame` and `abandonGame` (they have no Lua backstop); emit `paused` from `getGameStateForPlayer`; promoted `GAME_PAUSED` to a first-class `ERROR_CODES` entry (dropping an `as ErrorCode` cast). The systemic guard is a schema-drift test (`__tests__/services/luaGameOpsSchema.test.ts`): a `Required<GameState>` fixture forces every field to be named and the test fails unless the schema shape covers them all — so the next added `GameState` field can't be silently stripped.

**Root cause:** `gameStateSchema` (`services/game/luaGameOps.ts:24-66`) enumerates every `GameState` field *except* `paused` (`types/game.ts:232`) and has no `.passthrough()` — Zod's default strip mode removes it on every TypeScript read (`getGame`, `gameService.ts:336`; `safeParseGameData` inside `executeGameTransaction`, `luaGameOps.ts:162,281`). Consequences: every TS-side pause guard is dead code (`gameHandlers.ts:183/273/312/368`, `gameService.ts:479`, `botController.ts:206/406`); `executeGameTransaction` re-serializes the stripped object, silently erasing `paused: true` from stored state on any transaction write; and `forfeitGame`/`abandonGame` — which unlike reveal/clue/endTurn have **no Lua paused backstop** — succeed on a paused game. The Lua guards (`revealCard.lua:41`, `endTurn.lua:42`, `submitClue.lua:55`) read raw JSON and still hold, which is what keeps this Medium rather than High. During a pause with a bot on the acting seat, the bot's dead paused check lets it burn its full re-arm ladder against Lua `GAME_PAUSED` rejections.

**Fix:** Add `paused: z.boolean().optional()` to `gameStateSchema`. Add `if (game.paused) throw GameStateError.gamePaused();` inside **both** `forfeitGame`'s and `abandonGame`'s transaction callbacks. Include `paused` in `getGameStateForPlayer` so a reconnecting client can render pause state. Most importantly, add the systemic guard: a schema-drift regression test asserting `Object.keys(gameStateSchema.shape)` covers every key of a fully-populated `GameState` fixture — this class of silent field erasure will otherwise recur with the next field added to `GameState`.

**Touches:** `services/game/luaGameOps.ts`, `services/gameService.ts`, `services/game/revealEngine.ts`, new test in `__tests__/services/`

**Tests:** Round-trip: `pauseGame(room)` then `(await getGame(room)).paused === true`. `game:forfeit` on a paused game throws `GAME_PAUSED`. Bot: `tickRoom` on a paused game no-ops without consuming re-arm attempts. The schema-drift fixture test above.

**Risk / Notes:** None — additive. Interacts with F1 (pause has no UI today); fix this regardless of F1's outcome because the schema-drift hazard is independent of pause's fate.

---

### A6 — Duet: a green revealed from the wrong side's perspective is permanently dead, making the co-op win unreachable — **INVESTIGATED, DEFERRED (gated on D3)**

**Severity:** Medium · **Area:** Game rules (Duet)

**Status (2026-07-05):** root cause reconfirmed in `revealCard.lua` (a single shared `revealed[]` flag + perspective-resolved `cardType`, so a green-for-A card revealed on B's turn is recorded neutral and can never be re-revealed). Both fixes were deliberately **not** shipped in this pass: the per-perspective reveal state (fix a) touches the Lua reveal hot path in both `revealCard.lua` and `revealEngine.ts`, which this plan already gates on the extended real-Redis Lua harness (D3) landing first, per the P1-9 precedent — D3 has not landed. The smaller "detect the mathematically-lost state and end as lost" (fix b) is a genuine product decision (it changes duet outcomes) and still writes through the game-ending path, so it isn't a safe drop-in either. Left for a D3-gated follow-up so the reveal-path change ships with real-Redis coverage rather than mock-only tests.

**Root cause:** `revealCard.lua:75-82` resolves the card type from the acting team's perspective and sets a single shared `revealed[]` flag; line 64 blocks any re-reveal (`ALREADY_REVEALED`). A card that is green from side A's perspective but bystander from side B's — revealed on B's turn — is recorded as neutral and can never be revealed again, so `greenFound` is permanently capped below the 15 (`greenTotal`) required to win (`revealCard.lua:132`). In the source material this game adapts, such a card stays guessable from the other perspective. The game doesn't detect the mathematically-lost state either — players keep burning timer tokens with no signal.

**Root cause:** `revealCard.lua:75-82` resolves the card type from the acting team's perspective and sets a single shared `revealed[]` flag; line 64 blocks any re-reveal (`ALREADY_REVEALED`). A card that is green from side A's perspective but bystander from side B's — revealed on B's turn — is recorded as neutral and can never be revealed again, so `greenFound` is permanently capped below the 15 (`greenTotal`) required to win (`revealCard.lua:132`). In the source material this game adapts, such a card stays guessable from the other perspective. The game didn't detect the mathematically-lost state either — players kept burning timer tokens with no signal.

**Tests:** `duetMode.test.ts` gained a "Unreachable Win Guard (A6)" block — `isDuetWinUnreachable` false on a fresh board, true once a cross-perspective green is consumed as a bystander, and false for a both-sides bystander; plus end-to-end `determineDuetRevealOutcome` cases (red reveals a blue-only green → `gameOver`/`winner=null`/`endReason='unreachable'`; a both-sides bystander spends a token but keeps the game live; a normal green reveal never fires the guard). The real-Redis harness (D3, below) exercises the same three scenarios through the actual `revealCard.lua` against embedded Redis, and `scoring.test.ts` covers the new message branch (and that a genuine victory still wins over the reason).

**Risk / Notes:** Server-only detection + one new terminal message; no change to how any card is revealed or masked, so the reveal hot path and duet board rendering are untouched. The fuller per-perspective-revealability fix (option (a)) remains possible later if the product wants strict source-material fidelity, but ending a dead board cleanly is the higher-value, lower-risk half.

---

### A7 — `finalizeMatchRound` has no gameOver/idempotency guard — a racing `game:nextRound` finalizes the wrong round — **FIXED**

**Resolution (shipped):** `finalizeMatchRound`'s transaction callback now returns null unless `game.gameOver === true` AND the round isn't already finalized (roundHistory tail's `roundNumber !== matchRound`), checked inside the transaction so `executeGameTransaction`'s retry re-reads state. This makes finalization idempotent and end-gated, eliminating the phantom 0/0 entry, the double bonus, and the `game:roundEnded` broadcast for a just-started round. The plan's additional reorder (finalize before the `game:over` broadcast) was deferred: it touches several call sites and the client event order, and the idempotency guard already prevents all the described corruption.


**Severity:** Medium · **Area:** Game integrity (Match)

**Root cause:** `finalizeMatchRound` (`gameService.ts:763-796`) guards only on `gameMode === 'match'`; `finalizeRound` (680-741) never checks `game.gameOver` or prior finalization before awarding `ROUND_WIN_BONUS` and pushing to `roundHistory`. There's no mutual exclusion against `startNextRound` (it holds `game-create:` while finalization holds `reveal:`). If `startNextRound`'s persist wins the race (a slow `saveCompletedGameHistory` widens the window arbitrarily), finalization executes against the freshly-created round N+1: a bogus `roundResult` for round N+1 (winner null, 0/0), no history entry for the forfeited round N, the +7 bonus silently never applied, and a `game:roundEnded` broadcast for the round that just started.

**Fix:** Inside `finalizeMatchRound`'s transaction callback, return null unless `game.gameOver === true` **and** the round is not already finalized (e.g. last `roundHistory` entry's `roundNumber !== game.matchRound`) — inside the transaction, because `executeGameTransaction`'s retry re-reads current state. Also reorder finalization before the `GAME_OVER` broadcast in the shared reveal/endTurn path (`gameActions.ts:114-117`), not just the forfeit handler.

**Touches:** `services/gameService.ts`, `socket/handlers/gameActions.ts`

**Tests:** `finalizeMatchRound` returns null when the stored game has `gameOver=false`. Race test: forfeit a match round, interleave `startNextRound` before finalization — assert no phantom entry in the new round's history and the bonus applied exactly once.

**Risk / Notes:** Depends on B3 (WatchError retry) for the transaction-retry path to actually work as designed.

---

### A8 — Client clicker-fallback invites spymasters/advisors/observers to click a board the server will reject

**Severity:** Medium · **Area:** Frontend state

**Root cause:** When the team clicker disconnects, `board.ts` `canClickCards()` (lines 95-103) and `selectors.ts` `isClickerFallback()` (140-145) grant clicker rights to *any* player whose `playerTeam` matches `currentTurn` — no role exclusion — while the server explicitly forbids exactly those roles (`gameHandlers.ts:204`). The spymaster's board loses the no-click class, cards show pending "revealing" spinners, End Turn lights up — and every action bounces with a generic error toast, each bounce also clearing all pending reveal flags via the shared error handler.

**Fix:** Add role exclusions to the fallback in both places: require `!state.spymasterTeam && !state.isObserver`, and skip when the local player's server role is `advisor` — which requires tracking advisor in state, since `setPlayerRole` currently collapses advisor to a plain team member.

**Touches:** `frontend/board.ts`, `frontend/store/selectors.ts`, `frontend/stateMutations.ts`

**Tests:** Spymaster on the on-turn team with a disconnected clicker → `canClickCards()`/`canActAsClicker()` false; plain team member in the same situation → still true.

---

### A9 — Shared replay links never show the replay

**Severity:** Medium · **Area:** Frontend state / replay

**Root cause:** `checkURLForReplayLoad` (`frontend/history-replay.ts:416-465`) fetches the replay, renders it into the modal DOM, toasts "Replay loaded", strips the URL params — but never opens the modal (the sole `openModal('replay-modal')` call site is `history.ts:153`, a path this flow never reaches). Meanwhile the same URL's `?room=` param triggers the join-room modal and a fresh local game renders underneath.

**Fix:** Call `openModal('replay-modal')` (or reuse `openReplay`'s sequence) after `renderReplayData` succeeds; gate `checkURLForRoomJoin` to skip when `params.has('replay')`. Consider a dedicated `replayRoom` param to remove the collision permanently.

**Touches:** `frontend/history-replay.ts`, `frontend/multiplayer.ts` or `frontend/app.ts` (init ordering)

**Tests:** Load with `?replay=X&room=Y` and a mocked 200 — assert replay-modal opens and multiplayer-modal does not; graceful behavior on 404.

---

### A10 — A room whose host is removed by grace-period expiry is bricked (no host ever again)

**Severity:** Medium · **Area:** Concurrency / room lifecycle

**Root cause:** Host transfer runs only inside `handleDisconnect`'s host-transfer lock and only if a *connected* candidate exists at that instant (`disconnectHandler.ts:313-341`); when none does, no deferred transfer, retry, or marker is left. Both later removal paths (`atomicCleanupDisconnectedPlayer.lua:33`, key TTL expiry) do no host work. Scenario: both humans blip; host's player key expires after the grace window; player B reconnects — `room.hostSessionId` now references a nonexistent session forever, so nobody can start a game, change settings, kick, add bots, or pause, until the room's own TTL.

**Fix:** Two complementary halves: (1) when the cleanup path removes a player, check `room.hostSessionId === sessionId` and run the same host-transfer selection `leaveRoom` uses (`room/membership.ts:174-225`); (2) lazy repair on `room:reconnect`/`room:resync` — if the room's `hostSessionId` no longer resolves to an existing player, promote the first connected human. The lazy repair also covers the TTL-expiry path, which no sweep can see. Note: until B1 lands the sweep never runs at all, so the lazy repair is the half that matters today.

**Touches:** `services/player/cleanup.ts`, `socket/handlers/roomHandlers/roomReconnectionHandlers.ts` or `roomSyncHandlers.ts`, `services/room/membership.ts` (extract the selection helper)

**Tests:** Host disconnects with zero connected candidates; another player reconnects after the host's record is gone — assert they (or the first connected human) become host rather than the room staying hostless.

---

### A11 — Timer expiry races `addTime`/`pause`: the expiry callback acts on stale state

**Severity:** Medium · **Area:** Concurrency / timers

**Root cause:** The local expiry callback (`timerService.ts:126,494`) unconditionally deletes the Redis timer key and ends the turn without revalidating. Add time at T−ε: the Lua extend succeeds (`atomicAddTime.lua:44`, endTime now +30s), but the already-fired timeout's callback deletes the freshly-extended timer and ends the turn that was just granted more time.

**Fix:** Stamp each armed timeout with the endTime/epoch it was scheduled for; make the expiry callback run a small compare-and-delete Lua (delete + proceed only if the stored timer's endTime matches the armed one and `paused` is unset; otherwise no-op). **Implement this as (or fold it into) HARDENING_PLAN P2-2** — it is the same "make expiry Redis-authoritative" mechanism P2-2 prescribes; doing it separately would build the same thing twice.

**Touches:** `services/timerService.ts`, new Lua script (or extension of an existing timer script)

**Tests:** Fake-timer test: arm a timer, atomically extend via `addTime` while the original timeout fires — assert the timer key survives with the extended endTime and `onExpire` is not invoked; same for pause racing expiry.

**Risk / Notes:** Sequenced with P2-2 by design; also covered by the D3 harness for the new Lua.

---

### A12 — Match-mode abandon consumes the round number, so the "scoreless do-over" is actually a skipped round

**Severity:** Low · **Area:** Game rules (Match)

**Root cause:** P1-4 rolled back the *scores* on abandon but `startNextRound` (`gameService.ts:825`) still blindly increments `matchRound` — the abandoned round N gets no `roundHistory` entry while round N+1 begins, leaving `matchRound` permanently out of sync with history and firing the carry-over consistency warning on every subsequent round transition.

**Fix:** Derive the next round from history rather than incrementing: `const nextRound = (freshGame.roundHistory?.length ?? 0) + 1;` (or detect the abandoned-round case — `gameOver` with no matching history entry — and reuse `freshGame.matchRound`).

**Touches:** `services/gameService.ts`, possibly `frontend/game.ts` `isMatchRoundOver` logic

**Tests:** Abandon round 2 of a match; assert the next round is numbered 2, gets a history entry on completion, and no consistency warning logs.

---

## Phase B — Reliability and operational correctness

Server lifecycle, background maintenance, and the deploy pipeline. B1 and B5 are the two highest-leverage items in this entire plan.

### B1 — The scheduled player-cleanup sweep is never started

**Severity:** Medium (High consequence, trivial fix) · **Area:** Backend lifecycle

**Root cause:** `startCleanupTask()` (`services/player/cleanup.ts:276`) is defined, re-exported, and called **only from tests** — repo-wide grep confirms zero production call sites. `socket/index.ts:178-186` starts `startRateLimitCleanup`, `startConnectionsCleanup`, and the timer sweep, but never this one. Consequences: disconnected players are removed only by key-TTL expiry (never proactively), ghost players hold team seats for the life of every room, orphaned-room teardown never runs, token-orphan cleanup never runs, and the `scheduled:player:cleanup` zset grows monotonically — under memory-mode's `--maxmemory 256mb --maxmemory-policy noeviction` (`config/redis.ts:100-103`), accumulated entries eventually cause Redis to reject **all** writes.

**Fix:** Call `playerService.startCleanupTask()` from `initializeSocket()` (next to the other sweeps) and `stopCleanupTask()` in `cleanupSocketModule()`. Defensively, refresh a TTL on the zset key on `zAdd` in `handleDisconnect` so the key can never outlive a broken sweep again.

**Touches:** `socket/index.ts`, `services/player/cleanup.ts`

**Tests:** Startup test asserting the interval is registered after `initializeSocket()`; regression that a player disconnected past the grace period is removed by the running sweep (not just key TTL).

**Risk / Notes:** Starting a sweep that has never run in production may surface latent bugs in the sweep itself (e.g. A10's missing host handling, B9's bot counting) — land A10/B9 in the same PR or immediately after.

---

### B2 — The P0-3 lock-budget invariant is still violated at several remaining `withLock` call sites

**Severity:** Medium (High if external networked Redis is ever adopted) · **Area:** Concurrency

**Root cause:** P0-3 fixed `timerService.startTimer` and documented the invariant ("lockTimeout must exceed the slowest realistic inner operation"), but the audit didn't reach every site. Confirmed violations: the timer-expiry callback (`socket/disconnectHandler.ts:37-68`) uses `lockTimeout: 5000` → 4,500ms budget while its callback runs `getGame` + `endTurn` each separately budgeted at `TIMEOUTS.REDIS_OPERATION` (10s); host transfer (`disconnectHandler.ts:343`) gives 2.5s to three 10s-budgeted operations; `disconnectHandler.ts:221` wraps `handleDisconnect`'s composite work in a single `REDIS_OPERATION` budget; the two P0-4 player-mutation `withLock` calls are similarly under-budgeted. Consequence when it fires: the lock aborts and releases, the outraced operation *commits in the background* (endTurn flips the turn with no broadcast and no timer restart — clients show the wrong turn).

**Fix:** Repeat the P0-3 remediation: derive each `lockTimeout` from the sum of the inner operation budgets (timer-expire ≥ reveal-lock worst case + `REDIS_OPERATION`; host-transfer ≥ 3×`REDIS_OPERATION`; `disconnectHandler.ts:221` → a composite budget like `TIMEOUTS.SOCKET_HANDLER`). The P0-3 diagnostic (`withLock` warning on `OPERATION_TIMEOUT`) will confirm the fix empirically.

**Touches:** `socket/disconnectHandler.ts`, `services/player/cleanup.ts`, `socket/handlers/roomHandlers/roomReconnectionHandlers.ts`

**Tests:** Extend the P0-3 regression pattern: mock a Redis call resolving after the old budget but within its own declared budget; assert the operation completes and the broadcast is emitted.

**Risk / Notes:** Rated Medium because in-memory Redis on the same box completes these calls in microseconds; it becomes High the day external Redis lands. Widening budgets holds locks longer on genuinely stuck operations — same acceptable tradeoff as P0-3.

---

### B3 — The WATCH/MULTI conflict-retry logic is dead code under node-redis v5

**Severity:** Medium · **Area:** Concurrency / data layer

**Root cause:** `executeGameTransaction` (`luaGameOps.ts:297-312`) retries only on `exec() === null` — ioredis semantics. The installed client (`redis ^5.12.1`) never returns null on a WATCH conflict: `@redis/client`'s exec paths **throw `WatchError`** (including converting a server-side EXEC-null into a thrown error). The catch block rethrows, so on any genuine conflict the operation does not retry: a raw `WatchError` propagates as generic `SERVER_ERROR` and the write is lost. `playerService.updatePlayer` (220-236) has the same bug with no try/catch at all. The shared Redis mock (`__tests__/helpers/mocks.ts:203-244`) encodes the same wrong semantics — exec returning tuples/null, never throwing — so no existing test can catch it.

**Fix:** Catch `WatchError` (import from `@redis/client`, or match `err.constructor.name`) and treat it as the retry condition in both sites, keeping the null check as belt-and-braces. Fix `createMockRedis`'s `multi().exec()` to optionally throw `WatchError` and return raw replies (not tuples). Add a real-Redis case forcing a dirty WATCH (second client writes the watched key between `watch()` and `exec()`), asserting retry-then-success and that exhaustion throws `ServerError.concurrentModification`.

**Touches:** `services/game/luaGameOps.ts`, `services/playerService.ts`, `__tests__/helpers/mocks.ts`, `__tests__/integration/luaScripts.test.ts` (or sibling)

**Tests:** As above — the real-Redis dirty-WATCH case is the load-bearing one.

**Risk / Notes:** Related mock-fidelity issues are tracked as D4; fix them together.

---

### B4 — A seated bot with a missing/corrupt config silently stalls the game — the stall class P1-6 fixed, via a path P1-6 doesn't cover

**Severity:** Medium · **Area:** Bot subsystem

**Root cause:** `tickRoom` (`bots/botController.ts:426-427`) breaks cleanly on a null config (`if (!cfg) break`), leaving `actionFailed=false`, so the tail runs `clearReArm` — no log, no re-arm, no `BOT_STALLED` force-end. `getBotConfig` (`botService.ts:201-215`) returns null on a missing key or corrupt/schema-invalid JSON. If a seated bot's cfg key is lost while its player record survives, it's the bot's turn and no further mutation will ever arrive: the game freezes behind a turn indicator that never advances.

**Fix:** Preferably degrade instead of stalling: fall back to a default config (`resolveSkill('intermediate', seed)` + default strategy), mirroring the advisor path's existing null-cfg degradation (`botController.ts:334-336`), with a warning log. Alternatively route into the existing recovery ladder: set `lastActor`/`actionFailed = true` before breaking so `scheduleReArm → giveUpAndForceEndTurn(BOT_STALLED)` applies.

**Touches:** `bots/botController.ts`

**Tests:** Seat a connected bot whose `getBotConfig` mock resolves null; tick — assert the bot still acts (fallback config) or the turn is force-ended with a `BOT_STALLED` warning; never the current silent clean stop.

---

### B5 — Every deploy destroys all live games with no warning to players

**Severity:** High (product/ops) · **Area:** Deployment

**Root cause:** `fly.toml` combines `REDIS_URL = "memory"` (all rooms/games/history in-process) with `[deploy] strategy = "immediate"`, and `deploy.yml` auto-deploys every CI-green push to `main`. Every merge therefore kills every active game mid-play — players see an unexplained disconnect, and on reconnect the room no longer exists. The one mechanism meant to warn them is a **no-op**: `cleanupSocketModule` (`socket/index.ts:226-230`) emits `ROOM_WARNING` with `{ type: 'server_shutdown', message }`, but the sole client handler (`frontend/handlers/roomEventHandlers.ts:81-98`) branches exclusively on `data.code` (STATS_STALE / BOT_STALLED / BOT_SEAT_RECLAIMED), has no else-fallback, and never renders `data.message` — and `RoomWarningData` (`multiplayerTypes.ts:272-276`) has no `type` field, so the payload matches nothing and is discarded. The 2-second drain (`SHUTDOWN_DRAIN_MS`) waits for clients to "process the warning" none of them receive. This is the single largest real-user pain the review found, and it is not tracked anywhere (HARDENING_PLAN P2-5 covers only the second-machine autoscaler guard).

**Fix, in escalating order of investment:**
1. **Now (zero code):** document the reality in `docs/DEPLOYMENT.md` — deploys wipe state; time them for low-traffic windows.
2. **Cheap code (fix the broken warning):** change the `socket/index.ts` emission to the established shape `{ code: 'SERVER_SHUTDOWN', message }` with a memory-mode-truthful message ("Server is restarting for an update; the current game cannot be resumed"), add a `SERVER_SHUTDOWN` branch to `roomEventHandlers.ts` rendering a toast/overlay via a new i18n key (×4 locales, enforced by the P1-11 locale-key test), and add a generic else-branch that surfaces any unrecognized warning's `message` so future field drift degrades gracefully. Players then learn *why* the game vanished.
3. **Real fix:** provision Fly Redis (`fly redis create`, `REDIS_URL` secret) so state survives deploys — the config comments already describe this as the intended end state; games then survive a deploy (sockets reconnect, A2's fix makes that seamless) and `strategy = "immediate"` stops being destructive.

**Touches:** `fly.toml`, `server/src/index.ts`, `docs/DEPLOYMENT.md`, locale files (for step 2)

**Tests:** For step 2: shutdown-path test asserting the broadcast is emitted to active rooms before exit.

**Risk / Notes:** Step 3 changes the operational cost profile (paid Redis) — maintainer decision. Until step 3, HARDENING_PLAN P2-* items stay moot in production but B1's zset-growth consequence is *mitigated* by the frequent wipes — an unhappy coupling worth breaking deliberately.

---

### B6 — `deploy.yml` deploys the current `main` HEAD, not the commit that passed CI; auto-deploy failures have no rollback path

**Severity:** Medium · **Area:** CI/CD

**Root cause:** The `workflow_run`-triggered deploy job checks out with a bare `actions/checkout` (no `ref:`, `deploy.yml:44`) — for `workflow_run` events the default is the default-branch HEAD at event time, not `github.event.workflow_run.head_sha` (the commit the gating `if:` at lines 34-37 actually validated). Race: commit A passes CI → deploy fires → commit B lands on `main` (its CI later fails or is cancelled by the concurrency group) → the deploy ships B. Separately, the rollback job (line 104) is unreachable for auto-deploys, so a failed post-deploy health check just exits 1 with the broken release live.

**Fix:** Pin the checkout: `ref: ${{ github.event.workflow_run.head_sha || github.sha }}` (fallback covers `workflow_dispatch`). For rollback: change the job's condition to `if: failure()` so it runs for auto-deploys (it needs only `FLY_API_TOKEN`, no checkout), or document that auto-deploy health failures require manual `flyctl releases rollback`.

**Touches:** `.github/workflows/deploy.yml`

**Tests:** Dispatch Deploy while a newer commit sits on `main`; assert the deployed image's revision label matches the CI-validated SHA.

---

### B7 — `release.yml` interpolates the `release_notes` dispatch input directly into a shell script

**Severity:** Low · **Area:** CI/CD hygiene

**Root cause:** `.github/workflows/release.yml:77-78` uses `${{ inputs.release_notes }}` inside a `run:` block — GitHub Actions substitutes the value into the script text before bash parses it, so shell metacharacters in the input become code in a job holding `contents: write`. Only collaborators can trigger `workflow_dispatch`, which bounds the exposure — but it's the exact pattern GitHub's own hardening guide says to avoid, and this repo otherwise follows that guide (SHA-pinned actions, scoped permissions).

**Fix:** Pass the input via an environment variable (`env: RELEASE_NOTES: ${{ inputs.release_notes }}` on the step, `"$RELEASE_NOTES"` in the script), which bash then treats as data.

**Touches:** `.github/workflows/release.yml`

**Tests:** N/A — verify the next release run renders multi-line notes correctly.

---

### B8 — The embedded redis-server child is orphaned on the startup-failure and forced-shutdown paths

**Severity:** Low · **Area:** Backend lifecycle

**Root cause:** P1-3 fixed the graceful path, but a startup connect failure (`index.ts:142` catch) and the force-exit timer (`index.ts:118-121`) both `process.exit()` without reaching `disconnectRedis()` — the only place `stopEmbeddedRedis()` is called. Under a platform restart loop (which P1-2 deliberately leans on), each cycle can strand another 256MB-capped `redis-server` holding a port.

**Fix:** Register a module-level `process.on('exit', () => { try { embeddedRedisProcess?.kill('SIGKILL'); } catch { /* ignore */ } })` in `config/redis.ts` — `'exit'` fires for every `process.exit()` call, covering all three exit paths (startup catch, force-exit timer, P1-2's reconnect-exhaustion exit) in one place.

**Touches:** `config/redis.ts`

**Tests:** Unit test asserting the exit hook kills a live child handle.

---

### B9 — Scheduled cleanup counts bots as room occupants, so bot-populated rooms are never torn down

**Severity:** Low · **Area:** Room lifecycle

**Root cause:** `processScheduledCleanups`' empty-room check (`cleanup.ts:226`) uses `sCard` on the players set — bots are first-class players, so a room whose last *human* disconnects (rather than clicking leave) is never treated as empty, inconsistent with `leaveRoom`'s humans-remaining rule (`membership.ts:236`). The room, its bot player records, and `bot:<sid>:cfg` keys linger for the full room TTL.

**Fix:** Mirror `membership.ts` in the sweep: fetch remaining players (or store an isBot marker in the set members) and tear down when no humans remain.

**Touches:** `services/player/cleanup.ts`

**Tests:** Last human disconnects from a bot-populated room; after the grace period, assert the sweep tears the room down.

**Risk / Notes:** Only matters once B1 makes the sweep run at all — land together.

---

### B10 — `deploy.yml`'s health check greps for a string `/health/ready` never returns

**Severity:** Medium · **Area:** CI/CD

**Root cause:** The verify step (`deploy.yml:73-74`) does `HEALTH=$(curl -sf …/health/ready) … if echo "$HEALTH" | grep -q "ok"`. But `/health/ready` (`routes/healthRoutes.ts:121-138`) responds with `status: 'ready'` (200) or `'degraded'` (503) — the substring "ok" appears nowhere in any success body (only the separate `GET /health` returns `status: 'ok'`). The 30-attempt loop always exhausts and hits `exit 1`, healthy or not.

**Fix:** Match what the endpoint actually returns: rely on the HTTP status (`curl -sf -o /dev/null …/health/ready` — it already 503s when degraded) or `grep -q '"status":"ready"'`. Once this is correct, `failure()` reflects genuine failures and B6's rollback fix becomes meaningful (until then, a manual dispatch's rollback fires on every run and reverts a *healthy* release).

**Touches:** `.github/workflows/deploy.yml`

**Tests:** Verify the next deploy's Actions summary reads "Healthy"; optionally a fixture asserting the grep matches a real `/health/ready` body.

**Risk / Notes:** Do this **before or with B6** — the rollback correctness in B6 is moot while every verification falsely fails.

---

### B11 — `workflow_dispatch` deploys bypass the entire CI gate and can ship any branch

**Severity:** Medium · **Area:** CI/CD

**Root cause:** The job `if:` (`deploy.yml:34-37`) makes `github.event_name == 'workflow_dispatch'` a standalone disjunct — the CI-success condition applies only to the `workflow_run` path. A dispatch can be invoked on any branch, and the bare checkout (line 44) ships that ref via `flyctl deploy --strategy immediate` with no lint/typecheck/test/e2e gate — and, in memory mode, the immediate restart discards all live games for a build that may not even boot.

**Fix (no code preferred):** add a deployment-branch policy to the `production` GitHub Environment (Settings → Environments → production → Deployment branches → `main` only); the job already declares `environment: production`. In-workflow complement: change the dispatch disjunct to `(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')`, and optionally require a green "CI Passed" check via the Checks API first.

**Touches:** `.github/workflows/deploy.yml` and/or the GitHub Environment config

**Tests:** Dispatch from a non-main branch → the run is rejected.

---

### B12 — The `staging` deploy environment option deploys the production Fly app

**Severity:** Medium · **Area:** CI/CD

**Root cause:** `deploy.yml:12-20` offers `production`/`staging` dispatch choices and labels the GitHub environment accordingly, but the deploy step (57-61) runs a bare `flyctl deploy --remote-only --strategy immediate` with no `--app`/`--config` override — it always resolves `app = "eigennamen"` from `fly.toml:19`. The environment URL and health-verify target are likewise hardcoded to production. Selecting "staging" performs a full production deploy (restarting the single production machine, discarding all live games) while the run is *labeled* staging.

**Fix:** Either (a) remove the `staging` option until a staging app exists, or (b) create `eigennamen-staging` + `fly.staging.toml` and map the input in **one** place, threading `APP`/`URL` through the deploy step, the environment `url`, the health-verify curl, **and** the rollback job's `registry.fly.io/$APP:…` image path.

**Touches:** `.github/workflows/deploy.yml`, possibly a new `fly.staging.toml`

**Tests:** Dispatch with `staging` → the deployed app name is not `eigennamen` (once a staging app exists), or the option is gone.

---

### B13 — Production runs end-of-life Node 25, which CI never tests

**Severity:** Medium · **Area:** Dependencies / deployment

**Root cause:** `server/Dockerfile:3,43` pins `node:25.2-alpine3.21` for both stages. Node 25 is an odd-numbered "Current" line whose scheduled EOL was 2026-06-01 — as of this review (2026-07-05) it receives no upstream security patches, and Dependabot's Dockerfile bumps can only offer other 25.x tags. Meanwhile `ci.yml` sets `NODE_VERSION: 22` and its test matrix is `[22, 24]` — the 4,386-test suite never runs on the major version production actually ships (only the docker job's start-and-curl smoke touches Node 25).

**Fix:** Change both `FROM` lines to the active LTS line — `node:24-alpine` (LTS until April 2028, already in the CI matrix), so tested and shipped majors align. Optional guard: a CI step failing if the Dockerfile's Node major isn't in the test matrix, so they can't drift again.

**Touches:** `server/Dockerfile`, optionally `.github/workflows/ci.yml`

**Tests:** Full suite green on Node 24; docker smoke job green on the new base.

---

### B14 — Graceful-shutdown budget exceeds Fly's default 5s kill timeout, and an open SSE stream blocks `server.close()` forever

**Severity:** Low · **Area:** Backend lifecycle

**Root cause:** `fly.toml` sets no `kill_timeout`, so Fly's 5s default applies. The shutdown path spends up to 2,000ms in the socket drain, then awaits `server.close()`'s callback before the Redis disconnect (3,000ms race) and `exit(0)`. Nothing calls `server.closeAllConnections()`/`closeIdleConnections()`, so an open long-lived response — the admin dashboard's `/admin/api/stats/stream` SSE — keeps the `close` callback from ever firing. With the dashboard open, the process always dies by SIGKILL mid-cleanup; the 10s in-process force-exit net (`index.ts:118`) is dead code under Fly.

**Fix:** Set `kill_timeout = 15` in `fly.toml` (exceeds the 10s force-exit); call `server.closeAllConnections()` after initiating `server.close()` (plus explicit SSE teardown); keep drain + close + redis-race comfortably under `kill_timeout`.

**Touches:** `fly.toml`, `server/src/index.ts`

**Tests:** Shutdown-path test with a simulated open connection asserting the process reaches `exit(0)` within budget.

---

### B15 — Dependabot doesn't cover the root `docker-compose.yml`

**Severity:** Low · **Area:** Dependencies

**Root cause:** `.github/dependabot.yml` scopes docker to `/server` (matching only `server/Dockerfile`); the root `docker-compose.yml:63` pins `image: redis:7-alpine`, which no configured ecosystem scans — so the Redis image used by the documented local/staging Compose path silently ages while every other dependency gets weekly PRs.

**Fix:** Add a `package-ecosystem: "docker-compose"` entry at `directory: "/"` (weekly, docker label). Do **not** use a `docker` ecosystem at `/` — it parses only Dockerfiles and would silently no-op on Compose files.

**Touches:** `.github/dependabot.yml`

**Tests:** N/A — Dependabot config; verify it opens PRs for the compose image.

---

## Phase C — Accessibility, i18n, and offline/PWA

The a11y items C1/C2 together make timed multiplayer rooms essentially unusable with a screen reader today; the PWA items C3 make the offline promise real.

### C1 — An active turn timer turns the turn indicator into a once-per-second live region — **FIXED**

**Severity:** High · **Area:** Accessibility

**Resolution (shipped):** the `aria-live`/`aria-atomic`/`role="status"` live region was moved off the `#turn-indicator` container (which wraps the per-second timer) onto the `.turn-text` span that actually changes on a turn, and the `#timer-value`'s own `aria-live`/`aria-atomic` were removed. `role="timer"` carries an implicit `aria-live="off"`, so the countdown stays queryable on demand but is no longer announced tick-by-tick. Covered by the accessibility E2E spec.

**Root cause:** `#timer-value` carries `aria-live="polite" aria-atomic="true"` and is nested inside `#turn-indicator` (`role="status" aria-live="polite" aria-atomic="true"`) — `public/index.html:272-296`. `timer.ts`'s 250ms interval updates the MM:SS text, so screen readers re-announce the countdown (potentially the whole "Red Team's Turn 2:41" string, due to the atomic parent) every second for the entire turn, drowning out the clue/reveal/chat announcements and defeating the deliberately throttled 30/10/1-second announcer in `timer.ts:7-32`.

**Fix:** Remove `aria-live`/`aria-atomic` from `#timer-value` and move the timer span outside the atomic `#turn-indicator` region (or set `aria-live="off"` on `#timer-display`). Keep `announceTimerThreshold()` as the sole spoken channel; keep `role="timer"` + static aria-label for on-demand reading.

**Touches:** `public/index.html`, possibly `frontend/timer.ts`

**Tests:** jsdom test asserting `#timer-value` and its ancestors up to `#turn-indicator` carry no active aria-live; `announceTimerThreshold` fires exactly once per 30/10/1 crossing.

---

### C2 — Every toast is announced twice to screen readers

**Severity:** Low · **Area:** Accessibility

**Root cause:** `#toast-container` is itself a live region (`role="alert"`, `index.html:64-69`) and `showToast` (`ui.ts:66-80`) additionally pushes the same message through `announceToScreenReader` — two channels, every clue/join/leave/reconnect/settings toast spoken twice, the second possibly assertive and interrupting.

**Fix:** One channel, not both: drop `role="alert"`/aria-live from the container (visual-only) and keep the `announceToScreenReader` call (it already adds useful "Error:"/"Warning:" context) — or the reverse.

**Touches:** `public/index.html`, `frontend/ui.ts`

**Tests:** jsdom assertion that exactly one live region receives the toast text.

---

### C3 — The PWA is dead offline: the precache omits every JS asset, and offline navigation to any game URL 503s — **FIXED**

**Resolution (shipped):** `esbuild.config.js` now derives `OFFLINE_ASSETS` from the built output (every `?v=`-stamped script/style URL in index.html, the emitted code-split chunks, and the four locale JSONs) and writes it into `service-worker.js` after the `?v=` stampers, so precache keys match request URLs — the list grew from 9 to 24 entries and now includes all JS + all 9 stylesheets + locales. The fetch handler's offline branch falls back to the cached shell (`/index.html`) for any navigation request, so a bookmarked/shared `?game=…` URL restores state client-side instead of returning a 503. Guarded by `__tests__/frontend/serviceWorker.test.ts` (precache covers every referenced script/style + JS + chunks + locales, all exist on disk; navigate-fallback returns the shell not a 503).


**Severity:** High (composite) · **Area:** PWA / service worker

**Root cause, two stacked defects:** (1) `OFFLINE_ASSETS` (`service-worker.js:12-23`) precaches no JavaScript at all — not `app.js`, `socket-client.js`, `socket.io.min.js`, `app-fallback.js`, nor any chunk — plus only six of the nine linked stylesheets and no locale JSON. A user who installs the PWA after one visit opens it offline to a dead, unstyled page. (2) Even with caches populated by browsing, the fetch handler's fallback calls `caches.match(event.request)` without `ignoreSearch`, and standalone game state lives in the query string (`?game=…&r=…` — rewritten by `replaceState` on every reveal), so offline navigation to any bookmarked/shared game URL misses cache and returns the SW's bare 503 "Offline" text. Offline standalone play only ever works at exactly `/` with a fresh board.

**Fix:** (1) Extend `esbuild.config.js`'s existing post-build service-worker rewrite (`updateServiceWorkerVersion`) to inject the full asset list into `OFFLINE_ASSETS`: the exact `?v=`-stamped script URLs it already writes into `index.html`, `app-fallback.js`, the emitted chunk filenames (from esbuild's metafile), all nine CSS files, and `/locales/{en,de,es,fr}.json` (cache keys must match request URLs including query strings). (2) In the fetch handler's catch branch, for `event.request.mode === 'navigate'` fall back to `caches.match('/index.html')` — the app restores state from `location.search` client-side as it already does online.

**Touches:** `public/service-worker.js`, `server/esbuild.config.js`

**Tests:** Build-time Jest test reading `public/index.html` + `service-worker.js`, asserting every `<script src>`/stylesheet href appears in `OFFLINE_ASSETS` with an identical URL. SW fetch-handler test: offline navigation to `/?game=1&r=0&t=red` resolves to cached index.html, not a 503.

---

### C4 — `t()` HTML-escapes interpolation params that every consumer renders as text — clues display as literal entities

**Severity:** Medium · **Area:** i18n / display correctness

**Root cause:** `t()`'s interpolator (`frontend/i18n.ts:130-150`) replaces `[&<>"']` in params with HTML entities "to prevent XSS" — but the codebase never renders `t()` output with innerHTML (the project-wide textContent convention is the actual XSS guarantee). A clue "McDonald's 2" (legal through `gameClueSchema`, and producible by bots via the proper-noun table) toasts as `McDonald&#39;s (2)` and screen readers speak "ampersand hash three nine". Same corruption in card aria-labels for any custom word with an apostrophe/ampersand.

**Fix:** Remove the escaping loop — insert `String(params[name])` directly.

**Touches:** `frontend/i18n.ts`

**Tests:** `t('game.clueGivenAnnounce', {word: "McDonald's", …})` contains the literal apostrophe; `showToast` renders it verbatim via textContent.

---

### C5 — Multiplayer lifecycle/timer/reconnect toasts are hardcoded English despite existing translations

**Severity:** Medium · **Area:** i18n

**Root cause:** 15 call sites across `frontend/handlers/{timer,player,room,chat}EventHandlers.ts` and `ui.ts` pass English literals to `showToast` — every join/leave/kick/disconnect/reconnect/timer-expiry/settings-change notification — while the matching keys (`timer.expired`, `multiplayer.playerJoined/playerLeft/kicked/reconnected`, …) exist with real translations in all four locale files, referenced by nothing. The P1-11 locale regression test structurally can't catch this class: it scans `data-i18n` attributes and existing `t()` keys; these sites bypass `t()` entirely.

**Fix:** Route all 15 sites through `t()` with the dormant keys. Two extensions: (1) `roomEventHandlers.ts:208`'s `'Reconnected! ' + changes.join('. ')` — the change descriptions from `detectOfflineChanges()` (`multiplayerSync.ts`) are also English literals and must be localized with it; (2) `ui.ts`'s new `t()` import creates a `ui.ts → i18n.ts` edge — verify no import cycle (or resolve the strings lazily inside `showToast`).

**Touches:** the four handler files, `frontend/ui.ts`, `frontend/multiplayerSync.ts`, locale files for any missing change-description keys

**Tests:** Lint-style test failing on new `showToast('…literal…')` occurrences in `frontend/handlers/`.

---

### C6 — No i18n mechanism exists for `aria-label` — 27 hardcoded English labels

**Severity:** Medium · **Area:** Accessibility × i18n

**Root cause:** `translatePage()` (`i18n.ts:156-203`) handles `data-i18n`, `-placeholder`, `-title`, and `-label` (optgroups) — but not `aria-label`. `index.html` carries 27 English aria-labels (skip link, board region, clue inputs, chat, replay controls, …): the primary navigation surface for blind users stays English in de/es/fr.

**Fix:** Add a `data-i18n-arialabel` branch to `translatePage()` mirroring the `-title` branch; stamp the attributes; add ~27 keys × 4 locales. Two adjustments: `index.html:768`'s board label is already overwritten at runtime by `board.ts:239` via `t('board.boardAriaLabel')` — reuse that key; and fix `ui.ts:62`'s runtime-hardcoded "Dismiss notification" via `t()`, since the attribute mechanism can't reach dynamically created elements.

**Touches:** `frontend/i18n.ts`, `public/index.html`, all four locale files, `frontend/ui.ts`

**Tests:** Extend `localeKeys.test.ts`: every aria-label in `index.html` either has a `data-i18n-arialabel` companion or sits on an allowlist of language-neutral labels.

---

### C7 — `t()`'s English fallback is dead for non-English users

**Severity:** Low · **Area:** i18n

**Root cause:** The documented fallback chain reads `translations['en']`, but `setLanguage()` (`i18n.ts:62-79`) only ever loads the active language — for de/es/fr users the English table is never fetched, so a missing key renders the raw dotted key (the exact P1-11 bug class, with the worst-case presentation). Key parity is currently perfect (351 keys × 4), so no visible symptom today — the net is missing, not torn.

**Fix:** In `setLanguage()`, when `lang !== DEFAULT_LANGUAGE`, also lazily fetch and cache `/locales/en.json`.

**Touches:** `frontend/i18n.ts`

**Tests:** Set language to `de`, delete a key from the loaded de table, assert `t()` returns the English string, not the dotted key.

---

### C8 — `openModal()` focuses disabled controls, leaving keyboard/SR focus behind the dialog

**Severity:** Low · **Area:** Accessibility

**Root cause:** `openModal` (`ui.ts:197-203`) focuses `focusableElements[0]` without excluding disabled controls — the replay modal's first button (`#replay-prev`) is disabled at step 0, so `.focus()` no-ops: focus stays on the history-list button behind the overlay and the SR reading position never enters the dialog. The focus-trap handler's own comment documents the stricter selector this path should use.

**Fix:** Move the focusable query inside the `setTimeout` (evaluate at focus time), use the trap's `:not([disabled])` selector, skip `offsetParent === null` elements, fall back to focusing the modal itself; apply the same to `closeModal`'s stack-restore branch (`ui.ts:248-253`).

**Touches:** `frontend/ui.ts`

**Tests:** jsdom: open the replay modal with `#replay-prev` disabled — assert focus lands inside the dialog.

---

### C9 — Bot persona names/descriptions are untranslatable in the add-bot picker

**Severity:** Low · **Area:** i18n

**Root cause:** The six persona `<option>`s (`index.html:487+`) hardcode English names and tooltip blurbs with no `data-i18n`/`data-i18n-title` attributes — the only in-UI explanation of what each persona does. The locale guard test only validates attributes that exist, so the drift is permanent.

**Fix:** Add `bots.persona*`/`bots.persona*Desc` keys × 4 locales; stamp `data-i18n` (option text) and `data-i18n-title` (tooltip) — `data-i18n-title` support already exists, no new mechanism needed.

**Touches:** `public/index.html`, four locale files

**Tests:** Extend `localeKeys.test.ts` to flag `<option>` elements with English text and no `data-i18n`.

---

## Phase D — Restore test and CI signal

The E2E suite is the plan's protective infrastructure: D1 unblocks trustworthy verification for most Phase A fixes — do it first.

### D1 — Make the E2E suite green and meaningful again

**Severity:** High · **Area:** Testing / CI

**Root cause, three stacked problems:** (1) `game-flow.spec.js` has 6 of 9 tests failing on unmodified `main` — the tests click role buttons without joining a team, which `setSpymasterCurrent()`/`setClickerCurrent()` (`roles.ts:454-468`) reject with a "join a team first" toast; two failures have additional causes beyond the guard. (2) `game-modes.spec.js`'s `selectGameMode()` force-checks a radio inside a settings panel it never opens (all 8 game-modes failures). (3) With ~15 known failures and `--max-failures=20` (`ci.yml:643`), Playwright aborts mid-run — alphabetically later specs (security, setup-screen, spectator-approval, standalone-game, timer — including the P1-13 deliverables) are routinely never executed at all. The non-blocking job is permanently red: a new regression produces no red *delta* anywhere.

**Fix, in order:** (a) repair `game-flow.spec.js` — `becomeCurrentClicker()` in `helpers.js` must read the turn indicator and `selectTeam(page, currentTurnTeam)` before clicking (end-turn requires `playerTeam === currentTurn`); spymaster-only tests can join any team in a `beforeEach`; diagnose the two extra failures (`:44`, `:66`) separately. (b) Fix `selectGameMode()` to open the settings modal first (or drive the always-visible `setup-gameMode` radios). (c) Fix or `test.fixme()` the one `home.spec.js` share-link failure. (d) Only after a green full run: remove/raise `--max-failures`, then promote the full E2E job into the blocking `ci-passed` gate (completing what P1-9's smoke slice started).

**Touches:** `server/e2e/game-flow.spec.js`, `server/e2e/helpers.js`, `server/e2e/game-modes.spec.js`, `server/e2e/home.spec.js`, `.github/workflows/ci.yml`

**Tests:** A green full-suite run on unmodified `main` is the acceptance gate.

**Risk / Notes:** The core standalone gameplay loop currently has zero working E2E coverage — regressions in reveal/end-turn/url-state ship undetected. This item is the plan's single highest-leverage testing investment.

**Progress (2026-07-05):** Seven specs brought fully green against a real browser + server (and verified in CI — the six committed before game-modes all passed there): `accessibility` (16/16, incl. a real a11y fix — an unlabeled range input), `standalone-game` (12/12), `game-mechanics` (11/11), `home`, `eigennamen-mode` (14/14), `game-flow` (9/9), and `game-modes` (8/8). The recurring root causes fixed: role buttons disabled until a team is joined (idempotent `selectTeam` + `becomeSpymaster`), End-Turn/New-Game confirmation modals, dynamic `:not(.revealed).first()` locators, the 500ms new-game debounce, room-creation auto-start (the erroneous `startGameBtn` clicks), the multiplayer clue-before-reveal rule (P0-2) and spymaster/clicker split (P0-1), the removed `share-link` element, and match-mode score badges in card text.

**Follow-up pass (2026-07-05) — the remaining specs are now green:** the additional pre-existing failures the first pass could not reach are all repaired:

- `setup-screen.spec.js` (18/18) — root-caused to the **D2 service-worker first-load reload** (see D2, now fixed) plus two test issues: both forms carry a `[data-action="setup-back"]` button (strict-mode multi-match → scope to the open form) and the `?game=` skip test needed the standalone setup-dismiss fix.
- `multiplayer.spec.js` / `-lifecycle` / `-extended` — real mechanisms, not flakes: chat lives in a **collapsed** panel (`#chat-body`, toggled by `#chat-toggle`) so the tests never saw the input (added an `openChat()` helper); `.host-badge` matches both the role banner and the (collapsed) player list (scope to the role banner); `"Host"` is a **reserved nickname** (`shared/validation` `RESERVED_NAMES`) so a create with it was rejected; a `STARTTEST…` room ID exceeded the **20-char** `createRoomIdSchema` cap; a non-host's "New Game" is correctly blocked with a host-only toast (assert that, not a disabled button); and a failed join surfaces its error in the modal status, not the selectors the test guessed. The two remaining 2-context specs (`reconnect-after-refresh`, `board-sync`) pass in isolation and under CI's `retries: 2` but flake under a single dev server at full-suite load.
- `security.spec.js` (33/33) — one **real product fix**: the admin `basicAuth` "not configured" 401 branch omitted the `WWW-Authenticate: Basic` challenge the other two 401 branches send (`adminRoutes.ts`, now consistent). The directory-traversal test over-asserted on status — the client normalizes `/../../etc/passwd` to `/etc/passwd`, which `express.static` confines and the SPA catch-all serves as `index.html` (200); rewrote it to send an encoded traversal and assert the passwd contents are never disclosed.
- `timer.spec.js` (4/4) — the two "timer display is visible" assertions were wrong: `.timer-inline` is `display:none` until a turn timer is actively running (it gains `.active`), and standalone mode has no server turn timer at all. Rewrote them to assert the display is attached to the turn-indicator layout (the visible-when-active path needs a full timer-enabled game flow, worth a dedicated spec).

A full local run (Chromium, `retries: 2` to match CI) is now **170 passed / 0 failed**, with only the two heavy 2-context specs (`reconnect-after-refresh`, `host-badge`) occasionally needing a retry under single-server load. Only step (d) — removing `--max-failures` and promoting the full E2E job into the blocking `ci-passed` gate — remains, now unblocked.

A new sub-finding surfaced while fixing game-modes, worth its own tracking: **the setup-screen host applies the game mode via `updateSettings({gameMode})` which races the room-creation auto-start** — a host selecting Duet/Classic can get a Match game. The E2E helper works around it, but it's a real product race (see the note under G-series / consider a Phase A item).

---

### D2 — The setup screen drops clicks during app-init (papered over by an E2E retry loop) — **FIXED 2026-07-05**

**Severity:** Low (real UX defect) · **Area:** Frontend / PWA / testing

**Root cause (corrected after investigation — the original layout-shift hypothesis was wrong):** the page **reloads itself once on the very first load**, and any click that lands before the reload is discarded (and the setup screen resets to the board). The reload comes from the service-worker registration in `app-fallback.js`: its `updatefound` → `statechange` handler reloads when a worker reaches `activated` *and* `navigator.serviceWorker.controller` is truthy. That guard was meant to skip the first install, but the SW calls `skipWaiting()` + `clients.claim()` (`service-worker.js`), so on a first-ever visit the new worker activates and immediately sets `.controller` — the guard passes and the page reloads. A Playwright probe confirmed it: two `framenavigated`/`load` events and a wiped `window` marker on cold load, gone after the fix. This is why `clickLocalUntilBoard()` had to retry the "Local" click, and why a real user's first click on the primary standalone entry point is occasionally ignored.

Separately, opening a standalone game URL (`?game=…`) left the setup screen (visible by default) rendered *on top of* the board: `app.ts`'s init un-hid `#app-layout` but never called `hideSetupScreen()` on that branch.

**Fix (shipped):** snapshot `hadControllerAtLoad = !!navigator.serviceWorker.controller` at registration time and reload only when a newly-activated worker takes over an **already-controlled** page (a genuine update for a returning visitor), never on first install (`app-fallback.js`). And call `hideSetupScreen()` in `app.ts`'s `?game=` branch so standalone URLs dismiss the setup screen. `setup-screen.spec.js` is now 18/18 green; the `clickLocalUntilBoard()` / `hostRoomWithMode()` retry loops are left in place as cheap defensive belts but no longer paper over a reload.

**Touches:** `public/js/app-fallback.js`, `src/frontend/app.ts` (+ rebuilt `public/js/modules/app.js`)

**Tests:** `setup-screen.spec.js` (18/18, incl. the `?game=` skip and both back-button forms). A dedicated cold-load no-reload assertion is worth adding to lock the SW guard.

---

### D3 — Extend the real-Redis Lua harness to the 18 scripts still never executed in blocking CI — **FIXED**

**Severity:** Medium · **Area:** Testing

**Resolution (shipped):** `__tests__/integration/luaScripts.test.ts` now drives, against embedded Redis, every script the harness previously skipped — through the real service functions wherever one exists, and by direct `eval` where none does:

- **Reveal (duet):** `revealCard.lua`'s duet branch — a green from the acting team's own perspective counts toward `greenFound`; a both-sides bystander spends a token and passes the turn; the A6 cross-perspective dead-green path ends with `winner=null`/`endReason='unreachable'`.
- **Token/session family:** `atomicGenerateReconnectToken` (issue + idempotent repeat), `atomicValidateReconnectToken` (single-use consume + `SESSION_MISMATCH` without consuming), `invalidateToken`, `cleanupOrphanedToken` (orphan deleted, live token kept), `atomicSetSocketMapping` (+ non-existent-player refusal), `atomicRemovePlayer`.
- **Player lifecycle:** `safeCleanupOrphans` (via `getPlayersInRoom` — a set entry with no backing player key is pruned), `atomicCleanupDisconnectedPlayer` (via `processScheduledCleanups` — disconnected player removed, reconnected one spared).
- **Timers:** `atomicTimerStatus`, `atomicAddTime`, `atomicPauseTimer`, `atomicResumeTimer` (+ null-for-no-timer cases).
- **Auth-adjacent:** `atomicRateLimit` (per-IP counter increments and blocks past the ceiling), `extendLock` (owner extends; a released lock refuses re-extension).
- **Room/history:** `atomicUpdateSettings`, `atomicRefreshTtl` (TTL bumped back up), `atomicSetRoomStatus` (direct `eval` — it has no production caller), `atomicSaveGameHistory` (round-trips through the room index).

**Bug this surfaced — and fixed:** the `cleanupOrphanedToken` case failed on first run because **`cleanupOrphanedReconnectionTokens` never cleaned anything under node-redis v5.** v5's `scanIterator` yields a *batch* (array) of keys per iteration; the loop (`reconnection.ts:215`) treated each yield as a single key string, so `key.replace(...)` threw on the array and the surrounding `catch` swallowed it — the function silently returned 0 every run. Impact was capped by the 5-minute token TTL (orphans self-expire), which is why it went unnoticed. Fixed by normalizing the yield (`Array.isArray(page) ? page : [page]`) so it works on both v4 and v5, and corrected the `AsyncIterable<string>` → `AsyncIterable<string[]>` type in `types/redis.ts:88` (the wrong type is what let this compile). A unit test (`reconnection.test.ts`) now mocks the v5 array shape so it can't regress. This is exactly the KEYS/ARGV-class silent failure D3 was written to catch.

**Root cause (original):** P1-9 covered the 7 highest-risk scripts (plus 4 run transitively); the rest had never executed against real Redis in any blocking test, so a shape/indexing/nil-guard regression passed the whole backend suite. Now closed.

**Touches:** `__tests__/integration/luaScripts.test.ts`, `services/player/reconnection.ts`, `types/redis.ts`, `__tests__/services/reconnection.test.ts`

**Tests:** This item is the tests (23 new real-Redis cases + 1 unit regression for the scanIterator batch shape).

---

### D4 — `createMockRedis` diverges from node-redis v5 in load-bearing ways; one divergence masks a real production bug

**Severity:** Medium · **Area:** Testing (+1 production defect)

**Root cause:** Three confirmed divergences (`__tests__/helpers/mocks.ts`): the mock's `zRange` honors a `WITHSCORES` option that the real client **silently ignores** (the client's zRange builder handles only BY/REV/LIMIT; `zRangeWithScores` is a separate command) — which masks a live bug: `getHistoryStats` (`services/gameHistory/storage.ts:445-446`) passes `WITHSCORES` to `zRange` and is broken in production (returns no scores), certified green by the mock. Also: mock `del()` never clears sorted sets; mock `zAdd` duplicates members instead of upserting. The hand-written `RedisClient` interface (`types/redis.ts:60`) wrongly declares the `WITHSCORES` option, which is why typecheck doesn't catch it.

**Fix:** Fix `storage.ts` to use `redis.zRangeWithScores(indexKey, 0, 0)`/`(-1, -1)`; correct the `RedisClient` type; delete the dead WITHSCORES branch from both mocks; make mock `del()` clear sortedSets and `zAdd` upsert by member; re-run the suite to surface tests leaning on the wrong semantics.

**Touches:** `services/gameHistory/storage.ts`, `types/redis.ts`, `__tests__/helpers/mocks.ts`, `__tests__/services/gameHistoryService.test.ts`

**Tests:** A real-Redis `getHistoryStats` case asserting non-null oldest/newest after two saves — fails on current `main`, proving the bug, passes after the fix.

---

### D5 — The load tests never exercise the reveal/clue hot path and their thresholds pass on zero samples

**Severity:** Medium · **Area:** Testing / performance

**Root cause:** In `loadtest/websocket-game.js`, `game:reveal` is emitted only inside a `game:started` listener, and no loadtest file ever emits `game:start` or `game:clue` — the reveal chain is unreachable dead code, so the headline "Card reveal latency <100ms p95" threshold (line 11/65) passes on zero samples, and the chat-latency metrics measure the wrong quantity. The single hottest server path (distributed lock + Lua reveal + broadcast) receives no load from the only load-testing tool the repo ships.

**Fix:** Pair VUs per room — one spymaster connection emitting `game:start` then `game:clue` on `game:started`; one clicker connection on the same team emitting `game:reveal`, recording latency send→matching `game:cardRevealed`. (A single VU can't do both: the server forbids spymaster reveals, and P0-1 blocks mid-game role changes.) Make thresholds fail on zero samples.

The same zero-sample / wrong-metric defect class is confirmed in **all three** sibling scripts:
- **`memory-leak-test.js`** can never fail: it builds `roomCode = memleak-${i}-${Date.now()}` (23+ chars, but room IDs cap at 20 in `schemaHelpers.ts:42`), so `room:create` is rejected every iteration and the snapshot block is never reached; and it does arithmetic on the `'NNMB'` heap **strings** from `/health/metrics`. Fix: shorten the code to ≤20 chars, use a non-reserved nickname (`'host'` is in `RESERVED_NAMES`), parse heap numerically, and exit non-zero if any iteration errored or fewer than N snapshots accumulated.
- **`stress-test.js`** sustain phase registers no listeners for `player:updated`/`room:resynced`/`*:error`, so `metrics.latencies`/`errors` gain zero samples — the "60-second sustained load" report reflects only ramp-up connection timing. Fix: register persistent listeners and correlate each emit with its response/ack.
- **`room-flow.js`** ramps 200 k6 VUs against `/api/rooms/:code/exists`, capped at 10/min/IP — after the first 10 requests every response is a 429, so its latency Trends measure rate-limited fast-rejects. Fix: a single opt-in `LOADTEST_RELAX_RATE_LIMITS` knob (refused in production) consulted by **both** `roomExistsLimiter` and the global `apiLimiter`, and count 429s in a separate metric excluded from latency.

**Touches:** `server/loadtest/{websocket-game,memory-leak-test,stress-test,room-flow}.js`, `middleware/rateLimit.ts` + `routes/roomRoutes.ts` (for the relax knob)

**Tests:** A local run of each showing its headline metric accumulates real samples (> 0) and at least one successful game action / room lifecycle.

---

### D6 — `bots:parity` never exercises numbered clues or voluntary end-turn — the rules most likely to drift sit outside the parity gate

**Severity:** Low · **Area:** Testing (bots)

**Root cause:** `parity.ts:26` only ever plays number-0 (unlimited) clues, so the engine's N+1 guess budget (`guessesForClue`) and `applyEngineEndTurn` are never cross-checked against `submitClue.lua`/`endTurn.lua` — precisely the clue-budget semantics real bot play (greedy clicker's bonus-guess logic) depends on.

**Fix:** Seed clue numbers 0–3 per clue via the existing seeded RNG; when the engine's turn survives its intended guesses, call `applyEngineEndTurn` and `gameService.endTurn` in lockstep and diff. Required addition: extend `snapshot()` to include `guessesAllowed` and `currentClue`, otherwise a `submitClue.lua` drift stays invisible to the diff.

**Touches:** `server/src/bots/harness/parity.ts`

**Tests:** The extended parity run is the test; verify it fails against a deliberately drifted engine rule.

---

### D7 — `dev-bots.mjs` download has no stall timeout, so a hung connection never retries

**Severity:** Low · **Area:** DX / tooling

**Root cause:** `downloadOnce` (`scripts/dev-bots.mjs:111-178`) sets no socket or request timeout — its error/aborted handlers cover explicit failures, but a TCP connection that stalls mid-transfer of the ~860 MB GloVe archive without emitting `error`/`aborted` leaves the retry loop (185-206) waiting forever, defeating the resume+retry machinery built for exactly this case.

**Fix:** Add an inactivity timeout — `req.setTimeout(30000, () => req.destroy(Object.assign(new Error('stalled'), { code: 'ETIMEDOUT' })))` (and/or reset a data-inactivity timer in the `res` `data` handler) so a stall becomes a transient error the existing backoff loop handles.

**Touches:** `scripts/dev-bots.mjs`

**Tests:** N/A (network tooling); manual verification against a throttled/interrupted download.

---

## Phase E — Performance

Rated against the real deployment (one shared-CPU machine, in-memory Redis, 25-card boards, rooms ≤ ~10 players). None of these is an emergency; E1/E2 are the structural ones.

### E1 — The full word pool (up to 2000 words) is persisted inside the game blob and re-serialized on every atomic op

**Severity:** Medium · **Area:** Performance / data layer

**Root cause:** `buildGameState` (`gameService.ts:206-208`) unconditionally stores the full resolved word pool on the game for every mode, but only match-mode round transitions ever read it. With the default 400-word list that's ~4.3 KB of the ~7 KB blob (~60%) as dead weight in classic/duet; with a 2000-word custom list, ~20 KB. The blob is cjson-decoded **and** re-encoded inside single-threaded Redis on every reveal/clue/endTurn (`revealCard.lua:28,285`), and JSON.parse + Zod-validated in Node on every `getGame` — which fires at least twice per reveal (playerContext + botController) and once per chat message in an active room (see E2/E3).

**Fix:** Persist `wordPool` only for `gameMode === 'match'`, or move it to a separate `room:<code>:wordpool` key written once per game and read only by `startNextRound`. If the separate key: migrate both readers (`gameService.ts:834`, `gameHandlers.ts:435` `ctx.game.wordPool ?? ctx.game.words`) and refresh the pool key's TTL alongside `persistGameState`. Update the existing test asserting classic games persist a wordPool (`gameServiceMatchDuet.test.ts:895-903`), which encodes the current wasteful behavior.

**Touches:** `services/gameService.ts`, `services/game/luaGameOps.ts` (schema), `socket/handlers/gameHandlers.ts`, `__tests__/services/gameServiceMatchDuet.test.ts`

**Tests:** Match regression: round 2+ still draws from the persisted pool. New: a classic-mode blob written to Redis contains no `wordPool`.

---

### E2 — `getPlayerContext` fetches and Zod-parses the full game state for every socket event, including ones that never read it

**Severity:** Low · **Area:** Performance

**Root cause:** `playerContext.ts:219` eagerly loads `ctx.game` for every in-room event — every chat message, `game:getHistory`, nickname change pays a full game-blob GET + parse + validation as pure overhead.

**Fix:** Expose `ctx.game` as a memoized async getter (lazy, fetched at most once per context) rather than an eager fetch — preferable to a hand-maintained opt-in list, which would miss the timer handlers' RoomContext-path reads.

**Touches:** `socket/playerContext.ts`, `socket/contextHandler.ts`, handler types

**Tests:** Existing suite (behavioral no-op); a unit test asserting chat events trigger zero game-state reads.

---

### E3 — `botController` ticks on every mutation of every room, including rooms that have never had a bot

**Severity:** Low · **Area:** Performance

**Root cause:** `botController.ts:271` subscribes to all game mutations and `tickRoom` (405/417) pays a full game fetch + parse plus a team-roster read before discovering there are no bot seats. ~40 mutations per game → ~80–120 wasted Redis calls + ~40 full-blob parses per bot-less game.

**Fix:** Maintain an in-process `Set<string>` of botful rooms (updated by `botService.addBot/removeBot`, cleared on teardown) — but **not** default-deny: bots are persistent Redis players, so after a process restart the set is empty while botful rooms exist. Use it as a cache with a "unknown → check once, then record" policy, or seed it at startup from Redis.

**Touches:** `bots/botController.ts`, `services/botService.ts`

**Tests:** Mutation in a bot-less room after the check → zero further Redis reads from the controller; bot still acts after a simulated restart (cache empty, room botful).

---

### E4 — Embeddings-backed clue generation runs up to 16 synchronous full-vocabulary scans on the event loop

**Severity:** Medium (currently latent — embeddings are disabled in production) · **Area:** Performance (bots)

**Root cause:** Every clue decision of an embeddings-backed spymaster runs ≥1 uncached `nearest()` scan (`vectorBackend.ts:322,355`) — candidates × dims dot products, ~50–150ms of blocked event loop per call at the 50k×100d default — and the first decision of a game runs up to 16 (`spymasters.ts:654`). While blocked, every room on the server stalls.

**Fix:** Cheapest first: (a) key the recurring centroid query on the turn-start own-set so the cache actually hits; (b) chunk the candidate scan with awaited `setImmediate` yields every ~5k candidates inside an async `nearest()` (only bot code calls it); (c) if needed later, a worker thread.

**Touches:** `bots/semantics/vectorBackend.ts`, `bots/strategies/spymasters.ts` (async plumbing)

**Tests:** Harness timing assertion: no single synchronous block > ~20ms during a first clue decision with a 50k-word backend.

**Risk / Notes:** Latent until `BOT_EMBEDDINGS_PATH` is enabled (fly.toml ships it commented out) — but `npm run dev:bots` enables it locally, and the fly.toml comments advertise enabling it in production. Land before flipping that switch.

---

## Phase F — Product decisions: finish or delete half-built features

Each of these carries either real runtime cost or a misleading API surface today. The decision (finish vs. delete) is the maintainer's; both paths are specified. F7 records the decisions.

### F1 — Game pause/resume: fully built server-side, zero frontend wiring

**Severity:** Medium · **Area:** Feature gap

**What exists:** handlers (`gameHandlers.ts:632-665`, host-only), service methods, Lua guards in all three mutation scripts, rate limits, tests, bot-controller pause reactions — all documented in CLAUDE.md. **What's missing:** any UI to trigger it, any client listener for `game:paused`/`game:resumed`, any `GAME_PAUSED` entry in `errorMessages.ts`. No user can pause a game; if a raw client did, every other player would be silently locked out with an unmapped error.

**Finish path:** host-only Pause/Resume button next to the forfeit control; emit/listen wiring through `socket-client.ts` + `handlers/gameEventHandlers.ts`; `state.gamePaused` flag rendered as a board overlay; `GAME_PAUSED` error message; i18n keys ×4. **Also required if finishing:** the `game:resume` handler restarts the turn timer without the expiry callback (`gameHandlers.ts:653-657` passes no `onExpire`, unlike `timerHandlers.ts:73-74`) — after pause/resume the timer expires silently and the turn never auto-ends; fix by threading `getSocketFunctions().createTimerExpireCallback()` and emitting `TIMER_RESUMED`. **Delete path:** remove handlers/service/Lua guards/rate limits and the dead client error mapping — the Lua-side guard complexity is the main carrying cost.

**Touches (finish):** `public/index.html`, `frontend/socket-client*.ts`, `frontend/handlers/gameEventHandlers.ts`, `frontend/handlers/errorMessages.ts`, `socket/handlers/gameHandlers.ts`, locales ×4

**Tests:** Frontend: `game:paused` sets state and disables clicks. E2E: host pauses → other client's reveal rejected + overlay; resume restores play *and a running timer that still expires correctly*.

**Risk / Notes:** Depends on A5 (schema strip) for any of the TS-side pause guards to work at all.

---

### F2 — `allowSpectators` is accepted, persisted, and exposed — but enforced nowhere and settable nowhere

**Severity:** Medium · **Area:** Feature gap

**What exists:** the setting in `roomSchemas.ts:18`, `atomicUpdateSettings.lua:37`, room defaults (`roomService.ts:62`), REST/admin exposure, Swagger. **What's missing:** any enforcement at join or role-change, any UI control. A host who sets `allowSpectators: false` via the API believes spectators are blocked; anyone with the code still joins and receives all broadcasts.

**Finish path:** enforce at the join boundary — but every joiner enters the lobby as role `spectator` by design, so gate on (a) joining a room whose game is in progress (the only necessarily-true-spectator case), and/or (b) spectator-role residency once a game starts. Add the settings-panel toggle. **Delete path:** remove from schema/Lua/defaults/Swagger/types.

**Touches (finish):** `services/room/membership.ts`, `socket/handlers/roomHandlers/roomMembershipHandlers.ts`, `frontend/multiplayerUI-settings.ts`, `public/index.html`

**Tests:** Join a `allowSpectators:false` room mid-game → rejected with a specific error; pre-game lobby joins unaffected.

**Risk / Notes:** Interacts with F6 (spectator-approval UI) — decide them together as one spectator-policy story.

---

### F3 — Admin audit log and SSE stats stream have no dashboard UI

**Severity:** Medium · **Area:** Feature gap (admin)

**What exists:** `/admin/api/audit` (`routes/admin/auditRoutes.ts:19`) with category/severity filtering; `/admin/api/stats/stream` SSE (`statsRoutes.ts:116`). **What's missing:** `admin.html`/`admin.js` never call the audit endpoint (security audit events — failed auths, kicks, admin actions — are reachable only by hand-crafted curl), and the dashboard polls stats every 10s instead of using the SSE stream (dead code carrying connection-management complexity).

**Finish path:** an Audit Log section (category/severity selects + table) in the existing refresh cycle; optionally switch polling to `EventSource`. **Delete path (SSE only):** remove the stream route — the audit endpoint should be wired up, not deleted, since auditService exists for it.

**Touches:** `public/admin.html`, `public/js/admin.js`, possibly `routes/admin/statsRoutes.ts`

**Tests:** Admin route tests already exist; add a dashboard smoke assertion that the audit table renders entries.

---

### F4 — `wordListId` is validated, typed, stored, and documented — and always null

**Severity:** Low · **Area:** Feature gap / API hygiene

**What exists:** the parameter flows through `roomSchemas.ts:19`, `gameSchemas.ts:16`, `CreateGameOptions`, game + history records, SERVER_SPEC. **What's missing:** `resolveGameWords` (`gameService.ts:84`) never reads it; no word-list library exists to back it. An API consumer sending a valid `wordListId` silently gets the default list; every history record carries a column that can never be non-null. The real custom-words feature uses the parallel `wordList` array path.

**Finish path:** a small wordlists service (Redis hash keyed by id, seeded from `public/locales` wordlists) consulted when `options.wordList` is absent. **Delete path:** remove from schemas/types/spec, keep the storage field nullable for old records.

**Touches:** `services/gameService.ts`, `validators/{room,game}Schemas.ts`, `types/`, `docs/SERVER_SPEC.md`

**Tests:** Whichever path: schema/spec agree with behavior.

---

### F5 — Idle detection: every socket event pays a Redis write for a feature that doesn't exist

**Severity:** Low · **Area:** Feature gap / performance

**What exists:** a fire-and-forget lastSeen-refresh Lua eval on every socket event (`contextHandler.ts:42`). **What's missing:** the only reader (`getIdlePlayers`, `player/queries.ts:220`) has zero production callers; `PLAYER_IDLE_WARNING` is never emitted. Pure write amplification on the hottest paths.

**Finish path:** an idle-warning sweep that emits the event and (product call) auto-rotates idle players to spectator. **Delete path:** remove the eval, `getIdlePlayers`, and the constant — **but** note the eval's real side effect is refreshing the `player:<sessionId>` key TTL, which `atomicRefreshTtl.lua` does not cover and which bot seats rely on; extend the debounced room TTL refresh to cover player keys before removing.

**Touches:** `socket/contextHandler.ts`, `services/player/queries.ts`, `services/roomService.ts` (TTL refresh), `config/socketConfig.ts`

**Tests:** Delete path: bot seats survive past the old lastSeen TTL under activity; finish path: idle warning fires at the configured threshold.

---

### F6 — Spectator approval flow: server + E2E exist, no UI (carried over from P1-13's discovery)

**Severity:** Medium · **Area:** Feature gap

**What exists:** `spectator:requestJoin`/`spectator:approveJoin` handlers, tests, and a raw-protocol E2E spec (P1-13 shipped it that way because no UI exists). **What's missing:** no button emits `spectator:requestJoin`; no listener reacts to `spectator:joinRequest`/`joinApproved`/`joinDenied`. HARDENING_PLAN explicitly scoped this out as "a feature gap, not a defect"; this item tracks it so it stops being nowhere.

**Finish path:** spectator-side "request to join team" control; host-side approval toast/queue; listeners + state wiring; i18n ×4. **Delete path:** remove the three handlers and their events — but the E2E spec and rate limits shipped for them argue the intent is to finish.

**Touches:** `frontend/` (roles/multiplayerUI), `public/index.html`, locales

**Tests:** Upgrade `spectator-approval.spec.js` from raw-protocol to UI-driven once wired.

---

### F7 — Create `docs/FEATURE_ROADMAP.md` and record the finish-or-delete decisions

**Severity:** Low · **Area:** Docs / planning

**Root cause:** HARDENING_PLAN's "See also" designates `docs/FEATURE_ROADMAP.md` for the first review's feature proposals — the file was never created, so those proposals exist only in a departed session's context, and the half-built features above have no recorded disposition.

**Fix:** Create the roadmap capturing: the first review's named proposals (custom word-list library, post-game recap, Redis-backed bot coordination, multilingual semantic maps), and a disposition row for each F-item here (F1–F6) once decided. Add to CLAUDE.md's Documentation Index.

**Touches:** new `docs/FEATURE_ROADMAP.md`, `CLAUDE.md`

---

## Phase G — Bot subsystem quality

Found in the code merged since the first review (PR #495–#497 era). G1 is a real playing-strength defect; the rest are tuning-infrastructure correctness.

### G1 — Match mode: own trap cards are excluded from the spymaster's win logic, which fires on clues that cannot win — **FIXED (primary defect)**

**Resolution (shipped):** `groupBoard` now tracks the excluded negative-value own cards in `BoardGroups.ownTraps`, and `scoreClue`'s full-board-lead check requires `groups.ownTraps.length === 0` — so covering only the non-trap own set is no longer treated as a board win while an own trap is unrevealed (no illusory `WIN_BONUS`, no desperation exemption, number stays capped). `groupBoard`/`scoreClue` are exported for a direct unit test on `coversAll` (trap present → false; none → true). The plan's second half — letting traps back into targeting so the bot can still close a round when only traps remain or the bonus exceeds trap cost — is a separate strategic change and remains open; mirroring in `analyze.ts` was a no-op (it carries no parallel trap grouping).


**Severity:** High (within bot play quality) · **Area:** Bots / match mode

**Root cause:** `groupBoard` (`strategies/spymasters.ts:119-124`) permanently reclassifies negative-value own cards (match traps) into `groups.neutral`. `scoreClue` then computes `coversAll` against the trap-filtered own set (369/383), grants `WIN_BONUS` (440), exempts desperation win attempts from the promise trim (381), and lifts the number cap — for clues that leave the own trap unrevealed, so `redScore < redTotal` and the round does **not** end: the oversized number sends the clicker fishing exactly as the promise doctrine forbids. Symmetrically, the trap never re-enters `groups.own`, so the bot structurally cannot close a round whose +7 bonus exceeds the trap's cost.

**Fix:** Set `coversAll` (and the desperation exemption) only when the trap-excluded set equals the full remaining own set — i.e. no own trap remains unrevealed. Separately, when only trap own cards remain (or the round bonus exceeds remaining trap cost), allow traps back into targeting so the bot can close the round. Mirror whichever rule lands in `analyze.ts`'s `boardGroupsFor` so the yardstick matches (see G3).

**Touches:** `bots/strategies/spymasters.ts`, `bots/harness/analyze.ts`

**Tests:** Match view with 3 own cards, one trap: a clue covering the 2 non-traps gets no `coversAll`/`WIN_BONUS` and never exceeds `MAX_CLUE_NUMBER`. Self-play: forced own-trap boards — bot team can still finish rounds.

---

### G2 — With embeddings enabled, the spymaster can never emit a mixed-case house-rule reference clue

**Severity:** Medium (latent in production; live in dev:bots) · **Area:** Bots / semantics

**Root cause:** `makeVectorBackend`'s merged vocabulary (`vectorBackend.ts:253-263`) pushes `normalizeClueWord(w)` — which uppercases — for every entry *including* the fallback table's carefully display-cased reference keys ("Cinderella" → "CINDERELLA"), and `nearest()` only yields all-caps tokens. The entire clue-capitalization house rule (CLAUDE.md headline behavior) silently disappears on the giving side, and an uppercased reference key reaching a human guesser reads as legacy-neutral instead of the intended reference — the exact ambiguity the house rule exists to remove.

**Fix:** Dedupe on `normalizeClueWord(w)` but push the original `w`; reserve headroom so table reference keys survive the vocab cap (merge tableVocab first). For the generated path, expose an optional `displayCase(word)` on `SemanticBackend` chaining through the fallback (tableBackend's `PROPER_DISPLAY` and mapBackend's `properDisplay` are both module-private today).

**Touches:** `bots/semantics/vectorBackend.ts`, `bots/semantics/tableBackend.ts`, `bots/semantics/mapBackend.ts`, `bots/strategies/spymasters.ts` (emit path)

**Tests:** `makeVectorBackend` with a fallback whose vocabulary is `['Cinderella']` → `backend.vocabulary()` contains `'Cinderella'` verbatim. Integration: a board whose top candidate is a proper key emits mixed-case.

---

### G3 — `analyze.ts`'s board-ceiling yardstick doesn't apply the spymaster's board-safety filter

**Severity:** Medium · **Area:** Bots / tuning infrastructure

**Root cause:** `boardBestLead` (`analyze.ts:235-251`) filters candidates only with `isClueLegalForBoard`, while the spymaster's generator additionally applies `makeBoardSafetyCheck` (cognate/near-duplicate rejection, `spymasters.ts:667-710`). Under embeddings — the configuration `bots:analyze` exists to tune — `ceilingUtilization`'s denominator is inflated by candidates every entrant is forbidden to play, producing spurious "selection gap" flags against a threshold (0.55) calibrated on a different filter set.

**Fix:** Build the same predicate in `boardBestLead` (`makeBoardSafetyCheck` is exported) and skip candidates failing it, so the yardstick's universe equals the player's.

**Touches:** `bots/harness/analyze.ts`

**Tests:** Backend whose `nearest()` returns a board-word near-duplicate scoring lead 2 plus a clean candidate scoring 1 → `boardBestLead` returns 1.

---

### G4 — The self-play leaderboard attributes every assassin loss to both entrants

**Severity:** Low · **Area:** Bots / tuning infrastructure

**Root cause:** `computeLeaderboard` (`harness/scoring.ts:62`) increments `assassinHits` for both personas of any assassin-ended game — a Guardian-vs-Daredevil pairing reports identical assassin stats, defeating the metric that validates the assassin-caution knobs.

**Fix:** For classic/match, attribute to the team that revealed it (record `assassinBy: Team` in `MatchResult` in `playGame.ts:164`); keep shared attribution only for duet (cooperative).

**Touches:** `bots/harness/scoring.ts`, `bots/harness/playGame.ts`

**Tests:** Leaderboard over a fixture where red reveals the assassin → red's entrant +1, blue's +0.

---

### G5 — `botHandlers.ts` shadows the Zod-inferred bot types with a hand-written one missing `advisor`

**Severity:** Low · **Area:** Quality (type safety)

**Root cause:** `botHandlers.ts:17-27` locally redefines `BotAddInput` with `role: 'spymaster' | 'clicker'` — missing `advisor` — and force-casts the schema to it (`as ZodType<BotAddInput>`, line 43), silently defeating the exhaustiveness guarantees the central Zod-inferred types (`validators/botSchemas.ts:40-41`) exist to provide.

**Fix:** Delete the local interfaces, import the inferred types, drop the casts.

**Touches:** `socket/handlers/botHandlers.ts`

**Tests:** Typecheck is the test; optionally a compile-time exhaustiveness assertion on role.

---

## Phase H — Documentation and code hygiene

### H1 — The socket-event documentation has two phantom events and omits seven real ones

**Severity:** Medium · **Area:** Docs

**Root cause:** CLAUDE.md (:233, :492, :497) and SERVER_SPEC.md (:419, :446) document `timer:start` and `timer:tick`, which have **no server handler and no emitter** — while omitting seven real registered events: `game:pause`/`game:resume`/`game:paused`/`game:resumed`, `game:readyCheck`/`game:ready`, `game:typing`. A client author following the spec would emit `timer:start` into the void and build countdown UI on ticks that never arrive; the frontend even ships a dead `timer:tick` listener (`socket-client-events.ts:268`).

**Fix:** Correct both docs — document that the turn timer is server-initiated (`timer:started` announces it); add the seven missing events; remove or explicitly mark the dead `timer:tick` listener. Optional guard: a doc-lint test diffing `SOCKET_EVENTS` values against CLAUDE.md's tables, mirroring `localeKeys.test.ts`.

**Touches:** `CLAUDE.md`, `docs/SERVER_SPEC.md`, `frontend/socket-client-events.ts`

---

### H2 — CLAUDE.md/ARCHITECTURE.md counts went stale again within days of the last hygiene pass

**Severity:** Low · **Area:** Docs

**Root cause:** PR #497 and the earlier clueUI/gameLog commits moved the counts (175 suites / 119 backend; 62 frontend modules; 12 utils files) and added two modules missing from the directory tree (`clueUI.ts`, `gameLog.ts`); ARCHITECTURE.md's suite count is 19 behind; CLAUDE.md:339's data-flow line orders validation before rate limiting, contradicting both its own pipeline description and the code.

**Fix:** Correct the counts and tree; reverse the data-flow line to "rate limiter → Zod validation". Consider approximate counts ("~175 suites") since exact ones demonstrably rot within days.

**Touches:** `CLAUDE.md`, `docs/ARCHITECTURE.md`

---

### H3 — `bots/strategies/spymasters.ts` (850 lines) outgrew the decomposition convention untracked

**Severity:** Low · **Area:** Code quality

**Root cause:** PR #497 grew it to the second-largest file in the repo, 29 lines shy of `gameService.ts` (the one file tracked for decomposition as P3-1), and each bot-nuance phase adds more.

**Fix:** Fold into P3-1's execution: split `makeBoardSafetyCheck`/`isClueBoardSafe` (lines ~605-719) into `bots/strategies/clueSafety.ts` and the `ClueEval` scoring block into its own module, mirroring `bots/semantics/`' file-per-concern layout. `gameHandlers.ts` (672 lines) can similarly shed its ready-check/pause/typing block if F1 keeps pause.

**Touches:** `bots/strategies/spymasters.ts` (+ new files), optionally `socket/handlers/gameHandlers.ts`

**Tests:** Pure refactor — existing suite green.

---

### H4 — `onMultiplayerJoined`'s room-change reset is dead code, leaking advisor badges across rooms

**Severity:** Low · **Area:** Frontend quality

**Root cause:** Every caller assigns `state.currentRoomId` to the new room code immediately before calling it (`multiplayer.ts:236,317`), so the `currentRoomId !== newRoomId` check inside (`:340`) can never be true and `resetMultiplayerState()` never fires on room switch — leaving room A's index-addressed advisor-suggestion badges rendered onto arbitrary cards of room B's board.

**Fix:** Move ownership of the assignment into `onMultiplayerJoined` (signature takes the fallback room code, since callers use `result.room?.code || normalizedRoomId`), so the comparison runs against the *old* value before assignment.

**Touches:** `frontend/multiplayer.ts`

**Tests:** Join room A (with suggestions rendered), then join room B without leaving — assert suggestion badges are cleared.

---

### H5 — The OpenAPI spec omits `/api/replays` and documents a room-code format that no real code matches

**Severity:** Low · **Area:** Docs (machine-readable contract)

**Root cause:** `config/swagger.ts`'s `paths` (187-385) cover only the five health endpoints and two room GETs — `/api/replays/{roomCode}/{gameId}` (registered at `routes/index.ts:12`, X-Session-Id-gated) is entirely absent. The documented room-code schema is wrong three ways: `pattern: '^[A-Z0-9]{6}$'` (:148) / `'^[A-Za-z0-9]{6}$'` "6-character room code" (:319, :353) versus the real 3–20-char, lowercase-normalized, user-chosen codes allowing `-`/`_` (`schemaHelpers.ts:38-45`). A client generated from the served `/api-docs.json` would reject every real code and never learn the replay endpoint exists — the same drift class H1 covers for socket events, now in the machine-readable contract.

**Fix:** Add a `components.securitySchemes.sessionId` (`apiKey`, header `X-Session-Id`) and the `/api/replays/{roomCode}/{gameId}` GET path (200/400/401/403/404/429, `gameId` as UUID); replace the three room-code schemas with the real 3–20-char pattern.

**Touches:** `server/src/config/swagger.ts`

---

### H6 — `docs/DEPLOYMENT.md` quotes a `fly.toml` that doesn't exist and recommends a scale that splits rooms

**Severity:** Low · **Area:** Docs

**Root cause:** DEPLOYMENT.md:138-164 claims "the repository includes `fly.toml` with recommended settings" then quotes `PORT = "8080"`, `internal_port = 8080`, `min_machines_running = 0`, `auto_stop_machines = true`, and a `[[services]]` block — none of which match the real file (PORT 3000, `min_machines_running = 1`, `auto_stop_machines = "stop"`, and the load-bearing `REDIS_URL = "memory"`/`MEMORY_MODE_ALLOW_FLY = "true"` omitted). The Scaling section unconditionally recommends `fly scale count 2`, which under the shipped memory-mode config produces the split-brain "room not found" failure `fly.toml`'s own comment warns about.

**Fix:** Replace the stale inline block with the real `fly.toml` key settings (or link to the well-commented file), explicitly including the memory-mode defaults; place the single-machine constraint directly beside `fly scale count 2`, cross-referencing the `fly redis create` steps required before scaling past 1.

**Touches:** `docs/DEPLOYMENT.md`

---

### H7 — `docs/BACKUP_AND_DR.md` misstates Redis-failure behavior (the P1-2 change it predates)

**Severity:** Low · **Area:** Docs

**Root cause:** BACKUP_AND_DR.md:183 (Scenario D) says the app "will continue attempting reconnection with exponential backoff … max 10 retries." The actual code (the P1-2 fix, `config/redis.ts:210-222`) exits the process after 20 retries so the platform restarts it — neither the count nor the end state matches. During a real outage, an operator reading this runbook will misread the designed crash-loop self-heal as a new bug.

**Fix:** Update Scenario D to describe the real behavior: backoff for attempts 0–20, then `process.exit(1)` and platform restart (repeating until Redis recovers); note memory-mode state does not survive restarts. Cross-reference HARDENING_PLAN P1-2.

**Touches:** `docs/BACKUP_AND_DR.md`

---

## Phase I — Security and network resilience

I1 is the one security-classed finding of this review with a concrete external-probe scenario; I2–I4 are reconnection-robustness gaps that compound A2.

### I1 — Room-code enumeration is throttled on `/exists` but not on `/:code`, which leaks more at 10× the rate

**Severity:** Medium · **Area:** Security

**Root cause:** The dedicated 10/min limiter (`ROOM_EXISTS`, "prevents room enumeration") is applied only to `GET /:code/exists` (`roomRoutes.ts:44-47`). The sibling `GET /:code` (62-96) has no per-route limiter — only the general 100/min `apiLimiter` — and returns a *superset*: 200-with-details (team names, `allowSpectators`, status, player count) vs 404. Room codes are host-chosen 3–20-char strings (guessable common words) and serve as the room's access key, so the control added specifically for this threat is bypassable at 10× the intended rate through the richer endpoint.

**Fix:** Apply the same `roomExistsLimiter` instance to `GET /:code` so both enumeration surfaces share one per-IP bucket.

**Touches:** `server/src/routes/roomRoutes.ts`

**Tests:** Route test asserting `GET /api/rooms/:code` returns 429 past the ceiling. **Caveat:** `roomExistsLimiter` has `skip: () => NODE_ENV === 'test'` (`roomRoutes.ts:20`) — the test must override `NODE_ENV` or make the skip injectable, or it passes vacuously.

---

### I2 — Server and client pick Socket.io transports by different predicates; an HTTP-served production deploy can't connect at all

**Severity:** Low · **Area:** Network / defect

**Root cause:** Server chooses `isProduction() ? ['websocket'] : ['polling','websocket']` (`serverConfig.ts:34`); client chooses by page scheme `url.startsWith('https://') ? ['websocket'] : ['polling','websocket']` (`socket-client-connection.ts:114-115`). They diverge when `NODE_ENV=production` but the page is served over plain HTTP (a self-hosted Docker/LAN deployment): the client opens with a polling handshake, the websocket-only server rejects it, and engine.io-client doesn't advance transports without `tryAllTransports` — so multiplayer is entirely non-functional with only a generic `connect_error`. (The Fly HTTPS deployment and the `NODE_ENV=development` docker-compose default are unaffected, which is why it's latent.)

**Fix:** Make the client resilient regardless of scheme: `transports: ['websocket', 'polling']` (websocket first) with `tryAllTransports: true` — websocket-first succeeds against the production websocket-only server whether the page is HTTP or HTTPS, and polling stays as fallback. Keeps the server's deliberate Fly-motivated websocket-only production setting intact.

**Touches:** `server/src/frontend/socket-client-connection.ts`

**Tests:** Integration test connecting a default client to a `NODE_ENV=production` server over HTTP and asserting the connection succeeds.

---

### I3 — `connectionStateRecovery` is silently inert whenever the Redis adapter is installed

**Severity:** Low · **Area:** Network / resilience

**Root cause:** `serverConfig.ts:43-48` enables Socket.io connection-state recovery (2-min window), but `serverConfig.ts:70-71` then installs `@socket.io/redis-adapter` for non-memory deployments — whose `RedisAdapter` does not implement `persistSession`/`restoreSession`, so `socket.recovered` is always false and missed packets are never replayed. In the documented external-Redis tier, recovery never happens; every blip takes the full `room:reconnect`/resync path (compounding A2/I4).

**Fix:** Minimal correct fix: in the non-memory branch, log a startup notice that connection-state recovery is inactive with the pub/sub adapter and reconnection relies solely on the app-level `room:reconnect`/resync flow. If recovery is actually wanted on that tier, migrate to `@socket.io/redis-streams-adapter` (which implements the session hooks). Do **not** simply drop the `connectionStateRecovery` block — it still works in memory mode.

**Touches:** `server/src/socket/serverConfig.ts`

**Tests:** Startup assertion that the notice logs when a Redis adapter is installed.

---

### I4 — Client abandons auto-reconnect after ~15–20s while the server holds session state for minutes

**Severity:** Low · **Area:** Network / resilience

**Root cause:** The client stops retrying permanently after 5 attempts (`constants.ts:142-144`, ~15–20s), while the server sizes its windows an order of magnitude larger (2-min connection-recovery window; multi-minute disconnect grace). Any outage longer than ~20s (WiFi roam, laptop sleep, mobile handoff) permanently kills automatic reconnection even though the server would still accept the same session.

**Fix:** Raise the client budget to cover the server window: `reconnectionAttempts: Infinity` (or ≈24+, `ceil(MAX_DISCONNECTION_DURATION_MS / RECONNECT_DELAY_MAX_MS)`), keeping `reconnectionDelayMax: 5000`. **Also** fix `socket-client.ts:51-52`, which hard-codes `maxReconnectAttempts: 5` instead of importing `CONNECTION.MAX_RECONNECT_ATTEMPTS` — changing only `constants.ts` would have no effect. Pairs with A2 (which fixes what happens *when* a reconnect succeeds).

**Touches:** `server/src/frontend/constants.ts`, `server/src/frontend/socket-client.ts`, `socket-client-connection.ts`

**Tests:** Simulate a 60s outage; assert the client is still retrying (not permanently stopped) and rejoins on recovery.

---

## Suggested sequencing

Ordered by leverage and dependency, not by phase letter. Each tranche is a plausible PR-sized batch.

**Tranche 1 — unblock verification and stop the bleeding (do first):**
- **D1** (green E2E suite) — everything in Phase A wants trustworthy end-to-end coverage to verify against; without it, Phase A fixes ship on unit tests alone.
- **B10** then **B6** (deploy health-check grep, then commit-pinning + rollback) — B6's rollback logic is meaningless while B10 makes every verification falsely fail.
- **B5 step 1–2** (document the deploy-wipes-state reality + fix the broken shutdown warning) — cheapest possible mitigation of the biggest user pain.
- **B13** (Node 25 → 24 LTS) — a one-line base-image change closing an EOL-runtime gap; align it with the tested matrix now.

**Tranche 2 — the common-path reliability cluster:**
- **A2 + A3 + I4** (reconnection: detect the blip, don't fall through to standalone, keep retrying long enough) — one coherent reconnection story; A2 is the linchpin.
- **B1 + A10 + B9** (start the cleanup sweep, and fix the two things that misbehave once it runs) — must land together; starting a never-run sweep in isolation surfaces A10/B9.
- **A5** (paused-field schema strip + the systemic schema-drift test) — small, and the drift-guard test prevents a whole recurring class.
- **A4** (kick actually disconnects) — self-contained moderation + info-exposure fix.

**Tranche 3 — game-integrity correctness:**
- **A1** (duet blue spymaster view), **A7** (match round-finalize guard, after **B3**), **A8** (client fallback role guard), **A9** (replay links), **A11** (fold into HARDENING_PLAN **P2-2**), **G1** (match trap-card win logic). **A6** (duet cross-perspective) gated on **D3** landing.
- **B3 + D4** (WatchError retry + mock fidelity) together — both are node-redis-v5 semantics gaps in the same layer.

**Tranche 4 — accessibility, i18n, PWA:**
- **C1 + C2** (timer live-region + double-announce) first — together they make timed rooms usable with a screen reader.
- **C3** (PWA offline) — self-contained, high value for the standalone/PWA promise.
- **C4 + C5 + C6 + C7 + C9** — the i18n bundle; extend the P1-11 locale test to guard each new class.

**Tranche 5 — CI hardening, deployment safety, security:**
- **B7, B11, B12, B14, B15**, **I1** — mostly config/workflow changes, independently landable.
- **D3, D5, D6, D7** — test-infrastructure depth (D3 before A6/A11's Lua work).

**Tranche 6 — performance, product decisions, hygiene:**
- **E1** (word-pool blob) before **E2/E3** (they compound its cost); **E4** before enabling embeddings in production.
- **Phase F** — one deliberate finish-or-delete pass, recorded in **F7** (`FEATURE_ROADMAP.md`). Decide F1/F2/F6 as one spectator-and-pause product story.
- **Phase H** (docs/decomposition) — fold **H3** into HARDENING_PLAN **P3-1**; the rest are low-risk doc corrections batchable anytime. Consider a doc-lint test (H1) to stop the counts/event-table drift recurring.

## Cross-reference: item → severity

Severity tally: **9 High · 32 Medium · 29 Low** across 70 items. High and Medium items are the tracked work; Low items are batchable hygiene. Severities are rated against the current single-instance memory-mode deployment — several notes flag where a severity rises if external Redis or multi-instance scaling (HARDENING_PLAN Phase 2) lands first.

| ID | Sev | Item |
|---|---|---|
| A1 | High | Duet blue spymaster never receives their key card on game start |
| A2 | High | A brief network blip silently detaches the client from all room broadcasts |
| A3 | High | While disconnected in multiplayer, board actions fall through to the standalone engine |
| A4 | High | player:kick fails to disconnect the target once the session–socket mapping expires |
| A5 | Medium | gameStateSchema silently strips the paused field (and any future field) |
| A6 | Medium | Duet: a green revealed from the wrong perspective is permanently dead (co-op win unreachable) |
| A7 | Medium | finalizeMatchRound has no gameOver/idempotency guard |
| A8 | Medium | Client clicker-fallback invites roles the server forbids |
| A9 | Medium | Shared replay links never show the replay |
| A10 | Medium | A host removed by grace-period expiry is never replaced — room bricked |
| A11 | Medium | Timer expiry races addTime/pause on stale state (fold into P2-2) |
| A12 | Low | Match-mode abandon consumes the round number |
| B1 | Medium | The scheduled player-cleanup sweep is never started in production |
| B2 | Medium | P0-3 lock-budget invariant still violated at remaining withLock sites |
| B3 | Medium | WATCH/MULTI conflict-retry is dead code under node-redis v5 |
| B4 | Medium | A seated bot with a missing config silently stalls the game |
| B5 | High | Every deploy destroys all live games with no working warning |
| B6 | Medium | deploy.yml ships main HEAD, not the CI-validated commit; auto-deploy has no rollback |
| B7 | Low | release.yml interpolates a dispatch input into a shell script |
| B8 | Low | Embedded redis-server orphaned on startup-failure/forced-shutdown paths |
| B9 | Low | Cleanup counts bots as occupants; bot-only rooms never torn down |
| B10 | Medium | deploy.yml health check greps for a string /health/ready never returns |
| B11 | Medium | workflow_dispatch deploys bypass the CI gate and can ship any branch |
| B12 | Medium | The "staging" deploy option deploys the production app |
| B13 | Medium | Production runs EOL Node 25, untested by CI |
| B14 | Low | Shutdown budget exceeds Fly kill_timeout; open SSE blocks server.close() |
| B15 | Low | Dependabot misses the root docker-compose.yml redis image |
| C1 | High | Active turn timer makes the turn indicator a once-per-second live region |
| C2 | Low | Every toast is announced twice to screen readers |
| C3 | High | PWA is dead offline: no JS precached; game URLs 503 |
| C4 | Medium | t() HTML-escapes params rendered as text — clues show as entities |
| C5 | Medium | Lifecycle/timer/reconnect toasts hardcoded English despite existing keys |
| C6 | Medium | No i18n mechanism for aria-label — 27 English labels |
| C7 | Low | t()'s English fallback is dead for non-English users |
| C8 | Low | openModal() focuses disabled controls, losing focus behind the dialog |
| C9 | Low | Bot persona names/descriptions untranslatable |
| D1 | High | Make the E2E suite green and meaningful again |
| D2 | Low | Setup screen drops clicks during app-init translation |
| D3 | Medium | Extend the real-Redis Lua harness to the 18 untested scripts |
| D4 | Medium | createMockRedis diverges from node-redis v5; masks a getHistoryStats bug |
| D5 | Medium | Load tests never exercise the hot path; thresholds pass on zero samples |
| D6 | Low | bots:parity never tests numbered clues or voluntary end-turn |
| D7 | Low | dev-bots.mjs download has no stall timeout |
| E1 | Medium | Full word pool persisted in the game blob, re-serialized every op |
| E2 | Low | getPlayerContext parses full game state for every event |
| E3 | Low | botController ticks on every mutation of every (even bot-less) room |
| E4 | Medium | Embeddings clue-gen runs synchronous full-vocab scans on the event loop |
| F1 | Medium | Pause/resume fully built server-side, zero frontend wiring |
| F2 | Medium | allowSpectators accepted and exposed but enforced/settable nowhere |
| F3 | Medium | Admin audit log + SSE stats stream have no dashboard UI |
| F4 | Low | wordListId validated, stored, documented — and always null |
| F5 | Low | Idle detection: per-event Redis write for a feature that doesn't exist |
| F6 | Medium | Spectator-approval flow: server + E2E exist, no UI |
| F7 | Low | Create docs/FEATURE_ROADMAP.md + record finish-or-delete decisions |
| G1 | High | Match: own trap cards excluded from win logic; fires on unwinnable clues |
| G2 | Medium | With embeddings, spymaster can't emit mixed-case reference clues |
| G3 | Medium | analyze.ts ceiling yardstick omits the board-safety filter |
| G4 | Low | Self-play leaderboard blames both entrants for every assassin loss |
| G5 | Low | botHandlers.ts shadows the Zod bot type, dropping 'advisor' |
| H1 | Medium | Socket-event docs: two phantom events, seven real ones omitted |
| H2 | Low | CLAUDE.md/ARCHITECTURE.md counts stale again; data-flow line wrong |
| H3 | Low | spymasters.ts (850 lines) outgrew decomposition, untracked (fold into P3-1) |
| H4 | Low | onMultiplayerJoined room-change reset is dead code (advisor-badge leak) |
| H5 | Low | OpenAPI spec omits /api/replays; wrong room-code pattern |
| H6 | Low | DEPLOYMENT.md quotes a non-existent fly.toml; unsafe scale advice |
| H7 | Low | BACKUP_AND_DR.md misstates Redis-failure behavior (predates P1-2) |
| I1 | Medium | Room-code enumeration throttled on /exists but not /:code |
| I2 | Low | Server/client transport-predicate mismatch breaks HTTP-served prod |
| I3 | Low | connectionStateRecovery inert whenever the Redis adapter is installed |
| I4 | Low | Client reconnect budget (~20s) far shorter than the server's window |

## Relationship to HARDENING_PLAN.md

This plan is additive and non-overlapping with HARDENING_PLAN.md. Explicit interactions:

- **A11** should be implemented **as** HARDENING_PLAN **P2-2** (Redis-authoritative timer expiry) — same mechanism, don't build twice.
- **H3** (spymasters.ts decomposition) should fold into HARDENING_PLAN **P3-1** (gameService.ts decomposition) as a sibling.
- **B2** re-audits the same `withLock` invariant **P0-3** established, at the sites P0-3 didn't reach.
- **B3/D4** exercise the WATCH path that **P1-9**'s real-Redis harness made testable; **D3** extends that same harness.
- **B5** and the deploy items (**B6/B10/B11/B12**) are the concrete, reachable-today face of the risk **P2-5** only guards against for the second-machine case.
- Several items note their severity rises once HARDENING_PLAN **Phase 2** (external/multi-instance Redis) lands: **B2** (lock budgets), **I3** (recovery), **A11** (timer authority).

## Verification note

This plan was produced by fourteen independent review passes plus an adversarial verification pass over every candidate finding and a completeness critique of the review itself. Two reviewer/verifier agents were lost to transient model-safeguard false-positives and their scope (auth-middleware deep-read, one workflow verifier) was re-run separately. The security-middleware stack (`middleware/auth/*`, `csrf.ts`, `jwt.ts`, `sanitize.ts`, logger redaction) was spot-checked and found to match its documented properties; a full line-by-line audit of that stack is the one review area worth a dedicated follow-up pass, since its first attempt was interrupted. Every item above cites exact file:line evidence that survived an adversarial read; where a fix direction had a flaw, the verifier's corrected fix is the one recorded here.
