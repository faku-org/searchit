import { useEffect, useState } from "react";
import type {
  DiagnosticsResponseBody,
  FailedPhoto,
  StatsResponseBody,
} from "@searchit/shared";
import {
  getDiagnostics,
  getFailedPhotos,
  getStats,
  reprocessFailed,
  reprocessPhoto,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { IngestProgress } from "./IngestProgress";

const POLL_INTERVAL_MS = 5000;

interface DevViewProps {
  onSelectPhoto: (photoId: string) => void;
}

/** Developer diagnostics: config/paths, live queue stats, and failed photos with their reasons + retry. */
export function DevView({ onSelectPhoto }: DevViewProps) {
  const { t } = useTranslation();
  const [diagnostics, setDiagnostics] =
    useState<DiagnosticsResponseBody | null>(null);
  const [stats, setStats] = useState<StatsResponseBody | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<FailedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);

  function refreshAll(options?: { silent?: boolean }) {
    getDiagnostics()
      .then(setDiagnostics)
      .catch((err: unknown) => {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    getStats()
      .then(setStats)
      .catch(() => {});
    getFailedPhotos()
      .then(setFailedPhotos)
      .catch(() => {});
  }

  // Refreshed on open and then polled, same convention as the rest of the
  // app's tabs (see App.tsx's people-tab effect).
  useEffect(() => {
    refreshAll();
    const id = setInterval(
      () => refreshAll({ silent: true }),
      POLL_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  async function handleRetry(id: string) {
    setRetryingId(id);
    setError(null);
    try {
      await reprocessPhoto(id);
      refreshAll({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  }

  async function handleRetryAll() {
    setIsRetryingAll(true);
    setError(null);
    try {
      await reprocessFailed();
      refreshAll({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRetryingAll(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 text-sm">
      {error && <p className="text-red-600">{error}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t("dev.queueStats")}
        </h2>
        <IngestProgress alwaysVisible />
        {stats && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <StatRow label={t("dev.totalPhotos")} value={stats.total} />
            <StatRow label={t("dev.pendingPhotos")} value={stats.pending} />
            <StatRow
              label={t("dev.processedPhotos")}
              value={stats.processed}
            />
            <StatRow label={t("dev.failedPhotos")} value={stats.failed} />
            <StatRow label={t("dev.activeWorkers")} value={stats.active} />
            <StatRow label={t("dev.queuedWaiting")} value={stats.queued} />
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t("dev.config")}
        </h2>
        {diagnostics && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <ConfigRow
              label={t("dev.watchDir")}
              value={diagnostics.watchDir}
            />
            <ConfigRow
              label={t("dev.previewDir")}
              value={diagnostics.previewDir}
            />
            <ConfigRow
              label={t("dev.faceThumbnailDir")}
              value={diagnostics.faceThumbnailDir}
            />
            <ConfigRow
              label={t("dev.dbDir")}
              value={diagnostics.dbDir ?? t("dev.dbDirExternal")}
            />
            <ConfigRow
              label={t("dev.serverPort")}
              value={String(diagnostics.serverPort)}
            />
            <ConfigRow
              label={t("dev.inferenceUrl")}
              value={diagnostics.inferenceUrl}
            />
            <ConfigRow
              label={t("dev.inferenceStatus")}
              value={
                diagnostics.inferenceHealthy
                  ? t("dev.inferenceHealthy")
                  : t("dev.inferenceUnhealthy")
              }
            />
            <ConfigRow
              label={t("dev.ingestConcurrency")}
              value={String(diagnostics.ingestConcurrency)}
            />
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t("dev.failedList")}
          </h2>
          {failedPhotos.length > 0 && (
            <button
              type="button"
              disabled={isRetryingAll}
              onClick={() => void handleRetryAll()}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
            >
              {isRetryingAll ? t("dev.retrying") : t("dev.retryAll")}
            </button>
          )}
        </div>

        {failedPhotos.length === 0 ? (
          <p className="text-neutral-500 dark:text-neutral-400">
            {t("dev.noFailed")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {failedPhotos.map((photo) => (
              <li
                key={photo.id}
                className="flex items-center justify-between gap-3 p-2"
              >
                <button
                  type="button"
                  onClick={() => onSelectPhoto(photo.id)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <span className="truncate text-xs font-medium">
                    {photo.filename}
                  </span>
                  <span className="truncate text-xs text-red-600">
                    {photo.errorMessage}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={retryingId === photo.id || isRetryingAll}
                  onClick={() => void handleRetry(photo.id)}
                  className="shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
                >
                  {retryingId === photo.id
                    ? t("dev.retrying")
                    : t("dev.retry")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </>
  );
}
