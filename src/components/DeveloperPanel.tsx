import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  HardDrive,
  ImageOff,
  type LucideIcon,
  RotateCw,
} from "lucide-react";
import { motion } from "motion/react";
import type { DeveloperStatsResponseBody, FailedPhotoSummary } from "@searchit/shared";
import { getDeveloperStats, getFailedPhotos, retryFailedPhoto } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import {
  secondaryButton,
  springTransition,
  staggerContainer,
  staggerItem,
} from "../lib/theme";

const POLL_INTERVAL_MS = 5000;

export function DeveloperPanel() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DeveloperStatsResponseBody | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<FailedPhotoSummary[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(options?: { silent?: boolean }) {
    Promise.all([getDeveloperStats(), getFailedPhotos()])
      .then(([nextStats, nextFailed]) => {
        setStats(nextStats);
        setFailedPhotos(nextFailed);
        if (!options?.silent) setError(null);
      })
      .catch((err: unknown) => {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  }

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleRetry(photoId: string) {
    setRetryingId(photoId);
    try {
      await retryFailedPhoto(photoId);
      refresh({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  }

  const total = stats ? stats.currentlyIndexed + stats.queue + stats.processing : 0;
  const progressPercent =
    stats && total > 0 ? Math.round((stats.currentlyIndexed / total) * 100) : 100;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto mb-6 max-w-xl">
        <div className="h-2 w-full overflow-hidden rounded-full bg-navy-800">
          <motion.div
            className="h-full rounded-full bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={springTransition}
          />
        </div>
        <p className="mt-2 text-center text-xs font-medium text-mist-500">
          {t("developer.currentIndexing")}
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <StatsCard
            title={t("developer.stats")}
            icon={Activity}
            rows={[
              [t("developer.currentlyIndexed"), stats?.currentlyIndexed],
              [t("developer.queue"), stats?.queue],
              [t("developer.processing"), stats?.processing],
              [t("developer.indexedLastTenMinutes"), stats?.indexedLastTenMinutes],
              [t("developer.workers"), stats?.workers],
            ]}
          />
          <StatsCard
            title={t("developer.status")}
            icon={HardDrive}
            rows={[
              [
                t("developer.inferenceStatus"),
                stats
                  ? stats.inferenceStatus === "ready"
                    ? t("developer.ready")
                    : t("developer.down")
                  : undefined,
              ],
              [t("developer.inferencePort"), stats?.inferencePort ?? undefined],
              [t("developer.serverStatus"), stats ? t("developer.nominal") : undefined],
              [t("developer.serverPort"), stats?.serverPort],
            ]}
          />
        </div>

        <div>
          <h3 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-mist-100">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            {t("developer.failedPhotos")}
          </h3>
          {failedPhotos.length === 0 ? (
            <p className="text-sm text-mist-500">{t("developer.noFailedPhotos")}</p>
          ) : (
            <motion.ul
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-2"
            >
              {failedPhotos.map((photo) => (
                <motion.li
                  key={photo.id}
                  variants={staggerItem}
                  className="flex items-center gap-3 rounded-2xl border border-navy-800 bg-navy-900 p-3"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-navy-800 text-mist-500">
                    <ImageOff className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-mist-100">
                      {photo.filename}
                    </p>
                    <p className="truncate text-xs text-rose-400">
                      {photo.errorMessage ?? "--"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={retryingId === photo.id}
                    onClick={() => void handleRetry(photo.id)}
                    className={`${secondaryButton} shrink-0`}
                  >
                    <RotateCw
                      className={`h-3.5 w-3.5 ${retryingId === photo.id ? "animate-spin" : ""}`}
                    />
                    {retryingId === photo.id ? t("developer.retrying") : t("developer.retry")}
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsCard({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: LucideIcon;
  rows: [string, string | number | undefined | false][];
}) {
  return (
    <div className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-serif text-base font-semibold text-mist-100">
        <Icon className="h-4 w-4 text-blue-400" />
        {title}
      </h3>
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between border-b border-navy-800 pb-2 last:border-0 last:pb-0"
          >
            <dt className="text-mist-500">{label}</dt>
            <dd className="font-semibold text-mist-100">{value || value === 0 ? value : "--"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
