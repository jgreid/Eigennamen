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
`--language <code>` (default `en`).

**Authentication**: the builder uses the Anthropic SDK's standard credential
resolution — set `ANTHROPIC_API_KEY`, or log in once with `ant auth login`.
The word-list file format matches the in-app custom list: one word per line,
blank lines and `#` comments ignored.

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

## The map document (v1)

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

- `concepts` keys are UPPERCASE common-noun clues; `proper` keys are
  display-case references (mixed case, intercaps, or canonical all-caps
  acronyms — the case is preserved and IS the signal when a bot emits one).
- `commonness` feeds the spymaster's rarity penalty via the persona
  `commonnessBias` knob, so cautious personae stick to the household names in
  your map and The Maverick reaches for the deep cuts.
- Maps are plain JSON — hand-edit them freely (add an in-joke reference your
  group loves, delete an association that keeps misfiring). The runtime
  validates the shape on load.

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
