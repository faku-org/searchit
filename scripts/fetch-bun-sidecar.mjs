#!/usr/bin/env bun
// Copies the Bun binary that's running this very script into
// src-tauri/binaries/ under the target-triple name Tauri's `externalBin`
// convention expects, so it can be bundled as a sidecar and used to run the
// staged server (see scripts/bundle-server.mjs) without requiring Bun to be
// installed on the end user's machine.
//
// `process.execPath` (this Bun binary) is already the correct build for the
// machine running this script -- true for local dev and for CI runners
// (each OS/arch in the release matrix has its own Bun installed natively via
// oven-sh/setup-bun), so no separate download step is needed.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const binariesDir = join(rootDir, "src-tauri", "binaries");

const targetTriple = (
  Bun.spawnSync({ cmd: ["rustc", "-vV"] }).stdout.toString().match(
    /host: (\S+)/,
  ) ?? []
)[1];
if (!targetTriple) {
  throw new Error("Could not determine host target triple from `rustc -vV`");
}

const ext = process.platform === "win32" ? ".exe" : "";
const dest = join(binariesDir, `bun-server-${targetTriple}${ext}`);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(process.execPath, dest);

console.log(`Bun sidecar staged at ${dest}`);
