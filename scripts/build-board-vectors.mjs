#!/usr/bin/env node
/**
 * build-board-vectors.mjs — distil a large word-embedding model down to a
 * small, game-specific vectors file.
 *
 * Shipping a generic 50k-vector model (what `--trim` on the fetch scripts
 * produces) is wasteful for a word game and STILL misses board words when the
 * source is alphabetical (Numberbatch), because a first-N cut keeps only the
 * early alphabet. This tool instead keeps, from a downloaded model:
 *
 *   1. GUARANTEED — every single-token board word across all locales
 *      (English DEFAULT_WORDS + wordlist-{de,es,fr}.txt) and every baked
 *      association concept key. This is what gives the bots real vectors for
 *      the exact words a game uses — so COLD↔PENGUIN (which the offline table
 *      cannot see) scores correctly, and leaky clues get rejected.
 *   2. BREADTH — a uniform stride sample of the rest of the model's
 *      word-like English tokens, up to a budget, so the spymaster's nearest()
 *      clue generation has an alphabet-wide candidate pool (not just the early
 *      alphabet a first-N cut would keep).
 *
 * The result is a few MB (vs. hundreds), loads fast, and covers exactly what
 * the game needs. Point the bots at it with BOT_EMBEDDINGS_PATH.
 *
 * Usage (from repo root or server/):
 *   node scripts/build-board-vectors.mjs --in <model.vec[.gz]> [--out <path>]
 *     [--breadth 40000]
 */
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (flag, def) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const inPath = arg('--in', null);
if (!inPath) {
    console.error('Usage: node scripts/build-board-vectors.mjs --in <model.vec[.gz]> [--out <path>] [--breadth N]');
    process.exit(2);
}
const outPath = resolve(arg('--out', join(ROOT, 'server', 'src', 'bots', 'data', 'board-vectors.vec')));
const breadth = Math.max(0, parseInt(arg('--breadth', '40000'), 10) || 0);

// --- Normalisation: match the runtime loader (NFKC, uppercase, /c/en/ strip) ---
const norm = (t) => t.normalize('NFKC').replace(/^\/c\/[a-z]+\//, '').replace(/[_\s]+/g, ' ').trim().toLocaleUpperCase('en-US');

// --- Build the guaranteed target set --------------------------------------
const target = new Set();

// English board words: parse DEFAULT_WORDS out of gameRules.ts (same approach
// as generate-associations.mjs).
const grc = readFileSync(join(ROOT, 'server/src/shared/gameRules.ts'), 'utf8');
const dw = grc.match(/DEFAULT_WORDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
if (dw) for (const m of dw[1].match(/'[^']+'/g) || []) target.add(norm(m.replace(/'/g, '')));

// Locale board words.
for (const loc of ['de', 'es', 'fr']) {
    const p = join(ROOT, `server/public/locales/wordlist-${loc}.txt`);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const w = line.trim();
        if (w && !w.startsWith('#')) target.add(norm(w));
    }
}

// Baked association concept keys — the bot's curated clue vocabulary; give them
// real vectors so scored/generated clues are graded by embeddings too.
const assoc = readFileSync(join(ROOT, 'server/src/bots/semantics/associations.ts'), 'utf8');
for (const m of assoc.match(/^\s{4}([A-Z][A-Z]+):/gm) || []) target.add(norm(m.replace(/[:\s]/g, '')));

// Single-token targets only — the loader skips multi-word/underscore tokens,
// so a "NEW YORK" board word can never match a vector anyway.
const wantWord = (u) => target.has(u) && !u.includes(' ');
const guaranteed = new Set([...target].filter((u) => !u.includes(' ')));

console.log(`Target: ${guaranteed.size} single-token board/concept words; breadth sample budget ${breadth}.`);

// --- Stream the model, keep guaranteed + a uniform stride sample -----------
const isGz = inPath.endsWith('.gz');
const rawStream = createReadStream(resolve(inPath));
const stream = isGz ? rawStream.pipe(createGunzip()) : rawStream;
const rl = createInterface({ input: stream, crlfDelay: Infinity });

const kept = [];
const keptWords = new Set();
let dim = 0;
let lineNo = 0;
let sampleStride = 0;
// First pass estimate is unknown; use a fixed stride derived from breadth over
// an assumed ~500k english vocab so the sample is alphabet-wide and bounded.
const ASSUMED_VOCAB = 500000;
const stride = breadth > 0 ? Math.max(1, Math.floor(ASSUMED_VOCAB / breadth)) : Infinity;
const wordlike = (u) => /^[A-Z][A-Z'.-]{1,14}$/.test(u); // single common-word-ish token

await new Promise((res, rej) => {
    rl.on('line', (line) => {
        lineNo++;
        if (lineNo === 1 && /^\d+\s+\d+\s*$/.test(line)) {
            dim = parseInt(line.trim().split(/\s+/)[1], 10);
            return; // header
        }
        const sp = line.indexOf(' ');
        if (sp <= 0) return;
        const rawTok = line.slice(0, sp);
        const u = norm(rawTok);
        if (!u || u.includes(' ') || keptWords.has(u)) return;
        if (dim === 0) dim = line.trim().split(/\s+/).length - 1;
        const isGuaranteed = wantWord(u);
        let takeSample = false;
        if (!isGuaranteed && breadth > 0 && wordlike(u) && Number.isFinite(stride)) {
            takeSample = sampleStride % stride === 0;
            sampleStride++;
        }
        if (isGuaranteed || takeSample) {
            // Re-emit with the normalized (uppercase, prefix-stripped) token so
            // the file matches how the runtime loader keys everything.
            kept.push(`${u} ${line.slice(sp + 1).trim()}`);
            keptWords.add(u);
        }
    });
    rl.on('close', res);
    rl.on('error', rej);
});

const coveredBoard = [...guaranteed].filter((u) => keptWords.has(u));
const missing = [...guaranteed].filter((u) => !keptWords.has(u));

const header = `${kept.length} ${dim}\n`;
writeFileSync(outPath, header + kept.join('\n') + '\n');
console.log(`Wrote ${outPath}`);
console.log(`  ${kept.length} vectors (dim ${dim}); board/concept coverage ${coveredBoard.length}/${guaranteed.size}.`);
if (missing.length) {
    console.log(`  ${missing.length} target words had no vector (fall back to table/lexical): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);
}
