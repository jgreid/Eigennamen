#!/usr/bin/env bash
#
# One-command setup for laptop / offline bot playtesting.
#
# The intelligent bots score word relatedness through a pluggable SemanticBackend.
# With no embeddings configured they fall back to a tiny baked association table
# plus a lexical (character-bigram) floor — which makes the clicker rank cards by
# SPELLING, not meaning, so it guesses human clues badly. This script upgrades them
# to real pre-trained word vectors in one step.
#
# What it does:
#   1. Downloads a word-vectors model into server/src/bots/data/ ONCE. Idempotent:
#      re-runs reuse the existing file, so after the first download it works fully
#      offline.
#   2. Exports BOT_EMBEDDINGS_PATH so the bot spymaster/clicker reason over real
#      embeddings (cosine similarity) instead of the weak lexical fallback.
#   3. Starts `npm run dev`.
#
# Usage:
#   scripts/dev-bots.sh                          # default model (glove): fetch-if-missing, then run
#   BOT_MODEL=numberbatch scripts/dev-bots.sh    # stronger word-association model
#   BOT_TRIM=50000 scripts/dev-bots.sh           # smaller on-disk vectors file
#   scripts/dev-bots.sh --no-run                 # only prepare embeddings, don't start the server
#
# Env knobs:
#   BOT_MODEL   glove (default) | fasttext | numberbatch
#   BOT_TRIM    keep only the first N vectors — saves disk (default 100000). The
#               server also caps loaded vectors at BOT_EMBEDDINGS_MAX_WORDS (50000).
#
# NOTE: the first download is large (GloVe ~830 MB zip, fastText/Numberbatch ~300-600 MB).
# It happens once; the file lands in the git-ignored server/src/bots/data/ and is reused.
set -euo pipefail

MODEL="${BOT_MODEL:-glove}"
TRIM="${BOT_TRIM:-100000}"
RUN=1

for arg in "$@"; do
    case "$arg" in
        --no-run | --setup-only) RUN=0 ;;
        -h | --help)
            sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$REPO_ROOT/server/src/bots/data"

# Map model -> output filename (must match scripts/fetch-bot-embeddings.sh).
case "$MODEL" in
    glove) VEC="glove.6B.100d.vec" ;;
    fasttext) VEC="wiki-news-300d-1M.vec" ;;
    numberbatch) VEC="numberbatch-en-19.08.vec" ;;
    *)
        echo "Unknown BOT_MODEL: $MODEL (expected glove|fasttext|numberbatch)" >&2
        exit 2
        ;;
esac

VEC_PATH="$DATA_DIR/$VEC"

# Treat a file under 1 MB as a truncated / aborted download and re-fetch it.
needs_fetch=1
if [ -f "$VEC_PATH" ]; then
    size=$(wc -c <"$VEC_PATH" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then
        needs_fetch=0
    else
        echo "⚠️  $VEC looks incomplete (${size} bytes) — re-fetching."
    fi
fi

if [ "$needs_fetch" -eq 1 ]; then
    echo "📥 Fetching '$MODEL' embeddings (one-time; subsequent runs are offline)…"
    fetch_args=("$MODEL")
    if [ -n "$TRIM" ]; then
        fetch_args+=(--trim "$TRIM")
    fi
    "$SCRIPT_DIR/fetch-bot-embeddings.sh" "${fetch_args[@]}"
else
    echo "✓ Reusing existing embeddings: $VEC_PATH"
fi

# Path is relative to server/ (the dev server's working directory).
export BOT_EMBEDDINGS_PATH="src/bots/data/$VEC"
echo "✓ BOT_EMBEDDINGS_PATH=$BOT_EMBEDDINGS_PATH"

if [ "$RUN" -eq 0 ]; then
    echo
    echo "Setup complete. Start the server with embedding-backed bots via:"
    echo "    cd server && BOT_EMBEDDINGS_PATH=$BOT_EMBEDDINGS_PATH npm run dev"
    echo "  (or just: npm run dev:bots)"
    exit 0
fi

echo "🤖 Starting dev server with embedding-backed bots…"
echo "   Watch for: 'Bot embeddings loaded: N vectors, M clue candidates'"
cd "$REPO_ROOT/server"
exec npm run dev
