import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function revealInFileManager(path: string): Promise<void> {
  return invoke("reveal_in_file_manager", { path });
}

/** Opens `path` itself (unlike revealInFileManager, which selects a file within its parent). */
export function openFolder(path: string): Promise<void> {
  return invoke("open_folder", { path });
}

/**
 * The bundled server sidecar binds to a free port chosen at launch (see
 * src-tauri/src/lib.rs), so the client can't assume the default
 * `http://localhost:3001`. Rejects when not running inside the Tauri shell
 * (e.g. `bun run dev` in a plain browser).
 */
export function getBackendUrl(): Promise<string> {
  return invoke("get_backend_url");
}

/** Opens a native folder picker. Resolves to `null` if the user cancels. */
export function pickWatchFolder(): Promise<string | null> {
  return open({ directory: true, multiple: false });
}

/**
 * The server has no API to change its watch directory at runtime, so this
 * restarts just the server sidecar pointed at `path` (same port, so the
 * frontend's already-resolved backend URL stays valid). Also persists `path`
 * as the remembered folder and switches the mode to "last" on the Rust side.
 */
export function setWatchDir(path: string): Promise<void> {
  return invoke("set_watch_dir", { newDir: path });
}

export type WatchDirMode = "pictures" | "last";

export interface AppSettings {
  mode: WatchDirMode;
  /** The folder actually in effect right now (may differ from a stale remembered folder that no longer exists). */
  currentWatchDir: string;
  /** The OS Pictures folder path, for a "Reset to Pictures" control. */
  picturesDir: string;
  /** Whether identity matching runs at all -- off skips insightface entirely, so its model is never downloaded. */
  faceRecognitionEnabled: boolean;
  /** Whether visual/text photo search runs at all -- off skips CLIP entirely, so its model is never downloaded. */
  visualSearchEnabled: boolean;
}

export function getAppSettings(): Promise<AppSettings> {
  return invoke("get_app_settings");
}

/** Switches between "always use Pictures" and "remember last used folder", restarting the server sidecar accordingly. */
export function setWatchDirMode(mode: WatchDirMode): Promise<void> {
  return invoke("set_watch_dir_mode", { mode });
}

/** Toggles face recognition (identity matching), restarting the server sidecar with the new flag. */
export function setFaceRecognitionEnabled(enabled: boolean): Promise<void> {
  return invoke("set_face_recognition_enabled", { enabled });
}

/** Toggles visual + free-text photo search (CLIP), restarting the server sidecar with the new flag. */
export function setVisualSearchEnabled(enabled: boolean): Promise<void> {
  return invoke("set_visual_search_enabled", { enabled });
}

export interface SidecarStatus {
  running: boolean;
  lastExitCode: number | null;
  lastError: string | null;
}

export interface SidecarStatuses {
  server: SidecarStatus;
  inference: SidecarStatus;
}

/**
 * A packaged build has no attached console, so this is the only way to tell
 * "sidecar crashed" from "sidecar still starting" -- see SidecarStatuses in
 * src-tauri/src/lib.rs. Rejects when not running inside the Tauri shell.
 */
export function getSidecarStatus(): Promise<SidecarStatuses> {
  return invoke("get_sidecar_status");
}

/** Last `lines` (default 200) of the combined server+inference log file. */
export function getSidecarLogs(lines?: number): Promise<string> {
  return invoke("get_sidecar_logs", { lines });
}

export function getLogFilePath(): Promise<string> {
  return invoke("get_log_file_path");
}

/** Kills and respawns the server sidecar against the folder it's already watching. */
export function restartServer(): Promise<void> {
  return invoke("restart_server");
}

/** Kills and respawns the inference sidecar, e.g. after it crashed. */
export function restartInference(): Promise<void> {
  return invoke("restart_inference");
}
