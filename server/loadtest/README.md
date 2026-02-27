# Load Testing

Performance and load testing scripts for Eigennamen Online.

This directory contains two types of load tests:
- **k6 scripts** (`room-flow.js`, `websocket-game.js`) for high-concurrency HTTP/WebSocket benchmarking
- **Node.js scripts** (`stress-test.js`, `memory-leak-test.js`) for Socket.io-native testing and memory analysis

## Prerequisites

### k6 (for room-flow.js and websocket-game.js)

Install k6:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Docker
docker run --rm -i grafana/k6 run - <script.js
```

### Node.js (for stress-test.js and memory-leak-test.js)

These scripts use `socket.io-client` which is already in devDependencies. Ensure dependencies are installed:

```bash
cd server && npm install
```

## Test Scripts

### room-flow.js -- HTTP API Load Test (k6)

Tests room existence checks and info retrieval under load using k6 virtual users.

```bash
# Run with default settings (localhost:3000)
k6 run loadtest/room-flow.js

# Run against staging
k6 run -e BASE_URL=https://eigennamen-staging.fly.dev loadtest/room-flow.js
```

**Scenarios:**
- `room_checks`: Ramping VUs (0 -> 50 -> 100 -> 200 -> 0) performing room existence and info checks
- `health_monitor`: 5 constant VUs performing health checks for the full duration

**Thresholds:**

| Metric | Threshold |
|--------|-----------|
| Room exists check | p95 < 50ms |
| Room info fetch | p95 < 100ms |
| Health check | p95 < 50ms |
| Error rate | < 10 total |

---

### websocket-game.js -- WebSocket Game Simulation (k6)

Simulates concurrent WebSocket connections performing full game flows and chat traffic using raw Engine.IO/Socket.io protocol over k6 WebSockets.

```bash
# Run with default settings
k6 run loadtest/websocket-game.js

# Run with custom WebSocket URL
k6 run -e WS_URL=ws://localhost:3000 loadtest/websocket-game.js
```

**Scenarios:**
- `game_flow`: Ramping VUs (0 -> 50 -> 200 -> 500 -> 500 -> 0) creating rooms, assigning teams, starting games, revealing cards
- `chat_flood`: 50 constant VUs sending bursts of chat messages (starts 30s in)

**Thresholds:**

| Metric | Threshold |
|--------|-----------|
| WebSocket connect | p95 < 500ms |
| Message latency | p95 < 200ms |
| Room creation | p95 < 500ms |
| Game action latency | p95 < 100ms |
| Error rate | < 100 total |

---

### stress-test.js -- Socket.io Stress Test (Node.js)

Simulates multiple concurrent players using the native `socket.io-client` library. Connects clients, creates/joins rooms, and performs sustained game actions (team switching, role changes, resyncs). Reports detailed latency percentiles and error summaries.

```bash
# Run with default settings (50 clients, 10 rooms, 60s duration)
node loadtest/stress-test.js

# Or via npm script
npm run loadtest

# Custom configuration
node loadtest/stress-test.js --clients=100 --rooms=20 --duration=120 --ramp-up=15

# Against a remote server
node loadtest/stress-test.js --url=https://eigennamen-staging.fly.dev --clients=200
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--clients=N` | 50 | Number of concurrent Socket.io clients |
| `--rooms=N` | 10 | Number of rooms to create (clients distributed across rooms) |
| `--duration=N` | 60 | Test duration in seconds (sustained load phase) |
| `--ramp-up=N` | 10 | Ramp-up time in seconds (stagger connection creation) |
| `--url=URL` | `http://localhost:3000` | Server URL |

**Phases:**
1. **Ramp-up**: Gradually connects clients and creates/joins rooms
2. **Sustain**: Each connected client performs actions (set team, set role, resync) every second
3. **Wind-down**: Disconnects all clients

**Metrics reported:**
- Connection success/failure counts and rate
- Event send/receive counts and rate
- Latency: min, max, avg, P50, P95, P99
- Error summary with counts per unique error message

---

### memory-leak-test.js -- Memory Leak Detection (Node.js)

Repeatedly creates rooms with two players, then tears them down, monitoring server heap usage via the `/health/metrics` endpoint. Detects memory growth that could indicate leaks in room lifecycle management.

```bash
# Run with default settings (100 iterations)
node loadtest/memory-leak-test.js

# Or via npm script
npm run loadtest:memory

# More iterations for thorough testing
node loadtest/memory-leak-test.js --iterations=500

# Against a remote server
node loadtest/memory-leak-test.js --url=https://eigennamen-staging.fly.dev
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--iterations=N` | 100 | Number of create/destroy room cycles |
| `--url=URL` | `http://localhost:3000` | Server URL |

**How it works:**
1. Takes a baseline memory snapshot from `/health/metrics`
2. For each iteration: creates a room (host socket), joins a second player, both leave, both disconnect
3. Samples heap usage every 10 iterations
4. Reports all memory snapshots and total growth
5. Exits with code 1 if memory grows by more than 50 MB (configurable threshold)

**Interpreting results:**
- Stable or slowly growing heap: normal (GC cycles, caching)
- Steady linear growth: possible leak in room/player cleanup
- Sudden jumps: may indicate large allocations not being freed

## Performance Targets

From production requirements:

| Scenario | Target | How to Test |
|----------|--------|-------------|
| Concurrent rooms | 1,000+ | room-flow.js with 200 VUs |
| Concurrent connections | 5,000+ | websocket-game.js with 1000 VUs |
| Card reveal latency | < 40ms | websocket-game.js message latency |
| Room creation latency | < 100ms | room-flow.js room check |
| Health check latency | < 50ms | room-flow.js health monitor |
| Socket.io connection | < 10s | stress-test.js connection metrics |
| Memory stability | < 50MB growth over 100 cycles | memory-leak-test.js |

## npm Scripts

Two convenience scripts are available from the `server/` directory:

```bash
# Run the stress test with default settings
npm run loadtest

# Run the memory leak test with default settings
npm run loadtest:memory
```

## CI Integration

Load tests should run on schedule (not every PR) to avoid slowing CI:

```yaml
# .github/workflows/loadtest.yml (example)
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly on Monday at 6 AM
  workflow_dispatch:       # Manual trigger

jobs:
  loadtest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # k6 tests
      - uses: grafana/k6-action@v0.3.1
        with:
          filename: server/loadtest/room-flow.js
        env:
          BASE_URL: https://eigennamen-staging.fly.dev

      # Node.js tests (requires running server)
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: cd server && npm ci
      - run: cd server && REDIS_URL=memory npm run dev &
      - run: sleep 5 && cd server && npm run loadtest -- --clients=50 --duration=30
      - run: cd server && npm run loadtest:memory -- --iterations=50
```

## Interpreting Results

### k6 output

k6 outputs summary statistics after each run:

```
checks.........................: 100.00%  1500   0
http_req_duration..............: avg=12ms min=2ms med=8ms max=95ms p(90)=25ms p(95)=35ms
room_check_latency.............: avg=8ms  min=2ms med=5ms max=45ms p(90)=15ms p(95)=22ms
```

Key metrics to watch:
- **p95 latency**: 95th percentile response time (should be under threshold)
- **error rate**: Failed checks (should be near 0)
- **http_reqs**: Total requests per second (throughput)
- **vus**: Virtual users (concurrent connections)

### stress-test.js output

```
=== Load Test Results ===
Duration: 72.3s

Connections:
  Successful: 50
  Failed: 0
  Rate: 0.7/s

Events:
  Sent: 3000
  Received: 50
  Rate: 41.5 sent/s

Latency (ms):
  Min: 2.1
  Max: 245.3
  Avg: 18.7
  P50: 12.4
  P95: 65.2
  P99: 142.8

========================
```

### memory-leak-test.js output

```
=== Memory Snapshots ===
  Iteration 0: 45.2 MB heap
  Iteration 10: 46.1 MB heap
  Iteration 20: 46.3 MB heap
  ...
  Iteration 100: 47.8 MB heap

Memory growth: +2.6 MB
Memory growth within acceptable range
```
