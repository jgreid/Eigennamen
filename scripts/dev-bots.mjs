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
 *   npm run dev:bots                                 # default model (glove): fetch-if-missing, then run
 *   npm run dev:bots -- --model=fasttext             # richer vocabulary (bigger download)
 *   npm run dev:bots -- --model=numberbatch --board  # knowledge-graph, distilled to board vectors
 *   npm run dev:bots -- --trim=50000                 # smaller on-disk vectors file (frequency models)
 *   npm run bots:embeddings                          # only prepare embeddings, don't start the server
 *
 * Env knobs (flags win over env): BOT_MODEL (glove|fasttext|numberbatch),
 * BOT_TRIM (default 100000), BOT_BOARD (1 = distil to compact board vectors).
 *
 * Frequency-ordered models (glove, fasttext) can be used as-is: the loader keeps the
 * first N vectors, and "first N" means "most common N". ConceptNet Numberbatch is a
 * knowledge-graph model — the best fit for a word game and reachable where the
 * GloVe/fastText hosts are blocked — but it is ALPHABETICAL, so it must be distilled
 * with `--board` (build-board-vectors.mjs): that keeps every board/concept word plus a
 * breadth sample instead of the early alphabet a first-N cut would keep. `--board`
 * works for any model and is the recommended production artifact (small, full-coverage;
 * see docs/BOT_EMBEDDINGS.md "Board-restricted vectors").
 *
 * `--board` also fetches a small frequency reference (FREQ_REF) and distils WITH
 * `--freq`, so the output is most-common-first and the runtime re-enables its
 * rank→commonness prior. That prior is what keeps clue words recognizable: without
 * it a Numberbatch board surfaces obscure/non-word clues (ADELING, SEASPIDER…) that
 * pass legality but mean nothing to a human. The reference fetch is best-effort —
 * if it fails the board build still succeeds, just without the prior (a warning).
 */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import https from "node:https";
import http from "node:http";
import { ensureRedis } from "./ensure-redis.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const SERVER_DIR = join(REPO_ROOT, "server");
const DATA_DIR = join(SERVER_DIR, "src", "bots", "data");

const MODELS = {
  glove: {
    url: "https://nlp.stanford.edu/data/glove.6B.zip",
    archive: "glove.6B.zip",
    member: "glove.6B.100d.txt", // selective extract: only the 100d file
    out: "glove.6B.100d.vec",
    kind: "zip",
  },
  fasttext: {
    url: "https://dl.fbaipublicfiles.com/fasttext/vectors-english/wiki-news-300d-1M.vec.zip",
    archive: "wiki-news-300d-1M.vec.zip",
    member: "wiki-news-300d-1M.vec",
    out: "wiki-news-300d-1M.vec",
    kind: "zip",
  },
  numberbatch: {
    // ConceptNet Numberbatch — a knowledge-graph model (COLD~PENGUIN is a real
    // edge), the best fit for a word game AND reachable where GloVe/fastText's
    // hosts are blocked by a network policy. It is ALPHABETICAL, so it must be
    // distilled to board vectors (--board / BOT_BOARD): a first-N line trim would
    // keep only the early alphabet. gz, single stream (no archive member).
    url: "https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-en-19.08.txt.gz",
    archive: "numberbatch-en-19.08.vec.gz",
    out: "numberbatch-en-19.08.vec",
    kind: "gz",
    alphabetical: true, // a first-N trim is meaningless; use --board
  },
};

// A tiny, most-frequent-first English word list used ONLY as a commonness
// reference for the --board distillation's --freq pass (build-board-vectors.mjs):
// it restricts the breadth sample to common words and orders the output so the
// runtime re-enables its rank→commonness prior. Without it a Numberbatch board
// distillation carries NO frequency signal, so the spymaster surfaces obscure /
// non-word clues (ADELING, SEASPIDER…) that pass legality but mean nothing to a
// human. It is reachable where GloVe/fastText's hosts (the docs' other freq
// references) are blocked. "word count" lines — build-board-vectors reads only the
// leading token. CC-BY-SA-4.0 (hermitdave/FrequencyWords); a bake that uses it
// derives from it, alongside the CC-BY-SA-4.0 Numberbatch model.
const FREQ_REF = {
  url: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt",
  out: "en_50k.txt",
  top: 40000, // --freq-top: how much of the reference's common head to admit
};

function parseArgs(argv) {
  const opts = {
    model: process.env.BOT_MODEL || "glove",
    trim: Number(process.env.BOT_TRIM || 100000),
    board: process.env.BOT_BOARD === "1",
    run: true,
  };
  for (const arg of argv) {
    if (arg === "--no-run" || arg === "--setup-only") opts.run = false;
    else if (arg === "--board") opts.board = true;
    else if (arg.startsWith("--model="))
      opts.model = arg.slice("--model=".length);
    else if (arg.startsWith("--trim="))
      opts.trim = Number(arg.slice("--trim=".length));
    else if (arg === "-h" || arg === "--help") opts.help = true;
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
  return (
    existsSync(join(SERVER_DIR, "node_modules", "typescript")) &&
    existsSync(join(SERVER_DIR, "node_modules", "ts-node-dev"))
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "UND_ERR_SOCKET",
]);
function isTransient(err) {
  if (!err) return false;
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  return /socket hang up|econnreset|timeout|network|aborted|incomplete/i.test(
    err.message || "",
  );
}

/**
 * One GET attempt (following redirects). When `startByte > 0` it requests a byte
 * range and appends, so a resumed download continues from disk instead of restarting.
 */
function downloadOnce(url, dest, startByte, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const mod = url.startsWith("http:") ? http : https;
    const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : {};
    const req = mod.get(url, { headers }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url);
        // Never follow a redirect that downgrades to plaintext http: — the model
        // hosts all serve https, so a redirect to http: is either a misconfig or a
        // MITM trying to feed us tampered vectors over an unencrypted channel.
        if (next.protocol !== "https:") {
          return reject(
            Object.assign(
              new Error(
                `refusing insecure redirect to ${next.protocol}//${next.host}`,
              ),
              { fatal: true },
            ),
          );
        }
        return resolve(
          downloadOnce(next.toString(), dest, startByte, redirects + 1),
        );
      }
      if (status === 416) {
        // Range not satisfiable — the file is already complete.
        res.resume();
        return resolve();
      }
      if (status !== 200 && status !== 206) {
        res.resume();
        return reject(
          Object.assign(new Error(`HTTP ${status} for ${url}`), {
            fatal: true,
          }),
        );
      }

      const append = status === 206; // server honored the range request
      const base = append ? startByte : 0;
      let total = 0;
      const range = res.headers["content-range"];
      if (append && range) {
        const m = /\/(\d+)\s*$/.exec(range);
        total = m ? Number(m[1]) : 0;
      } else if (res.headers["content-length"]) {
        total = Number(res.headers["content-length"]);
      }

      const file = createWriteStream(dest, { flags: append ? "a" : "w" });
      let got = 0;
      let lastPct = -1;
      const fail = (err) => {
        file.destroy();
        reject(err);
      };
      res.on("data", (chunk) => {
        got += chunk.length;
        if (total > 0) {
          const pct = Math.floor(((base + got) / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            const mb = (n) => (n / 1e6).toFixed(0);
            process.stdout.write(
              `\r   downloading… ${pct}% (${mb(base + got)}/${mb(total)} MB)`,
            );
          }
        }
      });
      res.on("error", fail);
      res.on("aborted", () =>
        fail(
          Object.assign(new Error("connection aborted"), {
            code: "ECONNRESET",
          }),
        ),
      );
      file.on("error", fail);
      res.pipe(file);
      file.on("finish", () => {
        // A clean end short of the known total means a silent truncation —
        // reject so the caller resumes rather than extracting a partial file.
        if (total > 0 && base + got < total) {
          return reject(
            Object.assign(new Error("incomplete response"), {
              code: "ECONNRESET",
            }),
          );
        }
        process.stdout.write("\n");
        file.close(() => resolve());
      });
    });
    req.on("error", reject);
  });
}

/**
 * Download `url` to `dest` with resume + retry. Big models (GloVe is ~860 MB) over
 * flaky links drop mid-transfer; this resumes from whatever is already on disk and
 * retries transient failures with exponential backoff instead of restarting.
 */
async function download(url, dest) {
  const MAX_ATTEMPTS = 6;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startByte = fileSize(dest); // resume from bytes already fetched
    try {
      await downloadOnce(url, dest, startByte);
      return;
    } catch (err) {
      lastErr = err;
      if (err.fatal || !isTransient(err) || attempt === MAX_ATTEMPTS) break;
      const waitMs = Math.min(16000, 1000 * 2 ** (attempt - 1));
      const have = fileSize(dest);
      process.stdout.write("\n");
      console.warn(
        `   ⚠ download interrupted (${err.code || err.message}); retrying in ${Math.round(waitMs / 1000)}s — have ${(have / 1e6).toFixed(0)} MB…`,
      );
      await sleep(waitMs);
    }
  }
  throw lastErr ?? new Error(`download failed: ${url}`);
}

/** Gunzip `src` → `dest` (pure Node, no external tool — used for the Numberbatch .gz). */
function gunzipFile(src, dest) {
  return new Promise((resolve, reject) => {
    const input = createReadStream(src);
    const gz = createGunzip();
    const out = createWriteStream(dest);
    input.on("error", reject);
    gz.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    input.pipe(gz).pipe(out);
  });
}

/** Extract `member` from a zip into `destDir`, trying unzip then tar (Win10+ has tar.exe). */
function extractZip(archivePath, member, destDir) {
  const attempts = [
    ["unzip", ["-o", archivePath, member, "-d", destDir]],
    ["tar", ["-xf", archivePath, "-C", destDir, member]],
  ];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
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
    input.once("close", resolve);
    input.destroy();
  });
  rmSync(path, { force: true });
  renameSync(tmp, path);
}

async function ensureModel(model, trim) {
  const spec = MODELS[model];
  if (!spec) {
    console.error(
      `Unknown model: ${model}. Supported here: ${Object.keys(MODELS).join(", ")}.`,
    );
    console.error(
      "For ConceptNet Numberbatch, use scripts/fetch-bot-embeddings.sh (see docs/BOT_EMBEDDINGS.md).",
    );
    process.exit(2);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const outPath = join(DATA_DIR, spec.out);

  if (existsSync(outPath) && fileSize(outPath) > 1_048_576) {
    console.log(`✓ Reusing existing embeddings: ${outPath}`);
    return spec.out;
  }

  console.log(
    `📥 Fetching '${model}' embeddings (one-time; subsequent runs are offline)…`,
  );
  const archivePath = join(DATA_DIR, spec.archive);
  await download(spec.url, archivePath);

  console.log("   extracting…");
  if (spec.kind === "gz") {
    // Single gzip stream (no archive member) — gunzip in-process.
    rmSync(outPath, { force: true });
    await gunzipFile(archivePath, outPath);
    rmSync(archivePath, { force: true });
  } else {
    const tool = extractZip(archivePath, spec.member, DATA_DIR);
    if (!tool) {
      rmSync(archivePath, { force: true });
      console.error(
        "\n❌ Could not extract the archive: neither `unzip` nor `tar` is available.",
      );
      console.error(
        "   Windows 10/11 include tar.exe by default; otherwise install unzip, or download",
      );
      console.error(
        "   the vectors manually per docs/BOT_EMBEDDINGS.md, then re-run.",
      );
      process.exit(1);
    }
    const memberPath = join(DATA_DIR, spec.member);
    if (memberPath !== outPath) {
      rmSync(outPath, { force: true });
      renameSync(memberPath, outPath);
    }
    rmSync(archivePath, { force: true });
  }

  // Sanity-check the extracted file (catches a failed/truncated download) before
  // trimming, so a deliberately small --trim can't false-trip this guard.
  if (fileSize(outPath) < 1_048_576) {
    console.error(
      `❌ Extracted vectors file looks too small (download may have failed): ${outPath}`,
    );
    process.exit(1);
  }

  // A first-N line trim only means "most common N" for a frequency-ordered model;
  // for an alphabetical source (Numberbatch) it would keep the early alphabet, so
  // never trim one. Board mode (below) also needs the full model to distil from.
  if (!spec.alphabetical && trim && Number.isFinite(trim) && trim > 0) {
    console.log(`   trimming to top ${trim} vectors…`);
    await trimToLines(outPath, trim);
  }
  console.log(`✓ Embeddings ready: ${outPath}`);
  return spec.out;
}

/**
 * Best-effort fetch of the small frequency reference (FREQ_REF) used to turn the
 * runtime commonness prior ON for a board distillation. Reused if already on disk.
 * Returns its path, or null if the download fails — a null lets the board build
 * proceed WITHOUT the prior (a warning, not a hard failure) so a flaky network
 * still yields a usable-if-coarser artifact rather than no artifact at all.
 */
async function ensureFreqReference() {
  mkdirSync(DATA_DIR, { recursive: true });
  const outPath = join(DATA_DIR, FREQ_REF.out);
  if (existsSync(outPath) && fileSize(outPath) > 4096) {
    console.log(`✓ Reusing frequency reference: ${outPath}`);
    return outPath;
  }
  console.log(
    "📥 Fetching commonness reference (small; enables the clue rarity tax)…",
  );
  try {
    await download(FREQ_REF.url, outPath);
    if (fileSize(outPath) < 4096)
      throw new Error("frequency reference looks too small");
    console.log(`✓ Frequency reference ready: ${outPath}`);
    return outPath;
  } catch (err) {
    console.warn(
      `   ⚠ could not fetch the frequency reference (${err.message || err}); ` +
        "building board vectors WITHOUT the commonness prior (clues may run obscure).",
    );
    rmSync(outPath, { force: true }); // don't leave a truncated file to be "reused"
    return null;
  }
}

/**
 * Distil the downloaded model to a compact board-restricted vectors file
 * (build-board-vectors.mjs): every board/concept word guaranteed, plus a breadth
 * sample for clue generation. A few MB vs. hundreds, full coverage, and the ONLY
 * correct way to consume an alphabetical model (Numberbatch). When `freqPath` is
 * given, the distillation runs with `--freq` so the output is written
 * most-common-first and the runtime re-enables its rank→commonness prior — the
 * difference between recognizable clues and obscure ones for a Numberbatch board.
 * Returns the artifact name written into DATA_DIR.
 */
function distilBoardVectors(modelVecName, freqPath) {
  const inPath = join(DATA_DIR, modelVecName);
  const outVec = join(DATA_DIR, "board-vectors.vec");
  const script = join(SCRIPT_DIR, "build-board-vectors.mjs");
  const args = [script, "--in", inPath, "--out", outVec, "--breadth", "40000"];
  if (freqPath)
    args.push("--freq", freqPath, "--freq-top", String(FREQ_REF.top));
  console.log(
    `🧬 Distilling board-restricted vectors (board/concept coverage + breadth sample${freqPath ? ", commonness prior ON" : ""})…`,
  );
  const r = spawnSync(process.execPath, args, {
    stdio: "inherit",
  });
  if (r.error || r.status !== 0) {
    console.error(
      `❌ board-vector distillation failed${r.error ? `: ${r.error.message}` : ""}.`,
    );
    process.exit(r.status || 1);
  }
  return "board-vectors.vec";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "Usage: npm run dev:bots [-- --model=glove|fasttext|numberbatch] [--board] [--trim=N] [--no-run]",
    );
    return;
  }

  // Fail fast BEFORE the (large) download if we intend to launch but deps are missing,
  // so a fresh clone doesn't pay the download only to hit a missing `tsc`/`ts-node-dev`.
  if (opts.run && !depsInstalled()) {
    console.error("❌ Server dependencies are not installed.");
    console.error(
      "   Run `npm install` from the server/ directory first, then re-run `npm run dev:bots`.",
    );
    process.exit(1);
  }

  // Board mode reads the FULL model to distil from, so never trim the source first.
  const modelName = await ensureModel(opts.model, opts.board ? 0 : opts.trim);
  // Board mode also pulls a small frequency reference so the distillation writes
  // most-common-first and the runtime commonness prior is ON — without it a
  // Numberbatch board surfaces obscure/non-word clues. Best-effort: a fetch
  // failure degrades to a prior-off build rather than aborting.
  const freqPath = opts.board ? await ensureFreqReference() : null;
  const outName = opts.board
    ? distilBoardVectors(modelName, freqPath)
    : modelName;
  const relPath = `src/bots/data/${outName}`; // relative to server/ (the dev server's cwd)
  console.log(`✓ BOT_EMBEDDINGS_PATH=${relPath}`);

  if (!opts.run) {
    console.log(
      "\nSetup complete. Start the server with embedding-backed bots via:",
    );
    console.log("    npm run dev:bots");
    return;
  }

  // Make sure a Redis is available before launching (auto-starts a managed
  // Docker container if needed) so the dev server isn't stuck reconnecting.
  const redisUrl = await ensureRedis();
  const childEnv = { ...process.env, BOT_EMBEDDINGS_PATH: relPath };
  if (redisUrl) childEnv.REDIS_URL = redisUrl;

  console.log("🤖 Starting dev server with embedding-backed bots…");
  console.log(
    "   Watch for: 'Bot embeddings loaded: N vectors, M clue candidates'",
  );
  const child = spawn("npm", ["run", "dev"], {
    cwd: SERVER_DIR,
    env: childEnv,
    stdio: "inherit",
    shell: true, // resolve npm/npm.cmd across platforms
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// Exported for tests; downloads use resume + retry.
export { download, isTransient };

// Run only when invoked directly (guarded so the module can be imported in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
