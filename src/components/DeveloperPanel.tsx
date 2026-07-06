import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  FileText,
  FolderOpen,
  HardDrive,
  ImageOff,
  type LucideIcon,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import type { DeveloperStatsResponseBody, FailedPhotoSummary } from "@searchit/shared";
import {
  clearFailedPhotos,
  getDeveloperStats,
  getFailedPhotos,
  retryAllFailedPhotos,
  retryFailedPhoto,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import {
  getLogFilePath,
  getSidecarLogs,
  getSidecarStatus,
  restartInference,
  restartServer,
  revealInFileManager,
  type SidecarStatus,
  type SidecarStatuses,
} from "../lib/tauri";
import {
  secondaryButton,
  springTransition,
  staggerContainer,
  staggerItem,
} from "../lib/theme";
import { useToast } from "../lib/toast";

const POLL_INTERVAL_MS = 5000;
const LOG_LINES = 300;

export function DeveloperPanel() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [stats, setStats] = useState<DeveloperStatsResponseBody | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<FailedPhotoSummary[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [isClearingFailed, setIsClearingFailed] = useState(false);
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatuses | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [isRestartingServer, setIsRestartingServer] = useState(false);
  const [isRestartingInference, setIsRestartingInference] = useState(false);
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
    // Not running inside the Tauri shell (e.g. plain `bun dev`) rejects this --
    // leave sidecarStatus null so the diagnostics card just shows placeholders.
    getSidecarStatus()
      .then(setSidecarStatus)
      .catch(() => setSidecarStatus(null));
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

  async function handleRetryAll() {
    setIsRetryingAll(true);
    try {
      const result = await retryAllFailedPhotos();
      refresh({ silent: true });
      showToast(
        t("developer.retryAllResult", {
          succeeded: result.succeeded,
          attempted: result.attempted,
        }),
        result.succeeded === result.attempted ? "success" : "error",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRetryingAll(false);
    }
  }

  async function handleClearFailed() {
    const count = stats?.failedCount ?? failedPhotos.length;
    if (!window.confirm(t("developer.clearFailedConfirm", { count }))) {
      return;
    }
    setIsClearingFailed(true);
    try {
      const result = await clearFailedPhotos();
      refresh({ silent: true });
      showToast(t("developer.clearFailedResult", { deleted: result.deleted }), "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsClearingFailed(false);
    }
  }

  async function handleToggleLogs() {
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    setShowLogs(true);
    setLogsLoading(true);
    try {
      setLogs(await getSidecarLogs(LOG_LINES));
    } catch {
      setLogs("");
    } finally {
      setLogsLoading(false);
    }
  }

  async function handleOpenLogFile() {
    try {
      await revealInFileManager(await getLogFilePath());
    } catch {
      // Not running inside the Tauri shell -- nothing to reveal.
    }
  }

  async function handleRestartServer() {
    setIsRestartingServer(true);
    try {
      await restartServer();
      refresh({ silent: true });
      showToast(t("developer.serverRestarted"), "success");
    } catch (err) {
      showToast(
        t("developer.restartFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      );
    } finally {
      setIsRestartingServer(false);
    }
  }

  async function handleRestartInference() {
    setIsRestartingInference(true);
    try {
      await restartInference();
      refresh({ silent: true });
      showToast(t("developer.inferenceRestarted"), "success");
    } catch (err) {
      showToast(
        t("developer.restartFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
        "error",
      );
    } finally {
      setIsRestartingInference(false);
    }
  }

  function processStatusLabel(status: SidecarStatus | undefined): string {
    if (!status) return "--";
    if (status.running) return t("developer.processRunning");
    if (status.lastExitCode !== null && status.lastExitCode !== undefined) {
      return t("developer.processCrashed", { code: status.lastExitCode });
    }
    return t("developer.processStopped");
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
          <StatsCard
            title={t("developer.diagnostics")}
            icon={FileText}
            rows={[
              [t("developer.serverProcess"), processStatusLabel(sidecarStatus?.server)],
              [t("developer.inferenceProcess"), processStatusLabel(sidecarStatus?.inference)],
              [t("developer.lastError"), sidecarStatus?.inference.lastError ?? undefined],
            ]}
          />
          <div className="flex gap-2 rounded-2xl border border-navy-800 bg-navy-900 p-4">
            <button
              type="button"
              disabled={isRestartingServer}
              onClick={() => void handleRestartServer()}
              className={secondaryButton}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRestartingServer ? "animate-spin" : ""}`} />
              {isRestartingServer ? t("developer.restarting") : t("developer.restartServer")}
            </button>
            <button
              type="button"
              disabled={isRestartingInference}
              onClick={() => void handleRestartInference()}
              className={secondaryButton}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRestartingInference ? "animate-spin" : ""}`}
              />
              {isRestartingInference ? t("developer.restarting") : t("developer.restartInference")}
            </button>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-navy-800 bg-navy-900 p-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleToggleLogs()}
                className={secondaryButton}
              >
                <FileText className="h-3.5 w-3.5" />
                {showLogs ? t("developer.hideLogs") : t("developer.viewLogs")}
              </button>
              <button
                type="button"
                onClick={() => void handleOpenLogFile()}
                className={secondaryButton}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("developer.openLogFile")}
              </button>
            </div>
            {showLogs && (
              <pre className="max-h-64 overflow-auto rounded-xl bg-navy-950 p-3 text-xs text-mist-300">
                {logsLoading ? t("photoDetail.loading") : logs || t("developer.noLogs")}
              </pre>
            )}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-serif text-lg font-semibold text-mist-100">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              {t("developer.failedPhotos")}
            </h3>
            {failedPhotos.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isRetryingAll}
                  onClick={() => void handleRetryAll()}
                  className={secondaryButton}
                >
                  <RotateCw className={`h-3.5 w-3.5 ${isRetryingAll ? "animate-spin" : ""}`} />
                  {isRetryingAll ? t("developer.retryingAll") : t("developer.retryAll")}
                </button>
                <button
                  type="button"
                  disabled={isClearingFailed}
                  onClick={() => void handleClearFailed()}
                  className={secondaryButton}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isClearingFailed ? t("developer.clearingFailed") : t("developer.clearFailed")}
                </button>
              </div>
            )}
          </div>
          {failedPhotos.length === 0 ? (
            <p className="text-sm text-mist-500">{t("developer.noFailedPhotos")}</p>
          ) : (
            <motion.ul
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="flex max-h-[99vh] flex-col gap-2 overflow-y-auto"
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
