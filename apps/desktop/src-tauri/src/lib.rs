use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::mpsc,
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

#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize};

const TRAY_SHOW: &str = "show";
const TRAY_HIDE: &str = "hide";
const TRAY_QUIT: &str = "quit";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_KEYCHAIN_SERVICE: &str = "Codex Auth";
const CODEX_CREDIT_USD_RATE: f64 = 0.04;
const AGY_LS_SERVICE: &str = "exa.language_server_pb.LanguageServerService";
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_REFRESH_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_SCOPES: &str =
    "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const CLAUDE_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
const CLAUDE_CREDENTIALS_PATH: &str = ".claude/.credentials.json";
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
const GROK_TOKEN_AUTH_HEADER: &str = "xai-grok-cli";

#[derive(Debug, Clone)]
struct TerminalFocusHints {
    primary: Vec<String>,
    fallback: Vec<String>,
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
    Keychain,
}

#[derive(Debug, Clone)]
struct CodexAuthState {
    auth: CodexAuthFile,
    source: CodexAuthSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexUsageSnapshot {
    provider_id: String,
    display_name: String,
    plan: Option<String>,
    lines: Vec<CodexMetricLine>,
    fetched_at: String,
}

#[derive(Debug, Serialize)]
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
}

#[derive(Debug, Serialize)]
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
}

#[derive(Debug, Clone)]
struct ClaudeAuthState {
    credentials: ClaudeCredentialsFile,
    service_name: Option<String>,
    file_path: Option<PathBuf>,
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

#[tauri::command]
fn bridge_health() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 47_621));
    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

#[tauri::command]
fn codex_usage() -> Result<CodexUsageSnapshot, String> {
    let mut auth_state = load_codex_auth()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Agent Halo")
        .build()
        .map_err(|error| format!("Failed to create Codex usage client: {error}"))?;

    match fetch_codex_usage(&client, &auth_state) {
        Ok((usage, headers)) => Ok(build_codex_usage_snapshot(usage, &headers)),
        Err(CodexUsageFetchError::Auth) => {
            refresh_codex_auth(&client, &mut auth_state)?;
            let (usage, headers) =
                fetch_codex_usage(&client, &auth_state).map_err(|error| match error {
                    CodexUsageFetchError::Auth => {
                        "Codex session expired. Run `codex` to log in again.".to_string()
                    }
                    CodexUsageFetchError::Other(message) => message,
                })?;
            Ok(build_codex_usage_snapshot(usage, &headers))
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
    match fetch_claude_usage(&client, &auth) {
        Ok(usage) => Ok(build_claude_usage_snapshot(usage, &auth)),
        Err(CodexUsageFetchError::Auth) => {
            refresh_claude_token(&client, &mut auth)?;
            let usage = fetch_claude_usage(&client, &auth).map_err(|error| match error {
                CodexUsageFetchError::Auth => {
                    "Claude Code session expired. Run `claude` to log in again.".to_string()
                }
                CodexUsageFetchError::Other(message) => message,
            })?;
            Ok(build_claude_usage_snapshot(usage, &auth))
        }
        Err(CodexUsageFetchError::Other(message)) => Err(message),
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
                CodexUsageFetchError::Other(message) => message,
            })?
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
        .map_err(|error| format!("Grok billing request failed: {error}"))?;
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
        CodexUsageFetchError::Other(format!("Codex usage request failed: {error}"))
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
        .map_err(|error| format!("Codex token refresh failed: {error}"))?;

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
    if let Some(available) = usage
        .rate_limit_reset_credits
        .and_then(|credits| credits.available_count)
        .as_ref()
        .and_then(|value| value_to_f64(Some(value)))
    {
        if available >= 0.0 {
            lines.push(CodexMetricLine::Text {
                label: "Rate Limit Resets".to_string(),
                value: format!("{} available", available.floor() as i64),
            });
        }
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

fn progress_line(
    label: &str,
    used: f64,
    window: Option<&CodexRateLimitWindow>,
    fallback_duration_ms: Option<u64>,
) -> CodexMetricLine {
    CodexMetricLine::Progress {
        label: label.to_string(),
        used: used.clamp(0.0, 100.0),
        limit: 100.0,
        format: CodexProgressFormat::Percent,
        resets_at: window
            .and_then(|window| value_to_i64(window.reset_at.as_ref()))
            .and_then(unix_seconds_to_iso),
        period_duration_ms: window
            .and_then(|window| value_to_u64(window.limit_window_seconds.as_ref()))
            .map(|seconds| seconds * 1000)
            .or(fallback_duration_ms),
    }
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
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Agent Halo")
        .build()
        .map_err(|error| format!("Failed to create {provider} usage client: {error}"))
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
    if let Some(text) = read_keychain_password(CLAUDE_KEYCHAIN_SERVICE, None) {
        if let Some(credentials) = parse_json_or_hex::<ClaudeCredentialsFile>(&text) {
            if credentials
                .claude_ai_oauth
                .as_ref()?
                .access_token
                .as_ref()
                .is_some()
            {
                return Some(ClaudeAuthState {
                    credentials,
                    service_name: Some(CLAUDE_KEYCHAIN_SERVICE.to_string()),
                    file_path: None,
                });
            }
        }
    }

    let path = home_path(CLAUDE_CREDENTIALS_PATH)?;
    let text = fs::read_to_string(&path).ok()?;
    let credentials = parse_json_or_hex::<ClaudeCredentialsFile>(&text)?;
    credentials
        .claude_ai_oauth
        .as_ref()?
        .access_token
        .as_ref()?;
    Some(ClaudeAuthState {
        credentials,
        service_name: None,
        file_path: Some(path),
    })
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

fn fetch_claude_usage(
    client: &reqwest::blocking::Client,
    auth: &ClaudeAuthState,
) -> Result<Value, CodexUsageFetchError> {
    let response = client
        .get(CLAUDE_USAGE_URL)
        .bearer_auth(claude_access_token(auth).map_err(CodexUsageFetchError::Other)?)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header(reqwest::header::USER_AGENT, "claude-code/2.1.69")
        .send()
        .map_err(|error| {
            CodexUsageFetchError::Other(format!("Claude Code usage request failed: {error}"))
        })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(CodexUsageFetchError::Auth);
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
        .post(CLAUDE_REFRESH_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLAUDE_CLIENT_ID,
            "scope": CLAUDE_SCOPES,
        }))
        .send()
        .map_err(|error| format!("Claude Code token refresh failed: {error}"))?;
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
        plan: auth
            .credentials
            .claude_ai_oauth
            .as_ref()
            .and_then(|oauth| oauth.subscription_type.as_deref())
            .map(format_plan_label),
        lines,
        fetched_at: now_iso(),
    }
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
            CodexUsageFetchError::Other(format!("Cursor usage request failed: {error}"))
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
        .map_err(|error| format!("Cursor token refresh failed: {error}"))?;
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
    let Some(parent) = path.parent() else {
        return Err("Failed to resolve Letta mods directory".to_string());
    };

    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create mods directory: {error}"))?;

    let mut file =
        fs::File::create(&path).map_err(|error| format!("Failed to open mod file: {error}"))?;
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
fn focus_terminal(
    conversation_id: String,
    cwd: Option<String>,
    agent_name: Option<String>,
) -> Result<String, String> {
    focus_supported_terminal_window(&conversation_id, cwd.as_deref(), agent_name.as_deref())
}

fn focus_supported_terminal_window(
    conversation_id: &str,
    cwd: Option<&str>,
    agent_name: Option<&str>,
) -> Result<String, String> {
    let hints = build_focus_hints(conversation_id, cwd, agent_name);
    let mut errors = Vec::new();

    match focus_ghostty_with_window_hints(&hints.all()) {
        Ok(Some(message)) => return Ok(message),
        Ok(None) => {}
        Err(error) => errors.push(format!("Ghostty: {error}")),
    }

    if app_is_running_by_bundle("dev.warp.Warp-Stable") {
        if let Some(title) = build_warp_terminal_title(conversation_id, cwd) {
            if let Ok(message) = focus_warp_with_control_cli(&title) {
                return Ok(message);
            }
        }

        if let Ok(Some(message)) = focus_warp_with_window_hints(&hints.primary, &hints.fallback) {
            return Ok(message);
        }

        return activate_terminal_app_by_bundle("dev.warp.Warp-Stable", "Warp");
    }

    match focus_warp_with_window_hints(&hints.primary, &hints.fallback) {
        Ok(Some(message)) => return Ok(message),
        Ok(None) => {}
        Err(error) => errors.push(format!("Warp: {error}")),
    }

    if app_is_running("Ghostty") {
        return activate_terminal_app("Ghostty");
    }

    if let Ok(message) = activate_terminal_app_by_bundle("dev.warp.Warp-Stable", "Warp") {
        return Ok(message);
    }

    if let Ok(message) = activate_terminal_app("Ghostty") {
        return Ok(message);
    }

    Err(if errors.is_empty() {
        "Failed to activate a supported terminal".to_string()
    } else {
        format!(
            "Failed to activate a supported terminal ({})",
            errors.join("; ")
        )
    })
}

fn build_warp_terminal_title(conversation_id: &str, cwd: Option<&str>) -> Option<String> {
    let short_conversation_id = terminal_title_part(conversation_id).map(|value| {
        if value.len() > 12 {
            value.chars().take(12).collect::<String>()
        } else {
            value
        }
    });
    let workspace = cwd.and_then(terminal_title_part).and_then(|value| {
        Path::new(&value)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .or(Some(value))
    });
    let parts = [
        Some("Agent Halo".to_string()),
        workspace,
        short_conversation_id,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    if parts.len() <= 1 {
        None
    } else {
        Some(parts.join(" · "))
    }
}

fn terminal_title_part(value: &str) -> Option<String> {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn focus_warp_with_control_cli(tab_title: &str) -> Result<String, String> {
    let commands = warp_control_commands();
    if commands.is_empty() {
        return Err("warpctrl is not installed".to_string());
    }

    let mut errors = Vec::new();
    for mut command in commands {
        let executable = command.remove(0);
        let output = Command::new(&executable)
            .args(command)
            .args(["tab", "activate", "--tab-title", tab_title])
            .output()
            .map_err(|error| format!("Failed to run {}: {error}", executable.display()))?;

        if output.status.success() {
            return Ok(format!("Focused Warp · {tab_title} · warpctrl"));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            errors.push(stderr);
        }
    }

    Err(if errors.is_empty() {
        "warpctrl tab activation failed".to_string()
    } else {
        errors.join("; ")
    })
}

fn warp_control_commands() -> Vec<Vec<PathBuf>> {
    let mut commands = ["/usr/local/bin/warpctrl", "/opt/homebrew/bin/warpctrl"]
        .iter()
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .map(|path| vec![path])
        .collect::<Vec<_>>();

    let stable_executable = PathBuf::from("/Applications/Warp.app/Contents/MacOS/stable");
    if stable_executable.exists() {
        commands.push(vec![stable_executable, PathBuf::from("--warpctrl")]);
    }

    commands
}

fn activate_terminal_app(app_name: &str) -> Result<String, String> {
    let output = Command::new("open")
        .args(["-a", app_name])
        .output()
        .map_err(|error| format!("Failed to launch {app_name}: {error}"))?;

    if output.status.success() {
        return Ok(format!("Activated {app_name} · exact terminal not found"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("Failed to activate {app_name}")
    } else {
        format!("Failed to activate {app_name}: {stderr}")
    })
}

fn activate_terminal_app_by_bundle(bundle_id: &str, app_name: &str) -> Result<String, String> {
    let output = Command::new("open")
        .args(["-b", bundle_id])
        .output()
        .map_err(|error| format!("Failed to launch {app_name}: {error}"))?;

    if output.status.success() {
        return Ok(format!("Activated {app_name} · exact terminal not found"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("Failed to activate {app_name}")
    } else {
        format!("Failed to activate {app_name}: {stderr}")
    })
}

fn app_is_running(app_name: &str) -> bool {
    let script = format!("application {} is running", apple_script_string(app_name));
    apple_script_returns_true(&script)
}

fn app_is_running_by_bundle(bundle_id: &str) -> bool {
    let script = format!(
        "application id {} is running",
        apple_script_string(bundle_id)
    );
    apple_script_returns_true(&script)
}

fn apple_script_returns_true(script: &str) -> bool {
    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()
        .and_then(|output| {
            if !output.status.success() {
                return None;
            }
            Some(String::from_utf8_lossy(&output.stdout).trim() == "true")
        })
        .unwrap_or(false)
}

impl TerminalFocusHints {
    fn all(&self) -> Vec<String> {
        dedup_hints(
            self.primary
                .iter()
                .chain(self.fallback.iter())
                .cloned()
                .collect(),
        )
    }
}

fn dedup_hints(hints: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for hint in hints {
        if hint.trim().is_empty() || deduped.iter().any(|value| value == &hint) {
            continue;
        }
        deduped.push(hint);
    }
    deduped
}

fn build_focus_hints(
    conversation_id: &str,
    cwd: Option<&str>,
    _agent_name: Option<&str>,
) -> TerminalFocusHints {
    let mut primary = Vec::new();
    let trimmed_conversation_id = conversation_id.trim();

    if !trimmed_conversation_id.is_empty() {
        primary.push(trimmed_conversation_id.to_string());
        primary.push(trimmed_conversation_id.chars().take(8).collect::<String>());
    }

    if let Some(cwd) = cwd.map(str::trim).filter(|value| !value.is_empty()) {
        primary.push(cwd.to_string());
        if let Some(name) = Path::new(cwd).file_name().and_then(|name| name.to_str()) {
            primary.push(name.to_string());
        }
    }

    TerminalFocusHints {
        primary: dedup_hints(primary),
        fallback: Vec::new(),
    }
}

fn focus_ghostty_with_window_hints(hints: &[String]) -> Result<Option<String>, String> {
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
        Ok(Some(format!(
            "Focused Ghostty · {}",
            stdout.trim_start_matches("matched:")
        )))
    } else {
        Ok(None)
    }
}

fn focus_warp_with_window_hints(
    primary_hints: &[String],
    fallback_hints: &[String],
) -> Result<Option<String>, String> {
    let script = build_focus_warp_script(primary_hints, fallback_hints);
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
        Ok(Some(format!(
            "Focused Warp · {}",
            stdout.trim_start_matches("matched:")
        )))
    } else {
        Ok(None)
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
end tell
return "unmatched"
"#
    )
}

fn build_focus_warp_script(primary_hints: &[String], fallback_hints: &[String]) -> String {
    let primary_hints_source = primary_hints
        .iter()
        .filter(|hint| !hint.trim().is_empty())
        .map(|hint| apple_script_string(hint))
        .collect::<Vec<_>>()
        .join(", ");
    let primary_hints_source = if primary_hints_source.is_empty() {
        "{}".to_string()
    } else {
        format!("{{{primary_hints_source}}}")
    };

    let fallback_hints_source = fallback_hints
        .iter()
        .filter(|hint| !hint.trim().is_empty())
        .map(|hint| apple_script_string(hint))
        .collect::<Vec<_>>()
        .join(", ");
    let fallback_hints_source = if fallback_hints_source.is_empty() {
        "{}".to_string()
    } else {
        format!("{{{fallback_hints_source}}}")
    };

    format!(
        r#"set primaryHints to {primary_hints_source}
set fallbackHints to {fallback_hints_source}
tell application "System Events"
  set warpProcesses to application processes whose bundle identifier is "dev.warp.Warp-Stable"
  if (count warpProcesses) is 0 then return "unmatched"
  set warpProcess to item 1 of warpProcesses
  tell warpProcess
    repeat with candidateWindow in windows
      perform action "AXRaise" of candidateWindow
      set frontmost to true
      tell application id "dev.warp.Warp-Stable" to activate
      delay 0.08
      set switchedTabs to 0

      repeat with scanIndex from 0 to 23
        set windowTitle to name of candidateWindow as text
        repeat with matchHint in primaryHints
          set hintText to matchHint as text
          if hintText is not "" then
            if windowTitle contains hintText then
              return "matched:" & windowTitle & " · exact"
            end if
          end if
        end repeat

        try
          click menu item "Switch to Next Tab" of menu "Tab" of menu bar 1
          set switchedTabs to switchedTabs + 1
          delay 0.08
        on error
          exit repeat
        end try
      end repeat

      if switchedTabs > 0 then
        repeat switchedTabs times
          try
            click menu item "Switch to Previous Tab" of menu "Tab" of menu bar 1
            delay 0.08
          on error
            exit repeat
          end try
        end repeat
      end if
    end repeat
  end tell
end tell
return "unmatched"
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
    if position_main_window_with_appkit(window, Some((width, height))) {
        return Ok(());
    }

    let (sender, receiver) = mpsc::channel();
    let scheduled_window = window.clone();
    window.run_on_main_thread(move || {
        let _ = sender.send(position_main_window_with_appkit(
            &scheduled_window,
            Some((width, height)),
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
fn position_main_window_for_platform(
    window: &tauri::WebviewWindow,
    width: f64,
) -> tauri::Result<()> {
    let monitor = match window.primary_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.current_monitor()?,
    };

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
) -> bool {
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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            agent_halo_mod_path,
            agent_halo_mod_status,
            agy_usage,
            bridge_health,
            claude_usage,
            codex_usage,
            cursor_usage,
            focus_terminal,
            grok_usage,
            install_agent_halo_mod,
            notch_metrics,
            open_external_url,
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
