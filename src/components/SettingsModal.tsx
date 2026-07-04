import { useEffect, useState } from "react";
import { useTranslation } from "../lib/i18n";
import {
  getWatchSettings,
  pickWatchFolder,
  setWatchDir,
  setWatchDirMode,
  type WatchDirMode,
  type WatchSettings,
} from "../lib/tauri";

interface SettingsModalProps {
  onClose: () => void;
  /** Lets the parent keep its own compact watch-dir banner in sync. */
  onWatchDirChanged: (path: string) => void;
}

export function SettingsModal({
  onClose,
  onWatchDirChanged,
}: SettingsModalProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<WatchSettings | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadSettings() {
    getWatchSettings()
      .then((loaded) => {
        setSettings(loaded);
        onWatchDirChanged(loaded.currentWatchDir);
      })
      .catch(() => setError(t("settings.loadError")));
  }

  // Loaded once on mount; subsequent refreshes are triggered explicitly after
  // each action below rather than by re-running this effect.
  useEffect(() => {
    loadSettings();
  }, []);

  async function handleModeChange(mode: WatchDirMode) {
    setIsBusy(true);
    setError(null);
    try {
      await setWatchDirMode(mode);
      loadSettings();
    } catch {
      setError(t("settings.loadError"));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleChangeFolder() {
    const picked = await pickWatchFolder();
    if (!picked) return;
    setIsBusy(true);
    setError(null);
    try {
      await setWatchDir(picked);
      loadSettings();
    } catch {
      setError(t("header.changeWatchDirError"));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-lg bg-white p-4 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("settings.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t("common.close")}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {settings && (
          <>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {t("settings.currentFolder", { path: settings.currentWatchDir })}
            </p>

            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t("settings.watchDirMode")}
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="watchDirMode"
                  checked={settings.mode === "pictures"}
                  disabled={isBusy}
                  onChange={() => void handleModeChange("pictures")}
                />
                {t("settings.modePictures")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="watchDirMode"
                  checked={settings.mode === "last"}
                  disabled={isBusy}
                  onChange={() => void handleModeChange("last")}
                />
                {t("settings.modeLast")}
              </label>
            </fieldset>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleChangeFolder()}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
              >
                {t("settings.changeFolder")}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleModeChange("pictures")}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
              >
                {t("settings.resetToPictures")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
