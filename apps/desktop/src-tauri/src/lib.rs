use std::{
    collections::BTreeMap,
    error::Error as StdError,
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    LogicalSize, Manager, Size,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

mod keep_awake;
mod notification;

use keep_awake::KeepAwakeState;
use notification::{
    cancel_pomodoro_notification, notification_permission_state, request_notification_permission,
    schedule_pomodoro_notification, PomodoroNotificationState,
};

#[cfg(target_os = "macos")]
use objc2::{msg_send, rc::Retained, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};

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
const CCUSAGE_PACKAGE: &str = "ccusage@20.0.14";
const CCUSAGE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const CCUSAGE_TIMEOUT: Duration = Duration::from_secs(15);
const OPENUSAGE_PROXY_CONFIG_PATH: &str = ".openusage/config.json";
const AGY_LS_SERVICE: &str = "exa.language_server_pb.LanguageServerService";
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
const CURSOR_REFRESH_URL: &str = "https://api2.cursor.sh/oauth/token";
const CURSOR_CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const CURSOR_ACCESS_KEYCHAIN_SERVICE: &str = "cursor-access-token";
const CURSOR_REFRESH_KEYCHAIN_SERVICE: &str = "cursor-refresh-token";
const GROK_AUTH_PATH: &str = ".grok/auth.json";
const GROK_BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing";
const GROK_SETTINGS_URL: &str = "https://cli-chat-proxy.grok.com/v1/settings";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayPreference {
    id: String,
    fingerprint: String,
    #[serde(default)]
    name: String,
}

#[derive(Default)]
struct DisplayPreferenceState {
    selection: Mutex<Option<DisplayPreference>>,
}

impl DisplayPreferenceState {
    fn get(&self) -> Option<DisplayPreference> {
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
struct DisplayOption {
    id: String,
    fingerprint: String,
    name: String,
    width: u32,
    height: u32,
    scale_factor: f64,
    is_primary: bool,
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
const GROK_TOKEN_AUTH_HEADER: &str = "xai-grok-cli";

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
    Keychain,
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

static CLAUDE_LAST_GOOD_USAGE: OnceLock<Mutex<Option<CodexUsageSnapshot>>> = OnceLock::new();

static CODEX_CCUSAGE_CACHE: OnceLock<Mutex<Option<CcusageCacheEntry>>> = OnceLock::new();

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
struct CursorAuthState {
    access_token: Option<String>,
    refresh_token: Option<String>,
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

#[tauri::command]
fn bridge_health() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 47_621));
    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

#[tauri::command]
fn set_keep_awake(state: tauri::State<'_, KeepAwakeState>, active: bool) -> Result<bool, String> {
    state.set_active(active)
}

#[tauri::command]
fn codex_usage() -> Result<CodexUsageSnapshot, String> {
    let mut auth_state = load_codex_auth()?;
    let client = usage_client("Codex")?;

    match fetch_codex_usage(&client, &auth_state) {
        Ok((usage, headers)) => {
            let reset_credits = fetch_codex_reset_credits_best_effort(&client, &auth_state);
            let mut snapshot = build_codex_usage_snapshot(usage, &headers, reset_credits.as_ref());
            append_codex_local_usage(&mut snapshot, &auth_state);
            Ok(snapshot)
        }
        Err(CodexUsageFetchError::Auth) => {
            refresh_codex_auth(&client, &mut auth_state)?;
            let (usage, headers) =
                fetch_codex_usage(&client, &auth_state).map_err(|error| match error {
                    CodexUsageFetchError::Auth => {
                        "Codex session expired. Run `codex` to log in again.".to_string()
                    }
                    CodexUsageFetchError::RateLimited(_) => {
                        "Codex usage is rate limited. Try again shortly.".to_string()
                    }
                    CodexUsageFetchError::Other(message) => message,
                })?;
            let reset_credits = fetch_codex_reset_credits_best_effort(&client, &auth_state);
            let mut snapshot = build_codex_usage_snapshot(usage, &headers, reset_credits.as_ref());
            append_codex_local_usage(&mut snapshot, &auth_state);
            Ok(snapshot)
        }
        Err(CodexUsageFetchError::RateLimited(_)) => {
            Err("Codex usage is rate limited. Try again shortly.".to_string())
        }
        Err(CodexUsageFetchError::Other(message)) => Err(message),
    }
}

#[tauri::command]
fn agy_usage() -> Result<CodexUsageSnapshot, String> {
    if let Some(snapshot) = probe_antigravity_ls_usage() {
        return Ok(snapshot);
    }
    if let Some(snapshot) = probe_antigravity_usage_with_ephemeral_agy() {
        return Ok(snapshot);
    }

    Err("Antigravity usage unavailable. Start `agy` or Antigravity, then refresh.".to_string())
}

#[tauri::command]
fn claude_usage() -> Result<CodexUsageSnapshot, String> {
    let mut auth = load_claude_auth()
        .ok_or_else(|| "Claude Code auth not found. Run `claude` to log in.".to_string())?;
    let client = usage_client("Claude Code")?;

    if !claude_can_fetch_live_usage(&auth) {
        return Ok(build_claude_status_snapshot(
            &auth,
            "Re-login for live usage. Run `claude` and sign in again.".to_string(),
        ));
    }

    if claude_needs_refresh(&auth) {
        if let Err(message) = refresh_claude_token(&client, &mut auth) {
            return Ok(build_claude_status_snapshot(&auth, message));
        }
    }

    match fetch_claude_usage(&client, &auth) {
        Ok(usage) => Ok(store_claude_last_good(build_claude_usage_snapshot(
            usage, &auth,
        ))),
        Err(CodexUsageFetchError::Auth) => {
            if let Err(message) = refresh_claude_token(&client, &mut auth) {
                return Ok(build_claude_status_snapshot(&auth, message));
            }
            match fetch_claude_usage(&client, &auth) {
                Ok(usage) => Ok(store_claude_last_good(build_claude_usage_snapshot(
                    usage, &auth,
                ))),
                Err(CodexUsageFetchError::Auth) => Ok(build_claude_status_snapshot(
                    &auth,
                    "Claude Code session expired. Run `claude` to log in again.".to_string(),
                )),
                Err(CodexUsageFetchError::RateLimited(retry_after)) => {
                    Ok(claude_rate_limited_snapshot(&auth, retry_after))
                }
                Err(CodexUsageFetchError::Other(message)) => {
                    Ok(build_claude_status_snapshot(&auth, message))
                }
            }
        }
        Err(CodexUsageFetchError::RateLimited(retry_after)) => {
            Ok(claude_rate_limited_snapshot(&auth, retry_after))
        }
        Err(CodexUsageFetchError::Other(message)) => {
            Ok(build_claude_status_snapshot(&auth, message))
        }
    }
}

#[tauri::command]
fn cursor_usage() -> Result<CodexUsageSnapshot, String> {
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
    build_cursor_usage_snapshot(usage, plan)
}

#[tauri::command]
fn grok_usage() -> Result<CodexUsageSnapshot, String> {
    let token =
        load_grok_token().ok_or_else(|| "Grok not logged in. Run `grok login`.".to_string())?;
    let client = usage_client("Grok")?;
    let billing = client
        .get(GROK_BILLING_URL)
        .bearer_auth(&token)
        .header("X-XAI-Token-Auth", GROK_TOKEN_AUTH_HEADER)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .map_err(|error| format_http_send_error("Grok billing", &error))?;
    if billing.status() == reqwest::StatusCode::UNAUTHORIZED
        || billing.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("Grok auth expired. Run `grok login` again.".to_string());
    }
    if !billing.status().is_success() {
        return Err(format!(
            "Grok billing request failed (HTTP {})",
            billing.status().as_u16()
        ));
    }
    let billing = billing
        .json::<Value>()
        .map_err(|error| format!("Grok billing response invalid: {error}"))?;
    let plan = fetch_grok_plan(&client, &token);
    build_grok_usage_snapshot(billing, plan)
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

fn load_codex_auth() -> Result<CodexAuthState, String> {
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
                return Ok(CodexAuthState {
                    auth,
                    source: CodexAuthSource::File(path),
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
        return Ok(CodexAuthState {
            auth,
            source: CodexAuthSource::Keychain,
        });
    }

    if let Some(auth_state) = api_key_auth_state {
        return Ok(auth_state);
    }

    Err("Codex auth not found. Run `codex` to authenticate.".to_string())
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

    if let CodexAuthSource::File(path) = &auth_state.source {
        if let Ok(text) = serde_json::to_string_pretty(&auth_state.auth) {
            let _ = fs::write(path, text);
        }
    }

    Ok(())
}

fn build_codex_usage_snapshot(
    usage: CodexUsageEnvelope,
    headers: &reqwest::header::HeaderMap,
    reset_credits: Option<&CodexResetCreditsEnvelope>,
) -> CodexUsageSnapshot {
    let mut lines = Vec::new();
    let primary = read_percent_header(headers, "x-codex-primary-used-percent").or_else(|| {
        usage
            .rate_limit
            .as_ref()
            .and_then(|limit| limit.primary_window.as_ref())
            .and_then(|window| value_to_f64(window.used_percent.as_ref()))
    });
    let secondary = read_percent_header(headers, "x-codex-secondary-used-percent").or_else(|| {
        usage
            .rate_limit
            .as_ref()
            .and_then(|limit| limit.secondary_window.as_ref())
            .and_then(|window| value_to_f64(window.used_percent.as_ref()))
    });

    if let Some(value) = primary {
        let window = usage
            .rate_limit
            .as_ref()
            .and_then(|limit| limit.primary_window.as_ref());
        lines.push(progress_line(
            "Session",
            value,
            window,
            Some(5 * 60 * 60 * 1000),
        ));
    }
    if let Some(value) = secondary {
        let window = usage
            .rate_limit
            .as_ref()
            .and_then(|limit| limit.secondary_window.as_ref());
        lines.push(progress_line(
            "Weekly",
            value,
            window,
            Some(7 * 24 * 60 * 60 * 1000),
        ));
    }
    if let Some(additional_limits) = usage.additional_rate_limits.as_ref() {
        for entry in additional_limits {
            let Some(limit) = entry.rate_limit.as_ref() else {
                continue;
            };
            let label = codex_additional_limit_label(entry.limit_name.as_deref());
            if let Some(window) = limit.primary_window.as_ref() {
                if let Some(value) = value_to_f64(window.used_percent.as_ref()) {
                    lines.push(progress_line(
                        &label,
                        value,
                        Some(window),
                        Some(5 * 60 * 60 * 1000),
                    ));
                }
            }
            if let Some(window) = limit.secondary_window.as_ref() {
                if let Some(value) = value_to_f64(window.used_percent.as_ref()) {
                    lines.push(progress_line(
                        &format!("{label} Weekly"),
                        value,
                        Some(window),
                        Some(7 * 24 * 60 * 60 * 1000),
                    ));
                }
            }
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

    let now = time::OffsetDateTime::now_utc();
    let today_key = local_day_key(now);
    let yesterday_key = local_day_key(now - time::Duration::days(1));
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
            note: Some("Estimated from local Codex logs for the selected account.".to_string()),
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
    if let Ok(guard) = cache.lock() {
        if let Some(entry) = guard.as_ref() {
            if entry.key == key && entry.fetched_at.elapsed() < CCUSAGE_CACHE_TTL {
                return Some(entry.usage.clone());
            }
        }
    }

    let since = codex_ccusage_since_string(30);
    let home_path = codex_home_for_ccusage(auth_state);
    let usage = run_ccusage_codex_daily(&since, home_path.as_deref())?;
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CcusageCacheEntry {
            key,
            fetched_at: Instant::now(),
            usage: usage.clone(),
        });
    }
    Some(usage)
}

fn codex_ccusage_cache_key(auth_state: &CodexAuthState) -> String {
    codex_home_for_ccusage(auth_state).unwrap_or_else(|| "default".to_string())
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
        CodexAuthSource::Keychain => None,
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
    let since = time::OffsetDateTime::now_utc() - time::Duration::days(days_back);
    format!(
        "{:04}{:02}{:02}",
        since.year(),
        u8::from(since.month()),
        since.day()
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

fn codex_additional_limit_label(limit_name: Option<&str>) -> String {
    let Some(name) = limit_name.map(str::trim).filter(|value| !value.is_empty()) else {
        return "Model".to_string();
    };
    let short = name
        .strip_prefix("GPT-")
        .and_then(|value| value.split_once("-Codex-"))
        .map(|(_, suffix)| suffix)
        .unwrap_or(name)
        .trim();
    if short.is_empty() {
        "Model".to_string()
    } else {
        short.to_string()
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

fn load_claude_auth() -> Option<ClaudeAuthState> {
    let oauth_config = claude_oauth_config();
    let stored = load_stored_claude_auth(&oauth_config);
    let env_access_token = env_text("CLAUDE_CODE_OAUTH_TOKEN");
    let Some(env_access_token) = env_access_token else {
        return stored;
    };

    let mut credentials = stored
        .as_ref()
        .map(|state| state.credentials.clone())
        .unwrap_or(ClaudeCredentialsFile {
            claude_ai_oauth: Some(ClaudeOauth {
                access_token: None,
                refresh_token: None,
                expires_at: None,
                subscription_type: None,
                rate_limit_tier: None,
                scopes: None,
            }),
        });
    let oauth = credentials.claude_ai_oauth.get_or_insert(ClaudeOauth {
        access_token: None,
        refresh_token: None,
        expires_at: None,
        subscription_type: None,
        rate_limit_tier: None,
        scopes: None,
    });
    oauth.access_token = Some(env_access_token);

    Some(ClaudeAuthState {
        credentials,
        service_name: stored.as_ref().and_then(|state| state.service_name.clone()),
        file_path: stored.as_ref().and_then(|state| state.file_path.clone()),
        inference_only: true,
        oauth_config,
    })
}

fn load_stored_claude_auth(oauth_config: &ClaudeOauthConfig) -> Option<ClaudeAuthState> {
    load_claude_keychain_auth(oauth_config).or_else(|| load_claude_file_auth(oauth_config))
}

fn load_claude_keychain_auth(oauth_config: &ClaudeOauthConfig) -> Option<ClaudeAuthState> {
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
        return Some(ClaudeAuthState {
            credentials,
            service_name: Some(service),
            file_path: None,
            inference_only: false,
            oauth_config: oauth_config.clone(),
        });
    }
    None
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
    save_claude_auth(auth);
    Ok(())
}

fn save_claude_auth(auth: &ClaudeAuthState) {
    let Ok(text) = serde_json::to_string(&auth.credentials) else {
        return;
    };
    if let Some(path) = &auth.file_path {
        let _ = fs::write(path, text);
    } else if let Some(service) = &auth.service_name {
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("security")
                .args(["delete-generic-password", "-s", service])
                .output();
            let _ = Command::new("security")
                .args(["add-generic-password", "-s", service, "-w", &text])
                .output();
        }
    }
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

fn store_claude_last_good(snapshot: CodexUsageSnapshot) -> CodexUsageSnapshot {
    let cache = CLAUDE_LAST_GOOD_USAGE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(snapshot.clone());
    }
    snapshot
}

fn claude_rate_limited_snapshot(
    auth: &ClaudeAuthState,
    retry_after_seconds: Option<u64>,
) -> CodexUsageSnapshot {
    if let Some(mut snapshot) = read_claude_last_good() {
        snapshot.lines.push(CodexMetricLine::Text {
            label: "Status".to_string(),
            value: claude_rate_limit_message(retry_after_seconds, true),
        });
        snapshot.fetched_at = now_iso();
        return snapshot;
    }
    build_claude_status_snapshot(auth, claude_rate_limit_message(retry_after_seconds, false))
}

fn read_claude_last_good() -> Option<CodexUsageSnapshot> {
    CLAUDE_LAST_GOOD_USAGE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
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

fn load_cursor_auth() -> Option<CursorAuthState> {
    let sqlite_access = read_cursor_state_value("cursorAuth/accessToken");
    let sqlite_refresh = read_cursor_state_value("cursorAuth/refreshToken");
    if sqlite_access.is_some() || sqlite_refresh.is_some() {
        return Some(CursorAuthState {
            access_token: sqlite_access,
            refresh_token: sqlite_refresh,
        });
    }

    let access_token = read_keychain_password(CURSOR_ACCESS_KEYCHAIN_SERVICE, None);
    let refresh_token = read_keychain_password(CURSOR_REFRESH_KEYCHAIN_SERVICE, None);
    if access_token.is_some() || refresh_token.is_some() {
        return Some(CursorAuthState {
            access_token,
            refresh_token,
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
    auth.access_token =
        maybe_string(body.get("access_token")).or_else(|| auth.access_token.clone());
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

fn load_grok_token() -> Option<String> {
    let path = home_path(GROK_AUTH_PATH)?;
    let auth = serde_json::from_str::<Value>(&fs::read_to_string(path).ok()?).ok()?;
    auth.as_object()?.values().find_map(|entry| {
        entry
            .get("key")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn fetch_grok_plan(client: &reqwest::blocking::Client, token: &str) -> Option<String> {
    let response = client
        .get(GROK_SETTINGS_URL)
        .bearer_auth(token)
        .header("X-XAI-Token-Auth", GROK_TOKEN_AUTH_HEADER)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    maybe_string(
        response
            .json::<Value>()
            .ok()?
            .get("subscription_tier_display"),
    )
}

fn build_grok_usage_snapshot(
    billing: Value,
    plan: Option<String>,
) -> Result<CodexUsageSnapshot, String> {
    let config = billing
        .get("config")
        .ok_or_else(|| "Grok billing response invalid.".to_string())?;
    let used = value_to_f64(config.get("used").and_then(|value| value.get("val")))
        .ok_or_else(|| "Grok usage data unavailable.".to_string())?;
    let limit = value_to_f64(
        config
            .get("monthlyLimit")
            .and_then(|value| value.get("val")),
    )
    .ok_or_else(|| "Grok usage data unavailable.".to_string())?;
    let on_demand =
        value_to_f64(config.get("onDemandCap").and_then(|value| value.get("val"))).unwrap_or(0.0);
    if limit <= 0.0 {
        return Err("Grok usage limit unavailable.".to_string());
    }
    let reset = maybe_string(config.get("billingPeriodEnd"));
    Ok(CodexUsageSnapshot {
        provider_id: "grok".to_string(),
        display_name: "Grok".to_string(),
        plan,
        lines: vec![
            progress_metric("Credits used", (used / limit) * 100.0, reset, None),
            CodexMetricLine::Text {
                label: "Pay as you go".to_string(),
                value: if on_demand > 0.0 {
                    format!("{} cap", on_demand.floor() as i64)
                } else {
                    "Disabled".to_string()
                },
            },
        ],
        fetched_at: now_iso(),
    })
}

#[derive(Debug, Clone)]
struct AntigravityLsDiscovery {
    pid: String,
    csrf: String,
    extension_port: Option<u16>,
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

fn probe_antigravity_usage_with_ephemeral_agy() -> Option<CodexUsageSnapshot> {
    let agy_path = find_agy_binary()?;
    let tmux_path = find_tmux_binary()?;
    let session = format!(
        "agent-halo-agy-usage-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_millis()
    );
    let cwd = std::env::current_dir()
        .ok()
        .filter(|path| path.is_dir())
        .or_else(home_dir)?;
    let command = format!(
        "exec {} --dangerously-skip-permissions",
        shell_quote(agy_path.to_string_lossy().as_ref())
    );
    let status = Command::new(&tmux_path)
        .args([
            "new-session",
            "-d",
            "-s",
            &session,
            "-c",
            cwd.to_string_lossy().as_ref(),
            &command,
        ])
        .status()
        .ok()?;
    if !status.success() {
        return None;
    }

    let deadline = Instant::now() + Duration::from_secs(12);
    let mut snapshot = None;

    while Instant::now() < deadline {
        snapshot = probe_antigravity_ls_usage();
        if snapshot.is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(350));
    }

    let _ = Command::new(&tmux_path)
        .args(["kill-session", "-t", &session])
        .status();
    snapshot
}

fn find_agy_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AGENT_HALO_AGY_PATH").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = home_dir() {
        candidates.push(home.join(".local/bin/agy"));
        candidates.push(home.join(".bun/bin/agy"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/agy"));
    candidates.push(PathBuf::from("/usr/local/bin/agy"));

    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let output = Command::new("sh")
        .args(["-lc", "command -v agy"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let path = PathBuf::from(path.trim());
    path.is_file().then_some(path)
}

fn find_tmux_binary() -> Option<PathBuf> {
    for candidate in [
        PathBuf::from("/opt/homebrew/bin/tmux"),
        PathBuf::from("/usr/local/bin/tmux"),
        PathBuf::from("/usr/bin/tmux"),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let output = Command::new("sh")
        .args(["-lc", "command -v tmux"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let path = PathBuf::from(path.trim());
    path.is_file().then_some(path)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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
    let lines = build_antigravity_quota_summary_lines(response);
    if lines.is_empty() {
        return None;
    }
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

fn build_antigravity_quota_summary_lines(response: &Value) -> Vec<CodexMetricLine> {
    let Some(groups) = response.get("groups").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut lines = Vec::new();
    for group in groups {
        let group_label = group
            .get("displayName")
            .and_then(Value::as_str)
            .map(normalize_antigravity_group_name)
            .unwrap_or_else(|| "Antigravity models".to_string());
        let Some(buckets) = group.get("buckets").and_then(Value::as_array) else {
            continue;
        };
        for bucket in buckets {
            let limit_label = bucket
                .get("displayName")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Limit");
            let remaining = value_to_f64(bucket.get("remainingFraction"))
                .unwrap_or(0.0)
                .clamp(0.0, 1.0);
            let reset_time = bucket
                .get("resetTime")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);

            lines.push(CodexMetricLine::Progress {
                label: format!("{group_label} {limit_label}"),
                used: ((1.0 - remaining) * 100.0).round().clamp(0.0, 100.0),
                limit: 100.0,
                format: CodexProgressFormat::Percent,
                resets_at: reset_time,
                period_duration_ms: Some(if limit_label.to_lowercase().contains("five") {
                    5 * 60 * 60 * 1000
                } else {
                    7 * 24 * 60 * 60 * 1000
                }),
            });
        }
    }

    lines
}

fn normalize_antigravity_group_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("gemini") {
        "Gemini models".to_string()
    } else if lower.contains("claude") || lower.contains("gpt") {
        "Claude and GPT models".to_string()
    } else {
        name.trim().to_string()
    }
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
fn focus_terminal(conversation_id: String, cwd: Option<String>) -> Result<String, String> {
    focus_ghostty_window(&conversation_id, cwd.as_deref())
}

fn focus_ghostty_window(conversation_id: &str, cwd: Option<&str>) -> Result<String, String> {
    let hints = build_focus_hints(conversation_id, cwd);

    if let Ok(message) = focus_ghostty_with_window_hints(&hints) {
        return Ok(message);
    }

    let output = Command::new("open")
        .args(["-a", "Ghostty"])
        .output()
        .map_err(|error| format!("Failed to launch Ghostty: {error}"))?;

    if output.status.success() {
        return Ok("Activated Ghostty · exact terminal not found".to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        "Failed to activate Ghostty".to_string()
    } else {
        format!("Failed to activate Ghostty: {stderr}")
    })
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
fn appkit_display_id(screen: &NSScreen) -> Option<String> {
    let description = screen.deviceDescription();
    let key = NSString::from_str("NSScreenNumber");
    let value = description.objectForKey(&key)?;
    // SAFETY: NSScreenNumber is documented as an NSNumber-compatible unsigned display id.
    let display_id: usize = unsafe { msg_send![&*value, unsignedIntegerValue] };
    Some(format!("macos:{display_id}"))
}

#[cfg(target_os = "macos")]
fn appkit_display_option(
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
fn resolve_appkit_screen(
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
    width: f64,
    height: f64,
) -> Result<(), String> {
    set_main_window_frame(&window, width, height)
        .map_err(|error| format!("Failed to resize/recenter Agent Halo window: {error}"))?;

    if open {
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

pub fn run() {
    let app = tauri::Builder::default()
        .manage(KeepAwakeState::default())
        .manage(DisplayPreferenceState::default())
        .manage(PomodoroNotificationState::default())
        .invoke_handler(tauri::generate_handler![
            agent_halo_mod_path,
            agent_halo_mod_status,
            agy_usage,
            bridge_health,
            cancel_pomodoro_notification,
            claude_usage,
            codex_usage,
            cursor_usage,
            display_state,
            focus_terminal,
            grok_usage,
            install_agent_halo_mod,
            notch_metrics,
            notification_permission_state,
            open_external_url,
            reconcile_display,
            request_notification_permission,
            schedule_pomodoro_notification,
            set_keep_awake,
            set_panel_open,
            select_display
        ])
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            notification::initialize();
            let preference = read_display_preference(app.handle());
            app.state::<DisplayPreferenceState>().set(preference);

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
            let _ = app_handle.state::<KeepAwakeState>().set_active(false);
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
}
