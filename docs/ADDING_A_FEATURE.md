# Adding a Feature: Worked Example

This walkthrough traces a real feature — the `chat:spectator` event — through every layer of the codebase. Use it as a template when adding new socket events, REST endpoints, or game rules.

## Anatomy of a Socket Event

Every socket event follows the same path:

```
Client emits event
  → Zod schema validates input
  → Rate limiter checks frequency
  → Context handler resolves player/room/game
  → Handler function runs business logic
  → safeEmit broadcasts result to clients
```

The files involved (all paths relative to `server/src/`):

| Step | File(s) | What happens |
|------|---------|-------------|
| 1. Event name | `config/socketConfig.ts` | Centralized event name constant |
| 2. Validation | `validators/chatSchemas.ts` | Zod schema for input shape |
| 3. Handler | `socket/handlers/chatHandlers.ts` | Business logic |
| 4. Registration | `socket/connectionHandler.ts` | Wires handler to socket |
| 5. Client | `frontend/handlers/chatEventHandlers.ts` | Client-side listener |

---

## Step 1: Define the Event Name

**File:** `config/socketConfig.ts`

```typescript
export const SOCKET_EVENTS = {
    // ...existing events...
    CHAT_SPECTATOR: 'chat:spectator',
    CHAT_SPECTATOR_MESSAGE: 'chat:spectatorMessage',
} as const;
```

All event names live here. This prevents typos and enables IDE autocomplete via the `SocketEventName` union type.

---

## Step 2: Create the Validation Schema

**File:** `validators/chatSchemas.ts`

```typescript
import { z } from 'zod';
import { VALIDATION } from '../config/constants';
import { removeControlChars } from '../utils/sanitize';

const spectatorChatSchema = z.object({
    message: z
        .string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Message is required'),
});

export { spectatorChatSchema };
```

Key patterns:
- Always import max lengths from `config/constants` (shared between frontend and backend)
- Always run `removeControlChars()` to strip ASCII control characters
- Use `.transform()` + `.refine()` to sanitize then re-validate after sanitization
- Export the schema from `validators/schemas.ts` (barrel file)

---

## Step 3: Write the Handler

**File:** `socket/handlers/chatHandlers.ts`

```typescript
import { createRoomHandler } from '../contextHandler';
import { spectatorChatSchema } from '../../validators/schemas';
import { SOCKET_EVENTS } from '../../config/constants';
import { PlayerError } from '../../errors/GameError';
import { safeEmitToGroup } from '../safeEmit';

// Inside chatHandlers(io, socket):
socket.on(
    SOCKET_EVENTS.CHAT_SPECTATOR,
    createRoomHandler(
        socket,
        SOCKET_EVENTS.CHAT_SPECTATOR,    // event name for rate limiting
        spectatorChatSchema,               // Zod schema (validated automatically)
        async (ctx, validated) => {        // ctx has: sessionId, roomCode, player, game
            // Authorization: only spectators can use this event
            if (ctx.player.role !== 'spectator') {
                throw PlayerError.notAuthorized();
            }

            // Build the message payload
            const message = {
                from: {
                    sessionId: ctx.player.sessionId,
                    nickname: ctx.player.nickname,
                    team: ctx.player.team,
                    role: ctx.player.role,
                },
                text: validated.message,    // Already sanitized by Zod transform
                timestamp: Date.now(),
            };

            // Broadcast to all spectators in the room
            safeEmitToGroup(io, `spectators:${ctx.roomCode}`, SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE, message);
        }
    )
);
```

**What `createRoomHandler` does for you:**
1. Wraps your handler in rate limiting (per-event config from `config/rateLimits.ts`)
2. Validates input against the Zod schema — rejects bad data before your code runs
3. Resolves the player context from Redis — guarantees `ctx.player` and `ctx.roomCode` exist
4. Wraps execution in a timeout to prevent indefinite hangs
5. Catches errors and emits sanitized error responses automatically

**Context handler variants:**

| Factory | Use when | Guarantees |
|---------|----------|-----------|
| `createPreRoomHandler` | Before room join (room:create, room:join) | Validated input only |
| `createRoomHandler` | Player is in a room | `ctx.roomCode`, `ctx.player` |
| `createHostHandler` | Only the host should call this | Same + host check |
| `createGameHandler` | Active game required | Same + `ctx.game` |

---

## Step 4: Register the Handler

**File:** `socket/connectionHandler.ts`

Handlers are already registered by module. If you added your event to an existing handler file (like `chatHandlers.ts`), nothing changes here. If you created a **new handler file**, import and call it:

```typescript
import myNewHandlers from './handlers/myNewHandlers';

// Inside handleConnection():
myNewHandlers(socketServer, gameSocket);
```

---

## Step 5: Add Client-Side Handling

**File:** `frontend/handlers/chatEventHandlers.ts`

```typescript
export function registerChatEventHandlers(): void {
    EigennamenClient.on('chat:spectatorMessage', (message) => {
        // Update UI with the received message
        appendChatMessage(message);
    });
}
```

Client handlers are registered in `frontend/multiplayer.ts` when the socket connects.

---

## Step 6: Add Rate Limiting (If Needed)

**File:** `config/rateLimits.ts`

Events use a default rate limit, but you can configure per-event limits:

```typescript
export const EVENT_RATE_LIMITS: Partial<Record<string, RateLimit>> = {
    'chat:spectator': { maxEvents: 10, windowMs: 60000 },  // 10 per minute
};
```

---

## Step 7: Write Tests

**File:** `__tests__/handlers/spectatorChat.test.ts`

```typescript
describe('chat:spectator handler', () => {
    it('should broadcast to spectators', async () => {
        // Setup mock socket, room, player with role 'spectator'
        // Emit 'chat:spectator' with { message: 'Hello' }
        // Assert safeEmitToGroup was called with correct room and data
    });

    it('should reject non-spectators', async () => {
        // Setup player with role 'clicker'
        // Emit 'chat:spectator'
        // Assert NOT_AUTHORIZED error emitted
    });
});
```

Test patterns used in this codebase:
- Mock Redis with `createMockRedis()` from `helpers/mocks.ts`
- Mock socket with `{ id: 'socket1', sessionId: 'sess1', emit: jest.fn() }`
- Assert emissions with `expect(safeEmitToGroup).toHaveBeenCalledWith(...)`

---

## Checklist

When adding a new socket event:

- [ ] Event name added to `config/socketConfig.ts`
- [ ] Zod schema in `validators/*Schemas.ts` (and re-exported from `validators/schemas.ts`)
- [ ] Handler in `socket/handlers/*.ts` using a `create*Handler` factory
- [ ] Client listener in `frontend/handlers/*.ts`
- [ ] Rate limit configured in `config/rateLimits.ts` (if non-default)
- [ ] Tests in `__tests__/handlers/*.test.ts`
- [ ] `npm test` passes, `npm run lint` clean, `npm run format:check` clean

When adding a new REST endpoint:

- [ ] Route in `routes/*.ts` (registered in `routes/index.ts` or `routes/adminRoutes.ts`)
- [ ] Validation middleware via `validateBody()`, `validateQuery()`, or `validateParams()`
- [ ] Service logic in `services/` (handlers should not contain business logic)
- [ ] Swagger spec updated in `config/swagger.ts`
- [ ] Tests in `__tests__/routes/*.test.ts`
