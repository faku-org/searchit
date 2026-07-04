import { useEffect, useState } from "react";
import type { StatsResponseBody } from "@searchit/shared";
import { getStats } from "../lib/api";
import { useTranslation } from "../lib/i18n";

const POLL_INTERVAL_MS = 3000;

interface IngestProgressProps {
  /** The Dev view always shows this, even when idle; elsewhere it auto-hides once nothing's in flight. */
  alwaysVisible?: boolean;
}

/** Live ingest progress bar, polling GET /stats. Shared by the Home screen and the Developer view. */
export function IngestProgress({ alwaysVisible = false }: IngestProgressProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<StatsResponseBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      getStats()
        .then((loaded) => {
          if (!cancelled) setStats(loaded);
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!stats) return null;

  const inFlight = stats.pending + stats.active + stats.queued;
  if (inFlight === 0 && !alwaysVisible) return null;

  const percent =
    stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
        <span>
          {t("progress.label", {
            processed: stats.processed,
            total: stats.total,
          })}
        </span>
        <span className="flex shrink-0 gap-2">
          {stats.pending > 0 && (
            <span>{t("progress.pending", { count: stats.pending })}</span>
          )}
          {stats.active > 0 && (
            <span>{t("progress.active", { count: stats.active })}</span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-neutral-900 transition-[width] dark:bg-neutral-100"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
