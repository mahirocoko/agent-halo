# Runtime Monitor

Runtime Monitor is a read-only local view of CPU and memory pressure for open Letta Code processes and all bounded descendant child processes. Local listener discovery lives beside it as the separate top-level Services tab.

## Contract

```text
Letta mod event runtime.sourcePid
  -> desktop session registry
  -> native macOS libproc sampler
  -> Letta + Subprocesses rows in the Runtime tab
```

The monitor never kills, suspends, renices, or ends a process. It does not enable `sessionActions.endSession` and does not use Letta's internal app-server process-control protocol.

The top-level **Services** tab is a separate native desktop observation lane, not a bridge event or Letta session field:

```text
macOS TCP LISTEN sockets
  -> bounded process/port records
  -> short local HTTP/browser-app title/anatomy probes
  -> listener cwd + bounded parent ancestry
  -> exact trusted Letta PID/start match + session-carried Herdr pane
  -> Services tab Detected web frontends / Letta services / Other listeners groups
```

- Runtime process sampling runs only while the Runtime tab is visible. Listener discovery runs only while Services is visible. Each lane refreshes independently every 5 seconds and owns its own status, error, refresh action, footnote, and existing outer sheet scrollbar; neither creates a nested scroller. Services receives at most 64 trusted owner targets from the current session registry.
- macOS reads structured `lsof` listener output and keeps only process name, PID, bind address, port, current cwd, whether a bounded root `GET` received an HTTP response, a safe document title, and whether strong web-frontend evidence was confirmed. Each discovery pass has a 1.5-second total budget, an 8 KiB per-response cap, and a 256 KiB listener-output cap.
- Web-frontend classification is fail-closed and does not guess from ports or process names. The same probes apply to every listener, including Node, Bun, Python, and unknown runtimes. Automatic evidence is either a framework-specific Vite/Next development response or a successful root HTML document with browser-app anatomy such as a module script plus stylesheet, a known Next/Nuxt marker, a root mount plus external script, or a bundled `/assets/` stylesheet plus JavaScript `modulepreload` visible before late streamed hydration. This catches large SSR documents whose scripts arrive after the bounded prefix without promoting a generic styled HTML page or downloading the whole document. A Python directory listing, generic HTML/error page, arbitrary JavaScript endpoint, API, or AirTunes response remains an ordinary HTTP service.
- Strongly evidenced web frontends appear first in **Detected web frontends** with the green dot. A non-web listener with exact trusted Letta ancestry appears next in **Letta services** with a neutral dot. Remaining HTTP/TCP listeners appear under **Other listeners**. A listener that is both a web frontend and Letta-started stays in the first group and retains its `Started by Letta` detail, so rows are never duplicated and green never means merely “Letta opened it” or “a TCP port answered.” Group labels and `HTTP`/`TCP` text keep color from being the only signal.
- Successful HTML roots may expose a whitespace-normalized, control-free title capped at 120 characters. Services uses that title as the primary label unless it is a generic `Directory listing`/`Index of` title; the process name stays visible beside the endpoint.
- Each listener may expose its current cwd basename. The full local cwd is hover context. `Started by Letta · <project> · <pane>` appears only when the listener's bounded live parent ancestry contains a trusted Letta PID whose native process start matches within two seconds. The optional Herdr pane comes from that same matched session event. PID reuse, stale/missing ancestry, a process re-parented to `launchd`, or malformed labels produces no owner claim rather than a guess.
- Every HTTP listener still exposes an inset 24px `Open in browser` action through the existing safe `http(s)` URL command, whether or not it is recognized as a web frontend. The action opens the URL; it never starts, stops, or controls the service.
- The inventory is capped at 64 listeners, is held in renderer/native memory only, and is never written to the bridge snapshot, NDJSON log, or persistent storage.
- Other platforms report an explicit unsupported state. The list may include ordinary local TCP services as well as browser apps; command arguments, terminal output, environment variables, and response bodies are never exposed.

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
- Letta runtime metrics expose process names for at most five largest descendants, never full command-line arguments; Services exposes the capped listener identity, safe title/cwd context, and exact matched session ancestry described above, and reads only the bounded explicit registry identity fields.
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
