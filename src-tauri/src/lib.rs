use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Whether the watch folder defaults to the OS Pictures folder on every
/// launch, or remembers whatever folder was last picked via `set_watch_dir`.
/// Persisted to `settings.json` (see `load_app_settings`/`save_app_settings`)
/// so the choice survives app restarts, unlike the watch dir itself which the
/// server has no runtime API to change (hence the sidecar restart dance).
#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
enum WatchDirMode {
    Pictures,
    Last,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    watch_dir_mode: WatchDirMode,
    last_watch_dir: Option<String>,
    // Both default true (today's behavior) -- turning either off means the
    // corresponding inference endpoint is never called, so its model
    // (insightface/ArcFace, CLIP) never even gets downloaded. There's no
    // macOS-native replacement for either (Vision has no public face-
    // recognition embedding API, and its FeaturePrint has no text encoder
    // for the free-text photo search CLIP powers), so this on/off switch is
    // the actual lever for a leaner footprint, not a per-platform model swap.
    #[serde(default = "default_true")]
    face_recognition_enabled: bool,
    #[serde(default = "default_true")]
    visual_search_enabled: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            watch_dir_mode: WatchDirMode::Pictures,
            last_watch_dir: None,
            face_recognition_enabled: true,
            visual_search_enabled: true,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsResponse {
    mode: WatchDirMode,
    current_watch_dir: String,
    pictures_dir: String,
    face_recognition_enabled: bool,
    visual_search_enabled: bool,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load_app_settings(app: &tauri::AppHandle) -> AppSettings {
    settings_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn save_app_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let contents = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

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

/// The watch dir the server sidecar is actually running against right now --
/// tracked separately from `AppSettings` on disk because in "last" mode the
/// remembered folder can vanish (deleted/unmounted) and silently fall back to
/// Pictures, which `get_app_settings` needs to report accurately.
struct CurrentWatchDir(Mutex<Option<PathBuf>>);

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

/// Spawns the bundled server sidecar (see scripts/bundle-server.mjs) against
/// `watch_dir`, piping its output and returning the child handle. Shared by
/// `setup()` (first launch) and `set_watch_dir` (restart with a new folder).
fn spawn_server<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    resource_dir: &Path,
    config: &ServerConfig,
    watch_dir: &Path,
    face_recognition_enabled: bool,
    visual_search_enabled: bool,
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
        .env("FACE_RECOGNITION_ENABLED", face_recognition_enabled.to_string())
        .env("VISUAL_SEARCH_ENABLED", visual_search_enabled.to_string())
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

/// Kills and respawns the server sidecar against `watch_dir` (the server has
/// no API to change its watch directory at runtime), on the same port the
/// frontend already knows about, and records it as the current watch dir.
/// Shared by `set_watch_dir`, `set_watch_dir_mode`, and `restart_server`.
fn restart_server_with_watch_dir(
    app: &tauri::AppHandle,
    watch_dir: PathBuf,
) -> Result<(), String> {
    std::fs::create_dir_all(&watch_dir).map_err(|e| e.to_string())?;

    if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let config = app.state::<ServerConfig>();
    let settings = load_app_settings(app);
    let child = spawn_server(
        app,
        &resource_dir,
        &config,
        &watch_dir,
        settings.face_recognition_enabled,
        settings.visual_search_enabled,
    )
    .map_err(|e| e.to_string())?;
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);
    app.state::<CurrentWatchDir>()
        .0
        .lock()
        .unwrap()
        .replace(watch_dir);

    Ok(())
}

/// Lets the Developer tab recover from a crashed/hung server sidecar without
/// relaunching the whole app -- respawns against whatever folder it was
/// already watching.
#[tauri::command]
fn restart_server(app: tauri::AppHandle) -> Result<(), String> {
    restart_server_with_watch_dir(&app, current_watch_dir(&app)?)
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

/// Restarts the server sidecar pointed at a new watch folder (e.g. after the
/// user picks one via a native folder dialog on the frontend). Persists it as
/// `lastWatchDir` and switches the mode to "last" so it's what's used again
/// on the next launch, until the user explicitly switches back to Pictures.
#[tauri::command]
fn set_watch_dir(app: tauri::AppHandle, new_dir: String) -> Result<(), String> {
    let watch_dir = PathBuf::from(&new_dir);

    let mut settings = load_app_settings(&app);
    settings.watch_dir_mode = WatchDirMode::Last;
    settings.last_watch_dir = Some(new_dir);
    save_app_settings(&app, &settings)?;

    restart_server_with_watch_dir(&app, watch_dir)
}

/// Reports the current watch-dir mode, the folder actually in effect right
/// now, the OS Pictures folder path (so the Settings UI can offer "Reset to
/// Pictures" without a round trip through the native folder picker), and the
/// two optional-capability toggles (face recognition, visual/text search).
#[tauri::command]
fn get_app_settings(app: tauri::AppHandle) -> Result<AppSettingsResponse, String> {
    let settings = load_app_settings(&app);
    let pictures_dir = app.path().picture_dir().map_err(|e| e.to_string())?;
    let current_watch_dir = app
        .state::<CurrentWatchDir>()
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "watch dir not ready yet".to_string())?;

    Ok(AppSettingsResponse {
        mode: settings.watch_dir_mode,
        current_watch_dir: current_watch_dir.to_string_lossy().to_string(),
        pictures_dir: pictures_dir.to_string_lossy().to_string(),
        face_recognition_enabled: settings.face_recognition_enabled,
        visual_search_enabled: settings.visual_search_enabled,
    })
}

/// Switches between "always use Pictures" and "remember last used folder"
/// without going through the folder picker -- restarts the sidecar against
/// the Pictures folder immediately when switching to that mode, or against
/// whatever folder was last remembered (falling back to Pictures if it no
/// longer exists) when switching to "last".
#[tauri::command]
fn set_watch_dir_mode(app: tauri::AppHandle, mode: WatchDirMode) -> Result<(), String> {
    let mut settings = load_app_settings(&app);
    settings.watch_dir_mode = mode.clone();
    save_app_settings(&app, &settings)?;

    let pictures_dir = app.path().picture_dir().map_err(|e| e.to_string())?;
    let watch_dir = match mode {
        WatchDirMode::Pictures => pictures_dir,
        WatchDirMode::Last => settings
            .last_watch_dir
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| path.exists())
            .unwrap_or(pictures_dir),
    };

    restart_server_with_watch_dir(&app, watch_dir)
}

/// Reads the folder the server sidecar is already running against (tracked
/// separately from `AppSettings` -- see `CurrentWatchDir`'s doc comment) so
/// the two toggle commands below can restart the sidecar in place, without
/// duplicating `set_watch_dir`'s folder-resolution logic just to flip a flag.
fn current_watch_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.state::<CurrentWatchDir>()
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "watch dir not ready yet".to_string())
}

/// Toggles face recognition (identity matching) on or off. Off means the
/// server's ingest pipeline never calls `/detect-faces` at all, so
/// insightface's model is never downloaded or loaded on this machine.
/// Turning it back on later requires running "Reprocess" / the backfill
/// button to populate embeddings for photos ingested while it was off.
#[tauri::command]
fn set_face_recognition_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load_app_settings(&app);
    settings.face_recognition_enabled = enabled;
    save_app_settings(&app, &settings)?;

    restart_server_with_watch_dir(&app, current_watch_dir(&app)?)
}

/// Toggles visual + free-text photo search (CLIP embeddings) on or off, same
/// mechanics as `set_face_recognition_enabled` above but for `/embed-image`.
#[tauri::command]
fn set_visual_search_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load_app_settings(&app);
    settings.visual_search_enabled = enabled;
    save_app_settings(&app, &settings)?;

    restart_server_with_watch_dir(&app, current_watch_dir(&app)?)
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
        .manage(CurrentWatchDir(Mutex::new(None)))
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

            // Defaults to the OS Pictures folder (falling back to
            // app_data_dir/incoming if it can't be resolved, e.g. on an
            // unusual OS config) since that's where a photographer's camera
            // import tool normally drops files; "remember last used folder"
            // (set via the Settings UI or the folder picker) is opt-in and
            // persisted in settings.json, not the default.
            let watch_settings = load_app_settings(&app.handle());
            let pictures_dir = app
                .path()
                .picture_dir()
                .unwrap_or_else(|_| app_data_dir.join("incoming"));
            let watch_dir = match watch_settings.watch_dir_mode {
                WatchDirMode::Pictures => pictures_dir,
                WatchDirMode::Last => watch_settings
                    .last_watch_dir
                    .as_ref()
                    .map(PathBuf::from)
                    .filter(|path| path.exists())
                    .unwrap_or(pictures_dir),
            };

            for dir in [
                &db_dir,
                &watch_dir,
                &preview_dir,
                &face_thumbnail_dir,
                &model_cache_dir,
            ] {
                std::fs::create_dir_all(dir)?;
            }

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
            let server_child = spawn_server(
                &app.handle(),
                &resource_dir,
                &server_config,
                &watch_dir,
                watch_settings.face_recognition_enabled,
                watch_settings.visual_search_enabled,
            )
            .expect("failed to spawn bundled server sidecar");
            app.state::<ServerProcess>()
                .0
                .lock()
                .unwrap()
                .replace(server_child);
            app.state::<CurrentWatchDir>()
                .0
                .lock()
                .unwrap()
                .replace(watch_dir);
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
            get_app_settings,
            set_watch_dir_mode,
            set_face_recognition_enabled,
            set_visual_search_enabled,
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
