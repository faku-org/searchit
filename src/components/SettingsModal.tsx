import { useEffect, useState } from "react";
import {
  DownloadCloud,
  FolderOpen,
  Globe,
  Server,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "../lib/i18n";
import { getApiBaseUrl, setApiBaseUrl } from "../lib/settings";
import {
  getAppSettings,
  pickWatchFolder,
  setFaceRecognitionEnabled,
  setVisualSearchEnabled,
  setWatchDir,
  setWatchDirMode,
  type AppSettings,
  type WatchDirMode,
} from "../lib/tauri";
import { useToast } from "../lib/toast";
import { checkForUpdate, installPendingUpdate, type UpdateInfo } from "../lib/updater";
import {
  fieldLabel,
  iconButton,
  modalBackdrop,
  modalPanel,
  primaryButton,
  secondaryButton,
  springTransition,
} from "../lib/theme";

interface SettingsModalProps {
  onClose: () => void;
  /** Lets the parent keep its watch-dir banner and People/visual-search UI in sync. */
  onSettingsChanged: (settings: AppSettings) => void;
}

export function SettingsModal({ onClose, onSettingsChanged }: SettingsModalProps) {
  const { t, locale, setLocale } = useTranslation();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(getApiBaseUrl());
  const [isBusy, setIsBusy] = useState(false);
  const [isChangingFolder, setIsChangingFolder] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(
    null,
  );
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);

  function loadSettings() {
    getAppSettings()
      .then((loaded) => {
        setSettings(loaded);
        onSettingsChanged(loaded);
      })
      .catch(() => showToast(t("settings.loadError"), "error"));
  }

  // Loaded once on mount; subsequent refreshes are triggered explicitly after
  // each action below rather than by re-running this effect.
  useEffect(() => {
    loadSettings();
  }, []);

  async function handleModeChange(mode: WatchDirMode) {
    setIsBusy(true);
    try {
      await setWatchDirMode(mode);
      loadSettings();
    } catch {
      showToast(t("settings.loadError"), "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleChangeFolder() {
    const picked = await pickWatchFolder();
    if (!picked) return;
    setIsChangingFolder(true);
    try {
      await setWatchDir(picked);
      loadSettings();
    } catch {
      showToast(t("header.changeWatchDirError"), "error");
    } finally {
      setIsChangingFolder(false);
    }
  }

  async function handleFaceRecognitionChange(enabled: boolean) {
    setIsBusy(true);
    try {
      await setFaceRecognitionEnabled(enabled);
      loadSettings();
    } catch {
      showToast(t("settings.loadError"), "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVisualSearchChange(enabled: boolean) {
    setIsBusy(true);
    try {
      await setVisualSearchEnabled(enabled);
      loadSettings();
    } catch {
      showToast(t("settings.loadError"), "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCheckForUpdate() {
    setIsCheckingUpdate(true);
    try {
      const update = await checkForUpdate();
      setAvailableUpdate(update);
      if (!update) showToast(t("update.upToDate"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    setIsInstallingUpdate(true);
    try {
      await installPendingUpdate();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      setIsInstallingUpdate(false);
    }
  }

  return (
    <motion.div
      className={modalBackdrop}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={springTransition}
        className={`${modalPanel} max-w-md`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-mist-100">
            <SettingsIcon className="h-4 w-4 text-blue-400" />
            {t("settings.title")}
          </h2>
          <button type="button" onClick={onClose} className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-navy-800 pt-3">
          <span className={fieldLabel}>{t("settings.language")}</span>
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "es" : "en")}
            className={`${secondaryButton} self-start`}
          >
            <Globe className="h-3.5 w-3.5" />
            {locale === "en" ? "English" : "Español"}
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-navy-800 pt-3">
          <span className={fieldLabel}>{t("settings.server")}</span>
          <label className="flex items-center gap-2 rounded-full border border-navy-700 bg-navy-800 px-3.5 py-1.5">
            <Server className="h-3.5 w-3.5 shrink-0 text-mist-500" />
            <input
              type="text"
              value={apiBaseUrlInput}
              onChange={(event) => setApiBaseUrlInput(event.target.value)}
              onBlur={() => setApiBaseUrl(apiBaseUrlInput)}
              className="w-full bg-transparent text-sm text-mist-100 outline-none"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-navy-800 pt-3">
          <span className={fieldLabel}>{t("settings.watchDir")}</span>
          {settings && (
            <p className="flex items-center gap-2 truncate text-xs text-mist-400">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{settings.currentWatchDir}</span>
            </p>
          )}
          <div className="flex flex-col gap-1.5 text-sm text-mist-300">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="watchDirMode"
                checked={settings?.mode === "pictures"}
                disabled={isBusy}
                onChange={() => void handleModeChange("pictures")}
              />
              {t("settings.modePictures")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="watchDirMode"
                checked={settings?.mode === "last"}
                disabled={isBusy}
                onChange={() => void handleModeChange("last")}
              />
              {t("settings.modeLast")}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isChangingFolder}
              onClick={() => void handleChangeFolder()}
              className={secondaryButton}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("settings.changeFolder")}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleModeChange("pictures")}
              className={secondaryButton}
            >
              {t("settings.resetToPictures")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-navy-800 pt-3">
          <span className={fieldLabel}>{t("settings.capabilities")}</span>
          <label className="flex items-center gap-2 text-sm text-mist-300">
            <input
              type="checkbox"
              checked={settings?.faceRecognitionEnabled ?? false}
              disabled={isBusy}
              onChange={(event) =>
                void handleFaceRecognitionChange(event.target.checked)
              }
            />
            {t("settings.faceRecognition")}
          </label>
          <label className="flex items-center gap-2 text-sm text-mist-300">
            <input
              type="checkbox"
              checked={settings?.visualSearchEnabled ?? false}
              disabled={isBusy}
              onChange={(event) =>
                void handleVisualSearchChange(event.target.checked)
              }
            />
            {t("settings.visualSearch")}
          </label>
          <p className="text-xs text-mist-500">{t("settings.capabilitiesHint")}</p>
        </div>

        <div className="flex flex-col gap-2 border-t border-navy-800 pt-3">
          <span className={fieldLabel}>{t("settings.updates")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isCheckingUpdate}
              onClick={() => void handleCheckForUpdate()}
              className={secondaryButton}
            >
              <DownloadCloud className="h-3.5 w-3.5" />
              {isCheckingUpdate ? t("update.checking") : t("update.check")}
            </button>
            {availableUpdate && (
              <>
                <span className="text-xs text-mist-400">
                  {t("update.available", { version: availableUpdate.version })}
                </span>
                <button
                  type="button"
                  disabled={isInstallingUpdate}
                  onClick={() => void handleInstallUpdate()}
                  className={primaryButton}
                >
                  {isInstallingUpdate
                    ? t("update.installing")
                    : t("update.install")}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
