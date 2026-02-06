# Build stage
# Note: Build context is repo root (where fly.toml is located)
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files from server directory
COPY server/package*.json ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm ci

# Copy server source code
COPY server/ .

# Copy root index.html (symlinked from server/public/index.html)
COPY index.html ./public/index.html

# Generate Prisma client (needed before TypeScript compilation)
RUN npx prisma generate

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Copy Lua scripts (non-TS assets referenced at runtime via fs.readFileSync)
RUN cp -r src/scripts dist/scripts

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck and openssl for Prisma
RUN apk add --no-cache curl openssl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S codenames -u 1001

# Copy package files and prisma schema (needed for generate)
COPY server/package*.json ./
COPY server/prisma ./prisma

# Install production dependencies and generate prisma client
RUN npm ci --omit=dev && \
    npx prisma generate && \
    npm cache clean --force

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy public folder (static assets) from builder
COPY --from=builder /app/public ./public

# Create logs directory for production logging
RUN mkdir -p /app/logs

# Set ownership of app directory to non-root user
RUN chown -R codenames:nodejs /app

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
