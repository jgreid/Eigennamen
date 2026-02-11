# Codenames Online - Server

Real-time multiplayer server for Codenames Online, built with Node.js, Socket.io, Redis, and PostgreSQL.

## Features

- Real-time game synchronization via WebSockets
- Room-based multiplayer with join codes
- Secure spymaster view (card types hidden from guessers)
- Redis for fast in-memory state and pub/sub scaling
- PostgreSQL for persistence and game history
- Rate limiting and input validation

## Prerequisites

- Node.js 18+
- Redis 7+
- PostgreSQL 15+ (optional, for persistence)
- Docker & Docker Compose (optional)

**Windows users:** See the dedicated [Windows Setup Guide](../docs/WINDOWS_SETUP.md) for step-by-step instructions.

## Quick Start

This guide will walk you through getting the Codenames server running on your machine. Choose either Docker (easier, recommended) or Manual Setup depending on your preference.

---

### Option 1: Using Docker (Recommended)

Docker packages everything you need into containers, so you don't have to install Redis or PostgreSQL separately.

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
- Downloads the required images (Node.js, Redis, PostgreSQL)
- Creates and starts all containers in the background (`-d` = detached mode)
- Sets up networking between containers automatically

#### Step 3: Verify It's Running

Check that all containers are up:
```bash
docker compose ps
```

You should see three services running: `api`, `redis`, and `postgres`.

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
| **Node.js 18+** | Runs the JavaScript server code | [nodejs.org](https://nodejs.org/) or use `nvm` |
| **Redis 7+** | Stores game state in memory for fast access | `brew install redis` (Mac) or `apt install redis-server` (Linux) |
| **PostgreSQL 15+** | Stores persistent data (game history, word lists) | [postgresql.org](https://www.postgresql.org/download/) or `apt install postgresql` |

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
# Required: Redis connection
REDIS_URL=redis://localhost:6379

# Required for persistence: PostgreSQL connection
DATABASE_URL=postgresql://username:password@localhost:5432/codenames

# Optional: Change the port (default is 3000)
PORT=3000

# Optional: Restrict which domains can connect
CORS_ORIGIN=http://localhost:8080
```

#### Step 3: Start Redis

Redis must be running before you start the server.

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

#### Step 4: Set Up PostgreSQL (Optional but Recommended)

If you want persistent game history and custom word lists:

1. **Create a database:**
   ```bash
   createdb codenames
   ```

2. **Run database migrations:**
   ```bash
   npx prisma migrate dev
   ```
   This creates all the tables defined in `prisma/schema.prisma`.

3. **Verify with Prisma Studio (optional):**
   ```bash
   npm run db:studio
   ```
   Opens a web UI at `http://localhost:5555` to browse your database.

#### Step 5: Start the Server

**For development** (auto-restarts when you change code):
```bash
npm run dev
```

**For production:**
```bash
npm start
```

You should see output like:
```
[INFO] Server listening on port 3000
[INFO] Redis connected
[INFO] Database connected
```

#### Step 6: Verify Everything Works

Test these URLs in your browser:

| URL | Expected Result |
|-----|-----------------|
| `http://localhost:3000/health` | `{"status":"ok","timestamp":"..."}` |
| `http://localhost:3000/health/ready` | Shows status of Redis and PostgreSQL |
| `http://localhost:3000/api/health` | `{"status":"ok","timestamp":"..."}` |

---

### Connecting the Client

Once the server is running:

1. Open the client's `index.html` in a browser
2. The client will attempt to connect via WebSocket to `ws://localhost:3000`
3. If using a different host/port, update the client's server URL configuration

### Troubleshooting

| Problem | Solution |
|---------|----------|
| "Redis connection refused" | Make sure Redis is running: `redis-cli ping` |
| "Database connection failed" | Check `DATABASE_URL` in `.env` and ensure PostgreSQL is running |
| "Port 3000 already in use" | Change `PORT` in `.env` or stop the other process using that port |
| "CORS error in browser" | Set `CORS_ORIGIN` in `.env` to your client's URL |
| Docker containers won't start | Run `docker compose logs` to see error messages |

### Running Tests

To verify everything is working correctly:
```bash
npm test              # Run all backend tests (2,308+)
npm run test:coverage # Run tests with coverage report
npm run test:frontend # Run frontend unit tests (303)
```

## Configuration

See `.env.example` for all available configuration options.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `REDIS_URL` | redis://localhost:6379 | Redis connection URL |
| `DATABASE_URL` | - | PostgreSQL connection URL |
| `JWT_SECRET` | - | Secret for JWT signing |
| `CORS_ORIGIN` | * | Allowed CORS origins |

## API Documentation

See [SERVER_SPEC.md](../docs/SERVER_SPEC.md) for full API documentation.

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rooms/:code/exists` | Check if room exists |
| GET | `/api/rooms/:code` | Get room info |
| GET | `/api/wordlists` | List public word lists (with optional search) |
| GET | `/api/wordlists/:id` | Get a specific word list |
| POST | `/api/wordlists` | Create a new word list |
| PUT | `/api/wordlists/:id` | Update a word list |
| DELETE | `/api/wordlists/:id` | Delete a word list |
| GET | `/api/health` | API health check |
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
│   ├── config/           # Configuration files (13 modules)
│   ├── errors/           # Custom error classes
│   ├── middleware/        # Express & Socket middleware
│   ├── routes/           # REST API routes
│   ├── services/         # Business logic (7 services)
│   ├── socket/           # Socket.io setup
│   │   └── handlers/     # Event-specific handlers (5 files)
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utilities (metrics, logging, locks, etc.)
│   ├── validators/       # Zod validation schemas
│   ├── scripts/          # Redis Lua scripts for atomic operations
│   └── __tests__/        # Jest tests (80+ files)
├── e2e/                  # Playwright E2E tests
├── prisma/
│   └── schema.prisma     # Database schema
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

# Database migrations
npm run db:migrate

# Prisma Studio (database GUI)
npm run db:studio
```

## Scaling

The server supports horizontal scaling via:

1. **Redis Pub/Sub** - Socket.io events are broadcast across instances
2. **Sticky Sessions** - Configure your load balancer for WebSocket affinity

See the [SERVER_SPEC.md](../docs/SERVER_SPEC.md) for detailed scaling considerations.

## License

GNU General Public License v3.0
