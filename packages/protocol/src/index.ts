export const AGENT_HALO_PROTOCOL_VERSION = 1 as const;


export interface IAgentHaloBridgeCapabilities {
  events: {
    lifecycle: boolean;
    turns: boolean;
    tools: boolean;
  };
  endpoints: {
    health: boolean;
    snapshot: boolean;
    sse: boolean;
    hookStop: boolean;
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
  },
  endpoints: {
    health: true,
    snapshot: true,
    sse: true,
    hookStop: true,
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
  | "tool_start"
  | "bridge_error";

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

export interface IAgentHaloToolStartEvent extends IAgentHaloBaseEvent {
  type: "tool_start";
  data: {
    toolCallId: string | null;
    toolName: string;
    argKeys: string[];
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
  | IAgentHaloToolStartEvent
  | IAgentHaloBridgeErrorEvent;

export type {
  AgentHaloPresenceStatus,
  IAgentHaloPresence,
  IAgentHaloPresenceView,
} from "./presence.js";
export { createInitialPresence, getPresenceView, reducePresence } from "./presence.js";
