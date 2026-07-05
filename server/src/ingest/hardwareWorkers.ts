import os from "node:os";

const BYTES_PER_GB = 1024 ** 3;
const DEFAULT_WORKERS = 3;
const MIN_WORKERS = DEFAULT_WORKERS;
const MAX_WORKERS_CAP = 12;

// Windows' WMI Win32_VideoController.AdapterRAM is a 32-bit field that wraps
// around ~4GB, so it reports garbage for most GPUs worth detecting (an
// 8GB+ card can read back as ~0-4GB). The driver's own registry entry is a
// QWORD and doesn't have that limitation -- see e.g. GPU-Z/HWiNFO, which use
// the same key. One subkey per adapter instance (0000, 0001, ...) under the
// "Display" device class GUID; take the max across all of them in case of a
// hybrid/multi-GPU laptop.
const DISPLAY_CLASS_GUID = "{4d36e968-e325-11ce-bfc1-08002be10318}";

function detectVramGB(): number | null {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const result = Bun.spawnSync([
      "reg",
      "query",
      `HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\${DISPLAY_CLASS_GUID}`,
      "/s",
      "/v",
      "HardwareInformation.qwMemorySize",
    ]);
    if (!result.success) {
      return null;
    }

    const output = result.stdout.toString();
    const matches = [...output.matchAll(/HardwareInformation\.qwMemorySize\s+REG_QWORD\s+(0x[0-9a-fA-F]+)/g)];
    if (matches.length === 0) {
      return null;
    }

    const maxBytes = matches.reduce(
      (max, match) => (BigInt(match[1]) > max ? BigInt(match[1]) : max),
      0n,
    );
    return maxBytes > 0n ? Number(maxBytes) / BYTES_PER_GB : null;
  } catch {
    return null;
  }
}

// Auto-scales the ingest worker pool to the host machine when
// SEARCHIT_INGEST_WORKERS isn't set explicitly, so a beefy machine (more
// cores, more RAM, a real GPU) processes more photos at once instead of
// being stuck at the old flat default of 3 -- see concurrency.ts. Face
// detection itself is still serialized behind GPU_LOCK process-wide in the
// inference service regardless of worker count, so the win here is mainly
// from preview generation, CLIP (CPU-only), and OCR being able to run more
// of those concurrently while face detection queues up.
export function computeDefaultWorkerCount(): {
  workers: number;
  cores: number;
  ramGB: number;
  vramGB: number | null;
} {
  const cores = os.cpus().length;
  const ramGB = os.totalmem() / BYTES_PER_GB;
  const vramGB = detectVramGB();

  const coresBudget = Math.max(1, Math.floor(cores / 2));
  const ramBudget = Math.max(1, Math.floor(ramGB / 8));
  const base = Math.min(coresBudget, ramBudget);

  const vramBonus = vramGB === null ? 0 : vramGB >= 8 ? 2 : vramGB >= 4 ? 1 : 0;

  const workers = Math.min(MAX_WORKERS_CAP, Math.max(MIN_WORKERS, base + vramBonus));

  return { workers, cores, ramGB, vramGB };
}
