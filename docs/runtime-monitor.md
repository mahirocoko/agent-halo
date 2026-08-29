# Runtime Monitor

Runtime Monitor is a read-only local view of CPU and memory pressure for open Letta Code processes and all bounded descendant child processes. Local listener discovery and guarded current-user listener control live beside it as the separate top-level Services tab.

## Contract

```text
Letta mod event runtime.sourcePid
  -> desktop session registry
  -> native macOS libproc sampler
  -> Letta + Subprocesses rows in the Runtime tab
```

The Runtime monitor never kills, suspends, renices, or ends a process. It does not enable `sessionActions.endSession` and does not use Letta's internal app-server process-control protocol. Services control is a narrower desktop-native capability for an exact local listener process, not a Letta session action.

The top-level **Services** tab is a separate native desktop observation lane, not a bridge event or Letta session field:

```text
macOS TCP LISTEN sockets
  -> bounded process/port records
  -> short local HTTP/browser-app title/anatomy probes
  -> listener cwd + bounded parent ancestry
  -> exact trusted Letta PID/start match + session-carried Herdr pane
  -> expandable process detail + Services classification groups
  -> optional exact-identity Stop / Force kill command for eligible current-user listeners
```

- Full Runtime resource/pressure sampling runs only while the Runtime tab is visible. A narrower exact-identity liveness sample remains active for up to 64 current `working`/`attention` rows even while that tab is closed, and stops when no eligible row remains. Listener discovery runs only while Services is visible. Each lane refreshes independently every 5 seconds and owns its own status, error, refresh action, footnote, and existing outer sheet scrollbar; neither creates a nested scroller. Services uses a dedicated host-identity builder that does not require Runtime cwd eligibility, receives at most 512 strongly keyed owner targets from the bounded trusted renderer session registry, validates live native start identities, and retains still-live protected host identities across later samples. Native code does not independently discover Letta hosts outside that trusted registry boundary.
- macOS reads structured `lsof` listener output and bounded `libproc` detail: process name, PID/start identity, parent, executable path, numeric user ID, physical/resident memory, bind address, port, current cwd, whether a bounded root `GET` received an HTTP response, a safe document title, and whether strong web-frontend evidence was confirmed. Each discovery pass has a 1.5-second total budget, an 8 KiB per-response cap, and a 256 KiB listener-output cap.
- Web-frontend classification is fail-closed and does not guess from ports or process names. The same probes apply to every listener, including Node, Bun, Python, and unknown runtimes. Automatic evidence is either a framework-specific Vite/Next development response or a successful root HTML document with browser-app anatomy such as a module script plus stylesheet, a known Next/Nuxt marker, a root mount plus external script, or a bundled `/assets/` stylesheet plus JavaScript `modulepreload` visible before late streamed hydration. This catches large SSR documents whose scripts arrive after the bounded prefix without promoting a generic styled HTML page or downloading the whole document. A Python directory listing, generic HTML/error page, arbitrary JavaScript endpoint, API, or AirTunes response remains an ordinary HTTP service.
- Strongly evidenced web frontends appear first in **Detected web frontends** with the green dot. A non-web listener with exact trusted Letta ancestry appears next in **Letta services** with a neutral dot. Remaining HTTP/TCP listeners appear under **Other listeners**. A listener that is both a web frontend and Letta-started stays in the first group and retains its `Started by Letta` detail, so rows are never duplicated and green never means merely “Letta opened it” or “a TCP port answered.” Group labels and `HTTP`/`TCP` text keep color from being the only signal.
- Successful HTML roots may expose a whitespace-normalized, control-free title capped at 120 characters. Services uses that title as the primary label unless it is a generic `Directory listing`/`Index of` title; the process name stays visible beside the endpoint.
- Expanding one listener row shows its full bounded process detail in normal document flow without a nested scroller. `Started by Letta · <project> · <pane>` appears only when the listener's bounded live parent ancestry contains a trusted Letta PID whose native process start matches within two seconds. The optional Herdr pane comes from that same matched session event. PID reuse, stale/missing ancestry, a process re-parented to `launchd`, or malformed labels produces no owner claim rather than a guess.
- Every HTTP listener still exposes an independent inset 24px `Open in browser` action through the existing safe `http(s)` URL command, whether or not it is recognized as a web frontend.
- **Stop process** is available only when the listener has a nonzero process-start identity, all real/effective/saved UIDs match the current non-root user, and the process is not PID 1, Agent Halo or its ancestors, the protected Agent Halo bridge on port 47621, or an exact Letta host identity. Confirmation states explicitly that stopping one process ends every listener it owns.
- Stop sends `SIGTERM` to the positive PID only after a recent native capability snapshot and a fresh exact PID/start/address/port/UID revalidation. If the process remains and the same listener is still open after the bounded grace period, native state records a short-lived one-shot Force eligibility; only then may the UI offer a second confirmed **Force kill**, which consumes that proof and repeats full revalidation before `SIGKILL`. A process that remains after closing only the selected endpoint returns the distinct `listenerStopped` outcome, removes only that listener row, and never unlocks Force kill. Missing capability/progression state, stale PID, changed identity, endpoint disappearance before signaling, `lsof` failure/timeout, UID mismatch, or protected identity fails closed. macOS exposes no atomic PID handle, so a narrow check-to-signal race remains; the implementation minimizes it with an immediate second `libproc` identity read and never signals process groups.
- The inventory is capped at 64 listeners, is held in renderer/native memory only, and is never written to the bridge snapshot, NDJSON log, or persistent storage.
- Other platforms report an explicit unsupported state. The list may include ordinary local TCP services as well as browser apps; command arguments, terminal output, environment variables, and response bodies are never exposed or accepted by the control command.

### Explicit web frontend registry

Projects that Agent Halo does not recognize automatically may authoritatively register a current local listener through `~/.config/agent-halo/local-web-frontends.v1.json`:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "processId": 87203,
      "processStartedAtMs": 1785475200000,
      "bindAddress": "127.0.0.1",
      "port": 4173,
      "expiresAtMs": 1785475800000
    }
  ]
}
```

The registry is positive-only and never downgrades strong automatic evidence. An entry matches only the exact live PID, process-start time within 2 seconds, normalized bind address, and port. Expiry must be in the future but no more than 15 minutes ahead, so a producer refreshes the file while its service is alive. Agent Halo never creates, rewrites, or deletes this file.

The reader fails closed: the file must be a current-user regular file opened without following symlinks, use private permissions (`0600` recommended), stay under 32 KiB, declare schema version 1, and contain at most 32 validated non-duplicate entries. Missing or stale entries are ignored. An unsafe/malformed registry is ignored as classification evidence and surfaced as a Services diagnostic while normal listener discovery continues. Producers must write a same-directory temporary file with mode `0600` and atomically rename it into place.

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

This exact identity also closes missing-terminal presence gaps. While a native session row is `working` or `attention`, the desktop samples up to the 64 most recent live-status targets on the existing five-second runtime cadence even when the Runtime tab is closed; those targets take priority over Runtime history when both jobs are active. `missing` and `pidReused` become durable exact-identity tombstones and downgrade the affected row to `inactive`; they do not create synthetic `conversation_close`, `turn_complete`, or success claims. Once no eligible live-status target remains, background liveness sampling stops.

### Missing-terminal native verification (2026-08-29)

The installed macOS candidate was restarted and exercised against a controlled
background Letta subagent. Mahiro observed session `1e0bdfd1` as `Working` while
its process was live. The parent then interrupted it through `TaskStop`; the
child process disappeared without a normal completion event, matching the
original stale-row defect. Mahiro subsequently confirmed that the same row
became `Inactive`. The probe did not fabricate `Done` or success, and its
orphaned sleep process was removed after interruption. This is native/human
evidence for abrupt-process disappearance; PID-reuse behavior remains covered
by exact-identity source logic rather than a live PID-reuse experiment.

### v0.1.8 release evidence

Release-preparation evidence captured on 2026-08-29:

- root, desktop, Cargo, lockfile, and Tauri bundle versions align at `0.1.8`
- `pnpm install --frozen-lockfile`, `pnpm check`, and `git diff --check` pass
- focused liveness browser coverage passes 6/6 with one worker
- the first full browser run passed 143/144 and exposed one Runtime-tab timing
  assertion that selected the transient pre-sample state; the exact test passed
  after waiting for the canonical pressure distribution, and the fresh full
  serialized suite then passed 144/144
- hook/mod/AGY/standalone integration coverage passes 7/7
- performance gates pass with JavaScript gzip at 105,685 bytes under the
  evidence-backed 105,800-byte liveness ceiling; session and bridge benchmarks
  remain within their existing limits
- serialized native tests pass 89 with 1 ignored, and locked Cargo check passes
- the v0.1.8 macOS bundle builds, installs, and restarts successfully;
  `Info.plist` reports `0.1.8` for both short and bundle versions
- built and installed native binaries match byte-for-byte at SHA-256
  `981d786315803fb32605ab8be90b370e845a1fb5bbbc70eaa52bd79579d94f3a`
- the restarted standalone bridge reports protocol version 2 with one desktop
  client connected

Final commit, origin, annotated tag, and GitHub Release alignment are verified
only after publication. Agent Halo remains a local personal macOS app and this
release publishes source archives rather than signed/notarized binaries.

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

Full resource/pressure sampling starts after the user opens Runtime and refreshes every 5 seconds while that tab remains visible. Closing or leaving Runtime stops those history/resource samples; only the bounded live-status identity reconciliation described above may continue. The first resource sample has no CPU percentage because no prior delta exists.

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
- Letta runtime metrics expose process names for at most five largest descendants, never full command-line arguments; Services exposes the capped listener/process detail and exact matched session ancestry described above, and reads only the bounded explicit registry identity fields. Service-control results contain only status, signal name, process ID, endpoint, and whether the listener remains.
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
