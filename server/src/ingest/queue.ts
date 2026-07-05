import { computeDefaultWorkerCount } from "./hardwareWorkers";

// Bounded worker-pool queue shared by fresh ingest (watcher.ts), manual
// reprocess, and backfill/reprocess-failed -- all of them ultimately call
// `runInferencePipeline`, which talks to the single inference sidecar, so
// without a cap a large batch drop (or "retry all failed") can fire dozens of
// concurrent requests at it. Everything funnels through one `enqueue()` here
// so the concurrency limit and the live stats used by the progress bar/dev
// view are always accurate no matter which caller queued the work.

const CONCURRENCY = (() => {
  if (process.env.INGEST_CONCURRENCY) {
    return Number(process.env.INGEST_CONCURRENCY);
  }

  const { workers, cores, ramGB, vramGB } = computeDefaultWorkerCount();
  console.log(
    `Auto-detected ${workers} ingest workers (cores=${cores}, ramGB=${ramGB.toFixed(1)}, ` +
      `vramGB=${vramGB === null ? "n/a" : vramGB.toFixed(1)}). ` +
      "Set INGEST_CONCURRENCY to override.",
  );
  return workers;
})();

interface QueueEntry {
  run: () => Promise<void>;
}

export interface IngestQueueStats {
  active: number;
  waiting: number;
  completedSinceStart: number;
  failedSinceStart: number;
}

const waitingQueue: QueueEntry[] = [];
let active = 0;
let completedSinceStart = 0;
let failedSinceStart = 0;

/** Runs `task` once a worker slot is free (bounded by INGEST_CONCURRENCY). */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waitingQueue.push({
      run: async () => {
        try {
          const result = await task();
          completedSinceStart++;
          resolve(result);
        } catch (error) {
          failedSinceStart++;
          reject(error);
        }
      },
    });
    pump();
  });
}

function pump(): void {
  while (active < CONCURRENCY && waitingQueue.length > 0) {
    const entry = waitingQueue.shift();
    if (!entry) break;
    active++;
    void entry.run().finally(() => {
      active--;
      pump();
    });
  }
}

export function getQueueStats(): IngestQueueStats {
  return {
    active,
    waiting: waitingQueue.length,
    completedSinceStart,
    failedSinceStart,
  };
}

export function getIngestConcurrency(): number {
  return CONCURRENCY;
}

const activeByKey = new Map<string, Promise<void>>();

/**
 * Runs `task` exclusively per `key`: a second call for a key already in
 * flight joins the same promise instead of running concurrently. Used to
 * stop two reprocess triggers for the same photo (fresh ingest, manual
 * reprocess, "retry all failed") from racing runInferencePipeline's
 * delete-then-insert and hitting image_embeddings_photo_id_unique. Doesn't
 * touch the bounded worker pool above, so it's safe to call from within an
 * already-running queued task.
 */
export function runExclusive(key: string, task: () => Promise<void>): Promise<void> {
  const existing = activeByKey.get(key);
  if (existing) return existing;

  const promise = task().finally(() => {
    if (activeByKey.get(key) === promise) activeByKey.delete(key);
  });
  activeByKey.set(key, promise);
  return promise;
}
