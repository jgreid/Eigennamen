# Codebase Review Plan — Third Pass (July 2026)

The third codebase-wide review of Eigennamen. It is **additive to and non-overlapping
with** [HARDENING_PLAN.md](HARDENING_PLAN.md) (the first pass) and
[IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) (the second pass). Every finding below was
grep-checked against both prior ledgers; near-duplicates were dropped, and where this
pass changes the disposition of an already-tracked item, that is recorded in
**§9 Ledger reconciliation** rather than duplicated as a new item.

## How to read this document

- Items are grouped into phases by theme and roughly ordered by severity within each phase.
- Each item carries **Severity · Area**, a **Root cause** with `file:line` evidence, a concrete
  **Fix**, the files it **Touches**, and the **Test** that proves it.
- Statuses use the same convention as the other ledgers: an item is `Planned` until the PR
  that closes it flips its header to **FIXED** with a one-line resolution note. All items here
  start `Planned` unless marked otherwise.
- The single most severe finding is **§1 N1 (session identity)**. Do it first.

## Phase map

| Phase | Theme | Items |
|-------|-------|-------|
| 1 | Exploitable / integrity bugs reachable in normal play | N1–N5 |
| 2 | Data-integrity & correctness (medium) | N6–N11 |
| 3 | Frontend correctness & accessibility | N12–N19 |
| 4 | Bot subsystem | N20–N25 |
| 5 | Test / CI / build / ops signal | N26–N33 |
| 6 | Middleware defense-in-depth & config | N34–N37 |
| 7 | Ledger reconciliation (no code, or re-open) | §9 |

---

## Phase 1 — Exploitable / integrity bugs reachable in normal play

### N1 — A player's session can be adopted by any room peer; `sessionId` is the only credential and it is broadcast to everyone — **DEFERRED to its own PR**

**Status:** The PII half (N2) shipped. The session-adoption fix itself is deferred to a dedicated PR: the frontend keys player identity off peer `sessionId` in ~38 places, so the opaque-`playerId` path is a large client+server identity refactor, and the auth-token alternative is worse today (the client sends no `reconnectToken`, so gating auth on one re-creates the documented reconnection Catch-22). Either path is a sizable change to the fragile auth/reconnect surface and wants its own PR with dedicated E2E reconnection coverage.

**Severity:** High (Critical when `ALLOW_IP_MISMATCH=true`) · **Area:** AuthN / game integrity / session hijack

**Root cause:** The socket's identity is taken verbatim from the client-supplied
`handshake.auth.sessionId` (`middleware/socketAuth.ts:31-35`) and every acting handler builds
its authorization context purely from `getPlayer(socket.sessionId)`
(`socket/playerContext.ts:144-147`). For a **disconnected** session the only gate is
IP consistency — `resolveSessionId` runs rate-limit + session-age + `validateIPConsistency`
and nothing else; the code comment at `middleware/auth/sessionValidator.ts:372-378` documents
that reconnection-token validation was **deliberately removed** from this path to fix a
refresh Catch-22. For a **connected** session, a second socket from the same IP is accepted as
"session continuity" (`sessionValidator.ts:336-348`) — the victim need not even be disconnected.
Meanwhile the `sessionId` is handed to every peer: `getPlayersInRoom` returns the full `Player`
record (`services/player/queries.ts:130-214`, `playerSchema` includes `sessionId`,
`services/player/schemas.ts:9`) and it is emitted in `ROOM_JOINED { players }`
(`roomMembershipHandlers.ts:150`), `ROOM_PLAYER_JOINED { player }` (`:172`),
`PLAYER_DISCONNECTED` (`disconnectHandler.ts:268-280`), and the reconnect broadcasts. JWT never
gates the acting pipeline (`socket/index.ts:144-161` wires only `authenticateSocket`;
`middleware/auth/jwtHandler.ts:41` early-returns when the client simply omits `auth.token`).

**Attack:** Two people behind one NAT/CGNAT (household, office, campus, mobile carrier) join the
same room, or one is a curious opponent. The player-list broadcast hands the attacker every
peer's `sessionId`. The attacker opens a socket with `auth.sessionId = <victim uuid>`; because
their public IP equals the victim's stored `lastIP`, `resolveSessionId` validates it. Their
handlers now resolve the victim's seat — including a **spymaster** seat, leaking the full board
key via `sendSpymasterViewIfNeeded`, and letting them reveal / end-turn as the victim. With
`ALLOW_IP_MISMATCH=true` even the IP gate is gone and any peer who saw the id can hijack from
anywhere.

**Fix:** Stop treating a client-supplied `sessionId` as a bearer credential. Two independent
mitigations, do both:
1. **Never emit another player's `sessionId` to peers.** Introduce a client-facing player DTO
   keyed by a per-room opaque `playerId`; keep `sessionId` server-side. (This also closes N2.)
2. **Bind disconnected-session adoption to a server-issued secret the peer never sees** — require
   the already-existing reconnection token (or a mandatory signed JWT for acting handlers) in the
   disconnected branch of `resolveSessionId`, re-introducing the gate that was removed, but without
   the refresh Catch-22 (a page refresh keeps the token in `localStorage`; only cross-peer adoption
   lacks it). This makes N4 (dead token validators) load-bearing instead of dead.

**Touches:** `middleware/socketAuth.ts`, `middleware/auth/sessionValidator.ts`,
`services/player/queries.ts` + a new player DTO, all peer-facing player emit sites
(`roomMembershipHandlers.ts`, `disconnectHandler.ts`, `roomReconnectionHandlers.ts`),
`services/player/reconnection.ts`.

**Tests:** Auth a socket with a second session's `sessionId` from the same IP → it must **not**
resolve that session's room/role context (it does today). Assert no peer-facing player payload
contains `sessionId`.

---

### N2 — Every player's real IP (`lastIP`) and `userId` are broadcast to all room members — **FIXED**

**Resolution:** `playerService.toPublicPlayer`/`toPublicPlayers` (`services/player/queries.ts`) strip `lastIP`/`userId`, applied at every peer-facing emit site (ROOM_CREATED/JOINED/PLAYER_JOINED/PLAYER_LEFT, resync, reconnect, disconnect, bot-join). Unit-tested in `hostSuccessorPublicPlayer.test.ts`.

**Severity:** Medium · **Area:** Privacy / PII exposure (shares root cause with N1)

**Root cause:** `playerSchema` carries `lastIP` and `userId` (`services/player/schemas.ts:24-25`);
`getPlayersInRoom` parses and returns them (`queries.ts:164`); the raw object is emitted to peers
in `ROOM_JOINED` / `ROOM_PLAYER_JOINED` (`roomMembershipHandlers.ts:150,172`),
`PLAYER_DISCONNECTED` (`disconnectHandler.ts:275`), and `ROOM_PLAYER_LEFT`
(`roomMembershipHandlers.ts:200-204`). No field stripping exists between Redis and the socket, so
any peer who has the room code — spectator or opponent included — harvests every other player's
client IP straight from the socket payload.

**Fix:** The N1 DTO fixes this too — serialize all peer-facing player payloads through a view that
omits `lastIP`, `userId`, and `sessionId`.

**Touches:** Same DTO layer as N1.

**Tests:** Assert no peer-facing player payload contains `lastIP` / `userId`.

---

### N2b — Match-round finalization is silently dropped when `game:nextRound`/`game:start` lands in the post-`game:over` window (re-opens A7) — **FIXED**

**Resolution:** `handleMatchRoundFinalization` now runs BEFORE the `GAME_OVER` broadcast in both the reveal path (`gameActions.ts`) and the forfeit handler (`gameHandlers.ts`), so the round is banked before any client can trigger `nextRound` off `GAME_OVER`.

**Severity:** High · **Area:** Match-mode correctness / race

**Root cause:** On a game-ending reveal, `applyReveal` emits `GAME_OVER`, then `await`s the slow
`saveCompletedGameHistory` (2 Redis reads + validation + Lua), and only **then**
`handleMatchRoundFinalization` (`socket/handlers/gameActions.ts:114-117`; same order in the forfeit
handler `gameHandlers.ts:402-407`). A7's shipped idempotency guard is
`if (!game.gameOver) return null;` inside `finalizeMatchRound` (`services/gameService.ts:800-808`).
The client's "New game" button fires `nextRound()` the instant `gameOver && !matchOver`
(`frontend/game.ts:165-170`) — both derived from the pre-finalization `game:over` broadcast — so a
host clicking immediately lands `startNextRound` (holding a **different** lock, `game-create:`, vs
finalization's `reveal:`) inside the window. `startNextRound` persists round N+1 with
`gameOver=false`; finalization then reads fresh state, sees `gameOver=false`, and **returns null —
finalization never runs.** Because A12 now derives the round number from `roundHistory.length`
(`gameService.ts:866`) and the raced round left no history entry, the next round **reuses round N's
number** while the carry scores still hold round N's live-accrued card points.

**Observable failures:** the round winner's `ROUND_WIN_BONUS` (+7) is never awarded; no
`roundHistory` entry and no `game:roundEnded`/`game:matchOver` broadcast; a match that should have
ended plays an extra round; and `validateCarryOverConsistency` (`gameService.ts:146-159`) then warns
on every subsequent transition. A `game:start` in the same window destroys the pending finalization
identically (`createGame` allows overwrite when `gameOver=true`).

**Fix:** Do the reorder A7 deferred — run `handleMatchRoundFinalization` immediately after the
game-ending mutation, inside the `reveal:` lock window, **before** `saveCompletedGameHistory`.
Belt-and-braces: have `startNextRound` itself call `finalizeMatchRound` (it already holds a lock and
re-reads state) and refuse to build the next round if that flips `matchOver`.

**Touches:** `socket/handlers/gameActions.ts`, `socket/handlers/gameHandlers.ts` (forfeit),
`services/gameService.ts`.

**Tests:** Integration — end a match round by reveal, stall `saveCompletedGameHistory` with a mock,
issue `game:nextRound` in the gap; assert round N gets exactly one `roundHistory` entry, the bonus is
applied once, and a target-crossing score produces `matchOver` rather than another round.

---

### N3 — `leaveRoom` host transfer has no connected/non-bot filter and can permanently lock the room by handing host to a bot — **FIXED**

**Resolution:** New shared `selectHostSuccessor` helper (`services/room/membership.ts`, re-exported from `roomService`) prefers a connected human and never selects a bot; used by both `leaveRoom` and the disconnect path. Unit-tested in `hostSuccessorPublicPlayer.test.ts`.

**Severity:** Medium-High · **Area:** Host lifecycle / room lockout

**Root cause:** `leaveRoom` transfers host to `remainingPlayers[0]` with no filter
(`services/room/membership.ts:189-216`), unlike the disconnect path which deliberately excludes bots
and disconnected players ("prefer a human", `disconnectHandler.ts:325-329`). The documented
invariant "Host transfer prefers humans" (CLAUDE.md) is implemented only for disconnect. The A10
self-heal `ensureRoomHasHost` (`membership.ts:282-293`) only repairs when `hostSessionId` no longer
resolves to a player — but a bot **is** a live first-class player, so `getPlayer(hostSessionId)`
succeeds and the repair no-ops forever. A bot can run no host-only function (start, settings, kick,
add/remove bot, pause), so the room is bricked until its 24h TTL.

**Scenario:** host creates room → adds a bot → a human joins later (so the bot's `connectedAt`
precedes the human's). Host clicks Leave. `getPlayersInRoom` sorts by `connectedAt` ascending →
`remainingPlayers[0]` is the bot → host handed to the bot; `humansRemaining ≥ 1` so the room is not
torn down. The remaining human can never obtain host.

**Fix:** Mirror the disconnect path's candidate selection in `leaveRoom` — prefer
`connected && !isBot`, fall back to connected bots only if no human remains, skip transfer entirely
(let cleanup / `ensureRoomHasHost` handle it) if no eligible human. Factor the selection into one
shared helper so the two paths cannot drift again. **Note:** IMPROVEMENT_PLAN A10's text actually
cites `leaveRoom`'s selection as the *model to copy* — that is backwards; correct it (see §9).

**Touches:** `services/room/membership.ts`, `socket/disconnectHandler.ts` (extract shared helper).

**Tests:** host + bot(joined earlier) + human(joined later); host `room:leave`; assert the new host
is the human and the room stays controllable.

---

### N4 — A spectator can self-promote to `observer` mid-game and receive the fully unmasked board with no host approval — **FIXED**

**Resolution:** `canChangeTeamOrRole` (`socket/playerContext.ts`) now rejects `targetRole === 'observer'` for any non-observer while a game is active (new `OBSERVER_CANNOT_JOIN_MIDGAME` code); observers must be declared before `game:start`. Tested in `playerContext.test.ts`.

**Severity:** Medium · **Area:** Permission check / data-audience / gameplay integrity

**Root cause:** `canChangeTeamOrRole` (`socket/playerContext.ts:261-328`) blocks *leaving* the
observer role (`:289`) and the spymaster role (`:305`) mid-game, but nothing blocks *entering*
`observer`. A spectator (or a waiting-team clicker) falls through to `allowed: true` (`:327`);
`playerRoleSchema` accepts `'observer'` as a self-service target (`validators/playerSchemas.ts:12`);
`setRole.lua` treats observer as teamless/unrestricted; and `getGameStateForPlayer` gives an observer
the full unmasked `types` incl. the assassin (`services/game/revealEngine.ts:341-376`), pushed to the
socket immediately by `playerRoleHandlers.ts:174-177`. Taking a **masked** clicker seat requires a
host `spectator:requestJoin → approveJoin` round-trip — gaining **full** board sight requires nothing.

**Scenario:** competitive 2v2 in progress, a third person sits on Red's side as spectator (masked).
They send `player:setRole {role:'observer'}`, instantly receive the assassin + both teams' keys, and
coach Red's clicker.

**Fix:** Gate entry into `observer` during an active game the same way team seats are gated — reject
`targetRole === 'observer'` while `game && !game.gameOver` for anyone not already an observer (or
require observers to be declared before `game:start`).

**Touches:** `socket/playerContext.ts` (and optionally an observer-request approval path).

**Tests:** active game, `currentTurn='blue'`; a spectator and a red clicker each sending
`player:setRole {role:'observer'}` → rejected; becoming observer before `game:start` still works.

---

### N5 — A host can forfeit the *opposing* team, handing their own team the match-round bonus — **FIXED**

**Resolution:** The forfeit handler (`gameHandlers.ts`) rejects a competitive-mode forfeit whose `team` differs from a seated host's own team; a teamless (moderator) host keeps full control, duet is unaffected. Tested in `gameHandlers.test.ts`.

**Severity:** Low-Medium · **Area:** Rules integrity / authorization

**Root cause:** `gameForfeitSchema` accepts an optional arbitrary `team: 'red'|'blue'`
(`validators/gameSchemas.ts:103-108`); the handler passes `validated.team` straight to
`forfeitGame`, which uses it verbatim as the forfeiting team with no check against the caller's own
team (`gameHandlers.ts:390` → `gameService.ts:547-554`), making the *other* team the winner;
`finalizeRound` then awards that winner `ROUND_WIN_BONUS` (`gameService.ts:723-730`).

**Scenario:** in a competitive match, a host seated on red sends `game:forfeit {team:'blue'}` each
round — blue is logged as forfeiting, red banks the round win + 7 points/round, match ends in red's
favour.

**Fix:** For competitive modes, drop the `team` parameter (always forfeit `currentTurn` or the host's
own team), or require `validated.team === ctx.player.team` when the host is seated on a team. Duet
(teamless) forfeit unaffected.

**Touches:** `validators/gameSchemas.ts`, `socket/handlers/gameHandlers.ts`, `services/gameService.ts`.

**Tests:** host on red emits `game:forfeit {team:'blue'}` → rejected (or coerced to red).

---

## Phase 2 — Data-integrity & correctness (medium)

### N6 — `revealCard.lua` records `guessNumber` after the turn-switch reset, so every turn-ending reveal is stored as guess 0

**Severity:** Medium · **Area:** Data-integrity (history/replay)

**Root cause:** `revealCard.lua:107` increments `game.guessesUsed`; the outcome blocks reset it to 0
on any turn switch (`:152,:163,:220,:230,:263,:273`); the history entry is then inserted using the
already-reset value (`:284-293`, specifically `:291`). Every wrong-card / neutral / max-guesses
reveal in every mode stores `guessNumber: 0` instead of its real ordinal. `bots/engine.ts:142-151`
mirrors the same ordering, so the `bots:parity` gate can't catch it, and the corrupt value is served
verbatim via replay (`services/gameHistory/replayEngine.ts:91-99`) and the REST replay route.

**Fix:** capture `local guessNumber = game.guessesUsed` immediately after the `:107` increment (before
the outcome blocks) and use it in the history insert; same one-line reorder in `applyEngineReveal`.

**Touches:** `scripts/revealCard.lua`, `bots/engine.ts`.

**Tests:** real-Redis (extend `luaScripts.test.ts`): clue for 1 (2 guesses), reveal one correct then
one opponent card; assert the second history entry has `guessNumber: 2`, not 0.

---

### N7 — Game history/replay silently drops all mode-identifying and mode-specific data

**Severity:** Medium · **Area:** Data-integrity (history/replay)

**Root cause:** The persisted `GameHistoryEntry` (`services/gameHistory/storage.ts:108-147`,
`gameHistory/types.ts:95-109`) has no `gameMode`, no `duetTypes`, no `cardScores`/`matchRound`/match
scores — `gameMode` is passed into `saveCompletedGameHistory` (`gameHandlerUtils.ts:79`) but consumed
only by `validateGameData` and discarded. Consequences: `EndReason` lacks a duet-loss value so
`deriveEndReason` maps a duet token-exhaustion loss to `'completed'` with `winner: null`
(`storage.ts:46-53`); a duet co-op **win** sets `game.winner='red'` (`revealCard.lua:134`) so the
summary is indistinguishable from a red classic win; `getFirstTeam` returns `'red'` for every duet
(`storage.ts:61-80`); `initialBoard` stores only side-A `types` (`storage.ts:116-121`) so duet
replays colour every blue-turn reveal wrong, and match replays carry no card values.

**Fix:** persist `gameMode` in the entry (the read schema already tolerates it, `storage.ts:33`), add
mode extras (`duetTypes` + `greenFound`/`timerTokens` for duet; `cardScores`, `matchRound`, match
scores for match), and extend `EndReason` (or store the Lua `endReason` directly) so duet losses
aren't `'completed'`.

**Touches:** `services/gameHistory/{storage,types}.ts`, `services/gameHistory/replayEngine.ts`.

**Tests:** save a duet token-loss and a duet win; assert the entry round-trips `gameMode:'duet'`, a
non-`completed` end reason for the loss, and `duetTypes` present; match round entry round-trips
`cardScores`.

---

### N8 — `game:start` stops the live turn timer before validating "game in progress", so a rejected start leaves a running game with a dead timer

**Severity:** Medium-Low · **Area:** Correctness / ordering

**Root cause:** the start handler calls `stopTurnTimer` unconditionally at `gameHandlers.ts:103`,
**before** the `if (ctx.game && !ctx.game.gameOver) throw RoomError.gameInProgress()` check at
`:107-109`. The only timer re-arm points are turn changes (`gameActions.ts:99-101,137`). A stale/double
`game:start` (stale UI, double submit, reconnect replay) kills the active turn timer and then throws
`GAME_IN_PROGRESS`; the current turn now never auto-expires. Contrast `game:forfeit`/`game:nextRound`,
which validate before stopping the timer.

**Fix:** move the `stopTurnTimer` call after the in-progress check (or after `createGame` succeeds).

**Touches:** `socket/handlers/gameHandlers.ts`.

**Tests:** with an active game and armed timer, emit `game:start`; assert the error is returned **and**
`timer:expired` still fires.

---

### N9 — A Lua op that commits but fails result-schema validation leaves clients desynced with no broadcast and no recovery

**Severity:** Low · **Area:** Robustness / TS↔Lua consistency

**Root cause:** `executeLuaScript` validates the *result* after the script has already `SET` the
mutated game (`services/game/luaGameOps.ts:229-237`); on schema failure it throws and the caller never
broadcasts. One concrete trigger: `gameStateSchema`'s length refine covers only
`words/types/revealed` (`luaGameOps.ts:74-81`), so a truncated `duetTypes` reaches `revealCard.lua:75`
where `cardType` becomes nil — the reveal and `guessesUsed` increment still commit, but the result
omits `type` and `revealResultSchema` rejects it. The card is revealed server-side while every client
sees only an error, staying one reveal behind until a manual resync.

**Fix:** extend the length refine to `duetTypes`/`cardScores`/`revealedBy` so the mismatch is rejected
by the script's own guards *before* mutation; and/or on result-schema failure emit a room resync
instead of only throwing.

**Touches:** `services/game/luaGameOps.ts`, `scripts/revealCard.lua`.

**Tests:** persist a duet game with a 24-length `duetTypes`; blue reveal → op rejected before mutation
(or clients receive a resync), not a silent committed reveal.

---

### N10 — `room:reconnect` consumes the single-use token before post-consumption validation, burning it on a benign mismatch

**Severity:** Low · **Area:** Robustness

**Root cause:** `validateRoomReconnectToken` atomically GET+DELs the token first
(`roomReconnectionHandlers.ts:118`); only afterward are `tokenData.roomCode !== code` (`:132`),
`getRoom` (`:136`), and `getPlayer` (`:177`) checked. A correct token with a stale `code` (room
recreated) or a just-TTL-expired room burns the token and throws, degrading an otherwise-recoverable
reconnect into a forced fresh join (lost seat/role continuity).

**Fix:** validate `tokenData.roomCode === code` and room/player existence *before* consuming, or peek
then DEL only on full-recovery success.

**Touches:** `socket/handlers/roomHandlers/roomReconnectionHandlers.ts` (and/or the token Lua).

**Tests:** reconnect with a valid token but wrong `code`; assert a later reconnect with the right
`code` still succeeds.

---

### N11 — `player:setTeam` lets an observer join a team while keeping the observer role — **FIXED**

**Resolution:** `canChangeTeamOrRole` now blocks an observer from a bare team change (`isTeamChange`) during an active game, alongside the existing role-change lockout. Tested in `playerContext.test.ts`.

**Severity:** Low · **Area:** Role/permission gating

**Root cause:** the observer lockout only fires when `targetRole && targetRole !== 'observer'`
(`playerContext.ts:289-295`); a pure team change (`player:setTeam`) passes `targetRole` undefined, so
the branch is skipped, and `safeTeamSwitch.lua` demotes only spymaster/clicker/advisor — so a
full-board-knowledge observer ends up on a team roster mid-game. Not currently exploitable into a
playing seat (a subsequent `setRole` is still blocked), but contradicts the "observer locked during an
active game" intent and is fragile if future code keys team membership off role transitions.

**Fix:** block observers from `isTeamChange` during an active game as well.

**Touches:** `socket/playerContext.ts`.

**Tests:** observer issues `player:setTeam` mid-game → rejected; allowed once the game is over.

---

## Phase 3 — Frontend correctness & accessibility

### N12 — Seven registered client events are missing from the listener-cleanup list, so their handlers duplicate across room cycles

**Severity:** Medium · **Area:** Listener leak / correctness

**Root cause:** `multiplayerEventNames` — the list `cleanupMultiplayerListeners()` iterates with
`client.off(name)` (`frontend/multiplayerSync.ts:36-77`) — omits `gamePaused`, `gameResumed`,
`timerPaused`, `timerResumed`, `spectatorJoinRequest`, `spectatorJoinApproved`,
`spectatorJoinDenied`, all of which are (re)registered on every `setupMultiplayerListeners()`
(`handlers/gameEventHandlers.ts:271,281`; `handlers/timerEventHandlers.ts:17,23`;
`spectatorJoin.ts:121-123`). The list's own `botSuggestion` comment documents exactly this hazard.
After a kick or failed rejoin → rejoin, each of these fires N× (double pause toasts/announcements;
a spectator join request re-queued and double-approvable on the host; N duplicate `requestResync`).

**Fix:** add the seven names; better, make the cleanup list impossible to drift — have each
`register*Handlers()` return the names it registered (or record them by wrapping `client.on` during
setup) and clean up from that.

**Touches:** `frontend/multiplayerSync.ts` (+ the handler registrars for the systemic variant).

**Tests:** jsdom — `setup → cleanup → setup`, then assert `listeners[name].length === 1` for **every**
registered event name (iterate `Object.keys(listeners)`, not a hardcoded list).

---

### N13 — Keyboard shortcuts are permanently disabled after a kick or failed rejoin — i.e. after every production deploy

**Severity:** Medium · **Area:** Accessibility / listener lifecycle

**Root cause:** `leaveMultiplayerMode()` calls `removeKeyboardShortcuts()`
(`frontend/multiplayerSync.ts:169`), but `initKeyboardShortcuts()` is called exactly once at app init
(`frontend/app.ts:483`) and is already idempotent (`accessibility.ts:38-48`) — nothing re-attaches.
`leaveMultiplayerMode()` runs on `rejoinFailed` and `kicked` (`roomEventHandlers.ts:252,265`). Because
memory-mode deploys wipe all rooms (IMPROVEMENT_PLAN B5), every deploy funnels all connected players
through `rejoinFailed → leaveMultiplayerMode()`, leaving the documented shortcuts N/E/S/M/H/? dead
until a full page reload — for keyboard-only and screen-reader users especially.

**Fix:** delete the `removeKeyboardShortcuts()` call from `leaveMultiplayerMode()` (the handler is
global app UI, not room-scoped, and its init is idempotent).

**Touches:** `frontend/multiplayerSync.ts`.

**Tests:** jsdom — init app, simulate `rejoinFailed`, dispatch `keydown` `s`, assert the
`[data-action="open-settings"]` control's click fires.

---

### N14 — `timer:status` on join/resync/reconnect ignores `isPaused`, so a client (re)joining a paused game runs a live countdown

**Severity:** Medium · **Area:** Client/server desync

**Root cause:** the server sends pause state — `sendTimerStatus` emits
`{ …, isPaused }` (`roomHandlerUtils.ts:18-23`) on join, resync, and reconnect — but the client's
`handleTimerStatus` (`frontend/timer.ts:143-162`) has no `isPaused` in its type or logic and calls
`startTimerCountdown()` whenever `remainingSeconds > 0`. A player who refreshes/reconnects into a
paused game shows the pause overlay while their timer counts down to a stuck "critical" 0:00. Related:
when the server has no active timer it emits nothing (`roomHandlerUtils.ts:17` guards on `endTime`), so
a stale local countdown from before a disconnect is never reconciled. (`timer:timeAdded` is also
forwarded with no client consumer — dead wiring that will bite whoever adds an add-time button.)

**Fix:** in `handleTimerStatus`, when `data.isPaused`, set the display without
`startTimerCountdown()` (mirror `handleTimerPaused`); and call `handleTimerStopped()` at the start of
reconnection/resync handling so a stale countdown is cleared (a following `timer:status` re-arms if a
timer is live).

**Touches:** `frontend/timer.ts`, `frontend/handlers/roomEventHandlers.ts`.

**Tests:** unit — `handleTimerStatus({remainingSeconds:120, endTime, isPaused:true})` leaves
`intervalId === null` and displays 2:00; reconnect with no `timer:status` clears a previously active
`timerState`.

---

### N15 — Team/role changes while disconnected fall through to the standalone engine (the A3 class, unfixed for roles)

**Severity:** Low-Medium · **Area:** Standalone-vs-multiplayer bleed

**Root cause:** `setTeam` (`frontend/roles.ts:253-255`) and `setRoleForTeam` (`:355-357`) gate the
server path on `isMultiplayerMode && isClientConnected()` and, when disconnected, fall through to the
standalone branch that mutates local team/role state and re-renders. A3's shipped fix added the
disconnected-guard to `revealCard`/`endTurn`/`newGame` only. Result of a mid-game blip: the player
locally "becomes" spymaster, the board flips to a misleading all-neutral masked view, the clue form
appears, and submitting silently no-ops (`clueUI.ts:75`) — a confusing flap the next resync undoes.

**Fix:** mirror A3 — after the connected branch, `if (state.isMultiplayerMode) { showToast(t('multiplayer.reconnecting'),'warning'); return; }`.

**Touches:** `frontend/roles.ts`.

**Tests:** with `isMultiplayerMode=true` and a disconnected mock, `setSpymaster('red')` → no state
mutation, reconnecting toast (same shape as the A3 tests).

---

### N16 — Host setup flow races `room:settings` against the auto `game:start`, so the first game can start in the wrong mode / without the timer

**Severity:** Low-Medium · **Area:** Init race / desync

**Root cause:** `handleHostSubmit` fire-and-forgets `updateSettings({gameMode,turnTimer,teamNames})`
then immediately calls `onMultiplayerJoined(result, true, …)` (`setupScreen.ts:282-294`), which
synchronously emits `game:start` (`multiplayer.ts:406-408`). The start handler reads
`room?.settings?.gameMode || 'match'` from Redis at execution time (`gameHandlers.ts:134`); Socket.io
delivers the packets in order but the async handlers aren't serialized, so `game:start`'s read can
land before the `room:settings` Lua write commits, and `game:start` carries no `gameMode` to correct
it. Host picks Duet + 90s, clicks Host, and the auto-started game is match-mode with no timer until the
`settingsUpdated` broadcast flips the radios (UI says duet, live game is match).

**Fix:** don't auto-start until settings are confirmed — wait for the `settingsUpdated` event (or an
ack callback on `updateSettings`) before the auto-start.

**Touches:** `frontend/setupScreen.ts`, `frontend/multiplayer.ts`, `frontend/socket-client-rooms.ts`.

**Tests:** frontend unit — `startGame` is not emitted until `settingsUpdated` arrives.

---

### N17 — The pause overlay is an always-assertive live region *and* is manually announced (C2's bug class, reintroduced by the F1 wiring)

**Severity:** Low · **Area:** Accessibility

**Root cause:** `#pause-overlay` carries `role="alert" aria-live="assertive"`
(`public/index.html:787-793`), so unhiding it announces its contents assertively; the `gamePaused`
handler *also* calls `announceToScreenReader(msg)` plus a toast (`gameEventHandlers.ts:271-278`). C2
established one SR channel per event; this new overlay is a second, interrupting one — doubled per
pause/resume and ×N under N12's duplicate handlers.

**Fix:** drop `role="alert"`/`aria-live` from `#pause-overlay` (keep the explicit
`announceToScreenReader` channel); extend the C2 source-scan test to assert no other element combines a
live region with a handler-driven announcement.

**Touches:** `public/index.html`, `__tests__/frontend/ui.test.ts`.

---

### N18 — i18n bypass bundle: user-facing strings the C5 `showToast` lint guard structurally cannot catch

**Severity:** Low · **Area:** i18n

**Root cause:** hardcoded English shipped to de/es/fr users through sinks outside the C5 guard: SR
announcements in `handlers/playerEventHandlers.ts:77-88` (spoken on every game start via per-player
`player:updated`); `setMpStatus('Room ID: … Enter your nickname…')` (`multiplayer.ts:497`); the
`' (+7 bonus)'` fragment (`gameEventHandlers.ts:376`); `formatGameTimestamp`'s `'Just now'` /
`'N minutes ago'` (`utils.ts:128-152`); the `'Error: '`/`'Warning: '` SR prefixes (`ui.ts:80`); and
the replay log detail in `history-replay.ts:202`. (Locale-key parity itself is clean: 464 keys × 4.)

**Fix:** route each through `t()` with new keys ×4; extend the C5 lint test to also scan
`announceToScreenReader(` and `setMpStatus(` for raw literals/templates.

**Touches:** the files above, four locale files, `__tests__/frontend/localeKeys.test.ts`.

---

### N19 — `game:typing` is fully dormant end-to-end on the client (undispositioned half-built feature)

**Severity:** Low · **Area:** Dead wiring / doc drift

**Root cause:** the server accepts and rebroadcasts `game:typing` (`gameHandlers.ts:636-638`,
rate-limited) and CLAUDE.md documents it as a live pair, but the frontend never emits it and registers
no listener (zero references in `src/frontend`). It escaped the Phase-F finish-or-delete ledger.

**Fix:** record a finish-or-delete disposition in FEATURE_ROADMAP — likely delete (remove handler +
rate-limit entry + doc row); otherwise wire the typing indicator.

**Touches:** `socket/handlers/gameHandlers.ts`, `config/rateLimits.ts`, CLAUDE.md, or the frontend.

---

## Phase 4 — Bot subsystem

### N20 — The embeddings vector model loads synchronously on the first bot decision, blocking the event loop for the entire parse (unshipped residue of E4)

**Severity:** Medium (latent in prod; live under `dev:bots` and the fly.toml "enable embeddings" path)
· **Area:** Performance / driver stall

**Root cause:** `loadVectors()` is a fully synchronous `openSync`/`readSync` loop parsing up to 50k
rows (`bots/semantics/vectorBackend.ts:78-184`), constructed lazily on first use
(`selectBackend.ts:38-69`) — and the first callers are all on the live tick path
(`botController.ts:505,358`; `registry.ts:33,39`). Nothing warms it at bootstrap. After a restart
(deploy, P1-2 self-heal, crash) with `BOT_EMBEDDINGS_PATH` set and rooms restored from Redis, the first
bot to act blocks the event loop for hundreds of ms to seconds — every room, socket, and health probe
stalls with it. E4's shipped chunked `prewarm` runs *after* this load, so it doesn't cover it.

**Fix:** eagerly call `getSemanticBackend()` during bootstrap before `listen`, and/or make the loader
async (chunked with `setImmediate` yields, mirroring `prewarm`) returning the fallback until the
vectors finish. Land before flipping the fly.toml embeddings switch.

**Touches:** `bots/semantics/vectorBackend.ts`, `bots/semantics/selectBackend.ts`, `src/index.ts`.

**Tests:** with a synthetic 50k-row file, assert the backend resolves before the socket server accepts
connections (or, lazy-async, that a tick during load uses the fallback and no single event-loop block
exceeds ~20ms — reuse E4's harness).

---

### N21 — A stale bot action computed before the "thinking" pause can land in a *different* game started during the pause

**Severity:** Medium-Low · **Area:** Driver race (game-boundary)

**Root cause:** the action is computed from the `game` snapshot (`botController.ts:508`), then after
`await sleep(pace)` only the **seat** is re-verified (`:523-530`) — nothing re-checks the game is still
the same game, and no Lua op carries a game-identity CAS (`submitClue.lua:59-67` checks only
gameOver/paused/turn/clue-absent; `endTurn.lua:47-49` only the expected team). The window is widest for
a spymaster because the snapshot is read before `await prewarmSpymasterClues(...)` (`:505`). If a human
forfeits and the host clicks next-round during the pause, and the new round opens on the bot's team
(~50%), the bot's clue for round N is accepted into round N+1.

**Fix:** capture `game.id` (or `seed` + `stateVersion`) before the pause; after it, re-read and drop the
action on identity mismatch (mirroring the seat re-verify). Stronger: thread an expected `stateVersion`
into `applyClue`/`applyReveal`/`applyEndTurn` and reject on mismatch in the Lua.

**Touches:** `bots/botController.ts`, optionally `scripts/{submitClue,revealCard,endTurn}.lua`.

**Tests:** fake-timers unit — while a bot spymaster's pace sleep is pending, replace the stored game
with a new one (different id, same team to move, no clue); assert no clue is submitted to the new game.

---

### N22 — `giveUpAndForceEndTurn` force-ends whatever team holds the turn without re-verifying a bot still owns the stuck seat

**Severity:** Low · **Area:** Driver correctness (P1-6 edge)

**Root cause:** after the re-arm budget is exhausted, the controller re-reads the game, takes
`team = game.currentTurn` and calls `applyEndTurn` unconditionally (`botController.ts:206-231`), never
re-checking that a bot still occupies the failing seat. If, mid-streak (~7s), the host removes the
stuck bot and a human takes the seat, the final failure ends the *human's* healthy turn with a
room-visible `BOT_STALLED` warning.

**Fix:** inside `giveUpAndForceEndTurn`, re-run the same seat resolution `tickRoom` uses and no-op when
no bot holds the seat.

**Touches:** `bots/botController.ts`.

**Tests:** drive 7 consecutive failures; before the last re-arm, remove the bot and seat a human;
assert no forced `endTurn` and no `BOT_STALLED` broadcast.

---

### N23 — Bot engine skips `submitClue.lua`'s clamps and the history cap; the parity harness can't see it (tests numbers 0–3 only)

**Severity:** Low (latent) · **Area:** Engine↔Lua drift

**Root cause:** `applyEngineClue` uses `guessesForClue(Math.trunc(clueNumber))` with no `[0,9]` clamp
(`bots/engine.ts:93-123`) vs `submitClue.lua:26-28`, and never caps `history` while every Lua op trims
to `maxHistoryEntries`. `harness/parity.ts:75-77` seeds clue numbers only 0–3 and its snapshot ignores
`history`, so neither drift is inside the D6 gate. A future strategy emitting 10+ (or a float) would
diverge from production silently.

**Fix:** mirror the Lua clamps and history cap in `applyEngineClue`; extend parity to seed 0–12 and to
compare `history`.

**Touches:** `bots/engine.ts`, `bots/harness/parity.ts`.

**Tests:** parity seed with numbers 0–12; engine and Lua agree on `guessesAllowed` and stored
`currentClue.number` after clamping.

---

### N24 — Advisor path re-does full scoring (plus a Redis config read) on every mutation of a room whose advisor has nothing to say, and refreshes `lastSeen` only on emission

**Severity:** Low · **Area:** Driver efficiency / lifecycle

**Root cause:** the de-dupe key is checked but stored only after the
`if (suggestions.length === 0) return;` early return (`botController.ts:326-359`), so every mutation of
such a room repeats `getBotConfig` (Redis GET+EXPIRE), `resolveClueFrame`, and full board scoring; the
`lastSeen` keep-alive (`:378`) is also only reached on emission, contradicting the module header's
invariant (benign today since bots stay `connected`, but a trap for any future `lastSeen`-keyed sweep).

**Fix:** store the suggestion key and refresh `lastSeen` **before** the empty-result early return (the
key already encodes `stateVersion`, so a later state change still recomputes).

**Touches:** `bots/botController.ts`.

**Tests:** advisor room, all-zero-score backend; two `tickRoom` calls on the same state call
`suggestGuesses`/`getBotConfig` once, not twice.

---

### N25 — Removing the current-turn's acting bot leaves the turn seatless with no room warning

**Severity:** Low · **Area:** Bot lifecycle

**Root cause:** the `BOT_REMOVE` handler emits `ROOM_PLAYER_LEFT`/stats but (unlike `BOT_ADD`) never
calls `notifyGameMutation` (`botHandlers.ts:69-93`), and nothing warns when the removed bot held the
seat the current turn waits on — the next tick just hits `!seat → break`. In a timer-less room the turn
indicator hangs on a seat nobody holds, the same silent-stall symptom P1-6/B4 eliminated, just
human-initiated.

**Fix:** when a game is live and the removed bot held the current turn's pending role, emit a
`ROOM_WARNING` (e.g. `SEAT_VACATED`) so the room knows it's waiting on a human.

**Touches:** `socket/handlers/botHandlers.ts`.

**Tests:** live game, red's clue phase, remove the red bot spymaster → a room warning is broadcast;
re-add a bot → the game proceeds.

---

## Phase 5 — Test / CI / build / ops signal

### N26 — B13 has REGRESSED: the production Dockerfile is back on EOL Node 25 via an auto-merged Dependabot bump — **FIXED**

**Resolution:** Both Dockerfile stages re-pinned to `node:24-alpine3.21`; `.github/dependabot.yml` now ignores `node` major bumps; a new blocking `docker-node-major` CI job asserts the Dockerfile's Node major is in the test matrix.

**Severity:** High · **Area:** Deploy / dependency hygiene / ledger integrity

**Root cause:** `server/Dockerfile:3,60` are `FROM node:25-alpine3.21` again — Dependabot docker PR
`252468b` reverted the B13 fix, because the dependabot docker entry has no `ignore` for major bumps
(`.github/dependabot.yml:77-86`), unlike the npm entry. Node 25 is an odd "Current" line past its
2026-06-01 EOL (no security patches), while CI's matrix tests `[22, 24]` (`ci.yml:195`) — the major
production runs is never tested. B13's originally-optional "fail CI if the Dockerfile major isn't in
the test matrix" guard is now demonstrably necessary.

**Fix:** (1) re-pin both stages to `node:24-alpine3.21`; (2) add
`ignore: [{dependency-name:"node", update-types:["version-update:semver-major"]}]` to the dependabot
docker entry; (3) implement the B13 guard — a cheap CI step that extracts the Dockerfile Node major and
fails unless it appears in the test matrix; (4) correct B13's ledger header (regressed → re-fixed).

**Touches:** `server/Dockerfile`, `.github/dependabot.yml`, `.github/workflows/ci.yml`,
`docs/IMPROVEMENT_PLAN.md`.

**Verification:** open a synthetic node-major bump PR and confirm the new guard turns the build red.

---

### N27 — No tool type-checks the test suites: `typecheck` excludes them and ts-jest is transpile-only under `isolatedModules` — **PARTIAL (mechanism shipped)**

**Resolution:** `tsconfig.test.json` + `npm run typecheck:test` now type-check the backend test tree. Kept **advisory** (not in the blocking `typecheck` gate) because the first-ever compile surfaces a large backlog of pre-existing errors (implicit-any fixtures, `require()`-scoped files) — clearing that backlog so it can gate, plus a frontend-test config, remains a tracked follow-up.

**Severity:** Medium-High · **Area:** Test-signal / CI gate

**Root cause:** `tsconfig.json:63` excludes `src/__tests__` and `src/frontend`, and the frontend
tsconfig includes only frontend+shared, so neither `tsc` invocation in `npm run typecheck` ever sees a
test file; `isolatedModules: true` (`tsconfig.json:48`) makes ts-jest use `transpileModule` with **no
type diagnostics** (verified against ts-jest 29.4.11). ESLint also disables `no-explicit-any` for tests
and runs without type info. So a test can call a service with wrong types or build a mock whose shape
has drifted from the real interface and every gate stays green — the exact D4 drift class, with no
compiler in the loop for test code.

**Fix:** add `tsconfig.test.json` (extends base, includes `src/__tests__/**`) and append
`tsc --noEmit -p tsconfig.test.json` to the `typecheck` script — CI picks it up for free.

**Touches:** `server/tsconfig.test.json` (new), `server/package.json`.

**Verification:** insert `const x: number = 'oops';` into a test; `npm run typecheck` passes today,
fails after.

---

### N28 — The blocking E2E smoke gate covers zero gameplay, and its exclusion + comments are stale now that D1 shipped a green suite

**Severity:** Medium · **Area:** CI gate integrity

**Root cause:** the smoke job runs only `home.spec.js --grep-invert "has share link input"`
(`ci.yml:527`) — a test that no longer exists, so the invert excludes nothing — while the 14-line
comment block (`ci.yml:448-461`) still claims game-flow fails on main, which D1 fixed (9/9 green). A
regression in reveal/end-turn/clue/url-state auto-deploys past `ci-passed`.

**Fix:** drop the dead `--grep-invert`; add the now-green single-context `standalone-game.spec.js`
(and/or `game-flow.spec.js`) to the smoke command; refresh the comment block. Verify 5× stability first.

**Touches:** `.github/workflows/ci.yml`.

---

### N29 — `chaos.test.ts` (25 tests) imports zero production code — it tests the mock

**Severity:** Medium-Low · **Area:** Test-signal

**Root cause:** `__tests__/integration/chaos.test.ts:9` imports only `helpers/mocks`; all 25 tests
assert `createMockRedis`'s own behaviour and can never fail on a product regression, yet inflate the
suite/test counts quoted in the ledgers. Companion: the vacuous `socketAuth.test.ts:188`
(`expect(true).toBe(true)`).

**Fix:** retarget the useful cases at real modules against embedded Redis (like D3's harness), fold
genuine mock-behaviour assertions into a clearly named `helpers/mocks.test.ts`, or delete; delete the
`socketAuth.test.ts:188` no-op.

**Touches:** `server/src/__tests__/integration/chaos.test.ts`,
`server/src/__tests__/middleware/socketAuth.test.ts`.

---

### N30 — CI's PR "Coverage summary" step can never run — the reporter that produces its input isn't configured

**Severity:** Low · **Area:** CI signal

**Root cause:** `coverageReporters: ['text','lcov','html']` (`jest.config.ts.js:32`) omits
`json-summary`, so the `coverage/coverage-summary.json` the CI step reads (`ci.yml:246-261`, guarded by
`-f`) never exists and the advertised per-PR coverage table silently no-ops.

**Fix:** add `'json-summary'` to `coverageReporters` (or delete the CI step).

**Touches:** `server/jest.config.ts.js`.

---

### N31 — The bundle-size "safety net" says *fail* but only warns

**Severity:** Low · **Area:** CI gate

**Root cause:** `ci.yml:180-185` — `# Fail if total gzipped JS exceeds 200KB` followed by an
`::warning::` with no `exit 1`; a 10× bundle regression merges green.

**Fix:** `exit 1` past the threshold (with headroom above current size), or correct the comment to say
"warn". Given the PWA/offline emphasis (C3), a real gate seems intended.

**Touches:** `.github/workflows/ci.yml`.

---

### N32 — `.env.example` omits several real, load-bearing env knobs

**Severity:** Low · **Area:** DX / ops docs

**Root cause:** `MAX_CONNECTIONS_PER_IP`, `RECONNECT_TOKEN_TTL_SECONDS`,
`GLOBAL_IP_RATE_LIMIT_MAX`/`_WINDOW_MS`, `BOT_SEMANTIC_MAPS_DIR`, and `LOADTEST_RELAX_RATE_LIMITS` are
all read in non-test `src/` (some are the documented primary interface for loadtest and bot-maps) but
absent from `server/.env.example`, even as comments.

**Fix:** add commented entries with defaults, following the file's existing convention.

**Touches:** `server/.env.example`.

---

### N33 — Lint/format gates skip `loadtest/`, `scripts/*.mjs`, and the repo's own config JS

**Severity:** Low · **Area:** CI scope / DX

**Root cause:** `lint` targets only `src/`; `format:check` only `src/**/*.ts` + `e2e/**/*.js`
(`package.json:27-29`); `eslint.config.js:41` covers only `src/**/*.ts`. So `loadtest/*.js`,
`scripts/*.mjs` (including `dev-bots.mjs`, which the Dockerfile executes during an embeddings build),
`esbuild.config.js`, `playwright.config.js`, and `jest.config.ts.js` get zero static analysis or
formatting enforcement — a syntax bug in a build-critical `.mjs` reaches main with no signal.

**Fix:** add a flat-config block for `e2e/**`, `loadtest/**`, `../scripts/**/*.mjs`, and root `*.js`;
extend the prettier globs; add a cheap `node --check` CI floor for the `.mjs` scripts.

**Touches:** `server/eslint.config.js`, `server/package.json`, `.github/workflows/ci.yml`.

---

## Phase 6 — Middleware defense-in-depth & config

### N34 — The WebSocket Origin check matches hostname only (ignores scheme + port), weaker than and inconsistent with the HTTP CSRF exact-origin match

**Severity:** Low-Medium · **Area:** CORS/CSP consistency

**Root cause:** `validateOrigin` compares only `new URL(origin).hostname`
(`middleware/auth/originValidator.ts:70,83,90`) while the HTTP path does an exact string compare incl.
scheme+port (`middleware/csrf.ts:150-151`). With `CORS_ORIGIN=https://app.example.com`, a handshake
whose `Origin` is `http://app.example.com` or `https://app.example.com:8443` passes the WS check but
would fail the HTTP one. (Bounded: the session id lives in localStorage, not a cookie, so a forged
origin still can't act as the victim — defense-in-depth, not a full bypass — but note N1 changes the
threat calculus around session ids.)

**Fix:** compare the full origin (scheme+host+port) in `validateOrigin`, or reuse `isOriginAllowed` so
the two CSRF layers share one predicate.

**Touches:** `middleware/auth/originValidator.ts`.

---

### N35 — `/health/metrics` uses a bespoke plaintext password compare with a length short-circuit, diverging from the scrypt admin auth

**Severity:** Low · **Area:** Auth consistency

**Root cause:** `requireMetricsAuth` compares the supplied password to `ADMIN_PASSWORD` in plaintext
with a length short-circuit before `timingSafeEqual` (`routes/healthRoutes.ts:164-189`) — leaking the
admin password length via timing and using no KDF — while `/metrics` (`app.ts:336`) and the admin
router (`adminRoutes.ts:53-125`) use the scrypt-based `basicAuth`. Two implementations guard the
metrics surface; a future admin-auth change silently won't cover `/health/metrics`.

**Fix:** route `/health/metrics*` through the shared `basicAuth` (or a shared `verifyAdminPassword`
helper), scrypt-hashing both sides and dropping the length branch.

**Touches:** `routes/healthRoutes.ts` (+ shared helper).

---

### N36 — CSP `connect-src` permits `ws:`/`wss:` to any host

**Severity:** Low · **Area:** CSP config

**Root cause:** `connectSrc: ["'self'", 'wss:', 'ws:']` (`app.ts:177`) — scheme-only sources allow the
page to open a WebSocket to *any* host, broader than the otherwise-strict same-origin CSP; an injected
script could exfiltrate over a cross-origin socket. The client only ever connects to its own origin.

**Fix:** scope `connect-src` to `'self'` plus the specific `wss://<domain>` (or drop the bare schemes,
since same-origin WS is already covered by `'self'`); drop plaintext `ws:` in production.

**Touches:** `app.ts`.

---

### N37 — The socket rate-limiter default is fail-open: an event missing from the map gets no limiting at all, including the global-IP cap

**Severity:** Low (latent — all 38 current events are mapped) · **Area:** Rate-limit robustness

**Root cause:** `getLimiter` returns a pass-through for any event not in `limits`
(`middleware/rateLimit.ts:150-151`), and the global-per-IP cap lives *inside* the returned limiter, so
an unmapped event bypasses even that ceiling. This is the exact pattern that produced P1-5
(`game:abandon`/`game:clearHistory` unthrottled); P1-5 fixed the two keys but left the fail-open
default. The next handler added without a `RATE_LIMITS` entry ships with zero throttling.

**Fix:** make `getLimiter` fail-closed — a conservative default `RateLimitConfig` plus the always-on
global-IP cap for any unlisted event, with a warning log.

**Touches:** `middleware/rateLimit.ts`.

---

## §9 Ledger reconciliation (no code, or re-open)

The two prior ledgers have drifted from the code — several items are implemented but unmarked, one has
regressed, and one carries backwards guidance. Fixing the ledgers is itself a task.

- **B13 (IMPROVEMENT_PLAN) — flip FIXED → REGRESSED, then re-fix under N26.** The Dockerfile is back on
  Node 25 (see N26); the "FIXED / confirmed live" note is false.
- **A7 (IMPROVEMENT_PLAN) — re-open at Medium-High (tracked here as N2b).** A7's resolution note claims
  "the idempotency guard already prevents all the described corruption"; N2b shows the deferred reorder
  is load-bearing — the guard converts the race into a *guaranteed silent loss* of finalization plus a
  reused round number.
- **A10 (IMPROVEMENT_PLAN) — correct the backwards guidance.** Its text cites `leaveRoom`'s unfiltered
  host selection as the model to copy; N3 shows that selection is itself the defect. Point the
  cross-reference the other way (disconnect path is the model).
- **E3, G2, G3, G4 (IMPROVEMENT_PLAN) — mark FIXED.** All four are implemented in code with in-source
  attribution (`botRoomCache.ts`; the `displayCase` chain + tableVocab-first merge; `boardBestLead`
  applying `makeBoardSafetyCheck`; `assassinBy` attribution in `playGame.ts`/`scoring.ts`) but their
  headers still read open. Verify and mark, so the next review pass doesn't re-discover them.
- **G1 (IMPROVEMENT_PLAN) — update the stale note.** Its "second half — letting traps back into
  targeting — remains open" is no longer true; `admitClosingTraps`/`buildTargeting`
  (`spymasters.ts:159-202`) implement it.
- **E4 (IMPROVEMENT_PLAN) — keep open, narrowed to N20.** The scan-burst half shipped (chunked
  `prewarm`); the synchronous initial model load (N20) is the remaining residue.
- **D1 (IMPROVEMENT_PLAN) — add the follow-through sub-item (N28).** Its own note says step (d) is "now
  unblocked", but `ci.yml`'s smoke slice still reflects the pre-D1 world.
- **D4 (IMPROVEMENT_PLAN) — record the residual risk (N27).** D4 leaned on the corrected `RedisClient`
  type to prevent recurrence, but test code is outside every compiler gate, so mock↔type drift stays
  undetectable until a runtime failure.
- **P2-3 (HARDENING) — extend the inventory.** Add `botRoomCache` and `suggestionKeys` (two more
  per-instance maps added since P2-3 was written) to its list; note that the deterministic per-decision
  seeds mean dual-instance controllers would mostly compute *identical* actions whose duplicates the Lua
  guards already reject — a genuine mitigating factor.

**Confirmed still-open, unchanged (listed so they aren't re-discovered):** HARDENING P2-1, P2-2
(liveness half), P2-4, P2-5, P3-1..P3-4; IMPROVEMENT B8, B15, C7, C9, D5 (k6 half), D7.

---

## Suggested sequencing

1. **N1 + N2** (one DTO + auth change closes both) — the only finding that lets one player act as
   another and read the board. Do it first.
2. **N2b, N3, N4, N5** — integrity/authorization bugs reachable in an ordinary game.
3. **N26, N27** — restore the CI signal that would have caught (and will catch) regressions in the above;
   N26 is a live prod-on-EOL-runtime issue.
4. **N6, N7, N9** — data-integrity in history/replay (bundle; they touch the same files).
5. **N12–N14** — the highest-impact frontend bugs (listener duplication, dead shortcuts, paused-timer
   desync), all amplified by the memory-mode deploy-wipe reality.
6. **N20** — before the fly.toml embeddings switch is ever flipped.
7. Everything else as capacity allows; **§9** can ride along with whichever PR touches the relevant
   file.

## See also

- [HARDENING_PLAN.md](HARDENING_PLAN.md) — first review pass (Phases 0–3).
- [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) — second review pass (Phases A–I).
- [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) — forward-looking features + finish-or-delete dispositions.
