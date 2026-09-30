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
use serde_json::Value;
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
const PET_NUDGE_LIMIT: f64 = 80.0;

fn bounded_nudge(value: f64) -> Result<f64, String> {
    if value.is_finite() && value.abs() <= PET_NUDGE_LIMIT {
        Ok(value)
    } else {
        Err("Movement window nudge is out of range".to_string())
    }
}

fn clamp_window_origin(
    origin: f64,
    size: f64,
    delta: f64,
    visible_origin: f64,
    visible_size: f64,
    margin: f64,
) -> f64 {
    let minimum = visible_origin + margin;
    let maximum = (visible_origin + visible_size - size - margin).max(minimum);
    (origin + delta).clamp(minimum, maximum)
}

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

const HALO_BOT_PART_COUNTS: [u32; 4] = [16, 8, 7, 12];

fn valid_halo_bot_loadout(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    if normalized.len() != HALO_BOT_PART_COUNTS.len() {
        return false;
    }
    normalized
        .chars()
        .zip(HALO_BOT_PART_COUNTS)
        .all(|(character, count)| character.to_digit(36).is_some_and(|index| index < count))
}

const PET_SESSION_STATUSES: &[&str] =
    &["idle", "working", "attention", "inactive", "done", "error"];
const PET_ACTIVITY_KINDS: &[&str] = &[
    "session",
    "thinking",
    "planning",
    "tool",
    "shell",
    "editing",
    "delegating",
    "visual",
    "memory",
    "asking",
    "skill",
    "goal",
    "compact",
    "model",
    "attention",
    "done",
    "error",
    "bridge",
];
const PET_MOTIONS: &[&str] = &["idle", "working", "attention", "done", "error"];

fn default_pet_data_state() -> String {
    "idle".to_string()
}

fn missing_pet_next_phase() -> Value {
    Value::Bool(false)
}

fn normalize_pet_motion(value: &str, fallback: &str) -> String {
    PET_MOTIONS
        .contains(&value)
        .then(|| value.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

fn pet_data_state(session_status: &str, activity_kind: &str) -> &'static str {
    if session_status == "error" || activity_kind == "error" {
        "error"
    } else if session_status == "attention"
        || activity_kind == "attention"
        || activity_kind == "asking"
    {
        "attention"
    } else if session_status == "done" || activity_kind == "done" {
        "done"
    } else if session_status == "working" {
        "working"
    } else {
        "idle"
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetMotionMapping {
    idle: String,
    working: String,
    attention: String,
    done: String,
    error: String,
}

impl Default for CompletionPetMotionMapping {
    fn default() -> Self {
        Self {
            idle: "idle".to_string(),
            working: "working".to_string(),
            attention: "attention".to_string(),
            done: "done".to_string(),
            error: "error".to_string(),
        }
    }
}

impl<'de> Deserialize<'de> for CompletionPetMotionMapping {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let candidate = value.get("mapping").unwrap_or(&value);
        let object = candidate.as_object();
        let read = |key: &str, fallback: &str| {
            object
                .and_then(|object| object.get(key))
                .and_then(Value::as_str)
                .unwrap_or(fallback)
                .to_string()
        };
        Ok(Self {
            idle: read("idle", "idle"),
            working: read("working", "working"),
            attention: read("attention", "attention"),
            done: read("done", "done"),
            error: read("error", "error"),
        })
    }
}

impl CompletionPetMotionMapping {
    fn normalized(self) -> Self {
        Self {
            idle: normalize_pet_motion(&self.idle, "idle"),
            working: normalize_pet_motion(&self.working, "working"),
            attention: normalize_pet_motion(&self.attention, "attention"),
            done: normalize_pet_motion(&self.done, "done"),
            error: normalize_pet_motion(&self.error, "error"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetSummon {
    schema_version: u8,
    id: String,
    purpose: String,
    pet: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    loadout: Option<String>,
    pet_size: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    movement_break_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    requested_exercise_id: Option<String>,
    next_phase: Option<String>,
}

impl<'de> Deserialize<'de> for CompletionPetSummon {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawCompletionPetSummon {
            schema_version: u8,
            id: String,
            purpose: String,
            pet: String,
            #[serde(default)]
            loadout: Option<String>,
            pet_size: String,
            #[serde(default)]
            movement_break_enabled: Option<bool>,
            #[serde(default)]
            requested_exercise_id: Option<String>,
            #[serde(default = "missing_pet_next_phase")]
            next_phase: Value,
        }

        let raw = RawCompletionPetSummon::deserialize(deserializer)?;
        let next_phase = match raw.next_phase {
            Value::Bool(false) => {
                return Err(<D::Error as serde::de::Error>::missing_field("nextPhase"));
            }
            Value::Null => None,
            Value::String(value) => Some(value),
            _ => {
                return Err(<D::Error as serde::de::Error>::custom(
                    "Completion Pet nextPhase must be a string or null",
                ));
            }
        };
        Ok(Self {
            schema_version: raw.schema_version,
            id: raw.id,
            purpose: raw.purpose,
            pet: raw.pet,
            loadout: raw.loadout,
            pet_size: raw.pet_size,
            movement_break_enabled: raw.movement_break_enabled,
            requested_exercise_id: raw.requested_exercise_id,
            next_phase,
        })
    }
}

impl CompletionPetSummon {
    fn validate(mut self) -> Result<Self, String> {
        if self.schema_version != 2 {
            return Err("Unsupported Completion Pet summon schema".to_string());
        }
        if self.id.trim().is_empty() || self.id.len() > 256 {
            return Err("Completion Pet summon id is invalid".to_string());
        }
        if !PET_NAMES.contains(&self.pet.as_str()) {
            return Err("Completion Pet selection is invalid".to_string());
        }
        if self.pet == "halo-bot" {
            if let Some(loadout) = self.loadout.as_mut() {
                if !valid_halo_bot_loadout(loadout) {
                    return Err("Halo Bot loadout is invalid".to_string());
                }
                *loadout = loadout.to_ascii_lowercase();
            }
        } else if self.loadout.is_some() {
            return Err("Only Halo Bot accepts a loadout".to_string());
        }
        if !matches!(self.pet_size.as_str(), "small" | "medium" | "large") {
            return Err("Completion Pet size is invalid".to_string());
        }
        match self.purpose.as_str() {
            "focus-completion" => {
                if self.requested_exercise_id.is_some() {
                    return Err("Focus Completion Pet cannot request a manual exercise".to_string());
                }
                if self.movement_break_enabled.is_none() {
                    return Err("Focus Completion Pet movement offer is missing".to_string());
                }
                if !matches!(
                    self.next_phase.as_deref(),
                    Some("short-break" | "long-break")
                ) {
                    return Err("Focus Completion Pet requires a prepared break phase".to_string());
                }
            }
            "break-completion" => {
                if self.requested_exercise_id.is_some() {
                    return Err("Break Completion Pet cannot request an exercise".to_string());
                }
                if self.movement_break_enabled.is_some() {
                    return Err("Break Completion Pet cannot offer movement".to_string());
                }
                if self.next_phase.as_deref() != Some("focus") {
                    return Err("Break Completion Pet requires the next Focus phase".to_string());
                }
            }
            "manual-companion" => {
                if self.next_phase.is_some() {
                    return Err("Companion Pet must not carry a prepared break phase".to_string());
                }
                self.movement_break_enabled = None;
                if self
                    .requested_exercise_id
                    .as_deref()
                    .is_some_and(|exercise| !matches!(exercise, "squat" | "overhead-reach"))
                {
                    return Err("Manual Companion exercise request is invalid".to_string());
                }
            }
            "setup-preview" => {
                if self.next_phase.is_some() {
                    return Err("Companion Pet must not carry a prepared break phase".to_string());
                }
                if self.requested_exercise_id.is_some() {
                    return Err("Setup preview cannot request an exercise".to_string());
                }
                self.movement_break_enabled = None;
            }
            _ => return Err("Completion Pet purpose is invalid".to_string()),
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetProjection {
    schema_version: u8,
    summon: CompletionPetSummon,
    session_status: String,
    activity_kind: String,
    #[serde(default = "default_pet_data_state")]
    data_state: String,
    #[serde(default)]
    motion_mapping: CompletionPetMotionMapping,
    replay_id: String,
}

impl CompletionPetProjection {
    fn validate(mut self) -> Result<Self, String> {
        if self.schema_version != 2 {
            return Err("Unsupported Completion Pet projection schema".to_string());
        }
        self.summon = self.summon.validate()?;
        if !PET_SESSION_STATUSES.contains(&self.session_status.as_str()) {
            return Err("Completion Pet session status is invalid".to_string());
        }
        if !PET_ACTIVITY_KINDS.contains(&self.activity_kind.as_str()) {
            return Err("Completion Pet activity kind is invalid".to_string());
        }
        if self.replay_id.trim().is_empty() || self.replay_id.len() > 256 {
            return Err("Completion Pet replay id is invalid".to_string());
        }
        self.data_state = pet_data_state(&self.session_status, &self.activity_kind).to_string();
        self.motion_mapping = self.motion_mapping.normalized();
        Ok(self)
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetSnapshot {
    summon: Option<CompletionPetSummon>,
    #[serde(skip_serializing_if = "Option::is_none")]
    projection: Option<CompletionPetProjection>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionPetActionRequest {
    action: String,
    summon_id: String,
    next_phase: Option<String>,
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
    snapshot: Mutex<CompletionPetSnapshot>,
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
        if let Ok(mut current) = self.snapshot.lock() {
            current.summon = summon;
            current.projection = None;
        }
    }

    #[cfg(test)]
    fn set_projection(&self, projection: Option<CompletionPetProjection>) {
        if let Ok(mut current) = self.snapshot.lock() {
            current.projection = projection;
        }
    }

    #[cfg(test)]
    fn projection(&self) -> Option<CompletionPetProjection> {
        self.snapshot
            .lock()
            .ok()
            .and_then(|value| value.projection.clone())
    }

    fn snapshot(&self) -> CompletionPetSnapshot {
        self.snapshot
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    fn set_snapshot(
        &self,
        summon: CompletionPetSummon,
        projection: CompletionPetProjection,
    ) -> Result<(), String> {
        let mut current = self
            .snapshot
            .lock()
            .map_err(|_| "Completion Pet snapshot state is unavailable".to_string())?;
        current.summon = Some(summon);
        current.projection = Some(projection);
        Ok(())
    }

    fn update_projection(&self, projection: CompletionPetProjection) -> Result<(), String> {
        let projection = projection.validate()?;
        let mut current = self
            .snapshot
            .lock()
            .map_err(|_| "Completion Pet snapshot state is unavailable".to_string())?;
        let current_summon = current
            .summon
            .as_ref()
            .ok_or_else(|| "Completion Pet has no active summon".to_string())?;
        if &projection.summon != current_summon {
            return Err("Completion Pet projection summon is no longer current".to_string());
        }
        current.projection = Some(projection);
        Ok(())
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

    fn queue_action(&self, action: CompletionPetActionRequest) -> Result<(), String> {
        let mut pending = self
            .pending_action
            .lock()
            .map_err(|_| "Completion Pet action state is unavailable".to_string())?;
        if pending.is_some() {
            return Err("Completion Pet action is already pending".to_string());
        }
        *pending = Some(action);
        Ok(())
    }

    #[cfg(test)]
    fn pending_action(&self) -> Option<CompletionPetActionRequest> {
        self.pending_action
            .lock()
            .ok()
            .and_then(|value| value.clone())
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
            if summon.id != summon_id {
                return false;
            }
            match summon.purpose.as_str() {
                "manual-companion" => true,
                "focus-completion" => summon.movement_break_enabled == Some(true),
                _ => false,
            }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompletionPetActionEffect {
    QueueAndHide,
    QueueAndKeepVisible,
}

fn completion_pet_action_effect(
    summon: &CompletionPetSummon,
    action: &str,
    movement_attempt_matches: bool,
) -> Result<CompletionPetActionEffect, String> {
    match summon.purpose.as_str() {
        "focus-completion" => match action {
            "start-break" => Ok(CompletionPetActionEffect::QueueAndHide),
            "movement-complete" => {
                if summon.movement_break_enabled != Some(true) {
                    return Err("Movement Break is disabled for this completion".to_string());
                }
                if !movement_attempt_matches {
                    return Err("Movement Break attempt does not match this completion".to_string());
                }
                Ok(CompletionPetActionEffect::QueueAndHide)
            }
            _ => Err("Unsupported Completion Pet action for focus completion".to_string()),
        },
        "break-completion" => {
            if action == "start-focus" {
                Ok(CompletionPetActionEffect::QueueAndHide)
            } else {
                Err("Unsupported Completion Pet action for break completion".to_string())
            }
        }
        "manual-companion" => {
            if action == "open-focus" {
                Ok(CompletionPetActionEffect::QueueAndKeepVisible)
            } else {
                Err("Unsupported Completion Pet action for manual companion".to_string())
            }
        }
        "setup-preview" => Err("Setup preview cannot queue a Completion Pet action".to_string()),
        _ => Err("Completion Pet purpose is invalid".to_string()),
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PetDisplayTarget {
    Selected,
    Saved,
    Primary,
}

fn pet_display_target(
    saved: Option<&PetPositionPreference>,
    selected: Option<&crate::DisplayPreference>,
) -> PetDisplayTarget {
    if selected.is_some() {
        PetDisplayTarget::Selected
    } else if saved.is_some() {
        PetDisplayTarget::Saved
    } else {
        PetDisplayTarget::Primary
    }
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
        match pet_display_target(preference, selected_display) {
            PetDisplayTarget::Selected => resolve_appkit_screen(screens, selected_display).0,
            PetDisplayTarget::Saved => {
                let preference = preference?;
                if let Some(screen) = screens.iter().find(|screen| {
                    appkit_display_id(screen).as_deref() == Some(preference.display_id.as_str())
                }) {
                    return Some(screen);
                }
                if let Some(screen) = screens.iter().find(|screen| {
                    appkit_display_option(screen, None).is_some_and(|display| {
                        display.fingerprint == preference.display_fingerprint
                    })
                }) {
                    return Some(screen);
                }
                resolve_appkit_screen(screens, None).0
            }
            PetDisplayTarget::Primary => resolve_appkit_screen(screens, None).0,
        }
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

    fn nudge_on_main_thread(window: &WebviewWindow, dx: f64, dy: f64) -> bool {
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
            let x = clamp_window_origin(
                frame.origin.x,
                frame.size.width,
                dx,
                visible.origin.x,
                visible.size.width,
                PET_VISIBLE_MARGIN,
            );
            let y = clamp_window_origin(
                frame.origin.y,
                frame.size.height,
                -dy,
                visible.origin.y,
                visible.size.height,
                PET_VISIBLE_MARGIN,
            );
            configure_window(ns_window);
            ns_window.setFrame_display(
                NSRect::new(NSPoint::new(x, y), NSSize::new(frame.size.width, frame.size.height)),
                true,
            );
        }
        true
    }

    pub fn nudge(window: &WebviewWindow, dx: f64, dy: f64) -> Result<(), String> {
        if nudge_on_main_thread(window, dx, dy) {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel();
        let scheduled_window = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(nudge_on_main_thread(&scheduled_window, dx, dy));
            })
            .map_err(|error| format!("Could not schedule Completion Pet nudge: {error}"))?;
        if receiver
            .recv_timeout(Duration::from_millis(500))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err("Could not nudge Completion Pet".to_string())
        }
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

    pub fn nudge(window: &WebviewWindow, dx: f64, dy: f64) -> Result<(), String> {
        let scale = window
            .scale_factor()
            .map_err(|error| format!("Could not read Completion Pet scale: {error}"))?;
        let position = window
            .outer_position()
            .map_err(|error| format!("Could not read Completion Pet position: {error}"))?;
        let x = f64::from(position.x) / scale + dx;
        let y = f64::from(position.y) / scale + dy;
        window
            .set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|error| format!("Could not nudge Completion Pet: {error}"))
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
    projection: CompletionPetProjection,
) -> Result<bool, String> {
    validate_window(&window, "main")?;
    let summon = summon.validate()?;
    let projection = projection.validate()?;
    if projection.summon != summon {
        return Err("Completion Pet initial projection does not match its summon".to_string());
    }
    let _surface_guard = state.lock_surface()?;
    let revision = state.begin_operation();
    let pet_window = window
        .app_handle()
        .get_webview_window("pet")
        .ok_or_else(|| "Completion Pet window is unavailable".to_string())?;
    state.clear_pending_action();
    state.clear_movement_attempt();
    state.set_snapshot(summon, projection)?;
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
pub fn update_completion_pet_projection(
    window: WebviewWindow,
    state: tauri::State<'_, CompletionPetWindowState>,
    projection: CompletionPetProjection,
) -> Result<(), String> {
    validate_window(&window, "main")?;
    let _surface_guard = state.lock_surface()?;
    state.update_projection(projection)
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
pub fn nudge_completion_pet(window: WebviewWindow, dx: f64, dy: f64) -> Result<(), String> {
    validate_window(&window, "pet")?;
    let dx = bounded_nudge(dx)?;
    let dy = bounded_nudge(dy)?;
    let app = window.app_handle().clone();
    let revision = app.state::<CompletionPetWindowState>().begin_user_drag();
    let timeout_app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        let _ = timeout_app
            .state::<CompletionPetWindowState>()
            .finish_user_move(revision);
    });
    platform::nudge(&window, dx, dy)
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
    let dismissed_summon = state.snapshot().summon;
    state.begin_operation();
    let pet_window = window
        .app_handle()
        .get_webview_window("pet")
        .ok_or_else(|| "Completion Pet window is unavailable".to_string())?;
    state.set_summon(None);
    state.clear_pending_action();
    if window.label() == "pet" {
        if let Some(summon) = dismissed_summon {
            state.queue_action(CompletionPetActionRequest {
                action: "dismiss".to_string(),
                summon_id: summon.id,
                next_phase: None,
            })?;
        }
    }
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
    let summon = state
        .snapshot()
        .summon
        .ok_or_else(|| "Completion Pet has no active summon".to_string())?;
    let effect =
        completion_pet_action_effect(&summon, &action, state.movement_attempt_matches(&summon.id))?;
    let request = CompletionPetActionRequest {
        action,
        summon_id: summon.id.clone(),
        next_phase: summon.next_phase.clone(),
    };
    if effect == CompletionPetActionEffect::QueueAndKeepVisible {
        return state.queue_action(request);
    }

    state.begin_operation();
    state.set_surface_mode(CompletionPetSurfaceMode::Collapsed);
    state.queue_action(request)?;
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
    fn movement_nudge_stays_inside_the_visible_frame() {
        assert_eq!(clamp_window_origin(100.0, 600.0, 16.0, 0.0, 1400.0, 12.0), 116.0);
        assert_eq!(clamp_window_origin(20.0, 600.0, -48.0, 0.0, 1400.0, 12.0), 12.0);
        assert_eq!(clamp_window_origin(700.0, 600.0, 80.0, 0.0, 1400.0, 12.0), 780.0);
        assert_eq!(clamp_window_origin(760.0, 600.0, 80.0, 0.0, 1400.0, 12.0), 788.0);
        assert!(bounded_nudge(16.0).is_ok());
        assert!(bounded_nudge(81.0).is_err());
        assert!(bounded_nudge(f64::NAN).is_err());
    }

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

    fn focus_summon(id: &str, movement_break_enabled: bool) -> CompletionPetSummon {
        CompletionPetSummon {
            schema_version: 2,
            id: id.to_string(),
            purpose: "focus-completion".to_string(),
            pet: "haloform".to_string(),
            loadout: None,
            pet_size: "large".to_string(),
            movement_break_enabled: Some(movement_break_enabled),
            requested_exercise_id: None,
            next_phase: Some("short-break".to_string()),
        }
    }

    fn manual_summon(id: &str) -> CompletionPetSummon {
        CompletionPetSummon {
            schema_version: 2,
            id: id.to_string(),
            purpose: "manual-companion".to_string(),
            pet: "haloform".to_string(),
            loadout: None,
            pet_size: "large".to_string(),
            movement_break_enabled: None,
            requested_exercise_id: None,
            next_phase: None,
        }
    }

    fn setup_preview_summon(id: &str) -> CompletionPetSummon {
        CompletionPetSummon {
            schema_version: 2,
            id: id.to_string(),
            purpose: "setup-preview".to_string(),
            pet: "haloform".to_string(),
            loadout: None,
            pet_size: "large".to_string(),
            movement_break_enabled: None,
            requested_exercise_id: None,
            next_phase: None,
        }
    }

    fn projection_for(
        summon: CompletionPetSummon,
        session_status: &str,
        activity_kind: &str,
    ) -> CompletionPetProjection {
        CompletionPetProjection {
            schema_version: 2,
            summon,
            session_status: session_status.to_string(),
            activity_kind: activity_kind.to_string(),
            data_state: "idle".to_string(),
            motion_mapping: CompletionPetMotionMapping {
                idle: "invalid".to_string(),
                working: "working".to_string(),
                attention: "attention".to_string(),
                done: "done".to_string(),
                error: "error".to_string(),
            },
            replay_id: "replay-1".to_string(),
        }
    }

    #[test]
    fn summon_validation_accepts_all_purpose_schemas_and_rejects_legacy_schema() {
        assert_eq!(
            focus_summon("focus-1", false).validate().unwrap().purpose,
            "focus-completion"
        );
        assert_eq!(
            manual_summon("manual-1").validate().unwrap().purpose,
            "manual-companion"
        );
        assert_eq!(
            setup_preview_summon("preview-1")
                .validate()
                .unwrap()
                .purpose,
            "setup-preview"
        );
        assert!(CompletionPetSummon {
            schema_version: 1,
            ..focus_summon("legacy", false)
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            purpose: "unknown-purpose".to_string(),
            ..focus_summon("unknown", false)
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            next_phase: Some("short-break".to_string()),
            ..manual_summon("manual-phase")
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            requested_exercise_id: Some("squat".to_string()),
            ..manual_summon("manual-squat")
        }
        .validate()
        .is_ok());
        assert!(CompletionPetSummon {
            requested_exercise_id: Some("jumping-jack".to_string()),
            ..manual_summon("manual-invalid-exercise")
        }
        .validate()
        .is_err());
        assert!(CompletionPetSummon {
            movement_break_enabled: None,
            ..focus_summon("missing-offer", false)
        }
        .validate()
        .is_err());
        let manual_json = r#"{
            "schemaVersion": 2,
            "id": "manual-json",
            "purpose": "manual-companion",
            "pet": "haloform",
            "petSize": "large",
            "nextPhase": null
        }"#;
        assert!(serde_json::from_str::<CompletionPetSummon>(manual_json)
            .unwrap()
            .validate()
            .is_ok());
        let missing_next_phase = manual_json.replace(",\n            \"nextPhase\": null", "");
        assert!(serde_json::from_str::<CompletionPetSummon>(&missing_next_phase).is_err());
    }

    #[test]
    fn summon_validation_accepts_the_complete_pixabots_catalog() {
        let valid = focus_summon("focus-1", false);
        assert!(CompletionPetSummon {
            pet: "halo-bot".to_string(),
            loadout: Some("3051".to_string()),
            ..valid.clone()
        }
        .validate()
        .is_ok());
        assert!(CompletionPetSummon {
            pet: "halo-bot".to_string(),
            loadout: Some("f76b".to_string()),
            ..valid.clone()
        }
        .validate()
        .is_ok());
        let uppercase = CompletionPetSummon {
            pet: "halo-bot".to_string(),
            loadout: Some("F76B".to_string()),
            ..valid.clone()
        }
        .validate()
        .unwrap();
        assert_eq!(uppercase.loadout.as_deref(), Some("f76b"));
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
    }

    #[test]
    fn summon_deserialization_ignores_legacy_copy_fields_but_validates_purpose() {
        let summon: CompletionPetSummon = serde_json::from_str(
            r#"{
                "schemaVersion": 2,
                "id": "focus-1",
                "purpose": "focus-completion",
                "pet": "haloform",
                "petSize": "large",
                "movementBreakEnabled": true,
                "nextPhase": "short-break",
                "preview": true,
                "title": "Pet preview",
                "actionLabel": ""
            }"#,
        )
        .expect("legacy copy fields should be ignored");
        assert!(summon.validate().is_ok());
    }

    #[test]
    fn summon_deserialization_rejects_the_legacy_schema_even_with_legacy_visual_fields() {
        let summon: CompletionPetSummon = serde_json::from_str(
            r#"{
                "schemaVersion": 1,
                "id": "focus-1",
                "purpose": "focus-completion",
                "pet": "haloform",
                "petSize": "large",
                "visual": "ember-starling",
                "movementBreakEnabled": true,
                "nextPhase": "short-break",
                "preview": false,
                "title": "Focus complete",
                "actionLabel": "Start Short break"
            }"#,
        )
        .expect("legacy visual fields should still be ignored by deserialization");
        assert!(summon.validate().is_err());
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
    fn movement_activation_allows_only_enabled_focus_or_manual_companions() {
        let state = CompletionPetWindowState::default();
        state.set_summon(Some(focus_summon("focus-movement", true)));
        assert!(state.movement_summon_matches("focus-movement"));
        assert!(!state.movement_summon_matches("another-focus"));
        state.set_summon(Some(focus_summon("focus-disabled", false)));
        assert!(!state.movement_summon_matches("focus-disabled"));
        state.set_summon(Some(manual_summon("manual-movement")));
        assert!(state.movement_summon_matches("manual-movement"));
        state.set_summon(Some(setup_preview_summon("preview-movement")));
        assert!(!state.movement_summon_matches("preview-movement"));
    }

    #[test]
    fn movement_attempt_remains_exactly_bound_to_the_current_summon() {
        let state = CompletionPetWindowState::default();
        state.set_summon(Some(focus_summon("focus-movement", true)));
        state
            .set_movement_attempt(Some("focus-movement".to_string()))
            .unwrap();
        assert!(state.movement_attempt_matches("focus-movement"));
        assert!(!state.movement_attempt_matches("another-focus"));
        state.set_summon(Some(focus_summon("new-focus", true)));
        assert!(state.movement_attempt_matches("focus-movement"));
        assert!(!state.movement_summon_matches("focus-movement"));
        assert!(!state.movement_attempt_matches("new-focus"));
        state.clear_movement_attempt();
        assert!(!state.movement_attempt_matches("focus-movement"));
    }

    #[test]
    fn action_allowlist_keeps_manual_open_focus_visible_and_never_queues_completion() {
        let manual = manual_summon("manual-action");
        assert_eq!(
            completion_pet_action_effect(&manual, "open-focus", false),
            Ok(CompletionPetActionEffect::QueueAndKeepVisible)
        );
        assert!(completion_pet_action_effect(&manual, "start-break", false).is_err());
        assert!(completion_pet_action_effect(&manual, "movement-complete", true).is_err());
        assert!(completion_pet_action_effect(
            &setup_preview_summon("preview-action"),
            "open-focus",
            false
        )
        .is_err());

        let state = CompletionPetWindowState::default();
        state.set_summon(Some(manual));
        let mode_before = state.surface_mode();
        state
            .queue_action(CompletionPetActionRequest {
                action: "open-focus".to_string(),
                summon_id: "manual-action".to_string(),
                next_phase: None,
            })
            .unwrap();
        assert!(state.snapshot().summon.is_some());
        assert_eq!(state.surface_mode(), mode_before);
        assert_eq!(state.pending_action().unwrap().next_phase, None);
        assert!(state
            .queue_action(CompletionPetActionRequest {
                action: "movement-complete".to_string(),
                summon_id: "manual-action".to_string(),
                next_phase: None,
            })
            .is_err());
        assert!(state.snapshot().summon.is_some());
    }

    #[test]
    fn focus_action_allowlist_preserves_break_and_movement_completion_paths() {
        let focus = focus_summon("focus-actions", true);
        assert_eq!(
            completion_pet_action_effect(&focus, "start-break", false),
            Ok(CompletionPetActionEffect::QueueAndHide)
        );
        assert_eq!(
            completion_pet_action_effect(&focus, "movement-complete", true),
            Ok(CompletionPetActionEffect::QueueAndHide)
        );
        assert!(completion_pet_action_effect(&focus, "movement-complete", false).is_err());
        assert!(completion_pet_action_effect(
            &focus_summon("focus-no-movement", false),
            "movement-complete",
            true
        )
        .is_err());
        assert!(completion_pet_action_effect(&focus, "open-focus", false).is_err());
        assert!(completion_pet_action_effect(&focus, "start-focus", false).is_err());
    }

    #[test]
    fn break_completion_can_only_start_the_prepared_focus() {
        let summon = CompletionPetSummon {
            schema_version: 2,
            id: "break-1".to_string(),
            purpose: "break-completion".to_string(),
            pet: "haloform".to_string(),
            loadout: None,
            pet_size: "large".to_string(),
            movement_break_enabled: None,
            requested_exercise_id: None,
            next_phase: Some("focus".to_string()),
        }
        .validate()
        .expect("break completion summon");
        assert_eq!(
            completion_pet_action_effect(&summon, "start-focus", false),
            Ok(CompletionPetActionEffect::QueueAndHide)
        );
        assert!(completion_pet_action_effect(&summon, "start-break", false).is_err());
        assert!(completion_pet_action_effect(&summon, "movement-complete", true).is_err());
        let mut offered = summon.clone();
        offered.movement_break_enabled = Some(true);
        assert!(offered.validate().is_err());
    }

    #[test]
    fn companion_projection_validation_derives_truthful_state_and_resolves_mapping() {
        for summon in [
            focus_summon("projection-focus", true),
            manual_summon("projection-manual"),
            setup_preview_summon("projection-preview"),
        ] {
            assert!(projection_for(summon, "idle", "session").validate().is_ok());
        }

        let projection =
            projection_for(focus_summon("projection-truth", true), "working", "asking")
                .validate()
                .unwrap();
        assert_eq!(projection.data_state, "attention");
        assert_eq!(projection.motion_mapping.idle, "idle");
        assert_eq!(projection.motion_mapping.working, "working");
        assert_eq!(projection.motion_mapping.attention, "attention");
        assert_eq!(projection.motion_mapping.done, "done");
        assert_eq!(projection.motion_mapping.error, "error");
        assert!(CompletionPetProjection {
            session_status: "unknown".to_string(),
            ..projection.clone()
        }
        .validate()
        .is_err());
        assert!(CompletionPetProjection {
            activity_kind: "unknown".to_string(),
            ..projection.clone()
        }
        .validate()
        .is_err());
        assert!(CompletionPetProjection {
            replay_id: "   ".to_string(),
            ..projection.clone()
        }
        .validate()
        .is_err());
        assert!(CompletionPetProjection {
            schema_version: 1,
            ..projection
        }
        .validate()
        .is_err());
    }

    #[test]
    fn companion_projection_update_is_current_summon_only_and_does_not_touch_window_revision() {
        let state = CompletionPetWindowState::default();
        let summon = focus_summon("projection-current", true);
        state.set_summon(Some(summon.clone()));
        state.set_surface_mode(CompletionPetSurfaceMode::Expanded);
        let revision = state.begin_operation();
        let projection = projection_for(summon.clone(), "done", "done");
        state.update_projection(projection.clone()).unwrap();
        assert_eq!(state.revision.load(Ordering::SeqCst), revision);
        assert_eq!(state.surface_mode(), CompletionPetSurfaceMode::Expanded);
        assert_eq!(state.snapshot().summon.unwrap(), summon);
        assert_eq!(state.projection().unwrap().data_state, "done");
        assert_eq!(state.projection().unwrap().replay_id, "replay-1");

        let stale = projection_for(focus_summon("projection-stale", true), "working", "model");
        assert!(state.update_projection(stale).is_err());
        assert_eq!(state.projection().unwrap().replay_id, "replay-1");
    }

    #[test]
    fn initial_snapshot_pairs_summon_and_projection_before_show_and_dismiss_is_bounded() {
        let state = CompletionPetWindowState::default();
        let summon = manual_summon("atomic-manual");
        let projection = projection_for(summon.clone(), "attention", "asking")
            .validate()
            .unwrap();
        state
            .set_snapshot(summon.clone(), projection.clone())
            .unwrap();
        let snapshot = state.snapshot();
        assert_eq!(snapshot.summon, Some(summon.clone()));
        assert_eq!(snapshot.projection, Some(projection));

        state
            .queue_action(CompletionPetActionRequest {
                action: "dismiss".to_string(),
                summon_id: summon.id,
                next_phase: None,
            })
            .unwrap();
        let dismissal = state.pending_action().unwrap();
        assert_eq!(dismissal.action, "dismiss");
        assert_eq!(dismissal.next_phase, None);
    }

    #[test]
    fn action_request_serializes_manual_next_phase_as_null() {
        let request = CompletionPetActionRequest {
            action: "open-focus".to_string(),
            summon_id: "manual-action".to_string(),
            next_phase: None,
        };
        assert_eq!(
            serde_json::to_value(request).unwrap().get("nextPhase"),
            Some(&Value::Null)
        );
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
    fn selected_display_outranks_the_saved_pet_display() {
        let saved = PetPositionPreference {
            schema_version: 2,
            display_id: "external".to_string(),
            display_fingerprint: "external-fingerprint".to_string(),
            x_ratio: 0.75,
            y_ratio: 0.25,
        };
        let selected = crate::DisplayPreference {
            id: "built-in".to_string(),
            fingerprint: "built-in-fingerprint".to_string(),
            name: "Built-in display".to_string(),
        };
        assert_eq!(
            pet_display_target(Some(&saved), Some(&selected)),
            PetDisplayTarget::Selected
        );
        assert_eq!(
            pet_display_target(Some(&saved), None),
            PetDisplayTarget::Saved
        );
        assert_eq!(pet_display_target(None, None), PetDisplayTarget::Primary);
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
