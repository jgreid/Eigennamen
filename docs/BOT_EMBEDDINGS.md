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
   loads. Out-of-vocabulary words drop to ↓. Only this tier implements
   `nearest(words, k)`, which lets the spymaster **generate** board-specific
   candidate clues from the whole model vocabulary (words near its own cards)
   instead of merely scoring a fixed list — the main reason embeddings produce
   much stronger, more creative clues. Table/lexical backends omit `nearest()`,
   so the spymaster falls back to scanning the fixed `vocabulary()` there.
2. **Custom semantic maps** (`mapBackend.ts`) — an overlay built offline for a
   specific custom word list by `npm run bots:map` (see
   [BOT_SEMANTIC_MAPS.md](BOT_SEMANTIC_MAPS.md)). Present only when a maps
   directory is configured; pairs a map knows score at table quality, everything
   else drops to ↓.
3. **Baked association table** (`tableBackend.ts`) — a curated clue→words map.
   Unknown pairs drop to ↓.
4. **Lexical** (`backend.ts`) — Sørensen–Dice over character bigrams. Always
   available, language-agnostic, weak.

The choice is made once, lazily, in `selectBackend.ts` (`getSemanticBackend()`),
so importing the strategy registry never touches the filesystem and tests with
no env var keep getting the deterministic table backend.

**Which backend am I using?** The first time a bot needs semantics, the server
logs it once: `Bot embeddings loaded: …` when vectors are active, or
`Bot semantics: using the offline association table …` otherwise. If your bots
feel weak — especially on a **custom word list**, which the baked table can't
cover and which therefore falls all the way to lexical — that log is the signal
to enable embeddings (below).

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

## Board-restricted vectors (recommended: small & full-coverage)

A generic `--trim N` keeps the model's first N vectors — fine for GloVe/fastText
(frequency-ordered, so N = the N most common words) but wasteful for a word
game and **broken for Numberbatch**, whose alphabetical order makes a first-N
cut keep only the early alphabet (missing most board words). `COLD↔PENGUIN` —
the everyday lateral the offline table can't see — only helps if PENGUIN and
COLD both have vectors.

`scripts/build-board-vectors.mjs` (`npm run bots:embeddings:board`) distils a
downloaded model down to exactly what the game needs:

1. **Guaranteed** — every single-token board word across all locales
   (`DEFAULT_WORDS` + `wordlist-{de,es,fr}.txt`) and every baked association
   concept key, so scored *and* generated clues are graded by real vectors.
2. **Breadth** — a sample of the rest of the model's word-like English tokens
   (default 40 000), so the spymaster's `nearest()` clue generation has a wide
   candidate pool.

```bash
# from repo root, after fetching a model (Numberbatch fits this task best —
# it's a common-sense knowledge graph, so COLD~PENGUIN is a real edge):
scripts/fetch-bot-embeddings.sh numberbatch
node scripts/build-board-vectors.mjs \
  --in server/src/bots/data/numberbatch-en-19.08.vec \
  --out server/src/bots/data/board-vectors.vec --breadth 40000
export BOT_EMBEDDINGS_PATH=src/bots/data/board-vectors.vec   # relative to server/
```

The result is a few tens of MB (vs. hundreds), loads in ~35 MB RAM, and covers
every English board/concept word. `--breadth` trades file size for clue-
generation richness (≈25 MB at 15 000, ≈66 MB at 40 000) — board-word coverage
is unaffected either way, so the leak-closing benefit holds at any breadth.

### Commonness prior with an alphabetical source (`--freq`)

An alphabetical source like Numberbatch carries no frequency signal, so the
runtime loader disables its rank-based commonness prior and nothing taxes an
obscure generated clue (e.g. `OVERBOUGHT`), and a uniform stride can sample such
words into the candidate pool in the first place. Pass a frequency-ordered
reference — any GloVe/fastText `.vec`, whose lines are most-frequent-first — to
close both ends model-independently:

```bash
scripts/fetch-bot-embeddings.sh glove          # a frequency-ordered reference
node scripts/build-board-vectors.mjs \
  --in server/src/bots/data/numberbatch-en-19.08.vec \
  --freq server/src/bots/data/glove.6B.100d.vec --freq-top 60000 \
  --out server/src/bots/data/board-vectors.vec --breadth 40000
```

With `--freq` the breadth sample is drawn **only** from the reference's common
region (so obscurities never become candidates), and the output is written
**most-common-first** so the loader detects a frequency ordering and re-enables
its commonness prior — grading whatever survives by real word frequency. Without
`--freq` the output is alphabetical and the loader leaves the prior off (rather
than reading meaning into a non-frequency order). Board-word coverage is
identical either way; `--freq-top` (default 60 000) bounds how much of the
reference counts as "common."

The extractor reads only the **leading token** of each `--freq` line (the vectors
are ignored), so the reference does not have to be an embedding model — any
frequency-ordered token list works, in the same `token <anything>` per-line
shape. That matters when GloVe/fastText aren't downloadable: a compact list from
the [`wordfreq`](https://pypi.org/project/wordfreq/) package (purpose-built for
commonness) is a strong, tiny reference:

```bash
python3 - <<'PY'
import wordfreq
with open('server/src/bots/data/freq-en.vec', 'w') as f:
    for w in wordfreq.top_n_list('en', 80000):
        if 2 <= len(w) <= 15 and all(c.isalpha() or c in "'.-" for c in w):
            f.write(f"{w.upper()} 1\n")   # placeholder value keeps the row shape
PY
node scripts/build-board-vectors.mjs \
  --in server/src/bots/data/numberbatch-en-19.08.vec \
  --freq server/src/bots/data/freq-en.vec --freq-top 60000 \
  --out server/src/bots/data/board-vectors.vec --breadth 40000
```

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
| `BOT_EMBEDDINGS_MAX_WORDS` | `50000` | Cap on vectors loaded into memory. The loader reads in bounded chunks and stops at the cap — a multi-GB file is never slurped whole. For **frequency-ordered** files (GloVe/fastText) the cap keeps the most common words; for **alphabetical** files (Numberbatch) it keeps the early alphabet AND the loader disables its commonness prior — so build a `board-vectors.vec` with `npm run bots:embeddings:board` (optionally `--freq`) instead of relying on a raw cap. |
| `BOT_EMBEDDINGS_VOCAB_CAP` | `2000` | Cap on the spymaster's clue candidate list (embedding vocab ∪ table vocab). Larger ⇒ richer clues, slower per-turn scan. |

## Licensing

Embedding models are licensed by their authors — GloVe (PDDL / ODC-BY),
fastText (CC-BY-SA-3.0), ConceptNet Numberbatch (CC-BY-SA-4.0). They are **not**
bundled with this repository (the data directory is git-ignored). Review the
model's license before redistributing it with a deployment.
