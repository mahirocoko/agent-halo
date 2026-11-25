use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClosedLidTestPhase {
    Ready,
    Starting,
    Active,
    Restoring,
    Unavailable,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::ClosedLidTestPhase;
    use crate::battery_sleep::{MacPowerSourceProvider, PowerSourceProvider};
    use core_foundation::{
        base::{CFType, CFTypeRef, TCFType},
        boolean::CFBoolean,
        string::{CFString, CFStringRef},
    };
    use std::{
        ffi::{c_char, c_void},
        fs::{self, File, OpenOptions},
        io::{self, ErrorKind},
        os::{
            fd::AsRawFd,
            unix::{
                fs::{MetadataExt, OpenOptionsExt},
                process::CommandExt,
            },
        },
        path::Path,
        process::{Child, Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    const STATE: &str = "/private/var/db/com.mahirocoko.agent-halo.closed-lid-test";
    const DAEMON: &str = "/Library/LaunchDaemons/com.mahirocoko.agent-halo.closed-lid-test.plist";
    const WORKER: &str = include_str!("closed-lid-test.sh");
    const REQUEST: &str = r#"on run argv
        set body to item 1 of argv
        set cutoff to item 2 of argv
        set callerId to item 3 of argv
        set callerPid to item 4 of argv
        set callerIdentity to item 5 of argv
        set batteryFloor to item 6 of argv
        set answer to display dialog "Keep this Mac awake with the lid closed. Halo requests display sleep when you close the lid; macOS uses your Lock Screen settings. Keep the Mac on a hard surface, not in a bag." with title "Keep awake with lid closed" buttons {"Cancel", "Turn on"} default button "Cancel" cancel button "Cancel" giving up after 45
        if gave up of answer then return "canceled"
        set cmd to "/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash -c " & quoted form of body & " agent-halo-closed-lid-test install " & quoted form of body & " " & quoted form of cutoff & " " & quoted form of callerId & " " & quoted form of callerPid & " " & quoted form of callerIdentity & " " & quoted form of batteryFloor
        do shell script cmd with administrator privileges with prompt "Agent Halo needs administrator approval to temporarily change system sleep."
        return "started"
    end run"#;

    static REQUESTING: AtomicBool = AtomicBool::new(false);
    static CONTROL: Mutex<LeaseControl> = Mutex::new(LeaseControl {
        lease: None,
        stopping: false,
        preempted: false,
    });

    struct LeaseControl {
        lease: Option<Lease>,
        stopping: bool,
        preempted: bool,
    }

    // The child only waits for EOF. The write-end belongs to this Halo process;
    // Off closes it, and the OS closes it if Halo quits or crashes.
    struct Lease {
        process: Child,
        identity: Arc<()>,
        display_request: Option<(Child, Instant)>,
    }

    impl Lease {
        fn start() -> io::Result<Self> {
            let process = Command::new("/bin/cat")
                .env_clear()
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            Ok(Self {
                process,
                identity: Arc::new(()),
                display_request: None,
            })
        }

        fn reap_display_request(&mut self, allowed: bool) -> bool {
            let Some((child, started)) = &mut self.display_request else {
                return false;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.display_request = None;
                    if !status.success() {
                        eprintln!("Agent Halo could not put the display to sleep: {status}");
                    }
                    status.success()
                }
                Ok(None) if allowed && started.elapsed() < Duration::from_secs(4) => false,
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    self.display_request = None;
                    false
                }
            }
        }
    }

    impl Drop for Lease {
        fn drop(&mut self) {
            drop(self.process.stdin.take());
            let _ = self.process.kill();
            let _ = self.process.wait();
            self.reap_display_request(false);
        }
    }

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOServiceMatching(name: *const c_char) -> *mut c_void;
        fn IOServiceGetMatchingService(port: u32, matching: *mut c_void) -> u32;
        fn IORegistryEntryCreateCFProperty(
            entry: u32,
            key: CFStringRef,
            allocator: *const c_void,
            options: u32,
        ) -> CFTypeRef;
        fn IOObjectRelease(object: u32) -> i32;
    }

    fn lid_closed() -> Option<bool> {
        let key = CFString::from_static_string("AppleClamshellState");
        unsafe {
            let matching = IOServiceMatching(c"IOPMrootDomain".as_ptr());
            if matching.is_null() {
                return None;
            }
            let service = IOServiceGetMatchingService(0, matching);
            if service == 0 {
                return None;
            }
            let value = IORegistryEntryCreateCFProperty(
                service,
                key.as_concrete_TypeRef(),
                std::ptr::null(),
                0,
            );
            IOObjectRelease(service);
            if value.is_null() {
                return None;
            }
            CFType::wrap_under_create_rule(value)
                .downcast::<CFBoolean>()
                .map(bool::from)
        }
    }

    const DISPLAY_ATTEMPTS_PER_CLOSE: u8 = 3;

    struct LidDisplayCycle(u8);

    impl LidDisplayCycle {
        fn can_send(&mut self, closed: Option<bool>, completed: bool) -> bool {
            if closed == Some(false) {
                self.0 = DISPLAY_ATTEMPTS_PER_CLOSE;
            } else if completed {
                self.0 = 0;
            }
            closed == Some(true) && self.0 > 0
        }
    }

    // Runs in Halo's GUI session, not in the restore-only root watchdog.
    fn watch_lid(identity: Arc<()>) {
        // Activation was permitted only while the lid was open.
        let mut cycle = LidDisplayCycle(DISPLAY_ATTEMPTS_PER_CLOSE);
        loop {
            {
                let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
                let Some(lease) = control
                    .lease
                    .as_mut()
                    .filter(|lease| Arc::ptr_eq(&identity, &lease.identity))
                else {
                    return;
                };
                let phase = disk_phase();
                let active =
                    !REQUESTING.load(Ordering::Acquire) && phase == ClosedLidTestPhase::Active;
                let closed = lid_closed();
                let completed = lease.reap_display_request(active && closed == Some(true));
                if !REQUESTING.load(Ordering::Acquire) && phase == ClosedLidTestPhase::Ready {
                    return;
                }
                if cycle.can_send(closed, completed)
                    && active
                    && lease.display_request.is_none()
                    && matches!(lease.process.try_wait(), Ok(None))
                    && MacPowerSourceProvider
                        .query_power_status()
                        .is_ok_and(|power| power.is_some_and(|p| p.is_battery_powered))
                    && fs::metadata("/dev/console")
                        .is_ok_and(|meta| meta.uid() == unsafe { libc::geteuid() })
                    && disk_phase() == ClosedLidTestPhase::Active
                    && lid_closed() == Some(true)
                {
                    // Keep the process-local lease lock through dispatch. A root
                    // restoration or physical lid change can still race this
                    // best-effort request, which can only idle the display.
                    cycle.0 -= 1;
                    match Command::new("/usr/bin/pmset")
                        .arg("displaysleepnow")
                        .env_clear()
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                    {
                        Ok(child) => lease.display_request = Some((child, Instant::now())),
                        Err(error) => {
                            eprintln!("Agent Halo could not request display sleep: {error}")
                        }
                    }
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    }

    pub struct StartRequest {
        committed: bool,
    }

    pub fn acquire_battery_owner(config_dir: &Path) -> io::Result<File> {
        fs::create_dir_all(config_dir)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(config_dir.join("battery-power-owner.lock"))?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
        {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "Unexpected battery owner lock",
            ));
        }
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(file)
    }

    impl Drop for StartRequest {
        fn drop(&mut self) {
            let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
            if !self.committed {
                control.lease.take();
            }
            REQUESTING.store(false, Ordering::Release);
        }
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs())
    }

    pub fn begin() -> Result<StartRequest, String> {
        let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
        if REQUESTING.load(Ordering::Acquire) {
            return Err("A lid-closed keep-awake request is already in progress".to_string());
        }
        if disk_phase() != ClosedLidTestPhase::Ready {
            return Err("Wait for normal sleep to be restored before turning on again".to_string());
        }
        control.lease.take();
        control.stopping = false;
        control.preempted = false;
        REQUESTING.store(true, Ordering::Release);
        Ok(StartRequest { committed: false })
    }

    pub fn phase() -> ClosedLidTestPhase {
        use ClosedLidTestPhase::*;
        let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
        match disk_phase() {
            Ready | Active if REQUESTING.load(Ordering::Acquire) => Starting,
            Ready => {
                control.lease.take();
                control.stopping = false;
                Ready
            }
            Active if control.stopping => Restoring,
            phase => phase,
        }
    }

    fn exists_or_unknown(path: impl AsRef<Path>) -> bool {
        !matches!(fs::symlink_metadata(path), Err(error) if error.kind() == ErrorKind::NotFound)
    }

    pub fn yield_to_battery_sleep() -> bool {
        let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
        control.preempted = true;
        if control.lease.take().is_some() {
            control.stopping = true;
        }
        // The root process records its claim before its final lease check. Once
        // the lease is dead, no late authorization can create a new override.
        !exists_or_unknown(format!("{STATE}/restore-needed"))
    }

    pub fn stop() -> Result<ClosedLidTestPhase, String> {
        use ClosedLidTestPhase::*;
        let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
        if REQUESTING.load(Ordering::Acquire) {
            return Ok(Starting);
        }
        let current = disk_phase();
        if current == Active || current == Restoring {
            if let Some(lease) = control.lease.take() {
                drop(lease);
                control.stopping = true;
                return Ok(Restoring);
            }
            if control.stopping || current == Restoring {
                return Ok(Restoring);
            }
            return Err(
                "Close the Halo instance that turned this on, or plug in power".to_string(),
            );
        }
        Ok(current)
    }

    fn disk_phase() -> ClosedLidTestPhase {
        use ClosedLidTestPhase::*;
        match fs::symlink_metadata(STATE) {
            Ok(meta) if meta.is_dir() && meta.uid() == 0 && meta.mode() & 0o022 == 0 => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return if exists_or_unknown(DAEMON) {
                    Unavailable
                } else {
                    Ready
                };
            }
            _ => return Unavailable,
        }
        let recovery_claim = exists_or_unknown(format!("{STATE}/restore-needed"));
        let daemon_exists = exists_or_unknown(DAEMON);
        let fallback = if recovery_claim { Restoring } else { Ready };
        if !daemon_exists {
            return fallback;
        }
        let path = format!("{STATE}/phase");
        // The parent directory is root-owned and not writable by renderer users.
        match fs::symlink_metadata(&path) {
            Ok(meta)
                if meta.is_file()
                    && meta.uid() == 0
                    && meta.mode() & 0o022 == 0
                    && meta.len() <= 96 => {}
            Err(error) if error.kind() == ErrorKind::NotFound => return fallback,
            _ => return Unavailable,
        }
        match fs::read_to_string(path) {
            Ok(record) => parse_phase(&record, now(), recovery_claim),
            Err(error) if error.kind() == ErrorKind::NotFound => fallback,
            Err(_) => Unavailable,
        }
    }

    fn parse_phase(record: &str, now: u64, claim: bool) -> ClosedLidTestPhase {
        use ClosedLidTestPhase::*;
        let parts: Vec<_> = record.split_whitespace().collect();
        match parts.as_slice() {
            ["starting", cutoff]
                if cutoff
                    .parse::<u64>()
                    .is_ok_and(|cutoff| cutoff >= now && cutoff - now <= 120) =>
            {
                Starting
            }
            ["active", seen, _boot] if claim => match seen.parse::<u64>() {
                Ok(seen) if seen <= now && now - seen <= 12 => Active,
                _ => Restoring,
            },
            _ if claim => Restoring,
            // An abandoned restore-only job with no claim has not changed sleep.
            _ => Ready,
        }
    }

    impl StartRequest {
        pub fn run(
            mut self,
            owner: Arc<File>,
            battery_floor: u8,
        ) -> Result<ClosedLidTestPhase, String> {
            let lease =
                Lease::start().map_err(|_| "Could not start the sleep guard".to_string())?;
            let pid = lease.process.id().to_string();
            let identity = Arc::clone(&lease.identity);
            let uid = unsafe { libc::geteuid() }.to_string();
            let process = Command::new("/bin/ps")
                .env_clear()
                .env("LC_ALL", "C")
                .env("TZ", "UTC")
                .args(["-p", &pid, "-o", "uid=", "-o", "lstart="])
                .output()
                .map_err(|_| "Could not verify the running Agent Halo process".to_string())?;
            let fingerprint = String::from_utf8_lossy(&process.stdout)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if !process.status.success() || !fingerprint.starts_with(&format!("{uid} ")) {
                return Err("Could not verify the running Agent Halo process".to_string());
            }
            {
                let mut control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
                if control.preempted {
                    return Err("Low-battery sleep took priority".to_string());
                }
                // Publish before macOS authorization so it can be revoked while
                // the dialog is open, never just after activation has returned.
                control.lease = Some(lease);
            }
            let mut command = Command::new("/usr/bin/osascript");
            command.args([
                "-e",
                REQUEST,
                "--",
                WORKER,
                &now().saturating_add(120).to_string(),
                &uid,
                &pid,
                &fingerprint,
                &battery_floor.to_string(),
            ]);
            // Hold the same open-file-description lock in osascript until the
            // native dialog and root install return, even if Halo exits early.
            let fd = owner.as_raw_fd();
            unsafe {
                command.pre_exec(move || {
                    let flags = libc::fcntl(fd, libc::F_GETFD);
                    if flags < 0 || libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            let result = command.output();
            let output = result.map_err(|_| "Could not open macOS confirmation".to_string())?;
            let phase = disk_phase();
            if output.status.success()
                && String::from_utf8_lossy(&output.stdout).trim() == "started"
            {
                return match phase {
                    ClosedLidTestPhase::Active => {
                        let control = CONTROL.lock().unwrap_or_else(|e| e.into_inner());
                        if control.preempted || control.lease.is_none() {
                            return Ok(ClosedLidTestPhase::Restoring);
                        }
                        thread::Builder::new()
                            .name("agent-halo-lid-display".into())
                            .spawn(move || watch_lid(identity))
                            .map_err(|_| "Could not start the lid display monitor".to_string())?;
                        self.committed = true;
                        Ok(phase)
                    }
                    ClosedLidTestPhase::Ready => Err("Could not turn on. Unplug your MacBook and leave the lid open until the switch shows On.".to_string()),
                    phase => Ok(phase),
                };
            }
            if CONTROL.lock().unwrap_or_else(|e| e.into_inner()).preempted {
                return Err("Low-battery sleep took priority".to_string());
            }
            if phase == ClosedLidTestPhase::Active {
                // The activation reply was not confirmed. Dropping the lease
                // makes the restore-only worker turn the override off.
                return Ok(ClosedLidTestPhase::Restoring);
            }
            if phase != ClosedLidTestPhase::Ready
                || (output.status.success()
                    && String::from_utf8_lossy(&output.stdout).trim() == "canceled")
                || String::from_utf8_lossy(&output.stderr)
                    .trim_end()
                    .ends_with("(-128)")
            {
                return Ok(phase);
            }
            Err("Could not turn on. Keep the lid open, unplug power, and check the battery threshold or other sleep overrides.".to_string())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{
            acquire_battery_owner, parse_phase, ClosedLidTestPhase::*, Lease, LidDisplayCycle,
            DISPLAY_ATTEMPTS_PER_CLOSE,
        };

        #[test]
        fn display_request_retries_are_bounded_and_reset_only_on_open() {
            let mut cycle = LidDisplayCycle(DISPLAY_ATTEMPTS_PER_CLOSE);
            assert!(!cycle.can_send(None, false));
            for _ in 0..DISPLAY_ATTEMPTS_PER_CLOSE {
                assert!(cycle.can_send(Some(true), false));
                cycle.0 -= 1;
            }
            assert!(!cycle.can_send(Some(true), false));
            assert!(!cycle.can_send(None, false));
            assert!(!cycle.can_send(Some(true), false));
            assert!(!cycle.can_send(Some(false), false));
            assert!(cycle.can_send(Some(true), false));
            cycle.0 -= 1;
            assert!(!cycle.can_send(Some(true), true));
            assert!(!cycle.can_send(Some(true), false));
        }

        #[test]
        fn only_a_recent_owned_observation_looks_active() {
            assert_eq!(parse_phase("starting 200\n", 100, false), Starting);
            assert_eq!(parse_phase("starting 99\n", 100, false), Ready);
            assert_eq!(parse_phase("restoring\n", 100, true), Restoring);
            assert_eq!(parse_phase("active 99 boot\n", 100, true), Active);
            assert_eq!(parse_phase("active 99 boot\n", 100, false), Ready);
            assert_eq!(parse_phase("active 80 boot\n", 100, true), Restoring);
            assert_eq!(parse_phase("active 101 boot\n", 100, true), Restoring);
            assert_eq!(parse_phase("active 280 99 boot\n", 100, true), Restoring);
            assert_eq!(parse_phase("active invalid boot\n", 100, true), Restoring);
        }

        #[test]
        fn lease_exits_when_the_parent_pipe_closes() {
            let mut lease = Lease::start().unwrap();
            assert!(lease.process.try_wait().unwrap().is_none());
            drop(lease.process.stdin.take());
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
            loop {
                if let Some(status) = lease.process.try_wait().unwrap() {
                    assert!(status.success());
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "lease retained after pipe closure"
                );
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }

        #[test]
        fn battery_power_owner_is_exclusive_until_the_last_holder_drops() {
            let root =
                std::env::temp_dir().join(format!("agent-halo-power-owner-{}", std::process::id()));
            let owner = acquire_battery_owner(&root).unwrap();
            let held_by_prompt = owner.try_clone().unwrap();
            assert!(acquire_battery_owner(&root).is_err());
            drop(owner);
            assert!(acquire_battery_owner(&root).is_err());
            drop(held_by_prompt);
            // Parallel tests can briefly inherit CLOEXEC descriptors between fork and exec.
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
            loop {
                match acquire_battery_owner(&root) {
                    Ok(_) => break,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && std::time::Instant::now() < deadline =>
                    {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(error) => panic!("battery owner lock was not released: {error}"),
                }
            }
            std::fs::remove_file(root.join("battery-power-owner.lock")).unwrap();
            std::fs::remove_dir(root).unwrap();
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::{acquire_battery_owner, begin, phase, stop, yield_to_battery_sleep};

#[cfg(not(target_os = "macos"))]
pub fn phase() -> ClosedLidTestPhase {
    ClosedLidTestPhase::Unavailable
}
