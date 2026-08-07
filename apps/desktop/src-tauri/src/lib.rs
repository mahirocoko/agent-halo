use std::{
    collections::{BTreeMap, HashMap, HashSet},
    error::Error as StdError,
    fs,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    LogicalSize, Manager, Size,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[cfg(unix)]
use std::os::unix::{
    fs::{FileTypeExt, MetadataExt},
    net::UnixStream,
};

mod keep_awake;
mod local_services;
mod notification;
mod pet_window;
mod runtime_usage;
mod standalone_bridge;

use keep_awake::KeepAwakeState;
use local_services::local_services;
use notification::{
    cancel_pomodoro_notification, notification_permission_state, request_notification_permission,
    schedule_pomodoro_notification, PomodoroNotificationState,
};
use pet_window::{
    activate_completion_pet, completion_pet_state, drag_completion_pet, hide_completion_pet,
    set_completion_pet_expanded, set_completion_pet_movement, show_completion_pet,
    submit_completion_pet_action, take_completion_pet_action, CompletionPetWindowState,
};
use runtime_usage::{runtime_usage, RuntimeUsageState};
use standalone_bridge::StandaloneBridgeState;

#[cfg(target_os = "macos")]
use objc2::{msg_send, rc::Retained, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};
#[cfg(target_os = "macos")]
use security_framework::passwords::set_generic_password;

const TRAY_SHOW: &str = "show";
const TRAY_HIDE: &str = "hide";
const TRAY_QUIT: &str = "quit";
const DISPLAY_PREFERENCE_FILE: &str = "display-preference.json";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_RESET_CREDITS_URL: &str =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CODEX_REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_KEYCHAIN_SERVICE: &str = "Codex Auth";
const CODEX_CREDIT_USD_RATE: f64 = 0.04;
const CCUSAGE_PACKAGE: &str = "ccusage@20.0.18";
const CCUSAGE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const CCUSAGE_TIMEOUT: Duration = Duration::from_secs(15);
const OPENUSAGE_PROXY_CONFIG_PATH: &str = ".openusage/config.json";
const AGY_LS_SERVICE: &str = "exa.language_server_pb.LanguageServerService";
const AGY_KEYCHAIN_SERVICE: &str = "gemini";
const AGY_KEYCHAIN_ACCOUNT: &str = "antigravity";
const AGY_CLOUD_CODE_BASE_URLS: [&str; 2] = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
];
const AGY_CLOUD_QUOTA_SUMMARY_PATH: &str = "/v1internal:retrieveUserQuotaSummary";
const AGY_CLOUD_LOAD_CODE_ASSIST_PATH: &str = "/v1internal:loadCodeAssist";
const AGY_GOOGLE_OAUTH_URL: &str = "https://oauth2.googleapis.com/token";
const AGY_GOOGLE_CLIENT_ID_ENV: &str = "AGENT_HALO_AGY_GOOGLE_CLIENT_ID";
const AGY_GOOGLE_CLIENT_SECRET_ENV: &str = "AGENT_HALO_AGY_GOOGLE_CLIENT_SECRET";
const AGY_GOOGLE_OAUTH_CONFIG_PATH: &str = ".config/agent-halo/agy-google-oauth.json";
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_REFRESH_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_NON_PROD_CLIENT_ID: &str = "22422756-60c9-4084-8eb7-27705fd5cf9a";
const CLAUDE_SCOPES: &str =
    "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const CLAUDE_KEYCHAIN_SERVICE_PREFIX: &str = "Claude Code";
const CLAUDE_DEFAULT_HOME: &str = ".claude";
const CLAUDE_CREDENTIALS_FILE: &str = ".credentials.json";
const CLAUDE_REFRESH_BUFFER_MS: i64 = 5 * 60 * 1000;
const CURSOR_STATE_DB: &str = "Library/Application Support/Cursor/User/globalStorage/state.vscdb";
const CURSOR_USAGE_URL: &str =
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const CURSOR_PLAN_URL: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo";
const CURSOR_USAGE_EXPORT_URL: &str = "https://cursor.com/api/dashboard/export-usage-events-csv";
const CURSOR_REFRESH_URL: &str = "https://api2.cursor.sh/oauth/token";
const CURSOR_CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const CURSOR_ACCESS_KEYCHAIN_SERVICE: &str = "cursor-access-token";
const CURSOR_REFRESH_KEYCHAIN_SERVICE: &str = "cursor-refresh-token";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DisplayPreference {
    id: String,
    fingerprint: String,
    #[serde(default)]
    name: String,
}

#[derive(Default)]
pub(crate) struct DisplayPreferenceState {
    selection: Mutex<Option<DisplayPreference>>,
}

impl DisplayPreferenceState {
    pub(crate) fn get(&self) -> Option<DisplayPreference> {
        self.selection
            .lock()
            .ok()
            .and_then(|selection| selection.clone())
    }

    fn set(&self, selection: Option<DisplayPreference>) {
        if let Ok(mut current) = self.selection.lock() {
            *current = selection;
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DisplayOption {
    pub(crate) id: String,
    pub(crate) fingerprint: String,
    pub(crate) name: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) scale_factor: f64,
    pub(crate) is_primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayStateSnapshot {
    displays: Vec<DisplayOption>,
    preferred_display_id: Option<String>,
    preferred_display_name: Option<String>,
    selected_display_id: Option<String>,
    active_display_id: Option<String>,
    fallback_active: bool,
}

#[cfg(any(test, not(target_os = "macos")))]
fn preferred_display_index(
    displays: &[DisplayOption],
    preference: Option<&DisplayPreference>,
) -> Option<usize> {
    let preference = preference?;
    displays
        .iter()
        .position(|display| display.id == preference.id)
        .or_else(|| {
            displays
                .iter()
                .position(|display| display.fingerprint == preference.fingerprint)
        })
}
#[derive(Debug, Clone, Deserialize, Serialize)]
struct CodexAuthFile {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: Option<CodexAuthTokens>,
    last_refresh: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct CodexAuthTokens {
    access_token: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Debug, Clone)]
enum CodexAuthSource {
    File(PathBuf),
    Keychain(String),
}

#[derive(Debug, Clone)]
struct CodexAuthState {
    auth: CodexAuthFile,
    source: CodexAuthSource,
}

#[derive(Debug, Deserialize)]
struct OpenUsageProxyConfigFile {
    proxy: Option<OpenUsageProxyConfig>,
}

#[derive(Debug, Deserialize)]
struct OpenUsageProxyConfig {
    enabled: Option<bool>,
    url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexUsageSnapshot {
    provider_id: String,
    display_name: String,
    plan: Option<String>,
    lines: Vec<CodexMetricLine>,
    fetched_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum CodexMetricLine {
    #[serde(rename_all = "camelCase")]
    Progress {
        label: String,
        used: f64,
        limit: f64,
        format: CodexProgressFormat,
        resets_at: Option<String>,
        period_duration_ms: Option<u64>,
    },
    Text {
        label: String,
        value: String,
    },
    #[serde(rename_all = "camelCase")]
    BarChart {
        label: String,
        points: Vec<CodexBarChartPoint>,
        note: Option<String>,
        color: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexBarChartPoint {
    label: String,
    value: f64,
    value_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum CodexProgressFormat {
    Percent,
}

#[derive(Debug, Deserialize)]
struct CodexUsageEnvelope {
    plan_type: Option<String>,
    rate_limit: Option<CodexRateLimit>,
    additional_rate_limits: Option<Vec<CodexAdditionalRateLimit>>,
    code_review_rate_limit: Option<CodexReviewRateLimit>,
    credits: Option<CodexCredits>,
    rate_limit_reset_credits: Option<CodexResetCredits>,
}

#[derive(Debug, Deserialize)]
struct CodexAdditionalRateLimit {
    limit_name: Option<String>,
    metered_feature: Option<String>,
    rate_limit: Option<CodexRateLimit>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimit {
    primary_window: Option<CodexRateLimitWindow>,
    secondary_window: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
struct CodexReviewRateLimit {
    primary_window: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimitWindow {
    used_percent: Option<Value>,
    reset_at: Option<Value>,
    reset_after_seconds: Option<Value>,
    limit_window_seconds: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexWindowKind {
    Session,
    Weekly,
}

#[derive(Debug, Clone, Copy)]
struct CodexWindowCandidate<'a> {
    window: Option<&'a CodexRateLimitWindow>,
    header_percent: Option<f64>,
    fallback_kind: CodexWindowKind,
}

#[derive(Debug, Deserialize)]
struct CodexCredits {
    balance: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CodexResetCredits {
    available_count: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CodexResetCreditsEnvelope {
    available_count: Option<Value>,
    credits: Option<Vec<CodexResetCredit>>,
}

#[derive(Debug, Deserialize)]
struct CodexResetCredit {
    status: Option<String>,
    expires_at: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct CcusageDailyUsage {
    daily: Vec<CcusageDay>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageDay {
    date: String,
    total_tokens: Option<Value>,
    cost_usd: Option<Value>,
    total_cost: Option<Value>,
    models: Option<BTreeMap<String, CcusageModelUsage>>,
    model_breakdowns: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageModelUsage {
    total_tokens: Option<Value>,
    input_tokens: Option<Value>,
    cached_input_tokens: Option<Value>,
    cache_creation_tokens: Option<Value>,
    cache_read_tokens: Option<Value>,
    output_tokens: Option<Value>,
    reasoning_output_tokens: Option<Value>,
}

#[derive(Debug, Clone)]
struct CcusageCacheEntry {
    key: String,
    fetched_at: Instant,
    usage: CcusageDailyUsage,
}

static CLAUDE_LAST_GOOD_USAGE: OnceLock<Mutex<HashMap<String, CodexUsageSnapshot>>> =
    OnceLock::new();

static CODEX_CCUSAGE_CACHE: OnceLock<Mutex<Option<CcusageCacheEntry>>> = OnceLock::new();
static CODEX_CCUSAGE_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct CodexRefreshResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ClaudeCredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<ClaudeOauth>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ClaudeOauth {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
    #[serde(rename = "rateLimitTier")]
    rate_limit_tier: Option<String>,
    scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct ClaudeAuthState {
    credentials: ClaudeCredentialsFile,
    service_name: Option<String>,
    file_path: Option<PathBuf>,
    inference_only: bool,
    oauth_config: ClaudeOauthConfig,
}

#[derive(Debug, Clone)]
struct ClaudeOauthConfig {
    usage_url: String,
    refresh_url: String,
    client_id: String,
    oauth_file_suffix: String,
}

#[derive(Debug, Deserialize)]
struct OAuthRefreshResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Clone)]
enum CursorAuthSource {
    Sqlite,
    Keychain,
}

#[derive(Debug, Clone)]
struct CursorAuthState {
    access_token: Option<String>,
    refresh_token: Option<String>,
    source: CursorAuthSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CursorSession {
    user_id: String,
    cookie_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CursorUsageExportDay {
    date: String,
    total_tokens: u64,
    models: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CursorUsageExport {
    daily: Vec<CursorUsageExportDay>,
}

fn letta_mod_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".letta")
        .join("mods")
        .join("agent-halo.js"))
}

fn letta_hook_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".letta")
        .join("hooks")
        .join("agent-halo-hook.mjs"))
}

fn agy_hook_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".gemini")
        .join("config")
        .join("hooks")
        .join("agent-halo-agy-hook.mjs"))
}

fn agy_hooks_json_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".gemini")
        .join("config")
        .join("hooks.json"))
}

#[tauri::command]
fn bridge_health() -> bool {
    standalone_bridge::bridge_health()
}

#[tauri::command]
fn set_keep_awake(state: tauri::State<'_, KeepAwakeState>, active: bool) -> Result<bool, String> {
    state.set_active(active)
}

#[tauri::command]
async fn codex_usage() -> Result<CodexUsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(codex_usage_blocking)
        .await
        .map_err(|error| format!("Codex usage task failed: {error}"))?
}

fn codex_usage_blocking() -> Result<CodexUsageSnapshot, String> {
    let auth_candidates = load_codex_auth_candidates()?;
    let client = usage_client("Codex")?;

    let mut last_auth_error = None;
    for mut auth_state in auth_candidates {
        if codex_access_token_needs_refresh(&auth_state) {
            if let Err(message) = refresh_codex_auth(&client, &mut auth_state) {
                last_auth_error = Some(message);
                continue;
            }
        }

        match fetch_codex_usage_snapshot(&client, &auth_state) {
            Ok(snapshot) => return Ok(snapshot),
            Err(CodexUsageFetchError::Auth) => {
                let previous_fingerprint = codex_auth_fingerprint(&auth_state);
                let refreshed_source = match reload_codex_auth_source(&auth_state) {
                    Ok(source) => source,
                    Err(message) => {
                        last_auth_error = Some(message);
                        continue;
                    }
                };
                if codex_auth_fingerprint(&refreshed_source) != previous_fingerprint {
                    match fetch_codex_usage_snapshot(&client, &refreshed_source) {
                        Ok(snapshot) => return Ok(snapshot),
                        Err(CodexUsageFetchError::Auth) => {}
                        Err(error) => return Err(format_codex_usage_error(error)),
                    }
                }
                auth_state = refreshed_source;
                if let Err(message) = refresh_codex_auth(&client, &mut auth_state) {
                    last_auth_error = Some(message);
                    continue;
                }
                match fetch_codex_usage_snapshot(&client, &auth_state) {
                    Ok(snapshot) => return Ok(snapshot),
                    Err(CodexUsageFetchError::Auth) => {
                        last_auth_error =
                            Some(format_codex_usage_error(CodexUsageFetchError::Auth));
                    }
                    Err(error) => return Err(format_codex_usage_error(error)),
                }
            }
            Err(error) => return Err(format_codex_usage_error(error)),
        }
    }

    Err(last_auth_error
        .unwrap_or_else(|| "Codex session expired. Run `codex` to log in again.".to_string()))
}

fn fetch_codex_usage_snapshot(
    client: &reqwest::blocking::Client,
    auth_state: &CodexAuthState,
) -> Result<CodexUsageSnapshot, CodexUsageFetchError> {
    let (usage, headers) = fetch_codex_usage(client, auth_state)?;
    let reset_credits = fetch_codex_reset_credits_best_effort(client, auth_state);
    let mut snapshot = build_codex_usage_snapshot(usage, &headers, reset_credits.as_ref());
    append_codex_local_usage(&mut snapshot, auth_state);
    Ok(snapshot)
}

fn format_codex_usage_error(error: CodexUsageFetchError) -> String {
    match error {
        CodexUsageFetchError::Auth => {
            "Codex session expired. Run `codex` to log in again.".to_string()
        }
        CodexUsageFetchError::RateLimited(_) => {
            "Codex usage is rate limited. Try again shortly.".to_string()
        }
        CodexUsageFetchError::Other(message) => message,
    }
}

#[tauri::command]
async fn agy_usage() -> Result<CodexUsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(agy_usage_blocking)
        .await
        .map_err(|error| format!("Antigravity usage task failed: {error}"))?
}

fn agy_usage_blocking() -> Result<CodexUsageSnapshot, String> {
    if let Some(snapshot) = probe_antigravity_ls_usage() {
        return Ok(snapshot);
    }

    let client = usage_client("Antigravity")?;
    let mut has_local_credentials = false;
    if let Some(mut auth) = load_antigravity_auth() {
        has_local_credentials = true;
        if auth.access_token.is_none() {
            let _ = refresh_antigravity_auth(&client, &mut auth);
        }
        match fetch_antigravity_cloud_snapshot(&client, &auth) {
            Ok(Some(snapshot)) => return Ok(snapshot),
            Err(AntigravityCloudError::Auth) => {
                if refresh_antigravity_auth(&client, &mut auth).is_ok() {
                    if let Ok(Some(snapshot)) = fetch_antigravity_cloud_snapshot(&client, &auth) {
                        return Ok(snapshot);
                    }
                }
            }
            Ok(None) | Err(AntigravityCloudError::Unavailable) => {}
        }
    }

    if !discover_antigravity_ls_processes().is_empty() {
        return Err(if has_local_credentials {
            "Agy is running, but its local session did not return usage. Check that Agy is signed in, then refresh.".to_string()
        } else {
            "Agy is running, but its session is not signed in. Sign in to Agy or Antigravity, then refresh.".to_string()
        });
    }
    Err(if has_local_credentials {
        "Antigravity usage is temporarily unavailable. Local credentials were found, but Cloud Code did not return quota data. Try again shortly.".to_string()
    } else {
        "Antigravity usage unavailable. Start `agy` or Antigravity, then refresh.".to_string()
    })
}

#[tauri::command]
async fn claude_usage() -> Result<CodexUsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(claude_usage_blocking)
        .await
        .map_err(|error| format!("Claude usage task failed: {error}"))?
}

fn claude_usage_blocking() -> Result<CodexUsageSnapshot, String> {
    let candidates = load_claude_auth_candidates();
    if candidates.is_empty() {
        return Err("Claude Code auth not found. Run `claude` to log in.".to_string());
    }
    let client = usage_client("Claude Code")?;
    let mut last_error = None;

    for mut auth in candidates {
        if !claude_can_fetch_live_usage(&auth) {
            last_error =
                Some("Re-login for live usage. Run `claude` and sign in again.".to_string());
            continue;
        }

        if claude_needs_refresh(&auth) {
            if let Err(message) = refresh_claude_token(&client, &mut auth) {
                last_error = Some(message);
                continue;
            }
        }

        match fetch_claude_usage(&client, &auth) {
            Ok(usage) => {
                return Ok(store_claude_last_good(
                    &auth,
                    build_claude_usage_snapshot(usage, &auth),
                ))
            }
            Err(CodexUsageFetchError::Auth) => {
                if let Err(message) = refresh_claude_token(&client, &mut auth) {
                    last_error = Some(message);
                    continue;
                }
                match fetch_claude_usage(&client, &auth) {
                    Ok(usage) => {
                        return Ok(store_claude_last_good(
                            &auth,
                            build_claude_usage_snapshot(usage, &auth),
                        ))
                    }
                    Err(CodexUsageFetchError::Auth) => {
                        last_error = Some(
                            "Claude Code session expired. Run `claude` to log in again."
                                .to_string(),
                        );
                    }
                    Err(CodexUsageFetchError::RateLimited(retry_after)) => {
                        return Ok(claude_rate_limited_snapshot(&auth, retry_after));
                    }
                    Err(CodexUsageFetchError::Other(message)) => last_error = Some(message),
                }
            }
            Err(CodexUsageFetchError::RateLimited(retry_after)) => {
                return Ok(claude_rate_limited_snapshot(&auth, retry_after));
            }
            Err(CodexUsageFetchError::Other(message)) => last_error = Some(message),
        }
    }

    Err(last_error.unwrap_or_else(|| {
        "Claude Code usage unavailable. Run `claude` to log in again.".to_string()
    }))
}

#[tauri::command]
async fn cursor_usage() -> Result<CodexUsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(cursor_usage_blocking)
        .await
        .map_err(|error| format!("Cursor usage task failed: {error}"))?
}

fn cursor_usage_blocking() -> Result<CodexUsageSnapshot, String> {
    let mut auth = load_cursor_auth().ok_or_else(|| {
        "Cursor auth not found. Sign in via Cursor app or run `agent login`.".to_string()
    })?;
    let client = usage_client("Cursor")?;
    let usage = match fetch_cursor_json(&client, CURSOR_USAGE_URL, &auth) {
        Ok(value) => value,
        Err(CodexUsageFetchError::Auth) => {
            refresh_cursor_token(&client, &mut auth)?;
            fetch_cursor_json(&client, CURSOR_USAGE_URL, &auth).map_err(|error| match error {
                CodexUsageFetchError::Auth => {
                    "Cursor session expired. Sign in via Cursor app or run `agent login`."
                        .to_string()
                }
                CodexUsageFetchError::RateLimited(_) => {
                    "Cursor usage is rate limited. Try again shortly.".to_string()
                }
                CodexUsageFetchError::Other(message) => message,
            })?
        }
        Err(CodexUsageFetchError::RateLimited(_)) => {
            return Err("Cursor usage is rate limited. Try again shortly.".to_string())
        }
        Err(CodexUsageFetchError::Other(message)) => return Err(message),
    };
    let plan = fetch_cursor_json(&client, CURSOR_PLAN_URL, &auth)
        .ok()
        .and_then(|value| {
            value
                .get("planInfo")
                .and_then(|info| info.get("planName"))
                .and_then(Value::as_str)
                .map(format_plan_label)
        });
    let mut snapshot = build_cursor_usage_snapshot(usage, plan)?;
    if let Ok(access_token) = cursor_access_token(&auth) {
        if let Ok(export) = fetch_cursor_usage_export(&client, &access_token, local_now()) {
            append_cursor_usage_export(&mut snapshot, &export, local_now());
        }
    }
    Ok(snapshot)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(trimmed);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", trimmed]);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(trimmed);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open link: {error}"))
}

#[derive(Debug)]
enum CodexUsageFetchError {
    Auth,
    RateLimited(Option<u64>),
    Other(String),
}

fn load_codex_auth_candidates() -> Result<Vec<CodexAuthState>, String> {
    let mut candidates = Vec::new();
    let mut api_key_auth_state: Option<CodexAuthState> = None;

    for path in codex_auth_paths()? {
        if !path.exists() {
            continue;
        }

        let text = fs::read_to_string(&path).map_err(|error| {
            format!("Failed to read Codex auth file {}: {error}", path.display())
        })?;
        if let Some(auth) = parse_codex_auth_payload(&text) {
            if has_codex_oauth_token(&auth) {
                candidates.push(CodexAuthState {
                    auth: auth.clone(),
                    source: CodexAuthSource::File(path.clone()),
                });
            }
            if has_codex_api_key(&auth) && api_key_auth_state.is_none() {
                api_key_auth_state = Some(CodexAuthState {
                    auth,
                    source: CodexAuthSource::File(path),
                });
            }
        }
    }

    if let Some(auth) = load_codex_auth_from_keychain() {
        candidates.push(CodexAuthState {
            auth,
            source: CodexAuthSource::Keychain(CODEX_KEYCHAIN_SERVICE.to_string()),
        });
    }

    if let Some(auth_state) = api_key_auth_state {
        candidates.push(auth_state);
    }

    if candidates.is_empty() {
        Err("Codex auth not found. Run `codex` to authenticate.".to_string())
    } else {
        Ok(candidates)
    }
}

fn codex_auth_paths() -> Result<Vec<PathBuf>, String> {
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let trimmed = codex_home.trim();
        if !trimmed.is_empty() {
            return Ok(vec![PathBuf::from(trimmed).join("auth.json")]);
        }
    }

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(vec![
        PathBuf::from(&home)
            .join(".config")
            .join("codex")
            .join("auth.json"),
        PathBuf::from(home).join(".codex").join("auth.json"),
    ])
}

fn load_codex_auth_from_keychain() -> Option<CodexAuthFile> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("security")
            .args(["find-generic-password", "-s", CODEX_KEYCHAIN_SERVICE, "-w"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8(output.stdout).ok()?;
        parse_codex_auth_payload(text.trim()).filter(has_codex_auth_token)
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn parse_codex_auth_payload(text: &str) -> Option<CodexAuthFile> {
    serde_json::from_str::<CodexAuthFile>(text)
        .ok()
        .or_else(|| {
            decode_hex_utf8(text)
                .and_then(|decoded| serde_json::from_str::<CodexAuthFile>(&decoded).ok())
        })
}

fn decode_hex_utf8(text: &str) -> Option<String> {
    let hex = text
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    if hex.is_empty() || hex.len() % 2 != 0 || !hex.chars().all(|char| char.is_ascii_hexdigit()) {
        return None;
    }

    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).ok())
        .collect::<Option<Vec<_>>>()?;
    String::from_utf8(bytes).ok()
}

fn has_codex_auth_token(auth: &CodexAuthFile) -> bool {
    has_codex_oauth_token(auth) || has_codex_api_key(auth)
}

fn has_codex_oauth_token(auth: &CodexAuthFile) -> bool {
    auth.tokens
        .as_ref()
        .and_then(|tokens| tokens.access_token.as_deref())
        .is_some_and(|token| !token.trim().is_empty())
}

fn has_codex_api_key(auth: &CodexAuthFile) -> bool {
    auth.openai_api_key
        .as_deref()
        .is_some_and(|token| !token.trim().is_empty())
}

fn codex_access_token(auth_state: &CodexAuthState) -> Result<String, String> {
    let Some(tokens) = auth_state.auth.tokens.as_ref() else {
        if auth_state
            .auth
            .openai_api_key
            .as_deref()
            .is_some_and(|key| !key.trim().is_empty())
        {
            return Err("Codex usage is not available for API-key auth. Run `codex` to authenticate with ChatGPT.".to_string());
        }
        return Err("Codex OAuth token missing. Run `codex` to authenticate.".to_string());
    };

    tokens
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Codex access token missing. Run `codex` to authenticate.".to_string())
}

fn codex_access_token_needs_refresh(auth_state: &CodexAuthState) -> bool {
    let Some(token) = auth_state
        .auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.access_token.as_deref())
    else {
        return false;
    };
    let Some(expires_at) = jwt_expiry_seconds(token) else {
        return false;
    };
    expires_at <= time::OffsetDateTime::now_utc().unix_timestamp() + 5 * 60
}

fn jwt_expiry_seconds(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    let payload = serde_json::from_slice::<Value>(&decoded).ok()?;
    value_to_i64(payload.get("exp"))
}

fn fetch_codex_usage(
    client: &reqwest::blocking::Client,
    auth_state: &CodexAuthState,
) -> Result<(CodexUsageEnvelope, reqwest::header::HeaderMap), CodexUsageFetchError> {
    let token = codex_access_token(auth_state).map_err(CodexUsageFetchError::Other)?;
    let mut request = client
        .get(CODEX_USAGE_URL)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json");

    if let Some(account_id) = auth_state
        .auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.account_id.as_deref())
        .map(str::trim)
        .filter(|account_id| !account_id.is_empty())
    {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request.send().map_err(|error| {
        CodexUsageFetchError::Other(format_http_send_error("Codex usage", &error))
    })?;

    let status = response.status();
    let headers = response.headers().clone();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(CodexUsageFetchError::Auth);
    }
    if !status.is_success() {
        return Err(CodexUsageFetchError::Other(format!(
            "Codex usage request failed (HTTP {})",
            status.as_u16()
        )));
    }

    response
        .json::<CodexUsageEnvelope>()
        .map(|usage| (usage, headers))
        .map_err(|error| {
            CodexUsageFetchError::Other(format!("Codex usage response invalid: {error}"))
        })
}

fn fetch_codex_reset_credits_best_effort(
    client: &reqwest::blocking::Client,
    auth_state: &CodexAuthState,
) -> Option<CodexResetCreditsEnvelope> {
    let token = codex_access_token(auth_state).ok()?;
    let mut request = client
        .get(CODEX_RESET_CREDITS_URL)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .header("OpenAI-Beta", "codex-1")
        .header("originator", "Codex Desktop");

    if let Some(account_id) = auth_state
        .auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.account_id.as_deref())
        .map(str::trim)
        .filter(|account_id| !account_id.is_empty())
    {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request.send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<CodexResetCreditsEnvelope>().ok()
}

fn refresh_codex_auth(
    client: &reqwest::blocking::Client,
    auth_state: &mut CodexAuthState,
) -> Result<(), String> {
    let source_fingerprint = codex_auth_fingerprint(auth_state);
    let refresh_token = auth_state
        .auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.refresh_token.as_deref())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Codex refresh token missing. Run `codex` to log in again.".to_string())?;

    let response = client
        .post(CODEX_REFRESH_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CODEX_CLIENT_ID),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .map_err(|error| format_http_send_error("Codex token refresh", &error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Codex token refresh failed (HTTP {}). Run `codex` to log in again.",
            response.status().as_u16()
        ));
    }

    let refreshed = response
        .json::<CodexRefreshResponse>()
        .map_err(|error| format!("Codex token refresh response invalid: {error}"))?;
    let tokens = auth_state
        .auth
        .tokens
        .as_mut()
        .ok_or_else(|| "Codex OAuth token missing. Run `codex` to authenticate.".to_string())?;

    tokens.access_token = refreshed
        .access_token
        .or_else(|| tokens.access_token.clone());
    tokens.refresh_token = refreshed
        .refresh_token
        .or_else(|| tokens.refresh_token.clone());
    tokens.id_token = refreshed.id_token.or_else(|| tokens.id_token.clone());
    auth_state.auth.last_refresh = Some(now_iso());
    save_codex_auth(auth_state, &source_fingerprint)?;
    Ok(())
}

fn reload_codex_auth_source(auth_state: &CodexAuthState) -> Result<CodexAuthState, String> {
    let auth = match &auth_state.source {
        CodexAuthSource::File(path) => {
            let text = fs::read_to_string(path).map_err(|error| {
                format!(
                    "Failed to re-read Codex auth file {}: {error}",
                    path.display()
                )
            })?;
            parse_codex_auth_payload(&text)
                .filter(has_codex_auth_token)
                .ok_or_else(|| {
                    format!(
                        "Codex auth file {} no longer contains valid credentials.",
                        path.display()
                    )
                })?
        }
        CodexAuthSource::Keychain(service) => read_keychain_password(service, None)
            .and_then(|text| parse_codex_auth_payload(&text))
            .filter(has_codex_auth_token)
            .ok_or_else(|| {
                "Codex Keychain credentials are unavailable. Run `codex` to log in again."
                    .to_string()
            })?,
    };
    Ok(CodexAuthState {
        auth,
        source: auth_state.source.clone(),
    })
}

fn save_codex_auth(
    auth_state: &CodexAuthState,
    expected_source_fingerprint: &str,
) -> Result<(), String> {
    if codex_source_fingerprint(auth_state).as_deref() != Some(expected_source_fingerprint) {
        return Err(
            "Codex credentials changed while refreshing; retry usage to use the newest login."
                .to_string(),
        );
    }
    let text = serde_json::to_string_pretty(&auth_state.auth)
        .map_err(|error| format!("Failed to encode refreshed Codex credentials: {error}"))?;
    match &auth_state.source {
        CodexAuthSource::File(path) => fs::write(path, text).map_err(|error| {
            format!(
                "Failed to save refreshed Codex credentials to {}: {error}",
                path.display()
            )
        }),
        CodexAuthSource::Keychain(service) => {
            write_keychain_password(service, &text).map_err(|error| {
                format!("Failed to save refreshed Codex Keychain credentials: {error}")
            })
        }
    }
}

fn codex_source_fingerprint(auth_state: &CodexAuthState) -> Option<String> {
    reload_codex_auth_source(auth_state)
        .ok()
        .map(|state| codex_auth_fingerprint(&state))
}

fn codex_auth_fingerprint(auth_state: &CodexAuthState) -> String {
    let mut hasher = Sha256::new();
    if let Some(tokens) = auth_state.auth.tokens.as_ref() {
        for value in [
            &tokens.access_token,
            &tokens.refresh_token,
            &tokens.account_id,
        ] {
            hasher.update(value.as_deref().unwrap_or_default().as_bytes());
            hasher.update([0]);
        }
    }
    format!("{:x}", hasher.finalize())
}

fn build_codex_usage_snapshot(
    usage: CodexUsageEnvelope,
    headers: &reqwest::header::HeaderMap,
    reset_credits: Option<&CodexResetCreditsEnvelope>,
) -> CodexUsageSnapshot {
    let mut lines = Vec::new();
    lines.extend(codex_classified_window_lines(
        usage.rate_limit.as_ref(),
        (
            read_percent_header(headers, "x-codex-primary-used-percent"),
            read_percent_header(headers, "x-codex-secondary-used-percent"),
        ),
        ("Session", "Weekly"),
    ));
    if let Some(additional_limits) = usage.additional_rate_limits.as_ref() {
        if let Some(entry) = additional_limits
            .iter()
            .find(|entry| is_codex_spark_entry(entry))
        {
            lines.extend(codex_classified_window_lines(
                entry.rate_limit.as_ref(),
                (None, None),
                ("Spark", "Spark Weekly"),
            ));
        }
    }
    if let Some(window) = usage
        .code_review_rate_limit
        .as_ref()
        .and_then(|limit| limit.primary_window.as_ref())
    {
        if let Some(value) = value_to_f64(window.used_percent.as_ref()) {
            lines.push(progress_line(
                "Reviews",
                value,
                Some(window),
                Some(7 * 24 * 60 * 60 * 1000),
            ));
        }
    }
    if let Some((available, expiries)) = read_codex_reset_credits(&usage, reset_credits) {
        lines.push(CodexMetricLine::Text {
            label: "Rate Limit Resets".to_string(),
            value: format_reset_credit_value(available, &expiries),
        });
    }
    if let Some(balance) = usage.credits.and_then(|credits| credits.balance) {
        let Some(balance) = value_to_f64(Some(&balance)) else {
            return CodexUsageSnapshot {
                provider_id: "codex".to_string(),
                display_name: "Codex".to_string(),
                plan: usage.plan_type.and_then(format_codex_plan),
                lines,
                fetched_at: now_iso(),
            };
        };
        let credits = balance.max(0.0).floor() as i64;
        lines.push(CodexMetricLine::Text {
            label: "Credits".to_string(),
            value: format!(
                "${:.2} · {} credits",
                credits as f64 * CODEX_CREDIT_USD_RATE,
                credits
            ),
        });
    }

    CodexUsageSnapshot {
        provider_id: "codex".to_string(),
        display_name: "Codex".to_string(),
        plan: usage.plan_type.and_then(format_codex_plan),
        lines,
        fetched_at: now_iso(),
    }
}

fn append_codex_local_usage(snapshot: &mut CodexUsageSnapshot, auth_state: &CodexAuthState) {
    let Some(usage) = codex_ccusage_daily(auth_state) else {
        return;
    };

    let (today_key, yesterday_key) = codex_history_day_keys(local_now());
    let today = usage
        .daily
        .iter()
        .find(|day| ccusage_day_key(&day.date).as_deref() == Some(today_key.as_str()));
    let yesterday = usage
        .daily
        .iter()
        .find(|day| ccusage_day_key(&day.date).as_deref() == Some(yesterday_key.as_str()));

    snapshot.lines.push(CodexMetricLine::Text {
        label: "Today".to_string(),
        value: format_ccusage_optional_day(today),
    });
    snapshot.lines.push(CodexMetricLine::Text {
        label: "Yesterday".to_string(),
        value: format_ccusage_optional_day(yesterday),
    });
    if let Some(latest_day) = ccusage_latest_day(&usage.daily) {
        snapshot.lines.push(CodexMetricLine::Text {
            label: "Latest Token Log".to_string(),
            value: ccusage_day_display_label(&latest_day.date),
        });
    }

    let total_tokens: f64 = usage.daily.iter().filter_map(ccusage_day_tokens).sum();
    let cost_values = usage.daily.iter().filter_map(ccusage_day_cost);
    let mut has_cost = false;
    let mut total_cost = 0.0;
    for cost in cost_values {
        has_cost = true;
        total_cost += cost;
    }
    if total_tokens > 0.0 || has_cost {
        snapshot.lines.push(CodexMetricLine::Text {
            label: "Last 30 Days".to_string(),
            value: format_cost_tokens(if has_cost { Some(total_cost) } else { None }, total_tokens),
        });
    }

    for day in ccusage_recent_days(&usage.daily, 7) {
        snapshot.lines.push(CodexMetricLine::Text {
            label: format!("Daily {}", ccusage_day_display_label(&day.date)),
            value: format_ccusage_day(Some(day)),
        });
    }

    let mut chart_points = ccusage_chart_points(&usage.daily);
    if !chart_points.is_empty() {
        if chart_points.len() > 31 {
            chart_points = chart_points.split_off(chart_points.len() - 31);
        }
        snapshot.lines.push(CodexMetricLine::BarChart {
            label: "Usage Trend".to_string(),
            points: chart_points,
            note: Some("Estimated from local Codex logs for this home.".to_string()),
            color: Some("#74AA9C".to_string()),
        });
    }

    for (model, percent) in ccusage_model_shares(&usage.daily) {
        snapshot.lines.push(CodexMetricLine::Text {
            label: model,
            value: format_percent_label(percent),
        });
    }
}

fn codex_ccusage_daily(auth_state: &CodexAuthState) -> Option<CcusageDailyUsage> {
    let key = codex_ccusage_cache_key(auth_state);
    let cache = CODEX_CCUSAGE_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(usage) = cached_codex_ccusage_usage(cache, &key) {
        return Some(usage);
    }

    let in_flight = CODEX_CCUSAGE_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()));
    let is_leader = in_flight.lock().ok()?.insert(key.clone());
    if !is_leader {
        let deadline = Instant::now() + CCUSAGE_TIMEOUT;
        loop {
            if let Some(usage) = cached_codex_ccusage_usage(cache, &key) {
                return Some(usage);
            }
            let still_running = in_flight
                .lock()
                .ok()
                .is_some_and(|guard| guard.contains(&key));
            if !still_running {
                return codex_ccusage_daily(auth_state);
            }
            if Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    let usage = (|| {
        let since = codex_ccusage_since_string(30);
        let home_path = codex_home_for_ccusage(auth_state);
        run_ccusage_codex_daily(&since, home_path.as_deref())
    })();

    let Some(usage) = usage else {
        if let Ok(mut guard) = in_flight.lock() {
            guard.remove(&key);
        }
        return None;
    };
    publish_codex_ccusage_usage(cache, in_flight, key, &usage);
    Some(usage)
}

fn cached_codex_ccusage_usage(
    cache: &Mutex<Option<CcusageCacheEntry>>,
    key: &str,
) -> Option<CcusageDailyUsage> {
    cache
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .filter(|entry| entry.key == key && entry.fetched_at.elapsed() < CCUSAGE_CACHE_TTL)
                .cloned()
        })
        .map(|entry| entry.usage)
}

fn publish_codex_ccusage_usage(
    cache: &Mutex<Option<CcusageCacheEntry>>,
    in_flight: &Mutex<HashSet<String>>,
    key: String,
    usage: &CcusageDailyUsage,
) {
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CcusageCacheEntry {
            key: key.clone(),
            fetched_at: Instant::now(),
            usage: usage.clone(),
        });
    }
    if let Ok(mut guard) = in_flight.lock() {
        guard.remove(&key);
    }
}

fn codex_ccusage_cache_key(auth_state: &CodexAuthState) -> String {
    let home = codex_home_for_ccusage(auth_state).unwrap_or_else(|| "default".to_string());
    let account = auth_state
        .auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.account_id.as_deref())
        .map(str::trim)
        .filter(|account| !account.is_empty())
        .unwrap_or("unresolved");
    format!("{home}\u{0}{account}")
}

fn codex_home_for_ccusage(auth_state: &CodexAuthState) -> Option<String> {
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let trimmed = codex_home.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    match &auth_state.source {
        CodexAuthSource::File(path) => path.parent().map(|path| path.to_string_lossy().to_string()),
        CodexAuthSource::Keychain(_) => None,
    }
}

fn run_ccusage_codex_daily(since: &str, codex_home: Option<&str>) -> Option<CcusageDailyUsage> {
    for runner in ccusage_runners(since) {
        let child_result = Command::new(&runner.program)
            .args(&runner.args)
            .env("PATH", enriched_cli_path())
            .envs(codex_home.map(|home| ("CODEX_HOME", home)))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let Ok(mut child) = child_result else {
            continue;
        };
        let deadline = Instant::now() + CCUSAGE_TIMEOUT;
        loop {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            thread::sleep(Duration::from_millis(100));
        }

        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut pipe) = child.stdout.take() {
            let _ = pipe.read_to_string(&mut stdout);
        }
        if let Some(mut pipe) = child.stderr.take() {
            let _ = pipe.read_to_string(&mut stderr);
        }
        let Ok(status) = child.wait() else {
            continue;
        };
        if !status.success() {
            let _ = stderr;
            continue;
        }
        if let Some(usage) = parse_ccusage_output(&stdout) {
            return Some(usage);
        }
    }
    None
}

struct CcusageRunnerCommand {
    program: String,
    args: Vec<String>,
}

fn ccusage_runners(since: &str) -> Vec<CcusageRunnerCommand> {
    let suffix = vec![
        "codex".to_string(),
        "daily".to_string(),
        "--json".to_string(),
        "--order".to_string(),
        "desc".to_string(),
        "--since".to_string(),
        since.to_string(),
    ];
    let mut runners = Vec::new();
    if let Some(program) = first_existing_command(&[
        home_join(".bun/bin/bunx"),
        Some("/opt/homebrew/bin/bunx".into()),
        Some("/usr/local/bin/bunx".into()),
        Some("bunx".into()),
    ]) {
        runners.push(CcusageRunnerCommand {
            program,
            args: [
                vec!["--silent".to_string(), CCUSAGE_PACKAGE.to_string()],
                suffix.clone(),
            ]
            .concat(),
        });
    }
    if let Some(program) = first_existing_command(&[
        Some("/opt/homebrew/bin/pnpm".into()),
        Some("/usr/local/bin/pnpm".into()),
        Some("pnpm".into()),
    ]) {
        runners.push(CcusageRunnerCommand {
            program,
            args: [
                vec![
                    "-s".to_string(),
                    "dlx".to_string(),
                    CCUSAGE_PACKAGE.to_string(),
                ],
                suffix.clone(),
            ]
            .concat(),
        });
    }
    if let Some(program) = first_existing_command(&[
        Some("/opt/homebrew/bin/yarn".into()),
        Some("/usr/local/bin/yarn".into()),
        Some("yarn".into()),
    ]) {
        runners.push(CcusageRunnerCommand {
            program,
            args: [
                vec![
                    "dlx".to_string(),
                    "-q".to_string(),
                    CCUSAGE_PACKAGE.to_string(),
                ],
                suffix.clone(),
            ]
            .concat(),
        });
    }
    if let Some(program) = first_existing_command(&[
        Some("/opt/homebrew/bin/npm".into()),
        Some("/usr/local/bin/npm".into()),
        Some("npm".into()),
    ]) {
        runners.push(CcusageRunnerCommand {
            program,
            args: [
                vec![
                    "exec".to_string(),
                    "--yes".to_string(),
                    format!("--package={CCUSAGE_PACKAGE}"),
                    "--".to_string(),
                    "ccusage".to_string(),
                ],
                suffix.clone(),
            ]
            .concat(),
        });
    }
    if let Some(program) = first_existing_command(&[
        Some("/opt/homebrew/bin/npx".into()),
        Some("/usr/local/bin/npx".into()),
        Some("npx".into()),
    ]) {
        runners.push(CcusageRunnerCommand {
            program,
            args: [
                vec!["--yes".to_string(), CCUSAGE_PACKAGE.to_string()],
                suffix,
            ]
            .concat(),
        });
    }
    runners
}

fn parse_ccusage_output(stdout: &str) -> Option<CcusageDailyUsage> {
    serde_json::from_str::<CcusageDailyUsage>(stdout)
        .ok()
        .or_else(|| {
            let start = stdout.find('{')?;
            serde_json::from_str::<CcusageDailyUsage>(&stdout[start..]).ok()
        })
}

fn first_existing_command(candidates: &[Option<String>]) -> Option<String> {
    for candidate in candidates.iter().flatten() {
        if candidate.contains('/') {
            if Path::new(candidate).is_file() {
                return Some(candidate.clone());
            }
        } else {
            return Some(candidate.clone());
        }
    }
    None
}

fn home_join(relative: &str) -> Option<String> {
    home_dir().map(|home| home.join(relative).to_string_lossy().to_string())
}

fn enriched_cli_path() -> String {
    let mut entries = Vec::new();
    if let Some(home) = home_dir() {
        entries.push(home.join(".bun/bin").to_string_lossy().to_string());
        entries.push(home.join(".nvm/current/bin").to_string_lossy().to_string());
        entries.push(home.join(".local/bin").to_string_lossy().to_string());
    }
    entries.push("/opt/homebrew/bin".to_string());
    entries.push("/usr/local/bin".to_string());
    if let Ok(path) = std::env::var("PATH") {
        entries.extend(path.split(':').map(ToOwned::to_owned));
    }
    let mut seen = BTreeMap::new();
    entries
        .into_iter()
        .filter(|entry| !entry.is_empty())
        .filter(|entry| seen.insert(entry.clone(), ()).is_none())
        .collect::<Vec<_>>()
        .join(":")
}

fn codex_ccusage_since_string(days_back: i64) -> String {
    codex_ccusage_since_string_at(local_now(), days_back)
}

fn codex_ccusage_since_string_at(now: time::OffsetDateTime, days_back: i64) -> String {
    let since = now - time::Duration::days(days_back);
    format!(
        "{:04}{:02}{:02}",
        since.year(),
        u8::from(since.month()),
        since.day()
    )
}

fn local_now() -> time::OffsetDateTime {
    let now = time::OffsetDateTime::now_utc();
    time::UtcOffset::current_local_offset()
        .map(|offset| now.to_offset(offset))
        .unwrap_or(now)
}

fn codex_history_day_keys(now: time::OffsetDateTime) -> (String, String) {
    (
        local_day_key(now),
        local_day_key(now - time::Duration::days(1)),
    )
}

fn local_day_key(date: time::OffsetDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

fn ccusage_day_key(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.len() >= 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
    {
        return Some(value[..10].to_string());
    }
    if value.len() == 8 && value.chars().all(|ch| ch.is_ascii_digit()) {
        return Some(format!("{}-{}-{}", &value[..4], &value[4..6], &value[6..8]));
    }
    None
}

fn ccusage_day_tokens(day: &CcusageDay) -> Option<f64> {
    value_to_f64(day.total_tokens.as_ref()).filter(|value| *value >= 0.0)
}

fn ccusage_day_cost(day: &CcusageDay) -> Option<f64> {
    value_to_f64(day.cost_usd.as_ref())
        .or_else(|| value_to_f64(day.total_cost.as_ref()))
        .filter(|value| value.is_finite())
}

fn format_ccusage_day(day: Option<&CcusageDay>) -> String {
    let tokens = day.and_then(ccusage_day_tokens).unwrap_or(0.0);
    let cost = day.and_then(ccusage_day_cost).or(Some(0.0));
    format_cost_tokens(cost, tokens)
}

fn format_ccusage_optional_day(day: Option<&CcusageDay>) -> String {
    day.map(|day| format_ccusage_day(Some(day)))
        .unwrap_or_else(|| "No local token log".to_string())
}

fn format_cost_tokens(cost: Option<f64>, tokens: f64) -> String {
    let mut parts = Vec::new();
    if let Some(cost) = cost {
        parts.push(format!("${:.2}", cost.max(0.0)));
    }
    parts.push(format!("{} tokens", format_compact_number(tokens)));
    parts.join(" · ")
}

fn format_compact_number(value: f64) -> String {
    let abs = value.abs();
    let (divisor, suffix) = if abs >= 1_000_000_000.0 {
        (1_000_000_000.0, "B")
    } else if abs >= 1_000_000.0 {
        (1_000_000.0, "M")
    } else if abs >= 1_000.0 {
        (1_000.0, "K")
    } else {
        return format!("{}", value.round() as i64);
    };
    let scaled = value / divisor;
    if scaled.abs() >= 10.0 {
        format!("{}{suffix}", scaled.round() as i64)
    } else {
        format!("{:.1}{suffix}", scaled).replace(".0", "")
    }
}

fn ccusage_chart_points(days: &[CcusageDay]) -> Vec<CodexBarChartPoint> {
    let mut points = days
        .iter()
        .filter_map(|day| {
            let key = ccusage_day_key(&day.date)?;
            let value = ccusage_day_tokens(day)?;
            Some((key, value))
        })
        .collect::<Vec<_>>();
    points.sort_by(|a, b| a.0.cmp(&b.0));
    points
        .into_iter()
        .map(|(key, value)| CodexBarChartPoint {
            label: format!(
                "{}/{}",
                key[5..7].trim_start_matches('0'),
                key[8..10].trim_start_matches('0')
            ),
            value,
            value_label: format!("{} tokens", format_compact_number(value)),
        })
        .collect()
}

fn ccusage_recent_days(days: &[CcusageDay], limit: usize) -> Vec<&CcusageDay> {
    let mut keyed = days
        .iter()
        .filter_map(|day| ccusage_day_key(&day.date).map(|key| (key, day)))
        .collect::<Vec<_>>();
    keyed.sort_by(|a, b| b.0.cmp(&a.0));
    keyed.into_iter().take(limit).map(|(_, day)| day).collect()
}

fn ccusage_latest_day(days: &[CcusageDay]) -> Option<&CcusageDay> {
    ccusage_recent_days(days, 1).into_iter().next()
}

fn ccusage_day_display_label(raw: &str) -> String {
    ccusage_day_key(raw)
        .map(|key| {
            format!(
                "{}/{}",
                key[5..7].trim_start_matches('0'),
                key[8..10].trim_start_matches('0')
            )
        })
        .unwrap_or_else(|| raw.to_string())
}

fn ccusage_model_shares(days: &[CcusageDay]) -> Vec<(String, f64)> {
    let mut totals: BTreeMap<String, f64> = BTreeMap::new();
    let mut total_tokens = 0.0;
    for day in days {
        if let Some(models) = &day.models {
            for (name, usage) in models {
                let tokens = ccusage_model_tokens(usage);
                if tokens <= 0.0 {
                    continue;
                }
                *totals.entry(name.clone()).or_default() += tokens;
                total_tokens += tokens;
            }
        }
        if let Some(breakdowns) = &day.model_breakdowns {
            for breakdown in breakdowns {
                let name = maybe_string(breakdown.get("modelName"))
                    .or_else(|| maybe_string(breakdown.get("name")))
                    .or_else(|| maybe_string(breakdown.get("model")));
                let Some(name) = name else {
                    continue;
                };
                let tokens = ccusage_model_tokens_from_value(breakdown);
                if tokens <= 0.0 {
                    continue;
                }
                *totals.entry(name).or_default() += tokens;
                total_tokens += tokens;
            }
        }
    }
    if total_tokens <= 0.0 {
        return Vec::new();
    }
    let mut shares = totals
        .into_iter()
        .map(|(name, tokens)| (name, (tokens / total_tokens) * 100.0))
        .collect::<Vec<_>>();
    shares.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    shares.truncate(5);
    shares
}

fn ccusage_model_tokens(usage: &CcusageModelUsage) -> f64 {
    value_to_f64(usage.total_tokens.as_ref()).unwrap_or_else(|| {
        [
            usage.input_tokens.as_ref(),
            usage.cached_input_tokens.as_ref(),
            usage.cache_creation_tokens.as_ref(),
            usage.cache_read_tokens.as_ref(),
            usage.output_tokens.as_ref(),
            usage.reasoning_output_tokens.as_ref(),
        ]
        .into_iter()
        .flatten()
        .filter_map(|value| value_to_f64(Some(value)))
        .sum()
    })
}

fn ccusage_model_tokens_from_value(value: &Value) -> f64 {
    value_to_f64(value.get("totalTokens")).unwrap_or_else(|| {
        [
            "inputTokens",
            "cachedInputTokens",
            "cacheCreationTokens",
            "cacheReadTokens",
            "outputTokens",
            "reasoningOutputTokens",
        ]
        .into_iter()
        .filter_map(|key| value_to_f64(value.get(key)))
        .sum()
    })
}

fn format_percent_label(percent: f64) -> String {
    if percent > 0.0 && percent < 0.1 {
        return "<0.1%".to_string();
    }
    let rounded = (percent * 10.0).round() / 10.0;
    if (rounded.fract()).abs() < f64::EPSILON {
        format!("{}%", rounded as i64)
    } else {
        format!("{rounded:.1}%")
    }
}

fn read_codex_reset_credits(
    usage: &CodexUsageEnvelope,
    dedicated: Option<&CodexResetCreditsEnvelope>,
) -> Option<(i64, Vec<time::OffsetDateTime>)> {
    let dedicated_count = dedicated
        .and_then(|credits| credits.available_count.as_ref())
        .and_then(|value| value_to_f64(Some(value)));
    let embedded_count = usage
        .rate_limit_reset_credits
        .as_ref()
        .and_then(|credits| credits.available_count.as_ref())
        .and_then(|value| value_to_f64(Some(value)));
    let count = dedicated_count.or(embedded_count)?.max(0.0).floor() as i64;
    let expiries = dedicated
        .and_then(|credits| credits.credits.as_ref())
        .map(|credits| {
            let mut expiries = credits
                .iter()
                .filter(|credit| {
                    credit
                        .status
                        .as_deref()
                        .map(|status| status.eq_ignore_ascii_case("available"))
                        .unwrap_or(true)
                })
                .filter_map(|credit| parse_reset_credit_expiry(credit.expires_at.as_ref()))
                .collect::<Vec<_>>();
            expiries.sort();
            expiries
        })
        .unwrap_or_default();
    Some((count, expiries))
}

fn parse_reset_credit_expiry(value: Option<&Value>) -> Option<time::OffsetDateTime> {
    match value? {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|value| value as i64))
            .and_then(|seconds| time::OffsetDateTime::from_unix_timestamp(seconds).ok()),
        Value::String(text) => {
            time::OffsetDateTime::parse(text.trim(), &time::format_description::well_known::Rfc3339)
                .ok()
        }
        _ => None,
    }
}

fn format_reset_credit_value(count: i64, expiries: &[time::OffsetDateTime]) -> String {
    let base = format!("{count} available");
    let Some(first_expiry) = expiries.first() else {
        return base;
    };
    format!("{base} · expires {}", format_relative_time(*first_expiry))
}

fn format_relative_time(target: time::OffsetDateTime) -> String {
    let seconds = target.unix_timestamp() - time::OffsetDateTime::now_utc().unix_timestamp();
    let abs = seconds.unsigned_abs();
    let (value, unit) = if abs >= 86_400 {
        ((abs as f64 / 86_400.0).ceil() as u64, "d")
    } else if abs >= 3_600 {
        ((abs as f64 / 3_600.0).ceil() as u64, "h")
    } else {
        ((abs as f64 / 60.0).ceil().max(1.0) as u64, "m")
    };
    if seconds >= 0 {
        format!("in {value}{unit}")
    } else {
        format!("{value}{unit} ago")
    }
}

fn is_codex_spark_entry(entry: &CodexAdditionalRateLimit) -> bool {
    [
        entry.limit_name.as_deref(),
        entry.metered_feature.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .any(|value| value.to_ascii_lowercase().contains("spark"))
}

fn codex_window_kind(window: Option<&CodexRateLimitWindow>) -> Option<CodexWindowKind> {
    match value_to_u64(window?.limit_window_seconds.as_ref())? {
        18_000 => Some(CodexWindowKind::Session),
        604_800 => Some(CodexWindowKind::Weekly),
        _ => None,
    }
}

fn codex_classified_window_lines(
    rate_limit: Option<&CodexRateLimit>,
    header_percents: (Option<f64>, Option<f64>),
    labels: (&str, &str),
) -> Vec<CodexMetricLine> {
    let mut candidates = Vec::new();
    if let Some(rate_limit) = rate_limit {
        let primary_window = rate_limit.primary_window.as_ref();
        if primary_window.is_some() || header_percents.0.is_some() {
            candidates.push(CodexWindowCandidate {
                window: primary_window,
                header_percent: header_percents.0,
                fallback_kind: CodexWindowKind::Session,
            });
        }
        let secondary_window = rate_limit.secondary_window.as_ref();
        if secondary_window.is_some() || header_percents.1.is_some() {
            candidates.push(CodexWindowCandidate {
                window: secondary_window,
                header_percent: header_percents.1,
                fallback_kind: CodexWindowKind::Weekly,
            });
        }
    } else {
        if header_percents.0.is_some() {
            candidates.push(CodexWindowCandidate {
                window: None,
                header_percent: header_percents.0,
                fallback_kind: CodexWindowKind::Session,
            });
        }
        if header_percents.1.is_some() {
            candidates.push(CodexWindowCandidate {
                window: None,
                header_percent: header_percents.1,
                fallback_kind: CodexWindowKind::Weekly,
            });
        }
    }

    [
        (CodexWindowKind::Session, labels.0, 5 * 60 * 60 * 1000),
        (CodexWindowKind::Weekly, labels.1, 7 * 24 * 60 * 60 * 1000),
    ]
    .into_iter()
    .filter_map(|(kind, label, fallback_duration_ms)| {
        let candidate = candidates
            .iter()
            .find(|candidate| codex_window_kind(candidate.window) == Some(kind))
            .or_else(|| {
                candidates.iter().find(|candidate| {
                    codex_window_kind(candidate.window).is_none() && candidate.fallback_kind == kind
                })
            })?;
        let used = candidate.header_percent.or_else(|| {
            candidate
                .window
                .and_then(|window| value_to_f64(window.used_percent.as_ref()))
        })?;
        Some(progress_line(
            label,
            used,
            candidate.window,
            Some(fallback_duration_ms),
        ))
    })
    .collect()
}

fn progress_line(
    label: &str,
    used: f64,
    window: Option<&CodexRateLimitWindow>,
    fallback_duration_ms: Option<u64>,
) -> CodexMetricLine {
    let period_duration_ms = window
        .and_then(|window| value_to_u64(window.limit_window_seconds.as_ref()))
        .map(|seconds| seconds * 1000)
        .or(fallback_duration_ms);
    let reset_at = window.and_then(rate_limit_reset_iso);
    let used = normalize_fresh_rate_limit_used(used, window, period_duration_ms);

    CodexMetricLine::Progress {
        label: label.to_string(),
        used: used.clamp(0.0, 100.0),
        limit: 100.0,
        format: CodexProgressFormat::Percent,
        resets_at: reset_at,
        period_duration_ms,
    }
}

fn rate_limit_reset_iso(window: &CodexRateLimitWindow) -> Option<String> {
    if let Some(seconds) = value_to_i64(window.reset_at.as_ref()) {
        return unix_seconds_to_iso(seconds);
    }
    let reset_after = value_to_i64(window.reset_after_seconds.as_ref())?;
    unix_seconds_to_iso(time::OffsetDateTime::now_utc().unix_timestamp() + reset_after)
}

fn normalize_fresh_rate_limit_used(
    used: f64,
    window: Option<&CodexRateLimitWindow>,
    period_duration_ms: Option<u64>,
) -> f64 {
    if used > 1.0 {
        return used;
    }
    let Some(window) = window else { return used };
    let Some(period_ms) = period_duration_ms else {
        return used;
    };
    let Some(reset_after_seconds) = rate_limit_reset_after_seconds(window) else {
        return used;
    };
    let period_seconds = (period_ms / 1000) as i64;
    if period_seconds > 0 && reset_after_seconds >= period_seconds.saturating_sub(60) {
        0.0
    } else {
        used
    }
}

fn rate_limit_reset_after_seconds(window: &CodexRateLimitWindow) -> Option<i64> {
    if let Some(value) = value_to_i64(window.reset_after_seconds.as_ref()) {
        return Some(value);
    }
    value_to_i64(window.reset_at.as_ref())
        .map(|reset_at| reset_at - time::OffsetDateTime::now_utc().unix_timestamp())
}

fn value_to_f64(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

fn value_to_i64(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|value| value as i64)),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_f64().map(|value| value as u64)),
        Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn usage_client(provider: &str) -> Result<reqwest::blocking::Client, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Agent Halo");

    if let Some(proxy_url) = openusage_proxy_url() {
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|error| format!("Invalid OpenUsage proxy config: {error}"))?;
        let no_proxy = reqwest::NoProxy::from_string("localhost,127.0.0.1,::1");
        builder = builder.proxy(proxy.no_proxy(no_proxy));
    }

    builder
        .build()
        .map_err(|error| format!("Failed to create {provider} usage client: {error}"))
}

fn openusage_proxy_url() -> Option<String> {
    static OPENUSAGE_PROXY_URL: OnceLock<Option<String>> = OnceLock::new();
    OPENUSAGE_PROXY_URL
        .get_or_init(|| {
            let path = home_path(OPENUSAGE_PROXY_CONFIG_PATH)?;
            let text = fs::read_to_string(path).ok()?;
            let config = serde_json::from_str::<OpenUsageProxyConfigFile>(&text).ok()?;
            let proxy = config.proxy?;
            if proxy.enabled != Some(true) {
                return None;
            }
            let url = proxy.url?.trim().to_string();
            if is_supported_proxy_url(&url) {
                Some(url)
            } else {
                None
            }
        })
        .clone()
}

fn is_supported_proxy_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("socks5://") || lower.starts_with("http://") || lower.starts_with("https://")
}

fn format_http_send_error(label: &str, error: &reqwest::Error) -> String {
    let mut message = format!("{label} request failed: {error}");
    if let Some(source) = error.source() {
        message.push_str(&format!(" ({source})"));
    }
    if error.is_connect() && openusage_proxy_url().is_none() {
        message.push_str(
            ". If this network needs a proxy, add ~/.openusage/config.json with proxy.enabled and proxy.url.",
        );
    }
    message
}

fn read_keychain_password(service: &str, account: Option<&str>) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let mut args = vec!["find-generic-password", "-s", service];
        if let Some(account) = account {
            args.push("-a");
            args.push(account);
        }
        args.push("-w");
        let output = Command::new("security").args(args).output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8(output.stdout)
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (service, account);
        None
    }
}

fn write_keychain_password(service: &str, value: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let account = keychain_account_for_service(service)?;
        set_generic_password(service, &account, value.as_bytes())
            .map_err(|error| format!("Keychain update failed: {error}"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (service, value);
        Err("Keychain writes require macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
fn keychain_account_for_service(service: &str) -> Result<String, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", service])
        .output()
        .map_err(|error| format!("could not inspect Keychain item: {error}"))?;
    if !output.status.success() {
        return Err(
            "Keychain item is unavailable; run the provider CLI to log in again.".to_string(),
        );
    }
    let metadata = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    metadata
        .lines()
        .find_map(|line| line.trim().strip_prefix("\"acct\"<blob>=\""))
        .and_then(|value| value.strip_suffix('"'))
        .filter(|account| !account.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            "Keychain item account is unavailable; refusing to overwrite credentials.".to_string()
        })
}

fn parse_json_or_hex<T: for<'de> Deserialize<'de>>(text: &str) -> Option<T> {
    if let Ok(value) = serde_json::from_str::<T>(text) {
        return Some(value);
    }
    let mut hex = text.trim();
    if let Some(stripped) = hex.strip_prefix("0x").or_else(|| hex.strip_prefix("0X")) {
        hex = stripped;
    }
    if hex.is_empty() || hex.len() % 2 != 0 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).ok())
        .collect::<Option<Vec<_>>>()?;
    let decoded = String::from_utf8(bytes).ok()?;
    serde_json::from_str::<T>(&decoded).ok()
}

fn home_path(relative: &str) -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(relative))
}

fn maybe_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn format_plan_label(value: &str) -> String {
    value
        .split(['_', '-', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn dollars_from_cents(cents: f64) -> String {
    format!("${:.2}", cents / 100.0)
}

fn progress_metric(
    label: &str,
    used: f64,
    resets_at: Option<String>,
    period_duration_ms: Option<u64>,
) -> CodexMetricLine {
    CodexMetricLine::Progress {
        label: label.to_string(),
        used: used.clamp(0.0, 100.0),
        limit: 100.0,
        format: CodexProgressFormat::Percent,
        resets_at,
        period_duration_ms,
    }
}

fn load_claude_auth_candidates() -> Vec<ClaudeAuthState> {
    let oauth_config = claude_oauth_config();
    claude_auth_candidates_from(
        load_stored_claude_auths(&oauth_config),
        env_text("CLAUDE_CODE_OAUTH_TOKEN"),
        oauth_config,
    )
}

fn claude_auth_candidates_from(
    mut candidates: Vec<ClaudeAuthState>,
    env_access_token: Option<String>,
    oauth_config: ClaudeOauthConfig,
) -> Vec<ClaudeAuthState> {
    if let Some(env_access_token) = env_access_token {
        let mut credentials = ClaudeCredentialsFile {
            claude_ai_oauth: Some(ClaudeOauth {
                access_token: None,
                refresh_token: None,
                expires_at: None,
                subscription_type: None,
                rate_limit_tier: None,
                scopes: None,
            }),
        };
        if let Some(oauth) = credentials.claude_ai_oauth.as_mut() {
            oauth.access_token = Some(env_access_token);
        }
        candidates.push(ClaudeAuthState {
            credentials,
            service_name: None,
            file_path: None,
            inference_only: true,
            oauth_config,
        });
    }
    candidates
}

fn load_stored_claude_auths(oauth_config: &ClaudeOauthConfig) -> Vec<ClaudeAuthState> {
    let mut candidates = load_claude_keychain_auths(oauth_config);
    if let Some(file_auth) = load_claude_file_auth(oauth_config) {
        candidates.push(file_auth);
    }
    candidates
}

fn load_claude_keychain_auths(oauth_config: &ClaudeOauthConfig) -> Vec<ClaudeAuthState> {
    let mut candidates = Vec::new();
    for service in claude_keychain_service_candidates(oauth_config) {
        let Some(text) = read_keychain_password(&service, None) else {
            continue;
        };
        let Some(credentials) = parse_json_or_hex::<ClaudeCredentialsFile>(&text) else {
            continue;
        };
        if !claude_credentials_have_access_token(&credentials) {
            continue;
        }
        candidates.push(ClaudeAuthState {
            credentials,
            service_name: Some(service),
            file_path: None,
            inference_only: false,
            oauth_config: oauth_config.clone(),
        });
    }
    candidates
}

fn load_claude_file_auth(oauth_config: &ClaudeOauthConfig) -> Option<ClaudeAuthState> {
    let path = claude_credentials_path()?;
    let text = fs::read_to_string(&path).ok()?;
    let credentials = parse_json_or_hex::<ClaudeCredentialsFile>(&text)?;
    if !claude_credentials_have_access_token(&credentials) {
        return None;
    }
    Some(ClaudeAuthState {
        credentials,
        service_name: None,
        file_path: Some(path),
        inference_only: false,
        oauth_config: oauth_config.clone(),
    })
}

fn claude_credentials_have_access_token(credentials: &ClaudeCredentialsFile) -> bool {
    credentials
        .claude_ai_oauth
        .as_ref()
        .and_then(|oauth| oauth.access_token.as_deref())
        .map(str::trim)
        .is_some_and(|token| !token.is_empty())
}

fn claude_oauth_config() -> ClaudeOauthConfig {
    let mut base_api = CLAUDE_USAGE_URL
        .strip_suffix("/api/oauth/usage")
        .unwrap_or("https://api.anthropic.com")
        .to_string();
    let mut refresh_url = CLAUDE_REFRESH_URL.to_string();
    let mut client_id = CLAUDE_CLIENT_ID.to_string();
    let mut oauth_file_suffix = String::new();

    let is_ant_user = env_text("USER_TYPE").as_deref() == Some("ant");
    if is_ant_user && env_flag("USE_LOCAL_OAUTH") {
        base_api = env_text("CLAUDE_LOCAL_OAUTH_API_BASE")
            .unwrap_or_else(|| "http://localhost:8000".to_string())
            .trim_end_matches('/')
            .to_string();
        refresh_url = format!("{base_api}/v1/oauth/token");
        client_id = CLAUDE_NON_PROD_CLIENT_ID.to_string();
        oauth_file_suffix = "-local-oauth".to_string();
    } else if is_ant_user && env_flag("USE_STAGING_OAUTH") {
        base_api = "https://api-staging.anthropic.com".to_string();
        refresh_url = "https://platform.staging.ant.dev/v1/oauth/token".to_string();
        client_id = CLAUDE_NON_PROD_CLIENT_ID.to_string();
        oauth_file_suffix = "-staging-oauth".to_string();
    }

    if let Some(custom) = env_text("CLAUDE_CODE_CUSTOM_OAUTH_URL") {
        base_api = custom.trim_end_matches('/').to_string();
        refresh_url = format!("{base_api}/v1/oauth/token");
        oauth_file_suffix = "-custom-oauth".to_string();
    }
    if let Some(override_client_id) = env_text("CLAUDE_CODE_OAUTH_CLIENT_ID") {
        client_id = override_client_id;
    }

    ClaudeOauthConfig {
        usage_url: format!("{base_api}/api/oauth/usage"),
        refresh_url,
        client_id,
        oauth_file_suffix,
    }
}

fn claude_keychain_service_candidates(oauth_config: &ClaudeOauthConfig) -> Vec<String> {
    let base = format!(
        "{}{}-credentials",
        CLAUDE_KEYCHAIN_SERVICE_PREFIX, oauth_config.oauth_file_suffix
    );
    let mut candidates = Vec::new();
    if let Some(config_dir) = env_text("CLAUDE_CONFIG_DIR") {
        let mut hasher = Sha256::new();
        hasher.update(config_dir.as_bytes());
        let digest = format!("{:x}", hasher.finalize());
        candidates.push(format!("{}-{}", base, &digest[..8]));
    }
    candidates.push(base);
    candidates
}

fn claude_credentials_path() -> Option<PathBuf> {
    if let Some(config_dir) = env_text("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(config_dir).join(CLAUDE_CREDENTIALS_FILE));
    }
    home_dir().map(|home| home.join(CLAUDE_DEFAULT_HOME).join(CLAUDE_CREDENTIALS_FILE))
}

fn env_text(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_flag(name: &str) -> bool {
    env_text(name)
        .map(|value| {
            !matches!(
                value.to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(false)
}

fn claude_access_token(auth: &ClaudeAuthState) -> Result<String, String> {
    auth.credentials
        .claude_ai_oauth
        .as_ref()
        .and_then(|oauth| oauth.access_token.as_deref())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Claude Code access token missing. Run `claude` to log in.".to_string())
}

fn claude_can_fetch_live_usage(auth: &ClaudeAuthState) -> bool {
    if auth.inference_only {
        return false;
    }
    let Some(scopes) = auth
        .credentials
        .claude_ai_oauth
        .as_ref()
        .and_then(|oauth| oauth.scopes.as_ref())
    else {
        return true;
    };
    scopes.is_empty() || scopes.iter().any(|scope| scope == "user:profile")
}

fn claude_needs_refresh(auth: &ClaudeAuthState) -> bool {
    let Some(expires_at) = auth
        .credentials
        .claude_ai_oauth
        .as_ref()
        .and_then(|oauth| oauth.expires_at)
    else {
        return false;
    };
    let now_ms = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
    expires_at - now_ms <= CLAUDE_REFRESH_BUFFER_MS
}

fn fetch_claude_usage(
    client: &reqwest::blocking::Client,
    auth: &ClaudeAuthState,
) -> Result<Value, CodexUsageFetchError> {
    let response = client
        .get(&auth.oauth_config.usage_url)
        .bearer_auth(claude_access_token(auth).map_err(CodexUsageFetchError::Other)?)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header(reqwest::header::USER_AGENT, "claude-code/2.1.69")
        .send()
        .map_err(|error| {
            CodexUsageFetchError::Other(format_http_send_error("Claude Code usage", &error))
        })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CodexUsageFetchError::Auth);
    }
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(CodexUsageFetchError::RateLimited(read_retry_after_seconds(
            response.headers(),
        )));
    }
    if !response.status().is_success() {
        return Err(CodexUsageFetchError::Other(format!(
            "Claude Code usage request failed (HTTP {})",
            response.status().as_u16()
        )));
    }
    response.json::<Value>().map_err(|error| {
        CodexUsageFetchError::Other(format!("Claude Code usage response invalid: {error}"))
    })
}

fn read_retry_after_seconds(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn refresh_claude_token(
    client: &reqwest::blocking::Client,
    auth: &mut ClaudeAuthState,
) -> Result<(), String> {
    *auth = reload_claude_auth_source(auth)?;
    let source_fingerprint = claude_auth_fingerprint(auth);
    let oauth = auth
        .credentials
        .claude_ai_oauth
        .as_mut()
        .ok_or_else(|| "Claude Code OAuth data missing. Run `claude` to log in.".to_string())?;
    let refresh_token = oauth
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            "Claude Code refresh token missing. Run `claude` to log in again.".to_string()
        })?;
    let response = client
        .post(&auth.oauth_config.refresh_url)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": auth.oauth_config.client_id,
            "scope": CLAUDE_SCOPES,
        }))
        .send()
        .map_err(|error| format_http_send_error("Claude Code token refresh", &error))?;
    if !response.status().is_success() {
        return Err(format!(
            "Claude Code token refresh failed (HTTP {})",
            response.status().as_u16()
        ));
    }
    let refreshed = response
        .json::<OAuthRefreshResponse>()
        .map_err(|error| format!("Claude Code token refresh response invalid: {error}"))?;
    oauth.access_token = refreshed
        .access_token
        .or_else(|| oauth.access_token.clone());
    oauth.refresh_token = refreshed
        .refresh_token
        .or_else(|| oauth.refresh_token.clone());
    if let Some(expires_in) = refreshed.expires_in {
        oauth.expires_at =
            Some((time::OffsetDateTime::now_utc().unix_timestamp() + expires_in) * 1000);
    }
    save_claude_auth(auth, &source_fingerprint)?;
    Ok(())
}

fn reload_claude_auth_source(auth: &ClaudeAuthState) -> Result<ClaudeAuthState, String> {
    let credentials = if let Some(path) = &auth.file_path {
        let text = fs::read_to_string(path).map_err(|error| {
            format!(
                "Failed to re-read Claude Code credentials {}: {error}",
                path.display()
            )
        })?;
        parse_json_or_hex::<ClaudeCredentialsFile>(&text)
            .filter(claude_credentials_have_access_token)
            .ok_or_else(|| {
                format!(
                    "Claude Code credentials {} no longer contain a valid access token.",
                    path.display()
                )
            })?
    } else if let Some(service) = &auth.service_name {
        read_keychain_password(service, None)
            .and_then(|text| parse_json_or_hex::<ClaudeCredentialsFile>(&text))
            .filter(claude_credentials_have_access_token)
            .ok_or_else(|| {
                "Claude Code Keychain credentials are unavailable. Run `claude` to log in again."
                    .to_string()
            })?
    } else {
        return Err(
            "Claude Code environment token cannot be refreshed for live usage.".to_string(),
        );
    };

    Ok(ClaudeAuthState {
        credentials,
        service_name: auth.service_name.clone(),
        file_path: auth.file_path.clone(),
        inference_only: auth.inference_only,
        oauth_config: auth.oauth_config.clone(),
    })
}

fn save_claude_auth(
    auth: &ClaudeAuthState,
    expected_source_fingerprint: &str,
) -> Result<(), String> {
    if auth.inference_only {
        return Err(
            "Claude Code environment token cannot be refreshed for live usage.".to_string(),
        );
    }
    if claude_source_fingerprint(auth).as_deref() != Some(expected_source_fingerprint) {
        return Err("Claude Code credentials changed while refreshing; retry usage to use the newest login.".to_string());
    }
    let text = serde_json::to_string(&auth.credentials)
        .map_err(|error| format!("Failed to encode refreshed Claude Code credentials: {error}"))?;
    if let Some(path) = &auth.file_path {
        fs::write(path, text).map_err(|error| {
            format!(
                "Failed to save refreshed Claude Code credentials to {}: {error}",
                path.display()
            )
        })?;
    } else if let Some(service) = &auth.service_name {
        write_keychain_password(service, &text).map_err(|error| {
            format!("Failed to save refreshed Claude Code Keychain credentials: {error}")
        })?;
    } else {
        return Err("Claude Code credential source is unavailable for persistence.".to_string());
    }
    Ok(())
}

fn claude_source_fingerprint(auth: &ClaudeAuthState) -> Option<String> {
    let credentials = if let Some(path) = &auth.file_path {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| parse_json_or_hex::<ClaudeCredentialsFile>(&text))
    } else if let Some(service) = &auth.service_name {
        read_keychain_password(service, None)
            .and_then(|text| parse_json_or_hex::<ClaudeCredentialsFile>(&text))
    } else {
        None
    }?;
    Some(claude_credentials_fingerprint(&credentials))
}

fn claude_credentials_fingerprint(credentials: &ClaudeCredentialsFile) -> String {
    let mut hasher = Sha256::new();
    if let Some(oauth) = credentials.claude_ai_oauth.as_ref() {
        for value in [&oauth.access_token, &oauth.refresh_token] {
            hasher.update(value.as_deref().unwrap_or_default().as_bytes());
            hasher.update([0]);
        }
    }
    format!("{:x}", hasher.finalize())
}

fn claude_auth_fingerprint(auth: &ClaudeAuthState) -> String {
    claude_credentials_fingerprint(&auth.credentials)
}

fn build_claude_usage_snapshot(usage: Value, auth: &ClaudeAuthState) -> CodexUsageSnapshot {
    let mut lines = Vec::new();
    for (key, label, period) in [
        ("five_hour", "Session", Some(5 * 60 * 60 * 1000)),
        ("seven_day", "Weekly", Some(7 * 24 * 60 * 60 * 1000)),
        (
            "seven_day_opus",
            "Opus weekly",
            Some(7 * 24 * 60 * 60 * 1000),
        ),
        (
            "seven_day_omelette",
            "Design weekly",
            Some(7 * 24 * 60 * 60 * 1000),
        ),
    ] {
        if let Some(window) = usage.get(key) {
            if let Some(used) = value_to_f64(window.get("utilization")) {
                lines.push(progress_metric(
                    label,
                    used,
                    maybe_string(window.get("resets_at")),
                    period,
                ));
            }
        }
    }
    if let Some(extra) = usage.get("extra_usage") {
        if value_to_f64(extra.get("used_credits")).unwrap_or(0.0) > 0.0
            || value_to_f64(extra.get("monthly_limit")).unwrap_or(0.0) > 0.0
        {
            let used = value_to_f64(extra.get("used_credits")).unwrap_or(0.0);
            let limit = value_to_f64(extra.get("monthly_limit")).unwrap_or(0.0);
            let value = if limit > 0.0 {
                format!(
                    "{} / {}",
                    dollars_from_cents(used),
                    dollars_from_cents(limit)
                )
            } else {
                dollars_from_cents(used)
            };
            lines.push(CodexMetricLine::Text {
                label: "Extra usage".to_string(),
                value,
            });
        }
    }
    CodexUsageSnapshot {
        provider_id: "claude".to_string(),
        display_name: "Claude Code".to_string(),
        plan: claude_plan_label(auth),
        lines,
        fetched_at: now_iso(),
    }
}

fn store_claude_last_good(
    auth: &ClaudeAuthState,
    snapshot: CodexUsageSnapshot,
) -> CodexUsageSnapshot {
    let cache = CLAUDE_LAST_GOOD_USAGE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut guard) = cache.lock() {
        guard.insert(claude_auth_fingerprint(auth), snapshot.clone());
    }
    snapshot
}

fn claude_rate_limited_snapshot(
    auth: &ClaudeAuthState,
    retry_after_seconds: Option<u64>,
) -> CodexUsageSnapshot {
    if let Some(mut snapshot) = read_claude_last_good(auth) {
        snapshot.lines.push(CodexMetricLine::Text {
            label: "Status".to_string(),
            value: claude_rate_limit_message(retry_after_seconds, true),
        });
        return snapshot;
    }
    build_claude_status_snapshot(auth, claude_rate_limit_message(retry_after_seconds, false))
}

fn read_claude_last_good(auth: &ClaudeAuthState) -> Option<CodexUsageSnapshot> {
    CLAUDE_LAST_GOOD_USAGE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|guard| guard.get(&claude_auth_fingerprint(auth)).cloned())
}

fn claude_rate_limit_message(retry_after_seconds: Option<u64>, has_cached_usage: bool) -> String {
    let retry = retry_after_seconds
        .map(format_retry_after)
        .map(|value| format!(" · retry in {value}"))
        .unwrap_or_default();
    if has_cached_usage {
        format!("Live usage rate limited{retry}; showing last good values.")
    } else {
        format!("Live usage rate limited{retry}. Try again shortly.")
    }
}

fn format_retry_after(seconds: u64) -> String {
    if seconds >= 3_600 {
        format!("{}h", ((seconds as f64) / 3_600.0).ceil() as u64)
    } else if seconds >= 60 {
        format!("{}m", ((seconds as f64) / 60.0).ceil() as u64)
    } else {
        format!("{}s", seconds.max(1))
    }
}

fn build_claude_status_snapshot(auth: &ClaudeAuthState, message: String) -> CodexUsageSnapshot {
    CodexUsageSnapshot {
        provider_id: "claude".to_string(),
        display_name: "Claude Code".to_string(),
        plan: claude_plan_label(auth),
        lines: vec![CodexMetricLine::Text {
            label: "Status".to_string(),
            value: message,
        }],
        fetched_at: now_iso(),
    }
}

fn claude_plan_label(auth: &ClaudeAuthState) -> Option<String> {
    let oauth = auth.credentials.claude_ai_oauth.as_ref()?;
    let base = oauth.subscription_type.as_deref().map(format_plan_label)?;
    let Some(tier) = oauth.rate_limit_tier.as_deref() else {
        return Some(base);
    };
    let Some(multiplier) = first_rate_limit_multiplier(tier) else {
        return Some(base);
    };
    Some(format!("{base} {multiplier}"))
}

fn first_rate_limit_multiplier(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    for start in 0..bytes.len() {
        if !bytes[start].is_ascii_digit() {
            continue;
        }
        let mut end = start;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end < bytes.len() && bytes[end].eq_ignore_ascii_case(&b'x') {
            return Some(value[start..=end].to_string());
        }
    }
    None
}

fn read_cursor_state_value(key: &str) -> Option<String> {
    let db = home_path(CURSOR_STATE_DB)?;
    if !db.exists() {
        return None;
    }
    let sql = format!(
        "SELECT value FROM ItemTable WHERE key = '{}' LIMIT 1;",
        key.replace('\'', "''")
    );
    let output = Command::new("sqlite3").arg(db).arg(sql).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn write_cursor_state_value(key: &str, value: &str) -> Result<(), String> {
    let db = home_path(CURSOR_STATE_DB)
        .ok_or_else(|| "Cursor state database path unavailable.".to_string())?;
    if !db.exists() {
        return Err("Cursor state database is unavailable.".to_string());
    }
    let escaped_key = key.replace('\'', "''");
    let escaped_value = value.replace('\'', "''");
    let sql = format!(
        "INSERT OR REPLACE INTO ItemTable(key, value) VALUES ('{escaped_key}', '{escaped_value}');"
    );
    let mut child = Command::new("sqlite3")
        .arg(db)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to open Cursor state database: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Cursor state database input.".to_string())?
        .write_all(sql.as_bytes())
        .map_err(|error| format!("Failed to write Cursor state database update: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to save Cursor state database: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() {
            "Cursor state database update failed.".to_string()
        } else {
            format!("Cursor state database update failed: {detail}")
        })
    }
}

fn load_cursor_auth() -> Option<CursorAuthState> {
    let sqlite_access = read_cursor_state_value("cursorAuth/accessToken");
    let sqlite_refresh = read_cursor_state_value("cursorAuth/refreshToken");
    if sqlite_access.is_some() || sqlite_refresh.is_some() {
        return Some(CursorAuthState {
            access_token: sqlite_access,
            refresh_token: sqlite_refresh,
            source: CursorAuthSource::Sqlite,
        });
    }

    let access_token = read_keychain_password(CURSOR_ACCESS_KEYCHAIN_SERVICE, None);
    let refresh_token = read_keychain_password(CURSOR_REFRESH_KEYCHAIN_SERVICE, None);
    if access_token.is_some() || refresh_token.is_some() {
        return Some(CursorAuthState {
            access_token,
            refresh_token,
            source: CursorAuthSource::Keychain,
        });
    }
    None
}

fn cursor_access_token(auth: &CursorAuthState) -> Result<String, String> {
    auth.access_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            "Cursor access token missing. Sign in via Cursor app or run `agent login`.".to_string()
        })
}

fn cursor_session_from_access_token(access_token: &str) -> Option<CursorSession> {
    let payload = access_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    let payload = serde_json::from_slice::<Value>(&decoded).ok()?;
    let subject = payload.get("sub")?.as_str()?.trim();
    let mut parts = subject.split('|');
    let first = parts.next()?.trim();
    let user_id = parts.next().unwrap_or(first).trim();
    if user_id.is_empty() {
        return None;
    }
    Some(CursorSession {
        user_id: user_id.to_string(),
        cookie_value: format!("{user_id}%3A%3A{access_token}"),
    })
}

fn persist_cursor_token(source: &CursorAuthSource, key: &str, token: &str) -> Result<(), String> {
    match source {
        CursorAuthSource::Sqlite => write_cursor_state_value(key, token),
        CursorAuthSource::Keychain => {
            let service = if key == "cursorAuth/refreshToken" {
                CURSOR_REFRESH_KEYCHAIN_SERVICE
            } else {
                CURSOR_ACCESS_KEYCHAIN_SERVICE
            };
            write_keychain_password(service, token)
        }
    }
}

fn fetch_cursor_usage_export(
    client: &reqwest::blocking::Client,
    access_token: &str,
    now: time::OffsetDateTime,
) -> Result<CursorUsageExport, ()> {
    let session = cursor_session_from_access_token(access_token).ok_or(())?;
    let end_date = now.unix_timestamp_nanos() / 1_000_000;
    let start_date = (now - time::Duration::days(30)).unix_timestamp_nanos() / 1_000_000;
    let response = client
        .get(CURSOR_USAGE_EXPORT_URL)
        .query(&[
            ("startDate", start_date.to_string()),
            ("endDate", end_date.to_string()),
            ("strategy", "tokens".to_string()),
        ])
        .header(
            reqwest::header::COOKIE,
            format!("WorkosCursorSessionToken={}", session.cookie_value),
        )
        .header(reqwest::header::ACCEPT, "text/csv")
        .send()
        .map_err(|_| ())?;
    if !response.status().is_success() {
        return Err(());
    }
    let csv = response.text().map_err(|_| ())?;
    parse_cursor_usage_export(&csv, now.offset()).map_err(|_| ())
}

fn parse_cursor_usage_export(
    csv: &str,
    local_offset: time::UtcOffset,
) -> Result<CursorUsageExport, ()> {
    const REQUIRED_COLUMNS: [&str; 6] = [
        "Date",
        "Model",
        "Input (w/ Cache Write)",
        "Input (w/o Cache Write)",
        "Cache Read",
        "Output Tokens",
    ];

    let rows = parse_cursor_csv_rows(csv)?;
    let Some(header) = rows.first() else {
        return Err(());
    };
    let header = header
        .iter()
        .map(|value| value.trim().trim_start_matches('\u{feff}').to_string())
        .collect::<Vec<_>>();
    if header.len() != header.iter().collect::<HashSet<_>>().len() {
        return Err(());
    }
    let mut columns = BTreeMap::new();
    for required in REQUIRED_COLUMNS {
        let Some(index) = header.iter().position(|value| value == required) else {
            return Err(());
        };
        columns.insert(required, index);
    }

    let mut daily: BTreeMap<String, CursorUsageExportDay> = BTreeMap::new();
    for row in rows.iter().skip(1) {
        if row.len() != header.len() {
            continue;
        }
        let Some(date) = cursor_export_day_key(&row[columns["Date"]], local_offset) else {
            continue;
        };
        let model = row[columns["Model"]].trim();
        let Some(tokens) = [
            "Input (w/ Cache Write)",
            "Input (w/o Cache Write)",
            "Cache Read",
            "Output Tokens",
        ]
        .iter()
        .map(|column| parse_cursor_token_value(&row[columns[*column]]))
        .try_fold(0_u64, |total, value| total.checked_add(value?)) else {
            continue;
        };
        if model.is_empty() {
            continue;
        }
        let day = daily
            .entry(date.clone())
            .or_insert_with(|| CursorUsageExportDay {
                date,
                total_tokens: 0,
                models: BTreeMap::new(),
            });
        let Some(total_tokens) = day.total_tokens.checked_add(tokens) else {
            continue;
        };
        let model_tokens = day.models.get(model).copied().unwrap_or(0);
        let Some(model_tokens) = model_tokens.checked_add(tokens) else {
            continue;
        };
        day.total_tokens = total_tokens;
        day.models.insert(model.to_string(), model_tokens);
    }
    Ok(CursorUsageExport {
        daily: daily.into_values().collect(),
    })
}

fn parse_cursor_csv_rows(csv: &str) -> Result<Vec<Vec<String>>, ()> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum State {
        Start,
        Unquoted,
        Quoted,
        QuoteClosed,
    }

    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut state = State::Start;
    let mut characters = csv.chars().peekable();
    while let Some(character) = characters.next() {
        if state == State::Quoted {
            if character == '"' {
                if characters.peek() == Some(&'"') {
                    field.push('"');
                    characters.next();
                } else {
                    state = State::QuoteClosed;
                }
            } else {
                field.push(character);
            }
            continue;
        }
        match (state, character) {
            (State::Start, '"') => state = State::Quoted,
            (State::Start, ',') => {
                row.push(std::mem::take(&mut field));
            }
            (State::Start, '\r' | '\n') => {
                if character == '\r' && characters.peek() == Some(&'\n') {
                    characters.next();
                }
                row.push(std::mem::take(&mut field));
                if row.iter().any(|value| !value.is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            (State::Start, value) => {
                field.push(value);
                state = State::Unquoted;
            }
            (State::Unquoted, ',') => {
                row.push(std::mem::take(&mut field));
                state = State::Start;
            }
            (State::Unquoted, '\r' | '\n') => {
                if character == '\r' && characters.peek() == Some(&'\n') {
                    characters.next();
                }
                row.push(std::mem::take(&mut field));
                if row.iter().any(|value| !value.is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
                state = State::Start;
            }
            (State::Unquoted, '"') => return Err(()),
            (State::Unquoted, value) => field.push(value),
            (State::QuoteClosed, ',') => {
                row.push(std::mem::take(&mut field));
                state = State::Start;
            }
            (State::QuoteClosed, '\r' | '\n') => {
                if character == '\r' && characters.peek() == Some(&'\n') {
                    characters.next();
                }
                row.push(std::mem::take(&mut field));
                if row.iter().any(|value| !value.is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
                state = State::Start;
            }
            (State::QuoteClosed, _) => return Err(()),
            (State::Quoted, _) => unreachable!(),
        }
    }
    if state == State::Quoted {
        return Err(());
    }
    if !field.is_empty() || !row.is_empty() || state == State::QuoteClosed {
        row.push(field);
        if row.iter().any(|value| !value.is_empty()) {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn parse_cursor_token_value(value: &str) -> Option<u64> {
    let value = value.trim();
    if value.is_empty() {
        return Some(0);
    }
    let groups = value.split(',').collect::<Vec<_>>();
    if groups.len() > 1
        && (groups[0].is_empty()
            || groups[0].len() > 3
            || !groups[0].bytes().all(|byte| byte.is_ascii_digit())
            || groups[1..]
                .iter()
                .any(|group| group.len() != 3 || !group.bytes().all(|byte| byte.is_ascii_digit())))
    {
        return None;
    }
    let digits = groups.concat();
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn cursor_export_day_key(value: &str, local_offset: time::UtcOffset) -> Option<String> {
    let value = value.trim();
    if let Ok(timestamp) =
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
    {
        return Some(local_day_key(timestamp.to_offset(local_offset)));
    }
    let date = value.get(..10)?;
    let year = date.get(..4)?.parse::<i32>().ok()?;
    let month = date.get(5..7)?.parse::<u8>().ok()?;
    let day = date.get(8..10)?.parse::<u8>().ok()?;
    let month = time::Month::try_from(month).ok()?;
    time::Date::from_calendar_date(year, month, day).ok()?;
    Some(date.to_string())
}

fn append_cursor_usage_export(
    snapshot: &mut CodexUsageSnapshot,
    export: &CursorUsageExport,
    now: time::OffsetDateTime,
) {
    let (today_key, yesterday_key) = codex_history_day_keys(now);
    let today = export.daily.iter().find(|day| day.date == today_key);
    let yesterday = export.daily.iter().find(|day| day.date == yesterday_key);
    snapshot.lines.push(CodexMetricLine::Text {
        label: "Today".to_string(),
        value: format_cursor_tokens(today.map(|day| day.total_tokens).unwrap_or(0)),
    });
    snapshot.lines.push(CodexMetricLine::Text {
        label: "Yesterday".to_string(),
        value: format_cursor_tokens(yesterday.map(|day| day.total_tokens).unwrap_or(0)),
    });
    let total_tokens = export
        .daily
        .iter()
        .fold(0_u64, |total, day| total.saturating_add(day.total_tokens));
    snapshot.lines.push(CodexMetricLine::Text {
        label: "Last 30 Days".to_string(),
        value: format_cursor_tokens(total_tokens),
    });

    let mut points = export
        .daily
        .iter()
        .map(|day| CodexBarChartPoint {
            label: cursor_day_display_label(&day.date),
            value: day.total_tokens as f64,
            value_label: format_cursor_tokens(day.total_tokens),
        })
        .collect::<Vec<_>>();
    if points.len() > 31 {
        points = points.split_off(points.len() - 31);
    }
    if !points.is_empty() {
        snapshot.lines.push(CodexMetricLine::BarChart {
            label: "Usage Trend".to_string(),
            points,
            note: Some("From your Cursor usage export.".to_string()),
            color: Some("#74AA9C".to_string()),
        });
    }

    let mut models = BTreeMap::<String, u64>::new();
    for day in &export.daily {
        for (model, tokens) in &day.models {
            *models.entry(model.clone()).or_default() += tokens;
        }
    }
    let model_total = models
        .values()
        .fold(0_u64, |total, tokens| total.saturating_add(*tokens));
    let mut shares = models.into_iter().collect::<Vec<_>>();
    shares.sort_by(|(left_model, left_tokens), (right_model, right_tokens)| {
        right_tokens
            .cmp(left_tokens)
            .then_with(|| left_model.cmp(right_model))
    });
    for (model, tokens) in shares.into_iter().take(5) {
        if model_total == 0 || tokens == 0 {
            continue;
        }
        snapshot.lines.push(CodexMetricLine::Text {
            label: model,
            value: format_percent_label((tokens as f64 / model_total as f64) * 100.0),
        });
    }
}

fn format_cursor_tokens(tokens: u64) -> String {
    format!("{} tokens", format_compact_number(tokens as f64))
}

fn cursor_day_display_label(date: &str) -> String {
    format!(
        "{}/{}",
        date[5..7].trim_start_matches('0'),
        date[8..10].trim_start_matches('0')
    )
}

fn fetch_cursor_json(
    client: &reqwest::blocking::Client,
    url: &str,
    auth: &CursorAuthState,
) -> Result<Value, CodexUsageFetchError> {
    let response = client
        .post(url)
        .bearer_auth(cursor_access_token(auth).map_err(CodexUsageFetchError::Other)?)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("Connect-Protocol-Version", "1")
        .body("{}")
        .send()
        .map_err(|error| {
            CodexUsageFetchError::Other(format_http_send_error("Cursor usage", &error))
        })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CodexUsageFetchError::Auth);
    }
    if !response.status().is_success() {
        return Err(CodexUsageFetchError::Other(format!(
            "Cursor usage request failed (HTTP {})",
            response.status().as_u16()
        )));
    }
    response.json::<Value>().map_err(|error| {
        CodexUsageFetchError::Other(format!("Cursor usage response invalid: {error}"))
    })
}

fn refresh_cursor_token(
    client: &reqwest::blocking::Client,
    auth: &mut CursorAuthState,
) -> Result<(), String> {
    let refresh_token = auth
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            "Cursor refresh token missing. Sign in via Cursor app or run `agent login`.".to_string()
        })?;
    let response = client
        .post(CURSOR_REFRESH_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": CURSOR_CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| format_http_send_error("Cursor token refresh", &error))?;
    if !response.status().is_success() {
        return Err(format!(
            "Cursor token refresh failed (HTTP {})",
            response.status().as_u16()
        ));
    }
    let body = response
        .json::<Value>()
        .map_err(|error| format!("Cursor token refresh response invalid: {error}"))?;
    if body.get("shouldLogout").and_then(Value::as_bool) == Some(true) {
        return Err(
            "Cursor session expired. Sign in via Cursor app or run `agent login`.".to_string(),
        );
    }
    if let Some(access_token) = maybe_string(body.get("access_token")) {
        persist_cursor_token(&auth.source, "cursorAuth/accessToken", &access_token)?;
        auth.access_token = Some(access_token);
    }
    if let Some(refresh_token) = maybe_string(body.get("refresh_token")) {
        persist_cursor_token(&auth.source, "cursorAuth/refreshToken", &refresh_token)?;
        auth.refresh_token = Some(refresh_token);
    }
    Ok(())
}

fn build_cursor_usage_snapshot(
    usage: Value,
    plan: Option<String>,
) -> Result<CodexUsageSnapshot, String> {
    let plan_usage = usage
        .get("planUsage")
        .ok_or_else(|| "Cursor usage data unavailable.".to_string())?;
    let mut lines = Vec::new();
    let reset = value_to_i64(usage.get("billingCycleEnd")).and_then(unix_millis_to_iso);
    let duration = cursor_billing_duration_ms(&usage);

    if let Some(percent) = value_to_f64(plan_usage.get("totalPercentUsed")) {
        lines.push(progress_metric(
            "Plan usage",
            percent,
            reset.clone(),
            duration,
        ));
    } else if let (Some(total), Some(limit)) = (
        value_to_f64(plan_usage.get("totalSpend")),
        value_to_f64(plan_usage.get("limit")),
    ) {
        if limit > 0.0 {
            lines.push(progress_metric(
                "Plan usage",
                (total / limit) * 100.0,
                reset.clone(),
                duration,
            ));
        }
    }
    if let Some(percent) = value_to_f64(plan_usage.get("autoPercentUsed")) {
        lines.push(progress_metric(
            "Auto usage",
            percent,
            reset.clone(),
            duration,
        ));
    }
    if let Some(percent) = value_to_f64(plan_usage.get("apiPercentUsed")) {
        lines.push(progress_metric("API usage", percent, reset, duration));
    }
    if let Some(remaining) = value_to_f64(plan_usage.get("remaining")) {
        lines.push(CodexMetricLine::Text {
            label: "Credits".to_string(),
            value: format!("{} left", dollars_from_cents(remaining)),
        });
    }
    if lines.is_empty() {
        return Err("Cursor usage data unavailable.".to_string());
    }
    Ok(CodexUsageSnapshot {
        provider_id: "cursor".to_string(),
        display_name: "Cursor".to_string(),
        plan,
        lines,
        fetched_at: now_iso(),
    })
}

fn cursor_billing_duration_ms(usage: &Value) -> Option<u64> {
    let start = value_to_i64(usage.get("billingCycleStart"))?;
    let end = value_to_i64(usage.get("billingCycleEnd"))?;
    if end > start {
        Some((end - start) as u64)
    } else {
        None
    }
}

fn unix_millis_to_iso(ms: i64) -> Option<String> {
    let seconds = ms.div_euclid(1000);
    let nanos = (ms.rem_euclid(1000) * 1_000_000) as u32;
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .and_then(|value| value.replace_nanosecond(nanos).ok())
        .map(|value| {
            value
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .flatten()
}

#[derive(Debug, Clone)]
struct AntigravityLsDiscovery {
    pid: String,
    csrf: String,
    extension_port: Option<u16>,
}

#[derive(Debug, Clone, Default)]
struct AntigravityAuth {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AntigravityCloudError {
    Auth,
    Unavailable,
}

fn load_antigravity_auth() -> Option<AntigravityAuth> {
    let raw = read_keychain_password(AGY_KEYCHAIN_SERVICE, Some(AGY_KEYCHAIN_ACCOUNT))?;
    let text = unwrap_go_keyring(&raw)?;
    let value = serde_json::from_str::<Value>(&text).ok();
    let access_token = value
        .as_ref()
        .and_then(|value| {
            find_antigravity_auth_string(
                value,
                &[
                    "access_token",
                    "accessToken",
                    "token",
                    "id_token",
                    "idToken",
                    "bearerToken",
                    "auth_token",
                    "authToken",
                ],
            )
        })
        .or_else(|| {
            let text = text.strip_prefix("Bearer ").unwrap_or(&text).trim();
            (!text.is_empty()).then(|| text.to_string())
        });
    let refresh_token = value
        .as_ref()
        .and_then(|value| find_antigravity_auth_string(value, &["refresh_token", "refreshToken"]));
    if access_token.is_none() && refresh_token.is_none() {
        return None;
    }
    Some(AntigravityAuth {
        access_token,
        refresh_token,
    })
}

fn unwrap_go_keyring(raw: &str) -> Option<String> {
    let text = raw.trim();
    let text = if let Some(encoded) = text.strip_prefix("go-keyring-base64:") {
        let decoded = STANDARD.decode(encoded.trim()).ok()?;
        String::from_utf8(decoded).ok()?
    } else {
        text.to_string()
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn find_antigravity_auth_string(value: &Value, keys: &[&str]) -> Option<String> {
    if let Some(object) = value.as_object() {
        let source = object
            .get("token")
            .and_then(Value::as_object)
            .unwrap_or(object);
        for key in keys {
            if let Some(value) = source
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(value.to_string());
            }
        }
        for key in ["tokens", "oauth", "oauth2", "credentials", "auth"] {
            if let Some(nested) = object.get(key) {
                if let Some(value) = find_antigravity_auth_string(nested, keys) {
                    return Some(value);
                }
            }
        }
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn fetch_antigravity_cloud_json(
    client: &reqwest::blocking::Client,
    path: &str,
    token: &str,
    user_agent: &str,
    body: &Value,
) -> Result<Value, AntigravityCloudError> {
    for base_url in AGY_CLOUD_CODE_BASE_URLS {
        let response = client
            .post(format!("{base_url}{path}"))
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .header(reqwest::header::USER_AGENT, user_agent)
            .json(body)
            .send();
        let Ok(response) = response else {
            continue;
        };
        if response.status() == reqwest::StatusCode::UNAUTHORIZED
            || response.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err(AntigravityCloudError::Auth);
        }
        if !response.status().is_success() {
            continue;
        }
        return response
            .json::<Value>()
            .map_err(|_| AntigravityCloudError::Unavailable);
    }
    Err(AntigravityCloudError::Unavailable)
}

fn fetch_antigravity_cloud_snapshot(
    client: &reqwest::blocking::Client,
    auth: &AntigravityAuth,
) -> Result<Option<CodexUsageSnapshot>, AntigravityCloudError> {
    let token = auth
        .access_token
        .as_deref()
        .filter(|token| !token.trim().is_empty())
        .ok_or(AntigravityCloudError::Auth)?;
    let response = fetch_antigravity_cloud_json(
        client,
        AGY_CLOUD_QUOTA_SUMMARY_PATH,
        token,
        "antigravity",
        &serde_json::json!({}),
    )?;
    let Some(lines) = build_antigravity_quota_summary_lines(&response) else {
        return Ok(None);
    };
    let plan = fetch_antigravity_cloud_json(
        client,
        AGY_CLOUD_LOAD_CODE_ASSIST_PATH,
        token,
        "agy",
        &serde_json::json!({}),
    )
    .ok()
    .and_then(|value| read_antigravity_cloud_plan(&value));
    Ok(Some(CodexUsageSnapshot {
        provider_id: "agy".to_string(),
        display_name: "Antigravity".to_string(),
        plan,
        lines,
        fetched_at: now_iso(),
    }))
}

fn read_antigravity_cloud_plan(value: &Value) -> Option<String> {
    value
        .get("paidTier")
        .and_then(|tier| tier.get("name"))
        .and_then(Value::as_str)
        .map(format_plan_label)
        .or_else(|| {
            value
                .get("currentTier")
                .and_then(|tier| tier.get("name"))
                .and_then(Value::as_str)
                .map(format_plan_label)
        })
}

fn refresh_antigravity_auth(
    client: &reqwest::blocking::Client,
    auth: &mut AntigravityAuth,
) -> Result<(), AntigravityCloudError> {
    let refresh_token = auth
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or(AntigravityCloudError::Auth)?;
    let (client_id, client_secret) =
        load_antigravity_oauth_client().ok_or(AntigravityCloudError::Unavailable)?;
    let response = client
        .post(AGY_GOOGLE_OAUTH_URL)
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|_| AntigravityCloudError::Unavailable)?;
    if response.status().is_success() {
        let body = response
            .json::<Value>()
            .map_err(|_| AntigravityCloudError::Unavailable)?;
        auth.access_token = body
            .get("access_token")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(ToOwned::to_owned);
        return auth
            .access_token
            .as_ref()
            .map(|_| ())
            .ok_or(AntigravityCloudError::Unavailable);
    }
    if response.status().is_client_error() {
        Err(AntigravityCloudError::Auth)
    } else {
        Err(AntigravityCloudError::Unavailable)
    }
}

fn load_antigravity_oauth_client() -> Option<(String, String)> {
    let client_id = env_text(AGY_GOOGLE_CLIENT_ID_ENV);
    let client_secret = env_text(AGY_GOOGLE_CLIENT_SECRET_ENV);
    if let (Some(client_id), Some(client_secret)) = (client_id, client_secret) {
        return Some((client_id, client_secret));
    }

    let path = home_path(AGY_GOOGLE_OAUTH_CONFIG_PATH)?;
    let text = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&text).ok()?;
    parse_antigravity_oauth_client(&value)
}

fn parse_antigravity_oauth_client(value: &Value) -> Option<(String, String)> {
    let client_id = maybe_string(value.get("client_id"))?;
    let client_secret = maybe_string(value.get("client_secret"))?;
    Some((client_id, client_secret))
}

fn probe_antigravity_ls_usage() -> Option<CodexUsageSnapshot> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("Agent Halo")
        .danger_accept_invalid_certs(true)
        .build()
        .ok()?;

    for discovery in discover_antigravity_ls_processes() {
        let ports = discover_listening_ports(&discovery);
        for port in ports {
            for scheme in ["https", "http"] {
                if probe_antigravity_ls_port(&client, scheme, port, &discovery.csrf).is_none() {
                    continue;
                }
                if let Some(snapshot) =
                    fetch_antigravity_ls_snapshot(&client, scheme, port, &discovery.csrf)
                {
                    return Some(snapshot);
                }
            }
        }
    }

    None
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

fn discover_antigravity_ls_processes() -> Vec<AntigravityLsDiscovery> {
    let output = Command::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let Ok(text) = String::from_utf8(output.stdout) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let (pid, command) = trimmed.split_once(' ')?;
            let lower = command.to_lowercase();
            let is_antigravity_ls = lower.contains("language_server")
                && (lower.contains("antigravity") || lower.contains("antigravity-ide"));
            let is_agy_ls =
                lower.contains("/agy") || lower.starts_with("agy ") || lower.ends_with("/agy");
            if !is_antigravity_ls && !is_agy_ls {
                return None;
            }
            Some(AntigravityLsDiscovery {
                pid: pid.to_string(),
                csrf: extract_flag_value(command, "--csrf_token").unwrap_or_default(),
                extension_port: extract_flag_value(command, "--extension_server_port")
                    .and_then(|value| value.parse::<u16>().ok()),
            })
        })
        .collect()
}

fn extract_flag_value(command: &str, flag: &str) -> Option<String> {
    let parts = command.split_whitespace().collect::<Vec<_>>();
    for (index, part) in parts.iter().enumerate() {
        if *part == flag {
            return parts
                .get(index + 1)
                .map(|value| value.trim_matches('"').to_string());
        }
        if let Some(value) = part.strip_prefix(&format!("{flag}=")) {
            return Some(value.trim_matches('"').to_string());
        }
    }
    None
}

fn discover_listening_ports(discovery: &AntigravityLsDiscovery) -> Vec<u16> {
    let mut ports = Vec::new();
    if let Some(port) = discovery.extension_port {
        ports.push(port);
    }

    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", &discovery.pid])
        .output();
    if let Ok(output) = output {
        if let Ok(text) = String::from_utf8(output.stdout) {
            for line in text.lines().skip(1) {
                for token in line.split_whitespace() {
                    if let Some(port_text) = token.rsplit(':').next() {
                        if let Ok(port) = port_text.parse::<u16>() {
                            if !ports.contains(&port) {
                                ports.push(port);
                            }
                        }
                    }
                }
            }
        }
    }

    ports
}

fn antigravity_ls_url(scheme: &str, port: u16, method: &str) -> String {
    format!("{scheme}://127.0.0.1:{port}/{AGY_LS_SERVICE}/{method}")
}

fn antigravity_ls_headers(
    request: reqwest::blocking::RequestBuilder,
    csrf: &str,
) -> reqwest::blocking::RequestBuilder {
    request
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("Connect-Protocol-Version", "1")
        .header("x-codeium-csrf-token", csrf)
}

fn probe_antigravity_ls_port(
    client: &reqwest::blocking::Client,
    scheme: &str,
    port: u16,
    csrf: &str,
) -> Option<()> {
    let response = antigravity_ls_headers(
        client.post(antigravity_ls_url(scheme, port, "GetUnleashData")),
        csrf,
    )
    .json(&serde_json::json!({
        "context": { "properties": { "devMode": "false", "extensionVersion": "unknown", "ide": "antigravity", "ideVersion": "unknown", "os": "macos" } }
    }))
    .send()
    .ok()?;
    if response.status().is_success() || response.status().is_client_error() {
        Some(())
    } else {
        None
    }
}

fn call_antigravity_ls(
    client: &reqwest::blocking::Client,
    scheme: &str,
    port: u16,
    csrf: &str,
    method: &str,
) -> Option<Value> {
    let response = antigravity_ls_headers(
        client.post(antigravity_ls_url(scheme, port, method)),
        csrf,
    )
    .json(&serde_json::json!({
        "metadata": { "ideName": "antigravity", "extensionName": "antigravity", "ideVersion": "unknown", "locale": "en" }
    }))
    .send()
    .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().ok()
}

fn fetch_antigravity_ls_snapshot(
    client: &reqwest::blocking::Client,
    scheme: &str,
    port: u16,
    csrf: &str,
) -> Option<CodexUsageSnapshot> {
    if let Some(snapshot) = fetch_antigravity_quota_summary_snapshot(client, scheme, port, csrf) {
        return Some(snapshot);
    }

    let user_status = call_antigravity_ls(client, scheme, port, csrf, "GetUserStatus");
    let (configs, plan) = if let Some(data) = user_status {
        let plan = data
            .get("userStatus")
            .and_then(|status| status.get("userTier"))
            .and_then(|tier| tier.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                data.get("userStatus")
                    .and_then(|status| status.get("planStatus"))
                    .and_then(|plan_status| plan_status.get("planInfo"))
                    .and_then(|info| info.get("planName"))
                    .and_then(Value::as_str)
                    .map(format_plan_label)
            });
        let configs = data
            .get("userStatus")
            .and_then(|status| status.get("cascadeModelConfigData"))
            .and_then(|data| data.get("clientModelConfigs"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        (configs, plan)
    } else {
        let data = call_antigravity_ls(client, scheme, port, csrf, "GetCommandModelConfigs")?;
        let configs = data.get("clientModelConfigs")?.as_array()?.clone();
        (configs, None)
    };

    let lines = build_antigravity_config_lines(&configs);
    if lines.is_empty() {
        return None;
    }
    Some(CodexUsageSnapshot {
        provider_id: "agy".to_string(),
        display_name: "Antigravity".to_string(),
        plan,
        lines,
        fetched_at: now_iso(),
    })
}

fn fetch_antigravity_quota_summary_snapshot(
    client: &reqwest::blocking::Client,
    scheme: &str,
    port: u16,
    csrf: &str,
) -> Option<CodexUsageSnapshot> {
    let data = call_antigravity_ls(client, scheme, port, csrf, "RetrieveUserQuotaSummary")?;
    let response = data.get("response")?;
    let lines = build_antigravity_quota_summary_lines(response)?;
    let plan = call_antigravity_ls(client, scheme, port, csrf, "GetUserStatus")
        .and_then(|status| read_antigravity_user_status_plan(&status));

    Some(CodexUsageSnapshot {
        provider_id: "agy".to_string(),
        display_name: "Antigravity".to_string(),
        plan,
        lines,
        fetched_at: now_iso(),
    })
}

fn read_antigravity_user_status_plan(data: &Value) -> Option<String> {
    data.get("userStatus")
        .and_then(|status| status.get("userTier"))
        .and_then(|tier| tier.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            data.get("userStatus")
                .and_then(|status| status.get("planStatus"))
                .and_then(|plan_status| plan_status.get("planInfo"))
                .and_then(|info| info.get("planName"))
                .and_then(Value::as_str)
                .map(format_plan_label)
        })
}

fn build_antigravity_quota_summary_lines(response: &Value) -> Option<Vec<CodexMetricLine>> {
    let response = response.get("response").unwrap_or(response);
    let groups = response.get("groups").and_then(Value::as_array)?;

    const BUCKETS: [(&str, &str, u64); 4] = [
        ("gemini-5h", "Gemini 5h", 5 * 60 * 60 * 1000),
        ("gemini-weekly", "Gemini Weekly", 7 * 24 * 60 * 60 * 1000),
        ("3p-5h", "Claude and GPT 5h", 5 * 60 * 60 * 1000),
        (
            "3p-weekly",
            "Claude and GPT Weekly",
            7 * 24 * 60 * 60 * 1000,
        ),
    ];
    let mut resolved = BTreeMap::new();

    for bucket in groups
        .iter()
        .filter_map(|group| group.get("buckets").and_then(Value::as_array))
        .flatten()
    {
        let Some(id) = bucket.get("bucketId").and_then(Value::as_str) else {
            continue;
        };
        let Some((_, label, period_duration_ms)) = BUCKETS.iter().find(|(key, _, _)| *key == id)
        else {
            continue;
        };
        if resolved.contains_key(id) {
            continue;
        }
        let Some(remaining) = value_to_f64(bucket.get("remainingFraction")) else {
            continue;
        };
        let reset_time = bucket
            .get("resetTime")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        resolved.insert(
            id,
            CodexMetricLine::Progress {
                label: (*label).to_string(),
                used: ((1.0 - remaining.clamp(0.0, 1.0)) * 100.0).round(),
                limit: 100.0,
                format: CodexProgressFormat::Percent,
                resets_at: reset_time,
                period_duration_ms: Some(*period_duration_ms),
            },
        );
    }

    Some(
        BUCKETS
            .iter()
            .filter_map(|(id, _, _)| resolved.remove(*id))
            .collect(),
    )
}

fn build_antigravity_config_lines(configs: &[Value]) -> Vec<CodexMetricLine> {
    let mut groups: BTreeMap<&'static str, (f64, Option<String>)> = BTreeMap::new();
    for config in configs {
        let Some(label) = config
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let model_id = config
            .get("modelOrAlias")
            .and_then(|model| model.get("model"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if is_antigravity_blacklisted_model(model_id) {
            continue;
        }
        let quota = config.get("quotaInfo");
        let remaining = value_to_f64(quota.and_then(|value| value.get("remainingFraction")))
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let reset_time = quota
            .and_then(|value| value.get("resetTime"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        add_antigravity_quota_group(
            &mut groups,
            antigravity_quota_group_label(label),
            remaining,
            reset_time,
        );
    }
    build_antigravity_group_lines(groups)
}

fn antigravity_quota_group_label(label: &str) -> &'static str {
    let lower = label.to_lowercase();
    if lower.contains("gemini") {
        "Gemini models"
    } else {
        "Claude and GPT models"
    }
}

fn add_antigravity_quota_group(
    groups: &mut BTreeMap<&'static str, (f64, Option<String>)>,
    label: &'static str,
    remaining: f64,
    reset_time: Option<String>,
) {
    match groups.get(label) {
        Some((current_remaining, _)) if *current_remaining <= remaining => {}
        _ => {
            groups.insert(label, (remaining, reset_time));
        }
    }
}

fn build_antigravity_group_lines(
    groups: BTreeMap<&'static str, (f64, Option<String>)>,
) -> Vec<CodexMetricLine> {
    ["Gemini models", "Claude and GPT models"]
        .into_iter()
        .filter_map(|label| {
            groups
                .get(label)
                .map(|(remaining, reset_time)| (label, *remaining, reset_time.clone()))
        })
        .map(|(label, remaining, reset_time)| CodexMetricLine::Progress {
            label: label.to_string(),
            used: ((1.0 - remaining) * 100.0).round().clamp(0.0, 100.0),
            limit: 100.0,
            format: CodexProgressFormat::Percent,
            resets_at: reset_time,
            period_duration_ms: Some(5 * 60 * 60 * 1000),
        })
        .collect()
}

fn is_antigravity_blacklisted_model(model_id: &str) -> bool {
    matches!(
        model_id,
        "MODEL_CHAT_20706"
            | "MODEL_CHAT_23310"
            | "MODEL_GOOGLE_GEMINI_2_5_FLASH"
            | "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING"
            | "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE"
            | "MODEL_GOOGLE_GEMINI_2_5_PRO"
            | "MODEL_PLACEHOLDER_M19"
            | "MODEL_PLACEHOLDER_M9"
            | "MODEL_PLACEHOLDER_M12"
    )
}

fn read_percent_header(headers: &reqwest::header::HeaderMap, name: &str) -> Option<f64> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

fn format_codex_plan(plan: String) -> Option<String> {
    let trimmed = plan.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.eq_ignore_ascii_case("prolite") {
        return Some("Pro 5x".to_string());
    }
    if trimmed.eq_ignore_ascii_case("pro") {
        return Some("Pro 20x".to_string());
    }

    Some(
        trimmed
            .split(['_', '-'])
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn unix_seconds_to_iso(seconds: i64) -> Option<String> {
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .and_then(|time| {
            time.format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
}

#[tauri::command]
fn install_agent_halo_mod() -> Result<String, String> {
    let path = letta_mod_path()?;
    let hook_path = letta_hook_path()?;
    let Some(parent) = path.parent() else {
        return Err("Failed to resolve Letta mods directory".to_string());
    };

    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create mods directory: {error}"))?;

    let mut file =
        fs::File::create(&path).map_err(|error| format!("Failed to open mod file: {error}"))?;
    file.write_all(include_bytes!("../../../../mods/agent-halo.js"))
        .map_err(|error| format!("Failed to write mod file: {error}"))?;

    let Some(hook_parent) = hook_path.parent() else {
        return Err("Failed to resolve Letta hooks directory".to_string());
    };
    fs::create_dir_all(hook_parent)
        .map_err(|error| format!("Failed to create hooks directory: {error}"))?;
    fs::write(
        &hook_path,
        include_bytes!("../../../../hooks/agent-halo-hook.mjs"),
    )
    .map_err(|error| format!("Failed to write Agent Halo hook relay: {error}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn agent_halo_mod_path() -> Result<String, String> {
    Ok(letta_mod_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn agent_halo_mod_status() -> Result<(String, bool), String> {
    let path = letta_mod_path()?;
    let hook_path = letta_hook_path()?;
    let installed = path.exists() && hook_path.exists();
    Ok((path.to_string_lossy().to_string(), installed))
}

#[tauri::command]
fn install_agent_halo_agy_hooks(app: tauri::AppHandle) -> Result<String, String> {
    let hook_path = agy_hook_path()?;
    let hooks_json_path = agy_hooks_json_path()?;

    let resource_path = app
        .path()
        .resolve("agent-halo-agy-hook.mjs", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource: {e}"))?;

    let Some(hook_parent) = hook_path.parent() else {
        return Err("Failed to resolve AGY hooks directory".to_string());
    };

    fs::create_dir_all(hook_parent)
        .map_err(|error| format!("Failed to create hooks directory: {error}"))?;

    fs::copy(&resource_path, &hook_path)
        .map_err(|error| format!("Failed to copy hook script: {error}"))?;

    let installed_path = hook_path.to_string_lossy().to_string();

    let mut hooks_config: serde_json::Value = if hooks_json_path.exists() {
        let content = fs::read_to_string(&hooks_json_path)
            .map_err(|e| format!("Failed to read hooks.json: {e}"))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse hooks.json: {e}"))?
    } else {
        serde_json::json!({})
    };

    let agent_halo_entry = serde_json::json!({
      "PreToolUse": [{"matcher": ".*", "hooks": [{"type": "command", "command": format!("node {} --event PreToolUse", installed_path)}]}],
      "PostToolUse": [{"matcher": ".*", "hooks": [{"type": "command", "command": format!("node {} --event PostToolUse", installed_path)}]}],
      "PreInvocation": [{"type": "command", "command": format!("node {} --event PreInvocation", installed_path)}],
      "Stop": [{"type": "command", "command": format!("node {} --event Stop", installed_path)}]
    });

    if let Some(obj) = hooks_config.as_object_mut() {
        obj.insert("agent-halo".to_string(), agent_halo_entry);
    } else {
        let mut map = serde_json::Map::new();
        map.insert("agent-halo".to_string(), agent_halo_entry);
        hooks_config = serde_json::Value::Object(map);
    }

    let Some(config_parent) = hooks_json_path.parent() else {
        return Err("Failed to resolve config directory".to_string());
    };
    fs::create_dir_all(config_parent)
        .map_err(|error| format!("Failed to create config directory: {error}"))?;

    let json_string = serde_json::to_string_pretty(&hooks_config)
        .map_err(|e| format!("Failed to stringify hooks.json: {e}"))?;

    fs::write(&hooks_json_path, json_string)
        .map_err(|error| format!("Failed to write hooks.json: {error}"))?;

    Ok(installed_path)
}

#[tauri::command]
fn agent_halo_agy_hook_status() -> Result<(String, bool), String> {
    let hook_path = agy_hook_path()?;
    let hooks_json_path = agy_hooks_json_path()?;
    let mut is_in_json = false;

    if hooks_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&hooks_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(obj) = json.as_object() {
                    is_in_json = obj.contains_key("agent-halo");
                }
            }
        }
    }

    let installed = hook_path.exists() && is_in_json;
    Ok((hook_path.to_string_lossy().to_string(), installed))
}

#[tauri::command]
fn focus_terminal(
    conversation_id: String,
    cwd: Option<String>,
    herdr_socket_path: Option<String>,
    herdr_pane_id: Option<String>,
    herdr_source_pid: Option<u32>,
    herdr_source_started_at_ms: Option<u64>,
) -> Result<String, String> {
    let mut herdr_error = None;
    if let (Some(socket_path), Some(pane_id), Some(source_pid), Some(source_started_at_ms)) = (
        herdr_socket_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        herdr_pane_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        herdr_source_pid,
        herdr_source_started_at_ms,
    ) {
        match focus_herdr_pane(
            socket_path,
            pane_id,
            &conversation_id,
            source_pid,
            source_started_at_ms,
        ) {
            Ok(message) => return Ok(message),
            Err(error) => herdr_error = Some(error),
        }
    }

    let fallback = focus_ghostty_window(&conversation_id, cwd.as_deref())?;
    if fallback.starts_with("Activated Ghostty ·") && herdr_error.is_some() {
        return Ok(format!("Herdr focus unavailable · {fallback}"));
    }
    Ok(fallback)
}

#[cfg(unix)]
fn focus_herdr_pane(
    socket_path: &str,
    pane_id: &str,
    conversation_id: &str,
    source_pid: u32,
    source_started_at_ms: u64,
) -> Result<String, String> {
    validate_herdr_target(socket_path, pane_id)?;
    let deadline = Instant::now() + Duration::from_millis(1_800);
    let identity = herdr_socket_request(
        socket_path,
        build_herdr_request("agent.get", pane_id),
        deadline,
    )?;
    verify_herdr_agent_identity(
        &identity,
        pane_id,
        conversation_id,
        source_pid,
        source_started_at_ms,
    )?;
    let focused = herdr_socket_request(
        socket_path,
        build_herdr_request("agent.focus", pane_id),
        deadline,
    )?;
    if focused.get("result").is_none() {
        return Err("Herdr focus response had no result".to_string());
    }

    activate_ghostty()?;
    Ok(format!("Focused Herdr · {pane_id}"))
}

#[cfg(not(unix))]
fn focus_herdr_pane(
    _socket_path: &str,
    _pane_id: &str,
    _conversation_id: &str,
    _source_pid: u32,
    _source_started_at_ms: u64,
) -> Result<String, String> {
    Err("Exact Herdr focus is unavailable on this platform".to_string())
}

#[cfg(unix)]
fn herdr_socket_request(
    socket_path: &str,
    request: Value,
    deadline: Instant,
) -> Result<Value, String> {
    let expected_id = request
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Herdr request has no ID".to_string())?
        .to_string();

    let mut stream = connect_herdr_socket(socket_path, deadline)?;
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| "Herdr focus request exceeded its total deadline".to_string())?;
    stream
        .set_write_timeout(Some(remaining))
        .map_err(|error| format!("Failed to bound Herdr write: {error}"))?;
    stream
        .write_all(format!("{request}\n").as_bytes())
        .map_err(|error| format!("Failed to request Herdr state: {error}"))?;
    stream
        .flush()
        .map_err(|error| format!("Failed to flush Herdr state request: {error}"))?;
    stream
        .set_nonblocking(true)
        .map_err(|error| format!("Failed to bound Herdr response polling: {error}"))?;

    let mut response = Vec::new();
    let mut chunk = [0_u8; 4_096];
    loop {
        if Instant::now() >= deadline {
            return Err("Herdr focus request exceeded its total deadline".to_string());
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                response.extend_from_slice(&chunk[..count]);
                if response.len() > 64 * 1024 {
                    return Err("Herdr focus response exceeded the bounded limit".to_string());
                }
                if let Some(newline) = response.iter().position(|byte| *byte == b'\n') {
                    response.truncate(newline);
                    break;
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(2));
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(error) => {
                return Err(format!("Failed to read Herdr state response: {error}"));
            }
        }
    }
    if response.is_empty() {
        return Err("Herdr returned an empty focus response".to_string());
    }

    let payload: Value = serde_json::from_slice(&response)
        .map_err(|error| format!("Herdr returned invalid state JSON: {error}"))?;
    validate_herdr_response(payload, &expected_id)
}

#[cfg(unix)]
fn connect_herdr_socket(socket_path: &str, deadline: Instant) -> Result<UnixStream, String> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| "Herdr focus request exceeded its total deadline".to_string())?;
    let socket_path = socket_path.to_string();
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(UnixStream::connect(socket_path));
    });
    match receiver.recv_timeout(remaining) {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(error)) => Err(format!("Failed to connect to Herdr: {error}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("Herdr focus request exceeded its total deadline while connecting".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Herdr focus connection worker stopped unexpectedly".to_string())
        }
    }
}

fn validate_herdr_response(payload: Value, expected_id: &str) -> Result<Value, String> {
    if payload.get("id").and_then(Value::as_str) != Some(expected_id) {
        return Err("Herdr response ID did not match the request".to_string());
    }
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Herdr returned an unspecified error");
        return Err(format!("Herdr focus failed: {message}"));
    }
    Ok(payload)
}

fn validate_herdr_target(socket_path: &str, pane_id: &str) -> Result<(), String> {
    if !is_valid_herdr_pane_id(pane_id) {
        return Err("Invalid Herdr pane identity".to_string());
    }

    let socket = Path::new(socket_path);
    if !socket.is_absolute() || socket.extension().and_then(|value| value.to_str()) != Some("sock")
    {
        return Err("Invalid Herdr socket path".to_string());
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Cannot validate Herdr socket without HOME".to_string())?;
    let allowed_root = home.join(".config").join("herdr");
    let allowed_root = allowed_root
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Herdr config directory: {error}"))?;
    let socket_parent = socket
        .parent()
        .ok_or_else(|| "Invalid Herdr socket parent".to_string())?
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Herdr socket directory: {error}"))?;
    if !socket_parent.starts_with(&allowed_root) {
        return Err("Herdr socket must stay inside ~/.config/herdr".to_string());
    }
    let metadata = fs::symlink_metadata(socket)
        .map_err(|error| format!("Cannot inspect Herdr socket: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_socket() {
        return Err("Herdr focus target must be a direct Unix socket".to_string());
    }
    #[cfg(target_os = "macos")]
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Herdr socket must be owned by the current user".to_string());
    }
    if metadata.mode() & 0o077 != 0 {
        return Err("Herdr socket must use private permissions".to_string());
    }
    Ok(())
}

fn is_valid_herdr_pane_id(pane_id: &str) -> bool {
    let Some((workspace, pane)) = pane_id.split_once(":p") else {
        return false;
    };
    if !workspace.starts_with('w')
        || workspace.len() < 2
        || !workspace[1..]
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        || pane.is_empty()
        || !pane
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return false;
    }
    true
}

fn build_herdr_request(method: &str, pane_id: &str) -> Value {
    serde_json::json!({
        "id": format!("agent-halo-{}-{}", method.replace('.', "-"), std::process::id()),
        "method": method,
        "params": { "target": pane_id },
    })
}

fn herdr_scope_fingerprint(conversation_id: &str) -> String {
    let digest = Sha256::digest(conversation_id.as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn verify_herdr_agent_identity(
    payload: &Value,
    pane_id: &str,
    conversation_id: &str,
    source_pid: u32,
    source_started_at_ms: u64,
) -> Result<(), String> {
    let agent = payload
        .pointer("/result/agent")
        .ok_or_else(|| "Herdr target has no active agent".to_string())?;
    if agent.get("pane_id").and_then(Value::as_str) != Some(pane_id)
        || agent.get("agent").and_then(Value::as_str) != Some("letta")
    {
        return Err("Herdr pane no longer contains the expected Letta agent".to_string());
    }
    let tokens = agent
        .get("tokens")
        .and_then(Value::as_object)
        .ok_or_else(|| "Herdr pane has no Letta identity tokens".to_string())?;
    let token_pid = tokens
        .get("letta_pid")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u32>().ok());
    let token_started_at = tokens
        .get("letta_started_at")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok());
    let token_scope = tokens.get("letta_scope").and_then(Value::as_str);
    let start_delta = token_started_at.map(|value| value.abs_diff(source_started_at_ms));
    let expected_scope = herdr_scope_fingerprint(conversation_id);
    if token_pid != Some(source_pid)
        || start_delta.is_none_or(|delta| delta > 2_000)
        || token_scope != Some(expected_scope.as_str())
    {
        return Err(
            "Herdr pane identity is stale or belongs to another Letta conversation".to_string(),
        );
    }
    Ok(())
}

fn activate_ghostty() -> Result<(), String> {
    let output = Command::new("open")
        .args(["-a", "Ghostty"])
        .output()
        .map_err(|error| format!("Failed to launch Ghostty: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        "Failed to activate Ghostty".to_string()
    } else {
        format!("Failed to activate Ghostty: {stderr}")
    })
}

fn focus_ghostty_window(conversation_id: &str, cwd: Option<&str>) -> Result<String, String> {
    let hints = build_focus_hints(conversation_id, cwd);

    if let Ok(message) = focus_ghostty_with_window_hints(&hints) {
        return Ok(message);
    }

    activate_ghostty()?;
    Ok("Activated Ghostty · exact terminal not found".to_string())
}

fn build_focus_hints(conversation_id: &str, cwd: Option<&str>) -> Vec<String> {
    let mut hints = Vec::new();
    let trimmed_conversation_id = conversation_id.trim();

    if !trimmed_conversation_id.is_empty() {
        hints.push(trimmed_conversation_id.to_string());
        hints.push(trimmed_conversation_id.chars().take(8).collect::<String>());
    }

    if let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) {
        hints.push(cwd.to_string());
        if let Some(name) = Path::new(cwd).file_name().and_then(|name| name.to_str()) {
            hints.push(name.to_string());
        }
    }

    hints.sort();
    hints.dedup();
    hints
}

fn focus_ghostty_with_window_hints(hints: &[String]) -> Result<String, String> {
    let script = build_focus_ghostty_script(hints);
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to run AppleScript: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "AppleScript focus failed".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.strip_prefix("matched:").is_some() {
        Ok(format!(
            "Focused Ghostty · {}",
            stdout.trim_start_matches("matched:")
        ))
    } else {
        Ok("Activated Ghostty · exact terminal not found".to_string())
    }
}

fn build_focus_ghostty_script(hints: &[String]) -> String {
    let hints_source = hints
        .iter()
        .filter(|hint| !hint.trim().is_empty())
        .map(|hint| apple_script_string(hint))
        .collect::<Vec<_>>()
        .join(", ");
    let hints_source = if hints_source.is_empty() {
        "{}".to_string()
    } else {
        format!("{{{hints_source}}}")
    };

    format!(
        r#"set matchHints to {hints_source}
tell application "Ghostty"
  repeat with candidateWindow in windows
    set windowTitle to name of candidateWindow as text
    set windowId to id of candidateWindow as text
    repeat with candidateTab in tabs of candidateWindow
      set tabTitle to name of candidateTab as text
      set tabId to id of candidateTab as text
      repeat with candidateTerminal in terminals of candidateTab
        set terminalTitle to name of candidateTerminal as text
        set terminalId to id of candidateTerminal as text
        set terminalCwd to working directory of candidateTerminal as text
        repeat with matchHint in matchHints
          set hintText to matchHint as text
          if hintText is not "" then
            if terminalCwd is hintText or terminalCwd contains hintText or terminalTitle contains hintText or tabTitle contains hintText or windowTitle contains hintText or terminalId is hintText or tabId is hintText or windowId is hintText then
              select tab candidateTab
              focus candidateTerminal
              activate window candidateWindow
              return "matched:" & terminalCwd & " · " & terminalTitle
            end if
          end if
        end repeat
      end repeat
    end repeat
  end repeat
  activate
end tell
return "activated"
"#
    )
}

fn apple_script_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', " ");
    format!("\"{escaped}\"")
}

fn display_preference_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(DISPLAY_PREFERENCE_FILE))
        .map_err(|error| format!("Could not resolve Agent Halo config directory: {error}"))
}

fn read_display_preference(app: &tauri::AppHandle) -> Option<DisplayPreference> {
    let path = display_preference_path(app).ok()?;
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_display_preference(
    app: &tauri::AppHandle,
    preference: &DisplayPreference,
) -> Result<(), String> {
    let path = display_preference_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Display preference path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create Agent Halo config directory: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(preference)
        .map_err(|error| format!("Could not encode display preference: {error}"))?;
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("Could not write display preference: {error}"))?;
    fs::rename(&temporary_path, &path)
        .map_err(|error| format!("Could not save display preference: {error}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn appkit_display_id(screen: &NSScreen) -> Option<String> {
    let description = screen.deviceDescription();
    let key = NSString::from_str("NSScreenNumber");
    let value = description.objectForKey(&key)?;
    // SAFETY: NSScreenNumber is documented as an NSNumber-compatible unsigned display id.
    let display_id: usize = unsafe { msg_send![&*value, unsignedIntegerValue] };
    Some(format!("macos:{display_id}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn appkit_display_option(
    screen: &NSScreen,
    primary_display_id: Option<&str>,
) -> Option<DisplayOption> {
    let id = appkit_display_id(screen)?;
    let name = screen.localizedName().to_string();
    let frame = screen.frame();
    let backing_frame =
        screen.convertRectToBacking(NSRect::new(NSPoint::new(0.0, 0.0), frame.size));
    let width = backing_frame.size.width.max(1.0).round() as u32;
    let height = backing_frame.size.height.max(1.0).round() as u32;
    let scale_factor = if frame.size.width > 0.0 {
        backing_frame.size.width / frame.size.width
    } else {
        1.0
    };
    let fingerprint = format!("{name}|{width}x{height}|{scale_factor:.3}");

    Some(DisplayOption {
        is_primary: primary_display_id == Some(id.as_str()),
        id,
        fingerprint,
        name,
        width,
        height,
        scale_factor,
    })
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_appkit_screen(
    screens: &NSArray<NSScreen>,
    preference: Option<&DisplayPreference>,
) -> (Option<Retained<NSScreen>>, bool) {
    if let Some(preference) = preference {
        if let Some(screen) = screens
            .iter()
            .find(|screen| appkit_display_id(screen).is_some_and(|id| id == preference.id))
        {
            return (Some(screen), false);
        }
        if let Some(screen) = screens.iter().find(|screen| {
            appkit_display_option(screen, None)
                .is_some_and(|option| option.fingerprint == preference.fingerprint)
        }) {
            return (Some(screen), false);
        }
    }

    (screens.iter().next(), preference.is_some())
}

#[cfg(target_os = "macos")]
fn display_state_for_platform(window: &tauri::WebviewWindow) -> Option<DisplayStateSnapshot> {
    let mtm = MainThreadMarker::new()?;
    let screens = NSScreen::screens(mtm);
    let primary_display_id = screens
        .iter()
        .next()
        .and_then(|screen| appkit_display_id(&screen));
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let (active_screen, fallback_active) = resolve_appkit_screen(&screens, preference.as_ref());
    let active_display_id = active_screen.as_deref().and_then(appkit_display_id);
    let selected_display_id = if preference.is_none() || !fallback_active {
        active_display_id.clone()
    } else {
        None
    };
    let displays = screens
        .iter()
        .filter_map(|screen| appkit_display_option(&screen, primary_display_id.as_deref()))
        .collect();

    Some(DisplayStateSnapshot {
        displays,
        preferred_display_id: preference.as_ref().map(|selection| selection.id.clone()),
        preferred_display_name: preference.map(|selection| selection.name),
        selected_display_id,
        active_display_id,
        fallback_active,
    })
}

#[cfg(not(target_os = "macos"))]
fn monitor_display_option(
    monitor: &tauri::window::Monitor,
    primary_id: Option<&str>,
) -> DisplayOption {
    let name = monitor
        .name()
        .cloned()
        .unwrap_or_else(|| "Display".to_string());
    let size = monitor.size();
    let position = monitor.position();
    let scale_factor = monitor.scale_factor();
    let fingerprint = format!("{name}|{}x{}|{scale_factor:.3}", size.width, size.height);
    let id = format!("monitor:{fingerprint}|{},{}", position.x, position.y);
    DisplayOption {
        is_primary: primary_id == Some(id.as_str()),
        id,
        fingerprint,
        name,
        width: size.width,
        height: size.height,
        scale_factor,
    }
}

#[cfg(not(target_os = "macos"))]
fn display_state_for_platform(window: &tauri::WebviewWindow) -> Option<DisplayStateSnapshot> {
    let monitors = window.available_monitors().ok()?;
    let primary = window.primary_monitor().ok().flatten();
    let primary_option = primary
        .as_ref()
        .map(|monitor| monitor_display_option(monitor, None));
    let primary_id = primary_option.as_ref().map(|option| option.id.as_str());
    let displays: Vec<_> = monitors
        .iter()
        .map(|monitor| monitor_display_option(monitor, primary_id))
        .collect();
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let matched = preferred_display_index(&displays, preference.as_ref())
        .and_then(|index| displays.get(index));
    let fallback_active = preference.is_some() && matched.is_none();
    let active_display_id = matched
        .map(|display| display.id.clone())
        .or_else(|| primary_option.map(|display| display.id))
        .or_else(|| displays.first().map(|display| display.id.clone()));
    let selected_display_id = if preference.is_none() || !fallback_active {
        active_display_id.clone()
    } else {
        None
    };

    Some(DisplayStateSnapshot {
        displays,
        preferred_display_id: preference.as_ref().map(|selection| selection.id.clone()),
        preferred_display_name: preference.map(|selection| selection.name),
        selected_display_id,
        active_display_id,
        fallback_active,
    })
}

#[tauri::command]
fn display_state(window: tauri::WebviewWindow) -> Result<DisplayStateSnapshot, String> {
    if let Some(state) = display_state_for_platform(&window) {
        return Ok(state);
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(display_state_for_platform(&scheduled_window));
        })
        .map_err(|error| format!("Could not query displays: {error}"))?;

    receiver
        .recv_timeout(Duration::from_millis(500))
        .map_err(|_| "Timed out while querying displays".to_string())?
        .ok_or_else(|| "No displays are available".to_string())
}

#[tauri::command]
fn select_display(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    display_id: String,
) -> Result<DisplayStateSnapshot, String> {
    let current = display_state(window.clone())?;
    let selected = current
        .displays
        .iter()
        .find(|display| display.id == display_id)
        .ok_or_else(|| "That display is no longer connected".to_string())?;
    let preference = DisplayPreference {
        id: selected.id.clone(),
        fingerprint: selected.fingerprint.clone(),
        name: selected.name.clone(),
    };

    let preference_state = app.state::<DisplayPreferenceState>();
    let previous = preference_state.get();
    preference_state.set(Some(preference.clone()));
    if let Err(error) = position_main_window_on_selected_display(&window) {
        preference_state.set(previous.clone());
        let _ = position_main_window(&window);
        return Err(error);
    }
    if let Err(error) = write_display_preference(&app, &preference) {
        preference_state.set(previous);
        let _ = position_main_window(&window);
        return Err(error);
    }
    display_state(window)
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
    let screens = NSScreen::screens(mtm);
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let (screen, _) = resolve_appkit_screen(&screens, preference.as_ref());
    let screen = screen?;

    let screen_frame = screen.frame();
    let visible_frame = screen.visibleFrame();
    let safe_insets = screen.safeAreaInsets();
    let left_area = screen.auxiliaryTopLeftArea();
    let right_area = screen.auxiliaryTopRightArea();
    let derived_camera_width =
        screen_frame.size.width - left_area.size.width - right_area.size.width + 4.0;
    let camera_width = if safe_insets.top > 0.0 {
        derived_camera_width.clamp(160.0, 260.0)
    } else {
        184.0
    };
    let menu_bar_height = (screen_frame.origin.y + screen_frame.size.height)
        - (visible_frame.origin.y + visible_frame.size.height);
    let closed_height = if safe_insets.top > 0.0 {
        safe_insets.top.clamp(28.0, 44.0)
    } else {
        menu_bar_height.clamp(28.0, 40.0)
    };

    Some((camera_width, closed_height))
}

#[cfg(not(target_os = "macos"))]
fn notch_metrics_for_platform(_window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    Some((184.0, 36.0))
}

#[tauri::command]
fn set_panel_open(
    window: tauri::WebviewWindow,
    open: bool,
    focus: bool,
    width: f64,
    height: f64,
) -> Result<(), String> {
    set_main_window_frame(&window, width, height)
        .map_err(|error| format!("Failed to resize/recenter Agent Halo window: {error}"))?;

    if open && focus {
        let _ = window.set_focus();
    }

    Ok(())
}

fn set_main_window_frame(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
) -> tauri::Result<()> {
    set_main_window_frame_for_platform(window, width, height)
}

#[cfg(target_os = "macos")]
fn set_main_window_frame_for_platform(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
) -> tauri::Result<()> {
    if position_main_window_with_appkit(window, Some((width, height)), false) {
        return Ok(());
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    window.run_on_main_thread(move || {
        let _ = sender.send(position_main_window_with_appkit(
            &scheduled_window,
            Some((width, height)),
            false,
        ));
    })?;

    if receiver
        .recv_timeout(Duration::from_millis(250))
        .unwrap_or(false)
    {
        return Ok(());
    }

    window.set_size(Size::Logical(LogicalSize::new(width, height)))?;
    position_main_window_for_logical_width(window, width)
}

#[cfg(not(target_os = "macos"))]
fn set_main_window_frame_for_platform(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
) -> tauri::Result<()> {
    window.set_size(Size::Logical(LogicalSize::new(width, height)))?;
    position_main_window_for_logical_width(window, width)
}

fn position_main_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let width = f64::from(window.outer_size()?.width);
    position_main_window_for_physical_width(window, width)
}

#[cfg(target_os = "macos")]
fn main_window_matches_selected_frame(window: &tauri::WebviewWindow) -> Option<bool> {
    let mtm = MainThreadMarker::new()?;
    let ns_window_ptr = window.ns_window().ok()?;
    let screens = NSScreen::screens(mtm);
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let (screen, _) = resolve_appkit_screen(&screens, preference.as_ref());
    let screen = screen?;

    // SAFETY: Tauri owns this NSWindow and this helper only runs on AppKit's main thread.
    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        let frame = ns_window.frame();
        let screen_frame = screen.frame();
        let expected_x =
            screen_frame.origin.x + (screen_frame.size.width / 2.0) - (frame.size.width / 2.0);
        let expected_y = screen_frame.origin.y + screen_frame.size.height - frame.size.height;
        Some(
            (frame.origin.x - expected_x).abs() <= 1.0
                && (frame.origin.y - expected_y).abs() <= 1.0,
        )
    }
}

#[cfg(not(target_os = "macos"))]
fn main_window_matches_selected_frame(window: &tauri::WebviewWindow) -> Option<bool> {
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let monitors = window.available_monitors().ok()?;
    let monitor = preference
        .as_ref()
        .and_then(|selection| {
            monitors
                .iter()
                .find(|monitor| monitor_display_option(monitor, None).id == selection.id)
                .or_else(|| {
                    monitors.iter().find(|monitor| {
                        monitor_display_option(monitor, None).fingerprint == selection.fingerprint
                    })
                })
        })
        .cloned()
        .or(window.primary_monitor().ok().flatten())
        .or(window.current_monitor().ok().flatten())?;
    let frame_position = window.outer_position().ok()?;
    let frame_width = window.outer_size().ok()?.width;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let expected_x =
        monitor_position.x + ((monitor_size.width.saturating_sub(frame_width)) / 2) as i32;
    Some(frame_position.x == expected_x && frame_position.y == monitor_position.y)
}

#[tauri::command]
fn reconcile_display(window: tauri::WebviewWindow) -> Result<DisplayStateSnapshot, String> {
    reconcile_display_position(&window)?;
    display_state(window)
}

#[cfg(target_os = "macos")]
fn reconcile_display_position(window: &tauri::WebviewWindow) -> Result<(), String> {
    if let Some(matches) = main_window_matches_selected_frame(window) {
        if matches || position_main_window_with_appkit(window, None, false) {
            return Ok(());
        }
        return Err("Could not reconcile Agent Halo display position".to_string());
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    window
        .run_on_main_thread(move || {
            let matches = main_window_matches_selected_frame(&scheduled_window) == Some(true);
            let positioned =
                matches || position_main_window_with_appkit(&scheduled_window, None, false);
            let _ = sender.send(positioned);
        })
        .map_err(|error| format!("Could not schedule display reconciliation: {error}"))?;

    if receiver
        .recv_timeout(Duration::from_millis(500))
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err("Timed out while reconciling Agent Halo display position".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn reconcile_display_position(window: &tauri::WebviewWindow) -> Result<(), String> {
    if main_window_matches_selected_frame(window) == Some(true) {
        return Ok(());
    }
    position_main_window(window)
        .map_err(|error| format!("Could not reconcile Agent Halo display position: {error}"))
}

#[cfg(target_os = "macos")]
fn position_main_window_on_selected_display(window: &tauri::WebviewWindow) -> Result<(), String> {
    if position_main_window_with_appkit(window, None, true) {
        return Ok(());
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(position_main_window_with_appkit(
                &scheduled_window,
                None,
                true,
            ));
        })
        .map_err(|error| format!("Could not schedule display move: {error}"))?;

    if receiver
        .recv_timeout(Duration::from_millis(500))
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err("The selected display disconnected before Agent Halo could move".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn position_main_window_on_selected_display(window: &tauri::WebviewWindow) -> Result<(), String> {
    let state = display_state(window.clone())?;
    if state.selected_display_id.is_none() {
        return Err("The selected display disconnected before Agent Halo could move".to_string());
    }
    position_main_window(window)
        .map_err(|error| format!("Could not move Agent Halo to the selected display: {error}"))
}

fn position_main_window_for_logical_width(
    window: &tauri::WebviewWindow,
    width: f64,
) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    position_main_window_for_physical_width(window, width * scale)
}

fn position_main_window_for_physical_width(
    window: &tauri::WebviewWindow,
    width: f64,
) -> tauri::Result<()> {
    position_main_window_for_platform(window, width)
}

#[cfg(target_os = "macos")]
fn position_main_window_for_platform(
    window: &tauri::WebviewWindow,
    _width: f64,
) -> tauri::Result<()> {
    if position_main_window_with_appkit(window, None, false) {
        return Ok(());
    }

    let scheduled_window = window.clone();
    window.run_on_main_thread(move || {
        let _ = position_main_window_with_appkit(&scheduled_window, None, false);
    })?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn position_main_window_for_platform(
    window: &tauri::WebviewWindow,
    width: f64,
) -> tauri::Result<()> {
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let monitors = window.available_monitors()?;
    let monitor = preference
        .as_ref()
        .and_then(|selection| {
            monitors
                .iter()
                .find(|monitor| monitor_display_option(monitor, None).id == selection.id)
                .or_else(|| {
                    monitors.iter().find(|monitor| {
                        monitor_display_option(monitor, None).fingerprint == selection.fingerprint
                    })
                })
        })
        .cloned()
        .or(window.primary_monitor()?)
        .or(window.current_monitor()?);

    if let Some(monitor) = monitor {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let centered_offset =
            ((f64::from(monitor_size.width) - width).max(0.0) / 2.0).round() as i32;
        let x = monitor_position.x + centered_offset;
        window.set_position(tauri::PhysicalPosition::new(x, monitor_position.y))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn position_main_window_with_appkit(
    window: &tauri::WebviewWindow,
    target_size: Option<(f64, f64)>,
    require_preferred_display: bool,
) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };

    let Ok(ns_window_ptr) = window.ns_window() else {
        return false;
    };
    let screens = NSScreen::screens(mtm);
    let preference = window.app_handle().state::<DisplayPreferenceState>().get();
    let (screen, fallback_active) = resolve_appkit_screen(&screens, preference.as_ref());
    if require_preferred_display && fallback_active {
        return false;
    }
    let Some(screen) = screen else {
        return false;
    };

    // SAFETY: Tauri gives us the backing NSWindow pointer for this WebviewWindow.
    // We only touch AppKit from the main thread (guarded above), matching AppKit's thread rules.
    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
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
            ns_window.setFrame_display(
                NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
                true,
            );
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
        .icon(tauri::include_image!("icons/tray-icon.png"))
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

fn completion_pet_command_allowed(command: &str) -> bool {
    matches!(
        command,
        "activate_completion_pet"
            | "completion_pet_state"
            | "drag_completion_pet"
            | "hide_completion_pet"
            | "set_completion_pet_expanded"
            | "set_completion_pet_movement"
            | "submit_completion_pet_action"
    )
}

pub fn run() {
    let command_handler: Box<tauri::ipc::InvokeHandler<tauri::Wry>> =
        Box::new(tauri::generate_handler![
            activate_completion_pet,
            agent_halo_mod_path,
            agent_halo_mod_status,
            agy_usage,
            bridge_health,
            cancel_pomodoro_notification,
            claude_usage,
            codex_usage,
            cursor_usage,
            display_state,
            drag_completion_pet,
            focus_terminal,
            install_agent_halo_mod,
            install_agent_halo_agy_hooks,
            agent_halo_agy_hook_status,
            hide_completion_pet,
            local_services,
            notch_metrics,
            notification_permission_state,
            open_external_url,
            reconcile_display,
            request_notification_permission,
            runtime_usage,
            schedule_pomodoro_notification,
            set_keep_awake,
            set_completion_pet_expanded,
            set_completion_pet_movement,
            set_panel_open,
            select_display,
            show_completion_pet,
            submit_completion_pet_action,
            take_completion_pet_action,
            completion_pet_state
        ]);
    let app = tauri::Builder::default()
        .manage(KeepAwakeState::default())
        .manage(DisplayPreferenceState::default())
        .manage(PomodoroNotificationState::default())
        .manage(CompletionPetWindowState::default())
        .manage(RuntimeUsageState::default())
        .manage(StandaloneBridgeState::default())
        .invoke_handler(move |invoke| {
            let from_pet = invoke.message.webview_ref().label() == "pet";
            if from_pet && !completion_pet_command_allowed(invoke.message.command()) {
                invoke
                    .resolver
                    .reject("The Completion Pet surface cannot access main-window commands");
                true
            } else {
                command_handler(invoke)
            }
        })
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            notification::initialize();
            let preference = read_display_preference(app.handle());
            app.state::<DisplayPreferenceState>().set(preference);
            let pet_position = pet_window::read_pet_position(app.handle());
            app.state::<CompletionPetWindowState>()
                .set_position(pet_position);

            match app.path().resolve(
                "agent-halo-bridge.mjs",
                tauri::path::BaseDirectory::Resource,
            ) {
                Ok(path) => {
                    if let Err(error) = app.state::<StandaloneBridgeState>().start(path) {
                        eprintln!("Agent Halo standalone bridge is unavailable: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("Agent Halo standalone bridge resource is unavailable: {error}");
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                position_main_window(&window)?;
                window.show()?;
            }
            setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Agent Halo desktop");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            app_handle.state::<StandaloneBridgeState>().stop();
            let _ = app_handle.state::<KeepAwakeState>().set_active(false);
            pet_window::hide_pet_on_exit(app_handle);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Moved(_),
            ..
        } if label == "pet" => {
            pet_window::schedule_pet_position_persist(app_handle);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "pet" => {
            api.prevent_close();
            pet_window::dismiss_pet(app_handle);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == "pet" => {
            pet_window::dismiss_pet(app_handle);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == "main" => {
            let _ = app_handle.state::<KeepAwakeState>().set_active(false);
        }
        _ => {}
    });
}

#[cfg(test)]
mod display_selection_tests {
    use super::*;

    #[test]
    fn herdr_focus_accepts_only_public_pane_identity_shape() {
        assert!(is_valid_herdr_pane_id("w1:p1"));
        assert!(is_valid_herdr_pane_id("wabc:pA9"));
        assert!(!is_valid_herdr_pane_id("p1"));
        assert!(!is_valid_herdr_pane_id("w1:../p1"));
        assert!(!is_valid_herdr_pane_id("w1:p1;open"));
    }

    #[test]
    fn herdr_focus_request_targets_exact_agent_pane() {
        let request = build_herdr_request("agent.focus", "w5:p2");
        assert_eq!(request["method"], "agent.focus");
        assert_eq!(request["params"]["target"], "w5:p2");
    }

    #[test]
    fn herdr_response_requires_matching_id_and_rejects_any_error_object() {
        assert!(validate_herdr_response(
            serde_json::json!({ "id": "expected", "result": { "type": "ok" } }),
            "expected",
        )
        .is_ok());
        assert!(validate_herdr_response(
            serde_json::json!({ "id": "other", "result": { "type": "ok" } }),
            "expected",
        )
        .is_err());
        assert!(validate_herdr_response(
            serde_json::json!({ "id": "expected", "error": {} }),
            "expected",
        )
        .is_err());
    }

    #[test]
    fn herdr_focus_rejects_reused_pane_identity() {
        let conversation_id = "local-conv-203";
        let payload = serde_json::json!({
            "result": {
                "agent": {
                    "agent": "letta",
                    "pane_id": "w1:p1",
                    "tokens": {
                        "letta_pid": "88759",
                        "letta_started_at": "1784870000000",
                        "letta_scope": herdr_scope_fingerprint(conversation_id),
                    }
                }
            }
        });

        assert!(verify_herdr_agent_identity(
            &payload,
            "w1:p1",
            conversation_id,
            88_759,
            1_784_870_000_500,
        )
        .is_ok());
        assert!(verify_herdr_agent_identity(
            &payload,
            "w1:p1",
            conversation_id,
            99_999,
            1_784_870_000_500,
        )
        .is_err());
        assert!(verify_herdr_agent_identity(
            &payload,
            "w1:p1",
            "local-conv-other",
            88_759,
            1_784_870_000_500,
        )
        .is_err());
    }

    #[test]
    #[ignore = "requires an explicitly selected live Herdr pane and activates Ghostty"]
    fn live_herdr_focus_smoke() {
        let socket = std::env::var("AGENT_HALO_TEST_HERDR_SOCKET").expect("live Herdr socket");
        let pane = std::env::var("AGENT_HALO_TEST_HERDR_PANE").expect("live Herdr pane");
        let conversation =
            std::env::var("AGENT_HALO_TEST_CONVERSATION").expect("live conversation");
        let source_pid = std::env::var("AGENT_HALO_TEST_SOURCE_PID")
            .expect("live source PID")
            .parse::<u32>()
            .expect("numeric source PID");
        let source_started_at_ms = std::env::var("AGENT_HALO_TEST_SOURCE_STARTED_AT_MS")
            .expect("live source start")
            .parse::<u64>()
            .expect("numeric source start");

        let result = focus_herdr_pane(
            &socket,
            &pane,
            &conversation,
            source_pid,
            source_started_at_ms,
        )
        .expect("live Herdr focus should succeed");
        assert_eq!(result, format!("Focused Herdr · {pane}"));
    }

    #[test]
    fn completion_pet_surface_cannot_call_main_window_commands() {
        for command in [
            "activate_completion_pet",
            "completion_pet_state",
            "drag_completion_pet",
            "hide_completion_pet",
            "set_completion_pet_expanded",
            "set_completion_pet_movement",
            "submit_completion_pet_action",
        ] {
            assert!(completion_pet_command_allowed(command));
        }
        for command in [
            "focus_terminal",
            "install_agent_halo_mod",
            "install_agent_halo_agy_hooks",
            "agent_halo_agy_hook_status",
            "schedule_pomodoro_notification",
            "set_keep_awake",
            "show_completion_pet",
            "take_completion_pet_action",
        ] {
            assert!(!completion_pet_command_allowed(command));
        }
    }

    fn display(id: &str, fingerprint: &str) -> DisplayOption {
        DisplayOption {
            id: id.to_string(),
            fingerprint: fingerprint.to_string(),
            name: id.to_string(),
            width: 2560,
            height: 1440,
            scale_factor: 2.0,
            is_primary: id == "primary",
        }
    }

    #[test]
    fn selected_display_matches_exact_native_id_first() {
        let displays = vec![
            display("same-model-a", "studio"),
            display("external", "studio"),
        ];
        let preference = DisplayPreference {
            id: "external".to_string(),
            fingerprint: "studio".to_string(),
            name: "Studio Display".to_string(),
        };

        assert_eq!(
            preferred_display_index(&displays, Some(&preference)),
            Some(1)
        );
    }

    #[test]
    fn selected_display_recovers_by_fingerprint_when_native_id_changes() {
        let displays = vec![display("primary", "built-in"), display("new-id", "studio")];
        let preference = DisplayPreference {
            id: "old-id".to_string(),
            fingerprint: "studio".to_string(),
            name: "Studio Display".to_string(),
        };

        assert_eq!(
            preferred_display_index(&displays, Some(&preference)),
            Some(1)
        );
    }

    #[test]
    fn disconnected_preference_has_no_match_so_platform_can_fallback_to_primary() {
        let displays = vec![display("primary", "built-in")];
        let preference = DisplayPreference {
            id: "external".to_string(),
            fingerprint: "studio".to_string(),
            name: "Studio Display".to_string(),
        };

        assert_eq!(preferred_display_index(&displays, Some(&preference)), None);
        assert_eq!(preferred_display_index(&displays, None), None);
    }

    fn claude_auth(access_token: &str, refresh_token: &str) -> ClaudeAuthState {
        ClaudeAuthState {
            credentials: ClaudeCredentialsFile {
                claude_ai_oauth: Some(ClaudeOauth {
                    access_token: Some(access_token.to_string()),
                    refresh_token: Some(refresh_token.to_string()),
                    expires_at: None,
                    subscription_type: None,
                    rate_limit_tier: None,
                    scopes: Some(vec!["user:profile".to_string()]),
                }),
            },
            service_name: Some("Claude Code-credentials".to_string()),
            file_path: None,
            inference_only: false,
            oauth_config: ClaudeOauthConfig {
                usage_url: CLAUDE_USAGE_URL.to_string(),
                refresh_url: CLAUDE_REFRESH_URL.to_string(),
                client_id: CLAUDE_CLIENT_ID.to_string(),
                oauth_file_suffix: String::new(),
            },
        }
    }

    #[test]
    fn claude_environment_token_is_a_fallback_not_a_stored_login_override() {
        let stored = claude_auth("stored-access", "stored-refresh");
        let candidates = claude_auth_candidates_from(
            vec![stored.clone()],
            Some("environment-access".to_string()),
            stored.oauth_config.clone(),
        );

        assert_eq!(candidates.len(), 2);
        assert_eq!(
            claude_access_token(&candidates[0]).as_deref(),
            Ok("stored-access")
        );
        assert!(!candidates[0].inference_only);
        assert_eq!(
            claude_access_token(&candidates[1]).as_deref(),
            Ok("environment-access")
        );
        assert!(candidates[1].inference_only);
    }

    #[test]
    fn claude_last_good_cache_is_credential_scoped() {
        let first = claude_auth("first-access", "first-refresh");
        let second = claude_auth("second-access", "second-refresh");
        let snapshot = CodexUsageSnapshot {
            provider_id: "claude".to_string(),
            display_name: "Claude Code".to_string(),
            plan: Some("Max".to_string()),
            lines: vec![],
            fetched_at: now_iso(),
        };

        store_claude_last_good(&first, snapshot);
        assert!(read_claude_last_good(&first).is_some());
        assert!(read_claude_last_good(&second).is_none());
    }

    #[test]
    fn claude_rate_limit_keeps_the_last_good_timestamp() {
        let auth = claude_auth("first-access", "first-refresh");
        let snapshot = CodexUsageSnapshot {
            provider_id: "claude".to_string(),
            display_name: "Claude Code".to_string(),
            plan: Some("Max".to_string()),
            lines: vec![],
            fetched_at: "2026-07-25T12:00:00Z".to_string(),
        };

        store_claude_last_good(&auth, snapshot);
        let rate_limited = claude_rate_limited_snapshot(&auth, Some(60));

        assert_eq!(rate_limited.fetched_at, "2026-07-25T12:00:00Z");
        assert!(rate_limited
            .lines
            .iter()
            .any(|line| matches!(line, CodexMetricLine::Text { label, .. } if label == "Status")));
    }

    #[test]
    fn codex_history_cache_identity_includes_account_and_home() {
        let base_auth = CodexAuthFile {
            openai_api_key: None,
            tokens: Some(CodexAuthTokens {
                access_token: Some("access".to_string()),
                refresh_token: Some("refresh".to_string()),
                id_token: None,
                account_id: Some("account-a".to_string()),
            }),
            last_refresh: None,
        };
        let first = CodexAuthState {
            auth: base_auth.clone(),
            source: CodexAuthSource::File(PathBuf::from("/tmp/codex-a/auth.json")),
        };
        let mut other_account = base_auth;
        other_account.tokens.as_mut().unwrap().account_id = Some("account-b".to_string());
        let second = CodexAuthState {
            auth: other_account,
            source: CodexAuthSource::File(PathBuf::from("/tmp/codex-a/auth.json")),
        };

        assert_ne!(
            codex_ccusage_cache_key(&first),
            codex_ccusage_cache_key(&second)
        );
    }

    #[test]
    fn codex_history_day_keys_follow_the_given_local_offset() {
        let now = time::Date::from_calendar_date(2026, time::Month::July, 25)
            .unwrap()
            .with_hms(0, 30, 0)
            .unwrap()
            .assume_offset(time::UtcOffset::from_hms(7, 0, 0).unwrap());
        let (today, yesterday) = codex_history_day_keys(now);

        assert_eq!(today, "2026-07-25");
        assert_eq!(yesterday, "2026-07-24");
        assert_eq!(codex_ccusage_since_string_at(now, 30), "20260625");
    }

    #[test]
    fn ccusage_runner_stays_on_the_replay_safe_pinned_version() {
        assert_eq!(CCUSAGE_PACKAGE, "ccusage@20.0.18");
    }

    #[test]
    fn ccusage_publication_caches_before_releasing_waiters() {
        let cache = Mutex::new(None);
        let in_flight = Mutex::new(HashSet::from(["account-key".to_string()]));
        let usage = CcusageDailyUsage { daily: vec![] };

        publish_codex_ccusage_usage(&cache, &in_flight, "account-key".to_string(), &usage);

        assert!(cached_codex_ccusage_usage(&cache, "account-key").is_some());
        assert!(!in_flight.lock().unwrap().contains("account-key"));
    }

    #[test]
    fn cursor_session_uses_workos_jwt_subject() {
        let payload = URL_SAFE_NO_PAD.encode(r#"{"sub":"workos|user-42"}"#);
        let access_token = format!("header.{payload}.signature");

        let session = cursor_session_from_access_token(&access_token).unwrap();

        assert_eq!(session.user_id, "user-42");
        assert_eq!(session.cookie_value, format!("user-42%3A%3A{access_token}"));
        assert!(cursor_session_from_access_token("not-a-jwt").is_none());
    }

    #[test]
    fn cursor_export_parser_handles_quoted_rows_and_skips_bad_tokens() {
        let csv = concat!(
            "Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens\n",
            "2026-07-24T23:30:00Z,\"gpt, test\",1,\"2,000\",3,4\n",
            "2026-07-25T01:30:00Z,bad-model,invalid,2,3,4\n",
            "2026-07-25T01:30:00Z,claude,5,,7,8\n"
        );
        let offset = time::UtcOffset::from_hms(7, 0, 0).unwrap();

        let export = parse_cursor_usage_export(csv, offset).unwrap();

        assert_eq!(export.daily.len(), 1);
        assert_eq!(export.daily[0].date, "2026-07-25");
        assert_eq!(export.daily[0].total_tokens, 2_028);
        assert_eq!(export.daily[0].models["gpt, test"], 2_008);
        assert_eq!(export.daily[0].models["claude"], 20);
        assert!(parse_cursor_usage_export("Date,Model\n", offset).is_err());
        assert!(parse_cursor_usage_export("Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens\n\"unterminated", offset).is_err());
    }

    #[test]
    fn cursor_export_aggregation_appends_history_without_pricing() {
        let export = CursorUsageExport {
            daily: vec![
                CursorUsageExportDay {
                    date: "2026-07-24".to_string(),
                    total_tokens: 400,
                    models: BTreeMap::from([("claude".to_string(), 400)]),
                },
                CursorUsageExportDay {
                    date: "2026-07-25".to_string(),
                    total_tokens: 600,
                    models: BTreeMap::from([("claude".to_string(), 100), ("gpt".to_string(), 500)]),
                },
            ],
        };
        let now = time::Date::from_calendar_date(2026, time::Month::July, 25)
            .unwrap()
            .with_hms(12, 0, 0)
            .unwrap()
            .assume_offset(time::UtcOffset::UTC);
        let mut snapshot = CodexUsageSnapshot {
            provider_id: "cursor".to_string(),
            display_name: "Cursor".to_string(),
            plan: None,
            lines: vec![],
            fetched_at: now_iso(),
        };

        append_cursor_usage_export(&mut snapshot, &export, now);

        assert!(snapshot.lines.iter().any(|line| matches!(line, CodexMetricLine::Text { label, value } if label == "Today" && value == "600 tokens")));
        assert!(snapshot.lines.iter().any(|line| matches!(line, CodexMetricLine::Text { label, value } if label == "Yesterday" && value == "400 tokens")));
        assert!(snapshot.lines.iter().any(|line| matches!(line, CodexMetricLine::Text { label, value } if label == "Last 30 Days" && value == "1K tokens")));
        assert!(snapshot.lines.iter().any(|line| matches!(line, CodexMetricLine::BarChart { label, points, .. } if label == "Usage Trend" && points.len() == 2)));
        assert!(snapshot.lines.iter().any(|line| matches!(line, CodexMetricLine::Text { label, value } if label == "gpt" && value == "50%")));
    }

    #[test]
    fn codex_reset_credits_prefer_dedicated_expiries_and_fallback_to_embedded_count() {
        let usage: CodexUsageEnvelope = serde_json::from_value(serde_json::json!({
            "rate_limit_reset_credits": { "available_count": 1 }
        }))
        .unwrap();
        let dedicated: CodexResetCreditsEnvelope = serde_json::from_value(serde_json::json!({
            "available_count": 2,
            "credits": [
                { "status": "available", "expires_at": "2026-08-03T12:00:00Z" },
                { "status": "consumed", "expires_at": "2026-08-01T12:00:00Z" },
                { "expires_at": "2026-08-01T09:00:00Z" }
            ]
        }))
        .unwrap();

        let (available, expiries) = read_codex_reset_credits(&usage, Some(&dedicated)).unwrap();

        assert_eq!(available, 2);
        assert_eq!(expiries.len(), 2);
        assert!(
            format_reset_credit_value(available, &expiries).starts_with("2 available · expires ")
        );

        let malformed_dedicated: CodexResetCreditsEnvelope = serde_json::from_value(
            serde_json::json!({ "available_count": "unknown", "credits": [] }),
        )
        .unwrap();
        assert_eq!(
            read_codex_reset_credits(&usage, Some(&malformed_dedicated)).map(|(count, _)| count),
            Some(1)
        );
    }

    #[test]
    fn codex_mapping_classifies_windows_and_only_surfaces_spark() {
        let usage: CodexUsageEnvelope = serde_json::from_value(serde_json::json!({
            "rate_limit": {
                "primary_window": { "used_percent": 10, "limit_window_seconds": 604800 },
                "secondary_window": { "used_percent": 20, "limit_window_seconds": 18000 }
            },
            "additional_rate_limits": [
                {
                    "limit_name": "GPT-5.4-Codex",
                    "rate_limit": { "primary_window": { "used_percent": 30 } }
                },
                {
                    "metered_feature": "GPT-5.3-Codex-Spark",
                    "rate_limit": {
                        "primary_window": { "used_percent": 40, "limit_window_seconds": 18000 },
                        "secondary_window": { "used_percent": 50, "limit_window_seconds": 604800 }
                    }
                }
            ]
        }))
        .unwrap();

        let snapshot = build_codex_usage_snapshot(usage, &reqwest::header::HeaderMap::new(), None);
        let labels = snapshot
            .lines
            .iter()
            .filter_map(|line| match line {
                CodexMetricLine::Progress { label, .. } => Some(label.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(labels, ["Session", "Weekly", "Spark", "Spark Weekly"]);
        assert!(!labels.iter().any(|label| label.contains("5.4")));
    }

    #[test]
    fn antigravity_summary_uses_only_exact_supported_bucket_ids() {
        let response = serde_json::json!({
            "groups": [{ "buckets": [
                { "bucketId": "gemini-5h", "displayName": "Renamed", "remainingFraction": 0.8 },
                { "bucketId": "3p-weekly", "remainingFraction": 0.4 },
                { "bucketId": "gemini-image-5h", "remainingFraction": 0.1 },
                { "bucketId": "gemini-weekly" }
            ] }]
        });

        let lines = build_antigravity_quota_summary_lines(&response).unwrap();
        let labels = lines
            .iter()
            .map(|line| match line {
                CodexMetricLine::Progress { label, .. } => label.as_str(),
                _ => unreachable!(),
            })
            .collect::<Vec<_>>();

        assert_eq!(labels, ["Gemini 5h", "Claude and GPT Weekly"]);
    }

    #[test]
    fn antigravity_valid_empty_summary_is_authoritative_no_data() {
        let response = serde_json::json!({ "groups": [] });

        assert!(matches!(
            build_antigravity_quota_summary_lines(&response),
            Some(lines) if lines.is_empty()
        ));
        assert!(build_antigravity_quota_summary_lines(&serde_json::json!({})).is_none());
    }

    #[test]
    fn antigravity_cloud_auth_unwraps_the_agy_keychain_shape() {
        let payload = r#"{"token":{"access_token":"access","refresh_token":"refresh"}}"#;
        let wrapped = format!("go-keyring-base64:{}", STANDARD.encode(payload));
        let text = unwrap_go_keyring(&wrapped).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();

        assert_eq!(
            find_antigravity_auth_string(&value, &["access_token"]),
            Some("access".to_string())
        );
        assert_eq!(
            find_antigravity_auth_string(&value, &["refresh_token"]),
            Some("refresh".to_string())
        );
    }

    #[test]
    fn antigravity_oauth_client_reads_local_config_shape_without_bundled_secret() {
        let value = serde_json::json!({
            "client_id": "local-client-id",
            "client_secret": "local-client-secret"
        });

        assert_eq!(
            parse_antigravity_oauth_client(&value),
            Some((
                "local-client-id".to_string(),
                "local-client-secret".to_string()
            ))
        );
        assert!(parse_antigravity_oauth_client(&serde_json::json!({
            "client_id": "local-client-id"
        }))
        .is_none());
    }

    #[test]
    fn antigravity_cloud_summary_accepts_the_bare_remote_envelope() {
        let response = serde_json::json!({
            "response": { "groups": [{ "buckets": [
                { "bucketId": "gemini-5h", "remainingFraction": 0.75 }
            ] }] }
        });

        let lines = build_antigravity_quota_summary_lines(&response).unwrap();

        assert!(matches!(
            lines.first(),
            Some(CodexMetricLine::Progress { label, used, .. })
                if label == "Gemini 5h" && *used == 25.0
        ));
    }
}
