#!/usr/bin/env bun
// Builds the Python inference service into a standalone PyInstaller onedir
// bundle and stages it under src-tauri/resources-staging/ so it can be
// shipped as a Tauri resource and spawned as a second sidecar (see
// src-tauri/src/lib.rs) -- no Python/uv install required on the end user's
// machine.
//
// Uses a dedicated build venv (via UV_PROJECT_ENVIRONMENT) rather than
// inference/.venv, so this never disturbs a developer's own running dev
// server or its installed packages.
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const inferenceDir = join(rootDir, "inference");
const buildVenvDir = join(inferenceDir, ".build-venv");
const stagingRoot = join(rootDir, "src-tauri", "resources-staging");
const distDirName = "searchit-inference";
const workDir = join(stagingRoot, "inference-build");

const isWindows = process.platform === "win32";
const exeName = isWindows ? "searchit-inference.exe" : "searchit-inference";
const stagedExe = join(stagingRoot, distDirName, exeName);

// This build takes 1-2 minutes (uv sync + PyInstaller), which is too slow to
// re-run on every `tauri dev` restart. Skip it once it's already staged;
// force a rebuild after inference source/dependency changes with
// `FORCE_REBUILD_INFERENCE=1 bun run bundle:inference`.
if (existsSync(stagedExe) && !process.env.FORCE_REBUILD_INFERENCE) {
  console.log(
    `Inference sidecar already staged at ${stagedExe} -- skipping rebuild (set FORCE_REBUILD_INFERENCE=1 to force).`,
  );
  process.exit(0);
}

const pythonBin = join(buildVenvDir, isWindows ? "Scripts/python.exe" : "bin/python");
const pyinstallerBin = join(
  buildVenvDir,
  isWindows ? "Scripts/pyinstaller.exe" : "bin/pyinstaller",
);

function run(cmd, opts = {}) {
  const result = Bun.spawnSync({
    cmd,
    stdout: "inherit",
    stderr: "inherit",
    ...opts,
  });
  if (!result.success) {
    throw new Error(`command failed: ${cmd.join(" ")}`);
  }
  return result;
}

console.log("Syncing inference build environment...");
const uvSyncEnv = { ...process.env, UV_PROJECT_ENVIRONMENT: buildVenvDir };
// The `directml` extra replaces the base `onnxruntime` package (same import
// name -- see pyproject.toml), so it must be requested explicitly on
// Windows or the bundled build silently loses GPU acceleration. Omitting it
// here previously let the persistent .build-venv drift between "has
// onnxruntime-directml" (from some earlier manual install) and "just
// onnxruntime" (this sync's default), and switching between same-named
// packages in place is what corrupted the onnxruntime module for
// PyInstaller's own import probe.
run(["uv", "sync", ...(isWindows ? ["--extra", "directml"] : [])], {
  cwd: inferenceDir,
  env: uvSyncEnv,
});
if (isWindows) {
  // insightface hard-depends on plain `onnxruntime` (CPU-only), which shares
  // its import path with `onnxruntime-directml` -- `uv sync --extra directml`
  // above installs both, and insightface's transitive requirement wins the
  // shared `onnxruntime/` package directory, silently leaving the sidecar on
  // CPU. Force-reinstalling the directml wheel last overwrites those files
  // so it's what actually gets imported as `onnxruntime` at runtime.
  run(
    ["uv", "pip", "install", "--reinstall", "--no-deps", "onnxruntime-directml"],
    { cwd: inferenceDir, env: uvSyncEnv },
  );
}
run(["uv", "pip", "install", "--python", buildVenvDir, "pyinstaller"], {
  cwd: inferenceDir,
});

// insightface's PyInstaller accommodation looks for this file directly under
// sys._MEIPASS/objects/ (not the package's own data/objects/ path), so it
// needs an explicit --add-data rule rather than relying on --collect-data's
// normal package-relative layout.
const findMeanshape = Bun.spawnSync({
  cmd: [
    pythonBin,
    "-c",
    "import insightface, os; print(os.path.join(os.path.dirname(insightface.__file__), 'data', 'objects', 'meanshape_68.pkl'))",
  ],
});
const meanshapePath = findMeanshape.stdout.toString().trim();
const addDataSep = isWindows ? ";" : ":";

rmSync(join(stagingRoot, distDirName), { recursive: true, force: true });
rmSync(workDir, { recursive: true, force: true });

console.log("Building inference sidecar with PyInstaller...");
run(
  [
    pyinstallerBin,
    "--onedir",
    "--name",
    distDirName,
    "--noconfirm",
    "--distpath",
    stagingRoot,
    "--workpath",
    workDir,
    "--specpath",
    workDir,
    "--collect-data",
    "insightface",
    // ocr_native.py's default OCR tier on every platform but macOS -- bundle
    // its ~32MB of ONNX weights the same way insightface's are, so it works
    // offline from first launch instead of trying (and on a read-only
    // install directory, failing) to download them at runtime.
    "--collect-data",
    "rapidocr",
    "--add-data",
    `${meanshapePath}${addDataSep}objects`,
    join(inferenceDir, "main.py"),
  ],
  { cwd: inferenceDir },
);

rmSync(workDir, { recursive: true, force: true });

console.log(`Inference sidecar staged at ${join(stagingRoot, distDirName)}`);
