import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

// The Update handle carries a download/install method that can't live in
// React state, so it's stashed here between checkForUpdate() and
// installPendingUpdate() while only the plain info goes into component state.
let pendingUpdate: Update | null = null;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  pendingUpdate = update;
  if (!update) return null;
  return { version: update.version, body: update.body ?? null };
}

export async function installPendingUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  await pendingUpdate.downloadAndInstall();
  await relaunch();
}
