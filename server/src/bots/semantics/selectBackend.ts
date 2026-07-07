/**
 * Semantic-backend selection.
 *
 * Resolves which SemanticBackend the bot strategies use, as a chain:
 *
 *   vectors (BOT_EMBEDDINGS_PATH)? → custom semantic maps? → baked table → lexical
 *
 * Custom semantic maps are per-word-list association tables built offline by
 * `npm run bots:map` (an LLM curates concepts + references over a custom word
 * list — see docs/BOT_SEMANTIC_MAPS.md). Every *.json in the maps directory
 * (BOT_SEMANTIC_MAPS_DIR, default src/bots/data/semantic-maps under the server
 * cwd) is merged into one overlay, so bots reach full table-quality play on
 * any custom list that was prepared in advance; unprepared lists fall through
 * to the lexical floor as before ("otherwise you get what you get").
 *
 * Resolution is memoised: the (potentially file-reading) construction runs once,
 * lazily, on the first bot that needs a semantic strategy — never at import time,
 * so importing the registry stays side-effect-free and tests with no env var keep
 * getting the deterministic table backend.
 */
import { join } from 'path';
import type { SemanticBackend } from './backend';
import { tableBackend } from './tableBackend';
import { makeVectorBackend } from './vectorBackend';
import { loadSemanticMaps, makeCustomMapBackend } from './mapBackend';
import logger from '../../utils/logger';

let cached: SemanticBackend | undefined;

function readNumberEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The semantic backend for bot strategies (see the chain above). */
export function getSemanticBackend(): SemanticBackend {
    if (cached) return cached;

    // Custom semantic maps overlay the baked table when present.
    const mapsDir = process.env.BOT_SEMANTIC_MAPS_DIR ?? join(process.cwd(), 'src', 'bots', 'data', 'semantic-maps');
    const maps = loadSemanticMaps(mapsDir);
    const base = maps.length > 0 ? makeCustomMapBackend(maps, tableBackend) : tableBackend;

    if (maps.length > 0) {
        // One-time operator visibility (memoised): which saved lists the loaded
        // maps serve. Prefer the map's declared list name/id (built with
        // `--list-id`/`--list-name`), else its source wordlist, else its size.
        const summarize = (m: (typeof maps)[number]): string =>
            m.listName ?? m.listId ?? (typeof m.wordlist === 'string' ? m.wordlist : `${m.words.length} words`);
        logger.info(`Bot semantics: loaded ${maps.length} custom semantic map(s): ${maps.map(summarize).join(', ')}`);
    }

    const path = process.env.BOT_EMBEDDINGS_PATH;
    if (path) {
        const vb = makeVectorBackend({
            path,
            fallback: base,
            maxWords: readNumberEnv('BOT_EMBEDDINGS_MAX_WORDS'),
            vocabCap: readNumberEnv('BOT_EMBEDDINGS_VOCAB_CAP'),
        });
        if (vb) {
            cached = vb;
            return vb;
        }
        // path set but the file was missing/unusable — makeVectorBackend already
        // logged why; fall through so bots still function.
    }

    cached = base;
    if (base === tableBackend) {
        // One-time operator visibility: weak/strong bots depend entirely on this,
        // and the difference is otherwise invisible. Logged once (memoised).
        logger.info(
            'Bot semantics: using the offline association table (lexical fallback for ' +
                'uncovered words). For stronger, meaning-based clues set BOT_EMBEDDINGS_PATH ' +
                'to a word-vectors file, or run `npm run dev:bots`. For custom word lists, ' +
                'build a semantic map with `npm run bots:map`. See docs/BOT_EMBEDDINGS.md ' +
                'and docs/BOT_SEMANTIC_MAPS.md.'
        );
    }
    return cached;
}

/** Test-only: drop the memoised backend so a new env configuration takes effect. */
export function resetSemanticBackendCache(): void {
    cached = undefined;
}
