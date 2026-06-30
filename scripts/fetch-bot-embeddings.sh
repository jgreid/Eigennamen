#!/usr/bin/env bash
#
# Fetch a word-embedding model for the intelligent bots' semantic backend.
#
# The bots ship with an offline-baked association table and need NO assets to
# run. This script is optional: it downloads a real pre-trained word-vectors
# file so the spymaster/clicker reason over true embeddings instead. The file
# lands in server/src/bots/data/ (git-ignored). Enable it by exporting:
#
#     export BOT_EMBEDDINGS_PATH=src/bots/data/<file>.vec
#
# Usage:
#     scripts/fetch-bot-embeddings.sh [glove|fasttext|numberbatch] [--trim N]
#
#   glove       (default) GloVe 6B 100d — ~822 MB zip download; the extracted
#               100d vectors file is ~330 MB. No header line.
#   fasttext    fastText wiki-news 300d 1M — ~600 MB unzipped, richer vocab.
#   numberbatch ConceptNet Numberbatch English 19.08 — ~300 MB, knowledge-graph.
#   --trim N    keep only the first N vectors (files are frequency-ordered, so
#               the top N are the most common words). The loader also caps at
#               BOT_EMBEDDINGS_MAX_WORDS, so trimming mainly saves disk.
#
# Models are large and licensed by their authors (GloVe: PDDL/ODC-BY; fastText:
# CC-BY-SA-3.0; Numberbatch: CC-BY-SA-4.0). Review the license before bundling.
#
# NOTE (integrity): these are large third-party files fetched over HTTPS with no
# checksum verification here — verify their published hashes yourself before
# trusting them in a sensitive deployment.
#
# NOTE (deployment): server/src/bots/data/ is git-ignored and is NOT copied into
# the Docker/Fly image, so a BOT_EMBEDDINGS_PATH set there will not resolve in a
# deployed container. The supported way to ship embeddings is the Dockerfile's
# build-arg bake: `docker build --build-arg BOT_EMBEDDINGS_MODEL=glove ...` then set
# BOT_EMBEDDINGS_PATH=/app/embeddings/vectors.vec (see docs/BOT_EMBEDDINGS.md and
# docs/DEPLOYMENT.md). Alternatively mount a vectors file as a volume.
set -euo pipefail

MODEL="${1:-glove}"
TRIM=""
shift || true
while [ "$#" -gt 0 ]; do
    case "$1" in
        --trim) TRIM="${2:-}"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../server/src/bots/data"
mkdir -p "$DATA_DIR"

case "$MODEL" in
    glove)
        URL="https://nlp.stanford.edu/data/glove.6B.zip"
        ARCHIVE="$DATA_DIR/glove.6B.zip"
        MEMBER="glove.6B.100d.txt"
        OUT="$DATA_DIR/glove.6B.100d.vec"
        echo "Downloading GloVe 6B (~830 MB zip)…"
        curl -fL --retry 3 -o "$ARCHIVE" "$URL"
        unzip -o "$ARCHIVE" "$MEMBER" -d "$DATA_DIR"
        mv "$DATA_DIR/$MEMBER" "$OUT"
        rm -f "$ARCHIVE"
        ;;
    fasttext)
        URL="https://dl.fbaipublicfiles.com/fasttext/vectors-english/wiki-news-300d-1M.vec.zip"
        ARCHIVE="$DATA_DIR/wiki-news-300d-1M.vec.zip"
        OUT="$DATA_DIR/wiki-news-300d-1M.vec"
        echo "Downloading fastText wiki-news 300d 1M (~600 MB zip)…"
        curl -fL --retry 3 -o "$ARCHIVE" "$URL"
        unzip -o "$ARCHIVE" -d "$DATA_DIR"
        rm -f "$ARCHIVE"
        ;;
    numberbatch)
        URL="https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-en-19.08.txt.gz"
        OUT="$DATA_DIR/numberbatch-en-19.08.vec"
        echo "Downloading ConceptNet Numberbatch English 19.08 (~300 MB gz)…"
        curl -fL --retry 3 -o "$OUT.gz" "$URL"
        gunzip -f "$OUT.gz"
        ;;
    *)
        echo "Unknown model: $MODEL (expected glove|fasttext|numberbatch)" >&2
        exit 2
        ;;
esac

if [ -n "$TRIM" ]; then
    echo "Trimming to first $TRIM vectors…"
    head -n "$TRIM" "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
fi

REL="src/bots/data/$(basename "$OUT")"
echo
echo "Done: $OUT"
echo "Enable it with:"
echo "    export BOT_EMBEDDINGS_PATH=$REL"
