import type { AgentHaloEvent } from "./index.js";

export type AgentHaloPresenceStatus =
  | "offline"
  | "idle"
  | "thinking"
  | "tool-running"
  | "closed"
  | "error";

export interface IAgentHaloPresence {
  status: AgentHaloPresenceStatus;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  cwd: string | null;
  model: string | null;
  permissionMode: string | null;
  activeToolName: string | null;
  lastEventType: AgentHaloEvent["type"] | null;
  lastEventAt: string | null;
  messageCount: number | null;
  toolCallCount: number | null;
}

export interface IAgentHaloPresenceView {
  status: AgentHaloPresenceStatus | "stale";
  label: string;
  isStale: boolean;
  staleForMs: number;
}

export const createInitialPresence = (): IAgentHaloPresence => ({
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
});

export const reducePresence = (
  current: IAgentHaloPresence,
  event: AgentHaloEvent,
): IAgentHaloPresence => {
  const scoped = {
    agentId: event.agentId ?? current.agentId,
    agentName: event.agentName ?? current.agentName,
    conversationId: event.conversationId ?? current.conversationId,
    cwd: event.cwd ?? current.cwd,
    model: event.model ?? current.model,
    permissionMode: event.permissionMode ?? current.permissionMode,
    lastEventType: event.type,
    lastEventAt: event.timestamp,
  } satisfies Partial<IAgentHaloPresence>;

  switch (event.type) {
    case "bridge_ready":
      return { ...current, ...scoped, status: current.conversationId ? current.status : "idle" };
    case "conversation_open":
      return {
        ...current,
        ...scoped,
        status: "idle",
        activeToolName: null,
        messageCount: null,
        toolCallCount: null,
      };
    case "conversation_close":
      return {
        ...current,
        ...scoped,
        status: "closed",
        activeToolName: null,
        messageCount: event.data.messageCount,
        toolCallCount: event.data.toolCallCount,
      };
    case "turn_start":
    case "llm_start":
      return {
        ...current,
        ...scoped,
        status: "thinking",
        activeToolName: null,
      };
    case "compact_start":
      return {
        ...current,
        ...scoped,
        status: "tool-running",
        activeToolName: "compact",
      };
    case "compact_end":
      return {
        ...current,
        ...scoped,
        status: "thinking",
        activeToolName: null,
      };
    case "turn_stop":
      return {
        ...current,
        ...scoped,
        status: "closed",
        activeToolName: null,
      };
    case "tool_start":
      return {
        ...current,
        ...scoped,
        status: "tool-running",
        activeToolName: event.data.toolName,
      };
    case "tool_end":
      return {
        ...current,
        ...scoped,
        status: event.data.status === "error" ? "error" : "thinking",
        activeToolName: null,
      };
    case "llm_end": {
      const reason = event.data.stopReason?.toLowerCase() ?? "";
      const isTerminal = reason.includes("end") || reason.includes("stop") || reason.includes("done") || reason.includes("complete");
      return {
        ...current,
        ...scoped,
        status: isTerminal ? "closed" : "thinking",
        activeToolName: null,
      };
    }
    case "bridge_error":
      return {
        ...current,
        ...scoped,
        status: "error",
        activeToolName: null,
      };
    default:
      return { ...current, ...scoped };
  }
};

export const getPresenceView = (
  presence: IAgentHaloPresence,
  options: { now?: Date; staleAfterMs?: number } = {},
): IAgentHaloPresenceView => {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  const lastEventMs = presence.lastEventAt ? Date.parse(presence.lastEventAt) : Number.NaN;
  const staleForMs = Number.isFinite(lastEventMs) ? Math.max(0, now.getTime() - lastEventMs) : 0;
  const canBecomeStale = presence.status === "thinking" || presence.status === "tool-running";
  const isStale = canBecomeStale && staleForMs > staleAfterMs;

  if (isStale) {
    return { status: "stale", label: "stale", isStale, staleForMs };
  }

  const label = (() => {
    switch (presence.status) {
      case "offline":
        return "offline";
      case "idle":
        return "idle";
      case "thinking":
        return "thinking";
      case "tool-running":
        return presence.activeToolName ? `tool: ${presence.activeToolName}` : "tool-running";
      case "closed":
        return "closed";
      case "error":
        return "error";
    }
  })();

  return { status: presence.status, label, isStale, staleForMs };
};
