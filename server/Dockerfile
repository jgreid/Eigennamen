# Build stage
# Note: Build context is repo root (where fly.toml is located)
FROM node:24-alpine3.21 AS builder

WORKDIR /app

# Copy package files first for better layer caching
# (dependencies change less frequently than source code)
COPY server/package*.json ./

# Install all dependencies
RUN npm ci

# E-11: Optimized layer ordering — tsconfig changes less than source code
# Copy TypeScript config and esbuild config (separate layer — rarely changes)
COPY server/tsconfig*.json ./
COPY server/esbuild.config.js ./

# Copy source code and static assets (most frequently changing layer).
# index.html is a real file under server/public/, so it comes in with this copy.
COPY server/src/ ./src/
COPY server/public/ ./public/

# Compile TypeScript backend + bundle frontend with esbuild (auto-updates SRI hash)
RUN npm run build

# --- Optional: bake bot word-embeddings into the image (OFF by default) ---
# With no build-arg the build is byte-for-byte unchanged (/app/embeddings holds only
# a .keep placeholder). To ship strong bots in a deployed image, build with e.g.:
#   docker build --build-arg BOT_EMBEDDINGS_MODEL=numberbatch -f server/Dockerfile .
# then set BOT_EMBEDDINGS_PATH=/app/embeddings/vectors.vec on the running container.
#
# By default the model is distilled to COMPACT board-restricted vectors
# (build-board-vectors.mjs): a few MB with guaranteed coverage of every board/concept
# word plus a clue-generation breadth sample — far better than a generic first-N trim,
# and the only correct way to consume the alphabetical Numberbatch model (the best fit
# for a word game and reachable where the GloVe/fastText hosts are blocked). The board
# bake ALSO fetches a small frequency reference (dev-bots.mjs, ~600 KB from
# raw.githubusercontent.com) so the distillation enables the runtime commonness prior
# and clue words stay recognizable; that fetch is best-effort (a block degrades to a
# prior-off build, not a build failure). Set BOT_EMBEDDINGS_BOARD=0 to bake the legacy
# coarse trim instead.
ARG BOT_EMBEDDINGS_MODEL=
ARG BOT_EMBEDDINGS_TRIM=100000
ARG BOT_EMBEDDINGS_BOARD=1
COPY scripts/ ./scripts/
RUN mkdir -p /app/embeddings && touch /app/embeddings/.keep && \
    if [ -n "$BOT_EMBEDDINGS_MODEL" ]; then \
        apk add --no-cache unzip && \
        if [ "$BOT_EMBEDDINGS_BOARD" = "0" ]; then \
            BOT_MODEL="$BOT_EMBEDDINGS_MODEL" BOT_TRIM="$BOT_EMBEDDINGS_TRIM" node scripts/dev-bots.mjs --no-run && \
            cp /app/server/src/bots/data/*.vec /app/embeddings/vectors.vec; \
        else \
            BOT_MODEL="$BOT_EMBEDDINGS_MODEL" node scripts/dev-bots.mjs --no-run --board && \
            cp /app/server/src/bots/data/board-vectors.vec /app/embeddings/vectors.vec; \
        fi; \
    fi

# Production stage
# Pinned to Node 24 (active LTS). Do NOT bump to an odd "Current" line (25, 27, …):
# those reach end-of-life on a ~6-month cadence with no security patches, and CI's
# test matrix (.github/workflows/ci.yml) only runs the even LTS majors. The Dockerfile
# major is asserted against that matrix by the "docker-node-major" CI guard, and
# .github/dependabot.yml ignores node major bumps so this pin can't be auto-reverted.
FROM node:24-alpine3.21

WORKDIR /app

# Patch OS packages to the latest available (clears base-image CVEs in
# openssl/musl/zlib, etc.), install curl for healthcheck and redis for the
# embedded memory-mode server, create non-root user, and create logs directory
RUN apk upgrade --no-cache && \
    apk add --no-cache curl redis && \
    addgroup -g 1001 -S nodejs && \
    adduser -S eigennamen -u 1001 && \
    mkdir -p /app/logs && chown eigennamen:nodejs /app/logs

# Copy package files and install production dependencies.
# npm/corepack are build-time tooling only — the runtime entrypoint is
# `node dist/index.js` and never invokes them. Removing them after the install
# eliminates their bundled-dependency CVEs from the shipped image and shrinks
# the attack surface.
COPY --chown=eigennamen:nodejs server/package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack

# Copy compiled JavaScript from builder
COPY --chown=eigennamen:nodejs --from=builder /app/dist ./dist

# Copy public folder (static assets) from builder
COPY --chown=eigennamen:nodejs --from=builder /app/public ./public

# Copy baked bot embeddings (empty unless built with --build-arg BOT_EMBEDDINGS_MODEL).
# Enable at runtime with BOT_EMBEDDINGS_PATH=/app/embeddings/vectors.vec.
COPY --chown=eigennamen:nodejs --from=builder /app/embeddings ./embeddings

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
