#!/usr/bin/env bun
// Smoke-tests the two bundled sidecars (staged by scripts/bundle-server.mjs,
// scripts/fetch-bun-sidecar.mjs, scripts/bundle-inference.mjs) by spawning
// the exact binaries/resources the real Tauri app ships and exercising real
// endpoints -- mirroring the manual verification done by hand during
// development, now automated. Used by .github/workflows/release.yml's
// smoke-test job; also runnable locally after
// `bun run bundle:server && bun run bundle:inference`.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const stagingRoot = join(rootDir, "src-tauri", "resources-staging");
const binariesDir = join(rootDir, "src-tauri", "binaries");
const fixturesDir = join(rootDir, "scripts", "fixtures");
const isWindows = process.platform === "win32";
const exeSuffix = isWindows ? ".exe" : "";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function getTargetTriple() {
  const output = Bun.spawnSync({ cmd: ["rustc", "-vV"] }).stdout.toString();
  const match = output.match(/host: (\S+)/);
  if (!match) {
    throw new Error("Could not determine host target triple from `rustc -vV`");
  }
  return match[1];
}

async function waitForHealth(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return await res.json();
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for http://127.0.0.1:${port}/health`);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const targetTriple = getTargetTriple();
const bunServerBin = join(binariesDir, `bun-server-${targetTriple}${exeSuffix}`);
const serverEntry = join(stagingRoot, "server", "src", "index.ts");
const inferenceBin = join(
  stagingRoot,
  "searchit-inference",
  `searchit-inference${exeSuffix}`,
);

const tmpRoot = mkdtempSync(join(tmpdir(), "searchit-smoke-"));
const serverPort = await findFreePort();
const inferencePort = await findFreePort();

console.log(`Spawning inference sidecar: ${inferenceBin}`);
const inferenceProc = Bun.spawn({
  cmd: [inferenceBin],
  env: {
    ...process.env,
    INFERENCE_MOCK: "false",
    MODEL_CACHE_DIR: join(tmpRoot, "models"),
    PORT: String(inferencePort),
  },
  stdout: "inherit",
  stderr: "inherit",
});

console.log(`Spawning server sidecar: ${bunServerBin} ${serverEntry}`);
const serverProc = Bun.spawn({
  cmd: [bunServerBin, serverEntry],
  env: {
    ...process.env,
    DATABASE_URL: "",
    SEARCHIT_DB_DIR: join(tmpRoot, "db"),
    SEARCHIT_WATCH_DIR: join(tmpRoot, "incoming"),
    SEARCHIT_PREVIEW_DIR: join(tmpRoot, "previews"),
    SEARCHIT_FACE_THUMBNAIL_DIR: join(tmpRoot, "face-thumbnails"),
    INFERENCE_URL: `http://127.0.0.1:${inferencePort}`,
    HOST: "127.0.0.1",
    PORT: String(serverPort),
  },
  stdout: "inherit",
  stderr: "inherit",
});

try {
  console.log("Waiting for inference sidecar health...");
  const inferenceHealth = await waitForHealth(inferencePort);
  assert(inferenceHealth.ok === true, "inference /health ok=true");
  assert(inferenceHealth.mock === false, "inference /health mock=false");
  console.log("inference providers:", inferenceHealth.providers);
  if (process.platform === "darwin") {
    assert(
      inferenceHealth.providers[0] === "CoreMLExecutionProvider",
      `CoreMLExecutionProvider selected on macOS (got ${JSON.stringify(inferenceHealth.providers)})`,
    );
  } else {
    console.log(`(not hard-asserting a specific provider on ${process.platform})`);
  }

  console.log("Waiting for server sidecar health...");
  const serverHealth = await waitForHealth(serverPort);
  assert(serverHealth.ok === true, "server /health ok=true");
  assert(
    serverHealth.inference === true,
    "server /health inference=true (sidecars wired together via INFERENCE_URL)",
  );

  console.log("Testing OCR (OS-native text recognition)...");
  const ocrRes = await fetch(`http://127.0.0.1:${inferencePort}/read-scene-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePath: join(fixturesDir, "test-text.jpg") }),
  });
  const ocrBody = await ocrRes.json();
  assert(
    ocrBody.text === "FINISH LINE 10K",
    `OCR recognized exact text (got ${JSON.stringify(ocrBody.text)})`,
  );

  console.log("Testing CLIP embeddings (semantic ranking)...");
  async function embedImage(fixtureName) {
    const res = await fetch(`http://127.0.0.1:${inferencePort}/embed-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: join(fixturesDir, fixtureName) }),
    });
    return (await res.json()).embedding;
  }
  async function embedText(text) {
    const res = await fetch(`http://127.0.0.1:${inferencePort}/embed-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return (await res.json()).embedding;
  }

  const redImageEmb = await embedImage("test-red.jpg");
  const blueImageEmb = await embedImage("test-blue.jpg");
  const redTextEmb = await embedText("a photo of a solid red color");
  const blueTextEmb = await embedText("a photo of a solid blue color");

  const redVsRed = cosineSimilarity(redImageEmb, redTextEmb);
  const redVsBlue = cosineSimilarity(redImageEmb, blueTextEmb);
  const blueVsBlue = cosineSimilarity(blueImageEmb, blueTextEmb);
  const blueVsRed = cosineSimilarity(blueImageEmb, redTextEmb);
  assert(
    redVsRed > redVsBlue,
    `CLIP: red image ranks red text higher than blue text (${redVsRed.toFixed(4)} > ${redVsBlue.toFixed(4)})`,
  );
  assert(
    blueVsBlue > blueVsRed,
    `CLIP: blue image ranks blue text higher than red text (${blueVsBlue.toFixed(4)} > ${blueVsRed.toFixed(4)})`,
  );

  console.log("Testing face detection...");
  const facesRes = await fetch(`http://127.0.0.1:${inferencePort}/detect-faces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePath: join(fixturesDir, "test-face.jpg") }),
  });
  const facesBody = await facesRes.json();
  assert(facesBody.faces.length >= 1, `detected at least one face (got ${facesBody.faces.length})`);
  if (facesBody.faces.length > 0) {
    const face = facesBody.faces[0];
    assert(face.confidence > 0.5, `face confidence > 0.5 (got ${face.confidence})`);
    assert(
      face.embedding.length === 512,
      `face embedding is 512-dim (got ${face.embedding.length})`,
    );
  }
} finally {
  serverProc.kill();
  inferenceProc.kill();
  rmSync(tmpRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} smoke test assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke test assertions passed.");
