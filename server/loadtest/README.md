# Load Testing

Performance and load testing scripts for Codenames Online using [k6](https://k6.io/).

## Prerequisites

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

## Test Scripts

### room-flow.js — HTTP API Load Test
Tests room existence checks and info retrieval under load.

```bash
# Run with default settings (localhost:3000)
k6 run loadtest/room-flow.js

# Run against staging
k6 run -e BASE_URL=https://codenames-staging.fly.dev loadtest/room-flow.js
```

**Targets:**
| Metric | Threshold |
|--------|-----------|
| Room exists check | p95 < 50ms |
| Room info fetch | p95 < 100ms |
| Health check | p95 < 50ms |
| Error rate | < 10 total |

### websocket-game.js — WebSocket Connection Test
Simulates concurrent WebSocket connections creating rooms.

```bash
# Run with default settings
k6 run loadtest/websocket-game.js

# Run with custom WebSocket URL
k6 run -e WS_URL=ws://localhost:3000 loadtest/websocket-game.js
```

**Targets:**
| Metric | Threshold |
|--------|-----------|
| WebSocket connect | p95 < 500ms |
| Message latency | p95 < 100ms |
| Error rate | < 50 total |

## Performance Targets

From production requirements:

| Scenario | Target | How to Test |
|----------|--------|-------------|
| Concurrent rooms | 1,000+ | room-flow.js with 200 VUs |
| Concurrent connections | 5,000+ | websocket-game.js with 1000 VUs |
| Card reveal latency | < 40ms | websocket-game.js message latency |
| Room creation latency | < 100ms | room-flow.js room check |
| Health check latency | < 50ms | room-flow.js health monitor |

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
      - uses: grafana/k6-action@v0.3.1
        with:
          filename: server/loadtest/room-flow.js
        env:
          BASE_URL: https://codenames-staging.fly.dev
```

## Interpreting Results

k6 outputs summary statistics after each run:

```
✓ room exists returns 200
✓ room exists has valid body
✓ health returns 200

checks.........................: 100.00% ✓ 1500  ✗ 0
http_req_duration..............: avg=12ms min=2ms med=8ms max=95ms p(90)=25ms p(95)=35ms
room_check_latency.............: avg=8ms  min=2ms med=5ms max=45ms p(90)=15ms p(95)=22ms
```

Key metrics to watch:
- **p95 latency**: 95th percentile response time (should be under threshold)
- **error rate**: Failed checks (should be near 0)
- **http_reqs**: Total requests per second (throughput)
- **vus**: Virtual users (concurrent connections)
