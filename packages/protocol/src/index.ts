export const AGENT_HALO_PROTOCOL_VERSION = 1 as const;

export type AgentHaloEventType =
  | "bridge_ready"
  | "conversation_open"
  | "conversation_close"
  | "turn_start"
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
  | IAgentHaloToolStartEvent
  | IAgentHaloBridgeErrorEvent;
