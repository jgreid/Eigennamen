# Bot Semantic Embeddings

The intelligent bots score how related two words are through a pluggable
`SemanticBackend` (`server/src/bots/semantics/backend.ts`). Out of the box they
use an **offline-baked association table** plus a lexical (character-bigram)
floor — fully deterministic and requiring **no external assets**. This guide
covers upgrading them to **real pre-trained word embeddings** for stronger,
more human-like clue-giving and guessing.

## Backend tiers

Relatedness resolves through a fallback chain, strongest first:

1. **Vector embeddings** (`vectorBackend.ts`) — cosine similarity of pre-trained
   word vectors. Enabled only when `BOT_EMBEDDINGS_PATH` is set and the file
   loads. Out-of-vocabulary words drop to ↓.
2. **Baked association table** (`tableBackend.ts`) — a curated clue→words map.
   Unknown pairs drop to ↓.
3. **Lexical** (`backend.ts`) — Sørensen–Dice over character bigrams. Always
   available, language-agnostic, weak.

The choice is made once, lazily, in `selectBackend.ts` (`getSemanticBackend()`),
so importing the strategy registry never touches the filesystem and tests with
no env var keep getting the deterministic table backend.

## Quick local playtest (one command)

For laptop / offline bot playtesting, `scripts/dev-bots.mjs` (run via the npm
scripts below) does the whole setup in one step: it downloads a model **once**
(idempotent — reused on later runs, so it works offline after the first download),
**ensures a Redis is running** (reuses a reachable one, or auto-starts a managed
`eigennamen-redis` Docker container with a restart policy — so the server never
hangs reconnecting), sets `BOT_EMBEDDINGS_PATH`, and starts `npm run dev`. It is
**cross-platform pure Node** (Windows / macOS / Linux) — no bash, curl, or unzip
required (it uses Node's HTTPS download and the built-in `tar`/`unzip` that ship
with modern OSes). Use `npm run redis:up` / `npm run redis:down` to manage that
Redis on its own (e.g. for a plain `npm run dev`).

```bash
# from server/
npm run dev:bots                       # GloVe (default): fetch-if-missing, then run
npm run dev:bots -- --model=fasttext   # richer vocabulary (bigger download)
npm run dev:bots -- --trim=50000       # smaller on-disk vectors file
npm run bots:embeddings                # only prepare the model, don't start the server
```

Knobs (flags win over env): `--model` / `BOT_MODEL` (`glove` default | `fasttext`)
and `--trim` / `BOT_TRIM` (keep the first N vectors to save disk; default `100000`).
Only frequency-ordered models are offered here, because the loader keeps the first
N vectors — for GloVe/fastText that means the most common N words. For ConceptNet
Numberbatch (alphabetical), use `scripts/fetch-bot-embeddings.sh` instead. The first
download is large (GloVe ~830 MB zip); after that the git-ignored
`server/src/bots/data/` file is reused with no network access. Run `npm install`
(or `npm run setup`) first if you haven't installed deps / created `.env`.

## Enabling embeddings

> The manual steps below are what `npm run dev:bots` automates — use them if you
> want finer control or a custom model file.

1. Fetch a model (large; stored under the git-ignored `server/src/bots/data/`):

   ```bash
   scripts/fetch-bot-embeddings.sh glove           # GloVe 6B 100d (~330 MB)
   scripts/fetch-bot-embeddings.sh fasttext        # fastText wiki-news 300d 1M
   scripts/fetch-bot-embeddings.sh numberbatch     # ConceptNet Numberbatch EN
   scripts/fetch-bot-embeddings.sh glove --trim 100000   # keep top-N (most common)
   ```

2. Point the server at it (path is relative to `server/`):

   ```bash
   export BOT_EMBEDDINGS_PATH=src/bots/data/glove.6B.100d.vec
   ```

3. Restart. On first bot creation you'll see a log line like
   `Bot embeddings loaded: 50000 vectors, 2000 clue candidates`. If the file is
   missing or unreadable the server logs a warning and falls back to the table —
   bots keep working either way.

The same env var applies to the headless trainer (`npm run bots:train`), so you
can benchmark a vector-backed spymaster against table-backed bots.

## Supported file format

Standard whitespace-separated word-vectors text, auto-detected:

```
<count> <dim>          ← optional header (word2vec text; GloVe omits it)
king 0.12 -0.04 ...    ← one token + <dim> floats per line
queen 0.10 -0.02 ...
```

- ConceptNet `/c/en/<token>` prefixes are stripped; `_`-joined phrases skipped.
- Tokens are NFKC-normalised and uppercased to match board words.
- Vectors are L2-normalised at load, so relatedness is one dot product.

## Deploying with embeddings (Docker / Fly.io)

`server/src/bots/data/` is git-ignored and not copied into the image, so a local
`BOT_EMBEDDINGS_PATH` won't resolve in a container. Instead, **bake** the vectors
into the image at build time with a build-arg (off by default — the normal build is
unchanged and downloads nothing):

```bash
# Docker (build context = repo root)
docker build --build-arg BOT_EMBEDDINGS_MODEL=glove -f server/Dockerfile -t eigennamen .
# then run with the path set:
docker run -e BOT_EMBEDDINGS_PATH=/app/embeddings/vectors.vec ... eigennamen
```

```bash
# docker compose — one command sets both the build-arg and the runtime path:
BOT_EMBEDDINGS_MODEL=glove BOT_EMBEDDINGS_PATH=/app/embeddings/vectors.vec \
  docker compose up -d --build
```

```bash
# Fly.io
fly deploy --build-arg BOT_EMBEDDINGS_MODEL=glove
fly secrets set BOT_EMBEDDINGS_PATH=/app/embeddings/vectors.vec
```

The bake fetches `BOT_EMBEDDINGS_MODEL` (`glove` | `fasttext`), trims to
`BOT_EMBEDDINGS_TRIM` (default 100000), and writes `/app/embeddings/vectors.vec`.
The build needs network access; it adds the model size (trimmed GloVe ≈ 130 MB) to
the image. If `BOT_EMBEDDINGS_PATH` points at a missing file the server logs a
warning and falls back to the baked table, so a misconfigured deploy still runs.

## Tuning

| Env var | Default | Purpose |
|---------|---------|---------|
| `BOT_EMBEDDINGS_PATH` | _(unset)_ | Path to the vectors file. Unset ⇒ baked table. |
| `BOT_EMBEDDINGS_MAX_WORDS` | `50000` | Cap on vectors loaded into memory. Files are frequency-ordered, so the cap keeps the most common words. The loader reads in bounded chunks and stops at the cap — a multi-GB file is never slurped whole. |
| `BOT_EMBEDDINGS_VOCAB_CAP` | `2000` | Cap on the spymaster's clue candidate list (embedding vocab ∪ table vocab). Larger ⇒ richer clues, slower per-turn scan. |

## Licensing

Embedding models are licensed by their authors — GloVe (PDDL / ODC-BY),
fastText (CC-BY-SA-3.0), ConceptNet Numberbatch (CC-BY-SA-4.0). They are **not**
bundled with this repository (the data directory is git-ignored). Review the
model's license before redistributing it with a deployment.
