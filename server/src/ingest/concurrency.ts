import { computeDefaultWorkerCount } from "./hardwareWorkers";

/**
 * Bounds how many photos the ingest pipeline (preview generation + inference)
 * processes at once, and exposes that in-flight count for the Developer tab's
 * "Processing" / "Workers" stats. Previously the watcher fired off every
 * stable file as an unbounded concurrent promise -- fine for correctness, but
 * it meant there was no real "workers" concept to report and no backpressure
 * against the inference service under a big backfill.
 */
const MAX_WORKERS = (() => {
  if (process.env.SEARCHIT_INGEST_WORKERS) {
    return Number(process.env.SEARCHIT_INGEST_WORKERS);
  }

  const { workers, cores, ramGB, vramGB } = computeDefaultWorkerCount();
  console.log(
    `Auto-detected ${workers} ingest workers (cores=${cores}, ramGB=${ramGB.toFixed(1)}, ` +
      `vramGB=${vramGB === null ? "n/a" : vramGB.toFixed(1)}). ` +
      "Set SEARCHIT_INGEST_WORKERS to override.",
  );
  return workers;
})();

let active = 0;
const waiters: (() => void)[] = [];

export function getWorkerStats(): { active: number; max: number } {
  return { active, max: MAX_WORKERS };
}

export async function withWorkerSlot<T>(fn: () => Promise<T>): Promise<T> {
  // `while`, not `if`: a woken waiter must re-check the gate before taking a
  // slot. With `if`, a burst of many callers parking at once (e.g. retry-all)
  // could have multiple waiters resumed in overlapping ticks and all fall
  // through to `active++` without re-validating, letting `active` climb past
  // MAX_WORKERS and over-saturate the inference service.
  while (active >= MAX_WORKERS) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiters.shift();
    next?.();
  }
}
