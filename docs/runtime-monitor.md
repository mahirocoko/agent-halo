# Runtime Monitor

Runtime Monitor is a read-only local view of CPU and memory pressure for open Letta Code processes and all bounded descendant child processes, plus locally listening TCP/web services.

## Contract

```text
Letta mod event runtime.sourcePid
  -> desktop session registry
  -> native macOS libproc sampler
  -> Letta + Subprocesses rows in the Runtime tab
```

The monitor never kills, suspends, renices, or ends a process. It does not enable `sessionActions.endSession` and does not use Letta's internal app-server process-control protocol.

The Runtime tab also includes a separate **Local services** inventory. It is a native desktop observation lane, not a bridge event or Letta session field:

```text
macOS TCP LISTEN sockets
  -> bounded process/port records
  -> short local HTTP probe
  -> Runtime tab service rows
```

- Sampling runs only while the Runtime tab is visible, on the same 5-second refresh cadence as process pressure.
- macOS reads structured `lsof` listener output and keeps only process name, PID, bind address, port, and whether a bounded `HEAD` probe received an HTTP response. Each discovery pass has a 1.5-second total budget and a 256 KiB listener-output cap.
- HTTP listeners expose an `Open in browser` action through the existing safe `http(s)` URL command. The action opens the URL; it never starts, stops, or controls the service.
- The inventory is capped at 64 listeners, is held in renderer/native memory only, and is never written to the bridge snapshot, NDJSON log, or persistent storage.
- Other platforms report an explicit unsupported state. The list may include ordinary local TCP services as well as dev servers; command arguments and request contents are never collected.

## Process identity

Protocol-v2 events may include additive runtime metadata:

```ts
runtime?: {
  sourcePid: number
  sourcePpid: number | null
  sourceStartedAtMs: number
  sourceKind: "lettaHost" | "hookRelay" | "unknown" | string
} | null
```

The mod records PID identity before multi-instance forwarding, so a secondary Letta CLI process keeps its own PID when `/ingest` forwards the event to the primary bridge. Trusted runtime forwarding uses the shared 0600 ingest token generated under `~/.letta/mods/`; older or untrusted senders keep event compatibility but have runtime identity stripped. Hook events inherit a recently correlated Letta runtime only when the scope is unambiguous and inside the bounded active-scope window.

The desktop validates PID continuity against both `sourceStartedAtMs` and the expected cwd. A reused PID is reported as `pidReused`; a mismatched cwd is `identityMismatch`. A target without both trusted fields remains unavailable rather than sampling an arbitrary process. If one process has several recent live conversations, the UI labels it as a shared process because OS metrics cannot be divided truthfully between those conversations.

## Native sampling

On macOS, the Tauri command uses `libproc` through Rust's pinned `libc` bindings:

- `proc_listallpids` and `PROC_PIDTBSDINFO` for PID, PPID, start time, and a privacy-safe process name;
- `PROC_PIDVNODEPATHINFO` for root cwd validation;
- `proc_pid_rusage(RUSAGE_INFO_V4)` for physical footprint, resident size, and cumulative user/system CPU time.

CPU percentage is calculated from cumulative CPU-time deltas:

```text
delta(user + system) / delta(wall time) × 100
```

`100%` means one fully used logical core, matching Activity Monitor semantics. `Letta` is the originating host process. `Subprocesses` sums all bounded recursive descendants without claiming every helper/server/watcher is a Letta tool. Traversal is limited to 32 levels and 512 descendants per Letta host.

Confirmed terminal identities (`missing` because the host PID is absent from the native process list, or `pidReused`) are removed automatically from future Runtime sampling and recorded in a bounded local tombstone set keyed by conversation, PID, and process-start time. A PID that still exists but whose resource usage cannot be read remains `unavailable` and is never tombstoned. This prevents ended hosts from returning after Refresh/reopen and ensures a newly started process for the same conversation appears as a fresh identity. The tombstone never deletes session history or touches a process.

Other unavailable diagnostics such as cwd identity mismatch or incomplete runtime metadata remain visible because they may describe a live configuration problem. Their `×` control is still a temporary view hide; manual Runtime refresh restores those diagnostic rows. Runtime considers the 512 most recently active distinct host identities and samples at most the newest 64 non-ended targets per refresh, preserving native CPU/PID continuity without letting a large historical registry invalidate the current sample. The toolbar reports any older eligible identities that were not sampled.

Sampling starts only after the user opens Runtime and refreshes every 5 seconds while that tab remains visible. Closing or leaving Runtime stops native polling. The first sample has no CPU percentage because no prior delta exists.

## Current pressure labels

Current-sample labels are intentionally separate from future notification/alert policy:

| Level | Current sample evidence |
| --- | --- |
| Critical | Host physical footprint ≥ 3 GiB, child footprint ≥ 3 GiB, or child CPU ≥ 250% |
| High | Host ≥ 1.5 GiB, children ≥ 1.5 GiB, child CPU ≥ 150%, or at least 20 descendants |
| Elevated | Host ≥ 1.2 GiB, children ≥ 768 MiB, child CPU ≥ 80%, or at least 10 descendants |
| Normal | Below those observed local thresholds |

A future notification lane should require a sustained window and remain opt-in. Runtime Monitor currently presents samples only and never auto-opens the notch.

## Privacy and retention

- Sampling stays inside the local Tauri app.
- Runtime samples are held in renderer/native memory only and are not appended to Agent Halo NDJSON.
- Ended-identity tombstones contain only the strong local runtime identity and timestamp, are bounded to 512 entries in localStorage, and carry no CPU/memory samples.
- Letta runtime metrics expose process names for at most five largest descendants, never full command-line arguments; Local services exposes only the capped listener process names described above.
- No remote telemetry or hosted service is involved.

## Verification

```bash
pnpm check
pnpm test:hooks
pnpm test:demo
pnpm test:performance
(cd apps/desktop/src-tauri && cargo test && cargo check)
```

After installing a mod build with runtime identity, reload active Letta Code sessions before expecting PID-aware rows.
