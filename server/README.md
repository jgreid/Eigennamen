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

## Quick Start

### Using Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api
```

The server will be available at `http://localhost:3000`

### Manual Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start Redis** (required)
   ```bash
   redis-server
   ```

4. **Start PostgreSQL** (optional, for persistence)
   ```bash
   # Set up database
   npx prisma migrate dev
   ```

5. **Start the server**
   ```bash
   # Development (with hot reload)
   npm run dev

   # Production
   npm start
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
| GET | `/health` | Health check |

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

**Player Events:**
- `player:setTeam` - Join a team
- `player:setRole` - Set role (spymaster/guesser)

## Project Structure

```
server/
├── src/
│   ├── index.js          # Entry point
│   ├── app.js            # Express configuration
│   ├── config/           # Configuration files
│   ├── middleware/       # Express & Socket middleware
│   ├── routes/           # REST API routes
│   ├── services/         # Business logic
│   ├── socket/           # Socket.io handlers
│   ├── utils/            # Utilities
│   └── validators/       # Input validation schemas
├── prisma/
│   └── schema.prisma     # Database schema
├── Dockerfile
├── docker-compose.yml
└── package.json
```

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
