use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

const PET_POSITION_FILE: &str = "pet-window-state.json";
const PET_COLLAPSED_WIDTH: f64 = 116.0;
const PET_COLLAPSED_HEIGHT: f64 = 88.0;
const PET_EXPANDED_WIDTH: f64 = 260.0;
const PET_EXPANDED_HEIGHT: f64 = 230.0;
const PET_DEFAULT_INSET: f64 = 20.0;
const PET_VISIBLE_MARGIN: f64 = 12.0;

const PET_NAMES: &[&str] = &[
    "pot",
    "crawler",
    "bat",
    "jelly",
    "cat",
    "crt",
    "cactus",
    "nautilus",
    "turtle",
    "lantern",
    "kettle",
    "dragonfly",
    "giraffe",
    "scorpion",
    "squid",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetSummon {
    schema_version: u8,
    id: String,
    pet: String,
    pet_size: String,
    preview: bool,
    next_phase: String,
    title: String,
    action_label: String,
}

impl CompletionPetSummon {
    fn validate(self) -> Result<Self, String> {
        if self.schema_version != 1 {
            return Err("Unsupported Completion Pet summon schema".to_string());
        }
        if self.id.trim().is_empty() || self.id.len() > 256 {
            return Err("Completion Pet summon id is invalid".to_string());
        }
        if !PET_NAMES.contains(&self.pet.as_str()) {
            return Err("Completion Pet selection is invalid".to_string());
        }
        if !matches!(self.pet_size.as_str(), "small" | "medium" | "large") {
            return Err("Completion Pet size is invalid".to_string());
        }
        if self.preview {
            if self.title != "Pet preview" || !self.action_label.is_empty() {
                return Err("Completion Pet preview copy is invalid".to_string());
            }
            return Ok(self);
        }
        let expected_action = match self.next_phase.as_str() {
            "short-break" => "Start Short break",
            "long-break" => "Start Long break",
            _ => return Err("Completion Pet requires a prepared break phase".to_string()),
        };
        if self.title != "Focus complete" || self.action_label != expected_action {
            return Err("Completion Pet copy does not match the prepared break".to_string());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetSnapshot {
    summon: Option<CompletionPetSummon>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetActionRequest {
    action: String,
    summon_id: String,
    next_phase: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PetPositionPreference {
    schema_version: u8,
    display_id: String,
    display_fingerprint: String,
    x_ratio: f64,
    y_ratio: f64,
}

#[derive(Default)]
pub struct CompletionPetWindowState {
    summon: Mutex<Option<CompletionPetSummon>>,
    pending_action: Mutex<Option<CompletionPetActionRequest>>,
    position: Mutex<Option<PetPositionPreference>>,
    revision: AtomicU64,
    move_revision: AtomicU64,
    persist_user_move: AtomicBool,
    expanded: AtomicBool,
}

impl CompletionPetWindowState {
    pub fn set_position(&self, position: Option<PetPositionPreference>) {
        if let Ok(mut current) = self.position.lock() {
            *current = position;
        }
    }

    fn position(&self) -> Option<PetPositionPreference> {
        self.position.lock().ok().and_then(|value| value.clone())
    }

    fn set_summon(&self, summon: Option<CompletionPetSummon>) {
        if let Ok(mut current) = self.summon.lock() {
            *current = summon;
        }
    }

    fn snapshot(&self) -> CompletionPetSnapshot {
        CompletionPetSnapshot {
            summon: self.summon.lock().ok().and_then(|value| value.clone()),
        }
    }

    fn begin_operation(&self) -> u64 {
        self.revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn is_current(&self, revision: u64) -> bool {
        self.revision.load(Ordering::SeqCst) == revision
    }

    fn clear_pending_action(&self) {
        if let Ok(mut pending) = self.pending_action.lock() {
            *pending = None;
        }
    }

    fn set_expanded(&self, expanded: bool) {
        self.expanded.store(expanded, Ordering::SeqCst);
    }

    fn swap_expanded(&self, expanded: bool) -> bool {
        self.expanded.swap(expanded, Ordering::SeqCst)
    }

    fn begin_user_drag(&self) -> u64 {
        self.persist_user_move.store(true, Ordering::SeqCst);
        self.move_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn schedule_user_move(&self) -> Option<u64> {
        self.persist_user_move
            .load(Ordering::SeqCst)
            .then(|| self.move_revision.fetch_add(1, Ordering::SeqCst) + 1)
    }

    fn finish_user_move(&self, revision: u64) -> bool {
        if self.move_revision.load(Ordering::SeqCst) != revision {
            return false;
        }
        self.persist_user_move.store(false, Ordering::SeqCst);
        true
    }
}

fn validate_window(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err(format!(
            "Completion Pet command requires the {expected} window"
        ))
    }
}

fn pet_position_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(PET_POSITION_FILE))
        .map_err(|error| format!("Could not resolve Completion Pet config directory: {error}"))
}

pub fn read_pet_position(app: &AppHandle) -> Option<PetPositionPreference> {
    let contents = fs::read_to_string(pet_position_path(app).ok()?).ok()?;
    let position: PetPositionPreference = serde_json::from_str(&contents).ok()?;
    valid_pet_position(&position).then_some(position)
}

fn valid_pet_position(position: &PetPositionPreference) -> bool {
    position.schema_version == 2
        && position.x_ratio.is_finite()
        && position.y_ratio.is_finite()
        && (0.0..=1.0).contains(&position.x_ratio)
        && (0.0..=1.0).contains(&position.y_ratio)
}

fn write_pet_position(app: &AppHandle, position: &PetPositionPreference) -> Result<(), String> {
    let path = pet_position_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Completion Pet position path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create Completion Pet config directory: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(position)
        .map_err(|error| format!("Could not encode Completion Pet position: {error}"))?;
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("Could not write Completion Pet position: {error}"))?;
    fs::rename(&temporary_path, &path)
        .map_err(|error| format!("Could not save Completion Pet position: {error}"))
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::mpsc;

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use tauri::Manager;

    use super::*;
    use crate::{
        appkit_display_id, appkit_display_option, resolve_appkit_screen, DisplayPreferenceState,
    };

    fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
        value.max(minimum).min(maximum.max(minimum))
    }

    fn pet_center_offsets(width: f64) -> (f64, f64) {
        if width > PET_COLLAPSED_WIDTH + 1.0 {
            (130.0, 114.0)
        } else {
            (58.0, 44.0)
        }
    }

    fn matching_screen(
        screens: &objc2_foundation::NSArray<NSScreen>,
        preference: Option<&PetPositionPreference>,
        selected_display: Option<&crate::DisplayPreference>,
    ) -> Option<objc2::rc::Retained<NSScreen>> {
        if let Some(preference) = preference {
            if let Some(screen) = screens.iter().find(|screen| {
                appkit_display_id(screen).as_deref() == Some(preference.display_id.as_str())
            }) {
                return Some(screen);
            }
            if let Some(screen) = screens.iter().find(|screen| {
                appkit_display_option(screen, None)
                    .is_some_and(|display| display.fingerprint == preference.display_fingerprint)
            }) {
                return Some(screen);
            }
        }
        resolve_appkit_screen(screens, selected_display).0
    }

    fn screen_for_frame(
        screens: &objc2_foundation::NSArray<NSScreen>,
        frame: NSRect,
    ) -> Option<objc2::rc::Retained<NSScreen>> {
        let center_x = frame.origin.x + frame.size.width / 2.0;
        let center_y = frame.origin.y + frame.size.height / 2.0;
        screens.iter().find(|screen| {
            let bounds = screen.frame();
            center_x >= bounds.origin.x
                && center_x <= bounds.origin.x + bounds.size.width
                && center_y >= bounds.origin.y
                && center_y <= bounds.origin.y + bounds.size.height
        })
    }

    fn configure_window(ns_window: &NSWindow) {
        ns_window.setLevel(NSStatusWindowLevel);
        ns_window.setCollectionBehavior(
            ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary,
        );
    }

    fn position_for_show_on_main_thread(
        window: &WebviewWindow,
        state: &CompletionPetWindowState,
    ) -> bool {
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        let Ok(pointer) = window.ns_window() else {
            return false;
        };
        let screens = NSScreen::screens(mtm);
        let saved = state.position();
        let selected = window.app_handle().state::<DisplayPreferenceState>().get();
        let Some(screen) = matching_screen(&screens, saved.as_ref(), selected.as_ref()) else {
            return false;
        };
        let visible = screen.visibleFrame();
        let width = PET_COLLAPSED_WIDTH;
        let height = PET_COLLAPSED_HEIGHT;
        let available_x = (visible.size.width - width).max(0.0);
        let available_y = (visible.size.height - height).max(0.0);
        let (x, y) = if let Some(saved) = saved.as_ref() {
            (
                visible.origin.x + available_x * saved.x_ratio,
                visible.origin.y + available_y * saved.y_ratio,
            )
        } else {
            (
                visible.origin.x + available_x - PET_DEFAULT_INSET,
                visible.origin.y + PET_DEFAULT_INSET,
            )
        };
        let x = clamp(
            x,
            visible.origin.x + PET_VISIBLE_MARGIN,
            visible.origin.x + visible.size.width - width - PET_VISIBLE_MARGIN,
        );
        let y = clamp(
            y,
            visible.origin.y + PET_VISIBLE_MARGIN,
            visible.origin.y + visible.size.height - height - PET_VISIBLE_MARGIN,
        );
        // SAFETY: Tauri owns the NSWindow and this function runs on AppKit's main thread.
        unsafe {
            let ns_window: &NSWindow = &*pointer.cast();
            configure_window(ns_window);
            ns_window.setFrame_display(
                NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
                true,
            );
        }
        true
    }

    fn resize_on_main_thread(
        window: &WebviewWindow,
        expanded: bool,
        current_expanded: bool,
    ) -> bool {
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        let Ok(pointer) = window.ns_window() else {
            return false;
        };
        let screens = NSScreen::screens(mtm);
        // SAFETY: Tauri owns the NSWindow and this function runs on AppKit's main thread.
        unsafe {
            let ns_window: &NSWindow = &*pointer.cast();
            let frame = ns_window.frame();
            let Some(screen) = screen_for_frame(&screens, frame) else {
                return false;
            };
            let visible = screen.visibleFrame();
            let (width, height) = if expanded {
                (PET_EXPANDED_WIDTH, PET_EXPANDED_HEIGHT)
            } else {
                (PET_COLLAPSED_WIDTH, PET_COLLAPSED_HEIGHT)
            };
            let (current_center_x, current_center_y) = if current_expanded {
                pet_center_offsets(PET_EXPANDED_WIDTH)
            } else {
                pet_center_offsets(PET_COLLAPSED_WIDTH)
            };
            let pet_x = frame.origin.x + current_center_x;
            let pet_y = frame.origin.y + current_center_y;
            let (target_center_x, target_center_y) = pet_center_offsets(width);
            let x = clamp(
                pet_x - target_center_x,
                visible.origin.x + PET_VISIBLE_MARGIN,
                visible.origin.x + visible.size.width - width - PET_VISIBLE_MARGIN,
            );
            let y = clamp(
                pet_y - target_center_y,
                visible.origin.y + PET_VISIBLE_MARGIN,
                visible.origin.y + visible.size.height - height - PET_VISIBLE_MARGIN,
            );
            configure_window(ns_window);
            ns_window.setFrame_display(
                NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
                true,
            );
        }
        true
    }

    fn capture_position_on_main_thread(window: &WebviewWindow) -> Option<PetPositionPreference> {
        let mtm = MainThreadMarker::new()?;
        let pointer = window.ns_window().ok()?;
        let screens = NSScreen::screens(mtm);
        // SAFETY: Tauri owns the NSWindow and this function runs on AppKit's main thread.
        unsafe {
            let ns_window: &NSWindow = &*pointer.cast();
            let frame = ns_window.frame();
            let screen = screen_for_frame(&screens, frame)?;
            let visible = screen.visibleFrame();
            let display = appkit_display_option(&screen, None)?;
            let (center_x, center_y) = pet_center_offsets(frame.size.width);
            let anchor_x = frame.origin.x + center_x - PET_COLLAPSED_WIDTH / 2.0;
            let anchor_y = frame.origin.y + center_y - PET_COLLAPSED_HEIGHT / 2.0;
            let available_x = (visible.size.width - PET_COLLAPSED_WIDTH).max(1.0);
            let available_y = (visible.size.height - PET_COLLAPSED_HEIGHT).max(1.0);
            Some(PetPositionPreference {
                schema_version: 2,
                display_id: display.id,
                display_fingerprint: display.fingerprint,
                x_ratio: ((anchor_x - visible.origin.x) / available_x).clamp(0.0, 1.0),
                y_ratio: ((anchor_y - visible.origin.y) / available_y).clamp(0.0, 1.0),
            })
        }
    }

    pub fn position_for_show(
        window: &WebviewWindow,
        state: &CompletionPetWindowState,
    ) -> Result<(), String> {
        if position_for_show_on_main_thread(window, state) {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel();
        let scheduled_window = window.clone();
        let app = window.app_handle().clone();
        window
            .run_on_main_thread(move || {
                let state = app.state::<CompletionPetWindowState>();
                let _ = sender.send(position_for_show_on_main_thread(&scheduled_window, &state));
            })
            .map_err(|error| format!("Could not schedule Completion Pet placement: {error}"))?;
        if receiver
            .recv_timeout(Duration::from_millis(500))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err("Could not position Completion Pet on a visible display".to_string())
        }
    }

    pub fn resize(
        window: &WebviewWindow,
        expanded: bool,
        current_expanded: bool,
    ) -> Result<(), String> {
        if resize_on_main_thread(window, expanded, current_expanded) {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel();
        let scheduled_window = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(resize_on_main_thread(
                    &scheduled_window,
                    expanded,
                    current_expanded,
                ));
            })
            .map_err(|error| format!("Could not schedule Completion Pet resize: {error}"))?;
        if receiver
            .recv_timeout(Duration::from_millis(500))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err("Could not resize Completion Pet".to_string())
        }
    }

    pub fn capture_position(window: &WebviewWindow) -> Option<PetPositionPreference> {
        if let Some(position) = capture_position_on_main_thread(window) {
            return Some(position);
        }
        let (sender, receiver) = mpsc::channel();
        let scheduled_window = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(capture_position_on_main_thread(&scheduled_window));
            })
            .ok()?;
        receiver.recv_timeout(Duration::from_millis(500)).ok()?
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::{LogicalPosition, LogicalSize, Position, Size};

    use super::*;

    pub fn position_for_show(
        window: &WebviewWindow,
        _state: &CompletionPetWindowState,
    ) -> Result<(), String> {
        window
            .set_size(Size::Logical(LogicalSize::new(
                PET_COLLAPSED_WIDTH,
                PET_COLLAPSED_HEIGHT,
            )))
            .map_err(|error| format!("Could not size Completion Pet: {error}"))?;
        if let Some(monitor) = window.primary_monitor().ok().flatten() {
            let scale = monitor.scale_factor();
            let x = f64::from(monitor.position().x) / scale
                + f64::from(monitor.size().width) / scale
                - PET_COLLAPSED_WIDTH
                - PET_DEFAULT_INSET;
            let y = f64::from(monitor.position().y) / scale
                + f64::from(monitor.size().height) / scale
                - PET_COLLAPSED_HEIGHT
                - PET_DEFAULT_INSET;
            window
                .set_position(Position::Logical(LogicalPosition::new(x, y)))
                .map_err(|error| format!("Could not position Completion Pet: {error}"))?;
        }
        Ok(())
    }

    pub fn resize(
        window: &WebviewWindow,
        expanded: bool,
        _current_expanded: bool,
    ) -> Result<(), String> {
        let (width, height) = if expanded {
            (PET_EXPANDED_WIDTH, PET_EXPANDED_HEIGHT)
        } else {
            (PET_COLLAPSED_WIDTH, PET_COLLAPSED_HEIGHT)
        };
        window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|error| format!("Could not resize Completion Pet: {error}"))?;
        Ok(())
    }

    pub fn capture_position(_window: &WebviewWindow) -> Option<PetPositionPreference> {
        None
    }
}

#[tauri::command]
pub fn show_completion_pet(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
    summon: CompletionPetSummon,
) -> Result<bool, String> {
    validate_window(&window, "main")?;
    let summon = summon.validate()?;
    let revision = state.begin_operation();
    let pet_window = window
        .app_handle()
        .get_webview_window("pet")
        .ok_or_else(|| "Completion Pet window is unavailable".to_string())?;
    state.clear_pending_action();
    state.set_summon(Some(summon));
    state.set_expanded(false);
    if let Err(error) = platform::position_for_show(&pet_window, &state) {
        if state.is_current(revision) {
            state.set_summon(None);
            let _ = pet_window.hide();
        }
        return Err(error);
    }
    if !state.is_current(revision) {
        return Ok(false);
    }
    pet_window
        .set_focusable(false)
        .map_err(|error| format!("Could not make Completion Pet non-activating: {error}"))?;
    if let Err(error) = pet_window.show() {
        if state.is_current(revision) {
            state.set_summon(None);
            let _ = pet_window.hide();
        }
        return Err(format!("Could not show Completion Pet: {error}"));
    }
    if !state.is_current(revision) {
        let _ = pet_window.hide();
        return Ok(false);
    }
    Ok(true)
}

#[tauri::command]
pub fn activate_completion_pet(window: WebviewWindow) -> Result<(), String> {
    validate_window(&window, "pet")?;
    window
        .set_focusable(true)
        .map_err(|error| format!("Could not activate Completion Pet controls: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus Completion Pet controls: {error}"))
}

#[tauri::command]
pub fn completion_pet_state(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
) -> Result<CompletionPetSnapshot, String> {
    validate_window(&window, "pet")?;
    Ok(state.snapshot())
}

#[tauri::command]
pub fn set_completion_pet_expanded(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
    expanded: bool,
) -> Result<(), String> {
    validate_window(&window, "pet")?;
    let previous = state.swap_expanded(expanded);
    let result = if expanded {
        platform::resize(&window, true, previous)
    } else {
        platform::position_for_show(&window, &state)
    };
    if let Err(error) = result {
        state.set_expanded(previous);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn drag_completion_pet(window: WebviewWindow) -> Result<(), String> {
    validate_window(&window, "pet")?;
    let app = window.app_handle().clone();
    let revision = app.state::<CompletionPetWindowState>().begin_user_drag();
    let timeout_app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        let _ = timeout_app
            .state::<CompletionPetWindowState>()
            .finish_user_move(revision);
    });
    window
        .start_dragging()
        .map_err(|error| format!("Could not drag Completion Pet: {error}"))
}

#[tauri::command]
pub fn hide_completion_pet(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
) -> Result<(), String> {
    if window.label() != "pet" && window.label() != "main" {
        return Err("Completion Pet hide requires an Agent Halo window".to_string());
    }
    state.begin_operation();
    let pet_window = window
        .app_handle()
        .get_webview_window("pet")
        .ok_or_else(|| "Completion Pet window is unavailable".to_string())?;
    state.set_summon(None);
    state.clear_pending_action();
    state.set_expanded(false);
    let _ = platform::position_for_show(&pet_window, &state);
    let _ = pet_window.set_focusable(false);
    pet_window
        .hide()
        .map_err(|error| format!("Could not hide Completion Pet: {error}"))
}

#[tauri::command]
pub fn submit_completion_pet_action(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
    action: String,
) -> Result<(), String> {
    validate_window(&window, "pet")?;
    if action != "start-break" {
        return Err("Unsupported Completion Pet action".to_string());
    }
    let summon = state
        .snapshot()
        .summon
        .ok_or_else(|| "Completion Pet has no active summon".to_string())?;
    if summon.preview {
        return Err("Completion Pet preview cannot start a Pomodoro break".to_string());
    }
    state.begin_operation();
    state.set_expanded(false);
    let mut pending = state
        .pending_action
        .lock()
        .map_err(|_| "Completion Pet action state is unavailable".to_string())?;
    if pending.is_some() {
        return Err("Completion Pet action is already pending".to_string());
    }
    *pending = Some(CompletionPetActionRequest {
        action,
        summon_id: summon.id,
        next_phase: summon.next_phase,
    });
    drop(pending);
    state.set_summon(None);
    let _ = window.set_focusable(false);
    window
        .hide()
        .map_err(|error| format!("Could not hide Completion Pet: {error}"))
}

#[tauri::command]
pub fn take_completion_pet_action(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
) -> Result<Option<CompletionPetActionRequest>, String> {
    validate_window(&window, "main")?;
    let mut pending = state
        .pending_action
        .lock()
        .map_err(|_| "Completion Pet action state is unavailable".to_string())?;
    Ok(pending.take())
}

pub fn persist_pet_position(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("pet") else {
        return Ok(());
    };
    let Some(position) = platform::capture_position(&window) else {
        return Ok(());
    };
    let state = app.state::<CompletionPetWindowState>();
    state.set_position(Some(position.clone()));
    write_pet_position(app, &position)
}

pub fn schedule_pet_position_persist(app: &AppHandle) {
    let state = app.state::<CompletionPetWindowState>();
    let Some(revision) = state.schedule_user_move() else {
        return;
    };
    let scheduled_app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(350));
        let state = scheduled_app.state::<CompletionPetWindowState>();
        if !state.finish_user_move(revision) {
            return;
        }
        let _ = persist_pet_position(&scheduled_app);
    });
}

pub fn hide_pet_on_exit(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("pet") {
        let _ = window.set_focusable(false);
        let _ = window.hide();
    }
}

pub fn dismiss_pet(app: &AppHandle) {
    let state = app.state::<CompletionPetWindowState>();
    state.begin_operation();
    state.set_summon(None);
    state.clear_pending_action();
    if let Some(window) = app.get_webview_window("pet") {
        state.set_expanded(false);
        let _ = platform::position_for_show(&window, &state);
        let _ = window.set_focusable(false);
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summon_validation_accepts_only_known_pet_and_break_copy() {
        let valid = CompletionPetSummon {
            schema_version: 1,
            id: "focus-1".to_string(),
            pet: "scorpion".to_string(),
            pet_size: "large".to_string(),
            preview: false,
            next_phase: "short-break".to_string(),
            title: "Focus complete".to_string(),
            action_label: "Start Short break".to_string(),
        };
        assert!(valid.clone().validate().is_ok());
        assert!(CompletionPetSummon {
            pet: "unknown".to_string(),
            ..valid.clone()
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            action_label: "Start Long break".to_string(),
            ..valid
        }
        .validate()
        .is_err());
    }

    #[test]
    fn stored_position_validation_rejects_invalid_ratios_and_schema() {
        let valid = PetPositionPreference {
            schema_version: 2,
            display_id: "display".to_string(),
            display_fingerprint: "fingerprint".to_string(),
            x_ratio: 0.75,
            y_ratio: 0.25,
        };
        assert!(valid_pet_position(&valid));
        let invalid = PetPositionPreference {
            x_ratio: 1.5,
            ..valid.clone()
        };
        assert!(!valid_pet_position(&invalid));
        assert!(!valid_pet_position(&PetPositionPreference {
            schema_version: 3,
            ..valid
        }));
    }

    #[test]
    fn position_persistence_is_armed_only_for_the_latest_user_drag_move() {
        let state = CompletionPetWindowState::default();
        assert!(state.schedule_user_move().is_none());
        let drag_revision = state.begin_user_drag();
        let moved_revision = state
            .schedule_user_move()
            .expect("user move should be armed");
        assert!(!state.finish_user_move(drag_revision));
        assert!(state.finish_user_move(moved_revision));
        assert!(state.schedule_user_move().is_none());
    }

    #[test]
    fn newer_pet_operation_invalidates_stale_show_rollback() {
        let state = CompletionPetWindowState::default();
        let stale = state.begin_operation();
        let current = state.begin_operation();
        assert!(!state.is_current(stale));
        assert!(state.is_current(current));
    }
}
