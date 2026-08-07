use std::{
    fs,
    io::{ErrorKind, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const BRIDGE_HOST: &str = "127.0.0.1";
const BRIDGE_PORT: u16 = 47_621;
const BRIDGE_PROBE_TIMEOUT: Duration = Duration::from_millis(350);
const BRIDGE_SUPERVISOR_INTERVAL: Duration = Duration::from_secs(1);
const OWNED_BRIDGE_FAILURE_LIMIT: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BridgeProbe {
    Healthy,
    Occupied,
    Offline,
}

#[derive(Clone, Copy, Debug)]
struct BridgeEndpoint {
    address: SocketAddr,
}

impl Default for BridgeEndpoint {
    fn default() -> Self {
        Self {
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), BRIDGE_PORT),
        }
    }
}

struct BridgeSupervisorHandle {
    stop_tx: mpsc::Sender<()>,
    join: JoinHandle<()>,
}

#[derive(Default)]
pub(crate) struct StandaloneBridgeState {
    supervisor: Mutex<Option<BridgeSupervisorHandle>>,
}

impl StandaloneBridgeState {
    pub(crate) fn start(&self, bridge_script: PathBuf) -> Result<(), String> {
        let node = find_node_binary().ok_or_else(|| {
            "Agent Halo could not find Node.js for the standalone bridge".to_string()
        })?;
        self.start_with(bridge_script, node, BridgeEndpoint::default())
    }

    fn start_with(
        &self,
        bridge_script: PathBuf,
        node: PathBuf,
        endpoint: BridgeEndpoint,
    ) -> Result<(), String> {
        if !bridge_script.is_file() {
            return Err(format!(
                "Standalone bridge resource is missing: {}",
                bridge_script.display()
            ));
        }

        let mut supervisor = self
            .supervisor
            .lock()
            .map_err(|_| "Standalone bridge supervisor state is unavailable".to_string())?;
        if supervisor.is_some() {
            return Ok(());
        }

        let (stop_tx, stop_rx) = mpsc::channel();
        let join = thread::Builder::new()
            .name("agent-halo-bridge-supervisor".to_string())
            .spawn(move || supervise_bridge(bridge_script, node, endpoint, stop_rx))
            .map_err(|error| format!("Failed to start standalone bridge supervisor: {error}"))?;
        *supervisor = Some(BridgeSupervisorHandle { stop_tx, join });
        Ok(())
    }

    pub(crate) fn stop(&self) {
        let handle = self
            .supervisor
            .lock()
            .ok()
            .and_then(|mut supervisor| supervisor.take());
        if let Some(handle) = handle {
            let _ = handle.stop_tx.send(());
            let _ = handle.join.join();
        }
    }
}

pub(crate) fn bridge_health() -> bool {
    probe_bridge(BridgeEndpoint::default()) == BridgeProbe::Healthy
}

fn supervise_bridge(
    bridge_script: PathBuf,
    node: PathBuf,
    endpoint: BridgeEndpoint,
    stop_rx: mpsc::Receiver<()>,
) {
    let mut owned_child: Option<Child> = None;
    let mut consecutive_failures = 0_u8;

    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        if let Some(child) = owned_child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    eprintln!("Agent Halo standalone bridge exited: {status}");
                    owned_child = None;
                    consecutive_failures = 0;
                }
                Err(error) => {
                    eprintln!("Agent Halo could not inspect its standalone bridge: {error}");
                    owned_child = None;
                    consecutive_failures = 0;
                }
                Ok(None) => {}
            }
        }

        let probe = probe_bridge(endpoint);
        if owned_child.is_some() {
            if probe == BridgeProbe::Healthy {
                consecutive_failures = 0;
            } else {
                consecutive_failures = consecutive_failures.saturating_add(1);
                if consecutive_failures >= OWNED_BRIDGE_FAILURE_LIMIT {
                    stop_owned_child(&mut owned_child);
                    consecutive_failures = 0;
                }
            }
        } else if probe == BridgeProbe::Offline {
            owned_child = match spawn_bridge(&node, &bridge_script, endpoint) {
                Ok(child) => Some(child),
                Err(error) => {
                    eprintln!("Agent Halo could not start its standalone bridge: {error}");
                    None
                }
            };
            consecutive_failures = 0;
        }

        match stop_rx.recv_timeout(BRIDGE_SUPERVISOR_INTERVAL) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }

    stop_owned_child(&mut owned_child);
}

fn spawn_bridge(
    node: &Path,
    bridge_script: &Path,
    endpoint: BridgeEndpoint,
) -> std::io::Result<Child> {
    Command::new(node)
        .arg(bridge_script)
        .arg("--port")
        .arg(endpoint.address.port().to_string())
        .arg("--host")
        .arg(BRIDGE_HOST)
        .arg("--parent-stdio")
        .env("PATH", super::enriched_cli_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
}

fn stop_owned_child(child: &mut Option<Child>) {
    if let Some(mut child) = child.take() {
        drop(child.stdin.take());
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn probe_bridge(endpoint: BridgeEndpoint) -> BridgeProbe {
    let mut stream = match TcpStream::connect_timeout(&endpoint.address, BRIDGE_PROBE_TIMEOUT) {
        Ok(stream) => stream,
        Err(error) => return classify_connect_error(&error),
    };
    let _ = stream.set_read_timeout(Some(BRIDGE_PROBE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(BRIDGE_PROBE_TIMEOUT));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: {BRIDGE_HOST}:{}\r\nConnection: close\r\n\r\n",
        endpoint.address.port()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return BridgeProbe::Occupied;
    }

    let mut response = String::new();
    let _ = stream.take(64 * 1024).read_to_string(&mut response);
    if is_agent_halo_health_response(&response) {
        BridgeProbe::Healthy
    } else {
        BridgeProbe::Occupied
    }
}

fn classify_connect_error(error: &std::io::Error) -> BridgeProbe {
    if error.kind() == ErrorKind::ConnectionRefused {
        BridgeProbe::Offline
    } else {
        BridgeProbe::Occupied
    }
}

fn is_agent_halo_health_response(response: &str) -> bool {
    let mut sections = response.splitn(2, "\r\n\r\n");
    let Some(headers) = sections.next() else {
        return false;
    };
    let Some(body) = sections.next() else {
        return false;
    };
    if !headers
        .lines()
        .next()
        .is_some_and(|line| line.starts_with("HTTP/1.1 200 ") || line.starts_with("HTTP/1.0 200 "))
    {
        return false;
    }
    let Some(json_start) = body.find('{') else {
        return false;
    };
    let Some(json_end) = body.rfind('}') else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&body[json_start..=json_end])
        .ok()
        .is_some_and(|payload| {
            payload.get("ok").and_then(|value| value.as_bool()) == Some(true)
                && payload.get("name").and_then(|value| value.as_str()) == Some("agent-halo")
                && payload.get("version").and_then(|value| value.as_u64()) == Some(2)
        })
}

fn find_node_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AGENT_HALO_NODE_BINARY") {
        let path = PathBuf::from(path);
        if path.is_absolute() && path.is_file() {
            return Some(path);
        }
    }

    for directory in super::enriched_cli_path().split(':') {
        let candidate = Path::new(directory).join("node");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let versions = super::home_dir()?.join(".nvm/versions/node");
    let mut candidates = fs::read_dir(versions)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("bin/node"))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        net::TcpListener,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn wait_for_probe(endpoint: BridgeEndpoint, expected: BridgeProbe) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if probe_bridge(endpoint) == expected {
                return true;
            }
            thread::sleep(Duration::from_millis(40));
        }
        false
    }

    fn serve_health_fixture(
        listener: TcpListener,
        body: &'static str,
    ) -> (mpsc::Sender<()>, JoinHandle<()>) {
        listener
            .set_nonblocking(true)
            .expect("nonblocking fixture listener");
        let (stop_tx, stop_rx) = mpsc::channel();
        let join = thread::spawn(move || loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let response = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        });
        (stop_tx, join)
    }

    #[test]
    fn health_parser_accepts_letta_and_standalone_bridge_payloads() {
        for body in [
            r#"{"ok":true,"name":"agent-halo","version":2,"clients":1}"#,
            r#"{"ok":true,"name":"agent-halo","version":2,"mode":"standalone","clients":0}"#,
        ] {
            assert!(is_agent_halo_health_response(&format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{body}"
            )));
        }
    }

    #[test]
    fn health_parser_rejects_an_unrelated_listener() {
        assert!(!is_agent_halo_health_response(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"ok\":true,\"name\":\"other\",\"version\":2}"
        ));
        assert!(!is_agent_halo_health_response(
            "HTTP/1.1 503 Service Unavailable\r\n\r\n{\"ok\":true,\"name\":\"agent-halo\",\"version\":2}"
        ));
    }

    #[test]
    fn uncertain_connection_failures_are_fail_closed() {
        assert_eq!(
            classify_connect_error(&std::io::Error::new(ErrorKind::ConnectionRefused, "closed")),
            BridgeProbe::Offline
        );
        assert_eq!(
            classify_connect_error(&std::io::Error::new(ErrorKind::TimedOut, "uncertain")),
            BridgeProbe::Occupied
        );
        assert_eq!(
            classify_connect_error(&std::io::Error::new(
                ErrorKind::PermissionDenied,
                "uncertain"
            )),
            BridgeProbe::Occupied
        );
    }

    #[test]
    fn supervisor_starts_and_stops_an_owned_bridge() {
        let Some(node) = find_node_binary() else {
            return;
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("reserve test port");
        let port = listener.local_addr().expect("test address").port();
        drop(listener);
        let endpoint = BridgeEndpoint {
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        };
        assert_eq!(probe_bridge(endpoint), BridgeProbe::Offline, "port {port}");
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("agent-halo-bridge-{unique}"));
        fs::create_dir_all(&directory).expect("fixture directory");
        let script = directory.join("bridge.mjs");
        fs::write(
            &script,
            r#"import { createServer } from 'node:http'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, name: 'agent-halo', version: 2, mode: 'standalone' }))
    return
  }
  response.writeHead(404)
  response.end()
})
server.listen(port, '127.0.0.1')
process.stdin.resume()
process.stdin.on('end', () => server.close(() => process.exit(0)))
"#,
        )
        .expect("fixture script");

        let state = StandaloneBridgeState::default();
        state
            .start_with(script, node, endpoint)
            .expect("start supervisor");
        assert!(wait_for_probe(endpoint, BridgeProbe::Healthy));
        state.stop();
        assert!(wait_for_probe(endpoint, BridgeProbe::Offline));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn supervisor_never_replaces_an_existing_or_unrelated_listener() {
        let Some(node) = find_node_binary() else {
            return;
        };
        for (label, body, expected_probe) in [
            (
                "healthy",
                r#"{"ok":true,"name":"agent-halo","version":2}"#,
                BridgeProbe::Healthy,
            ),
            (
                "occupied",
                r#"{"ok":true,"name":"other","version":2}"#,
                BridgeProbe::Occupied,
            ),
        ] {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("fixture listener");
            let port = listener.local_addr().expect("fixture address").port();
            let endpoint = BridgeEndpoint {
                address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
            };
            let (server_stop, server_join) = serve_health_fixture(listener, body);
            assert!(wait_for_probe(endpoint, expected_probe));

            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let directory =
                std::env::temp_dir().join(format!("agent-halo-bridge-{label}-{unique}"));
            fs::create_dir_all(&directory).expect("fixture directory");
            let marker = directory.join("unexpected-spawn");
            let script = directory.join("bridge.mjs");
            let marker_json = serde_json::to_string(&marker.to_string_lossy()).expect("marker");
            fs::write(
                &script,
                format!(
                    "import {{ writeFileSync }} from 'node:fs'\nwriteFileSync({marker_json}, 'spawned')\nsetInterval(() => {{}}, 1000)\n"
                ),
            )
            .expect("marker script");

            let state = StandaloneBridgeState::default();
            state
                .start_with(script, node.clone(), endpoint)
                .expect("start supervisor");
            thread::sleep(Duration::from_millis(1_250));
            assert!(!marker.exists(), "{label} listener was replaced");
            state.stop();
            let _ = server_stop.send(());
            let _ = server_join.join();
            let _ = fs::remove_dir_all(directory);
        }
    }

    #[test]
    fn supervisor_takes_over_after_an_external_owner_stops() {
        let Some(node) = find_node_binary() else {
            return;
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("fixture listener");
        let port = listener.local_addr().expect("fixture address").port();
        let endpoint = BridgeEndpoint {
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        };
        let (server_stop, server_join) =
            serve_health_fixture(listener, r#"{"ok":true,"name":"agent-halo","version":2}"#);
        assert!(wait_for_probe(endpoint, BridgeProbe::Healthy));

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("agent-halo-bridge-takeover-{unique}"));
        fs::create_dir_all(&directory).expect("fixture directory");
        let marker = directory.join("owned-started");
        let marker_json = serde_json::to_string(&marker.to_string_lossy()).expect("marker");
        let script = directory.join("bridge.mjs");
        fs::write(
            &script,
            format!(
                r#"import {{ writeFileSync }} from 'node:fs'
import {{ createServer }} from 'node:http'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
writeFileSync({marker_json}, 'started')
const server = createServer((request, response) => {{
  if (request.url === '/health') {{
    response.writeHead(200, {{ 'content-type': 'application/json' }})
    response.end(JSON.stringify({{ ok: true, name: 'agent-halo', version: 2 }}))
    return
  }}
  response.writeHead(404)
  response.end()
}})
server.listen(port, '127.0.0.1')
process.stdin.resume()
process.stdin.on('end', () => server.close(() => process.exit(0)))
"#
            ),
        )
        .expect("takeover script");

        let state = StandaloneBridgeState::default();
        state
            .start_with(script, node, endpoint)
            .expect("start supervisor");
        thread::sleep(Duration::from_millis(1_250));
        assert!(
            !marker.exists(),
            "external owner was replaced while healthy"
        );

        let _ = server_stop.send(());
        let _ = server_join.join();
        assert!(wait_for_probe(endpoint, BridgeProbe::Healthy));
        assert!(marker.exists(), "standalone fallback never took ownership");
        state.stop();
        assert!(wait_for_probe(endpoint, BridgeProbe::Offline));
        let _ = fs::remove_dir_all(directory);
    }
}
