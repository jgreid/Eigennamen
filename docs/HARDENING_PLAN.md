# Hardening Plan

This is the tracked remediation plan for the codebase-wide hardening review conducted in July 2026. It covers every confirmed finding from that review — game-integrity exploits, concurrency races, scaling-readiness gaps, and quality/documentation drift — with a concrete fix, the files it touches, the tests it needs, and how it sequences against the other items.

**Status of this document:** Phase 0 (all 5 items) has shipped, with regression tests, and the full suite (167 suites / 4181 tests), lint, and typecheck all pass. Phases 1–2 are still planning only. The documentation fixes in [Phase 3 / Doc hygiene](#doc-hygiene-done-this-pass) landed earlier. Treat each item's status marker as the source of truth for what's actually shipped — update it in the same PR that closes the item.

**How the review was conducted:** eight independent passes (game integrity, concurrency, auth/input validation, backend resilience, the bot subsystem, frontend/i18n/accessibility, testing/CI-CD/code quality, and feature discovery) read the source directly, and the two most severe claims (P0-1, P0-2) were independently re-derived by reading `playerContext.ts`, `setRole.lua`, `revealCard.lua`, and the reveal socket handler a second time before being accepted. Baseline at review time: `npm audit` 0 vulnerabilities, lint/typecheck clean, 4,167/4,167 tests passing across 167 suites.

## How to read this document

Each item has:

- **Root cause** — why the bug exists, not just what it does
- **Fix** — the concrete code change, naming the actual functions/files involved
- **Touches** — files that need to change
- **Tests** — what regression coverage the fix must ship with
- **Risk** — what could go wrong with the fix itself, or what it depends on

Phases are ordered by how soon the gap can bite, not by which review dimension surfaced it — a Phase 0 item from "concurrency" is more urgent than a Phase 2 item from "game integrity" if that's how the actual risk sorts out.

---

## Phase 0 — Stop the exploitable gameplay bugs (this week) — ✅ Shipped

Every item here is reachable today, in the default single-instance deployment, with no timing race required for P0-1/P0-2 and only an ordinary reconnect-timing window for P0-4. All 5 items below have shipped in one PR (with commit-level separation between items) rather than five separate PRs, since this session's workflow is constrained to a single designated branch — each commit is independently revertable if needed.

### P0-1 — Block the spymaster → clicker role swap — ✅ Shipped

**Severity:** Critical · **Area:** Game integrity

**Root cause:** `canChangeTeamOrRole` (`socket/playerContext.ts:261–312`) blocks a spymaster from *changing teams* and blocks an *observer* from ever leaving their role — but the identical case of a spymaster swapping to **clicker on the same team** falls through to `return { allowed: true }` (either explicitly at line 301–302 during the team's own turn, or via the unconditional fallthrough at line 311 otherwise). `setRole.lua` has no memory of which roles a player has already held this game — it only checks whether the *target* seat is free.

**Fix:** Add an unconditional guard — independent of `game.currentTurn` — in `canChangeTeamOrRole` that rejects `targetRole === 'clicker'` whenever `player.role === 'spymaster'`, using the same lockout shape as the existing observer guard (`playerContext.ts:289–295`). Introduce a dedicated error code (`SPYMASTER_CANNOT_BECOME_CLICKER`) rather than reusing `SPYMASTER_CANNOT_CHANGE_TEAM`, so the client-facing message is accurate ("Cannot become clicker after being spymaster this game — you have seen the whole board") instead of talking about team changes.

**Touches:**
- `socket/playerContext.ts` (the new guard)
- `config/errorCodes.ts`, `types/errors.ts`, `errors/GameError.ts` (new error code)
- `frontend/handlers/errorMessages.ts` (client-facing message)
- `__tests__/middleware/playerContext.test.ts` (new case, mirroring the existing observer regression test at ~line 346–355)

**Tests:** A spymaster attempting `targetRole: 'clicker'` must be rejected both when it *is* and when it *is not* their team's turn (the current bug is specifically that the "not their turn" path falls through to allowed). Verify a spymaster can still become `spectator`/`advisor`/`observer` when the existing mid-turn-abandon rule permits it — this fix must not touch that unrelated path.

**Risk:** Low — this narrows an existing permission check; it can only make previously-illegal actions rejected, so there's no way for it to newly allow something.

**Shipped as:** broadened during implementation — a spymaster is now blocked from leaving the role *at all* while a game is active (`targetRole !== 'spymaster'`, not just `=== 'clicker'`), mirroring the observer lockout exactly, because the narrower fix left a `spymaster → spectator → clicker` laundering path open (the same class of hole the observer guard exists to close). Shipped error code is `SPYMASTER_CANNOT_CHANGE_ROLE` (analogous naming to the existing `SPYMASTER_CANNOT_CHANGE_TEAM`), not `SPYMASTER_CANNOT_BECOME_CLICKER`. Also fixed a latent bug found while wiring this up: `playerRoleHandlers.ts`'s `PLAYER_SET_ROLE`/`PLAYER_SET_TEAM_ROLE` handlers were discarding `canChangeTeamOrRole`'s returned `code` and always throwing the generic `CANNOT_CHANGE_ROLE_DURING_TURN` — fixed to match the `PLAYER_SET_TEAM` handler's existing pattern of using the specific code when present.

---

### P0-2 — Require an active clue before a reveal is accepted — ✅ Shipped

**Severity:** Critical · **Area:** Game integrity

**Root cause:** A fresh turn starts with `guessesAllowed: 0, currentClue: null`. `revealCard.lua`'s only guard is `game.guessesAllowed > 0 and game.guessesUsed >= game.guessesAllowed` (line 50) — which never fires when `guessesAllowed` is exactly 0, because `0` is deliberately overloaded to also mean "unlimited guesses" (a value `submitClue.lua` legitimately produces for a real clue-number-0). Nothing anywhere checks that `currentClue` is actually non-null before allowing a reveal.

**Fix:** Add an explicit "no active clue" rejection, distinct from the guessesAllowed-0-means-unlimited sentinel, in both places that currently check reveal preconditions:
- `scripts/revealCard.lua`: before the existing guesses check, add `if not game.currentClue or game.currentClue == cjson.null then return cjson.encode({error = 'NO_CLUE_GIVEN'}) end`.
- `socket/handlers/gameHandlers.ts` (`GAME_REVEAL` handler): add the same check against `ctx.game.currentClue` alongside the existing paused/turn/role checks, so the client gets a clean rejection before the Lua round-trip (defense in depth, consistent with how `GAME_PAUSED` is checked in both places already).

**Touches:**
- `scripts/revealCard.lua`
- `socket/handlers/gameHandlers.ts`
- `config/errorCodes.ts` (new `NO_CLUE_GIVEN` code), `frontend/handlers/errorMessages.ts`
- `__tests__/services/gameService.test.ts` or equivalent Lua/service test (new case)

**Tests:** Start a turn, call `game:reveal` before any `game:clue` — expect `NO_CLUE_GIVEN`, not a successful reveal. Confirm the legitimate clue-number-0 ("unlimited guesses") flow is unaffected: submit a clue with number 0, then reveal repeatedly — must still succeed, since `currentClue` is non-null in that case even though `guessesAllowed` is 0.

**Risk:** Low, but this is exactly the kind of fix that most needs the real-Redis Lua test harness (P1-9) rather than a mocked `evalSha` — see the sequencing note at the end of this phase.

**Shipped as:** also restored `services/game/revealEngine.ts`'s `validateRevealPreconditions` — a second, previously-*dead* precondition check (unused by any live code path, only exercised by its own unit test, whose test name literally said "clue tracking removed") that would otherwise have sat there silently contradicting this fix. Touched test files: `__tests__/services/gameServiceExtended.test.ts`, `__tests__/scripts/luaScriptLogic.test.ts` (new Lua source-contract case), `__tests__/handlers/gameHandlers.test.ts`, `__tests__/handlers/gameHandlersExtended.test.ts`. Also discovered and fixed that the bot self-play engine (`bots/engine.ts`, shared by the training/analysis harness) and its tests (`__tests__/bots/engine.test.ts`) never modeled the clue-then-reveal sequence at all — fixed to call `applyEngineClue` before every reveal, same as the real game. The standalone `npm run bots:parity` script (`bots/harness/parity.ts`, not part of `npm test`) was fixed the same way for consistency, though it wasn't part of the blocking test run.

---

### P0-3 — Fix lock-timeout budgets shorter than the operation they guard — ✅ Shipped

**Severity:** Critical · **Area:** Concurrency

**Root cause:** `withLock` (`utils/distributedLock.ts:186–192`) races the wrapped function against an internal timeout of `lockTimeout - 500ms` and releases the lock in a `finally` regardless of outcome. `withTimeout` (`utils/timeout.ts:25–54`) never cancels the losing promise — it attaches a no-op `.catch()` so Node doesn't see an unhandled rejection, and the original operation keeps running in the background. Concretely: `timerService.startTimer` calls `withLock('timer:…', …, { lockTimeout: 3000 })`, giving its callback only 2,500ms — but that callback's own inner Redis call is separately budgeted for `TIMEOUTS.TIMER_OPERATION` (5,000ms). A write that takes 2.6–5s is entirely within its own declared budget, yet the lock is force-released and the caller told "failed" while the write is still in flight — and because the lock released early, a second legitimate request for the same room can now run concurrently with the "abandoned" one.

**Fix, in two parts:**

1. **Immediate — audit every `withLock` call site.** Grep for `withLock(` across `services/`, ensure `lockTimeout` is always comfortably larger than the largest inner timeout used inside that call's own callback. Fix the concrete instance now: bump `timerService.startTimer`'s `lockTimeout` from `3000` to at least `TIMEOUTS.TIMER_OPERATION + 1500` (≥6,500ms) so the operation budget (`lockTimeout - 500`) safely exceeds the inner Redis budget. Add a JSDoc note on `withLock` spelling out the invariant ("lockTimeout must exceed the slowest realistic inner operation by a safety margin, or the lock will release before the operation can complete") and a runtime `logger.warn` if the computed operation timeout is suspiciously small (< 1000ms), so a future misconfiguration surfaces in logs immediately instead of as a silent race.
2. **Follow-up (can land in Phase 1) — stop trusting an outraced operation's side effects.** Where the wrapped callback does more than one write (e.g. reveal/endTurn also call `notifyGameMutation`), treat a lock-timeout as fatal for that room: invalidate any in-process cache for the room and force a `room:resync`-equivalent broadcast, rather than leaving clients to converge only on their next natural resync. True cancellation (an `AbortSignal` threaded into the Redis command layer) is the most correct long-term fix but is a larger change — track it as a stretch goal, not a blocker for this phase.

**Touches:**
- `utils/distributedLock.ts`, `utils/timeout.ts` (JSDoc + warn log)
- `services/timerService.ts` (the concrete `lockTimeout` fix)
- `__tests__/utils/distributedLock.test.ts` (new case simulating a slow inner operation)

**Tests:** Mock a Redis call to resolve after a delay that exceeds the *old* `lockTimeout - 500` but not the new one; assert the operation now completes and the lock isn't released until it does. Add a second test that deliberately keeps a lock timeout too small and asserts the new warn-log fires (guards against this regressing silently again).

**Risk:** Widening a lock's timeout window means a genuinely stuck operation holds the lock longer before another caller can retry — acceptable, since the alternative (releasing early) is the actual bug.

**Shipped as:** `timerService.startTimer`'s `lockTimeout` is now `TIMEOUTS.TIMER_OPERATION * 2 + 1000` (derived from the config constant, not a hardcoded number) — the `* 2` covers `stopTimer`'s inner `redis.del` plus `startTimer`'s own `redis.set`, both budgeted at `TIMEOUTS.TIMER_OPERATION`, so it stays correct if that env var is ever reconfigured. The diagnostic isn't a static "`operationTimeout < 1000ms`" check as originally sketched — `MIN_LOCK_TIMEOUT`'s existing floor means that condition can structurally never fire. Instead, `withLock` now catches the specific `OPERATION_TIMEOUT` error and logs a `logger.warn` naming the lock key and both timeout values *only when the hazard actually happens* — a more useful, always-correct signal.

---

### P0-4 — Serialize the disconnect and reconnect writes to a player's `connected` flag — ✅ Shipped

**Severity:** Critical · **Area:** Concurrency

**Root cause:** `handleDisconnect` (`services/player/cleanup.ts:60`) and the `room:reconnect` handler (`socket/handlers/roomHandlers/roomReconnectionHandlers.ts:97–100`) both call the atomic-per-call `updatePlayer`, but nothing serializes the two calls *against each other* — the existing `player-mutation:<sessionId>` lock (already used for team/role changes) is acquired by neither. The one existing guard, `getSocketId(sessionId) !== socket.id` in `disconnectHandler.ts`, is checked once *before* the async disconnect work starts — it protects "reconnect already happened before disconnect began," not "reconnect and disconnect happen concurrently," which is the common case for a page refresh or brief network blip. If the stale `connected:false` write lands last, the player shows disconnected while fully back in the game, and ten minutes later the scheduled cleanup sweep reads that stale flag and actually removes them from the room.

**Fix:**
1. Wrap both writes — the disconnect path's `updatePlayer(sessionId, {connected:false, disconnectedAt})` and the reconnect path's `updatePlayer(socket.sessionId, {connected:true, lastSeen})` — in the existing `player-mutation:<sessionId>` lock.
2. Re-check `getSocketId(sessionId) === socket.id` a second time *inside the lock*, immediately before the disconnect path's write, so a disconnect that lost the race to a fresher reconnect no-ops instead of clobbering the newer state.

**Touches:**
- `services/player/cleanup.ts`
- `socket/handlers/roomHandlers/roomReconnectionHandlers.ts`
- `socket/disconnectHandler.ts` (the re-check placement)
- `__tests__/services/player/cleanup.test.ts`, `__tests__/handlers/roomReconnectionHandlers.test.ts`

**Tests:** Construct a deferred-promise race where `room:reconnect`'s write resolves first inside the lock, then the disconnect path attempts its write — assert the disconnect write no-ops (player ends up `connected: true`). Run the same test with the ordering reversed to confirm the normal disconnect-then-reconnect case still works. Confirm the scheduled cleanup sweep no longer evicts a player who reconnected during the race window.

**Risk:** Low — this only adds serialization around two writes that were already individually atomic; no behavior changes for the non-racing case.

**Shipped as:** `handleDisconnect` (`services/player/cleanup.ts`) now takes an optional `expectedSocketId` param and returns `null` when the write was skipped as stale (instead of a new `cleanup.test.ts` file, tests landed in the existing `__tests__/services/playerService.test.ts`, which already covers this barrel-re-exported function). `disconnectHandler.ts` was extended beyond the original scope: it now actually *uses* `handleDisconnect`'s return value and bails out of every remaining disconnect side effect (room broadcast, host transfer) when stale — previously it ignored the return value entirely, so even a race-proof write alone wouldn't have stopped the disconnect handler from wrongly announcing a still-connected player as disconnected and transferring host away from them. Test files touched: `__tests__/services/playerService.test.ts` (new race-scenario cases), `__tests__/handlers/disconnectHandler.test.ts` (default mock had to change from resolving `undefined` to a truthy player, since the new bail-out logic treats a falsy return as "stale"), `__tests__/handlers/roomHandlersUnit.test.ts` and `__tests__/handlers/roomResync.test.ts` (added a `distributedLock` mock, since `room:reconnect` touches it for the first time; also added a lock-key assertion).

---

### P0-5 — Scope advisor-bot suggestions to the acting team only — ✅ Shipped

**Severity:** Medium (bundled into Phase 0 because it's a one-line, zero-risk fix touching the same information-leakage class as P0-1) · **Area:** Game integrity

**Root cause:** `emitAdvisorSuggestions` (`bots/botController.ts:301`) broadcasts `game:botSuggestion` via `safeEmitToRoom`, which delivers to every socket in the room — including the opposing team's spymaster/clicker and spectators — letting them preview which cards the acting team's advisor considers top picks for a clue that's still live.

**Fix:** Change the emission to target only the acting team's connected members (`safeEmitToPlayers`/`safeEmitToGroup` filtered by `team`), reusing the same team-membership lookup already used elsewhere in `gameHandlers.ts`.

**Touches:** `bots/botController.ts`

**Tests:** Assert the emission's recipient list excludes the opposing team's session IDs and any spectators.

**Risk:** None — this only narrows an existing broadcast's audience.

**Shipped as:** used `safeEmitToPlayers(io, members, ...)` — `members` was already the acting team's own roster (`playerService.getTeamMembers(roomCode, team)`, fetched earlier in `tickRoom` for an unrelated reason), so no new lookup was needed; the bug was purely in the emission function choice (`safeEmitToRoom`, room-wide), not in what data was available. Test in `__tests__/bots/botController.test.ts` asserts the exact `members` array was passed as the target and that `safeEmitToRoom` was never called with this event.

---

## Phase 1 — Harden the single-instance production path (next sprint)

These are reachable in the currently-deployed single-instance topology (self-hosted Docker, or Fly.io's own shipped default), just less deterministically than Phase 0.

**Sequencing note:** land **P1-9 (real-Redis Lua test harness) first**, ahead of the other Lua-touching items in this phase (P1-4, P1-8) and ideally right after Phase 0 lands — Phase 0's own P0-2 is a Lua change that deserves real execution coverage from day one rather than retrofitted later.

### P1-1 — Gate Express's `trust proxy` on verified topology, not `NODE_ENV`

**Severity:** High · **Area:** Auth / network trust

**Root cause:** `app.ts:83–88` calls `app.set('trust proxy', 1)` whenever `NODE_ENV === 'production'`, which says nothing about whether a real reverse proxy actually sits in front of the process. `middleware/auth/clientIP.ts` already solves this correctly for the Socket.io path — it requires explicit `TRUST_PROXY=true` or an auto-detected Fly/Heroku marker before trusting `X-Forwarded-For`, with a comment explaining exactly why an untrusted proxy setting lets a client spoof its own source IP.

**Fix:** Extract the existing detection logic from `clientIP.ts` into a shared, exported helper (e.g. `shouldTrustProxy()` in `config/env.ts`), and call it from **both** the Express `app.set('trust proxy', …)` line and the Socket.io resolver, so there's one source of truth instead of two independently-reasoned checks that have already drifted apart once.

**Touches:** `app.ts`, `middleware/auth/clientIP.ts`, `config/env.ts`

**Tests:** Trust-proxy must be OFF when `NODE_ENV=production` with no `TRUST_PROXY` set and no platform marker present; ON when `TRUST_PROXY=true` or a Fly/Heroku marker is present — assert both the Express setting and the socket resolver agree in all four combinations.

**Risk:** Behavior change for any self-hosted production deployment that was relying on the old (incorrect) auto-trust — those deployments must now set `TRUST_PROXY=true` explicitly if they do sit behind a real proxy. Call this out in the release notes / `docs/DEPLOYMENT.md`.

---

### P1-2 — Give Redis reconnection a self-heal path; make `/health/live` a real check

**Severity:** High · **Area:** Backend resilience

**Root cause:** `config/redis.ts:206–217`'s `reconnectStrategy` permanently stops retrying after 20 attempts, and nothing calls `connectRedis()` again afterward. `/health/live` (`routes/healthRoutes.ts:150–160`) is a static "live" response with no dependency check, and the only configured Fly check (`/health/ready`) affects routing, not restarts. A sustained outage past the backoff window leaves the process alive, pulled from rotation, and never self-healing even after Redis recovers.

**Fix:** On terminal reconnect failure, call `process.exit(1)` rather than just logging — this leverages the platform's existing "always restart a crashed process" behavior (Fly Machines, Docker restart policies, k8s) instead of building bespoke in-process retry logic that could leave the client in a half-reconnected state. Separately, make `/health/live` actually check `isRedisHealthy()` and return a non-200 status when unhealthy, since the codebase also documents Docker/K8s deployment paths where a real liveness probe (not just Fly's routing check) is the mechanism that triggers a restart.

**Touches:** `config/redis.ts`, `routes/healthRoutes.ts`

**Tests:** Simulate exhausting the reconnect budget and assert `process.exit(1)` is invoked (mock `process.exit`). Assert `/health/live` returns a failing status when `isRedisHealthy()` is false.

**Risk:** Exiting on terminal Redis failure means a very long-lived process now cycles instead of staying alive-but-degraded — confirm this is the desired tradeoff for every deployment target in `docs/DEPLOYMENT.md` (it is for Fly/Docker/k8s; call it out explicitly for any bare-metal/systemd deployment too).

---

### P1-3 — Fix embedded-Redis shutdown ordering so the child process can't be orphaned

**Severity:** High · **Area:** Backend resilience

**Root cause:** `cleanupPartialConnections()` wraps each client `quit()` in its own 3s timeout; `disconnectRedis()` — the path actually used during graceful shutdown — does not, and only calls `stopEmbeddedRedis()` after all `quit()` calls resolve. `index.ts` separately races the whole call against a fixed 3s timer and calls `process.exit(0)` regardless. If any single `quit()` hangs, `stopEmbeddedRedis()` is never reached, and the spawned (non-detached) `redis-server` child survives the Node process's exit as an orphan — directly relevant since `fly.toml`'s own shipped default runs in embedded/memory mode.

**Fix:** Apply the same per-call timeout `cleanupPartialConnections()` already uses to every `quit()`/`disconnect()` call inside `disconnectRedis()`, and move `stopEmbeddedRedis()` into a `finally` block so it always runs regardless of whether the `quit()` calls succeeded or timed out.

**Touches:** `config/redis.ts`

**Tests:** Mock a client whose `quit()` never resolves; assert `stopEmbeddedRedis()` is still called within the expected shutdown window.

**Risk:** None — this only tightens an existing cleanup path.

---

### P1-4 — Roll back match-round score on `game:abandon`

**Severity:** Medium-High · **Area:** Game integrity

**Root cause:** Match-mode card points accrue live on every reveal, independent of round completion. `abandonGame`'s own docstring implies a scoreless do-over ("does not add history entries"), but it never resets `redMatchScore`/`blueMatchScore`, and `startNextRound`'s carry-over reads those same fields straight through — so a host can abandon a round right after their team picks up high-value cards and keep the edge permanently.

**Fix:** Snapshot `redMatchScore`/`blueMatchScore` into a new field (e.g. `game.roundStartMatchScore`) when a round starts (`startNextRound` / round initialization); in `abandonGame`, roll both scores back to that snapshot before setting `gameOver = true`. For games persisted before this field existed, fall back to a no-op rollback (documented, not a crash).

**Touches:** `services/gameService.ts` (`abandonGame`, `startNextRound`), `types/game.ts` (new field), `services/player/schemas.ts`-equivalent for `GameState` if it's schema-validated on read

**Tests:** Reveal several cards accruing match score, call `game:abandon`, assert scores are back at the round's starting value and the next round begins from that rolled-back baseline.

**Risk:** Requires a product decision on the *intended* semantics (should abandon really be fully scoreless, or should it optionally still bank a partial "gave up" penalty?) — confirm the "fully scoreless" interpretation is correct before implementing; if not, adjust the target rollback value accordingly rather than assuming.

---

### P1-5 — Rate-limit `game:abandon`/`game:clearHistory`; make the failed-join limiter actually block

**Severity:** Medium · **Area:** Backend resilience / DoS

**Root cause:** `getLimiter()` (`middleware/rateLimit.ts`) silently no-ops for any event missing from `config/rateLimits.ts`'s map — and `game:abandon`/`game:clearHistory` are missing, despite being host-only, Redis-write-and-broadcast events with `game:forfeit`-style siblings that *are* rate-limited (`'game:forfeit': { window: 10000, max: 2 }`). Separately, `trackFailedJoinAttempt` (`socket/handlers/roomHandlerUtils.ts:59–79`) — configured specifically to prevent room-code enumeration — records the attempt against its own limiter but its wrapping `Promise` always resolves regardless of whether the limiter signals a block, so it never actually throttles anything.

**Fix:** Add `'game:abandon'` and `'game:clearHistory'` entries to `config/rateLimits.ts`, matching `game:forfeit`'s ceiling. Change `trackFailedJoinAttempt` so that when the limiter's callback receives an `err`, the function actually rejects (throwing a `RateLimitError` that the caller in `roomMembershipHandlers.ts` propagates) instead of always resolving successfully.

**Touches:** `config/rateLimits.ts`, `socket/handlers/roomHandlerUtils.ts`

**Tests:** Assert `game:abandon`/`game:clearHistory` are throttled past their new limit. Assert repeated failed `room:join` attempts eventually reject with `RATE_LIMITED` instead of always reaching the original `ROOM_NOT_FOUND`/`INVALID_INPUT` error.

**Risk:** None — purely additive throttling.

---

### P1-6 — Auto-recover (or forfeit) a bot seat that exceeds its retry ceiling

**Severity:** High · **Area:** Bot subsystem

**Root cause:** `tickRoom` (`bots/botController.ts:167, 188–207, 449–454`) re-arms a failed bot action with backoff, but past `MAX_REARM_ATTEMPTS` (6) it only logs server-side and stops. Ticking is driven entirely by game mutations, and it's the stalled bot's own turn, so no other player can produce a mutation to unstick it. The only external rescue — a turn timer — is off by default unless the host explicitly enables it, so a deterministic strategy failure in a timer-less room silently bricks the game behind a turn indicator that never advances.

**Fix:** On giving up, auto-end the stuck seat's turn (call the existing `endTurn` path for that room/team) and broadcast a room-visible warning event (e.g. a `bot:error`-style event, or piggyback on the existing room warning channel), rather than a server-side-only log. Confirm `failureStreak` is reset the next time a bot successfully acts (should already happen naturally — add a test to lock in the assumption).

**Touches:** `bots/botController.ts`

**Tests:** Simulate 6 consecutive action failures for a bot seat and assert the turn is forced to end and a warning is broadcast to the room, instead of the game silently stalling.

**Risk:** Auto-ending the turn is a product-visible behavior change (previously: silent freeze; after: the team loses their turn) — confirm this is preferable to, say, forfeiting only that team's current turn vs. the whole game before shipping.

---

### P1-7 — Close the bot-seat / human-reconnect race

**Severity:** High · **Area:** Bot subsystem

**Root cause:** `addBotLocked`'s occupancy guard (`services/botService.ts:64–68`) only excludes *connected* occupants of a seat — a human merely disconnected (kept for the 10-minute grace window, per `services/player/cleanup.ts`) doesn't block a bot from taking their team+role. When that human reconnects, the handler restores their record verbatim with no re-check of whether the seat is still theirs, so a bot and a reconnected human can simultaneously hold the same seat and race each other's reveals.

**Fix:** On reconnect, re-check whether the player's stored team+role is currently held by a *connected bot*. If so, prefer the human — evict/remove the bot from that seat automatically, mirroring the existing "host transfer prefers humans" precedent (a bot can't run host-only functions, so it's already established product policy that a human reconnecting should reclaim precedence over a bot standing in). Surface a room-visible notice ("a bot was covering your seat while you were away") rather than silently swapping.

**Touches:** `socket/handlers/roomHandlers/roomReconnectionHandlers.ts`, `services/botService.ts`

**Tests:** Human disconnects; bot is added to their now-unoccupied-looking seat within the grace window; human reconnects — assert the bot is removed from the seat and the human's reveal/clue actions are accepted without a race against a still-acting bot.

**Risk:** This is a product decision as much as a bug fix — confirm "human reclaims the seat automatically" is the desired UX (vs., say, blocking the reconnect into that seat and demoting to spectator) before implementing.

---

### P1-8 — Validate bot-originated clues with the same bounds as human clues

**Severity:** Medium-High · **Area:** Bot subsystem

**Root cause:** Humans get `gameClueSchema`'s bounds (word ≤ `CLUE_WORD_MAX_LENGTH`, single token, number ≤ `CLUE_NUMBER_MAX`) at the socket boundary via Zod, but `gameService.submitClue` itself never re-checks them, and `scripts/submitClue.lua:20–21` only nil-guards the number to `≥ 0` with no upper cap. Bots call `submitClue` directly, skipping the Zod layer entirely. This is reachable through the documented custom-semantic-map pipeline (`bots/semantics/mapBackend.ts:78–90`): the map-file shape validator checks types but not string length/whitespace on candidate clue words, so a hand-edited or non-standard map file could produce a bot clue that violates an invariant every other consumer (display, replay) assumes holds.

**Fix:** Extract the length/whitespace/number-range checks currently living only in `gameClueSchema` into a small shared validator (e.g. `validateClueShape(word, number)` in `shared/gameRules.ts`), and call it from **both** the Zod schema and `gameService.submitClue` before it ever reaches the Lua script — so bot-originated clues get the same defense-in-depth as human ones from one source of truth. Add the same upper-bound guard to `submitClue.lua`'s number handling for full parity with this codebase's existing Lua nil-guard convention.

**Touches:** `shared/gameRules.ts`, `validators/gameSchemas.ts`, `services/gameService.ts`, `scripts/submitClue.lua`

**Tests:** Bot path: attempt to submit a clue via `gameService.submitClue` directly (bypassing Zod) with an over-length/multi-word/out-of-range value — assert rejection. Human path: confirm existing Zod-level tests are unaffected.

**Risk:** None functionally — this only closes a gap that was already supposed to be closed at one layer.

---

### P1-9 — Stand up a real-Redis Lua test harness; promote a blocking E2E slice

**Severity:** High · **Area:** Testing / CI

**Root cause:** Every backend test uses a fully mocked Redis client whose `eval`/`evalSha` are hard-stubbed to return `null` (`__tests__/helpers/mocks.ts:263–264`); the dedicated Lua test files (`__tests__/scripts/luaScriptLogic.test.ts`) assert on the script's *source text*, not its behavior. The only place these scripts run against a real embedded Redis is the Playwright E2E suite, and `.github/workflows/ci.yml` marks that job `continue-on-error: true`, excluded from the `ci-passed` gate. A broken atomic script can pass lint, typecheck, and all 4,167 tests and merge to main.

**Fix:** Add a new integration test suite (e.g. `__tests__/integration/luaScripts.test.ts`) that boots the same embedded/memory-mode Redis already used for local dev (`config/memoryMode.ts`, the pattern already documented in `docs/TESTING_GUIDE.md`'s "Testing with Real Redis" section), loads and `EVAL`s the highest-risk scripts directly — `revealCard`, `endTurn`, `submitClue`, `hostTransfer`, `safeTeamSwitch`, `setRole`, `atomicJoin` — with representative `KEYS`/`ARGV`, and asserts on the real returned/mutated state. Make this part of the standard backend Jest project (subject to the existing coverage thresholds and the blocking `npm test` gate), not a separate job. Separately, change `.github/workflows/ci.yml` so at least a small, fast E2E slice (basic room create/join/reveal) is blocking — add it to the `ci-passed` job's `needs` list — while the full/slower E2E suite can stay `continue-on-error` if flakiness is a real concern.

**Touches:** new `__tests__/integration/luaScripts.test.ts`, `jest.config.ts.js` (if a new project/pattern is needed), `.github/workflows/ci.yml`

**Tests:** This item *is* the test infrastructure — its own acceptance criteria are "the seven scripts above are exercised against real Redis and a deliberately broken script (e.g. a wrong `KEYS`/`ARGV` index) fails the suite."

**Risk:** Slower CI (real Redis start/stop per suite run) — mitigate by reusing a single embedded-Redis instance across the new suite's tests rather than spinning one up per test.

---

### P1-10 — Redact `errorHandler`'s known-error-code branch the same way its fallback branch does

**Severity:** Medium · **Area:** Backend resilience

**Root cause:** `middleware/errorHandler.ts`'s fallback (unknown-error) branch correctly applies `isProduction() ? 'Internal server error' : err.message`. The known-error-code branch — which includes `SERVER_ERROR` — returns `err.message` verbatim regardless of environment; only `.details` goes through the documented allowlist. Not currently reachable from any HTTP route today, but it's exactly the class of internal detail the rest of the app deliberately strips in production (see `parseJSON.ts`'s Zod field-path stripping), and a future code path could silently bypass it.

**Fix:** Apply the same production-gated redaction to the known-error-code branch.

**Touches:** `middleware/errorHandler.ts`

**Tests:** Assert a `ServerError` with a detailed message returns the generic string in production and the real message in development, matching the fallback branch's existing test coverage.

**Risk:** None.

---

### P1-11 — i18n and bot-advisor bug bundle

**Severity:** Medium (i18n), Low (advisor bug) · **Area:** Frontend / bots

Small, independent, low-risk fixes bundled because none needs its own PR:

- **Neutral-card announcement:** `frontend/board.ts:521` and `frontend/game/reveal.ts:169` call `t('board.neutralCard')`, which doesn't exist in any locale file — the real key is `rules.neutralCard`. Every screen-reader user hears the literal string "board.neutralCard" instead of "Neutral" on the single most common card type, in all four languages. **Fix:** point both call sites at `rules.neutralCard`.
- **Settings-modal labels:** `public/index.html:1008,1019` use `data-i18n="game.dangerZone"`/`"game.forfeitGame"`, which don't exist — the real keys are `settings.dangerZone`/`settings.forfeitGame`. English is unaffected (fallback text happens to be correct); German/Spanish/French show two stray English strings. **Fix:** correct the two `data-i18n` attributes.
- **Duet blue-side advisor bug:** `bots/botController.ts:292–294` computes the advisor's "own cards remaining" from `game.types` unconditionally, but in Duet mode blue's own greens live only in `duetTypes` — so blue-side `ownRemaining` is always 0, tripping the late-stretch warning from turn one. **Fix:** mirror the duet+blue branch already used in `bots/playOneAction.ts:34` for the advisor's own board view.

**Touches:** `frontend/board.ts`, `frontend/game/reveal.ts`, `public/index.html`, `bots/botController.ts`

**Tests:** Locale-key regression test asserting every `t()` call site used by a screen-reader announcement resolves to a real key in all four locale files (this also guards against the same class of bug recurring). E2E or unit check that the two settings labels translate in a non-English locale. Bot test asserting a blue-side Duet advisor's `ownRemaining` count matches `duetTypes`, not `types`.

**Risk:** None.

---

### P1-12 — Remove (or fix) the unsafe, unused `escapeHTML()` helper

**Severity:** Medium · **Area:** Frontend

**Root cause:** `frontend/utils.ts:35–39`'s `escapeHTML()` escapes `&`/`<`/`>` via a `textContent` round-trip but not quote characters — quotes have no special meaning in text content, so this doesn't escape them. Project docs describe it as safe for "trusted templates" via `innerHTML`, but interpolating it into an HTML attribute would let a value containing `" onmouseover="…` break out. It is called nowhere in the frontend today (confirmed by grep) — the app already uses the DOM-methods pattern (`textContent`/`createElement`) everywhere — so nothing is exploitable yet, but it's a footgun sitting exactly where the docs point a future contributor.

**Fix:** Delete it, since it has zero current call sites and the app doesn't need an innerHTML-safe escaper anywhere. (If a future need for attribute-safe escaping arises, add a correctly-scoped helper then, rather than resurrecting this one.)

**Touches:** `frontend/utils.ts`. `CLAUDE.md`'s two "No innerHTML for user content" bullets already flag this function's limitation and point here (see Doc hygiene below) — once this item ships, simplify those bullets to drop the caveat entirely along with the dead code.

**Tests:** None needed beyond confirming the build still passes with the export removed (typecheck will catch any missed reference).

**Risk:** None.

---

### P1-13 — E2E coverage for spectator approval, bot lifecycle, and match-round transitions

**Severity:** High · **Area:** Testing

**Root cause:** Searching all 13 Playwright specs for bot lifecycle or spectator-approval events returns nothing; reconnection gets exactly one shallow test. Combined with P1-9, the three multiplayer flows most likely to hide subtle state-machine bugs — bot seat serialization, spectator join/approve/deny, match-mode round transitions — are only ever exercised against a fully mocked Redis, never end-to-end against a real server and real sockets.

**Fix:** Add three minimal, host-driven E2E specs:
1. Host adds a bot to each seat type (spymaster/clicker/advisor) and it takes its first action.
2. A spectator requests to join a team; host approves one and denies another.
3. A `match`-mode game plays through a full round to `game:roundEnded`, then `game:nextRound` to a second round, then to `game:matchOver`.

**Touches:** `server/e2e/` (new spec files, following existing conventions)

**Tests:** These specs are the deliverable.

**Risk:** New E2E specs add to CI wall-clock time — keep them minimal (one happy path each, not exhaustive edge-case coverage) since P1-9 already promotes a slice of E2E into the blocking gate and shouldn't become a bottleneck.

---

## Phase 2 — Multi-instance readiness (before scaling out)

None of these matter until the app actually runs more than one instance behind a load balancer — which `fly.toml`'s own comment says isn't the case today ("keep exactly 1 machine"). Do this phase before that changes, not after.

### P2-1 — Back socket-level rate limiting with Redis

**Severity:** High · **Area:** Backend resilience / DoS

**Root cause:** `createSocketRateLimiter` (`middleware/rateLimit.ts:120–248`, wired to every game/room/chat event via `socket/rateLimitHandler.ts:48`) is built entirely from local `Map`s, despite `CLAUDE.md` describing WebSocket rate limiting as "Redis-backed." The only real consumer of the existing `ATOMIC_RATE_LIMIT_SCRIPT` is session validation. Across N instances, an attacker gets roughly N× the intended per-socket/per-IP/per-session budget, since each instance counts independently.

**Fix:** Back the socket limiter with the existing atomic rate-limit script for at least the security-sensitive events (`room:create`, `room:join`, `game:reveal`), keeping an in-memory L1 fast-path if needed to control added latency, but making the Redis check authoritative across instances.

**Touches:** `middleware/rateLimit.ts`, `socket/rateLimitHandler.ts`

**Tests:** Two simulated "instances" (two limiter instances backed by the same Redis) must together enforce one shared budget for a given session/IP, not two independent ones.

**Risk:** Added Redis round-trip latency per rate-limited event — benchmark against the load-test scripts in `server/loadtest/` before shipping.

---

### P2-2 — Make turn-timer pause/resume/stop/add-time correct across instances

**Severity:** High · **Area:** Concurrency

**Root cause:** Timer expiry is driven by a real `setTimeout` that exists only in the process that created it (`services/timerService.ts`'s `localTimers` map); Redis just records state. `pauseTimer`/`resumeTimer`/`stopTimer`/`addTimeLocal` only cancel or reschedule the JS timeout when it's in their *own* process's map, and report success regardless. In a horizontally-scaled deployment, a pause request landing on a different instance than the one that started the timer updates Redis while the original timeout keeps counting down, fires, and ends the turn anyway.

**Fix:** Make expiry Redis-authoritative — immediately before acting on a fired timeout, re-read the timer's live Redis state (`paused`, `endTime`, a monotonic version/epoch counter) and no-op if it's stale or paused. This is more tractable than the alternative (routing every timer event to the one instance that owns the local timer, which needs a room→instance affinity map and inter-instance forwarding) and fits the existing pattern already used elsewhere in this codebase (Lua-level guards re-validating state atomically rather than trusting a caller's cached view).

**Touches:** `services/timerService.ts`

**Tests:** Simulate two "instances" sharing Redis; start a timer on instance A, pause it via instance B, and assert the timeout that fires on instance A (if it still fires at all) is a no-op against the paused state rather than ending the turn.

**Risk:** Depends on P0-3's lock-timeout audit already being correct in `timerService` — do P0-3 first so this isn't built on top of the same budget bug.

---

### P2-3 — Redis-back the bot controller's coordination state and the connection tracker

**Severity:** High · **Area:** Bot subsystem / DoS

**Root cause:** `botController.ts`'s `inFlight`/`pending` per-room guard and `connectionTracker.ts`'s `connectionsPerIP`/`authFailuresPerIP` counters are all plain in-process `Map`s/`Set`s. Across instances, two humans in the same room landing on different instances can have each instance's bot controller independently believe it's not in-flight for that room (wasted computation, possible divergent action), and an attacker split across instances gets the per-IP connection cap and auth-failure lockout multiplied by instance count.

**Fix:** Move the bot controller's `inFlight` guard onto the existing `distributedLock.ts` pattern (`lock:bot-tick:{roomCode}`) — leave `clueMemory` as-is, since it's already documented as a best-effort tie-breaker, not authoritative state. Move `connectionTracker.ts`'s two security-relevant counters to Redis `INCR`+`EXPIRE`, mirroring `scripts/atomicRateLimit.lua`'s existing pattern.

**Touches:** `bots/botController.ts`, `socket/connectionTracker.ts`

**Tests:** Same shared-Redis multi-"instance" simulation pattern as P2-1/P2-2 — assert the guard/counter is shared, not per-instance.

**Risk:** None beyond the added Redis round-trips — same latency consideration as P2-1.

---

### P2-4 — Redis Cluster compatibility for Lua scripts with undeclared keys

**Severity:** Medium · **Area:** Concurrency

**Root cause:** `scripts/atomicJoin.lua`, `atomicRemovePlayer.lua`, `atomicCleanupDisconnectedPlayer.lua`, `safeCleanupOrphans.lua`, `setRole.lua`, and `safeTeamSwitch.lua` all build Redis keys via string concatenation inside the script instead of declaring them in `KEYS[]`. Not a live bug today (`config/redis.ts` uses a single-node client, not `createCluster`), but any of these scripts would fail immediately against a real Redis Cluster.

**Fix:** Deferred unless Redis Cluster becomes an actual near-term deployment target. If/when it is: hash-tag every per-room key (`room:{roomCode}:game` style) so co-located keys share a slot, and pass every key each script touches through `KEYS[]`. Until then, this is now documented as a single-node-only assumption (see Doc hygiene below) so it doesn't surprise anyone.

**Touches:** the six scripts listed above, if/when undertaken

**Tests:** N/A until scheduled — this phase item is "keep documented, don't build yet."

**Risk:** N/A — explicitly deferred.

---

### P2-5 — Guard against `fly.toml`'s autoscaler silently starting a second machine

**Severity:** Medium · **Area:** Ops / deployment

**Root cause:** `fly.toml`'s own top comment warns that rooms only exist on one machine and to run `fly scale count 1` — but the file ships `REDIS_URL=memory` + `MEMORY_MODE_ALLOW_FLY=true` with no explicit machine-count cap, while `auto_start_machines=true` plus the concurrency soft/hard limits (`http_service.concurrency`) are exactly the levers Fly's autoscaler uses to justify starting a second machine under load.

**Fix:** Either add an explicit machine-count ceiling to the Fly config (verify current Fly.io config surface supports this directly), or add a pre/post-deploy assertion in `.github/workflows/deploy.yml` that checks the running machine count for the memory-mode app and fails the deploy if it's ever above 1. Longer-term (tracked in the feature roadmap, not this plan): provisioning real Redis as the shipped default removes the constraint entirely.

**Touches:** `fly.toml` and/or `.github/workflows/deploy.yml`

**Tests:** A deploy-time check (not a Jest test) — verify it actually fails a simulated multi-machine state before relying on it.

**Risk:** None — this only adds a guard rail.

---

## Phase 3 — Quality, hygiene, and dependency upkeep

### P3-1 — Decompose `gameService.ts`

**Severity:** Low · **Area:** Code quality

**Root cause:** At 844 lines, `gameService.ts` is the largest source file in the repo and the one major service `CLAUDE.md` doesn't already flag for sub-module decomposition (`game/`, `gameHistory/`, `player/`, and `room/` all already have `<service>/` sub-directories per the existing convention).

**Fix:** Split `finalizeRound`/`finalizeMatchRound`/`startNextRound` into a new `services/game/matchRounds.ts`, consistent with the existing `game/` split (`boardGenerator.ts`, `revealEngine.ts`, `luaGameOps.ts`). Pure refactor, no behavior change.

**Touches:** `services/gameService.ts`, new `services/game/matchRounds.ts`

**Tests:** No new tests — rely on the existing suite (strengthened by P1-9's real-Redis Lua coverage) to confirm zero behavior change.

**Risk:** Low, but do this *after* P1-4 (match-abandon score rollback) lands, so the refactor moves settled logic rather than a moving target.

---

### P3-2 — Add a field allowlist to `updatePlayer.lua`

**Severity:** Low · **Area:** Auth / defense in depth

**Root cause:** Unlike `setRole.lua`/`safeTeamSwitch.lua`, which validate the new value against an explicit allowed-values table, `updatePlayer.lua:32–38` merges every key from the caller's JSON object straight into the stored player record, including `isHost`/`role`. Every current call site passes a hardcoded literal, so this isn't reachable today, but it's a fragile pattern with no Lua-layer defense if a future refactor ever forwards a validated-but-not-allowlisted object.

**Fix:** Add an explicit allowlist of mergeable fields inside the script, matching the pattern already used two scripts over.

**Touches:** `scripts/updatePlayer.lua`

**Tests:** Assert a call attempting to merge a field outside the allowlist (e.g. `isHost`) is rejected even if the calling TypeScript were ever compromised/misused.

**Risk:** None — purely additive restriction; verify all current call sites' fields are on the allowlist before shipping.

---

### P3-3 — Trim `release.yml`'s unused `pull-requests: write` permission

**Severity:** Low · **Area:** CI/CD

**Root cause:** `.github/workflows/release.yml:20–21` declares `pull-requests: write`, but the job only bumps `package.json`, pushes a commit+tag directly to `main`, and creates a GitHub Release — no step touches pull requests.

**Fix:** Drop the unused permission.

**Touches:** `.github/workflows/release.yml`

**Tests:** N/A — CI config change; verify the release workflow still succeeds on the next run.

**Risk:** None.

---

### P3-4 — Dependency upkeep

**Severity:** Low · **Area:** Dependencies

**Root cause:** `npm outdated` shows minor/patch bumps available for `@anthropic-ai/sdk`, `@types/node`, `@typescript-eslint/*`, and `prettier` — all low-risk. Separately, `redis` (the Node client) has a major version available (5.x → 6.x) which is a larger, potentially breaking change given how deeply the Lua-script wrapper layer depends on the client's command API.

**Fix:** Bump the minor/patch dependencies in a routine PR. Track the `redis` 5→6 major upgrade as its own separate, scheduled piece of work — evaluate the changelog for breaking changes to `eval`/`evalSha`/multi/pipeline APIs before attempting it, and land it only with the real-Redis Lua test harness (P1-9) already in place so a client-library regression would actually be caught.

**Touches:** `package.json`, `package-lock.json`

**Tests:** Full existing suite must stay green after the minor bump; the major `redis` bump needs its own dedicated test pass once P1-9 exists.

**Risk:** Low for the minor bumps; the major `redis` bump is the one item in this entire plan explicitly gated on another item (P1-9) being done first.

---

## Doc hygiene (done this pass)

These were pure documentation corrections — no code behavior changed. Listed here for completeness since they were findings from the same review.

- [x] `CLAUDE.md` — corrected test-suite counts (167 total / 112 backend / 55 frontend, was 160/105), `accessibility.css` line count (472, was 453), the WebSocket rate-limiting description (was inaccurately described as Redis-backed), the `timerService` description (now notes single-instance scope pending P2-2), added a **Known Issues (Tracked)** section pointing here, added this document to the Documentation Index.
- [x] `server/.env.example` — corrected the `ADMIN_PASSWORD`-unset description (the real behavior is a 401 on every admin request, not "no authentication required" as previously stated — the actual behavior is the safe one, the doc had it backwards).
- [x] `SECURITY.md` — corrected the same WebSocket rate-limiting claim; added a **Known Limitations** section pointing here.
- [x] `docs/DEPLOYMENT.md` — added a note under "Multi-Instance Scaling" that Redis + sticky sessions alone is not sufficient today; the concrete in-memory state that doesn't share across instances is tracked in Phase 2 above.
- [x] `fly.toml` — added a comment clarifying that `auto_start_machines` + the concurrency limits can start a second machine despite `min_machines_running = 1` (a minimum, not a maximum), with no automated guard today (P2-5).
- [x] `docs/BACKUP_AND_DR.md` — noted that the documented backup sequence is manual today; automation is a feature-roadmap item, not a hardening-plan item (see the separate feature proposal).
- [x] `docs/TESTING_GUIDE.md` — added a callout on the "Testing with Real Redis" section noting that this pattern is not currently applied to the 29 Lua scripts, cross-referencing P1-9.

---

## Cross-reference: finding → phase

| Finding | Severity | Phase | ID | Status |
|---|---|---|---|---|
| Spymaster can switch to clicker mid-game | Critical | 0 | P0-1 | ✅ Shipped |
| Reveal accepted with no active clue | Critical | 0 | P0-2 | ✅ Shipped |
| Lock timeout shorter than wrapped operation | Critical | 0 | P0-3 | ✅ Shipped |
| Disconnect/reconnect race on `connected` flag | Critical | 0 | P0-4 | ✅ Shipped |
| Advisor suggestions broadcast room-wide | Medium | 0 | P0-5 | ✅ Shipped |
| `trust proxy` gated on `NODE_ENV` alone | High | 1 | P1-1 | Planned |
| Redis reconnect has no self-heal; `/health/live` is a no-op | High | 1 | P1-2 | Planned |
| Embedded Redis can be orphaned on shutdown | High | 1 | P1-3 | Planned |
| Match abandon keeps banked score | Medium-High | 1 | P1-4 | Planned |
| No rate limit on abandon/clearHistory; dead anti-enum limiter | Medium | 1 | P1-5 | Planned |
| Stalled bot freezes the game after 6 retries | High | 1 | P1-6 | Planned |
| Bot can occupy a seat a reconnecting human still owns | High | 1 | P1-7 | Planned |
| Bot-originated clues skip length/format/number bounds | Medium-High | 1 | P1-8 | Planned |
| Lua scripts untested in blocking CI | High | 1 | P1-9 | Planned |
| `errorHandler` known-error branch skips redaction | Medium | 1 | P1-10 | Planned |
| Neutral-card / Settings-modal i18n keys; Duet advisor bug | Medium/Low | 1 | P1-11 | Planned |
| Unsafe unused `escapeHTML()` | Medium | 1 | P1-12 | Planned |
| No E2E for spectator/bot/match-round flows | High | 1 | P1-13 | Planned |
| Socket rate limiting is per-instance in-memory | High | 2 | P2-1 | Planned |
| Turn timer pause/resume/stop wrong across instances | High | 2 | P2-2 | Planned |
| Bot controller + connection tracker state per-instance | High | 2 | P2-3 | Planned |
| Lua scripts incompatible with Redis Cluster | Medium | 2 | P2-4 | Planned |
| `fly.toml` autoscaler could silently violate single-machine rule | Medium | 2 | P2-5 | Planned |
| `gameService.ts` undecomposed | Low | 3 | P3-1 | Planned |
| `updatePlayer.lua` has no field allowlist | Low | 3 | P3-2 | Planned |
| `release.yml` excess permission | Low | 3 | P3-3 | Planned |
| Dependency upkeep | Low | 3 | P3-4 | Planned |
| CLAUDE.md/.env.example/SECURITY.md/DEPLOYMENT.md/fly.toml/BACKUP_AND_DR.md/TESTING_GUIDE.md drift | Low | — | Doc hygiene | ✅ Shipped |

## See also

The same review also produced a set of grounded product/ops/bot feature proposals (custom word-list library, post-game recap, Redis-backed bot coordination state, multilingual bot semantic maps, and others). Those are extensions, not defects, so they aren't tracked in this plan — ask for them to be added as a `docs/FEATURE_ROADMAP.md` if you want them persisted here too.
