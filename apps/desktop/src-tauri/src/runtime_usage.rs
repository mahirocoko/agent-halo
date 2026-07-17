use std::{collections::HashMap, sync::Mutex, time::Instant};

use serde::{Deserialize, Serialize};

const MAX_TREE_DEPTH: usize = 32;
const MAX_TREE_PROCESSES: usize = 512;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeUsageTarget {
    pub conversation_id: String,
    pub event_id: String,
    pub process_id: i32,
    pub expected_start_time_ms: Option<u64>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProcessMetrics {
    pub physical_footprint_bytes: u64,
    pub resident_size_bytes: u64,
    pub cpu_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChildProcess {
    pub process_id: i32,
    pub name: String,
    pub physical_footprint_bytes: u64,
    pub cpu_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChildMetrics {
    pub process_count: usize,
    pub physical_footprint_bytes: u64,
    pub resident_size_bytes: u64,
    pub cpu_percent: Option<f64>,
    pub top_processes: Vec<RuntimeChildProcess>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeUsageSnapshot {
    pub conversation_id: String,
    pub process_id: i32,
    pub process_start_time_ms: Option<u64>,
    pub cwd: Option<String>,
    pub sampled_at_ms: u64,
    pub status: String,
    pub error: Option<String>,
    pub host: Option<RuntimeProcessMetrics>,
    pub children: Option<RuntimeChildMetrics>,
}

#[derive(Debug, Clone)]
struct CpuBaseline {
    total_cpu_ns: u64,
    sampled_at: Instant,
}

#[derive(Default)]
pub struct RuntimeUsageState {
    baselines: Mutex<HashMap<(i32, u64), CpuBaseline>>,
    target_identities: Mutex<HashMap<(String, String, i32), u64>>,
}

#[derive(Debug, Clone)]
struct BasicProcess {
    pid: i32,
    ppid: i32,
    start_time_ms: u64,
    name: String,
}

#[derive(Debug, Clone)]
struct ProcessReading {
    basic: BasicProcess,
    physical_footprint_bytes: u64,
    resident_size_bytes: u64,
    cpu_percent: Option<f64>,
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn calculate_cpu_percent(
    previous_cpu_ns: u64,
    current_cpu_ns: u64,
    elapsed: std::time::Duration,
) -> Option<f64> {
    if current_cpu_ns < previous_cpu_ns || elapsed.is_zero() {
        return None;
    }
    let elapsed_ns = elapsed.as_nanos() as f64;
    if elapsed_ns <= 0.0 {
        return None;
    }
    Some(((current_cpu_ns - previous_cpu_ns) as f64 / elapsed_ns) * 100.0)
}

fn collect_descendants(root_pid: i32, children_by_parent: &HashMap<i32, Vec<i32>>) -> Vec<i32> {
    let mut descendants = Vec::new();
    let mut visited = std::collections::HashSet::from([root_pid]);
    let mut stack = children_by_parent
        .get(&root_pid)
        .into_iter()
        .flatten()
        .copied()
        .map(|pid| (pid, 1usize))
        .collect::<Vec<_>>();

    while let Some((pid, depth)) = stack.pop() {
        if descendants.len() >= MAX_TREE_PROCESSES || depth > MAX_TREE_DEPTH || !visited.insert(pid)
        {
            continue;
        }
        descendants.push(pid);
        if let Some(children) = children_by_parent.get(&pid) {
            stack.extend(children.iter().copied().map(|child| (child, depth + 1)));
        }
    }

    descendants.sort_unstable();
    descendants
}

fn same_cwd(expected: &str, actual: &str) -> bool {
    if expected.trim_end_matches('/') == actual.trim_end_matches('/') {
        return true;
    }
    match (
        std::fs::canonicalize(expected),
        std::fs::canonicalize(actual),
    ) {
        (Ok(expected), Ok(actual)) => expected == actual,
        _ => false,
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::{
        mem::{size_of, size_of_val},
        os::raw::c_void,
    };

    fn bounded_c_chars(ptr: *const libc::c_char, length: usize) -> String {
        let bytes = unsafe { std::slice::from_raw_parts(ptr.cast::<u8>(), length) };
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).into_owned()
    }

    fn basic_process(pid: i32) -> Option<BasicProcess> {
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
        if read != expected_size || info.pbi_pid == 0 {
            return None;
        }
        let name = bounded_c_chars(info.pbi_name.as_ptr(), info.pbi_name.len());
        Some(BasicProcess {
            pid: info.pbi_pid as i32,
            ppid: info.pbi_ppid as i32,
            start_time_ms: info
                .pbi_start_tvsec
                .saturating_mul(1_000)
                .saturating_add(info.pbi_start_tvusec / 1_000),
            name,
        })
    }

    #[cfg(test)]
    pub(super) fn process_start_time_ms(pid: i32) -> Option<u64> {
        basic_process(pid).map(|process| process.start_time_ms)
    }

    fn all_processes() -> HashMap<i32, BasicProcess> {
        let requested = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if requested <= 0 {
            return HashMap::new();
        }
        let mut pids = vec![0i32; requested as usize + 128];
        let read = unsafe {
            libc::proc_listallpids(
                pids.as_mut_ptr().cast::<c_void>(),
                (pids.len() * size_of::<i32>()) as i32,
            )
        };
        if read <= 0 {
            return HashMap::new();
        }
        pids.into_iter()
            .take(read as usize)
            .filter(|pid| *pid > 0)
            .filter_map(|pid| basic_process(pid).map(|process| (pid, process)))
            .collect()
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
        let path = bounded_c_chars(
            info.pvi_cdir.vip_path.as_ptr().cast::<libc::c_char>(),
            size_of_val(&info.pvi_cdir.vip_path),
        );
        (!path.is_empty()).then_some(path)
    }

    fn rusage(pid: i32) -> Option<libc::rusage_info_v4> {
        let mut info = unsafe { std::mem::zeroed::<libc::rusage_info_v4>() };
        let result = unsafe {
            libc::proc_pid_rusage(
                pid,
                libc::RUSAGE_INFO_V4,
                (&mut info as *mut libc::rusage_info_v4).cast::<libc::rusage_info_t>(),
            )
        };
        (result == 0).then_some(info)
    }

    pub fn sample(
        targets: Vec<RuntimeUsageTarget>,
        state: &RuntimeUsageState,
    ) -> Vec<RuntimeUsageSnapshot> {
        let sampled_at_ms = unix_time_ms();
        let sampled_at = Instant::now();
        let processes = all_processes();
        let mut children_by_parent: HashMap<i32, Vec<i32>> = HashMap::new();
        for process in processes.values() {
            children_by_parent
                .entry(process.ppid)
                .or_default()
                .push(process.pid);
        }

        let mut requested_pids = std::collections::HashSet::new();
        for target in &targets {
            requested_pids.insert(target.process_id);
            requested_pids.extend(collect_descendants(target.process_id, &children_by_parent));
        }

        let mut baselines = state
            .baselines
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut readings = HashMap::new();
        let mut observed_identities = std::collections::HashSet::new();
        for pid in requested_pids {
            let Some(basic) = processes.get(&pid).cloned() else {
                continue;
            };
            let Some(usage) = rusage(pid) else {
                continue;
            };
            let key = (pid, basic.start_time_ms);
            let total_cpu_ns = usage.ri_user_time.saturating_add(usage.ri_system_time);
            let cpu_percent = baselines.get(&key).and_then(|previous| {
                calculate_cpu_percent(
                    previous.total_cpu_ns,
                    total_cpu_ns,
                    sampled_at.duration_since(previous.sampled_at),
                )
            });
            baselines.insert(
                key,
                CpuBaseline {
                    total_cpu_ns,
                    sampled_at,
                },
            );
            observed_identities.insert(key);
            readings.insert(
                pid,
                ProcessReading {
                    basic,
                    physical_footprint_bytes: usage.ri_phys_footprint,
                    resident_size_bytes: usage.ri_resident_size,
                    cpu_percent,
                },
            );
        }
        baselines.retain(|key, _| observed_identities.contains(key));
        drop(baselines);

        let mut target_identities = state
            .target_identities
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let current_target_keys = targets
            .iter()
            .map(|target| {
                (
                    target.conversation_id.clone(),
                    target.event_id.clone(),
                    target.process_id,
                )
            })
            .collect::<std::collections::HashSet<_>>();
        target_identities.retain(|key, _| current_target_keys.contains(key));

        targets
            .into_iter()
            .map(|target| {
                let Some(root) = readings.get(&target.process_id) else {
                    return RuntimeUsageSnapshot {
                        conversation_id: target.conversation_id,
                        process_id: target.process_id,
                        process_start_time_ms: None,
                        cwd: None,
                        sampled_at_ms,
                        status: "missing".to_string(),
                        error: Some("Letta host process is no longer available".to_string()),
                        host: None,
                        children: None,
                    };
                };
                let Some(expected_start_time_ms) = target.expected_start_time_ms else {
                    return RuntimeUsageSnapshot {
                        conversation_id: target.conversation_id,
                        process_id: target.process_id,
                        process_start_time_ms: Some(root.basic.start_time_ms),
                        cwd: process_cwd(root.basic.pid),
                        sampled_at_ms,
                        status: "unavailable".to_string(),
                        error: Some("Runtime event is missing process start identity".to_string()),
                        host: None,
                        children: None,
                    };
                };
                if expected_start_time_ms.abs_diff(root.basic.start_time_ms) > 2_000 {
                    return RuntimeUsageSnapshot {
                        conversation_id: target.conversation_id,
                        process_id: target.process_id,
                        process_start_time_ms: Some(root.basic.start_time_ms),
                        cwd: process_cwd(root.basic.pid),
                        sampled_at_ms,
                        status: "pidReused".to_string(),
                        error: Some(
                            "PID start time no longer matches this runtime event".to_string(),
                        ),
                        host: None,
                        children: None,
                    };
                }
                let target_key = (
                    target.conversation_id.clone(),
                    target.event_id.clone(),
                    target.process_id,
                );
                if target_identities
                    .get(&target_key)
                    .is_some_and(|start_time| *start_time != root.basic.start_time_ms)
                {
                    return RuntimeUsageSnapshot {
                        conversation_id: target.conversation_id,
                        process_id: target.process_id,
                        process_start_time_ms: Some(root.basic.start_time_ms),
                        cwd: process_cwd(root.basic.pid),
                        sampled_at_ms,
                        status: "pidReused".to_string(),
                        error: Some("PID was reused after this event was recorded".to_string()),
                        host: None,
                        children: None,
                    };
                }
                target_identities.insert(target_key, root.basic.start_time_ms);
                let actual_cwd = process_cwd(root.basic.pid);
                let (Some(expected), Some(actual)) = (target.cwd.as_deref(), actual_cwd.as_deref())
                else {
                    return RuntimeUsageSnapshot {
                        conversation_id: target.conversation_id,
                        process_id: target.process_id,
                        process_start_time_ms: Some(root.basic.start_time_ms),
                        cwd: actual_cwd,
                        sampled_at_ms,
                        status: "unavailable".to_string(),
                        error: Some("Strong process identity requires a readable cwd".to_string()),
                        host: None,
                        children: None,
                    };
                };
                if !same_cwd(expected, actual) {
                    return RuntimeUsageSnapshot {
                        conversation_id: target.conversation_id,
                        process_id: target.process_id,
                        process_start_time_ms: Some(root.basic.start_time_ms),
                        cwd: actual_cwd,
                        sampled_at_ms,
                        status: "identityMismatch".to_string(),
                        error: Some("PID now belongs to a different working directory".to_string()),
                        host: None,
                        children: None,
                    };
                }

                let descendant_ids = collect_descendants(root.basic.pid, &children_by_parent);
                let mut descendants = descendant_ids
                    .into_iter()
                    .filter_map(|pid| readings.get(&pid).cloned())
                    .collect::<Vec<_>>();
                descendants
                    .sort_by_key(|reading| std::cmp::Reverse(reading.physical_footprint_bytes));
                let tool_cpu_values = descendants
                    .iter()
                    .filter_map(|reading| reading.cpu_percent)
                    .collect::<Vec<_>>();
                let tool_cpu = if descendants.is_empty() {
                    Some(0.0)
                } else if tool_cpu_values.is_empty() {
                    None
                } else {
                    Some(tool_cpu_values.into_iter().sum())
                };
                let children = RuntimeChildMetrics {
                    process_count: descendants.len(),
                    physical_footprint_bytes: descendants
                        .iter()
                        .map(|reading| reading.physical_footprint_bytes)
                        .sum(),
                    resident_size_bytes: descendants
                        .iter()
                        .map(|reading| reading.resident_size_bytes)
                        .sum(),
                    cpu_percent: tool_cpu,
                    top_processes: descendants
                        .iter()
                        .take(5)
                        .map(|reading| RuntimeChildProcess {
                            process_id: reading.basic.pid,
                            name: reading.basic.name.clone(),
                            physical_footprint_bytes: reading.physical_footprint_bytes,
                            cpu_percent: reading.cpu_percent,
                        })
                        .collect(),
                };

                RuntimeUsageSnapshot {
                    conversation_id: target.conversation_id,
                    process_id: target.process_id,
                    process_start_time_ms: Some(root.basic.start_time_ms),
                    cwd: actual_cwd,
                    sampled_at_ms,
                    status: "ok".to_string(),
                    error: None,
                    host: Some(RuntimeProcessMetrics {
                        physical_footprint_bytes: root.physical_footprint_bytes,
                        resident_size_bytes: root.resident_size_bytes,
                        cpu_percent: root.cpu_percent,
                    }),
                    children: Some(children),
                }
            })
            .collect()
    }
}

#[tauri::command]
pub fn runtime_usage(
    targets: Vec<RuntimeUsageTarget>,
    state: tauri::State<'_, RuntimeUsageState>,
) -> Vec<RuntimeUsageSnapshot> {
    if targets.len() > 64 {
        return targets
            .into_iter()
            .map(|target| RuntimeUsageSnapshot {
                conversation_id: target.conversation_id,
                process_id: target.process_id,
                process_start_time_ms: None,
                cwd: None,
                sampled_at_ms: unix_time_ms(),
                status: "unavailable".to_string(),
                error: Some("Runtime monitor accepts at most 64 sessions per sample".to_string()),
                host: None,
                children: None,
            })
            .collect();
    }
    #[cfg(target_os = "macos")]
    {
        macos::sample(targets, &state)
    }
    #[cfg(not(target_os = "macos"))]
    {
        targets
            .into_iter()
            .map(|target| RuntimeUsageSnapshot {
                conversation_id: target.conversation_id,
                process_id: target.process_id,
                process_start_time_ms: None,
                cwd: target.cwd,
                sampled_at_ms: unix_time_ms(),
                status: "unsupported".to_string(),
                error: Some("Runtime monitor currently supports macOS only".to_string()),
                host: None,
                children: None,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn cpu_percent_uses_one_core_as_one_hundred_percent() {
        assert_eq!(
            calculate_cpu_percent(1_000_000_000, 1_500_000_000, Duration::from_secs(1)),
            Some(50.0)
        );
        assert_eq!(
            calculate_cpu_percent(1_000_000_000, 3_000_000_000, Duration::from_secs(1)),
            Some(200.0)
        );
    }

    #[test]
    fn cpu_percent_rejects_counter_regression() {
        assert_eq!(
            calculate_cpu_percent(2_000_000_000, 1_000_000_000, Duration::from_secs(1)),
            None
        );
    }

    #[test]
    fn descendants_are_recursive_bounded_and_cycle_safe() {
        let children = HashMap::from([(10, vec![11, 12]), (11, vec![13]), (13, vec![10])]);
        assert_eq!(collect_descendants(10, &children), vec![11, 12, 13]);
    }

    #[test]
    fn cwd_comparison_ignores_only_trailing_slashes() {
        assert!(same_cwd("/tmp/work/", "/tmp/work"));
        assert!(!same_cwd("/tmp/work", "/tmp/other"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_sampler_reads_current_process_without_shelling_out() {
        let state = RuntimeUsageState::default();
        let target = RuntimeUsageTarget {
            conversation_id: "test-conversation".to_string(),
            event_id: "event-1".to_string(),
            process_id: std::process::id() as i32,
            expected_start_time_ms: macos::process_start_time_ms(std::process::id() as i32),
            cwd: std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().into_owned()),
        };
        let first = macos::sample(vec![target.clone()], &state);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].status, "ok");
        assert!(first[0]
            .host
            .as_ref()
            .is_some_and(|host| host.physical_footprint_bytes > 0));

        std::thread::sleep(Duration::from_millis(10));
        let second = macos::sample(vec![target], &state);
        assert!(second[0]
            .host
            .as_ref()
            .is_some_and(|host| host.cpu_percent.is_some()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_sampler_rejects_pid_reuse_for_the_same_event_identity() {
        let state = RuntimeUsageState::default();
        let target = RuntimeUsageTarget {
            conversation_id: "test-conversation".to_string(),
            event_id: "event-reuse".to_string(),
            process_id: std::process::id() as i32,
            expected_start_time_ms: macos::process_start_time_ms(std::process::id() as i32),
            cwd: std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().into_owned()),
        };
        state
            .target_identities
            .lock()
            .expect("target identity lock")
            .insert(
                (
                    target.conversation_id.clone(),
                    target.event_id.clone(),
                    target.process_id,
                ),
                1,
            );
        let sample = macos::sample(vec![target], &state);
        assert_eq!(sample[0].status, "pidReused");
        assert!(sample[0].host.is_none());
    }
}
