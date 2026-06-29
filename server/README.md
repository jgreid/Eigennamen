# Eigennamen Online - Server

Real-time multiplayer server for Eigennamen Online, built with Node.js, Socket.io, and Redis.

## Features

- Real-time game synchronization via WebSockets
- Room-based multiplayer with join codes
- Secure spymaster view (card types hidden from guessers)
- Redis for fast in-memory state and pub/sub scaling
- Rate limiting and input validation

## Prerequisites

- Node.js 22+
- Redis 7+ — or set `REDIS_URL=memory` to auto-spawn a temporary one. Note that even memory mode needs a `redis-server` **binary on your PATH**; it is **not bundled** and there is **no native build on Windows** (use Docker there)
- Docker & Docker Compose (optional, but the easiest path on Windows — it includes Redis)

**Windows users:** See the dedicated [Windows Setup Guide](../docs/WINDOWS_SETUP.md) for step-by-step instructions.

## Quick Start

This guide will walk you through getting the Eigennamen server running on your machine. Choose either Docker (easier, recommended) or Manual Setup depending on your preference.

---

### Option 1: Using Docker (Recommended)

Docker packages everything you need into containers, so you don't have to install Redis separately.

#### Step 1: Install Docker

If you don't have Docker installed:
- **Windows/Mac**: Download [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**: Install via your package manager (`apt install docker.io docker-compose-plugin` on Ubuntu/Debian)

Verify Docker is running:
```bash
docker --version
docker compose version
```

#### Step 2: Start the Server

**Windows users:** Simply double-click `start-server.bat` in the server folder!

**All platforms:** From the `server/` directory, run:
```bash
docker compose up -d --build
```

This command:
- Downloads the required images (Node.js, Redis)
- Creates and starts all containers in the background (`-d` = detached mode)
- Sets up networking between containers automatically

#### Step 3: Verify It's Running

Check that all containers are up:
```bash
docker compose ps
```

You should see two services running: `api` and `redis`.

View the server logs:
```bash
docker compose logs -f api
```

Press `Ctrl+C` to stop following logs.

#### Step 4: Test the Server

Open your browser and go to:
- `http://localhost:3000/health` - Should show `{"status":"ok",...}`
- `http://localhost:3000/health/ready` - Shows dependency status

The server is now ready to accept WebSocket connections from the client!

#### Stopping the Server

**Windows users:** Double-click `stop-server.bat` or `check-status.bat` in the server folder.

**All platforms:**
```bash
docker compose down        # Stop containers
docker compose down -v     # Stop and remove data volumes (fresh start)
```

---

### Option 2: Manual Setup

Use this if you prefer to run services directly on your machine without Docker.

#### Prerequisites Explained

| Requirement | What It Does | How to Install |
|-------------|--------------|----------------|
| **Node.js 22+** | Runs the JavaScript server code | [nodejs.org](https://nodejs.org/) or use `nvm` |
| **Redis 7+** | Stores game state in memory for fast access | `brew install redis` (Mac) or `apt install redis-server` (Linux) |

> **Note on `REDIS_URL=memory`:** this avoids running a *separate* Redis, but it is **not "no Redis."** The server spawns a throwaway `redis-server` process for you, so a `redis-server` binary must still be installed on your PATH. **Windows has no native `redis-server`** — Windows users should use Docker (Option 1), which includes Redis, or run Redis via [Memurai](https://www.memurai.com/) / WSL2 and set `REDIS_URL=redis://127.0.0.1:6379` instead.

#### Step 1: Install Node.js Dependencies

Navigate to the server directory and install packages:
```bash
cd server
npm install
```

This reads `package.json` and downloads all required libraries.

#### Step 2: Configure Environment Variables

Copy the example configuration file:
```bash
cp .env.example .env
```

Open `.env` in a text editor and configure:
```bash
# Required: Redis connection (or use REDIS_URL=memory for no Redis)
REDIS_URL=redis://localhost:6379

# Optional: Change the port (default is 3000)
PORT=3000

# Optional: Restrict which domains can connect
CORS_ORIGIN=http://localhost:8080
```

#### Step 3: Start Redis (if using external Redis)

Redis must be running before you start the server (skip if using `REDIS_URL=memory`).

**On Mac (Homebrew):**
```bash
brew services start redis
```

**On Linux:**
```bash
sudo systemctl start redis-server
```

**Verify Redis is running:**
```bash
redis-cli ping
# Should respond: PONG
```

#### Step 4: Start the Server

**For development** (auto-restarts when you change code):
```bash
npm run dev
```

**For production:**
```bash
npm start
```

> **Skipping the `.env` / external Redis?** You can pass `REDIS_URL=memory` inline to auto-spawn a throwaway Redis (requires a `redis-server` binary — see the note above). The syntax depends on your shell:
>
> | Shell | Command |
> |-------|---------|
> | PowerShell (`PS C:\>`) | `$env:REDIS_URL="memory"; npm run dev` |
> | cmd.exe (`C:\>`) | `set REDIS_URL=memory && npm run dev` |
> | Bash / zsh (macOS, Linux, Git Bash, WSL) | `REDIS_URL=memory npm run dev` |
>
> `VAR=value command` is Bash-only — in PowerShell it errors with `'REDIS_URL=memory' is not recognized`.

You should see output like:
```
[INFO] Server listening on port 3000
[INFO] Redis connected
```

#### Step 5: Verify Everything Works

Test these URLs in your browser:

| URL | Expected Result |
|-----|-----------------|
| `http://localhost:3000/health` | `{"status":"ok","timestamp":"..."}` |
| `http://localhost:3000/health/ready` | Shows status of Redis |

---

### Connecting the Client

Once the server is running:

1. Open the client's `index.html` in a browser
2. The client will attempt to connect via WebSocket to `ws://localhost:3000`
3. If using a different host/port, update the client's server URL configuration

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `spawn redis-server ENOENT` (with `REDIS_URL=memory`) | Memory mode needs a `redis-server` binary on PATH. Install Redis (`brew install redis` / `apt install redis-server`), or — on **Windows** — use Docker (Option 1) or point `REDIS_URL` at Memurai/WSL2 Redis. |
| `'REDIS_URL=memory' is not recognized` (PowerShell) | `VAR=value command` is Bash-only. Use `$env:REDIS_URL="memory"; npm run dev` in PowerShell (see the shell table in Step 4). |
| `Could not read package.json` from `npm install` | Run it from the `server/` directory (`cd server` first) — there is no `package.json` at the repo root. |
| "Redis connection refused" | Make sure Redis is running: `redis-cli ping` (or use `REDIS_URL=memory`) |
| "Port 3000 already in use" | Change `PORT` in `.env` or stop the other process using that port |
| "CORS error in browser" | Set `CORS_ORIGIN` in `.env` to your client's URL |
| Docker containers won't start | Run `docker compose logs` to see error messages |

### Running Tests

To verify everything is working correctly:
```bash
npm test              # Run all tests (133 suites, 0 failures)
npm run test:coverage # Run tests with coverage report
npm run test:frontend # Run frontend unit tests (Jest + jsdom)
npm run test:e2e      # Run E2E tests (13 Playwright specs)
```

## Configuration

See `.env.example` for all available configuration options.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `REDIS_URL` | redis://localhost:6379 | Redis connection URL (or `memory` for in-memory mode) |
| `JWT_SECRET` | - | Secret for JWT signing |
| `CORS_ORIGIN` | * | Allowed CORS origins |

## API Documentation

See [SERVER_SPEC.md](../docs/SERVER_SPEC.md) for full API documentation.

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rooms/:code/exists` | Check if room exists |
| GET | `/api/rooms/:code` | Get room info |
| GET | `/api/replays/:roomCode/:gameId` | Get replay data |
| GET | `/health` | Basic health check |
| GET | `/health/ready` | Readiness check with dependency status |
| GET | `/health/live` | Kubernetes liveness probe |
| GET | `/metrics` | Server metrics (uptime, memory, connections) |

### WebSocket Events

**Room Events:**
- `room:create` - Create new room
- `room:join` - Join existing room
- `room:leave` - Leave room
- `room:settings` - Update settings

**Game Events:**
- `game:start` - Start new game
- `game:reveal` - Reveal a card
- `game:clue` - Give a clue
- `game:endTurn` - End current turn
- `game:forfeit` - Forfeit the game
- `game:history` - Get game history

**Player Events:**
- `player:setTeam` - Join a team
- `player:setRole` - Set role (spymaster/guesser/spectator)
- `player:setNickname` - Update nickname

## Project Structure

```
server/
├── src/
│   ├── index.ts          # Entry point
│   ├── app.ts            # Express configuration
│   ├── config/           # Configuration (13 modules, constants.ts re-exports all)
│   ├── errors/           # GameError hierarchy
│   ├── middleware/        # Express & Socket middleware
│   ├── routes/           # REST API routes
│   ├── services/         # Business logic (6 services + sub-modules)
│   │   ├── game/         # Game sub-modules (board, reveal, lua)
│   │   ├── gameHistory/  # Game history sub-modules (types, validation, storage, replayEngine)
│   │   ├── player/       # Player sub-modules (cleanup, mutations, queries, reconnection)
│   │   └── room/         # Room sub-module (membership)
│   ├── socket/           # Socket.io setup
│   │   └── handlers/     # Event-specific handlers (9 files)
│   ├── frontend/         # Frontend TypeScript source (55 modules)
│   ├── shared/           # Shared code between frontend and backend
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utilities (metrics, logging, locks, etc.)
│   ├── validators/       # Zod validation schemas
│   ├── scripts/          # Redis Lua scripts (27 atomic operations)
│   └── __tests__/        # Jest tests (133 suites)
├── e2e/                  # Playwright E2E tests (13 specs)
├── Dockerfile
└── package.json
```

**Note:** `docker-compose.yml` and `fly.toml` are in the repository root directory.

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Type check
npm run typecheck
```

## Scaling

The server supports horizontal scaling via:

1. **Redis Pub/Sub** - Socket.io events are broadcast across instances
2. **Sticky Sessions** - Configure your load balancer for WebSocket affinity

See the [SERVER_SPEC.md](../docs/SERVER_SPEC.md) for detailed scaling considerations.

## License

GNU General Public License v3.0
