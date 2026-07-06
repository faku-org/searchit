use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Fixed paths/settings the server sidecar is launched with, computed once in
/// `setup()` and reused by `set_watch_dir` to restart just the server with a
/// new watch directory (keeping the same port, since the frontend has
/// already resolved it via `get_backend_url`).
struct ServerConfig {
    db_dir: PathBuf,
    preview_dir: PathBuf,
    face_thumbnail_dir: PathBuf,
    inference_url: String,
    port: u16,
}

struct ServerProcess(Mutex<Option<CommandChild>>);
struct InferenceProcess(Mutex<Option<CommandChild>>);

/// Fixed paths/settings the inference sidecar is launched with, computed once
/// in `setup()` and reused by `restart_inference` (same port, so the
/// server's already-configured `INFERENCE_URL` stays valid across a restart).
struct InferenceConfig {
    entry: PathBuf,
    model_cache_dir: PathBuf,
    port: u16,
}

/// The watch folder the server sidecar is currently running against, kept in
/// sync by `set_watch_dir` so `restart_server` can respawn against the same
/// folder without the frontend having to pass it again.
struct CurrentWatchDir(Mutex<PathBuf>);

/// The bundled server's resolved URL, set once during `setup()` (it binds to
/// a dynamically-chosen free port). Read by the `get_backend_url` command so
/// the frontend knows which port to talk to instead of assuming a fixed one.
struct BackendUrl(Mutex<Option<String>>);

/// Last known state of a sidecar as observed from its `CommandEvent` stream --
/// there's no other way to tell "crashed" from "still starting" in a packaged
/// build, since a GUI app has no attached console to show stdout/stderr in.
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatus {
    running: bool,
    last_exit_code: Option<i32>,
    last_error: Option<String>,
}

/// Keyed by sidecar label ("server" / "inference"), read by the
/// `get_sidecar_status` command so the Developer tab can show something more
/// useful than "inference: down" when a sidecar actually crashed.
struct SidecarStatuses(Mutex<HashMap<&'static str, SidecarStatus>>);

/// Path to the combined sidecar log file under the app's log directory, set
/// once in `setup()`. Both sidecars' stdout/stderr are appended here since a
/// packaged app's own stdout/stderr goes nowhere the user can see.
struct LogFilePath(PathBuf);

/// Wall-clock start of the app, used to prefix log lines with a relative
/// timestamp without pulling in a datetime crate just for this.
static APP_START: OnceLock<Instant> = OnceLock::new();
static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
const MAX_LOG_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// Appends one line to the sidecar log file, truncating it first if it's
/// grown past `MAX_LOG_FILE_BYTES` (simple rotation -- this log is for "what
/// just happened", not a long-term audit trail).
fn append_log(log_path: &Path, line: &str) {
    let _guard = LOG_WRITE_LOCK.lock().unwrap();
    if std::fs::metadata(log_path).map(|m| m.len()).unwrap_or(0) > MAX_LOG_FILE_BYTES {
        let _ = std::fs::write(log_path, "");
    }
    let elapsed = APP_START
        .get()
        .map(|start| start.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(file, "[+{elapsed:.3}s] {line}");
    }
}

/// Asks the OS for an ephemeral port by binding to port 0, then releasing it
/// immediately. Small TOCTOU race in principle, but good enough for a
/// same-machine sidecar we're about to spawn ourselves.
fn find_free_port(fallback: u16) -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(fallback)
}

/// Polls a local TCP port until something accepts a connection (a good-enough
/// proxy for "the HTTP server behind it is up") or `timeout` elapses.
fn wait_for_port(port: u16, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Forwards a sidecar's stdout/stderr to this process's own (useful in `tauri
/// dev`) and to the persistent sidecar log file (useful in a packaged build,
/// where nothing shows a GUI app's own console output). Also tracks the
/// sidecar's running/exit-code/last-error state in `SidecarStatuses` so the
/// Developer tab can distinguish "crashed" from "still starting".
fn pipe_sidecar_output<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    label: &'static str,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
) {
    app.state::<SidecarStatuses>()
        .0
        .lock()
        .unwrap()
        .insert(label, SidecarStatus { running: true, last_exit_code: None, last_error: None });

    let log_path = app.state::<LogFilePath>().0.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    print!("[{label}] {text}");
                    append_log(&log_path, &format!("[{label}] {}", text.trim_end()));
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    eprint!("[{label}] {text}");
                    append_log(&log_path, &format!("[{label}] {}", text.trim_end()));
                }
                CommandEvent::Error(err) => {
                    append_log(&log_path, &format!("[{label}] ERROR: {err}"));
                    app.state::<SidecarStatuses>().0.lock().unwrap().insert(
                        label,
                        SidecarStatus { running: false, last_exit_code: None, last_error: Some(err) },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    append_log(
                        &log_path,
                        &format!(
                            "[{label}] process exited (code={:?}, signal={:?})",
                            payload.code, payload.signal
                        ),
                    );
                    let statuses_state = app.state::<SidecarStatuses>();
                    let mut statuses = statuses_state.0.lock().unwrap();
                    let status = statuses.entry(label).or_insert_with(SidecarStatus::default);
                    status.running = false;
                    status.last_exit_code = payload.code;
                }
                _ => {}
            }
        }
    });
}

/// Turns a permission failure on `dir` into an actionable message. macOS
/// gates Desktop/Documents/Downloads/removable-volume access via TCC (see
/// Info.plist's usage-description keys) and just returns `EPERM` with no
/// dialog once a request has already been denied -- surface something the
/// user can act on instead of a bare "Operation not permitted".
fn describe_watch_dir_error(dir: &Path, err: &std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        #[cfg(target_os = "macos")]
        {
            format!(
                "macOS blocked access to {}. Grant SearchIt access under System Settings \u{2192} Privacy & Security \u{2192} Files and Folders, then try again.",
                dir.display()
            )
        }
        #[cfg(not(target_os = "macos"))]
        {
            format!("Permission denied accessing {}: {err}", dir.display())
        }
    } else {
        format!("Could not access {}: {err}", dir.display())
    }
}

/// Creates `dir` if needed and forces a real directory-content read on it.
/// `create_dir_all` alone is a no-op when `dir` already exists (e.g. on a
/// second launch), which never actually touches the folder's contents and so
/// never gives macOS's TCC a chance to prompt -- the first *real* read would
/// otherwise happen inside the `bun-server` sidecar, a separate process the
/// OS may just silently deny without any dialog. Doing the read here, in the
/// main process that owns Info.plist's usage-description strings, is what
/// actually triggers (or re-surfaces) the consent prompt.
fn ensure_watch_dir_accessible(dir: &Path) -> Result<(), String> {
    reject_if_inside_photos_library(dir)?;
    std::fs::create_dir_all(dir).map_err(|e| describe_watch_dir_error(dir, &e))?;
    let mut entries = std::fs::read_dir(dir).map_err(|e| describe_watch_dir_error(dir, &e))?;
    if let Some(first) = entries.next() {
        first.map_err(|e| describe_watch_dir_error(dir, &e))?;
    }
    Ok(())
}

/// Rejects a watch folder that lives inside a macOS Photos Library bundle.
/// Even with Files-and-Folders access granted, reading a `.photoslibrary`
/// bundle's internals (e.g. `resources/derivatives/...`) is gated by a
/// separate, PhotosKit-only TCC service that no Info.plist string or folder
/// permission can satisfy for a plain filesystem-reading process like this
/// one -- it will always come back EPERM. Failing fast here beats silently
/// queuing thousands of un-retriable failed photos.
fn reject_if_inside_photos_library(dir: &Path) -> Result<(), String> {
    let inside_library = dir
        .ancestors()
        .any(|ancestor| ancestor.extension().is_some_and(|ext| ext == "photoslibrary"));
    if inside_library {
        return Err(
            "That folder is inside a macOS Photos Library, which SearchIt can't read directly \
-- macOS only allows that through the Photos app itself, not plain file access. Export or drag \
the photos you want out of Photos into a regular folder, then point SearchIt at that folder \
instead."
                .to_string(),
        );
    }
    Ok(())
}

/// Spawns the bundled server sidecar (see scripts/bundle-server.mjs) against
/// `watch_dir`, piping its output and returning the child handle. Shared by
/// `setup()` (first launch) and `set_watch_dir` (restart with a new folder).
fn spawn_server<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    resource_dir: &Path,
    config: &ServerConfig,
    watch_dir: &Path,
) -> Result<CommandChild, tauri_plugin_shell::Error> {
    let server_entry = resource_dir.join("server").join("src").join("index.ts");
    let (rx, child) = app
        .shell()
        .sidecar("bun-server")?
        .args([server_entry.to_string_lossy().to_string()])
        .env("SEARCHIT_DB_DIR", config.db_dir.to_string_lossy().to_string())
        .env("SEARCHIT_WATCH_DIR", watch_dir.to_string_lossy().to_string())
        .env(
            "SEARCHIT_PREVIEW_DIR",
            config.preview_dir.to_string_lossy().to_string(),
        )
        .env(
            "SEARCHIT_FACE_THUMBNAIL_DIR",
            config.face_thumbnail_dir.to_string_lossy().to_string(),
        )
        .env("INFERENCE_URL", config.inference_url.clone())
        .env("HOST", "127.0.0.1")
        .env("PORT", config.port.to_string())
        .spawn()?;
    pipe_sidecar_output(app.clone(), "server", rx);
    Ok(child)
}

/// Spawns the bundled inference sidecar (see scripts/bundle-inference.mjs).
/// Shared by `setup()` (first launch) and `restart_inference` (manual
/// restart from the Developer tab after a crash).
fn spawn_inference<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    config: &InferenceConfig,
) -> Result<CommandChild, tauri_plugin_shell::Error> {
    let (rx, child) = app
        .shell()
        .command(config.entry.clone())
        .env("INFERENCE_MOCK", "false")
        .env(
            "MODEL_CACHE_DIR",
            config.model_cache_dir.to_string_lossy().to_string(),
        )
        .env("PORT", config.port.to_string())
        .spawn()?;
    pipe_sidecar_output(app.clone(), "inference", rx);
    Ok(child)
}

#[tauri::command]
fn get_backend_url(state: tauri::State<BackendUrl>) -> Result<String, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "backend not ready yet".to_string())
}

/// Kills the current server sidecar (if any) and respawns it against
/// `watch_dir`, same port. Shared by `set_watch_dir` (new folder) and
/// `restart_server` (same folder, e.g. recovering from a crash).
fn restart_server_sidecar(app: &tauri::AppHandle, watch_dir: &Path) -> Result<(), String> {
    if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let config = app.state::<ServerConfig>();
    let child = spawn_server(app, &resource_dir, &config, watch_dir).map_err(|e| e.to_string())?;
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);

    Ok(())
}

/// Restarts the server sidecar pointed at a new watch folder (e.g. after the
/// user picks one via a native folder dialog on the frontend). The server has
/// no API to change its watch directory at runtime, so this kills and
/// respawns it on the same port instead, which the frontend already knows.
#[tauri::command]
fn set_watch_dir(app: tauri::AppHandle, new_dir: String) -> Result<(), String> {
    let watch_dir = PathBuf::from(new_dir);
    ensure_watch_dir_accessible(&watch_dir)?;
    restart_server_sidecar(&app, &watch_dir)?;
    *app.state::<CurrentWatchDir>().0.lock().unwrap() = watch_dir;
    Ok(())
}

/// Lets the Developer tab recover from a crashed/hung server sidecar without
/// relaunching the whole app -- respawns against whatever folder it was
/// already watching.
#[tauri::command]
fn restart_server(app: tauri::AppHandle) -> Result<(), String> {
    let watch_dir = app.state::<CurrentWatchDir>().0.lock().unwrap().clone();
    restart_server_sidecar(&app, &watch_dir)
}

/// Lets the Developer tab recover from a crashed inference sidecar (the
/// scenario this whole command exists for: a packaged build where inference
/// died and there's no console to see why, but the Developer tab's log
/// viewer at least explains it and this gets it running again).
#[tauri::command]
fn restart_inference(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(child) = app.state::<InferenceProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
    let config = app.state::<InferenceConfig>();
    let child = spawn_inference(&app, &config).map_err(|e| e.to_string())?;
    app.state::<InferenceProcess>().0.lock().unwrap().replace(child);
    Ok(())
}

/// Opens the OS file manager with `path` selected, so the photographer can
/// find the untouched original (RAW or otherwise) from a search result.
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .ok_or_else(|| "Could not determine parent directory".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Opens `path` directly (unlike `reveal_in_file_manager`, which selects a
/// file within its parent) -- used by the "import photos" popup shown after
/// creating an event, so the user lands inside the event's folder ready to
/// drop files in.
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatusesPayload {
    server: SidecarStatus,
    inference: SidecarStatus,
}

/// Lets the Developer tab show "inference crashed (exit code 1)" instead of
/// just "down", since `GET /developer/stats`'s health check can't tell a slow
/// sidecar from one that already died.
#[tauri::command]
fn get_sidecar_status(state: tauri::State<SidecarStatuses>) -> SidecarStatusesPayload {
    let statuses = state.0.lock().unwrap();
    SidecarStatusesPayload {
        server: statuses.get("server").cloned().unwrap_or_default(),
        inference: statuses.get("inference").cloned().unwrap_or_default(),
    }
}

/// Returns the last `lines` (default 200) of the combined sidecar log file,
/// oldest first, for an in-app log viewer -- there's no console attached to a
/// packaged GUI app to read this from otherwise.
#[tauri::command]
fn get_sidecar_logs(state: tauri::State<LogFilePath>, lines: Option<usize>) -> String {
    let take = lines.unwrap_or(200);
    let content = std::fs::read_to_string(&state.0).unwrap_or_default();
    let tail: Vec<&str> = content.lines().rev().take(take).collect();
    tail.into_iter().rev().collect::<Vec<_>>().join("\n")
}

#[tauri::command]
fn get_log_file_path(state: tauri::State<LogFilePath>) -> String {
    state.0.to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerProcess(Mutex::new(None)))
        .manage(InferenceProcess(Mutex::new(None)))
        .manage(BackendUrl(Mutex::new(None)))
        .manage(SidecarStatuses(Mutex::new(HashMap::from([
            ("server", SidecarStatus::default()),
            ("inference", SidecarStatus::default()),
        ]))))
        .setup(|app| {
            APP_START.set(Instant::now()).ok();

            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            app.manage(LogFilePath(log_dir.join("sidecars.log")));

            let app_data_dir = app.path().app_data_dir()?;
            let db_dir = app_data_dir.join("db");
            let preview_dir = app_data_dir.join("previews");
            let face_thumbnail_dir = app_data_dir.join("face-thumbnails");
            let model_cache_dir = app_data_dir.join("models");

            for dir in [&db_dir, &preview_dir, &face_thumbnail_dir, &model_cache_dir] {
                std::fs::create_dir_all(dir)?;
            }

            // Under Documents rather than the hidden app-data folder so a
            // photographer can actually find it in Explorer/Finder to drop
            // photos in manually, not just rely on the automatic pipeline.
            // On macOS this is TCC-gated (see Info.plist) and the very first
            // launch may hit that before the user has had a chance to grant
            // it -- fall back to the app's own (never-gated) data dir rather
            // than failing the whole app's startup over it; the user can
            // point the watcher back at Documents from Settings once access
            // is granted.
            let default_watch_dir = app.path().document_dir()?.join("SearchIt").join("incoming");
            let watch_dir = match ensure_watch_dir_accessible(&default_watch_dir) {
                Ok(()) => default_watch_dir,
                Err(err) => {
                    let fallback = app_data_dir.join("incoming");
                    std::fs::create_dir_all(&fallback)?;
                    append_log(
                        &log_dir.join("sidecars.log"),
                        &format!("[setup] {err}; using {} instead", fallback.display()),
                    );
                    fallback
                }
            };

            app.manage(CurrentWatchDir(Mutex::new(watch_dir.clone())));

            let resource_dir = app.path().resource_dir()?;
            let server_port = find_free_port(3001);
            let inference_port = find_free_port(8000);
            let inference_url = format!("http://127.0.0.1:{inference_port}");

            // The staged, self-contained copy of the server (see
            // scripts/bundle-server.mjs) is shipped as a Tauri resource
            // rather than compiled into the sidecar binary itself: sharp's
            // native addon and PGlite's bundled pgvector extension both
            // resolve real filesystem paths at runtime that don't survive
            // `bun build --compile`'s single-file embedding.
            let server_config = ServerConfig {
                db_dir,
                preview_dir,
                face_thumbnail_dir,
                inference_url,
                port: server_port,
            };
            let server_child = spawn_server(&app.handle(), &resource_dir, &server_config, &watch_dir)
                .expect("failed to spawn bundled server sidecar");
            app.state::<ServerProcess>()
                .0
                .lock()
                .unwrap()
                .replace(server_child);
            app.manage(server_config);

            // Not registered as a Tauri `externalBin` sidecar: PyInstaller's
            // onedir output is a whole folder (see
            // scripts/bundle-inference.mjs), not the single portable
            // executable that convention expects, so it's shipped as a
            // resource instead and spawned by its exact path.
            let inference_entry = resource_dir.join("inference").join(format!(
                "searchit-inference{}",
                std::env::consts::EXE_SUFFIX
            ));
            let inference_config = InferenceConfig {
                entry: inference_entry,
                model_cache_dir,
                port: inference_port,
            };
            let inference_child = spawn_inference(&app.handle(), &inference_config)
                .expect("failed to spawn bundled inference sidecar");
            app.state::<InferenceProcess>()
                .0
                .lock()
                .unwrap()
                .replace(inference_child);
            app.manage(inference_config);

            let backend_url = format!("http://127.0.0.1:{server_port}");
            app.state::<BackendUrl>()
                .0
                .lock()
                .unwrap()
                .replace(backend_url);

            // The main window starts hidden (see "visible": false in
            // tauri.conf.json) so the UI never flashes a "can't connect"
            // error while the sidecars are still starting up (inference in
            // particular may be downloading models on first run). Shown
            // either once both respond or after a timeout, whichever first --
            // the UI already handles a not-yet-ready backend gracefully via
            // its normal error/loading states.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let timeout = Duration::from_secs(30);
                wait_for_port(server_port, timeout);
                wait_for_port(inference_port, timeout);
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reveal_in_file_manager,
            open_folder,
            get_backend_url,
            set_watch_dir,
            get_sidecar_status,
            get_sidecar_logs,
            get_log_file_path,
            restart_server,
            restart_inference
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
                if let Some(child) = app_handle.state::<InferenceProcess>().0.lock().unwrap().take()
                {
                    let _ = child.kill();
                }
            }
        });
}
