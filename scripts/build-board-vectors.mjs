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
 *   2. BREADTH — a sample of the rest of the model's word-like English tokens,
 *      up to a budget, so the spymaster's nearest() clue generation has a wide
 *      candidate pool (not just the early alphabet a first-N cut would keep).
 *
 * COMMONNESS PRIOR (--freq). The breadth sample decides which words can be
 * GENERATED as clues. From an alphabetical source (Numberbatch) a uniform
 * stride pulls in obscure words (OVERBOUGHT, HARDINGGRASS) the spymaster then
 * offers as clues, because Numberbatch's ordering carries no frequency signal —
 * so the runtime disables its rank-based commonness prior and nothing taxes the
 * obscurity. Pass `--freq <freq-ordered-model.vec>` (a GloVe/fastText file, whose
 * lines ARE most-frequent-first) to fix both ends model-independently:
 *   - the breadth sample is drawn ONLY from that reference's common region, so
 *     obscure tokens never become candidates, and
 *   - the output is written most-common-first, so the runtime loader detects a
 *     frequency ordering and RE-ENABLES its commonness prior — grading whatever
 *     survives by real word frequency, whatever the vector source's own order.
 * Without --freq the output is written alphabetically, so the loader detects a
 * sorted file and cleanly DISABLES the prior rather than reading meaning into a
 * non-frequency order.
 *
 * WIDE COMPREHENSION TIER (--wide N). The breadth sample bounds which words the
 * spymaster can GENERATE; it also silently bounded which human clues the bots
 * could UNDERSTAND — a clue rarer than the breadth region (SIDEREAL, FUMAROLE,
 * INGOT, NECROMANCER) had no vector, so the guesser was word-blind and fell
 * back to spelling similarity. `--wide N` appends up to N additional
 * comprehension-only words AFTER the frequency-graded head: every word-like
 * token the model knows that is ATTESTED in the frequency reference, ordered
 * by its reference rank, so the cut keeps the most plausible N and junk tokens
 * without attestation never enter. The runtime (vectorBackend.ts) understands
 * these words fully but excludes them from clue generation and gives them zero
 * commonness credit, so a wide file widens what the bots can READ without
 * reviving obscure clue-GIVING. Requires --freq; use a DEEP reference (e.g.
 * hermitdave en_full) so the tail ordering stays meaningful beyond the breadth
 * region.
 *
 * The result is a few MB (vs. hundreds), loads fast, and covers exactly what
 * the game needs. Point the bots at it with BOT_EMBEDDINGS_PATH.
 *
 * Usage (from repo root or server/):
 *   node scripts/build-board-vectors.mjs --in <model.vec[.gz]> [--out <path>]
 *     [--breadth 40000] [--freq <freq-ordered.vec[.gz]>] [--freq-top 60000]
 *     [--wide 110000]
 */
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const inPath = arg("--in", null);
if (!inPath) {
  console.error(
    "Usage: node scripts/build-board-vectors.mjs --in <model.vec[.gz]> [--out <path>] [--breadth N]",
  );
  process.exit(2);
}
const outPath = resolve(
  arg(
    "--out",
    join(ROOT, "server", "src", "bots", "data", "board-vectors.vec"),
  ),
);
const breadth = Math.max(0, parseInt(arg("--breadth", "40000"), 10) || 0);
const freqPath = arg("--freq", null);
const freqTop = Math.max(0, parseInt(arg("--freq-top", "60000"), 10) || 0);
const wide = Math.max(0, parseInt(arg("--wide", "0"), 10) || 0);
if (wide > 0 && !freqPath) {
  // The wide tier's whole safety story is "attested in the reference, ordered
  // by its rank" — without a reference it would admit the model's junk tokens.
  console.error(
    "--wide requires --freq (a frequency reference orders and gates the tail)",
  );
  process.exit(2);
}
// How deep into the frequency reference the wide tier may reach for
// attestation ranks. Far beyond any sane --wide budget; bounds build memory.
const WIDE_REF_CAP = 600000;

// Resolve a source file that lives under either the repo layout (`<root>/server/…`,
// local checkout) or a flattened layout (`<root>/…`, e.g. the Docker builder, which
// copies `server/src` → `/app/src`). Falls back to the repo-layout path so a genuine
// miss errors with an informative ENOENT rather than silently emitting an empty target.
function resolveSource(...rel) {
  for (const base of [["server"], []]) {
    const p = join(ROOT, ...base, ...rel);
    if (existsSync(p)) return p;
  }
  return join(ROOT, "server", ...rel);
}

// --- Normalisation: match the runtime loader (NFKC, uppercase, /c/en/ strip) ---
const norm = (t) =>
  t
    .normalize("NFKC")
    .replace(/^\/c\/[a-z]+\//, "")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLocaleUpperCase("en-US");

// --- Build the guaranteed target set --------------------------------------
const target = new Set();

// English board words: parse DEFAULT_WORDS out of gameRules.ts (same approach
// as generate-associations.mjs).
const grc = readFileSync(resolveSource("src/shared/gameRules.ts"), "utf8");
const dw = grc.match(/DEFAULT_WORDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
if (dw)
  for (const m of dw[1].match(/'[^']+'/g) || [])
    target.add(norm(m.replace(/'/g, "")));

// Locale board words.
for (const loc of ["de", "es", "fr"]) {
  const p = resolveSource(`public/locales/wordlist-${loc}.txt`);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const w = line.trim();
    if (w && !w.startsWith("#")) target.add(norm(w));
  }
}

// Baked association concept keys — the bot's curated clue vocabulary; give them
// real vectors so scored/generated clues are graded by embeddings too.
const assoc = readFileSync(
  resolveSource("src/bots/semantics/associations.ts"),
  "utf8",
);
for (const m of assoc.match(/^\s{4}([A-Z][A-Z]+):/gm) || [])
  target.add(norm(m.replace(/[:\s]/g, "")));

// Single-token targets only — the loader skips multi-word/underscore tokens,
// so a "NEW YORK" board word can never match a vector anyway.
const wantWord = (u) => target.has(u) && !u.includes(" ");
const guaranteed = new Set([...target].filter((u) => !u.includes(" ")));
const wordlike = (u) => /^[A-Z][A-Z'.-]{1,14}$/.test(u); // single common-word-ish token

// Stream the whitespace-separated data rows of a vectors file (gz-aware),
// yielding [normalizedToken, rawLine, spaceIndex] and skipping the optional
// "<count> <dim>" header. Shared by the frequency pass and the model pass.
function streamRows(path, onRow) {
  const gz = path.endsWith(".gz");
  const raw = createReadStream(resolve(path));
  const rl = createInterface({
    input: gz ? raw.pipe(createGunzip()) : raw,
    crlfDelay: Infinity,
  });
  let first = true;
  return new Promise((res, rej) => {
    rl.on("line", (line) => {
      if (first) {
        first = false;
        if (/^\d+\s+\d+\s*$/.test(line)) return; // header
      }
      const sp = line.indexOf(" ");
      if (sp <= 0) return;
      onRow(norm(line.slice(0, sp)), line, sp);
    });
    rl.on("close", res);
    rl.on("error", rej);
  });
}

// --- Frequency reference (optional): most-common-first token → rank ----------
// A GloVe/fastText file lists vectors most-frequent-first, so a token's line
// position IS a commonness rank. We read the first `freqTop` word-like tokens
// and use them to (a) restrict the breadth sample to common words and (b) order
// the output by frequency so the runtime re-enables its commonness prior.
let freqRank = null;
// Extended reference ranks for the wide tier: token → rank across the WHOLE
// reference (up to WIDE_REF_CAP), superset of freqRank's common region.
let extRank = null;
if (freqPath) {
  if (!existsSync(resolve(freqPath))) {
    console.error(`--freq file not found: ${freqPath}`);
    process.exit(2);
  }
  freqRank = new Map();
  extRank = wide > 0 ? new Map() : null;
  await streamRows(freqPath, (u) => {
    if (freqRank.size >= freqTop && (!extRank || extRank.size >= WIDE_REF_CAP))
      return;
    if (u && !u.includes(" ") && wordlike(u)) {
      if (freqRank.size < freqTop && !freqRank.has(u))
        freqRank.set(u, freqRank.size);
      if (extRank && extRank.size < WIDE_REF_CAP && !extRank.has(u))
        extRank.set(u, extRank.size);
    }
  });
  if (freqRank.size === 0) {
    // An empty/mismatched reference would yield a breadth-less, wrongly-
    // "freq-ordered" artifact whose runtime prior claim is a lie. Fail loud.
    console.error(`--freq file yielded no usable common tokens: ${freqPath}`);
    process.exit(2);
  }
  console.log(
    `Frequency reference: ${freqRank.size} common tokens from ${freqPath} (top ${freqTop}).`,
  );
}

console.log(
  `Target: ${guaranteed.size} single-token board/concept words; breadth sample budget ${breadth}.`,
);

// --- Stream the model, keep guaranteed words + a breadth sample -------------
// Breadth selection: with --freq, keep every freq-common token the model has a
// vector for (capped to `breadth` most-common afterwards); without it, a uniform
// stride sample across the model's word-like tokens (alphabet-wide, bounded).
const kept = []; // { u, vec, guaranteed, rank } — rank is freq rank or Infinity
const keptWords = new Set();
let dim = 0;
let sampleStride = 0;
// Stride estimate over an assumed ~500k english vocab so the (no-freq) sample is
// alphabet-wide and bounded without a first pass to count the file.
const ASSUMED_VOCAB = 500000;
const stride =
  breadth > 0 ? Math.max(1, Math.floor(ASSUMED_VOCAB / breadth)) : Infinity;

await streamRows(inPath, (u, line, sp) => {
  if (!u || u.includes(" ") || keptWords.has(u)) return;
  if (dim === 0) dim = line.trim().split(/\s+/).length - 1;
  const isGuaranteed = wantWord(u);
  let take = isGuaranteed;
  let rank = Infinity;
  let wideTier = false;
  if (!isGuaranteed && wordlike(u)) {
    if (freqRank) {
      const r = freqRank.get(u);
      if (r !== undefined) {
        take = true;
        rank = r;
      } else if (extRank) {
        // Wide comprehension tier: attested in the reference beyond the
        // common region. freqRank and extRank share one admission counter
        // (same pass, same word-like test), so ranks are comparable across
        // the two maps.
        const er = extRank.get(u);
        if (er !== undefined) {
          take = true;
          rank = er;
          wideTier = true;
        }
      }
    } else if (breadth > 0 && Number.isFinite(stride)) {
      take = sampleStride % stride === 0;
      sampleStride++;
    }
  }
  if (take) {
    // Re-emit with the normalized (uppercase, prefix-stripped) token so the
    // file matches how the runtime loader keys everything.
    kept.push({
      u,
      vec: line.slice(sp + 1).trim(),
      guaranteed: isGuaranteed,
      rank,
      wideTier,
    });
    keptWords.add(u);
  }
});

// Cap the (freq) breadth pool to the most-common `breadth` tokens; guaranteed
// board/concept words are always kept regardless of the budget. `--breadth 0`
// means "no breadth" on BOTH paths (the no-freq path's stride is already gated
// on breadth > 0), so it slices to an empty pool here rather than keeping all.
const guaranteedRows = kept.filter((k) => k.guaranteed);
let breadthRows = kept.filter((k) => !k.guaranteed && !k.wideTier);
let wideRows = kept.filter((k) => k.wideTier);
if (freqRank) {
  breadthRows.sort((a, b) => a.rank - b.rank); // most common first
  const overflow = breadth > 0 ? breadthRows.slice(breadth) : breadthRows;
  breadthRows = breadth > 0 ? breadthRows.slice(0, breadth) : [];
  // Wide tier: breadth-budget overflow (the most-attested words that missed
  // the generation cut) plus the beyond-region attested words, most-attested
  // first, capped to the --wide budget. Ranks are comparable (shared counter).
  wideRows = [...overflow, ...wideRows].sort((a, b) => a.rank - b.rank);
  wideRows = wide > 0 ? wideRows.slice(0, wide) : [];
}

// Output ORDER is the runtime's frequency-prior switch (see vectorBackend.ts):
//   - with --freq: most-common-first (board words first, then breadth by rank,
//     then the wide comprehension tail by rank). The non-sorted order tells the
//     loader this file IS frequency-ordered, so it builds a MEANINGFUL
//     rank→commonness prior that taxes obscure clues; the runtime grades only
//     the head region and treats everything beyond it as comprehension-only.
//   - without --freq: alphabetical, so the loader detects a sorted file and
//     DISABLES the prior rather than reading frequency into a non-frequency order.
let ordered;
if (freqRank) {
  ordered = [...guaranteedRows, ...breadthRows, ...wideRows];
} else {
  ordered = [...guaranteedRows, ...breadthRows].sort((a, b) =>
    a.u < b.u ? -1 : a.u > b.u ? 1 : 0,
  );
}

const coveredBoard = [...guaranteed].filter((u) => keptWords.has(u));
const missing = [...guaranteed].filter((u) => !keptWords.has(u));

const lines = ordered.map((k) => `${k.u} ${k.vec}`);
const header = `${lines.length} ${dim}\n`;
writeFileSync(outPath, header + lines.join("\n") + "\n");
console.log(`Wrote ${outPath}`);
console.log(
  `  ${lines.length} vectors (dim ${dim}); board/concept coverage ${coveredBoard.length}/${guaranteed.size}; ` +
    `${breadthRows.length} breadth ${freqRank ? "(freq-ordered → commonness prior ON)" : "(alphabetical → prior OFF)"}` +
    `${wide > 0 ? `; ${wideRows.length} wide comprehension-only tail` : ""}.`,
);
if (missing.length) {
  console.log(
    `  ${missing.length} target words had no vector (fall back to table/lexical): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " …" : ""}`,
  );
}
