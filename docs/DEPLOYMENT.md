# Deployment Guide

This guide covers deploying Codenames Online to various platforms.

## Deployment Options

| Platform | Complexity | Cost | Scaling | Best For |
|----------|------------|------|---------|----------|
| Single Instance (Memory) | Low | Free-$5/mo | None | Testing, small groups |
| Docker Compose | Low | $10-20/mo | Manual | Self-hosted, moderate use |
| Fly.io | Medium | $5-15/mo | Auto | Production, global |
| Heroku | Medium | $7-25/mo | Manual | Quick deployment |
| Kubernetes | High | Variable | Auto | Enterprise, high scale |

---

## Quick Start: Single Instance (No Redis/Database)

The simplest deployment uses in-memory storage. Data is lost on restart.

```bash
# Clone and install
git clone https://github.com/jgreid/Risley-Codenames.git
cd Risley-Codenames/server
npm install

# Run with memory storage
REDIS_URL=memory PORT=3000 npm start
```

**Limitations:**
- Single instance only (no horizontal scaling)
- Data lost on restart
- No persistent word lists or user accounts

---

## Docker Compose (Recommended for Self-Hosting)

Full stack with Redis and optional PostgreSQL.

### Prerequisites
- Docker and Docker Compose installed
- 1GB+ RAM recommended

### Basic Setup (Redis only)

```bash
# Clone repository
git clone https://github.com/jgreid/Risley-Codenames.git
cd Risley-Codenames

# Start services
docker compose up -d

# View logs
docker compose logs -f server
```

The app will be available at `http://localhost:3000`.

### Full Stack (with PostgreSQL)

```yaml
# docker-compose.override.yml
version: '3.8'
services:
  server:
    environment:
      - DATABASE_URL=postgresql://codenames:password@postgres:5432/codenames

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=codenames
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=codenames
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Then run:
```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d

# Run database migrations
docker compose exec server npm run db:migrate
```

### Configuration

Environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `REDIS_URL` | redis://redis:6379 | Redis connection URL |
| `DATABASE_URL` | (optional) | PostgreSQL connection URL |
| `LOG_LEVEL` | info | debug, info, warn, error |
| `CORS_ORIGIN` | * | Allowed origins (set in production!) |

---

## Fly.io (Recommended for Production)

Fly.io provides global edge deployment with managed Redis.

### Prerequisites
- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed
- Fly.io account

### Initial Deployment

```bash
cd Risley-Codenames

# Login to Fly
fly auth login

# Create app
fly launch --name your-codenames-app

# Create Redis (Upstash)
fly redis create

# Set Redis URL from output
fly secrets set REDIS_URL=redis://...
fly secrets set CORS_ORIGIN=https://your-codenames-app.fly.dev

# Deploy
fly deploy
```

### Configuration (fly.toml)

The repository includes `fly.toml` with recommended settings:

```toml
[env]
  PORT = "8080"
  NODE_ENV = "production"
  LOG_LEVEL = "info"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[services]]
  protocol = "tcp"
  internal_port = 8080

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

### Scaling

```bash
# Scale to 2 instances
fly scale count 2

# Scale memory
fly scale memory 512

# View status
fly status
```

---

## Heroku

### Prerequisites
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- Heroku account

### Deployment

```bash
cd Risley-Codenames

# Login
heroku login

# Create app
heroku create your-codenames-app

# Add Redis
heroku addons:create heroku-redis:mini

# Set buildpack
heroku buildpacks:set heroku/nodejs

# Configure
heroku config:set NPM_CONFIG_PRODUCTION=false
heroku config:set CORS_ORIGIN=https://your-codenames-app.herokuapp.com

# Deploy
git push heroku main

# Open app
heroku open
```

### Procfile

Create `Procfile` in the repository root:

```
web: cd server && npm start
```

---

## Kubernetes

For enterprise deployments with high availability.

### Example Manifests

#### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: codenames
spec:
  replicas: 3
  selector:
    matchLabels:
      app: codenames
  template:
    metadata:
      labels:
        app: codenames
    spec:
      containers:
      - name: codenames
        image: your-registry/codenames:latest
        ports:
        - containerPort: 3000
        env:
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: codenames-secrets
              key: redis-url
        - name: CORS_ORIGIN
          value: "https://codenames.example.com"
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
          requests:
            memory: "256Mi"
            cpu: "100m"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: codenames
spec:
  selector:
    app: codenames
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

#### Ingress (with WebSocket support)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: codenames
  annotations:
    nginx.ingress.kubernetes.io/websocket-services: "codenames"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  rules:
  - host: codenames.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: codenames
            port:
              number: 80
```

---

## Staging Environment

For validating changes before production deployment, create a staging environment:

### Fly.io Staging

```bash
# Create a staging app (separate from production)
fly apps create codenames-staging

# Deploy to staging
fly deploy --app codenames-staging

# Use a separate Redis instance
fly redis create codenames-staging-redis --region iad
fly redis attach codenames-staging-redis --app codenames-staging

# Run database migrations in staging first
fly ssh console --app codenames-staging -C "cd /app/server && npx prisma migrate deploy"

# Verify health
fly status --app codenames-staging
curl https://codenames-staging.fly.dev/health/ready
```

### Docker Compose Staging

For local staging that mirrors production:

```bash
# Use production-like config with memory limits
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

### Staging Checklist

- [ ] Deploy to staging before production
- [ ] Run database migrations in staging
- [ ] Verify health endpoints respond
- [ ] Test multiplayer flow (create room, join, play)
- [ ] Check reconnection works
- [ ] Run E2E tests against staging: `BASE_URL=https://codenames-staging.fly.dev npm run test:e2e`

---

## Database Backup Strategy

### PostgreSQL Backups

PostgreSQL stores word lists and optional user data. Even if the database is optional, backups protect against data loss.

#### Automated Backups with pg_dump

```bash
# Daily backup via cron (add to crontab -e)
0 3 * * * pg_dump -Fc $DATABASE_URL > /backups/codenames_$(date +\%Y\%m\%d).dump

# Restore from backup
pg_restore -d $DATABASE_URL /backups/codenames_20260209.dump
```

#### Fly.io Managed Backups

Fly.io Postgres clusters include automatic daily backups:

```bash
# List available backups
fly postgres backups list --app codenames-db

# Restore from a backup
fly postgres backups restore <backup-id> --app codenames-db
```

### Redis Data

Redis stores ephemeral game state (rooms, players, timers). It is designed to be losable - the application recovers gracefully. However, for multi-day tournaments:

```bash
# Manual Redis snapshot
redis-cli BGSAVE

# Copy the dump file
cp /var/lib/redis/dump.rdb /backups/redis_$(date +%Y%m%d).rdb
```

### Backup Retention

| Data | Frequency | Retention | Priority |
|------|-----------|-----------|----------|
| PostgreSQL (word lists) | Daily | 30 days | Medium |
| Redis (game state) | Manual/none | Ephemeral | Low |
| Application logs | Continuous | 7 days | Medium |

---

## Security Checklist

Before going to production:

- [ ] Set `CORS_ORIGIN` to your domain (not `*`)
- [ ] Set `JWT_SECRET` for user authentication (if using)
- [ ] Enable HTTPS (TLS termination at load balancer)
- [ ] Configure rate limiting appropriately
- [ ] Set `NODE_ENV=production`
- [ ] Review Redis TLS settings (`rediss://` URLs)
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategy for Redis/PostgreSQL

---

## Monitoring

### Health Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Basic health check |
| `GET /health/ready` | Full readiness check (Redis, optional DB) |
| `GET /health/live` | Liveness probe for Kubernetes |
| `GET /metrics` | Server metrics |

### Recommended Metrics to Monitor

- Active socket connections
- Room count
- Request rate and latency
- Error rate
- Redis connection health
- Memory usage

---

## Troubleshooting

### Common Issues

**WebSocket connections failing:**
- Ensure load balancer supports WebSockets
- Check `Upgrade` and `Connection` headers are forwarded
- Verify sticky sessions if using multiple instances

**Redis connection errors:**
- Verify `REDIS_URL` format (`redis://` or `rediss://`)
- Check network connectivity between server and Redis
- Ensure Redis allows connections from server IP

**CORS errors:**
- Set `CORS_ORIGIN` to exact frontend URL
- Don't use `*` in production

**Memory issues:**
- Increase container memory limits
- Check for memory leaks in logs
- Monitor rate limiter cleanup
