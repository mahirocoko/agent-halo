use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
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
const PET_MOVEMENT_WIDTH: f64 = 600.0;
const PET_MOVEMENT_HEIGHT: f64 = 420.0;
const PET_DEFAULT_INSET: f64 = 20.0;
const PET_VISIBLE_MARGIN: f64 = 12.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompletionPetSurfaceMode {
    Collapsed = 0,
    Expanded = 1,
    Movement = 2,
}

impl CompletionPetSurfaceMode {
    fn from_raw(value: u8) -> Self {
        match value {
            1 => Self::Expanded,
            2 => Self::Movement,
            _ => Self::Collapsed,
        }
    }

    fn dimensions(self) -> (f64, f64) {
        match self {
            Self::Collapsed => (PET_COLLAPSED_WIDTH, PET_COLLAPSED_HEIGHT),
            Self::Expanded => (PET_EXPANDED_WIDTH, PET_EXPANDED_HEIGHT),
            Self::Movement => (PET_MOVEMENT_WIDTH, PET_MOVEMENT_HEIGHT),
        }
    }

    fn anchor_offsets(self) -> (f64, f64) {
        match self {
            Self::Collapsed => (58.0, 44.0),
            Self::Expanded => (130.0, 114.0),
            Self::Movement => (PET_MOVEMENT_WIDTH / 2.0, PET_MOVEMENT_HEIGHT / 2.0),
        }
    }
}

const PET_NAMES: &[&str] = &["halo-bot", "haloform"];

const HALO_BOT_LOADOUTS: &[&str] = &[
    "3051", "1462", "5324", "c160", "2515", "4232", "d351", "6124", "9132", "f061",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetSummon {
    schema_version: u8,
    id: String,
    pet: String,
    #[serde(default)]
    loadout: Option<String>,
    pet_size: String,
    preview: bool,
    #[serde(default)]
    movement_break_enabled: bool,
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
        if self.pet == "halo-bot" {
            if !self
                .loadout
                .as_deref()
                .is_some_and(|loadout| HALO_BOT_LOADOUTS.contains(&loadout))
            {
                return Err("Halo Bot loadout is invalid".to_string());
            }
        } else if self.loadout.is_some() {
            return Err("Only Halo Bot accepts a loadout".to_string());
        }
        if !matches!(self.pet_size.as_str(), "small" | "medium" | "large") {
            return Err("Completion Pet size is invalid".to_string());
        }
        if self.preview {
            if self.title != "Pet preview"
                || !self.action_label.is_empty()
                || self.movement_break_enabled
            {
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
    movement_attempt_summon_id: Mutex<Option<String>>,
    position: Mutex<Option<PetPositionPreference>>,
    revision: AtomicU64,
    move_revision: AtomicU64,
    persist_user_move: AtomicBool,
    surface_mode: AtomicU8,
    surface_operation: Mutex<()>,
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
        self.persist_user_move.store(false, Ordering::SeqCst);
        self.move_revision.fetch_add(1, Ordering::SeqCst);
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

    fn clear_movement_attempt(&self) {
        if let Ok(mut attempt) = self.movement_attempt_summon_id.lock() {
            *attempt = None;
        }
    }

    fn set_movement_attempt(&self, summon_id: Option<String>) -> Result<(), String> {
        let mut attempt = self
            .movement_attempt_summon_id
            .lock()
            .map_err(|_| "Movement Break attempt state is unavailable".to_string())?;
        *attempt = summon_id;
        Ok(())
    }

    fn movement_attempt_matches(&self, summon_id: &str) -> bool {
        self.movement_attempt_summon_id
            .lock()
            .ok()
            .and_then(|attempt| attempt.clone())
            .as_deref()
            == Some(summon_id)
    }

    fn set_surface_mode(&self, mode: CompletionPetSurfaceMode) {
        self.surface_mode.store(mode as u8, Ordering::SeqCst);
    }

    fn surface_mode(&self) -> CompletionPetSurfaceMode {
        CompletionPetSurfaceMode::from_raw(self.surface_mode.load(Ordering::SeqCst))
    }

    pub(crate) fn lock_surface(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.surface_operation
            .lock()
            .map_err(|_| "Completion Pet surface state is unavailable".to_string())
    }

    pub(crate) fn movement_summon_matches(&self, summon_id: &str) -> bool {
        self.snapshot().summon.is_some_and(|summon| {
            !summon.preview && summon.movement_break_enabled && summon.id == summon_id
        })
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

    fn is_move_revision_current(&self, revision: u64) -> bool {
        self.move_revision.load(Ordering::SeqCst) == revision
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
        let (width, height) = CompletionPetSurfaceMode::Collapsed.dimensions();
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
        target_mode: CompletionPetSurfaceMode,
        current_mode: CompletionPetSurfaceMode,
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
            let (width, height) = target_mode.dimensions();
            let (current_center_x, current_center_y) = current_mode.anchor_offsets();
            let pet_x = frame.origin.x + current_center_x;
            let pet_y = frame.origin.y + current_center_y;
            let (target_center_x, target_center_y) = target_mode.anchor_offsets();
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
            let (collapsed_width, collapsed_height) =
                CompletionPetSurfaceMode::Collapsed.dimensions();
            let (expanded_width, _) = CompletionPetSurfaceMode::Expanded.dimensions();
            let current_mode = if frame.size.width > expanded_width + 1.0 {
                CompletionPetSurfaceMode::Movement
            } else if frame.size.width > collapsed_width + 1.0 {
                CompletionPetSurfaceMode::Expanded
            } else {
                CompletionPetSurfaceMode::Collapsed
            };
            let (center_x, center_y) = current_mode.anchor_offsets();
            let anchor_x = frame.origin.x + center_x - collapsed_width / 2.0;
            let anchor_y = frame.origin.y + center_y - collapsed_height / 2.0;
            let available_x = (visible.size.width - collapsed_width).max(1.0);
            let available_y = (visible.size.height - collapsed_height).max(1.0);
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
        _state: &CompletionPetWindowState,
        target_mode: CompletionPetSurfaceMode,
        current_mode: CompletionPetSurfaceMode,
    ) -> Result<(), String> {
        if resize_on_main_thread(window, target_mode, current_mode) {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel();
        let scheduled_window = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(resize_on_main_thread(
                    &scheduled_window,
                    target_mode,
                    current_mode,
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

    pub fn capture_position(
        window: &WebviewWindow,
        _state: &CompletionPetWindowState,
    ) -> Option<PetPositionPreference> {
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
        let (width, height) = CompletionPetSurfaceMode::Collapsed.dimensions();
        window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|error| format!("Could not size Completion Pet: {error}"))?;
        if let Some(monitor) = window.primary_monitor().ok().flatten() {
            let scale = monitor.scale_factor();
            let x = f64::from(monitor.position().x) / scale
                + f64::from(monitor.size().width) / scale
                - width
                - PET_DEFAULT_INSET;
            let y = f64::from(monitor.position().y) / scale
                + f64::from(monitor.size().height) / scale
                - height
                - PET_DEFAULT_INSET;
            window
                .set_position(Position::Logical(LogicalPosition::new(x, y)))
                .map_err(|error| format!("Could not position Completion Pet: {error}"))?;
        }
        Ok(())
    }

    pub fn resize(
        window: &WebviewWindow,
        _state: &CompletionPetWindowState,
        target_mode: CompletionPetSurfaceMode,
        _current_mode: CompletionPetSurfaceMode,
    ) -> Result<(), String> {
        let (width, height) = target_mode.dimensions();
        window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|error| format!("Could not resize Completion Pet: {error}"))?;
        Ok(())
    }

    pub fn capture_position(
        _window: &WebviewWindow,
        _state: &CompletionPetWindowState,
    ) -> Option<PetPositionPreference> {
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
    let _surface_guard = state.lock_surface()?;
    let revision = state.begin_operation();
    let pet_window = window
        .app_handle()
        .get_webview_window("pet")
        .ok_or_else(|| "Completion Pet window is unavailable".to_string())?;
    state.clear_pending_action();
    state.clear_movement_attempt();
    state.set_summon(Some(summon));
    if let Err(error) = platform::position_for_show(&pet_window, &state) {
        if state.is_current(revision) {
            state.set_summon(None);
            let _ = pet_window.hide();
        }
        return Err(error);
    }
    state.set_surface_mode(CompletionPetSurfaceMode::Collapsed);
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
    let _surface_guard = state.lock_surface()?;
    let target = if expanded {
        CompletionPetSurfaceMode::Expanded
    } else {
        CompletionPetSurfaceMode::Collapsed
    };
    let previous = state.surface_mode();
    let result = if target == CompletionPetSurfaceMode::Collapsed {
        platform::position_for_show(&window, &state)
    } else {
        platform::resize(&window, &state, target, previous)
    };
    if let Err(error) = result {
        return Err(error);
    }
    state.set_surface_mode(target);
    Ok(())
}

#[tauri::command]
pub fn set_completion_pet_movement(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
    active: bool,
    summon_id: String,
) -> Result<(), String> {
    validate_window(&window, "pet")?;
    let _surface_guard = state.lock_surface()?;
    if !state.movement_summon_matches(&summon_id) {
        return Err("Movement Break summon is no longer active".to_string());
    }
    let target = if active {
        CompletionPetSurfaceMode::Movement
    } else {
        CompletionPetSurfaceMode::Expanded
    };
    let previous = state.surface_mode();
    if let Err(error) = platform::resize(&window, &state, target, previous) {
        return Err(error);
    }
    state.set_surface_mode(target);
    state.set_movement_attempt(active.then_some(summon_id))?;
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
    let _surface_guard = state.lock_surface()?;
    state.begin_operation();
    let pet_window = window
        .app_handle()
        .get_webview_window("pet")
        .ok_or_else(|| "Completion Pet window is unavailable".to_string())?;
    state.set_summon(None);
    state.clear_pending_action();
    state.clear_movement_attempt();
    let _ = platform::position_for_show(&pet_window, &state);
    state.set_surface_mode(CompletionPetSurfaceMode::Collapsed);
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
    let _surface_guard = state.lock_surface()?;
    if action != "start-break" && action != "movement-complete" {
        return Err("Unsupported Completion Pet action".to_string());
    }
    let summon = state
        .snapshot()
        .summon
        .ok_or_else(|| "Completion Pet has no active summon".to_string())?;
    if summon.preview {
        return Err("Completion Pet preview cannot start a Pomodoro break".to_string());
    }
    if action == "movement-complete" {
        if !summon.movement_break_enabled {
            return Err("Movement Break is disabled for this completion".to_string());
        }
        if !state.movement_attempt_matches(&summon.id) {
            return Err("Movement Break attempt does not match this completion".to_string());
        }
    }
    state.begin_operation();
    state.set_surface_mode(CompletionPetSurfaceMode::Collapsed);
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
    state.clear_movement_attempt();
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

pub fn persist_pet_position(app: &AppHandle, move_revision: u64) -> Result<(), String> {
    let Some(window) = app.get_webview_window("pet") else {
        return Ok(());
    };
    let state = app.state::<CompletionPetWindowState>();
    let _surface_guard = state.lock_surface()?;
    if !state.is_move_revision_current(move_revision) {
        return Ok(());
    }
    let Some(position) = platform::capture_position(&window, &state) else {
        return Ok(());
    };
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
        let _ = persist_pet_position(&scheduled_app, revision);
    });
}

pub fn hide_pet_on_exit(app: &AppHandle) {
    let state = app.state::<CompletionPetWindowState>();
    let _surface_guard = state.lock_surface().ok();
    state.clear_movement_attempt();
    if let Some(window) = app.get_webview_window("pet") {
        let _ = window.set_focusable(false);
        let _ = window.hide();
    }
}

pub fn dismiss_pet(app: &AppHandle) {
    let state = app.state::<CompletionPetWindowState>();
    let _surface_guard = state.lock_surface().ok();
    state.begin_operation();
    state.set_summon(None);
    state.clear_pending_action();
    state.clear_movement_attempt();
    if let Some(window) = app.get_webview_window("pet") {
        state.set_surface_mode(CompletionPetSurfaceMode::Collapsed);
        let _ = platform::position_for_show(&window, &state);
        let _ = window.set_focusable(false);
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surface_modes_use_generic_roster_geometry() {
        assert_eq!(
            CompletionPetSurfaceMode::Collapsed.dimensions(),
            (116.0, 88.0)
        );
        assert_eq!(
            CompletionPetSurfaceMode::Expanded.dimensions(),
            (260.0, 230.0)
        );
        assert_eq!(
            CompletionPetSurfaceMode::Movement.dimensions(),
            (600.0, 420.0)
        );
        assert_eq!(
            CompletionPetSurfaceMode::Collapsed.anchor_offsets(),
            (58.0, 44.0)
        );
        assert_eq!(
            CompletionPetSurfaceMode::Expanded.anchor_offsets(),
            (130.0, 114.0)
        );
        assert_eq!(
            CompletionPetSurfaceMode::Movement.anchor_offsets(),
            (300.0, 210.0)
        );
    }

    #[test]
    fn summon_validation_accepts_only_supported_pets_and_loadouts() {
        let valid = CompletionPetSummon {
            schema_version: 1,
            id: "focus-1".to_string(),
            pet: "haloform".to_string(),
            loadout: None,
            pet_size: "large".to_string(),
            preview: false,
            movement_break_enabled: false,
            next_phase: "short-break".to_string(),
            title: "Focus complete".to_string(),
            action_label: "Start Short break".to_string(),
        };
        assert!(valid.clone().validate().is_ok());
        assert!(CompletionPetSummon {
            pet: "halo-bot".to_string(),
            loadout: Some("3051".to_string()),
            ..valid.clone()
        }
        .validate()
        .is_ok());
        assert!(CompletionPetSummon {
            pet: "halo-bot".to_string(),
            loadout: Some("unknown".to_string()),
            ..valid.clone()
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            loadout: Some("3051".to_string()),
            ..valid.clone()
        }
        .validate()
        .is_err());
        for retired_or_unknown_pet in ["scorpion", "ember-starling", "unknown"] {
            assert!(CompletionPetSummon {
                pet: retired_or_unknown_pet.to_string(),
                ..valid.clone()
            }
            .validate()
            .is_err());
        }
        assert!(CompletionPetSummon {
            action_label: "Start Long break".to_string(),
            ..valid.clone()
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            movement_break_enabled: true,
            ..valid.clone()
        }
        .validate()
        .is_ok());
        assert!(CompletionPetSummon {
            preview: true,
            movement_break_enabled: true,
            title: "Pet preview".to_string(),
            action_label: String::new(),
            ..valid
        }
        .validate()
        .is_err());
    }

    #[test]
    fn summon_deserialization_ignores_legacy_visual_fields() {
        let summon: CompletionPetSummon = serde_json::from_str(
            r#"{
                "schemaVersion": 1,
                "id": "focus-1",
                "pet": "haloform",
                "petSize": "large",
                "visual": "ember-starling",
                "preview": false,
                "nextPhase": "short-break",
                "title": "Focus complete",
                "actionLabel": "Start Short break"
            }"#,
        )
        .expect("legacy visual field should be ignored");
        assert!(summon.validate().is_ok());
    }

    #[test]
    fn a_new_surface_operation_cancels_pending_drag_persistence() {
        let state = CompletionPetWindowState::default();
        let drag_revision = state.begin_user_drag();
        state.begin_operation();
        assert!(!state.finish_user_move(drag_revision));
        assert!(state.schedule_user_move().is_none());
    }

    #[test]
    fn a_surface_operation_after_debounce_still_invalidates_drag_capture() {
        let state = CompletionPetWindowState::default();
        state.begin_user_drag();
        let scheduled_revision = state.schedule_user_move().expect("drag should schedule");
        assert!(state.finish_user_move(scheduled_revision));
        state.begin_operation();
        assert!(!state.is_move_revision_current(scheduled_revision));
    }

    #[test]
    fn movement_session_must_match_the_active_enabled_summon() {
        let state = CompletionPetWindowState::default();
        state.set_summon(Some(CompletionPetSummon {
            schema_version: 1,
            id: "focus-movement".to_string(),
            pet: "haloform".to_string(),
            loadout: None,
            pet_size: "large".to_string(),
            preview: false,
            movement_break_enabled: true,
            next_phase: "short-break".to_string(),
            title: "Focus complete".to_string(),
            action_label: "Start Short break".to_string(),
        }));
        assert!(state.movement_summon_matches("focus-movement"));
        assert!(!state.movement_summon_matches("another-focus"));
        state
            .set_movement_attempt(Some("focus-movement".to_string()))
            .unwrap();
        assert!(state.movement_attempt_matches("focus-movement"));
        assert!(!state.movement_attempt_matches("another-focus"));
        state.clear_movement_attempt();
        assert!(!state.movement_attempt_matches("focus-movement"));
        state.set_summon(None);
        assert!(!state.movement_summon_matches("focus-movement"));
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
