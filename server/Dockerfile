# Build stage
# Note: Build context is repo root (where fly.toml is located)
FROM node:25-alpine AS builder

WORKDIR /app

# Copy package files and prisma schema first for better layer caching
# (dependencies change less frequently than source code)
COPY server/package*.json ./
COPY server/prisma ./prisma

# Install all dependencies and generate Prisma client in single layer
RUN npm ci && npx prisma generate

# E-11: Optimized layer ordering — tsconfig changes less than source code
# Copy TypeScript config (separate layer — rarely changes)
COPY server/tsconfig*.json ./

# Copy source code and static assets (most frequently changing layer)
COPY server/src/ ./src/
COPY server/public/ ./public/

# Copy root index.html (symlinked from server/public/index.html)
COPY index.html ./public/index.html

# Compile TypeScript (build script also copies Lua scripts to dist/scripts/)
RUN npm run build

# Production stage
FROM node:25-alpine

WORKDIR /app

# Install curl for healthcheck, openssl for Prisma, redis for embedded
# memory-mode server, create non-root user, and create logs directory
RUN apk add --no-cache curl openssl redis && \
    addgroup -g 1001 -S nodejs && \
    adduser -S eigennamen -u 1001 && \
    mkdir -p /app/logs && chown eigennamen:nodejs /app/logs

# Copy package files and prisma schema (needed for generate)
COPY --chown=eigennamen:nodejs server/package*.json ./
COPY --chown=eigennamen:nodejs server/prisma ./prisma

# Install production dependencies and generate prisma client
RUN npm ci --omit=dev && \
    npx prisma generate && \
    npm cache clean --force

# Copy compiled JavaScript from builder
COPY --chown=eigennamen:nodejs --from=builder /app/dist ./dist

# Copy public folder (static assets) from builder
COPY --chown=eigennamen:nodejs --from=builder /app/public ./public

# Switch to non-root user
USER eigennamen

# Expose port
EXPOSE 3000

# Health check - use /health/ready to verify all dependencies (DB, Redis, Socket.io)
# Longer start-period allows time for database connections to establish
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health/ready || exit 1

# Start application
CMD ["node", "dist/index.js"]
