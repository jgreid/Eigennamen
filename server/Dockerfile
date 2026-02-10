# Build stage
# Note: Build context is repo root (where fly.toml is located)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and prisma schema first for better layer caching
# (dependencies change less frequently than source code)
COPY server/package*.json ./
COPY server/prisma ./prisma

# Install all dependencies and generate Prisma client in single layer
RUN npm ci && npx prisma generate

# Copy server source code (separate layer — only rebuilt when source changes)
COPY server/ .

# Copy root index.html (symlinked from server/public/index.html)
COPY index.html ./public/index.html

# Compile TypeScript and copy Lua scripts in single layer
RUN npm run build && cp -r src/scripts dist/scripts

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck and openssl for Prisma, create non-root user,
# and create logs directory — all in single layer to reduce image size
RUN apk add --no-cache curl openssl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S codenames -u 1001 && \
    mkdir -p /app/logs && chown codenames:nodejs /app/logs

# Copy package files and prisma schema (needed for generate)
COPY --chown=codenames:nodejs server/package*.json ./
COPY --chown=codenames:nodejs server/prisma ./prisma

# Install production dependencies and generate prisma client
RUN npm ci --omit=dev && \
    npx prisma generate && \
    npm cache clean --force

# Copy compiled JavaScript from builder
COPY --chown=codenames:nodejs --from=builder /app/dist ./dist

# Copy public folder (static assets) from builder
COPY --chown=codenames:nodejs --from=builder /app/public ./public

# Switch to non-root user
USER codenames

# Expose port
EXPOSE 3000

# Health check - use /health/ready to verify all dependencies (DB, Redis, Socket.io)
# Longer start-period allows time for database connections to establish
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health/ready || exit 1

# Start application
CMD ["node", "dist/index.js"]
