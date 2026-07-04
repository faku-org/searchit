#!/usr/bin/env bun
// Stages a self-contained, runnable copy of the Bun server into
// src-tauri/resources-staging/server so it can be shipped as a Tauri
// "resource" and executed by a bundled Bun sidecar binary (see
// src-tauri/src/lib.rs). Not usable directly out of server/ because:
//
// - server/node_modules entries are symlinks into a monorepo-wide, hoisted
//   node_modules/.bun store (Bun's isolated-install layout), which doesn't
//   exist outside this repo checkout.
// - @searchit/shared is a `workspace:*` dependency, resolved only inside this
//   monorepo's workspace root.
//
// So this script copies the server + shared *sources* into an isolated
// staging folder, drops the shared workspace dependency before installing
// (Bun's `file:` deps try to symlink/hardlink on Windows, which EPERMs
// without Developer Mode/elevation), runs a fresh `bun install --production`
// scoped entirely to that folder, then copies @searchit/shared's source
// straight into the staged node_modules as plain files -- self-contained, no
// reliance on the outer repo or on symlinks at runtime.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(rootDir, "server");
const sharedDir = join(rootDir, "packages", "shared");
const stagingRoot = join(rootDir, "src-tauri", "resources-staging");
const serverStage = join(stagingRoot, "server");
const sharedStage = join(stagingRoot, "packages", "shared");

console.log("Staging server bundle for Tauri resources...");

// Scoped to this script's own subfolders -- resources-staging/ is shared
// with scripts/bundle-inference.mjs's output, which must survive this run.
rmSync(serverStage, { recursive: true, force: true });
rmSync(join(stagingRoot, "packages"), { recursive: true, force: true });
mkdirSync(serverStage, { recursive: true });
mkdirSync(sharedStage, { recursive: true });

cpSync(join(sharedDir, "src"), join(sharedStage, "src"), { recursive: true });
cpSync(join(sharedDir, "package.json"), join(sharedStage, "package.json"));

cpSync(join(serverDir, "src"), join(serverStage, "src"), { recursive: true });
cpSync(join(serverDir, "drizzle"), join(serverStage, "drizzle"), {
  recursive: true,
});

const serverPkg = await Bun.file(join(serverDir, "package.json")).json();
delete serverPkg.devDependencies;
delete serverPkg.scripts;
// Installed for real below; omitted here so `bun install` doesn't try (and
// fail) to resolve it as a package on its own.
delete serverPkg.dependencies["@searchit/shared"];
writeFileSync(
  join(serverStage, "package.json"),
  `${JSON.stringify(serverPkg, null, 2)}\n`,
);

console.log("Installing production dependencies in the staged copy...");
const install = Bun.spawnSync({
  cmd: ["bun", "install", "--production"],
  cwd: serverStage,
  stdout: "inherit",
  stderr: "inherit",
});
if (!install.success) {
  throw new Error(`bun install failed in staged server (${serverStage})`);
}

// Placed as plain files (not a symlink/`file:` dependency) so this is
// self-contained and doesn't depend on Windows symlink permissions.
const sharedNodeModulesDir = join(serverStage, "node_modules", "@searchit", "shared");
mkdirSync(sharedNodeModulesDir, { recursive: true });
cpSync(sharedStage, sharedNodeModulesDir, { recursive: true });

console.log(`Server bundle staged at ${serverStage}`);
