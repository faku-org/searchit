/**
 * Bounds how many photos the ingest pipeline (preview generation + inference)
 * processes at once, and exposes that in-flight count for the Developer tab's
 * "Processing" / "Workers" stats. Previously the watcher fired off every
 * stable file as an unbounded concurrent promise -- fine for correctness, but
 * it meant there was no real "workers" concept to report and no backpressure
 * against the inference service under a big backfill.
 */
const MAX_WORKERS = Number(process.env.SEARCHIT_INGEST_WORKERS ?? 3);

let active = 0;
const waiters: (() => void)[] = [];

export function getWorkerStats(): { active: number; max: number } {
  return { active, max: MAX_WORKERS };
}

export async function withWorkerSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_WORKERS) {
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
