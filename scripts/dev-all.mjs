#!/usr/bin/env bun
// Runs inference + server + client together as one command, for the plain
// browser-mode dev loop (localhost:4420 hitting the server directly) that
// AGENTS.md documents as three separate terminals. This is NOT a replacement
// for `bun run tauri dev` / `bun run tauri build`, which already autostart
// both sidecars as part of the actual desktop app -- this script exists for
// fast iteration on server/inference code with hot reload, without waiting
// on a PyInstaller rebuild of the inference sidecar.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const serverDir = join(rootDir, "server");
const inferenceDir = join(rootDir, "inference");
const mode = process.argv.includes("--prod") ? "prod" : "dev";

const RESET = "\x1b[0m";
const COLORS = {
  postgres: "\x1b[34m",
  inference: "\x1b[35m",
  server: "\x1b[36m",
  client: "\x1b[33m",
};

function log(name, line) {
  console.log(`${COLORS[name] ?? ""}[${name}]${RESET} ${line}`);
}

function pipeOutput(name, stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) log(name, line);
    }
    if (buffer.length > 0) log(name, buffer);
  })();
}

function readEnvValue(envPath, key, fallback) {
  if (!existsSync(envPath)) return fallback;
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
  return match && match[1].trim() ? match[1].trim() : fallback;
}

function usesExternalPostgres() {
  return Boolean(readEnvValue(join(serverDir, ".env"), "DATABASE_URL", ""));
}

// uvicorn --reload spawns a supervisor + a separate worker subprocess; on
// Windows, killing just the supervisor PID leaves the worker (and its port)
// alive, so the *next* run fails to bind with WinError 10013. Tree-killing
// on shutdown, and clearing anything already squatting on our ports before
// we start, keeps that from compounding across runs.
function killTree(proc) {
  if (process.platform === "win32") {
    Bun.spawnSync({ cmd: ["taskkill", "/PID", String(proc.pid), "/T", "/F"], stdout: "ignore", stderr: "ignore" });
  } else {
    proc.kill();
  }
}

function killPortIfOccupied(port, label) {
  if (process.platform !== "win32") return;
  const netstat = Bun.spawnSync({ cmd: ["cmd", "/c", `netstat -ano | findstr :${port}`], stdout: "pipe" });
  const pids = new Set();
  for (const line of netstat.stdout.toString().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes("LISTENING")) continue;
    const pid = trimmed.split(/\s+/).pop();
    if (pid && pid !== "0") pids.add(pid);
  }
  for (const pid of pids) {
    log(label, `port ${port} was still held by stale PID ${pid} (leftover from a previous run) -- killing it.`);
    Bun.spawnSync({ cmd: ["taskkill", "/PID", pid, "/F"], stdout: "ignore", stderr: "ignore" });
  }
}

const children = [];
function start(name, cmd, cwd) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  pipeOutput(name, proc.stdout);
  pipeOutput(name, proc.stderr);
  children.push(proc);
  return proc;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping all processes...");
  for (const proc of children) killTree(proc);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (usesExternalPostgres()) {
  log("postgres", "server/.env sets DATABASE_URL -- starting podman compose postgres...");
  const compose = Bun.spawnSync({
    cmd: ["podman", "compose", "up", "-d", "postgres"],
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!compose.success) {
    log("postgres", "docker compose failed -- is Docker running? Continuing anyway.");
  }
}

if (mode === "prod") {
  log("client", "building client for production preview...");
  const build = Bun.spawnSync({
    cmd: ["bun", "run", "build"],
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!build.success) {
    console.error("Client build failed, aborting.");
    process.exit(1);
  }
}

const inferencePort = readEnvValue(join(inferenceDir, ".env"), "PORT", "8000");
const serverPort = readEnvValue(join(serverDir, ".env"), "PORT", "3001");
const clientPort = "4420"; // fixed by vite.config.ts's strictPort

killPortIfOccupied(inferencePort, "inference");
killPortIfOccupied(serverPort, "server");
killPortIfOccupied(clientPort, "client");

start(
  "inference",
  mode === "prod"
    ? ["uv", "run", "uvicorn", "app:app", "--port", inferencePort]
    : ["uv", "run", "uvicorn", "app:app", "--reload", "--port", inferencePort],
  inferenceDir,
);

start(
  "server",
  mode === "prod" ? ["bun", "src/index.ts"] : ["bun", "--watch", "src/index.ts"],
  serverDir,
);

start("client", mode === "prod" ? ["bun", "x", "vite", "preview"] : ["bun", "x", "vite"], rootDir);

await Promise.all(children.map((proc) => proc.exited));
