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

For laptop / offline bot playtesting, `scripts/dev-bots.sh` does the whole setup in
one step: it downloads a model **once** (idempotent — reused on later runs, so it
works offline after the first download), exports `BOT_EMBEDDINGS_PATH`, and starts
`npm run dev`.

```bash
npm run dev:bots                          # from server/ — fetch-if-missing, then run
BOT_MODEL=numberbatch npm run dev:bots    # stronger word-association model
npm run bots:embeddings                   # only prepare the model, don't start the server
```

Knobs: `BOT_MODEL` (`glove` default | `fasttext` | `numberbatch`) and `BOT_TRIM`
(keep the first N vectors to save disk; default `100000`). The first download is
large (GloVe ~830 MB zip); after that the git-ignored `server/src/bots/data/` file
is reused with no network access. Run `npm run setup` first if you haven't installed
deps / created `.env`.

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
