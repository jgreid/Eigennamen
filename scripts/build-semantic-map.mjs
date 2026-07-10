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
 *     [--list-id <savedListId>] [--list-name "<saved list name>"]
 *
 * When you built the list in the in-app word-list library, pass its id via
 * --list-id so the map is filed under `<listId>.json` and stamped with the
 * list's identity (traceability with GameState.wordListId).
 *
 * Auth: uses the Anthropic SDK's standard credential resolution — set
 * ANTHROPIC_API_KEY, or log in once with `ant auth login`.
 *
 * The word-list format matches the in-app custom list: one word per line,
 * blank lines and `#` comments ignored.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// The SDK is a devDependency of server/ — resolve through its package.
const require = createRequire(join(ROOT, "server", "package.json"));
const Anthropic = require("@anthropic-ai/sdk");

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const wordsPath = arg("--words", null);
if (!wordsPath) {
  console.error(
    "Usage: npm run bots:map -- --words <wordlist.txt> [--out <map.json>]",
  );
  console.error(
    "       [--model claude-opus-4-8] [--batch-size 60] [--passes 2] [--language en]",
  );
  console.error(
    '       [--list-id <savedListId>] [--list-name "<saved list name>"]',
  );
  process.exit(2);
}
const model = arg("--model", "claude-opus-4-8");
const batchSize = Math.max(10, parseInt(arg("--batch-size", "60"), 10) || 60);
const passes = Math.max(1, parseInt(arg("--passes", "2"), 10) || 2);
const language = arg("--language", "en");
// Optional provenance tying this map to a saved word-list-library list. When a
// list id is given, the map is filed under `<listId>.json` by default and
// stamped with listId/listName — mirroring GameState.wordListId so the map is
// traceable to the list it serves (see docs/BOT_SEMANTIC_MAPS.md).
const listId = arg("--list-id", null);
const listName = arg("--list-name", null);
const defaultBase = listId
  ? listId
  : basename(wordsPath).replace(/\.[^.]*$/, "");
const outPath = resolve(
  arg(
    "--out",
    join(
      ROOT,
      "server",
      "src",
      "bots",
      "data",
      "semantic-maps",
      `${defaultBase}.json`,
    ),
  ),
);

// ---------------------------------------------------------------------------
// Word list parsing (mirrors the in-app parser: lines, trim, # comments,
// uppercase, dedupe)
// ---------------------------------------------------------------------------

const normalize = (w) => w.normalize("NFKC").trim().toLocaleUpperCase("en-US");
const rawLines = readFileSync(resolve(wordsPath), "utf8").split(/\r?\n/);
const words = [
  ...new Set(
    rawLines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map(normalize),
  ),
];
if (words.length < 2) {
  console.error(`Word list has ${words.length} usable words — nothing to map.`);
  process.exit(2);
}
if (words.length < 25) {
  console.warn(
    `Note: ${words.length} words is below the 25 a board needs; mapping anyway (combined-list use).`,
  );
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

   For EACH linked word give the per-edge channels:
   - "weight" in (0, 1]: how strongly the clue retrieves THIS word for a typical
     adult at table speed. 1 = instant and dominant; 0.5 = plausible but takes a
     beat; below 0.4 = do not include the edge at all.
   - "kind": how the clue reaches the word — one of "content" (a thing vividly
     inside the clue's frame), "member" (taxonomic member of the category),
     "part" (part/whole), "compound" (the two words form a phrase or compound),
     "function" (what it does / is used for), "attribute" (a quality it has).
   - "collocation" in (0, 1], OPTIONAL: only when clue+word form a common phrase
     or compound in either order ("manta ray", "engine box"), rate how frequent
     the phrase is. Omit when they don't form a phrase. Phrase completion is
     AUTOMATIC for guessers, so an honest collocation rating on a weak edge is
     valuable safety data.

2. "references" — proper-noun / pop-culture clues (films, characters, brands,
   places, events, acronyms), each linking 1-4 of the given board words through
   ONE specific vivid thing. Write each reference in its CANONICAL case exactly
   ("Cinderella", "iPhone", "NASA", "McDonald's") — the game preserves clue
   capitalization and mixed case signals "the specific reference, not the common
   sense". Rate "fame" in (0, 1]: 1 = everyone on earth knows it; only include
   references most casual players would recognize (fame >= 0.5). For each linked
   word give "weight" in (0, 1]: among people who KNOW the reference, how
   reliably it retrieves this word (1 = the first thing they picture).

   THE REFERENT KNOWS MORE THAN YOU: sweep each reference's contents from
   external knowledge, never just the link you had in mind. List EVERY given
   board word the reference genuinely evokes — famous scenes, characters,
   props, product/brand tiers ("Tinder Gold"), locations — even at low weight;
   a spymaster must see that "Thunderball" lights up POOL and CASINO before
   promising a number that sends a guesser there. Also list "rivals": OTHER
   referents the same clue word evokes (Apollo the program vs Apollo Creed),
   each with its own fame and the given board words ITS contents reach —
   guessers who resolve the word to the rival will chase those.

Hard rules:
- Every linked word MUST be copied verbatim from the given board words.
- A clue must be a SINGLE word (no spaces) and must NOT be one of the board words,
  contain one, or be contained by one (that clue would be illegal in the game).
- Prefer several tight, obvious groups over sprawling loose ones.
- Cover as many of the given board words as you honestly can; leaving a word
  uncovered is better than inventing a weak association for it.
- Concepts in UPPERCASE. References in canonical display case.
- Language of the board words: ${language}.`;

const EDGE_KINDS = [
  "content",
  "member",
  "part",
  "compound",
  "function",
  "attribute",
];

const CONCEPT_EDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["word", "weight", "kind"],
  properties: {
    word: { type: "string" },
    weight: { type: "number" },
    kind: { type: "string", enum: EDGE_KINDS },
    collocation: { type: "number" },
  },
};

const REFERENCE_EDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["word", "weight"],
  properties: {
    word: { type: "string" },
    weight: { type: "number" },
  },
};

const RIVAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["referent", "fame", "words"],
  properties: {
    referent: { type: "string" },
    fame: { type: "number" },
    words: { type: "array", items: REFERENCE_EDGE_SCHEMA },
  },
};

const MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["concepts", "references"],
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["clue", "words", "commonness"],
        properties: {
          clue: { type: "string" },
          words: { type: "array", items: CONCEPT_EDGE_SCHEMA },
          commonness: { type: "number" },
        },
      },
    },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["clue", "words", "fame"],
        properties: {
          clue: { type: "string" },
          words: { type: "array", items: REFERENCE_EDGE_SCHEMA },
          fame: { type: "number" },
          rivals: { type: "array", items: RIVAL_SCHEMA },
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
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
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
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: MAP_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Board words (${batch.length}):\n${batch.join("\n")}`,
      },
    ],
  });
  usage.input += response.usage.input_tokens ?? 0;
  usage.output += response.usage.output_tokens ?? 0;
  if (response.stop_reason === "refusal") {
    console.warn(`  ${label}: request refused — skipping batch`);
    return { concepts: [], references: [] };
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  try {
    const parsed = JSON.parse(text);
    // Parsable-but-not-an-object (a bare null/number/array) must degrade
    // to an empty batch, not crash the whole (paid) run inside absorb().
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      console.warn(`  ${label}: non-object output — skipping batch`);
      return { concepts: [], references: [] };
    }
    return parsed;
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

const concepts = new Map(); // normalized clue -> Map(list word -> {weight, kind?, collocation?})
const proper = new Map(); // display-case clue -> Map(list word -> {weight})
const properByNorm = new Map(); // normalized -> display-case (dedupe across batches)
const properFame = new Map(); // display-case clue -> fame rating
const properRivals = new Map(); // display-case clue -> Map(referent -> {fame, contents Map})
const commonness = new Map(); // normalized concept key -> rating
const covered = new Set();

// The default applies only when the value is MISSING or non-numeric — an
// explicit 0 is a no-confidence rating and must clamp to the floor, never be
// promoted to the default (`Number(v) || def` would do exactly that).
const clampUnit = (v, def) => {
  const n = Number(v);
  if (!Number.isFinite(n) || v === undefined || v === null || v === "")
    return Math.min(1, Math.max(0.05, def));
  return Math.min(1, Math.max(0.05, n));
};

/** Merge a duplicate edge across passes/batches: numeric channels take the
 *  max (order-independent), the kind is kept from the first edge declaring one. */
function mergeEdgeInto(edges, word, edge) {
  const existing = edges.get(word);
  if (!existing) {
    edges.set(word, edge);
    return;
  }
  existing.weight = Math.max(existing.weight, edge.weight);
  if (existing.kind === undefined) existing.kind = edge.kind;
  if (edge.collocation !== undefined) {
    existing.collocation =
      existing.collocation === undefined
        ? edge.collocation
        : Math.max(existing.collocation, edge.collocation);
  }
}

/** Normalize one {word, weight, ...} item; null when the word is off-list. */
function usableEdge(item, key) {
  const w = normalize(item?.word ?? "");
  if (!wordSet.has(w) || w === key) return null;
  const edge = { word: w, weight: clampUnit(item.weight, 0.8) };
  if (EDGE_KINDS.includes(item.kind)) edge.kind = item.kind;
  if (item.collocation !== undefined)
    edge.collocation = clampUnit(item.collocation, 0.5);
  return edge;
}

function absorb(result) {
  for (const item of result.concepts ?? []) {
    const clue = usableClue(item.clue ?? "");
    if (!clue) continue;
    const key = normalize(clue);
    const targets = (item.words ?? [])
      .map((e) => usableEdge(e, key))
      .filter(Boolean);
    if (targets.length === 0) continue;
    const edges = concepts.get(key) ?? new Map();
    for (const t of targets) {
      mergeEdgeInto(edges, t.word, t);
      covered.add(t.word);
    }
    concepts.set(key, edges);
    const c = clampUnit(item.commonness, 0.8);
    commonness.set(key, Math.max(commonness.get(key) ?? 0, c));
  }
  for (const item of result.references ?? []) {
    const clue = usableClue(item.clue ?? "");
    if (!clue) continue;
    if (clue === clue.toLowerCase()) continue; // all-lowercase can't carry the reference signal
    const key = normalize(clue);
    const display = properByNorm.get(key) ?? clue;
    properByNorm.set(key, display);
    const targets = (item.words ?? [])
      .map((e) => usableEdge(e, key))
      .filter(Boolean);
    if (targets.length === 0) continue;
    const edges = proper.get(display) ?? new Map();
    for (const t of targets) {
      mergeEdgeInto(edges, t.word, { word: t.word, weight: t.weight });
      covered.add(t.word);
    }
    proper.set(display, edges);
    const f = clampUnit(item.fame, 0.8);
    properFame.set(display, Math.max(properFame.get(display) ?? 0, f));
    // Rival referents ("the referent knows more than you" sweep): keep the
    // ones whose contents actually land on the list. Rival contents do NOT
    // mark words covered — a rival pull is a hazard edge, not coverage.
    for (const rival of item.rivals ?? []) {
      const name = String(rival?.referent ?? "").trim();
      if (!name) continue;
      const contents = (rival.words ?? [])
        .map((e) => usableEdge(e, key))
        .filter(Boolean);
      if (contents.length === 0) continue;
      const rivals = properRivals.get(display) ?? new Map();
      const existing = rivals.get(name) ?? { fame: 0, contents: new Map() };
      existing.fame = Math.max(existing.fame, clampUnit(rival.fame, 0.5));
      for (const c of contents)
        mergeEdgeInto(existing.contents, c.word, {
          word: c.word,
          weight: c.weight,
        });
      rivals.set(name, existing);
      properRivals.set(display, rivals);
    }
  }
}

async function main() {
  console.log(
    `Building semantic map for ${words.length} words with ${model} (${passes} pass(es))…`,
  );

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
      absorb(await generateForBatch(batch, "coverage pass"));
    }
  }

  // Emit the v2 document (per-edge weight/kind/collocation channels;
  // structured proper entries carrying fame) — the format
  // server/src/bots/semantics/mapBackend.ts validates as version 2.
  const sortedEdges = (edges) =>
    [...edges.values()].sort((a, b) =>
      a.word < b.word ? -1 : a.word > b.word ? 1 : 0,
    );
  const referenceEntry = (k, edges) => {
    const entry = {
      contents: sortedEdges(edges),
      fame: properFame.get(k) ?? 0.8,
    };
    const rivals = properRivals.get(k);
    if (rivals && rivals.size > 0) {
      entry.rivals = [...rivals.entries()].sort().map(([referent, r]) => ({
        referent,
        fame: r.fame,
        contents: sortedEdges(r.contents),
      }));
    }
    return entry;
  };
  const doc = {
    version: 2,
    language,
    wordlist: basename(wordsPath),
    model,
    ...(listId ? { listId } : {}),
    ...(listName ? { listName } : {}),
    words,
    concepts: Object.fromEntries(
      [...concepts.entries()].sort().map(([k, v]) => [k, sortedEdges(v)]),
    ),
    proper: Object.fromEntries(
      [...proper.entries()].sort().map(([k, v]) => [k, referenceEntry(k, v)]),
    ),
    commonness: Object.fromEntries([...commonness.entries()].sort()),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);

  const finallyCovered = words.filter((w) => covered.has(w));
  const pct = ((100 * finallyCovered.length) / words.length).toFixed(1);
  console.log(`\nWrote ${outPath}`);
  console.log(
    `  ${concepts.size} concepts, ${proper.size} references — ${finallyCovered.length}/${words.length} words covered (${pct}%)`,
  );
  const stillUncovered = words.filter((w) => !covered.has(w));
  if (stillUncovered.length > 0) {
    console.log(
      `  uncovered (lexical fallback will apply): ${stillUncovered.join(", ")}`,
    );
  }
  // Opus 4.8 pricing: $5 / $25 per MTok.
  const cost = (usage.input * 5 + usage.output * 25) / 1_000_000;
  console.log(
    `  tokens: ${usage.input} in / ${usage.output} out (~$${cost.toFixed(2)} at ${model} rates)`,
  );
  console.log(
    "\nBots load every *.json in the semantic-maps directory at startup —",
  );
  console.log("restart the server (or bots) to pick the new map up.");
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error(
      "Authentication failed: set ANTHROPIC_API_KEY or log in once with `ant auth login`.",
    );
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error(
      "Rate limited by the API — re-run in a minute (progress is not saved between runs).",
    );
  } else if (err instanceof Anthropic.APIConnectionError) {
    console.error(
      "Could not reach the Anthropic API — check network access and retry.",
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
