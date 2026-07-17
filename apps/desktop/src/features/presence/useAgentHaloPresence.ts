import {
  createDefaultBridgeCapabilities,
  createInitialPresence,
  getPresenceView,
  reducePresence,
  type AgentHaloEvent,
  type IAgentHaloBridgeCapabilities,
  type IAgentHaloPresence,
} from "@agent-halo/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { LLM_STALE_AFTER_MS, MAX_RECENT_EVENTS, STALE_AFTER_MS } from "../session/constants";
import {
  appendRecentEvent,
  mergeSessionEvents,
  normalizeSessionEventIdentity,
} from "../session/eventRegistry";
import {
  readSessionEventRegistry,
  writeSessionEventRegistry,
} from "../session/persistence";
import type { SessionEventRegistry } from "../session/types";

const BRIDGE_URL = "http://127.0.0.1:47621";

export interface IConnectionState {
  status: "connecting" | "connected" | "disconnected" | "error";
  message: string | null;
}

export interface IAgentHaloPresenceOptions {
  demoMode: boolean;
  demoScenario: string | null;
}

export interface IAgentHaloPresenceResult {
  capabilities: IAgentHaloBridgeCapabilities;
  connection: IConnectionState;
  lastLiveEvent: AgentHaloEvent | null;
  now: Date;
  presence: IAgentHaloPresence;
  recentEvents: AgentHaloEvent[];
  refreshCapabilities: () => Promise<boolean>;
  sessionEventRegistry: SessionEventRegistry;
  setSessionEventRegistry: React.Dispatch<React.SetStateAction<SessionEventRegistry>>;
  view: ReturnType<typeof getPresenceView>;
}

const readBoolean = (value: unknown, key: string, fallback: boolean) =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>)[key] === "boolean"
    ? (value as Record<string, boolean>)[key]
    : fallback;

const normalizeCapabilities = (value: unknown): IAgentHaloBridgeCapabilities => {
  const fallback = createDefaultBridgeCapabilities();
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;

  return {
    events: {
      lifecycle: readBoolean(record.events, "lifecycle", fallback.events.lifecycle),
      turns: readBoolean(record.events, "turns", fallback.events.turns),
      tools: readBoolean(record.events, "tools", fallback.events.tools),
      compact: readBoolean(record.events, "compact", fallback.events.compact),
      llm: readBoolean(record.events, "llm", fallback.events.llm),
    },
    endpoints: {
      health: readBoolean(record.endpoints, "health", fallback.endpoints.health),
      snapshot: readBoolean(record.endpoints, "snapshot", fallback.endpoints.snapshot),
      sse: readBoolean(record.endpoints, "sse", fallback.endpoints.sse),
      hookStop: readBoolean(record.endpoints, "hookStop", fallback.endpoints.hookStop),
      hookAttention: readBoolean(
        record.endpoints,
        "hookAttention",
        fallback.endpoints.hookAttention,
      ),
      ingest: readBoolean(record.endpoints, "ingest", fallback.endpoints.ingest),
    },
    sessionActions: {
      focusTerminal: readBoolean(
        record.sessionActions,
        "focusTerminal",
        fallback.sessionActions.focusTerminal,
      ),
      endSession: readBoolean(
        record.sessionActions,
        "endSession",
        fallback.sessionActions.endSession,
      ),
      dismissEnded: readBoolean(
        record.sessionActions,
        "dismissEnded",
        fallback.sessionActions.dismissEnded,
      ),
    },
  };
};

const demoRuntime = (key: string) => {
  const identityHash = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 1_000;
  return {
    sourcePid: 41_000 + identityHash,
    sourcePpid: 1,
    sourceStartedAtMs: 1_700_000_000_000 + identityHash * 1_000,
    sourceKind: "lettaHost" as const,
  };
};

const base = (scenario: string, timestamp: string) => ({
  version: 2 as const,
  id: `demo-scenario-${scenario}-${crypto.randomUUID()}`,
  timestamp,
  agentId: "agent-demo-mahiro-code",
  agentName: "Mahiro Code",
  conversationId: `local-conv-demo-${scenario}`,
  cwd: "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
  model: "gpt-5.6-sol",
  permissionMode: "unrestricted",
  runtime: demoRuntime(scenario),
});

const createScenario = (scenario: string): AgentHaloEvent[] => {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const at = (offset: number) => new Date(now + offset).toISOString();
  const common = base(scenario, timestamp);

  if (scenario === "idle") {
    return [
      {
        ...common,
        id: `${common.id}-open`,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
    ];
  }

  if (scenario === "attention") {
    return [
      {
        ...common,
        id: `${common.id}-open`,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...common,
        id: `${common.id}-turn`,
        timestamp: at(1),
        type: "turn_start",
        data: { inputCount: 1 },
      },
      {
        ...common,
        id: `${common.id}-tool`,
        timestamp: at(2),
        type: "tool_start",
        data: {
          toolCallId: "demo-question",
          toolName: "AskUserQuestion",
          argKeys: ["questions"],
        },
      },
      {
        ...common,
        id: `${common.id}-attention`,
        timestamp: at(3),
        type: "attention_requested",
        data: {
          hookEventName: "AskUserQuestion",
          source: "tool",
          kind: "question",
          toolName: "AskUserQuestion",
          message: "Question",
        },
      },
    ];
  }

  if (scenario === "done") {
    return [
      {
        ...common,
        id: `${common.id}-open`,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...common,
        id: `${common.id}-done`,
        timestamp: at(1),
        type: "turn_complete",
        data: { hookEventName: "Stop", source: "hook", message: null },
      },
    ];
  }

  if (scenario === "error") {
    return [
      {
        ...common,
        id: `${common.id}-open`,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...common,
        id: `${common.id}-error`,
        timestamp: at(1),
        type: "llm_end",
        data: {
          model: "gpt-5.6-sol",
          stopReason: "llm_api_error",
          durationMs: 12_000,
          usage: null,
          error: {
            message: "Provider request failed",
            errorType: "provider_error",
            retryable: true,
          },
        },
      },
    ];
  }

  if (scenario === "multi") {
    const workspace = common.cwd;
    const other = "/Users/mahiro/ghq/github.com/mahirocoko/paoplew";
    const item = (conversationId: string, cwd: string) => ({ ...common, conversationId, cwd, runtime: demoRuntime(conversationId) });
    return [
      {
        ...item("local-conv-demo-active", workspace),
        id: `${common.id}-active-open`,
        timestamp: at(1),
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...item("local-conv-demo-active", workspace),
        id: `${common.id}-active-turn`,
        timestamp: at(8),
        type: "turn_start",
        data: { inputCount: 1 },
      },
      {
        ...item("local-conv-demo-done-a", workspace),
        id: `${common.id}-done-a-open`,
        timestamp: at(2),
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...item("local-conv-demo-done-a", workspace),
        id: `${common.id}-done-a`,
        timestamp: at(7),
        type: "turn_complete",
        data: { hookEventName: "Stop", source: "hook", message: "Desktop pass complete" },
      },
      {
        ...item("local-conv-demo-done-b", workspace),
        id: `${common.id}-done-b-open`,
        timestamp: at(3),
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...item("local-conv-demo-done-b", workspace),
        id: `${common.id}-done-b`,
        timestamp: at(6),
        type: "turn_complete",
        data: { hookEventName: "Stop", source: "hook", message: "Native checks complete" },
      },
      {
        ...item("local-conv-demo-paoplew", other),
        id: `${common.id}-other-open`,
        timestamp: at(4),
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...item("local-conv-demo-paoplew", other),
        id: `${common.id}-other-done`,
        timestamp: at(5),
        type: "turn_complete",
        data: { hookEventName: "Stop", source: "hook", message: "Bills review complete" },
      },
    ];
  }

  if (scenario === "mixed-working-error") {
    const item = (conversationId: string) => ({ ...common, conversationId, runtime: demoRuntime(conversationId) });
    return [
      {
        ...item("local-conv-demo-working"),
        id: `${common.id}-working-open`,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...item("local-conv-demo-working"),
        id: `${common.id}-working-llm`,
        timestamp: at(1),
        type: "llm_start",
        data: { model: "gpt-5.6-sol", messageCount: 4, contextWindow: 372_000 },
      },
      {
        ...item("local-conv-demo-error"),
        id: `${common.id}-error-open`,
        timestamp: at(2),
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...item("local-conv-demo-error"),
        id: `${common.id}-error-llm`,
        timestamp: at(3),
        type: "llm_end",
        data: {
          model: "gpt-5.6-sol",
          stopReason: "llm_api_error",
          durationMs: 1_200,
          usage: null,
          error: { message: "Provider request failed", errorType: "provider_error", retryable: true },
        },
      },
    ];
  }

  if (scenario === "long-llm") {
    const old = new Date(now - 90_000).toISOString();
    return [
      {
        ...common,
        id: `${common.id}-open`,
        timestamp: old,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...common,
        id: `${common.id}-llm`,
        timestamp: new Date(Date.parse(old) + 1).toISOString(),
        type: "llm_start",
        data: { model: "gpt-5.6-sol", messageCount: 20, contextWindow: 372_000 },
      },
    ];
  }

  if (scenario === "long-tool") {
    const old = new Date(now - 5 * 60_000).toISOString();
    return [
      {
        ...common,
        id: `${common.id}-open`,
        timestamp: old,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      },
      {
        ...common,
        id: `${common.id}-tool`,
        timestamp: new Date(Date.parse(old) + 1).toISOString(),
        type: "tool_start",
        data: {
          toolCallId: "long-tool",
          toolName: "TaskOutput",
          argKeys: ["task_id", "timeout"],
        },
      },
    ];
  }

  const old = new Date(now - LLM_STALE_AFTER_MS - 60_000).toISOString();
  return [
    {
      ...common,
      id: `${common.id}-open`,
      timestamp: old,
      type: "conversation_open",
      data: { reason: "startup", previousConversationId: null },
    },
    {
      ...common,
      id: `${common.id}-inactive`,
      timestamp: new Date(Date.parse(old) + 1).toISOString(),
      type: "llm_start",
      data: { model: "gpt-5.6-sol", messageCount: 10, contextWindow: 200_000 },
    },
  ];
};

const createDemoEvent = (index: number): AgentHaloEvent => {
  const common = {
    version: 2 as const,
    id: `demo-${index}-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    agentId: "agent-demo-mahiro-code",
    agentName: "Mahiro Code",
    conversationId: `local-conv-demo-${(Math.floor(index / 10) % 3) + 1}`,
    cwd: "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
    model: "gpt-5.5",
    permissionMode: "unrestricted",
    runtime: demoRuntime(`stream-${Math.floor(index / 10) % 3}`),
  };

  switch (index % 10) {
    case 0:
      return {
        ...common,
        type: "conversation_open",
        data: { reason: "startup", previousConversationId: null },
      };
    case 1:
      return { ...common, type: "turn_start", data: { inputCount: 1 } };
    case 2:
      return {
        ...common,
        type: "tool_start",
        data: { toolCallId: "demo-tool", toolName: "exec_command", argKeys: ["cmd"] },
      };
    case 3:
      return {
        ...common,
        type: "tool_end",
        data: {
          toolCallId: "demo-tool",
          toolName: "exec_command",
          status: "success",
          outputLength: 420,
        },
      };
    case 4:
      return {
        ...common,
        type: "compact_start",
        data: { trigger: "context_window_overflow" },
      };
    case 5:
      return {
        ...common,
        type: "compact_end",
        data: {
          trigger: "context_window_overflow",
          messagesBefore: 220,
          messagesAfter: 120,
          contextTokensBefore: 190000,
          contextTokensAfter: 90000,
        },
      };
    case 6:
      return {
        ...common,
        type: "tool_start",
        data: {
          toolCallId: "demo-tool-2",
          toolName: "AskUserQuestion",
          argKeys: ["questions"],
        },
      };
    case 7:
      return {
        ...common,
        type: "attention_requested",
        data: {
          hookEventName: "AskUserQuestion",
          source: "tool",
          kind: "question",
          toolName: "AskUserQuestion",
          message: "Question",
        },
      };
    case 8:
      return {
        ...common,
        type: "tool_end",
        data: {
          toolCallId: "demo-tool-2",
          toolName: "AskUserQuestion",
          status: "success",
          outputLength: 64,
        },
      };
    default:
      return {
        ...common,
        type: "turn_complete",
        data: { hookEventName: "Stop", source: "hook", message: null },
      };
  }
};

export const useAgentHaloPresence = ({
  demoMode,
  demoScenario,
}: IAgentHaloPresenceOptions): IAgentHaloPresenceResult => {
  const [presence, setPresence] = useState<IAgentHaloPresence>(() => createInitialPresence());
  const [recentEvents, setRecentEvents] = useState<AgentHaloEvent[]>([]);
  const [lastLiveEvent, setLastLiveEvent] = useState<AgentHaloEvent | null>(null);
  const [sessionEventRegistry, setSessionEventRegistry] =
    useState<SessionEventRegistry>(readSessionEventRegistry);
  const [capabilities, setCapabilities] = useState(() => createDefaultBridgeCapabilities());
  const [connection, setConnection] = useState<IConnectionState>({
    status: "connecting",
    message: null,
  });
  const [now, setNow] = useState(() => new Date());
  const pendingRegistryWriteRef = useRef<SessionEventRegistry | null>(null);
  const registryWriteTimerRef = useRef<number | null>(null);
  const liveEventVersionRef = useRef(0);

  const flushRegistryWrite = () => {
    if (registryWriteTimerRef.current !== null) {
      window.clearTimeout(registryWriteTimerRef.current);
      registryWriteTimerRef.current = null;
    }
    if (!pendingRegistryWriteRef.current) return;
    writeSessionEventRegistry(pendingRegistryWriteRef.current);
    pendingRegistryWriteRef.current = null;
  };

  const scheduleRegistryWrite = (registry: SessionEventRegistry) => {
    pendingRegistryWriteRef.current = registry;
    if (registryWriteTimerRef.current !== null) return;
    registryWriteTimerRef.current = window.setTimeout(flushRegistryWrite, 80);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const flush = () => flushRegistryWrite();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flushRegistryWrite();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    const snapshotStartVersion = liveEventVersionRef.current;
    const store = (events: AgentHaloEvent[]) => {
      setSessionEventRegistry((current) => {
        const next = mergeSessionEvents(current, events);
        scheduleRegistryWrite(next);
        return next;
      });
    };

    if (demoMode) {
      setConnection({ status: "connected", message: "Demo mode" });
      setCapabilities({
        ...createDefaultBridgeCapabilities(),
        events: { lifecycle: true, turns: true, tools: true, compact: true, llm: true },
      });
      if (demoScenario) {
        const events = createScenario(demoScenario);
        setLastLiveEvent(events.at(-1) ?? null);
        setPresence(events.reduce(reducePresence, createInitialPresence()));
        setRecentEvents([...events].reverse());
        const next = mergeSessionEvents({}, events);
        writeSessionEventRegistry(next);
        setSessionEventRegistry(next);
        return;
      }

      let index = 0;
      const push = () => {
        const event = createDemoEvent(index++);
        setLastLiveEvent(event);
        setPresence((current) => reducePresence(current, event));
        setRecentEvents((current) => appendRecentEvent(current, event));
        store([event]);
      };
      push();
      const timer = window.setInterval(push, 800);
      return () => window.clearInterval(timer);
    }

    const fetchCapabilities = async (path: "snapshot" | "health") => {
      const response = await fetch(`${BRIDGE_URL}/${path}`);
      if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
      return response.json() as Promise<{
        recent?: AgentHaloEvent[];
        capabilities?: unknown;
      }>;
    };

    void fetchCapabilities("snapshot")
      .then((payload) => {
        if (disposed) return;
        if (payload.capabilities) setCapabilities(normalizeCapabilities(payload.capabilities));
        if (!Array.isArray(payload.recent)) return;
        const recent = payload.recent.map(normalizeSessionEventIdentity);
        if (liveEventVersionRef.current === snapshotStartVersion) {
          setPresence(recent.reduce(reducePresence, createInitialPresence()));
          setRecentEvents(recent.slice(-MAX_RECENT_EVENTS).reverse());
        }
        store(recent);
      })
      .catch(() => undefined);

    void fetchCapabilities("health")
      .then((payload) => {
        if (!disposed && payload.capabilities) {
          setCapabilities(normalizeCapabilities(payload.capabilities));
        }
      })
      .catch(() => undefined);

    source = new EventSource(`${BRIDGE_URL}/events`);
    source.onopen = () => {
      if (!disposed) setConnection({ status: "connected", message: null });
    };
    source.onerror = () => {
      if (!disposed) {
        setConnection({
          status: source?.readyState === EventSource.CLOSED ? "disconnected" : "error",
          message: "Waiting for Agent Halo bridge",
        });
      }
    };
    const handle = (message: MessageEvent<string>) => {
      try {
        const event = normalizeSessionEventIdentity(JSON.parse(message.data) as AgentHaloEvent);
        liveEventVersionRef.current += 1;
        setLastLiveEvent(event);
        setPresence((current) => reducePresence(current, event));
        setRecentEvents((current) => appendRecentEvent(current, event));
        store([event]);
      } catch {
        setConnection({ status: "error", message: "Received malformed bridge event" });
      }
    };
    for (const type of [
      "bridge_ready",
      "conversation_open",
      "conversation_close",
      "turn_start",
      "turn_stop",
      "turn_complete",
      "attention_requested",
      "tool_start",
      "tool_end",
      "compact_start",
      "compact_end",
      "llm_start",
      "llm_end",
      "bridge_error",
    ]) {
      source.addEventListener(type, handle as EventListener);
    }

    return () => {
      disposed = true;
      source?.close();
      flushRegistryWrite();
    };
  }, []);

  const refreshCapabilities = async () => {
    try {
      const response = await fetch(`${BRIDGE_URL}/health`);
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { capabilities?: unknown };
      if (payload.capabilities) setCapabilities(normalizeCapabilities(payload.capabilities));
      return true;
    } catch {
      return false;
    }
  };

  const view = useMemo(
    () => getPresenceView(presence, { now, staleAfterMs: STALE_AFTER_MS }),
    [now, presence],
  );
  return {
    capabilities,
    connection,
    lastLiveEvent,
    now,
    presence,
    recentEvents,
    refreshCapabilities,
    sessionEventRegistry,
    setSessionEventRegistry,
    view,
  };
};
