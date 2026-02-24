# Testing Guide - Eigennamen Online

This guide covers how to write and run tests for the Eigennamen Online project.

## Overview

The project uses a comprehensive testing strategy:

| Type | Framework | Location | Purpose |
|------|-----------|----------|---------|
| Unit Tests | Jest + ts-jest | `server/src/__tests__/` | Service, handler, and utility testing |
| Integration Tests | Jest + Supertest | `server/src/__tests__/integration/` | Full game flow, race conditions |
| Frontend Unit Tests | Jest + jsdom | `server/src/__tests__/frontend/` | Client-side module testing |
| E2E Tests | Playwright | `server/e2e/` | Full user flow testing |

## Quick Start

```bash
# Run all backend tests
cd server
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run frontend tests
npm run test:frontend

# Run E2E tests
npx playwright test
```

## Test Coverage Requirements

Global thresholds are set lower because infrastructure modules (redis.ts, socket/index.ts) require real integration tests for meaningful coverage. Business logic modules individually exceed 80%.

| Metric | Minimum | Current |
|--------|---------|---------|
| Statements | 75% | 94%+ |
| Branches | 65% | 84%+ |
| Functions | 80% | 90%+ |
| Lines | 75% | 94%+ |

### Current Test Counts (as of Feb 17, 2026)

| Category | Suites | Tests |
|----------|--------|-------|
| Jest (backend + frontend) | 93 | 2,671 |
| E2E (Playwright) | 9 | 64+ |
| **Total** | **102** | **~2,735** |

All 93 Jest suites pass with 0 failures.

## Backend Testing (Jest)

### Directory Structure

```
server/src/__tests__/
├── helpers/
│   ├── mocks.ts                 # Common mock utilities
│   └── socketTestHelper.ts      # Socket testing utilities
├── integration/
│   ├── fullGameFlow.integration.test.ts  # Full game flow
│   ├── handlers.integration.test.ts      # Handler integration
│   ├── raceConditions.test.ts            # Race condition tests
│   └── timerOperations.test.ts           # Timer operation tests
├── frontend/
│   ├── board.test.ts            # Board UI tests
│   ├── state.test.ts            # State management tests
│   ├── utils.test.ts            # Frontend utility tests
│   └── rendering.test.ts        # Rendering tests
├── gameService.test.ts          # Game logic tests
├── playerService.test.ts        # Player management tests
├── timerService.test.ts         # Timer functionality tests
├── gameHistoryService.test.ts   # Game history tests
├── auditService.test.ts         # Audit logging tests
├── gameHandlers.test.ts         # Game event handlers
├── roomHandlers.test.ts         # Room event handlers
├── playerHandlers.test.ts       # Player event handlers
├── timerHandlers.test.ts        # Timer event handlers
├── chatHandlers.test.ts         # Chat event handlers
├── adminRoutes.test.ts          # Admin API tests
├── routes.test.ts               # REST API tests
├── rateLimit.test.ts            # Rate limiting tests
├── socketAuth.test.ts           # Authentication tests
├── ... and 60+ more test files
```

**Note**: Test files are organized flat in `__tests__/` (not in subdirectories by domain). Extended and edge-case test files use suffixes like `Extended`, `Unit`, `Branch`, etc.

### Writing Unit Tests

```javascript
// server/src/__tests__/services/gameService.test.ts
const gameService = require('../../services/gameService');
const { getRedis } = require('../../config/redis');

// Mock Redis for unit tests
jest.mock('../../config/redis');

describe('gameService', () => {
    let mockRedis;

    beforeEach(() => {
        // Setup mock Redis
        mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn()
        };
        getRedis.mockReturnValue(mockRedis);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createGame', () => {
        it('should create a game with 25 cards', async () => {
            // Arrange
            const roomCode = 'TEST01';
            const seed = 12345;
            const words = gameService.DEFAULT_WORDS;

            mockRedis.set.mockResolvedValue('OK');

            // Act
            const game = await gameService.createGame(roomCode, seed, words);

            // Assert
            expect(game.words).toHaveLength(25);
            expect(game.types).toHaveLength(25);
            expect(game.revealed).toHaveLength(25);
            expect(game.revealed.every(r => r === false)).toBe(true);
        });

        it('should assign correct card type counts', async () => {
            const game = await gameService.createGame('TEST01', 12345);

            const redCount = game.types.filter(t => t === 'red').length;
            const blueCount = game.types.filter(t => t === 'blue').length;
            const neutralCount = game.types.filter(t => t === 'neutral').length;
            const assassinCount = game.types.filter(t => t === 'assassin').length;

            // Starting team gets 9, other gets 8
            expect(Math.max(redCount, blueCount)).toBe(9);
            expect(Math.min(redCount, blueCount)).toBe(8);
            expect(neutralCount).toBe(7);
            expect(assassinCount).toBe(1);
        });
    });

    describe('revealCard', () => {
        it('should reveal card and return card type', async () => {
            // Setup existing game
            const game = createMockGame();
            mockRedis.get.mockResolvedValue(JSON.stringify(game));
            mockRedis.set.mockResolvedValue('OK');

            const result = await gameService.revealCard('TEST01', 0, mockPlayer());

            expect(result.revealed).toBe(true);
            expect(result.type).toBeDefined();
        });

        it('should reject if card already revealed', async () => {
            const game = createMockGame();
            game.revealed[0] = true;
            mockRedis.get.mockResolvedValue(JSON.stringify(game));

            await expect(
                gameService.revealCard('TEST01', 0, mockPlayer())
            ).rejects.toThrow('Card already revealed');
        });

        it('should end game when assassin revealed', async () => {
            const game = createMockGame();
            game.types[0] = 'assassin';
            mockRedis.get.mockResolvedValue(JSON.stringify(game));
            mockRedis.set.mockResolvedValue('OK');

            const result = await gameService.revealCard('TEST01', 0, mockPlayer());

            expect(result.gameOver).toBe(true);
            expect(result.winner).toBeDefined();
        });
    });
});

// Helper functions
function createMockGame() {
    return {
        roomCode: 'TEST01',
        seed: 12345,
        words: Array(25).fill('WORD'),
        types: Array(25).fill('neutral'),
        revealed: Array(25).fill(false),
        currentTurn: 'red',
        gameOver: false
    };
}

function mockPlayer(overrides = {}) {
    return {
        sessionId: 'session123',
        nickname: 'TestPlayer',
        team: 'red',
        role: 'clicker',
        ...overrides
    };
}
```

### Testing Socket Handlers

```javascript
// server/src/__tests__/handlers/gameHandlers.test.ts
const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

describe('gameHandlers', () => {
    let io, serverSocket, clientSocket;

    beforeEach((done) => {
        const httpServer = createServer();
        io = new Server(httpServer);
        httpServer.listen(() => {
            const port = httpServer.address().port;
            clientSocket = new Client(`http://localhost:${port}`);
            io.on('connection', (socket) => {
                serverSocket = socket;
                // Register handlers
                require('../../socket/handlers/gameHandlers')(io, socket);
            });
            clientSocket.on('connect', done);
        });
    });

    afterEach(() => {
        io.close();
        clientSocket.close();
    });

    it('should emit game:started when game starts', (done) => {
        clientSocket.on('game:started', (data) => {
            expect(data.words).toHaveLength(25);
            expect(data.currentTurn).toBeDefined();
            done();
        });

        clientSocket.emit('game:start', { wordList: [] });
    });
});
```

### Testing with Real Redis

For integration tests that need real Redis:

```javascript
// server/src/__tests__/integration/redis.test.ts
const { getRedis, initializeRedis } = require('../../config/redis');

describe('Redis Integration', () => {
    beforeAll(async () => {
        // Use test Redis or memory mode
        process.env.REDIS_URL = 'memory';
        await initializeRedis();
    });

    it('should store and retrieve data', async () => {
        const redis = getRedis();
        await redis.set('test:key', 'value');
        const result = await redis.get('test:key');
        expect(result).toBe('value');
    });
});
```

## E2E Testing (Playwright)

### Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
        { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
    },
});
```

### Writing E2E Tests

```javascript
// tests/game-flow.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Game Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('should display game board with 25 cards', async ({ page }) => {
        const cards = page.locator('.card');
        await expect(cards).toHaveCount(25);
    });

    test('should reveal card on click', async ({ page }) => {
        const card = page.locator('.card').first();
        await card.click();
        await expect(card).toHaveClass(/revealed/);
    });

    test('should start new game', async ({ page }) => {
        // Click new game button
        await page.click('[data-action="new-game"]');

        // Confirm in modal
        await page.click('[data-action="confirm-yes-new-game"]');

        // Verify new game started (cards not revealed)
        const revealedCards = page.locator('.card.revealed');
        await expect(revealedCards).toHaveCount(0);
    });
});
```

### Multiplayer E2E Tests

```javascript
// tests/multiplayer.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Multiplayer', () => {
    test('two players can join same room', async ({ browser }) => {
        // Create two browser contexts (like two users)
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        // Player 1 creates room
        await page1.goto('/');
        await page1.click('[data-action="show-create-room"]');
        await page1.fill('#create-nickname', 'Player1');
        await page1.click('[data-action="create-room"]');

        // Get room code
        const roomCode = await page1.locator('#room-code-display').textContent();

        // Player 2 joins room
        await page2.goto('/');
        await page2.click('[data-action="show-join-room"]');
        await page2.fill('#join-code', roomCode);
        await page2.fill('#join-nickname', 'Player2');
        await page2.click('[data-action="join-room"]');

        // Verify both see each other
        await expect(page1.locator('.player-list')).toContainText('Player2');
        await expect(page2.locator('.player-list')).toContainText('Player1');

        // Cleanup
        await context1.close();
        await context2.close();
    });
});
```

### Running E2E Tests

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test tests/game-flow.spec.js

# Run in headed mode (see browser)
npx playwright test --headed

# Run with debug mode
npx playwright test --debug

# Generate report
npx playwright show-report
```

## Test Patterns & Best Practices

### Arrange-Act-Assert

```javascript
it('should calculate score correctly', () => {
    // Arrange
    const game = createGameWithRevealedCards(5, 'red');

    // Act
    const score = calculateScore(game, 'red');

    // Assert
    expect(score).toBe(4); // 9 - 5 = 4 remaining
});
```

### Testing Async Code

```javascript
// Using async/await
it('should fetch player data', async () => {
    const player = await playerService.getPlayer('session123');
    expect(player).toBeDefined();
});

// Testing rejections
it('should reject invalid session', async () => {
    await expect(
        playerService.getPlayer('invalid')
    ).rejects.toThrow('Player not found');
});
```

### Mocking Dependencies

```javascript
// Mock entire module
jest.mock('../../config/redis');

// Mock specific function
jest.spyOn(playerService, 'getPlayer').mockResolvedValue(mockPlayer);

// Mock timers
jest.useFakeTimers();
jest.advanceTimersByTime(1000);
jest.useRealTimers();
```

### Testing Error Handling

```javascript
it('should handle Redis connection errors gracefully', async () => {
    mockRedis.get.mockRejectedValue(new Error('Connection refused'));

    const result = await gameService.getGame('TEST01');

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
});
```

## Debugging Tests

### Jest Debug Mode

```bash
# Run specific test with verbose output
npm test -- --verbose gameService.test.js

# Run single test
npm test -- -t "should reveal card"

# Debug with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Playwright Debug Mode

```bash
# Debug mode with inspector
npx playwright test --debug

# Pause on failure
PWDEBUG=1 npx playwright test

# Trace viewer
npx playwright show-trace trace.zip
```

## Continuous Integration

Tests run automatically on every PR and push to main via `.github/workflows/ci.yml`. The CI pipeline includes 6 quality gates:

| Job | Description |
|-----|-------------|
| **Test** | Jest with coverage (Node 20 + 22 matrix) |
| **Typecheck** | `tsc --noEmit` |
| **Lint** | ESLint with `--max-warnings 0` |
| **Security** | `npm audit` (fails on critical vulnerabilities) |
| **Docker** | Build image and verify health endpoint starts |
| **E2E** | Playwright tests against a running server (Chromium) |

Additionally, **CodeQL** runs weekly for automated security scanning (`.github/workflows/codeql.yml`).

## Coverage Reports

### Viewing Coverage

```bash
# Generate HTML report
npm run test:coverage

# Open report
open coverage/lcov-report/index.html
```

### Coverage Thresholds

Configured in `jest.config.ts.js` (primary backend config) and `package.json` (fallback):

```javascript
// jest.config.ts.js - actual enforced thresholds
module.exports = {
    coverageThreshold: {
        global: {
            statements: 75,
            branches: 65,
            functions: 80,
            lines: 75
        }
    }
};
```

Global thresholds are lower because infrastructure modules (redis.ts, socket/index.ts) require real integration tests for meaningful coverage. Business logic modules individually exceed 80%.

## Related Documentation

- [Contributing Guide](../CONTRIBUTING.md)
- [Architecture Overview](ARCHITECTURE.md)
- [Server Specification](SERVER_SPEC.md)
