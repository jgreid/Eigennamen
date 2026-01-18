# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Production stage
FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S codenames -u 1001

# Copy package files and prisma schema (needed for generate)
COPY package*.json ./
COPY prisma ./prisma

# Install production dependencies and generate prisma client
RUN npm ci --omit=dev && \
    npx prisma generate && \
    npm cache clean --force

# Copy source code from builder
COPY --from=builder /app/src ./src

# Set ownership
RUN chown -R codenames:nodejs /app

# Switch to non-root user
USER codenames

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "src/index.js"]
