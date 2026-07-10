/**
 * Semantic-backend selection.
 *
 * Resolves which SemanticBackend the bot strategies use, as a chain:
 *
 *   vectors (BOT_EMBEDDINGS_PATH, or auto-detected at the well-known download/
 *   bake locations — see EMBEDDINGS_CANDIDATES)? → custom semantic maps? →
 *   baked table → lexical
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
import { existsSync } from 'fs';
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
/** Memoised auto-detection result (null = looked and found nothing). */
let detected: string | null | undefined;

function readNumberEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Well-known embeddings locations, relative to the server working directory,
 * most specific first. These are exactly where the project's own tooling puts
 * vectors: the distilled board artifact (`npm run bots:embeddings:board`,
 * `dev:bots --board`, the Dockerfile bake at ./embeddings/vectors.vec), then
 * the frequency-ordered full models `npm run bots:embeddings` downloads. The
 * RAW alphabetical Numberbatch file is deliberately absent: the loader's
 * maxWords cut would keep only the early alphabet — it is only usable after
 * the board distillation, which is covered by board-vectors.vec.
 */
const EMBEDDINGS_CANDIDATES = [
    join('src', 'bots', 'data', 'board-vectors.vec'),
    join('embeddings', 'vectors.vec'),
    join('src', 'bots', 'data', 'glove.6B.100d.vec'),
    join('src', 'bots', 'data', 'wiki-news-300d-1M.vec'),
];

/** First existing well-known embeddings file under `baseDir`, else null. */
export function detectEmbeddingsPath(baseDir: string = process.cwd()): string | null {
    for (const rel of EMBEDDINGS_CANDIDATES) {
        const path = join(baseDir, rel);
        if (existsSync(path)) return path;
    }
    return null;
}

/**
 * The embeddings path bots should load, or undefined for none:
 *  - BOT_EMBEDDINGS_PATH set → that path ('off'/'none'/'0'/'false'/'disabled'
 *    explicitly disables embeddings, including auto-detection);
 *  - unset → auto-detect a previously downloaded/baked vectors file at the
 *    well-known locations. Before this, a fetched model was silently IGNORED
 *    unless every server start remembered the env var (plain `npm run dev`
 *    after `npm run bots:embeddings`, or a Docker image baked with a model but
 *    started without BOT_EMBEDDINGS_PATH) — bots fell back to the table and
 *    guessed human clues by spelling. Skipped under NODE_ENV=test so the test
 *    suite stays deterministic whatever assets a developer has on disk.
 */
function resolveEmbeddingsPath(): string | undefined {
    const raw = process.env.BOT_EMBEDDINGS_PATH?.trim();
    if (raw) {
        if (/^(off|none|0|false|disabled)$/i.test(raw)) return undefined;
        return raw;
    }
    if (process.env.NODE_ENV === 'test') return undefined;
    if (detected === undefined) {
        detected = detectEmbeddingsPath();
        if (detected) {
            logger.info(
                `Bot semantics: auto-detected word embeddings at ${detected} ` +
                    '(set BOT_EMBEDDINGS_PATH to override, or BOT_EMBEDDINGS_PATH=off to disable)'
            );
        }
    }
    return detected ?? undefined;
}

/** Build (once) the cheap table/map base — the fallback used while vectors warm
 *  and the terminal backend when no embeddings path is configured. */
function buildBase(): SemanticBackend {
    if (baseCached) return baseCached;

    // Custom semantic maps overlay the baked table when present. Under
    // NODE_ENV=test the DEFAULT maps directory is skipped (the repo ships a
    // default-list map there — see docs/BOT_SEMANTIC_MAPS.md), so the test
    // suite keeps the deterministic bare table; a test that wants map
    // behaviour opts in by setting BOT_SEMANTIC_MAPS_DIR explicitly. Same
    // principle as the embeddings auto-detection gate above.
    const explicitDir = process.env.BOT_SEMANTIC_MAPS_DIR;
    const mapsDir =
        explicitDir ??
        (process.env.NODE_ENV === 'test' ? null : join(process.cwd(), 'src', 'bots', 'data', 'semantic-maps'));
    const maps = mapsDir ? loadSemanticMaps(mapsDir) : [];
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

    const path = resolveEmbeddingsPath();
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
 * When an embeddings file is configured (BOT_EMBEDDINGS_PATH) or auto-detected
 * at a well-known location, it is parsed via the async,
 * chunked loader that yields between reads; until it finishes, getSemanticBackend()
 * hands out the cheap table/map base, so a bot that acts during the load gets a
 * (weaker) working backend instead of stalling every room while the parse blocks.
 * Idempotent and safe to await; a no-op once resolved. Call once, before/at
 * `listen`, so the vectors are ready by the time rooms reconnect after a restart.
 */
export async function warmSemanticBackend(): Promise<void> {
    if (cached) return;

    const path = resolveEmbeddingsPath();
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
    detected = undefined;
}
