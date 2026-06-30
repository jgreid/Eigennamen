#!/usr/bin/env node
/**
 * One-command, cross-platform setup for laptop / offline bot playtesting
 * (works on Windows, macOS, and Linux — pure Node, no bash/curl required).
 *
 * Why: with no word embeddings configured the bots fall back to a lexical
 * (character-bigram) backend, so the clicker ranks cards by SPELLING rather than
 * meaning and guesses human clues poorly. This script upgrades them to real
 * pre-trained word vectors in one step.
 *
 * What it does:
 *   1. Downloads a word-vectors model into server/src/bots/data/ ONCE. Idempotent:
 *      re-runs reuse the existing file, so after the first download it works offline.
 *   2. Sets BOT_EMBEDDINGS_PATH and starts `npm run dev`, so the bot spymaster /
 *      clicker reason over embeddings (cosine similarity) instead of the weak floor.
 *
 * Usage (from the server/ directory):
 *   npm run dev:bots                       # default model (glove): fetch-if-missing, then run
 *   npm run dev:bots -- --model=fasttext   # richer vocabulary (bigger download)
 *   npm run dev:bots -- --trim=50000       # smaller on-disk vectors file
 *   npm run bots:embeddings                # only prepare embeddings, don't start the server
 *
 * Env knobs (flags win over env): BOT_MODEL (glove|fasttext), BOT_TRIM (default 100000).
 *
 * Only frequency-ordered models are offered here (glove, fasttext) because the
 * loader keeps the first N vectors — for those, "first N" means "most common N".
 * ConceptNet Numberbatch is alphabetical, so use scripts/fetch-bot-embeddings.sh
 * for it instead (see docs/BOT_EMBEDDINGS.md).
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, renameSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import https from 'node:https';
import http from 'node:http';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const SERVER_DIR = join(REPO_ROOT, 'server');
const DATA_DIR = join(SERVER_DIR, 'src', 'bots', 'data');

const MODELS = {
    glove: {
        url: 'https://nlp.stanford.edu/data/glove.6B.zip',
        archive: 'glove.6B.zip',
        member: 'glove.6B.100d.txt', // selective extract: only the 100d file
        out: 'glove.6B.100d.vec',
        kind: 'zip',
    },
    fasttext: {
        url: 'https://dl.fbaipublicfiles.com/fasttext/vectors-english/wiki-news-300d-1M.vec.zip',
        archive: 'wiki-news-300d-1M.vec.zip',
        member: 'wiki-news-300d-1M.vec',
        out: 'wiki-news-300d-1M.vec',
        kind: 'zip',
    },
};

function parseArgs(argv) {
    const opts = { model: process.env.BOT_MODEL || 'glove', trim: Number(process.env.BOT_TRIM || 100000), run: true };
    for (const arg of argv) {
        if (arg === '--no-run' || arg === '--setup-only') opts.run = false;
        else if (arg.startsWith('--model=')) opts.model = arg.slice('--model='.length);
        else if (arg.startsWith('--trim=')) opts.trim = Number(arg.slice('--trim='.length));
        else if (arg === '-h' || arg === '--help') opts.help = true;
        else {
            console.error(`Unknown option: ${arg}`);
            process.exit(2);
        }
    }
    return opts;
}

function fileSize(path) {
    try {
        return statSync(path).size;
    } catch {
        return 0;
    }
}

/** Whether the server's dev dependencies (needed by `npm run dev`) are installed. */
function depsInstalled() {
    return existsSync(join(SERVER_DIR, 'node_modules', 'typescript')) && existsSync(join(SERVER_DIR, 'node_modules', 'ts-node-dev'));
}

/** GET with redirect following, into `dest`. Resolves on completion. */
function download(url, dest, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        const mod = url.startsWith('http:') ? http : https;
        const req = mod.get(url, (res) => {
            const status = res.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                return resolve(download(next, dest, redirects + 1));
            }
            if (status !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${status} for ${url}`));
            }
            const total = Number(res.headers['content-length'] || 0);
            let got = 0;
            let lastPct = -1;
            const file = createWriteStream(dest);
            res.on('data', (chunk) => {
                got += chunk.length;
                if (total > 0) {
                    const pct = Math.floor((got / total) * 100);
                    if (pct !== lastPct && pct % 5 === 0) {
                        lastPct = pct;
                        process.stdout.write(`\r   downloading… ${pct}% (${(got / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)`);
                    }
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                process.stdout.write('\n');
                file.close(() => resolve());
            });
            file.on('error', (err) => {
                rmSync(dest, { force: true });
                reject(err);
            });
        });
        req.on('error', reject);
    });
}

/** Extract `member` from a zip into `destDir`, trying unzip then tar (Win10+ has tar.exe). */
function extractZip(archivePath, member, destDir) {
    const attempts = [
        ['unzip', ['-o', archivePath, member, '-d', destDir]],
        ['tar', ['-xf', archivePath, '-C', destDir, member]],
    ];
    for (const [cmd, args] of attempts) {
        const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
        if (!r.error && r.status === 0) return cmd;
    }
    return null;
}

/** Keep only the first `n` lines of `path` (in place), streamed so big files stay bounded. */
async function trimToLines(path, n) {
    const tmp = `${path}.tmp`;
    const input = createReadStream(path);
    const rl = createInterface({ input, crlfDelay: Infinity });
    const out = createWriteStream(tmp);
    let i = 0;
    for await (const line of rl) {
        out.write(`${line}\n`);
        if (++i >= n) break;
    }
    rl.close();
    await new Promise((resolve) => out.end(resolve));
    // Wait for the read handle to fully release before delete/rename (Windows EBUSY).
    await new Promise((resolve) => {
        input.once('close', resolve);
        input.destroy();
    });
    rmSync(path, { force: true });
    renameSync(tmp, path);
}

async function ensureModel(model, trim) {
    const spec = MODELS[model];
    if (!spec) {
        console.error(`Unknown model: ${model}. Supported here: ${Object.keys(MODELS).join(', ')}.`);
        console.error('For ConceptNet Numberbatch, use scripts/fetch-bot-embeddings.sh (see docs/BOT_EMBEDDINGS.md).');
        process.exit(2);
    }

    mkdirSync(DATA_DIR, { recursive: true });
    const outPath = join(DATA_DIR, spec.out);

    if (existsSync(outPath) && fileSize(outPath) > 1_048_576) {
        console.log(`✓ Reusing existing embeddings: ${outPath}`);
        return spec.out;
    }

    console.log(`📥 Fetching '${model}' embeddings (one-time; subsequent runs are offline)…`);
    const archivePath = join(DATA_DIR, spec.archive);
    await download(spec.url, archivePath);

    console.log('   extracting…');
    const tool = extractZip(archivePath, spec.member, DATA_DIR);
    if (!tool) {
        rmSync(archivePath, { force: true });
        console.error('\n❌ Could not extract the archive: neither `unzip` nor `tar` is available.');
        console.error('   Windows 10/11 include tar.exe by default; otherwise install unzip, or download');
        console.error('   the vectors manually per docs/BOT_EMBEDDINGS.md, then re-run.');
        process.exit(1);
    }

    const memberPath = join(DATA_DIR, spec.member);
    if (memberPath !== outPath) {
        rmSync(outPath, { force: true });
        renameSync(memberPath, outPath);
    }
    rmSync(archivePath, { force: true });

    // Sanity-check the extracted file (catches a failed/truncated download) before
    // trimming, so a deliberately small --trim can't false-trip this guard.
    if (fileSize(outPath) < 1_048_576) {
        console.error(`❌ Extracted vectors file looks too small (download may have failed): ${outPath}`);
        process.exit(1);
    }

    if (trim && Number.isFinite(trim) && trim > 0) {
        console.log(`   trimming to top ${trim} vectors…`);
        await trimToLines(outPath, trim);
    }
    console.log(`✓ Embeddings ready: ${outPath}`);
    return spec.out;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log('Usage: npm run dev:bots [-- --model=glove|fasttext] [--trim=N] [--no-run]');
        return;
    }

    // Fail fast BEFORE the (large) download if we intend to launch but deps are missing,
    // so a fresh clone doesn't pay the download only to hit a missing `tsc`/`ts-node-dev`.
    if (opts.run && !depsInstalled()) {
        console.error('❌ Server dependencies are not installed.');
        console.error('   Run `npm install` from the server/ directory first, then re-run `npm run dev:bots`.');
        process.exit(1);
    }

    const outName = await ensureModel(opts.model, opts.trim);
    const relPath = `src/bots/data/${outName}`; // relative to server/ (the dev server's cwd)
    console.log(`✓ BOT_EMBEDDINGS_PATH=${relPath}`);

    if (!opts.run) {
        console.log('\nSetup complete. Start the server with embedding-backed bots via:');
        console.log('    npm run dev:bots');
        return;
    }

    console.log('🤖 Starting dev server with embedding-backed bots…');
    console.log("   Watch for: 'Bot embeddings loaded: N vectors, M clue candidates'");
    const child = spawn('npm', ['run', 'dev'], {
        cwd: SERVER_DIR,
        env: { ...process.env, BOT_EMBEDDINGS_PATH: relPath },
        stdio: 'inherit',
        shell: true, // resolve npm/npm.cmd across platforms
    });
    child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
