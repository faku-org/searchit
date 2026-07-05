import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { StatsResponseBody } from "@searchit/shared";
import { getStats } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { springTransition } from "../lib/theme";

const POLL_INTERVAL_MS = 3000;

/** Live ingest progress bar, polling GET /stats. Auto-hides once nothing's in flight. */
export function IngestProgress() {
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
  if (inFlight === 0) return null;

  const percent =
    stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-navy-800 bg-navy-900 p-3 text-xs">
      <div className="flex items-center justify-between gap-2 text-mist-500">
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
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-800">
        <motion.div
          className="h-full rounded-full bg-blue-500"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={springTransition}
        />
      </div>
    </div>
  );
}
