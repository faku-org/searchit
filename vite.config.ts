import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // Not Tauri's conventional 1420 -- Hyper-V/WinNAT can leave stale
    // administered port-exclusion ranges behind (`netsh interface ipv4 show
    // excludedportrange protocol=tcp`) that silently reserve chunks of the
    // 1024+ range including 1420, causing every bind attempt to fail with
    // EACCES/EADDRINUSE even though nothing is actually listening. 4420
    // sidesteps whatever range was stuck on this machine; re-verify with
    // the same netsh command (or a raw bind test) before picking a port if
    // this ever needs to move again.
    port: 4420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 4421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
