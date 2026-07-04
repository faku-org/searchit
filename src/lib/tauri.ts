import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function revealInFileManager(path: string): Promise<void> {
  return invoke("reveal_in_file_manager", { path });
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

export interface WatchSettings {
  mode: WatchDirMode;
  /** The folder actually in effect right now (may differ from a stale remembered folder that no longer exists). */
  currentWatchDir: string;
  /** The OS Pictures folder path, for a "Reset to Pictures" control. */
  picturesDir: string;
}

export function getWatchSettings(): Promise<WatchSettings> {
  return invoke("get_watch_settings");
}

/** Switches between "always use Pictures" and "remember last used folder", restarting the server sidecar accordingly. */
export function setWatchDirMode(mode: WatchDirMode): Promise<void> {
  return invoke("set_watch_dir_mode", { mode });
}
