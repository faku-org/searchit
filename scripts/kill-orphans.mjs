#!/usr/bin/env bun
// Frees up state left behind by a `tauri dev` session that didn't shut down
// cleanly (killed terminal, crash) -- sidecars are only killed on a graceful
// `RunEvent::Exit` (see src-tauri/src/lib.rs), so a hard-killed session
// leaves orphaned processes running.
//
// Two kinds of args:
// - numeric: a TCP port to free (Vite's dev server binds a fixed port, 1420,
//   with `strictPort: true` in vite.config.ts, so an orphaned listener makes
//   the next `tauri dev` fail outright instead of just picking a new port).
// - name: a process base name (e.g. "bun-server") to kill by image name. The
//   sidecar binaries (src-tauri/binaries/bun-server-<triple>.exe, the
//   PyInstaller-built inference exe) get overwritten on every `tauri dev`
//   restart by scripts/fetch-bun-sidecar.mjs and scripts/bundle-inference.mjs
//   -- if an orphaned copy is still running, Windows refuses to overwrite its
//   own locked executable ("os error 32") and the bundle step dies.
const args = process.argv.slice(2);
const ports = args.filter((a) => /^\d+$/.test(a)).map(Number);
const names = args.filter((a) => !/^\d+$/.test(a));

if (ports.length === 0 && names.length === 0) {
  console.error("Usage: kill-orphans.mjs <port|name> [port|name...]");
  process.exit(1);
}

function findPidsOnPort(port) {
  if (process.platform === "win32") {
    const out = Bun.spawnSync({
      cmd: ["cmd", "/c", `netstat -ano -p tcp | findstr :${port}`],
    }).stdout.toString();
    const pids = new Set();
    for (const line of out.split("\n")) {
      const match = line.trim().match(/LISTENING\s+(\d+)\s*$/);
      if (match) pids.add(match[1]);
    }
    return [...pids];
  }

  const out = Bun.spawnSync({
    cmd: ["lsof", "-ti", `tcp:${port}`],
  }).stdout.toString();
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

for (const port of ports) {
  const pids = findPidsOnPort(port);
  for (const pid of pids) {
    console.log(`Killing orphaned process ${pid} on port ${port}`);
    if (process.platform === "win32") {
      Bun.spawnSync({ cmd: ["taskkill", "/F", "/PID", pid] });
    } else {
      Bun.spawnSync({ cmd: ["kill", "-9", pid] });
    }
  }
}

for (const name of names) {
  if (process.platform === "win32") {
    const result = Bun.spawnSync({
      cmd: ["taskkill", "/F", "/T", "/IM", `${name}*.exe`],
    });
    if (result.success) console.log(`Killed orphaned process(es) matching ${name}*.exe`);
  } else {
    const result = Bun.spawnSync({ cmd: ["pkill", "-f", name] });
    if (result.success) console.log(`Killed orphaned process(es) matching ${name}`);
  }
}
