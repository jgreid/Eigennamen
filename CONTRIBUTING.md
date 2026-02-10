# Contributing to Codenames Online

Thank you for your interest in contributing to Codenames Online! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)
- [Documentation](#documentation)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Report issues responsibly

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Docker (optional, for full local setup)
- Git

### Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/jgreid/Risley-Codenames.git
   cd Risley-Codenames
   ```

2. **Install dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Start development server**
   ```bash
   # Without Docker (uses in-memory storage)
   REDIS_URL=memory npm run dev

   # With Docker (full stack)
   cd ..
   docker compose up -d --build
   ```

4. **Run tests**
   ```bash
   cd server
   npm test
   ```

5. **Open the game**
   Navigate to `http://localhost:3000`

## Development Workflow

### Branch Strategy

```
main                 # Production-ready code
├── feature/name     # New features
├── fix/name         # Bug fixes
├── refactor/name    # Code improvements
└── docs/name        # Documentation changes
```

### Creating a Feature Branch

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### Making Changes

1. Write code following our [code standards](#code-standards)
2. Add tests for new functionality
3. Update documentation if needed
4. Run the full test suite before committing

## Code Standards

### File Naming

| Type | Convention | Example |
|------|------------|---------|
| Services | camelCase | `gameService.ts` |
| Handlers | camelCase | `roomHandlers.ts` |
| Tests | camelCase + `.test.ts` | `gameService.test.ts` |
| Constants | SCREAMING_SNAKE_CASE | `ERROR_CODES` |

### JavaScript Style

```javascript
// Good: Use const/let, never var
const roomCode = generateRoomCode();
let playerCount = 0;

// Good: Async/await over callbacks
async function getPlayer(sessionId) {
    const player = await redis.get(`player:${sessionId}`);
    return JSON.parse(player);
}

// Good: Descriptive function names
function calculateRemainingCards(game, team) { ... }

// Good: Early returns for validation
function revealCard(game, index) {
    if (game.gameOver) return null;
    if (index < 0 || index >= 25) return null;
    // ... rest of logic
}
```

### Architecture Patterns

1. **Services handle business logic**
   ```javascript
   // server/src/services/gameService.ts
   async function revealCard(roomCode, index, player) {
       // All game logic here
   }
   ```

2. **Handlers handle I/O**
   ```javascript
   // server/src/socket/handlers/gameHandlers.ts
   socket.on('game:reveal', async (data) => {
       // Validate, call service, emit response
   });
   ```

3. **Validators at entry points**
   ```javascript
   // server/src/validators/schemas.ts
   const revealCardSchema = z.object({
       index: z.number().int().min(0).max(24)
   });
   ```

### Error Handling

```javascript
// Use typed errors
const { GameError, ValidationError } = require('../errors/GameError');

// Throw with error codes
throw new GameError(ERROR_CODES.ROOM_NOT_FOUND, 'Room does not exist');

// Handle in handlers
try {
    const result = await gameService.revealCard(roomCode, index);
    socket.emit('game:cardRevealed', result);
} catch (error) {
    socket.emit('game:error', {
        code: error.code || ERROR_CODES.SERVER_ERROR,
        message: error.message
    });
}
```

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change, no new feature or fix |
| `test` | Adding/updating tests |
| `chore` | Build, tooling, dependencies |

### Examples

```bash
# Feature
git commit -m "feat(game): add turn timer with pause/resume"

# Bug fix
git commit -m "fix(room): prevent duplicate player joins"

# Documentation
git commit -m "docs: update API documentation"

# Refactor
git commit -m "refactor(services): extract timer logic to separate module"
```

## Pull Request Process

### Before Submitting

1. **Run all tests**
   ```bash
   cd server
   npm test
   npm run lint
   ```

2. **Check coverage**
   ```bash
   npm run test:coverage
   # Ensure coverage meets thresholds (80%+)
   ```

3. **Update documentation**
   - Update relevant docs if behavior changes
   - Add JSDoc comments for new functions

### PR Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
How were changes tested?

## Checklist
- [ ] Tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. Submit PR against `main`
2. Automated tests run
3. Reviewer provides feedback
4. Address feedback, push updates
5. Reviewer approves
6. Squash and merge

## Testing Requirements

### Coverage Thresholds

Configured in `jest.config.ts.js`. Thresholds are set lower globally because infrastructure modules (redis.ts, memoryStorage.ts, socket/index.ts) require real integration tests for meaningful coverage. Business logic modules individually exceed 80%.

| Metric | Minimum |
|--------|---------|
| Statements | 75% |
| Branches | 65% |
| Functions | 80% |
| Lines | 75% |

### Test Categories

```bash
# Unit tests (Jest)
npm test

# Unit tests with coverage
npm run test:coverage

# Watch mode during development
npm run test:watch

# E2E tests (Playwright)
npx playwright test
```

### Writing Tests

```javascript
// server/src/__tests__/gameService.test.ts
describe('gameService', () => {
    describe('revealCard', () => {
        it('should reveal card and update game state', async () => {
            // Arrange
            const game = createTestGame();

            // Act
            const result = await gameService.revealCard('TEST01', 0, mockPlayer);

            // Assert
            expect(result.revealed).toBe(true);
            expect(result.type).toBeDefined();
        });

        it('should reject if game is over', async () => {
            // ...
        });
    });
});
```

See [Testing Guide](docs/TESTING_GUIDE.md) for detailed information.

## Documentation

### When to Update Docs

- New features: Update relevant docs
- API changes: Update SERVER_SPEC.md
- Architecture changes: Update ARCHITECTURE.md
- New configuration: Update CLAUDE.md

### Documentation Locations

| Document | Purpose |
|----------|---------|
| `README.md` | Project overview, gameplay |
| `CLAUDE.md` | AI assistant guide, quick reference |
| `QUICKSTART.md` | Getting started guide |
| `ROADMAP.md` | Development roadmap and remaining work |
| `docs/ARCHITECTURE.md` | System architecture |
| `docs/SERVER_SPEC.md` | API specification |
| `docs/TESTING_GUIDE.md` | Testing documentation |
| `docs/DEPLOYMENT.md` | Deployment guide |

### JSDoc Comments

```javascript
/**
 * Reveal a card on the game board
 * @param {string} roomCode - The room code
 * @param {number} index - Card index (0-24)
 * @param {Object} player - Player revealing the card
 * @returns {Promise<{type: string, gameOver: boolean}>}
 * @throws {GameError} If game is over or card already revealed
 */
async function revealCard(roomCode, index, player) {
    // ...
}
```

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue
- **Security**: Email maintainers directly

## License

By contributing, you agree that your contributions will be licensed under the GPL v3.0 License.

---

Thank you for contributing!
