use std::{
    fs,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    LogicalSize, Manager, PhysicalPosition, Size,
};

const TRAY_SHOW: &str = "show";
const TRAY_HIDE: &str = "hide";
const TRAY_QUIT: &str = "quit";

fn letta_mod_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".letta").join("mods").join("agent-halo.js"))
}

#[tauri::command]
fn bridge_health() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 47_621));
    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

#[tauri::command]
fn install_agent_halo_mod() -> Result<String, String> {
    let path = letta_mod_path()?;
    let Some(parent) = path.parent() else {
        return Err("Failed to resolve Letta mods directory".to_string());
    };

    fs::create_dir_all(parent).map_err(|error| format!("Failed to create mods directory: {error}"))?;

    let mut file = fs::File::create(&path).map_err(|error| format!("Failed to open mod file: {error}"))?;
    file.write_all(include_bytes!("../../../../mods/agent-halo.js"))
        .map_err(|error| format!("Failed to write mod file: {error}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn agent_halo_mod_path() -> Result<String, String> {
    Ok(letta_mod_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn agent_halo_mod_status() -> Result<(String, bool), String> {
    let path = letta_mod_path()?;
    let installed = path.exists();
    Ok((path.to_string_lossy().to_string(), installed))
}

#[tauri::command]
fn set_panel_open(window: tauri::WebviewWindow, open: bool, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|error| format!("Failed to resize Agent Halo window: {error}"))?;
    position_main_window(&window).map_err(|error| format!("Failed to position Agent Halo window: {error}"))?;

    if open {
        let _ = window.set_focus();
    }

    Ok(())
}

fn position_main_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;
        let x = monitor_size.width.saturating_sub(window_size.width) / 2;
        window.set_position(PhysicalPosition::new(x as i32, 8))?;
    }

    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = position_main_window(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, TRAY_SHOW, "Show Agent Halo", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, TRAY_HIDE, "Hide Overlay", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;
    TrayIconBuilder::with_id("agent-halo")
        .tooltip("Agent Halo")
        .icon(tauri::include_image!("icons/icon.png"))
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW => show_main_window(app),
            TRAY_HIDE => hide_main_window(app),
            TRAY_QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            agent_halo_mod_path,
            agent_halo_mod_status,
            bridge_health,
            install_agent_halo_mod,
            set_panel_open
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                position_main_window(&window)?;
            }
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Agent Halo desktop");
}
