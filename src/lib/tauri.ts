import { invoke } from "@tauri-apps/api/core";

export function revealInFileManager(path: string): Promise<void> {
  return invoke("reveal_in_file_manager", { path });
}
