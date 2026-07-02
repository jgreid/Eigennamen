#!/usr/bin/env node
/**
 * build-semantic-map.mjs — offline semantic-map builder for custom word lists.
 *
 * Give the bots your custom word list IN ADVANCE and this tool uses an LLM
 * (Claude) to build the same kind of association table the bots ship with for
 * the default list: common-sense concept groups (GALAXY → NEBULA, QUASAR) plus
 * fame-rated pop-culture references in canonical case (Vader → SABER, EMPIRE),
 * honouring the clue-capitalization house rule. The output JSON drops into the
 * bot runtime's semantic-maps directory, where it is loaded and merged at
 * startup — see docs/BOT_SEMANTIC_MAPS.md and server/src/bots/semantics/
 * mapBackend.ts. Without a prepared map, custom lists degrade to the lexical
 * floor; with one, bots play at full table quality.
 *
 * Usage (from server/):
 *   npm run bots:map -- --words path/to/list.txt [--out path.json]
 *     [--model claude-opus-4-8] [--batch-size 60] [--passes 2] [--language en]
 *
 * Auth: uses the Anthropic SDK's standard credential resolution — set
 * ANTHROPIC_API_KEY, or log in once with `ant auth login`.
 *
 * The word-list format matches the in-app custom list: one word per line,
 * blank lines and `#` comments ignored.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// The SDK is a devDependency of server/ — resolve through its package.
const require = createRequire(join(ROOT, 'server', 'package.json'));
const Anthropic = require('@anthropic-ai/sdk');

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (flag, def) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const wordsPath = arg('--words', null);
if (!wordsPath) {
    console.error('Usage: npm run bots:map -- --words <wordlist.txt> [--out <map.json>]');
    console.error('       [--model claude-opus-4-8] [--batch-size 60] [--passes 2] [--language en]');
    process.exit(2);
}
const model = arg('--model', 'claude-opus-4-8');
const batchSize = Math.max(10, parseInt(arg('--batch-size', '60'), 10) || 60);
const passes = Math.max(1, parseInt(arg('--passes', '2'), 10) || 2);
const language = arg('--language', 'en');
const outPath = resolve(
    arg(
        '--out',
        join(ROOT, 'server', 'src', 'bots', 'data', 'semantic-maps', `${basename(wordsPath).replace(/\.[^.]*$/, '')}.json`)
    )
);

// ---------------------------------------------------------------------------
// Word list parsing (mirrors the in-app parser: lines, trim, # comments,
// uppercase, dedupe)
// ---------------------------------------------------------------------------

const normalize = (w) => w.normalize('NFKC').trim().toLocaleUpperCase('en-US');
const rawLines = readFileSync(resolve(wordsPath), 'utf8').split(/\r?\n/);
const words = [...new Set(rawLines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(normalize))];
if (words.length < 2) {
    console.error(`Word list has ${words.length} usable words — nothing to map.`);
    process.exit(2);
}
if (words.length < 25) {
    console.warn(`Note: ${words.length} words is below the 25 a board needs; mapping anyway (combined-list use).`);
}
const wordSet = new Set(words);

// ---------------------------------------------------------------------------
// Prompt + structured-output schema
// ---------------------------------------------------------------------------

const SYSTEM = `You are building the semantic knowledge base for an AI that plays a
Codenames-style word game on a custom word list. Your associations become the ONLY
semantic signal the AI has for these words, for both giving and interpreting clues.

For the given batch of board words, produce:

1. "concepts" — common-noun clue words, each linking 2-6 of the given board words.
   A concept is a word a spymaster could say aloud as a one-word clue ("GALAXY: 3")
   such that a typical adult would IMMEDIATELY pick the linked board words. Only
   include associations that light up instantly in most people's heads — no chains
   of reasoning, no niche domain knowledge. Rate each concept's "commonness" in
   (0, 1]: 1 = an everyday word everyone knows, lower = more obscure.

2. "references" — proper-noun / pop-culture clues (films, characters, brands,
   places, events, acronyms), each linking 1-4 of the given board words through
   ONE specific vivid thing. Write each reference in its CANONICAL case exactly
   ("Cinderella", "iPhone", "NASA", "McDonald's") — the game preserves clue
   capitalization and mixed case signals "the specific reference, not the common
   sense". Rate "fame" in (0, 1]: 1 = everyone on earth knows it; only include
   references most casual players would recognize (fame >= 0.5).

Hard rules:
- Every linked word MUST be copied verbatim from the given board words.
- A clue must be a SINGLE word (no spaces) and must NOT be one of the board words,
  contain one, or be contained by one (that clue would be illegal in the game).
- Prefer several tight, obvious groups over sprawling loose ones.
- Cover as many of the given board words as you honestly can; leaving a word
  uncovered is better than inventing a weak association for it.
- Concepts in UPPERCASE. References in canonical display case.
- Language of the board words: ${language}.`;

const MAP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['concepts', 'references'],
    properties: {
        concepts: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['clue', 'words', 'commonness'],
                properties: {
                    clue: { type: 'string' },
                    words: { type: 'array', items: { type: 'string' } },
                    commonness: { type: 'number' },
                },
            },
        },
        references: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['clue', 'words', 'fame'],
                properties: {
                    clue: { type: 'string' },
                    words: { type: 'array', items: { type: 'string' } },
                    fame: { type: 'number' },
                },
            },
        },
    },
};

// ---------------------------------------------------------------------------
// Batching: seeded shuffle per pass so later passes pair words across the
// chunk boundaries of earlier ones (cross-chunk bridges).
// ---------------------------------------------------------------------------

function seededShuffle(items, seed) {
    // Mulberry32 — deterministic, no Math.random, reproducible runs.
    let s = seed >>> 0;
    const rand = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const chunk = (items, size) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const client = new Anthropic();
const usage = { input: 0, output: 0 };

async function generateForBatch(batch, label) {
    const response = await client.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: MAP_SCHEMA } },
        messages: [
            {
                role: 'user',
                content: `Board words (${batch.length}):\n${batch.join('\n')}`,
            },
        ],
    });
    usage.input += response.usage.input_tokens ?? 0;
    usage.output += response.usage.output_tokens ?? 0;
    if (response.stop_reason === 'refusal') {
        console.warn(`  ${label}: request refused — skipping batch`);
        return { concepts: [], references: [] };
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    try {
        return JSON.parse(text);
    } catch {
        console.warn(`  ${label}: unparsable output — skipping batch`);
        return { concepts: [], references: [] };
    }
}

/** A clue is usable when single-word and not equal to any list word. */
function usableClue(clue) {
    const c = clue.trim();
    if (!c || /\s/.test(c)) return null;
    if (wordSet.has(normalize(c))) return null; // equal to a list word: never legal alongside it
    return c;
}

const concepts = new Map(); // normalized clue -> Set(list words)
const proper = new Map(); // display-case clue -> Set(list words)
const properByNorm = new Map(); // normalized -> display-case (dedupe across batches)
const commonness = new Map(); // display/normalized key -> rating
const covered = new Set();

function absorb(result) {
    for (const item of result.concepts ?? []) {
        const clue = usableClue(item.clue ?? '');
        if (!clue) continue;
        const key = normalize(clue);
        const targets = (item.words ?? []).map(normalize).filter((w) => wordSet.has(w) && w !== key);
        if (targets.length === 0) continue;
        const set = concepts.get(key) ?? new Set();
        for (const t of targets) {
            set.add(t);
            covered.add(t);
        }
        concepts.set(key, set);
        const c = Math.min(1, Math.max(0.05, Number(item.commonness) || 0.8));
        commonness.set(key, Math.max(commonness.get(key) ?? 0, c));
    }
    for (const item of result.references ?? []) {
        const clue = usableClue(item.clue ?? '');
        if (!clue) continue;
        if (clue === clue.toLowerCase()) continue; // all-lowercase can't carry the reference signal
        const key = normalize(clue);
        const display = properByNorm.get(key) ?? clue;
        properByNorm.set(key, display);
        const targets = (item.words ?? []).map(normalize).filter((w) => wordSet.has(w) && w !== key);
        if (targets.length === 0) continue;
        const set = proper.get(display) ?? new Set();
        for (const t of targets) {
            set.add(t);
            covered.add(t);
        }
        proper.set(display, set);
        const f = Math.min(1, Math.max(0.05, Number(item.fame) || 0.8));
        commonness.set(display, Math.max(commonness.get(display) ?? 0, f));
    }
}

async function main() {
    console.log(`Building semantic map for ${words.length} words with ${model} (${passes} pass(es))…`);

    for (let pass = 0; pass < passes; pass++) {
        const ordered = pass === 0 ? words : seededShuffle(words, 0xc0ffee + pass);
        const batches = chunk(ordered, batchSize);
        for (let i = 0; i < batches.length; i++) {
            const label = `pass ${pass + 1}/${passes}, batch ${i + 1}/${batches.length}`;
            console.log(`  ${label} (${batches[i].length} words)…`);
            absorb(await generateForBatch(batches[i], label));
        }
    }

    // Targeted pass for anything still uncovered.
    const uncovered = words.filter((w) => !covered.has(w));
    if (uncovered.length > 0) {
        console.log(`  coverage pass for ${uncovered.length} uncovered word(s)…`);
        for (const batch of chunk(uncovered, batchSize)) {
            absorb(await generateForBatch(batch, 'coverage pass'));
        }
    }

    const doc = {
        version: 1,
        language,
        wordlist: basename(wordsPath),
        model,
        words,
        concepts: Object.fromEntries([...concepts.entries()].sort().map(([k, v]) => [k, [...v].sort()])),
        proper: Object.fromEntries(
            [...proper.entries()].sort().map(([k, v]) => [k, [...v].sort()])
        ),
        commonness: Object.fromEntries([...commonness.entries()].sort()),
    };

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);

    const finallyCovered = words.filter((w) => covered.has(w));
    const pct = ((100 * finallyCovered.length) / words.length).toFixed(1);
    console.log(`\nWrote ${outPath}`);
    console.log(
        `  ${concepts.size} concepts, ${proper.size} references — ${finallyCovered.length}/${words.length} words covered (${pct}%)`
    );
    const stillUncovered = words.filter((w) => !covered.has(w));
    if (stillUncovered.length > 0) {
        console.log(`  uncovered (lexical fallback will apply): ${stillUncovered.join(', ')}`);
    }
    // Opus 4.8 pricing: $5 / $25 per MTok.
    const cost = (usage.input * 5 + usage.output * 25) / 1_000_000;
    console.log(`  tokens: ${usage.input} in / ${usage.output} out (~$${cost.toFixed(2)} at ${model} rates)`);
    console.log('\nBots load every *.json in the semantic-maps directory at startup —');
    console.log('restart the server (or bots) to pick the new map up.');
}

main().catch((err) => {
    if (err instanceof Anthropic.AuthenticationError) {
        console.error('Authentication failed: set ANTHROPIC_API_KEY or log in once with `ant auth login`.');
    } else if (err instanceof Anthropic.RateLimitError) {
        console.error('Rate limited by the API — re-run in a minute (progress is not saved between runs).');
    } else if (err instanceof Anthropic.APIConnectionError) {
        console.error('Could not reach the Anthropic API — check network access and retry.');
    } else {
        console.error(err);
    }
    process.exit(1);
});
