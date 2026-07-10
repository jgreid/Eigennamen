# Bot Semantic Maps — full-strength bots on custom word lists

The bots' semantic knowledge ships as an offline association table that covers
the **default** word list. On a custom list that knowledge is useless, and the
bots degrade to character-level (lexical) similarity — playable, but the clues
are orthographic scraps. **If you want the bots to be worth a damn on custom
words, give them the list in advance**: build a semantic map for it once, drop
the map in the maps directory, and the bots play the list at full table
quality. Unprepared lists still work — you just get what you get.

## Building a map

```bash
cd server
npm run bots:map -- --words path/to/my-list.txt
```

The builder sends your list (in batches) to Claude, which curates:

- **concepts** — common-noun clue words linking 2–6 list words
  (`GALAXY → NEBULA, QUASAR`), each rated for commonness;
- **references** — pop-culture proper nouns in canonical case
  (`Vader → SABER, EMPIRE`, `NASA → ROCKET`), each rated for fame, honouring
  the [clue-capitalization house rule](../README.md#clue-capitalization-house-rule).

It runs two passes with different word groupings (so cross-batch pairs get
covered), then a targeted pass for any words still uncovered, and writes the
map to `server/src/bots/data/semantic-maps/<list-name>.json` (gitignored, like
all downloaded/generated semantic assets). It prints a coverage report and the
token cost when done.

Options: `--out <path>`, `--model <id>` (default `claude-opus-4-8`),
`--batch-size <n>` (default 60), `--passes <n>` (default 2),
`--language <code>` (default `en`), `--list-id <id>`, `--list-name "<name>"`.

If you saved the list in the in-app **word-list library** (Settings → Game →
Saved lists), pass its id via `--list-id` (and optionally `--list-name`). The
map is then filed under `<listId>.json` and stamped with those fields, mirroring
the `wordListId` provenance a game records when it is played with that list (the
recap's "Played with …" line). This is traceability today — the runtime still
merges every map by content overlap (below) — and the seed for future per-list
map selection.

**Authentication**: the builder uses the Anthropic SDK's standard credential
resolution — set `ANTHROPIC_API_KEY`, or log in once with `ant auth login`.
The word-list file format matches the in-app custom list: one word per line,
blank lines and `#` comments ignored.

## The shipped default-list map

The repository ships one committed map: `semantic-maps/default-en.json`, built
with this same pipeline over the **default English word list** (all 400
`DEFAULT_WORDS`). It upgrades default-list play everywhere — richer concept
groups than the hand-curated baked table, plus fame-rated proper references
with per-edge channels — and the production Docker image copies the
semantic-maps directory, so deployed bots load it too. Regenerate it after
changing `DEFAULT_WORDS`:

```bash
# from server/ — writes src/bots/data/semantic-maps/default-en.json
npx ts-node --transpile-only -e "import { DEFAULT_WORDS } from './src/shared/gameRules'; console.log(DEFAULT_WORDS.join('\n'))" > /tmp/default-words.txt
npm run bots:map -- --words /tmp/default-words.txt \
  --out src/bots/data/semantic-maps/default-en.json --list-name "Default (English)" --passes 3
```

Under `NODE_ENV=test` the DEFAULT maps directory is skipped so the test suite
keeps the deterministic bare table; a test opts into map behaviour by setting
`BOT_SEMANTIC_MAPS_DIR` explicitly (same principle as the embeddings
auto-detection gate in `selectBackend.ts`).

## How the runtime uses maps

On the first bot decision, the server loads **every `*.json`** in the maps
directory (`BOT_SEMANTIC_MAPS_DIR`, default `server/src/bots/data/semantic-maps`)
and merges them into one overlay in the semantic-backend chain:

```
vectors (BOT_EMBEDDINGS_PATH)?  →  custom maps  →  baked table  →  lexical
```

Merging several maps is safe: associations are pairwise facts, and a map's
entries only ever fire when its words are actually on the board. Pairs no map
knows fall through the chain unchanged, so default-list play is unaffected and
combined lists (default + custom) get the best reading either layer knows.
Invalid map files are logged and skipped — a bad map never takes the bots down.

Maps are loaded once and memoised — restart the server after adding one.

## The map document

Two versions load; `npm run bots:map` emits v2. **v1** is the original
unweighted shape (every edge loads at weight 1):

```json
{
  "version": 1,
  "language": "en",
  "words": ["NEBULA", "QUANTUM", "..."],
  "concepts": { "GALAXY": ["NEBULA", "QUASAR"] },
  "proper": { "Vader": ["SABER", "EMPIRE"], "NASA": ["ROCKET"] },
  "commonness": { "GALAXY": 1, "Vader": 0.95, "NASA": 0.9 }
}
```

**v2** carries per-edge channels (Phase 2 of
[BOT_NUANCE_PLAN.md](BOT_NUANCE_PLAN.md)) and structured proper entries; a
plain string is still a weight-1 edge, so the two styles mix freely:

```json
{
  "version": 2,
  "words": ["NEBULA", "RAY", "ENGINE", "..."],
  "concepts": {
    "MANTA": [{ "word": "RAY", "weight": 0.95, "kind": "member", "collocation": 0.9 }],
    "MOTOR": ["ENGINE", { "word": "BOX", "weight": 0.3, "kind": "compound", "collocation": 0.8 }]
  },
  "proper": {
    "Vader": { "contents": [{ "word": "SABER", "weight": 1 }], "fame": 0.95 },
    "Apollo": {
      "contents": [{ "word": "MOON", "weight": 1 }],
      "fame": 0.9,
      "rivals": [{ "referent": "Apollo Creed", "fame": 0.6, "contents": [{ "word": "FIGHTER", "weight": 1 }] }]
    }
  },
  "commonness": { "MANTA": 0.7 }
}
```

- `concepts` keys are UPPERCASE common-noun clues; `proper` keys are
  display-case references (mixed case, intercaps, or canonical all-caps
  acronyms — the case is preserved and IS the signal when a bot emits one).
- Per-edge channels (all optional, all in `(0, 1]`): `weight` — how strongly
  the clue retrieves this word at table speed; `kind` — how it retrieves it
  (`content`/`member`/`part`/`compound`/`function`/`attribute`, the
  concreteness gradient); `penetration` — the fraction of guessers who know
  THIS edge (fame-of-fact, distinct from word commonness); `collocation` —
  phrase/compound frequency of the pair ("manta ray"). Phrase completion is
  automatic for human guessers, so the bots rank retrieval by
  `max(relatedness, collocation)` on both sides of the clue channel — an
  honest collocation rating on a weak edge is valuable safety data.
- `commonness` feeds the spymaster's rarity penalty via the persona
  `commonnessBias` knob, so cautious personae stick to the household names in
  your map and The Maverick reaches for the deep cuts. A structured proper
  entry's `fame` plays the same role for that reference.
- `rivals` (Phase 3) lists OTHER referents the same clue word evokes; their
  contents pull guesses at `weight × rival fame`, so a spymaster sees that
  "Apollo" reaches FIGHTER through Apollo Creed before promising a number
  that sends a guesser there. The builder's prompt sweeps for these
  automatically ("the referent knows more than you").
- Maps are plain JSON — hand-edit them freely (add an in-joke reference your
  group loves, delete an association that keeps misfiring). The runtime
  validates the shape on load.
- `listId` / `listName` (optional): provenance stamped by `--list-id` /
  `--list-name`, tying the map to a saved word-list-library list. The loader
  logs which lists the loaded maps serve (operator visibility) but does not yet
  select a map by id — see Scope below.

## Scope and caveats

- Concepts/references only *fire* for words on the current board, so one maps
  directory can hold maps for many lists at once.
- The builder covers what it honestly can; uncovered words fall back to
  lexical similarity (the coverage report names them — consider hand-adding
  associations for those).
- Multiplayer custom lists: the Settings-menu word list is host-side state —
  whichever list is active for the host when they start (or restart) the game
  is forwarded on `game:start` and becomes the list for the whole room. This
  works identically in standalone and hosted multiplayer; the map only
  depends on the words, not on how the list reaches a game.
- **No per-list selection yet.** Because associations fire only for on-board
  words, all maps are merged into one overlay regardless of which list a game
  uses — so a game's `wordListId` (recorded since the word-list-library work)
  does not pick a specific map at runtime. `listId`/`listName` are provenance
  and operator-visibility only. Selecting a map by the game's `wordListId`
  would need a per-game backend rather than the current process-wide singleton;
  it is deliberately left as a future enhancement since merge-all is already
  correct.
