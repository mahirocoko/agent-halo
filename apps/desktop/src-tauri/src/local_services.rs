use serde::{Deserialize, Serialize};

const MAX_LOCAL_SERVICES: usize = 64;
const MAX_LOCAL_SERVICE_OWNER_TARGETS: usize = 64;
const FRONTEND_REGISTRY_SCHEMA_VERSION: u8 = 1;
const MAX_FRONTEND_REGISTRY_BYTES: u64 = 32 * 1024;
const MAX_FRONTEND_REGISTRY_ENTRIES: usize = 32;
const MAX_FRONTEND_REGISTRY_HORIZON_MS: u64 = 15 * 60 * 1_000;
const PROCESS_START_TOLERANCE_MS: u64 = 2_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalService {
    pub process_id: i32,
    pub process_name: String,
    pub bind_address: String,
    pub port: u16,
    pub kind: String,
    pub web_frontend: bool,
    pub http_title: Option<String>,
    pub url: Option<String>,
    pub cwd: Option<String>,
    pub owner: Option<LocalServiceOwner>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalServiceOwnerTarget {
    pub conversation_id: String,
    pub process_id: i32,
    pub expected_start_time_ms: u64,
    pub project: String,
    pub herdr_pane_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalServiceOwner {
    pub conversation_id: String,
    pub project: String,
    pub herdr_pane_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServicesSnapshot {
    pub sampled_at_ms: u64,
    pub status: String,
    pub error: Option<String>,
    pub services: Vec<LocalService>,
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(not(target_os = "macos"))]
fn unsupported_snapshot() -> LocalServicesSnapshot {
    LocalServicesSnapshot {
        sampled_at_ms: unix_time_ms(),
        status: "unsupported".to_string(),
        error: Some("Local service discovery currently supports macOS only".to_string()),
        services: Vec::new(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Listener {
    process_id: i32,
    process_name: String,
    bind_address: String,
    port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrontendRegistry {
    schema_version: u8,
    entries: Vec<FrontendRegistryEntry>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrontendRegistryEntry {
    process_id: i32,
    process_started_at_ms: u64,
    bind_address: String,
    port: u16,
    expires_at_ms: u64,
}

fn parse_frontend_registry(
    contents: &[u8],
    now_ms: u64,
) -> Result<Vec<FrontendRegistryEntry>, String> {
    if contents.len() as u64 > MAX_FRONTEND_REGISTRY_BYTES {
        return Err("Local web frontend registry exceeds 32 KiB".to_string());
    }
    let registry: FrontendRegistry = serde_json::from_slice(contents)
        .map_err(|error| format!("Local web frontend registry is invalid: {error}"))?;
    if registry.schema_version != FRONTEND_REGISTRY_SCHEMA_VERSION {
        return Err("Local web frontend registry schema is unsupported".to_string());
    }
    if registry.entries.len() > MAX_FRONTEND_REGISTRY_ENTRIES {
        return Err("Local web frontend registry exceeds 32 entries".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    let mut entries = Vec::with_capacity(registry.entries.len());
    for entry in registry.entries {
        if entry.process_id <= 1
            || entry.process_started_at_ms == 0
            || entry.port == 0
            || !matches!(
                entry.bind_address.as_str(),
                "127.0.0.1" | "::1" | "0.0.0.0" | "::"
            )
            || entry.expires_at_ms > now_ms.saturating_add(MAX_FRONTEND_REGISTRY_HORIZON_MS)
        {
            return Err("Local web frontend registry contains an unsafe entry".to_string());
        }
        if entry.expires_at_ms <= now_ms {
            continue;
        }
        if !seen.insert((
            entry.process_id,
            entry.process_started_at_ms,
            entry.bind_address.clone(),
            entry.port,
        )) {
            return Err("Local web frontend registry contains duplicate entries".to_string());
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn registry_entry_matches(
    entry: &FrontendRegistryEntry,
    listener: &Listener,
    actual_process_started_at_ms: Option<u64>,
    now_ms: u64,
) -> bool {
    entry.expires_at_ms > now_ms
        && entry.process_id == listener.process_id
        && entry.bind_address == listener.bind_address
        && entry.port == listener.port
        && actual_process_started_at_ms.is_some_and(|actual| {
            entry.process_started_at_ms.abs_diff(actual) <= PROCESS_START_TOLERANCE_MS
        })
}

fn parse_listener_name(value: &str) -> Option<(String, u16)> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    let (host, port) = if let Some(rest) = value.strip_prefix('[') {
        let (host, port) = rest.split_once("]:")?;
        (host.to_string(), port)
    } else {
        let (host, port) = value.rsplit_once(':')?;
        (host.to_string(), port)
    };
    let port = port.parse::<u16>().ok()?;
    let bind_address = match host.as_str() {
        "*" => "0.0.0.0".to_string(),
        "::" => "::".to_string(),
        _ => host,
    };
    Some((bind_address, port))
}

fn parse_lsof_listeners(output: &str) -> Vec<Listener> {
    let mut process_id: Option<i32> = None;
    let mut process_name = String::new();
    let mut listeners = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in output.lines() {
        let (Some(field), Some(value)) = (line.get(0..1), line.get(1..)) else {
            continue;
        };
        match field {
            "p" => {
                process_id = value.parse::<i32>().ok();
                process_name.clear();
            }
            "c" => {
                process_name = value.trim().chars().take(120).collect();
            }
            "n" => {
                let Some(process_id) = process_id else {
                    continue;
                };
                let Some((bind_address, port)) = parse_listener_name(value) else {
                    continue;
                };
                let key = (process_id, bind_address.clone(), port);
                if seen.insert(key) {
                    listeners.push(Listener {
                        process_id,
                        process_name: if process_name.is_empty() {
                            "Unknown process".to_string()
                        } else {
                            process_name.clone()
                        },
                        bind_address,
                        port,
                    });
                }
            }
            _ => {}
        }
    }

    listeners.sort_by(|left, right| {
        left.port
            .cmp(&right.port)
            .then_with(|| left.process_name.cmp(&right.process_name))
            .then_with(|| left.process_id.cmp(&right.process_id))
    });
    listeners.truncate(MAX_LOCAL_SERVICES);
    listeners
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{
        parse_frontend_registry, parse_lsof_listeners, registry_entry_matches, unix_time_ms,
        FrontendRegistryEntry, Listener, LocalService, LocalServiceOwner, LocalServiceOwnerTarget,
        LocalServicesSnapshot, MAX_FRONTEND_REGISTRY_BYTES, MAX_LOCAL_SERVICE_OWNER_TARGETS,
    };
    use std::{
        fs::OpenOptions,
        io::{Read, Write},
        mem::{size_of, size_of_val},
        net::{IpAddr, SocketAddr, TcpStream},
        os::{
            raw::c_void,
            unix::fs::{MetadataExt, OpenOptionsExt},
        },
        path::{Path, PathBuf},
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    const DISCOVERY_BUDGET: Duration = Duration::from_millis(1_500);
    const HTTP_PROBE_TIMEOUT: Duration = Duration::from_millis(120);
    const MAX_HTTP_PROBE_BYTES: usize = 8 * 1024;
    const MAX_LSOF_OUTPUT_BYTES: u64 = 256 * 1024;
    const FRONTEND_REGISTRY_RELATIVE_PATH: &str = ".config/agent-halo/local-web-frontends.v1.json";

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    struct HttpEvidence {
        http: bool,
        web_frontend: bool,
        title: Option<String>,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct ProcessIdentity {
        pid: i32,
        ppid: i32,
        start_time_ms: u64,
    }

    fn frontend_registry_path() -> Option<PathBuf> {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .map(|home| home.join(FRONTEND_REGISTRY_RELATIVE_PATH))
    }

    fn read_frontend_registry(now_ms: u64) -> Result<Vec<FrontendRegistryEntry>, String> {
        let Some(path) = frontend_registry_path() else {
            return Ok(Vec::new());
        };
        read_frontend_registry_path(&path, now_ms)
    }

    fn read_frontend_registry_path(
        path: &Path,
        now_ms: u64,
    ) -> Result<Vec<FrontendRegistryEntry>, String> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        let file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!(
                    "Could not open local web frontend registry: {error}"
                ));
            }
        };
        let metadata = file
            .metadata()
            .map_err(|error| format!("Could not inspect local web frontend registry: {error}"))?;
        if !metadata.file_type().is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
        {
            return Err(
                "Local web frontend registry must be a current-user regular file with mode 0600"
                    .to_string(),
            );
        }
        if metadata.len() > MAX_FRONTEND_REGISTRY_BYTES {
            return Err("Local web frontend registry exceeds 32 KiB".to_string());
        }
        let mut contents = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_FRONTEND_REGISTRY_BYTES + 1)
            .read_to_end(&mut contents)
            .map_err(|error| format!("Could not read local web frontend registry: {error}"))?;
        parse_frontend_registry(&contents, now_ms)
    }

    fn basic_process(pid: i32) -> Option<ProcessIdentity> {
        let mut info = unsafe { std::mem::zeroed::<libc::proc_bsdinfo>() };
        let expected_size = size_of::<libc::proc_bsdinfo>() as i32;
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast::<c_void>(),
                expected_size,
            )
        };
        (read == expected_size && info.pbi_pid != 0).then(|| ProcessIdentity {
            pid: info.pbi_pid as i32,
            ppid: info.pbi_ppid as i32,
            start_time_ms: info
                .pbi_start_tvsec
                .saturating_mul(1_000)
                .saturating_add(info.pbi_start_tvusec / 1_000),
        })
    }

    fn process_cwd(pid: i32) -> Option<String> {
        let mut info = unsafe { std::mem::zeroed::<libc::proc_vnodepathinfo>() };
        let expected_size = size_of::<libc::proc_vnodepathinfo>() as i32;
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDVNODEPATHINFO,
                0,
                (&mut info as *mut libc::proc_vnodepathinfo).cast::<c_void>(),
                expected_size,
            )
        };
        if read != expected_size {
            return None;
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(
                info.pvi_cdir.vip_path.as_ptr().cast::<u8>(),
                size_of_val(&info.pvi_cdir.vip_path),
            )
        };
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        let path = String::from_utf8_lossy(&bytes[..end]).into_owned();
        (!path.is_empty()).then_some(path)
    }

    fn process_ancestry(pid: i32) -> Vec<ProcessIdentity> {
        let mut ancestry = Vec::new();
        let mut current = pid;
        let mut seen = std::collections::HashSet::new();
        while current > 1 && ancestry.len() < 32 && seen.insert(current) {
            let Some(process) = basic_process(current) else {
                break;
            };
            current = process.ppid;
            ancestry.push(process);
        }
        ancestry
    }

    fn safe_label(value: &str, maximum: usize) -> Option<String> {
        let value = value.trim();
        if value.is_empty() || value.chars().any(char::is_control) {
            return None;
        }
        Some(value.chars().take(maximum).collect())
    }

    fn safe_herdr_pane_id(value: &str) -> Option<String> {
        let pane_id = safe_label(value, 80)?;
        let (workspace, pane) = pane_id.split_once(":p")?;
        (workspace.starts_with('w')
            && workspace.len() >= 2
            && workspace[1..]
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
            && !pane.is_empty()
            && pane
                .chars()
                .all(|character| character.is_ascii_alphanumeric()))
        .then_some(pane_id)
    }

    fn match_service_owner(
        ancestry: &[ProcessIdentity],
        targets: &[LocalServiceOwnerTarget],
    ) -> Option<LocalServiceOwner> {
        ancestry.iter().find_map(|process| {
            targets.iter().find_map(|target| {
                if target.process_id != process.pid
                    || target
                        .expected_start_time_ms
                        .abs_diff(process.start_time_ms)
                        > super::PROCESS_START_TOLERANCE_MS
                {
                    return None;
                }
                let herdr_pane_id = match target.herdr_pane_id.as_deref() {
                    Some(pane_id) => Some(safe_herdr_pane_id(pane_id)?),
                    None => None,
                };
                Some(LocalServiceOwner {
                    conversation_id: safe_label(&target.conversation_id, 160)?,
                    project: safe_label(&target.project, 120)?,
                    herdr_pane_id,
                })
            })
        })
    }

    fn is_registered_frontend(
        listener: &Listener,
        entries: &[FrontendRegistryEntry],
        now_ms: u64,
    ) -> bool {
        if entries.is_empty() {
            return false;
        }
        let process_started_at_ms =
            basic_process(listener.process_id).map(|process| process.start_time_ms);
        entries
            .iter()
            .any(|entry| registry_entry_matches(entry, listener, process_started_at_ms, now_ms))
    }

    fn remaining(deadline: Instant, maximum: Duration) -> Option<Duration> {
        let duration = deadline.checked_duration_since(Instant::now())?;
        if duration.is_zero() {
            None
        } else {
            Some(duration.min(maximum))
        }
    }

    fn run_bounded_output(mut command: Command, deadline: Instant) -> Result<Vec<u8>, String> {
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not inspect local service command: {error}"))?;
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Could not read local service command output".to_string());
        };
        let output_too_large = Arc::new(AtomicBool::new(false));
        let output_too_large_reader = Arc::clone(&output_too_large);
        let reader = thread::spawn(move || {
            let mut limited = stdout.take(MAX_LSOF_OUTPUT_BYTES + 1);
            let mut output = Vec::new();
            let result = limited.read_to_end(&mut output);
            if output.len() as u64 > MAX_LSOF_OUTPUT_BYTES {
                output_too_large_reader.store(true, Ordering::Release);
            }
            (output, result)
        });

        let mut timed_out = false;
        let mut child_error = None;
        loop {
            if output_too_large.load(Ordering::Acquire) {
                child_error =
                    Some("Local TCP listener output exceeded the safety limit".to_string());
                break;
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        child_error = Some(format!(
                            "lsof exited unsuccessfully ({})",
                            status
                                .code()
                                .map(|code| code.to_string())
                                .unwrap_or_else(|| "signal".to_string())
                        ));
                    }
                    break;
                }
                Ok(None) => {
                    if remaining(deadline, Duration::from_millis(20)).is_none() {
                        timed_out = true;
                        child_error = Some("Local service discovery timed out".to_string());
                        break;
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => {
                    child_error = Some(format!("Could not inspect local service command: {error}"));
                    break;
                }
            }
        }

        if timed_out || child_error.is_some() {
            let _ = child.kill();
        }
        let _ = child.wait();
        let (output, read_result) = reader
            .join()
            .map_err(|_| "Could not read local service command output".to_string())?;
        read_result
            .map_err(|error| format!("Could not read local service command output: {error}"))?;
        if let Some(error) = child_error {
            return Err(error);
        }
        if output.len() as u64 > MAX_LSOF_OUTPUT_BYTES {
            return Err("Local TCP listener output exceeded the safety limit".to_string());
        }
        Ok(output)
    }

    fn run_lsof(deadline: Instant) -> Result<Vec<u8>, String> {
        let mut command = Command::new("/usr/sbin/lsof");
        command.args(["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLn"]);
        run_bounded_output(command, deadline)
    }

    fn probe_address(listener: &Listener) -> Option<SocketAddr> {
        let address = match listener.bind_address.as_str() {
            "*" | "0.0.0.0" => IpAddr::from([127, 0, 0, 1]),
            "::" => IpAddr::from(std::net::Ipv6Addr::LOCALHOST),
            value => value.parse().ok()?,
        };
        Some(SocketAddr::new(address, listener.port))
    }

    fn request_http(
        listener: &Listener,
        method: &str,
        path: &str,
        deadline: Instant,
    ) -> Option<Vec<u8>> {
        let Some(address) = probe_address(listener) else {
            return None;
        };
        let Some(timeout) = remaining(deadline, HTTP_PROBE_TIMEOUT) else {
            return None;
        };
        let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
            return None;
        };
        let timeout = remaining(deadline, HTTP_PROBE_TIMEOUT)?;
        let _ = stream.set_write_timeout(Some(timeout));
        let request =
            format!("{method} {path} HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        if stream.write_all(request.as_bytes()).is_err() {
            return None;
        }
        let mut response = Vec::with_capacity(MAX_HTTP_PROBE_BYTES);
        let mut chunk = [0_u8; 1_024];
        while response.len() < MAX_HTTP_PROBE_BYTES {
            let Some(timeout) = remaining(deadline, HTTP_PROBE_TIMEOUT) else {
                break;
            };
            if stream.set_read_timeout(Some(timeout)).is_err() {
                return None;
            }
            let remaining_bytes = MAX_HTTP_PROBE_BYTES - response.len();
            let read_size = remaining_bytes.min(chunk.len());
            match stream.read(&mut chunk[..read_size]) {
                Ok(0) => break,
                Ok(read) => {
                    response.extend_from_slice(&chunk[..read]);
                    if method == "HEAD" && response.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                Err(error)
                    if !response.is_empty()
                        && matches!(
                            error.kind(),
                            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                        ) =>
                {
                    break;
                }
                Err(_) => return None,
            }
        }
        (!response.is_empty()).then_some(response)
    }

    fn response_status(response: &[u8]) -> Option<u16> {
        let first_line = response.split(|byte| *byte == b'\n').next()?;
        let first_line = std::str::from_utf8(first_line).ok()?.trim_end_matches('\r');
        let mut parts = first_line.split_ascii_whitespace();
        parts.next()?.starts_with("HTTP/").then_some(())?;
        parts.next()?.parse().ok()
    }

    fn response_content_type(response: &[u8]) -> Option<String> {
        let text = String::from_utf8_lossy(response);
        let headers = text
            .split_once("\r\n\r\n")
            .map_or(text.as_ref(), |(head, _)| head);
        headers.lines().skip(1).find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-type")
                .then(|| value.trim().to_ascii_lowercase())
        })
    }

    fn is_html_content_type(response: &[u8]) -> bool {
        response_content_type(response)
            .and_then(|content_type| {
                content_type
                    .split(';')
                    .next()
                    .map(str::trim)
                    .map(str::to_string)
            })
            .as_deref()
            == Some("text/html")
    }

    fn response_body(response: &[u8]) -> &[u8] {
        response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map_or(&[], |index| &response[index + 4..])
    }

    fn response_html_title(response: &[u8]) -> Option<String> {
        if !matches!(response_status(response), Some(200..=299)) || !is_html_content_type(response)
        {
            return None;
        }
        let body = String::from_utf8_lossy(response_body(response));
        let lowercase = body.to_ascii_lowercase();
        let title_start = lowercase.find("<title")?;
        let content_start = title_start + lowercase[title_start..].find('>')? + 1;
        let content_end = content_start + lowercase[content_start..].find("</title>")?;
        let title = body[content_start..content_end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        safe_label(&title, 120)
    }

    fn is_successful_javascript_response(response: &[u8]) -> bool {
        matches!(response_status(response), Some(200..=299))
            && response_content_type(response).is_some_and(|content_type| {
                content_type.contains("javascript")
                    || content_type.contains("ecmascript")
                    || content_type.contains("typescript")
            })
    }

    fn body_contains(response: &[u8], marker: &[u8]) -> bool {
        response_body(response)
            .windows(marker.len())
            .any(|window| window == marker)
    }

    fn is_vite_dev_client_response(response: &[u8]) -> bool {
        is_successful_javascript_response(response)
            && body_contains(response, b"HMRContext")
            && body_contains(response, b"vite:invalidate")
    }

    fn is_next_dev_manifest_response(response: &[u8]) -> bool {
        is_successful_javascript_response(response)
            && body_contains(response, b"self.__BUILD_MANIFEST")
    }

    fn is_web_app_document_response(response: &[u8]) -> bool {
        if !matches!(response_status(response), Some(200..=299)) || !is_html_content_type(response)
        {
            return false;
        }
        let body = String::from_utf8_lossy(response_body(response)).to_ascii_lowercase();
        let is_document = body.contains("<!doctype html") || body.contains("<html");
        let has_script = body.contains("<script") && body.contains("src=");
        let has_module_script = body.contains("<script")
            && (body.contains("type=\"module\"") || body.contains("type='module'"));
        let has_stylesheet = body.contains("<link")
            && (body.contains("rel=\"stylesheet\"") || body.contains("rel='stylesheet'"));
        let has_framework_marker = body.contains("__next_data__")
            || body.contains("/_next/static/")
            || body.contains("__nuxt__")
            || body.contains("/_nuxt/");
        let has_root_mount = ["id=\"root\"", "id='root'", "id=\"app\"", "id='app'"]
            .iter()
            .any(|marker| body.contains(marker));
        let has_bundled_module_preload = body.split("<link").skip(1).any(|candidate| {
            candidate.split_once('>').is_some_and(|(tag, _)| {
                (tag.contains("rel=\"modulepreload\"") || tag.contains("rel='modulepreload'"))
                    && tag.contains("/assets/")
                    && tag.contains(".js")
            })
        });
        let has_bundled_hydration = has_stylesheet && has_bundled_module_preload;
        is_document
            && (has_framework_marker
                || (has_module_script && has_stylesheet)
                || (has_root_mount && has_script)
                || has_bundled_hydration)
    }

    fn has_dev_frontend_runtime(listener: &Listener, deadline: Instant) -> bool {
        if request_http(listener, "GET", "/@vite/client", deadline)
            .as_deref()
            .is_some_and(is_vite_dev_client_response)
        {
            return true;
        }

        request_http(
            listener,
            "GET",
            "/_next/static/development/_buildManifest.js",
            deadline,
        )
        .as_deref()
        .is_some_and(is_next_dev_manifest_response)
    }

    fn inspect_http(listener: &Listener, deadline: Instant) -> HttpEvidence {
        let Some(root) = request_http(listener, "GET", "/", deadline) else {
            return HttpEvidence::default();
        };
        if response_status(&root).is_none() {
            return HttpEvidence::default();
        }
        let web_frontend =
            is_web_app_document_response(&root) || has_dev_frontend_runtime(listener, deadline);
        HttpEvidence {
            http: true,
            web_frontend,
            title: response_html_title(&root),
        }
    }

    fn browser_url(listener: &Listener) -> String {
        let host = match listener.bind_address.as_str() {
            "*" | "0.0.0.0" => "127.0.0.1".to_string(),
            "::" => "[::1]".to_string(),
            value if value.contains(':') => format!("[{value}]"),
            value => value.to_string(),
        };
        format!("http://{host}:{}", listener.port)
    }

    pub(super) fn sample(owner_targets: Vec<LocalServiceOwnerTarget>) -> LocalServicesSnapshot {
        let sampled_at_ms = unix_time_ms();
        let owner_targets = owner_targets
            .into_iter()
            .take(MAX_LOCAL_SERVICE_OWNER_TARGETS)
            .filter(|target| target.process_id > 1 && target.expected_start_time_ms > 0)
            .collect::<Vec<_>>();
        let (registry_entries, registry_error) = match read_frontend_registry(sampled_at_ms) {
            Ok(entries) => (entries, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        let deadline = Instant::now() + DISCOVERY_BUDGET;
        let output = match run_lsof(deadline) {
            Ok(output) => output,
            Err(error) => {
                return LocalServicesSnapshot {
                    sampled_at_ms,
                    status: "error".to_string(),
                    error: Some(error),
                    services: Vec::new(),
                };
            }
        };

        let listeners = parse_lsof_listeners(&String::from_utf8_lossy(&output));
        let services = listeners
            .iter()
            .map(|listener| {
                let http = inspect_http(listener, deadline);
                let ancestry = process_ancestry(listener.process_id);
                LocalService {
                    process_id: listener.process_id,
                    process_name: listener.process_name.clone(),
                    bind_address: listener.bind_address.clone(),
                    port: listener.port,
                    kind: if http.http { "http" } else { "tcp" }.to_string(),
                    web_frontend: http.web_frontend
                        || is_registered_frontend(listener, &registry_entries, sampled_at_ms),
                    http_title: http.title,
                    url: http.http.then(|| browser_url(listener)),
                    cwd: process_cwd(listener.process_id),
                    owner: match_service_owner(&ancestry, &owner_targets),
                }
            })
            .collect();

        LocalServicesSnapshot {
            sampled_at_ms,
            status: "ok".to_string(),
            error: registry_error,
            services,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{
            inspect_http, is_next_dev_manifest_response, is_vite_dev_client_response,
            is_web_app_document_response, match_service_owner, read_frontend_registry_path,
            request_http, response_html_title, response_status, run_bounded_output, HttpEvidence,
            ProcessIdentity,
        };
        use crate::local_services::{Listener, LocalServiceOwnerTarget};
        use std::{
            fs,
            io::{Read, Write},
            net::TcpListener,
            os::unix::fs::{symlink, PermissionsExt},
            process::Command,
            thread,
            time::{Duration, Instant, SystemTime, UNIX_EPOCH},
        };

        #[derive(Clone, Copy)]
        enum FixtureKind {
            Vite,
            WebApp,
            GenericHtml,
            FakeJavascript,
        }

        fn listener_for_port(port: u16, process_name: &str) -> Listener {
            Listener {
                process_id: 123,
                process_name: process_name.to_string(),
                bind_address: "127.0.0.1".to_string(),
                port,
            }
        }

        fn fixture_listener(
            kind: FixtureKind,
            process_name: &str,
        ) -> (Listener, thread::JoinHandle<()>) {
            let server = TcpListener::bind("127.0.0.1:0").expect("bind fixture server");
            let port = server.local_addr().expect("fixture address").port();
            let expected_requests = match kind {
                FixtureKind::WebApp => 1,
                FixtureKind::Vite => 2,
                FixtureKind::GenericHtml | FixtureKind::FakeJavascript => 3,
            };
            let handle = thread::spawn(move || {
                for _ in 0..expected_requests {
                    let (mut stream, _) = server.accept().expect("accept fixture request");
                    let mut request = [0_u8; 1_024];
                    let read = stream.read(&mut request).expect("read fixture request");
                    let request = String::from_utf8_lossy(&request[..read]);
                    let response = match kind {
                        FixtureKind::WebApp if request.contains(" / ") => {
                            "HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n<!doctype html><html><head><link rel=\"stylesheet\" href=\"/assets/app.css\"></head><body><script type=\"module\" src=\"/assets/app.js\"></script></body></html>"
                        }
                        FixtureKind::Vite if request.contains(" /@vite/client ") => {
                            "HTTP/1.0 200 OK\r\nContent-Type: text/javascript\r\n\r\nclass HMRContext {}\nconst event = 'vite:invalidate';"
                        }
                        FixtureKind::FakeJavascript if request.contains(" /@vite/client ") => {
                            "HTTP/1.0 200 OK\r\nContent-Type: text/javascript\r\n\r\nconsole.log('ordinary endpoint');"
                        }
                        _ => "HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n<title>App</title>",
                    };
                    stream
                        .write_all(response.as_bytes())
                        .expect("write fixture response");
                }
            });
            (listener_for_port(port, process_name), handle)
        }

        #[test]
        fn reports_non_zero_service_command_exit() {
            let result = run_bounded_output(
                Command::new("/usr/bin/false"),
                Instant::now() + Duration::from_millis(250),
            );
            assert!(result.unwrap_err().contains("unsuccessfully"));
        }

        #[test]
        fn stops_a_slow_service_command_at_the_deadline() {
            let mut command = Command::new("/bin/sleep");
            command.arg("2");
            let result = run_bounded_output(command, Instant::now() + Duration::from_millis(50));
            assert!(result.unwrap_err().contains("timed out"));
        }

        #[test]
        fn caps_unbounded_service_command_output() {
            let result = run_bounded_output(
                Command::new("/usr/bin/yes"),
                Instant::now() + Duration::from_millis(500),
            );
            assert!(result.unwrap_err().contains("safety limit"));
        }

        #[test]
        fn requires_framework_specific_vite_body_signatures() {
            let vite = b"HTTP/1.1 200 OK\r\nContent-Type: text/javascript\r\n\r\nclass HMRContext {}\nconst event = 'vite:invalidate';";
            let arbitrary_javascript = b"HTTP/1.1 200 OK\r\nContent-Type: text/javascript\r\n\r\nconsole.log('ordinary endpoint');";
            let html_fallback =
                b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nHMRContext vite:invalidate";
            assert!(is_vite_dev_client_response(vite));
            assert!(!is_vite_dev_client_response(arbitrary_javascript));
            assert!(!is_vite_dev_client_response(html_fallback));
        }

        #[test]
        fn requires_the_next_development_manifest_signature() {
            let next = b"HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\n\r\nself.__BUILD_MANIFEST = {};";
            let arbitrary_javascript = b"HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\n\r\nwindow.manifest = {};";
            assert!(is_next_dev_manifest_response(next));
            assert!(!is_next_dev_manifest_response(arbitrary_javascript));
        }

        #[test]
        fn requires_browser_app_anatomy_for_a_root_html_document() {
            let web_app = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!doctype html><html><head><link rel=\"stylesheet\" href=\"/assets/app.css\"></head><body><script type=\"module\" src=\"/assets/app.js\"></script></body></html>";
            let python_listing = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<!doctype html><html><title>Directory listing for /</title><ul><li>dist/</li></ul></html>";
            let api_error = b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\n<!doctype html><html><title>Forbidden</title></html>";
            let streamed_ssr_app = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<!doctype html><html><head><title>Haabiz   UI</title><link rel=\"stylesheet\" href=\"/assets/app.css\"><link rel=\"modulepreload\" href=\"/assets/entry.js\"></head><body><main>SSR content before late hydration</main></body></html>";
            let generic_static_page = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<!doctype html><html><head><title>Static docs</title><link rel=\"stylesheet\" href=\"/assets/site.css\"></head><body><main>Plain HTML mentioning docs.js</main></body></html>";
            let mixed_unrelated_markers = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<!doctype html><html><head><title>Static docs</title><link rel=\"stylesheet\" href=\"/assets/site.css\"><link rel=\"modulepreload\" href=\"/vendor/runtime.css\"></head><body><main>Plain HTML mentioning app.js</main></body></html>";
            let misleading_content_type = b"HTTP/1.1 200 OK\r\nContent-Type: text/htmlish\r\n\r\n<!doctype html><html><head><title>Not HTML</title><script type=\"module\" src=\"/app.js\"></script><link rel=\"stylesheet\" href=\"/app.css\"></head></html>";
            assert!(is_web_app_document_response(web_app));
            assert!(is_web_app_document_response(streamed_ssr_app));
            assert!(!is_web_app_document_response(generic_static_page));
            assert!(!is_web_app_document_response(mixed_unrelated_markers));
            assert!(!is_web_app_document_response(misleading_content_type));
            assert!(!is_web_app_document_response(python_listing));
            assert!(!is_web_app_document_response(api_error));
            assert_eq!(
                response_html_title(streamed_ssr_app),
                Some("Haabiz UI".to_string())
            );
            assert_eq!(response_html_title(misleading_content_type), None);
            let oversized_title = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><title>{}</title></html>",
                "A".repeat(180)
            );
            assert_eq!(
                response_html_title(oversized_title.as_bytes())
                    .expect("bounded title")
                    .chars()
                    .count(),
                120
            );
            assert_eq!(
                response_html_title(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><title>Unsafe\0title</title></html>"
                ),
                None
            );
        }

        #[test]
        fn recognizes_http_status_without_treating_arbitrary_bytes_as_http() {
            assert_eq!(
                response_status(b"HTTP/1.0 401 Unauthorized\r\n\r\n"),
                Some(401)
            );
            assert_eq!(response_status(b"not-http"), None);
        }

        #[test]
        fn classifies_a_bun_vite_client_as_a_web_frontend() {
            let (listener, handle) = fixture_listener(FixtureKind::Vite, "bun");
            assert_eq!(
                inspect_http(&listener, Instant::now() + Duration::from_secs(1)),
                HttpEvidence {
                    http: true,
                    web_frontend: true,
                    title: Some("App".to_string()),
                }
            );
            handle.join().expect("join fixture server");
        }

        #[test]
        fn classifies_a_bun_preview_document_as_a_web_frontend() {
            let (listener, handle) = fixture_listener(FixtureKind::WebApp, "bun");
            assert_eq!(
                inspect_http(&listener, Instant::now() + Duration::from_secs(1)),
                HttpEvidence {
                    http: true,
                    web_frontend: true,
                    title: None,
                }
            );
            handle.join().expect("join fixture server");
        }

        #[test]
        fn keeps_a_python_html_fallback_out_of_web_frontends() {
            let (listener, handle) = fixture_listener(FixtureKind::GenericHtml, "Python");
            assert_eq!(
                inspect_http(&listener, Instant::now() + Duration::from_secs(1)),
                HttpEvidence {
                    http: true,
                    web_frontend: false,
                    title: Some("App".to_string()),
                }
            );
            handle.join().expect("join fixture server");
        }

        #[test]
        fn keeps_an_arbitrary_javascript_endpoint_out_of_web_frontends() {
            let (listener, handle) = fixture_listener(FixtureKind::FakeJavascript, "node");
            assert_eq!(
                inspect_http(&listener, Instant::now() + Duration::from_secs(1)),
                HttpEvidence {
                    http: true,
                    web_frontend: false,
                    title: Some("App".to_string()),
                }
            );
            handle.join().expect("join fixture server");
        }

        #[test]
        fn reads_only_private_regular_frontend_registry_files_without_following_symlinks() {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let directory = std::env::temp_dir().join(format!(
                "agent-halo-frontend-registry-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&directory).expect("create registry fixture directory");
            let path = directory.join("registry.json");
            let link = directory.join("registry-link.json");
            let now_ms = 1_000_000;
            fs::write(
                &path,
                br#"{"schemaVersion":1,"entries":[{"processId":42,"processStartedAtMs":900000,"bindAddress":"127.0.0.1","port":4173,"expiresAtMs":1060000}]}"#,
            )
            .expect("write registry fixture");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .expect("make registry private");
            assert_eq!(
                read_frontend_registry_path(&path, now_ms)
                    .expect("read private registry")
                    .len(),
                1
            );

            fs::set_permissions(&path, fs::Permissions::from_mode(0o644))
                .expect("make registry public");
            assert!(read_frontend_registry_path(&path, now_ms).is_err());
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .expect("restore registry privacy");
            symlink(&path, &link).expect("create registry symlink");
            assert!(read_frontend_registry_path(&link, now_ms).is_err());

            fs::remove_dir_all(directory).expect("remove registry fixture directory");
        }

        #[test]
        fn attributes_a_service_to_the_nearest_exact_trusted_process_ancestor() {
            let ancestry = vec![
                ProcessIdentity {
                    pid: 90_257,
                    ppid: 81_354,
                    start_time_ms: 2_000,
                },
                ProcessIdentity {
                    pid: 81_354,
                    ppid: 28_071,
                    start_time_ms: 1_000,
                },
            ];
            let targets = vec![LocalServiceOwnerTarget {
                conversation_id: "local-conv-haabiz".to_string(),
                process_id: 81_354,
                expected_start_time_ms: 1_750,
                project: "admin-template".to_string(),
                herdr_pane_id: Some("wH:p1".to_string()),
            }];
            let owner = match_service_owner(&ancestry, &targets).expect("exact ancestor owner");
            assert_eq!(owner.project, "admin-template");
            assert_eq!(owner.herdr_pane_id.as_deref(), Some("wH:p1"));

            let stale_targets = vec![LocalServiceOwnerTarget {
                expected_start_time_ms: 10_000,
                ..targets[0].clone()
            }];
            assert!(match_service_owner(&ancestry, &stale_targets).is_none());

            let malformed_pane_targets = vec![LocalServiceOwnerTarget {
                herdr_pane_id: Some("not a pane".to_string()),
                ..targets[0].clone()
            }];
            assert!(match_service_owner(&ancestry, &malformed_pane_targets).is_none());

            let pane_less_targets = vec![LocalServiceOwnerTarget {
                herdr_pane_id: None,
                ..targets[0].clone()
            }];
            assert_eq!(
                match_service_owner(&ancestry, &pane_less_targets)
                    .expect("trusted non-Herdr owner")
                    .herdr_pane_id,
                None
            );
        }

        #[test]
        fn stops_a_slow_drip_http_response_at_the_absolute_deadline() {
            let server = TcpListener::bind("127.0.0.1:0").expect("bind slow fixture server");
            let listener = listener_for_port(
                server.local_addr().expect("fixture address").port(),
                "Python",
            );
            let handle = thread::spawn(move || {
                let (mut stream, _) = server.accept().expect("accept slow fixture request");
                let mut request = [0_u8; 1_024];
                let _ = stream.read(&mut request);
                for byte in b"HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n" {
                    if stream.write_all(&[*byte]).is_err() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(40));
                }
            });

            let started = Instant::now();
            let _ = request_http(&listener, "HEAD", "/", started + Duration::from_millis(140));
            let elapsed = started.elapsed();
            assert!(
                elapsed < Duration::from_millis(350),
                "slow response exceeded the bounded deadline: {elapsed:?}"
            );
            handle.join().expect("join slow fixture server");
        }
    }
}

#[tauri::command]
pub fn local_services(
    owner_targets: Option<Vec<LocalServiceOwnerTarget>>,
) -> LocalServicesSnapshot {
    #[cfg(target_os = "macos")]
    {
        return macos::sample(owner_targets.unwrap_or_default());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = owner_targets;
        unsupported_snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_frontend_registry, parse_listener_name, parse_lsof_listeners, registry_entry_matches,
        FrontendRegistryEntry, Listener,
    };

    #[test]
    fn parses_ipv4_wildcard_and_loopback_endpoints() {
        assert_eq!(
            parse_listener_name("*:5173"),
            Some(("0.0.0.0".to_string(), 5173))
        );
        assert_eq!(
            parse_listener_name("127.0.0.1:3000"),
            Some(("127.0.0.1".to_string(), 3000))
        );
    }

    #[test]
    fn parses_bracketed_ipv6_endpoints() {
        assert_eq!(
            parse_listener_name("[::1]:5174"),
            Some(("::1".to_string(), 5174))
        );
    }

    #[test]
    fn parses_structured_lsof_output_and_deduplicates_file_descriptors() {
        let output = "p100\ncnode\nLmahiro\nf10\nn127.0.0.1:5173\nf11\nn127.0.0.1:5173\np200\ncpostgres\nn[::1]:5432\n";
        assert_eq!(
            parse_lsof_listeners(output),
            vec![
                super::Listener {
                    process_id: 100,
                    process_name: "node".to_string(),
                    bind_address: "127.0.0.1".to_string(),
                    port: 5173,
                },
                super::Listener {
                    process_id: 200,
                    process_name: "postgres".to_string(),
                    bind_address: "::1".to_string(),
                    port: 5432,
                },
            ]
        );
    }

    #[test]
    fn ignores_malformed_listener_records() {
        let output = "p100\ncbad\nnnot-a-socket\np101\ncnode\n";
        assert!(parse_lsof_listeners(output).is_empty());
    }

    #[test]
    fn accepts_a_bounded_current_frontend_registry() {
        let now_ms = 1_000_000;
        let contents = br#"{
          "schemaVersion": 1,
          "entries": [{
            "processId": 4242,
            "processStartedAtMs": 900000,
            "bindAddress": "127.0.0.1",
            "port": 4173,
            "expiresAtMs": 1060000
          }]
        }"#;
        let entries = parse_frontend_registry(contents, now_ms).expect("valid registry");
        assert_eq!(entries.len(), 1);
        assert!(registry_entry_matches(
            &entries[0],
            &Listener {
                process_id: 4242,
                process_name: "bun".to_string(),
                bind_address: "127.0.0.1".to_string(),
                port: 4173,
            },
            Some(900_750),
            now_ms,
        ));
    }

    #[test]
    fn ignores_expired_entries_and_rejects_future_schema_or_unsafe_entries() {
        let now_ms = 1_000_000;
        let expired = br#"{"schemaVersion":1,"entries":[{"processId":42,"processStartedAtMs":900000,"bindAddress":"127.0.0.1","port":4173,"expiresAtMs":999999}]}"#;
        let future_schema = br#"{"schemaVersion":2,"entries":[]}"#;
        let unsafe_address = br#"{"schemaVersion":1,"entries":[{"processId":42,"processStartedAtMs":900000,"bindAddress":"192.168.1.2","port":4173,"expiresAtMs":1060000}]}"#;
        assert!(parse_frontend_registry(expired, now_ms)
            .expect("expired entries are inert")
            .is_empty());
        assert!(parse_frontend_registry(future_schema, now_ms).is_err());
        assert!(parse_frontend_registry(unsafe_address, now_ms).is_err());
    }

    #[test]
    fn registry_match_requires_exact_process_start_and_endpoint_identity() {
        let now_ms = 1_000_000;
        let entry = FrontendRegistryEntry {
            process_id: 4242,
            process_started_at_ms: 900_000,
            bind_address: "127.0.0.1".to_string(),
            port: 4173,
            expires_at_ms: 1_060_000,
        };
        let listener = Listener {
            process_id: 4242,
            process_name: "bun".to_string(),
            bind_address: "127.0.0.1".to_string(),
            port: 4173,
        };
        assert!(!registry_entry_matches(
            &entry,
            &listener,
            Some(890_000),
            now_ms,
        ));
        assert!(!registry_entry_matches(
            &entry,
            &Listener {
                port: 5173,
                ..listener
            },
            Some(900_000),
            now_ms,
        ));
    }
}
