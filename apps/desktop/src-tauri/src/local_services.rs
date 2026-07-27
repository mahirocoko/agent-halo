use serde::Serialize;

const MAX_LOCAL_SERVICES: usize = 64;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalService {
    pub process_id: i32,
    pub process_name: String,
    pub bind_address: String,
    pub port: u16,
    pub kind: String,
    pub url: Option<String>,
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
        parse_lsof_listeners, unix_time_ms, Listener, LocalService, LocalServicesSnapshot,
    };
    use std::{
        io::{Read, Write},
        net::{IpAddr, SocketAddr, TcpStream},
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
    const MAX_LSOF_OUTPUT_BYTES: u64 = 256 * 1024;

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

    fn is_http(listener: &Listener, deadline: Instant) -> bool {
        let Some(address) = probe_address(listener) else {
            return false;
        };
        let Some(timeout) = remaining(deadline, HTTP_PROBE_TIMEOUT) else {
            return false;
        };
        let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));
        if stream
            .write_all(b"HEAD / HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .is_err()
        {
            return false;
        }
        let mut response = [0_u8; 16];
        let Ok(read) = stream.read(&mut response) else {
            return false;
        };
        response[..read].starts_with(b"HTTP/")
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

    pub(super) fn sample() -> LocalServicesSnapshot {
        let deadline = Instant::now() + DISCOVERY_BUDGET;
        let output = match run_lsof(deadline) {
            Ok(output) => output,
            Err(error) => {
                return LocalServicesSnapshot {
                    sampled_at_ms: unix_time_ms(),
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
                let http = is_http(listener, deadline);
                LocalService {
                    process_id: listener.process_id,
                    process_name: listener.process_name.clone(),
                    bind_address: listener.bind_address.clone(),
                    port: listener.port,
                    kind: if http { "http" } else { "tcp" }.to_string(),
                    url: http.then(|| browser_url(listener)),
                }
            })
            .collect();

        LocalServicesSnapshot {
            sampled_at_ms: unix_time_ms(),
            status: "ok".to_string(),
            error: None,
            services,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::run_bounded_output;
        use std::{
            process::Command,
            time::{Duration, Instant},
        };

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
    }
}

#[tauri::command]
pub fn local_services() -> LocalServicesSnapshot {
    #[cfg(target_os = "macos")]
    {
        return macos::sample();
    }
    #[cfg(not(target_os = "macos"))]
    {
        unsupported_snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_listener_name, parse_lsof_listeners};

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
}
