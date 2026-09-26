//! Sanitized Cursor quota cache for Mahiro Herdr Sidebar.
//!
//! Publication runs only after Agent Halo's existing `GetCurrentPeriodUsage`
//! success. The file contains remaining Auto/API windows and nothing else.

use std::{
    env, fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};

const CACHE_DIR_ENV: &str = "MAHIRO_HERDR_USAGE_CACHE_DIR";
const CACHE_FILE_NAME: &str = "cursor.json";
const MAX_CACHE_BYTES: usize = 64 * 1024;
const MIN_TIMESTAMP_MS: u64 = 1_577_836_800_000;
const MAX_RESET_AHEAD_MS: u64 = 370 * 24 * 60 * 60 * 1000;
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
struct CursorQuotaCache {
    fetched: u64,
    failed: bool,
    windows: Vec<CursorQuotaWindow>,
}

#[derive(Debug, Serialize)]
struct CursorQuotaWindow {
    label: &'static str,
    remaining: f64,
    reset: u64,
}

#[derive(Clone)]
pub(crate) struct CursorCachePublishContext {
    pub env_override: Option<String>,
    pub home: PathBuf,
    pub now_ms: u64,
}

pub(crate) fn publish_after_successful_period_usage(usage: &Value) {
    let Some(context) = production_context() else {
        return;
    };
    let _ = publish_cursor_period_cache(usage, &context);
}

pub(crate) fn publish_cursor_period_cache(
    usage: &Value,
    context: &CursorCachePublishContext,
) -> Result<(), String> {
    let snapshot = normalize_cursor_period_usage(usage, context.now_ms)?;
    let target = cache_target(context)?;
    let bytes = serde_json::to_vec(&snapshot).map_err(|_| "cache json failed".to_string())?;
    if bytes.len() > MAX_CACHE_BYTES {
        return Err("cache json exceeds 64 KiB".to_string());
    }
    atomic_publish(&target, &bytes)
}

fn production_context() -> Option<CursorCachePublishContext> {
    let home = env::var_os("HOME").map(PathBuf::from)?;
    let env_override = env::var(CACHE_DIR_ENV).ok();
    Some(CursorCachePublishContext {
        env_override,
        home,
        now_ms: now_epoch_ms()?,
    })
}

fn now_epoch_ms() -> Option<u64> {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}

fn normalize_cursor_period_usage(usage: &Value, now_ms: u64) -> Result<CursorQuotaCache, String> {
    if now_ms < MIN_TIMESTAMP_MS {
        return Err("cache clock is outside the safe range".to_string());
    }
    let plan_usage = usage
        .get("planUsage")
        .and_then(Value::as_object)
        .ok_or_else(|| "cursor period usage has no plan object".to_string())?;
    let reset = safe_future_reset(usage.get("billingCycleEnd"), now_ms);
    let mut windows = Vec::with_capacity(2);
    if let Some(reset) = reset {
        if let Some(remaining) = remaining_percent(plan_usage.get("autoPercentUsed")) {
            windows.push(CursorQuotaWindow {
                label: "Auto",
                remaining,
                reset,
            });
        }
        if let Some(remaining) = remaining_percent(plan_usage.get("apiPercentUsed")) {
            windows.push(CursorQuotaWindow {
                label: "API",
                remaining,
                reset,
            });
        }
    }
    if windows.is_empty() {
        return Err("cursor period usage has no valid windows".to_string());
    }
    Ok(CursorQuotaCache {
        fetched: now_ms,
        failed: false,
        windows,
    })
}

fn remaining_percent(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    if !number.is_finite() || !(0.0..=100.0).contains(&number) {
        return None;
    }
    let remaining = 100.0 - number;
    remaining.is_finite().then_some(remaining)
}

fn safe_future_reset(value: Option<&Value>, now_ms: u64) -> Option<u64> {
    let reset = epoch_millis(value?)?;
    let latest = now_ms.saturating_add(MAX_RESET_AHEAD_MS);
    if reset > now_ms && reset <= latest && reset >= MIN_TIMESTAMP_MS {
        Some(reset)
    } else {
        None
    }
}

fn epoch_millis(value: &Value) -> Option<u64> {
    if let Value::String(text) = value {
        return text.trim().parse::<u64>().ok();
    }
    let number = value.as_number()?;
    if let Some(reset) = number.as_u64() {
        return Some(reset);
    }
    let reset = number.as_f64()?;
    if !reset.is_finite() || reset < 0.0 || reset.fract() != 0.0 {
        return None;
    }
    Some(reset as u64)
}

fn cache_target(context: &CursorCachePublishContext) -> Result<PathBuf, String> {
    let directory = match context.env_override.as_deref() {
        None => context
            .home
            .join(".letta")
            .join("mods")
            .join("mahiro-usage"),
        Some(value) => absolute_override_dir(value)?,
    };
    if !directory.is_absolute() {
        return Err("cache directory must be absolute".to_string());
    }
    reject_unsafe_components(&directory)?;
    Ok(directory.join(CACHE_FILE_NAME))
}

fn absolute_override_dir(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.contains('\0') || !Path::new(value).is_absolute() {
        return Err("MAHIRO_HERDR_USAGE_CACHE_DIR must be a non-empty absolute path".to_string());
    }
    Ok(PathBuf::from(value))
}

fn reject_unsafe_components(path: &Path) -> Result<(), String> {
    for component in path.components() {
        match component {
            Component::RootDir | Component::Normal(_) => {}
            _ => return Err("cache path contains an unsafe component".to_string()),
        }
    }
    Ok(())
}

fn atomic_publish(target: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_publish_with_before_commit(target, bytes, || {})
}

fn atomic_publish_with_before_commit<F>(
    target: &Path,
    bytes: &[u8],
    before_commit: F,
) -> Result<(), String>
where
    F: FnOnce(),
{
    let directory = target
        .parent()
        .ok_or_else(|| "cache target has no directory".to_string())?;
    ensure_cache_directory(directory)?;
    refuse_existing_target(target)?;
    let (temporary, mut file) = create_owned_temp_file(target)?;
    let publish_result = (|| {
        file.write_all(bytes)
            .map_err(|_| "cache temp write failed".to_string())?;
        file.sync_all()
            .map_err(|_| "cache temp sync failed".to_string())?;
        drop(file);
        #[cfg(unix)]
        set_user_only_file(&temporary)?;
        before_commit();
        refuse_existing_target(target)?;
        fs::rename(&temporary, target).map_err(|_| "cache rename failed".to_string())?;
        #[cfg(unix)]
        set_user_only_file(target)?;
        Ok(())
    })();
    if publish_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    publish_result
}

fn create_owned_temp_file(target: &Path) -> Result<(PathBuf, fs::File), String> {
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "cache target name is invalid".to_string())?;
    for _ in 0..32 {
        let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
        let candidate = target.with_file_name(format!(
            "{name}.{}.{}.{sequence}.tmp",
            std::process::id(),
            now_epoch_ms().unwrap_or(0)
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        match options.open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("cache temp file failed".to_string()),
        }
    }
    Err("cache temp file collision limit reached".to_string())
}

fn ensure_cache_directory(directory: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    let components: Vec<_> = directory.components().collect();
    for (index, component) in components.iter().enumerate() {
        match component {
            Component::RootDir => current.push(component.as_os_str()),
            Component::Normal(part) => {
                current.push(part);
                match fs::symlink_metadata(&current) {
                    Ok(metadata) => {
                        if metadata.file_type().is_symlink() || !metadata.is_dir() {
                            return Err("refusing symlink or non-directory cache path component"
                                .to_string());
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        fs::create_dir(&current)
                            .map_err(|_| "cache directory create failed".to_string())?;
                        #[cfg(unix)]
                        set_owned_private_dir(&current)?;
                        for component in components.iter().skip(index + 1) {
                            let Component::Normal(part) = component else {
                                return Err("cache path contains an unsafe component".to_string());
                            };
                            current.push(part);
                            fs::create_dir(&current)
                                .map_err(|_| "cache directory create failed".to_string())?;
                            #[cfg(unix)]
                            set_owned_private_dir(&current)?;
                        }
                        return Ok(());
                    }
                    Err(_) => return Err("cache directory lookup failed".to_string()),
                }
            }
            _ => return Err("cache path contains an unsafe component".to_string()),
        }
    }
    Ok(())
}

fn refuse_existing_target(target: &Path) -> Result<(), String> {
    match fs::symlink_metadata(target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("refusing symlink or non-regular cache target".to_string());
            }
            #[cfg(unix)]
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err("refusing permissive cache target".to_string());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("cache target lookup failed".to_string()),
    }
}

#[cfg(unix)]
fn set_owned_private_dir(path: &Path) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "cache directory metadata failed".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("refusing symlink or non-directory cache path component".to_string());
    }
    if metadata.uid() != current_uid() {
        return Err("cache directory is not owned by the current user".to_string());
    }
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(path, permissions).map_err(|_| "cache directory mode failed".to_string())
}

#[cfg(unix)]
fn set_user_only_file(path: &Path) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "cache file metadata failed".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("refusing symlink or non-regular cache target".to_string());
    }
    if metadata.uid() != current_uid() {
        return Err("cache file is not owned by the current user".to_string());
    }
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|_| "cache file mode failed".to_string())
}

#[cfg(unix)]
fn current_uid() -> u32 {
    unsafe { libc::geteuid() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn context(home: &Path, override_dir: Option<&str>, now_ms: u64) -> CursorCachePublishContext {
        CursorCachePublishContext {
            env_override: override_dir.map(str::to_string),
            home: home.to_path_buf(),
            now_ms,
        }
    }

    fn sandbox() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT_SANDBOX: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir()
            .canonicalize()
            .expect("temp dir")
            .join(format!(
                "agent-halo-cursor-cache-{}-{}-{}",
                std::process::id(),
                now_epoch_ms().unwrap_or(0),
                NEXT_SANDBOX.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(&root).expect("sandbox");
        root
    }

    fn usage(auto: Value, api: Value, reset: u64) -> Value {
        serde_json::json!({
            "billingCycleEnd": reset,
            "billingCycleStart": reset - 1_000,
            "planUsage": {
                "autoPercentUsed": auto,
                "apiPercentUsed": api,
                "totalPercentUsed": 91,
                "remaining": 4321,
                "limit": 2000
            },
            "planInfo": { "planName": "Secret Plan" },
            "accessToken": "cursor-secret-token",
            "refreshToken": "cursor-refresh-secret",
            "history": [{ "tokens": 999, "model": "hidden-model" }]
        })
    }

    fn mode_of(path: &Path) -> u32 {
        fs::symlink_metadata(path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777
    }

    #[test]
    fn sanitized_snapshot_keeps_only_valid_auto_then_api_windows() {
        let root = sandbox();
        let now = 1_789_110_000_000;
        let reset = now + 86_400_000;
        let payload = usage(serde_json::json!(12.5), serde_json::json!(150), reset);
        publish_cursor_period_cache(&payload, &context(&root, Some(root.to_str().unwrap()), now))
            .expect("publish");
        let text = fs::read_to_string(root.join("cursor.json")).expect("read");
        let value: Value = serde_json::from_str(&text).expect("json");
        assert_eq!(
            value,
            serde_json::json!({
                "fetched": now,
                "failed": false,
                "windows": [{ "label": "Auto", "remaining": 87.5, "reset": reset }]
            })
        );
        for leaked in [
            "Secret Plan",
            "cursor-secret-token",
            "cursor-refresh-secret",
            "hidden-model",
            "totalPercentUsed",
            "planName",
            "accessToken",
            "credits",
            "tokens",
            "history",
        ] {
            assert!(!text.contains(leaked), "{leaked} leaked into {text}");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_percentages_and_reset_are_omitted() {
        let now = 1_789_110_000_000;
        let payload = usage(serde_json::json!(-1), serde_json::json!("40"), now - 1);
        let error = normalize_cursor_period_usage(&payload, now).expect_err("omit");
        assert!(error.contains("no valid windows"));
        let future = usage(
            Value::Null,
            serde_json::json!(0),
            now + MAX_RESET_AHEAD_MS + 1,
        );
        assert!(normalize_cursor_period_usage(&future, now).is_err());
        let api_only = usage(serde_json::json!(101), serde_json::json!(100), now + 5_000);
        let snapshot = normalize_cursor_period_usage(&api_only, now).expect("api");
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.windows[0].label, "API");
        assert_eq!(snapshot.windows[0].remaining, 0.0);
    }

    #[test]
    fn numeric_strings_from_the_live_cursor_response_are_normalized() {
        let now = 1_789_110_000_000;
        let reset = now + 86_400_000;
        let payload = usage(serde_json::json!("12.5"), serde_json::json!("40"), reset);
        let mut payload = payload;
        payload["billingCycleEnd"] = serde_json::json!(reset.to_string());
        let snapshot = normalize_cursor_period_usage(&payload, now).expect("numeric strings");
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].label, "Auto");
        assert_eq!(snapshot.windows[0].remaining, 87.5);
        assert_eq!(snapshot.windows[1].label, "API");
        assert_eq!(snapshot.windows[1].remaining, 60.0);
        assert_eq!(snapshot.windows[0].reset, reset);
    }

    #[test]
    fn relative_or_empty_override_does_not_publish() {
        let root = sandbox();
        let now = 1_789_110_000_000;
        let payload = usage(serde_json::json!(1), serde_json::json!(2), now + 60_000);
        for override_dir in ["", "relative/cache", "cache"] {
            let error =
                publish_cursor_period_cache(&payload, &context(&root, Some(override_dir), now))
                    .expect_err(override_dir);
            assert!(error.contains("absolute"));
        }
        assert!(!root.join(".letta").exists());
        assert!(!root.join("cursor.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn created_directory_and_file_are_user_only() {
        let root = sandbox();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).expect("parent mode");
        let cache_dir = root.join("nested").join("mahiro-usage");
        let now = 1_789_110_000_000;
        let payload = usage(serde_json::json!(25), serde_json::json!(40), now + 60_000);
        publish_cursor_period_cache(
            &payload,
            &context(&root, Some(cache_dir.to_str().unwrap()), now),
        )
        .expect("publish");
        assert_eq!(mode_of(&root), 0o755);
        assert_eq!(mode_of(&cache_dir), 0o700);
        assert_eq!(mode_of(&cache_dir.join("cursor.json")), 0o600);
        let temps: Vec<_> = fs::read_dir(&cache_dir)
            .expect("dir")
            .map(|entry| entry.expect("entry").file_name())
            .filter(|name| name.to_string_lossy().contains(".tmp"))
            .collect();
        assert!(temps.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unsafe_or_permissive_targets_are_refused() {
        let root = sandbox();
        let now = 1_789_110_000_000;
        let payload = usage(serde_json::json!(10), serde_json::json!(20), now + 60_000);
        let publish_at = |dir: &Path| {
            publish_cursor_period_cache(&payload, &context(&root, Some(dir.to_str().unwrap()), now))
        };

        let link_parent = root.join("link-parent");
        fs::create_dir(&link_parent).expect("dir");
        std::os::unix::fs::symlink(root.join("missing"), link_parent.join("via-link"))
            .expect("symlink");
        assert!(publish_at(&link_parent.join("via-link")).is_err());

        let file_component = root.join("not-a-dir");
        fs::write(&file_component, b"x").expect("file");
        assert!(publish_at(&file_component.join("child")).is_err());

        let permissive_dir = root.join("permissive");
        fs::create_dir(&permissive_dir).expect("dir");
        let permissive = permissive_dir.join("cursor.json");
        fs::write(&permissive, b"{\"keep\":true}").expect("file");
        fs::set_permissions(&permissive, fs::Permissions::from_mode(0o644)).expect("mode");
        assert!(publish_at(&permissive_dir)
            .unwrap_err()
            .contains("permissive"));
        assert_eq!(
            fs::read(&permissive).expect("unchanged"),
            b"{\"keep\":true}"
        );
        assert_eq!(mode_of(&permissive), 0o644);

        let linked_dir = root.join("linked-file");
        fs::create_dir(&linked_dir).expect("dir");
        let outside = root.join("outside.json");
        fs::write(&outside, b"secret-outside").expect("outside");
        std::os::unix::fs::symlink(&outside, linked_dir.join("cursor.json")).expect("file link");
        assert!(publish_at(&linked_dir).unwrap_err().contains("symlink"));
        assert_eq!(fs::read(&outside).expect("outside"), b"secret-outside");

        let dir_target = root.join("dir-target");
        fs::create_dir_all(dir_target.join("cursor.json")).expect("dir target");
        assert!(publish_at(&dir_target).unwrap_err().contains("non-regular"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn publication_failure_leaves_usage_value_unchanged() {
        let root = sandbox();
        let blocker = root.join("blocker");
        fs::write(&blocker, b"not-dir").expect("blocker");
        let now = 1_789_110_000_000;
        let payload = usage(serde_json::json!(10), serde_json::json!(20), now + 60_000);
        let before = payload.clone();
        let error = publish_cursor_period_cache(
            &payload,
            &context(&root, Some(blocker.join("cache").to_str().unwrap()), now),
        )
        .expect_err("isolated");
        assert!(error.contains("non-directory") || error.contains("create"));
        assert_eq!(payload, before);
        assert!(!root.join(".letta").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn concurrent_publications_use_invocation_owned_temp_files() {
        use std::sync::{Arc, Barrier};

        let root = sandbox();
        let now = 1_789_110_000_000;
        let target = root.to_str().expect("root").to_string();
        let barrier = Arc::new(Barrier::new(8));
        let handles = (0..8)
            .map(|index| {
                let barrier = Arc::clone(&barrier);
                let root = root.clone();
                let target = target.clone();
                std::thread::spawn(move || {
                    let payload = usage(
                        serde_json::json!(10 + index),
                        serde_json::json!(20 + index),
                        now + 60_000,
                    );
                    barrier.wait();
                    publish_cursor_period_cache(&payload, &context(&root, Some(&target), now))
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().expect("thread").expect("publish");
        }
        let value: Value = serde_json::from_slice(
            &fs::read(root.join("cursor.json")).expect("valid atomic winner"),
        )
        .expect("json");
        assert_eq!(value.get("failed"), Some(&Value::Bool(false)));
        assert_eq!(value["windows"].as_array().expect("windows").len(), 2);
        assert!(fs::read_dir(&root).expect("dir").all(|entry| !entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .contains(".tmp")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn second_target_check_failure_removes_only_the_owned_temp_file() {
        let root = sandbox();
        let target = root.join("cursor.json");
        let bytes = br#"{"fetched":1789110000000,"failed":false,"windows":[]}"#;
        let result = atomic_publish_with_before_commit(&target, bytes, || {
            fs::write(&target, b"external target").expect("target race");
            fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("mode");
        });
        assert!(result
            .expect_err("second target check")
            .contains("permissive"));
        assert_eq!(
            fs::read(&target).expect("external target"),
            b"external target"
        );
        assert!(fs::read_dir(&root).expect("dir").all(|entry| !entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .contains(".tmp")));
        let _ = fs::remove_dir_all(&root);
    }
}
