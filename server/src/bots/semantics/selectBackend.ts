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
import { makeVectorBackend, makeVectorBackendAsync } from './vectorBackend';
import { loadSemanticMaps, makeCustomMapBackend } from './mapBackend';
import logger from '../../utils/logger';

/** The fully-resolved backend (with vectors if configured), once available. */
let cached: SemanticBackend | undefined;
/** The cheap table/map fallback, built once and served while vectors warm. */
let baseCached: SemanticBackend | undefined;
/** In-flight async vector warm (N20). While non-null, getSemanticBackend()
 *  serves the base instead of triggering a blocking synchronous parse. */
let warming: Promise<void> | null = null;

function readNumberEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Build (once) the cheap table/map base — the fallback used while vectors warm
 *  and the terminal backend when no embeddings path is configured. */
function buildBase(): SemanticBackend {
    if (baseCached) return baseCached;

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

    baseCached = base;
    return base;
}

/** One-time operator note that bots are running on the table (no embeddings). */
function logTableFallback(base: SemanticBackend): void {
    if (base === tableBackend) {
        logger.info(
            'Bot semantics: using the offline association table (lexical fallback for ' +
                'uncovered words). For stronger, meaning-based clues set BOT_EMBEDDINGS_PATH ' +
                'to a word-vectors file, or run `npm run dev:bots`. For custom word lists, ' +
                'build a semantic map with `npm run bots:map`. See docs/BOT_EMBEDDINGS.md ' +
                'and docs/BOT_SEMANTIC_MAPS.md.'
        );
    }
}

/**
 * The semantic backend for bot strategies (see the chain above).
 *
 * If a non-blocking warm (`warmSemanticBackend`) is loading the vectors, this
 * serves the cheap base until the warm finishes — it never triggers the
 * multi-GB synchronous vector parse on a live tick (N20). When no warm was
 * requested (tests, or a caller reaching for the backend directly), it resolves
 * synchronously as before so behaviour is unchanged.
 */
export function getSemanticBackend(): SemanticBackend {
    if (cached) return cached;

    const path = process.env.BOT_EMBEDDINGS_PATH;
    if (path && warming) {
        // Vectors are warming off the event loop; serve the base for now. Not
        // memoised into `cached` — the warm sets that when it completes.
        return buildBase();
    }

    const base = buildBase();
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
    logTableFallback(base);
    return cached;
}

/**
 * Warm the semantic backend at bootstrap WITHOUT blocking the event loop (N20).
 *
 * When `BOT_EMBEDDINGS_PATH` is set, the vector file is parsed via the async,
 * chunked loader that yields between reads; until it finishes, getSemanticBackend()
 * hands out the cheap table/map base, so a bot that acts during the load gets a
 * (weaker) working backend instead of stalling every room while the parse blocks.
 * Idempotent and safe to await; a no-op once resolved. Call once, before/at
 * `listen`, so the vectors are ready by the time rooms reconnect after a restart.
 */
export async function warmSemanticBackend(): Promise<void> {
    if (cached) return;

    const path = process.env.BOT_EMBEDDINGS_PATH;
    if (!path) {
        // Nothing heavy to warm — resolve the cheap backend eagerly so even the
        // table/map construction is paid at bootstrap, not on the first tick.
        getSemanticBackend();
        return;
    }

    if (!warming) {
        warming = (async () => {
            const base = buildBase();
            try {
                const vb = await makeVectorBackendAsync({
                    path,
                    fallback: base,
                    maxWords: readNumberEnv('BOT_EMBEDDINGS_MAX_WORDS'),
                    vocabCap: readNumberEnv('BOT_EMBEDDINGS_VOCAB_CAP'),
                });
                cached = vb ?? base;
                if (!vb) logTableFallback(base);
                else logger.info('Bot semantics: word-embedding vectors warmed and active');
            } catch (err) {
                logger.warn('Bot semantics: async embeddings warm failed, using fallback backend', {
                    error: err instanceof Error ? err.message : String(err),
                });
                cached = base;
                logTableFallback(base);
            } finally {
                warming = null;
            }
        })();
    }
    await warming;
}

/** Test-only: drop the memoised backend so a new env configuration takes effect. */
export function resetSemanticBackendCache(): void {
    cached = undefined;
    baseCached = undefined;
    warming = null;
}
