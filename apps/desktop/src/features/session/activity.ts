import type { AgentHaloEvent } from "@agent-halo/protocol";
import {
  COMPACT_STALE_AFTER_MS,
  LLM_STALE_AFTER_MS,
  STALE_AFTER_MS,
  TOOL_STALE_AFTER_MS,
  TRANSITION_STALE_AFTER_MS,
} from "./constants";
import type { ActivityKind, IActivityDescriptor, ISessionSummary } from "./types";

export const shortenPath = (path: string | null | undefined): string => {
  if (!path) return "No workspace";
  const home = window.__AGENT_HALO_HOME__ ?? "";
  const normalized = home ? path.replace(home, "~") : path;
  const segments = normalized.split("/").filter(Boolean);
  return segments.length <= 3 ? normalized : `…/${segments.slice(-3).join("/")}`;
};

export const projectName = (path: string | null | undefined): string =>
  path?.split("/").filter(Boolean).at(-1) ?? "Agent Halo";

export const formatTime = (timestamp: string | null): string =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(timestamp))
    : "—";

export const formatRelativeAge = (timestamp: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1_000));
  if (seconds < 60) return "<1m";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
};

export const shortModelName = (model: string): string =>
  (model.split("/").filter(Boolean).at(-1) ?? model).replace(/^chatgpt-plus-pro\//, "") ||
  "Letta";

const toolKind = (name: string): ActivityKind => {
  if (name === "UpdatePlan") return "planning";
  if (["exec_command", "write_stdin", "TaskOutput", "TaskStop"].includes(name)) {
    return "shell";
  }
  if (name === "ApplyPatch") return "editing";
  if (["Agent", "Task"].includes(name)) return "delegating";
  if (name === "ViewImage") return "visual";
  if (name === "memory_apply_patch") return "memory";
  if (name === "AskUserQuestion") return "asking";
  if (name === "Skill") return "skill";
  if (["CreateGoal", "UpdateGoal", "GetGoal"].includes(name)) return "goal";
  return "tool";
};

const TOOL_LABELS: Partial<Record<ActivityKind, string>> = {
  planning: "plan",
  shell: "shell",
  editing: "edit",
  delegating: "agent",
  visual: "visual",
  memory: "memory",
  asking: "ask",
  skill: "skill",
  goal: "goal",
  compact: "compact",
  model: "model",
};

const TOOL_DETAILS: Record<string, string> = {
  UpdatePlan: "update plan",
  UpdateGoal: "update goal",
  GetGoal: "read goal",
  CreateGoal: "create goal",
  exec_command: "command",
  write_stdin: "terminal input",
  TaskOutput: "task output",
  TaskStop: "stop task",
  ApplyPatch: "patch files",
  Agent: "subagent task",
  Task: "subagent task",
  ViewImage: "inspect image",
  memory_apply_patch: "write memory",
  AskUserQuestion: "ask user",
  Skill: "run skill",
};

const toolLabel = (kind: ActivityKind) => TOOL_LABELS[kind] ?? "tool";
const toolDetail = (name: string) => TOOL_DETAILS[name] ?? name;

const compactNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value)
    : null;

const usageTokens = (
  usage:
    | { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null }
    | null
    | undefined,
) =>
  usage
    ? typeof usage.promptTokens === "number" && typeof usage.completionTokens === "number"
      ? usage.promptTokens + usage.completionTokens
      : usage.totalTokens
    : null;

export const getEventActivity = (event: AgentHaloEvent): IActivityDescriptor => {
  switch (event.type) {
    case "bridge_ready":
      return { kind: "bridge", label: "bridge", detail: `:${event.data.port}` };
    case "conversation_open":
      return { kind: "session", label: "open", detail: event.data.reason };
    case "conversation_close":
      return { kind: "done", label: "closed", detail: event.data.reason };
    case "turn_start":
      return { kind: "thinking", label: "thinking", detail: `${event.data.inputCount} input` };
    case "turn_stop":
    case "turn_complete":
      return { kind: "done", label: "done", detail: event.data.message ?? "turn complete" };
    case "attention_requested":
      return {
        kind: "attention",
        label: event.data.kind === "question" ? "question" : "approval",
        detail: event.data.kind === "question" ? "Question" : "Approval needed",
      };
    case "tool_start": {
      const kind = toolKind(event.data.toolName);
      return { kind, label: toolLabel(kind), detail: toolDetail(event.data.toolName) };
    }
    case "tool_end": {
      if (event.data.status === "error") {
        return {
          kind: "error",
          label: "error",
          detail: `${toolDetail(event.data.toolName)} failed`,
        };
      }
      const kind = toolKind(event.data.toolName);
      return { kind, label: "done", detail: `${toolDetail(event.data.toolName)} complete` };
    }
    case "compact_start":
      return { kind: "compact", label: "compact", detail: event.data.trigger };
    case "compact_end": {
      const before = compactNumber(event.data.contextTokensBefore);
      const after = compactNumber(event.data.contextTokensAfter);
      return {
        kind: "compact",
        label: "compacted",
        detail: before && after ? `${before}→${after} tokens` : event.data.trigger,
      };
    }
    case "llm_start":
      return {
        kind: "model",
        label: "model",
        detail: event.data.model.split("/").at(-1) ?? event.data.model,
      };
    case "llm_end": {
      if (event.data.error) {
        const retry =
          event.data.error.retryable === true
            ? "retryable"
            : event.data.error.retryable === false
              ? "not retryable"
              : null;
        return {
          kind: "error",
          label: "model error",
          detail: [event.data.error.message, retry].filter(Boolean).join(" · "),
        };
      }
      const tokens = compactNumber(usageTokens(event.data.usage));
      const seconds =
        typeof event.data.durationMs === "number"
          ? `${Math.max(0.1, event.data.durationMs / 1000).toFixed(1)}s`
          : null;
      const parts = [tokens ? `${tokens} tokens` : null, seconds].filter(Boolean);
      return {
        kind: "model",
        label: "model",
        detail: parts.length ? parts.join(" · ") : (event.data.stopReason ?? "complete"),
      };
    }
    case "bridge_error":
      return { kind: "error", label: "error", detail: event.data.message };
  }
};

export const getEventDetail = (event: AgentHaloEvent) => {
  const activity = getEventActivity(event);
  return `${activity.label} · ${activity.detail}`;
};

const terminalStop = (value: string | null | undefined) => {
  const reason = value?.toLowerCase() ?? "";
  return (
    reason.includes("end") ||
    reason.includes("stop") ||
    reason.includes("done") ||
    reason.includes("complete")
  );
};

export const staleAfterMsForEvent = (event: AgentHaloEvent): number => {
  if (event.type === "llm_start") return LLM_STALE_AFTER_MS;
  if (event.type === "tool_start") return TOOL_STALE_AFTER_MS;
  if (event.type === "compact_start") return COMPACT_STALE_AFTER_MS;
  return ["turn_start", "tool_end", "compact_end", "llm_end", "bridge_error"].includes(
    event.type,
  )
    ? TRANSITION_STALE_AFTER_MS
    : STALE_AFTER_MS;
};

export const getEventSessionStatus = (
  event: AgentHaloEvent,
  now = new Date(),
): ISessionSummary["status"] => {
  const inactive = now.getTime() - Date.parse(event.timestamp) > staleAfterMsForEvent(event);
  switch (event.type) {
    case "conversation_close":
    case "turn_stop":
    case "turn_complete":
      return "done";
    case "attention_requested":
      return "attention";
    case "turn_start":
    case "tool_start":
    case "compact_start":
    case "compact_end":
    case "llm_start":
      return inactive ? "inactive" : "working";
    case "tool_end":
      return event.data.status === "error"
        ? inactive
          ? "inactive"
          : "error"
        : inactive
          ? "inactive"
          : "working";
    case "llm_end":
      return terminalStop(event.data.stopReason)
        ? "done"
        : event.data.error && !inactive
          ? "error"
          : inactive
            ? "inactive"
            : "working";
    case "bridge_error":
      return inactive ? "inactive" : "error";
    default:
      return "idle";
  }
};
