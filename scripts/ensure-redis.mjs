#!/usr/bin/env node
/**
 * Ensure a Redis is available for local development, cross-platform (Windows /
 * macOS / Linux), so `npm run dev:bots` is turnkey and nobody has to hand-manage a
 * Redis container.
 *
 * Resolution order:
 *   1. REDIS_URL=memory               → respect it (embedded memory mode).
 *   2. A Redis already reachable at the target URL → use it.
 *   3. Target is local + Docker is up → start a managed `eigennamen-redis`
 *      container (created with --restart unless-stopped so it survives reboots),
 *      then wait for it to accept connections.
 *   4. Otherwise → fall back: if REDIS_URL was set explicitly, keep it (the server
 *      will retry); if it was unset, leave it unset so memory mode applies. Windows
 *      has no redis-server binary, so memory mode fails there — the message points
 *      to Docker Desktop / Memurai.
 *
 * Returns the REDIS_URL the dev server should use, or `undefined` to leave it
 * unset (memory mode). Usable as a module (`ensureRedis()`) or a CLI
 * (`node scripts/ensure-redis.mjs` / `--down`).
 */
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MANAGED_NAME = "eigennamen-redis";
const IMAGE = "redis:7-alpine";
const DEFAULT_URL = "redis://127.0.0.1:6379";

function parseRedisUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname || "127.0.0.1", port: Number(u.port) || 6379 };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
}

/** Resolve true if a TCP connection to host:port succeeds within timeoutMs. */
function tcpReachable(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

function docker(args) {
  return spawnSync("docker", args, { stdio: "pipe", encoding: "utf8" });
}

function dockerAvailable() {
  const r = docker(["version", "--format", "{{.Server.Version}}"]);
  return !r.error && r.status === 0 && String(r.stdout).trim().length > 0;
}

function containerExists(name) {
  const r = docker([
    "ps",
    "-a",
    "--filter",
    `name=^/${name}$`,
    "--format",
    "{{.Names}}",
  ]);
  return (
    !r.error &&
    r.status === 0 &&
    String(r.stdout).trim().split("\n").includes(name)
  );
}

function startManagedRedis(port) {
  if (containerExists(MANAGED_NAME)) {
    const r = docker(["start", MANAGED_NAME]);
    return !r.error && r.status === 0;
  }
  const r = docker([
    "run",
    "-d",
    "--name",
    MANAGED_NAME,
    "--restart",
    "unless-stopped",
    "-p",
    `${port}:6379`,
    IMAGE,
  ]);
  return !r.error && r.status === 0;
}

async function waitReachable(host, port, totalMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (await tcpReachable(host, port, 700)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Ensure a usable Redis and return the REDIS_URL to run with (or undefined to
 * leave REDIS_URL unset → memory mode).
 */
export async function ensureRedis({ quiet = false } = {}) {
  const log = (m) => {
    if (!quiet) console.log(m);
  };
  const raw = process.env.REDIS_URL;

  if (raw === "memory") {
    log("✓ REDIS_URL=memory — using the embedded memory-mode Redis.");
    return "memory";
  }

  const explicit = !!raw && /^rediss?:\/\//.test(raw);
  const url = explicit ? raw : DEFAULT_URL;
  const { host, port } = parseRedisUrl(url);

  if (await tcpReachable(host, port)) {
    log(`✓ Redis reachable at ${url}`);
    return url;
  }

  const isLocal =
    host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (isLocal && dockerAvailable()) {
    log(
      `↻ No Redis at ${url} — starting a managed Docker container (${MANAGED_NAME})…`,
    );
    if (startManagedRedis(port) && (await waitReachable(host, port))) {
      log(`✓ Redis ready at ${url} (Docker container "${MANAGED_NAME}").`);
      return url;
    }
    console.warn(
      "⚠ Could not start the managed Redis container — is Docker Desktop running?",
    );
  }

  if (explicit) {
    console.warn(
      `⚠ Redis at ${raw} is unreachable. Start it (try \`npm run redis:up\`); the server will keep retrying.`,
    );
    return url;
  }

  console.warn(
    "⚠ No reachable Redis and Docker is unavailable — falling back to memory mode.",
  );
  console.warn(
    "  Windows has no redis-server binary, so start Docker Desktop (or install Memurai) and re-run.",
  );
  return undefined;
}

/** Stop the managed Redis container (no-op if absent). */
export function stopManagedRedis() {
  if (!dockerAvailable()) {
    console.warn("Docker is not available.");
    return;
  }
  if (!containerExists(MANAGED_NAME)) {
    console.log(`No managed Redis container ("${MANAGED_NAME}") to stop.`);
    return;
  }
  const r = docker(["stop", MANAGED_NAME]);
  console.log(
    r.status === 0
      ? `✓ Stopped "${MANAGED_NAME}".`
      : `⚠ Could not stop "${MANAGED_NAME}".`,
  );
}

// CLI entry: `node scripts/ensure-redis.mjs` ensures Redis; `--down` stops it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--down")) {
    stopManagedRedis();
  } else {
    const url = await ensureRedis();
    if (url && url !== "memory") console.log(`REDIS_URL=${url}`);
  }
}
