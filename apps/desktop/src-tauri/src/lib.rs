use std::{
    fs,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    sync::mpsc,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    LogicalSize, Manager, Size,
};

#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize};

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
fn notch_metrics(window: tauri::WebviewWindow) -> (f64, f64) {
    if let Some(metrics) = notch_metrics_for_platform(&window) {
        return metrics;
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    if window
        .run_on_main_thread(move || {
            let _ = sender.send(notch_metrics_for_platform(&scheduled_window));
        })
        .is_ok()
    {
        if let Ok(Some(metrics)) = receiver.recv_timeout(Duration::from_millis(250)) {
            return metrics;
        }
    }

    (184.0, 36.0)
}

#[cfg(target_os = "macos")]
fn notch_metrics_for_platform(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let mtm = MainThreadMarker::new()?;
    let ns_window_ptr = window.ns_window().ok()?;

    // SAFETY: Tauri owns this NSWindow and we only query AppKit on the main thread.
    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        let screen = ns_window.screen().or_else(|| NSScreen::mainScreen(mtm))?;
        let screen_frame = screen.frame();
        let visible_frame = screen.visibleFrame();
        let safe_insets = screen.safeAreaInsets();
        let left_area = screen.auxiliaryTopLeftArea();
        let right_area = screen.auxiliaryTopRightArea();
        let derived_camera_width = screen_frame.size.width - left_area.size.width - right_area.size.width + 4.0;
        let camera_width = if safe_insets.top > 0.0 {
            derived_camera_width.clamp(160.0, 260.0)
        } else {
            184.0
        };
        let menu_bar_height = (screen_frame.origin.y + screen_frame.size.height) - (visible_frame.origin.y + visible_frame.size.height);
        let closed_height = if safe_insets.top > 0.0 {
            safe_insets.top.clamp(28.0, 44.0)
        } else {
            menu_bar_height.clamp(28.0, 40.0)
        };

        Some((camera_width, closed_height))
    }
}

#[cfg(not(target_os = "macos"))]
fn notch_metrics_for_platform(_window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    Some((184.0, 36.0))
}

#[tauri::command]
fn set_panel_open(window: tauri::WebviewWindow, open: bool, width: f64, height: f64) -> Result<(), String> {
    set_main_window_frame(&window, width, height)
        .map_err(|error| format!("Failed to resize/recenter Agent Halo window: {error}"))?;

    if open {
        let _ = window.set_focus();
    }

    Ok(())
}

fn set_main_window_frame(window: &tauri::WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    set_main_window_frame_for_platform(window, width, height)
}

#[cfg(target_os = "macos")]
fn set_main_window_frame_for_platform(window: &tauri::WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    if position_main_window_with_appkit(window, Some((width, height))) {
        return Ok(());
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    window.run_on_main_thread(move || {
        let _ = sender.send(position_main_window_with_appkit(&scheduled_window, Some((width, height))));
    })?;

    if receiver.recv_timeout(Duration::from_millis(250)).unwrap_or(false) {
        return Ok(());
    }

    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))?;
    position_main_window_for_logical_width(window, width)
}

#[cfg(not(target_os = "macos"))]
fn set_main_window_frame_for_platform(window: &tauri::WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))?;
    position_main_window_for_logical_width(window, width)
}

fn position_main_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let width = f64::from(window.outer_size()?.width);
    position_main_window_for_physical_width(window, width)
}

fn position_main_window_for_logical_width(window: &tauri::WebviewWindow, width: f64) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    position_main_window_for_physical_width(window, width * scale)
}

fn position_main_window_for_physical_width(window: &tauri::WebviewWindow, width: f64) -> tauri::Result<()> {
    position_main_window_for_platform(window, width)
}

#[cfg(target_os = "macos")]
fn position_main_window_for_platform(window: &tauri::WebviewWindow, _width: f64) -> tauri::Result<()> {
    if position_main_window_with_appkit(window, None) {
        return Ok(());
    }

    let scheduled_window = window.clone();
    window.run_on_main_thread(move || {
        let _ = position_main_window_with_appkit(&scheduled_window, None);
    })?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn position_main_window_for_platform(window: &tauri::WebviewWindow, width: f64) -> tauri::Result<()> {
    let monitor = match window.primary_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.current_monitor()?,
    };

    if let Some(monitor) = monitor {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let centered_offset = ((f64::from(monitor_size.width) - width).max(0.0) / 2.0).round() as i32;
        let x = monitor_position.x + centered_offset;
        window.set_position(tauri::PhysicalPosition::new(x, monitor_position.y))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn position_main_window_with_appkit(window: &tauri::WebviewWindow, target_size: Option<(f64, f64)>) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };

    let Ok(ns_window_ptr) = window.ns_window() else {
        return false;
    };

    // SAFETY: Tauri gives us the backing NSWindow pointer for this WebviewWindow.
    // We only touch AppKit from the main thread (guarded above), matching AppKit's thread rules.
    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        let Some(screen) = ns_window.screen().or_else(|| NSScreen::mainScreen(mtm)) else {
            return false;
        };

        let frame = ns_window.frame();
        let (width, height) = target_size.unwrap_or((frame.size.width, frame.size.height));
        let screen_frame = screen.frame();
        let x = screen_frame.origin.x + (screen_frame.size.width / 2.0) - (width / 2.0);
        let y = screen_frame.origin.y + screen_frame.size.height - height;

        ns_window.setLevel(NSStatusWindowLevel);
        ns_window.setCollectionBehavior(
            ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary,
        );

        if target_size.is_some() {
            ns_window.setFrame_display(NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)), true);
        } else {
            ns_window.setFrameOrigin(NSPoint::new(x, y));
        }
    }

    true
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
            notch_metrics,
            set_panel_open
        ])
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(window) = app.get_webview_window("main") {
                position_main_window(&window)?;
            }
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Agent Halo desktop");
}
