# Quick-Start Contributor Guide

Get from clone to pull request in under 10 minutes.

## 1. Setup

```bash
git clone https://github.com/jgreid/Eigennamen.git
cd Eigennamen/server
npm install
```

## 2. Run

```bash
# No Docker required — in-memory Redis
REDIS_URL=memory npm run dev
# Open http://localhost:3000
```

## 3. Verify

```bash
npm test              # All tests (backend + frontend)
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # TypeScript
```

All four must pass before submitting a PR.

## 4. Code

**Where things live** (all paths from `server/src/`):

| I want to... | Look in |
|---------------|---------|
| Add a socket event | `config/socketConfig.ts` → `validators/` → `socket/handlers/` → `frontend/handlers/` |
| Add a REST endpoint | `routes/` → `validators/` → `services/` → `config/swagger.ts` |
| Change game rules | `config/gameConfig.ts` → `services/gameService.ts` |
| Fix a frontend bug | `frontend/` (TypeScript compiled via esbuild) |
| Add/fix a test | `__tests__/` (mirrors `src/` structure) |

See [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) for a full worked example.

**Patterns to follow:**
- Validate all input with Zod schemas (`validators/`)
- Put business logic in services, not handlers
- Throw `GameError` subclasses for failures — never plain `Error`
- Use `safeEmit` for all socket emissions
- Use Lua scripts (`scripts/`) for multi-step Redis operations

## 5. Format

```bash
npm run format        # Auto-fix formatting
```

Prettier handles all formatting (4-space indent, single quotes, 120 char width). ESLint handles logic rules only.

## 6. Commit

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat(game): add turn timer with pause/resume"
git commit -m "fix(room): prevent duplicate player joins"
git commit -m "test(chat): add spectator message tests"
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## 7. Submit

```bash
git push origin feature/your-feature-name
# Open PR against main
```

**PR checklist:**
- [ ] `npm test` passes
- [ ] `npm run lint` clean
- [ ] `npm run format:check` clean
- [ ] Tests added for new/changed behavior
- [ ] Docs updated if behavior changed

## Key References

| Document | When to read it |
|----------|----------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Full contributor guidelines, code standards, error handling conventions |
| [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) | Step-by-step walkthrough of adding a socket event |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, service layer |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Test patterns, mocking Redis, coverage thresholds |
| [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) | REST API + WebSocket event reference |
| [CLAUDE.md](CLAUDE.md) | AI assistant quick reference for the whole codebase |
