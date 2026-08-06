# Agent Halo AGY (Antigravity) Adapter

Translates AGY lifecycle hook events into Agent Halo presence events. The hook script posts `AgentHaloEvent` payloads to the Agent Halo bridge so the desktop UI shows live AGY agent activity alongside Letta sessions.

## How it works

AGY hooks are shell commands invoked with JSON on stdin and JSON on stdout. This adapter is a single Node.js script called with `--event <type>` to identify the hook event. It reads the AGY payload, maps it to the Agent Halo protocol, posts to the local bridge, and outputs `{}` to avoid interfering with AGY.

## Event mapping

| AGY Hook | → Agent Halo Event | Bridge Endpoint |
|---|---|---|
| `PreToolUse` | `tool_start` | `POST /ingest` |
| `PostToolUse` | `tool_end` | `POST /ingest` |
| `PreInvocation` | `conversation_open` + `turn_start` | `POST /ingest` |
| `Stop` | `turn_complete` | `POST /hook/stop` |

`PostInvocation` is intentionally not hooked because there is no useful event to emit — AGY fires `Stop` when the agent finishes.

All events use `sourceKind: "agyHost"` in the runtime metadata so the desktop UI can distinguish AGY sessions from Letta sessions.

## Voice hooks

Two optional voice notification scripts are included, mirroring the existing Letta voice hooks:

| Script | AGY Hook | Notification |
|---|---|---|
| `say_finished.sh` | `stop` | "ทำงานเสร็จแล้วค่ะ" |
| `say_decision.sh` | `preToolUse` | "ต้องการการตัดสินใจค่ะ" |

These use macOS `say` + `afplay` to speak Thai notifications. They are independent from Agent Halo presence events.

## Installation

### Option A: Global hooks (all AGY sessions)

1. Copy scripts to a stable location:
   ```bash
   mkdir -p ~/.gemini/config/hooks
   cp adapters/agy/agent-halo-agy-hook.mjs ~/.gemini/config/hooks/
   cp adapters/agy/say_finished.sh ~/.gemini/config/hooks/
   cp adapters/agy/say_decision.sh ~/.gemini/config/hooks/
   chmod +x ~/.gemini/config/hooks/say_*.sh
   ```

2. Create `~/.gemini/config/hooks.json`, replacing placeholders:
   ```bash
   sed -e 's|__AGENT_HALO_HOOK_PATH__|~/.gemini/config/hooks/agent-halo-agy-hook.mjs|g' \
       -e 's|__HOOKS_DIR__|~/.gemini/config/hooks|g' \
       adapters/agy/hooks.json > ~/.gemini/config/hooks.json
   ```

### Option B: Per-workspace hooks

1. Create `.agents/hooks.json` in your project root with the same content, replacing placeholder paths.

## Prerequisites

- **Agent Halo bridge must be running** on `127.0.0.1:47621` (for presence events)
- **Node.js** must be available in `PATH`
- **macOS** with `say` and `afplay` (for voice hooks)
- No npm dependencies required — uses only Node.js built-ins
