/**
 * Semantic-backend selection.
 *
 * Resolves which SemanticBackend the bot strategies use. If the operator points
 * BOT_EMBEDDINGS_PATH at a word-vectors file (fastText / GloVe / word2vec /
 * ConceptNet Numberbatch) it loads the vector backend; otherwise it uses the
 * offline-baked association table. Either way the strategies are unchanged — the
 * choice happens behind the SemanticBackend interface.
 *
 * Resolution is memoised: the (potentially file-reading) construction runs once,
 * lazily, on the first bot that needs a semantic strategy — never at import time,
 * so importing the registry stays side-effect-free and tests with no env var keep
 * getting the deterministic table backend.
 */
import type { SemanticBackend } from './backend';
import { tableBackend } from './tableBackend';
import { makeVectorBackend } from './vectorBackend';
import logger from '../../utils/logger';

let cached: SemanticBackend | undefined;

function readNumberEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The semantic backend for bot strategies (vector if configured, else table). */
export function getSemanticBackend(): SemanticBackend {
    if (cached) return cached;

    const path = process.env.BOT_EMBEDDINGS_PATH;
    if (path) {
        const vb = makeVectorBackend({
            path,
            maxWords: readNumberEnv('BOT_EMBEDDINGS_MAX_WORDS'),
            vocabCap: readNumberEnv('BOT_EMBEDDINGS_VOCAB_CAP'),
        });
        if (vb) {
            cached = vb;
            return vb;
        }
        // path set but the file was missing/unusable — makeVectorBackend already
        // logged why; fall through to the table so bots still function.
    }

    cached = tableBackend;
    // One-time operator visibility: weak/strong bots depend entirely on this, and
    // the difference is otherwise invisible. Logged once (the result is memoised).
    logger.info(
        'Bot semantics: using the offline association table (lexical fallback for ' +
            'uncovered words). For stronger, meaning-based clues set BOT_EMBEDDINGS_PATH ' +
            'to a word-vectors file, or run `npm run dev:bots`. See docs/BOT_EMBEDDINGS.md.'
    );
    return cached;
}

/** Test-only: drop the memoised backend so a new env configuration takes effect. */
export function resetSemanticBackendCache(): void {
    cached = undefined;
}
