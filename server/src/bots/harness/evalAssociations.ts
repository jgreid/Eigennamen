/**
 * Offline human-association eval (ledger lesson 2.7's open half — see
 * docs/BOT_CLUE_LESSONS.md): score each semantic backend against a HUMAN
 * word-association dataset, so backend choice/tuning is graded by what people
 * actually retrieve ("fossil → dinosaur"), not by corpus co-occurrence
 * ("fossil → fuel"). Run before tuning anything downstream — this re-grades
 * everything built on relatedness.
 *
 * Datasets are NOT bundled (research licenses): download one locally and pass
 * it with --norms. Accepted formats, auto-detected from the header:
 *  - Small World of Words processed R1 strength file (smallworldofwords.org →
 *    Research → English data): columns cue / response / R1.Strength, TSV or CSV.
 *  - USF Free Association Norms appendix files (Cue_Target_Pairs.*): columns
 *    CUE, TARGET, …, FSG.
 *  - Generic CSV/TSV with header columns cue, response, strength.
 *
 * Two game-shaped metrics per backend:
 *  - spearman: rank correlation between the backend's guessRetrieval and human
 *    forward strength over (cue → board-word) pairs — does the backend ORDER
 *    associations the way people do?
 *  - top1 / mrr: for each cue, its strongest board-word response is hidden
 *    among seeded random board-word distractors (a 25-card board shape); does
 *    the backend's argmax find the card a human's mind jumps to?
 *
 * Usage (from server/):
 *   npm run bots:eval -- --norms <file> [--distractors 24] [--seed eval]
 *     [--max-cues 4000] [--all-responses]
 */
import { clueRetrieval, guessRetrieval, lexicalBackend, type SemanticBackend } from '../semantics/backend';
import { tableBackend } from '../semantics/tableBackend';
import { getSemanticBackend } from '../semantics/selectBackend';
import { normalizeClueWord, DEFAULT_WORDS } from '../../shared/gameRules';
import { hashString } from '../../services/game/boardGenerator';
import { makeRng } from '../rng';

export interface NormPair {
    /** Normalized cue word (the "clue"). */
    cue: string;
    /** Normalized response word (what humans retrieve from the cue). */
    response: string;
    /** Human forward strength in (0, 1] (fraction of respondents). */
    strength: number;
}

/** Split one delimited line, honouring the file's delimiter. */
function splitLine(line: string, delim: string): string[] {
    return line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
}

/**
 * Parse a norms file into (cue, response, strength) pairs. Format is detected
 * from the header row: any file whose header names a cue column, a
 * response/target column, and a strength/FSG column loads — this covers the
 * SWOW processed strength files, the USF appendix files, and any hand-made
 * generic CSV/TSV. Multi-word cues/responses and malformed rows are skipped
 * (board words are single tokens; a phrase can never be a card).
 */
export function parseNorms(text: string): NormPair[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];
    const headerLine = lines[0] as string;
    const delim = headerLine.includes('\t') ? '\t' : ',';
    const header = splitLine(headerLine, delim).map((h) => h.toLowerCase());

    const findCol = (...names: string[]): number => {
        for (const name of names) {
            const i = header.indexOf(name);
            if (i >= 0) return i;
        }
        return -1;
    };
    const cueCol = findCol('cue');
    const respCol = findCol('response', 'target');
    const strengthCol = findCol('r1.strength', 'strength', 'fsg');
    if (cueCol < 0 || respCol < 0 || strengthCol < 0) return [];

    const out: NormPair[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = splitLine(lines[i] as string, delim);
        const cue = normalizeClueWord(cols[cueCol] ?? '');
        const response = normalizeClueWord(cols[respCol] ?? '');
        const strength = Number(cols[strengthCol]);
        if (!cue || !response || cue === response) continue;
        if (/\s/.test(cue) || /\s/.test(response)) continue;
        if (!Number.isFinite(strength) || strength <= 0 || strength > 1) continue;
        out.push({ cue, response, strength });
    }
    return out;
}

/** Spearman rank correlation with average ranks for ties. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
    const n = xs.length;
    if (n < 3 || n !== ys.length) return 0;
    const ranks = (vs: readonly number[]): number[] => {
        const order = vs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const r = new Array<number>(n);
        let i = 0;
        while (i < n) {
            let j = i;
            while (j + 1 < n && (order[j + 1] as { v: number }).v === (order[i] as { v: number }).v) j++;
            const avg = (i + j) / 2 + 1; // average rank of the tie run (1-based)
            for (let k = i; k <= j; k++) r[(order[k] as { i: number }).i] = avg;
            i = j + 1;
        }
        return r;
    };
    const rx = ranks(xs);
    const ry = ranks(ys);
    const mean = (n + 1) / 2;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let k = 0; k < n; k++) {
        const a = (rx[k] as number) - mean;
        const b = (ry[k] as number) - mean;
        num += a * b;
        dx += a * a;
        dy += b * b;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

export interface EvalOptions {
    /** Distractor board words per retrieval trial (default 24: a board shape). */
    distractors?: number;
    /** Seed for the deterministic distractor sample. */
    seed?: string;
    /** Cap on evaluated cues (retrieval metric), for quick runs. */
    maxCues?: number;
    /** Vocabulary the responses must belong to (default DEFAULT_WORDS). */
    vocabulary?: readonly string[];
}

export interface BackendEvalResult {
    backend: string;
    /** (cue → board word) pairs used for the correlation. */
    pairs: number;
    spearman: number;
    /** Retrieval trials (one per cue with an in-vocabulary response). */
    cues: number;
    top1: number;
    mrr: number;
}

/**
 * Evaluate one backend against the norms. Only pairs whose RESPONSE is a board
 * word are used — the cue plays the human clue, the response the card a human
 * mind jumps to — so the score reflects the exact lookup the game makes.
 */
export function evaluateBackend(
    id: string,
    backend: SemanticBackend,
    norms: readonly NormPair[],
    opts: EvalOptions = {}
): BackendEvalResult {
    const vocabulary = opts.vocabulary ?? DEFAULT_WORDS;
    const vocabSet = new Set(vocabulary.map((w) => normalizeClueWord(w)));
    const distractorPool = [...vocabSet];
    const distractors = opts.distractors ?? 24;
    const rng = makeRng(hashString(opts.seed ?? 'eval'));

    const inVocab = norms.filter((p) => vocabSet.has(p.response));

    // Correlation over all in-vocabulary pairs.
    const human: number[] = [];
    const model: number[] = [];
    for (const p of inVocab) {
        human.push(p.strength);
        model.push(guessRetrieval(backend, p.cue, p.response));
    }

    // Retrieval: per cue, the strongest response hidden among distractors.
    const byCue = new Map<string, NormPair>();
    for (const p of inVocab) {
        const best = byCue.get(p.cue);
        if (!best || p.strength > best.strength) byCue.set(p.cue, p);
    }
    const responsesOf = new Map<string, Set<string>>();
    for (const p of inVocab) {
        let set = responsesOf.get(p.cue);
        if (!set) {
            set = new Set();
            responsesOf.set(p.cue, set);
        }
        set.add(p.response);
    }

    let trials = 0;
    let hits = 0;
    let mrrSum = 0;
    const maxCues = opts.maxCues ?? Infinity;
    for (const [cue, truth] of byCue) {
        if (trials >= maxCues) break;
        const known = responsesOf.get(cue) as Set<string>;
        // Board-shaped candidate set: the true card + seeded distractors that are
        // NOT also known responses of this cue (a second true association ranked
        // first would be a correct read, not an error).
        const board: string[] = [truth.response];
        let guard = 0;
        while (board.length < 1 + distractors && guard++ < distractors * 30) {
            const w = distractorPool[rng.int(distractorPool.length)] as string;
            if (w !== cue && !known.has(w) && !board.includes(w)) board.push(w);
        }
        if (board.length < 2) continue;
        // Optimistic rank: 1 + strictly-better distractors. A coarse backend
        // (the table) legitimately ties several true edges at the same score;
        // a tie with the truth is a found card, not a miss.
        const truthScore = clueRetrieval(backend, cue, truth.response);
        let better = 0;
        for (const w of board) {
            if (w !== truth.response && clueRetrieval(backend, cue, w) > truthScore) better++;
        }
        const rank = 1 + better;
        trials++;
        if (rank === 1) hits++;
        mrrSum += 1 / rank;
    }

    return {
        backend: id,
        pairs: inVocab.length,
        spearman: Math.round(spearman(model, human) * 1000) / 1000,
        cues: trials,
        top1: trials > 0 ? Math.round((hits / trials) * 1000) / 1000 : 0,
        mrr: trials > 0 ? Math.round((mrrSum / trials) * 1000) / 1000 : 0,
    };
}

/** The backend roster the CLI compares: each tier of the runtime chain. */
export function backendRoster(): Array<{ id: string; backend: SemanticBackend }> {
    const roster: Array<{ id: string; backend: SemanticBackend }> = [
        { id: 'lexical', backend: lexicalBackend },
        { id: 'table', backend: tableBackend },
    ];
    // The full runtime chain (vectors/maps included when configured/detected).
    const full = getSemanticBackend();
    if (full !== tableBackend) roster.push({ id: `full chain (${full.id})`, backend: full });
    return roster;
}

/* istanbul ignore next -- CLI entry, exercised manually via `npm run bots:eval` */
/* eslint-disable no-console -- CLI entry: the console IS the output channel */
async function main(): Promise<void> {
    const fs = await import('fs');

    const argv = process.argv.slice(2);
    const arg = (flag: string, def: string): string => {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : def;
    };
    const normsPath = arg('--norms', '');
    if (!normsPath) {
        console.error('Usage: npm run bots:eval -- --norms <file> [--distractors 24] [--seed eval] [--max-cues 4000]');
        console.error('');
        console.error('Download a human word-association dataset first (not bundled — research licenses):');
        console.error('  - SWOW-EN R1 strength file: smallworldofwords.org → Research → English data');
        console.error('  - USF Free Association Norms appendix (Cue_Target_Pairs.*)');
        process.exit(2);
    }

    const norms = parseNorms(fs.readFileSync(normsPath, 'utf8'));
    if (norms.length === 0) {
        console.error(`No usable (cue, response, strength) rows found in ${normsPath}.`);
        console.error('Expected a header naming cue, response/target, and strength/FSG/R1.Strength columns.');
        process.exit(2);
    }

    const opts: EvalOptions = {
        distractors: parseInt(arg('--distractors', '24'), 10),
        seed: arg('--seed', 'eval'),
        maxCues: parseInt(arg('--max-cues', '4000'), 10),
    };

    console.log(`Loaded ${norms.length} association pairs from ${normsPath}.`);
    console.log(`Scoring against the ${DEFAULT_WORDS.length}-word default board vocabulary…\n`);
    const results = backendRoster().map(({ id, backend }) => evaluateBackend(id, backend, norms, opts));
    console.table(results);
    console.log(
        'spearman: rank agreement with human forward strength (higher is better).\n' +
            'top1/mrr: how often the human top response wins a board-shaped lineup of ' +
            `${opts.distractors} distractors (higher is better).`
    );
}
/* eslint-enable no-console */

if (require.main === module) {
    void main();
}
