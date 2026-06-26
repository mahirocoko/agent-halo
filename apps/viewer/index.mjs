#!/usr/bin/env node
const DEFAULT_URL = "http://127.0.0.1:47621/events";
const DEFAULT_SNAPSHOT_URL = "http://127.0.0.1:47621/snapshot";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=", 2);
  const value = inlineValue ?? process.argv[index + 1];
  args.set(key, value);
  if (inlineValue === undefined && value && !value.startsWith("--")) index += 1;
}

const url = args.get("url") ?? DEFAULT_URL;
const snapshotUrl = args.get("snapshot-url") ?? DEFAULT_SNAPSHOT_URL;
const staleAfterMs = Number(args.get("stale-after-ms") ?? 30_000);
const jsonMode = args.get("json") === "true" || process.argv.includes("--json");

let presence = createInitialPresence();

function createInitialPresence() {
  return {
    status: "offline",
    agentId: null,
    agentName: null,
    conversationId: null,
    cwd: null,
    model: null,
    permissionMode: null,
    activeToolName: null,
    lastEventType: null,
    lastEventAt: null,
    messageCount: null,
    toolCallCount: null,
  };
}

function reducePresence(current, event) {
  const scoped = {
    agentId: event.agentId ?? current.agentId,
    agentName: event.agentName ?? current.agentName,
    conversationId: event.conversationId ?? current.conversationId,
    cwd: event.cwd ?? current.cwd,
    model: event.model ?? current.model,
    permissionMode: event.permissionMode ?? current.permissionMode,
    lastEventType: event.type,
    lastEventAt: event.timestamp,
  };

  switch (event.type) {
    case "bridge_ready":
      return { ...current, ...scoped, status: current.conversationId ? current.status : "idle" };
    case "conversation_open":
      return { ...current, ...scoped, status: "idle", activeToolName: null, messageCount: null, toolCallCount: null };
    case "conversation_close":
      return {
        ...current,
        ...scoped,
        status: "closed",
        activeToolName: null,
        messageCount: event.data?.messageCount ?? null,
        toolCallCount: event.data?.toolCallCount ?? null,
      };
    case "turn_start":
    case "llm_start":
      return { ...current, ...scoped, status: "thinking", activeToolName: null };
    case "compact_start":
      return { ...current, ...scoped, status: "tool-running", activeToolName: "compact" };
    case "compact_end":
      return { ...current, ...scoped, status: "thinking", activeToolName: null };
    case "turn_stop":
      return { ...current, ...scoped, status: "closed", activeToolName: null };
    case "tool_start":
      return { ...current, ...scoped, status: "tool-running", activeToolName: event.data?.toolName ?? null };
    case "tool_end":
      return { ...current, ...scoped, status: event.data?.status === "error" ? "error" : "thinking", activeToolName: null };
    case "llm_end": {
      const reason = event.data?.stopReason?.toLowerCase?.() ?? "";
      const isTerminal = reason.includes("end") || reason.includes("stop") || reason.includes("done") || reason.includes("complete");
      return { ...current, ...scoped, status: isTerminal ? "closed" : "thinking", activeToolName: null };
    }
    case "bridge_error":
      return { ...current, ...scoped, status: "error", activeToolName: null };
    default:
      return { ...current, ...scoped };
  }
}

function getPresenceView(current) {
  const lastEventMs = current.lastEventAt ? Date.parse(current.lastEventAt) : Number.NaN;
  const staleForMs = Number.isFinite(lastEventMs) ? Math.max(0, Date.now() - lastEventMs) : 0;
  const canBecomeStale = current.status === "thinking" || current.status === "tool-running";
  const isStale = canBecomeStale && staleForMs > staleAfterMs;
  if (isStale) return { status: "stale", label: "stale", isStale, staleForMs };
  if (current.status === "tool-running" && current.activeToolName) {
    return { status: current.status, label: `tool: ${current.activeToolName}`, isStale, staleForMs };
  }
  return { status: current.status, label: current.status, isStale, staleForMs };
}

function render(event) {
  const view = getPresenceView(presence);
  if (jsonMode) {
    console.log(JSON.stringify({ event, presence, view }));
    return;
  }

  const agent = presence.agentName ?? presence.agentId ?? "unknown-agent";
  const conversation = presence.conversationId ?? "unknown-conversation";
  const cwd = presence.cwd ? presence.cwd.replace(process.env.HOME ?? "", "~") : "unknown-cwd";
  const model = presence.model ?? "unknown-model";
  const eventLabel = event ? `${event.type} @ ${event.timestamp}` : "snapshot";

  console.clear();
  console.log("Agent Halo Viewer");
  console.log("─────────────────");
  console.log(`Status:       ${view.label}`);
  console.log(`Agent:        ${agent}`);
  console.log(`Conversation: ${conversation}`);
  console.log(`Model:        ${model}`);
  console.log(`CWD:          ${cwd}`);
  console.log(`Last event:   ${eventLabel}`);
  if (presence.messageCount !== null || presence.toolCallCount !== null) {
    console.log(`Closed stats: messages=${presence.messageCount ?? "?"} tools=${presence.toolCallCount ?? "?"}`);
  }
  console.log("");
  console.log(`SSE: ${url}`);
  console.log("Press Ctrl+C to quit.");
}

async function hydrateSnapshot() {
  try {
    const response = await fetch(snapshotUrl);
    if (!response.ok) return;
    const payload = await response.json();
    for (const event of payload.recent ?? []) {
      presence = reducePresence(presence, event);
    }
    render(null);
  } catch {
    // Snapshot is an optimization; live SSE can still work.
  }
}

async function connect() {
  await hydrateSnapshot();

  const response = await fetch(url, { headers: { accept: "text/event-stream" } });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to connect to ${url}: HTTP ${response.status}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;

      const event = JSON.parse(dataLines.join("\n"));
      presence = reducePresence(presence, event);
      render(event);
    }
  }
}

connect().catch((error) => {
  console.error(`Agent Halo Viewer failed: ${error.message}`);
  console.error("Is the Letta mod active? Try /reload, then check http://127.0.0.1:47621/health");
  process.exitCode = 1;
});
