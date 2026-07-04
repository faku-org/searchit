use std::path::{Path, PathBuf};
use std::sync::Mutex;
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

/// The bundled server's resolved URL, set once during `setup()` (it binds to
/// a dynamically-chosen free port). Read by the `get_backend_url` command so
/// the frontend knows which port to talk to instead of assuming a fixed one.
struct BackendUrl(Mutex<Option<String>>);

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

/// Forwards a sidecar's stdout/stderr to this process's own, prefixed so
/// server and inference logs stay distinguishable in a single console.
fn pipe_sidecar_output(
    label: &'static str,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    print!("[{label}] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprint!("[{label}] {}", String::from_utf8_lossy(&line));
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
    pipe_sidecar_output("server", rx);
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

/// Restarts the server sidecar pointed at a new watch folder (e.g. after the
/// user picks one via a native folder dialog on the frontend). The server has
/// no API to change its watch directory at runtime, so this kills and
/// respawns it on the same port instead, which the frontend already knows.
#[tauri::command]
fn set_watch_dir(app: tauri::AppHandle, new_dir: String) -> Result<(), String> {
    let watch_dir = PathBuf::from(new_dir);
    std::fs::create_dir_all(&watch_dir).map_err(|e| e.to_string())?;

    if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let config = app.state::<ServerConfig>();
    let child = spawn_server(&app, &resource_dir, &config, &watch_dir).map_err(|e| e.to_string())?;
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);

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
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db_dir = app_data_dir.join("db");
            let watch_dir = app_data_dir.join("incoming");
            let preview_dir = app_data_dir.join("previews");
            let face_thumbnail_dir = app_data_dir.join("face-thumbnails");
            let model_cache_dir = app_data_dir.join("models");

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
            let (inference_rx, inference_child) = app
                .shell()
                .command(inference_entry)
                .env("INFERENCE_MOCK", "false")
                .env(
                    "MODEL_CACHE_DIR",
                    model_cache_dir.to_string_lossy().to_string(),
                )
                .env("PORT", inference_port.to_string())
                .spawn()
                .expect("failed to spawn bundled inference sidecar");
            pipe_sidecar_output("inference", inference_rx);
            app.state::<InferenceProcess>()
                .0
                .lock()
                .unwrap()
                .replace(inference_child);

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
            get_backend_url,
            set_watch_dir
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
