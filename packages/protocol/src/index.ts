export const AGENT_HALO_PROTOCOL_VERSION = 2 as const;


export interface IAgentHaloBridgeCapabilities {
  events: {
    lifecycle: boolean;
    turns: boolean;
    tools: boolean;
    compact: boolean;
    llm: boolean;
  };
  endpoints: {
    health: boolean;
    snapshot: boolean;
    sse: boolean;
    hookStop: boolean;
    hookAttention: boolean;
    ingest: boolean;
  };
  sessionActions: {
    focusTerminal: boolean;
    endSession: boolean;
    dismissEnded: boolean;
  };
}

export const createDefaultBridgeCapabilities = (): IAgentHaloBridgeCapabilities => ({
  events: {
    lifecycle: false,
    turns: false,
    tools: false,
    compact: false,
    llm: false,
  },
  endpoints: {
    health: true,
    snapshot: true,
    sse: true,
    hookStop: true,
    hookAttention: true,
    ingest: true,
  },
  sessionActions: {
    focusTerminal: false,
    endSession: false,
    dismissEnded: true,
  },
});

export type AgentHaloEventType =
  | "bridge_ready"
  | "conversation_open"
  | "conversation_close"
  | "turn_start"
  | "turn_stop"
  | "turn_complete"
  | "attention_requested"
  | "tool_start"
  | "tool_end"
  | "compact_start"
  | "compact_end"
  | "llm_start"
  | "llm_end"
  | "bridge_error";

export interface IAgentHaloEventRuntime {
  sourcePid: number;
  sourcePpid: number | null;
  sourceStartedAtMs: number;
  sourceKind: "lettaHost" | "hookRelay" | "unknown" | string;
}

export interface IAgentHaloBaseEvent {
  version: typeof AGENT_HALO_PROTOCOL_VERSION;
  id: string;
  type: AgentHaloEventType;
  timestamp: string;
  agentId: string | null;
  agentName?: string | null;
  conversationId: string | null;
  cwd?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  runtime?: IAgentHaloEventRuntime | null;
}

export interface IAgentHaloBridgeReadyEvent extends IAgentHaloBaseEvent {
  type: "bridge_ready";
  data: {
    port: number;
    logFile: string;
    ssePath: "/events";
    healthPath: "/health";
  };
}

export interface IAgentHaloConversationOpenEvent extends IAgentHaloBaseEvent {
  type: "conversation_open";
  data: {
    reason: "startup" | "new" | "resume" | "fork" | string;
    previousConversationId?: string | null;
  };
}

export interface IAgentHaloConversationCloseEvent extends IAgentHaloBaseEvent {
  type: "conversation_close";
  data: {
    durationMs: number | null;
    messageCount: number | null;
    reason: "quit" | "new" | "resume" | "fork" | string;
    toolCallCount: number | null;
  };
}

export interface IAgentHaloTurnStartEvent extends IAgentHaloBaseEvent {
  type: "turn_start";
  data: {
    inputCount: number;
    userTextPreview?: string | null;
  };
}

export interface IAgentHaloTurnStopEvent extends IAgentHaloBaseEvent {
  type: "turn_stop";
  data: {
    hookEventName: "Stop" | string;
    source: "hook" | string;
    message?: string | null;
  };
}

export interface IAgentHaloTurnCompleteEvent extends IAgentHaloBaseEvent {
  type: "turn_complete";
  data: {
    hookEventName: "Stop" | string;
    source: "hook" | string;
    message?: string | null;
  };
}

export interface IAgentHaloAttentionRequestedEvent extends IAgentHaloBaseEvent {
  type: "attention_requested";
  data: {
    hookEventName: "PermissionRequest" | "AskUserQuestion" | string;
    source: "hook" | "tool" | string;
    kind: "approval" | "question" | string;
    toolName?: string | null;
    message?: string | null;
  };
}

export interface IAgentHaloToolStartEvent extends IAgentHaloBaseEvent {
  type: "tool_start";
  data: {
    toolCallId: string | null;
    toolName: string;
    argKeys: string[];
  };
}

export interface IAgentHaloToolEndEvent extends IAgentHaloBaseEvent {
  type: "tool_end";
  data: {
    toolCallId: string | null;
    toolName: string;
    status: "success" | "error" | string;
    outputLength: number | null;
  };
}

export interface IAgentHaloCompactStartEvent extends IAgentHaloBaseEvent {
  type: "compact_start";
  data: {
    trigger: "manual" | "context_window_overflow" | "context_window_limit" | string;
  };
}

export interface IAgentHaloCompactEndEvent extends IAgentHaloBaseEvent {
  type: "compact_end";
  data: {
    trigger: "manual" | "context_window_overflow" | "context_window_limit" | string;
    messagesBefore: number | null;
    messagesAfter: number | null;
    contextTokensBefore: number | null;
    contextTokensAfter: number | null;
  };
}

export interface IAgentHaloLlmStartEvent extends IAgentHaloBaseEvent {
  type: "llm_start";
  data: {
    model: string;
    messageCount: number | null;
    contextWindow: number | null;
  };
}

export interface IAgentHaloLlmEndError {
  message: string;
  errorType: "llm_error" | "local_backend_error" | string;
  retryable: boolean | null;
}

export interface IAgentHaloLlmEndEvent extends IAgentHaloBaseEvent {
  type: "llm_end";
  data: {
    model: string;
    stopReason: string | null;
    durationMs: number | null;
    usage: {
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
    } | null;
    error?: IAgentHaloLlmEndError;
  };
}

export interface IAgentHaloBridgeErrorEvent extends IAgentHaloBaseEvent {
  type: "bridge_error";
  data: {
    message: string;
    code?: string;
  };
}

export type AgentHaloEvent =
  | IAgentHaloBridgeReadyEvent
  | IAgentHaloConversationOpenEvent
  | IAgentHaloConversationCloseEvent
  | IAgentHaloTurnStartEvent
  | IAgentHaloTurnStopEvent
  | IAgentHaloTurnCompleteEvent
  | IAgentHaloAttentionRequestedEvent
  | IAgentHaloToolStartEvent
  | IAgentHaloToolEndEvent
  | IAgentHaloCompactStartEvent
  | IAgentHaloCompactEndEvent
  | IAgentHaloLlmStartEvent
  | IAgentHaloLlmEndEvent
  | IAgentHaloBridgeErrorEvent;

export type {
  AgentHaloPresenceStatus,
  IAgentHaloPresence,
  IAgentHaloPresenceView,
} from "./presence.js";
export { createInitialPresence, getPresenceView, reducePresence } from "./presence.js";
