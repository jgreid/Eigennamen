# Backup and Disaster Recovery

This document defines the backup strategy, recovery procedures, and operational runbooks for Codenames Online infrastructure. It covers all deployment modes: single-instance (memory mode), Docker Compose (local/staging), and Fly.io (production).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Redis Backup Strategy](#2-redis-backup-strategy)
3. [PostgreSQL Backup Strategy](#3-postgresql-backup-strategy)
4. [Recovery Procedures](#4-recovery-procedures)
5. [RTO/RPO Targets](#5-rtorpo-targets)
6. [Monitoring and Alerting](#6-monitoring-and-alerting)
7. [Runbook for Common Issues](#7-runbook-for-common-issues)

---

## 1. Overview

### Data Stores and What Lives Where

| Store | Data | Persistence | Required |
|-------|------|-------------|----------|
| **Redis** | Active rooms, players, game state, timers, distributed locks, session-socket mappings, reconnection tokens | Ephemeral (TTL-based) | Yes (or memory-mode fallback) |
| **PostgreSQL** | Users, game history, word lists, game participants, audit logs, room records | Persistent | No (optional) |
| **Filesystem** | Application code, static assets, Lua scripts, locale files | Immutable (deployed via container image) | Yes |

### Data Lifecycle

- **Redis game state is ephemeral by design.** Rooms expire via TTL: 4 hours in memory mode, 24 hours with external Redis (configured in `server/src/config/roomConfig.ts`). A typical Codenames game lasts 30-60 minutes.
- **PostgreSQL stores long-lived data** that survives server restarts: user accounts, completed game history, custom word lists, and audit logs.
- **The application itself is stateless.** Any instance can be rebuilt from the container image and environment variables.

### Deployment Modes

| Mode | Redis | PostgreSQL | Typical Use |
|------|-------|------------|-------------|
| **Single instance** (`REDIS_URL=memory`) | Embedded redis-server process (no persistence, `--save "" --appendonly no`) | Not configured | Local development, quick demos |
| **Docker Compose** | `redis:7-alpine` with AOF enabled (`--appendonly yes`), data on `redis_data` volume | `postgres:15-alpine` on `postgres_data` volume | Local development, staging |
| **Fly.io** | Fly Redis (Upstash) or `REDIS_URL=memory` | Fly Postgres or external (optional) | Production |

---

## 2. Redis Backup Strategy

### 2.1 Understanding Redis Persistence

Redis supports two persistence mechanisms:

- **RDB (Redis Database) snapshots**: Point-in-time snapshots written to `dump.rdb`. Fast to restore but data between snapshots is lost.
- **AOF (Append Only File)**: Logs every write operation. More durable but larger files and slower restarts.

### 2.2 Docker Compose Configuration

The project's `docker-compose.yml` already enables AOF persistence:

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
  volumes:
    - redis_data:/data
```

**Backup the Docker volume:**

```bash
# Stop writes (optional but ensures consistency)
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" BGSAVE
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" BGREWRITEAOF

# Wait for background save to complete
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" LASTSAVE

# Copy data from the volume
docker run --rm \
  -v eigennamen_redis_data:/data \
  -v "$(pwd)/backups":/backup \
  alpine tar czf /backup/redis-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

**Adding RDB snapshots (recommended for staging):**

Override the Redis command to enable periodic snapshots alongside AOF:

```yaml
redis:
  command: >-
    redis-server
    --appendonly yes
    --requirepass ${REDIS_PASSWORD}
    --save 900 1
    --save 300 10
    --save 60 10000
```

This saves an RDB snapshot if at least 1 key changed in 900 seconds, 10 keys in 300 seconds, or 10000 keys in 60 seconds.

### 2.3 Fly.io Redis Backup

If using Fly Redis (Upstash):

```bash
# Check Redis status
fly redis status <redis-app-name>

# Upstash provides automatic daily backups
# Access the Upstash console for backup management:
fly redis dashboard <redis-app-name>
```

If running with `REDIS_URL=memory` on Fly.io (the current default per `fly.toml`), there is **no persistence**. All game state is lost on machine restart. This is acceptable because:
- Game rooms have a 4-hour TTL in memory mode
- Games typically last 30-60 minutes
- Players can simply create a new room

### 2.4 When Full Redis Backup Is Not Needed

For most deployments, full Redis backup is unnecessary because:

1. **Game state is inherently ephemeral.** Rooms, players, timers, and locks all have TTLs (see `server/src/config/roomConfig.ts`):
   - Room/player data: 4h (memory) or 24h (Redis)
   - Session-socket mapping: 5 minutes
   - Disconnected player grace period: 10 minutes
   - Reconnection tokens: 5 minutes
2. **No user-critical data lives solely in Redis** when PostgreSQL is enabled.
3. **Players expect interruptions** in a casual game. Reconnection logic handles brief outages.

**Exception**: If you run without PostgreSQL and rely on Redis for game history or word lists (via services that cache to Redis), then Redis persistence becomes more important.

---

## 3. PostgreSQL Backup Strategy

### 3.1 Database Schema Overview

The Prisma schema (`server/prisma/schema.prisma`) defines five tables:

| Table | Data | Criticality |
|-------|------|-------------|
| `users` | User accounts, stats (games played/won) | High |
| `rooms` | Room records with settings, host, expiry | Medium (ephemeral) |
| `games` | Game boards, scores, clues, outcomes | Medium |
| `word_lists` | Custom word lists (user-created content) | High |
| `game_participants` | Per-game player records (team, role, nickname) | Low |

### 3.2 Manual Backup with pg_dump

**Docker Compose:**

```bash
# Full database dump (custom format, compressed)
docker compose exec db pg_dump \
  -U codenames \
  -d codenames \
  -Fc \
  -f /tmp/codenames-backup.dump

# Copy dump out of container
docker compose cp db:/tmp/codenames-backup.dump \
  ./backups/codenames-$(date +%Y%m%d-%H%M%S).dump

# SQL format (human-readable, useful for debugging)
docker compose exec db pg_dump \
  -U codenames \
  -d codenames \
  --clean \
  --if-exists \
  > ./backups/codenames-$(date +%Y%m%d-%H%M%S).sql
```

**Direct connection (non-Docker):**

```bash
pg_dump \
  -h localhost \
  -U codenames \
  -d codenames \
  -Fc \
  -f ./backups/codenames-$(date +%Y%m%d-%H%M%S).dump
```

**Selective backup (high-value tables only):**

```bash
# Back up only user data and word lists
docker compose exec db pg_dump \
  -U codenames \
  -d codenames \
  -Fc \
  -t users \
  -t word_lists \
  -f /tmp/codenames-critical.dump
```

### 3.3 Automated Backup Script

Create a cron job for regular backups:

```bash
#!/bin/bash
# scripts/backup-postgres.sh
set -euo pipefail

BACKUP_DIR="./backups/postgres"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# Create backup
docker compose exec -T db pg_dump \
  -U codenames \
  -d codenames \
  -Fc \
  > "$BACKUP_DIR/codenames-$TIMESTAMP.dump"

# Verify backup is non-empty
if [ ! -s "$BACKUP_DIR/codenames-$TIMESTAMP.dump" ]; then
  echo "ERROR: Backup file is empty" >&2
  exit 1
fi

echo "Backup created: $BACKUP_DIR/codenames-$TIMESTAMP.dump"

# Prune old backups
find "$BACKUP_DIR" -name "codenames-*.dump" -mtime +$RETENTION_DAYS -delete
echo "Pruned backups older than $RETENTION_DAYS days"
```

Add to crontab for hourly backups:

```
0 * * * * /path/to/Eigennamen/scripts/backup-postgres.sh >> /var/log/codenames-backup.log 2>&1
```

### 3.4 WAL Archiving for Point-in-Time Recovery

For production deployments where RPO matters, enable WAL (Write-Ahead Log) archiving:

**PostgreSQL configuration (postgresql.conf):**

```
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
archive_timeout = 300   # Force a WAL switch every 5 minutes
```

**Docker Compose override (docker-compose.prod.yml):**

```yaml
services:
  db:
    command: >-
      postgres
      -c wal_level=replica
      -c archive_mode=on
      -c archive_command='cp %p /var/lib/postgresql/data/wal_archive/%f'
      -c archive_timeout=300
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - postgres_wal_archive:/var/lib/postgresql/data/wal_archive
```

### 3.5 Fly.io PostgreSQL Backup

If using Fly Postgres:

```bash
# List available backups
fly postgres backup list -a <postgres-app-name>

# Create an on-demand backup
fly postgres backup create -a <postgres-app-name>

# Restore from a backup (creates new database cluster)
fly postgres backup restore <backup-id> -a <postgres-app-name>
```

Fly Postgres provides automatic daily snapshots with 7-day retention by default.

### 3.6 Docker Compose Volume Backup

Back up the entire PostgreSQL data volume:

```bash
# Stop the database to ensure consistency
docker compose stop db

# Back up the volume
docker run --rm \
  -v eigennamen_postgres_data:/data \
  -v "$(pwd)/backups":/backup \
  alpine tar czf /backup/postgres-volume-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .

# Restart
docker compose start db
```

### 3.7 Prisma Migration Safety

Before any migration in production:

1. **Always back up first:**
   ```bash
   # Create a backup before migration
   pg_dump -U codenames -d codenames -Fc -f pre-migration-backup.dump
   ```

2. **Review the migration SQL:**
   ```bash
   cd server
   npx prisma migrate diff \
     --from-schema-datamodel prisma/schema.prisma \
     --to-migrations prisma/migrations \
     --script
   ```

3. **Run migrations:**
   ```bash
   cd server
   npm run db:migrate
   # Or on Fly.io (if release_command is enabled in fly.toml):
   # npx prisma migrate deploy
   ```

4. **Verify after migration:**
   ```bash
   npx prisma db pull    # Compare pulled schema against expected
   npx prisma validate   # Validate schema consistency
   ```

The project's `fly.toml` has the release command commented out by default since the database is optional. Uncomment it when enabling PostgreSQL on Fly.io:

```toml
[deploy]
  release_command = "sh -c 'npx prisma migrate deploy || npx prisma db push --skip-generate'"
```

---

## 4. Recovery Procedures

### 4.1 Redis Recovery

#### Scenario A: Redis restarts (Docker Compose with AOF)

No manual action needed. Redis automatically replays the AOF on startup:

```bash
docker compose restart redis

# Verify recovery
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" INFO server | grep uptime
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" DBSIZE
```

#### Scenario B: Redis data loss (corrupted or missing volume)

1. Stop the stack:
   ```bash
   docker compose down
   ```

2. Restore from volume backup:
   ```bash
   docker run --rm \
     -v eigennamen_redis_data:/data \
     -v "$(pwd)/backups":/backup \
     alpine sh -c "rm -rf /data/* && tar xzf /backup/redis-backup-YYYYMMDD-HHMMSS.tar.gz -C /data"
   ```

3. Restart:
   ```bash
   docker compose up -d
   ```

4. Verify:
   ```bash
   ./scripts/health-check.sh
   ./scripts/redis-inspect.sh
   ```

#### Scenario C: Redis in memory mode (no persistence)

No recovery is possible. Active games are lost. Players reconnect and create new rooms. This is the expected behavior for memory mode.

#### Scenario D: Fly.io Redis (Upstash) failure

1. Check status:
   ```bash
   fly redis status <redis-app-name>
   ```

2. If Upstash is down, the application falls back gracefully -- it will continue attempting reconnection with exponential backoff (configured in `server/src/config/redis.ts`, max 10 retries).

3. If data is lost, restore from Upstash dashboard backups or accept the loss (game state is ephemeral).

### 4.2 PostgreSQL Recovery

#### Restore from pg_dump (custom format)

```bash
# Stop the application to prevent writes during restore
docker compose stop api

# Restore (drops and recreates objects)
docker compose exec -T db pg_restore \
  -U codenames \
  -d codenames \
  --clean \
  --if-exists \
  < ./backups/codenames-YYYYMMDD-HHMMSS.dump

# Restart application
docker compose start api
```

#### Restore from pg_dump (SQL format)

```bash
docker compose stop api

docker compose exec -T db psql \
  -U codenames \
  -d codenames \
  < ./backups/codenames-YYYYMMDD-HHMMSS.sql

docker compose start api
```

#### Point-in-Time Recovery (if WAL archiving is enabled)

1. Stop PostgreSQL.
2. Clear the data directory.
3. Restore the base backup.
4. Create a `recovery.conf` (PostgreSQL < 12) or `recovery.signal` file:
   ```
   restore_command = 'cp /var/lib/postgresql/data/wal_archive/%f %p'
   recovery_target_time = '2026-02-13 14:30:00 UTC'
   ```
5. Start PostgreSQL. It will replay WAL segments up to the target time.

#### Fly.io PostgreSQL Restore

```bash
# Restore from automatic backup
fly postgres backup restore <backup-id> -a <postgres-app-name>

# Connect to verify
fly postgres connect -a <postgres-app-name>
# \dt    -- list tables
# SELECT count(*) FROM users;
# SELECT count(*) FROM word_lists;
```

### 4.3 Full Environment Rebuild

Complete rebuild from scratch (new infrastructure, all data lost):

**Step 1: Infrastructure**

```bash
# Docker Compose
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET
docker compose up -d --build
```

**Step 2: Database schema**

```bash
# Applied automatically by the Docker Compose command:
#   prisma db push --skip-generate
# Or manually:
cd server && npm run db:migrate
```

**Step 3: Verify health**

```bash
./scripts/health-check.sh http://localhost:3000
```

**Step 4: Restore data (if backups available)**

```bash
# Restore PostgreSQL
docker compose exec -T db pg_restore \
  -U codenames -d codenames --clean --if-exists \
  < ./backups/codenames-latest.dump

# Restore Redis (optional, only if needed)
docker compose stop redis
docker run --rm \
  -v eigennamen_redis_data:/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -c "tar xzf /backup/redis-backup-latest.tar.gz -C /data"
docker compose start redis
```

**Step 5: Verify application**

```bash
curl -s http://localhost:3000/health/ready | python3 -m json.tool
./scripts/redis-inspect.sh
```

**Fly.io rebuild:**

```bash
# Set secrets
fly secrets set JWT_SECRET="$(openssl rand -base64 32)"
fly secrets set ADMIN_PASSWORD="your-secure-password"
# Optionally:
# fly secrets set REDIS_URL="rediss://..."
# fly secrets set DATABASE_URL="postgresql://..."

# Deploy
fly deploy

# Verify
fly status
curl -s https://die-eigennamen.fly.dev/health/ready
```

---

## 5. RTO/RPO Targets

### Definitions

- **RPO (Recovery Point Objective)**: Maximum acceptable data loss measured in time.
- **RTO (Recovery Time Objective)**: Maximum acceptable downtime before service is restored.

### Targets by Data Type

| Data | Store | RPO | RTO | Rationale |
|------|-------|-----|-----|-----------|
| Active game state (rooms, players, timers) | Redis | ~0 (acceptable loss) | < 5 minutes | Ephemeral by design. Games last 30-60 minutes. Players create new rooms. |
| Distributed locks | Redis | ~0 (acceptable loss) | < 5 minutes | Locks have 5-second TTL and auto-expire. No manual recovery needed. |
| Session/reconnection tokens | Redis | ~0 (acceptable loss) | < 5 minutes | 5-minute TTL. Players re-authenticate on reconnect. |
| User accounts | PostgreSQL | < 1 hour | < 30 minutes | Restored from hourly pg_dump or Fly Postgres backup. |
| Custom word lists | PostgreSQL | < 1 hour | < 30 minutes | User-created content. Most valuable persistent data. |
| Game history/replays | PostgreSQL | < 1 hour | < 30 minutes | Nice-to-have. Not critical for gameplay. |
| Audit logs | PostgreSQL | < 1 hour | < 30 minutes | Important for security review, not for gameplay. |
| Application code | Container image | 0 (immutable) | < 10 minutes | Redeploy from Git or registry. |

### Target Summary

| Scenario | RPO | RTO |
|----------|-----|-----|
| Redis restart (AOF enabled) | ~0 | < 2 minutes |
| Redis total data loss | N/A (ephemeral) | < 5 minutes |
| PostgreSQL restore from dump | < 1 hour | < 30 minutes |
| PostgreSQL PITR (WAL archive) | < 5 minutes | < 30 minutes |
| Full environment rebuild | Depends on backup age | < 1 hour |
| Fly.io machine restart | N/A (auto-restart) | < 2 minutes |

---

## 6. Monitoring and Alerting

### 6.1 Health Check Endpoints

The application exposes several health endpoints (defined in `server/src/routes/healthRoutes.ts`):

| Endpoint | Purpose | Use For |
|----------|---------|---------|
| `GET /health` | Basic liveness (returns 200 if server is up) | Simple uptime checks |
| `GET /health/live` | Minimal liveness probe | Kubernetes/container orchestrator liveness |
| `GET /health/ready` | Checks Redis, Pub/Sub; returns 503 if degraded | Load balancer routing, Fly.io health check |
| `GET /health/metrics` | Detailed system metrics (memory, Redis, uptime) | Monitoring dashboards |
| `GET /health/metrics/prometheus` | Prometheus text exposition format | Prometheus/Grafana scraping |

**Fly.io uses `/health/ready`** as its service-level health check (configured in `fly.toml`):

```toml
[[http_service.checks]]
  grace_period = "30s"
  interval = "30s"
  method = "GET"
  timeout = "10s"
  path = "/health/ready"
```

**Docker Compose uses `/health/ready`** as its container health check:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### 6.2 Key Metrics to Monitor

The `/health/metrics` endpoint returns:

- **Server memory**: `heapUsed`, `heapTotal`, `rss`, `external` (in MB)
- **Redis health**: connection status, mode (redis/memory)
- **Redis memory**: `used_memory`, `maxmemory`, `memory_usage_percent`, `fragmentation_ratio`
- **Pub/Sub health**: total publishes, failures, failure rate, consecutive failures
- **Alerts**: Auto-generated when Redis memory exceeds 75% (warning) or 90% (critical)

### 6.3 Prometheus Metrics

The `/health/metrics/prometheus` endpoint exports metrics in Prometheus text format. Key metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `games_started` | Counter | Total games started |
| `games_completed` | Counter | Total games completed |
| `rooms_created` | Counter | Total rooms created |
| `active_rooms` | Gauge | Currently active rooms |
| `active_players` | Gauge | Currently connected players |
| `socket_connections` | Gauge | WebSocket connections |
| `memory_heap_used_bytes` | Gauge | Node.js heap memory |
| `memory_rss_bytes` | Gauge | Process RSS memory |
| `event_loop_lag_ms` | Gauge | Event loop lag |
| `operation_latency_ms` | Summary | Operation latency percentiles |
| `redis_latency_ms` | Summary | Redis operation latency |
| `errors` | Counter | Total errors by type |
| `rate_limit_hits` | Counter | Rate limiter activations |

**Prometheus scrape configuration:**

```yaml
scrape_configs:
  - job_name: 'codenames'
    scrape_interval: 30s
    metrics_path: '/health/metrics/prometheus'
    static_configs:
      - targets: ['localhost:3000']
```

### 6.4 Admin Dashboard

The admin dashboard (`GET /admin`, protected by `ADMIN_PASSWORD`) provides:

- Real-time server stats via SSE (`/admin/api/stats/stream`, 5-second updates)
- Memory usage with alert threshold at 480MB RSS
- Active room listing and details
- Player management (kick players, close rooms)
- Audit log viewer
- Broadcast messages to all connected clients

### 6.5 Recommended Alert Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| High memory | RSS > 480MB (of 512MB limit) | Critical | See [7.3 High Memory Usage](#73-high-memory-usage) |
| Redis memory | usage_percent > 90% | Critical | See [7.1 Redis Out of Memory](#71-redis-out-of-memory) |
| Redis memory | usage_percent > 75% | Warning | Monitor and plan capacity |
| Redis disconnected | `/health/ready` returns 503 | Critical | See [7.2 Database Connection Failures](#72-database-connection-failures) |
| Health check failing | `/health/ready` returns non-200 for 3+ checks | Critical | Check logs, restart if needed |
| High error rate | `errors` counter spike | Warning | Check application logs |
| Event loop lag | `event_loop_lag_ms` > 100ms sustained | Warning | Investigate CPU-bound operations |

### 6.6 Using Existing Scripts

The project includes utility scripts for quick health assessment:

```bash
# Full health check against any target
./scripts/health-check.sh http://localhost:3000
./scripts/health-check.sh https://die-eigennamen.fly.dev

# Redis inspection (memory, key counts, client connections)
./scripts/redis-inspect.sh
```

---

## 7. Runbook for Common Issues

### 7.1 Redis Out of Memory

**Symptoms:**
- `/health/metrics` shows `memory_usage_percent` above 90%
- `alerts` array in metrics response contains `redis_memory` with level `critical`
- Admin dashboard SSE stream reports Redis memory alerts
- Application errors with Redis write failures

**Diagnosis:**

```bash
# Check memory usage
./scripts/redis-inspect.sh

# Or directly:
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" INFO memory
```

**Resolution:**

1. **Check for key accumulation:**
   ```bash
   # Count keys by prefix
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'room:*' | wc -l
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'player:*' | wc -l
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'lock:*' | wc -l
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'timer:*' | wc -l
   ```

2. **Clean expired rooms manually** (if TTL eviction is lagging):
   ```bash
   # List rooms and check their TTL
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'room:*' | while read key; do
     ttl=$(docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" TTL "$key")
     echo "$key TTL=$ttl"
   done
   ```

3. **Set a maxmemory policy** (if not already set):
   ```bash
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" CONFIG SET maxmemory 100mb
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" CONFIG SET maxmemory-policy allkeys-lru
   ```

4. **Force cleanup via admin dashboard:**
   - Use `DELETE /admin/api/rooms/:code` to close stale rooms.

5. **Increase memory limit** in `docker-compose.yml`:
   ```yaml
   redis:
     deploy:
       resources:
         limits:
           memory: 256M  # Increase from 128M
   ```

### 7.2 Database Connection Failures

**Symptoms:**
- `/health/ready` returns 503 with Redis check failing
- Application logs show "Redis Client Error" or "Max reconnection attempts reached"
- PostgreSQL-dependent features (word lists, game history) return errors

**Diagnosis:**

```bash
# Check container health
docker compose ps

# Check Redis connectivity
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" PING

# Check PostgreSQL connectivity
docker compose exec db pg_isready -U codenames -d codenames

# Check application logs
docker compose logs api --tail=50
```

**Resolution for Redis:**

1. **Restart Redis:**
   ```bash
   docker compose restart redis
   ```

2. **Check if password mismatch:**
   ```bash
   # Verify REDIS_PASSWORD matches between .env and running container
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" PING
   ```

3. **Check network:**
   ```bash
   docker compose exec api sh -c "curl -v telnet://redis:6379" 2>&1 | head -5
   ```

4. **If Redis is completely unrecoverable**, switch to memory mode temporarily:
   ```bash
   # In .env or docker-compose.yml
   REDIS_URL=memory
   docker compose up -d api
   ```

**Resolution for PostgreSQL:**

1. **Restart PostgreSQL:**
   ```bash
   docker compose restart db
   # Wait for health check
   docker compose exec db pg_isready -U codenames -d codenames
   ```

2. **Check disk space** (full disk prevents WAL writes):
   ```bash
   docker compose exec db df -h /var/lib/postgresql/data
   ```

3. **Check connection limits:**
   ```bash
   docker compose exec db psql -U codenames -d codenames \
     -c "SELECT count(*) FROM pg_stat_activity;"
   ```

4. **The application works without PostgreSQL.** If the database cannot be recovered immediately, the game continues to function -- only word list persistence, game history, and user accounts are affected.

### 7.3 High Memory Usage

**Symptoms:**
- Admin dashboard SSE reports RSS > 480MB
- `/health/metrics` shows high `heapUsed` or `rss`
- Container OOM-killed (check with `docker compose logs api`)
- Fly.io machine restarts unexpectedly

**Diagnosis:**

```bash
# Check Node.js memory
curl -s http://localhost:3000/health/metrics | python3 -m json.tool

# Check container memory
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"
```

**Resolution:**

1. **Check for room/player accumulation** (the most common cause):
   ```bash
   curl -s http://localhost:3000/admin/api/stats \
     -H "Authorization: Basic $(echo -n admin:$ADMIN_PASSWORD | base64)" \
     | python3 -m json.tool
   ```

2. **Force garbage collection of stale metrics** -- the application prunes stale metrics every 30 minutes automatically (`server/src/utils/metrics.ts`), but histogram data can accumulate. Restart the application to reset:
   ```bash
   docker compose restart api
   ```

3. **Close stale rooms via admin API:**
   ```bash
   # List rooms
   curl -s http://localhost:3000/admin/api/rooms \
     -H "Authorization: Basic $(echo -n admin:$ADMIN_PASSWORD | base64)"

   # Close a specific room
   curl -X DELETE http://localhost:3000/admin/api/rooms/ROOMCODE \
     -H "Authorization: Basic $(echo -n admin:$ADMIN_PASSWORD | base64)"
   ```

4. **On Fly.io**, if memory is consistently high:
   ```bash
   # Scale up memory
   fly scale memory 1024
   ```

5. **Long-term**: Monitor the `memory_heap_used_bytes` Prometheus metric to identify growth trends.

### 7.4 Stuck Distributed Locks

**Symptoms:**
- Game actions (card reveals, clue submissions, team switches) hang or timeout
- Application logs show "Failed to acquire lock after max retries"
- `ServerError: Failed to acquire lock: <key>` errors

**Diagnosis:**

```bash
# Count active locks
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'lock:*' | wc -l

# List all locks with their TTLs
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'lock:*' | while read key; do
  value=$(docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" GET "$key")
  ttl=$(docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" PTTL "$key")
  echo "$key owner=$value ttl=${ttl}ms"
done
```

**Resolution:**

1. **Locks auto-expire.** The default lock timeout is 5 seconds (`server/src/utils/distributedLock.ts`). Wait a few seconds and retry.

2. **Force-release a specific lock:**
   ```bash
   # Delete the lock key directly
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" DEL "lock:room:ROOMCODE:reveal"
   ```

3. **Clear all stuck locks** (use with caution -- may cause race conditions for in-flight operations):
   ```bash
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'lock:*' | while read key; do
     docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" DEL "$key"
     echo "Deleted $key"
   done
   ```

4. **If locks persist after clearing**, restart the API server:
   ```bash
   docker compose restart api
   ```

**Prevention:** Locks use ownership tracking (UUID per acquisition) and Lua scripts for atomic release. If you see frequent lock contention, it may indicate:
- Too many concurrent players in one room
- Slow Redis responses (check `redis_latency_ms` metric)
- Network issues between the API and Redis

### 7.5 Orphaned Player Data

**Symptoms:**
- Room shows more players than are actually connected
- Admin dashboard room details show players with stale data
- `room:<code>:players` set contains session IDs that no longer have corresponding `player:<id>` keys

**Diagnosis:**

```bash
# Pick a room code and check for orphans
ROOM_CODE="abc123"

# Get all player IDs in the room set
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" \
  SMEMBERS "room:${ROOM_CODE}:players"

# For each player ID, check if their data exists
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" \
  SMEMBERS "room:${ROOM_CODE}:players" | while read id; do
    exists=$(docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" EXISTS "player:$id")
    echo "player:$id exists=$exists"
  done
```

**Resolution:**

1. **The application has automatic cleanup.** Player cleanup runs every 60 seconds in batches of 50 (configured in `server/src/config/roomConfig.ts` as `PLAYER_CLEANUP`). Disconnected players have a 10-minute grace period before removal.

2. **Force-remove orphaned players:**
   ```bash
   ROOM_CODE="abc123"
   PLAYER_ID="orphaned-session-id"

   # Remove from room set
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" \
     SREM "room:${ROOM_CODE}:players" "$PLAYER_ID"

   # Delete player data (if it exists)
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" \
     DEL "player:${PLAYER_ID}"
   ```

3. **Kick via admin API** (notifies connected clients and cleans up properly):
   ```bash
   curl -X DELETE \
     "http://localhost:3000/admin/api/rooms/${ROOM_CODE}/players/${PLAYER_ID}" \
     -H "Authorization: Basic $(echo -n admin:$ADMIN_PASSWORD | base64)"
   ```

4. **Nuclear option -- close and recreate the room:**
   ```bash
   curl -X DELETE \
     "http://localhost:3000/admin/api/rooms/${ROOM_CODE}" \
     -H "Authorization: Basic $(echo -n admin:$ADMIN_PASSWORD | base64)"
   ```

5. **Trigger a room resync** by having the host client emit `room:resync`. This causes the server to rebuild the room state and push it to all connected clients.

---

## Appendix: Quick Reference Commands

### Health and Status

```bash
# Application health
curl -s http://localhost:3000/health/ready | python3 -m json.tool

# Full metrics
curl -s http://localhost:3000/health/metrics | python3 -m json.tool

# Prometheus metrics
curl -s http://localhost:3000/health/metrics/prometheus

# Admin stats
curl -s http://localhost:3000/admin/api/stats \
  -H "Authorization: Basic $(echo -n admin:$ADMIN_PASSWORD | base64)" | python3 -m json.tool
```

### Redis Operations

```bash
# Ping
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" PING

# Memory info
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" INFO memory

# Key count
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" DBSIZE

# Trigger RDB snapshot
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" BGSAVE

# Trigger AOF rewrite
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" BGREWRITEAOF
```

### PostgreSQL Operations

```bash
# Connection test
docker compose exec db pg_isready -U codenames -d codenames

# Interactive shell
docker compose exec db psql -U codenames -d codenames

# Table sizes
docker compose exec db psql -U codenames -d codenames \
  -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
      FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"

# Row counts
docker compose exec db psql -U codenames -d codenames \
  -c "SELECT 'users' as t, count(*) FROM users
      UNION ALL SELECT 'rooms', count(*) FROM rooms
      UNION ALL SELECT 'games', count(*) FROM games
      UNION ALL SELECT 'word_lists', count(*) FROM word_lists
      UNION ALL SELECT 'game_participants', count(*) FROM game_participants;"
```

### Fly.io Operations

```bash
# App status
fly status

# Logs
fly logs

# SSH into machine
fly ssh console

# Scale memory
fly scale memory 1024

# Restart
fly apps restart die-eigennamen

# Redis dashboard (if provisioned)
fly redis dashboard <redis-app-name>

# Postgres backup
fly postgres backup list -a <postgres-app-name>
```
