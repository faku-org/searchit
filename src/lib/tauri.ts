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
 * frontend's already-resolved backend URL stays valid).
 */
export function setWatchDir(path: string): Promise<void> {
  return invoke("set_watch_dir", { newDir: path });
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
