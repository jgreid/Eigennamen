# Game Modes Review & Improvement Proposals

**Date**: 2026-03-01
**Scope**: Review of Classic, Duet, and Match mode implementations across backend, frontend, Lua scripts, and tests.

---

## Current State Summary

The codebase implements three game modes defined in `server/src/shared/gameRules.ts`:

| Mode | Type | Win Condition | Key Mechanic |
|------|------|---------------|--------------|
| **Classic** | Competitive (2 teams) | First team reveals all their cards | Assassin = instant loss |
| **Duet** | Cooperative (2 players) | Find all 15 unique greens | Timer tokens drain on bystander hits |
| **Match** | Competitive (multi-round) | First to 42+ pts with 3+ pt lead | Card scoring (gold/silver/trap) + round bonuses |

### Architecture Strengths

The game mode system is well-architected overall:

- **Single source of truth**: `shared/gameRules.ts` defines mode constants for both frontend and backend
- **Deterministic PRNG**: Seeded Mulberry32 ensures reproducible boards for replays
- **Atomic Lua operations**: Card reveal and turn-end are transactional in Redis, preventing race conditions
- **Clean mode branching**: `revealEngine.ts` cleanly separates Classic vs Duet outcome logic
- **Defense-in-depth**: Both TypeScript and Lua validate card indices, turn ownership, and game state
- **Zod validation at boundaries**: Mode selection validated via `z.enum(['classic', 'duet', 'match'])`

---

## Issues Found

### 1. Match Mode First-Team Alternation Is Not Guaranteed

**Severity**: Medium
**Location**: `gameService.ts:487-493` (`startNextRound`)

The comment on line 487 says "Alternate first team by using the opposite of the previous round", but the implementation generates a fresh seed and calls `generateBoardLayout(numericSeed, false)` which uses `seededRandom(seed + offset) > 0.5` to pick the first team. This is probabilistic (~50/50), not deterministic alternation.

`firstTeamHistory` is tracked and carried forward, but never consulted to enforce alternation. Over many rounds this is statistically fine, but individual matches can have the same team go first 2-3 times in a row, which is competitively unfair.

**Recommendation**: After generating the layout, override `firstTeam` to be the opposite of the previous round's first team:

```typescript
// In startNextRound(), after generateBoardLayout:
const previousFirstTeam = currentGame.firstTeamHistory?.slice(-1)[0];
if (previousFirstTeam) {
    layout.firstTeam = previousFirstTeam === 'red' ? 'blue' : 'red';
}
```

### 2. Match Mode Round Finalization Uses Fragile Redis Persistence

**Severity**: Medium
**Location**: `gameHandlers.ts:239-244` and `gameHandlers.ts:360-364`

After a round ends, the handler calls `finalizeRound()` which mutates the game state in-memory, then persists it with a raw `redis.set()` call with a hardcoded 3600s TTL:

```typescript
const redis = (await import('../../config/redis')).getRedis();
await redis.set(`room:${ctx.roomCode}:game`, JSON.stringify(updatedGame), { EX: 3600 });
```

This bypasses the `executeGameTransaction` optimistic locking pattern used elsewhere. If two reveals complete nearly simultaneously (e.g., network race), the second `finalizeRound` could overwrite the first's results. The dynamic import of redis is also an anti-pattern. The hardcoded 3600s TTL may differ from the room's actual TTL.

**Recommendation**: Move round finalization into `executeGameTransaction` or a dedicated Lua script. At minimum, use `REDIS_TTL.ROOM` instead of the hardcoded value, and import redis statically.

### 3. Duplicated Match Finalization Logic in Game Handler

**Severity**: Low-Medium
**Location**: `gameHandlers.ts:238-262` and `gameHandlers.ts:359-383`

The match mode round-finalization block (get game, finalize round, persist, emit match-over or round-ended) is copy-pasted in both the `GAME_REVEAL` handler and the `GAME_FORFEIT` handler. This violates DRY and increases the risk of the two paths diverging.

**Recommendation**: Extract to a shared helper, e.g., `handleMatchRoundEnd(io, ctx, socket)` in `gameHandlerUtils.ts`.

### 4. Lua Reveal Script Has No Match-Mode-Aware Outcome Logic

**Severity**: Low
**Location**: `scripts/revealCard.lua:135-178`

The Lua script has two code paths: `isDuet` and the `else` block (lines 135-178). The else block handles both Classic and Match identically — assassin and score-based win checks work the same way. However, the Lua script does not check for `gameMode == 'match'` explicitly, and instead uses the heuristic `if game.cardScores then` (line 244) to conditionally include match fields.

This works today because Match mode inherits Classic's board layout (9/8/7/1), but if Match mode ever needs different win conditions (e.g., no assassin instant-loss, or round ending when a score threshold is hit mid-round), the Lua script would need mode-aware branching.

**Recommendation**: Add an explicit `local isMatch = game.gameMode == 'match'` variable in the Lua script for future extensibility, even if the behavior is currently identical to Classic.

### 5. No E2E Test Coverage for Duet or Match Modes

**Severity**: Medium
**Location**: `server/e2e/`

The E2E test suite (Playwright) has **zero** tests for Duet or Match modes. The only game mode reference in E2E tests is a CSS class regex for card types in standalone mode. All E2E tests exercise Classic mode exclusively.

Unit tests exist for:
- Board generation (`gameModes.test.ts`)
- Duet reveal logic (`duetMode.test.ts`)
- Match scoring (`matchMode.test.ts`)

But the integration between frontend UI, socket events, and mode-specific state transitions has no E2E coverage.

**Recommendation**: Add E2E specs for:
- Duet mode: cooperative win (find all greens), cooperative loss (assassin hit, timer token depletion)
- Match mode: multi-round flow, score accumulation, match end condition, "next round" button

### 6. Duet Mode Forfeit Semantics Are Ambiguous

**Severity**: Low
**Location**: `gameService.ts:364-366`

When a Duet game is forfeited, `winner` is set to `null` (cooperative loss). This is correct semantically, but the forfeit handler in `gameHandlers.ts:350-355` broadcasts `forfeitingTeam` in the payload. In a cooperative mode, "forfeiting team" doesn't make conceptual sense — both players lose together.

**Recommendation**: For Duet mode forfeits, omit `forfeitingTeam` from the payload or set it to a neutral value, and adjust the frontend messaging to say "Game abandoned" rather than "Team X forfeited."

### 7. Frontend GameState Type Does Not Include `gameMode`

**Severity**: Low
**Location**: `frontend/stateTypes.ts`

The frontend `GameState` interface in `stateTypes.ts` defines match-specific fields (`matchOver`, `matchWinner`, `roundHistory`, etc.) but `gameMode` itself lives at the root `state.gameMode` level, separate from `state.gameState`. This split means mode checks require accessing two different state paths.

This is intentional (mode is room-level config, not per-game state) but unintuitive for developers. The `multiplayerSync.ts` reconciliation handles it correctly, but the conceptual mismatch could cause bugs in future development.

**Recommendation**: Either add `gameMode` to the `GameState` interface for consistency, or add a clear comment in `stateTypes.ts` explaining why it's separate.

### 8. Missing `startNextRound` Socket Event Handler for Word Lists

**Severity**: Low
**Location**: `gameHandlers.ts:416-418`

When `startNextRound` is called via `GAME_NEXT_ROUND`, the handler passes `{ gameMode: 'match' }` as options but does not forward the room's custom word list. If the room was using a custom word list, subsequent rounds revert to the default word list.

**Recommendation**: Fetch the room's word list settings and pass them through:

```typescript
const game = await gameService.startNextRound(ctx.roomCode, ctx.game, {
    gameMode: 'match',
    wordList: room?.settings?.wordList // preserve custom words across rounds
});
```

---

## Proposed Improvements (Prioritized)

### Priority 1: Correctness

1. **Fix first-team alternation in Match mode** — Explicitly alternate using `firstTeamHistory` instead of relying on random seed (Issue #1)
2. **Fix round finalization race condition** — Use `executeGameTransaction` for `finalizeRound` persistence (Issue #2)
3. **Preserve word list across Match rounds** — Forward custom word list in `GAME_NEXT_ROUND` handler (Issue #8)

### Priority 2: Code Quality

4. **Extract match finalization helper** — DRY up the duplicated round-end logic in reveal and forfeit handlers (Issue #3)
5. **Add explicit `isMatch` in Lua script** — Future-proof the reveal script for Match-specific rule changes (Issue #4)

### Priority 3: Test Coverage

6. **Add E2E tests for Duet mode** — Cooperative win, assassin loss, timer token depletion (Issue #5)
7. **Add E2E tests for Match mode** — Multi-round flow, next-round transition, match end (Issue #5)
8. **Add integration test for Match round persistence** — Verify scores survive round transitions correctly

### Priority 4: Polish

9. **Clean up Duet forfeit semantics** — Adjust messaging for cooperative context (Issue #6)
10. **Clarify `gameMode` state location** — Document or unify the split between root state and game state (Issue #7)

---

## Summary

The game mode system is production-ready with clean separation of concerns. The three modes are well-differentiated with mode-appropriate logic isolated to focused functions. The primary risks are:

- **Match mode correctness**: First-team alternation and round finalization race condition
- **Test coverage gap**: No E2E tests for Duet or Match modes
- **Minor DRY violation**: Duplicated match finalization in handlers

None of these are blocking issues, but addressing Priority 1 items would improve competitive fairness and data integrity in Match mode.
